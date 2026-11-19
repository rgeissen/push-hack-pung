package main

// surface.go: the Pung view on the Push screen and its controls, an app of
// Push Hack Home that stands in for Push's device view while a Pung device
// is selected (Shift + Help opens Home; push-manager owns those gestures).
//
// It works as Push 3's own device view does (measured on a Push, standalone,
// 2026-11-16: docs/UX-GUIDELINES.md, "The controls"), on two levels:
//
//   chain level  upper row: the track's devices (the selected one filled; an
//                arrow at an end when there are more than fit)
//                lower row: Live's tracks
//   device open  upper row: button 1 goes back (< NAME)
//                lower row: the device's pages (an arrow when there are more)
//
//   a device's upper button   selects it; the selected one's opens and closes it
//   jog wheel                 chain level: moves a focus along the devices, its
//                             press opens the focused one; open: steps the
//                             pages, its press opens the sounds, nudge left
//                             goes back
//   encoders                  the 8 parameters over them, at both levels;
//                             Shift fine; Delete + touch: back to its default
//   Mute + a device's button  the device off and on; Delete + it: remove it
//   Mute / Solo + a track     that track
//   D-pad left / right        the previous / next track
//   Page < >                  the previous / next page (Pung's own shortcut)
//   upper button 8, open      SOUNDS: the device's sound browser (the jog
//                             press in an open device opens it too)
//   Save                      save the device's sound
//   Add, Swap                 Push's own: its browser, and its Hot-Swap,
//                             which can replace the device itself
//
// The pads and every button that plays, records or edits in Live stay
// Live's (liveButtons).

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/alsaseq"
	"github.com/federico-pepe/ableton-push-hack/core/pmclient"
	"github.com/federico-pepe/ableton-push-hack/core/push3"
)

type position struct {
	Kind     string // midi | synth | fx | add
	Prefix   string // midi_fx2 | synth | fx3
	N        int    // 1-based within its kind
	Module   string
	Name     string
	Bypassed bool
}

type surface struct {
	liveOut    liveOut // the shown sound's live frame, as this frame draws it (livehub.go); under mu
	liveDrew   bool    // this frame drew something live
	fxUsed     bool    // the last frame drew something live
	frameStats frameStats

	h    *Host
	pm   *pmclient.Client
	live *live

	c    *alsaseq.Client
	push alsaseq.Addr

	focused atomic.Bool
	dirty   atomic.Bool
	// standIn: push-manager opened the view in place of Push's device view
	// (pmclient.FocusInfo.DeviceView); its leaving buttons are push-manager's
	standIn atomic.Bool

	mu   sync.Mutex
	slot int // the colour the view is drawn in (always the first: one view)
	pos  int // the selected device, in positions
	bank int // the page shown
	// the two levels of Push's device view: open, the lower row is the
	// device's pages and upper button 1 goes back; closed, the upper row is
	// the track's devices and the lower row Live's tracks
	open    bool
	autoOpen bool // the selection is new: open it if its page is a front panel
	wheelAt  time.Time // the last step along the wheel key
	handedAt time.Time // the Push was handed to a device's surface app (handover.go)
	inner    bool      // the jog wheel is one level inside the open device: it walks the wheel key
	bankOff int // open: how far the page row is scrolled (pageSlots)
	devOff  int // closed: how far the device row is scrolled (deviceSlots)
	focus   int // closed: the device under the jog wheel (index in the track's devices), -1 none
	view    string
	shift   bool
	// held, with a display button or a touch: Delete, Mute, Solo. They are
	// Live's buttons too (liveButtons): Pung only reads them
	del, mute, solo bool
	combo           bool      // the held button was used with one of Pung's: its tap must not count in Live
	holdAt          time.Time // when Mute or Solo went down
	// rowsUntil: a module's full-panel screen hides the two rows; they are
	// drawn over it until then (on opening, on a page turn, while the jog
	// wheel is touched), so the way back and the pages are never hidden for good
	rowsUntil time.Time
	touched   int // encoder under a finger, -1 none
	peekUntil time.Time
	peekEnc   int
	toast     string
	toastAt   time.Time
	lastEnum  [8]time.Time

	meta      map[string]*compMeta // slot|prefix|module
	vals      map[string]string    // slot|prefix:key
	positions []position
	lastVals  time.Time
	lastPos   time.Time
	leds      map[uint16]uint8
	ov        *overrides
	// what the last Live refresh read from Pung's own device (state: "fallback")
	fallbackDev, fallbackRead int
	lastTurn                  string // the last encoder turn, and what it found (state: "write_state")
	// turnAt: when the oldest turn not yet on the screen came in; lagMS: the
	// last 16 turn-to-screen times, with what each frame's parts took
	turnAt time.Time
	lagMS  []string
	lvIdx  map[string]int     // module key -> Live parameter index
	lvDef  map[string]float64 // module key -> Live's default for it, 0..1 (where Live has one)

	// live mode: the selection the view is built for (liveView.key), since
	// when, and what is known of it; a frame is drawn only for a selection
	// that is ready (holdFrame), and a knob writes only to the device its
	// parameter indexes were read from
	liveKey                           string
	liveSince                         time.Time
	liveReady, liveResolved, livePung bool
	liveWritable                      bool              // the device is confirmed (liveView.writable)
	bankMem                           map[string][2]int // a device's page, kept while others are shown (as Push does)
	sb                                *sbState          // the sound browser (sounds_view.go); nil when closed
	fb                                *fbState          // the file browser, open (files_view.go)
	// the header's sound: whether the device's state is still the sound it
	// became (read off the frame, every few seconds)
	soundEdited bool
	editedAt    time.Time
	editedBusy  bool
	focusAt     time.Time // when the surface came, for the first frame's latency
}

func newSurface(h *Host) *surface {
	pm := pmclient.New("http://127.0.0.1:7701")
	pm.App = "pung"
	exe, _ := os.Executable()
	u := &surface{h: h, pm: pm, view: "chain", touched: -1, peekEnc: -1, focus: -1,
		meta: map[string]*compMeta{}, vals: map[string]string{}, leds: map[uint16]uint8{},
		ov: newOverrides(filepath.Join(h.dataDir, "overrides"), filepath.Join(filepath.Dir(exe), "overrides"))}
	h.ui = u
	return u
}

// ---- wiring ------------------------------------------------------------------

