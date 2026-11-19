package main

// classlock.go: a class's parameter layout stays what Live loaded while Live
// runs on.
//
// Live reads the class file (livedevice.ClassesPath) when it starts, and
// knows a parameter by its position in it. Pung writes the file when it
// starts. Pung restarted with a new layout while Live ran on (an update,
// 0.1.3's fitLive for Mini-JV and JE-8086) used to serve the new positions
// to a Live that had the old: the Pung view showed Mini-JV in Performance
// mode, part 4, while it was in Patch, part 0, and a knob turned through
// Live wrote another parameter (measured, 2026-11-15).
//
// So when Live runs and is not about to restart, a class whose layout
// changed keeps the one Live has, for the devices it serves and in the file
// (a Live restart then loads the same, so the two never disagree). The new
// layout lands at the next start without Live running (a reboot: Pung starts
// before Live), or with an Apply, which restarts Live right after.
// Which layout Live has: the file, if Live started after it was written;
// else the copy kept when this Live started (classes.live.json).

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

const liveExe = "/opt/push3/Live"

// liveStarted: when the running Live started; false when none runs.
func liveStarted() (time.Time, bool) {
	ents, err := os.ReadDir("/proc")
	if err != nil {
		return time.Time{}, false
	}
	boot := bootTime()
	for _, e := range ents {
		if _, err := strconv.Atoi(e.Name()); err != nil {
			continue
		}
		cmd, err := os.ReadFile(filepath.Join("/proc", e.Name(), "cmdline"))
		if err != nil || !strings.HasPrefix(string(cmd), liveExe+"\x00") {
			continue
		}
		stat, err := os.ReadFile(filepath.Join("/proc", e.Name(), "stat"))
		if err != nil {
			continue
		}
		// after the command name (which may hold spaces): field 22 is the start, in ticks since boot
		s := string(stat)
		if i := strings.LastIndexByte(s, ')'); i >= 0 {
			f := strings.Fields(s[i+1:])
			if len(f) > 19 {
				if ticks, err := strconv.ParseInt(f[19], 10, 64); err == nil && !boot.IsZero() {
					return boot.Add(time.Duration(ticks) * time.Second / 100), true // USER_HZ 100
				}
			}
		}
	}
	return time.Time{}, false
}

func bootTime() time.Time {
	raw, err := os.ReadFile("/proc/stat")
	if err != nil {
		return time.Time{}
	}
	for _, l := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(l, "btime ") {
			if s, err := strconv.ParseInt(strings.TrimSpace(l[6:]), 10, 64); err == nil {
				return time.Unix(s, 0)
			}
		}
	}
	return time.Time{}
}

// liveLayout: what classes.live.json keeps.
type liveLayout struct {
	LiveStarted time.Time           `json:"live_started"`
	Classes     []*livedevice.Class `json:"classes"`
}

// layoutLiveHas reads the classes the running Live loaded (nil: no Live, or
// not known), keeping a copy for the next start while this Live runs.
func layoutLiveHas(classesPath, keep string, started time.Time) []*livedevice.Class {
	if fi, err := os.Stat(classesPath); err == nil && started.After(fi.ModTime()) {
		raw, err := os.ReadFile(classesPath)
		if err != nil {
			return nil
		}
		var f livedevice.ClassFile
		if json.Unmarshal(raw, &f) != nil {
			return nil
		}
		if doc, err := json.Marshal(liveLayout{LiveStarted: started, Classes: f.Classes}); err == nil {
			os.WriteFile(keep, doc, 0o644) //nolint:errcheck // without it the next start knows less, nothing breaks
		}
		return f.Classes
	}
	raw, err := os.ReadFile(keep)
	if err != nil {
		return nil
	}
	var l liveLayout
	if json.Unmarshal(raw, &l) != nil || !l.LiveStarted.Equal(started) {
		return nil // kept for another Live: what this one loaded is not known
	}
	return l.Classes
}

// sameLayout: two classes' parameters sit at the same positions.
func sameLayout(a, b *livedevice.Class) bool {
	if len(a.Params) != len(b.Params) {
		return false
	}
	for i := range a.Params {
		if a.Params[i].Key != b.Params[i].Key || a.Params[i].Type != b.Params[i].Type {
			return false
		}
	}
	return true
}

