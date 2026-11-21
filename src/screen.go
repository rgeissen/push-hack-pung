package main

// screen.go: a module may crash; Pung must not crash with it.
//
// At start Pung probes every module in-process (probeMeta: create an
// instance, read its metadata) to build the Live device classes. One module
// that corrupts the heap there took the whole service down, and with it every
// Pung device in Live (Osirus 0.6.6, 2026-11-15). So each module is first
// probed in a child process (`pung -probe-module <id>`); only a module
// whose child exits cleanly is probed in-process. A module whose child
// crashes, hangs or fails is left out, and says why in the log and in
// GET /api/modules/screen.
//
// The verdict is cached in <data>/module-screen.json, keyed by what can change
// it (the module's files and this build), so a start without new modules
// spawns nothing.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	// A module that loads in the background (Osirus boots an emulated DSP
	// from its ROM) is waited for up to probeReadyWait; the child gets more.
	probeReadyWait = 120 * time.Second
	screenTimeout  = probeReadyWait + 30*time.Second
	screenWorkers  = 4
)

// Pung's own modules (origin "pung": the emulators) are probed one at a
// time, beside the workers for the rest. Each boots its emulator, threads at
// SCHED_FIFO 45, and four of them booting at once (a release that changed
// all four) starved one another on the Push's two cores: every probe ran out
// of time and all four were left out of Live (2026-11-21). One alone is
// ready in half a second.
func probeAlone(m ModuleInfo) bool { return m.Origin == "pung" }

type screenVerdict struct {
	Key string `json:"key"`
	OK  bool   `json:"ok"`
	Why string `json:"why,omitempty"`
	// Timeout: the probe ran out of time, which says nothing of the module
	// (a busy Push): left out now, probed again at the next start
	Timeout bool `json:"timeout,omitempty"`
	// what the child read once the module was ready (probeRecord)
	Probe *probeRecord `json:"probe,omitempty"`
}

// probeRecord: a module's metadata as the child probe read it, once the
// module had finished loading. Pung builds its Live classes from this and
// runs no module code in its own process at start.
type probeRecord struct {
	Meta    map[string]string `json:"meta"`    // the keys buildMeta asked, and the answers
	Initial map[string]string `json:"initial"` // each parameter's value in a fresh, loaded instance
	Waited  float64           `json:"waited"`  // seconds the module took to be ready
	Status  string            `json:"status,omitempty"`
}

var screenMu sync.Mutex
var screenResults = map[string]screenVerdict{}

// screenKey: what the verdict depends on. A new build of the module or of
// Pung probes again.
// probeFormat: bumped when what the child records changes, so every module
// is probed again (2: waits on is_loading).
const probeFormat = "2"

func screenKey(m ModuleInfo) string {
	// every file of the module two levels deep, by name, size and time: a
	// new build, and also ROMs added to roms/ (a module that found none
	// published less), probe it again
	h := fnv.New64a()
	fmt.Fprint(h, buildVersion, "/p", probeFormat)
	// A module installed from the catalog is a link to its folder, and
	// WalkDir does not follow the link it starts at: the key was the same
	// whatever the folder held, so an updated module was never probed again
	// and kept the parameters of the version before (found 2026-11-18).
	dir := m.Dir
	if real, err := filepath.EvalSymlinks(dir); err == nil {
		dir = real
	}
	filepath.WalkDir(dir, func(p string, e fs.DirEntry, err error) error { //nolint:errcheck
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		if e.IsDir() && rel != "." && strings.Count(rel, string(filepath.Separator)) >= 1 {
			return filepath.SkipDir
		}
		if fi, err := e.Info(); err == nil && !e.IsDir() {
			fmt.Fprintf(h, "|%s:%d:%d", rel, fi.Size(), fi.ModTime().Unix())
		}
		return nil
	})
	return fmt.Sprintf("%x", h.Sum64())
}

