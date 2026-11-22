// Sophie on Push: sixteen pads of metallic FM percussion.
//
// Every pad is its own small FM voice: a carrier and three modulators at
// deliberately inharmonic ratios (Color moves them), as deep as Metal, fed
// back into the first, swept in pitch, then crushed, driven, rung through a
// short comb and filtered. Six models arrange those parts. The screens are
// liquid chrome on black, each model in its own acid colour.
//
//   PANEL   the sixteen pads as the Move lays them out (1..8 below, 9..16
//           above), each with its model, the first milliseconds of its strike
//           as the engine computes it, its decay; a pad lights as it plays.
//           Pages turn the encoders across eight pads at a time.
//   PAD n   one pad whole: its model's operators as they are wired (the
//           ratios Color gives them, Metal's depth, the feedback loop), its
//           strike, its decay (Pung's envelope), its filter (Pung's filter),
//           its ring (the comb's teeth and their fall).

function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function frac(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function upper(s) { return String(s).toUpperCase(); }
function pk(i, p) { return "p" + (i < 10 ? "0" : "") + i + "_" + p; }

// ---- chrome and acid -------------------------------------------------------------------
var BLACK = "#08080a", LATEX = "#141519", LATEX2 = "#1d1f25", RULE = "#2c3038", CHROME = "#d3dae2", CHROME2 = "#8a949f", CHROME3 = "#4a525c";
var PINK = "#ff3fd2", CYAN = "#4df0ff";
var MODELS = ["Fuse", "Stack", "Split", "Shard", "Pipe", "Boom"];
var MCOL = ["#ff3fd2", "#4df0ff", "#b38cff", "#ffe14d", "#7dff9a", "#ff8a3d"];
var NAMES = ["KICK", "RIM", "SNARE", "CLAP", "SNARE 2", "LOW TOM", "CLOSED HH", "FLOOR TOM", "PEDAL HH", "MID TOM", "OPEN HH",
  "LOW-MID", "HIGH-MID", "CRASH", "HIGH TOM", "RIDE"];
var FILT = ["LPF", "HPF", "Notch", "DJ", "BPF"];
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
function modelOf(v, i) { var d = MODELS.indexOf(disp(v, pk(i, "model"))); return d >= 0 ? d : Math.max(0, Math.min(5, Math.round(num(v, pk(i, "model"), 0)))); }
function filtOf(v, i) { var d = FILT.indexOf(disp(v, pk(i, "filter_type"))); return d >= 0 ? d : Math.max(0, Math.min(4, Math.round(num(v, pk(i, "filter_type"), 0)))); }

// ---- what plays: notes 36..51 are pads 1..16 ---------------------------------------------
function strikes(v) {
  var out = [], L = v.$live, i;
  for (i = 0; i < 16; i++) out.push(-1);
  if (!L || !L.known || !L.voices) return out;
  for (i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], p = n.note - 36;
    if (p >= 0 && p < 16 && (out[p] < 0 || n.age < out[p])) out[p] = n.age;
  }
  return out;
}

