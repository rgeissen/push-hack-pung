package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetupAndLogin(t *testing.T) {
	a := newAuth(t.TempDir())
	if !a.needsSetup() || a.setup == "" {
		t.Fatal("a new service has no setup code")
	}
	if err := a.createAccount("wrong", "admin", "a long password here"); err == nil {
		t.Fatal("an account without the setup code")
	}
	if err := a.createAccount(a.setup, "admin", "short"); err == nil {
		t.Fatal("a short password")
	}
	if err := a.createAccount(a.setup, "admin", "a long password here"); err != nil {
		t.Fatal(err)
	}
	if err := a.createAccount("", "x", "another long password"); err == nil {
		t.Fatal("a second account")
	}
	raw, _ := os.ReadFile(filepath.Join(a.dir, "admin.json"))
	if strings.Contains(string(raw), "a long password here") {
		t.Fatal("the password is stored as text")
	}
	tok, err := a.login("1.2.3.4", "admin", "a long password here")
	if err != nil || !a.valid(tok) {
		t.Fatalf("login: %v", err)
	}
	a.logout(tok)
	if a.valid(tok) {
		t.Fatal("a session outlived its logout")
	}
}

func TestLockout(t *testing.T) {
	a := newAuth(t.TempDir())
	a.createAccount(a.setup, "admin", "a long password here") //nolint:errcheck
	for i := 0; i < maxFailures; i++ {
		a.mu.Lock()
		a.fails["9.9.9.9"] = append(a.fails["9.9.9.9"], timeNow())
		a.mu.Unlock()
	}
	if _, err := a.login("9.9.9.9", "admin", "a long password here"); err == nil {
		t.Fatal("a locked-out address signed in")
	}
	if _, err := a.login("8.8.8.8", "admin", "a long password here"); err != nil {
		t.Fatalf("another address: %v", err)
	}
}

func TestGuard(t *testing.T) {
	dir := t.TempDir()
	s := newServer(config{Data: dir, Site: t.TempDir(), App: dir})
	mux := http.NewServeMux()
	s.routes(mux)
	h := s.guard(mux)
	do := func(method, path, header string, cookie string) int {
		r := httptest.NewRequest(method, path, strings.NewReader("{}"))
		if header != "" {
			r.Header.Set(csrfHeader, header)
		}
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Header().Get("Content-Security-Policy") == "" {
			t.Errorf("%s %s: no CSP", method, path)
		}
		return w.Code
	}
	if c := do("GET", "/api/overview", "", ""); c != 401 {
		t.Errorf("overview without a session: %d", c)
	}
	if c := do("POST", "/api/publish", "", ""); c != 403 {
		t.Errorf("a change without the header: %d", c)
	}
	s.auth.createAccount(s.auth.setup, "admin", "a long password here") //nolint:errcheck
	tok, _ := s.auth.login("1.1.1.1", "admin", "a long password here")
	if c := do("POST", "/api/discard", "", tok); c != 403 {
		t.Errorf("a signed-in change without the header: %d", c)
	}
	if c := do("GET", "/api/session", "", ""); c != 200 {
		t.Errorf("session state: %d", c)
	}
}

// A package whose bytes are not the catalog's is never published.
func TestPublishChecksPackages(t *testing.T) {
	data, site, app := t.TempDir(), t.TempDir(), t.TempDir()
	os.MkdirAll(filepath.Join(app, "scripts", "catalog-site"), 0o755)
	for _, f := range []string{"index.html", "site.css", "site.js"} {
		os.WriteFile(filepath.Join(app, "scripts", "catalog-site", f), []byte(f), 0o644)
	}
	s := newServer(config{Data: data, Site: site, App: app})
	stage := filepath.Dir(s.stagingCatalog())
	os.MkdirAll(filepath.Join(stage, "modules"), 0o755)
	os.WriteFile(filepath.Join(stage, "modules", "x.tar.gz"), []byte("package"), 0o644)
	sum := sha256.Sum256([]byte("package"))
	good := `{"modules":[{"id":"x","name":"X","version":"1","asset":"modules/x.tar.gz","sha256":"` + hex.EncodeToString(sum[:]) + `","source":{}}]}`
	os.WriteFile(s.stagingCatalog(), []byte(good), 0o644)
	if _, err := s.publish(); err != nil {
		t.Fatalf("a good publish: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(site, "catalog.json")); string(b) != good {
		t.Fatal("catalog.json not published")
	}
	bad := strings.Replace(good, hex.EncodeToString(sum[:]), strings.Repeat("0", 64), 1)
	os.WriteFile(s.stagingCatalog(), []byte(bad), 0o644)
	if _, err := s.publish(); err == nil {
		t.Fatal("a package with the wrong checksum was published")
	}
	if b, _ := os.ReadFile(filepath.Join(site, "catalog.json")); string(b) != good {
		t.Fatal("a failed publish changed the site's catalog")
	}
	if len(s.history()) != 0 {
		t.Fatalf("the first publish replaced nothing, yet history has %+v", s.history())
	}
	os.WriteFile(s.stagingCatalog(), []byte(good), 0o644)
	if _, err := s.publish(); err != nil || len(s.history()) != 1 {
		t.Fatalf("a second publish keeps the first: %v %+v", err, s.history())
	}
}

func TestVersionLess(t *testing.T) {
	if !versionLess("0.9", "0.10") || versionLess("1.0.1", "1.0") || !versionLess("v0.5.3", "0.6.0") {
		t.Fatal("version order")
	}
}

func TestStampVersion(t *testing.T) {
	tree := t.TempDir()
	os.MkdirAll(filepath.Join(tree, "audio_fx", "x"), 0o755)
	os.WriteFile(filepath.Join(tree, "audio_fx", "x", "module.json"), []byte(`{"id":"x","version":"1.4.3","name":"X"}`), 0o644)
	old, err := stampVersion(tree, "x", "1.4.5")
	raw, _ := os.ReadFile(filepath.Join(tree, "audio_fx", "x", "module.json"))
	if err != nil || old != "1.4.3" || !strings.Contains(string(raw), `"1.4.5"`) || !strings.Contains(string(raw), `"name": "X"`) {
		t.Fatalf("%q %v %s", old, err, raw)
	}
}

// A build shares the DiskStation: lowest CPU priority, idle I/O, and the job
// count in every variable a recipe, make or CMake reads.
func TestGentleBuildStep(t *testing.T) {
	b := &builder{s: &server{cfg: config{BuildJobs: 2}}}
	cmd := b.gentle(t.Context(), []string{"X=1"}, "true", "a")
	want := []string{"true", "a"}
	if p, err := exec.LookPath("ionice"); err == nil {
		want = append([]string{p, "-c3"}, want...)
	}
	if p, err := exec.LookPath("nice"); err == nil {
		want = append([]string{p, "-n", "19"}, want...)
	}
	if strings.Join(cmd.Args, " ") != strings.Join(want, " ") {
		t.Fatalf("args %q, want %q", cmd.Args, want)
	}
	env := strings.Join(cmd.Env, "\n")
	for _, kv := range []string{"BUILD_JOBS=2", "MAKEFLAGS=-j2", "CMAKE_BUILD_PARALLEL_LEVEL=2", "X=1"} {
		if !strings.Contains(env, "\n"+kv+"\n") && !strings.HasSuffix(env, "\n"+kv) {
			t.Fatalf("%s missing from the environment", kv)
		}
	}
	if err := cmd.Run(); err != nil {
		t.Fatalf("the wrapped step does not run: %v", err)
	}
}
