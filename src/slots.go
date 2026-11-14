package main

// slots.go: a slot is one Schwung chain, bound to one Live track.
//
// On Move a slot is one of 4 fixed tracks and listens on MIDI channel N.
// Push does the same over ONE port, "Schwung": slot N is channel N. One port
// because Live needs the Track switch (and Sync, for clock) turned on by hand
// for every port a track may send to; one port is one switch. Each slot has
// its own Link Audio channel (an audio bus client named "Schwung N"). A Live
// track whose MIDI goes to port "Schwung", channel N, IS slot N's track: the
// binding lives in Live's routing and is saved with the Set.

import (
	"fmt"
	"log"
	"math"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/alsaseq"
	"github.com/federico-pepe/ableton-push-hack/core/audiobus"
)

type midiMsg struct {
	b [3]byte
	n uint8
}

type Slot struct {
	Index int    // 0-based; the user sees Index+1
	Name  string // "Schwung 1": the MIDI port and the Link channel

	own  sync.Mutex // held for each call into the chain; the engine only TRIES it
	midi chan midiMsg
	bus  *audiobus.Client
	seq  *alsaseq.Client // the host's one port, for MIDI a module sends

	loading   atomic.Bool // a long call (module load) holds the lock: skip, do not wait
	peakBits  atomic.Uint32
	busySkips atomic.Int64

	metaMu sync.Mutex
	meta   map[string]metaEntry // "<comp>:chain_params" etc, valid while the module is the same
	dirty     atomic.Bool
	notesIn   atomic.Int64
	midiOut   atomic.Int64
}

// Host owns the slots and the transport.
type Host struct {
	modulesDir string
	dataDir    string
	busSocket  string

	mu     sync.Mutex
	slots  [maxSlots]*Slot
	active atomic.Pointer[[]*Slot] // snapshot for the engine, never mutated in place

	seq       *alsaseq.Client // the one MIDI port, "Schwung"
	probeMu    sync.Mutex
	probeCache map[string]*compMeta // module id -> metadata, from a hidden chain instance

	stats     renderStats
	transport transport
	tempo     atomic.Uint64 // float64 bits, from Live (Remote Script) when known
}

func newHost(modulesDir, dataDir, busSocket string) *Host {
	h := &Host{modulesDir: modulesDir, dataDir: dataDir, busSocket: busSocket}
	empty := []*Slot{}
	h.active.Store(&empty)
	h.transport.h = h
	return h
}

func (h *Host) activeSlots() []*Slot { return *h.active.Load() }

