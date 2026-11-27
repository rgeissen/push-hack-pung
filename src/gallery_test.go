//go:build linux

package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestGallery draws every page of every module that brings screens of its
// own, as the Push shows it in the open device: Pung's whole frame, the
// module's real parameters and values. Off unless asked for:
//
//	PUNG_GALLERY=<out dir>           where the PNGs go (960x160, as the display)
//	PUNG_GALLERY_CACHE=<file>        a Push's module-screen.json: each module's
//	                                 metadata and the values it had once loaded
//	PUNG_GALLERY_VALUES=<dir>        optional <module>.json, {"key": "raw value"}
//	                                 over those (a sound worth looking at)
//	PUNG_GALLERY_ONLY=dexed,xenia    optional: only these
//
// A front panel with segments also gets <id>-<compartment>-segments.png
// (choosing one) and <id>-<compartment>-segment-<segment>.png (each one's
// segment mode). With PUNG_GALLERY_MAPS=<dir of <id>.json> (the module's
// mod_map, as TestAssignAudit reads it) each segment's ASSIGN too
// (<id>-<compartment>-assign-<segment>.png) and MORE's first page.
//
// For a look at the screens while they are designed: no Push needed.
func TestGallery(t *testing.T) {
	out := os.Getenv("PUNG_GALLERY")
	if out == "" {
		t.Skip("PUNG_GALLERY not set")
	}
	raw, err := os.ReadFile(os.Getenv("PUNG_GALLERY_CACHE"))
	if err != nil {
		t.Fatal("PUNG_GALLERY_CACHE: ", err)
	}
	cache := map[string]screenVerdict{}
	if err := json.Unmarshal(raw, &cache); err != nil {
		t.Fatal(err)
	}
	screenMu.Lock()
	screenResults = cache
	screenMu.Unlock()
	initFaces()
	only := map[string]bool{}
	for _, id := range strings.Split(os.Getenv("PUNG_GALLERY_ONLY"), ",") {
		if id != "" {
			only[id] = true
		}
	}
	os.MkdirAll(out, 0o755)
	for _, rel := range []string{"../overrides", "../native"} {
		ovDir, _ := filepath.Abs(rel)
		ents, _ := os.ReadDir(ovDir)
		for _, e := range ents {
			id := e.Name()
			if _, err := os.Stat(filepath.Join(ovDir, id, "push_ui.js")); err != nil || (len(only) > 0 && !only[id]) {
				continue
			}
			v, ok := cache[id]
			if !ok || v.Probe == nil {
				t.Logf("%s: no probe record in the cache, left out", id)
				continue
			}
			vals := map[string]string{}
			for k, x := range v.Probe.Initial {
				vals[k] = x
			}
			if dir := os.Getenv("PUNG_GALLERY_VALUES"); dir != "" {
				if raw, err := os.ReadFile(filepath.Join(dir, id+".json")); err == nil {
					json.Unmarshal(raw, &vals) //nolint:errcheck
				}
			}
			galleryModule(t, out, ovDir, id, v.Probe, vals)
		}
	}
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9]+`)

func galleryModule(t *testing.T, out, ovDir, id string, rec *probeRecord, vals map[string]string) {
	g := openGallery(t, ovDir, id, rec, vals)
	if g == nil {
		return
	}
	u, cm, put, shot := g.u, g.cm, g.put, g.shot
	safe := func(s string) string { return strings.Trim(unsafeName.ReplaceAllString(s, "-"), "-") }
	shotTo := func(fn string) { shot(filepath.Join(out, fn)) }
	segShots := 0
	segDone := map[string]bool{}
	for b := range cm.Banks {
		u.setBank(b)
		put() // a page turn reads the values again: from no chain here
		shotTo(fmt.Sprintf("%s-%02d-%s.png", id, b, safe(cm.Banks[b].Name)))
		// a front panel with segments (segments.go), once: choosing one
		// (<id>-<compartment>-segments.png), then each segment's mode
		// (<id>-<compartment>-segment-<segment id>.png)
		c := u.segPanel()
		if c == nil || segDone[c.id] {
			continue
		}
		segDone[c.id] = true
		u.top(segmentsButton)
		if u.segMode != segSelect {
			t.Errorf("%s/%s: SEGMENTS did not open select mode", id, c.id)
			continue
		}
		shotTo(fmt.Sprintf("%s-%s-segments.png", id, safe(c.id)))
		for i, sg := range c.segments {
			u.bottom(i)
			if u.segMode != segSegment || u.segID != sg.id {
				t.Errorf("%s/%s: lower button %d did not enter segment %s", id, c.id, i+1, sg.id)
				continue
			}
			shotTo(fmt.Sprintf("%s-%s-segment-%s.png", id, safe(c.id), safe(sg.id)))
			segShots++
			if m := galleryModMap(id, cm, sg); m != nil { // ASSIGN, the map as the module answers it, and Pung's sources
				u.asg = assignState{on: true, m: m, readAt: time.Now().Add(time.Hour), src: m.Sources[0].ID, pm: newPungMod(&Slot{}, false)}
				for _, r := range m.Routes { // a source with a route here, if one has one
					for _, k := range append(append([]string{}, sg.keys...), sg.assign...) {
						if r.Dst == k && !isPungSource(r.Src) {
							u.asg.src = r.Src
						}
					}
				}
				shotTo(fmt.Sprintf("%s-%s-assign-%s.png", id, safe(c.id), safe(sg.id)))
				if i == 0 { // Pung's LFO A: its routes, and its settings
					u.asg.src = "p_lfo_a"
					shotTo(fmt.Sprintf("%s-%s-assign-%s-pung.png", id, safe(c.id), safe(sg.id)))
					u.asg.view = asLFO
					shotTo(fmt.Sprintf("%s-%s-assign-lfo.png", id, safe(c.id)))
					u.asg.view = ""
				}
				if i == len(c.segments)-1 {
					u.asg.view = asMore
					shotTo(fmt.Sprintf("%s-%s-assign-more.png", id, safe(c.id)))
				}
				u.asg = assignState{}
			}
		}
		u.top(segmentsButton) // EXIT
	}
	t.Logf("%s: %d pages, %d segment screens", id, len(cm.Banks), segShots)
}

// galleryModMap: PUNG_GALLERY_MAPS's map for the module (none: its
// matrix has nothing of its own), Pung's sources after it, and a route of
// Pung's LFO A on the segment's first control it reaches, for the colours
func galleryModMap(id string, cm *compMeta, sg *ovSegment) *modMap {
	dir := os.Getenv("PUNG_GALLERY_MAPS")
	if dir == "" {
		return nil
	}
	m := &modMap{Dests: []string{}, dests: map[string]bool{}}
	if raw, err := os.ReadFile(filepath.Join(dir, id+".json")); err == nil {
		if mm := parseModMap(strings.TrimSpace(string(raw))); mm != nil {
			m = mm
		}
	}
	m.Sources = append(m.Sources, pmodSources...)
	keys := sg.keys
	if len(sg.assign) > 0 {
		keys = sg.assign
	}
	for _, k := range keys {
		if m.reaches(cm, "p_lfo_a", k) {
			b := true
			m.Routes = append(m.Routes, modRoute{Src: "p_lfo_a", Dst: k, Amount: 0.3, Bipolar: &b})
			break
		}
	}
	return m
}

// gallery: one module open in Pung's view, off the Push: its pages, its
// values put back after every page turn (put), and shot(path) writing the
// frame as the display shows it.
type galleryRig struct {
	u    *surface
	cm   *compMeta
	set  *overrideSet
	put  func()
	shot func(path string)
}

// galleryKinds, galleryNames: a module's kind and name where a test knows them (else an instrument named by its id)
var galleryKinds, galleryNames = map[string]string{}, map[string]string{}

func openGallery(t *testing.T, ovDir, id string, rec *probeRecord, vals map[string]string) *galleryRig {
	liveAddr = "127.0.0.1:1" // no Remote Script here
	name := strings.ToUpper(id[:1]) + id[1:]
	root := t.TempDir()
	kind, sub := "sound_generator", "sound_generators"
	if k := galleryKinds[id]; k == "audio_fx" || k == "midi_fx" { // (the card pictures of every module: cardshots_test.go)
		kind, sub = k, k
	}
	if n := galleryNames[id]; n != "" {
		name = n
	}
	dir := filepath.Join(root, sub, id)
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"`+id+`","name":`+strconv.Quote(name)+`,"component_type":"`+kind+`"}`), 0o644)
	deviceNames[name] = id
	t.Cleanup(func() { delete(deviceNames, name) })
	h := &Host{modulesDir: root, settings: loadSettings(t.TempDir())}
	u := &surface{h: h, view: "chain", touched: -1, peekEnc: -1, focus: -1, meta: map[string]*compMeta{}, vals: map[string]string{},
		leds: map[uint16]uint8{}, ov: newOverrides(ovDir)}
	u.live = newLive(h)
	u.live.connected.Store(true)
	cm := buildMeta(id, func(k string) (string, bool) { s, ok := rec.Meta[k]; return s, ok })
	if cm == nil {
		t.Logf("%s: no metadata", id)
		return nil
	}
	cm.Initial = rec.Initial
	set := u.ov.get(root, id)
	if set != nil && set.failed != "" {
		t.Errorf("%s: its screens do not load: %+v", id, set)
		return nil
	}
	cm = liveBanks(cm) // (as the view plans it: surface.go)
	if set != nil && len(set.compartments) > 0 {
		cm = withCompartments(cm, set.compartments, set.unused)
	}
	u.meta["live|"+id] = cm
	s := u.live.state()
	s.mu.Lock()
	s.dev = liveDevice{Track: json.RawMessage("0"), Device: 0, Name: name}
	s.path = []int{0}
	s.devs = []liveDevSummary{{I: 0, Name: name, Active: true}}
	s.trackDevs, s.selTop = s.devs, 0
	s.tracks = []liveTrack{{Ref: json.RawMessage("0"), Name: name}}
	s.resolved, s.paramsKey = s.selID(), s.selID()
	s.mu.Unlock()
	u.refreshLive()
	if !u.liveReady {
		t.Errorf("%s: the device is not ready", id)
		return nil
	}
	put := func() {
		for k, x := range vals {
			u.vals[u.valKey(u.positions[u.pos], k)] = x
		}
	}
	put()
	u.openDevice()
	shot := func(path string) {
		u.rowsUntil = time.Time{} // as it looks once the rows over a panel have gone
		img := u.render(0)
		// on black, as the display shows it (the frame leaves its ground clear)
		flat := image.NewNRGBA(img.Bounds())
		draw.Draw(flat, flat.Bounds(), image.Black, image.Point{}, draw.Src)
		draw.Draw(flat, flat.Bounds(), img, img.Bounds().Min, draw.Over)
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		png.Encode(f, flat) //nolint:errcheck
		f.Close()
	}
	return &galleryRig{u: u, cm: cm, set: set, put: put, shot: shot}
}

