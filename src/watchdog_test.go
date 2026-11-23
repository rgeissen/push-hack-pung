//go:build linux

package main

import (
	"strings"
	"testing"
	"time"
)

// A call is a hang only well past what that call ever takes; the first such
// slot is named with its module.
func TestFindHang(t *testing.T) {
	calls := map[int]slotCall{
		2: {op: callSet, key: "synth:module", ran: 60 * time.Second}, // a module loading: not yet
		5: {op: callRender, ran: 2 * time.Second},
		7: {op: callGet, key: "synth:state", ran: 3 * time.Second},
	}
	callOf := func(i int) slotCall { return calls[i] }
	moduleOf := func(i int) string { return map[int]string{2: "ostirus", 5: "xenia", 7: "helm", 9: "vavra"}[i] }
	if x, ok := findHang(callOf, moduleOf); ok {
		t.Fatalf("no call ran past its limit, but %v", x)
	}
	calls[9] = slotCall{op: callDestroy, ran: 91 * time.Second}
	x, ok := findHang(callOf, moduleOf)
	if !ok || x.slot != 9 || x.module != "vavra" {
		t.Fatalf("a destroy past 90 s: %v %v", x, ok)
	}
	if s := x.String(); !strings.Contains(s, "vavra") || !strings.Contains(s, "destroy") {
		t.Errorf("logged as %q", s)
	}
	calls[5] = slotCall{op: callRender, ran: 6 * time.Second}
	if x, _ := findHang(callOf, moduleOf); x.slot != 5 {
		t.Errorf("a block that takes 6 s is a hang: %v", x)
	}
	if hangLimit(callSet, "synth:cutoff") >= hangLimit(callSet, "load_patch") {
		t.Error("a parameter may run as long as a module load")
	}
}

// A module that hangs twice within hangMemory is left out until the first of
// those two is that old; once is forgiven; the log survives a restart.
func TestHangLogLeavesOutARepeatedHang(t *testing.T) {
	dir, now := t.TempDir(), time.Now()
	l := loadHangLog(dir)
	l.add("ostirus", now.Add(-20*time.Minute)) // too long ago to count
	l.add("ostirus", now.Add(-5*time.Minute))
	if _, out := l.leftOut("ostirus", now); out {
		t.Fatal("one hang within the window left the module out")
	}
	l.add("ostirus", now)
	l = loadHangLog(dir) // the next Pung reads it
	until, out := l.leftOut("ostirus", now)
	if !out {
		t.Fatal("two hangs in 15 minutes: still offered")
	}
	if want := now.Add(-5 * time.Minute).Add(hangMemory); !until.Equal(want) {
		t.Errorf("left out until %v, want %v", until, want)
	}
	if _, out := l.leftOut("ostirus", until.Add(time.Second)); out {
		t.Error("still left out after the window")
	}
	if _, out := l.leftOut("xenia", now); out {
		t.Error("another module left out")
	}
}
