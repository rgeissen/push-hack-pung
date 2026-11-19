package main

// modules.go: the installed Schwung modules, read from the module tree in
// Schwung's own layout (sound_generators/, audio_fx/, midi_fx/), which is
// the layout the chain host resolves module names against.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type ModuleInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Abbrev      string `json:"abbrev,omitempty"`
	Type        string `json:"type"` // sound_generator | audio_fx | midi_fx
	Version     string `json:"version,omitempty"`
	Author      string `json:"author,omitempty"`
	Description string `json:"description,omitempty"`
	Dir         string `json:"-"`
	WebUI       bool   `json:"web_ui"`
	Help        bool   `json:"help"`
	Loadable    bool   `json:"loadable"` // its DSP file is present
	// Origin: "pung" for a module written for the Push (native/, its
	// module.json says "origin": "pung"), else "schwung": one built from a
	// Schwung module. The web page shows which is which.
	Origin string `json:"origin"`
	// SurfaceApp: a Push Hack app that is this module's whole surface on
	// Push (module.json "pung": {"surface_app": "stacks"}): its own screen,
	// pads and buttons. Opening the device hands the Push to it, and it edits
	// this device (handover.go). Not installed: Pung's own view of the device.
	SurfaceApp string `json:"surface_app,omitempty"`
	// Forks: its sound is computed in processes of its own
	// (capabilities.forks_processes: JE-8086). They take their scheduling
	// from the thread that loads the module (engine.go: cSet)
	Forks bool `json:"-"`
}

var moduleCategories = map[string]string{
	"sound_generators": "sound_generator",
	"audio_fx":         "audio_fx",
	"midi_fx":          "midi_fx",
}

// scanModules: the modules under root. The view asks for a module many times
// a frame (findModule), and reading the tree means a ReadDir and a JSON
// parse per module: with 30 modules installed that was more than half of
// Pung's own processor time, and the lag between a knob and the screen
// (profiled on a Push, 2026-11-18). The answer is kept while the category
// folders are unchanged (a module added or removed changes one), and read
// again after two seconds in any case (a module.json edited in place).
func scanModules(root string) []ModuleInfo {
	sig := ""
	for _, cat := range []string{"audio_fx", "midi_fx", "sound_generators"} { // in one order: a map's changes
		if fi, err := os.Stat(filepath.Join(root, cat)); err == nil {
			sig += fmt.Sprintf("%s:%d;", cat, fi.ModTime().UnixNano())
		}
	}
	scanMu.Lock()
	defer scanMu.Unlock()
	if c, ok := scanCache[root]; ok && c.sig == sig && time.Since(c.at) < 2*time.Second {
		return append([]ModuleInfo(nil), c.mods...)
	}
	mods := scanModulesNow(root)
	if scanCache == nil || len(scanCache) > 32 {
		scanCache = map[string]scanned{}
	}
	scanCache[root] = scanned{sig: sig, at: time.Now(), mods: mods}
	return append([]ModuleInfo(nil), mods...)
}

type scanned struct {
	sig  string
	at   time.Time
	mods []ModuleInfo
}

var (
	scanMu    sync.Mutex
	scanCache map[string]scanned
)

func scanModulesNow(root string) []ModuleInfo {
	var out []ModuleInfo
	for cat, typ := range moduleCategories {
		entries, _ := os.ReadDir(filepath.Join(root, cat))
		for _, e := range entries {
			dir := filepath.Join(root, cat, e.Name())
			// a module from the catalog is a link into Pung's data (modmgr.go)
			if fi, err := os.Stat(dir); err != nil || !fi.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(dir, "module.json"))
			if err != nil {
				continue
			}
			var m struct {
				ID, Name, Abbrev, Version, Author, Description string
				DSP                                            string `json:"dsp"`
				Origin                                         string `json:"origin"`
				Pung                                           struct {
					SurfaceApp string `json:"surface_app"`
				} `json:"pung"`
				ComponentType                                  string `json:"component_type"`
				Capabilities                                   struct {
					Forks bool `json:"forks_processes"`
				} `json:"capabilities"`
			}
			if json.Unmarshal(raw, &m) != nil || m.ID == "" {
				continue
			}
			if m.ComponentType == "system" {
				continue // internal (the midi-sink): never offered to the user
			}
			info := ModuleInfo{ID: m.ID, Name: m.Name, Abbrev: m.Abbrev, Type: typ, Version: m.Version,
				Author: m.Author, Description: m.Description, Dir: dir, Forks: m.Capabilities.Forks}
			if info.Name == "" {
				info.Name = m.ID
			}
			info.Origin = "schwung"
			if m.Origin == "pung" {
				info.Origin = "pung"
			}
			info.SurfaceApp = m.Pung.SurfaceApp
			info.WebUI = exists(filepath.Join(dir, "web_ui.html"))
			info.Help = exists(filepath.Join(dir, "help.json"))
			// the chain host loads audio_fx/<id>/<id>.so and dsp.so for the rest
			if typ == "audio_fx" {
				info.Loadable = exists(filepath.Join(dir, m.ID+".so")) || exists(filepath.Join(dir, "dsp.so"))
			} else {
				info.Loadable = exists(filepath.Join(dir, "dsp.so"))
			}
			out = append(out, info)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type < out[j].Type
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

func findModule(root, id string) (ModuleInfo, bool) {
	for _, m := range scanModules(root) {
		if m.ID == id {
			return m, true
		}
	}
	return ModuleInfo{}, false
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }
