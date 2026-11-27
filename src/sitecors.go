package main

// sitecors.go: pung.live's Modules page (site/modules.html) talks to the Pung
// on the visitor's own Push, over their home network, the way Pung's own
// Modules page does: it reads the catalog with what is installed, installs and
// updates modules, and restarts Live once new ones wait for it; its Your Push
// page reads and changes Pung's settings. The browser
// asks the visitor first (Local Network Access, Chrome 142 and Firefox 151 on;
// the page fetches with targetAddressSpace "local"), and lets the page read
// Pung's answers only where Pung says pung.live may: here.
//
// Only those calls, and only for pung.live. Everything else keeps answering
// as before: a page from another site could always send a request to Pung on
// the home network (no answer to read), which is not new; what is new is that
// pung.live may read these few answers.

import (
	"net/http"
	"strings"
)

// sitePort: where pung.live's Modules page looks for Pung first
const sitePort = 7720

// siteOrigins: where the Modules page is served from
var siteOrigins = map[string]bool{"https://pung.live": true, "https://www.pung.live": true}

// siteSettings: the settings pung.live may change (settings.go): switches,
// never an address Pung reads modules from
var siteSettings = map[string]bool{"touch_card": true, "own_pack_only": true}

// siteCall: a call pung.live's Modules page may make
func siteCall(method, path string) bool {
	switch method {
	case http.MethodGet:
		return path == "/api/catalog" || path == "/api/status" || path == "/api/settings" || path == "/api/system"
	case http.MethodPost:
		// the settings: Pung's own switches (Your Push on pung.live)
		if path == "/api/catalog/update-all" || path == "/api/catalog/apply" || path == "/api/settings" {
			return true
		}
		// /api/catalog/{id}/install
		p := strings.Split(strings.TrimPrefix(path, "/api/catalog/"), "/")
		return strings.HasPrefix(path, "/api/catalog/") && len(p) == 2 && p[0] != "" && p[1] == "install"
	}
	return false
}

// withSiteCORS: the answers pung.live may read, and its preflights
func withSiteCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !siteOrigins[origin] {
			next.ServeHTTP(w, r)
			return
		}
		method := r.Method
		pre := method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
		if pre {
			method = r.Header.Get("Access-Control-Request-Method")
		}
		if !siteCall(method, r.URL.Path) {
			if pre {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Add("Vary", "Origin")
		// Chrome's earlier Private Network Access asked for this; harmless where nothing asks
		h.Set("Access-Control-Allow-Private-Network", "true")
		if pre {
			h.Set("Access-Control-Allow-Methods", "GET, POST")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
