package main

// draw.go: drawing helpers for the Push screen (960x160, 8 columns of 120 px
// under the 8 encoders and the two button rows). Strings that reach the
// panel are ASCII only (push-hack CLAUDE.md: the faces have no other glyph).

import (
	"image"
	"image/color"
	"math"
	"strconv"
	"strings"

	"github.com/federico-pepe/ableton-push-hack/core/gfx"
	"github.com/federico-pepe/ableton-push-hack/core/gfx/text"
	"github.com/federico-pepe/ableton-push-hack/core/push3"
	"golang.org/x/image/font"
)

const (
	scrW   = 960
	scrH   = 160
	colW   = 120
	topH   = 22
	botY   = 138
	knobCY = 80
	knobR  = 23
)

func pc(name string) color.NRGBA {
	if i, ok := push3.ColorByName(name); ok {
		return push3.ColorForIndex(i).RGB
	}
	return color.NRGBA{255, 0, 255, 255}
}

var (
	cBlack  = color.NRGBA{0, 0, 0, 255}
	cFg     = color.NRGBA{238, 236, 230, 255}
	cDim    = color.NRGBA{140, 138, 132, 255}
	cFaint  = color.NRGBA{38, 38, 36, 255}
	cLine   = color.NRGBA{64, 63, 60, 255}
	cMod    = color.NRGBA{60, 200, 230, 255}
	cPMod   = color.NRGBA{255, 122, 226, 255} // Pung's own modulation (pungmod.go): the whole sound
	cWarn   = color.NRGBA{255, 90, 78, 255}
	colMidi = color.NRGBA{164, 140, 255, 255}
	colInst = color.NRGBA{255, 138, 31, 255}
	colAfx  = color.NRGBA{63, 201, 162, 255}
)

// slotColors: one identity color per slot, from the Push palette.
var slotColors = []color.NRGBA{
	{255, 138, 31, 255}, {90, 176, 255, 255}, {255, 95, 162, 255}, {123, 216, 143, 255},
	{255, 210, 63, 255}, {164, 140, 255, 255}, {60, 200, 230, 255}, {255, 90, 78, 255},
}

func slotColor(i int) color.NRGBA { return slotColors[i%len(slotColors)] }

var (
	faceValue font.Face
	faceSmall font.Face // a value that does not fit faceValue, before it is cut
	faceBig   font.Face
	faceName  font.Face
)

func initFaces() {
	faceValue, _ = text.NewFace(text.Regular, 16)
	faceSmall, _ = text.NewFace(text.Regular, 13)
	faceBig, _ = text.NewFace(text.Regular, 28)
	faceName, _ = text.NewFace(text.Bold, 15)
}

// textSpy, when set (tests), is told the box of every text drawn: what
// view_test.go checks against the element the text belongs to.
var textSpy func(box image.Rectangle, s string)

func spyText(x, baseline, w int, face font.Face, s string) {
	if textSpy == nil || s == "" {
		return
	}
	asc, desc := 10, 0 // Tamzen 7x13: capitals stand on the baseline
	if strings.ContainsAny(s, "gjpqy,;_()[]{}|$@") {
		desc = 3
	}
	if face != nil {
		m := face.Metrics()
		asc, desc = m.Ascent.Ceil(), m.Descent.Ceil()
	}
	textSpy(image.Rect(x, baseline-asc, x+w, baseline+desc), s)
}

func newFrame() *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
	rect(img, 0, 0, scrW, scrH, cBlack)
	return img
}

// label draws Tamzen (uppercase, 7 px advance). align: -1 left, 0 center, 1 right.
// A "±" (Tamzen has none) is drawn by hand in its cell: a plus over a bar.
func label(img *image.NRGBA, x, baseline int, s string, col color.NRGBA, align int) {
	s = asciiOnly(s)
	plain := strings.ReplaceAll(s, plusMinus, " ")
	w := text.Width(plain)
	switch align {
	case 0:
		x -= w / 2
	case 1:
		x -= w
	}
	spyText(x, baseline, w, nil, plain)
	text.Draw(img, x, baseline, plain, col)
	for i := strings.Index(s, plusMinus); i >= 0; {
		cx := x + text.Width(plain[:i])
		rect(img, cx+1, baseline-6, 5, 1, col) // the plus's bar
		rect(img, cx+3, baseline-8, 1, 5, col) // its stem
		rect(img, cx+1, baseline-1, 5, 1, col) // the minus under it
		j := strings.Index(s[i+1:], plusMinus)
		if j < 0 {
			break
		}
		i += 1 + j
	}
}

