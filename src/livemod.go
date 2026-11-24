package main

// livemod.go: modulation, live. Every synth's pictures show where its
// modulation puts its controls as the sound plays (UX-GUIDELINES.md, Live
// pictures: "Modulation"): a module that knows answers get_param("live_mod")
// with the controls something modulates now and the value each is at,
// {"filter_1_cutoff": 74.2, "osc_1_wave_frame": "128"}, in the parameter's
// own raw units (as get_param answers it), and {} while nothing sounds.
// Pung reads it every frame while a view or a page watches the sound; each
// knob of Pung's own pages draws it (draw.go, modMark), a module's screen
// gets it as v[key].now (0..1 of the range), a web page as frame.mod.
// A module that answers nothing (no live_mod) is asked again now and then:
// a module loaded later may know it.

import (
	"encoding/json"
	"strconv"
	"time"
)

const liveModRetry = 5 * time.Second // a component that answered no live_mod is asked again after this

type liveModReader struct {
	want map[string]time.Time // component ("synth") -> last asked by a watcher
	none map[string]time.Time // component -> when it answered nothing
	last map[string]string    // component -> its last answer, raw
	vals map[string]map[string]string
}

// wantMod: a watcher draws the controls of comp.
func (ls *liveSession) wantMod(comp string) {
	if comp == "" {
		return
	}
	ls.mu.Lock()
	if ls.mod.want == nil {
		ls.mod.want = map[string]time.Time{}
	}
	ls.mod.want[comp] = time.Now()
	ls.mu.Unlock()
}

// read: every wanted component's modulated controls, "<comp>:<key>" -> raw
// (nil: none). The session's lock is held.
func (r *liveModReader) read(s *Slot, now time.Time) map[string]string {
	if len(r.want) == 0 || s == nil {
		return nil
	}
	var out map[string]string
	for comp, at := range r.want {
		if now.Sub(at) > liveWantTTL {
			delete(r.want, comp)
			continue
		}
		if t, ok := r.none[comp]; ok && now.Sub(t) < liveModRetry {
			continue
		}
		raw, ok := s.Get(comp + ":live_mod")
		if !ok || raw == "" || raw[0] != '{' {
			if r.none == nil {
				r.none = map[string]time.Time{}
			}
			r.none[comp] = now
			continue
		}
		delete(r.none, comp)
		if r.last == nil {
			r.last, r.vals = map[string]string{}, map[string]map[string]string{}
		}
		if raw != r.last[comp] {
			r.last[comp], r.vals[comp] = raw, parseLiveMod(raw)
		}
		for k, v := range r.vals[comp] {
			if out == nil {
				out = map[string]string{}
			}
			out[comp+":"+k] = v
		}
	}
	return out
}

// parseLiveMod: {"key": number or string, ...} -> key -> raw text.
func parseLiveMod(raw string) map[string]string {
	var m map[string]any
	if json.Unmarshal([]byte(raw), &m) != nil {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		switch x := v.(type) {
		case float64:
			out[k] = strconv.FormatFloat(x, 'f', -1, 64)
		case string:
			out[k] = x
		}
	}
	return out
}
