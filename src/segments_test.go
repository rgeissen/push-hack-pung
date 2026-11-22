package main

// segments_test.go: segment mode (segments.go). A front panel that declares
// segments gets upper button 7: SEGMENTS, then a lower button puts that
// segment's keys on the encoders, EXIT gives the overview's back. A module
// without segments is as it was.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/push3"
)

const segScreen = `
var last = {};
push.compartment({ id: "panel", label: "Panel", front_panel: true,
  pages: [ { label: "Main", keys: ["cut", "res", "env", "vol"] }, { label: "More", keys: ["lfo_rate"] } ],
  segments: [
    { id: "osc", label: "Osc", rect: [10, 30, 300, 70], keys: ["osc_wave", "osc_tune", "", "osc_mix"] },
    { id: "flt", label: "Filter", rect: [320, 30, 300, 70], keys: ["cut", "res"] },
    { id: "amp", rect: [630, 30, 300, 70], keys: ["vol"] }
  ],
  screen: function (g, v) {
    last = { mode: v.$segmode, seg: v.$segment, knobs: (v.$knobs || []).join(","), tabs: (v.$tabs || []).join(","),
      tab: v.$tab, n: v.$segments.length, first: v.$segments[0].id + "@" + v.$segments[0].rect.join(","),
      wave: v.osc_wave ? v.osc_wave.display : "none" };
    g.knobs({});
  } });
push.compartment({ id: "plain", label: "Plain", front_panel: true, keys: ["x"], screen: function (g, v) { g.knobs({}); } });
push.compartment({ id: "band", label: "Band", keys: ["y"] });
`

// segView: a surface following Live with a Pung device ("Seg") whose
// screen file declares a front panel with three segments, then a front
// panel and a page without.
func segView(t *testing.T, screen string) *surface {
	t.Helper()
	initFaces()
	liveAddr = "127.0.0.1:1"
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "seg")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"seg","name":"Seg","component_type":"sound_generator"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "push_ui.js"), []byte(screen), 0o644)
	deviceNames["Seg"] = "seg"
	t.Cleanup(func() { delete(deviceNames, "Seg") })
	h := &Host{modulesDir: root, settings: loadSettings(t.TempDir())}
	u := &surface{h: h, view: "chain", touched: -1, peekEnc: -1, focus: -1, meta: map[string]*compMeta{}, vals: map[string]string{},
		leds: map[uint16]uint8{}, ov: newOverrides()}
	u.live = newLive(h)
	u.live.connected.Store(true)
	set := u.ov.get(root, "seg")
	if set == nil || set.failed != "" {
		t.Fatalf("the test's screen file does not load: %+v", set)
	}
	def := 0.25
	cm := &compMeta{Params: map[string]*paramMeta{}}
	for _, k := range []string{"cut", "res", "env", "vol", "lfo_rate", "osc_wave", "osc_tune", "osc_mix", "x", "y"} {
		cm.Params[k] = &paramMeta{Key: k, Name: k, Type: "float", Min: 0, Max: 1, Default: &def}
	}
	u.meta["live|seg"] = withCompartments(cm, set.compartments)
	s := u.live.state()
	s.mu.Lock()
	s.dev = liveDevice{Track: json.RawMessage("1"), Device: 1, Name: "Seg"}
	s.path = []int{1}
	s.devs = []liveDevSummary{{I: 0, Name: "Arp", Active: true}, {I: 1, Name: "Seg", Active: true}}
	s.trackDevs, s.selTop = s.devs, 1
	s.tracks = []liveTrack{{Ref: json.RawMessage("0"), Name: "A"}, {Ref: json.RawMessage("1"), Name: "B"}}
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

// seen: what the panel's screen was last told (its global "last").
func seen(t *testing.T, u *surface) map[string]any {
	t.Helper()
	u.render(0)
	set := u.ov.get(u.h.modulesDir, "seg")
	set.mu.Lock()
	defer set.mu.Unlock()
	m, _ := set.vm.Get("last").Export().(map[string]any)
	return m
}

