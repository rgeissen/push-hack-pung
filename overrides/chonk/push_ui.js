// CHONK (a physically modelled electric bass: one waveguide string) on Push.
// An overlay shipped with Pung (the module ships no push_ui.js).
//
// CHONK is one string, stopped at a fret and terminated at the bridge, plucked
// and picked up at one point part-way along it, then through a passive tone
// control, an EQ and a saturator. Its own face is a dark panel with the neck
// laid across it in rosewood and gold trim, and colour-coded knobs; Pung's
// screens keep that look, and draw the string as the model has it:
//
//   PANEL    the front panel: FRETTING (how one note glides into the next),
//            the STRING (stopped at the note's fret, the frets still ahead of
//            it, the pluck and pickup point where the model puts it for that
//            note, the string's swing from the sound's level, each harmonic as
//            loud as that point and the tone control let it through, how long
//            the note rings held and let go), ATTACK (the style, the click),
//            OUTPUT (the EQ curve, saturation, level) and MIDI in the header
//   STRING   the same string the band wide, the pickup's whole travel for the
//            note; the tone control as Pung's filter (the sound's spectrum
//            live behind it) with the note's harmonics standing in it; both
//            ring times on one time line
//   OUTPUT   level and pan, the saturator's curve, the EQ's response with each
//            band's handle over its knob
//
// Everything is the model's own arithmetic (src/dsp/faust/bass.dsp, params.lib,
// output.dsp, onetrick.lib), never a guess:
//
// - MIDI note m plays the string at key m - 24 (C3 sounds C1, 32.7 Hz), keys
//   24..67 (MIDI 48..91); the module's octave shift moves the notes first.
// - The string's length is f2l(f) / 2 (343 m/s / f / 2); the pickup, where the
//   pluck also goes in (strikePickup is one junction), is 12..20 cm from the
//   bridge by the knob, times 3 on the lowest key falling to times 1 on the
//   highest: 8% of the string on a low C at the knob's middle, 34% on a high G.
// - Plucked and picked up at x of the string, harmonic n comes through as
//   sin^2(n pi x): the position's comb, with its gaps at n = 1/x, 2/x...
// - Each round trip the wave bounces twice: efficiency 0.9945..0.9999 over the
//   range (linear in Hz), times 0.98..1 by Sustain, times 0.75..0.95 muted. A
//   released note damps toward 0.5 a bounce, Ring moving it geometrically in
//   the decay rate back to the held one. Ring time T60 = ln 1000 / (2 rate f):
//   within 10% of the compiled model, measured (E1 15.6 s against 15.1 s held,
//   0.12 s against 0.11 s let go; the loop's filters take a little more).
// - Tone is a one-pole low pass, 300 Hz..2.5 kHz (exponential in the knob).
// - A style replaces Strike Hardness: Finger 0, Pick 50%, Slap 100%; the click
//   decays over 2..8 ms by that hardness. A glide is a one-pole of Glide Time,
//   walked up the frets with Frets on (quantizeFrets:
//   each semitone held, a 0.175-semitone ramp between).
// - The EQ: a low shelf at 100 Hz, peaks (Q 0.71) at 250, 500, 1500 Hz, a
//   high shelf at 3 kHz; the saturator is the urchin waveshaper at 0.75 x Sat.

// ---- the model's numbers ------------------------------------------------------------------
var KEY_LO = 24, KEY_HI = 67, MIDI_LO = 48, MIDI_HI = 91, SPEED = 343;
function keyHz(k) { return 440 * Math.pow(2, (k - 69) / 12); }
var F_LO = keyHz(KEY_LO), F_HI = keyHz(KEY_HI);
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(k) { return NOTE[((k % 12) + 12) % 12] + (Math.floor(k / 12) - 1); }
var REST_KEY = 28; // E1, the bass's open E: the string drawn until a note is played
var STYLE = ["OFF", "FINGER", "PICK", "SLAP"], STYLE_HARD = [-1, 0, 0.5, 1];

