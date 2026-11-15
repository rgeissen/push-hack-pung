package main

// draw.go: drawing helpers for the Push screen (960x160, 8 columns of 120 px
// under the 8 encoders and the two button rows). Strings that reach the
// panel are ASCII only (push-hack CLAUDE.md: the faces have no other glyph).

import (
	"image"
	"image/color"
	"math"

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
	faceBig   font.Face
	faceName  font.Face
)

func initFaces() {
	faceValue, _ = text.NewFace(text.Regular, 16)
	faceBig, _ = text.NewFace(text.Regular, 28)
	faceName, _ = text.NewFace(text.Bold, 15)
}

func newFrame() *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
	gfx.FillRect(img, 0, 0, scrW, scrH, cBlack)
	return img
}

// label draws Tamzen (uppercase, 7 px advance). align: -1 left, 0 center, 1 right.
func label(img *image.NRGBA, x, baseline int, s string, col color.NRGBA, align int) {
	s = asciiOnly(s)
	w := text.Width(s)
	switch align {
	case 0:
		x -= w / 2
	case 1:
		x -= w
	}
	text.Draw(img, x, baseline, s, col)
}

// styled draws a value face. align as label.
func styled(img *image.NRGBA, x, baseline int, s string, col color.NRGBA, face font.Face, align int) int {
	s = asciiOnly(s)
	if face == nil {
		label(img, x, baseline, s, col, align)
		return text.Width(s)
	}
	w := text.WidthWith(s, face)
	switch align {
	case 0:
		x -= w / 2
	case 1:
		x -= w
	}
	text.DrawWith(img, x, baseline, s, col, face)
	return w
}

// fitLabel cuts s so it draws within w pixels in the label face.
func fitLabel(s string, w int) string {
	s = asciiOnly(s)
	max := w / 7
	if len(s) <= max {
		return s
	}
	if max < 2 {
		return s[:max]
	}
	return s[:max-1] + "."
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
func gauge(img *image.NRGBA, cx, cy int, frac float64, bipolar bool, col color.NRGBA, readOnly bool) {
	frac = math.Max(0, math.Min(1, frac))
	x, y := float64(cx), float64(cy)
	track := cFaint
	if readOnly {
		// a read-only value is a dotted ring: same place, no promise of a knob
		for i := 0; i <= 30; i++ {
			a := gaugeA0 + gaugeSW*float64(i)/30
			disc(img, x+math.Cos(a)*knobR, y+math.Sin(a)*knobR, 1.1, cLine)
		}
	} else {
		arc(img, x, y, knobR, gaugeA0, gaugeSW, 3, track)
	}
	if bipolar {
		mid := gaugeA0 + gaugeSW/2
		e := gaugeA0 + gaugeSW*frac
		if e > mid {
			arc(img, x, y, knobR, mid, e-mid, 3, col)
		} else {
			arc(img, x, y, knobR, e, mid-e, 3, col)
		}
	} else if !readOnly {
		arc(img, x, y, knobR, gaugeA0, gaugeSW*frac, 3, col)
	}
	a := gaugeA0 + gaugeSW*frac
	disc(img, x+math.Cos(a)*(knobR-8), y+math.Sin(a)*(knobR-8), 2.2, cFg)
}

func rect(img *image.NRGBA, x, y, w, h int, c color.NRGBA) { gfx.FillRect(img, x, y, w, h, c) }

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
	for i := 0; i < n; i++ {
		c := cFaint
		if (float64(i)+0.5)/n < v {
			c = col
			if i >= 8 {
				c = cWarn
			}
		}
		rect(img, x+i*(sw+1), y, sw, h, c)
	}
}

// dbFrac maps dBFS to a meter fraction (-48 dB .. 0 dB).
func dbFrac(db float64) float64 { return math.Max(0, math.Min(1, (db+48)/48)) }
