package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// TestHeroFrames records the front page's loops (site/hero.js): each of
// Pung's own instruments' front panel while a chord plays, as the Push draws
// it, frame by frame.
//
//	PUNG_HERO_FRAMES=<dir> [PUNG_HERO_ONLY=a,b] go test -run 'TestHeroFrames$' .
//
// writes <dir>/<id>/f-NNN.png (960x160, 20 a second) for scripts/hero-loops.sh
// to make into the loops. The panels are drawn as the card pictures are
// (cardshots_test.go): an emulator at a neutral setting Pung makes up, never
// a sound of the player's firmware. What moves is real: the notes on the
// envelopes, the spectrum of the sound fed in, and a cutoff that an LFO of
// the test's own moves (as a module's live_mod would).
// heroMoves: beside the first filter's cutoff, the controls the loop's own
// LFO moves on each panel (a module's live_mod would name them)
var heroMoves = map[string][]string{
	"nodalred": {"resonance", "mix", "lfo1_amount", "fm", "pw"},
	"xenia":    {"w1_start_w", "w2_start_w", "f1_resonance"},
	"vavra":    {"o1_detune", "o2_detune", "f1_resonance"},
	"ostirus":  {"filter1_resonance", "osc_balance", "cutoff2", "soft1"},
	"vivace":   {"osc_1_wave_frame", "osc_2_wave_frame", "filter_1_resonance"},
}

// heroSweeps: a control the loop's LFO takes across most of its range, where the small swing of heroMoves
// would hardly show: Vivace is the first panel a visitor sees, and both its wavetables are to be seen
// travelling through their frames (the owner, 2026-11-27). Each is given as the middle and half the width of
// its sweep (of the control's range), the seconds one turn takes (a whole part of the loop's four, so the
// loop closes) and where in the turn it starts.
type heroSweep struct{ mid, half, period, phase float64 }

var heroSweeps = map[string]map[string]heroSweep{
	"vivace": {
		"osc_1_wave_frame": {0.50, 0.44, 4, -math.Pi / 2}, // from its first frame to its last and back, once a loop
		"osc_2_wave_frame": {0.50, 0.40, 2, math.Pi / 2},  // twice a loop, the other way round
	},
}

func (w heroSweep) at(tsec float64) float64 {
	return w.mid + w.half*math.Sin(2*math.Pi*tsec/w.period+w.phase)
}

// heroReports: what a module's engine would say of itself while it plays, for a panel that reads that and not a
// knob. Vivace's tables are drawn at "wave_pos" (where in its table each oscillator plays, 0..1; 2: off).
var heroReports = map[string]func(tsec float64) map[string]string{
	"vivace": func(tsec float64) map[string]string {
		w := heroSweeps["vivace"]
		return map[string]string{"wave_pos": fmt.Sprintf(`{"pos":[%.4f,%.4f,2]}`, w["osc_1_wave_frame"].at(tsec), w["osc_2_wave_frame"].at(tsec))}
	},
}

