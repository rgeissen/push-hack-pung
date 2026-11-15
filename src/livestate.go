package main

// livestate.go: what a slot's sound is doing, as it plays (docs/UX-GUIDELINES.md,
// "Live pictures"). The realtime side records three facts, lock-free and
// without allocating: every note as it is delivered (with its time), the
// loudest sample of each block, and the last samples of the output. The
// surface reads them at frame rate and makes them pictures (livefx.go).
//
// Nothing here is estimated: a note is a note Live (or a test) delivered,
// the level and the samples are the module's own output.

import (
	"math"
	"sync/atomic"
	"time"
)

var liveEpoch = time.Now()

// liveNow: monotonic time since Pung started (cheap enough for the audio thread).
func liveNow() time.Duration { return time.Since(liveEpoch) }

const liveRingSize = 4096 // samples of mono output kept for the spectrum (~93 ms at 44.1 kHz)

type soundTrack struct {
	on      [128]atomic.Int64  // when the note went down (ns since liveEpoch), 0 = up
	start   [128]atomic.Int64  // when it last went down (kept after it is let go)
	off     [128]atomic.Int64  // when it was let go
	vel     [128]atomic.Uint32 // its velocity
	held    atomic.Int32
	lastOn  atomic.Int64
	lastOff atomic.Int64
	notes   atomic.Uint64 // note-ons, ever: a change says "a note began"

	lvlBits atomic.Uint32 // the loudest sample since the surface last looked

	ring [liveRingSize]float32 // mono output; the writer never waits, the reader may see a torn edge
	wpos atomic.Uint64
}

// trackMidi records a note delivered to the module. Realtime-safe.
func (t *soundTrack) trackMidi(msg []byte) {
	if len(msg) < 3 {
		return
	}
	st, n, v := msg[0]&0xF0, msg[1]&0x7F, msg[2]
	now := int64(liveNow())
	switch {
	case st == 0x90 && v > 0:
		if t.on[n].Load() == 0 {
			t.held.Add(1)
		}
		t.on[n].Store(now)
		t.start[n].Store(now)
		t.off[n].Store(0)
		t.vel[n].Store(uint32(v))
		t.lastOn.Store(now)
		t.notes.Add(1)
	case st == 0x80 || st == 0x90:
		if t.on[n].Load() != 0 {
			t.held.Add(-1)
			t.off[n].Store(now)
			t.lastOff.Store(now)
		}
		t.on[n].Store(0)
	case st == 0xB0 && (n == 123 || n == 120): // all notes off / all sound off
		for i := range t.on {
			if t.on[i].Load() != 0 {
				t.on[i].Store(0)
				t.off[i].Store(now)
			}
		}
		t.held.Store(0)
		t.lastOff.Store(now)
	}
}

// feedAudio keeps a block of interleaved stereo output. Realtime-safe.
func (t *soundTrack) feedAudio(out []float32) {
	n := len(out) / 2
	if n == 0 {
		return
	}
	w := t.wpos.Load()
	pk := float32(0)
	for i := 0; i < n; i++ {
		l, r := out[2*i], out[2*i+1]
		t.ring[(w+uint64(i))%liveRingSize] = (l + r) * 0.5
		if l < 0 {
			l = -l
		}
		if r < 0 {
			r = -r
		}
		if l > pk {
			pk = l
		}
		if r > pk {
			pk = r
		}
	}
	t.wpos.Store(w + uint64(n))
	for {
		old := t.lvlBits.Load()
		if math.Float32frombits(old) >= pk {
			break
		}
		if t.lvlBits.CompareAndSwap(old, math.Float32bits(pk)) {
			break
		}
	}
}

// liveNote: a note as the surface sees it.
type liveNote struct {
	Note    int
	Vel     int
	On, Off time.Duration // Off 0 while held
}

// liveSnap is one look at a slot's sound.
type liveSnap struct {
	Now             time.Duration
	Held            int
	LastOn, LastOff time.Duration
	Notes           uint64     // note-ons ever
	Level           float64    // the loudest sample since the last look, linear
	Voices          []liveNote // held notes, and notes let go in the last few seconds
}

// look reads the slot's live state; it takes the level (the next look
// starts from zero). keep is how long a released note stays listed.
func (t *soundTrack) look(keep time.Duration) liveSnap {
	s := liveSnap{Now: liveNow(), Held: int(t.held.Load()),
		LastOn: time.Duration(t.lastOn.Load()), LastOff: time.Duration(t.lastOff.Load()), Notes: t.notes.Load()}
	s.Level = float64(math.Float32frombits(t.lvlBits.Swap(0)))
	for n := range t.on {
		on, off := t.on[n].Load(), t.off[n].Load()
		switch {
		case on != 0:
			s.Voices = append(s.Voices, liveNote{Note: n, Vel: int(t.vel[n].Load()), On: time.Duration(on)})
		case off != 0 && s.Now-time.Duration(off) < keep:
			s.Voices = append(s.Voices, liveNote{Note: n, Vel: int(t.vel[n].Load()), On: time.Duration(t.start[n].Load()), Off: time.Duration(off)})
		}
	}
	if s.Held < 0 {
		s.Held = 0
	}
	return s
}

// samples copies the last len(dst) output samples, oldest first.
func (t *soundTrack) samples(dst []float32) {
	w := t.wpos.Load()
	n := uint64(len(dst))
	for i := uint64(0); i < n; i++ {
		dst[i] = t.ring[(w-n+i)%liveRingSize]
	}
}

// ---- Live's transport, as the devices last heard it ----

var liveTransport struct {
	bpm, beat atomic.Uint64 // float64 bits
	playing   atomic.Bool
	at        atomic.Int64 // when beat was heard
}

// noteTransport keeps Live's transport for the pictures. Realtime-safe.
func noteTransport(bpm, beat float64, playing bool) {
	liveTransport.bpm.Store(math.Float64bits(bpm))
	liveTransport.beat.Store(math.Float64bits(beat))
	liveTransport.playing.Store(playing)
	liveTransport.at.Store(int64(liveNow()))
}

// transportNow: the beat now (carried on from the last block at the tempo),
// the tempo, and whether Live is playing.
func transportNow() (beat, bpm float64, playing bool) {
	bpm = math.Float64frombits(liveTransport.bpm.Load())
	beat = math.Float64frombits(liveTransport.beat.Load())
	playing = liveTransport.playing.Load()
	if playing && bpm > 0 {
		beat += (liveNow() - time.Duration(liveTransport.at.Load())).Seconds() * bpm / 60
	}
	return beat, bpm, playing
}
