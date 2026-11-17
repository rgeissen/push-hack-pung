# Files: samples, wavetables and kits for every Pung module

How a Schwung module that plays your own material gets it on a Push: the file browser on the Push and on
the web page, where the files live, and what a module has to say for it to work. Code: `src/files.go` (the
library), `src/audiofile.go` (reading audio), `src/filesession.go` (audition, Load, Cancel),
`src/files_view.go` (the Push), `src/files_web.go` and `src/web/files.js` (the web page).

## The idea

A module declares a parameter of type `filepath` (Schwung's contract, `docs/MODULES.md` there): a sample,
a wavetable, a kit. On Move the host opens a file browser inside one folder the module names. Until 0.2.0
Pung had no browser at all, so a sampler could not be given a sample (reported by Kago, 2026-11-17).

A Push has something Move has not: Live's own libraries on the same disk. So Pung does not copy Move's
one-folder browser. A file parameter is browsed across **places**, and a sampler on a Push reaches the
3,800 samples of the Core Library, the installed Packs, what your Sets recorded, and your User Library,
with nothing to copy first.

Measured on a Push 3 (Live 13 beta, 2026-11-17): five catalog modules use file parameters: MrSample,
Granny, MrDrums (one per pad, and a kit loader), Tablor (two wavetables) and Breakbeat (two loops). DR-32
and Magneto keep files in ways of their own and are not part of this.

## Principles

1. **One library.** Move's path for the user's files, `/data/UserData/UserLibrary`, is a link to Live's
   User Library (`ensureMoveUserLibrary`). A sample there has the same path on a Move and on a Push, so a
   sound saved on one opens on the other, and what you put in Live's User Library is there for every
   module. Pung never replaces a real folder at that path.
2. **Hearing is not choosing**, as in the sound browser (`docs/PRESETS.md`). A file plays where the cursor
   rests; it becomes the device's only on Load. Every other way out puts back the file from before.
3. **Only what can be loaded is shown.** The module's `filter` decides. A folder with nothing in it for
   this parameter is not listed at all, and a folder says how much it holds.
4. **A format is not the user's problem.** An audio file the module cannot read, where it reads WAV, is
   offered (`TO WAV`) and converted when chosen: ffmpeg, 16 bit, the file's own rate and channels, into
   `User Library/Samples/Converted`, once. A third of the Core Library is AIFF; Granny and Breakbeat read
   only WAV.
5. **The browser chooses, it does not manage.** It never renames or deletes: a file is somebody's file.
   It adds (the web page's upload) and stars.
6. **Pung reads and writes only the libraries.** The web doors refuse any path outside Live's libraries
   and Move's user folder, and Pung's own folder (ROMs, modules) whichever way a link points
   (`safeFilePath`, `TestWebFilePathsStayInTheLibraries`).

## Places

In the upper row's order (`placesFor`):

| Place | Folder | When |
|---|---|---|
| the module's own (`WAVETABLES`, `BREAKBEAT`, `TRACK PRESET`) | the parameter's `root`, where that is not the sample library or all of `/data`; for a kit, its `start_path` | first, if there is one |
| `USER LIB` | `User Library/Samples` | audio, or no place of its own |
| `CORE LIB` | the newest `Live N Core Library/Samples` | audio |
| `PACKS` | `Factory Packs` and `User Library/Packs`, as one list | audio |
| `SETS` | `Sets`: what your projects recorded, froze and consolidated | audio |
| `RECORDED` | `Live Recordings` | audio |
| `FAVOURITES`, `RECENT` | lists, shared by every module per kind of file (`data/files.json`) | always |

The browser opens at the device's file; with none, in the folder the module names if it holds anything;
else at the first place that does. An empty place is dim and says what would fill it.

## On the Push

A file parameter's cell on a device page is not a knob: the file's outline, with the page's start and end
(`wav_position` parameters that name it) drawn into it, and its name. A module lists a sample among a
level's parameters and not its knobs, so Pung puts it first on that level's page (`keysOf`): MrSample's
Sample page is the sample, then Start, Loop and the loop points.

**Turning the cell's encoder opens the browser.** A file is not turned through (a brush of an encoder
must not load another sample); the turn only opens, and from there nothing changes without Load.

```
 USER LIB   CORE LIB   PACKS   SETS   RECORDED   FAVOURITES   RECENT
 DRUMS       ENCODER 1 |   kick 1                 |  [ the outline of the file under the cursor   ]
   HATS             64 | > Kick 2         CURRENT |  [                                            ]
 > KICKS            48 |   Kick 3                 |  0:00.50   44.1 KHZ   16 BIT   STEREO   86 KB
   SNARES           31 |   Kick 4          TO WAV |  USER LIBRARY / DRUMS / KICKS
  FAV   PREVIEW ON   CURRENT   MRSAMPLE / SAMPLE   2 / 40   COMPARE   CANCEL   LOAD
```

| Control | In the browser |
|---|---|
| Jog turn | the list (a file plays once the hand rests on it, 150 ms); Shift: ten at a time. With the hands on the places: the places |
| Jog press, D-pad centre | into the folder; on a file, **Load** and close |
| Jog nudge left, D-pad left | up a folder, back on the row it left; at a place's top to the places; from there out (Cancel) |
| Jog nudge right, D-pad right | into the folder |
| Encoder 1 | the folder beside the shown one (the panel on the left) |
| Encoders 2 to 8 | the list, as the jog |
| Page < > | a screen of the list |
| Upper row | straight to a place |
| Lower row | Fav; Preview on or off (kept); Current: to the device's own file; Compare (held: the file from before); Cancel; Load |

- **What you hear.** With Preview on, Pung plays the file itself through the device's output, as Push's
  own browser previews (`previewVoice`: up to 30 s, faded at both ends, one voice). Where the module says
  `live_preview`, the file is also put into the instrument while the cursor rests, so the pads play it
  with the device's settings; Cancel sets the file from before again. A file that would have to be
  converted is only played: nothing is written for a look.
- **The module's `browser_hooks`** (`on_open`, `on_preview`, `on_cancel`, `on_commit`, with `$path` and
  `$filename`) run at those moments, and what they asked to be restored is put back on the way out.
  MrDrums stops following the played pad while its sample is chosen.
