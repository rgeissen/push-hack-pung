# Stacks

A sketch, not yet built (2026-11-27). The word and the idea are settled; what is marked *open* is not.

## What a stack is

A **stack** is what a player builds out of modules: the modules in their order, the state of each, and what
is laid over them. A module runs on every device Pung runs on; a stack is what travels between them.

It is not Ableton's Rack. On a Push, Pung writes a Live rack for every module (the entry in Push's browser);
say "Live rack" for that and "stack" for this, and never "Pung rack". It is not **Stacks** either, the owner's
chord-progression tool (`schwung-stacks`): the concept is written in lower case, "a stack", "stacks".

## What it holds

```json
{
  "pung_stack": 1,
  "name": "Glass arp",
  "made_on": { "kind": "push", "pung": "0.7.0" },
  "modules": [
    { "role": "midi_fx",  "id": "superarp", "version": "1.2.0", "state": "<the module's own state>" },
    { "role": "synth",    "id": "vivace",   "version": "0.1.1", "state": "…" },
    { "role": "audio_fx", "id": "cloudseed", "version": "0.4.2", "state": "…" }
  ],
  "mod": { "…": "Pung's own modulation, as a device's state keeps it (pung_mod)" },
  "knobs": [ { "name": "Bright", "to": [ { "module": 1, "key": "filter_1_cutoff", "from": 0.2, "to": 0.9 } ] } ],
  "needs": { "firmware": [] }
}
```

- **Modules, in order**: MIDI generators, one instrument, audio effects. It names them (id, version); it
  does not carry them, and never firmware or a ROM.
- **The state of each**: what the module's own `get_param("state")` answers, as a device keeps it today
  (`kept-states.json`, the Live Set).
- **What is laid over them**: Pung's modulation (`pungmod.go`), and eight knobs for the stack as a whole (a
  page of its own on the Push, in front of the modules' pages).
- **What it needs**: derived on saving: the modules, the oldest Pung that runs them (`min_pung`), the
  firmware the player must own, what its emulators cost.

A stack is a small JSON file; a picture of it (its front page) is drawn by the device, not stored.

## Saving, moving, loading

- **Save**, on a device: from a Pung device as it plays (its instrument, the MIDI effect in front of it,
  the effects behind it) into Pung's data (`stacks/`), listed by `GET /api/stacks`.
- **Move**, through pung.live: Your devices lists each device's stacks; "Send to…" reads it from one device
  and gives it to another, in the visitor's browser over their home network (nothing kept on pung.live). A
  file works too: download from one, drop on the other.
- **Arrive**: the receiving Pung checks the stack against what it has: installs the modules it lacks from
  the module pack (signed, `modpack.go`), names the firmware that is missing, refuses a module that needs a
  newer Pung or a kind of device it does not run on, and says so before anything loads.
- **Load**: the stack becomes playable where the device keeps its sounds.

## What exists already

- The engine hosts a chain (Schwung's chain host): a Pung instrument already carries a MIDI effect in
  front of the synth; Schwung's own chain patches are the same idea in small.
- A device's state is kept and restored (`kept-states.json`), Pung's modulation in it (`pung_mod`).
- pung.live knows the visitor's devices, of several kinds, and talks to each (`site/pushlink.js`).
- The module pack installs what is missing, signed, on any device.

## Open

- **On a Push, in Live**: one Live device for a whole stack (a class "Pung Stack" whose state is the stack:
  simple to move, but Live then sees one device where it could see three), or the stack unfolded into its
  modules as devices on a track (Live's own chain, automation per module; then a stack is a Live rack of Pung
  devices and Pung must write and read that). Decide with a prototype of each.
- **Audio effects behind the instrument inside one device**: the chain host does it on Move; on the Push,
  effects are devices of their own today.
- **A module that differs between devices** (an emulator a small device cannot carry; a module not built
  for a kind): what a stack offers in its place, if anything.
- **The eight knobs**: how they are assigned on the Push (ASSIGN already offers each segment its
  destinations), and how they read on a device without eight encoders.
- **Sharing beyond one's own devices**, and stacks in a marketplace: later, when there is pull.
