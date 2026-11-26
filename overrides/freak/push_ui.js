// MrHyde on the Push: a macro oscillator after the MicroFreak's idea, built on
// Plaits' engines. An overlay shipped with Pung (the module ships no push_ui.js).
//
// What makes it MrHyde rather than Plaits: an oscillator TYPE with three
// macros shown on a small white-on-black screen, a filter after it, and a
// modulation MATRIX of six sources (LFO, envelope, cycling envelope, random,
// velocity, poly aftertouch) into six destinations (pitch, harmonics, timbre,
// cutoff and two assignable ones), played from flat copper touch plates.
// The screens draw that instrument:
//
//   PANEL    the screen with the type, what its macros mean on this engine
//            (Plaits' own names for them) and the wave it makes; the matrix
//            at a glance; the filter; the low-pass gate. The encoders sit
//            in copper touch plates.
//   MATRIX   the matrix itself: sources across, over the encoders that set
//            them; destinations down, the one being edited lit; each amount a
//            bar either side of its point
//   SOURCES  the six sources at once, Pung's LFO and envelopes among them,
//            and what each one reaches through the matrix
//   VOICE    where the unison voices sit (detune against spread, exactly as
//            the engine places them), how the voices are shared out, glide
//
// Times: the envelope's stages are time constants (plaits_move_engine.cpp: a
// stage approaches its target by chunk / (ms * rate) a block), so Pung is
// told how long each really takes (push.envelopeTimes).

// ---- colours: black body, white print, copper plates, a white OLED ----------------------
var BODY = "#111114", BODY2 = "#1b1b20", PRINT = "#e9e9ec", PRINT2 = "#8c8c95", PRINT3 = "#55555d";
var COPPER = "#d08a3e", COPPER_DK = "#6b4420", OLED = "#000000", OLED_FG = "#eef6ff", OLED_DIM = "#5e6670";
var NEG = "#79b4ff"; // a negative amount in the matrix

function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value || "") : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? d : n; }
function raw(v, k) { return known(v, k) ? String(v[k].value || "").toLowerCase() : ""; } // an enum's own name, whatever it reads as
function on(v, k) { var s = raw(v, k); return s === "on" || s === "1"; }
// Where the sound has a control now (v[k].now: the module's live_mod, the
// newest voice's while a note sounds), 0..1 of its range; null when nothing
// moves it. The knob's own mark stays where the knob is; the sound's place
// goes beside it in the modulation colour.
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? Math.max(0, Math.min(1, v[k].now)) : null; }
function moved(v, k) { var n = nowOf(v, k); return n !== null && Math.abs(n - v[k].frac) > 0.004; }
function frNow(v, k, d) { var n = nowOf(v, k); return n === null ? fr(v, k, d) : n; }
// on a track (x, y, w): a line from the knob's place to the sound's, and a dot
function nowMark(g, v, k, x, y, w) {
  if (!moved(v, k)) return;
  var f = v[k].frac, n = nowOf(v, k);
  g.fill(x + w * Math.min(f, n), y, Math.max(1, w * Math.abs(n - f)), 1, MOD_DK);
  g.dot(x + w * n, y + 0.5, 2.8, MOD);
}

// ---- the oscillator types: the module's names, Plaits' engine, Plaits' names for the macros --
var TYPES = [
  ["VA VCF", "DETUNE", "CUTOFF", "RESONANCE", "vcf"],
  ["Phase Distortion", "RATIO", "PHASE", "DISTORTION", "pd"],
  ["Wave Terrain", "TERRAIN", "X", "Y", "terrain"],
  ["String Machine", "DETUNE", "TONE", "ENVELOPE", ""],
  ["Virtual Analog", "DETUNE", "SQUARE", "SAW", "va"],
  ["Waveshaping", "OVERTONE", "WAVESHAPE", "FOLD", "shape"],
  ["FM 2-Op", "RATIO", "FEEDBACK", "TOPOLOGY", "fm"],
  ["Granular Formant", "POSITION", "SIZE", "DENSITY", ""],
  ["Harmonic", "BUMPS", "SLOPE", "SHIFT", "add"],
  ["Wavetable", "BANK", "POINTER", "MIRROR", "table"],
  ["Chords", "CHORD", "TIMBRE", "WAVEFORM", ""],
  ["Vocal Speech", "PROSODY", "PHONEME", "FORMANT", ""],
  ["Swarm", "DETUNE", "SPREAD", "CHAOS", ""],
  ["Noise", "FREQUENCY", "SLOPE", "RUGGEDNESS", ""],
  ["Particle Noise", "SPREAD", "EXTINCTION", "SCATTER", ""],
  ["Inharmonic String", "HARMONIC", "TIMBRE", "MORPH", "ring"],
  ["Modal Resonator", "HARMONIC", "TIMBRE", "DECAY", "ring"]
];
var SHORT = ["VA VCF", "PHASE DIST", "TERRAIN", "STRINGS", "VIRT. ANALOG", "WAVESHAPE", "FM 2-OP", "GRANULAR", "HARMONIC",
  "WAVETABLE", "CHORDS", "SPEECH", "SWARM", "NOISE", "PARTICLE", "INH. STRING", "MODAL"];
