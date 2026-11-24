package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// notALevel: a wider net than pmodNotLevel, for review: names of controls
// no LFO should sweep, whatever their range says (what picks a sound, a
// slot or a channel, what fires once). reviewedLevel: what it catches that
// was looked at and is a level (Mini-JV's Patch Level, the Virus' patch
// volume, its filter bank, its wave select, which its own matrix modulates).
var (
	notALevel     = regexp.MustCompile(`(?i)(^|[ _])(preset|program|patch|bank|slot|select|channel|midi|seed|trigger|reset|mutate|rnd|random_patch|init|load|save|focus)([ _]|$)`)
	reviewedLevel = regexp.MustCompile(`^(nvram_patchCommon_patch(level|pan)|patch_volume|patch_distortion_[a-z_]+|osc_init_phase|osc\d_wave_select|filter_bank_[a-z_]+)$`)
)

func suspect(mm *paramMeta) bool {
	return !reviewedLevel.MatchString(mm.Key) && (notALevel.MatchString(mm.Key) || notALevel.MatchString(mm.Name))
}

// TestPungModAudit: with PUNG_GALLERY_CACHE (the Push's module-screen.json),
// every shipped panel with segments, as Pung's LFO A sees it: no control it
// reaches is named like a choice (a sound, a slot, a trigger), and MORE
// starts with a page that holds a destination that matters when any does.
// -v prints each panel's FIXED switches and MORE's first pages.
func TestPungModAudit(t *testing.T) {
	raw, err := os.ReadFile(os.Getenv("PUNG_GALLERY_CACHE"))
	if err != nil {
		t.Skip("PUNG_GALLERY_CACHE not set")
	}
	cache := map[string]screenVerdict{}
	if err := json.Unmarshal(raw, &cache); err != nil {
		t.Fatal(err)
	}
	screenMu.Lock()
	screenResults = cache
	screenMu.Unlock()
	initFaces()
	panels := 0
	for _, rel := range []string{"../overrides", "../native"} {
		ovDir, _ := filepath.Abs(rel)
		ents, _ := os.ReadDir(ovDir)
		for _, e := range ents {
			id := e.Name()
			v, ok := cache[id]
			if _, err := os.Stat(filepath.Join(ovDir, id, "push_ui.js")); err != nil || !ok || v.Probe == nil {
				continue
			}
			rig := openGallery(t, ovDir, id, v.Probe, map[string]string{})
			if rig == nil {
				continue
			}
			m := &modMap{Dests: []string{}, dests: map[string]bool{}}
			if mm := parseModMap(v.Probe.Meta["mod_map"]); mm != nil {
				m = mm
			}
			m.Sources = append(m.Sources, pmodSources...)
			for _, c := range rig.set.compartments {
				if len(c.segments) == 0 {
					continue
				}
				panels++
				var fixed []string
				for _, sg := range c.segments {
					keys := sg.keys
					if len(sg.assign) > 0 {
						keys = sg.assign
					}
					for _, k := range keys {
						mm := rig.cm.Params[k]
						if k == "" || mm == nil {
							continue
						}
						if m.reaches(rig.cm, "p_lfo_a", k) {
							if suspect(mm) {
								t.Errorf("%s/%s: LFO A reaches %s (%s), which is not a level", id, sg.label, k, mm.Name)
							}
						} else if mm.Type != "enum" {
							fixed = append(fixed, k)
						}
					}
				}
				pages := morePagesOf(c, rig.cm, m, "p_lfo_a")
				var names []string
				matters := -1
				for i, p := range pages {
					names = append(names, p.name)
					for _, k := range p.keys {
						if mm := rig.cm.Params[k]; mm != nil && suspect(mm) {
							t.Errorf("%s: MORE %s offers %s (%s), which is not a level", id, p.name, k, mm.Name)
						}
						if matters < 0 && destMatters(k) {
							matters = i
						}
					}
				}
				if matters > 0 {
					t.Errorf("%s: MORE for LFO A starts with %s; the first page that matters is %s", id, pages[0].name, pages[matters].name)
				}
				if len(names) > 4 {
					names = append(names[:4], "…")
				}
				t.Logf("%-16s FIXED for Pung: %-60s MORE: %s", id, strings.Join(fixed, " "), strings.Join(names, ", "))
			}
		}
	}
	t.Logf("%d panels", panels)
}
