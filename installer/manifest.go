package main

// manifest.go: what to install, from pung.live/install.json (site/install.json):
// the Pung release, and the Push Hack release tested with it. A new tested
// pair needs no new installer; one day the Push Hack line goes.

import (
	"encoding/json"
	"os"
)

type manifest struct {
	Pung struct {
		Release  string `json:"release"`
		Fallback string `json:"fallback"`
	} `json:"pung"`
	PushHack struct {
		Ref     string `json:"ref"`     // a tag of federico-pepe/ableton-push-hack
		Version string `json:"version"` // as Push Manager reports it
	} `json:"push_hack"`
	Installer struct {
		Version  string `json:"version"`
		Download string `json:"download"`
	} `json:"installer"`
}

const manifestURL = "https://pung.live/install.json"

// defaults: what this installer was made with, if pung.live cannot be read
func defaultManifest() manifest {
	var m manifest
	m.Pung.Release = "https://pung.live/release.json"
	m.Pung.Fallback = "https://raw.githubusercontent.com/rgeissen/push-hack-pung/main/release.json"
	m.PushHack.Ref = "v0.2.0-alpha"
	m.PushHack.Version = "0.2.0-alpha"
	return m
}

func loadManifest() (manifest, bool) {
	m := defaultManifest()
	u := manifestURL
	if v := os.Getenv("PUNG_INSTALL_JSON"); v != "" { // a test's own
		u = v
	}
	b, err := fetch(u, 1<<20)
	if err != nil {
		return m, false
	}
	var got manifest
	if json.Unmarshal(b, &got) != nil {
		return m, false
	}
	if got.Pung.Release != "" {
		m.Pung = got.Pung
	}
	if got.PushHack.Ref != "" {
		m.PushHack = got.PushHack
	}
	m.Installer = got.Installer
	return m, true
}
