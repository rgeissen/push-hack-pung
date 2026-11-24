package main

import (
	"image"
	"image/color"
	"os"
	"path/filepath"
	"testing"
)

// A module's live_mod: numbers and strings, anything else left out.
func TestParseLiveMod(t *testing.T) {
	m := parseLiveMod(`{"cut":74.25,"frame":"128","bad":[1],"on":true}`)
	if len(m) != 2 || m["cut"] != "74.25" || m["frame"] != "128" {
		t.Fatalf("got %v", m)
	}
	if parseLiveMod(`not json`) != nil {
		t.Fatal("not JSON: something")
	}
}

// A value modulation moves gets where it is (0..1 of its range); an enum,
// and a key the module does not report, do not.
func TestWithMod(t *testing.T) {
	cm := &compMeta{Params: map[string]*paramMeta{
		"cut":  {Key: "cut", Type: "float", Min: 0, Max: 128},
		"mode": {Key: "mode", Type: "enum", Options: []string{"A", "B"}},
		"res":  {Key: "res", Type: "float", Min: 0, Max: 1},
	}}
	vals := ovValuesOf(cm, []string{"cut", "mode", "res"}, func(k string) (string, bool) { return "0", true })
	now := map[string]string{"cut": "96", "mode": "1"}
	withMod(vals, cm, func(k string) (string, bool) { v, ok := now[k]; return v, ok })
	if v := vals["cut"]; !v.HasNow || v.Now != 0.75 {
		t.Errorf("cut: %+v", v)
	}
	if vals["mode"].HasNow || vals["res"].HasNow {
		t.Errorf("an enum or an unmodulated value got a place: %+v %+v", vals["mode"], vals["res"])
	}
}

// A screen reads v[key].now; a value nothing modulates has none.
func TestScreenSeesModulation(t *testing.T) {
	initFaces()
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "syn")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"syn","name":"Syn","component_type":"sound_generator"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "push_ui.js"), []byte(`push.compartment({ id: "p", label: "P", keys: ["cut", "res"],
  screen: function (g, v) {
    g.fill(0, 0, 900, 80, v.cut.now === 0.75 && v.res.now === undefined ? "#ff0000" : "#0000ff");
  } });`), 0o644)
	set := newOverrides().get(root, "syn")
	c := set.compartment("p")
	if set.failed != "" || c == nil {
		t.Fatalf("the screen file: %+v", set.failed)
	}
	vals := map[string]ovValue{"cut": {Frac: 0.5, Known: true, Now: 0.75, HasNow: true}, "res": {Frac: 0.2, Known: true}}
	img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
	pl := placement{w: &ovWidget{keys: c.screenKeys(), draw: c.screen}, col: 0, span: 8, info: map[string]any{}}
	if !set.render(img, pl, vals, "", slotColor(0)) {
		t.Fatalf("render: %s", set.failed)
	}
	if !hasColor(img, color.NRGBA{255, 0, 0, 255}) {
		t.Fatal("the screen did not see cut's modulation (or saw one on res)")
	}
}

// A knob modulation moves draws its place in the modulation colour, on
// every knob style.
func TestModMarkDraws(t *testing.T) {
	for _, style := range []string{"ring", "pointer", "fader"} {
		img := image.NewNRGBA(image.Rect(0, 0, 120, 160))
		P := &palette{ground: cBlack, panel: cFaint, fg: cFg, dim: cDim, faint: cFaint, line: cLine, knob: style}
		modMark(img, 60, knobCY, 0.2, 0.8, P)
		if !hasColor(img, cMod) {
			t.Errorf("%s: no mark", style)
		}
	}
}

// The filter's response follows its modulated cutoff and resonance; the
// knob's cutoff is kept to mark.
func TestFilterFollowsModulation(t *testing.T) {
	g := picGroup{kind: "filter", keys: map[string]string{"cutoff": "cut", "resonance": "res"}}
	vals := map[string]ovValue{
		"cut": {Frac: 0.3, Known: true, Now: 0.7, HasNow: true},
		"res": {Frac: 0.1, Known: true, Now: 0.6, HasNow: true},
	}
	f := filterShapeOf(g, vals, "")
	if !f.Moved || f.Cutoff != 0.7 || f.Set != 0.3 || f.Res != 0.6 {
		t.Fatalf("got %+v", f)
	}
	img := image.NewNRGBA(image.Rect(0, 0, 300, 120))
	drawFilter(img, img.Bounds(), f, slotColor(0))
	if !hasColor(img, cMod) {
		t.Error("a modulated cutoff is not marked")
	}
	vals["cut"] = ovValue{Frac: 0.3, Known: true}
	if f := filterShapeOf(g, vals, ""); f.Moved || f.Cutoff != 0.3 {
		t.Errorf("unmodulated: %+v", f)
	}
}

func hasColor(img *image.NRGBA, c color.NRGBA) bool {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if img.NRGBAAt(x, y) == c {
				return true
			}
		}
	}
	return false
}
