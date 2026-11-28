package main

// ratebridge.go: ratebridge.c for the tests (a test file cannot call C).

/*
#include "ratebridge.h"
#include <stdlib.h>
*/
import "C"

import "unsafe"

// rbRun plays `source` (what a module renders at 44100 Hz, called for as many
// frames as the bridge asks) through a bridge to hostRate in blocks of
// `block` frames, `blocks` times, and returns the host's left channel. With
// effect, `input` (the host's input, by frame index) goes through the input
// side first and source gets it.
func rbRun(hostRate, block, blocks int, effect bool, source func(n int, in []float32) []float32, input func(i int) float32) ([]float32, []int) {
	rb := C.rb_new(C.int(hostRate), C.int(b2i(effect)))
	if rb == nil {
		return nil, nil
	}
	defer C.rb_free(rb)
	var out []float32
	var needs []int
	host := make([]float32, block*2)
	hin := make([]float32, block*2)
	modIn := make([]float32, C.RB_MAX_MOD*2)
	at := 0
	for b := 0; b < blocks; b++ {
		need := int(C.rb_need(rb, C.int(block)))
		needs = append(needs, need)
		var in []float32
		if effect {
			for i := 0; i < block; i++ {
				v := input(at + i)
				hin[i*2], hin[i*2+1] = v, v
			}
			C.rb_in(rb, (*C.float)(unsafe.Pointer(&hin[0])), C.int(block), (*C.float)(unsafe.Pointer(&modIn[0])), C.int(need))
			in = modIn[:need*2]
		}
		mod := source(need, in)
		var mp *C.float
		if need > 0 {
			mp = (*C.float)(unsafe.Pointer(&mod[0]))
		}
		C.rb_out(rb, mp, C.int(need), (*C.float)(unsafe.Pointer(&host[0])), C.int(block))
		for i := 0; i < block; i++ {
			out = append(out, host[i*2])
		}
		at += block
	}
	return out, needs
}

func rbLatency(hostRate int, effect bool) int {
	return int(C.rb_latency(C.int(hostRate), C.int(b2i(effect))))
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
