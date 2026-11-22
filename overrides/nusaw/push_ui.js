// NuSaw on the Push: a polyphonic supersaw.
//
// NuSaw is one idea: a stack of detuned saws (3 to 25), the centre one
// loudest, the pairs around it detuned on a triangular law (1:3:6...) and
// panned out to either side (nusaw_engine.cpp). Its pictures show that
// stack as it is, computed from the engine's own laws:
//
//   THE FAN    every saw as a line in the stereo field, as loud as Spread
//              makes it, the outer pair's detune in cents at its ends: the
//              higher saw of each pair is panned right, the lower left
//   THE SCOPE  the saws laid over each other for three cycles, drifting
//              apart as far as Detune takes them (the sub's sine under them)
//
// Then the resonant low-pass (with where its envelope takes it), the two
// envelopes on the engine's own times, and the effects as they act: the
// chorus's two delay lines, the ping-pong echoes.
//
// The look: a club at night. A violet-black ground, the saws in neon pink,
// the encoders as segmented LED bars.

var GROUND = "#100d18", PANEL = "#1a1528", RULE = "#382e4f", INK = "#f3eeff", INK_DIM = "#9b91b6";
var NEON = "#ff4fa8", NEON_DK = "#5c1d47", SUB = "#b49cff", SEG_OFF = "#2a2238";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function hot(v, k) { return v.$touched === k; }
function anyHot(v, ks) { for (var i = 0; i < ks.length; i++) if (v.$touched === ks[i]) return true; return false; }
function hex2(n) { var s = Math.round(clamp(n, 0, 255)).toString(16); return s.length < 2 ? "0" + s : s; }
function mix(a, b, t) { // a toward b by t (flat colours only: the panel has no alpha)
  var pa = [parseInt(a.substr(1, 2), 16), parseInt(a.substr(3, 2), 16), parseInt(a.substr(5, 2), 16)];
  var pb = [parseInt(b.substr(1, 2), 16), parseInt(b.substr(3, 2), 16), parseInt(b.substr(5, 2), 16)];
  return "#" + hex2(pa[0] + (pb[0] - pa[0]) * t) + hex2(pa[1] + (pb[1] - pa[1]) * t) + hex2(pa[2] + (pb[2] - pa[2]) * t);
}

// ---- the engine's laws -------------------------------------------------------------------
function detuneCurve(x) { return x < 0.1 ? x * 0.2 : (x < 0.5 ? 0.02 + (x - 0.1) * 0.575 : 0.25 + (x - 0.5) * 1.5); }
function sawCount(v) { var n = Math.round(num(v, "saw_count", 7)); n = clamp(n, 3, 25); return n | 1; }
function sideGain(spread) { return Math.max(0.015, spread * Math.sqrt(spread) * 0.667); }
function outerCents(det) { return 1200 * Math.log(1 + 0.1 * detuneCurve(det)) / Math.LN2; }
// the stack: [detune coefficient (-1..1), pan (-0.55..0.55), gain]
function stack(n, spread) {
  var m = (n - 1) / 2, gs = sideGain(spread), out = [[0, 0, 1]];
  for (var k = 1; k <= m; k++) {
    var c = k * (k + 1) / (m * (m + 1)), p = k / m * 0.55;
    out.push([c, p, gs], [-c, -p, gs]);
  }
  return out;
}
function secs(p) { return 0.001 * Math.pow(10000, clamp(p, 0, 1)); } // every stage: 1 ms .. 10 s
function msText(s) { return s < 1 ? [String(Math.round(s * 1000)), "MS"] : [s.toFixed(s < 10 ? 2 : 1), "S"]; }
function hzText(h) { return h < 1000 ? [String(Math.round(h)), "HZ"] : [(h / 1000).toFixed(h < 10000 ? 1 : 0), "KHZ"]; }

push.envelopeTimes(function (env) {
  return env.stages.map(function (s) { return s.plateau || s.raw === null ? null : secs(s.raw); });
});

