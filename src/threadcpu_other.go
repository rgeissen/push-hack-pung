//go:build !linux

package main

import "time"

var threadCPUStart = time.Now()

// threadCPU: no per-thread clock here; the wall's (tests on another system).
func threadCPU() time.Duration { return time.Since(threadCPUStart) }
