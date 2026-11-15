package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type settings struct {
	Overrides   map[string]override `json:"overrides"`    // module id -> where its source comes from
	NightlyAt   int                 `json:"nightly_at"`   // hour (0-23, the container's time); -1: off
	LastNightly string              `json:"last_nightly"` // the day it last ran
	Withheld    map[string]string   `json:"withheld"`     // id -> why build-catalog.py held it back
}

type server struct {
	cfg     config
	auth    *auth
	up      *upstream
	builder *builder

	mu    sync.Mutex
	set   settings
	pubMu sync.Mutex
}

func newServer(c config) *server {
	s := &server{cfg: c, auth: newAuth(c.Data)}
	s.set = settings{NightlyAt: 3, Overrides: map[string]override{
		// rgeissen's fork, branch remote-ui: the JP-8000 front panel as the
		// module's web page, not upstream yet (scripts/local-sources.json)
		"jp8000": {Repo: "rgeissen/schwung-je8086", Branch: "remote-ui", Why: "the JP-8000 front panel as its web page, not upstream yet"},
	}, Withheld: map[string]string{}}
	if raw, err := os.ReadFile(filepath.Join(c.Data, "settings.json")); err == nil {
		json.Unmarshal(raw, &s.set) //nolint:errcheck
	}
	if s.set.Withheld == nil {
		s.set.Withheld = map[string]string{}
	}
	s.up = &upstream{s: s, vers: map[string]string{}}
	s.builder = newBuilder(s)
	return s
}

func (s *server) saveSettings() {
	raw, _ := json.MarshalIndent(s.set, "", " ")
	writeAtomic(filepath.Join(s.cfg.Data, "settings.json"), raw) //nolint:errcheck
}

func (s *server) sourceOf(m schwungModule) (repo, branch string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if o, ok := s.set.Overrides[m.ID]; ok && o.Repo != "" {
		return o.Repo, firstNonEmpty(o.Branch, "main")
	}
	return m.GithubRepo, firstNonEmpty(m.DefaultBranch, "main")
}

func (s *server) withheld() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]string{}
	for k, v := range s.set.Withheld {
		out[k] = v
	}
	return out
}

func (s *server) setWithheld(id, why string) {
	s.mu.Lock()
	if why == "" {
		delete(s.set.Withheld, id)
	} else {
		s.set.Withheld[id] = why
	}
	s.saveSettings()
	s.mu.Unlock()
}

func (s *server) stagingCatalog() string {
	return filepath.Join(s.cfg.Data, "work", "catalog", "catalog.json")
}

// seedStaging: staging starts as a copy of what is live.
func (s *server) seedStaging() {
	if _, err := os.Stat(s.stagingCatalog()); err == nil {
		return
	}
	if raw, err := os.ReadFile(filepath.Join(s.cfg.Site, "catalog.json")); err == nil {
		writeAtomic(s.stagingCatalog(), raw) //nolint:errcheck
	}
}

// discard: staging is what is live again.
func (s *server) discard() error {
	raw, err := os.ReadFile(filepath.Join(s.cfg.Site, "catalog.json"))
	if err != nil {
		return err
	}
	return writeAtomic(s.stagingCatalog(), raw)
}

// scheduler: every night, check Schwung and build what is new or updated
// into staging. Nothing is published without the admin.
func (s *server) scheduler() {
	s.seedStaging()
	go func() {
		if err := s.up.check(); err != nil {
			log.Printf("pung-catalog: upstream: %v", err)
		}
	}()
	t := time.NewTicker(time.Minute)
	for range t.C {
		s.mu.Lock()
		at, last := s.set.NightlyAt, s.set.LastNightly
		s.mu.Unlock()
		now := time.Now()
		if at < 0 || now.Hour() != at || last == now.Format("2006-01-02") {
			continue
		}
		s.mu.Lock()
		s.set.LastNightly = now.Format("2006-01-02")
		s.saveSettings()
		s.mu.Unlock()
		n := s.buildChanges("nightly")
		log.Printf("pung-catalog: nightly: %d module(s) to build", n)
	}
}

// buildChanges: every new and updated module into the queue.
func (s *server) buildChanges(reason string) int {
	if err := s.up.check(); err != nil {
		return 0
	}
	n := 0
	for _, r := range s.up.rows() {
		if r.Status == "new" || r.Status == "update" {
			if s.builder.enqueue(r.ID, reason) {
				n++
			}
		}
	}
	return n
}

// ---- HTTP ---------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func fail(w http.ResponseWriter, code int, f string, a ...any) {
	writeJSON(w, code, map[string]any{"ok": false, "error": fmt.Sprintf(f, a...)})
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<16)).Decode(v)
}

