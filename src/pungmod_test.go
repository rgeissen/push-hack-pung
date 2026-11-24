package main

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeChain: a module's parameters in a map, in place of the chain's calls
// (installed once: the modulation's runners call through it from their own
// goroutines; each test puts its own map in)
type fakeChain struct {
	mu     sync.Mutex
	vals   map[string]string
	onGet  func(k string)
	writes int
}

var (
	fakeOnce sync.Once
	fakeCur  atomic.Pointer[fakeChain]
)

func useFakeChain(t *testing.T, vals map[string]string) *fakeChain {
	fakeOnce.Do(func() {
		chainGet = func(i int, k string) (string, bool) {
			f := fakeCur.Load()
			if f == nil {
				return cGet(i, k)
			}
			f.mu.Lock()
			hook := f.onGet
			v, ok := f.vals[k]
			f.mu.Unlock()
			if hook != nil {
				hook(k)
			}
			return v, ok
		}
		chainSet = func(i int, k, v string) {
			f := fakeCur.Load()
			if f == nil {
				cSet(i, k, v)
				return
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			f.vals[k] = v
			f.writes++
		}
		chainGetAround = func(i int, key string, keys, before, after []string) (string, bool) {
			for j := range keys {
				chainSet(i, keys[j], before[j])
			}
			v, ok := chainGet(i, key)
			for j := range keys {
				chainSet(i, keys[j], after[j])
			}
			return v, ok
		}
	})
	f := &fakeChain{vals: vals}
	fakeCur.Store(f)
	t.Cleanup(func() { fakeCur.Store(nil) })
	return f
}

func (f *fakeChain) get(k string) float64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, _ := strconv.ParseFloat(f.vals[k], 64)
	return v
}

