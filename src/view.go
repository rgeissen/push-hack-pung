package main

// view.go: the Pung view, drawn for the Push panel: the device row or the
// way back on top, the 8 parameter cells, Live's tracks or the open
// device's pages at the bottom (surface.go has the controls).

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/image/font"
)

func rgb(r, g, b uint8) color.NRGBA { return color.NRGBA{r, g, b, 255} }

// drawChain: the upper row, the 8 parameter cells, the lower row.
func (u *surface) drawChain(img *image.NRGBA, peak float64) {
	sc := slotColor(u.slot)
	p, cm, b := u.currentBank()
	// the sound as it is now, for the live pictures (livehub.go)
	ls := u.liveSess()
	u.liveOut, u.liveDrew = liveOut{}, false
	if ls != nil {
		u.liveOut = ls.frame()
	}
	liveKeys := u.readLiveKeys(ls, u.liveOut, p, b)
	defer func() { u.fxUsed = u.liveDrew || liveKeys }()
	if u.drawTakeover(img, p, cm, b, sc) {
		// the screen is the module's, but the way back and the pages are
		// Push's: over it for a moment (surface.go: rowsUntil)
		if time.Now().Before(u.rowsUntil) {
			y, h := botY+3, scrH-botY-6
			rect(img, 0, 0, scrW, topH, cBlack)
			rect(img, 0, botY, scrW, scrH-botY, cBlack)
			rect(img, 0, 0, scrW, 2, sc)
			drawBack(img, strings.ToUpper(p.Name), sc)
			if u.hasSounds() {
				drawSoundsButton(img, sc)
			}
			drawPageRow(img, y, h, cm, u.pageSlots(), u.bank, sc)
		}
		return
	}
	rect(img, 0, 0, scrW, 2, sc)

	// top bar: the track's devices, or the way back out of the open one
	// (as on Push)
	nb := 1
	hdRight := scrW - 8
	if u.open {
		drawBack(img, strings.ToUpper(p.Name), sc)
		if u.hasSounds() { // the device's own action, over upper button 8
			drawSoundsButton(img, sc)
			hdRight = soundsButton*colW - 8
		}
	} else {
		nb = u.drawDeviceRow(img, sc)
	}
	hd := header{page: u.bank, meter: true, peak: peak}
	if cm != nil {
		hd.pages = len(cm.Banks)
	}
	if u.liveActive() { // the Live track, in its colour, and the bank
		name, col := u.live.state().trackHeader()
		hd.track, hd.trackCol = strings.ToUpper(name), color.NRGBA{uint8(col >> 16), uint8(col >> 8), uint8(col), 255}
		if col == 0 {
			hd.trackCol = cFg
		}
		if cm != nil && u.bank < len(cm.Banks) {
			hd.bank = strings.ToUpper(cm.Banks[u.bank].Name)
			if cl := cm.Banks[u.bank].CompLabel; cl != "" && !strings.EqualFold(cl, cm.Banks[u.bank].Name) {
				hd.bank = strings.ToUpper(cl) + " / " + hd.bank // the compartment, then its page
			}
		}
		// the level is the Pung device's: another device has none here
		hd.meter = p.Kind != "other" && p.Kind != "add"
		if hd.meter {
			hd.sound = u.soundTitle()
		}
	}
	if set := u.ov.get(u.h.modulesDir, p.Module); set != nil && set.failed != "" && cm != nil && b != nil {
		hd.warn = "MODULE UI OFF"
	}
	hd.right = hdRight
	drawHeader(img, nb*colW+4, hd, sc)

	// cells
	switch {
	case p.Kind == "other":
		label(img, scrW/2, 76, fitLabel(strings.ToUpper(p.Name)+" IS NOT A PUNG DEVICE", 900), cDim, 0)
		label(img, scrW/2, 96, "PUSH'S OWN DEVICE VIEW SHOWS IT: PRESS DEVICE VIEW", cDim, 0)
	case p.Kind == "add" || (p.Kind == "synth" && p.Module == ""):
		msg := "PRESS ADD OR A + BUTTON TO PUT A MODULE HERE"
		if p.Kind == "synth" {
			msg = "NO SYNTH: PRESS SWAP TO CHOOSE ONE"
		}
		label(img, scrW/2, 84, msg, cDim, 0)
	case cm == nil || b == nil:
		label(img, scrW/2, 84, fitLabel(strings.ToUpper(p.Name)+" HAS NO PARAMETERS", 900), cDim, 0)
	default:
		// a module's own widgets first; the columns they cover show only
		// their names and values, under the widget
		covered := make([]bool, 8)
		set := u.ov.get(u.h.modulesDir, p.Module)
		touchedKey := ""
		if u.touched >= 0 && u.touched < len(b.Keys) {
			touchedKey = b.Keys[u.touched]
		}
		comp := set.compartment(b.Compartment)
		screen, skeys := comp.pageScreen(b.Page)
		if comp != nil && comp.takeover {
			// a full-panel screen is the open device's (drawTakeover); at
			// chain level its page shows as knobs, between Push's two rows
			screen = nil
		}
		if screen != nil && set.failed == "" && !set.off {
			// a custom screen: the compartment (or this page of it) draws the
			// whole band, with every one of its keys' values; the encoders'
			// names and values stay under it
			pl := placement{w: &ovWidget{keys: skeys, draw: screen}, col: 0, span: 8, info: u.takeoverInfo(p, cm, b, comp),
				live: ls, liveOut: u.liveOut, liveKey: fmt.Sprintf("push/%s/%s/screen", p.Module, b.Name), fx: p.Kind == "fx"}
			if set.render(img, pl, u.ovValues(p, cm, skeys), touchedKey, sc) {
				for c := range covered {
					covered[c] = true
				}
			} else {
				u.say("MODULE UI OFF: " + set.failed)
			}
		} else {
			for _, pl := range set.place(b.Keys) {
				pl.info = map[string]any{"$live": u.liveInfo()}
				pl.live, pl.liveOut, pl.fx = ls, u.liveOut, p.Kind == "fx"
				pl.liveKey = fmt.Sprintf("push/%s/%s/w%d", p.Module, b.Name, pl.col)
				touched := ""
				if u.touched >= pl.col && u.touched < pl.col+pl.span {
					touched = b.Keys[u.touched]
				}
				if set.render(img, pl, u.ovValues(p, cm, pl.w.keys), touched, sc) {
					for c := pl.col; c < pl.col+pl.span; c++ {
						covered[c] = true
					}
				} else {
					u.say("MODULE UI OFF: " + set.failed)
				}
			}
		}
		// Pung's own pictures, for structures it recognizes, over columns no
		// module widget took (visuals.go)
		starts := make([]bool, 9)
		for _, g := range pictureGroups(b.Keys) {
			if slices.Contains(covered[g.start:g.end], true) {
				continue
			}
			r := image.Rect(g.start*colW+4, ovTop, g.end*colW-4, ovTop+ovHeight)
			key := fmt.Sprintf("push/%s/%s/%s/%d", p.Module, b.Name, g.kind, g.start)
			if g.kind == "lfo" {
				g = withLFOExtras(g, cm)
			}
			g.fx = p.Kind == "fx"
			if ls != nil {
				u.liveDrew = true
			}
			gv := u.ovValues(p, cm, g.keyList())
			if g.kind == "env" && ls != nil {
				g.secs = set.envSecs(g.keys, gv, func(k string) (ovValue, bool) {
					x := u.ovValues(p, cm, []string{k})[k]
					return x, x.Known
				})
			}
			drawPictureLive(img, r, g, gv, touchedKey, sc, ls, u.liveOut, key)
			for c := g.start; c < g.end; c++ {
				covered[c] = true
			}
			starts[g.start], starts[g.end] = true, true
		}
		for i := 1; i < 8; i++ {
			if !(covered[i] && covered[i-1]) || starts[i] || u.ovBoundary(set, b.Keys, i) {
				rect(img, i*colW, 30, 1, 102, cFaint)
			}
		}
		for i, key := range b.Keys {
			if key == "" {
				continue
			}
			switch m := cm.Params[key]; {
			case covered[i]:
				u.drawUnderWidget(img, i, p, m, key, sc)
			case m != nil && m.Type == "file" && m.File != nil:
				u.drawFileCell(img, i, p, cm, m, key, sc, b.Keys) // a file: its outline and name (files_view.go)
			default:
				u.drawCell(img, i, p, m, key, sc)
			}
		}
		// the detail card, only when asked for (settings.go: on the Push the
		// touched cell shows it in place), and never over a picture: the
		// picture shows the touch itself, and a card would hide it
		if u.h.settings.get().TouchCard && u.peekEnc >= 0 && u.peekEnc < len(b.Keys) && !covered[u.peekEnc] && time.Now().Before(u.peekUntil) && b.Keys[u.peekEnc] != "" {
			u.drawPeek(img, u.peekEnc, p, cm.Params[b.Keys[u.peekEnc]], b.Keys[u.peekEnc], sc)
		}
	}

	// a device switched off: its parameters greyed, as Push shows it
	if u.liveActive() {
		if devs, sel := u.live.state().deviceRow(); selectedDeviceIndex(devs, sel) >= 0 && !devs[selectedDeviceIndex(devs, sel)].Active {
			for py := topH; py < botY; py++ {
				for px := 0; px < scrW; px++ {
					c := img.NRGBAAt(px, py)
					g := uint8((int(c.R)*3 + int(c.G)*6 + int(c.B)) / 10 * 45 / 100)
					img.SetNRGBA(px, py, color.NRGBA{g, g, g, 255})
				}
			}
		}
	}
	// lower row: the open device's pages, or Live's tracks (as on Push)
	y, h := botY+3, scrH-botY-6
	if u.open && cm != nil {
		drawPageRow(img, y, h, cm, u.pageSlots(), u.bank, sc)
		return
	}
	u.drawTrackRow(img, y, h)
}