function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function on(v, k) { return raw(v, k, 0) >= 0.5; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function lerp(t, a, b) { return a + t * (b - a); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }

// the string for a key (24..67) and the knobs: its frequency, where the pickup is,
// how long it rings held and let go
function stringOf(v, key) {
  var f = keyHz(key) * Math.pow(2, raw(v, "fine", 0) / 1200);
  var n01 = clamp((key - KEY_LO) / (KEY_HI - KEY_LO), 0, 1), f01 = clamp((f - F_LO) / (F_HI - F_LO), 0, 1);
  var len = SPEED / f / 2, mult = lerp(n01, 3, 1);
  function at(p01) { return clamp((lerp(p01, 12, 20) * mult / 100) / len, 0, 0.98); }
  var muted = on(v, "mute"), mute = muted ? lerp(f01, 0.75, 0.95) : 1;
  var eOpen = lerp(f01, 0.9945, 0.9999) * lerp(raw(v, "sustain", 100) / 100, 0.98, 1) * mute;
  var rOpen = Math.max(1e-6, -Math.log(eOpen)), rMuted = -Math.log(0.5);
  var rRel = Math.exp(lerp(raw(v, "ring", 0) / 100, Math.log(rMuted), Math.log(rOpen)));
  var LN = Math.log(1000);
  return { key: key, f: f, x: at(raw(v, "pickup", 50) / 100), x0: at(0), x1: at(1),
    held: LN / (2 * rOpen * f), rel: LN / (2 * rRel * f), muted: muted };
}
function toneHz(t01) { return 300 * Math.pow(2500 / 300, clamp(t01, 0, 1)); }
function hardness(v) { // the click's hardness: a style replaces the knob
  var s = Math.round(raw(v, "style", 0));
  return s > 0 ? STYLE_HARD[clamp(s, 0, 3)] : raw(v, "strike", 0) / 100;
}

// ---- the note on the string: the newest played (kept), else the open E ------------------------
var LAST = { key: -1 };
function stringKey(v) {
  var L = v.$live || {}, vs = L.voices || [], best = null, ot = Math.round(raw(v, "octave_transpose", 0));
  for (var i = 0; i < vs.length; i++) {
    var m = vs[i].note + 12 * ot;
    if (m < MIDI_LO || m > MIDI_HI) continue; // a keyswitch, or out of the string's range
    // one string: the newest held note has it; with none held, the newest let go rings out
    var held = !!vs[i].held;
    if (!best || (held && !best.held) || (held === best.held && vs[i].age < best.age)) best = { m: m, age: vs[i].age, held: held };
  }
  if (best) LAST.key = best.m - 24;
  return { key: LAST.key >= 0 ? LAST.key : REST_KEY, played: LAST.key >= 0, sounding: !!(L.known && L.level > 0.01) };
}

// ---- units: a value as it reads on the panel -----------------------------------------------
function secs(s) { return s >= 10 ? Math.round(s) + " S" : s >= 1 ? s.toFixed(1) + " S" : Math.round(s * 1000) + " MS"; }
function hzTxt(f) { return f >= 1000 ? (f / 1000).toFixed(1) + " KHZ" : Math.round(f) + " HZ"; }
function signed(n) { return (n > 0 ? "+" : "") + n; }
function fmt(k, x) {
  switch (k) {
  case "tone": var f = toneHz(x / 100); return f >= 1000 ? [(f / 1000).toFixed(1), "KHZ"] : [String(Math.round(f)), "HZ"];
  case "gain": return x <= -60 ? ["OFF", ""] : [signed(Math.round(x)), "DB"];
  case "pan": var p = Math.round(x); return [p === 0 ? "C" : (p < 0 ? "L" : "R") + Math.abs(p), ""];
  case "eq1": case "eq2": case "eq3": case "eq4": case "eq5": return [signed(Math.round(x * 2) / 2), "DB"];
  case "fine": return [signed(Math.round(x)), "CENT"];
  case "at_range": return [signed(Math.round(x * 10) / 10), "ST"];
  case "pw_range": return [String(Math.round(x * 10) / 10), "ST"];
  case "glide_ms": return [String(Math.round(x)), "MS"];
  case "style": return [STYLE[clamp(Math.round(x), 0, 3)], ""];
  case "mute": case "legato": case "glide": case "frets": case "altpick": case "retrig": return [x >= 0.5 ? "ON" : "OFF", ""];
  case "pickup": case "sustain": case "bright": case "strike": case "thump": case "ring": case "sat": case "sens": case "depth":
    return [String(Math.round(x)), "%"];
  }
  return null;
}
push.display(function (key, rv) {
  if (key !== "tone") return; // the module's own units read well; Tone reads as its corner
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmt(key, n);
  return { value: f[0], unit: f[1] };
});
function val(v, k) {
  if (!known(v, k)) return ["--", ""];
  return fmt(k, raw(v, k, 0)) || [txt(v, k).toUpperCase(), ""];
}

// ---- CHONK's palette (its Palette::new(8): shift .49, saturation .65, levels .15..95) ----------------
var GROUND = "#454545", DARK = "#262626", BLACK = "#141414", KNOB = "#e5e5e5", RULE = "#5a5a5a", FAINT = "#3a3a3a";
var INK = "#ffffff", LEG = "#c4c4c4", DIM = "#8a8a8a";
var NECK = "#8c523f", BODY = "#232323", TRIM = "#f2c155", NICKEL = "#ececec", CHROME = "#b5b5b5";
var FRETW = "#c9a58f", INLAY = "#e8dcc8", FINGER = "#d8b49a";
var TEAL = "#55f2e9", CORAL = "#f2555e", GOLD = "#f2c155", VIOLET = "#9a55f2", ORANGE = "#f28a55";
var TEAL_D = "#2f8a85", VIOLET_L = "#b583f5";
var SEC = { string: TEAL, attack: CORAL, fretting: VIOLET_L, output: GOLD, midi: ORANGE };
var KEYSEC = {
  pickup: "string", bright: "string", tone: "string", thump: "string", sustain: "string", ring: "string",
  style: "attack", strike: "attack", mute: "attack", altpick: "attack", depth: "attack",
  legato: "fretting", glide: "fretting", glide_ms: "fretting", frets: "fretting", retrig: "fretting",
  gain: "output", pan: "output", sat: "output", eq1: "output", eq2: "output", eq3: "output", eq4: "output", eq5: "output",
  fine: "midi", pw_range: "midi", at_range: "midi", sens: "midi"
};
var NAMES = {
  pickup: "PICKUP", bright: "BRIGHT", tone: "TONE", thump: "THUMP", sustain: "SUSTAIN", ring: "RING",
  style: "STYLE", strike: "STRIKE", mute: "MUTE", altpick: "ALT PICK", depth: "PICK DEPTH",
  legato: "LEGATO", glide: "GLIDE", glide_ms: "GLIDE TIME", frets: "FRETS", retrig: "RETRIGGER",
  gain: "VOLUME", pan: "PAN", sat: "SATURATE", eq1: "EQ 100", eq2: "EQ 250", eq3: "EQ 500", eq4: "EQ 1.5K", eq5: "EQ 3K",
  fine: "FINE TUNE", pw_range: "BEND", at_range: "AFTERTOUCH", sens: "VEL SENS"
};
var TOGGLES = { mute: 1, legato: 1, glide: 1, frets: 1, altpick: 1, retrig: 1 };
var BIPOLAR = { pan: 1, eq1: 1, eq2: 1, eq3: 1, eq4: 1, eq5: 1, fine: 1, at_range: 1 };

var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 64) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}

