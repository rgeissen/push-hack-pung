package main

// pungmod.go: Pung's own modulation. A module without a matrix of its own (or
// a control its matrix cannot reach) is modulated by Pung: two LFOs, the mod
// wheel and pressure, each routed to any numeric control with a depth, the
// way ASSIGN routes a module's own sources (assign.go). UX-GUIDELINES.md,
// "Pung's own modulation".
//
// Pung moves the control itself: many times a second it writes the knob's
// own setting (its root) plus the modulation to the module. That is one
// value for the whole sound: every voice moves together (a module's own
// matrix works per voice, and stays first on the screen). Its rules:
//
//   - The root is the control's value for everything but the module's ears:
//     Slot.Get answers it (the view, the web page, what Live hears), and a
//     state is read with the roots in place (Slot.Get of a ":state" key), so
//     a saved sound is never the LFO's momentary position.
//   - Whatever else sets the control sets its root: Live (its knob,
//     automation: applyParam), the view (Slot.Set), and a preset or a state
//     loading, seen as a value Pung did not write. The modulation goes on
//     around the new root.
//   - A rate of its own per module: 100 writes a second, 50 for an emulator
//     (each write is a message to the emulated synth; its parameters have
//     128 steps, so a fast sweep steps as it would on the hardware).
//   - Kept with the device in Live's Set (stateDoc's "pung_mod"), not in
//     the sound: a route stays through a preset change.
//
// Concurrency: the configuration is an immutable snapshot (atomic); the
// roots and the values written belong to the slot's lock (s.own), held by
// every path that touches them; the sources' controllers are atomics
// written on the realtime thread.