func (f *fakeChain) set(k, v string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.vals[k] = v
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for end := time.Now().Add(2 * time.Second); time.Now().Before(end); time.Sleep(5 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatal("never: " + what)
}

// Pung's modulation moves the module's control around its root; everything
// else reads the root; a change from elsewhere is the new root; the last
// route gone, the root is back.
func TestPungModRoots(t *testing.T) {
	f := useFakeChain(t, map[string]string{"synth:cutoff": "1000.0000", "synth:state": `{"x":1}`})
	s := &Slot{}
	pm := s.pmod()
	cut := &paramMeta{Key: "cutoff", Type: "float", Min: 0, Max: 2000}
	// the wheel all the way up, routed one way at half the range: root + 1000
	pm.midi([]byte{0xB0, 1, 127})
	pm.setRoute("synth:cutoff", "p_wheel", 0.5, false, cut)
	waitFor(t, "the wheel moves the cutoff", func() bool { return math.Abs(f.get("synth:cutoff")-2000) < 1 })
	if v, _ := s.Get("synth:cutoff"); v != "1000.0000" {
		t.Fatalf("Get reads the root, got %s", v)
	}
	// the view (or Live) sets it: the root, and the module hears it modulated
	s.Set("synth:cutoff", "400")
	if v, _ := s.Get("synth:cutoff"); v != "400" || math.Abs(f.get("synth:cutoff")-1400) > 1 {
		t.Fatalf("a set is the root: Get %s, module %v", v, f.get("synth:cutoff"))
	}
	// a preset loads another value: the new root
	f.set("synth:cutoff", "200.0000")
	waitFor(t, "a value from elsewhere is the root", func() bool {
		v, _ := s.Get("synth:cutoff")
		return v == "200.0000" && math.Abs(f.get("synth:cutoff")-1200) < 1
	})
	// a state is read with the knob as it stands
	var seen float64
	f.mu.Lock()
	f.onGet = func(k string) {
		if k == "synth:state" {
			seen, _ = strconv.ParseFloat(f.vals["synth:cutoff"], 64) // (the slot's lock is held: no runner writes)
		}
	}
	f.mu.Unlock()
	s.Get("synth:state")
	f.mu.Lock()
	f.onGet = nil
	f.mu.Unlock()
	if math.Abs(seen-200) > 1 {
		t.Fatalf("the state was read with the cutoff at %v, not its root", seen)
	}
	if math.Abs(f.get("synth:cutoff")-1200) > 1 {
		t.Fatalf("the modulation is back at once after the state read: %v", f.get("synth:cutoff"))
	}
	// live: where it is now
	if raw, ok := s.Get("synth:live_mod"); !ok || !strings.Contains(raw, `"cutoff":1200`) {
		t.Fatalf("live_mod: %s %v", raw, ok)
	}
	// the route removed: the root back, and Get reads the module again
	pm.setRoute("synth:cutoff", "p_wheel", 0, false, nil)
	waitFor(t, "the root is back", func() bool { return math.Abs(f.get("synth:cutoff")-200) < 1 })
}

// An LFO sweeps both ways around the knob (bipolar), synced or free; the
// configuration goes with the device's state and comes back.
func TestPungModLFOAndState(t *testing.T) {
	f := useFakeChain(t, map[string]string{"synth:pan": "0"})
	s := &Slot{}
	pm := s.pmod()
	pan := &paramMeta{Key: "pan", Type: "int", Min: -64, Max: 63}
	pm.update(func(c *pmodConf) { c.LFO[0] = pmodLFO{Rate: 20, Shape: 3} }) // a fast square
	pm.setRoute("synth:pan", "p_lfo_a", 0.25, true, pan)
	lo, hi := 0.0, 0.0
	waitFor(t, "the square swings both ways", func() bool {
		v := f.get("synth:pan")
		lo, hi = math.Min(lo, v), math.Max(hi, v)
		return lo <= -31 && hi >= 31
	})
	st := pm.state()
	var c pmodConf
	if json.Unmarshal(st, &c) != nil || len(c.Routes) != 1 || c.Routes[0].Key != "synth:pan" || !c.Routes[0].Bipolar || !c.Routes[0].Int || c.LFO[0].Shape != 3 {
		t.Fatalf("state: %s", st)
	}
	s2 := &Slot{}
	s2.pmod().adopt(st)
	if r := s2.pmod().conf.Load().Routes; len(r) != 1 || r[0].Amount != 0.25 {
		t.Fatalf("adopted: %+v", r)
	}
	s2.pmod().adopt(nil) // a state without Pung's modulation: none
	if r := s2.pmod().conf.Load().Routes; len(r) != 0 {
		t.Fatalf("a state without routes left %d", len(r))
	}
	pm.setRoute("synth:pan", "p_lfo_a", 0, false, nil)
	waitFor(t, "the pan is back", func() bool { return f.get("synth:pan") == 0 })
	s2.pm.Load().update(func(*pmodConf) {}) // (its runner stops, no routes)
}

// ASSIGN offers Pung's sources after the module's, on any numeric control
// (not a knobless one), and lists their routes beside the module's.
func TestPungModInAssignMap(t *testing.T) {
	useFakeChain(t, map[string]string{"synth:cutoff": "0.5"})
	s := &Slot{}
	pm := s.pmod()
	pm.setRoute("synth:cutoff", "p_lfo_b", 0.3, true, &paramMeta{Type: "float", Max: 1})
	src, routes := pm.mapFor("synth")
	if len(src) != 4 || !src[0].Pung || len(routes) != 1 || routes[0].Dst != "cutoff" || routes[0].Src != "p_lfo_b" {
		t.Fatalf("map: %+v %+v", src, routes)
	}
	m := parseModMap(`{"sources":[{"id":"lfo1","name":"LFO 1"}],"dests":["res","pitch"],"names":{"pitch":"Pitch"}}`)
	m.Sources = append(m.Sources, src...)
	if !m.canFrom("p_lfo_a", "cutoff") || m.canFrom("lfo1", "cutoff") || m.canFrom("p_lfo_a", "pitch") {
		t.Fatal("Pung's sources reach any control with a value; the module's only its own")
	}
	pm.setRoute("synth:cutoff", "p_lfo_b", 0, false, nil)
}

// Pung's sources move levels, not choices: an on/off, a mode, an octave
// switch or a voice count is FIXED for them (the module's own matrix still
// decides for its sources), and the engine takes no route to one either.
// MORE starts, after the panel's own pages, with the module's pages that
// hold a destination that matters.
func TestPungModLevelsAndMore(t *testing.T) {
	cm := &compMeta{Params: map[string]*paramMeta{
		"out_gain":   {Key: "out_gain", Name: "Output Gain", Type: "float", Max: 1},
		"bend_range": {Key: "bend_range", Name: "Bend Range", Type: "int", Max: 24},
		"cutoff":     {Key: "cutoff", Name: "Cutoff", Type: "int", Max: 100, Step: 1},
		"fourpole":   {Key: "fourpole", Name: "4-Pole", Type: "int", Max: 1, Step: 1},
		"voices":     {Key: "voices", Name: "Voices", Type: "int", Min: 1, Max: 8},
		"octave":     {Key: "octave", Name: "Octave", Type: "int", Min: -2, Max: 2},
		"coarse":     {Key: "coarse", Name: "Coarse", Type: "int", Max: 100, Step: 20},
		"slot":       {Key: "slot", Name: "Slot", Type: "int", Max: 3, Selector: true},
		"meter":      {Key: "meter", Name: "Meter", Type: "float", Max: 1, ReadOnly: true},
		"drive":      {Key: "drive", Name: "Drive", Type: "float", Max: 1},
		"rnd_pan":    {Key: "rnd_pan", Name: "Rnd Pan", Type: "float", Max: 1, Step: 1},
		"rnd_patch":  {Key: "rnd_patch", Name: "Rnd Patch", Type: "float", Max: 1, Step: 0.01},
		"preset":     {Key: "preset", Name: "Sound", Type: "int", Max: 9999},
		"v1_preset":  {Key: "v1_preset", Name: "V1 Preset", Type: "int", Max: 40},
		"lfo1_2":     {Key: "lfo1_2", Name: "Trigger", Type: "int", Max: 127},
		"midi_ch":    {Key: "midi_ch", Name: "MIDI Ch", Type: "int", Min: 1, Max: 16},
		"ui_focus":   {Key: "ui_focus", Name: "Focus", Type: "int", Max: 64},
		"patchlevel": {Key: "nvram_patchCommon_patchlevel", Name: "Patch Level", Type: "int", Max: 127},
		"fb_mix":     {Key: "filter_bank_mix", Name: "FB Mix", Type: "int", Max: 127},
		"fine":       {Key: "fine", Name: "Fine", Type: "float", Max: 1, Step: 0.01},
		"ch_level":   {Key: "ch_level", Name: "CH Level", Type: "int", Max: 127},
	}}
	m := parseModMap(`{"sources":[{"id":"lfo1","name":"LFO 1"}],"dests":["fourpole","cutoff"]}`)
	m.Sources = append(m.Sources, pmodSources...)
	for k, want := range map[string]bool{"out_gain": true, "bend_range": true, "cutoff": true, "drive": true,
		"patchlevel": true, "fb_mix": true, "ch_level": true, "fine": true, "rnd_pan": false, "rnd_patch": false, "preset": false,
		"v1_preset": false, "lfo1_2": false, "midi_ch": false, "ui_focus": false, "fourpole": false, "voices": false, "octave": false, "coarse": false, "slot": false, "meter": false} {
		if got := m.reaches(cm, "p_lfo_a", k); got != want {
			t.Errorf("Pung's LFO A reaches %s: %v, want %v", k, got, want)
		}
	}
	if !m.reaches(cm, "lfo1", "fourpole") {
		t.Error("the module's own source reaches what its map names, a switch included")
	}
	if isPungSource("p_env") || !isPungSource("p_press") {
		t.Error("Pung's sources by their whole ids")
	}
	// the engine takes no route to a choice
	useFakeChain(t, map[string]string{"synth:fourpole": "1"})
	pm := (&Slot{}).pmod()
	pm.setRoute("synth:fourpole", "p_lfo_a", 0.5, true, cm.Params["fourpole"])
	if n := len(pm.conf.Load().Routes); n != 0 {
		t.Fatalf("a route to a switch was kept (%d)", n)
	}
	// MORE: the page with a destination that matters before the slots' page
	cm.Banks = []bank{{Name: "Slots", Keys: []string{"out_gain", "bend_range", "slot"}}, {Name: "Filter", Keys: []string{"cutoff", "fourpole", "drive"}}}
	var got []string
	for _, p := range morePagesOf(nil, cm, m, "p_lfo_a") {
		got = append(got, p.name+":"+strings.Join(p.keys, ","))
	}
	if strings.Join(got, " ") != "Filter:cutoff,drive Slots:out_gain,bend_range" {
		t.Fatalf("MORE for LFO A: %v", got)
	}
}

// Pressure follows the keys: the newest held key's own pressure, or the
// channel's, and nothing once the keys are let go, whether or not a last 0
// came; the wheel stays where it was left.
func TestPungModPressureFollowsKeys(t *testing.T) {
	pm := (&Slot{}).pmod()
	press := func() float64 { return pm.srcVal("p_press") }
	steps := []struct {
		msg  []byte
		want float64
	}{
		{[]byte{0xA0, 60, 100}, 0},         // pressure on a key that is not held
		{[]byte{0x90, 60, 90}, 0},          // C held
		{[]byte{0xA0, 60, 127}, 1},         // its pressure
		{[]byte{0x90, 64, 90}, 0},          // E held, newer: its own pressure, none yet
		{[]byte{0xA0, 64, 64}, 64.0 / 127}, //
		{[]byte{0xA0, 60, 10}, 64.0 / 127}, // the older key's changes nothing
		{[]byte{0x80, 64, 0}, 10.0 / 127},  // E let go: back to C's
		{[]byte{0x90, 60, 0}, 0},           // C let go (note-on at 0), no last pressure sent: 0
		{[]byte{0x90, 48, 90}, 0},          // channel pressure under a key
		{[]byte{0xD0, 80}, 80.0 / 127},
		{[]byte{0xB0, 123, 0}, 0}, // all notes off
		{[]byte{0x90, 48, 90}, 0}, // a new key starts from nothing
	}
	for i, s := range steps {
		pm.midi(s.msg)
		if math.Abs(press()-s.want) > 1e-9 {
			t.Fatalf("step %d (% X): pressure %v, want %v", i, s.msg, press(), s.want)
		}
	}
	pm.midi([]byte{0xB0, 1, 100})
	pm.midi([]byte{0x80, 48, 0})
	if math.Abs(pm.srcVal("p_wheel")-100.0/127) > 1e-9 {
		t.Fatal("the wheel stays where it was left")
	}
}

// An LFO's rate now, free or at Live's tempo, and the emulator's limit
func TestPungModHzAndEmulator(t *testing.T) {
	if pmodHz(pmodLFO{Rate: 3}) != 3 {
		t.Fatal("a free LFO runs at its rate")
	}
	var bar int
	for i, d := range pmodDivs {
		if d.beats == 4 {
			bar = i
		}
	}
	if bar == 0 {
		t.Fatal("no bar division")
	}
	if hz := pmodHz(pmodLFO{Div: bar}); math.Abs(hz-0.5) > 1e-9 { // 120 bpm while Live has not said
		t.Fatalf("a bar at 120 bpm: %v Hz", hz)
	}
	if !newPungMod(&Slot{}, true).emulated() || newPungMod(&Slot{}, false).emulated() {
		t.Fatal("an emulator is written every 20 ms")
	}
}