// drawBack: the open device's name over upper button 1, which leaves it.
func drawBack(img *image.NRGBA, name string, sc color.NRGBA) {
	for k := 0; k < 5; k++ { // <
		rect(img, 10+k, 12-k, 1, 2*k+1, sc)
	}
	label(img, 22, 17, fitLabel(name, colW-30), sc, -1)
}

// drawSoundsButton: SOUNDS over the open device's last upper button.
func drawSoundsButton(img *image.NRGBA, sc color.NRGBA) {
	label(img, soundsButton*colW+colW/2, 17, "SOUNDS", sc, 0)
}

// arrowCell: a row's "more" arrow in column col (dir -1 left, 1 right).
func arrowCell(img *image.NRGBA, col, cy, dir int, c color.NRGBA) {
	cx := col*colW + colW/2
	rect(img, cx-6, cy, 12, 1, c)
	for k := 0; k < 5; k++ {
		rect(img, cx+dir*(6-k), cy-k, 1, 2*k+1, c)
	}
}

// drawPageRow: the open device's pages under the lower buttons, the shown
// one filled; an arrow where the row goes on (surface.go: rowSlots).
func drawPageRow(img *image.NRGBA, y, h int, cm *compMeta, slots [8]int, cur int, sc color.NRGBA) {
	for j, s := range slots {
		x, w := j*colW+7, colW-14
		switch {
		case s == slotLeft:
			arrowCell(img, j, y+h/2, -1, sc)
		case s == slotRight:
			arrowCell(img, j, y+h/2, 1, sc)
		case s < 0 || s >= len(cm.Banks):
		default:
			name := fitLabel(strings.ToUpper(cm.Banks[s].Name), w-12)
			if s == cur {
				rect(img, x, y, w, h, sc)
				label(img, x+8, y+14, name, cBlack, -1)
			} else {
				label(img, x+8, y+14, name, sc, -1)
			}
		}
	}
}

