// Dexed (DX7) on the Push. Dexed has no web panel of its own, so this is a
// new design (docs/UX-GUIDELINES.md, 5), in the DX7's own terms:
//
// - Algorithm (takeover): the algorithm as the DX7 prints it on its panel:
//   six operators, modulators stacked over carriers, the feedback loop; each
//   operator with its frequency ratio and output level. Beside it the voice's
//   name and all six operator envelopes. The encoders: algorithm, feedback
//   and the six levels -- the FM patch's shape under the hands.
// - Every 4-rate / 4-level envelope (pitch, and each operator's) is a page
//   whose screen draws it with each stage over its own two knobs (rate,
//   level), key-off before stage 4. Rates are speeds: high is short.
// - Each operator's keyboard scaling page draws the scaling curve over a
//   keyboard: break point, left and right depth and curve.
//
// The structure comes from Dexed's own algorithm table (msfa fm_core.cc),
// read as the engine reads it, not redrawn by hand.

var ACCENT = "#ff8a1f", BOX = "#1e2126", BAR = "#3b2a17";

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
  var c = num(v, op(n, "coarse"), 1), f = num(v, op(n, "fine"), 0);
  if (num(v, op(n, "osc_mode"), 0) >= 1) { // fixed frequency
    var hz = Math.pow(10, (c % 4) + f / 100);
    return hz >= 1000 ? (hz / 1000).toFixed(1) + "K" : hz.toFixed(hz < 10 ? 1 : 0) + "HZ";
  }
  return ((c === 0 ? 0.5 : c) * (1 + f / 100)).toFixed(2);
}

function algorithmDiagram(g, v, x0, x1, bottom) {
  var a = Math.max(1, Math.min(32, Math.round(num(v, "algorithm", 1)))), G = graph(a), t = v.$touched || "";
  // as large as the algorithm's depth allows: rows of up to 30 px
  var rows = 1, o;
  for (o = 1; o <= 6; o++) rows = Math.max(rows, G.row[o] + 1);
  var rs = Math.min(30, Math.floor((bottom - 6) / rows)), bh = rs - 8, bw = 76;
  var step = Math.min(96, (x1 - x0) / G.cols), ox = x0 + ((x1 - x0) - step * (G.cols - 1)) / 2;
  var pos = {};
  for (o = 1; o <= 6; o++) pos[o] = { x: ox + G.col[o] * step - bw / 2, y: bottom - 4 - rs - G.row[o] * rs + 8 };
  // wires: modulator to what it modulates, carriers to the output
  for (o = 1; o <= 6; o++) {
    G.mods[o].forEach(function (m) {
      g.line(pos[m].x + bw / 2, pos[m].y + bh, pos[o].x + bw / 2, pos[o].y, 1.5, "dim");
    });
  }
  var lo = 1e9, hi = -1e9;
  G.carriers.forEach(function (c) {
    var cx = pos[c].x + bw / 2;
    g.line(cx, pos[c].y + bh, cx, bottom, 1.5, "fg");
    lo = Math.min(lo, cx); hi = Math.max(hi, cx);
  });
  g.line(lo - 6, bottom, hi + 6, bottom, 2, "fg");
  // feedback: from the operator that sends it, round to the one that takes it
  if (G.fbIn && G.fbOut) {
    var fo = pos[G.fbOut], fi = pos[G.fbIn], rx = Math.max(fo.x, fi.x) + bw + 6;
    var fb = num(v, "feedback", 0), fcol = t === "feedback" ? ACCENT : fb > 0 ? "fg" : "dim";
    g.poly([[fo.x + bw, fo.y + bh / 2], [rx, fo.y + bh / 2], [rx, fi.y - 5], [fi.x + bw / 2, fi.y - 5], [fi.x + bw / 2, fi.y]], t === "feedback" ? 2.5 : 1.5, fcol);
  }
  // the operators: level as the box's fill, ratio inside, carriers outlined
  for (o = 1; o <= 6; o++) {
    var p = pos[o], hot = t.indexOf("op" + o + "_") === 0, carrier = G.carriers.indexOf(o) >= 0;
    var lv = fr(v, op(o, "level"), 0);
    g.fill(p.x - 1, p.y - 1, bw + 2, bh + 2, hot ? ACCENT : carrier ? "fg" : "line");
    g.fill(p.x, p.y, bw, bh, BOX);
    g.fill(p.x, p.y, Math.round(bw * lv), bh, hot ? "#5a3a12" : BAR);
    g.text(p.x + 6, p.y + bh / 2 + 5, String(o), hot ? ACCENT : "fg", -1);
    g.text(p.x + bw - 5, p.y + bh / 2 + 5, ratio(v, o), hot ? "fg" : "dim", 1);
  }
  return a;
}

