package main

// scout.go: the names of a list whose module names only the sound it has
// loaded.
//
// Schwung's order for a list's names is a bulk read, a read per index, else
// the current name only (sounds_source.go). Hera, Braids, Dexed, OB-Xd and
// Osirus are of the third kind: a fresh device's list was 56 rows of numbers
// with one name, and a row got its name only once it had been played
// (reported 2026-11-16). Stepping the user's own device through its list
// would change its sound, so a second, hidden instance of the module does
// it: a child process (`pung -scout-job <file>`, as the start's probe is,
// screen.go) loads the module, chooses the device's bank, steps the list and
// writes each name down. A module that crashes or hangs there takes nothing
// with it, and its list is learned as it is heard, as before.
//
// The names are kept in the module's index, so a list is walked once.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	// scoutMaxCount: a longer list is not walked (the modules with thousands
	// of sounds name them themselves).
	scoutMaxCount = 2048
	scoutTimeout  = probeReadyWait + 60*time.Second
	// scoutRetry: a walk that failed (the module was busy, its bank not there
	// yet) is tried again after this, scoutTries times in all.
	scoutRetry = 30 * time.Second
	scoutTries = 3
)

// scoutJob: what the child is asked.
type scoutJob struct {
	Module string     `json:"module"`
	Prefix string     `json:"prefix"` // the component in the chain: synth | fx1 | midi_fx1
	List   presetList `json:"list"`
	Count  int        `json:"count"`
	// Set: keys written before the walk, in order: the mode, the bank
	Set [][2]string `json:"set,omitempty"`
	// Bank: the bank's name the device shows ("" unknown): the child's must
	// be the same before it walks
	Bank    string `json:"bank,omitempty"`
	BankKey string `json:"bank_key,omitempty"`
}

type scoutResult struct {
	Names []string `json:"names"`
	Why   string   `json:"why,omitempty"`
	// a survey's answers (soundsSurvey): which way the module names its list
	Bulk   bool `json:"bulk,omitempty"`
	NameAt bool `json:"name_at,omitempty"`
}

// scoutSem: one walk at a time.
var scoutSem = make(chan struct{}, 1) // (a survey runs its children itself)

// scoutExe: the binary a walk runs (tests replace it).
var scoutExe = func() (string, error) { return os.Executable() }

// scoutJobFor: the walk that names the device's list as it is now.
func (lib *soundLib) scoutJobFor(d *device, pl presetList, fv *factoryView) scoutJob {
	job := scoutJob{Module: d.c.module, Prefix: d.c.component(), List: pl, Count: fv.Count, Bank: fv.Bank, BankKey: pl.BankName}
	if job.BankKey == "" {
		job.BankKey = "bank_name"
	}
	get := lib.getter(d)
	// the bank as the module itself names it: the chooser's row may read
	// otherwise (Dexed: the row "Dexed_01.syx", bank_name "Dexed_01"), and
	// the hidden instance is compared on the same key
	job.Bank = ""
	if v, ok := get(job.BankKey); ok && !isSentinelName(v) {
		job.Bank = strings.TrimSpace(v)
	}
	if cm := lib.meta(d); cm != nil && cm.ModeParam != "" {
		if v, ok := get(cm.ModeParam); ok {
			job.Set = append(job.Set, [2]string{cm.ModeParam, strings.TrimSpace(v)})
		}
	}
	switch {
	case pl.BankItems != "" && !pl.Jump:
		at := fv.BankAt
		if at < 0 {
			for _, r := range fv.Banks {
				if r.Name == fv.Bank {
					at = r.Index
				}
			}
		}
		if at >= 0 {
			job.Set = append(job.Set, [2]string{pl.BankSelect, fmt.Sprint(at)})
		}
	default:
		for _, k := range pl.BankKeys {
			if v, ok := get(k); ok {
				job.Set = append(job.Set, [2]string{k, strings.TrimSpace(v)})
			}
		}
	}
	return job
}

// scout walks the list in a child and keeps its names. The names are used
// only where they name the device's current sound as the device does.
func (lib *soundLib) scout(d *device, pl presetList, fv *factoryView, key string) bool {
	job := lib.scoutJobFor(d, pl, fv)
	scoutSem <- struct{}{}
	defer func() { <-scoutSem }()
	start := time.Now()
	res, err := runScoutChild(lib.h.modulesDir, job)
	if err != nil {
		log.Printf("sounds: %s: its list was not walked: %v", d.c.module, err)
		return false
	}
	if len(res.Names) != fv.Count {
		log.Printf("sounds: %s: its list was not walked: %d names for %d sounds", d.c.module, len(res.Names), fv.Count)
		return false
	}
	if fv.Index >= 0 && fv.Index < len(res.Names) && fv.Name != "" && strings.TrimSpace(res.Names[fv.Index]) != fv.Name {
		log.Printf("sounds: %s: the walk named sound %d %q, the device %q: not kept", d.c.module, fv.Index+1, res.Names[fv.Index], fv.Name)
		return false
	}
	lib.storeNames(d.c.module, key, 0, res.Names)
	log.Printf("sounds: %s: %d names read from a hidden instance in %.1f s (%s)", d.c.module, len(res.Names), time.Since(start).Seconds(), key)
	return true
}

