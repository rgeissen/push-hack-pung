// Dexed (DX7) on the Push. Dexed has no web panel of its own, so this is a
// new design (docs/UX-GUIDELINES.md, 5), in the DX7's own terms and on its
// own face: a dark brown chassis, functions printed on coloured bands over
// flat membrane keys, the red LED and the green-grey LCD.
//
// - Algorithm (front panel): the voice number in the LED, the name in the
//   LCD (the parameter being turned under it), the cartridge's 32 voices as
//   membrane keys, the algorithm as the DX7 prints it (six operators,
//   modulators stacked over carriers, the feedback loop; each operator with
//   its frequency ratio and output level), all six operator envelopes. The
//   encoders, as membrane keys under their bands: algorithm, feedback and
//   the six levels -- the FM patch's shape under the hands.
// - LFO (band screen): the wave by its name (the knob says a number), Pung's
//   LFO at its speed, its delay and key sync, pitch modulation (depth and
//   sensitivity: every operator alike) and amplitude modulation, which
//   reaches only the operators whose AMS lets it in.
// - Each operator's frequency page: the ratio (or fixed frequency) as the DX
//   writes it, not its coarse and fine parts; detune about its centre; where
//   the operator sits in the algorithm and what it feeds.
// - Every 4-rate / 4-level envelope (pitch, and each operator's) is Pung's
//   own envelope, the picture every module's envelopes get
//   (docs/UX-GUIDELINES.md, "Envelopes"): R1 R2 R3, the plateau where a
//   held key waits at L3, R4 from the let-go, starting from L4 as the DX7
//   does. What only this module knows is how long its stages take:
//   push.envelopeTimes runs msfa's own envelope (env.cc, pitchenv.cc) to
//   tell Pung, so every note's dot runs through them as the engine does.
// - Each operator's keyboard scaling page draws the scaling curve over a
//   keyboard: break point, left and right depth and curve.
//
// The structure comes from Dexed's own algorithm table (msfa fm_core.cc),
// read as the engine reads it, not redrawn by hand.

// a carrier is heard (teal), a modulator shapes what it feeds (amber), the
// feedback loop is its own; the DX's LCD is green-grey
var CARRIER = "#3fcfb0", CARRIER_BAR = "#14463d", MOD = "#f0a040", MOD_BAR = "#4a3214", FBCOL = "#ff6f8f";
var BOX = "#1f1a16", LCD_BG = "#0e211b", LCD_EDGE = "#1f5446", LCD_FG = "#8ff2cf", LCD_DIM = "#4a9680";