import (
	"encoding/json"
	"math"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// chainGet, chainSet: the chain's own calls (a test's fake module in their place)
var (
	chainGet       = cGet
	chainSet       = cSet
	chainGetAround = cGetAround
)

// pmodSources: Pung's sources, after the module's own on ASSIGN's buttons
var pmodSources = []modSource{
	{ID: "p_lfo_a", Name: "LFO A", Pung: true},
	{ID: "p_lfo_b", Name: "LFO B", Pung: true},
	{ID: "p_wheel", Name: "Wheel", Pung: true},
	{ID: "p_press", Name: "Pressure", Pung: true},
}

// pmodEmuSmoothHz: the fastest an LFO of Pung's moves an emulated synth's
// control as smoothly as the synth's own LFO would. Pung writes an emulator
// 50 times a second, and the synth takes about that many changes itself (the
// microQ's 68000 passes parameters to its DSP about 50 times a second):
// measured on Vavra, 2026-11-24, a sweep of Filter 1's cutoff at 1 Hz was
// smoother than the synth's own LFO, at 3 Hz as smooth (1.25 against 1.26 dB
// of roughness in its brightness), at 6 Hz coarser (2.0), at 10 Hz clearly
// stepped (2.95 against 1.0). An ordinary module, written 100 times a
// second, stayed smooth at 10 Hz (OB-Xd: 0.65). The LFO's settings say so
// from here up on an emulator (drawPmodLFO).
const pmodEmuSmoothHz = 4.0

// pmodHz: an LFO's cycles a second now (synced: at Live's tempo, 120 bpm
// while Live has not said)
func pmodHz(l pmodLFO) float64 {
	if l.Div > 0 && l.Div < len(pmodDivs) {
		_, bpm, _ := transportNow()
		if bpm <= 0 {
			bpm = 120
		}
		return bpm / 60 / pmodDivs[l.Div].beats
	}
	return l.Rate
}

// emulated: the device is an emulator (written every 20 ms, not 10)
func (pm *pungMod) emulated() bool { return pm.period >= 20*time.Millisecond }

// isPungSource: one of Pung's own (by its whole id: a module's source may
// begin the same way)
func isPungSource(id string) bool {
	for _, s := range pmodSources {
		if s.ID == id {
			return true
		}
	}
	return false
}

// pmodMaxChoice: a control with this many settings or fewer is a choice,
// not a level: an on/off (OB-Xd's 4-Pole, a float stepped 0/1), a mode, an
// octave switch, a voice count (a change of it cuts the notes); an LFO
// through it flicks a switch. Pung's sources move levels only; a module's
// own matrix decides for itself what its sources reach.
const pmodMaxChoice = 8

// pmodNotLevel: whole words of a key or a name that say a control picks or
// fires something, whatever its range: a sound (Dexed's and Surge's preset
// number, the Nord's "Sound"), an action drawn as a knob (Denis' Rnd Patch,
// Reset Matrix), MIDI routing (a channel, a trigger note), the module's own
// screen focus. Words, not parts of them: Mini-JV's Patch Level, OsTIrus'
// patch_volume and filter_bank_mix are levels.
var pmodNotLevel = regexp.MustCompile(`(?i)(^|[ _])(preset|program|patchnumber|rnd|mutate|reset|trigger|midi|channel|mask|focus|ui)([ _]|$)`)

// pmodLevel: a control Pung's sources may move: a number of the module's
// that it takes from outside (not one it only reports, not a selector that
// changes what the other controls are), with more than a few settings to
// move through, and not named like a choice
func pmodLevel(mm *paramMeta) bool {
	if mm == nil || mm.ReadOnly || mm.Selector || mm.Max <= mm.Min || mm.Key == "patch" ||
		pmodNotLevel.MatchString(mm.Key) || pmodNotLevel.MatchString(mm.Name) {
		return false
	}
	switch mm.Type {
	case "float":
		return mm.Step <= 0 || math.Floor((mm.Max-mm.Min)/mm.Step+1e-9)+1 > pmodMaxChoice
	case "int":
		step := math.Max(1, mm.Step)
		return math.Floor((mm.Max-mm.Min)/step+1e-9)+1 > pmodMaxChoice
	}
	return false
}

// LFO shapes and tempo divisions (in beats; 0: free, Hz)
var (
	pmodShapes = []string{"Sine", "Triangle", "Saw", "Square", "Random"}
	pmodDivs   = []struct {
		name  string
		beats float64
	}{{"Free", 0}, {"1/32", 0.125}, {"1/16", 0.25}, {"1/8", 0.5}, {"1/4", 1}, {"1/2", 2}, {"1 Bar", 4}, {"2 Bars", 8}, {"4 Bars", 16}}
)

type pmodLFO struct {
	Rate  float64 `json:"rate"`  // Hz, free running
	Div   int     `json:"div"`   // pmodDivs: 0 free, else synced to Live's tempo
	Shape int     `json:"shape"` // pmodShapes
}

// pmodRoute: one source on one control. Key is the chain key
// ("synth:cutoff"); the range is the control's, as the route was made, so a
// value can be written without asking the module what it is.
type pmodRoute struct {
	Src     string  `json:"src"`
	Key     string  `json:"key"`
	Amount  float64 `json:"amount"`
	Bipolar bool    `json:"bipolar,omitempty"`
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	Int     bool    `json:"int,omitempty"`
}

type pmodConf struct {
	LFO    [2]pmodLFO  `json:"lfo"`
	Routes []pmodRoute `json:"routes,omitempty"`
}

func defaultPmodConf() *pmodConf {
	return &pmodConf{LFO: [2]pmodLFO{{Rate: 1, Div: 0}, {Rate: 0.25, Div: 4, Shape: 1}}}
}

// routed: the routes on key
func (c *pmodConf) routed(key string) bool {
	for _, r := range c.Routes {
		if r.Key == key {
			return true
		}
	}
	return false
}

// pungMod: a device's own modulation, on its slot
type pungMod struct {
	s      *Slot
	period time.Duration // between writes: 10 ms, 20 for an emulator

	conf atomic.Pointer[pmodConf]
	mu   sync.Mutex // the writers of conf, and the runner's start

	// under the slot's lock
	root  map[string]string // a control's own value (as the module answers it)
	wrote map[string]string // what was last written to it

	wheel, press atomic.Uint64 // 0..1 (float bits), from the device's MIDI
	keys         pmodKeys      // what Pressure follows (midi's)

	// what the sources are now and where they put each control (raw), for
	// the screen's live dots (Slot.Get of live_mod)
	now   atomic.Pointer[map[string]float64]
	src   [4]atomic.Uint64 // the sources' values now, -1..1 (float bits)
	phase [2]atomic.Uint64 // the LFOs' phases now, 0..1 (float bits)

	running bool // under mu
	kick    chan struct{}
	unheard atomic.Bool // the runner leaves the device alone: nobody hears it (run)
	// closed: the device is gone (set under the slot's lock): the slot's
	// index may be another device's, and nothing is written to it again
	closed bool
}

func (pm *pungMod) wake() {
	select {
	case pm.kick <- struct{}{}:
	default:
	}
}

func newPungMod(s *Slot, emulator bool) *pungMod {
	pm := &pungMod{s: s, period: 10 * time.Millisecond, root: map[string]string{}, wrote: map[string]string{}, kick: make(chan struct{}, 1)}
	if emulator {
		pm.period = 20 * time.Millisecond
	}
	pm.conf.Store(defaultPmodConf())
	return pm
}

// pm: the slot's modulation, made on first use
func (s *Slot) pmod() *pungMod {
	if pm := s.pm.Load(); pm != nil {
		return pm
	}
	pm := newPungMod(s, s.emulator)
	if s.pm.CompareAndSwap(nil, pm) {
		return pm
	}
	return s.pm.Load()
}

// update: a new configuration (a copy changed by fn), and the runner
// started while it has routes
func (pm *pungMod) update(fn func(c *pmodConf)) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	old := pm.conf.Load()
	c := *old
	c.Routes = append([]pmodRoute(nil), old.Routes...)
	fn(&c)
	pm.conf.Store(&c)
	if len(c.Routes) > 0 && !pm.running {
		pm.running = true
		go pm.run()
	}
	pm.wake()
}

