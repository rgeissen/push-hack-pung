package main

import (
	"net"
	"testing"
	"time"
)

// A port still held by a stopping Pung is waited for, not given up on
// (2026-11-22: the new Pung found it taken and exited).
func TestListenWaitsForThePort(t *testing.T) {
	old, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := old.Addr().String()
	go func() { time.Sleep(600 * time.Millisecond); old.Close() }() // the old Pung goes
	start := time.Now()
	ln := listenWaiting(addr, 5*time.Second)
	defer ln.Close()
	if d := time.Since(start); d < 500*time.Millisecond {
		t.Errorf("got the port after %v, while the old one still held it", d)
	}
}
