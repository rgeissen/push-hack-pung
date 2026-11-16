package main

// controls_test.go: every control of the Pung view means what it means on
// Push 3's own device view (measured on a Push, 2026-11-16; surface.go's
// header has the table). A control whose meaning drifts fails here.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/push3"
)

// Push's rows, as measured: ten pages show seven and an arrow; each press
// of the arrow moves the row by one, with an arrow back on the first button.
func TestRowSlotsScrollAsPushDoes(t *testing.T) {
	L, R, N := slotLeft, slotRight, slotNone
	for _, c := range []struct {
		off, n int
		want   [8]int
	}{
		{0, 3, [8]int{0, 1, 2, N, N, N, N, N}},
		{0, 8, [8]int{0, 1, 2, 3, 4, 5, 6, 7}},
		{0, 10, [8]int{0, 1, 2, 3, 4, 5, 6, R}}, // Meld: Main .. Mix, ->
		{1, 10, [8]int{L, 2, 3, 4, 5, 6, 7, R}}, // <-, Filters .. Global/Out, ->
		{2, 10, [8]int{L, 3, 4, 5, 6, 7, 8, 9}}, // <-, Envelopes .. Settings
		{1, 9, [8]int{L, 2, 3, 4, 5, 6, 7, 8}},
	} {
		if got := rowSlots(c.off, c.n); got != c.want {
			t.Errorf("rowSlots(%d, %d) = %v, want %v", c.off, c.n, got, c.want)
		}
	}
	// every thing can be brought onto the row, from anywhere
	for n := 1; n <= 20; n++ {
		for off := 0; off <= n; off++ {
			for i := 0; i < n; i++ {
				o := rowShow(off, n, i)
				found := false
				for _, s := range rowSlots(o, n) {
					found = found || s == i
				}
				if !found {
					t.Fatalf("rowShow(%d, %d, %d) = %d does not show it", off, n, i, o)
				}
			}
		}
	}
	if o := rowShow(0, 10, 3); o != 0 {
		t.Errorf("a page already on the row scrolled it to %d", o)
	}
}

