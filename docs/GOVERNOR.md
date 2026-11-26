# The governor: performance and energy in one place

Status: **built and measured on a Push 3 (2026-11-25 and 26).** Not released: it is on branch `governor`.

Pung runs many modules beside Live on a four-core Push. Two things must both hold: a device that plays
never drops a block, and a device that nobody hears costs next to nothing. Both are the same resource
(processor time) and the same decisions (what runs, when, at what priority), so one part of Pung owns
them: the governor. Two separate parts would undo each other: one puts a silent emulator to sleep, the
other wakes it to stay ready.

## The result

The reference Set (two emulators, OsTIrus and Vavra, and four instruments: OB-Xd, Plaits, Dexed, Surge
XT), in percent of one core (400 is the whole Push):

| | Before | Now |
|---|---|---|
| Everything Pung brings, **nobody playing** | 136 | **6.6** |
| The Push, busy, nobody playing | 199 | 65 |
| Everything Pung brings, all six playing | 179 | 179 (unchanged: this is the sound) |
| Late blocks and underruns, ten minutes of all six playing | | 0, 0 |
| A note into a rested emulator, to its sound | | as on time as awake (below) |
| Pung's own code with its view open, at rest (five to six devices) | 15.7 | 6.0 |
| Pung's own code with its view open, the sound moving | 38.6 (five playing) | 23.5 (two playing) |
| Frames the view draws a second: at rest, moving | 13, 63 | 1.9, 31 |
| Pung's own code, view closed, a silent device | about 1.0 each | about 0.5 each |

"Before" is the same Set on the same build with rest switched off, and for the view the measurements
taken before each change. `scripts/governor.sh <push-ip> bench` gives the "now" column, pass or fail.

What a Set with emulators cost in silence, each emulator's process:

| | Awake, silent | Playing | At rest |
|---|---|---|---|
| Nodal Red 2X | 179 | 181 | 0.0 |
| OsTIrus | 84 | 100 | 0.0 |
| Xenia | 67 | about 80 | 0.0 |
| Vavra | 41 | 64 | 0.0 |
| JE-8086 (Schwung's: all of it, its three processes) | 97 | | 7.6 |

## What Pung cannot reach

- The processor's frequency governor is `performance`, set by Ableton's system. Kernel parameters are
  off limits (CLAUDE.md).
- The battery is not readable from Linux (`/sys/class/power_supply` is empty), and the processor's
  energy counters are not there either (no `powercap`, no `msr`). What can be read is how long the
  processor sleeps: with the reference Set silent, 55% of the time with the emulators at rest against
  30% with them awake (C1, all four cores, two runs of two minutes each way, the same both times,
  2026-11-25). The processor's temperature did not move in those minutes (65 to 66 °C either way, Live's
  indexer on a whole core beside it): it says nothing either way.
- Live's own work. Its library indexer ("Ableton Index") took a whole core for hours on the day of
  these measurements, at a low priority. The governor counts such work as background: it gives way to
  anything that plays, so it does not count against an emulator's room.

So Pung's lever is its own work, and processor time is the measure. No part of Pung can promise the
*least possible* energy. It promises that nothing of Pung's emulators runs for nobody, that its own
code does not work when there is nothing to show, and it shows the numbers.

## Requirements, and how each was met

| # | Requirement | Met by |
|---|---|---|
| R1 | **No dropouts.** The reference Set plays ten minutes with no late block on any device. | The benchmark: 0 late blocks, 0 underruns in 600 s. Nothing was added to a block but one sum: the governor's other counters are the kernel's and the realtime thread's own clock, read from another thread. |
| R2 | **Nothing runs for nobody.** | An emulator rests 10 s after its sound has died away, no key held (`govRestDefault`). Ordinary instruments do not rest: see "Decided against". |
| R3 | **The first note is never late.** | A rested emulator's ring is as far ahead as an awake one's, and OsTIrus drops the silence its emulator gathered at rest. Measured for all four, awake and rested turn about: below. |
| R4 | **Live keeps its share.** | An emulator starts only while **half a core** stays free with every emulator playing (`govRoom`). See the note under the table: this is not the whole core first proposed. |
| R5 | **Nothing to set.** | No mode, no switch. The web page says *Resting* beside a resting device, and a module's card what its emulator takes. `PUNG_REST_MS` and `POST /api/governor/rest` exist for a test or a doubt, and are not kept. |
| R6 | **The sound is the module's.** | Awake, nothing changed. At rest only blocks that were silence (within 2 of 32768, -84 dB) are replaced by silence. A note after a rest has the level of a note without one within about 1 dB on all four. One difference, by design: an emulated synth's time stands still at rest, so a free-running LFO goes on from where it was, as if no time had passed. |
| R7 | **In doubt, it runs.** | A module that does not answer `rest_after_ms` is never told to rest; no reading of the Push's load lets an emulator start; a key held or anything sent keeps a synth awake. |
| R8 | **Nothing is lost.** | At rest: a state read leaves the synth at rest and is its state; a knob wakes it and holds; another sound loads and plays (`governor.sh rest`, all four). |
| R9 | **Measured.** | `GET /api/governor`, `scripts/governor.sh` (`bench`, `rest`, `load`), `frame_why` in `/api/surface/state`. |
| R10 | **The governor is cheap.** | It measures only when asked. Its one loop (every 5 s, `keep`) runs only while a device that can rest exists. |

