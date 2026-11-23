//go:build linux

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The pictures the Modules page shows of a module's own interface (its card
// and its detail sheet), drawn at release time (make screens) from what is
// kept in the repository: each module's probe record and a sound of its
// own (scripts/screens/). The emulators' records carry no values: their
// panels show what Pung draws without the player's firmware or factory
// sounds, which never go into a package or a public page.

const cardShotDir = "../scripts/screens"

// cardShotModules: the modules whose screen files draw a front panel.
func cardShotModules() []string {
	var ids []string
	for _, rel := range []string{"../overrides", "../native"} {
		ents, _ := os.ReadDir(rel)
		for _, e := range ents {
			raw, err := os.ReadFile(filepath.Join(rel, e.Name(), "push_ui.js"))
			if err == nil && (strings.Contains(string(raw), "front_panel: true") || strings.Contains(string(raw), "takeover: true")) {
				ids = append(ids, e.Name())
			}
		}
	}
	sort.Strings(ids)
	return ids
}

func cardShotProbes(t *testing.T) map[string]screenVerdict {
	raw, err := os.ReadFile(filepath.Join(cardShotDir, "probes.json"))
	if err != nil {
		t.Fatal(err)
	}
	probes := map[string]screenVerdict{}
	if err := json.Unmarshal(raw, &probes); err != nil {
		t.Fatal(err)
	}
	return probes
}

// Every module with a front panel can be drawn for its card: its probe
// record is kept (a new screen needs one: copy it from the Push's
// module-screen.json into scripts/screens/probes.json, and a sound of its
// own into values/, never an emulator's).
func TestCardShotInputs(t *testing.T) {
	probes := cardShotProbes(t)
	for _, id := range cardShotModules() {
		v, ok := probes[id]
		if !ok || v.Probe == nil || v.Probe.Meta["chain_params"] == "" {
			t.Errorf("%s draws a front panel, but scripts/screens/probes.json has no probe record of it", id)
		}
	}
	for id := range cardShotEmulators {
		if _, err := os.Stat(filepath.Join(cardShotDir, "values", id+".json")); err == nil {
			t.Errorf("%s: an emulator's values come from the player's firmware and factory sounds: none in scripts/screens/values", id)
		}
		if v, ok := probes[id]; ok && v.Probe != nil && len(v.Probe.Initial) > 0 {
			t.Errorf("%s: an emulator's probe record keeps no values (%d)", id, len(v.Probe.Initial))
		}
	}
}

// cardShotEmulators: the modules that play the player's own firmware; their
// sounds (factory or not) are the player's too
var cardShotEmulators = map[string]bool{"xenia": true, "vavra": true, "ostirus": true, "osirus": true, "nodalred": true, "jp8000": true, "minijv": true}

// neutralValues: an emulator's panel without a sound of the player's: each
// parameter at its declared default, else a list at its first option and a
// number in the middle of its range (a sound list at its first place): an
// instrument at rest, made up by Pung, not read from any firmware.
func neutralValues(cm *compMeta) map[string]string {
	out := map[string]string{}
	if cm == nil {
		return out
	}
	for k, m := range cm.Params {
		switch {
		case m.ReadOnly || m.Type == "string" || m.Type == "file" || m.Type == "canvas":
		case m.Default != nil:
			out[k] = strconv.FormatFloat(*m.Default, 'f', -1, 64)
		case m.Type == "enum":
			out[k] = "0"
		case k == "preset" || k == "performance":
			out[k] = strconv.FormatFloat(m.Min, 'f', -1, 64)
		case m.Type == "int":
			out[k] = strconv.Itoa(int(math.Round((m.Min + m.Max) / 2)))
		case m.Max > m.Min:
			out[k] = strconv.FormatFloat((m.Min+m.Max)/2, 'f', -1, 64)
		}
	}
	return out
}

type cardShotPage struct {
	File  string `json:"file"`
	Label string `json:"label"`
}

