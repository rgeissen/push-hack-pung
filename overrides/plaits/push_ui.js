// Plaits (Mutable Instruments' macro oscillator) on the Push.
// An overlay shipped with Pung (Plaits itself ships no push_ui.js).
//
// Plaits is 24 synthesis engines behind three knobs whose meaning changes
// with the engine: HARMONICS, TIMBRE, MORPH are "detune, cutoff, resonance"
// on one and "preset, modulator level, envelope stretch" on the next. The
// module picks an engine with two buttons and shows it as one lit LED in a
// column of eight, green for the first bank, red for the second (noise and
// percussion), amber for the third (the engines added in Plaits 1.2). Its
// sound leaves through a low-pass gate, a vactrol that closes on its own
// time: the LPG's DECAY, its COLOUR (a VCA, or a VCA and a low-pass).
//
//   PANEL       the module front: the LED column, the three macro knobs with
//               what they mean on this engine (the module's own names,
//               plaits_plugin.cpp kEngineLabels), what the engine makes, the
//               LPG with its envelope
//   MODULATION  the internal envelope: with nothing patched, Plaits' three
//               attenuverters send its decay envelope to TIMBRE, FREQUENCY
//               and MORPH. Each dial shows where the knob stands and how far
//               a note's start takes it
//   LPG         the gate: attack (the plugin's), decay, colour, and how
//               velocity sets the level (plaits_plugin.cpp, render_block)

// ---- colours: brushed aluminium, black print, bicolour LEDs ----------------------------
var ALU = "#b9bcbf", ALU_DK = "#a4a8ac", INK = "#121314", INK2 = "#4c5054", INK3 = "#7c8185";
var KNOB = "#232426", KNOB_EDGE = "#0c0c0d", TRIM = "#ecebe6", WIN = "#0d0e0f", WIN_EDGE = "#6e7276";
var GREEN = "#3ee06a", RED = "#ff4134", AMBER = "#ffb21e", LED_OFF = "#7f8386";

function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value || "") : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? d : n; }

// ---- the engines, in the module's order, with its names for the three macros ---------------
var ENGINES = [
  ["VA VCF", "DETUNE", "CUTOFF", "RESONANCE", "vcf"],
  ["PHASE DIST", "RATIO", "PHASE", "DISTORTION", "pd"],
  ["6-OP I", "PRESET", "MOD LEVEL", "ENV STRETCH", "sixop"],
  ["6-OP II", "PRESET", "MOD LEVEL", "ENV STRETCH", "sixop"],
  ["6-OP III", "PRESET", "MOD LEVEL", "ENV STRETCH", "sixop"],
  ["WAVE TERR", "TERRAIN", "X", "Y", "terrain"],
  ["STR MACH", "DETUNE", "TONE", "ENVELOPE", ""],
  ["CHIPTUNE", "ARPEGGIO", "DUTY", "FILTER", "chip"],
  ["V. ANALOG", "DETUNE", "SQUARE", "SAW", "va"],
  ["WAVESHAPE", "OVERTONE", "WAVESHAPE", "FOLD", "shape"],
  ["FM", "RATIO", "FEEDBACK", "TOPOLOGY", "fm"],
  ["GRAIN", "POSITION", "SIZE", "DENSITY", ""],
  ["ADDITIVE", "BUMPS", "SLOPE", "SHIFT", "add"],
  ["WAVETABLE", "BANK", "POINTER", "MIRROR", "table"],
  ["CHORD", "CHORD", "TIMBRE", "WAVEFORM", ""],
  ["SPEECH", "PROSODY", "PHONEME", "FORMANT", ""],
  ["SWARM", "DETUNE", "SPREAD", "CHAOS", ""],
  ["NOISE", "FREQUENCY", "SLOPE", "RUGGEDNESS", ""],
  ["PARTICLE", "SPREAD", "EXTINCTION", "SCATTER", ""],
  ["STRING", "HARMONIC", "TIMBRE", "MORPH", "ring"],
  ["MODAL", "HARMONIC", "TIMBRE", "DECAY", "ring"],
  ["BASS DRUM", "FREQUENCY", "PUNCH", "DECAY", "ring"],
  ["SNARE DRUM", "FREQUENCY", "TONE", "DECAY", "ring"],
  ["HI-HAT", "FREQUENCY", "TONE", "DECAY", "ring"]
];
var MODULE_NAMES = ["VA VCF", "Phase Dist", "6-Op I", "6-Op II", "6-Op III", "Wave Terr", "Str Mach", "Chiptune", "V. Analog",
  "Waveshape", "FM", "Grain", "Additive", "Wavetable", "Chord", "Speech", "Swarm", "Noise", "Particle", "String", "Modal",
  "Bass Drum", "Snare Drum", "Hi-Hat"];
