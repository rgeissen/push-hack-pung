// Tenebrae on the Push: a dark, retro macro synth.
// An overlay shipped with Pung (Tenebrae ships no push_ui.js).
//
// Tenebrae describes itself as six pages of macros: every knob moves several
// things at once, each range cut so that most of its travel sounds good. Four
// pages make the sound (Osc, Filter, Amp, Mod), two dress it (FX Motion, FX
// Space). The screens make those macros visible: what each turn really does
// inside, computed from the engine's own laws (tenebrae_engine.h, tenebrae_fx.h):
//
//   PANEL   the six pages side by side as six lit tiles: the voice's wave,
//           the filter, the amp, the LFO, the motion chain and the space;
//           the sound pages in blood red, the dressing in night blue, the
//           patch in a giallo display
//   OSC     each knob's macro over its encoder: the eight models, the wave at
//           Shape (and where the filter envelope pushes it), the stack of up
//           to seven oscillators fanned by detune and width, the layer summed
//           at Blend, Age's drift, the glide
//   FILTER  the response, the three zones of Drive, how far the envelope
//           moves the cutoff (octaves), the filter envelope
//   AMP     the amp envelope, quadratic as the engine runs it, and Spread's
//           golden-ratio fan of a chord across the field
//   MOD     the LFO and its target, its delay and fade-in after the note,
//           what velocity, pressure and the wheel do
//   MOTION  tone, chorus, phaser, pump, VHS in the order the sound meets them
//   SPACE   the ping-pong tape echoes in time, the level, the reverb tail and
//           its shimmer
//
// Times, rates and frequencies are the engine's: an attack of 1 ms .. 8 s,
// decays 12 ms .. 24 s, the cutoff 20 Hz * 2^(10 x), the LFO 0.05 .. 25 Hz,
// the reverb's RT60 0.4 .. 24 s. The envelopes are quadratic ramps (the amp
// squares them again): their curves are passed to Pung's envelope as tables.

// ---- values -----------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function idx(v, k, n) { return Math.max(0, Math.min(n - 1, Math.round(num(v, k, 0)))); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function c01(x) { return clamp(x, 0, 1); }
function sstep(x) { x = c01(x); return x * x * (3 - 2 * x); }
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (key in CACHE) return CACHE[key];
  if (++CACHED > 96) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}

// ---- the engine's laws ------------------------------------------------------------------------------
var MODELS = ["SAW", "PULSE", "SYNC", "FM", "BELL", "WAVE", "VOX", "ZAP"];
var LAYERS = ["SUB SINE", "SUB SQUARE", "SUB -2 OCT", "OCTAVE DOWN", "FIFTH UP", "OCTAVE UP", "2 OCT UP", "NOISE"];
var LAYER_SHORT = ["SIN", "SQR", "-2", "-12", "+7", "+12", "+24", "NSE"];
var FTYPES = ["LP24", "LP12", "BP", "HP"], FNAMES = ["LP 24 dB", "LP 12 dB", "BP", "HP 12 dB"];
var TARGETS = ["PITCH", "SHAPE", "FILTER", "AMP", "PAN", "FILTER S&H", "SYNC RAMP"];
var PRESS = ["VIB + FILTER", "VIBRATO", "FILTER", "LFO DEPTH"];
var CHORUS = ["I", "II", "I+II", "ENSEMBLE", "DIMENSION"];
var DLY = ["1/16", "1/8T", "1/8", "1/8.", "1/4", "1/4.", "1/2"], DLY_BEATS = [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2];
var PUMP = ["1/2", "1/4", "1/8", "1/16"], PUMP_BEATS = [2, 1, 0.5, 0.25];
var RAMP = ["1/4", "1/8", "1/8T", "1/16", "1/32"];
var GLIDE_MS = [0, 0, 10, 20, 30, 45, 60, 80, 110, 150, 200, 270, 360, 480, 650, 900, 1200, 1600];
var MODEL_GAIN = [1.00, 0.68, 1.05, 1.10, 0.90, 1.85, 1.70, 0.95], MODEL_COPIES = [7, 7, 7, 5, 5, 7, 5, 7];
var STACK_REL = [0, -1, 1.03, 0.52, -0.57, -1.9, 1.84], STACK_PAN = [0, -0.85, 0.85, 0.55, -0.55, 1, -1];
var CATS = { BS: "BASS", LD: "LEAD", PD: "PAD", KY: "KEYS", PL: "PLUCK", BR: "BRASS", VX: "VOICE", ST: "STAB", SQ: "SEQ", FX: "FX" };

function attackS(x) { return 0.001 * Math.pow(8000, c01(x)); }       // tb_attack_step
function decayS(x) { return 0.012 * Math.pow(2000, c01(x)); }        // tb_decay_step (decay, release)
function cutHz(x) { return 20 * Math.pow(2, 10 * c01(x)); }          // cut_oct = 10 * cutoff, at C3
function lfoHz(x) { return 0.05 * Math.pow(500, c01(x)); }
function lfoDelayS(x) { x = c01(x); return 4 * x * x; }
function phaserHz(x) { return 0.03 * Math.pow(200, c01(x)); }
function rt60(x) { return 0.4 * Math.pow(60, c01(x)); }
function revDampHz(x) { return 1500 * Math.pow(9.5, c01(x)); }
function envOct(x) { return 8 * x * Math.abs(x); }                  // fenv_oct
// Stack: copies and the first pair's detune (cents), tb_frame_prepare
function stackOf(s, model) {
  var g1 = sstep(s / 0.10), g2 = sstep((s - 0.30) / 0.25), g3 = sstep((s - 0.55) / 0.25);
  if (MODEL_COPIES[model] < 7) g3 = 0;
  var n = g3 > 0.0005 ? 7 : g2 > 0.0005 ? 5 : g1 > 0.0005 ? 3 : 1;
  var gains = [1, g1, g1, g2, g2, g3, g3], d1 = 28 * (1 - Math.exp(-4 * s)), width = c01(s * 2.2);
  var pw = 1 + 2 * (g1 * g1 + g2 * g2 + g3 * g3), norm = Math.pow(pw, -0.40), out = [];
  for (var i = 0; i < 7; i++) out.push({ cents: STACK_REL[i] * d1, pan: STACK_PAN[i] * width, gain: gains[i] * norm });
  return { n: n, d1: d1, width: width, copies: out };
}
// Drive: the first half into the mixer's soft clip, then a hard clip after
// the amp per note, the last quarter the summed voices on the bus
function driveZone(d) { return d < 0.5 ? 0 : d < 0.75 ? 1 : 2; }
var DRIVE_WORDS = ["WARM", "BITE", "SNARL"];

