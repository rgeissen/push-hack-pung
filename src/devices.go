package main

// devices.go: the Schwung service's side of DESIGN-v2. Every Schwung device
// in Live (a Schwung.vst3 plugin) is one chain instance here, outside Live's
// process, so a module that crashes cannot take Live down.
//
//   - vst3-classes.json: one plugin class per installed module, with its
//     parameters, written at start. Schwung.vst3 builds its factory from it,
//     so Live sees every module even while this service is down.
//   - devices.sock: JSON lines from the plugins (create, destroy, state).
//     A connection that closes takes its devices with it (Live quit or
//     crashed).
//   - /dev/shm/schwung-dev-<id>: one block at a time, see schwung_ipc.h.
//     One realtime thread per device, at Live's own audio priority.

/*
#include "schwung_ipc.h"
*/
import "C"

import (
	"bufio"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

)

// ---- classes ------------------------------------------------------------------

type vstParam struct {
	Name    string   `json:"name"`
	Key     string   `json:"key"`  // the chain key it writes: synth:cutoff, fx1:mix, midi_fx1:rate
	Type    string   `json:"type"` // float | int | enum
	Min     float64  `json:"min"`
	Max     float64  `json:"max"`
	Unit    string   `json:"unit,omitempty"`
	Format  string   `json:"format,omitempty"`
	Options []string `json:"options,omitempty"`
	Default float64  `json:"default"` // normalized
	Gate    string   `json:"gate,omitempty"` // only while this MIDI effect is loaded
	Role    string   `json:"role,omitempty"` // "midifx" (which MIDI effect), "outch" (MIDI out channel)
	meta    *paramMeta
	gateIdx int // 1-based index of the MIDI effect in the selector, 0 = none
}

type vstClass struct {
	UID      string     `json:"uid"`
	Name     string     `json:"name"`
	Kind     string     `json:"kind"` // instrument | effect | midi
	Module   string     `json:"module"`
	Category string     `json:"category"` // VST3 sub categories
	Params   []vstParam `json:"params"`
	Banks    [][]int    `json:"banks"` // parameter indexes, 8 per bank, in the module's own order
	midiFX   []string   // the selector's modules (index 0 = none)
}

