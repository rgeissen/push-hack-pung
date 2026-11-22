// Denis (a monophonic West Coast voice after the Serge modular) on Push.
// An overlay shipped with Pung (Denis itself ships no push_ui.js).
//
// A Serge is a wall of small modules on a dark blue panel, patched with
// banana cables. Denis is such a patch, fixed: a complex oscillator and a
// timbral oscillator, a mix with noise, the triple wave multiplier, a
// variable-Q filter, an envelope into the VCA, and the dual-slope generator
// (a smooth and a stepped output). What moves what is a 4 x 8 matrix: four
// sources (envelope, smooth, stepped, noise) into eight destinations, each
// bipolar. On a Serge that matrix would be cables, and here it is drawn as
// cables. Everything below is computed from Denis's own DSP code (the
// morph, the partials, the three fold stages, the filter): the pictures are
// the instrument's, not a likeness.
//
//   DENIS        (front panel) the whole patch at a glance, module by module,
//                left to right as the signal flows; every matrix cell that is
//                not zero a cable from its source's jack to its destination's
//                (as thick as its amount; an inverted one ends in a ring).
//                CV is drawn in its source's colour, audio in cream.
//   OSCILLATORS  the complex oscillator's morph (sine, triangle, saw, pulse),
//                the timbral oscillator's partials, and what the two and the
//                noise make together: the signal into the wave multiplier
//   FOLD & VCF   the three fold stages as they engage, the signal before and
//                after folding, the filter's response, and what leaves the
//                filter on a C3
//   ENVELOPE     Pung's envelope (with Denis's own stage times) and the glide
//   SOURCES      the four modulation sources as they are, and where each is
//                patched
//   MATRIX       the 4 x 8 patch: a row a source, a column a destination over
//                its encoder; the page's row is the one the encoders turn
//
// The native layer owns every encoder and draws each key's name and value
// under a band screen.

