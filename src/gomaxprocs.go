package main

import (
	"os"
	"runtime"
)

// realtimeProcs: Go's processors (Ps) for a Pung whose realtime threads must
// never wait for one.
//
// Every Pung device in Live is served by its own thread at SCHED_FIFO 70
// (livedevice.Server.run). It sleeps in a futex between blocks and, woken,
// needs a P to run Go again. With GOMAXPROCS at the core count (4 on a
// Push) the Ps were often all held by Pung's ordinary goroutines (the
// view, the web page, the GC), on threads at nice 19, and with an emulator
// keeping cores busy those threads could not run to give one back: the
// device thread waited past its half block and Live played silence. 48
// dropped blocks in 50 s with OsTIrus playing beside Braids, 2 with
// GOMAXPROCS=32 and nothing else changed (measured 2026-11-20).
//
// Idle Ps cost a few kilobytes each and never spin. A GOMAXPROCS given in
// the environment still wins.
const realtimeProcs = 32

func setProcs() {
	if os.Getenv("GOMAXPROCS") == "" && runtime.GOMAXPROCS(0) < realtimeProcs {
		runtime.GOMAXPROCS(realtimeProcs)
	}
}
