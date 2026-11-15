package main

// view.go: the chain view and the module browser, drawn for the Push panel.

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
)

func rgb(r, g, b uint8) color.NRGBA { return color.NRGBA{r, g, b, 255} }

func kindColor(kind string) color.NRGBA {
	switch kind {
	case "other":
		return cLine
	case "midi":
		return colMidi
	case "synth":
		return colInst
	}
	return colAfx
}

// drawChain: banks on top, 8 parameter cells, the chain row at the bottom.
func (u *surface) drawChain(img *image.NRGBA, peak float64) {
	sc := slotColor(u.slot)
	p, cm, b := u.currentBank()
	if u.drawTakeover(img, p, cm, b, sc) {
		return
	}
	rect(img, 0, 0, scrW, 2, sc)

	// top bar: the track's devices (as on Push), or the banks
	nb := 0
	if u.liveActive() && !u.bankList {
		nb = u.drawDeviceRow(img, sc)
	} else if cm != nil {
		for i := 0; i < 8 && u.bankOff+i < len(cm.Banks); i++ {
			x := i * colW
			name := fitLabel(cm.Banks[u.bankOff+i].Name, colW-20)
			if u.bankOff+i == u.bank {
				rect(img, x+8, 5, colW-16, 15, sc)
				label(img, x+colW/2, 17, name, cBlack, 0)
			} else {
				label(img, x+colW/2, 17, name, cDim, 0)
			}
			nb++
		}
	}
	if nb <= 6 { // where the row leaves room: what this is, and its level
		if u.liveActive() { // the Live track, in its colour, and the bank
			name, col := u.live.state().trackHeader()
			tc := color.NRGBA{uint8(col >> 16), uint8(col >> 8), uint8(col), 255}
			if col == 0 {
				tc = cFg
			}
			bank := ""
			if cm != nil && u.bank < len(cm.Banks) && !u.bankList {
				bank = strings.ToUpper(cm.Banks[u.bank].Name)
				if cl := cm.Banks[u.bank].CompLabel; cl != "" && !strings.EqualFold(cl, cm.Banks[u.bank].Name) {
					bank = strings.ToUpper(cl) + " / " + bank // the compartment, then its page
				}
			}
			// one line, as on Push: TRACK  BANK. A second line under it ran
			// into the last column's name.
			room := (8-nb)*colW - 90
			x := scrW - 66
			if bank != "" {
				bank = fitLabel(bank, room/2)
				label(img, x, 17, bank, cDim, 1)
				x -= len(bank)*7 + 14
				room -= len(bank)*7 + 14
			}
			label(img, x, 17, fitLabel(strings.ToUpper(name), room), tc, 1)
		} else {
			label(img, scrW-66, 17, fmt.Sprintf("TRACK %d", u.slot+1), cFg, 1)
		}
		hmeter(img, scrW-58, 10, 50, 7, dbFrac(peak), sc)
	}

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
		label(img, scrW/2, 84, strings.ToUpper(p.Name)+" HAS NO PARAMETERS", cDim, 0)
	default:
		// a module's own widgets first; the columns they cover show only
		// their names and values, under the widget
		covered := make([]bool, 8)
		set := u.ov.get(u.h.modulesDir, p.Module)
		touchedKey := ""
		if u.touched >= 0 && u.touched < len(b.Keys) {
			touchedKey = b.Keys[u.touched]
		}
		if comp := set.compartment(b.Compartment); comp != nil && comp.screen != nil && set.failed == "" && !set.off {
			// a custom screen: the compartment draws the whole band, with
			// every one of its keys' values; the encoders' names and values
			// stay under it
			pl := placement{w: &ovWidget{keys: comp.keys, draw: comp.screen}, col: 0, span: 8}
			if set.render(img, pl, u.ovValues(p, cm, comp.keys), touchedKey, sc) {
				for c := range covered {
					covered[c] = true
				}
			} else {
				u.say("MODULE UI OFF: " + set.failed)
			}
		} else {
			for _, pl := range set.place(b.Keys) {
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
		for _, g := range envelopeGroups(b.Keys) {
			if slices.Contains(covered[g.start:g.end], true) {
				continue
			}
			keys := make([]string, 0, len(g.keys))
			for _, k := range g.keys {
				keys = append(keys, k)
			}
			r := image.Rect(g.start*colW+4, ovTop, g.end*colW-4, ovTop+ovHeight)
			drawEnvelope(img, r, envShapeOf(g, u.ovValues(p, cm, keys), touchedKey), sc)
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
			if covered[i] {
				u.drawUnderWidget(img, i, p, cm.Params[key], key, sc)
			} else {
				u.drawCell(img, i, p, cm.Params[key], key, sc)
			}
		}
		if set != nil && set.failed != "" && nb <= 6 {
			label(img, scrW/2, 17, "MODULE UI OFF", cWarn, 0) // the top bar's middle: the header is on the right
		}
		// the detail card, except over a picture: the picture shows the
		// touch itself, and a card would hide what is being turned
		if u.peekEnc >= 0 && u.peekEnc < len(b.Keys) && !covered[u.peekEnc] && time.Now().Before(u.peekUntil) && b.Keys[u.peekEnc] != "" {
			u.drawPeek(img, u.peekEnc, p, cm.Params[b.Keys[u.peekEnc]], b.Keys[u.peekEnc], sc)
		}
	}

	// chain row, or Live's tracks while the view follows Live
	y, h := botY+3, scrH-botY-6
	if u.liveActive() {
		u.drawTrackRow(img, y, h)
		return
	}
	// a window of 8 positions; a marker at an edge says the chain goes on
	if u.chainOff > 0 {
		for k := 0; k < 5; k++ {
			rect(img, 1+k, y+h/2-k, 1, 2*k+1, cFg)
		}
	}
	if u.chainOff+8 < len(u.positions) {
		for k := 0; k < 5; k++ {
			rect(img, scrW-2-k, y+h/2-k, 1, 2*k+1, cFg)
		}
	}
	for j := 0; j < 8 && u.chainOff+j < len(u.positions); j++ {
		i, q := u.chainOff+j, u.positions[u.chainOff+j]
		x, w := j*colW+7, colW-14
		if q.Kind == "add" {
			if i == u.pos { // selected: solid, so it reads as the selection
				frameRect(img, x, y, w, h, slotColor(u.slot))
				label(img, x+w/2, y+14, "+ ADD", cFg, 0)
				continue
			}
			for dx := 0; dx < w; dx += 6 {
				rect(img, x+dx, y, 3, 1, cLine)
				rect(img, x+dx, y+h-1, 3, 1, cLine)
			}
			rect(img, x, y, 1, h, cLine)
			rect(img, x+w-1, y, 1, h, cLine)
			label(img, x+w/2, y+14, "+ ADD", cDim, 0)
			continue
		}
		kc := kindColor(q.Kind)
		name := fitLabel(q.Name, w-24)
		switch {
		case i == u.pos:
			rect(img, x, y, w, h, kc)
			label(img, x+10, y+14, name, cBlack, -1)
		case q.Bypassed:
			frameRect(img, x, y, w, h, cFaint)
			rect(img, x+3, y+4, 2, h-8, dim(kc, 0.35))
			label(img, x+10, y+14, name, cDim, -1)
		default:
			frameRect(img, x, y, w, h, cLine)
			rect(img, x+3, y+4, 2, h-8, kc)
			label(img, x+10, y+14, name, cFg, -1)
		}
		if q.Bypassed {
			label(img, x+w-6, y+14, "B", cWarn, 1)
		}
		if i < len(u.positions)-1 && j < 7 {
			cx, cy := (j+1)*colW, y+h/2
			for k := 0; k < 4; k++ {
				rect(img, cx-3+k, cy-4+k, 1, 1, cDim)
				rect(img, cx-3+k, cy+4-k, 1, 1, cDim)
			}
		}
	}
}

// drawDeviceRow: the selected track's devices over the upper buttons, as
// Push's device view shows them; the one holding the selected device
// filled. Pressing it again lists the banks (bankList). Returns how many.
func (u *surface) drawDeviceRow(img *image.NRGBA, sc color.NRGBA) int {
	devs, sel := u.live.state().deviceRow()
	n := 0
	for i, d := range devs {
		if i >= 8 {
			break
		}
		x := i * colW
		name := fitLabel(strings.ToUpper(d.Name), colW-20)
		if d.I == sel {
			rect(img, x+8, 5, colW-16, 15, sc)
			label(img, x+colW/2, 17, name, cBlack, 0)
		} else {
			label(img, x+colW/2, 17, name, cDim, 0)
		}
		n++
	}
	return n
}

// drawTrackRow: Live's tracks under the lower buttons, as Push's device view
// shows them: the page of 8 holding the selected track, each in its colour,
// the selected one filled. A marker at an edge says there are more.
func (u *surface) drawTrackRow(img *image.NRGBA, y, h int) {
	page, first, sel := u.trackPage()
	tracks, _ := u.live.state().trackRow()
	if first > 0 {
		for k := 0; k < 5; k++ {
			rect(img, 1+k, y+h/2-k, 1, 2*k+1, cFg)
		}
	}
	if first+8 < len(tracks) {
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
		name := fitLabel(t.Name, w-12)
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
	nameCol := cDim
	if u.touched == col {
		nameCol = cFg
		rect(img, cx-16, 43, 32, 2, sc)
	}
	label(img, cx, 38, fitLabel(strings.ToUpper(m.Name), colW-10), nameCol, 0)
	val, unit := m.display(v, ok)
	switch {
	case m.Type == "enum":
		frameRect(img, cx-44, 64, 88, 28, cLine)
		styled(img, cx, 84, fitLabel(val, 80), cFg, faceValue, 0)
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
		styled(img, cx, 84, fitLabel(val, colW-10), cFg, faceValue, 0)
		return
	default:
		gauge(img, cx, knobCY, m.frac(v), m.Bipolar, sc, m.ReadOnly)
	}
	if m.Type != "enum" {
		w := styled(img, 0, -100, val, cFg, faceValue, -1) // measure
		uw := 0
		if unit != "" {
			uw = len(unit)*7 + 3
		}
		x := cx - (w+uw)/2
		styled(img, x, 127, val, cFg, faceValue, -1)
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
	// the value is what the hand is after: the name gives way, never it
	val = fitLabel(strings.ToUpper(val), colW-8)
	vw := len(val) * 7 // Tamzen: 7 px a character
	if room := colW - 8 - vw - 7; room >= 3*7 {
		val = fitLabel(strings.ToUpper(m.Name), room) + " " + val
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
	label(img, x+12, y+18, fitLabel(strings.ToUpper(m.Name), w/2), cFg, -1)
	label(img, x+w-12, y+18, fitLabel(strings.ToUpper(p.Name), w/2-20), cDim, 1)
	vw := styled(img, x+12, y+56, val, cFg, faceBig, -1)
	if unit != "" {
		label(img, x+16+vw, y+56, unit, cDim, -1)
	}
	if m.Type == "enum" && len(m.Options) > 0 {
		i, _ := m.enumIndex(v)
		label(img, x+w-12, y+56, fmt.Sprintf("%d OF %d", i+1, len(m.Options)), cDim, 1)
		// neighbours, so a spin shows where it is going
		if i > 0 {
			label(img, x+12, y+82, "< "+fitLabel(m.Options[i-1], w/2-30), cDim, -1)
		}
		if i+1 < len(m.Options) {
			label(img, x+w-12, y+82, fitLabel(m.Options[i+1], w/2-30)+" >", cDim, 1)
		}
	} else if m.Type == "float" || m.Type == "int" {
		rx, rw, ry := x+12, w-24, y+80
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
		label(img, rx, ry+16, lo, cDim, -1)
		label(img, rx+rw, ry+16, hi, cDim, 1)
	}
	hint := "SHIFT: FINE"
	if m.ReadOnly {
		hint = "READ ONLY"
	}
	label(img, x+12, y+h-6, hint, cDim, -1)
}

// drawBrowser: modules as cards in 8 columns; top row picks, jog moves.
func (u *surface) drawBrowser(img *image.NRGBA) {
	sc := slotColor(u.slot)
	rect(img, 0, 0, scrW, 2, sc)
	verb := "ADD"
	if u.br.mode == "swap" {
		verb = "REPLACE " + strings.ToUpper(u.br.target.Name)
	}
	label(img, 12, 17, fitLabel(verb+" - PICK WITH THE BUTTON ABOVE, OR JOG AND PRESS", 700), cFg, -1)
	page := u.br.cursor / 8 * 8
	pages := (len(u.br.items) + 7) / 8
	if pages > 1 {
		label(img, scrW-12, 17, fmt.Sprintf("PAGE %d/%d", page/8+1, pages), cDim, 1)
	}
	kc := colAfx
	switch u.br.kind {
	case "sound_generator":
		kc = colInst
	case "midi_fx":
		kc = colMidi
	}
	if len(u.br.items) == 0 {
		label(img, scrW/2, 84, "NO MODULES OF THIS KIND ARE INSTALLED", cDim, 0)
	}
	for i := 0; i < 8 && page+i < len(u.br.items); i++ {
		m := u.br.items[page+i]
		x, y, w, h := i*colW+5, 26, colW-10, 108
		on := page+i == u.br.cursor
		bg := rgb(12, 12, 11)
		if on {
			bg = rgb(26, 22, 16)
		}
		rect(img, x, y, w, h, bg)
		if on {
			frameRect(img, x, y, w, h, sc)
			frameRect(img, x+1, y+1, w-2, h-2, sc)
		} else {
			frameRect(img, x, y, w, h, cFaint)
		}
		rect(img, x+8, y+10, 3, 30, kc)
		name := m.Name
		if len(name) > 13 && m.Abbrev != "" {
			name = m.Abbrev
		}
		styled(img, x+8, y+64, fitLabel(name, w-12), cFg, faceName, -1)
		label(img, x+8, y+80, fitLabel(m.Author, w-12), cDim, -1)
		label(img, x+8, y+96, fitLabel(m.Version, w-12), cDim, -1)
		if m.ID == u.br.target.Module {
			label(img, x+18, y+30, "LOADED", sc, -1)
		}
	}
	// bottom row: the categories, and cancel
	for i, c := range []struct{ name, kind string }{{"MIDI FX", "midi_fx"}, {"SYNTHS", "sound_generator"}, {"AUDIO FX", "audio_fx"}} {
		x, w := i*colW+7, colW-14
		if c.kind == u.br.kind {
			rect(img, x, botY+3, w, scrH-botY-6, kc)
			label(img, x+w/2, botY+17, c.name, cBlack, 0)
		} else {
			frameRect(img, x, botY+3, w, scrH-botY-6, cLine)
			label(img, x+w/2, botY+17, c.name, cFg, 0)
		}
	}
	frameRect(img, 7*colW+7, botY+3, colW-14, scrH-botY-6, cWarn)
	label(img, 7*colW+colW/2, botY+17, "CANCEL", cWarn, 0)
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
	if cm == nil || b == nil || u.bankList || p.Module == "" {
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
	pl := placement{w: &ovWidget{keys: comp.screenKeys(), draw: comp.screen}, full: true, info: info}
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
	return map[string]any{"$page": page, "$pages": pages, "$knobs": knobs, "$name": p.Name, "$track": track}
}
