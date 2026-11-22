// Braids (Mutable Instruments' macro oscillator) on the Push.
// An overlay shipped with Pung (Braids itself ships no push_ui.js).
//
// Braids is one oscillator with 47 ways of making a sound: its display names
// the algorithm in four (here up to six) LED letters, and its two big knobs,
// TIMBRE and COLOR, mean something different for each one. A row of knobs
// says "Timbre 50 %"; the module says "notch width". The screens say what
// the module says, from its own code (braids/macro_oscillator.cc and
// digital_oscillator.cc, read for what each algorithm does with them):
//
//   PANEL       the module front: the LED display, the big TIMBRE and COLOR
//               knobs with what they do on this algorithm, the wave it makes
//               (where it is a wave), the plugin's filter and amp envelope
//   OSCILLATOR  all 47 algorithms in their families, the one playing lit:
//               where the algorithm knob is, and where it goes next
//   FILTER      the filter's response (the plugin's SVF is a band-pass), how
//               far its envelope sweeps it, the envelope in the plugin's times
//   AMP         the envelope in the plugin's times, the output, the octave
//
// The plugin's envelopes are linear ADSRs whose stage time is
// 0.001 + p^2 * 10 seconds (braids_plugin.cpp, SimpleADSR): Pung is told so
// (push.envelopeTimes), and the screens write the seconds over the knobs.

// ---- colours: a black anodised panel, white print, the red LED display ----------
var PANEL = "#18191b", ROW = "#101112", RECESS = "#0a0a0b", EDGE = "#34373b";
var SILK = "#e6e6e3", SILK2 = "#8f9398", CAP = "#cfd2d5", CAP_DK = "#55595e";
var LED = "#ff3d1f", LED_OFF = "#2e0c07", LED_BG = "#0e0302";

function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value || "") : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? d : n; }

// ---- the algorithms ---------------------------------------------------------------
// [name as the module calls it, family, what TIMBRE does, what COLOR does, picture]
var ALGOS = [
  ["CSAW", 0, "NOTCH WIDTH", "NOTCH DEPTH", "csaw"],
  ["MORPH", 0, "TRI-SAW-SQR", "FILTER, FUZZ", "morph"],
  ["/\\-_", 0, "SHAPE, WIDTH", "SAW > SQUARE", "sawsq"],
  ["SINE^", 0, "FOLD", "SINE > TRI", "fold"],
  ["BUZZ", 0, "HARMONICS", "DETUNE", "buzz"],
  ["SQR<", 1, "PULSE WIDTH", "SUB OCT+LEVEL", "sub"],
  ["SAW<", 1, "SAW SHAPE", "SUB OCT+LEVEL", "sub"],
  ["SQsync", 2, "SYNC RATIO", "SLAVE MIX", "sync"],
  ["SWsync", 2, "SYNC RATIO", "SLAVE MIX", "sync"],
  ["3xSAW", 3, "OSC 2 PITCH", "OSC 3 PITCH", "triple"],
  ["3xSQR", 3, "OSC 2 PITCH", "OSC 3 PITCH", "triple"],
  ["3xTRI", 3, "OSC 2 PITCH", "OSC 3 PITCH", "triple"],
  ["3xSIN", 3, "OSC 2 PITCH", "OSC 3 PITCH", "triple"],
  ["3xRNG", 3, "OSC 2 PITCH", "OSC 3 PITCH", "ringmod"],
  ["SWARM", 4, "DETUNE", "HIGH-PASS", "swarm"],
  ["COMB", 4, "COMB PITCH", "FEEDBACK - / +", ""],
  ["TOY", 4, "SAMPLE RATE", "BIT FLIPS", ""],
  ["ZLPF", 5, "RESONANCE", "WINDOW", "zfilt"],
  ["ZPKF", 5, "RESONANCE", "WINDOW", "zfilt"],
  ["ZBPF", 5, "RESONANCE", "WINDOW", "zfilt"],
  ["ZHPF", 5, "RESONANCE", "WINDOW", "zfilt"],
  ["VOSIM", 6, "FORMANT 1", "FORMANT 2", ""],
  ["VOWL", 6, "VOWEL", "FORMANT SHIFT", ""],
  ["V.FOF", 6, "VOWEL", "VOICE", ""],
  ["HARM", 7, "PEAK HARMONIC", "PEAK WIDTH", "harm"],
  ["FM", 7, "INDEX", "RATIO", "fm"],
  ["FBFM", 7, "INDEX", "RATIO", "fm"],
  ["WTFM", 7, "INDEX", "RATIO", "fm"],
  ["PLUK", 8, "DECAY", "PLUCK POINT", "ring"],
  ["BOWD", 8, "BOW PRESSURE", "BOW POSITION", ""],
  ["BLOW", 8, "BREATH", "GEOMETRY", ""],
  ["FLUT", 8, "BREATH", "GEOMETRY", ""],
  ["BELL", 9, "DAMPING", "INHARMONIC", "ring"],
  ["DRUM", 9, "DAMPING", "BRIGHTNESS", "ring"],
  ["KICK", 9, "DECAY", "TONE", "ring"],
  ["CYMB", 9, "CUTOFF", "NOISE > METAL", ""],
  ["SNAR", 9, "TONE", "SNAPPY", ""],
  ["WTBL", 10, "POSITION", "TABLE", "table"],
  ["WMAP", 10, "X", "Y", "map"],
  ["WLIN", 10, "POSITION", "SMOOTHING", "table"],
  ["WTx4", 10, "WAVE", "CHORD", "table"],
  ["NOIS", 11, "RESONANCE", "LP > BP > HP", ""],
  ["TWNQ", 11, "RESONANCE", "PEAK 2 PITCH", ""],
  ["CLKN", 11, "CLOCK RATE", "STEPS", ""],
  ["GRN", 11, "GRAIN RATE", "PITCH SPREAD", ""],
  ["PART", 11, "DENSITY", "PITCH SPREAD", ""],
  ["QPSK", 11, "SYMBOL RATE", "DATA", ""]
];
var FAMILIES = ["ANALOG", "SUB", "SYNC", "TRIPLE", "SWARM", "FILTER", "VOICE", "ADD/FM", "PHYS", "PERC", "WAVE", "NOISE"];
var FAMILY_LONG = ["CLASSIC ANALOG", "WITH SUB-OSC", "HARD SYNC", "THREE OSCILLATORS", "TEXTURES", "FILTERED WAVES",
  "VOCAL", "ADDITIVE AND FM", "PHYSICAL MODELS", "PERCUSSION", "WAVETABLES", "NOISE AND DATA"];

