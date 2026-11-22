package main

// liveview.go: the Pung view of a Live device (DESIGN-v2, step 1).
//
// Schwung modules are Live devices now (Pung.vst3). Push's own device view
// shows them as plain parameter lists; the Pung view shows the selected
// Pung device with the module's own design: its banks, its widgets, the
// detail card. It opens with Push Hack Home's superstar gesture.
//
// Everything goes through Live (the PushHack Remote Script):
//   - reads: the "device" topic (selected device, values, Live's display text);
//   - writes: device.set_param, so Live's undo and automation recording work
//     and Push's own device view shows the same values afterwards.
// The module's metadata (banks, units, enum words) is read once per module
// from a hidden chain instance that never renders.

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type liveParam struct {
	I         int      `json:"i"`
	Name      string   `json:"name"`
	V         float64  `json:"v"`
	Min       float64  `json:"min"`
	Max       float64  `json:"max"`
	Display   string   `json:"display"`
	Quantized bool     `json:"quantized"`
	Items     []string `json:"items"`
	Default   *float64 `json:"default"` // Live's default for it (nil: it has none)
}

type liveDevice struct {
	Track  json.RawMessage `json:"track"`
	Device int             `json:"device"`
	Name   string          `json:"name"`
	Params []liveParam     `json:"params"`
}

type liveScale struct {
	Supported bool  `json:"supported"`
	Root      int   `json:"root"`
	Intervals []int `json:"intervals"`
	Mode      bool  `json:"mode"`
}

// ---- the device, the devices around it, the scale ----------------------------
//
// A Pung device is often inside a rack: a browser entry is an Instrument
// Rack wrapping the plugin, and racks are half the point of making modules
// Live devices. Live's "device" topic only finds devices at the top of a
// track (it reports device -1 with the name for one inside a rack). So the
// selected device is found by its name, inside racks, and addressed by its
// path (device, chain, device, ...). A nested device's parameters are read
// directly, a few times a second, only while the Pung view is up.

type liveDevSummary struct {
	I      int    `json:"i"`
	Name   string `json:"name"`
	Class  string `json:"class"`
	Chains int    `json:"chains"`
	Active bool   `json:"active"` // its Device On
}

// liveTrack is one of Live's tracks (the "tracks" topic): the Pung view's
// lower row, as on Push's device view.
type liveTrack struct {
	Ref   json.RawMessage `json:"ref"`
	Name  string          `json:"name"`
	Kind  string          `json:"kind"`
	Color int             `json:"color"`
	Mute  bool            `json:"mute"`
	Solo  bool            `json:"solo"`
}

// flag: the track's mute or solo, as the tracks topic last said.
func (t liveTrack) flag(prop string) bool {
	if prop == "solo" {
		return t.Solo
	}
	return t.Mute
}

type liveState struct {
	mu       sync.Mutex
	tracks   []liveTrack     // Live's tracks (not returns or master)
	selTrack json.RawMessage // the selected one, from the tracks topic
	// the selected track's devices (its top level) and which of them holds
	// the selected device: the Pung view's upper row, as on Push
	trackDevs []liveDevSummary
	selTop    int
	dev       liveDevice
	path      []int // the selected device; nil = none found
	cont      []int // path of the rack holding it; nil = the track itself
	chain     int   // the chain of that rack
	devs      []liveDevSummary
	devsKey   string
	scale     liveScale
	onChange  func()
	active    atomic.Bool // the Pung view is on the screen

	wmu     sync.Mutex
	pending map[string]paramWrite
	kick    chan struct{}
	// wrote: when each parameter of the shown device was last written (by
	// index, under mu). A poll can start before a write and answer after
	// it; for a moment after a write our value wins, or the next encoder
	// click steps from Live's older value and the click is lost.
	wrote map[int]time.Time

	// which selection (selID) the path was looked for, and whose
	// parameters dev.Params holds: the view draws a device only when both
	// are the selected one's, so a frame never mixes two devices
	resolved, paramsKey string
	// cached: the selection was drawn from known, not yet confirmed by a
	// lookup; known: what each device seen this session resolved to and
	// its last values, so coming back draws at once (a lookup in Live
	// takes 300 ms and more) while the lookup confirms it
	cached string
	known  map[string]knownSel
}

// knownSel: a selection as last resolved and read.
type knownSel struct {
	path, cont []int
	chain      int
	devs       []liveDevSummary
	devsKey    string
	params     []liveParam
	trackDevs  []liveDevSummary
	selTop     int
}

