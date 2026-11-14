# Schwung on Push 3, version 2: every module is a Live device

Status: design, 2026-11-14. Replaces the track engine of version 1 (`DESIGN.md`) as the core. Nothing here
is built yet; the spikes at the end come first.

## The idea in one paragraph

On Move, Schwung has to bring its own signal graph, because Move's firmware has none to offer: 4 tracks,
one chain each. On Push, the best signal graph on the device is Live. So Schwung on Push does not build a
graph. It makes every Schwung module a **Live device** (a VST3 plugin), and runs the module itself in a
**separate Schwung process**, so a module can never take Live down. Live does what it does best: tracks,
racks, parallel chains, sends, sidechains, automation, clip envelopes, modulation, MPE, latency
compensation, freezing, saving with the Set, Push's own device view and browser. Schwung does what only it
can do: run Move's modules faithfully, and show them well.

## The user's view: nothing new to learn

The user works with Push's own interface. Schwung modules are found in **Push's browser**, sorted like
every other device, loaded like every other device, and edited in **Push's device view** with the encoders.
Schwung's own screen and web page are extras, never a door the user must go through.

| In Push's browser | What it is |
|---|---|
| Schwung instruments | one VST3 instrument per sound generator (Braids, OB-Xd, Dexed, Hera, ...) |
| Schwung audio effects | one VST3 effect per audio FX (CloudSeed, MVerb, OTTx, ...) |
| Schwung MIDI effects | inside every Schwung instrument (its "MIDI FX" selector), or on their own track ("Schwung Chord Track") for any track to take with MIDI From |

Push's browser does not list plugins themselves (push-hack, Live 12.4). It lists presets and racks in the
User Library, so Schwung writes one browser entry per module (a preset or rack file wrapping it), named
and filed by kind. Where exactly Push files each kind is checked in spike 1.

**MIDI effects: Live 13 has no slot for them** (asked for 2026-11-14, measured the same day). A
MIDI-in/MIDI-out VST3 with no audio is filed by Live 13.0b25's scan as an *audio effect*
(`PluginScanner.txt`: `device:vst3:audiofx:`), exactly as Live 12 does; VST3 has no MIDI-effect category
for Live to go by. So a Schwung MIDI effect reaches a sound two ways, both tested on the device
(`tests/device/vst3_devices_test.py`, 27/27):

1. **Inside a Schwung instrument**: every instrument class has a "MIDI FX" selector, which loads the
   effect in front of the synth in the same chain (no Live routing at all).
2. **On its own track** ("Schwung Chord Track", browser folder *Instruments/Schwung MIDI Effects*): an
   instrument-shaped device with a VST3 MIDI output. Any other track takes its notes with Live's own
   routing, *MIDI From: <its track> / Schwung Chord Track* (Live names the channel
   "<rack> | <device> | <plugin>"), which drives Live's instruments too. Measured: 16 notes in, 48 out,
   48 heard by Braids on the other track.

The proxy still knows the MIDI-in/MIDI-out shape ("midifx"), for a Live that hosts it one day; no class
uses it.

Max for Live is no way in: there is no runtime on the Push (no Max under `/opt/push3`, and Live starts
with `-DontLoadMaxForLiveAtStartup`).

**How a MIDI effect's output leaves its chain.** The device is a chain with the effect in `midi_fx1` and
a hidden instrument, `midi-sink` (`src/sink`), as its synth. The chain gives the synth everything its MIDI
FX play, from `process_midi` and from `tick()`, after every later MIDI FX; the sink passes each message
to the bridge, which hands it back to the plugin in the same block. Schwung's "pre mode" was the first
route and is wrong here: it is built for Move playing the same pads natively, so it drops output on a
held pitch (an arpeggio over one held note is silent) and the root of every chord. Measured in the
container (2026-11-14, 6 notes in): pre mode Arp 0 / Chord 6 notes out; sink Arp 8 / Chord 18.

## Why not Schwung's chain as the core

Version 1 ran Schwung's chain host as a second engine beside Live. That cost:

- **set-up the user must do by hand**: a MIDI port with Track and Sync on, Link and Link Audio on, an audio
  return track per Schwung track (and Live forgets those settings after a crash);
- **a second mixer**: audio leaves Live and comes back over Link Audio, with its round-trip latency;
- **Move's limits**: 16 tracks (MIDI channels), 8 MIDI FX + 1 instrument + 8 audio FX in series, no parallel
  chains, no automation, nothing saved with the Live Set;
