package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// A device's state across a restart of Pung.
//
// Live's plugin keeps the state Live last asked for (when the Set was saved,
// a device copied) and gives it to the device again when Pung comes back
// after a restart. Everything done to the device since was gone: Mini-JV on
// a performance came back on patch 1 after an update (measured on the Push,
// 2026-11-16).
//
// So a Pung that stops writes each device's state as it is, filed under the
// state Live's plugin holds for it. The Pung that starts next gives a device
// the kept state when the plugin hands it that same held state, and only
//
//   - while Live is the same process (a Live that restarted loads the Set,
//     and the Set's state is the truth then), and
//   - in the first moments after the start, when the plugins reconnect (a
//     Set loaded again later in the same Live means its saved state).
//
// The plugin goes on holding the old state, so the device remembers it
// (liveKey) and the next stop files the newer state under it again.
//
// A kept state no device took is filed again at the next stop, while it is
// still the same Live: its device may not have come at all this time (its
// module left out after a probe ran out of time, and the next restart lost
// OsTIrus's sound to Live's last saved one, 2026-11-21).

const keptStatesFile = "kept-states.json"

// keptWindow: how long after its start a Pung honours kept states. Live's
// plugins reconnect within a second or two of the socket being there.
const keptWindow = 45 * time.Second

type keptEntry struct {
	Key    string `json:"key"`    // stateKey of what Live's plugin holds
	Module string `json:"module"` // the device's module: a state never crosses modules
	State  string `json:"state"`  // the device's state when Pung stopped
}

type keptFile struct {
	Live    string      `json:"live"` // liveIdentity when written
	Entries []keptEntry `json:"entries"`
}

type keptStates struct {
	mu      sync.Mutex
	entries []keptEntry // not taken yet
	until   time.Time
	live    string // the Live they were kept for
}

func stateKey(state string) string {
	h := sha256.Sum256([]byte(state))
	return hex.EncodeToString(h[:12])
}

// loadKeptStates reads what the Pung before this one kept, once: the file is
// removed, so a crash or a later start never meets an old one.
func loadKeptStates(dir, live string, now time.Time) *keptStates {
	k := &keptStates{}
	path := filepath.Join(dir, keptStatesFile)
	raw, err := os.ReadFile(path)
	if err != nil {
		return k
	}
	os.Remove(path)
	var f keptFile
	if json.Unmarshal(raw, &f) != nil || live == "" || f.Live != live {
		return k // another Live (or none known): the Set's states are the truth
	}
	k.entries, k.until, k.live = f.Entries, now.Add(keptWindow), f.Live
	return k
}

// take: the state kept for a device of module whose plugin holds held, once.
func (k *keptStates) take(held, module string, now time.Time) (string, bool) {
	if k == nil {
		return "", false
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if now.After(k.until) {
		return "", false // too late to be a reconnect (still filed again: untaken)
	}
	key := stateKey(held)
	for i, e := range k.entries {
		if e.Key == key && e.Module == module {
			k.entries = append(k.entries[:i], k.entries[i+1:]...)
			return e.State, true
		}
	}
	return "", false
}

// untaken: the kept states no device took, if live is still the Live they
// were kept for.
func (k *keptStates) untaken(live string) []keptEntry {
	if k == nil || live == "" || k.live != live {
		return nil
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	return append([]keptEntry(nil), k.entries...)
}

// writeKeptStates files the devices' states for the Pung that starts next.
func writeKeptStates(dir, live string, entries []keptEntry) error {
	path := filepath.Join(dir, keptStatesFile)
	if live == "" || len(entries) == 0 {
		os.Remove(path)
		return nil
	}
	raw, err := json.Marshal(keptFile{Live: live, Entries: entries})
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// keepStates: at a stop, every device's state as it is now.
func (p *provider) keepStates() {
	var entries []keptEntry
	for _, d := range p.list() {
		d.liveMu.Lock()
		key := d.liveKey
		d.liveMu.Unlock()
		if key == "" {
			key = stateKey("") // Live's plugin holds no state for it (adoptKept)
		}
		st, err := d.currentState()
		if err != nil {
			log.Printf("%s: its state is not kept across the restart: %v", d.c.Name, err)
			continue
		}
		entries = append(entries, keptEntry{Key: key, Module: d.c.module, State: st})
	}
	live := liveIdentity()
	devices, carried := len(entries), 0
	for _, e := range p.kept.untaken(live) {
		dup := false
		for _, c := range entries[:devices] {
			dup = dup || c.Key == e.Key && c.Module == e.Module
		}
		if !dup {
			entries = append(entries, e)
			carried++
		}
	}
	if err := writeKeptStates(p.h.dataDir, live, entries); err != nil {
		log.Printf("keeping the devices' states across the restart: %v", err)
	} else if len(entries) > 0 {
		log.Printf("kept the state of %d device(s) for the next start (%d of them from the start before, never taken)", len(entries), carried)
	}
}

// liveIdentity names the running Live: its pid and when it started. "" when
// Live is not running.
func liveIdentity() string {
	procs, _ := filepath.Glob("/proc/[0-9]*")
	for _, dir := range procs {
		exe, err := os.Readlink(filepath.Join(dir, "exe"))
		if err != nil || filepath.Base(exe) != "Live" {
			continue
		}
		stat, err := os.ReadFile(filepath.Join(dir, "stat"))
		if err != nil {
			continue
		}
		// after the last ")": state is field 3, starttime field 22
		s := string(stat)
		f := strings.Fields(s[strings.LastIndexByte(s, ')')+1:])
		if len(f) > 19 {
			return filepath.Base(dir) + "@" + f[19]
		}
	}
	return ""
}
