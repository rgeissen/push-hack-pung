package main

// procs.go: processes modules fork must not outlive Pung.
//
// A module may fork (JE-8086 runs its emulator in three forked DSP stages).
// Those children are Pung's, named "pung", and nothing ended them when Pung
// stopped: a SIGTERM did not reach them, and a SIGKILL never does. Three of
// them from a Pung started at 10:47 were still running at 11:10 (2026-11-15),
// through five restarts: burning CPU, and holding JE-8086's one-per-device
// lock, so every new JE-8086 device was refused.
//
// So Pung leads its own process group, ends what is left of it when it
// stops, and at start ends the orphans of an earlier Pung (its own binary,
// adopted by init), which a SIGKILL'd Pung leaves behind.

import (
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// leadProcessGroup: Pung's children (and theirs) are one group with it.
func leadProcessGroup() {
	if err := syscall.Setpgid(0, 0); err != nil {
		log.Printf("procs: own process group: %v", err)
	}
}

type procInfo struct {
	pid, ppid, pgid int
	comm, exe       string
}

func listProcs() []procInfo {
	if onMac {
		return macListProcs()
	}
	ents, _ := os.ReadDir("/proc")
	var out []procInfo
	for _, e := range ents {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		stat, err := os.ReadFile(filepath.Join("/proc", e.Name(), "stat"))
		if err != nil {
			continue
		}
		// pid (comm) state ppid pgrp ...; comm may hold spaces, so after the last ')'
		s := string(stat)
		i := strings.LastIndexByte(s, ')')
		j := strings.IndexByte(s, '(')
		if i < 0 || j < 0 {
			continue
		}
		f := strings.Fields(s[i+1:])
		if len(f) < 3 {
			continue
		}
		p := procInfo{pid: pid, comm: s[j+1 : i]}
		p.ppid, _ = strconv.Atoi(f[1])
		p.pgid, _ = strconv.Atoi(f[2])
		exe, _ := os.Readlink(filepath.Join("/proc", e.Name(), "exe"))
		p.exe = strings.TrimSuffix(exe, " (deleted)") // a binary replaced by a deploy
		out = append(out, p)
	}
	return out
}

// killOrphans ends every other process of this binary: what an earlier
// Pung's modules forked, left when it was killed. Run at start, before Pung
// forks anything (Pung is one service; a second copy is a stale one). Not
// "adopted by init" only: a whole tree is found at once, and its children
// still had their parent when it was looked at (2026-11-15).
func killOrphans(exe string) {
	self := os.Getpid()
	for _, p := range listProcs() {
		if p.pid == self || p.exe != exe {
			continue
		}
		log.Printf("procs: ending pid %d (%s), left by an earlier Pung", p.pid, p.comm)
		syscall.Kill(p.pid, syscall.SIGKILL) //nolint:errcheck
	}
}

// killGroup ends what is left of Pung's process group: run last, after
// every module was unloaded and had its chance to end its own children.
func killGroup() {
	self := os.Getpid()
	for _, p := range listProcs() {
		if p.pid != self && p.pgid == self {
			log.Printf("procs: ending pid %d (%s), still running at stop", p.pid, p.comm)
			syscall.Kill(p.pid, syscall.SIGKILL) //nolint:errcheck
		}
	}
}
