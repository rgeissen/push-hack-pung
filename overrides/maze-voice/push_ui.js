// Maze Voice (a Labyrinth-style thru-zero voice) on Push.
//
// The voice is one signal path, and its panel reads left to right as the
// sound flows: two oscillators (a sine VCO, a triangle MOD VCO that
// frequency-modulates it through zero), the mixer, then the ORDER: the
// wavefolder (VCW) and the state-variable filter (VCF) wired in series one
// way or the other, or side by side, and BLEND crossfading what leaves them
// into the VCA. Two decay-only envelopes drive it: EG1 modulates, EG2 is the
// VCA. Everything is drawn from what the DSP does (maze_voice.c): the FM'd
// sine is integrated as the engine integrates it, the folder is its own fold
// function, the cutoff knob is 20 Hz * 1000^k, a decay is 5 ms * 400^k.
//
//   PANEL      front panel: the whole voice at a glance; the encoders play
//              the eight knobs a hand reaches for first, then its shape
//   VOICE      the oscillators: the VCO's wave as FM bends it, the MOD VCO
//              against it; where EG1 takes FM and both pitches; EG1, EG2.
//              Key Track: how far each oscillator follows the keys
//   WAVEFOLDER the fold function (input to output) at rest and at EG1's
//              peak, a sine folded through it; the ORDER as patched
//   FILTER     the response (LP to BP), where EG1 and the keys move cutoff
//   TONE       the mixer (100 is unity, above it each channel overdrives),
//              the noise's colour, the output stage
//   RANDOMISE  Pung's default view (four switches and Generate)

var PLATE = "#131211", PLATE_HI = "#1d1b18", RULE = "#34302b", INK = "#efe9d8", INK_DIM = "#9a927f", INK_FAINT = "#5c584c";
var METAL = "#d8d5cd", METAL_LO = "#8f8e89", SKIRT = "#2a2723", SKIRT_HI = "#3a3631", TAB = "#17150f";
var LED_ON = "#e2793f", LED_OFF = "#3a2a20", JACK = "#050403", NUT = "#77736b", CABLE = "#d9d2bf";

function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function hot(v, k) { return v.$touched === k; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function sgn(n) { return (n > 0 ? "+" : "") + n; }

var ROUTES = ["VCW>VCF", "PARALLEL", "VCF>VCW"];
function routeOf(v) { return known(v, "route") ? routeFromRaw(v.route.value) : 1; }
function onOff(v, k) {
  if (!known(v, k)) return false;
  var s = String(v[k].value).toLowerCase();
  return s === "on" || s === "go" || parseFloat(s) >= 1;
}
function external(v) { return onOff(v, "out_mode") || /ext/i.test(known(v, "out_mode") ? String(v.out_mode.value) : ""); }

// ---- the engine's own curves ----------------------------------------------------------
function cutHz(k) { return 20 * Math.pow(1000, clamp(k, 0, 100) / 100); }
function decaySec(k) { return 0.005 * Math.pow(400, clamp(k, 0, 100) / 100); }
function hzText(f) { return f >= 1000 ? (f >= 10000 ? Math.round(f / 1000) : (f / 1000).toFixed(1)) + "k" : String(Math.round(f)); }
function secText(s) { return s < 1 ? [String(Math.round(s * 1000)), "MS"] : [s.toFixed(2), "S"]; }
function ftanh(x) { if (x > 3) return 1; if (x < -3) return -1; var x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function fold(x) {
  x = clamp(x, -8, 8);
  while (x > 1) x = 2 - x;
  while (x < -1) x = -2 - x;
  return ftanh(1.6 * x) / 0.9217;
}
function tri(p) { p -= Math.floor(p); return 4 * Math.abs(p - 0.5) - 1; }
// the fold amount the DSP uses: drive (+ EG1 at its peak) (+ the key's share, at C4: none)
function foldGain(drive01) { return 1 + clamp(drive01, 0, 1) * 7; }

// Pung runs each note's dot through the envelopes on the engine's own times: a
// 2 ms attack ramp, then an RC decay of time constant 5 ms * 400^k; the dot
// reaches the end where the decay is 40 dB down (4.6 time constants).
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if ((s.key === "env1_decay" || s.key === "env2_decay") && s.raw !== null && s.raw !== undefined) return 4.6 * decaySec(parseFloat(s.raw));
    if (s.role === "attack" && (!s.key || String(s.key).charAt(0) === "#")) return 0.002;
    return null;
  });
});

// curves are computed when what they show changes, and kept
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 80) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}

// The VCO and the MOD VCO over one window of time, at middle C: the VCO's
// phase is integrated as the engine does (increment f1 * (1 + index * tri)),
// so thru-zero FM runs the sine backwards where the index passes -1. The
// window holds one MOD cycle (2 to 6 VCO cycles).
function oscModel(v) {
  var tune = raw(v, "vco_tune", 0), vk = raw(v, "vco_key", 100) / 100, mf = raw(v, "mod_freq", 55);
  var f1 = 440 * Math.pow(2, (vk * (60 - 69) + tune) / 12), r = mf / f1;
  var idx = clamp(raw(v, "fm_depth", 0) / 100, 0, 1) * 3;
  return { f1: f1, r: r, idx: idx, cyc: clamp(1 / r, 2, 6) };
}
function oscPts(m, x, y, w, h, which, idx) {
  var key = [which, x, y, w, h, m.r.toFixed(4), idx.toFixed(3), m.cyc.toFixed(3)].join("|");
  return cached(key, function () {
    // two pixels a point, the phase integrated in three steps a pixel
    var pts = [], mid = y + h / 2, a = h / 2 - 1, sub = 6, ph = 0, pm = 0.25, dt = m.cyc / (w * 3), TP = 2 * Math.PI;
    for (var px = 0; px <= w; px += 2) {
      var s = which === "mod" ? tri(pm) : Math.sin(TP * ph);
      pts.push(x + px, mid - s * a);
      if (which === "mod") { pm += dt * m.r * sub; continue; }
      for (var q = 0; q < sub; q++) { var pp = pm - Math.floor(pm); ph += dt * (1 + idx * (4 * Math.abs(pp - 0.5) - 1)); pm += dt * m.r; }
    }
    return pts;
  });
}
// a sine through the folder (at this drive and bias)
function foldedPts(x, y, w, h, drive01, bias, cycles) {
  return cached(["fw", x, y, w, h, drive01.toFixed(3), bias.toFixed(3), cycles].join("|"), function () {
    var pts = [], mid = y + h / 2, a = h / 2 - 1, gn = foldGain(drive01);
    for (var px = 0; px <= w; px += 1) pts.push(x + px, mid - fold(gn * Math.sin(2 * Math.PI * cycles * px / w) + bias) * a * 0.92);
    return pts;
  });
}
// the fold function: input -1..1 across, output up
function transferPts(x, y, w, h, drive01, bias) {
  return cached(["tf", x, y, w, h, drive01.toFixed(3), bias.toFixed(3)].join("|"), function () {
    var pts = [], gn = foldGain(drive01);
    for (var px = 0; px <= w; px++) {
      var inp = px / w * 2 - 1;
      pts.push(x + px, y + h / 2 - fold(gn * inp + bias) * (h / 2 - 1) * 0.92);
    }
    return pts;
  });
}

