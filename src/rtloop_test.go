//go:build linux

package main

import (
	"bytes"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// The block layout rtloop.c reads is core's: the same header, byte for byte.
func TestIPCHeaderIsCores(t *testing.T) {
	dir, err := exec.Command("go", "list", "-m", "-f", "{{.Dir}}", "github.com/federico-pepe/ableton-push-hack/core").Output()
	if err != nil {
		t.Skip("no go list here:", err)
	}
	core, err := os.ReadFile(filepath.Join(strings.TrimSpace(string(dir)), "livedevice/vst3/source/livedevice_ipc.h"))
	if err != nil {
		t.Fatal(err)
	}
	mine, err := os.ReadFile("livedevice_ipc.h")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(core, mine) {
		t.Fatal("src/livedevice_ipc.h differs from core's: copy it again (and check rtloop.c against the change)")
	}
}

// Offsets as livedevice_ipc.h has them (version 2), for the fake plugin.
const (
	tReq, tDone, tFrames, tNEv, tNPar = 8, 12, 16, 40, 44
	tEvents                           = 64
	tParams                           = tEvents + 256*8
	tOutL                             = tParams + 256*8 + 2*4096*4
	tONPar                            = tOutL + 2*4096*4 + 64 + 256*8
	tOParams                          = tONPar + 64
	tSize                             = tOParams + 256*8
)

// The device's own thread answers every block, also one it cannot render
// (no chain here: each block is skipped), and keeps what such a block
// brought: its notes for later, Live's parameter changes for Go, Pung's
// reports for Live.
func TestOwnThreadServesBlocks(t *testing.T) {
	mem, err := syscall.Mmap(-1, 0, tSize, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED|syscall.MAP_ANON)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Munmap(mem)
	u32 := func(off int) *uint32 { return (*uint32)(unsafe.Pointer(&mem[off])) }
	f32 := func(off int) *float32 { return (*float32)(unsafe.Pointer(&mem[off])) }

	cls := &livedevice.Class{Kind: livedevice.Instrument, Params: []livedevice.Param{{Name: "Cutoff", Type: "float", Max: 1}}}
	d := &device{c: &sclass{Class: cls, inCh: -1}, s: &Slot{Index: 63, midi: make(chan midiMsg, 16)},
		norms: make([]atomic.Uint64, 1), reports: map[int]float64{0: 0.25}}
	if !d.Loop(unsafe.Pointer(&mem[0]), tSize, livedevice.Version, 70) {
		t.Fatal("Loop declined")
	}
	stopped := false
	defer func() {
		if !stopped {
			d.StopLoop()
		}
	}()

	block := func(params map[int]float32, notes [][]byte) {
		*u32(tFrames) = 128
		*f32(tOutL + 4*5) = 0.7 // left from before: a block starts silent
		n := 0
		for idx, v := range params {
			*u32(tParams + n*8) = uint32(idx)
			*f32(tParams + n*8 + 4) = v
			n++
		}
		*u32(tNPar) = uint32(n)
		for i, m := range notes {
			*u32(tEvents + i*8) = 0
			mem[tEvents+i*8+4] = byte(len(m))
			copy(mem[tEvents+i*8+5:], m)
		}
		*u32(tNEv) = uint32(len(notes))
		req := atomic.AddUint32(u32(tReq), 1)
		syscall.Syscall6(syscall.SYS_FUTEX, uintptr(unsafe.Pointer(u32(tReq))), 1, 1<<30, 0, 0, 0)
		deadline := time.Now().Add(2 * time.Second)
		for atomic.LoadUint32(u32(tDone)) != req {
			if time.Now().After(deadline) {
				t.Fatal("no answer to a block")
			}
			time.Sleep(100 * time.Microsecond)
		}
	}

	// the first block may come the moment Loop returns
	block(map[int]float32{0: 0.5}, [][]byte{{0x90, 60, 100}})
	if got := *f32(tOutL + 4*5); got != 0 {
		t.Fatalf("a skipped block is not silent: %v", got)
	}
	deadline := time.Now().Add(time.Second)
	for math.Float64frombits(d.norms[0].Load()) != 0.5 {
		if time.Now().After(deadline) {
			t.Fatal("Live's parameter change never reached Go")
		}
		time.Sleep(time.Millisecond)
	}
	// the report is queued by the pump; a later block carries it to Live
	reported := false
	for i := 0; i < 200 && !reported; i++ {
		time.Sleep(time.Millisecond)
		block(nil, nil)
		if *u32(tONPar) == 1 {
			reported = *u32(tOParams) == 0 && *f32(tOParams + 4) == 0.25
		}
	}
	if !reported {
		t.Fatal("Pung's report never reached Live")
	}
	st, ok := d.loopStats()
	if !ok || st.blocks < 2 || st.skipped != st.blocks || st.notes_in != 1 {
		t.Fatalf("stats %+v", st)
	}
	d.StopLoop()
	stopped = true
	if _, ok := d.loopStats(); ok {
		t.Fatal("still looping after StopLoop")
	}
}
