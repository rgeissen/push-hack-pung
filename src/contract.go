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
// Those are the parameters' numbers. What a host shows of a device is another
// matter: Live takes the first 127 entries of the list the device's rack
// gives it, in that list's order, wherever they sit in the plugin's own
// (measured on a Push, 2026-11-27: a Dexed's 127 ended at "Op4 RS", number
// 93, with 33 fillers from numbers 147 on among them). So an instrument's
// list is its first twelve pages, then the selector and the slots, then its
// later pages: every instrument has the selector and at least thirty slots
// in Live, and one of eight pages or fewer has them all but the last.
//
// An audio effect and a MIDI generator as a device of its own: their own
// parameters at their registry numbers (the MIDI output channel Pung adds is
// in the registry, "@outch"), and the entries that fill their pages after.
//
// These devices have an identity of their own (contractNamespace): to a host
// they are other devices than the ones built before the contract, which stay
// as they are for the Sets saved with them.
//
// withContract (below) puts these devices beside the ones an installation
// has from before.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

const (
	contractNamespace = "pung-set-1" // hashed with a module into its device's identifier (never changes)
	contractSelector  = ownEntriesInstrument
	contractSlots     = livedevice.MaxParams - ownEntriesInstrument - 1 // 63
	selectorSteps     = contractSlots + 1                               // none, and one for each of 63 generators
	slotRole          = "fxslot"
	// contractOwnPagesFirst: an instrument's pages that stand before the MIDI
	// part in the list a host is given (96 entries, which leaves the selector
	// and thirty slots of Live's 127)
	contractOwnPagesFirst = 12
	liveListed            = 127 // what Live takes of a device's list, beside "Device On"
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

// appends: whether b is a grown at its ends (every entry of a where it was).
// A registry that is not is another contract: it is never taken.
func (a *registry) appends(b *registry) bool {
	if b == nil || a.Contract != b.Contract || len(b.MidiFX) < len(a.MidiFX) {
		return false
	}
	for i, id := range a.MidiFX {
		if b.MidiFX[i] != id {
			return false
		}
	}
	for mod, kinds := range a.Modules {
		for kind, keys := range kinds {
			now, ok := b.Modules[mod][kind]
			if !ok || len(now) < len(keys) {
				return false
			}
			for i, k := range keys {
				if now[i] != k {
					return false
				}
			}
		}
	}
	return true
}

// size: how much a registry holds (to tell the further grown of two)
func (r *registry) size() int {
	n := len(r.MidiFX)
	for _, kinds := range r.Modules {
		for _, keys := range kinds {
			n += 1 + len(keys)
		}
	}
	return n
}

// currentRegistry: the registry this Pung lays devices out by: the one it was
// built with, or one a pack on its disk carries that is the same grown at
// its ends (a module or a parameter published since: the pack that came with
// a later release, or pung.live's as last read and checked). Read from the
// disk only: a start never waits for the network.
func (h *Host) currentRegistry() (*registry, error) {
	reg, err := builtinRegistry()
	if err != nil {
		return nil, err
	}
	var packs [][]byte
	if u := bundledCatalog(); u != "" {
		if raw, err := os.ReadFile(strings.TrimPrefix(u, "file://")); err == nil {
			packs = append(packs, raw)
		}
	}
	if h.mods != nil {
		raw, e1 := os.ReadFile(h.mods.path("pack.json"))
		sig, e2 := os.ReadFile(h.mods.path("pack.json.sig"))
		if e1 == nil && e2 == nil && verifyPack(raw, sig) == nil {
			packs = append(packs, raw)
		}
	}
	for _, raw := range packs {
		var doc struct {
			Registry *registry `json:"registry"`
		}
		if json.Unmarshal(raw, &doc) != nil || doc.Registry == nil {
			continue
		}
		switch {
		case !reg.appends(doc.Registry):
			log.Printf("devices: a pack's registry is not this Pung's grown at its ends: not taken")
		case doc.Registry.size() > reg.size() && len(doc.Registry.MidiFX) <= contractSlots:
			reg = doc.Registry
		}
	}
	return reg, nil
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
	// here); an instrument's only (the same map as the class's)
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
	sc := &sclass{Class: c, module: module, keyIdx: map[string]int{}, contract: true}
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
		sc.slots = out.slots
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
		// the MIDI part's pages: the selector and seven slots, then eights.
		// They stand after the instrument's twelfth page (after its last, if
		// it has fewer): what a host lists of a device is the beginning of
		// this order, not of the numbers
		midi := [][]int{{selPos, first, first + 1, first + 2, first + 3, first + 4, first + 5, first + 6}}
		for k := 7; k < contractSlots; k += 8 {
			var row []int
			for j := k; j < k+8 && j < contractSlots; j++ {
				row = append(row, first+j)
			}
			midi = append(midi, row)
		}
		head := min(contractOwnPagesFirst, len(pages))
		c.Banks = append(append(append([][]int{}, pages[:head]...), midi...), pages[head:]...)
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

// legacySuffix: how a device from before the contract is named, on the
// installations that keep it
const legacySuffix = " (old)"

// withContract: the devices this installation serves. For every module the
// registry knows, its contract device. The device from before the contract
// (built) stays beside it only where this installation had it already
// (known: the classes as last written), for the Sets saved with it: under
// another name, and offered nowhere. A module the registry does not know (one
// installed by hand, a maker's build) keeps the device it has, in its local
// order: its Sets do not travel yet.
func (h *Host) withContract(built []*sclass, known []*livedevice.Class) []*sclass {
	reg, err := h.currentRegistry()
	if err != nil {
		log.Printf("devices: the registry: %v (devices as before the contract)", err)
		return built
	}
	had := map[string]bool{}
	for _, c := range known {
		if c != nil {
			had[c.UID] = true
		}
	}
	meta := func(id string) (*compMeta, ModuleInfo, bool) {
		m, ok := findModule(h.modulesDir, id)
		if !ok {
			return nil, m, false
		}
		cm, ok := h.probeMeta(m)
		return cm, m, ok && cm != nil
	}
	// the MIDI generators installed here, for the instruments' general slots
	fx, names := map[string]*compMeta{}, map[string]string{}
	for _, sc := range built {
		if sc.Kind == livedevice.MIDI {
			if cm, m, ok := meta(sc.module); ok {
				fx[sc.module], names[sc.module] = cm, m.Name // (the whole name, as the selector had it before)
			}
		}
	}
	var out []*sclass
	made, kept, local := 0, 0, 0
	for _, sc := range built {
		cm, _, ok := meta(sc.module)
		var cl *contractLayout
		if ok {
			var gens map[string]*compMeta
			if sc.Kind == livedevice.Instrument {
				gens = fx
			}
			cl, ok = contractClass(reg, sc.Name, sc.Kind, sc.Category, sc.module, sc.Folder, cm, gens, names)
		}
		if !ok {
			out = append(out, sc)
			local++
			continue
		}
		cl.inCh = sc.inCh
		out = append(out, cl.sclass)
		made++
		if had[sc.UID] {
			sc.legacy = true
			sc.Class.Name += legacySuffix
			deviceNames[sc.Class.Name] = sc.module // (and its name as it was stays known: buildClasses)
			out = append(out, sc)
			kept++
		}
	}
	log.Printf("devices: %d by the Set contract, %d from before it kept for their Sets, %d in a local order (not in the registry)", made, kept, local)
	return out
}

// offered: the devices that have an entry in the host's browser (all but the
// ones kept from before the contract)
func offered(classes []*sclass) []*sclass {
	var out []*sclass
	for _, sc := range classes {
		if !sc.legacy {
			out = append(out, sc)
		}
	}
	return out
}

// contractOn: whether this Pung builds the contract's devices. Until Live's
// handling of them is measured (docs/SET-CONTRACT.md) only where it is asked
// for: PUNG_SET_CONTRACT=1 in Pung's environment, or a file "set-contract" in
// its data folder.
func contractOn(dataDir string) bool {
	if os.Getenv("PUNG_SET_CONTRACT") == "1" {
		return true
	}
	return dataDir != "" && exists(filepath.Join(dataDir, "set-contract"))
}
