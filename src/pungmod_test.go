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
