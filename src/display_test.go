package main

import (
	"os"
	"path/filepath"
	"testing"
)

// A screen file's push.display writes the module's values wherever Pung
// does; what it leaves out stays Pung's own.
func TestOverlayDisplay(t *testing.T) {
	ov := t.TempDir()
	os.MkdirAll(filepath.Join(ov, "dispmod"), 0o755)
	os.WriteFile(filepath.Join(ov, "dispmod", "push_ui.js"), []byte(`
push.display(function (key, raw) {
  if (key === "att") return { value: String(Math.round(1000 * Math.pow(2, +raw))), unit: "ms" };
  if (key === "cut") return Math.round(+raw * 100) + " Hz";
});`), 0o644)
	root := t.TempDir()
	dir := filepath.Join(root, "sound_generators", "dispmod")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"dispmod","component_type":"sound_generator"}`), 0o644)
	if set := newOverrides(ov).get(root, "dispmod"); set == nil || set.failed != "" {
		t.Fatalf("the screen file does not load: %+v", set)
	}
	att := &paramMeta{Key: "att", Name: "Attack", Type: "float", Min: -10, Max: 3, module: "dispmod"}
	if v, u := att.display("-1", true); v != "500" || u != "ms" {
		t.Errorf("attack: %q %q, want 500 ms", v, u)
	}
	cut := &paramMeta{Key: "cut", Name: "Cutoff", Type: "float", Max: 1, module: "dispmod"}
	if v, u := cut.display("0.42", true); v != "42 Hz" || u != "" {
		t.Errorf("cutoff: %q %q, want \"42 Hz\"", v, u)
	}
	res := &paramMeta{Key: "res", Name: "Reso", Type: "float", Max: 1, module: "dispmod"}
	own := &paramMeta{Key: "res", Name: "Reso", Type: "float", Max: 1}
	if v, _ := res.display("0.42", true); func() string { w, _ := own.display("0.42", true); return w }() != v {
		t.Errorf("a key the script leaves out is not Pung's own: %q", v)
	}
	if v, _ := att.display("", false); v != "--" {
		t.Errorf("an unread value reads %q, want --", v)
	}
}

// An enum whose options are numbers: a value equal to one is that option
// (Surge's octave "0" is 0, not the first option -3); other lists by position.
func TestNumericEnumByText(t *testing.T) {
	oct := &paramMeta{Key: "octave", Type: "enum", Options: []string{"-3", "-2", "-1", "0", "1", "2", "3"}}
	for raw, want := range map[string]string{"0": "0", "-1": "-1", "3": "3"} {
		if v, _ := oct.display(raw, true); v != want {
			t.Errorf("octave %q reads %q, want %q", raw, v, want)
		}
	}
	mode := &paramMeta{Key: "mode", Type: "enum", Options: []string{"Low Pass", "High Pass"}}
	if v, _ := mode.display("1", true); v != "High Pass" {
		t.Errorf("a named list by position: %q", v)
	}
}

// A position written as a float ("7.0000") is that option (9W9 answers so).
func TestEnumPositionAsFloat(t *testing.T) {
	m := &paramMeta{Key: "mode", Type: "enum", Options: []string{"A", "B", "C", "D", "E", "F", "G", "H"}}
	if v, _ := m.display("7.0000", true); v != "H" {
		t.Errorf("7.0000 reads %q, want H", v)
	}
	if f := m.frac("7.0000"); f != 1 {
		t.Errorf("7.0000 stands at %v, want 1", f)
	}
}
