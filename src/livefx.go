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
	liveKeep     = 12 * time.Second        // a released note stays listed this long (the longest release drawn is 10 s)
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
	moving    bool // ... and something in it moves (an envelope's note is still in it)
	synced    bool // ... one whose motion follows Live's beat
}

// look takes this frame's look at s (a new slot starts clean).
func (f *liveFX) look(s *Slot) {
	if f.slot != s {
		*f = liveFX{slot: s}
	}
	f.frame++
	f.used, f.synced, f.moving = false, false, false
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
	return f.moving || f.snap.Held > 0 || n-f.lastSound < liveLinger || n-f.snap.LastOff < liveLinger || n-f.snap.LastOn < liveLinger
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
	}
	return nil
}

// liveSess: the live session of the shown sound, kept ticking while the
// Push view draws it (nil: none).
func (u *surface) liveSess() *liveSession {
	ls := u.h.liveSession(u.liveSlot())
	if ls != nil {
		ls.watchPush()
	}
	return ls
}

// liveWanted: the last frame drew something live and the sound is moving
// (or a picture follows Live's beat while it plays): draw the next one.
func (u *surface) liveWanted() bool {
	if !u.fxUsed {
		return false
	}
	ls := u.liveSess()
	return ls != nil && ls.frame().Active
}

// readLiveKeys: the values the shown compartment's screen says its module
// drives (live_keys), as the session read them this tick. true: there are some.
func (u *surface) readLiveKeys(ls *liveSession, out liveOut, p position, b *bank) bool {
	if ls == nil || b == nil || p.Module == "" {
		return false
	}
	c := u.ov.get(u.h.modulesDir, p.Module).compartment(b.Compartment)
	if c == nil || len(c.liveKeys) == 0 {
		return false
	}
	prefix := p.Prefix
	if u.liveActive() {
		_, prefix = u.pungDevice()
	}
	full := make([]string, len(c.liveKeys))
	for i, k := range c.liveKeys {
		full[i] = prefix + ":" + k
		if v, ok := out.Keys[full[i]]; ok {
			u.vals[u.valKey(p, k)] = v
		}
	}
	ls.wantKeys(full)
	return true
}

// liveInfo: what a module's screen or widget is told of the sound (v.$live,
// docs/overrides.md).
func (u *surface) liveInfo() map[string]any {
	u.liveDrew = true
	if u.liveOut.Info == nil {
		return map[string]any{"known": false}
	}
	return u.liveOut.Info
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