**R4, changed from the proposal.** The proposal kept one whole core free. Measured, the heaviest pair
there is (Nodal Red 2X and OsTIrus: 2.7 cores between them) plays beside Live with 0.7 of a core free
and neither an underrun nor a late block. A whole core would refuse that pair on an idle Push: a
combination that works today. So the share is half a core (`govFreeShare`): it keeps what works and
refuses what does not fit. One constant, if a whole core is wanted after all.

Off limits, whatever the gain: kernel parameters, Ableton's system settings, `/boot`, `/opt`; a
module's sound; the two-emulator limit (three left a Push unreachable, and nobody was at this Push to
switch it off and on: it stays, beside the room an emulator needs).

## Design

Two files in Pung: `governor.go` measures, `govrest.go` decides. The rest is in the parts they govern.

### 1. An emulator rests (`govrest.go`; `emu_host.h`, `emu_shm.h`; `ostirus_plugin.cpp`)

Pung says when a module *may* rest (`set_param("rest_after_ms")`); the module knows whether it *can*:
its output has been silence for that long, no key is held, nothing was sent to it in that time,
nothing waits in its queue. It then answers silence and stops reading its ring. The engine renders
only to keep the ring ahead, so it stops by itself, the ring full, and waits for an entry instead of
waking every 2 ms. Whatever is sent next ends the rest before it goes. NATIVE-MODULES.md, rule 9, has
the contract and the race it closes.

The governor tells a module when it is made, and looks every 5 s whether each still knows (a module
loaded again forgets): `adopt`, `keep`, `tell`. `limits.go` says which modules rest.

Measured on a Push, each of the four. A note to its sound, in ms, awake and after a rest, turn about
(14 to 30 pairs each, medians, a note sent through Pung's web API to the first sample above -50 dB in
what the device gave Live; the same path both times):

| | Awake | After a rest | Engine at rest |
|---|---|---|---|
| Vavra | 15.7 | 15.4 | 0.0 |
| Nodal Red 2X | 14.8 | 14.9 | 0.0 |
| Xenia (Nodal Red beside it) | 33.1 | 27.1 | 0.0 |
| OsTIrus | 15.2 | 13.7 | 0.0 |

**OsTIrus needed one thing more.** Its first note after a rest was 3.5 ms *later* than awake (19.3
against 15.6 ms over 16 pairs), with the ring equally far ahead both times (`note_lead` in its
`debug_info`: 320 frames). The emulated Virus stands at rest with more audio rendered ahead than it
keeps while it is played, all of it silence, and the note sounds behind it. So as it wakes, the engine
throws away three blocks of the emulator's silence before the ring is read again (`WAKE_DROP`,
`ostirus_engine.cpp`): never a block that sounds. Two blocks left it 1.7 ms late, three make it 1.5 ms
early, with no underrun in 31 wakings. The other three had no such surplus. A series of eight notes
awake and eight rested, one after the other, does not show an effect of this size (the first runs
read -4.4, +0.4 and +4.8 ms): only turn about does.

Each also passed `scripts/governor.sh <ip> rest <module>`: its level after a rest is the level awake
within about 1 dB; a knob at rest wakes it and holds its value; another sound loaded at rest plays; a
state read leaves it at rest; a rest of 45 to 120 s, then a note on time; no underrun and no late
block.

