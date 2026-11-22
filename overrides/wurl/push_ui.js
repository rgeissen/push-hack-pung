// Wurl (a physically modelled 200A-style electric piano, OpenWurli's model;
// the module's own name) on Push. An overlay shipped with Pung (the module
// ships no push_ui.js).
//
// The instrument is a row of steel reeds struck by hammers, read by an
// electrostatic pickup, through a small amplifier with a light-dependent
// vibrato and its speakers. Its own panel has two knobs (volume, vibrato);
// the module adds the rest of the physics. The screens show that physics:
//
//   PANEL  the front panel, on the piano's black lid: the reed bar over the
//          keyboard, 64 reeds from A to C, each as long as the module's reed
//          (3 inches in the bass to 1 in the treble), the bass reeds with
//          their tip weights. A key played lights its key, and its reed
//          swings as wide as the hammer struck it (the module's velocity
//          curve), dying away at the module's own rate for that reed and
//          stopped by the damper when the key is let go. Beside it the
//          amplifier: the vibrato (the module's fixed 5.63 Hz, as deep as the
//          knob), the Darken low pass at its corner, the spring. The encoders
//          are the module's eight knobs; the menu's three on a second page.
//   REEDS  what a struck reed sounds like: the pickup's harmonics (its
//          C0/(1-y) nonlinearity: the bark) and the reed's own inharmonic
//          beam modes (the brightness) on one axis; the strike and the ring
//          (Pung's envelope, on the reed's own times at middle C); the
//          pickup's output for one swing of the reed.
//   AMP    the chain after the reeds in its order: vibrato, power amp and
//          speaker (its band), Darken, the spring, the volume.
//
// The engine's units (src/dsp/wurl.c): volume is a squared taper; vibrato
// 5.63 Hz, depth the knob; onset ramp (2.5 + 2.5 (1 - vel)) / f0 clamped
// 2..30 ms, times 4 - 3.8 attack, clamped 1..100 ms; fundamental decay
// 0.005 f0^1.22 dB/s (at least 3), mode m times its ratio squared, all times
// 5.7 - 5.4 decay; brightness scales the upper modes 0.05..1..3; pickup
// displacement 0.75 (compliance / compliance at C4)^0.75 (0.02..0.82) times
// 0.3 + 1.4 bark; Darken 20 kHz * (800/20000)^amount (off at 0); speaker
// 0 flat, 1 the cabinet (HPF 20 -> 95 Hz, LPF 20 k -> 5.5 kHz); spring
// macro: mix 0.85 k (0.6 + 0.4 k), damping 1.2 + 2.8 k kHz; tune +-100 cents.

// ---- the piano's colours ---------------------------------------------------------------
var LID = "#15110e", BAY = "#0b0908", RAIL = "#3a3029", CHROME = "#a7a49c", CHROME_LO = "#5a5650";
var IVORY = "#ebe2cb", IVORY_LO = "#b9af98", EBONY = "#050404", INK = "#ece3cc", INK_DIM = "#9a8f79", INK_FAINT = "#4d443a";
var STEEL = "#6f777e", STEEL_HI = "#b4bcc2", AMBER = "#f2b45a", CAP = "#e2d8bf", CAP_RIM = "#7d7464", CAP_LINE = "#1c1612";

// ---- values ------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? Math.max(0, Math.min(1, v[k].frac)) : d; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
var PRESETS = ["Classic 200A", "Dreamy Keys", "Barky Soul", "Surf Spring", "Dark Ballad", "Percussive Clav",
  "Warm Pad", "Lo-Fi Tape", "Bright Bell", "Gospel Growl"];
function presetName(v) {
  if (!known(v, "preset")) return "";
  var n = parseInt(v.preset.value, 10);
  return n >= 0 && n < PRESETS.length ? PRESETS[n] : "";
}