// setRoute: a route made, changed or (amount 0) removed from the screen
func (pm *pungMod) setRoute(key, src string, amount float64, bipolar bool, m *paramMeta) {
	pm.update(func(c *pmodConf) {
		for i, r := range c.Routes {
			if r.Src == src && r.Key == key {
				if amount == 0 {
					c.Routes = append(c.Routes[:i], c.Routes[i+1:]...)
				} else {
					c.Routes[i].Amount, c.Routes[i].Bipolar = amount, bipolar
				}
				return
			}
		}
		if amount != 0 && pmodLevel(m) { // (a choice never gets one, whoever asks: ASSIGN draws it FIXED)
			c.Routes = append(c.Routes, pmodRoute{Src: src, Key: key, Amount: amount, Bipolar: bipolar, Min: m.Min, Max: m.Max, Int: m.Type == "int"})
		}
	})
}

// adopt: the configuration a device's state carried (nil: the default);
// the roots are read again from the module as it loaded
func (pm *pungMod) adopt(raw json.RawMessage) {
	c := defaultPmodConf()
	if len(raw) > 0 {
		json.Unmarshal(raw, c) //nolint:errcheck
	}
	pm.update(func(cur *pmodConf) { *cur = *c })
	pm.s.own.Lock()
	if pm.closed {
		pm.s.own.Unlock()
		return
	}
	pm.root, pm.wrote = map[string]string{}, map[string]string{}
	pm.s.own.Unlock()
}

// state: what the device's state keeps (nil: nothing of Pung's)
func (pm *pungMod) state() json.RawMessage {
	c := pm.conf.Load()
	if len(c.Routes) == 0 && c.LFO == defaultPmodConf().LFO {
		return nil
	}
	b, _ := json.Marshal(c)
	return b
}

// midi: the device's MIDI as it plays (the realtime thread: atomics only)
func (pm *pungMod) midi(msg []byte) {
	if len(msg) < 2 {
		return
	}
	if msg[0]&0xF0 == 0xB0 && len(msg) >= 3 && msg[1] == 1 {
		pm.wheel.Store(math.Float64bits(float64(msg[2]) / 127))
		pm.wakeUnheard()
		return
	}
	if p, ok := pm.keys.event(msg); ok {
		pm.press.Store(math.Float64bits(p))
		pm.wakeUnheard()
	}
}

// wakeUnheard: a runner that left a silent device alone (run) writes at the
// first key or move of the wheel, not at its next look. A runner at work is
// not hurried: it writes at its own pace, whatever the keys send.
func (pm *pungMod) wakeUnheard() {
	if pm.unheard.Load() {
		pm.wake()
	}
}

// any: a key is held
func (k *pmodKeys) any() bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	return len(k.held) > 0
}

