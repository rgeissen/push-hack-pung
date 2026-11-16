# Sounds: one preset system for every Pung module

Status: 2026-11-15. All four phases are built and tested on the device: the library, the Push, the web page (the Sound section, the Sounds library, import and export) and Push's own browser. The facts below come from reading Schwung
(`src/shadow/shadow_ui_presets.mjs`, `src/shared/param_pages/`) and every chain module in the catalog (110:
55 instruments, 41 audio effects, 14 MIDI effects).

## The idea

A Move module brings its sounds in its own way, or not at all. Mini-JV has 4,133 in banks and modes,
JE-8086 has patch and performance banks read from your files, Surge has categories, aphex keeps 41 in a
knob, CloudSeed has none. Each is reached differently, and most cannot even say a sound's name without
loading it.

Pung gives every module **one way to find, try, keep and recall sounds**, the same on every device, on the
Push and on the web page. It is built on Schwung's own user presets, file for file, so a sound saved on
Move opens on the Push and the other way round, and adds what a world-class instrument library needs:
names before you load, favourites, recents, tags, audition with an undo, compare, and a library you can
search, back up and share.

## Principles

1. **Schwung is the baseline, and stays whole.** Pung reads and writes Schwung's user preset files exactly
   (format, names, folders). Everything Pung adds lives beside them or in fields Move ignores, and
   everything degrades to the baseline without it.
2. **One browser for every module.** The same screens, buttons and words whether the module has 4,133
   factory sounds, 41, or none. What differs is only what the module can offer.
3. **Hear before you commit, and always get back.** Browsing auditions; leaving the browser without
   choosing restores the sound you had, exactly. Nothing is lost by looking.
4. **The module decides what a sound is.** A module's own list is used as the module declares it; Pung
   never guesses that a knob is a preset list. Where the contract is unusual, a small table in Pung
   describes it (`overrides/presets.json`), never code per module.
5. **Never block the hands.** A preset load can take seconds (a ROM swap, a sample load); it runs off the
   input thread, latest request wins, and the screen says what is happening.

## What a module offers (measured)

| Offer | Modules | How Pung reads it |
|---|---|---|
| A factory list: index, count, name of the current one | 30 (`list_param`/`count_param`/`name_param` in `ui_hierarchy`, or the bare `preset`/`preset_count`/`preset_name`) | the module's contract; names learned as they are heard (below) |
| ... with banks that change the list | 10 (Dexed, OB-Xd, NoiseMaker, SF2, SFZ, Osirus, JE-8086, Mini-JV, dr32, MIDIVerb) | the bank level (`items_param` -> `select_param`), or a bank knob |
| ... with categories | Surge, Helm (`category_list`, `jump_to_category`) | as banks |
| ... with modes (patch, performance) | Mini-JV, JE-8086 (`modes`, `mode_param`) | one source per mode |
| Presets as a knob with names | 15 (aphex, denis, essaim, fizzik, palette, spectra, war_bells, ...) | the knob's options: every name known up front |
| Only a state (no factory list) | 55 | user sounds only |
| No state at all | 6 (forgetful, wayward, streamrtsp, branchage, maze_seq_lite, pixel-walkers) | no sounds; the browser says so |

Not presets, though they look like lists: Clap's effect picker (`plugin_*`), Ambiotica's algorithm
(`mode_*`), MIDI Player's file (`file_*`), and sub-presets inside a sound (Plaits `fm_preset`, superarp
`pattern_preset`, ...). These stay knobs.

Quirks the generic reader must survive, each a row in `overrides/presets.json`: a 1-based index
(palette), a read that answers a name where a number is expected (psxverb, aphex, ...), a count of `-1`
while a bank loads (JE-8086), a name that reads `Loading...` for a while (Mini-JV), `Edited` for a
changed sound (bouba-kiki), and SFZ ignoring the first preset write after a bank change.

## The library

### Sources

A device's sounds come from up to four sources, always in this order:

| Source | What | Where |
|---|---|---|
| **Factory** | the module's own list, in its banks or modes | the module |
| **User** | sounds you saved, Schwung's user presets | `presets/<module-id>/*.json` |
| **Favourites** | sounds of either kind you starred | Pung's library index |
| **Recent** | the last 32 sounds you chose on this module | Pung's library index |

### User sounds: Schwung's file, unchanged

`/data/UserData/schwung/presets/<module-id>/<file>.json`, which on the Push is Pung's own folder (Pung
links `/data/UserData/schwung` to itself). One file per sound, written exactly as Move writes it:

```json
{"name":"Fat Brass","module":"obxd","version":1,"state":{"preset":12,"cutoff":0.42}}
```

