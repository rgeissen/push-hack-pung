package main

// web.go: the browser page (push.local:<port>), and the bridge that lets a
// module's own web_ui.html run here unchanged.
//
// A Schwung module's web_ui.html includes /static/schwung-remote-api.js
// (vendored here from schwung-manager, unmodified) and talks postMessage to
// its parent page. web/app.js is that parent: it answers getParam, setParam,
// subscribe, getHierarchy, getChainParams and resubscribe exactly as
// schwung-manager's remote-ui.js does, so a module cannot tell the two apart.

import (
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed web
var webFS embed.FS

// componentInfo is everything a panel needs about one chain position.
func (h *Host) componentInfo(s *Slot, comp string) map[string]any {
	module := ""
	switch {
	case comp == "synth":
		module, _ = s.Get("synth_module")
	case strings.HasPrefix(comp, "midi_fx"):
		module, _ = s.Get(comp + "_module")
	case strings.HasPrefix(comp, "fx"):
		module, _ = s.Get(comp + "_module")
	}
	out := map[string]any{"component": comp, "module": module}
	if module == "" {
		return out
	}
	var cp []map[string]any
	if raw, ok := s.Meta(comp, "chain_params"); ok && raw != "" {
		json.Unmarshal([]byte(raw), &cp)
	}
	var hier any
	if raw, ok := s.Meta(comp, "ui_hierarchy"); ok && raw != "" {
		json.Unmarshal([]byte(raw), &hier)
	}
	out["chain_params"] = cp
	out["hierarchy"] = hier
	out["values"] = h.componentValues(s, comp, cp)
	out["bypassed"] = s.bypassed(comp) == 1
	if m, ok := findModule(h.modulesDir, module); ok {
		out["name"] = m.Name
		out["web_ui"] = m.WebUI
		out["type"] = m.Type
	}
	return out
}

func (h *Host) componentValues(s *Slot, comp string, cp []map[string]any) map[string]any {
	vals := map[string]any{}
	for _, p := range cp {
		k, _ := p["key"].(string)
		if k == "" {
			continue
		}
		if v, ok := s.Get(comp + ":" + k); ok {
			vals[comp+":"+k] = v
		}
	}
	return vals
}

func (h *Host) webRoutes(mux *http.ServeMux) {
	sub, _ := fs.Sub(webFS, "web")
	mux.Handle("GET /", http.FileServer(http.FS(sub)))

	mux.HandleFunc("GET /api/slots/{n}/component/{comp}", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "info": h.componentInfo(s, r.PathValue("comp"))})
	})

	// values only, for the page's refresh: every chain_params key of a component
	mux.HandleFunc("GET /api/slots/{n}/component/{comp}/values", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		comp := r.PathValue("comp")
		var cp []map[string]any
		if raw, ok := s.Meta(comp, "chain_params"); ok && raw != "" {
			json.Unmarshal([]byte(raw), &cp)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "values": h.componentValues(s, comp, cp)})
	})

	// a module's own files (web_ui.html and what it loads), never its DSP
	mux.HandleFunc("GET /modules/{id}/{file...}", func(w http.ResponseWriter, r *http.Request) {
		m, ok := findModule(h.modulesDir, r.PathValue("id"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		rel := filepath.Clean("/" + r.PathValue("file"))[1:]
		if rel == "" || strings.HasSuffix(rel, ".so") {
			http.NotFound(w, r)
			return
		}
		p := filepath.Join(m.Dir, rel)
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, p)
	})
}
