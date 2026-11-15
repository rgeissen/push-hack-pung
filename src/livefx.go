package main

// livefx.go: the shown device's sound, made into what the pictures draw
// (docs/UX-GUIDELINES.md, "Live pictures"). One look per frame at the
// slot (livestate.go) gives:
//
//   - the level, and a reference for it (the loudest of the last seconds);
//   - the spectrum of the output, smoothed as an analyzer's is;
//   - for each envelope on the page, where the sound is in it: measured for
//     the amplitude envelope (the level says how far a stage has gone; the
//     notes say which stage), timed per voice where the module gives its
//     stage times in seconds, and for any other envelope only what the
//     notes say (held, let go);
//   - for each LFO, its phase, where it can be known: synced to Live's beat
//     with a rate in note values, or restarted by each note with a rate in
//     Hz. Else no phase is drawn (never a guess); a key-triggered LFO still
//     shows each restart.

import (
	"math"
	"math/cmplx"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	liveSilentDB = -72.0                   // below this the sound has stopped
	liveKeep     = 6 * time.Second         // a released note stays listed this long
	liveLinger   = 1500 * time.Millisecond // pictures keep moving this long after the sound stops
	trailLen     = 9                       // positions a moving mark leaves behind
)

// liveFX is the surface's view of one slot's sound.
type liveFX struct {
	slot      *Slot
	snap      liveSnap
	lvl       float64 // this frame's level, linear
	ref       float64 // the loudest of the last seconds, linear
	lastSound time.Duration
	spec      spectrum
	envs      map[string]*envTrack
	lfos      map[string]*lfoTrack
	beat, bpm float64
	playing   bool
	frame     uint64
	used      bool // a picture asked for something live this frame
	synced    bool // ... one whose motion follows Live's beat
}

// look takes this frame's look at s (a new slot starts clean).
func (f *liveFX) look(s *Slot) {
	if f.slot != s {
		*f = liveFX{slot: s}
	}
	f.frame++
	f.used, f.synced = false, false
	if s == nil {
		f.snap = liveSnap{Now: liveNow()}
		f.lvl = 0
		return
	}
	f.snap = s.live.look(liveKeep)
	f.lvl = 0.55*f.snap.Level + 0.45*f.lvl
	if f.snap.Level > f.lvl {
		f.lvl = f.snap.Level
	}
	f.ref = math.Max(f.ref*0.997, f.lvl) // about -1.3 dB a second
	if dbOf(f.lvl) > liveSilentDB {
		f.lastSound = f.snap.Now
	}
	f.beat, f.bpm, f.playing = transportNow()
}

// active: the sound is moving (or just stopped), so the pictures should be
// drawn again.
func (f *liveFX) active() bool {
	if f.slot == nil {
		return false
	}
	n := f.snap.Now
	return f.snap.Held > 0 || n-f.lastSound < liveLinger || n-f.snap.LastOff < liveLinger || n-f.snap.LastOn < liveLinger
}

func dbOf(lin float64) float64 {
	if lin <= 1e-6 {
		return -120
	}
	return 20 * math.Log10(lin)
}

// ---- the spectrum ---------------------------------------------------------------

const specN = 2048

type spectrum struct {
	buf   [specN]float32
	win   [specN]float64
	work  [specN]complex128    // the transform's, reused: nothing allocated per frame
	mag   [specN/2 + 1]float64 // dB, this frame
	cols  []float64            // dB per drawn column, smoothed
	width int
	frame uint64
	ok    bool
}

// update analyses the slot's last samples (once a frame, and only for a
// frame that draws a spectrum).
func (sp *spectrum) update(s *Slot, frame uint64) {
	if s == nil || sp.frame == frame {
		return
	}
	sp.frame = frame
	if sp.win[1] == 0 {
		for i := range sp.win {
			sp.win[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(specN-1))
		}
	}
	s.live.samples(sp.buf[:])
	x := sp.work[:]
	for i := range x {
		x[i] = complex(float64(sp.buf[i])*sp.win[i], 0)
	}
	fft(x)
	norm := 2 / (float64(specN) * 0.5) // a full-scale sine reads 0 dB
	for i := range sp.mag {
		sp.mag[i] = dbOf(cmplx.Abs(x[i]) * norm)
	}
	sp.ok = true
}

