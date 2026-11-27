package main

// stacks.go: a stack is what travels between devices (docs/STACKS.md): the
// modules in their order, the state of each, and Pung's modulation over
// them. Stacks are managed on pung.live; a device does two things: it gives
// the stack a Pung device is playing, and it takes one.
//
// On a Push a stack is, today, what one Pung device holds: an instrument with
// the MIDI effect in front of it, or a MIDI generator, or an audio effect.
// Effects behind an instrument are devices of their own in Live and not yet
// part of one stack (STACKS.md, Open).
//
// A stack a Push takes is kept (<data>/stacks/<name>.json) and becomes a
// rack in Push's own browser, as a saved sound does (sounds_racks.go):
// User Library > Presets > Instruments > Pung > Pung Stacks > <name>.
// Loading that rack brings the device with the whole stack. Asked to, Pung
// also loads it into a Pung device that is playing.
//
// A stack names its modules and never carries them, nor firmware.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

const (
	stackFormat    = 1
	stackRackDir   = "Pung Stacks" // not "Stacks": a module of that name has its sound racks there
	stackMaxBytes  = 8 << 20
	stackSoundKind = "stack" // a device's sound reference while it plays a stack as it came
)

// stackModule: one module of a stack, with its state as the module itself
// answers it (its <prefix>:state).
type stackModule struct {
	Role     string          `json:"role"` // midi_fx | synth | audio_fx
	ID       string          `json:"id"`
	Name     string          `json:"name,omitempty"`
	Version  string          `json:"version,omitempty"`
	Bypassed json.RawMessage `json:"bypassed,omitempty"`
	State    json.RawMessage `json:"state,omitempty"`
}

// stackNeeds: what a device must have to play the stack, derived when it is taken.
type stackNeeds struct {
	Pung      string          `json:"pung,omitempty"`      // the oldest Pung that runs its modules
	Firmware  []stackFirmware `json:"firmware,omitempty"`  // what the player must own
	Emulators int             `json:"emulators,omitempty"` // how many of its modules are emulators
}

type stackFirmware struct {
	Module string `json:"module"`
	Label  string `json:"label"`
}

type stackDoc struct {
	Format  int               `json:"pung_stack"`
	ID      string            `json:"id,omitempty"` // given by pung.live's library; a device keeps one stack per id
	Name    string            `json:"name"`
	MadeOn  map[string]string `json:"made_on,omitempty"`
	Taken   string            `json:"taken,omitempty"`
	Sound   string            `json:"sound,omitempty"` // the sound it was taken as, by name
	Modules []stackModule     `json:"modules"`
	Mod     json.RawMessage   `json:"mod,omitempty"` // Pung's modulation (pungmod.go), as a device's state keeps it
	OutCh   int               `json:"out_ch,omitempty"`
	Chain   map[string]any    `json:"chain,omitempty"` // what else the chain holds (its knob mappings)
	Needs   *stackNeeds       `json:"needs,omitempty"`
}

// chainDoc: a device's chain, as Slot.patch writes it
type chainDoc struct {
	Synth *struct {
		Module string `json:"module"`
		Config struct {
			State json.RawMessage `json:"state"`
		} `json:"config"`
		Bypassed json.RawMessage `json:"bypassed"`
	} `json:"synth"`
	MidiFX  []chainFX `json:"midi_fx"`
	AudioFX []chainFX `json:"audio_fx"`
}

type chainFX struct {
	Type   string `json:"type"`
	Params struct {
		State json.RawMessage `json:"state"`
	} `json:"params"`
	Bypassed json.RawMessage `json:"bypassed"`
}

// chainExtras: the chain's keys a stack carries as they are
var chainExtras = []string{"knob_mappings"}

