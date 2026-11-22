package main

// model.go: what a chain component publishes about its parameters, and the
// banks (pages of 8 knobs) the native Push UI builds from it.
//
// Sources, in Schwung's order of authority:
//   - "<prefix>:chain_params": the typed list (key, name, type, min, max,
//     unit, options, display_format). It is the only source of a range.
//   - "<prefix>:ui_hierarchy": the module's own grouping. Its root level
//     names the levels; each level lists its knobs.
// A parameter with no metadata is shown read-only. Schwung's rule: never
// invent a 0..1 float for it (that wrote 0.058750 into an enum on Move).

import (
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strconv"
	"strings"
)

type paramMeta struct {
	Key  string
	Name string
	// module: whose parameter it is; its screen file may say how its values
	// read (push.display, override.go)
	module string
	// Short: the name where it shares a column with its value under a
	// picture (chain_params "short"), the section the page's title already
	// says left out: OsTIrus' "AEnv Sus" is "Sustain" on Amp Env
	Short    string
	Type     string // float | int | enum | bool | string
	Min, Max float64
	Step     float64
	Unit     string
	Format   string
	Options  []string
	Default  *float64
	ReadOnly bool
	Bipolar  bool
	// Selector: turning it changes what the other parameters read (Nodal
	// Red's Edit Slot: one panel, four slots). Live has their values of
	// before; they are read back at once (devices.go, wantResync)
	Selector bool
	// Avail: a key of the module's that says which options can be chosen
	// now, a character an option ("1010"): a turn passes over the others
	// (Nodal Red 2X: the edit slot, among the slots that are on)
	Avail string
	// Labels: the text of every value of a number, from Min up (OsTIrus: a
	// send level in dB, a delay time, an oscillator's shape). Given inline
	// ("value_labels": [...]) or by name ("value_labels": "L3"), the names
	// resolved from the module's "value_lists" (buildMeta): a long list
	// repeated on every parameter would not fit chain_params.
	Labels    []string
	labelsRef string
	// File: a file parameter (the module's "filepath"): a sample, a
	// wavetable, a kit; chosen in the file browser, never turned (files.go)
	File *fileSpec
	// Pos: a position in a file parameter's sample (the module's
	// "wav_position"): a number like any other, drawn on the waveform
	Pos *posSpec
}

// posSpec: what a wav_position says: whose sample, and which edge it is.
type posSpec struct {
	Of   string // the file parameter's key
	Mode string // position | start | end
}

type bank struct {
	Name        string
	Keys        []string // up to 8; "" is an empty column
	Compartment string   // the module's compartment this page belongs to ("": a generic bank)
	CompLabel   string   // that compartment's label
	Page        int      // the compartment's page it comes from (pages[Page])
}

type compMeta struct {
	Module  string
	Params  map[string]*paramMeta
	Order   []string
	Banks   []bank
	Presets struct{ List, Count, Name string } // ui_hierarchy root's preset browser
	// the module's ui_hierarchy as it gave it (sounds_source.go reads its
	// preset lists, banks and modes from it)
	Levels    map[string]map[string]any
	Modes     []string
	ModeParam string
	// Initial: each parameter's value in a freshly created instance, read
	// from the probe. A Live device starts from these: most modules declare
	// no "default", and a guessed 0 is volume 0 (Braids, 2026-11-14).
	Initial map[string]string
}