function known(v, k) { return v[k] && v[k].known; }
function num(v, k, d) { var n = known(v, k) ? parseFloat(v[k].value) : NaN; return isNaN(n) ? d : n; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function op(n, s) { return "op" + n + "_" + s; }

// ---- the algorithms ------------------------------------------------------------------

// msfa's table: per algorithm, the flags of operators 6..1 (the order the
// engine runs them). Bits: out bus 1|2 (0x01, 0x02), add (0x04), in bus 1|2
// (0x10, 0x20), feedback in (0x40), feedback out (0x80).
var ALGS = [
  [0xc1, 0x11, 0x11, 0x14, 0x01, 0x14], [0x01, 0x11, 0x11, 0x14, 0xc1, 0x14], [0xc1, 0x11, 0x14, 0x01, 0x11, 0x14],
  [0xc1, 0x11, 0x94, 0x01, 0x11, 0x14], [0xc1, 0x14, 0x01, 0x14, 0x01, 0x14], [0xc1, 0x94, 0x01, 0x14, 0x01, 0x14],
  [0xc1, 0x11, 0x05, 0x14, 0x01, 0x14], [0x01, 0x11, 0xc5, 0x14, 0x01, 0x14], [0x01, 0x11, 0x05, 0x14, 0xc1, 0x14],
  [0x01, 0x05, 0x14, 0xc1, 0x11, 0x14], [0xc1, 0x05, 0x14, 0x01, 0x11, 0x14], [0x01, 0x05, 0x05, 0x14, 0xc1, 0x14],
  [0xc1, 0x05, 0x05, 0x14, 0x01, 0x14], [0xc1, 0x05, 0x11, 0x14, 0x01, 0x14], [0x01, 0x05, 0x11, 0x14, 0xc1, 0x14],
  [0xc1, 0x11, 0x02, 0x25, 0x05, 0x14], [0x01, 0x11, 0x02, 0x25, 0xc5, 0x14], [0x01, 0x11, 0x11, 0xc5, 0x05, 0x14],
  [0xc1, 0x14, 0x14, 0x01, 0x11, 0x14], [0x01, 0x05, 0x14, 0xc1, 0x14, 0x14], [0x01, 0x14, 0x14, 0xc1, 0x14, 0x14],
  [0xc1, 0x14, 0x14, 0x14, 0x01, 0x14], [0xc1, 0x14, 0x14, 0x01, 0x14, 0x04], [0xc1, 0x14, 0x14, 0x14, 0x04, 0x04],
  [0xc1, 0x14, 0x14, 0x04, 0x04, 0x04], [0xc1, 0x05, 0x14, 0x01, 0x14, 0x04], [0x01, 0x05, 0x14, 0xc1, 0x14, 0x04],
  [0x04, 0xc1, 0x11, 0x14, 0x01, 0x14], [0xc1, 0x14, 0x01, 0x14, 0x04, 0x04], [0x04, 0xc1, 0x11, 0x14, 0x04, 0x04],
  [0xc1, 0x14, 0x04, 0x04, 0x04, 0x04], [0xc4, 0x04, 0x04, 0x04, 0x04, 0x04]
];

// graph: who modulates whom, the carriers, the feedback loop; and where each
// operator is drawn (column, row). Worked out once per algorithm.
var graphs = {};
function graph(a) {
  if (graphs[a]) return graphs[a];
  var t = ALGS[a - 1], bus = { 1: [], 2: [] }, mods = {}, targets = {}, carriers = [], fbIn = 0, fbOut = 0, j, o;
  for (o = 1; o <= 6; o++) targets[o] = [];
  for (j = 0; j < 6; j++) {
    var f = t[j], n = 6 - j, inb = f & 0x10 ? 1 : f & 0x20 ? 2 : 0, outb = f & 3, add = f & 4;
    mods[n] = inb ? bus[inb].slice() : [];
    mods[n].forEach(function (m) { targets[m].push(n); });
    if (!outb) { if (add) carriers.push(n); } else if (add) bus[outb].push(n); else bus[outb] = [n];
    if (f & 0x40) fbIn = n;
    if (f & 0x80) fbOut = n;
  }
  carriers.sort();
  // rows: a carrier is 0, a modulator one above the highest it modulates
  var row = {};
  for (var pass = 0; pass < 6; pass++) {
    for (o = 1; o <= 6; o++) {
      row[o] = carriers.indexOf(o) >= 0 ? 0 : 1 + Math.max.apply(null, targets[o].map(function (x) { return row[x] || 0; }).concat([0]));
    }
  }
  // columns: carriers left to right, each with its own stack above it; a
  // modulator of several sits over the middle of them
  var col = {}, next = 0;
  function place(n) {
    if (col[n] !== undefined) return;
    var own = mods[n].filter(function (m) { return targets[m].length === 1; }).sort(function (x, y) { return y - x; });
    if (!own.length) { col[n] = next++; return; }
    own.forEach(place);
    col[n] = own.reduce(function (s, m) { return s + col[m]; }, 0) / own.length;
  }
  carriers.forEach(place);
  for (o = 1; o <= 6; o++) {
    if (col[o] === undefined && targets[o].length) {
      col[o] = targets[o].reduce(function (s, x) { return s + (col[x] || 0); }, 0) / targets[o].length;
      mods[o].forEach(function (m) { if (col[m] === undefined) col[m] = col[o]; });
    }
  }
  return (graphs[a] = { mods: mods, carriers: carriers, fbIn: fbIn, fbOut: fbOut, row: row, col: col, cols: Math.max(next, 1) });
}

function ratio(v, n) {
  if (!known(v, op(n, "coarse")) || !known(v, op(n, "fine"))) return "--";
  var c = num(v, op(n, "coarse"), 1), f = num(v, op(n, "fine"), 0);
  if (num(v, op(n, "osc_mode"), 0) >= 1) { // fixed frequency
    var hz = Math.pow(10, (c % 4) + f / 100);
    return hz >= 1000 ? (hz / 1000).toFixed(1) + "K" : hz.toFixed(hz < 10 ? 1 : 0) + "HZ";
  }
  return ((c === 0 ? 0.5 : c) * (1 + f / 100)).toFixed(2);
}

// the algorithm as the DX prints it: modulators stacked over the carriers
// they feed, the carriers on the output line, the feedback loop. Each box
// filled to its operator's output level, its frequency ratio inside. With
// focus (an operator's own page) that operator stands out, the rest are
// drawn as outlines: where it sits is the point there.
function algorithmDiagram(g, v, x0, x1, top, bottom, focus) {
  var a = Math.max(1, Math.min(32, Math.round(num(v, "algorithm", 1)))), G = graph(a), t = v.$touched || "";
  // as large as the algorithm's depth allows: rows of up to 30 px
  var rows = 1, o;
  for (o = 1; o <= 6; o++) rows = Math.max(rows, G.row[o] + 1);
  var rs = Math.min(30, Math.floor((bottom - top - 4) / rows)), bh = Math.max(11, rs - 7);
  var step = Math.min(96, (x1 - x0) / G.cols), bw = Math.min(76, Math.floor(step) - 8);
  var ox = x0 + ((x1 - x0) - step * (G.cols - 1)) / 2;
  var pos = {};
  for (o = 1; o <= 6; o++) pos[o] = { x: Math.round(ox + G.col[o] * step - bw / 2), y: Math.round(bottom - 4 - rs - G.row[o] * rs + 8) };
  if (!known(v, "algorithm")) focus = -1; // no algorithm yet: its shape, faded, nothing in it
  var faded = function (n) { return focus && n !== focus; };
  // wires: modulator to what it modulates, carriers to the output
  for (o = 1; o <= 6; o++) {
    G.mods[o].forEach(function (m) {
      g.line(pos[m].x + bw / 2, pos[m].y + bh, pos[o].x + bw / 2, pos[o].y, 1.5, faded(m) ? MOD_BAR : MOD);
    });
  }
  var lo = 1e9, hi = -1e9;
  G.carriers.forEach(function (c) {
    var cx = pos[c].x + bw / 2;
    g.line(cx, pos[c].y + bh, cx, bottom, 2, faded(c) ? CARRIER_BAR : CARRIER);
    lo = Math.min(lo, cx); hi = Math.max(hi, cx);
  });
  g.line(lo - 8, bottom, hi + 8, bottom, 2, focus ? CARRIER_BAR : CARRIER);
  // feedback: from the operator that sends it, round to the one that takes it
  if (G.fbIn && G.fbOut) {
    var fo = pos[G.fbOut], fi = pos[G.fbIn], rx = Math.max(fo.x, fi.x) + bw + 6;
    var fb = num(v, "feedback", 0), fcol = t === "feedback" ? "slot" : fb > 0 ? FBCOL : "faint";
    if (focus && G.fbIn !== focus) fcol = "faint";
    g.poly([[fo.x + bw, fo.y + bh / 2], [rx, fo.y + bh / 2], [rx, fi.y - 5], [fi.x + bw / 2, fi.y - 5], [fi.x + bw / 2, fi.y]], t === "feedback" ? 2.5 : 2, fcol);
  }
  // the operators: level as the box's fill, ratio inside, coloured by role
  for (o = 1; o <= 6; o++) {
    var p = pos[o], hot = t.indexOf("op" + o + "_") === 0, carrier = G.carriers.indexOf(o) >= 0;
    var lv = fr(v, op(o, "level"), 0), role = carrier ? CARRIER : MOD, bar = carrier ? CARRIER_BAR : MOD_BAR;
    if (faded(o)) {
      g.fill(p.x, p.y, bw, bh, bar);
      g.fill(p.x + 1, p.y + 1, bw - 2, bh - 2, BOX);
      g.text(p.x + 6, p.y + bh / 2 + 5, String(o), bar === MOD_BAR ? "#8a6a3a" : "#3f8f78", -1);
      continue;
    }
    g.fill(p.x - 1, p.y - 1, bw + 2, bh + 2, hot ? "slot" : role);
    g.fill(p.x + 1, p.y + 1, bw - 2, bh - 2, BOX);
    g.fill(p.x + 1, p.y + 1, Math.round((bw - 2) * lv), bh - 2, bar);
    g.text(p.x + 6, p.y + bh / 2 + 5, String(o), hot ? "slot" : role, -1);
    if (bw >= 54) g.text(p.x + bw - 5, p.y + bh / 2 + 5, ratio(v, o), "fg", 1);
  }
  return a;
}

// ---- the DX envelope: 4 rates, 4 levels ------------------------------------------------

function egKeys(prefix) { // R1 L1 R2 L2 R3 L3 R4 L4: each stage over its two knobs
  var out = [];
  for (var i = 1; i <= 4; i++) out.push(prefix + "r" + i, prefix + "l" + i);
  return out;
}

// ---- the DX's own times: msfa's envelope, run here ----------------------------------
// env.cc (built with ACCURATE_ENVELOPE, as the module is): a level is a
// log-amplitude in 1/65536ths; a falling stage steps down by inc per 64
// samples, a rising one approaches 17<<24 exponentially from 1716<<16; a
// stage that does not move (or an attack to level 0) waits a fixed time.
var LEVELLUT = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46];
var STATICS = [1764000, 1764000, 1411200, 1411200, 1190700, 1014300, 992250, 882000, 705600, 705600, 584325, 507150,
  502740, 441000, 418950, 352800, 308700, 286650, 253575, 220500, 220500, 176400, 145530, 145530, 125685, 110250,
  110250, 88200, 88200, 74970, 61740, 61740, 55125, 48510, 44100, 37485, 31311, 30870, 27562, 27562, 22050, 18522,
  17640, 15435, 14112, 13230, 11025, 9261, 9261, 7717, 6615, 6615, 5512, 5512, 4410, 3969, 3969, 3439, 2866, 2690,
  2249, 1984, 1896, 1808, 1411, 1367, 1234, 1146, 926, 837, 837, 705, 573, 573, 529, 441, 441];
