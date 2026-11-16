package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func isMod(c color.NRGBA) bool { return c.R < 90 && c.G > 170 && c.B > 200 }

// The stage bar under Pung's envelope lights the segment the note's dot is
// in, and only that one; the dot sits on the line.
func TestStageBarFollowsTheDot(t *testing.T) {
	r := image.Rect(4, ovTop, 4*colW-4, ovTop+ovHeight)
	e := envShape{A: 0.3, D: 0.4, S: 0.5, R: 0.5, HasD: true, HasS: true, HasR: true, Known: true, Labels: true}
	v := envVoice{Off: -1, Vel: 0.8, A: 0.2, D: 0.4, R: 1}
	by := r.Max.Y - 20 + 4 + 1 // the bar's top row, above its letters
	for _, c := range []struct {
		age, off float64
		want     string
	}{{0.1, -1, "attack"}, {0.4, -1, "decay"}, {2, -1, "sustain"}, {3, 0.5, "release"}} {
		v.Age, v.Off = c.age, c.off
		e.Live = &envLive{Source: "stated", Voices: []envVoice{v}}
		img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
		drawEnvelope(img, r, e, slotColor(0))
		var lit []int
		for x := r.Min.X; x < r.Max.X; x++ {
			if isMod(img.NRGBAAt(x, by)) {
				lit = append(lit, x)
			}
		}
		if len(lit) == 0 {
			t.Fatalf("%s: no segment lit", c.want)
		}
		// the lit run is the stage's: the dot's x is inside it
		p := envAt(v, 0, e)
		if p.Stage != c.want {
			t.Fatalf("clock says %s, want %s", p.Stage, c.want)
		}
		lo, hi := lit[0], lit[len(lit)-1]
		for i := 1; i < len(lit); i++ {
			if lit[i] != lit[i-1]+1 {
				t.Fatalf("%s: two segments lit (%d..%d)", c.want, lo, hi)
			}
		}
		if dir := os.Getenv("PUNG_SHOTS"); dir != "" {
			f, _ := os.Create(filepath.Join(dir, "bar-"+c.want+".png"))
			png.Encode(f, img)
			f.Close()
		}
	}
}

// Module screens move too: Mini-JV's envelope pages run each note through
// the JV's own times, and a widget drawing g.envelope (Braids, OB-Xd) gets
// the live dot and bar from the sound's session.
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
	shot := func(name string, img *image.NRGBA) {
		if dir := os.Getenv("PUNG_SHOTS"); dir != "" {
			f, _ := os.Create(filepath.Join(dir, name+".png"))
			png.Encode(f, img)
			f.Close()
		}
	}

	// Mini-JV, Tone 1's Amp Env: T1 64 (0.71 s), T2 72, T3 80, T4 80
	jv := load("minijv")
	c := jv.compartment("tone1")
	raw := map[string]float64{"tvaenvtime1": 64, "tvaenvlevel1": 127, "tvaenvtime2": 72, "tvaenvlevel2": 100, "tvaenvtime3": 80, "tvaenvlevel3": 80, "tvaenvtime4": 80}
	for pi, pg := range c.pages {
		if pg.label != "Amp Env" {
			continue
		}
		scr, keys := c.pageScreen(pi)
		vals := map[string]ovValue{}
		for _, k := range keys {
			n := 64.0
			for s, x := range raw {
				if k == "nvram_tone_0_"+s {
					n = x
				}
			}
			vals[k] = ovValue{Value: fmt.Sprint(n), Display: fmt.Sprint(n), Name: k, Frac: n / 127, Known: true}
		}
		for _, c := range []struct {
			name     string
			age, rel float64
			seg      int // the bar's segment lit
		}{{"t1", 0.35, -1, 0}, {"t2", 1.5, -1, 1}, {"sustain", 12, -1, 2}, {"t4", 14, 1.2, 3}} {
			voice := map[string]any{"note": 60, "vel": 100, "held": c.rel < 0, "age": c.age, "released": c.rel}
			info := map[string]any{"$knobs": pg.keys, "$page": pi, "$live": map[string]any{"known": true, "voices": []any{voice}, "held": 1}}
			img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
			pl := placement{w: &ovWidget{keys: keys, draw: scr}, col: 0, span: 8, info: info}
			if !jv.render(img, pl, vals, "", slotColor(0)) {
				t.Fatalf("jv %s: %s", c.name, jv.failed)
			}
			shot("jv-amp-"+c.name, img)
			y := ovTop + 64 + 5 + 3
			for i := 0; i < 4; i++ {
				x := i*240 + 30
				if got := isMod(img.NRGBAAt(x, y)); got != (i == c.seg) {
					t.Errorf("jv %s: segment %d lit %v", c.name, i+1, got)
				}
			}
		}
	}

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
