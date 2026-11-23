package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

func TestKeptStatesComeBackOnceForTheSameLive(t *testing.T) {
	dir, now := t.TempDir(), time.Now()
	held, cur := `{"chain":"saved"}`, `{"chain":"edited"}`
	write := func() {
		if err := writeKeptStates(dir, "920@4711", []keptEntry{{Key: stateKey(held), Module: "minijv", State: cur}}); err != nil {
			t.Fatal(err)
		}
	}

	write()
	k := loadKeptStates(dir, "920@4711", now)
	if _, err := os.Stat(filepath.Join(dir, keptStatesFile)); err != nil {
		t.Error("the file went at the start: a Pung that crashes before filing its own loses it")
	}
	if _, ok := k.take(held, "obxd", now); ok {
		t.Error("a state crossed modules")
	}
	if _, ok := k.take(`{"chain":"other"}`, "minijv", now); ok {
		t.Error("a device whose plugin holds another state got this one")
	}
	if st, ok := k.take(held, "minijv", now); !ok || st != cur {
		t.Errorf("the device's state from before the restart: %q %v", st, ok)
	}
	if _, ok := k.take(held, "minijv", now); ok {
		t.Error("one kept state, given twice")
	}

	write() // Live restarted in between: the Set's state is the truth
	if _, ok := loadKeptStates(dir, "1500@9000", now).take(held, "minijv", now); ok {
		t.Error("a kept state survived a restart of Live")
	}
	write() // Live not running
	if _, ok := loadKeptStates(dir, "", now).take(held, "minijv", now); ok {
		t.Error("a kept state given with no Live known")
	}
	write() // the Set loaded again later in the same Live
	k = loadKeptStates(dir, "920@4711", now)
	if _, ok := k.take(held, "minijv", now.Add(keptWindow+time.Second)); ok {
		t.Error("a kept state given long after the start")
	}

	// two devices of one module that Live holds the same state for: one each
	if err := writeKeptStates(dir, "1@1", []keptEntry{{stateKey(held), "minijv", "a"}, {stateKey(held), "minijv", "b"}}); err != nil {
		t.Fatal(err)
	}
	k = loadKeptStates(dir, "1@1", now)
	a, _ := k.take(held, "minijv", now)
	b, _ := k.take(held, "minijv", now)
	if a != "a" || b != "b" {
		t.Errorf("twins: %q %q", a, b)
	}

	// nothing to keep removes what was there
	write()
	writeKeptStates(dir, "920@4711", nil) //nolint:errcheck
	if _, err := os.Stat(filepath.Join(dir, keptStatesFile)); err == nil {
		t.Error("an empty keep left the old file")
	}
}

// A kept state no device took (its module was left out this time) is filed
// again at the next stop, for the same Live; a taken one is not.
func TestUntakenKeptStatesAreKeptAgain(t *testing.T) {
	dir, now := t.TempDir(), time.Now()
	taken, left := keptEntry{Key: stateKey("a"), Module: "minijv", State: "A"}, keptEntry{Key: stateKey("b"), Module: "ostirus", State: "B"}
	if err := writeKeptStates(dir, "920@4711", []keptEntry{taken, left}); err != nil {
		t.Fatal(err)
	}
	k := loadKeptStates(dir, "920@4711", now)
	if _, ok := k.take("a", "minijv", now); !ok {
		t.Fatal("minijv's kept state not given")
	}
	got := k.untaken("920@4711")
	if len(got) != 1 || got[0] != left {
		t.Fatalf("untaken %v, want only ostirus's", got)
	}
	if k.untaken("1500@9000") != nil {
		t.Error("untaken states carried into another Live")
	}
	if _, ok := k.take("b", "ostirus", now.Add(keptWindow+time.Second)); ok {
		t.Error("a kept state given long after the start")
	}
	if len(k.untaken("920@4711")) != 1 {
		t.Error("a state too late to be given is no longer filed again")
	}
}