func classUID(kind, module string) string {
	sum := md5.Sum([]byte("schwung-vst3:" + kind + ":" + module))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func toVstParams(cm *compMeta, prefix string) []vstParam {
	var out []vstParam
	for _, k := range cm.Order {
		m := cm.Params[k]
		if m == nil || m.ReadOnly {
			continue
		}
		switch m.Type {
		case "float", "int":
			if m.Max <= m.Min {
				continue
			}
		case "enum":
			if len(m.Options) == 0 {
				continue
			}
		default:
			continue // strings, paths: not a knob
		}
		// where a new instance really starts; the declared default only
		// if the module would not say
		def := 0.0
		if v, ok := cm.Initial[k]; ok {
			def = m.toNormValue(v)
		} else if m.Default != nil {
			def = m.toNormValue(strconvFloat(*m.Default))
		}
		out = append(out, vstParam{Name: m.Name, Key: prefix + ":" + k, Type: m.Type, Min: m.Min, Max: m.Max,
			Unit: m.Unit, Format: m.Format, Options: m.Options, Default: def, meta: m})
	}
	return out
}

func strconvFloat(f float64) string { return fmt.Sprintf("%g", f) }

// banksFor lays out a class's parameters in the module's own banks.
func banksFor(params []vstParam, cm *compMeta, prefix string) [][]int {
	idx := map[string]int{}
	for i, p := range params {
		idx[p.Key] = i
	}
	var banks [][]int
	seen := map[int]bool{}
	if cm != nil {
		for _, b := range cm.Banks {
			var row []int
			for _, k := range b.Keys {
				if i, ok := idx[prefix+":"+k]; ok && !seen[i] {
					row = append(row, i)
					seen[i] = true
				}
			}
			if len(row) > 0 {
				banks = append(banks, row)
			}
		}
	}
	var rest []int
	for i := range params {
		if !seen[i] {
			rest = append(rest, i)
		}
	}
	for i := 0; i < len(rest); i += 8 {
		end := i + 8
		if end > len(rest) {
			end = len(rest)
		}
		banks = append(banks, rest[i:end])
	}
	return banks
}

// buildClasses makes one class per installed module.
func (h *Host) buildClasses() []*vstClass {
	mods := scanModules(h.modulesDir)
	var midiFX []ModuleInfo
	for _, m := range mods {
		if m.Type == "midi_fx" && m.Loadable {
			midiFX = append(midiFX, m)
		}
	}
	var classes []*vstClass
	for _, m := range mods {
		if !m.Loadable {
			continue
		}
		cm, ok := h.probeMeta(m)
		if !ok || cm == nil {
			continue
		}
		c := &vstClass{Module: m.ID, Name: "Schwung " + m.Name}
		switch m.Type {
		case "sound_generator":
			if moduleWantsAudioIn(m) {
				continue // Line In and friends: Live has its own inputs
			}
			c.Kind, c.Category = "instrument", "Instrument|Synth"
			c.Params = toVstParams(cm, "synth")
			c.Banks = banksFor(c.Params, cm, "synth")
			// form 1 of the MIDI-effect design: one MIDI effect in front of the synth
			if len(midiFX) > 0 {
				sel := vstParam{Name: "MIDI FX", Key: "midi_fx1:module", Type: "enum", Options: []string{"None"}, Role: "midifx"}
				c.midiFX = []string{""}
				for _, f := range midiFX {
					sel.Options = append(sel.Options, f.Name)
					c.midiFX = append(c.midiFX, f.ID)
				}
				sel.Max = float64(len(sel.Options) - 1)
				sel.meta = &paramMeta{Key: "midi_fx", Name: "MIDI FX", Type: "enum", Options: sel.Options}
				selIdx := len(c.Params)
				c.Params = append(c.Params, sel)
				for gi, f := range midiFX {
					fm, ok := h.probeMeta(f)
					if !ok || fm == nil {
						continue
					}
					first := len(c.Params)
					for _, p := range toVstParams(fm, "midi_fx1") {
						p.Name = shortName(f) + " " + p.Name
						p.Gate, p.gateIdx = f.ID, gi+1
						c.Params = append(c.Params, p)
					}
					row := []int{selIdx}
					for i := first; i < len(c.Params) && len(row) < 8; i++ {
						row = append(row, i)
					}
					c.Banks = append(c.Banks, row)
				}
			}
		case "audio_fx":
			c.Kind, c.Category = "effect", "Fx"
			c.Params = toVstParams(cm, "fx1")
			c.Banks = banksFor(c.Params, cm, "fx1")
		case "midi_fx":
			// No MIDI-in/MIDI-out class: Live 13.0b25's scan files that shape as
			// an audio effect (device:vst3:audiofx, measured 2026-11-14), so it
			// cannot sit in Live's MIDI-effect position. The proxy still knows
			// the "midifx" kind, for a Live that takes it one day.
			// form 2: a device on its own track whose MIDI other tracks hear
			c.Name = "Schwung " + m.Name + " Track"
			c.Kind, c.Category = "midi", "Instrument"
			c.Params = toVstParams(cm, "midi_fx1")
			c.Banks = banksFor(c.Params, cm, "midi_fx1")
			ch := vstParam{Name: "MIDI Out Ch", Key: "outch", Type: "enum", Role: "outch", Max: 15}
			for i := 1; i <= 16; i++ {
				ch.Options = append(ch.Options, fmt.Sprintf("Ch. %d", i))
			}
			ch.meta = &paramMeta{Key: "outch", Name: "MIDI Out Ch", Type: "enum", Options: ch.Options}
			c.Params = append(c.Params, ch)
			c.Banks = append(c.Banks, []int{len(c.Params) - 1})
		default:
			continue
		}
		padBanks(c)
		if len(c.Params) > C.SB_IPC_MAXPAR {
			c.Params = c.Params[:C.SB_IPC_MAXPAR]
		}
		c.UID = classUID(c.Kind, m.ID)
		classes = append(classes, c)
	}
	sort.Slice(classes, func(i, j int) bool { return classes[i].Name < classes[j].Name })
	return classes
}

// padBanks makes every bank but the last fill whole pages of 8: Push shows a
// plugin's parameters 8 to a page in the order the browser entry lists them,
// so a bank of 5 would otherwise share its page with the next bank's first 3.
// Each gap is a placeholder parameter of its own (Role "pad": blank, read
// only, ignored by the service): a parameter listed twice gets two values in
// Live, so one placeholder cannot fill two gaps.
func padBanks(c *vstClass) {
	// each parameter once, in its first bank (the MIDI FX selector heads every
	// MIDI-effect bank); an emptied bank goes
	seen := map[int]bool{}
	var banks [][]int
	for _, bank := range c.Banks {
		var keep []int
		for _, i := range bank {
			if !seen[i] {
				seen[i] = true
				keep = append(keep, i)
			}
		}
		if len(keep) > 0 {
			banks = append(banks, keep)
		}
	}
	c.Banks = banks
	for b := 0; b < len(c.Banks)-1; b++ {
		for len(c.Banks[b])%8 != 0 {
			c.Banks[b] = append(c.Banks[b], len(c.Params))
			c.Params = append(c.Params, vstParam{Name: "", Key: "", Type: "pad", Role: "pad"})
		}
	}
}

func shortName(m ModuleInfo) string {
	if m.Abbrev != "" {
		return m.Abbrev
	}
	return m.Name
}

func moduleWantsAudioIn(m ModuleInfo) bool {
	raw, err := os.ReadFile(filepath.Join(m.Dir, "module.json"))
	if err != nil {
		return false
	}
	var j struct {
		Capabilities struct {
			AudioIn bool `json:"audio_in"`
		} `json:"capabilities"`
	}
	json.Unmarshal(raw, &j)
	return j.Capabilities.AudioIn
}

// writeClasses writes vst3-classes.json. When it changed, the plugin's
// timestamp is touched, so Live scans the bundle again at its next start.
func writeClasses(path, bundle string, classes []*vstClass) error {
	doc, _ := json.MarshalIndent(map[string]any{"version": 1, "classes": classes}, "", " ")
	if old, err := os.ReadFile(path); err == nil && string(old) == string(doc) {
		return nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, doc, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	so := filepath.Join(bundle, "Contents", "x86_64-linux", "Schwung.so")
	now := time.Now()
	os.Chtimes(so, now, now)
	log.Printf("devices: %d classes written to %s", len(classes), path)
	return nil
}

// ---- devices ------------------------------------------------------------------

type device struct {
	id    int
	class *vstClass
	s     *Slot
	shm   []byte
	path  string
	quit  atomic.Bool
	done  chan struct{}
	outCh int

	midiFX      int // loaded MIDI effect (index into class.midiFX)
	wantMidiFX  atomic.Int32
	switchingFX atomic.Bool

	// what the device did, for /api/devices (written by run, read by HTTP)
	blocks, notesIn, notesOut atomic.Uint64
	inPeak, outPeak         atomic.Uint32 // float32 bits, the last second's peak
}

type devices struct {
	h       *Host
	mu      sync.Mutex
	classes map[string]*vstClass
	list    map[int]*device
	next    int
}

func newDevices(h *Host, classes []*vstClass) *devices {
	d := &devices{h: h, classes: map[string]*vstClass{}, list: map[int]*device{}, next: 1}
	for _, c := range classes {
		d.classes[c.UID] = c
	}
	return d
}

func (ds *devices) freeSlot() int {
	used := map[int]bool{maxSlots - 1: true} // the metadata probe
	for _, d := range ds.list {
		used[d.s.Index] = true
	}
	for i := 0; i < maxSlots; i++ {
		if !used[i] && ds.h.slot(i) == nil {
			return i
		}
	}
	return -1
}

func (ds *devices) create(uid string) (*device, error) {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	c, ok := ds.classes[uid]
	if !ok {
		return nil, fmt.Errorf("unknown class %s", uid)
	}
	slot := ds.freeSlot()
	if slot < 0 {
		return nil, fmt.Errorf("all %d device instances are in use", maxSlots-1)
	}
	if err := cSlotCreate(slot); err != nil {
		return nil, err
	}
	s := &Slot{Index: slot, Name: c.Name, midi: make(chan midiMsg, 1024), seq: ds.h.seq}
	switch c.Kind {
	case "instrument":
		s.Set("synth:module", c.Module)
	case "effect":
		s.Set("fx1:module", c.Module)
	case "midi", "midifx":
		s.Set("midi_fx1:module", c.Module)
		sinkMIDI(s)
	}
	id := ds.next
	ds.next++
	path := fmt.Sprintf("/dev/shm/schwung-dev-%d", id)
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0o666)
	if err != nil {
		cSlotDestroy(slot)
		return nil, err
	}
	os.Chmod(path, 0o666) // Live runs as ableton
	if err := f.Truncate(C.SB_IPC_SIZE); err != nil {
		f.Close()
		cSlotDestroy(slot)
		return nil, err
	}
	mem, err := syscall.Mmap(int(f.Fd()), 0, C.SB_IPC_SIZE, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
	f.Close()
	if err != nil {
		cSlotDestroy(slot)
		return nil, err
	}
	*u32(mem, C.SB_OFF_MAGIC) = C.SB_IPC_MAGIC
	*u32(mem, C.SB_OFF_VERSION) = C.SB_IPC_VERSION
	d := &device{id: id, class: c, s: s, shm: mem, path: path, done: make(chan struct{})}
	ds.list[id] = d
	go d.run(ds.h)
	log.Printf("devices: %d %s (chain %d)", id, c.Name, slot)
	return d, nil
}

func (ds *devices) destroy(id int) {
	ds.mu.Lock()
	d := ds.list[id]
	delete(ds.list, id)
	ds.mu.Unlock()
	if d == nil {
		return
	}
	d.quit.Store(true)
	futexWake(u32(d.shm, C.SB_OFF_REQ))
	<-d.done
	d.s.own.Lock()
	cSlotDestroy(d.s.Index)
	d.s.own.Unlock()
	syscall.Munmap(d.shm)
	os.Remove(d.path)
	log.Printf("devices: %d %s closed", id, d.class.Name)
}

// C_SB_IPC_SOCKET is the control socket's path (schwung_ipc.h).
var C_SB_IPC_SOCKET = C.SB_IPC_SOCKET

func u32(b []byte, off int) *uint32 { return (*uint32)(unsafe.Pointer(&b[off])) }
func f32(b []byte, off int) *float32 { return (*float32)(unsafe.Pointer(&b[off])) }
func f64(b []byte, off int) *float64 { return (*float64)(unsafe.Pointer(&b[off])) }

func futexWait(addr *uint32, val uint32, d time.Duration) {
	ts := syscall.NsecToTimespec(int64(d))
	syscall.Syscall6(syscall.SYS_FUTEX, uintptr(unsafe.Pointer(addr)), 0 /* FUTEX_WAIT, shared */, uintptr(val),
		uintptr(unsafe.Pointer(&ts)), 0, 0)
}

func futexWake(addr *uint32) {
	syscall.Syscall6(syscall.SYS_FUTEX, uintptr(unsafe.Pointer(addr)), 1 /* FUTEX_WAKE, shared */, 1<<30, 0, 0, 0)
}

// run renders the device one block at a time, as the proxy asks.
func (d *device) run(h *Host) {
	defer close(d.done)
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	cSetRealtime(70) // Live's own audio threads run at FIFO 70
	req, done := u32(d.shm, C.SB_OFF_REQ), u32(d.shm, C.SB_OFF_DONE)
	last := atomic.LoadUint32(req)
	in := make([]float32, C.SB_IPC_MAXF*2)
	out := make([]float32, C.SB_IPC_MAXF*2)
	midiBuf := make([]byte, 256)
	for !d.quit.Load() {
		r := atomic.LoadUint32(req)
		if r == last {
			futexWait(req, r, 200*time.Millisecond)
			atomic.AddUint32(u32(d.shm, C.SB_OFF_ALIVE), 1)
			continue
		}
		last = r
		frames := int(atomic.LoadUint32(u32(d.shm, C.SB_OFF_FRAMES)))
		if frames <= 0 || frames > C.SB_IPC_MAXF {
			frames = 0
		}
		flags := *u32(d.shm, C.SB_OFF_FLAGS)
		if flags&2 != 0 {
			setTempo(*f64(d.shm, C.SB_OFF_BPM))
			if flags&1 != 0 {
				setClock(2, *f64(d.shm, C.SB_OFF_BEAT))
			} else {
				setClock(1, -1)
			}
		}
		o := out[:frames*2]
		if d.s.acquire() {
			d.applyParams()
			d.applyEvents()
			var input []float32
			if d.class.Kind == "effect" {
				input = in[:frames*2]
				for i := 0; i < frames; i++ {
					input[i*2] = *f32(d.shm, C.SB_OFF_IN_L+i*4)
					input[i*2+1] = *f32(d.shm, C.SB_OFF_IN_R+i*4)
				}
			}
			if frames > 0 {
				cRender(d.s.Index, o, input)
			}
			d.blocks.Add(1)
			d.peak(&d.inPeak, input)
			d.peak(&d.outPeak, o)
			nout := 0
			for {
				n := cTakeMidiOut(d.s.Index, midiBuf)
				if n <= 0 {
					break
				}
				for i := 0; i+3 < n; i += 4 {
					if midiBuf[i]&0x0F == 0x09 && midiBuf[i+3] > 0 {
						d.notesOut.Add(1)
					}
				}
				nout = d.eventsOut(midiBuf[:n], nout)
			}
			*u32(d.shm, C.SB_OFF_ONEV) = uint32(nout)
			d.s.own.Unlock()
		} else {
			clear(o) // a module is loading: silence, never a wait
		}
		for i := 0; i < frames; i++ {
			*f32(d.shm, C.SB_OFF_OUT_L+i*4) = o[i*2]
			*f32(d.shm, C.SB_OFF_OUT_R+i*4) = o[i*2+1]
		}
		atomic.StoreUint32(done, r)
		futexWake(done)
	}
}

func (d *device) applyParams() {
	n := int(*u32(d.shm, C.SB_OFF_NPAR))
	if n > C.SB_IPC_MAXPAR {
		n = C.SB_IPC_MAXPAR
	}
	for i := 0; i < n; i++ {
		off := C.SB_OFF_PARAMS + i*8
		idx := int(*u32(d.shm, off))
		norm := float64(*f32(d.shm, off+4))
		if idx < 0 || idx >= len(d.class.Params) {
			continue
		}
		p := &d.class.Params[idx]
		switch p.Role {
		case "pad":
			continue // a placeholder: nothing behind it
		case "outch":
			d.outCh = int(math.Round(norm * 15))
			continue
		case "midifx":
			want := int(math.Round(norm * float64(len(d.class.midiFX)-1)))
			if want != d.midiFX && !d.switchingFX.Load() {
				d.switchMidiFX(want)
			}
			continue
		}
		if p.gateIdx != 0 && p.gateIdx != d.midiFX {
			continue // belongs to a MIDI effect that is not loaded
		}
		cSet(d.s.Index, p.Key, p.meta.fromNorm(norm))
	}
}

// switchMidiFX loads another MIDI effect off the render thread: a module load
// is a dlopen. The slot is skipped (silent) while it loads.
func (d *device) switchMidiFX(want int) {
	d.switchingFX.Store(true)
	d.midiFX = want
	id := d.class.midiFX[want]
	go func() {
		defer d.switchingFX.Store(false)
		d.s.Set("midi_fx1:module", id)
	}()
}

func (d *device) applyEvents() {
	n := int(*u32(d.shm, C.SB_OFF_NEV))
	if n > C.SB_IPC_MAXEV {
		n = C.SB_IPC_MAXEV
	}
	for i := 0; i < n; i++ {
		off := C.SB_OFF_EVENTS + i*8
		l := int(d.shm[off+4])
		if l < 1 || l > 3 {
			continue
		}
		m := d.shm[off+5 : off+5+l]
		if l == 3 && m[0]&0xF0 == 0x90 && m[2] > 0 {
			d.notesIn.Add(1)
		}
		cMidi(d.s.Index, m, 0)
	}
}

// peak keeps the loudest sample of the last second (44100 frames, about
// 344 blocks of 128): one atomic store per block, no lock on the RT thread.
func (d *device) peak(dst *atomic.Uint32, buf []float32) {
	var p float32
	for _, v := range buf {
		if v < 0 {
			v = -v
		}
		if v > p {
			p = v
		}
	}
	old := math.Float32frombits(dst.Load())
	if d.blocks.Load()%344 == 0 {
		old = 0
	}
	if p > old {
		old = p
	}
	dst.Store(math.Float32bits(old))
}

// stats is one line of /api/devices.
func (d *device) stats() map[string]any {
	return map[string]any{"id": d.id, "name": d.class.Name, "kind": d.class.Kind, "module": d.class.Module,
		"blocks": d.blocks.Load(), "notes_in": d.notesIn.Load(), "notes_out": d.notesOut.Load(),
		"in_peak": math.Float32frombits(d.inPeak.Load()), "out_peak": math.Float32frombits(d.outPeak.Load()),
		"midi_fx": d.midiFXName()}
}

// midiFXName: the MIDI effect an instrument device runs in front of its
// synth, "" for none.
func (d *device) midiFXName() string {
	if d.class.Kind != "instrument" {
		return ""
	}
	v, _ := d.s.Get("midi_fx1_module")
	return v
}

// handle serves GET /api/devices: every Schwung device Live has made.
func (ds *devices) handle(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/devices", func(w http.ResponseWriter, r *http.Request) {
		ds.mu.Lock()
		out := []map[string]any{}
		for _, d := range ds.list {
			out = append(out, d.stats())
		}
		ds.mu.Unlock()
		sort.Slice(out, func(i, j int) bool { return out[i]["id"].(int) < out[j]["id"].(int) })
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"devices": out})
	})
}

