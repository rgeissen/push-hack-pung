# The Set contract: one parameter order for every Pung

A design, decided on 2026-11-27 ("I trust all your recommendation": 64 entries for the MIDI generators, new
devices beside the old, "MIDI FX n" in Live's lists). Being built in the order given at the end; what is
done says so. It is the second of the contract's five clauses (below), the one fixed first.

## The five clauses

For a Set saved in one place to open the same in another, five things must hold.

1. **Identity.** A module is the same device everywhere. *Holds:* its identifier in Live is made from its
   kind and its id alone (`livedevice.ClassUID`, `src/devices.go`).
2. **Parameter positions.** Live stores automation, clip envelopes and MIDI and Macro mappings by a
   parameter's position in the device (`src/stablelayout.go`: giving parameters ids of their own crashed Live
   13). *Does not hold:* an instrument's list also carries the parameters of every MIDI effect installed on
   that machine, and each installation keeps the order it grew with (`classes-known.json`). Two Pungs with
   different histories can disagree, and a Set then plays its automation on a neighbouring control. **This is
   the one clause that gets more expensive with every Set saved**, so it is fixed first (this document).
3. **State.** What a device saves must mean the same elsewhere. *Mostly holds:* a module's state is its own.
   *Does not:* a device's state names its MIDI effect by its place in that machine's list (found while
   building patches, 2026-11-27), and samples by their path.
4. **Versions.** A Set saved with a module's version opens with a later one. *Assumed, not checked:* nothing
   tests that a module still reads the state its previous version wrote.
5. **What lies outside the Set.** Modules, firmware, samples, saved sounds. *Does not hold:* nothing says what
   a Set needs, or brings it along. Firmware never travels: it is named, and must be the player's own.

## What it must do

Live stores automation, clip envelopes and MIDI and Macro mappings by a parameter's position in its device
(`src/stablelayout.go`). For a Set to open the same on another Push, and later in Live on a computer, **a
module must have every parameter at the same position on every Pung**, whatever else is installed there and
in whatever order it came.

It must also leave every Set that exists today exactly as it is.

And it must not be Live's alone (the owner's word, 2026-11-27: other DAWs may host Pung later). So what is
fixed is **a number for each parameter of a module, for good**. The plugin gives that number to a host twice:
as the parameter's position, which is what Live goes by, and as the parameter's id, which is what most other
hosts go by. A registry of numbers serves both; "position" below means that number.

## What was measured

On the owner's Push, 2026-11-27 (`classes-known.json`, the module pack, the Sets on its disk):

- Live knows 104 Pung devices there: 73 instruments, 8 MIDI generators as devices of their own, 23 audio
  effects.
- An instrument's list is: its own parameters in the order of its pages; then the MIDI FX selector; then the
  parameters of the MIDI generators installed on that machine; then padding. Between 159 and 255 entries, of
  256 a device may have.
- **Own parameters:** median 80; 27 instruments have more than 120; the most are Vivace 186, Mini-JV 183,
  OsTIrus 175, Forge 170, Surge XT and Xenia 169.
- **The MIDI generators' part depends on the machine and on the instrument.** Eight are installed there, with
  1 to 56 parameters each (Stacks 56, Acid 31, Branchage 27). A small instrument carries all of them (146
  entries); a large one only the first seven of each (Dexed: 45).
- **The module pack has ten other MIDI generators**, with 3 to 82 parameters (Eucalypso 82, Euclidrum 39,
  SuperArp 33).
- The selector's value is a place in that machine's list of installed MIDI generators.
- 16 Sets on that Push hold Pung devices.

So positions differ between two Pungs for three reasons: which MIDI generators are installed, the order in
which modules and parameters arrived (a new one is put after all the others on that machine), and the
selector's own meaning. And the simple remedy, every MIDI generator's parameters in one fixed order inside
every instrument, cannot work: eighteen generators with up to 82 parameters each do not fit beside an
instrument's 186.

## The design

### 1. One layout for a kind of device, the same everywhere

An instrument, 256 positions:

| Positions | What | How many |
|---|---|---|
| 0 to 191 | The module's own parameters, in the order the registry gives (below), then the empty entries its pages are filled up with | 192 (24 pages) |
| 192 | The MIDI FX selector | 1 |
| 193 to 255 | General MIDI-effect slots | 63 |

