package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

func lcParams(keys ...string) []livedevice.Param {
	var out []livedevice.Param
	for _, k := range keys {
		out = append(out, livedevice.Param{Name: k, Key: k, Type: "float", Max: 1})
	}
	return out
}

func testSClass(uid string, keys ...string) *sclass {
	var ps []vstParam
	for _, p := range lcParams(keys...) {
		ps = append(ps, vstParam{Param: p, meta: &paramMeta{Key: p.Key, Type: "float", Max: 1}})
	}
	sc := finish(uid, livedevice.Instrument, "Instrument", uid, "Pung", ps, [][]int{{0, 1}}, nil)
	sc.UID = uid
	return sc
}

// Live has a layout that Pung's new build ordered differently: the class
// keeps Live's positions, each still meaning its own key; a class Live has
// unchanged, and one Live does not know (a new module), are served as built.
func TestLayoutKeptWhileLiveRuns(t *testing.T) {
	changed := testSClass("A", "synth:cutoff", "synth:reso", "synth:mode")
	same := testSClass("B", "synth:x", "synth:y")
	fresh := testSClass("C", "synth:z")
	live := []*livedevice.Class{
		{UID: "A", Params: lcParams("synth:mode", "synth:cutoff", "synth:gone"), Banks: [][]int{{0, 1, 2}}},
		same.Class,
	}
	out, kept := lockLayouts([]*sclass{changed, same, fresh}, live)
	if len(kept) != 1 || kept[0] != "A" {
		t.Fatalf("kept %v, want only A", kept)
	}
	if out[1] != same || out[2] != fresh {
		t.Fatal("a class Live has unchanged, and a new one, are served as built")
	}
	a := out[0]
	if a.Params[0].Key != "synth:mode" || a.keyIdx["synth:cutoff"] != 1 || a.meta[1] == nil || a.meta[1].Key != "synth:cutoff" {
		t.Fatalf("Live's position 1 must mean cutoff: %+v %v", a.Params[1], a.keyIdx)
	}
	if a.meta[2] != nil {
		t.Fatal("a key the module no longer has does nothing")
	}
	if changed.Params[0].Key != "synth:cutoff" {
		t.Fatal("the built class is left alone")
	}
	if out, kept := lockLayouts([]*sclass{changed}, nil); out[0] != changed || kept != nil {
		t.Fatal("no Live layout known: as built")
	}
}

// What Live loaded: the class file when Live started after it was written
// (and a copy is kept), else the copy kept for this very Live.
func TestLayoutLiveHas(t *testing.T) {
	dir := t.TempDir()
	cf, keep := filepath.Join(dir, "classes.json"), filepath.Join(dir, "classes.live.json")
	write := func(keys ...string) {
		doc, _ := json.Marshal(livedevice.ClassFile{Version: 1, Classes: []*livedevice.Class{{UID: "A", Params: lcParams(keys...)}}})
		os.WriteFile(cf, doc, 0o644)
	}
	write("old1", "old2")
	old := time.Now().Add(-time.Hour)
	os.Chtimes(cf, old, old)
	liveStart := time.Now().Add(-30 * time.Minute) // Live started after the file
	got := layoutLiveHas(cf, keep, liveStart)
	if len(got) != 1 || got[0].Params[0].Key != "old1" {
		t.Fatalf("Live has the file it started after: %+v", got)
	}
	// Pung wrote a new file while that Live ran on: Live still has the copy
	write("new1", "new2")
	got = layoutLiveHas(cf, keep, liveStart)
	if len(got) != 1 || got[0].Params[0].Key != "old1" {
		t.Fatalf("Live started before the new file: it has the kept copy, got %+v", got)
	}
	// another Live, started before the file, with no copy of its own: not known
	if got := layoutLiveHas(cf, keep, time.Now().Add(-2*time.Hour)); got != nil {
		t.Fatalf("a copy kept for another Live must not be used: %+v", got)
	}
}
