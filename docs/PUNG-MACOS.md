# Pung in Live on macOS

A design (2026-11-28). It is Phase 2 of `docs/PUNG-STACK.md`, worked out for the Mac. What is measured says
so; everything else is a plan. Nothing here is built unless a line under "The proof" says so.

## The two ambitions

1. **A Set made on a Push with Pung devices opens and plays in Live on a Mac, and the other way round.**
   The same devices, the same sounds, automation and mappings on the same controls.
2. **The same Pung experience in Live on the Mac as on the Push**: in Live itself (the device's own window),
   and on a Push connected to that Live in control mode.

## What it rests on (measured)

- **Live knows a VST3 device by its kind and class id alone.** Live 13.0b27 on the owner's Mac files every
  scanned plugin as `device:vst3:<instr|audiofx>:<class id>`, and one bundle may hold several devices
  (its plugin database, 2026-11-28). Pung's class id is `md5(namespace:kind:module id)`
  (`livedevice.ClassUID`): the same on every machine. So a Mac plugin that answers with the Push's class
  ids is, to Live, the same device. **To be proven first** (below): that Live on the Mac takes it so.
- **Live remembers a bundle by its size and date** (the same database: `fingerprint`), and scans it again
  when they change. Pung on the Push touches its plugin to be scanned again; the same will do on a Mac.
- **What Live loads on the Push** is a VST3 plugin without a window (core's `livedevice`, Steinberg's SDK
  3.8.1, about 1,100 lines), installed as `Pung.vst3`. It holds no instrument: each block it hands Pung the
  events, parameters and input through shared memory, wakes Pung, and waits at most half a block for the
  sound. Pung, a process of its own, renders (`rtloop.c`, one realtime thread a device).
- **A device's parameters are numbered by their place** (0..255), with four hidden ones at 1000..1003 (pitch
  bend, mod wheel, pressure, sustain). Live stores automation and mappings by place.
