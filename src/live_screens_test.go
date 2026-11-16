package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func isMod(c color.NRGBA) bool { return c.R < 90 && c.G > 170 && c.B > 200 }

// envBarLit: which of an envelope's segments the stage bar shows lit,
// drawn into r: its middle pixel, on the bar's top row.
func envBarLit(img *image.NRGBA, r image.Rectangle, e envShape) []bool {
	x0, x1 := float64(r.Min.X+6), float64(r.Max.X-6)
	top, base := float64(r.Min.Y+8), float64(r.Max.Y-20)
	pts, _ := envLayout(e, x0, x1, top, base)
	by := int(base) + 4 + 1
	out := make([]bool, len(e.Segs))
	for i := range e.Segs {
		if pts[i+1].X-pts[i].X < 4 {
			continue
		}
		out[i] = isMod(img.NRGBAAt(int((pts[i].X+pts[i+1].X)/2), by))
	}
	return out
}

func shot(name string, img *image.NRGBA) {
	if dir := os.Getenv("PUNG_SHOTS"); dir != "" {
		f, _ := os.Create(filepath.Join(dir, name+".png"))
		png.Encode(f, img)
		f.Close()
	}
}

// On every kind of envelope, the stage bar lights the segment the note's
// dot is in, and only that one, all the way through: each stage, the
// plateau while held, the release from the let-go.
func TestStageBarFollowsTheDot(t *testing.T) {
	r := image.Rect(4, ovTop, 4*colW-4, ovTop+ovHeight)
	for name, c := range envFleet {
		e := envCase(c.keys, c.frac, "")
		e.Labels = true
		v := envVoice{Off: -1, Vel: 0.8, T: make([]float64, len(e.Segs))}
		held := 0.0
		for i, s := range e.Segs {
			if !s.Plateau {
				v.T[i] = 1
			}
			if i < e.plateau() {
				held++
			}
		}
		pl := e.plateau()
		for i, s := range e.Segs {
			// a moment in the middle of the segment
			switch {
			case s.Plateau:
				v.Age, v.Off = held+2, -1
			case pl >= 0 && i > pl: // held held+3 s, let go
				v.Off = float64(i-pl-1) + 0.5
				v.Age = held + 3 + v.Off
			default:
				v.Age, v.Off = float64(i)+0.5, -1
			}
			p := envAt(v, 0, e)
			if p.Done || p.Seg != i {
				t.Fatalf("%s: at %.1f (off %.1f) the clock says segment %d (done %v), want %d", name, v.Age, v.Off, p.Seg, p.Done, i)
			}
			e.Live = &envLive{Source: "stated", Voices: []envVoice{v}}
			img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
			drawEnvelope(img, r, e, slotColor(0))
			for j, lit := range envBarLit(img, r, e) {
				if lit != (j == i) {
					t.Errorf("%s: dot in %s, bar segment %s lit %v", name, e.Segs[i].Label, e.Segs[j].Label, lit)
				}
			}
			shot("bar-"+name+"-"+e.Segs[i].Label, img)
		}
	}
}