var SIXOP_BANK = ["BASSES AND SYNTHS", "KEYS AND PLUCKED", "ORGANS, PADS, BRASS"];
// the banks as the LEDs show them: the 1.2 engines amber, then green, then red
function bankOf(i) { return i < 8 ? 2 : (i < 16 ? 0 : 1); }
var BANK_COL = [GREEN, RED, AMBER], BANK_FIRST = [8, 16, 0];

function engineIndex(v) {
  if (!known(v, "engine")) return -1;
  var d = disp(v, "engine");
  for (var i = 0; i < MODULE_NAMES.length; i++) if (MODULE_NAMES[i] === d) return i;
  var n = parseInt(v.engine.value, 10);
  if (!isNaN(n) && n >= 0 && n < 24) return n;
  return Math.round(fr(v, "engine", 0) * 23);
}
function isSixOp(i) { return i >= 2 && i <= 4; }
// a 6-op engine's preset: the name the module answers, else its number from HARMONICS
function presetOf(v, i) {
  var idx = Math.min(31, Math.floor(fr(v, "harmonics", 0) * 1.02 * 32));
  var nm = disp(v, "fm_preset");
  if (nm && !/^\d+$/.test(nm)) return { name: nm.toUpperCase(), n: idx };
  return { name: "", n: idx };
}