// ---- the engine's physics (wurl.c) ---------------------------------------------------------
var TREM_HZ = 5.63;
function hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
function reedInches(n) { var k = clamp(n - 32, 1, 64); return k <= 20 ? 3 - k / 20 : 2 - (k - 20) / 44; }
function tipMass(n) {
  var a = [[33, 0.10], [52, 0], [62, 0], [74, 0.02], [96, 0.01]];
  if (n <= a[0][0]) return a[0][1];
  if (n >= a[4][0]) return a[4][1];
  for (var i = 0; i < 4; i++) if (n <= a[i + 1][0]) { var t = (n - a[i][0]) / (a[i + 1][0] - a[i][0]); return a[i][1] + t * (a[i + 1][1] - a[i][1]); }
  return 0;
}
// the beam's eigenvalues (no tip mass: the middle of the keyboard)
var BETAS = [1.8751, 4.6941, 7.8548, 10.9955, 14.1372, 17.2788, 20.4204];
var MODE_AMPS = [1.0, 0.005, 0.0035, 0.0018, 0.0011, 0.0007, 0.0005];
var EIG_MU = [0, 0.01, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50];
var EIG = [
  [1.8751, 4.6941, 7.8548, 10.9955, 14.1372, 17.2788, 20.4204], [1.8584, 4.6849, 7.8504, 10.9930, 14.1356, 17.2776, 20.4195],
  [1.7920, 4.6477, 7.8316, 10.9830, 14.1288, 17.2726, 20.4158], [1.7227, 4.6024, 7.8077, 10.9700, 14.1198, 17.2660, 20.4110],
  [1.6625, 4.5618, 7.7859, 10.9580, 14.1114, 17.2598, 20.4065], [1.6097, 4.5254, 7.7659, 10.9470, 14.1036, 17.2540, 20.4023],
  [1.5201, 4.4620, 7.7310, 10.9280, 14.0894, 17.2434, 20.3946], [1.3853, 4.3601, 7.6745, 10.8970, 14.0650, 17.2252, 20.3814]];
function modeRatios(n) {
  var mu = clamp(tipMass(n), 0, 0.5), lo = 0;
  for (var i = EIG_MU.length - 1; i >= 0; i--) if (EIG_MU[i] <= mu) { lo = i; break; }
  var hi = Math.min(lo + 1, EIG_MU.length - 1), t = EIG_MU[hi] > EIG_MU[lo] ? (mu - EIG_MU[lo]) / (EIG_MU[hi] - EIG_MU[lo]) : 0;
  var b = [], out = [];
  for (var m = 0; m < 7; m++) b.push(EIG[lo][m] + t * (EIG[hi][m] - EIG[lo][m]));
  for (m = 0; m < 7; m++) out.push(b[m] * b[m] / (b[0] * b[0]));
  return out;
}
function fundDecayDb(n) { return Math.max(3, 0.005 * Math.pow(hz(n), 1.22)); } // dB a second
function decayMult(v) { return 5.7 - 5.4 * fr(v, "decay", 0.5); }
function ring60(v, n) { return 60 / (fundDecayDb(n) * decayMult(v)); } // seconds to fall 60 dB
function onsetS(v, n, vel) {
  var base = clamp((2.5 + 2.5 * (1 - vel)) / hz(n), 0.002, 0.030);
  return clamp(base * (4 - 3.8 * fr(v, "attack", 0.5)), 0.001, 0.100);
}
function brightScale(b) { return b < 0.5 ? 0.05 + b * 1.9 : 1 + (b - 0.5) * 4; }
function velCurve(vel) {
  var k = 1.5, s = 1 / (1 + Math.exp(-k * (vel - 0.5))), s0 = 1 / (1 + Math.exp(k * 0.5)), s1 = 1 / (1 + Math.exp(-k * 0.5));
  return (s - s0) / (s1 - s0);
}
function velExp(n) { return 1.3 + 0.4 * Math.exp(-0.5 * Math.pow((n - 62) / 15, 2)); }
function reedBlank(n) {
  var r = clamp(n - 32, 1, 64);
  var w = r <= 14 ? 0.151 : r <= 20 ? 0.127 : r <= 42 ? 0.121 : r <= 50 ? 0.111 : 0.098;
  var t = r <= 16 ? 0.026 : (r <= 26 ? 0.026 + (r - 16) / 10 * 0.008 : 0.034);
  return [w * 25.4, t * 25.4];
}
function compliance(n) { var l = reedInches(n) * 25.4, b = reedBlank(n); return l * l * l / (b[0] * b[1] * b[1] * b[1]); }
function pickupScale(n) { return clamp(0.75 * Math.pow(compliance(n) / compliance(60), 0.75), 0.02, 0.82); }
// how far the reed swings into the pickup's field, as a share of the gap (the
// pickup's C0/(1-y): the nearer, the more it barks)
function swing(v, n, vel) {
  var ds = pickupScale(n) * (0.3 + 1.4 * fr(v, "bark", 0.5));
  return clamp(ds * Math.pow(velCurve(vel), velExp(n)), 0.01, 0.92);
}
function darkenHz(a) { return a < 0.001 ? 20000 : 20000 * Math.pow(800 / 20000, a); }
function axis(hzv) { return clamp(Math.log(hzv / 20) / Math.LN10 / 3, 0, 1); } // Pung's filter axis: 20 Hz .. 20 kHz
function fmtHz(h) { return h >= 1000 ? (h >= 9950 ? Math.round(h / 1000) : (h / 1000).toFixed(1)) + " kHz" : Math.round(h) + " Hz"; }
function fmtS(s) { return s >= 1 ? s.toFixed(s >= 9.95 ? 0 : 1) + " s" : (s * 1000 >= 10 ? Math.round(s * 1000) : (s * 1000).toFixed(1)) + " ms"; }
function volDb(f) { return f <= 0.001 ? "-inf dB" : (40 * Math.log(f) / Math.LN10).toFixed(1) + " dB"; }
function pct(f) { return Math.round(f * 100) + "%"; }
function cents(f) { var c = Math.round((f - 0.5) * 200); return (c > 0 ? "+" : "") + c + " ct"; }
function springMix(k) { return 0.85 * k * (0.6 + 0.4 * k); }

