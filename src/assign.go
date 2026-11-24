package main

// assign.go: assigning modulation in context. In a front panel's segment, a
// jog nudge right opens ASSIGN for the segment's controls: the lower buttons
// are the module's modulation sources, each encoder the depth of the chosen
// source on the control above it (source first, as the best software
// instruments do it: one LFO swept into eight controls at once). The wheel
// still walks the segments, and the chosen source stays: hold LFO 1 and
// dial it into the oscillators, the filter, the amp. A turn is additive (the
// source pushes the control one way from the knob), a turn with Shift
// bipolar (both ways around it): the turn sets the route's polarity with its
// depth. With Select held a turn moves the control itself (its knob, the
// root the routes start from). A nudge left goes back to the segment; EXIT (upper 7) leaves both.
// Delete + an encoder's touch removes that route. UX-GUIDELINES.md,
// "Assigning modulation".
//
// Beyond the segment: MORE (upper 3) puts the encoders on every other control
// a route may reach, eight at a time by the module's own pages, the wheel
// going on past the last segment into them; ROUTES (upper 4) on the routes
// the chosen source has (with Shift: every source's), so one is changed or
// removed without looking for its control. Upper 2 is the segment again.
//
// The module describes its modulation (get_param("mod_map")):
//
//   {"sources": [{"id": "lfo_1", "name": "LFO 1"}, ...],
//    "dests":   ["filter_1_cutoff", ...],      what a route may reach (absent: every knob)
//    "routes":  [{"src": "lfo_1", "dst": "filter_1_cutoff", "amount": 0.42}, ...]}
//
// an amount being -1..1 of the destination's range, and sets one route
// (set_param("mod_set", {"src", "dst", "amount"}); 0 removes it). A module
// without mod_map keeps the nudge for the next segment, as before.

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"math"
	"strings"
	"time"
)

type modSource struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type modRoute struct {
	Src    string  `json:"src"`
	Dst    string  `json:"dst"`
	Amount float64 `json:"amount"`
	// Bipolar: the source swings the control both ways around the knob (an
	// LFO's natural way), else one way (an envelope's); nil: the module did not say
	Bipolar *bool `json:"bipolar,omitempty"`
}

type modMap struct {
	Sources []modSource `json:"sources"`
	Dests   []string    `json:"dests"`
	Routes  []modRoute  `json:"routes"`
	dests   map[string]bool
}

// can: a route from a source may reach key
func (m *modMap) can(key string) bool {
	if m == nil || key == "" {
		return false
	}
	if m.Dests == nil {
		return true
	}
	return m.dests[key]
}

// amount: the route from src to dst (0: none)
func (m *modMap) amount(src, dst string) float64 {
	for _, r := range m.Routes {
		if r.Src == src && r.Dst == dst {
			return r.Amount
		}
	}
	return 0
}

// route: the route from src to dst (nil: none)
func (m *modMap) route(src, dst string) *modRoute {
	for i := range m.Routes {
		if m.Routes[i].Src == src && m.Routes[i].Dst == dst {
			return &m.Routes[i]
		}
	}
	return nil
}

// set: the route as the screen shows it at once (the module's answer follows)
func (m *modMap) set(src, dst string, a float64) {
	for i, r := range m.Routes {
		if r.Src == src && r.Dst == dst {
			if a == 0 {
				m.Routes = append(m.Routes[:i], m.Routes[i+1:]...)
			} else {
				m.Routes[i].Amount = a
			}
			return
		}
	}
	if a != 0 {
		m.Routes = append(m.Routes, modRoute{Src: src, Dst: dst, Amount: a})
	}
}

func (m *modMap) sourceName(id string) string {
	for _, s := range m.Sources {
		if s.ID == id {
			return s.Name
		}
	}
	return id
}

