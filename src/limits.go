package main

import (
	"fmt"
	"strings"
)

// moduleLimits: what a module allows, where it allows less than "as many as
// the processor carries" (the Modules page shows it on the module's card).
// Only what is enforced or measured:
//
//   - one: the module runs one instance on the Push. "waits": a second one
//     stays silent, says Waiting, and starts when the first is removed (Pung's
//     emulators: a lock in /dev/shm). "refuses": a second one reports an
//     error and stays silent (JE-8086: "already running in another slot").
//   - emulator: an emulated hardware DSP that takes most of a core. Three at
//     once left the Push unreachable (2026-11-21, CLAUDE.md): no more than
//     maxEmulators run together (emulatorsRunning, provider.New).
type moduleLimit struct {
	One      string `json:"one,omitempty"` // "waits" | "refuses"
	Emulator bool   `json:"emulator,omitempty"`
}

var moduleLimits = map[string]moduleLimit{
	"nodalred": {One: "waits", Emulator: true},
	"ostirus":  {One: "waits", Emulator: true},
	"vavra":    {One: "waits", Emulator: true},
	"xenia":    {One: "waits", Emulator: true},
	"jp8000":   {One: "refuses", Emulator: true},
	"osirus":   {Emulator: true},
}

// limitsOf: a module's limits, nil where it has none.
func limitsOf(id string) *moduleLimit {
	if l, ok := moduleLimits[id]; ok {
		return &l
	}
	return nil
}

// maxEmulators: emulators that run together. Measured: two play, three left
// the Push unreachable (2026-11-21).
const maxEmulators = 2

// emulatorsRunning: the emulators that run for these modules (one a device):
// a kind that runs one at a time counts once however many devices it has
// (the others wait, silent, and cost nothing); any other emulator once a
// device. Their names, in order.
func emulatorsRunning(modules []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range modules {
		l := limitsOf(m)
		if l == nil || !l.Emulator {
			continue
		}
		if l.One != "" {
			if seen[m] {
				continue
			}
			seen[m] = true
		}
		out = append(out, m)
	}
	return out
}

// emulatorRefused: why a new device of module may not start beside the
// devices of running (their modules), or "". A refused device in Live asks
// again every second (core's plugin, keepConnected): it starts by itself
// once an emulator is removed.
func emulatorRefused(module string, running []string) string {
	l := limitsOf(module)
	if l == nil || !l.Emulator {
		return ""
	}
	now := emulatorsRunning(running)
	if len(emulatorsRunning(append(append([]string(nil), running...), module))) <= maxEmulators || len(now) < maxEmulators {
		return ""
	}
	return fmt.Sprintf("%d emulators are running (%s), the most a Push carries: this one starts when one of them is removed",
		len(now), strings.Join(now, ", "))
}
