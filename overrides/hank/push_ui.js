// Hank on the Push: two-operator FM on eight knobs, one page.
//
// Hank is small on purpose: eight macros are the whole instrument, and each
// drives several engine values at once (the module's README). The front
// panel draws what each macro does, over its own knob:
//
//   RATIO, BRIGHT   the partials: the carrier and its sidebands, spaced by
//                   the ratio (whole ratios land on the harmonics, the rest
//                   are bells and metal), as wide as Bright's index reaches
//   BITE            the modulator's own wave (OP2), bent toward a saw by its
//                   feedback, and the shaper's share once Bite passes 0.35
//   TONE            the low-pass where Tone puts it (600 Hz to 18 kHz at
//                   middle C), with the resonance Hank derives from it
//   ATTACK..SUSTAIN Pung's envelope; Decay is also the release
//   NOISE           the noise burst: it rides the modulator's envelope,
//                   2.2x shorter than the carrier's, so it is a chiff unless
//                   Sustain holds it open
//
// The look: undyed wool. A dark ground, cream ink, and one ochre thread: the
// modulator, and the yarn wound round each knob as far as it is turned.

var GROUND = "#1b191d", PANEL = "#242126", RULE = "#3a353c", INK = "#efe6d2", INK_DIM = "#a79f92";
var YARN = "#e3a535", YARN_DK = "#6e5020", KNOB = "#0f0e10", KNOB_RIM = "#4a434b";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
// Where the sound has a control now (v[k].now: the module's live_mod, the newest voice's while a
// note sounds: BRIGHT as the modulator's envelope scales the index, TONE with its keytracking),
// 0..1 of its range; null when nothing moves it. The knob's own mark stays where the knob is; the
// sound's place goes beside it in the modulation colour.
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? clamp(v[k].now, 0, 1) : null; }
function moved(v, k) { var n = nowOf(v, k); return n !== null && Math.abs(n - v[k].frac) > 0.004; }
function frNow(v, k, d) { var n = nowOf(v, k); return n === null ? fr(v, k, d) : n; }

// ---- the engine's own laws (hank_curves.h, hank_engine.cpp applyMacros) -------------
var RATIOS = [0.5, 1, 1.5, 2, 2.5, 3, 3.7, 4, 5, 5.4, 6, 7, 8, 9.2, 11, 14];
function ratioOf(v) { return known(v, "ratio") ? RATIOS[clamp(Math.round(num(v, "ratio", 4)), 0, 15)] : null; }
function indexOf(bright) { return bright * bright * 14; }                       // radians
function feedbackOf(bright, bite) {                                          // op2_fbk 0..1
  var fb = bite < 0.6 ? bite / 0.6 : 1, top = clamp((bright - 0.66) / 0.34, 0, 1);
  return fb * 0.75 + top * 0.25;
}
function shaperOf(bite) { return bite < 0.35 ? 0 : (bite - 0.35) / 0.65; }
function atkTau(x) { return 0.0005 * Math.pow(1200, clamp(x, 0, 1)); }
function envTau(x) { return 0.0015 * Math.pow(800, clamp(x, 0, 1)); }
var ATTACK_SPAN = 1.609, SETTLE = 6.91; // an attack lasts 1.609 taus; a decay is heard to -60 dB (6.91 taus)

// The envelope's dots run on Hank's own times: Pung would otherwise guess
// from the knobs' travel (they are 0..1 with no unit).
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null) return null;
    if (s.role === "attack") return ATTACK_SPAN * atkTau(s.raw);
    if (s.role === "decay" || s.role === "release") return SETTLE * envTau(s.raw);
    return null;
  });
});