// keepLayout: sc with the parameter positions (and banks) of the class Live
// has, its keys' meaning taken from sc. A key Live has that the module no
// longer does is a parameter that does nothing.
func keepLayout(sc *sclass, live *livedevice.Class) *sclass {
	c := *sc.Class
	c.Params = append([]livedevice.Param(nil), live.Params...)
	c.Banks = live.Banks
	out := &sclass{Class: &c, module: sc.module, midiFX: sc.midiFX, inCh: sc.inCh, keyIdx: map[string]int{}}
	for i, p := range c.Params {
		var m *paramMeta
		role, gate := "", 0
		if j, ok := sc.keyIdx[p.Key]; ok && p.Key != "" {
			if j < len(sc.meta) {
				m = sc.meta[j]
			}
			if j < len(sc.role) {
				role = sc.role[j]
			}
			if j < len(sc.gateIdx) {
				gate = sc.gateIdx[j]
			}
		}
		out.meta, out.role, out.gateIdx = append(out.meta, m), append(out.role, role), append(out.gateIdx, gate)
		if p.Key != "" {
			out.keyIdx[p.Key] = i
		}
	}
	seen := map[int]bool{}
	for _, b := range c.Banks {
		for _, i := range b {
			if !seen[i] && i < len(c.Params) && len(out.order) < 128 {
				seen[i] = true
				out.order = append(out.order, i)
			}
		}
	}
	return out
}

// lockLayouts: the classes to serve and write, given what Live has (nil: as
// built). Returns the names of the classes that keep Live's layout.
func lockLayouts(classes []*sclass, live []*livedevice.Class) ([]*sclass, []string) {
	if live == nil {
		return classes, nil
	}
	byUID := map[string]*livedevice.Class{}
	for _, c := range live {
		byUID[c.UID] = c
	}
	var kept []string
	out := make([]*sclass, len(classes))
	for i, sc := range classes {
		out[i] = sc
		if lc := byUID[sc.UID]; lc != nil && !sameLayout(sc.Class, lc) {
			out[i] = keepLayout(sc, lc)
			kept = append(kept, sc.Name)
		}
	}
	return out, kept
}

// classesForLive: buildClasses' classes, with the layouts Live has kept while
// Live runs on (see the top of the file).
func classesForLive(classes []*sclass, classesPath, keep string, liveRestartComing bool) []*sclass {
	started, running := liveStarted()
	if !running || liveRestartComing {
		os.Remove(keep)
		return classes
	}
	out, kept := lockLayouts(classes, layoutLiveHas(classesPath, keep, started))
	if len(kept) > 0 {
		log.Printf("devices: %s keep the parameter layout Live has; the new one comes with the next reboot or Apply", strings.Join(kept, ", "))
	}
	return out
}

// watchLive gives the surface back to Live when Live quits or starts again
// while Pung holds it. Live's own questions at a start ("Would you like to
// recover your work?") are answered with the buttons under its screen, and
// Pung held them: neither a hand nor restart-live.sh's press could answer,
// and Live waited (2026-11-15).
func (u *surface) watchLive(done <-chan struct{}) {
	last, _ := liveStarted()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-done:
			return
		case <-t.C:
		}
		now, running := liveStarted()
		if running && now.Equal(last) {
			continue
		}
		last = now
		if u.focused.Load() {
			if err := u.pm.SurfaceLeave("live"); err != nil {
				log.Printf("surface: Live restarts, and giving it the surface failed: %v", err)
			} else {
				log.Printf("surface: Live restarts: the surface is Live's")
			}
		}
		// ... and while a device's surface app holds it (handover.go): the
		// app does not know that Live went. Its buttons were not Live's, and
		// Live's question at the start could not be answered (2026-11-19).
		// (any installed module's surface app: Pung itself may have started
		// again since it handed the Push over, as an Apply does)
		app := surfaceOwner(u.pm.Base)
		mine := false
		for _, m := range scanModules(u.h.modulesDir) {
			mine = mine || (app != "" && m.SurfaceApp == app)
		}
		if mine {
			if err := leaveFor(u.pm.Base, app); err != nil {
				log.Printf("surface: Live restarts, and taking the surface from %s failed: %v", app, err)
			} else {
				log.Printf("surface: Live restarts: the surface is Live's (it was %s's)", app)
			}
		}
	}
}
