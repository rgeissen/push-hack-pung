package main

// visuals_shapes.go: Pung's pictures beyond the envelope (docs/UX-GUIDELINES.md,
// "Recognized structures"): a filter's response, an LFO's shape, a mix of
// sources. Same rules as the envelope: recognized by name and adjacency,
// drawn in the knob's terms, drawn only when true. web/visuals.js carries
// the same rules, constant for constant.
//
// The names come from what the fleet publishes (Schwung's
// tests/fixtures/module-contracts.json, 100 modules): cutoff is spelled
// cutoff, cutofffrequency, freq after a filter's name; resonance is
// resonance, reso, res, q; an LFO's wave is shape, wave or waveform.

import (
	"hash/fnv"
	"image"
	"image/color"
	"math"
	"regexp"
	"strings"
)

// picGroup: one recognized structure among a page's keys.
type picGroup struct {
	kind       string            // "env", "filter", "lfo", "mix"
	fx         bool              // an audio effect's: it follows the audio it hears, not the notes
	keys       map[string]string // role -> key (mix: "0", "1", ... in column order)
	start, end int               // columns [start, end)
}

// pictureGroups: every structure Pung draws on a page, left to right, none
// overlapping (an envelope first, then a filter, an LFO, a mix).
func pictureGroups(keys []string) []picGroup {
	var out []picGroup
	taken := make([]bool, len(keys)+1)
	add := func(g picGroup) {
		for c := g.start; c < g.end; c++ {
			if taken[c] {
				return
			}
		}
		for c := g.start; c < g.end; c++ {
			taken[c] = true
		}
		out = append(out, g)
	}
	for _, e := range envelopeGroups(keys) {
		add(picGroup{kind: "env", keys: e.keys, start: e.start, end: e.end})
	}
	for _, g := range filterGroups(keys) {
		add(g)
	}
	for _, g := range lfoGroups(keys) {
		add(g)
	}
	for _, g := range mixGroups(keys) {
		add(g)
	}
	// left to right
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].start < out[j-1].start; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

func (g picGroup) keyList() []string {
	out := make([]string, 0, len(g.keys))
	for _, k := range g.keys {
		out = append(out, k)
	}
	return out
}

// ---- filters ----------------------------------------------------------------------

var (
	fltCutoff = regexp.MustCompile(`^(.*?)_?(cutoff|cutofffrequency|cutoff_freq|cutoff_frequency)$`)
	fltFreq   = regexp.MustCompile(`^(.*?)_?(freq|frequency)$`)
	fltRes    = regexp.MustCompile(`^(.*?)_?f?(resonance|reso|res|q|emphasis)$`)
	fltType   = regexp.MustCompile(`^(.*?)_?(f|filter_?|flt_?|filt_?|vcf_?)?(type|mode)$`)
	// a filter's own name at the end of a prefix: filter, filter1, flt, vcf
	fltWord = regexp.MustCompile(`_?(filter|filt|flt|vcf|lpf|hpf)(\d*)$`)
)

// fltCanon: the filter a prefix names, without the word "filter" (filter1
// is "1", filter and "" are ""), and whether the prefix said "filter".
func fltCanon(p string) (string, bool) {
	if m := fltWord.FindStringSubmatchIndex(p); m != nil {
		return p[:m[0]] + p[m[4]:m[5]], true
	}
	return p, false
}