// ---- the DX envelope: 4 rates, 4 levels ------------------------------------------------

function egKeys(prefix) { // R1 L1 R2 L2 R3 L3 R4 L4: each stage over its two knobs
  var out = [];
  for (var i = 1; i <= 4; i++) out.push(prefix + "r" + i, prefix + "l" + i);
  return out;
}
function dur(rate) { return 0.04 + Math.pow(1 - rate, 1.6); } // a rate is a speed

function stageX(i) { return i * 240 - (i ? 4 : 0); } // stage i over columns 2i, 2i+1

// x0..x1 across, top..base up; prefix "op3_eg_" or "pitch_eg_"; small: one
// compact line (the takeover), else stages over their knobs
function dxEnv(g, v, prefix, x0, x1, top, base, small, centered) {
  var R = [], L = [], i, t = v.$touched || "", ok = true;
  for (i = 1; i <= 4; i++) {
    if (!known(v, prefix + "r" + i)) ok = false;
    R.push(fr(v, prefix + "r" + i, 0.7));
    L.push(fr(v, prefix + "l" + i, i < 3 ? 1 : i === 3 ? 0.7 : 0));
  }
  var y = function (l) { return base - l * (base - top); };
  var pts = [], hx = [];
  if (small) {
    var d = [dur(R[0]), dur(R[1]), dur(R[2]), 0.6, dur(R[3])], tot = d[0] + d[1] + d[2] + d[3] + d[4], x = x0;
    pts.push([x, y(L[3])]);
    for (i = 0; i < 3; i++) { x += d[i] / tot * (x1 - x0); pts.push([x, y(L[i])]); }
    x += d[3] / tot * (x1 - x0); pts.push([x, y(L[2])]);
    pts.push([x1, y(L[3])]);
    g.area(pts, base, ok ? BAR : "#24262b");
    g.poly(pts, 1.5, ok ? "fg" : "dim");
    return;
  }
  var maxd = dur(0);
  pts.push([stageX(0), y(L[3])]);
  for (i = 0; i < 4; i++) {
    var rx = stageX(i), rw = (i < 3 ? stageX(i + 1) : x1) - rx;
    var ex = rx + Math.max(6, dur(R[i]) / maxd * (rw - 16));
    pts.push([ex, y(L[i])]);
    hx.push([ex, y(L[i])]);
    if (i < 3) pts.push([rx + rw, y(L[i])]);
  }
  if (centered) g.line(x0, y(0.5), x1, y(0.5), 1, "line");
  else g.area(pts, base, ok ? BAR : "#24262b");
  g.line(x0, base, x1, base, 1, "line");
  g.poly(pts, 2, ok ? "fg" : "dim");
  for (i = 0; i < 4; i++) {
    var hot = t === prefix + "r" + (i + 1) || t === prefix + "l" + (i + 1);
    var a = pts[i === 0 ? 0 : 2 * i], b = pts[2 * i + 1];
    if (hot) g.line(a[0], a[1], b[0], b[1], 3.5, ACCENT);
    g.dot(b[0], b[1], hot ? 5 : 3, hot ? ACCENT : ok ? "fg" : "dim");
    g.text(stageX(i) + 8, top - 10, String(i + 1), hot ? ACCENT : "dim", -1);
  }
  var ko = stageX(3);
  for (var yy = top - 18; yy < base; yy += 6) g.line(ko, yy, ko, yy + 3, 1, "dim");
  g.text(x1 - 6, top - 10, "KEY OFF", "dim", 1);
}