func upper(i int) byte { return push3.CCScreenTop1 + byte(i) }
func lower(i int) byte { return push3.CCScreenBot1 + byte(i) }

func TestSegmentMode(t *testing.T) {
	u := segView(t, segScreen)
	u.focused.Store(true) // the LEDs are written only while Pung has the surface
	p, cm, b := u.currentBank()
	if !u.open || b.Compartment != "panel" {
		t.Fatalf("the front panel did not open with its device: open %v, %q", u.open, b.Compartment)
	}
	lit := func(cc byte) uint8 { return u.leds[uint16(cc)] }

	// the overview: upper 7 offers SEGMENTS (lit, not white); the lower row is the pages
	u.paintLEDs()
	if lit(upper(segmentsButton)) == 0 || lit(upper(segmentsButton)) == ledChosen {
		t.Fatalf("upper 7 on a panel with segments: light %d, want an option's", lit(upper(segmentsButton)))
	}
	if got := seen(t, u); got["mode"] != "" || got["knobs"] != "cut,res,env,vol,,,," || got["n"] != int64(3) ||
		got["first"] != "osc@10,30,300,70" || got["wave"] == "none" {
		t.Fatalf("the overview's screen was told %v", got)
	}

	// SEGMENTS: select mode; the lower buttons name the segments
	press(u, upper(segmentsButton))
	if u.segMode != segSelect || !u.open {
		t.Fatalf("SEGMENTS: mode %q, open %v", u.segMode, u.open)
	}
	img := u.render(0)
	sc := slotColor(u.slot)
	if c := img.NRGBAAt(10+200, 30); c != sc {
		t.Errorf("select mode: the Osc segment's outline is not drawn (%v at its top edge)", c)
	}
	if c := img.NRGBAAt(320+150, 99); c != sc {
		t.Errorf("select mode: the Filter segment's outline is not drawn (%v at its bottom edge)", c)
	}
	if got := seen(t, u); got["mode"] != "select" || got["tabs"] != "Osc,Filter,amp,,,,," || got["tab"] != int64(-1) || got["knobs"] != "cut,res,env,vol,,,," {
		t.Fatalf("select mode: the screen was told %v", got)
	}
	u.paintLEDs()
	if lit(upper(segmentsButton)) != ledChosen {
		t.Error("select mode: upper 7 is not white")
	}
	for i := 0; i < 8; i++ {
		if on := lit(lower(i)) != 0; on != (i < 3) {
			t.Errorf("select mode: lower button %d lit %v (three segments)", i+1, on)
		}
	}
	// a lower button past the segments: nothing, and never a page turn
	press(u, lower(5))
	if u.segMode != segSelect || u.bank != 0 {
		t.Fatalf("lower 6 with three segments: mode %q, page %d", u.segMode, u.bank)
	}
	// upper 7 again cancels; so does upper 1, which does not leave the device then
	press(u, upper(segmentsButton))
	if u.segMode != "" || !u.open {
		t.Fatalf("SEGMENTS again: mode %q, open %v", u.segMode, u.open)
	}
	press(u, upper(segmentsButton))
	press(u, upper(0))
	if u.segMode != "" || !u.open {
		t.Fatalf("upper 1 while choosing: mode %q, open %v (it cancels, it does not leave)", u.segMode, u.open)
	}
	press(u, upper(segmentsButton))
	press(u, push3.CCJogClickLeft)
	if u.segMode != "" || !u.open {
		t.Fatalf("a jog nudge left while choosing: mode %q, open %v", u.segMode, u.open)
	}

	// a segment: the encoders play its keys
	press(u, upper(segmentsButton))
	press(u, lower(0))
	if u.segMode != segSegment || u.segID != "osc" {
		t.Fatalf("lower 1 in select mode: mode %q, segment %q", u.segMode, u.segID)
	}
	u.cc(push3.CCEncoder1, 1)
	if got := u.vals[u.valKey(p, "osc_wave")]; got == "0.5000" {
		t.Error("encoder 1 in the Osc segment did not turn osc_wave")
	}
	if got := u.vals[u.valKey(p, "cut")]; got != "0.5000" {
		t.Errorf("encoder 1 in the Osc segment turned the overview's cut (%s)", got)
	}
	u.cc(push3.CCEncoder1+2, 1) // an empty encoder of the segment
	if got := u.vals[u.valKey(p, "env")]; got != "0.5000" {
		t.Errorf("the segment's empty encoder 3 turned the overview's env (%s)", got)
	}
	// Delete + touch resets the segment's key
	u.cc(push3.CCDelete, 127)
	u.handle([]byte{0x90, 1, 127})
	u.handle([]byte{0x80, 1, 0})
	u.cc(push3.CCDelete, 0)
	if got := u.vals[u.valKey(p, "osc_tune")]; got != "0.2500" {
		t.Errorf("Delete + touch in a segment left osc_tune at %s", got)
	}
	got := seen(t, u)
	if got["mode"] != "segment" || got["seg"] != "osc" || got["knobs"] != "osc_wave,osc_tune,,osc_mix,,,," || got["tab"] != int64(0) || got["wave"] == "none" {
		t.Fatalf("segment mode: the screen was told %v", got)
	}
	img = u.render(0)
	// a bar just above the active segment, nothing over its heading, and
	// nothing dimmed or framed
	if c := img.NRGBAAt(10+200, 28); c != sc {
		t.Errorf("segment mode: no bar over the active segment (%v)", c)
	}
	if c := img.NRGBAAt(10+200, 31); c == sc {
		t.Error("segment mode: the bar covers the segment's own top edge")
	}
	if c := img.NRGBAAt(320+150, 28); c == sc {
		t.Error("segment mode: a segment that is not active has a bar")
	}
	u.rowsUntil = time.Time{} // once EXIT has gone from over the panel
	quiet := u.render(0)
	if c := quiet.NRGBAAt(segmentsButton*colW+colW/2, 1); c == sc {
		t.Error("segment mode: a bar over upper button 7 (it reads as a segment's)")
	}
	// in a segment Pung's top row never comes over the panel (the device's
	// name, SOUNDS, EXIT): not with the jog turned, not on entering
	u.showRows()
	if !time.Now().Before(u.rowsUntil) {
		t.Fatal("showRows did not set rowsUntil")
	}
	busy := u.render(0)
	for y := 0; y < topH; y++ {
		for x := 0; x < scrW; x++ {
			if busy.NRGBAAt(x, y) != quiet.NRGBAAt(x, y) {
				t.Fatalf("segment mode: Pung's top row over the panel (first at %d,%d)", x, y)
			}
		}
	}
	u.rowsUntil = time.Time{}
	u.paintLEDs()
	if lit(lower(0)) != ledChosen || lit(lower(1)) == 0 || lit(lower(1)) == ledChosen || lit(lower(3)) != 0 {
		t.Errorf("segment mode: lower lights %d %d %d, want the active white, the others lit, the rest dark", lit(lower(0)), lit(lower(1)), lit(lower(3)))
	}
	if lit(upper(segmentsButton)) != ledChosen {
		t.Error("segment mode: EXIT is not white")
	}
	// another segment is one press away
	press(u, lower(1))
	if u.segID != "flt" || strings.Join(u.encKeys(b), ",") != "cut,res" {
		t.Fatalf("lower 2 in a segment: %q, keys %v", u.segID, u.encKeys(b))
	}
	// a page of the same panel keeps the mode
	press(u, push3.CCPageRight)
	if _, _, nb := u.currentBank(); nb.Compartment != "panel" || u.segMode != segSegment {
		t.Fatalf("a page of the same panel: %q, mode %q", nb.Compartment, u.segMode)
	}
	press(u, push3.CCPageLeft)

	// EXIT: the overview's encoders and page row again
	press(u, upper(segmentsButton))
	if u.segMode != "" || !u.open {
		t.Fatalf("EXIT: mode %q, open %v", u.segMode, u.open)
	}
	u.cc(push3.CCEncoder1+2, 1)
	if got := u.vals[u.valKey(p, "env")]; got == "0.5000" {
		t.Error("after EXIT encoder 3 does not turn the overview's env")
	}
	if got := seen(t, u); got["mode"] != "" || got["knobs"] != "cut,res,env,vol,,,," {
		t.Fatalf("after EXIT the screen was told %v", got)
	}
	press(u, lower(2)) // the lower row is the pages again
	if _, _, nb := u.currentBank(); u.bank != 2 || nb.Compartment != "plain" {
		t.Fatalf("after EXIT lower 3 shows page %d (%s), want Plain", u.bank+1, nb.Compartment)
	}
	press(u, lower(0))

	// Shift + the jog wheel: segment by segment, straight from the overview;
	// it stops at the ends; the wheel alone still steps pages
	u.cc(push3.CCShift, 127)
	u.cc(push3.CCJogWheel, 1)
	if u.segMode != segSegment || u.segID != "osc" || u.bank != 0 {
		t.Fatalf("Shift + jog right from the overview: mode %q, segment %q, page %d", u.segMode, u.segID, u.bank+1)
	}
	u.cc(push3.CCJogWheel, 1)
	u.cc(push3.CCJogWheel, 1)
	u.cc(push3.CCJogWheel, 1) // past the last: stays
	if u.segID != "amp" || strings.Join(u.encKeys(b), ",") != "vol" {
		t.Fatalf("Shift + jog to the end: segment %q, keys %v", u.segID, u.encKeys(b))
	}
	u.cc(push3.CCJogWheel, 127)
	if u.segID != "flt" {
		t.Fatalf("Shift + jog left: segment %q, want flt", u.segID)
	}
	u.cc(push3.CCShift, 0)
	// in segment mode the wheel alone walks the segments, never the pages
	u.cc(push3.CCJogWheel, 1)
	if u.segID != "amp" || u.bank != 0 {
		t.Fatalf("the wheel in a segment: segment %q, page %d, want amp on page 1", u.segID, u.bank+1)
	}
	u.cc(push3.CCJogWheel, 127)
	u.cc(push3.CCJogWheel, 127)
	if u.segID != "osc" || u.bank != 0 {
		t.Fatalf("the wheel left in a segment: segment %q, page %d", u.segID, u.bank+1)
	}
	// a nudge left: back to the overview, the device still open
	press(u, push3.CCJogClickLeft)
	if u.segMode != "" || !u.open {
		t.Fatalf("jog nudge left in a segment: mode %q, open %v", u.segMode, u.open)
	}
	u.cc(push3.CCShift, 127)
	u.cc(push3.CCJogWheel, 127) // from the overview, left: the last
	u.cc(push3.CCShift, 0)
	if u.segID != "amp" {
		t.Fatalf("Shift + jog left from the overview: segment %q, want the last", u.segID)
	}
	press(u, upper(segmentsButton)) // EXIT
	// the wheel in the overview steps pages, as always
	u.cc(push3.CCJogWheel, 1)
	if u.bank != 1 || u.segMode != "" {
		t.Fatalf("the wheel in the overview: page %d, mode %q", u.bank+1, u.segMode)
	}
	u.cc(push3.CCJogWheel, 127)
	// choosing a segment, the wheel goes into the first
	press(u, upper(segmentsButton))
	u.cc(push3.CCJogWheel, 1)
	if u.segMode != segSegment || u.segID != "osc" {
		t.Fatalf("the wheel while choosing: mode %q, segment %q", u.segMode, u.segID)
	}
	press(u, upper(segmentsButton)) // EXIT

	// nudges right: the first segment, the next, round to the first again;
	// a nudge left goes out
	var walk []string
	for i := 0; i < 4; i++ {
		press(u, push3.CCJogClickRight)
		walk = append(walk, u.segID)
	}
	if strings.Join(walk, ",") != "osc,flt,amp,osc" || u.segMode != segSegment || u.inner {
		t.Fatalf("nudges right: %v (mode %q, inner %v), want osc,flt,amp,osc", walk, u.segMode, u.inner)
	}
	press(u, push3.CCJogClickLeft)
	if u.segMode != "" || !u.open {
		t.Fatalf("nudge left after nudges right: mode %q, open %v", u.segMode, u.open)
	}

	// another compartment leaves the mode
	press(u, upper(segmentsButton))
	press(u, lower(0))
	press(u, push3.CCPageRight)
	press(u, push3.CCPageRight) // Main, More, Plain
	if _, _, nb := u.currentBank(); nb.Compartment != "plain" {
		t.Fatalf("page %d is %q", u.bank+1, nb.Compartment)
	}
	if u.encKeys(b); u.segMode != "" {
		t.Fatalf("another compartment kept segment mode %q", u.segMode)
	}
	press(u, push3.CCPageLeft)
	press(u, push3.CCPageLeft)

	// leaving the device leaves it
	press(u, upper(segmentsButton))
	press(u, lower(0))
	press(u, upper(0))
	if u.open || u.segMode != "" {
		t.Fatalf("upper 1 in a segment: open %v, mode %q (it leaves the device)", u.open, u.segMode)
	}
	press(u, upper(1)) // open it again: its overview
	if !u.open || u.segMode != "" {
		t.Fatalf("reopened: open %v, mode %q", u.open, u.segMode)
	}

	// another device leaves it
	press(u, upper(segmentsButton))
	press(u, lower(2))
	if u.segID != "amp" {
		t.Fatalf("lower 3: segment %q", u.segID)
	}
	st := u.live.state()
	st.mu.Lock()
	st.dev.Device, st.path, st.selTop = 0, []int{0}, 0
	st.resolved, st.paramsKey = st.selID(), st.selID()
	st.mu.Unlock()
	u.refreshLive()
	if u.segMode != "" || u.segID != "" {
		t.Fatalf("another device selected: mode %q, segment %q", u.segMode, u.segID)
	}

	// the web page lists the segments
	comps, _ := u.compartmentsOf("seg")
	var segs []string
	for _, c := range comps {
		for _, s := range c.Segments {
			segs = append(segs, c.ID+"/"+s.ID+"="+s.Label+":"+strings.Join(s.Keys, ","))
		}
	}
	if want := "panel/osc=Osc:osc_wave,osc_tune,,osc_mix panel/flt=Filter:cut,res panel/amp=amp:vol"; strings.Join(segs, " ") != want {
		t.Fatalf("compartments' segments\n got %s\nwant %s", strings.Join(segs, " "), want)
	}
	_ = cm
}

