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
	"regexp"
	"strings"
)

// ---- envelopes --------------------------------------------------------------------

// envGroup: one envelope among a page's keys, and the columns it covers.
type envGroup struct {
	prefix     string
	keys       map[string]string // role (attack, decay, hold, sustain, slope, release) -> key
	start, end int               // columns [start, end)
}

var envRole = regexp.MustCompile(`^(.*?)_?(attack|decay|hold|sustain|release)(?:_(time|level|rate))?$`)

// envelopeGroups finds the envelopes on a page: keys whose names end in
// attack, decay, (hold,) sustain, release, sharing what comes before, in
// adjacent columns, in any order (the JV-880 lists release before
// sustain). A group needs an attack and a decay or release. "sustain_time"
// beside a sustain is the Virus's sustain SLOPE.
func envelopeGroups(keys []string) []envGroup {
	type hit struct {
		role string
		col  int
	}
	by := map[string][]hit{}
	var order []string
	for col, k := range keys {
		m := envRole.FindStringSubmatch(strings.ToLower(k))
		if m == nil {
			continue
		}
		role := m[2]
		if role == "sustain" && m[3] == "time" {
			role = "slope"
		}
		p := strings.TrimSuffix(m[1], "_")
		if _, ok := by[p]; !ok {
			order = append(order, p)
		}
		by[p] = append(by[p], hit{role, col})
	}
	var out []envGroup
	for _, p := range order {
		g := envGroup{prefix: p, keys: map[string]string{}, start: 99, end: -1}
		for _, h := range by[p] {
			if _, dup := g.keys[h.role]; dup {
				continue
			}
			g.keys[h.role] = keys[h.col]
			g.start, g.end = min(g.start, h.col), max(g.end, h.col+1)
		}
		_, a := g.keys["attack"]
		_, d := g.keys["decay"]
		_, r := g.keys["release"]
		// attack+decay is an envelope (a pitch envelope often is just that);
		// attack+release alone is a compressor's or a gate's timing, and a
		// drawn envelope would say something false about it
		if !a || (!d && !(r && len(g.keys) >= 3)) || g.end-g.start != len(g.keys) {
			continue // not an envelope, or other knobs between its parts
		}
		out = append(out, g)
	}
	return out
}

// envShape is an envelope to draw: each part 0..1 as its knob shows it.
type envShape struct {
	A, D, H, S, Slope, R       float64
	HasD, HasH, HasS, HasSlope bool
	HasR, Known                bool
	Touched                    string   // the role under a finger, or ""
	Labels                     bool     // the stage letters under it
	Live                       *envLive // what the sound is doing in it (livefx.go); nil: a still picture
}

// mixColor: c faded toward black, for fills (the panel has no alpha).
func mixColor(c color.NRGBA, t float64) color.NRGBA {
	return color.NRGBA{uint8(float64(c.R) * t), uint8(float64(c.G) * t), uint8(float64(c.B) * t), 255}
}

