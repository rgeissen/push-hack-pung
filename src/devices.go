package main

// devices.go: Pung's devices in Live, on push-hack's Live device layer
// (core/livedevice). Every Schwung module is a plugin class in Live; every
// instance Live makes is one Pung chain here, outside Live's process, so a
// module that crashes cannot take Live down. core/livedevice brings the
// plugin, the block protocol, the realtime loop, the control socket and the
// browser entries; this file says what a Pung device is.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// uidNamespace: the class UIDs hash it with each module (Sets save them, so it
// never changes again). It changed once, when the product was renamed Pung
// (2026-11-15, before any release): Sets saved before that lost their devices.
const uidNamespace = "pung-vst3"

// ---- classes ------------------------------------------------------------------

// vstParam is a class parameter while it is being built, with what the
// device needs to apply it.
type vstParam struct {
	livedevice.Param
	meta    *paramMeta
	gate    string // only while this MIDI effect is loaded
	gateIdx int    // its 1-based index in the selector, 0 = none
}

// sclass is a Pung class: the core class plus how to apply its params.
type sclass struct {
	*livedevice.Class
	keyIdx  map[string]int // a chain key -> its parameter index
	order   []int          // the rack's parameter map: Live lists the plugin's parameters in this order
	module  string
	meta    []*paramMeta // per parameter index; nil for selectors and placeholders
	role    []string     // "midifx" (which MIDI effect), "outch" (MIDI out channel)
	gateIdx []int
	midiFX  []string // the selector's modules (index 0 = none)
	// inCh: the channel Live's MIDI reaches the module on (0-15), or -1 to
	// keep Live's channel. Live sends each note on its own channel (MPE
	// style); a module listening on one channel (the Virus) heard nothing.
	// Move's host remaps to the slot's channel unless the module asks for
	// passthrough; here a device's channel is 1 (moduleInChannel).
	inCh int
}

// moduleInChannel: capabilities.default_forward_channel, as Schwung's host
// reads it (docs/MODULES.md): -2 keeps the channel (MPE), 1..16 remaps to it,
// anything else: channel 1.
func moduleInChannel(m ModuleInfo) int {
	raw, err := os.ReadFile(filepath.Join(m.Dir, "module.json"))
	if err != nil {
		return 0
	}
	var j struct {
		Capabilities struct {
			Fwd *int `json:"default_forward_channel"`
		} `json:"capabilities"`
	}
	if json.Unmarshal(raw, &j) != nil || j.Capabilities.Fwd == nil {
		return 0
	}
	switch f := *j.Capabilities.Fwd; {
	case f == -2:
		return -1
	case f >= 1 && f <= 16:
		return f - 1
	}
	return 0
}

func toVstParams(cm *compMeta, prefix string) []vstParam {
	var out []vstParam
	for _, k := range cm.Order {
		m := cm.Params[k]
		if m == nil || m.ReadOnly {
			continue
		}
		switch m.Type {
		case "float", "int":
			if m.Max <= m.Min {
				continue
			}
		case "enum":
			if len(m.Options) == 0 {
				continue
			}
		default:
			continue // strings, paths: not a knob
		}
		// where a new instance really starts; the declared default only if the
		// module would not say (Live pushes it into the device on load)
		def := 0.0
		if v, ok := cm.Initial[k]; ok {
			def = m.toNormValue(v)
		} else if m.Default != nil {
			def = m.toNormValue(fmt.Sprintf("%g", *m.Default))
		}
		out = append(out, vstParam{Param: livedevice.Param{Name: m.Name, Key: prefix + ":" + k, Type: m.Type,
			Min: m.Min, Max: m.Max, Unit: m.Unit, Format: m.Format, Options: m.Options, Default: def}, meta: m})
	}
	return out
}

// banksFor lays out a class's parameters in the module's own banks.
func banksFor(params []vstParam, cm *compMeta, prefix string) [][]int {
	idx := map[string]int{}
	for i, p := range params {
		idx[p.Key] = i
	}
	var banks [][]int
	if cm != nil {
		for _, b := range cm.Banks {
			var row []int
			for _, k := range b.Keys {
				if i, ok := idx[prefix+":"+k]; ok {
					row = append(row, i)
				}
			}
			if len(row) > 0 {
				banks = append(banks, row)
			}
		}
	}
	return banks // livedevice.PadBanks adds what no bank holds
}