// plusMinus: how asciiOnly keeps a "±" for label to draw (DEL, never text);
// the value faces and anything leaving Pung read it as "+-" (unPM)
const plusMinus = "\x7f"

func unPM(s string) string { return strings.ReplaceAll(s, plusMinus, "+-") }

// styled draws a value face. align as label.
func styled(img *image.NRGBA, x, baseline int, s string, col color.NRGBA, face font.Face, align int) int {
	s = asciiOnly(s)
	if face == nil {
		label(img, x, baseline, s, col, align)
		return text.Width(strings.ReplaceAll(s, plusMinus, " "))
	}
	s = unPM(s)
	w := text.WidthWith(s, face)
	switch align {
	case 0:
		x -= w / 2
	case 1:
		x -= w
	}
	spyText(x, baseline, w, face, s)
	text.DrawWith(img, x, baseline, s, col, face)
	return w
}

// textWidth: s's width in face (nil: the label face).
func textWidth(s string, face font.Face) int {
	s = asciiOnly(s)
	if face == nil {
		return text.Width(strings.ReplaceAll(s, plusMinus, " "))
	}
	return text.WidthWith(unPM(s), face)
}

// fitLabel cuts s so it draws within w pixels in the label face.
func fitLabel(s string, w int) string { return fitText(s, w, nil) }

// fitText cuts s so it draws within w pixels in face (nil: the label face),
// measured, never counted: the value faces are proportional. A cut ends in
// "." so it reads as one.
func fitText(s string, w int, face font.Face) string {
	s = asciiOnly(s)
	if w <= 0 {
		return ""
	}
	// no glyph is narrower than 2 px: a longer text (TinyHouse answers a
	// wavetable's whole list as one value) is cut to what could fit before
	// it is measured; measuring it whole, then one letter shorter at a time,
	// took 200 ms a frame
	if len(s) > w/2+1 {
		s = s[:w/2+1]
	} else if textWidth(s, face) <= w {
		return s
	}
	// the longest cut that fits: the width grows with the length
	cut := func(n int) string { return strings.TrimRight(s[:n], " ") + "." }
	lo, hi := 0, len(s)-1 // cut(lo) fits (lo 0: nothing does), cut(hi+1) does not
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if textWidth(cut(mid), face) <= w {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	if lo == 0 {
		return ""
	}
	return cut(lo)
}

// fitValue: a value in the largest value face it fits w in, the value
// face, then a smaller one, cut in that one only where neither holds it (a
// value is what the hand is after: the name gives way, never it). A number
// is never cut, a cut number reads as another number: -24000 is -24K.
func fitValue(s string, w int) (string, font.Face) {
	s = asciiOnly(s)
	// longer than w/2 letters fits no face (no glyph is under 2 px): not
	// measured whole (fitText)
	short := len(s) <= w/2+1
	for _, f := range []font.Face{faceValue, faceSmall} {
		if f != nil && short && textWidth(s, f) <= w {
			return s, f
		}
	}
	if len(s) <= 32 { // a number: -24000 is -24K
		if n := fitNumber(s, w, faceSmall); n != "" {
			return n, faceSmall
		}
	}
	if _, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil {
		return "", faceSmall
	}
	return fitText(s, w, faceSmall), faceSmall
}

// fitRange: a range's two ends in w each, in one form: when one end must be
// shortened (-24K), the other is too (24K, not 24000).
func fitRange(lo, hi string, w int) (string, string) {
	l, h := fitNumber(lo, w, nil), fitNumber(hi, w, nil)
	if l != lo || h != hi {
		if l2 := fitNumber(lo, textWidth(lo, nil)-1, nil); l == lo && l2 != "" {
			l = l2
		}
		if h2 := fitNumber(hi, textWidth(hi, nil)-1, nil); h == hi && h2 != "" {
			h = h2
		}
	}
	return l, h
}

// fitNumber: s if it fits w in face; a number too wide in thousands or
// millions (-24000: -24K, 1500000: 1.5M); else "" (shown nowhere, rather
// than as a different number). Text too wide: "" too (fitText cuts text).
func fitNumber(s string, w int, face font.Face) string {
	if textWidth(s, face) <= w {
		return s
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return ""
	}
	for _, u := range []struct {
		div float64
		suf string
	}{{1e3, "K"}, {1e6, "M"}} {
		if math.Abs(f) < u.div {
			continue
		}
		for _, prec := range []int{1, 0} {
			c := strconv.FormatFloat(f/u.div, 'f', prec, 64)
			if strings.Contains(c, ".") {
				c = strings.TrimRight(strings.TrimRight(c, "0"), ".")
			}
			if c += u.suf; textWidth(c, face) <= w {
				return c
			}
		}
	}
	return ""
}

func asciiOnly(s string) string {
	b := make([]byte, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 32 && r < 127:
			b = append(b, byte(r))
		case r == 0x2192: // arrow
			b = append(b, '>')
		case r == 0x2212: // minus
			b = append(b, '-')
		case r == 0xb1 || r == 0x7f: // plus-minus (or one asciiOnly kept already): label draws it
			b = append(b, plusMinus...)
		}
	}
	return string(b)
}