// drawEnvelope draws an envelope in the rect: the shape filled in the
// slot's color, faded; the stages as a line, the one being turned thick and
// in the slot's color; handles where stages meet; the sustain level as a
// guide; the stage letters under it. Unknown values draw a neutral shape,
// dimmed. Times are drawn in proportion to their knobs, never to scale:
// the shape is what the hand turns.
func drawEnvelope(img *image.NRGBA, r image.Rectangle, e envShape, sc color.NRGBA) {
	if !e.Known {
		e = envShape{A: 0.25, D: 0.35, S: 0.6, R: 0.35, HasD: true, HasS: true, HasR: true, Labels: e.Labels}
	}
	fg, accent := cFg, sc
	if !e.Known {
		fg, accent = cDim, cDim
	}
	x0, x1 := float64(r.Min.X+6), float64(r.Max.X-6)
	top, base := float64(r.Min.Y+8), float64(r.Max.Y-6)
	if e.Labels {
		base = float64(r.Max.Y - 18)
	}
	span := x1 - x0
	seg := func(f float64) float64 { return span * (0.05 + 0.25*f) }
	wa := seg(e.A)
	wd, wh, wr := 0.0, 0.0, 0.0
	if e.HasD {
		wd = seg(e.D)
	}
	if e.HasH {
		wh = seg(e.H) * 0.6
	}
	if e.HasR {
		wr = seg(e.R)
	}
	ws := 0.0
	if e.HasS {
		ws = max(span*0.16, span-wa-wd-wh-wr)
	}
	// without a sustain to absorb the rest, the width is what the stages
	// take at their longest: short stages draw short, not stretched
	k := 1.0
	if !e.HasS {
		full := 1.0
		for _, has := range []bool{e.HasD, e.HasR} {
			if has {
				full++
			}
		}
		if e.HasH {
			full += 0.6
		}
		k = span / (seg(1) * full)
	} else if used := wa + wd + wh + ws + wr; used > span {
		k = span / used
	}
	wa, wd, wh, ws, wr = wa*k, wd*k, wh*k, ws*k, wr*k
	lvl := func(f float64) float64 { return base - f*(base-top) }
	sus := 0.0
	if e.HasS {
		sus = e.S
	}
	endSus := sus
	if e.HasSlope { // the Virus: below the middle the sustain falls while held, above it rises
		endSus = max(0, min(1, sus+(e.Slope-0.5)*1.6))
	}
	type pt struct {
		x, y float64
		role string // the stage that ENDS here
	}
	pts := []pt{{x0, base, ""}}
	x := x0 + wa
	pts = append(pts, pt{x, top, "attack"})
	if e.HasH {
		x += wh
		pts = append(pts, pt{x, top, "hold"})
	}
	if e.HasD {
		x += wd
		y := base // an AD envelope decays to nothing
		if e.HasS {
			y = lvl(sus)
		}
		pts = append(pts, pt{x, y, "decay"})
	}
	if e.HasS {
		x += ws
		role := "sustain"
		if e.HasSlope {
			role = "slope"
		}
		pts = append(pts, pt{x, lvl(endSus), role})
	}
	if e.HasR {
		x += wr
		pts = append(pts, pt{x, base, "release"})
	}

	// the fill, column by column under the line
	fill := mixColor(accent, 0.28)
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		for px := int(a.x); px < int(b.x); px++ {
			t := (float64(px) - a.x) / max(1, b.x-a.x)
			y := a.y + (b.y-a.y)*t
			rect(img, px, int(y), 1, int(base-y)+1, fill)
		}
	}
	// the baseline and the sustain level's guide
	aaLine(img, x0, base, x1, base, 1, cLine)
	if e.HasS && e.HasD {
		sy := lvl(sus)
		for gx := x0; gx < pts[len(pts)-2].x; gx += 6 {
			aaLine(img, gx, sy, min(gx+3, x1), sy, 1, mixColor(fg, 0.45))
		}
	}
	// the stages, the touched one thick and in the slot's color
	hot := func(role string) bool {
		return e.Touched == role || (role == "slope" && e.Touched == "sustain")
	}
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		w, c := 2.2, fg
		if hot(b.role) {
			w, c = 3.6, accent
		}
		aaLine(img, a.x, a.y, b.x, b.y, w, c)
	}
	// handles where stages meet; sustain's handle sits on its level
	for i := 1; i < len(pts)-1; i++ {
		p, rad, c := pts[i], 3.0, fg
		if hot(p.role) || (p.role == "decay" && e.Touched == "sustain") {
			rad, c = 4.5, accent
		}
		disc(img, p.x, p.y, rad, c)
	}
	// the sound in it, as it plays (livefx.go): the notes' gate along the
	// base; the stage the amplitude is in, lit as far as it has gone, with a
	// playhead and a short trail; or a mark per voice where the stage times
	// are known
	lv := e.Live
	if lv != nil && !e.Known {
		lv = nil
	}
	lit := func(role string) bool { return false }
	if lv != nil {
		seg := func(stage string) int {
			if stage == "sustain" && e.HasSlope {
				stage = "slope"
			}
			for i := 1; i < len(pts); i++ {
				if pts[i].role == stage {
					return i
				}
			}
			return -1
		}
		at := func(p envPoint) (float64, float64, bool) {
			i := seg(p.Stage)
			if i < 0 {
				return 0, 0, false
			}
			a, b := pts[i-1], pts[i]
			t := math.Max(0, math.Min(1, p.Progress))
			return a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t, true
		}
		rel := seg("release")
		switch {
		case lv.Held:
			to := pts[len(pts)-1].x
			if rel > 0 {
				to = pts[rel-1].x
			}
			rect(img, int(x0), int(base)-1, int(to-x0), 3, cMod)
		case lv.Ringing && rel > 0:
			rect(img, int(pts[rel-1].x), int(base)-1, int(pts[rel].x-pts[rel-1].x), 3, mixColor(cMod, 0.55))
		}
		if lv.Retrig > 0 { // a note began: the envelope starts again
			aaLine(img, x0, top, x0, base, 2.4, mixColor(cMod, lv.Retrig))
		}
		switch lv.Mode {
		case "measured":
			for i := 0; i+1 < len(lv.Trail); i++ {
				if x, y, ok := at(lv.Trail[i]); ok {
					k := float64(i+1) / float64(len(lv.Trail))
					disc(img, x, y, 1.4+1.6*k, mixColor(cMod, 0.12+0.45*k))
				}
			}
			if lv.Stage != "" {
				if i := seg(lv.Stage); i > 0 {
					x, y, _ := at(envPoint{Stage: lv.Stage, Progress: lv.Progress})
					aaLine(img, pts[i-1].x, pts[i-1].y, x, y, 3.4, cMod) // the stage so far
					for gy := y + 7; gy < base-2; gy += 5 {
						aaLine(img, x, gy, x, math.Min(gy+2, base-2), 1, mixColor(cMod, 0.6))
					}
					disc(img, x, y, 6, cBlack)
					disc(img, x, y, 4.3, cMod)
				}
				lit = func(role string) bool {
					return role == lv.Stage || (role == "slope" && lv.Stage == "sustain")
				}
			}
		case "timed":
			for _, v := range lv.Voices {
				if x, y, ok := at(v); ok {
					disc(img, x, y, 6, cBlack)
					disc(img, x, y, 2.6+1.8*v.Vel, cMod)
				}
			}
			lit = func(role string) bool {
				for _, v := range lv.Voices {
					if role == v.Stage || (role == "slope" && v.Stage == "sustain") {
						return true
					}
				}
				return false
			}
		default: // the notes only: held is everything up to the release
			lit = func(role string) bool {
				if role == "release" {
					return lv.Ringing
				}
				return lv.Held
			}
		}
	}
	// the stage letters, under their segments
	if e.Labels {
		letter := map[string]string{"attack": "A", "hold": "H", "decay": "D", "sustain": "S", "slope": "S", "release": "R"}
		for i := 1; i < len(pts); i++ {
			a, b := pts[i-1], pts[i]
			c := cDim
			if lit(b.role) {
				c = cMod
			}
			if hot(b.role) {
				c = accent
			}
			label(img, int((a.x+b.x)/2), int(base)+14, letter[b.role], c, 0)
		}
	}
}

// envShapeOf reads a group's values (what the default view and the web
// show) into a shape.
func envShapeOf(g envGroup, vals map[string]ovValue, touchedKey string) envShape {
	e := envShape{Known: true, Labels: true}
	get := func(role string) (float64, bool) {
		k, ok := g.keys[role]
		if !ok {
			return 0, false
		}
		v := vals[k]
		if !v.Known {
			e.Known = false
		}
		if k == touchedKey {
			e.Touched = role
		}
		return v.Frac, true
	}
	e.A, _ = get("attack")
	e.D, e.HasD = get("decay")
	e.H, e.HasH = get("hold")
	e.S, e.HasS = get("sustain")
	e.Slope, e.HasSlope = get("slope")
	e.R, e.HasR = get("release")
	return e
}