// finish turns a built parameter list into a Pung class.
func finish(name, kind, category, module, folder string, ps []vstParam, banks [][]int, midiFX []string) *sclass {
	c := &livedevice.Class{UID: livedevice.ClassUID(uidNamespace, kind, module), Name: name, Kind: kind,
		Category: category, Ref: module, Folder: folder, Banks: banks}
	sc := &sclass{Class: c, module: module, midiFX: midiFX}
	for _, p := range ps {
		c.Params = append(c.Params, p.Param)
		sc.meta = append(sc.meta, p.meta)
		sc.role = append(sc.role, p.Role)
		sc.gateIdx = append(sc.gateIdx, p.gateIdx)
	}
	livedevice.PadBanks(c) // Push's Bank N is the module's bank N
	if len(c.Params) > livedevice.MaxParams {
		c.Params = c.Params[:livedevice.MaxParams]
	}
	sc.keyIdx = map[string]int{}
	for i, p := range c.Params {
		if p.Key != "" {
			sc.keyIdx[p.Key] = i
		}
	}
	seen := map[int]bool{}
	for _, bank := range c.Banks { // as livedevice.WritePresets lists them
		for _, i := range bank {
			if !seen[i] && len(sc.order) < 128 {
				seen[i] = true
				sc.order = append(sc.order, i)
			}
		}
	}
	return sc
}

// buildClasses makes one class per installed module.
func (h *Host) buildClasses() []*sclass {
	mods := h.screenModules(scanModules(h.modulesDir)) // a module that crashes its probe stays out
	h.screened = map[string]bool{}
	for _, m := range mods {
		h.screened[m.ID] = m.Loadable
	}
	var midiFX []ModuleInfo
	for _, m := range mods {
		if m.Type == "midi_fx" && m.Loadable {
			midiFX = append(midiFX, m)
		}
	}
	var classes []*sclass
	for _, m := range mods {
		if !m.Loadable {
			continue
		}
		cm, ok := h.probeMeta(m)
		if !ok || cm == nil {
			continue
		}
		switch m.Type {
		case "sound_generator":
			if moduleWantsAudioIn(m) {
				continue // Line In and friends: Live has its own inputs
			}
			ps := toVstParams(cm, "synth")
			banks := banksFor(ps, cm, "synth")
			var fx []string
			// a MIDI effect in front of the synth, picked with a selector
			if len(midiFX) > 0 {
				sel := vstParam{Param: livedevice.Param{Name: "MIDI FX", Key: "midi_fx1:module", Type: "enum",
					Options: []string{"None"}, Role: "midifx"}}
				fx = []string{""}
				for _, f := range midiFX {
					sel.Options = append(sel.Options, f.Name)
					fx = append(fx, f.ID)
				}
				sel.Max = float64(len(sel.Options) - 1)
				selIdx := len(ps)
				ps = append(ps, sel)
				for gi, f := range midiFX {
					fm, ok := h.probeMeta(f)
					if !ok || fm == nil {
						continue
					}
					row := []int{selIdx}
					for _, p := range toVstParams(fm, "midi_fx1") {
						p.Name = shortName(f) + " " + p.Name
						p.gate, p.gateIdx = f.ID, gi+1
						if len(row) < 8 {
							row = append(row, len(ps))
						}
						ps = append(ps, p)
					}
					banks = append(banks, row)
				}
			}
			classes = append(classes, finish(m.Name, livedevice.Instrument, "Instrument|Synth",
				m.ID, "Pung", ps, banks, fx))
		case "audio_fx":
			ps := toVstParams(cm, "fx1")
			classes = append(classes, finish(m.Name, livedevice.Effect, "Fx", m.ID, "Pung",
				ps, banksFor(ps, cm, "fx1"), nil))
		case "midi_fx":
			// A device on its own track whose notes other tracks take with
			// Live's "MIDI From". Not a MIDI-in/MIDI-out plugin: Live 13.0b25
			// scans that shape as an audio effect (docs/DESIGN-v2.md).
			ps := toVstParams(cm, "midi_fx1")
			banks := banksFor(ps, cm, "midi_fx1")
			ch := vstParam{Param: livedevice.Param{Name: "MIDI Out Ch", Key: "outch", Type: "enum", Role: "outch", Max: 15}}
			for i := 1; i <= 16; i++ {
				ch.Options = append(ch.Options, fmt.Sprintf("Ch. %d", i))
			}
			banks = append(banks, []int{len(ps)})
			ps = append(ps, ch)
			classes = append(classes, finish(m.Name+" Track", livedevice.MIDI, "Instrument", m.ID,
				"Pung MIDI Effects", ps, banks, nil))
		}
		if n := len(classes); n > 0 && classes[n-1].module == m.ID {
			classes[n-1].inCh = moduleInChannel(m)
		}
	}
	sort.Slice(classes, func(i, j int) bool { return classes[i].Name < classes[j].Name })
	for _, c := range classes {
		deviceNames[c.Name] = c.module
	}
	return classes
}