// filterGroups: a cutoff beside a resonance, or beside the filter's type,
// sharing the filter's name (filter_cutoff and filter_resonance;
// flt_freq, flt_res and flt_type; cutoff and resonance). A type on the page
// is the filter's when it names a filter (filter_type, filter1_mode, ftype),
// and joins the picture when it sits beside it.
func filterGroups(keys []string) []picGroup {
	type pos struct{ cut, res, typ int }
	by := map[string]*pos{}
	var order []string
	get := func(p string) *pos {
		if by[p] == nil {
			by[p] = &pos{-1, -1, -1}
			order = append(order, p)
		}
		return by[p]
	}
	for col, k := range keys {
		k := strings.ToLower(k)
		if m := fltCutoff.FindStringSubmatch(k); m != nil {
			p, _ := fltCanon(m[1])
			if q := get(p); q.cut < 0 {
				q.cut = col
			}
			continue
		}
		if m := fltFreq.FindStringSubmatch(k); m != nil {
			if p, named := fltCanon(m[1]); named { // osc1_freq is not a cutoff
				if q := get(p); q.cut < 0 {
					q.cut = col
				}
			}
			continue
		}
		if m := fltRes.FindStringSubmatch(k); m != nil {
			p, _ := fltCanon(m[1])
			if q := get(p); q.res < 0 {
				q.res = col
			}
			continue
		}
		if m := fltType.FindStringSubmatch(k); m != nil {
			p, named := fltCanon(m[1])
			if m[2] != "" || named { // "mode" alone may be anything
				if q := get(p); q.typ < 0 {
					q.typ = col
				}
			}
		}
	}
	var out []picGroup
	for _, p := range order {
		q := by[p]
		if q.cut < 0 || strings.Contains(p, "macro") {
			continue // a macro's cutoff moves the filter by so much: it is not one
		}
		g := picGroup{kind: "filter", keys: map[string]string{"cutoff": keys[q.cut]}, start: q.cut, end: q.cut + 1}
		near := func(c int) bool { return c >= 0 && (c == g.start-1 || c == g.end) }
		if near(q.res) {
			g.keys["resonance"] = keys[q.res]
			g.start, g.end = min(g.start, q.res), max(g.end, q.res+1)
		}
		if q.typ >= 0 {
			g.keys["type"] = keys[q.typ] // the shape, wherever it sits on the page
			if near(q.typ) {
				g.start, g.end = min(g.start, q.typ), max(g.end, q.typ+1)
			}
		}
		if g.end-g.start < 2 {
			continue // a cutoff alone is a knob
		}
		out = append(out, g)
	}
	return out
}

// filterShape is a filter to draw, in its knobs' terms.
type filterShape struct {
	Cutoff, Res float64
	HasRes      bool
	Kind        string // lp, hp, bp, notch, off; "?" for a type Pung cannot read
	Poles       int    // 1..4 (6 dB an octave each)
	TypeName    string // the type as the module names it
	Known       bool
	Touched     string    // "cutoff", "resonance", "type" or ""
	Spectrum    []float64 // the sound's spectrum, dB per column of the axis (livefx.go); nil: none
}

// the spectrum's scale in the filter picture (dB, after the analyzer's tilt)
const (
	specTopDB = -6.0
	specBotDB = -84.0
)

var (
	cSpecFill = color.NRGBA{36, 38, 41, 255}
	cSpecLine = color.NRGBA{104, 108, 112, 255}
)

// lighten: each channel the brighter of the two (the panel has no alpha;
// this lays the spectrum over the response's fill and keeps both readable)
func lighten(img *image.NRGBA, x, y int, c color.NRGBA) {
	if !(image.Point{x, y}.In(img.Rect)) {
		return
	}
	o := img.NRGBAAt(x, y)
	img.SetNRGBA(x, y, color.NRGBA{max(o.R, c.R), max(o.G, c.G), max(o.B, c.B), 255})
}

// drawSpectrum lays the sound's spectrum over a filter's frequency axis.
func drawSpectrum(img *image.NRGBA, cols []float64, x0, x1, top, base float64) {
	n := len(cols)
	if n < 2 {
		return
	}
	// the columns are the analyzer's (liveSpecCols), the pixels the picture's:
	// each pixel between the two nearest columns
	at := func(u float64) float64 {
		c := u * float64(n-1)
		i := int(c)
		if i >= n-1 {
			return cols[n-1]
		}
		t := c - float64(i)
		return cols[i]*(1-t) + cols[i+1]*t
	}
	var prev [2]float64
	for x := x0; x <= x1; x++ {
		db := at((x - x0) / math.Max(1, x1-x0))
		t := math.Max(0, math.Min(1, (db-specBotDB)/(specTopDB-specBotDB)))
		y := base - t*(base-top)
		for py := int(y); py < int(base); py++ {
			lighten(img, int(x), py, cSpecFill)
		}
		if x > x0 {
			aaLine(img, prev[0], prev[1], x, y, 1.2, cSpecLine)
		}
		prev = [2]float64{x, y}
	}
}