func num(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case string:
		f, err := strconv.ParseFloat(t, 64)
		return f, err == nil
	}
	return 0, false
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func metaFromObj(o map[string]any) *paramMeta {
	m := &paramMeta{Key: str(o["key"]), Name: str(o["name"]), Short: str(o["short"]), Type: str(o["type"]),
		Unit: str(o["unit"]), Format: str(o["display_format"])}
	if m.Name == "" {
		m.Name = str(o["label"])
	}
	if m.Name == "" {
		m.Name = m.Key
	}
	m.Selector, _ = o["selector"].(bool)
	m.Avail = str(o["available_param"])
	switch vl := o["value_labels"].(type) {
	case string:
		m.labelsRef = vl
	case []any:
		for _, x := range vl {
			m.Labels = append(m.Labels, fmt.Sprint(x))
		}
	}
	m.Min, _ = num(o["min"])
	m.Max, _ = num(o["max"])
	m.Step, _ = num(o["step"])
	if d, ok := num(o["default"]); ok {
		m.Default = &d
	}
	if opts, ok := o["options"].([]any); ok {
		for _, x := range opts {
			if s, ok := x.(string); ok {
				m.Options = append(m.Options, s)
			} else if mo, ok := x.(map[string]any); ok {
				m.Options = append(m.Options, str(mo["label"])+str(mo["name"]))
			}
		}
	}
	switch m.Type {
	case "filepath", "file":
		m.Type, m.File = "file", fileSpecFrom(o)
	case "wav_position":
		// a number: normalized 0..1 shown as a percentage, or ms, or seconds
		m.Pos = &posSpec{Of: str(o["filepath_param"]), Mode: str(o["mode"])}
		switch m.Pos.Mode {
		case "trim_front":
			m.Pos.Mode = "start"
		case "trim_end":
			m.Pos.Mode = "end"
		}
		m.Type = "float"
		switch strings.ToLower(str(o["display_unit"])) {
		case "ms":
			m.Unit = "ms"
			if m.Step == 0 {
				m.Step = 1
			}
		case "sec", "s":
			m.Unit = "s"
		default:
			m.Unit = "%"
			if m.Max <= m.Min {
				m.Min, m.Max = 0, 1
			}
		}
	}
	if m.Type == "" {
		if len(m.Options) > 0 {
			m.Type = "enum"
		} else {
			m.Type = "float"
		}
	}
	if m.Type == "enum" && len(m.Options) == 0 {
		m.ReadOnly = true // an enum without options cannot be stepped honestly
	}
	if a, ok := o["access"].(string); ok && a == "read" {
		m.ReadOnly = true
	}
	m.Bipolar = m.Type != "enum" && m.Min < 0 && m.Max > 0 && math.Abs(m.Min+m.Max) < 1e-9
	if (m.Type == "float" || m.Type == "int") && m.Max <= m.Min {
		m.ReadOnly = true // no usable range
	}
	return m
}

// buildMeta reads a component's metadata through get (a slot read).
func buildMeta(module string, get func(string) (string, bool)) *compMeta {
	cm := &compMeta{Module: module, Params: map[string]*paramMeta{}}
	if raw, ok := get("chain_params"); ok && raw != "" {
		var list []map[string]any
		if json.Unmarshal([]byte(raw), &list) == nil {
			for _, o := range list {
				m := metaFromObj(o)
				if m.Key == "" {
					continue
				}
				m.module = module
				cm.Params[m.Key] = m
				cm.Order = append(cm.Order, m.Key)
			}
		}
	}
	resolveLabels(cm, get)
	if raw, ok := get("ui_hierarchy"); ok && raw != "" {
		var hier struct {
			Levels    map[string]map[string]any `json:"levels"`
			Modes     []string                  `json:"modes"`
			ModeParam string                    `json:"mode_param"`
		}
		if json.Unmarshal([]byte(raw), &hier) == nil && hier.Levels != nil {
			cm.Levels, cm.Modes, cm.ModeParam = hier.Levels, hier.Modes, hier.ModeParam
			cm.planFromHierarchy(hier.Levels, hier.Modes)
		}
	}
	if len(cm.Banks) == 0 {
		cm.planFromOrder()
	} else {
		cm.planLeftovers()
	}
	return cm
}