// ---- the partials ----------------------------------------------------------------------
// A two-operator voice is sin(wc t + I sin(wm t)): partials at the carrier
// plus and minus every multiple of the modulator, each J_n(I) strong.
function besselJ(n, x) {
  var s = 0, t = Math.pow(x / 2, n);
  for (var k = 1; k <= n; k++) t /= k;
  for (var k2 = 0; k2 < 60; k2++) {
    s += t;
    t *= -(x / 2) * (x / 2) / ((k2 + 1) * (k2 + 1 + n));
    if (Math.abs(t) < 1e-9 && k2 > x) break;
  }
  return s;
}
var memo = {};
function cached(key, make) { if (!(key in memo)) { if (Object.keys(memo).length > 64) memo = {}; memo[key] = make(); } return memo[key]; }
var HMAX = 16; // the picture shows the harmonics 1..16 of the played note
function partials(ratio, index) {
  return cached("p|" + ratio + "|" + index.toFixed(3), function () {
    var bins = {};
    for (var n = -40; n <= 40; n++) {
      var a = besselJ(Math.abs(n), index) * (n < 0 && (n % 2) ? -1 : 1);
      var f = 1 + n * ratio;
      if (f < 0) { f = -f; a = -a; } // a negative frequency folds back, inverted
      if (f > HMAX + 0.5 || f < 0.01) continue;
      var key = f.toFixed(3);
      bins[key] = (bins[key] || 0) + a;
    }
    var out = [];
    for (var k in bins) out.push([parseFloat(k), Math.abs(bins[k])]);
    return out;
  });
}
function dbH(a) { var db = 20 * Math.log(Math.max(a, 1e-6)) / Math.LN10; return clamp((db + 42) / 42, 0, 1); }

// the modulator's own wave over one carrier period: as Hank's own canvas
// draws it (ui/canvas.js), its feedback loop bending the sine toward a saw
function modWave(ratio, bright, fbk, n) {
  var depth = fbk * fbk * 6, turns = ratio > 6 ? 6 / ratio : 1, fb = 0, out = [];
  for (var w = 0; w < 64; w++) { var p = w / 64 * ratio; fb = 0.5 * (fb + Math.sin(2 * Math.PI * (p + fb * depth / (2 * Math.PI)))); }
  for (var i = 0; i < n; i++) {
    var t = i / (n - 1) * turns, m = Math.sin(2 * Math.PI * (t * ratio + fb * depth / (2 * Math.PI)));
    fb = 0.5 * (fb + m);
    out.push(m * (0.42 + 0.58 * bright));
  }
  return out;
}

// ---- the panel ------------------------------------------------------------------------
var COL = 120, TOP = 24, BOT = 98;
var CATS = { "round bass": "BASS", "sub": "BASS", "growl bass": "BASS", "pluck bass": "BASS", "clank bass": "BASS",
  "e piano": "KEYS", "marimba": "KEYS", "wood key": "KEYS", "clav": "KEYS", "soft key": "KEYS",
  "thimble": "BELL", "big bell": "BELL", "glass": "BELL", "gamelan": "BELL",
  "brass": "LEAD", "reed lead": "LEAD", "square lead": "LEAD", "sync lead": "LEAD",
  "soft pad": "PAD", "breath pad": "PAD", "glass pad": "PAD", "dark pad": "PAD", "swell": "PAD",
  "tom": "PERC", "snare": "PERC", "rim click": "PERC", "closed hat": "PERC", "open hat": "PERC", "shaker": "PERC",
  "zap": "FX", "wind": "FX", "drone": "FX" };

