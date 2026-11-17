package main

// userdata.go: where Schwung modules expect Pung to be.
//
// Modules are written for Move, where Pung lives in /data/UserData/schwung,
// and 41 of the catalog's repos name that path in their DSP code: presets,
// ROMs, caches, logs, shared files. Push 3 has no /data/UserData at all, so
// those reads and writes failed in silence (Osirus's diagnostics, 2026-11-15).
// Pung links /data/UserData/schwung to its own folder at start. It never
// replaces anything already there, except a link whose target is gone.

import (
	"log"
	"os"
	"path/filepath"
)

var moveSchwungDir = "/data/UserData/schwung"

func ensureMovePungLink(pungDir string) {
	if fi, err := os.Lstat(moveSchwungDir); err == nil {
		dangling := false
		if fi.Mode()&os.ModeSymlink != 0 {
			if t, _ := os.Readlink(moveSchwungDir); t == pungDir {
				return
			}
			_, err := os.Stat(moveSchwungDir)
			dangling = err != nil // its target is gone (a moved install): ours to replace
		}
		if !dangling {
			log.Printf("userdata: %s exists and is not Pung's link; left as it is", moveSchwungDir)
			return
		}
		os.Remove(moveSchwungDir)
	}
	if err := os.MkdirAll(filepath.Dir(moveSchwungDir), 0o755); err != nil {
		log.Printf("userdata: %v", err)
		return
	}
	if err := os.Symlink(pungDir, moveSchwungDir); err != nil {
		log.Printf("userdata: %v", err)
		return
	}
	log.Printf("userdata: %s -> %s (where Schwung modules look)", moveSchwungDir, pungDir)
}