function typeIndex(v) {
  if (!known(v, "model")) return -1;
  var d = disp(v, "model");
  for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === d) return i;
  return Math.round(fr(v, "model", 0) * (TYPES.length - 1));
}

// ---- the matrix ----------------------------------------------------------------------------
var SRC = ["lfo", "env", "cycle_env", "random", "velocity", "poly_aftertouch"];
var SRC_NAME = ["LFO", "ENV", "CYCLE ENV", "RANDOM", "VELOCITY", "AFTERTOUCH"];
var SRC_SHORT = ["LFO", "ENV", "CYC", "RND", "VEL", "AT"];
var DST = ["pitch", "harmonics", "timbre", "cutoff", "assign1", "assign2"];
var DST_NAME = ["PITCH", "HARMONICS", "TIMBRE", "CUTOFF", "ASSIGN 1", "ASSIGN 2"];
var DST_SHORT = ["PIT", "HAR", "TIM", "CUT", "AS1", "AS2"];
var TARGET_NAME = { off: "OFF", morph: "MORPH", fm_amount: "FM", lpg_decay: "LPG DECAY", lpg_color: "LPG COLOR",
  filter_resonance: "RESONANCE", pitch: "PITCH", harmonics: "HARMONICS", timbre: "TIMBRE", filter_cutoff: "CUTOFF",
  volume: "VOLUME", pan: "PAN", detune: "DETUNE", spread: "SPREAD" };
function mkey(d, s) { return DST[d] + "_mod_" + SRC[s] + "_amt"; }
// an amount as -1..1 of its range (pitch is in semitones, +/-48)
function amount(v, d, s) { var k = mkey(d, s); if (!known(v, k)) return 0; return num(v, k, 0) / (d === 0 ? 48 : 1); }
function targetOf(v, d) { var t = raw(v, DST[d] + "_target"); return TARGET_NAME[t] || (t ? t.toUpperCase() : "OFF"); }
function dstLabel(v, d) { return d < 4 ? DST_NAME[d] : DST_NAME[d] + "  > " + targetOf(v, d); }
function allMatrixKeys() {
  var out = [];
  for (var d = 0; d < 6; d++) for (var s = 0; s < 6; s++) out.push(mkey(d, s));
  return out.concat(["assign1_target", "assign2_target"]);
}