- The outline is read natively for WAV and AIFF in every form Live's libraries hold (PCM 8 to 32 bit,
  float, extensible; AIFC twos, sowt, fl32), sampled for long files, cached; other formats through ffmpeg.
- Leaving any other way (another device, another track, Push taking the screen) is Cancel.

## On the web page

The same places, lists, outline and rules, in a dialog opened from the parameter's control (which shows
the file's outline and name). What the page adds:

- **Search** a place by words in the name or the folder.
- **Listen here**: the file itself in this browser; a click in the outline starts there.
- **Add files**: drop them on the list, or choose them. They go into the folder shown, if it is in the
  User Library or the module's own folder; nowhere else. A file the device does not load is refused by
  name.
- Arrow keys play, Enter loads or opens a folder, Backspace goes up, Escape cancels. A page that goes
  away without Cancel is cancelled after five minutes.

## What a module has to say

Nothing new: Schwung's `filepath` contract. `root`, `start_path`, `filter`, `live_preview`,
`browser_hooks` are read as written. `wav_position` (`filepath_param`, `mode`, `display_unit`) is a number
like any other in Live (automatable), and is drawn on the file's outline. Paths are stored as the module
gets them: absolute; a User Library file in Move's words (`portablePath`).

## Open

- The lower buttons 4 and 5 are free (a caption sits there): room for sort order or "show in place".
- A sound's files travel with a Set only as paths. A Set opened on another Push needs the same files in
  the same places: Collect is Live's word for what is missing here.
- Folders that hold thousands of files are listed whole (the Core Library's largest holds a few hundred).
