package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func writeCert(t *testing.T, dir, name string, until time.Time) *x509.CertPool {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: name}, DNSNames: []string{name},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: until, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA: true, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	kb, _ := x509.MarshalECPrivateKey(key)
	os.MkdirAll(filepath.Join(dir, "tls"), 0o755)
	os.WriteFile(filepath.Join(dir, "tls", "cert.pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644)
	os.WriteFile(filepath.Join(dir, "tls", "key.pem"), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0o600)
	pool := x509.NewCertPool()
	c, _ := x509.ParseCertificate(der)
	pool.AddCert(c)
	return pool
}

// A deployment without a certificate has no secure link; with one it answers
// over https under the certificate's name, says so in its status, takes a
// renewed certificate without a restart, and says nothing of one that has
// run out.
func TestSecureLink(t *testing.T) {
	dir := t.TempDir()
	if s := newSecureLink(dir, 17720); s != nil || s.status() != nil {
		t.Fatalf("a link without a certificate: %+v", s)
	}
	pool := writeCert(t, dir, "abc.d.example.test", time.Now().Add(48*time.Hour))
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	plain := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	s := newSecureLink(dir, plain-securePortOff)
	if s == nil {
		t.Fatal("no link with a certificate there")
	}
	st := s.status()
	if st == nil || st["name"] != "abc.d.example.test" || st["port"] != plain {
		t.Fatalf("status: %+v", st)
	}
	s.serve(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "pung") }), func(net.Listener) {})
	get := func(pool *x509.CertPool, name string) (string, error) {
		c := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: name}}}
		r, err := c.Get("https://127.0.0.1:" + strconv.Itoa(plain) + "/")
		if err != nil {
			return "", err
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		return string(b), nil
	}
	var body string
	for i := 0; i < 50; i++ {
		if body, err = get(pool, "abc.d.example.test"); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil || body != "pung" {
		t.Fatalf("over https: %q %v", body, err)
	}
	// a renewal: another certificate in the same files, taken without a restart
	time.Sleep(1100 * time.Millisecond) // (the file's time is what says it changed)
	pool2 := writeCert(t, dir, "abc.d.example.test", time.Now().Add(72*time.Hour))
	if _, err := get(pool2, "abc.d.example.test"); err != nil {
		t.Errorf("the renewed certificate is not served: %v", err)
	}
	if _, err := get(pool, "abc.d.example.test"); err == nil {
		t.Error("the certificate from before is still served")
	}
	// one that has run out is not offered to pung.live
	time.Sleep(1100 * time.Millisecond)
	writeCert(t, dir, "abc.d.example.test", time.Now().Add(-time.Minute))
	if st := s.status(); st != nil {
		t.Errorf("a certificate that has run out is still in the status: %+v", st)
	}
}