var TAU = Math.PI * 2;
function known(v, k) { return !!(v[k] && v[k].known); }
function frac(v, k, d) { return known(v, k) ? v[k].frac : (d || 0); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function num(v, k, d) { var n = known(v, k) ? parseFloat(v[k].value) : NaN; return isNaN(n) ? d : n; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function up(s) { return String(s).toUpperCase(); }

// ---- the panel's colours ------------------------------------------------------------
var PANEL = "#132c58", DEEP = "#0b1c3c", RULE = "#081430", SCOPE = "#050a16", SCOPE_EDGE = "#2a4377";
var INK = "#eef2f8", INK_DIM = "#a3b4d4", INK_FAINT = "#566c97";
var METAL = "#aeb8c8", HOLE = "#03060d", KNOB = "#090c12", KNOB_RIM = "#2f4673";
var TRACE = "#f4ead2", TRACE_DIM = "#4c6390";
// the four sources, as the cables' colours: what a source draws is in its colour
var SRC = [
  { name: "ENV", long: "ENVELOPE", c: "#f7c548", dk: "#a08436" },
  { name: "LFO", long: "SMOOTH", c: "#ef5a54", dk: "#9c4044" },
  { name: "S&H", long: "STEPPED", c: "#5fd07a", dk: "#3f8a55" },
  { name: "NZ", long: "NOISE", c: "#b994ff", dk: "#7a66b0" }
];
var DEST = ["PITCH 1", "TIMBRE", "PITCH 2", "HARM", "FOLD", "F.TYPE", "CUTOFF", "LEVEL"];
function mkey(r, c) { return "mat_" + r + "_" + c; }
function mat(v, r, c) { return clamp(num(v, mkey(r, c), 0), -1, 1); }
var MAT_KEYS = [];
for (var mr = 0; mr < 4; mr++) for (var mc = 0; mc < 8; mc++) MAT_KEYS.push(mkey(mr, mc));

// ---- the DSP, as Denis computes it (denis.c) ----------------------------------------
// a sine from a table (built once, when the screen loads): a curve costs no trigonometry
var SIN = [];
for (var si = 0; si <= 1024; si++) SIN.push(Math.sin(si / 1024 * TAU));
function fsin(p) { p -= Math.floor(p); var i = p * 1024, j = Math.floor(i); return SIN[j] + (SIN[j + 1] - SIN[j]) * (i - j); }
// the complex oscillator: sine > triangle > saw > pulse, morphed by timbre
function complexOsc(p, t) {
  p -= Math.floor(p);
  var sine = fsin(p);
  var tri = p < 0.25 ? p * 4 : (p < 0.75 ? 2 - p * 4 : p * 4 - 4);
  var saw = 2 * p - 1, pulse = p < 0.5 ? 1 : -1, o;
  if (t < 0.33) { var b = t / 0.33; o = sine * (1 - b) + tri * b; }
  else if (t < 0.67) { var b2 = (t - 0.33) / 0.34; o = tri * (1 - b2) + saw * b2; }
  else { var b3 = (t - 0.67) / 0.33; o = saw * (1 - b3) + pulse * b3; }
  return o * 0.8;
}
// the timbral oscillator: its partials (harmonic number, amplitude) at harmonics h
function ntoPartials(h) {
  if (h < 0.33) { var b = h / 0.33; return [[1, 1], [3, b * 0.1], [5, b * 0.03]]; }
  if (h < 0.67) { var b2 = (h - 0.33) / 0.34; return [[1, 1], [3, 0.1], [5, 0.03], [2, b2 * 0.125], [4, b2 * 0.0375], [6, b2 * 0.0167]]; }
  var b3 = (h - 0.67) / 0.33;
  return [[1, 1], [2, 0.15], [4, 0.05], [6, 0.025], [8, b3 * 0.0125]];
}
// one cycle of each oscillator as a table (128 steps, from the sine table without
// interpolation), kept per setting: a curve then costs a lookup a point
var TN = 128;
function cpxTab(t) {
  t = Math.round(clamp(t, 0, 1) * 100) / 100;
  return cached("ct|" + t, function () {
    var o = [];
    for (var i = 0; i < TN; i++) {
      var p = i / TN, sine = SIN[i * 8], tri = p < 0.25 ? p * 4 : (p < 0.75 ? 2 - p * 4 : p * 4 - 4), saw = 2 * p - 1, pulse = p < 0.5 ? 1 : -1, r;
      if (t < 0.33) { var b = t / 0.33; r = sine * (1 - b) + tri * b; }
      else if (t < 0.67) { var b2 = (t - 0.33) / 0.34; r = tri * (1 - b2) + saw * b2; }
      else { var b3 = (t - 0.67) / 0.33; r = saw * (1 - b3) + pulse * b3; }
      o.push(r * 0.8);
    }
    return o;
  });
}
function ntoTab(h) {
  h = Math.round(clamp(h, 0, 1) * 100) / 100;
  return cached("nt|" + h, function () {
    var parts = ntoPartials(h), o = [];
    for (var i = 0; i < TN; i++) {
      var s = 0;
      for (var j = 0; j < parts.length; j++) s += parts[j][1] * SIN[(i * 8 * parts[j][0]) & 1023];
      o.push(s * 0.8);
    }
    return o;
  });
}
function tab(tb, ph) { return tb[Math.floor(ph * TN) & (TN - 1)]; }
function nto(p, parts) {
  var s = 0;
  for (var i = 0; i < parts.length; i++) s += parts[i][1] * fsin(parts[i][0] * p);
  return s * 0.8;
}
// the wave multiplier: three cascaded stages, the odd and even paths balanced by type
function foldUpper(x) { var x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function foldMiddle(x) {
  var s = x >= 0 ? 1 : -1, a = Math.abs(x), t;
  if (a < 0.7) return x;
  if (a < 1.0) { t = (a - 0.7) / 0.3; return s * (0.7 + 0.3 * (1 - t * t)); }
  if (a < 1.5) { t = (a - 1.0) / 0.5; return s * (1 - 0.6 * fsin(t / 4)); }
  if (a < 2.2) { t = (a - 1.5) / 0.7; return s * (0.4 + 0.5 * fsin(t / 4)); }
  if (a < 3.0) { t = (a - 2.2) / 0.8; return s * (0.9 - 0.4 * t); }
  return s * (0.5 + 0.3 / (1 + (a - 3)));
}
function foldLower(x) {
  var r = Math.abs(x);
  if (r > 1) { var ph = r * 0.25 + 0.25; ph -= Math.floor(ph); r = Math.abs(4 * Math.abs(ph - 0.5) - 1); }
  return (r - 0.5) * 2;
}
function stages(depth) { return [depth >= 0.001, depth > 0.15, depth > 0.4]; }
function fold(x, depth, type) {
  if (depth < 0.001) return x;
  var s1 = foldUpper(x * (1 + depth * 4));
  var d2 = clamp((depth - 0.15) * 1.5, 0, 1);
  var s2 = s1 * (1 - d2) + foldMiddle(s1 * (1 + d2 * 3)) * d2;
  var d3 = clamp((depth - 0.4) * 1.8, 0, 1);
  var s3 = s2 * (1 - d3) + foldLower(s2 * (1 + d3 * 2.5)) * d3;
  var ow = type < 0.5 ? 1 : 2 * (1 - type), ew = type < 0.5 ? type * 2 : 1;
  var o = (s2 * ow * 0.5 + s3 * ew * 0.5) / (ow * 0.5 + ew * 0.5 + 0.001);
  return foldUpper(o);
}
// cutoff knob to Hz, as the filter has it
function cutoffHz(c) { return 30 * Math.pow(20000 / 30, c * c); }
// where that stands on Pung's axis (20 Hz to 20 kHz, logarithmic): the knob is squared
function cutAt(v) { return clamp(Math.log(cutoffHz(clamp(num(v, "filter_cutoff", 1), 0, 1)) / 20) / Math.log(1000), 0, 1); }
// a fixed noise, so the picture holds still: white, pink (smoother), brown (a wander)
function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
var NOISE = {};
function noiseAt(type, i) {
  var tb = NOISE[type];
  if (!tb) {
    tb = NOISE[type] = [];
    var n = type === "Brown" ? 24 : (type === "White" ? 1 : 5), raw = [];
    for (var j = 0; j < 256 + n; j++) raw.push(rnd(j));
    for (var q = 0; q < 256; q++) {
      var a = 0;
      for (var r = 0; r < n; r++) a += raw[q + r];
      tb.push(type === "White" ? a * 0.66 : a / n * (type === "Brown" ? 2.4 : 1.6));
    }
  }
  return tb[i & 255];
}
// what the oscillators and noise put into the wave multiplier, over a cycle of osc 1
function mixFn(v) {
  var ct = cpxTab(num(v, "osc1_timbre", 0.5)), ntb = ntoTab(num(v, "osc2_harmonics", 0.5));
  var detune = (clamp(num(v, "osc1_freq", 0.5), 0, 1) - 0.5) * 2, ratio = Math.pow(2, num(v, "osc2_pitch", 0) - detune);
  var mix = clamp(num(v, "osc_mix", 0.5), 0, 1), nm = clamp(num(v, "noise_mix", 0), 0, 1) * 0.5, nt = txt(v, "noise_type");
  return function (ph, i) {
    var o = tab(ct, ph) * (1 - mix) + tab(ntb, ph * ratio) * mix;
    return nm > 0 ? o * (1 - nm) + noiseAt(nt, i) * nm : o;
  };
}
function sigOf(v, keys) {
  var s = [];
  for (var i = 0; i < keys.length; i++) s.push(known(v, keys[i]) ? String(v[keys[i]].value) : "-");
  return s.join("|");
}
var MIX_KEYS = ["osc1_timbre", "osc2_harmonics", "osc1_freq", "osc2_pitch", "osc_mix", "noise_mix", "noise_type"];

// ---- curves, computed when what they show changes -----------------------------------
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 96) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
// samples (-1..1 after scale) to a polyline; a jump is drawn straight up or down
function pts(x, y, w, h, ys, scale) {
  var out = [], mid = y + h / 2, a = h / 2 - 1.5, n = ys.length, prev = null;
  for (var i = 0; i < n; i++) {
    var yy = mid - clamp(ys[i] * scale, -1, 1) * a, xx = x + w * i / (n - 1);
    if (prev !== null && Math.abs(yy - prev) > a * 0.6) out.push(xx, prev);
    out.push(xx, yy);
    prev = yy;
  }
  return out;
}
function sample(fn, n, cycles) {
  var ys = [];
  for (var i = 0; i < n; i++) ys.push(fn(i / (n - 1) * cycles, i));
  return ys;
}
function peak(ys) { var m = 0.001; for (var i = 0; i < ys.length; i++) m = Math.max(m, Math.abs(ys[i])); return m; }
// the signal before and after the wave multiplier (scaled together)
function foldCurves(v, x, y, w, h, n) {
  var key = "fold|" + [x, y, w, h, n].join(",") + "|" + sigOf(v, MIX_KEYS.concat(["fold_depth", "fold_type"]));
  return cached(key, function () {
    var f = mixFn(v), d = clamp(num(v, "fold_depth", 0), 0, 1), ty = clamp(num(v, "fold_type", 0.5), 0, 1);
    var inp = sample(f, n, 2), out = [];
    for (var i = 0; i < n; i++) out.push(fold(inp[i], d, ty));
    var s = 1 / Math.max(peak(inp), peak(out));
    return { inp: pts(x, y, w, h, inp, s), out: pts(x, y, w, h, out, s), outY: out };
  });
}

// ---- drawing parts --------------------------------------------------------------------
function box(g, x, y, w, h, c) { g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c); g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c); }
function scope(g, x, y, w, h) { g.fill(x, y, w, h, SCOPE); box(g, x, y, w, h, SCOPE_EDGE); }
// a banana jack: the nut and its hole; an output's legend is printed inverted
function jack(g, x, y) { g.dot(x, y, 5.5, METAL); g.dot(x, y, 4, "#6f7a8c"); g.dot(x, y, 2.6, HOLE); }
function legend(g, x, y, s, out) {
  if (out) { var w = g.measure(s) + 6; g.fill(x - w / 2, y - 8, w, 10, INK_DIM); g.text(x, y, s, PANEL, 0); }
  else g.text(x, y, s, INK_DIM, 0);
}
// a plug in a jack (a cable's end): filled, or a ring where the cable is inverted
function plug(g, x, y, c, inv) {
  g.dot(x, y, 5.5, c);
  g.dot(x, y, inv ? 3.2 : 1.6, inv ? HOLE : "#ffffff");
}
// morph positions along a strip: the names where they are pure, a mark where the knob is
function strip(g, x, w, y, names, at, f, hot, ok) {
  g.fill(x, y + 3, w, 1, INK_FAINT);
  for (var i = 0; i < names.length; i++) {
    var px = x + w * at[i];
    g.fill(px, y + 1, 1, 5, INK_FAINT);
    g.text(px, y - 2, names[i], INK_DIM, i === 0 ? -1 : (i === names.length - 1 ? 1 : 0));
  }
  if (ok) g.fill(x + w * f - 2, y, 5, 8, hot ? "slot" : TRACE);
}

