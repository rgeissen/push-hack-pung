package main

// watchdog.go: a module that never comes back from a call no longer leaves
// Pung hung until someone restarts it.
//
// In 8 days of the Push's log (to 2026-11-23) no module crashed Pung, but
// emulators hung it four times while they booted or shut down (OsTIrus in
// "Destroying instance" for seven minutes, 2026-11-21): every device silent,
// the Pung view frozen, until a reboot. The bridge marks each call into a
// chain with its start (bridge.c, sb_call_since); once a second the watchdog
// looks for one that has run far longer than any call does. Then Pung starts
// again as the same process, the way an Apply does but without the stop,
// which would wait for the hung call too: the devices' states are filed
// while Pung runs (keptstate.go), so every sound comes back but the last
// seconds'. Live keeps running; its devices say "Pung restarting" and
// reconnect.
//
// A module that hangs twice within hangMemory is left out until then (its
// devices are refused), so one that always hangs on load does not restart
// Pung over and over.

/*
#include "bridge.h"
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

// the calls bridge.c marks (SB_CALL_*)
const (
	callCreate  = int(C.SB_CALL_CREATE)
	callDestroy = int(C.SB_CALL_DESTROY)
	callSet     = int(C.SB_CALL_SET)
	callGet     = int(C.SB_CALL_GET)
	callMidi    = int(C.SB_CALL_MIDI)
	callRender  = int(C.SB_CALL_RENDER)
	callWarm    = int(C.SB_CALL_WARM)
)

const (
	hangMemory  = 15 * time.Minute // how long a hang is held against its module
	hangsToStop = 2                // hangs within hangMemory that leave a module out
	hangsFile   = "hangs.json"
)

// hangLimit: how long a call may run before it is a hang. Far above any call
// measured: a module load or an emulator's destroy takes seconds, a
// parameter milliseconds, a block well under one.
func hangLimit(op int, key string) time.Duration {
	switch op {
	case callCreate, callDestroy, callWarm:
		return 90 * time.Second
	case callSet:
		if heavyKey(key) || strings.HasSuffix(key, ":module") {
			return 90 * time.Second // a module loading
		}
		return 30 * time.Second // a sound going into an emulator
	case callRender, callMidi:
		return 5 * time.Second
	}
	return 15 * time.Second
}

var callNames = map[int]string{callCreate: "create", callDestroy: "destroy", callSet: "set",
	callGet: "get", callMidi: "midi", callRender: "render", callWarm: "warm-up"}

// slotCall: the call slot is in, how long it has run (0: none).
type slotCall struct {
	op  int
	key string
	ran time.Duration
}

func cCallSince(slot int) slotCall {
	var op C.int
	var key [48]C.char
	ns := C.sb_call_since(C.int(slot), &op, &key[0], C.int(len(key)))
	if ns <= 0 {
		return slotCall{}
	}
	return slotCall{op: int(op), key: C.GoString((*C.char)(unsafe.Pointer(&key[0]))), ran: time.Duration(ns)}
}

// hung: a slot whose call ran past its limit.
type hung struct {
	slot   int
	module string // "" if not known
	call   slotCall
}

func (h hung) String() string {
	what := callNames[h.call.op]
	if h.call.key != "" {
		what += " " + h.call.key
	}
	who := h.module
	if who == "" {
		who = fmt.Sprintf("chain %d", h.slot+1)
	}
	return fmt.Sprintf("%s has not come back from %s for %s", who, what, h.call.ran.Round(time.Second))
}

// findHang: the first slot whose call ran past its limit.
func findHang(callOf func(int) slotCall, moduleOf func(int) string) (hung, bool) {
	for i := 0; i < maxSlots; i++ {
		c := callOf(i)
		if c.ran > 0 && c.ran > hangLimit(c.op, c.key) {
			return hung{slot: i, module: moduleOf(i), call: c}, true
		}
	}
	return hung{}, false
}

// moduleOfSlot: the module a slot runs, from what Pung knows (never a call
// into the chain, which may be the one hung).
func (h *Host) moduleOfSlot(i int) string {
	if h.prov != nil {
		h.prov.mu.Lock()
		d := h.prov.devs[i]
		h.prov.mu.Unlock()
		if d != nil {
			return d.c.module
		}
	}
	if i == maxSlots-1 {
		return "" // the metadata probe: which module it reads is not kept
	}
	if s := h.slot(i); s != nil {
		return s.Name
	}
	return ""
}

// watchdog runs until stop. onHang is what a hang does (restartAfterHang).
func (h *Host) watchdog(stop <-chan struct{}, onHang func(hung)) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			if x, ok := findHang(cCallSince, h.moduleOfSlot); ok {
				onHang(x)
				return
			}
		}
	}
}

// leaveSurface: gives the surface back to Live, once the surface is up
var leaveSurface atomic.Pointer[func()]

// restartAfterHang: the hang recorded, the surface given back, what modules
// started ended, and Pung started again as the same process. No module is
// called: the hung one holds its chain's lock.
func (h *Host) restartAfterHang(x hung, exe string, leave *func()) {
	log.Printf("watchdog: %s: Pung starts again (the devices' states are kept)", x)
	if x.module != "" {
		h.hangs.add(x.module, time.Now())
	}
	if leave != nil && *leave != nil {
		done := make(chan struct{})
		go func() { (*leave)(); close(done) }()
		select {
		case <-done:
		case <-time.After(time.Second):
		}
	}
	killGroup()
	if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
		log.Fatalf("watchdog: starting again: %v", err)
	}
}

// hangLog: the hangs of the last hangMemory, kept across the restart.
type hangLog struct {
	mu   sync.Mutex
	path string
	list []hangEntry
}

type hangEntry struct {
	Module string    `json:"module"`
	At     time.Time `json:"at"`
}

func loadHangLog(dir string) *hangLog {
	l := &hangLog{path: filepath.Join(dir, hangsFile)}
	if raw, err := os.ReadFile(l.path); err == nil {
		json.Unmarshal(raw, &l.list) //nolint:errcheck
	}
	return l
}

func (l *hangLog) add(module string, at time.Time) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.list = append(l.recent(at), hangEntry{Module: module, At: at})
	raw, _ := json.Marshal(l.list)
	tmp := l.path + ".tmp"
	if os.WriteFile(tmp, raw, 0o644) == nil {
		os.Rename(tmp, l.path) //nolint:errcheck
	}
}

// recent: the hangs within hangMemory of now. Caller holds mu.
func (l *hangLog) recent(now time.Time) []hangEntry {
	var out []hangEntry
	for _, e := range l.list {
		if now.Sub(e.At) < hangMemory {
			out = append(out, e)
		}
	}
	return out
}

// leftOut: whether module hung often enough lately to be refused, and until when.
func (l *hangLog) leftOut(module string, now time.Time) (time.Time, bool) {
	if l == nil {
		return time.Time{}, false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	var at []time.Time
	for _, e := range l.recent(now) {
		if e.Module == module {
			at = append(at, e.At)
		}
	}
	if len(at) < hangsToStop {
		return time.Time{}, false
	}
	return at[len(at)-hangsToStop].Add(hangMemory), true
}
