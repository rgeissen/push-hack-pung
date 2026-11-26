package main

import (
	"testing"
	"time"
)

func TestGovernorReadsProc(t *testing.T) {
	// a name with spaces and a bracket, as a process may carry
	cpu, ok := parseProcCPU("726 (pung (rt) x) S 1 726 726 0 -1 4194560 100 0 0 0 1234 66 0 0 39 19 19 0 100 1 2")
	if !ok || cpu != 1300*clockTick {
		t.Fatalf("process time: %v %v, want %v", cpu, ok, 1300*clockTick)
	}
	if _, ok := parseProcCPU("726 (pung) S 1 2"); ok {
		t.Fatal("a short line read as a time")
	}
	// user nice system idle iowait irq softirq steal guest guest_nice
	// work at a low priority (nice) is background, not busy: it gives way
	busy, back, total, ok := parseSystemCPU("cpu  100 20 30 800 40 5 5 0 50 0\ncpu0 1 2 3 4\n")
	if !ok || total != 1000*clockTick || busy != 140*clockTick || back != 20*clockTick {
		t.Fatalf("system: busy %v, background %v of %v, %v; want 140, 20 and 1000 ticks", busy, back, total, ok)
	}
	if _, _, _, ok := parseSystemCPU("intr 1 2 3"); ok {
		t.Fatal("no cpu line read as one")
	}
}

func TestGovernorPercent(t *testing.T) {
	for _, c := range []struct {
		d, w time.Duration
		want float64
	}{
		{time.Second, 2 * time.Second, 50},
		{770 * time.Millisecond, time.Second, 77},
		{3 * time.Second, time.Second, 300}, // three cores busy
		{1234 * time.Microsecond, time.Second, 0.1},
		{-time.Second, time.Second, 0}, // a counter that went back: a process replaced
		{time.Second, 0, 0},
	} {
		if got := pct(c.d, c.w); got != c.want {
			t.Errorf("pct(%v, %v) = %v, want %v", c.d, c.w, got, c.want)
		}
	}
}

// What nobody heard: a device that stayed silent, and an emulator none of
// whose devices sounded. A device that sounded keeps its emulator off the
// count.
func TestGovernorCountsWhatWasSilent(t *testing.T) {
	h := &Host{}
	at := time.Unix(100, 0)
	a := govSample{at: at, engines: map[int]time.Duration{7: 0, 8: 0}, engineOf: map[int]string{7: "vavra", 8: "xenia"},
		devices: map[int]govDevice{}}
	b := govSample{at: at.Add(10 * time.Second), sysBusy: 12 * time.Second, sysTotal: 40 * time.Second, pung: time.Second,
		engines: map[int]time.Duration{7: 2 * time.Second, 8: 3 * time.Second}, engineOf: a.engineOf, devices: map[int]govDevice{}}
	rep := h.govReport(a, b, nil)
	if got := rep["silent"]; got != 50.0 { // no device at all: both engines ran for nobody
		t.Errorf("silent: %v, want 50", got)
	}
	if got := rep["pung_total"]; got != 60.0 {
		t.Errorf("pung_total: %v, want 60", got)
	}
	sys := rep["system"].(map[string]any)
	if sys["busy"] != 120.0 || sys["free"] != float64(rep["cores"].(int))*100-120 {
		t.Errorf("system: %v", sys)
	}
}

// The view acts on buttons, encoders and touches only: what else the Push
// sends (Active Sensing, pressure, pitch bend) must not redraw it.
func TestViewIgnoresWhatIsNotAControl(t *testing.T) {
	for _, m := range [][]byte{{0xFE}, {0xA0, 60, 40}, {0xD0, 40}, {0xE0, 0, 64}, {0xF8}, {}} {
		if isControl(m) {
			t.Errorf("% X taken for a control", m)
		}
	}
	for _, m := range [][]byte{{0x90, 3, 127}, {0x80, 3, 0}, {0xB0, 71, 1}, {0x91, 40, 90}} {
		if !isControl(m) {
			t.Errorf("% X not taken for a control", m)
		}
	}
}

// A device's pump looks 500 times a second while anything happens, and 100
// times once nothing has for a second.
func TestPumpSlowsWhenNothingHappens(t *testing.T) {
	if got := pumpWait(0); got != pumpEvery {
		t.Errorf("something just happened: %v, want %v", got, pumpEvery)
	}
	if got := pumpWait(pumpIdleAfter - time.Millisecond); got != pumpEvery {
		t.Errorf("quiet for less than its time: %v, want %v", got, pumpEvery)
	}
	if got := pumpWait(pumpIdleAfter); got != pumpIdleEvery {
		t.Errorf("quiet long enough: %v, want %v", got, pumpIdleEvery)
	}
}