var (
	fltDB    = regexp.MustCompile(`(\d+)\s*db`)
	fltNum   = regexp.MustCompile(`(?:lp|hp|bp)\s*(\d+)`)
	fltPoles = regexp.MustCompile(`(\d)\s*p(?:ole)?\b`)
	fltNotch = regexp.MustCompile(`notch|stop|reject|^br\b|^n\s?\d|\bn\s?\d+\s*db`)
)

// filterKind reads a filter type as a module names it ("LP 24 dB", "LP12",
// "Analog 4P", "BandStop", "lp"): the response and its slope.
func filterKind(name string) (string, int) {
	s := strings.ToLower(strings.TrimSpace(name))
	poles := 2
	if m := fltDB.FindStringSubmatch(s); m != nil {
		poles = atoiDef(m[1], 12) / 6
	} else if m := fltNum.FindStringSubmatch(s); m != nil {
		poles = atoiDef(m[1], 12) / 6
	} else if m := fltPoles.FindStringSubmatch(s); m != nil {
		poles = atoiDef(m[1], 2)
	} else if strings.Contains(s, "ladder") {
		poles = 4
	}
	poles = max(1, min(4, poles))
	switch {
	case s == "off" || strings.Contains(s, "bypass") || s == "thru":
		return "off", poles
	case fltNotch.MatchString(s):
		return "notch", 2
	case strings.Contains(s, "hp+lp") || strings.Contains(s, "lp+hp") || strings.Contains(s, "band") ||
		strings.HasPrefix(s, "bp") || strings.Contains(s, " bp") || strings.Contains(s, "peak"):
		return "bp", 2
	case strings.Contains(s, "hp") || strings.Contains(s, "high"):
		return "hp", poles
	case strings.Contains(s, "lp") || strings.Contains(s, "low") || strings.Contains(s, "ladder") || strings.Contains(s, "analog"):
		return "lp", poles
	}
	return "?", poles
}

func atoiDef(s string, def int) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
	}
	if s == "" {
		return def
	}
	return n
}

// filterShapeOf reads a group's values. Without a type on the page the
// filter is a lowpass, as a cutoff and a resonance are on nearly every synth.
func filterShapeOf(g picGroup, vals map[string]ovValue, touchedKey string) filterShape {
	f := filterShape{Known: true, Kind: "lp", Poles: 2}
	for role, k := range g.keys {
		v := vals[k]
		if !v.Known {
			f.Known = false
		}
		if k == touchedKey {
			f.Touched = role
		}
		switch role {
		case "cutoff":
			f.Cutoff = v.Frac
		case "resonance":
			f.Res, f.HasRes = v.Frac, true
		case "type":
			name := v.Display
			if name == "" {
				name = v.Value
			}
			f.TypeName = name
			f.Kind, f.Poles = filterKind(name)
		}
	}
	return f
}

// Constants shared with web/visuals.js.
const (
	fltDecades = 3.0   // the frequency axis: three decades, 20 Hz to 20 kHz
	fltDBTop   = 21.0  // the top of the picture
	fltDBBot   = -39.0 // its bottom
)

// filterQ: resonance 0..1 as a Q, 0.707 (no peak) to about 10 (+20 dB).
func filterQ(f filterShape) float64 {
	if !f.HasRes {
		return 0.707
	}
	return 0.707 * math.Pow(10, f.Res*1.15)
}

// filterDB: the response at u (0..1 along the frequency axis), in dB.
func filterDB(f filterShape, u float64) float64 {
	w := math.Pow(10, fltDecades*(u-f.Cutoff))
	q := filterQ(f)
	w2 := w * w
	den := math.Sqrt((1-w2)*(1-w2) + (w/q)*(w/q))
	one := math.Sqrt(1 + w2)
	m := 1.0
	switch f.Kind {
	case "lp":
		if f.Poles == 1 {
			m = 1 / one
		} else {
			m = math.Pow(1/one, float64(f.Poles-2)) / den
		}
	case "hp":
		if f.Poles == 1 {
			m = w / one
		} else {
			m = math.Pow(w/one, float64(f.Poles-2)) * w2 / den
		}
	case "bp":
		m = (w / q) / den
	case "notch":
		m = math.Abs(1-w2) / den
	}
	return 20 * math.Log10(math.Max(m, 1e-6))
}

