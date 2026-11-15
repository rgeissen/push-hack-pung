package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func block(amp float32, freq float64, n int, phase *float64) []float32 {
	out := make([]float32, n*2)
	for i := 0; i < n; i++ {
		v := amp * float32(math.Sin(*phase))
		*phase += 2 * math.Pi * freq / moduleRate
		out[2*i], out[2*i+1] = v, v
	}
	return out
}

func TestSoundTrackNotes(t *testing.T) {
	var s soundTrack
	s.trackMidi([]byte{0x90, 60, 100})
	s.trackMidi([]byte{0x90, 64, 90})
	s.trackMidi([]byte{0x90, 60, 100}) // again while down: still one held
	if s.held.Load() != 2 {
		t.Fatalf("held %d", s.held.Load())
	}
	s.trackMidi([]byte{0x80, 60, 0})
	s.trackMidi([]byte{0x90, 64, 0}) // a note-on at velocity 0 lets go
	snap := s.look(time.Minute)
	if snap.Held != 0 || len(snap.Voices) != 2 || snap.Notes != 3 {
		t.Fatalf("snap %+v", snap)
	}
	for _, v := range snap.Voices {
		if v.Off == 0 || v.On == 0 {
			t.Fatalf("a released voice keeps both times: %+v", v)
		}
	}
	ph := 0.0
	s.feedAudio(block(0.5, 440, 128, &ph))
	if lvl := s.look(time.Minute).Level; math.Abs(lvl-0.5) > 0.01 {
		t.Fatalf("level %v", lvl)
	}
	if lvl := s.look(time.Minute).Level; lvl != 0 {
		t.Fatalf("a look takes the level: %v", lvl)
	}
}

func TestSpectrumFindsTheTone(t *testing.T) {
	s := &Slot{}
	ph := 0.0
	for i := 0; i < 40; i++ {
		s.live.feedAudio(block(0.5, 1000, 128, &ph))
	}
	var sp spectrum
	sp.update(s, 1)
	cols := sp.columns(300)
	best := 0
	for i := range cols {
		if cols[i] > cols[best] {
			best = i
		}
	}
	f := 20 * math.Pow(10, fltDecades*(float64(best)+0.5)/300)
	if f < 900 || f > 1110 {
		t.Fatalf("the loudest column is at %.0f Hz", f)
	}
	if cols[best] < -16 || cols[best] > 0 { // -6 dBFS sine, tilt 0 at 1 kHz, its power spread over a sixth of an octave
		t.Fatalf("level %.1f dB", cols[best])
	}
}

// An amplitude envelope follows the sound: a note, a rise, a fall to the
// sustain, a hold, a release, silence.
func TestEnvelopeFollowsTheSound(t *testing.T) {
	s := &Slot{}
	var fx liveFX
	g := picGroup{kind: "env", keys: map[string]string{"attack": "attack", "decay": "decay", "sustain": "sustain", "release": "release"}}
	e := envShape{A: 0.3, D: 0.3, S: 0.5, R: 0.4, HasD: true, HasS: true, HasR: true, Known: true}
	ph := 0.0
	frame := func(amp float32) *envLive {
		s.live.feedAudio(block(amp, 220, 1470, &ph))
		fx.look(s)
		return fx.envelope("e", g, e, nil)
	}
	frame(0)
	s.live.trackMidi([]byte{0x90, 60, 100})
	var stages []string
	note := func(l *envLive) {
		if len(stages) == 0 || stages[len(stages)-1] != l.Stage {
			stages = append(stages, l.Stage)
		}
	}
	for _, a := range []float32{0.1, 0.3, 0.6, 0.9, 1.0, 0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5} {
		l := frame(a)
		note(l)
		if l.Mode != "measured" || !l.Held {
			t.Fatalf("mode %q held %v", l.Mode, l.Held)
		}
	}
	s.live.trackMidi([]byte{0x80, 60, 0})
	for _, a := range []float32{0.45, 0.3, 0.2, 0.1, 0.03, 0.01, 0, 0, 0, 0, 0, 0, 0, 0} {
		note(frame(a))
	}
	want := []string{"attack", "decay", "sustain", "release", ""}
	if fmt.Sprint(stages) != fmt.Sprint(want) {
		t.Fatalf("stages %v, want %v", stages, want)
	}
	// a filter's envelope says only what the notes say
	f := picGroup{kind: "env", keys: map[string]string{"attack": "filter_attack", "decay": "filter_decay"}}
	if l := fx.envelope("f", f, e, nil); l.Mode != "gate" {
		t.Fatalf("filter envelope: %q", l.Mode)
	}
}

