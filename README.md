# Pung

**Open · Instrument · Platform.** Pung hosts open instruments, audio effects and MIDI generators inside your
music program as native devices, and gives each one a designed interface on the hardware under your hands.

Today it runs on **Ableton Push 3 Standalone**, in Ableton Live: more than 130 modules, each a device in Live
with its automation, a playable page on the Push, and the same page in a browser. Live on the desktop is
next.

**[pung.live](https://pung.live)** has the pictures, every module, the manual and the installer.

## What the platform gives every module

- **A host.** A module becomes a device in Live: in Push's browser, on a track, saved with the Set. Modules
  run in Pung, not in Live: if one fails, Live goes on.
- **An interface in two levels.** *Pung Default* is built from a module's parameters alone: pages of eight,
  real names and units, and live pictures of the envelopes, filters and LFOs Pung recognizes. *Pung Custom*
  is a front panel in the instrument's own design language, where an instrument deserves one.
- **Modulation you can see.** Every synth shows its modulation moving, and Pung adds its own on any control:
  two LFOs, the mod wheel and pressure.
- **A governor.** It measures what every device costs and lets an emulator rest while nothing sounds, so the
  Push's processor and battery go to what plays.
- **A module pack.** Every release carries all its modules, and a Pung takes newer ones from pung.live,
  signed. Installing one is a press on the Modules page.
- **Pung's own instruments**, written for what the Push's processor can do: Nodal Red 2X (Clavia Nord
  Lead 2X), OsTIrus (Access Virus TI), Vavra (Waldorf microQ), Xenia (Waldorf Microwave II/XT) and Vivace, a
  wavetable synth. The emulators need their synth's firmware, which you bring yourself.

## Get it

The **Pung Installer** ([pung.live/deployments.html](https://pung.live/deployments.html#install); macOS,
Windows, Linux) finds your Push on your network and installs everything Pung needs. Pung is also in Push
Hack Catalog. The [Manual](https://pung.live/manual.html) has the steps and every control, with pictures.

## Read

- **[Manual](https://pung.live/manual.html)**: installing Pung, the Pung view and its controls, sounds,
  modules, the web page.
- **[Vision](https://pung.live/vision.html)**: what Pung is and where it is going.
- **[Design](https://pung.live/design.html)**: the design principles of the Pung view and of a module's own
  screens.
- **[Performance](https://pung.live/performance.html)**: the governor, and the measurements behind it.

In this repository: [docs/UX-GUIDELINES.md](docs/UX-GUIDELINES.md) (the rules behind the Design page),
[docs/overrides.md](docs/overrides.md) (a module's own screens), [docs/PRESETS.md](docs/PRESETS.md) and
[docs/SAMPLES.md](docs/SAMPLES.md) (sounds and files), [docs/NATIVE-MODULES.md](docs/NATIVE-MODULES.md)
(Pung's own instruments), [docs/GOVERNOR.md](docs/GOVERNOR.md) (what devices cost),
[docs/SET-CONTRACT.md](docs/SET-CONTRACT.md) (a Set that opens the same on every Pung),
[docs/PUNG-MACOS.md](docs/PUNG-MACOS.md) (Pung in Live on a Mac: a design and its proof) and
[docs/DESIGN-v2.md](docs/DESIGN-v2.md) (how Pung is built).

## Develop

Pung is open, and every module on it is somebody's work. [pung.live/develop.html](https://pung.live/develop.html)
is the way in.

- **A module** is a small folder: a description, a compiled sound engine, what it needs beside it. Pung
  plays open modules in the Schwung module format, which began on Ableton Move, so one module can run on
  both.
- **Its interface** is one file, `push_ui.js`: from the instrument's own colours on Pung's pages up to a
  front panel with its sections under your hands ([docs/overrides.md](docs/overrides.md)).
- **Skills for your AI assistant** are in [`skills/`](skills/): what an assistant needs to know to design an
  interface (`pung-interface`) or to make, port and check a module (`pung-module`). Opened with Claude Code,
  this repository has them in place.
- **One module, built and heard without a Push**: `scripts/dev-module.sh <the module's working copy>`, then
  `scripts/render-check.sh` ([docs/push-module-builds.md](docs/push-module-builds.md)).

Pull requests are welcome. A module keeps its own licence and its author's name. No firmware, ROMs or factory
sounds that are not yours to give, in a module, a package or a pull request.

## Build from source

On a Mac or Linux computer with Docker; nothing else is installed.

```sh
make image                    # the builder (Ubuntu 22.04: the Push's glibc)
make build                    # Pung, and the plugin Live loads
make test
make deploy HOST=<push-ip>    # copies it to the Push and restarts Pung, not Live
```

`make modules` builds the host that plays a device's modules, from Schwung's source (`SCHWUNG=<its folder>`).
On the Push, Pung is a hack for Push Hack and needs its push-manager and push-display. `macos/` builds the
proof for Live on a Mac. [CLAUDE.md](CLAUDE.md) is the working memory of the project: the commands that work
and the mistakes not to repeat.

## How it is built

- **`src/`** is Pung: one service (Go) that plays every device's modules and draws the Push view, the web
  page and the pictures.
- **Live loads one plugin**, which hands each device's audio and parameters to Pung. A module never runs
  inside Live.
- **Each device renders on a realtime thread of its own.** A call into a module that does not return
  restarts Pung and brings the sounds back; a module that hangs twice is refused.
- **Emulators run in processes of their own**, and rest in silence.
- **A parameter keeps its place**, so automation in a saved Set stays on its control.

## Standing on

Pung is built on open work, and says so:

- **[Schwung](https://github.com/charlesvestal/schwung)** by Charles Vestal: the module format Pung plays,
  which most of its modules were written for, and the host that plays a chain of modules.
- **[Push Hack](https://github.com/federico-pepe/ableton-push-hack)**: what lets a program like Pung run on a
  Push, and the plugin layer Live loads.
- **[gearmulator](https://github.com/dsp56300/gearmulator)**: the emulation Pung's hardware instruments are
  built on.

Each module is the work of its author and keeps its licence. Pung is not made, approved or supported by
Ableton. Ableton, Push, Move and Live are trademarks of Ableton AG.

## License

MIT. `src/third_party/schwung` (the plugin API header) and `src/web/static/schwung-remote-api.js` are from
Schwung, MIT, Copyright (c) 2025-2026 Charles Vestal. Modules keep their own licenses, which ship with them.