// columns: the spectrum over n columns of the frequency axis (fltDecades
// from 20 Hz), in dB, tilted 3 dB an octave about 1 kHz (so that music reads
// flat, as on an analyzer), falling back at most 36 dB a second.
func (sp *spectrum) columns(n int) []float64 {
	if n <= 1 || !sp.ok {
		return nil
	}
	if sp.width != n {
		sp.width = n
		sp.cols = make([]float64, n)
		for i := range sp.cols {
			sp.cols[i] = -120
		}
	}
	binHz := float64(moduleRate) / specN
	for c := 0; c < n; c++ {
		f := 20 * math.Pow(10, fltDecades*(float64(c)+0.5)/float64(n))
		// a sixth of an octave about f, its power averaged (as an analyzer
		// smooths): harmonics read as the sound's colour, not as needles
		b0, b1 := f*math.Pow(2, -1.0/12)/binHz, f*math.Pow(2, 1.0/12)/binHz
		var db float64
		if b1-b0 < 1 { // fewer bins than that: between the two nearest
			b := f / binHz
			i := int(b)
			if i+1 >= len(sp.mag) {
				db = -120
			} else {
				t := b - float64(i)
				db = sp.mag[i]*(1-t) + sp.mag[i+1]*t
			}
		} else {
			pw, k := 0.0, 0
			for i := int(math.Ceil(b0)); i <= int(b1) && i < len(sp.mag); i++ {
				pw += math.Pow(10, sp.mag[i]/10)
				k++
			}
			db = -120
			if k > 0 {
				db = 10 * math.Log10(pw/float64(k)+1e-12)
			}
		}
		db += 3 * math.Log2(f/1000)
		if db > sp.cols[c] {
			sp.cols[c] = db
		} else {
			sp.cols[c] = math.Max(db, sp.cols[c]-1.2) // 33 ms frames: 36 dB/s
		}
	}
	return sp.cols
}

// fft: in place, radix 2.
func fft(a []complex128) {
	n := len(a)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j |= bit
		if i < j {
			a[i], a[j] = a[j], a[i]
		}
	}
	for size := 2; size <= n; size <<= 1 {
		w := cmplx.Exp(complex(0, -2*math.Pi/float64(size)))
		for start := 0; start < n; start += size {
			wk := complex(1, 0)
			for k := 0; k < size/2; k++ {
				u, v := a[start+k], a[start+k+size/2]*wk
				a[start+k], a[start+k+size/2] = u+v, u-v
				wk *= w
			}
		}
	}
}

// ---- envelopes ------------------------------------------------------------------

// envLive: what a drawn envelope shows of the sound.
type envLive struct {
	Mode     string     // "measured" (the amplitude), "timed" (stage times known), "gate" (only the notes)
	Stage    string     // measured: attack, hold, decay, sustain, release; "" at rest
	Progress float64    // how far through that stage, 0..1
	Trail    []envPoint // where it was, oldest first
	Voices   []envPoint // timed: each sounding note
	Held     bool       // a note is down
	Ringing  bool       // let go, and still sounding
	Retrig   float64    // 1 just as a note began, falling to 0
}

type envPoint struct {
	Stage    string
	Progress float64
	Vel      float64 // 0..1 (timed voices)
}

type envTrack struct {
	stage         string
	peak, relFrom float64
	notes         uint64
	held          int
	prev          float64
	steady        int
	trail         []envPoint
}

// ampPrefixes: an envelope with one of these names shapes the amplitude, so
// the output's level shows where it is.
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

// stageSeconds: the stage times of an envelope in seconds, when every one
// of them says its unit (250 ms, 1.2 s); else nil.
func stageSeconds(g picGroup, vals map[string]ovValue) map[string]float64 {
	out := map[string]float64{}
	for _, role := range []string{"attack", "hold", "decay", "release"} {
		k, ok := g.keys[role]
		if !ok {
			continue
		}
		v := vals[k]
		if !v.Known {
			return nil
		}
		s, ok := secondsOf(v)
		if !ok {
			return nil
		}
		out[role] = s
	}
	return out
}

var numRe = regexp.MustCompile(`^\s*(-?[0-9]*\.?[0-9]+)\s*(ms|s|sec|secs|seconds)?\s*$`)

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