func runScoutChild(modulesDir string, job scoutJob) (*scoutResult, error) {
	exe, err := scoutExe()
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "pung-scout-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	in, out := dir+"/job.json", dir+"/names.json"
	raw, _ := json.Marshal(job)
	if err := os.WriteFile(in, raw, 0o644); err != nil {
		return nil, err
	}
	cmd := exec.Command(exe, "-scout-job", in, "-scout-out", out, "-modules", modulesDir, "-data", dir)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var werr error
	select {
	case werr = <-done:
	case <-time.After(scoutTimeout):
		syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) //nolint:errcheck
		<-done
		return nil, fmt.Errorf("it did not finish in %v", scoutTimeout)
	}
	syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) //nolint:errcheck // whatever it left running
	var res scoutResult
	if raw, err := os.ReadFile(out); err == nil && json.Unmarshal(raw, &res) == nil {
		if res.Why != "" {
			return nil, fmt.Errorf("%s", res.Why)
		}
		if werr == nil {
			return &res, nil
		}
	}
	if werr != nil {
		return nil, fmt.Errorf("%v: %s", werr, lastLine(buf.Bytes()))
	}
	return nil, fmt.Errorf("it wrote no names: %s", lastLine(buf.Bytes()))
}

// scoutChain: the hidden instance, as the walk sees it (tests give their own).
type scoutChain struct {
	set func(key, val string)
	get func(key string) (string, bool)
	// pause: wait for a module that answers in its own time
	pause func(d time.Duration)
}

// walkNames steps the list and reads each sound's name. A module applies a
// choice at once or in its own time (an emulated synth): the index is read
// back first, and a name that is still the sound before's is waited on for
// a moment, since two sounds in a row may share one.
func walkNames(c scoutChain, job scoutJob) ([]string, error) {
	pl := job.List
	if pl.List == "" || pl.Name == "" {
		return nil, fmt.Errorf("the list has no name key")
	}
	for _, kv := range job.Set {
		c.set(kv[0], kv[1])
	}
	// the list as the device has it: its length, and its bank's name
	ok := false
	for try := 0; try < 100 && !ok; try++ {
		n, has := pl.count(c.get)
		if job.Count < 0 && has && n > 0 {
			job.Count = n // a survey: the list as the hidden instance has it
		}
		ok = has && n == job.Count
		if ok && job.Bank != "" {
			if b, has := c.get(job.BankKey); has && !isSentinelName(b) && strings.TrimSpace(b) != job.Bank {
				ok = false
			}
		}
		if !ok {
			c.pause(100 * time.Millisecond)
		}
	}
	if !ok {
		n, _ := pl.count(c.get)
		b, _ := c.get(job.BankKey)
		return nil, fmt.Errorf("the hidden instance has %d sounds in %q, the device %d in %q", n, strings.TrimSpace(b), job.Count, job.Bank)
	}
	names := make([]string, 0, job.Count)
	prev := ""
	for i := 0; i < job.Count; i++ {
		c.set(pl.List, pl.value(i))
		name := ""
		for try := 0; try < 20; try++ {
			at := -1
			if v, ok := c.get(pl.List); ok {
				if x, ok := pl.currentIndex(v); ok {
					at = x
				}
			}
			v, has := c.get(pl.Name)
			if at == i && has && !isSentinelName(v) {
				name = strings.TrimSpace(v)
				// the sound before's name: maybe not this one's yet
				if i == 0 || name != prev || try >= 4 {
					break
				}
			}
			c.pause(25 * time.Millisecond)
		}
		names = append(names, name)
		prev = name
	}
	return names, nil
}