- **A device's saved state** is text Pung writes (`{"pung_device":1,"midi_fx","out_ch","chain",
  "pung_mod","sound","sound_hash"}`); the plugin only frames it (a length, then the bytes).
- **Modules render 128 frames at 44.1 kHz.** Nothing on the Push resamples or tells Live a latency: the
  design document that says so is ahead of the code.
- **The owner's Mac**: an M3, macOS 26, Live 13.0b27 (the Push runs 13.0b25), Apple's compiler; no Go, no
  CMake. A Set saved by the newer Live may not open in the older: both ends want the same Live.
- **The connected Push**: Live 13 on the Mac carries its own `Push3.app` (the Push's scripts, its pictures,
  libusb): in control mode that program decides what the Push's screen shows. Ableton's Extensions SDK
  (JavaScript, public beta since June 2026) acts on a Set's contents; nothing public says it can draw on a
  Push. The owner has heard that Ableton will open that way.

## The shape

The same two parts as on the Push, so that one code base serves both:

```
Live on the Mac                         Pung (a service beside Live)
┌──────────────────────┐   shared      ┌───────────────────────────────────┐
│ Pung.vst3            │   memory,     │ the device server (core's, ported) │
│  one class a module  │◄─ a wake ────►│ one realtime thread a device       │
│  the device's window │   word, a     │ Schwung's chain host, the modules  │
│  (a web view)        │   socket      │ the view, the page, the catalog    │
└──────────────────────┘               └───────────────────────────────────┘
```

**Why beside and not inside** (the choice in PUNG-STACK.md, confirmed for the Mac): the modules are other
people's code and stay out of Live's process (a module that crashes takes Pung's device, not the Set);
every module names the Push's folders, which Pung can answer in its own process and never in Live's; the
view, the page and the catalog are the same program everywhere. That a helper process can render realtime
audio for a host on macOS is how plugin hosts that isolate plugins work. **To be proven on this Mac** before
anything is built on it (the proof, P2). The way back if it does not hold: the realtime half (`rtloop.c`,
the bridge, the chain host, the modules) inside the plugin, the rest of Pung reaching it through the same
shared memory. That is a large change to how Pung reads and sets a module's parameters; it is named, not
planned.

### What changes underneath

| On the Push (Linux) | On the Mac |
|---|---|
| A file in `/dev/shm` for each device | `shm_open` (a name of at most 31 letters) |
| A futex on the request and done words | `os_sync_wait_on_address` and its wake, shared between processes (macOS 14.4 and later) |
| `SCHED_FIFO` 70 for a device's thread | A time-constraint thread that joins the audio device's workgroup (so an Apple chip runs it on the fast cores, with Live's own audio thread) |
| The socket at `/data/push-hack/data/pung/devices.sock` | A socket in Pung's folder (a short path: macOS allows 104 letters) |
| The plugin finds its settings inside its own bundle | Outside it, in Pung's folder: a signed bundle may not change |
| `/proc`, process groups, priority-inheriting locks with a deadline | Their macOS counterparts, or done without (the Push's are for a Live Pung restarts; on a Mac Pung never restarts Live) |
| Pung restarts Live to make it scan | Pung never touches Live on a computer: it says "restart Live", and (below) needs it far less often |

### Where things live on a Mac

| | |
|---|---|
| The plugin | `~/Library/Audio/Plug-Ins/VST3/Pung.vst3` (the player's own folder: no administrator needed) |
| Pung, its modules, sounds, pack | `~/Library/Application Support/Pung/` |
| The service | Started by macOS on demand (a launch agent that owns the socket and the page's port: nothing runs while nothing asks) |
| The page | `http://127.0.0.1:7720`, as on the Push |

## Ambition 1: the same Set on both

The five clauses of the Set contract (`docs/PUNG-STACK.md`), and what the Mac asks of each.

1. **Identity.** Holds by construction (above). The Mac plugin gives each class the Push's id, name, kind
   and category.
2. **Parameter positions.** The contract must be on, on both ends, before Sets are exchanged, and its layout
   must be the one that fits what Live shows (`docs/SET-CONTRACT.md`, "What the Push said": the module's own
   first 96, the MIDI effect selector at 96, thirty slots, then the rest). **This is the open decision that
   blocks everything else here.** Whether Live on a computer also stops at 127 is measured in the proof.
3. **State.** Two repairs, both needed before a Set crosses:
   - *The MIDI effect* is named by its number in the registry, not by its place in one machine's list (the
     contract's classes do this already).
   - *Files* (samples, sound files) are written into the state as the Push's path, and stay so: **the Push's
     path is the name, each deployment answers it.** On a Mac every module is built so that a path under
     `/data/UserData/UserLibrary`, `/data/UserData/schwung` and Live's packs is opened in the Mac's own
     User Library, Pung's folder and Live's packs. The state is then the same text on both machines, and
     forty-one modules that name those folders in their own code need no change of their own.
     Whether the file is there is the fifth clause's.
4. **Versions.** As everywhere: a module must read what its last version wrote. A test for that belongs to
   the pack's build, not to the Mac.
5. **What lies outside the Set.** The stack check (`POST /api/stack/check`) already says what a Set needs
   and what is missing; a Mac is one more deployment it is asked of. Files a Set's sounds use are added to
   what it lists. Firmware never travels: it is named.

**A class for every module in the pack, installed or not.** On a Push a module that is not installed has no
class, and a Set that uses it meets a missing plugin. On a computer Pung cannot restart Live to add one. So
the Mac plugin lists a class for every module of the pack (the pack carries each module's layout: names,
kinds, ranges). A device whose module is not installed says so and what to install, keeps its state, and
plays once the module is there. Live then needs a new scan only when the pack itself grows. The same is
right for the Push and can follow there.

**Rate and block.** Live on a computer runs at any rate and block size. A device renders 128 frames at
44.1 kHz; the service converts where Live runs at another rate, and the plugin tells Live the latency (the
128 frames it must gather, plus the converter's). The shared block gains the rate. Without this a Set at
48 kHz plays sharp: it is part of the first build, not an extra.

**The modules, built for the Mac.** Each of the 132 is built from its source for Apple silicon (Intel only
if asked for), packaged beside its Push build under the same version. A survey comes first: which build as
they are, which need work, which cannot. What the survey must expect:
- The chain host uses glibc's `dlinfo` and names the Push's folders: it is built with the Mac's own answers.
- The emulators (gearmulator) come from a desktop project and build for the Mac. Their helper processes use
  Linux's memory files, shared semaphores and parent-death signal: each has a macOS counterpart. Their
  compiled code needs the Mac's permission for it (a signing entitlement).
- A module that cannot be built yet is the placeholder above, not a broken Set.

## A limit is the deployment's own

Decided and built on 2026-11-28 (the owner: "each deployment option carries its own limits"). What a Push
may not do is not what Pung may not do (`src/deployment.go`):

| | A Push 3 | A Mac |
|---|---|---|
| Emulators that run at once | Two (three left it unreachable, 2026-11-21) | No count of its own |
| Room kept for an emulator by what it costs | Yes, by costs measured on a Push | No: those numbers are a Push's. A Mac gets its own once they are measured there |
| An emulator of one kind twice | One runs, the second waits (the engine's own lock) | The same, until the engines are taught otherwise |
| Rest in silence | Yes | Yes: a laptop's battery is worth as much |

**The governor is ported with it** (2026-11-28). What it does to save work was already there, being shared
code: a device rests in silence, the realtime loop does not render a rested module, the view draws only what
changed. What it *measures* came from Linux's `/proc` and is now read through macOS's own calls
(`src/sysread_darwin.go`): a process's and a thread's processor time, the machine's load, memory, the
battery, the system's version, the list of processes (an emulator's engine, Live itself). So on a Mac
`GET /api/governor` says what every device costs and `GET /api/system` shows the machine at a glance, as on
a Push. Measured here with Braids playing at 48 kHz: its device thread takes 1.3 percent of one core, 0.6 of
it rendering; Pung as a whole 6.9. The room check stays off on a Mac until an emulator has been built and
measured there: the governor is now the tool that measures it. A Mac's eight cores are not all alike
(four fast, four slow on the owner's M3): a rule that counts free cores will have to know that.

Pung says which kind it is and what that carries (`GET /api/system`: `kind`, `limits`; the catalog's
`deployment`), and a module's card words its limits from that: on a Mac no sentence about two emulators and
no cost in a Push's cores. **What follows for a Set**: one made on a Mac may hold more emulators than a Push
plays. That is not found out by a Set that stays silent: the stack's check against a deployment says it
(`emulators`: wanted, and how many play at once there).

## Ambition 2: the same experience

Pung's view needs two things from where it runs: **somewhere to put a 960 by 160 picture, and the controls'
events** (eight encoders, two rows of buttons, the pages). On the standalone Push, Push Hack gives it both.
The design keeps the view exactly so and gives it other places to stand.

**In Live on the Mac: the device's window is a Push.** The plugin's window shows the device as the Push
shows it: the screen, live, with the same front panel, pages, segment mode and ASSIGN, and under it the
encoders and buttons to turn and press with the mouse. Beside it, what the page already has for a device:
its sounds, its samples, its pages as lists. It is Pung's own page for that device in a web view, fed by
the same view code that draws for the Push (a surface that is a window instead of hardware). Nothing is
drawn twice, and a panel that changes on the Push changes here.

**On a Push connected to Live on the Mac**, two levels:
- **Push native, by construction.** Live's own device view on the Push shows a Pung device's parameters in
  banks of eight, with Pung's names and units, in the order of Pung's pages: the contract's layout puts a
  module's first pages first. No hack, nothing to break.
- **The Pung view, when Ableton opens the way.** The same surface as the window above is handed the Push's
  screen and controls in place of the window. What is needed from Ableton is exactly the two things the view
  asks for. Until that exists Pung does not hook Ableton's program on the Mac: that would mean changing a
  signed application, which a product must not do. (On a Push 3 Standalone in control mode the Push's own
  system still runs; whether Push Hack's hook there could show a view fed from the Mac is a question for a
  spike, not a promise.)

## Installing, and what a player must never do

The rule of `docs/SECURE-LINK.md` holds: nothing after the installer. The Pung Installer gains a second
target, "this Mac": the plugin into the player's VST3 folder, Pung and the pack into its folder, the launch
agent. Live finds the plugin at its next start. pung.live's Deployments gains the kind (`KINDS`): a Mac is
a deployment like a Push, at `127.0.0.1`.

For anyone but the owner the programs must be signed with an Apple Developer identity and notarised, or
macOS refuses them. That costs a membership and is the owner's to decide; the proof needs none of it.

## The proof, in order

Each step answers one question and has a result that is either there or not. Step 1 costs days; nothing
after it is started before it holds.

| | Question | Done when |
|---|---|---|
| **P1** | Does Live on the Mac take Pung's plugin, with the Push's class ids? | A build of the plugin for the Mac passes Steinberg's validator and Live lists its devices |
| **P2** | Does realtime hold between Live and Pung beside it on an Apple chip? | One module plays in Live at 64, 128 and 256 frames, 44.1 and 48 kHz, for ten minutes without a late block, beside a busy Set |
| **P3** | Does a device saved on the Push open on the Mac? | A rack Pung wrote on the Push, with a sound in it, loads in Live on the Mac and sounds the same |
| **P4** | How many parameters does Live on a computer show, and does a changed bundle get scanned? | Measured, and written into `docs/SET-CONTRACT.md` |
| **P5** | Does a whole Set cross, both ways? | A Set with a Pung device, automation and a mapped Macro, saved on the Push, plays the same on the Mac; saved there, the same on the Push |

P5 needs the contract's new layout and someone at both machines; P1 to P4 need neither.

### What the proof has shown (2026-11-28, the owner's Mac, Live 13.0b27 and then 13.0b28)

Built by `macos/build.sh`: core's plugin with a macOS port (`macos/patches/core-darwin.patch`: shared memory
by `shm_open`, the wake word by `os_sync_wait_on_address`, a time-constraint thread, the bundle's layout and
its signature), Steinberg's validator, and `pungstub` (`macos/cmd/pungstub`), a placeholder service that
answers Live for every class of a Pung: it keeps a device's state, an instrument plays a sine.

- **P1 holds.** With the 104 classes of the owner's Push (its `classes-known.json`) the validator passes
  4,888 tests, none failed. Installed as `~/Library/Audio/Plug-Ins/VST3/Pung.vst3`, Live lists all 104
  (81 instruments, 23 audio effects, vendor Pung); Braids is `device:vst3:instr:e968acf7-…-21ebcda983ed`,
  the Push's id to the letter.
- **Live scans the player's own VST3 folder** (it says so in `PluginScanner.txt`: "(user)"), in a scanner
  process of its own, at start. No administrator is needed to install.
- **A bundle must be signed as it stands.** Live refused the first install: "invalid Info.plist (plist or
  signature have been modified)". The plugin's built-in signature names the description file it was built
  beside. The install step signs the bundle again after writing it (ad hoc here), and remembers which
  source binary it came from, so that an unchanged plugin is not a new one to Live at every start. Live
  rescans a bundle whose size or date changed (its database's `fingerprint`), at its next start.
- **P3, the mechanism.** A rack as Pung writes it for Live's browser (core's `WritePresets`, the same code as
  on the Push) opens in Live on the Mac: "plugin processor successfully loaded: Pung 'Braids' (cid:
  {E968ACF7-…})", "parameter count is 201" (Braids' 197 and the four hidden ones). A rack with a Pung state
  written into it as Pung writes a sound's rack hands that state to the service whole (283 bytes: its
  module and its sound's name read back). Not yet done with a file the Push itself wrote (it was switched
  off), nor with a real module, so nothing has been heard.
