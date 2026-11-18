# Pung-native modules

Status: 2026-11-18. The first one, Nodal Red 2X, builds, packages and loads in Pung's host. It has not
made a sound yet: that needs a Nord Lead 2X firmware, which was not at hand. It is not in the published
catalog.

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
2. **Set the priority of your own threads.** Below the host's audio threads (FIFO 70) and the engine
   (60), above ordinary work. Nodal Red: FIFO 45, set on the thread that creates the emulator's threads,
   so they inherit it.
3. **Keep `dsp.so` unloadable:** `-fno-gnu-unique`, `-Wl,--exclude-libs,ALL`, static libstdc++.
4. **No firmware in the package.** ROMs are the user's; `module.json` `assets` says which files.
5. **Ship every licence text** of what is linked in, in `licenses/`.

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
- **Sounds:** the emulated synth has none of its own. `banks/*.syx` (and `.mid`) are read at start; each
  file is a bank, each program or performance dump in it a sound. A program loads into the edited slot, a
  performance replaces all four.
- **Incoming controllers** other than the wheel, the pedals and all-notes-off are dropped: every other
  controller is a knob of the synth and would change the sound behind the parameters.

### Not verified, for want of the firmware

- Any sound at all, and the CPU load on the Push.
- The option names of the enums (filter types, LFO waves and destinations, voice modes): written from the
  Nord Lead 2 documentation as remembered, to be checked by ear.
- Whether the firmware takes an edit-buffer dump as sent here in every mode.
- Boot time, and the ring's 7 ms against real block times.
