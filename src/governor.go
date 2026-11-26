package main

// governor.go: what Pung's devices cost, measured (docs/GOVERNOR.md).
//
// GET /api/governor?seconds=N reads every counter, waits N seconds and reads
// them again: the processor each device's realtime thread took, the time of
// it inside the module's render, what each emulator's process took, Pung's
// own rest, Live's, and the whole Push's. Everything in percent of one core
// (the Push has four: 400 is all of it). The Push's "busy" leaves out work at
// a low priority ("background": Live's library indexer), which gives way. Nothing runs between requests: the
// counters are the kernel's and the realtime thread's own.
//
// "silent" is the cost of what nobody heard: devices whose output stayed
// under liveSilentDB for the whole window, and emulators all of whose
// devices did.

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

// clockTick: the kernel's unit for a process's time in /proc (USER_HZ, 100
// on every Linux Pung runs on).
const clockTick = 10 * time.Millisecond

// engineSuffix: an emulator's process runs an executable named for its
// module (NATIVE-MODULES.md rule 1): "ostirus-engine". The process's own
// name is the engine's to set ("ostirus"), so the executable is read.
const engineSuffix = "-engine"

// govSilenceEvery: how often a window listens for sound.
const govSilenceEvery = 250 * time.Millisecond

// procCPU: the processor time a process has used, all its threads.
func procCPU(pid int) (time.Duration, bool) {
	b, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return 0, false
	}
	return parseProcCPU(string(b))
}

// parseProcCPU reads utime and stime from a /proc/<pid>/stat line.
func parseProcCPU(stat string) (time.Duration, bool) {
	i := strings.LastIndexByte(stat, ')') // the name may hold spaces and brackets
	if i < 0 {
		return 0, false
	}
	f := strings.Fields(stat[i+1:])
	if len(f) < 13 { // state is f[0]; utime and stime the 14th and 15th of the line
		return 0, false
	}
	u, err1 := strconv.ParseInt(f[11], 10, 64)
	s, err2 := strconv.ParseInt(f[12], 10, 64)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	return time.Duration(u+s) * clockTick, true
}

// systemCPU: the Push's processor time since it started, all cores
// together: busy (what ordinary and realtime work took), background (work at
// a low priority, "nice": Live's library indexer runs so for hours, and gives
// way to anything that plays) and the whole.
func systemCPU() (busy, background, total time.Duration, ok bool) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, 0, false
	}
	return parseSystemCPU(string(b))
}

func parseSystemCPU(stat string) (busy, background, total time.Duration, ok bool) {
	line, _, _ := strings.Cut(stat, "\n")
	f := strings.Fields(line)
	if len(f) < 6 || f[0] != "cpu" {
		return 0, 0, 0, false
	}
	var sum, idle, nice int64
	for i, s := range f[1:] {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return 0, 0, 0, false
		}
		if i >= 8 { // guest time is inside user's already
			break
		}
		sum += v
		switch i {
		case 1:
			nice = v
		case 3, 4: // idle, iowait
			idle += v
		}
	}
	return time.Duration(sum-idle-nice) * clockTick, time.Duration(nice) * clockTick, time.Duration(sum) * clockTick, true
}

type govDevice struct {
	cpu, render time.Duration
	blocks      uint64
	peak        float32
}

// govThread: one of Pung's threads: its name and the processor time it has
// used. Go's threads are named for the process; the realtime threads
// "pung-rt"; a module's own threads as the module named them.
type govThread struct {
	name string
	cpu  time.Duration
}

// rtThreadName: rtloop.c names its threads so.
const rtThreadName = "pung-rt"

// threadCPUs: every thread of this process.
func threadCPUs() map[int]govThread {
	out := map[int]govThread{}
	ents, _ := os.ReadDir("/proc/self/task")
	for _, e := range ents {
		tid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		b, err := os.ReadFile(filepath.Join("/proc/self/task", e.Name(), "stat"))
		if err != nil {
			continue // it ended meanwhile
		}
		s := string(b)
		i, j := strings.LastIndexByte(s, ')'), strings.IndexByte(s, '(')
		cpu, ok := parseProcCPU(s)
		if !ok || j < 0 || i < j {
			continue
		}
		out[tid] = govThread{s[j+1 : i], cpu}
	}
	return out
}