- **a crash**: making the audio return through the Remote Script crashed Live 13.0b25 (`DESIGN.md`).

Schwung's chain stays useful in one place, inside an instrument device (below), where it does a job Live
cannot: host Schwung MIDI effects in front of a Schwung synth.

## The parts

```
Live (one process)                              schwungd (one process, or one per device)
+---------------------------------------+       +----------------------------------------+
| track: [Schwung Braids] [Schwung      |       | instance 17: Braids (plugin_api_v2)     |
|         Instrument]     CloudSeed]    |       | instance 18: CloudSeed (audio_fx_api_v2)|
|          |  thin VST3 proxy |         | <---> | per instance: host_api, mailbox,        |
|          +------------------+         |  shm  |   128-frame blocks, MIDI, clock         |
+---------------------------------------+ futex +----------------------------------------+
        ^ Push device view, browser,                 ^ Schwung view on the Push screen,
          automation, racks, Set                       web pages, overrides, catalog
```

### 1. The proxy: `Schwung.vst3`, one bundle, one plugin per module

- One VST3 bundle whose factory lists **one plugin class per installed module**: "Schwung Braids",
  "Schwung OB-Xd", "Schwung CloudSeed". A sound generator is an instrument, an audio FX is an effect.
- The proxy does no DSP. Each audio block it writes the block's events, parameter changes, transport and
  input audio into shared memory, wakes the module's thread in `schwungd`, and waits for the output.
- **It never waits forever.** If the answer is not there in half a block, the proxy outputs silence for
  that block, counts it, and shows it. If `schwungd` is gone, the device is silent and says "Schwung
  restarting"; when it is back, the proxy recreates the instance from the state it holds. Live keeps
  running in every case. The proxy is small on purpose: it is the only Schwung code inside Live.
- Built with the VST3 SDK (MIT licensed since 3.8), no GUI: Live on Push shows no plugin windows.

### 2. The engine: `schwungd`

- Hosts module instances with Schwung's own API (`host_api_v1_t` vendored with its NULL tail): the same
  code as version 1's bridge, per instance instead of per track.
- One realtime thread per instance at Live's own audio priority (FIFO 70), woken by the proxy. Live renders
  tracks on several worker threads, so Schwung devices now render **in parallel on all cores**. Move
  rendered everything on one.
- **Isolation level** is a setting, as Bitwig does it: all devices in one process (least memory), or one
  process per device (a crash silences one device). Default: one process per device; modules are small.
- Module loads (`dlopen`, `create_instance`) and the warm-up render happen on a control thread before the
  instance is offered to Live, never on an audio thread.

### 3. What Live gives each module, mapped to Schwung's contract

