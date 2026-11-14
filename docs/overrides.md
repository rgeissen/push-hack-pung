# Module pictures on the Push (`push_ui.js`)

A Schwung module gets a native Push page with no Push code: Schwung builds it from the module's
`chain_params` and `ui_hierarchy`. A module can also draw its own widgets on that page. This file is for
module authors.

## Where the file goes

The first file found wins:

1. `push_ui.js` in the module's own folder, next to `module.json`. Move ignores this file.
2. `/data/push-hack/data/schwung/overrides/<module id>/push_ui.js`: your own overlay.
3. `overrides/<module id>/push_ui.js` in the Schwung hack: overlays that ship with Schwung.

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
| `g.text(x, y, s, color, align)` | small capitals (the label face); `y` is the baseline; align -1 left, 0 center, 1 right |
| `g.value(x, y, s, color, align)` | the larger value face |

Colors: `"#rrggbb"`, a Push palette name (`"orange"`, `"sky"`, ...), or `"slot"` (the slot's color), `"fg"`,
`"dim"`, `"faint"`, `"line"`, `"mod"`, `"warn"`, `"black"`. Text is ASCII only.

## Values (`v`)

`v[key]` has `value` (the raw string from the module), `frac` (0..1 in its range), `display` and `unit` (as
the native page shows them) and `name`. `v.$touched` is the key under a finger, or `""`. `t` is a time in
seconds, for motion.

## Rules

- A draw must finish in **8 ms**. A script that throws, or a draw that takes longer, is switched off until
  Schwung restarts; the native page comes back and the top bar shows `UI!`. The log says why.
- The panel has 16-bit color: gradients show steps. Use flat colors and 2-pixel lines.
- **Shift + Swap** switches between your picture and the native page, so a user can always get back.