func (u *surface) run(done <-chan struct{}) {
	initFaces()
	if err := u.attach(); err != nil {
		log.Printf("surface: %v (the Push surface stays off; the web page works)", err)
	}
	go u.frames(done)
	go u.status(done)
	go u.watchLive(done)
	if lib := u.h.sounds; lib != nil {
		lib.onNames = func(d *device) { // a list's names, read in the background: show them
			u.mu.Lock()
			open := u.sb != nil && u.sb.dev == d
			u.mu.Unlock()
			if open {
				u.readSounds(false)
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { <-done; cancel() }()
	for ctx.Err() == nil {
		if !u.pm.HasSwitcher() {
			select {
			case <-ctx.Done():
			case <-time.After(5 * time.Second):
			}
			continue
		}
		// Push's playing UX stays Live's while Pung owns the surface: the
		// pads (pmclient Pads) and every button that plays, records or edits
		// in Live (liveButtons). Pung keeps the screen, the encoders, the
		// rows above and below the screen, the jog wheel, left/right and Page.
		u.pm.RunSurface(ctx, liveButtons, pmclient.SurfaceHandler{ //nolint:errcheck
			Pads: true,
			OnFocus: func() {
				u.focused.Store(true)
				if u.live != nil {
					u.live.state().active.Store(true)
				}
				at := time.Now() // before the lock: a wait for it is part of the latency
				u.mu.Lock()
				u.focusAt = at
				u.leds = map[uint16]uint8{} // repaint everything
				u.refreshPositions(true)
				u.refreshValues()
				// back from a device's own surface app: say how to get there again
				if p, _, _ := u.currentBank(); p.Module != "" && !u.autoOpen {
					if mi, ok := findModule(u.h.modulesDir, p.Module); ok && mi.SurfaceApp != "" && surfaceAppPort(mi.SurfaceApp) != 0 {
						u.say(strings.ToUpper(mi.Name) + " HAS ITS OWN SURFACE|PRESS ITS BUTTON (TOP LEFT) OR THE JOG WHEEL TO OPEN IT")
					}
				}
				if !u.liveReady {
					u.liveSince = time.Now() // the hold counts from here (holdFrame)
				}
				u.mu.Unlock()
				u.dirty.Store(true)
			},
			OnFocusInfo: func(fi pmclient.FocusInfo) {
				u.standIn.Store(fi.DeviceView)
				u.dirty.Store(true)
			},
			OnBlur: func() {
				u.mu.Lock()
				u.closeSounds(false) // Push took the screen: the sound from before the browser
				u.closeFiles(false)  // and the file
				u.mu.Unlock()
				u.focused.Store(false)
				u.standIn.Store(false)
				if u.live != nil {
					u.live.state().active.Store(false)
				}
			},
		})
	}
}

func (u *surface) attach() error {
	port, ok := alsaseq.FindByName("Ableton Push 3 Live Port", alsaseq.CapRead)
	if !ok {
		return fmt.Errorf("Push 3 Live Port not found")
	}
	c, err := alsaseq.Open()
	if err != nil {
		return err
	}
	c.SetName("Pung Surface")
	if _, err := c.CreatePort("Pung Surface", alsaseq.CapWrite|alsaseq.CapSubsWrite, alsaseq.PortTypeMidi|alsaseq.PortTypeApp); err != nil {
		c.Close()
		return err
	}
	if err := c.Subscribe(port.Addr); err != nil {
		c.Close()
		return err
	}
	u.c, u.push = c, port.Addr
	events := make(chan []byte, 512)
	go func() {
		err := c.ReadLoop(pushReader{out: events})
		log.Printf("surface: Push reader stopped: %v", err)
		close(events)
	}()
	go func() {
		for msg := range events {
			if u.focused.Load() {
				u.handle(msg)
			}
		}
	}()
	log.Printf("surface: reading the Push at %d:%d", port.Addr.Client, port.Addr.Port)
	return nil
}

type pushReader struct{ out chan<- []byte }

func (r pushReader) Fixed(evType uint8, src alsaseq.Addr, data []byte) {
	if msg := alsaseq.DecodeMIDI(evType, data); len(msg) > 0 {
		select {
		case r.out <- msg:
		default:
		}
	}
}
func (r pushReader) VarLen(uint8, alsaseq.Addr, []byte) {}

// status keeps Pung's card in Home current.
func (u *surface) status(done <-chan struct{}) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	var last [2]string
	for {
		select {
		case <-done:
			return
		case <-t.C:
		}
		u.mu.Lock()
		slot := u.slot
		u.mu.Unlock()
		s := u.h.slot(slot)
		l1, l2 := fmt.Sprintf("TRACK %d", slot+1), fmt.Sprintf("%d TRACKS", len(u.h.activeSlots()))
		if s != nil {
			if m, ok := s.Get("synth_module"); ok && m != "" {
				l1 += " " + u.moduleName(m)
			}
		}
		// In Live, Pung's devices are what there is (its own slots are
		// not used there): the selected one, and how many Live holds.
		if u.h.live != nil && u.h.prov != nil {
			n := len(u.h.prov.list())
			l1, l2 = "NO DEVICE IN LIVE", fmt.Sprintf("%d DEVICES IN LIVE", n)
			if n == 1 {
				l2 = "1 DEVICE IN LIVE"
			}
			if n > 0 {
				l1 = "SELECT ONE IN LIVE"
			}
			if i, _ := u.h.selectedDevice(); i >= 0 {
				if d := u.h.prov.device(i); d != nil {
					l1 = strings.ToUpper(d.c.Name)
				}
			}
		}
		if l1 != last[0] || l2 != last[1] {
			if u.pm.SurfaceStatus(asciiOnly(l1), l2) == nil {
				last = [2]string{l1, l2}
			}
		}
	}
}

// routes: a test door. POST /api/surface/press {"msg":[176,32,127]} feeds one
// raw Push message to the input handler exactly as the Push port would,
// so the whole surface can be driven and checked without hands on the Push.
func (u *surface) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/surface/press", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Msg   []int `json:"msg"`
			Force bool  `json:"force"` // even when Pung does not own the surface
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Msg) == 0 {
			fail(w, 400, "body must be {\"msg\":[status,data1,data2]}")
			return
		}
		if !u.focused.Load() && !body.Force {
			fail(w, 409, "Pung does not own the surface (open it from Home)")
			return
		}
		msg := make([]byte, len(body.Msg))
		for i, b := range body.Msg {
			msg[i] = byte(b)
		}
		u.handle(msg)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("GET /api/surface/state", func(w http.ResponseWriter, r *http.Request) {
		u.mu.Lock()
		defer u.mu.Unlock()
		p, cm, b := u.currentBank()
		banks := []string{}
		if cm != nil {
			for _, bk := range cm.Banks {
				banks = append(banks, bk.Name)
			}
		}
		var keys []string
		if b != nil {
			keys = b.Keys
		}
		// the upper row in Live: the track's devices, and the selected one's button
		row, rowSel := []string{}, -1
		if u.live != nil {
			devs, sel := u.live.state().deviceRow()
			for i, d := range devs {
				row = append(row, d.Name)
				if d.I == sel {
					rowSel = i
				}
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "focused": u.focused.Load(), "view": u.view, "slot": u.slot + 1,
			"device_row": row, "device_row_selected": rowSel, "open": u.open, "focus": u.focus,
			"page_slots": u.pageSlots(), "device_slots": u.deviceSlots(),
			"leds": func() map[string][]uint8 { // the display buttons' lights, as last set
				out := map[string][]uint8{"upper": make([]uint8, 8), "lower": make([]uint8, 8)}
				for i := 0; i < 8; i++ {
					out["upper"][i] = u.leds[uint16(push3.CCScreenTop1)+uint16(i)]
					out["lower"][i] = u.leds[uint16(push3.CCScreenBot1)+uint16(i)]
				}
				return out
			}(),
			"fallback": map[string]int{"device": u.fallbackDev, "read": u.fallbackRead},
			// why a turn would not write (turn, writeParam)
			"write_state": map[string]any{"ready": u.liveReady, "writable": u.liveWritable, "resolved": u.liveResolved,
				"pung": u.livePung, "values": len(u.vals), "last_turn": u.lastTurn},
			"turn_to_screen_ms": u.lagMS,
			"frame_draw_us":     u.frameStats.drawUS.Load(), "frame_push_us": u.frameStats.pushUS.Load(), "frames": u.frameStats.n.Load(),
			"module_ui_draw_us": u.overlayDrawUS(p.Module),
			"position":          p, "positions": u.positions, "bank": u.bank, "banks": banks, "keys": keys,
			"toast": u.toast, "live": u.liveActive(), "live_params": u.lvIdx,
			"live_path": func() []int {
				if u.live == nil {
					return nil
				}
				return u.live.state().view().path
			}()})
	})
}

// ---- model ---------------------------------------------------------------------

func (u *surface) moduleName(id string) string {
	if m, ok := findModule(u.h.modulesDir, id); ok {
		if m.Abbrev != "" && len(m.Name) > 12 {
			return m.Abbrev
		}
		return m.Name
	}
	return id
}

// refreshPositions rebuilds what the view shows of Live. Caller holds u.mu.
func (u *surface) refreshPositions(force bool) {
	if u.liveActive() {
		u.refreshLive()
		return
	}
	u.positions = nil
}

// liveButtons stay Live's while Pung owns the surface, with the pads:
// transport, Shift, the pad modes, layouts, scales, Note Repeat and Accent,
// the octaves, the repeat rates (the scene column), up and down, the track
// buttons (mute, solo, stop) and Live's editing buttons.
var liveButtons = []int{
	85, 86, // Play, Record
	push3.CCShift, push3.CCNote, push3.CCSession, push3.CCLayout, push3.CCScale, push3.CCRepeat, push3.CCAccent,
	54, 55, // octave down, up
	36, 37, 38, 39, 40, 41, 42, 43, // repeat rates / scenes
	46, 47, // up, down
	push3.CCMute, push3.CCSolo, push3.CCStopClips,
	push3.CCUndo, push3.CCDelete, push3.CCDuplicate, push3.CCDoubleLoop, push3.CCQuantize, push3.CCConvert,
	push3.CCFixedLength, push3.CCCapture, push3.CCTapTempo, push3.CCMetronome,
	// the two small encoders left of the display: volume and tempo are
	// Live's in every view, and Pung puts nothing of its own on them
	push3.CCVolume, push3.CCVolumePress, push3.CCTempo, push3.CCTempoPress,
}

// isLiveButton: a button in liveButtons. Pung sees its press too (it
// reads the hardware) and must leave it alone.
func isLiveButton(n byte) bool {
	for _, b := range liveButtons {
		if int(n) == b {
			return true
		}
	}
	return false
}

// pushManagersButton: the buttons that leave Push's device view. While the
// view stands in for it, push-manager acts on them (Surface.ViewButton in
// push-manager): Pung must not act on the same press.
func pushManagersButton(n byte) bool {
	switch n {
	case 110, 112, 113, 34, push3.CCAdd, push3.CCSwap, push3.CCSettings, push3.CCSet, push3.CCUserMode, 92:
		return true
	}
	return false
}

// trackPage: the 8 tracks the lower row shows (the page holding the
// selected track) and the index of the first.
func (u *surface) trackPage() ([]liveTrack, int, int) {
	tracks, sel := u.live.state().trackRow()
	first := 0
	if sel >= 0 {
		first = sel / 8 * 8
	}
	return tracks[first:min(first+8, len(tracks))], first, sel
}