// ---- one cycle of a model (tb_osc_control, tb_osc_tick, without the bleps) ----------------------------
var TAU = 2 * Math.PI;
function sn(c) { return Math.sin(TAU * c); }
var WT = [];
function wtHarm(w, h) {
  switch (w) {
  case 0: return h <= 6 ? 1 / (h * h * h * 0.5 + 0.5) : 0;
  case 1: { var bars = [1, 0.8, 0.45, 0.6, 0, 0.3, 0, 0.35, 0]; return h <= 9 ? bars[h - 1] : (h === 12 ? 0.15 : (h === 16 ? 0.12 : 0)); }
  case 2: return (h & 1) ? 1 / h : 0;
  case 3: { var d = (h - 7) / 2.5; return (1 / h) * (1 + 3 * Math.exp(-d * d)); }
  case 4: { var part = [1, 4, 7, 11, 16, 22, 29, 37, 46, 56]; for (var i = 0; i < 10; i++) if (part[i] === h) return 1 / (1 + 0.35 * i); return 0; }
  case 5: { var d1 = (h - 4) / 1.6, d2 = (h - 14) / 3; return (0.25 / h) + Math.exp(-d1 * d1) + 0.55 * Math.exp(-d2 * d2); }
  case 6: return (h % 3) ? 1 / Math.pow(h, 0.75) : 0;
  }
  return 1 / Math.sqrt(h);
}
function wtTable(w) { // 128 points a cycle, the first 64 harmonics, at the engine's normalisation
  if (WT[w]) return WT[w];
  var t = [], peak = 0;
  for (var n = 0; n < 128; n++) {
    var s = 0;
    for (var h = 1; h <= 64; h++) { var a = wtHarm(w, h); if (a) s += a * Math.sin(TAU * h * n / 128); }
    t.push(s); peak = Math.max(peak, Math.abs(s));
  }
  for (n = 0; n < 128; n++) t[n] /= peak || 1;
  return (WT[w] = t);
}
var VOWEL_F = [[325, 700, 2530], [450, 800, 2830], [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010]];
var VOWEL_A = [[1, 0.35, 0.06], [1, 0.5, 0.10], [1, 0.6, 0.22], [1, 0.45, 0.26], [1, 0.36, 0.30]];
var REF_HZ = 130.81; // the pictures play C3, where the cutoff reads as its knob
// a model's wave over `cyc` cycles of its own pitch, n points; ratio: the
// layer's pitch against the voice's
function modelWave(model, shape, n, cyc) {
  var out = [], i, p, x;
  var st = { z: 0 };
  for (i = 0; i < n; i++) {
    var ph = cyc * i / n, q = ph - Math.floor(ph);
    switch (model) {
    case 0: {
      var a, b, c, d;
      if (shape < 0.5) { x = shape * 2; a = 1.25 * (1 - x); b = x; c = 0; d = 0.17 * x; }
      else { x = (shape - 0.5) * 2; a = 0; b = 1 - 0.3 * x; c = 0.62 * x; d = 0.17; }
      p = b * (2 * q - 1) + a * (1 - 4 * Math.abs(q - 0.5)) + c * (q < 0.5 ? -1 : 1) - d * sn(q);
      break;
    }
    case 1: { var w = 0.5 - 0.47 * shape; p = 0.85 * (1 + 0.9 * shape) * ((q < w ? 1 : -1) - (2 * w - 1)); break; }
    case 2: { var r = Math.max(1, Math.pow(2, shape * 3.3)), s = q * r; p = 2 * (s - Math.floor(s)) - 1; break; }
    case 3: {
      var ia = 7.2 * Math.pow(shape, 1.5) / TAU, fb = 0.13 * shape;
      if (i === 0) for (var wu = 0; wu < 64; wu++) { var mw = sn(wu / 64 + fb * st.z); st.z = 0.5 * (st.z + mw); }
      var m = sn(q + fb * st.z); st.z = 0.5 * (st.z + m);
      p = sn(q + ia * m); break;
    }
    case 4: {
      var ib1 = 4.6 * Math.pow(c01(shape * 2), 1.4) / TAU, ib2 = 3.4 * Math.pow(c01(shape * 2 - 1), 1.2) / TAU;
      p = sn(ph + ib1 * sn(ph * 3.5) + ib2 * sn(ph * 7.0711)); break;
    }
    case 5: {
      var pos = shape * 7, w0 = Math.min(6, Math.floor(pos)), f = pos - w0, t0 = wtTable(w0), t1 = wtTable(w0 + 1), k = Math.floor(q * 128) % 128;
      p = t0[k] + (t1[k] - t0[k]) * f; break;
    }
    case 6: {
      var vp = shape * 4, v0 = Math.min(3, Math.floor(vp)), vf = vp - v0, track = clamp(1 + 0.12 * (48 - 60) / 12, 0.85, 1.35), sum = 0;
      for (var j = 0; j < 3; j++) {
        var fk = (VOWEL_F[v0][j] + (VOWEL_F[v0 + 1][j] - VOWEL_F[v0][j]) * vf) * track, am = VOWEL_A[v0][j] + (VOWEL_A[v0 + 1][j] - VOWEL_A[v0][j]) * vf;
        sum += am * sn(q * Math.max(1, fk / REF_HZ));
      }
      p = (1 - q) * (1 - q) * sum; break;
    }
    default: p = sn(q + 0.07 * sn(q));
    }
    out.push(p);
  }
  return out;
}
// the voice as the oscillator section makes it: the model at its gain and the
// layer at Blend (tb_frame_prepare: the layer comes up over the first half,
// the model goes down over the second), two cycles of the note
var LAYER_RATIO = [0.5, 0.5, 0.25, 0.5, 1.498307, 2, 4, 0];
function noiseAt(i) { var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
function voiceWave(model, shape, layer, blend, n) {
  return cached(["vw", model, shape.toFixed(3), layer, blend.toFixed(3), n].join("|"), function () {
    var main = modelWave(model, shape, n, 2), bl = c01(blend * 2), layG = bl * Math.sqrt(bl);
    var mainG = MODEL_GAIN[model] * (blend <= 0.5 ? 1 : c01(2 - blend * 2)), lay = [], i;
    if (layer >= 3 && layer <= 6) { lay = modelWave(model, shape, n, 2 * LAYER_RATIO[layer]); layG *= MODEL_GAIN[model] * 0.9; }
    else for (i = 0; i < n; i++) {
      var ph = 2 * i / n * LAYER_RATIO[layer], q = ph - Math.floor(ph);
      lay.push(layer === 0 ? sn(q) : layer === 7 ? 0 : 0.8 * (q < 0.5 ? 1 : -1));
    }
    if (layer === 7) layG *= 0.75; else if (layer === 0) layG *= 1.9;
    var sum = [], peak = 0, nz = layer === 7 ? layG : 0;
    for (i = 0; i < n; i++) { var s = main[i] * mainG + lay[i] * layG; sum.push(s); peak = Math.max(peak, Math.abs(s) + nz); }
    return { pts: sum, peak: peak, noise: nz, mainG: mainG, layG: layG };
  });
}

// ---- how values read (push.display) ------------------------------------------------------------------
function secs(s) { return s < 1 ? [String(Math.round(s * 1000)), "ms"] : [s < 10 ? s.toFixed(2) : s.toFixed(1), "s"]; }
function hz(f) { return f >= 1000 ? [(f / 1000).toFixed(f >= 10000 ? 1 : 2), "kHz"] : [f < 10 ? f.toFixed(2) : String(Math.round(f)), "Hz"]; }
function spct(x) { var n = Math.round(x * 100); return [(n > 0 ? "+" : "") + n, "%"]; }
function fmt(k, x) {
  switch (k) {
  case "amp_a": case "flt_a": return secs(attackS(x));
  case "amp_d": case "amp_r": case "flt_d": return secs(decayS(x));
  case "cutoff": return hz(cutHz(x));
  case "lfo_rate": return hz(lfoHz(x));
  case "lfo_delay": return x <= 0.001 ? "None" : secs(lfoDelayS(x));
  case "phs_rate": return hz(phaserHz(x));
  case "rev_size": return secs(rt60(x));
  case "rev_tone": return hz(revDampHz(x));
  case "voice": { var vi = Math.round(x); return vi <= 0 ? "Poly" : vi === 1 ? "Mono" : secs(GLIDE_MS[Math.min(17, vi)] / 1000); }
  case "layer": return ["Sub Sine", "Sub Sqr", "Sub -2", "Oct Down", "Fifth Up", "Oct Up", "2 Oct Up", "Noise"][clamp(Math.round(x), 0, 7)];
  case "flt_env": { var o = envOct(x); return [(o > 0.005 ? "+" : "") + o.toFixed(1), "oct"]; }
  case "shape_env": case "tone": case "rnd_osc": case "rnd_flt": case "rnd_amp": case "rnd_mod": case "rnd_mot": case "rnd_spc": case "rnd_fresh":
    return spct(x);
  }
  return null;
}
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmt(key, n);
  if (f === null) return;
  return typeof f === "string" ? f : { value: f[0], unit: f[1] };
});
function valueOf(v, k) {
  if (!known(v, k)) return "--";
  var f = fmt(k, num(v, k, 0));
  if (f !== null) return typeof f === "string" ? up(f) : f[0] + " " + up(f[1]);
  var d = txt(v, k), u = v[k].unit || "";
  if (v[k].type === "enum") return up(d);
  return (d + (u ? " " + u : "")).toUpperCase();
}

// ---- the look: black, bone legends, blood red for the sound, night blue for its dressing, a giallo display ----
var GROUND = "#0a090c", HEAD = "#060507", TILE = "#141117", TILE_HD = "#1d1820", RULE = "#3a3140", FAINT = "#2a2430";
var BONE = "#ece2d0", DIM = "#93868c", DIMMER = "#5e5459";
var RED = "#e5483d", RED_DK = "#5a1c1a", RED_MID = "#a8332c", BLUE = "#6c86f0", BLUE_DK = "#232c55", BLUE_MID = "#4a5db0";
var GIALLO = "#f2c43a", GIALLO_MID = "#b8902a", GIALLO_DK = "#3a2e0c", CAP = "#262028", CAP_HI = "#3a3238";