// ---- a pad's strike, as the engine computes it (sophie.c, render_voice: Raw mode) ---------------
function patchOf(v, i) {
  return { pad: i - 1, model: modelOf(v, i), tune: num(v, pk(i, "tune"), 0), color: num(v, pk(i, "color"), 50) / 100,
    metal: num(v, pk(i, "metal"), 50) / 100, fb: num(v, pk(i, "feedback"), 20) / 100, sweep: num(v, pk(i, "sweep"), 0) / 100,
    decay: Math.max(0.03, num(v, pk(i, "decay"), 0.3)), mdecay: num(v, pk(i, "metal_decay"), 0), drive: num(v, pk(i, "drive"), 50) / 100,
    crush: num(v, pk(i, "crush"), 0) / 100, level: num(v, pk(i, "level"), 100) / 100 };
}
function ratios(P) {
  var c = P.color, r1 = 0.47 + c * c * 7.6;
  if (P.model === 4) r1 = 1.31 + c * 6; else if (P.model === 5) r1 = 0.6 + c * 4.2;
  return [r1, 1.31 + c * 11.17, 2.07 + (1 - c) * 15.73];
}
// The strike as its spectrum: FM puts partials at the carrier plus and minus
// whole multiples of each modulator, as strong as the Bessel function of the
// index (the depth Metal gives it). The engine's index is deepest at the
// strike and settles as the metal decays (sophie.c: index = metal^2 x
// (2 + 24 x (0.25 + 0.75 x brightness))): both are drawn, the strike bright,
// the settled sound behind it. Partials are placed on Pung's frequency axis
// from the pad's own pitch (its note, its tune).
var JT = [], JX = 0.5, JN = 8;
function jtable() { // J_n(x) for n 0..7, x 0..32 by 0.5: the integral, 20 steps; built on first use
  if (JT.length) return;
  for (var n = 0; n < JN; n++) {
    var row = [];
    for (var xi = 0; xi <= 64; xi++) {
      var x = xi * JX, sum = 0;
      for (var k = 0; k < 20; k++) { var tau = (k + 0.5) * Math.PI / 20; sum += Math.cos(n * tau - x * Math.sin(tau)); }
      row.push(sum / 20);
    }
    JT.push(row);
  }
}
function J(n, x) {
  if (!JT.length) jtable();
  n = Math.abs(n);
  if (n >= JN) return 0;
  var f = Math.min(64, x / JX), i = Math.floor(f), r = f - i, row = JT[n];
  return i >= 64 ? row[64] : row[i] * (1 - r) + row[i + 1] * r;
}
// [ratio of the pad's pitch, amplitude] pairs
function partials(P, bright, K) {
  var R = ratios(P), ix = P.metal * P.metal * (2 + 24 * (0.25 + 0.75 * bright)), out = [], k, j;
  function pair(c, m, I, a) { for (k = -K; k <= K; k++) out.push([Math.abs(c + k * m), a * Math.abs(J(k, I))]); }
  if (P.pad === 0 && P.model < 4) { out.push([1, 0.86]); out.push([2, 0.14 * (1 + P.color)]); pair(1, R[1], P.metal * 2.5, P.metal * 0.18); return out; }
  switch (P.model) {
  case 0: // two modulators into the carrier: every k, j
    for (k = -K; k <= K; k++) for (j = -K; j <= K; j++) out.push([Math.abs(1 + k * R[1] + j * R[0]), Math.abs(J(k, ix * 0.72) * J(j, ix * 0.28))]);
    return out;
  case 1: pair(1, R[0], ix * 0.62, 0.56); pair(0.501, R[1], ix * 0.35, 0.31); pair(1.997, R[2], ix * 0.22, 0.18); return out;
  case 2: pair(1, R[0], ix, 0.62); pair(1.003, R[1], ix * 0.71, 0.38); out.push([R[2], 0.18]); return out;
  case 3: pair(1, R[0], ix * 0.55, 0.85 - P.metal * 0.25); return out;
  case 4: pair(1, R[0], ix * (1 + 0.3125 + P.metal * 0.5), 1); return out;
  case 5: var em = 0.0625 + P.metal * bright * 0.5; out.push([1, 1 - em]); pair(1, R[0], ix, em); return out;
  }
  return out;
}
function baseHz(P) { return Math.max(20, Math.min(10000, 440 * Math.pow(2, (36 + P.pad - 69) / 12) * Math.pow(2, P.tune / 12))); }
// the partials as one poly: a line up and back down at each
function spectrumPts(P, bright, K, x, y, w, h) {
  var L = partials(P, bright, K), f0 = baseHz(P), pts = [x, y + h], base = y + h;
  for (var i = 0; i < L.length; i++) {
    var f = L[i][0] * f0, a = L[i][1];
    if (f < 20 || f > 20000 || a < 0.01) continue;
    var px = x + w * Math.log(f / 20) / Math.LN10 / 3, hh = h * Math.min(1, Math.sqrt(a));
    pts.push(px, base, px, base - hh, px, base);
  }
  pts.push(x + w, base);
  return pts;
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 200) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function pkey(P) { return [P.pad, P.model, P.tune, P.color, P.metal, P.fb, P.sweep, P.decay, P.mdecay, P.drive, P.crush, P.level].join("|"); }
// ---- values in their units ----------------------------------------------------------------------
function fmt(k, raw) {
  var x = parseFloat(raw), m = /^p\d\d_(.*)$/.exec(k), p = m ? m[1] : k;
  if (isNaN(x)) return null;
  if (p === "decay") return x < 1 ? [String(Math.round(x * 1000)), "MS"] : [x.toFixed(2), "S"];
  if (p === "tune") return [(x > 0 ? "+" : "") + Math.round(x), "ST"];
  if (p === "sweep") return [(x > 0 ? "+" : "") + Math.round(x), "%"];
  if (p === "metal_decay") return x <= 0 ? ["AUTO", ""] : [String(Math.round(x)), "MS"];
  if (p === "ring_time") return [x.toFixed(1), "MS"];
  if (p === "cutoff") { var hz = 40 * Math.pow(400, x / 100); return hz >= 1000 ? [(hz / 1000).toFixed(1), "KHZ"] : [String(Math.round(hz)), "HZ"]; }
  if (k === "focused_pad") { var n = Math.round(x); return NAMES[n - 1] ? [n + " " + NAMES[n - 1], ""] : null; }
  return null;
}
push.display(function (k, raw) { var r = fmt(k, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
function val(v, k) { if (!known(v, k)) return ["--", ""]; return fmt(k, v[k].value) || [String(v[k].display || v[k].value), upper(v[k].unit || "")]; }

// ---- the encoder row: chrome knobs, a ring in the pad's model colour ----------------------------
var PN = { model: "MODEL", tune: "TUNE", color: "COLOR", metal: "METAL", feedback: "FEEDBACK", metal_decay: "METAL DEC", feedback_mode: "FB MODE",
  tail_mode: "TAIL", sweep: "SWEEP", decay: "DECAY", crush: "CRUSH", drive: "DRIVE", level: "LEVEL", cutoff: "CUTOFF", resonance: "RESO",
  filter_type: "FILTER", ring_time: "RING TIME", ring_feedback: "RING FDBK", ring_mix: "RING MIX", ring_tone: "RING TONE" };
function knobName(v, k, padAcross) {
  var m = /^p(\d\d)_(.*)$/.exec(k);
  if (m) return padAcross ? +m[1] + " " + (PN[m[2]] || upper(m[2])) : (PN[m[2]] || upper(m[2]));
  return k === "focused_pad" ? "PAD" : upper(v[k].name);
}
function encoderRow(g, v, padAcross) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var h = k === t, m = /^p(\d\d)_/.exec(k), c = h ? "slot" : (m ? MCOL[modelOf(v, +m[1])] : PINK), kx = x0 + 24, seg = !!v.$segmode, ky = seg ? 128 : 139; // in segment mode the row draws above y 142
    g.text(x0 + 60, seg ? 114 : 120, knobName(v, k, padAcross), h ? "slot" : CHROME2, 0, 112);
    g.dot(kx, ky, 12.5, CHROME3); g.dot(kx, ky, 10.5, CHROME); g.dot(kx - 2, ky - 2, 4, "#f2f5f8");
    if (known(v, k)) {
      var f = v[k].frac, a = A0 + f * SWEEP, bip = /_sweep$|_tune$/.test(k);
      if (bip) { var s = Math.min(f, 0.5), e = Math.max(f, 0.5); g.arc(kx, ky, 15, A0 + s * SWEEP, Math.max(0.04, (e - s) * SWEEP), 2.5, c); }
      else if (f > 0.004) g.arc(kx, ky, 15, A0, f * SWEEP, 2.5, c);
      g.line(kx + Math.cos(a) * 3, ky + Math.sin(a) * 3, kx + Math.cos(a) * 10, ky + Math.sin(a) * 10, 2.5, h ? "slot" : BLACK);
    }
    var vt = val(v, k), unit = vt[1], uw = unit ? g.measure(unit) + 3 : 0, room = 72 - uw, vw = Math.min(g.measure(vt[0], "value"), room), cx = x0 + 83;
    g.value(cx - (vw + uw) / 2, seg ? 139 : 147, vt[0], h ? "slot" : CHROME, -1, room);
    if (unit) g.text(cx - (vw + uw) / 2 + vw + 3, seg ? 139 : 147, unit, CHROME3, -1);
  }
}

// ---- PANEL: the sixteen pads ------------------------------------------------------------------------
function skey(P) { return [P.pad, P.model, P.tune, P.color, P.metal].join("|"); } // what the partials depend on
// a tile's face: its colour, its name, its partials at the strike (kept in the layer)
function tileFace(g, i, x, y, P, on) {
  var w = 112, h = 37, c = MCOL[P.model];
  g.fill(x, y, w, h, on ? c : LATEX);
  g.fill(x, y, 2, h, c);
  g.text(x + 7, y + 11, i + " " + NAMES[i - 1], on ? BLACK : CHROME, -1, w - 12);
  g.fill(x + 6, y + 34, 58, 1, on ? BLACK : RULE);
  g.poly(cached("tp|" + i + "|" + skey(P) + "|" + y, function () { return spectrumPts(P, 1, 2, x + 6, y + 14, 58, 20); }), 1, on ? BLACK : c);
}
// what changes on it: lit as its pad plays, the value the page shows
function tile(g, v, i, x, y, P, age, lit, t) {
  var w = 112, on = age >= 0 && age < 0.15;
  if (on) tileFace(g, i, x, y, P, true);
  var lk = lit ? pk(i, lit) : "", vt = lit && lit !== "level" ? val(v, lk) : val(v, pk(i, "decay"));
  g.text(x + w - 4, y + 31, vt[0] + " " + vt[1], lit ? (t === lk ? "slot" : (on ? BLACK : CHROME)) : (on ? BLACK : CHROME2), 1, 46);
  if (lit === "level") { var lv = frac(v, lk, 1); g.fill(x + 74, y + 33, 34, 2, RULE); g.fill(x + 74, y + 33, Math.round(34 * lv), 2, t === lk ? "slot" : CHROME); }
}
function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", hits = strikes(v), Ps = [], sig = [];
  for (var q = 0; q < 16; q++) { Ps.push(patchOf(v, q + 1)); sig.push(skey(Ps[q])); }
  // the ground and the sixteen faces: kept until a pad's partials change
  g.layer("sophie|" + (v.$segmode || "") + "|" + sig.join(","), function () {
    g.fill(0, 0, 960, 160, BLACK);
    g.fill(0, 103, 960, 1, RULE);
    for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, v.$segmode ? 30 : 42, LATEX2);
    g.value(10, 16, "SOPHIE", CHROME, -1);
    var lx = 92; // the models, each in its colour: the tiles wear them
    for (var mi = 0; mi < 6; mi++) { g.fill(lx, 7, 6, 8, MCOL[mi]); g.text(lx + 10, 15, upper(MODELS[mi]), CHROME2, -1); lx += 18 + g.measure(upper(MODELS[mi])); }
    for (var f = 0; f < 16; f++) tileFace(g, f + 1, (f % 8) * 120 + 4, f < 8 ? 61 : 21, Ps[f], false);
  });
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 14, upper(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, CHROME2, 1);
  // which pads and which part the encoders turn: a page's row, or a segment's column (both pads)
  var m = kn[0] ? /^p(\d\d)_(.*)$/.exec(kn[0]) : null, row = m ? (+m[1] > 8 ? 1 : 0) : -1, part = m ? m[2] : "";
  var sm = v.$segmode === "segment" ? /^c(\d)$/.exec(v.$segment || "") : null;
  for (var i = 0; i < 16; i++) {
    var r = i < 8 ? 0 : 1, x = (i % 8) * 120 + 4, y = r ? 21 : 61;
    var lit = sm ? (i % 8 === +sm[1] ? "decay" : "") : (r === row ? part : "");
    tile(g, v, i + 1, x, y, Ps[i], hits[i], lit, t);
  }
  encoderRow(g, v, true);
}
function pads(from, part) { var o = []; for (var i = from; i < from + 8; i++) o.push(pk(i, part)); return o; }
var PEX = [];
var TILE = ["model", "tune", "color", "metal", "feedback", "sweep", "decay", "metal_decay", "drive", "crush", "level"];
for (var pi = 1; pi <= 16; pi++) for (var tp = 0; tp < TILE.length; tp++) PEX.push(pk(pi, TILE[tp]));
// segments: a column of the pads each (a lower pad and the one above it): tune, decay, metal, color
var SEGS = [];
for (var sc = 0; sc < 8; sc++) {
  var a = sc + 1, b = sc + 9;
  SEGS.push({ id: "c" + sc, label: "Pads " + a + "+" + b, rect: [sc * 120 + 4, 21, 112, 77],
    keys: [pk(a, "tune"), pk(a, "decay"), pk(a, "metal"), pk(a, "color"), pk(b, "tune"), pk(b, "decay"), pk(b, "metal"), pk(b, "color")] });
}
// Pung's default pages in Sophie's black and chrome, its knobs, its pink
push.theme({ ground: BLACK, panel: CHROME, ink: CHROME, dim: CHROME2, rule: CHROME3, faint: RULE, accent: PINK, knob: "pointer" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [
    { label: "Tune 1-8", keys: pads(1, "tune") }, { label: "Tune 9-16", keys: pads(9, "tune") },
    { label: "Decay 1-8", keys: pads(1, "decay") }, { label: "Decay 9-16", keys: pads(9, "decay") },
    { label: "Metal 1-8", keys: pads(1, "metal") }, { label: "Metal 9-16", keys: pads(9, "metal") },
    { label: "Model 1-8", keys: pads(1, "model") }, { label: "Model 9-16", keys: pads(9, "model") },
    { label: "Level 1-8", keys: pads(1, "level") }, { label: "Level 9-16", keys: pads(9, "level") }
  ],
  segments: SEGS,
  draws_segments: true,
  extra_keys: PEX,
  screen: panel
});