var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
// the encoder row's geometry: while segment mode is on, Pung names the
// segments in the bottom 18 pixels, and the row moves up and tightens
function rowGeo(v) { return v.$segmode ? { ky: 126, rs: 0.8, name: 117, val: 138 } : { ky: 139, rs: 1, name: 120, val: 146 }; }
function ground(g, knobs, v) {
  var rg = rowGeo(v);
  g.layer("hank|" + knobs.join(",") + "|" + rg.ky, function () {
    g.fill(0, 0, 960, 160, GROUND);
    // the sections' plates, over their knobs
    var plates = [[0, 2, "PARTIALS"], [2, 1, "OP2"], [3, 1, "TONE"], [4, 3, "ENVELOPE"], [7, 1, "NOISE"]];
    for (var i = 0; i < plates.length; i++) {
      var x = plates[i][0] * COL + 4, w = plates[i][1] * COL - 8;
      g.fill(x, TOP, w, BOT - TOP + 2, PANEL);
      g.text(x + 6, TOP + 11, plates[i][2], INK_DIM, -1);
    }
    // the harmonic grid under the partials: 1..16 of the played note
    for (var h = 1; h <= HMAX; h++) {
      var hx = Math.round(pxOf(h));
      g.fill(hx, PBASE + 1, 1, 3, h === 1 ? INK_DIM : RULE);
      if (h === 1 || h === 2 || h === 4 || h === 8 || h === 16) g.text(hx, BOT - 3, String(h), INK_DIM, 0);
    }
    g.fill(PX0 - 4, PBASE, PX1 - PX0 + 8, 1, RULE);
    // the encoder row: a rule, the knobs' bodies and their scales
    g.fill(0, 102, 960, 2, "#000000");
    for (var c = 0; c < 8; c++) {
      if (!knobs[c]) continue;
      var kx = c * COL + 27, ky = rg.ky;
      if (c) g.fill(c * COL, 110, 1, v.$segmode ? 30 : 44, RULE);
      g.arc(kx, ky, 17 * rg.rs, A0, SWEEP, 1, RULE);
      g.dot(kx, ky, 13 * rg.rs, KNOB_RIM); g.dot(kx, ky, 11.5 * rg.rs, KNOB);
    }
  });
}

function header(g, v) {
  g.value(8, 17, "HANK", INK, -1);
  g.text(8 + g.measure("HANK", "value") + 10, 16, "2-OP FM", INK_DIM, -1);
  var name = txt(v, "preset_name"), cat = CATS[String(name).toLowerCase()] || "";
  var n = known(v, "preset") ? (num(v, "preset", 0) + 1) + "/" + (txt(v, "preset_count") || "32") : "";
  var x = 950;
  if (n) { g.text(x, 16, n, INK_DIM, 1); x -= g.measure(n) + 12; }
  if (name) { g.value(x, 17, up(name), INK, 1, 360); x -= Math.min(360, g.measure(up(name), "value")) + 12; }
  if (cat) { var cw = g.measure(cat) + 10; g.fill(x - cw, 5, cw, 13, YARN_DK); g.text(x - cw / 2, 15, cat, YARN, 0); }
}

function hot(v, k) { return v.$touched === k; }

// RATIO and BRIGHT: the partials
var PX0 = 12, PX1 = 2 * COL - 12, PTOP = TOP + 18, PBASE = BOT - 14;
function pxOf(f) { return PX0 + (PX1 - PX0) * ((f - 0.5) / HMAX); }
function drawPartials(g, v) {
  var r = ratioOf(v), lit = hot(v, "ratio") || hot(v, "bright");
  if (r === null || !known(v, "bright")) { g.text((PX0 + PX1) / 2, (PTOP + PBASE) / 2, "--", INK_DIM, 0); return; }
  var bright = fr(v, "bright", 0.35), idx = indexOf(bright), sus = 0.30 + 0.55 * fr(v, "sustain", 0.7);
  var ps = partials(r, idx), held = partials(r, idx * sus);
  var whole = Math.abs(r * 2 - Math.round(r * 2)) < 0.01 && (r >= 1 ? Math.abs(r - Math.round(r)) < 0.01 : true);
  // the title line: the ratio over its knob, what it makes, Bright's index over its knob
  var rs = "x" + (r % 1 ? r.toFixed(1) : String(r));
  g.fill(4, TOP, 2 * COL - 8, 14, PANEL);
  g.text(10, TOP + 11, rs, hot(v, "ratio") ? "slot" : YARN, -1);
  g.text(10 + g.measure(rs) + 8, TOP + 11, whole ? "HARMONIC" : "BELL, METAL", hot(v, "ratio") ? "slot" : INK_DIM, -1);
  g.text(2 * COL - 10, TOP + 11, "INDEX " + idx.toFixed(1), hot(v, "bright") ? "slot" : INK_DIM, 1);
  var h = PBASE - PTOP;
  // held: once the modulator's envelope has settled, wide and dark, behind
  for (var j = 0; j < held.length; j++) {
    var hh = Math.round(h * dbH(held[j][1]));
    if (hh > 1) g.fill(Math.round(pxOf(held[j][0])) - 3, PBASE - hh, 7, hh, YARN_DK);
  }
  // struck: at the top of the attack, where Bright's whole index reaches
  for (var i = 0; i < ps.length; i++) {
    var ph = Math.round(h * dbH(ps[i][1]));
    if (ph < 1) continue;
    var carrier = Math.abs(ps[i][0] - 1) < 0.001;
    g.fill(Math.round(pxOf(ps[i][0])) - 1, PBASE - ph, 3, ph, lit ? "slot" : (carrier ? INK : YARN));
  }
  // now: the partials at the index the sound has this moment, a cap on each in the modulation colour
  if (moved(v, "bright")) {
    var now = partials(r, indexOf(nowOf(v, "bright")));
    for (var q = 0; q < now.length; q++) {
      var nh = Math.round(h * dbH(now[q][1]));
      if (nh >= 1) g.fill(Math.round(pxOf(now[q][0])) - 3, PBASE - nh - 1, 7, 2, MOD);
    }
  }
}

