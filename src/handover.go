package main

// handover.go -- a device whose whole surface is another app's.
//
// A module can have a surface that Pung's device view cannot be: its own
// screen, the pads, every button, gestures of its own (Stacks: a staff, chord
// pads, three pad pages, edit keys). That surface exists as a Push Hack app.
// The module names it (module.json "pung": {"surface_app": "stacks"}), and
// opening the device hands the Push to that app, told which device to edit:
//
//	POST http://127.0.0.1:<app's port>/api/bind
//	     {"base": Pung, "device": n, "component": "midi_fx1", "name": ...}
//
// then Pung leaves the surface and push-manager opens the app. The app's own
// way back to Live ends it; Pung stands in for the device view again as for
// any of its devices. The app not installed or not running: nothing is
// handed over and Pung's own view of the device opens, as for any module.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// pungPort: where this Pung answers (main sets it from hack.json).
var pungPort = 7720

// surfaceAppPort: the port of an installed, enabled Push Hack app, or 0.
func surfaceAppPort(app string) int {
	exe, err := os.Executable()
	if err != nil {
		return 0
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(filepath.Dir(exe)), app, "hack.json"))
	if err != nil {
		return 0
	}
	var j struct {
		Port    int   `json:"port"`
		Enabled *bool `json:"enabled"`
	}
	if json.Unmarshal(raw, &j) != nil || (j.Enabled != nil && !*j.Enabled) {
		return 0
	}
	return j.Port
}

// handOver gives the Push to the selected device's surface app, if its
// module names one that is installed. true: it is on its way, and Pung's
// own view of the device does not open. Caller holds u.mu.
func (u *surface) handOver() bool {
	p, _, _ := u.currentBank()
	if p.Module == "" || u.pm == nil || time.Since(u.handedAt) < 2*time.Second {
		return false
	}
	mi, ok := findModule(u.h.modulesDir, p.Module)
	if !ok || mi.SurfaceApp == "" {
		return false
	}
	port := surfaceAppPort(mi.SurfaceApp)
	d, prefix := u.pungDevice()
	n, _ := u.h.selectedDevice()
	if port == 0 || d == nil || n < 0 {
		return false
	}
	name := p.Name
	if tr, _ := u.live.state().trackHeader(); tr != "" {
		name = tr
	}
	u.handedAt = time.Now()
	app, pm := mi.SurfaceApp, u.pm
	go func() {
		hc := &http.Client{Timeout: 2 * time.Second}
		post := func(url string, body any) error {
			b, _ := json.Marshal(body)
			resp, err := hc.Post(url, "application/json", bytes.NewReader(b))
			if err != nil {
				return err
			}
			resp.Body.Close()
			if resp.StatusCode >= 300 {
				return fmt.Errorf("%s", resp.Status)
			}
			return nil
		}
		err := post(fmt.Sprintf("http://127.0.0.1:%d/api/bind", port), map[string]any{
			"base": fmt.Sprintf("http://127.0.0.1:%d", pungPort), "device": n, "component": prefix, "name": name, "open": false})
		if err == nil {
			if err = pm.SurfaceLeave("home"); err == nil {
				err = post(pm.Base+"/api/surface/open", map[string]any{"id": app})
			}
		}
		if err != nil {
			log.Printf("handover to %s: %v", app, err)
			u.mu.Lock()
			u.handedAt = time.Time{}
			u.say("COULD NOT OPEN " + mi.Name + "'S OWN SURFACE|" + err.Error())
			u.mu.Unlock()
			u.dirty.Store(true)
		}
	}()
	return true
}

// surfaceOwner: the app that has the Push now, as push-manager says, or "".
func surfaceOwner(pmBase string) string {
	hc := &http.Client{Timeout: time.Second}
	resp, err := hc.Get(pmBase + "/api/surface")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var j struct {
		Owner string `json:"owner"`
		App   string `json:"app"`
	}
	if json.NewDecoder(resp.Body).Decode(&j) != nil || j.Owner != "app" {
		return ""
	}
	return j.App
}

// leaveFor gives the surface an app holds back to Live, in its name.
func leaveFor(pmBase, app string) error {
	b, _ := json.Marshal(map[string]string{"app": app, "to": "live"})
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Post(pmBase+"/api/surface/leave", "application/json", bytes.NewReader(b))
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s", resp.Status)
	}
	return nil
}