func parseModMap(raw string) *modMap {
	var m modMap
	if raw == "" || json.Unmarshal([]byte(raw), &m) != nil || len(m.Sources) == 0 {
		return nil
	}
	if m.Dests != nil {
		m.dests = make(map[string]bool, len(m.Dests))
		for _, k := range m.Dests {
			m.dests[k] = true
		}
	}
	return &m
}

// assignState: the screen's, on the surface (under u.mu)
type assignState struct {
	on      bool
	view    string    // what the encoders are on: the segment (""), MORE or ROUTES
	src     string    // the chosen source
	page    int       // the sources' page on the lower buttons
	vpage   int       // MORE's or ROUTES' page (the wheel)
	all     bool      // ROUTES of every source (Shift held when it was pressed)
	m       *modMap   // as last read (and as the screen changed it since)
	readAt  time.Time // when it was read
	writeAt time.Time // the last change from here: the module's answer may lag it
	writes  chan assignWrite
	// a new route sent, until the module's map says it took it: a synth
	// whose matrix is full keeps none, and the screen says so
	pending   *modRoute
	pendingAt time.Time
}

type assignWrite struct {
	d          *device
	key, value string
}

const assignPerPage = 7 // sources on the lower buttons; the eighth turns the page when there are more

// readModMap: the shown Pung device's modulation, read again after a while
// (and never over a change of our own the module may not have answered yet).
func (u *surface) readModMap(force bool) *modMap {
	a := &u.asg
	if !force && a.m != nil && (time.Since(a.readAt) < 700*time.Millisecond || time.Since(a.writeAt) < 600*time.Millisecond) {
		return a.m
	}
	d, prefix := u.pungDevice()
	if d == nil {
		return nil
	}
	raw, ok := d.s.Get(prefix + ":mod_map")
	a.readAt = time.Now()
	if !ok {
		a.m = nil
		return nil
	}
	if m := parseModMap(raw); m != nil {
		a.m = m
		if p := a.pending; p != nil && time.Since(a.pendingAt) > 500*time.Millisecond {
			if m.route(p.Src, p.Dst) == nil {
				u.say("NO FREE MODULATION SLOT: " + strings.ToUpper(m.sourceName(p.Src)) + " WAS NOT ADDED")
			}
			a.pending = nil
		}
	}
	return a.m
}

// assignEnter: a nudge right in a segment. false: the module offers no
// modulation map (the nudge keeps its old meaning).
func (u *surface) assignEnter() bool {
	if _, s := u.segSync(); s == nil {
		return false
	}
	m := u.readModMap(true)
	if m == nil {
		return false
	}
	a := &u.asg
	a.on, a.view, a.vpage = true, "", 0
	found := false
	for i, s := range m.Sources {
		if s.ID == a.src {
			found, a.page = true, i/assignPerPage
		}
	}
	if !found {
		a.src, a.page = m.Sources[0].ID, 0
	}
	u.peekUntil = time.Time{}
	return true
}

func (u *surface) assignLeave() { u.asg.on = false }

// assignActive: the screen is up (from a segment of the shown panel)
func (u *surface) assignActive() bool {
	if !u.asg.on {
		return false
	}
	if _, s := u.segSync(); s == nil {
		u.asg.on = false
		return false
	}
	return true
}

// the views beyond the segment
const (
	asMore   = "more"
	asRoutes = "routes"
)

// assignCol: what an encoder is on: a control, and the source whose route it sets
type assignCol struct{ key, src string }

// assignPage: a page of MORE: a module page's name and its controls
type assignPage struct {
	name string
	keys []string
}

// morePages: every control a route may reach that no segment of the panel
// has, by the module's pages in order, eight to a page
func (u *surface) morePages(cm *compMeta, m *modMap) []assignPage {
	c, _ := u.segSync()
	seen := map[string]bool{}
	if c != nil {
		for _, sg := range c.segments {
			for _, k := range sg.keys {
				seen[k] = true
			}
		}
	}
	var out []assignPage
	for _, b := range cm.Banks {
		var ks []string
		for _, k := range b.Keys {
			mm := cm.Params[k]
			if k == "" || seen[k] || mm == nil || mm.Type == "enum" || mm.ReadOnly || !m.can(k) {
				continue
			}
			seen[k] = true
			ks = append(ks, k)
		}
		for i := 0; i < len(ks); i += 8 {
			name := b.Name
			if i > 0 {
				name += fmt.Sprintf(" %d", i/8+1)
			}
			out = append(out, assignPage{name, ks[i:min(len(ks), i+8)]})
		}
	}
	return out
}