// a key's section, its colour
var SECTION_OF = {};
var SECTIONS = [
  { id: "osc", label: "OSC", col: RED, keys: ["model", "shape", "shape_env", "stack", "layer", "blend", "age", "voice"] },
  { id: "filter", label: "FILTER", col: RED, keys: ["flt_type", "cutoff", "reso", "drive", "flt_env", "flt_a", "flt_d", "flt_s"] },
  { id: "amp", label: "AMP", col: RED, keys: ["amp_a", "amp_d", "amp_s", "amp_r", "spread"] },
  { id: "mod", label: "MOD", col: RED, keys: ["lfo_dest", "lfo_rate", "lfo_depth", "lfo_delay", "vel", "press", "press_dest", "wheel"] },
  { id: "motion", label: "MOTION", col: BLUE, keys: ["cho_mode", "cho_mix", "phs_depth", "phs_rate", "pump", "pump_rate", "vhs", "tone"] },
  { id: "space", label: "SPACE", col: BLUE, keys: ["dly_mix", "dly_time", "dly_fb", "level", "rev_mix", "rev_size", "rev_tone", "shimmer"] }
];
SECTIONS.forEach(function (s) { s.keys.forEach(function (k) { SECTION_OF[k] = s; }); });
function colOf(k) { return SECTION_OF[k] ? SECTION_OF[k].col : GIALLO; }
var BIPOLAR = { shape_env: 1, flt_env: 1, tone: 1, rnd_osc: 1, rnd_flt: 1, rnd_amp: 1, rnd_mod: 1, rnd_mot: 1, rnd_spc: 1, rnd_fresh: 1 };
var NAMES = {
  model: "MODEL", shape: "SHAPE", shape_env: "SHAPE ENV", stack: "STACK", layer: "LAYER", blend: "BLEND", age: "AGE", voice: "GLIDE",
  flt_type: "TYPE", cutoff: "CUTOFF", reso: "RESONANCE", drive: "DRIVE", flt_env: "ENV AMT", flt_a: "F ATTACK", flt_d: "F DECAY", flt_s: "F SUSTAIN",
  amp_a: "ATTACK", amp_d: "DECAY", amp_s: "SUSTAIN", amp_r: "RELEASE", spread: "SPREAD",
  lfo_dest: "LFO TARGET", lfo_rate: "LFO RATE", lfo_depth: "LFO DEPTH", lfo_delay: "LFO DELAY", vel: "VELOCITY", press: "PRESSURE", press_dest: "PRESS TGT", wheel: "WHEEL",
  cho_mode: "CHORUS", cho_mix: "CHORUS MIX", phs_depth: "PHASER", phs_rate: "PHASER RATE", pump: "PUMP", pump_rate: "PUMP DIV", vhs: "VHS", tone: "TONE",
  dly_mix: "DELAY", dly_time: "DELAY TIME", dly_fb: "FEEDBACK", level: "LEVEL", rev_mix: "REVERB", rev_size: "SIZE", rev_tone: "COLOR", shimmer: "SHIMMER",
  rnd_osc: "OSC", rnd_flt: "FILTER", rnd_amp: "AMP", rnd_mod: "MOD", rnd_mot: "MOTION", rnd_spc: "SPACE", rnd_wild: "WILD", rnd_fresh: "FRESH"
};
function nameOf(v, k) { return NAMES[k] || up((v[k] && v[k].name) || k); }

// ---- a macro knob: a black cap with a bone pointer, the value's arc in its section's colour ----------------
var A0 = Math.PI * 0.75, SW = Math.PI * 1.5;
function knob(g, cx, cy, r, f, bip, col, ok) {
  g.arc(cx, cy, r + 3, A0, SW, 2, FAINT);
  g.dot(cx, cy, r, CAP);
  g.arc(cx, cy, r, A0, SW, 1, CAP_HI);
  if (!ok) { g.text(cx, cy + 4, "-", DIMMER, 0); return; }
  var a = bip ? 0.5 : 0, b = f;
  if (b < a) { var t0 = a; a = b; b = t0; }
  if (b - a > 0.003) g.arc(cx, cy, r + 3, A0 + SW * a, SW * (b - a), 3, col);
  var an = A0 + SW * f;
  g.line(cx + Math.cos(an) * 2, cy + Math.sin(an) * 2, cx + Math.cos(an) * (r - 2), cy + Math.sin(an) * (r - 2), 2, col === "slot" ? "slot" : BONE);
}
// a switch (an enum): the same cap, a tick at each position, the pointer on
// the one it is at, lit in the section's colour
var ENUM_N = { model: 8, layer: 8, voice: 18, flt_type: 4, lfo_dest: 7, press_dest: 4, cho_mode: 5, pump_rate: 4, dly_time: 7 };
function rotary(g, cx, cy, r, n, at, col, ok) {
  var ticks = Math.min(n, 9);
  for (var i = 0; i < ticks; i++) {
    var a = A0 + SW * i / (ticks - 1);
    g.line(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2), cx + Math.cos(a) * (r + 5), cy + Math.sin(a) * (r + 5), 1.5, FAINT);
  }
  g.dot(cx, cy, r, CAP);
  g.arc(cx, cy, r, A0, SW, 1, CAP_HI);
  if (!ok) { g.text(cx, cy + 4, "-", DIMMER, 0); return; }
  var an = A0 + SW * (n > 1 ? at / (n - 1) : 0);
  g.line(cx + Math.cos(an) * (r + 1), cy + Math.sin(an) * (r + 1), cx + Math.cos(an) * (r + 5), cy + Math.sin(an) * (r + 5), 2.5, col);
  g.line(cx, cy, cx + Math.cos(an) * (r - 2), cy + Math.sin(an) * (r - 2), 2, col === "slot" ? "slot" : BONE);
}

// the encoder row: under each encoder its knob, name and value; in segment
// mode Pung names the segments in the bottom 18 pixels, the row closes above
var ROW = 104;
function rowGround(g, seg) {
  g.fill(0, ROW, 960, 56, HEAD);
  for (var c = 1; c < 8; c++) g.fill(c * 120, ROW + 8, 1, seg ? 28 : 40, FAINT);
}
function encoderRow(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode;
  var cy = seg ? ROW + 19 : ROW + 27, r = seg ? 9 : 12;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x = c * 120, hot = k === t, ok = known(v, k), col = hot ? "slot" : colOf(k);
    if (ENUM_N[k]) rotary(g, x + 24, cy, r, ENUM_N[k], idx(v, k, ENUM_N[k]), col, ok);
    else knob(g, x + 24, cy, r, ok ? v[k].frac : 0.5, !!BIPOLAR[k], col, ok);
    g.text(x + 44, seg ? ROW + 14 : ROW + 20, nameOf(v, k), hot ? "slot" : DIM, -1, 74);
    g.value(x + 44, seg ? ROW + 32 : ROW + 42, valueOf(v, k), hot ? "slot" : BONE, -1, 74);
  }
}