// ---- value formats: in the instrument's units (denis.c) -----------------------------
function secs(s) { return s < 1 ? [String(Math.round(s * 1000)), "MS"] : [s.toFixed(2), "S"]; }
function hz(f) { return f >= 1000 ? [(f / 1000).toFixed(f >= 10000 ? 1 : 2) + "K", "HZ"] : [f >= 100 ? String(Math.round(f)) : f.toFixed(f >= 10 ? 1 : 2), "HZ"]; }
function pct(x) { return [String(Math.round(x * 100)), "%"]; }
function sgn(x, d) { var s = x.toFixed(d); return (x > 0 && parseFloat(s) !== 0 ? "+" : "") + s; }
function fmt(v, k) {
  if (!known(v, k)) return ["--", ""];
  var x = parseFloat(v[k].value);
  if (k.indexOf("mat_") === 0) return [sgn(Math.round(x * 100), 0), "%"];
  switch (k) {
  case "osc1_freq": return [sgn((x - 0.5) * 24, 1), "ST"];
  case "osc2_pitch": return [sgn(x, 2), "OCT"];
  case "filter_cutoff": return hz(cutoffHz(x));
  case "filter_q": return [x.toFixed(2), ""];
  case "attack": case "decay": case "release": return secs(x);
  case "portamento": return x < 0.001 ? ["OFF", ""] : secs(x);
  case "lfo_rate": case "sh_rate": return hz(x);
  case "osc1_timbre": case "osc2_harmonics": case "osc_mix": case "noise_mix": case "fold_depth": case "fold_type":
  case "sustain": case "vel_to_filter": case "mod_depth_env": case "mod_depth_noise": return pct(x);
  }
  return [txt(v, k), String(v[k].unit || "")];
}
// Pung writes the same units wherever it shows a value (its pages, the row under a screen)
var UNITS = { MS: "ms", S: "s", HZ: "Hz", ST: "st", OCT: "oct", "%": "%" };
var NUMERIC = { osc1_freq: 1, osc2_pitch: 1, filter_cutoff: 1, filter_q: 1, attack: 1, decay: 1, release: 1, portamento: 1, lfo_rate: 1, sh_rate: 1,
  osc1_timbre: 1, osc2_harmonics: 1, osc_mix: 1, noise_mix: 1, fold_depth: 1, fold_type: 1, sustain: 1, vel_to_filter: 1, mod_depth_env: 1, mod_depth_noise: 1 };
push.display(function (key, r) {
  if (!NUMERIC[key] && key.indexOf("mat_") !== 0) return;
  if (isNaN(parseFloat(r))) return;
  var o = {}; o[key] = { known: true, value: r };
  var f = fmt(o, key), val = f[0], u = UNITS[f[1]] || f[1];
  if (u === "Hz" && /K$/.test(val)) { val = val.slice(0, -1); u = "kHz"; }
  return { value: val, unit: u };
});
var SHORT = { osc1_timbre: "TIMBRE", osc2_harmonics: "HARMONICS", osc_mix: "OSC MIX", fold_depth: "FOLD DEPTH",
  fold_type: "FOLD TYPE", filter_cutoff: "CUTOFF", filter_q: "Q", lfo_rate: "SMOOTH RATE", sh_rate: "STEPPED RATE",
  mod_depth_env: "ENV DEPTH", mod_depth_noise: "NOISE DEPTH", portamento: "GLIDE" };

