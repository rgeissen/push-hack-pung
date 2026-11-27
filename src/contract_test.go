package main

import (
	"fmt"
	"math/rand"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

func pagesMeta(module string, pages ...[]string) *compMeta {
	cm := &compMeta{Module: module, Params: map[string]*paramMeta{}}
	for _, p := range pages {
		cm.Banks = append(cm.Banks, bank{Keys: p})
		for _, k := range p {
			if cm.Params[k] == nil {
				cm.Params[k] = &paramMeta{Key: k, Name: k, Type: "float", Max: 1}
				cm.Order = append(cm.Order, k)
			}
		}
	}
	return cm
}

func positions(c *livedevice.Class) map[string]int {
	out := map[string]int{}
	for i, p := range c.Params {
		if p.Key != "" {
			out[p.Key] = i
		}
	}
	return out
}

// The registry Pung is built with reads, is of contract 1, and names every
// MIDI generator once.
func TestBuiltinRegistry(t *testing.T) {
	reg, err := builtinRegistry()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, id := range reg.MidiFX {
		if seen[id] {
			t.Errorf("%s twice in the selector's order", id)
		}
		seen[id] = true
		if reg.Modules[id][livedevice.MIDI] == nil {
			t.Errorf("%s is in the selector and has no parameters as a MIDI generator", id)
		}
	}
	for mod, kinds := range reg.Modules {
		for kind, keys := range kinds {
			once := map[string]bool{}
			for _, k := range keys {
				if once[k] {
					t.Errorf("%s as %s names %q twice", mod, kind, k)
				}
				once[k] = true
			}
			if kind == livedevice.Instrument && len(keys) > ownEntriesInstrument {
				t.Errorf("%s: %d parameters of its own, an instrument has room for %d", mod, len(keys), ownEntriesInstrument)
			}
		}
	}
}

// A device laid out by the contract has every parameter where the registry
// says, whatever MIDI generators are installed, in whatever order the module
// lists its parameters, and whatever else the module has: the reason for the
// whole thing.
func TestContractLayoutIsTheSameEverywhere(t *testing.T) {
	reg := &registry{Contract: 1, MidiFX: []string{"arp", "chords", "euclid"}, Modules: map[string]map[string][]string{
		"synth":  {livedevice.Instrument: {"cutoff", "reso", "gone", "attack", "decay", "mode"}},
		"arp":    {livedevice.MIDI: {"rate", "gate", "octaves", outChIdentity}},
		"chords": {livedevice.MIDI: {"type", "spread", outChIdentity}},
		"euclid": {livedevice.MIDI: {"steps", "hits", outChIdentity}},
	}}
	synth := func(r *rand.Rand) *compMeta {
		// the module as one installation sees it: its pages, a parameter newer than the registry, its own listing order
		cm := pagesMeta("synth", []string{"cutoff", "reso", "mode"}, []string{"attack", "decay", "newer"})
		r.Shuffle(len(cm.Order), func(i, j int) { cm.Order[i], cm.Order[j] = cm.Order[j], cm.Order[i] })
		return cm
	}
	arp := pagesMeta("arp", []string{"rate", "gate", "octaves"})
	chords := pagesMeta("chords", []string{"type", "spread"})
	names := map[string]string{"arp": "Arp", "chords": "Chords", "euclid": "Euclid"}
	installs := []map[string]*compMeta{
		{},
		{"arp": arp},
		{"chords": chords, "arp": arp},
		{"chords": chords},
	}
	var first map[string]int
	var firstUID string
	for n, fx := range installs {
		got, ok := contractClass(reg, "Synth", livedevice.Instrument, "Instrument|Synth", "synth", "Pung", synth(rand.New(rand.NewSource(int64(n)))), fx, names)
		if !ok {
			t.Fatal("the registry knows the module")
		}
		c := got.Class
		if len(c.Params) != livedevice.MaxParams {
			t.Fatalf("an instrument's list is %d long, not %d", livedevice.MaxParams, len(c.Params))
		}
		pos := positions(c)
		for i, k := range []string{"cutoff", "reso", "", "attack", "decay", "mode"} {
			if k == "" {
				if c.Params[i].Type != livedevice.PadType {
					t.Errorf("install %d: the registry's parameter the module no longer has leaves its place empty, got %+v", n, c.Params[i])
				}
				continue
			}
			if pos["synth:"+k] != i {
				t.Errorf("install %d: %s at %d, the registry says %d", n, k, pos["synth:"+k], i)
			}
		}
		if _, there := pos["synth:newer"]; there {
			t.Errorf("install %d: a parameter the registry does not name is Live's", n)
		}
		if fmt.Sprint(got.left) != "[newer]" {
			t.Errorf("install %d: what is left for Pung's view: %v", n, got.left)
		}
		sel := c.Params[contractSelector]
		if sel.Role != "midifx" || len(sel.Options) != selectorSteps || sel.Max != selectorSteps-1 {
			t.Fatalf("install %d: the selector at %d with %d steps: %+v", n, contractSelector, selectorSteps, sel)
		}
		// a generator keeps its step, installed or not; one that is not installed has no name
		if got.midiFX[1] != "arp" || got.midiFX[2] != "chords" || got.midiFX[3] != "euclid" || got.midiFX[4] != "" {
			t.Errorf("install %d: the selector's steps: %v", n, got.midiFX[:5])
		}
		for id, step := range map[string]int{"arp": 1, "chords": 2} {
			if want := map[bool]string{true: names[id], false: "—"}[fx[id] != nil]; sel.Options[step] != want {
				t.Errorf("install %d: step %d reads %q, want %q", n, step, sel.Options[step], want)
			}
		}
		for k := 0; k < contractSlots; k++ {
			if p := c.Params[contractSelector+1+k]; p.Role != slotRole || p.Name != fmt.Sprintf("MIDI FX %d", k+1) {
				t.Fatalf("install %d: slot %d: %+v", n, k+1, p)
			}
		}
		if fx["arp"] != nil {
			s := got.slots["arp"]
			if s[0].key != "midi_fx1:rate" || s[1].key != "midi_fx1:gate" || s[2].key != "midi_fx1:octaves" || s[3] != nil {
				t.Errorf("install %d: the arpeggiator's slots: %v %v %v %v", n, s[0], s[1], s[2], s[3])
			}
		}
		// pages: whole eights, and no position twice
		used := map[int]bool{}
		for bi, b := range c.Banks {
			if len(b) != 8 {
				t.Errorf("install %d: page %d has %d entries", n, bi, len(b))
			}
			for _, i := range b {
				if used[i] || i < 0 || i >= len(c.Params) {
					t.Errorf("install %d: page %d names %d twice or outside the list", n, bi, i)
				}
				used[i] = true
			}
		}
		if first == nil {
			first, firstUID = pos, c.UID
			continue
		}
		if c.UID != firstUID {
			t.Errorf("install %d: another identity (%s, was %s)", n, c.UID, firstUID)
		}
		for k, i := range first {
			if pos[k] != i {
				t.Errorf("install %d: %s moved from %d to %d", n, k, i, pos[k])
			}
		}
	}
	if firstUID == livedevice.ClassUID(uidNamespace, livedevice.Instrument, "synth") {
		t.Error("a contract device has the identity of the device from before the contract")
	}
	// a module the registry does not know has no contract device
	if _, ok := contractClass(reg, "X", livedevice.Instrument, "", "byhand", "Pung", pagesMeta("byhand", []string{"a"}), nil, nil); ok {
		t.Error("a device for a module the registry does not name")
	}
	// a MIDI generator as a device of its own: its parameters, and the output channel where the registry has it
	got, ok := contractClass(reg, "Arp Track", livedevice.MIDI, "Instrument", "arp", "Pung MIDI Effects", arp, nil, nil)
	if !ok || got.Params[3].Role != "outch" || positions(got.Class)["midi_fx1:gate"] != 1 {
		t.Errorf("the arpeggiator as a device: %v %+v", ok, got)
	}
}

// Every module of the registry Pung ships fits its kind of device.
func TestRegistryFitsItsDevices(t *testing.T) {
	reg, err := builtinRegistry()
	if err != nil {
		t.Fatal(err)
	}
	for mod, kinds := range reg.Modules {
		for kind, keys := range kinds {
			cm := pagesMeta(mod, keys) // (one long page: only the count matters here)
			got, ok := contractClass(reg, mod, kind, "", mod, "Pung", cm, nil, nil)
			if !ok {
				t.Errorf("%s as %s: no device", mod, kind)
				continue
			}
			if len(got.Params) > livedevice.MaxParams {
				t.Errorf("%s as %s: %d entries", mod, kind, len(got.Params))
			}
			if err := got.Class.Check(); err != nil {
				t.Errorf("%s as %s: the plugin would refuse it: %v", mod, kind, err)
			}
		}
	}
}

// A general slot is the parameter of that number of the MIDI generator that
// is selected: none while none is, none for a step whose generator is not
// installed here, and never for a device from before the contract.
func TestSlotFollowsTheSelectedGenerator(t *testing.T) {
	reg := &registry{Contract: 1, MidiFX: []string{"arp", "chords"}, Modules: map[string]map[string][]string{
		"synth":  {livedevice.Instrument: {"cutoff"}},
		"arp":    {livedevice.MIDI: {"rate", "gate", outChIdentity}},
		"chords": {livedevice.MIDI: {"type", outChIdentity}},
	}}
	fx := map[string]*compMeta{"arp": pagesMeta("arp", []string{"rate", "gate"})} // chords is not installed here
	cl, ok := contractClass(reg, "Synth", livedevice.Instrument, "", "synth", "Pung", pagesMeta("synth", []string{"cutoff"}), fx, map[string]string{"arp": "Arp"})
	if !ok {
		t.Fatal("no device")
	}
	d := &device{c: cl.sclass}
	first := contractSelector + 1
	if d.slotTarget(first) != nil {
		t.Error("no generator is selected, yet slot 1 is something")
	}
	d.midiFX = 1 // the arpeggiator
	if s := d.slotTarget(first); s == nil || s.key != "midi_fx1:rate" {
		t.Errorf("slot 1 with the arpeggiator: %+v", s)
	}
	if s := d.slotTarget(first + 1); s == nil || s.key != "midi_fx1:gate" {
		t.Errorf("slot 2 with the arpeggiator: %+v", s)
	}
	if d.slotTarget(first+2) != nil || d.slotTarget(first+contractSlots) != nil || d.slotTarget(0) != nil {
		t.Error("a slot beyond the generator's parameters, or a position that is no slot, is something")
	}
	d.midiFX = 2 // chords: a step of the registry, not installed here
	if d.slotTarget(first) != nil {
		t.Error("a generator that is not installed here has slots")
	}
	old := &device{c: testSClass("0123456789abcdef0123456789abcdef", "synth:cutoff"), midiFX: 1}
	if old.slotTarget(first) != nil {
		t.Error("a device from before the contract has general slots")
	}
	// the devices that have browser entries: not the ones kept from before
	kept := testSClass("fedcba9876543210fedcba9876543210", "synth:cutoff")
	kept.legacy = true
	if got := offered([]*sclass{cl.sclass, kept}); len(got) != 1 || got[0] != cl.sclass {
		t.Errorf("offered: %d devices", len(got))
	}
}

// A pack's registry is taken when it is this Pung's own grown at its ends (a
// module or a parameter published since), and never when anything in it
// moved: that would be another contract.
func TestRegistryFromAPack(t *testing.T) {
	base := &registry{Contract: 1, MidiFX: []string{"arp"}, Modules: map[string]map[string][]string{
		"synth": {livedevice.Instrument: {"cutoff", "reso"}}, "arp": {livedevice.MIDI: {"rate", outChIdentity}}}}
	grown := &registry{Contract: 1, MidiFX: []string{"arp", "chords"}, Modules: map[string]map[string][]string{
		"synth":  {livedevice.Instrument: {"cutoff", "reso", "drive"}},
		"arp":    {livedevice.MIDI: {"rate", outChIdentity}},
		"chords": {livedevice.MIDI: {"type", outChIdentity}}}}
	if !base.appends(grown) || grown.size() <= base.size() {
		t.Error("a registry with a new module and a new parameter at the end is this one grown")
	}
	if !base.appends(base) {
		t.Error("a registry is itself grown by nothing")
	}
	for what, bad := range map[string]*registry{
		"a parameter moved": {Contract: 1, MidiFX: []string{"arp"}, Modules: map[string]map[string][]string{
			"synth": {livedevice.Instrument: {"reso", "cutoff"}}, "arp": {livedevice.MIDI: {"rate", outChIdentity}}}},
		"a module gone": {Contract: 1, MidiFX: []string{"arp"}, Modules: map[string]map[string][]string{
			"arp": {livedevice.MIDI: {"rate", outChIdentity}}}},
		"the selector's order changed": {Contract: 1, MidiFX: []string{"chords", "arp"}, Modules: grown.Modules},
		"another contract":             {Contract: 2, MidiFX: base.MidiFX, Modules: base.Modules},
	} {
		if base.appends(bad) {
			t.Errorf("%s, and it counts as grown", what)
		}
	}
	if grown.appends(base) {
		t.Error("the smaller registry counts as the larger one grown")
	}
}