// valueBaseline: where a value in face sits so its capitals centre on cy.
func valueBaseline(cy int, face font.Face) int {
	if face == nil {
		return cy + 5 // Tamzen: capitals 9 px
	}
	return cy + face.Metrics().CapHeight.Ceil()/2
}

// header: what the top bar's right side says.
type header struct {
	track       string
	trackCol    color.NRGBA
	bank        string // COMPARTMENT / PAGE
	sound       string // the device's sound (docs/PRESETS.md), "*" first when edited
	warn        string // a module's UI switched off
	page, pages int    // the bank, of how many (one or none: no indicator)
	meter       bool   // a level to show
	peak        float64
	right       int // where it ends (0: the screen's edge): an open device's SOUNDS takes the last column
}

// header layout, in pixels
const (
	hdBase   = 17 // the text baseline, as the device row's
	hdMeterW = 50
	hdGap    = 14
)

// drawHeader draws the top bar's right side in x0..the screen's edge (the
// device or bank row ends at x0), laid out from the right: the page
// indicator first, because Page < > is how a module's banks are reached and
// it must always show where they are; then the level meter; then the
// warning, the page's name and the track, each cut to the room left and
// left out below three letters. Nothing crosses x0.
func drawHeader(img *image.NRGBA, x0 int, hd header, sc color.NRGBA) {
	xr := scrW - 8
	if hd.right > 0 {
		xr = hd.right
	}
	room := func() int { return xr - x0 }
	if hd.pages > 1 {
		if w := pageIndicatorWidth(hd.page, hd.pages); w <= room() {
			drawPageIndicator(img, xr-w, hd.page, hd.pages)
			xr -= w + hdGap
		}
	}
	if hd.meter && hdMeterW <= room() {
		hmeter(img, xr-hdMeterW, 10, hdMeterW, 7, dbFrac(hd.peak), sc)
		xr -= hdMeterW + hdGap
	}
	for _, t := range []struct {
		s     string
		c     color.NRGBA
		whole bool // a warning is read whole or not at all
	}{{hd.warn, cWarn, true}, {hd.sound, cFg, false}, {hd.bank, cDim, false}, {hd.track, hd.trackCol, false}} {
		if t.s == "" || room() < 3*7 || (t.whole && textWidth(t.s, nil) > room()) {
			continue
		}
		s := fitLabel(t.s, room())
		label(img, xr, hdBase, s, t.c, 1)
		xr -= textWidth(s, nil) + hdGap
	}
}