// ---- the front panel ----------------------------------------------------------------------
// Seven modules, left to right as the signal flows. Each has its scope (a
// picture of what it does) and its jacks: inputs where the matrix can reach
// it, outputs (legend printed inverted) where a source leaves.
var MODS = [
  { id: "cpx", w: 140, title: "COMPLEX OSC" },
  { id: "nto", w: 124, title: "TIMBRAL OSC" },
  { id: "mix", w: 100, title: "MIX" },
  { id: "wm", w: 160, title: "WAVE MULTIPLIER" },
  { id: "vcf", w: 132, title: "VCF" },
  { id: "env", w: 136, title: "ENV > VCA" },
  { id: "gto", w: 136, title: "DUAL SLOPE" }
];
(function () { var x = 4; for (var i = 0; i < MODS.length; i++) { MODS[i].x = x; x += MODS[i].w + 4; } })();
var SY = 36, SH = 28, JY = 83, LY = 74; // scope top and height, jack centre, jack legend baseline
// the jacks: [module, where across it, legend, destination column or -1, source row or -1]
var JACKS = [
  [0, 0.22, "PITCH", 0, -1], [0, 0.75, "TIMBRE", 1, -1],
  [1, 0.24, "PITCH", 2, -1], [1, 0.76, "HARM", 3, -1],
  [2, 0.5, "NZ", -1, 3],
  [3, 0.3, "DEPTH", 4, -1], [3, 0.72, "TYPE", 5, -1],
  [4, 0.5, "FREQ", 6, -1],
  [5, 0.27, "ENV", -1, 0], [5, 0.74, "LEVEL", 7, -1],
  [6, 0.27, "SMOOTH", -1, 1], [6, 0.75, "STEP", -1, 2]
].map(function (j) { var m = MODS[j[0]]; return [Math.round(m.x + m.w * j[1]), j[2], j[3], j[4]]; });
function jackOf(dest, src) {
  for (var i = 0; i < JACKS.length; i++) if ((dest >= 0 && JACKS[i][2] === dest) || (src >= 0 && JACKS[i][3] === src)) return JACKS[i][0];
  return 0;
}
function panelGround(g) {
  g.fill(0, 0, 960, 160, PANEL);
  // the name plate
  g.value(10, 17, "DENIS", INK, -1);
  g.text(16 + g.measure("DENIS", "value"), 16, "WEST COAST MONO", INK_DIM, -1);
  for (var i = 0; i < MODS.length; i++) {
    var m = MODS[i];
    if (i) g.fill(m.x - 3, 20, 2, 82, RULE);
    g.fill(m.x, 21, m.w, 12, DEEP);
    g.text(m.x + 5, 31, m.title, INK, -1);
    scope(g, m.x + 4, SY, m.w - 8, SH);
  }
  g.fill(0, 20, 960, 1, RULE);
  for (var j = 0; j < JACKS.length; j++) {
    legend(g, JACKS[j][0], LY, JACKS[j][1], JACKS[j][3] >= 0);
    jack(g, JACKS[j][0], JY);
  }
  // the encoder row: eight knobs under a rule
  g.fill(0, 102, 960, 2, RULE);
  g.fill(0, 104, 960, 56, DEEP);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 108, 1, 32, PANEL);
}
function panelModules(g, v) {
  var t = v.$touched || "";
  function hot(k) { return t === k; }
  // complex oscillator: its wave as the morph has it
  var tb = clamp(num(v, "osc1_timbre", 0.5), 0, 1);
  var m = MODS[0];
  if (known(v, "osc1_timbre")) g.poly(cached("p-cpx|" + tb, function () {
    return pts(m.x + 8, SY + 2, m.w - 16, SH - 4, sample(function (p) { return tab(cpxTab(tb), p); }, 90, 2), 1.15);
  }), 2, hot("osc1_timbre") ? "slot" : TRACE);
  // timbral oscillator: its wave from its partials
  var hm = clamp(num(v, "osc2_harmonics", 0.5), 0, 1);
  m = MODS[1];
  if (known(v, "osc2_harmonics")) g.poly(cached("p-nto|" + hm, function () {
    var nt = ntoTab(hm), ys = sample(function (p) { return tab(nt, p); }, 90, 2);
    return pts(m.x + 8, SY + 2, m.w - 16, SH - 4, ys, 0.98 / peak(ys));
  }), 2, hot("osc2_harmonics") ? "slot" : TRACE);
  // mix: how much of each goes on, a bar each
  m = MODS[2];
  var mx = clamp(num(v, "osc_mix", 0.5), 0, 1), nm = clamp(num(v, "noise_mix", 0), 0, 1);
  var lv = [[1 - mx, "CPX", "osc_mix"], [mx, "TMB", "osc_mix"], [nm * 0.5, "NZ", "noise_mix"]];
  for (var b = 0; b < 3; b++) {
    var cx = m.x + 20 + b * 30, bh = Math.round(lv[b][0] * 17), on = known(v, lv[b][2]);
    if (on && bh) g.fill(cx - 5, 54 - bh, 10, bh, hot(lv[b][2]) || (b === 2 && hot("noise_type")) ? "slot" : TRACE);
    g.text(cx, 62, lv[b][1], on && bh ? INK_DIM : INK_FAINT, 0);
  }
  // wave multiplier: in (dim) and out, the stages that are folding
  m = MODS[3];
  var d = clamp(num(v, "fold_depth", 0), 0, 1), st = stages(d);
  for (var s = 0; s < 3; s++) {
    var lx = m.x + m.w - 32 + s * 11;
    g.dot(lx, 27, 3, st[s] ? "#ff5a4a" : "#2c3b5e");
  }
  if (known(v, "fold_depth")) {
    var fc = foldCurves(v, m.x + 7, SY + 2, m.w - 14, SH - 4, 64);
    if (d >= 0.001) g.poly(fc.inp, 1, TRACE_DIM);
    g.poly(fc.out, 2, hot("fold_depth") || hot("fold_type") ? "slot" : TRACE);
  }
  // the filter
  m = MODS[4];
  var ft = txt(v, "filter_type");
  g.text(m.x + m.w - 5, 31, { Lowpass: "LP", Bandpass: "BP", Highpass: "HP", Notch: "NOTCH" }[ft] || up(ft), INK_DIM, 1);
  g.filter(m.x + 5, SY + 1, m.w - 10, SH - 2, { cutoff: "filter_cutoff", at: cutAt(v), resonance: "filter_q", type: "filter_type", color: TRACE });
  // the envelope, into the VCA (and out as a source: its colour)
  m = MODS[5];
  g.envelope(m.x + 5, SY + 1, m.w - 10, SH - 2, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", color: SRC[0].c });
  // the dual-slope generator: smooth (a triangle) and stepped (S&H)
  m = MODS[6];
  var hw = (m.w - 8) / 2;
  g.lfo(m.x + 4, SY + 1, hw - 1, SH - 2, { shape: "Triangle", rate: rateOf(v, "lfo_rate"), trig: false, color: SRC[1].c });
  g.lfo(m.x + 4 + hw + 1, SY + 1, hw - 1, SH - 2, { shape: "S&H", rate: rateOf(v, "sh_rate"), trig: false, color: SRC[2].c });
  g.fill(m.x + 4 + hw, SY + 1, 1, SH - 2, SCOPE_EDGE);
}
// a rate in Hz (0.01 .. 500) as the picture's cycles (1 to 5)
function rateFrac(h) { return clamp((Math.log(Math.max(0.01, h)) / Math.LN10 + 2) / 4.7, 0, 1); }
// as the picture's rate: a number (cycles on a log scale), or the key while it is unknown (a neutral shape)
function rateOf(v, k) { return known(v, k) ? rateFrac(num(v, k, 1)) : k; }
// the cables: every cell of the matrix that is not zero, from its source's
// jack to its destination's, hanging under the jacks. A randomized matrix
// patches all 32: then the strongest are drawn, and the name plate says how
// many there are (the Matrix pages show every one).
var MAX_CABLES = 12;
function cables(g, v) {
  var t = v.$touched || "", list = [];
  for (var r = 0; r < 4; r++) for (var c = 0; c < 8; c++) {
    var a = mat(v, r, c);
    if (Math.abs(a) >= 0.005) list.push([Math.abs(a), r, c, a < 0]);
  }
  list.sort(function (p, q) { return q[0] - p[0]; });
  var all = list.length;
  list = list.slice(0, MAX_CABLES).reverse(); // the strongest, drawn last
  g.text(26 + g.measure("DENIS", "value") + g.measure("WEST COAST MONO"), 16,
    all === 0 ? "NOT PATCHED" : (all > MAX_CABLES ? "STRONGEST " + MAX_CABLES + " OF " + all + " CABLES" : all + (all === 1 ? " CABLE" : " CABLES")), INK_FAINT, -1);
  var plugs = {};
  for (var i = 0; i < list.length; i++) {
    var e = list[i], sx = jackOf(-1, e[1]), dx = jackOf(e[2], -1), hot = t === mkey(e[1], e[2]);
    var col = hot ? "slot" : SRC[e[1]].c, span = Math.abs(dx - sx), sag = Math.min(17, 4 + span * 0.022);
    var p = [], n = Math.max(4, Math.round(span / 8));
    for (var k = 0; k <= n; k++) { var q = k / n; p.push(sx + (dx - sx) * q, JY + 4 * sag * q * (1 - q)); }
    g.poly(p, 1.6 + e[0] * 1.6, col);
    plugs[sx] = [col, false];
    plugs[dx] = [col, e[3]];
  }
  for (var x in plugs) plug(g, +x, JY, plugs[x][0], plugs[x][1]);
}
// the header's right: the sound, how it plays, the page
function header(g, v) {
  var ps = v.$pages || [], x = 950;
  if (ps.length > 1) {
    var pg = up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length;
    g.text(x, 15, pg, INK_DIM, 1);
    x -= g.measure(pg) + 18;
  }
  var flags = [];
  if (num(v, "portamento", 0) >= 0.001) flags.push("GLIDE " + fmt(v, "portamento").join(" "));
  if (txt(v, "legato") === "On") flags.push("LEGATO");
  if (known(v, "patch_mode")) flags.push("PADS " + up(txt(v, "patch_mode")));
  var fl = flags.join("   ");
  g.text(x, 15, fl, INK_DIM, 1);
  x -= g.measure(fl) + (fl ? 18 : 0);
  var nm = txt(v, "preset");
  g.value(x, 17, nm, INK, 1, x - 260);
}
// the encoder row: a Serge knob (black, a white line), the legend over it,
// the value beside it and its unit under the value
function row(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  // in segment mode Pung names the segments in the bottom 18 pixels: the row ends above them
  var seg = !!v.$segmode, KR = seg ? 10 : 13, NY = seg ? 114 : 117;
  for (var i = 0; i < 8; i++) {
    var k = kn[i];
    if (!k || !v[k]) continue;
    var hot = k === t, x0 = i * 120, kx = x0 + 30, ky = seg ? 129 : 140, ok = known(v, k);
    g.dot(kx, ky, KR + 2, hot ? "slot" : KNOB_RIM); g.dot(kx, ky, KR, KNOB);
    if (!seg) { g.dot(kx - 12.7, ky + 12.7, 1.3, INK_FAINT); g.dot(kx + 12.7, ky + 12.7, 1.3, INK_FAINT); }
    var name = SHORT[k] || up(v[k].name || k);
    if (k.indexOf("mat_") === 0) name = SRC[+k.charAt(4)].name + " > " + DEST[+k.charAt(6)];
    g.text(x0 + 60, NY, name, hot ? "slot" : INK, 0, 112);
    if (ok) {
      var f = clamp(v[k].frac, 0, 1), a = Math.PI * (0.75 + 1.5 * f);
      g.line(kx + Math.cos(a) * 3, ky + Math.sin(a) * 3, kx + Math.cos(a) * (KR - 1), ky + Math.sin(a) * (KR - 1), 2.5, hot ? "slot" : INK);
    }
    var fv = fmt(v, k);
    if (seg) {
      // the value and its unit on one line, beside the knob
      var uw = fv[1] ? g.measure(fv[1]) + 3 : 0, vw = Math.min(g.measure(fv[0], "value"), 70 - uw), vx = x0 + 84 - (vw + uw) / 2;
      g.value(vx, 136, fv[0], hot ? "slot" : INK, -1, 70 - uw);
      if (fv[1]) g.text(vx + vw + 3, 136, fv[1], INK_DIM, -1);
      continue;
    }
    g.value(x0 + 84, 146, fv[0], hot ? "slot" : INK, 0, 64);
    if (fv[1]) g.text(x0 + 84, 157, fv[1], INK_DIM, 0);
  }
}
// The panel's modules as segments: the hands go to one module's knobs. The
// module under them has its legend strip lit, as a Serge's lit section (Pung's
// bar stands just above it).
var SEGS = [
  { id: "cpx", label: "Complex Osc", keys: ["osc1_freq", "osc1_timbre", "portamento", "legato"] },
  { id: "nto", label: "Timbral Osc", keys: ["osc2_pitch", "osc2_harmonics"] },
  { id: "mix", label: "Mix", keys: ["osc_mix", "noise_mix", "noise_type"] },
  { id: "wm", label: "Wave Mult", keys: ["fold_depth", "fold_type"] },
  { id: "vcf", label: "VCF", keys: ["filter_cutoff", "filter_q", "filter_type", "vel_to_filter"] },
  { id: "env", label: "Env > VCA", keys: ["attack", "decay", "sustain", "release", "mod_depth_env"] },
  { id: "gto", label: "Dual Slope", keys: ["lfo_rate", "sh_rate", "mod_depth_noise"] }
];
// (a pixel into the strip: Pung's bar above it clears the header's text)
for (var sgi = 0; sgi < SEGS.length; sgi++) SEGS[sgi].rect = [MODS[sgi].x, 22, MODS[sgi].w, 80];
function segMark(g, v) {
  if (v.$segmode !== "segment") return;
  for (var i = 0; i < SEGS.length; i++) {
    if (SEGS[i].id !== v.$segment) continue;
    var m = MODS[i];
    g.fill(m.x, 21, m.w, 12, "slot");
    g.text(m.x + 5, 31, m.title, PANEL, -1);
  }
}
var PANEL_KEYS = ["osc1_freq", "osc1_timbre", "osc2_pitch", "osc2_harmonics", "osc_mix", "noise_mix", "noise_type",
  "fold_depth", "fold_type", "filter_cutoff", "filter_q", "filter_type", "attack", "decay", "sustain", "release",
  "lfo_rate", "sh_rate", "mod_depth_env", "mod_depth_noise", "portamento", "legato", "patch_mode", "preset"];
// Pung's default pages in the Easel's navy, its black knobs and cream traces
push.theme({ ground: PANEL, panel: KNOB, ink: INK, dim: INK_DIM, rule: KNOB_RIM, faint: DEEP, accent: TRACE, knob: "pointer" });
push.compartment({
  id: "panel", label: "Denis", front_panel: true,
  pages: [
    { label: "Timbre", keys: ["osc1_timbre", "osc2_harmonics", "osc_mix", "fold_depth", "fold_type", "filter_cutoff", "filter_q", "decay"] },
    { label: "Motion", keys: ["attack", "sustain", "release", "lfo_rate", "sh_rate", "mod_depth_env", "mod_depth_noise", "portamento"] }
  ],
  segments: SEGS, draws_segments: true,
  extra_keys: PANEL_KEYS.concat(MAT_KEYS).concat(["vel_to_filter"]),
  screen: function (g, v) {
    // the ground and the cables are kept: the matrix changes on its own pages, not here
    g.layer("denis-panel|" + sigOf(v, MAT_KEYS), function () { panelGround(g); cables(g, v); });
    header(g, v);
    segMark(g, v);
    panelModules(g, v);
    row(g, v);
  }
});

// ---- band screens: the same panel, a module at a time ---------------------------------------
function band(g) { g.fill(0, 0, g.w, g.h, PANEL); }
function title(g, x, s, lit) { g.text(x, 11, s, lit ? "slot" : INK, -1); }

// OSCILLATORS: the morph, the partials, the mix
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [{ label: "Oscillators", keys: ["osc1_freq", "osc1_timbre", "osc2_pitch", "osc2_harmonics", "osc_mix", "noise_mix", "noise_type"] }],
  screen: function (g, v) {
    var t = v.$touched || "";
    g.layer("denis-osc", function () {
      band(g);
      scope(g, 4, 30, 228, 54); scope(g, 244, 30, 120, 54); scope(g, 368, 30, 104, 54); scope(g, 484, 30, 464, 54);
      g.fill(238, 4, 1, 80, RULE); g.fill(478, 4, 1, 80, RULE);
      // the timbral oscillator's partial axis
      for (var h = 1; h <= 8; h++) g.text(368 + 7 + (h - 1) * 12.4 + 3, 82, String(h), INK_FAINT, 0);
    });
    // complex oscillator
    var tb = clamp(num(v, "osc1_timbre", 0.5), 0, 1);
    title(g, 8, "COMPLEX OSC", t === "osc1_freq" || t === "osc1_timbre");
    g.text(232, 11, known(v, "osc1_freq") ? "DETUNE " + fmt(v, "osc1_freq").join(" ") : "", t === "osc1_freq" ? "slot" : INK_DIM, 1);
    strip(g, 10, 216, 22, ["SINE", "TRI", "SAW", "PULSE"], [0, 0.33, 0.67, 1], tb, t === "osc1_timbre", known(v, "osc1_timbre"));
    if (known(v, "osc1_timbre")) g.poly(cached("o-cpx|" + tb, function () {
      return pts(10, 33, 216, 48, sample(function (p) { return tab(cpxTab(tb), p); }, 80, 2), 1.15);
    }), 2, t === "osc1_timbre" ? "slot" : TRACE);
    // timbral oscillator: its wave, its partials
    var hm = clamp(num(v, "osc2_harmonics", 0.5), 0, 1), parts = ntoPartials(hm);
    title(g, 248, "TIMBRAL OSC", t === "osc2_pitch" || t === "osc2_harmonics");
    g.text(472, 11, known(v, "osc2_pitch") ? fmt(v, "osc2_pitch").join(" ") : "", t === "osc2_pitch" ? "slot" : INK_DIM, 1);
    strip(g, 250, 216, 22, ["ODD", "ODD+EVEN", "EVEN"], [0, 0.5, 1], hm, t === "osc2_harmonics", known(v, "osc2_harmonics"));
    if (known(v, "osc2_harmonics")) {
      g.poly(cached("o-nto|" + hm, function () {
        var nt = ntoTab(hm), ys = sample(function (p) { return tab(nt, p); }, 80, 2);
        return pts(248, 33, 112, 48, ys, 0.98 / peak(ys));
      }), 2, t === "osc2_harmonics" ? "slot" : TRACE);
      // partials: as loud as Denis makes them, on a scale of decibels (60 dB)
      for (var i = 0; i < parts.length; i++) {
        var a = parts[i][1];
        if (a <= 0.0005) continue;
        var db = clamp(1 + Math.log(a) / Math.LN10 / 3, 0.04, 1), bh = Math.round(db * 40);
        g.fill(368 + 7 + (parts[i][0] - 1) * 12.4, 73 - bh, 6, bh, t === "osc2_harmonics" ? "slot" : (parts[i][0] % 2 ? TRACE : "#9fd0ff"));
      }
    }
    // the mix: what goes into the wave multiplier
    var mx = clamp(num(v, "osc_mix", 0.5), 0, 1), nm = clamp(num(v, "noise_mix", 0), 0, 1);
    title(g, 488, "MIX", t === "osc_mix" || t === "noise_mix" || t === "noise_type");
    var say = "COMPLEX " + Math.round((1 - mx) * 100) + "%   TIMBRAL " + Math.round(mx * 100) + "%   " +
      (nm > 0.005 ? up(txt(v, "noise_type")) + " NOISE " + Math.round(nm * 100) + "%" : "NO NOISE");
    g.text(948, 11, say, INK_DIM, 1, 400);
    var ys = cached("o-mix|" + sigOf(v, MIX_KEYS), function () { return sample(mixFn(v), 100, 3); });
    g.poly(cached("o-mixp|" + sigOf(v, MIX_KEYS), function () { return pts(490, 33, 452, 48, ys, 1 / peak(ys)); }),
      2, t === "osc_mix" || t === "noise_mix" || t === "noise_type" ? "slot" : TRACE);
  }
});

