# Pung-native modules

Status: 2026-11-18. The first one, Nodal Red 2X, runs as a device in Live on a Push 3 with the firmware:
notes, SOUNDS with its banks and names, its own screens, the firmware's own sounds, and its state across
a restart of Pung. It is not in the published catalog yet.

## Two kinds of module

| | Schwung-derived | Pung-native |
|---|---|---|
| Source | the module's own repository, listed in Schwung's `module-catalog.json` | `native/<id>/` in this repository, listed in `native/catalog.json` |
| Built for | Move (ARM) by its author, and for the Push by Pung | the Push only (x86-64) |
| Build | a recipe read from the module's build script, never run (`docs/push-module-builds.md`) | its own CMake and a hand recipe, `scripts/recipes/<id>.sh` |
| Limits | Move's processor, Move's 128x64 screen, Move's `ui.js` | the Push's: four cores, its screen, its eight encoders |
| Updates | follow the author's releases; what Pung adds sits in layers on top | released with Pung's catalog |

A module is native when it would not run on a Move, or has no reason to be shaped by one. Nodal Red 2X
emulates two DSPs and a 68k at 98.2 kHz, which a Move cannot do.

## What stays the same

A native module is loaded by the same chain host through the same plugin API (`plugin_api_v2`,
`move_plugin_init_v2`), and answers the same keys: `chain_params`, `ui_hierarchy`, `state`, `preset`,
`preset_count`, `preset_name`, `is_loading`, `loading_status`, `load_error`. So SOUNDS, the web page, Live's
parameters, a Set's saved state, the catalog and the module manager work with it unchanged. What Pung
adds for a module (`push_ui.js`, the file browser, sound names) is used the same way.

It is not a new plugin format. Only where the source lives and what it may assume are different.

## Rules for a native module

1. **Render off the audio thread when a block can take long.** `render_block` runs on the device's
   audio thread with 1.45 ms to answer. An emulator renders on its own thread into a ring, and
   `render_block` only reads the ring (Nodal Red: 7 ms ahead).
   **An emulator runs in a process of its own** (OsTIrus since 2026-11-23, `ostirus-engine`): the
   plugin keeps the sound and starts the engine with `posix_spawn` (never `fork` in Pung), a memory
   file (`memfd_create`) as its descriptor 3 holding the ring, a queue of MIDI and sound dumps, status
   and what the engine reads from the emulator (wavetables). The engine dies with its parent
   (`PR_SET_PDEATHSIG`); a stop asks, then kills; an engine that dies is started again (3 a minute).
   Emulators hung Pung four times in a week while they booted or shut down; in its own process one
   never can. Its executables link for the Push's loader, `/lib/ld-linux-x86-64.so.2`.
2. **Set the priority of your own threads.** Below the host's audio threads (FIFO 70) and the engine
   (60), above ordinary work. Nodal Red: FIFO 45, set on the thread that creates the emulator's threads,
   so they inherit it.
