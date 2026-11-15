# Sounds: one preset system for every Pung module

Status: design, 2026-11-15. Phase 1 is being built (see Phases). The facts below come from reading Schwung
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

- **Jog wheel: the next or previous sound** in the current source and bank, as now (built, 0.1.3). The
  header shows `PRESET A  6/128  POP PIANO 3` while it changes.
- **The sound's name is always on screen**, in the header beside the device: `MINI-JV  POP PIANO 3`, with
  `*` when edited.

### The browser (press the jog wheel)

```
 MINI-JV  > FACTORY > PRESET A                                  6 / 128   < 1/2 >
 ----------------------------------------------------------------------------------
  FACTORY   USER   FAVOURITES   RECENT  |      4  Rhodes Mk1
  PRESET A                              |      5  Pop Piano 2
  PRESET B                              |  >   6  Pop Piano 3            *  (playing)
  INTERNAL                              |      7  Stage EP
  CARD: POP                             |      8  #8
 ----------------------------------------------------------------------------------
  FAV      SAVE     SAVE AS   RENAME    DELETE   COMPARE    CANCEL     LOAD
```

| Control | In the browser |
|---|---|
| Jog turn | the next or previous sound; it plays (audition) after a short pause |
| Jog press | **keep it** and close the browser |
| Upper row | the source: Factory, User, Favourites, Recent |
| Encoder 1 | the bank (or category, or mode) |
| Encoder 2 | scroll fast, a page at a time |
| Encoder 8 | a tag filter (User and Favourites) |
| Lower row | Fav (star the highlighted sound), Save, Save As, Rename, Delete, Compare, Cancel, Load |
| Page < > | the previous or next bank |
| Shift + jog | ten sounds at a time |

- **Audition and undo.** Opening the browser takes a snapshot of the device (`<prefix>:state`). Scrolling
  plays each sound you stop on (after ~150 ms; a spin plays only where it stops). **Cancel** (or leaving
  the browser any other way) puts the snapshot back, exactly. **Load** or jog press keeps the sound. (How Live's undo history sees
  auditions is measured in phase 2: the goal is one undo step per sound kept.)
- **Compare** (held): the sound from before the browser while held, the highlighted one when released.
  Outside the browser, Compare toggles between the current sound and the last one kept.
- **Favourites** are a star on any row (`*` in slot colour), and a source of their own, across banks.
- **Edited** sounds show `*`; Save overwrites the user sound they came from (only a user sound), Save As
  makes a new one.

### Naming without a keyboard

Save As proposes a name, so most saves are one press: the sound it came from plus a number (`Pop Piano 3
2`), or the module's name and the date for a sound built from scratch. To change it, the panel becomes a
name editor:

- the eight encoders are eight letters of the name, each turning through `A-Z a-z 0-9 space - .`;
  the jog moves the eight-letter window along the name;
- the lower row: Space, Delete, Caps, Clear, a few suggested words (the module's categories, the factory
  name), Cancel, Done.

The web page has a real keyboard for long names, and renames anything at any time.

## On the web page

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
- Phase 4: each user sound also as a rack in the User Library next to the module (`Pung/Mini-JV/Fat
  Brass.adg`), so Push's own browser finds and loads it. The rack carries the device's state in Live's
  `ProcessorState`; that encoding is confirmed on the device first.

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