- `name` first, always: Move reads the name from the file's text, not by parsing it.
- `state` is the module's `<prefix>:state`: inline if it is JSON, a JSON string if not.
- File name: the name without `/`, `\` and control characters, `Preset` if nothing is left; a clash adds
  ` 2`, ` 3`. A name clash (case-insensitive) adds the same to the name. **Save As never overwrites.**
- A sound is found by its `name`, never by its file name.
- `track_presets/` in that folder is Move's, not a module's.
- Loading writes `<prefix>:state` once, then reads it back (a module may normalise it).

**What Pung adds to the file:** a `"pung"` object after `state`: `{"created": ..., "tags": [...],
"from": {"source": "factory", "bank": "Preset A", "index": 5, "name": "Pop Piano 3"}}`. Move ignores it.
When Move saves the same sound again, it writes its four keys and the object is gone; Pung's index (below)
still knows the sound by name, and keeps its tags.

### Pung's library index

`presets/<module-id>/.pung` (no `.json` ending, so Move does not list it), one JSON document per module:

```json
{"version": 1,
 "favourites": [{"source": "factory", "bank": "Preset A", "index": 5, "name": "Pop Piano 3"},
                {"source": "user", "name": "Fat Brass"}],
 "recent": [ ...same shape, newest first, at most 32... ],
 "tags": {"user:Fat Brass": ["brass", "lead"]},
 "names": {"factory/Preset A": {"0": "A.Piano 1", "5": "Pop Piano 3"}}}
```

`names` is what makes the factory list readable: almost no module can name a sound without loading it,
so Pung **learns names as they are heard** (every browse, jog step and Live automation of the preset knob
that reports a name) and keeps them. A module that can name any index (`patch_name:N`, `preset_name_N`,
`plugin_N_name`, `preset_list`, `kit_names_all`, a knob's options) fills the whole list at once. A row
whose name is not known yet shows its number, never a guess.

### The current sound

Each Pung device remembers, in its own state (saved with the Live Set), which sound it is:
`{source, bank, index, name, hash}`. `hash` is Schwung's (FNV-1a over the state string) taken when the
sound was loaded; a later state that differs marks the sound **edited** (`* Fat Brass`), as Move does.

## On the Push

### Without opening anything

- The jog wheel no longer steps sounds outside the browser (it did until 0.1.9): in Pung's view it is
  Push's own, a focus along the devices and the pages of the open one, and a brush of it must not load
  another sound.
- **The sound's name is always on screen**, in the header beside the device: `MINI-JV  POP PIANO 3`, with
  `*` when edited.

### The browser (SOUNDS, upper button 8 of the open device, or a jog press there)

Built in phase 2 and tested on the Push with Mini-JV (`src/sounds_view.go`; the frames are in
`TestSoundBrowserKeepsItsText`, `PUNG_GALLERY=dir` writes them).

```
 FACTORY  USER  FAVOURITES  RECENT           MINI-JV  /  02 ORCHESTRAL - CS 0X3F0E09E2   343 / 4133
 BANK            ENCODER 1 |   341  Vl Sect mono
   01 POP - CS 0X3F1CF705  |   342  Arco Violins
 > 02 ORCHESTRAL - CS ...  | > 343  Marcato Vls1            02 ORCHESTRAL - CS 0X3F0.  PLAYING
   03 PIANO - CS 0X3F8D... |   344  -
   04 VINTAGE SYNTH - ...  |   345  -
  FAV    SAVE    SAVE AS    RENAME    DELETE    COMPARE    CANCEL    LOAD
```

The jog works as it does in Push's own browser (Push 3 manual, 4.1 and 5.3): **turn** to move, **press** to
select, **nudge left** to go back, **nudge right** for the highlighted item's options. The browser is a
hierarchy, **Source > Bank > Sound**; it opens on the sounds, at the device's sound.

| Control | In the browser |
|---|---|
| Jog turn | within the level the hands are on: a source (nothing plays), a bank (highlighted only), a sound (it plays once the hand rests on it, 150 ms, so a spin plays only where it stops) |
| Shift + jog | ten sounds at a time |
| Jog press, D-pad centre | down a level (into a source, into the bank highlighted); on a sound, **load** it and close |
| Jog nudge left, D-pad left | back up a level |
| Jog nudge right, D-pad right | on a sound, its **context menu**: Add to / Remove from favourites, Save, Save as..., Rename..., Delete (which asks first, Keep it highlighted); on a source or a bank, down a level |
| Encoders 2 to 8 | the sounds, as the jog |
| Encoder 1, Page < > | the bank directly (a bank chooser changes the list; a category or expansion card jumps within it) |
| Upper row 1 to 4 | straight to a source's sounds |
| Lower row | Fav, Save, Save As, Rename, Delete, Compare (held), Cancel, Load: the same, one press away; a button with nothing to do is dim |

The level the hands are on wears the slot colour's frame; the others show their choice shaded. A bank is
applied only when the hands turned to it: going down through the bank shown changes nothing you hear.

- **Audition and undo.** Opening the browser takes the device's state; **Cancel**, and leaving the browser
  any way but Load (another device, another track, Push taking the screen), puts it back. Loads run off the
  input thread, one at a time, latest first.
- **Compare**, held: the sound from before the browser; released: the auditioned one again (measured: 342,
  341 while held, 342).
- **Save** writes the device's state over the user sound it is. It is off while another sound is
  auditioned (it would write the audition over yours); **Save As** always works and lands you on the new
  sound in User.
- **Delete** asks for a second press within 3 s. A deleted sound leaves Favourites and Recent, and is no
  longer the device's.
- A sound whose name was never heard shows a dash beside its number: no name is guessed.
- The header of the Pung view names the device's sound beside the page, with `*` once it is edited
  (checked every 2 s).
- **Save** (Push's button) in the Pung view saves the device's sound: the name editor at once, the sound
  and its rack in Push's browser on Done, back to the Pung view on Done or Cancel. The Set is saved in
  Push's own view (Device, then Save): Push's Save dialog would be under the Pung view.
- Still to measure: how Live's undo history sees auditions (the goal: one step per sound kept).

### Naming without a keyboard

Save As proposes a name, so most saves are one press: the sound it came from plus a number (`Pop Piano 3
2`), or the module's name and the date for a sound built from scratch. To change it, the panel becomes a
name editor:

- as Push's own text entry, the jog **turns** the letter at the cursor and a **nudge** left or right moves
  the cursor (one past the end adds a letter); **press** is Done;
- and, faster, the eight encoders are eight letters of the name, each turning through a space, `A-Z a-z
  0-9` and `- _ . ' & ( ) + # !`; the eight are underlined in the whole name above; turning past the end
  adds the next letter (never a gap);