// what an encoder shows: the engine's own unit where it has one
// how a value reads, in the engine's own unit, everywhere Pung writes it (push.display)
function readout(k, raw) {
  var f = parseFloat(raw);
  if (isNaN(f)) return null;
  switch (k) {
  case "volume": return f <= 0.001 ? { value: "-inf", unit: "dB" } : { value: (40 * Math.log(f) / Math.LN10).toFixed(1), unit: "dB" };
  case "darken": if (f < 0.001) return { value: "Off" }; var h = darkenHz(f); return h >= 1000 ? { value: (h / 1000).toFixed(1), unit: "kHz" } : { value: String(Math.round(h)), unit: "Hz" };
  case "tune": var c = Math.round((f - 0.5) * 200); return { value: (c > 0 ? "+" : "") + c, unit: "ct" };
  case "preset": var n = Math.round(f); return n >= 0 && n < PRESETS.length ? { value: PRESETS[n] } : null;
  case "reverb": return f < 0.005 ? { value: "Dry" } : { value: String(Math.round(f * 100)), unit: "%" };
  case "tremolo": case "attack": case "decay": case "brightness": case "bark": case "speaker": return { value: String(Math.round(f * 100)), unit: "%" };
  }
  return null;
}
push.display(function (key, raw) { return readout(key, raw) || undefined; });
function shown(v, k) {
  if (!known(v, k)) return "--";
  var r = readout(k, String(v[k].value));
  return r ? r.value + (r.unit ? " " + r.unit : "") : String(v[k].display || v[k].value);
}
var NAMES = { volume: "VOLUME", tremolo: "VIBRATO", attack: "ATTACK", decay: "DECAY", brightness: "BRIGHT", darken: "DARKEN",
  bark: "BARK", reverb: "REVERB", speaker: "SPEAKER", tune: "TUNE", preset: "PRESET" };

function live(v) { return v.$live; }
// the keyboard's last note, or middle C: what a band picture is drawn for
function lastNote(v) {
  var L = live(v), best = null;
  if (L && L.known && L.voices) for (var i = 0; i < L.voices.length; i++) { var o = L.voices[i]; if (!best || o.age < best.age) best = o; }
  return best ? { n: clamp(best.note, 21, 108), vel: clamp(best.vel / 127, 0.05, 1), live: true } : { n: 60, vel: 100 / 127, live: false };
}
function noteName(n) { return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][n % 12] + (Math.floor(n / 12) - 1); }