// ---- the plate's furniture ---------------------------------------------------------------
function rule(g, x, y, w, c) { g.fill(x, y, w, 1, c || RULE); }
function box(g, x, y, w, h, c) {
  g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c); g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c);
}
function title(g, x, w, s, right) {
  g.text(x, 11, s, INK_DIM, -1);
  if (right) g.text(x + w, 11, right, INK_FAINT, 1);
  rule(g, x, 15, w, RULE);
}
// a patch point, as the panel's: a nut around a black hole
function jack(g, x, y, lit) { g.dot(x, y, 4.5, lit ? NUT : "#3d3a35"); g.dot(x, y, 2.4, JACK); }
// a cable: straight runs, right-angled, as a patch cable laid along the panel
function cable(g, pts, w, c) { g.poly(pts, w, c); }

// thru-zero FM: a cable from the MOD VCO up into the VCO, an arrowhead, its depth
function fmArrow(g, v, x, yFrom, yTo, tx, ty) {
  var d = Math.round(raw(v, "fm_depth", 0)), on = d > 0 || Math.abs(raw(v, "fm_eg1", 0)) > 0.5;
  var c = hot(v, "fm_depth") || hot(v, "fm_eg1") ? "slot" : (on ? CABLE : "#4a453e");
  g.fill(x - 1, yTo + 3, 2, yFrom - yTo - 3, c);
  g.poly([x - 4, yTo + 5, x, yTo + 1, x + 4, yTo + 5], 2, c);
  g.text(tx, ty, on ? "TZFM " + d : "NO FM", c === "slot" ? "slot" : (on ? INK : INK_FAINT), 1);
}

// ---- the knobs: a fluted skirt, the brushed cap, a dark tab --------------------------------
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
var BIPOLAR = { fm_eg1: 1, vco_eg1: 1, mod_eg1: 1, fold_bias: 1, fold_eg1: 1, blend: 1, cutoff_eg1: 1, noise_tone: 1, vco_tune: 1 };
function knobBody(g, x, y, r, bip) {
  // the scale printed on the plate
  for (var i = 0; i <= 10; i++) {
    var a = A0 + SWEEP * i / 10, rr = r + 4;
    g.dot(x + Math.cos(a) * rr, y + Math.sin(a) * rr, i === 0 || i === 10 || (bip && i === 5) ? 1.3 : 0.8, i === 0 || i === 10 || (bip && i === 5) ? INK_DIM : INK_FAINT);
  }
  g.dot(x, y, r, SKIRT_HI); g.dot(x, y, r - 1, SKIRT);
  for (var f = 0; f < 8; f++) { var b = f * Math.PI / 4; g.dot(x + Math.cos(b) * (r - 1.5), y + Math.sin(b) * (r - 1.5), 1.4, SKIRT_HI); }
  g.dot(x, y, r * 0.66, METAL_LO); g.dot(x, y, r * 0.66 - 1, METAL);
}
function knobTab(g, x, y, r, f, c) {
  var a = A0 + f * SWEEP;
  g.line(x + Math.cos(a) * r * 0.18, y + Math.sin(a) * r * 0.18, x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1), 3, c);
}

