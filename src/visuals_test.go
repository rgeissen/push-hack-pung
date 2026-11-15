package main

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestEnvelopeGroups(t *testing.T) {
	cases := []struct {
		name string
		keys []string
		want [][2]int // [start, end) of each group
	}{
		{"plain adsr", []string{"cutoff", "attack", "decay", "sustain", "release"}, [][2]int{{1, 5}}},
		{"two envelopes", []string{"attack", "decay", "sustain", "release", "f_attack", "f_decay", "f_sustain", "f_release"}, [][2]int{{0, 4}, {4, 8}}},
		{"jv order", []string{"macro_attack", "macro_decay", "macro_release", "macro_sustain"}, [][2]int{{0, 4}}},
		{"virus slope", []string{"amp_attack", "amp_decay", "amp_sustain", "amp_sustain_time", "amp_release"}, [][2]int{{0, 5}}},
		{"pitch AD", []string{"pitch_env_attack", "pitch_env_decay", "x"}, [][2]int{{0, 2}}},
		{"compressor AR", []string{"threshold", "attack", "release"}, nil},
		{"gate AR", []string{"gate_attack", "gate_release"}, nil},
		{"split by a knob", []string{"attack", "cutoff", "decay", "sustain"}, nil},
		{"lone decay", []string{"delay_rate_rev_decay"}, nil},
	}
	for _, c := range cases {
		got := envelopeGroups(c.keys)
		if len(got) != len(c.want) {
			t.Errorf("%s: %d groups, want %d (%+v)", c.name, len(got), len(c.want), got)
			continue
		}
		for i, g := range got {
			if g.start != c.want[i][0] || g.end != c.want[i][1] {
				t.Errorf("%s: group %d covers [%d,%d), want %v", c.name, i, g.start, g.end, c.want[i])
			}
		}
	}
	if g := envelopeGroups([]string{"amp_attack", "amp_decay", "amp_sustain", "amp_sustain_time", "amp_release"}); g[0].keys["slope"] != "amp_sustain_time" {
		t.Errorf("sustain_time is not the slope: %v", g[0].keys)
	}
}

// TestDrawEnvelope draws every shape the detector can produce, known and
// unknown, each stage touched, and checks it stays in its rect. With
// PUNG_SHOTS=dir the pictures are written there for a look.
func TestDrawEnvelope(t *testing.T) {
	shapes := map[string]envShape{
		"adsr":    {A: 0.2, D: 0.4, S: 0.6, R: 0.5, HasD: true, HasS: true, HasR: true, Known: true, Labels: true},
		"ad":      {A: 0.1, D: 0.7, HasD: true, Known: true, Labels: true},
		"ahdsr":   {A: 0.3, H: 0.4, D: 0.3, S: 0.3, R: 0.8, HasD: true, HasH: true, HasS: true, HasR: true, Known: true, Labels: true},
		"virus":   {A: 0, D: 0.5, S: 0.7, Slope: 0.1, R: 0.3, HasD: true, HasS: true, HasSlope: true, HasR: true, Known: true, Labels: true},
		"max":     {A: 1, D: 1, S: 1, R: 1, HasD: true, HasS: true, HasR: true, Known: true, Labels: true},
		"zero":    {HasD: true, HasS: true, HasR: true, Known: true, Labels: true},
		"unknown": {Labels: true},
	}
	dir := os.Getenv("PUNG_SHOTS")
	sc := slotColor(0)
	for name, e := range shapes {
		for _, touched := range []string{"", "attack", "decay", "sustain", "release"} {
			img := image.NewNRGBA(image.Rect(0, 0, 960, 160))
			r := image.Rect(124, ovTop, 4*colW-4, ovTop+ovHeight)
			e.Touched = touched
			drawEnvelope(img, r, e, sc)
			for y := 0; y < 160; y++ {
				for x := 0; x < 960; x++ {
					if img.NRGBAAt(x, y).A != 0 && !(image.Point{x, y}.In(r)) {
						t.Fatalf("%s/%s: drew outside its rect at %d,%d", name, touched, x, y)
					}
				}
			}
			if dir != "" {
				f, _ := os.Create(filepath.Join(dir, "env-"+name+"-"+touched+".png"))
				png.Encode(f, img)
				f.Close()
			}
		}
	}
}
