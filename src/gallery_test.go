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
// segment mode).
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
	liveAddr = "127.0.0.1:1" // no Remote Script here
	name := strings.ToUpper(id[:1]) + id[1:]
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", id)
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"`+id+`","name":"`+name+`","component_type":"sound_generator"}`), 0o644)
	deviceNames[name] = id
	defer delete(deviceNames, name)
	h := &Host{modulesDir: root, settings: loadSettings(t.TempDir())}
	u := &surface{h: h, view: "chain", touched: -1, peekEnc: -1, focus: -1, meta: map[string]*compMeta{}, vals: map[string]string{},
		leds: map[uint16]uint8{}, ov: newOverrides(ovDir)}
	u.live = newLive(h)
	u.live.connected.Store(true)
	cm := buildMeta(id, func(k string) (string, bool) { s, ok := rec.Meta[k]; return s, ok })
	if cm == nil {
		t.Logf("%s: no metadata", id)
		return
	}
	cm.Initial = rec.Initial
	set := u.ov.get(root, id)
	if set == nil || set.failed != "" {
		t.Errorf("%s: its screens do not load: %+v", id, set)
		return
	}
	cm = withCompartments(liveBanks(cm), set.compartments, set.unused)
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
		return
	}
	put := func() {
		for k, x := range vals {
			u.vals[u.valKey(u.positions[u.pos], k)] = x
		}
	}
	put()
	u.openDevice()
	safe := func(s string) string { return strings.Trim(unsafeName.ReplaceAllString(s, "-"), "-") }
	shot := func(fn string) {
		u.rowsUntil = time.Time{} // as it looks once the rows over a panel have gone
		img := u.render(0)
		// on black, as the display shows it (the frame leaves its ground clear)
		flat := image.NewNRGBA(img.Bounds())
		draw.Draw(flat, flat.Bounds(), image.Black, image.Point{}, draw.Src)
		draw.Draw(flat, flat.Bounds(), img, img.Bounds().Min, draw.Over)
		f, err := os.Create(filepath.Join(out, fn))
		if err != nil {
			t.Fatal(err)
		}
		png.Encode(f, flat) //nolint:errcheck
		f.Close()
	}
	segShots := 0
	segDone := map[string]bool{}
	for b := range cm.Banks {
		u.setBank(b)
		put() // a page turn reads the values again: from no chain here
		shot(fmt.Sprintf("%s-%02d-%s.png", id, b, safe(cm.Banks[b].Name)))
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
		shot(fmt.Sprintf("%s-%s-segments.png", id, safe(c.id)))
		for i, sg := range c.segments {
			u.bottom(i)
			if u.segMode != segSegment || u.segID != sg.id {
				t.Errorf("%s/%s: lower button %d did not enter segment %s", id, c.id, i+1, sg.id)
				continue
			}
			shot(fmt.Sprintf("%s-%s-segment-%s.png", id, safe(c.id), safe(sg.id)))
			segShots++
		}
		u.top(segmentsButton) // EXIT
	}
	t.Logf("%s: %d pages, %d segment screens", id, len(cm.Banks), segShots)
}

// The gallery draws a front panel's segments too: choosing one, and each
// one's segment mode (segments_test.go's test panel).
func TestGallerySegmentShots(t *testing.T) {
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
