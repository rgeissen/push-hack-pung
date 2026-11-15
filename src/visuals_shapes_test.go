package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func groupSpans(gs []picGroup) string {
	var out []string
	for _, g := range gs {
		out = append(out, fmt.Sprintf("%s[%d,%d)", g.kind, g.start, g.end))
	}
	return strings.Join(out, " ")
}

func TestPictureGroups(t *testing.T) {
	cases := []struct {
		name string
		keys []string
		want string
	}{
		// filters, as the fleet spells them
		{"hera", []string{"vcf_cutoff", "vcf_resonance", "vcf_env", "vcf_lfo"}, "filter[0,2)"},
		{"freak", []string{"filter_mode", "filter_cutoff", "filter_resonance", "x"}, "filter[0,3)"},
		{"tablor", []string{"flt_freq", "flt_res", "flt_type", "flt_env", "sub_level", "sub_wave", "noise_level", "noise_type"}, "filter[0,3)"},
		{"denis", []string{"filter_cutoff", "filter_q", "filter_type"}, "filter[0,3)"},
		{"minijv tone", []string{"nvram_tone_0_filtermode", "nvram_tone_0_cutofffrequency", "nvram_tone_0_resonance", "nvram_tone_0_resonancemode"}, "filter[0,3)"},
		{"weird dreams", []string{"cv_cutoff", "cv_fres", "cv_ftype"}, "filter[0,3)"},
		{"surge type apart", []string{"filter1_type", "filter1_subtype", "filter1_cutoff", "filter1_resonance"}, "filter[2,4)"},
		{"plain", []string{"cutoff", "resonance", "attack", "decay", "sustain", "release"}, "filter[0,2) env[2,6)"},
		{"cutoff and type", []string{"filter_type", "filter_cutoff", "x"}, "filter[0,2)"},
		{"cutoff alone", []string{"cutoff", "drive"}, ""},
		{"an osc freq is no cutoff", []string{"osc1_freq", "osc1_res"}, ""},
		{"eq band", []string{"lm_freq", "lm_gain", "lm_q"}, ""},
		{"a macro is no filter", []string{"macro_cutoff", "macro_resonance"}, ""},
		{"mode is not a filter's", []string{"cutoff", "mode"}, ""},
		{"two filters", []string{"filter1_cutoff", "filter1_resonance", "filter2_cutoff", "filter2_resonance"}, "filter[0,2) filter[2,4)"},
		// LFOs
		{"lfo", []string{"lfo1_shape", "lfo1_rate", "lfo1_sync"}, "lfo[0,2)"},
		{"lfo wave", []string{"lfo_rate", "lfo_waveform"}, "lfo[0,2)"},
		{"jv form", []string{"nvram_tone_0_lfo1form", "nvram_tone_0_lfo1rate", "nvram_tone_0_lfo1delay"}, "lfo[0,2)"},
		{"no lfo in the name", []string{"shape", "rate"}, ""},
		{"lfo apart", []string{"lfo_shape", "lfo_amount", "lfo_rate"}, ""},
		{"two lfos", []string{"lfo1_wave", "lfo1_rate", "lfo2_wave", "lfo2_rate"}, "lfo[0,2) lfo[2,4)"},
		// mixes
		{"hera dco", []string{"saw_level", "pulse_level", "sub_level", "noise_level", "pwm_depth"}, "mix[0,4)"},
		{"surge mixer", []string{"level_o1", "level_o2", "level_o3", "level_noise", "route_o1"}, "mix[0,4)"},
		{"aphex", []string{"mix_v1", "mix_v2", "vco_mg", "vco_eg", "mix_esp", "mix_sub", "mix_noise", "noise_color"}, "mix[4,7)"},
		{"two levels", []string{"osc1_level", "osc2_level", "cutoff"}, ""},
		{"fm operators", []string{"op1_level", "op2_level", "op3_level"}, ""},
		{"envelope levels are no mix", []string{"attack_level", "decay_level", "sustain_level"}, "env[0,3)"},
		{"effects", []string{"rev_mix", "dly_mix", "cho_mix"}, ""},
		{"volume is a word", []string{"volume", "remix", "premix"}, ""},
		{"mixed forms", []string{"osc1_level", "level_osc2", "noise_level"}, ""},
	}
	for _, c := range cases {
		if got := groupSpans(pictureGroups(c.keys)); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
	g := pictureGroups([]string{"filter1_type", "filter1_subtype", "filter1_cutoff", "filter1_resonance"})[0]
	if g.keys["type"] != "filter1_type" {
		t.Errorf("a type on the page is the filter's: %v", g.keys)
	}
}

func TestFilterKind(t *testing.T) {
	cases := map[string]string{
		"LP 24 dB": "lp4", "LP12": "lp2", "LP6": "lp1", "HP 12 dB": "hp2", "BP 12 dB": "bp2", "N 12 dB": "notch2",
		"Analog 4P": "lp4", "Analog 1P": "lp1", "LowPass": "lp2", "HighPass": "hp2", "BandPass": "bp2",
		"BandStop": "notch2", "Notch": "notch2", "lp": "lp2", "hp": "hp2", "bp": "bp2", "Off": "off2",
		"LP Legacy Ladder": "lp4", "SV-LP": "lp2", "HP+LP": "bp2", "Lowpass": "lp2", "Peak": "bp2", "Comb": "?2",
		"LPF": "lp2", "HPF": "hp2",
	}
	for in, want := range cases {
		k, p := filterKind(in)
		if got := fmt.Sprintf("%s%d", k, p); got != want {
			t.Errorf("%q: %s, want %s", in, got, want)
		}
	}
}

func TestLFOWave(t *testing.T) {
	cases := map[string]string{
		"Sine": "sine", "Sin": "sine", "Tri": "tri", "Triangle": "tri", "Saw Up": "sawup", "Ramp Up": "sawup",
		"Saw Down": "sawdown", "Ramp Down": "sawdown", "Sawtooth": "sawup", "Square": "square", "Sqr": "square",
		"Rect": "square", "S&H": "sh", "S+H": "sh", "Sample & Hold": "sh", "Random": "sh", "Rnd": "sh",
		"S&G": "smooth", "smooth_random": "smooth", "Noise": "noise", "SQU": "square", "RND1": "sh", "RND2": "smooth",
		"Skewed Sine": "", "Wave 3": "", "Envelope": "", "Soft Saw": "",
	}
	for in, want := range cases {
		if got := lfoWave(in); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}

// The response is what the type says: a lowpass passes the lows, a highpass
// the highs, a bandpass the cutoff, a notch all but the cutoff; resonance
// raises the peak.
func TestFilterResponse(t *testing.T) {
	at := func(f filterShape, u float64) float64 { return filterDB(f, u) }
	lp := filterShape{Cutoff: 0.5, Kind: "lp", Poles: 2}
	if !(at(lp, 0.1) > -1 && at(lp, 0.9) < -30) {
		t.Errorf("lowpass: %.1f low, %.1f high", at(lp, 0.1), at(lp, 0.9))
	}
	hp := filterShape{Cutoff: 0.5, Kind: "hp", Poles: 2}
	if !(at(hp, 0.9) > -1 && at(hp, 0.1) < -30) {
		t.Errorf("highpass: %.1f low, %.1f high", at(hp, 0.1), at(hp, 0.9))
	}
	bp := filterShape{Cutoff: 0.5, Kind: "bp", Poles: 2}
	if !(at(bp, 0.5) > -0.5 && at(bp, 0.1) < -12 && at(bp, 0.9) < -12) {
		t.Errorf("bandpass")
	}
	no := filterShape{Cutoff: 0.5, Kind: "notch", Poles: 2}
	if !(at(no, 0.5) < -40 && at(no, 0.1) > -1) {
		t.Errorf("notch")
	}
	res := lp
	res.Res, res.HasRes = 1, true
	if at(res, 0.5) < 15 {
		t.Errorf("full resonance peaks at %.1f dB", at(res, 0.5))
	}
	steep := filterShape{Cutoff: 0.5, Kind: "lp", Poles: 4}
	if at(steep, 0.8) > at(lp, 0.8)-20 {
		t.Errorf("24 dB is not steeper than 12 dB")
	}
}

// Every picture, known and unknown, each part touched, stays in its rect.
// With PUNG_SHOTS=dir they are written there for a look.
func TestDrawPictures(t *testing.T) {
	type pic struct {
		name  string
		g     picGroup
		vals  map[string]ovValue
		touch []string
	}
	kv := func(frac float64, display string) ovValue { return ovValue{Frac: frac, Display: display, Known: true} }
	fg := picGroup{kind: "filter", keys: map[string]string{"cutoff": "c", "resonance": "r", "type": "t"}, start: 1, end: 4}
	lg := picGroup{kind: "lfo", keys: map[string]string{"shape": "s", "rate": "r"}, start: 2, end: 4}
	mg := picGroup{kind: "mix", keys: map[string]string{"0": "a", "1": "b", "2": "c", "3": "d"}, start: 0, end: 4}
	var pics []pic
	for _, ty := range []string{"LP 24 dB", "LP6", "HP 12 dB", "BP 12 dB", "Notch", "Off", "Comb"} {
		for _, res := range []float64{0, 0.5, 1} {
			for _, cut := range []float64{0, 0.4, 1} {
				pics = append(pics, pic{fmt.Sprintf("filter-%s-r%.1f-c%.1f", strings.ReplaceAll(ty, " ", ""), res, cut), fg,
					map[string]ovValue{"c": kv(cut, ""), "r": kv(res, ""), "t": kv(0, ty)}, []string{"", "c", "r", "t"}})
			}
		}
	}
	pics = append(pics, pic{"filter-unknown", fg, map[string]ovValue{}, []string{""}})
	for _, w := range []string{"Sine", "Triangle", "Saw Up", "Ramp Down", "Square", "S&H", "S&G", "Noise", "Wave 3"} {
		for _, rate := range []float64{0, 0.5, 1} {
			pics = append(pics, pic{fmt.Sprintf("lfo-%s-%.1f", strings.ReplaceAll(w, " ", ""), rate), lg,
				map[string]ovValue{"s": kv(0, w), "r": kv(rate, "")}, []string{"", "s", "r"}})
		}
	}
	pics = append(pics, pic{"lfo-unknown", lg, map[string]ovValue{}, []string{""}})
	for _, lv := range [][]float64{{0, 0, 0, 0}, {1, 1, 1, 1}, {0.8, 0.3, 0.6, 0}, {0.01, 0, 0, 1}} {
		vals := map[string]ovValue{}
		for i, k := range []string{"a", "b", "c", "d"} {
			vals[k] = kv(lv[i], "")
		}
		pics = append(pics, pic{fmt.Sprintf("mix-%v", lv), mg, vals, []string{"", "a", "c"}})
	}
	pics = append(pics, pic{"mix-unknown", mg, map[string]ovValue{}, []string{""}})
	dir := os.Getenv("PUNG_SHOTS")
	sc := slotColor(1)
	for _, p := range pics {
		for _, touched := range p.touch {
			img := image.NewNRGBA(image.Rect(0, 0, 960, 160))
			r := image.Rect(p.g.start*colW+4, ovTop, p.g.end*colW-4, ovTop+ovHeight)
			drawPicture(img, r, p.g, p.vals, touched, sc)
			drew := false
			for y := 0; y < 160; y++ {
				for x := 0; x < 960; x++ {
					if img.NRGBAAt(x, y).A != 0 {
						drew = true
						if !(image.Point{x, y}.In(r)) {
							t.Fatalf("%s/%s: drew outside its rect at %d,%d", p.name, touched, x, y)
						}
					}
				}
			}
			if !drew {
				t.Fatalf("%s/%s: drew nothing", p.name, touched)
			}
			if dir != "" {
				f, _ := os.Create(filepath.Join(dir, p.name+"-"+touched+".png"))
				png.Encode(f, img)
				f.Close()
			}
		}
	}
}

// TestFleetPictures plans every page of the 100 modules Schwung captured
// (testdata/fleet-contracts.json.gz) and checks what Pung would draw on
// them against testdata/fleet-pictures.txt, so that a change to a rule
// shows, module by module, what it draws and stops drawing. PUNG_UPDATE=1
// rewrites the file.
func TestFleetPictures(t *testing.T) {
	f, err := os.Open("testdata/fleet-contracts.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(z)
	var fleet struct {
		Modules map[string]struct {
			Hier   json.RawMessage `json:"ui_hierarchy"`
			Params json.RawMessage `json:"chain_params"`
		} `json:"modules"`
	}
	if err := json.Unmarshal(raw, &fleet); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(fleet.Modules))
	for id := range fleet.Modules {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var b strings.Builder
	b.WriteString("# What Pung draws on every page of the fleet (TestFleetPictures; PUNG_UPDATE=1 rewrites)\n")
	for _, id := range ids {
		c := fleet.Modules[id]
		cm := buildMeta(id, func(k string) (string, bool) {
			switch k {
			case "ui_hierarchy":
				return string(c.Hier), true
			case "chain_params":
				return string(c.Params), true
			}
			return "", false
		})
		for _, bk := range cm.Banks {
			for _, g := range pictureGroups(bk.Keys) {
				fmt.Fprintf(&b, "%s / %s: %s %s\n", id, bk.Name, g.kind, strings.Join(bk.Keys[g.start:g.end], " "))
			}
		}
	}
	got := b.String()
	if dir := os.Getenv("PUNG_FLEET_PAGES"); dir != "" {
		// every page's keys and what Go draws on it, for web/visuals.js to be checked against
		type page struct {
			Keys  []string `json:"keys"`
			Spans string   `json:"spans"`
		}
		var pages []page
		for _, id := range ids {
			c := fleet.Modules[id]
			cm := buildMeta(id, func(k string) (string, bool) {
				switch k {
				case "ui_hierarchy":
					return string(c.Hier), true
				case "chain_params":
					return string(c.Params), true
				}
				return "", false
			})
			for _, bk := range cm.Banks {
				pages = append(pages, page{bk.Keys, groupSpans(pictureGroups(bk.Keys))})
			}
		}
		raw, _ := json.Marshal(pages)
		os.WriteFile(filepath.Join(dir, "fleet-pages.json"), raw, 0o644)
	}
	if os.Getenv("PUNG_UPDATE") != "" {
		os.WriteFile("testdata/fleet-pictures.txt", []byte(got), 0o644)
		return
	}
	want, _ := os.ReadFile("testdata/fleet-pictures.txt")
	if got != string(want) {
		t.Errorf("the fleet's pictures changed; look at the difference, then PUNG_UPDATE=1:\n%s", firstDiff(string(want), got))
	}
}

func firstDiff(a, b string) string {
	al, bl := strings.Split(a, "\n"), strings.Split(b, "\n")
	for i := 0; i < max(len(al), len(bl)); i++ {
		var x, y string
		if i < len(al) {
			x = al[i]
		}
		if i < len(bl) {
			y = bl[i]
		}
		if x != y {
			return fmt.Sprintf("line %d:\n- %s\n+ %s", i+1, x, y)
		}
	}
	return ""
}

// A module's screen draws Pung's filter, LFO and mix with g.filter, g.lfo
// and g.mix, from keys, numbers or names, and its touch is shown.
func TestScreensDrawPungsPictures(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "syn")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"syn","name":"Syn","component_type":"sound_generator"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "push_ui.js"), []byte(`
push.compartment({ id: "all", label: "All", keys: ["cut", "res", "typ", "wave", "rate", "a", "b", "c"],
  screen: function (g, v) {
    g.filter(0, 0, 300, 86, { cutoff: "cut", resonance: "res", type: "typ" });
    g.lfo(320, 0, 300, 86, { shape: "wave", rate: 0.5 });
    g.mix(640, 0, 300, 86, ["a", "b", 0.25]);
    g.filter(0, 0, 10, 10, { cutoff: 0.5, type: "HP 12 dB" });
    g.lfo(0, 0, 10, 10, { shape: "Square", rate: "nope" });
  } });
`), 0o644)
	set := newOverrides().get(root, "syn")
	if set == nil || set.failed != "" {
		t.Fatalf("set %+v", set)
	}
	comp := set.compartment("all")
	screen, keys := comp.pageScreen(0)
	vals := map[string]ovValue{}
	for k, v := range map[string]ovValue{
		"cut": {Frac: 0.5, Known: true}, "res": {Frac: 0.7, Known: true}, "typ": {Display: "LP 24 dB", Known: true},
		"wave": {Display: "Sine", Known: true}, "a": {Frac: 1, Known: true}, "b": {Frac: 0.5, Known: true},
	} {
		vals[k] = v
	}
	for _, touched := range []string{"", "cut", "res", "wave", "b"} {
		img := image.NewNRGBA(image.Rect(0, 0, 960, 160))
		pl := placement{w: &ovWidget{keys: keys, draw: screen}, col: 0, span: 8}
		if !set.render(img, pl, vals, touched, slotColor(2)) {
			t.Fatalf("touched %q: %s", touched, set.failed)
		}
		if dir := os.Getenv("PUNG_SHOTS"); dir != "" {
			f, _ := os.Create(filepath.Join(dir, "screen-pictures-"+touched+".png"))
			png.Encode(f, img)
			f.Close()
		}
	}
}