var memo = {}, memoN = 0;
function cached(key, make) { if (!(key in memo)) { if (++memoN > 80) { memo = {}; memoN = 1; } memo[key] = make(); } return memo[key]; }

// ---- the fan and the scope ---------------------------------------------------------------
function drawFan(g, v, x, y, w, h, lit) {
  if (!known(v, "saw_count") || !known(v, "spread")) { g.text(x + w / 2, y + h / 2, "--", INK_DIM, 0); return; }
  var n = sawCount(v), st = stack(n, fr(v, "spread", 0.7)), cx = x + w / 2, base = y + h - 12, top = y + 4;
  var cents = outerCents(fr(v, "detune", 0.3));
  g.fill(x, base, w, 1, RULE);
  g.fill(Math.round(cx), base, 1, 4, INK_DIM);
  for (var i = st.length - 1; i >= 0; i--) {
    var s = st[i], bx = Math.round(cx + s[1] / 0.55 * (w / 2 - 6)), bh = Math.max(2, Math.round((base - top) * s[2]));
    var col = i === 0 ? INK : mix(NEON, GROUND, 0.55 * (1 - s[2] / 0.667));
    g.fill(bx - 1, base - bh, 2 + (i === 0 ? 1 : 0), bh, lit ? "slot" : col);
  }
  g.text(x, y + h, "L  -" + Math.round(cents), INK_DIM, -1);
  g.text(x + w, y + h, "+" + Math.round(cents) + "  R", INK_DIM, 1);
  g.text(cx, y + h, "CT", INK_DIM, 0);
}
function rnd(i) { var s = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); }
function drawScope(g, v, x, y, w, h, lit) {
  if (!known(v, "saw_count") || !known(v, "detune")) { g.text(x + w / 2, y + h / 2, "--", INK_DIM, 0); return; }
  var n = sawCount(v), sp = fr(v, "spread", 0.7), det = fr(v, "detune", 0.3), cyc = 3;
  var st = stack(n, sp), span = 0.1 * detuneCurve(det), mid = y + h / 2, a = h / 2 - 2;
  var key = [n, sp.toFixed(2), det.toFixed(3), x, y, w, h].join("|");
  // each saw as its ramps (a list of segments); the centre one also with its
  // resets, so it reads as the saw the others are smeared around
  var lines = cached("s|" + key, function () {
    var out = [];
    for (var i = 0; i < st.length; i++) {
      var f = 1 + span * st[i][0], p0 = i ? rnd(i) : 0, t = 0, segs = [], whole = [];
      while (t < cyc) {
        var dt = (1 - p0) / f, t1 = Math.min(cyc, t + dt), p1 = p0 + (t1 - t) * f;
        var xa = x + w * t / cyc, xb = x + w * t1 / cyc, ya = mid - a * (2 * p0 - 1), yb = mid - a * (2 * p1 - 1);
        segs.push([xa, ya, xb, yb]);
        whole.push(xa, ya, xb, yb);
        t = t1; p0 = 0;
      }
      out.push(i ? segs : [whole]);
    }
    return out;
  });
  // the sub: a sine an octave or two down, under the saws
  var sl = fr(v, "sub_level", 0);
  if (sl > 0.005) {
    var oc = Math.round(num(v, "sub_octave", -1)), mul = oc === -2 ? 0.25 : (oc === -1 ? 0.5 : 1);
    g.poly(cached("sub|" + mul + "|" + sl.toFixed(2) + "|" + key, function () {
      var p = [];
      for (var q = 0; q <= 60; q++) p.push(x + w * q / 60, mid - Math.sin(2 * Math.PI * cyc * mul * q / 60) * a * (0.25 + 0.75 * sl));
      return p;
    }), 2, anyHot(v, ["sub_level", "sub_octave"]) ? "slot" : mix(SUB, GROUND, 0.25));
  }
  for (var j = lines.length - 1; j >= 0; j--) {
    var c = j === 0 ? INK : mix(NEON, GROUND, 0.6 * (1 - st[j][2] / 0.667));
    for (var q = 0; q < lines[j].length; q++) g.poly(lines[j][q], j === 0 ? 2 : 1.5, lit && j === 0 ? "slot" : c);
  }
}