// ---- what the engine makes -------------------------------------------------------------
// One cycle's shape for the engines that are a wave, simplified from what the
// engine does with its macros; a spectrum, a table or a terrain where that is
// what the macros move; a ringing strike for the resonators and drums.
function frac(x) { return x - Math.floor(x); }
function saw(p) { return 2 * frac(p) - 1; }
function sq(p, pw) { return frac(p) < pw ? 1 : -1; }
function tri(p) { var q = frac(p); return q < 0.5 ? 4 * q - 1 : 3 - 4 * q; }
function sine(p) { return Math.sin(2 * Math.PI * p); }
function waveFn(kind, H, T, M) {
  switch (kind) {
  case "va": // a variable square (TIMBRE narrows it) and a variable saw (MORPH: triangle to saw)
    var pw = 0.06 + Math.min(T, 0.5) * 0.88, r = 1 + (H - 0.5) * 0.04;
    return function (p) { var vs = tri(p * r) * (1 - M) + saw(p * r) * M; return 0.5 * sq(p, pw) + 0.5 * vs; };
  case "pd": // a cosine read through a bent phase: PHASE bends it, DISTORTION leans it
    var d = 0.5 - 0.47 * T, ratio = 1 + Math.round(H * 3);
    return function (p) {
      var q = frac(p * ratio), w = q < d ? q * 0.5 / d : 0.5 + (q - d) * 0.5 / (1 - d);
      return Math.cos(2 * Math.PI * (w * (1 - M) + q * M * 0.5 + w * M * 0.5));
    };
  case "chip": // a pulse of TIMBRE's duty
    var duty = 0.5 - T * 0.44;
    return function (p) { return sq(p, duty); };
  case "shape": // a triangle through the waveshaper and the folder (FOLD), leaned by MORPH
    var gain = 1 + M * 4, off = (H - 0.5) * 0.5;
    return function (p) { return Math.sin((tri(p) * (0.6 + T * 0.4) + off) * gain * 1.5); };
  case "fm": // a sine whose phase a second sine moves, at RATIO's interval
    var ratio2 = 0.5 + Math.round(H * 8) / 2, idx = 0.5 + T * 3;
    return function (p) { return Math.sin(2 * Math.PI * p + idx * Math.sin(2 * Math.PI * ratio2 * p)); };
  case "ring": // struck, then left to ring as long as the decay macro says
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
  var pts = [], mid = y + h / 2, a = h / 2 - 1, n = Math.round(w), prev = null, lo = 1e9, hi = -1e9, ys = [];
  for (var i = 0; i <= n; i++) { var s = fn(i / n * cycles); ys.push(s); if (s < lo) lo = s; if (s > hi) hi = s; }
  var span = Math.max(0.6, hi - lo), off = (hi + lo) / 2;
  for (var j = 0; j <= n; j++) {
    var yy = mid - (ys[j] - off) / span * 2 * a;
    if (prev !== null && Math.abs(yy - prev) > a * 0.5) pts.push(x + j, prev);
    pts.push(x + j, yy);
    prev = yy;
  }
  return pts;
}
// the window: what the engine makes, in Plaits' light print on black
function window(g, v, i, x, y, w, h, col, dim) {
  var e = ENGINES[i], H = fr(v, "harmonics", 0.5), T = fr(v, "timbre", 0.5), M = fr(v, "morph", 0.5);
  var hq = Math.round(H * 64) / 64, tq = Math.round(T * 64) / 64, mq = Math.round(M * 64) / 64;
  var fn = waveFn(e[4], hq, tq, mq);
  if (fn) {
    var cyc = e[4] === "ring" ? 8 : 2;
    g.poly(cached("w|" + i + "|" + hq + "|" + tq + "|" + mq + "|" + x + "|" + w, function () { return wavePts(x + 6, y + 6, w - 12, h - 12, cyc, fn); }), 2, col);
    return;
  }
  if (e[4] === "vcf") { // TIMBRE is the filter's cutoff, MORPH its resonance: Pung's filter, live
    g.filter(x + 2, y + 2, w - 4, h - 4, { cutoff: "timbre", resonance: "morph", type: "LP", color: col });
    return;
  }
  if (e[4] === "sixop") {
    var pr = presetOf(v, i);
    g.text(x + 8, y + 14, SIXOP_BANK[i - 2], dim, -1, w - 16);
    g.value(x + w / 2, y + h / 2 + 8, pr.name || "PRESET " + (pr.n + 1), col, 0, w - 16);
    g.text(x + w - 8, y + h - 6, (pr.n + 1) + "/32", dim, 1);
    return;
  }
  if (e[4] === "add") { // the harmonics: a bump at SLOPE's place, as many as BUMPS, narrowed by SHIFT
    var n = 24, bw = (w - 16) / n, bumps = 1 + Math.round(H * 3), c0 = 1 + T * 20, width = 0.8 + (1 - M) * 4;
    for (var k = 0; k < n; k++) {
      var a = 0;
      for (var b = 0; b < bumps; b++) a = Math.max(a, Math.exp(-Math.pow((k - c0 * (b + 1) / bumps * 1.0 - b * 3) / width, 2)));
      var bh = Math.max(1, Math.round(a * (h - 16)));
      g.fill(x + 8 + k * bw + 1, y + h - 6 - bh, Math.max(1, bw - 2), bh, col);
    }
    return;
  }
  if (e[4] === "table" || e[4] === "terrain") { // an 8 x 8 grid, TIMBRE across and MORPH down
    var gs = h - 14, gx = x + w / 2 - gs / 2, gy = y + 7;
    for (var q = 0; q < 8; q++) for (var r = 0; r < 8; r++) g.fill(gx + q * gs / 8 + gs / 16 - 1, gy + r * gs / 8 + gs / 16 - 1, 2, 2, dim);
    g.dot(gx + tq * gs, gy + mq * gs, 4.5, col);
    g.text(x + 8, y + 14, e[4] === "table" ? "BANK " + (Math.min(3, Math.floor(H * 4)) + 1) : "TERRAIN", dim, -1);
    return;
  }
  // no picture says more than the names: the three macros as the engine calls them, where each stands
  var ks = ["harmonics", "timbre", "morph"];
  for (var m = 0; m < 3; m++) {
    var yy = y + 14 + m * 17;
    g.text(x + 10, yy, e[1 + m], dim, -1);
    g.fill(x + 96, yy - 4, w - 106, 2, "#2a2c2e");
    if (known(v, ks[m])) g.fill(x + 96, yy - 6, Math.max(2, Math.round((w - 106) * fr(v, ks[m], 0))), 6, col);
  }
}

// ---- the knobs ----------------------------------------------------------------------------
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
function bigKnob(g, cx, cy, r) { // a black knob with a skirt, as Plaits' large ones
  g.dot(cx, cy, r + 2, KNOB_EDGE);
  g.dot(cx, cy, r, KNOB);
  g.dot(cx, cy, r * 0.7, "#2e3033");
}
function pointer(g, cx, cy, r, f, ok, hot, col) {
  if (hot) g.arc(cx, cy, r + 4, 0, Math.PI * 2, 2, "slot");
  if (!ok) return;
  var a = A0 + f * SWEEP;
  g.line(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), r > 12 ? 3 : 2, col);
}
function trim(g, cx, cy, r) { g.dot(cx, cy, r + 1, INK3); g.dot(cx, cy, r, TRIM); } // a white trimmer

