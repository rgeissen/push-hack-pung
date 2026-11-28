---
name: pung-module
description: Make, port, review or package an instrument, audio effect or MIDI generator module for Pung on an Ableton Push 3 - the open Schwung module format (module.json, the DSP plugin's C interface, chain_params, ui_hierarchy, state), building one module for the Push (x86_64, glibc 2.35), checking what it answers and how it sounds without a Push, and what a module needs to be offered in Pung's module pack. Use when asked to write a new Pung module, bring an existing synth or effect to Pung, review a module, fix its build for the Push, or prepare it for the pack.
---

# A module for Pung

Pung runs open modules as devices in Ableton Live on a Push 3 Standalone. A module is one instrument,
audio effect or MIDI generator: a folder with a description (`module.json`), a compiled DSP plugin and
whatever it needs beside it (sounds, licence texts). Pung plays the Schwung module format, which began
on Ableton Move, so one module can run on both.

The Push is an x86_64 computer with glibc 2.35. A module built for Move (ARM) has to be built again;
its source usually needs no change.

## Read first

- The format is Schwung's and is documented there: https://github.com/charlesvestal/schwung, `docs/`.
  What counts for Pung: in `MODULES.md` the parts on `module.json`, the plugin's functions for each
  kind of module, parameters and state; `PARAM_PAGES.md`; `REALTIME_SAFETY.md`. What does not: Move's
  own interface (`ui.js`, `ui_chain.js`, the shadow UI, overtake modules, LEDs). Those files travel in
  a package and Pung does not run them: on Pung a module's interface is its parameters and, where it
  has one, a `push_ui.js` (the `pung-interface` skill).
- `references/push-module-builds.md`: how Pung builds a module for the Push, what the check refuses,
  the known limits (hard-coded Move paths among them).
- `references/plugin_api_v1.h`: the plugin interface Pung's host is built with (v1, and the
  instance-based v2 that modules should use). A module that carries its own copy of this header is
  compiled with its own.

The references are copies of documents in Pung's repository (`docs/`); where they cite another document
or a source file, it is there: https://github.com/rgeissen/push-hack-pung

## What a module is

- **`module.json`**: `id`, `name`, `abbrev`, `version`, `description`, `author`, `dsp` (the plugin
  file), `api_version` (2), and `capabilities` with `component_type`: `sound_generator`, `audio_fx` or
  `midi_fx`. Optional `assets`: what the player brings (each an object: `path` inside the module's
  folder, `label`, `extensions`, `description`, `optional`).
- **The plugin** exports one entry point: `move_plugin_init_v2` (an instrument),
  `move_audio_fx_init_v2` (an audio effect) or `move_midi_fx_init` (a MIDI generator). Schwung's
  `MODULES.md` gives each kind's functions and file name. An instrument's are `create_instance`,
  `destroy_instance`, `on_midi`, `set_param`, `get_param`, `get_error`, `render_block` (interleaved
  16-bit stereo, 44.1 kHz). Every instance is independent: nothing two instances would share.
- **Its parameters** are what reaches Pung as `chain_params`: a list of
  `{key, name, type, min, max, step, default, unit, options, short}`. Pung asks through Schwung's chain
  host: it gets the plugin's own `get_param("chain_params")`, and where the plugin answers none, the
  parameter objects of `module.json`'s `ui_hierarchy`. **Its pages** are `ui_hierarchy`'s levels. Pung
  builds the whole Push page, the web page and the device in Live from these two, so they are the
  module's interface:

  ```json
  [{"key":"time","name":"Time","type":"int","min":20,"max":2000,"step":1,"unit":"ms"},
   {"key":"division","name":"Division","type":"enum","options":["free","1/4","1/8"],"default":0},
   {"key":"feedback","name":"Feedback","type":"float","min":0,"max":1,"step":0.01}]
  ```
  ```json
  {"levels":{"root":{"name":"TapeDelay","knobs":["time","division","feedback"],
    "params":[{"key":"time","label":"Time","type":"int","min":20,"max":2000,"unit":"ms"}, "..."]}}}
  ```
- **State**: `get_param("state")` and `set_param("state", ...)` carry everything a Live Set must bring
  back. What is not in the state is lost when the Set is reopened.

## What makes it good on Pung

- **Real names, real ranges, units.** Put `unit` on the parameter in `chain_params` (Pung shows it;
  a unit that stands only in `ui_hierarchy` is not shown). A number that is not in its unit (0..1
  meant as percent, a log of seconds) reads right only if the module answers it so, or its screen file
  says how it reads. Enum options by name.
- **Pages of up to eight that belong together**, the most played controls first, every key on some
  page. Pung makes pages of leftovers for keys no page names.
- **One key for one control.** Two keys that set the same thing fight in the state: whichever is
  restored last wins.
- **A key never changes its name or its meaning** between versions: Sets, automation and saved sounds
  name it. New parameters are added at the end; old ones stay.
- **Every call can hold up the sound.** Pung makes all calls into an instance one after another, under
  one lock with the audio block: while a `set_param` or `get_param` runs, `render_block` waits, and a
  block that waits too long is a dropout. So no file access, no allocation of size, no waiting in any
  of them; a sound that must be read from disk is read on a thread of the module's own and handed
  over. `render_block` itself: no allocation, no lock held by a slow thread, no logging.