// routesOf: the routes ROUTES shows: the chosen source's, or every source's
func (u *surface) routesOf(m *modMap) []modRoute {
	var out []modRoute
	for _, r := range m.Routes {
		if u.asg.all || r.Src == u.asg.src {
			out = append(out, r)
		}
	}
	return out
}

// assignCols: what the eight encoders are on now, and what the header says it is
func (u *surface) assignCols(cm *compMeta, m *modMap) (cols []assignCol, title string) {
	a := &u.asg
	_, seg := u.segSync()
	switch a.view {
	case asMore:
		pages := u.morePages(cm, m)
		if len(pages) == 0 {
			return nil, "NOTHING ELSE TO MODULATE"
		}
		a.vpage = max(0, min(len(pages)-1, a.vpage))
		for _, k := range pages[a.vpage].keys {
			cols = append(cols, assignCol{k, a.src})
		}
		return cols, fmt.Sprintf("%s  %d/%d", pages[a.vpage].name, a.vpage+1, len(pages))
	case asRoutes:
		rs := u.routesOf(m)
		who := m.sourceName(a.src)
		if a.all {
			who = "EVERY SOURCE"
		}
		if len(rs) == 0 {
			return nil, "NO ROUTES FROM " + who
		}
		n := (len(rs) + 7) / 8
		a.vpage = max(0, min(n-1, a.vpage))
		for _, r := range rs[a.vpage*8 : min(len(rs), a.vpage*8+8)] {
			cols = append(cols, assignCol{r.Dst, r.Src})
		}
		t := "ROUTES OF " + who
		if n > 1 {
			t += fmt.Sprintf("  %d/%d", a.vpage+1, n)
		}
		return cols, t
	}
	if seg == nil {
		return nil, ""
	}
	for _, k := range seg.keys {
		cols = append(cols, assignCol{k, a.src})
	}
	return cols, seg.label
}

// assignTop: an upper button while ASSIGN is up: 2 the segment, 3 MORE, 4
// ROUTES (Shift: every source's). false: not one of these.
func (u *surface) assignTop(i int) bool {
	a := &u.asg
	switch i {
	case 1:
		a.view = ""
	case 2:
		if a.view == asMore {
			a.view = ""
		} else {
			a.view, a.vpage = asMore, 0
		}
	case 3:
		if a.view == asRoutes && a.all == u.shift {
			a.view = ""
		} else {
			a.view, a.vpage, a.all = asRoutes, 0, u.shift
		}
	default:
		return false
	}
	u.peekUntil = time.Time{}
	return true
}

// assignWheel: the jog wheel while ASSIGN is up: past the last segment into
// MORE's pages and back; ROUTES' pages. false: the segments' own stepping.
func (u *surface) assignWheel(d int, cm *compMeta) bool {
	a := &u.asg
	m := u.readModMap(false)
	if m == nil || cm == nil {
		return false
	}
	switch a.view {
	case asMore:
		if a.vpage+d < 0 { // back before the first page: the last segment
			a.view = ""
			return true
		}
		a.vpage = min(a.vpage+d, max(0, len(u.morePages(cm, m))-1))
		return true
	case asRoutes:
		a.vpage = max(0, a.vpage+d)
		return true
	}
	c, _ := u.segSync()
	if d > 0 && c != nil && u.segCur(c) == len(c.segments)-1 && len(u.morePages(cm, m)) > 0 {
		a.view, a.vpage = asMore, 0 // past the last segment: the rest
		return true
	}
	return false
}

