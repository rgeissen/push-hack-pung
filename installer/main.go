// The Pung Installer: puts Pung on an Ableton Push 3 Standalone from a
// computer (macOS, Windows, Linux), with Push Hack under it where the Push has
// none yet. One program; its window is a page it serves to this computer
// alone (127.0.0.1, a random port and key) and opens in the browser.
//
//	pung-installer [-addr push.local] [-no-browser]
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

var version = "0.1.0" // set at build (-ldflags -X main.version=)

//go:embed ui
var uiFS embed.FS

// ---- the installer's state, as the page shows it ------------------------------------------

type step struct {
	Text  string `json:"text"`
	State string `json:"state"` // doing | done | failed
}

type state struct {
	mu sync.Mutex

	Version  string   `json:"version"`
	Manifest manifest `json:"manifest"`
	Online   bool     `json:"online"` // pung.live answered
	Latest   *release `json:"latest"`

	Addr           string    `json:"addr"`
	Phase          string    `json:"phase"` // find | finding | key | waiting | inspecting | ready | installing | done | failed
	Error          string    `json:"error"`
	ErrorWhy       string    `json:"error_why"` // unreachable | host-changed | ...
	PubKey         string    `json:"pubkey"`
	KeyName        string    `json:"key_name"`
	Push           *pushInfo `json:"push"`
	Steps          []step    `json:"steps"`
	DLDone         int64     `json:"dl_done"`
	DLTotal        int64     `json:"dl_total"`
	Did            []string  `json:"did"` // what the last install did: push-hack, pung
	LiveRestarting bool      `json:"live_restarting"`

	signer ssh.Signer
	done   atomic.Int64
	total  atomic.Int64
}

var st = &state{Version: version, Phase: "find", Addr: "push.local"}

func (s *state) set(f func()) { s.mu.Lock(); f(); s.mu.Unlock() }

func (s *state) say(text string) {
	s.set(func() {
		for i := range s.Steps {
			if s.Steps[i].State == "doing" {
				s.Steps[i].State = "done"
			}
		}
		s.Steps = append(s.Steps, step{Text: text, State: "doing"})
	})
}

func (s *state) fail(why, msg string) {
	s.set(func() {
		for i := range s.Steps {
			if s.Steps[i].State == "doing" {
				s.Steps[i].State = "failed"
			}
		}
		s.Error, s.ErrorWhy = msg, why
	})
}

// ---- the steps ----------------------------------------------------------------------------

func normAddr(a string) string {
	a = strings.TrimSpace(a)
	a = strings.TrimPrefix(strings.TrimPrefix(a, "http://"), "https://")
	if i := strings.IndexAny(a, "/"); i >= 0 {
		a = a[:i]
	}
	if h, _, err := net.SplitHostPort(a); err == nil {
		a = h
	}
	a = strings.Trim(a, "[]")
	if a == "" {
		a = "push.local"
	}
	return a
}