// a section's tag: CHONK's subheading, its colour behind black capitals
function tag(g, x, y, s, col) {
  var w = g.measure(s) + 10;
  g.fill(x, y, w, 11, col);
  g.text(x + 5, y + 9, s, "#000000", -1);
  return w;
}
// a lit switch: a small LED and its word
function lamp(g, x, y, s, lit, col, hot) {
  g.fill(x, y - 7, 8, 8, lit ? (hot ? "slot" : col) : DARK);
  if (!lit) g.fill(x + 2, y - 5, 4, 4, FAINT);
  g.text(x + 12, y, s, hot ? "slot" : lit ? INK : DIM, -1);
}

// ---- the string ------------------------------------------------------------------------------
// the string from the fret (x0) to the bridge (x1) at y; S from stringOf; amp its swing in px.
// A plucked string sweeps the triangle on its pluck point and its mirror (Helmholtz motion):
// the outline of everywhere it goes, from the sound's level.
function drawString(g, x0, x1, y, S, amp) {
  var xp = x1 - S.x * (x1 - x0);
  if (amp >= 1) {
    g.area([x0, y, xp, y - amp, x1, y], y, TEAL_D);
    g.area([x0, y, xp, y + amp, x1, y], y, TEAL_D);
    g.poly([x0, y, xp, y - amp, x1, y], 1.5, TEAL);
    g.poly([x0, y, xp, y + amp, x1, y], 1.5, TEAL);
  }
  g.fill(x0, y - 1, x1 - x0, 2, NICKEL);
  return xp;
}
// the pickup under the string at xp (the pluck goes in at the same point: the model's one
// junction), and what plucks it from above: a pick, or a finger (a thumb to slap)
function drawPickup(g, xp, ys, h, hot, style) {
  g.fill(xp - 10, ys + 3, 20, h, hot ? "slot" : "#5e5e5e");
  g.fill(xp - 9, ys + 4, 18, h - 2, hot ? "slot" : BLACK);
  g.dot(xp - 4, ys + 3 + h / 2, 1.8, CHROME);
  g.dot(xp + 4, ys + 3 + h / 2, 1.8, CHROME);
  if (style === 2) g.area([xp - 5, ys - 13, xp, ys - 4, xp + 5, ys - 13], ys - 13, hot ? "slot" : CORAL);
  else g.dot(xp, ys - 9, style === 3 ? 4.5 : 3.5, hot ? "slot" : CORAL);
}
// what the string puts out through the pickup and the tone control: the tone control is
// Pung's filter (a one-pole low pass at its corner, the sound's spectrum live behind it), and
// in it each harmonic of the note at its frequency, as loud as the place lets it through
// (plucked and picked up at x of the string: sin^2(n pi x)) and the tone after it
var FLT_TOP = 21, FLT_BOT = -39; // Pung's filter picture's dB axis
function drawTone(g, x, y, w, h, S, v, toneHot, posHot) {
  var fc = toneHz(raw(v, "tone", 50) / 100), at = Math.log(fc / 20) / Math.log(1000);
  g.filter(x, y, w, h, { cutoff: "tone", type: "LP 6 dB", at: at, color: GOLD });
  var x0 = x + 6, x1 = x + w - 6, top = y + 6, base = y + h - 6;
  var lines = cached("harm|" + S.f.toFixed(2) + "|" + S.x.toFixed(4) + "|" + fc.toFixed(1) + "|" + [x, y, w, h].join(","), function () {
    var out = [];
    for (var n = 1; n <= 48; n++) {
      var f = n * S.f;
      if (f > 20000) break;
      var c = Math.pow(Math.sin(n * Math.PI * S.x), 2), db = 20 * Math.log(Math.max(c, 1e-4)) / Math.LN10 - 10 * Math.log(1 + Math.pow(f / fc, 2)) / Math.LN10;
      var yy = top + (FLT_TOP - clamp(db, FLT_BOT, FLT_TOP)) / (FLT_TOP - FLT_BOT) * (base - top);
      out.push([x0 + (x1 - x0) * Math.log(f / 20) / Math.log(1000), yy, c < 0.03]);
    }
    return out;
  });
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    if (base - L[1] < 1) continue;
    g.fill(L[0] - 1, L[1], 2, base - L[1], posHot ? "slot" : L[2] ? RULE : TEAL);
  }
}

// the same on the panel, where a filter picture would be too small to read: a bar per
// harmonic (1..20), its level through the pickup's place and the tone, over 30 dB
var HARM = 20;
function drawComb(g, x0, w, base, h, S, v, posHot, toneHot) {
  var fc = toneHz(raw(v, "tone", 50) / 100), bw = w / HARM;
  var bars = cached("comb|" + S.f.toFixed(2) + "|" + S.x.toFixed(4) + "|" + fc.toFixed(1), function () {
    var out = [];
    for (var n = 1; n <= HARM; n++) {
      var c = Math.pow(Math.sin(n * Math.PI * S.x), 2);
      var db = 20 * Math.log(Math.max(c, 1e-4)) / Math.LN10 - 10 * Math.log(1 + Math.pow(n * S.f / fc, 2)) / Math.LN10;
      out.push([clamp(1 + db / 30, 0, 1), c < 0.03]);
    }
    return out;
  });
  for (var i = 0; i < HARM; i++) {
    var bh = Math.max(1, bars[i][0] * h);
    g.fill(x0 + i * bw + 1, base - bh, bw - 3, bh, posHot || toneHot ? "slot" : bars[i][1] ? RULE : TEAL);
  }
}