// ---- the encoder row: the module's lower half, a white trimmer under each encoder ----------
function row(g, v, values, names) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, ok = known(v, k);
    var nm = names && names[i] ? names[i] : String(v[k].name).toUpperCase();
    var seg = !!v.$segmode, ky = seg ? 128 : 140, kr = seg ? 8 : 10; // segment mode: the row ends at y 142
    g.text(x + 60, seg ? 115 : 118, nm, hot ? INK : INK2, 0, 112);
    trim(g, x + 22, ky, kr);
    pointer(g, x + 22, ky, kr, fr(v, k, 0), ok, hot, INK);
    var val = values && values[i] !== undefined && values[i] !== null ? values[i] : (ok ? disp(v, k) + (v[k].unit ? " " + v[k].unit : "") : "--");
    g.value(x + 40, seg ? 136 : 147, val, hot ? "slot" : (ok ? INK : INK3), -1, 76);
  }
}
var PCT = { harmonics: 1, timbre: 1, morph: 1, fm_amount: 1, aux_mix: 1, lpg_colour: 1 };
function pct(v, k) { return known(v, k) ? Math.round(fr(v, k, 0) * 100) + " %" : "--"; }

// ---- the LPG's times ------------------------------------------------------------------------
// The plugin's attack: an exponential rise with a time constant of 0.005 + a^2 * 2 s
// (render_block); the LPG falls on Plaits' short decay, 0.1 * 2^(-8 decay) of the way
// each 24-sample block at 48 kHz: to -60 dB in 6.9 / that many blocks.
function attackSecs(a) { return 3 * (0.005 + a * a * 2); }
function decaySecs(d) { var c = 0.1 * Math.pow(2, -8 * d); return Math.log(1000) / c * 24 / 48000; }
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    var p = parseFloat(s.raw);
    if (s.plateau || isNaN(p)) return null;
    if (s.role === "attack") return attackSecs(p);
    if (s.key === "decay") return s.role === "decay" ? decaySecs(p) / 2 : decaySecs(p); // the internal envelope runs twice as fast
    return null;
  });
});
function secs(s) { return s < 0.1 ? Math.round(s * 1000) + " MS" : (s < 10 ? s.toFixed(2) + " S" : s.toFixed(1) + " S"); }

// How the module's bare numbers read wherever Pung writes them: the gate's times in
// seconds, the 0..1 knobs in percent, the octave as one, the engine by its name.
var PCT_KEYS = /^(harmonics|timbre|morph|lpg_colour|fm_amount|aux_mix|timbre_mod|morph_mod|velocity_sensitivity)$/;
push.display(function (key, raw) {
  var p = parseFloat(raw);
  if (key === "engine") { var n = parseInt(raw, 10); return /^\d+$/.test(String(raw)) && n >= 0 && n < 24 ? MODULE_NAMES[n] : undefined; }
  if (isNaN(p)) return;
  if (key === "decay") return secs(decaySecs(p)).toLowerCase();
  if (key === "attack") return secs(attackSecs(p)).toLowerCase();
  if (PCT_KEYS.test(key)) return { value: String(Math.round(p * 100)), unit: "%" };
  if (key === "octave_transpose") return (p > 0 ? "+" : "") + Math.round(p) + " oct";
});

