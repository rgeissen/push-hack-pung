package main

import (
	"fmt"
	"testing"
)

func layoutMeta(pages ...[]string) *compMeta {
	cm := &compMeta{Module: "test", Params: map[string]*paramMeta{}}
	for _, p := range pages {
		for _, k := range p {
			if cm.Params[k] == nil {
				cm.Params[k] = &paramMeta{Key: k, Name: k, Type: "float", Max: 1}
				cm.Order = append(cm.Order, k)
			}
		}
	}
	return cm
}

// A module's own layout is its parameters in the order of its pages, by key
// without the chain's prefix; whole pages only, as many as the kind of device
// has room for; and it says how many parameters were left.
func TestOwnLayout(t *testing.T) {
	cm := layoutMeta([]string{"cutoff", "reso", "mode"}, []string{"attack", "decay"})
	cm.Order = []string{"decay", "mode", "cutoff", "attack", "reso", "loose"} // as the module happens to list them
	cm.Params["loose"] = &paramMeta{Key: "loose", Name: "loose", Type: "float", Max: 1}
	cm.Banks = []bank{{Keys: []string{"cutoff", "reso", "mode"}}, {Keys: []string{"attack", "decay", "cutoff"}}}
	keys, entries, left := ownLayout(cm, "synth", 192)
	want := "[cutoff reso mode attack decay loose]"
	if fmt.Sprint(keys) != want {
		t.Errorf("order of the pages, each parameter once, then what is in no page: %v, want %s", keys, want)
	}
	if entries != 24 || left != 0 {
		t.Errorf("three pages filled to eights are 24 entries, got %d (left %d)", entries, left)
	}
	// room for two pages only: the third stays out, whole
	keys, entries, left = ownLayout(cm, "synth", 16)
	if fmt.Sprint(keys) != "[cutoff reso mode attack decay]" || entries != 16 || left != 1 {
		t.Errorf("two pages of room: %v, %d entries, %d left", keys, entries, left)
	}
	// nothing after the first page that does not fit, even a smaller one
	big := layoutMeta()
	var p1, p2 []string
	for i := 0; i < 8; i++ {
		p1 = append(p1, fmt.Sprintf("a%d", i))
	}
	for i := 0; i < 12; i++ {
		p2 = append(p2, fmt.Sprintf("b%d", i))
	}
	big = layoutMeta(p1, p2, []string{"c0"})
	big.Banks = []bank{{Keys: p1}, {Keys: p2}, {Keys: []string{"c0"}}}
	keys, entries, left = ownLayout(big, "synth", 16)
	if len(keys) != 8 || entries != 8 || left != 13 {
		t.Errorf("a page that does not fit ends the list: %d keys, %d entries, %d left", len(keys), entries, left)
	}
}
