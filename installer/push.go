package main

// push.go: reaching the Push over SSH. The Push lets in a computer whose
// public key the user adds at http://<push>/ssh and confirms on the Push
// (Shift + Select + Preferences); the same key then logs in as ableton and
// as root (the Push has no sudo). The SSH client and the scp copy are
// adapted from the Push Hack Installer (MIT, see NOTICE).

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const dialTimeout = 8 * time.Second

// ---- the key ------------------------------------------------------------------------

// keyDir: ~/.ssh, where the keys this computer may already use live
func keyDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".ssh"
	}
	return filepath.Join(home, ".ssh")
}

// pungKey: the key this installer makes when no key of this computer is let in
func pungKey() string { return filepath.Join(keyDir(), "pung_id_rsa") }

// candidateKeys: keys this computer may already have let into the Push (the
// Push Hack Installer's, the user's own), then Pung's
func candidateKeys() []string {
	d := keyDir()
	return []string{pungKey(), filepath.Join(d, "push_hack_id_rsa"), filepath.Join(d, "id_ed25519"), filepath.Join(d, "id_rsa"), filepath.Join(d, "id_ecdsa")}
}

func loadSigner(p string) (ssh.Signer, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	return ssh.ParsePrivateKey(b) // a key with a passphrase is skipped: it cannot be used unattended
}

// ensurePungKey: Pung's key (RSA 3072, as the Push takes), made once; its public line
func ensurePungKey() (string, error) {
	priv := pungKey()
	if _, err := os.Stat(priv); err != nil {
		if err := os.MkdirAll(filepath.Dir(priv), 0o700); err != nil {
			return "", err
		}
		k, err := rsa.GenerateKey(rand.Reader, 3072)
		if err != nil {
			return "", err
		}
		pemb := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(k)})
		if err := os.WriteFile(priv, pemb, 0o600); err != nil {
			return "", err
		}
		pub, err := ssh.NewPublicKey(&k.PublicKey)
		if err != nil {
			return "", err
		}
		line := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub))) + " pung-installer\n"
		if err := os.WriteFile(priv+".pub", []byte(line), 0o644); err != nil {
			return "", err
		}
	}
	b, err := os.ReadFile(priv + ".pub")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

// ---- the host -------------------------------------------------------------------------

// knownHosts: the Push's host key, as first seen (trust on first use): a Push
// that answers with another key later is refused, unless the user forgets it
func knownHostsPath() string {
	d, err := os.UserConfigDir()
	if err != nil {
		d = keyDir()
	}
	return filepath.Join(d, "Pung", "known_pushes")
}

var errHostChanged = errors.New("the Push answered with another identity than before")

func hostKeyCallback(addr string) ssh.HostKeyCallback {
	return func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		p := knownHostsPath()
		b, _ := os.ReadFile(p)
		for _, line := range strings.Split(string(b), "\n") {
			f := strings.Fields(line)
			if len(f) == 2 && f[0] == addr {
				if f[1] != fp {
					// a Push reinstalled or reset gets a new key; the UI offers to forget the old one
					return errHostChanged
				}
				return nil
			}
		}
		_ = os.MkdirAll(filepath.Dir(p), 0o700)
		f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err == nil {
			fmt.Fprintf(f, "%s %s\n", addr, fp)
			f.Close()
		}
		return nil
	}
}

func forgetHost(addr string) {
	p := knownHostsPath()
	b, _ := os.ReadFile(p)
	var keep []string
	for _, line := range strings.Split(string(b), "\n") {
		if f := strings.Fields(line); len(f) == 2 && f[0] != addr {
			keep = append(keep, line)
		}
	}
	_ = os.WriteFile(p, []byte(strings.Join(keep, "\n")+"\n"), 0o600)
}

// ---- the client -----------------------------------------------------------------------

type client struct{ c *ssh.Client }

func dial(addr, user string, signer ssh.Signer) (*client, error) {
	cfg := &ssh.ClientConfig{User: user, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: hostKeyCallback(addr), Timeout: dialTimeout}
	c, err := ssh.Dial("tcp", net.JoinHostPort(addr, "22"), cfg)
	if err != nil {
		return nil, err
	}
	return &client{c}, nil
}

func (c *client) Close() { _ = c.c.Close() }

// both: one buffer for a command's output and its errors. The ssh library
// copies each stream on a goroutine of its own, so the two write at once: into
// a plain bytes.Buffer that lost or zeroed what a command said (on a real
// Push, 2026-11-27: Push Hack's version read as twelve zero bytes every other
// time, and the Push's own version never).
type both struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (w *both) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.Write(p)
}

func (w *both) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.String()
}

func (c *client) run(cmd string) (string, error) {
	s, err := c.c.NewSession()
	if err != nil {
		return "", err
	}
	defer s.Close()
	var buf both
	s.Stdout, s.Stderr = &buf, &buf
	if err := s.Run(cmd); err != nil {
		return buf.String(), fmt.Errorf("%s: %w (%s)", firstWords(cmd), err, strings.TrimSpace(buf.String()))
	}
	return buf.String(), nil
}