- **Values asked every frame are cheap**: `live_mod` and any `live_keys` are read 30 times a second.
- **Show the modulation.** A synth answers `get_param("live_mod")` with the controls its modulation
  moves and where the sound has each now (`{}` at rest); Pung then draws it moving on every page. With
  `mod_map` and `mod_set` Pung's ASSIGN screen edits the module's own routes. The exact shapes are in
  the `pung-interface` skill, in its document `overrides.md` under *Values*.
- **No firmware, ROMs or factory sounds that are not yours to give**, in the module or its repository.
  An emulator names what the player must bring (`assets`) and reads it from there.
- **A licence that allows shipping**: its text as a file in the repository (Pung's pack reads the
  file and withholds a module without one), and what the code derives from, said in the description.

## Building for the Push

In a clone of Pung (https://github.com/rgeissen/push-hack-pung), with Docker, and Schwung's source for
the host headers beside that clone (`git clone --depth 1 https://github.com/charlesvestal/schwung` as
`../schwung`, or anywhere with `SCHWUNG=<its folder>` set for every command below):

```sh
scripts/dev-module.sh <the module's working copy> [id]
```

It builds that one module and nothing else: reads its `module.json`, derives a compile recipe from the
module's own build script, compiles in a container with no network, and checks the result as every
module of Pung's pack is checked. It ends with `checked:` (every binary x86_64, glibc 2.35 or older,
loads as Pung's host loads it), `built:` (the installed folder, `build/dev/out/modules/<type>/<id>/`)
and `package:`. `[id]` says which module when the working copy holds several.

- A module's own build script is **read, never run**. The recipe that was read is
  `build/dev/recipes/<id>.sh`: look at it when something is missing from the result (a folder the
  script only creates, a file it renames). Where no recipe can be read (a library fetched at build
  time, a generated header, CMake in a subfolder, Rust), write `scripts/recipes/<id>.sh` by hand; it
  wins. `references/push-module-builds.md` has the cases.
- The build has **no network**: what a module downloads while building is fetched beforehand into
  `build/deps`.
- Refused by the check: fix the build, never the check.
- A working copy that is not a git repository builds, and its package names no commit. The pack needs
  one: commit before offering it.

## What it answers, and how it sounds, without a Push

```sh
mkdir -p /tmp/empty
RENDER_MODULES=build/dev/out/modules scripts/render-check.sh <id> /tmp/empty 2
```

loads a built instrument's plugin as Pung's host does, plays a chord for two seconds and prints its
peak and RMS, then `PASS` (it sounded) and where the sound is kept (`build/dev/out/<id>-render-check.wav`).
Read the peak: 0 dB is clipping. `status: (no status)` and an empty `engine:` line are normal for a
module that reports neither. The folder is for what the module's `assets` ask of the player.

More arguments ask and set, in order, around the chord:

```sh
... render-check.sh <id> /tmp/empty 1 '?chain_params' '?ui_hierarchy' '?live_mod' '?state'
... render-check.sh <id> /tmp/empty 1 cutoff=0.3 transpose=7 '?state'      # then save what it printed
... render-check.sh <id> /tmp/empty 1 state=@saved-state.json '?cutoff' '?transpose'
```

- `'?key'` prints the plugin's own answer (quote it). An empty `chain_params` here means the module
  leaves its parameters to `module.json`.
- **Do the state round trip**: set a few values, take the state, give it back to a fresh instance
  (`key=@file`), and ask the values again. Every one must come back. This finds what a reopened Set
  would lose.
- It plays notes into a sound generator; it does not exercise an audio effect or a MIDI generator.

## Is it already in Pung?

Look before treating a module as new: `src/registry.json` (its parameters' places),
`src/ableton-tags.json`, `overrides/<id>/push_ui.js` (a screen Pung ships for it) and
`scripts/local-sources.json` (built from a fork). If the id is there, this is an update: its keys must
stay, a new parameter needs its place in the registry, and its version must differ from the one in the
pack (a fork's build carries a fourth number).

## On a Push

- Reach it: `ssh root@<the Push's address>`, once your key is on the Push (its page
  `http://push.local/ssh`, confirmed on the Push with Shift + Select + Preferences).
- Copy the built folder to `/data/push-hack/hacks/pung/modules/<sound_generators|audio_fx|midi_fx>/<id>/`.
  That replaces a module of the same id. A loaded plugin file is never overwritten in place: copy it
  as `<file>.new`, then `mv`. Restart Pung (`/etc/init.d/push-hack-pung restart`).
- A module that is new becomes a device in Live only when Live has started again; that interrupts the
  player's Set, so it is theirs to do.
- Play it as a device, walk its pages in Pung's view, save the Set and open it again: the sound must
  come back as it was.

## Offering it in Pung's module pack

Yours to bring: the source public at a commit, a licence text that allows shipping, a version that
changes whenever the package changes, the checks above passed, and what you could not verify.
The maintainers' part, with you: its Ableton browser tags, its place in the parameter registry (so a
Set keeps its automation on every Pung), and playing it once as a device in Live on a Push. Open a
pull request or an issue in Pung's repository.

## When you hand it over

Say what you built and from which commit, what the build printed after `checked:`, the render check's
peak and RMS, the result of the state round trip, and what was not verified on a Push.
