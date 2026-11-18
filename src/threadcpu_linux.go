package main

import (
	"syscall"
	"time"
)

// threadCPU: the processor time the calling thread has used. The caller has
// locked itself to its thread (runtime.LockOSThread).
func threadCPU() time.Duration {
	var ru syscall.Rusage
	if syscall.Getrusage(1 /* RUSAGE_THREAD */, &ru) != nil {
		return 0
	}
	return time.Duration(ru.Utime.Nano() + ru.Stime.Nano())
}