// drawFilter draws a filter's response: the curve over a frequency axis,
// filled below in the slot's colour faded; the cutoff as a handle on the
// curve; the 0 dB line as a guide. The touched part is drawn hot: the
// cutoff's handle and a line down from it, or the whole curve for the
// resonance or the type.
func drawFilter(img *image.NRGBA, r image.Rectangle, f filterShape, sc color.NRGBA) {
	known := f.Known
	if !known {
		f = filterShape{Cutoff: 0.6, Res: 0.35, HasRes: true, Kind: "lp", Poles: 2}
	}
	fg, accent := cFg, sc
	if !known {
		fg, accent = cDim, cDim
	}
	x0, x1 := float64(r.Min.X+6), float64(r.Max.X-6)
	top, base := float64(r.Min.Y+6), float64(r.Max.Y-6)
	yOf := func(db float64) float64 {
		db = math.Max(fltDBBot, math.Min(fltDBTop, db))
		return top + (fltDBTop-db)/(fltDBTop-fltDBBot)*(base-top)
	}
	// the decades, faint, and 0 dB, dashed
	for d := 1.0; d < fltDecades; d++ {
		x := x0 + (x1-x0)*d/fltDecades
		rect(img, int(x), int(top), 1, int(base-top), cFaint)
	}
	zero := yOf(0)
	for gx := x0; gx < x1; gx += 6 {
		aaLine(img, gx, zero, math.Min(gx+3, x1), zero, 1, cLine)
	}
	aaLine(img, x0, base, x1, base, 1, cLine)
	xc := x0 + (x1-x0)*f.Cutoff
	if f.Kind == "?" || f.Kind == "off" {
		if known {
			drawSpectrum(img, f.Spectrum, x0, x1, top, base)
		}
		// a type Pung cannot read draws no curve (never a guess); off passes all
		if f.Kind == "off" {
			aaLine(img, x0, zero, x1, zero, 2.2, mixColor(fg, 0.6))
		}
		aaLine(img, xc, top, xc, base, 1.5, mixColor(fg, 0.6))
		name := strings.ToUpper(asciiOnly(f.TypeName))
		if f.Kind == "off" {
			name = "OFF"
		} else if strings.Trim(name, "0123456789.- ") == "" {
			name = "" // a type that reads as a number says nothing
		}
		label(img, int((x0+x1)/2), int(top)+14, fitLabel(name, int(x1-x0)-8), cDim, 0)
		return
	}
	var pts [][2]float64
	for x := x0; x <= x1; x += 2 {
		pts = append(pts, [2]float64{x, yOf(filterDB(f, (x-x0)/(x1-x0)))})
	}
	fill := mixColor(accent, 0.28)
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		for px := int(a[0]); px < int(b[0]); px++ {
			y := a[1] + (b[1]-a[1])*(float64(px)-a[0])/math.Max(1, b[0]-a[0])
			rect(img, px, int(y), 1, int(base-y)+1, fill)
		}
	}
	if known {
		drawSpectrum(img, f.Spectrum, x0, x1, top, base) // the sound itself, behind the curve that shapes it
	}
	w, c := 2.2, fg
	if f.Touched == "resonance" || f.Touched == "type" {
		w, c = 3.4, accent
	}
	for i := 1; i < len(pts); i++ {
		aaLine(img, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1], w, c)
	}
	yc := yOf(filterDB(f, f.Cutoff))
	if f.Touched == "cutoff" {
		for gy := yc + 6; gy < base; gy += 6 {
			aaLine(img, xc, gy, xc, math.Min(gy+3, base), 1.5, accent)
		}
		disc(img, xc, yc, 4.5, accent)
	} else {
		disc(img, xc, yc, 3, fg)
	}
}

// ---- LFOs -------------------------------------------------------------------------