// ---- the front panel ----------------------------------------------------------------------------------
var TILE_Y = 24, TILE_H = 78, TILE_W = 155;
function tileX(i) { return 5 + i * 159; }
function presetParts(v) {
  var name = txt(v, "preset_name"), m = /^([A-Z]{2})\s+(.*)$/.exec(name);
  return m && CATS[m[1]] ? [CATS[m[1]], up(m[2])] : ["", up(name)];
}
function spaced(g, x, y, s, col) { // the name, its capitals spaced as on a film's title card
  for (var i = 0; i < s.length; i++) { g.value(x, y, s.charAt(i), col, -1); x += g.measure(s.charAt(i), "value") + 5; }
  return x;
}
function panelGround(g, v, seg) {
  g.fill(0, 0, 960, 160, GROUND);
  g.fill(0, 0, 960, 20, HEAD);
  var x = spaced(g, 8, 16, "TENEBRAE", BONE);
  // the giallo display: the patch's number and name
  var pr = known(v, "preset") ? Math.round(num(v, "preset", 0)) : -1, pp = presetParts(v);
  var nw = Math.min(380, g.measure(pp[1] || "--", "value")), dw = 54 + (pp[0] ? g.measure(pp[0]) + 10 : 0) + nw + 10;
  g.fill(x + 10, 2, dw, 16, GIALLO_DK);
  g.value(x + 16, 16, pr < 0 ? "---" : ("00" + pr).slice(-3), GIALLO, -1);
  var nx = x + 54;
  if (pp[0]) { g.text(nx, 14, pp[0], GIALLO_MID, -1); nx += g.measure(pp[0]) + 10; }
  g.value(nx, 16, pp[1] || "--", GIALLO, -1, 380);
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(952, 14, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, DIM, 1);
  else if (!seg) g.text(952, 14, "MACRO SYNTH", DIMMER, 1);
  for (var i = 0; i < 6; i++) {
    var S = SECTIONS[i], tx = tileX(i);
    g.fill(tx, TILE_Y, TILE_W, TILE_H, TILE);
    g.fill(tx, TILE_Y, TILE_W, 15, TILE_HD);
    g.fill(tx, TILE_Y, 3, 15, S.col);
  }
  rowGround(g, seg);
}
function tileHead(g, i, v, fact, lit) {
  var S = SECTIONS[i], tx = tileX(i);
  g.text(tx + 9, TILE_Y + 12, S.label, lit ? "slot" : S.col, -1);
  if (fact) g.text(tx + TILE_W - 6, TILE_Y + 12, fact, GIALLO, 1, TILE_W - 70);
}
function caption(g, i, l, r, lcol, rcol) {
  var tx = tileX(i), y = TILE_Y + TILE_H - 5, rw = r ? Math.min(96, g.measure(r)) : 0;
  if (l) g.text(tx + 8, y, l, lcol || DIM, -1, TILE_W - 15 - (rw ? rw + 8 : 0));
  if (r) g.text(tx + TILE_W - 7, y, r, rcol || DIM, 1, 96);
}
function waveIn(g, x, y, w, h, wv, col, ok) {
  var n = wv.pts.length, mid = y + h / 2, amp = wv.peak < 1e-4 ? 0 : (h / 2 - 1) / wv.peak, pts = [];
  g.fill(x, Math.round(mid), w, 1, FAINT);
  if (wv.noise > 0.001) {
    var nw = w / n;
    for (var j = 0; j < n; j += 2) {
      var a = wv.pts[j] * amp, nz = wv.noise * amp * (0.55 + 0.45 * Math.abs(noiseAt(j)));
      g.fill(x + j * nw, mid - a - nz, nw * 2, nz * 2, RED_DK);
    }
  }
  for (var i = 0; i < n; i++) pts.push(x + w * i / (n - 1), mid - wv.pts[i] * amp);
  if (amp > 0) g.poly(pts, 2, ok ? col : DIMMER);
  else g.text(x + w / 2, mid - 4, "SILENT", DIMMER, 0);
}
// levels drawn in decibels, -48..0 dB over the height: an echo at 18 % is
// -15 dB, as the ear hears it, not a speck
function dbH(a, h) { return a <= 0 ? 0 : h * c01(1 + 20 * Math.log(a) / Math.LN10 / 48); }
// the space over 6 s (at 120 BPM): the note, its tape echoes (ping-pong:
// left bone, right blue, each the last times the feedback) over the reverb's
// tail falling 60 dB in RT60 after its pre-delay; levels in dB
function spaceIn(g, x, y, w, h, v, secsWide, hot) {
  var mix = num(v, "dly_mix", 0), fb = num(v, "dly_fb", 0) * 0.9, dt = DLY_BEATS[idx(v, "dly_time", 7)] * 0.5;
  var rv = num(v, "rev_mix", 0), sz = num(v, "rev_size", 0.5), rt = rt60(sz), pre = 0.004 + 0.055 * sz;
  var base = y + h, sc = w / secsWide;
  g.fill(x, base, w, 1, FAINT);
  if (rv > 0.004) {
    var tail = [], L = dbH(rv, h - 2);
    for (var s = 0; s <= 32; s++) {
      var tt = secsWide * s / 32, lv = tt < pre ? 0 : L * c01(1 - (tt - pre) / rt);
      tail.push(x + tt * sc, base - lv);
    }
    g.area(tail, base, hot === "rev" ? "#252e5e" : "#1a2142");
    g.poly(tail, 2, hot === "rev" ? "slot" : BLUE_MID);
  }
  g.fill(x, y, 3, h, BONE); // the note
  if (mix > 0.004) {
    var a = mix;
    for (var e = 1; e * dt * sc < w - 2 && a > 0.004; e++) {
      var eh = Math.max(2, dbH(a, h - 2));
      g.fill(Math.round(x + e * dt * sc) - 1, base - eh, 3, eh, hot === "dly" ? "slot" : e % 2 ? BONE : "#9fb0f6");
      a *= fb;
    }
  }
}
// the motion chain: five meters in the order the sound meets them
var MOTION = [["TONE", "tone", true], ["CHO", "cho_mix"], ["PHS", "phs_depth"], ["PUMP", "pump"], ["VHS", "vhs"]];
function motionIn(g, x, y, w, h, v, t) {
  var cw = w / 5;
  for (var i = 0; i < 5; i++) {
    var M = MOTION[i], k = M[1], f = num(v, k, 0), cx = Math.round(x + cw * i + cw / 2), hot = t === k || (k === "cho_mix" && t === "cho_mode") ||
      (k === "phs_depth" && t === "phs_rate") || (k === "pump" && t === "pump_rate"), on = Math.abs(f) > 0.004;
    var top = y + 2, bot = y + h - 14, bh = bot - top;
    g.fill(cx - 7, top, 14, bh, FAINT);
    if (M[2]) { // tone: from the middle, down dark, up bright
      var m = Math.round(top + bh / 2), d = Math.round(Math.abs(f) * bh / 2);
      if (on) g.fill(cx - 7, f > 0 ? m - d : m, 14, d, hot ? "slot" : BLUE);
      g.fill(cx - 10, m, 20, 1, DIM);
    } else if (on) g.fill(cx - 7, Math.round(bot - f * bh), 14, Math.round(f * bh), hot ? "slot" : BLUE);
    g.text(cx, y + h - 1, M[0], hot ? "slot" : on ? BONE : DIMMER, 0);
  }
}
function lfoShapeName(dest) { return dest === 0 ? "Sine" : dest === 5 ? "S&H" : dest === 6 ? "Saw Down" : "Tri"; }
// the envelopes' stages as the engine runs them (tb_env_tick): quadratic
// ramps, the amp's level their square (a_s is the square root of Sustain),
// given to Pung's envelope as how far along each stage is at 17 even times
function table(f) { var out = []; for (var i = 0; i <= 16; i++) out.push(c01(f(i / 16))); return out; }
var Q_RISE = table(function (t) { return 1 - (1 - t) * (1 - t); });
var AMP_ATTACK = table(function (t) { var e = 1 - (1 - t) * (1 - t); return e * e; });
var AMP_RELEASE = table(function (t) { return 1 - Math.pow(1 - t, 4); });
function ampCurves(v) {
  var s = c01(num(v, "amp_s", 0.8)), ss = Math.sqrt(s);
  var decay = s > 0.999 ? Q_RISE : cached("ad" + s.toFixed(3), function () {
    return table(function (t) { var e = ss + (1 - ss) * (1 - t) * (1 - t); return (1 - e * e) / (1 - s); });
  });
  return { attack: AMP_ATTACK, decay: decay, release: AMP_RELEASE };
}
function fltCurves() { return { attack: Q_RISE, decay: Q_RISE, release: Q_RISE }; }

