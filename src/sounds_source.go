package main

// sounds_source.go: a module's own (factory) sounds, read from its contract
// the way Schwung's browser reads it, for every module alike
// (docs/PRESETS.md, "What a module offers").
//
// In order: overrides/presets.json for a module whose contract is unusual;
// the ui_hierarchy's preset list (list_param/count_param/name_param), per
// mode where the module has modes; its bank chooser (an items level in the
// list's own menu, or one that returns to the list); else a preset knob with
// named options (aphex, spectra, ...). A list that only looks like presets
// (Clap's effect picker) is excluded in the table, never guessed.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// presetList: how one list of factory sounds is read and chosen.
type presetList struct {
	Mode  string `json:"mode,omitempty"` // the module's mode this list belongs to ("" = always)
	List  string `json:"list"`           // the key holding the index; writing it loads a sound
	Count string `json:"count,omitempty"`
	Name  string `json:"name,omitempty"` // the current sound's name
	Base  int    `json:"base,omitempty"` // the index the module counts from (palette: 1)
	// Bulk names every sound in one read (a JSON array, "preset_names");
	// NameAt names any index without loading it ("preset_name_%d"): a whole
	// list's names without a sound played. Schwung's order (the param-pages
	// audit, 2026-07-26): bulk, per index, else the current name only. A
	// module that does not answer them is learned as it is heard.
	Bulk    string   `json:"bulk,omitempty"`
	NameAt  string   `json:"name_at,omitempty"`
	Options []string `json:"-"` // a preset knob's options: every name, up front
	// a bank chooser: an items level (rows, the key that picks one)
	BankItems  string `json:"bank_items,omitempty"`
	BankSelect string `json:"bank_select,omitempty"`
	BankName   string `json:"bank_name,omitempty"` // the current bank's name, where the module says
	// Jump: the chooser moves within one list (Surge's categories, Mini-JV's
	// expansion cards: jump_to_*) rather than changing it
	Jump bool `json:"jump,omitempty"`
}

// presetQuirk: a row of overrides/presets.json.
type presetQuirk struct {
	None bool         `json:"none,omitempty"` // no factory list (its "list" picks something else)
	Why  string       `json:"why,omitempty"`
	List []presetList `json:"lists,omitempty"` // replaces what the contract says
	// Patch amends the lists the contract gives (fields set here win)
	Patch *presetList `json:"patch,omitempty"`
}

func loadPresetQuirks(dirs ...string) map[string]presetQuirk {
	out := map[string]presetQuirk{}
	for _, d := range dirs {
		raw, err := os.ReadFile(filepath.Join(d, "presets.json"))
		if err != nil {
			continue
		}
		var m map[string]json.RawMessage // "_about" and the like are notes, not rows
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		for k, v := range m {
			var q presetQuirk
			if !strings.HasPrefix(k, "_") && json.Unmarshal(v, &q) == nil {
				out[k] = q
			}
		}
	}
	return out
}

// factoryLists: the module's factory lists, one per mode (or one), nil for a
// module with none.
func factoryLists(cm *compMeta, q presetQuirk) []presetList {
	if q.None || cm == nil {
		return nil
	}
	if len(q.List) > 0 {
		return q.List
	}
	var out []presetList
	if cm.Levels != nil {
		if len(cm.Modes) > 0 {
			for _, m := range cm.Modes {
				if name, lv := modeBrowser(cm.Levels, m); lv != nil {
					pl := listOf(cm.Levels, name, lv)
					pl.Mode = m
					out = append(out, pl)
				}
			}
		} else if lv := cm.Levels["root"]; lv != nil && str(lv["list_param"]) != "" {
			out = append(out, listOf(cm.Levels, "root", lv))
		}
	}
	if len(out) == 0 {
		// a preset knob with named options
		for _, k := range []string{"preset", "patch", "program", "kit"} {
			if m := cm.Params[k]; m != nil && m.Type == "enum" && len(m.Options) > 1 {
				out = append(out, presetList{List: k, Options: m.Options})
				break
			}
		}
	}
	if q.Patch != nil {
		for i := range out {
			p := *q.Patch
			if p.Base != 0 {
				out[i].Base = p.Base
			}
			if p.NameAt != "" {
				out[i].NameAt = p.NameAt
			}
			if p.Bulk != "" {
				out[i].Bulk = p.Bulk
			}
			if p.BankName != "" {
				out[i].BankName = p.BankName
			}
		}
	}
	return out
}