var (
	// what says how an LFO runs, for its live phase (livefx.go): synced to
	// the beat, restarted by notes, a rate in note values
	lfoSyncRole = regexp.MustCompile(`^(.*lfo.*?)_?(sync|rate_mode|sync_mode|tempo_sync)$`)
	lfoTrigRole = regexp.MustCompile(`^(.*lfo.*?)_?(trig|trigger|retrig|retrigger|keytrig|keytrigger|key_sync|keysync|synchro|trigmode|mode)$`)
	lfoDivRole  = regexp.MustCompile(`^(.*lfo.*?)_?(rate_div|div|division|sync_rate)$`)

	lfoShapeRole = regexp.MustCompile(`^(.*lfo.*?)_?(shape|wave|waveform|wav|form)$`)
	lfoRateRole  = regexp.MustCompile(`^(.*lfo.*?)_?(rate|speed|freq|frequency)$`)
)

// lfoGroups: an LFO's wave beside its rate, sharing a prefix that names an
// LFO (lfo1_shape and lfo1_rate; lfo_wave and lfo_rate).
func lfoGroups(keys []string) []picGroup {
	shape, rate := map[string]int{}, map[string]int{}
	extra := map[string]map[string]string{} // prefix -> role -> key
	var order []string
	for col, k := range keys {
		orig := k
		k := strings.ToLower(k)
		for role, re := range map[string]*regexp.Regexp{"sync": lfoSyncRole, "trig": lfoTrigRole, "div": lfoDivRole} {
			if m := re.FindStringSubmatch(k); m != nil {
				p := strings.TrimSuffix(m[1], "_")
				if extra[p] == nil {
					extra[p] = map[string]string{}
				}
				if _, ok := extra[p][role]; !ok {
					extra[p][role] = orig
				}
			}
		}
		if m := lfoShapeRole.FindStringSubmatch(k); m != nil {
			p := strings.TrimSuffix(m[1], "_")
			if _, ok := shape[p]; !ok {
				shape[p] = col
				order = append(order, p)
			}
		} else if m := lfoRateRole.FindStringSubmatch(k); m != nil {
			p := strings.TrimSuffix(m[1], "_")
			if _, ok := rate[p]; !ok {
				rate[p] = col
			}
		}
	}
	var out []picGroup
	for _, p := range order {
		s, ok1 := shape[p]
		r, ok2 := rate[p]
		if !ok1 || !ok2 || (s-r != 1 && r-s != 1) {
			continue
		}
		g := picGroup{kind: "lfo", keys: map[string]string{"shape": keys[s], "rate": keys[r]}, start: min(s, r), end: max(s, r) + 1}
		for role, k := range extra[p] { // wherever they sit on the page: they draw nothing, they tell how it runs
			g.keys[role] = k
		}
		out = append(out, g)
	}
	return out
}

// lfoGroupsLoose: the keys among all of a module's parameters that say how
// the LFO whose wave is shapeKey runs (sync, trig, div), by the same names
// lfoGroups reads on a page.
func lfoGroupsLoose(all []string, shapeKey string) []map[string]string {
	m := lfoShapeRole.FindStringSubmatch(strings.ToLower(shapeKey))
	if m == nil {
		return nil
	}
	prefix := strings.TrimSuffix(m[1], "_")
	out := map[string]string{}
	for _, k := range all {
		lk := strings.ToLower(k)
		for role, re := range map[string]*regexp.Regexp{"sync": lfoSyncRole, "trig": lfoTrigRole, "div": lfoDivRole} {
			if mm := re.FindStringSubmatch(lk); mm != nil && strings.TrimSuffix(mm[1], "_") == prefix {
				if old, ok := out[role]; !ok || k < old { // the same answer every time
					out[role] = k
				}
			}
		}
	}
	return []map[string]string{out}
}

// lfoShape is an LFO to draw.
type lfoShape struct {
	Wave     string // sine, tri, sawup, sawdown, square, sh, smooth, noise; "" unknown
	WaveName string
	Rate     float64
	Known    bool
	Touched  string   // "shape", "rate" or ""
	Live     *lfoLive // its phase as it runs (livefx.go); nil: a still picture
}

