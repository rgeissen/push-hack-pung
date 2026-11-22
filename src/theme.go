package main

import (
	"image/color"
	"strings"
)

// A module's theme (push.theme in its screen file): the colours and the knob
// its instrument has, so that Pung's default pages (the cells, the knobs,
// the envelopes, filters, LFOs and mixers it draws for every page without
// a screen of its own) look like the rest of the instrument instead of
// Pung's grey. Push's two rows stay Push's; the band between them is the
// module's. The touched control stays in the slot's colour, as on every
// front panel. docs/overrides.md, "push.theme".
type palette struct {
	ground, panel                color.NRGBA // the band's ground; plates, boxes, a pointer knob's cap
	fg, dim, faint, line         color.NRGBA // values and curves; names; tracks; rules
	accent                       color.NRGBA // a value's arc, a curve's fill (Pung's: the slot colour)
	stageOff, specFill, specLine color.NRGBA // the stage bar, the spectrum behind a filter
	knob                         string      // "ring" (Pung's), "pointer", "fader"
	themed, hasAccent            bool
}

var defaultPal = &palette{ground: cBlack, panel: cFaint, fg: cFg, dim: cDim, faint: cFaint, line: cLine,
	stageOff: cStageOff, specFill: cSpecFill, specLine: cSpecLine, knob: "ring"}

// palOf: a picture's palette, Pung's own where it has none.
func palOf(p *palette) *palette {
	if p == nil {
		return defaultPal
	}
	return p
}

// mix: c at strength t over the ground (Pung's ground is black: c darkened).
func (p *palette) mix(c color.NRGBA, t float64) color.NRGBA {
	if !p.themed {
		return mixColor(c, t)
	}
	return lerpColor(p.ground, c, t)
}

// accentOr: the theme's accent, else sc (the slot's colour).
func (p *palette) accentOr(sc color.NRGBA) color.NRGBA {
	if p != nil && p.hasAccent {
		return p.accent
	}
	return sc
}

func lerpColor(a, b color.NRGBA, t float64) color.NRGBA {
	t = max(0, min(1, t))
	f := func(x, y uint8) uint8 { return uint8(float64(x) + (float64(y)-float64(x))*t + 0.5) }
	return color.NRGBA{f(a.R, b.R), f(a.G, b.G), f(a.B, b.B), 255}
}

// themeFrom: push.theme's spec. Colours as everywhere in screens ("#rrggbb",
// a Push palette name); what is left out is derived from what is given, so
// {ground, ink} is a whole theme. sc only resolves "slot" (kept as a name:
// the accent then follows the slot).
func themeFrom(o map[string]any, sc color.NRGBA) *palette {
	str := func(k string) string { s, _ := o[k].(string); return strings.TrimSpace(s) }
	col := func(k string, def color.NRGBA) color.NRGBA {
		if s := str(k); s != "" {
			return ovColor(s, sc)
		}
		return def
	}
	p := &palette{themed: true, knob: "ring"}
	p.ground = col("ground", cBlack)
	p.fg = col("ink", cFg)
	p.dim = col("dim", lerpColor(p.ground, p.fg, 0.55))
	p.faint = col("faint", lerpColor(p.ground, p.fg, 0.14))
	p.line = col("rule", lerpColor(p.ground, p.fg, 0.28))
	p.panel = col("panel", lerpColor(p.ground, p.fg, 0.08))
	if s := str("accent"); s != "" && s != "slot" {
		p.accent, p.hasAccent = ovColor(s, sc), true
	}
	p.stageOff = lerpColor(p.ground, p.fg, 0.1)
	p.specFill = lerpColor(p.ground, p.fg, 0.12)
	p.specLine = lerpColor(p.ground, p.fg, 0.4)
	switch str("knob") {
	case "pointer", "fader":
		p.knob = str("knob")
	}
	return p
}

// onCap: a line on a knob's or fader's cap (its pointer, its centre line):
// whichever of ink and ground stands out more against the cap (a Juno's
// cream cap has a dark line, a dark knob a light pointer).
func (p *palette) onCap() color.NRGBA {
	if lumDiff(p.fg, p.panel) >= lumDiff(p.ground, p.panel) {
		return p.fg
	}
	return p.ground
}

func lum(c color.NRGBA) float64 {
	return 0.2126*float64(c.R) + 0.7152*float64(c.G) + 0.0722*float64(c.B)
}

func lumDiff(a, b color.NRGBA) float64 {
	d := lum(a) - lum(b)
	if d < 0 {
		return -d
	}
	return d
}