func pageIndicatorWidth(page, pages int) int {
	return 6 + 6 + textWidth(fmt.Sprintf("%d/%d", page+1, pages), nil) + 6 + 6
}

// drawPageIndicator: < 3/12 >, at x. An arrow is bright where Page < or >
// goes somewhere (its button is lit then too, surface.go), faint where not.
func drawPageIndicator(img *image.NRGBA, x, page, pages int) {
	s := fmt.Sprintf("%d/%d", page+1, pages)
	cy := hdBase - 5
	on := func(b bool) color.NRGBA {
		if b {
			return cFg
		}
		return cFaint
	}
	for k := 0; k < 5; k++ { // left: the point at x
		rect(img, x+k, cy-k, 1, 2*k+1, on(page > 0))
	}
	label(img, x+12, hdBase, s, cDim, -1)
	xr := x + pageIndicatorWidth(page, pages) - 1
	for k := 0; k < 5; k++ {
		rect(img, xr-k, cy-k, 1, 2*k+1, on(page < pages-1))
	}
}

// drawDeviceRow: the selected track's devices over the upper buttons, as
// Push's device view shows them: the one holding the selected device
// filled (its button opens it), the one under the jog wheel framed, a
// device switched off dimmed, an arrow where there are more, and Push's "+"
// after the last. Returns how many columns it used.
func (u *surface) drawDeviceRow(img *image.NRGBA, sc color.NRGBA) int {
	devs, sel := u.live.state().deviceRow()
	n := 0
	for i, s := range u.deviceSlots() {
		x := i * colW
		switch {
		case s == slotLeft:
			arrowCell(img, i, 12, -1, sc)
		case s == slotRight:
			arrowCell(img, i, 12, 1, sc)
		case s < 0:
			continue
		case s == len(devs): // Push's "+": add a device after these
			rect(img, x+colW/2-5, 12, 11, 1, sc)
			rect(img, x+colW/2, 7, 1, 11, sc)
			if s == u.focus {
				frameRect(img, x+colW/2-12, 5, 25, 15, cFg)
			}
		default:
			d := devs[s]
			name := fitLabel(strings.ToUpper(d.Name), colW-20)
			switch {
			case d.I == sel && !d.Active:
				rect(img, x+8, 5, colW-16, 15, cLine)
				label(img, x+colW/2, 17, name, cBlack, 0)
			case d.I == sel:
				rect(img, x+8, 5, colW-16, 15, sc)
				label(img, x+colW/2, 17, name, cBlack, 0)
			case !d.Active:
				label(img, x+colW/2, 17, name, cLine, 0)
			default:
				label(img, x+colW/2, 17, name, cDim, 0)
			}
			if s == u.focus && d.I != sel {
				frameRect(img, x+8, 5, colW-16, 15, cFg)
			}
		}
		n = i + 1
	}
	return n
}