// screenModules marks every module whose probe crashes in a child process as
// not loadable.
func (h *Host) screenModules(mods []ModuleInfo) []ModuleInfo {
	exe, err := os.Executable()
	if err != nil {
		return mods
	}
	cachePath := filepath.Join(h.dataDir, "module-screen.json")
	cache := map[string]screenVerdict{}
	if raw, err := os.ReadFile(cachePath); err == nil {
		json.Unmarshal(raw, &cache) //nolint:errcheck
	}
	var todo []int
	for i, m := range mods {
		if !m.Loadable {
			continue
		}
		if v, ok := cache[m.ID]; ok && v.Key == screenKey(m) && (!v.OK || v.Probe != nil) {
			continue // known, and (if good) recorded
		}
		todo = append(todo, i)
	}
	if len(todo) > 0 {
		log.Printf("modules: probing %d new or changed module(s) in child processes", len(todo))
	}
	var mu sync.Mutex
	probe := func(i int) {
		m := mods[i]
		v := runProbeChild(exe, h.modulesDir, m)
		v.Key = screenKey(m)
		mu.Lock()
		cache[m.ID] = v
		mu.Unlock()
	}
	jobs, alone := make(chan int), make(chan int, len(todo))
	var wg sync.WaitGroup
	for w := 0; w < screenWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				probe(i)
			}
		}()
	}
	wg.Add(1)
	go func() { // the emulators, one after another (probeAlone)
		defer wg.Done()
		for i := range alone {
			probe(i)
		}
	}()
	for _, i := range todo {
		if probeAlone(mods[i]) {
			alone <- i
		} else {
			jobs <- i
		}
	}
	close(jobs)
	close(alone)
	wg.Wait()

	// forget modules that are gone
	present := map[string]bool{}
	for _, m := range mods {
		present[m.ID] = true
	}
	for id := range cache {
		if !present[id] {
			delete(cache, id)
		}
	}
	keep := map[string]screenVerdict{}
	for id, v := range cache {
		if !v.Timeout { // a timeout is tried again at the next start
			keep[id] = v
		}
	}
	if raw, err := json.MarshalIndent(keep, "", " "); err == nil {
		os.WriteFile(cachePath, raw, 0o644) //nolint:errcheck
	}
	screenMu.Lock()
	screenResults = cache
	screenMu.Unlock()
	out := append([]ModuleInfo(nil), mods...)
	for i, m := range out {
		if v, ok := cache[m.ID]; ok && !v.OK && m.Loadable {
			log.Printf("modules: %s left out: %s", m.ID, v.Why)
			out[i].Loadable = false
		}
	}
	return out
}

// runProbeChild probes one module in a child process group: the module may
// start processes of its own (an emulator's DSP), and a timeout kills them all.
func runProbeChild(exe, modulesDir string, m ModuleInfo) screenVerdict {
	f, err := os.CreateTemp("", "pung-probe-*.json")
	if err != nil {
		return screenVerdict{OK: false, Why: err.Error()}
	}
	out := f.Name()
	f.Close()
	defer os.Remove(out)
	cmd := exec.Command(exe, "-probe-module", m.ID, "-probe-out", out, "-modules", modulesDir, "-data", os.TempDir())
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	if err := cmd.Start(); err != nil {
		return screenVerdict{OK: false, Why: err.Error()}
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var werr error
	select {
	case werr = <-done:
	case <-time.After(screenTimeout):
		syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) //nolint:errcheck
		<-done
		return screenVerdict{OK: false, Timeout: true, Why: fmt.Sprintf("its probe did not finish in %v", screenTimeout)}
	}
	syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) //nolint:errcheck // whatever it left running
	if werr != nil {
		return screenVerdict{OK: false, Why: fmt.Sprintf("its probe failed (%v): %s", werr, lastLine(buf.Bytes()))}
	}
	var rec probeRecord
	raw, err := os.ReadFile(out)
	if err != nil || json.Unmarshal(raw, &rec) != nil || rec.Meta == nil {
		return screenVerdict{OK: false, Why: "its probe wrote no metadata: " + lastLine(buf.Bytes())}
	}
	return screenVerdict{OK: true, Probe: &rec}
}

// probeRecordFor: the child's record of a module, if it has one.
func probeRecordFor(id string) *probeRecord {
	screenMu.Lock()
	defer screenMu.Unlock()
	if v, ok := screenResults[id]; ok && v.OK {
		return v.Probe
	}
	return nil
}

