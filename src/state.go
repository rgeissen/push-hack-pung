package main

// state.go: a slot's chain is saved as a Pung patch (the document the
// chain host's load_file reads) wrapped the way Schwung's slot autosave
// wraps it (slot_N.json: name, version, chain). The same file therefore
// loads on Move and on Push.
//
// Rules carried over from Schwung's shadow_ui autosave:
//   - a component's opaque "<prefix>:state" is saved verbatim (parsed as
//     JSON when it is JSON), never re-derived from params;
//   - a state read that does not answer aborts the save: an autosave must
//     never replace a good file with a partial one;
//   - an empty chain writes "{}", which loads as an empty slot.

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	maxAudioFX = 8
	maxMidiFX  = 8
)

type slotFile struct {
	Name    string          `json:"name"`
	Version int             `json:"version"`
	Chain   json.RawMessage `json:"chain,omitempty"`
}

func (h *Host) statePath(i int) string {
	return filepath.Join(h.dataDir, "slots", fmt.Sprintf("slot_%d.json", i))
}

// stateBlob reads "<prefix>:state". ok=false means the read failed.
func (s *Slot) stateBlob(prefix string) (any, bool) {
	v, ok := s.Get(prefix + ":state")
	if !ok {
		return nil, true // the module has no state: not a failure
	}
	if v == "" {
		return nil, true
	}
	var parsed any
	if json.Unmarshal([]byte(v), &parsed) == nil {
		return parsed, true
	}
	return v, true
}

func (s *Slot) bypassed(prefix string) int {
	if v, ok := s.Get(prefix + ":bypassed"); ok && v == "1" {
		return 1
	}
	return 0
}

// Composition is what a slot holds: one module id per position.
type Composition struct {
	Synth  string   `json:"synth"`
	MidiFX []string `json:"midi_fx"` // len maxMidiFX, "" = empty
	FX     []string `json:"fx"`      // len maxAudioFX
}

func (s *Slot) composition() Composition {
	c := Composition{MidiFX: make([]string, maxMidiFX), FX: make([]string, maxAudioFX)}
	c.Synth, _ = s.Get("synth_module")
	for i := 0; i < maxMidiFX; i++ {
		c.MidiFX[i], _ = s.Get(fmt.Sprintf("midi_fx%d_module", i+1))
	}
	for i := 0; i < maxAudioFX; i++ {
		c.FX[i], _ = s.Get(fmt.Sprintf("fx%d_module", i+1))
	}
	return c
}

func (c Composition) empty() bool {
	if c.Synth != "" {
		return false
	}
	for _, m := range append(append([]string{}, c.MidiFX...), c.FX...) {
		if m != "" {
			return false
		}
	}
	return true
}

// patch builds the slot's chain as a Pung patch document.
func (s *Slot) patch(name string) (map[string]any, error) {
	c := s.composition()
	p := map[string]any{"custom_name": name, "input": "both", "audio_fx": []any{}}
	if c.Synth != "" {
		st, ok := s.stateBlob("synth")
		if !ok {
			return nil, fmt.Errorf("synth:state did not answer")
		}
		cfg := map[string]any{}
		if st != nil {
			cfg["state"] = st
		}
		p["synth"] = map[string]any{"module": c.Synth, "config": cfg, "bypassed": s.bypassed("synth")}
	}
	var midi []any
	for i, id := range c.MidiFX {
		if id == "" {
			continue
		}
		prefix := "midi_fx" + strconv.Itoa(i+1)
		st, ok := s.stateBlob(prefix)
		if !ok {
			return nil, fmt.Errorf("%s:state did not answer", prefix)
		}
		params := map[string]any{}
		if st != nil {
			params["state"] = st
		}
		midi = append(midi, map[string]any{"type": id, "params": params, "bypassed": s.bypassed(prefix)})
	}
	if len(midi) > 0 {
		p["midi_fx"] = midi
	}
	var fx []any
	for i, id := range c.FX {
		if id == "" {
			continue
		}
		prefix := "fx" + strconv.Itoa(i+1)
		st, ok := s.stateBlob(prefix)
		if !ok {
			return nil, fmt.Errorf("%s:state did not answer", prefix)
		}
		params := map[string]any{}
		if st != nil {
			params["state"] = st
		}
		fx = append(fx, map[string]any{"type": id, "params": params, "bypassed": s.bypassed(prefix)})
	}
	if fx != nil {
		p["audio_fx"] = fx
	}
	if v, ok := s.Get("knob_mappings"); ok && v != "" && v != "[]" {
		var km any
		if json.Unmarshal([]byte(v), &km) == nil {
			p["knob_mappings"] = km
		}
	}
	return p, nil
}

// save writes slot_N.json, atomically.
func (h *Host) save(s *Slot) error {
	c := s.composition()
	var doc []byte
	if c.empty() {
		doc = []byte("{}\n")
	} else {
		p, err := s.patch(s.Name)
		if err != nil {
			return err
		}
		chain, _ := json.Marshal(p)
		doc, _ = json.MarshalIndent(slotFile{Name: s.Name, Version: 1, Chain: chain}, "", "  ")
		doc = append(doc, '\n')
	}
	path := h.statePath(s.Index)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if old, err := os.ReadFile(path); err == nil && string(old) == string(doc) {
		return nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, doc, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// restore loads slot_N.json into the slot through the chain's load_file.
func (h *Host) restore(s *Slot) error {
	raw, err := os.ReadFile(h.statePath(s.Index))
	if err != nil {
		return nil // nothing saved yet
	}
	var f slotFile
	if json.Unmarshal(raw, &f) != nil || len(f.Chain) == 0 {
		return nil // "{}": an empty slot
	}
	return h.loadPatch(s, f.Chain)
}

// loadPatch hands a patch document to the chain host.
func (h *Host) loadPatch(s *Slot, chain []byte) error {
	tmp := filepath.Join(h.dataDir, fmt.Sprintf(".load_%d.json", s.Index))
	if err := os.WriteFile(tmp, chain, 0o644); err != nil {
		return err
	}
	defer os.Remove(tmp)
	start := time.Now()
	s.Set("load_file", tmp)
	if e, ok := s.Get("load_error"); ok && e != "" {
		return fmt.Errorf("load: %s", e)
	}
	log.Printf("%s: restored in %v", s.Name, time.Since(start).Round(time.Millisecond))
	return nil
}

// autosave saves every changed slot a few seconds after its last change.
func (h *Host) autosave(stop <-chan struct{}) {
	t := time.NewTicker(3 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			h.saveAll()
			return
		case <-t.C:
			for _, s := range h.activeSlots() {
				if s.dirty.Swap(false) {
					if err := h.save(s); err != nil {
						s.dirty.Store(true) // try again next time
						log.Printf("%s: autosave: %v", s.Name, err)
					}
				}
			}
		}
	}
}

func (h *Host) saveAll() {
	for _, s := range h.activeSlots() {
		if err := h.save(s); err != nil {
			log.Printf("%s: save: %v", s.Name, err)
		}
	}
}