// Mini-JV and Dexed draw their envelopes with Pung's own picture (no
// screen of their own), and their overlays give Pung their engines' times:
// the JV's measured tables, Dexed's msfa. Braids' widget gets the live dot
// and bar from the sound's session.
func TestLiveModuleScreens(t *testing.T) {
	ovDir, _ := filepath.Abs("../overrides")
	initFaces()
	load := func(id string) *overrideSet {
		root := t.TempDir()
		dir := filepath.Join(root, "sound_generators", id)
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"`+id+`","component_type":"sound_generator"}`), 0o644)
		set := newOverrides(ovDir).get(root, id)
		if set == nil || set.failed != "" {
			t.Fatalf("%s: %+v", id, set)
		}
		return set
	}
	raws := func(keys []string, raw map[string]float64, max float64) map[string]ovValue {
		vals := map[string]ovValue{}
		for _, k := range keys {
			n := 64.0
			for s, x := range raw {
				if strings.HasSuffix(k, s) {
					n = x
				}
			}
			vals[k] = ovValue{Value: fmt.Sprint(n), Display: fmt.Sprint(n), Name: k, Frac: n / max, Max: max, Type: "int", Known: true}
		}
		return vals
	}
	// an envelope page of a module: Pung's group on it, its times, and the
	// stage bar following a note through it
	check := func(name string, set *overrideSet, page string, keys []string, vals map[string]ovValue, want []float64, labels string) {
		gs := pictureGroups(keys)
		if len(gs) != 1 || gs[0].kind != "env" || gs[0].end-gs[0].start != len(keys) {
			t.Fatalf("%s: the page is not one envelope: %+v", name, gs)
		}
		for _, pg := range set.compartments {
			for _, p := range pg.pages {
				if p.label == page && p.screen != nil {
					t.Fatalf("%s: %s still draws a screen of its own", name, page)
				}
			}
		}
		g := gs[0]
		secs := set.envSecs(g.keys, vals, nil)
		e := envShapeOf(g.keys, vals, "")
		var ls []string
		for _, s := range e.Segs {
			ls = append(ls, s.Label)
		}
		if strings.Join(ls, " ") != labels {
			t.Fatalf("%s: segments %v, want %s", name, ls, labels)
		}
		times, _, src := envTimesOf(e, vals, secs)
		if src != "module" {
			t.Fatalf("%s: times from %s, not the module", name, src)
		}
		for i, w := range want {
			if w >= 0 && math.Abs(times[i]-w) > 0.002 {
				t.Errorf("%s: %s takes %.3f s, want %.3f", name, e.Segs[i].Label, times[i], w)
			}
		}
		// a note through it, on its times: each segment lit in turn
		r := image.Rect(4, ovTop, 8*colW-4, ovTop+ovHeight)
		e.Labels = true
		elapsed := 0.0
		pl := e.plateau()
		for i, s := range e.Segs {
			v := envVoice{Off: -1, Vel: 0.8, T: times}
			switch {
			case s.Plateau:
				v.Age = elapsed + 1
			case i > pl && pl >= 0:
				v.Age, v.Off = elapsed+1+times[i]/2, times[i]/2
			default:
				v.Age = elapsed + times[i]/2
				elapsed += times[i]
			}
			if times[i] < 0.01 && !s.Plateau {
				continue // too short to catch
			}
			e.Live = &envLive{Source: src, Voices: []envVoice{v}}
			img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
			drawEnvelope(img, r, e, slotColor(0))
			shot(name+"-"+s.Label, img)
			for j, lit := range envBarLit(img, r, e) {
				if lit != (j == i) {
					t.Errorf("%s: note in %s, %s lit %v", name, s.Label, e.Segs[j].Label, lit)
				}
			}
		}
	}

	// Mini-JV, Tone 1's Amp Env: T1 64, T2 72, T3 80, T4 80 (the JV's own times)
	jv := load("minijv")
	c := jv.compartment("tone1")
	var ampKeys []string
	for _, pg := range c.pages {
		if pg.label == "Amp Env" {
			ampKeys = pg.keys
		}
	}
	jvVals := raws(ampKeys, map[string]float64{"tvaenvtime1": 64, "tvaenvlevel1": 127, "tvaenvtime2": 72, "tvaenvlevel2": 100, "tvaenvtime3": 80, "tvaenvlevel3": 80, "tvaenvtime4": 80}, 127)
	check("jv-amp", jv, "Amp Env", ampKeys, jvVals, []float64{0.700, 2.435, 3.538, -1, 4.525}, "T1 T2 T3 S T4")

	// Dexed, Operator 1's EG: rates 50, levels 99 80 60 0 (msfa's own times)
	dx := load("dexed")
	var egKeys []string
	for _, pg := range dx.compartment("op1").pages {
		if pg.label == "Op 1 EG" {
			egKeys = pg.keys
		}
	}
	dxVals := raws(egKeys, map[string]float64{"eg_r1": 50, "eg_r2": 50, "eg_r3": 50, "eg_r4": 50, "eg_l1": 99, "eg_l2": 80, "eg_l3": 60, "eg_l4": 0}, 99)
	check("dexed-op1", dx, "Op 1 EG", egKeys, dxVals, []float64{0.1712, 0.2090, 0.2322, -1, 0.9462}, "R1 R2 R3 S R4")

	// Braids' envelope widget, on a live session
	br := load("braids")
	s := &Slot{}
	ls := &liveSession{slot: s, pics: map[string]*livePic{}, subs: map[chan []byte]bool{}}
	w := br.widgets[0]
	vals := map[string]ovValue{}
	for i, k := range w.keys {
		f := []float64{0.3, 0.4, 0.6, 0.5}[i]
		vals[k] = ovValue{Value: fmt.Sprint(f), Name: k, Frac: f, Type: "float", Min: 0, Max: 1, Unit: "%", Known: true}
	}
	draw := func(name string) *image.NRGBA {
		img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
		pl := placement{w: w, col: 0, span: len(w.keys), live: ls, liveOut: ls.frame(), liveKey: "t/braids"}
		if !br.render(img, pl, vals, "", slotColor(0)) {
			t.Fatalf("braids: %s", br.failed)
		}
		shot("braids-"+name, img)
		return img
	}
	draw("rest") // registers the envelope with the session
	s.live.trackMidi([]byte{0x90, 60, 110})
	ph := 0.0
	s.live.feedAudio(block(0.5, 220, 1470, &ph))
	time.Sleep(20 * time.Millisecond)
	ls.tick()
	out := ls.frame()
	if len(out.Envs) != 1 {
		t.Fatalf("the widget's envelope is not in the session: %+v", out.Envs)
	}
	for _, l := range out.Envs {
		if len(l.Voices) != 1 || l.Source != "curve" {
			t.Fatalf("braids live %+v", l)
		}
	}
	img := draw("playing")
	lit := 0
	for x := 0; x < 4*colW; x++ {
		if isMod(img.NRGBAAt(x, ovTop+ovHeight-20+4+3)) {
			lit++
		}
	}
	if lit == 0 {
		t.Fatal("braids: no stage lit while a note plays")
	}
}
