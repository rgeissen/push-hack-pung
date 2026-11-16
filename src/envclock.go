package main

// envclock.go: where each note is in an envelope, as it plays
// (docs/UX-GUIDELINES.md, "Live pictures"). Every note runs its own clock
// through the stages: the dot travels each line at that stage's speed and
// reaches its corner as the stage ends, waits at the sustain point while
// the key is held, and runs down the release from the key's let-go. The
// picture is computed from the clock when it is DRAWN (the Push) or on
// every animation frame (the web page), so the motion is as smooth as the
// screen and as exact as the times.
//
// The times, each stage by itself:
//   - stated: the module gives the stage in ms or s: exact;
//   - range: the knob's own range is seconds (0.001 .. 3; Surge's -8 .. 5 is
//     log2 of seconds);
//   - curve: neither, so the knob's travel on Pung's curve, 2 ms .. 10 s.
//     For the amplitude envelope the sound then says when a stage really
//     ends (its peak ends the attack, its settling the decay, its silence
//     the release): the note's dot follows that, and later notes' times
//     are scaled by what was measured.
//
// An audio effect's envelope (a gate's, a ducker's) runs on the audio it
// hears, not on notes: it has no clock, and draws still.

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	envCurveMin = 0.002  // seconds at a knob's start, on Pung's curve
	envCurveMax = 10.0   // ... and at its end
	envMaxNotes = 8      // notes drawn in one envelope, newest first
	envTrailDT  = 0.033  // seconds between trail marks (one frame)
	envLearnMin = 0.07   // a measured stage shorter than this is a frame's noise, not a time
	envMeasDrop = 0.001  // -60 dB under where the release began: the release is over
)

// envVoice: one note in an envelope, at the frame's time. A, H, D, R are
// its stage times (measured where the sound said so).
type envVoice struct {
	Age, Off, Vel float64 // seconds since it began; since let go (< 0 held); 0..1
	A, H, D, R    float64
}

// envLive: what a drawn envelope shows of the sound.
type envLive struct {
	Source string        // how the times are known: stated, range, curve; "" no clock (an audio FX's)
	At     time.Duration // when the ages were taken (liveNow)
	Voices []envVoice    // newest first
	Retrig float64       // 1 just as a note began, falling to 0
}

// envPos: where a note is in an envelope.
type envPos struct {
	Stage       string // attack, hold, decay, sustain, release
	Prog, Level float64
	Done        bool // it has run through
}

// envAt: where note v is dt seconds after its frame, in envelope e.
func envAt(v envVoice, dt float64, e envShape) envPos {
	age, off := v.Age+dt, v.Off
	if off >= 0 {
		off += dt
	}
	sus := 0.0
	if e.HasS {
		sus = e.S
	}
	frac := func(t, d float64) float64 {
		if d <= 1e-6 {
			return 1
		}
		return t / d
	}
	pre := func(t float64) envPos { // the key held for t seconds
		if t < v.A {
			p := frac(t, v.A)
			return envPos{Stage: "attack", Prog: p, Level: p}
		}
		t -= v.A
		if e.HasH {
			if t < v.H {
				return envPos{Stage: "hold", Prog: frac(t, v.H), Level: 1}
			}
			t -= v.H
		}
		if e.HasD {
			if t < v.D {
				p := frac(t, v.D)
				return envPos{Stage: "decay", Prog: p, Level: 1 - (1-sus)*p}
			}
			t -= v.D
		}
		if e.HasS {
			return envPos{Stage: "sustain", Level: sus}
		}
		if e.HasR { // no sustain: it runs through its release by itself
			if t < v.R {
				return envPos{Stage: "release", Prog: frac(t, v.R)}
			}
		}
		return envPos{Done: true}
	}
	if off < 0 || !e.HasS { // held, or an envelope that runs through by itself
		return pre(age)
	}
	if !e.HasR {
		return envPos{Done: true} // let go, and no release: over
	}
	at := pre(age - off) // where it was when let go
	if at.Done {
		return at
	}
	p0 := 0.0 // the release line runs from the sustain level: it starts where the level was
	if sus > 1e-3 && at.Level < sus {
		p0 = 1 - at.Level/sus
	}
	p := p0 + frac(off, v.R)
	if p >= 1 {
		return envPos{Done: true}
	}
	return envPos{Stage: "release", Prog: p, Level: sus * (1 - p)}
}

