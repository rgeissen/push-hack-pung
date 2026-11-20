package main

import (
	"fmt"
	"image"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The native instruments' own screens draw their envelopes, filters and
// LFOs through Pung's pictures, so they move as the sound does: a note runs
// along each envelope, the sound's spectrum stands behind each filter, a
// note restarts a key-synced LFO. A screen that draws its own curve instead
// is still, and this is where that shows (it went unnoticed on OsTIrus,
// Vavra and Xenia until it was looked for on the Push).
func TestNativeScreensMove(t *testing.T) {
	initFaces()
	natDir, _ := filepath.Abs("../native")
	type want struct{ env, filter, lfo bool }
	cases := []struct {
		module, comp, page string
		vals               map[string]string // display values; the rest read as 64 of 127
		want               want
	}{
		{"vavra", "filter", "Filter 1", map[string]string{"f1_type": "24dB LP", "f2_type": "12dB HP"}, want{filter: true}},
		{"vavra", "env", "Filter Env", map[string]string{"filter_env_mode": "ADSR"}, want{env: true}},
		{"vavra", "env", "Amp Env", map[string]string{"amp_env_mode": "ADS1DS2R"}, want{env: true}},
		{"vavra", "lfo", "LFO 1", map[string]string{"lfo1_shape": "Triangle", "lfo1_sync": "On", "lfo1_clocked": "Off"}, want{lfo: true}},
		{"xenia", "filter", "Filters", map[string]string{"f1_type": "24 dB LP", "f2_type": "6 dB LP"}, want{filter: true}},
		{"xenia", "env", "Free Env", nil, want{env: true}},
		{"ostirus", "filter", "", map[string]string{"filter1_mode": "LP", "filter2_mode": "HP"}, want{filter: true}},
		{"ostirus", "env", "Amp Env", nil, want{env: true}},
		{"ostirus", "lfo", "LFO 1", map[string]string{"lfo1_shape": "Sine", "lfo1_clock": "Off", "lfo1_keytrigger": "1"}, want{lfo: true}},
		{"nodalred", "filter", "", map[string]string{"filter_type": "LP 24"}, want{env: true, filter: true}},
		{"nodalred", "mod", "", map[string]string{"lfo1_wave": "Triangle", "lfo1_sync": "Off", "lfo2_sync": "Off"}, want{env: true}},
	}
	for _, c := range cases {
		name := c.module + "/" + c.comp + "/" + c.page
		root := t.TempDir()
		dir := filepath.Join(root, "sound_generators", c.module)
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"`+c.module+`","component_type":"sound_generator"}`), 0o644)
		set := newOverrides(natDir).get(root, c.module)
		if set == nil || set.failed != "" {
			t.Fatalf("%s: %+v", name, set)
		}
		comp := set.compartment(c.comp)
		if comp == nil {
			t.Fatalf("%s: no compartment", name)
		}
		pi := 0
		if c.page != "" {
			pi = -1
			for i, p := range comp.pages {
				if p.label == c.page {
					pi = i
				}
			}
			if pi < 0 {
				t.Fatalf("%s: no such page", name)
			}
		}
		scr, keys := comp.pageScreen(pi)
		if scr == nil {
			t.Fatalf("%s: the page draws no screen", name)
		}
		vals := map[string]ovValue{}
		for i, k := range keys {
			n := float64(40 + 7*(i%6))
			vals[k] = ovValue{Value: fmt.Sprint(n), Display: fmt.Sprint(n), Name: k, Frac: n / 127, Min: 0, Max: 127, Type: "int", Known: true}
		}
		for k, d := range c.vals {
			vals[k] = ovValue{Value: d, Display: d, Name: k, Frac: 0.5, Type: "enum", Known: true}
		}
		s := &Slot{}
		ls := &liveSession{slot: s, pics: map[string]*livePic{}, subs: map[chan []byte]bool{}}
		info := map[string]any{"$knobs": comp.pages[pi].keys, "$page": pi, "$pages": []string{"A", "B"}}
		draw := func(out liveOut) {
			img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
			pl := placement{w: &ovWidget{keys: keys, draw: scr}, col: 0, span: 8, full: comp.takeover, info: info, live: ls, liveOut: out,
				liveKey: "t/" + name}
			if !set.render(img, pl, vals, "", slotColor(0)) {
				t.Fatalf("%s: %s", name, set.failed)
			}
		}
		draw(ls.frame()) // registers its pictures with the sound's session
		// a note, and the sound it makes
		s.live.trackMidi([]byte{0x90, 60, 110})
		ph := 0.0
		for b := 0; b < 8; b++ {
			s.live.feedAudio(block(0.5, 220, 1024, &ph))
		}
		time.Sleep(20 * time.Millisecond)
		ls.tick()
		out := ls.frame()
		draw(out)
		moving := map[string]bool{}
		for _, e := range out.Envs {
			if len(e.Voices) > 0 {
				moving["env"] = true
			}
		}
		if out.Spec != nil {
			moving["filter"] = true
		}
		for _, l := range out.LFOs {
			if l.Restart > 0 || l.Phase >= 0 {
				moving["lfo"] = true
			}
		}
		for kind, w := range map[string]bool{"env": c.want.env, "filter": c.want.filter, "lfo": c.want.lfo} {
			if w && !moving[kind] {
				t.Errorf("%s: its %s does not move with the note (envs %d, spectrum %v, lfos %d)", name, kind, len(out.Envs), out.Spec != nil, len(out.LFOs))
			}
		}
	}
}

// Xenia's filter and amp envelopes are on a page Pung draws itself: Pung
// must find the envelopes there (and so run notes along them).
func TestXeniaEnvelopesFound(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "xenia")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"xenia","component_type":"sound_generator"}`), 0o644)
	natDir, _ := filepath.Abs("../native")
	set := newOverrides(natDir).get(root, "xenia")
	for _, p := range set.compartment("env").pages {
		if p.label != "Filter / Amp" {
			continue
		}
		if p.screen != nil {
			t.Fatal("Filter / Amp draws a screen of its own: Pung's envelope is the picture there")
		}
		n := 0
		for _, g := range pictureGroups(p.keys) {
			if g.kind == "env" {
				n++
			}
		}
		if n != 2 {
			t.Fatalf("Pung finds %d envelopes on Filter / Amp, want 2: %+v", n, pictureGroups(p.keys))
		}
		return
	}
	t.Fatal("no Filter / Amp page")
}
