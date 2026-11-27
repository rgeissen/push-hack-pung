package main

import (
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// a device's state as Live saves it: an instrument with a MIDI effect in front
const stackTestState = `{"pung_device":1,"midi_fx":2,"out_ch":3,
 "chain":{"custom_name":"Mini-JV","input":"both","audio_fx":[],
  "synth":{"module":"minijv","config":{"state":{"preset":5,"cutoff":20}},"bypassed":0},
  "midi_fx":[{"type":"superarp","params":{"state":"rate=4;gate=80"},"bypassed":1}],
  "knob_mappings":[{"knob":1,"target":"synth:cutoff"}]},
 "pung_mod":{"lfo_a":{"rate":0.3},"routes":[{"key":"synth:cutoff","src":"lfo_a","amount":0.4}]},
 "sound":{"source":"user","index":0,"name":"Glass arp"},"sound_hash":"abc"}`

func stackClassFor(t *testing.T) *sclass {
	t.Helper()
	sc := testSClass("0123456789abcdef0123456789abcdef", "synth:cutoff", "synth:reso")
	sc.Name, sc.module, sc.Kind, sc.Folder = "Mini-JV", "minijv", livedevice.Instrument, "Pung"
	sc.midiFX = []string{"", "chords", "superarp"}
	return sc
}

// A device's state becomes a stack that names its modules in the order they
// play, each with its own state, and Pung's modulation; and the stack becomes
// the same device state again on a device whose MIDI effects are listed in
// another order.
func TestStackRoundTrip(t *testing.T) {
	st, err := stackFromState(stackTestState)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Modules) != 2 || st.Modules[0].Role != "midi_fx" || st.Modules[0].ID != "superarp" ||
		st.Modules[1].Role != "synth" || st.Modules[1].ID != "minijv" {
		t.Fatalf("modules: %+v", st.Modules)
	}
	if string(st.Modules[1].State) != `{"preset":5,"cutoff":20}` || string(st.Modules[0].State) != `"rate=4;gate=80"` {
		t.Errorf("states: %s / %s", st.Modules[1].State, st.Modules[0].State)
	}
	if st.Sound != "Glass arp" || st.OutCh != 3 || !strings.Contains(string(st.Mod), "lfo_a") || st.Chain["knob_mappings"] == nil {
		t.Errorf("what is laid over the modules: %+v", st)
	}
	st.Name = "Glass arp"
	if err := st.valid(); err != nil {
		t.Fatal(err)
	}
	// through a file, as it travels
	raw, _ := json.Marshal(st)
	var back stackDoc
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	sc := stackClassFor(t)
	sc.midiFX = []string{"", "superarp", "chords"} // another device: the same effects, another order
	state, err := stackState(sc, &back)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		MidiFX  int             `json:"midi_fx"`
		OutCh   int             `json:"out_ch"`
		Chain   json.RawMessage `json:"chain"`
		Sound   soundRef        `json:"sound"`
		PungMod json.RawMessage `json:"pung_mod"`
	}
	if err := json.Unmarshal([]byte(state), &got); err != nil {
		t.Fatal(err)
	}
	if got.MidiFX != 1 || got.OutCh != 3 {
		t.Errorf("midi_fx %d (superarp is this class's 1), out_ch %d", got.MidiFX, got.OutCh)
	}
	if got.Sound.Source != stackSoundKind || got.Sound.Name != "Glass arp" {
		t.Errorf("the device should name the stack: %+v", got.Sound)
	}
	if patchModule(got.Chain, livedevice.Instrument) != "minijv" {
		t.Errorf("the chain's instrument: %s", got.Chain)
	}
	again, err := stackFromState(state)
	if err != nil {
		t.Fatal(err)
	}
	for i, m := range st.Modules {
		a := again.Modules[i]
		if a.Role != m.Role || a.ID != m.ID || !jsonSame(a.State, m.State) || !jsonSame(a.Bypassed, m.Bypassed) {
			t.Errorf("module %d came back as %+v, was %+v", i, a, m)
		}
	}
	if !jsonSame(again.Mod, st.Mod) || again.Chain["knob_mappings"] == nil {
		t.Errorf("modulation or knob mappings lost: %s", state)
	}
}