func blend(img *image.NRGBA, x, y int, c color.NRGBA, a float64) {
	if !(image.Point{x, y}).In(img.Rect) || a <= 0 {
		return
	}
	if a > 1 {
		a = 1
	}
	i := img.PixOffset(x, y)
	p := img.Pix[i : i+4 : i+4]
	p[0] = uint8(float64(p[0])*(1-a) + float64(c.R)*a)
	p[1] = uint8(float64(p[1])*(1-a) + float64(c.G)*a)
	p[2] = uint8(float64(p[2])*(1-a) + float64(c.B)*a)
	p[3] = 255
}

// arc draws an anti-aliased ring segment. Angles in radians, 0 = 3 o'clock,
// clockwise (screen y grows down), from a0 sweeping by sw (>0).
func arc(img *image.NRGBA, cx, cy, r float64, a0, sw, width float64, c color.NRGBA) {
	if sw <= 0 {
		return
	}
	ext := int(r + width + 2)
	for y := -ext; y <= ext; y++ {
		for x := -ext; x <= ext; x++ {
			d := math.Hypot(float64(x)+0.5, float64(y)+0.5)
			cov := width/2 + 0.5 - math.Abs(d-r)
			if cov <= 0 {
				continue
			}
			ang := math.Atan2(float64(y)+0.5, float64(x)+0.5)
			rel := math.Mod(ang-a0+4*math.Pi, 2*math.Pi)
			if rel > sw+0.02 {
				continue
			}
			blend(img, int(cx)+x, int(cy)+y, c, cov)
		}
	}
}

func disc(img *image.NRGBA, cx, cy, r float64, c color.NRGBA) {
	ext := int(r + 2)
	for y := -ext; y <= ext; y++ {
		for x := -ext; x <= ext; x++ {
			d := math.Hypot(float64(x)+0.5-0.5, float64(y)+0.5-0.5)
			blend(img, int(cx)+x, int(cy)+y, c, r+0.5-d)
		}
	}
}

const (
	gaugeA0 = math.Pi * 2 / 3 // 7 o'clock
	gaugeSW = math.Pi * 5 / 3 // 300 degrees, gap at the bottom
)

