package main

// envmodel.go: what an envelope IS, once, for every picture of one
// (docs/UX-GUIDELINES.md, "Envelopes"). The default view, a module's own
// screen (g.envelope), the web page (web/visuals.js, constant for constant)
// and the live clock (envclock.go) all read an envelope as the same thing:
//
//	a start level, then SEGMENTS in the order a note goes through them:
//	timed stages, each a line to its level; at most one PLATEAU, where a
//	held key waits; after it the RELEASE stages, which run from the let-go.
//
// That one shape covers every envelope the fleet has: ADSR, AD, AHD,
// DAHDSR, delay-AR (the MS-20's EG1), the Virus's sustain slope, Roland's
// T1-T4 / L1-L4 (Mini-JV) and Yamaha's R1-R4 / L1-L4 (Dexed). The rules
// that follow from it hold for all of them:
//
//   - a segment is as wide as its time KNOB has travelled (a rate knob the
//     other way round): the shape is what the hand turns;
//   - the note's dot crosses a segment in the stage's real time: the motion
//     is what the sound does (envclock.go has the times);
//   - the stage bar under it has one segment per drawn segment, exactly as
//     wide, lit while a note's dot is in it.

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ---- recognizing one ---------------------------------------------------------------

// envGroup: one envelope among a page's keys, and the columns it covers.
type envGroup struct {
	prefix     string
	keys       map[string]string // role -> key (see envRoleOf)
	start, end int               // columns [start, end)
}

var (
	// a stage by its word: attack, atk, decay, dcy, ... with an optional
	// unit or kind after it (amp_attack_ms, env_sustain_level)
	envWord = regexp.MustCompile(`^(.*?)_?(attack|atk|att|decay|dcy|dec|hold|hld|sustain|sus|release|rel|delay)(?:_(time|level|rate|lvl|ms|sec|s))?$`)
	// ... or by its letter, after a prefix and an underscore (fenv_a, vca_r)
	envLetter = regexp.MustCompile(`^(.+?)_([adhsr])(?:_(time|level|ms))?$`)
	// numbered stages: T1-T4 and L1-L4 (Roland), R1-R4 and L1-L4 (Yamaha)
	envNumbered = regexp.MustCompile(`^(.*?)_?(time|rate|level|lvl|t|r|l)_?([1-8])$`)
	envPrefixOK = regexp.MustCompile(`(env|eg)[0-9]*$`)
	// a looping envelope runs on a phase of its own, which nothing reports
	envLooping = regexp.MustCompile(`^(cycle|cyc|loop)`)
)

var envWordRole = map[string]string{
	"attack": "attack", "atk": "attack", "att": "attack", "a": "attack",
	"decay": "decay", "dcy": "decay", "dec": "decay", "d": "decay",
	"hold": "hold", "hld": "hold", "h": "hold",
	"sustain": "sustain", "sus": "sustain", "s": "sustain",
	"release": "release", "rel": "release", "r": "release",
	"delay": "delay",
}

// envRoleOf: a key's place in an envelope, and the prefix it shares with
// the rest of it. Roles: delay, attack, hold, decay, sustain, slope,
// release; or time<n>, rate<n>, level<n>.
func envRoleOf(key string) (prefix, role string, ok bool) {
	k := strings.ToLower(key)
	if m := envNumbered.FindStringSubmatch(k); m != nil {
		p := strings.TrimSuffix(m[1], "_")
		if envPrefixOK.MatchString(p) {
			kind := map[string]string{"time": "time", "t": "time", "rate": "rate", "r": "rate", "level": "level", "lvl": "level", "l": "level"}[m[2]]
			return p, kind + m[3], true
		}
	}
	if m := envWord.FindStringSubmatch(k); m != nil {
		role := envWordRole[m[2]]
		if role == "sustain" && m[3] == "time" {
			role = "slope" // the Virus: sustain_time beside sustain is its slope
		}
		p := strings.TrimSuffix(m[1], "_")
		if role == "delay" && p == "" {
			return "", "", false // "delay_time" alone is an effect's
		}
		return p, role, true
	}
	if m := envLetter.FindStringSubmatch(k); m != nil {
		return m[1], envWordRole[m[2]], true
	}
	return "", "", false
}

