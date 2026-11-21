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
	"os"
	"runtime"
	"strconv"
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

// ordinaryNice: the nice Pung's ordinary threads run at, whatever the
// service started it with (push-catalog's template starts hacks at nice 19).
//
// The devices' realtime threads depend on them: a collection stops only when
// every thread has reached it, and a realtime goroutine the scheduler took
// off its processor runs again only once an ordinary thread hands one back.
// At nice 19, beside Live and an emulator, those threads waited milliseconds
// for a core and Live played silence. Playing OsTIrus for two minutes,
// 2026-11-21: 5 late blocks at nice 19, 2 at nice 0, the longest collector
// pause 2.5 ms against 1.2 ms. Realtime threads keep their own scheduling.
const ordinaryNice = 0

// unniceThreads lifts every thread of Pung's that is niced below
// ordinaryNice. Called first thing in main: the threads made after it
// inherit their maker's nice.
func unniceThreads() {
	ents, err := os.ReadDir("/proc/self/task")
	if err != nil {
		return
	}
	for _, e := range ents {
		tid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		raw, err := syscall.Getpriority(syscall.PRIO_PROCESS, tid)
		if err == nil && 20-raw > ordinaryNice {
			syscall.Setpriority(syscall.PRIO_PROCESS, tid, ordinaryNice)
		}
	}
}
