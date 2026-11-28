package main

// setstack.go: GET /api/stack, the stack of the open project: every Pung
// device with its module, version and state and what those need, and where
// the host says it sits (docs/PUNG-STACK.md: a stack is a container of
// modules, one for each project).
//
// What a project uses is Pung's own to know, in any host: its devices, as
// they are connected. Where each one sits is the host's: in Live, asked
// through the Remote Script (the track, and the device's path on it). That
// part is named for its host ("live"); another host leaves it out.
//
// A device's own part is the patch stacks.go makes of it. Nothing here
// changes a project: Pung never reads or writes a host's file.

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

const setStackFormat = 2 // a stack of a whole project (1: what one device holds, a patch)

// stackPlace: where a module sits in Live
type stackPlace struct {
	Track      string `json:"track"`       // the track's name
	TrackIndex int    `json:"track_index"` // its place among the tracks
	Path       []int  `json:"path"`        // the device on the track (inside racks: device, chain, device …)
	Name       string `json:"name"`        // the device's name in Live
}

// stackEntry: one Pung device of the project
type stackEntry struct {
	Device string `json:"device"` // the kind of device: instrument | effect | midi
	Module string `json:"module"` // its leading module (the patch names all of them)
	// Portable: laid out by the Set contract (its automation and mappings land on the same controls on
	// every Pung); false: a device from before it, or of a module the registry does not know
	Portable bool        `json:"portable"`
	Live     *stackPlace `json:"live,omitempty"`
	Patch    *stackDoc   `json:"patch"`
}

type setStack struct {
	Format  int               `json:"pung_stack"`
	Host    map[string]string `json:"host"` // kind ("live"), and what the host says of itself
	MadeOn  map[string]string `json:"made_on"`
	Taken   string            `json:"taken"`
	Entries []stackEntry      `json:"modules"`
	Needs   *stackNeeds       `json:"needs,omitempty"`
	// Unplaced: Pung devices the host did not show a place for (it is not
	// asked, or does not answer): they are in the stack all the same
	Unplaced int `json:"unplaced,omitempty"`
}

// livePlug: a Pung plugin as Live lists it
type livePlug struct {
	place stackPlace
	track json.RawMessage
}

