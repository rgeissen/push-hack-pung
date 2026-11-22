package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/alsaseq"
	"github.com/federico-pepe/ableton-push-hack/core/push3"
)

// A Pung synth picked in Push's browser opens in Pung's view.
//
// Push keeps its browser open after Load (to try the next sound), and Pung
// stands in for Push's device view only once Push shows it again
// (push-manager's devview.go), so a synth loaded with Add or Swap stayed in
// Push's browser until the user closed it. The user's word (2026-11-22): "If
// I select another synth I would expect that the browser closes". So when
// Live makes a new Pung device and selects it while Push is not in its
// device view (its browser: on a standalone Push that is the only way a
// device is made), Pung presses Device View on Push's behalf: the browser
// closes, Push shows its device view, and push-manager hands it to Pung as
// always.
//
// Not when a Set loads (many devices at once, or Pung just started), not
// when push-manager is not there, and only once per device.

var browserClose = struct {
	sync.Mutex
	started time.Time
	recent  []time.Time
}{started: time.Now()}

// browserCloseQuiet: devices made within this of Pung's start are a Set
// loading, not a pick in the browser.
const browserCloseQuiet = 20 * time.Second

// newDeviceMade: Live made a Pung device (provider.New). It waits for Live to
// select it and closes Push's browser if it is still open.
func newDeviceMade(name string) {
	now := time.Now()
	browserClose.Lock()
	if now.Sub(browserClose.started) < browserCloseQuiet {
		browserClose.Unlock()
		return
	}
	// two devices within a second: a Set or a rack of several, not a pick
	keep := browserClose.recent[:0]
	for _, t := range browserClose.recent {
		if now.Sub(t) < 2*time.Second {
			keep = append(keep, t)
		}
	}
	browserClose.recent = append(keep, now)
	several := len(browserClose.recent) > 1
	browserClose.Unlock()
	if several {
		return
	}
	go closeBrowserFor(name, now)
}

// pmSurface: what push-manager says of the surface: who has it, and its
// device view's view of Push and Live (devview.go's status).
type pmSurface struct {
	Owner      string `json:"owner"`
	App        string `json:"app"`
	DeviceView struct {
		App      string `json:"app"`       // the app whose device is selected
		PushView string `json:"push_view"` // "device" while Push shows its device view
		Selected string `json:"selected"`
		Key      string `json:"key"`
	} `json:"device_view"`
}

var pmHTTP = &http.Client{Timeout: 700 * time.Millisecond}

func readPMSurface() (pmSurface, bool) {
	var s pmSurface
	r, err := pmHTTP.Get("http://127.0.0.1:7701/api/surface")
	if err != nil {
		return s, false
	}
	defer r.Body.Close()
	return s, json.NewDecoder(r.Body).Decode(&s) == nil
}

// closeBrowserFor: for up to 4 s, until Live has selected a Pung device it
// had not selected when this one was made: then, if Push is still not in
// its device view and nobody but Live has the surface, Device View.
func closeBrowserFor(name string, made time.Time) {
	before, ok := readPMSurface()
	if !ok {
		return // no push-manager: nothing to hand over to
	}
	for time.Since(made) < 4*time.Second {
		time.Sleep(120 * time.Millisecond)
		s, ok := readPMSurface()
		if !ok {
			return
		}
		// the new device selected: Live's selection names it, or (a rack
		// around it, named by its preset) the selection moved. A Swap
		// replaces the device where it stands, and push-manager's key (from
		// Live's selection topic, which does not fire again) stays the old
		// one: only the name says it (2026-11-22, Braids swapped for JE-8086)
		named := s.DeviceView.Selected == name && before.DeviceView.Selected != name
		moved := s.DeviceView.Key != "" && s.DeviceView.Key != before.DeviceView.Key
		if s.DeviceView.App != "pung" || !(named || moved) {
			continue // not (yet) the new device selected
		}
		if s.DeviceView.PushView == "device" || s.Owner != "outside" {
			return // Push shows its device view (push-manager takes it from here), or an app has the surface
		}
		pressOnPush(push3.CCDeviceView)
		log.Printf("surface: %s picked in Push's browser: the browser closes for Pung's view", name)
		return
	}
}

// pushSeq: the surface's sequencer client (surface.go: attach), the one
// Pung's "+" presses Add with.
var pushSeq atomic.Pointer[alsaseq.Client]

// pressOnPush: a button pressed and let go on Push's own input, as Pung's
// "+" presses Add (surface.go: addDevice).
func pressOnPush(cc uint8) {
	c := pushSeq.Load()
	p, ok := alsaseq.FindByName("Ableton Internal Input", alsaseq.CapWrite)
	if c == nil || !ok {
		return
	}
	c.SendCC(p.Addr, 0, cc, 127) //nolint:errcheck
	time.Sleep(40 * time.Millisecond)
	c.SendCC(p.Addr, 0, cc, 0) //nolint:errcheck
}
