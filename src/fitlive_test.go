package main

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// a module of n keys in banks of the given sizes, then a MIDI FX selector
// with fxRows rows of (selector + 7 gated keys) and fxExtra more gated keys
func bigClass(sizes []int, unbanked, fxRows, fxExtra int) ([]vstParam, [][]int) {
	var ps []vstParam
	var banks [][]int
	add := func(p vstParam) int { ps = append(ps, p); return len(ps) - 1 }
	for b, n := range sizes {
		var row []int
		for i := 0; i < n; i++ {
			row = append(row, add(vstParam{Param: livedevice.Param{Name: fmt.Sprintf("b%d.%d", b, i), Key: fmt.Sprintf("synth:b%d_%d", b, i), Type: "float", Max: 1}}))
		}
		banks = append(banks, row)
	}
	for i := 0; i < unbanked; i++ {
		add(vstParam{Param: livedevice.Param{Name: fmt.Sprintf("u%d", i), Key: fmt.Sprintf("synth:u%d", i), Type: "float", Max: 1}})
	}
	if fxRows > 0 {
		sel := add(vstParam{Param: livedevice.Param{Name: "MIDI FX", Key: "midi_fx1:module", Type: "enum", Role: "midifx"}})
		for r := 0; r < fxRows; r++ {
			row := []int{sel}
			for i := 0; i < 7+fxExtra; i++ {
				j := add(vstParam{Param: livedevice.Param{Name: fmt.Sprintf("fx%d.%d", r, i), Key: fmt.Sprintf("midi_fx1:f%d_%d", r, i), Type: "float", Max: 1}, gateIdx: r + 1})
				if i < 7 {
					row = append(row, j)
				}
			}
			banks = append(banks, row)
		}
	}
	return ps, banks
}

func TestFitLiveLeavesASmallClassAlone(t *testing.T) {
	ps, banks := bigClass([]int{8, 5, 8}, 3, 2, 2)
	ps2, banks2 := fitLive(ps, banks)
	if !reflect.DeepEqual(ps, ps2) || !reflect.DeepEqual(banks, banks2) {
		t.Fatal("a class within Live's list must keep every parameter at its index (its IDs)")
	}
}

func TestFitLiveCutsWholeBanksAndKeepsTheMidiFX(t *testing.T) {
	sizes := make([]int, 50)
	for i := range sizes {
		sizes[i] = 8
	}
	sizes[3] = 6 // a short bank: padded to a page
	ps, banks := bigClass(sizes, 30, 4, 3)
	sc := finish("Big", livedevice.Instrument, "Instrument", "big", "Pung", ps, banks, []string{"", "a", "b", "c", "d"})
	c := sc.Class
	if len(c.Params) > livedevice.MaxParams {
		t.Fatalf("%d parameters, Live takes %d", len(c.Params), livedevice.MaxParams)
	}
	for b, bank := range c.Banks {
		for _, i := range bank {
			if i >= len(c.Params) {
				t.Fatalf("bank %d points at %d, past Live's list (%d)", b+1, i, len(c.Params))
			}
		}
		if b < len(c.Banks)-1 && len(bank)%8 != 0 {
			t.Fatalf("bank %d has %d entries: every later page would shift", b+1, len(bank))
		}
	}
	// the module's pages from the first, in order, whole
	for b := 0; b < 4; b++ {
		want := fmt.Sprintf("b%d.0", b)
		if got := c.Params[c.Banks[b][0]].Name; got != want {
			t.Fatalf("Push's bank %d starts with %q, want %q", b+1, got, want)
		}
	}
	if n := c.Params[c.Banks[3][6]].Type; n != livedevice.PadType {
		t.Fatalf("the short bank 4 is padded, got %q at its 7th entry", n)
	}
	// the selector and every MIDI FX row are Live's
	sel, rows := -1, 0
	for b, bank := range c.Banks {
		for _, i := range bank {
			if c.Params[i].Key == "midi_fx1:module" {
				sel = b
			}
		}
		if len(bank) > 1 && sc.gateIdx[bank[1]] != 0 {
			rows++
		}
	}
	if sel < 0 || rows != 4 {
		t.Fatalf("MIDI FX selector in bank %d, %d rows of its effects; want it there and 4", sel, rows)
	}
	// and the per-index tables still describe the parameter at that index
	for i, p := range c.Params {
		if i < len(sc.role) && p.Role != sc.role[i] {
			t.Fatalf("index %d: role %q, table says %q", i, p.Role, sc.role[i])
		}
		if k, ok := sc.keyIdx[p.Key]; p.Key != "" && (!ok || k != i) {
			t.Fatalf("keyIdx[%s] = %d, it is at %d", p.Key, k, i)
		}
	}
}