var SR = 44100, BLOCK = 64, U16 = 65536, U24 = 16777216, CEIL = 17 * U24;
function scaleOut(l) { l = Math.max(0, Math.min(99, Math.round(l))); return l >= 20 ? 28 + l : LEVELLUT[l]; }
function ampLevel(l, outlevel) { return Math.max(16, (scaleOut(l) >> 1) * 64 + outlevel - 4256) * U16; }
function ampInc(rate) { var q = Math.min(63, (Math.round(rate) * 41) >> 6); return (4 + (q & 3)) * Math.pow(2, 2 + 6 + (q >> 2)); }
// seconds for one amp stage, from level `from` (internal units) to level l at rate
function ampStage(from, l, rate, outlevel, first) {
  var to = ampLevel(l, outlevel), r = Math.max(0, Math.min(99, Math.round(rate)));
  if (to === from || (first && Math.round(l) === 0)) {
    var c = r < 77 ? STATICS[r] : 20 * (99 - r);
    if (r < 77 && first && Math.round(l) === 0) c /= 20;
    return { secs: c / SR, level: from };
  }
  var inc = ampInc(r), blocks = 0, lv = from;
  if (to < lv) return { secs: Math.ceil((lv - to) / inc) * BLOCK / SR, level: to };
  lv = Math.max(lv, 1716 * U16);
  while (lv < to) { // the step is constant between the multiplier's steps: whole runs at once
    var m = Math.floor((CEIL - lv) / U24);
    if (m <= 0) break;
    var edge = Math.min(to, CEIL - m * U24 + 1), n = Math.max(1, Math.ceil((edge - lv) / (m * inc)));
    lv += n * m * inc;
    blocks += n;
  }
  return { secs: blocks * BLOCK / SR, level: to };
}
// pitchenv.cc: linear, a rate table, 21.3 s at the slowest unit
var PRATE = [1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 16, 16, 17, 18, 18,
  19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 33, 34, 36, 37, 38, 39, 41, 42, 44, 46, 47, 49, 51, 53, 54, 56, 58,
  60, 62, 64, 66, 68, 70, 72, 74, 76, 79, 82, 85, 88, 91, 94, 98, 102, 106, 110, 115, 120, 125, 130, 135, 141, 147, 153,
  159, 165, 171, 178, 185, 193, 202, 211, 232, 243, 254, 255];
var PTAB = [-128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43, -41, -39, -37, -35, -33, -32, -31, -30,
  -29, -28, -27, -26, -25, -24, -23, -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5,
  -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 38, 40, 43, 46, 49, 53, 58, 65, 73, 82, 92, 103, 115, 127];
var PUNIT = Math.floor(BLOCK * U24 / (21.3 * SR) + 0.5);
function pitchStage(fromL, l, rate) {
  var a = PTAB[Math.max(0, Math.min(99, Math.round(fromL)))] * 524288, b = PTAB[Math.max(0, Math.min(99, Math.round(l)))] * 524288;
  var inc = PRATE[Math.max(0, Math.min(99, Math.round(rate)))] * PUNIT;
  return Math.ceil(Math.abs(b - a) / inc) * BLOCK / SR;
}