// ---- values as the voice means them ---------------------------------------------------------
var NAMES = {
  vco_tune: "VCO TUNE", mod_freq: "MOD FREQ", fm_depth: "FM DEPTH", fm_eg1: "FM EG1", vco_eg1: "VCO EG1", mod_eg1: "MOD EG1",
  env1_decay: "EG1 DECAY", env2_decay: "EG2 DECAY", fold_drive: "VCW FOLD", fold_bias: "VCW BIAS", route: "ORDER", fold_eg1: "FOLD EG1",
  fold_key: "FOLD KEY", blend: "BLEND", cutoff: "VCF CUTOFF", reso: "RESONANCE", filter_mode: "LP-BP", cutoff_eg1: "CUT EG1",
  cutoff_key: "CUT KEY", filt_drive: "FILT DRIVE", vco_lvl: "VCO LVL", mod_lvl: "MOD LVL", noise_lvl: "NOISE LVL",
  noise_tone: "NOISE TONE", ring_lvl: "RING LVL", sat: "TONE/SAT", level: "VOLUME", out_mode: "OUTPUT", vco_key: "VCO KEY", mod_key: "MOD KEY"
};
// A value as the voice means it, [value, unit] (or null: Pung's own), from the raw
// string the module answers. Pung shows it everywhere (push.display), the panel's
// encoder row draws it the same way.
function routeFromRaw(s) {
  var n = parseFloat(s);
  if (!isNaN(n)) return clamp(Math.round(n), 0, 2);
  s = String(s).toUpperCase();
  return s.indexOf("VCW") === 0 ? 0 : (s.indexOf("VCF") === 0 ? 2 : 1);
}
function fmt(k, s) {
  var n = parseFloat(s);
  switch (k) {
  case "route": return [["VCW>VCF", "Parallel", "VCF>VCW"][routeFromRaw(s)], ""];
  case "out_mode": return [/ext/i.test(String(s)) || n >= 1 ? "External" : "Internal", ""];
  }
  if (isNaN(n)) return null;
  switch (k) {
  case "cutoff": var f = cutHz(n); return f >= 1000 ? [(f >= 10000 ? Math.round(f / 1000) : (f / 1000).toFixed(1)) + "", "kHz"] : [String(Math.round(f)), "Hz"];
  case "env1_decay": case "env2_decay": var t = decaySec(n); return t < 1 ? [String(Math.round(t * 1000)), "ms"] : [t.toFixed(2), "s"];
  case "vco_tune": return [sgn(Math.round(n)), "st"];
  case "mod_freq": return [n >= 100 ? String(Math.round(n)) : n.toFixed(1), "Hz"];
  case "filter_mode": return [Math.round(n) <= 0 ? "LP" : (Math.round(n) >= 100 ? "BP" : "BP " + Math.round(n)), Math.round(n) > 0 && Math.round(n) < 100 ? "%" : ""];
  case "blend": return [Math.round(n) === 0 ? "Even" : (n < 0 ? "Fold " + Math.round(-n) : "Filt " + Math.round(n)), ""];
  }
  if (BIPOLAR[k]) return [sgn(Math.round(n)), ""];
  return null;
}
push.display(function (key, rawv) {
  var r = fmt(key, rawv);
  return r ? { value: r[0], unit: r[1] } : undefined;
});
function shown(v, k) {
  if (!known(v, k)) return ["--", ""];
  var r = fmt(k, v[k].value);
  if (r) return [String(r[0]).toUpperCase(), String(r[1]).toUpperCase()];
  if (/^rnd_/.test(k)) return [String(v[k].display || v[k].value).toUpperCase(), ""];
  return [String(Math.round(raw(v, k, 0))), ""];
}
function knobFrac(v, k) {
  if (!known(v, k)) return 0;
  if (k === "route") return routeOf(v) / 2;
  if (k === "out_mode") return external(v) ? 1 : 0;
  return v[k].frac;
}

// the ring modulator's level runs 0..100 and stays clean: on the mixer's 0..200 scale it
// tops out at unity, as the other channels do at the middle of theirs
function ringShare(v) { return clamp(raw(v, "ring_lvl", 0) / 200, 0, 1); }

// ---- PANEL ---------------------------------------------------------------------------------
// x ranges of the sections
var OSC = { x: 6, w: 196 }, MIX = { x: 212, w: 104 }, ORD = { x: 326, w: 384 }, EGS = { x: 720, w: 234 };
var BOXY = 30, BOXH = 58;
// the ORDER's places: in, two stages, blend, out
function orderGeom(x0, y0, w, h) {
  var bw = Math.round((w - 120) / 2);
  return { inX: x0 + 8, a: x0 + 26, b: x0 + 26 + bw + 22, bw: bw, y: y0, h: h, bl: x0 + w - 48, out: x0 + w - 8 };
}
// what each stage box shows: the folded sine, or the filter's response (live)
function stageVCW(g, v, x, y, w, h) {
  var d = raw(v, "fold_drive", 0) / 100, b = raw(v, "fold_bias", 0) / 100;
  g.poly(foldedPts(x + 4, y + 13, w - 8, h - 17, d, b, 1.5), 1.5, hot(v, "fold_drive") || hot(v, "fold_bias") ? "slot" : INK);
}
function filterType(v) { return raw(v, "filter_mode", 0) < 50 ? "LP 12 dB" : "BandPass"; }
function stageVCF(g, v, x, y, w, h) {
  g.filter(x + 2, y + 12, w - 4, h - 14, { cutoff: "cutoff", resonance: "reso", type: filterType(v), color: INK });
}
// the ORDER as patched: the stages' boxes and the cables between them, BLEND, out
function orderDiagram(g, v, x0, y0, w, h, big) {
  var G = orderGeom(x0, y0, w, h), r = routeOf(v), ext = external(v);
  var first = r === 2 ? "VCF" : "VCW", second = r === 2 ? "VCW" : "VCF";
  var mid = G.y + h / 2, bl = raw(v, "blend", 0) / 100, wFold = 0.5 - 0.5 * bl, wFilt = 0.5 + 0.5 * bl;
  var tR = hot(v, "route"), tB = hot(v, "blend");
  var cOn = tR ? "slot" : CABLE;
  // the stages
  var boxes = [[G.a, first], [G.b, second]];
  for (var i = 0; i < 2; i++) {
    var bx = boxes[i][0], nm = boxes[i][1], off = ext && nm === "VCF";
    g.fill(bx, G.y, G.bw, h, PLATE_HI);
    box(g, bx, G.y, G.bw, h, off ? RULE : (tR ? "slot" : "#4a453e"));
    g.text(bx + 5, G.y + 10, nm, off ? INK_FAINT : INK, -1);
    if (nm === "VCW") {
      g.text(bx + G.bw - 5, G.y + 10, "FOLD " + Math.round(raw(v, "fold_drive", 0)), INK_FAINT, 1);
      stageVCW(g, v, bx, G.y, G.bw, h);
    } else if (off) {
      g.text(bx + G.bw / 2, G.y + h / 2 + 4, "BYPASSED", INK_FAINT, 0);
    } else {
      g.text(bx + G.bw - 5, G.y + 10, hzText(cutHz(raw(v, "cutoff", 100))) + " HZ", INK_FAINT, 1);
      stageVCF(g, v, bx, G.y, G.bw, h);
    }
  }
  // the cables: in -> stages -> blend; a tap's weight is how much BLEND takes of it
  var aIn = G.a, aOut = G.a + G.bw, bIn = G.b, bOut = G.b + G.bw, top = G.y - 6, low = G.y + h + 6;
  var foldOut = first === "VCW" ? aOut : bOut, filtOut = first === "VCW" ? bOut : aOut;
  var blX = G.bl, blTop = G.y + 8, blBot = G.y + h - 8;
  function wcol(wt) { return ext ? INK_FAINT : (wt < 0.03 ? "#4a453e" : (tB ? "slot" : CABLE)); }
  cable(g, [G.inX, mid, aIn, mid], 2, cOn);
  if (r === 1) {
    // parallel: the input jumps over the first stage
    cable(g, [G.inX + 8, mid, G.inX + 8, top, bIn - 8, top, bIn - 8, mid, bIn, mid], 2, cOn);
  } else {
    cable(g, [aOut, mid, bIn, mid], 2, cOn);
  }
  // to BLEND: the fold end on top, the filter end below
  var outA = r === 1 ? aOut : aOut + 8; // a serial first stage is tapped after its cable on
  if (r === 1) {
    cable(g, [aOut, mid, aOut + 8, mid, aOut + 8, low, blX - 10, low, blX - 10, blBot, blX, blBot], 2, first === "VCW" ? wcol(wFold) : wcol(wFilt));
  } else {
    cable(g, [aOut + 8, mid, aOut + 8, low, blX - 10, low, blX - 10, blBot, blX, blBot], 2, first === "VCW" ? wcol(wFold) : wcol(wFilt));
  }
  cable(g, [bOut, mid, blX - 18, mid, blX - 18, blTop, blX, blTop], 2, first === "VCW" ? wcol(wFilt) : wcol(wFold));
  // which end of BLEND is which, for this order
  var topIsFold = first !== "VCW";
  // BLEND: a crossfader between its two inputs, its knob where the mix sits
  g.fill(blX, blTop, 2, blBot - blTop, "#4a453e");
  var pos = topIsFold ? (blTop + (blBot - blTop) * wFilt) : (blTop + (blBot - blTop) * wFold);
  g.fill(blX - 5, pos - 3, 12, 6, tB ? "slot" : METAL);
  g.text(blX + 10, blTop + 3, topIsFold ? "FOLD" : "FILT", INK_DIM, -1);
  g.text(blX + 10, blBot + 3, topIsFold ? "FILT" : "FOLD", INK_DIM, -1);
  jack(g, G.inX, mid, true);
  jack(g, aOut + (r === 1 ? 0 : 8), mid, true);
  if (r === 1) g.dot(G.inX + 8, mid, 3, cOn);
  // to the VCA
  return { blX: blX, mid: mid };
}