// ---- PANEL -----------------------------------------------------------------------------------
var KX = [180, 300, 420]; // the three macro knobs, over their encoders
function panelGround(g, i) {
  g.fill(0, 0, 960, 160, ALU);
  g.value(10, 18, "PLAITS", INK, -1);
  // the LED column: the bank's eight engines, the one playing lit
  var b = i >= 0 ? bankOf(i) : 0, first = BANK_FIRST[b];
  for (var r = 0; r < 8; r++) {
    var j = first + r, me = j === i, y = 31 + r * 9.6;
    g.dot(14, y - 3, 3.2, me ? BANK_COL[b] : LED_OFF);
    g.text(24, y + 1, ENGINES[j][0], me ? INK : INK2, -1, 94);
  }
  // the macro knobs, printed and with the engine's own names under them
  var big = [22, 18, 18], labels = ["HARMONICS", "TIMBRE", "MORPH"];
  for (var k = 0; k < 3; k++) {
    g.text(KX[k], 14, labels[k], INK, 0);
    bigKnob(g, KX[k], 50, big[k]);
    var e = i >= 0 ? ENGINES[i][1 + k] : "";
    if (e) { var w = g.measure(e) + 12; g.fill(KX[k] - w / 2, 82, w, 14, INK); g.text(KX[k], 93, e, ALU, 0); }
  }
  // the window: what the engine makes
  g.fill(489, 6, 222, 92, WIN_EDGE);
  g.fill(490, 7, 220, 90, WIN);
  // the LPG
  g.fill(725, 6, 228, 74, WIN_EDGE);
  g.fill(726, 7, 226, 72, WIN);
  g.text(734, 19, "LPG", "#8d9296", -1);
  // the encoder row: the module's lower half
  g.fill(0, 104, 960, 1, INK3);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 112, 1, 42, ALU_DK);
}
function panel(g, v) {
  var i = engineIndex(v), t = v.$touched || "";
  g.layer("plaits|" + i, function () { panelGround(g, i); });
  var keys = ["harmonics", "timbre", "morph"], big = [22, 18, 18];
  for (var k = 0; k < 3; k++) pointer(g, KX[k], 50, big[k], fr(v, keys[k], 0), known(v, keys[k]), t === keys[k], "#f4f4f0");
  if (t === "engine") g.arc(14, 31 + (i >= 0 ? i - BANK_FIRST[bankOf(i)] : 0) * 9.6 - 3, 6, 0, Math.PI * 2, 1.5, "slot");
  if (i < 0) { g.text(600, 56, "--", "#6e7276", 0); return; }
  var hot = t === "harmonics" || t === "timbre" || t === "morph";
  g.text(498, 19, ENGINES[i][0], "#8d9296", -1);
  if (known(v, "harmonics") && known(v, "timbre") && known(v, "morph")) window(g, v, i, 490, 22, 220, 58, hot ? "slot" : "#f2f2ee", "#5d6266");
  // OUT and AUX: the mix knob's balance, under the window
  var mx = fr(v, "aux_mix", 0);
  g.text(498, 92, "OUT", mx < 0.5 ? "#f2f2ee" : "#5d6266", -1);
  g.text(702, 92, "AUX", mx > 0.5 ? "#f2f2ee" : "#5d6266", 1);
  g.fill(530, 88, 140, 1, "#3a3d40");
  if (known(v, "aux_mix")) g.fill(528 + 140 * mx, 84, 4, 9, t === "aux_mix" ? "slot" : "#f2f2ee");
  // the LPG: Pung's envelope (the plugin's attack, held, the decay), and its colour
  g.envelope(728, 22, 222, 56, { attack: "attack", release: "decay", color: t === "decay" ? "slot" : "#f2f2ee" });
  var col = fr(v, "lpg_colour", 0.5), cx = 760 + 128 * col;
  g.text(726, 96, "VCA", col < 0.5 ? INK : INK2, -1);
  g.text(952, 96, "VCF+VCA", col > 0.5 ? INK : INK2, 1);
  g.fill(760, 92, 128, 1, INK2);
  if (known(v, "lpg_colour")) g.fill(cx - 2, 87, 4, 10, t === "lpg_colour" ? "slot" : INK);
}
// Pung's default pages on Plaits' aluminium, with its white trimmers
push.theme({ ground: ALU, panel: TRIM, ink: INK, dim: INK2, rule: INK3, faint: ALU_DK, accent: INK2, knob: "pointer" });
push.compartment({
  id: "panel", label: "Plaits", front_panel: true,
  pages: [{ label: "Plaits", keys: ["engine", "harmonics", "timbre", "morph", "fm_amount", "aux_mix", "decay", "lpg_colour"] }],
  extra_keys: ["fm_preset", "attack"],
  // the module's sections: the oscillator (model, macros, their attenuverters), the outputs, the gate
  segments: [
    { id: "osc", label: "Oscillator", rect: [2, 3, 480, 99], keys: ["engine", "harmonics", "timbre", "morph", "timbre_mod", "fm_amount", "morph_mod", "octave_transpose"] },
    { id: "out", label: "Out", rect: [486, 3, 228, 98], keys: ["aux_mix", "legato", "octave_transpose"] },
    { id: "lpg", label: "LPG", rect: [722, 3, 234, 98], keys: ["attack", "decay", "lpg_colour", "velocity_sensitivity"] }
  ],
  screen: function (g, v) {
    panel(g, v);
    var i = engineIndex(v), kn = v.$knobs || [], vals = [], names = [];
    for (var c = 0; c < 8; c++) {
      var k = kn[c];
      names.push(i >= 0 && (k === "harmonics" || k === "timbre" || k === "morph") ? ENGINES[i][{ harmonics: 1, timbre: 2, morph: 3 }[k]] : "");
      if (k === "engine") vals.push(i >= 0 ? MODULE_NAMES[i] : "--");
      else if (k === "harmonics" && isSixOp(i)) vals.push("#" + (presetOf(v, i).n + 1));
      else if (k === "fm_amount" && isSixOp(i)) vals.push("OFF");
      else if (k === "decay") vals.push(known(v, k) ? secs(decaySecs(num(v, k, 0))) : "--");
      else if (PCT[k]) vals.push(pct(v, k));
      else vals.push(null);
    }
    row(g, v, vals, names);
  }
});