func (h *Host) slot(i int) *Slot {
	if i < 0 || i >= maxSlots {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.slots[i]
}

func (h *Host) publish() {
	var list []*Slot
	for _, s := range h.slots {
		if s != nil {
			list = append(list, s)
		}
	}
	h.active.Store(&list)
}

// format is the bus's period and rate, from the first connected slot.
func (h *Host) format() (period, rate int) {
	for _, s := range h.activeSlots() {
		if s.bus != nil && s.bus.Connected() {
			f := s.bus.Format()
			if f.Period > 0 && f.Rate > 0 {
				return f.Period, f.Rate
			}
		}
	}
	return defaultPer, moduleRate
}

// openSlot creates slot i: the chain instance, the MIDI port, the bus client.
func (h *Host) openSlot(i int) (*Slot, error) {
	if i < 0 || i >= maxSlots {
		return nil, fmt.Errorf("slot %d out of range 1..%d", i+1, maxSlots)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if s := h.slots[i]; s != nil {
		return s, nil
	}
	if err := cSlotCreate(i); err != nil {
		return nil, err
	}
	s := &Slot{Index: i, Name: fmt.Sprintf("Schwung %d", i+1), midi: make(chan midiMsg, 1024), seq: h.seq}
	s.bus = audiobus.OpenWithInputs(h.busSocket, s.Name, -1, []string{s.Name + " In"})
	h.slots[i] = s
	h.publish()
	log.Printf("%s: open", s.Name)
	return s, nil
}

func (h *Host) closeSlot(i int) {
	h.mu.Lock()
	s := h.slots[i]
	h.slots[i] = nil
	h.publish()
	h.mu.Unlock()
	if s == nil {
		return
	}
	s.own.Lock()
	cSlotDestroy(i)
	s.own.Unlock()
	if s.bus != nil {
		s.bus.Close()
	}
	log.Printf("%s: closed", s.Name)
}

// ---- control calls (any goroutine) ---------------------------------------

func (s *Slot) Set(key, val string) {
	heavy := heavyKey(key)
	if heavy {
		s.loading.Store(true)
		defer s.loading.Store(false)
	}
	s.own.Lock()
	cSet(s.Index, key, val)
	if heavy {
		cWarm(s.Index, 2) // a module's first render may be slow: take it here, not on the engine
	}
	s.own.Unlock()
	s.dirty.Store(true)
}

// heavyKey: a write that may load or unload modules (dlopen, create_instance).
func heavyKey(k string) bool {
	switch k {
	case "load_file", "load_patch", "patch", "clear", "fx:insert", "fx:remove", "fx:move",
		"midi_fx:insert", "midi_fx:remove", "midi_fx:move":
		return true
	}
	return strings.HasSuffix(k, ":module") || strings.HasSuffix(k, ":state")
}

// acquire is the engine's side of the lock: false means skip this slot
// for this period (a module is loading). It never sleeps.
func (s *Slot) acquire() bool {
	for i := 0; ; i++ {
		if s.loading.Load() {
			return false
		}
		if s.own.TryLock() {
			return true
		}
		if i > 200000 { // ~ms of spinning: something is badly wrong, give up this period
			return false
		}
		runtime.Gosched()
	}
}

type metaEntry struct {
	module, value string
	ok            bool
}

// Meta reads a component's metadata ("chain_params", "ui_hierarchy") once
// per loaded module. A module may build that JSON on every call, and the
// engine waits while a read holds the slot: re-reading it on every poll
// is what made a period run late (4.7 ms, found 2026-11-14).
func (s *Slot) Meta(comp, key string) (string, bool) {
	modKey := comp + "_module"
	if comp == "synth" {
		modKey = "synth_module"
	}
	module, _ := s.Get(modKey)
	ck := comp + ":" + key
	s.metaMu.Lock()
	if e, ok := s.meta[ck]; ok && e.module == module {
		s.metaMu.Unlock()
		return e.value, e.ok
	}
	s.metaMu.Unlock()
	v, ok := s.Get(ck)
	s.metaMu.Lock()
	if s.meta == nil {
		s.meta = map[string]metaEntry{}
	}
	s.meta[ck] = metaEntry{module: module, value: v, ok: ok}
	s.metaMu.Unlock()
	return v, ok
}

func (s *Slot) Get(key string) (string, bool) {
	s.own.Lock()
	defer s.own.Unlock()
	return cGet(s.Index, key)
}

// Note plays a note into the slot as if it came from Live (tests, the web page).
func (s *Slot) Note(note, vel int) {
	st := byte(0x90)
	if vel == 0 {
		st = 0x80
	}
	s.queue([]byte{st, byte(note & 0x7F), byte(vel & 0x7F)})
}

func (s *Slot) queue(msg []byte) {
	var m midiMsg
	m.n = uint8(copy(m.b[:], msg))
	select {
	case s.midi <- m:
	default: // full: the engine is stuck; dropping is better than blocking a reader
	}
}

// ---- engine side ---------------------------------------------------------

func (s *Slot) drainMidi() {
	for {
		select {
		case m := <-s.midi:
			cMidi(s.Index, m.b[:m.n], 0)
		default:
			return
		}
	}
}

func (s *Slot) readInput(buf []float32) []float32 {
	if s.bus == nil || !s.bus.Connected() || len(s.bus.Inputs()) == 0 {
		return nil
	}
	if n, _ := s.bus.Read(0, buf); n == 0 {
		return nil
	}
	return buf
}

func (s *Slot) setPeak(p float32) {
	// a falling meter: hold the max, decay the rest
	old := math.Float32frombits(s.peakBits.Load())
	if p < old {
		p = old * 0.92
	}
	s.peakBits.Store(math.Float32bits(p))
}

func (s *Slot) peak() float32 { return math.Float32frombits(s.peakBits.Load()) }

// sendOut forwards MIDI a module sent (4-byte USB-MIDI packets) out of the
// slot's port. Called by the engine; alsaseq writes do not block.
func (s *Slot) sendOut(packets []byte) {
	if s.seq == nil {
		return
	}
	for i := 0; i+3 < len(packets); i += 4 {
		msg := usbMidiToRaw(packets[i : i+4])
		if msg == nil {
			continue
		}
		if ok, _ := s.seq.SendMIDI(alsaseq.Subscribers, msg); ok {
			s.midiOut.Add(1)
		}
	}
}

// usbMidiToRaw turns one USB-MIDI packet into its raw MIDI message.
func usbMidiToRaw(p []byte) []byte {
	switch p[0] & 0x0F { // CIN
	case 0x8, 0x9, 0xA, 0xB, 0xE:
		return []byte{p[1], p[2], p[3]}
	case 0xC, 0xD:
		return []byte{p[1], p[2]}
	case 0xF:
		return []byte{p[1]}
	}
	return nil
}

// ---- MIDI port -----------------------------------------------------------

// hostReader dispatches what arrives on the "Schwung" port: a channel
// message goes to the slot of its channel, clock to the transport.
type hostReader struct{ h *Host }

func (r hostReader) Fixed(evType uint8, src alsaseq.Addr, data []byte) {
	msg := alsaseq.DecodeMIDI(evType, data)
	if len(msg) == 0 {
		return
	}
	switch msg[0] {
	case 0xF8, 0xFA, 0xFB, 0xFC:
		r.h.transport.event(msg[0]) // fanned out to every slot
		return
	}
	if msg[0] >= 0xF0 {
		return
	}
	s := r.h.slot(int(msg[0] & 0x0F))
	if s == nil {
		return
	}
	if msg[0]&0xF0 == 0x90 && len(msg) == 3 && msg[2] > 0 {
		s.notesIn.Add(1)
	}
	s.queue(msg)
}

func (r hostReader) VarLen(evType uint8, src alsaseq.Addr, payload []byte) {}

// openPort creates the "Schwung" port. Live lists it under MIDI ports at
// once; the user turns on Track (and Sync, for clock) for it once.
func (h *Host) openPort() error {
	c, err := alsaseq.Open()
	if err != nil {
		return err
	}
	if err := c.SetName("Schwung"); err != nil {
		log.Printf("midi: set name: %v", err)
	}
	caps := alsaseq.CapRead | alsaseq.CapWrite | alsaseq.CapSubsRead | alsaseq.CapSubsWrite
	if _, err := c.CreatePort("Schwung", caps, alsaseq.PortTypeMidi|alsaseq.PortTypeApp); err != nil {
		c.Close()
		return err
	}
	h.seq = c
	go func() {
		err := c.ReadLoop(hostReader{h: h})
		log.Printf("midi: reader stopped: %v", err)
	}()
	return nil
}

// ---- transport -----------------------------------------------------------

// transport follows Live's MIDI clock (the "Schwung" port with Sync on) and
// fans it out to every slot, so each chain's arpeggiator and synced LFOs run.
type transport struct {
	h       *Host
	mu      sync.Mutex
	seen    bool // clock arrived recently
	lastAt  time.Time
	running bool
	ticks   int64
	tickAt  time.Time
	tickDur float64 // seconds per tick, smoothed
}

func (t *transport) event(b byte) {
	t.mu.Lock()
	now := time.Now()
	t.seen = true
	t.lastAt = now
	switch b {
	case 0xFA:
		t.running, t.ticks = true, 0
	case 0xFB:
		t.running = true
	case 0xFC:
		t.running = false
	case 0xF8:
		if !t.tickAt.IsZero() {
			d := now.Sub(t.tickAt).Seconds()
			if d > 0.0005 && d < 0.2 {
				if t.tickDur == 0 {
					t.tickDur = d
				} else {
					t.tickDur += (d - t.tickDur) * 0.05
				}
			}
		}
		t.tickAt = now
		if t.running {
			t.ticks++
		}
	}
	status, beat := 1, -1.0 // MOVE_CLOCK_STATUS_STOPPED
	if t.running {
		status = 2 // RUNNING
		// the first clock after Start IS the downbeat (Schwung's grid,
		// transport_grid.h): beats sit at ticks 24N+1
		if t.ticks > 0 {
			beat = float64(t.ticks-1) / 24
		} else {
			beat = 0
		}
	}
	if t.tickDur > 0 {
		setTempo(60 / (t.tickDur * 24))
	}
	setClock(status, beat)
	t.mu.Unlock()

	for _, s := range t.h.activeSlots() {
		s.queue([]byte{b})
	}
}

// watch drops the clock to UNAVAILABLE when Live stops sending it.
func (t *transport) watch() {
	for range time.Tick(500 * time.Millisecond) {
		t.mu.Lock()
		if t.seen && time.Since(t.lastAt) > 2*time.Second {
			t.seen, t.running = false, false
			setClock(0, -1)
		}
		t.mu.Unlock()
	}
}

// clockSeen: Live's MIDI clock arrives on the port (Sync is on).
func (h *Host) clockSeen() bool {
	h.transport.mu.Lock()
	defer h.transport.mu.Unlock()
	return h.transport.seen
}

func floatBits(f float64) uint64      { return math.Float64bits(f) }
func floatFromBits(b uint64) float64  { return math.Float64frombits(b) }

func (t *transport) snapshot() (running bool, bpm float64, clock bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.tickDur > 0 && t.seen {
		bpm = 60 / (t.tickDur * 24)
	}
	return t.running, bpm, t.seen
}