// envelopeGroups finds the envelopes on a page: keys sharing what comes
// before their role, in adjacent columns, in any order (the JV-880 lists
// release before sustain). A named group needs an attack and a decay or a
// release (with a third stage: attack and release alone are a compressor's
// or a gate's timing, and a drawn envelope would say something false about
// them). A numbered group must be WHOLE on the page (envNumberedComplete):
// a page that splits one would have Pung invent the levels it lacks.
func envelopeGroups(keys []string) []envGroup {
	type hit struct {
		role string
		col  int
	}
	by := map[string][]hit{}
	var order []string
	for col, k := range keys {
		p, role, ok := envRoleOf(k)
		if !ok {
			continue
		}
		if _, seen := by[p]; !seen {
			order = append(order, p)
		}
		by[p] = append(by[p], hit{role, col})
	}
	var out []envGroup
	for _, p := range order {
		g := envGroup{prefix: p, keys: map[string]string{}, start: 99, end: -1}
		numbered, named := 0, 0
		for _, h := range by[p] {
			if _, dup := g.keys[h.role]; dup {
				continue
			}
			g.keys[h.role] = keys[h.col]
			g.start, g.end = min(g.start, h.col), max(g.end, h.col+1)
			if envNumberedRole(h.role) {
				numbered++
			} else {
				named++
			}
		}
		if g.end-g.start != len(g.keys) || (numbered > 0 && named > 0) {
			continue // other knobs between its parts, or two kinds mixed
		}
		if numbered > 0 {
			if !envNumberedComplete(g.keys) {
				continue
			}
		} else {
			_, a := g.keys["attack"]
			_, d := g.keys["decay"]
			_, r := g.keys["release"]
			if !a || (!d && !(r && len(g.keys) >= 3)) {
				continue
			}
		}
		out = append(out, g)
	}
	return out
}

func envNumberedRole(role string) bool {
	return strings.HasPrefix(role, "time") || strings.HasPrefix(role, "rate") || strings.HasPrefix(role, "level")
}

// envStageCount: how many timed stages a numbered group has, 1..n with none
// missing (0: not numbered, or a gap), and whether they are rates.
func envStageCount(keys map[string]string) (int, bool) {
	n, rates := 0, false
	for i := 1; i <= 8; i++ {
		_, t := keys["time"+strconv.Itoa(i)]
		_, r := keys["rate"+strconv.Itoa(i)]
		if !t && !r {
			break
		}
		if t && r {
			return 0, false
		}
		n, rates = i, r
	}
	for role := range keys {
		if strings.HasPrefix(role, "time") || strings.HasPrefix(role, "rate") {
			if i, _ := strconv.Atoi(role[4:]); i > n {
				return 0, false
			}
		}
	}
	return n, rates
}

// envNumberedComplete: four timed stages or more, numbered from 1, and
// every level they need: each stage's but the release's (Roland's release
// falls to nothing without one), and all of them for rates (Yamaha's start
// from their last level).
func envNumberedComplete(keys map[string]string) bool {
	n, rates := envStageCount(keys)
	if n < 4 {
		return false
	}
	need := n - 1
	if rates {
		need = n
	}
	for i := 1; i <= need; i++ {
		if _, ok := keys["level"+strconv.Itoa(i)]; !ok {
			return false
		}
	}
	return true
}

// ---- the shape -------------------------------------------------------------------

// envSeg: one drawn segment of an envelope.
type envSeg struct {
	Role    string   // attack, hold, decay, sustain (the plateau), release, delay; time<n> / rate<n>
	Label   string   // what the stage bar says: A, D, S, R, T1, R2, DL, H
	W       float64  // its drawn width, 0..1: the time knob's travel (a rate knob's, reversed)
	Level   float64  // where it ends, 0..1 (signed: 0.5 is the middle)
	Plateau bool     // a held key waits here
	Release bool     // it runs from the key's let-go
	TimeKey string   // the knob that times it ("" for the plateau)
	Keys    []string // every knob that shapes it (its touch lights it)
}

// envShape: an envelope to draw and to run notes through.
type envShape struct {
	Start  float64
	Segs   []envSeg
	Signed bool // a numbered pitch envelope: its levels swing about the middle
	Rates  bool // its stage knobs are rates (high is fast)
	Known  bool // every value has been read
	Labels bool // the stage bar under it
	Still  bool // it runs on something no note shows (a looping envelope's own phase)
	Hot    int  // the segment under a finger (-1: none)
	Corner int  // the point whose handle is touched (-1: none); point i ends segment i-1
	Live   *envLive
	Pal    *palette // the module's theme (theme.go); nil: Pung's
}

// plateau: the index of the plateau segment (-1: it runs through by itself).
func (e envShape) plateau() int {
	for i, s := range e.Segs {
		if s.Plateau {
			return i
		}
	}
	return -1
}

// seg: the index of the segment with role r (-1: none).
func (e envShape) seg(role string) int {
	for i, s := range e.Segs {
		if s.Role == role {
			return i
		}
	}
	return -1
}

// levelBefore: the level a segment starts from.
func (e envShape) levelBefore(i int) float64 {
	if i <= 0 {
		return e.Start
	}
	return e.Segs[i-1].Level
}