- **P2, a first number only.** One placeholder device in Live at 48 kHz and 512 frames: 11,495 blocks in
  two minutes, none late; a service that is restarted is found again by the plugin and the device is made
  again with its state. This is the easy case (a large block, an idle machine, no module). The question
  stays open until a module renders on its own thread at 64 frames beside a busy Set.
- **P4, half.** Live reads all 201 parameters of the class; how many it shows and automates is not measured
  (it needs someone at Live, or its script).
- **Live updated itself** from 13.0b27 to 13.0b28 when it was restarted for the scan. The Push runs 13.0b25:
  the two ends drift apart by themselves, and a Set saved by the newer Live may not open in the older.

### Pung itself on the Mac (the same night)

- **Pung builds and runs on macOS from the same source** (`macos/build.sh`): its bridge to the modules and
  its realtime loop are ported behind compile-time switches (`src/bridge.c`, `src/rtloop.c`: the wake word,
  a time-constraint thread, a lock tried until its deadline where Linux has one that waits, the lock files
  of a forked child found without `/proc`). Everything Push-only fails softly, as it does on a stand-in:
  no ALSA, no Push surface, no Remote Script, no `/data`. The Push's build and its tests are unchanged.
- **The chain host and the first modules are built for the Mac** (`macos/build-modules.sh`): Schwung's chain
  host from its branch `worktree-vst`, Freeverb, the arpeggiator, Chord, the line input, Pung's MIDI sink,
  and Braids from the source the Push's build uses. A Mach-O library keeps the name `dsp.so`.
