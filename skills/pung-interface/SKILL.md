---
name: pung-interface
description: Design and write the Ableton Push 3 interface of a Pung module, its push_ui.js file - the instrument's theme, readable values, pages and compartments, widgets, band screens, front panels with segments, Pung's live envelope, filter and LFO pictures and modulation display. Use when asked to create, improve or review a module's screen, front panel, widget, theme or page layout for Pung, or to check one against Pung's UX guidelines.
---

# A Pung module's interface on the Push

Pung runs open instrument modules as Ableton Live devices on a Push 3 and draws them on the Push's
screen (960 x 160 pixels, eight encoders under it, a row of buttons above and below). A module gets a
complete, playable page from Pung with no Push code at all: **Pung Default**. A file named `push_ui.js`
adds to it, up to a front panel that draws the whole instrument: **Pung Custom**.

Your work is that one file. It only draws: Pung owns every encoder, button and value.

## Read first

- `references/overrides.md`: the whole API (`push.*`, `g.*`, `v`), with every option. Read it before
  writing any code; do not guess a call from its name.
- `references/UX-GUIDELINES.md`: what good looks like. For a screen file read section 3 (the screen: its
  geometry, colour, type; "The controls" only for a front panel), in section 4 "Recognized structures"
  and "States", section 5 (custom screens: the bar and the rules), in section 7 "Live pictures", and
  section 8 (the review checklist). The rest is about Pung's own pages and its web page: skip it.
- `examples/theme-only.js`: the smallest useful file. `examples/theme-and-values.js`: a theme, and the
  module's bare numbers given their units. `examples/front-panel.js`: a complete front panel with
  segments, as shipped.

The references are copies of documents in Pung's repository (`docs/`); where they cite another document
or a source file, it is there: https://github.com/rgeissen/push-hack-pung

## What you need to know about the module

Its parameters (`chain_params`: each key with its name, type, range, options) and its pages
(`ui_hierarchy`). They are what the module answers; take them from

- the module's source (it builds these two answers), or
- `scripts/screens/probes.json` in Pung's repository, which holds both for every module of Pung's pack
  (`<id>` > `probe` > `meta`), or
- a Push that has the module: `/data/push-hack/data/pung/module-screen.json`, the same shape.

And the instrument itself: how the original is laid out and how it speaks of its parts.

## Look at the default first

Before writing anything, see what the module already has. In a clone of Pung, with Docker
(`make image` once builds the image):

```sh
mkdir -p overrides/<id> && [ -f overrides/<id>/push_ui.js ] || echo "// <name> on Push" > overrides/<id>/push_ui.js
docker run --rm --platform linux/amd64 -v "$PWD":/w -v push-hack-pung-gomod:/root/go/pkg/mod \
  -w /w/src push-hack-pung-builder sh -c 'PUNG_GALLERY=/w/build/gallery \
  PUNG_GALLERY_CACHE=/w/scripts/screens/probes.json PUNG_GALLERY_ONLY=<id> \
  CGO_ENABLED=1 go test -count=1 -run "TestGallery\$" .'
```