// envelope: what the envelope of group g (keyed by key) shows this frame.
func (f *liveFX) envelope(key string, g picGroup, e envShape, vals map[string]ovValue) *envLive {
	if f.slot == nil {
		return nil
	}
	f.used = true
	if f.envs == nil {
		f.envs = map[string]*envTrack{}
	}
	t := f.envs[key]
	if t == nil {
		t = &envTrack{notes: f.snap.Notes}
		f.envs[key] = t
	}
	sounding := dbOf(f.lvl) > liveSilentDB
	out := &envLive{Held: f.snap.Held > 0, Ringing: f.snap.Held == 0 && sounding && f.snap.LastOff > 0}
	if since := f.snap.Now - f.snap.LastOn; f.snap.LastOn > 0 && since < 300*time.Millisecond {
		out.Retrig = 1 - float64(since)/float64(300*time.Millisecond)
	}
	if secs := stageSeconds(g, vals); secs != nil {
		out.Mode = "timed"
		out.Voices = timedVoices(f.snap, secs, e)
		return out
	}
	if !isAmpEnvelope(g) {
		out.Mode = "gate"
		return out
	}
	out.Mode = "measured"
	lvl := f.lvl
	newNote := f.snap.Notes != t.notes
	t.notes = f.snap.Notes
	switch {
	case newNote:
		t.stage, t.peak, t.steady = "attack", lvl, 0
	case f.snap.Held == 0 && t.held > 0 && t.stage != "":
		t.stage, t.relFrom = "release", math.Max(lvl, 1e-6)
	}
	t.held = f.snap.Held
	prog := 0.0
	before := t.stage // a stage entered in the switch below starts at its start
	switch t.stage {
	case "attack":
		t.peak = math.Max(t.peak, lvl)
		prog = lvl / math.Max(f.ref, 1e-6)
		if t.peak > 1e-4 && lvl < t.peak*0.94 { // it turned: the attack is over
			switch {
			case e.HasH:
				t.stage = "hold"
			case e.HasD:
				t.stage = "decay"
			case e.HasS:
				t.stage = "sustain"
			default:
				t.stage = "release"
				t.relFrom = t.peak
			}
		}
	case "hold":
		prog = 0.5
		if lvl < t.peak*0.9 {
			t.stage = "decay"
		}
	case "decay":
		target := 0.0
		if e.HasS {
			target = e.S * t.peak
		}
		prog = (t.peak - lvl) / math.Max(t.peak-target, 1e-6)
		if math.Abs(lvl-t.prev) < 0.01*t.peak {
			t.steady++
		} else {
			t.steady = 0
		}
		if e.HasS && (prog >= 0.97 || t.steady >= 5) {
			t.stage = "sustain"
		}
		if !sounding && !e.HasS {
			t.stage = ""
		}
	case "sustain":
		prog = 0.5
		if !e.HasS {
			t.stage = "release"
		}
	case "release":
		prog = 1 - lvl/math.Max(t.relFrom, 1e-6)
		if !sounding {
			t.stage = ""
		}
	}
	t.prev = lvl
	if t.stage != before { // a stage just began: it starts at its start
		prog = 0
		if t.stage == "sustain" || t.stage == "hold" {
			prog = 0.5
		}
	}
	prog = math.Max(0, math.Min(1, prog))
	if t.stage != "" {
		t.trail = append(t.trail, envPoint{Stage: t.stage, Progress: prog})
	} else if len(t.trail) > 0 {
		t.trail = t.trail[1:] // the trail runs out after the sound
	}
	if len(t.trail) > trailLen {
		t.trail = t.trail[len(t.trail)-trailLen:]
	}
	out.Stage, out.Progress = t.stage, prog
	out.Trail = append([]envPoint(nil), t.trail...)
	return out
}