// FOLD & VCF: the three stages, before and after, the response, what leaves on a C3
function svfOut(v, inY) {
  // the filter (Cytomic SVF, as Denis has it) run on the folded wave at C3 until it settles
  var fc = cutoffHz(clamp(num(v, "filter_cutoff", 1), 0, 1)), q = clamp(num(v, "filter_q", 0), 0, 4), ty = txt(v, "filter_type");
  // run at a quarter of Denis's rate: the harmonics of a C3 that a picture shows lie far below it
  var sr = 11025, f0 = 130.81, per = Math.round(sr / f0), gg = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr);
  var k = Math.max(0.08, 2 - q * 0.475), a1 = 1 / (1 + gg * (gg + k)), a2 = gg * a1, a3 = gg * a2, gc = 1 + q * 0.25;
  var ic1 = 0, ic2 = 0, out = [], n = inY.length / 2; // inY holds two cycles: read one cycle, again and again
  for (var c = 0; c < 6; c++) {
    for (var i = 0; i < per; i++) {
      var ph = i / per, x = inY[Math.min(n - 1, Math.floor(ph * n))];
      var v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      var y = ty === "Bandpass" ? v1 : (ty === "Highpass" ? (x - k * v1 - v2) * gc : (ty === "Notch" ? (x - k * v1) * gc : v2 * gc));
      if (c === 4) out.push(foldUpper(clamp(y, -2, 2)));
    }
  }
  return out;
}
var SHAPE_KEYS = MIX_KEYS.concat(["fold_depth", "fold_type", "filter_cutoff", "filter_q", "filter_type"]);
function foldFilter(g, v) {
  var t = v.$touched || "";
  g.layer("denis-fold", function () {
    band(g);
    scope(g, 4, 30, 228, 54); scope(g, 244, 16, 464, 68); scope(g, 724, 30, 224, 54);
    g.fill(238, 4, 1, 80, RULE); g.fill(716, 4, 1, 80, RULE);
  });
  // the wave multiplier
  var d = clamp(num(v, "fold_depth", 0), 0, 1), ty = clamp(num(v, "fold_type", 0.5), 0, 1), st = stages(d);
  title(g, 8, "WAVE MULTIPLIER", t === "fold_depth" || t === "fold_type");
  // the three stages (saturation, fold, rectified fold), lit as the depth brings each in
  g.text(170, 11, "STAGE", INK_FAINT, 1);
  for (var s = 0; s < 3; s++) {
    var sx = 176 + s * 18;
    g.fill(sx, 2, 14, 11, st[s] ? "#ff5a4a" : DEEP);
    g.text(sx + 7, 11, String(s + 1), st[s] ? PANEL : INK_FAINT, 0);
  }
  strip(g, 10, 216, 25, ["ODD", "EVEN"], [0, 1], ty, t === "fold_type", known(v, "fold_type"));
  if (known(v, "fold_depth")) {
    var fcv = foldCurves(v, 8, 33, 220, 48, 110);
    if (d >= 0.001) g.poly(fcv.inp, 1, TRACE_DIM);
    g.poly(fcv.out, 2, t === "fold_depth" || t === "fold_type" ? "slot" : TRACE);
  }
  // the filter
  title(g, 248, "VCF", t === "filter_cutoff" || t === "filter_q" || t === "filter_type");
  var ft = txt(v, "filter_type"), vel = clamp(num(v, "vel_to_filter", 0), 0, 1);
  g.text(248 + g.measure("VCF") + 10, 11, up(ft) + "   " + fmt(v, "filter_cutoff").join(" ") + "   Q " + fmt(v, "filter_q")[0], INK_DIM, -1);
  g.text(708, 11, vel > 0.005 ? "VELOCITY OPENS IT UP TO +" + hz(vel * 6000).join(" ") : "VELOCITY: NONE",
    t === "vel_to_filter" ? "slot" : (vel > 0.005 ? INK_DIM : INK_FAINT), 1);
  g.filter(246, 18, 460, 64, { cutoff: "filter_cutoff", at: cutAt(v), resonance: "filter_q", type: "filter_type", color: TRACE });
  // what leaves the filter, on a C3
  g.text(728, 11, "OUT ON A C3", INK, -1);
  g.text(948, 11, "FOLDED, FILTERED", INK_FAINT, 1);
  if (!known(v, "filter_cutoff") || !known(v, "fold_depth")) return;
  var key = "svf|" + sigOf(v, SHAPE_KEYS);
  var ys = cached(key, function () { return svfOut(v, foldCurves(v, 8, 33, 220, 48, 110).outY); });
  g.poly(cached(key + "|p", function () {
    var two = ys.concat(ys);
    return pts(728, 33, 216, 48, two, 1 / Math.max(peak(two), 0.25));
  }), 2, TRACE);
}
push.compartment({
  id: "shape", label: "Fold & VCF",
  pages: [{ label: "Fold & VCF", keys: ["fold_depth", "fold_type", "filter_cutoff", "filter_q", "filter_type", "vel_to_filter"], screen: foldFilter }],
  extra_keys: MIX_KEYS
});