// remember keeps the current selection's resolution and values. s.mu held.
func (s *liveState) remember() {
	id := s.selID()
	if s.path == nil || s.paramsKey != id || s.resolved != id {
		return
	}
	if s.known == nil {
		s.known = map[string]knownSel{}
	}
	s.known[id] = knownSel{path: s.path, cont: s.cont, chain: s.chain, devs: s.devs, devsKey: s.devsKey,
		params: append([]liveParam(nil), s.dev.Params...), trackDevs: s.trackDevs, selTop: s.selTop}
}

// selID names the selection the topic reported. s.mu held.
func (s *liveState) selID() string {
	return fmt.Sprintf("%s/%d/%s", s.dev.Track, s.dev.Device, s.dev.Name)
}

type paramWrite struct {
	track json.RawMessage
	path  []int
	index int
	norm  float64
}

// setTracks takes the "tracks" topic.
func (s *liveState) setTracks(raw json.RawMessage) {
	var d struct {
		Tracks   []liveTrack     `json:"tracks"`
		Selected json.RawMessage `json:"selected"`
	}
	if json.Unmarshal(raw, &d) != nil {
		return
	}
	s.mu.Lock()
	s.tracks, s.selTrack = d.Tracks, d.Selected
	s.mu.Unlock()
	s.changed()
}

// deviceRow: the selected track's devices and the index of the one holding
// the selected device (-1 none).
func (s *liveState) deviceRow() ([]liveDevSummary, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]liveDevSummary(nil), s.trackDevs...), s.selTop
}

// setTopActive: a device of the track was switched on or off from here:
// shown at once, before Live's list is read again.
func (s *liveState) setTopActive(i int, on bool) {
	s.mu.Lock()
	for k := range s.trackDevs {
		if s.trackDevs[k].I == i {
			s.trackDevs[k].Active = on
		}
	}
	s.mu.Unlock()
}

// trackHeader: the selected track's name and colour.
func (s *liveState) trackHeader() (string, int) {
	tracks, i := s.trackRow()
	if i < 0 {
		return "", 0
	}
	return tracks[i].Name, tracks[i].Color
}

// trackRow: Live's tracks and the selected one's index (-1 none). The
// device topic knows the selection first; the tracks topic comes every half
// second.
func (s *liveState) trackRow() ([]liveTrack, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sel := s.dev.Track
	if len(sel) == 0 {
		sel = s.selTrack
	}
	for i, t := range s.tracks {
		if string(t.Ref) == string(sel) {
			return s.tracks, i
		}
	}
	return s.tracks, -1
}

func (l *live) state() *liveState {
	l.once.Do(func() {
		l.ls = &liveState{pending: map[string]paramWrite{}, kick: make(chan struct{}, 1)}
		go l.ls.writer()
		go l.ls.poller()
	})
	return l.ls
}

func (s *liveState) changed() {
	s.mu.Lock()
	cb := s.onChange
	s.mu.Unlock()
	if cb != nil {
		cb()
	}
}

func (s *liveState) setDevice(raw json.RawMessage) {
	var d liveDevice
	if json.Unmarshal(raw, &d) != nil {
		return
	}
	s.mu.Lock()
	same := string(d.Track) == string(s.dev.Track) && d.Name == s.dev.Name && d.Device == s.dev.Device
	if !same {
		// another selection: nothing of the last one carries over, not its
		// path (a knob would write to it), its rack, its values or its
		// writes; until it is resolved and read, the view holds
		s.remember()
		s.path, s.cont, s.chain, s.devs, s.devsKey = nil, nil, 0, nil, ""
		s.wrote, s.resolved, s.paramsKey, s.cached = nil, "", "", ""
	}
	if d.Device < 0 && same {
		d.Params = s.dev.Params // nested: the topic has none, keep the ones read directly
	}
	if len(s.path) > 1 || (len(s.path) == 1 && s.path[0] != d.Device) {
		// the topic's parameters belong to the top-level device (a rack);
		// the Pung plugin's own are read directly
		d.Params = s.dev.Params
	}
	s.dev = d
	if k, ok := s.known[s.selID()]; ok && !same && d.Name != "" {
		// seen before: drawn as it was left, at once; the lookup below
		// confirms it, and nothing is written to it until then
		s.path, s.cont, s.chain, s.devs, s.devsKey = k.path, k.cont, k.chain, k.devs, k.devsKey
		s.trackDevs, s.selTop = k.trackDevs, k.selTop
		if len(k.path) > 1 || k.path[0] != d.Device { // nested: the topic's values are the rack's
			s.dev.Params = k.params
		}
		s.cached, s.paramsKey = s.selID(), s.selID()
	}
	resolve := d.Name != "" && (!same || s.path == nil || s.cached == s.selID())
	if d.Name == "" {
		s.path = nil
		s.resolved = s.selID() // nothing selected: nothing to look for
	}
	s.mu.Unlock()
	if resolve {
		go s.resolve(d.Track, d.Name, d.Device)
	}
	s.changed()
}