3. **Keep `dsp.so` unloadable:** `-fno-gnu-unique`, `-Wl,--exclude-libs,ALL`, static libstdc++.
4. **No firmware in the package.** ROMs are the user's; `module.json` `assets` says which files.
5. **Ship every licence text** of what is linked in, in `licenses/`.
6. **The parameter list is fixed once released.** Live keeps a device by its class, and the class is
   made from `chain_params`. Taking a parameter out (Nodal Red's bank knob, before its release) made the
   device vanish from the open Set at Live's next start.
7. **Sounds by the contract:** a bank chooser is a level with `items_param` and `select_param`, and the
   list answers `preset_names` (every name of the bank) and `preset_name_<n>`. Then SOUNDS shows banks and
   names without loading a sound. A bank as a plain knob gives a list of one bank.
8. **Envelopes, filters and LFOs through Pung's pictures**, `g.envelope`, `g.filter` and `g.lfo`, in the
   instrument's colours (`color`) inside its own panel: they then move with the sound (a note's dot on
   each envelope, the spectrum behind each filter, an LFO's playhead or restart). A curve drawn by hand
   stands still; Vavra's and Xenia's did, until `TestNativeScreensMove` caught it.

## Dropouts: where they came from (2026-11-21)

Played on a Push 3 (OsTIrus, chords, sound changes, knobs, Pung's pages), most dropouts were not the
emulator's. Live's plugin waits half a block (1.45 ms) for Pung; a block later than that is silence,
counted as `late` in `/api/devices`. Pung served blocks from a Go goroutine, and Go stopped it now and
then: its garbage collector (twice a second at Go's default), and its scheduler, which takes even a
realtime goroutine off its processor and gives it back only through an ordinary thread. Both waited
for Pung's threads at nice 19, behind the emulators and Live.

| Played, 2 to 3 min | Late blocks | Slowest block in Pung |
|---|---|---|
| Go loop, GOGC 100, nice 19 | about 2.5 a minute | 2.3 ms |
| Go loop, GOGC 800, nice 19 | 5 in 2 min | 2.3 ms |
| Go loop, GOGC 800, nice 0 | 2 in 2 min | 2.1 ms |
| C thread (`rtloop.c`) | 0 in 3 min | 0.12 ms |

The emulator's own misses (`underruns` in `debug_info`) are rarer: OsTIrus renders a chord about 1.2
times as fast as it must, and once in 3 minutes of play one of its blocks took 83 ms (a sound's DSP
code compiled on first use, or RT throttling). Every engine now fades a short block out over 32 frames
and the next one in (a dip, not a click), and keeps the ring deep (1280 frames) for 3 s after a miss.

`scripts/render-check.sh` runs the container with `--shm-size=1g`: OsTIrus died with a bus error in
Docker's 64 MB.

## Layout

```
native/catalog.json          the native modules: Schwung's entry shape, plus native, modsrc, deps
native/<id>/module.json
native/<id>/CMakeLists.txt
native/<id>/dsp/...
scripts/recipes/<id>.sh      the recipe (required)
scripts/sync-native.sh       native/<id> -> build/modsrc/<modsrc>, its deps beside it; build/catalog-merged.json
```

`deps` names source trees the module is built with, each pinned to a commit. They are synced into the
module's folder under `build/modsrc`, so the module is built, and its source archived for the catalog, from
one folder like every other module. Nodal Red's one dep is gearmulator (`rgeissen/gearmulator`, the fork
JE-8086 is built from).

```bash
scripts/build-push-modules.sh nodalred                       # build and package
python3 scripts/build-catalog.py --base-url "" nodalred      # into the catalog (build/catalog)
```

## Nodal Red 2X

`native/nodalred/dsp/nodalred_plugin.cpp`, on gearmulator's `n2xLib`.

- **Threads:** one emulator thread renders 64 frames at a time through `synthLib::Plugin` (which resamples
  98.2 kHz to 44.1 kHz) into a ring. The emulator's two DSP threads and its 68k thread inherit FIFO 45.
- **The sound is kept in the module** as the synth's own dumps, one multi and four singles. Every change
  goes through the module, so nothing is read back from the emulator. `state` is the multi dump.
- **Slots:** `slot` picks the slot the parameters edit, `slot_a`..`slot_d` put slots into the layer. Slots
  that are on listen on MIDI channel 1, the others on none. A controller for one slot goes past the
  emulator's channel translation (`createPacketSkipTranslation`).
- **Parameters:** 83, of which 75 belong to the synth and 8 to the module (sound, bank, slots, gain). 42
  have a MIDI controller and are sent as one. The filter type and the 25 morph ranges exist only in a
  dump: the slot's single dump is sent, at most one every 120 ms. The 7 performance parameters send the
  multi dump.
- **Sounds:** the emulated synth has none of its own. `banks/*.syx` are read at start; each file is a
  bank, each program or performance dump in it a sound. A program loads into the edited slot, a
  performance replaces all four. The Nord stores no names: `<file>.txt` beside a bank names its sounds,
  one a line. Percussion kits (1063-byte dumps) are skipped.
- **Clavia's factory library** (4 program banks, 100 performances, as `.syx`) was played through on the
  Push, two notes per sound: 494 of 496 sound, the other two want the mod wheel. A sound change costs one
  or two short underruns. Program banks 4 to 9 and performance banks 1 to 3 are in the firmware itself
  and cannot be reached yet.
- **Incoming controllers** other than the wheel, the pedals and all-notes-off are dropped: every other
  controller is a knob of the synth and would change the sound behind the parameters.

- **A controller right after a dump is lost** (measured): the synth is still receiving the dump, at MIDI
  speed, and the dump's value wins. So while a dump is on its way, or waiting, a change goes out in the
  next dump instead of as a controller, and dumps are sent one at a time.
- **The emulator's logs are switched off:** the 68k core writes every register access to stderr.

### Measured on a Push 3 (i3-1115G4, 2 cores, 4 threads), 2026-11-18

In a harness that calls `render_block` every 2.9 ms, beside a running Live:

| | |
|---|---|
| Boot | 1.8 s |
| DSP A, DSP B threads | 50 to 58 % of a logical core each, whether 0 or 20 voices sound |
| Emulator thread | about 11 % |
| A 64-frame block (1.45 ms of audio) | 0.78 to 1.06 ms, at most 1.51 ms |
| Underruns, 20 voices in 4 slots | 0 |
| C4 | 261.5 Hz |

The emulator runs about 1.5 times as fast as it must. The DSP clock setting gearmulator offers changed
nothing here (tried 30 to 100 %), so it is not a parameter.

Checked by spectrum: the four waveforms of each oscillator, the mix, filter types 1 to 4 (LP 12, LP 24,
HP 24, BP), cutoff, a program and a performance loaded from a bank file, state save and restore. Filter
type 5 looks like notch plus low pass; type 6 can only be set by a dump and is not on the real panel.

### The shutdown crash

On the Push the module crashed in `~JitBlockChain` on 6 of 8 shutdowns. gearmulator's `MmuArray` unmapped
a block and mapped it again; another thread's `mmap` could take the address in between. The Nord has two
DSP threads. `native/nodalred/patches/0001-mmu-remap-atomically.patch` replaces the mapping in one step:
18 of 18 shutdowns clean. The patch is applied by the recipe and has not been sent upstream.

### Its own process (0.1.3, 2026-11-23)

The emulator runs in `nodalred-engine` (`dsp/nodalred_engine.cpp`), with `dsp/emu_shm.h` and
`dsp/emu_host.h` (shared by the modules that followed). The plugin's run thread starts and watches it
and does what the sound needs: the master volume and the whole sound once the engine runs, dumps at the
synth's pace (`flush_dumps`), the ring deep around a sound change (`wantDeep`, `deepUntil`), and the
firmware's sounds read once, their answers coming back through the engine's queue. On the Push, as a
device without Live: the engine killed with `kill -9` was back ("Ready") in 8 s, a destroyed device
left no engine; offline (`render-check`) a chord at -16 dB, no underruns. gearmulator looks for files
beside its program: the engine is started under its full path. Its log is silenced in the engine
(`Logging::setLogFunc`), as it was in the plugin.

### In Live on the Push, 2026-11-18

Loaded on a MIDI track through the Remote Script. Notes sound (-14 dB for a four-note chord), the audio
thread's part takes 0.06 to 0.6 ms a block, no late blocks while playing. SOUNDS lists six banks and a
bank's 99 names; a sound auditioned and cancelled comes back. The seven parameter pages draw with Pung's
standard pictures (filter curve, envelopes). An edit and the chosen sound survive a restart of Pung.

### Its screens (`native/nodalred/push_ui.js`)

![The panel](shots/nodalred-panel.png)

![The Nord's screens on the Push](shots/nodalred-design.png)

The Nord has no menus, its panel is the instrument, so the compartments are the panel's sections, each
with a picture of what its knobs do together:

| Compartment | The picture |
|---|---|
| Panel | the whole Push screen as the instrument's front panel, in its red: every knob where the hardware has it, standing where the sound has it; the slot display and buttons, the selectors as lit legends. A front panel; the encoders play slot, cutoff, resonance, envelope amount, mix, attack, release, portamento |
| Slots | the four slots as tiles over their on/off knobs: the sound, the waves, the filter, which are layered, which one the knobs edit |
| Oscillators | both waveforms as they are (pulse width, the interval, hard sync, FM), and their mix or ring modulation |
| Filter | the response of the chosen type, where the envelope takes the cutoff, the envelope |
| Amplifier | the envelope, and how keys are played, in words |
| Modulation | who moves what: LFO 1, LFO 2 or the arpeggiator, the mod envelope and the wheel on the left, their destinations on the right, a line as strong as the amount |
| Morph | every morph range on its own knob: the line is where the knob stands, the arc where velocity or the wheel takes it |

Every other screen carries the red as a bar at its left edge. The name on the panel is the emulator's
(Nodal Red 2X), never Clavia's.

Three things it needed:

- **`slots_info`**: one read that says all four slots (the parameters only say the edited one).
- **A selector** (`"selector": true` on `slot` in `chain_params`): turning it from Live changes what the
  other parameters read, so Pung reads them back within 60 ms (`devices.go`, `wantResync`).
- **Cached curves.** The first version took 9 ms a frame on the Push, whose processor the emulator is
  already using, and Pung switched it off (the limit is 8 ms). Every curve is now computed when what it
  shows changes: 2 to 5 ms a frame.

### One emulator at a time

2026-11-18: after a restart of Live, its recovery brought back a Set with two Nodal Red devices. Two
emulators are six threads at realtime priority wanting three cores; the Push has two. It stood still
for seven minutes, until it was switched off and on.

The module now takes a system lock (`flock` on `/dev/shm/pung-nodalred.lock`) before it starts the
emulator. An instance that finds it taken stays silent, says "Waiting: another Nodal Red 2X is running",
and starts when the other is gone. The lock also holds between Pung and the child processes that probe a
module. Checked on the Push with two instances at once: one set of emulator threads, the second started
the moment the first closed.

Rule 8 for a native module: **what cannot run twice must refuse to run twice by itself.** A Set, Live's
recovery or a duplicated track can always ask for a second one.

### A knob and the screen

Reported 2026-11-18: a turn showed on the screen with a long lag. Measured on the Push, from the turn
to the frame sent (`/api/surface/state`, `turn_to_screen_ms`): 60 to 110 ms. A CPU profile of Pung
(`/api/debug/profile`) named three causes, none of them the emulator:

| Cause | Fix | Share |
|---|---|---|
| Pung read and parsed every module's `module.json` many times a frame (`findModule`) | the list is kept while the module folders are unchanged (`scanModules`) | over half of Pung's own processor time |
| the panel drew its ground, frames and legends every frame, in JavaScript | `g.layer`: drawn once, copied after that | 26 ms a frame down to 3 |
| a frame waited for a 33 ms clock, and filling rectangles blended pixel by pixel | a 16 ms clock; solid fills written straight into the pixels | 25 ms and 5 ms |

After: 8 to 16 ms on the panel, 13 to 23 ms on the filter page. The first cause slowed every module's
view, and grew with every module installed.

### The firmware's own sounds

Program banks 4 to 9 and performance banks 1 to 3 are part of the firmware. The synth sends any of them
when asked (a dump request), so on its first start the module asks for all 890, one at a time, and writes
them into `banks/` as `ROM Programs 4.syx` and so on. In Live on the Push that took 200 seconds, with
dropouts while it ran; it happens once. A request's type is the dump's plus 14 (a program) or plus 10 (a
performance); type 20 also means "send all controllers" for slots 0 to 3, so the first four programs of
bank 5 cannot be asked for.

### Every option name, measured

The manual lists a selector's options top to bottom and the synth counts them from the bottom. Each was
checked on the Push by spectrum or pitch track: the oscillator waves, the filter types and key tracking,
the LFO 1 waves (Random, Saw, Triangle, Square, Soft Random) and destinations (PW, Filter, Osc 2, Osc 1+2,
FM), LFO 2 and the arpeggiator in one parameter (Arp Down, Arp Up, Arp Up/Down, LFO Amp, LFO Osc 1+2, Arp
Random, Echo, LFO Filter, Off), the mod envelope's destinations (Osc 2, FM, PW, None), the voice modes
(Mono, Legato, Poly). LFO 2's mode only settles when it arrives in a dump, not as a controller after an
arpeggiator mode.

### Not verified yet

- A Set saved in Live and opened again.
- The pressure and pedal destinations' names (taken from gearmulator's list).
- Turning Edit Slot on a Push encoder (the selector's read-back), by hand.
- Four slots layered at full level clip; whether the default output gain should be lower.

## Options that cannot be chosen now

A list parameter may name a key that says which of its options can be chosen at the moment:
`"available_param": "slot_available"` in its `chain_params` entry, and the module answers that key with
one character an option (`"1010"`). A turn on the Push passes over the others, so the value never shows
one of them, and the web page greys their buttons. Nodal Red 2X uses it for the edit slot: only the slots
that are on.

## OsTIrus (Access Virus TI)

gearmulator's Virus TI (`virusLib`), measured on a Push before it was built: the TI and TI2 at 2.3x real
time under load (about 77% of one core at real time), the Snow at 3.1x (about 40%). Nodal Red 2X's
foundations: the emulator on its own threads feeding a ring, 6 dB of headroom and a soft limiter, one
instance at a time (`/dev/shm/pung-ostirus.lock`).

- **One firmware, three synths.** The installer's `.bin` holds the TI, the TI2 and the Snow; `model`
  starts the emulator again as the other. Its factory banks are the banks, their names read from it.
- **A parameter is a byte of the single.** The 512-byte single (pages A, B, 6E, 6F) is the state; a
  turned knob changes its byte and sends that byte as a parameter change, so the dump is always the
  sound as it is.
- **The layout is generated, the design is not.** `tools/gen_params.py` reads gearmulator's own
  descriptions (`parameterDescriptions_TI.json`: pages, ranges, value texts) and lays them out by the
  table at its top: one page one thought, eight knobs, the same knob doing the same job on sibling pages
  (Attack knob 1 of every envelope, Rate knob 1 of every LFO). 234 parameters on 32 pages: of a single's
  563 bytes, about 300 are not for a player (arpeggiator steps, name characters, controllers).
  Names are twelve characters at most, so the encoder row shows them whole.
- **Numbers name their values.** A long value list (a send level in dB, 124 matrix destinations) is a
  number that shows its text (`value_labels` by reference into `value_lists`): an enum steps one
  option a gesture, and inline lists would not fit chain_params.
- **The front panel is the Soft Knobs.** Every TI patch points three knobs at what matters in it and
  names them; the device opens on a front panel whose first three encoders are those knobs under the
  patch's names, beside cutoff, resonance, filter envelope and the two sends. Above them the display
  and what the patch is made of: oscillator models, filter modes and routing, the effects that are on.
- **The screens draw the real wavetables** (2026-11-22). The TI's tables are in its DSP's memory after
  boot: a directory of 100 entries (two words each: the table, and where the DSP builds its waves once a
  voice plays it), found by its shape, not an address; each table a header (log2 of harmonics a wave,
  waves, a flag, a gain) and its waves as harmonic spectra, a byte a harmonic. A wave is
  sum (b_h/127)^2 (-1)^h sin(2 pi h (n+0.5)/N): sample for sample the waves the DSP builds (tables 1, 2, 4,
  9, 12, 33, 61, 92, 99; the flag-1 tables within 3%). Index i plays the crossfade at i (waves-1)/127
  (fitted from rendered notes). `read_tables()` runs in the engine after boot (patch 0002:
  `Device::getDspA()`), `wave_view_1`/`_2` hand a table to the screens (`"<waves>:<hex>"`). Not modelled:
  what Wave PWM does to the wave, the step between waves at Interpolation 127; the Classic model's
  "spectral waves", Osc 3's waves and Grain/Formant still draw a stand-in.
- **Its own process** (0.1.3, 2026-11-23): `dsp/ostirus_engine.cpp` is the emulator thread that was,
  `dsp/ostirus_shm.h` what the two share. On the Push: the engine killed with `kill -9` was back
  playing in 6 s; a model switch is a new engine; a Pung restart leaves none behind; a minute of chords
  1 underrun, 0 late blocks.
- **Not yet:** the TI's multi mode (16 parts), the vocoder and input (an instrument has no input).

## Vavra (Waldorf microQ)

gearmulator's microQ (`mqLib`): a 68000 running Waldorf's OS beside one DSP56300, about 22% of one core
on a Push. Its engine is `waldorf_engine.cpp`, shared with Xenia (the Microwave II/XT, `xtLib`, below):
OsTIrus's design, the emulator on its own thread into a ring, one instance at a
time (`/dev/shm/pung-vavra.lock`), the firmware found by gearmulator's own loader in `roms/`.

- **The OS carries no sounds.** A microQ keeps them in flash, so they come from sound sets: Waldorf's
  sysex dumps in `sounds/` (the factory set `mQ_factory2001.mid`, 300 sounds), read with gearmulator's
  MIDI file reader. A sound loads as a dump into the edit buffer, with the ring deep (as OsTIrus).
- **A parameter is bits of a byte.** 341 of them (`tools/gen_params.py` writes `dsp/mq_params.h` and the
  page lists in `push_ui.js`); a turned knob sends the whole byte, so a parameter sharing it (voice mode
  and unison, an envelope's mode and trigger, an arp step's type, glide and accent) is kept.
- **The effects reuse their bytes.** What byte 130 means depends on the effect in the slot, so the
  effect knobs are neutral (`fx1_p1`..) and a table per effect type says what each is. In Live they are
  "FX1 Param N"; the effects panel names them (`fx1_labels`, `fx1_values`).
- **The front panel is the edit matrix**, seven rows of eight, the lower buttons lighting a row
  (`draws_tabs`). Live keeps those rows, the oscillators and the mixer: Live pads every page to eight,
  so a short page costs slots.
- **Warmed up before it is heard**, as OsTIrus: the first chords after a start underran the ring while
  the emulator compiled (seven in a minute, a block of 22 ms), none after.
- **Heard without Live**: `scripts/render-check.sh vavra <assets>` loads the shipping `dsp.so` as the
  chain host does and measures a chord. Measured 2026-11-20: every bank plays, the pitches are right
  (C3 at 130.5 Hz), closing Filter 1 moves the chord from -26 to -49 dB.
- **In Live, 2026-11-20**: 128 entries in Live's list, 97 of them Vavra's (the rest "Device On" and page padding); a parameter set from Live reaches the synth; beside OsTIrus
  and Braids, all three playing, the Push 53% idle and no dropout of Vavra's own; a sound and its edits
  survive a restart of Pung.

## Xenia (Waldorf Microwave II/XT)

gearmulator's Microwave II/XT (`xtLib`): a 68000 running Waldorf's OS 2.33 beside one DSP56300, on the
engine Vavra uses (`waldorf_engine.cpp`, built with `WALDORF_XT`; one instance at a time,
`/dev/shm/pung-xenia.lock`). It boots in about 0.6 s.

- **The ROM is two halves, or one dump.** The XT keeps its wavetables and factory sounds in ROM, so an
  OS update `.mid` alone cannot run it; beside a ROM it updates it. gearmulator's loader finds the
  files in `roms/` by content: a 256 KB dump, or the two 128 KB Am29F010 halves.
- **The sounds come from the synth.** 256 factory sounds in banks A and B, asked for one by one
  (0.6 s, `fam::BANKS`). gearmulator answered bank B with bank A (`m_romSingles[_loc + 100]`;
  `patches/0003-xt-bank-b-index.patch` reads `_loc + 128`), and its 68000 printed every LCD update to
  stderr (`patches/0002`, quiet unless `PUNG_MC68K_LOG`).
- **It boots in Multi mode**, which ignores a single dump; a Single-mode dump right after boot
  (`fam::BOOT`) puts it where a sound can be loaded. It is silent while it takes a sound in, so
  `render-check` waits longer before the chord (`RENDER_SETTLE_MS`).
- **214 parameters on 32 pages** (`tools/gen_params.py` writes `dsp/xt_params.h` and the page lists in
  `push_ui.js`). An enum whose options are not its raw values in order is a `rawmap`: the XT's effect
  types are 0..7 and 32..34.
- **The screens draw the real wavetable.** The front panel and the Waves page show the sound's table as
  a landscape of its waves, the two start positions lit, the three fixed waves every table ends in
  (61..63: triangle, square, saw) beside it. The waves are the synth's: when the sound's table changes
  the engine asks for it (`F0 3E 0E 7F 03 hh ll F7`, a 64-slot table) and then for each key wave in it
  (`02`), one at a time because the XT drops a burst of requests, parsed by `xt::State`. A slot between
  two key waves is their crossfade, as the synth plays it. `get_param("wave_view")` hands the screen
  positions 0, 4 .. 60, 32 points each, as hex: `""` while the waves are coming.
- **The tables the synth computes (28..51, 64..95) are drawn too** (2026-11-22). They cannot be asked for
  over sysex, but the 68000 writes the sound's whole table (key waves, crossfades and computed waves) into
  the DSP's Y memory at 0x24000 in Single mode, 256 words a slot (128 samples, then halved copies), a
  sample in bits 16..23, the cycle starting 3 samples early. Checked: tables 0 and 5 there equal their
  sysex waves exactly; zeroing the block under a held note drops the level to 40% (it is what plays).
  The engine reads it off the audio thread (patch 0004: `Device::getXt()`) once two reads 100 ms apart
  agree and slot 61 is the exact triangle; `"algo"` only if that check fails for 3 s.
- **The effect panel names A, B and C** by the effect (Delay: Time, Feedback, Mix).
- **Heard without Live**: `RENDER_SETTLE_MS=1500 scripts/render-check.sh xenia <assets>` (`?wave_view`
  reads the table after the chord). Measured 2026-11-20: of ten sounds, nine give nine different
  chords at the right pitch and one (A50 "Tsching") is silent for a held chord; closing the cutoff
  moves the spectrum from 4883 Hz to 638 Hz; an effect type set by name reads back as itself.
- **On the Push, 2026-11-20**: every page walked with the real values; tables 0 (Resonant), 3, 5, 13,
  100 drawn from the synth's waves and 40 named as computed; beside Vavra and Tablor no dropout of its
  own (one late block a minute on all three at once); its sound survives a restart of Pung.
- **In Live, after an Apply, 2026-11-21**: Live keeps 119 of the 214 parameters (128 entries with
  "Device On" and page padding): every page up to LFO Shape, so all but the play parameters, the
  modulation matrix and the arpeggiator. **Count on a device inserted after the Apply**: the one
  inserted before it took Xenia's names but kept its old list's length (90 entries), which read as
  "89 kept" until a fresh instance showed 119. A value set in Live reaches the synth (F1 Cutoff 76, then 25), a wavetable chosen in Live brings its waves to the
  screens, and an edit in Pung shows in Live. The state round-trips with its edits (`state` read, the
  sound changed, `state` written back: the sound and its cutoff return). An Apply before Xenia could
  read its parameters had registered Pung's own 89 instead: install a ROM-needing module's ROM before
  the Apply that brings it into Live.


## Vivace (a spectral warping wavetable synth)

Not an emulator: a port of an open-source (GPLv3) software synth's engine, built unchanged from its
repository at the commit pinned in `native/catalog.json` (`deps`), with JUCE reduced to six modules (core,
events, audio_basics, data_structures, audio_formats with every codec off, dsp). The original's name
appears nowhere (its licence forbids naming a build after it); the source is credited, as GPLv3 asks, in
`licenses/NOTICE.txt` only. Its factory presets may not be shipped either: the 12 factory sounds are
Vivace's own, written by the engine at build time (`vivace-export factory`, `dsp/vivace_factory.cpp`).

- **Built for the Push only**: `-march=x86-64-v3` (AVX2), fast math. The `dsp.so` unloads cleanly
  (`-fno-gnu-unique`, `--exclude-libs`, static libstdc++).
- **The engine pattern without an emulator.** The engine renders on its own thread (`vivace`, FIFO 45)
  into a ring, 64 frames at a time, 256 kept ready, 1024 for 3 s after a miss; 6 dB of headroom and a soft
  limiter; a short block fades out and in. A second, ordinary thread (`vivace-io`) builds the engine and
  loads sounds (75 to 220 ms) while the ring plays silence: a sound change is a short gap, never an
  underrun. Knobs write the engine directly and MIDI goes through a lock-free queue: the host's calls
  never wait. LFOs follow Live's tempo and beat. **No one-instance lock**: two Vivaces run side by side.
- **The state names the sound, it does not carry it.** A sound with its wavetables is about 200 KB and
  the chain host drops a state over 16 KB (`MAX_SYNTH_STATE_LEN`): the state is the preset file the
  sound came from plus every control that differs from it (159 bytes for a typical edited sound).
- **Your own sounds**: `.vital` files (the original's JSON preset format, wavetables inside) in the
  module's `presets/` asset folder; each folder a bank in SOUNDS. A sound asking for more than 16
  voices or more than 2x oversampling is played with 16 and 2x.
- **444 parameters on 61 pages**, from the engine's own definitions: `vivace-export params` writes
  `tools/engine_params.json`, `tools/gen_params.py` turns it into `dsp/vivace_params.h` and the page list
  in `push_ui.js`. Knobs read in the synth's units (Hz, s, dB, %, cents, degrees) through 64 value lists;
  each filter's model and style are one 32-entry type list, as the synth's menu offers them. The first 15
  pages (120 parameters: Play, Osc 1-3, Sources, Filter 1-2, Env 1-3, LFO 1-2, the effects most used)
  are the ones a limited list in Live keeps.
- **Measured on a Push 3, 2026-11-22**, the engine thread's share of one logical core beside a running
  Live (2x oversampling): an init sound 9% at 8 voices, 15% at 16; a pad of 5 unison voices with a second
  oscillator 8.5% / 19% / 33% at 1 / 8 / 16 voices; the worst case (three oscillators at 16 unison, the
  sample, both filters, all nine effects) 15% / 37% / 65%, its slowest block 3.7 ms of 5.8 ms buffered, no
  underrun. About 1.6% of a core a voice plus 7%; 1x oversampling costs a fifth less.
- **In Live**: played about 6.5 minutes in three runs with nine sound changes, 0 late blocks, 0
  underruns; an edited sound returned intact after a restart of Pung.
- **Heard without Live**: `scripts/render-check.sh vivace <empty dir> 3 preset=2` (Sync Lead: peak
  -16.3 dB); all 12 factory sounds pass (peaks -3.4 to -20 dB).