// planLeftovers: every parameter has a page. A hierarchy's sections need
// not name them all (JE-8086's arpeggiator lives in its Performance mode,
// Mini-JV's tones in levels of their own); the rest follow its sections,
// grouped by name (names.go), as the web page's "More" does.
//
// A level's list parameter is not one of the rest: it is the list the Sounds
// browser walks (OsTIrus' and Nodal Red 2X's "preset"), and on a page of its
// own it was a knob that loaded a whole sound a detent.
func (cm *compMeta) planLeftovers() {
	seen := map[string]bool{}
	for _, b := range cm.Banks {
		for _, k := range b.Keys {
			seen[k] = true
		}
	}
	for _, lv := range cm.Levels {
		if k := str(lv["list_param"]); k != "" {
			seen[k] = true
		}
	}
	var rest []string
	for _, k := range cm.Order {
		if !seen[k] {
			rest = append(rest, k)
		}
	}
	if len(rest) == 0 {
		return
	}
	taken := map[string]bool{}
	for _, b := range cm.Banks {
		taken[b.Name] = true
	}
	more := 0
	for _, b := range planByNames(rest) {
		switch {
		case b.Name == "":
			more++
			b.Name = "MORE " + itoa(more)
		case taken[b.Name]: // a section's own page has this name: these are its others
			b.Name += " MORE"
		}
		cm.Banks = append(cm.Banks, b)
	}
}

// keysOf reads a level's knob list: "knobs", else the keys of "params".
func (cm *compMeta) keysOf(lvl map[string]any) []string {
	var keys []string
	collect := func(v any) {
		list, _ := v.([]any)
		for _, x := range list {
			switch t := x.(type) {
			case string:
				keys = append(keys, t)
			case map[string]any:
				if k := str(t["key"]); k != "" {
					keys = append(keys, k)
					if _, known := cm.Params[k]; !known {
						cm.Params[k] = metaFromObj(t)
						cm.Order = append(cm.Order, k)
					}
				}
			}
		}
	}
	if k, ok := lvl["knobs"]; ok && k != nil {
		collect(k)
		// a level that lists param objects also carries their metadata
		var files []string
		if p, ok := lvl["params"].([]any); ok {
			for _, x := range p {
				key, _ := x.(string)
				if t, ok := x.(map[string]any); ok && str(t["key"]) != "" {
					key = str(t["key"])
					if _, known := cm.Params[key]; !known {
						cm.Params[key] = metaFromObj(t)
					}
				}
				// the level's files. A module lists a sample among a level's
				// parameters and not among its knobs (it is not turned), so
				// it fell to a page of leftovers at the very end; it belongs
				// first on its own page, beside the start and end it is cut by
				if m := cm.Params[key]; key != "" && m != nil && m.Type == "file" {
					inKnobs := false
					for _, have := range keys {
						inKnobs = inKnobs || have == key
					}
					if !inKnobs {
						files = append(files, key)
					}
				}
			}
		}
		return append(files, keys...)
	}
	collect(lvl["params"])
	return keys
}

func (cm *compMeta) addBanks(name string, keys []string) {
	if len(keys) == 0 {
		return
	}
	for i := 0; i < len(keys); i += 8 {
		end := i + 8
		if end > len(keys) {
			end = len(keys)
		}
		n := name
		if i > 0 {
			n = fmt.Sprintf("%s %d", name, i/8+1)
		}
		cm.Banks = append(cm.Banks, bank{Name: n, Keys: keys[i:end]})
	}
}

func (cm *compMeta) planFromHierarchy(levels map[string]map[string]any, modes []string) {
	root := levels["root"]
	browser := root
	if root == nil {
		root, browser = editLevel(levels, modes)
	}
	if root == nil {
		return
	}
	cm.Presets.List = str(browser["list_param"])
	cm.Presets.Count = str(browser["count_param"])
	cm.Presets.Name = str(browser["name_param"])
	// root's own knobs first (the module's "main" page)
	if k, ok := root["knobs"]; ok && k != nil {
		cm.addBanks("MAIN", cm.keysOf(map[string]any{"knobs": k, "params": root["params"]}))
	}
	// then the levels root points to, in its order, under their labels
	params, _ := root["params"].([]any)
	var loose []string
	for _, x := range params {
		switch t := x.(type) {
		case map[string]any:
			if lv := str(t["level"]); lv != "" {
				if l := levels[lv]; l != nil {
					name := str(t["label"])
					if name == "" {
						name = lv
					}
					cm.addBanks(strings.ToUpper(name), cm.keysOf(l))
				}
			} else if k := str(t["key"]); k != "" {
				loose = append(loose, cm.keysOf(map[string]any{"params": []any{t}})...)
			}
		case string:
			loose = append(loose, t)
		}
	}
	if _, hasKnobs := root["knobs"]; !hasKnobs || root["knobs"] == nil {
		cm.addBanks("MAIN", loose)
	}
}

