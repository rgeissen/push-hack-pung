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
//     once left the Push unreachable (2026-11-21, CLAUDE.md): no more than a
//     deployment's own count run together (deployment.go: two on a Push, no
//     count on a Mac; emulatorsRunning, provider.New).
//   - rests: the module stops its engine while nobody hears it, and wakes on
//     time (govrest.go; NATIVE-MODULES.md, "Rest"). Pung's own emulators.
//   - hostRests: the module is not asked for sound while nobody hears it
//     (rtloop.c, rt_set_rest), as Schwung's own host does with every module
//     on Move; its emulator, which renders ahead of what is read, stops by
//     itself. Schwung's emulators.
//   - cost: what its emulator takes while it plays, in percent of one core,
//     measured on a Push (docs/GOVERNOR.md). The governor keeps room for it
//     (govRoom).
type moduleLimit struct {
	One       string  `json:"one,omitempty"` // "waits" | "refuses"
	Emulator  bool    `json:"emulator,omitempty"`
	Rests     bool    `json:"rests,omitempty"`
	HostRests bool    `json:"host_rests,omitempty"`
	Cost      float64 `json:"cost,omitempty"`
}

// emulatorCostUnknown: an emulator nobody measured counts as a Virus.
const emulatorCostUnknown = 100

func (l *moduleLimit) cost() float64 {
	if l.Cost > 0 {
		return l.Cost
	}
	return emulatorCostUnknown
}

var moduleLimits = map[string]moduleLimit{
	// costs: a six-note chord held, 2026-11-25 (docs/GOVERNOR.md)
	"nodalred": {One: "waits", Emulator: true, Rests: true, Cost: 180},
	"ostirus":  {One: "waits", Emulator: true, Rests: true, Cost: 100},
	"vavra":    {One: "waits", Emulator: true, Rests: true, Cost: 65},
	"xenia":    {One: "waits", Emulator: true, Rests: true, Cost: 80},
	"jp8000":   {One: "refuses", Emulator: true, HostRests: true},
	"osirus":   {Emulator: true, HostRests: true},
}

// limitsOf: a module's limits, nil where it has none.
func limitsOf(id string) *moduleLimit {
	if l, ok := moduleLimits[id]; ok {
		return &l
	}
	return nil
}

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
	max := here.MaxEmulators
	if max <= 0 {
		return "" // this deployment has no count of its own
	}
	now := emulatorsRunning(running)
	if len(emulatorsRunning(append(append([]string(nil), running...), module))) <= max || len(now) < max {
		return ""
	}
	return fmt.Sprintf("%d emulators are running (%s), the most a %s carries: this one starts when one of them is removed",
		len(now), strings.Join(now, ", "), here.Name)
}