// timedVoices: where each note is in an envelope whose stage times are
// known, from when it went down and when it was let go.
func timedVoices(s liveSnap, secs map[string]float64, e envShape) []envPoint {
	var out []envPoint
	for _, v := range s.Voices {
		p := envPoint{Vel: float64(v.Vel) / 127}
		if v.Off == 0 {
			t := (s.Now - v.On).Seconds()
			a, h, d := secs["attack"], secs["hold"], secs["decay"]
			switch {
			case t < a:
				p.Stage, p.Progress = "attack", t/math.Max(a, 1e-6)
			case e.HasH && t < a+h:
				p.Stage, p.Progress = "hold", (t-a)/math.Max(h, 1e-6)
			case e.HasD && t < a+h+d:
				p.Stage, p.Progress = "decay", (t-a-h)/math.Max(d, 1e-6)
			case e.HasS:
				p.Stage, p.Progress = "sustain", 0.5
			default:
				continue // an AD envelope has ended
			}
		} else {
			r := secs["release"]
			t := (s.Now - v.Off).Seconds()
			if !e.HasR || t >= r {
				continue
			}
			p.Stage, p.Progress = "release", t/math.Max(r, 1e-6)
		}
		out = append(out, p)
		if len(out) == 8 {
			break
		}
	}
	return out
}

// ---- LFOs -----------------------------------------------------------------------

// lfoLive: what a drawn LFO shows of its motion.
type lfoLive struct {
	Phase   float64   // cycles since its start; < 0 unknown
	Trail   []float64 // earlier phases, oldest first
	Restart float64   // 1 as a note restarts it, falling to 0
	Synced  bool      // the phase comes from Live's beat
}

type lfoTrack struct{ trail []float64 }

var (
	noteValue = regexp.MustCompile(`^\s*(\d+)\s*/\s*(\d+)\s*(\.|t|d)?\s*$`)
	onWords   = map[string]bool{"on": true, "sync": true, "synced": true, "retrig": true, "retrigger": true, "keytrigger": true,
		"key trigger": true, "note reset": true, "tempo": true, "tempo dotted": true, "tempo triplets": true, "1": true, "yes": true}
)

// beatsOf: a rate in note values ("1/4", "1/8.", "1/16T") as beats a cycle.
func beatsOf(s string) (float64, bool) {
	m := noteValue.FindStringSubmatch(strings.ToLower(s))
	if m == nil {
		return 0, false
	}
	n, _ := strconv.ParseFloat(m[1], 64)
	d, _ := strconv.ParseFloat(m[2], 64)
	if d == 0 {
		return 0, false
	}
	b := 4 * n / d
	switch m[3] {
	case ".", "d":
		b *= 1.5
	case "t":
		b *= 2.0 / 3
	}
	return b, true
}

func hzOf(v ovValue) (float64, bool) {
	unit := strings.ToLower(strings.TrimSpace(v.Unit))
	d := strings.ToLower(strings.TrimSpace(v.Display))
	if strings.HasSuffix(d, "hz") {
		unit, d = "hz", strings.TrimSpace(strings.TrimSuffix(d, "hz"))
	}
	if unit != "hz" {
		return 0, false
	}
	f, err := strconv.ParseFloat(d, 64)
	return f, err == nil && f > 0
}

func isOn(v ovValue) bool {
	if !v.Known {
		return false
	}
	s := strings.ToLower(strings.TrimSpace(v.Display))
	if s == "" {
		s = strings.ToLower(strings.TrimSpace(v.Value))
	}
	return onWords[s]
}

// lfo: the phase of LFO group g this frame, where it can be known.
func (f *liveFX) lfo(key string, g picGroup, vals map[string]ovValue) *lfoLive {
	if f.slot == nil {
		return nil
	}
	f.used = true
	if f.lfos == nil {
		f.lfos = map[string]*lfoTrack{}
	}
	t := f.lfos[key]
	if t == nil {
		t = &lfoTrack{}
		f.lfos[key] = t
	}
	out := &lfoLive{Phase: -1}
	rate := vals[g.keys["rate"]]
	beats, synced := beatsOf(rate.Display)
	if k, ok := g.keys["div"]; ok && isOn(vals[g.keys["sync"]]) {
		beats, synced = beatsOf(vals[k].Display)
	}
	if k, ok := g.keys["sync"]; ok && !isOn(vals[k]) && g.keys["div"] == "" {
		synced = false // a note value with sync off: the module's own rate
	}
	hz, hasHz := hzOf(rate)
	trig := isOn(vals[g.keys["trig"]])
	since := f.snap.Now - f.snap.LastOn
	if trig && f.snap.LastOn > 0 && since < 300*time.Millisecond {
		out.Restart = 1 - float64(since)/float64(300*time.Millisecond)
	}
	switch {
	case synced && beats > 0 && trig && f.snap.LastOn > 0 && f.bpm > 0:
		out.Phase = since.Seconds() * f.bpm / 60 / beats
	case synced && beats > 0 && f.playing:
		out.Phase, out.Synced = f.beat/beats, true
		f.synced = true
	case hasHz && trig && f.snap.LastOn > 0:
		out.Phase = since.Seconds() * hz
	}
	if out.Phase >= 0 {
		t.trail = append(t.trail, out.Phase)
		if len(t.trail) > trailLen {
			t.trail = t.trail[len(t.trail)-trailLen:]
		}
		out.Trail = append([]float64(nil), t.trail...)
	} else {
		t.trail = nil
	}
	return out
}

