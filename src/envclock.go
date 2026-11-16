package main

// envclock.go: where each note is in an envelope, as it plays
// (docs/UX-GUIDELINES.md, "Live pictures"). Every note runs its own clock
// through the segments (envmodel.go: envAt): the dot travels each line in
// that stage's time and reaches its corner as the stage ends, waits on the
// plateau while the key is held, and runs down the release from the
// let-go. The picture is computed from the clock when it is DRAWN (the
// Push) or on every animation frame (the web page), so the motion is as
// smooth as the screen and as exact as the times.
//
// A stage's time, from the best source there is, stage by stage:
//   - module: the module's overlay knows its engine's times
//     (push.envelopeTimes: Mini-JV's measured tables, Dexed's msfa);
//   - stated: the knob says it is a time (250 ms, 1.2 s; a key ending in _ms);
//   - range: the knob's own range is seconds (0.001 .. 3; Surge's -8 .. 5 is
//     log2 of seconds);
//   - curve: none of these, so the knob's travel on Pung's curve, 2 ms ..
//     10 s (a rate knob's, reversed). For the amplitude envelope the sound
//     then says when a stage really ends (its peak ends the attack, its
//     settling the decay, its silence the release): the note's dot follows
//     that, and later notes' times are scaled by what was measured.
//
// An audio effect's envelope (a gate's, a ducker's) runs on the audio it
// hears, and a looping envelope on a phase of its own: neither has a clock
// a note could show, so they draw still.

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	envCurveMin = 0.002 // seconds at a knob's start, on Pung's curve
	envCurveMax = 10.0  // ... and at its end
	envMaxNotes = 8     // notes drawn in one envelope, newest first
	envTrailDT  = 0.033 // seconds between trail marks (one frame)
	envLearnMin = 0.07  // a measured stage shorter than this is a frame's noise, not a time
	envMeasDrop = 0.001 // -60 dB under where the release began: the release is over
)

// envLive: what a drawn envelope shows of the sound.
type envLive struct {
	Source string        // how the times are known: module, stated, range, curve; "" no clock
	At     time.Duration // when the ages were taken (liveNow)
	Voices []envVoice    // newest first
	Retrig float64       // 1 just as a note began, falling to 0
}

// ---- the times -------------------------------------------------------------------

var numRe = regexp.MustCompile(`^\s*(-?[0-9]*\.?[0-9]+)\s*(ms|s|sec|secs|seconds)?\s*$`)