// lfoWave: a wave as the module names it, as one Pung draws. A name Pung
// does not know exactly ("Skewed Sine", "Wave 3") is drawn as its name.
func lfoWave(name string) string {
	s := strings.NewReplacer(" ", "", "_", "", "-", "", ".", "").Replace(strings.ToLower(name))
	switch s {
	case "sine", "sin", "sinus":
		return "sine"
	case "triangle", "tri":
		return "tri"
	case "saw", "sawup", "sawtooth", "rampup", "ramp", "sawtoothup":
		return "sawup"
	case "sawdown", "rampdown", "invsaw", "sawtoothdown":
		return "sawdown"
	case "square", "sqr", "squ", "rect", "pulse":
		return "square"
	case "s&h", "s+h", "sh", "sampleandhold", "sample&hold", "random", "rnd", "rand":
		return "sh"
	case "rnd1": // the JV-880's: stepped random, and smoothed
		return "sh"
	case "s&g", "smoothrandom", "smooth", "sng", "rnd2":
		return "smooth"
	case "noise":
		return "noise"
	}
	return ""
}

func lfoShapeOf(g picGroup, vals map[string]ovValue, touchedKey string) lfoShape {
	l := lfoShape{Known: true}
	for role, k := range g.keys {
		if role == "sync" || role == "trig" || role == "div" {
			continue // how it runs, not what it draws (livefx.go)
		}
		v := vals[k]
		if !v.Known {
			l.Known = false
		}
		if k == touchedKey {
			l.Touched = role
		}
		switch role {
		case "rate":
			l.Rate = v.Frac
		default:
			l.WaveName = v.Display
			if l.WaveName == "" {
				l.WaveName = v.Value
			}
			l.Wave = lfoWave(l.WaveName)
		}
	}
	return l
}

// lfoCycles: how many cycles the picture shows, in the rate knob's terms.
func lfoCycles(rate float64) float64 { return 1 + 4*rate }

// lfoRand: a fixed random value in -1..1 for step i (the same picture every frame).
func lfoRand(i int) float64 {
	h := fnv.New32a()
	h.Write([]byte{byte(i), byte(i >> 8), byte(i >> 16), 0x5a})
	return float64(h.Sum32()%2001)/1000 - 1
}

// lfoValue: the wave at phase ph (in cycles), -1..1.
func lfoValue(wave string, ph float64) float64 {
	t := ph - math.Floor(ph)
	switch wave {
	case "sine":
		return math.Sin(2 * math.Pi * ph)
	case "tri":
		switch {
		case t < 0.25:
			return 4 * t
		case t < 0.75:
			return 2 - 4*t
		}
		return 4*t - 4
	case "sawup":
		return 2*t - 1
	case "sawdown":
		return 1 - 2*t
	case "square":
		if t < 0.5 {
			return 1
		}
		return -1
	case "sh":
		return lfoRand(int(math.Floor(ph)))
	case "smooth":
		i := int(math.Floor(ph))
		a, b := lfoRand(i), lfoRand(i+1)
		k := (1 - math.Cos(math.Pi*t)) / 2
		return a + (b-a)*k
	case "noise":
		return lfoRand(int(math.Floor(ph * 24)))
	}
	return 0
}

