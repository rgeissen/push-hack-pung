package main

import "runtime"

// deployment.go: what this Pung runs on, and what that carries.
//
// A limit is the deployment's, not Pung's (the owner, 2026-11-28: "each
// deployment option carries its own limits"). Two emulators at once is what a
// Push 3 carries: three left it unreachable. A Mac has no such count; nobody
// has measured one there, so none is set. What a Set needs beyond what a
// deployment carries is said when the Set's stack is checked against it
// (setstack.go), not found out by a Set that will not play.
//
// The same word names the kind on pung.live (site/pushlink.js, KINDS).
type deploymentKind struct {
	Kind string // "push" | "mac"
	Name string // as a sentence says it: "the most a Push carries"
	// MaxEmulators: emulators that run together; 0: no count of its own.
	MaxEmulators int
	// EmulatorCosts: the governor keeps room for an emulator by what it costs
	// (limits.go, in percent of one core of a Push 3). false: those numbers
	// are not this kind's, and no room is asked for until it has its own.
	EmulatorCosts bool
}

var (
	kindPush = deploymentKind{Kind: "push", Name: "Push", MaxEmulators: 2, EmulatorCosts: true}
	kindMac  = deploymentKind{Kind: "mac", Name: "Mac"}
)

// here: the kind this Pung runs on. (A variable: the tests look at a Mac's limits from a Push's build.)
var here = kindOf(runtime.GOOS)

func kindOf(goos string) deploymentKind {
	if goos == "darwin" {
		return kindMac
	}
	return kindPush
}

// limits: what this deployment carries, as /api/system answers it.
func (k deploymentKind) limits() map[string]any {
	m := map[string]any{}
	if k.MaxEmulators > 0 {
		m["emulators"] = k.MaxEmulators
	}
	return m
}
