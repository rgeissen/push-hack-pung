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

// A limit is the deployment's own (deployment.go): a Mac has no count of
// emulators, so a third and a fourth start there, the governor asks no room
// for costs measured on a Push, and a stack's check does not speak of a count.
func TestLimitsAreTheDeploymentsOwn(t *testing.T) {
	was := here
	defer func() { here = was }()
	running := []string{"ostirus", "xenia", "vavra"}
	here = kindPush
	if why := emulatorRefused("nodalred", running); why == "" || !strings.Contains(why, "a Push carries") {
		t.Errorf("a Push: a fourth emulator was not refused in the Push's name: %q", why)
	}
	if why := govRoom("nodalred", 380, nil, running, 4); why == "" || !strings.Contains(why, "the Push is too busy") {
		t.Errorf("a Push: no room asked for an emulator on a full machine: %q", why)
	}
	here = kindMac
	if why := emulatorRefused("nodalred", running); why != "" {
		t.Errorf("a Mac: an emulator refused by a count that is the Push's: %q", why)
	}
	if why := govRoom("nodalred", 380, nil, running, 4); why != "" {
		t.Errorf("a Mac: room asked for by costs measured on a Push: %q", why)
	}
	if kindOf("darwin").Kind != "mac" || kindOf("linux").Kind != "push" {
		t.Error("the kind does not follow the system Pung runs on")
	}
	if n, ok := kindMac.limits()["emulators"]; ok {
		t.Errorf("a Mac says it carries %v emulators at once: it has no count", n)
	}
	if kindPush.limits()["emulators"] != 2 {
		t.Error("a Push no longer says it carries two emulators at once")
	}
}