// ENVELOPE: Pung's own (Denis's times below), the glide and how notes join
push.compartment({
  id: "env", label: "Envelope",
  pages: [{ label: "Envelope", keys: ["attack", "decay", "sustain", "release", "portamento", "legato"] }]
});
// Denis's envelope (adsr_tick): the attack rises exponentially toward 1.05
// and ends at 0.99 (2.86 times the knob), the decay falls linearly from 1 to
// the sustain in the knob's time, the release falls at a fixed rate: a
// whole step in its knob's time, so from the sustain it takes that fraction.
push.envelopeTimes(function (env) {
  var s = parseFloat(env.value("sustain"));
  if (isNaN(s)) s = 1;
  return env.stages.map(function (st) {
    var r = st.raw === null || st.raw === undefined ? NaN : parseFloat(st.raw);
    if (isNaN(r)) return null;
    if (st.key === "attack") return Math.max(1 / 44100, r * Math.log(1.05 / 0.06));
    if (st.key === "decay") return Math.max(1 / 44100, r);
    if (st.key === "release") return Math.max(1 / 44100, r * Math.max(0.02, s));
    return null;
  });
});

// SOURCES: the four, and where each goes
// the noise source's shape: white noise through a slow lowpass (built once)
var WANDER = (function () {
  var ys = [], a = 0, b = 0, m = 0.001;
  for (var i = 0; i < 600; i++) { a += 0.03 * (rnd(i) - a); b += 0.03 * (a - b); if (i % 6 === 0) ys.push(b); }
  for (var j = 0; j < ys.length; j++) m = Math.max(m, Math.abs(ys[j]));
  return ys.map(function (y) { return y / m; });
})();
function sources(g, v) {
  var t = v.$touched || "";
  g.layer("denis-src", function () {
    band(g);
    for (var i = 0; i < 4; i++) scope(g, i * 120 + 4, 18, 108, 66);
    g.fill(476, 4, 1, 80, RULE);
  });
  var cols = [["SMOOTH", "lfo_rate"], ["STEPPED", "sh_rate"], ["ENVELOPE", "mod_depth_env"], ["NOISE", "mod_depth_noise"]];
  var rows = [1, 2, 0, 3];
  for (var c = 0; c < 4; c++) {
    var x = c * 120 + 4, k = cols[c][1], r = rows[c], hot = t === k;
    g.text(x + 2, 11, cols[c][0], hot ? "slot" : SRC[r].c, -1);
    var info = r === 0 ? "+/-" + fmt(v, k)[0] + "%" : fmt(v, k).join(r === 3 ? "" : " ");
    g.text(x + 108, 11, known(v, k) ? info : "--", hot ? "slot" : INK_DIM, 1);
  }
  g.lfo(6, 20, 104, 62, { shape: "Triangle", rate: rateOf(v, "lfo_rate"), trig: false, color: t === "lfo_rate" ? "slot" : SRC[1].c });
  g.lfo(126, 20, 104, 62, { shape: "S&H", rate: rateOf(v, "sh_rate"), trig: false, color: t === "sh_rate" ? "slot" : SRC[2].c });
  // the envelope as a source swings both ways: (env x 2 - 1) x depth
  var ed = clamp(num(v, "mod_depth_env", 0.7), 0, 1);
  g.fill(246, 51, 104, 1, SCOPE_EDGE);
  g.envelope(246 + 2, 51 - ed * 30, 100, Math.max(2, ed * 60), { attack: "attack", decay: "decay", sustain: "sustain", release: "release",
    color: t === "mod_depth_env" ? "slot" : SRC[0].c });
  // noise: a slow wander (white noise through about 7 Hz), as deep as its knob
  var nd = clamp(num(v, "mod_depth_noise", 0.4), 0, 1);
  g.fill(366, 51, 104, 1, SCOPE_EDGE);
  g.poly(cached("src-nz|" + nd.toFixed(3), function () { return pts(368, 22, 100, 58, WANDER, nd); }), 2, t === "mod_depth_noise" ? "slot" : SRC[3].c);
  // where each source is patched
  g.text(488, 11, "PATCHED TO", INK, -1);
  for (var q = 0; q < 4; q++) {
    var y = 30 + q * 16, xx = 488;
    g.text(xx, y, SRC[q].name, SRC[q].c, -1);
    xx += 40;
    var any = false;
    for (var c2 = 0; c2 < 8; c2++) {
      var a = mat(v, q, c2);
      if (Math.abs(a) < 0.005) continue;
      any = true;
      var s1 = DEST[c2], s2 = sgn(Math.round(a * 100), 0);
      if (xx + g.measure(s1 + " " + s2) > 948) { g.text(948, y, "...", INK_DIM, 1); break; }
      g.text(xx, y, s1, INK, -1);
      g.text(xx + g.measure(s1) + 5, y, s2, a < 0 ? "#9fd0ff" : INK_DIM, -1);
      xx += g.measure(s1 + " " + s2) + 16;
    }
    if (!any) g.text(xx, y, "NOT PATCHED", INK_FAINT, -1);
  }
}
push.compartment({
  id: "mod", label: "Sources",
  pages: [
    { label: "Sources", keys: ["lfo_rate", "sh_rate", "mod_depth_env", "mod_depth_noise"], screen: sources },
    { label: "Patch", keys: ["preset", "patch_mode", "rnd_denis", "rnd_mod", "matrix_reset", "rnd_patch"] }
  ],
  extra_keys: ["attack", "decay", "sustain", "release"].concat(MAT_KEYS)
});