// stackFromState: a device's state (devices.go, stateDoc) as a stack. The
// modules come in the order they play: MIDI effects, the instrument, audio
// effects.
func stackFromState(state string) (*stackDoc, error) {
	var st struct {
		OutCh   int             `json:"out_ch"`
		Chain   json.RawMessage `json:"chain"`
		Sound   *soundRef       `json:"sound"`
		PungMod json.RawMessage `json:"pung_mod"`
	}
	if json.Unmarshal([]byte(state), &st) != nil || len(st.Chain) == 0 {
		return nil, errors.New("not a Pung device state")
	}
	var c chainDoc
	if err := json.Unmarshal(st.Chain, &c); err != nil {
		return nil, err
	}
	out := &stackDoc{Format: stackFormat, OutCh: st.OutCh, Mod: st.PungMod}
	for _, f := range c.MidiFX {
		out.Modules = append(out.Modules, stackModule{Role: "midi_fx", ID: f.Type, Bypassed: f.Bypassed, State: f.Params.State})
	}
	if c.Synth != nil && c.Synth.Module != "" {
		out.Modules = append(out.Modules, stackModule{Role: "synth", ID: c.Synth.Module, Bypassed: c.Synth.Bypassed, State: c.Synth.Config.State})
	}
	for _, f := range c.AudioFX {
		out.Modules = append(out.Modules, stackModule{Role: "audio_fx", ID: f.Type, Bypassed: f.Bypassed, State: f.Params.State})
	}
	if len(out.Modules) == 0 {
		return nil, errors.New("the device holds no module")
	}
	var raw map[string]any
	if json.Unmarshal(st.Chain, &raw) == nil {
		for _, k := range chainExtras {
			if v, ok := raw[k]; ok {
				if out.Chain == nil {
					out.Chain = map[string]any{}
				}
				out.Chain[k] = v
			}
		}
	}
	if st.Sound != nil {
		out.Sound = st.Sound.Name
	}
	return out, nil
}

// lead: the module a stack's device is made for on a Push: its instrument;
// without one its MIDI generator; else its audio effect.
func (st *stackDoc) lead() (stackModule, string) {
	for _, role := range []string{"synth", "midi_fx", "audio_fx"} {
		for _, m := range st.Modules {
			if m.Role == role {
				kind := livedevice.Instrument
				switch role {
				case "midi_fx":
					kind = livedevice.MIDI
				case "audio_fx":
					kind = livedevice.Effect
				}
				return m, kind
			}
		}
	}
	return stackModule{}, ""
}

func (st *stackDoc) valid() error {
	if st.Format != stackFormat {
		return fmt.Errorf("not a stack this Pung reads (pung_stack %d)", st.Format)
	}
	if strings.TrimSpace(st.Name) == "" {
		return errors.New("the stack has no name")
	}
	if len(st.Modules) == 0 {
		return errors.New("the stack holds no module")
	}
	for _, m := range st.Modules {
		switch m.Role {
		case "midi_fx", "synth", "audio_fx":
		default:
			return fmt.Errorf("a module with the role %q", m.Role)
		}
		if notModule(m.ID) {
			return fmt.Errorf("a module without a name")
		}
	}
	return nil
}

// errStackShape: a stack that is more than one Pung device on a Push
type errStackShape string

func (e errStackShape) Error() string { return string(e) }

// stackState: the state of a device of class c that plays the stack
// (devices.go, adopt), or why this class cannot.
func stackState(c *sclass, st *stackDoc) (string, error) {
	lead, kind := st.lead()
	if kind != c.Kind || lead.ID != c.module {
		return "", fmt.Errorf("a stack for %s, not %s", lead.ID, c.module)
	}
	entry := func(m stackModule) map[string]any {
		cfg := map[string]any{}
		if len(m.State) > 0 && string(m.State) != "null" {
			cfg["state"] = m.State
		}
		by := any(0)
		if len(m.Bypassed) > 0 {
			by = m.Bypassed
		}
		return map[string]any{"cfg": cfg, "bypassed": by}
	}
	fx := func(m stackModule) map[string]any {
		e := entry(m)
		return map[string]any{"type": m.ID, "params": e["cfg"], "bypassed": e["bypassed"]}
	}
	chain := map[string]any{"custom_name": c.Name, "input": "both", "audio_fx": []any{}}
	midiFX := 0
	var midi, audio []any
	for _, m := range st.Modules {
		switch m.Role {
		case "synth":
			if c.Kind != livedevice.Instrument || m.ID != c.module || chain["synth"] != nil {
				return "", errStackShape("a stack on a Push holds one instrument")
			}
			e := entry(m)
			chain["synth"] = map[string]any{"module": m.ID, "config": e["cfg"], "bypassed": e["bypassed"]}
		case "midi_fx":
			if c.Kind == livedevice.Effect || len(midi) > 0 {
				return "", errStackShape("a Pung device on a Push takes one MIDI effect in front")
			}
			if c.Kind == livedevice.Instrument {
				for i, id := range c.midiFX {
					if i > 0 && id == m.ID {
						midiFX = i
					}
				}
				if midiFX == 0 {
					return "", fmt.Errorf("%s is not among this device's MIDI effects", m.ID)
				}
			}
			midi = append(midi, fx(m))
		case "audio_fx":
			if c.Kind != livedevice.Effect || len(audio) > 0 {
				return "", errStackShape("effects behind an instrument are devices of their own on a Push: not yet part of one stack")
			}
			audio = append(audio, fx(m))
		}
	}
	if midi != nil {
		chain["midi_fx"] = midi
	}
	if audio != nil {
		chain["audio_fx"] = audio
	}
	for _, k := range chainExtras {
		if v, ok := st.Chain[k]; ok {
			chain[k] = v
		}
	}
	doc := map[string]any{"pung_device": 1, "midi_fx": midiFX, "out_ch": st.OutCh, "chain": chain,
		"sound": soundRef{Source: stackSoundKind, Name: st.Name}}
	if len(st.Mod) > 0 && string(st.Mod) != "null" {
		doc["pung_mod"] = st.Mod
	}
	js, err := json.Marshal(doc)
	return string(js), err
}

