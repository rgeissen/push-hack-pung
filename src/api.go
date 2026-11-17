package main

// api.go: the JSON API. Slots are numbered from 1 here, as the user sees
// them; inside the host they are 0-based.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, format string, a ...any) {
	writeJSON(w, code, map[string]any{"ok": false, "error": fmt.Sprintf(format, a...)})
}

func (h *Host) slotFromPath(w http.ResponseWriter, r *http.Request) (*Slot, bool) {
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 || n > maxSlots {
		fail(w, http.StatusBadRequest, "slot must be 1..%d", maxSlots)
		return nil, false
	}
	s := h.slot(n - 1)
	if s == nil {
		fail(w, http.StatusNotFound, "slot %d is not open", n)
		return nil, false
	}
	return s, true
}

type slotStatus struct {
	Slot      int         `json:"slot"`
	Name      string      `json:"name"`
	Chain     Composition `json:"chain"`
	PeakDB    float64     `json:"peak_db"`
	Bus       bool        `json:"bus"`
	Pair      int         `json:"pair"`
	Inputs    []string    `json:"inputs"`
	NotesIn   int64       `json:"notes_in"`
	MidiOut   int64       `json:"midi_out"`
	BusySkips int64       `json:"busy_skips"`
}

func (h *Host) slotStatus(s *Slot) slotStatus {
	st := slotStatus{Slot: s.Index + 1, Name: s.Name, Chain: s.composition(), PeakDB: peakDB(s.peak()),
		NotesIn: s.notesIn.Load(), MidiOut: s.midiOut.Load(), BusySkips: s.busySkips.Load(), Pair: -1}
	if s.bus != nil {
		st.Bus = s.bus.Connected()
		st.Pair = s.bus.Pair()
		st.Inputs = s.bus.Inputs()
	}
	return st
}

func (h *Host) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		var slots []slotStatus
		for _, s := range h.activeSlots() {
			slots = append(slots, h.slotStatus(s))
		}
		period, rate := h.format()
		running, bpm, clock := h.transport.snapshot()
		p := h.stats.periods.Load()
		avg := int64(0)
		if p > 0 {
			avg = h.stats.sumUS.Load() / p
		}
		writeJSON(w, 200, map[string]any{
			"ok": true, "version": buildVersion, "slots": slots,
			"engine": map[string]any{"period": period, "rate": rate, "periods": p,
				"avg_us": avg, "worst_us": h.stats.worstUS.Load(), "budget_us": h.stats.budgetUS.Load(),
				"overruns": h.stats.overruns.Load()},
			"transport": map[string]any{"running": running, "bpm": bpm, "clock": clock},
		})
	})
	// what stops the program: the garbage collector's pauses, newest first
	// (a pause stops the devices' audio threads too: see "late" in /api/devices)
	mux.HandleFunc("GET /api/debug/gc", func(w http.ResponseWriter, r *http.Request) {
		var st debug.GCStats
		debug.ReadGCStats(&st)
		type p struct {
			EndMS int64 `json:"end_ms"`
			US    int64 `json:"us"`
		}
		var out []p
		for i := 0; i < len(st.Pause) && i < len(st.PauseEnd) && i < 64; i++ {
			out = append(out, p{st.PauseEnd[i].UnixMilli(), st.Pause[i].Microseconds()})
		}
		writeJSON(w, 200, map[string]any{"ok": true, "num": st.NumGC, "now_ms": time.Now().UnixMilli(), "pauses": out,
			"gc_percent": gcPercent, "goroutines": runtime.NumGoroutine()})
	})

	mux.HandleFunc("GET /api/modules/screen", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, screenReport())
	})
	mux.HandleFunc("GET /api/modules", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "modules": scanModules(h.modulesDir)})
	})

	mux.HandleFunc("POST /api/slots/{n}/open", func(w http.ResponseWriter, r *http.Request) {
		n, err := strconv.Atoi(r.PathValue("n"))
		if err != nil || n < 1 || n > maxSlots {
			fail(w, 400, "slot must be 1..%d", maxSlots)
			return
		}
		s, err := h.openSlot(n - 1)
		if err != nil {
			fail(w, 500, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "slot": h.slotStatus(s)})
	})

	mux.HandleFunc("GET /api/slots/{n}", func(w http.ResponseWriter, r *http.Request) {
		if s, ok := h.slotFromPath(w, r); ok {
			writeJSON(w, 200, map[string]any{"ok": true, "slot": h.slotStatus(s)})
		}
	})

	// One key: ?key=. Several: ?keys=a,b,c. A key the chain does not answer
	// is null, never "": the difference is the tri-state rule.
	mux.HandleFunc("GET /api/slots/{n}/param", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		if k := r.URL.Query().Get("key"); k != "" {
			v, ok := s.Get(k)
			if !ok {
				writeJSON(w, 200, map[string]any{"ok": true, "key": k, "value": nil})
				return
			}
			writeJSON(w, 200, map[string]any{"ok": true, "key": k, "value": v})
			return
		}
		out := map[string]any{}
		for _, k := range strings.Split(r.URL.Query().Get("keys"), ",") {
			if k = strings.TrimSpace(k); k == "" {
				continue
			}
			if v, ok := s.Get(k); ok {
				out[k] = v
			} else {
				out[k] = nil
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "values": out})
	})

	mux.HandleFunc("POST /api/slots/{n}/param", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body) != nil || body.Key == "" {
			fail(w, 400, "body must be {\"key\":...,\"value\":...}")
			return
		}
		s.Set(body.Key, body.Value)
		h.notify(s.Index, body.Key, body.Value)
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/slots/{n}/note", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			Note     int `json:"note"`
			Velocity int `json:"velocity"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			fail(w, 400, "body must be {\"note\":60,\"velocity\":100}")
			return
		}
		s.Note(body.Note, body.Velocity)
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/slots/{n}/patch", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		p, err := s.patch(s.Name)
		if err != nil {
			fail(w, 503, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "patch": p})
	})

	mux.HandleFunc("POST /api/slots/{n}/patch", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil || !json.Valid(raw) {
			fail(w, 400, "body must be a Pung patch (JSON)")
			return
		}
		if err := h.loadPatch(s, raw); err != nil {
			fail(w, 500, "%v", err)
			return
		}
		h.notify(s.Index, "patch", "")
		writeJSON(w, 200, map[string]any{"ok": true, "slot": h.slotStatus(s)})
	})

	mux.HandleFunc("POST /api/slots/{n}/save", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		if err := h.save(s); err != nil {
			fail(w, 503, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
}

// notify tells every UI that a value changed (the web socket fans it out).
// Set by the web layer; a no-op until then.
var notifyHook func(slot int, key, value string)

func (h *Host) notify(slot int, key, value string) {
	if notifyHook != nil {
		notifyHook(slot, key, value)
	}
}

// gcPercent: GOGC as set at start (main.go).
var gcPercent = 100
