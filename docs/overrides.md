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
| `g.envelope(x, y, w, h, {attack, decay, hold, sustain, slope, release, labels})` | Pung's envelope, the one the default view and the web page draw. Each stage is a key (its value and touch are read for you) or a number 0..1; a stage left out is not drawn; `slope` is a Virus-style sustain slope; `labels: true` adds the stage letters |
| `g.filter(x, y, w, h, {cutoff, resonance, type})` | Pung's filter response. `cutoff` and `resonance` are keys or numbers 0..1; `type` is a key or a name (`"LP 24 dB"`, `"HP"`, `"BandPass"`); without a type, a lowpass |
| `g.lfo(x, y, w, h, {shape, rate})` | Pung's LFO: `shape` a key or a name (`"Sine"`, `"Saw Up"`, `"S&H"`), `rate` a key or a number 0..1 (1 to 5 cycles) |
| `g.mix(x, y, w, h, [levels])` | Pung's mixer: a fader per level (a key or a number 0..1), and each one's share of the whole across the top |
| `g.text(x, y, s, color, align[, maxWidth])` | small capitals (the label face); `y` is the baseline; align -1 left, 0 center, 1 right; with `maxWidth`, cut to fit it (ending in `.`) |
| `g.value(x, y, s, color, align[, maxWidth])` | the larger value face; with `maxWidth`, a smaller face before a cut, and a number is never cut (`-24000` becomes `-24K`) |
| `g.measure(s[, "value"])` | the width of `s` in pixels, in the label face or the value face |

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
  pages keep the default view. Use it where one page needs a picture (an envelope's eight stage knobs) and
  the rest are fine as knobs.
- **`takeover: true`** (with `screen`): the screen draws **all of the panel** (`g.w` 960, `g.h` 160), and Pung
  draws none of its own elements, only its notices on top. The screen must then show what those elements
  showed: the encoders' names and values (`v.$knobs`, the eight keys the encoders turn now, `""` for an
  empty one), the touched one, and which page it is (`v.$page`, the index into `v.$pages`, the page
  labels). `v.$name` is the device's name and `v.$track` Live's track. The bank list, Shift + Swap and any
  failure bring Pung's default view back. A takeover's budget is 14 ms (it draws what Pung's own elements
  would have).
- **`extra_keys`**: values a screen shows that no encoder edits (a patch name, a mode); they are read with
  the compartment's keys and given in `v`, even without metadata.
- Band screens and page screens also get `v.$page`, `v.$pages` and `v.$knobs`.
- The header says `COMPARTMENT / PAGE`. Page < > step through the pages; the bank list lists them.
- Parameters no compartment names stay reachable after the compartments, on the generic banks.
- A module that declares none: each of its banks is a compartment.

The bar for a `screen`: substantially better than the default view, and true to the instrument (its
structure, its vocabulary). Otherwise leave it out.

**On the web page.** `GET /api/devices/<n>/compartments` lists them, with the one the Push shows now
(`shown`); `POST /api/devices/<n>/compartment {"id": ...}` turns the Push to one. Pung's own page shows them as
its sections, and a strip over a module's own `web_ui.html`. On Pung's own page a compartment with a
`screen` shows that screen at the top of its section, drawn by the same code from the device's values:
`GET /api/devices/<n>/compartments/<id>/screen.png` (a web render never counts against the Push's budget). A module's own page is sent
`{type: "compartment", id, label, keys}` when the Push turns to another compartment, and may send
`{type: "showCompartment", id}` to turn the Push.

## Values (`v`)

`v[key]` has `value` (the raw string from the module), `frac` (0..1 in its range), `display` and `unit` (as
the native page shows them), `name`, and `known` (false until a value has been read: then `frac` is 0 and
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
- **Shift + Swap** switches between your picture and the native page, so a user can always get back.
