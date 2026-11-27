package main

// contract.go: a device laid out by the Set contract (docs/SET-CONTRACT.md):
// every parameter of a module at one number for good, the same on every Pung
// and in every host. The number is the parameter's place in the registry
// (registry.json, scripts/registry.py), not the place this installation
// happened to give it (stablelayout.go), and not a place that depends on
// which MIDI generators are installed.
//
// An instrument's list is 256 long:
//
//	0 .. 191   its own parameters at their registry numbers, then the empty
//	           entries its pages are filled up with (24 pages)
//	192        the MIDI FX selector: none, then the registry's MIDI
//	           generators, each at its step for good, installed or not
//	193 .. 255 63 general slots: slot k is parameter k of the MIDI generator
//	           that is selected, in that generator's own registry order
//
// An audio effect and a MIDI generator as a device of its own: their own
// parameters at their registry numbers (the MIDI output channel Pung adds is
// in the registry, "@outch"), and the entries that fill their pages after.
//
// These devices have an identity of their own (contractNamespace): to a host
// they are other devices than the ones built before the contract, which stay
// as they are for the Sets saved with them.
//
// This file only lays a device out. Nothing builds devices this way yet.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

const (
	contractNamespace = "pung-set-1" // hashed with a module into its device's identifier (never changes)
	contractSelector  = ownEntriesInstrument
	contractSlots     = livedevice.MaxParams - ownEntriesInstrument - 1 // 63
	selectorSteps     = contractSlots + 1                               // none, and one for each of 63 generators
	slotRole          = "fxslot"
)

// registry: registry.json
type registry struct {
	Contract int                            `json:"contract"`
	MidiFX   []string                       `json:"midi_fx"` // the selector's steps after "none"
	Modules  map[string]map[string][]string `json:"modules"` // module -> kind -> its parameters' keys, in order
}

//go:embed registry.json
var registryRaw []byte

// builtinRegistry: the registry this Pung was built with
func builtinRegistry() (*registry, error) {
	var r registry
	if err := json.Unmarshal(registryRaw, &r); err != nil {
		return nil, err
	}
	if r.Contract != 1 {
		return nil, fmt.Errorf("the registry is of contract %d: this Pung lays out contract 1", r.Contract)
	}
	if len(r.MidiFX) > contractSlots {
		return nil, fmt.Errorf("the registry names %d MIDI generators: the selector has %d steps for them", len(r.MidiFX), contractSlots)
	}
	return &r, nil
}

// slotTarget: what a general slot is while a MIDI generator is selected
type slotTarget struct {
	key  string // the chain key ("midi_fx1:rate")
	meta *paramMeta
}

// contractLayout: a device as the contract lays it out
type contractLayout struct {
	*sclass
	// slots: for each MIDI generator that is installed here, what each
	// general slot is (nil: the generator has no parameter of that number
	// here); an instrument's only
	slots map[string][]*slotTarget
	// left: the module's parameters that are not Live's (the registry does
	// not name them: they did not fit, or they are newer than the registry)
	left []string
}

var padParam = livedevice.Param{Name: "", Type: livedevice.PadType}