// pmodKeys: Pressure as one value for the whole sound: the newest held
// key's poly pressure, or the channel's pressure, and 0 once no key is held
// (a pad let go need not send a last 0, and a message can be lost: the
// modulation never hangs on a key that is gone). The wheel stays where it is
// left, as a wheel does.
type pmodKeys struct {
	mu      sync.Mutex
	held    []pmodKey // oldest first
	channel float64   // the newest channel pressure, 0..1
	poly    bool      // the newest pressure was a key's own
}

type pmodKey struct {
	note byte
	p    float64
}

// event: a message's effect on Pressure: its new value, or false (no change)
func (k *pmodKeys) event(msg []byte) (float64, bool) {
	k.mu.Lock()
	defer k.mu.Unlock()
	switch st := msg[0] & 0xF0; {
	case st == 0x90 && len(msg) >= 3 && msg[2] > 0:
		k.release(msg[1])
		k.held = append(k.held, pmodKey{note: msg[1]})
	case (st == 0x80 || st == 0x90) && len(msg) >= 3:
		k.release(msg[1])
	case st == 0xB0 && len(msg) >= 3 && (msg[1] == 123 || msg[1] == 120): // all notes, all sound off
		k.held = k.held[:0]
	case st == 0xA0 && len(msg) >= 3:
		for i := range k.held {
			if k.held[i].note == msg[1] {
				k.held[i].p = float64(msg[2]) / 127
			}
		}
		k.poly = true
	case st == 0xD0:
		k.channel, k.poly = float64(msg[1])/127, false
	default:
		return 0, false
	}
	return k.value(), true
}

func (k *pmodKeys) release(note byte) {
	for i := 0; i < len(k.held); i++ {
		if k.held[i].note == note {
			k.held = append(k.held[:i], k.held[i+1:]...)
			i--
		}
	}
}

func (k *pmodKeys) value() float64 {
	if len(k.held) == 0 {
		k.channel = 0 // (a keyboard lifts it too; the next key starts from nothing)
		return 0
	}
	if k.poly {
		return k.held[len(k.held)-1].p
	}
	return k.channel
}

// ---- under the slot's lock ----------------------------------------------------

// rootOf: the control's own value while Pung modulates it
func (pm *pungMod) rootOf(key string) (string, bool) {
	if !pm.conf.Load().routed(key) {
		return "", false
	}
	v, ok := pm.root[key]
	return v, ok
}

// setRoot: the control set from elsewhere (Live, the view): its new root,
// and what the module gets (the root with the modulation as it stands)
func (pm *pungMod) setRoot(key, v string) string {
	pm.root[key] = v
	out := pm.valueOf(pm.conf.Load(), key, v)
	pm.wrote[key] = out
	return out
}

// rootedGet: key (a state) read with every modulated control at its root,
// and the modulation put back, in one hold of the chain's lock: the module
// renders no block between (the "edited" mark reads the state every two
// seconds; a dip to the root each time would be heard)
func (pm *pungMod) rootedGet(key string) (string, bool) {
	var keys, before, after []string
	for k, v := range pm.root {
		if w, ok := pm.wrote[k]; ok && pm.conf.Load().routed(k) && w != v {
			keys, before, after = append(keys, k), append(before, v), append(after, w)
		}
	}
	if len(keys) == 0 {
		return chainGet(pm.s.Index, key)
	}
	return chainGetAround(pm.s.Index, key, keys, before, after)
}

// valueOf: root plus every route on key, as the module takes it
func (pm *pungMod) valueOf(c *pmodConf, key, root string) string {
	var rt *pmodRoute
	sum := 0.0
	for i := range c.Routes {
		r := &c.Routes[i]
		if r.Key != key {
			continue
		}
		rt = r
		uni, bi := pm.srcVal(r.Src), 0.0 // one way from the knob 0..1, both ways -1..1
		if r.Src == "p_wheel" || r.Src == "p_press" {
			bi = 2*uni - 1 // a controller is 0..1
		} else {
			uni, bi = (uni+1)/2, uni // an LFO -1..1
		}
		if r.Bipolar {
			sum += r.Amount * bi
		} else {
			sum += r.Amount * uni
		}
	}
	if rt == nil {
		return root
	}
	m := &paramMeta{Type: "float", Min: rt.Min, Max: rt.Max}
	if rt.Int {
		m.Type = "int"
	}
	return m.fromNorm(m.toNormValue(root) + sum)
}