// ---- what the type makes ----------------------------------------------------------------------
function frac(x) { return x - Math.floor(x); }
function saw(p) { return 2 * frac(p) - 1; }
function sq(p, pw) { return frac(p) < pw ? 1 : -1; }
function tri(p) { var q = frac(p); return q < 0.5 ? 4 * q - 1 : 3 - 4 * q; }
function sine(p) { return Math.sin(2 * Math.PI * p); }
function waveFn(kind, H, T, M) {
  switch (kind) {
  case "vcf": // a saw through a resonant low-pass: CUTOFF in harmonics, RESONANCE its peak
    var fc = 1 + T * T * 30, q = 0.7 + M * 6;
    return function (p) {
      var y = 0;
      for (var k = 1; k <= 32; k++) {
        var x = k / fc, g = 1 / Math.sqrt((1 - x * x) * (1 - x * x) + x * x / (q * q));
        y += Math.sin(2 * Math.PI * k * p) / k * g;
      }
      return y;
    };
  case "va":
    var pw = 0.06 + Math.min(T, 0.5) * 0.88, r = 1 + (H - 0.5) * 0.04;
    return function (p) { var vs = tri(p * r) * (1 - M) + saw(p * r) * M; return 0.5 * sq(p, pw) + 0.5 * vs; };
  case "pd":
    var d = 0.5 - 0.47 * T, ratio = 1 + Math.round(H * 3);
    return function (p) {
      var q2 = frac(p * ratio), w = q2 < d ? q2 * 0.5 / d : 0.5 + (q2 - d) * 0.5 / (1 - d);
      return Math.cos(2 * Math.PI * (w * (1 - M) + q2 * M * 0.5 + w * M * 0.5));
    };
  case "shape":
    var gain = 1 + M * 4, off = (H - 0.5) * 0.5;
    return function (p) { return Math.sin((tri(p) * (0.6 + T * 0.4) + off) * gain * 1.5); };
  case "fm":
    var ratio2 = 0.5 + Math.round(H * 8) / 2, idx = 0.5 + T * 3;
    return function (p) { return Math.sin(2 * Math.PI * p + idx * Math.sin(2 * Math.PI * ratio2 * p)); };
  case "ring":
    var tau = 0.3 + M * M * 7;
    return function (p) { return Math.exp(-p / tau) * sine(p); };
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
  var pts = [], mid = y + h / 2, a = h / 2 - 1, n = Math.round(w / 1.5), prev = null, lo = 1e9, hi = -1e9, ys = [];
  for (var i = 0; i <= n; i++) { var s = fn(i / n * cycles); ys.push(s); if (s < lo) lo = s; if (s > hi) hi = s; }
  var span = Math.max(0.6, hi - lo), off = (hi + lo) / 2;
  for (var j = 0; j <= n; j++) {
    var yy = mid - (ys[j] - off) / span * 2 * a, xx = x + j * w / n;
    if (prev !== null && Math.abs(yy - prev) > a * 0.5) pts.push(xx, prev);
    pts.push(xx, yy);
    prev = yy;
  }
  return pts;
}
// the OLED's picture of the type
function picture(g, v, i, x, y, w, h, col) {
  var e = TYPES[i], H = frNow(v, "harmonics", 0.5), T = frNow(v, "timbre", 0.5), M = frNow(v, "morph", 0.5); // the wave the sound makes now
  var hq = Math.round(H * 64) / 64, tq = Math.round(T * 64) / 64, mq = Math.round(M * 64) / 64;
  var fn = waveFn(e[4], hq, tq, mq);
  if (fn) {
    var cyc = e[4] === "ring" ? 7 : 2;
    g.poly(cached("w|" + i + "|" + hq + "|" + tq + "|" + mq, function () { return wavePts(x, y, w, h, cyc, fn); }), 1.5, col);
    return;
  }
  if (e[4] === "add") {
    var n = 24, bw = w / n, bumps = 1 + Math.round(H * 3), c0 = 1 + T * 20, width = 0.8 + (1 - M) * 4;
    for (var k = 0; k < n; k++) {
      var a = 0;
      for (var b = 0; b < bumps; b++) a = Math.max(a, Math.exp(-Math.pow((k - c0 * (b + 1) / bumps - b * 3) / width, 2)));
      var bh = Math.max(1, Math.round(a * h));
      g.fill(x + k * bw, y + h - bh, Math.max(1, bw - 2), bh, col);
    }
    return;
  }
  if (e[4] === "table" || e[4] === "terrain") {
    var gs = h, gx = x + w / 2 - gs / 2;
    for (var q = 0; q < 8; q++) for (var r = 0; r < 8; r++) g.fill(gx + q * gs / 8 + gs / 16 - 1, y + r * gs / 8 + gs / 16 - 1, 2, 2, OLED_DIM);
    g.dot(gx + tq * gs, y + mq * gs, 4, col);
    return;
  }
  // no picture: the three macros as the OLED would list them
  var ks = ["harmonics", "timbre", "morph"];
  for (var m = 0; m < 3; m++) {
    var yy = y + 8 + m * (h / 3);
    g.fill(x, yy, w, 2, "#22262b");
    if (known(v, ks[m])) g.fill(x, yy - 2, Math.max(2, Math.round(w * fr(v, ks[m], 0))), 6, col);
  }
}

// ---- segments: Pung's bar marks the active section; the panel lights its printed legend ----------
var SEG_LEGEND = { osc: [18, 36, "TYPE"], matrix: [352, 17, "MATRIX"], filter: [486, 17, "FILTER"], lpg: [726, 17, "LPG"] };
function segMark(g, v) {
  if (v.$segmode !== "segment") return;
  var l = SEG_LEGEND[v.$segment];
  if (l && (v.$segment !== "osc" || typeIndex(v) >= 0)) g.text(l[0], l[1], l[2], "slot", -1);
}

// ---- the touch plates: the encoder row ---------------------------------------------------------
function plates(g, v, values, names) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, ok = known(v, k), c = hot ? "slot" : COPPER;
    // the plate: a copper outline on the black, a strip along its foot showing the value;
    // shorter in segment mode, where Pung names the segments in the bottom 18 pixels
    var seg = !!v.$segmode, y0 = seg ? 107 : 110, y1 = seg ? 140 : 156, ys = y1 - 5;
    g.fill(x + 6, y0, 108, 1, c); g.fill(x + 6, y1, 108, 1, c);
    g.fill(x + 6, y0, 1, y1 - y0 + 1, c); g.fill(x + 113, y0, 1, y1 - y0 + 1, c);
    var nm = names && names[i] ? names[i] : String(v[k].name).toUpperCase();
    g.text(x + 60, seg ? 117 : 123, nm, hot ? PRINT : PRINT2, 0, 100);
    var val = values && values[i] !== undefined && values[i] !== null ? values[i] : (ok ? disp(v, k) + (v[k].unit ? " " + v[k].unit : "") : "--");
    g.value(x + 60, seg ? 132 : 145, val, hot ? "slot" : (ok ? PRINT : PRINT3), 0, 100);
    if (ok && v[k].type !== "enum") {
      var f = v[k].frac, bip = /_amt$|^pan$|^pitch$/.test(k);
      if (bip) { var cx = x + 60, wv = Math.round((f - 0.5) * 100); g.fill(wv < 0 ? cx + wv : cx, ys, Math.max(1, Math.abs(wv)), 2, c); g.fill(cx, ys - 2, 1, 6, PRINT3); }
      else g.fill(x + 10, ys, Math.max(1, Math.round(100 * f)), 2, c);
      nowMark(g, v, k, x + 10, ys, 100);
    }
  }
}
function pagesNote(g, v, x, y, col) {
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(x, y, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, col, 1);
}
function plain(x) { return x === Math.round(x) ? String(x) : x.toFixed(2); }
// how a knob reads in the instrument's words
function valueOf(v, k) {
  if (!k || !known(v, k)) return null;
  var n = num(v, k, 0);
  if (/^(harmonics|timbre|morph|fm_amount|aux_mix|lpg_decay|lpg_color|filter_cutoff|filter_resonance|detune|spread|env_sustain|random_slew|lfo_phase)$/.test(k)) return Math.round(n * 100) + " %";
  if (k === "pitch") return (n > 0 ? "+" : "") + n.toFixed(1) + " ST";
  if (/^pitch_mod_/.test(k)) return (n > 0 ? "+" : "") + n.toFixed(1) + " ST";
  if (/_amt$/.test(k)) return (n > 0 ? "+" : "") + Math.round(n * 100) + " %";
  if (/^env_(attack|decay|release)_ms$/.test(k)) return secs(envSecs(n));
  if (/_ms$/.test(k)) return n >= 1000 ? (n / 1000).toFixed(2) + " S" : Math.round(n) + " MS";
  if (k === "volume") return n <= 0 ? "-INF" : (20 * Math.log(n) / Math.LN10).toFixed(1) + " DB";
  if (k === "pan") return Math.abs(n) < 0.005 ? "C" : (n < 0 ? "L " : "R ") + Math.round(Math.abs(n) * 100);
  if (k === "filter_mode") return { lp: "LPF", bp: "BPF", hp: "HPF" }[raw(v, k)] || disp(v, k).toUpperCase();
  if (/(_shape|_mode|_retrig|_sync|_bipolar|_target|voice_mode)$/.test(k)) return disp(v, k).replace(/_/g, " ").toUpperCase();
  return null;
}
function rowValues(v) { var kn = v.$knobs || [], out = []; for (var i = 0; i < 8; i++) out.push(valueOf(v, kn[i])); return out; }