func jsonSame(a, b json.RawMessage) bool {
	var x, y any
	json.Unmarshal(a, &x) //nolint:errcheck
	json.Unmarshal(b, &y) //nolint:errcheck
	p, _ := json.Marshal(x)
	q, _ := json.Marshal(y)
	return string(p) == string(q)
}

// What one Pung device cannot hold on a Push is refused in words, never
// loaded half.
func TestStackShape(t *testing.T) {
	sc := stackClassFor(t)
	mk := func(mods ...stackModule) *stackDoc { return &stackDoc{Format: stackFormat, Name: "x", Modules: mods} }
	syn := stackModule{Role: "synth", ID: "minijv"}
	var shape errStackShape
	if _, err := stackState(sc, mk(syn, stackModule{Role: "audio_fx", ID: "cloudseed"})); !errors.As(err, &shape) {
		t.Errorf("an effect behind an instrument: %v", err)
	}
	if _, err := stackState(sc, mk(stackModule{Role: "midi_fx", ID: "chords"}, stackModule{Role: "midi_fx", ID: "superarp"}, syn)); !errors.As(err, &shape) {
		t.Errorf("two MIDI effects: %v", err)
	}
	if _, err := stackState(sc, mk(stackModule{Role: "midi_fx", ID: "euclid"}, syn)); err == nil || errors.As(err, &shape) {
		t.Errorf("a MIDI effect this device does not offer: %v", err)
	}
	if _, err := stackState(sc, mk(stackModule{Role: "synth", ID: "obxd"})); err == nil {
		t.Error("another instrument's stack was taken")
	}
	if s, err := stackState(sc, mk(syn)); err != nil || !strings.Contains(s, `"midi_fx":0`) {
		t.Errorf("an instrument alone: %v %s", err, s)
	}
	// an audio effect and a MIDI generator are stacks of their own device
	fx := stackClassFor(t)
	fx.Name, fx.module, fx.Kind, fx.midiFX = "CloudSeed", "cloudseed", livedevice.Effect, nil
	if s, err := stackState(fx, mk(stackModule{Role: "audio_fx", ID: "cloudseed", State: json.RawMessage(`{"mix":0.5}`)})); err != nil ||
		patchModule(json.RawMessage(s[strings.Index(s, `"chain":`)+8:strings.LastIndex(s, `,"midi_fx"`)]), livedevice.Effect) != "cloudseed" {
		t.Errorf("an effect's stack: %v %s", err, s)
	}
	for _, bad := range []*stackDoc{{Format: 2, Name: "x", Modules: []stackModule{syn}}, {Format: 1, Modules: []stackModule{syn}},
		{Format: 1, Name: "x"}, mk(stackModule{Role: "sampler", ID: "x"}), mk(stackModule{Role: "synth", ID: "../x"})} {
		if bad.valid() == nil {
			t.Errorf("taken as a stack: %+v", bad)
		}
	}
}