function algoIndex(v) {
  if (!known(v, "engine")) return -1;
  var d = disp(v, "engine");
  for (var i = 0; i < ALGOS.length; i++) if (ALGOS[i][0] === d) return i;
  var n = parseInt(v.engine.value, 10);
  if (!isNaN(n) && n >= 0 && n < ALGOS.length) return n;
  return Math.round(fr(v, "engine", 0) * (ALGOS.length - 1));
}

// ---- the display: fourteen segments a letter, as the module's LED display --------------
// segments in a unit cell (x 0..1, y 0..1): edges, middle halves, centre verticals, diagonals
var SEG = {
  t: [0, 0, 1, 0], b: [0, 1, 1, 1], tl: [0, 0, 0, 0.5], bl: [0, 0.5, 0, 1], tr: [1, 0, 1, 0.5], br: [1, 0.5, 1, 1],
  ml: [0, 0.5, 0.5, 0.5], mr: [0.5, 0.5, 1, 0.5], cu: [0.5, 0, 0.5, 0.5], cd: [0.5, 0.5, 0.5, 1],
  dtl: [0.5, 0.5, 0, 0], dtr: [0.5, 0.5, 1, 0], dbl: [0.5, 0.5, 0, 1], dbr: [0.5, 0.5, 1, 1]
};
var SEG_ALL = ["t", "b", "tl", "bl", "tr", "br", "ml", "mr", "cu", "cd", "dtl", "dtr", "dbl", "dbr"];
var GLYPH = {
  A: "t tr br tl bl ml mr", B: "t tr br b cu cd mr", C: "t tl bl b", D: "t tr br b cu cd", E: "t tl bl b ml mr",
  F: "t tl bl ml", G: "t tl bl b br mr", H: "tl bl tr br ml mr", I: "t b cu cd", J: "tr br b bl",
  K: "tl bl ml dtr dbr", L: "tl bl b", M: "tl bl tr br dtl dtr", N: "tl bl tr br dtl dbr", O: "t tr br b bl tl",
  P: "t tr tl bl ml mr", Q: "t tr br b bl tl dbr", R: "t tr tl bl ml mr dbr", S: "t tl ml mr br b", T: "t cu cd",
  U: "tl bl b br tr", V: "tl bl dbl dtr", W: "tl bl tr br dbl dbr", X: "dtl dtr dbl dbr", Y: "dtl dtr cd",
  Z: "t b dtr dbl", "0": "t tr br b bl tl dtr dbl", "1": "tr br", "2": "t tr mr ml bl b", "3": "t tr br b mr",
  "4": "tl ml mr tr br", "5": "t tl ml mr br b", "6": "t tl bl b br ml mr", "7": "t tr br", "8": "t tr br b bl tl ml mr",
  "9": "t tr br b tl ml mr", "/": "dtr dbl", "\\": "dtl dbr", "-": "ml mr", "_": "b", "^": "dbl dbr", "<": "dtr dbr",
  "?": "t tr mr cd", "*": "dtl dtr dbl dbr cu cd ml mr", " ": ""
};
// a name as the display shows it: capitals, a full stop on the letter before it
function ledCells(name) {
  var s = String(name).toUpperCase(), out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === "." && out.length) { out[out.length - 1].dp = true; continue; }
    out.push({ c: c, dp: false });
  }
  return out;
}
function segLine(g, x, y, w, h, s, lw, col) {
  var p = SEG[s], gap = 0.16, sl = 0.16 * h; // the letters lean, as LED letters do
  var x1 = p[0], y1 = p[1], x2 = p[2], y2 = p[3];
  var ax = x1 + (x2 - x1) * gap, ay = y1 + (y2 - y1) * gap, bx = x2 - (x2 - x1) * gap, by = y2 - (y2 - y1) * gap;
  g.line(x + ax * w + (1 - ay) * sl, y + ay * h, x + bx * w + (1 - by) * sl, y + by * h, lw, col);
}
// n cells from x: the unlit segments (kept in the layer) and the lit name
function ledDisplay(g, x, y, cw, ch, n, name, lw, lit, unlit) {
  var cells = name === null ? [] : ledCells(name);
  for (var i = 0; i < n; i++) {
    var cx = x + i * (cw + cw * 0.62);
    var on = {}, gl = cells[i] ? (GLYPH[cells[i].c] || "") : "";
    if (gl) gl.split(" ").forEach(function (s) { on[s] = 1; });
    for (var j = 0; j < SEG_ALL.length; j++) segLine(g, cx, y, cw, ch, SEG_ALL[j], lw, on[SEG_ALL[j]] ? lit : unlit);
    g.dot(cx + cw + cw * 0.3, y + ch, lw * 0.75, cells[i] && cells[i].dp ? lit : unlit);
  }
}