// Where there are no segments upper button 7 does nothing and is dark.
func TestNoSegmentsNoButton(t *testing.T) {
	check := func(name string, u *surface) {
		t.Helper()
		u.focused.Store(true)
		before := u.bank
		u.paintLEDs()
		if l := u.leds[uint16(upper(segmentsButton))]; l != 0 {
			t.Errorf("%s: upper 7 lit (%d) with no segments", name, l)
		}
		press(u, upper(segmentsButton))
		if u.segMode != "" || !u.open || u.bank != before {
			t.Errorf("%s: upper 7 did something: mode %q, open %v, page %d", name, u.segMode, u.open, u.bank)
		}
		press(u, lower(1)) // the lower row is still the pages
		if u.bank != 1 {
			t.Errorf("%s: lower 2 shows page %d", name, u.bank+1)
		}
	}
	u := pungView(t) // no screen file at all
	press(u, upper(1))
	check("a module without screens", u)

	u = segView(t, segScreen)
	u.setBank(2) // the Plain front panel
	check("a front panel without segments", u)
}

// The segment keys are checked as the file loads.
func TestSegmentsDeclared(t *testing.T) {
	load := func(js string) *overrideSet {
		root := t.TempDir()
		dir := filepath.Join(root, "sound_generators", "syn")
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"syn","name":"Syn","component_type":"sound_generator"}`), 0o644)
		os.WriteFile(filepath.Join(dir, "push_ui.js"), []byte(js), 0o644)
		return newOverrides().get(root, "syn")
	}
	set := load(`push.compartment({ id: "p", label: "P", front_panel: true, draws_segments: true, keys: ["a"],
  segments: [{ id: "s", label: "S", rect: [0, 0, 100, 50], keys: ["a", "b"] }], screen: function (g, v) {} });`)
	if c := set.compartment("p"); set.failed != "" || c == nil || !c.drawsSegments || len(c.segments) != 1 ||
		c.segments[0].rect != [4]int{0, 0, 100, 50} || strings.Join(c.screenKeys(), ",") != "a,b" {
		t.Fatalf("a panel with a segment: %+v %+v", set.failed, c)
	}
	for name, js := range map[string]string{
		"segments without a front panel": `push.compartment({ id: "p", label: "P", keys: ["a"], segments: [{ id: "s", rect: [0,0,1,1], keys: ["a"] }] });`,
		"nine keys": `push.compartment({ id: "p", label: "P", keys: ["a"], front_panel: true, screen: function () {},
  segments: [{ id: "s", rect: [0,0,1,1], keys: ["a","a","a","a","a","a","a","a","a"] }] });`,
		"no rect":      `push.compartment({ id: "p", label: "P", keys: ["a"], front_panel: true, screen: function () {}, segments: [{ id: "s", keys: ["a"] }] });`,
		"the same id":  `push.compartment({ id: "p", label: "P", keys: ["a"], front_panel: true, screen: function () {}, segments: [{ id: "s", rect: [0,0,1,1], keys: ["a"] }, { id: "s", rect: [0,0,1,1], keys: ["a"] }] });`,
		"nine of them": `var s = []; for (var i = 0; i < 9; i++) s.push({ id: "s" + i, rect: [0,0,1,1], keys: ["a"] }); push.compartment({ id: "p", label: "P", keys: ["a"], front_panel: true, screen: function () {}, segments: s });`,
	} {
		if set := load(js); set == nil || set.failed == "" {
			t.Errorf("%s: loaded", name)
		}
	}
}

// A panel that moves a section with a value says where it drew it
// (g.segment): the bar, and the outlines while choosing, follow it; a
// frame Pung keeps (nothing changed) keeps the place too.
func TestSegmentMovedByThePanel(t *testing.T) {
	moved := strings.Replace(segScreen, "g.knobs({});\n  } });", `if (v.cut && v.cut.frac > 0.5) g.segment("flt", 320, 60, 300, 40);
    g.knobs({});
  } });`, 1)
	if moved == segScreen {
		t.Fatal("the test screen changed: g.segment not put in")
	}
	u := segView(t, moved)
	sc := slotColor(u.slot)
	p, _, _ := u.currentBank()
	press(u, upper(segmentsButton))
	press(u, lower(1)) // the filter
	if u.segMode != segSegment || u.segID != "flt" {
		t.Fatalf("lower 2: mode %q, segment %q", u.segMode, u.segID)
	}
	if c := u.render(0).NRGBAAt(470, 28); c != sc {
		t.Errorf("declared place: no bar over the filter (%v)", c)
	}
	u.vals[u.valKey(p, "cut")] = "0.9"
	for i := 0; i < 2; i++ { // drawn, then kept
		img := u.render(0)
		if c := img.NRGBAAt(470, 58); c != sc {
			t.Errorf("frame %d: the moved filter has no bar (%v)", i, c)
		}
		if c := img.NRGBAAt(470, 28); c == sc {
			t.Errorf("frame %d: a bar still at the declared place", i)
		}
	}
	u.vals[u.valKey(p, "cut")] = "0.1"
	if c := u.render(0).NRGBAAt(470, 28); c != sc {
		t.Errorf("back: no bar at the declared place (%v)", c)
	}
}