// ---- PANEL: the reeds over the keys, the amplifier beside them -----------------------------
var LO = 33, HI = 96, KX = 14, KW = 16, KY = 76, KH = 24, TIP = 64;
function black(n) { var m = n % 12; return m === 1 || m === 3 || m === 6 || m === 8 || m === 10; }
var KEYS = (function () {
  var out = {}, wi = 0;
  for (var n = LO; n <= HI; n++) {
    if (black(n)) out[n] = { b: true, x: KX + wi * KW - 4, w: 9, cx: KX + wi * KW };
    else { out[n] = { b: false, x: KX + wi * KW, w: KW - 1, cx: KX + wi * KW + (KW - 1) / 2 }; wi++; }
  }
  return out;
})();
function reedTop(n) { return TIP - Math.round(12 + (reedInches(n) - 1) / 2 * 38); }
var RAIL_PTS = (function () { var p = []; for (var n = LO; n <= HI; n++) p.push(KEYS[n].cx, reedTop(n) - 3); return p; })();

function panelGround(g, kn, compact) {
  g.fill(0, 0, 960, 160, LID);
  // the reed bay, the keyboard under it
  g.fill(6, 4, 626, 98, BAY);
  g.poly(RAIL_PTS, 4, RAIL);
  for (var n = LO; n <= HI; n++) {
    var x = KEYS[n].cx;
    g.line(x, reedTop(n), x, TIP, 2, STEEL);
    var m = tipMass(n);
    g.dot(x, TIP - 1, m > 0.015 ? 1.4 + m * 14 : 1.2, m > 0.015 ? STEEL_HI : STEEL);
  }
  g.fill(10, TIP + 3, 618, 3, CHROME_LO); // the pickup
  g.fill(KX - 2, KY - 1, 38 * KW + 3, KH + 2, EBONY);
  for (n = LO; n <= HI; n++) if (!KEYS[n].b) g.fill(KEYS[n].x, KY, KEYS[n].w, KH, IVORY);
  for (n = LO; n <= HI; n++) if (KEYS[n].b) g.fill(KEYS[n].x, KY, KEYS[n].w, 14, EBONY);
  // the amplifier: name, three panels
  g.value(644, 19, "WURL", INK, -1);
  g.text(644 + g.measure("WURL", "value") + 10, 18, "ELECTRIC PIANO", INK_DIM, -1);
  var T = ["VIBRATO", "TONE", "SPRING"];
  for (var i = 0; i < 3; i++) {
    var bx = 642 + i * 104;
    g.fill(bx, 28, 100, 72, BAY);
    g.fill(bx, 28, 100, 1, CHROME_LO);
    g.text(bx + 5, 39, T[i], INK_DIM, -1);
  }
  // the chrome strip, and the encoder row's ivory knobs
  g.fill(0, 102, 960, 2, CHROME);
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, 110, 1, 44, "#2a221c");
    if (!kn[c] || kn[c] === "preset") continue;
    if (compact) { g.dot(c * 120 + 26, 128, 11, CAP_RIM); g.dot(c * 120 + 26, 128, 9.5, CAP); }
    else { g.dot(c * 120 + 28, 139, 15, CAP_RIM); g.dot(c * 120 + 28, 139, 13.5, CAP); }
  }
}

// a reed struck: its swing, as wide as the hammer hit it, dying at its rate
function reedSwing(v, o) {
  var n = o.note;
  if (n < LO || n > HI) return 0;
  var vel = clamp(o.vel / 127, 0, 1), a = Math.pow(velCurve(vel), velExp(n));
  var db = fundDecayDb(n) * decayMult(v) * o.age;
  var amp = a * Math.pow(10, -db / 20);
  if (o.released >= 0 && n < 92) amp *= Math.exp(-55 * Math.pow(2, (n - 60) / 24) * o.released); // the damper
  var on = onsetS(v, n, vel);
  if (o.age < on) amp *= (o.age / on) * (o.age / on);
  return amp;
}