function panelGround(g, kn, seg) {
  g.fill(0, 0, 960, 160, PLATE);
  title(g, OSC.x, OSC.w, "OSCILLATORS");
  title(g, MIX.x, MIX.w, "MIXER");
  title(g, ORD.x, ORD.w, "ORDER");
  title(g, EGS.x, EGS.w, "");
  g.text(EGS.x + EGS.w, 11, "MAZE VOICE", INK, 1);
  // the oscillators' rows
  g.text(OSC.x, 32, "VCO", INK, -1);
  g.text(OSC.x, 80, "MOD", INK, -1);
  box(g, OSC.x + 46, 20, OSC.w - 46, 32, RULE);
  box(g, OSC.x + 46, 66, OSC.w - 46, 32, RULE);
  // the encoder row
  g.fill(0, 103, 960, 1, RULE);
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, 108, 1, seg ? 32 : 46, "#24211e");
    var k = kn[c];
    if (k) knobBody(g, c * 120 + 28, seg ? 127 : 138, seg ? 10 : 15, !!BIPOLAR[k]);
  }
}

function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  var seg = !!v.$segmode;
  g.layer("mz|" + kn.join(",") + "|" + seg, function () { panelGround(g, kn, seg); });
  // OSCILLATORS: the VCO as FM bends it, the MOD VCO in the same window of time
  var m = oscModel(v), fmOn = m.idx > 0.005 || Math.abs(raw(v, "fm_eg1", 0)) > 0.5;
  var vx = OSC.x + 48, vw = OSC.w - 50;
  g.poly(oscPts(m, vx, 22, vw, 28, "vco", m.idx), 2, hot(v, "vco_tune") || hot(v, "fm_depth") ? "slot" : INK);
  g.poly(oscPts(m, vx, 68, vw, 28, "mod", 0), 2, hot(v, "mod_freq") ? "slot" : INK);
  var tn = raw(v, "vco_tune", 0);
  g.text(OSC.x, 44, sgn(Math.round(tn)) + " ST", hot(v, "vco_tune") ? "slot" : INK_DIM, -1);
  var mf = raw(v, "mod_freq", 55);
  g.text(OSC.x, 92, (mf >= 100 ? Math.round(mf) : mf.toFixed(1)) + " HZ", hot(v, "mod_freq") ? "slot" : INK_DIM, -1);
  // the FM cable: from the MOD VCO up into the VCO, its depth beside it
  fmArrow(g, v, OSC.x + OSC.w - 16, 66, 52, OSC.x + OSC.w - 24, 62);
  // MIXER: Pung's mixer, the four channels into the ORDER
  g.mix(MIX.x, 20, MIX.w, 70, ["vco_lvl", "mod_lvl", ringShare(v), "noise_lvl"], { color: CABLE });
  var lb = ["VCO", "MOD", "RNG", "NZ"];
  for (var i = 0; i < 4; i++) g.text(MIX.x + MIX.w * (i + 0.5) / 4, 99, lb[i], INK_FAINT, 0);
  // the mix into the ORDER
  g.fill(MIX.x + MIX.w + 2, BOXY + BOXH / 2 - 1, ORD.x + 8 - MIX.x - MIX.w - 2, 2, CABLE);
  // ORDER
  var r = routeOf(v);
  g.text(ORD.x + ORD.w, 11, (external(v) ? "EXTERNAL VOICE  " : "") + ROUTES[r], hot(v, "route") ? "slot" : INK, 1);
  orderDiagram(g, v, ORD.x, BOXY, ORD.w, BOXH, false);
  // EG1, EG2: decay-only, as the engine runs them
  var ew = (EGS.w - 10) / 2;
  g.text(EGS.x, 30, "EG1", hot(v, "env1_decay") ? "slot" : INK, -1);
  g.text(EGS.x + ew + 10, 30, "EG2 VCA", hot(v, "env2_decay") ? "slot" : INK, -1);
  g.text(EGS.x + ew, 30, secText(decaySec(raw(v, "env1_decay", 60))).join(" "), INK_FAINT, 1);
  g.text(EGS.x + EGS.w, 30, secText(decaySec(raw(v, "env2_decay", 70))).join(" "), INK_FAINT, 1);
  g.envelope(EGS.x - 2, 34, ew + 4, 64, { attack: 0, decay: "env1_decay", labels: true, color: INK });
  g.envelope(EGS.x + ew + 8, 34, ew + 4, 64, { attack: 0, decay: "env2_decay", labels: true, color: INK });
  segMark(g, v, r);
  // the encoder row
  for (var c = 0; c < 8; c++) {
    var k = kn[c];
    if (!k || !v[k]) continue;
    // in segment mode Pung names the segments in the bottom 18 pixels: the row ends above them
    var x0 = c * 120, on = k === t, kx = x0 + 28, ky = seg ? 127 : 138, vy = seg ? 137 : 146;
    g.text(x0 + 60, seg ? 113 : 117, NAMES[k] || String(v[k].name).toUpperCase(), on ? "slot" : INK_DIM, 0, 112);
    if (on) g.arc(kx, ky, seg ? 13 : 18.5, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) knobTab(g, kx, ky, seg ? 7 : 10, knobFrac(v, k), on ? "slot" : TAB);
    var sv = shown(v, k), uw = sv[1] ? g.measure(sv[1]) + 4 : 0, room = 66 - uw;
    var vw = Math.min(g.measure(sv[0], "value"), room), cx = x0 + 85;
    g.value(cx - (vw + uw) / 2, vy, sv[0], on ? "slot" : INK, -1, room);
    if (uw) g.text(cx - (vw + uw) / 2 + vw + 4, vy, sv[1], INK_DIM, -1);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(EGS.x + EGS.w - g.measure("MAZE VOICE") - 12, 11, String(ps[v.$page] || "").toUpperCase() + " " + ((v.$page || 0) + 1) + "/" + ps.length, LED_ON, 1);
}

