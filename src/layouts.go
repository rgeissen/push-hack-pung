package main

// layouts.go: GET /api/layouts, the order Pung gives each module's own
// parameters when it builds its device afresh (not the order this
// installation has grown: stablelayout.go). It is what the registry of the
// Set contract is seeded from (docs/SET-CONTRACT.md): one fixed number for
// each parameter of a module, the same on every Pung, in every host.
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

// freshLayout: one device as built afresh
type freshLayout struct {
	Module string `json:"module"`
	Kind   string `json:"kind"` // instrument | effect | midi
	Name   string `json:"name"`
	// Keys: its own parameters, in order, each by its key without the
	// chain's prefix ("cutoff", not "synth:cutoff"). Not the MIDI FX
	// selector, not a MIDI effect's parameters, not what Pung adds (the
	// MIDI output channel), not the entries that fill a page.
	Keys []string `json:"keys"`
	// Entries: what its own pages take of Live's list, with the entries that
	// fill them (an instrument has 192 for them: 24 pages)
	Entries int `json:"entries"`
}

// ownKey: a class parameter's key if it is the module's own, else ""
func ownKey(p livedevice.Param) string {
	if p.Key == "" || p.Role != "" { // a placeholder; the selector, an effect's ("fx:…"), the output channel
		return ""
	}
	if _, k, ok := strings.Cut(p.Key, ":"); ok {
		return k
	}
	return p.Key
}

func freshLayoutOf(sc *sclass) freshLayout {
	out := freshLayout{Module: sc.module, Kind: sc.Kind, Name: sc.Name, Keys: []string{}}
	own := map[int]bool{}
	for i, p := range sc.Params {
		if k := ownKey(p); k != "" {
			out.Keys = append(out.Keys, k)
			own[i] = true
		}
	}
	// its own pages: every bank that holds one of its own parameters, whole
	seen := map[int]bool{}
	for _, b := range sc.Banks {
		mine := false
		for _, i := range b {
			if own[i] {
				mine = true
			}
		}
		if !mine {
			continue
		}
		for _, i := range b {
			if !seen[i] {
				seen[i] = true
				out.Entries++
			}
		}
	}
	for i := range own {
		if !seen[i] {
			out.Entries++ // (in no bank: counted once)
		}
	}
	return out
}

func (h *Host) layoutRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/layouts", func(w http.ResponseWriter, r *http.Request) {
		var out []freshLayout
		for _, sc := range h.fresh {
			out = append(out, freshLayoutOf(sc))
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
