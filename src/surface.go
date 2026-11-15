package main

// surface.go: Pung's chain editor on the Push screen, buttons and pads,
// as an app of Push Hack Home (Shift + Help opens Home; Help goes back to
// Live; push-manager owns those gestures).
//
// The layout follows Push's own Device view so a Push user's hands already
// know it:
//   bottom row   the chain: MIDI FX > synth > audio FX > +ADD; while the view
//                follows a device in Live: Live's tracks, as on Push's device
//                view (the left and right arrows step through them)
//   top row      the parameter banks of the selected component
//   encoders     the 8 parameters shown above them; touch shows details
//   Add / Swap   insert after the selection / replace it (module browser)
//   Delete+chain remove; Mute+chain bypass; Shift+turn fine
//   1/4..1/32t   slots 1..8 (the scene column)
//   pads         play the selected slot (chromatic, rows a fourth apart)
//   jog          a synth's presets; in the browser, the selection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
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

type browser struct {
	mode   string // add | swap
	kind   string // midi_fx | sound_generator | audio_fx
	items  []ModuleInfo
	cursor int
	target position
}

type surface struct {
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

	mu       sync.Mutex
	slot     int
	pos      int
	chainOff int // first chain position shown on the bottom row
	bank     int
	bankOff  int
	// bankList: the upper row lists the banks instead of the track's devices
	// (pressing the selected device's button, as on Push)
	bankList  bool
	view      string
	shift     bool
	del, mute bool
	touched   int // encoder under a finger, -1 none
	peekUntil time.Time
	peekEnc   int
	octave    int
	toast     string
	toastAt   time.Time
	br        browser
	lastEnum  [8]time.Time

	meta      map[string]*compMeta // slot|prefix|module
	vals      map[string]string    // slot|prefix:key
	positions []position
	lastVals  time.Time
	lastPos   time.Time
	held      map[byte]byte // pad -> note it started, for its note-off
	leds      map[uint16]uint8
	ov        *overrides
	// what the last Live refresh read from Pung's own device (state: "fallback")
	fallbackDev, fallbackRead int
	lvIdx                     map[string]int // live mode: module key -> Live parameter index
}

func newSurface(h *Host) *surface {
	pm := pmclient.New("http://127.0.0.1:7701")
	pm.App = "pung"
	exe, _ := os.Executable()
	u := &surface{h: h, pm: pm, view: "chain", touched: -1, peekEnc: -1,
		meta: map[string]*compMeta{}, vals: map[string]string{}, held: map[byte]byte{}, leds: map[uint16]uint8{},
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
				u.mu.Lock()
				u.leds = map[uint16]uint8{} // repaint everything
				u.refreshPositions(true)
				u.refreshValues()
				u.mu.Unlock()
				u.dirty.Store(true)
			},
			OnFocusInfo: func(fi pmclient.FocusInfo) {
				u.standIn.Store(fi.DeviceView)
				u.dirty.Store(true)
			},
			OnBlur: func() {
				u.focused.Store(false)
				u.standIn.Store(false)
				if u.live != nil {
					u.live.state().active.Store(false)
				}
				u.releasePads()
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
			"device_row": row, "device_row_selected": rowSel, "bank_list": u.bankList,
			"fallback": map[string]int{"device": u.fallbackDev, "read": u.fallbackRead},
			"position": p, "positions": u.positions, "bank": u.bank, "banks": banks, "keys": keys,
			"octave": u.octave, "toast": u.toast, "live": u.liveActive(), "live_params": u.lvIdx,
			"live_path": func() []int {
				if u.live == nil {
					return nil
				}
				return u.live.state().view().path
			}(), "browser": map[string]any{"kind": u.br.kind, "mode": u.br.mode,
				"cursor": u.br.cursor, "count": len(u.br.items)}})
	})
}

// ---- model ---------------------------------------------------------------------

func (u *surface) cur() *Slot { return u.h.slot(u.slot) }