// secondsOf: a value that says it is a time (250 ms, 1.2 s), by its unit,
// its display or its key's name (amp_attack_ms).
func secondsOf(key string, v ovValue) (float64, bool) {
	unit := strings.ToLower(strings.TrimSpace(v.Unit))
	disp := strings.ToLower(v.Display)
	if disp == "" {
		disp = v.Value
	}
	m := numRe.FindStringSubmatch(disp)
	if m == nil {
		return 0, false
	}
	if m[2] != "" {
		unit = m[2]
	}
	if unit == "" {
		lk := strings.ToLower(key)
		switch {
		case strings.HasSuffix(lk, "_ms"):
			unit = "ms"
		case strings.HasSuffix(lk, "_sec"), strings.HasSuffix(lk, "_s"):
			unit = "s"
		}
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

var envSourceRank = map[string]int{"module": 0, "stated": 1, "range": 2, "curve": 3}

// stageTime: a stage's time in seconds from its knob, and how it is known.
// w is the segment's drawn width (the knob's travel, a rate's reversed).
func stageTime(key string, v ovValue, w float64, rate bool) (float64, string) {
	if s, ok := secondsOf(key, v); ok && !rate {
		return math.Max(s, 0), "stated"
	}
	if raw, err := strconv.ParseFloat(strings.TrimSpace(v.Value), 64); err == nil && !rate && v.Type == "float" && strings.TrimSpace(v.Unit) == "" {
		switch {
		case v.Min == -8 && v.Max == 5: // Surge: log2 of seconds
			return math.Pow(2, raw), "range"
		case v.Min >= 0 && v.Max > 1 && v.Max <= 30, v.Min > 0 && v.Min < 0.01 && v.Max <= 30:
			return math.Max(raw, 0), "range"
		}
	}
	f := math.Max(0, math.Min(1, w))
	return envCurveMin * math.Pow(envCurveMax/envCurveMin, f), "curve"
}

// envTimesOf: each segment's time (the plateau's 0), whether it is the
// curve's, and the least exact source among them. mod, when the module
// gives times, wins for every segment it names (>= 0).
func envTimesOf(e envShape, vals map[string]ovValue, mod []float64) (t []float64, curved []bool, source string) {
	t, curved = make([]float64, len(e.Segs)), make([]bool, len(e.Segs))
	source = "module"
	for i, s := range e.Segs {
		if s.Plateau {
			continue
		}
		src := "module"
		if i < len(mod) && mod[i] >= 0 && !math.IsNaN(mod[i]) {
			t[i] = mod[i]
		} else {
			t[i], src = stageTime(s.TimeKey, vals[s.TimeKey], s.W, e.Rates)
		}
		curved[i] = src == "curve"
		if envSourceRank[src] > envSourceRank[source] {
			source = src
		}
	}
	return
}

// ---- the clock, per envelope ------------------------------------------------------

// ampEnv: an envelope with one of these names shapes the amplitude, so the
// output's level shows where it is.
var ampEnv = regexp.MustCompile(`^(|amp|amp_env|ampenv|aenv|vca|vca_env|tva|tvaenv|aeg|env_amp|amp_eg|volume|vol|env)$`)

// isAmpEnvelope: the envelope a group is, by its keys' shared prefix.
func isAmpEnvelope(g picGroup) bool {
	for _, k := range g.keys {
		if p, _, ok := envRoleOf(k); ok {
			return ampEnv.MatchString(strings.TrimSuffix(p, "_"))
		}
	}
	return false
}

// envTrack: one drawn envelope across frames: what the sound has taught it.
type envTrack struct {
	shape string                      // the segments' roles: a new shape forgets what was learned
	scale []float64                   // per segment: measured / curve (0: nothing measured yet)
	meas  map[time.Duration][]float64 // per note (by when it began): its segment times as the sound said (0: not yet)
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
	fromSus    bool // let go on its plateau: its release is a whole release
}

const (
	mNone    = iota
	mRise    // the attack: rising to its peak
	mDecay   // falling to the sustain (or to nothing)
	mSustain // held on the plateau
	mRelease // let go, ringing out
)

// envelope: what the envelope of group g (keyed by key) shows this frame.
func (f *liveFX) envelope(key string, g picGroup, e envShape, vals map[string]ovValue) *envLive {
	if f.slot == nil {
		return nil
	}
	f.used = true
	out := &envLive{At: f.snap.Now}
	if g.fx || !e.Known || e.Still {
		return out // no clock a note could show
	}
	if since := f.snap.Now - f.snap.LastOn; f.snap.LastOn > 0 && since < 300*time.Millisecond {
		out.Retrig = 1 - float64(since)/float64(300*time.Millisecond)
	}
	if f.envs == nil {
		f.envs = map[string]*envTrack{}
	}
	roles := make([]string, len(e.Segs))
	for i, s := range e.Segs {
		roles[i] = s.Role
	}
	shape := strings.Join(roles, " ")
	t := f.envs[key]
	if t == nil || t.shape != shape {
		t = &envTrack{shape: shape, scale: make([]float64, len(e.Segs)), notes: f.snap.Notes, meas: map[time.Duration][]float64{}}
		f.envs[key] = t
	}
	times, curved, source := envTimesOf(e, vals, g.secs)
	out.Source = source
	for i := range times {
		if curved[i] && t.scale[i] > 0 {
			times[i] *= t.scale[i]
		}
	}
	measuring := isAmpEnvelope(g) && slicesAny(curved) && e.seg("attack") >= 0
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

func slicesAny(b []bool) bool {
	for _, x := range b {
		if x {
			return true
		}
	}
	return false
}

// voice: note n in this envelope, its times as the sound said where it did.
func (t *envTrack) voice(s liveSnap, n liveNote, times []float64) envVoice {
	v := envVoice{Age: (s.Now - n.On).Seconds(), Off: -1, Vel: float64(n.Vel) / 127, T: append([]float64(nil), times...)}
	if n.Off > 0 {
		v.Off = (s.Now - n.Off).Seconds()
	}
	if m := t.meas[n.On]; m != nil {
		for i := range v.T {
			if i < len(m) && m[i] > 0 {
				v.T[i] = m[i]
			}
		}
	}
	return v
}

// heldStart: where note v's release starts on its line, from the level it
// had when let go.
func heldStart(v envVoice, e envShape) float64 {
	if v.Off < 0 {
		return 0
	}
	held := v
	held.Age, held.Off = v.Age-v.Off, -1
	return relStart(e, envAt(held, 0, e).Level)
}

// wait: the note being measured is where the sound says, whatever the
// times thought: still rising, its dot waits at the attack's corner; still
// falling, at the decay's; still ringing, at the release's end.
func (m *envMeasure) wait(v *envVoice, e envShape) {
	const most = 1.5 * envCurveMax // nothing waits longer than the longest stage
	a, d, r := e.seg("attack"), e.seg("decay"), e.seg("release")
	before := func(i int) float64 { // the time from the note's start to segment i
		s := 0.0
		for j := 0; j < i && j < len(v.T); j++ {
			s += v.T[j]
		}
		return s
	}
	switch m.phase {
	case mRise:
		if a >= 0 && m.peak > 1e-4 && v.Age < most {
			v.T[a] = math.Max(v.T[a], v.Age-before(a)+1e-3)
		}
	case mDecay:
		if d >= 0 && v.Age-before(d) < most {
			v.T[d] = math.Max(v.T[d], v.Age-before(d)+1e-3)
		}
	case mRelease:
		if r >= 0 && v.Off >= 0 && v.Off < most {
			if rest := 1 - heldStart(*v, e); rest > 1e-3 {
				v.T[r] = math.Max(v.T[r], v.Off/rest+1e-3)
			}
		}
	}
}

// measure: the amplitude envelope's note, as the output's level shows it.
// Only a note held alone is measured (two notes' sounds cannot be told
// apart in one level); what it shows is that note's times, and it scales
// the curve's times for the notes after it.
func (t *envTrack) measure(f *liveFX, e envShape, times []float64, curved []bool) {
	s, m, lvl := f.snap, &t.m, f.lvl
	ai, di, ri, pl := e.seg("attack"), e.seg("decay"), e.seg("release"), e.plateau()
	sus := 0.0
	if pl >= 0 {
		sus = e.Segs[pl].Level
	}
	if s.Notes != t.notes {
		t.notes = s.Notes
		*m = envMeasure{}
		if s.Held == 1 {
			*m = envMeasure{on: s.LastOn, phase: mRise}
			t.meas[m.on] = make([]float64, len(e.Segs))
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
		if i < 0 {
			return
		}
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
	// a delay before the attack is in the attack's measured time: the
	// sound cannot tell them apart
	pre := 0.0
	for j := 0; j < ai; j++ {
		pre += times[j]
	}
	now := s.Now
	switch m.phase {
	case mRise:
		if lvl > m.peak {
			m.peak, m.peakAt = lvl, now-liveTick/2 // the loudest of the frame: about its middle
		}
		if m.peak > 1e-4 && lvl < m.peak*0.94 { // it turned: the attack is over
			m.attack = math.Max(0, (m.peakAt - m.on).Seconds())
			learn(ai, m.attack-pre)
			m.prev, m.phase = lvl, mNone
			if di == ai+1 { // a hold has no level to measure: nothing after it is
				m.phase = mDecay
			}
		}
	case mDecay:
		if math.Abs(lvl-m.prev) < 0.015*m.peak { // settled: it is on its plateau, whatever level that is
			if m.steady == 0 {
				m.steadyAt = now - liveTick
			}
			m.steady++
		} else {
			m.steady = 0
		}
		end := time.Duration(-1)
		switch {
		case pl >= 0 && m.steady >= 3:
			end = m.steadyAt
		case pl >= 0 && lvl <= sus*m.peak*1.03:
			end = now
		case pl < 0 && (lvl < m.peak*envMeasDrop || dbOf(lvl) < liveSilentDB):
			end = now
		}
		if end >= 0 {
			learn(di, (end-m.on).Seconds()-m.attack)
			m.phase = mNone
			if pl >= 0 {
				m.phase = mSustain
			}
		}
		m.prev = lvl
	}
	if s.Held == 0 && pl >= 0 && ri >= 0 && (m.phase == mRise || m.phase == mDecay || m.phase == mSustain) {
		m.fromSus = m.phase == mSustain
		m.phase, m.off, m.relFrom = mRelease, s.LastOff, math.Max(lvl, 1e-6)
	}
	if m.phase == mRelease && (lvl < m.relFrom*envMeasDrop || dbOf(lvl) < liveSilentDB) {
		d := (now - m.off).Seconds()
		if m.fromSus {
			learn(ri, d)
		} else { // let go early: this note's release, for the part of the line it ran
			v := t.voice(s, liveNote{On: m.on, Off: m.off}, times)
			if rest := 1 - heldStart(v, e); rest > 1e-3 {
				res[ri] = math.Max(d/rest, 1e-3)
			}
		}
		m.phase = mNone
	}
}