// selectTrack selects the track under lower button i in Live. Live's device
// topic then brings its device: a Pung one shows here, any other gives
// the screen back to Push (push-manager's device view).
func (u *surface) selectTrack(i int) {
	page, _, _ := u.trackPage()
	if i < len(page) {
		go liveCall("track", "select", map[string]any{"track": page[i].Ref})
	}
}

// stepTrack selects the previous or next track (the left and right arrows).
func (u *surface) stepTrack(d int) {
	tracks, sel := u.live.state().trackRow()
	if n := sel + d; sel >= 0 && n >= 0 && n < len(tracks) {
		go liveCall("track", "select", map[string]any{"track": tracks[n].Ref})
	}
}

func (u *surface) selected() (position, bool) {
	if u.pos >= 0 && u.pos < len(u.positions) {
		return u.positions[u.pos], true
	}
	return position{}, false
}

// metaFor returns the component's metadata, read once per loaded module.
func (u *surface) metaFor(p position) *compMeta {
	if p.Module == "" || p.Kind == "add" {
		return nil
	}
	if p.Kind == "other" {
		return nil
	}
	if u.liveActive() { // a Live device: the module's metadata, read once per module
		m, ok := findModule(u.h.modulesDir, p.Module)
		if !ok {
			return nil
		}
		k := "live|" + m.ID
		if cm, ok := u.meta[k]; ok {
			return cm
		}
		cm, ok := u.h.probeMeta(m)
		cm = liveBanks(cm)
		if set := u.ov.get(u.h.modulesDir, m.ID); set != nil && set.failed == "" && len(set.compartments) > 0 {
			cm = withCompartments(cm, set.compartments)
		}
		if ok { // a probe that could not run is asked again
			u.meta[k] = cm
		}
		return cm
	}
	return nil
}

// liveBanks: the module's banks as its device in Live has them. A key with
// no parameter metadata (in ui_hierarchy, not in chain_params) is not one of
// the device's parameters: Live has no value for it and nothing to write, so
// a column for it could only show "--". A bank left empty goes too.
func liveBanks(cm *compMeta) *compMeta {
	if cm == nil {
		return nil
	}
	out := *cm
	out.Banks = nil
	for _, b := range cm.Banks {
		nb := bank{Name: b.Name}
		for _, k := range b.Keys {
			if k != "" && cm.Params[k] != nil {
				nb.Keys = append(nb.Keys, k)
			}
		}
		if len(nb.Keys) > 0 {
			out.Banks = append(out.Banks, nb)
		}
	}
	return &out
}

// withCompartments: the pages of a module that declares compartments. Each
// compartment is one screen, its keys 8 to a page in the order given; the
// parameters no compartment names stay reachable after them, on the
// module's generic banks.
func withCompartments(cm *compMeta, comps []*ovCompartment) *compMeta {
	if cm == nil {
		return nil
	}
	out := *cm
	out.Banks = nil
	covered := map[string]bool{}
	for _, c := range comps {
		pages := c.pages
		if len(pages) == 0 {
			pages = []ovPage{{keys: c.keys}}
		}
		n := len(out.Banks)
		for pi, pg := range pages {
			var keys []string
			for _, k := range pg.keys {
				if cm.Params[k] != nil {
					keys = append(keys, k)
					covered[k] = true
				}
			}
			for i := 0; i < len(keys); i += 8 {
				name := c.label
				if pg.label != "" {
					name = pg.label
				}
				if i > 0 {
					name = fmt.Sprintf("%s %d", name, i/8+1)
				}
				out.Banks = append(out.Banks, bank{Name: name, Keys: keys[i:min(i+8, len(keys))], Compartment: c.id, CompLabel: c.label, Page: pi})
			}
		}
		if len(out.Banks) == n && c.screen != nil {
			// a screen with no encoders is still a page
			out.Banks = append(out.Banks, bank{Name: c.label, Keys: []string{""}, Compartment: c.id, CompLabel: c.label})
		}
	}
	for _, b := range cm.Banks {
		var keys []string
		for _, k := range b.Keys {
			if k != "" && !covered[k] {
				keys = append(keys, k)
			}
		}
		if len(keys) > 0 {
			out.Banks = append(out.Banks, bank{Name: b.Name, Keys: keys})
		}
	}
	return &out
}

// compartmentInfo is a compartment as the web page sees it.
type compartmentInfo struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Keys     []string `json:"keys"`
	Custom   bool     `json:"custom"`              // it has its own screen on the Push
	Takeover bool     `json:"takeover"`            // ... and that screen is all of the panel
	LiveKeys []string `json:"live_keys,omitempty"` // values the module drives, for live pictures
	// Pages: its encoder pages, eight keys each, as the Push turns through
	// them (the web page lays its controls out by them)
	Pages []compartmentPage `json:"pages,omitempty"`
}

type compartmentPage struct {
	Label string   `json:"label"`
	Keys  []string `json:"keys"`
	// Screen: the page has a screen of its own on the Push (screen.png?page=)
	Screen bool `json:"screen,omitempty"`
}

// compartmentsOf: a module's compartments, declared ones else its banks (a
// generic bank is a compartment too), and the one the Push shows for this
// module now ("" when the Pung view shows something else).
func (u *surface) compartmentsOf(module string) ([]compartmentInfo, string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	var out []compartmentInfo
	if set := u.ov.get(u.h.modulesDir, module); set != nil && set.failed == "" && len(set.compartments) > 0 {
		for _, c := range set.compartments {
			ci := compartmentInfo{ID: c.id, Label: c.label, Keys: c.keys, Custom: c.screen != nil, Takeover: c.takeover, LiveKeys: c.liveKeys}
			for _, pg := range c.pages {
				ci.Pages = append(ci.Pages, compartmentPage{Label: pg.label, Keys: pg.keys, Screen: pg.screen != nil})
			}
			out = append(out, ci)
			// (a page's own screen does not make the compartment's web section a screen)
		}
	} else if m, ok := findModule(u.h.modulesDir, module); ok {
		if cm, _ := u.h.probeMeta(m); cm != nil {
			for i, b := range liveBanks(cm).Banks {
				out = append(out, compartmentInfo{ID: fmt.Sprintf("bank%d", i+1), Label: b.Name, Keys: b.Keys})
			}
		}
	}
	shown := ""
	if p, cm, b := u.currentBank(); b != nil && p.Module == module && u.focused.Load() {
		shown = b.Compartment
		if shown == "" {
			for i := range cm.Banks {
				if &cm.Banks[i] == b {
					shown = fmt.Sprintf("bank%d", i+1)
				}
			}
		}
	}
	return out, shown
}

// showCompartment turns the Push to a compartment of the module it shows (the
// web page asked). false: the Push does not show that module.
func (u *surface) showCompartment(module, id string) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	p, cm, _ := u.currentBank()
	if cm == nil || p.Module != module {
		return false
	}
	for i, b := range cm.Banks {
		if b.Compartment == id || (b.Compartment == "" && fmt.Sprintf("bank%d", i+1) == id) {
			u.bank = i
			u.bankOff = i / 8 * 8
			u.peekUntil = time.Time{}
			u.refreshValues()
			return true
		}
	}
	return false
}

func (u *surface) currentBank() (position, *compMeta, *bank) {
	p, ok := u.selected()
	if !ok {
		return p, nil, nil
	}
	cm := u.metaFor(p)
	if cm == nil || len(cm.Banks) == 0 {
		return p, cm, nil
	}
	if u.bank >= len(cm.Banks) {
		u.bank = 0
	}
	return p, cm, &cm.Banks[u.bank]
}

func (u *surface) valKey(p position, key string) string {
	return fmt.Sprintf("%d|%s:%s", u.slot, p.Prefix, key)
}

// refreshValues reads the visible bank. Caller holds u.mu.
func (u *surface) refreshValues() {
	u.lastVals = time.Now()
	if u.liveActive() {
		u.refreshLive()
		return
	}
}

func (u *surface) say(msg string) {
	u.toast, u.toastAt = msg, time.Now()
	u.dirty.Store(true)
}

// ---- input -----------------------------------------------------------------------