// The panel's sections as segments. Pung draws the bar above the one under
// the hands; its legend is lit, as the plate's own section. The folder and
// the filter move with the ORDER: the panel says where (g.segment, segMark).
var OG = orderGeom(ORD.x, BOXY, ORD.w, BOXH);
var SEGS = [
  { id: "osc", label: "Oscillators", rect: [OSC.x - 2, 0, OSC.w + 4, 102], keys: ["vco_tune", "mod_freq", "fm_depth", "fm_eg1", "vco_eg1", "mod_eg1", "vco_key", "mod_key"] },
  { id: "mix", label: "Mixer", rect: [MIX.x - 2, 0, MIX.w + 4, 102], keys: ["vco_lvl", "mod_lvl", "ring_lvl", "noise_lvl", "noise_tone", "sat", "level", "out_mode"] },
  { id: "vcw", label: "Wavefolder", rect: [OG.a, BOXY, OG.bw, BOXH], keys: ["fold_drive", "fold_bias", "fold_eg1", "fold_key", "route", "blend"] },
  { id: "vcf", label: "Filter", rect: [OG.b, BOXY, OG.bw, BOXH], keys: ["cutoff", "reso", "filter_mode", "cutoff_eg1", "cutoff_key", "filt_drive", "route", "blend"] },
  { id: "eg", label: "Envelopes", rect: [EGS.x - 4, 19, EGS.w + 6, 83], keys: ["env1_decay", "env2_decay", "fm_eg1", "vco_eg1", "mod_eg1", "fold_eg1", "cutoff_eg1", "level"] }
];
function segMark(g, v, r) {
  // where the ORDER has put the folder and the filter: Pung's bar (and the
  // outlines while choosing) follow them
  var a = r === 2 ? "vcf" : "vcw", b = a === "vcw" ? "vcf" : "vcw";
  g.segment(a, OG.a, BOXY, OG.bw, BOXH);
  g.segment(b, OG.b, BOXY, OG.bw, BOXH);
  if (v.$segmode !== "segment") return;
  var id = v.$segment;
  function lit(x, w, s) { g.fill(x, 0, w, 14, PLATE); g.text(x, 11, s, "slot", -1); }
  if (id === "osc") lit(OSC.x, OSC.w, "OSCILLATORS");
  else if (id === "mix") lit(MIX.x, MIX.w, "MIXER");
  else if (id === "eg") { g.text(EGS.x, 30, "EG1", "slot", -1); g.text(EGS.x + (EGS.w - 10) / 2 + 10, 30, "EG2 VCA", "slot", -1); }
  else if (id === "vcw" || id === "vcf") {
    // where the ORDER has put it: VCF>VCW swaps the two
    var first = r === 2 ? "vcf" : "vcw", bx = id === first ? OG.a : OG.b;
    g.text(bx + 5, BOXY + 10, id === "vcw" ? "VCW" : "VCF", "slot", -1);
  }
}
push.compartment({
  id: "panel", label: "Panel", front_panel: true, segments: SEGS, draws_segments: true,
  pages: [
    { label: "Voice", keys: ["vco_tune", "mod_freq", "fm_depth", "fold_drive", "cutoff", "reso", "env1_decay", "env2_decay"] },
    { label: "Shape", keys: ["fold_bias", "route", "blend", "filter_mode", "fold_eg1", "cutoff_eg1", "sat", "level"] }
  ],
  extra_keys: ["vco_tune", "mod_freq", "fm_depth", "fm_eg1", "vco_key", "fold_drive", "fold_bias", "route", "blend", "out_mode",
    "cutoff", "reso", "filter_mode", "env1_decay", "env2_decay", "vco_lvl", "mod_lvl", "ring_lvl", "noise_lvl"],
  screen: function (g, v) { panel(g, v); }
});