// ---- the EQ and the saturator -----------------------------------------------------------------
var EQ_HZ = [100, 250, 500, 1500, 3000];
// gain in dB at f, as Faust's filters make it: Butterworth shelves of order 3 (fi.low_shelf,
// fi.high_shelf: |H|^2 = (A^2 + q)/(1 + q), q = (f/fx)^6) and fi.peak_eq_cq's second-order
// section (s^2 + g a s + 1)/(s^2 + a s + 1), a = pi (fx/Q) T / sin(2 pi fx T), Q 0.71, g the
// band's gain (a cut swaps the two). Checked against the module's compiled output.dsp
// (2026-11-23): every band alone within 0.05 dB, all five together within 0.1 dB.
var EQ_SR = 44100;
function eqDb(gains, f) {
  var db = 0, i;
  for (i = 0; i < 5; i++) {
    var gdb = gains[i];
    if (Math.abs(gdb) < 0.01) continue;
    var r = f / EQ_HZ[i];
    if (i === 0 || i === 4) {
      var A2 = Math.pow(10, gdb / 10), q = Math.pow(i === 0 ? r : 1 / r, 6);
      db += 10 * Math.log((A2 + q) / (1 + q)) / Math.LN10;
    } else {
      var fx = EQ_HZ[i], a = Math.PI * (fx / 0.71) / EQ_SR / Math.sin(2 * Math.PI * fx / EQ_SR);
      var g = Math.pow(10, Math.abs(gdb) / 20), u = (1 - r * r) * (1 - r * r);
      var ratio = (u + Math.pow(g * a * r, 2)) / (u + Math.pow(a * r, 2));
      db += (gdb > 0 ? 1 : -1) * 10 * Math.log(ratio) / Math.LN10;
    }
  }
  return db;
}
function eqCurve(v, x0, x1, mid, half) {
  var gains = [], i;
  for (i = 0; i < 5; i++) gains.push(raw(v, "eq" + (i + 1), 0));
  return cached("eq|" + gains.join(",") + "|" + [x0, x1, mid, half].join(","), function () {
    var pts = [], n = Math.round((x1 - x0) / 4);
    for (var j = 0; j <= n; j++) {
      var f = 20 * Math.pow(1000, j / n), db = clamp(eqDb(gains, f), -15, 15);
      pts.push(x0 + (x1 - x0) * j / n, mid - db / 12 * half);
    }
    return pts;
  });
}
function eqX(f, x0, x1) { return x0 + (x1 - x0) * Math.log(f / 20) / Math.log(1000); }
// the urchin waveshaper (onetrick.lib) at s = 0.75 x Sat
function urchin(x, s) {
  var h = clamp(lerp(s, 0.5, 0.9), 0.001, 0.999), t = Math.abs(x);
  return (t / ((1 / h - 2) * (1 - t) + 1)) * (x < 0 ? -1 : 1) * lerp(s, 1, 0.3);
}

// ---- the encoder row: CHONK's knobs (a black well, the colour arc, a light cap) -------------------
function knob(g, cx, cy, r, f, col, hot, ok, bip) {
  g.dot(cx, cy, r + 4, BLACK);
  var a0 = 0.75 * Math.PI, sw = 1.5 * Math.PI, c = hot ? "slot" : ok ? col : DIM;
  g.arc(cx, cy, r + 1.5, a0, sw, 3, DARK);
  if (ok) {
    if (bip) {
      var m = a0 + sw / 2, e = a0 + sw * f;
      if (Math.abs(e - m) > 0.02) g.arc(cx, cy, r + 1.5, Math.min(m, e), Math.abs(e - m), 3, c);
    } else if (f > 0.005) g.arc(cx, cy, r + 1.5, a0, sw * f, 3, c);
  }
  g.dot(cx, cy, r - 2, KNOB);
  var a = a0 + sw * (ok ? f : 0.5);
  g.line(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3), 2, DARK);
}
function encoderRow(g, v, seg) {
  var kn = v.$knobs || [], t = v.$touched || "";
  var cy = seg ? 123 : 132, r = seg ? 9 : 12, ny = seg ? 118 : 124, vy = seg ? 138 : 146;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x = c * 120, hot = k === t, ok = known(v, k), col = SEC[KEYSEC[k]] || TEAL, cx = x + 22;
    if (TOGGLES[k]) { // a switch: CHONK's lit button
      var lit = ok && on(v, k);
      g.fill(cx - 12, cy - 9, 24, 18, BLACK);
      g.fill(cx - 9, cy - 6, 18, 12, lit ? (hot ? "slot" : col) : DARK);
    } else if (k === "style") { // four positions round a dark knob
      var s = Math.round(raw(v, k, 0));
      knob(g, cx, cy, r, s / 3, col, hot, ok, false);
    } else {
      var f = ok ? clamp(v[k].frac, 0, 1) : 0.5;
      knob(g, cx, cy, r, f, col, hot, ok, !!BIPOLAR[k]);
    }
    g.text(x + 42, ny, NAMES[k] || String((v[k] && v[k].name) || k).toUpperCase(), hot ? "slot" : LEG, -1, 74);
    var fv = val(v, k), vw = g.measure(fv[0], "value");
    g.value(x + 42, vy, fv[0], hot ? "slot" : ok ? INK : DIM, -1, 74);
    if (fv[1] && vw + 4 + g.measure(fv[1]) <= 76) g.text(x + 42 + vw + 4, vy, fv[1], hot ? "slot" : LEG, -1);
  }
}