function frontPanel(g, v) {
  var t = v.$touched || "", seg = !!v.$segmode, lit = v.$segmode === "segment" ? v.$segment : "";
  g.layer(["tp", txt(v, "preset_name"), num(v, "preset", -1), v.$page, (v.$pages || []).length, seg].join("|"), function () { panelGround(g, v, seg); });
  var model = idx(v, "model", 8), shape = num(v, "shape", 0.5), layer = idx(v, "layer", 8), blend = num(v, "blend", 0);
  // OSC: the voice's wave, its stack and layer
  var x0 = tileX(0), st = stackOf(num(v, "stack", 0), model), osHot = SECTIONS[0].keys.indexOf(t) >= 0, vm = idx(v, "voice", 18);
  tileHead(g, 0, v, known(v, "model") ? MODELS[model] + (blend > 0.004 ? " + " + LAYER_SHORT[layer] : "") : "--", lit === "osc");
  waveIn(g, x0 + 8, TILE_Y + 22, TILE_W - 16, 38, voiceWave(model, shape, layer, blend, 140), osHot ? "slot" : BONE, known(v, "model"));
  caption(g, 0, st.n + (st.n === 1 ? " OSC" : " OSCS"), !known(v, "voice") ? "" : vm === 0 ? "POLY" : vm === 1 ? "MONO" : "GLIDE " + secs(GLIDE_MS[vm] / 1000).join(" ").toUpperCase(),
    t === "stack" ? "slot" : st.n > 1 ? BONE : DIM, t === "voice" ? "slot" : BONE);
  // FILTER: Pung's response, live; the zone Drive is in
  var x1 = tileX(1), ft = idx(v, "flt_type", 4), dr = num(v, "drive", 0);
  tileHead(g, 1, v, known(v, "flt_type") ? FTYPES[ft] : "--", lit === "filter");
  g.filter(x1 + 2, TILE_Y + 17, TILE_W - 4, 46, { cutoff: "cutoff", resonance: "reso", type: FNAMES[ft], at: c01(num(v, "cutoff", 0.6) * 1.0034), color: RED });
  caption(g, 1, "DRIVE " + (dr < 0.004 ? "OFF" : DRIVE_WORDS[driveZone(dr)]), "", t === "drive" ? "slot" : dr > 0.004 ? BONE : DIM);
  // AMP: Pung's envelope, live, quadratic as the engine runs it
  var x2 = tileX(2), spr = num(v, "spread", 0);
  tileHead(g, 2, v, spr > 0.004 ? "SPREAD " + Math.round(spr * 100) + "%" : "", lit === "amp");
  g.envelope(x2 + 2, TILE_Y + 17, TILE_W - 4, 59, { attack: "amp_a", decay: "amp_d", sustain: "amp_s", release: "amp_r", curves: ampCurves(v), color: RED });
  // MOD: the LFO (free running: still), its target
  var x3 = tileX(3), dest = idx(v, "lfo_dest", 7), dep = num(v, "lfo_depth", 0);
  tileHead(g, 3, v, known(v, "lfo_dest") ? TARGETS[dest] : "--", lit === "mod");
  g.lfo(x3 + 2, TILE_Y + 17, TILE_W - 4, 46, { shape: lfoShapeName(dest), rate: "lfo_rate", color: dep > 0.004 ? RED : DIMMER });
  caption(g, 3, dep > 0.004 ? "DEPTH " + Math.round(dep * 100) + "%" : "DEPTH 0: OFF",
    dest === 6 ? RAMP[Math.min(4, Math.floor(c01(num(v, "lfo_rate", 0)) * 4.999))] : hz(lfoHz(num(v, "lfo_rate", 0.5))).join(" ").toUpperCase(),
    t === "lfo_depth" ? "slot" : dep > 0.004 ? BONE : DIM, t === "lfo_rate" ? "slot" : DIM);
  // MOTION: the chain's five stages
  var x4 = tileX(4), cm = idx(v, "cho_mode", 5);
  tileHead(g, 4, v, num(v, "cho_mix", 0) > 0.004 ? ["CHO I", "CHO II", "CHO I+II", "ENSEMBLE", "DIMENSION"][cm] : "", lit === "motion");
  motionIn(g, x4 + 6, TILE_Y + 20, TILE_W - 12, 55, v, t);
  // SPACE: echoes and the tail over two seconds (at 120 BPM)
  var x5 = tileX(5);
  tileHead(g, 5, v, num(v, "dly_mix", 0) > 0.004 ? "ECHO " + DLY[idx(v, "dly_time", 7)] : "", lit === "space");
  var sHot = t === "dly_mix" || t === "dly_time" || t === "dly_fb" ? "dly" : /^rev_|shimmer/.test(t) ? "rev" : "";
  spaceIn(g, x5 + 8, TILE_Y + 20, TILE_W - 16, 40, v, 6.0, sHot);
  caption(g, 5, num(v, "rev_mix", 0) > 0.004 ? "TAIL " + secs(rt60(num(v, "rev_size", 0.5))).join(" ").toUpperCase() : "NO REVERB",
    num(v, "shimmer", 0) > 0.004 ? "+ OCT" : "", /^rev_/.test(t) ? "slot" : num(v, "rev_mix", 0) > 0.004 ? BONE : DIM, t === "shimmer" ? "slot" : GIALLO);
  encoderRow(g, v);
}

// Pung's default pages in Tenebrae's black, its pointer knobs, the blood red arc
push.theme({ ground: TILE, panel: CAP, ink: BONE, dim: DIM, rule: RULE, faint: FAINT, accent: RED, knob: "pointer" });

push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true,
  pages: [
    { label: "Sound", keys: ["model", "shape", "stack", "cutoff", "reso", "drive", "flt_env", "amp_r"] },
    { label: "Dress", keys: ["age", "cho_mix", "phs_depth", "pump", "vhs", "tone", "dly_mix", "rev_mix"] }
  ],
  segments: SECTIONS.map(function (S, i) { return { id: S.id, label: S.label.charAt(0) + S.label.slice(1).toLowerCase(), rect: [tileX(i), TILE_Y, TILE_W, TILE_H], keys: S.keys }; }),
  extra_keys: ["preset", "preset_name"].concat(SECTIONS.reduce(function (a, S) { return a.concat(S.keys); }, [])),
  screen: frontPanel
});

// ---- the band screens: the tile's black, a section strip ---------------------------------------------
function band(g, key, col, strips) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, TILE);
    for (var i = 0; i < strips.length; i++) {
      var s = strips[i];
      g.fill(s[0], 0, s[1], 12, TILE_HD);
      g.fill(s[0], 0, 3, 12, col);
      g.text(s[0] + 8, 10, s[2], col, -1, s[1] - 12);
    }
  });
}
function hotIn(t, ks) { return ks.indexOf(t) >= 0; }
function bar(g, x, y, w, f, col, bip) {
  g.fill(x, y, w, 3, FAINT);
  if (bip) { var m = x + w / 2, d = f * w / 2; g.fill(Math.min(m, m + d), y, Math.abs(d), 3, col); g.fill(m, y - 2, 1, 7, DIM); }
  else g.fill(x, y, Math.max(0, w * c01(f)), 3, col);
}

