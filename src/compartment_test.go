package main

import (
	"encoding/json"
	"fmt"
	"github.com/dop251/goja"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// A module declares compartments in push_ui.js: pages become Push pages in
// order, a compartment with a screen is marked custom, and parameters no
// compartment names stay reachable after them.
func TestCompartmentsFromPushUI(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "syn")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"syn","name":"Syn","component_type":"sound_generator"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "push_ui.js"), []byte(`
push.compartment({ id: "flt", label: "Filters",
  pages: [ { label: "Filter 1", keys: ["cut", "res"] }, { label: "Routing", keys: ["route"] } ],
  screen: function (g, v) {} });
push.compartment({ id: "env", label: "Envelope", keys: ["a","d","s","r","a2","d2","s2","r2","x"] });
`), 0o644)
	set := newOverrides().get(root, "syn")
	if set == nil || set.failed != "" || len(set.compartments) != 2 {
		t.Fatalf("set %+v", set)
	}
	if c := set.compartment("flt"); c == nil || c.screen == nil || len(c.pages) != 2 || strings.Join(c.keys, ",") != "cut,res,route" {
		t.Fatalf("flt %+v", c)
	}
	cm := &compMeta{Params: map[string]*paramMeta{}}
	for _, k := range []string{"cut", "res", "route", "a", "d", "s", "r", "a2", "d2", "s2", "r2", "x", "spare"} {
		cm.Params[k] = &paramMeta{Key: k}
	}
	cm.Banks = []bank{{Name: "Main", Keys: []string{"cut", "spare"}}}
	got := withCompartments(cm, set.compartments)
	var names []string
	for _, b := range got.Banks {
		names = append(names, b.Name+"="+strings.Join(b.Keys, ",")+"@"+b.Compartment)
	}
	want := "Filter 1=cut,res@flt|Routing=route@flt|Envelope=a,d,s,r,a2,d2,s2,r2@env|Envelope 2=x@env|Main=spare@"
	if strings.Join(names, "|") != want {
		t.Fatalf("pages\n got %s\nwant %s", strings.Join(names, "|"), want)
	}
}

// Every overlay shipped with Pung (overrides/<id>/push_ui.js) loads and draws
// each of its screens and widgets with mid values, and with a key touched,
// without an error. (The 8 ms budget is checked on the device; this machine's
// timing says nothing about the Push's.)
func TestShippedOverlaysDraw(t *testing.T) {
	initFaces()
	// Pung's overlays, and the screens its native modules bring themselves
	for _, d := range []string{"../overrides", "../native"} {
		overlaysDraw(t, d)
	}
}