// find: the Push answers on SSH; then a key of this computer it lets in, or the key step
func find(addr string) {
	st.set(func() {
		st.Addr, st.Phase, st.Error, st.ErrorWhy, st.Push, st.Steps = addr, "finding", "", "", nil, nil
	})
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(addr, "22"), 6*time.Second)
	if err != nil {
		st.set(func() {
			st.Phase, st.ErrorWhy = "find", "unreachable"
			st.Error = fmt.Sprintf("No Push answers at %s. Is it on, on the same network as this computer?", addr)
		})
		return
	}
	conn.Close()
	for _, k := range candidateKeys() {
		sg, err := loadSigner(k)
		if err != nil {
			continue
		}
		c, err := dial(addr, "root", sg)
		if errors.Is(err, errHostChanged) {
			st.set(func() {
				st.Phase, st.ErrorWhy = "find", "host-changed"
				st.Error = "This Push answers with another identity than when this computer last talked to it (a Push that was reset does). If you trust it, forget the old one and find it again."
			})
			return
		}
		if err != nil {
			continue
		}
		name := k[strings.LastIndexAny(k, `/\`)+1:]
		st.set(func() { st.signer, st.KeyName = sg, name })
		inspectNow(c)
		c.Close()
		return
	}
	pub, err := ensurePungKey()
	if err != nil {
		st.set(func() { st.Phase, st.Error = "find", "This computer's key could not be made: "+err.Error() })
		return
	}
	st.set(func() { st.Phase, st.PubKey = "key", pub })
}

func inspectNow(c *client) {
	st.set(func() { st.Phase = "inspecting" })
	in := inspect(c, st.Addr)
	st.set(func() { st.Push, st.Phase = &in, "ready" })
}

// waitKey: the Push lets Pung's key in once the user added it and confirmed on the Push
func waitKey() {
	st.set(func() { st.Phase, st.Error = "waiting", "" })
	sg, err := loadSigner(pungKey())
	if err != nil {
		st.set(func() { st.Phase, st.Error = "key", err.Error() })
		return
	}
	deadline := time.Now().Add(10 * time.Minute)
	for time.Now().Before(deadline) {
		if st.phase() != "waiting" {
			return // the user went back
		}
		if c, err := dial(st.addr(), "root", sg); err == nil {
			st.set(func() { st.signer, st.KeyName = sg, "pung_id_rsa" })
			inspectNow(c)
			c.Close()
			return
		}
		time.Sleep(2 * time.Second)
	}
	st.set(func() {
		st.Phase, st.Error = "key", "The Push did not let this computer in within 10 minutes. Add the key again and confirm on the Push."
	})
}

func (s *state) phase() string { s.mu.Lock(); defer s.mu.Unlock(); return s.Phase }
func (s *state) addr() string  { s.mu.Lock(); defer s.mu.Unlock(); return s.Addr }

// install: Push Hack where it is missing, then Pung
func install() {
	st.set(func() {
		st.Phase, st.Error, st.ErrorWhy, st.Steps, st.Did, st.DLDone, st.DLTotal = "installing", "", "", nil, nil, 0, 0
	})
	st.done.Store(0)
	st.total.Store(0)
	sg, addr, m := st.signer, st.addr(), st.Manifest
	root, err := dial(addr, "root", sg)
	if err != nil {
		st.fail("unreachable", "The Push stopped answering: "+err.Error())
		st.set(func() { st.Phase = "failed" })
		return
	}
	defer root.Close()
	in := inspect(root, addr)
	if !in.PushHackOK || !in.RemoteScript {
		st.say("Installing Push Hack " + m.PushHack.Version)
		ab, err := dial(addr, "ableton", sg)
		if err == nil {
			err = installPushHack(ab, root, m.PushHack.Ref, st.say)
			ab.Close()
		}
		if err != nil {
			st.fail("push-hack", "Push Hack could not be installed: "+err.Error())
			st.set(func() { st.Phase = "failed" })
			return
		}
		st.set(func() { st.Did = append(st.Did, "push-hack") })
	}
	st.say("Finding the newest Pung")
	rel, err := latestPung(m)
	if err != nil {
		st.fail("release", "The newest Pung could not be found: "+err.Error())
		st.set(func() { st.Phase = "failed" })
		return
	}
	st.set(func() { st.Latest = &rel })
	stop := make(chan bool)
	go func() { // the download's progress, for the page
		for {
			select {
			case <-stop:
				return
			case <-time.After(250 * time.Millisecond):
				st.set(func() { st.DLDone, st.DLTotal = st.done.Load(), st.total.Load() })
			}
		}
	}()
	err = installPung(root, rel, &st.done, &st.total, st.say)
	close(stop)
	st.set(func() { st.DLDone, st.DLTotal = st.done.Load(), st.total.Load() })
	if err != nil {
		st.fail("pung", "Pung could not be installed: "+err.Error())
		st.set(func() { st.Phase = "failed" })
		return
	}
	in = inspect(root, addr)
	st.say("Pung " + rel.Version + " runs on your Push")
	st.set(func() {
		for i := range st.Steps {
			st.Steps[i].State = "done"
		}
		st.Push, st.Phase, st.Did = &in, "done", append(st.Did, "pung")
	})
}

// ---- the page and its calls -----------------------------------------------------------------

var token string
var lastSeen atomic.Int64 // the page's last word; the installer ends a minute after the page is gone

func api(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Pung-Key") != token {
		http.Error(w, "no", 403)
		return
	}
	lastSeen.Store(time.Now().Unix())
	var body struct {
		Addr string `json:"addr"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	busy := func() bool { p := st.phase(); return p == "installing" || p == "finding" || p == "inspecting" }
	switch r.URL.Path {
	case "/api/state":
	case "/api/find":
		if !busy() {
			go find(normAddr(body.Addr))
		}
	case "/api/forget":
		forgetHost(st.addr())
		if !busy() {
			go find(st.addr())
		}
	case "/api/wait-key":
		if st.phase() == "key" {
			go waitKey()
		}
	case "/api/back":
		if !busy() {
			st.set(func() { st.Phase, st.Error = "find", "" })
		}
	case "/api/install":
		if st.phase() == "ready" || st.phase() == "failed" || st.phase() == "done" {
			go install()
		}
	case "/api/recheck":
		if !busy() && st.signer != nil {
			go func() {
				if c, err := dial(st.addr(), "root", st.signer); err == nil {
					// it answers again: what the last try said is no longer true (the page
					// showed "ready" under the old error, 2026-11-27)
					st.set(func() {
						if st.Phase == "failed" {
							st.Steps, st.Did = nil, nil
						}
						st.Error, st.ErrorWhy = "", ""
					})
					inspectNow(c)
					c.Close()
				}
			}()
		}
	case "/api/restart-live":
		st.set(func() { st.LiveRestarting = true })
		go func() {
			if c, err := dial(st.addr(), "root", st.signer); err == nil {
				if err := restartLive(c); err != nil {
					st.set(func() { st.Error = "Live could not be restarted: " + err.Error() })
				}
				c.Close()
			}
		}()
	case "/api/quit":
		go func() { time.Sleep(300 * time.Millisecond); os.Exit(0) }()
	default:
		http.NotFound(w, r)
		return
	}
	st.mu.Lock()
	b, _ := json.Marshal(st)
	st.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func openBrowser(u string) {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", u)
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		c = exec.Command("xdg-open", u)
	}
	_ = c.Start()
}

func main() {
	addr := flag.String("addr", "push.local", "the Push's address")
	noBrowser := flag.Bool("no-browser", false, "print the page's address instead of opening it")
	listen := flag.String("listen", "127.0.0.1:0", "where the page is served (this computer only)")
	flag.Parse()
	st.Addr = normAddr(*addr)

	b := make([]byte, 16)
	_, _ = rand.Read(b)
	token = hex.EncodeToString(b)

	go func() {
		m, ok := loadManifest()
		st.set(func() { st.Manifest, st.Online = m, ok })
		if rel, err := latestPung(m); err == nil {
			st.set(func() { st.Latest = &rel })
		}
	}()
	st.Manifest = defaultManifest()

	ui, _ := fs.Sub(uiFS, "ui")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", api)
	mux.Handle("/", http.FileServer(http.FS(ui)))
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatal(err)
	}
	u := fmt.Sprintf("http://%s/#%s", ln.Addr(), token)
	fmt.Printf("Pung Installer %s\n  %s\n(close the page and this window when done)\n", version, u)
	if !*noBrowser {
		openBrowser(u)
	}
	lastSeen.Store(time.Now().Unix())
	go func() { // the page gone for a minute, and nothing running: done
		for range time.Tick(5 * time.Second) {
			if time.Now().Unix()-lastSeen.Load() > 60 && st.phase() != "installing" && !*noBrowser {
				os.Exit(0)
			}
		}
	}()
	log.Fatal(http.Serve(ln, mux))
}