var timesMemo = {};
push.envelopeTimes(function (env) {
  var st = env.stages, R = [], L = [], seg = [], i;
  for (i = 0; i < st.length; i++) {
    var m = /^rate([1-4])$/.exec(st[i].role);
    if (m) { seg[+m[1] - 1] = i; R[+m[1] - 1] = st[i].raw; L[+m[1] - 1] = st[i].level; }
  }
  if (R.length !== 4 || R.concat(L).some(function (x) { return x === null || x === undefined; })) return null;
  var key = st[seg[0]].key, op = /^op([1-6])_eg_/.exec(key), outlevel = 127 * 32;
  if (op) { // the operator's output level sets where its levels sit, and so its attack's pace
    var ol = env.value("op" + op[1] + "_level");
    if (ol !== null) outlevel = Math.min(127, scaleOut(ol)) * 32;
  }
  var memo = (op ? "a" + outlevel : "p") + ":" + R.join(",") + ":" + L.join(",");
  if (timesMemo[memo]) return timesMemo[memo];
  var secs = st.map(function () { return null; });
  if (op) {
    var lv = 0;
    for (i = 0; i < 3; i++) { var r = ampStage(lv, L[i], R[i], outlevel, i === 0); secs[seg[i]] = r.secs; lv = r.level; }
    secs[seg[3]] = ampStage(ampLevel(L[2], outlevel), L[3], R[3], outlevel, false).secs;
  } else {
    var from = L[3];
    for (i = 0; i < 3; i++) { secs[seg[i]] = pitchStage(from, L[i], R[i]); from = L[i]; }
    secs[seg[3]] = pitchStage(L[2], L[3], R[3]);
  }
  timesMemo[memo] = secs;
  return secs;
});


// ---- the DX's panel: its colours, its displays, its membrane keys ----------------------------
//
// A dark brown chassis; the functions printed on coloured bands over flat
// membrane keys; a red two-digit LED for the voice number beside a
// green-grey LCD; one data-entry slider for whatever is selected.

var CHASSIS = "#15110e", PRINT = "#e6dcc4", PRINT_DIM = "#968c78", MAROON = "#5c2130", MAROON_INK = "#f0b7c0";
var KEY = "#29231e", KEY_EDGE = "#40372f", GROOVE = "#0a0807";
var LED_ON = "#ff3322", LED_OFF = "#2c0f0b";

// a band printed on the panel with a function's name on it
function band(g, x, y, w, s, col, ink, align) {
  g.fill(x, y, w, 13, col);
  g.text(align < 0 ? x + 6 : x + w / 2, y + 10, s, ink, align < 0 ? -1 : 0, w - 8);
}

// the red LED's seven segments (a..g), lit for a digit
var SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
function segments(g, x, y, w, h, bits, col) {
  var t = 4, m = Math.round(h / 2);
  var r = [[x + t, y, w - 2 * t, t], [x + w - t, y + t, t, m - t - 1], [x + w - t, y + m + 1, t, h - m - t - 1],
    [x + t, y + h - t, w - 2 * t, t], [x, y + m + 1, t, h - m - t - 1], [x, y + t, t, m - t - 1], [x + t, y + m - t / 2, w - 2 * t, t]];
  for (var s = 0; s < 7; s++) if (bits & (1 << s)) g.fill(r[s][0], r[s][1], r[s][2], r[s][3], col);
}

// ---- keyboard level scaling --------------------------------------------------------------

var CURVES = ["-LIN", "-EXP", "+EXP", "+LIN"];
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function kbdScreen(n) {
  return function (g, v) {
    var t = v.$touched || "", W = g.w, kTop = 64, kBot = 86, mid = 34, amp = 26;
    g.fill(0, 0, W, g.h, CHASSIS);
    // 88 keys, A-1 to C7 (DX7: break point 0 = A-1, 39 = C3): white keys,
    // the black ones over them
    var first = 21, last = 108, i, isBlack = function (nt) { return [1, 3, 6, 8, 10].indexOf(nt % 12) >= 0; };
    var whites = 0;
    for (i = first; i <= last; i++) if (!isBlack(i)) whites++;
    var ww = W / whites, keyX = {}, wi = 0;
    for (i = first; i <= last; i++) {
      if (!isBlack(i)) { keyX[i] = (wi + 0.5) * ww; g.fill(Math.round(wi * ww), kTop, Math.max(1, Math.round(ww) - 1), kBot - kTop, "#8f877a"); wi++; }
      else keyX[i] = wi * ww;
    }
    for (i = first; i <= last; i++) if (isBlack(i)) g.fill(Math.round(keyX[i] - ww * 0.3), kTop, Math.max(1, Math.round(ww * 0.6)), 13, CHASSIS);
    var bpNote = first + Math.max(0, Math.min(99, Math.round(num(v, op(n, "key_bp"), 39)))), bx = keyX[Math.min(last, bpNote)];
    var shape = function (c, d) { // c: curve index, d: 0..1 away from the break point
      var e = c === 1 || c === 2 ? (Math.exp(3 * d) - 1) / (Math.exp(3) - 1) : d;
      return c < 2 ? -e : e;
    };
    var role = opRole(v, n);
    var side = function (dir, depthKey, curveKey) {
      var depth = fr(v, op(n, depthKey), 0), c = Math.max(0, Math.min(3, Math.round(num(v, op(n, curveKey), 0)))), pts = [], end = dir < 0 ? 0 : W;
      for (var s = 0; s <= 24; s++) {
        var x = bx + (end - bx) * s / 24, dd = Math.abs(x - bx) / Math.max(1, Math.abs(end - bx));
        pts.push([x, mid - shape(c, dd) * depth * amp]);
      }
      var hot = t === op(n, depthKey) || t === op(n, curveKey);
      g.poly(pts, hot ? 3.5 : 2, hot ? "slot" : role.col);
      var lbl = (dir < 0 ? "L " : "R ") + CURVES[c] + " " + Math.round(depth * 99);
      var lx = dir < 0 ? (bx < 90 ? bx + 8 : 6) : (bx > W - 90 ? bx - 8 : W - 6);
      g.text(lx, 12, lbl, hot ? "slot" : PRINT_DIM, dir < 0 ? -1 : 1);
    };
    g.line(0, mid, W, mid, 1, KEY_EDGE);
    side(-1, "key_ld", "key_lc");
    side(1, "key_rd", "key_rc");
    var bhot = t === op(n, "key_bp");
    if (!known(v, op(n, "key_bp"))) { g.text(W / 2, 12, "OP " + n + "  " + role.name, PRINT_DIM, 0); return; }
    g.line(bx, 4, bx, kBot, bhot ? 3 : 1.5, bhot ? "slot" : PRINT);
    var bn = NOTE[bpNote % 12] + (Math.floor(bpNote / 12) - 2), bw = g.measure(bn) + 10, tx = Math.max(bw / 2, Math.min(W - bw / 2, bx));
    g.fill(tx - bw / 2, kTop - 15, bw, 13, bhot ? "slot" : MAROON);
    g.text(tx, kTop - 5, bn, bhot ? "black" : MAROON_INK, 0);
    g.text(W / 2, 12, "OP " + n + "  " + role.name, PRINT_DIM, 0);
  };
}