func (u *surface) handle(msg []byte) {
	u.mu.Lock()
	defer u.mu.Unlock()
	defer u.dirty.Store(true)
	st := msg[0] & 0xF0
	switch {
	case (st == 0x90 || st == 0x80) && len(msg) == 3:
		n, v := msg[1], msg[2]
		on := st == 0x90 && v > 0
		switch {
		case n <= 7 && msg[0]&0x0F == 0: // encoder touch (MPE pad data is on other channels)
			if on {
				u.touched = int(n)
				u.peekEnc = int(n)
				u.peekUntil = time.Now().Add(time.Hour)
				if u.del && u.view == "chain" { // Delete + touch: back to its default, as on Push
					u.resetParam(int(n))
				}
			} else if u.touched == int(n) {
				u.touched = -1
				u.peekUntil = time.Now().Add(300 * time.Millisecond)
			}
		case n == push3.NoteJogTouch && msg[0]&0x0F == 0: // a hand on the jog wheel: where it would go
			if on {
				u.rowsUntil = time.Now().Add(time.Hour)
			} else {
				u.rowsUntil = time.Now().Add(1200 * time.Millisecond)
			}
		case push3.IsPadNote(n):
			// the pads are Live's (pmclient Pads): Push's own playing UX
		}
	case st == 0xB0 && len(msg) == 3 && msg[0]&0x0F == 0:
		// channel 1 only: in MPE mode a pad's slide is CC 74 on the pad's own
		// channel, the same number as encoder 4 (seen on the device 2026-11-14)
		u.cc(msg[1], msg[2])
	}
}

// tapWindow: Push takes a Mute or Solo let go this soon as a tap, and
// toggles the selected track (measured on a Push: 290 ms toggles, 440 ms
// does not).
const tapWindow = 450 * time.Millisecond

func (u *surface) cc(n, v byte) {
	press := v > 0
	switch n {
	case push3.CCShift:
		u.shift = press
		u.dirty.Store(true) // a touched cell shows FINE while Shift is held
		return
	case push3.CCDelete:
		u.del = press // Live's too (liveButtons): read here for Delete + ...
		return
	case push3.CCMute, push3.CCSolo:
		u.holdModifier(n == push3.CCMute, press)
		return
	}
	if u.fb != nil && u.view == "files" {
		switch {
		case n >= push3.CCEncoder1 && n < push3.CCEncoder1+8:
			if delta := push3.DecodeRel(v); n == push3.CCEncoder1 {
				u.fbSibling(sign(delta)) // the folder beside this one
			} else {
				u.fbMove(sign(delta))
			}
			return
		case n == push3.CCJogWheel:
			u.fbTurn(push3.DecodeRel(v))
			return
		}
		if u.fbButton(n, press) {
			return
		}
	}
	if u.sb != nil && (u.view == "sounds" || u.view == "name") {
		switch {
		case n >= push3.CCEncoder1 && n < push3.CCEncoder1+8:
			enc, delta := int(n-push3.CCEncoder1), push3.DecodeRel(v)
			switch {
			case u.view == "name":
				u.edTurn(enc, delta)
			case enc == 0:
				u.sbBank(sign(delta))
			default:
				u.sbMove(sign(delta))
			}
			return
		case n == push3.CCJogWheel:
			d := push3.DecodeRel(v)
			if u.view == "name" {
				u.edJog(d) // the letter at the cursor, as Push's text entry
			} else {
				u.sbTurn(d) // on the level the hands are on (Source > Bank > Sound)
			}
			return
		}
		if u.view == "name" && u.edButton(n, press) {
			return
		}
		if u.view == "sounds" && u.sbButton(n, press) {
			return
		}
	}
	if n >= push3.CCEncoder1 && n < push3.CCEncoder1+8 {
		u.turn(int(n-push3.CCEncoder1), push3.DecodeRel(v))
		return
	}

	if n == push3.CCJogWheel {
		u.jog(push3.DecodeRel(v))
		return
	}
	if !press {
		return
	}
	if isLiveButton(n) {
		return // Live's: it plays, records or edits there
	}
	if u.standIn.Load() && pushManagersButton(n) {
		return // push-manager closes the view and passes it on to Push
	}
	if !u.liveActive() {
		return
	}
	switch {
	case n == push3.CCSave:
		u.saveButton() // the device's sound (sounds_view.go)
	case n == push3.CCAdd || n == push3.CCSwap || n == push3.CCNew:
		// Push's own, never Pung's: its browser adds a device, and its Swap
		// (Hot-Swap) can replace the device itself. As a stand-in for the
		// device view these go on to Push (push-manager); opened from Home,
		// Push is one press away
		u.say("ADD AND SWAP ARE PUSH'S OWN|SHIFT + HELP, HELP GOES BACK TO PUSH'S VIEW")
	case n >= push3.CCScreenTop1 && n < push3.CCScreenTop1+8:
		u.top(int(n - push3.CCScreenTop1))
	case n >= push3.CCScreenBot1 && n < push3.CCScreenBot1+8:
		u.bottom(int(n - push3.CCScreenBot1))
	case n == push3.CCDPadLeft:
		u.stepTrack(-1) // as on Push: the tracks, at both levels
	case n == push3.CCDPadRight:
		u.stepTrack(1)
	case n == push3.CCJogClickRight:
		// one level in, as Push's jog goes deeper: the wheel walks what the
		// page is about (a module that names nothing has no such level)
		if u.view == "chain" && u.open && u.wheelComp() != nil {
			u.inner = true
			u.showRows()
		}
	case n == push3.CCJogClickLeft:
		if u.inner {
			u.inner = false // back to the pages
			u.showRows()
			break
		}
		u.open = false // back, as Push's jog
	case n == push3.CCJogPress || n == push3.CCDPadCenter:
		u.jogPress()
	case n == push3.CCPageLeft:
		u.stepBank(-1) // Pung's own shortcut: Push has none for pages
	case n == push3.CCPageRight:
		u.stepBank(1)
	}
}

// holdModifier: Mute or Solo went down or up. Live has the button too, and
// takes a short press as a tap on the selected track; a press used with one
// of Pung's buttons must not count there, so the track is put back.
func (u *surface) holdModifier(mute, press bool) {
	prop := map[bool]string{true: "mute", false: "solo"}[mute]
	if mute {
		u.mute = press
	} else {
		u.solo = press
	}
	if press {
		u.combo, u.holdAt = false, time.Now()
		return
	}
	if !u.combo || time.Since(u.holdAt) >= tapWindow || !u.liveActive() {
		return
	}
	tracks, sel := u.live.state().trackRow()
	if sel < 0 {
		return
	}
	ref, was := tracks[sel].Ref, tracks[sel].flag(prop)
	go func() {
		time.Sleep(250 * time.Millisecond) // Push acts on the release
		if now, ok := trackFlag(ref, prop); ok && now != was {
			liveCall("track", "set", map[string]any{"track": ref, prop: was}) //nolint:errcheck
		}
	}()
}

// trackFlag: a track's mute or solo, as Live has it now.
func trackFlag(ref json.RawMessage, prop string) (bool, bool) {
	raw, err := liveCall("track", "get", map[string]any{"track": ref})
	if err != nil {
		return false, false
	}
	var t map[string]any
	if json.Unmarshal(raw, &t) != nil {
		return false, false
	}
	v, ok := t[prop].(bool)
	return v, ok
}

// rowSlots: what the 8 buttons of a row show of n things, scrolled off
// steps, as Push's device view does it (measured): an arrow on the first
// button once scrolled and on the last while more follow; each step moves
// the row by one. A slot is an index, slotNone, slotLeft or slotRight.
const (
	slotNone  = -1
	slotLeft  = -2
	slotRight = -3
)

func rowSlots(off, n int) [8]int {
	var out [8]int
	for k := range out {
		i := k + off
		switch {
		case k == 0 && off > 0:
			out[k] = slotLeft
		case k == 7 && i < n-1:
			out[k] = slotRight
		case i < n:
			out[k] = i
		default:
			out[k] = slotNone
		}
	}
	return out
}

// rowShow: the scroll that puts thing i on the row, nearest to off.
func rowShow(off, n, i int) int {
	off = max(0, min(off, max(0, n-8)))
	for step := 0; step < n; step++ {
		for _, o := range []int{off - step, off + step} {
			if o < 0 || o > max(0, n-8) {
				continue
			}
			for _, s := range rowSlots(o, n) {
				if s == i {
					return o
				}
			}
		}
	}
	return off
}

// pageSlots: the lower row while a device is open: its pages.
func (u *surface) pageSlots() [8]int {
	_, cm, _ := u.currentBank()
	if cm == nil {
		return rowSlots(0, 0)
	}
	return rowSlots(u.bankOff, len(cm.Banks))
}

// deviceSlots: the upper row at chain level: the track's devices, then
// Push's "+" (slot len(devs): add a device after them).
func (u *surface) deviceSlots() [8]int {
	if !u.liveActive() {
		return rowSlots(0, 0)
	}
	devs, _ := u.live.state().deviceRow()
	return rowSlots(u.devOff, len(devs)+1)
}

// addDevice: Push's "+". Adding a device is Push's own browser: the screen
// goes back to Push and Add is pressed there, as push-manager does it for
// the Add button itself.
func (u *surface) addDevice() {
	c, pm := u.c, u.pm
	if pm == nil {
		return
	}
	go func() {
		if err := pm.SurfaceLeave("live"); err != nil {
			log.Printf("surface: +: %v", err)
			return
		}
		time.Sleep(150 * time.Millisecond) // Push has its buttons again
		p, ok := alsaseq.FindByName("Ableton Internal Input", alsaseq.CapWrite)
		if !ok || c == nil {
			return
		}
		c.SendCC(p.Addr, 0, push3.CCAdd, 127) //nolint:errcheck
		time.Sleep(40 * time.Millisecond)
		c.SendCC(p.Addr, 0, push3.CCAdd, 0) //nolint:errcheck
	}()
}