| Schwung expects | On Push, from Live |
|---|---|
| `render_block` / `process_block`, 128 frames | the proxy's block, cut into 128-frame blocks. A Live buffer that is not a multiple of 128 adds up to 127 frames, reported to Live as latency so Live compensates (PDC). |
| 44.1 kHz | Live's rate. At another rate, `schwungd` resamples and reports the latency. |
| `on_midi` / `process_midi` | the block's note events at their sample offsets. VST3 has no CC events: the proxy declares MIDI mappings (pitch bend, mod wheel, sustain, channel and poly pressure, all CCs) and turns them back into MIDI bytes for the module. |
| `get_bpm`, `get_beat_position`, `get_clock_status` | Live's transport for the exact block. MIDI clock (0xF8, Start, Stop), which Schwung arpeggiators listen for, is generated from Live's song position at the right sample offsets. No Sync switch, no drift. |
| `mapped_memory + audio_in_offset` (Move's audio input) | the device's audio input: an effect's input, or the sidechain input. A sound generator that declares `audio_in` (Line In, samplers, loopers) becomes an effect device, so Live can feed it any track, return or input. |
| `split_voices` (voices rendered apart) | extra VST3 output buses: Live's multi-output routing puts a kick and a snare on their own tracks. |
| `chain_params`, `ui_hierarchy` | VST3 parameters, with Schwung's names, units and value strings (`2.41 kHz`, `SINE^`). An enum is a list parameter, an int is stepped. |
| `<prefix>:state` | the plugin's VST3 state: saved with the Live Set, undo included. Per-Set state, with no work. |
| a module's presets (`preset`, `preset_count`, `preset_name`) | preset files written to the User Library (`Presets/Schwung/<module>/`), so **Push's own browser** lists them. |
| `default_fx` (effects a module wants behind it) | a rack preset: the module and its effects as one Live rack. |
| `midi_send_external` | an ALSA port to the USB-A devices (Live ignores plugin MIDI output). |
| `midi_send_internal`, `midi_inject_to_move`, `slot_recv_channel` | left NULL: there is no Move to talk to. Modules check before every call. |

**Parameters must be fixed for a VST3 plugin, and some Schwung modules change theirs** (`chain_params` can
depend on a mode; child selectors repeat keys per tone or pad). At install time `schwungd` reads a module
in every mode and expands every child selector, and the plugin class gets that full list. A key that still
appears later is reachable in the Schwung view and the web page, and is logged so the list can grow.

### 4. MIDI effects

See "MIDI effects: the traditional shape first" above: a Live MIDI effect where Live allows it, a
"MIDI FX" selector inside every Schwung instrument, and a device on its own track as the fallback.
Audio effects are never inside an instrument: they are Live devices after it.

### 5. The Push

- **Push's own device view** is the native UI for free: parameter banks, names, value strings, the encoders.
  Banks follow `ui_hierarchy`. A generated preset carries the parameter map, because without one Live does
  not put a plugin's parameters on the encoders (push-hack measured that).
- **Banks on Push** (measured 2026-11-14): Push pages a plugin's mapped parameters 8 at a time, named
  "Bank 1", "Bank 2", ... (press the selected device's upper button to list them). Every Schwung bank is
  padded to whole pages with placeholder parameters, so Bank N is the module's Nth bank. A placeholder
  is a plain parameter with a no-break-space title and value that never moves: a read-only one is shown
  by Live as "Parameter #N 0.12" whatever its title. A parameter must be listed once only: Live keeps a
  value per listed entry.
- **The Schwung view** is the rich UI, as a Push Hack Home app or a button away from the device view: for
  the selected Schwung device it shows the native page of version 1 with module overrides (`push_ui.js`),
  the detail card, the module's own pictures, and Move's MIDI-effect chain of a Schwung Instrument. It finds
  the device through the Remote Script (`selection`, then the device's read-only "instance" parameter
  names the `schwungd` instance).
- **Pads** are Live's again: scales, layouts, Note Repeat, MPE, recording. Version 1's pad problem
  disappears.
- **Push's browser** lists Schwung presets and racks. Push does not list plugins themselves, so every
  module also gets a default preset, which is how a module is added from the Push.

### 6. The web page

`schwungd` serves it. It lists the Schwung devices in the Set (track and device names from the Remote
Script), and a module's own `web_ui.html` runs unchanged through the same postMessage bridge as version 1.
A change on the web page is a parameter change Live sees (automation recording included).

### 7. What stays outside

- **Overtake modules** take over the whole surface. They stay Push Hack Home apps through a Move
  compatibility runtime (`DESIGN.md`, Next, item 5). Not part of this design.
- **Move patches** are imported as Live racks: a Schwung Instrument (MIDI FX + synth) followed by Schwung
  effect devices.

## What we keep from version 1

The x86 module builds, the host-API bridge and mailbox (now per instance), the warm-up after load, the
parameter model (banks, value strings, stepping), the Push renderer and overrides, the web bridge. What goes:
the track engine, the "Schwung" MIDI port, the Link Audio returns, making tracks through the Remote Script,
the MIDI-clock transport.

## Unknowns, and the spikes that answer them

Each spike is small and ends with a measurement. Nothing is loaded into the user's Live without asking,
and only into a Set nobody needs: Live 13.0b25 already crashed once today.

1. **Braids as a Live device, in process.** A minimal VST3 (Braids linked into the proxy, no `schwungd`
   yet). First run Steinberg's `validator` on it off the device. Then on the Push: does Live scan and load it,
   do the pads play it, does Push's device view show its parameters, names and value strings, with and
   without a generated parameter map? Live's sample rate and buffer size on the Push.
2. **The hand-off.** The same plugin with Braids in `schwungd` behind shared memory. Measure the cost per
   block and late blocks under load, on Live's worker threads.
3. **MIDI.** Pitch bend, mod wheel, sustain, pressure through VST3 MIDI mappings; MPE from Push's pads.
4. **The bundle.** One class per installed module; an effect device; an audio-input device; multi-out;
   sidechain.
5. **Presets and racks** in Push's browser, with parameter maps.
6. **The Schwung view and the web page** for devices in the Set.