// screenReport: the verdicts, for GET /api/modules/screen.
func screenReport() map[string]any {
	screenMu.Lock()
	defer screenMu.Unlock()
	var bad []map[string]string
	ok := 0
	for id, v := range screenResults {
		if v.OK {
			ok++
		} else {
			bad = append(bad, map[string]string{"id": id, "why": v.Why})
		}
	}
	sort.Slice(bad, func(i, j int) bool { return bad[i]["id"] < bad[j]["id"] })
	return map[string]any{"ok": ok, "left_out": bad}
}

func lastLine(b []byte) string {
	s := string(b)
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '\n' {
			s = s[i+1:]
			break
		}
	}
	if len(s) > 200 {
		s = s[len(s)-200:]
	}
	return s
}

// probeModuleMain is the child: load one module in a hidden chain instance,
// wait until it is ready, record what buildMeta reads and every parameter's
// value, write that to out. Exit 0: recorded; 3: not; a crash is the crash.
func probeModuleMain(h *Host, id, out string) {
	var m ModuleInfo
	found := false
	for _, x := range scanModules(h.modulesDir) {
		if x.ID == id {
			m, found = x, true
		}
	}
	if !found {
		fmt.Println("no such module")
		os.Exit(3)
	}
	const probe = maxSlots - 1
	if err := cSlotCreate(probe); err != nil {
		fmt.Println(err)
		os.Exit(3)
	}
	prefix := probePrefix(m)
	cSet(probe, prefix+":module", m.ID)
	get := func(k string) (string, bool) { return cGet(probe, prefix+":"+k) }

	waited, status := waitModuleReady(get)
	rec := probeRecord{Meta: map[string]string{}, Initial: map[string]string{},
		Waited: waited, Status: status}
	cm := buildMeta(m.ID, func(k string) (string, bool) {
		v, ok := get(k)
		if ok {
			rec.Meta[k] = v
		}
		return v, ok
	})
	if cm != nil {
		for _, k := range cm.Order {
			if v, ok := get(k); ok && v != "" {
				rec.Initial[k] = v
			}
		}
	}
	cSet(probe, prefix+":module", "") // unload: its own processes end with it
	raw, _ := json.Marshal(rec)
	if err := os.WriteFile(out, raw, 0o644); err != nil {
		fmt.Println(err)
		os.Exit(3)
	}
	n := 0
	if cm != nil {
		n = len(cm.Params)
	}
	fmt.Printf("ok: %d parameters, ready after %.1f s (%s)\n", n, rec.Waited, status)
	os.Exit(0)
}

// waitModuleReady waits until a module in a hidden instance has finished
// loading, and says how long that took and its last loading status.
func waitModuleReady(get func(string) (string, bool)) (float64, string) {
	// Ready: Schwung's own signal first, is_loading "1" while a module loads
	// (the shadow UI's component gate waits on it; JV-880 and JP-8000 answer
	// it, and a load ERROR is not loading). Else a loading_status that says it
	// is done (Osirus: "Ready: ..."). And the parameter list the same twice in
	// a row: a module that answers -1 until it is up has no list yet.
	start := time.Now()
	status := ""
	prev, _ := get("chain_params")
	for time.Since(start) < probeReadyWait {
		time.Sleep(500 * time.Millisecond)
		cur, curOK := get("chain_params")
		settled := true
		if il, ok := get("is_loading"); ok && strings.TrimSpace(il) == "1" {
			settled = false
		} else if st, ok := get("loading_status"); ok && st != "" {
			status = st
			l := strings.ToLower(st)
			settled = strings.Contains(l, "ready") || strings.Contains(l, "loaded") || strings.Contains(l, "error") ||
				strings.Contains(l, "fail") || strings.Contains(l, "not found") || strings.Contains(l, "missing")
		}
		if settled && curOK && cur == prev {
			break
		}
		prev = cur
	}
	return time.Since(start).Seconds(), status
}

func probePrefix(m ModuleInfo) string {
	switch m.Type {
	case "audio_fx":
		return "fx1"
	case "midi_fx":
		return "midi_fx1"
	}
	return "synth"
}
