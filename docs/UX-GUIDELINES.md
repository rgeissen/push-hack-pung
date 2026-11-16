# Pung UX guidelines: the Push and the web, hand in hand

For anyone who draws a Pung interface: Pung itself (the default view), module authors writing a
`push_ui.js`, and module authors whose `web_ui.html` sits beside it. The design principles these rules
serve are in `DESIGN-v2.md` ("Design principles"); how to write the code is in `overrides.md`. This file
says what good looks like, and what a review checks.

## 1. One instrument, two surfaces

A module has one structure: its **compartments** (one compartment = one Push screen = one web section).
The Push and the web page are two views of that one structure, and each one does what the other cannot:

| | Push | Web page |
|---|---|---|
| Shows | one compartment at a time, under the hands | every compartment at once |
| Changes values with | 8 encoders, with touch | sliders, menus, dragging the pictures |
| Strength | playing: eyes on the music, hands on the knobs | overview, precise entry, editing away from the device |

**The rules that keep them together:**

1. **Same names, same order.** A compartment, page or parameter has one name, used on both surfaces. The
   Push writes it in capitals; that is the only difference. Never rename on one surface only.
2. **Same pictures.** A structure Pung recognizes (§4) is drawn from one rule set, in Go for the Push
   (`src/visuals.go`, `src/visuals_shapes.go`) and in JavaScript for the web (`src/web/visuals.js`). The
   files carry the same constants. A change to one is a change to both, in the same commit;
   `make test-visuals` checks them against each other on every page of the fleet.
3. **Same state.** A value turned on the Push moves on the page within half a second, and the other way
   round. The compartment the Push shows is marked on the page, and clicking a section's title turns the
   Push to it.
4. **Same touch.** The stage of an envelope under a finger on the Push is drawn hot; on the page, the
   stage under the pointer or keyboard focus is drawn hot the same way.
5. **A module's own web page follows the compartments too.** Its panels should be its compartments, in
   the same order and under the same names as its `push_ui.js` declares. It is sent
   `{type: "compartment", id}` when the Push turns (go there), `{type: "compartments", enabled: [ids]}`
   when the pills change (show only those), and may send `{type: "showCompartment", id}`.
6. **The compartments are pills over the panel**, each switching its section on or off (remembered per
   module in the browser); a double click (or Alt+click) shows only that one, *All* brings every one
   back. With one on, the Push turns to it when it shows this device. A dot marks the pill the Push
   shows. A pill never moves the Push by itself being switched on alongside others: the page is the
   page, the Push is the Push.

## 2. Three levels on the Push

1. **Push native**: Push's own device view of the Live device. Always there; the fallback.
2. **Pung default**: built from the module's parameters, for every module, with no code from the
   author. It includes Pung's own pictures for structures it recognizes (§4) and any widgets the module
   adds (`push.widget`).