function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  var compact = !!v.$segmode; // the bottom 18 pixels are Pung's: the segments' names
  g.layer("wurl|" + kn.join(",") + "|" + compact, function () { panelGround(g, kn, compact); });
  segLit(g, v);
  // the notes: held keys lit, struck reeds swinging
  var L = live(v);
  if (L && L.known && L.voices) {
    for (var i = 0; i < L.voices.length; i++) {
      var o = L.voices[i], k = KEYS[o.note];
      if (!k) continue;
      if (o.held) g.fill(k.x, KY, k.w, k.b ? 14 : KH, "mod");
      var a = reedSwing(v, o);
      if (a < 0.01) continue;
      var top = reedTop(o.note), w = 1 + a * 7;
      g.area([k.cx - w, TIP, k.cx, top, k.cx + w, TIP], TIP, "mod");
      g.line(k.cx, top, k.cx, TIP, 2, STEEL_HI);
    }
  }
  // the preset
  var pn = presetName(v);
  g.text(622, 13, "PRESET " + (known(v, "preset") ? (parseInt(v.preset.value, 10) + 1) : "--"), t === "preset" ? "slot" : INK_DIM, 1);
  g.value(622, 30, pn, t === "preset" ? "slot" : AMBER, 1, 200);
  // vibrato: the module's 5.63 Hz, as deep as its knob
  var x = 642, dep = fr(v, "tremolo", 0.5), hot = t === "tremolo";
  g.text(x + 95, 96, TREM_HZ.toFixed(1) + " HZ", INK_DIM, 1);
  var h = Math.max(8, Math.round(50 * dep));
  g.lfo(x + 2, 44 + Math.round((50 - h) / 2), 96, h, { shape: "Sine", rate: 0.5, color: hot ? "slot" : AMBER });
  g.text(x + 5, 96, dep < 0.005 ? "OFF" : pct(dep), hot ? "slot" : INK, -1);
  // tone: the Darken low pass
  x = 746; var dk = fr(v, "darken", 0), hd = t === "darken";
  g.text(x + 95, 39, dk < 0.001 ? "OPEN" : fmtHz(darkenHz(dk)).toUpperCase(), hd ? "slot" : INK_DIM, 1);
  g.filter(x, 42, 100, 58, { cutoff: "darken", at: axis(darkenHz(dk)), type: "LP 6 dB", color: hd ? "slot" : AMBER });
  // the spring: how much of it is heard
  x = 850; var rv = fr(v, "reverb", 0), hr = t === "reverb", mix = springMix(rv);
  g.text(x + 95, 39, rv < 0.005 ? "DRY" : "MIX " + pct(mix), hr ? "slot" : INK_DIM, 1);
  var pts = [], amp = 2 + 16 * mix, cy = 68;
  for (var px = 0; px <= 84; px += 2) pts.push(x + 8 + px, cy + Math.sin(px / 84 * Math.PI * 14) * amp * Math.sin(px / 84 * Math.PI));
  g.fill(x + 4, cy - 1, 4, 3, CHROME_LO); g.fill(x + 92, cy - 1, 4, 3, CHROME_LO);
  g.poly(pts, 1.5, hr ? "slot" : (rv < 0.005 ? INK_FAINT : CHROME));
  g.text(x + 5, 96, "DAMP " + fmtHz(1200 + 2800 * rv).toUpperCase(), rv < 0.005 ? INK_FAINT : INK, -1);
  row(g, v);
}
// the encoder row: an ivory knob, its legend over it, the value beside it
function row(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var c = 0; c < 8; c++) {
    var k = kn[c];
    if (!k || !v[k]) continue;
    var cmp = !!v.$segmode, x0 = c * 120, hot = k === t, cx = x0 + (cmp ? 26 : 28), cy = cmp ? 128 : 139, rr = cmp ? 9 : 12;
    g.text(x0 + 60, cmp ? 114 : 117, NAMES[k] || String(v[k].name).toUpperCase(), hot ? "slot" : INK, 0, 112);
    if (k === "preset") {
      g.fill(x0 + 6, cmp ? 119 : 125, 108, cmp ? 20 : 26, BAY);
      g.value(x0 + 60, cmp ? 134 : 144, shown(v, k), hot ? "slot" : AMBER, 0, 102);
      continue;
    }
    if (hot) g.arc(cx, cy, rr + 5.5, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) {
      var a = Math.PI * 0.75 + fr(v, k, 0) * Math.PI * 1.5;
      g.line(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 3, hot ? "slot" : CAP_LINE);
    }
    g.value(x0 + 82, cmp ? 135 : 146, shown(v, k), hot ? "slot" : INK, 0, 68);
  }
}