// ---- what a device keeps ---------------------------------------------------

type stackKeep struct {
	h   *Host
	dir string // <data>/stacks
	mu  sync.Mutex
}

func newStackKeep(h *Host) *stackKeep {
	return &stackKeep{h: h, dir: filepath.Join(h.dataDir, "stacks")}
}

// list: the stacks kept, by name, with the file each is in
func (k *stackKeep) list() map[string]*stackDoc {
	out := map[string]*stackDoc{}
	files, _ := filepath.Glob(filepath.Join(k.dir, "*.json"))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var st stackDoc
		if json.Unmarshal(raw, &st) != nil || st.valid() != nil {
			continue
		}
		out[f] = &st
	}
	return out
}

// find: the kept stack with this id, or (a stack without one) this name
func (k *stackKeep) find(id, name string) string {
	byName := ""
	for f, st := range k.list() {
		if id != "" && st.ID == id {
			return f
		}
		if strings.EqualFold(st.Name, name) && (id == "" || st.ID == "") {
			byName = f
		}
	}
	return byName
}

// put keeps a stack: in place of the one it had under this id, else beside the others.
func (k *stackKeep) put(st *stackDoc) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	if err := os.MkdirAll(k.dir, 0o755); err != nil {
		return err
	}
	old := k.find(st.ID, st.Name)
	// two stacks never share a name: their racks would be one file
	for f, o := range k.list() {
		if f != old && strings.EqualFold(o.Name, st.Name) {
			return fmt.Errorf("this Pung keeps another stack named %q", o.Name)
		}
	}
	raw, err := json.MarshalIndent(st, "", " ")
	if err != nil {
		return err
	}
	path := uniquePath(k.dir, fileStem(st.Name))
	if old != "" && strings.EqualFold(filepath.Base(old), fileStem(st.Name)+".json") {
		path = old
	}
	tmp := path + ".new"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	if old != "" && old != path {
		os.Remove(old)
	}
	return nil
}

func (k *stackKeep) remove(id, name string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	f := k.find(id, name)
	if f == "" {
		return errors.New("no such stack here")
	}
	return os.Remove(f)
}

// classFor: the class of a device that plays the stack, or nil while its
// module is not a device in Live here.
func (h *Host) stackClass(st *stackDoc) *sclass {
	lead, kind := st.lead()
	if h.prov == nil {
		return nil
	}
	h.prov.mu.Lock()
	defer h.prov.mu.Unlock()
	var old *sclass
	for _, c := range h.prov.classes {
		if c.Kind == kind && c.module == lead.ID {
			if !c.legacy {
				return c
			}
			old = c // (the device from before the contract: only if it is the only one)
		}
	}
	return old
}

// stackWhere: where a stack's rack is found in Push's browser
func stackWhere(c *sclass, name string) string {
	top := "Instruments"
	if c.Kind == livedevice.Effect {
		top = "Audio Effects"
	}
	folder := c.Folder
	if folder == "" {
		folder = "Pung"
	}
	return strings.Join([]string{"User Library", "Presets", top, folder, stackRackDir, name}, " › ")
}