- **A real module sounds.** Through a host test (`playtest`, core's, built for the Mac): Braids at a peak of
  0.31 with every block sounding, Freeverb passing its tone, the arpeggiator 15 notes in and 20 out;
  Steinberg's validator passes on Pung's own devices (188 tests). **And in Live**: with the Mac-built Pung
  behind the Braids device that was open in Live, a chord played from Pung's interface peaked at -12.9 dB at
  the device, no block late (48 kHz, 512 frames; the Mac's output muted meanwhile).
- **A device at the host's rate** (`src/ratebridge.c`, in the shared loop; on a Push, at 44.1 kHz, it does
  nothing): the module renders its share of frames at 44.1 kHz and a windowed sinc of 32 points makes the
  host's of them; an effect's input goes the other way first. The plugin says the host's rate when it makes
  the device and when it changes, and tells the host the delay, which follows from rate and kind alone
  (17 frames for an instrument at 48 kHz, 42 for an effect). Tested (`TestRateBridge…`): 440 Hz stays
  440 Hz at five rates and five block sizes, at its level; 21 kHz taken down to 32 kHz is 40 dB down; an
  effect's round trip arrives after exactly the delay told. Measured through the whole chain with Braids
  holding A4: 440.18 Hz at 44.1 kHz, 440.09 at 48 kHz (blocks of 512 and of 64) and at 88.2 kHz, 439.72 at
  96 kHz (the measurement's own resolution).
- **P2: good numbers, not the last word.** Braids held for a minute at 48 kHz in blocks of 64 frames (1.3 ms
  each), the plugin's own count of blocks it gave up on: **none late in 25,618 blocks on an idle Mac, none in
  19,679 beside eight busy loops** (one a core), a block taking Pung at most 0.17 ms. Handing a block over
  and back takes about 50 microseconds. The host test that plays those blocks is an ordinary program and
  was itself held up by the busy loops (its own worst wait was 18 ms), so it says what Pung does, not what
  Live's audio thread sees. Still to do: the same count in Live at 64 frames beside a busy Set; and two
  things known to be weaker than on the Push, to be taken up if that count is not zero: a device's thread
  does not join the audio hardware's workgroup, and the lock it shares with Pung's other threads has no
  priority inheritance on a Mac.
- **The class file stands beside the bundle** (`Pung.classes.json` in the VST3 folder): written into a signed
  bundle it breaks the seal ("a sealed resource is missing or invalid").
- **Schwung has a desktop branch of its own** (`worktree-vst`, `desktop/`, its author's, September 2026):
  the chain host as one VST3 and AU plugin for Live (JUCE), one chain an instance, 512 macros bound to the
  loaded module's parameters, a rate bridge, a script that builds modules for the Mac, and Move's folders
  made to exist on a Mac by a system setting that needs an administrator. It is another shape than Pung's
  (no device a module, no fixed parameter order, no Set that crosses), but its module builds and its
  findings are directly useful, and its author should hear of this work early.
- **In Live with the new plugin** (after Live was closed and started again): the device says "host_rate
  48000" to Pung, Live reads 49 parameters (Braids' 45 beside two MIDI effects, and the four hidden ones), a
  chord sounds at the device at -12.8 dB, no block late.
- **Closing Live on the Mac without anyone at it.** Asked to quit with unsaved changes, Live asks about
  saving and stays; a key press cannot be sent to it (macOS wants the owner's permission for that). Ended as
  a process, Live asks at its next start whether to recover the Set. With the owner's word that the Set may
  go: end the process, then move `BaseFiles`, `Undo`, `Undo.lock`, `CrashRecoveryInfo.cfg` and
  `CrashDetection.cfg` out of `~/Library/Preferences/Ableton/Live <ver>/` (into its `Crash` folder, kept).
  Live then starts as after a clean exit.

Left on the Mac by the proof: `~/Library/Audio/Plug-Ins/VST3/Pung.vst3` and `Pung.classes.json` beside it,
`~/Library/Application Support/Pung/` (Pung's data, the socket), Pung running from `build/macos/dist`
(its page on 127.0.0.1:7733). Live is closed; two folders `set-aside-…` in its `Crash` folder hold the test
Sets' recovery data and can be deleted. Stopping Pung and removing the
bundle and the class file undoes it; Live then lists no Pung device.

## Decisions for the owner

1. **The contract's layout** (`docs/SET-CONTRACT.md`): the go for the one that fits Live's 127. Nothing of
   ambition 1 can be finished without it.
2. **Whose the plugin is.** Today it is Push Hack's, for Linux. For the Mac either the changes go upstream
   (one plugin for everybody, on their schedule), or Pung carries its own (what the independence from Push
   Hack asks for anyway). Recommended: Pung's own, kept source-compatible, offered upstream.
3. **An Apple Developer identity**, when others are to install it.
4. **Intel Macs**: left out unless asked for.

## Not in this design

Windows (the same shape, other system calls); other hosts than Live (Phase 4); accounts and the deployment
service (Phase 3); moving a Set's files between machines.
