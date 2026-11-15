package main

import (
	"os"
	"strings"
	"testing"
)

func TestPlanByNames(t *testing.T) {
	for _, m := range []string{"jp8000", "minijv", "dexed", "osirus"} {
		raw, err := os.ReadFile("testdata/keys_" + m + ".txt")
		if err != nil {
			t.Fatal(err)
		}
		keys := strings.Fields(string(raw))
		banks := planByNames(keys)
		var got []string
		numbered := 0
		for _, b := range banks {
			if len(b.Keys) == 0 || len(b.Keys) > 8 {
				t.Errorf("%s: bank %q has %d keys", m, b.Name, len(b.Keys))
			}
			if b.Name == "" {
				numbered++
			}
			got = append(got, b.Keys...)
			if testing.Verbose() {
				t.Logf("%s %-28s %v", m, b.Name, b.Keys)
			}
		}
		if strings.Join(got, " ") != strings.Join(keys, " ") {
			t.Errorf("%s: keys lost, doubled or reordered", m)
		}
		if numbered*4 > len(banks) {
			t.Errorf("%s: %d of %d pages have no name", m, numbered, len(banks))
		}
	}
	// a section that fits a page is not split across two
	b := planByNames([]string{"mode", "lfo_rate", "lfo_depth", "lfo_wave", "amp_attack", "amp_decay", "amp_sustain", "amp_release", "amp_level", "cutoff"})
	for _, x := range b {
		t.Logf("%s %v", x.Name, x.Keys)
	}
	if len(b) != 2 || b[1].Name != "AMP / FILTER" {
		t.Errorf("amp split or misnamed: %+v", b)
	}
}

// A hierarchy with modes and no root: its sections are found under the
// first mode's editing level, and its preset list above it.
func TestHierarchyThroughModes(t *testing.T) {
	for _, c := range []struct {
		m, first, preset string
		has              []string
	}{
		{"jp8000", "MAIN", "patch", []string{"OSC 1", "FILTER", "AMP", "LFO 1", "VELOCITY"}},
		{"minijv", "MAIN", "preset", nil},
	} {
		get := map[string]string{}
		for _, k := range []string{"ui_hierarchy", "chain_params"} {
			raw, err := os.ReadFile("testdata/" + c.m + "_" + k + ".json")
			if err != nil {
				t.Fatal(err)
			}
			get[k] = string(raw)
		}
		cm := buildMeta(c.m, getter(get))
		var names []string
		for _, b := range cm.Banks {
			names = append(names, b.Name)
		}
		t.Logf("%s: %v (presets %+v)", c.m, names, cm.Presets)
		if len(names) == 0 || names[0] != c.first || cm.Presets.List != c.preset {
			t.Errorf("%s: banks %v, presets %+v", c.m, names, cm.Presets)
		}
		for _, h := range c.has {
			if !contains(names, h) {
				t.Errorf("%s: no %s page in %v", c.m, h, names)
			}
		}
	}
}