// A stack a Push is sent is kept, and is a rack in Push's browser beside the
// sounds' racks with the whole device state in it; sent again under its id
// with another name it is one stack still; removed, its rack goes, and no
// rack of someone else's is ever touched.
func TestStackKeptAsRack(t *testing.T) {
	sc, presets := rackClass(t)
	sc.midiFX = []string{"", "chords", "superarp"}
	h := &Host{dataDir: t.TempDir(), modulesDir: t.TempDir()}
	for dir, js := range map[string]string{
		"sound_generators/minijv": `{"id":"minijv","name":"Mini-JV","version":"1.0.0","component_type":"sound_generator"}`,
		"midi_fx/superarp":        `{"id":"superarp","name":"Super Arp","version":"1.2.0","component_type":"midi_fx"}`} {
		os.MkdirAll(filepath.Join(h.modulesDir, dir), 0o755)                             //nolint:errcheck
		os.WriteFile(filepath.Join(h.modulesDir, dir, "module.json"), []byte(js), 0o644) //nolint:errcheck
	}
	h.mods = &modMgr{h: h, jobs: map[string]*modJob{}}
	h.prov = &provider{h: h, classes: map[string]*sclass{sc.UID: sc}, devs: map[int]*device{}}
	h.sounds = &soundLib{h: h, racks: &soundRacks{presets: presets, classes: []*sclass{sc}}}
	h.stacks = newStackKeep(h)
	st, err := stackFromState(stackTestState)
	if err != nil {
		t.Fatal(err)
	}
	st.ID, st.Name = "a1", "Glass arp"
	dir := filepath.Join(presets, "Instruments", "Pung", stackRackDir)
	os.MkdirAll(dir, 0o755)
	foreign := filepath.Join(dir, "Mine.adg")
	os.WriteFile(foreign, []byte("the player's own"), 0o644)
	if err := h.stacks.put(st); err != nil {
		t.Fatal(err)
	}
	h.stacks.syncRacks()
	x, err := readGzip(filepath.Join(dir, "Glass arp.adg"))
	if err != nil {
		t.Fatal("no rack for the stack:", err)
	}
	m := regexp.MustCompile(`(?s)<ProcessorState>\n(.*?)\n\s*</ProcessorState>`).FindSubmatch(x)
	if m == nil {
		t.Fatal("no state in the rack")
	}
	blob, err := hex.DecodeString(strings.Join(strings.Fields(string(m[1])), ""))
	if err != nil || int(binary.LittleEndian.Uint32(blob)) != len(blob)-4 {
		t.Fatalf("the state is not as Live writes it: %v", err)
	}
	var doc struct {
		MidiFX  int             `json:"midi_fx"`
		PungMod json.RawMessage `json:"pung_mod"`
		Sound   soundRef        `json:"sound"`
	}
	if json.Unmarshal(blob[4:], &doc) != nil || doc.MidiFX != 2 || len(doc.PungMod) == 0 || doc.Sound.Name != "Glass arp" {
		t.Errorf("the rack's device state: %s", blob[4:])
	}
	if kept := h.stackKept(); len(kept) != 1 || kept[0]["where"] != "User Library › Presets › Instruments › Pung › Pung Stacks › Glass arp" {
		t.Errorf("kept: %+v", kept)
	}
	// renamed on pung.live and sent again: the same stack
	st.Name = "Glass arp II"
	if err := h.stacks.put(st); err != nil {
		t.Fatal(err)
	}
	h.stacks.syncRacks()
	if _, err := os.Stat(filepath.Join(dir, "Glass arp.adg")); err == nil {
		t.Error("the rack under the old name stayed")
	}
	if _, err := os.Stat(filepath.Join(dir, "Glass arp II.adg")); err != nil {
		t.Error("no rack under the new name")
	}
	if n := len(h.stacks.list()); n != 1 {
		t.Errorf("%d stacks kept, sent one twice", n)
	}
	// another stack may not take its name
	other := *st
	other.ID = "b2"
	if err := h.stacks.put(&other); err == nil {
		t.Error("two stacks under one name")
	}
	// a stack whose module is not here is kept, and waits without a rack
	wait := &stackDoc{Format: stackFormat, ID: "c3", Name: "Later", Modules: []stackModule{{Role: "synth", ID: "obxd"}}}
	if err := h.stacks.put(wait); err != nil {
		t.Fatal(err)
	}
	h.stacks.syncRacks()
	if _, err := os.Stat(filepath.Join(dir, "Later.adg")); err == nil {
		t.Error("a rack for a module that is not a device here")
	}
	if u := h.stackCheck(wait); len(u) != 1 || u[0].Module != "obxd" {
		t.Errorf("what Later lacks: %+v", u)
	}
	if err := h.stacks.remove("a1", ""); err != nil {
		t.Fatal(err)
	}
	h.stacks.remove("c3", "") //nolint:errcheck
	h.stacks.syncRacks()
	if _, err := os.Stat(filepath.Join(dir, "Glass arp II.adg")); err == nil {
		t.Error("the removed stack's rack stayed")
	}
	if raw, _ := os.ReadFile(foreign); string(raw) != "the player's own" {
		t.Error("a rack that was not Pung's was touched")
	}
}