// contractClass lays out module as a kind of device by the registry. cm is
// the module's own metadata; fx the metadata of the MIDI generators installed
// here (an instrument's only), names their display names. False: the registry
// does not know the module as that kind (a module installed by hand, a
// maker's build): it has no contract device.
func contractClass(reg *registry, name, kind, category, module, folder string, cm *compMeta,
	fx map[string]*compMeta, names map[string]string) (*contractLayout, bool) {
	keys, ok := reg.Modules[module][kind]
	if !ok {
		return nil, false
	}
	prefix, room := "synth", ownEntriesInstrument
	switch kind {
	case livedevice.Effect:
		prefix, room = "fx1", livedevice.MaxParams
	case livedevice.MIDI:
		prefix, room = "midi_fx1", livedevice.MaxParams
	}
	if len(keys) > room {
		keys = keys[:room] // (the tool never writes more; a registry that did is cut, not trusted)
	}
	ps := toVstParams(cm, prefix)
	byKey := map[string]int{}
	for i, p := range ps {
		_, k, _ := strings.Cut(p.Key, ":")
		byKey[k] = i
	}
	c := &livedevice.Class{UID: livedevice.ClassUID(contractNamespace, kind, module), Name: name, Kind: kind,
		Category: category, Ref: module, Folder: folder}
	sc := &sclass{Class: c, module: module, keyIdx: map[string]int{}}
	out := &contractLayout{sclass: sc}
	add := func(p livedevice.Param, m *paramMeta, role string) int {
		c.Params = append(c.Params, p)
		sc.meta, sc.role, sc.gateIdx = append(sc.meta, m), append(sc.role, role), append(sc.gateIdx, 0)
		return len(c.Params) - 1
	}
	// its own parameters at their registry numbers
	at := map[int]int{} // index in ps -> position
	for _, k := range keys {
		switch i, has := byKey[k]; {
		case k == outChIdentity && kind == livedevice.MIDI:
			ch := livedevice.Param{Name: "MIDI Out Ch", Key: "outch", Type: "enum", Role: "outch", Max: 15}
			for n := 1; n <= 16; n++ {
				ch.Options = append(ch.Options, fmt.Sprintf("Ch. %d", n))
			}
			add(ch, nil, "outch")
		case has:
			at[i] = add(ps[i].Param, ps[i].meta, "")
		default:
			add(padParam, nil, "") // the registry's parameter this version of the module does not have
		}
	}
	for i, p := range ps {
		if _, placed := at[i]; !placed {
			_, k, _ := strings.Cut(p.Key, ":")
			out.left = append(out.left, k)
		}
	}
	// its pages, each parameter in its first; filled to eights with empty
	// entries from behind the registry's, while the kind has room for them
	seen := map[int]bool{}
	var pages [][]int
	for _, b := range banksFor(ps, cm, prefix) {
		var row []int
		for _, i := range b {
			if pos, placed := at[i]; placed && !seen[pos] {
				seen[pos] = true
				row = append(row, pos)
			}
		}
		if len(row) > 0 {
			pages = append(pages, row)
		}
	}
	var rest []int
	for pos, p := range c.Params {
		if !seen[pos] && p.Type != livedevice.PadType {
			rest = append(rest, pos)
		}
	}
	for i := 0; i < len(rest); i += 8 {
		pages = append(pages, rest[i:min(i+8, len(rest))])
	}
	for pi := range pages {
		last := pi == len(pages)-1 && kind != livedevice.Instrument // (the last page of all is not filled: PadBanks)
		for len(pages[pi])%8 != 0 && !last && len(c.Params) < room {
			pages[pi] = append(pages[pi], add(padParam, nil, ""))
		}
	}
	c.Banks = pages
	if kind == livedevice.Instrument {
		for len(c.Params) < contractSelector {
			add(padParam, nil, "")
		}
		// the selector: a step for each of the registry's generators, for good
		sel := livedevice.Param{Name: "MIDI FX", Key: "midi_fx1:module", Type: "enum", Role: "midifx",
			Options: []string{"None"}, Max: selectorSteps - 1}
		sc.midiFX = []string{""}
		for i := 0; i < contractSlots; i++ {
			id, label := "", "—"
			if i < len(reg.MidiFX) {
				id = reg.MidiFX[i]
				if n := names[id]; n != "" && fx[id] != nil {
					label = n
				}
			}
			sel.Options = append(sel.Options, label)
			sc.midiFX = append(sc.midiFX, id)
		}
		selPos := add(sel, nil, "midifx")
		// the general slots, and what each is for every generator installed here
		first := len(c.Params)
		for k := 0; k < contractSlots; k++ {
			add(livedevice.Param{Name: fmt.Sprintf("MIDI FX %d", k+1), Key: fmt.Sprintf("midi_fx1:#%d", k+1),
				Type: "float", Max: 1, Role: slotRole}, nil, slotRole)
		}
		out.slots = map[string][]*slotTarget{}
		for id, fm := range fx {
			var own []string
			for _, k := range reg.Modules[id][livedevice.MIDI] {
				if k != outChIdentity {
					own = append(own, k)
				}
			}
			if fm == nil || own == nil {
				continue // (a generator the registry does not know has no slots)
			}
			fps := map[string]vstParam{}
			for _, p := range toVstParams(fm, "midi_fx1") {
				_, k, _ := strings.Cut(p.Key, ":")
				fps[k] = p
			}
			targets := make([]*slotTarget, contractSlots)
			for k := 0; k < contractSlots && k < len(own); k++ {
				if p, has := fps[own[k]]; has {
					targets[k] = &slotTarget{key: p.Key, meta: p.meta}
				}
			}
			out.slots[id] = targets
		}
		// the MIDI part's pages: the selector and seven slots, then eights
		c.Banks = append(c.Banks, []int{selPos, first, first + 1, first + 2, first + 3, first + 4, first + 5, first + 6})
		for k := 7; k < contractSlots; k += 8 {
			var row []int
			for j := k; j < k+8 && j < contractSlots; j++ {
				row = append(row, first+j)
			}
			c.Banks = append(c.Banks, row)
		}
	}
	for i, p := range c.Params {
		if p.Key != "" {
			sc.keyIdx[p.Key] = i
		}
	}
	seenOrd := map[int]bool{}
	for _, bank := range c.Banks { // as livedevice.WritePresets lists them (finish)
		for _, i := range bank {
			if !seenOrd[i] && len(sc.order) < 128 {
				seenOrd[i] = true
				sc.order = append(sc.order, i)
			}
		}
	}
	return out, true
}