func TestTimedVoices(t *testing.T) {
	now := 10 * time.Second
	snap := liveSnap{Now: now, Voices: []liveNote{
		{Note: 60, Vel: 127, On: now - 50*time.Millisecond},                           // in its attack (100 ms)
		{Note: 62, Vel: 64, On: now - 150*time.Millisecond},                           // in its decay (200 ms)
		{Note: 64, Vel: 64, On: now - 2*time.Second},                                  // holding
		{Note: 65, Vel: 64, On: now - 3*time.Second, Off: now - 250*time.Millisecond}, // half released (500 ms)
		{Note: 67, Vel: 64, On: now - 3*time.Second, Off: now - time.Second},          // done
	}}
	secs := map[string]float64{"attack": 0.1, "decay": 0.2, "release": 0.5}
	e := envShape{HasD: true, HasS: true, HasR: true}
	got := timedVoices(snap, secs, e)
	var desc []string
	for _, v := range got {
		desc = append(desc, fmt.Sprintf("%s %.2f", v.Stage, v.Progress))
	}
	want := "[attack 0.50 decay 0.25 sustain 0.50 release 0.50]"
	if fmt.Sprint(desc) != want {
		t.Fatalf("%v, want %s", desc, want)
	}
	if s, ok := secondsOf(ovValue{Display: "250", Unit: "ms"}); !ok || s != 0.25 {
		t.Fatal("ms")
	}
	if s, ok := secondsOf(ovValue{Display: "1.5 s"}); !ok || s != 1.5 {
		t.Fatal("s")
	}
	if _, ok := secondsOf(ovValue{Display: "64"}); ok {
		t.Fatal("a number with no unit is no time")
	}
}

func TestLFOPhase(t *testing.T) {
	if b, ok := beatsOf("1/8."); !ok || b != 0.75 {
		t.Fatal(b)
	}
	if b, ok := beatsOf("1/4T"); !ok || math.Abs(b-2.0/3) > 1e-9 {
		t.Fatal(b)
	}
	s := &Slot{}
	var fx liveFX
	fx.look(s)
	g := picGroup{kind: "lfo", keys: map[string]string{"shape": "lfo_shape", "rate": "lfo_rate", "sync": "lfo_sync", "trig": "lfo_trig"}}
	// a rate in Hz, free running: no phase
	vals := map[string]ovValue{"lfo_rate": {Display: "2.0", Unit: "Hz", Known: true}, "lfo_sync": {Display: "Off", Known: true}, "lfo_trig": {Display: "Off", Known: true}}
	if l := fx.lfo("a", g, vals); l.Phase >= 0 {
		t.Fatalf("free running, phase %v", l.Phase)
	}
	// restarted by notes: the phase is the time since the last note
	vals["lfo_trig"] = ovValue{Display: "Retrig", Known: true}
	s.live.trackMidi([]byte{0x90, 60, 100})
	time.Sleep(60 * time.Millisecond)
	fx.look(s)
	l := fx.lfo("a", g, vals)
	if l.Phase < 0.1 || l.Phase > 0.3 || l.Restart <= 0 {
		t.Fatalf("retriggered at 2 Hz after 60 ms: %+v", l)
	}
	// synced, in note values, with Live playing
	noteTransport(120, 3, true)
	fx.look(s)
	vals = map[string]ovValue{"lfo_rate": {Display: "1/2", Known: true}, "lfo_sync": {Display: "Sync", Known: true}, "lfo_trig": {Display: "Off", Known: true}}
	l = fx.lfo("b", g, vals)
	if !l.Synced || math.Abs(l.Phase-1.5) > 0.1 {
		t.Fatalf("1/2 synced at beat 3: %+v", l)
	}
	noteTransport(120, 3, false)
}

