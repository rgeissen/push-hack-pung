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
	"strconv"
	"strings"
)

type paramMeta struct {
	Key      string
	Name     string
	Type     string // float | int | enum | bool | string
	Min, Max float64
	Step     float64
	Unit     string
	Format   string
	Options  []string
	Default  *float64
	ReadOnly bool
	Bipolar  bool
}

type bank struct {
	Name string
	Keys []string // up to 8; "" is an empty column
}

type compMeta struct {
	Module  string
	Params  map[string]*paramMeta
	Order   []string
	Banks   []bank
	Presets struct{ List, Count, Name string } // ui_hierarchy root's preset browser
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
	m := &paramMeta{Key: str(o["key"]), Name: str(o["name"]), Type: str(o["type"]), Unit: str(o["unit"]),
		Format: str(o["display_format"])}
	if m.Name == "" {
		m.Name = str(o["label"])
	}
	if m.Name == "" {
		m.Name = m.Key
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
				cm.Params[m.Key] = m
				cm.Order = append(cm.Order, m.Key)
			}
		}
	}
	if raw, ok := get("ui_hierarchy"); ok && raw != "" {
		var hier struct {
			Levels map[string]map[string]any `json:"levels"`
		}
		if json.Unmarshal([]byte(raw), &hier) == nil && hier.Levels != nil {
			cm.planFromHierarchy(hier.Levels)
		}
	}
	if len(cm.Banks) == 0 {
		cm.planFromOrder()
	}
	return cm
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
		if p, ok := lvl["params"].([]any); ok {
			for _, x := range p {
				if t, ok := x.(map[string]any); ok && str(t["key"]) != "" {
					if _, known := cm.Params[str(t["key"])]; !known {
						cm.Params[str(t["key"])] = metaFromObj(t)
					}
				}
			}
		}
		return keys
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

func (cm *compMeta) planFromHierarchy(levels map[string]map[string]any) {
	root := levels["root"]
	if root == nil {
		return
	}
	cm.Presets.List = str(root["list_param"])
	cm.Presets.Count = str(root["count_param"])
	cm.Presets.Name = str(root["name_param"])
	// root's own knobs first (the module's "main" page)
	if k, ok := root["knobs"]; ok && k != nil {
		cm.addBanks("MAIN", cm.keysOf(map[string]any{"knobs": k}))
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

func (cm *compMeta) planFromOrder() {
	cm.addBanks("PARAMS", cm.Order)
	if len(cm.Banks) > 1 {
		for i := range cm.Banks {
			cm.Banks[i].Name = fmt.Sprintf("PAGE %d", i+1)
		}
	}
}

// ---- values ----------------------------------------------------------------

// enumIndex reads an enum value written either as an index or as the option.
func (m *paramMeta) enumIndex(v string) (int, bool) {
	if i, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && i >= 0 && i < len(m.Options) {
		return i, true
	}
	for i, o := range m.Options {
		if strings.EqualFold(o, v) {
			return i, true
		}
	}
	return 0, false
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

// display renders a value with its unit, the way the module means it.
func (m *paramMeta) display(v string, ok bool) (val, unit string) {
	if !ok {
		return "--", ""
	}
	switch m.Type {
	case "enum":
		if i, ok := m.enumIndex(v); ok {
			return m.Options[i], ""
		}
		return v, ""
	case "string":
		return v, ""
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
	case "string":
		return v, false
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