// an operator's role in the algorithm: a carrier is heard, a modulator shapes
// (neutral until the algorithm is read)
function opRole(v, n) {
  var a = Math.max(1, Math.min(32, Math.round(num(v, "algorithm", 1)))), G = graph(a);
  if (!known(v, "algorithm")) return { carrier: false, col: PRINT_DIM, bar: KEY_EDGE, name: "", G: G, unknown: true };
  var carrier = G.carriers.indexOf(n) >= 0;
  return { carrier: carrier, col: carrier ? CARRIER : MOD, bar: carrier ? CARRIER_BAR : MOD_BAR, name: carrier ? "CARRIER" : "MODULATOR", G: G };
}

// ---- an operator's frequency page ---------------------------------------------------------
// The DX states an operator's frequency as a ratio to the key (coarse x
// (1 + fine/100)) or, fixed, in Hz; its LCD shows the one number, not its
// parts. Over coarse and fine: that number. Over the rest: the operator's
// place in the algorithm, what it feeds.

function opScreen(n) {
  return function (g, v) {
    var t = v.$touched || "", role = opRole(v, n), G = role.G, W = g.w;
    g.fill(0, 0, W, g.h, CHASSIS);
    // over level: how loud, in the role's colour
    var lv = fr(v, op(n, "level"), 0), lhot = t === op(n, "level");
    band(g, 4, 4, 112, "OP " + n + " " + role.name, role.bar, role.col, 0);
    g.fill(14, 30, 92, 40, KEY);
    g.fill(14, 30 + Math.round(40 * (1 - lv)), 92, Math.round(40 * lv), lhot ? "slot" : role.bar);
    g.value(60, 58, known(v, op(n, "level")) ? String(num(v, op(n, "level"), 0)) : "--", lhot ? "slot" : PRINT, 0);
    g.text(60, 82, role.unknown ? "" : role.carrier ? "TO THE OUTPUT" : "INTO " + targets(G, n), PRINT_DIM, 0, 112);
    // over coarse and fine: the frequency, as the LCD writes it
    var fixed = num(v, op(n, "osc_mode"), 0) >= 1, fhot = t === op(n, "coarse") || t === op(n, "fine") || t === op(n, "osc_mode");
    g.fill(128, 4, 224, 70, LCD_EDGE);
    g.fill(130, 6, 220, 66, LCD_BG);
    g.text(140, 22, fixed ? "FIXED FREQUENCY" : "FREQUENCY RATIO", LCD_DIM, -1);
    var fq = ratio(v, n);
    g.value(240, 56, fixed || fq === "--" ? fq : "x " + fq, fhot ? "slot" : LCD_FG, 0);
    // over detune: -7..+7 about the centre
    var dt = Math.round(num(v, op(n, "detune"), 0)), dhot = t === op(n, "detune");
    g.fill(372, 40, 96, 2, KEY_EDGE);
    for (var d = -7; d <= 7; d++) g.fill(420 + d * 6, d ? 37 : 33, 1, d ? 8 : 12, d ? KEY_EDGE : PRINT_DIM);
    var dk = known(v, op(n, "detune"));
    if (dk) g.fill(420 + dt * 6 - 3, 30, 6, 18, dhot ? "slot" : PRINT);
    g.text(420, 22, "DETUNE", PRINT_DIM, 0);
    g.value(420, 72, dk ? (dt > 0 ? "+" : "") + dt : "--", dhot ? "slot" : PRINT, 0);
    // over the rest: where it sits in the algorithm
    algorithmDiagram(g, v, 488, W - 16, 4, g.h - 4, n);
  };
}
function targets(G, n) {
  var out = [];
  for (var o = 1; o <= 6; o++) if (G.mods[o].indexOf(n) >= 0) out.push(o);
  return out.length ? "OP " + out.join(" ") : "--";
}

// ---- LFO -----------------------------------------------------------------------------
// The DX's LFO by its own names (the knob says a number), Pung's LFO picture
// (it flashes as a note restarts it when Key Sync is on), its delay, and
// where it goes: pitch (depth x sensitivity, every operator alike) and
// amplitude, which reaches only the operators whose AMS lets it in.

var LFO_WAVES = ["Triangle", "Saw Down", "Saw Up", "Square", "Sine", "S&H"];

// how the DX's bare numbers read wherever Pung writes them (its pages, the
// row under a screen, the LCD here): by the names the DX7 gives them
push.display(function (key, raw) {
  var n = Math.round(parseFloat(raw));
  if (isNaN(n)) return;
  if (key === "preset") return String(n + 1); // the DX counts its voices 1..32
  if (key === "lfo_wave") return ["Triangle", "Saw Down", "Saw Up", "Square", "Sine", "S/Hold"][n];
  if (key === "lfo_sync" || key === "osc_sync") return n ? "On" : "Off";
  if (key === "transpose") return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) + 1); // 24 = C3
  if (key === "octave_transpose") return (n > 0 ? "+" : "") + n;
  var m = /^op[1-6]_(.*)$/.exec(key), s = m ? m[1] : "";
  if (s === "osc_mode") return n ? "Fixed" : "Ratio";
  if (s === "key_lc" || s === "key_rc") return CURVES[n];
  if (s === "key_bp") { var nt = 21 + n; return NOTE[nt % 12] + (Math.floor(nt / 12) - 2); } // 39 = C3
  if (s === "detune") return (n > 0 ? "+" : "") + n;
});