func listKey(track json.RawMessage, cont []int, chain int) string {
	return fmt.Sprintf("%s|%v|%d", track, cont, chain)
}

func listDevices(track json.RawMessage, cont []int, chain int) ([]liveDevSummary, error) {
	args := map[string]any{"track": track}
	if cont != nil {
		args["path"], args["chain"] = cont, chain
	}
	data, err := liveCall("device", "list", args)
	if err != nil {
		return nil, err
	}
	var r struct {
		Devices []liveDevSummary `json:"devices"`
	}
	return r.Devices, json.Unmarshal(data, &r)
}

// resolve finds the Pung plugin the user means: the selected device when it
// is the plugin, else the plugin inside the selected rack (a browser entry is
// a rack named like the plugin), searched up to two racks deep. hint is the
// top-level index Live reported (-1 inside a rack); it is searched first, so
// two "Braids" on one track are not confused. Inside the selected
// rack any Pung plugin will do: a rack is named by its preset or by the
// user ("My Lead"), not after the
// plugin in it.
func (s *liveState) resolve(track json.RawMessage, name string, hint int) {
	var top []liveDevSummary // the track's own devices: the first list the walk reads
	var walk func(cont []int, chain int, depth int, loose bool) ([]int, []int, int, []liveDevSummary, bool)
	walk = func(cont []int, chain int, depth int, loose bool) ([]int, []int, int, []liveDevSummary, bool) {
		devs, err := listDevices(track, cont, chain)
		if err != nil {
			return nil, nil, 0, nil, false
		}
		if cont == nil {
			top = devs
		}
		base := append(append([]int(nil), cont...), chain)
		if cont == nil {
			base = nil
		}
		for _, d := range devs {
			if d.Class == "PluginDevice" && (d.Name == name || loose && deviceNames[d.Name] != "") {
				return append(append([]int(nil), base...), d.I), cont, chain, devs, true
			}
		}
		if depth == 0 {
			return nil, nil, 0, nil, false
		}
		order := append([]liveDevSummary(nil), devs...)
		if cont == nil && hint >= 0 { // the selected rack first
			sort.SliceStable(order, func(i, j int) bool { return order[i].I == hint && order[j].I != hint })
		}
		for _, d := range order {
			for c := 0; c < d.Chains; c++ {
				in := loose || cont == nil && d.I == hint
				if p, ct, ch, ds, ok := walk(append(append([]int(nil), base...), d.I), c, depth-1, in); ok {
					return p, ct, ch, ds, true
				}
			}
		}
		return nil, nil, 0, nil, false
	}
	path, cont, chain, devs, ok := walk(nil, 0, 2, false)
	s.mu.Lock()
	if string(s.dev.Track) == string(track) {
		s.trackDevs, s.selTop = top, hint
		if ok {
			s.selTop = path[0]
		}
	}
	// only for the selection it was asked for: an older resolve finishing
	// late (the selection moved on meanwhile) must not touch the new one's
	current := s.dev.Name == name && string(s.dev.Track) == string(track) && s.dev.Device == hint
	if current && !ok {
		s.path, s.cont, s.devs = nil, nil, nil
		delete(s.known, s.selID())
		s.cached = ""
	}
	if current && ok {
		if fmt.Sprint(s.path) != fmt.Sprint(path) {
			s.wrote = nil // another device: no write of ours is pending on it
		}
		s.path, s.cont, s.chain = path, cont, chain
		s.devs, s.devsKey = devs, listKey(track, cont, chain)
	}
	if current {
		s.resolved = s.selID() // confirmed: writable now
	}
	s.mu.Unlock()
	if ok {
		s.readParams()
	}
	s.changed()
}

func (s *liveState) loadDevices(track json.RawMessage, cont []int, chain int) {
	devs, err := listDevices(track, cont, chain)
	if err != nil {
		return
	}
	s.mu.Lock()
	s.devs, s.devsKey = devs, listKey(track, cont, chain)
	s.mu.Unlock()
	s.changed()
}