// gauge: the 300-degree dial. frac 0..1; bipolar fills from the top; eff >= 0
// draws modulation (the live value) as an outer arc.
// gauge: hot is the touched one: its track lighter, its value arc thicker.
func gauge(img *image.NRGBA, cx, cy int, frac float64, bipolar bool, col color.NRGBA, readOnly, hot bool) {
	gaugeP(img, cx, cy, frac, bipolar, col, readOnly, hot, defaultPal)
}

// gaugeP: gauge in a module's theme (theme.go), as its instrument's knob:
// "ring" (Pung's), "pointer" (a hardware knob: a cap with a pointer, the
// value as an arc around it), "fader" (a slot and a cap).
func gaugeP(img *image.NRGBA, cx, cy int, frac float64, bipolar bool, col color.NRGBA, readOnly, hot bool, P *palette) {
	frac = math.Max(0, math.Min(1, frac))
	switch {
	case readOnly || P.knob == "ring" || P.knob == "":
	case P.knob == "pointer":
		x, y := float64(cx), float64(cy)
		w := 2.5
		if hot {
			w = 4
		}
		arc(img, x, y, knobR, gaugeA0, gaugeSW, w, P.faint)
		if bipolar {
			mid, e := gaugeA0+gaugeSW/2, gaugeA0+gaugeSW*frac
			arc(img, x, y, knobR, math.Min(mid, e), math.Abs(e-mid), w, col)
		} else {
			arc(img, x, y, knobR, gaugeA0, gaugeSW*frac, w, col)
		}
		disc(img, x, y, knobR-6, P.line)
		disc(img, x, y, knobR-8, P.panel)
		a := gaugeA0 + gaugeSW*frac
		ink := P.onCap()
		if hot {
			ink = col
		}
		aaLine(img, x+math.Cos(a)*3, y+math.Sin(a)*3, x+math.Cos(a)*(knobR-9), y+math.Sin(a)*(knobR-9), 3, ink)
		return
	case P.knob == "fader":
		top, bot := cy-knobR+2, cy+knobR-2
		rect(img, cx-2, top, 4, bot-top, P.faint)
		lvl := bot - int(math.Round(frac*float64(bot-top)))
		from := bot
		if bipolar {
			from = (top + bot) / 2
		}
		rect(img, cx-1, min(lvl, from), 2, max(1, abs(from-lvl)), col)
		cw := 26
		if hot {
			cw = 30
		}
		rect(img, cx-cw/2, lvl-4, cw, 9, P.line)
		rect(img, cx-cw/2+1, lvl-3, cw-2, 7, P.panel)
		ink := P.onCap()
		if hot {
			ink = col
		}
		rect(img, cx-cw/2+3, lvl, cw-6, 1, ink)
		return
	}
	gaugeRing(img, cx, cy, frac, bipolar, col, readOnly, hot, P)
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func gaugeRing(img *image.NRGBA, cx, cy int, frac float64, bipolar bool, col color.NRGBA, readOnly, hot bool, P *palette) {
	frac = math.Max(0, math.Min(1, frac))
	x, y := float64(cx), float64(cy)
	track, w := P.faint, 3.0
	if hot {
		track, w = P.line, 5
	}
	if readOnly {
		// a read-only value is a dotted ring: same place, no promise of a knob
		for i := 0; i <= 30; i++ {
			a := gaugeA0 + gaugeSW*float64(i)/30
			disc(img, x+math.Cos(a)*knobR, y+math.Sin(a)*knobR, 1.1, P.line)
		}
	} else {
		arc(img, x, y, knobR, gaugeA0, gaugeSW, w, track)
	}
	if bipolar {
		mid := gaugeA0 + gaugeSW/2
		e := gaugeA0 + gaugeSW*frac
		if e > mid {
			arc(img, x, y, knobR, mid, e-mid, w, col)
		} else {
			arc(img, x, y, knobR, e, mid-e, w, col)
		}
	} else if !readOnly {
		arc(img, x, y, knobR, gaugeA0, gaugeSW*frac, w, col)
	}
	a := gaugeA0 + gaugeSW*frac
	disc(img, x+math.Cos(a)*(knobR-8), y+math.Sin(a)*(knobR-8), 2.2, P.fg)
}

// rect fills a rectangle. A solid colour is written straight into the
// pixels: the library's fill blends pixel by pixel through interfaces, and a
// frame's ground alone took 5 % of Pung's processor time that way (profiled
// on a Push, 2026-11-18).
func rect(img *image.NRGBA, x, y, w, h int, c color.NRGBA) {
	if c.A != 255 {
		gfx.FillRect(img, x, y, w, h, c)
		return
	}
	r := image.Rect(x, y, x+w, y+h).Intersect(img.Rect)
	if r.Empty() {
		return
	}
	row := img.Pix[img.PixOffset(r.Min.X, r.Min.Y):]
	n := r.Dx() * 4
	for i := 0; i < n; i += 4 {
		row[i], row[i+1], row[i+2], row[i+3] = c.R, c.G, c.B, 255
	}
	first := row[:n]
	for yy := r.Min.Y + 1; yy < r.Max.Y; yy++ {
		copy(img.Pix[img.PixOffset(r.Min.X, yy):], first)
	}
}

func frameRect(img *image.NRGBA, x, y, w, h int, c color.NRGBA) {
	gfx.FillRect(img, x, y, w, 1, c)
	gfx.FillRect(img, x, y+h-1, w, 1, c)
	gfx.FillRect(img, x, y, 1, h, c)
	gfx.FillRect(img, x+w-1, y, 1, h, c)
}

func dim(c color.NRGBA, k float64) color.NRGBA {
	return color.NRGBA{uint8(float64(c.R) * k), uint8(float64(c.G) * k), uint8(float64(c.B) * k), 255}
}

// hmeter: a segmented level meter, v in 0..1.
func hmeter(img *image.NRGBA, x, y, w, h int, v float64, col color.NRGBA) {
	const n = 10
	sw := (w - (n - 1)) / n
	// at rest a floor, not ten dim blocks: those read as an indicator that
	// does not work, where this is a meter waiting for sound
	rect(img, x, y+h-1, n*(sw+1)-1, 1, cLine)
	for i := 0; i < n; i++ {
		if (float64(i)+0.5)/n >= v {
			continue
		}
		c := col
		if i >= 8 {
			c = cWarn
		}
		rect(img, x+i*(sw+1), y, sw, h, c)
	}
}

// dbFrac maps dBFS to a meter fraction (-48 dB .. 0 dB).
func dbFrac(db float64) float64 { return math.Max(0, math.Min(1, (db+48)/48)) }

// modMark: where modulation puts a knob now (livemod.go; UX-GUIDELINES.md,
// Live pictures): outside the ring, in the modulation colour, an arc from
// where the knob stands to where the sound has it and a playhead dot there,
// ringed in the ground; beside a fader, the same upright.
func modMark(img *image.NRGBA, cx, cy int, frac, now float64, P *palette) {
	frac, now = math.Max(0, math.Min(1, frac)), math.Max(0, math.Min(1, now))
	x, y := float64(cx), float64(cy)
	if P.knob == "fader" {
		top, bot := float64(cy-knobR+2), float64(cy+knobR-2)
		at := func(f float64) float64 { return bot - f*(bot-top) }
		a, b, xx := at(frac), at(now), x+20
		if d := math.Abs(a - b); d >= 1 {
			rect(img, int(xx)-1, int(math.Min(a, b)), 2, int(d), P.mix(cMod, 0.55))
		}
		disc(img, xx, b, 4.2, P.ground)
		disc(img, xx, b, 3.2, cMod)
		return
	}
	r := float64(knobR) + 6
	lo, hi := math.Min(frac, now), math.Max(frac, now)
	if hi-lo > 0.004 {
		arc(img, x, y, r, gaugeA0+gaugeSW*lo, gaugeSW*(hi-lo), 2, P.mix(cMod, 0.55))
	}
	a := gaugeA0 + gaugeSW*now
	px, py := x+math.Cos(a)*r, y+math.Sin(a)*r
	disc(img, px, py, 4.2, P.ground)
	disc(img, px, py, 3.2, cMod)
}