// ---- MODULATION: the internal envelope to TIMBRE, FREQUENCY and MORPH -----------------------
// Plaits' modulation: value + amount' * envelope, amount' = a * max(a - 0.05, 0.05) * 1.05
// (voice.cc, ApplyModulations), the envelope at 1 when a note starts.
function modAmount(a) { return a * Math.max(Math.abs(a) - 0.05, 0.05) * 1.05; }
function modDial(g, cx, cy, r, base, amt, ok, hot, label, sub) {
  g.arc(cx, cy, r, A0, SWEEP, 2, "line");
  if (ok) {
    var to = Math.min(1, base + amt);
    if (to - base > 0.004) {
      g.arc(cx, cy, r, A0 + base * SWEEP, (to - base) * SWEEP, 5, hot ? "slot" : "mod");
      g.dot(cx + Math.cos(A0 + to * SWEEP) * r, cy + Math.sin(A0 + to * SWEEP) * r, 4, hot ? "slot" : "mod");
    }
    var ba = A0 + base * SWEEP;
    g.line(cx + Math.cos(ba) * (r - 9), cy + Math.sin(ba) * (r - 9), cx + Math.cos(ba) * (r + 4), cy + Math.sin(ba) * (r + 4), 2, "fg");
  }
  g.text(cx, cy + 4, label, "dim", 0);
  g.text(cx, cy + r + 16, sub, hot ? "slot" : "fg", 0, 116);
}
push.compartment({
  id: "mod", label: "Modulation",
  pages: [{ label: "Modulation", keys: ["timbre_mod", "fm_amount", "morph_mod", "decay"] }],
  extra_keys: ["engine", "timbre", "morph"],
  screen: function (g, v) {
    var t = v.$touched || "", i = engineIndex(v), six = isSixOp(i);
    var tn = i >= 0 ? ENGINES[i][2] : "TIMBRE", mn = i >= 0 ? ENGINES[i][3] : "MORPH";
    var ta = modAmount(fr(v, "timbre_mod", 0)), ma = modAmount(fr(v, "morph_mod", 0)), fa = six ? 0 : modAmount(fr(v, "fm_amount", 0));
    modDial(g, 60, 36, 26, fr(v, "timbre", 0), ta, known(v, "timbre"), t === "timbre_mod", "T", tn);
    // frequency: the note's pitch, raised at the start of each note and falling back with the envelope
    g.arc(180, 36, 26, A0, SWEEP, 2, "line");
    if (fa > 0.004) {
      g.arc(180, 36, 26, A0 + 0.5 * SWEEP, Math.min(0.5, fa * 0.5) * SWEEP, 5, t === "fm_amount" ? "slot" : "mod");
    }
    g.line(180, 36 - 17, 180, 36 - 30, 2, "fg");
    g.text(180, 40, "F", "dim", 0);
    g.text(180, 78, six ? "OFF ON 6-OP" : "PITCH", t === "fm_amount" ? "slot" : (six ? "faint" : "fg"), 0);
    modDial(g, 300, 36, 26, fr(v, "morph", 0), ma, known(v, "morph"), t === "morph_mod", "M", mn);
    // over decay: the envelope itself, which all three follow
    g.fill(362, 4, 1, 78, "line");
    g.text(420, 12, known(v, "decay") ? secs(decaySecs(num(v, "decay", 0)) / 2) : "--", t === "decay" ? "slot" : "fg", 0);
    g.envelope(368, 18, 104, 62, { attack: 0, decay: "decay", sustain: 0, still: true, color: t === "decay" ? "slot" : "fg" });
    g.fill(480, 4, 1, 78, "line");
    g.text(496, 28, "WITH NOTHING PATCHED, PLAITS' ATTENUVERTERS SEND", "dim", -1);
    g.text(496, 42, "ITS DECAY ENVELOPE: A NOTE STARTS IT AT FULL AND", "dim", -1);
    g.text(496, 56, "IT FALLS AS FAST AS THE LPG CLOSES, TWICE AS FAST.", "dim", -1);
    g.text(496, 76, "THE ARC: WHERE A NOTE'S START TAKES THE KNOB.", "faint", -1);
  }
});

