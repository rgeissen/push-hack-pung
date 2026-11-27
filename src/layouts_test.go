package main

import (
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// A device's fresh layout names its own parameters in order, by their keys
// without the chain's prefix, and nothing that is not the module's: not the
// MIDI FX selector, not a MIDI effect's parameters, not an entry that only
// fills a page.
func TestFreshLayout(t *testing.T) {
	ps := []vstParam{}
	for _, k := range []string{"synth:cutoff", "synth:reso", "synth:mode"} {
		ps = append(ps, vstParam{Param: livedevice.Param{Name: k, Key: k, Type: "float", Max: 1}, meta: &paramMeta{Key: k, Type: "float", Max: 1}})
	}
	sel := len(ps)
	ps = append(ps, vstParam{Param: livedevice.Param{Name: "MIDI FX", Key: "midi_fx1:module", Type: "enum", Options: []string{"None", "Arp"}, Role: "midifx", Max: 1}})
	ps = append(ps, vstParam{Param: livedevice.Param{Name: "Arp Rate", Key: "midi_fx1:rate", Type: "float", Max: 1}, meta: &paramMeta{Key: "rate", Type: "float", Max: 1}, gate: "arp", gateIdx: 1})
	sc := finish("Test", livedevice.Instrument, "Instrument", "test", "Pung", ps, [][]int{{0, 1, 2}, {sel, sel + 1}}, []string{"", "arp"})
	got := freshLayoutOf(sc)
	if len(got.Keys) != 3 || got.Keys[0] != "cutoff" || got.Keys[1] != "reso" || got.Keys[2] != "mode" {
		t.Errorf("own parameters: %v", got.Keys)
	}
	if got.Module != "test" || got.Kind != livedevice.Instrument {
		t.Errorf("which device: %+v", got)
	}
	// its one page of three is filled to eight (the MIDI FX page follows it)
	if got.Entries != 8 {
		t.Errorf("its own page takes %d entries of Live's list, a whole page is 8", got.Entries)
	}
}