func coreClasses(cs []*sclass) []*livedevice.Class {
	out := make([]*livedevice.Class, len(cs))
	for i, c := range cs {
		out[i] = c.Class
	}
	return out
}

func shortName(m ModuleInfo) string {
	if m.Abbrev != "" {
		return m.Abbrev
	}
	return m.Name
}

func moduleWantsAudioIn(m ModuleInfo) bool {
	raw, err := os.ReadFile(filepath.Join(m.Dir, "module.json"))
	if err != nil {
		return false
	}
	var j struct {
		Capabilities struct {
			AudioIn bool `json:"audio_in"`
		} `json:"capabilities"`
	}
	json.Unmarshal(raw, &j)
	return j.Capabilities.AudioIn
}

// ---- the provider: one Pung chain per device ----------------------------------

type provider struct {
	h       *Host
	gen     atomic.Uint64 // bumped when a device comes or goes (what selectedDevice caches depends on it)
	mu      sync.Mutex
	classes map[string]*sclass
	used    map[int]bool    // chain slots in use by devices
	devs    map[int]*device // by chain slot
}

func newProvider(h *Host, classes []*sclass) *provider {
	p := &provider{h: h, classes: map[string]*sclass{}, used: map[int]bool{maxSlots - 1: true}, // the metadata probe
		devs: map[int]*device{}}
	for _, c := range classes {
		p.classes[c.UID] = c
	}
	return p
}

func (p *provider) freeSlot() int {
	for i := 0; i < maxSlots; i++ {
		if !p.used[i] && p.h.slot(i) == nil {
			return i
		}
	}
	return -1
}

func (p *provider) New(c *livedevice.Class) (livedevice.Device, error) {
	sc := p.classes[c.UID]
	if sc == nil {
		return nil, errors.New("not a Pung class")
	}
	p.mu.Lock()
	slot := p.freeSlot()
	if slot >= 0 {
		p.used[slot] = true
	}
	p.mu.Unlock()
	if slot < 0 {
		return nil, fmt.Errorf("all %d Pung chains are in use", maxSlots-1)
	}
	if err := cSlotCreate(slot); err != nil {
		p.release(slot)
		return nil, err
	}
	s := &Slot{Index: slot, Name: c.Name, midi: make(chan midiMsg, 1024), seq: p.h.seq}
	switch c.Kind {
	case livedevice.Instrument:
		s.Set("synth:module", sc.module)
	case livedevice.Effect:
		s.Set("fx1:module", sc.module)
	case livedevice.MIDI:
		s.Set("midi_fx1:module", sc.module)
		sinkMIDI(s)
	}
	d := &device{p: p, c: sc, s: s, in: make([]float32, livedevice.MaxFrames*2),
		out: make([]float32, livedevice.MaxFrames*2), midiBuf: make([]byte, 256),
		norms: make([]atomic.Uint64, len(c.Params)), reports: map[int]float64{}}
	for i, prm := range c.Params {
		d.norms[i].Store(math.Float64bits(prm.Default))
	}
	p.mu.Lock()
	p.devs[slot] = d
	p.mu.Unlock()
	p.gen.Add(1)
	go p.reviveSiblings(sc.module) // a module that refused to start beside another
	return d, nil
}