// ---- band screens (952 x 86) ---------------------------------------------------------------
function ground(g) { g.fill(0, 0, g.w, g.h, PLATE); }
function head(g, x, s, lit, right, rx) {
  g.text(x, 10, s, lit ? "slot" : INK_DIM, -1);
  if (right) g.text(rx, 10, right, INK_FAINT, 1);
}
// a bipolar amount as a bar from the middle of its column, and what it means at EG1's peak
function reach(g, v, col, k, label, says) {
  var x0 = col * 120 + 8, w = 104, n = raw(v, k, 0), on = hot(v, k), y = 56;
  g.text(x0 + w / 2, 24, label, on ? "slot" : INK_DIM, 0, w);
  g.fill(x0, y, w, 2, RULE); g.fill(x0 + w / 2 - 1, y - 6, 2, 14, INK_FAINT);
  var len = Math.round(Math.abs(n) / 100 * (w / 2));
  if (known(v, k) && len > 0) g.fill(n < 0 ? x0 + w / 2 - len : x0 + w / 2, y - 3, len, 8, on ? "slot" : "mod");
  g.value(x0 + w / 2, 44, known(v, k) ? says : "--", on ? "slot" : (Math.abs(n) > 0.5 ? INK : INK_FAINT), 0, w);
  g.text(x0 + w / 2, 80, "AT EG1 PEAK", INK_FAINT, 0);
}

// VOICE: the oscillators and EG1's reach
function voiceScreen(g, v) {
  g.layer("v0", function () { ground(g); g.fill(359, 4, 1, 78, RULE); g.fill(719, 4, 1, 78, RULE); });
  var m = oscModel(v), fmPk = clamp(raw(v, "fm_depth", 0) / 100 + raw(v, "fm_eg1", 0) / 100, 0, 1) * 3;
  var mf = raw(v, "mod_freq", 55), tV = hot(v, "vco_tune") || hot(v, "fm_depth") || hot(v, "fm_eg1");
  head(g, 8, "AT C4, ONE MOD CYCLE", false, Math.abs(fmPk - m.idx) > 0.01 ? "EG1 PEAK: FM " + Math.round(fmPk / 3 * 100) : "", 350);
  // the VCO at rest, at EG1's peak FM (thin, mod), the MOD below; one window of time
  var x = 76, w = 274;
  g.text(8, 30, "VCO", tV ? "slot" : INK, -1);
  g.text(8, 41, sgn(Math.round(raw(v, "vco_tune", 0))) + " ST", hot(v, "vco_tune") ? "slot" : INK_DIM, -1);
  g.text(8, 74, "MOD VCO", hot(v, "mod_freq") ? "slot" : INK, -1);
  g.text(8, 85, (mf >= 100 ? Math.round(mf) : mf.toFixed(1)) + " HZ", hot(v, "mod_freq") ? "slot" : INK_DIM, -1);
  if (Math.abs(fmPk - m.idx) > 0.01) g.poly(oscPts(m, x, 16, w, 36, "vco", fmPk), 1, hot(v, "fm_eg1") ? "slot" : "mod");
  g.poly(oscPts(m, x, 16, w, 36, "vco", m.idx), 2, tV && !hot(v, "fm_eg1") ? "slot" : INK);
  g.poly(oscPts(m, x, 64, w, 22, "mod", 0), 2, hot(v, "mod_freq") ? "slot" : INK_DIM);
  fmArrow(g, v, 68, 70, 30, 62, 59);
  // EG1's reach: FM, VCO pitch, MOD pitch (48 semitones at full)
  var fe = raw(v, "fm_eg1", 0), ve = raw(v, "vco_eg1", 0), me = raw(v, "mod_eg1", 0);
  reach(g, v, 3, "fm_eg1", "EG1 > FM", "FM " + Math.round(clamp(raw(v, "fm_depth", 0) + fe, 0, 100)));
  reach(g, v, 4, "vco_eg1", "EG1 > VCO", sgn(Math.round(ve * 0.48 * 10) / 10) + " ST");
  reach(g, v, 5, "mod_eg1", "EG1 > MOD VCO", sgn(Math.round(me * 0.48 * 10) / 10) + " ST");
  // the envelopes
  head(g, 728, "EG1", hot(v, "env1_decay"), secText(decaySec(raw(v, "env1_decay", 60))).join(" "), 832);
  head(g, 848, "EG2 VCA", hot(v, "env2_decay"), secText(decaySec(raw(v, "env2_decay", 70))).join(" "), 948);
  g.envelope(722, 14, 114, 72, { attack: 0, decay: "env1_decay", labels: true, color: INK });
  g.envelope(842, 14, 110, 72, { attack: 0, decay: "env2_decay", labels: true, color: INK });
}
// KEY TRACK: each oscillator's pitch across the keys (the VCO pivots at A4, the MOD at C4)
function keysScreen(g, v) {
  g.layer("v1", function () {
    ground(g);
    // the keys under the graph, C1 to C8
    var x0 = 250, w = 690, kw = w / 50;
    for (var i = 0; i < 50; i++) g.fill(x0 + i * kw, 76, kw - 1, 10, "#3a3631");
    for (var j = 0; j < 49; j++) {
      var pc = j % 7;
      if (pc !== 2 && pc !== 6) g.fill(x0 + (j + 1) * kw - kw * 0.3, 76, kw * 0.6, 6, "#0a0908");
      if (pc === 0) { g.fill(x0 + j * kw, 10, 1, 64, "#24211e"); g.text(x0 + j * kw + 2, 18, "C" + (j / 7 + 1), INK_FAINT, -1); }
    }
  });
  var x0 = 250, w = 690, vk = raw(v, "vco_key", 100) / 100, mk = raw(v, "mod_key", 100) / 100;
  // semitones relative to the pivot, plotted +-48 over the graph's height
  function line(k, pivot, col, lw) {
    // a note's place on the keys (white keys from C1), its pitch up the graph
    var X = function (n) { var o = Math.floor((n - 24) / 12), pc = (n % 12 + 12) % 12; return x0 + (o * 7 + [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6][pc] + 0.5) * (w / 50); };
    var y = function (n) { return 44 - clamp(k * (n - pivot), -48, 48) / 48 * 30; };
    g.poly([X(24), y(24), X(108), y(108)], lw, col);
    g.dot(X(pivot), y(pivot), 3.5, col);
  }
  line(mk, 60, hot(v, "mod_key") ? "slot" : INK_DIM, 2);
  line(vk, 69, hot(v, "vco_key") ? "slot" : INK, 2.5);
  function say(y, nm, k, col, piv, fixed) {
    g.text(8, y, nm, col, -1);
    g.value(8, y + 20, Math.round(k * 100) + "%", col, -1);
    g.text(70, y + 20, k > 0.995 ? "FOLLOWS THE KEYS" : (k < 0.005 ? "FIXED: " + fixed : "OF EACH OCTAVE"), INK_FAINT, -1, 170);
  }
  say(14, "VCO", vk, hot(v, "vco_key") ? "slot" : INK, 69, sgn(Math.round(raw(v, "vco_tune", 0))) + " ST FROM A4");
  var mf = raw(v, "mod_freq", 55);
  say(52, "MOD VCO", mk, hot(v, "mod_key") ? "slot" : INK_DIM, 60, (mf >= 100 ? Math.round(mf) : mf.toFixed(1)) + " HZ");
}
push.compartment({
  id: "voice", label: "Voice",
  pages: [
    { label: "Voice", keys: ["vco_tune", "mod_freq", "fm_depth", "fm_eg1", "vco_eg1", "mod_eg1", "env1_decay", "env2_decay"], screen: voiceScreen },
    { label: "Key Track", keys: ["vco_key", "mod_key"], screen: keysScreen }
  ],
  extra_keys: ["vco_tune", "mod_freq", "fm_depth", "vco_key"]
});

