package main

// moduleLimits: what a module allows, where it allows less than "as many as
// the processor carries" (the Modules page shows it on the module's card).
// Only what is enforced or measured:
//
//   - one: the module runs one instance on the Push. "waits": a second one
//     stays silent, says Waiting, and starts when the first is removed (Pung's
//     emulators: a lock in /dev/shm). "refuses": a second one reports an
//     error and stays silent (JE-8086: "already running in another slot").
//   - emulator: an emulated hardware DSP that takes most of a core. Not
//     enforced, measured: three at once left the Push unreachable
//     (2026-11-21, CLAUDE.md), so no more than two run together.
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
