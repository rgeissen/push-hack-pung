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
// A note runs through an envelope on its own clock: each stage takes its
// time, the plateau waits for the key, the release starts where the level was.
func TestEnvelopeClock(t *testing.T) {
	e := envCase([]string{"attack", "decay", "sustain", "release"}, map[string]float64{"sustain": 0.5}, "")
	v := envVoice{T: []float64{0.1, 0.2, 0, 0.5}, Off: -1}
	at := func(e envShape, age, off float64) string {
		v.Age, v.Off = age, off
		p := envAt(v, 0, e)
		if p.Done {
			return "done"
		}
		return fmt.Sprintf("%s %.2f", e.Segs[p.Seg].Label, p.Prog)
	}
	for _, c := range []struct {
		age, off float64
		want     string
	}{
		{0.05, -1, "A 0.50"},
		{0.2, -1, "D 0.50"},
		{3, -1, "S 0.00"},
		{3, 0.25, "R 0.50"},
		{3, 0.6, "done"},
		{0.075, 0.025, "R 0.05"}, // let go at 0.05 (level 0.5, the sustain's): the whole release
		{0.125, 0.1, "R 0.70"},   // let go at 0.025 (level 0.25): half way down already
	} {
		if got := at(e, c.age, c.off); got != c.want {
			t.Fatalf("age %.3f off %.3f: %s, want %s", c.age, c.off, got, c.want)
		}
	}
	// no plateau: it runs through by itself, let go or not
	ad := envCase([]string{"attack", "decay"}, nil, "")
	v = envVoice{T: []float64{0.1, 0.4}, Age: 0.3, Off: 0.2}
	if p := envAt(v, 0, ad); ad.Segs[p.Seg].Label != "D" || math.Abs(p.Prog-0.5) > 1e-9 {
		t.Fatalf("AD: %+v", p)
	}
	if p := envAt(v, 0.3, ad); !p.Done {
		t.Fatalf("AD over: %+v", p)
	}
	// a Roland envelope: T1 T2 T3, waits at L3, T4 from the let-go
	jv := envCase(envFleet["jv-amp"].keys, envFleet["jv-amp"].frac, "")
	v = envVoice{T: []float64{0.2, 0.3, 0.4, 0, 1}, Off: -1}
	for _, c := range []struct {
		age, off float64
		want     string
	}{{0.1, -1, "T1 0.50"}, {0.35, -1, "T2 0.50"}, {0.7, -1, "T3 0.50"}, {5, -1, "S 0.00"}, {5.5, 0.5, "T4 0.50"}, {7, 1.5, "done"}} {
		if got := at(jv, c.age, c.off); got != c.want {
			t.Fatalf("jv age %.2f off %.2f: %s, want %s", c.age, c.off, got, c.want)
		}
	}
	// a Yamaha envelope starts from its last level and returns to it
	dx := envCase(envFleet["dx"].keys, envFleet["dx"].frac, "")
	if dx.Start != dx.Segs[len(dx.Segs)-1].Level || !dx.Rates || dx.Segs[0].W > 0.1 {
		t.Fatalf("dx: start %.2f, rates %v, R1 at 0.95 drawn %.2f wide", dx.Start, dx.Rates, dx.Segs[0].W)
	}

	for _, c := range []struct {
		key  string
		v    ovValue
		secs float64
		src  string
	}{
		{"a", ovValue{Display: "250", Unit: "ms"}, 0.25, "stated"},
		{"a", ovValue{Display: "1.5 s"}, 1.5, "stated"},
		{"amp_attack_ms", ovValue{Value: "120", Display: "120", Type: "int", Max: 5000}, 0.12, "stated"},
		{"a", ovValue{Value: "0.5", Type: "float", Min: 0.001, Max: 3}, 0.5, "range"},
		{"a", ovValue{Value: "-1", Type: "float", Min: -8, Max: 5}, 0.5, "range"}, // Surge: log2 of seconds
		{"a", ovValue{Value: "0", Frac: 0, Type: "int", Max: 127}, envCurveMin, "curve"},
		{"a", ovValue{Value: "127", Frac: 1, Type: "int", Max: 127}, envCurveMax, "curve"},
		{"a", ovValue{Value: "0.5", Frac: 0.5, Type: "float", Max: 1}, 0.1414, "curve"},
	} {
		secs, src := stageTime(c.key, c.v, c.v.Frac, false)
		if src != c.src || math.Abs(secs-c.secs) > 1e-3 {
			t.Fatalf("%s %+v: %.4f %s, want %.4f %s", c.key, c.v, secs, src, c.secs, c.src)
		}
	}
}