// sinkMIDI makes a chain's MIDI FX output the device's MIDI out: the
// midi-sink instrument (src/sink) catches everything the effect plays and
// hands it to the bridge. Schwung's pre mode is off: it is built for Move
// playing alongside and drops held pitches and chord roots.
func sinkMIDI(s *Slot) {
	s.Set("midi_fx_pre_mode", "0")
	if v, _ := s.Get("synth_module"); v != sinkModule {
		s.Set("synth:module", sinkModule)
	}
}

const sinkModule = "midi-sink"

// eventsOut hands a MIDI-effect device's output back to its plugin, which
// gives it to Live in the same block (the traditional MIDI-effect shape).
func (d *device) eventsOut(packets []byte, n int) int {
	if d.class.Kind != "midifx" && d.class.Kind != "midi" {
		return n
	}
	for i := 0; i+3 < len(packets) && n < C.SB_IPC_MAXEV; i += 4 {
		msg := usbMidiToRaw(packets[i : i+4])
		if len(msg) == 0 || msg[0] >= 0xF0 {
			continue
		}
		off := C.SB_OFF_OEVENTS + n*8
		*u32(d.shm, off) = 0
		d.shm[off+4] = byte(len(msg))
		copy(d.shm[off+5:off+8], msg)
		if d.class.Kind == "midi" { // the device's "MIDI Out Ch"
			d.shm[off+5] = msg[0]&0xF0 | byte(d.outCh&15)
		}
		n++
	}
	return n
}