// device: the one at chain slot n, or nil.
func (p *provider) device(n int) *device {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.devs[n]
}

// list: every device, by chain slot.
func (p *provider) list() []*device {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []*device
	for _, d := range p.devs {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].s.Index < out[j].s.Index })
	return out
}

func (p *provider) release(slot int) {
	defer p.gen.Add(1)
	p.mu.Lock()
	delete(p.used, slot)
	delete(p.devs, slot)
	p.mu.Unlock()
}

type device struct {
	p *provider
	c *sclass
	s *Slot

	// the last MIDI messages Live delivered (Stats: "midi_recent"); written on
	// the realtime thread, a fixed ring, read anywhere (a torn read shows a
	// mixed message, never a crash)
	recentMidi [16][4]byte
	recentN    atomic.Uint32

	in, out []float32 // interleaved, as the chain renders
	midiBuf []byte
	outCh   int

	midiFX      int // loaded MIDI effect (index into c.midiFX)
	switchingFX atomic.Bool

	// norms: each parameter's value as Live last knows it (Live's own
	// changes, and the ones reported back); compared with Live's to tell
	// which device in Live this is (identify)
	norms []atomic.Uint64
	// reports: changes made here (the web page), told to Live next block
	repMu   sync.Mutex
	reports map[int]float64
	resync  *time.Timer // under repMu
	closed  bool        // under repMu: its chain slot may belong to another device now

	lastChain json.RawMessage // the last state given (SetState), to load again (revive)

	// a state loads in the background (SetState): loadMu is held while one
	// loads, loading says one is on its way, stateSeq makes the newest win
	loadMu   sync.Mutex
	loading  atomic.Bool
	stateSeq atomic.Uint64
}

// Process runs one block on the device's realtime thread.
func (d *device) Process(b *livedevice.Block) {
	if b.TransportValid {
		setTempo(b.BPM)
		if b.Playing {
			setClock(2, b.Beat)
		} else {
			setClock(1, -1)
		}
	}
	if !d.s.acquire() {
		return // a module is loading: silence, never a wait
	}
	defer d.s.own.Unlock()
	b.Params(d.applyParam)
	b.Events(func(_ int, msg []byte) {
		n := d.recentN.Add(1) - 1
		var e [4]byte
		e[3] = byte(copy(e[:3], msg))
		d.recentMidi[n%16] = e
		if ch := d.c.inCh; ch >= 0 && len(msg) > 0 && msg[0] >= 0x80 && msg[0] < 0xF0 {
			var m [3]byte
			k := copy(m[:], msg)
			m[0] = m[0]&0xF0 | byte(ch)
			cMidi(d.s.Index, m[:k], 0)
			return
		}
		cMidi(d.s.Index, msg, 0)
	})
	n := b.Frames
	var input []float32
	if d.c.Kind == livedevice.Effect {
		input = d.in[:n*2]
		for i := 0; i < n; i++ {
			input[i*2], input[i*2+1] = b.In[0][i], b.In[1][i]
		}
	}
	if n > 0 {
		o := d.out[:n*2]
		cRender(d.s.Index, o, input)
		for i := 0; i < n; i++ {
			b.Out[0][i], b.Out[1][i] = o[i*2], o[i*2+1]
		}
	}
	if d.repMu.TryLock() { // never wait on the realtime thread: next block, then
		for idx, n := range d.reports {
			b.Report(idx, n)
			delete(d.reports, idx)
		}
		d.repMu.Unlock()
	}
	for {
		got := cTakeMidiOut(d.s.Index, d.midiBuf)
		if got <= 0 {
			break
		}
		if d.c.Kind != livedevice.MIDI {
			continue // what a synth sends has nowhere to go
		}
		for i := 0; i+3 < got; i += 4 {
			msg := usbMidiToRaw(d.midiBuf[i : i+4])
			if len(msg) == 0 || msg[0] >= 0xF0 {
				continue
			}
			msg[0] = msg[0]&0xF0 | byte(d.outCh&15) // the device's "MIDI Out Ch"
			b.Emit(0, msg)
		}
	}
}