// The live pictures stay in their rects. PUNG_SHOTS=dir writes a note
// passing through each, frame by frame.
func TestDrawLivePictures(t *testing.T) {
	dir := os.Getenv("PUNG_SHOTS")
	s := &Slot{}
	ls := &liveSession{slot: s, pics: map[string]*livePic{}, subs: map[chan []byte]bool{}}
	sc := slotColor(0)
	env := picGroup{kind: "env", keys: map[string]string{"attack": "attack", "decay": "decay", "sustain": "sustain", "release": "release"}, start: 0, end: 4}
	flt := picGroup{kind: "filter", keys: map[string]string{"cutoff": "cutoff", "resonance": "resonance"}, start: 4, end: 6}
	lfo := picGroup{kind: "lfo", keys: map[string]string{"shape": "lfo_shape", "rate": "lfo_rate", "trig": "lfo_trig"}, start: 6, end: 8}
	vals := map[string]ovValue{
		"attack": {Frac: 0.3, Known: true}, "decay": {Frac: 0.4, Known: true}, "sustain": {Frac: 0.55, Known: true}, "release": {Frac: 0.5, Known: true},
		"cutoff": {Frac: 0.55, Known: true}, "resonance": {Frac: 0.6, Known: true},
		"lfo_shape": {Display: "Triangle", Known: true}, "lfo_rate": {Display: "1.5", Unit: "Hz", Frac: 0.4, Known: true}, "lfo_trig": {Display: "On", Known: true},
	}
	ph := 0.0
	amps := []float32{0, 0.2, 0.5, 0.9, 1, 0.85, 0.7, 0.6, 0.55, 0.55, 0.55, 0.4, 0.25, 0.12, 0.04, 0}
	for i, a := range amps {
		if i == 1 {
			s.live.trackMidi([]byte{0x90, 48, 110})
		}
		if i == 11 {
			s.live.trackMidi([]byte{0x80, 48, 0})
		}
		buf := block(a, 110, 1470, &ph)
		for k := 1; k < 6; k++ { // a few harmonics, for a spectrum to look at
			h := block(a/float32(k*2), 110*float64(k+1), 1470, new(float64))
			for j := range buf {
				buf[j] += h[j]
			}
		}
		s.live.feedAudio(buf)
		for _, g := range []picGroup{env, flt, lfo} {
			ls.want(g.kind, g, vals)
		}
		ls.tick()
		out := ls.frame()
		img := image.NewNRGBA(image.Rect(0, 0, scrW, scrH))
		for _, g := range []picGroup{env, flt, lfo} {
			r := image.Rect(g.start*colW+4, ovTop, g.end*colW-4, ovTop+ovHeight)
			drawPictureLive(img, r, g, vals, "", sc, ls, out, g.kind)
			for y := 0; y < scrH; y++ {
				for x := 0; x < scrW; x++ {
					if img.NRGBAAt(x, y).A != 0 && !(image.Point{x, y}.In(r)) && !inAny(x, y, env, flt, lfo) {
						t.Fatalf("frame %d %s: drew outside at %d,%d", i, g.kind, x, y)
					}
				}
			}
		}
		if out.Envs["env"] == nil || out.LFOs["lfo"] == nil || (i > 2 && out.Spec == nil) {
			t.Fatalf("frame %d: the session left a picture out: %+v", i, out)
		}
		if dir != "" {
			f, _ := os.Create(filepath.Join(dir, fmt.Sprintf("live-%02d.png", i)))
			png.Encode(f, img)
			f.Close()
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func inAny(x, y int, gs ...picGroup) bool {
	for _, g := range gs {
		if (image.Point{x, y}.In(image.Rect(g.start*colW+4, ovTop, g.end*colW-4, ovTop+ovHeight))) {
			return true
		}
	}
	return false
}

// A session sends a page each frame while the sound moves, one as it comes
// to rest, then only now and then; a page that is behind loses frames, it
// never holds the session up.
func TestSessionStreams(t *testing.T) {
	s := &Slot{}
	ls := &liveSession{slot: s, pics: map[string]*livePic{}, subs: map[chan []byte]bool{}}
	ch := make(chan []byte, 2)
	ls.subs[ch] = true
	ls.want("e", picGroup{kind: "env", keys: map[string]string{"attack": "attack", "decay": "decay"}}, map[string]ovValue{})
	drain := func() int {
		n := 0
		for {
			select {
			case <-ch:
				n++
			default:
				return n
			}
		}
	}
	ph := 0.0
	s.live.trackMidi([]byte{0x90, 60, 100})
	got := 0
	for i := 0; i < 10; i++ {
		s.live.feedAudio(block(0.5, 220, 1470, &ph))
		ls.tick()
		got += drain()
	}
	if got != 10 {
		t.Fatalf("moving: %d frames of 10", got)
	}
	for i := 0; i < 5; i++ { // a page that does not read: two frames wait, the rest are dropped
		ls.tick()
	}
	if n := drain(); n != 2 {
		t.Fatalf("a full page holds %d", n)
	}
	s.live.trackMidi([]byte{0x80, 60, 0})
	for i := 0; i < 15; i++ { // the level falls to silence
		ls.tick()
	}
	time.Sleep(liveLinger + 50*time.Millisecond) // and the linger runs out
	for i := 0; i < 3; i++ {
		ls.tick()
	}
	drain()
	quiet := 0
	for i := 0; i < liveHeartbeat*2; i++ {
		ls.tick()
		quiet += drain()
	}
	if quiet < 1 || quiet > 3 {
		t.Fatalf("at rest: %d frames in %d ticks", quiet, liveHeartbeat*2)
	}
	var doc map[string]any
	ls.tick()
	if err := json.Unmarshal(webFrame(ls.frame()), &doc); err != nil || doc["envs"] == nil || doc["info"] == nil {
		t.Fatalf("frame %v %v", doc, err)
	}
}

func TestLFOExtrasFromTheModule(t *testing.T) {
	all := []string{"lfo1_shape", "lfo1_rate", "lfo1_sync", "lfo1_keytrig", "lfo2_sync", "lfo1_rate_div", "cutoff"}
	got := lfoGroupsLoose(all, "lfo1_shape")[0]
	if got["sync"] != "lfo1_sync" || got["trig"] != "lfo1_keytrig" || got["div"] != "lfo1_rate_div" {
		t.Fatal(got)
	}
}