// ---- times -----------------------------------------------------------------------------------
// The envelope approaches each target with the stage's ms as its time constant
// (plaits_move_engine.cpp): a stage is taken as done within 0.1 % of its swing,
// ln(1000) = 6.9 time constants. The low-pass gate closes on Plaits' short decay (to -60 dB).
function lpgSecs(d) { var c = 0.1 * Math.pow(2, -8 * d); return Math.log(1000) / c * 24 / 48000; }
function envSecs(ms) { return Math.max(1, ms) / 1000 * Math.log(1000); }
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    var p = parseFloat(s.raw);
    if (s.plateau || isNaN(p)) return null;
    if (s.key === "lpg_decay") return lpgSecs(p);
    if (/^env_(attack|decay|release)_ms$/.test(s.key || "")) return envSecs(p);
    return null; // the cycling envelope's ramps are straight: its ms are its times
  });
});
function secs(s) { return s < 0.1 ? Math.round(s * 1000) + " MS" : (s < 10 ? s.toFixed(2) + " S" : s.toFixed(1) + " S"); }

// How the module's bare numbers read wherever Pung writes them (the matrix pages,
// the sources, the voice): times as they really take, amounts signed in percent,
// pitch in semitones, rates in Hz, volume in dB, pan as a side.
var PCT = /^(harmonics|timbre|morph|fm_amount|aux_mix|lpg_color|filter_cutoff|filter_resonance|detune|spread|env_sustain|random_slew|lfo_phase)$/;
push.display(function (key, rv) {
  if (key === "filter_mode") return { lp: "LPF", bp: "BPF", hp: "HPF" }[String(rv).toLowerCase()];
  if (key === "voice_mode") return { mono: "Mono", poly: "Poly", mono_legato: "Mono Legato" }[String(rv).toLowerCase()];
  if (key === "random_mode") return { sample_hold: "S & H", smooth: "Smooth", drift: "Drift" }[String(rv).toLowerCase()];
  if (/_target$/.test(key)) { var tn = TARGET_NAME[String(rv).toLowerCase()]; return tn ? tn.charAt(0) + tn.slice(1).toLowerCase() : undefined; }
  var n = parseFloat(rv);
  if (isNaN(n) || !/^-?[\d.]+(e-?\d+)?$/i.test(String(rv).trim())) return;
  if (key === "lpg_decay") return secs(lpgSecs(n)).toLowerCase();
  if (/^env_(attack|decay|release)_ms$/.test(key)) return secs(envSecs(n)).toLowerCase();
  if (PCT.test(key)) return { value: String(Math.round(n * 100)), unit: "%" };
  if (key === "pitch" || /^pitch_mod_/.test(key)) return { value: (n > 0 ? "+" : "") + n.toFixed(1), unit: "st" };
  if (/_amt$/.test(key)) return { value: (n > 0 ? "+" : "") + Math.round(n * 100), unit: "%" };
  if (key === "lfo_rate" || key === "random_rate") return { value: n < 10 ? n.toFixed(2) : n.toFixed(1), unit: "Hz" };
  if (key === "volume") return n <= 0 ? "-inf dB" : { value: (20 * Math.log(n) / Math.LN10).toFixed(1), unit: "dB" };
  if (key === "pan") return Math.abs(n) < 0.005 ? "C" : (n < 0 ? "L" : "R") + Math.round(Math.abs(n) * 100);
  if (key === "velocity_curve") return "x^" + n.toFixed(2);
  if (key === "poly_aftertouch_curve") return Math.abs(n) < 0.005 ? "linear" : (n > 0 ? "+" : "") + Math.round(n * 100) + " %";
});