// readParams reads the selected device's parameters directly (for a device
// inside a rack, which the topic does not cover).
func (s *liveState) readParams() {
	s.mu.Lock()
	track, path := s.dev.Track, append([]int(nil), s.path...)
	s.mu.Unlock()
	if len(path) == 0 {
		return
	}
	data, err := liveCall("device", "params", map[string]any{"track": track, "path": path})
	if err != nil {
		return
	}
	var r struct {
		Params []liveParam `json:"params"`
	}
	if json.Unmarshal(data, &r) != nil {
		return
	}
	s.mu.Lock()
	if string(s.dev.Track) == string(track) && fmt.Sprint(s.path) == fmt.Sprint(path) {
		old := map[int]float64{}
		for _, p := range s.dev.Params {
			old[p.I] = p.V
		}
		for i := range r.Params {
			if t, ok := s.wrote[r.Params[i].I]; ok && time.Since(t) < writeHold {
				if v, ok := old[r.Params[i].I]; ok {
					r.Params[i].V = v
				}
			}
		}
		s.dev.Params = r.Params
		s.paramsKey = s.selID()
		s.remember()
	}
	s.mu.Unlock()
	s.changed()
}

// poller keeps a nested device's values current while the view is up.
func (s *liveState) poller() {
	for range time.Tick(150 * time.Millisecond) {
		if !s.active.Load() {
			continue
		}
		s.mu.Lock()
		nested := len(s.path) > 1 || (len(s.path) == 1 && s.path[0] != s.dev.Device)
		unread := s.path != nil && s.paramsKey != s.selID() // a first read that failed: again
		s.mu.Unlock()
		if nested || unread {
			s.readParams()
		}
	}
}

func (s *liveState) setScale(raw json.RawMessage) {
	var sc liveScale
	if json.Unmarshal(raw, &sc) == nil {
		s.mu.Lock()
		s.scale = sc
		s.mu.Unlock()
	}
}

// view is what the surface draws from: the device, its path, the devices
// beside it (the selected one is path's last index), the scale.
type liveView struct {
	dev   liveDevice
	path  []int
	cont  []int
	chain int
	devs  []liveDevSummary
	scale liveScale
	// key: the selection and the device it resolved to; resolved: the
	// search for it has finished (path nil then: not one of Pung's);
	// ready: its own parameters are read
	key             string
	resolved, ready bool
	writable        bool // confirmed by a lookup, not only remembered
}

func (s *liveState) view() liveView {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.selID()
	return liveView{dev: s.dev, path: append([]int(nil), s.path...), cont: append([]int(nil), s.cont...),
		chain: s.chain, devs: append([]liveDevSummary(nil), s.devs...), scale: s.scale,
		key: fmt.Sprintf("%s|%v", id, s.path), resolved: s.resolved == id || s.cached == id,
		ready:    (s.resolved == id || s.cached == id) && s.path != nil && s.paramsKey == id,
		writable: s.resolved == id && s.path != nil}
}

func (s *liveState) snapshot() (liveDevice, []liveDevSummary, liveScale) {
	v := s.view()
	return v.dev, v.devs, v.scale
}

// writeHold: how long a written value outlives what a poll answers. Writes
// go out within 25 ms and a poll round trip is well under that, so half a
// second covers every poll that could have started before the write.
const writeHold = 500 * time.Millisecond

// write queues a parameter write; a burst of encoder turns becomes one write
// per parameter per 25 ms.
func (s *liveState) write(w paramWrite) {
	s.wmu.Lock()
	s.pending[fmt.Sprintf("%s/%v/%d", w.track, w.path, w.index)] = w
	s.wmu.Unlock()
	select {
	case s.kick <- struct{}{}:
	default:
	}
	// what Live answers next may be older than this write: show the write
	s.mu.Lock()
	if fmt.Sprint(s.path) == fmt.Sprint(w.path) {
		if s.wrote == nil {
			s.wrote = map[int]time.Time{}
		}
		s.wrote[w.index] = time.Now()
		for i := range s.dev.Params {
			if s.dev.Params[i].I == w.index {
				p := &s.dev.Params[i]
				p.V = p.Min + w.norm*(p.Max-p.Min)
			}
		}
	}
	s.mu.Unlock()
}

func (s *liveState) writer() {
	for range s.kick {
		for {
			s.wmu.Lock()
			batch := s.pending
			s.pending = map[string]paramWrite{}
			s.wmu.Unlock()
			if len(batch) == 0 {
				break
			}
			for _, w := range batch {
				liveCall("device", "set_param", map[string]any{
					"track": w.track, "path": w.path, "index": w.index, "norm": w.norm})
			}
			time.Sleep(25 * time.Millisecond)
		}
	}
}

// ---- Pung devices ---------------------------------------------------------