// ---- segments: the piano's parts under the hands ---------------------------------------------------
var SEGS = [
  { id: "reeds", label: "Reeds", rect: [6, 4, 626, 98], keys: ["attack", "decay", "brightness", "bark", "tune", "preset"] },
  { id: "vibrato", label: "Vibrato", rect: [642, 28, 100, 72], keys: ["tremolo", "volume"] },
  { id: "tone", label: "Tone", rect: [746, 28, 100, 72], keys: ["darken", "speaker"] },
  { id: "spring", label: "Spring", rect: [850, 28, 100, 72], keys: ["reverb"] }];
var SEG_TITLE = { vibrato: "VIBRATO", tone: "TONE", spring: "SPRING" };
// the active one (Pung's bar over it): its bay's legend lit in the slot's colour
function segLit(g, v) {
  if (v.$segmode !== "segment") return;
  for (var i = 0; i < SEGS.length; i++)
    if (SEGS[i].id === v.$segment && SEG_TITLE[SEGS[i].id]) g.text(SEGS[i].rect[0] + 5, 39, SEG_TITLE[SEGS[i].id], "slot", -1);
}
NAMES.speaker = "SPEAKER"; NAMES.tune = "TUNE"; NAMES.preset = "PRESET";

push.compartment({
  id: "panel", label: "Wurl", front_panel: true, draws_segments: true, segments: SEGS,
  pages: [
    { label: "Keys", keys: ["volume", "tremolo", "attack", "decay", "brightness", "darken", "bark", "reverb"] },
    { label: "Menu", keys: ["preset", "speaker", "tune"] }
  ],
  extra_keys: ["preset", "tremolo", "darken", "reverb", "attack", "decay", "bark", "brightness", "tune", "speaker", "volume"],
  screen: function (g, v) { panel(g, v); pageTag(g, v); }
});
function pageTag(g, v) {
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 18, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, INK_DIM, 1);
}

