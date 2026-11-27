# Stacks

The word and the idea are settled (2026-11-27), and a first version is built: take a stack from a device,
keep it on pung.live, send it to a device ("What is built", below). What is marked *open* is not decided.

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

## Managed on pung.live

Stacks are managed through the website (the owner's word, 2026-11-27): pung.live is a stack's home, a device
is where it plays. That follows the site's rule of one home for each thing (CLAUDE.md, The site), and it is
the part that becomes the service.

- **The website**: the visitor's stacks, each with its modules, what it needs and where it is deployed;
  making one (choosing modules from the Modules page, their order), naming, copying, deleting; sending one to
  a device, of any kind; taking one from a device.
- **A device**: plays a stack, and is where its sound is shaped (the modules' own screens, on the Push the
  encoders). It hands its state to the website ("take from this device") and takes a stack from it ("send to
  this device"). It keeps what it was sent, so it plays without the website and without the internet; it
  does not manage a library of its own, and its page does not grow one.
- **Between them**, as everything else on pung.live: the visitor's browser talks to the device over their
  home network.

So a device needs two calls and little more: give the stack a Pung device is playing (`GET`), and take one
(`POST`: check it, say what cannot be met, keep it, load it). Installing what is missing stays where it is:
the Modules page, which the Stacks page points to.

## Where the stacks are kept

- **First**: in the visitor's browser (as the device list is), with a file to download and drop for a
  second browser or a backup. No account, nothing on pung.live.
- **Then, the service**: an account, and the stacks kept on pung.live: on every browser and device,
  versioned, shared. This, and sending to a device of another kind, is what is sold (the owner's plan); a
  stack's format, and saving and loading one, stay open and free.

## Saving, moving, loading

- **Take** (website, from a device): the stack a Pung device is playing: its instrument, the MIDI
  generator in front of it, the effects behind it, their states, Pung's modulation.
- **Send** (website, to a device): the receiving Pung checks the stack against what it has: installs the
  modules it lacks from the module pack (signed, `modpack.go`), names the firmware that is missing, refuses a
  module that needs a newer Pung or a kind of device it does not run on, and says so before anything loads.
- **Play**: the stack is playable where the device keeps its sounds, and stays there.
- **A file** works without the website's library: download a stack, drop it on the page elsewhere.

## What exists already

- The engine hosts a chain (Schwung's chain host): a Pung instrument already carries a MIDI effect in
  front of the synth; Schwung's own chain patches are the same idea in small.
- A device's state is kept and restored (`kept-states.json`), Pung's modulation in it (`pung_mod`).
- pung.live knows the visitor's devices, of several kinds, and talks to each (`site/pushlink.js`).
- The module pack installs what is missing, signed, on any device.

## What is built (the first version, 2026-11-27)

The whole trip, for the stack one Pung device holds on a Push: an instrument with the MIDI effect in front
of it, or a MIDI generator, or an audio effect; each with Pung's modulation.

- **The device** (`src/stacks.go`; the calls pung.live may make are in `src/sitecors.go`):
  - `GET /api/stacks`: `playing` (every Pung device in the Set: `n`, module, name, its sound, the MIDI
    effect in front) and `kept` (the stacks this device was sent, each `ready` or with what is `unmet`, and
    `where` it is in Push's browser).
  - `GET /api/stacks/playing/{n}`: the stack that device plays (the document above; `needs` derived: the
    oldest Pung, firmware the modules ask for, how many are emulators).
  - `POST /api/stacks {"stack", "check"?, "onto"?}`: with `check` it only says what this device lacks
    (`unmet`: `install`, `restart`, `pung`, `firmware`, `unknown`, `shape`). Without, it keeps the stack
    (`<data>/stacks/<name>.json`; one per `id`, so a stack renamed on pung.live and sent again is the same
    one) and writes its rack; `onto: n` also loads it into that Pung device now (the device must be the
    stack's instrument; it replaces what the device plays). A stack this device can never play (`shape`,
    `unknown`, `pung`) is refused with 409 and not kept.
  - `POST /api/stacks/remove {"id" | "name"}`.
- **In Push's browser**: a kept stack is a Live rack, as a saved sound is (`sounds_racks.go`): the module's
  own rack with the whole device state in it (MIDI effect, Pung's modulation), at User Library › Presets ›
  Instruments › Pung › **Pung Stacks** (not "Stacks": the module of that name has its sounds' racks in a
  folder so called). Loading it brings the device with the stack; the device names it (its sound is
  `{"source":"stack","name":…}`). Only racks Pung wrote are replaced or removed (`.pung-racks`). A stack
  whose module is not yet a device in Live here is kept and gets its rack at the first start that has the
  module (after the install and the restart of Live).
- **A device's MIDI effect travels by its id**, not by its place in the class's list (a device's state
  keeps the place, which differs between devices): `stackState` maps it.
- **pung.live** (`site/stacks.src.html`, `site/stacks.js`; in the menu once the site is launched): the
  visitor's stacks as cards (the instrument's picture, the modules in order, Pung's modulation, what it
  needs, which device keeps it), kept in the browser's IndexedDB (`pung` / `stacks`); *Take as a stack*
  from what plays on a connected device; *Send to a device* (the device is asked first, and what it lacks
  is said with the way to meet it); download and open as a file (`.pungstack`, the document itself); a file
  dropped anywhere on the page; duplicate, rename, delete.
- **Proven on a Push** (2026-11-27, Dexed): taken, sent, its rack loaded from Push's browser (the device
  came up with the stack's state and name), loaded into a playing device (`onto`, on a device made without
  Live), another instrument's stack refused, removed (rack and folder gone).

Not built: effects behind an instrument in one stack, the eight knobs, building a stack on the website
(choosing modules and their order), an account, sending to another kind of device.

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