// ---- OSC: every knob's macro over its encoder -----------------------------------------------------------
push.compartment({
  id: "osc", label: "Osc",
  pages: [{ label: "Osc", keys: SECTIONS[0].keys }],
  screen: function (g, v) {
    band(g, "osc", RED, [[0, 117, "MODEL"], [119, 236, "SHAPE  /  SHAPE ENV"], [357, 117, "STACK"], [476, 236, "LAYER  /  BLEND"], [714, 117, "AGE"], [833, 119, "VOICE"]]);
    var t = v.$touched || "", model = idx(v, "model", 8), shape = num(v, "shape", 0.5), se = num(v, "shape_env", 0), layer = idx(v, "layer", 8), blend = num(v, "blend", 0), i;
    // the models: a rotary switch's eight positions
    for (i = 0; i < 8; i++) {
      var on = known(v, "model") && i === model, y = 29 + (i % 4) * 15, x = i < 4 ? 10 : 62;
      if (on) g.fill(x - 5, y - 11, 50, 14, t === "model" ? "slot" : RED);
      g.text(x, y, MODELS[i], on ? "#000000" : DIM, -1);
    }
    // the wave at Shape, and where the filter envelope takes Shape
    var sh = hotIn(t, ["shape", "shape_env"]), ok = known(v, "shape") && known(v, "model"), sx0 = 129, sw = 216;
    waveIn(g, sx0, 17, sw, 42, voiceWave(model, shape, 0, 0, 120), sh ? "slot" : BONE, ok);
    bar(g, sx0, 66, sw, shape, t === "shape" ? "slot" : RED);
    if (Math.abs(se) > 0.004) {
      var to = c01(shape + se), xs = sx0 + sw * shape, xt = sx0 + sw * to, ec = t === "shape_env" ? "slot" : GIALLO, d = se > 0 ? -5 : 5;
      g.fill(Math.min(xs, xt), 72, Math.abs(xt - xs), 2, ec);
      g.poly([xt + d, 69, xt, 73, xt + d, 77], 2, ec);
    }
    g.text(sx0, 84, shapeWords(model, shape), t === "shape" ? "slot" : BONE, -1, 130);
    g.text(sx0 + sw, 84, Math.abs(se) > 0.004 ? "ENV: " + (se > 0 ? "UP" : "DOWN") : "NO ENV", t === "shape_env" ? "slot" : Math.abs(se) > 0.004 ? GIALLO : DIMMER, 1, 90);
    // the stack: each oscillator at its detune (up: sharp) and its place in the field
    var st = stackOf(num(v, "stack", 0), model), stH = t === "stack", cx = 416, fy = 18, fh = 48, fw = 48;
    g.fill(cx - fw, fy + fh / 2, 2 * fw, 1, FAINT);
    g.fill(cx, fy, 1, fh, FAINT);
    g.text(cx - fw - 2, fy + fh / 2 + 4, "L", DIMMER, 1); g.text(cx + fw + 3, fy + fh / 2 + 4, "R", DIMMER, -1);
    for (i = 6; i >= 0; i--) {
      var cp = st.copies[i];
      if (cp.gain < 0.002) continue;
      g.dot(cx + cp.pan * fw, fy + fh / 2 - clamp(cp.cents / 56, -1, 1) * (fh / 2 - 3), 2 + 3 * Math.min(1, cp.gain), stH ? "slot" : i === 0 ? BONE : RED);
    }
    var spread = 0;
    for (i = 1; i < 7; i++) if (st.copies[i].gain > 0.002) spread = Math.max(spread, Math.abs(st.copies[i].cents));
    g.text(cx, 84, st.n === 1 ? "ONE OSCILLATOR" : st.n + " OSCS  +-" + Math.round(spread) + " CT", stH ? "slot" : st.n > 1 ? BONE : DIM, 0, 112);
    // the layer under the model, summed at Blend: the voice it makes
    var lh = hotIn(t, ["layer", "blend"]), wv = voiceWave(model, shape, layer, blend, 140), bx = 486, bw = 216;
    waveIn(g, bx, 17, bw, 42, wv, lh ? "slot" : BONE, known(v, "layer") && known(v, "blend"));
    g.fill(bx, 66, bw, 3, FAINT);
    g.fill(bx, 66, bw * blend, 3, t === "blend" ? "slot" : RED);
    g.fill(bx + bw / 2, 63, 1, 9, DIM);
    var mg = Math.round(Math.min(1, wv.mainG / MODEL_GAIN[model]) * 100), lg = Math.round(c01(blend * 2) * 100);
    g.text(bx, 84, MODELS[model] + " " + mg + "%", mg ? BONE : DIM, -1, 90);
    g.text(bx + bw, 84, (layer === 0 ? "CLEAN " : "") + LAYERS[layer] + " " + lg + "%", t === "layer" ? "slot" : lg ? BONE : DIM, 1, 140);
    // Age: three voices' pitch over 4 s, each wobbling at its own pair of
    // rates (0.42 and 1.05 Hz, 5 and 2 cents at full) on its own drift and
    // detune (to 22 and 14 cents): drawn on a +-30 cent scale
    var age = num(v, "age", 0), a2 = age * age, ah = t === "age", ax = 724, aw = 98, ay = 42, ascale = 22 / 30;
    g.fill(ax, ay, aw, 1, FAINT);
    var VOICES = [[0.42 * 1.2, 1.05 * 0.8, 0.1, 0.7, 0.55, -0.3], [0.42 * 0.8, 1.05 * 1.2, 0.6, 0.2, -0.75, 0.6], [0.42, 1.05, 0.35, 0.9, 0.2, -0.9]];
    var traces = cached("age" + a2.toFixed(4), function () {
      var all = [];
      for (var q = 0; q < 3; q++) {
        var V = VOICES[q], pts = [];
        for (var s = 0; s <= 40; s++) {
          var tt = 4 * s / 40, c = a2 * (5 * Math.sin(TAU * (V[2] + V[0] * tt)) + 2 * Math.sin(TAU * (V[3] + V[1] * tt))) + a2 * (14 * V[4] + 22 * V[5] * Math.sin(TAU * 0.3 * tt + q));
          pts.push(ax + aw * s / 40, ay - clamp(c, -30, 30) * ascale);
        }
        all.push(pts);
      }
      return all;
    });
    for (i = 0; i < 3; i++) g.poly(traces[i], 2, ah ? "slot" : age > 0.004 ? [BONE, RED, RED_MID][i] : DIM);
    g.fill(ax, ay - 30 * ascale, 3, 1, DIMMER); g.fill(ax, ay + 30 * ascale, 3, 1, DIMMER);
    g.text(ax + aw / 2, 84, age < 0.004 ? "EXACT, IN STEP" : "+-" + Math.round(43 * a2) + " CT" + (age >= 0.12 ? ", FREE" : ""), ah ? "slot" : age > 0.004 ? BONE : DIM, 0, 112);
    // the voice: poly, mono, or the time the pitch slides between held notes
    var vm = idx(v, "voice", 18), gh = t === "voice", gx = 843, gw = 100, gy0 = 64, gy1 = 24;
    if (vm < 2) {
      g.value(gx + gw / 2, 50, vm === 0 ? "POLY" : "MONO", gh ? "slot" : BONE, 0);
      g.text(gx + gw / 2, 84, vm === 0 ? "8 VOICES" : "LAST NOTE WINS", DIM, 0);
    } else {
      // the pitch from one held note to the next: a one-pole slide with a
      // time constant of 0.35 x the glide time (glide_coef), one second shown
      var ms = GLIDE_MS[vm], tc = ms * 0.35, gp = [gx, gy0];
      for (i = 0; i <= 40; i++) { var tg = 1000 * i / 40; gp.push(gx + 10 + (gw - 10) * i / 40, gy0 - (gy0 - gy1) * (1 - Math.exp(-tg / tc))); }
      g.fill(gx, gy1, gw, 1, FAINT);
      g.poly(gp, 2, gh ? "slot" : RED);
      g.text(gx + gw / 2, 84, "1 S SHOWN", DIMMER, 0, 112);
    }
  }
});
function shapeWords(model, s) {
  switch (model) {
  case 0: return s < 0.2 ? "TRIANGLE" : s < 0.45 ? "TRI INTO SAW" : s < 0.55 ? "SAW" : "SAW + SQUARE";
  case 1: return "PULSE " + Math.round((0.5 - 0.47 * s) * 100) + "%";
  case 2: return "SYNC x" + Math.pow(2, s * 3.3).toFixed(2);
  case 3: return "INDEX " + (7.2 * Math.pow(s, 1.5)).toFixed(1) + " RAD";
  case 4: return s < 0.5 ? "STRUCK METAL" : "CLANG";
  case 5: return ["SOFT", "ORGAN", "HOLLOW", "REED", "GLASS", "VOICE", "COMB", "SPIKE"][Math.min(7, Math.round(s * 7))];
  case 6: return "VOWEL " + ["OO", "OH", "AH", "EH", "EE"][Math.min(4, Math.round(s * 4))];
  }
  return "DROPS " + Math.round(72 * s * s) + " ST";
}

// ---- FILTER: the response, the three zones of Drive, the envelope ------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: SECTIONS[1].keys }],
  extra_keys: ["amp_r"],
  screen: function (g, v) {
    band(g, "filter", RED, [[0, 355, "FILTER"], [357, 117, "DRIVE"], [476, 117, "ENV AMOUNT"], [595, 357, "FILTER ENVELOPE  (RELEASES WITH THE AMP)"]]);
    var t = v.$touched || "", ft = idx(v, "flt_type", 4), cut = num(v, "cutoff", 0.6), i;
    g.filter(0, 13, 355, 73, { cutoff: "cutoff", resonance: "reso", type: FNAMES[ft], at: c01(cut * 1.0034), color: RED });
    g.text(346, 26, FTYPES[ft], t === "flt_type" ? "slot" : GIALLO, 1);
    // Drive: three zones on one knob, stacked as a meter, the level in its zone
    var d = num(v, "drive", 0), dh = t === "drive", z = driveZone(d), mx = 367, my0 = 74, mh = 56;
    var zones = [[0, 0.5, "WARM", "INTO FILTER"], [0.5, 0.75, "BITE", "PER NOTE"], [0.75, 1, "SNARL", "THE CHORD"]];
    for (i = 0; i < 3; i++) {
      var y0 = my0 - mh * zones[i][1], h = mh * (zones[i][1] - zones[i][0]) - 2, lit = d > 0.004 && i <= z;
      g.fill(mx, y0 + 1, 12, h, FAINT);
      if (lit) { var top = Math.max(y0 + 1, my0 - mh * d); g.fill(mx, top, 12, y0 + 1 + h - top, dh ? "slot" : [RED_MID, RED, "#ff7a5a"][i]); }
      g.text(mx + 20, y0 + h / 2 + 5, zones[i][2], i === z && d > 0.004 ? (dh ? "slot" : BONE) : DIMMER, -1);
    }
    g.text(mx, 84, d < 0.004 ? "CLEAN" : zones[z][3], dh ? "slot" : d > 0.004 ? DIM : DIMMER, -1, 110);
    // the envelope's reach: how many octaves it moves the cutoff, either way
    var fe = num(v, "flt_env", 0), oc = envOct(fe), eh = t === "flt_env", ex = 534, ey0 = 44, sc = 3.2;
    for (i = -8; i <= 8; i += 4) { g.fill(ex - (i ? 6 : 14), ey0 - i * sc, i ? 12 : 28, 1, i ? FAINT : DIM); }
    g.text(ex + 18, ey0 - 8 * sc + 4, "+8", DIMMER, -1); g.text(ex + 18, ey0 + 8 * sc + 4, "-8", DIMMER, -1);
    if (Math.abs(oc) > 0.01) {
      var ty = ey0 - oc * sc, ec = eh ? "slot" : GIALLO;
      g.fill(ex - 1, Math.min(ey0, ty), 3, Math.abs(ty - ey0), ec);
      g.poly([ex - 6, ty + (oc > 0 ? 6 : -6), ex, ty, ex + 6, ty + (oc > 0 ? 6 : -6)], 2, ec);
    }
    g.text(ex, 84, Math.abs(oc) < 0.01 ? "NONE" : (oc > 0 ? "OPENS " : "CLOSES ") + Math.abs(oc).toFixed(1) + " OCT", eh ? "slot" : Math.abs(oc) > 0.01 ? GIALLO : DIMMER, 0, 112);
    g.envelope(595, 13, 357, 73, { attack: "flt_a", decay: "flt_d", sustain: "flt_s", release: "amp_r", curves: fltCurves(), labels: true, color: GIALLO });
  }
});