// MATRIX: the patch, a row a source, a column a destination over its encoder
var GROUPS = [[0, 1, "COMPLEX OSC"], [2, 3, "TIMBRAL OSC"], [4, 5, "WAVE MULTIPLIER"], [6, 6, "VCF"], [7, 7, "VCA"]];
var MROWS = [26, 42, 58, 74];
function cellX(c) { return c === 0 ? 70 : c * 120 + 56; }
function matrix(g, v) {
  var t = v.$touched || "", pg = clamp(v.$page || 0, 0, 3);
  g.layer("denis-mat|" + pg, function () {
    band(g);
    for (var i = 0; i < GROUPS.length; i++) {
      var x0 = GROUPS[i][0] * 120 + 10, x1 = GROUPS[i][1] * 120 + 110;
      g.text((x0 + x1) / 2, 10, GROUPS[i][2], INK_DIM, 0);
      g.fill(x0, 14, x1 - x0, 1, INK_FAINT);
    }
    g.fill(0, MROWS[pg] - 7, g.w, 15, DEEP);
    for (var r = 0; r < 4; r++) {
      g.text(4, MROWS[r] + 4, SRC[r].name, r === pg ? INK : INK_DIM, -1);
      for (var c = 0; c < 8; c++) {
        var cx = cellX(c);
        g.fill(cx - 38, MROWS[r], 76, 1, INK_FAINT);
        g.fill(cx - 38, MROWS[r] - 2, 1, 5, INK_FAINT); g.fill(cx + 38, MROWS[r] - 2, 1, 5, INK_FAINT);
        jack(g, cx, MROWS[r]);
      }
    }
  });
  for (var r = 0; r < 4; r++) for (var c = 0; c < 8; c++) {
    var a = mat(v, r, c), k = mkey(r, c), hot = t === k;
    if (!known(v, k)) continue;
    var cx = cellX(c), y = MROWS[r], cur = r === pg;
    if (Math.abs(a) < 0.005) { if (hot) g.arc(cx, y, 7, 0, TAU, 2, "slot"); continue; }
    var col = hot ? "slot" : (cur ? SRC[r].c : SRC[r].dk), h = cur ? 6 : 4, w = Math.round(a * 38);
    g.fill(a > 0 ? cx : cx + w, y - h / 2, Math.abs(w), h, col);
    plug(g, cx, y, hot ? "slot" : (cur ? SRC[r].c : SRC[r].dk), a < 0);
  }
}
push.compartment({
  id: "matrix", label: "Matrix",
  pages: [
    { label: "Env >", keys: MAT_KEYS.slice(0, 8) },
    { label: "Smooth >", keys: MAT_KEYS.slice(8, 16) },
    { label: "Stepped >", keys: MAT_KEYS.slice(16, 24) },
    { label: "Noise >", keys: MAT_KEYS.slice(24, 32) }
  ],
  extra_keys: MAT_KEYS,
  screen: matrix
});
