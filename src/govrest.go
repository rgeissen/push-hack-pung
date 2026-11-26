package main

// govrest.go: the governor's decisions (docs/GOVERNOR.md). governor.go
// measures; this file acts on it.
//
//   - Rest. An emulator runs its DSP whether a voice sounds or not: 47 to 76
//     percent of a core each, for nobody (measured 2026-11-25). A module that
//     can rest is told after how long a silence it may (rest_after_ms): it
//     then stops its engine until something is sent to it, and its first
//     note is as on time as any other (NATIVE-MODULES.md, "Rest"). Pung only
//     says when; the module knows whether it may (no key held, nothing
//     waiting, its output silent).
//   - Room. An emulator starts only while the Push keeps a core free with it
//     playing (govRoom): Live's share. One that would take it waits, as a
//     third emulator does, and starts by itself when there is room.
//
// In doubt a device runs: a module that does not know rest_after_ms ignores
// it, a reading that fails lets the emulator start.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// govRestDefault: the silence after which a module that can rest does.
// Waking costs nothing that can be heard (the first note of a rested
// emulator: 15.0 ms to its sound against 14.4 awake), so it is short: long
// enough that a pause between two phrases is not a rest, and that a delay's
// or a reverb's tail, which keeps the module awake by itself, is over.
const govRestDefault = 10 * time.Second

// govKeepEvery: how often the governor looks whether each module that can
// rest still knows when (a module loaded again forgets). It runs only while
// such a device exists.
const govKeepEvery = 5 * time.Second

// governor: the one per Pung.
type governor struct {
	h       *Host
	restMS  atomic.Int64 // 0: nothing rests
	mu      sync.Mutex
	keeping bool // the keeper runs
	room    govRoomState
}

func newGovernor(h *Host) *governor {
	g := &governor{h: h}
	g.restMS.Store(govRestDefault.Milliseconds())
	if v := os.Getenv("PUNG_REST_MS"); v != "" { // 0: no module rests (a test, a doubt)
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			g.restMS.Store(int64(n))
		}
	}
	return g
}

// canRest: the module rests when told to (its limits say so).
func canRest(module string) bool {
	l := limitsOf(module)
	return l != nil && l.Rests
}

// hostRests: Pung stops asking the module for sound while nobody hears it
// (rtloop.c): a Schwung emulator, built for a host that does.
func hostRests(module string) bool {
	l := limitsOf(module)
	return l != nil && l.HostRests
}

// rests: one way or the other.
func rests(module string) bool { return canRest(module) || hostRests(module) }

// adopt: a device was made, or its module loaded again: a module that can
// rest is told when, and watched.
func (g *governor) adopt(d *device) {
	if g == nil || !rests(d.c.module) {
		return
	}
	g.tell(d)
	g.mu.Lock()
	start := !g.keeping
	g.keeping = true
	g.mu.Unlock()
	if start {
		go g.keep()
	}
}

// tell gives a device its rest time, where it does not have it.
func (g *governor) tell(d *device) {
	want := g.restMS.Load()
	d.s.rests.Store(want > 0)
	if hostRests(d.c.module) {
		d.setHostRest(want) // (again every few seconds: the device's thread may have started since)
		return
	}
	comp := d.c.component()
	if d.s.loading.Load() {
		return // its module loads: the keeper comes back
	}
	has, ok := d.s.Get(comp + ":rest_after_ms")
	if !ok || has == "" || has == strconv.FormatInt(want, 10) {
		return // told already, or a module that does not rest (an older build of it)
	}
	d.s.Set(comp+":rest_after_ms", strconv.FormatInt(want, 10))
}

// keep: while a device that can rest exists, each is told again where its
// module forgot (loaded again: a model changed, a hang, a state). Ends with
// the last such device: with none, the governor does not wake.
func (g *governor) keep() {
	t := time.NewTicker(govKeepEvery)
	defer t.Stop()
	for range t.C {
		n := 0
		if g.h.prov != nil {
			for _, d := range g.h.prov.list() {
				if rests(d.c.module) {
					n++
					g.tell(d)
				}
			}
		}
		if n == 0 {
			g.mu.Lock()
			g.keeping = false
			g.mu.Unlock()
			return
		}
	}
}

// setRest changes the rest time (0: nothing rests) and tells every device.
func (g *governor) setRest(ms int64) {
	g.restMS.Store(ms)
	if g.h.prov == nil {
		return
	}
	for _, d := range g.h.prov.list() {
		if rests(d.c.module) {
			g.tell(d)
		}
	}
}

// resting: the device's module is at rest now.
func (d *device) resting() bool {
	if hostRests(d.c.module) {
		on, _ := d.hostResting()
		return on
	}
	if !canRest(d.c.module) || d.s.loading.Load() {
		return false
	}
	v, _ := d.s.Get(d.c.component() + ":resting")
	return v == "1"
}

// ---- room -----------------------------------------------------------------------

// govFreeShare: what stays free of the Push with every emulator playing, in
// percent of one core (docs/GOVERNOR.md, R4). Half a core, by measurement:
// the heaviest pair there is (Nodal Red 2X and OsTIrus, 2.7 cores between
// them) played beside Live with 0.7 of a core free and neither an underrun
// nor a late block (2026-11-25). A whole core would refuse that pair on an
// idle Push; less than half leaves Live's own work nothing to grow into.
const govFreeShare = 50.0

// govRoomWindow: the Push's load is read over at least this long. A device
// Live asks for again every second gives the next window by itself.
const (
	govRoomWindow = 300 * time.Millisecond
	govRoomStale  = 20 * time.Second
)

