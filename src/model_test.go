package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// braids publishes these on the device (read 2026-11-14), trimmed.
const braidsParams = `[{"key":"engine","name":"Algorithm","type":"enum","options":["CSAW","MORPH","/\\-_","SINE^"]},
{"key":"timbre","name":"Timbre","type":"float","min":0,"max":1,"unit":"%","display_format":"%.0f"},
{"key":"cutoff","name":"Cutoff","type":"float","min":0,"max":1,"unit":"%"},
{"key":"octave_transpose","name":"Octave","type":"int","min":-3,"max":3},
{"key":"attack","name":"Attack","type":"float","min":0,"max":1,"unit":"%"}]`

const braidsHier = `{"modes":null,"levels":{"root":{"list_param":"preset","count_param":"preset_count","name_param":"preset_name",
"knobs":["engine","timbre","cutoff","attack"],"params":[{"level":"oscillator","label":"Oscillator"},{"level":"envelope","label":"Amp Envelope"}]},
"oscillator":{"knobs":["engine","timbre"],"params":["engine","timbre"]},
"envelope":{"knobs":["attack"],"params":["attack"]}}}`

func getter(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestBanksFollowTheModulesHierarchy(t *testing.T) {
	cm := buildMeta("braids", getter(map[string]string{"chain_params": braidsParams, "ui_hierarchy": braidsHier}))
	var names []string
	for _, b := range cm.Banks {
		names = append(names, b.Name)
	}
	// octave_transpose is in no section: it still gets a page (planLeftovers)
	if want := []string{"MAIN", "OSCILLATOR", "AMP ENVELOPE", "MORE 1"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("banks %v, want %v", names, want)
	}
	if want := []string{"octave_transpose"}; !reflect.DeepEqual(cm.Banks[3].Keys, want) {
		t.Fatalf("leftover keys %v", cm.Banks[3].Keys)
	}
	if want := []string{"engine", "timbre", "cutoff", "attack"}; !reflect.DeepEqual(cm.Banks[0].Keys, want) {
		t.Fatalf("main keys %v", cm.Banks[0].Keys)
	}
	if cm.Presets.List != "preset" || cm.Presets.Count != "preset_count" {
		t.Fatalf("presets %+v", cm.Presets)
	}
}

func TestNoHierarchyPagesChainParamsByEight(t *testing.T) {
	var list []map[string]any
	for i := 0; i < 11; i++ {
		list = append(list, map[string]any{"key": string(rune('a' + i)), "type": "float", "min": 0, "max": 1})
	}
	raw, _ := json.Marshal(list)
	cm := buildMeta("x", getter(map[string]string{"chain_params": string(raw)}))
	if len(cm.Banks) != 2 || len(cm.Banks[0].Keys) != 8 || len(cm.Banks[1].Keys) != 3 {
		t.Fatalf("banks %+v", cm.Banks)
	}
	if cm.Banks[0].Name != "MAIN" || cm.Banks[1].Name != "MORE 1" { // names say nothing: MAIN, then MORE
		t.Fatalf("name %q", cm.Banks[0].Name)
	}
}

// Schwung's rule: no metadata means no knob, never an invented 0..1 float.
func TestUnknownKeyIsReadOnly(t *testing.T) {
	cm := buildMeta("x", getter(map[string]string{"ui_hierarchy": `{"levels":{"root":{"knobs":["mystery"]}}}`}))
	if len(cm.Banks) != 1 {
		t.Fatalf("banks %+v", cm.Banks)
	}
	if m := cm.Params["mystery"]; m != nil && !m.ReadOnly {
		t.Fatalf("invented metadata for an undeclared key: %+v", m)
	}
}

func TestDisplayAndStep(t *testing.T) {
	cm := buildMeta("braids", getter(map[string]string{"chain_params": braidsParams}))
	timbre := cm.Params["timbre"]
	if v, u := timbre.display("0.35", true); v != "35" || u != "%" {
		t.Fatalf("timbre shows %q %q", v, u)
	}
	if v, _ := timbre.display("", false); v != "--" {
		t.Fatalf("a failed read shows %q, want --", v)
	}
	nv, ok := timbre.step("0.5000", 128, false)
	if !ok || nv != "1.0000" {
		t.Fatalf("128 clicks from half way: %q %v", nv, ok)
	}
	if _, ok := timbre.step("1.0", 5, false); ok {
		t.Fatal("stepping past the top must not write")
	}
	fine, _ := timbre.step("0.5000", 1, true)
	coarse, _ := timbre.step("0.5000", 1, false)
	if !(fine < coarse) {
		t.Fatalf("fine %s should move less than coarse %s", fine, coarse)
	}

	eng := cm.Params["engine"]
	if v, _ := eng.display("SINE^", true); v != "SINE^" {
		t.Fatalf("enum by word: %q", v)
	}
	if v, _ := eng.display("1", true); v != "MORPH" {
		t.Fatalf("enum by index: %q", v)
	}
	// a module that answers with the word gets the word back, an index gets an index
	if nv, _ := eng.step("CSAW", 1, false); nv != "MORPH" {
		t.Fatalf("enum word step: %q", nv)
	}
	if nv, _ := eng.step("2", -1, false); nv != "1" {
		t.Fatalf("enum index step: %q", nv)
	}
	if _, ok := eng.step("SINE^", 1, false); ok {
		t.Fatal("stepping past the last option must not write")
	}

	oct := cm.Params["octave_transpose"]
	if !oct.Bipolar {
		t.Fatal("-3..3 is bipolar")
	}
	if v, _ := oct.display("2", true); v != "+2" {
		t.Fatalf("octave shows %q", v)
	}
	if nv, _ := oct.step("2", 5, false); nv != "3" {
		t.Fatalf("int clamps: %q", nv)
	}
}

func TestSlotOfRouting(t *testing.T) {
	cases := map[string]int{
		`{"output":{"type":"Pung","channel":"Ch. 3"}}`:        2,
		`{"output":{"type":"Pung","channel":"Ch. 1"}}`:        0,
		`{"output":{"type":"Main","channel":""}}`:             -1,
		`{"output":{"type":"Pung","channel":"All Channels"}}`: -1,
		`{"output":{"type":"Stacks In","channel":"Ch. 2"}}`:   -1,
	}
	for in, want := range cases {
		if got := slotOfRouting(json.RawMessage(in)); got != want {
			t.Errorf("%s: slot %d, want %d", in, got, want)
		}
	}
}

func TestUsbMidiToRaw(t *testing.T) {
	if got := usbMidiToRaw([]byte{0x09, 0x90, 60, 100}); !reflect.DeepEqual(got, []byte{0x90, 60, 100}) {
		t.Fatalf("note on: %v", got)
	}
	if got := usbMidiToRaw([]byte{0x0C, 0xC0, 5, 0}); !reflect.DeepEqual(got, []byte{0xC0, 5}) {
		t.Fatalf("program change: %v", got)
	}
	if got := usbMidiToRaw([]byte{0x04, 0xF0, 1, 2}); got != nil {
		t.Fatalf("SysEx continuation is not a channel message: %v", got)
	}
}

func TestVst3FlagFindsTheLastMarker(t *testing.T) {
	d := append([]byte("junk\x0fVst3Preferences\x04\x00\x00\x00\x01more"), []byte("\x0fVst3Preferences\x04\x00\x00\x00\x00tail")...)
	off, on, err := vst3Flag(d)
	if err != nil || on || d[off] != 0 || off != len(d)-5 {
		t.Fatalf("off %d on %v err %v", off, on, err)
	}
	if _, _, err := vst3Flag([]byte("\x0fVst3Preferences\x05\x00\x00\x00\x00")); err == nil {
		t.Fatal("a changed layout must be refused")
	}
	if _, _, err := vst3Flag([]byte("no marker")); err == nil {
		t.Fatal("no marker must be refused")
	}
}

// Live hands back normalized values; the module's own value must come back
// exactly as Pung.vst3 wrote it (same formulas as vst3/source/params.h).
func TestLiveNormRoundTrip(t *testing.T) {
	cm := buildMeta("braids", getter(map[string]string{"chain_params": braidsParams}))
	eng := cm.Params["engine"]
	if got := eng.fromNorm(eng.toNormValue("SINE^")); got != "SINE^" {
		t.Fatalf("enum round trip: %q", got)
	}
	oct := cm.Params["octave_transpose"]
	if got := oct.fromNorm(oct.toNormValue("-2")); got != "-2" {
		t.Fatalf("int round trip: %q", got)
	}
	tim := cm.Params["timbre"]
	if got := tim.fromNorm(0.35); got != "0.3500" {
		t.Fatalf("float from norm: %q", got)
	}
}

func TestPadsInKey(t *testing.T) {
	cMajor := liveScale{Supported: true, Root: 0, Intervals: []int{0, 2, 4, 5, 7, 9, 11}}
	want := map[[2]int]byte{{0, 0}: 36, {1, 0}: 38, {0, 1}: 41, {7, 0}: 48}
	for cr, n := range want {
		if got, _ := padNoteInKey(cr[0], cr[1], 0, cMajor); got != n {
			t.Errorf("pad col %d row %d: %d, want %d", cr[0], cr[1], got, n)
		}
	}
	dMinor := liveScale{Supported: true, Root: 2, Intervals: []int{0, 2, 3, 5, 7, 8, 10}}
	if got, _ := padNoteInKey(0, 0, 0, dMinor); got != 38 {
		t.Errorf("D minor bottom-left: %d, want 38", got)
	}
}

// A Live device has no parameter for a hierarchy key without chain_params:
// its column goes, and a bank left empty goes (OB-Xd's osc_quantize).
func TestLiveBanksDropsKeysLiveHasNot(t *testing.T) {
	cm := &compMeta{
		Params: map[string]*paramMeta{"osc2_detune": {Key: "osc2_detune"}, "osc2_sync": {Key: "osc2_sync"}},
		Banks: []bank{
			{Name: "Oscillator 2", Keys: []string{"osc2_detune", "osc2_sync", "osc_quantize", ""}},
			{Name: "Hidden", Keys: []string{"osc_quantize"}},
		},
	}
	got := liveBanks(cm)
	if len(got.Banks) != 1 || strings.Join(got.Banks[0].Keys, ",") != "osc2_detune,osc2_sync" {
		t.Fatalf("banks %+v", got.Banks)
	}
	if len(cm.Banks) != 2 || len(cm.Banks[0].Keys) != 4 {
		t.Fatalf("the shared metadata changed: %+v", cm.Banks)
	}
	if liveBanks(nil) != nil {
		t.Fatal("nil in, nil out")
	}
}

// Live sends each note on its own channel; a module gets channel 1 unless it
// asks for passthrough (-2, MPE) or another channel (default_forward_channel).
func TestModuleInChannel(t *testing.T) {
	dir := t.TempDir()
	for _, c := range []struct {
		json string
		want int
	}{
		{`{"id":"a"}`, 0},
		{`{"id":"a","capabilities":{"default_forward_channel":1}}`, 0},
		{`{"id":"a","capabilities":{"default_forward_channel":5}}`, 4},
		{`{"id":"a","capabilities":{"default_forward_channel":-2}}`, -1},
		{`{"id":"a","capabilities":{"default_forward_channel":-1}}`, 0},
	} {
		os.WriteFile(filepath.Join(dir, "module.json"), []byte(c.json), 0o644)
		if got := moduleInChannel(ModuleInfo{Dir: dir}); got != c.want {
			t.Errorf("%s: %d, want %d", c.json, got, c.want)
		}
	}
}

// Shift makes a turn finer exactly where step() does.
func TestFineApplies(t *testing.T) {
	for _, c := range []struct {
		m    paramMeta
		want bool
	}{
		{paramMeta{Type: "float", Min: 0, Max: 1}, true},
		{paramMeta{Type: "int", Min: 0, Max: 127}, false},
		{paramMeta{Type: "int", Min: 20, Max: 20000}, true},
		{paramMeta{Type: "enum", Options: []string{"a", "b"}}, false},
		{paramMeta{Type: "float", Min: 0, Max: 1, ReadOnly: true}, false},
	} {
		if got := c.m.fineApplies(); got != c.want {
			t.Errorf("%+v: %v", c.m, got)
		}
		// and step agrees: fine moves less than coarse, or not differently
		if c.m.Type != "enum" && !c.m.ReadOnly {
			mid := fmt.Sprint((c.m.Min + c.m.Max) / 2)
			a, _ := c.m.step(mid, 1, false)
			b, _ := c.m.step(mid, 1, true)
			if (a != b) != c.want {
				t.Errorf("%+v: coarse %s fine %s, fineApplies %v", c.m, a, b, c.want)
			}
		}
	}
}
