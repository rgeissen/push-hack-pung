# Pung for Push 3

Pung runs [Schwung](https://github.com/charlesvestal/schwung) modules on Ableton Push 3 Standalone.
Schwung is the module system of Ableton Move: synths, audio effects and MIDI effects, each a small native
plugin. Pung runs those plugins on Push as devices in Live, with a native Push interface, the modules' own
web pages, and room for modules to draw their own pictures on the Push screen.

It is a hack for [Push Hack](https://github.com/federico-pepe/ableton-push-hack). It is not made, approved or
supported by Ableton.

## Read more

Three pages go with this repository, with pictures of every screen:

- **[Manual](https://rgeissen.github.io/push-hack-pung/manual.html)** ([as a Claude artifact](https://claude.ai/artifact/BJ47JjYFTh39t4RKWkNtEY)): installing Pung, the Pung view and its
  controls, sounds, the web page, troubleshooting.
- **[Vision](https://rgeissen.github.io/push-hack-pung/)** ([as a Claude artifact](https://claude.ai/artifact/UXRfdHMtyVs9HqevVoNqt1)): what Pung is, how it runs Schwung modules
  as Live devices, and where it is going.
- **[Design](https://rgeissen.github.io/push-hack-pung/design.html)** ([as a Claude artifact](https://claude.ai/artifact/CrRQBoVwhvpgoJpTZpHeC2)): the design principles of the Pung view
  and of a module's own screens, for module authors.

In this repository: [docs/UX-GUIDELINES.md](docs/UX-GUIDELINES.md) (the rules behind the Design page),
[docs/overrides.md](docs/overrides.md) (a module's own Push screens), [docs/PRESETS.md](docs/PRESETS.md)
(sounds) and [docs/DESIGN.md](docs/DESIGN.md) (how Pung is built).

## Pung devices in Live

Every Schwung module is a device in Live, on Push Hack's Live device layer
([`core/livedevice`](https://github.com/federico-pepe/ableton-push-hack/blob/main/docs/live-devices.md)):

- **Push's browser** lists them in the User Library, under *Presets*: *Instruments/Pung* (Braids, OB-Xd, Dexed, Hera, ...), *Audio
  Effects/Pung* (CloudSeed, MVerb, OTTx, ...) and *Instruments/Pung MIDI Effects* (Arpeggiator,
  Chord).
- **The Pung view takes the place of Push's device view.** Select a Pung device with Push in its
  device view and the Pung screen opens by itself (Push Hack Home's device view, push-manager). Device
  View in it shows Push's own device view of the device, and pressed again brings the Pung view back;
  Mixer, Clip, Session, Add, Settings and Set go on to Push. As on Push's device view, the lower row shows
  Live's tracks and the left and right arrows step through them: a track with a Pung device stays in the
  Pung view, any other shows Push's own device view. To keep Push's device view instead, switch it off
  in Push Hack Home (Shift + Help, choose PUNG, lower button 3 `DEVICE`) or on push-manager's Display →
  Tabs page.
- **Push's own device view** edits them too. Bank N on Push is the module's own bank N (press the device's
  button above the screen to see the banks). The pads play them, and Live saves them with the Set.
- **MIDI effects**: every Pung instrument has a **MIDI FX** selector (Arpeggiator, Chord) in front of
  its synth. To play another instrument (Live's own too), put "Chord Track" on a track of its own
  and set the other track's *MIDI From* to it. Live on Push has no slot for a MIDI-effect plugin.
- The modules run in this hack, not in Live. If a module crashes, Live goes on.

Needs Push Hack's VST3 scan switched on (Push Manager, System tab). The hack installs the plugin
(`/data/.vst3/Pung.vst3`, with its class file inside) and the browser entries when it starts; Live sees
new modules after its next start. Removing the hack with Push Hack Catalog removes the browser entries and
keeps the plugin, so Sets with Pung devices still open (the devices are silent).

Build: `src/go.mod` pins push-hack's `core` at `v0.6.0`, the first release with `core/livedevice`. `make build`
copies the plugin binary from that module.

## Pung tracks (version 1)

- **Pung tracks.** One Pung track is one signal chain: up to 8 MIDI effects, one instrument, up to 8
  audio effects (the same limits as on Move: it is the same chain). Each Pung track plays on its own
  Live track. There are 4 to start with, and up to 16 (one per MIDI channel).
- **Schwung's own chain host.** The chain is the same code Move runs (`modules/chain`), built for the Push.
  Patches, module state and the parameter keys (`synth:cutoff`, `fx1:mix`) are the same as on Move, so a
  track's chain saved here is a Pung patch.
- **A native Push interface.** An app of Push Hack Home (Shift + Help, then PUNG).
- **The web page** (`http://push.local:7720`, or the port Push Hack Catalog gives it): every track, every
  module, and a module's own `web_ui.html` unchanged.
- **Module pictures on the Push.** A module, or an overlay for it, can draw its own widgets (`push_ui.js`).

## Play a Pung track from Live

Do this once, in Live's settings on the Push:

1. MIDI: select **PushHack** in a control-surface slot (the PushHack Remote Script, part of Push Hack).
2. MIDI: for the output port **Pung**, turn on **Track**. Turn on **Sync** too, so arpeggiators and
   synced LFOs follow Live's clock.
3. Turn on **Link** and **Link Audio**.

Then, for each Pung track:

- The MIDI track: on the Push, open Pung and press **New**, or press **Make Live MIDI track** on the web
  page. Pung asks Live for a MIDI track named "Pung N" that sends to port **Pung**, channel N
  (channel 1 is Pung track 1).
- The audio return: make it by hand. An audio track with the input **PushHack**, channel **Pung N**,
  Monitor **In**. Pung does not make it for you: on Live 13.0b25, Live crashed when the Remote Script made
  this track (see [docs/DESIGN.md](docs/DESIGN.md)).

Select the MIDI track and play the pads. Live's scales, layouts, clips and Note Repeat all work, because the
notes come from Live. When you select a track that sends to Pung, Pung's Push screen follows to that
Pung track.

## The Push interface

It works as Push 3's own device view does, measured on a Push (standalone): the same two levels, the
same buttons. A hand that knows Push knows Pung.

| | Upper display buttons | Lower display buttons |
|---|---|---|
| **Chain level** | the track's devices, the selected one filled, then `+` (add a device: Push's own browser); an arrow at an end when there are more than fit | Live's tracks |
| **Device open** | button 1 goes back (`< NAME`); button 8 is `SOUNDS` | the device's pages, the shown one filled; an arrow when there are more |

| Control | In Pung, as on Push |
|---|---|
| A device's upper button | selects it; the selected one's opens and closes it |
| Jog wheel, chain level | moves a focus along the devices and `+`; its press opens the focused one |
| Jog wheel, device open | steps through the pages; a nudge left goes back |
| Encoders | the 8 parameters above them, at both levels. Touch one to see its range. |
| Shift + turn | fine adjustment |
| Delete + touch an encoder | the parameter back to its default |
| Mute + a device's button | the device off and on (its parameters grey out) |
| Delete + a device's button | remove the device |
| Mute / Solo + a track's button | that track |
| D-pad left / right | the previous / next track |
| Device View | Push's own device view of the device, and back |
| Mix, Clip, Session, Add, Settings, Set | go on to Push |
| Pads, Play, Record, scales, octave ... | Live's, untouched |

Pung's own, where Push has nothing:

| Control | In Pung |
|---|---|
| Upper button 8, device open (`SOUNDS`) | the sound browser: the device's own sounds, yours, favourites and recent ones |
| Jog press, device open | the sound browser, too |
| The encoder of a sample's cell | the file browser (`docs/SAMPLES.md`): your User Library, Live's Core Library and Packs, Sets, recordings, favourites; a file plays where the cursor rests and is loaded only on Load |
| Save | save the device's sound |
| Page < > | the previous / next page (a shortcut; Push's way is the jog wheel) |

**Add and Swap are Push's own**, in Pung's view as everywhere: Add opens Push's browser, and Swap is Push's
Hot-Swap, which can replace the device itself (one Pung device with another, for example). Pung never
takes them.

A module's full-screen picture (Mini-JV's Macros, Dexed's Algorithm) shows while its device is open. The
back button, `SOUNDS` and the page row are drawn over it when you open the device, turn a page or touch
the jog wheel.

## Install and update

Pung is in Push Hack Catalog: open `http://push.local:7702`, choose **Pung** and **Install**, then restart
the Push once so Live finds the new devices. Updates arrive the same way. The
[Manual](https://rgeissen.github.io/push-hack-pung/manual.html#install) has the steps with pictures.

To build it yourself, on a Mac or Linux computer with Docker:

```sh
make image            # the builder (Ubuntu 22.04: the same glibc as the Push)
make modules          # Schwung's chain host and built-in modules (needs ../schwung)
make catalog-modules  # catalog modules, from their source (MODSRC=folder of module repos)
make test
make deploy HOST=push.local
```

`make deploy` copies the files to `/data/push-hack/hacks/pung` and installs the service
`push-hack-pung` the way Push Hack Catalog does. Pung needs **push-manager** and
**push-display** (Push Hack 0.2.0-alpha or newer) for the Push screen. Its devices in Live carry their
audio through Live; **push-audio-loopback** is needed only for a chain opened through the API.

### Releases: the modules come with Pung

A release (`scripts/release.sh`, after `make build`) is one file, `pung.tar.gz`, in Push Hack Catalog's
layout, with the module catalog inside it: `catalog/catalog.json` and every package it lists (82 MB for
107 modules in 0.4.4). The Modules page installs from that copy, from the Push's own disk: nothing is downloaded
from anywhere, and a new Pung release brings the new module versions. Firmware for the emulators (JV-880,
Osirus, JE-8086, Nodal Red 2X, OsTIrus, Vavra, Xenia) is never in it: you add it yourself on the Modules page, as before. A catalog address set in Pung's settings
(`catalog_url`) still wins over the bundled one; without either, Pung reads no catalog from the web.

The modules' sources are this repository's `sources` release, one archive per build, and each module's
entry in the catalog links its own. `scripts/release.sh --publish` uploads the sources it does not find
there first, then `pung.tar.gz` as the release `v<version>`, then commits `release.json`.

### Modules

Move's modules are built for ARM. The Push is x86_64, so every module is built again from its source.
`scripts/build-catalog.sh` has one recipe per module: the compile line of the module's own build script,
without the ARM flags. Only the compiler reads the module's source; no script from a module repository runs.

Built and checked on a Push (2026-11-14): Braids, OB-Xd, Dexed, Hera, Line In (synths); CloudSeed, TapeDelay,
Junologue Chorus, MVerb, OTTx, Ducker, TAPESCAM, PSX Verb, Freeverb (audio FX); Arp, Chord (MIDI FX).

## Module pictures on the Push

See [docs/overrides.md](docs/overrides.md). An example is [overrides/braids/push_ui.js](overrides/braids/push_ui.js):
Braids' envelopes drawn as envelopes.

## How it works

- **One process.** A realtime render thread (SCHED_FIFO) renders every Pung track in Schwung's
  128-frame blocks and writes each to the audio bus (`core/audiobus`). Each is its own Link Audio channel.
- **The chain lock.** Every call into a chain holds that chain's lock for one call. The render thread waits
  out short calls and skips a chain that is loading a module, so a module load never stalls the others.
  After a load, two blocks are rendered on the control thread: some modules do slow setup in their first
  block (Hera: 8 ms).
- **MIDI.** One port, **Pung**: a channel message goes to the Pung track of its channel. Live's
  clock on that port is fanned out to every track. Without it, Live's tempo and beat come from the Remote Script.
- **The host API.** `host_api_v1_t` is Schwung's own header, vendored. Modules that read Move's audio input
  from the SPI mailbox get a mailbox with Move's layout, filled with the track's audio input.
- **State.** Each Pung track is saved as `slots/slot_N.json` in `/data/push-hack/data/pung`. "Slot" is
  Schwung's own word for a track's chain, and the file is in Schwung's slot format, so it loads on Move too.
  The HTTP API (`/api/slots/N`) keeps that word.

## Known limits

- Overtake modules (those that take over Move's whole surface) do not run yet. They need a Move
  compatibility runtime (QuickJS, Move's MIDI map, the 128 x 64 screen). See [docs/DESIGN.md](docs/DESIGN.md).
- Modules render at 44.1 kHz. If Live runs at another rate, pitch and tempo are off (the log says so).
- A Pung track's state is global, not per Live Set.
- Master FX and send buses are not here: Live's mixer does that job.

## License

MIT. `src/third_party/schwung` (the plugin API header) and `src/web/static/schwung-remote-api.js` are from
Schwung, MIT, Copyright (c) 2025-2026 Charles Vestal. Modules keep their own licenses, which ship with them.
