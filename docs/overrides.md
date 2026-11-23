# Module pictures on the Push (`push_ui.js`)

A Schwung module gets a native Push page with no Push code: Pung builds it from the module's
`chain_params` and `ui_hierarchy`. A module can also draw its own widgets on that page. This file is for
module authors. What good looks like, on the Push and the web page together: `UX-GUIDELINES.md`.

## Where the file goes

The first file found wins:

1. `push_ui.js` in the module's own folder, next to `module.json`. Move ignores this file.
2. `/data/push-hack/data/pung/overrides/<module id>/push_ui.js`: your own overlay.
3. `overrides/<module id>/push_ui.js` in the Pung hack: overlays that ship with Pung.

## A widget

```js
push.widget({
  keys: ["attack", "decay", "sustain", "release"],
  draw: function (g, v, t) {
    // draw here
  }
});
```

`keys` are parameter keys of the module (without the `synth:` prefix). When a bank shows these keys side by
side, in this order, the widget gets the space above their columns: 120 pixels per key, 86 pixels high. The
native page still shows each key's name and value under the widget, and the encoders still change the
values. A widget only draws: it cannot take input.

A file can register several widgets. A key belongs to the first widget that claims it on a bank.

## Drawing (`g`)

The frame starts at the widget's top left. Nothing you draw can leave it.