// selectedDeviceIndex: where the selected device is in the track's devices (-1 none).
func selectedDeviceIndex(devs []liveDevSummary, sel int) int {
	for i, d := range devs {
		if d.I == sel {
			return i
		}
	}
	return -1
}

// top: an upper display button. Chain level: the track's devices (the
// selected one's opens it; with Mute it goes off and on, with Delete it is
// removed). Open: button 1 goes back.
func (u *surface) top(i int) {
	if u.open {
		switch {
		case i == 0:
			u.open = false
			u.inner = false
		case i == soundsButton && u.hasSounds():
			u.openSounds() // the device's own action, where Push puts a device's (sounds_view.go)
		}
		return
	}
	st := u.live.state()
	devs, sel := st.deviceRow()
	switch s := u.deviceSlots()[i]; {
	case s == slotLeft:
		u.devOff--
	case s == slotRight:
		u.devOff++
	case s < 0:
	case s == len(devs): // "+"
		u.focus = s
		u.addDevice()
	case u.mute:
		u.combo = true
		d := devs[s]
		st.setTopActive(d.I, !d.Active)
		go liveCall("device", "set_active", map[string]any{"track": st.view().dev.Track, "device": d.I, "on": !d.Active}) //nolint:errcheck
	case u.del:
		go liveCall("device", "delete", map[string]any{"track": st.view().dev.Track, "device": devs[s].I}) //nolint:errcheck
	case devs[s].I == sel:
		u.focus = s
		u.openDevice()
	default:
		// select it in Live; a Pung device stays here, any other gives
		// the screen to Push (push-manager's device view)
		u.focus = s
		go liveCall("device", "select", map[string]any{"track": st.view().dev.Track, "path": []int{devs[s].I}}) //nolint:errcheck
	}
}

// soundsButton: the upper button of an open device that opens its sounds
// (the last one: Push puts a device's own actions on these buttons).
const soundsButton = 7

// hasSounds: the shown device is one of Pung's, with a sound browser.
func (u *surface) hasSounds() bool {
	if u.h == nil || u.h.sounds == nil || !u.liveActive() {
		return false
	}
	d, _ := u.pungDevice()
	return d != nil
}

// openDevice: the selected device's pages on the lower row (a Pung device,
// read and confirmed: nothing else has pages here).
func (u *surface) openDevice() {
	if u.liveReady && u.handOver() {
		return // the device's own surface is another app's (handover.go)
	}
	if _, cm, _ := u.currentBank(); cm != nil && u.liveReady {
		u.open = true
		u.bankOff = rowShow(u.bankOff, len(cm.Banks), u.bank)
		u.showRows()
	}
}

// bottom: a lower display button. Open: the device's pages. Chain level:
// Live's tracks (with Mute or Solo held: that track's).
func (u *surface) bottom(i int) {
	if u.open {
		switch s := u.pageSlots()[i]; {
		case s == slotLeft:
			u.bankOff--
		case s == slotRight:
			u.bankOff++
		case s >= 0:
			u.setBank(s)
		}
		return
	}
	page, _, _ := u.trackPage()
	if i >= len(page) {
		return
	}
	if u.mute || u.solo {
		u.combo = true
		prop := map[bool]string{true: "mute", false: "solo"}[u.mute]
		ref := page[i].Ref
		go func() {
			if v, ok := trackFlag(ref, prop); ok {
				liveCall("track", "set", map[string]any{"track": ref, prop: !v}) //nolint:errcheck
			}
		}()
		return
	}
	u.selectTrack(i)
}

// setBank shows page n of the selected device.
func (u *surface) setBank(n int) {
	_, cm, _ := u.currentBank()
	if cm == nil || n < 0 || n >= len(cm.Banks) || n == u.bank {
		return
	}
	u.bank = n
	u.bankOff = rowShow(u.bankOff, len(cm.Banks), n)
	u.peekUntil = time.Time{} // the card belonged to the old page
	u.showRows()
	u.refreshValues()
	// no notice: the page row and the header name the page, and a takeover
	// draws its own; a box over the knobs hid two of them on every page turn
}

// showRows: the rows over a full-panel screen, for a moment.
func (u *surface) showRows() {
	if t := time.Now().Add(1500 * time.Millisecond); t.After(u.rowsUntil) {
		u.rowsUntil = t
	}
}

// stepBank: the previous or next page (the jog wheel in an open device, Page < >).
func (u *surface) stepBank(d int) { u.setBank(u.bank + d) }

// jog: the wheel, as on Push's device view. Chain level: a focus along the
// track's devices. Open: the device's pages.
func (u *surface) jog(delta int) {
	if !u.liveActive() || u.view != "chain" {
		return
	}
	if u.open && u.inner && u.wheelComp() != nil {
		u.wheel(delta)
		return
	}
	if u.open {
		u.stepBank(sign(delta))
		return
	}
	devs, sel := u.live.state().deviceRow()
	if u.focus < 0 || u.focus > len(devs) {
		u.focus = max(0, selectedDeviceIndex(devs, sel))
	}
	u.focus = max(0, min(len(devs), u.focus+sign(delta))) // the last stop is "+"
	u.devOff = rowShow(u.devOff, len(devs)+1, u.focus)
}

// jogPress: chain level: the focused device (selects it; the selected one
// opens). Open: the device's sounds.
func (u *surface) jogPress() {
	if u.view != "chain" {
		return
	}
	if u.open && u.inner {
		if c := u.wheelComp(); c != nil && c.wheelPress != "" {
			if d, prefix := u.pungDevice(); d != nil {
				go d.SetOutside(prefix+":"+c.wheelPress, "on")
			}
		}
		return
	}
	if u.open {
		u.openSounds() // the sound browser (sounds_view.go)
		return
	}
	devs, sel := u.live.state().deviceRow()
	at := selectedDeviceIndex(devs, sel)
	if u.focus == len(devs) {
		u.addDevice() // on "+"
		return
	}
	if u.focus < 0 || u.focus > len(devs) || u.focus == at {
		u.openDevice()
		return
	}
	go liveCall("device", "select", map[string]any{"track": u.live.state().view().dev.Track, "path": []int{devs[u.focus].I}}) //nolint:errcheck
}

// forgetMeta drops cached metadata after a module changed.
func (u *surface) forgetMeta() { u.meta = map[string]*compMeta{} }

func (u *surface) turn(enc, delta int) {
	u.peekEnc = enc
	if u.touched != enc {
		u.peekUntil = time.Now().Add(1200 * time.Millisecond)
	}
	if u.turnAt.IsZero() {
		u.turnAt = time.Now()
	}
	p, cm, b := u.currentBank()
	if b == nil || enc >= len(b.Keys) || b.Keys[enc] == "" {
		u.lastTurn = fmt.Sprintf("enc %d: no key on this page", enc)
		return
	}
	key := b.Keys[enc]
	m := cm.Params[key]
	_, has := u.vals[u.valKey(p, key)]
	u.lastTurn = fmt.Sprintf("enc %d: %s meta=%t readonly=%t value=%t", enc, key, m != nil, m != nil && m.ReadOnly, has)
	if m != nil && m.Type == "file" && m.File != nil {
		// a file is not turned through, it is chosen: the turn opens the
		// browser at it, and from there nothing changes without Load
		u.openFiles(key, m)
		return
	}
	if m == nil || m.ReadOnly {
		u.say("READ ONLY")
		return
	}
	if m.Type == "enum" {
		// one option per gesture step: a fast spin must not skip words
		if time.Since(u.lastEnum[enc]) < 90*time.Millisecond {
			return
		}
		u.lastEnum[enc] = time.Now()
	}
	cur, ok := u.vals[u.valKey(p, key)]
	if !ok {
		return // no value read yet: never step from a guess
	}
	if m.Type == "enum" && m.Avail != "" {
		// only what the module offers now: the turn goes to the next option
		// that can be chosen, or nowhere (and the value shown never shows
		// one that cannot)
		if d, prefix := u.pungDevice(); d != nil {
			if mask, ok := d.s.Get(prefix + ":" + m.Avail); ok && mask != "" {
				i, _ := m.enumIndex(cur)
				n := i + sign(delta)
				for n >= 0 && n < len(m.Options) && n < len(mask) && mask[n] == '0' {
					n += sign(delta)
				}
				if n < 0 || n >= len(m.Options) {
					return
				}
				nv := m.Options[n]
				if _, err := strconv.Atoi(strings.TrimSpace(cur)); err == nil || cur == "" {
					nv = strconv.Itoa(n)
				}
				u.writeParam(p, key, m, nv)
				return
			}
		}
	}
	if nv, changed := m.step(cur, delta, u.shift); changed {
		u.writeParam(p, key, m, nv)
	}
}

