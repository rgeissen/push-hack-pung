package main

import (
	"strings"
	"testing"
	"time"
)

// An emulator starts only while half a core stays free with every emulator playing;
// one at rest is counted as if it played.
func TestGovernorKeepsRoom(t *testing.T) {
	cases := []struct {
		name    string
		module  string
		busy    float64
		engines map[string]float64
		running []string
		refused bool
	}{
		{"an idle Push takes OsTIrus", "ostirus", 60, nil, nil, false},
		// the heaviest pair played cleanly on a Push: it must start, each beside the other
		{"OsTIrus beside Nodal Red playing", "ostirus", 240, map[string]float64{"nodalred": 180}, []string{"nodalred"}, false},
		{"Nodal Red beside OsTIrus playing", "nodalred", 160, map[string]float64{"ostirus": 100}, []string{"ostirus"}, false},
		{"a busy Set leaves no room for Nodal Red", "nodalred", 200, nil, []string{"obxd"}, true},
		// Nodal Red at rest takes nothing now: 180 of the room is still its
		{"a rested emulator keeps its room", "ostirus", 150, map[string]float64{"nodalred": 0}, []string{"nodalred"}, true},
		{"the same Push with it playing is as full", "ostirus", 330, map[string]float64{"nodalred": 180}, []string{"nodalred"}, true},
		{"an ordinary module is never refused", "obxd", 390, nil, nil, false},
		{"a second of a kind waits by its own lock, not for room", "ostirus", 390, map[string]float64{"ostirus": 100}, []string{"ostirus"}, false},
	}
	for _, c := range cases {
		why := govRoom(c.module, c.busy, c.engines, c.running, 4)
		if (why != "") != c.refused {
			t.Errorf("%s: refused %v (%q), want %v", c.name, why != "", why, c.refused)
		}
		if why != "" && !strings.Contains(why, "starts when there is room") {
			t.Errorf("%s: the reason does not say it will start: %q", c.name, why)
		}
	}
}

// Every emulator of Pung's own rests, and has a cost for the room it needs.
func TestGovernorLimits(t *testing.T) {
	for _, id := range []string{"nodalred", "ostirus", "vavra", "xenia"} {
		l := limitsOf(id)
		if l == nil || !l.Emulator || !l.Rests {
			t.Errorf("%s: not an emulator that rests: %+v", id, l)
		}
		if l != nil && (l.cost() < 20 || l.cost() > 250) {
			t.Errorf("%s: cost %v of one core", id, l.cost())
		}
	}
	if canRest("obxd") || canRest("jp8000") {
		t.Error("a module that was not built to rest is told to")
	}
}

// Pung's LFOs leave a device alone only when it may rest, no key is held
// and it has been silent for a while; a key or a sound ends that at once.
func TestPungModLeavesTheUnheardAlone(t *testing.T) {
	t0 := time.Unix(1000, 0)
	un, since := pmodUnheard(true, false, false, time.Time{}, t0)
	if un || !since.Equal(t0) {
		t.Fatalf("silent a moment: unheard %v since %v", un, since)
	}
	if un, _ = pmodUnheard(true, false, false, since, t0.Add(pmodUnheardAfter-time.Millisecond)); un {
		t.Fatal("unheard before its time")
	}
	if un, since = pmodUnheard(true, false, false, since, t0.Add(pmodUnheardAfter)); !un {
		t.Fatal("silent long enough, still written")
	}
	if un, since = pmodUnheard(true, true, false, since, t0.Add(time.Hour)); un || !since.IsZero() {
		t.Fatal("a key is held: it is heard")
	}
	if un, since = pmodUnheard(true, false, true, t0, t0.Add(time.Hour)); un || !since.IsZero() {
		t.Fatal("it sounds: it is heard")
	}
	if un, _ = pmodUnheard(false, false, false, t0, t0.Add(time.Hour)); un {
		t.Fatal("a module that never rests is always written")
	}
}

// Schwung's emulators are rested from outside (rtloop.c), Pung's own by
// their engines: never both, and nothing that is no emulator.
func TestWhoRests(t *testing.T) {
	for id, l := range moduleLimits {
		if l.Rests && l.HostRests {
			t.Errorf("%s rests both ways", id)
		}
		if (l.Rests || l.HostRests) && !l.Emulator {
			t.Errorf("%s rests and is no emulator", id)
		}
		if rests(id) != (l.Rests || l.HostRests) {
			t.Errorf("%s: rests() disagrees with its limits", id)
		}
	}
	for _, id := range []string{"jp8000", "osirus"} {
		if !hostRests(id) || canRest(id) {
			t.Errorf("%s is rested by Pung's device thread", id)
		}
	}
	if rests("obxd") || rests("plaits") {
		t.Error("an ordinary instrument is always rendered")
	}
}

// The rule a Schwung emulator rests by (rtloop.c): rendered until it has been
// silent for the rest time with nothing sent to it, then looked at twice a
// second; a message or a block that sounds ends the rest in that block.
func TestHostRestRule(t *testing.T) {
	const after = 128 * 10 // ten blocks of silence
	n := 2000
	peaks, busy := make([]float32, n), make([]bool, n)
	for i := 0; i < 20; i++ {
		peaks[i] = 0.3 // it sounds first
	}
	busy[700] = true // a note: its block is rendered, and the ones after it
	for i := 700; i < 730; i++ {
		peaks[i] = 0.2
	}
	peaks[1380] = 2.0 / 32768 // under the level: still silence
	rendered, rests := hostRestSim(after, peaks, busy)
	for i := 0; i < 30; i++ {
		if !rendered[i] {
			t.Fatalf("block %d not rendered before the rest time was over", i)
		}
	}
	if rendered[31] || rendered[100] {
		t.Fatal("a rested module is rendered")
	}
	probes := 0
	for i := 31; i < 700; i++ {
		if rendered[i] {
			probes++
		}
	}
	if probes < 3 || probes > 4 { // 669 blocks of 128 frames, a look every 22050
		t.Fatalf("%d looks at a rested module in %d blocks", probes, 669)
	}
	for i := 700; i < 740; i++ {
		if !rendered[i] {
			t.Fatalf("block %d after a note is not rendered", i)
		}
	}
	if rendered[745] {
		t.Fatal("no rest after the note's sound was over")
	}
	if rests != 2 {
		t.Fatalf("%d rests, 2 expected", rests)
	}
	// a rested module that begins to sound by itself is heard from its next look on
	peaks2, busy2 := make([]float32, 600), make([]bool, 600)
	for i := 100; i < 600; i++ {
		peaks2[i] = 0.1
	}
	r2, _ := hostRestSim(after, peaks2, busy2)
	first := -1
	for i := 100; i < 600 && first < 0; i++ {
		if r2[i] {
			first = i
		}
	}
	if first < 0 || first > 100+173 {
		t.Fatalf("a module sounding by itself is heard from block %d", first)
	}
	for i := first; i < 600; i++ {
		if !r2[i] {
			t.Fatalf("block %d of a sounding module not rendered", i)
		}
	}
	// never, with no rest time
	r3, n3 := hostRestSim(0, make([]float32, 500), make([]bool, 500))
	_ = n3
	for i, ok := range r3 {
		if !ok {
			t.Fatalf("block %d not rendered with rest off", i)
		}
	}
}