// BITE: the modulator's own wave, its feedback, the shaper
function bar(g, x, y, w, label, f, on, lit) {
  g.text(x, y, label, f > 0.004 ? INK : INK_DIM, -1);
  var bx = x + 58, bw = w - 58;
  g.fill(bx, y - 4, bw, 2, RULE);
  if (f > 0.004) g.fill(bx, y - 5, Math.max(2, Math.round(bw * f)), 4, lit ? "slot" : YARN);
}
function drawModulator(g, v) {
  var x = 2 * COL + 4, w = COL - 8, r = ratioOf(v);
  var bright = fr(v, "bright", 0.35), bite = fr(v, "bite", 0), fbk = feedbackOf(bright, bite), sh = shaperOf(bite);
  // the wave as the sound has it now: the modulator's envelope scales its level and its feedback alike
  var bn = frNow(v, "bright", bright), fbn = bright > 0.0001 ? fbk * bn / bright : fbk;
  var cx = x + 8, cw = w - 16, cy = TOP + 35, ch = 24;
  if (r === null || !known(v, "bite")) { g.text(x + w / 2, cy + 4, "--", INK_DIM, 0); return; }
  g.text(x + w - 6, TOP + 11, "x" + (r % 1 ? r.toFixed(1) : String(r)), INK_DIM, 1);
  var pts = cached("m|" + r + "|" + bn.toFixed(2) + "|" + fbn.toFixed(2), function () {
    var wv = modWave(r, bn, fbn, 52), out = [];
    for (var i = 0; i < wv.length; i++) out.push(cx + cw * i / (wv.length - 1), cy - wv[i] * ch / 2);
    return out;
  });
  g.fill(cx, cy, cw, 1, RULE);
  g.poly(pts, 2, hot(v, "bite") || hot(v, "ratio") || hot(v, "bright") ? "slot" : YARN);
  // Bite's two halves: the operator's feedback first, then the shaper
  bar(g, x + 6, BOT - 16, w - 12, "FEEDBACK", fbk, true, hot(v, "bite"));
  bar(g, x + 6, BOT - 4, w - 12, "SHAPER", sh, true, hot(v, "bite"));
}

