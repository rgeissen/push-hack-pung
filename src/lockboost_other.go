//go:build !linux

package main

// lockBoost: no per-thread nice here (tests on another system).
func lockBoost() (restore func()) { return func() {} }

// unniceThreads: nothing to do here.
func unniceThreads() {}