// drawTrackRow: Live's tracks under the lower buttons, as Push's device view
// shows them: the page of 8 holding the selected track, each in its colour,
// the selected one filled. A marker at an edge says there are more.
func (u *surface) drawTrackRow(img *image.NRGBA, y, h int) {
	page, first, sel := u.trackPage()
	tracks, _ := u.live.state().trackRow()
	drawTrackCells(img, y, h, page, first, sel, len(tracks))
}

// drawTrackCells: page (the tracks first.. of total), sel the selected one.
func drawTrackCells(img *image.NRGBA, y, h int, page []liveTrack, first, sel, total int) {
	if first > 0 {
		for k := 0; k < 5; k++ {
			rect(img, 1+k, y+h/2-k, 1, 2*k+1, cFg)
		}
	}
	if first+8 < total {
		for k := 0; k < 5; k++ {
			rect(img, scrW-2-k, y+h/2-k, 1, 2*k+1, cFg)
		}
	}
	for j, t := range page {
		x, w := j*colW+7, colW-14
		tc := color.NRGBA{uint8(t.Color >> 16), uint8(t.Color >> 8), uint8(t.Color), 255}
		if t.Color == 0 {
			tc = cDim
		}
		name := fitLabel(strings.ToUpper(t.Name), w-12)
		if first+j == sel {
			rect(img, x, y, w, h, tc)
			label(img, x+8, y+14, name, cBlack, -1)
			continue
		}
		rect(img, x, y+h-2, w, 2, tc)
		label(img, x+8, y+14, name, cFg, -1)
	}
}