// syncRacks makes Push's browser hold one rack per kept stack whose module
// is a device in Live here: the module's own rack with the stack's device
// state in it (sounds_racks.go). Only racks Pung wrote are replaced or removed.
func (k *stackKeep) syncRacks() {
	lib := k.h.sounds
	if lib == nil || lib.racks == nil || lib.racks.presets == "" || k.h.prov == nil {
		return // no Live library here, or the classes are not made yet
	}
	r := lib.racks
	r.mu.Lock()
	defer r.mu.Unlock()
	want := map[string]map[string][]byte{} // folder -> file -> rack
	for _, c := range r.classes {          // every folder a stack's rack can be in, so one gone is removed
		if base := rackFolder(r.presets, "Pung", c.Class); base != "" {
			if dir := filepath.Join(base, stackRackDir); want[dir] == nil {
				want[dir] = map[string][]byte{}
			}
		}
	}
	for _, st := range k.list() {
		c := k.h.stackClass(st)
		if c == nil {
			continue // its module is not in Live here yet: at the next start
		}
		base := rackFolder(r.presets, "Pung", c.Class)
		if base == "" {
			continue
		}
		state, err := stackState(c, st)
		if err != nil {
			continue
		}
		tmpl, err := readGzip(classRackPath(r.presets, c.Class))
		if err != nil {
			continue
		}
		data, err := stateRack(tmpl, st.Name, state)
		if err != nil {
			log.Printf("stacks: %s: %v", st.Name, err)
			continue
		}
		want[filepath.Join(base, stackRackDir)][rackName(st.Name)+".adg"] = data
	}
	for dir, files := range want {
		written := readManifest(dir)
		if len(files) == 0 && len(written) == 0 {
			continue
		}
		if len(files) > 0 {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				log.Printf("stacks: %v", err)
				continue
			}
			chownLike(dir, r.presets)
		}
		kept := map[string]bool{}
		for file, data := range files {
			path := filepath.Join(dir, file)
			if !written[file] {
				if _, err := os.Stat(path); err == nil {
					continue // a rack of someone else's with this name: never ours to replace
				}
			}
			kept[file] = true
			if old, err := os.ReadFile(path); err == nil && string(old) == string(data) {
				continue
			}
			if err := writeRackAtomic(path, data); err != nil {
				log.Printf("stacks: %v", err)
				continue
			}
			chownLike(path, r.presets)
		}
		for file := range written {
			if !kept[file] {
				os.Remove(filepath.Join(dir, file))
			}
		}
		if len(kept) == 0 {
			os.Remove(filepath.Join(dir, rackManifest))
			os.Remove(dir) // only if empty
			continue
		}
		if err := writeManifest(dir, kept, r.presets); err != nil {
			log.Printf("stacks: %v", err)
		}
	}
}

// ---- what a stack needs, and what a device has --------------------------------

// stackUnmet: one thing a device lacks to play a stack
type stackUnmet struct {
	Module string `json:"module"`
	Name   string `json:"name,omitempty"`
	// Why: install (in the module pack, not installed), restart (installed,
	// not yet a device in Live: a restart of Live brings it), pung (needs a
	// newer Pung), firmware (the player's own, missing), unknown (no module
	// pack names it), shape (more than one device holds on this kind)
	Why    string `json:"why"`
	Detail string `json:"detail,omitempty"`
}