// ---- the times -------------------------------------------------------------------

var numRe = regexp.MustCompile(`^\s*(-?[0-9]*\.?[0-9]+)\s*(ms|s|sec|secs|seconds)?\s*$`)

// secondsOf: a value that says it is a time (250 ms, 1.2 s).
func secondsOf(v ovValue) (float64, bool) {
	unit := strings.ToLower(strings.TrimSpace(v.Unit))
	m := numRe.FindStringSubmatch(strings.ToLower(v.Display))
	if m == nil {
		return 0, false
	}
	if m[2] != "" {
		unit = m[2]
	}
	f, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, false
	}
	switch unit {
	case "ms":
		return f / 1000, true
	case "s", "sec", "secs", "seconds":
		return f, true
	}
	return 0, false
}

var envSourceRank = map[string]int{"stated": 0, "range": 1, "curve": 2}

// stageTime: a stage's time in seconds from its knob, and how it is known.
func stageTime(v ovValue) (float64, string) {
	if s, ok := secondsOf(v); ok {
		return math.Max(s, 0), "stated"
	}
	if raw, err := strconv.ParseFloat(strings.TrimSpace(v.Value), 64); err == nil && v.Type == "float" && strings.TrimSpace(v.Unit) == "" {
		switch {
		case v.Min == -8 && v.Max == 5: // Surge: log2 of seconds
			return math.Pow(2, raw), "range"
		case v.Min >= 0 && v.Max > 1 && v.Max <= 30, v.Min > 0 && v.Min < 0.01 && v.Max <= 30:
			return math.Max(raw, 0), "range"
		}
	}
	f := math.Max(0, math.Min(1, v.Frac))
	return envCurveMin * math.Pow(envCurveMax/envCurveMin, f), "curve"
}

// envStages: the timed stages, in the order a note goes through them.
var envStages = [4]string{"attack", "hold", "decay", "release"}

// envTimesOf: an envelope's stage times, and the least exact of their sources.
func envTimesOf(g picGroup, vals map[string]ovValue) (t [4]float64, curved [4]bool, source string) {
	source = "stated"
	for i, role := range envStages {
		k, ok := g.keys[role]
		if !ok {
			continue
		}
		s, src := stageTime(vals[k])
		t[i], curved[i] = s, src == "curve"
		if envSourceRank[src] > envSourceRank[source] {
			source = src
		}
	}
	return
}

// ---- the clock, per envelope ------------------------------------------------------

// ampEnv: an envelope with one of these names shapes the amplitude, so the
// output's level shows where it is.
var ampEnv = regexp.MustCompile(`^(|amp|amp_env|ampenv|vca|vca_env|tva|tvaenv|aeg|env_amp|amp_eg|volume|vol|env)$`)

// isAmpEnvelope: the envelope a group is, by its keys' shared prefix.
func isAmpEnvelope(g picGroup) bool {
	for _, k := range g.keys {
		m := envRole.FindStringSubmatch(strings.ToLower(k))
		if m == nil {
			continue
		}
		return ampEnv.MatchString(strings.TrimSuffix(m[1], "_"))
	}
	return false
}

// envTrack: one drawn envelope across frames: what the sound has taught it.
type envTrack struct {
	scale [4]float64                    // per stage: measured / curve (0: nothing measured yet)
	meas  map[time.Duration]*[4]float64 // per note (by when it began): its stage times as the sound said (0: not yet)
	notes uint64
	m     envMeasure
}

// envMeasure: the one note being measured (it is the only one held).
type envMeasure struct {
	on, off    time.Duration
	phase      int
	peak, prev float64
	peakAt     time.Duration
	attack     float64
	steady     int
	steadyAt   time.Duration
	relFrom    float64
	fromSus    bool // let go in its sustain: its release is a whole release
}