function egScreen(prefix, centered) {
  return function (g, v) { dxEnv(g, v, prefix, 0, g.w, 24, 80, false, centered); };
}

// ---- keyboard level scaling --------------------------------------------------------------

var CURVES = ["-LIN", "-EXP", "+EXP", "+LIN"];
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function kbdScreen(n) {
  return function (g, v) {
    var t = v.$touched || "", W = g.w, kTop = 64, kBot = 84, mid = 32, amp = 26;
    // 88 keys, A-1 to C7 (DX7: break point 0 = A-1, 39 = C3): white keys,
    // the black ones over them
    var first = 21, last = 108, i, isBlack = function (nt) { return [1, 3, 6, 8, 10].indexOf(nt % 12) >= 0; };
    var whites = 0;
    for (i = first; i <= last; i++) if (!isBlack(i)) whites++;
    var ww = W / whites, keyX = {}, wi = 0;
    for (i = first; i <= last; i++) {
      if (!isBlack(i)) { keyX[i] = (wi + 0.5) * ww; g.fill(Math.round(wi * ww), kTop, Math.max(1, Math.round(ww) - 1), 20, "#6b6f78"); wi++; }
      else keyX[i] = wi * ww;
    }
    for (i = first; i <= last; i++) if (isBlack(i)) g.fill(Math.round(keyX[i] - ww * 0.3), kTop, Math.max(1, Math.round(ww * 0.6)), 12, "#16181c");
    var bpNote = first + Math.max(0, Math.min(99, Math.round(num(v, op(n, "key_bp"), 39)))), bx = keyX[Math.min(last, bpNote)];
    var shape = function (c, d) { // c: curve index, d: 0..1 away from the break point
      var e = c === 1 || c === 2 ? (Math.exp(3 * d) - 1) / (Math.exp(3) - 1) : d;
      return c < 2 ? -e : e;
    };
    var side = function (dir, depthKey, curveKey) {
      var depth = fr(v, op(n, depthKey), 0), c = Math.max(0, Math.min(3, Math.round(num(v, op(n, curveKey), 0)))), pts = [], end = dir < 0 ? 0 : W;
      for (var s = 0; s <= 24; s++) {
        var x = bx + (end - bx) * s / 24, dd = Math.abs(x - bx) / Math.max(1, Math.abs(end - bx));
        pts.push([x, mid - shape(c, dd) * depth * amp]);
      }
      var hot = t === op(n, depthKey) || t === op(n, curveKey);
      g.poly(pts, hot ? 3 : 2, hot ? ACCENT : "fg");
      g.text(dir < 0 ? 8 : W - 8, 12, CURVES[c] + " " + Math.round(depth * 99), hot ? ACCENT : "dim", dir < 0 ? -1 : 1);
    };
    g.line(0, mid, W, mid, 1, "line");
    side(-1, "key_ld", "key_lc");
    side(1, "key_rd", "key_rc");
    var bhot = t === op(n, "key_bp");
    g.line(bx, 4, bx, kTop + 20, bhot ? 2.5 : 1, bhot ? ACCENT : "dim");
    g.text(Math.max(16, Math.min(W - 16, bx)), kTop - 4, NOTE[bpNote % 12] + (Math.floor(bpNote / 12) - 2), bhot ? ACCENT : "fg", 0);
  };
}

// ---- Algorithm: the takeover -----------------------------------------------------------