// modeBrowser: the list level a mode reaches, walking "children" from the
// mode's level as Move's browser does (JE-8086: patch -> its banks -> its
// patches: the last list before the editor).
func modeBrowser(levels map[string]map[string]any, mode string) (string, map[string]any) {
	name, lv := mode, levels[mode]
	var bName string
	var bLv map[string]any
	for i := 0; lv != nil && i < 8; i++ {
		if str(lv["list_param"]) != "" {
			bName, bLv = name, lv
		}
		next := str(lv["children"])
		if next == "" {
			break
		}
		name, lv = next, levels[next]
	}
	return bName, bLv
}

func listOf(levels map[string]map[string]any, name string, lv map[string]any) presetList {
	pl := presetList{List: str(lv["list_param"]), Count: str(lv["count_param"]), Name: str(lv["name_param"])}
	if pl.Name == "" {
		pl.Name = "preset_name" // Schwung's default (page_plan.mjs)
	}
	if pl.Name == "preset_name" { // Schwung's naming convention for the rest
		pl.Bulk, pl.NameAt = "preset_names", "preset_name_%d"
	}
	pl.BankItems, pl.BankSelect = bankChooser(levels, name, lv)
	pl.Jump = strings.HasPrefix(pl.BankSelect, "jump_to")
	return pl
}

// bankChooser: the items level that picks this list's bank: one in the
// list's own menu (OB-Xd's Banks, Dexed's Choose Bank, SF2's Choose
// Soundfont), else one that returns to the list once a row is picked
// (Surge's categories, Mini-JV's expansion cards). An items level whose pick
// is an action (Mini-JV's Save to Slot: do_save_to_slot) is not a bank.
func bankChooser(levels map[string]map[string]any, name string, lv map[string]any) (items, sel string) {
	isBank := func(l map[string]any) bool {
		s := str(l["select_param"])
		return l != nil && str(l["items_param"]) != "" && s != "" &&
			!strings.HasPrefix(s, "do_") && !strings.Contains(s, "save")
	}
	menus := []map[string]any{lv}
	if c := levels[str(lv["children"])]; c != nil {
		menus = append(menus, c) // Mini-JV's list -> its main page, where its menu is
	}
	for _, m := range menus {
		params, _ := m["params"].([]any)
		for _, x := range params {
			if p, ok := x.(map[string]any); ok {
				if l := levels[str(p["level"])]; isBank(l) {
					return str(l["items_param"]), str(l["select_param"])
				}
			}
		}
	}
	for _, l := range levels {
		if isBank(l) && str(l["navigate_to"]) == name {
			return str(l["items_param"]), str(l["select_param"])
		}
	}
	return "", ""
}

// bankRow: one row of a bank chooser.
type bankRow struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
}

// parseBankRows reads an items_param answer: rows {index,label|name} or
// plain strings (their position is their index).
func parseBankRows(raw string) []bankRow {
	var list []any
	if json.Unmarshal([]byte(raw), &list) != nil {
		return nil
	}
	var out []bankRow
	for i, x := range list {
		switch t := x.(type) {
		case string:
			out = append(out, bankRow{Index: i, Name: t})
		case map[string]any:
			r := bankRow{Index: i, Name: str(t["label"])}
			if r.Name == "" {
				r.Name = str(t["name"])
			}
			if n, ok := num(t["index"]); ok {
				r.Index = int(n)
			}
			out = append(out, r)
		}
	}
	return out
}

// currentIndex reads where a list is (a number, or for a knob its option).
func (pl presetList) currentIndex(v string) (int, bool) {
	v = strings.TrimSpace(v)
	if len(pl.Options) > 0 {
		m := paramMeta{Type: "enum", Options: pl.Options}
		return m.enumIndex(v)
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return 0, false
	}
	return i - pl.Base, true
}

// value is what is written to choose index i.
func (pl presetList) value(i int) string { return strconv.Itoa(i + pl.Base) }

// count reads the list's length; -1 (JE-8086 while a bank loads) is unknown.
func (pl presetList) count(get func(string) (string, bool)) (int, bool) {
	if len(pl.Options) > 0 {
		return len(pl.Options), true
	}
	if pl.Count == "" {
		return 0, false
	}
	v, ok := get(pl.Count)
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

// nameAt: the name of index i where the module can say it without loading
// it (a knob's options, or NameAt).
func (pl presetList) nameAt(i int, get func(string) (string, bool)) (string, bool) {
	if len(pl.Options) > 0 {
		if i >= 0 && i < len(pl.Options) {
			return pl.Options[i], true
		}
		return "", false
	}
	if pl.NameAt == "" {
		return "", false
	}
	v, ok := get(strings.Replace(pl.NameAt, "%d", strconv.Itoa(i+pl.Base), 1))
	if !ok || isSentinelName(v) {
		return "", false
	}
	return strings.TrimSpace(v), true
}