function lfoScreen(g, v) {
  var t = v.$touched || "", W = g.w;
  g.fill(0, 0, W, g.h, CHASSIS);
  var wi = Math.round(num(v, "lfo_wave", 0)), wname = LFO_WAVES[wi] || "";
  // cols 1-2: the wave, at its speed
  band(g, 4, 4, 232, "LFO  " + (known(v, "lfo_wave") ? wname.toUpperCase() : "--"), MAROON, t === "lfo_wave" ? "slot" : MAROON_INK, -1);
  g.lfo(0, 18, 240, 68, { shape: wname || "Sine", rate: "lfo_speed", trig: "lfo_sync", color: PRINT });
  // col 3: the delay before it comes in; col 4: key sync
  var dl = fr(v, "lfo_delay", 0), dhot = t === "lfo_delay";
  band(g, 244, 4, 112, "DELAY", MAROON, dhot ? "slot" : MAROON_INK, 0);
  g.fill(254, 50, 92, 2, KEY_EDGE);
  g.fill(254, 46, Math.round(92 * dl), 10, dhot ? "slot" : PRINT_DIM);
  g.text(300, 76, dl > 0 ? "AFTER " + Math.round(dl * 99) : "AT ONCE", PRINT_DIM, 0);
  var sync = num(v, "lfo_sync", 0) >= 1, shot = t === "lfo_sync";
  band(g, 364, 4, 112, "KEY SYNC", MAROON, shot ? "slot" : MAROON_INK, 0);
  g.dot(420, 46, 5, sync ? LED_ON : LED_OFF);
  g.text(420, 76, sync ? "EACH NOTE" : "FREE", PRINT_DIM, 0);
  // cols 5-6: pitch, its depth over depth's knob, its sensitivity over
  // sensitivity's: every operator alike
  var pmd = Math.round(num(v, "lfo_pmd", 0)), pms = Math.round(num(v, "lfo_pms", 0));
  var mhot = t === "lfo_pmd", shot2 = t === "lfo_pms";
  band(g, 484, 4, 232, "PITCH MOD", MAROON, mhot || shot2 ? "slot" : MAROON_INK, 0);
  ladder(g, 494, 30, 92, 10, Math.round(pmd / 9.9 + (pmd > 0 ? 0.49 : 0)), mhot, PRINT);
  g.text(540, 62, "DEPTH " + (known(v, "lfo_pmd") ? pmd : "--"), mhot ? "slot" : PRINT_DIM, 0);
  ladder(g, 614, 30, 92, 7, pms, shot2, PRINT);
  g.text(660, 62, "SENS " + (known(v, "lfo_pms") ? pms : "--"), shot2 ? "slot" : PRINT_DIM, 0);
  g.text(600, 82, pmd && pms ? "VIBRATO ON EVERY OPERATOR" : "NO VIBRATO", PRINT_DIM, 0);
  // cols 7-8: amplitude, to the operators that take it (AMS 0..3)
  var amd = fr(v, "lfo_amd", 0), ahot = t === "lfo_amd", a = Math.max(1, Math.min(32, Math.round(num(v, "algorithm", 1)))), G = graph(a);
  band(g, 724, 4, 228, "AMP MOD  " + (known(v, "lfo_amd") ? Math.round(amd * 99) : "--"), MAROON, ahot ? "slot" : MAROON_INK, 0);
  for (var o = 1; o <= 6; o++) {
    var x = 732 + (o - 1) * 36, ams = Math.round(num(v, op(o, "amp_mod"), 0)), rl = opRole(v, o);
    var col = rl.col, reach = amd * ams / 3;
    g.fill(x, 24, 28, 14, ams ? col : KEY_EDGE);
    g.text(x + 14, 35, String(o), "black", 0);
    for (var s = 0; s < 3; s++) g.fill(x + 2, 64 - s * 8, 24, 6, s < ams ? rl.bar : KEY);
    g.fill(x + 2, 72, Math.round(24 * reach), 3, ams && amd > 0 ? col : KEY_EDGE);
  }
  g.text(838, 84, "AMS PER OPERATOR", PRINT_DIM, 0);
}
// a row of n segments, the first lit ones lit (a depth, a sensitivity)
function ladder(g, x, y, w, n, lit, hot, col) {
  var sw = (w + 2) / n;
  for (var i = 0; i < n; i++) g.fill(Math.round(x + i * sw), y, Math.round(sw) - 2, 16, i < lit ? (hot ? "slot" : col) : KEY);
}

// ---- Algorithm: the front panel -----------------------------------------------------------
//
// The DX's own face: the voice number in its red LED, the voice's name in its
// LCD with the parameter being turned under it, the cartridge's 32 voices as
// its membrane keys (the one playing lit), the algorithm as the panel prints
// it (carriers teal, modulators amber, each box filled to its output level,
// ratios inside, the feedback loop), the six operators' envelopes in their
// roles' colours. The encoders as its membrane keys under their printed
// bands: algorithm, feedback and the six levels.

var DISP = { x: 8, y: 6, w: 308, h: 56 }, ALG = { x: 326, y: 4, w: 318, h: 98 }, OPS = { x: 654, y: 4, w: 298, h: 98 };
var VOICE = { x: 8, y: 70, cw: 19.25, ch: 13 };

function ground(g, v) {
  g.fill(0, 0, 960, 160, CHASSIS);
  // the display window: the LED, then the LCD
  g.fill(DISP.x, DISP.y, DISP.w, DISP.h, "#050403");
  for (var d = 0; d < 2; d++) segments(g, DISP.x + 10 + d * 26, DISP.y + 10, 20, 36, 0x7f, LED_OFF);
  g.fill(DISP.x + 66, DISP.y + 4, DISP.w - 70, DISP.h - 8, LCD_BG);
  // the voices' membrane keys
  for (var i = 0; i < 32; i++) {
    var x = Math.round(VOICE.x + (i % 16) * VOICE.cw), y = VOICE.y + Math.floor(i / 16) * (VOICE.ch + 3);
    g.fill(x, y, Math.round(VOICE.cw) - 3, VOICE.ch, KEY);
    g.fill(x, y, Math.round(VOICE.cw) - 3, 1, KEY_EDGE);
  }
  // the sections' printed bands
  band(g, OPS.x, OPS.y, OPS.w, "OPERATOR  EG", MAROON, MAROON_INK, -1);
  // the encoder row: a band and a membrane key per encoder
  var ks = v.$knobs || [], R = keyGeo(v);
  for (var c = 0; c < 8; c++) {
    if (!ks[c] || !v[ks[c]]) continue;
    var kx = c * 120 + 4;
    g.fill(kx, R.ky, 112, R.kh, KEY_EDGE);
    g.fill(kx + 1, R.ky + 1, 110, R.kh - 2, KEY);
    g.fill(kx + 12, R.groove, 88, 2, GROOVE);
  }
}