// wheelComp: the shown compartment, if it names something to walk.
func (u *surface) wheelComp() *ovCompartment {
	p, cm, b := u.currentBank()
	if b == nil || cm == nil || p.Module == "" || u.ov == nil {
		return nil
	}
	if c := u.ov.get(u.h.modulesDir, p.Module).compartment(b.Compartment); c != nil && c.wheel != "" {
		return c
	}
	return nil
}

// wheel: one step along the key the shown compartment names
// (push.compartment's wheel), for the jog wheel one level inside the device.
func (u *surface) wheel(delta int) {
	p, cm, b := u.currentBank()
	if b == nil || cm == nil || p.Module == "" || u.ov == nil || delta == 0 {
		return
	}
	comp := u.ov.get(u.h.modulesDir, p.Module).compartment(b.Compartment)
	if comp == nil || comp.wheel == "" {
		return
	}
	m := cm.Params[comp.wheel]
	if m == nil || m.ReadOnly {
		return
	}
	if time.Since(u.wheelAt) < 70*time.Millisecond {
		return // one step a detent: a spin must not run past what is there
	}
	u.wheelAt = time.Now()
	cur, ok := u.vals[u.valKey(p, comp.wheel)]
	if !ok {
		if d, prefix := u.pungDevice(); d != nil {
			cur, ok = d.s.Get(prefix + ":" + comp.wheel)
		}
	}
	if !ok {
		return
	}
	nv, changed := m.step(cur, sign(delta), true)
	if !changed {
		return
	}
	// into the module first, and from there to Live: through Live a step
	// took 20 to 130 ms to arrive (measured 2026-11-19), and what is walked
	// along is what the screen shows
	if d, prefix := u.pungDevice(); d != nil && u.liveReady {
		u.vals[u.valKey(p, comp.wheel)] = nv
		go d.SetOutside(prefix+":"+comp.wheel, nv)
		return
	}
	u.writeParam(p, comp.wheel, m, nv)
}

// resetParam: Delete + an encoder's touch puts its parameter back to its
// default, as on Push: the module's own where it states one, else Live's.
func (u *surface) resetParam(enc int) {
	p, cm, b := u.currentBank()
	if b == nil || enc >= len(b.Keys) || b.Keys[enc] == "" {
		return
	}
	key := b.Keys[enc]
	m := cm.Params[key]
	if m == nil || m.ReadOnly {
		return
	}
	var nv string
	switch def, live := u.lvDef[key]; {
	case m.Default != nil && m.Max > m.Min:
		nv = m.fromNorm((*m.Default - m.Min) / (m.Max - m.Min))
	case m.Default != nil && m.Type == "enum" && len(m.Options) > 1:
		nv = m.fromNorm(*m.Default / float64(len(m.Options)-1))
	case live:
		nv = m.fromNorm(def)
	default:
		u.say("NO DEFAULT IS KNOWN FOR " + strings.ToUpper(m.Name))
		return
	}
	u.writeParam(p, key, m, nv)
}

// writeParam sets a parameter of the shown device. Through Live where Live
// lists it, so undo and automation recording work. Caller holds u.mu.
func (u *surface) writeParam(p position, key string, m *paramMeta, nv string) {
	if !u.liveActive() || !u.liveReady || !u.liveWritable {
		// the device shown is not the selected one yet, or only remembered:
		// a write would land on the wrong one
		return
	}
	u.vals[u.valKey(p, key)] = nv
	if idx, ok := u.lvIdx[key]; ok {
		// the index was read from the device the view is built for:
		// written only while that is still the selected one
		if v := u.live.state().view(); len(v.path) > 0 && v.writable && v.key == u.liveKey {
			u.live.state().write(paramWrite{track: v.dev.Track, path: v.path, index: idx, norm: m.toNormValue(nv)})
		}
	} else if d, prefix := u.pungDevice(); d != nil {
		// a parameter Live's list does not reach: into Pung's device,
		// which reports it to Live (SetOutside)
		go d.SetOutside(prefix+":"+key, nv)
	}
}

func pIdx(name string) uint8 {
	if i, ok := push3.ColorByName(name); ok {
		return i
	}
	return 0
}

var slotLED = []string{"orange", "sky", "pink_hot", "mint", "yellow", "violet", "cyan_lt", "red"}

func (u *surface) led(pad bool, n, v uint8) {
	// the lights are Live's again the moment the surface goes: a light
	// written after that stays wrong (Live repaints only what changes)
	if !u.focused.Load() {
		return
	}
	k := uint16(n)
	if pad {
		k |= 1 << 8
	}
	if last, ok := u.leds[k]; ok && last == v {
		return
	}
	u.leds[k] = v
	if u.c == nil {
		return // no port (a test): the plan is kept in leds
	}
	if pad {
		u.c.SendNote(u.push, 0, n, v)
	} else {
		u.c.SendCC(u.push, 0, n, int32(v))
	}
}

// The display buttons' lights, as Push's own device view sets them
// (read off the Push, 2026-11-16): the chosen thing white, every other
// option LIT in a dimmed version of its track's colour, nothing dark that
// can be pressed.
const ledChosen = 122 // Push's lit-white button

var ledOptionCache = map[int]uint8{}

// ledOption: the light of an option that is not the chosen one: the palette
// colour nearest the track's colour at Push's dimmed strength (an orange
// track's options are its "dk_orange"). col is 0xRRGGBB; 0: a neutral one.
func ledOption(col int) uint8 {
	if v, ok := ledOptionCache[col]; ok {
		return v
	}
	r, g, b := float64(col>>16&0xff), float64(col>>8&0xff), float64(col&0xff)
	if col == 0 {
		r, g, b = 200, 200, 200
	}
	// by hue, among the palette's dimmed colours (their brightest channel
	// 55..110: Push's own are there, an orange track's dk_orange at 93):
	// lit, and plainly dimmer than the chosen one's white
	m := math.Max(1, math.Max(r, math.Max(g, b)))
	r, g, b = r/m, g/m, b/m
	best, bestD := uint8(118), math.MaxFloat64 // gray_mid, if nothing else
	for i := 1; i < 128; i++ {
		pe := push3.ColorForIndex(uint8(i))
		e := pe.RGB
		em := math.Max(float64(e.R), math.Max(float64(e.G), float64(e.B)))
		if pe.Name == "" || int(pe.Index) != i || em < 55 || em > 110 {
			continue
		}
		d := math.Pow(float64(e.R)/em-r, 2) + math.Pow(float64(e.G)/em-g, 2) + math.Pow(float64(e.B)/em-b, 2)
		if d < bestD {
			best, bestD = uint8(i), d
		}
	}
	ledOptionCache[col] = best
	return best
}

// paintLEDs lights every button that offers something now and switches off
// the rest: a button that does nothing is dark, one that can be pressed is
// never dark. Caller holds u.mu.
func (u *surface) paintLEDs() {
	if u.fb != nil && u.view == "files" {
		u.paintFileLEDs()
		return
	}
	if u.sb != nil && (u.view == "sounds" || u.view == "name") {
		u.paintSoundLEDs()
		return
	}
	live := u.liveActive()
	opt := ledOption(0) // this track's options: its devices, the open one's pages
	if live {
		_, col := u.live.state().trackHeader()
		opt = ledOption(col)
	}
	on := func(b bool) uint8 {
		if b {
			return 63
		}
		return 0
	}
	// upper row: the track's devices, or the way back
	var top, bot [8]uint8
	switch {
	case !live:
	case u.open:
		top[0] = ledChosen // the open device, and the way back
		if u.hasSounds() {
			top[soundsButton] = opt
		}
	default:
		devs, sel := u.live.state().deviceRow()
		for i, s := range u.deviceSlots() {
			switch {
			case s == slotLeft || s == slotRight:
				top[i] = opt
			case s < 0:
			case s < len(devs) && devs[s].I == sel:
				top[i] = ledChosen
			default:
				top[i] = opt // another device, or "+"
			}
		}
	}
	// lower row: the open device's pages, or Live's tracks
	switch {
	case !live:
	case u.open:
		for i, s := range u.pageSlots() {
			switch {
			case s == slotLeft || s == slotRight:
				bot[i] = opt
			case s == u.bank:
				bot[i] = ledChosen
			case s >= 0:
				bot[i] = opt
			}
		}
	default:
		page, first, sel := u.trackPage()
		for i, t := range page {
			bot[i] = ledOption(t.Color) // each track in its own colour
			if first+i == sel {
				bot[i] = ledChosen
			}
		}
	}
	for i := 0; i < 8; i++ {
		u.led(false, push3.CCScreenTop1+uint8(i), top[i])
		u.led(false, push3.CCScreenBot1+uint8(i), bot[i])
	}
	// Save: the device's sound, where there is a Pung device
	pung := false
	if live {
		d, _ := u.pungDevice()
		pung = d != nil
	}
	u.led(false, push3.CCSave, on(pung))
	// Page < >: lit where they go somewhere, as the header's arrows show
	pl, pr := u.pageSteps()
	u.led(false, push3.CCPageLeft, on(pl))
	u.led(false, push3.CCPageRight, on(pr))
	// D-pad left / right: the previous and next track
	tl, tr := false, false
	if live {
		tracks, sel := u.live.state().trackRow()
		tl, tr = sel > 0, sel >= 0 && sel < len(tracks)-1
	}
	u.led(false, push3.CCDPadLeft, on(tl))
	u.led(false, push3.CCDPadRight, on(tr))
}

