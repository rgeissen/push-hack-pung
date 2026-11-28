---
name: pung-module
description: Make, port or package an instrument, audio effect or MIDI generator module for Pung on an Ableton Push 3 - the open Schwung module format (module.json, the DSP plugin's C interface, chain_params and ui_hierarchy), building for the Push (x86_64, glibc 2.35), checking that it loads and sounds without a Push, and what a module needs to be offered in Pung's module pack. Use when asked to write a new Pung module, bring an existing synth or effect to Pung, fix a module's build for the Push, or prepare one for the pack.
---

# A module for Pung

Pung runs open modules as devices in Ableton Live on a Push 3 Standalone. A module is one instrument,
audio effect or MIDI generator: a folder with a description (`module.json`), a compiled DSP plugin
(`dsp.so`) and whatever it needs beside it (sounds, licence texts). Pung plays the Schwung module
format, which began on Ableton Move, so one module can run on both.

The Push is an x86_64 computer with glibc 2.35. A module built for Move (ARM) has to be built again;
its source usually needs no change.

## Read first

- The format itself is Schwung's and is documented there:
  https://github.com/charlesvestal/schwung (`docs/MODULES.md`, `docs/API.md`, `docs/PARAM_PAGES.md`,
  `docs/REALTIME_SAFETY.md`). Read these before writing a plugin; do not reconstruct the interface from
  memory.
- `references/push-module-builds.md`: how Pung builds a module for the Push, what the packaging step
  refuses, and the known limits.
- `references/plugin_api_v1.h`: the plugin interface as Pung's host has it (v1 and the instance-based
  v2 that modules should use).
- For the module's look on the Push, use the `pung-interface` skill.

The references are copies of documents in Pung's repository (`docs/`); where they cite another document
or a source file, it is there: https://github.com/rgeissen/push-hack-pung

## What a module is

- **`module.json`**: `id`, `name`, `abbrev`, `version`, `description`, `author`, `license`, `dsp`
  (the plugin file), `api_version` (2), and `capabilities`: `component_type` (`sound_generator`,
  `audio_fx` or `midi_fx`), `audio_in`, `audio_out`, `midi_in`, `midi_out`, `chainable`. Optional
  `assets`: folders the player fills (samples, their own sound files).
- **The plugin** exports `move_plugin_init_v2` and answers with its functions: `create_instance`,
  `destroy_instance`, `on_midi`, `set_param`, `get_param`, `get_error`, `render_block` (interleaved
  16-bit stereo, 44.1 kHz). Every instance is independent: no globals that two instances would share.
- **Its parameters** are what `get_param("chain_params")` answers (each key with its name, type and
  range) and its pages what `get_param("ui_hierarchy")` answers. Pung builds the whole Push page, the
  web page and the device in Live from these two, so their quality is the module's interface:
  real names, real ranges and units, enum options by name, pages of eight that belong together, the
  most played controls on the first pages.
- **State**: `get_param("state")` and `set_param("state", ...)` carry everything a Live Set must bring
  back (Schwung's `docs/MODULES.md` says how). What is not in the state is lost when the Set is
  reopened.

## Rules that decide whether it plays well

- **`render_block` is realtime.** No allocation, no file access, no lock that another thread can hold
  for long, no logging. Load and compute elsewhere and hand over.
- **`get_param` for live values is asked 30 times a second** (levels, an LFO's phase, `live_mod`): keep
  those answers cheap and lock-free.
- **Show the modulation.** A synth answers `get_param("live_mod")` with the controls its modulation
  moves and where the sound has each now; Pung then draws it moving on every page. With `mod_map` and
  `mod_set` Pung's ASSIGN screen can edit the module's own modulation routes. (The exact shapes are in
  the `pung-interface` skill's reference, `overrides.md`, under *Values*.)
- **A parameter never changes its key or its meaning** between versions: Sets and saved sounds name it.
  New parameters are added; old ones stay.
- **No firmware, ROMs or factory sounds that are not yours to give** in the module or its repository.
  An emulator names what the player must bring, and reads it from the player's own folder.
- **A licence that allows shipping**, stated in `module.json` and as a text in the folder. Most modules
  are GPL; say what the code is derived from.

## Building for the Push

In a clone of Pung (https://github.com/rgeissen/push-hack-pung), with Docker, and Schwung's source
beside it for the host headers (`git clone https://github.com/charlesvestal/schwung ../schwung`, or
`SCHWUNG=<its folder>`):

```sh
scripts/dev-module.sh <the module's working copy> [id]
```

It builds that one module and nothing else: reads the module's `module.json`, derives a compile recipe
from the module's own build script, compiles in a container with no network, and checks the result as
every module of Pung's pack is checked. The first run builds the builder image, which takes a while.
Out: `build/dev/out/modules/<type>/<id>/` (the installed folder) and `build/dev/out/dist/` (a package).
`[id]` says which module when the working copy holds several.

- A module's own build script is **read, never run**. The recipe that was read is
  `build/dev/recipes/<id>.sh`: look at it when something is missing from the result. When a recipe
  cannot be read from the script (a library fetched at build time, a generated header, CMake in a
  subfolder, Rust), write a hand recipe `scripts/recipes/<id>.sh`; it wins, and its header says why it
  exists. `references/push-module-builds.md` lists the cases and the helpers.
- The build has **no network**: what a module downloads while building must be fetched beforehand
  into `build/deps` (`scripts/fetch-deps.sh` is how Pung pins such things).
- When the build fails, the script prints the end of `build/dev/out/logs/<id>.log`.
- The check refuses a module whose binary is not x86_64, needs a glibc newer than 2.35, or does not
  load the way Pung's host loads it (every symbol resolved, the entry point exported). Fix the build,
  never the check.

## Hearing it without a Push

```sh
mkdir -p /tmp/empty
RENDER_MODULES=build/dev/out/modules scripts/render-check.sh <id> <assets folder> [seconds] [key=value ...]
```

loads a built instrument's `dsp.so` as Pung's host does, plays a chord, reports peak and RMS, says
PASS, and keeps the sound as `build/dev/out/<id>-render-check.wav`. The assets folder holds what the
module expects its player to bring (an empty folder if nothing). Silence, a crash or a clipped peak
here will be the same on the Push. A value with a space breaks the arguments: use a number. It plays
notes into a sound generator; it does not exercise an audio effect or a MIDI generator.

## On a Push

- Copy the module folder to the Push: `/data/push-hack/hacks/pung/modules/<sound_generators|audio_fx|midi_fx>/<id>/`.
  A `.so` that is loaded is never overwritten in place: copy it as `<file>.new`, then `mv`. Restart Pung
  (`/etc/init.d/push-hack-pung restart`). A new module becomes a device in Live
  only after Live restarts: ask the player first, it interrupts their Set.
- Play it as a device in Live, walk its pages in Pung's view, save the Set and open it again: the
  sound must come back as it was.

## Offering it in Pung's module pack

Open a pull request against Pung's repository, or ask there. A module in the pack needs: its source
public with its licence, a version that changes whenever its package changes, its Ableton browser
tags, a place in the parameter registry (so a Set keeps its automation on every Pung), and to have
been played once as a device in Live on a Push. The maintainers do the last three with you.

## When you hand it over

Say what you built and from which commit, what the checks reported (the packaging step, the render
check's peak and RMS), and what was not verified on a Push.