func (d *device) applyParam(idx int, norm float64) {
	if idx < len(d.norms) {
		d.norms[idx].Store(math.Float64bits(norm))
	}
	if idx >= len(d.c.meta) {
		return
	}
	switch d.c.role[idx] {
	case "outch":
		d.outCh = int(math.Round(norm * 15))
		return
	case "midifx":
		want := int(math.Round(norm * float64(len(d.c.midiFX)-1)))
		if want != d.midiFX && !d.switchingFX.Load() {
			d.switchMidiFX(want)
		}
		return
	}
	if g := d.c.gateIdx[idx]; g != 0 && g != d.midiFX {
		return // belongs to a MIDI effect that is not loaded
	}
	if m := d.c.meta[idx]; m != nil {
		cSet(d.s.Index, d.c.Params[idx].Key, m.fromNorm(norm))
	}
}

// switchMidiFX loads another MIDI effect off the render thread: a module load
// is a dlopen. The chain is skipped (silent) while it loads.
func (d *device) switchMidiFX(want int) {
	d.switchingFX.Store(true)
	d.midiFX = want
	id := d.c.midiFX[want]
	go func() {
		defer d.switchingFX.Store(false)
		d.s.Set("midi_fx1:module", id)
	}()
}

// SetOutside is a change made on Pung's side (the web page): the chain
// gets it now, and Live hears of it at the next block (Block.Report), so
// Push's device view, the Pung view and automation follow.
func (d *device) SetOutside(key, value string) {
	d.s.Set(key, value)
	d.repMu.Lock()
	defer d.repMu.Unlock()
	if idx, ok := d.c.keyIdx[key]; ok && idx < len(d.c.meta) && d.c.meta[idx] != nil {
		norm := d.c.meta[idx].toNormValue(value)
		d.norms[idx].Store(math.Float64bits(norm))
		d.reports[idx] = norm
	}
	// and whatever else it moved, once the writes stop (even a key Live
	// does not have: an action like loading a preset)
	if d.resync == nil {
		d.resync = time.AfterFunc(resyncAfter, d.resyncLive)
	} else if !d.closed {
		d.resync.Reset(resyncAfter)
	}
}

// resyncAfter: how long after the last change from the web page the chain is
// read back whole. One key can move many (a preset, an "init" button), and
// Live heard only of the key itself; once, after a drag ends, not per step.
const resyncAfter = 150 * time.Millisecond

// resyncLive reads every parameter Live has back from the chain and reports
// the ones that moved. On a timer, never the realtime thread; repMu is held
// throughout, so Close cannot free the chain slot under it (Process only
// TryLocks it: its reports wait a block).
func (d *device) resyncLive() {
	d.repMu.Lock()
	defer d.repMu.Unlock()
	if d.closed {
		return
	}
	for idx, m := range d.c.meta {
		// Live's list is capped (livedevice: 256); a module can have more
		// (Mini-JV: 433). Only what Live has can be reported.
		if idx >= len(d.c.Params) || idx >= len(d.norms) {
			break
		}
		if m == nil || d.c.role[idx] != "" || d.c.gateIdx[idx] != 0 {
			continue // selectors, and a switchable MIDI effect's (its key was reported)
		}
		v, ok := d.s.Get(d.c.Params[idx].Key)
		if !ok {
			continue
		}
		// compared as values, both through the same formatting: an int's
		// norm is not exact, and a rounding is not a change
		n := m.toNormValue(v)
		if m.fromNorm(n) != m.fromNorm(math.Float64frombits(d.norms[idx].Load())) {
			d.norms[idx].Store(math.Float64bits(n))
			d.reports[idx] = n
		}
	}
}

// component: the chain component a device of this class edits.
func (c *sclass) component() string {
	switch c.Kind {
	case livedevice.Effect:
		return "fx1"
	case livedevice.MIDI:
		return "midi_fx1"
	}
	return "synth"
}

// matches: how well Live's parameter values (the plugin's parameter list in
// Live, "Device On" first) fit this device's. 0 is a perfect fit.
func (d *device) matches(liveParams []liveParam) float64 {
	diff, n := 0.0, 0
	for k, p := range liveParams {
		if k == 0 || k-1 >= len(d.c.order) || p.Max <= p.Min {
			continue
		}
		idx := d.c.order[k-1]
		if idx >= len(d.norms) || d.c.Params[idx].Type == livedevice.PadType {
			continue
		}
		live := (p.V - p.Min) / (p.Max - p.Min)
		diff += math.Abs(live - math.Float64frombits(d.norms[idx].Load()))
		n++
	}
	if n == 0 {
		return math.Inf(1)
	}
	return diff
}

