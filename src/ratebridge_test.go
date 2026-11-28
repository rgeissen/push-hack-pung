package main

import (
	"math"
	"testing"
)

// freqOf: a steady tone's frequency from its zero crossings, and its peak.
func freqOf(x []float32, rate int) (float64, float64) {
	first, last, n := -1.0, 0.0, 0
	peak := 0.0
	for i := 1; i < len(x); i++ {
		peak = math.Max(peak, math.Abs(float64(x[i])))
		if x[i-1] < 0 && x[i] >= 0 {
			t := float64(i-1) + float64(-x[i-1])/float64(x[i]-x[i-1])
			if first < 0 {
				first = t
			} else {
				n++
			}
			last = t
		}
	}
	if n == 0 {
		return 0, peak
	}
	return float64(n) * float64(rate) / (last - first), peak
}

// A module's 440 Hz stays 440 Hz at every rate a host runs at, at its level,
// whatever the host's block size; and the frames asked of the module add up to
// the rate's share.
func TestRateBridgeKeepsPitchAndLevel(t *testing.T) {
	for _, rate := range []int{48000, 88200, 96000, 32000, 192000} {
		for _, block := range []int{64, 128, 512, 441, 1024} {
			ph := 0.0
			src := func(n int, _ []float32) []float32 {
				out := make([]float32, n*2+2)
				for i := 0; i < n; i++ {
					v := float32(0.5 * math.Sin(ph))
					ph += 2 * math.Pi * 440 / 44100
					out[i*2], out[i*2+1] = v, v
				}
				return out
			}
			blocks := 2 * rate / block
			out, needs := rbRun(rate, block, blocks, false, src, nil)
			if out == nil {
				t.Fatalf("%d Hz: no bridge", rate)
			}
			f, peak := freqOf(out[rate/2:], rate) // (past the start)
			if math.Abs(f-440) > 0.05 {
				t.Errorf("%d Hz in blocks of %d: 440 Hz came out as %.3f Hz", rate, block, f)
			}
			if math.Abs(peak-0.5) > 0.005 {
				t.Errorf("%d Hz in blocks of %d: level 0.5 came out as %.4f", rate, block, peak)
			}
			total := 0
			for _, n := range needs {
				total += n
			}
			want := float64(blocks*block) * 44100 / float64(rate)
			if math.Abs(float64(total)-want) > 40 {
				t.Errorf("%d Hz in blocks of %d: %d module frames asked for, %.0f expected", rate, block, total, want)
			}
		}
	}
}

// What lies above the lower rate's limit does not come back as another tone:
// 21 kHz from a module, taken down to 32 kHz (limit 16 kHz), is all but gone.
func TestRateBridgeHoldsBackWhatTheRateCannotCarry(t *testing.T) {
	ph := 0.0
	src := func(n int, _ []float32) []float32 {
		out := make([]float32, n*2+2)
		for i := 0; i < n; i++ {
			v := float32(0.5 * math.Sin(ph))
			ph += 2 * math.Pi * 21000 / 44100
			out[i*2], out[i*2+1] = v, v
		}
		return out
	}
	out, _ := rbRun(32000, 256, 250, false, src, nil)
	_, peak := freqOf(out[16000:], 32000)
	if peak > 0.5*0.01 { // 40 dB down
		t.Errorf("21 kHz taken down to 32 kHz left a tone at %.4f (of 0.5)", peak)
	}
}

// An effect: the host's input reaches the module and comes back, the same
// tone, the delay the plugin tells the host (rbLatency).
func TestRateBridgeEffectRoundTrip(t *testing.T) {
	for _, rate := range []int{48000, 96000} {
		in := func(i int) float32 { return float32(0.4 * math.Sin(2*math.Pi*1000*float64(i)/float64(rate))) }
		thru := func(n int, x []float32) []float32 {
			out := make([]float32, n*2+2)
			copy(out, x)
			return out
		}
		out, _ := rbRun(rate, 256, rate/256, true, thru, in)
		f, peak := freqOf(out[rate/2:], rate)
		if math.Abs(f-1000) > 0.1 || math.Abs(peak-0.4) > 0.004 {
			t.Errorf("%d Hz: 1 kHz at 0.4 came back as %.2f Hz at %.4f", rate, f, peak)
		}
		// the delay: the output matches the input moved by the latency
		lat := rbLatency(rate, true)
		worst := 0.0
		for i := rate / 2; i < rate/2+2000; i++ {
			worst = math.Max(worst, math.Abs(float64(out[i]-in(i-lat))))
		}
		if worst > 0.4*0.02 {
			t.Errorf("%d Hz: delayed by other than the %d frames told (off by up to %.4f)", rate, lat, worst)
		}
	}
	if rbLatency(44100, true) != 0 || rbLatency(44100, false) != 0 {
		t.Error("a delay at the module's own rate")
	}
}
