package main

// modroutes.go: the Modules page's API (modmgr.go), Apply (Pung starts again,
// then Live), and the Live classes of removed modules (retired).

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// restartCh: Apply asks main to stop and start again (main.go).
var restartCh = make(chan struct{}, 1)

const restartLiveFlag = "restart-live-after-start"

func (mm *modMgr) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/catalog", func(w http.ResponseWriter, r *http.Request) {
		mm.catalog(r.URL.Query().Get("refresh") == "1")
		v := mm.view()
		v["apply"] = mm.lastApply()
		writeJSON(w, 200, v)
	})
	mux.HandleFunc("POST /api/catalog/{id}/install", func(w http.ResponseWriter, r *http.Request) {
		if err := mm.enqueue(r.PathValue("id")); err != nil {
			fail(w, 409, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/catalog/{id}/remove", func(w http.ResponseWriter, r *http.Request) {
		if err := mm.remove(r.PathValue("id")); err != nil {
			fail(w, 409, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("GET /api/catalog/{id}/assets", func(w http.ResponseWriter, r *http.Request) {
		inst, ok := mm.installed()[r.PathValue("id")]
		if !ok {
			fail(w, 404, "%s is not installed", r.PathValue("id"))
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "assets": assetStates(inst.Dir)})
	})
	mux.HandleFunc("PUT /api/catalog/{id}/assets/{path}/{name}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		stored, err := mm.addAsset(id, r.PathValue("path"), r.PathValue("name"), r.Body)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		res := map[string]any{"ok": true, "stored_as": stored}
		// everything it needs is there now: its devices load it again
		if inst, ok := mm.installed()[id]; ok {
			missing := 0
			for _, a := range assetStates(inst.Dir) {
				missing += a.Missing
			}
			res["missing"] = missing
			if missing == 0 {
				res["reloaded"] = mm.reloadDevices(id)
			}
		}
		writeJSON(w, 200, res)
	})
	mux.HandleFunc("DELETE /api/catalog/{id}/assets/{path}/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := mm.removeAsset(r.PathValue("id"), r.PathValue("path"), r.PathValue("name")); err != nil {
			fail(w, 400, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/catalog/apply", func(w http.ResponseWriter, r *http.Request) {
		if err := mm.apply(); err != nil {
			fail(w, 409, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
}

// apply: Pung starts again (the classes change) and then restarts Live (it
// scans plugins only when it starts). Live recovers the Set.
func (mm *modMgr) apply() error {
	mm.mu.Lock()
	for _, j := range mm.jobs {
		if j.State != "done" && j.State != "failed" {
			mm.mu.Unlock()
			return fmt.Errorf("%s is still being installed", j.ID)
		}
	}
	if mm.restarting {
		mm.mu.Unlock()
		return nil
	}
	mm.restarting = true
	mm.mu.Unlock()
	writeFileAtomic(mm.path(restartLiveFlag), []byte(time.Now().Format(time.RFC3339)))
	log.Printf("modules: apply: Pung starts again, then Live")
	go func() {
		time.Sleep(300 * time.Millisecond) // the answer reaches the page first
		select {
		case restartCh <- struct{}{}:
		default:
		}
	}()
	return nil
}

var applyMu sync.Mutex
var applyResult map[string]any

func (mm *modMgr) lastApply() map[string]any {
	applyMu.Lock()
	defer applyMu.Unlock()
	return applyResult
}

// afterStart: an Apply that started this Pung restarts Live now that the new
// classes are written, and clears what it applied.
func (mm *modMgr) afterStart(base string) {
	flag := mm.path(restartLiveFlag)
	if !exists(flag) {
		return
	}
	os.Remove(flag)
	mm.mu.Lock()
	applied := mm.pending
	mm.pending = nil
	mm.mu.Unlock()
	os.Remove(mm.path("pending-changes.json"))
	set := func(m map[string]any) {
		applyMu.Lock()
		applyResult = m
		applyMu.Unlock()
	}
	set(map[string]any{"state": "restarting-live", "applied": applied, "at": time.Now()})
	go func() {
		// the devices' states as they are, for the Set Live recovers (keptstate.go)
		if mm.h.prov != nil {
			if n := mm.h.prov.armForLiveRestart(2 * time.Minute); n > 0 {
				log.Printf("modules: apply: the state of %d device(s) kept for the Set Live recovers", n)
			}
		}
		script := filepath.Join(base, "restart-live.sh")
		out, err := exec.Command("/bin/sh", script).CombinedOutput()
		tail := strings.TrimSpace(string(out))
		if i := strings.LastIndex(tail, "\n"); i >= 0 {
			tail = tail[i+1:]
		}
		log.Printf("modules: apply: %s", strings.ReplaceAll(strings.TrimSpace(string(out)), "\n", " | "))
		m := map[string]any{"state": "done", "applied": applied, "at": time.Now(), "message": tail}
		if err != nil {
			m["state"], m["error"] = "failed", tail
		}
		set(m)
	}()
}

// ---- retired classes ---------------------------------------------------------------

// withRetired: the classes of modules that were removed stay in the class
// file, so Live keeps knowing them: a Set that used one opens (the device is
// silent), and Live's recovery, which replays the Set's history, does not
// crash on a plugin class that is gone. Known classes are kept in
// <data>/classes-known.json.
func withRetired(dataDir string, current []*livedevice.Class) []*livedevice.Class {
	p := filepath.Join(dataDir, "classes-known.json")
	var known []*livedevice.Class
	if raw, err := os.ReadFile(p); err == nil {
		json.Unmarshal(raw, &known) //nolint:errcheck
	}
	have := map[string]bool{}
	for _, c := range current {
		have[c.UID] = true
	}
	out := append([]*livedevice.Class(nil), current...)
	retired := 0
	for _, c := range known {
		if c != nil && !have[c.UID] && c.Check() == nil {
			out = append(out, c)
			have[c.UID] = true
			retired++
		}
	}
	if retired > 0 {
		log.Printf("devices: %d class(es) of removed modules stay known to Live", retired)
	}
	raw, _ := json.Marshal(out)
	writeFileAtomic(p, raw)
	return out
}