// State is the device's Pung patch, the format Move saves, plus what the
// device keeps outside the chain.
func (d *device) State() (string, error) {
	if d.loading.Load() && d.lastChain != nil {
		// a state still loading is the device's state: the chain, half
		// loaded, is not (saved, it would lose the patch)
		doc, err := json.Marshal(map[string]any{"pung_device": 1, "midi_fx": d.midiFX, "out_ch": d.outCh, "chain": d.lastChain})
		return string(doc), err
	}
	p, err := d.s.patch(d.c.Name)
	if err != nil {
		return "", err
	}
	doc, err := json.Marshal(map[string]any{"pung_device": 1, "midi_fx": d.midiFX, "out_ch": d.outCh, "chain": p})
	return string(doc), err
}

func (d *device) SetState(state string) error {
	var st struct {
		MidiFX int             `json:"midi_fx"`
		OutCh  int             `json:"out_ch"`
		Chain  json.RawMessage `json:"chain"`
	}
	if json.Unmarshal([]byte(state), &st) != nil || len(st.Chain) == 0 {
		return errors.New("not a Pung device state")
	}
	// A device of one module never loads another's patch: a state that
	// names another module came from the wrong device (a plugin that asked
	// with a stale id after a restart, 2026-11-15) and is refused, so the
	// device keeps its own module.
	if m := patchModule(st.Chain, d.c.Kind); m != d.c.module {
		log.Printf("%s: refused a state for module %q (this device is %s)", d.c.Name, m, d.c.module)
		return fmt.Errorf("a state for %q, not %s", m, d.c.module)
	}
	// The answer goes back now and the state loads behind it: Live's plugin
	// gives set_state 3 s, and a module that boots a ROM takes longer
	// (JE-8086: 3.2 s). Past 3 s the plugin dropped the device and made it
	// again, every 6 s, for as long as Live ran (2026-11-15).
	d.lastChain = st.Chain
	d.midiFX, d.outCh = st.MidiFX, st.OutCh
	seq := d.stateSeq.Add(1)
	d.loading.Store(true)
	go d.loadState(seq, st.Chain)
	return nil
}

// loadState loads a state SetState was given, unless a newer one came or
// the device closed.
func (d *device) loadState(seq uint64, chain json.RawMessage) {
	d.loadMu.Lock()
	defer d.loadMu.Unlock()
	d.repMu.Lock()
	closed := d.closed
	d.repMu.Unlock()
	if closed || seq != d.stateSeq.Load() {
		return // the device is gone, or a newer state will load
	}
	if err := d.p.h.loadPatch(d.s, chain); err != nil {
		log.Printf("%s: loading its state: %v", d.c.Name, err)
	}
	if d.c.Kind == livedevice.MIDI {
		sinkMIDI(d.s) // also repairs a state saved with pre mode
	}
	if seq == d.stateSeq.Load() {
		d.loading.Store(false)
	}
	// Live hears the loaded values: Push reads Live's, and showed the old
	// ones beside a module that had another state (Edit Part Lower beside
	// Upper, 2026-11-15). Later, and again, for a module that boots a ROM.
	for _, after := range []time.Duration{500 * time.Millisecond, 3 * time.Second} {
		time.AfterFunc(after, d.resyncLive)
	}
}

func (d *device) Close() {
	d.repMu.Lock()
	d.closed = true
	if d.resync != nil {
		d.resync.Stop()
	}
	d.repMu.Unlock()
	// a state loading into this chain finishes first: once released, the
	// chain slot can be another device's
	d.loadMu.Lock()
	defer d.loadMu.Unlock()
	d.s.own.Lock()
	cSlotDestroy(d.s.Index)
	d.s.own.Unlock()
	d.p.release(d.s.Index)
	go d.p.reviveSiblings(d.c.module)
}