// planFromOrder: a module with no sections. One page is PARAMS; more are
// grouped by what the keys' names say (names.go).
// editLevel: for a hierarchy with modes and no root (JE-8086, Mini-JV:
// patch -> its banks -> its patches -> the patch's editor), the level where
// the first mode is edited, and the list just above it (its patches). The
// path follows "children" from the mode, the way Move's browser walks it.
func editLevel(levels map[string]map[string]any, modes []string) (edit, browser map[string]any) {
	if len(modes) == 0 {
		return nil, nil
	}
	lv := levels[modes[0]]
	for i := 0; lv != nil && i < 8; i++ {
		_, hasKnobs := lv["knobs"]
		params, _ := lv["params"].([]any)
		if (hasKnobs || len(params) > 0) && i > 0 {
			return lv, browser
		}
		if str(lv["list_param"]) != "" {
			browser = lv
		}
		lv = levels[str(lv["children"])]
	}
	return nil, nil
}

func (cm *compMeta) planFromOrder() {
	if len(cm.Order) <= 8 {
		cm.addBanks("PARAMS", cm.Order)
		return
	}
	more := 0
	for i, b := range planByNames(cm.Order) {
		if b.Name == "" {
			if i == 0 {
				b.Name = "MAIN"
			} else {
				more++
				b.Name = fmt.Sprintf("MORE %d", more)
			}
		}
		cm.Banks = append(cm.Banks, b)
	}
}

// ---- values ----------------------------------------------------------------

// enumIndex reads an enum value written either as an index or as the option.
func (m *paramMeta) enumIndex(v string) (int, bool) {
	// options that are numbers themselves (Surge's octaves, -3 .. 3): a
	// value equal to one of them is that option, not a position in the list
	// (Surge answers "0" for octave 0, which read as the first option, -3)
	if numericOptions(m.Options) {
		for i, o := range m.Options {
			if strings.TrimSpace(o) == strings.TrimSpace(v) {
				return i, true
			}
		}
	}
	if i, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && i >= 0 && i < len(m.Options) {
		return i, true
	}
	// a position written as a float ("7.0000": 9W9 answers its choices so)
	if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && f == math.Trunc(f) && f >= 0 && int(f) < len(m.Options) {
		return int(f), true
	}
	for i, o := range m.Options {
		if strings.EqualFold(o, v) {
			return i, true
		}
	}
	return 0, false
}

func numericOptions(opts []string) bool {
	if len(opts) == 0 {
		return false
	}
	for _, o := range opts {
		if _, err := strconv.ParseFloat(strings.TrimSpace(o), 64); err != nil {
			return false
		}
	}
	return true
}

