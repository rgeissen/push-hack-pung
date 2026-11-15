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
	"fmt"
	"image/png"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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

// selectedDevice: the chain slot of the Pung device selected in Live
// (-1 none), worked out once per selection. One device of that class: that
// one. Several: the one whose parameter values match Live's.
func (h *Host) selectedDevice() (int, string) {
	if h.live == nil || h.prov == nil || !h.live.connected.Load() {
		return -1, ""
	}
	v := h.live.state().view()
	trackName, _ := h.live.state().trackHeader()
	// the answer holds for this selection and these devices: a device made
	// after it was worked out (Live restoring a Set) must not stay "none"
	key := fmt.Sprintf("%s/%v/%s/%d", v.dev.Track, v.path, v.dev.Name, h.prov.gen.Load())
	h.selMu.Lock()
	if key == h.selKey {
		n := h.selDev
		h.selMu.Unlock()
		return n, trackName
	}
	h.selMu.Unlock()
	// the plugin the selection resolved to (liveview.go), whose name is the
	// class's; the selected device may be a rack around it, named otherwise
	name := v.dev.Name
	if len(v.path) > 0 {
		for _, x := range v.devs {
			if x.I == v.path[len(v.path)-1] && x.Class == "PluginDevice" {
				name = x.Name
			}
		}
	}
	n := -1
	var cands []*device
	for _, d := range h.prov.list() {
		if d.c.Name == name {
			cands = append(cands, d)
		}
	}
	switch {
	case len(cands) == 1:
		n = cands[0].s.Index
	case len(cands) > 1 && len(v.path) > 0:
		if data, err := liveCall("device", "params", map[string]any{"track": v.dev.Track, "path": v.path}); err == nil {
			var r struct {
				Params []liveParam `json:"params"`
			}
			if json.Unmarshal(data, &r) == nil {
				best := 1e9
				for _, d := range cands {
					if m := d.matches(r.Params); m < best {
						best, n = m, d.s.Index
					}
				}
			}
		}
	}
	h.selMu.Lock()
	h.selKey, h.selDev, h.selName = key, n, name
	h.selMu.Unlock()
	return n, trackName
}

func (h *Host) deviceFromPath(w http.ResponseWriter, r *http.Request) (*device, bool) {
	n, err := strconv.Atoi(r.PathValue("n"))
	var d *device
	if err == nil && h.prov != nil {
		d = h.prov.device(n)
	}
	if d == nil {
		fail(w, http.StatusNotFound, "no Pung device %s", r.PathValue("n"))
		return nil, false
	}
	return d, true
}

func (h *Host) webRoutes(mux *http.ServeMux) {
	sub, _ := fs.Sub(webFS, "web")
	mux.Handle("GET /", http.FileServer(http.FS(sub)))

	// Pung's devices in Live, and which one Live has selected
	mux.HandleFunc("GET /api/pung-devices", func(w http.ResponseWriter, r *http.Request) {
		sel, track := h.selectedDevice()
		out := []map[string]any{}
		if h.prov != nil {
			for _, d := range h.prov.list() {
				e := map[string]any{"n": d.s.Index, "name": d.c.Name, "module": d.c.module, "kind": d.c.Kind,
					"component": d.c.component(), "selected": d.s.Index == sel}
				if d.s.Index == sel {
					e["track"] = track
				}
				out = append(out, e)
			}
		}
		h.selMu.Lock()
		why := map[string]any{"key": h.selKey, "name": h.selName}
		h.selMu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true, "devices": out, "selected": sel, "resolved": why})
	})
	mux.HandleFunc("GET /api/devices/{n}/component/{comp}", func(w http.ResponseWriter, r *http.Request) {
		if d, ok := h.deviceFromPath(w, r); ok {
			writeJSON(w, 200, map[string]any{"ok": true, "info": h.componentInfo(d.s, r.PathValue("comp"))})
		}
	})
	mux.HandleFunc("GET /api/devices/{n}/component/{comp}/values", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return
		}
		comp := r.PathValue("comp")
		var cp []map[string]any
		if raw, ok := d.s.Meta(comp, "chain_params"); ok && raw != "" {
			json.Unmarshal([]byte(raw), &cp)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "values": h.componentValues(d.s, comp, cp)})
	})
	// a device's compartments (DESIGN-v2, "Design principles"): the same
	// screens the Push shows, and which one it shows now
	mux.HandleFunc("GET /api/devices/{n}/compartments", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return
		}
		if h.ui == nil {
			writeJSON(w, 200, map[string]any{"ok": true, "compartments": []compartmentInfo{}, "shown": ""})
			return
		}
		comps, shown := h.ui.compartmentsOf(d.c.module)
		if comps == nil {
			comps = []compartmentInfo{}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "compartments": comps, "shown": shown})
	})
	// a compartment's custom screen, as the Push draws it, from this device's values
	mux.HandleFunc("GET /api/devices/{n}/compartments/{id}/screen.png", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok || h.ui == nil {
			return
		}
		comp := d.c.component()
		img, err := h.ui.compartmentScreen(d.c.module, r.PathValue("id"), func(k string) (string, bool) {
			return d.s.Get(comp + ":" + k)
		})
		if err != nil {
			fail(w, 404, "%s", err)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-store")
		png.Encode(w, img) //nolint:errcheck
	})
	// the web page picked a compartment: the Push turns to it, if it shows this device's module
	mux.HandleFunc("POST /api/devices/{n}/compartment", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body) != nil || body.ID == "" {
			fail(w, 400, "body must be {\"id\":...}")
			return
		}
		shown := h.ui != nil && h.ui.showCompartment(d.c.module, body.ID)
		writeJSON(w, 200, map[string]any{"ok": true, "shown": shown})
	})
	mux.HandleFunc("GET /api/devices/{n}/param", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return
		}
		k := r.URL.Query().Get("key")
		if v, ok := d.s.Get(k); ok {
			writeJSON(w, 200, map[string]any{"ok": true, "key": k, "value": v})
		} else {
			writeJSON(w, 200, map[string]any{"ok": true, "key": k, "value": nil})
		}
	})
	// a change from the web page: into the chain, and on to Live (SetOutside)
	mux.HandleFunc("POST /api/devices/{n}/param", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body) != nil || body.Key == "" {
			fail(w, 400, "body must be {\"key\":...,\"value\":...}")
			return
		}
		d.SetOutside(body.Key, body.Value)
		writeJSON(w, 200, map[string]any{"ok": true})
	})

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