// ---- AMP: the envelope and Spread's fan ------------------------------------------------------------------
push.compartment({
  id: "amp", label: "Amp",
  pages: [{ label: "Amp", keys: SECTIONS[2].keys }],
  extra_keys: ["voice"],
  screen: function (g, v) {
    band(g, "amp", RED, [[0, 474, "AMP ENVELOPE"], [476, 476, "SPREAD: EACH NEW NOTE TAKES THE NEXT PLACE"]]);
    var t = v.$touched || "";
    g.envelope(0, 13, 474, 73, { attack: "amp_a", decay: "amp_d", sustain: "amp_s", release: "amp_r", curves: ampCurves(v), labels: true, color: RED });
    // a golden-ratio walk across the field, as wide as Spread (tb_voice_start);
    // a mono voice has no chord to spread
    var sp = num(v, "spread", 0), mono = idx(v, "voice", 18) > 0, sh = t === "spread", cx = 714, w = 210, y = 44;
    g.fill(cx - w, y, 2 * w, 1, FAINT);
    g.fill(cx, y - 22, 1, 44, DIM);
    g.text(cx - w - 6, y + 4, "L", DIMMER, 1); g.text(cx + w + 6, y + 4, "R", DIMMER, -1);
    if (mono || sp < 0.004) {
      g.dot(cx, y, 7, sh ? "slot" : BONE);
      g.text(cx + 14, y - 10, mono ? "ONE VOICE" : "ALL NOTES", DIM, -1);
    } else {
      // the first eight notes of a chord, numbered in the order they come;
      // neighbours that land together stack up
      var used = [];
      for (var n = 1; n <= 8; n++) {
        var s = n * 0.6180339, pos = 2 * (s - Math.floor(s)) - 1, px = Math.round(cx + pos * sp * w), row = 0;
        for (var u = 0; u < used.length; u++) if (Math.abs(used[u] - px) < 15) row++;
        used.push(px);
        var py = y - 10 + (row % 3) * 15 - 5;
        g.dot(px, py, 7, sh ? "slot" : n === 1 ? BONE : RED);
        g.text(px + 1, py + 5, String(n), "#000000", 0);
      }
    }
    g.text(cx, 84, mono ? "MONO: THE VOICE STAYS IN THE MIDDLE" : sp < 0.004 ? "EVERY NOTE IN THE MIDDLE" : "LOW NOTES CLOSE UP TO THE MIDDLE",
      sh ? "slot" : sp > 0.004 && !mono ? DIM : DIMMER, 0, 460);
  }
});

// ---- MOD: the LFO, where it goes, when it comes in; the player's hands ---------------------------------------
push.compartment({
  id: "mod", label: "Mod",
  pages: [{ label: "Mod", keys: SECTIONS[3].keys }],
  screen: function (g, v) {
    band(g, "mod", RED, [[0, 117, "TARGET"], [119, 236, "LFO"], [357, 117, "AFTER A NOTE"], [476, 476, "THE PLAYER"]]);
    var t = v.$touched || "", dest = idx(v, "lfo_dest", 7), dep = num(v, "lfo_depth", 0), on = dep > 0.004, i;
    var TSHORT = ["PITCH", "SHAPE", "FILTER", "AMP", "PAN", "S&H", "RAMP"];
    for (i = 0; i < 7; i++) {
      var sel = known(v, "lfo_dest") && i === dest, y = 29 + (i % 4) * 15, x = i < 4 ? 10 : 64;
      if (sel) g.fill(x - 5, y - 11, 50, 14, t === "lfo_dest" ? "slot" : on ? RED : RED_DK);
      g.text(x, y, TSHORT[i], sel ? "#000000" : DIM, -1);
    }
    g.lfo(119, 13, 236, 58, { shape: lfoShapeName(dest), rate: "lfo_rate", color: on ? RED : DIMMER });
    var rate = dest === 6 ? "RAMP " + RAMP[Math.min(4, Math.floor(c01(num(v, "lfo_rate", 0)) * 4.999))] + " ON THE BEAT" : "FREE RUNNING";
    g.text(129, 84, rate, t === "lfo_rate" ? "slot" : DIM, -1, 140);
    g.text(345, 84, on ? TARGETS[dest] : "OFF", t === "lfo_depth" ? "slot" : on ? GIALLO : DIMMER, 1, 90);
    // LFO Delay: held back (4 s x^2), then faded in (0.35 s + half the delay)
    var dl = lfoDelayS(num(v, "lfo_delay", 0)), fd = 0.35 + 0.5 * dl, dh = t === "lfo_delay", x0 = 367, w = 98, sc = w / 6, ly = 54, lt = 26;
    for (var s = 0; s <= 6; s++) g.fill(x0 + s * sc, ly + 2, 1, s % 2 ? 3 : 5, FAINT);
    g.fill(x0, ly, w, 1, FAINT);
    g.fill(x0, lt - 4, 2, ly - lt + 6, BONE);
    var xd = x0 + Math.min(w, dl * sc), xf = x0 + Math.min(w, (dl + fd) * sc), lc = dh ? "slot" : on ? RED : DIM;
    if (xd > x0 + 2) g.fill(x0 + 2, ly - 1, xd - x0 - 2, 2, dh ? "slot" : DIM);
    g.poly([xd, ly, xf, lt], 2, lc);
    if (x0 + w > xf) g.fill(xf, lt - 1, x0 + w - xf, 2, lc);
    g.text(x0, 84, dl < 0.002 ? "FADES IN AT ONCE" : "WAITS " + secs(dl).join(" ").toUpperCase(), dh ? "slot" : BONE, -1, 112);
    // the hands: what each does, how much
    var rows = [
      ["vel", "VELOCITY", "LEVEL, BRIGHTNESS", num(v, "vel", 0.5)],
      ["press", "PRESSURE", PRESS[idx(v, "press_dest", 4)], num(v, "press", 0.5)],
      ["wheel", "MOD WHEEL", "VIBRATO", num(v, "wheel", 0.5)]
    ];
    for (i = 0; i < 3; i++) {
      var r = rows[i], ry = 32 + i * 20, hot = t === r[0], live = r[3] > 0.004;
      g.text(488, ry, r[1], hot ? "slot" : live ? BONE : DIM, -1);
      bar(g, 584, ry - 5, 176, r[3], hot ? "slot" : live ? RED : DIM);
      g.text(940, ry, live ? r[2] : "OFF", t === "press_dest" && r[0] === "press" ? "slot" : live ? GIALLO : DIMMER, 1, 160);
    }
  }
});