// TONE: the low-pass where Hank puts it, with its derived resonance
function drawTone(g, v) {
  var x = 3 * COL + 4, w = COL - 8, t = fr(v, "tone", 0.8);
  if (!known(v, "tone")) { g.filter(x, TOP + 14, w, BOT - TOP - 12, { cutoff: "tone" }); return; }
  var tn = frNow(v, "tone", t);                              // where the sound has it (keytracking: the newest note's)
  var u = 0.4924 * (1 + tn);                                 // 600 Hz * 30^tone at middle C, on Pung's 20 Hz..20 kHz axis
  var peak = Math.max(0, 1 - Math.abs(t - 0.55) / 0.55) * 0.55, q = 1 / (2 - 1.85 * peak);
  var res = clamp(Math.log(q / 0.707) / Math.LN10 / 1.15, 0, 1);
  g.filter(x - 2, TOP + 14, w + 4, BOT - TOP - 12, { cutoff: "tone", at: u, resonance: res, type: "LP 12", color: INK });
  if (moved(v, "tone")) { // the knob's place at the foot, the way to the sound's in the modulation colour
    var fx0 = x - 2, fw = w + 4, yb = BOT - 5, xs = fx0 + fw * 0.4924 * (1 + t), xn = fx0 + fw * u;
    g.fill(Math.round(xs), yb - 5, 2, 7, INK);
    g.fill(Math.min(xs, xn), yb, Math.abs(xn - xs), 2, MOD_DK);
    g.dot(xn, yb + 1, 3, MOD);
  }
  var hz = 600 * Math.pow(30, t);
  var rd = readout("tone", t);
  g.text(x + w - 4, TOP + 11, rd[0] + " " + up(rd[1]), hot(v, "tone") ? "slot" : INK_DIM, 1);
}

// ATTACK, DECAY, SUSTAIN: Pung's envelope; Decay is also the release
function drawEnvelope(g, v) {
  var x = 4 * COL + 4, w = 3 * COL - 8;
  g.text(x + w - 6, TOP + 11, "RELEASE = DECAY", INK_DIM, 1);
  g.envelope(x, TOP + 14, w, BOT - TOP - 12, { attack: "attack", decay: "decay", sustain: "sustain", release: "decay", labels: true, color: INK });
}

// NOISE: a burst on the modulator's envelope (2.2x shorter, sustain 0.30 + 0.55 s)
function rnd(i) { var s = Math.sin(i * 91.17 + 7.3) * 43758.5453; return s - Math.floor(s); }
function drawNoise(g, v) {
  var x = 7 * COL + 4, w = COL - 8, n = fr(v, "noise", 0), cy = TOP + 50, hh = 28;
  if (!known(v, "noise")) { g.text(x + w / 2, cy + 4, "--", INK_DIM, 0); return; }
  if (n < 0.005) { g.fill(x + 8, cy, w - 16, 1, RULE); g.text(x + w / 2, cy + 22, "OFF", INK_DIM, 0); return; }
  var a = fr(v, "attack", 0), d = fr(v, "decay", 0.45), s = fr(v, "sustain", 0.7);
  var pts = cached("n|" + n.toFixed(2) + "|" + a.toFixed(2) + "|" + d.toFixed(2) + "|" + s.toFixed(2), function () {
    var ta = ATTACK_SPAN * atkTau(a) * 0.7, td = envTau(d) * 0.45, ms = 0.30 + 0.55 * s;
    var span = Math.max(0.12, ta + SETTLE * envTau(d) * 0.6), out = [], amp = n * n * 0.75 + 0.25 * n;
    for (var i = 0; i <= 50; i++) {
      var t = i / 50 * span, e = t < ta ? t / ta : ms + (1 - ms) * Math.exp(-(t - ta) / td);
      var r = (rnd(i) * 2 - 1) * e * amp;
      out.push(x + 8 + (w - 16) * i / 50, cy - r * hh);
    }
    return out;
  });
  g.fill(x + 8, cy, w - 16, 1, RULE);
  g.poly(pts, 1.5, hot(v, "noise") ? "slot" : INK);
  g.text(x + w / 2, BOT - 6, s > 0.5 ? "HELD OPEN" : "A CHIFF", INK_DIM, 0);
}

