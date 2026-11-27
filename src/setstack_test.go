package main

import (
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// Each Pung device is given the place of one of Live's plugins of its name:
// the only one where there is one, the best fit where there are several, and
// no plugin twice; a device Live shows no plugin for has no place.
func TestPlaceDevices(t *testing.T) {
	mk := func(name string) *device {
		return &device{c: &sclass{Class: &livedevice.Class{Name: name}}, s: &Slot{}}
	}
	dexA, dexB, vial, lost := mk("Dexed"), mk("Dexed"), mk("Vial"), mk("Hera")
	plugs := []livePlug{
		{place: stackPlace{Track: "1-Dexed", TrackIndex: 0, Path: []int{0, 0, 0}, Name: "Dexed"}},
		{place: stackPlace{Track: "2-Vial", TrackIndex: 1, Path: []int{0}, Name: "Vial"}},
		{place: stackPlace{Track: "3-Dexed", TrackIndex: 2, Path: []int{0, 0, 0}, Name: "Dexed"}},
	}
	// dexA sounds like the plugin on track 3, dexB like the one on track 1
	cost := func(d *device, p livePlug) float64 {
		if (d == dexA) == (p.place.TrackIndex == 2) {
			return 0.1
		}
		return 5
	}
	got := placeDevices([]*device{dexA, dexB, vial, lost}, plugs, cost)
	if got[dexA] == nil || got[dexA].TrackIndex != 2 || got[dexB] == nil || got[dexB].TrackIndex != 0 {
		t.Errorf("two of a kind by their fit: %+v %+v", got[dexA], got[dexB])
	}
	if got[vial] == nil || got[vial].Track != "2-Vial" {
		t.Errorf("the only one of its kind: %+v", got[vial])
	}
	if got[lost] != nil {
		t.Errorf("a device Live shows no plugin for was placed: %+v", got[lost])
	}
}

// A project's stack against a deployment: each module once, asked for in the
// newest version any device was saved with, with the first thing in its way;
// only a module that leads a device must be in the host.
func TestCheckSet(t *testing.T) {
	patch := func(mods ...stackModule) *stackDoc { return &stackDoc{Format: 1, Name: "x", Modules: mods} }
	st := &setStack{Format: setStackFormat, Entries: []stackEntry{
		{Device: "instrument", Module: "dexed", Patch: patch(stackModule{Role: "midi_fx", ID: "superarp", Version: "1.0.0"}, stackModule{Role: "synth", ID: "dexed", Version: "0.3.0"})},
		{Device: "instrument", Module: "dexed", Patch: patch(stackModule{Role: "synth", ID: "dexed", Version: "0.3.2"})},
		{Device: "instrument", Module: "vial", Patch: patch(stackModule{Role: "synth", ID: "vial", Version: "1.0.1"})},
		{Device: "instrument", Module: "xenia", Patch: patch(stackModule{Role: "synth", ID: "xenia", Version: "0.2.0"})},
		{Device: "effect", Module: "cloudseed", Patch: patch(stackModule{Role: "audio_fx", ID: "cloudseed", Version: "0.3.9"})},
		{Device: "instrument", Module: "gone", Patch: patch(stackModule{Role: "synth", ID: "gone", Version: "1.0.0"})},
		{Device: "instrument", Module: "newer", Patch: patch(stackModule{Role: "synth", ID: "newer", Version: "2.0.0"})},
	}}
	facts := map[string]moduleFacts{
		"superarp":  {Have: true, Here: "1.0.0", Known: true},                              // a MIDI effect in front: need not be a device of its own
		"dexed":     {Have: true, Here: "0.3.1", Known: true, InHost: true, Name: "Dexed"}, // older than the second device was saved with
		"vial":      {Known: true},                                                         // in the pack, not here
		"xenia":     {Have: true, Here: "0.2.0", Known: true, InHost: true, Firmware: []string{"ROM"}},
		"cloudseed": {Have: true, Here: "0.4.0", Known: true}, // installed, not yet a device in the host
		"newer":     {Known: true, MinPung: "0.9.0"},
	}
	got := checkSet(st, func(id string) moduleFacts { return facts[id] })
	want := []struct {
		id, state, detail, wanted string
		uses                      int
	}{
		{"superarp", "ready", "", "1.0.0", 1},
		{"dexed", "update", "0.3.2", "0.3.2", 2},
		{"vial", "install", "", "1.0.1", 1},
		{"xenia", "firmware", "ROM", "0.2.0", 1},
		{"cloudseed", "restart", "", "0.3.9", 1},
		{"gone", "unknown", "", "1.0.0", 1},
		{"newer", "pung", "0.9.0", "2.0.0", 1},
	}
	if len(got) != len(want) {
		t.Fatalf("%d modules, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		g := got[i]
		if g.Module != w.id || g.State != w.state || g.Detail != w.detail || g.Wanted != w.wanted || g.Uses != w.uses {
			t.Errorf("%s: %+v, want %+v", w.id, g, w)
		}
	}
	if got[1].Name != "Dexed" || got[5].Name != "gone" {
		t.Errorf("names: %q (the deployment's own) and %q (its id where nothing names it)", got[1].Name, got[5].Name)
	}
}