func (u *surface) moduleName(id string) string {
	if m, ok := findModule(u.h.modulesDir, id); ok {
		if m.Abbrev != "" && len(m.Name) > 12 {
			return m.Abbrev
		}
		return m.Name
	}
	return id
}

// refreshPositions rebuilds the chain row. Caller holds u.mu.
func (u *surface) refreshPositions(force bool) {
	if u.liveActive() {
		u.refreshLive()
		return
	}
	if !force && time.Since(u.lastPos) < 500*time.Millisecond {
		return
	}
	u.lastPos = time.Now()
	s := u.cur()
	if s == nil {
		u.positions = nil
		return
	}
	c := s.composition()
	var ps []position
	for i, m := range c.MidiFX {
		if m != "" {
			ps = append(ps, position{Kind: "midi", Prefix: "midi_fx" + strconv.Itoa(i+1), N: i + 1, Module: m})
		}
	}
	nmidi := len(ps)
	ps = append(ps, position{Kind: "synth", Prefix: "synth", N: 1, Module: c.Synth})
	nfx := 0
	for i, m := range c.FX {
		if m != "" {
			ps = append(ps, position{Kind: "fx", Prefix: "fx" + strconv.Itoa(i+1), N: i + 1, Module: m})
			nfx++
		}
	}
	// a full chain is 8 MIDI FX + 1 synth + 8 audio FX = 17 positions; the
	// bottom row shows 8 of them and scrolls (keepVisible)
	if nfx < maxAudioFX || nmidi < maxMidiFX {
		ps = append(ps, position{Kind: "add"})
	}
	for i := range ps {
		p := &ps[i]
		switch {
		case p.Kind == "add":
			p.Name = "+ ADD"
		case p.Module == "":
			p.Name = "NO SYNTH"
		default:
			p.Name = u.moduleName(p.Module)
			v, _ := s.Get(p.Prefix + ":bypassed")
			p.Bypassed = v == "1"
		}
	}
	// keep the selection on the same component when the row shifts
	var sel position
	if u.pos >= 0 && u.pos < len(u.positions) {
		sel = u.positions[u.pos]
	}
	u.positions = ps
	if sel.Prefix != "" {
		for i, p := range ps {
			if p.Prefix == sel.Prefix && p.Module == sel.Module {
				u.pos = i
				break
			}
		}
	}
	if u.pos >= len(ps) {
		u.pos = len(ps) - 1
	}
	if u.pos < 0 {
		u.pos = 0
	}
	u.keepVisible()
}