// ---- for the surface ---------------------------------------------------------

// liveSlot: the slot whose sound the shown device is.
func (u *surface) liveSlot() *Slot {
	if u.liveActive() {
		if d, _ := u.pungDevice(); d != nil {
			return d.s
		}
		return nil
	}
	return u.cur()
}

// liveWanted: the last frame drew something live and the sound is moving
// (or a synced picture runs with Live's transport): draw the next one.
func (u *surface) liveWanted() bool {
	if !u.fxUsed {
		return false
	}
	s := u.liveSlot()
	if s == nil {
		return false
	}
	t := &s.live
	now := liveNow()
	if t.held.Load() > 0 || now-time.Duration(t.lastOn.Load()) < liveLinger || now-time.Duration(t.lastOff.Load()) < liveLinger {
		return true
	}
	if peakDB(s.peak()) > liveSilentDB {
		return true
	}
	_, _, playing := transportNow()
	return playing && u.fxSynced // only a picture that moves with the beat moves without a sound
}

// frameStats: what a frame costs (GET /api/surface/state: frame_draw_us,
// frame_push_us, frames), averaged over the last second or so.
type frameStats struct {
	drawUS, pushUS atomic.Int64
	n              atomic.Int64
}

func ewma(a *atomic.Int64, d time.Duration) {
	us := d.Microseconds()
	old := a.Load()
	if old == 0 {
		a.Store(us)
		return
	}
	a.Store(old + (us-old)/16)
}

func (f *frameStats) draw(d time.Duration) { ewma(&f.drawUS, d); f.n.Add(1) }
func (f *frameStats) push(d time.Duration) { ewma(&f.pushUS, d) }

// readLiveKeys reads, every frame, the values the shown compartment's screen
// says its module drives (live_keys). true: there were some.
func (u *surface) readLiveKeys(p position, b *bank) bool {
	if b == nil || p.Module == "" {
		return false
	}
	c := u.ov.get(u.h.modulesDir, p.Module).compartment(b.Compartment)
	if c == nil || len(c.liveKeys) == 0 {
		return false
	}
	s := u.liveSlot()
	if s == nil {
		return false
	}
	prefix := p.Prefix
	if u.liveActive() {
		_, prefix = u.pungDevice()
	}
	for _, k := range c.liveKeys {
		if v, ok := s.Get(prefix + ":" + k); ok {
			u.vals[u.valKey(p, k)] = v
		}
	}
	return true
}

// liveInfo: what a module's screen or widget is told of the sound (v.$live,
// docs/overrides.md).
func (u *surface) liveInfo() map[string]any {
	f := &u.fx
	if f.slot == nil {
		return map[string]any{"known": false}
	}
	f.used = true
	voices := []any{}
	for _, v := range f.snap.Voices {
		age := (f.snap.Now - v.On).Seconds()
		rel := -1.0
		if v.Off > 0 {
			rel = (f.snap.Now - v.Off).Seconds()
		}
		voices = append(voices, map[string]any{"note": v.Note, "vel": v.Vel, "held": v.Off == 0, "age": age, "released": rel})
	}
	since := func(t time.Duration) float64 {
		if t == 0 {
			return -1
		}
		return (f.snap.Now - t).Seconds()
	}
	level := 0.0
	if f.ref > 0 {
		level = math.Min(1, f.lvl/f.ref)
	}
	return map[string]any{"known": true, "level": level, "db": dbOf(f.lvl), "held": f.snap.Held, "notes": f.snap.Notes,
		"since_on": since(f.snap.LastOn), "since_off": since(f.snap.LastOff), "voices": voices,
		"playing": f.playing, "beat": f.beat, "bpm": f.bpm, "t": f.snap.Now.Seconds()}
}