// ---- what the algorithm makes: its wave where it is one ------------------------------
// From the module's code, simplified to one cycle's shape: what TIMBRE and COLOR
// do to it can be seen. Where the sound is not a wave (noise, physical models
// that are excited and ring, vowels) nothing is drawn but the family.
function frac(x) { return x - Math.floor(x); }
function saw(p) { return 2 * frac(p) - 1; }
function sq(p, pw) { return frac(p) < pw ? 1 : -1; }
function tri(p) { var q = frac(p); return q < 0.5 ? 4 * q - 1 : 3 - 4 * q; }
function sine(p) { return Math.sin(2 * Math.PI * p); }
// Braids' triple oscillators: intervals in 1/128 semitones, by the knob's top 6 bits
var IV = [-24, -24, -23.97, -23, -22, -21, -20, -19, -18, -17.03, -17, -16, -15, -14, -13, -12.03, -12, -11, -10, -9, -8,
  -7.03, -7, -6, -5, -4, -3, -2, -1, -0.19, -0.06, -0.03, 0, 0.03, 0.06, 0.19, 1, 2, 3, 4, 5, 6, 7, 7.03, 8, 9, 10, 11,
  12, 12.03, 13, 14, 15, 16, 17, 17.03, 18, 19, 20, 21, 22, 23, 23.97, 24, 24];