// ---- how Hank's values read, everywhere (push.display): its knobs are 0..1 ---------
function secText(t) { return t < 1 ? [String(Math.round(t * 1000)), "ms"] : [t.toFixed(t < 10 ? 2 : 1), "s"]; }
function readout(k, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return null;
  switch (k) {
  case "ratio": var r = RATIOS[clamp(Math.round(x), 0, 15)]; return ["x" + (r % 1 ? r.toFixed(1) : String(r)), ""];
  case "attack": return secText(ATTACK_SPAN * atkTau(x));
  case "decay": return secText(SETTLE * envTau(x));
  case "tone": var hz = 600 * Math.pow(30, clamp(x, 0, 1)); return hz < 1000 ? [String(Math.round(hz)), "Hz"] : [(hz / 1000).toFixed(1), "kHz"];
  case "bright": case "bite": case "sustain": case "noise": case "glide": case "volume": return [String(Math.round(x * 100)), "%"];
  }
  return null;
}
push.display(function (key, raw) { var r = readout(key, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
function shown(v, k) {
  if (!known(v, k)) return ["--", ""];
  return readout(k, v[k].value) || [txt(v, k), v[k].unit || ""];
}
function row(g, v) {
  var knobs = v.$knobs || [];
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    var rg = rowGeo(v), on = v.$touched === k, x0 = i * COL, kx = x0 + 27, ky = rg.ky, f = fr(v, k, 0), rs = rg.rs;
    var name = up(v[k].name || k);
    g.text(x0 + 52, rg.name, name, on ? "slot" : INK_DIM, -1, COL - 58);
    if (known(v, k)) {
      // the yarn, wound from the scale's start to where the knob stands
      if (f > 0.004) g.arc(kx, ky, 17 * rs, A0, SWEEP * f, 3, on ? "slot" : YARN);
      var a = A0 + SWEEP * f;
      g.line(kx + Math.cos(a) * 3, ky + Math.sin(a) * 3, kx + Math.cos(a) * 10.5 * rs, ky + Math.sin(a) * 10.5 * rs, 2.5, on ? "slot" : INK);
      if (moved(v, k)) { // the sound's place: an arc from the knob's, a dot
        var n = nowOf(v, k);
        g.arc(kx, ky, 21 * rs, A0 + SWEEP * Math.min(f, n), SWEEP * Math.abs(n - f), 2, MOD_DK);
        g.dot(kx + Math.cos(A0 + SWEEP * n) * 21 * rs, ky + Math.sin(A0 + SWEEP * n) * 21 * rs, 2.8, MOD);
      }
    }
    var s = shown(v, k), uw = s[1] ? g.measure(s[1]) + 3 : 0;
    g.value(x0 + 52, rg.val, s[0], on ? "slot" : INK, -1, COL - 58 - uw);
    if (s[1]) g.text(x0 + 52 + Math.min(COL - 58 - uw, g.measure(s[0], "value")) + 3, rg.val, s[1], INK_DIM, -1);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 31, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, INK_DIM, 1);
}

// Pung's default pages in undyed wool: cream ink, the ochre yarn round each knob
push.theme({ ground: GROUND, panel: KNOB, ink: INK, dim: INK_DIM, rule: KNOB_RIM, faint: RULE, accent: YARN, knob: "pointer" });
push.compartment({
  id: "hank", label: "Hank", front_panel: true,
  pages: [{ label: "Hank", keys: ["ratio", "bright", "bite", "tone", "attack", "decay", "sustain", "noise"] }],
  extra_keys: ["preset", "preset_name", "preset_count"],
  // two segments: the sound (the eight macros), and Setup over the header
  segments: [
    { id: "sound", label: "Hank", rect: [4, 24, 952, 78], keys: ["ratio", "bright", "bite", "tone", "attack", "decay", "sustain", "noise"] },
    { id: "setup", label: "Setup", rect: [0, 0, 960, 21], keys: ["voice_count", "glide", "pitch", "volume", "preset"] }
  ],
  screen: function (g, v) {
    ground(g, v.$knobs || [], v);
    header(g, v);
    drawPartials(g, v);
    drawModulator(g, v);
    drawTone(g, v);
    drawEnvelope(g, v);
    drawNoise(g, v);
    row(g, v);
  }
});

// Setup: voices, glide, transpose, volume and the preset list (knobs)
push.compartment({
  id: "setup", label: "Setup",
  pages: [{ label: "Setup", keys: ["voice_count", "glide", "pitch", "volume", "preset"] }]
});