// where the filter envelope takes the cutoff: cutoff * 2^(env * 8 octaves),
// on Pung's axis (three decades from 20 Hz: the cutoff's own law, 20 * 1000^c)
function envReach(g, v, x, w, y, lit) {
  var amt = fr(v, "f_amount", 0), c = fr(v, "cutoff", 0.7);
  if (amt < 0.01 || !known(v, "f_amount")) return;
  var x0 = x + 6 + (w - 12) * c, x1 = x + 6 + (w - 12) * Math.min(1, c + amt * 8 / 9.966);
  g.fill(Math.round(x0), y, Math.max(2, Math.round(x1 - x0)), 2, lit ? "slot" : NEON);
  g.dot(x1, y + 1, 2.5, lit ? "slot" : NEON);
}

// ---- the front panel --------------------------------------------------------------------
var COL = 120, TOP = 22, BOT = 100;
var PLATES = [[0, 4, "THE STACK"], [4, 2, "FILTER"], [6, 2, "AMP"]];
// the encoder row's geometry: in segment mode Pung names the segments in the
// bottom 18 pixels, and the row moves up
function rowGeo(v) { return v.$segmode ? { name: 115, val: 132, led: 135, lh: 5 } : { name: 120, val: 141, led: 148, lh: 7 }; }
function ground(g, knobs, v) {
  var rg = rowGeo(v);
  g.layer("nusaw|" + knobs.join(",") + "|" + rg.led, function () {
    g.fill(0, 0, 960, 160, GROUND);
    for (var i = 0; i < PLATES.length; i++) {
      var x = PLATES[i][0] * COL + 4, w = PLATES[i][1] * COL - 8;
      g.fill(x, TOP, w, BOT - TOP, PANEL);
      g.fill(x, TOP, w, 1, RULE);
      g.text(x + 6, TOP + 11, PLATES[i][2], INK_DIM, -1);
    }
    g.fill(0, 103, 960, 1, RULE);
    for (var c = 1; c < 8; c++) g.fill(c * COL, 110, 1, 44, RULE);
    for (var k = 0; k < 8; k++) if (knobs[k]) for (var s = 0; s < 16; s++) g.fill(k * COL + 10 + s * 6, rg.led, 4, rg.lh, SEG_OFF);
  });
}
function header(g, v) {
  g.value(8, 17, "NUSAW", INK, -1);
  var x = 8 + g.measure("NUSAW", "value") + 10;
  g.text(x, 16, "SUPERSAW", INK_DIM, -1);
  x += g.measure("SUPERSAW") + 16;
  // the effects, lit where they are in the sound
  var fx = [["CHORUS", fr(v, "chorus_mix", 0)], ["DELAY", fr(v, "delay_mix", 0)]];
  for (var i = 0; i < fx.length; i++) {
    var on = fx[i][1] > 0.005, w = g.measure(fx[i][0]) + 10;
    g.fill(x, 5, w, 13, on ? NEON_DK : PANEL);
    g.text(x + 5, 15, fx[i][0], on ? NEON : INK_DIM, -1);
    x += w + 6;
  }
  var r = 950, n = known(v, "preset") ? (num(v, "preset", 0) + 1) + "/" + (txt(v, "preset_count") || "27") : "";
  if (n) { g.text(r, 16, n, INK_DIM, 1); r -= g.measure(n) + 12; }
  var oc = Math.round(num(v, "octave_transpose", 0));
  if (oc) { var os = "OCT " + (oc > 0 ? "+" : "") + oc; g.text(r, 16, os, NEON, 1); r -= g.measure(os) + 12; }
  var name = up(txt(v, "preset_name"));
  if (name) g.value(r, 17, name, INK, 1, r - x - 10);
}
// the active segment, as the panel says it: its plate's legend lit in the
// slot colour (Pung draws the bar above it)
var SEG_TITLE = { stack: [0, "THE STACK"], filter: [4, "FILTER"], amp: [6, "AMP"] };
function segLit(g, v) {
  if (v.$segmode !== "segment") return;
  var t = SEG_TITLE[v.$segment];
  if (t) {
    var x = t[0] * COL + 4, w = g.measure(t[1]) + 12;
    g.fill(x, TOP, w, 14, "slot"); g.text(x + 6, TOP + 11, t[1], "black", -1);
  }
}
function panel(g, v) {
  var n = sawCount(v), cents = outerCents(fr(v, "detune", 0.3));
  var lit = anyHot(v, ["saw_count", "detune", "spread"]);
  g.text(4 * COL - 10, TOP + 11, known(v, "saw_count") ? n + " SAWS  +-" + Math.round(cents) + " CENTS" : "", lit ? "slot" : INK_DIM, 1);
  drawFan(g, v, 14, TOP + 18, 210, BOT - TOP - 22, anyHot(v, ["saw_count", "spread"]));
  drawScope(g, v, 2 * COL + 6, TOP + 18, 2 * COL - 22, BOT - TOP - 24, anyHot(v, ["detune", "saw_count"]));
  // the filter: Pung's response, live, and how far the envelope opens it
  var fx = 4 * COL + 4, fw = 2 * COL - 8, h = hzText(20 * Math.pow(1000, fr(v, "cutoff", 0.7)));
  if (known(v, "cutoff")) g.text(fx + fw - 6, TOP + 11, h[0] + " " + h[1], hot(v, "cutoff") ? "slot" : INK_DIM, 1);
  g.filter(fx, TOP + 14, fw, BOT - TOP - 18, { cutoff: "cutoff", resonance: "resonance", type: "LP 12", color: INK });
  envReach(g, v, fx, fw, BOT - 6, hot(v, "f_amount"));
  // the amplifier
  var ax = 6 * COL + 4, aw = 2 * COL - 8;
  g.envelope(ax, TOP + 14, aw, BOT - TOP - 16, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", color: INK });
}

// how NuSaw's values read, everywhere (push.display): its knobs are 0..1
function readout(k, rawS) {
  var raw = parseFloat(rawS);
  if (isNaN(raw)) return null;
  switch (k) {
  case "saw_count": var n = clamp(Math.round(raw), 3, 25) | 1; return [String(n), "SAWS"];
  case "detune": return ["+-" + Math.round(outerCents(raw)), "CT"];
  case "cutoff": return hzText(20 * Math.pow(1000, raw));
  case "attack": case "decay": case "release": case "f_attack": case "f_decay": case "f_release": return msText(secs(raw));
  case "sub_octave": case "octave_transpose": return [(raw > 0 ? "+" : "") + Math.round(raw), "OCT"];
  case "delay_time": return [String(Math.round(Math.min(1000, 20 * Math.pow(50, raw)))), "MS"];
  case "delay_tone": var t = Math.min(12000, 500 * Math.pow(24, raw)); return hzText(t);
  case "f_amount": return ["+" + (raw * 8).toFixed(1), "OCT"];
  case "bend_range": return [String(Math.round(raw * 12)), "ST"];
  case "preset": return null;
  }
  return raw >= 0 && raw <= 1.0001 ? [String(Math.round(raw * 100)), "%"] : null;
}
push.display(function (key, raw) { var r = readout(key, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
// the encoder row: an LED bar under each name, the value in the engine's units
function shown(v, k) {
  if (!known(v, k)) return ["--", ""];
  var r = readout(k, v[k].value) || [txt(v, k), v[k].unit || ""];
  return r;
}
function row(g, v) {
  var knobs = v.$knobs || [];
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    var on = v.$touched === k, x0 = i * COL;
    var rg = rowGeo(v);
    g.text(x0 + 10, rg.name, up(v[k].name || k), on ? "slot" : INK_DIM, -1, COL - 20);
    var s = shown(v, k), uw = s[1] ? g.measure(s[1]) + 4 : 0;
    g.value(x0 + 10, rg.val, s[0], on ? "slot" : INK, -1, COL - 24 - uw);
    if (s[1]) g.text(x0 + 10 + Math.min(COL - 24 - uw, g.measure(s[0], "value")) + 4, rg.val, s[1], INK_DIM, -1);
    if (!known(v, k)) continue;
    var lit = Math.round(fr(v, k, 0) * 16);
    for (var j = 0; j < lit; j++) g.fill(x0 + 10 + j * 6, rg.led, 4, rg.lh, on ? "slot" : (j === lit - 1 ? INK : NEON));
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 31, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, INK_DIM, 1);
}

// Pung's default pages in NuSaw's violet and neon
push.theme({ ground: PANEL, ink: INK, dim: INK_DIM, rule: RULE, faint: SEG_OFF, accent: NEON, knob: "ring" });
push.compartment({
  id: "nusaw", label: "NuSaw", front_panel: true,
  pages: [{ label: "NuSaw", keys: ["saw_count", "detune", "spread", "sub_level", "cutoff", "resonance", "attack", "release"] }],
  extra_keys: ["preset", "preset_name", "preset_count", "octave_transpose", "sub_octave", "f_amount", "decay", "sustain",
    "chorus_mix", "delay_mix"],
  // the panel's sections under the hands: the stack, the filter, the amp, and
  // the effects over their lights in the header
  segments: [
    { id: "stack", label: "Stack", rect: [4, 22, 472, 78], keys: ["saw_count", "detune", "spread", "sub_level", "sub_octave", "octave_transpose"] },
    { id: "filter", label: "Filter", rect: [484, 22, 232, 78], keys: ["cutoff", "resonance", "f_amount", "f_attack", "f_decay", "f_sustain", "f_release"] },
    { id: "amp", label: "Amp", rect: [724, 22, 232, 78], keys: ["attack", "decay", "sustain", "release", "vel_sens", "volume", "bend_range"] },
    { id: "fx", label: "Effects", rect: [146, 0, 116, 20], keys: ["chorus_mix", "chorus_depth", "delay_mix", "delay_time", "delay_fback", "delay_tone"] }
  ],
  draws_segments: true,
  screen: function (g, v) {
    ground(g, v.$knobs || [], v);
    header(g, v);
    panel(g, v);
    segLit(g, v);
    row(g, v);
  }
});

// ---- SAWS: the stack, large ---------------------------------------------------------------
push.compartment({
  id: "saws", label: "Saws",
  pages: [{ label: "Saws", keys: ["saw_count", "detune", "spread", "sub_level", "sub_octave", "octave_transpose"] }],
  screen: function (g, v) {
    var n = sawCount(v), cents = outerCents(fr(v, "detune", 0.3)), sp = fr(v, "spread", 0.7);
    // cols 1-2: the fan; 3-4: the scope; 5: the sub; 6..8: the stack in numbers
    drawFan(g, v, 10, 2, 220, 82, anyHot(v, ["saw_count", "spread"]));
    drawScope(g, v, 246, 6, 228, 74, anyHot(v, ["detune", "saw_count", "spread"]));
    var sx = 4 * COL + 10, sl = fr(v, "sub_level", 0), oc = Math.round(num(v, "sub_octave", -1));
    var sh = anyHot(v, ["sub_level", "sub_octave"]);
    g.text(sx, 12, "SUB  SINE " + (oc ? oc + " OCT" : "UNISON"), sh ? "slot" : INK_DIM, -1);
    if (known(v, "sub_level")) {
      var mul = oc === -2 ? 0.25 : (oc === -1 ? 0.5 : 1), sw = 2 * COL - 30, a = 6 + 26 * sl;
      // one saw period for scale, faint; the sub against it
      g.poly([sx, 50 + 26, sx + sw / 2, 50 - 26, sx + sw / 2, 50 + 26, sx + sw, 50 - 26], 1, RULE);
      g.poly(cached("bsub|" + mul + "|" + sl.toFixed(2), function () {
        var p = [];
        for (var q = 0; q <= 48; q++) p.push(sx + sw * q / 48, 50 - Math.sin(2 * Math.PI * 2 * mul * q / 48) * a);
        return p;
      }), 2, sh ? "slot" : (sl > 0.005 ? SUB : RULE));
      g.text(sx, 84, sl > 0.005 ? Math.round(sl * 100) + "% UNDER THE SAWS" : "OFF", INK_DIM, -1);
    }
    var tx = 6 * COL + 10, lit = anyHot(v, ["saw_count", "detune", "spread"]);
    if (!known(v, "saw_count")) return;
    var gs = sideGain(sp), db = 20 * Math.log(gs) / Math.LN10;
    g.value(tx, 26, n + " SAWS", lit ? "slot" : INK, -1);
    g.text(tx, 46, "OUTER PAIR +-" + Math.round(cents) + " CENTS", INK_DIM, -1, 220);
    g.text(tx, 62, "SIDES " + Math.round(db) + " DB UNDER THE CENTRE", INK_DIM, -1, 220);
    var oct = Math.round(num(v, "octave_transpose", 0));
    g.text(tx, 78, "KEYS " + (oct ? (oct > 0 ? "+" : "") + oct + " OCT" : "AT PITCH"), hot(v, "octave_transpose") ? "slot" : INK_DIM, -1, 220);
  }
});

// ---- FILTER: the response and its envelope together -----------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: ["cutoff", "resonance", "f_amount", "f_attack", "f_decay", "f_sustain", "f_release"] }],
  screen: function (g, v) {
    var w = 3 * COL - 8;
    var h = hzText(20 * Math.pow(1000, fr(v, "cutoff", 0.7))), amt = fr(v, "f_amount", 0);
    g.text(10, 11, "LOW-PASS 12 DB", INK_DIM, -1);
    if (known(v, "cutoff")) g.text(w, 11, h[0] + " " + h[1] + (amt > 0.01 ? "  ENV +" + (amt * 8).toFixed(1) + " OCT" : ""), anyHot(v, ["cutoff", "f_amount"]) ? "slot" : INK_DIM, 1);
    g.filter(2, 14, w, 72, { cutoff: "cutoff", resonance: "resonance", type: "LP 12", color: INK });
    envReach(g, v, 2, w, 80, hot(v, "f_amount"));
    g.line(3 * COL, 4, 3 * COL, 84, 1, RULE);
    g.text(3 * COL + 10, 11, "FILTER ENVELOPE", anyHot(v, ["f_attack", "f_decay", "f_sustain", "f_release"]) ? INK : INK_DIM, -1);
    g.envelope(3 * COL + 4, 14, 4 * COL - 8, 72, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", labels: true, color: INK });
  }
});

// ---- AMP and PLAY: Pung's own envelope page -----------------------------------------------
push.compartment({
  id: "amp", label: "Amp",
  pages: [{ label: "Amp", keys: ["attack", "decay", "sustain", "release", "vel_sens", "volume", "bend_range"] }]
});

// ---- EFFECTS: the chorus's two delay lines, the ping-pong echoes ------------------------------
push.compartment({
  id: "fx", label: "Effects",
  pages: [{ label: "Chorus, Delay", keys: ["chorus_mix", "chorus_depth", "delay_mix", "delay_time", "delay_fback", "delay_tone"] }],
  screen: function (g, v) {
    // chorus (cols 1-2): a Juno-style I+II, its left and right delays swept
    // between 1.66 and 5.35 ms by two triangles (0.513 and 0.863 Hz)
    var cm = fr(v, "chorus_mix", 0), cd = fr(v, "chorus_depth", 0.5), on = cm > 0.005, ch = anyHot(v, ["chorus_mix", "chorus_depth"]);
    g.text(10, 11, "CHORUS", on ? INK : INK_DIM, -1);
    g.text(2 * COL - 10, 11, on ? "MIX " + Math.round(cm * 100) + "%" : "OFF", ch ? "slot" : INK_DIM, 1);
    var cx = 10, cw = 2 * COL - 20, top = 20, bot = 78;
    function yMs(ms) { return bot - (ms - 1.66) / (5.35 - 1.66) * (bot - top); }
    g.fill(cx, Math.round(yMs(3.505)), cw, 1, RULE);
    g.text(cx, top + 4, "5.4 MS", INK_DIM, -1); g.text(cx, bot + 8, "1.7 MS", INK_DIM, -1);
    if (known(v, "chorus_depth")) {
      var lines = cached("ch|" + cd.toFixed(2), function () {
        var l = [], r = [];
        for (var i = 0; i <= 64; i++) {
          var t = i / 64 * 4, p1 = (t * 0.513) % 1, p2 = (t * 0.863) % 1;
          var t1 = 2 * Math.abs(2 * p1 - 1) - 1, t2 = 2 * Math.abs(2 * p2 - 1) - 1, c = 3.505, d = 1.845 * cd;
          l.push(cx + 44 + (cw - 44) * i / 64, yMs(c + (t1 + t2) * 0.5 * d));
          r.push(cx + 44 + (cw - 44) * i / 64, yMs(c + (-t1 + t2) * 0.5 * d));
        }
        return [l, r];
      });
      g.poly(lines[1], 1.5, on ? (ch ? "slot" : NEON) : RULE);
      g.poly(lines[0], 2, on ? (ch ? "slot" : INK) : RULE);
    }
    // delay (cols 3-8): echoes every 20 * 50^t ms (1 s at most), each the
    // feedback's share of the last and duller by the tone (its feedback
    // crosses the channels: a side's echo returns on the other side)
    g.line(2 * COL, 4, 2 * COL, 84, 1, RULE);
    var dm = fr(v, "delay_mix", 0), fb = Math.min(0.95, fr(v, "delay_fback", 0.3)), dt = Math.min(1000, 20 * Math.pow(50, fr(v, "delay_time", 0.5)));
    var tone = 500 * Math.pow(24, fr(v, "delay_tone", 0.5)), dh = anyHot(v, ["delay_mix", "delay_time", "delay_fback", "delay_tone"]);
    var x0 = 2 * COL + 10, x1 = 8 * COL - 10, mid = 48, ext = 30, span = 4000;
    g.text(x0, 11, "DELAY", dm > 0.005 ? INK : INK_DIM, -1);
    g.text(x1, 11, dm > 0.005 ? Math.round(dt) + " MS  FEEDBACK " + Math.round(fb * 100) + "%  TONE " + (tone >= 1000 ? (tone / 1000).toFixed(1) + " KHZ" : Math.round(tone) + " HZ") : "OFF", dh ? "slot" : INK_DIM, 1);
    g.fill(x0, mid, x1 - x0, 1, RULE);
    for (var s = 1; s * 1000 < span; s++) { var sx = x0 + 12 + (x1 - x0 - 12) * s * 1000 / span; g.fill(Math.round(sx), mid - 2, 1, 5, INK_DIM); g.text(sx, 84, s + " S", INK_DIM, 0); }
    if (!known(v, "delay_time") || dm < 0.005) { g.fill(x0 + 12, mid - ext, 3, 2 * ext, INK); return; } // the note itself
    var a = dm, dull = clamp(1 - tone / 12000, 0, 1);
    function hOf(l) { return Math.max(2, Math.round(ext * clamp((20 * Math.log(l) / Math.LN10 + 36) / 36, 0, 1))); }
    var dh0 = hOf(1 - dm);
    g.fill(x0 + 12, mid - dh0, 3, 2 * dh0, INK);
    for (var e = 1; e < 40; e++) {
      var t = e * dt;
      if (t > span || a < 0.016) break;
      var ex = Math.round(x0 + 12 + (x1 - x0 - 12) * t / span), eh = hOf(a);
      var col = dh ? "slot" : mix(NEON, PANEL, Math.min(0.8, dull * 0.15 * e));
      g.fill(ex, mid - eh, 3, 2 * eh, col);
      a *= fb;
    }
  }
});