This is the split today's large instruments already have (measured: their own pages take exactly 192 entries
and the MIDI generators' pages 64), so no instrument has fewer of its own parameters in Live than now. The
MIDI part is eight whole pages.

- **The general slots** take their meaning from the MIDI generator that is selected: slot *k* is that
  generator's parameter *k* in its own registry order. A Set says which generator is selected, so a slot's
  automation always means the same control. In Live's lists they are named "MIDI FX 1" to "MIDI FX 63"; Pung's
  view and its web page show the real names, as now.
- **The selector** has a fixed number of steps (64): none, then the generators in the registry's order, each
  at its place for good, installed or not. Today its steps are the installed ones, so its value means
  something else on every machine, and would shift whenever one is added.
- **An audio effect and a MIDI generator as a device of its own:** their own parameters in registry order;
  what Pung adds (the MIDI output channel) at a fixed place at the end.
- The registry's order keeps the module's pages whole, as today's does, so Push's own device view shows the
  same pages.

**What Live has of an instrument is another matter than its numbers.** Live takes the first 127 entries of
the list a device's rack gives it, in that list's order, wherever they sit among the 256 ("What the Push
said", 2). So the list is: the instrument's first twelve pages (96 entries), the selector and the slots, then
its later pages. Every instrument has the selector and at least thirty slots in Live (30 with twelve pages
or more of its own, 38, 46, 54 with eleven, ten, nine, and 62 or all 63 with eight or fewer). The numbers
are the same either way: what a Set stores does not depend on how much of a device Live lists.

What this gives and takes, against today:

| | Today | With the contract |
|---|---|---|
| A MIDI generator's parameters in Live | 7 on a large instrument, all on a small one; named ("Arp Rate") | The first 30 on every instrument, up to 63 on a small one; named "MIDI FX n" |
| A generator with more than that (Eucalypso: 82) | All on a small instrument | The rest in Pung's view only |
| An instrument's own parameters in Live | Its first sixteen pages, less one entry | Its first twelve pages; all of them for 44 of the 77 instruments |
| The MIDI FX selector in Live | On 42 of the owner's 67 instruments | On every instrument |
| The same position on every Pung | No | Yes |

### 2. The registry

One list per module: its parameters' identities (their keys) in a fixed order. It is in this repository, and
travels in the module pack beside the catalog, signed with it.

- **Append-only.** A new parameter goes to the end. One that is gone leaves its place empty. The catalog
  build refuses a registry that changes in any other way, as it refuses a package that changes under a
  version.
- **Seeded once from a deployment that has everything.** Pung writes out the order it gives each module
  today when it builds a device afresh. It has to come from a real deployment: the emulators say what
  parameters they have only with their firmware present. The registry holds names of controls, never
  anything of the firmware.
- **Pung builds a device from the registry, not from what it finds.** A parameter the module has and the
  registry does not is reached in Pung's view and is not Live's until a release appends it. A module with no
  registry (installed by hand, a maker's build) gets a local order, and its stack says "not portable yet".
- The MIDI generators' place in the selector is a registry of the same kind.

### 3. A new identity for these devices, and the old ones kept

A device built by the contract is a different device to Live than today's: its identifier comes from a
second namespace. Today's devices stay on the installations that have them, with the identifiers and the
order they have, and serve the Sets saved with them. They are no longer offered in Push's browser; the
browser's entries, the saved sounds' entries and new patches point to the new devices.

- **Every existing Set opens as it does now.** Nothing in it moves, because nothing about its devices
  changes. It is as portable as it was: not.
- **A Set saved from this release on is portable.**
- A fresh installation has only the new devices.

Why not change the existing devices in place: any change of their order moves the automation in every Set
saved with them (measured on 2026-11-23). Why not rewrite the Sets: it is possible in principle (a Set is
compressed XML that names each parameter by its position), but it touches a player's work and Live's
recovery replays a Set's history. It can be offered later as a tool a player runs on a copy.

### 4. The state

A device's state names its MIDI generator by id, not by its place in the machine's list. The place is still
read from states written before.

## What a player notices

- Nothing in existing Sets.
- In Live's automation and mapping lists, a MIDI generator's parameters read "MIDI FX 3" in place of "Arp
  Rate". In Pung's view they read as before.
- On an installation from before, Live's own plugin list (not Push's browser) holds each module twice until
  the old Sets are no longer needed.

## What was considered and left

- **Every generator's parameters by name in every instrument:** does not fit (above).
- **A MIDI generator always as its own device in front of the instrument:** Live does not pass a plugin's
  notes to the next device on a track; it needs a second track. That form exists (the "Track" devices) and
  stays, beside the one inside the instrument.
- **Parameter ids of their own in place of positions:** crashed Live 13.0b25 when a parameter moved
  (`docs/NATIVE-MODULES.md`, rule 6).
- **No MIDI-generator parameters in Live at all, only the selector:** the simplest, and automation of an
  arpeggiator from Live would be gone.

## To be measured on a Push before it is built

Each needs Live restarted, in a throwaway Set, on the owner's word.

1. Live with twice the devices in the plugin on an installation from before (about 200): the scan, the
   browser, memory.
2. Automation recorded and played at positions 191 to 255. (Live 13.0b25 showed the Remote Script nothing of
   a device with more than 64 visible parameters; Pung's view plays them regardless. The selector sits at
   147 to 186 today.)
3. A selector of 64 steps, most of them empty: how Live and Push show it.
4. Whether Live follows a parameter's name when the plugin changes it. If it does, the general slots can
   carry the selected generator's names. A gain, not a condition.

## What the Push said (2026-11-27)

Measured on the owner's Push (Live 13.0b25) in a throwaway Set, the contract switched on with the file
`set-contract`, then off again and the installation's device table put back.

1. **Twice the devices: no trouble.** 192 devices in the plugin (87 by the contract, 87 kept from before as
   "… (old)", 18 in a local order) against 105. Live started as before (76 s for Pung and Live together,
   56 s for Live alone earlier that day) and held 689 MB against 675 MB. A device recovered from before the
   switch came back as its "(old)" device, as it must.
2. **Live takes the first 127 entries of the rack's list, in the list's order; a parameter's number does
   not matter for it.** A contract Dexed of 256 entries: Live logs "parameter count is 260" and gives the
   Remote Script 128 parameters, "Device On" and 127 more, ending at "Op4 Vel", "Op4 AMS", "Op4 RS". Those
   are the last of Dexed's sixteenth page: numbers 91 to 93. Among the 127 are 33 fillers of its pages,
   which sit at numbers 147 and up. So Live did not take numbers 0 to 126 (it would have ended at
   "Op5 RC", number 126): it took the list as the rack orders it (`sclass.order`, core's `paramOrder`),
   cut after 127.
   *This was first read wrongly* (2026-11-27: "positions 191 to 255 are out of Live's reach", and a layout
   proposed that moved the selector and thirty slots to numbers 96 to 126). Only the Dexed had been looked
   at, and its list happens to hold nothing of the MIDI part within 127 entries either way. Laid out again
   on 2026-11-28 from the kept probe record, the list's 127th entry is number 93, as the Push showed.
   What follows from it: **the numbers stay as designed** (the selector at 192, 63 slots behind it), the
   identity stays `pung-set-1`, and only the list's order changes: the MIDI part stands after an
   instrument's twelfth page (`contractOwnPagesFirst`). `TestLiveHasTheSelectorOfEveryInstrument` lays
   out all 77 instruments of the registry from their real pages: every one has the selector and thirty
   slots or more among the 127, and 44 have every parameter of their own there.
   *Still to be seen on a Push:* a small instrument's selector and slots in Live's own lists, automated
   and mapped (numbers from 192 on, listed early).
3. **The 64-step selector:** not seen yet. To be looked at with the list's new order.
4. **Whether Live follows a changed name:** not measured. It needs a plugin that renames a parameter while
   it runs, which core's plugin does not do yet.

Two things learned beside the measurements, both about testing on a Push:

- **What the Remote Script deletes is not in Live's recovery history.** A device loaded and deleted through
  the Remote Script comes back when Live recovers the Set (a Mini-JV from a play test in the morning stood
  on its track again after the evening's restart).
- **A recovery that meets a device whose class is gone crashes Live** ("While recovering your work, Live
  crashed again"): the recovered Set held a contract Dexed, and the contract had been switched off. Answered
  No (the button under it, CC 26; `restart-live.sh` leaves that question to a person), Live opened a fresh
  Set. This is why such tests run in a throwaway Set.

## How it would be built

In this order; each step is small and tested before the next.

1. **Done (2026-11-27).** Pung writes out every module's own pages against the kind's room
   (`GET /api/layouts`, `src/layouts.go`: from the module alone); `src/registry.json` is seeded from it by
   `scripts/registry.py`: from a stand-in with every module of the pack for all that need no firmware, from
   the owner's Push for the seven emulators. 135 modules, every one of the catalog; twelve MIDI generators
   in the selector's order. What the seeding showed: taken from the devices as they stood, two
   installations disagreed on 50 of 86 modules (a large instrument's own pages shrink with every MIDI
   generator installed, and small modules came in another order); computed from the module alone they
   agree on 85, and the one that differs is Osirus, which names one more parameter where its firmware is.
   `registry.py check` refuses a registry that is not an append of the one before.
2. **Done (2026-11-27).** The layout from the registry (`src/contract.go`, `contractClass`; the registry
   is built into Pung, `registry.json`), with the tests that matter (`contract_test.go`): the same
   registry gives the same positions whatever MIDI generators are installed and in whatever order the
   module lists its parameters; a parameter the registry does not name is not Live's; one the module no
   longer has leaves its place empty; every module of the shipped registry fits its kind of device and
   passes the plugin's own check. Nothing builds devices this way yet.
3. **Built, behind a switch (2026-11-27).** The new devices beside the old (`withContract`, `contract.go`):
   a module the registry knows gets its contract device; the device from before stays where the
   installation had it, named "… (old)", with no browser entry; a module the registry does not know keeps
   its device in its local order. At run time a general slot sets and reports the selected generator's
   parameter of its number, and a step of the selector whose generator is not installed plays none. A MIDI
   generator chosen on Pung's side is now known to the device and to the host's selector (it was not). On
   only where asked for (`PUNG_SET_CONTRACT=1`, or a file `set-contract` in Pung's data folder): the
   devices in Live are as before until the measurements are made. Checked on a stand-in without Live: 15
   devices by the contract and 15 kept from before; Dexed with 256 entries, the selector at 192 with 64
   steps, 63 slots; a patch taken and loaded keeps its generator.
   Still to do before it is on for everyone: what the browser's entries point to while a Live that has
   not restarted knows only the old devices.
4. **Holds for the new devices.** A contract device's state names its MIDI generator by the registry's
   step, which is the same everywhere; a patch names it by id. States of the old devices keep their
   machine's place, as their Sets do.
5. **Done (2026-11-27).** The registry travels in `catalog.json`, so under the pack's signature. The
   catalog build refuses a registry that is not the last one grown at its ends, and a published module
   without an entry. Pung lays devices out by the registry it was built with, or by one a pack on its disk
   carries that is the same grown at its ends (`currentRegistry`: read from the disk, never waited for).
6. **Done (2026-11-27, read again 2026-11-28)** ("What the Push said", above): Live goes by the list's
   order, so the MIDI part stands after an instrument's twelfth page in it (built 2026-11-28); the numbers
   are untouched. To be seen on a Push: the selector and slots of a small and of a large instrument in
   Live's lists, and measurements 3 and 4.
7. The test this ends with: one Set with automation, opened on the same Push in two conditions (all MIDI
   generators installed; some removed and installed again in another order), the automation on the same
   controls both times. A second Push would be the better witness.

## Not only Live

- The registry and the layout are Pung's and say nothing of Live: they are how a module's controls are
  numbered in any plugin format (a VST3 parameter id, an Audio Unit parameter address, a CLAP parameter id).
- What is Live's in this design, and only that: that positions matter at all (a host that goes by ids would
  forgive a reordering; the numbers are fixed anyway), the limit of 256 and what Live shows of it, and
  Push's pages of eight.
- The second namespace is named for the contract, not for a host, so a module is the same device in every
  host that loads the plugin.
- A stack records the registry's version it was saved with, so a later host can tell a project from before
  the contract.

## Decisions for the owner

Decided on 2026-11-27 (1 to 3 as recommended); kept here for the record.

1. **64 general slots** for the selected MIDI generator (recommended), or 32, or none?
2. **New devices beside the old** (recommended), accepting that Sets saved before stay bound to their
   machine, or a conversion of existing Sets as part of the groundwork?
3. **"MIDI FX n" in Live's lists** for a MIDI generator's parameters: acceptable?
4. **Live restarted on the Push** in a throwaway Set for the measurements: when?