// stackCheck: what this device lacks to play the stack (nothing: it plays).
func (h *Host) stackCheck(st *stackDoc) []stackUnmet {
	var out []stackUnmet
	inst := map[string]installed{}
	if h.mods != nil {
		inst = h.mods.installed()
	}
	seen := map[string]bool{}
	for _, m := range st.Modules {
		if seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		var e catalogEntry
		known := false
		if h.mods != nil {
			e, known = h.mods.entry(m.ID)
		}
		name := m.Name
		if known && e.Name != "" {
			name = e.Name
		}
		i, have := inst[m.ID]
		if have && i.Name != "" {
			name = i.Name
		}
		switch {
		case !have && known && pungTooOld(e):
			out = append(out, stackUnmet{Module: m.ID, Name: name, Why: "pung", Detail: e.MinPung})
		case !have && known:
			out = append(out, stackUnmet{Module: m.ID, Name: name, Why: "install"})
		case !have:
			out = append(out, stackUnmet{Module: m.ID, Name: name, Why: "unknown"})
		default:
			for _, a := range assetStates(i.Dir) {
				if !a.Optional && a.Missing > 0 {
					out = append(out, stackUnmet{Module: m.ID, Name: name, Why: "firmware", Detail: a.Label})
				}
			}
		}
	}
	if len(out) > 0 {
		return out
	}
	if st.Needs != nil && st.Needs.Pung != "" && buildVersion != "dev" && versionLess(buildVersion, st.Needs.Pung) {
		return []stackUnmet{{Why: "pung", Detail: st.Needs.Pung}}
	}
	lead, _ := st.lead()
	c := h.stackClass(st)
	if c == nil {
		return []stackUnmet{{Module: lead.ID, Name: lead.Name, Why: "restart"}}
	}
	if _, err := stackState(c, st); err != nil {
		why := "restart" // a MIDI effect installed after this class was made
		var shape errStackShape
		if errors.As(err, &shape) {
			why = "shape"
		}
		return []stackUnmet{{Module: lead.ID, Name: lead.Name, Why: why, Detail: err.Error()}}
	}
	return nil
}

// stackOf: the stack a Pung device is playing, with what it needs.
func (h *Host) stackOf(d *device) (*stackDoc, error) {
	state, err := d.currentState()
	if err != nil {
		return nil, err
	}
	st, err := stackFromState(state)
	if err != nil {
		return nil, err
	}
	st.Name = st.Sound
	if st.Name == "" {
		st.Name = d.c.Name
	}
	host, _ := os.Hostname()
	st.MadeOn = map[string]string{"kind": "push", "pung": buildVersion, "name": host}
	st.Taken = time.Now().UTC().Format(time.RFC3339)
	needs := &stackNeeds{}
	inst := map[string]installed{}
	if h.mods != nil {
		inst = h.mods.installed()
	}
	for i := range st.Modules {
		m := &st.Modules[i]
		if in, ok := inst[m.ID]; ok {
			m.Name, m.Version = in.Name, in.Version
			for _, a := range assetStates(in.Dir) {
				if !a.Optional && len(a.Files) > 0 {
					needs.Firmware = append(needs.Firmware, stackFirmware{Module: m.ID, Label: a.Label})
				}
			}
		}
		if h.mods != nil {
			if e, ok := h.mods.entry(m.ID); ok && e.MinPung != "" && (needs.Pung == "" || versionLess(needs.Pung, e.MinPung)) {
				needs.Pung = e.MinPung
			}
		}
		if l := limitsOf(m.ID); l != nil && l.Emulator {
			needs.Emulators++
		}
	}
	if needs.Pung != "" || needs.Firmware != nil || needs.Emulators > 0 {
		st.Needs = needs
	}
	return st, nil
}

// stackPlaying: the Pung devices in the Set, each a stack that can be taken
func (h *Host) stackPlaying() []map[string]any {
	out := []map[string]any{}
	if h.prov == nil {
		return out
	}
	for _, d := range h.prov.list() {
		e := map[string]any{"n": d.s.Index, "module": d.c.module, "name": d.c.Name, "kind": d.c.Kind}
		if d.c.Kind == livedevice.Instrument && d.midiFX > 0 && d.midiFX < len(d.c.midiFX) {
			e["midi_fx"] = d.c.midiFX[d.midiFX]
		}
		d.snd.mu.Lock()
		if d.snd.current != nil {
			e["sound"] = d.snd.current.Name
		}
		d.snd.mu.Unlock()
		if l := limitsOf(d.c.module); l != nil && l.Emulator {
			e["emulator"] = true
		}
		out = append(out, e)
	}
	return out
}

// stackKept: what this device keeps, for pung.live's list
func (h *Host) stackKept() []map[string]any {
	out := []map[string]any{}
	if h.stacks == nil {
		return out
	}
	for _, st := range h.stacks.list() {
		e := map[string]any{"id": st.ID, "name": st.Name, "taken": st.Taken}
		var ids []string
		for _, m := range st.Modules {
			ids = append(ids, m.ID)
		}
		e["modules"] = ids
		unmet := h.stackCheck(st)
		e["ready"] = len(unmet) == 0
		if len(unmet) > 0 {
			e["unmet"] = unmet
		} else if c := h.stackClass(st); c != nil {
			e["where"] = stackWhere(c, st.Name)
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i]["name"].(string)) < strings.ToLower(out[j]["name"].(string))
	})
	return out
}