// drawLFO draws an LFO's wave over as many cycles as its rate knob says,
// around a centre line, filled toward it in the slot's colour faded. Turning
// the wave or the rate draws it hot.
func drawLFO(img *image.NRGBA, r image.Rectangle, l lfoShape, sc color.NRGBA) {
	known := l.Known
	if !known {
		l = lfoShape{Wave: "sine", Rate: 0.25}
	}
	fg, accent := cFg, sc
	if !known {
		fg, accent = cDim, cDim
	}
	x0, x1 := float64(r.Min.X+6), float64(r.Max.X-6)
	top, base := float64(r.Min.Y+8), float64(r.Max.Y-8)
	mid := (top + base) / 2
	amp := (base - top) / 2
	for gx := x0; gx < x1; gx += 6 {
		aaLine(img, gx, mid, math.Min(gx+3, x1), mid, 1, cLine)
	}
	if l.Wave == "" {
		label(img, int((x0+x1)/2), int(mid)-6, fitLabel(strings.ToUpper(asciiOnly(l.WaveName)), int(x1-x0)-8), cDim, 0)
		return
	}
	n := lfoCycles(l.Rate)
	var pts [][2]float64
	step := 1.0
	for x := x0; x <= x1; x += step {
		v := lfoValue(l.Wave, n*math.Min((x-x0)/(x1-x0), 0.9999)) // the last pixel ends the cycle, not the next
		pts = append(pts, [2]float64{x, mid - v*amp})
	}
	fill := mixColor(accent, 0.28)
	for _, p := range pts {
		y := p[1]
		rect(img, int(p[0]), int(math.Min(y, mid)), 1, int(math.Abs(mid-y))+1, fill)
	}
	w, c := 2.2, fg
	if l.Touched != "" {
		w, c = 3.2, accent
	}
	for i := 1; i < len(pts); i++ {
		aaLine(img, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1], w, c)
	}
	// where it is now, where it is known (livefx.go): a playhead running
	// through the drawn cycles at the LFO's real rate, with a short trail; a
	// note restarting it lights its start
	lv := l.Live
	if lv == nil || !known {
		return
	}
	if lv.Restart > 0 {
		aaLine(img, x0, top, x0, base, 2.4, mixColor(cMod, lv.Restart))
	}
	if lv.Phase < 0 {
		return
	}
	pos := func(ph float64) (float64, float64) {
		u := math.Mod(ph, n) / n
		if u < 0 {
			u++
		}
		return x0 + (x1-x0)*u, mid - lfoValue(l.Wave, n*math.Min(u, 0.9999))*amp
	}
	for i := 0; i+1 < len(lv.Trail); i++ {
		x, y := pos(lv.Trail[i])
		k := float64(i+1) / float64(len(lv.Trail))
		disc(img, x, y, 1.4+1.6*k, mixColor(cMod, 0.12+0.45*k))
	}
	x, y := pos(lv.Phase)
	for gy := top; gy < base; gy += 5 {
		aaLine(img, x, gy, x, math.Min(gy+2, base), 1, mixColor(cMod, 0.5))
	}
	disc(img, x, y, 6, cBlack)
	disc(img, x, y, 4.3, cMod)
}

// ---- mixes of sources -------------------------------------------------------------

var (
	// the word and the source apart by an underscore or a digit: saw_level,
	// osc1vol, level_o1, mix2; never "volume" or "remix"
	mixSuffix = regexp.MustCompile(`^(.+)_(level|lvl|vol|volume|mix)$|^(.+\d)(level|lvl|vol|mix)$`)
	mixPrefix = regexp.MustCompile(`^(level|lvl|vol|mix)_(.+)$|^(level|lvl|vol|mix)(\d.*)$`)
	// not sources: an envelope's levels, an FM operator's (a modulator's
	// level is a depth, not a share of the mix), effects' wet/dry
	mixNotSource = regexp.MustCompile(`^(attack|decay|sustain|release|hold|env|eg|op\d|operator\d|vel|velocity|key|lfo|rev|reverb|dly|delay|cho|chorus|fx|send|master|main|out|output|input|in)$|env|_eg|^eg_`)
)

// mixGroups: three or more adjacent levels of different sources, named the
// same way (saw_level, pulse_level, sub_level, noise_level; level_o1,
// level_o2, level_noise; mix_v1, mix_v2, mix_sub).
func mixGroups(keys []string) []picGroup {
	type lv struct{ form, src string }
	parse := func(k string) (lv, bool) {
		k = strings.ToLower(k)
		if m := mixPrefix.FindStringSubmatch(k); m != nil {
			word, src := m[1]+m[3], m[2]+m[4]
			if !mixNotSource.MatchString(src) {
				return lv{"pre:" + word, src}, true
			}
		}
		if m := mixSuffix.FindStringSubmatch(k); m != nil {
			src, word := m[1]+m[3], m[2]+m[4]
			if !mixNotSource.MatchString(src) {
				return lv{"suf:" + word, src}, true
			}
		}
		return lv{}, false
	}
	var out []picGroup
	for i := 0; i < len(keys); {
		a, ok := parse(keys[i])
		if !ok {
			i++
			continue
		}
		j := i + 1
		seen := map[string]bool{a.src: true}
		for j < len(keys) {
			b, ok := parse(keys[j])
			if !ok || b.form != a.form || seen[b.src] {
				break
			}
			seen[b.src] = true
			j++
		}
		if j-i >= 3 {
			g := picGroup{kind: "mix", keys: map[string]string{}, start: i, end: j}
			for c := i; c < j; c++ {
				g.keys[itoa(c-i)] = keys[c]
			}
			out = append(out, g)
		}
		i = j
	}
	return out
}