// ---- frames ---------------------------------------------------------------------

func (u *surface) frames(done <-chan struct{}) {
	// 16 ms: a turn waits half a tick on average for its frame, and at 33 ms
	// that wait was most of what was left between a knob and the screen. A
	// tick with nothing to draw costs nothing.
	t := time.NewTicker(16 * time.Millisecond)
	defer t.Stop()
	var lastPeak float64 = -999
	for {
		select {
		case <-done:
			return
		case <-t.C:
		}
		if !u.focused.Load() {
			continue
		}
		u.mu.Lock()
		u.refreshPositions(false)
		if time.Since(u.lastVals) > 250*time.Millisecond {
			u.refreshValues()
			u.dirty.Store(true)
		}
		if u.holdFrame() { // the last coherent frame stays; dirty stays set
			u.mu.Unlock()
			continue
		}
		peak := u.level()
		animating := math.Abs(peak-lastPeak) > 0.5 || time.Now().Before(u.peekUntil.Add(50*time.Millisecond)) ||
			(u.open && time.Now().Before(u.rowsUntil.Add(50*time.Millisecond))) ||
			(u.toast != "" && time.Since(u.toastAt) < 2600*time.Millisecond) || u.liveWanted() ||
			time.Now().UnixNano()-ovMovedAt.Load() < int64(100*time.Millisecond)
		if !u.dirty.Swap(false) && !animating {
			u.mu.Unlock()
			continue
		}
		lastPeak = peak
		turnAt := u.turnAt
		u.turnAt = time.Time{}
		t0 := time.Now()
		img := u.render(peak)
		drawT := time.Since(t0)
		u.frameStats.draw(drawT)
		u.paintLEDs()
		ledT := time.Since(t0) - drawT
		first := !u.focusAt.IsZero()
		since := time.Since(u.focusAt)
		u.focusAt = time.Time{}
		u.mu.Unlock()
		t1 := time.Now()
		err := u.pm.PushFrame(img)
		u.frameStats.push(time.Since(t1))
		if !turnAt.IsZero() {
			u.mu.Lock()
			u.lagMS = append(u.lagMS, fmt.Sprintf("%d (wait %d draw %d leds %d push %d)", time.Since(turnAt).Milliseconds(),
				t0.Sub(turnAt).Milliseconds(), drawT.Milliseconds(), ledT.Milliseconds(), time.Since(t1).Milliseconds()))
			if len(u.lagMS) > 16 {
				u.lagMS = u.lagMS[len(u.lagMS)-16:]
			}
			u.mu.Unlock()
		}
		if err != nil {
			// not on the screen (push-manager not yet handing it over, or
			// already taking it back): again next tick, never left stale
			u.dirty.Store(true)
			log.Printf("surface: frame: %v", err)
		} else if first {
			log.Printf("surface: first frame %d ms after the focus", since.Milliseconds())
		}
	}
}

// Holding a frame: how long the view waits for a selected device before it
// draws what it has.
const (
	holdForDevice = 700 * time.Millisecond  // a Pung device being found and read
	holdForPush   = 1500 * time.Millisecond // not a Pung device: push-manager gives the screen back to Push
)

// holdFrame: no frame now, the last one stays. Following Live, a device is
// drawn only once it is resolved and its own parameters are read: a frame
// built halfway showed the new track over the last device's parameters,
// and one device's values on another's dials (measured on the device,
// 2026-11-15). A selection that is not a Pung device, while Pung stands in
// for Push's device view, is about to go back to Push: nothing is drawn
// or lit for it. Each hold ends, and draws what there is, if the answer
// does not come. Caller holds u.mu.
func (u *surface) holdFrame() bool {
	if !u.liveActive() || u.view == "sounds" || u.view == "name" || u.view == "files" || u.liveReady {
		return false
	}
	age := time.Since(u.liveSince)
	if !u.liveResolved || u.livePung {
		return age < holdForDevice
	}
	return u.standIn.Load() && age < holdForPush
}

// enterSelection: Live selected another device (or resolved the selected
// one). What was built for the last one goes: its values, its parameter
// indexes, its card, its bank list; its page is kept for when it comes
// back, and this one's page comes back. Caller holds u.mu.
func (u *surface) enterSelection(v liveView) {
	if u.bankMem == nil {
		u.bankMem = map[string][2]int{}
	}
	if u.liveKey != "" && u.liveReady {
		u.bankMem[u.liveKey] = [2]int{u.bank, u.bankOff}
	}
	if u.sb != nil && v.key != u.sb.key {
		u.closeSounds(false) // another device: the one browsed gets its sound back
	}
	if u.fb != nil && v.key != u.fb.key {
		u.closeFiles(false) // and its file
	}
	u.soundEdited, u.editedAt = false, time.Time{} // the header's "*" was the last device's
	u.liveKey, u.liveSince = v.key, time.Now()
	u.liveReady = false
	u.vals = map[string]string{}
	u.lvIdx = map[string]int{}
	u.open, u.focus = false, -1 // another device: the chain level, as on Push
	u.inner = false
	u.autoOpen = true           // ... unless its page is a front panel (refreshLive)
	u.peekUntil = time.Time{}
	m := u.bankMem[v.key]
	u.bank, u.bankOff = m[0], m[1]
}

// level: the shown device's output level (dBFS). Following Live, that is
// the Pung device selected there: the surface's own slot is not the one
// rendering then, and the meter read it, so it never moved.
func (u *surface) level() float64 {
	if u.liveActive() {
		if d, _ := u.pungDevice(); d != nil {
			return peakDB(d.s.peak())
		}
	}
	return -120
}

// pageSteps: whether Page < and Page > go anywhere now.
func (u *surface) pageSteps() (left, right bool) {
	_, cm, _ := u.currentBank()
	if cm == nil || !u.liveActive() {
		return false, false
	}
	return u.bank > 0, u.bank < len(cm.Banks)-1
}

// render draws the current view. Caller holds u.mu.
func (u *surface) render(peak float64) *image.NRGBA {
	img := newFrame()
	if !u.liveActive() {
		// the Pung view edits Live devices through the PushHack Remote Script
		rect(img, 0, 0, scrW, 2, slotColor(0))
		label(img, scrW/2, 60, "THE PUNG VIEW NEEDS THE PUSHHACK REMOTE SCRIPT", cFg, 0)
		label(img, scrW/2, 84, "LIVE'S SETTINGS > MIDI > CONTROL SURFACE: PUSHHACK", cDim, 0)
		label(img, scrW/2, 108, "SHIFT + HELP, HELP GOES BACK TO PUSH", cDim, 0)
		return img
	}
	switch {
	case u.view == "files" && u.fb != nil:
		u.drawFiles(img)
	case u.view == "sounds" && u.sb != nil:
		u.drawSounds(img)
	case u.view == "name" && u.sb != nil && u.sb.ed != nil:
		u.drawNameEditor(img)
	default:
		u.drawChain(img, peak)
	}
	if u.toast != "" && time.Since(u.toastAt) < 2500*time.Millisecond {
		// "|" splits a notice into two lines; a long one wraps at a space
		lines := strings.SplitN(asciiOnly(u.toast), "|", 2)
		if len(lines) == 1 && len(lines[0]) > 64 {
			cut := strings.LastIndex(lines[0][:64], " ")
			if cut < 20 {
				cut = 64
			}
			lines = []string{lines[0][:cut], strings.TrimSpace(lines[0][cut:])}
		}
		w := 0
		for _, l := range lines {
			if len(l)*7+28 > w {
				w = len(l)*7 + 28
			}
		}
		if w > 900 {
			w = 900
		}
		h := 14 + 16*len(lines)
		x, y := (scrW-w)/2, 80-h/2
		rect(img, x, y, w, h, rgb(0x16, 0x15, 0x13))
		frameRect(img, x, y, w, h, slotColor(u.slot))
		for i, l := range lines {
			label(img, scrW/2, y+20+16*i, fitLabel(l, w-16), cFg, 0)
		}
	}
	return img
}

// ---- live mode: the selected Live device ------------------------------------

func (u *surface) liveActive() bool { return u.live != nil && u.live.connected.Load() }