// ---- the front panel -------------------------------------------------------------------------
// FRETTING 4..184 | STRING 188..664 | ATTACK 668..804 | OUTPUT 808..956, y 22..103; MIDI in the header
var SY = 40; // the string on the panel
function panelGround(g, seg) {
  g.fill(0, 0, 960, 160, GROUND);
  g.fill(0, 0, 960, 20, DARK);
  // the name, heavy: drawn twice, a pixel apart
  g.value(8, 16, "CHONK", INK, -1); g.value(9, 16, "CHONK", INK, -1);
  // the sections' tags
  tag(g, 4, 23, "FRETTING", SEC.fretting);
  tag(g, 668, 23, "ATTACK", SEC.attack);
  tag(g, 808, 23, "OUTPUT", SEC.output);
  tag(g, 192, 23, "STRING", SEC.string);
  // the dividers
  g.fill(186, 22, 1, 81, DARK); g.fill(666, 22, 1, 81, DARK); g.fill(806, 22, 1, 81, DARK);
  // the encoder row
  g.fill(0, 104, 960, 56, DARK);
  g.fill(0, 104, 960, 2, BLACK);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 28 : 44, FAINT);
}

function fretting(g, v, t) {
  // a glide of a fifth, over its first second: a one-pole of Glide Time (Legato or Glide on),
  // walked up the frets with Frets on; else the pitch jumps
  var gl = on(v, "glide") || on(v, "legato"), frets = on(v, "frets"), tau = Math.max(0.0005, raw(v, "glide_ms", 35) / 1000);
  var x0 = 12, x1 = 178, yb = 78, yt = 51, hot = t === "glide_ms" || t === "glide" || t === "frets" || t === "legato";
  g.fill(x0, yb, x1 - x0, 1, RULE);
  if (frets) for (var s = 1; s <= 7; s++) g.fill(x0, Math.round(yb - (yb - yt) * s / 7), x1 - x0, 1, FAINT);
  var pts = cached("glide|" + gl + frets + tau.toFixed(4), function () {
    var p = [x0, yb], n = 83;
    if (!gl) { p.push(x0, yt, x1, yt); return p; }
    for (var j = 0; j <= n; j++) {
      var tt = j / n, st = 7 * (1 - Math.exp(-tt / tau));
      if (frets) { var wh = Math.floor(st); st = wh + clamp((st - wh - 0.4125) / 0.175, 0, 1); } // quantizeFrets: soft, 0.175 wide
      p.push(x0 + (x1 - x0) * tt, yb - (yb - yt) * st / 7);
    }
    return p;
  });
  g.poly(pts, 2, hot ? "slot" : SEC.fretting);
  g.text(x0, 45, gl ? (frets ? "UP THE FRETS" : "SLIDES") : "JUMPS", hot ? "slot" : INK, -1);
  g.text(x1, 45, gl ? Math.round(tau * 1000) + " MS" : "", t === "glide_ms" ? "slot" : LEG, 1);
  // its switches
  lamp(g, 10, 91, "LEGATO", on(v, "legato"), SEC.fretting, t === "legato");
  lamp(g, 98, 91, "GLIDE", on(v, "glide"), SEC.fretting, t === "glide");
  lamp(g, 10, 102, "FRETS", frets, SEC.fretting, t === "frets");
  lamp(g, 98, 102, "RETRIG", on(v, "retrig"), SEC.fretting, t === "retrig");
}

// the string section: the note at the left, then the string from its fret to the bridge drawn
// as the model has it: the frets still ahead of the note, the fretboard's end (the top key's
// fret), the body with the pickup, the bridge; under it the pickup's place, the harmonics that
// place lets through, how long the note rings
var NX0 = 252, NX1 = 662, BRX = 648, NY0 = 24, NY1 = 56;
function stringSection(g, v, t) {
  var SK = stringKey(v), S = stringOf(v, SK.key), L = v.$live || {}, n = S.key - KEY_LO, i;
  var amp = SK.sounding ? 2 + 12 * clamp(L.level || 0, 0, 1) : 0, hotPos = t === "pickup";
  var X = function (rel) { return BRX - rel * (BRX - NX0); }; // rel: from the bridge, of the sounding length
  // the note, its frequency, its fret
  g.value(219, 55, noteName(S.key), INK, 0);
  g.text(219, 66, Math.round(S.f) + " HZ", LEG, 0);
  g.text(219, 77, n > 0 ? "FRET " + n : "OPEN", DIM, 0);
  // the fretboard ahead of the fret, then the body
  var endRel = Math.pow(2, -(KEY_HI - S.key) / 12), xe = X(endRel), h = NY1 - NY0;
  g.fill(NX0, NY0, xe - NX0, h, NECK);
  g.fill(xe, NY0, NX1 - xe, h, BODY);
  var fx = cached("frets|" + S.key, function () {
    var a = [];
    for (var m = 1; m <= KEY_HI - S.key; m++) a.push([X(Math.pow(2, -m / 12)), m + n]);
    return a;
  });
  for (i = 0; i < fx.length; i++) {
    g.fill(fx[i][0], NY0, 1, h, FRETW);
    var fn = fx[i][1] % 12, mx = i > 0 ? (fx[i][0] + fx[i - 1][0]) / 2 : (fx[i][0] + NX0) / 2;
    if (fn === 3 || fn === 5 || fn === 7 || fn === 9) g.dot(mx, NY1 - 6, 1.6, INLAY);
    if (fn === 0) { g.dot(mx, NY0 + 6, 1.6, INLAY); g.dot(mx, NY1 - 6, 1.6, INLAY); }
  }
  g.fill(NX0, NY0 - 2, NX1 - NX0, 2, TRIM); g.fill(NX0, NY1, NX1 - NX0, 2, TRIM);
  // the fret the note is stopped at, the bridge
  g.fill(NX0, NY0, 3, h, CHROME);
  g.dot(NX0 - 5, SY, 5, FINGER);
  g.fill(BRX, NY0 + 4, 10, h - 8, CHROME);
  // the string and its swing (the sound's level), the pickup and the pluck at one point
  var xp = drawString(g, NX0 + 3, BRX, SY, S, amp);
  drawPickup(g, xp, SY, 9, hotPos, Math.round(raw(v, "style", 0)));
  // under the neck: the pickup's travel for this note (the knob's 0..100%) and its place
  var xa = X(S.x0), xb = X(S.x1), tc = hotPos ? "slot" : TRIM;
  g.fill(xb, 60, xa - xb + 1, 1, tc); g.fill(xb, 58, 1, 5, tc); g.fill(xa, 58, 1, 5, tc);
  g.fill(xp - 1, 58, 3, 5, hotPos ? "slot" : INK);
  g.text(xb - 6, 65, known(v, "pickup") ? "PICKUP " + Math.round(S.x * 100) + "% FROM THE BRIDGE" : "PICKUP --", hotPos ? "slot" : LEG, 1);
  // the harmonics that place lets through, the tone control over them
  g.text(258, 79, "HARMONICS THROUGH PICKUP AND TONE", LEG, -1);
  drawComb(g, 258, 272, 102, 18, S, v, hotPos, t === "tone");
  // how long it rings: held, and let go
  var hx = 548;
  g.text(hx, 79, "RINGS", LEG, -1);
  g.text(660, 79, S.muted ? "MUTED" : "", CORAL, 1);
  g.text(hx, 91, "HELD", DIM, -1); g.text(660, 91, known(v, "sustain") ? secs(S.held) : "--", t === "sustain" ? "slot" : INK, 1);
  g.text(hx, 102, "LET GO", DIM, -1); g.text(660, 102, known(v, "ring") && known(v, "sustain") ? secs(S.rel) : "--", t === "ring" ? "slot" : INK, 1);
}