// ---- PANEL ---------------------------------------------------------------------------------------
function label(g, x, y, s) { g.text(x, y, s, PRINT2, -1); }
function panelGround(g, i) {
  g.fill(0, 0, 960, 160, BODY);
  g.value(10, 17, "MRHYDE", PRINT, -1);
  // the OLED: the type, its macros, its wave
  g.fill(8, 22, 334, 78, "#2a2a30");
  g.fill(9, 23, 332, 76, OLED);
  if (i >= 0) {
    g.text(18, 36, "TYPE", OLED_DIM, -1);
    var e = TYPES[i];
    for (var m = 0; m < 3; m++) {
      g.text(18, 70 + m * 11, ["H", "T", "M"][m], OLED_DIM, -1);
      g.text(30, 70 + m * 11, e[1 + m], OLED_FG, -1, 112);
    }
  }
  // the matrix at a glance
  label(g, 352, 17, "MATRIX");
  for (var s = 0; s < 6; s++) g.text(386 + s * 15, 32, SRC_SHORT[s].charAt(0), PRINT2, 0);
  for (var d = 0; d < 6; d++) {
    g.text(352, 45 + d * 10, DST_SHORT[d], PRINT2, -1);
    for (var s2 = 0; s2 < 6; s2++) g.dot(386 + s2 * 15, 42 + d * 10, 1.5, "#2c2c33");
  }
  // filter, gate
  label(g, 486, 17, "FILTER");
  g.fill(486, 22, 226, 66, BODY2);
  label(g, 726, 17, "LPG");
  g.fill(726, 22, 226, 66, BODY2);
}
var FILTER_MODES = ["lp", "bp", "hp"], FILTER_NAMES = ["LPF", "BPF", "HPF"], FILTER_TYPES = ["LP", "BandPass", "HP"];
function panel(g, v) {
  var i = typeIndex(v), t = v.$touched || "";
  g.layer("hyde|" + i, function () { panelGround(g, i); });
  if (!v.$segmode) pagesNote(g, v, 952, 14, PRINT2);
  if (i >= 0) {
    var e = TYPES[i], hot = t === "harmonics" || t === "timbre" || t === "morph";
    g.value(18, 56, e[0].toUpperCase(), t === "model" ? "slot" : OLED_FG, -1, 200);
    // the macros' places, as the OLED's bars
    var ks = ["harmonics", "timbre", "morph"];
    for (var m = 0; m < 3; m++) {
      var y = 67 + m * 11, k = ks[m];
      g.fill(146, y, 56, 1, "#2a2f35");
      if (known(v, k)) g.fill(146, y - 2, Math.max(2, Math.round(56 * fr(v, k, 0))), 5, t === k ? "slot" : OLED_FG);
      nowMark(g, v, k, 146, y, 56);
    }
    if (known(v, "harmonics") && known(v, "timbre") && known(v, "morph")) picture(g, v, i, 214, 30, 118, 62, hot ? "slot" : OLED_FG);
  }
  // the matrix: each amount a dot, as large as it is strong, copper up and blue down
  for (var d = 0; d < 6; d++) for (var s = 0; s < 6; s++) {
    var a = amount(v, d, s);
    if (Math.abs(a) > 0.004) g.dot(386 + s * 15, 42 + d * 10, 1.8 + Math.min(1, Math.abs(a)) * 2.8, a > 0 ? COPPER : NEG);
  }
  // the filter: mode LEDs, the response
  var mi = Math.max(0, FILTER_MODES.indexOf(raw(v, "filter_mode")));
  for (var f = 0; f < 3; f++) {
    var lx = 590 + f * 42, lit = f === mi;
    g.dot(lx, 13, 3, lit ? (t === "filter_mode" ? "slot" : COPPER) : PRINT3);
    g.text(lx + 7, 17, FILTER_NAMES[f], lit ? PRINT : PRINT3, -1);
  }
  g.filter(488, 24, 222, 62, { cutoff: "filter_cutoff", resonance: "filter_resonance", type: FILTER_TYPES[mi], color: PRINT });
  // the gate: it opens with the key and closes on DECAY; COLOR makes it a low-pass as well
  g.envelope(728, 24, 222, 62, { attack: 0, sustain: 1, release: "lpg_decay", still: true, color: t === "lpg_decay" ? "slot" : PRINT });
  var col = fr(v, "lpg_color", 0.5);
  g.text(726, 98, "VCA", col < 0.5 ? PRINT : PRINT3, -1);
  g.text(952, 98, "VCF+VCA", col > 0.5 ? PRINT : PRINT3, 1);
  g.fill(760, 94, 128, 1, PRINT3);
  if (known(v, "lpg_color")) g.fill(758 + 128 * col, 89, 4, 10, t === "lpg_color" ? "slot" : COPPER);
  nowMark(g, v, "lpg_color", 760, 94, 128);
  g.text(712, 98, known(v, "filter_cutoff") && fr(v, "filter_cutoff", 1) >= 0.999 && fr(v, "filter_resonance", 0) <= 0.0001 && mi === 0 ? "OPEN: BYPASSED" : "", PRINT3, 1);
}
// Pung's default pages on the black body, white print and copper plates
push.theme({ ground: BODY, panel: BODY2, ink: PRINT, dim: PRINT2, rule: COPPER_DK, faint: BODY2, accent: COPPER, knob: "pointer" });
push.compartment({
  id: "panel", label: "MrHyde", front_panel: true,
  pages: [
    { label: "Panel", keys: ["model", "harmonics", "timbre", "morph", "filter_cutoff", "filter_resonance", "lpg_decay", "lpg_color"] },
    { label: "Osc & Out", keys: ["pitch", "fm_amount", "aux_mix", "glide_ms", "filter_mode", "volume", "pan"] }
  ],
  extra_keys: allMatrixKeys(),
  // the panel's sections under the hands: the oscillator, the sources that feed the matrix, the
  // filter with what modulates its cutoff, the gate and the output
  segments: [
    { id: "osc", label: "Oscillator", rect: [8, 22, 334, 78], keys: ["model", "harmonics", "timbre", "morph", "pitch", "fm_amount", "aux_mix", "glide_ms"] },
    { id: "matrix", label: "Sources", rect: [348, 2, 130, 100], keys: ["lfo_shape", "lfo_rate", "env_attack_ms", "env_decay_ms", "env_sustain", "env_release_ms", "cycle_attack_ms", "cycle_decay_ms"] },
    { id: "filter", label: "Filter", rect: [482, 2, 234, 100], keys: ["filter_mode", "filter_cutoff", "filter_resonance", "cutoff_mod_lfo_amt", "cutoff_mod_env_amt", "cutoff_mod_cycle_env_amt", "cutoff_mod_random_amt", "cutoff_mod_velocity_amt"] },
    { id: "lpg", label: "LPG & Out", rect: [720, 2, 236, 100], keys: ["lpg_decay", "lpg_color", "volume", "pan"] }
  ],
  draws_segments: true,
  screen: function (g, v) {
    panel(g, v);
    segMark(g, v);
    var vals = rowValues(v), kn = v.$knobs || [];
    for (var c = 0; c < 8; c++) {
      if (kn[c] === "lpg_decay" && known(v, "lpg_decay")) vals[c] = secs(lpgSecs(num(v, "lpg_decay", 0)));
      if (kn[c] === "model") { var ti = typeIndex(v); vals[c] = ti >= 0 ? SHORT[ti] : "--"; }
    }
    // a matrix amount on the plates says which source into which destination
    var names = kn.map(function (k) {
      var m = /^(pitch|harmonics|timbre|cutoff|assign1|assign2)_mod_(.+)_amt$/.exec(k || "");
      if (m) return SRC_SHORT[SRC.indexOf(m[2])] + " > " + DST_SHORT[DST.indexOf(m[1])];
      return { lfo_shape: "LFO SHAPE", lfo_rate: "LFO RATE", env_attack_ms: "ENV ATTACK", env_decay_ms: "ENV DECAY", env_sustain: "ENV SUSTAIN",
        env_release_ms: "ENV RELEASE", cycle_attack_ms: "CYCLE RISE", cycle_decay_ms: "CYCLE FALL" }[k] || "";
    });
    plates(g, v, vals, names);
  }
});