function interval(f) { return IV[Math.max(0, Math.min(63, Math.floor(f * 32767 / 512)))]; }
function semis(st) {
  var r = Math.round(st);
  if (Math.abs(st - r) > 0.01 && Math.abs(st) < 1) return "DETUNED";
  return (r > 0 ? "+" : "") + r + " ST";
}
// the wave, as a function of the phase (cycles of the played note), -1..1; null: no wave to draw
function waveFn(kind, i, T, C) {
  switch (kind) {
  case "csaw": // a saw whose start is held flat: the notch, T wide, at a height C sets
    var nw = 0.375 * T, depth = -1.25 + C;
    return function (p) { var q = frac(p); return q < nw ? depth : 2 * q - 1; };
  case "morph": // triangle, saw, square, then a narrowing pulse; COLOR filters and overdrives
    return function (p) {
      var y;
      if (T < 1 / 3) { var b = T * 3; y = tri(p) * (1 - b) + saw(p) * b; }
      else if (T < 2 / 3) { var b2 = (T - 1 / 3) * 3; y = saw(p) * (1 - b2) + sq(p, 0.5) * b2; }
      else y = sq(p, 0.5 - (T - 2 / 3) * 3 * 0.45);
      return y * (1 - C) + Math.tanh(y * 3) * C;
    };
  case "sawsq": // a saw with a second ramp (TIMBRE) mixed into a square of the same width (COLOR)
    var pw = Math.max(1 / 64, T / 2);
    return function (p) {
      var q = frac(p), s = q < pw ? 2 * q / pw - 1 : 2 * (q - pw) / (1 - pw) - 1;
      return s * (1 - C) + sq(p, 0.5 - T * 0.4) * 0.58 * C;
    };
  case "fold": // sine and triangle through the wavefolder, folded harder as TIMBRE rises
    var gain = 0.0625 + 0.9375 * T;
    return function (p) {
      var a = Math.sin(sine(p) * gain * 4.7), b = Math.sin(tri(p) * gain * 4.7), n = Math.sin(Math.min(1, gain * 4.7));
      return (a * (1 - C) + b * C) / Math.max(0.35, n > 0 ? 1 : 1);
    };
  case "buzz": // a band-limited comb: more harmonics as TIMBRE rises, a second one detuned by COLOR
    var nh = 2 + Math.round(T * 14);
    return function (p) {
      var a = 0, b = 0;
      for (var k = 1; k <= nh; k++) { a += Math.cos(2 * Math.PI * k * p); b += Math.cos(2 * Math.PI * k * (p * (1 + C * 0.03) + C * 0.25)); }
      return (a + b) / (2 * nh) * 1.6 - 0.25;
    };
  case "sub": // the main wave and a square an octave or two below, louder the further COLOR is from the middle
    var main = ALGOS[i][0] === "SQR<" ? function (p) { return sq(p, 0.5 - T * 0.45); }
      : function (p) { var w = Math.max(1 / 64, T / 2), q = frac(p); return q < w ? 2 * q / w - 1 : 2 * (q - w) / (1 - w) - 1; };
    var oct = C < 0.5 ? 4 : 2, gsub = Math.abs(C - 0.5) * 2;
    return function (p) { return main(p) * (1 - gsub * 0.5) + sq(p / oct, 0.5) * gsub * 0.5; };
  case "sync": // a slave restarted by the master: its pitch up to 64 semitones above (TIMBRE)
    var r = Math.pow(2, T * 64 / 12), w2 = ALGOS[i][0] === "SQsync" ? function (p) { return sq(p, 0.5); } : saw;
    return function (p) { return w2(p) * (1 - C) + w2(frac(p) * r) * C; };
  case "triple": // three of a kind, the second and third at TIMBRE's and COLOR's intervals
    var base = ALGOS[i][0] === "3xSAW" ? saw : ALGOS[i][0] === "3xSQR" ? function (p) { return sq(p, 0.5); } : ALGOS[i][0] === "3xTRI" ? tri : sine;
    var r2 = Math.pow(2, interval(T) / 12), r3 = Math.pow(2, interval(C) / 12);
    return function (p) { return (base(p) + base(p * r2) + base(p * r3)) / 2.2; };
  case "ringmod": // three sines multiplied, the second and third up to 32 semitones either side
    var m2 = Math.pow(2, (T - 0.5) * 64 / 12), m3 = Math.pow(2, (C - 0.5) * 64 / 12);
    return function (p) { return sine(p) * sine(p * m2) * sine(p * m3); };
  case "swarm": // seven saws, spread apart by TIMBRE: they drift in and out of phase
    var d = 0.002 + T * 0.03;
    return function (p) { var y = 0; for (var k = -3; k <= 3; k++) y += saw(p * (1 + k * d)); return y / 4; };
  case "ring": // struck or plucked, then left to ring: TIMBRE sets how long (the drone at the top for the bell)
    var tau = ALGOS[i][0] === "BELL" && T > 0.976 ? 1e9 : 0.25 + T * T * 6;
    return function (p) { return Math.exp(-p / tau) * Math.sin(2 * Math.PI * p * (ALGOS[i][0] === "BELL" ? 1 + C * 0.4 : 1)); };
  case "zfilt": // a resonance at TIMBRE's pitch, windowed by a saw or a triangle (COLOR)
    var rr = 1 + T * 11;
    return function (p) {
      var q = frac(p), win = C < 0.5 ? 1 - q : 1 - Math.abs(2 * q - 1);
      return win * Math.cos(2 * Math.PI * rr * q) * 0.95;
    };
  case "fm": // a sine's phase moved by a second sine: INDEX how far, RATIO its speed
    var idx = T * 5, ratio = 1 + Math.round(C * 6) / 2;
    return function (p) { return Math.sin(2 * Math.PI * p + idx * Math.sin(2 * Math.PI * ratio * p)); };
  }
  return null;
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 64) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function wavePts(x, y, w, h, cycles, fn) {
  var pts = [], mid = y + h / 2, a = h / 2 - 1, step = 1, prev = null, n = Math.round(w / step);
  var lo = 1e9, hi = -1e9, ys = [];
  for (var i = 0; i <= n; i++) { var s = fn(i / n * cycles); ys.push(s); if (s < lo) lo = s; if (s > hi) hi = s; }
  var span = Math.max(0.6, hi - lo), off = (hi + lo) / 2; // scaled to the window, as a scope's gain
  for (var j = 0; j <= n; j++) {
    var yy = mid - (ys[j] - off) / span * 2 * a;
    if (prev !== null && Math.abs(yy - prev) > a * 0.5) pts.push(x + j * step, prev);
    pts.push(x + j * step, yy);
    prev = yy;
  }
  return pts;
}
// the harmonics HARM adds: a peak at TIMBRE, as wide as COLOR
function harmBars(g, x, y, w, h, T, C, col) {
  var n = 12, peak = n * T, width = 0.6 + C * 5, bw = w / n;
  for (var k = 0; k < n; k++) {
    var a = Math.exp(-Math.pow((k + 0.5 - peak) / width, 2));
    var bh = Math.max(1, Math.round(a * (h - 2)));
    g.fill(x + k * bw + 2, y + h - bh, bw - 4, bh, col);
  }
}

// ---- the knobs: Braids' own, a silver cap with a black line ----------------------------
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
function knobBody(g, cx, cy, r, ticks) {
  if (ticks) for (var i = 0; i <= 10; i++) {
    var a = A0 + SWEEP * i / 10;
    g.line(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3), cx + Math.cos(a) * (r + (i % 5 ? 6 : 8)), cy + Math.sin(a) * (r + (i % 5 ? 6 : 8)), 1, SILK2);
  }
  g.dot(cx, cy, r, CAP_DK);
  g.dot(cx, cy, r - 2.5, CAP);
}
function knobPointer(g, cx, cy, r, f, ok, hot) {
  if (hot) g.arc(cx, cy, r + 2, 0, Math.PI * 2, 2, "slot");
  if (!ok) { g.dot(cx, cy, 2, CAP_DK); return; }
  var a = A0 + f * SWEEP;
  g.line(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2, cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3), r > 14 ? 3 : 2, "#111111");
}

// ---- segments: the active section's legend lit (Pung's bar stands above it) ----------------
var SEG_LEGEND = { vcf: [660, "VCF"], vca: [812, "VCA ENV"] };
function segMark(g, v, col) {
  if (v.$segmode !== "segment" || !v.$segment) return;
  var l = SEG_LEGEND[v.$segment];
  if (l) { g.text(l[0], 14, l[1], col, -1); return; }
  // the oscillator: the algorithm's family under its display
  var i = algoIndex(v);
  if (v.$segment === "osc" && i >= 0) g.text(10, 82, FAMILY_LONG[ALGOS[i][1]], col, -1, 160);
}

