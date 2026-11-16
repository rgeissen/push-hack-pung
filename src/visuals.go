package main

// visuals.go: the pictures Pung draws for a structure it recognizes in any
// module's parameters (docs/UX-GUIDELINES.md, "Recognized structures"). A
// module needs no code for them; the default view draws them over the knobs
// they describe, a custom screen draws the same picture with g.envelope, and
// the web page draws it again from the same rules (web/app.js), so the three
// look alike by construction.

import (
	"image"
	"image/color"
	"math"
)


// ---- envelopes (envmodel.go says what one is) ----------------------------------------

// mixColor: c faded toward black, for fills (the panel has no alpha).
func mixColor(c color.NRGBA, t float64) color.NRGBA {
	return color.NRGBA{uint8(float64(c.R) * t), uint8(float64(c.G) * t), uint8(float64(c.B) * t), 255}
}


// drawEnvelope draws an envelope in the rect: the shape filled in the
// slot's color, faded; its segments as a line, the touched one thick and in
// the slot's color; handles where segments meet; the plateau's level as a
// guide; and, with Labels, the stage bar under it. Unknown values draw a
// neutral shape, dimmed. With Live, every note is a dot on its own clock
// (envclock.go). Widths are the knobs' travel, never a time scale: the
// shape is what the hand turns, the dot is what the sound does.
func drawEnvelope(img *image.NRGBA, r image.Rectangle, e envShape, sc color.NRGBA) {
	fg, accent := cFg, sc
	if !e.Known {
		fg, accent = cDim, cDim
	}
	x0, x1 := float64(r.Min.X+6), float64(r.Max.X-6)
	top, base := float64(r.Min.Y+8), float64(r.Max.Y-6)
	if e.Labels {
		base = float64(r.Max.Y - 20)
	}
	if len(e.Segs) == 0 {
		return
	}
	pts, _ := envLayout(e, x0, x1, top, base)
	floor := base // where the fill falls to: the middle of a signed envelope
	if e.Signed {
		floor = (top + base) / 2
	}
	// the fill, column by column between the line and its floor
	fill := mixColor(accent, 0.28)
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		for px := int(a.X); px < int(b.X); px++ {
			t := (float64(px) - a.X) / max(1, b.X-a.X)
			y := a.Y + (b.Y-a.Y)*t
			lo, hi := math.Min(y, floor), math.Max(y, floor)
			rect(img, px, int(lo), 1, int(hi-lo)+1, fill)
		}
	}
	aaLine(img, x0, base, x1, base, 1, cLine)
	if e.Signed {
		aaLine(img, x0, floor, x1, floor, 1, cLine)
	}
	// the plateau's level, as a guide from the start
	pl := e.plateau()
	if pl > 0 {
		sy := pts[pl].Y
		for gx := x0; gx < pts[pl].X; gx += 6 {
			aaLine(img, gx, sy, min(gx+3, x1), sy, 1, mixColor(fg, 0.45))
		}
	}
	// the segments, the touched one thick and in the slot's color
	for i := 1; i < len(pts); i++ {
		w, c := 2.2, fg
		if e.Hot == i-1 {
			w, c = 3.6, accent
		}
		aaLine(img, pts[i-1].X, pts[i-1].Y, pts[i].X, pts[i].Y, w, c)
	}
	// handles where segments meet
	for i := 1; i < len(pts)-1; i++ {
		rad, c := 3.0, fg
		if e.Corner == i {
			rad, c = 4.5, accent
		}
		disc(img, pts[i].X, pts[i].Y, rad, c)
	}
	// the sound in it, as it plays (envclock.go): each note a dot running
	// along the lines on its clock, a short trail behind it; the newest
	// note's segment lit up to its dot, with a hairline down to the base
	lv := e.Live
	if !e.Known || e.Still {
		lv = nil
	}
	at := func(p envPos) (float64, float64, int) {
		i := p.Seg
		if i < 0 || i+1 >= len(pts) {
			return 0, 0, -1
		}
		a, b := pts[i], pts[i+1]
		t := math.Max(0, math.Min(1, p.Prog))
		return a.X + (b.X-a.X)*t, a.Y + (b.Y-a.Y)*t, i
	}
	lit := map[int]bool{}
	if lv != nil {
		if lv.Retrig > 0 { // a note began: the envelope starts again
			aaLine(img, x0, top, x0, base, 2.4, mixColor(cMod, lv.Retrig))
		}
		dt := 0.0 // the frame's ages, carried on to now
		if lv.At > 0 {
			dt = math.Max(0, math.Min(0.25, (liveNow() - lv.At).Seconds()))
		}
		for n := len(lv.Voices) - 1; n >= 0; n-- { // the newest drawn last, on top
			v := lv.Voices[n]
			cur := envAt(v, dt, e)
			if cur.Done {
				continue
			}
			lit[cur.Seg] = true
			for k := trailLen; k >= 1; k-- {
				back := dt - float64(k)*envTrailDT
				if v.Age+back < 0 {
					continue
				}
				if q := envAt(v, back, e); !q.Done {
					if x, y, i := at(q); i >= 0 {
						f := 1 - float64(k)/float64(trailLen+1)
						disc(img, x, y, 1.2+1.6*f, mixColor(cMod, 0.1+0.4*f))
					}
				}
			}
			x, y, i := at(cur)
			if i < 0 {
				continue
			}
			rad := 3.2 + 1.4*v.Vel
			if n == 0 {
				aaLine(img, pts[i].X, pts[i].Y, x, y, 3.4, cMod) // the segment so far
				for gy := y + 7; gy < base-2; gy += 5 {
					aaLine(img, x, gy, x, math.Min(gy+2, base-2), 1, mixColor(cMod, 0.6))
				}
				rad = 4.6
			}
			disc(img, x, y, rad+1.8, cBlack)
			disc(img, x, y, rad, cMod)
		}
	}
	// the stage bar: one segment per drawn segment, exactly as wide; lit
	// while a note's dot is in it, outlined in the slot's color while one of
	// its knobs is touched
	if e.Labels {
		by, bh := int(base)+4, 13
		for i := 1; i < len(pts); i++ {
			sx, ex := int(math.Round(pts[i-1].X))+1, int(math.Round(pts[i].X))-1
			if i == 1 {
				sx = int(math.Round(pts[i-1].X))
			}
			if i == len(pts)-1 {
				ex = int(math.Round(pts[i].X))
			}
			w := ex - sx
			if w < 2 {
				continue
			}
			s := e.Segs[i-1]
			bg, ink := cStageOff, cDim
			if !e.Known {
				bg = cFaint
			}
			if lit[i-1] {
				bg, ink = cMod, cBlack
			}
			rect(img, sx, by, w, bh, bg)
			if e.Hot == i-1 {
				rect(img, sx, by, w, 1, accent)
				rect(img, sx, by+bh-1, w, 1, accent)
				rect(img, sx, by, 1, bh, accent)
				rect(img, ex-1, by, 1, bh, accent)
				if !lit[i-1] {
					ink = accent
				}
			}
			if txt := envBarLabel(s.Label, float64(w)); txt != "" {
				label(img, sx+w/2, by+bh-2, txt, ink, 0)
			}
		}
	}
}

// envBarLabel: a stage's name, if it fits its segment (a letter needs 9
// pixels, two 16, three 22).
func envBarLabel(l string, w float64) string {
	if w >= 7+7*float64(len(l)) || (len(l) == 1 && w >= 9) {
		return l
	}
	return ""
}

// cStageOff: a stage's segment while no note is in it.
var cStageOff = color.NRGBA{40, 42, 46, 255}