// scoutMain is the child: load the module in a hidden chain instance, wait
// until it is ready, walk the list, write the names. Exit 0 either way the
// result file says; a crash is the crash.
func scoutMain(h *Host, jobPath, out string) {
	write := func(res scoutResult) {
		raw, _ := json.Marshal(res)
		if err := os.WriteFile(out, raw, 0o644); err != nil {
			fmt.Println(err)
			os.Exit(3)
		}
	}
	var job scoutJob
	raw, err := os.ReadFile(jobPath)
	if err != nil || json.Unmarshal(raw, &job) != nil || job.Module == "" || job.Prefix == "" {
		write(scoutResult{Why: "bad job"})
		return
	}
	const probe = maxSlots - 1
	if err := cSlotCreate(probe); err != nil {
		write(scoutResult{Why: err.Error()})
		return
	}
	cSet(probe, job.Prefix+":module", job.Module)
	c := scoutChain{
		set:   func(k, v string) { cSet(probe, job.Prefix+":"+k, v) },
		get:   func(k string) (string, bool) { return cGet(probe, job.Prefix+":"+k) },
		pause: time.Sleep,
	}
	waitModuleReady(c.get)
	var res scoutResult
	if job.Count < 0 { // a survey: can the module name its list itself?
		if raw, ok := c.get(job.List.Bulk); ok && job.List.Bulk != "" {
			var all []string
			res.Bulk = json.Unmarshal([]byte(raw), &all) == nil && len(all) > 0
		}
		_, res.NameAt = job.List.nameAt(0, c.get)
	}
	names, err := walkNames(c, job)
	cSet(probe, job.Prefix+":module", "") // unload: its own processes end with it
	if err != nil {
		res.Why = err.Error()
		write(res)
		return
	}
	res.Names = names
	write(res)
	fmt.Printf("ok: %d names\n", len(names))
	os.Exit(0)
}

// warm: a new device's list is named before anyone opens it. The module may
// still be loading, and Live may hand the device a state (another bank), so
// the first look waits a moment; a module with no list is left alone.
func (lib *soundLib) warm(d *device) {
	time.Sleep(4 * time.Second)
	misses := 0
	for i := 0; i < 45; i++ {
		d.repMu.Lock()
		closed := d.closed
		d.repMu.Unlock()
		if closed {
			return
		}
		if !d.loading.Load() {
			fv, _, ok := lib.factory(d)
			if ok && fv.Count > 0 {
				return // factory asked for its names (fillNames)
			}
			if !ok {
				if misses++; misses >= 3 {
					return
				}
			}
		}
		time.Sleep(2 * time.Second)
	}
}

// soundsSurvey (pung -sounds-survey): every module of the tree that has a
// factory list, and how its names are read: by the module itself (options,
// a bulk read, a read per index) or by a walk, and what the walk found. One
// JSON line per list. For checking a build's modules; no device is needed.
func soundsSurvey(h *Host) {
	exe, _ := os.Executable()
	var mu sync.Mutex
	out := json.NewEncoder(os.Stdout)
	enc := encFunc(func(v any) error { mu.Lock(); defer mu.Unlock(); return out.Encode(v) })
	mods := make(chan ModuleInfo)
	var wg sync.WaitGroup
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for m := range mods {
				surveyModule(h, exe, m, enc)
			}
		}()
	}
	for _, m := range scanModules(h.modulesDir) {
		mods <- m
	}
	close(mods)
	wg.Wait()
}

type encFunc func(v any) error

func (f encFunc) Encode(v any) error { return f(v) }

func surveyModule(h *Host, exe string, m ModuleInfo, enc encFunc) {
	{
		row := map[string]any{"module": m.ID, "type": m.Type}
		v := runProbeChild(exe, h.modulesDir, m)
		if !v.OK || v.Probe == nil {
			row["probe"] = v.Why
			enc.Encode(row) //nolint:errcheck
			return
		}
		cm := buildMeta(m.ID, func(k string) (string, bool) { x, ok := v.Probe.Meta[k]; return x, ok })
		lists := factoryLists(cm, h.sounds.quirks[m.ID])
		if len(lists) == 0 {
			return
		}
		for _, pl := range lists {
			row := map[string]any{"module": m.ID, "mode": pl.Mode, "list": pl.List}
			if len(pl.Options) > 0 {
				row["how"], row["count"] = "options", len(pl.Options)
				enc.Encode(row) //nolint:errcheck
				continue
			}
			job := scoutJob{Module: m.ID, Prefix: probePrefix(m), List: pl, Count: -1, BankKey: "bank_name"}
			if cm.ModeParam != "" && pl.Mode != "" {
				job.Set = append(job.Set, [2]string{cm.ModeParam, pl.Mode})
			}
			start := time.Now()
			res, err := runScoutChild(h.modulesDir, job)
			row["seconds"] = fmt.Sprintf("%.1f", time.Since(start).Seconds())
			if err != nil {
				row["how"], row["why"] = "none", err.Error()
				enc.Encode(row) //nolint:errcheck
				continue
			}
			named, distinct := 0, map[string]bool{}
			for _, n := range res.Names {
				if n != "" {
					named++
					distinct[n] = true
				}
			}
			how := "walk"
			if res.Bulk {
				how = "bulk"
			} else if res.NameAt {
				how = "per index"
			}
			row["how"], row["count"], row["named"], row["distinct"] = how, len(res.Names), named, len(distinct)
			if len(res.Names) > 3 {
				row["first"] = res.Names[:3]
			}
			if len(pl.BankKeys) > 0 || pl.BankItems != "" {
				row["bank"] = map[string]any{"items": pl.BankItems, "select": pl.BankSelect, "jump": pl.Jump, "keys": pl.BankKeys}
			}
			enc.Encode(row) //nolint:errcheck
		}
	}
}