// frac is the value's position in its range, for the dial.
func (m *paramMeta) frac(v string) float64 {
	if m.Type == "enum" {
		if i, ok := m.enumIndex(v); ok && len(m.Options) > 1 {
			return float64(i) / float64(len(m.Options)-1)
		}
		return 0
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || m.Max <= m.Min {
		return 0
	}
	return (f - m.Min) / (m.Max - m.Min)
}

// resolveLabels fills the value texts named by reference, from the
// module's "value_lists" (read only when a parameter names one).
func resolveLabels(cm *compMeta, get func(string) (string, bool)) {
	var lists map[string][]string
	for _, k := range cm.Order {
		m := cm.Params[k]
		if m == nil || m.labelsRef == "" || m.Labels != nil {
			continue
		}
		if lists == nil {
			lists = map[string][]string{}
			if raw, ok := get("value_lists"); ok && raw != "" {
				json.Unmarshal([]byte(raw), &lists) //nolint:errcheck
			}
		}
		m.Labels = lists[m.labelsRef]
	}
}

// label: the text a number has, if the module named one.
func (m *paramMeta) label(f float64) (string, bool) {
	if len(m.Labels) == 0 {
		return "", false
	}
	i := int(math.Round(f - m.Min))
	if i < 0 || i >= len(m.Labels) {
		return "", false
	}
	return m.Labels[i], true
}

// display renders a value with its unit, the way the module means it.
func (m *paramMeta) display(v string, ok bool) (val, unit string) {
	if !ok {
		return "--", ""
	}
	// the module's screen file says how this value reads (push.display):
	// Surge's attack in ms where the module answers a log2 of seconds
	if m.module != "" {
		if t, u, ok := overlayDisplay(m.module, m.Key, v); ok {
			return t, u
		}
	}
	if m.Type != "enum" && len(m.Labels) > 0 {
		if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			if t, ok := m.label(f); ok {
				return t, ""
			}
		}
	}
	switch m.Type {
	case "enum":
		if i, ok := m.enumIndex(v); ok {
			return m.Options[i], ""
		}
		return v, ""
	case "string":
		return v, ""
	case "file":
		if strings.TrimSpace(v) == "" {
			return "NONE", ""
		}
		return displayName(filepath.Base(v)), ""
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil {
		return v, m.Unit
	}
	unit = m.Unit
	if unit == "%" && m.Max <= 1.0001 && m.Min >= -1.0001 {
		f *= 100
	}
	switch {
	case m.Format != "" && strings.Contains(m.Format, "%"):
		val = fmt.Sprintf(m.Format, f)
	case m.Type == "int":
		val = strconv.Itoa(int(math.Round(f)))
	case unit == "%":
		val = fmt.Sprintf("%.0f", f)
	case math.Abs(f) >= 100:
		val = fmt.Sprintf("%.0f", f)
	case math.Abs(f) >= 10:
		val = fmt.Sprintf("%.1f", f)
	default:
		val = fmt.Sprintf("%.2f", f)
	}
	if m.Bipolar && f > 0 {
		val = "+" + val
	}
	if unit == "Hz" && f >= 1000 {
		return fmt.Sprintf("%.2f", f/1000), "kHz"
	}
	return val, unit
}

// step moves a value by delta encoder clicks. fine: Shift held.
// fineApplies: Shift makes a turn finer for this parameter (step, below).
func (m *paramMeta) fineApplies() bool {
	if m.Type == "enum" || m.Type == "string" || m.Type == "file" || m.ReadOnly {
		return false
	}
	if m.Type == "int" || (m.Step >= 1 && m.Step == math.Trunc(m.Step)) {
		return math.Round((m.Max-m.Min)/128) > 1
	}
	return true
}

func (m *paramMeta) step(v string, delta int, fine bool) (string, bool) {
	if m.ReadOnly || delta == 0 {
		return v, false
	}
	switch m.Type {
	case "enum":
		i, _ := m.enumIndex(v)
		n := i + sign(delta)
		if n < 0 || n >= len(m.Options) {
			return v, false
		}
		// write the same form the module answers with: an index or the word
		if _, err := strconv.Atoi(strings.TrimSpace(v)); err == nil || v == "" {
			return strconv.Itoa(n), true
		}
		return m.Options[n], true
	case "string", "file":
		return v, false // a file is chosen in the browser, never turned
	}
	f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
	rng := m.Max - m.Min
	var nv float64
	if m.Type == "int" || (m.Step >= 1 && m.Step == math.Trunc(m.Step)) {
		st := math.Max(1, m.Step)
		d := float64(delta)
		if !fine && rng > 64 {
			d *= math.Max(1, math.Round(rng/128)) // a wide int range moves faster
		}
		nv = math.Round(f) + d*st
	} else {
		per := rng / 128 // one detent = 1/128 of the range, about 1.5 turns end to end
		if fine {
			per /= 10
		}
		nv = f + float64(delta)*per
	}
	nv = math.Max(m.Min, math.Min(m.Max, nv))
	if nv == f {
		return v, false
	}
	if m.Type == "int" {
		return strconv.Itoa(int(math.Round(nv))), true
	}
	return strconv.FormatFloat(nv, 'f', 4, 64), true
}

func sign(n int) int {
	switch {
	case n > 0:
		return 1
	case n < 0:
		return -1
	}
	return 0
}