// envShapeOf reads an envelope group's values into its shape. touched is
// the key under a finger ("" none).
func envShapeOf(keys map[string]string, vals map[string]ovValue, touched string) envShape {
	e := envShape{Known: true, Labels: true, Hot: -1, Corner: -1}
	frac := func(role string, def float64) (float64, string, bool) {
		k, ok := keys[role]
		if !ok {
			return def, "", false
		}
		v, ok := vals[k]
		if !ok || !v.Known {
			e.Known = false
			return def, k, true
		}
		return math.Max(0, math.Min(1, v.Frac)), k, true
	}
	for _, k := range keys {
		if p, _, ok := envRoleOf(k); ok && envLooping.MatchString(p) {
			e.Still = true
		}
	}
	if n, rates := envStageCount(keys); n > 0 {
		e.numbered(n, rates, frac, keys, vals)
	} else {
		e.named(frac)
	}
	if !e.Known { // unread: a neutral shape, dimmed, at the same places
		for i := range e.Segs {
			e.Segs[i].W = 0.3
		}
	}
	// the touch: the segment its knob shapes, and the corner it moves
	for i, s := range e.Segs {
		for j, k := range s.Keys {
			if k != "" && k == touched {
				e.Hot, e.Corner = i, i+1
				if s.Plateau && j == 0 { // the sustain level: where the plateau starts
					e.Corner = i
				}
			}
		}
	}
	return e
}

// named: an envelope of attack, decay, sustain ...: delay, attack, hold,
// decay, the plateau (a sustain, or a release with no sustain: the level
// holds while the key does), release.
func (e *envShape) named(frac func(string, float64) (float64, string, bool)) {
	sus, susKey, hasS := frac("sustain", 0.6)
	slope, slopeKey, hasSlope := frac("slope", 0.5)
	_, _, hasR := frac("release", 0)
	add := func(role, label string, level float64, def float64) {
		if w, k, ok := frac(role, def); ok {
			s := envSeg{Role: role, Label: label, W: w, Level: level, TimeKey: k, Keys: []string{k}}
			if role == "decay" && hasS {
				s.Keys = append(s.Keys, susKey) // the sustain is where the decay ends
			}
			s.Release = role == "release"
			e.Segs = append(e.Segs, s)
		}
	}
	add("delay", "DL", 0, 0.2)
	add("attack", "A", 1, 0.25)
	add("hold", "H", 1, 0.3)
	decayTo := 0.0
	if hasS {
		decayTo = sus
	}
	add("decay", "D", decayTo, 0.35)
	if hasS || hasR {
		level := 1.0 // a release with no sustain: the level holds at its peak
		if len(e.Segs) > 0 {
			level = e.Segs[len(e.Segs)-1].Level
		}
		if hasS {
			level = sus
		}
		if hasSlope { // the Virus: below the middle the sustain falls while held, above it rises
			level = math.Max(0, math.Min(1, sus+(slope-0.5)*1.6))
		}
		p := envSeg{Role: "sustain", Label: "S", Level: level, Plateau: true, Keys: []string{susKey, slopeKey}}
		if !hasS {
			p.Keys = nil
		}
		e.Segs = append(e.Segs, p)
	}
	add("release", "R", 0, 0.35)
}

// numbered: T1..Tn / R1..Rn with their levels. The last stage is the
// release; the held key waits at the level before it. Roland's start from
// nothing (a pitch envelope from the middle); Yamaha's from their last
// level, the one the release returns to.
func (e *envShape) numbered(n int, rates bool, frac func(string, float64) (float64, string, bool), keys map[string]string, vals map[string]ovValue) {
	e.Rates = rates
	kind, letter := "time", "T"
	if rates {
		kind, letter = "rate", "R"
	}
	// a pitch envelope's levels swing about the middle (a named one's are
	// amounts, 0..1, and draw from the base like any other)
	for _, k := range keys {
		lk := strings.ToLower(k)
		if strings.Contains(lk, "pitch") || strings.Contains(lk, "penv") {
			e.Signed = true
		}
		if v, ok := vals[k]; ok && v.Known && v.Min < 0 {
			e.Signed = true // a level below zero
		}
	}
	rest := 0.0
	if e.Signed {
		rest = 0.5
	}
	defLevel := []float64{1, 0.7, 0.6, 0, 0, 0, 0, 0}
	for i := 1; i <= n; i++ {
		is := strconv.Itoa(i)
		w, tk, _ := frac(kind+is, 0.35)
		if rates {
			w = 1 - w // a rate is a speed: high is short
		}
		level, lk, ok := frac("level"+is, defLevel[i-1])
		if !ok {
			level = rest // no level: it ends where it began (the JV's amp: at nothing)
		}
		s := envSeg{Role: kind + is, Label: letter + is, W: w, Level: level, TimeKey: tk, Keys: []string{tk, lk}, Release: i == n}
		if i == n && n > 1 {
			hold := e.Segs[len(e.Segs)-1]
			e.Segs = append(e.Segs, envSeg{Role: "sustain", Label: "S", Level: hold.Level, Plateau: true})
		}
		e.Segs = append(e.Segs, s)
	}
	e.Start = rest
	if rates {
		e.Start = e.Segs[len(e.Segs)-1].Level
	}
}