func (u *surface) drawCell(img *image.NRGBA, col int, p position, m *paramMeta, key string, sc color.NRGBA) {
	cx := col*colW + colW/2
	v, ok := u.vals[u.valKey(p, key)]
	if m == nil {
		m = &paramMeta{Key: key, Name: key, Type: "string", ReadOnly: true}
	}
	// A touched cell shows what Move's detail card showed, in place (the
	// card is a setting, settings.go): the range at the gauge's ends, a
	// list's neighbouring options, and fine adjustment.
	touched := u.touched == col
	nameCol := cDim
	if touched {
		nameCol = cFg
		rect(img, cx-16, 43, 32, 2, sc)
	}
	label(img, cx, 38, fitLabel(strings.ToUpper(m.Name), colW-10), nameCol, 0)
	val, unit := m.display(v, ok)
	switch {
	case m.Type == "enum":
		box := cLine
		if touched {
			box = sc
		}
		frameRect(img, cx-44, 64, 88, 28, box)
		ev, ef := fitValue(val, 80)
		styled(img, cx, valueBaseline(78, ef), ev, cFg, ef, 0)
		if n := len(m.Options); touched && n > 1 && ok {
			// where a turn goes next, either way
			i, _ := m.enumIndex(v)
			if i > 0 {
				label(img, cx-55, 124, "<"+fitLabel(strings.ToUpper(m.Options[i-1]), 47), cDim, -1)
			}
			if i < n-1 {
				label(img, cx+55, 124, fitLabel(strings.ToUpper(m.Options[i+1]), 47)+">", cDim, 1)
			}
		}
		if n := len(m.Options); n > 1 && n <= 12 {
			i, _ := m.enumIndex(v)
			x0 := cx - (n-1)*9/2
			for k := 0; k < n; k++ {
				c := cLine
				if k == i {
					c = sc
				}
				disc(img, float64(x0+k*9), 102, 2.2, c)
			}
		} else if n > 12 {
			i, _ := m.enumIndex(v)
			label(img, cx, 106, fmt.Sprintf("%d/%d", i+1, n), cDim, 0)
		}
	case m.Type == "string":
		sv, sf := fitValue(val, colW-10)
		styled(img, cx, valueBaseline(78, sf), sv, cFg, sf, 0)
		return
	default:
		gauge(img, cx, knobCY, m.frac(v), m.Bipolar, sc, m.ReadOnly, touched)
		if touched && !m.ReadOnly && m.Max > m.Min {
			// the range, at the ends of the arc
			lo, _ := m.display(strconv.FormatFloat(m.Min, 'f', -1, 64), true)
			hi, _ := m.display(strconv.FormatFloat(m.Max, 'f', -1, 64), true)
			// numbers never cut: -24000 is -24K, or not shown
			lo, hi = fitRange(lo, hi, 40)
			label(img, cx-52, 107, lo, cDim, -1)
			label(img, cx+52, 107, hi, cDim, 1)
			// fine adjustment, beside the dial: there while Shift would
			// give it, lit while Shift is held
			if m.fineApplies() {
				if u.shift {
					rect(img, cx+29, knobCY-6, 30, 13, sc)
					label(img, cx+44, knobCY+4, "FINE", cBlack, 0)
				} else {
					label(img, cx+44, knobCY+4, "FINE", cLine, 0)
				}
			}
		}
	}
	if m.Type != "enum" {
		// the value and its unit, inside the column: the value keeps its
		// room first, and the unit goes before the value is cut
		const room = colW - 14 // a margin each side: neighbours never meet
		uw := 0
		if unit != "" {
			uw = textWidth(unit, nil) + 3
		}
		v, f := fitValue(val, room-uw)
		if unit != "" && v != val {
			if v2, f2 := fitValue(val, room); v2 == val {
				v, f, unit, uw = v2, f2, "", 0
			}
		}
		w := textWidth(v, f)
		x := cx - (w+uw)/2
		styled(img, x, 127, v, cFg, f, -1)
		if unit != "" {
			label(img, x+w+3, 127, unit, cDim, -1)
		}
	}
}

// ovBoundary: column i starts a new widget (two widgets side by side).
func (u *surface) ovBoundary(set *overrideSet, keys []string, i int) bool {
	for _, pl := range set.place(keys) {
		if pl.col == i {
			return true
		}
	}
	return false
}