// ---- MATRIX: sources across, destinations down ------------------------------------------------------
// Each source's column stands over the encoder that sets it on every page; the
// page's destination is the lit row. Assign pages set their target on encoder 7.
function matrixPage(d) {
  var keys = [];
  for (var s = 0; s < 6; s++) keys.push(mkey(d, s));
  if (d >= 4) keys.push(DST[d] + "_target");
  return { label: DST_NAME[d], keys: keys };
}
var MX = function (s) { return 56 + s * 120; }, MY = function (d) { return 24 + d * 11.6; };
function matrixGround(g) {
  for (var s = 0; s < 6; s++) g.text(MX(s), 9, SRC_NAME[s], PRINT3, 0);
  for (var d = 0; d < 6; d++) {
    for (var s2 = 0; s2 < 6; s2++) { g.fill(MX(s2) - 50, MY(d), 100, 1, "#1d1d22"); g.dot(MX(s2), MY(d) + 0.5, 3, "#2c2c34"); }
  }
  g.fill(716, 2, 1, 82, "#2a2a30");
}
push.compartment({
  id: "matrix", label: "Matrix",
  pages: [0, 1, 2, 3, 4, 5].map(matrixPage),
  extra_keys: allMatrixKeys(),
  screen: function (g, v) {
    g.layer("matrix", function () { matrixGround(g); });
    var t = v.$touched || "", page = v.$page || 0;
    for (var d = 0; d < 6; d++) {
      var y = MY(d), mine = d === page;
      if (mine) { g.fill(4, y - 5, 704, 11, "#1e1e24"); }
      for (var s = 0; s < 6; s++) {
        var a = Math.max(-1, Math.min(1, amount(v, d, s))), hot = t === mkey(d, s), x = MX(s);
        if (Math.abs(a) > 0.004) {
          var w = Math.round(a * 50), c = hot ? "slot" : (a > 0 ? COPPER : NEG);
          g.fill(a > 0 ? x : x + w, y - 2, Math.abs(w), 5, c);
          g.dot(x, y + 0.5, 3, c);
        } else if (hot) g.dot(x, y + 0.5, 3, "slot");
      }
      var lc = mine ? (t === DST[d] + "_target" ? "slot" : PRINT) : PRINT3;
      g.text(726, y + 4, dstLabel(v, d), lc, -1, 222);
      if (mine) g.fill(718, y - 5, 3, 11, "slot");
    }
  }
});