// ---- the encoder row: a small Braids knob under each encoder, its name and value --------
function row(g, v, values) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, ok = known(v, k);
    // segment mode: Pung names the segments in the bottom 18 pixels, the row ends above them
    var seg = !!v.$segmode, ky = seg ? 128 : 140, kr = seg ? 9 : 12;
    g.text(x + 60, seg ? 115 : 118, String(v[k].name).toUpperCase(), hot ? SILK : SILK2, 0, 112);
    knobBody(g, x + 24, ky, kr, false);
    knobPointer(g, x + 24, ky, kr, fr(v, k, 0), ok, hot);
    var val = values[i] !== undefined && values[i] !== null ? values[i] : (ok ? disp(v, k) + (v[k].unit ? " " + v[k].unit : "") : "--");
    g.value(x + 44, seg ? 136 : 147, val, hot ? "slot" : (ok ? SILK : SILK2), -1, 72);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(952, 100, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, SILK2, 1);
}

// ---- the plugin's envelope times -------------------------------------------------------
// SimpleADSR (braids_plugin.cpp): a stage moves at 1 / (0.001 + p^2 * 10) s per unit of
// level, linear: the attack rises 0..1, the decay falls 1..S, the release falls S..0.
function stageSecs(p) { return 0.001 + p * p * 10; }
push.envelopeTimes(function (env) {
  var sus = null;
  env.stages.forEach(function (s) { if (/sustain/.test(s.key || "") || s.role === "sustain") sus = s.raw; });
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    var p = parseFloat(s.raw), sl = sus === null ? 0 : parseFloat(sus);
    if (isNaN(p)) return null;
    if (s.role === "attack") return stageSecs(p);
    if (s.role === "decay") return stageSecs(p) * Math.max(0.001, 1 - (isNaN(sl) ? 0 : sl));
    if (s.role === "release") return stageSecs(p) * Math.max(0.001, isNaN(sl) ? 1 : sl);
    return null;
  });
});
// How the plugin's bare 0..1 numbers read wherever Pung writes them: an attack in
// seconds; a decay or release as the seconds it takes over the full level (its
// rate: the real stage is shorter by the sustain level, as the screens say over
// the knobs); FM in semitones; the octave as one.
push.display(function (key, raw) {
  var p = parseFloat(raw);
  if (isNaN(p)) return;
  if (key === "attack" || key === "f_attack") return secs(stageSecs(p)).toLowerCase();
  if (/^f?_?(decay|release)$/.test(key)) { var t = secs(stageSecs(p)).toLowerCase().split(" "); return { value: t[0], unit: t[1] + " full" }; }
  if (key === "fm") return p * 12 < 0.05 ? "0 st" : "+" + (p * 12).toFixed(1) + " st";
  if (key === "octave_transpose") return (p > 0 ? "+" : "") + Math.round(p) + " oct";
});
function secs(s) {
  if (s < 0.1) return Math.round(s * 1000) + " MS";
  if (s < 10) return s.toFixed(2) + " S";
  return s.toFixed(1) + " S";
}
// what a column of an ADSR says in the plugin's terms: a time, or the sustain level
// (the decay runs from full to the sustain level, the release from there to nothing)
function stageText(v, k) {
  if (!known(v, k)) return "--";
  var p = num(v, k, 0), sk = k.replace(/(attack|decay|release)$/, "sustain"), sl = num(v, sk, 1);
  if (/sustain$/.test(k)) return Math.round(p * 100) + " %";
  if (/decay$/.test(k)) return secs(stageSecs(p) * Math.max(0.001, 1 - sl));
  if (/release$/.test(k)) return secs(stageSecs(p) * Math.max(0.001, sl));
  return secs(stageSecs(p));
}

