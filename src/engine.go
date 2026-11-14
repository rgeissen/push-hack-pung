package main

// engine.go: the realtime side. One goroutine, locked to one OS thread at
// SCHED_FIFO, renders every slot's chain and hands the audio to the bus.
//
// Each slot has an owner lock that control calls hold for one call into the
// chain. Ordinary reads and writes take microseconds, so the render loop
// waits them out (spinning, it never sleeps on the lock). A call that may
// take long -- a module load is a dlopen inside set_param -- raises the
// slot's "loading" flag first: the loop then skips that slot (silence for
// it) instead of waiting, and every other slot keeps playing. Skipping on
// ANY held lock was the first design; with the screen reading values it
// turned every read into a dropped period.

/*
#cgo CFLAGS: -O2 -std=gnu11 -I${SRCDIR}
#cgo LDFLAGS: -ldl -lm -lpthread
#include <stdlib.h>
#include "bridge.h"
*/
import "C"

import (
	"errors"
	"log"
	"math"
	"runtime"
	"sync/atomic"
	"time"
	"unsafe"
)

const (
	maxSlots    = C.SB_MAX_SLOTS
	moduleRate  = 44100 // Schwung modules render at MOVE_SAMPLE_RATE
	defaultPer  = 256
	rtPriority  = 60
	getBufFirst = 4 << 10 // a value; metadata grows into the next size
	getBufMax   = 4 << 20
)

func engineInit(chainDir string) error {
	cs := C.CString(chainDir)
	defer C.free(unsafe.Pointer(cs))
	if C.sb_init(cs) != 0 {
		return errors.New(C.GoString(C.sb_error()))
	}
	return nil
}

func cSlotCreate(i int) error {
	if C.sb_slot_create(C.int(i)) != 0 {
		return errors.New(C.GoString(C.sb_error()))
	}
	return nil
}

func cSlotDestroy(i int) { C.sb_slot_destroy(C.int(i)) }

func cWarm(i, blocks int) { C.sb_warm(C.int(i), C.int(blocks)) }

func cSetRealtime(prio int) int { return int(C.sb_set_realtime(C.int(prio))) }

func cSet(i int, key, val string) {
	k, v := C.CString(key), C.CString(val)
	C.sb_set_param(C.int(i), k, v)
	C.free(unsafe.Pointer(k))
	C.free(unsafe.Pointer(v))
}

// cGet returns the value and whether the chain produced one. Large values
// (a module's chain_params, ui_hierarchy, an opaque state blob) get a
// bigger buffer when the first one fills up.
func cGet(i int, key string) (string, bool) {
	k := C.CString(key)
	defer C.free(unsafe.Pointer(k))
	for size := getBufFirst; size <= getBufMax; size *= 16 {
		buf := C.malloc(C.size_t(size))
		n := int(C.sb_get_param(C.int(i), k, (*C.char)(buf), C.int(size)))
		if n < 0 {
			C.free(buf)
			return "", false
		}
		if n < size-1 {
			s := C.GoStringN((*C.char)(buf), C.int(n))
			C.free(buf)
			return s, true
		}
		C.free(buf)
	}
	return "", false
}

func cMidi(i int, msg []byte, source int) {
	if len(msg) == 0 {
		return
	}
	C.sb_midi(C.int(i), (*C.uint8_t)(unsafe.Pointer(&msg[0])), C.int(len(msg)), C.int(source))
}

func cRender(i int, out, in []float32) float32 {
	var inp *C.float
	if in != nil {
		inp = (*C.float)(unsafe.Pointer(&in[0]))
	}
	return float32(C.sb_render(C.int(i), (*C.float)(unsafe.Pointer(&out[0])), inp, C.int(len(out)/2)))
}

func cTakeMidiOut(i int, buf []byte) int {
	return int(C.sb_take_midi_out(C.int(i), (*C.uint8_t)(unsafe.Pointer(&buf[0])), C.int(len(buf))))
}

func setTempo(bpm float64)              { C.sb_set_tempo(C.float(bpm)) }
func setClock(status int, beat float64) { C.sb_set_clock(C.int(status), C.double(beat)) }

// runEngine is the render loop. It returns when stop closes.
func runEngine(h *Host, stop <-chan struct{}) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if rc := C.sb_set_realtime(rtPriority); rc != 0 {
		log.Printf("engine: SCHED_FIFO unavailable (rc=%d), running SCHED_OTHER", rc)
	}

	var out, in []float32
	midiBuf := make([]byte, 256)
	lastRate := 0
	for {
		select {
		case <-stop:
			return
		default:
		}
		period, rate := h.format()
		if rate != lastRate {
			if rate != moduleRate {
				log.Printf("engine: the bus runs at %d Hz, modules render at %d Hz: pitch and tempo will be off by %.1f%%",
					rate, moduleRate, 100*(float64(rate)/moduleRate-1))
			}
			lastRate = rate
		}
		if len(out) != period*2 {
			out = make([]float32, period*2)
			in = make([]float32, period*2)
		}

		wrote := false
		var work time.Duration // render time only: bus.Write's wait is pacing, not work
		for _, s := range h.activeSlots() {
			peak := float32(0)
			start := time.Now()
			if s.acquire() {
				s.drainMidi()
				input := s.readInput(in)
				peak = cRender(s.Index, out, input)
				// MIDI a module sent goes out on the slot's port
				for {
					n := cTakeMidiOut(s.Index, midiBuf)
					if n <= 0 {
						break
					}
					s.sendOut(midiBuf[:n])
				}
				s.own.Unlock()
			} else {
				clear(out)
				s.busySkips.Add(1)
			}
			s.setPeak(peak)
			work += time.Since(start)
			if s.bus != nil && s.bus.Connected() {
				s.bus.Write(out) // paces the loop: waits while the ring is full
				wrote = true
			}
		}
		h.stats.observe(work, period, rate)
		if !wrote {
			// no mixer takes audio: keep time ourselves so MIDI and the
			// transport still move, and come back when it appears
			time.Sleep(time.Duration(float64(period) / float64(rate) * float64(time.Second)))
		}
	}
}

// renderStats is what the CPU line on the status page shows. The engine
// writes it, the web API reads it: atomics only.
type renderStats struct {
	periods  atomic.Int64
	worstUS  atomic.Int64
	sumUS    atomic.Int64
	overruns atomic.Int64
	budgetUS atomic.Int64
}

func (r *renderStats) observe(d time.Duration, period, rate int) {
	us := d.Microseconds()
	budget := int64(float64(period) / float64(rate) * 1e6)
	r.budgetUS.Store(budget)
	r.periods.Add(1)
	r.sumUS.Add(us)
	if us > r.worstUS.Load() {
		r.worstUS.Store(us)
	}
	if us > budget {
		r.overruns.Add(1)
	}
}

func peakDB(p float32) float64 {
	if p <= 0 {
		return -120
	}
	return 20 * math.Log10(float64(p))
}