// ---- SOURCES: all six at once, and where each one goes ----------------------------------------------
var SW = 158; // a source's width
function reach(v, s) { // the destinations a source reaches, in the matrix's words
  var out = [];
  for (var d = 0; d < 6; d++) if (Math.abs(amount(v, d, s)) > 0.004) out.push(d < 4 ? DST_SHORT[d] : targetOf(v, d));
  return out;
}
// the random source as its mode moves: held steps, slewed steps, or a drift (a fixed draw, still)
var RND = [0.6, -0.3, 0.85, -0.7, 0.1, 0.45, -0.9, 0.3, -0.15, 0.7];
function randomPts(x, y, w, h, mode, slew) {
  var pts = [], n = RND.length, val = 0, mid = y + h / 2, a = h / 2 - 2;
  for (var i = 0; i <= 120; i++) {
    var p = i / 120 * n, k = Math.min(n - 1, Math.floor(p)), tgt = RND[k];
    if (mode === "smooth") { var c = 0.04 + (1 - slew) * 0.5; val += (tgt - val) * c; }
    else if (mode === "drift") { val = Math.sin(p * 0.9) * 0.5 + Math.sin(p * 2.3 + 1) * 0.25; }
    else val = tgt;
    pts.push(x + i / 120 * w, mid - val * a);
  }
  return pts;
}
function curvePts(x, y, w, h, fn) {
  var pts = [];
  for (var i = 0; i <= 40; i++) { var q = i / 40; pts.push(x + q * w, y + h - fn(q) * h); }
  return pts;
}
push.compartment({
  id: "sources", label: "Sources",
  pages: [
    { label: "LFO", keys: ["lfo_shape", "lfo_rate", "lfo_rate_mode", "lfo_retrig", "lfo_phase"] },
    { label: "Envelope", keys: ["env_attack_ms", "env_decay_ms", "env_sustain", "env_release_ms", "env_retrig"] },
    { label: "Cycling Env", keys: ["cycle_attack_ms", "cycle_decay_ms", "cycle_shape", "cycle_sync", "cycle_retrig", "cycle_bipolar"] },
    { label: "Random", keys: ["random_mode", "random_rate", "random_rate_mode", "random_slew", "random_retrig"] },
    { label: "Touch", keys: ["velocity_curve", "poly_aftertouch_curve"] }
  ],
  extra_keys: allMatrixKeys(),
  screen: function (g, v) {
    var t = v.$touched || "", page = v.$page || 0;
    var lit = [page === 0, page === 1, page === 2, page === 3, page === 4, page === 4];
    for (var s = 0; s < 6; s++) {
      var x = 4 + s * SW, w = SW - 12, mine = lit[s];
      g.text(x, 10, SRC_NAME[s], mine ? PRINT : PRINT2, -1);
      if (mine) g.fill(x, 13, w, 2, "slot");
      var r = reach(v, s);
      g.text(x, 84, r.length ? "> " + r.join(" ") : "NOT ROUTED", r.length ? COPPER : PRINT3, -1, w);
      if (s > 0) g.fill(x - 7, 4, 1, 78, "#24242a");
    }
    // LFO: Pung's LFO; its sync runs on the module's own 120 BPM, not Live's, so only a restart flashes
    g.lfo(4, 18, SW - 12, 54, { shape: "lfo_shape", rate: "lfo_rate", trig: "lfo_retrig", color: lit[0] ? PRINT : PRINT2 });
    // the envelope
    g.envelope(4 + SW, 18, SW - 12, 54, { attack: "env_attack_ms", decay: "env_decay_ms", sustain: "env_sustain", release: "env_release_ms", color: lit[1] ? PRINT : PRINT2 });
    // the cycling envelope: rise and fall, round and round
    var x2 = 4 + 2 * SW;
    g.envelope(x2, 18, SW - 12, 54, { attack: "cycle_attack_ms", decay: "cycle_decay_ms", still: true, color: lit[2] ? PRINT : PRINT2 });
    g.text(x2 + SW - 12, 10, (on(v, "cycle_bipolar") ? "+/-  " : "") + "LOOPS", PRINT3, 1);
    // random
    var x3 = 4 + 3 * SW, mode = raw(v, "random_mode");
    g.poly(randomPts(x3, 20, SW - 12, 50, mode === "smooth" ? "smooth" : (mode === "drift" ? "drift" : "sh"), fr(v, "random_slew", 0.3)), lit[3] ? 2 : 1.5, lit[3] ? (t === "random_mode" || t === "random_slew" ? "slot" : PRINT) : PRINT2);
    g.text(x3 + SW - 12, 10, mode === "smooth" ? "SMOOTH" : (mode === "drift" ? "DRIFT" : "S & H"), PRINT3, 1);
    // velocity: level = vel ^ curve
    var x4 = 4 + 4 * SW, vc = num(v, "velocity_curve", 1), ac = num(v, "poly_aftertouch_curve", 0);
    g.fill(x4, 72, SW - 12, 1, "#2a2a30"); g.fill(x4, 20, 1, 52, "#2a2a30");
    g.poly(curvePts(x4, 20, SW - 12, 52, function (q) { return Math.pow(q, vc); }), t === "velocity_curve" ? 3 : 2, t === "velocity_curve" ? "slot" : (lit[4] ? PRINT : PRINT2));
    var x5 = 4 + 5 * SW;
    g.fill(x5, 72, SW - 12, 1, "#2a2a30"); g.fill(x5, 20, 1, 52, "#2a2a30");
    g.poly(curvePts(x5, 20, SW - 12, 52, function (q) {
      return ac < 0 ? Math.pow(q, 1 - ac * 3) : (ac > 0 ? 1 - Math.pow(1 - q, 1 + ac * 3) : q);
    }), t === "poly_aftertouch_curve" ? 3 : 2, t === "poly_aftertouch_curve" ? "slot" : (lit[5] ? PRINT : PRINT2));
  }
});