type govSample struct {
	at        time.Time
	sysBusy   time.Duration
	sysBack   time.Duration
	sysTotal  time.Duration
	pung      time.Duration
	devices   map[int]govDevice     // by slot
	engines   map[int]time.Duration // an emulator's process, by pid
	engineOf  map[int]string        // its module
	children  time.Duration         // what else Pung's modules forked
	threads   map[int]govThread     // Pung's own threads, by thread id
	live      time.Duration
	push3     time.Duration
	liveFound bool
}

// govSampleNow reads every counter once.
func (h *Host) govSampleNow() govSample {
	s := govSample{at: time.Now(), devices: map[int]govDevice{}, engines: map[int]time.Duration{}, engineOf: map[int]string{}}
	s.sysBusy, s.sysBack, s.sysTotal, _ = systemCPU()
	self := os.Getpid()
	s.pung, _ = procCPU(self)
	s.threads = threadCPUs()
	for _, p := range listProcs() {
		switch {
		case p.pid == self:
		case p.pgid == self: // a module's process: an emulator's engine, or a fork of Pung
			c, ok := procCPU(p.pid)
			if !ok {
				continue
			}
			if m, isEngine := strings.CutSuffix(filepath.Base(p.exe), engineSuffix); isEngine {
				s.engines[p.pid], s.engineOf[p.pid] = c, m
			} else {
				s.children += c
			}
		case p.exe == "/opt/push3/Live":
			s.live, s.liveFound = procCPU(p.pid)
		case p.exe == "/opt/push3/Push3":
			s.push3, _ = procCPU(p.pid)
		}
	}
	if h.prov != nil {
		for _, d := range h.prov.list() {
			if cpu, render, blocks, peak, ok := d.loopUsage(); ok {
				s.devices[d.s.Index] = govDevice{cpu, render, blocks, peak}
			}
		}
	}
	return s
}

// viewOpen: Pung's view owns the Push's screen now (it draws frames).
func (h *Host) viewOpen() bool {
	u := h.surf.Load()
	return u != nil && u.focused.Load()
}

// pct: a share of the window in percent of one core, to a tenth.
func pct(d, window time.Duration) float64 {
	if window <= 0 || d < 0 {
		return 0
	}
	return float64(int64(float64(d)/float64(window)*1000+0.5)) / 10
}

