package main

import (
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
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
		{"ms units (freak)", []string{"env_attack_ms", "env_decay_ms", "env_sustain", "env_release_ms", "env_retrig"}, [][2]int{{0, 4}}},
		{"letters (noisemaker)", []string{"fenv_a", "fenv_d", "fenv_s", "fenv_r", "fenv_time"}, [][2]int{{0, 4}}},
		{"letters (tablor)", []string{"vca_a", "vca_d", "vca_s", "vca_r"}, [][2]int{{0, 4}}},
		{"short words (aphex)", []string{"e1_delay", "e1_atk", "e1_rel", "e2_hold", "e2_atk", "e2_dcy", "e2_sus", "e2_rel"}, [][2]int{{0, 3}, {3, 8}}},
		{"AD words (forge)", []string{"pv1_e1_atk", "pv1_e1_dec", "pv1_e1_crv"}, [][2]int{{0, 2}}},
		{"AHD (work)", []string{"menv_dest", "menv_atk", "menv_hold", "menv_dec"}, [][2]int{{1, 4}}},
		{"roland T/L (mini-jv)", []string{"nvram_tone_0_tvaenvtime1", "nvram_tone_0_tvaenvlevel1", "nvram_tone_0_tvaenvtime2", "nvram_tone_0_tvaenvlevel2", "nvram_tone_0_tvaenvtime3", "nvram_tone_0_tvaenvlevel3", "nvram_tone_0_tvaenvtime4"}, [][2]int{{0, 7}}},
		{"yamaha R/L (dexed)", []string{"op1_eg_r1", "op1_eg_l1", "op1_eg_r2", "op1_eg_l2", "op1_eg_r3", "op1_eg_l3", "op1_eg_r4", "op1_eg_l4"}, [][2]int{{0, 8}}},
		{"compressor AR", []string{"threshold", "attack", "release"}, nil},
		{"compressor att/rel", []string{"att", "rel", "ratio"}, nil},
		{"gate AR", []string{"gate_attack", "gate_release"}, nil},
		{"split by a knob", []string{"attack", "cutoff", "decay", "sustain"}, nil},
		{"lone decay", []string{"delay_rate_rev_decay"}, nil},
		{"a letter is not a role without its underscore", []string{"filter", "pads", "osc_mix"}, nil},
		{"an effect's delay", []string{"delay_time", "attack", "decay"}, [][2]int{{1, 3}}},
		{"a split roland page", []string{"penvtime1", "penvlevel1", "penvtime2", "penvlevel2", "penvtime3"}, nil},
		{"a yamaha page without its levels", []string{"pitch_eg_r1", "pitch_eg_r2", "pitch_eg_r3", "pitch_eg_r4", "pitch_eg_l1", "pitch_eg_l2"}, nil},
		{"numbered, not an envelope's", []string{"osc_level1", "osc_level2", "osc_level3", "lfo_rate1", "lfo_rate2", "lfo_rate3"}, nil},
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

// envCase: an envelope from its keys and values (fractions), as the
// default view reads one.
func envCase(keys []string, frac map[string]float64, touched string) envShape {
	g := envelopeGroups(keys)
	if len(g) == 0 {
		panic("no envelope in " + strings.Join(keys, " "))
	}
	vals := map[string]ovValue{}
	for _, k := range keys {
		f, ok := frac[k]
		if !ok {
			f = 0.5
		}
		vals[k] = ovValue{Value: fmt.Sprint(f), Frac: f, Known: true}
	}
	return envShapeOf(g[0].keys, vals, touched)
}

// envFleet: one of every kind of envelope the fleet has.
var envFleet = map[string]struct {
	keys []string
	frac map[string]float64
	segs string // the stage bar's labels
}{
	"adsr":     {[]string{"attack", "decay", "sustain", "release"}, map[string]float64{"attack": 0.2, "decay": 0.4, "sustain": 0.6}, "A D S R"},
	"ad":       {[]string{"pitch_env_attack", "pitch_env_decay"}, map[string]float64{"pitch_env_attack": 0.1, "pitch_env_decay": 0.7}, "A D"},
	"ahdsr":    {[]string{"e_attack", "e_hold", "e_decay", "e_sustain", "e_release"}, map[string]float64{"e_sustain": 0.3}, "A H D S R"},
	"dar":      {[]string{"e1_delay", "e1_atk", "e1_rel"}, nil, "DL A S R"},
	"virus":    {[]string{"amp_attack", "amp_decay", "amp_sustain", "amp_sustain_time", "amp_release"}, map[string]float64{"amp_attack": 0, "amp_sustain": 0.7, "amp_sustain_time": 0.1}, "A D S R"},
	"jv-amp":   {[]string{"tvaenvtime1", "tvaenvlevel1", "tvaenvtime2", "tvaenvlevel2", "tvaenvtime3", "tvaenvlevel3", "tvaenvtime4"}, map[string]float64{"tvaenvlevel1": 1, "tvaenvlevel2": 0.8, "tvaenvlevel3": 0.6}, "T1 T2 T3 S T4"},
	"jv-pitch": {[]string{"penvtime1", "penvlevel1", "penvtime2", "penvlevel2", "penvtime3", "penvlevel3", "penvtime4", "penvlevel4"}, map[string]float64{"penvlevel1": 0.9, "penvlevel2": 0.3, "penvlevel3": 0.5, "penvlevel4": 0.5}, "T1 T2 T3 S T4"},
	"dx":       {[]string{"op1_eg_r1", "op1_eg_l1", "op1_eg_r2", "op1_eg_l2", "op1_eg_r3", "op1_eg_l3", "op1_eg_r4", "op1_eg_l4"}, map[string]float64{"op1_eg_r1": 0.95, "op1_eg_l1": 1, "op1_eg_l2": 0.9, "op1_eg_l3": 0.7, "op1_eg_l4": 0}, "R1 R2 R3 S R4"},
}

// TestDrawEnvelope draws every kind of envelope, known and unknown, each
// knob touched, and checks it stays in its rect and has its stage bar.
// With PUNG_SHOTS=dir the pictures are written there for a look.
func TestDrawEnvelope(t *testing.T) {
	dir := os.Getenv("PUNG_SHOTS")
	sc := slotColor(0)
	for name, c := range envFleet {
		base := envCase(c.keys, c.frac, "")
		var labels []string
		for _, s := range base.Segs {
			labels = append(labels, s.Label)
		}
		if got := strings.Join(labels, " "); got != c.segs {
			t.Errorf("%s: segments %s, want %s", name, got, c.segs)
		}
		for _, touched := range append([]string{"", "?unknown"}, c.keys...) {
			e := envCase(c.keys, c.frac, touched)
			if touched == "?unknown" {
				e.Known = false
			}
			img := image.NewNRGBA(image.Rect(0, 0, 960, 160))
			r := image.Rect(124, ovTop, 4*colW-4, ovTop+ovHeight)
			drawEnvelope(img, r, e, sc)
			for y := 0; y < 160; y++ {
				for x := 0; x < 960; x++ {
					if img.NRGBAAt(x, y).A != 0 && !(image.Point{x, y}.In(r)) {
						t.Fatalf("%s/%s: drew outside its rect at %d,%d", name, touched, x, y)
					}
				}
			}
			if dir != "" {
				f, _ := os.Create(filepath.Join(dir, "env-"+name+"-"+strings.TrimPrefix(touched, "?")+".png"))
				png.Encode(f, img)
				f.Close()
			}
		}
	}
}

// A stage's curve bends it as a synth's curve knob does: (e^(c t)-1)/(e^c-1)
// of the way at time t; straight at 0.
func TestEnvCurve(t *testing.T) {
	if got := envCurve(0.5, 0); got != 0.5 {
		t.Errorf("straight: %v at half time, want 0.5", got)
	}
	if got := envCurve(0.5, 5); got > 0.1 {
		t.Errorf("c=5 (a slow start): %v of the way at half time, want under 0.1", got)
	}
	if got := envCurve(0.5, -5); got < 0.9 {
		t.Errorf("c=-5 (a fast start): %v of the way at half time, want over 0.9", got)
	}
	if envCurve(0, 7) != 0 || envCurve(1, 7) != 1 {
		t.Error("a curve must start at 0 and end at 1")
	}
}

// A stage whose level's n-th root runs straight in time (Surge's shapes):
// a cubic release from S runs S(1-t)^3, a convex attack sqrt(t).
func TestEnvRootStages(t *testing.T) {
	e := envShape{Start: 0, Segs: []envSeg{{Role: "attack", Level: 1, Root: 0.5}, {Role: "sustain", Level: 0.5, Plateau: true}, {Role: "release", Level: 0, Release: true, Root: 3}}}
	if got := e.frac(0, 0.25); math.Abs(got-0.5) > 1e-9 {
		t.Errorf("convex attack at a quarter: %v of the way, want sqrt(0.25)=0.5", got)
	}
	// release from 0.5 to 0: level 0.5*(1-t)^3; at t=0.5 that is 0.0625, so 0.875 of the way
	if got := e.frac(2, 0.5); math.Abs(got-0.875) > 1e-9 {
		t.Errorf("cubic release at half time: %v of the way, want 0.875", got)
	}
}

// A stage may carry its curve as a table (an engine's own law, sampled):
// interpolated between its points.
func TestEnvTableStage(t *testing.T) {
	e := envShape{Start: 0, Segs: []envSeg{{Role: "attack", Level: 1, Table: []float64{0, 0.8, 1}}}}
	if got := e.frac(0, 0.25); math.Abs(got-0.4) > 1e-9 {
		t.Errorf("a quarter in: %v, want 0.4 (halfway to the table's 0.8)", got)
	}
	if got := e.frac(0, 1); got != 1 {
		t.Errorf("the end: %v, want 1", got)
	}
}

// An LFO may carry one cycle as a table: read with wrap-around.
func TestLFOTable(t *testing.T) {
	l := lfoShape{Table: []float64{-1, 1}}
	if got := l.at(0.25); math.Abs(got) > 1e-9 {
		t.Errorf("a quarter in: %v, want 0 (halfway from -1 to 1)", got)
	}
	if got := l.at(0.75); math.Abs(got) > 1e-9 {
		t.Errorf("three quarters in: %v, want 0 (halfway back from 1 to -1)", got)
	}
}