// ---- LPG: the gate, its colour, velocity ---------------------------------------------------------
push.compartment({
  id: "lpg", label: "LPG",
  pages: [{ label: "LPG", keys: ["attack", "decay", "lpg_colour", "velocity_sensitivity"] }],
  screen: function (g, v) {
    var t = v.$touched || "";
    // over attack and decay: the gate's envelope, in the plugin's and Plaits' times
    g.text(60, 12, known(v, "attack") ? secs(attackSecs(num(v, "attack", 0))) : "--", t === "attack" ? "slot" : "fg", 0);
    g.text(180, 12, known(v, "decay") ? secs(decaySecs(num(v, "decay", 0))) : "--", t === "decay" ? "slot" : "fg", 0);
    g.envelope(4, 16, 228, 70, { attack: "attack", release: "decay", labels: true });
    g.fill(240, 4, 1, 78, "line");
    // over colour: what the gate does as it closes, a VCA only or a low-pass closing too
    var col = fr(v, "lpg_colour", 0.5), hot = t === "lpg_colour";
    g.text(300, 12, col < 0.15 ? "VCA" : (col > 0.85 ? "VCF + VCA" : "VCA, SOME VCF"), hot ? "slot" : "fg", 0);
    g.filter(248, 18, 104, 56, { cutoff: 1 - col * 0.75, resonance: col * 0.3, type: "LP", color: hot ? "slot" : "fg" });
    g.text(300, 84, "AS IT CLOSES", "dim", 0);
    g.fill(360, 4, 1, 78, "line");
    // over velocity: how hard a key sets the level (level = vel * s + 1 - s)
    var s = fr(v, "velocity_sensitivity", 0.5), vh = t === "velocity_sensitivity", bx = 380, by = 18, bw = 80, bh = 56;
    g.fill(bx, by + bh, bw, 1, "line"); g.fill(bx, by, 1, bh, "line");
    g.poly([bx, by + bh * s, bx + bw, by], vh ? 3 : 2, vh ? "slot" : "fg");
    g.text(bx + 4, by + 8, "LEVEL", "dim", -1);
    g.text(bx + bw, by + bh + 12, "VELOCITY", "dim", 1);
    g.text(420, 12, Math.round((1 - s) * 100) + " % AT SOFTEST", vh ? "slot" : "fg", 0);
    // the hint: a vactrol's gate
    g.fill(480, 4, 1, 78, "line");
    g.text(496, 30, "A LOW-PASS GATE: WHILE A KEY IS DOWN IT STAYS OPEN,", "dim", -1);
    g.text(496, 46, "LET GO AND IT CLOSES IN ITS OWN TIME (DECAY).", "dim", -1);
    g.text(496, 70, "THE ATTACK IS THE PLUGIN'S OWN: PLAITS HAS NONE.", "faint", -1);
  }
});

// ---- PLAY: how notes are played ---------------------------------------------------------
push.compartment({ id: "play", label: "Play", pages: [{ label: "Play", keys: ["legato", "octave_transpose"] }] });