// ---- REEDS: harmonics, modes, the strike and the ring, the pickup ----------------------------
function edge(g) { g.fill(0, 0, 3, g.h, CHROME_LO); }
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (CACHED > 64) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
// the spectrum: 1 to 128 times the note's frequency, -72..0 dB
var SX = 10, SW = 330, SY = 18, SH = 60;
function sx(r) { return SX + Math.log(r) / Math.LN2 / 7 * SW; }
function sy(db) { return SY + clamp(-db / 72, 0, 1) * SH; }
push.envelopeTimes(function (env) {
  // the reed's own times at middle C, struck at velocity 100: the onset ramp, its ring to -60 dB
  return env.stages.map(function (s) {
    if (s.raw === null || s.raw === undefined) return null;
    var f = clamp(parseFloat(s.raw), 0, 1);
    if (s.key === "attack") return clamp(clamp((2.5 + 2.5 * (1 - 100 / 127)) / hz(60), 0.002, 0.03) * (4 - 3.8 * f), 0.001, 0.1);
    if (s.key === "decay") return 60 / (fundDecayDb(60) * (5.7 - 5.4 * f));
    return null;
  });
});
push.compartment({
  id: "reeds", label: "Reeds",
  pages: [{ label: "Reeds", keys: ["attack", "decay", "brightness", "bark", "tune"] }],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "", nt = lastNote(v), n = nt.n;
    var r = modeRatios(n), bs = brightScale(fr(v, "brightness", 0.5)), y = swing(v, n, nt.vel);
    // the spectrum's ground: octaves of the note
    g.text(SX, 10, "HARMONICS (BARK)", t === "bark" ? "slot" : "fg", -1);
    g.text(SX + SW, 10, "REED MODES (BRIGHT)", t === "brightness" ? "slot" : AMBER, 1);
    for (var o = 0; o <= 7; o++) g.fill(Math.round(sx(Math.pow(2, o))), SY, 1, SH, "faint");
    g.fill(SX, SY + SH, SW, 1, "line");
    // the pickup's harmonics: 1/(1 - y cos): each one r times the last
    var q = (1 - Math.sqrt(1 - y * y)) / y, hotB = t === "bark";
    for (var h = 1; h <= 12; h++) {
      var db = 20 * (h - 1) * Math.log(q) / Math.LN10, hx = Math.round(sx(h));
      if (db < -72) break;
      g.fill(hx - 1, Math.round(sy(db)), 3, Math.round(SY + SH - sy(db)), hotB ? "slot" : "fg");
    }
    // the reed's beam modes, inharmonic, scaled by Bright
    var hotR = t === "brightness", lastLbl = -99;
    for (var m = 1; m < 7; m++) {
      var mdb = 20 * Math.log(MODE_AMPS[m] * bs) / Math.LN10 + 18, mx = Math.round(sx(r[m]));
      if (mx > SX + SW) break;
      var my = Math.round(sy(mdb));
      g.fill(mx - 1, my, 3, SY + SH - my, hotR ? "slot" : AMBER);
      if (mx - lastLbl > 30) { g.text(mx, Math.max(SY + 6, my - 3), r[m].toFixed(1), hotR ? "slot" : AMBER, 0); lastLbl = mx; }
    }
    // the strike and the ring: Pung's envelope on the reed's times
    var ex = 352, ew = 300;
    g.line(ex - 6, 6, ex - 6, 82, 1, "line");
    g.text(ex, 10, (nt.live ? "LAST NOTE " : "") + noteName(n) + (nt.live ? "" : " AT VEL 100"), "dim", -1);
    var on = onsetS(v, n, nt.vel), ring = ring60(v, n);
    g.text(ex + ew, 10, "ONSET " + fmtS(on).toUpperCase() + "  RING " + fmtS(ring).toUpperCase(), t === "attack" || t === "decay" ? "slot" : "fg", 1);
    g.envelope(ex - 4, 14, ew + 8, 66, { attack: "attack", decay: "decay", labels: true, color: AMBER });
    // the pickup: one swing of the reed in, the voltage out
    var px = 668, pw = 276;
    g.line(px - 6, 6, px - 6, 82, 1, "line");
    g.text(px, 10, "PICKUP", "dim", -1);
    g.text(px + pw, 10, "SWING " + Math.round(y * 100) + "% OF THE GAP", hotB ? "slot" : "fg", 1);
    var mid = 42, amp = 22;
    g.fill(px, mid, pw, 1, "faint");
    g.poly(cached("in|" + px, function () {
      var p = []; for (var i = 0; i <= pw; i += 3) p.push(px + i, mid - Math.cos(i / pw * Math.PI * 4) * amp * 0.45); return p;
    }), 1, "line");
    g.poly(cached("out|" + y.toFixed(3), function () {
      var lo = 1 / (1 + y), hi = 1 / (1 - y), c = (hi + lo) / 2, s = (hi - lo) / 2, p = [];
      for (var i = 0; i <= pw; i += 2) { var val = 1 / (1 - y * Math.cos(i / pw * Math.PI * 4)); p.push(px + i, mid - (val - c) / s * amp); }
      return p;
    }), 2, hotB ? "slot" : "fg");
    g.text(px, 78, "REED", "dim", -1);
    g.text(px + 40, 78, "VOLTAGE: C0 / (1 - Y)", hotB ? "slot" : "fg", -1);
    g.text(px + pw, 78, "TUNE " + (known(v, "tune") ? cents(fr(v, "tune", 0.5)).toUpperCase() : "--"), t === "tune" ? "slot" : "dim", 1);
  }
});