3. **Custom screen**: a module draws a compartment, or one page of it, itself, only where it is
   substantially better than level 2 (§5). Three sizes:
   - a **page screen**: the band over the encoders, for one page (a JV-880 envelope over its eight knobs);
   - a **band screen**: the band, for every page of a compartment (Osirus's filter routing);
   - a **takeover**: the whole panel; Pung draws none of its own elements (JE-8086's Patch, Mini-JV's
     Macros, Dexed's Algorithm).

Most modules should never need level 3. **The default must be world class on its own**, because it is
what nearly every module will show.

## 3. The Push screen

### Geometry (960 x 160)

| Band | y | Holds |
|---|---|---|
| Header | 0 to 22 | the device's name box (left); on the right the track, `COMPARTMENT / PAGE`, the level meter and the page indicator `< 4/34 >` |
| Picture band | 26 to 112 | knob cells, widgets, Pung's pictures, a custom screen (952 x 86 at x 4) |
| Name and value row | about 112 to 128 | under a picture: each encoder's name and value |
| Bottom row | 138 to 160 | the chain or Live's tracks |

Eight columns of 120 pixels, one per encoder. **A picture covering columns 3 to 6 is about encoders 3 to
6**: place things over the knob that changes them. A custom screen may break the columns, but the name and
value row below it never does.

### Colour

The panel has 16-bit colour and no alpha. Gradients show steps; a translucent fill does not exist. To
fade a colour, mix it toward black (`mixColor` in Go; `color-mix(in srgb, var(--slot) 28%, #000)` on the
web).

| Token | Go | Web | Means |
|---|---|---|---|
| slot | `slotColor(i)` | `--slot` | this device's identity; **the thing being touched or edited** |
| fg | `cFg` | `--fg` | values, lines, the shape itself |
| dim | `cDim` | `--muted` | names, labels, secondary text |
| line | `cLine` | `--line` | baselines, separators |
| faint | `cFaint` | `--raise` | column rules, empty areas |
| mod | `cMod` | (cyan) | a second trace beside the first (filter 2 next to filter 1), modulation |
| warn | `cWarn` | `--warn` | errors only (`MODULE UI OFF`) |

Slot colour is precious: it means "this is yours, now". Use it for the touched element and the
selection, and for fills at 28% toward black. Never use it for decoration.

### Type, lines, shapes

- Labels: Tamzen capitals, 7 px a character (`g.text`). Values: the value face (`g.value`), 16 px.
- Lines: 2 to 2.2 px at rest, 3.5 px when touched. Handles: 3 px dots at rest, 4.5 px when touched.
- Fills: flat, under their line, the slot colour mixed toward black.
- Guides (a level, a centre line): 1 px, dashed or dim.
- Text is ASCII. Room is short: **truncate a name, never a value**.
- **Text is fitted by measuring it, never by counting letters.** The value faces are proportional; a
  count of 7 px a letter let `Bank Sel +.` cross its box. Pung's helpers (`draw.go`) and a widget's
  `g.text`/`g.value` with a `maxWidth` do it:
  - a label is cut, ending in `.`;
  - a value goes to a smaller value face first, and is cut only where that does not hold it either;
  - **a number is never cut** (`-240.` reads as another number): it is shortened, `-24000` to `-24K`,
    or not shown. A range's two ends are shortened together (`-24K` and `24K`, not `-24K` and `24000`).
- Neighbouring columns keep 16 px between their texts, so a row of values reads as columns.

### The header

Laid out from the right, each part only where it fits whole, never crossing the device or bank row:

1. **The page indicator**, `< 4/34 >`: where Page < and Page > go. An arrow is bright where its button goes
   somewhere (the button is lit then too), faint where not. It always gets its room first.
2. **The level meter**: the device's own output. At rest a floor line, not ten dim blocks (those read as
   an indicator that does not work).
3. A warning (`MODULE UI OFF`), whole or not at all; then `COMPARTMENT / PAGE`; then the track, each cut
   to what is left.

## 4. Pung default

### What every module gets

The knob cells (a gauge, the value, its unit), enum boxes with their option dots, the header, the device
and bank rows, the detail card when an encoder is touched, and **Pung's pictures**.

### Pages: from what the module says

Pages come from the module itself, in this order of preference:

1. its `push_ui.js` compartments (§5);
2. its `ui_hierarchy`: the root's sections, or, for a hierarchy with modes and no root (JE-8086, Mini-JV),
   the sections of the first mode's editing level, reached the way Move's browser walks it;
3. its keys grouped by what their names say (`amp_*`, `filter_*`, `lfo1_*`, `cutoff` with the filter), in
   the module's order, never splitting a group that fits a page.

**Every parameter has a page.** Keys no section names follow the sections, grouped by name. Numbered pages
(`PAGE 1..24`) are a failure: a page's name says what is on it.

### Recognized structures: Pung's pictures

Where a page's keys describe a structure Pung knows, Pung draws it over those knobs, for any module:

| Structure | Recognized when | Drawn as |
|---|---|---|
| **Envelope** | adjacent keys ending in `attack`, `decay`, `hold`, `sustain`, `release` with one shared prefix (`amp_`, `f_`, `filter_`, `macro_`...), in any order; `sustain_time` beside a sustain is a sustain slope | the envelope, filled; handles where stages meet; the sustain level as a guide; stage letters under the segments |
| **Filter** | a cutoff (`cutoff`, `cutofffrequency`, or `freq` after a filter's name: `flt_freq`) beside its resonance (`resonance`, `reso`, `res`, `q`) or its type, the same filter named (`filter1_cutoff`, `filter1_resonance`). A type on the page that names a filter (`filter_type`, `filter1_mode`, `ftype`) gives the response, and joins the picture when it sits beside it; without one the filter is a 12 dB lowpass. A `macro_cutoff` is not a filter | the response over three decades, filled; the cutoff a handle on the curve; 0 dB dashed. The type's slope is read from its name (`LP 24 dB`, `LP12`, `Analog 4P`, `Ladder`). A type Pung cannot read (`Comb`) draws no curve, only its name |
| **LFO** | a wave (`shape`, `wave`, `waveform`) beside its rate (`rate`, `speed`, `freq`), sharing a prefix that names an LFO (`lfo1_`, `lfo_`) | the wave around a centre line, filled toward it, 1 to 5 cycles as the rate knob goes. A wave Pung does not know exactly (`Skewed Sine`, `Wave 3`) is drawn as its name |
| **Mix** | three or more adjacent levels of different sources, named alike (`saw_level`, `pulse_level`, `sub_level`; `level_o1`, `level_o2`, `level_noise`; `mix_1`...). Not an envelope's levels, an FM operator's (a modulator's level is a depth), or effects' | a fader over each source's knob, and across the top each source's share of the whole |

The rules for a recognized structure:

- **Recognize by name and adjacency, never by guess.** The parts must sit side by side on the page,
  with nothing else between them.
- **Draw only what is true.** An attack and a release alone are a compressor's or a gate's timing, not
  an envelope, so no envelope is drawn for them. A picture that lies is worse than knobs.
- **Draw in the knob's terms.** Times are drawn in proportion to their knob, not to scale in
  milliseconds: the shape is what the hand turns, and a 10-second release would squeeze everything else
  to a line. Without a sustain, stages are drawn against their longest, so short means short.
- **A module's own widget wins** over Pung's picture for the same columns.
- **What the fleet gets**: `src/testdata/fleet-pictures.txt` lists every picture Pung draws on every
  page of the 100 modules Schwung captured (`TestFleetPictures`), so a rule's change shows module by
  module. `make test-visuals` checks that the web page finds the same pictures on all of them.

### States

| State | Look |
|---|---|
| At rest | the shape in fg, the fill in slot colour mixed toward black |
| Touched | the touched stage thick and in slot colour, its handle large, its letter in slot colour; the name under the encoder in fg with a slot underline |
| Value unknown | a neutral shape in dim. **A read that did not answer never becomes a picture** |
| Overlay failed | the default view, and `MODULE UI OFF` in warn at the top centre |

**The touched cell says it all, in place.** Move opens a large detail card on every touch, because its whole
screen is one small LCD. On the Push every encoder has a 120-pixel column, so the card only hides the
neighbouring knobs. The touched cell instead shows:

- its name in fg over a slot-colour underline, and a thicker gauge on a lighter track;
- the **range** at the ends of the gauge's arc (`0` and `127`, `-50` and `+50`);
- for a list, its box outlined in slot colour and the **neighbouring options** (`<BPF`, `SAW>`): where a
  turn goes next, either way;
- **fine adjustment** where Shift changes the step: `FINE` beside the dial, lit in slot colour while
  Shift is held.

The card stays available as a setting (web page, **Push display > Detail card on touch**; `touch_card` in
`settings.json`), off by default, and never opens over a picture. Turning a page shows no notice either:
the header names the page (a takeover draws its own indicator), and a box over the knobs hid two of them
for 2.5 s on every page turn. Notices are for what the screen does not already say.

### Moving between devices

Live decides which device is shown; Pung and Push hand the screen to each other as the selection moves.
What the user sees must always be one device, whole:

- **A frame never mixes two devices.** A device is drawn once Live has resolved it and its own parameters
  are read; until then the last frame stays (at most 0.7 s, then what there is). Measured before this
  rule: the new track's name over the last device's parameters, and one device's values on another's dials.
- **A device seen before is drawn at once**, from what it was left as, and its lookup confirms it behind
  the frame (a lookup in Live takes 300 ms and more).
- **A knob writes only to the device shown**, and only once Live has confirmed it: a turn during a switch is
  dropped, never sent with the last device's parameter index to the new one.
- **Each device keeps its page**, as on Push: back on JE-8086, its page 11 is there again.
- **Leaving for a device that is not Pung's, Pung goes quiet at once**: no frame, no light, until Push has
  the screen back. A light written after the hand-over stays wrong (Live repaints only what changes).
- Push itself takes about 0.3 s to report a new device, and shows its own view meanwhile; Pung's first
  frame comes 40 to 60 ms after it gets the surface.

### Sounds

Every module's sounds are browsed the same way (`docs/PRESETS.md`): the jog wheel steps them in the Pung
view, and a jog press opens the sound browser. Its rules, which any screen that changes a device's sound
follows:

- **The jog is Push's.** Turn moves, press selects, a nudge left goes back, a nudge right opens the
  highlighted item's options, as in Push's own browser; a hand that knows Push knows Pung.
- **Hearing is not choosing.** A sound plays where the cursor rests; it becomes the device's only on Load or
  a jog press. Every other way out puts back the sound from before, exactly.
- **Looking is not hearing.** Switching a source, a tab or a page of the list changes nothing you hear;
  only the cursor does.
- **Nothing can be overwritten by accident.** Save is off while another sound is auditioned, Save As never
  overwrites, Delete asks twice.
- **Never a guessed name.** A sound not heard yet is its number and a dash.
- **A button with nothing to do is dim** and says why when pressed.

## 5. Custom screens

### The bar

A custom screen ships only if it is **substantially better than the default** and **true to the
instrument**. It earns its place by showing what knobs side by side cannot:

- **Relationships**: a signal path (the Virus's filter routing: serial, parallel, split), two curves on
  one axis (both filters' responses), a modulation and its target.
- **The whole at once**: both envelopes, all of a compartment's pages, while the encoders edit one page.
- **The instrument's own vocabulary**: its section names, its display (a JV-880's LCD and tones), its way
  of describing itself ("sustain falls while held", not "sustain time 25").

If it only restyles the default page, it does not ship.

### Rules

1. **Reuse Pung's pictures** for the structures Pung knows: `g.envelope`, `g.filter`, `g.lfo`, `g.mix`,
   not hand-drawn ones. The
   user has learned the picture on every other module, and it is the picture the web page draws.
2. **Respect the bands.** Draw in your band (952 x 86). The header and the name and value row belong to
   Pung.
3. **Show the touch.** Whatever is under a finger (`v.$touched`) is drawn in slot colour, as in §4.
4. **Show unknown honestly.** Check `v[key].known`; draw a neutral shape until values arrive.
5. **Fit the budget**: 8 ms a frame, 14 ms for a takeover (§7). One `g.poly` per curve; cache what does
   not change. `/api/surface/state` reports `module_ui_draw_us`: measure on the device.
6. **A takeover replaces Pung's elements, so it owns their jobs**: every encoder's name and value
   (`v.$knobs`), the touched one in slot colour, which page of how many. The bottom 56 pixels are the
   encoder row, by convention (y 104 to 160), so that the hands find their values where they always are.
7. **A picture over knobs is aligned with them.** When a page's knobs are the parts of one thing (an
   envelope's rate and level per stage), draw each part over its own knobs, as the JV-880 and DX7 envelope
   pages do: stage *i* over encoders 2*i* and 2*i*+1.
8. **The web side.** A custom screen's compartment is a section of the module's web page, with the same
   name. If the screen shows a relationship, the page should show it too. Without a web page of its own,
   Pung's page shows the screen itself (drawn by the same code).
9. **Shift + Swap** returns to the default view, always; so does the bank list.

### Showcase

| Module | Compartment | Kind | What it shows that knobs cannot |
|---|---|---|---|
| JE-8086 | Patch | takeover | the JP-8000's LCD (P:A11, the patch name, the parameter being turned), both oscillators' waves, the filter's response, the amp envelope, LFO 1: the patch at a glance while the encoders play its macros |
| JE-8086 | Osc, Filter & Amp, LFO & Mod, FX, Play & Arp, System | default | the tabs of its own web panel, its numbered sections as pages |
| Mini-JV | Macros | takeover | the JV-880's LCD and its four tones: which wave, how loud, where panned, their amp envelopes. A JV patch is four tones |
| Mini-JV | Tone 1-4, Pitch / Filter / Amp Env pages | page screens | the JV's 4-stage envelope, each stage over its time and level knobs, key-off before stage 4 |
| Dexed | Algorithm | takeover | the algorithm as the DX7 prints it (from Dexed's own table), ratios and levels in the operators, the feedback loop, the six envelopes; encoders: algorithm, feedback, six levels |
| Dexed | Operator 1-6 EG and Key Scale, Pitch EG | page screens | 4-rate/4-level envelopes over their knobs; keyboard level scaling over a keyboard |
| Osirus | Filters, Envelopes | band screens | the filter routing as a signal path with both responses; both envelopes with the sustain slope in words |
| OB-Xd, Braids | (pages) | default + widgets | their own widgets over their knobs |
| Hera | DCO, VCF (and Main) | default + widgets | the wave the Juno's DCO puts out (saw, pulse at its width, the sub an octave down, noise as a band) summed at their levels, the pulse width and how far PWM moves it; the filter and where the envelope takes the cutoff |
| Every other module | (pages) | default | Pung's envelope, filter, LFO and mix wherever one is recognized; pages from the module's sections or names |

## 6. The web page

- **Pung's page draws the default.** Each compartment is a section, a custom screen's compartment headed by
  that screen (as a picture, refreshed with the values; click it to turn the Push to it); a recognized structure is a card with
  the picture over its controls, the controls in a row in the order of the encoders.
- **Pictures are direct.** On the web, a picture's handles can be dragged: attack's peak sideways, the
  decay point sideways and up or down (the sustain level), release's end sideways. The slider below moves
  with it, and the Push follows.
- **The keyboard path is the controls.** Every value has a slider or a menu, reachable with Tab; a
  picture is never the only way to a value. A picture has an `aria-label` naming its values.
- **Phone widths.** Cards stack, a picture keeps its proportion, a row of controls folds to two columns.
- **A module's own `web_ui.html`** runs in a sandbox under a strip of its compartments. It decides its
  own look, but follows §1. It is sent what Schwung Manager sends: the declared parameters, the values
  its widgets name (`viz.extra_keys`), and the fields of its `state` when that is a JSON object
  (JE-8086's panel is built on `state.temp`, the emulator's whole patch image).

## 7. Motion and performance

### Live pictures: the sound as it plays

Pung's pictures are not only the patch: while a device sounds, they show what its sound is doing
(`src/livestate.go`, `src/livefx.go`). **Nothing moves unless the sound moves, and nothing moves that
Pung cannot stand behind.** A movement is measured from the sound, exact from the notes, Live's
transport or a unit the module states, or read from the module itself; where none of those knows, the
picture stays still. No movement is decoration, and none is a guess.

What Pung knows of every device, on the audio thread, lock-free: each note as it is delivered (with its
time), the loudest sample of each block, the last 4096 samples of the output, and Live's transport.

| Picture | What moves | From |
|---|---|---|
| **Envelope** (every one a synth or a MIDI effect has) | each note a dot running along the lines **on its own clock**: it travels each stage at that stage's speed and reaches its corner as the stage ends, rests at the sustain point while the key is held, and runs down the release from the moment the key is let go, from wherever the level was. A short trail behind each dot; the newest note's stage lit up to its dot with a hairline to the base. Under the shape, **the stage bar**: one segment per stage, as wide as the stage is drawn, lit while a note's dot is in it (and outlined in slot colour while its knob is touched) | the notes (when each went down and was let go) and each stage's time: **exact** where the module states it (`250 ms`, `1.2 s`); **from the knob's range** where that range is seconds (`0.001 .. 3`; Surge's `-8 .. 5` is log2 of seconds); otherwise **Pung's curve** on the knob's travel (2 ms .. 10 s). For the amplitude envelope (no prefix, `amp`, `vca`, `tva`, `aeg`...) the output's level then says when a stage really ends, for a note held alone: the dot waits at the attack's corner until the sound peaks, at the decay's until it settles, at the release's end until it is silent (-60 dB under where it was let go), and later notes' times are scaled by what was measured |
| **Envelope** of an audio effect (a gate's, a ducker's) | still | it runs on the audio it hears, not on notes |
| every envelope | its start flashes as a note begins it again | the notes |
| **Filter** | the sound's spectrum behind the response (1/6-octave smoothing, tilted 3 dB an octave about 1 kHz, falling at most 36 dB a second) | measured: the output itself. It is the whole device's sound, after every filter and effect, so a static cutoff with a bright spectrum says the envelope or key follow is opening it |
| **LFO** synced to the beat with a rate in note values (`1/8.`, `1/4T`) | a playhead running through the drawn cycles, a trail | exact: Live's beat, while Live plays |
| **LFO** restarted by notes with a rate in Hz | the same | exact: the time since the last note |
| **LFO** restarted by notes (`trig`, `retrig`, `keytrig`, `synchro`...), any rate | its start flashes as a note restarts it | the notes |
| **LFO** free running, or a rate with no unit | still | its phase cannot be known |
| a module's screen | whatever it draws from `v.$live` and its `live_keys` (overrides.md) | the module |

**Where it runs**: one live session per sound (`src/livehub.go`), shared by the Push view and every web
page watching it: it is the only reader of the sound's state, so the two can never tell two stories. It
ticks at 30 frames a second while someone watches and stops when no one does.

**On the web page**: `GET /api/devices/<n>/live` (or `/api/slots/<n>/live`) streams the session's frames
as Server-Sent Events (`?comp=synth&pics=<json of the page's pictures>&keys=<the module's live keys>`).
The page asks only for the pictures of the sections it shows, only while it is visible, and draws the same
live layers as the Push (`web/visuals.js`: `PungVisuals.live(frame)`); a frame the page is too slow for is
dropped, never queued. A module's own page (an iframe) gets every frame as `{type: "live", frame}`
(overrides.md). Measured: about 2 frames a second at rest, 30 while the sound moves, each a few hundred
bytes plus 240 spectrum values.

**An instrument's own times**: Mini-JV's envelope pages (Pitch, Filter and Amp Env of each tone) run every
note through the JV's four stages in the JV's own time. Its time values (0..127) have no unit, so the
seconds were **measured off the emulated JV-880**: a note played through each stage while the chip's
envelope was read every 128-sample block until it settled (`JV_TIME` in `overrides/minijv/push_ui.js`).
T1, T2/T3 and T4 have different scales (T = 80 is 2.6 s as an attack, 3.5 s as a second stage, 4.5 s as
a release), a stage takes its time whatever levels it moves between, and keyfollow and velocity time
sense moved it by under 3% in the measurement. The pitch and filter envelopes run on the same envelope
generator and use the same table. The bar under the envelope reads `T1` .. `T4`, and `T3 SUSTAIN` while
a held key keeps the third stage's level. A key let go early starts the fourth stage from the level it
had, drawn as its own line down.

The chip's voices (`live_voices`, v2: each voice's TVA envelope, amplitude, TVF coefficient and pan) are
still read for the Macros screen and the module's own web page, which show every voice's level and filter
cutoff live. They no longer place the envelope dots: the chip's level is not linear in the patch's L
values (L 64 reads 0.11 of L 127), so a dot placed by level could not move in time.

**The look**: live marks are in the modulation colour (`mod`), so they never read as a touch (slot
colour) or as the patch (fg). A playhead is a mod dot ringed in black with a dashed hairline to the base;
its trail is the last nine positions, fading toward black; nothing eases or bounces. The spectrum is a
neutral grey laid under the curve that shapes it, lighter where it is louder, never over the curve.

**When**: the view redraws at 30 frames a second while a note is down, the device sounds (above
-72 dBFS), for 1.5 s after the last note or sound, and while Live plays if a picture follows the beat.
Otherwise it draws only on change, as before.

**What the fleet can give**: of 289 envelope time knobs in the 100 captured modules, 14 state a unit
(milliseconds), 98 have a range in seconds (Surge's 54 among them), and the other 177 are 0..1, 0..127
or 0..100 with no unit: those run on Pung's curve, which the amplitude envelope's sound corrects. The
curve is the one estimate a live picture makes; a module that states its times in ms or s gets exact
dots for nothing. One LFO rate in the fleet is in Hz.

**Cost**, measured on the device (`frame_draw_us`, `frame_push_us` in `GET /api/surface/state`): a page
of plain knobs draws in about 7.4 ms and hands over in about 1.8 ms; the spectrum adds about 1 ms, a
playhead nothing measurable; Mini-JV's Macros with its voices about 10.4 ms. A 30 fps frame is 33 ms.

- Things move only when the instrument moves: an LFO's phase, a meter. A static value is drawn still.
- The Push redraws many times a second. A widget or a screen gets **8 ms**, a takeover **14 ms**; three
  slow frames in a row, or one over 40 ms, switch it off for the session. Measured on the device:
  JE-8086's Patch takeover draws in 2.6 to 4.1 ms, Mini-JV's Macros in about 2.7 ms. Pung's own pictures are drawn in Go, outside the module's budget.
- The web page polls values every 500 ms and redraws only what changed.

## 8. Review checklist

Before a screen, widget or web section ships:

- [ ] Names and order match on the Push and the web page (§1).
- [ ] It is a compartment, or lives inside one; its title on the web turns the Push to it.
- [ ] Pung's pictures are used for the structures Pung knows (§4, §5.1).
- [ ] The touched element is in slot colour; slot colour is used for nothing else.
- [ ] Unknown values draw a neutral shape, never a guess.
- [ ] Every value is readable as text somewhere on the screen (the row under a picture counts).
- [ ] Nothing covers a knob that is not being turned: no card, no notice the header already gives.
- [ ] Nothing is drawn outside its band; the header and the name and value row are untouched.
- [ ] Every text is fitted to its room by measuring (`g.text`/`g.value` with a width); no number is cut.
      `TestCellsKeepTheirText` and its siblings check Pung's own elements this way (`PUNG_GALLERY=dir`
      writes the frames).
- [ ] It stays under 8 ms a frame on the device (`TestShippedOverlaysDraw` renders it; screenshots with
      `PUNG_SHOTS=dir go test`).
- [ ] For a custom screen: one sentence saying what it shows that the default cannot. If there is no such
      sentence, it does not ship.
- [ ] For a takeover: the encoder row (names, values, the touched one) and the page are on it; it was
      measured on the device (`module_ui_draw_us`) under 14 ms.
- [ ] Where the module has a web panel: the compartments are its panels, in its order, under its names.