// assignSend: a route to the module, in order (one writer: turns never overtake each other)
func (u *surface) assignSend(src, dst string, amount float64, bipolar *bool) {
	d, prefix := u.pungDevice()
	if d == nil {
		return
	}
	a := &u.asg
	if a.writes == nil {
		a.writes = make(chan assignWrite, 256)
		go func(ch chan assignWrite) {
			for w := range ch {
				w.d.SetOutside(w.key, w.value)
			}
		}(a.writes)
	}
	b, _ := json.Marshal(modRoute{Src: src, Dst: dst, Amount: math.Round(amount*1000) / 1000, Bipolar: bipolar})
	select {
	case a.writes <- assignWrite{d, prefix + ":mod_set", string(b)}:
	default: // a flood: the next turn says it again
	}
	a.writeAt = time.Now()
}

// assignCol: the encoder's column, or false
func (u *surface) assignColAt(enc int) (assignCol, *modMap, bool) {
	_, cm, _ := u.currentBank()
	m := u.readModMap(false)
	if m == nil || cm == nil {
		return assignCol{}, nil, false
	}
	cols, _ := u.assignCols(cm, m)
	if enc < 0 || enc >= len(cols) || cols[enc].key == "" {
		return assignCol{}, m, false
	}
	return cols[enc], m, true
}

// assignTurn: an encoder: its source's depth on the control above it (add a
// route from 0, change it, turn it back to 0 and it is gone), additive, or
// with Shift bipolar
func (u *surface) assignTurn(enc, delta int) {
	col, m, ok := u.assignColAt(enc)
	if !ok {
		return
	}
	if !m.can(col.key) {
		u.say(strings.ToUpper(m.sourceName(col.src)) + " CANNOT REACH THIS ONE")
		return
	}
	const step = 1.0 / 100 // a detent a percent of the control's range
	bip := u.shift         // the turn says the polarity: Shift both ways, else one way
	cur := m.amount(col.src, col.key)
	nv := math.Max(-1, math.Min(1, cur+float64(delta)*step))
	if math.Abs(nv) < step/2 {
		nv = 0
	}
	r := m.route(col.src, col.key)
	if r == nil && nv != 0 { // a new route: watch that the synth takes it
		u.asg.pending, u.asg.pendingAt = &modRoute{Src: col.src, Dst: col.key}, time.Now()
	}
	samePol := r == nil || r.Bipolar == nil || *r.Bipolar == bip
	if nv == cur && samePol {
		return
	}
	m.set(col.src, col.key, nv)
	if nv == 0 {
		u.assignSend(col.src, col.key, 0, nil)
		return
	}
	if r = m.route(col.src, col.key); r != nil {
		b := bip
		r.Bipolar = &b
	}
	u.assignSend(col.src, col.key, nv, &bip)
}

// assignClear: Delete + an encoder's touch: the route on it removed
func (u *surface) assignClear(enc int) {
	col, m, ok := u.assignColAt(enc)
	if !ok || m.amount(col.src, col.key) == 0 {
		return
	}
	m.set(col.src, col.key, 0)
	u.assignSend(col.src, col.key, 0, nil)
}

// assignSlots: the lower buttons: the sources of the page, and the page turn
func (u *surface) assignSlots() (ids []string, more bool) {
	m := u.asg.m
	if m == nil {
		return nil, false
	}
	more = len(m.Sources) > 8
	per := 8
	if more {
		per = assignPerPage
	}
	pages := (len(m.Sources) + per - 1) / per
	if u.asg.page >= pages {
		u.asg.page = 0
	}
	for i := u.asg.page * per; i < len(m.Sources) && i < (u.asg.page+1)*per; i++ {
		ids = append(ids, m.Sources[i].ID)
	}
	return ids, more
}