// WAVEFOLDER: the fold function, a sine through it, the ORDER
function folderScreen(g, v) {
  g.layer("w", function () {
    ground(g);
    g.fill(479, 4, 1, 78, RULE);
    // the transfer plot's axes
    box(g, 10, 14, 96, 68, RULE); g.fill(10, 48, 96, 1, "#24211e"); g.fill(58, 14, 1, 68, "#24211e");
  });
  var d = raw(v, "fold_drive", 0) / 100, b = raw(v, "fold_bias", 0) / 100, e = raw(v, "fold_eg1", 0) / 100, kf = raw(v, "fold_key", 0) / 100;
  var pk = clamp(d + e, 0, 1), tD = hot(v, "fold_drive") || hot(v, "fold_bias");
  head(g, 10, "FOLD IN > OUT", tD, "", 0);
  if (Math.abs(pk - d) > 0.005) g.poly(transferPts(11, 15, 94, 66, pk, b), 1, "mod");
  g.poly(transferPts(11, 15, 94, 66, d, b), 2, tD ? "slot" : INK);
  // a sine through it: at rest, and at EG1's peak
  var side = (Math.abs(pk - d) > 0.005 ? "EG1 PEAK " + Math.round(pk * 100) : "") + (kf > 0.005 ? "  KEY +" + Math.round(kf * 100) + "/2 OCT" : "");
  head(g, 124, "A SINE, FOLDED", tD, side, 470);
  g.fill(124, 48, 346, 1, "#24211e");
  if (Math.abs(pk - d) > 0.005) g.poly(foldedPts(124, 16, 346, 66, pk, b, 2), 1, hot(v, "fold_eg1") ? "slot" : "mod");
  g.poly(foldedPts(124, 16, 346, 66, d, b, 2), 2, tD ? "slot" : INK);
  // the key: two octaves up adds kf of fold
  // the ORDER
  head(g, 490, "ORDER  " + ROUTES[routeOf(v)], hot(v, "route"), external(v) ? "EXTERNAL VOICE: VCF BYPASSED" : "", 944);
  orderDiagram(g, v, 486, 22, 460, 54, true);
}
push.compartment({
  id: "folder", label: "WaveFolder",
  pages: [{ label: "WaveFolder", keys: ["fold_drive", "fold_bias", "fold_eg1", "fold_key", "route", "blend"] }],
  extra_keys: ["out_mode", "cutoff", "reso", "filter_mode"],
  screen: folderScreen
});

