package main

import (
	"fmt"
	"testing"
)

func guardRun(t *testing.T, in [][]byte) (out []string, sounding int) {
	t.Helper()
	var g keyGuard
	// a synth that counts note-ons per key, as JE-8086 does
	count := map[[2]byte]int{}
	for _, m := range in {
		g.feed(m, func(m []byte) {
			out = append(out, fmt.Sprintf("% x", m))
			if len(m) < 3 {
				return
			}
			k := [2]byte{m[0] & 0x0F, m[1]}
			switch {
			case m[0]&0xF0 == 0x90 && m[2] > 0:
				count[k]++
			case m[0]&0xF0 == 0x80 || m[0]&0xF0 == 0x90:
				if count[k] > 0 {
					count[k]--
				}
			}
		})
	}
	for _, n := range count {
		sounding += n
	}
	return
}

func TestKeyGuardReleasesADoubledKey(t *testing.T) {
	cases := map[string][][]byte{
		"two ons, one off":        {{0x90, 60, 100}, {0x90, 60, 90}, {0x80, 60, 0}},
		"two ons, two offs":       {{0x90, 60, 100}, {0x90, 60, 90}, {0x80, 60, 0}, {0x80, 60, 0}},
		"velocity 0 as the off":   {{0x90, 60, 100}, {0x90, 60, 90}, {0x90, 60, 0}},
		"three ons, one off":      {{0x90, 60, 1}, {0x90, 60, 2}, {0x90, 60, 3}, {0x80, 60, 0}},
		"other channel untouched": {{0x90, 60, 100}, {0x91, 60, 100}, {0x80, 60, 0}, {0x81, 60, 0}},
		"an off with no on":       {{0x80, 60, 0}, {0x90, 60, 100}, {0x80, 60, 0}},
	}
	for name, in := range cases {
		if _, n := guardRun(t, in); n != 0 {
			t.Errorf("%s: %d voices still sounding after every key was let go", name, n)
		}
	}
}

func TestKeyGuardLeavesOrdinaryPlayingAlone(t *testing.T) {
	in := [][]byte{{0x90, 60, 100}, {0x90, 64, 100}, {0xB0, 1, 50}, {0xE0, 0, 64}, {0x80, 60, 0}, {0x80, 64, 0}, {0xC0, 5}, {0xF8}}
	out, _ := guardRun(t, in)
	if len(out) != len(in) {
		t.Fatalf("ordinary playing was changed: %d messages in, %d out: %v", len(in), len(out), out)
	}
	for i, m := range in {
		if out[i] != fmt.Sprintf("% x", m) {
			t.Errorf("message %d changed: % x became %s", i, m, out[i])
		}
	}
}

func TestKeyGuardForgetsOnAllNotesOff(t *testing.T) {
	out, _ := guardRun(t, [][]byte{{0x90, 60, 100}, {0xB0, 123, 0}, {0x90, 60, 100}})
	if len(out) != 3 {
		t.Errorf("after All Notes Off the key is up, so no note-off is owed: %v", out)
	}
}