const (
	mNone    = iota
	mRise    // the attack: rising to its peak
	mDecay   // falling to the sustain (or to nothing)
	mSustain // held at the sustain
	mRelease // let go, ringing out
)

// envelope: what the envelope of group g (keyed by key) shows this frame.
func (f *liveFX) envelope(key string, g picGroup, e envShape, vals map[string]ovValue) *envLive {
	if f.slot == nil {
		return nil
	}
	f.used = true
	out := &envLive{At: f.snap.Now}
	if g.fx || !e.Known {
		return out // an audio effect's envelope follows the audio it hears, not the notes
	}
	if since := f.snap.Now - f.snap.LastOn; f.snap.LastOn > 0 && since < 300*time.Millisecond {
		out.Retrig = 1 - float64(since)/float64(300*time.Millisecond)
	}
	if f.envs == nil {
		f.envs = map[string]*envTrack{}
	}
	t := f.envs[key]
	if t == nil {
		t = &envTrack{notes: f.snap.Notes, meas: map[time.Duration]*[4]float64{}}
		f.envs[key] = t
	}
	times, curved, source := envTimesOf(g, vals)
	out.Source = source
	for i := range times {
		if curved[i] && t.scale[i] > 0 {
			times[i] *= t.scale[i]
		}
	}
	measuring := source != "stated" && isAmpEnvelope(g)
	if measuring {
		t.measure(f, e, times, curved)
	} else {
		t.m.phase = mNone
	}
	vs := append([]liveNote(nil), f.snap.Voices...)
	sort.SliceStable(vs, func(i, j int) bool { return vs[i].On > vs[j].On }) // newest first
	listed := map[time.Duration]bool{}
	for _, n := range vs {
		listed[n.On] = true
		v := t.voice(f.snap, n, times)
		if t.m.phase != mNone && n.On == t.m.on {
			t.m.wait(&v, e)
		}
		if envAt(v, 0, e).Done {
			continue
		}
		if len(out.Voices) < envMaxNotes {
			out.Voices = append(out.Voices, v)
		}
	}
	for on := range t.meas {
		if !listed[on] {
			delete(t.meas, on)
		}
	}
	if len(out.Voices) > 0 {
		f.moving = true
	}
	return out
}

// voice: note n in this envelope, its times as the sound said where it did.
func (t *envTrack) voice(s liveSnap, n liveNote, times [4]float64) envVoice {
	v := envVoice{Age: (s.Now - n.On).Seconds(), Off: -1, Vel: float64(n.Vel) / 127,
		A: times[0], H: times[1], D: times[2], R: times[3]}
	if n.Off > 0 {
		v.Off = (s.Now - n.Off).Seconds()
	}
	if m := t.meas[n.On]; m != nil {
		for i, p := range []*float64{&v.A, &v.H, &v.D, &v.R} {
			if m[i] > 0 {
				*p = m[i]
			}
		}
	}
	return v
}

// relStart: how far along the release line a note starts, from the level
// it had when let go.
func relStart(v envVoice, e envShape) float64 {
	if !e.HasS || e.S <= 1e-3 || v.Off < 0 {
		return 0
	}
	held := v
	held.Age, held.Off = v.Age-v.Off, -1
	at := envAt(held, 0, e)
	if at.Done || at.Level >= e.S {
		return 0
	}
	return 1 - at.Level/e.S
}

// wait: the note being measured is where the sound says, whatever the
// times thought: still rising, its dot waits at the attack's corner; still
// falling, at the decay's; still ringing, at the release's end.
func (m *envMeasure) wait(v *envVoice, e envShape) {
	const most = 1.5 * envCurveMax // nothing waits longer than the longest stage
	switch m.phase {
	case mRise:
		if m.peak > 1e-4 && v.Age < most {
			v.A = math.Max(v.A, v.Age+1e-3)
		}
	case mDecay:
		if e.HasD && v.Age-v.A < most {
			v.D = math.Max(v.D, v.Age-v.A+1e-3)
		}
	case mRelease:
		if v.Off >= 0 && v.Off < most {
			if rest := 1 - relStart(*v, e); rest > 1e-3 {
				v.R = math.Max(v.R, v.Off/rest+1e-3)
			}
		}
	}
}