function attack(g, v, t) {
  var st = Math.round(raw(v, "style", 0)), hotS = t === "style";
  for (var i = 0; i < 4; i++) {
    var x = 672 + (i % 2) * 66, y = 37 + Math.floor(i / 2) * 15, lit = known(v, "style") && st === i;
    g.fill(x, y, 62, 12, lit ? (hotS ? "slot" : CORAL) : DARK);
    g.text(x + 31, y + 9, STYLE[i], lit ? "#000000" : DIM, 0);
  }
  // the click: its hardness (a style's, else the knob's) and how long it lasts
  var h = hardness(v), hotK = t === "strike" || hotS;
  g.text(672, 76, "CLICK " + Math.round(h * 100) + "%", hotK ? "slot" : st > 0 ? LEG : INK, -1);
  g.text(800, 76, Math.round(lerp(h, 2, 8)) + " MS", LEG, 1);
  g.fill(672, 79, 128, 3, DARK);
  g.fill(672, 79, Math.max(2, 128 * h), 3, hotK ? "slot" : CORAL);
  lamp(g, 672, 91, "MUTE", on(v, "mute"), CORAL, t === "mute");
  lamp(g, 672, 102, "ALT PICK", on(v, "altpick"), CORAL, t === "altpick");
  if (on(v, "altpick")) g.text(800, 102, Math.round(raw(v, "depth", 100)) + "%", t === "depth" ? "slot" : LEG, 1);
}

function output(g, v, t) {
  var x0 = 814, x1 = 950, mid = 56, half = 16, i;
  g.fill(x0, mid, x1 - x0, 1, RULE);
  for (i = 0; i < 5; i++) {
    var k = "eq" + (i + 1), ex = eqX(EQ_HZ[i], x0, x1), gy = mid - clamp(raw(v, k, 0), -12, 12) / 12 * half;
    g.fill(ex, mid - half, 1, half * 2, FAINT);
  }
  var hotEq = /^eq/.test(t);
  g.poly(eqCurve(v, x0, x1, mid, half), 2, hotEq ? "slot" : GOLD);
  for (i = 0; i < 5; i++) {
    var kk = "eq" + (i + 1), bx = eqX(EQ_HZ[i], x0, x1), by = mid - clamp(raw(v, kk, 0), -12, 12) / 12 * half;
    g.dot(bx, by, t === kk ? 3.5 : 2.5, t === kk ? "slot" : INK);
  }
  var sat = raw(v, "sat", 0), gn = raw(v, "gain", 0), pan = Math.round(raw(v, "pan", 0));
  g.text(812, 89, "SAT", DIM, -1); g.text(880, 89, Math.round(sat) + "%", t === "sat" ? "slot" : INK, 1);
  g.text(890, 89, "PAN", DIM, -1); g.text(952, 89, val(v, "pan")[0], t === "pan" ? "slot" : INK, 1);
  g.text(812, 101, "VOLUME", DIM, -1); g.text(952, 101, val(v, "gain").join(" "), t === "gain" ? "slot" : INK, 1);
}

function midiStrip(g, v, t) {
  var x = 384;
  x += tag(g, x, 5, "MIDI", SEC.midi) + 8;
  var items = [["BEND", "pw_range", "±" + val(v, "pw_range").join(" ")], ["AT", "at_range", val(v, "at_range").join(" ")],
    ["FINE", "fine", val(v, "fine").join(" ")], ["VEL", "sens", val(v, "sens").join("")]];
  for (var i = 0; i < items.length; i++) {
    var it = items[i], hot = t === it[1];
    g.text(x, 14, it[0], hot ? "slot" : DIM, -1);
    x += g.measure(it[0]) + 5;
    g.text(x, 14, it[2], hot ? "slot" : INK, -1);
    x += g.measure(it[2]) + 12;
  }
}