// drawUnderWidget: a covered column keeps its name and value, below the widget.
func (u *surface) drawUnderWidget(img *image.NRGBA, col int, p position, m *paramMeta, key string, sc color.NRGBA) {
	cx := col*colW + colW/2
	if m == nil {
		m = &paramMeta{Key: key, Name: key, Type: "string", ReadOnly: true}
	}
	v, ok := u.vals[u.valKey(p, key)]
	val, unit := m.display(v, ok)
	nameCol := cDim
	if u.touched == col {
		nameCol = cFg
	}
	if unit != "" {
		val += " " + unit
	}
	// the value is what the hand is after: the name gives way, never it,
	// and goes altogether where less than four letters of it would show;
	// 16 px between neighbours, so a row of them reads as columns
	const room = colW - 16
	val = fitLabel(strings.ToUpper(val), room)
	if left := room - textWidth(val, nil) - 7; left >= 5*7 {
		val = fitLabel(strings.ToUpper(m.Name), left) + " " + val
	}
	label(img, cx, 122, val, nameCol, 0)
	if u.touched == col {
		rect(img, cx-16, 126, 32, 2, sc)
	}
}

// drawPeek: the touched parameter in detail over its own column and the next two.
func (u *surface) drawPeek(img *image.NRGBA, enc int, p position, m *paramMeta, key string, sc color.NRGBA) {
	if m == nil {
		return
	}
	start := enc
	if start > 5 {
		start = 5
	}
	x, y, w, h := start*colW+4, 24, 3*colW-8, 112
	rect(img, x, y, w, h, rgb(11, 11, 10))
	frameRect(img, x, y, w, h, sc)
	v, ok := u.vals[u.valKey(p, key)]
	val, unit := m.display(v, ok)
	label(img, x+12, y+18, fitLabel(strings.ToUpper(m.Name), w/2-12), cFg, -1)
	label(img, x+w-12, y+18, fitLabel(strings.ToUpper(p.Name), w/2-24), cDim, 1)
	// the value, big, in the room the unit and the position leave it
	vroom := w - 24
	count := ""
	if m.Type == "enum" && len(m.Options) > 0 {
		i, _ := m.enumIndex(v)
		count = fmt.Sprintf("%d OF %d", i+1, len(m.Options))
		vroom -= textWidth(count, nil) + 16
	}
	if unit != "" {
		vroom -= textWidth(unit, nil) + 4
	}
	vv, vf := val, faceBig
	if textWidth(val, faceBig) > vroom {
		vv, vf = fitValue(val, vroom)
	}
	vw := styled(img, x+12, y+56, vv, cFg, vf, -1)
	if unit != "" {
		label(img, x+16+vw, y+56, unit, cDim, -1)
	}
	if m.Type == "enum" && len(m.Options) > 0 {
		i, _ := m.enumIndex(v)
		label(img, x+w-12, y+56, count, cDim, 1)
		// neighbours, so a spin shows where it is going
		if i > 0 {
			label(img, x+12, y+82, "< "+fitLabel(m.Options[i-1], w/2-30), cDim, -1)
		}
		if i+1 < len(m.Options) {
			label(img, x+w-12, y+82, fitLabel(m.Options[i+1], w/2-30)+" >", cDim, 1)
		}
	} else if m.Type == "float" || m.Type == "int" {
		rx, rw, ry := x+12, w-24, y+74
		rect(img, rx, ry, rw, 1, cLine)
		f := math.Max(0, math.Min(1, m.frac(v)))
		if m.Default != nil && m.Max > m.Min {
			d := (*m.Default - m.Min) / (m.Max - m.Min)
			rect(img, rx+int(d*float64(rw)), ry-5, 1, 5, cDim)
		}
		mx := rx + int(f*float64(rw))
		if m.Bipolar {
			mid := rx + rw/2
			if mx > mid {
				rect(img, mid, ry-1, mx-mid, 3, sc)
			} else {
				rect(img, mx, ry-1, mid-mx, 3, sc)
			}
		} else {
			rect(img, rx, ry-1, mx-rx, 3, sc)
		}
		disc(img, float64(mx), float64(ry), 4, cFg)
		lo, _ := m.display(strconv.FormatFloat(m.Min, 'f', -1, 64), true)
		hi, _ := m.display(strconv.FormatFloat(m.Max, 'f', -1, 64), true)
		lo, hi = fitRange(lo, hi, rw/2-8)
		label(img, rx, ry+18, lo, cDim, -1)
		label(img, rx+rw, ry+18, hi, cDim, 1)
	}
	switch {
	case m.ReadOnly:
		label(img, x+12, y+h-6, "READ ONLY", cDim, -1)
	case m.fineApplies():
		label(img, x+12, y+h-6, "SHIFT: FINE", cDim, -1)
	}
}

