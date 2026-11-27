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