// ---- PANEL ----------------------------------------------------------------------------
function section(g, x, w, title) {
  g.text(x, 14, title, SILK2, -1);
  g.fill(x + g.measure(title) + 6, 9, w - g.measure(title) - 6, 1, EDGE);
}
function panelGround(g, v, i) {
  var a = i >= 0 ? ALGOS[i] : null;
  g.fill(0, 0, 960, 104, PANEL);
  // the display, its family and place
  g.value(10, 17, "BRAIDS", SILK, -1);
  g.fill(8, 24, 218, 44, EDGE);
  g.fill(9, 25, 216, 42, LED_BG);
  ledDisplay(g, 18, 31, 18, 29, 6, a ? a[0] : null, 2.6, LED, LED_OFF);
  if (a) {
    g.text(10, 82, FAMILY_LONG[a[1]], SILK, -1, 160);
    g.text(224, 82, (i + 1) + "/" + ALGOS.length, SILK2, 1);
  } else g.text(10, 82, "ALGORITHM --", SILK2, -1);
  // the big knobs, with what they do on this algorithm
  var kx = [276, 372];
  ["TIMBRE", "COLOR"].forEach(function (nm, j) {
    g.text(kx[j], 14, nm, SILK, 0);
    knobBody(g, kx[j], 50, 24, true);
    g.text(kx[j], 96, a ? a[2 + j] : "", SILK2, 0, 96);
  });
  // the scope
  section(g, 432, 216, a && waveFn(a[4], i, 0.5, 0.5) !== null || (a && (a[4] === "harm" || a[4] === "table" || a[4] === "map")) ? "OUT" : (a ? FAMILIES[a[1]] : "OUT"));
  g.fill(432, 20, 216, 78, RECESS);
  section(g, 660, 140, "VCF");
  section(g, 812, 140, "VCA ENV");
  // the encoder row's ground
  g.fill(0, 104, 960, 56, ROW);
  g.fill(0, 104, 960, 1, EDGE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 112, 1, 42, "#202224");
}
// the family's algorithms, the one playing lit: where the knob goes next
function familyList(g, x, y, w, h, i, f) {
  var names = [];
  for (var j = 0; j < ALGOS.length; j++) if (ALGOS[j][1] === f) names.push(j);
  var per = names.length > 4 ? 3 : names.length, rows = Math.ceil(names.length / per), cw = 62, ch = 17;
  var y0 = y + (h - rows * (ch + 6) + 6) / 2;
  for (var n = 0; n < names.length; n++) {
    var r = Math.floor(n / per), c = n % per, inRow = Math.min(per, names.length - r * per);
    var cx = x + (w - inRow * (cw + 6) + 6) / 2 + c * (cw + 6), cy = y0 + r * (ch + 6), me = names[n] === i;
    g.fill(cx, cy, cw, ch, me ? LED : EDGE);
    if (!me) g.fill(cx + 1, cy + 1, cw - 2, ch - 2, RECESS);
    g.text(cx + cw / 2, cy + 12, ALGOS[names[n]][0].toUpperCase(), me ? "#000000" : SILK2, 0, cw - 4);
  }
}
// what fills the scope: a wave, the harmonics, a table's position, the map, or the family
function scope(g, v, i, x, y, w, h, colour) {
  var a = ALGOS[i], T = fr(v, "timbre", 0.5), C = fr(v, "color", 0.5);
  var tq = Math.round(T * 64) / 64, cq = Math.round(C * 64) / 64;
  var fn = waveFn(a[4], i, tq, cq);
  if (fn) {
    var cyc = { sub: 4, zfilt: 3, ringmod: 3, swarm: 6, ring: 9 }[a[4]] || 2;
    g.poly(cached("w|" + i + "|" + tq + "|" + cq + "|" + x + "|" + w, function () { return wavePts(x + 4, y + 4, w - 8, h - 8, cyc, fn); }), 2, colour);
    var note = a[4] === "triple" ? "2: " + semis(interval(tq)) + "   3: " + semis(interval(cq))
      : a[4] === "sub" ? "SUB " + (C < 0.5 ? "-2" : "-1") + " OCT"
      : a[4] === "sync" ? "SLAVE +" + Math.round(tq * 64) + " ST" : "";
    if (note) { g.fill(x + w - g.measure(note) - 10, y - 12, g.measure(note) + 10, 10, PANEL); g.text(x + w, y - 4, note, SILK, 1); }
    return;
  }
  if (a[4] === "harm") { harmBars(g, x + 8, y + 8, w - 16, h - 20, T, C, colour); g.text(x + 8, y + h - 2, "1", SILK2, -1); g.text(x + w - 8, y + h - 2, "12", SILK2, 1); return; }
  if (a[4] === "table") { // the position along the table: sixteen waves, the pointer between them
    for (var s = 0; s < 16; s++) g.fill(x + 10 + s * (w - 20) / 16, y + h / 2 - 8, 2, 16, "#3a3d41");
    var px = x + 10 + T * (w - 22);
    g.fill(px - 1, y + 10, 3, h - 20, colour);
    g.text(x + 8, y + h - 4, "POSITION " + Math.round(T * 100) + "%", SILK2, -1);
    return;
  }
  if (a[4] === "map") { // the 16 x 16 wave map, TIMBRE across, COLOR down
    var gx = x + w / 2 - (h - 10) / 2, gs = h - 10;
    for (var q = 0; q <= 4; q++) { g.fill(gx + q * gs / 4, y + 5, 1, gs, "#3a3d41"); g.fill(gx, y + 5 + q * gs / 4, gs, 1, "#3a3d41"); }
    g.dot(gx + T * gs, y + 5 + C * gs, 4, colour);
    return;
  }
  familyList(g, x, y, w, h, i, a[1]); // no wave to draw: the family, the algorithm lit
}
function panel(g, v) {
  var i = algoIndex(v), t = v.$touched || "";
  g.layer("panel|" + i, function () { panelGround(g, v, i); });
  var a = i >= 0 ? ALGOS[i] : null;
  // the preset
  var pn = disp(v, "preset_name");
  if (pn) g.text(92, 16, pn.toUpperCase(), SILK2, -1, 132);
  // the display lit in slot colour while the algorithm knob is under a finger
  if (t === "engine") { g.fill(8, 24, 218, 1, "slot"); g.fill(8, 67, 218, 1, "slot"); }
  // big knobs
  knobPointer(g, 276, 50, 24, fr(v, "timbre", 0), known(v, "timbre"), t === "timbre");
  knobPointer(g, 372, 50, 24, fr(v, "color", 0), known(v, "color"), t === "color");
  // the scope
  if (a && known(v, "timbre") && known(v, "color")) scope(g, v, i, 432, 20, 216, 78, t === "timbre" || t === "color" ? "slot" : SILK);
  // VCF: the plugin's SVF is a band-pass; bypassed while it would do nothing
  var cut = fr(v, "cutoff", 1), res = fr(v, "resonance", 0), env = fr(v, "filt_env", 0);
  var bypass = known(v, "cutoff") && cut >= 0.99 && res <= 0.01 && env <= 0.01;
  if (bypass) { g.text(730, 60, "BYPASSED", SILK2, 0); }
  else {
    g.filter(660, 20, 140, 70, { cutoff: "cutoff", resonance: "resonance", type: "BandPass", color: SILK });
    if (env > 0.01) { // how far the filter envelope opens it
      var x0 = 664 + 132 * cut, x1 = 664 + 132 * Math.min(1, cut + env);
      g.fill(x0, 94, Math.max(2, x1 - x0), 2, t === "filt_env" ? "slot" : LED);
    }
  }
  g.envelope(812, 20, 140, 78, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", color: SILK });
}
var FM_ST = function (v) { var st = fr(v, "fm", 0) * 12; return known(v, "fm") ? (st < 0.05 ? "0 ST" : "+" + st.toFixed(1) + " ST") : "--"; };
function octText(v) { var o = Math.round(num(v, "octave_transpose", 0)); return known(v, "octave_transpose") ? (o > 0 ? "+" + o : String(o)) + " OCT" : "--"; }
// Pung's default pages in Braids' colours: black panel, white print, light grey knobs
push.theme({ ground: PANEL, ink: SILK, dim: SILK2, rule: EDGE, panel: CAP, knob: "pointer" });
push.compartment({
  id: "panel", label: "Braids", front_panel: true,
  pages: [{ label: "Braids", keys: ["engine", "timbre", "color", "fm", "cutoff", "resonance", "filt_env", "octave_transpose"] }],
  extra_keys: ["preset_name", "attack", "decay", "sustain", "release"],
  // the module's sections, under the hands one at a time (segment mode)
  segments: [
    { id: "osc", label: "Oscillator", rect: [4, 2, 648, 100], keys: ["engine", "timbre", "color", "fm", "octave_transpose"] },
    { id: "vcf", label: "VCF", rect: [656, 2, 148, 100], keys: ["cutoff", "resonance", "filt_env", "f_attack", "f_decay", "f_sustain", "f_release"] },
    { id: "vca", label: "VCA Env", rect: [808, 2, 148, 100], keys: ["attack", "decay", "sustain", "release", "volume"] }
  ],
  draws_segments: true,
  screen: function (g, v) {
    panel(g, v);
    segMark(g, v, "slot");
    var kn = v.$knobs || [], vals = [];
    for (var i = 0; i < 8; i++) vals.push(kn[i] === "fm" ? FM_ST(v) : (kn[i] === "octave_transpose" ? octText(v) : null));
    row(g, v, vals);
  }
});

// ---- OSCILLATOR: the 47 algorithms ---------------------------------------------------------
function oscGround(g, i) {
  var cw = 58;
  for (var f = 0; f < FAMILIES.length; f++) {
    var x = 10 + f * cw, mine = i >= 0 && ALGOS[i][1] === f;
    g.text(x, 9, FAMILIES[f], mine ? SILK : "#5d6166", -1, cw - 4);
    var r = 0;
    for (var j = 0; j < ALGOS.length; j++) {
      if (ALGOS[j][1] !== f) continue;
      var y = 22 + r * 11;
      if (j === i) g.fill(x - 3, y - 9, cw - 4, 11, LED);
      g.text(x, y, ALGOS[j][0].toUpperCase(), j === i ? "#000000" : (mine ? SILK : SILK2), -1, cw - 6);
      r++;
    }
  }
  g.fill(712, 2, 1, 82, EDGE);
  g.fill(722, 4, 226, 40, LED_BG);
  ledDisplay(g, 732, 10, 15, 26, 6, i >= 0 ? ALGOS[i][0] : null, 2.2, LED, LED_OFF);
}
push.compartment({
  id: "osc", label: "Oscillator",
  pages: [{ label: "Oscillator", keys: ["engine", "timbre", "color", "fm"] }],
  screen: function (g, v) {
    var i = algoIndex(v), t = v.$touched || "";
    g.layer("osc|" + i, function () { oscGround(g, i); });
    if (t === "engine" && i >= 0) { // the lit one in the slot's colour while the knob is turned
      var f = ALGOS[i][1], r = 0;
      for (var j = 0; j < i; j++) if (ALGOS[j][1] === f) r++;
      var x = 10 + f * 58, y = 22 + r * 11;
      g.fill(x - 3, y - 9, 54, 11, "slot");
      g.text(x, y, ALGOS[i][0].toUpperCase(), "#000000", -1, 52);
    }
    if (i < 0) return;
    var a = ALGOS[i];
    // TIMBRE and COLOR, in the algorithm's words, with where each stands
    var rows = [["TIMBRE", a[2], "timbre"], ["COLOR", a[3], "color"]];
    for (var q = 0; q < 2; q++) {
      var y0 = 58 + q * 14, k = rows[q][2], hot = t === k;
      g.text(722, y0, rows[q][1], hot ? "slot" : SILK, -1, 150);
      g.fill(878, y0 - 5, 70, 2, EDGE);
      if (known(v, k)) g.fill(878, y0 - 7, Math.max(2, Math.round(70 * fr(v, k, 0))), 6, hot ? "slot" : SILK2);
    }
    g.text(722, 84, "FM (MOD WHEEL)  " + FM_ST(v), t === "fm" ? "slot" : SILK2, -1, 226);
  }
});

// ---- FILTER: the band-pass, its sweep, its envelope ------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: ["cutoff", "resonance", "filt_env", "f_attack", "f_decay", "f_sustain", "f_release"] }],
  screen: function (g, v) {
    var t = v.$touched || "";
    var cut = fr(v, "cutoff", 1), res = fr(v, "resonance", 0), env = fr(v, "filt_env", 0);
    var bypass = known(v, "cutoff") && cut >= 0.99 && res <= 0.01 && env <= 0.01;
    // over cutoff, resonance and the envelope's amount: the response, and how far the envelope opens it
    g.filter(4, 2, 348, 72, { cutoff: "cutoff", resonance: "resonance", type: "BandPass" });
    g.text(10, 12, bypass ? "BAND-PASS: BYPASSED" : "BAND-PASS", "dim", -1);
    if (env > 0.004) {
      var top = Math.min(1, cut + env), x0 = 8 + 340 * cut, x1 = 8 + 340 * top, c = t === "filt_env" ? "slot" : "mod";
      g.fill(x0, 79, Math.max(2, x1 - x0), 3, c);
      g.dot(x1, 80.5, 3.5, c);
      g.text(348, 12, "ENVELOPE " + Math.round(cut * 100) + " > " + Math.round(top * 100) + " %", c, 1);
    } else g.text(348, 12, "NO ENVELOPE", "faint", 1);
    // over the envelope's four knobs: the envelope, and each stage in the plugin's time
    g.fill(360, 4, 1, 78, "line");
    var ks = ["f_attack", "f_decay", "f_sustain", "f_release"];
    for (var q = 0; q < 4; q++) g.text(360 + q * 120 + 60, 12, stageText(v, ks[q]), t === ks[q] ? "slot" : "fg", 0);
    g.envelope(368, 16, 584, 70, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", labels: true });
  }
});