// pungView: a surface following Live, with a Pung device ("Syn", 12 pages)
// selected on a track that holds three devices.
func pungView(t *testing.T) *surface {
	t.Helper()
	liveAddr = "127.0.0.1:1" // no Remote Script here: calls fail at once
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "syn")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"syn","name":"Syn","component_type":"sound_generator"}`), 0o644)
	deviceNames["Syn"] = "syn"
	t.Cleanup(func() { delete(deviceNames, "Syn") })
	h := &Host{modulesDir: root, settings: loadSettings(t.TempDir())}
	u := &surface{h: h, view: "chain", touched: -1, peekEnc: -1, focus: -1, meta: map[string]*compMeta{}, vals: map[string]string{},
		leds: map[uint16]uint8{}, ov: newOverrides()}
	u.live = newLive(h)
	u.live.connected.Store(true)
	def := 0.25
	cm := &compMeta{Params: map[string]*paramMeta{}}
	for b := 0; b < 12; b++ {
		bk := bank{Name: fmt.Sprintf("Page %d", b+1)}
		for k := 0; k < 8; k++ {
			key := fmt.Sprintf("p%d_%d", b, k)
			cm.Params[key] = &paramMeta{Key: key, Name: key, Type: "float", Min: 0, Max: 1, Default: &def}
			bk.Keys = append(bk.Keys, key)
		}
		cm.Banks = append(cm.Banks, bk)
	}
	u.meta["live|syn"] = cm
	s := u.live.state()
	s.mu.Lock()
	s.dev = liveDevice{Track: json.RawMessage("1"), Device: 1, Name: "Syn"}
	s.path = []int{1}
	s.devs = []liveDevSummary{{I: 0, Name: "Arp", Active: true}, {I: 1, Name: "Syn", Active: true}, {I: 2, Name: "Reverb", Active: true}}
	s.trackDevs, s.selTop = s.devs, 1
	s.tracks = []liveTrack{{Ref: json.RawMessage("0"), Name: "A"}, {Ref: json.RawMessage("1"), Name: "B"}, {Ref: json.RawMessage("2"), Name: "C"}}
	s.resolved, s.paramsKey = s.selID(), s.selID()
	s.mu.Unlock()
	u.refreshLive()
	if !u.liveReady {
		t.Fatal("the test's device is not ready")
	}
	for k := range cm.Params {
		u.vals[u.valKey(u.positions[u.pos], k)] = "0.5000"
	}
	return u
}

func press(u *surface, cc byte) { u.cc(cc, 127); u.cc(cc, 0) }

func TestTwoLevelsAsOnPush(t *testing.T) {
	u := pungView(t)
	top, bot := func(i int) byte { return push3.CCScreenTop1 + byte(i) }, func(i int) byte { return push3.CCScreenBot1 + byte(i) }

	// chain level: the upper row is the track's devices
	if u.open || u.deviceSlots() != [8]int{0, 1, 2, slotNone, slotNone, slotNone, slotNone, slotNone} {
		t.Fatalf("chain level: open %v, devices %v", u.open, u.deviceSlots())
	}
	press(u, bot(2)) // a track: nothing opens, no page changes
	if u.open || u.bank != 0 {
		t.Fatal("a track's button changed the device view")
	}
	press(u, top(1)) // the selected device's button opens it
	if !u.open {
		t.Fatal("the selected device's button did not open it")
	}
	// open: the lower row is its pages, seven and an arrow
	if got := u.pageSlots(); got != [8]int{0, 1, 2, 3, 4, 5, 6, slotRight} {
		t.Fatalf("open: pages %v", got)
	}
	press(u, bot(3))
	if u.bank != 3 {
		t.Fatalf("lower button 4 shows page %d, want 4", u.bank+1)
	}
	press(u, bot(7)) // the arrow scrolls; the page stays
	if u.bank != 3 || u.pageSlots() != [8]int{slotLeft, 2, 3, 4, 5, 6, 7, slotRight} {
		t.Fatalf("after ->: page %d, row %v", u.bank+1, u.pageSlots())
	}
	press(u, bot(0))
	if u.pageSlots()[0] != 0 {
		t.Fatalf("<- did not scroll back: %v", u.pageSlots())
	}
	press(u, top(3)) // open: the other upper buttons are not devices
	if !u.open {
		t.Fatal("an upper button other than the first closed the device")
	}
	press(u, top(0)) // back
	if u.open || u.bank != 3 {
		t.Fatalf("back: open %v, page %d (it keeps its page)", u.open, u.bank+1)
	}

	// the jog wheel: a focus along the devices; its press opens the selected one
	u.cc(push3.CCJogWheel, 1)
	if u.focus != 2 || u.open || u.bank != 3 {
		t.Fatalf("jog at chain level: focus %d, open %v, page %d", u.focus, u.open, u.bank+1)
	}
	u.cc(push3.CCJogWheel, 127)
	press(u, push3.CCJogPress)
	if !u.open {
		t.Fatal("jog press on the selected device did not open it")
	}
	// open: the jog steps the pages (and the row follows), nudge left goes back
	for i := 0; i < 6; i++ {
		u.cc(push3.CCJogWheel, 1)
	}
	if u.bank != 9 {
		t.Fatalf("jog in an open device: page %d, want 10", u.bank+1)
	}
	shown := false
	for _, s := range u.pageSlots() {
		shown = shown || s == u.bank
	}
	if !shown {
		t.Fatalf("the page row %v does not show page %d", u.pageSlots(), u.bank+1)
	}
	press(u, push3.CCJogClickLeft)
	if u.open {
		t.Fatal("jog nudge left did not go back")
	}
	// Page < > step pages at both levels (Pung's shortcut)
	press(u, push3.CCPageLeft)
	if u.bank != 8 {
		t.Fatalf("Page <: page %d", u.bank+1)
	}
	// the D-pad is the tracks': the device view does not move
	press(u, push3.CCDPadRight)
	if u.bank != 8 || u.open {
		t.Fatal("the D-pad changed the page or opened the device")
	}
	// another device: back at chain level, as on Push
	press(u, top(1))
	st := u.live.state()
	st.mu.Lock()
	st.dev.Device, st.path, st.selTop = 0, []int{0}, 0
	st.resolved, st.paramsKey = st.selID(), st.selID()
	st.mu.Unlock()
	u.refreshLive()
	if u.open || u.focus != -1 {
		t.Fatalf("another device selected: open %v focus %d", u.open, u.focus)
	}
}

func TestPushVerbs(t *testing.T) {
	u := pungView(t)
	p, cm, b := u.currentBank()
	key := b.Keys[2]
	// Delete + touch: back to the default
	u.cc(push3.CCDelete, 127)
	u.handle([]byte{0x90, 2, 127})
	u.handle([]byte{0x80, 2, 0})
	u.cc(push3.CCDelete, 0)
	if got := u.vals[u.valKey(p, key)]; got != "0.2500" {
		t.Fatalf("Delete + touch left %q, want the default 0.2500", got)
	}
	// a touch alone changes nothing
	u.handle([]byte{0x90, 3, 127})
	u.handle([]byte{0x80, 3, 0})
	if got := u.vals[u.valKey(p, b.Keys[3])]; got != "0.5000" {
		t.Fatalf("a touch changed the value to %q", got)
	}
	_ = cm
	// Mute + a device's button: off, and on again; it is not selected or opened
	u.cc(push3.CCMute, 127)
	u.cc(push3.CCScreenTop1+2, 127)
	u.cc(push3.CCScreenTop1+2, 0)
	u.cc(push3.CCMute, 0)
	devs, sel := u.live.state().deviceRow()
	if devs[2].Active || sel != 1 || u.open || !u.combo {
		t.Fatalf("Mute + device: active %v, selected %d, open %v, combo %v", devs[2].Active, sel, u.open, u.combo)
	}
	// Mute alone is Live's: nothing here changes
	before := fmt.Sprint(u.open, u.bank, u.focus)
	press(u, push3.CCMute)
	press(u, push3.CCSolo)
	if fmt.Sprint(u.open, u.bank, u.focus) != before || u.combo {
		t.Fatal("Mute or Solo alone did something in the view")
	}
	// Swap: the sounds (no sound library in this test: it stays in the view, without a fault)
	press(u, push3.CCSwap)
	time.Sleep(10 * time.Millisecond)
}

// A button that does nothing is dark; one that does is lit.
func TestLEDsSayWhatWorks(t *testing.T) {
	u := pungView(t)
	u.focused.Store(true)
	lit := func(cc byte) bool { return u.leds[uint16(cc)] != 0 }
	row := func(first byte) (out [8]bool) {
		for i := range out {
			out[i] = lit(first + byte(i))
		}
		return
	}
	u.paintLEDs()
	// chain level: three devices, three tracks; this is the middle track
	if got := row(push3.CCScreenTop1); got != [8]bool{true, true, true} {
		t.Errorf("device buttons lit %v", got)
	}
	if got := row(push3.CCScreenBot1); got != [8]bool{true, true, true} {
		t.Errorf("track buttons lit %v", got)
	}
	if !lit(push3.CCDPadLeft) || !lit(push3.CCDPadRight) {
		t.Error("D-pad left and right are dark with a track on each side")
	}
	if lit(push3.CCPageLeft) || !lit(push3.CCPageRight) {
		t.Error("Page < > on the first of 12 pages: < must be dark, > lit")
	}
	if lit(push3.CCAdd) || lit(push3.CCNew) {
		t.Error("Add or New is lit: they do nothing here")
	}
	// open: only the way back above; the pages and their arrow below
	press(u, push3.CCScreenTop1+1)
	u.paintLEDs()
	if got := row(push3.CCScreenTop1); got != [8]bool{true} {
		t.Errorf("open: upper buttons lit %v, want the first only", got)
	}
	if got := row(push3.CCScreenBot1); got != [8]bool{true, true, true, true, true, true, true, true} {
		t.Errorf("open: page buttons lit %v", got)
	}
}