// ovValues: what a module's drawing gets for its keys (override.go, v).
func (u *surface) ovValues(p position, cm *compMeta, keys []string) map[string]ovValue {
	return ovValuesOf(cm, keys, func(k string) (string, bool) {
		raw, ok := u.vals[u.valKey(p, k)]
		return raw, ok
	})
}

// ovValuesOf: what a widget or screen is given for keys, from any source
// of raw values (the surface's, or a device's for the web page).
func ovValuesOf(cm *compMeta, keys []string, get func(string) (string, bool)) map[string]ovValue {
	vals := map[string]ovValue{}
	for _, k := range keys {
		if k == "" {
			continue
		}
		m := cm.Params[k]
		raw, ok := get(k)
		e := ovValue{Value: raw, Name: k, Known: ok}
		if m != nil {
			e.Name = m.Name
			e.Display, e.Unit = m.display(raw, ok)
			e.Frac = m.frac(raw)
			e.Type, e.Min, e.Max = m.Type, m.Min, m.Max
		}
		vals[k] = e
	}
	return vals
}

// drawTakeover: a compartment whose screen takes the whole panel draws it,
// and Pung draws none of its own elements (UX-GUIDELINES.md, 5). The bank
// list, a failed or switched-off screen, or no screen: false, and the
// default view draws instead. Notices still draw on top (render).
func (u *surface) drawTakeover(img *image.NRGBA, p position, cm *compMeta, b *bank, sc color.NRGBA) bool {
	// a module's full-panel screen belongs to the OPEN device: at chain level
	// the rows are Push's (devices, tracks) and the page shows as knobs
	if cm == nil || b == nil || !u.open || p.Module == "" {
		return false
	}
	set := u.ov.get(u.h.modulesDir, p.Module)
	comp := set.compartment(b.Compartment)
	if comp == nil || !comp.takeover || set.failed != "" || set.off {
		return false
	}
	touched := ""
	if u.touched >= 0 && u.touched < len(b.Keys) {
		touched = b.Keys[u.touched]
	}
	info := u.takeoverInfo(p, cm, b, comp)
	pl := placement{w: &ovWidget{keys: comp.screenKeys(), draw: comp.screen}, full: true, info: info,
		live: u.liveSess(), liveOut: u.liveOut, liveKey: fmt.Sprintf("push/%s/%s/takeover", p.Module, b.Name), fx: p.Kind == "fx"}
	if !set.render(img, pl, u.ovValues(p, cm, comp.screenKeys()), touched, sc) {
		u.say("MODULE UI OFF: " + set.failed)
		return false
	}
	return true
}

// takeoverInfo: what a takeover screen needs that Pung's own elements would
// otherwise show: the page and its siblings, which keys the encoders turn,
// the device and the track.
func (u *surface) takeoverInfo(p position, cm *compMeta, b *bank, comp *ovCompartment) map[string]any {
	var pages []string
	page := 0
	for i := range cm.Banks {
		if cm.Banks[i].Compartment != comp.id {
			continue
		}
		if &cm.Banks[i] == b {
			page = len(pages)
		}
		pages = append(pages, cm.Banks[i].Name)
	}
	knobs := make([]string, 8)
	copy(knobs, b.Keys)
	track := ""
	if u.liveActive() {
		track, _ = u.live.state().trackHeader()
	}
	// $wheel: the jog wheel is walking the compartment's wheel key now
	return map[string]any{"$page": page, "$pages": pages, "$knobs": knobs, "$name": p.Name, "$track": track, "$live": u.liveInfo(),
		"$wheel": u.open && u.inner && comp.wheel != ""}
}
