package main

// secure.go: the same page and calls over https, where this deployment has a
// certificate (docs/SECURE-LINK.md).
//
// Why: pung.live is a secure page, and a browser lets a secure page talk to a
// deployment on the home network over plain http only where it has a
// permission for that (Chrome, Edge and Firefox on a computer). Safari has
// none, and every browser on an iPad or iPhone is Safari underneath. Secure
// to secure is allowed everywhere: so a deployment that has a name under a
// public domain and a certificate for it answers there too.
//
// What is here is the deployment's half and nothing of how the certificate
// comes to be: Pung serves over TLS when <data>/tls/cert.pem and key.pem are
// there (a full chain and its key, PEM), reads them again when the file
// changes (a renewal needs no restart), and says its name and port in
// /api/status ("secure"). Its own page hands that address to pung.live when
// the visitor switches there (web/places.js).

import (
	"crypto/tls"
	"crypto/x509"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// securePortOff: the https port beside the plain one (7720 -> 7721)
const securePortOff = 1

type secureLink struct {
	cert, key string
	port      int

	mu     sync.Mutex
	loaded *tls.Certificate
	mod    time.Time
	name   string
	until  time.Time
}

// newSecureLink: the link, if this deployment has a certificate
func newSecureLink(dataDir string, plainPort int) *secureLink {
	s := &secureLink{cert: filepath.Join(dataDir, "tls", "cert.pem"), key: filepath.Join(dataDir, "tls", "key.pem"), port: plainPort + securePortOff}
	if _, err := s.current(); err != nil {
		if !os.IsNotExist(err) {
			log.Printf("secure: the certificate in %s is not used: %v", filepath.Dir(s.cert), err)
		}
		return nil
	}
	return s
}

// current: the certificate as it is on the disk now
func (s *secureLink) current() (*tls.Certificate, error) {
	fi, err := os.Stat(s.cert)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded != nil && fi.ModTime().Equal(s.mod) {
		return s.loaded, nil
	}
	c, err := tls.LoadX509KeyPair(s.cert, s.key)
	if err != nil {
		if s.loaded != nil { // a renewal half written: the one before goes on
			return s.loaded, nil
		}
		return nil, err
	}
	leaf, err := x509.ParseCertificate(c.Certificate[0])
	if err != nil {
		return nil, err
	}
	s.loaded, s.mod, s.until, s.name = &c, fi.ModTime(), leaf.NotAfter, ""
	if len(leaf.DNSNames) > 0 {
		s.name = leaf.DNSNames[0]
	}
	log.Printf("secure: certificate for %s, good until %s", s.name, leaf.NotAfter.Format("2006-01-02"))
	return s.loaded, nil
}

// status: what /api/status says of it (nil: none, or one that has run out)
func (s *secureLink) status() map[string]any {
	if s == nil {
		return nil
	}
	if _, err := s.current(); err != nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.name == "" || time.Now().After(s.until) {
		return nil
	}
	return map[string]any{"name": s.name, "port": s.port, "until": s.until.UTC().Format(time.RFC3339)}
}

// serve: the handler over TLS on the link's port
func (s *secureLink) serve(h http.Handler, inChildren func(net.Listener)) {
	ln, err := net.Listen("tcp", net.JoinHostPort("", strconv.Itoa(s.port)))
	if err != nil {
		log.Printf("secure: :%d is taken (%v): no https here", s.port, err)
		return
	}
	inChildren(ln)
	cfg := &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) { return s.current() }}
	log.Printf("https on :%d", s.port)
	go func() {
		_ = (&http.Server{Handler: h, ReadHeaderTimeout: 5 * time.Second, ErrorLog: log.New(discard{}, "", 0)}).Serve(tls.NewListener(ln, cfg))
	}()
}

// discard: a browser that turns a certificate down is not worth a line each time
type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