It writes every page of the module as the Push shows it (`build/gallery/<id>-NN-<PAGE>.png`, the whole
960 x 160 frame, the module's real parameters and the values it starts with). A module is drawn only
if it has a `push_ui.js` (a comment is enough) and a record in the cache file; for a module that is not
in `probes.json`, give a Push's `module-screen.json` as `PUNG_GALLERY_CACHE`.
`PUNG_GALLERY_VALUES=<dir>` with a `<id>.json` (`{"key": "raw value"}`) draws other values: use it to
look at the ends of the ranges.

Run this again after every change. It is the check for everything up to compartments.

## Decide how far to go

Go one step at a time, look at the gallery, and stop where the next step would add nothing.

1. **Nothing.** Pung builds pages from the module's parameters and draws its own live pictures for the
   envelopes, filters, LFOs and mixers it recognizes among the keys.
2. **A theme** (`push.theme`): the module's own ground, ink and knob style on Pung's pages. Every module
   should have one, an effect as much as an instrument; it is four lines. Keep `accent` apart from
   the slot's colour, which means "touched" (orange in the gallery; another device has another): an
   accent close to it makes every knob look touched.
3. **Readable values** (`push.display`, `push.short`, `push.unused`). Pung shows a unit only where
   `chain_params` states one or the name and range tell it. A page of `0.40` and `400` needs
   `push.display` (a unit that stands only in `ui_hierarchy` is such a case). Short names for the row
   under a screen; no page of knobs that turn nothing, said from the module's source, never guessed.
4. **Compartments** (`push.compartment` with `pages`): the instrument's own sections, in its own words
   and order. Not for a module whose one page is already right.
5. **A widget or a band screen** (952 x 86 above the encoders' names and values): only for what knobs
   side by side cannot show: a relationship, the whole at once, the instrument's own vocabulary.
6. **A front panel** (`front_panel: true`, all 960 x 160) with **segments**: the instrument as an
   object. It replaces Pung's elements, so it must draw their jobs (below).

The bar for 5 and 6 has two parts. **Say in one sentence what the screen shows that the default
cannot.** And **draw only what is true**: a picture claims how the engine behaves (how a feedback
falls, what a knob does while another is on). If you cannot read that from the module's source or
measure it, stop at 4: a picture that lies is worse than knobs.

## Rules for every file

- **Names and order are the instrument's**, and the same as on its web page.
- **A value Pung cannot name is left out**, not shown as a number that means nothing.
- **Early pages are full and repeat nothing**: the first pages are also what Live itself lists of the
  device.
- Text is ASCII. A script that throws switches the module's file off (`MODULE UI OFF`).

## Rules for a screen (steps 5 and 6)

- **Envelopes, filters, LFOs and mixers are drawn with `g.envelope`, `g.filter`, `g.lfo`, `g.mix`**, never
  by hand. Only Pung's pictures move with the sound (note dots on an envelope, the spectrum behind a
  filter, an LFO's playhead), and the player knows them from every other module. `color` keeps your
  palette. A page of envelope knobs needs no screen at all: Pung draws its envelope by itself.
- **Motion comes from the sound or the module's state** (`v.$live`, `live_keys`, `v[key].now`), never as
  decoration.
- **The touched control** (`v.$touched`) is drawn in the slot's colour (`"slot"`), and the slot's colour is
  used for nothing else.
- **Unknown is shown as unknown**: check `v[key].known` and draw a neutral shape until a value arrives.
- **Every value is readable as text somewhere** on the screen; fit every text by measuring (`g.text` and
  `g.value` with a width, `g.measure`).
- **A screen gets only its own pages' keys.** A key from another page must be named in `extra_keys`, or
  it silently reads as a default.
- **`g.layer(key, fn)` replaces everything drawn so far**: one layer per frame, drawn first, with
  everything it depends on in its key.
- **Budget: 8 ms a frame for a band screen, 14 ms for a front panel**, measured on the Push. One
  `g.poly` per curve; what never changes goes into the layer; thousands of `g.fill` calls only inside
  it. Three slow frames in a row switch the picture off.
- **A front panel draws the encoder row**: each encoder's name and value, the touched one, which page
  of how many. `g.knobs({})` draws that row in Pung's standard form, from `v.$knobs`; the shipped
  panels draw their own in the instrument's look (`examples/front-panel.js`), also from `v.$knobs`,
  never from a fixed list. The row is the bottom 56 pixels (y 104 to
  160), where the hands expect it.
- **Segments**: declare each section's `rect` and `keys`; Pung draws the bar over the active one, the
  same on every panel. Do not dim, frame or underline a segment yourself, and leave the 3 pixels above
  its rect free of text.
- 16-bit colour: flat colours and 2-pixel lines, no gradients.

## Looking at a screen without a Push

The gallery above draws screens too, in Pung's whole frame. A second test draws each screen and widget
alone, with made-up values, and fails on a script error:

```sh
docker run --rm --platform linux/amd64 -v "$PWD":/w -v push-hack-pung-gomod:/root/go/pkg/mod \
  -w /w/src push-hack-pung-builder \
  sh -c 'PUNG_SHOTS=/w/build/shots CGO_ENABLED=1 go test -count=1 -run TestShippedOverlaysDraw .'
```

It draws every shipped file, yours among them: `build/shots/<id>-<compartment>-false.png` (nothing
touched), `-true.png` (a key touched), `-mod.png` (every value moved by modulation), `-pageN.png` (a
page's own screen), `<id>-widgetN-...png`. A file with no screen or widget writes no picture here; that
it loaded without an error is what the test says of it. The values are numbers where the module would
give names, so a filter type or an LFO shape may draw empty: the test's limit, not the screen's.
Timing on a computer says nothing about the Push.

Look at every picture: text that is cut, overlaps, an empty shape where a value was expected.

## On a Push

- Put the file at `/data/push-hack/data/pung/overrides/<id>/push_ui.js` (your own overlay; it wins over
  the one Pung ships) or beside the module's `module.json`.
- **Restart Pung** (`/etc/init.d/push-hack-pung restart`): it keeps a screen file loaded.
- The screen as the Push shows it: `GET http://<push>:7701/api/display/mirror/frame` (a 1920 x 320 PNG).
  How long your draw takes: `module_ui_draw_us` in `GET http://<push>:7720/api/surface/state`.
- Walk every page, turn every encoder, play a note through the pages that should move.

## When you hand it over

Say what step you stopped at and why, the one sentence for each screen, what you rendered and looked
at, and what you could not check without a Push (timing, real values, motion with sound). Then go
through the review checklist (UX-GUIDELINES section 8) and name the lines you could not verify.