// livePlugs: every Pung plugin in the Set, by track and position, racks
// looked into up to two deep (a browser entry is a rack around the plugin).
func livePlugs() ([]livePlug, error) {
	data, err := liveCall("track", "list", nil)
	if err != nil {
		return nil, err
	}
	var tl struct {
		Tracks []struct {
			Ref  json.RawMessage `json:"ref"`
			Name string          `json:"name"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(data, &tl); err != nil {
		return nil, err
	}
	var out []livePlug
	for ti, t := range tl.Tracks {
		var walk func(cont []int, chain, depth int)
		walk = func(cont []int, chain, depth int) {
			devs, err := listDevices(t.Ref, cont, chain)
			if err != nil {
				return
			}
			base := []int(nil)
			if cont != nil {
				base = append(append([]int(nil), cont...), chain)
			}
			for _, d := range devs {
				path := append(append([]int(nil), base...), d.I)
				if d.Class == "PluginDevice" && deviceNames[d.Name] != "" {
					out = append(out, livePlug{place: stackPlace{Track: t.Name, TrackIndex: ti, Path: path, Name: d.Name}, track: t.Ref})
					continue
				}
				if depth > 0 {
					for c := 0; c < d.Chains; c++ {
						walk(path, c, depth-1)
					}
				}
			}
		}
		walk(nil, 0, 2)
	}
	return out, nil
}

// placeDevices: which of Live's Pung plugins each device is. A device is
// one of the plugins of its class's name; where several are, the one whose
// parameter values fit best (matches), each plugin given once.
func placeDevices(devs []*device, plugs []livePlug, cost func(d *device, p livePlug) float64) map[*device]*stackPlace {
	out := map[*device]*stackPlace{}
	byName := map[string][]int{}
	for i, p := range plugs {
		byName[p.place.Name] = append(byName[p.place.Name], i)
	}
	taken := map[int]bool{}
	group := map[string][]*device{}
	for _, d := range devs {
		group[d.c.Name] = append(group[d.c.Name], d)
	}
	for name, ds := range group {
		cands := byName[name]
		if len(ds) == 1 && len(cands) == 1 {
			p := plugs[cands[0]].place
			out[ds[0]] = &p
			continue
		}
		for _, d := range ds { // several of a kind: the best fit that is still free
			best, at := -1.0, -1
			for _, i := range cands {
				if taken[i] {
					continue
				}
				if c := cost(d, plugs[i]); at < 0 || c < best {
					best, at = c, i
				}
			}
			if at >= 0 {
				taken[at] = true
				p := plugs[at].place
				out[d] = &p
			}
		}
	}
	return out
}

// setStackNow: the stack of the open project
func (h *Host) setStackNow() (*setStack, error) {
	host, _ := os.Hostname()
	st := &setStack{Format: setStackFormat, Host: map[string]string{"kind": "live"},
		MadeOn: map[string]string{"kind": here.Kind, "pung": buildVersion, "name": host},
		Taken:  time.Now().UTC().Format(time.RFC3339), Entries: []stackEntry{}}
	var devs []*device
	if h.prov != nil {
		devs = h.prov.list()
	}
	places := map[*device]*stackPlace{}
	if plugs, err := livePlugs(); err == nil {
		places = placeDevices(devs, plugs, func(d *device, p livePlug) float64 {
			data, err := liveCall("device", "params", map[string]any{"track": p.track, "path": p.place.Path})
			if err != nil {
				return 1e9
			}
			var r struct {
				Params []liveParam `json:"params"`
			}
			if json.Unmarshal(data, &r) != nil {
				return 1e9
			}
			return d.matches(r.Params)
		})
	} else {
		st.Host["places"] = "the host did not answer: " + err.Error()
	}
	needs := &stackNeeds{}
	fw := map[string]bool{}
	for _, d := range devs {
		patch, err := h.stackOf(d)
		if err != nil {
			return nil, err
		}
		e := stackEntry{Device: d.c.Kind, Module: d.c.module, Portable: d.c.contract, Live: places[d], Patch: patch}
		if e.Live == nil {
			st.Unplaced++
		}
		st.Entries = append(st.Entries, e)
		if n := patch.Needs; n != nil {
			if n.Pung != "" && (needs.Pung == "" || versionLess(needs.Pung, n.Pung)) {
				needs.Pung = n.Pung
			}
			needs.Emulators += n.Emulators
			for _, f := range n.Firmware {
				if k := f.Module + "/" + f.Label; !fw[k] {
					fw[k] = true
					needs.Firmware = append(needs.Firmware, f)
				}
			}
		}
	}
	if needs.Pung != "" || needs.Firmware != nil || needs.Emulators > 0 {
		st.Needs = needs
	}
	return st, nil
}

// setCheckModule: how one module a project's stack names stands on this
// deployment: "ready", or what must happen first.
//
//	install   it is in the module pack and not installed here
//	update    it is installed, older than the stack was saved with (its
//	          state may hold what the older module does not know)
//	restart   it is installed; the host has not taken it in yet (Live: it
//	          becomes a device when Live restarts)
//	firmware  it needs files of the player's own that are not here
//	pung      it needs a newer Pung than this one
//	unknown   no module pack this deployment knows names it
type setCheckModule struct {
	Module string `json:"module"`
	Name   string `json:"name"`
	Wanted string `json:"wanted,omitempty"` // the version the stack was saved with
	Here   string `json:"here,omitempty"`   // the version installed here
	State  string `json:"state"`
	Detail string `json:"detail,omitempty"`
	Uses   int    `json:"uses"` // how many of the project's devices use it
}

// moduleFacts: what a deployment knows of a module
type moduleFacts struct {
	Name     string
	Have     bool   // installed
	Here     string // its version here
	Known    bool   // a module pack names it
	MinPung  string // the oldest Pung that runs it, where this one is older
	Firmware []string
	InHost   bool // the host has a device for it (asked only of a module that leads a device)
}

// setModuleState: the first thing in the way, in the order a player would
// meet it.
func setModuleState(wanted string, f moduleFacts, lead bool) (state, detail string) {
	switch {
	case !f.Have && f.Known && f.MinPung != "":
		return "pung", f.MinPung
	case !f.Have && f.Known:
		return "install", ""
	case !f.Have:
		return "unknown", ""
	case len(f.Firmware) > 0:
		return "firmware", strings.Join(f.Firmware, ", ")
	case wanted != "" && f.Here != "" && versionLess(f.Here, wanted):
		return "update", wanted
	case lead && !f.InHost:
		return "restart", ""
	}
	return "ready", ""
}

// checkSet: every module the stack names, once, in the order the stack has
// them, with how it stands here (facts: what this deployment knows of it).
// A module several devices use is asked for in the newest version any of
// them was saved with; one that leads any device must be in the host.
func checkSet(st *setStack, facts func(id string) moduleFacts) []setCheckModule {
	type want struct {
		name, version string
		lead          bool
		uses          int
	}
	wants := map[string]*want{}
	var order []string
	for _, e := range st.Entries {
		if e.Patch == nil {
			continue
		}
		lead, _ := e.Patch.lead()
		for _, m := range e.Patch.Modules {
			w := wants[m.ID]
			if w == nil {
				w = &want{name: m.Name}
				wants[m.ID] = w
				order = append(order, m.ID)
			}
			if m.Version != "" && (w.version == "" || versionLess(w.version, m.Version)) {
				w.version = m.Version
			}
			w.lead = w.lead || m.ID == lead.ID
			w.uses++
		}
	}
	out := make([]setCheckModule, 0, len(order))
	for _, id := range order {
		w, f := wants[id], facts(id)
		c := setCheckModule{Module: id, Name: w.name, Wanted: w.version, Here: f.Here, Uses: w.uses}
		if f.Name != "" {
			c.Name = f.Name
		}
		if c.Name == "" {
			c.Name = id
		}
		c.State, c.Detail = setModuleState(w.version, f, w.lead)
		out = append(out, c)
	}
	return out
}

// setStackCheck: a project's stack against this deployment.
func (h *Host) setStackCheck(st *setStack) map[string]any {
	inst := map[string]installed{}
	if h.mods != nil {
		inst = h.mods.installed()
	}
	// the modules the host has a device for: a patch of each leading module is asked for its class
	inHost := map[string]bool{}
	var leads []string
	for _, e := range st.Entries {
		if e.Patch == nil {
			continue
		}
		lead, _ := e.Patch.lead()
		leads = append(leads, lead.ID)
		if !inHost[lead.ID] && h.stackClass(e.Patch) != nil {
			inHost[lead.ID] = true
		}
	}
	mods := checkSet(st, func(id string) moduleFacts {
		f := moduleFacts{InHost: inHost[id]}
		if h.mods != nil {
			if e, ok := h.mods.entry(id); ok {
				f.Known, f.Name = true, e.Name
				if pungTooOld(e) {
					f.MinPung = e.MinPung
				}
			}
		}
		if i, ok := inst[id]; ok {
			f.Have, f.Here = true, i.Version
			if i.Name != "" {
				f.Name = i.Name
			}
			for _, a := range assetStates(i.Dir) {
				if !a.Optional && a.Missing > 0 {
					f.Firmware = append(f.Firmware, a.Label)
				}
			}
		}
		return f
	})
	ready := true
	install := []string{} // (an empty list in the answer, not null)
	for _, m := range mods {
		ready = ready && m.State == "ready"
		if m.State == "install" || m.State == "update" {
			install = append(install, m.Module)
		}
	}
	out := map[string]any{"ok": true, "modules": mods, "install": install, "devices": len(st.Entries)}
	// the Pung the stack as a whole asks for
	if st.Needs != nil && st.Needs.Pung != "" && buildVersion != "dev" && versionLess(buildVersion, st.Needs.Pung) {
		out["pung"] = st.Needs.Pung
		ready = false
	}
	// its emulators against what plays at once here: more wait, silent, until one is removed (limits.go)
	if emus := emulatorsRunning(leads); here.MaxEmulators > 0 && len(emus) > here.MaxEmulators {
		out["emulators"] = map[string]any{"wanted": emus, "at_once": here.MaxEmulators}
	}
	out["ready"] = ready
	return out
}

func (h *Host) setStackRoutes(mux *http.ServeMux) {
	// POST /api/stack/check {"stack": …}: what this deployment lacks to play a project's stack. It changes
	// nothing here: installing is the module pack's (POST /api/catalog/{id}/install), restarting the host
	// the player's word (POST /api/catalog/apply).
	mux.HandleFunc("POST /api/stack/check", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Stack *setStack `json:"stack"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20)).Decode(&req); err != nil || req.Stack == nil {
			fail(w, 400, "the request holds no stack")
			return
		}
		if req.Stack.Format != setStackFormat {
			fail(w, 400, "it is not the stack of a project (pung_stack %d): a patch goes to POST /api/stacks", req.Stack.Format)
			return
		}
		for _, e := range req.Stack.Entries {
			if e.Patch == nil || e.Patch.valid() != nil {
				fail(w, 400, "the stack names a device this Pung cannot read")
				return
			}
		}
		writeJSON(w, 200, h.setStackCheck(req.Stack))
	})

	mux.HandleFunc("GET /api/stack", func(w http.ResponseWriter, r *http.Request) {
		st, err := h.setStackNow()
		if err != nil {
			fail(w, 500, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "stack": st})
	})
}