// ---- VOICE: how voices are shared out, where the unison sits ---------------------------------------------
push.compartment({
  id: "voice", label: "Voice & Mix",
  pages: [{ label: "Voice & Mix", keys: ["volume", "pan", "voice_mode", "polyphony", "unison", "detune", "spread", "glide_ms"] }],
  screen: function (g, v) {
    var t = v.$touched || "";
    var mode = raw(v, "voice_mode") || "poly", poly = Math.round(num(v, "polyphony", 4)), uni = Math.round(num(v, "unison", 1));
    var mono = mode !== "poly", budget = mono ? uni : Math.min(8, poly * uni), notes = mono ? 1 : Math.max(1, Math.floor(budget / uni));
    // over volume and pan: the output's place
    var pan = num(v, "pan", 0), vol = num(v, "volume", 1);
    g.text(116, 12, "OUT", PRINT3, 0);
    g.fill(16, 44, 200, 1, "#2a2a30"); g.fill(116, 38, 1, 13, PRINT3);
    g.text(10, 48, "L", PRINT3, -1); g.text(222, 48, "R", PRINT3, 1);
    var px = 116 + pan * 100;
    g.dot(px, 44.5, 3 + Math.min(2, vol) * 2.5, t === "pan" || t === "volume" ? "slot" : COPPER);
    nowMark(g, v, "pan", 16, 44, 200);
    g.text(116, 76, known(v, "volume") ? valueOf(v, "volume") + "   " + valueOf(v, "pan") : "--", t === "volume" || t === "pan" ? "slot" : PRINT2, 0);
    g.fill(236, 4, 1, 78, "#2a2a30");
    // over mode, polyphony, unison: the eight voices, grouped by note
    g.text(296, 12, mono ? (mode === "mono_legato" ? "MONO LEGATO" : "MONO") : "POLY", t === "voice_mode" ? "slot" : PRINT, 0);
    for (var vi = 0; vi < 8; vi++) {
      var grp = Math.floor(vi / uni), used = vi < budget && grp < notes;
      var bx = 252 + vi * 27 + grp * 0;
      g.fill(bx, 30, 22, 22, used ? (grp % 2 ? COPPER_DK : COPPER) : "#1f1f25");
    }
    g.text(468, 70, (mono ? "ONE NOTE" : notes + (notes === 1 ? " NOTE" : " NOTES")) + " x " + uni + (uni === 1 ? " VOICE" : " VOICES") + (poly * uni > 8 && !mono ? "  (8 MAX)" : ""),
      t === "polyphony" || t === "unison" ? "slot" : PRINT2, 1);
    g.fill(476, 4, 1, 78, "#2a2a30");
    // over detune and spread: the unison stack as the engine places it (pan across, pitch up)
    var det = num(v, "detune", 0), spr = num(v, "spread", 0);
    var detN = frNow(v, "detune", det), sprN = frNow(v, "spread", spr); // the stack as the sound has it now (0..1 ranges)
    var cx = 600, cy = 46;
    g.fill(492, cy, 216, 1, "#2a2a30"); g.fill(cx, 18, 1, 58, "#2a2a30");
    g.text(496, 16, "+CENTS", PRINT3, -1); g.text(704, 80, "PAN", PRINT3, 1);
    var hot = t === "detune" || t === "spread";
    for (var u = 0; u < uni; u++) {
      var st = (u - 0.5 * (uni - 1)) * detN * 0.6, pp = uni > 1 ? (u / (uni - 1) * 2 - 1) * sprN : 0;
      g.dot(cx + pp * 100, cy - Math.max(-1, Math.min(1, st / 2.1)) * 26, 3.5, hot ? "slot" : PRINT);
    }
    g.text(704, 16, uni > 1 ? "+/- " + Math.round((uni - 1) * 0.5 * det * 0.6 * 100) + " CENTS" : "NO UNISON", PRINT2, 1);
    g.fill(716, 4, 1, 78, "#2a2a30");
    // over glide: how long a slide takes (a time constant: about 7 of them to arrive)
    var gl = num(v, "glide_ms", 0), gh = t === "glide_ms";
    g.text(836, 12, gl > 0 ? "GLIDE" : "NO GLIDE", gh ? "slot" : PRINT, 0);
    if (gl > 0) {
      var pts = [], tau = gl / 1000, span = Math.max(tau * 5, 0.05);
      for (var q = 0; q <= 40; q++) { var tt = q / 40 * span; pts.push(736 + q / 40 * 200, 70 - (1 - Math.exp(-tt / tau)) * 46); }
      g.poly(pts, gh ? 3 : 2, gh ? "slot" : COPPER);
      g.text(836, 82, "TO 99 % IN " + secs(tau * 4.6), PRINT2, 0);
    }
  }
});
