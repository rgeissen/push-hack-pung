# Pung on Push 3: design record

Decisions, why they were made, what was measured on a Push, and what comes next. Written 2026-11-14.

## The goal

Run Schwung modules (Ableton Move's module ecosystem) on Push 3 Standalone with three ways to see a
module, all on one parameter path:

1. a native Push UI built from the module's own metadata, for every module;
2. the module's own `web_ui.html`, unchanged;
3. a module's own picture on the Push screen (`push_ui.js`), on top of the native page.

## Decisions

**One Pung track = one chain = one Live track.** (Schwung's code calls a track's chain a "slot"; the
code and the API keep that word, everything a user sees says "track".) A chain holds up to 8 MIDI FX, one
instrument and up to 8 audio FX: the limits of Schwung's chain host (`MAX_MIDI_FX`, `MAX_AUDIO_FX`), kept
so a chain saved on Push loads on Move. The Push's bottom row shows 8 of a chain's up to 17 positions and
scrolls (D-pad, jog clicks). Move has 4 fixed tracks and Pung binds slot N to track N implicitly. Live has any number of tracks, so the binding is a routing: a track whose MIDI goes to
port Pung, channel N, is slot N's track. The binding is saved with the Live Set and survives reordering
and renaming. Each slot's audio is its own Link Audio channel (`Pung N`), so Live's mixer, sends and
master do what Schwung's shim does on Move. Master FX and send buses are therefore not ported.

**One MIDI port, Pung track = channel (so up to 16 Pung tracks).** The first build had one port per slot. On the device, Live listed every
new port with Track off, and a track can only send to a port whose Track switch is on. One port is one
switch. It is also Move's own model (slot N listens on channel N). A dedicated port per slot, for MPE
controllers that need all 16 channels, is a later option.

**Schwung's chain host, not a new one.** `modules/chain/dsp` is itself a `plugin_api_v2` module and depends
only on `src/host/*.h`. It builds for x86_64 unchanged. That brings the patch format, the parameter keys,
the shape verbs (`fx:insert/remove/move`, a permutation, not a reload) and modulation.

**The render thread never waits on a module load.** Each slot has an owner lock. The engine waits out short
calls (reads, writes: microseconds) and skips a slot whose `loading` flag is up (module loads, patch loads,
shape edits). The first design only TRIED the lock; with the screen reading values, every read became a
silent period. After a load, two blocks are rendered on the control thread (`sb_warm`): Hera does 8 ms of
setup in its first block, which on the render thread made every slot late.

**Metadata is read once per loaded module.** `chain_params` and `ui_hierarchy` are cached per slot,
position and module. Re-reading `chain_params` on every web poll made a period run 4.7 ms late.

**Overrides draw, they do not take input.** A widget names the keys it shows; the native layer places it
over their columns, keeps their names and values under it, and keeps every encoder. Scripts run in goja
(pure Go). A throw or a draw over 8 ms turns the override off for the session, with a visible mark. Shift +
Swap toggles it.

**The web page is schwung-manager's parent, rebuilt.** A module's `web_ui.html` includes
`/static/schwung-remote-api.js` (vendored, unmodified) and talks postMessage to its parent. `web/app.js`
answers the same messages as schwung-manager's `remote-ui.js`.

## Measured on the Push (2026-11-14, AbletonOS v4.2, Live 13.0b25)

- Chain host and 16 modules load and render (Braids, OB-Xd, Dexed, Hera, Line In; CloudSeed, TapeDelay,
  Junologue Chorus, MVerb, OTTx, Ducker, TAPESCAM, PSX Verb, Freeverb; Arp, Chord).
- Audio bus: 44.1 kHz, 128-frame periods; every slot a Link sink, 0 underruns.
- Engine under load (web page polling, Push UI, encoder turns, 482 notes on two slots, 60 s): 20,908
  periods, 0 overruns, average 118 us, worst 442 us, budget 2,902 us.
- Six module swaps while playing: 0 overruns, worst 720 us.
- OB-Xd's own web UI through the bridge (headless Chrome): getParam, setParam, onParamChange (a change
  made on the device reached the panel), height. All pass.
- Push UI, checked by the panel's own mirror: banks from `ui_hierarchy`, enum stepping one option per step,
  the detail card, the module browser, add, bypass, pads, the Braids envelope override.

## Live 13.0b25 crashed when Pung made an audio track (2026-11-14)

The first "New" made both tracks through the Remote Script (`track.ensure`). The MIDI track worked. Making
the audio return (an audio track with the input PushHack, channel Pung 1) crashed Live within a second:
the system log has `Loading document ".../Default Audio Track.als"`, then `snd_pcm_wait error`, then
`Live stopped running with exit code: -11`. Live had Link and Link Audio on. The same call works for Braids
on Live 12.4. Live saves its settings only on a clean quit, so the user's new settings were lost (PushHack
in a control-surface slot, Track and Sync for port Pung, Link).

Not yet known: whether making an audio track crashes Live 13.0b25 at all, or only giving it the PushHack
input. "New" now makes the MIDI track only; the user makes the audio return by hand. Before automating it
again, find out which step crashes, on a Set nobody needs, with the user's agreement. If a hand-made track
with the PushHack input also crashes, it is a Live bug to report to Ableton.

## Next

1. **Live set-up on the device.** Needs a person once: the PushHack Remote Script in a control-surface slot,
   Track and Sync on for port Pung, Link and Link Audio on. Then check: New makes the two tracks; the
   routing names Live really uses (`Pung` / `Ch. N`, `PushHack` / `Pung N`); Live's selection follows
   to the slot; the round-trip latency of Link Audio.
2. **Pads to Live while Pung shows.** Today Pung plays the pads itself (chromatic). The better design
   gives the encoders and buttons to Pung and the pads to Live (Live's scales, layouts, Note Repeat).
   That needs a push-display hook mode that passes notes (the `midiflt` pass list covers CC 0-87 only) and a
   Push3 restart to load it.
3. **One track per slot**, if Live's External Instrument can take a Link Audio return.
4. **Slot state per Live Set**: the Remote Script can tell which Set is open.
5. **Overtake modules** (13 in the catalog), as Push Hack Home apps through a Move compatibility runtime:
   QuickJS (their `ui.js` are ES modules importing `/data/UserData/schwung/shared/*.mjs`), Schwung's host
   functions, Move's MIDI map (mostly the same numbers on Push: knobs 71-78, pads 68-99, Shift, arrows,
   Play, Record), Move's screen drawn 2x with a legend, and a `/data/UserData` link tree for their absolute
   paths. Groups found in their source: controllers of external gear (SID Control, M8, Alpha Juno, Custom
   MIDI Control: runtime only), self-contained instruments and loopers (Mono, Mark, Oversmack, Overwork,
   Overwork Mix, TwinSampler: runtime plus the mailbox), and modules that drive Move itself (Arranger, Kit
   Builder, Performance FX: one at a time). Leave out host functions that cannot be honoured; modules
   feature-detect them.
6. **More modules**, and a release workflow that builds them for x86_64.
7. **Catalog**: a repository, a release and an entry in Push Hack's catalog.
