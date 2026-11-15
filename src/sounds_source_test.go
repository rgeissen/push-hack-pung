package main

import (
	"encoding/json"
	"os"
	"testing"
)

// testdata/contracts.json: what these modules publish (ui_hierarchy and
// chain_params), captured by Schwung (tests/fixtures/module-contracts.json).
func contractMeta(t *testing.T, id string) *compMeta {
	t.Helper()
	raw, err := os.ReadFile("testdata/contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var all map[string]struct {
		Hier   json.RawMessage `json:"ui_hierarchy"`
		Params json.RawMessage `json:"chain_params"`
	}
	if err := json.Unmarshal(raw, &all); err != nil {
		t.Fatal(err)
	}
	c, ok := all[id]
	if !ok {
		t.Fatalf("no contract for %s", id)
	}
	return buildMeta(id, func(k string) (string, bool) {
		switch k {
		case "ui_hierarchy":
			return string(c.Hier), true
		case "chain_params":
			return string(c.Params), true
		}
		return "", false
	})
}

func TestFactoryListsFromContracts(t *testing.T) {
	q := loadPresetQuirks("../overrides")
	cases := []struct {
		id                      string
		lists                   int
		mode, list, count, name string
		bankItems, bankSelect   string
	}{
		{id: "obxd", lists: 1, list: "preset", count: "preset_count", name: "preset_name", bankItems: "fxb_bank_list", bankSelect: "bank_index"},
		{id: "dexed", lists: 1, list: "preset", count: "preset_count", name: "preset_name", bankItems: "syx_bank_list", bankSelect: "syx_bank_index"},
		{id: "sf2", lists: 1, list: "preset", count: "preset_count", name: "preset_name", bankItems: "soundfont_list", bankSelect: "soundfont_index"},
		{id: "noisemaker", lists: 1, list: "preset", count: "preset_count", name: "preset_name", bankItems: "bank_list", bankSelect: "bank_index"},
		{id: "surge", lists: 1, list: "preset", count: "preset_count", name: "preset_name", bankItems: "category_list", bankSelect: "jump_to_category"},
		{id: "moog", lists: 1, list: "preset", count: "preset_count", name: "preset_name"},
		// modes: one list each; Save to Slot is an action, not a bank
		{id: "minijv", lists: 2, mode: "patch", list: "preset", count: "preset_count", name: "preset_name", bankItems: "expansion_list", bankSelect: "jump_to_expansion"},
		// its list picks the effect (overrides/presets.json)
		{id: "clap", lists: 0},
		// no list at all: user sounds only
		{id: "cloudseed", lists: 0},
	}
	for _, c := range cases {
		got := factoryLists(contractMeta(t, c.id), q[c.id])
		if len(got) != c.lists {
			t.Errorf("%s: %d lists %+v, want %d", c.id, len(got), got, c.lists)
			continue
		}
		if c.lists == 0 {
			continue
		}
		g := got[0]
		if g.Mode != c.mode || g.List != c.list || g.Count != c.count || g.Name != c.name || g.BankItems != c.bankItems || g.BankSelect != c.bankSelect {
			t.Errorf("%s: %+v", c.id, g)
		}
	}
	jv := factoryLists(contractMeta(t, "minijv"), q["minijv"])
	if jv[1].Mode != "performance" || jv[1].List != "performance" || jv[1].Count != "num_performances" {
		t.Errorf("minijv's performance list: %+v", jv[1])
	}
}

func TestPresetListReading(t *testing.T) {
	pl := presetList{List: "preset", Count: "preset_count", Base: 1}
	if i, ok := pl.currentIndex("6"); !ok || i != 5 || pl.value(5) != "6" {
		t.Fatal("a 1-based list")
	}
	get := func(k string) (string, bool) { return map[string]string{"preset_count": "-1"}[k], true }
	if _, ok := pl.count(get); ok {
		t.Fatal("-1 is a count not known yet (JE-8086 while a bank loads), not a list of none")
	}
	knob := presetList{List: "preset", Options: []string{"Init", "Bells", "Pad"}}
	if i, ok := knob.currentIndex("Bells"); !ok || i != 1 {
		t.Fatal("a knob answering its option's name")
	}
	if n, _ := knob.nameAt(2, nil); n != "Pad" {
		t.Fatal("a knob names every sound up front")
	}
	rows := parseBankRows(`[{"index":0,"label":"Factory"},{"index":3,"name":"User"},"Plain"]`)
	if len(rows) != 3 || rows[1].Index != 3 || rows[1].Name != "User" || rows[2].Index != 2 || rows[2].Name != "Plain" {
		t.Fatalf("%+v", rows)
	}
}