// keepVisible scrolls the chain row so the selection is on it.
func (u *surface) keepVisible() {
	if u.pos < u.chainOff {
		u.chainOff = u.pos
	}
	if u.pos >= u.chainOff+8 {
		u.chainOff = u.pos - 7
	}
	if max := len(u.positions) - 8; u.chainOff > max {
		u.chainOff = max
	}
	if u.chainOff < 0 {
		u.chainOff = 0
	}
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

// step moves the selection along the chain (D-pad, jog clicks).
func (u *surface) step(d int) {
	n := u.pos + d
	if n < 0 || n >= len(u.positions) {
		return
	}
	u.pos, u.bank, u.bankOff = n, 0, 0
	u.peekUntil = time.Time{}
	u.keepVisible()
	u.refreshValues()
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
	k := fmt.Sprintf("%d|%s|%s", u.slot, p.Prefix, p.Module)
	if cm, ok := u.meta[k]; ok {
		return cm
	}
	s := u.cur()
	if s == nil {
		return nil
	}
	cm := buildMeta(p.Module, func(key string) (string, bool) { return s.Meta(p.Prefix, key) })
	u.meta[k] = cm
	return cm
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
		for _, pg := range pages {
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
				out.Banks = append(out.Banks, bank{Name: name, Keys: keys[i:min(i+8, len(keys))], Compartment: c.id, CompLabel: c.label})
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
	Custom   bool     `json:"custom"`   // it has its own screen on the Push
	Takeover bool     `json:"takeover"` // ... and that screen is all of the panel
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
			out = append(out, compartmentInfo{ID: c.id, Label: c.label, Keys: c.keys, Custom: c.screen != nil, Takeover: c.takeover})
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
	p, _, b := u.currentBank()
	s := u.cur()
	if b == nil || s == nil {
		return
	}
	for _, k := range b.Keys {
		if k == "" {
			continue
		}
		if v, ok := s.Get(p.Prefix + ":" + k); ok {
			u.vals[u.valKey(p, k)] = v
		} else {
			delete(u.vals, u.valKey(p, k))
		}
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
			} else if u.touched == int(n) {
				u.touched = -1
				u.peekUntil = time.Now().Add(300 * time.Millisecond)
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

func (u *surface) cc(n, v byte) {
	press := v > 0
	switch n {
	case push3.CCShift:
		u.shift = press
		return
	case push3.CCDelete, push3.CCMute:
		return // Live's (liveButtons)
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
	switch {
	case n >= push3.CCScreenTop1 && n < push3.CCScreenTop1+8:
		u.top(int(n - push3.CCScreenTop1))
	case n >= push3.CCScreenBot1 && n < push3.CCScreenBot1+8:
		u.bottom(int(n - push3.CCScreenBot1))
	case n >= 36 && n <= 43: // the scene column: slots 1..8
		u.selectSlot(int(n - 36))
	case (n == push3.CCAdd || n == push3.CCSwap || n == 92) && u.liveActive():
		u.say("ADD AND SWAP DEVICES WITH PUSH'S BROWSER|SHIFT + HELP, HELP GOES BACK TO PUSH'S VIEW")
	case n == push3.CCAdd:
		u.openBrowser("add")
	case n == 92: // New: make this slot's tracks in Live
		slot := u.slot
		u.say(fmt.Sprintf("ASKING LIVE FOR TRACK %d...", slot+1))
		go func() {
			_, err := ensureTracks(slot)
			u.mu.Lock()
			switch {
			case errors.Is(err, errNoScript):
				u.say("LIVE: TURN ON THE PUSHHACK REMOTE SCRIPT|LIVE SETTINGS > MIDI > CONTROL SURFACE: PUSHHACK")
			case err != nil:
				u.say("LIVE: " + err.Error())
			default:
				u.say(fmt.Sprintf("MIDI TRACK 'PUNG %d' IS READY|NOW AN AUDIO TRACK: INPUT PUSHHACK, PUNG %d, MONITOR IN", slot+1, slot+1))
			}
			u.mu.Unlock()
		}()
	case n == push3.CCSwap && u.shift: // the module's own UI, or the native one
		if p, ok := u.selected(); ok && p.Module != "" {
			if set := u.ov.get(u.h.modulesDir, p.Module); set != nil {
				set.off = !set.off
				if set.off {
					u.say("NATIVE UI")
				} else if set.failed != "" {
					u.say("MODULE UI IS OFF: " + set.failed)
				} else {
					u.say("MODULE UI")
				}
			} else {
				u.say("THIS MODULE HAS NO PUSH UI OF ITS OWN")
			}
		}
	case n == push3.CCSwap:
		u.openBrowser("swap")
	case (n == 44 || n == 45) && u.view != "browse" && u.liveActive():
		u.stepTrack(map[bool]int{true: -1, false: 1}[n == 44]) // as on Push: the tracks
	case n == 44 || n == push3.CCJogClickLeft: // D-pad left, jog click left
		if u.view == "browse" {
			u.moveCursor(-1)
		} else {
			u.step(-1)
		}
	case n == 45 || n == push3.CCJogClickRight:
		if u.view == "browse" {
			u.moveCursor(1)
		} else {
			u.step(1)
		}
	case n == push3.CCJogPress:
		if u.view == "browse" {
			u.choose(u.br.cursor)
		}
	case n == 55: // octave up
		if u.octave < 4 {
			u.releasePadsLocked()
			u.octave++
			u.say(fmt.Sprintf("OCTAVE %+d", u.octave))
		}
	case n == 54:
		if u.octave > -3 {
			u.releasePadsLocked()
			u.octave--
			u.say(fmt.Sprintf("OCTAVE %+d", u.octave))
		}
	case (n == 62 || n == 63) && u.view != "browse" && u.liveActive():
		u.stepBank(map[bool]int{true: -1, false: 1}[n == 62]) // Page < >: the banks
	case n == 62: // page left
		if u.view == "browse" {
			u.moveCursor(-8)
		} else if u.bankOff > 0 {
			u.bankOff -= 8
		}
	case n == 63:
		if u.view == "browse" {
			u.moveCursor(8)
		} else if _, cm, _ := u.currentBank(); cm != nil && u.bankOff+8 < len(cm.Banks) {
			u.bankOff += 8
		}
	}
}

// followLive: Live's selected track belongs to slot i.
func (u *surface) followLive(i int) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if i != u.slot && u.h.slot(i) != nil {
		u.selectSlot(i)
		u.dirty.Store(true)
	}
}

func (u *surface) selectSlot(i int) {
	if u.h.slot(i) == nil {
		if _, err := u.h.openSlot(i); err != nil {
			u.say("TRACK " + strconv.Itoa(i+1) + ": " + err.Error())
			return
		}
	}
	if i != u.slot {
		u.releasePadsLocked()
	}
	u.slot, u.pos, u.bank, u.bankOff, u.view, u.chainOff = i, 0, 0, 0, "chain", 0
	u.peekUntil = time.Time{}
	u.refreshPositions(true)
	// land on the synth, the component most people want first
	for j, p := range u.positions {
		if p.Kind == "synth" {
			u.pos = j
		}
	}
	u.refreshValues()
	u.say(fmt.Sprintf("TRACK %d", i+1))
}

func (u *surface) top(i int) {
	if u.view == "browse" {
		page := u.br.cursor / 8 * 8
		if page+i < len(u.br.items) {
			u.choose(page + i)
		}
		return
	}
	if u.liveActive() && !u.bankList { // the track's devices, as on Push
		devs, sel := u.live.state().deviceRow()
		switch {
		case i >= len(devs):
		case devs[i].I == sel:
			u.bankList = true // the selected device again: its banks
		default:
			// select it in Live; a Pung device stays here, any other gives
			// the screen to Push (push-manager's device view)
			go liveCall("device", "select", map[string]any{"track": u.live.state().view().dev.Track, "path": []int{devs[i].I}})
		}
		return
	}
	_, cm, _ := u.currentBank()
	if cm != nil && u.bankOff+i < len(cm.Banks) {
		u.bank = u.bankOff + i
		u.peekUntil = time.Time{} // the card belonged to the old bank
		u.refreshValues()
	}
	u.bankList = false // a bank chosen: the devices again
}

// stepBank: the previous or next bank (Page < >, while the view follows Live).
func (u *surface) stepBank(d int) {
	_, cm, _ := u.currentBank()
	if cm == nil {
		return
	}
	if n := u.bank + d; n >= 0 && n < len(cm.Banks) {
		u.bank = n
		u.bankOff = n / 8 * 8
		u.peekUntil = time.Time{}
		u.refreshValues()
		u.say(strings.ToUpper(cm.Banks[n].Name))
	}
}

func (u *surface) bottom(i int) {
	if u.view == "browse" {
		switch i {
		case 0:
			u.setBrowserKind("midi_fx")
		case 1:
			u.setBrowserKind("sound_generator")
		case 2:
			u.setBrowserKind("audio_fx")
		case 7:
			u.view = "chain"
		}
		return
	}
	if u.liveActive() { // Live's tracks, as on Push's device view
		u.selectTrack(i)
		return
	}
	i += u.chainOff // the button shows a window of the chain
	if i >= len(u.positions) {
		return
	}
	p := u.positions[i]
	s := u.cur()
	switch {
	case u.del && p.Kind != "add":
		u.remove(s, p)
	case u.mute && p.Kind != "add" && p.Module != "":
		val := "1"
		if p.Bypassed {
			val = "0"
		}
		s.Set(p.Prefix+":bypassed", val)
		u.refreshPositions(true)
		if val == "1" {
			u.say(p.Name + " BYPASSED")
		} else {
			u.say(p.Name + " ON")
		}
	case p.Kind == "add":
		u.pos = i
		u.openBrowser("add")
	default:
		if u.pos != i {
			u.pos, u.bank, u.bankOff = i, 0, 0
			u.peekUntil = time.Time{}
			u.refreshValues()
		} else if p.Module == "" {
			u.openBrowser("swap")
		}
	}
}

func (u *surface) remove(s *Slot, p position) {
	if s == nil || p.Module == "" {
		return
	}
	switch p.Kind {
	case "midi":
		s.Set("midi_fx:remove", strconv.Itoa(p.N))
	case "fx":
		s.Set("fx:remove", strconv.Itoa(p.N))
	case "synth":
		s.Set("synth:module", "")
	}
	u.h.notify(s.Index, "chain", "")
	u.forgetMeta()
	u.refreshPositions(true)
	u.refreshValues()
	u.say(p.Name + " REMOVED")
}

// forgetMeta drops cached metadata after the chain's shape changed: a
// position number now names a different instance.
func (u *surface) forgetMeta() { u.meta = map[string]*compMeta{} }

func (u *surface) turn(enc, delta int) {
	if u.view == "browse" {
		if enc == 0 {
			u.moveCursor(delta)
		}
		return
	}
	u.peekEnc = enc
	if u.touched != enc {
		u.peekUntil = time.Now().Add(1200 * time.Millisecond)
	}
	p, cm, b := u.currentBank()
	if b == nil || enc >= len(b.Keys) || b.Keys[enc] == "" {
		return
	}
	key := b.Keys[enc]
	m := cm.Params[key]
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
	vk := u.valKey(p, key)
	cur, ok := u.vals[vk]
	if !ok {
		return // no value read yet: never step from a guess
	}
	nv, changed := m.step(cur, delta, u.shift)
	if !changed {
		return
	}
	u.vals[vk] = nv
	if u.liveActive() { // through Live: undo and automation recording work
		if idx, ok := u.lvIdx[key]; ok {
			v := u.live.state().view()
			if len(v.path) > 0 {
				u.live.state().write(paramWrite{track: v.dev.Track, path: v.path, index: idx, norm: m.toNormValue(nv)})
			}
		} else if d, prefix := u.pungDevice(); d != nil {
			// a parameter Live's list does not reach: into Pung's device,
			// which reports it to Live (SetOutside)
			go d.SetOutside(prefix+":"+key, nv)
		}
		return
	}
	if s := u.cur(); s != nil {
		s.Set(p.Prefix+":"+key, nv)
		u.h.notify(s.Index, p.Prefix+":"+key, nv)
	}
}

// jog: a synth's presets in the chain view.
func (u *surface) jog(delta int) {
	if u.view == "browse" {
		u.moveCursor(delta)
		return
	}
	p, cm, _ := u.currentBank()
	s := u.cur()
	if cm == nil || s == nil || cm.Presets.List == "" {
		return
	}
	count := 0
	if v, ok := s.Get(p.Prefix + ":" + cm.Presets.Count); ok {
		count, _ = strconv.Atoi(v)
	}
	if count <= 0 {
		return
	}
	cur := 0
	if v, ok := s.Get(p.Prefix + ":" + cm.Presets.List); ok {
		cur, _ = strconv.Atoi(v)
	}
	n := cur + sign(delta)
	if n < 0 || n >= count {
		return
	}
	s.Set(p.Prefix+":"+cm.Presets.List, strconv.Itoa(n))
	name := ""
	if cm.Presets.Name != "" {
		name, _ = s.Get(p.Prefix + ":" + cm.Presets.Name)
	}
	u.refreshValues()
	u.say(fmt.Sprintf("%d/%d %s", n+1, count, name))
	u.h.notify(s.Index, p.Prefix+":"+cm.Presets.List, strconv.Itoa(n))
}

// ---- browser ------------------------------------------------------------------

func (u *surface) openBrowser(mode string) {
	p, _ := u.selected()
	kind := "audio_fx"
	switch p.Kind {
	case "midi":
		kind = "midi_fx"
	case "synth":
		if mode == "swap" || p.Module == "" {
			kind = "sound_generator"
		}
	}
	if mode == "swap" && p.Kind == "add" {
		mode = "add"
	}
	u.br = browser{mode: mode, kind: kind, target: p}
	u.setBrowserKind(kind)
	u.view = "browse"
}

func (u *surface) setBrowserKind(kind string) {
	u.br.kind = kind
	u.br.items = nil
	for _, m := range scanModules(u.h.modulesDir) {
		if m.Type == kind && m.Loadable {
			u.br.items = append(u.br.items, m)
		}
	}
	sort.SliceStable(u.br.items, func(i, j int) bool { return u.br.items[i].Name < u.br.items[j].Name })
	u.br.cursor = 0
	for i, m := range u.br.items {
		if m.ID == u.br.target.Module {
			u.br.cursor = i
		}
	}
	if u.br.mode == "swap" && kindOf(u.br.target.Kind) != kind {
		u.br.mode = "add" // switching category turns a swap into an add
	}
}

func kindOf(posKind string) string {
	switch posKind {
	case "midi":
		return "midi_fx"
	case "synth":
		return "sound_generator"
	}
	return "audio_fx"
}

func (u *surface) moveCursor(d int) {
	n := u.br.cursor + d
	if n < 0 {
		n = 0
	}
	if n >= len(u.br.items) {
		n = len(u.br.items) - 1
	}
	if n >= 0 {
		u.br.cursor = n
	}
}

func (u *surface) choose(i int) {
	if i < 0 || i >= len(u.br.items) {
		return
	}
	m := u.br.items[i]
	s := u.cur()
	if s == nil {
		return
	}
	t := u.br.target
	c := s.composition()
	switch {
	case m.Type == "sound_generator":
		s.Set("synth:module", m.ID)
	case u.br.mode == "swap" && kindOf(t.Kind) == m.Type && t.Module != "":
		s.Set(t.Prefix+":module", m.ID)
	case m.Type == "audio_fx":
		at := countSet(c.FX) + 1 // append
		if t.Kind == "fx" && t.N < at {
			at = t.N + 1 // insert after the selection
			s.Set("fx:insert", strconv.Itoa(at))
		}
		if at > maxAudioFX {
			u.say("THE CHAIN IS FULL")
			return
		}
		s.Set(fmt.Sprintf("fx%d:module", at), m.ID)
	case m.Type == "midi_fx":
		at := countSet(c.MidiFX) + 1
		if t.Kind == "midi" && t.N < at {
			at = t.N + 1
			s.Set("midi_fx:insert", strconv.Itoa(at))
		}
		if at > maxMidiFX {
			u.say("THE CHAIN IS FULL")
			return
		}
		s.Set(fmt.Sprintf("midi_fx%d:module", at), m.ID)
	}
	if e, ok := s.Get("load_error"); ok && e != "" {
		u.say("LOAD FAILED: " + e)
	}
	u.h.notify(s.Index, "chain", "")
	u.forgetMeta()
	u.view = "chain"
	u.refreshPositions(true)
	for j, p := range u.positions {
		if p.Module == m.ID {
			u.pos = j
		}
	}
	u.keepVisible()
	u.bank, u.bankOff = 0, 0
	u.refreshValues()
	u.say(m.Name)
}

func countSet(list []string) int {
	n := 0
	for _, m := range list {
		if m != "" {
			n++
		}
	}
	return n
}

// ---- pads ------------------------------------------------------------------------

// padNote: chromatic, rows a fourth apart, C2 at the bottom left.
func (u *surface) padNote(pad byte) (byte, bool) {
	col, row := push3.PadCoord(pad)
	n := 36 + 12*u.octave + row*5 + col
	if n < 0 || n > 127 {
		return 0, false
	}
	return byte(n), true
}

func (u *surface) pad(pad, vel byte, on bool) {
	if u.liveActive() { // the pads keep playing the selected track, in the Set's scale
		u.padToLive(pad, vel, on)
		return
	}
	s := u.cur()
	if s == nil {
		return
	}
	ch := byte(u.slot & 0x0F)
	if on {
		note, ok := u.padNote(pad)
		if !ok {
			return
		}
		u.held[pad] = note
		s.queue([]byte{0x90 | ch, note, vel})
		return
	}
	if note, ok := u.held[pad]; ok {
		delete(u.held, pad)
		s.queue([]byte{0x80 | ch, note, 0})
	}
}

func (u *surface) releasePads() {
	u.mu.Lock()
	u.releasePadsLocked()
	u.mu.Unlock()
}

func (u *surface) releasePadsLocked() {
	s := u.cur()
	for pad, note := range u.held {
		if s != nil {
			s.queue([]byte{0x80 | byte(u.slot&0x0F), note, 0})
		}
		delete(u.held, pad)
	}
}

// ---- LEDs ------------------------------------------------------------------------

func pIdx(name string) uint8 {
	if i, ok := push3.ColorByName(name); ok {
		return i
	}
	return 0
}

var slotLED = []string{"orange", "sky", "pink_hot", "mint", "yellow", "violet", "cyan_lt", "red"}

func (u *surface) led(pad bool, n, v uint8) {
	if u.c == nil {
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
	if pad {
		u.c.SendNote(u.push, 0, n, v)
	} else {
		u.c.SendCC(u.push, 0, n, int32(v))
	}
}

// paintLEDs lights what has a meaning now and switches off the rest. Caller holds u.mu.
func (u *surface) paintLEDs() {
	sc := pIdx(slotLED[u.slot%len(slotLED)])
	white, dimw := pIdx("white"), pIdx("dgray")
	// top row: banks, or the browser's cards
	for i := 0; i < 8; i++ {
		v := uint8(0)
		if u.view == "browse" {
			if page := u.br.cursor / 8 * 8; page+i < len(u.br.items) {
				v = dimw
				if page+i == u.br.cursor {
					v = white
				}
			}
		} else if u.liveActive() && !u.bankList { // the track's devices
			if devs, sel := u.live.state().deviceRow(); i < len(devs) {
				v = dimw
				if devs[i].I == sel {
					v = sc
				}
			}
		} else if _, cm, _ := u.currentBank(); cm != nil && u.bankOff+i < len(cm.Banks) {
			v = dimw
			if u.bankOff+i == u.bank {
				v = sc
			}
		}
		u.led(false, push3.CCScreenTop1+uint8(i), v)
	}
	// bottom row: the chain, or the browser's categories
	for i := 0; i < 8; i++ {
		v := uint8(0)
		if u.view == "browse" {
			kinds := []string{"midi_fx", "sound_generator", "audio_fx"}
			if i < 3 {
				v = dimw
				if kinds[i] == u.br.kind {
					v = white
				}
			} else if i == 7 {
				v = pIdx("red")
			}
		} else if u.liveActive() {
			if page, first, sel := u.trackPage(); i < len(page) {
				v = dimw
				if first+i == sel {
					v = white
				}
			}
		} else if j := u.chainOff + i; j < len(u.positions) {
			p := u.positions[j]
			switch {
			case j == u.pos:
				v = sc
			case p.Bypassed:
				v = pIdx("dk_red")
			default:
				v = dimw
			}
		}
		u.led(false, push3.CCScreenBot1+uint8(i), v)
	}
	// the scene column (repeat rates) and the pads are Live's (liveButtons, Pads)
	// white buttons this app answers to
	for _, b := range []uint8{push3.CCAdd, push3.CCSwap, 62, 63, 92} { // Live lights its own (liveButtons)
		u.led(false, b, 63)
	}
	// D-pad left/right: lit when the chain goes on in that direction
	lr := func(on bool) uint8 {
		if on {
			return 63
		}
		return 0
	}
	u.led(false, 44, lr(u.view == "chain" && u.pos > 0))
	u.led(false, 45, lr(u.view == "chain" && u.pos < len(u.positions)-1))
}

// ---- frames ---------------------------------------------------------------------

func (u *surface) frames(done <-chan struct{}) {
	t := time.NewTicker(33 * time.Millisecond)
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
		peak := -120.0
		if s := u.cur(); s != nil {
			peak = peakDB(s.peak())
		}
		animating := math.Abs(peak-lastPeak) > 0.5 || time.Now().Before(u.peekUntil.Add(50*time.Millisecond)) ||
			(u.toast != "" && time.Since(u.toastAt) < 2600*time.Millisecond)
		if !u.dirty.Swap(false) && !animating {
			u.mu.Unlock()
			continue
		}
		lastPeak = peak
		img := u.render(peak)
		u.paintLEDs()
		u.mu.Unlock()
		if err := u.pm.PushFrame(img); err != nil {
			log.Printf("surface: frame: %v", err)
		}
	}
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
	if u.view == "browse" {
		u.drawBrowser(img)
	} else {
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
	u.keepVisible()
	u.lvIdx = map[string]int{}
	sel, ok := u.selected()
	if !ok || sel.Kind == "other" || sel.N != selIdx {
		return
	}
	cm := u.metaFor(sel)
	if cm == nil {
		return
	}
	for _, lp := range dev.Params {
		for key, m := range cm.Params {
			if m.Name != lp.Name || lp.Max <= lp.Min {
				continue
			}
			u.lvIdx[key] = lp.I
			u.vals[u.valKey(sel, key)] = m.fromNorm((lp.V - lp.Min) / (lp.Max - lp.Min))
		}
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
				for _, k := range c.extraKeys {
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

// padToLive sends a pad's note to Live through the "Pung" input, which
// Live listens to on the selected (armed) track. Caller holds u.mu.
func (u *surface) padToLive(pad, vel byte, on bool) {
	if u.h.seq == nil {
		return
	}
	if on {
		_, _, sc := u.live.state().snapshot()
		col, row := push3.PadCoord(pad)
		note, ok := padNoteInKey(col, row, u.octave, sc)
		if !ok {
			return
		}
		u.held[pad] = note
		u.h.seq.SendMIDI(alsaseq.Subscribers, []byte{0x90, note, vel})
		return
	}
	if note, ok := u.held[pad]; ok {
		delete(u.held, pad)
		u.h.seq.SendMIDI(alsaseq.Subscribers, []byte{0x80, note, 0})
	}
}

// compartmentScreen renders a compartment's custom screen as the Push shows
// it, from a device's own values: the web page shows the same picture
// (UX-GUIDELINES.md, 1.2). A takeover is the whole panel, a band screen its
// band. The same overlay as the Push's draws it, so it is drawn under u.mu.
func (u *surface) compartmentScreen(module, id string, get func(string) (string, bool)) (*image.NRGBA, error) {
	m, ok := findModule(u.h.modulesDir, module)
	if !ok {
		return nil, fmt.Errorf("no module %s", module)
	}
	set := u.ov.get(u.h.modulesDir, module)
	comp := set.compartment(id)
	if comp == nil || comp.screen == nil {
		return nil, fmt.Errorf("%s has no screen %q", module, id)
	}
	cm, _ := u.h.probeMeta(m)
	if cm == nil {
		return nil, fmt.Errorf("no metadata for %s", module)
	}
	cm = withCompartments(liveBanks(cm), set.compartments)
	// values first, without the lock: a read is a call into the chain
	vals := ovValuesOf(cm, comp.screenKeys(), get)

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
	pl := placement{w: &ovWidget{keys: comp.screenKeys(), draw: comp.screen}, span: 8, full: comp.takeover}
	if b != nil {
		pl.info = u.takeoverInfo(position{Module: module, Name: m.Name}, cm, b, comp)
	}
	if !set.render(img, pl, vals, "", sc) {
		return nil, fmt.Errorf("the screen failed: %s", set.failed)
	}
	if !comp.takeover {
		return img.SubImage(image.Rect(4, ovTop, scrW-4, ovTop+ovHeight)).(*image.NRGBA), nil
	}
	return img, nil
}
