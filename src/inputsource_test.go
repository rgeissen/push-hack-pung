package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Line In (audio in, no notes) stays out of Live; a synth with an audio input
// of its own (Aphex's ESP) is an instrument.
func TestInputSourceIsOnlyAnInput(t *testing.T) {
	cases := map[string]string{
		"linein": `{"capabilities":{"audio_in":true,"midi_in":false}}`,
		"aphex":  `{"capabilities":{"audio_in":true,"midi_in":true}}`,
		"bare":   `{"capabilities":{"audio_in":true}}`,
		"synth":  `{"capabilities":{"midi_in":true}}`,
	}
	want := map[string]bool{"linein": true, "aphex": false, "bare": true, "synth": false}
	for id, js := range cases {
		dir := filepath.Join(t.TempDir(), id)
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "module.json"), []byte(js), 0o644)
		if got := moduleIsInputSource(ModuleInfo{ID: id, Dir: dir}); got != want[id] {
			t.Errorf("%s: input source %v, want %v", id, got, want[id])
		}
	}
}