// srcVal: a source now: an LFO -1..1, a controller 0..1
func (pm *pungMod) srcVal(id string) float64 {
	switch id {
	case "p_lfo_a":
		return math.Float64frombits(pm.src[0].Load())
	case "p_lfo_b":
		return math.Float64frombits(pm.src[1].Load())
	case "p_wheel":
		return math.Float64frombits(pm.wheel.Load())
	case "p_press":
		return math.Float64frombits(pm.press.Load())
	}
	return 0
}

// ---- the runner -------------------------------------------------------------

// pmodUnheardAfter: a device that may rest (an emulator: docs/GOVERNOR.md)
// and has been silent this long with no key held is not written by an LFO:
// each write would wake its synth, 50 times a second, for nobody.
// pmodUnheardLook: how often the runner then looks whether it sounds again
// (a key, the wheel, pressure and a change to the routes wake it at once).
const (
	pmodUnheardAfter = 2 * time.Second
	pmodUnheardLook  = 250 * time.Millisecond
)

// unheard: nobody hears what the LFOs would do to this device now. since:
// when it fell silent with no key held (zero: it sounds); the answer and
// since for the next look.
func pmodUnheard(mayRest, keyHeld, loud bool, since, now time.Time) (bool, time.Time) {
	if keyHeld || loud {
		return false, time.Time{}
	}
	if since.IsZero() {
		since = now
	}
	return mayRest && now.Sub(since) >= pmodUnheardAfter, since
}

// run: while there are routes, the LFOs advance and every routed control is
// written when its value changes; a control whose last route went is given
// its root back. A device that may rest is left alone while nobody hears it
// (pmodUnheard): the LFOs run on, unwritten, and the first key finds them
// where they are by then.
func (pm *pungMod) run() {
	t := time.NewTicker(pm.period)
	defer t.Stop()
	var phase [2]float64
	var held [2]float64 // Random: the value of this cycle
	last := time.Now()
	active := map[string]bool{}
	var (
		quietSince       time.Time
		unheard          bool
		doneConf         *pmodConf // the routes and LFOs of the last pass that wrote
		doneWheel, doneP uint64
	)
	for {
		if unheard {
			look := time.NewTimer(pmodUnheardLook)
			select {
			case <-look.C:
			case <-pm.kick:
			}
			look.Stop()
		} else {
			select {
			case <-t.C:
			case <-pm.kick:
			}
		}
		now := time.Now()
		dt := now.Sub(last).Seconds()
		last = now
		c := pm.conf.Load()
		beat, bpm, playing := transportNow()
		for i := range c.LFO {
			l := c.LFO[i]
			prev := phase[i]
			switch {
			case l.Div > 0 && l.Div < len(pmodDivs) && playing && bpm > 0:
				phase[i] = math.Mod(beat/pmodDivs[l.Div].beats, 1) // on Live's bars
			case l.Div > 0 && l.Div < len(pmodDivs):
				tempo := bpm
				if tempo <= 0 {
					tempo = 120
				}
				phase[i] = math.Mod(phase[i]+dt*tempo/60/pmodDivs[l.Div].beats, 1)
			default:
				phase[i] = math.Mod(phase[i]+dt*math.Max(0.01, l.Rate), 1)
			}
			if phase[i] < prev || held[i] == 0 {
				held[i] = rand.Float64()*2 - 1 + 1e-9
			}
			pm.src[i].Store(math.Float64bits(pmodShape(l.Shape, phase[i], held[i])))
			pm.phase[i].Store(math.Float64bits(phase[i]))
		}
		keys := map[string]bool{}
		for _, r := range c.Routes {
			keys[r.Key] = true
		}
		nowVals := map[string]float64{}
		if pm.s.loading.Load() {
			continue // a module loads: nothing written, nothing read
		}
		wheel, press := pm.wheel.Load(), pm.press.Load()
		unheard, quietSince = pmodUnheard(pm.s.rests.Load(), pm.keys.any(), peakDB(pm.s.peak()) >= liveSilentDB, quietSince, now)
		if unheard && (c != doneConf || wheel != doneWheel || press != doneP) {
			unheard = false // a hand on the wheel or the routes: this pass writes
		}
		pm.unheard.Store(unheard)
		if unheard {
			continue
		}
		doneConf, doneWheel, doneP = c, wheel, press
		restore := lockBoost()
		pm.s.own.Lock()
		if pm.closed {
			pm.s.own.Unlock()
			restore()
			pm.mu.Lock()
			pm.running = false
			pm.mu.Unlock()
			return
		}
		for k := range active {
			if !keys[k] { // its last route went: the root back
				if v, ok := pm.root[k]; ok {
					chainSet(pm.s.Index, k, v)
				}
				delete(pm.root, k)
				delete(pm.wrote, k)
				delete(active, k)
			}
		}
		for k := range keys {
			cur, ok := chainGet(pm.s.Index, k)
			if !ok {
				continue
			}
			r := firstRoute(c, k)
			m := &paramMeta{Type: "float", Min: r.Min, Max: r.Max}
			if r.Int {
				m.Type = "int"
			}
			w, had := pm.wrote[k]
			if _, rooted := pm.root[k]; !rooted || (had && !sameValue(m, cur, w)) {
				pm.root[k] = cur // the first look, or set from elsewhere (a preset, a state)
			}
			v := pm.valueOf(c, k, pm.root[k])
			if !had || v != w {
				chainSet(pm.s.Index, k, v)
				pm.wrote[k] = v
			}
			active[k] = true
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				nowVals[k] = f
			}
		}
		pm.s.own.Unlock()
		restore()
		pm.now.Store(&nowVals)
		if len(keys) == 0 {
			pm.mu.Lock()
			if len(pm.conf.Load().Routes) == 0 {
				pm.running = false
				pm.mu.Unlock()
				return
			}
			pm.mu.Unlock()
		}
	}
}