func TestHeroFrames(t *testing.T) {
	out := os.Getenv("PUNG_HERO_FRAMES")
	if out == "" {
		t.Skip("PUNG_HERO_FRAMES not set")
	}
	const fps, seconds = 20, 4.0
	probes := cardShotProbes(t)
	screenMu.Lock()
	screenResults = probes
	screenMu.Unlock()
	initFaces()
	natDir, _ := filepath.Abs("../native")
	ids := []string{"nodalred", "ostirus", "vavra", "xenia", "vivace"}
	if only := os.Getenv("PUNG_HERO_ONLY"); only != "" {
		ids = strings.Split(only, ",")
	}
	for _, id := range ids {
		v := probes[id]
		if v.Probe == nil {
			t.Errorf("%s: no probe record (scripts/screens/probes.json)", id)
			continue
		}
		raw := map[string]string{}
		for k, x := range v.Probe.Initial {
			raw[k] = x
		}
		if b, err := os.ReadFile(filepath.Join(cardShotDir, "values", id+".json")); err == nil {
			json.Unmarshal(b, &raw) //nolint:errcheck
		}
		cm := buildMeta(id, func(k string) (string, bool) { s, ok := v.Probe.Meta[k]; return s, ok })
		if cm == nil {
			t.Errorf("%s: no metadata", id)
			continue
		}
		if cardShotEmulators[id] {
			for k, x := range neutralValues(cm) {
				if _, ok := raw[k]; !ok {
					raw[k] = x
				}
			}
		}
		// a sound for the picture, of the test's own: values the hero loop names (hero-values/<id>.json)
		if b, err := os.ReadFile(filepath.Join(cardShotDir, "hero-values", id+".json")); err == nil {
			json.Unmarshal(b, &raw) //nolint:errcheck
		}
		root := t.TempDir()
		dir := filepath.Join(root, "sound_generators", id)
		os.MkdirAll(dir, 0o755)                                                                                              //nolint:errcheck
		os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"`+id+`","component_type":"sound_generator"}`), 0o644) //nolint:errcheck
		set := newOverrides(natDir).get(root, id)
		if set == nil || set.failed != "" {
			t.Errorf("%s: its screens do not load: %+v", id, set)
			continue
		}
		var comp *ovCompartment
		for _, c := range set.compartments {
			if c.takeover {
				comp = c
				break
			}
		}
		if comp == nil {
			t.Errorf("%s: no front panel", id)
			continue
		}
		scr, keys := comp.pageScreen(0)
		if dump := os.Getenv("PUNG_HERO_KEYS"); dump != "" { // what the panel reads, to make up a sound for it
			type kv struct {
				Key, Value, Type string
				Min, Max         float64
				Options          []string `json:",omitempty"`
			}
			var list []kv
			for _, k := range keys {
				e := kv{Key: k, Value: raw[k]}
				if m := cm.Params[k]; m != nil {
					e.Type, e.Min, e.Max, e.Options = m.Type, m.Min, m.Max, m.Options
				}
				list = append(list, e)
			}
			b, _ := json.MarshalIndent(list, "", " ")
			os.WriteFile(filepath.Join(dump, id+".json"), b, 0o644) //nolint:errcheck
		}
		if scr == nil {
			t.Errorf("%s: the panel draws no screen", id)
			continue
		}
		// the cutoffs an LFO of the test's own moves
		var cutoffs []string
		for _, k := range keys {
			if m := cm.Params[k]; m != nil && m.Type != "enum" && m.Max > m.Min && strings.Contains(k, "cutoff") && !strings.Contains(k, "2") {
				cutoffs = append(cutoffs, k)
			}
		}
		// and what else an LFO of the test's own moves, so the panel shows what a sound's modulation looks like on it
		for _, k := range heroMoves[id] {
			if m := cm.Params[k]; m != nil && m.Type != "enum" && m.Max > m.Min {
				cutoffs = append(cutoffs, k)
			}
		}
		sort.Strings(cutoffs)
		var labels []string
		for _, p := range comp.pages {
			labels = append(labels, p.label)
		}
		knobs := comp.keys
		if len(comp.pages) > 0 {
			knobs = comp.pages[0].keys
		}
		info := map[string]any{"$knobs": knobs, "$page": 0, "$pages": labels}
		s := &Slot{}
		ls := &liveSession{slot: s, pics: map[string]*livePic{}, subs: map[chan []byte]bool{}}
		fdir := filepath.Join(out, id)
		os.RemoveAll(fdir)       //nolint:errcheck
		os.MkdirAll(fdir, 0o755) //nolint:errcheck
		render := func(lo liveOut, tsec float64) *image.NRGBA {
			if say := heroReports[id]; say != nil {
				for k, v := range say(tsec) {
					raw[k] = v
				}
			}
			vals := ovValuesOf(cm, keys, func(k string) (string, bool) { x, ok := raw[k]; return x, ok })
			withMod(vals, cm, func(k string) (string, bool) {
				for i, c := range cutoffs {
					if c == k {
						m := cm.Params[k]
						if sw, ok := heroSweeps[id][k]; ok {
							return fmt.Sprint(m.Min + sw.at(tsec)*(m.Max-m.Min)), true
						}
						// two turns a loop, each key a little behind the last
						lfo := math.Sin(2*math.Pi*tsec/2.0 - 0.9*float64(i))
						f := math.Max(0.05, math.Min(0.95, vals[k].Frac+0.2*lfo))
						return fmt.Sprint(m.Min + f*(m.Max-m.Min)), true
					}
				}
				return "", false
			})
			img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
			pl := placement{w: &ovWidget{keys: keys, draw: scr}, col: 0, span: 8, full: true, info: info, live: ls, liveOut: lo, liveKey: "hero/" + id}
			if !set.render(img, pl, vals, "", slotColor(0)) {
				t.Fatalf("%s: %s", id, set.failed)
			}
			flat := image.NewNRGBA(img.Bounds())
			draw.Draw(flat, flat.Bounds(), image.Black, image.Point{}, draw.Src)
			draw.Draw(flat, flat.Bounds(), img, img.Bounds().Min, draw.Over)
			return flat
		}
		render(ls.frame(), 0) // registers its pictures with the sound's session
		// a chord a moment in, held, let go: the loop ends as it began, at rest
		type ev struct {
			at   float64
			note byte
			on   bool
		}
		evs := []ev{{0.25, 57, true}, {0.36, 60, true}, {0.47, 64, true}, {2.05, 57, false}, {2.05, 60, false}, {2.05, 64, false}}
		ei, ph, held := 0, 0.0, 0
		level := 0.0
		start := time.Now()
		n := int(fps * seconds)
		for f := 0; f < n; f++ {
			due := start.Add(time.Duration(float64(f) / fps * float64(time.Second)))
			time.Sleep(time.Until(due))
			tsec := float64(f) / fps
			for ei < len(evs) && evs[ei].at <= tsec {
				e := evs[ei]
				if e.on {
					s.live.trackMidi([]byte{0x90, e.note, 104})
					held++
				} else {
					s.live.trackMidi([]byte{0x80, e.note, 0})
					held--
				}
				ei++
			}
			// the sound, as loud as the notes: up fast, away slowly
			target := 0.0
			if held > 0 {
				target = 0.5
			}
			if target > level {
				level += (target - level) * 0.6
			} else {
				level += (target - level) * 0.12
			}
			if level > 0.002 {
				blk := block(float32(level), 220, moduleRate/fps, &ph)
				ph2 := ph * 2.01
				for i, x := range block(float32(level*0.5), 441, moduleRate/fps, &ph2) {
					blk[i] += x
				}
				s.live.feedAudio(blk)
			} else {
				s.live.feedAudio(make([]float32, 2*moduleRate/fps))
			}
			ls.tick()
			img := render(ls.frame(), tsec)
			w, err := os.Create(filepath.Join(fdir, fmt.Sprintf("f-%03d.png", f)))
			if err != nil {
				t.Fatal(err)
			}
			png.Encode(w, img) //nolint:errcheck
			w.Close()
		}
		t.Logf("%s: %d frames, cutoffs %v", id, n, cutoffs)
	}
}