- the lower row: Space (after the letter last turned), Delete (that letter), Caps (its other case), Clear,
  Suggest (the proposed name back), Cancel, Done; the jog press is Done too.

The web page has a real keyboard for long names, and renames anything at any time.

## On the web page

Built (src/web/sounds.js), above the device's panel, and tested in a browser against the Push:

- the device's sound (with `*` when edited); Factory, User, Favourites, Recent; the bank; a search over
  every name (`organ`: 12 of 4133, each at its own number);
- a list drawn as a window of rows, so 4133 is as quick as 4: click or arrows audition (150 ms), Enter or
  a double click keeps, Escape puts back the sound from before; a star, rename and delete (which asks in
  the row) on each; Compare held; Save; Save As with the name in place, suggested as on the Push;
- Export (a zip of Move's own preset files) and Import (a zip or .json files: from an export, or from a
  Move's `presets/<module>/`; never overwriting, another module's sounds left out);
- it follows the Push: what the Push auditions shows as playing here.

The **Sounds** view (src/web/library.js, `/api/library`) is every module's library at once: each
module with its sounds and favourite factory sounds, a search over all of them, a star, rename and
delete in place, *Load on* any Pung device in Live that runs the module; **Export all** is a zip in a
Move's own layout (`presets/<module>/<name>.json`), **Import** takes one (or a module's export, or a
Move's presets folder) and files every sound in the module it names. Tested in a browser against the
Push: rename, star, load, delete, and a whole-library round trip.

Planned when this was written:

A **Sounds** section for the selected device, and a **Library** page for all modules:

- the four sources, banks as groups, every name Pung knows; search across names and tags;
- click to audition (the Push follows), double-click to keep; Cancel restores, as on the Push;
- star, tag, rename, delete, Save As with a keyboard;
- **export** a module's sounds as a zip of Schwung preset files, the same folder Move uses (and so
  importable on Move), and **import** one (Move's folder, or another Pung's export). A clash on import is
  renamed, never overwritten.

## In Live

- The device's **Preset** parameter (a Live parameter where the module has a factory list) can be
  automated and is on Push's own Bank pages, as now.
- **Every user sound is a rack in Push's own browser** (phase 4, `src/sounds_racks.go`): User Library ›
  Presets › Instruments › Pung › *Module* › *Sound*, beside the module's own rack. Loading it brings the
  device with that sound, and the device knows it (its header, its browser). The rack is the module's
  rack with the device state in `<ProcessorState>`, upper-case hex, 40 bytes a line, a little-endian
  length first: measured on a rack Push saved. Saving, renaming, deleting and importing keep the racks
  in step; Pung replaces or removes only the racks it wrote (`.pung-racks` lists them).
- A rack Push's own Save puts into Pung's folder (beside the rack it came from) is the user's: core
  v0.6.0's `WritePresets` removes every non-class rack there, so Pung keeps them across it
  (`keepForeignRacks`) until core removes only what it wrote.

## Phases

1. **Library core** (Go, tested without a device): the source reader with `overrides/presets.json`,
   Schwung-compatible user sounds (read, Save As, Save, delete, rename), the index (favourites, recents,
   names, tags), the audition engine (snapshot, latest-wins load, restore), and an HTTP API for all of it.
2. **The Push**: the browser, the name in the header, Compare, the name editor; the manual and the UX
   guidelines.
3. **The web page**: Sounds and Library, search, import and export.
4. **Push's browser**: user sounds as racks with their state.

## Open questions

- Does Live keep a VST3's `ProcessorState` in an `.adg` the way it does in a Set, and does Push load such a
  rack with its state? (Phase 4; measured first.)
- Program changes: should MIDI program change pick from Favourites? (After phase 3.)
