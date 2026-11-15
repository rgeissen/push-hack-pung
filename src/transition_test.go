package main

// transition_test.go: moving between Live's devices never mixes two of them
// (the selection's path, values and parameter indexes go with it), and a
// device's page comes back when it does.

import (
	"encoding/json"
	"net"
	"testing"
	"time"
)

func devEvent(track, device int, name string) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"track": track, "device": device, "name": name,
		"params": []map[string]any{{"i": 0, "name": "Macro 1", "v": 0, "min": 0, "max": 127}}})
	return b
}

// settle: setDevice starts a lookup in Live, which has no Live here and
// fails at once; let it finish before the test sets the state by hand
func settle() { time.Sleep(100 * time.Millisecond) }

func TestSelectionForgetsTheLastDevice(t *testing.T) {
	s := &liveState{}
	s.setDevice(devEvent(1, 0, "JE-8086"))
	settle()
	// as resolve and readParams leave it
	s.mu.Lock()
	s.path, s.devs, s.resolved, s.paramsKey = []int{0, 0, 0}, []liveDevSummary{{I: 0, Name: "JE-8086"}}, s.selID(), s.selID()
	s.wrote = map[int]time.Time{3: time.Now()}
	s.mu.Unlock()
	if v := s.view(); !v.ready || !v.resolved {
		t.Fatalf("a resolved, read device is not ready: %+v", v)
	}
	before := s.view().key

	s.setDevice(devEvent(0, 0, "Osirus"))
	v := s.view()
	if v.ready {
		t.Fatal("the new selection is ready before it was resolved and read")
	}
	if v.path != nil || v.devs != nil {
		t.Fatalf("the last device's path %v or devices %v carried over: a knob would write to it", v.path, v.devs)
	}
	if v.key == before {
		t.Fatal("the key did not change with the selection")
	}
	s.mu.Lock()
	wrote := s.wrote
	s.mu.Unlock()
	if wrote != nil {
		t.Fatal("pending writes of the last device carried over")
	}

	// the same selection again (a parameter changed): nothing is forgotten
	settle()
	s.mu.Lock()
	s.path, s.resolved, s.paramsKey = []int{0, 0, 0}, s.selID(), s.selID()
	s.mu.Unlock()
	s.setDevice(devEvent(0, 0, "Osirus"))
	if v := s.view(); !v.ready || v.path == nil {
		t.Fatal("a parameter event reset the selection")
	}

	// nothing selected: resolved at once, never ready, nothing to draw
	s.setDevice(devEvent(2, -1, ""))
	if v := s.view(); !v.resolved || v.ready || v.path != nil {
		t.Fatalf("an empty selection: %+v", v)
	}
}

func TestDevicesKeepTheirPage(t *testing.T) {
	u := &surface{}
	je := liveView{key: "1/0/JE-8086|[0 0 0]"}
	osi := liveView{key: "0/0/Osirus|[0 0 0]"}
	u.enterSelection(je)
	u.liveReady, u.bank, u.bankOff = true, 11, 8
	u.vals = map[string]string{"x": "1"}
	u.enterSelection(osi)
	if u.bank != 0 || u.bankOff != 0 {
		t.Fatalf("Osirus opened on JE-8086's page %d", u.bank)
	}
	if len(u.vals) != 0 {
		t.Fatal("JE-8086's values are still there under Osirus")
	}
	u.liveReady, u.bank = true, 2
	u.enterSelection(je)
	if u.bank != 11 || u.bankOff != 8 {
		t.Fatalf("JE-8086 came back on page %d, not 11", u.bank)
	}
	// a selection seen only halfway (never ready) leaves no page behind
	u.liveReady = false
	u.enterSelection(osi)
	if u.bank != 2 {
		t.Fatalf("Osirus came back on page %d, not 2", u.bank)
	}
}

func TestHoldFrame(t *testing.T) {
	u := &surface{live: &live{}, view: "chain"}
	u.live.connected.Store(true)
	u.liveSince = time.Now()
	// being found or read: held, for a while
	if !u.holdFrame() {
		t.Fatal("a device being resolved was drawn")
	}
	u.liveResolved, u.livePung = true, true
	if !u.holdFrame() {
		t.Fatal("a device being read was drawn")
	}
	u.liveSince = time.Now().Add(-holdForDevice)
	if u.holdFrame() {
		t.Fatal("the hold never ends")
	}
	// not a Pung device: held while standing in (Push takes the screen back), drawn when opened by hand
	u.livePung, u.liveSince = false, time.Now()
	if u.holdFrame() {
		t.Fatal("opened by hand, a Live device is not said to be one")
	}
	u.standIn.Store(true)
	if !u.holdFrame() {
		t.Fatal("standing in, a frame was drawn for a device Push shows")
	}
	u.liveReady = true
	if u.holdFrame() {
		t.Fatal("a ready device is held")
	}
}

// Coming back to a device seen before draws it at once, from what it was
// left as; nothing is written to it until a lookup in Live confirms it.
func TestKnownDeviceDrawsAtOnce(t *testing.T) {
	// a Live that takes a call and never answers: lookups stay pending
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			defer c.Close()
		}
	}()
	old := liveAddr
	liveAddr = ln.Addr().String()
	defer func() { liveAddr = old }()

	s := &liveState{}
	s.setDevice(devEvent(1, 0, "JE-8086"))
	s.mu.Lock() // as resolve and readParams leave it, nested in its rack
	s.path, s.resolved, s.paramsKey = []int{0, 0, 0}, s.selID(), s.selID()
	s.dev.Params = []liveParam{{I: 5, Name: "Cutoff", V: 34, Max: 127}}
	s.mu.Unlock()
	s.setDevice(devEvent(0, 0, "Osirus"))
	if v := s.view(); v.ready {
		t.Fatal("a device never seen is ready at once")
	}
	s.setDevice(devEvent(1, 0, "JE-8086"))
	v := s.view()
	if !v.ready || v.writable {
		t.Fatalf("back on JE-8086: ready %v (want true), writable %v (want false)", v.ready, v.writable)
	}
	if len(v.dev.Params) != 1 || v.dev.Params[0].V != 34 {
		t.Fatalf("its values were not the ones it was left with: %+v", v.dev.Params)
	}
}