// The states are filed while Pung runs (a Pung that hangs or crashes files
// nothing at its end): after the kept window, a changed device once it has
// been quiet, nothing after the stop's own write.
func TestKeptStatesFiledWhileRunning(t *testing.T) {
	dir, t0 := t.TempDir(), time.Now()
	live := "920@4711"
	defer func(f func() string) { runningLive = f }(runningLive)
	runningLive = func() string { return live }

	old := keptEntry{Key: stateKey("gone"), Module: "ostirus", State: "B"} // the Pung before's, never taken
	if err := writeKeptStates(dir, live, []keptEntry{old}); err != nil {
		t.Fatal(err)
	}
	p := &provider{h: &Host{dataDir: dir}, devs: map[int]*device{}, kept: loadKeptStates(dir, live, t0)}
	d := &device{p: p, c: &sclass{Class: &livedevice.Class{Name: "Mini-JV"}, module: "minijv"}, s: &Slot{Index: 3}}
	d.loading.Store(true) // its state is its last one (currentState), no module asked
	d.lastChain = json.RawMessage(`{"synth":{"module":"minijv"}}`)
	d.liveKey = stateKey("held")
	p.devs[3] = d
	d.s.dirty.Store(true) // made: its module set

	read := func() keptFile {
		t.Helper()
		var f keptFile
		raw, err := os.ReadFile(filepath.Join(dir, keptStatesFile))
		if err != nil {
			return f
		}
		if err := json.Unmarshal(raw, &f); err != nil {
			t.Fatal(err)
		}
		return f
	}
	mine := func(f keptFile) string {
		for _, e := range f.Entries {
			if e.Module == "minijv" && e.Key == stateKey("held") {
				return e.State
			}
		}
		return ""
	}
	k := &keepRun{start: t0, states: map[*device]string{}}
	at := func(s float64) time.Time { return t0.Add(time.Duration(s * float64(time.Second))) }

	p.keepTick(k, at(10))
	if f := read(); len(f.Entries) != 1 || f.Entries[0] != old {
		t.Fatalf("inside the kept window the file of the Pung before must stay: %+v", f)
	}
	p.keepTick(k, at(46))
	f := read()
	if !strings.Contains(mine(f), `"midi_fx":0`) {
		t.Fatalf("after the window, the device's state is filed under what its plugin holds: %+v", f)
	}
	if len(f.Entries) != 2 {
		t.Errorf("the untaken state of the Pung before is filed again: %d entries", len(f.Entries))
	}

	d.midiFX = 2 // the Pung view chose a MIDI effect
	d.s.dirty.Store(true)
	p.keepTick(k, at(47))
	if !strings.Contains(mine(read()), `"midi_fx":0`) {
		t.Error("a device still being changed was read")
	}
	p.keepTick(k, at(50))
	if !strings.Contains(mine(read()), `"midi_fx":2`) {
		t.Errorf("the change, once quiet, is not filed: %q", mine(read()))
	}

	d.liveMu.Lock()
	d.liveKey = stateKey("saved") // Live saved the Set: its plugin holds the newer state
	d.liveMu.Unlock()
	p.keepTick(k, at(52))
	if mine(read()) != "" {
		t.Error("the state is still filed under the key Live no longer holds")
	}
	d.liveKey = stateKey("held")
	p.keepTick(k, at(54))

	p.keepStates() // the stop
	d.midiFX = 1
	d.s.dirty.Store(true)
	p.keepTick(k, at(60))
	p.keepTick(k, at(64))
	if !strings.Contains(mine(read()), `"midi_fx":2`) {
		t.Errorf("written after the stop's own: %q", mine(read()))
	}
}

// A device gone from the Set is no longer filed.
func TestKeptStatesForgetARemovedDevice(t *testing.T) {
	dir, t0 := t.TempDir(), time.Now()
	defer func(f func() string) { runningLive = f }(runningLive)
	runningLive = func() string { return "1@1" }
	p := &provider{h: &Host{dataDir: dir}, devs: map[int]*device{}, kept: &keptStates{}}
	d := &device{p: p, c: &sclass{Class: &livedevice.Class{Name: "Xenia"}, module: "xenia"}, s: &Slot{Index: 1}}
	d.loading.Store(true)
	d.lastChain = json.RawMessage(`{}`)
	p.devs[1] = d
	k := &keepRun{start: t0, states: map[*device]string{}}
	p.keepTick(k, t0.Add(keptWindow+time.Second))
	if _, err := os.Stat(filepath.Join(dir, keptStatesFile)); err != nil {
		t.Fatal("the device is not filed")
	}
	delete(p.devs, 1)
	p.keepTick(k, t0.Add(keptWindow+3*time.Second))
	if _, err := os.Stat(filepath.Join(dir, keptStatesFile)); err == nil {
		t.Error("a removed device is still filed")
	}
}