// deviceNames maps a Pung device's name in Live (its class name: the
// module's own name, "OB-Xd") to the module. Set at start (buildClasses).
var deviceNames = map[string]string{}

// moduleOfLiveDevice: the module behind a Live device of Pung's, by its
// class name (the module's name).
func moduleOfLiveDevice(modulesDir, name string) (ModuleInfo, bool) {
	n := strings.TrimSpace(name)
	id, ok := deviceNames[n]
	if !ok {
		return ModuleInfo{}, false
	}
	for _, m := range scanModules(modulesDir) {
		if m.ID == id {
			return m, true
		}
	}
	return ModuleInfo{}, false
}

// probeMeta reads a module's chain_params and ui_hierarchy from a hidden
// chain instance (never published to the engine, so it never renders).
func (h *Host) probeMeta(m ModuleInfo) (*compMeta, bool) {
	if ok, known := h.screened[m.ID]; known && !ok {
		return nil, false // it crashed its probe in a child (screen.go): never in-process
	}
	h.probeMu.Lock()
	defer h.probeMu.Unlock()
	if h.probeCache == nil {
		h.probeCache = map[string]*compMeta{}
	}
	if cm, ok := h.probeCache[m.ID]; ok {
		return cm, cm != nil
	}
	// what the child probe recorded once the module was ready (screen.go):
	// no module code runs in this process for it
	if rec := probeRecordFor(m.ID); rec != nil {
		cm := buildMeta(m.ID, func(k string) (string, bool) { v, ok := rec.Meta[k]; return v, ok })
		if cm != nil {
			cm.Initial = rec.Initial
		}
		h.probeCache[m.ID] = cm
		return cm, cm != nil
	}
	const probe = maxSlots - 1
	if err := cSlotCreate(probe); err != nil {
		return nil, false
	}
	prefix := probePrefix(m)
	cSet(probe, prefix+":module", m.ID)
	cm := buildMeta(m.ID, func(key string) (string, bool) { return cGet(probe, prefix+":"+key) })
	if cm != nil {
		cm.Initial = map[string]string{}
		for _, k := range cm.Order {
			if v, ok := cGet(probe, prefix+":"+k); ok && v != "" {
				cm.Initial[k] = v
			}
		}
	}
	cSet(probe, prefix+":module", "")
	h.probeCache[m.ID] = cm
	return cm, true
}

// ---- values: Live's normalized 0..1 <-> the module's own values --------------
// The same formulas as Pung.vst3's ParamMeta (vst3/source/params.h).

func (m *paramMeta) fromNorm(n float64) string {
	n = math.Max(0, math.Min(1, n))
	switch {
	case m.Type == "enum" && len(m.Options) > 0:
		return m.Options[int(math.Round(n*float64(len(m.Options)-1)))]
	case m.Type == "int":
		return strconv.Itoa(int(math.Round(m.Min + n*(m.Max-m.Min))))
	}
	return strconv.FormatFloat(m.Min+n*(m.Max-m.Min), 'f', 4, 64)
}

// fromNormAs: fromNorm in the form the module answers its value in, as
// Schwung's own interface writes an enum (shadow_ui.js: pluginUsesIndex): an
// option's name where it answers names, its position where it answers a
// number. A module that reads a number first took "24 dB LP" for 24 (Vavra's
// filter type jumped to the last option, 2026-11-22).
func (m *paramMeta) fromNormAs(n float64, cur string) string {
	v := m.fromNorm(n)
	if m.Type != "enum" || len(m.Options) == 0 || cur == "" || numericOptions(m.Options) {
		return v
	}
	for _, o := range m.Options {
		if o == cur {
			return v // it answers names
		}
	}
	if _, err := strconv.Atoi(strings.TrimSpace(cur)); err != nil {
		return v
	}
	return strconv.Itoa(int(math.Round(math.Max(0, math.Min(1, n)) * float64(len(m.Options)-1))))
}

func (m *paramMeta) toNormValue(raw string) float64 {
	if m.Type == "enum" {
		if i, ok := m.enumIndex(raw); ok && len(m.Options) > 1 {
			return float64(i) / float64(len(m.Options)-1)
		}
		return 0
	}
	return math.Max(0, math.Min(1, m.frac(raw)))
}

// forgetProbe: a module was installed, updated or removed: its metadata is
// read again (modmgr.go).
func (h *Host) forgetProbe(id string) {
	h.probeMu.Lock()
	delete(h.probeCache, id)
	h.probeMu.Unlock()
	if h.ui != nil {
		h.ui.mu.Lock()
		h.ui.forgetMeta()
		h.ui.mu.Unlock()
	}
}