// The amplitude envelope's note waits for the sound: the curve says the
// attack takes 2 ms, the sound takes about 200; the dot waits at the attack's
// corner until the level turns, and the next note's attack is the sound's.
func TestEnvelopeMeasuresTheSound(t *testing.T) {
	s := &Slot{}
	var fx liveFX
	g := picGroup{kind: "env", keys: map[string]string{"attack": "attack", "decay": "decay", "sustain": "sustain", "release": "release"}}
	vals := map[string]ovValue{
		"attack": {Value: "0", Frac: 0, Known: true}, "decay": {Value: "0", Frac: 0, Known: true},
		"sustain": {Value: "0.5", Frac: 0.5, Known: true}, "release": {Value: "0", Frac: 0, Known: true},
	}
	e := envShapeOf(g.keys, vals, "")
	ph := 0.0
	var stages []string
	frame := func(amp float32) *envLive {
		s.live.feedAudio(block(amp, 220, 1470, &ph))
		fx.look(s)
		l := fx.envelope("e", g, e, vals)
		st := "-"
		if len(l.Voices) > 0 {
			if p := envAt(l.Voices[0], 0, e); !p.Done {
				st = e.Segs[p.Seg].Role
			}
		}
		if os.Getenv("ENVDBG") != "" {
			tr := fx.envs["e"]
			fmt.Printf("lvl %.3f phase %d meas %v voices %+v st %s\n", fx.lvl, tr.m.phase, tr.meas[tr.m.on], l.Voices, st)
		}
		if len(stages) == 0 || stages[len(stages)-1] != st {
			stages = append(stages, st)
		}
		time.Sleep(liveTick)
		return l
	}
	frame(0)
	s.live.trackMidi([]byte{0x90, 60, 100})
	for _, a := range []float32{0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0, 0.85, 0.7, 0.6, 0.52, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5} {
		if l := frame(a); l.Source != "curve" {
			t.Fatalf("source %q", l.Source)
		}
	}
	s.live.trackMidi([]byte{0x80, 60, 0})
	for _, a := range []float32{0.4, 0.3, 0.2, 0.1, 0.05, 0.01, 0.001, 0, 0, 0, 0, 0, 0, 0} {
		frame(a)
	}
	if want := "[- attack decay sustain release -]"; fmt.Sprint(stages) != want {
		t.Fatalf("stages %v, want %s", stages, want)
	}
	tr := fx.envs["e"]
	if a := tr.scale[0] * envCurveMin; a < 0.15 || a > 0.3 {
		t.Fatalf("learned attack %.3f s, the sound's was about 0.22", a)
	}
	// the next note's dot runs on what was learned
	s.live.trackMidi([]byte{0x90, 62, 100})
	s.live.trackMidi([]byte{0x90, 64, 100}) // two held: nothing is measured
	l := frame(0.5)
	if len(l.Voices) != 2 || math.Abs(l.Voices[0].T[0]-tr.scale[0]*envCurveMin) > 1e-9 {
		t.Fatalf("voices %+v", l.Voices)
	}
	// an audio effect's envelope has no clock
	if l := fx.envelope("fx", picGroup{kind: "env", keys: g.keys, fx: true}, e, vals); len(l.Voices) != 0 || l.Source != "" {
		t.Fatalf("fx envelope %+v", l)
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

// A block that cannot run keeps its notes for the next one: a note-off is
// never lost with the block's audio (hanging notes), a note that began and
// ended while nothing ran is not played late, and streams are let go.
func TestSkippedBlocksKeepTheirNotes(t *testing.T) {
	var h heldMidi
	for _, m := range [][]byte{
		{0x80, 60, 0},   // the end of a note the module is sounding
		{0x90, 64, 100}, // a note that began ...
		{0xD0, 80, 0},   // pressure: a stream
		{0xB0, 74, 12},  // a controller: a stream
		{0x90, 67, 90},  // a key still down when the blocks run again
		{0x80, 64, 0},   // ... and ended while nothing ran
		{0xB0, 64, 0},   // the sustain pedal coming up
		{0x91, 64, 80},  // the same pitch on another channel: its own note
		{0xE0, 0, 64},   // a bend
		{0xB0, 123, 0},  // all notes off
		{0x90, 72, 0},   // a note-off written as a note-on of velocity 0
	} {
		h.keep(m)
	}
	var got []string
	n := h.flush(func(m []byte) { got = append(got, fmt.Sprintf("%02x %d %d", m[0], m[1], m[2])) })
	want := []string{"80 60 0", "90 67 90", "b0 64 0", "91 64 80", "b0 123 0", "90 72 0"}
	if fmt.Sprint(got) != fmt.Sprint(want) || n != len(want) || h.n != 0 {
		t.Fatalf("delivered %v (%d), want %v", got, n, want)
	}
	// full of held keys: a note-off still gets in, an old note-on gives way
	for i := 0; i < 400; i++ {
		h.keep([]byte{0x90, byte(i % 100), 100})
	}
	h.keep([]byte{0x80, 120, 0})
	offs := 0
	h.flush(func(m []byte) {
		if m[0] == 0x80 && m[1] == 120 {
			offs++
		}
	})
	if offs != 1 {
		t.Fatalf("a note-off was lost from a full buffer (%d)", offs)
	}
}