// ---- the control socket -------------------------------------------------------

func (ds *devices) serve(path string) error {
	os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	os.Chmod(path, 0o666)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go ds.conn(c)
		}
	}()
	log.Printf("devices: listening on %s", path)
	return nil
}

func (ds *devices) conn(c net.Conn) {
	defer c.Close()
	mine := map[int]bool{}
	defer func() {
		for id := range mine { // the plugin is gone: so are its devices
			ds.destroy(id)
		}
	}()
	r := bufio.NewReaderSize(c, 1<<20)
	enc := json.NewEncoder(c)
	for {
		line, err := r.ReadBytes('\n')
		if err != nil {
			return
		}
		var req struct {
			Op    string `json:"op"`
			UID   string `json:"uid"`
			ID    int    `json:"id"`
			State string `json:"state"`
		}
		if json.Unmarshal(line, &req) != nil {
			enc.Encode(map[string]any{"ok": false, "error": "bad request"})
			continue
		}
		switch req.Op {
		case "create":
			d, err := ds.create(req.UID)
			if err != nil {
				enc.Encode(map[string]any{"ok": false, "error": err.Error()})
				continue
			}
			mine[d.id] = true
			enc.Encode(map[string]any{"ok": true, "id": d.id, "shm": d.path})
		case "destroy":
			ds.destroy(req.ID)
			delete(mine, req.ID)
			enc.Encode(map[string]any{"ok": true})
		case "get_state":
			d := ds.get(req.ID)
			if d == nil {
				enc.Encode(map[string]any{"ok": false, "error": "no such device"})
				continue
			}
			p, err := d.s.patch(d.class.Name)
			if err != nil {
				enc.Encode(map[string]any{"ok": false, "error": err.Error()})
				continue
			}
			doc, _ := json.Marshal(map[string]any{"schwung_device": 1, "midi_fx": d.midiFX, "out_ch": d.outCh, "chain": p})
			enc.Encode(map[string]any{"ok": true, "state": string(doc)})
		case "set_state":
			d := ds.get(req.ID)
			if d == nil {
				enc.Encode(map[string]any{"ok": false, "error": "no such device"})
				continue
			}
			var st struct {
				MidiFX int             `json:"midi_fx"`
				OutCh  int             `json:"out_ch"`
				Chain  json.RawMessage `json:"chain"`
			}
			if json.Unmarshal([]byte(req.State), &st) != nil || len(st.Chain) == 0 {
				enc.Encode(map[string]any{"ok": false, "error": "not a Schwung device state"})
				continue
			}
			if err := ds.h.loadPatch(d.s, st.Chain); err != nil {
				enc.Encode(map[string]any{"ok": false, "error": err.Error()})
				continue
			}
			if d.class.Kind == "midi" || d.class.Kind == "midifx" {
				sinkMIDI(d.s) // also repairs a state saved with pre mode
			}
			d.midiFX, d.outCh = st.MidiFX, st.OutCh
			enc.Encode(map[string]any{"ok": true})
		default:
			enc.Encode(map[string]any{"ok": false, "error": "unknown op " + req.Op})
		}
	}
}

func (ds *devices) get(id int) *device {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	return ds.list[id]
}
