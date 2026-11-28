//go:build !darwin

package main

import "time"

// sysread_other.go: a Mac's readings (sysread_darwin.go) exist only on a Mac.
// The callers ask onMac first; these stand in so that they compile elsewhere.

func macProcCPU(pid int) (time.Duration, bool)                       { return 0, false }
func macSystemCPU() (busy, background, total time.Duration, ok bool) { return 0, 0, 0, false }
func macThreadCPUs() map[int]govThread                               { return nil }
func macListProcs() []procInfo                                       { return nil }
func macMeminfo() (total, avail int64)                               { return 0, 0 }
func macBattery() map[string]any                                     { return nil }
func macOSRelease() (name, version string)                           { return "", "" }