function display(g, v, a, G) {
  var t = v.$touched || "", lx = DISP.x + 76, r = DISP.x + DISP.w - 10;
  // the LED: the voice's number, 1..32, as the DX shows it
  var vn = known(v, "preset") ? Math.round(num(v, "preset", 0)) + 1 : -1;
  if (vn >= 0) {
    if (vn >= 10) segments(g, DISP.x + 10, DISP.y + 10, 20, 36, SEG[Math.floor(vn / 10) % 10], LED_ON);
    segments(g, DISP.x + 36, DISP.y + 10, 20, 36, SEG[vn % 10], LED_ON);
  } else {
    segments(g, DISP.x + 10, DISP.y + 10, 20, 36, 0x40, LED_ON);
    segments(g, DISP.x + 36, DISP.y + 10, 20, 36, 0x40, LED_ON);
  }
  var name = known(v, "preset_name") ? String(v.preset_name.value).replace(/\s+$/, "").toUpperCase() : "";
  g.value(lx, DISP.y + 26, name || "DEXED", LCD_FG, -1, r - lx);
  if (t && v[t]) { // the second line says what is being turned, as the DX's own LCD does
    var val = known(v, t) ? String(v[t].display || v[t].value) : "--";
    g.text(r, DISP.y + 45, val, LCD_FG, 1);
    g.text(lx, DISP.y + 45, String(v[t].name).toUpperCase(), LCD_FG, -1, r - lx - g.measure(val) - 12);
  } else {
    g.text(lx, DISP.y + 45, "ALG " + (known(v, "algorithm") ? a : "--") + "  FB " + (known(v, "feedback") ? num(v, "feedback", 0) : "--"), LCD_DIM, -1);
    var bank = known(v, "syx_bank_name") ? String(v.syx_bank_name.value).replace(/\.syx$/i, "").toUpperCase() : "";
    if (bank) g.text(r, DISP.y + 45, bank, LCD_DIM, 1, 120);
  }
  // the playing voice among the cartridge's 32
  if (vn >= 1 && vn <= 32) {
    var i = vn - 1, x = Math.round(VOICE.x + (i % 16) * VOICE.cw), y = VOICE.y + Math.floor(i / 16) * (VOICE.ch + 3);
    g.fill(x, y, Math.round(VOICE.cw) - 3, VOICE.ch, PRINT);
  }
}

function operators(g, v, G) {
  var t = v.$touched || "", cw = Math.floor(OPS.w / 3);
  for (var i = 0; i < 6; i++) {
    var n = i + 1, cx = OPS.x + (i % 3) * cw, cy = OPS.y + 18 + Math.floor(i / 3) * 40;
    var role = opRole(v, n).col, hot = t.indexOf("op" + n + "_") === 0 || (v.$segmode === "segment" && v.$segment === "op" + n);
    g.fill(cx, cy + 9, 15, 15, hot ? "slot" : role);
    g.text(cx + 8, cy + 20, String(n), "black", 0);
    g.envelope(cx + 16, cy, cw - 20, 38, { keys: egKeys(op(n, "eg_")), color: role });
  }
}

// the encoders as the DX's membrane keys: the function on its printed band
// (an operator's in its role's colours), the value on the key, and where it
// sits as the data-entry slider would show it
// the membrane keys' lines: the bottom 56 px, or, while segment mode is on,
// the part above Pung's segment names (y 142..160 are Pung's then)
function keyGeo(v) {
  return v.$segmode ? { band: 105, ky: 120, kh: 21, val: 133, groove: 137, cap: 136, capH: 4 }
    : { band: 106, ky: 122, kh: 34, val: 144, groove: 150, cap: 147, capH: 8 };
}

function keys(g, v, G) {
  var ks = v.$knobs || [], t = v.$touched || "", R = keyGeo(v);
  for (var i = 0; i < 8; i++) {
    var k = ks[i];
    if (!k || !v[k]) continue;
    var kx = i * 120 + 4, cx = kx + 56, hot = k === t, ok = known(v, k);
    var m = /^op([1-6])_/.exec(k), rl = m ? opRole(v, +m[1]) : null;
    var bcol = rl ? rl.bar : MAROON, ink = rl ? rl.col : MAROON_INK;
    band(g, kx, R.band, 112, String(v[k].name).toUpperCase(), hot ? "slot" : bcol, hot ? "black" : ink, 0);
    if (hot) { g.fill(kx, R.ky, 112, 2, "slot"); g.fill(kx, R.ky + R.kh - 2, 112, 2, "slot"); g.fill(kx, R.ky, 2, R.kh, "slot"); g.fill(kx + 110, R.ky, 2, R.kh, "slot"); }
    var val = ok ? String(v[k].display || v[k].value) : "--", unit = ok && v[k].unit ? v[k].unit : "";
    g.value(cx, R.val, val + (unit ? " " + unit : ""), hot ? "slot" : PRINT, 0, 104);
    if (ok) {
      var f = Math.max(0, Math.min(1, v[k].frac));
      g.fill(kx + 12, R.groove, Math.round(88 * f), 2, hot ? "slot" : m ? ink : PRINT_DIM);
      g.fill(kx + 10 + Math.round(88 * f), R.cap, 4, R.capH, hot ? "slot" : PRINT);
    }
  }
}