// assignBottom: a lower button: a source, or the next page of them
func (u *surface) assignBottom(i int) {
	ids, more := u.assignSlots()
	switch {
	case more && i == 7:
		u.asg.page++
		u.assignSlots() // (wraps)
	case i < len(ids):
		u.asg.src = ids[i]
		u.asg.vpage = 0 // (ROUTES: the new source's from the start)
	}
}

// ---- drawing ------------------------------------------------------------------

// drawAssign: the whole screen while ASSIGN is up. Pung's own, in the
// module's theme: over each encoder its control, the range the source sweeps
// it through in the modulation colour, where the sound has it now
// (live_mod), and which other sources reach it; the views over the upper
// buttons; the sources below.
func (u *surface) drawAssign(img *image.NRGBA, p position, cm *compMeta, sc color.NRGBA) {
	_, seg := u.segSync()
	m := u.readModMap(false)
	if seg == nil || m == nil {
		return
	}
	a := &u.asg
	cols, title := u.assignCols(cm, m)
	set := u.ov.get(u.h.modulesDir, p.Module)
	P := palOf(set.theme(sc))
	rect(img, 0, 0, scrW, scrH, P.ground)
	// the header: the way back, the three views over upper 2-4, what is shown, EXIT
	rect(img, 0, 0, scrW, topH, cBlack)
	rect(img, 0, 0, scrW, 2, sc)
	drawBack(img, strings.ToUpper(p.Name), sc)
	views := []struct{ name, view string }{{strings.ToUpper(seg.label), ""}, {"MORE", asMore}, {"ROUTES", asRoutes}}
	for i, v := range views {
		x, w := (i+1)*colW+7, colW-14
		t := fitLabel(v.name, w-12)
		if a.view == v.view {
			rect(img, x, 4, w, 15, cMod)
			label(img, x+w/2, 16, t, cBlack, 0)
		} else {
			label(img, x+w/2, 16, t, cMod, 0)
		}
	}
	what := strings.ToUpper(m.sourceName(a.src)) + " INTO " + strings.ToUpper(title)
	if a.view == asRoutes || a.view == asMore && len(cols) == 0 {
		what = strings.ToUpper(title)
	}
	label(img, 4*colW+10, 16, fitLabel(what, 2*colW-16), cMod, -1)
	label(img, segmentsButton*colW+colW/2, 17, "EXIT", sc, 0)
	if len(cols) == 0 {
		label(img, scrW/2, 84, strings.ToUpper(title), P.dim, 0)
	}
	for i := 0; i < 8 && i < len(cols); i++ {
		key, src := cols[i].key, cols[i].src
		if key == "" {
			continue
		}
		cx := i*colW + colW/2
		mm := cm.Params[key]
		if mm == nil {
			continue
		}
		touched := u.touched == i
		nameCol := P.dim
		if touched {
			nameCol = P.fg
			rect(img, cx-16, 43, 32, 2, sc)
		}
		name := mm.rowName() // in a segment its name says enough
		if a.view != "" {
			name = mm.Name // elsewhere, whose it is too
		}
		label(img, cx, 38, fitLabel(strings.ToUpper(name), colW-10), nameCol, 0)
		v := u.vals[u.valKey(p, key)]
		f := math.Max(0, math.Min(1, mm.frac(v)))
		if !m.can(key) || mm.Type == "enum" {
			// nothing can reach it: the knob, faint, and why
			gaugeP(img, cx, knobCY, f, mm.Bipolar, P.faint, true, false, P)
			label(img, cx, 127, "FIXED", P.faint, 0)
			continue
		}
		gaugeP(img, cx, knobCY, f, mm.Bipolar, P.mix(P.accentOr(sc), 0.55), false, false, P)
		amt := m.amount(src, key)
		bip := false
		if rt := m.route(src, key); rt != nil && rt.Bipolar != nil {
			bip = *rt.Bipolar
		}
		x, y, r := float64(cx), float64(knobCY), float64(knobR)+6
		// the source's sweep: from where the knob stands as far as its depth
		// takes it; a bipolar route both ways around the knob
		if amt != 0 {
			lo, hi := f, math.Max(0, math.Min(1, f+amt))
			if hi < lo {
				lo, hi = hi, lo
			}
			if bip {
				lo, hi = math.Max(0, f-math.Abs(amt)), math.Min(1, f+math.Abs(amt))
			}
			c := cMod
			if touched {
				c = sc
			}
			if hi-lo > 0.003 {
				arc(img, x, y, r, gaugeA0+gaugeSW*lo, gaugeSW*(hi-lo), 3.5, c)
			}
			e := gaugeA0 + gaugeSW*math.Max(0, math.Min(1, f+amt))
			disc(img, x+math.Cos(e)*r, y+math.Sin(e)*r, 2.8, c)
			if bip { // and the other end
				e2 := gaugeA0 + gaugeSW*math.Max(0, math.Min(1, f-amt))
				disc(img, x+math.Cos(e2)*r, y+math.Sin(e2)*r, 2.8, c)
			}
		}
		// where the sound has it now
		if now, ok := u.modNow(key); ok {
			nf := math.Max(0, math.Min(1, mm.frac(now)))
			an := gaugeA0 + gaugeSW*nf
			disc(img, x+math.Cos(an)*(r+6), y+math.Sin(an)*(r+6), 3.6, P.ground)
			disc(img, x+math.Cos(an)*(r+6), y+math.Sin(an)*(r+6), 2.6, P.fg)
		}
		// the depth; under the knob the route's source (ROUTES of every
		// source), else the other sources that reach it
		valCol := P.dim
		txt := "--"
		if amt != 0 {
			txt, valCol = fmt.Sprintf("%+.0f%%", amt*100), cMod
			if math.Abs(amt) < 0.1 {
				txt = fmt.Sprintf("%+.1f%%", amt*100)
			}
			if bip { // both ways around the knob: which way it starts first
				txt = "+-" + strings.TrimLeft(txt, "+-")
				if amt < 0 {
					txt = "-+" + strings.TrimLeft(txt, "+-")
				}
			}
		}
		if touched {
			valCol = sc
		}
		styled(img, cx, 133, txt, valCol, faceValue, 0)
		if a.view == asRoutes && a.all {
			label(img, cx, 116, fitLabel(strings.ToUpper(m.sourceName(src)), colW-12), cMod, 0)
			continue
		}
		var others []string
		for _, rt := range m.Routes {
			if rt.Dst == key && rt.Src != src {
				others = append(others, strings.ToUpper(m.sourceName(rt.Src)))
			}
		}
		if len(others) > 0 {
			t := others[0]
			if len(others) > 1 {
				t += fmt.Sprintf(" +%d", len(others)-1)
			}
			label(img, cx, 116, fitLabel(t, colW-12), P.dim, 0)
		}
	}
	// the sources over the lower buttons: the chosen one filled, one with a
	// route on the encoders marked
	ids, more := u.assignSlots()
	here := map[string]bool{}
	for _, c := range cols {
		for _, rt := range m.Routes {
			if c.key != "" && rt.Dst == c.key {
				here[rt.Src] = true
			}
		}
	}
	rect(img, 0, botY, scrW, scrH-botY, cBlack)
	y, h := botY+3, scrH-botY-6
	for j, id := range ids {
		x, w := j*colW+7, colW-14
		name := fitLabel(strings.ToUpper(m.sourceName(id)), w-16)
		if id == a.src {
			rect(img, x, y, w, h, cMod)
			label(img, x+8, y+h-3, name, cBlack, -1)
		} else {
			label(img, x+8, y+h-3, name, cMod, -1)
		}
		if here[id] {
			c := cMod
			if id == a.src {
				c = cBlack
			}
			disc(img, float64(x+w-7), float64(y+h/2), 2.5, c)
		}
	}
	if more {
		arrowCell(img, 7, y+h/2, 1, cMod)
	}
}