// ---- PAD n: one pad whole ---------------------------------------------------------------------------
// the operators as each model wires them (sophie.c): [name, ratio index or -1, x, y], links [from, to]
var WIRING = [
  { ops: [["M1", 0, 30, 20], ["M2", 1, 90, 20], ["C", -1, 150, 50]], links: [[0, 1], [1, 2], [0, 2]] },        // Fuse
  { ops: [["M1", 0, 20, 20], ["M2", 1, 80, 20], ["M3", 2, 140, 20], ["C", -1, 20, 58], ["SUB", -2, 80, 58], ["UP", -3, 140, 58]], links: [[0, 3], [1, 4], [2, 5]] }, // Stack
  { ops: [["M1", 0, 30, 20], ["M2", 1, 110, 20], ["M3", 2, 170, 58], ["C", -1, 30, 58], ["C'", -4, 110, 58]], links: [[0, 3], [1, 4]] }, // Split
  { ops: [["M1", 0, 40, 20], ["C32", -1, 110, 50], ["NOISE", -5, 40, 62]], links: [[0, 1]] },                  // Shard
  { ops: [["M1", 0, 40, 20], ["C", -1, 110, 50], ["RING", -6, 170, 50]], links: [[0, 1], [0, 2], [1, 2]] },   // Pipe
  { ops: [["M1", 0, 40, 20], ["EDGE", -1, 110, 30], ["BODY", -7, 110, 62]], links: [[0, 1]] }                  // Boom
];
var KICKWIRE = { ops: [["M1", 0, 30, 20], ["M2", 1, 90, 20], ["BODY", -7, 150, 62], ["FOLD", -8, 150, 30]], links: [[0, 1], [1, 2], [2, 3]] };
function opsDiagram(g, v, i, P, x0, y0, hotOp) {
  var w = P.pad === 0 && P.model < 4 ? KICKWIRE : WIRING[P.model], R = ratios(P), c = MCOL[P.model];
  var dep = 1 + P.metal * 3;
  for (var l = 0; l < w.links.length; l++) {
    var a = w.ops[w.links[l][0]], b = w.ops[w.links[l][1]];
    g.line(x0 + a[2] + 14, y0 + a[3], x0 + b[2] - 14 < x0 + a[2] + 14 ? x0 + b[2] : x0 + b[2] - 14, y0 + b[3], dep, hotOp ? "slot" : c);
  }
  for (var o = 0; o < w.ops.length; o++) {
    var op = w.ops[o], ox = x0 + op[2], oy = y0 + op[3], carrier = op[1] < 0;
    g.fill(ox - 17, oy - 9, 34, 19, carrier ? CHROME : LATEX2);
    g.fill(ox - 17, oy - 9, 34, 1, CHROME2);
    g.text(ox, oy - 1, op[0], carrier ? BLACK : CHROME, 0, 34);
    g.text(ox, oy + 7, op[1] >= 0 ? R[op[1]].toFixed(R[op[1]] >= 10 ? 1 : 2) : ({ "-2": "0.50", "-3": "2.00", "-5": "", "-6": "C X M1", "-8": "" }[op[1]] !== undefined ? { "-2": "0.50", "-3": "2.00", "-5": "", "-6": "C X M1", "-8": "" }[op[1]] : "1.00"), carrier ? CHROME3 : c, 0, 36);
  }
  // the feedback loop round the first modulator, as thick as it feeds
  var m1 = w.ops[0];
  if (P.fb > 0.005) g.arc(x0 + m1[2], y0 + m1[3] - 13, 7, Math.PI * 0.9, Math.PI * 1.2, 1 + P.fb * 3, PINK);
}
function padScreen(i) {
  return function (g, v) {
    var P = patchOf(v, i), c = MCOL[P.model], t = v.$touched || "", pg = v.$page || 0, age = strikes(v)[i - 1], on = age >= 0 && age < 0.15;
    var p = function (s) { return pk(i, s); }, th = function (arr) { for (var j = 0; j < arr.length; j++) if (t === p(arr[j])) return true; return false; };
    g.fill(0, 0, 3, g.h, c);
    // the operators
    g.text(8, 10, upper(MODELS[P.model]) + (P.pad === 0 && P.model < 4 ? " (KICK)" : ""), th(["model"]) ? "slot" : (on ? c : "fg"), -1);
    g.text(214, 10, "METAL " + Math.round(P.metal * 100) + "%", th(["metal", "color", "feedback"]) ? "slot" : "dim", 1);
    opsDiagram(g, v, i, P, 4, 10, th(["color", "metal", "feedback"]));
    // the spectrum: the strike bright, the sound once the metal has settled behind it
    var sx = 232, sw = 250, sh = 58, sy = 16;
    g.fill(sx - 8, 4, 1, 78, RULE);
    g.text(sx, 10, "PARTIALS  " + Math.round(baseHz(P)) + " HZ  " + val(v, p("tune")).join(" "), th(["tune"]) ? "slot" : "dim", -1, sw);
    for (var dd = 1; dd < 3; dd++) g.fill(sx + sw * dd / 3, sy, 1, sh, LATEX2);
    g.fill(sx, sy + sh, sw, 1, RULE);
    g.poly(cached("sb|" + i + "|" + pkey(P), function () { return spectrumPts(P, 0, 6, sx, sy, sw, sh); }), 1.5, CHROME3);
    g.poly(cached("sa|" + i + "|" + pkey(P), function () { return spectrumPts(P, 1, 6, sx, sy, sw, sh); }), 1.5, th(["color", "metal", "feedback", "model"]) ? "slot" : c);
    if (P.model === 3) g.text(sx + 4, 24, "+ NOISE", c, -1);
    var dc = P.drive > 0.005 ? "DRIVE " + Math.round(P.drive * 100) + "%" : "", cr = P.crush > 0.005 ? "CRUSH " + Math.round(P.crush * 100) + "%" : "";
    g.text(sx + sw, 24, [dc, cr].join("  "), th(["drive", "crush"]) ? "slot" : "dim", 1);
    var md = num(v, p("metal_decay"), 0);
    g.text(sx, 84, "STRIKE", c, -1);
    g.text(sx + 50, 84, "SETTLED " + (md > 0 ? "IN " + Math.round(md) + " MS" : (P.model >= 4 ? "IN 135 MS" : "AS THE PITCH")), th(["metal_decay"]) ? "slot" : CHROME2, -1);
    // the decay, as an envelope that falls to silence in its time
    var ex = 494;
    g.fill(ex - 6, 4, 1, 78, RULE);
    g.text(ex, 10, "DECAY " + val(v, p("decay")).join(" "), th(["decay"]) ? "slot" : (pg === 0 ? "dim" : "faint"), -1);
    g.envelope(ex - 4, 14, 140, 72, { attack: 0, decay: p("decay"), color: c, still: true });
    // the filter, last in the pad's chain
    var fx = 650, ft = filtOf(v, i), cut = num(v, p("cutoff"), 100), hz = 40 * Math.pow(400, cut / 100);
    g.fill(fx - 6, 4, 1, 78, RULE);
    var tn = ft === 3 ? (cut < 50 ? "LP 12 dB" : "HP") : ["LP 12 dB", "HP", "Notch", "", "BandPass"][ft];
    g.text(fx, 10, FILT[ft].toUpperCase() + " " + val(v, p("cutoff")).join(" "), th(["cutoff", "resonance", "filter_type"]) ? "slot" : (pg === 1 ? "fg" : "dim"), -1);
    g.filter(fx - 4, 14, 160, 72, { cutoff: p("cutoff"), at: Math.max(0, Math.min(1, Math.log(hz / 20) / Math.LN10 / 3)), resonance: p("resonance"), type: tn, color: c });
    // the ring: a comb at its time, each tooth a repeat, falling by its feedback
    var rx = 820, rm = num(v, p("ring_mix"), 0), rt = num(v, p("ring_time"), 6), rf = num(v, p("ring_feedback"), 0) / 100;
    g.fill(rx - 6, 4, 1, 78, RULE);
    g.text(rx, 10, rm > 0.5 ? "RING " + rt.toFixed(1) + " MS" : "RING OFF", th(["ring_time", "ring_feedback", "ring_mix", "ring_tone"]) ? "slot" : (pg === 2 ? "fg" : (rm > 0.5 ? "dim" : "faint")), -1);
    var tw = 124, a = 1, tx = 0, span = 40, step = rt / span * tw;
    g.fill(rx, 76, tw, 1, RULE);
    for (var n = 0; n < 40 && tx <= tw && a > 0.02; n++) {
      var hh = Math.max(2, 52 * a * (n ? rm / 100 : 1));
      g.fill(rx + tx, 76 - hh, 2, hh, n ? (th(["ring_time", "ring_feedback", "ring_mix"]) ? "slot" : c) : CHROME2);
      if (!n) a = 1; else a *= rf;
      tx += Math.max(3, step);
      if (rm < 0.5) break;
    }
    g.text(rx, 86, rm > 0.5 ? "MIX " + Math.round(rm) + "%  FDBK " + Math.round(rf * 100) + "%" : "", "dim", -1);
  };
}
for (var pn = 1; pn <= 16; pn++) {
  push.compartment({
    id: "pad" + pn, label: pn + " " + NAMES[pn - 1].charAt(0) + NAMES[pn - 1].slice(1).toLowerCase(),
    pages: [
      { label: "Main", keys: [pk(pn, "model"), pk(pn, "tune"), pk(pn, "color"), pk(pn, "metal"), pk(pn, "feedback"), pk(pn, "sweep"), pk(pn, "decay"), pk(pn, "level")] },
      { label: "Shape", keys: [pk(pn, "drive"), pk(pn, "crush"), pk(pn, "cutoff"), pk(pn, "resonance"), pk(pn, "filter_type"), pk(pn, "metal_decay"), pk(pn, "feedback_mode"), pk(pn, "tail_mode")] },
      { label: "Ring", keys: [pk(pn, "ring_time"), pk(pn, "ring_feedback"), pk(pn, "ring_mix"), pk(pn, "ring_tone")] }
    ],
    screen: padScreen(pn)
  });
}
