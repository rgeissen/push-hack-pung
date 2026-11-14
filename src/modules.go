package main

// modules.go: the installed Schwung modules, read from the module tree in
// Schwung's own layout (sound_generators/, audio_fx/, midi_fx/), which is
// the layout the chain host resolves module names against.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
}

var moduleCategories = map[string]string{
	"sound_generators": "sound_generator",
	"audio_fx":         "audio_fx",
	"midi_fx":          "midi_fx",
}

func scanModules(root string) []ModuleInfo {
	var out []ModuleInfo
	for cat, typ := range moduleCategories {
		entries, _ := os.ReadDir(filepath.Join(root, cat))
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			dir := filepath.Join(root, cat, e.Name())
			raw, err := os.ReadFile(filepath.Join(dir, "module.json"))
			if err != nil {
				continue
			}
			var m struct {
				ID, Name, Abbrev, Version, Author, Description string
				DSP                                            string `json:"dsp"`
				ComponentType                                  string `json:"component_type"`
			}
			if json.Unmarshal(raw, &m) != nil || m.ID == "" {
				continue
			}
			if m.ComponentType == "system" {
				continue // internal (the midi-sink): never offered to the user
			}
			info := ModuleInfo{ID: m.ID, Name: m.Name, Abbrev: m.Abbrev, Type: typ, Version: m.Version,
				Author: m.Author, Description: m.Description, Dir: dir}
			if info.Name == "" {
				info.Name = m.ID
			}
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