// govRoomState: the last reading of the Push's processor time (under the
// governor's mu).
type govRoomState struct {
	at          time.Time
	busy, total time.Duration
	engines     map[int]time.Duration
}

// govLoad: what the Push is doing now, in percent of one core: all of it,
// and each running emulator's process by its module. ok false: no reading
// (not a Push, or the first look): in doubt, a device runs.
func (g *governor) govLoad() (busy float64, engines map[string]float64, ok bool) {
	read := func() (govRoomState, bool) {
		b, _, t, ok := systemCPU()
		if !ok {
			return govRoomState{}, false
		}
		s := govRoomState{at: time.Now(), busy: b, total: t, engines: map[int]time.Duration{}}
		for pid := range g.enginePIDs() {
			if c, ok := procCPU(pid); ok {
				s.engines[pid] = c
			}
		}
		return s, true
	}
	g.mu.Lock()
	prev := g.room
	g.mu.Unlock()
	if prev.at.IsZero() || time.Since(prev.at) > govRoomStale {
		p, ok := read()
		if !ok {
			return 0, nil, false
		}
		prev = p
		time.Sleep(govRoomWindow)
	} else if d := time.Since(prev.at); d < govRoomWindow {
		time.Sleep(govRoomWindow - d)
	}
	now, ok := read()
	if !ok {
		return 0, nil, false
	}
	g.mu.Lock()
	g.room = now
	g.mu.Unlock()
	window := now.at.Sub(prev.at)
	engines = map[string]float64{}
	names := g.enginePIDs()
	for pid, c := range now.engines {
		if c0, had := prev.engines[pid]; had && c >= c0 {
			engines[names[pid]] += pct(c-c0, window)
		}
	}
	return pct(now.busy-prev.busy, window), engines, true
}

// enginePIDs: the emulators' processes, each with its module.
func (g *governor) enginePIDs() map[int]string {
	out := map[int]string{}
	self := os.Getpid()
	for _, p := range listProcs() {
		if p.pgid != self || p.pid == self {
			continue
		}
		if m, ok := strings.CutSuffix(baseName(p.exe), engineSuffix); ok {
			out[p.pid] = m
		}
	}
	return out
}

func baseName(path string) string {
	if i := strings.LastIndexByte(path, '/'); i >= 0 {
		return path[i+1:]
	}
	return path
}

// govRoom: why an emulator may not start now, or "". busy: the Push's load
// in percent of one core; engines: what each running emulator's process
// takes now; running: the modules of the devices there are; cores: the
// Push's. An emulator at rest takes nothing now and its full cost at the
// next key, so each running emulator counts at its playing cost at least.
func govRoom(module string, busy float64, engines map[string]float64, running []string, cores int) string {
	l := limitsOf(module)
	if l == nil || !l.Emulator {
		return ""
	}
	if l.One != "" {
		for _, m := range running {
			if m == module {
				return "" // a second of a kind that runs one at a time: it waits, and costs nothing
			}
		}
	}
	need := busy + l.cost()
	for _, m := range emulatorsRunning(running) {
		if lm := limitsOf(m); lm != nil && lm.cost() > engines[m] {
			need += lm.cost() - engines[m] // at rest, or still starting
		}
	}
	if room := float64(cores)*100 - govFreeShare; need > room {
		return fmt.Sprintf("the Push is too busy for it now (it takes about %.1f of a core while it plays, and %.1f of the %d are free beside what the emulators here need): it starts when there is room",
			l.cost()/100, (float64(cores)*100-need+l.cost())/100, cores)
	}
	return ""
}

// roomRefused: govRoom with the Push's load as it is.
func (g *governor) roomRefused(module string, running []string) string {
	if g == nil {
		return ""
	}
	if l := limitsOf(module); l == nil || !l.Emulator {
		return ""
	}
	busy, engines, ok := g.govLoad()
	if !ok {
		return "" // no reading: it runs
	}
	return govRoom(module, busy, engines, running, runtime.NumCPU())
}

func (h *Host) governRoutes(mux *http.ServeMux) {
	// One of Pung's own sources on a control, as ASSIGN makes it on the Push
	// (pungmod.go): for a test without a hand on the encoders. amount 0
	// removes it. The control's range is the caller's to give (ASSIGN reads
	// it from the module's metadata).
	mux.HandleFunc("POST /api/devices/{n}/pung-mod", func(w http.ResponseWriter, r *http.Request) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return
		}
		var req struct {
			Key, Source string
			Amount      float64
			Min, Max    *float64
			Float       bool
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Key == "" || !isPungSource(req.Source) {
			fail(w, http.StatusBadRequest, "want key, source (p_lfo_a, p_lfo_b, p_wheel, p_press), amount")
			return
		}
		m := &paramMeta{Type: "int", Min: 0, Max: 127}
		if req.Float {
			m.Type = "float"
		}
		if req.Min != nil && req.Max != nil {
			m.Min, m.Max = *req.Min, *req.Max
		}
		d.s.pmod().setRoute(d.c.component()+":"+req.Key, req.Source, req.Amount, false, m)
		d.touch()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	// the rest time, for a test or a doubt: {"ms": 0} lets nothing rest. Not
	// kept: Pung starts with govRestDefault (or PUNG_REST_MS).
	mux.HandleFunc("POST /api/governor/rest", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			MS *int64 `json:"ms"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			fail(w, http.StatusBadRequest, "body: %v", err)
			return
		}
		if req.MS == nil || *req.MS < 0 || *req.MS > 3600000 {
			fail(w, http.StatusBadRequest, "ms: 0 (nothing rests) to 3600000")
			return
		}
		h.gov.setRest(*req.MS)
		log.Printf("governor: modules rest after %d ms of silence", *req.MS)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rest_after_ms": *req.MS})
	})
}