func (c *client) ok(cmd string) bool { _, err := c.run(cmd); return err == nil }

func firstWords(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 60 {
		s = s[:60] + "…"
	}
	return s
}

// copyBytes: a file onto the Push (scp's protocol)
func (c *client) copyBytes(data []byte, remote string, mode os.FileMode) error {
	s, err := c.c.NewSession()
	if err != nil {
		return err
	}
	defer s.Close()
	in, _ := s.StdinPipe()
	out, _ := s.StdoutPipe()
	var stderr bytes.Buffer
	s.Stderr = &stderr
	if err := s.Start("scp -qtd " + shellQuote(path.Dir(remote))); err != nil {
		return err
	}
	err = func() error {
		if _, err := fmt.Fprintf(in, "C%04o %d %s\n", mode.Perm(), len(data), path.Base(remote)); err != nil {
			return err
		}
		if err := scpAck(out); err != nil {
			return err
		}
		if _, err := in.Write(append(data, 0)); err != nil {
			return err
		}
		return scpAck(out)
	}()
	_ = in.Close()
	if werr := s.Wait(); err == nil && werr != nil {
		err = fmt.Errorf("%w (%s)", werr, strings.TrimSpace(stderr.String()))
	}
	if err != nil {
		return fmt.Errorf("copy %s: %w", remote, err)
	}
	return nil
}

func scpAck(r io.Reader) error {
	b := make([]byte, 1)
	if _, err := io.ReadFull(r, b); err != nil {
		return err
	}
	if b[0] == 0 {
		return nil
	}
	msg, _ := bufio.NewReader(r).ReadString('\n')
	return fmt.Errorf("the Push said: %s", strings.TrimSpace(msg))
}

// stream: src piped into a command on the Push (a package unpacked as it arrives)
func (c *client) stream(cmd string, src io.Reader) error {
	s, err := c.c.NewSession()
	if err != nil {
		return err
	}
	defer s.Close()
	var buf both
	s.Stdin, s.Stdout, s.Stderr = src, &buf, &buf
	if err := s.Run(cmd); err != nil {
		return fmt.Errorf("%s: %w (%s)", firstWords(cmd), err, strings.TrimSpace(buf.String()))
	}
	return nil
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// ---- what is on the Push ------------------------------------------------------------------

// userDataDir: where the Push keeps the user's files (and push-hack/)
func userDataDir(c *client) string {
	for _, d := range []string{"/data", "/data/UserData", "/home/ableton"} {
		if c.ok(fmt.Sprintf("test -d %s && test -w %s", shellQuote(d), shellQuote(d))) {
			return d
		}
	}
	return "/data"
}

type pushInfo struct {
	Addr         string `json:"addr"`
	UserData     string `json:"user_data"`
	PushHack     string `json:"push_hack"` // its version; "" not installed
	PushHackOK   bool   `json:"push_hack_ok"`
	RemoteScript bool   `json:"remote_script"`
	Pung         string `json:"pung"` // its version; "" not installed
	PungPort     int    `json:"pung_port"`
	PungRunning  bool   `json:"pung_running"`
	Firmware     string `json:"firmware"`
}

// inspect: what the Push has, read only
func inspect(root *client, addr string) pushInfo {
	in := pushInfo{Addr: addr, UserData: userDataDir(root)}
	ph := in.UserData + "/push-hack"
	core := []string{"push-manager", "push-catalog", "push-display"}
	in.PushHackOK = true
	for _, id := range core {
		if !root.ok("test -f /etc/init.d/push-hack-" + id) {
			in.PushHackOK = false
		}
	}
	// Push Hack's release, as Push Manager knows it (its hack.json's version is not the release's)
	if out, err := root.run(`wget -q -T 3 -O- http://127.0.0.1:7701/api/update/status 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("installed",""))' 2>/dev/null`); err == nil {
		in.PushHack = strings.TrimSpace(out)
	}
	if in.PushHack == "" && in.PushHackOK {
		in.PushHack = "?"
	}
	in.RemoteScript = root.ok("test -f " + shellQuote(in.UserData+"/Music/Ableton/User Library/Remote Scripts/PushHack/__init__.py"))
	if out, err := root.run(fmt.Sprintf(`python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("version",""), d.get("port",0))' %s 2>/dev/null`,
		shellQuote(ph+"/hacks/pung/hack.json"))); err == nil {
		if f := strings.Fields(out); len(f) == 2 {
			in.Pung = f[0]
			fmt.Sscan(f[1], &in.PungPort)
		}
	}
	in.PungRunning = root.ok("/etc/init.d/push-hack-pung status 2>/dev/null | grep -q active")
	if out, err := root.run(`cat /etc/os-release 2>/dev/null | sed -n 's/^VERSION_ID=//p' | tr -d '"'`); err == nil {
		in.Firmware = strings.TrimSpace(out)
	}
	return in
}