func firstRoute(c *pmodConf, key string) pmodRoute {
	for _, r := range c.Routes {
		if r.Key == key {
			return r
		}
	}
	return pmodRoute{}
}

// sameValue: the module answers what was written (within a rounding of its own)
func sameValue(m *paramMeta, a, b string) bool {
	if a == b {
		return true
	}
	tol := 0.002
	if m.Type == "int" && m.Max > m.Min {
		tol = 0.5 / (m.Max - m.Min)
	}
	return math.Abs(m.toNormValue(a)-m.toNormValue(b)) <= tol
}

// pmodShape: a shape at phase 0..1, -1..1
func pmodShape(shape int, ph, held float64) float64 {
	switch shape {
	case 1: // triangle
		return 1 - 4*math.Abs(ph-0.5)
	case 2: // saw, rising
		return 2*ph - 1
	case 3: // square
		if ph < 0.5 {
			return 1
		}
		return -1
	case 4: // random, held for a cycle
		return math.Max(-1, math.Min(1, held))
	}
	return math.Sin(2 * math.Pi * ph)
}

// liveMod: what Pung's modulation puts on comp's controls now, merged into
// the module's own live_mod answer (the module's own wins: it is per voice
// and already includes Pung's knob)
func (pm *pungMod) liveMod(comp, raw string, ok bool) (string, bool) {
	np := pm.now.Load()
	if np == nil || len(*np) == 0 {
		return raw, ok
	}
	out := map[string]any{}
	for k, v := range *np {
		if bare, found := strings.CutPrefix(k, comp+":"); found {
			out[bare] = v
		}
	}
	if len(out) == 0 {
		return raw, ok
	}
	if ok && raw != "" && raw[0] == '{' {
		var own map[string]any
		if json.Unmarshal([]byte(raw), &own) == nil {
			for k, v := range own {
				out[k] = v
			}
		}
	}
	b, _ := json.Marshal(out)
	return string(b), true
}

// mapFor: Pung's sources and routes on comp's controls, for ASSIGN's map
func (pm *pungMod) mapFor(comp string) (src []modSource, routes []modRoute) {
	src = append(src, pmodSources...)
	for _, r := range pm.conf.Load().Routes {
		if bare, ok := strings.CutPrefix(r.Key, comp+":"); ok {
			b := r.Bipolar
			routes = append(routes, modRoute{Src: r.Src, Dst: bare, Amount: r.Amount, Bipolar: &b})
		}
	}
	return src, routes
}
