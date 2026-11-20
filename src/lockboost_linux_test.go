package main

import (
	"runtime"
	"syscall"
	"testing"
)

func niceNow(t *testing.T) int {
	t.Helper()
	raw, err := syscall.Getpriority(syscall.PRIO_PROCESS, 0)
	if err != nil {
		t.Fatal(err)
	}
	return 20 - raw
}

// The holder's thread goes back to exactly the nice it had. Raising it
// needs root; where it is refused, nothing changes.
func TestLockBoostRestores(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	syscall.Setpriority(syscall.PRIO_PROCESS, 0, 19) // Pung's own, as the service starts it
	n0 := niceNow(t)
	restore := lockBoost()
	n1 := niceNow(t)
	restore()
	if n2 := niceNow(t); n2 != n0 {
		t.Fatalf("nice %d -> %d after the call", n0, n2)
	}
	if n1 != n0 && n1 != lockNice {
		t.Fatalf("held at nice %d", n1)
	}
	t.Logf("nice %d, held at %d", n0, n1)
}