// guard: security headers everywhere; the API needs a session, and a change
// needs the X-Pung-Admin header too.
func (s *server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		if isHTTPS(r) {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		p := r.URL.Path
		if strings.HasPrefix(p, "/api/") {
			if r.Method != http.MethodGet && r.Header.Get(csrfHeader) != "1" {
				fail(w, 403, "missing %s header", csrfHeader)
				return
			}
			open := p == "/api/session" || p == "/api/login" || p == "/api/setup"
			if !open && !s.auth.valid(sessionOf(r)) {
				fail(w, 401, "sign in first")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/session", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "signed_in": s.auth.valid(sessionOf(r)), "setup": s.auth.needsSetup()})
	})
	mux.HandleFunc("POST /api/setup", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Code, User, Password string }
		if readJSON(r, &b) != nil {
			fail(w, 400, "bad request")
			return
		}
		if err := s.auth.createAccount(b.Code, b.User, b.Password); err != nil {
			fail(w, 400, "%v", err)
			return
		}
		tok, err := s.auth.login(clientIP(r), b.User, b.Password)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		setSession(w, r, tok)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ User, Password string }
		if readJSON(r, &b) != nil {
			fail(w, 400, "bad request")
			return
		}
		tok, err := s.auth.login(clientIP(r), b.User, b.Password)
		if err != nil {
			fail(w, 401, "%v", err)
			return
		}
		setSession(w, r, tok)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		s.auth.logout(sessionOf(r))
		clearSession(w, r)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/password", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Old, New string }
		if readJSON(r, &b) != nil {
			fail(w, 400, "bad request")
			return
		}
		if err := s.auth.changePassword(b.Old, b.New); err != nil {
			fail(w, 400, "%v", err)
			return
		}
		clearSession(w, r)
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/overview", func(w http.ResponseWriter, r *http.Request) {
		live, _, _ := readCatalog(filepath.Join(s.cfg.Site, "catalog.json"))
		var liveAt string
		if st, err := os.Stat(filepath.Join(s.cfg.Site, "catalog.json")); err == nil {
			liveAt = st.ModTime().Format(time.RFC3339)
		}
		s.mu.Lock()
		nightly := s.set.NightlyAt
		overrides := s.set.Overrides
		s.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true, "upstream": s.up.status(), "rows": orEmpty(s.up.rows()),
			"builder": s.builder.state(), "diff": s.diff(), "history": orEmpty(s.history()),
			"live":     map[string]any{"modules": len(live), "at": liveAt, "url": s.cfg.BaseURL},
			"settings": map[string]any{"nightly_at": nightly, "overrides": overrides}})
	})
	mux.HandleFunc("POST /api/check", func(w http.ResponseWriter, r *http.Request) {
		if err := s.up.check(); err != nil {
			fail(w, 502, "Schwung's catalogue: %v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/build", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			IDs     []string `json:"ids"`
			Changes bool     `json:"changes"`
		}
		if readJSON(r, &b) != nil {
			fail(w, 400, "bad request")
			return
		}
		n := 0
		if b.Changes {
			n = s.buildChanges("admin")
		}
		for _, id := range b.IDs {
			if _, ok := s.up.module(id); ok && s.builder.enqueue(id, "admin") {
				n++
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "queued": n})
	})
	mux.HandleFunc("POST /api/cancel/{id}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": s.builder.cancel(r.PathValue("id"))})
	})
	mux.HandleFunc("GET /api/log/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := filepath.Base(r.PathValue("id"))
		writeJSON(w, 200, map[string]any{"ok": true, "job": s.builder.logTail(id, "job", 64<<10),
			"build": s.builder.logTail(id, "build", 64<<10)})
	})
	mux.HandleFunc("POST /api/publish", func(w http.ResponseWriter, r *http.Request) {
		stamp, err := s.publish()
		if err != nil {
			fail(w, 500, "%v", err)
			return
		}
		log.Printf("pung-catalog: published (the previous catalog is history/%s.json)", stamp)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/discard", func(w http.ResponseWriter, r *http.Request) {
		if err := s.discard(); err != nil {
			fail(w, 500, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/restore/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.restore(r.PathValue("name")); err != nil {
			fail(w, 409, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			NightlyAt *int                `json:"nightly_at"`
			Overrides map[string]override `json:"overrides"`
		}
		if readJSON(r, &b) != nil {
			fail(w, 400, "bad request")
			return
		}
		s.mu.Lock()
		if b.NightlyAt != nil && *b.NightlyAt >= -1 && *b.NightlyAt <= 23 {
			s.set.NightlyAt = *b.NightlyAt
		}
		if b.Overrides != nil {
			clean := map[string]override{}
			for id, o := range b.Overrides {
				o.Repo = strings.Trim(strings.TrimPrefix(strings.TrimSpace(o.Repo), "https://github.com/"), "/ ")
				o.Repo = strings.TrimSuffix(o.Repo, ".git")
				if id != "" && strings.Count(o.Repo, "/") == 1 {
					clean[id] = o
				}
			}
			s.set.Overrides = clean
		}
		s.saveSettings()
		s.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true})
	})
}