// reviveSiblings: devices of a module that allows one instance per device
// (JE-8086: "already running in another slot") refuse to start while
// another holds it. Live re-creates a device before closing the old one
// when Pung restarts, and the old Pung's forked DSP processes can hold the
// lock for seconds after it is gone, so a new device came up refused and
// stayed so (2026-11-15). A device that was refused is loaded again, with
// its last state, on a schedule long enough for the holder to let go. Run
// when a device is made and when one closes.
func (p *provider) reviveSiblings(module string) {
	for _, wait := range []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 15 * time.Second} {
		time.Sleep(wait)
		for _, o := range p.list() {
			if o.c.module != module || !o.refused() {
				continue
			}
			log.Printf("%s (chain %d): its module refused to start; loading it again", o.c.Name, o.s.Index)
			o.reload()
		}
	}
}

// refused: the module finished loading (is_loading answers "0", which a
// load error also answers: the Schwung contract) and answers for none of
// its parameters. A module still loading, or one that cannot say, is left
// alone: reloading it would start its boot over.
func (d *device) refused() bool {
	if d.loading.Load() {
		return false
	}
	comp := d.c.component()
	if v, ok := d.s.Get(comp + ":is_loading"); !ok || strings.TrimSpace(v) != "0" {
		return false
	}
	var cp []map[string]any
	if raw, ok := d.s.Meta(comp, "chain_params"); ok && raw != "" {
		json.Unmarshal([]byte(raw), &cp) //nolint:errcheck
	}
	return len(cp) > 0 && len(d.p.h.componentValues(d.s, comp, cp)) == 0
}

// reload: the module again, and the device's last state.
func (d *device) reload() {
	d.loadMu.Lock()
	defer d.loadMu.Unlock()
	d.repMu.Lock()
	closed := d.closed
	d.repMu.Unlock()
	if closed {
		return
	}
	comp := d.c.component()
	d.s.Set(comp+":module", "")
	d.s.Set(comp+":module", d.c.module)
	if d.lastChain != nil {
		if err := d.p.h.loadPatch(d.s, d.lastChain); err != nil {
			log.Printf("%s: reloading its state: %v", d.c.Name, err)
		}
	}
	if d.c.Kind == livedevice.MIDI {
		sinkMIDI(d.s)
	}
	d.p.gen.Add(1)
}

// Stats adds Pung's view of a device to /api/devices.
func (d *device) Stats() map[string]any {
	fx := ""
	if d.c.Kind == livedevice.Instrument {
		fx, _ = d.s.Get("midi_fx1_module")
	}
	n := d.recentN.Load()
	var recent []string
	for i := uint32(0); i < 16 && i < n; i++ {
		e := d.recentMidi[(n-1-i)%16]
		recent = append(recent, fmt.Sprintf("% X", e[:e[3]]))
	}
	return map[string]any{"module": d.c.module, "midi_fx": fx, "midi_recent": recent}
}

// sinkMIDI makes a chain's MIDI FX output the device's MIDI out: the
// midi-sink instrument (src/sink) catches everything the effect plays and
// hands it to the bridge. Schwung's pre mode is off: it is built for Move
// playing alongside and drops held pitches and chord roots.
func sinkMIDI(s *Slot) {
	s.Set("midi_fx_pre_mode", "0")
	if v, _ := s.Get("synth_module"); v != sinkModule {
		s.Set("synth:module", sinkModule)
	}
}

const sinkModule = "midi-sink"

// patchModule: the module a saved chain is built around, for a device of
// this kind: the synth of an instrument, the first audio effect of an
// effect, the first MIDI effect of a MIDI device ("" if none).
func patchModule(chain json.RawMessage, kind string) string {
	var p struct {
		Synth struct {
			Module string `json:"module"`
		} `json:"synth"`
		AudioFX []struct {
			Type string `json:"type"`
		} `json:"audio_fx"`
		MidiFX []struct {
			Type string `json:"type"`
		} `json:"midi_fx"`
	}
	if json.Unmarshal(chain, &p) != nil {
		return ""
	}
	switch kind {
	case livedevice.Effect:
		if len(p.AudioFX) > 0 {
			return p.AudioFX[0].Type
		}
	case livedevice.MIDI:
		if len(p.MidiFX) > 0 {
			return p.MidiFX[0].Type
		}
	default:
		return p.Synth.Module
	}
	return ""
}
