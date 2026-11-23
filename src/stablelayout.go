package main

// stablelayout.go: a parameter stays where it was in its class.
//
// Live saves what is made against a plugin parameter (automation, clip
// envelopes, Macro and MIDI mappings) by the parameter's id, and a Pung
// parameter's id is its position in the class. A class built afresh put a
// module's new parameter among the others, and every instrument class
// carries the MIDI effects' parameters after its own (about 150), so a
// parameter or a MIDI effect added in a release moved the rest: a Set's
// automation then played the neighbouring parameter. Measured 2026-11-23: a
// parameter inserted before two automated ones, and the Set opened with the
// automation on the inserted one and the first of them.
//
// Giving parameters ids of their own (core: livedevice.Param.ID, branch
// wip/param-ids) does not help: Live 13.0b25 crashed (an assert in its float
// code) opening a Set whose automated device had a parameter moved to
// another position, whatever its id; the same Set with positions opened.
//
// So a class keeps the layout it was last written with (classes-known.json):
// each parameter at its position there, a parameter that is gone a
// placeholder, a new one after all of them. Push's pages follow the banks,
// which are remapped, not the list's order: nothing moves on the Push.
// A parameter is known by its identity: its key, and for a MIDI effect's
// parameter that effect's module (Param.Role "fx:<module>"); in a class
// written before those roles, by its key and how many before it have that
// key.

import (
	"log"
	"strconv"
	"strings"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

const fxRolePrefix = "fx:" // Param.Role of a MIDI effect's parameter: "fx:<module>"

// paramIdentity: what makes a parameter the same one across layouts ("" for
// a placeholder).
func paramIdentity(p livedevice.Param) string {
	if p.Key == "" {
		return ""
	}
	if strings.HasPrefix(p.Role, fxRolePrefix) {
		return p.Key + "@" + p.Role[len(fxRolePrefix):]
	}
	return p.Key
}

// keyOccurrences: for each parameter, its key and how many before it have
// that key ("midi_fx1:bpm#1").
func keyOccurrences(ps []livedevice.Param) []string {
	out := make([]string, len(ps))
	n := map[string]int{}
	for i, p := range ps {
		if p.Key == "" {
			continue
		}
		out[i] = p.Key + "#" + strconv.Itoa(n[p.Key])
		n[p.Key]++
	}
	return out
}

// hasFxRoles: a class written with the MIDI effects' roles.
func hasFxRoles(c *livedevice.Class) bool {
	for _, p := range c.Params {
		if strings.HasPrefix(p.Role, fxRolePrefix) {
			return true
		}
	}
	return false
}

// stableLayout: sc with every parameter at its position in prev (the class
// as last written; nil: a class new to Live, as built).
func stableLayout(sc *sclass, prev *livedevice.Class) *sclass {
	if prev == nil || len(prev.Params) == 0 {
		return sc
	}
	cur := sc.Class.Params
	legacy := !hasFxRoles(prev)
	byIdent, byOcc := map[string]int{}, map[string]int{}
	dup := map[string]bool{}
	for j, p := range prev.Params {
		if id := paramIdentity(p); id != "" {
			if _, seen := byIdent[id]; seen {
				dup[id] = true
			}
			byIdent[id] = j
		}
	}
	for id := range dup {
		delete(byIdent, id) // the same identity twice: by order below
	}
	for j, occ := range keyOccurrences(prev.Params) {
		if occ != "" {
			byOcc[occ] = j
		}
	}

	pos := make([]int, len(cur)) // each parameter's new position
	slot := make([]int, len(prev.Params))
	for j := range slot {
		slot[j] = -1
	}
	place := func(i, j int) { pos[i], slot[j] = j, i }
	occ := keyOccurrences(cur)
	var later []int // new parameters, and placeholders with no slot left
	for i, p := range cur {
		pos[i] = -1
		id := paramIdentity(p)
		if id == "" {
			continue
		}
		if j, ok := byIdent[id]; ok && slot[j] < 0 {
			place(i, j)
			continue
		}
		if j, ok := byOcc[occ[i]]; ok && slot[j] < 0 && (legacy || !strings.HasPrefix(p.Role, fxRolePrefix)) {
			place(i, j)
			continue
		}
		later = append(later, i)
	}
	// placeholders take the slots left (prev's placeholders, parameters gone)
	free := 0
	for i, p := range cur {
		if paramIdentity(p) != "" {
			continue
		}
		for free < len(slot) && slot[free] >= 0 {
			free++
		}
		if free < len(slot) {
			place(i, free)
		} else {
			later = append(later, i)
		}
	}
	n := len(prev.Params)
	for _, i := range later {
		pos[i] = n
		n++
	}
	if n > livedevice.MaxParams {
		log.Printf("devices: %s: keeping its parameters where they were takes %d entries, Live takes %d: laid out afresh (a Set's automation on it may move)",
			sc.Name, n, livedevice.MaxParams)
		return sc
	}

	c := *sc.Class
	c.Params = make([]livedevice.Param, n)
	out := &sclass{Class: &c, module: sc.module, midiFX: sc.midiFX, inCh: sc.inCh, keyIdx: map[string]int{},
		meta: make([]*paramMeta, n), role: make([]string, n), gateIdx: make([]int, n)}
	for j := range c.Params {
		c.Params[j] = livedevice.Param{Name: "", Type: livedevice.PadType} // a parameter gone, until filled
	}
	for i, p := range cur {
		j := pos[i]
		c.Params[j] = p
		if i < len(sc.meta) {
			out.meta[j] = sc.meta[i]
		}
		if i < len(sc.role) {
			out.role[j] = sc.role[i]
		}
		if i < len(sc.gateIdx) {
			out.gateIdx[j] = sc.gateIdx[i]
		}
	}
	for k, i := range sc.keyIdx {
		out.keyIdx[k] = pos[i]
	}
	c.Banks = make([][]int, len(sc.Class.Banks))
	for b, bank := range sc.Class.Banks {
		for _, i := range bank {
			if i >= 0 && i < len(pos) {
				c.Banks[b] = append(c.Banks[b], pos[i])
			}
		}
	}
	for _, i := range sc.order {
		if i >= 0 && i < len(pos) {
			out.order = append(out.order, pos[i])
		}
	}
	return out
}

// stableLayouts: every class with its parameters where the class as last
// written (known) had them.
func stableLayouts(classes []*sclass, known []*livedevice.Class) []*sclass {
	prev := map[string]*livedevice.Class{}
	for _, c := range known {
		if c != nil {
			prev[c.UID] = c
		}
	}
	out := make([]*sclass, len(classes))
	moved := 0
	for i, sc := range classes {
		out[i] = stableLayout(sc, prev[sc.UID])
		if out[i] != sc && !sameLayout(out[i].Class, sc.Class) {
			moved++
		}
	}
	if moved > 0 {
		log.Printf("devices: %d class(es) keep their parameters where they were (a new one goes after them)", moved)
	}
	return out
}