function knobRow(g, v) {
  var knobs = v.$knobs || [], t = v.$touched;
  g.fill(0, 104, 960, 1, "line");
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], cx = i * 120 + 60;
    if (i) g.fill(i * 120, 112, 1, 44, "faint");
    if (!k || !v[k]) continue;
    var hot = k === t;
    g.text(cx, 124, String(v[k].name).toUpperCase().slice(0, 15), hot ? "fg" : "dim", 0);
    g.value(cx, 149, known(v, k) ? String(v[k].display || v[k].value) : "--", hot ? ACCENT : "fg", 0);
    if (hot) g.fill(cx - 20, 154, 40, 2, ACCENT);
  }
}

var overviewKeys = ["preset", "preset_name"];
for (var on = 1; on <= 6; on++) {
  ["coarse", "fine", "osc_mode", "eg_r1", "eg_r2", "eg_r3", "eg_r4", "eg_l1", "eg_l2", "eg_l3", "eg_l4"].forEach(function (s) { overviewKeys.push(op(on, s)); });
}

push.compartment({
  id: "algorithm", label: "Algorithm", takeover: true,
  pages: [{ label: "Algorithm", keys: ["algorithm", "feedback", "op1_level", "op2_level", "op3_level", "op4_level", "op5_level", "op6_level"] }],
  extra_keys: overviewKeys,
  screen: function (g, v) {
    var a = algorithmDiagram(g, v, 8, 528, 100);
    var x = 552, G = graph(a);
    var name = known(v, "preset_name") ? String(v.preset_name.value).replace(/\s+$/, "").toUpperCase() : "";
    g.value(x, 24, name || "DEXED", "fg", -1);
    g.text(x, 42, "ALGORITHM " + a + "   FEEDBACK " + num(v, "feedback", 0) + "   " + G.carriers.length + (G.carriers.length === 1 ? " CARRIER" : " CARRIERS"), "dim", -1);
    // all six operators' envelopes
    for (var i = 0; i < 6; i++) {
      var ex = x + (i % 3) * 136, ey = 52 + Math.floor(i / 3) * 26, hot = (v.$touched || "").indexOf("op" + (i + 1) + "_") === 0;
      g.text(ex, ey + 16, String(i + 1), hot ? ACCENT : "dim", -1);
      dxEnv(g, v, op(i + 1, "eg_"), ex + 12, ex + 128, ey + 2, ey + 22, true);
    }
    knobRow(g, v);
  }
});

// ---- the module's own sections -------------------------------------------------------

push.compartment({
  id: "global", label: "Global",
  pages: [{ label: "Global", keys: ["output_level", "octave_transpose", "transpose", "osc_sync", "algorithm", "feedback"] }]
});
push.compartment({
  id: "lfo", label: "LFO",
  pages: [{ label: "LFO", keys: ["lfo_speed", "lfo_delay", "lfo_pmd", "lfo_amd", "lfo_pms", "lfo_wave", "lfo_sync"] }]
});
push.compartment({
  id: "pitch_eg", label: "Pitch EG",
  pages: [{ label: "Pitch EG", keys: egKeys("pitch_eg_"), screen: egScreen("pitch_eg_", true) }]
});
for (var n = 1; n <= 6; n++) {
  push.compartment({
    id: "op" + n, label: "Operator " + n,
    pages: [
      { label: "Op " + n, keys: ["level", "coarse", "fine", "detune", "osc_mode", "vel_sens", "amp_mod", "rate_scale"].map(function (s) { return op(n, s); }) },
      { label: "Op " + n + " EG", keys: egKeys(op(n, "eg_")), screen: egScreen(op(n, "eg_"), false) },
      { label: "Op " + n + " Key Scale", keys: ["key_bp", "key_ld", "key_rd", "key_lc", "key_rc"].map(function (s) { return op(n, s); }), screen: kbdScreen(n) }
    ]
  });
}