// ---- where it is drawn -------------------------------------------------------------

type envPt struct{ X, Y float64 }

// envLayout: the points of an envelope in x0..x1, top..base (one more than
// its segments: point i ends segment i-1). A timed segment takes 5% of the
// width plus 25% at its knob's end; the plateau takes what is left (16% at
// least). Without a plateau the width is what the stages take at their
// longest, so short stages draw short, not stretched.
func envLayout(e envShape, x0, x1, top, base float64) ([]envPt, float64) {
	span := x1 - x0
	seg := func(f float64) float64 { return span * (0.05 + 0.25*f) }
	ws := make([]float64, len(e.Segs))
	used, timed, pl := 0.0, 0, -1
	for i, s := range e.Segs {
		if s.Plateau {
			pl = i
			continue
		}
		ws[i] = seg(s.W)
		used += ws[i]
		timed++
	}
	k := 1.0
	if pl >= 0 {
		ws[pl] = math.Max(span*0.16, span-used)
		if t := used + ws[pl]; t > span {
			k = span / t
		}
	} else if timed > 0 {
		k = span / (seg(1) * float64(timed))
	}
	lvl := func(f float64) float64 { return base - f*(base-top) }
	pts := []envPt{{x0, lvl(e.Start)}}
	x := x0
	for i, s := range e.Segs {
		x += ws[i] * k
		pts = append(pts, envPt{x, lvl(s.Level)})
	}
	return pts, k
}

// ---- where a note is in it ---------------------------------------------------------

// envVoice: one note in an envelope, at the frame's time. T: each
// segment's time in seconds (the plateau's is unused).
type envVoice struct {
	Age, Off, Vel float64 // seconds since it began; since let go (< 0 held); 0..1
	T             []float64
}

// envPos: where a note is: on segment Seg, Prog of the way along it.
type envPos struct {
	Seg         int
	Prog, Level float64
	Done        bool // it has run through
}

// relStart: how far along the first release segment a note let go at
// level lv starts: where that line has the level (0: at its start).
func relStart(e envShape, lv float64) float64 {
	pl := e.plateau()
	if pl < 0 || pl+1 >= len(e.Segs) {
		return 0
	}
	from, to := e.Segs[pl].Level, e.Segs[pl+1].Level
	if math.Abs(from-to) < 1e-6 {
		return 0
	}
	return math.Max(0, math.Min(1, (from-lv)/(from-to)))
}

// envAt: where note v is dt seconds after its frame, in envelope e. Each
// segment takes its time; the plateau waits for the key; the release runs
// from the let-go, starting where its line has the level the note had.
func envAt(v envVoice, dt float64, e envShape) envPos {
	age, off := v.Age+dt, v.Off
	if off >= 0 {
		off += dt
	}
	tt := func(i int) float64 {
		if i < len(v.T) {
			return v.T[i]
		}
		return 0
	}
	pos := func(i int, p float64) envPos {
		a, b := e.levelBefore(i), e.Segs[i].Level
		return envPos{Seg: i, Prog: p, Level: a + (b-a)*p}
	}
	// run: from segment i, p of the way along it, for t seconds
	run := func(i int, p, t float64, stopAt int) envPos {
		for ; i < len(e.Segs) && i != stopAt; i++ {
			d := tt(i)
			left := d * (1 - p)
			if t < left && d > 1e-6 {
				return pos(i, p+t/d)
			}
			t -= left
			p = 0
		}
		if i == stopAt && i < len(e.Segs) {
			return pos(i, 0)
		}
		return envPos{Seg: len(e.Segs) - 1, Prog: 1, Done: true}
	}
	pl := e.plateau()
	if pl < 0 { // it runs through by itself, let go or not
		return run(0, 0, age, -1)
	}
	if off < 0 {
		return run(0, 0, age, pl)
	}
	if pl+1 >= len(e.Segs) {
		return envPos{Seg: pl, Done: true} // let go, and no release: over
	}
	at := run(0, 0, age-off, pl) // where it was when let go
	return run(pl+1, relStart(e, at.Level), off, -1)
}

// ---- for tests and the web page's parity check ---------------------------------------

// envKeysSorted: a group's keys, in a stable order.
func envKeysSorted(keys map[string]string) []string {
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