### 2. Pung's own LFOs leave a silent emulator alone (`pungmod.go`, `pmodUnheard`)

A route from LFO A or B writes its control 50 times a second, and each write would wake a resting
synth. So for a device that may rest, the runner stops writing once the device has been silent for
2 s with no key held; the LFOs run on, unwritten. A key, the wheel, pressure or a change to the routes
wakes the runner at once (`wakeUnheard`), and it writes where the LFO is by then. Measured on OsTIrus
with LFO A on its cutoff: it rests in silence, the cutoff moves while a key is held, it rests again
afterwards, and the knob's own setting is untouched.

One difference from before, on emulators only: the first note after a silence can sound for a few
milliseconds with the LFO where it stopped being written, before the runner's write arrives. Awake,
the value is up to 20 ms old anyway (an emulator is written every 20 ms).

### 3. Room for an emulator (`govrest.go`, `govRoom`)

An emulator starts only if the Push's load now, plus its cost, plus the difference to its playing cost
of every emulator that takes less at the moment (one at rest, one still starting), leaves half a core.
Costs are measured, in `limits.go`. One that does not fit waits, as a third emulator does, with the reason
in Pung's log, and starts by itself (Live's plugin asks every second). In doubt (no
reading) it starts. A side effect that is wanted: when Pung starts with two emulators in the Set, the
second can wait until the first has booted.

### 4. The view reads and draws only when there is something to show (`surface.go`, `frames`)