// ---- FX MOTION: the chain as the sound meets it ----------------------------------------------------------------
var CHORUS_RATES = [[0.513, 0.863], [0.863, 0.863], [0.513, 0.863], [0.63, 6.1], [0.25, 0.863]];
push.compartment({
  id: "motion", label: "FX Motion",
  pages: [{ label: "FX Motion", keys: SECTIONS[4].keys }],
  screen: function (g, v) {
    band(g, "motion", BLUE, [[0, 236, "CHORUS"], [238, 236, "PHASER"], [476, 236, "PUMP  (THE WHOLE MIX, TAILS TOO)"], [714, 238, "VHS  /  TONE"]]);
    var t = v.$touched || "", cm = idx(v, "cho_mode", 5), cmx = num(v, "cho_mix", 0), i;
    for (i = 0; i < 5; i++) {
      var sel = known(v, "cho_mode") && i === cm, x = 10 + i * 44;
      g.fill(x, 20, 40, 18, sel ? (t === "cho_mode" ? "slot" : cmx > 0.004 ? BLUE : BLUE_DK) : FAINT);
      g.text(x + 20, 33, ["I", "II", "I+II", "ENS", "DIM"][i], sel ? "#000000" : DIM, 0);
    }
    bar(g, 10, 52, 216, cmx, t === "cho_mix" ? "slot" : BLUE);
    var cr = CHORUS_RATES[cm];
    g.text(10, 70, ["CLASSIC I", "CLASSIC II", "CLASSIC I + II", "STRING ENSEMBLE", "DIMENSION: WIDE, NO WOBBLE"][cm], cmx > 0.004 ? BONE : DIM, -1, 220);
    g.text(10, 84, "SWEEPS " + cr[0] + (cm === 2 || cm === 3 ? " + " + cr[1] : "") + " HZ", DIM, -1, 220);
    // phaser: its notches over the band, as deep as Depth; its sweep rate
    var pd = num(v, "phs_depth", 0), pr = phaserHz(num(v, "phs_rate", 0.3)), ph = hotIn(t, ["phs_depth", "phs_rate"]), notches = [];
    for (i = 0; i <= 80; i++) { var u = i / 80; notches.push(248 + 216 * u, 26 + pd * 26 * (0.5 - 0.5 * Math.cos(TAU * u * 3))); }
    g.fill(248, 26, 216, 1, FAINT);
    g.poly(notches, 2, ph ? "slot" : pd > 0.004 ? BLUE : DIMMER);
    bar(g, 248, 66, 216, pd, t === "phs_depth" ? "slot" : BLUE);
    var per = 1 / pr;
    g.text(248, 84, "ONE SWEEP " + (per < 1 ? Math.round(per * 1000) + " MS" : per.toFixed(1) + " S"), t === "phs_rate" ? "slot" : DIM, -1, 216);
    // pump: the duck on every division, back by 72% of it (tenebrae_fx.h)
    var pu = num(v, "pump", 0), pi = idx(v, "pump_rate", 4), puh = hotIn(t, ["pump", "pump_rate"]), px = 486, pw = 216, top = 22, bot = 64;
    var beats = PUMP_BEATS[pi], span = 2, pts = [];
    for (i = 0; i <= 160; i++) {
      var b = span * i / 160, f = (b / beats) - Math.floor(b / beats), xx = 1 - c01(f / 0.72);
      pts.push(px + pw * i / 160, top + (bot - top) * (pu * 0.96 * xx * xx));
    }
    for (var bt = 0; bt <= span; bt += 0.25) g.fill(px + pw * bt / span, bot + 3, 1, bt % 1 ? 2 : 5, FAINT);
    g.poly(pts, 2, puh ? "slot" : pu > 0.004 ? BLUE : DIMMER);
    g.text(px, 84, pu > 0.004 ? "DUCKS " + Math.round(-20 * Math.log(1 - pu * 0.96) / Math.LN10) + " DB EVERY " + PUMP[pi] : "NO PUMP", puh ? "slot" : pu > 0.004 ? BONE : DIM, -1, 170);
    g.text(px + pw, 84, "2 BEATS", DIMMER, 1);
    // VHS and Tone: the tape's wear, the tilt
    var vh = num(v, "vhs", 0), tn = num(v, "tone", 0), vx = 724;
    g.text(vx, 30, "VHS", t === "vhs" ? "slot" : vh > 0.004 ? BONE : DIM, -1);
    bar(g, vx + 46, 25, 170, vh, t === "vhs" ? "slot" : BLUE);
    g.text(vx + 46, 44, vh > 0.004 ? "WOW, FLUTTER, HISS" : "CLEAN", vh > 0.004 ? DIM : DIMMER, -1, 180);
    g.text(vx, 66, "TONE", t === "tone" ? "slot" : Math.abs(tn) > 0.004 ? BONE : DIM, -1);
    bar(g, vx + 46, 61, 170, tn, t === "tone" ? "slot" : BLUE, true);
    g.text(vx + 46, 82, tn < -0.004 ? "DARK AND HEAVY" : tn > 0.004 ? "AIR, LOW CUT " + Math.round(18 * Math.pow(30, c01(tn))) + " HZ" : "A LITTLE AIR", DIM, -1, 180);
  }
});

// ---- FX SPACE: echoes in time, the tail -----------------------------------------------------------------------
push.compartment({
  id: "space", label: "FX Space",
  pages: [{ label: "FX Space", keys: SECTIONS[5].keys }],
  screen: function (g, v) {
    band(g, "space", BLUE, [[0, 355, "TAPE DELAY  (PING-PONG, DARKENING)"], [357, 117, "LEVEL"], [476, 476, "REVERB  /  SHIMMER"]]);
    var t = v.$touched || "", mix = num(v, "dly_mix", 0), fb = num(v, "dly_fb", 0) * 0.9, di = idx(v, "dly_time", 7), dh = hotIn(t, ["dly_mix", "dly_time", "dly_fb"]);
    // the echoes over 4 beats in dB (-48..0): left above the line, right below
    var x0 = 10, w = 336, mid = 44, half = 26, beats = 4, sc = w / beats, a = mix, n = 0;
    for (var b = 0; b <= beats; b++) g.fill(x0 + b * sc, 18, 1, 54, FAINT);
    g.fill(x0, mid, w, 1, DIM);
    g.fill(x0, mid - half, 3, 2 * half, BONE);
    for (var e = 1; e * DLY_BEATS[di] <= beats + 1e-6 && mix > 0.004 && a > 0.004; e++) {
      var ex = x0 + e * DLY_BEATS[di] * sc, h = Math.max(2, dbH(a, half)), left = e % 2 === 1;
      g.fill(ex - 1, left ? mid - h : mid + 1, 3, h, dh ? "slot" : left ? BLUE : "#9fb0f6");
      a *= fb; n++;
    }
    g.text(x0, 84, mix > 0.004 ? n + " ECHOES ABOVE -48 DB" : "NO DELAY", dh ? "slot" : mix > 0.004 ? DIM : DIMMER, -1, 260);
    g.text(346, 84, "4 BEATS", DIMMER, 1);
    // the output level
    var lv = num(v, "level", 0.7), lh = t === "level";
    g.fill(405, 18, 16, 58, FAINT);
    g.fill(405, Math.round(18 + 58 * (1 - lv)), 16, Math.round(58 * lv), lh ? "slot" : BLUE);
    g.text(430, 50, "OUT", lh ? "slot" : DIM, -1);
    // the reverb's tail over 8 s: its pre-delay, then 60 dB down in RT60
    var rv = num(v, "rev_mix", 0), sz = num(v, "rev_size", 0.5), rt = rt60(sz), rh = hotIn(t, ["rev_mix", "rev_size", "rev_tone", "shimmer"]);
    var rx = 488, rw = 300, top = 18, base = 72, secsW = 8, pts = [], pre = 0.004 + 0.055 * sz, shim = num(v, "shimmer", 0), L = dbH(rv, base - top);
    for (var s = 0; s <= 80; s++) {
      var tt = secsW * s / 80, lvl = tt < pre ? 0 : L * c01(1 - (tt - pre) / rt);
      pts.push(rx + rw * s / 80, base - lvl);
    }
    for (s = 0; s <= secsW; s++) g.fill(rx + rw * s / secsW, base + 1, 1, s % 4 ? 2 : 5, FAINT);
    if (rv > 0.004) g.area(pts, base, rh ? "#2a3570" : BLUE_DK);
    g.poly(pts, 2, rh ? "slot" : rv > 0.004 ? BLUE : DIMMER);
    if (shim > 0.004) g.text(rx + rw - 4, top + 10, "+ AN OCTAVE UP", t === "shimmer" ? "slot" : GIALLO, 1);
    g.text(rx, 84, rv < 0.004 ? "NO REVERB" : "-60 DB IN " + secs(rt).join(" ").toUpperCase() + ", PRE " + Math.round(pre * 1000) + " MS", t === "rev_size" ? "slot" : rv > 0.004 ? DIM : DIMMER, -1, 220);
    g.text(rx + rw, 84, "8 S", DIMMER, 1);
    // its colour: where the tail's damping starts, on a 1.5 .. 14 kHz scale
    var rc = num(v, "rev_tone", 0.5), ch = t === "rev_tone", cx0 = 808, cw = 130;
    g.text(cx0, 30, "DARK", DIMMER, -1); g.text(cx0 + cw, 30, "BRIGHT", DIMMER, 1);
    bar(g, cx0, 38, cw, rc, ch ? "slot" : BLUE);
    g.text(cx0, 60, "TAIL DAMPED", DIM, -1);
    g.text(cx0 + cw, 60, "ABOVE", DIM, 1);
    g.value(cx0 + cw, 80, hz(revDampHz(rc)).join(" ").toUpperCase(), ch ? "slot" : BONE, 1);
  }
});

// ---- Random: the module's own knobs, on Pung's page in Tenebrae's colours ----------------------------------------
push.compartment({
  id: "random", label: "Random",
  pages: [{ label: "Random", keys: ["rnd_osc", "rnd_flt", "rnd_amp", "rnd_mod", "rnd_mot", "rnd_spc", "rnd_wild", "rnd_fresh"] }]
});

// ---- the engine's envelope times (tb_attack_step, tb_decay_step) -------------------------------------------------
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    if (s.key === "amp_a" || s.key === "flt_a") return attackS(s.raw);
    if (s.key === "amp_d" || s.key === "amp_r" || s.key === "flt_d") return decayS(s.raw);
    return null;
  });
});