| Call | Draws |
|---|---|
| `g.w`, `g.h` | the frame's width and height |
| `g.fill(x, y, w, h, color)` | a rectangle |
| `g.line(x1, y1, x2, y2, width, color)` | a smooth line |
| `g.arc(cx, cy, r, from, sweep, width, color)` | a ring segment; radians, 0 is 3 o'clock, clockwise |
| `g.dot(x, y, r, color)` | a filled circle |
| `g.poly(points, width, color)` | a curve through `[[x, y], ...]` (or `[x0, y0, x1, y1, ...]`) in one call |
| `g.area(points, baseY, color)` | the area between such a curve and the line `y = baseY`, filled |
| `g.envelope(x, y, w, h, {keys: [...], labels})` | Pung's envelope, the one picture every envelope gets (UX-GUIDELINES.md, *Envelopes*): Pung finds the envelope among the keys by its own rules, draws it, and runs it live (every note a dot on its clock). Or name the stages: `{attack, decay, hold, sustain, slope, release, delay}` or `{time1.., rate1.., level1..}`, each a key (its value and touch are read for you) or a number 0..1. `labels: true` adds the stage bar. `color` draws it in the module's own colour (its live marks stay in the modulation colour). `still: true` where the module knows its envelope does not run as a held note would (a one-shot, a loop): the shape, no dots. `curves: {attack, decay, release, ...}`: each stage's bend as the synth makes it: a number or a key whose value is one (the level runs (e^(c t)-1)/(e^c-1) of its way at time t, 0 straight: Vivace's curve knobs), `{exp: c}` the same, or `{root: n}` (the level's n-th root runs straight in time: Surge's Quadratic and Cubic stages, n=0.5 its Convex attack), or an array: how far along its levels the stage is at evenly spaced times, 0..1, for any curve the engine computes (SIMIAN's slope); 9 to 33 points draw smooth. The line, its fill and the note dots follow it. `levels: {sustain: 0.17, ...}`: where a stage's level is drawn when the module's level is not its knob's (TinyK hears its envelope squared); the stage keeps its key, so its time, its touch and the live dots stay. Returns whether it drew one |
| `g.filter(x, y, w, h, {cutoff, resonance, type, at})` | Pung's filter response. `at` (0..1): where the response really stands, when the engine maps its knob unevenly (a 303's cutoff); `cutoff` stays the key, so the spectrum stays live behind it. `cutoff` and `resonance` are keys or numbers 0..1; `type` is a key or a name (`"LP 24 dB"`, `"HP"`, `"BandPass"`); without a type, a lowpass. With `cutoff` a key it is live: the sound's spectrum stands behind the curve while it plays, as on Pung's own pages. `color` as for the envelope |
| `g.lfo(x, y, w, h, {shape, rate, sync, div, trig})` | Pung's LFO: `shape` a key or a name (`"Sine"`, `"Saw Up"`, `"S&H"`), or an array: one cycle as the engine makes it, -1..1 at evenly spaced phases (a pump, a module's own shape; it runs live like any other), `rate` a key or a number 0..1 (1 to 5 cycles). Live where its phase can be known (UX-GUIDELINES.md, *Live pictures*): a rate in note values runs on Live's beat, a rate in Hz from the last note when `trig` says notes restart it, and a restart flashes. `sync`, `div` and `trig` are keys (`trig` read as on or off), or `trig` is `true`/`false` where no key says it in words (the Virus's key trigger is Off or a phase). `color` as for the envelope |
| `g.mix(x, y, w, h, [levels][, {color}])` | Pung's mixer: a fader per level (a key or a number 0..1), and each one's share of the whole across the top; `color` as for the envelope |
| `g.text(x, y, s, color, align[, maxWidth])` | small capitals (the label face); `y` is the baseline; align -1 left, 0 center, 1 right; with `maxWidth`, cut to fit it (ending in `.`) |
| `g.value(x, y, s, color, align[, maxWidth])` | the larger value face; with `maxWidth`, a smaller face before a cut, and a number is never cut (`-24000` becomes `-24K`) |
| `g.measure(s[, "value"])` | the width of `s` in pixels, in the label face or the value face |
| `g.layer(key, fn)` | the part of a screen that does not change: `fn` draws it once, and while `key` stays the same the kept picture is copied in instead (a dot-matrix display of a thousand dots costs a copy). The layer **replaces the frame drawn so far**, so a screen has one, and it comes first; a second layer wipes the first. Put everything the key decides into the one layer and its key (Xenia's front panel: the display's two lines, the wavetable and the start positions) |
| `g.segment(id, x, y, w, h)` | this frame the segment `id` sits here, not at its declared `rect`: for a panel that moves a section with a value (Maze Voice's ORDER swaps the folder and the filter). Pung's bar and the outlines while choosing follow it; call it on every frame it applies |

Colors: `"#rrggbb"`, a Push palette name (`"orange"`, `"sky"`, ...), or `"slot"` (the slot's color), `"fg"`,
`"dim"`, `"faint"`, `"line"`, `"mod"`, `"warn"`, `"black"`. Text is ASCII only.

A draw has 8 ms. Draw a curve with one `g.poly` rather than hundreds of `g.line` calls: each call from the
script into Pung costs time, and the screen is drawn many times a second.

## Compartments (`push.compartment`)

A module's interface is cut into compartments (`DESIGN-v2.md`, "Design principles"): one compartment is one
screen on the Push and one section of the web page. Declare them in order:

```js
push.compartment({
  id: "filter", label: "Filters",
  pages: [                                   // the encoder pages (else: keys, 8 to a page)
    { label: "Filter 1", keys: ["cutoff", "filter1_resonance", "filter1_mode"] },
    { label: "Routing",  keys: ["filter_routing", "saturation_curve"] }
  ],
  screen: function (g, v, t) { /* optional: a custom screen */ }
});
```

- **Without `screen`** the compartment uses Pung's default view, with any widgets that fit its pages.
- **With `screen`** the compartment draws the whole band itself (`g.w` 952, `g.h` 86), on every page of the
  compartment, with the values of all its keys in `v`. The encoders' names and values stay under it, and
  the native layer still owns every encoder.
- **A page's own `screen`** (`pages: [{label, keys, screen}]`) draws the band for that page only; the other
  pages keep the default view. Use it where one page needs a picture (a keyboard's level scaling) and
  the rest are fine as knobs. Never for an envelope: a page of envelope knobs gets Pung's envelope by
  itself, the same as every module's.
- **`front_panel: true`** (with `screen`) (first called `takeover`, still read): the screen draws **all of the panel** (`g.w` 960, `g.h` 160), and Pung
  draws none of its own elements, only its notices on top. The screen must then show what those elements
  showed: the encoders' names and values (`v.$knobs`, the eight keys the encoders turn now, `""` for an
  empty one), the touched one, and which page it is (`v.$page`, the index into `v.$pages`, the page
  labels). `v.$name` is the device's name and `v.$track` Live's track. Leaving the open device (upper button 1, a jog nudge left) and any
  failure bring Pung's default view back. A front panel's budget is 14 ms (it draws what Pung's own elements
  would have).
- **`draws_tabs: true`** (a front panel with pages): the screen names the lower buttons itself. Pung
  hands it the buttons as it maps them: `v.$tabs`, eight strings (a page's name, `"<"` or `">"` for the
  arrows that move the row along the module's pages, `""` for none), and `v.$tab`, the lit one (-1 when
  the page shown is off the row). On a page turn Pung then shows only its header for a moment (the way
  back, Sounds), not its page row over the panel's own. Vavra's matrix and effects panels.
- **`segments`** (a front panel): the panel's sections, each one press away. See *Segments* below.
- **`extra_keys`**: values a screen shows that no encoder edits (a patch name, a mode); they are read with
  the compartment's keys and given in `v`, even without metadata.
- Band screens and page screens also get `v.$page`, `v.$pages` and `v.$knobs`.
- The header says `COMPARTMENT / PAGE`. The jog wheel and Page < > step through the pages; the open device's lower row lists them.
- Parameters no compartment names stay reachable after the compartments, on the generic banks.
- A module that declares none: each of its banks is a compartment.

The bar for a `screen`: substantially better than the default view, and true to the instrument (its
structure, its vocabulary). Otherwise leave it out.

### Segments (segment mode)

A front panel shows the whole instrument, but its encoders play one page at a time. **Segments** put any
section of the panel under the hands: the panel names its sections, where each one sits and which keys
its encoders play.

```js
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [{ label: "Main", keys: ["cutoff", "resonance", "amp_attack", "amp_release"] }],
  segments: [
    { id: "osc", label: "Osc",    rect: [8, 26, 300, 74],   keys: ["osc1_wave", "osc1_tune", "", "osc_mix"] },
    { id: "vcf", label: "Filter", rect: [318, 26, 300, 74], keys: ["cutoff", "resonance", "filter_env"] }
  ],
  screen: function (g, v) { /* ... the encoder row from v.$knobs, as always ... */ }
});
```

- `id` (unique), `label` (else the id), `rect: [x, y, w, h]` where it sits on the panel (960 x 160; a panel
  that moves it says so while it draws, `g.segment`), and
  `keys`: 1 to 8, the encoders in order, `""` for an empty one. A key need not be on a page; give it
  metadata (it is in `chain_params`), or its encoder says READ ONLY. At most 8 segments (one a lower
  button); only on a `front_panel`. A mistake fails the file's load, as any other.
- **On the Push** (UX-GUIDELINES.md, *The controls*): in the open device upper button 7 reads `SEGMENTS`.
  Pressed, the lower buttons name the segments and Pung outlines each one's `rect` on the panel with its
  number and name (select mode); upper 7 again, upper 1 or a jog nudge left go back. A lower button then
  puts that segment's keys on the encoders (segment mode): turning, touching, Delete + touch, Live's
  automation, all as on a page. The lower buttons keep naming the segments, the active one lit, and upper
  7, lit white, is EXIT, back to the overview's encoders and page tabs (a jog nudge left too). In a
  segment Pung draws no top row over the panel at all (no device name, SOUNDS or EXIT label, not even
  with the jog turned): the panel keeps the screen. The jog wheel in
  segment mode, nudges right (round, from the overview into the first) and Shift + the wheel from the
  overview walk the segments in their declared order; a panel with segments takes the nudge right from a compartment's `wheel`: declare them in the order
  the eye reads the panel. Leaving the device, a page of another
  compartment, or another device leave the mode. Pages of the same panel keep it.
- **What the screen is told**: `v.$segmode` (`""`, `"select"` or `"segment"`), `v.$segment` (the active
  id, `""` none), `v.$segments` (`[{id, label, rect, keys}]`, always). In a segment `v.$knobs` are the
  segment's keys, so an encoder row drawn from `v.$knobs` relabels itself, and `v` holds their values (a
  compartment's screen is given every segment's keys). While the mode is on, `v.$tabs` are the segments'
  names and `v.$tab` the active one (-1 while choosing).
- **The bottom 18 pixels are Pung's while the mode is on** (y 142 to 160): the segments' names over the
  lower buttons. `g.knobs` takes its tighter form by itself then; a panel that draws its own encoder row
  moves its values above y 142 when `v.$segmode` is set, or they are cut.
- **The highlight**: in segment mode Pung draws a bar in the slot colour just above the active segment's
  `rect` (3 px, outside it: it covers none of the segment's heading; on the top row, along the edge
  inside), on every panel alike: the same colour as the active segment's name below. Nothing is dimmed or framed: the rest of the
  panel stays in view, as the player still reads it. A panel may add a touch in its own idiom from
  `v.$segment` and say **`draws_segments: true`**: the section's heading or legend lit, a segment's LED.
  Never dim the rest, and no outline or underline of its own beside Pung's bar. Select mode's outlines and
  numbers are always Pung's: they say which button is which. Leave the 3 pixels above a segment's `rect` free
  of text: the bar goes there.
- Everything Pung draws for segments is its own, outside the screen's budget. `GET
  /api/devices/<n>/compartments` lists each compartment's `segments` (`id`, `label`, `keys`, `rect`) and
  `draws_segments`; `GET /api/surface/state` says the mode (`segments`). The gallery (`PUNG_GALLERY`,
  `src/gallery_test.go`) writes `<id>-<compartment>-segments.png` and one
  `<id>-<compartment>-segment-<segment>.png` per segment.

## The instrument's look on Pung's pages (`push.theme`)

A custom screen is the instrument; Pung's default pages (every page without a screen of its own: its
cells, knobs, enum boxes, and the envelopes, filters, LFOs and mixers it recognizes) are drawn in Pung's
grey unless the screen file says how its instrument looks:

```js
push.theme({ ground: "#d4740f", panel: "#2a221d", ink: "#2b1606", dim: "#5a2e08", rule: "#a85a0b",
             faint: "#b8640e", accent: "#f0dfb8", knob: "pointer" });
```

- `ground`: the band between Push's two rows. `ink`: values and curves. `dim`: names. `rule`: lines,
  boxes, a knob's rim. `faint`: tracks, dividers. `panel`: a pointer knob's cap, a fader's cap. `accent`:
  a value's arc and a curve's fill (left out: the slot's colour, as on Pung's own pages). `fill`: the area under an envelope, a filter or an LFO, where the accent mixed into the ground would go muddy. Colours as in
  `g.*`. Only `ground` and `ink` are needed: the rest is mixed from them.
- `knob`: `"ring"` (Pung's), `"pointer"` (a hardware knob: a cap with its pointer, the value as an arc
  around it), `"fader"` (a slot and its cap).
- On a themed page a band screen's named colours are the theme's (`"fg"` its ink, `"dim"`, `"faint"`,
  `"line"`), and a `g.envelope`, `g.filter`, `g.lfo` or `g.mix` without a `color` takes its accent. A
  pointer's line and a fader cap's line are drawn in whichever of ink and ground stands out on the cap.
- The touched control stays in the slot's colour, as on every front panel; Push's two rows (the device,
  the pages) stay Push's. A front panel and a page's own screen draw themselves: the theme is for the
  pages Pung draws. Choose it from the front panel's and band screens' own colours, so a page turn stays
  in the same instrument.

## How the module's values read (`push.display`)

A module that answers bare numbers (Surge's attack as a log2 of seconds, a cutoff 0..1) shows them
as such wherever Pung writes a value: its own pages, the name and value row under a screen, the
values a screen gets in `v[k].display`. The screen file, which knows what they mean, says it once:

```js
push.display(function (key, raw) {
  if (key === "amp_attack") return { value: Math.round(1000 * Math.pow(2, +raw)) + "", unit: "ms" };
  if (key === "cutoff") return Math.round(20 * Math.pow(1000, +raw)) + " Hz";
  // nothing: Pung's own
});
```

It is asked once per key and value (remembered), never while a frame of the module's own is being
drawn (then Pung's own text stands), and a script error means Pung's own text.

### What the encoders are called (`push.short`)

In the row under a band screen a value shares its column with the name, so a long name is cut ("Kick
Pitch" reads "KICK PI."). Where the page already says what its knobs belong to, the screen file names
them: `push.short(function (key, name) { ... })` returns the name for that row and for Pung's default
pages, or nothing for the module's own (its `short` name in the row, else its name). The detail of a
touched knob keeps the module's full name. Asked once per key, like `push.display`.

```js
// SIMIAN: a drum's band says "KICK / BD TONE", so its knobs are PITCH, DECAY, ...
push.short(function (key) { return /^pad\d+_/.test(key) ? nameOf(key) : undefined; });
```

### Keys that do nothing (`push.unused`)

The parameters no compartment names get pages of leftovers after the compartments. A module may declare
keys that turn nothing: a switch its engine no longer reads, the keys of an engine its list never offers.
`push.unused(["grv_type", "gen_seed", ...])` gives them no page in Pung's view (Live and the web page still
list them). Say why beside it, from the module's source. A read-only value a compartment draws live
(`live_keys`, Omega's sequencer step) gets no page of its own either; it needs no entry here.

## An engine's envelope times (`push.envelopeTimes`)

Pung runs every note through an envelope in time (UX-GUIDELINES.md, *Envelopes*). Where a knob says its
time (`250 ms`, a key ending in `_ms`, a range in seconds) Pung knows it; where it does not, Pung
estimates. An overlay that knows the engine says it instead, and draws nothing for it:

```js
push.envelopeTimes(function (env) {
  // env.stages: one per drawn segment, in order: {role, label, key, raw,
  //   level_key, level, plateau}; raw and level are the knobs' raw values (null: unread)
  // env.rates: the stage knobs are rates; env.value(key): any knob's raw value
  return env.stages.map(function (s) { return s.plateau ? null : secondsFor(s); }); // null: Pung's estimate
});
```

It is called when an envelope is drawn or watched (never on the live clock's tick) for every envelope
Pung recognizes on the module's pages, its screens' `g.envelope` and the web page alike. Mini-JV's gives
the JV-880's measured tables; Dexed's runs msfa's envelope on the patch (memoised: the same rates and
levels give the same answer).

**On the web page.** `GET /api/devices/<n>/compartments` lists them, with the one the Push shows now
(`shown`); `POST /api/devices/<n>/compartment {"id": ...}` turns the Push to one. Pung's own page shows them as
its sections, and a strip over a module's own `web_ui.html`. On Pung's own page a compartment with a
`screen` shows that screen at the top of its section, drawn by the same code from the device's values:
`GET /api/devices/<n>/compartments/<id>/screen.png` (a web render never counts against the Push's budget). A module's own page is sent
`{type: "compartment", id, label, keys}` when the Push turns to another compartment, and may send
`{type: "showCompartment", id}` to turn the Push.

## Values (`v`)

`v[key]` has `value` (the raw string from the module), `frac` (0..1 in its range), `display` and `unit` (as
the native page shows them), `name`, `type` (`float`, `int`, `enum`...), `min` and `max` (the range the module states), and `known` (false until a value has been read: then `frac` is 0 and
means nothing, so draw a neutral shape). `v.$touched` is the key under a finger, or `""`. `t` is a time in
seconds, for motion.

**The sound, live (`v.$live`)**: a widget or a screen is told what the device's sound is doing (see
UX-GUIDELINES.md, "Live pictures"). `known` (false: no device sound to tell of); `level` (the output,
0..1 of the loudest of the last seconds) and `db` (dBFS); `held` (notes down) and `notes` (note-ons
ever: a change says a note began); `since_on` and `since_off` (seconds, -1 never); `voices` (each held
note and each let go in the last 6 s: `{note, vel, held, age, released}`, seconds); `playing`, `beat`,
`bpm` (Live's transport). While the sound moves, Pung draws 30 frames a second; draw motion only from
these or from your module's own state, never as decoration.

**Values your module drives (`live_keys`)**: `push.compartment({..., live_keys: ["live_voices"]})`
names keys of the module's own state (a voice's level, an LFO's phase) that Pung reads **every frame**
while that compartment shows, and gives in `v` like any other. Keep the module's `get_param` for them
cheap and lock-free: it is asked 30 times a second.

**A module's own web page, live**: while it is shown, Pung's page streams the sound and posts every frame
to it as `{type: "live", frame}`: `frame.info` is `v.$live` above, `frame.keys` the module's `live_keys`
(as `"synth:<key>"`), `frame.envs` / `frame.lfos` / `frame.spec` what Pung's own pictures show, `active`
whether the sound moves. Frames come 30 times a second while it moves and now and then at rest; none come
while the page is hidden. Mini-JV's page draws its chip's voices from `frame.keys["synth:live_voices"]`.

## Rules

- **Earn the pixels.** A picture must be substantially better than the native page and reflect the nature
  and spirit of the instrument. Otherwise leave the native page alone. Where widgets fit in the larger
  standard (compartments, custom screens): `DESIGN-v2.md`, "Design principles".

- A draw has **8 ms** a frame. One slower frame is allowed (curves computed the first time); three in a row
  over 8 ms, a draw over 40 ms, or a script that throws switch the picture off until Pung restarts. The
  native page comes back and the top bar says `MODULE UI OFF`. The log says why.
- The panel has 16-bit color: gradients show steps. Use flat colors and 2-pixel lines.
- **A user can always get back**: a front panel shows only while the device is open, and the way back and the page row are drawn over it on opening, on a page turn and while the jog wheel is touched.
