package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// pung.live reads the catalog and installs; nothing else, and no other site
func TestSiteCORS(t *testing.T) {
	mux := http.NewServeMux()
	ok := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }
	mux.HandleFunc("GET /api/catalog", ok)
	mux.HandleFunc("POST /api/catalog/{id}/install", ok)
	mux.HandleFunc("POST /api/catalog/{id}/remove", ok)
	mux.HandleFunc("POST /api/devices/{n}/param", ok)
	h := withSiteCORS(mux)
	do := func(method, path, origin, preflight string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if preflight != "" {
			r.Header.Set("Access-Control-Request-Method", preflight)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	acao := func(w *httptest.ResponseRecorder) string { return w.Header().Get("Access-Control-Allow-Origin") }

	if w := do("GET", "/api/catalog", "https://pung.live", ""); w.Code != 200 || acao(w) != "https://pung.live" {
		t.Errorf("catalog from pung.live: %d %q", w.Code, acao(w))
	}
	if w := do("OPTIONS", "/api/catalog/jp8000/install", "https://www.pung.live", "POST"); w.Code != 204 || acao(w) != "https://www.pung.live" {
		t.Errorf("install preflight: %d %q", w.Code, acao(w))
	}
	// the Stacks page: what plays, the stack of one device, sending and removing one
	for _, c := range [][2]string{{"GET", "/api/stacks"}, {"GET", "/api/stacks/playing/3"}, {"POST", "/api/stacks"}, {"POST", "/api/stacks/remove"}} {
		if !siteCall(c[0], c[1]) {
			t.Errorf("pung.live may not %s %s", c[0], c[1])
		}
	}
	for _, c := range [][2]string{{"GET", "/api/stacks/playing/"}, {"GET", "/api/stacks/playing/3/x"}, {"GET", "/api/stacks/kept"}, {"POST", "/api/stacks/playing/3"}} {
		if siteCall(c[0], c[1]) {
			t.Errorf("pung.live may %s %s", c[0], c[1])
		}
	}
	if w := do("POST", "/api/catalog/jp8000/install", "https://pung.live", ""); w.Code != 200 || acao(w) == "" {
		t.Errorf("install: %d %q", w.Code, acao(w))
	}
	if w := do("OPTIONS", "/api/settings", "https://pung.live", "POST"); w.Code != 204 {
		t.Errorf("settings preflight: %d", w.Code)
	}
	// not for pung.live: no answer to read, no preflight
	if w := do("OPTIONS", "/api/catalog/jp8000/remove", "https://pung.live", "POST"); w.Code != 403 {
		t.Errorf("remove preflight: %d", w.Code)
	}
	if w := do("POST", "/api/devices/1/param", "https://pung.live", ""); acao(w) != "" {
		t.Errorf("param: readable by pung.live")
	}
	if w := do("GET", "/api/catalog/x/y/install", "https://pung.live", ""); acao(w) != "" {
		t.Errorf("odd path: readable by pung.live")
	}
	// another site: as before, nothing readable
	if w := do("GET", "/api/catalog", "https://evil.example", ""); acao(w) != "" {
		t.Errorf("catalog readable by another site")
	}
	// Pung's own page (same origin, no Origin header on a GET): as before
	if w := do("GET", "/api/catalog", "", ""); w.Code != 200 || acao(w) != "" {
		t.Errorf("own page: %d %q", w.Code, acao(w))
	}
}