func (h *Host) stackRoutes(mux *http.ServeMux) {
	h.stacks = newStackKeep(h)
	// what plays here (each Pung device, a stack to take) and what is kept
	mux.HandleFunc("GET /api/stacks", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "playing": h.stackPlaying(), "kept": h.stackKept()})
	})
	// the stack a Pung device is playing
	mux.HandleFunc("GET /api/stacks/playing/{n}", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return
		}
		st, err := h.stackOf(d)
		if err != nil {
			fail(w, 500, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "stack": st})
	})
	// take a stack: check it; unless only asked to check, keep it (a rack in
	// Push's browser once its modules are here); "onto": also load it into
	// that Pung device now
	mux.HandleFunc("POST /api/stacks", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Stack *stackDoc `json:"stack"`
			Check bool      `json:"check"`
			Onto  *int      `json:"onto"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, stackMaxBytes)).Decode(&b); err != nil || b.Stack == nil {
			fail(w, 400, "no stack in the request")
			return
		}
		st := b.Stack
		st.Name = strings.TrimSpace(st.Name)
		if err := st.valid(); err != nil {
			fail(w, 400, "%v", err)
			return
		}
		unmet := h.stackCheck(st)
		out := map[string]any{"ok": true, "name": st.Name, "unmet": unmet, "ready": len(unmet) == 0}
		if c := h.stackClass(st); c != nil && len(unmet) == 0 {
			out["where"] = stackWhere(c, st.Name)
		}
		if b.Check {
			writeJSON(w, 200, out)
			return
		}
		for _, u := range unmet {
			if u.Why == "shape" || u.Why == "unknown" || u.Why == "pung" {
				// nothing this device can come to play: not kept
				writeJSON(w, 409, map[string]any{"ok": false, "error": stackWhy(u), "unmet": unmet})
				return
			}
		}
		if err := h.stacks.put(st); err != nil {
			fail(w, 400, "%v", err)
			return
		}
		h.stacks.syncRacks()
		out["kept"] = true
		if b.Onto != nil {
			if len(unmet) > 0 {
				out["loaded"], out["load_error"] = false, stackWhy(unmet[0])
			} else if err := h.stackLoad(*b.Onto, st); err != nil {
				out["loaded"], out["load_error"] = false, err.Error()
			} else {
				out["loaded"] = true
			}
		}
		writeJSON(w, 200, out)
	})
	// a stack this device should keep no longer
	mux.HandleFunc("POST /api/stacks/remove", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ ID, Name string }
		if json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&b) != nil || (b.ID == "" && b.Name == "") {
			fail(w, 400, "which stack?")
			return
		}
		if err := h.stacks.remove(b.ID, b.Name); err != nil {
			fail(w, 404, "%v", err)
			return
		}
		h.stacks.syncRacks()
		writeJSON(w, 200, map[string]any{"ok": true})
	})
}

// stackWhy: an unmet need, in words
func stackWhy(u stackUnmet) string {
	name := u.Name
	if name == "" {
		name = u.Module
	}
	switch u.Why {
	case "install":
		return name + " is not installed here"
	case "restart":
		return name + " is installed, and becomes a device in Live when Live restarts"
	case "pung":
		if name == "" {
			return "the stack needs Pung " + u.Detail + " or later"
		}
		return name + " needs Pung " + u.Detail + " or later"
	case "firmware":
		return name + " needs its " + u.Detail + ", which is the player's own"
	case "unknown":
		return "no module pack names " + strconv.Quote(u.Module)
	}
	return u.Detail
}

// stackLoad: the stack into the Pung device at chain slot n, now (the
// device must be the stack's instrument, MIDI generator or effect).
func (h *Host) stackLoad(n int, st *stackDoc) error {
	if h.prov == nil {
		return errors.New("no Pung devices")
	}
	d := h.prov.device(n)
	if d == nil {
		return fmt.Errorf("no Pung device %d", n)
	}
	state, err := stackState(d.c, st)
	if err != nil {
		return err
	}
	if err := d.adopt(state, false); err != nil {
		return err
	}
	d.touch() // kept with the other states (keptstate.go)
	return nil
}