// ---- AMP: the envelope, the output, the octave, how it is played ----------------------------
push.compartment({
  id: "amp", label: "Amp",
  pages: [{ label: "Amp", keys: ["attack", "decay", "sustain", "release", "volume", "octave_transpose"] }],
  screen: function (g, v) {
    var t = v.$touched || "";
    var ks = ["attack", "decay", "sustain", "release"];
    for (var q = 0; q < 4; q++) g.text(q * 120 + 60, 12, stageText(v, ks[q]), t === ks[q] ? "slot" : "fg", 0);
    g.envelope(4, 16, 468, 70, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", labels: true });
    g.fill(480, 4, 1, 78, "line");
    // over volume: the level it sets, and beside it what the device puts out now
    var vol = fr(v, "volume", 0), lv = v.$live && v.$live.known ? Math.min(1, v.$live.level) : 0;
    var fx = 512, fy = 20, fh = 60;
    g.text(540, 12, known(v, "volume") ? Math.round(vol * 100) + " %" : "--", t === "volume" ? "slot" : "fg", 0);
    g.fill(fx, fy, 8, fh, "faint");
    if (known(v, "volume")) g.fill(fx, fy + fh * (1 - vol), 8, fh * vol, t === "volume" ? "slot" : "fg");
    g.fill(fx + 14, fy, 8, fh, "faint");
    if (lv > 0) g.fill(fx + 14, fy + fh * (1 - lv), 8, fh * lv, "mod");
    g.text(fx + 30, fy + 8, "SET", "dim", -1);
    g.text(fx + 30, fy + fh, "OUT", lv > 0 ? "mod" : "faint", -1);
    // over octave: where the keyboard sits, -3 to +3
    var oc = Math.round(num(v, "octave_transpose", 0)), hot = t === "octave_transpose";
    g.text(660, 12, known(v, "octave_transpose") ? (oc > 0 ? "+" + oc : String(oc)) + " OCT" : "--", hot ? "slot" : "fg", 0);
    for (var o = -3; o <= 3; o++) {
      var bx = 614 + (o + 3) * 13;
      g.fill(bx, 30, 11, 34, o === oc ? (hot ? "slot" : LED) : "faint");
      if (o === -3 || o === 0 || o === 3) g.text(bx + 5, 78, o > 0 ? "+" + o : String(o), "dim", 0);
    }
    // how it is played: four voices, the bend, the wheel
    g.fill(720, 4, 1, 78, "line");
    var held = v.$live && v.$live.known ? v.$live.held : 0;
    g.text(736, 12, "VOICES", "dim", -1);
    for (var n = 0; n < 4; n++) g.fill(736 + n * 18, 20, 14, 10, n < held ? "mod" : "faint");
    g.text(820, 29, held ? held + " HELD" : "4 NOTES AT ONCE", held ? "mod" : "dim", -1);
    g.text(736, 54, "BEND   +/- 2 ST", "dim", -1);
    g.text(736, 70, "WHEEL  FM, UP TO +12 ST", "dim", -1);
  }
});