// refreshLive builds the chain row from the selected track's devices and the
// values from Live's parameters. Caller holds u.mu.
func (u *surface) refreshLive() {
	v := u.live.state().view()
	if v.key != u.liveKey {
		u.enterSelection(v)
	}
	u.liveResolved, u.livePung, u.liveWritable = v.resolved, v.path != nil, v.writable
	dev, devs := v.dev, v.devs
	selIdx := -1
	if len(v.path) > 0 {
		selIdx = v.path[len(v.path)-1]
	}
	if len(devs) == 0 && selIdx >= 0 && dev.Name != "" {
		devs = []liveDevSummary{{I: selIdx, Name: dev.Name}}
	}
	var ps []position
	for _, d := range devs {
		p := position{Kind: "other", Prefix: fmt.Sprintf("dev%d", d.I), N: d.I, Name: d.Name}
		if m, ok := moduleOfLiveDevice(u.h.modulesDir, d.Name); ok {
			p.Module = m.ID
			switch m.Type {
			case "sound_generator":
				p.Kind = "synth"
			case "midi_fx":
				p.Kind = "midi"
			default:
				p.Kind = "fx"
			}
		}
		ps = append(ps, p)
	}
	u.positions = ps
	u.pos = 0
	for i, p := range ps {
		if p.N == selIdx {
			u.pos = i
		}
	}
	u.lvIdx, u.lvDef = map[string]int{}, map[string]float64{}
	u.liveReady = false
	sel, ok := u.selected()
	if !v.ready || !ok || sel.Kind == "other" || sel.N != selIdx {
		return // nothing of another device's: the frame holds (holdFrame)
	}
	u.liveReady = true
	cm := u.metaFor(sel)
	if cm == nil {
		return
	}
	if u.autoOpen {
		// a page that is the module's whole front panel is what the device
		// looks like: selecting the device shows it, once (Back still leaves)
		u.autoOpen = false
		// a takeover module (its surface is its own app): Pung's own view of
		// it is next to nothing, so selecting the device opens the app, once.
		// Back from it (its LIVE), Pung's view stays and says how to return.
		if u.focused.Load() && u.handOver() {
			return
		}
		if p, _, b := u.currentBank(); b != nil && p.Module != "" && u.ov != nil {
			set := u.ov.get(u.h.modulesDir, p.Module)
			if comp := set.compartment(b.Compartment); comp != nil && comp.takeover && set.failed == "" && !set.off {
				u.openDevice()
			}
		}
	}
	for _, lp := range dev.Params {
		if lp.Max <= lp.Min {
			continue
		}
		key := u.liveParamKey(sel, cm, lp)
		if key == "" {
			continue
		}
		u.lvIdx[key] = lp.I
		if lp.Default != nil {
			u.lvDef[key] = (*lp.Default - lp.Min) / (lp.Max - lp.Min)
		}
		u.vals[u.valKey(sel, key)] = cm.Params[key].fromNorm((lp.V - lp.Min) / (lp.Max - lp.Min))
	}
	// What Live does not list (the Remote Script reads 128 parameters of a
	// device; Osirus has 156, the JV-880 419): read from Pung's own device
	// for it, the keys this page and its compartment show.
	u.fallbackDev, u.fallbackRead = -1, 0
	if d, prefix := u.pungDevice(); d != nil {
		u.fallbackDev = d.s.Index
		need := []string{}
		free := map[string]bool{} // a screen's extra keys: values with no metadata (a patch name)
		if _, _, b := u.currentBank(); b != nil {
			need = append(need, b.Keys...)
			if c := u.ov.get(u.h.modulesDir, sel.Module).compartment(b.Compartment); c != nil {
				need = append(need, c.screenKeys()...)
				for _, k := range append(append([]string{}, c.extraKeys...), c.liveKeys...) {
					free[k] = true
				}
			}
		}
		for _, key := range need {
			if _, live := u.lvIdx[key]; key == "" || live || (cm.Params[key] == nil && !free[key]) {
				continue
			}
			if v, ok := d.s.Get(prefix + ":" + key); ok {
				u.vals[u.valKey(sel, key)] = v
				u.fallbackRead++
			}
		}
	}
}

// liveParamKey: which of the module's keys a parameter in Live's list of
// the device is. By POSITION first: Live lists a Pung device's parameters
// in the rack's own order after "Device On" (sclass.order), so position
// i is order[i-1], accepted when its name agrees. By name only when the
// name is the module's once. Names alone are not enough: the JV-880's four
// tones share theirs ("A.Env L2"), and matching on them gave 97 of Live's
// indexes to several keys at once, so a tone page showed, and wrote,
// another tone's value (and a tone's cutoff wrote the macro cutoff;
// measured on the device, 2026-11-15).
func (u *surface) liveParamKey(sel position, cm *compMeta, lp liveParam) string {
	if d, prefix := u.pungDevice(); d != nil && d.c.module == sel.Module && lp.I >= 1 && lp.I-1 < len(d.c.order) {
		if pi := d.c.order[lp.I-1]; pi < len(d.c.Params) {
			if k, ok := strings.CutPrefix(d.c.Params[pi].Key, prefix+":"); ok {
				if m := cm.Params[k]; m != nil && m.Name == lp.Name {
					return k
				}
			}
		}
	}
	found := ""
	for key, m := range cm.Params {
		if m.Name != lp.Name {
			continue
		}
		if found != "" {
			return "" // the name is several keys': none of them, rather than the wrong one
		}
		found = key
	}
	return found
}

// pungDevice: Pung's device for the device selected in Live, and the chain
// component its parameters live in ("synth", "fx1", ...). nil when the
// selection is not one of Pung's.
func (u *surface) pungDevice() (*device, string) {
	if u.h.prov == nil {
		return nil, ""
	}
	n, _ := u.h.selectedDevice()
	if n < 0 {
		return nil, ""
	}
	d := u.h.prov.device(n)
	if d == nil {
		return nil, ""
	}
	return d, d.c.component()
}

// compartmentScreen renders a compartment's custom screen as the Push shows
// it, from a device's own values: the web page shows the same picture
// (UX-GUIDELINES.md, 1.2). A takeover is the whole panel, a band screen its
// band. The same overlay as the Push's draws it, so it is drawn under u.mu.
// page: a page of the compartment with a screen of its own (Nodal Red's
// Morph pages), or -1 for the compartment's.
func (u *surface) compartmentScreen(module, id string, page int, get func(string) (string, bool)) (*image.NRGBA, error) {
	m, ok := findModule(u.h.modulesDir, module)
	if !ok {
		return nil, fmt.Errorf("no module %s", module)
	}
	set := u.ov.get(u.h.modulesDir, module)
	comp := set.compartment(id)
	if comp == nil {
		return nil, fmt.Errorf("%s has no screen %q", module, id)
	}
	scr, skeys := comp.screen, comp.screenKeys()
	var pageKeys []string
	if page >= 0 {
		if page >= len(comp.pages) || comp.pages[page].screen == nil {
			return nil, fmt.Errorf("%s: page %d of %q has no screen", module, page, id)
		}
		scr, skeys = comp.pageScreen(page)
		pageKeys = comp.pages[page].keys
	}
	if scr == nil {
		return nil, fmt.Errorf("%s has no screen %q", module, id)
	}
	cm, _ := u.h.probeMeta(m)
	if cm == nil {
		return nil, fmt.Errorf("no metadata for %s", module)
	}
	cm = withCompartments(liveBanks(cm), set.compartments)
	// values first, without the lock: a read is a call into the chain
	vals := ovValuesOf(cm, skeys, get)

	u.mu.Lock()
	defer u.mu.Unlock()
	if set.failed != "" {
		return nil, fmt.Errorf("the screen is off: %s", set.failed)
	}
	img := newFrame()
	sc := slotColor(u.slot)
	var b *bank
	for i := range cm.Banks {
		if cm.Banks[i].Compartment == comp.id {
			b = &cm.Banks[i]
			break
		}
	}
	pl := placement{w: &ovWidget{keys: skeys, draw: scr}, span: 8, full: comp.takeover && page < 0, offline: true}
	if b != nil {
		pl.info = u.takeoverInfo(position{Module: module, Name: m.Name}, cm, b, comp)
	}
	if page >= 0 {
		pl.info = map[string]any{"$knobs": pageKeys, "$page": page}
	}
	if !set.render(img, pl, vals, "", sc) {
		return nil, fmt.Errorf("the screen failed: %s", set.failed)
	}
	if !comp.takeover || page >= 0 {
		return img.SubImage(image.Rect(4, ovTop, scrW-4, ovTop+ovHeight)).(*image.NRGBA), nil
	}
	return img, nil
}

// overlayDrawUS: how long the module's picture took to draw last time.
func (u *surface) overlayDrawUS(module string) int64 {
	if set := u.ov.get(u.h.modulesDir, module); set != nil {
		return set.lastDrawUS
	}
	return 0
}

// redraw: the next frame draws, whatever changed.
func (u *surface) redraw() { u.dirty.Store(true) }