type cardShotIndex struct {
	Panel    string         `json:"panel"`
	Segments string         `json:"segments,omitempty"`
	Pages    []cardShotPage `json:"pages,omitempty"`
}

// TestCardShots draws them (make screens): PUNG_CARD_SHOTS=<out dir> gets
// <id>/panel.png (the front panel's first page), <id>/segments.png (its
// sections, segment mode), <id>/p-NN.png (each screen of the module's
// own once: a compartment's first page, a page's own screen) and index.json naming them.
func TestCardShots(t *testing.T) {
	out := os.Getenv("PUNG_CARD_SHOTS")
	if out == "" {
		t.Skip("PUNG_CARD_SHOTS not set")
	}
	probes := cardShotProbes(t)
	screenMu.Lock()
	screenResults = probes
	screenMu.Unlock()
	initFaces()
	os.MkdirAll(out, 0o755)
	index := map[string]cardShotIndex{}
	for _, id := range cardShotModules() {
		v := probes[id]
		if v.Probe == nil {
			t.Errorf("%s: no probe record", id)
			continue
		}
		vals := map[string]string{}
		for k, x := range v.Probe.Initial {
			vals[k] = x
		}
		if raw, err := os.ReadFile(filepath.Join(cardShotDir, "values", id+".json")); err == nil {
			json.Unmarshal(raw, &vals) //nolint:errcheck
		}
		ovDir, _ := filepath.Abs("../overrides")
		if _, err := os.Stat(filepath.Join(ovDir, id, "push_ui.js")); err != nil {
			ovDir, _ = filepath.Abs("../native")
		}
		if cardShotEmulators[id] {
			// no sound of the player's: a neutral setting Pung makes up
			cm := buildMeta(id, func(k string) (string, bool) { s, ok := v.Probe.Meta[k]; return s, ok })
			for k, x := range neutralValues(cm) {
				if _, ok := vals[k]; !ok {
					vals[k] = x
				}
			}
		}
		g := openGallery(t, ovDir, id, v.Probe, vals)
		if g == nil {
			continue
		}
		dir := filepath.Join(out, id)
		os.MkdirAll(dir, 0o755)
		ix := cardShotIndex{}
		seen := map[string]bool{} // a compartment's screen once: its other pages differ in their knobs only
		for b := range g.cm.Banks {
			bk := g.cm.Banks[b]
			c := g.set.compartment(bk.Compartment)
			if c == nil {
				continue
			}
			switch {
			case c.takeover && ix.Panel == "":
				g.u.setBank(b)
				g.put()
				g.shot(filepath.Join(dir, "panel.png"))
				ix.Panel = "panel.png"
				if g.u.segPanel() != nil {
					g.u.top(segmentsButton)
					if g.u.segMode == segSelect {
						g.shot(filepath.Join(dir, "segments.png"))
						ix.Segments = "segments.png"
					}
					g.u.top(segmentsButton) // EXIT
				}
			case !c.takeover && c.screen != nil && !seen[c.id]:
				seen[c.id] = true
				g.u.setBank(b)
				g.put()
				fn := fmt.Sprintf("p-%02d.png", b)
				g.shot(filepath.Join(dir, fn))
				ix.Pages = append(ix.Pages, cardShotPage{File: fn, Label: c.label})
			case !c.takeover && c.screen == nil && bk.Page < len(c.pages) && c.pages[bk.Page].screen != nil:
				g.u.setBank(b) // a page with a screen of its own
				g.put()
				fn := fmt.Sprintf("p-%02d.png", b)
				g.shot(filepath.Join(dir, fn))
				ix.Pages = append(ix.Pages, cardShotPage{File: fn, Label: bk.Name})
			}
		}
		if ix.Panel == "" {
			t.Errorf("%s: no front panel drawn", id)
			continue
		}
		index[id] = ix
		t.Logf("%s: panel, %d pages%s", id, len(ix.Pages), map[bool]string{true: ", segments"}[ix.Segments != ""])
	}
	raw, _ := json.MarshalIndent(index, "", " ")
	if err := os.WriteFile(filepath.Join(out, "index.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}
