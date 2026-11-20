package main

// lockboost_linux.go: a thread holding a slot's lock is not left behind.
//
// The engine and the device threads (SCHED_FIFO 70) take a slot's lock every
// block and never sleep for it: they spin briefly, then give the block up
// (Slot.acquire). The Pung view, the web page and Live's parameter sync hold
// the same lock from Pung's ordinary threads, at nice 19 (the service runs
// Pung niced). Beside an emulator that keeps cores busy (OsTIrus' DSP
// threads, SCHED_FIFO 45 or nice -10), such a holder waited for a core in
// the middle of a microsecond's get_param, and Live played silence: with
// the Pung view open on OsTIrus, a dropped block every five seconds
// (2026-11-20). Go's mutexes inherit no priority, so the holder lifts its
// own thread for the call: nice -15, ahead of every ordinary thread and the
// emulator's, and no realtime at all (realtime here would count against the
// 95% a core gives realtime threads, which the emulators already approach:
// tried, and it made the drops worse).

import (
	"runtime"
	"syscall"
)

const lockNice = -15

// lockBoost raises the calling thread to nice lockNice until the returned
// func is called, then puts back the nice it had.
func lockBoost() (restore func()) {
	runtime.LockOSThread() // nests: a goroutine locked before stays locked after
	raw, err := syscall.Getpriority(syscall.PRIO_PROCESS, 0)
	prev := 20 - raw // the raw syscall answers 20 - nice
	if err != nil || prev <= lockNice || syscall.Setpriority(syscall.PRIO_PROCESS, 0, lockNice) != nil {
		return runtime.UnlockOSThread
	}
	return func() {
		syscall.Setpriority(syscall.PRIO_PROCESS, 0, prev)
		runtime.UnlockOSThread()
	}
}
