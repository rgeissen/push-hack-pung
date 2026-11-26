package main

/*
#include "rtloop.h"
#include "livedevice_ipc.h"
*/
import "C"

import (
	"math"
	"os"
	"time"
	"unsafe"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// rtloop.go: a device's blocks on a C thread of its own (rtloop.h says why),
// and what Go does for them a moment later: the pump.
//
// PUNG_GO_LOOP=1 in the environment serves the blocks from Go again
// (Process), as before 2026-11-21.

// pumpEvery: how often Go takes what the blocks left it. Live's parameter
// changes reach the module this much later than its notes.
const pumpEvery = 2 * time.Millisecond

// pumpIdleEvery: how often it looks while nothing happens (pumpIdle): no
// parameter from Live, no note, no sound, the transport stopped, for
// pumpIdleAfter. A device in a Set that is not playing woke its pump 500
// times a second for nothing, about a hundredth of a core each (measured
// 2026-11-25). The first thing after such a pause is taken up to this much
// later, once; then the pump is at pumpEvery again.
const (
	pumpIdleEvery = 10 * time.Millisecond
	pumpIdleAfter = time.Second
)

// pumpWait: how long the pump waits now: quietFor is how long nothing has
// happened.
func pumpWait(quietFor time.Duration) time.Duration {
	if quietFor >= pumpIdleAfter {
		return pumpIdleEvery
	}
	return pumpEvery
}

// previewAhead: frames of a file preview queued for the realtime thread.
// A stop is heard within a block; the rest of the queue is dropped.
const previewAhead = 2048

type rtState struct {
	rt   *C.rtloop
	stop chan struct{}
	done chan struct{}
}

// Loop is livedevice.Looper: the device's blocks are served by rtloop.c.
func (d *device) Loop(mem unsafe.Pointer, size int, version uint32, priority int) bool {
	if os.Getenv("PUNG_GO_LOOP") != "" || version != C.LD_IPC_VERSION || size < C.LD_IPC_SIZE {
		return false
	}
	kind := C.RT_INSTRUMENT
	switch d.c.Kind {
	case livedevice.Effect:
		kind = C.RT_EFFECT
	case livedevice.MIDI:
		kind = C.RT_MIDI
	}
	rt := C.rt_new(C.int(d.s.Index), C.int(kind), C.int(d.c.inCh))
	if rt == nil {
		return false
	}
	d.syncLoop(rt)
	if C.rt_start(rt, mem, C.int(size), C.uint(version), C.int(priority)) != 0 {
		C.rt_free(rt)
		return false
	}
	l := &rtState{rt: rt, stop: make(chan struct{}), done: make(chan struct{})}
	d.loopMu.Lock()
	d.loop = l
	d.loopMu.Unlock()
	go d.pump(l)
	return true
}

// StopLoop is livedevice.Looper: the thread first, then the pump.
func (d *device) StopLoop() {
	d.loopMu.Lock()
	l := d.loop
	d.loop = nil
	d.loopMu.Unlock()
	if l == nil {
		return
	}
	C.rt_stop(l.rt)
	close(l.stop)
	<-l.done
	C.rt_free(l.rt)
}

// loopStats: the realtime thread's counts, when it serves the device.
func (d *device) loopStats() (C.rt_stats_t, bool) {
	var st C.rt_stats_t
	d.loopMu.RLock()
	defer d.loopMu.RUnlock()
	if d.loop == nil {
		return st, false
	}
	C.rt_stats(d.loop.rt, &st)
	return st, true
}

// loopUsage: what the realtime thread has cost since it started.
func (d *device) loopUsage() (cpu, render time.Duration, blocks uint64, peak float32, ok bool) {
	var u C.rt_usage_t
	d.loopMu.RLock()
	defer d.loopMu.RUnlock()
	if d.loop == nil {
		return 0, 0, 0, 0, false
	}
	C.rt_usage(d.loop.rt, &u)
	return time.Duration(u.cpu_ns), time.Duration(u.render_ns), uint64(u.blocks), float32(u.out_peak), true
}

// setHostRest: the silence after which the device's module is not asked for
// sound (0: always), for a module Pung rests from outside (govrest.go).
func (d *device) setHostRest(ms int64) {
	d.loopMu.RLock()
	defer d.loopMu.RUnlock()
	if d.loop != nil {
		C.rt_set_rest(d.loop.rt, C.int(ms*44100/1000))
	}
}

// hostResting: the device's module is not being rendered now, and how often
// it has rested.
func (d *device) hostResting() (bool, uint32) {
	d.loopMu.RLock()
	defer d.loopMu.RUnlock()
	if d.loop == nil {
		return false, 0
	}
	var n C.uint32_t
	on := C.rt_resting(d.loop.rt, &n) != 0
	return on, uint32(n)
}

// hostRestSim runs the host-rest rule over blocks of 128 frames (a test):
// each block's peak and whether something was sent with it; it answers
// which blocks were rendered and how many rests began.
func hostRestSim(restAfter int, peaks []float32, busy []bool) (rendered []bool, rests int) {
	var r C.rt_rest_t
	for i, pk := range peaks {
		b := C.int(0)
		if busy[i] {
			b = 1
		}
		if C.rt_rest_before(&r, b, 128) != 0 {
			rendered = append(rendered, true)
			rests += int(C.rt_rest_after(&r, b, C.float(pk), 128, C.int(restAfter)))
		} else {
			rendered = append(rendered, false)
		}
	}
	return rendered, rests
}

// touchSlot: Go changed a slot's module (a parameter, a sound): a module
// Pung rests wakes for it.
func touchSlot(i int) { C.rt_touch_slot(C.int(i)) }

// syncLoop gives the realtime thread what Go decides for it.
func (d *device) syncLoop(rt *C.rtloop) {
	C.rt_set_out_ch(rt, C.int(d.outCh))
	fx := 0
	if d.midiFX != 0 {
		fx = 1
	}
	C.rt_set_midifx(rt, C.int(fx))
}

func (d *device) pump(l *rtState) {
	defer close(l.done)
	t := time.NewTimer(pumpEvery)
	defer t.Stop()
	lastBusy := time.Now() // the last time anything happened (pumpWait)
	var (
		idx      [C.LD_IPC_MAXPAR * 4]C.uint32_t
		norm     [C.LD_IPC_MAXPAR * 4]C.float
		ui       [1024 * 4]C.uint8_t
		aud      = make([]float32, 16384*2)
		prev     = make([]float32, previewAhead*2)
		transSeq C.uint32_t
	)
	for {
		busy := false
		rt := l.rt
		select {
		case <-l.stop:
			return
		case <-t.C:
		case m := <-d.s.midi: // a note from the web page or a test: at once, not at the next look
			busy = true
			C.rt_put_midi(rt, (*C.uint8_t)(unsafe.Pointer(&m.b[0])), C.int(m.n))
			if !t.Stop() {
				select {
				case <-t.C:
				default:
				}
			}
		}

		// Live's parameter changes, as Process applied them
		if n := int(C.rt_take_params(rt, &idx[0], &norm[0], C.int(len(idx)))); n > 0 {
			restore := lockBoost()
			d.s.own.Lock()
			for i := 0; i < n; i++ {
				k := int(idx[i])
				if k < 0 || k >= len(d.c.Params) || d.c.Params[k].Type == livedevice.PadType {
					continue
				}
				d.applyParam(k, math.Max(0, math.Min(1, float64(norm[i]))))
			}
			d.s.own.Unlock()
			restore()
			touchSlot(d.s.Index)
			d.touch() // its state is filed again once quiet (keptstate.go)
			busy = true
		}
		d.syncLoop(rt)

		// notes from the web page and tests
	notes:
		for {
			select {
			case m := <-d.s.midi:
				busy = true
				if C.rt_put_midi(rt, (*C.uint8_t)(unsafe.Pointer(&m.b[0])), C.int(m.n)) == 0 {
					break notes
				}
			default:
				break notes
			}
		}

		// what Live played, for the screens and Stats
		if n := int(C.rt_take_ui_midi(rt, &ui[0], C.int(len(ui)/4))); n > 0 {
			busy = true
			b := unsafe.Slice((*byte)(unsafe.Pointer(&ui[0])), n*4)
			for i := 0; i < n; i++ {
				ln := int(b[i*4])
				if ln < 1 || ln > 3 {
					continue
				}
				msg := b[i*4+1 : i*4+1+ln]
				d.s.live.trackMidi(msg)
				if pm := d.s.pm.Load(); pm != nil {
					pm.midi(msg) // the wheel and pressure, Pung's sources (pungmod.go)
				}
				k := d.recentN.Add(1) - 1
				var e [4]byte
				e[3] = byte(copy(e[:3], msg))
				d.recentMidi[k%16] = e
			}
		}
		for {
			n := int(C.rt_take_audio(rt, (*C.float)(unsafe.Pointer(&aud[0])), C.int(len(aud)/2)))
			if n <= 0 {
				break
			}
			o := aud[:n*2]
			d.s.live.feedAudio(o)
			if cb := d.capBuf.Load(); cb != nil {
				buf := *cb
				pos := int(d.capPos.Load() * 2 % uint64(len(buf)))
				for i := range o {
					buf[pos] = o[i]
					if pos++; pos == len(buf) {
						pos = 0
					}
				}
				d.capPos.Add(uint64(n))
			}
		}
		peak := float32(C.rt_take_meter(rt))
		d.s.setPeak(peak)
		var bpm, beat C.double
		var playing C.int
		if seq := C.rt_transport(rt, &bpm, &beat, &playing); seq != transSeq {
			transSeq = seq
			noteTransport(float64(bpm), float64(beat), playing != 0)
		}
		if playing != 0 || peakDB(peak) >= liveSilentDB || d.preview.Load() != nil || d.capBuf.Load() != nil {
			busy = true
		}

		// changes made here, told to Live
		if d.repMu.TryLock() {
			for k, v := range d.reports {
				busy = true
				if C.rt_put_report(rt, C.uint32_t(k), C.float(v)) == 0 {
					break
				}
				delete(d.reports, k)
			}
			d.repMu.Unlock()
		}

		d.pumpPreview(rt, prev)

		now := time.Now()
		if busy {
			lastBusy = now
		}
		t.Reset(pumpWait(now.Sub(lastBusy)))
	}
}

// pumpPreview keeps the realtime thread's preview queue filled, with
// mixPreview's fades at both ends of the file.
func (d *device) pumpPreview(rt *C.rtloop, buf []float32) {
	v := d.preview.Load()
	if v == nil || C.rt_preview_stopping(rt) != 0 {
		return
	}
	if v.stop.Load() {
		C.rt_preview_stop(rt)
		d.preview.CompareAndSwap(v, nil)
		return
	}
	const fade = 96
	total := len(v.pcm) / 2
	n := min(previewAhead-int(C.rt_preview_level(rt)), total-v.pos, len(buf)/2)
	if n <= 0 {
		if v.pos >= total {
			d.preview.CompareAndSwap(v, nil)
		}
		return
	}
	for i := 0; i < n; i++ {
		p := v.pos + i
		g := float32(1)
		if p < fade {
			g = float32(p) / fade
		}
		if left := total - p; left < fade {
			g *= float32(left) / fade
		}
		buf[2*i] = v.pcm[2*p] * g
		buf[2*i+1] = v.pcm[2*p+1] * g
	}
	v.pos += int(C.rt_put_preview(rt, (*C.float)(unsafe.Pointer(&buf[0])), C.int(n)))
}
