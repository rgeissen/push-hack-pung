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
	ps, banks = fitLive(ps, banks)
	c := &livedevice.Class{UID: livedevice.ClassUID(uidNamespace, kind, module), Name: name, Kind: kind,
		Category: category, Ref: module, Folder: folder, Banks: banks}
	sc := &sclass{Class: c, module: module, midiFX: midiFX}
	for _, p := range ps {
		c.Params = append(c.Params, p.Param)
		sc.meta = append(sc.meta, p.meta)
		sc.role = append(sc.role, p.Role)
		sc.gateIdx = append(sc.gateIdx, p.gateIdx)
	}
	livedevice.PadBanks(c)                    // Push's Bank N is the module's bank N
	if len(c.Params) > livedevice.MaxParams { // fitLive leaves nothing to cut; never let a bank point past Live's list
		c.Params = c.Params[:livedevice.MaxParams]
		var banks [][]int
		for _, b := range c.Banks {
			var keep []int
			for _, i := range b {
				if i < livedevice.MaxParams {
					keep = append(keep, i)
				}
			}
			if len(keep) > 0 {
				banks = append(banks, keep)
			}
		}
		c.Banks = banks
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

// fitLive keeps a class within Live's parameter list (livedevice.MaxParams,
// placeholders included). A class that fits is returned as it is: its
// parameter IDs are list positions, and a Set saved with it must find them
// where they were. One that does not (Mini-JV: ~470 after padding) used to
// lose its tail by position, which cut through its banks: Push's pages
// pointed at parameters Live did not have, every page after the first such
// gap was shifted, and the MIDI FX selector was gone. It is laid out in its
// banks' order instead, whole banks only: the module's pages from the first
// while they fit, then the MIDI FX pages (the selector must be Live's, or no
// MIDI effect can be picked), and the module's later pages and unbanked keys
// are left out. Pung's view reaches those directly (SetOutside).
func fitLive(ps []vstParam, banks [][]int) ([]vstParam, [][]int) {
	// the banks as PadBanks will see them: each parameter in its first bank
	seen := map[int]bool{}
	var clean [][]int
	for _, b := range banks {
		var keep []int
		for _, i := range b {
			if i >= 0 && i < len(ps) && !seen[i] {
				seen[i] = true
				keep = append(keep, i)
			}
		}
		if len(keep) > 0 {
			clean = append(clean, keep)
		}
	}
	page := func(n int) int { return (n + 7) / 8 * 8 }
	// what Live would get, measured by laying it out (PadBanks pads; the
	// placeholders count)
	trial := &livedevice.Class{Banks: banks}
	for _, p := range ps {
		trial.Params = append(trial.Params, p.Param)
	}
	livedevice.PadBanks(trial)
	if len(trial.Params) <= livedevice.MaxParams {
		return ps, banks
	}
	isFX := func(b []int) bool {
		for _, i := range b {
			if ps[i].Role == "midifx" || ps[i].gateIdx != 0 {
				return true
			}
		}
		return false
	}
	var mod, fx [][]int
	fxSlots := 0
	for _, b := range clean {
		if isFX(b) {
			fx = append(fx, b)
			fxSlots += page(len(b))
		} else {
			mod = append(mod, b)
		}
	}
	var kept [][]int
	used := 0
	for _, b := range mod {
		if used+page(len(b)) > livedevice.MaxParams-fxSlots {
			break
		}
		kept = append(kept, b)
		used += page(len(b))
	}
	for _, b := range fx {
		if used+page(len(b)) > livedevice.MaxParams {
			break
		}
		kept = append(kept, b)
		used += page(len(b))
	}
	var out []vstParam
	var outBanks [][]int
	for _, b := range kept {
		var row []int
		for _, i := range b {
			row = append(row, len(out))
			out = append(out, ps[i])
		}
		outBanks = append(outBanks, row)
	}
	return out, outBanks
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
			if moduleIsInputSource(m) {
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

// moduleIsInputSource: a sound generator that takes audio and plays no notes
// (Line In): Live has its own inputs. A synth with an audio input of its own
// beside its notes (Aphex's ESP, the MS-20's external signal processor) is
// an instrument like any other: it was left out of Live with Line In until
// 2026-11-22.
func moduleIsInputSource(m ModuleInfo) bool {
	raw, err := os.ReadFile(filepath.Join(m.Dir, "module.json"))
	if err != nil {
		return false
	}
	var j struct {
		Capabilities struct {
			AudioIn bool  `json:"audio_in"`
			MidiIn  *bool `json:"midi_in"`
		} `json:"capabilities"`
	}
	json.Unmarshal(raw, &j)
	return j.Capabilities.AudioIn && (j.Capabilities.MidiIn == nil || !*j.Capabilities.MidiIn)
}

// ---- the provider: one Pung chain per device ----------------------------------

type provider struct {
	h       *Host
	gen     atomic.Uint64 // bumped when a device comes or goes (what selectedDevice caches depends on it)
	mu      sync.Mutex
	classes map[string]*sclass
	used    map[int]bool    // chain slots in use by devices
	devs    map[int]*device // by chain slot
	kept    *keptStates     // the devices' states from the Pung before this one
}

func newProvider(h *Host, classes []*sclass) *provider {
	p := &provider{h: h, classes: map[string]*sclass{}, used: map[int]bool{maxSlots - 1: true}, // the metadata probe
		devs: map[int]*device{}, kept: loadKeptStates(h.dataDir, liveIdentity(), time.Now())}
	for _, c := range classes {
		p.classes[c.UID] = c
	}
	go p.keepLiveInSync()
	return p
}

// liveResyncEvery: how often every device's values are read back and the
// ones Live has wrong are reported. A module applies a patch in its own
// time: Mini-JV boots a ROM and loads a patch through its emulated firmware
// after the reads at 0.5 s and 3 s (loadState) and after the read 150 ms
// after a change (SetOutside) have happened, and Live kept the old values;
// on the Push, Tone 1 read as switched on with Mini-JV's A.Piano 2, where
// only Tone 2 is (2026-11-15). Only what moved is reported.
const liveResyncEvery = 3 * time.Second

// selectorResync: how soon after a selector was turned from Live (Nodal
// Red's Edit Slot on a Push encoder) the device's values are read back.
const selectorResync = 60 * time.Millisecond

func (p *provider) keepLiveInSync() {
	t := time.NewTicker(selectorResync)
	defer t.Stop()
	every := int(liveResyncEvery / selectorResync)
	for n := 1; ; n++ {
		<-t.C
		for _, d := range p.list() {
			if d.loading.Load() {
				continue
			}
			if d.wantResync.Swap(false) || n%every == 0 {
				d.reportValues(false)
			}
		}
	}
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
	newDeviceMade(c.Name)          // picked in Push's browser: Pung's view, not the browser (browserclose.go)
	go d.adoptKept()
	if lib := p.h.sounds; lib != nil {
		go lib.warm(d)
	}
	return d, nil
}

// adoptKept: a device Live never asked the state of (made since the Set was
// last saved) gets no state back from the plugin after a restart of Pung,
// and came up as new. The plugin gives a state right after it makes the
// device, or never: one that got none takes what was kept for such a device.
func (d *device) adoptKept() {
	time.Sleep(2 * time.Second)
	if d.stateSeq.Load() != 0 {
		return // the plugin gave it a state
	}
	if kept, ok := d.p.kept.take("", d.c.module, time.Now()); ok {
		if err := d.adopt(kept, false); err != nil {
			log.Printf("%s: its state from before the restart: %v", d.c.Name, err)
			return
		}
		log.Printf("%s: its state from before the restart (Live holds none for it)", d.c.Name)
	}
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

	snd devSounds // which sound it is, and the browser's audition (sounds_device.go)
	// preview: a file the file browser plays through this device's output
	// (filesession.go); read on the realtime thread
	preview atomic.Pointer[previewVoice]
	// previewFrames: frames of preview given to Live (Stats: was it heard?)
	previewFrames atomic.Uint64
	// Process timing, in ns, the worst since Stats last read them
	procLast, procMax, procGapMax atomic.Int64
	// of that: waiting for the slot's lock, and the module's render
	acqMax, renderMax atomic.Int64
	// loop: the device's blocks run on a C thread of its own (rtloop.go);
	// nil: Process runs them. loopMu: held while it is read or freed.
	loopMu sync.RWMutex
	loop   *rtState
	// the MIDI clock made for the MIDI effect (Process): the realtime thread's only
	clkPlaying bool
	clkTick    int64

	// capture: the last seconds this device gave Live, kept while armed (a
	// test door: GET /api/devices/{n}/capture.wav). Preallocated when armed;
	// the realtime thread only copies into it.
	capBuf atomic.Pointer[[]float32]
	capPos atomic.Uint64 // frames written since armed

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
	// wantResync: a selector was turned from Live; set on the audio thread
	wantResync atomic.Bool

	lastChain json.RawMessage // the last state given (SetState), to load again (revive)

	// blocks that could not run, and their notes (Process, heldMidi)
	held     heldMidi // the realtime thread's only
	liveMu   sync.Mutex
	liveKey  string        // stateKey of the state Live's plugin holds for this device
	skipped  atomic.Uint64 // blocks skipped
	heldSent atomic.Uint64 // notes of skipped blocks delivered later

	// a state loads in the background (SetState): loadMu is held while one
	// loads, loading says one is on its way, stateSeq makes the newest win
	loadMu   sync.Mutex
	loading  atomic.Bool
	stateSeq atomic.Uint64
}

// heldMidi: the notes of blocks that could not run (Process), kept for the
// next one that can. Only the realtime thread touches it; nothing is
// allocated. What is kept: note-ons and note-offs, and the controllers that
// end notes (sustain, all sound off, all notes off). Pressure, bends and
// other controllers of a block that made no sound are let go: they are
// streams, and the next block brings their newest value.
type heldMidi struct {
	n   int
	buf [256][3]byte
}

func (h *heldMidi) keep(msg []byte) {
	if len(msg) < 3 {
		return
	}
	switch st := msg[0] & 0xF0; {
	case st == 0x80 || st == 0x90:
	case st == 0xB0 && (msg[1] == 64 || msg[1] == 120 || msg[1] == 123):
	default:
		return
	}
	if h.n == len(h.buf) {
		// full: a note-off is never the one to go. The oldest note-on is
		// given up for it (with its own note-off, if that is kept too)
		if !(msg[0]&0xF0 == 0x80 || (msg[0]&0xF0 == 0x90 && msg[2] == 0)) {
			return
		}
		for i := 0; i < h.n; i++ {
			if h.buf[i][0]&0xF0 == 0x90 && h.buf[i][2] > 0 {
				copy(h.buf[i:], h.buf[i+1:h.n])
				h.n--
				break
			}
		}
		if h.n == len(h.buf) {
			return
		}
	}
	h.buf[h.n] = [3]byte{msg[0], msg[1], msg[2]}
	h.n++
}

// flush gives what was kept to send, in order, and empties it. A note
// that began AND ended while nothing ran is left out whole: played now, it
// would be a click of a note long over. Returns how many were sent.
func (h *heldMidi) flush(send func(msg []byte)) int {
	isOn := func(m [3]byte) bool { return m[0]&0xF0 == 0x90 && m[2] > 0 }
	isOff := func(m [3]byte) bool { return m[0]&0xF0 == 0x80 || (m[0]&0xF0 == 0x90 && m[2] == 0) }
	var gone [256]bool
	for i := 0; i < h.n; i++ {
		if !isOn(h.buf[i]) {
			continue
		}
		for j := i + 1; j < h.n; j++ {
			if !gone[j] && isOff(h.buf[j]) && h.buf[j][0]&0x0F == h.buf[i][0]&0x0F && h.buf[j][1] == h.buf[i][1] {
				gone[i], gone[j] = true, true
				break
			}
		}
	}
	sent := 0
	for i := 0; i < h.n; i++ {
		if !gone[i] {
			send(h.buf[i][:])
			sent++
		}
	}
	h.n = 0
	return sent
}

// Process runs one block on the device's realtime thread.
func (d *device) Process(b *livedevice.Block) {
	// how long a block takes here, and how long since the one before began:
	// what tells a slow module from a stalled program (Stats)
	t0 := time.Now().UnixNano()
	if last := d.procLast.Swap(t0); last != 0 {
		if gap := t0 - last; gap > d.procGapMax.Load() {
			d.procGapMax.Store(gap)
		}
	}
	defer func() {
		if dur := time.Now().UnixNano() - t0; dur > d.procMax.Load() {
			d.procMax.Store(dur)
		}
	}()
	if b.TransportValid {
		noteTransport(b.BPM, b.Beat, b.Playing)
		setTempo(b.BPM)
		if b.Playing {
			setClock(2, b.Beat)
		} else {
			setClock(1, -1)
		}
	}
	ta := time.Now().UnixNano()
	got := d.s.acquire()
	if w := time.Now().UnixNano() - ta; w > d.acqMax.Load() {
		d.acqMax.Store(w)
	}
	if !got {
		// a module is loading (or the chain is busy this period): silence,
		// never a wait. But the block's notes are not thrown away with its
		// audio: a note-off lost here is a note that never ends (reported
		// as hanging notes, 2026-11-16). They wait for the next block.
		d.skipped.Add(1)
		b.Events(func(_ int, msg []byte) { d.held.keep(msg) })
		return
	}
	defer d.s.own.Unlock()
	b.Params(d.applyParam)
	d.s.drainMidi() // notes played by a test or the web page (POST /api/devices/{n}/note)
	deliver := func(msg []byte) {
		d.s.live.trackMidi(msg)
		n := d.recentN.Add(1) - 1
		var e [4]byte
		e[3] = byte(copy(e[:3], msg))
		d.recentMidi[n%16] = e
		if ch := d.c.inCh; ch >= 0 && len(msg) > 0 && msg[0] >= 0x80 && msg[0] < 0xF0 {
			var m [3]byte
			k := copy(m[:], msg)
			m[0] = m[0]&0xF0 | byte(ch)
			d.s.sendMidi(m[:k])
			return
		}
		d.s.sendMidi(msg)
	}
	// MIDI clock for the MIDI effect: Schwung's sequencers and arpeggiators
	// follow the clock bytes Move sends them (start, 24 a beat, stop), and
	// Live sends a plugin none. Made here from Live's own beat, so they run
	// with Live's transport (Stacks stayed silent without it, 2026-11-19).
	if b.TransportValid && (d.c.Kind == livedevice.MIDI || d.midiFX != 0) {
		tick := int64(math.Floor(b.Beat * 24))
		switch {
		case b.Playing && !d.clkPlaying:
			d.s.sendMidi([]byte{0xFA})
			d.s.sendMidi([]byte{0xF8}) // the downbeat's own clock
		case !b.Playing && d.clkPlaying:
			d.s.sendMidi([]byte{0xFC})
		case b.Playing:
			if n := tick - d.clkTick; n < 0 || n > 48 {
				// the song position jumped (a loop, a locate): from the top again
				d.s.sendMidi([]byte{0xFC})
				d.s.sendMidi([]byte{0xFA})
				d.s.sendMidi([]byte{0xF8})
			} else {
				for ; n > 0; n-- {
					d.s.sendMidi([]byte{0xF8})
				}
			}
		}
		d.clkPlaying, d.clkTick = b.Playing, tick
	}
	if d.held.n > 0 { // what the skipped blocks brought, first and in order
		d.heldSent.Add(uint64(d.held.flush(deliver)))
	}
	b.Events(func(_ int, msg []byte) { deliver(msg) })
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
		tr := time.Now().UnixNano()
		d.s.setPeak(cRender(d.s.Index, o, input)) // the meter (surface.level)
		if r := time.Now().UnixNano() - tr; r > d.renderMax.Load() {
			d.renderMax.Store(r)
		}
		d.s.live.feedAudio(o)
		if cb := d.capBuf.Load(); cb != nil {
			buf := *cb
			pos := int(d.capPos.Load() * 2 % uint64(len(buf)))
			for i := 0; i < n*2; i++ {
				buf[pos] = o[i]
				if pos++; pos == len(buf) {
					pos = 0
				}
			}
			d.capPos.Add(uint64(n))
		}
		for i := 0; i < n; i++ {
			b.Out[0][i], b.Out[1][i] = o[i*2], o[i*2+1]
		}
		d.mixPreview(b.Out[0], b.Out[1], n)
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
		cur, _ := d.s.Get(d.c.Params[idx].Key)
		cSet(d.s.Index, d.c.Params[idx].Key, m.fromNormAs(norm, cur))
		if m.Selector {
			d.wantResync.Store(true) // the other parameters read something else now (keepLiveInSync)
		}
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
func (d *device) resyncLive() { d.reportValues(false) }

// reportValues reports the chain's values to Live: the ones that moved, or all.
func (d *device) reportValues(all bool) {
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
		if all || m.fromNorm(n) != m.fromNorm(math.Float64frombits(d.norms[idx].Load())) {
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
//
// This device's side is what its module holds now, read, not the values
// last exchanged with Live (norms): after Pung restarts, a device's norms
// are its defaults until something is reported, so two devices of one
// module (two OsTIrus in a Set) looked alike and the first won. The Pung
// view then drew one device's knobs beside the other's display (its patch
// name, "WAITING"), measured 2026-11-20. Asked once per selection.
//
// A parameter is placed by its position in Live's list when the names agree
// there, else by its name where the name is the class's once: a device Live
// saved with an earlier layout (a Set from before a module's list settled)
// lists them elsewhere, and by position alone every one was compared with
// another parameter.
func (d *device) matches(liveParams []liveParam) float64 {
	byName := map[string]int{}
	for i, p := range d.c.Params {
		if _, dup := byName[p.Name]; dup {
			byName[p.Name] = -1
		} else {
			byName[p.Name] = i
		}
	}
	diff, n := 0.0, 0
	for k, p := range liveParams {
		if k == 0 || p.Max <= p.Min {
			continue
		}
		idx := -1
		if k-1 < len(d.c.order) && d.c.order[k-1] < len(d.c.Params) && d.c.Params[d.c.order[k-1]].Name == p.Name {
			idx = d.c.order[k-1]
		} else if i, ok := byName[p.Name]; ok {
			idx = i
		}
		if idx < 0 || idx >= len(d.norms) || d.c.Params[idx].Type == livedevice.PadType {
			continue
		}
		mine := math.Float64frombits(d.norms[idx].Load())
		if idx < len(d.c.meta) && d.c.meta[idx] != nil && d.c.role[idx] == "" {
			if v, ok := d.s.Get(d.c.Params[idx].Key); ok {
				mine = d.c.meta[idx].toNormValue(v)
			}
		}
		live := (p.V - p.Min) / (p.Max - p.Min)
		diff += math.Abs(live - mine)
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
	st, err := d.currentState()
	if err == nil { // Live asked: this is what its plugin holds from now on
		d.liveMu.Lock()
		d.liveKey = stateKey(st)
		d.liveMu.Unlock()
	}
	return st, err
}

func (d *device) currentState() (string, error) {
	if d.loading.Load() && d.lastChain != nil {
		// a state still loading is the device's state: the chain, half
		// loaded, is not (saved, it would lose the patch)
		doc, err := json.Marshal(d.stateDoc(d.lastChain))
		return string(doc), err
	}
	p, err := d.s.patch(d.c.Name)
	if err != nil {
		return "", err
	}
	doc, err := json.Marshal(d.stateDoc(p))
	return string(doc), err
}

// stateDoc: what Live saves for the device: the chain, and which sound it is
// (docs/PRESETS.md, "The current sound").
func (d *device) stateDoc(chain any) map[string]any {
	doc := map[string]any{"pung_device": 1, "midi_fx": d.midiFX, "out_ch": d.outCh, "chain": chain}
	d.snd.mu.Lock()
	if d.snd.current != nil {
		doc["sound"], doc["sound_hash"] = *d.snd.current, d.snd.hash
	}
	d.snd.mu.Unlock()
	return doc
}

func (d *device) SetState(state string) error { return d.adopt(state, true) }

// adopt loads a state: one Live's plugin gave (fromLive), or the one kept
// for a device whose plugin holds none (adoptKept).
func (d *device) adopt(state string, fromLive bool) error {
	var st struct {
		MidiFX    int             `json:"midi_fx"`
		OutCh     int             `json:"out_ch"`
		Chain     json.RawMessage `json:"chain"`
		Sound     *soundRef       `json:"sound"`
		SoundHash string          `json:"sound_hash"`
	}
	if json.Unmarshal([]byte(state), &st) != nil || len(st.Chain) == 0 {
		return errors.New("not a Pung device state")
	}
	// what Live's plugin holds, which after a restart of Pung is older than
	// the device was: the state kept at the stop is the device's (keptstate.go)
	kept, ok := "", false
	if fromLive {
		d.liveMu.Lock()
		d.liveKey = stateKey(state)
		d.liveMu.Unlock()
		kept, ok = d.p.kept.take(state, d.c.module, time.Now())
	}
	if ok {
		prev := st
		st.Chain, st.Sound, st.SoundHash = nil, nil, ""
		if json.Unmarshal([]byte(kept), &st) != nil || len(st.Chain) == 0 || patchModule(st.Chain, d.c.Kind) != d.c.module {
			st = prev
		} else {
			log.Printf("%s: its state from before the restart, not the one Live last saved", d.c.Name)
		}
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
	d.snd.mu.Lock()
	d.snd.current, d.snd.hash = st.Sound, st.SoundHash
	d.snd.mu.Unlock()
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
	// a sound loaded from its rack names itself but carries no hash (the
	// module may store its state otherwise once loaded): taken now, so a
	// later change shows as edited
	d.snd.mu.Lock()
	needHash := d.snd.current != nil && d.snd.hash == ""
	d.snd.mu.Unlock()
	if needHash {
		if v, ok := d.s.Get(d.c.component() + ":state"); ok {
			d.snd.mu.Lock()
			d.snd.hash = stateHash(v)
			d.snd.mu.Unlock()
		}
	}
	// Live hears the loaded values: Push reads Live's, and showed the old
	// ones beside a module that had another state (Edit Part Lower beside
	// Upper, 2026-11-15). Later, and again, for a module that boots a ROM.
	// Every value, not only those that differ from what Pung believes Live
	// has: that belief starts at the class's defaults, not at what Live
	// holds, so a value Live had wrong but equal to a default was never put
	// right (Mini-JV's P.Env Depth: +6 on Push, 0 in the module, 2026-11-15).
	for _, after := range []time.Duration{500 * time.Millisecond, 3 * time.Second} {
		time.AfterFunc(after, func() { d.reportValues(true) })
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
	restore := lockBoost() // the engine spins while this holds the lock (lockboost_linux.go)
	d.s.own.Lock()
	cSlotDestroy(d.s.Index)
	d.s.own.Unlock()
	restore()
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
	if len(cp) == 0 {
		return false
	}
	for _, p := range cp { // declared parameters only: a refused module may still answer "state"
		if k, _ := p["key"].(string); k != "" {
			if _, ok := d.s.Get(comp + ":" + k); ok {
				return false
			}
		}
	}
	return true
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
	m := map[string]any{"module": d.c.module, "midi_fx": fx, "midi_recent": recent, "peak_db": peakDB(d.s.peak()),
		"preview_frames": d.previewFrames.Load(), "previewing": d.previewing(),
		"proc_max_us": d.procMax.Swap(0) / 1000, "gap_max_us": d.procGapMax.Swap(0) / 1000,
		"acquire_max_us": d.acqMax.Swap(0) / 1000, "render_max_us": d.renderMax.Swap(0) / 1000,
		"chain_max_us": cChainMaxNs(d.s.Index) / 1000, "own_thread": false}
	if st, ok := d.loopStats(); ok {
		// the realtime thread counts what core's loop would have (blocks,
		// notes, peaks) and what Process did
		m["own_thread"] = true
		m["blocks"], m["notes_in"], m["notes_out"] = uint64(st.blocks), uint64(st.notes_in), uint64(st.notes_out)
		m["out_peak"], m["in_peak"] = float32(st.out_peak), float32(st.in_peak)
		m["preview_frames"] = uint64(st.preview_frames)
		m["proc_max_us"], m["gap_max_us"] = int64(st.proc_max_ns)/1000, int64(st.gap_max_ns)/1000
		m["acquire_max_us"], m["render_max_us"] = int64(st.acquire_max_ns)/1000, int64(st.render_max_ns)/1000
	}
	return m
}

// counts: blocks that could not run, their notes delivered later, and
// doubled note-ons the key guard ended first, from whichever loop runs.
func (d *device) counts() (skipped, heldSent, rekeyed uint64) {
	skipped, heldSent, rekeyed = d.skipped.Load(), d.heldSent.Load(), d.s.rekeyed.Load()
	if st, ok := d.loopStats(); ok {
		skipped += uint64(st.skipped)
		heldSent += uint64(st.held_sent)
		rekeyed += uint64(st.rekeyed)
	}
	return
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
