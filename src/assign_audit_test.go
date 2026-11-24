package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// TestAssignAudit: with PUNG_ASSIGN_MAPS=<dir of <id>.json> (each module's
// get_param("mod_map"), e.g. from scripts/render-check.sh <id> <assets> 1
// '?mod_map'), every shipped panel with segments is checked against what its
// module routes: a segment's assign list and the panel's assign_pages name
// only what a route may reach, and a destination that matters is offered in
// a segment or on the panel's assign_pages, not left to the module's pages
// in MORE. -v prints each segment as ASSIGN shows it (✗: FIXED).
func TestAssignAudit(t *testing.T) {
	dir := os.Getenv("PUNG_ASSIGN_MAPS")
	if dir == "" {
		t.Skip("PUNG_ASSIGN_MAPS not set")
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	for _, f := range files {
		id := strings.TrimSuffix(filepath.Base(f), ".json")
		raw, _ := os.ReadFile(f)
		m := parseModMap(strings.TrimSpace(string(raw)))
		if m == nil {
			t.Errorf("%s: no mod_map in %s", id, f)
			continue
		}
		ovDir := "../native"
		if _, err := os.Stat(filepath.Join(ovDir, id, "push_ui.js")); err != nil {
			ovDir = "../overrides"
		}
		root := t.TempDir()
		md := filepath.Join(root, "sound_generators", id)
		os.MkdirAll(md, 0o755)
		os.WriteFile(filepath.Join(md, "module.json"), []byte(`{"id":"`+id+`","component_type":"sound_generator"}`), 0o644)
		set := newOverrides(ovDir).get(root, id)
		if set == nil || set.failed != "" {
			t.Errorf("%s: the screen file did not load", id)
			continue
		}
		reach := map[string]bool{}
		for _, s := range m.Sources {
			for _, d := range s.Dests {
				reach[d] = true
			}
		}
		for _, d := range m.Dests {
			reach[d] = true
		}
		offered := map[string]bool{}
		for _, c := range set.compartments {
			if len(c.segments) == 0 {
				continue
			}
			for _, sg := range c.segments {
				cols := sg.keys
				if len(sg.assign) > 0 {
					cols = sg.assign
				}
				var line []string
				for _, k := range cols {
					if k == "" {
						line = append(line, "-")
						continue
					}
					offered[k] = true
					if !reach[k] {
						if len(sg.assign) > 0 {
							t.Errorf("%s/%s: %s assigns %s, which no route reaches", id, c.id, sg.label, k)
						}
						k += "✗"
					}
					line = append(line, k)
				}
				t.Logf("%s/%s %-12s %s", id, c.id, sg.label, strings.Join(line, " "))
			}
			for _, pg := range c.assignPages {
				for _, k := range pg.keys {
					if !reach[k] {
						t.Errorf("%s/%s: assign page %s names %s, which no route reaches", id, c.id, pg.name, k)
					}
					offered[k] = true
				}
				t.Logf("%s/%s MORE %-12s %s", id, c.id, pg.name, strings.Join(pg.keys, " "))
			}
		}
		var missed []string
		for k := range reach {
			if !offered[k] && destMatters(k) {
				missed = append(missed, k)
			}
		}
		sort.Strings(missed)
		if len(missed) > 0 {
			t.Errorf("%s: destinations that matter only in the module's pages: %s", id, strings.Join(missed, " "))
		}
	}
}