// measure: the amplitude envelope's note, as the output's level shows it.
// Only a note held alone is measured (two notes' sounds cannot be told
// apart in one level); what it shows is that note's times, and it scales
// the curve's times for the notes after it.
func (t *envTrack) measure(f *liveFX, e envShape, times [4]float64, curved [4]bool) {
	s, m, lvl := f.snap, &t.m, f.lvl
	if s.Notes != t.notes {
		t.notes = s.Notes
		*m = envMeasure{}
		if s.Held == 1 {
			*m = envMeasure{on: s.LastOn, phase: mRise}
			t.meas[m.on] = &[4]float64{}
		}
	} else if s.Held > 1 {
		m.phase = mNone
	}
	res := t.meas[m.on]
	if m.phase == mNone || res == nil {
		m.phase = mNone
		return
	}
	learn := func(i int, d float64) {
		res[i] = math.Max(d, 1e-3)
		if !curved[i] || d < envLearnMin || times[i] <= 0 {
			return
		}
		base := times[i]
		if t.scale[i] > 0 {
			base /= t.scale[i] // times are scaled already: back to the curve's
		}
		k := math.Max(1e-3, math.Min(1e3, d/base))
		if t.scale[i] == 0 {
			t.scale[i] = k
		} else {
			t.scale[i] = 0.5*t.scale[i] + 0.5*k
		}
	}
	now := s.Now
	switch m.phase {
	case mRise:
		if lvl > m.peak {
			m.peak, m.peakAt = lvl, now-liveTick/2 // the loudest of the frame: about its middle
		}
		if m.peak > 1e-4 && lvl < m.peak*0.94 { // it turned: the attack is over
			m.attack = math.Max(0, (m.peakAt - m.on).Seconds())
			learn(0, m.attack)
			m.prev, m.phase = lvl, mNone
			if e.HasD && !e.HasH { // a hold has no level to measure: nothing after it is
				m.phase = mDecay
			}
		}
	case mDecay:
		if math.Abs(lvl-m.prev) < 0.015*m.peak { // settled: it is at its sustain, whatever level that is
			if m.steady == 0 {
				m.steadyAt = now - liveTick
			}
			m.steady++
		} else {
			m.steady = 0
		}
		end := time.Duration(-1)
		switch {
		case e.HasS && m.steady >= 3:
			end = m.steadyAt
		case e.HasS && lvl <= e.S*m.peak*1.03:
			end = now
		case !e.HasS && (lvl < m.peak*envMeasDrop || dbOf(lvl) < liveSilentDB):
			end = now
		}
		if end >= 0 {
			learn(2, (end-m.on).Seconds()-m.attack)
			m.phase = mNone
			if e.HasS {
				m.phase = mSustain
			}
		}
		m.prev = lvl
	}
	if s.Held == 0 && e.HasS && e.HasR && (m.phase == mRise || m.phase == mDecay || m.phase == mSustain) {
		m.fromSus = m.phase == mSustain
		m.phase, m.off, m.relFrom = mRelease, s.LastOff, math.Max(lvl, 1e-6)
	}
	if m.phase == mRelease && (lvl < m.relFrom*envMeasDrop || dbOf(lvl) < liveSilentDB) {
		d := (now - m.off).Seconds()
		if m.fromSus {
			learn(3, d)
		} else { // let go early: this note's release, for the part of the line it ran
			v := t.voice(s, liveNote{On: m.on, Off: m.off}, times)
			if rest := 1 - relStart(v, e); rest > 1e-3 {
				res[3] = math.Max(d/rest, 1e-3)
			}
		}
		m.phase = mNone
	}
}