// govReport: what ran between two samples. loudest: each device's loudest
// output in the window, by slot.
func (h *Host) govReport(a, b govSample, loudest map[int]float32) map[string]any {
	window := b.at.Sub(a.at)
	cores := runtime.NumCPU()
	out := map[string]any{"window_s": float64(window.Milliseconds()) / 1000, "cores": cores, "unit": "percent of one core"}

	var rtSum, silentSum time.Duration
	heard := map[string]bool{}  // a module with a device that sounded
	loaded := map[string]bool{} // a module with a device at all
	devs := []map[string]any{}
	if h.prov != nil {
		for _, d := range h.prov.list() {
			x, ok1 := a.devices[d.s.Index]
			y, ok2 := b.devices[d.s.Index]
			if !ok1 || !ok2 || y.cpu < x.cpu { // made or restarted within the window
				continue
			}
			cpu, render, blocks := y.cpu-x.cpu, y.render-x.render, y.blocks-x.blocks
			silent := peakDB(loudest[d.s.Index]) < liveSilentDB
			rtSum += cpu
			loaded[d.c.module] = true
			if silent {
				silentSum += cpu
			} else {
				heard[d.c.module] = true
			}
			e := map[string]any{"n": d.s.Index, "name": d.c.Name, "module": d.c.module,
				"cpu": pct(cpu, window), "render": pct(render, window), "blocks": blocks,
				"peak_db": float64(int64(peakDB(loudest[d.s.Index])*10)) / 10, "silent": silent}
			if l := limitsOf(d.c.module); l != nil && l.Emulator {
				e["emulator"] = true
			}
			if rests(d.c.module) {
				e["resting"] = d.resting()
			}
			devs = append(devs, e)
		}
	}
	sort.Slice(devs, func(i, j int) bool { return devs[i]["cpu"].(float64) > devs[j]["cpu"].(float64) })
	out["devices"] = devs

	var engSum time.Duration
	engs := []map[string]any{}
	for pid, c1 := range b.engines {
		c0, ok := a.engines[pid]
		if !ok || c1 < c0 {
			continue
		}
		m := b.engineOf[pid]
		silent := !heard[m]
		engSum += c1 - c0
		if silent {
			silentSum += c1 - c0
		}
		engs = append(engs, map[string]any{"module": m, "pid": pid, "cpu": pct(c1-c0, window),
			"silent": silent, "has_device": loaded[m]})
	}
	sort.Slice(engs, func(i, j int) bool { return engs[i]["cpu"].(float64) > engs[j]["cpu"].(float64) })
	out["engines"] = engs

	// Pung's threads by name: Go's (the view, the pumps, the web page) carry
	// the process's name, a module's own threads the name it gave them
	self := filepath.Base(os.Args[0])
	if len(self) > 15 {
		self = self[:15] // the kernel keeps 15 characters
	}
	byName := map[string]time.Duration{}
	for tid, t1 := range b.threads {
		if t0, ok := a.threads[tid]; ok && t1.cpu >= t0.cpu {
			byName[t1.name] += t1.cpu - t0.cpu
		} else if !ok {
			byName[t1.name] += t1.cpu // started within the window
		}
	}
	mods := []map[string]any{}
	for name, c := range byName {
		if name != self && name != rtThreadName && c > 0 {
			mods = append(mods, map[string]any{"name": name, "cpu": pct(c, window)})
		}
	}
	sort.Slice(mods, func(i, j int) bool { return mods[i]["cpu"].(float64) > mods[j]["cpu"].(float64) })
	pung := b.pung - a.pung
	out["pung"] = map[string]any{"cpu": pct(pung, window), "device_threads": pct(rtSum, window),
		"go": pct(byName[self], window), "module_threads": mods, "forks": pct(b.children-a.children, window),
		"view_open": h.viewOpen()}
	if b.liveFound {
		out["live"] = pct(b.live-a.live, window)
		out["push3"] = pct(b.push3-a.push3, window)
	}
	// free: what is not busy. Background work (low priority) is not in the
	// way of anything that plays, so it is free too, and shown beside it.
	busy := pct(b.sysBusy-a.sysBusy, window)
	out["system"] = map[string]any{"busy": busy, "background": pct(b.sysBack-a.sysBack, window),
		"free": float64(int64((float64(cores)*100-busy)*10+0.5)) / 10}
	// everything Pung brings: itself, its emulators, its modules' forks
	out["pung_total"] = pct(pung+engSum+(b.children-a.children), window)
	out["silent"] = pct(silentSum, window)
	if h.gov != nil {
		out["rest_after_ms"] = h.gov.restMS.Load()
	}
	return out
}

// govMeasure: a window of the given length. It listens for sound through
// the window: a device is silent only if it never rose above liveSilentDB.
func (h *Host) govMeasure(window time.Duration, done <-chan struct{}) map[string]any {
	a := h.govSampleNow()
	loudest := map[int]float32{}
	hear := func(s govSample) {
		for n, d := range s.devices {
			if d.peak > loudest[n] {
				loudest[n] = d.peak
			}
		}
	}
	hear(a)
	end := time.NewTimer(window)
	defer end.Stop()
	t := time.NewTicker(govSilenceEvery)
	defer t.Stop()
	for {
		select {
		case <-done:
			return nil
		case <-t.C:
			if h.prov == nil {
				continue
			}
			for _, d := range h.prov.list() {
				if _, _, _, peak, ok := d.loopUsage(); ok && peak > loudest[d.s.Index] {
					loudest[d.s.Index] = peak
				}
			}
			continue
		case <-end.C:
		}
		break
	}
	b := h.govSampleNow()
	hear(b)
	return h.govReport(a, b, loudest)
}

func (h *Host) governorRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/governor", func(w http.ResponseWriter, r *http.Request) {
		secs := 2.0
		if q := r.URL.Query().Get("seconds"); q != "" {
			v, err := strconv.ParseFloat(q, 64)
			if err != nil || v < 0.2 || v > 120 {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "seconds: 0.2 to 120"})
				return
			}
			secs = v
		}
		rep := h.govMeasure(time.Duration(secs*float64(time.Second)), r.Context().Done())
		if rep == nil {
			return // the caller went away
		}
		writeJSON(w, http.StatusOK, rep)
	})
}