var overviewKeys = ["preset", "preset_name", "syx_bank_name"];
for (var on = 1; on <= 6; on++) {
  ["coarse", "fine", "osc_mode", "eg_r1", "eg_r2", "eg_r3", "eg_r4", "eg_l1", "eg_l2", "eg_l3", "eg_l4"].forEach(function (s) { overviewKeys.push(op(on, s)); });
}

// ---- segments: the DX's own sections under the hands ------------------------------------
// VOICE (its display: which voice, how loud, where it sits), ALGORITHM (the
// diagram: algorithm, feedback and each operator's frequency, the ratios in
// its boxes), and each OPERATOR's EG where it is drawn, its rates then its
// levels as the DX lists them. Pung draws its bar over the active one; the
// panel lights the DX's own mark too: the algorithm's printed band, an
// operator's number (in operators(), every frame).

var SEGMENTS = [
  { id: "voice", label: "Voice", rect: [DISP.x - 2, 2, DISP.w + 4, 98], keys: ["preset", "output_level", "octave_transpose", "transpose", "osc_sync"] },
  { id: "algorithm", label: "Algorithm", rect: [ALG.x, ALG.y, ALG.w, ALG.h], keys: ["algorithm", "feedback", "op1_coarse", "op2_coarse", "op3_coarse", "op4_coarse", "op5_coarse", "op6_coarse"] }
];
function opCell(n) { var cw = Math.floor(OPS.w / 3), i = n - 1; return [OPS.x + (i % 3) * cw, OPS.y + 18 + Math.floor(i / 3) * 40, cw, 40]; }
for (var sg = 1; sg <= 6; sg++) {
  SEGMENTS.push({ id: "op" + sg, label: "Op " + sg, rect: opCell(sg), keys: ["eg_r1", "eg_r2", "eg_r3", "eg_r4", "eg_l1", "eg_l2", "eg_l3", "eg_l4"].map(function (s) { return op(sg, s); }) });
}

function segmentMark(g, v, a) {
  if (v.$segmode === "segment" && v.$segment === "algorithm") band(g, ALG.x, ALG.y, ALG.w, "ALGORITHM " + (known(v, "algorithm") ? a : "--"), "slot", "black", -1);
}

var ALG_PAGE = ["algorithm", "feedback", "op1_level", "op2_level", "op3_level", "op4_level", "op5_level", "op6_level"];
// what the panel's layer shows depends on: these values, the touch
var ALG_SIG = ALG_PAGE.concat(["preset", "preset_name", "syx_bank_name"]);
for (var sn = 1; sn <= 6; sn++) ALG_SIG.push(op(sn, "coarse"), op(sn, "fine"), op(sn, "osc_mode"));
function panelSig(v) {
  var ks = v.$knobs || [], out = [v.$touched || "", v.$segmode || "", v.$segmode === "segment" && v.$segment === "algorithm" ? "alg" : "", ks.join(",")];
  for (var j = 0; j < ks.length; j++) if (ks[j] && v[ks[j]]) out.push(v[ks[j]].value + "~" + v[ks[j]].display);
  for (var i = 0; i < ALG_SIG.length; i++) { var k = ALG_SIG[i]; out.push(known(v, k) ? v[k].value + "~" + v[k].display : "?"); }
  return out.join("|");
}

push.compartment({
  id: "algorithm", label: "Algorithm", front_panel: true,
  pages: [{ label: "Algorithm", keys: ALG_PAGE }],
  extra_keys: overviewKeys,
  segments: SEGMENTS,
  draws_segments: true,
  screen: function (g, v) {
    var a = Math.max(1, Math.min(32, Math.round(num(v, "algorithm", 1)))), G = graph(a), t = v.$touched || "";
    // the panel is one layer, drawn again only when a value it shows or the
    // touch changes; the envelopes, which move while notes play, over it
    g.layer("dx|" + panelSig(v), function () {
      ground(g, v);
      band(g, ALG.x, ALG.y, ALG.w, "ALGORITHM " + (known(v, "algorithm") ? a : "--"), t === "algorithm" ? "slot" : MAROON, t === "algorithm" ? "black" : MAROON_INK, -1);
      algorithmDiagram(g, v, ALG.x + 4, ALG.x + ALG.w - 14, ALG.y + 18, ALG.y + ALG.h - 2);
      display(g, v, a, G);
      keys(g, v, G);
      segmentMark(g, v, a);
    });
    operators(g, v, G);
  }
});

// ---- the module's own sections -------------------------------------------------------

push.compartment({
  id: "global", label: "Global",
  pages: [{ label: "Global", keys: ["output_level", "octave_transpose", "transpose", "osc_sync", "algorithm", "feedback"] }]
});
push.compartment({
  id: "lfo", label: "LFO",
  pages: [{ label: "LFO", keys: ["lfo_wave", "lfo_speed", "lfo_delay", "lfo_sync", "lfo_pmd", "lfo_pms", "lfo_amd"] }],
  extra_keys: ["algorithm", "op1_amp_mod", "op2_amp_mod", "op3_amp_mod", "op4_amp_mod", "op5_amp_mod", "op6_amp_mod"],
  screen: function (g, v) {
    lfoScreen(g, v);
  }
});
push.compartment({
  id: "pitch_eg", label: "Pitch EG",
  pages: [{ label: "Pitch EG", keys: egKeys("pitch_eg_") }] // Pung's own envelope picture
});
for (var n = 1; n <= 6; n++) {
  push.compartment({
    id: "op" + n, label: "Operator " + n,
    extra_keys: ["algorithm"],
    pages: [
      { label: "Op " + n, keys: ["level", "coarse", "fine", "detune", "osc_mode", "vel_sens", "amp_mod", "rate_scale"].map(function (s) { return op(n, s); }), screen: opScreen(n) },
      { label: "Op " + n + " EG", keys: egKeys(op(n, "eg_")) }, // Pung's own envelope picture
      { label: "Op " + n + " Key Scale", keys: ["key_bp", "key_ld", "key_rd", "key_lc", "key_rc"].map(function (s) { return op(n, s); }), screen: kbdScreen(n) }
    ]
  });
}

