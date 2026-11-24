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
	t := time.NewTicker(pumpEvery)
	defer t.Stop()
	var (
		idx      [C.LD_IPC_MAXPAR * 4]C.uint32_t
		norm     [C.LD_IPC_MAXPAR * 4]C.float
		ui       [1024 * 4]C.uint8_t
		aud      = make([]float32, 16384*2)
		prev     = make([]float32, previewAhead*2)
		transSeq C.uint32_t
	)
	for {
		select {
		case <-l.stop:
			return
		case <-t.C:
		}
		rt := l.rt

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
			d.touch() // its state is filed again once quiet (keptstate.go)
		}
		d.syncLoop(rt)

		// notes from the web page and tests
	notes:
		for {
			select {
			case m := <-d.s.midi:
				if C.rt_put_midi(rt, (*C.uint8_t)(unsafe.Pointer(&m.b[0])), C.int(m.n)) == 0 {
					break notes
				}
			default:
				break notes
			}
		}

		// what Live played, for the screens and Stats
		if n := int(C.rt_take_ui_midi(rt, &ui[0], C.int(len(ui)/4))); n > 0 {
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
		d.s.setPeak(float32(C.rt_take_meter(rt)))
		var bpm, beat C.double
		var playing C.int
		if seq := C.rt_transport(rt, &bpm, &beat, &playing); seq != transSeq {
			transSeq = seq
			noteTransport(float64(bpm), float64(beat), playing != 0)
		}

		// changes made here, told to Live
		if d.repMu.TryLock() {
			for k, v := range d.reports {
				if C.rt_put_report(rt, C.uint32_t(k), C.float(v)) == 0 {
					break
				}
				delete(d.reports, k)
			}
			d.repMu.Unlock()
		}

		d.pumpPreview(rt, prev)
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