The view was the largest cost of Pung's own code: more than the instruments it showed. Found and
fixed, each by measurement (`frame_why` counts a frame's reasons):

- **It read everything 60 times a second**, frame or no frame: Live's selection, every parameter's
  key (through a function that copied Live's state and formatted a string, once per parameter). Now
  it reads for a frame that will be drawn, at most every 50 ms unless something changed.
- **The Push's own messages redrew it.** The Push sends Active Sensing four times a second, and
  pressure and pitch bend while pads are played; each counted as input. Only notes and controllers do
  now (`isControl`).
- **Live repeating itself redrew it.** A topic that came again unchanged, and a poll that read the
  same values, each marked the view changed. Now only news does.
- **At rest it redrew four times a second regardless.** Now when a value changed, and twice a second
  otherwise (what overrides.md always said).
- **A sounding device's meter drew 60 frames a second** where the live pictures have 30 new ones.
  Frames that only move now come 30 times a second, whatever moves them. A turn or a press is still
  drawn at the next 16 ms tick.
- **Closed, its loop still ticked 60 times a second.** It now sleeps until the view is opened.

### 5. A silent device's pump slows down (`rtloop.go`, `pumpWait`)

Each device's pump (Go's side of the realtime thread) woke 500 times a second. After a second with no
parameter from Live, no note, no sound and the transport stopped it now looks 100 times a second, and
is back at 500 with the first thing that happens (a note from the web page at once). Notes from Live
never went through the pump: playing is not touched.

### 6. Schwung's emulators rest from outside (`rtloop.c`, `rt_set_rest`; `limits.go`, `HostRests`)

JE-8086 and Osirus are Schwung's modules: they do not know `rest_after_ms`. They do know a host that
stops asking for sound: Schwung's own host on Move leaves `render_block` out for every module whose
output stayed within 4 of 32768 for a second, and looks again twice a second (`schwung_shim.c`), and
JE-8086's emulator, which renders ahead of what is read, idles when nobody reads. So for these two the
device's own thread does the same after the governor's rest time: output within 4 of 32768, no key
down, nothing sent to the module (a message from Live, a note from the web page, a parameter or a
sound from Pung), and no MIDI effect loaded in front of the synth (one may play by itself, and only a
render runs it). The rule is two small functions with a test of their own (`rt_rest_before`,
`rt_rest_after`; `TestHostRestRule`). At rest it answers silence and renders one
block every half second; a block that sounds, a message or a change ends the rest in the same block,
before its render.

JE-8086, measured 2026-11-25: 97% of a core silent, 7.6% at rest (its three emulator processes 85
against 2.7). A note into it rested came as soon as into it awake: 35 pairs taken in turn, medians
within 1.5 ms of each other, no rested note later than the latest awake one. **Osirus is switched on
unmeasured**: it is not installed on the Push these measurements were taken on. It runs under the same
idling on Move every day, at a tenth of the wait.

Only these two. Every other Schwung module is rendered always (below, "Decided against").

### 7. A cold emulator keeps its ring deep (`emu_shm.h`, `ostirus_shm.h`: `Cold`)

An emulator compiles the synth's code the first time it runs it. The warm-up chord at its start covers
the sound it starts with; the first notes of any other sound underran the ring: a freshly started
Vavra ten and six times on the first chord of a new sound, and OsTIrus once two seconds after a start
(and not again in twenty minutes of all six devices playing: its slowest block then was 3.4 ms long
and took 4.1 ms of processor time, all work and no waiting). A deeper ring carries it: at 29 ms
(`AHEAD_DUMP`) one first chord in four still underran, twice; at 44 ms (`AHEAD_COLD`) none did in ten
cold starts, eight of Vavra and two of OsTIrus, each with a sound not played before, the slowest
single block among them 33 ms. So an engine is *cold* from its start and from every new sound until
the first notes are through (a second and a half after the first of them with no slow block, eight
seconds at most), and keeps the ring 44 ms deep that long. Those first notes sound 36 ms later than
the ones after them.

Not every synth pays that. A fresh Xenia's and a fresh Nodal Red 2X's first chords of three new
sounds each had no slow block at all (0.4 and 1.9 ms at most, against Vavra's 8 to 33). So an engine
finds out by itself: when the first notes of its first three sounds pass with no block over 3 ms, it
is never cold again; one such block among first notes, and it is cold with every new sound for as
long as it runs. This was the "rare underrun in OsTIrus" and the "first note of a
sound" of this document's earlier state: one cause.

### 8. Small things found on the way

- Pung rewrote a list file in two folders of Live's library at every start, in a random order: work
  for Live's indexer. It is written only when it changed (`sounds_racks.go`).

## Decided against

- **Skipping a silent ordinary instrument's render.** Five of them cost 3.7% of a core together at
  rest. Skipping saves single percents and risks every module's sound (tails, free-running LFOs,
  arpeggiators), module by module. The numbers do not carry it.
- **Waking the pump from the realtime thread** (a futex) instead of a slower look. It would save the
  last half percent a device and put a system call on the audio path.
- **Not sending a frame that equals the last one.** At rest there are two frames a second: comparing
  costs more than it saves.
- **More than two emulators at once**, by room alone. The room rule would allow three small ones, and
  three once left a Push unreachable. Not tried with nobody at the Push.

## Not covered

- **Osirus's rest is not measured** (above): not installed on the Push used.
- **A front panel's own drawing.** With the sound moving, most of the view's cost is the module's
  screen drawn 30 times a second (OB-Xd's panel: about 4 ms a frame, inside its budget). That is each
  `push_ui.js`.
- **Vivace** renders on a thread of its own (2% of a core silent, 10% playing). Left: two percent do
  not carry a change to how it runs.

## The benchmark

`scripts/governor.sh <push-ip> bench [seconds]`, in a **new** Set (it loads six devices into the Set
that is open and saves nothing). Thirteen checks, pass or fail:

- **silent:** both emulators rest; all of Pung at most 12% of a core; the emulators' processes under 1%.
- **waking:** a note into each rested emulator sounds; no underrun.
- **playing** (600 s by default): no late block on any device, no underrun in an emulator, the Push
  keeps its free share, every device sounded.
- **view:** at most 3 frames a second at rest, at most 32 while the sound moves.

2026-11-25: all pass. `scripts/governor.sh <ip> rest <module>` is one emulator's rest in depth (the
device must be in the open Set); `... load [seconds]` prints `/api/governor`.

## Reading `/api/governor`

`GET :7720/api/governor?seconds=N` reads the counters, waits N seconds and reads them again. All
figures are percent of one core:

- `devices[]`: `cpu` the device's realtime thread, `render` the part inside the module, `silent`
  whether its output stayed under -72 dB for the whole window, `resting` for a module that can rest;
- `engines[]`: each emulator's process;
- `pung`: the process, its device threads, Go's (the view, the pumps, the web page), a module's own
  threads by name, what modules forked, whether the view is open;
- `live`, `push3`, `system.busy`, `system.background` (low priority), `system.free`;
- `pung_total`: everything Pung brings; `silent`: the part of it nobody heard;
- `rest_after_ms`: the rest time now.

It costs nothing between requests.