func overlaysDraw(t *testing.T, rel string) {
	ovDir, _ := filepath.Abs(rel)
	ents, err := os.ReadDir(ovDir)
	if err != nil {
		t.Skip("no " + rel + " folder")
	}
	for _, e := range ents {
		if !e.IsDir() {
			continue // presets.json and the like: not a module's overrides
		}
		if _, err := os.Stat(filepath.Join(ovDir, e.Name(), "push_ui.js")); err != nil {
			continue
		}
		root := t.TempDir()
		dir := filepath.Join(root, "sound_generators", e.Name())
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"`+e.Name()+`","component_type":"sound_generator"}`), 0o644)
		set := newOverrides(ovDir).get(root, e.Name())
		if set == nil || set.failed != "" {
			t.Errorf("%s: %+v", e.Name(), set)
			continue
		}
		vals := func(keys []string) map[string]ovValue {
			m := map[string]ovValue{}
			for i, k := range keys { // varied, so a picture has a shape to show
				f := 0.15 + 0.17*float64(i%5)
				m[k] = ovValue{Value: fmt.Sprint(f), Display: fmt.Sprintf("%.0f", f*100), Name: k, Frac: f, Known: true}
			}
			return m
		}
		for _, c := range set.compartments {
			if c.screen == nil {
				continue
			}
			for _, touched := range []string{"", c.keys[0]} {
				knobs := make([]string, 8)
				copy(knobs, c.keys)
				info := map[string]any{"$knobs": knobs, "$pages": []string{"ONE", "TWO"}, "$page": 0, "$name": "X", "$track": "1-X"}
				pl := placement{w: &ovWidget{keys: c.screenKeys(), draw: c.screen}, col: 0, span: 8, full: c.takeover, info: info}
				img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
				if !set.render(img, pl, vals(c.screenKeys()), touched, slotColor(0)) {
					t.Errorf("%s/%s: %s", e.Name(), c.id, set.failed)
				}
				// PUNG_SHOTS=dir: the screens, for a look
				if dir := os.Getenv("PUNG_SHOTS"); dir != "" {
					f, _ := os.Create(filepath.Join(dir, fmt.Sprintf("%s-%s-%t.png", e.Name(), c.id, touched != "")))
					png.Encode(f, img)
					f.Close()
				}
			}
		}
		// a page's own screen, as the default view draws it (a band)
		for _, c := range set.compartments {
			for pi, pg := range c.pages {
				if pg.screen == nil {
					continue
				}
				scr, keys := c.pageScreen(pi)
				img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
				pl := placement{w: &ovWidget{keys: keys, draw: scr}, col: 0, span: 8, info: map[string]any{"$knobs": pg.keys, "$page": pi}}
				if !set.render(img, pl, vals(keys), pg.keys[0], slotColor(0)) {
					t.Errorf("%s/%s page %s: %s", e.Name(), c.id, pg.label, set.failed)
				}
				if dir := os.Getenv("PUNG_SHOTS"); dir != "" && pi < 12 {
					f, _ := os.Create(filepath.Join(dir, fmt.Sprintf("%s-%s-page%d.png", e.Name(), c.id, pi)))
					png.Encode(f, img)
					f.Close()
				}
			}
		}
		for wi, w := range set.widgets {
			for _, touched := range []string{"", w.keys[0], w.keys[len(w.keys)-1]} {
				img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
				pl := placement{w: w, col: 0, span: len(w.keys)}
				if !set.render(img, pl, vals(w.keys), touched, slotColor(0)) {
					t.Errorf("%s widget %v: %s", e.Name(), w.keys, set.failed)
				}
				if dir := os.Getenv("PUNG_SHOTS"); dir != "" {
					f, _ := os.Create(filepath.Join(dir, fmt.Sprintf("%s-widget%d-%s.png", e.Name(), wi, touched)))
					png.Encode(f, img)
					f.Close()
				}
			}
		}
	}
}

// A device restores only a state of its own module: patchModule names the
// module a saved chain is built around, by device kind.
func TestPatchModule(t *testing.T) {
	syn := json.RawMessage(`{"synth":{"module":"osirus","config":{}},"audio_fx":[]}`)
	fx := json.RawMessage(`{"audio_fx":[{"type":"freeverb"}]}`)
	mid := json.RawMessage(`{"midi_fx":[{"type":"chord"}],"synth":{"module":"midi-sink"}}`)
	for _, c := range []struct {
		chain json.RawMessage
		kind  string
		want  string
	}{
		{syn, livedevice.Instrument, "osirus"}, {fx, livedevice.Effect, "freeverb"},
		{mid, livedevice.MIDI, "chord"}, {json.RawMessage(`nope`), livedevice.Instrument, ""},
	} {
		if got := patchModule(c.chain, c.kind); got != c.want {
			t.Errorf("%s %s: %q, want %q", c.chain, c.kind, got, c.want)
		}
	}
}

// g.poly takes [[x,y], ...] and [x0,y0,x1,y1,...] alike (overrides.md).
func TestPolyBothForms(t *testing.T) {
	vm := goja.New()
	for _, src := range []string{"[[1,2],[3,4],[5,6]]", "[1,2,3,4,5,6]"} {
		v, err := vm.RunString(src)
		if err != nil {
			t.Fatal(err)
		}
		pts := ovPoints(vm, v)
		if len(pts) != 3 || pts[1] != [2]float64{3, 4} {
			t.Errorf("%s: %v", src, pts)
		}
	}
}

// Every DX7 algorithm draws (Dexed's takeover reads the engine's own
// table); PUNG_SHOTS=dir writes them for a look.
func TestDexedAlgorithms(t *testing.T) {
	ovDir, _ := filepath.Abs("../overrides")
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "dexed")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"dexed","component_type":"sound_generator"}`), 0o644)
	initFaces()
	set := newOverrides(ovDir).get(root, "dexed")
	if set == nil || set.failed != "" {
		t.Skip("no dexed overlay")
	}
	c := set.compartment("algorithm")
	shots := os.Getenv("PUNG_SHOTS")
	for a := 1; a <= 32; a++ {
		vals := map[string]ovValue{}
		for _, k := range c.screenKeys() {
			vals[k] = ovValue{Value: "70", Display: "70", Name: k, Frac: 0.7, Known: true}
		}
		vals["algorithm"] = ovValue{Value: fmt.Sprint(a), Display: fmt.Sprint(a), Name: "Algorithm", Frac: float64(a-1) / 31, Known: true}
		vals["feedback"] = ovValue{Value: "5", Display: "5", Name: "Feedback", Frac: 5.0 / 7, Known: true}
		for n := 1; n <= 6; n++ {
			vals[fmt.Sprintf("op%d_coarse", n)] = ovValue{Value: fmt.Sprint(n), Known: true}
			vals[fmt.Sprintf("op%d_osc_mode", n)] = ovValue{Value: "0", Known: true}
		}
		img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
		knobs := make([]string, 8)
		copy(knobs, c.pages[0].keys)
		pl := placement{w: &ovWidget{keys: c.screenKeys(), draw: c.screen}, full: true, span: 8, info: map[string]any{"$knobs": knobs, "$page": 0, "$pages": []string{"Algorithm"}}}
		if !set.render(img, pl, vals, "", slotColor(0)) {
			t.Fatalf("algorithm %d: %s", a, set.failed)
		}
		set.overruns = 0
		if shots != "" {
			f, _ := os.Create(filepath.Join(shots, fmt.Sprintf("dexed-alg%02d.png", a)))
			png.Encode(f, img)
			f.Close()
		}
	}
}

