package main

import (
	"strconv"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

func testClass(ps []livedevice.Param, banks [][]int) *sclass {
	c := &livedevice.Class{UID: livedevice.ClassUID("t", livedevice.Instrument, "t"), Name: "T", Kind: livedevice.Instrument, Params: ps, Banks: banks}
	sc := &sclass{Class: c, keyIdx: map[string]int{}, meta: make([]*paramMeta, len(ps)), role: make([]string, len(ps)), gateIdx: make([]int, len(ps))}
	for i, p := range ps {
		if p.Key != "" {
			sc.keyIdx[p.Key] = i
			sc.meta[i] = &paramMeta{}
		}
	}
	for _, b := range banks {
		sc.order = append(sc.order, b...)
	}
	return sc
}

func keysOf(c *livedevice.Class) []string {
	out := make([]string, len(c.Params))
	for i, p := range c.Params {
		out[i] = paramIdentity(p)
		if p.Type == livedevice.PadType {
			out[i] = "_"
		}
	}
	return out
}

// A parameter stays where the class last had it; a new one goes after all
// of them; one that is gone leaves a placeholder; the banks (Push's pages)
// follow, so Push shows the same.
func TestStableLayout(t *testing.T) {
	p := func(key, role string) livedevice.Param {
		return livedevice.Param{Key: key, Role: role, Type: "float", Max: 1}
	}
	pad := livedevice.Param{Type: livedevice.PadType}
	// as written last time: a, b, c, two effects' bpm (before roles), a placeholder
	prev := &livedevice.Class{Params: []livedevice.Param{p("synth:a", ""), p("synth:b", ""), p("synth:c", ""),
		p("midi_fx1:bpm", ""), p("midi_fx1:bpm", ""), pad}}
	// built now: x inserted before b, c gone, the effects tagged
	now := testClass([]livedevice.Param{p("synth:a", ""), p("synth:x", ""), p("synth:b", ""),
		p("midi_fx1:bpm", "fx:arp"), p("midi_fx1:bpm", "fx:brnc"), pad, pad},
		[][]int{{0, 1, 2, 5}, {3, 4, 6}})
	got := stableLayout(now, prev)
	// (the two placeholders built now fill c's slot and the old placeholder's)
	want := []string{"synth:a", "synth:b", "_", "midi_fx1:bpm@arp", "midi_fx1:bpm@brnc", "_", "synth:x"}
	if k := keysOf(got.Class); len(k) != len(want) {
		t.Fatalf("layout %v, want %v", k, want)
	} else {
		for i := range want {
			if k[i] != want[i] {
				t.Fatalf("layout %v, want %v", k, want)
			}
		}
	}
	// Push's first page: a, x, b and a placeholder, as built
	if b := got.Class.Banks[0]; len(b) != 4 || got.Class.Params[b[0]].Key != "synth:a" || got.Class.Params[b[1]].Key != "synth:x" || got.Class.Params[b[2]].Key != "synth:b" {
		t.Errorf("bank 1 %v", b)
	}
	if got.keyIdx["synth:x"] != 6 || got.keyIdx["synth:b"] != 1 || got.meta[6] == nil || got.meta[2] != nil {
		t.Errorf("keys and meta follow: %v", got.keyIdx)
	}
	if err := got.Class.Check(); err != nil {
		t.Fatal(err)
	}

	// the next start: written with roles; an effect's parameters added before the others
	again := testClass([]livedevice.Param{p("synth:a", ""), p("synth:x", ""), p("synth:b", ""),
		p("midi_fx1:bpm", "fx:aaa"), p("midi_fx1:bpm", "fx:arp"), p("midi_fx1:bpm", "fx:brnc")}, [][]int{{0, 1, 2, 3, 4, 5}})
	g2 := stableLayout(again, got.Class)
	for _, c := range []struct {
		id string
		at int
	}{{"synth:a", 0}, {"synth:b", 1}, {"midi_fx1:bpm@arp", 3}, {"midi_fx1:bpm@brnc", 4}, {"synth:x", 6}, {"midi_fx1:bpm@aaa", 7}} {
		if c.at >= len(g2.Class.Params) || paramIdentity(g2.Class.Params[c.at]) != c.id {
			t.Errorf("%s not at %d: %v", c.id, c.at, keysOf(g2.Class))
		}
	}

	// a class new to Live: as built
	fresh := testClass([]livedevice.Param{p("synth:a", "")}, [][]int{{0}})
	if stableLayout(fresh, nil) != fresh {
		t.Error("a new class is laid out as built")
	}
}

// One that would not fit Live's list is laid out afresh, not cut.
func TestStableLayoutTooLong(t *testing.T) {
	var prevPs, curPs []livedevice.Param
	for i := 0; i < livedevice.MaxParams; i++ {
		prevPs = append(prevPs, livedevice.Param{Key: "synth:p" + string(rune('A'+i%26)) + string(rune('a'+i/26)), Type: "float", Max: 1})
	}
	curPs = append(curPs, livedevice.Param{Key: "synth:new", Type: "float", Max: 1})
	curPs = append(curPs, prevPs...)
	sc := testClass(curPs, [][]int{{0}})
	if stableLayout(sc, &livedevice.Class{Params: prevPs}) != sc {
		t.Error("a layout past Live's list must not be made")
	}
}

// A class as full as Live's list (Vivace's, 255 of 256): its new parameters
// take placeholder slots, nothing moves, nothing is laid out afresh.
func TestStableLayoutFullClass(t *testing.T) {
	var prev []livedevice.Param
	for i := 0; i < livedevice.MaxParams-1; i++ {
		if i%10 == 9 {
			prev = append(prev, livedevice.Param{Type: livedevice.PadType})
		} else {
			prev = append(prev, livedevice.Param{Key: "synth:p" + strconv.Itoa(i), Type: "float", Max: 1})
		}
	}
	// built now: the same keyed parameters, three new ones, placeholders after
	var cur []livedevice.Param
	for _, p := range prev {
		if p.Key != "" {
			cur = append(cur, p)
		}
	}
	for _, k := range []string{"synth:osc_1_wt_class", "synth:osc_1_wt", "synth:osc_2_wt_class"} {
		cur = append(cur, livedevice.Param{Key: k, Type: "int", Max: 9})
	}
	for i := 0; i < 20; i++ {
		cur = append(cur, livedevice.Param{Type: livedevice.PadType})
	}
	sc := testClass(cur, [][]int{{0, 1}})
	got := stableLayout(sc, &livedevice.Class{Params: prev})
	if got == sc {
		t.Fatal("laid out afresh")
	}
	if len(got.Class.Params) > livedevice.MaxParams {
		t.Fatalf("%d entries", len(got.Class.Params))
	}
	for i, p := range prev {
		if p.Key != "" && got.Class.Params[i].Key != p.Key {
			t.Fatalf("%s moved from %d", p.Key, i)
		}
	}
	for _, k := range []string{"synth:osc_1_wt_class", "synth:osc_1_wt", "synth:osc_2_wt_class"} {
		if _, ok := got.keyIdx[k]; !ok {
			t.Errorf("%s left out", k)
		}
	}
	if err := got.Class.Check(); err != nil {
		t.Fatal(err)
	}
}
