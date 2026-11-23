package main

import (
	"strings"
	"testing"
)

// No more than two emulators run together; a kind that runs one at a time
// counts once (its other devices wait and cost nothing); other modules are
// never refused.
func TestEmulatorLimit(t *testing.T) {
	cases := []struct {
		running []string
		add     string
		refused bool
	}{
		{nil, "ostirus", false},
		{[]string{"ostirus"}, "xenia", false},
		{[]string{"ostirus", "xenia"}, "nodalred", true},
		{[]string{"ostirus", "xenia"}, "ostirus", false}, // waits for its own kind, adds nothing
		{[]string{"ostirus", "ostirus", "helm"}, "xenia", false},
		{[]string{"osirus", "osirus"}, "vavra", true}, // Osirus has no lock: two instances, two emulators
		{[]string{"ostirus", "xenia"}, "helm", false},
		{[]string{"jp8000", "osirus"}, "minijv", false}, // (Mini-JV is not counted)
	}
	for _, c := range cases {
		why := emulatorRefused(c.add, c.running)
		if (why != "") != c.refused {
			t.Errorf("%v + %s: refused %q, want refused %v", c.running, c.add, why, c.refused)
		}
	}
	if why := emulatorRefused("nodalred", []string{"ostirus", "helm", "xenia"}); !strings.Contains(why, "ostirus, xenia") {
		t.Errorf("the refusal names what runs: %q", why)
	}
}