// ---- AMP: vibrato, the power amp and speaker, Darken, the spring, the volume ------------------
function stage(g, x, w, title, hot) {
  g.fill(x, 4, w, 1, hot ? "slot" : "line");
  g.text(x, 15, title, hot ? "slot" : "dim", -1);
}
function arrow(g, x) { g.line(x, 48, x + 10, 48, 1.5, "dim"); g.line(x + 6, 44, x + 10, 48, 1.5, "dim"); g.line(x + 6, 52, x + 10, 48, 1.5, "dim"); }
push.compartment({
  id: "amp", label: "Amp",
  pages: [{ label: "Amp", keys: ["tremolo", "speaker", "darken", "reverb", "volume"] }],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "";
    // vibrato: a lamp on a light-dependent resistor in the preamp
    var x = 10, dep = fr(v, "tremolo", 0.5);
    stage(g, x, 170, "VIBRATO", t === "tremolo");
    g.text(x + 170, 15, TREM_HZ.toFixed(2) + " HZ", "dim", 1);
    var h = Math.max(8, Math.round(50 * dep));
    g.lfo(x - 2, 20 + Math.round((50 - h) / 2), 174, h, { shape: "Sine", rate: 0.6, color: t === "tremolo" ? "slot" : AMBER });
    g.text(x, 78, dep < 0.005 ? "OFF" : "DEPTH " + pct(dep), t === "tremolo" ? "slot" : "fg", -1, 170);
    arrow(g, 186);
    // the power amp and the speaker: the band the cabinet leaves
    x = 204; var sp = fr(v, "speaker", 0.5), hs = t === "speaker";
    var hp = 20 * Math.pow(95 / 20, sp), lp = 20000 * Math.pow(5500 / 20000, sp);
    stage(g, x, 230, "SPEAKER", hs);
    g.text(x + 230, 15, sp < 0.005 ? "FLAT, NO CABINET" : (sp > 0.995 ? "THE FULL CABINET" : pct(sp) + " OF THE CABINET"), hs ? "slot" : "dim", 1);
    var bx = x, bw = 230, by = 30, bh = 36;
    g.fill(bx, by, bw, bh, "#000000");
    for (var d = 1; d < 3; d++) g.fill(bx + Math.round(bw * d / 3), by, 1, bh, "faint");
    var x1 = bx + Math.round(bw * axis(hp)), x2 = bx + Math.round(bw * axis(lp));
    g.fill(x1, by + 6, Math.max(2, x2 - x1), bh - 12, hs ? "slot" : "#5e4a2c");
    g.fill(x1, by + 6, 2, bh - 12, hs ? "slot" : AMBER); g.fill(x2 - 2, by + 6, 2, bh - 12, hs ? "slot" : AMBER);
    g.text(bx, 78, fmtHz(hp).toUpperCase() + " TO " + fmtHz(lp).toUpperCase(), hs ? "slot" : "fg", -1);
    arrow(g, 440);
    // Darken: a gentle low pass after the speaker
    x = 458; var dk = fr(v, "darken", 0), hd = t === "darken";
    stage(g, x, 160, "DARKEN", hd);
    g.text(x + 160, 15, dk < 0.001 ? "OFF" : fmtHz(darkenHz(dk)).toUpperCase(), hd ? "slot" : "dim", 1);
    g.filter(x - 4, 18, 168, 52, { cutoff: "darken", at: axis(darkenHz(dk)), type: "LP 6 dB", color: hd ? "slot" : AMBER });
    g.text(x, 78, "6 DB AN OCTAVE", "dim", -1);
    arrow(g, 624);
    // the spring
    x = 642; var rv = fr(v, "reverb", 0), hr = t === "reverb", mix = springMix(rv);
    stage(g, x, 160, "SPRING", hr);
    g.text(x + 160, 15, rv < 0.005 ? "DRY" : "WET " + pct(mix), hr ? "slot" : "dim", 1);
    var pts = [], amp = 3 + 22 * mix;
    for (var px = 0; px <= 148; px += 2) pts.push(x + 6 + px, 48 + Math.sin(px / 148 * Math.PI * 20) * amp * Math.sin(px / 148 * Math.PI));
    g.fill(x, 46, 6, 5, "line"); g.fill(x + 154, 46, 6, 5, "line");
    g.poly(pts, 1.5, hr ? "slot" : (rv < 0.005 ? "faint" : CHROME));
    g.text(x, 78, rv < 0.005 ? "NO REVERB" : "DAMPED AT " + fmtHz(1200 + 2800 * rv).toUpperCase(), hr ? "slot" : "fg", -1);
    arrow(g, 808);
    // the volume: a squared taper
    x = 826; var vo = fr(v, "volume", 0.5), hv = t === "volume";
    stage(g, x, 118, "VOLUME", hv);
    for (var i = 0; i < 14; i++) {
      var on = i < Math.round(vo * vo * 14);
      g.fill(x + i * 8, 34, 6, 30, on ? (hv ? "slot" : AMBER) : "line");
    }
    g.text(x, 78, known(v, "volume") ? volDb(vo).toUpperCase() : "--", hv ? "slot" : "fg", -1);
  }
});