// FILTER: the response, and where EG1 and the keys take the cutoff
function filterScreen(g, v) {
  g.layer("f", function () { ground(g); g.fill(599, 4, 1, 78, RULE); });
  var c = raw(v, "cutoff", 100), mode = raw(v, "filter_mode", 0), ce = raw(v, "cutoff_eg1", 0), ck = raw(v, "cutoff_key", 0) / 100;
  var tC = hot(v, "cutoff") || hot(v, "reso") || hot(v, "filter_mode");
  head(g, 8, "VCF  " + hzText(cutHz(c)) + " HZ", tC, (mode < 1 ? "LOWPASS" : (mode > 99 ? "BANDPASS" : "LP " + Math.round(100 - mode) + " : BP " + Math.round(mode))) + "  2-POLE SVF", 590);
  g.filter(4, 14, 592, 72, { cutoff: "cutoff", resonance: "reso", type: filterType(v), color: INK });
  // EG1's sweep: from the cutoff to where its peak takes it (5 octaves at full), on the filter's axis
  // (the axis spans 20 Hz..20 kHz as the knob does)
  function ax(hz) { return 10 + (580 - 12) * clamp(Math.log(hz / 20) / Math.log(1000), 0, 1); }
  var f0 = cutHz(c), f1 = clamp(f0 * Math.pow(2, ce / 100 * 5), 20, 20000);
  if (Math.abs(ce) > 0.5) {
    var a = ax(Math.min(f0, f1)), b = ax(Math.max(f0, f1)), on = hot(v, "cutoff_eg1");
    g.fill(a, 80, Math.max(2, b - a), 3, on ? "slot" : "mod");
    g.dot(ax(f1), 81.5, 3, on ? "slot" : "mod");
  }
  // the right: EG1, keys, drive, in the voice's words
  var x = 612;
  g.text(x, 12, "EG1 SWEEP", hot(v, "cutoff_eg1") ? "slot" : INK_DIM, -1);
  var sweeps = Math.abs(ce) > 0.5 && Math.abs(f1 - f0) > 1;
  g.value(x, 32, sweeps ? hzText(f0) + " > " + hzText(f1) + " HZ" : (Math.abs(ce) > 0.5 ? "FULLY OPEN" : "NONE"), Math.abs(ce) > 0.5 ? (hot(v, "cutoff_eg1") ? "slot" : INK) : INK_FAINT, -1, 160);
  g.text(x, 52, "KEY TRACK", hot(v, "cutoff_key") ? "slot" : INK_DIM, -1);
  var lo = f0 * Math.pow(2, ck * (36 - 60) / 12), hi = f0 * Math.pow(2, ck * (84 - 60) / 12);
  g.text(x, 66, ck > 0.005 ? "C2 " + hzText(lo) + "   C4 " + hzText(f0) + "   C6 " + hzText(hi) : "THE SAME ON EVERY KEY", ck > 0.005 ? INK : INK_FAINT, -1, 200);
  var dr = raw(v, "filt_drive", 0);
  g.text(x, 82, dr > 0.5 ? "INPUT DRIVEN " + Math.round(dr) + "%: GRIT" : "INPUT CLEAN", hot(v, "filt_drive") ? "slot" : (dr > 0.5 ? INK : INK_FAINT), -1, 200);
  // drive: the input stage's curve (tanh at 1 + 4 * drive, mixed with the clean signal)
  var gx = 830, gy = 40, gw = 110, gh = 44;
  g.fill(gx, gy + gh / 2, gw, 1, "#24211e");
  g.poly(cached("dr|" + dr.toFixed(0), function () {
    var pts = [], amt = dr / 100, gn = 1 + amt * 4;
    for (var px = 0; px <= gw; px += 2) {
      var xin = (px / gw * 2 - 1) * 1.2, sh = ftanh(xin * gn) / ftanh(gn), y = xin + amt * (sh - xin);
      pts.push(gx + px, gy + gh / 2 - clamp(y, -1.2, 1.2) / 1.2 * gh / 2);
    }
    return pts;
  }), 2, hot(v, "filt_drive") ? "slot" : INK_DIM);
}
push.compartment({
  id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: ["cutoff", "reso", "filter_mode", "cutoff_eg1", "cutoff_key", "filt_drive", "blend"] }],
  screen: filterScreen
});

// TONE: the mixer, the noise's colour, the output stage
function toneScreen(g, v) {
  g.layer("t", function () { ground(g); g.fill(479, 4, 1, 78, RULE); g.fill(719, 4, 1, 78, RULE); });
  var hotL = ["vco_lvl", "mod_lvl", "ring_lvl", "noise_lvl"], nmL = ["VCO", "MOD", "RING", "NOISE"], od = [];
  for (var i = 0; i < 4; i++) if (raw(v, hotL[i], 0) > 100.5 && i !== 2) od.push(nmL[i]);
  head(g, 8, "MIXER", false, od.length ? "OVER 100: " + od.join(", ") + " OVERDRIVEN" : "100 IS UNITY, ABOVE IT A CHANNEL OVERDRIVES", 470);
  g.mix(4, 14, 472, 72, ["vco_lvl", "mod_lvl", ringShare(v), "noise_lvl"], { color: CABLE });
  // the noise's colour: dark (low-passed) to bright (what the low-pass leaves out)
  var nt = raw(v, "noise_tone", 0) / 100, on = hot(v, "noise_tone");
  head(g, 488, "NOISE COLOUR", on, nt < -0.33 ? "DARK" : (nt > 0.33 ? "BRIGHT" : "MIXED"), 712);
  var x0 = 490, w = 220, y0 = 20, h = 56, pos = 0.5 + 0.5 * nt;
  g.poly(cached("nz|" + nt.toFixed(2), function () {
    var pts = [];
    for (var px = 0; px <= w; px += 4) {
      var f = px / w, lp = 1 / Math.sqrt(1 + Math.pow(f * 6, 2)), hp = 1 - lp; // one pole at about a sixth of the band
      var a = (1 - pos) * lp + pos * hp;
      pts.push(x0 + px, y0 + h - clamp(a, 0, 1) * h);
    }
    return pts;
  }), 2, on ? "slot" : INK);
  g.fill(x0, y0 + h, w, 1, RULE);
  g.text(x0, y0 + h + 10, "LOW", INK_FAINT, -1); g.text(x0 + w, y0 + h + 10, "HIGH", INK_FAINT, 1);
  // the output: overdrive, volume, internal or external voice
  var x = 732, sat = raw(v, "sat", 0), ext = external(v);
  head(g, x, "OUTPUT", hot(v, "sat") || hot(v, "level") || hot(v, "out_mode"), "", 0);
  g.value(x, 34, ext ? "EXTERNAL VOICE" : "INTERNAL VOICE", hot(v, "out_mode") ? "slot" : INK, -1, 212);
  g.text(x, 52, ext ? "THE FOLDED MIX, NO FILTER, NO VCA" : "VCA: EG2 X VELOCITY", INK_DIM, -1, 212);
  g.text(x, 68, sat > 0.5 ? "OVERDRIVE " + Math.round(sat) + "%" : "NO OVERDRIVE", hot(v, "sat") ? "slot" : (sat > 0.5 && !ext ? INK : INK_FAINT), -1, 212);
  g.text(x, 84, "VOLUME " + Math.round(raw(v, "level", 80)), hot(v, "level") ? "slot" : INK_DIM, -1, 212);
}
push.compartment({
  id: "tone", label: "Tone",
  pages: [{ label: "Tone", keys: ["vco_lvl", "mod_lvl", "ring_lvl", "noise_lvl", "noise_tone", "sat", "level", "out_mode"] }],
  screen: toneScreen
});

push.compartment({
  id: "random", label: "Randomise",
  pages: [{ label: "Randomise", keys: ["rnd_voice", "rnd_wavefolder", "rnd_filter", "rnd_tone", "rnd_go"] }]
});
