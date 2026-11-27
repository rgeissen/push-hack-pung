package main

// settings.go: Pung's own settings, a small JSON file in its data folder,
// changed from the web page (GET/POST /api/settings).

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

type settings struct {
	// TouchCard: the large detail card over three columns when an encoder is
	// touched or turned. Move needs it (its whole screen is one small LCD);
	// on the Push every encoder has a 120-pixel column of its own, and the
	// touched one shows the range, the neighbouring options and the fine
	// mode in place (view.go, drawCell). Off unless asked for.
	TouchCard bool `json:"touch_card"`
	// CatalogURL: where the Modules page reads the module catalog; empty:
	// the one that came with Pung (modmgr.go)
	CatalogURL string `json:"catalog_url,omitempty"`
	// OwnPackOnly: only the modules that came with this Pung; pung.live is
	// never asked for a newer pack (modpack.go)
	OwnPackOnly bool `json:"own_pack_only,omitempty"`
}

type settingsStore struct {
	mu   sync.Mutex
	path string
	s    settings
}

func loadSettings(dataDir string) *settingsStore {
	st := &settingsStore{path: filepath.Join(dataDir, "settings.json")}
	if raw, err := os.ReadFile(st.path); err == nil {
		if err := json.Unmarshal(raw, &st.s); err != nil {
			log.Printf("settings: %s: %v (defaults)", st.path, err)
		}
	}
	return st
}

func (st *settingsStore) get() settings {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.s
}

// update applies a partial document (only the fields it names) and saves.
func (st *settingsStore) update(patch []byte) (settings, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	next := st.s
	if err := json.Unmarshal(patch, &next); err != nil {
		return st.s, err
	}
	raw, _ := json.MarshalIndent(next, "", "  ")
	tmp := st.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return st.s, err
	}
	if err := os.Rename(tmp, st.path); err != nil {
		return st.s, err
	}
	st.s = next
	return next, nil
}

func (h *Host) settingsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "settings": h.settings.get()})
	})
	mux.HandleFunc("POST /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var raw json.RawMessage
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&raw) != nil {
			fail(w, 400, "body must be a JSON object of settings")
			return
		}
		// pung.live changes the switches only: where modules come from is
		// decided on the Push's own page (a catalog named there is not signed)
		if siteOrigins[r.Header.Get("Origin")] {
			var got map[string]json.RawMessage
			if json.Unmarshal(raw, &got) != nil {
				fail(w, 400, "body must be a JSON object of settings")
				return
			}
			for k := range got {
				if !siteSettings[k] {
					fail(w, 403, "%s is changed on Pung's own page", k)
					return
				}
			}
		}
		s, err := h.settings.update(raw)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		if h.ui != nil {
			h.ui.redraw()
		}
		writeJSON(w, 200, map[string]any{"ok": true, "settings": s})
	})
}