function panel(g, v) {
  var seg = !!v.$segmode, t = v.$touched || "";
  g.layer("chonk|" + (seg ? 1 : 0), function () { panelGround(g, seg); });
  g.text(84, 14, txt(v, "preset_name").toUpperCase(), GOLD, -1, 286);
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(952, 14, ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  midiStrip(g, v, t);
  fretting(g, v, t);
  stringSection(g, v, t);
  attack(g, v, t);
  output(g, v, t);
  encoderRow(g, v, seg);
}

push.theme({ ground: GROUND, panel: KNOB, ink: INK, dim: LEG, rule: BLACK, faint: FAINT, accent: TEAL, knob: "pointer" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  segments: [
    { id: "fretting", label: "Fretting", rect: [4, 22, 180, 81], keys: ["legato", "glide", "glide_ms", "frets", "retrig"] },
    { id: "string", label: "String", rect: [188, 22, 476, 81], keys: ["pickup", "bright", "tone", "thump", "sustain", "ring"] },
    { id: "attack", label: "Attack", rect: [668, 22, 136, 81], keys: ["style", "strike", "mute", "altpick", "depth"] },
    { id: "output", label: "Output", rect: [808, 22, 148, 81], keys: ["gain", "pan", "sat", "eq1", "eq2", "eq3", "eq4", "eq5"] },
    { id: "midi", label: "MIDI", rect: [380, 0, 330, 20], keys: ["fine", "pw_range", "at_range", "sens"] }
  ],
  pages: [
    { label: "String", keys: ["pickup", "bright", "tone", "thump", "sustain", "ring", "sat", "gain"] },
    { label: "Attack", keys: ["style", "strike", "mute", "altpick", "depth", "legato", "glide", "glide_ms"] },
    { label: "Output", keys: ["gain", "pan", "sat", "eq1", "eq2", "eq3", "eq4", "eq5"] },
    { label: "Frets / MIDI", keys: ["frets", "retrig", "fine", "pw_range", "at_range", "sens"] }
  ],
  extra_keys: ["preset_name", "octave_transpose", "pickup", "bright", "tone", "thump", "sustain", "ring", "style", "strike", "mute",
    "altpick", "depth", "legato", "glide", "glide_ms", "frets", "retrig", "gain", "pan", "sat", "eq1", "eq2", "eq3", "eq4", "eq5",
    "fine", "pw_range", "at_range", "sens"],
  screen: panel
});

// ---- the band screens: CHONK's ground, a tag per part --------------------------------------------
function bandGround(g, key, tags) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, GROUND);
    for (var i = 0; i < tags.length; i++) tag(g, tags[i][0], 1, tags[i][1], tags[i][2]);
  });
}

// ---- STRING: the string large, the comb, how long it rings -----------------------------------------
push.compartment({
  id: "string", label: "String",
  pages: [{ label: "String", keys: ["pickup", "bright", "tone", "thump", "sustain", "ring"] }],
  extra_keys: ["octave_transpose", "fine", "mute", "style"],
  screen: function (g, v) {
    var t = v.$touched || "", SK = stringKey(v), S = stringOf(v, SK.key), L = v.$live || {}, n = S.key - KEY_LO, i;
    bandGround(g, "b-string", [[4, "STRING", TEAL]]);
    g.text(62, 10, noteName(S.key) + "  " + Math.round(S.f) + " HZ  " + (n > 0 ? "FRET " + n : "OPEN") + (SK.played ? "" : "   NO NOTE YET: THE OPEN E"), INK, -1);
    // the neck, the whole band wide
    var x0 = 14, br = 930, y0 = 15, y1 = 37, ys = 26, hotPos = t === "pickup";
    var X = function (rel) { return br - rel * (br - x0); };
    var xe = X(Math.pow(2, -(KEY_HI - S.key) / 12));
    g.fill(x0, y0, xe - x0, y1 - y0, NECK);
    g.fill(xe, y0, 944 - xe, y1 - y0, BODY);
    var fx = cached("bfrets|" + S.key, function () {
      var a = [];
      for (var m = 1; m <= KEY_HI - S.key; m++) a.push([X(Math.pow(2, -m / 12)), m + n]);
      return a;
    });
    for (i = 0; i < fx.length; i++) {
      g.fill(fx[i][0], y0, 1, y1 - y0, FRETW);
      var fn = fx[i][1] % 12, mx = i > 0 ? (fx[i][0] + fx[i - 1][0]) / 2 : (fx[i][0] + x0) / 2;
      if (fn === 3 || fn === 5 || fn === 7 || fn === 9) g.dot(mx, y1 - 5, 1.8, INLAY);
      if (fn === 0) { g.dot(mx, y0 + 5, 1.8, INLAY); g.dot(mx, y1 - 5, 1.8, INLAY); }
    }
    g.fill(x0, y0 - 2, 944 - x0, 2, TRIM); g.fill(x0, y1, 944 - x0, 2, TRIM);
    g.fill(x0, y0, 3, y1 - y0, CHROME);
    g.dot(x0 - 5, ys, 5, FINGER);
    g.fill(br, y0 + 3, 12, y1 - y0 - 6, CHROME);
    var amp = SK.sounding ? 2 + 8 * clamp(L.level || 0, 0, 1) : 0;
    var xp = drawString(g, x0 + 3, br, ys, S, amp);
    drawPickup(g, xp, ys, 7, hotPos, Math.round(raw(v, "style", 0)));
    // the pickup's travel for this note, and its place
    var xa = X(S.x0), xb = X(S.x1), tc = hotPos ? "slot" : TRIM;
    g.fill(xb, 43, xa - xb + 1, 1, tc); g.fill(xb, 41, 1, 5, tc); g.fill(xa, 41, 1, 5, tc);
    g.fill(xp - 1, 41, 3, 5, hotPos ? "slot" : INK);
    g.text(xb - 8, 47, "PICKUP " + Math.round(S.x * 100) + "% FROM THE BRIDGE  (" + Math.round(S.x0 * 100) + "-" + Math.round(S.x1 * 100) + "% ON THIS NOTE)", hotPos ? "slot" : LEG, 1);
    // the harmonics through pickup and tone, under PICKUP, BRIGHT and TONE
    drawTone(g, 0, 42, 360, 44, S, v, t === "tone", hotPos);
    g.text(8, 55, "THE HARMONICS", LEG, -1);
    g.text(366, 62, "TONE", t === "tone" ? "slot" : GOLD, -1);
    g.text(366, 73, hzTxt(toneHz(raw(v, "tone", 50) / 100)), t === "tone" ? "slot" : INK, -1);
    // thump: the finger's push into the output (out of circuit while muted)
    g.text(420, 62, "THUMP", t === "thump" ? "slot" : LEG, -1);
    g.text(420, 73, S.muted ? "MUTED" : (Math.round(raw(v, "thump", 50) * 3) / 100) + " X", S.muted ? CORAL : INK, -1);
    // how long it rings, held and let go, on one time line (10 ms .. 60 s)
    var tx0 = 490, tx1 = 940;
    function tX(s) { return tx0 + (tx1 - tx0) * clamp(Math.log(s / 0.01) / Math.log(6000), 0, 1); }
    var hh = t === "sustain", rh = t === "ring";
    g.text(tx0, 60, "RINGS HELD", hh ? "slot" : LEG, -1); g.text(tx0 + 130, 60, secs(S.held), hh ? "slot" : INK, 1);
    g.text(tx0 + 230, 60, "LET GO", rh ? "slot" : LEG, -1); g.text(tx0 + 340, 60, secs(S.rel), rh ? "slot" : INK, 1);
    g.fill(tx0, 64, Math.max(2, tX(S.held) - tx0), 4, hh ? "slot" : TEAL);
    g.fill(tx0, 70, Math.max(2, tX(S.rel) - tx0), 4, rh ? "slot" : CORAL);
    g.fill(tx0, 76, tx1 - tx0, 1, RULE);
    var marks = [[0.01, "10 MS"], [0.1, "0.1 S"], [1, "1 S"], [10, "10 S"], [60, "60 S"]];
    for (i = 0; i < marks.length; i++) {
      var mxx = tX(marks[i][0]);
      g.fill(mxx, 75, 1, 3, RULE);
      g.text(mxx, 86, marks[i][1], DIM, i === 0 ? -1 : i === marks.length - 1 ? 1 : 0);
    }
  }
});