// Dexed's screens with the values the module really starts with (its probe
// record), through the same metadata the Push uses. PUNG_SHOTS=dir only.
func TestDexedRealValues(t *testing.T) {
	shots := os.Getenv("PUNG_SHOTS")
	if shots == "" {
		t.Skip("PUNG_SHOTS not set")
	}
	get := map[string]string{}
	for _, k := range []string{"ui_hierarchy", "chain_params"} {
		raw, _ := os.ReadFile("testdata/dexed_" + k + ".json")
		get[k] = string(raw)
	}
	cm := buildMeta("dexed", getter(get))
	var init map[string]string
	raw, _ := os.ReadFile("testdata/dexed_initial.json")
	json.Unmarshal(raw, &init)
	// PUNG_DEXED_VALUES=file.json: values over the init patch (a sound to show)
	if p := os.Getenv("PUNG_DEXED_VALUES"); p != "" {
		var over map[string]string
		raw, _ := os.ReadFile(p)
		if err := json.Unmarshal(raw, &over); err != nil {
			t.Fatal(err)
		}
		for k, v := range over {
			init[k] = v
		}
	}
	ovDir, _ := filepath.Abs("../overrides")
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "dexed")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"dexed","component_type":"sound_generator"}`), 0o644)
	initFaces()
	set := newOverrides(ovDir).get(root, "dexed")
	cm = withCompartments(cm, set.compartments)
	for _, c := range set.compartments {
		for pi := range c.pages {
			scr, keys := c.pageScreen(pi)
			if scr == nil {
				continue
			}
			var b *bank
			for i := range cm.Banks {
				if cm.Banks[i].Compartment == c.id && cm.Banks[i].Page == pi {
					b = &cm.Banks[i]
				}
			}
			if b == nil {
				continue
			}
			vals := ovValuesOf(cm, keys, func(k string) (string, bool) { v, ok := init[k]; return v, ok })
			knobs := make([]string, 8)
			copy(knobs, b.Keys)
			img := newFrame()
			pl := placement{w: &ovWidget{keys: keys, draw: scr}, span: 8, full: c.takeover, info: map[string]any{"$knobs": knobs, "$page": 0, "$pages": []string{b.Name}}}
			touched := ""
			if len(b.Keys) > 1 {
				touched = b.Keys[1]
			}
			if !set.render(img, pl, vals, touched, slotColor(0)) {
				t.Fatalf("%s/%d: %s", c.id, pi, set.failed)
			}
			set.overruns = 0
			f, _ := os.Create(filepath.Join(shots, fmt.Sprintf("real-dexed-%s-%d.png", c.id, pi)))
			png.Encode(f, img)
			f.Close()
		}
	}
}