// The gallery draws a front panel's segments too: choosing one, and each
// one's segment mode (segments_test.go's test panel).
func TestGallerySegmentShots(t *testing.T) {
	t.Setenv("PUNG_GALLERY_MAPS", "") // (its ASSIGN shots are the gallery's, not counted here)
	initFaces()
	ovDir, out := t.TempDir(), t.TempDir()
	os.MkdirAll(filepath.Join(ovDir, "seg"), 0o755)
	os.WriteFile(filepath.Join(ovDir, "seg", "push_ui.js"), []byte(segScreen), 0o644)
	var params []map[string]any
	for _, k := range []string{"cut", "res", "env", "vol", "lfo_rate", "osc_wave", "osc_tune", "osc_mix", "x", "y"} {
		params = append(params, map[string]any{"key": k, "name": k, "type": "float", "min": 0, "max": 1})
	}
	raw, _ := json.Marshal(params)
	rec := &probeRecord{Meta: map[string]string{"chain_params": string(raw)}, Initial: map[string]string{}}
	galleryModule(t, out, ovDir, "seg", rec, map[string]string{"cut": "0.3", "osc_wave": "0.7"})
	for _, fn := range []string{"seg-00-Main.png", "seg-panel-segments.png", "seg-panel-segment-osc.png",
		"seg-panel-segment-flt.png", "seg-panel-segment-amp.png", "seg-02-Plain.png"} {
		if _, err := os.Stat(filepath.Join(out, fn)); err != nil {
			t.Errorf("the gallery did not write %s", fn)
		}
	}
	segs, _ := filepath.Glob(filepath.Join(out, "seg-panel-*.png"))
	if len(segs) != 4 {
		t.Errorf("the gallery wrote %d segment screens, want 4 (choosing, three segments): %v", len(segs), segs)
	}
}
