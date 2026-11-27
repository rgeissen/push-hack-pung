package main

import (
	"testing"
)

// The device's own numbers: the counters parse, and a report has its parts.
func TestSystemInfo(t *testing.T) {
	h := &Host{dataDir: t.TempDir(), settings: loadSettings(t.TempDir())}
	s := h.systemInfo()
	for _, k := range []string{"name", "addresses", "pung", "system", "cpu", "memory", "disk"} {
		if s[k] == nil {
			t.Errorf("no %s in the report: %v", k, s)
		}
	}
	cpu, _ := s["cpu"].(map[string]any)
	if b, _ := cpu["busy"].(float64); b < 0 || b > 100 {
		t.Errorf("busy %v: percent of the whole machine", cpu["busy"])
	}
	d := s["disk"].(map[string]any)
	if d["total"].(int64) <= 0 || d["free"].(int64) > d["total"].(int64) {
		t.Errorf("disk: %v", d)
	}
	// asked again at once: the same window, not a division by nothing
	if again := h.systemInfo()["cpu"]; again == nil {
		t.Error("the second report has no processor numbers")
	}
}