// mixShape: the levels of a mix, in column order.
type mixShape struct {
	Levels  []float64
	Known   bool
	Touched int // the source under a finger, or -1
}

func mixShapeOf(g picGroup, vals map[string]ovValue, touchedKey string) mixShape {
	m := mixShape{Known: true, Touched: -1}
	for i := 0; i < g.end-g.start; i++ {
		k := g.keys[itoa(i)]
		v := vals[k]
		if !v.Known {
			m.Known = false
		}
		if k == touchedKey {
			m.Touched = i
		}
		m.Levels = append(m.Levels, v.Frac)
	}
	return m
}

// drawMix draws a mix as a mixer: a fader over each source's own knob, and
// across the top each source's share of the whole, so that what the sound
// is made of shows at once. Levels in their knobs' terms.
func drawMix(img *image.NRGBA, r image.Rectangle, m mixShape, sc color.NRGBA) {
	n := len(m.Levels)
	if n == 0 {
		return
	}
	known := m.Known
	if !known {
		m = mixShape{Levels: make([]float64, n), Touched: -1}
		for i := range m.Levels {
			m.Levels[i] = 0.5
		}
	}
	fg, accent := cFg, sc
	if !known {
		fg, accent = cDim, cDim
	}
	cw := float64(r.Dx()) / float64(n)
	// the shares, across the top
	sx, sy, sw, sh := float64(r.Min.X+6), r.Min.Y+4, float64(r.Dx()-12), 8
	sum := 0.0
	for _, v := range m.Levels {
		sum += v
	}
	if sum <= 0 {
		frameRect(img, int(sx), sy, int(sw), sh, cLine)
	} else {
		x := sx
		for i, v := range m.Levels {
			w := sw * v / sum
			c := mixColor(fg, 0.75)
			if i%2 == 1 {
				c = mixColor(fg, 0.5)
			}
			if i == m.Touched {
				c = accent
			}
			if w >= 1 {
				rect(img, int(x), sy, max(1, int(x+w)-int(x)-2), sh, c)
			}
			x += w
		}
	}
	// a fader over each source's knob
	top, base := float64(r.Min.Y+22), float64(r.Max.Y-6)
	for i, v := range m.Levels {
		cx := float64(r.Min.X) + cw*(float64(i)+0.5)
		rect(img, int(cx)-3, int(top), 6, int(base-top), cLine)
		y := base - v*(base-top)
		c, cap := mixColor(accent, 0.45), fg
		if i == m.Touched {
			c, cap = accent, accent
		}
		if v > 0 {
			rect(img, int(cx)-11, int(y), 22, int(base-y), c)
		}
		rect(img, int(cx)-15, int(y)-1, 30, 3, cap)
	}
}

// drawPicture draws one recognized structure from its values; with fx, as
// the sound is moving it (key names the picture across frames).
func drawPicture(img *image.NRGBA, r image.Rectangle, g picGroup, vals map[string]ovValue, touchedKey string, sc color.NRGBA) {
	drawPictureLive(img, r, g, vals, touchedKey, sc, nil, liveOut{}, "")
}

// drawPictureLive: with a live session, the picture is registered with it
// (its live state is worked out every tick, livehub.go) and drawn with the
// session's latest frame.
func drawPictureLive(img *image.NRGBA, r image.Rectangle, g picGroup, vals map[string]ovValue, touchedKey string, sc color.NRGBA, ls *liveSession, out liveOut, key string) {
	if ls != nil {
		ls.want(key, g, vals)
	}
	switch g.kind {
	case "env":
		e := envShapeOf(envGroup{keys: g.keys, start: g.start, end: g.end}, vals, touchedKey)
		e.Live = out.Envs[key]
		drawEnvelope(img, r, e, sc)
	case "filter":
		f := filterShapeOf(g, vals, touchedKey)
		f.Spectrum = out.Spec
		drawFilter(img, r, f, sc)
	case "lfo":
		l := lfoShapeOf(g, vals, touchedKey)
		l.Live = out.LFOs[key]
		drawLFO(img, r, l, sc)
	case "mix":
		drawMix(img, r, mixShapeOf(g, vals, touchedKey), sc)
	}
}
