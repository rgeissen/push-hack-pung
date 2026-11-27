package main

// layouts.go: GET /api/layouts, each module's own parameters in the order of
// its pages, as many as the contract gives its kind of device room for. It
// depends on the module alone: not on which MIDI generators are installed
// (a large instrument's own pages are cut to make room for theirs today),
// nor on the order this installation has grown (stablelayout.go). It is what
// the registry of the Set contract is seeded from (docs/SET-CONTRACT.md):
// one fixed number for each parameter of a module, the same on every Pung,
// in every host.
//
// A module says what parameters it has only when it runs, and an emulator
// only with its firmware: so the list comes from a deployment, not from the
// build. It holds names of controls and nothing of any firmware.

import (
	"net/http"
	"sort"
	"strings"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// What a kind of device has of Live's list for the module's own pages
// (docs/SET-CONTRACT.md): an instrument 24 pages, with the selector and the
// general MIDI-effect slots behind them; an effect and a MIDI generator as a
// device of its own the whole list, less a page for what Pung adds.
const (
	ownEntriesInstrument = 192
	ownEntriesOther      = livedevice.MaxParams - 8
	outChIdentity        = "@outch" // the MIDI output channel Pung adds to a MIDI generator's device
)

// freshLayout: one module as a kind of device, laid out by the contract's rule
type freshLayout struct {
	Module  string `json:"module"`
	Kind    string `json:"kind"` // instrument | effect | midi
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
	// Keys: its own parameters by key, without the chain's prefix ("cutoff",
	// not "synth:cutoff"), in the order of its pages (a parameter in its
	// first page; then those in no page), as many whole pages as the kind
	// has room for. For a MIDI generator's device, "@outch" last.
	Keys []string `json:"keys"`
	// Entries: what those pages take of Live's list, filled to eights
	Entries int `json:"entries"`
	// Left: its parameters that did not fit (reached in Pung's view only)
	Left int `json:"left,omitempty"`
}

// ownLayout: a module's own parameters in the order of its pages, whole
// pages while they fit into budget entries. It depends on the module alone:
// not on what else is installed, nor on what this installation had before.
func ownLayout(cm *compMeta, prefix string, budget int) (keys []string, entries, left int) {
	ps := toVstParams(cm, prefix)
	seen := map[int]bool{}
	var pages [][]int
	for _, b := range banksFor(ps, cm, prefix) {
		var row []int
		for _, i := range b {
			if !seen[i] {
				seen[i] = true
				row = append(row, i)
			}
		}
		if len(row) > 0 {
			pages = append(pages, row)
		}
	}
	var rest []int
	for i := range ps {
		if !seen[i] {
			rest = append(rest, i)
		}
	}
	for i := 0; i < len(rest); i += 8 {
		pages = append(pages, rest[i:min(i+8, len(rest))])
	}
	keys = []string{}
	for _, row := range pages {
		need := (len(row) + 7) / 8 * 8
		if entries+need > budget {
			left += len(row)
			continue // (a later, smaller page does not jump the queue: nothing after the first that does not fit)
		}
		if left > 0 {
			left += len(row)
			continue
		}
		entries += need
		for _, i := range row {
			_, k, _ := strings.Cut(ps[i].Key, ":")
			keys = append(keys, k)
		}
	}
	return keys, entries, left
}

// layoutOf: the layout of one of this installation's devices
func (h *Host) layoutOf(sc *sclass) (freshLayout, bool) {
	out := freshLayout{Module: sc.module, Kind: sc.Kind, Name: sc.Name}
	m, ok := findModule(h.modulesDir, sc.module)
	if !ok {
		return out, false
	}
	out.Version = m.Version
	cm, ok := h.probeMeta(m)
	if !ok || cm == nil {
		return out, false
	}
	switch sc.Kind {
	case livedevice.Instrument:
		out.Keys, out.Entries, out.Left = ownLayout(cm, "synth", ownEntriesInstrument)
	case livedevice.Effect:
		out.Keys, out.Entries, out.Left = ownLayout(cm, "fx1", ownEntriesOther)
	case livedevice.MIDI:
		out.Keys, out.Entries, out.Left = ownLayout(cm, "midi_fx1", ownEntriesOther)
		out.Keys = append(out.Keys, outChIdentity)
	}
	return out, true
}

func (h *Host) layoutRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/layouts", func(w http.ResponseWriter, r *http.Request) {
		var out []freshLayout
		for _, sc := range h.fresh {
			if l, ok := h.layoutOf(sc); ok {
				out = append(out, l)
			}
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Module != out[j].Module {
				return out[i].Module < out[j].Module
			}
			return out[i].Kind < out[j].Kind
		})
		writeJSON(w, 200, map[string]any{"ok": true, "pung": buildVersion, "layouts": out})
	})
}