// ---- OUTPUT: level and pan, the saturator's curve, the EQ over its knobs ------------------------------
push.compartment({
  id: "output", label: "Output",
  pages: [{ label: "Output", keys: ["gain", "pan", "sat", "eq1", "eq2", "eq3", "eq4", "eq5"] }],
  screen: function (g, v) {
    var t = v.$touched || "", i;
    bandGround(g, "b-out", [[4, "LEVEL AND PAN", GOLD], [244, "SATURATE", GOLD], [364, "EQ", GOLD]]);
    // level (a bar from -60 to +6 dB) and pan (where it stands between the sides)
    var gn = raw(v, "gain", 0), gh = t === "gain", px = raw(v, "pan", 0) / 100, ph = t === "pan";
    g.fill(14, 22, 8, 60, DARK);
    var lv = clamp((gn + 60) / 66, 0, 1);
    g.fill(14, 82 - 60 * lv, 8, 60 * lv, gh ? "slot" : GOLD);
    g.fill(10, 82 - 60 * (60 / 66), 16, 1, INK); // 0 dB
    g.text(30, 30, val(v, "gain").join(" "), gh ? "slot" : INK, -1);
    g.fill(130, 52, 100, 2, DARK);
    g.fill(180, 46, 1, 14, RULE);
    g.dot(180 + 50 * clamp(px, -1, 1), 53, ph ? 5 : 4, ph ? "slot" : GOLD);
    g.text(130, 72, "L", DIM, -1); g.text(230, 72, "R", DIM, 1);
    // the urchin waveshaper at 0.75 x Sat, its input -1..1 against what comes out
    var s = raw(v, "sat", 0) / 100 * 0.75, sh = t === "sat", cx = 300, cy = 50, r = 30;
    g.fill(cx - r, cy, 2 * r, 1, RULE); g.fill(cx, cy - r, 1, 2 * r, RULE);
    var sp = cached("urchin|" + s.toFixed(3), function () {
      var p = [];
      for (var j = 0; j <= 40; j++) { var xx = -1 + j / 20; p.push(cx + xx * r, cy - urchin(xx, s) * r); }
      return p;
    });
    g.poly([cx - r, cy + r, cx + r, cy - r], 1, FAINT);
    g.poly(sp, 2, sh ? "slot" : GOLD);
    // the EQ: its response, each band's handle over its knob
    var x0 = 372, x1 = 944, mid = 44, half = 26;
    for (var db = -12; db <= 12; db += 6) g.fill(x0, mid - db / 12 * half, x1 - x0, 1, db === 0 ? RULE : FAINT);
    var hotEq = /^eq/.test(t);
    g.poly(eqCurve(v, x0, x1, mid, half), 2, hotEq ? "slot" : GOLD);
    for (i = 0; i < 5; i++) {
      var k = "eq" + (i + 1), bx = eqX(EQ_HZ[i], x0, x1), by = mid - clamp(raw(v, k, 0), -12, 12) / 12 * half;
      var kx = 360 + 60 + 120 * i, hot = t === k;
      g.line(bx, by, kx, 84, 1, hot ? "slot" : RULE);
      g.dot(bx, by, hot ? 4 : 3, hot ? "slot" : INK);
    }
  }
});
