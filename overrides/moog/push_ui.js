// RaffoSynth (a monophonic synthesizer after the classic American mono: four
// oscillators, a ladder filter; the module's own name) on Push. An overlay
// shipped with Pung (the module ships no push_ui.js).
//
// The instrument is the classic mono's panel between two wooden cheeks, read
// left to right as the signal goes: CONTROLLERS, OSCILLATOR BANK, MIXER,
// MODIFIERS (the filter, its contour, the loudness contour), OUTPUT. The
// screens keep that panel and its words:
//
//   PANEL        the front panel: every section at a glance (the four
//                oscillators in their ranges and waves, the mixer's knobs and
//                rocker switches, the ladder filter with where its contour
//                takes the cutoff, both contours, the output), the encoders
//                as the panel's black knobs with the engine's own units
//   OSCILLATORS  the bank as it sounds: each oscillator's wave at its range
//                (an octave apart is twice the cycles), and what the mixer
//                makes of them together
//   FILTER       the ladder's response, how far the contour and the keys
//                move it, the filter contour
//   MODULATION   the LFO and where it goes: to the pitch only through the
//                mod wheel, to the filter always
//   MIXER, LOUDNESS, PERFORMANCE  Pung's own pages (its mixer, its envelope)
//
// The engine's units (src/dsp/moog_engine.c): ranges -2..2 are 32' to 2'
// (an octave each); detune (osc 2, 3: 0 is none) (d - 0.5) * 100 cents;
// cutoff 20 Hz * 1000^c; the contour adds amount * envelope to c, the keys
// (note - 60) / 127 * follow; envelope stages 0.001 + p^2 * 5 s; LFO 0.1 +
// 20 r^2 Hz, a sine: pitch +-2 semitones * depth * mod amount * wheel,
// filter +-0.3 * depth * mod amount of the cutoff's travel; bend range * 12
// semitones; glide p^2 * 2 s.

// ---- the panel's colours ---------------------------------------------------------------
var WOOD = "#5e3b1e", WOOD_DK = "#3f2612", WOOD_GRAIN = "#4d3018", WOOD_HI = "#76502c";
var PANEL = "#141414", RULE = "#d8d5cc", PRINT = "#f0ede4", PRINT_DIM = "#8f8c84", PRINT_FAINT = "#3c3b38";
var CAP = "#0a0a0a", CAP_RIM = "#9d9d98", CAP_SKIRT = "#2b2b2a", BLUE = "#3a72c4", BLUE_OFF = "#1b2c46";
var ORANGE = "#e9842a", ORANGE_OFF = "#4a2c12", CURVE = "#e6dfcc", WIN = "#050505";

// ---- values ------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? Math.max(0, Math.min(1, v[k].frac)) : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

// ---- the engine's units (moog_engine.c) ----------------------------------------------------------
var WAVES = ["Triangle", "Sawtooth", "Square", "Pulse"], WAVE_SHORT = ["TRI", "SAW", "SQR", "PULSE"];
var FEET = { "-2": "32'", "-1": "16'", "0": "8'", "1": "4'", "2": "2'" };
function wave(v, i) { return clamp(Math.round(num(v, "osc" + i + "_wave", 1)), 0, 3); }
function range(v, i) { return clamp(Math.round(num(v, "osc" + i + "_range", 0)), -2, 2); }
// osc 2 and 3 take 0 as no detune at all (the engine skips it), osc 4 its middle
function detuneCents(v, i) {
  if (i === 1) return 0;
  var d = num(v, "osc" + i + "_detune", 0.5);
  if (i < 4 && Math.abs(d) <= 0.001) return 0;
  return (d - 0.5) * 100;
}
function cutHz(c) { return 20 * Math.pow(1000, c); }
function stageS(p) { return 0.001 + p * p * 5; }
function lfoHz(r) { return 0.1 + r * r * 20; }
function fmtHz(h) { return h >= 1000 ? (h >= 9950 ? Math.round(h / 1000) : (h / 1000).toFixed(1)) + " kHz" : (h >= 10 ? Math.round(h) : h.toFixed(1)) + " Hz"; }
function fmtS(s) { return s >= 1 ? s.toFixed(s >= 9.95 ? 0 : 2) + " s" : (s * 1000 >= 10 ? Math.round(s * 1000) : (s * 1000).toFixed(1)) + " ms"; }
function pct(f) { return Math.round(f * 100) + "%"; }
function signed(n, unit) { return (n > 0 ? "+" : "") + n + unit; }
function db(f) { return f <= 0.001 ? "-inf dB" : (20 * Math.log(f) / Math.LN10).toFixed(1) + " dB"; }

// how a value reads, in the engine's own unit, everywhere Pung writes it (push.display)
function vu(s) { var m = /^(-?[\d.]+|-inf|\+-\d+|[+-]?\d+)\s*(.*)$/.exec(s); return m ? { value: m[1], unit: m[2] } : { value: s }; }
function readout(k, raw) {
  var f = parseFloat(raw), m;
  if (isNaN(f)) return null;
  if ((m = /^osc(\d)_(\w+)$/.exec(k))) {
    var i = +m[1];
    if (m[2] === "wave") return { value: WAVES[clamp(Math.round(f), 0, 3)] };
    if (m[2] === "range") return { value: FEET[String(clamp(Math.round(f), -2, 2))] };
    if (m[2] === "detune") { var c = (i < 4 && Math.abs(f) <= 0.001) ? 0 : Math.round((f - 0.5) * 100); return { value: (c > 0 ? "+" : "") + c, unit: "ct" }; }
    return { value: String(Math.round(f * 100)), unit: "%" };
  }
  switch (k) {
  case "cutoff": return vu(fmtHz(cutHz(f)));
  case "attack": case "decay": case "release": case "f_attack": case "f_decay": case "f_release": return vu(fmtS(stageS(f)));
  case "octave_transpose": return { value: (f > 0 ? "+" : "") + Math.round(f) };
  case "lfo_rate": return vu(fmtHz(lfoHz(f)));
  case "bend_range": return { value: "+-" + Math.round(f * 12), unit: "st" };
  case "glide": return f < 0.001 ? { value: "Off" } : vu(fmtS(f * f * 2));
  case "volume": return f <= 0.001 ? { value: "-inf", unit: "dB" } : { value: (20 * Math.log(f) / Math.LN10).toFixed(1), unit: "dB" };
  case "preset": return { value: String(Math.round(f) + 1) };
  case "resonance": case "contour": case "key_follow": case "sustain": case "f_sustain": case "noise": case "lfo_pitch": case "lfo_filter":
  case "mod_filter": case "mod_pitch": case "vel_sens":
    return { value: String(Math.round(f * 100)), unit: "%" };
  }
  return null;
}
push.display(function (key, raw) { return readout(key, raw) || undefined; });
function shown(v, k) {
  if (!known(v, k)) return "--";
  var r = readout(k, String(v[k].value));
  return r ? r.value + (r.unit ? " " + r.unit : "") : txt(v, k);
}
var NAMES = { cutoff: "CUTOFF", resonance: "EMPHASIS", contour: "CONTOUR AMT", key_follow: "KEYBOARD", attack: "ATTACK", decay: "DECAY",
  sustain: "SUSTAIN", release: "RELEASE", octave_transpose: "OCTAVE", glide: "GLIDE", volume: "VOLUME",
  f_attack: "ATTACK", f_decay: "DECAY", f_sustain: "SUSTAIN", f_release: "RELEASE" };

// Pung's envelope dots run on the engine's own times
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    if (!/^(f_)?(attack|decay|release)$/.test(s.key || "")) return null;
    var p = parseFloat(s.raw);
    return isNaN(p) ? null : stageS(clamp(p, 0, 1));
  });
});

// ---- waves ------------------------------------------------------------------------------------
function osc(w, ph) {
  var p = ph - Math.floor(ph);
  switch (w) {
  case 0: p = p + 0.25 - Math.floor(p + 0.25); return 4 * (Math.abs(p - 0.5) - 0.25);
  case 1: return 2 * p - 1;
  case 2: return p < 0.5 ? 1 : -1;
  }
  return p < 0.2 ? 1 : -1;
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (CACHED > 96) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function wavePts(x, y, w, h, fn, step) {
  var pts = [], mid = y + h / 2, a = h / 2 - 1, prev = null;
  for (var px = 0; px <= w; px += step || 2) {
    var s = fn(px / w), yy = mid - s * a;
    if (prev !== null && Math.abs(yy - prev) > a * 0.6) pts.push(x + px, prev);
    pts.push(x + px, yy);
    prev = yy;
  }
  return pts;
}

// ---- the panel's parts ------------------------------------------------------------------------
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
function cheeks(g, h) {
  for (var s = 0; s < 2; s++) {
    var x = s ? 948 : 0;
    g.fill(x, 0, 12, h, WOOD);
    g.fill(x + (s ? 0 : 11), 0, 1, h, WOOD_DK);
    for (var i = 0; i < 5; i++) g.fill(x + 2 + i * 2 + (i % 2), 0, 1, h, i % 2 ? WOOD_GRAIN : WOOD_HI);
  }
}
// a black knob with its silver rim and the scale printed round it
function knobCap(g, x, y, r, ticks) {
  if (ticks) for (var i = 0; i <= 10; i++) {
    var a = A0 + i / 10 * SWEEP;
    g.dot(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4), i % 5 ? 0.8 : 1.3, PRINT_DIM);
  }
  g.dot(x, y, r, CAP_RIM); g.dot(x, y, r - 1.5, CAP);
}
function pointer(g, x, y, r, f, c, w) {
  var a = A0 + f * SWEEP;
  g.line(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25, x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2), w || 2, c);
}
// a rocker switch: lit or not, in its colour
function rocker(g, x, y, on, c, off) {
  g.fill(x, y, 9, 13, "#000000");
  g.fill(x + 1, on ? y + 1 : y + 6, 7, 6, on ? c : off);
  g.fill(x + 1, on ? y + 7 : y + 1, 7, 5, off);
}

// ---- PANEL ----------------------------------------------------------------------------------
var SEC = [ // the sections, as the panel titles them along its foot
  ["CONTROLLERS", 14, 118], ["OSCILLATOR BANK", 134, 236], ["MIXER", 372, 96], ["MODIFIERS", 470, 362], ["OUTPUT", 834, 112]];
var ROW_Y = [14, 31, 48, 65], NOISE_Y = 82;
function panelGround(g, kn, compact) {
  g.fill(0, 0, 960, 160, PANEL);
  cheeks(g, 160);
  // the sections' feet: a rule, the title under it
  for (var i = 0; i < SEC.length; i++) {
    var s = SEC[i];
    g.fill(s[1] + 2, 89, s[2] - 4, 1, RULE);
    g.text(s[1] + s[2] / 2, 99, s[0], PRINT, 0);
    if (i) g.fill(s[1] - 2, 6, 1, 92, PRINT_FAINT);
  }
  // controllers
  g.value(20, 19, "RaffoSynth", PRINT, -1);
  knobCap(g, 32, 60, 9, true);
  g.text(32, 82, "GLIDE", PRINT_DIM, 0);
  g.text(92, 47, "LFO", PRINT_DIM, 0);
  // the oscillator bank: a row an oscillator
  for (var o = 0; o < 4; o++) {
    var y = ROW_Y[o];
    g.text(140, y + 4, String(o + 1), PRINT_DIM, -1);
    g.fill(152, y - 7, 30, 14, WIN);
    g.fill(190, y - 7, 64, 14, WIN);
  }
  g.text(140, NOISE_Y + 4, "", PRINT_DIM, -1);
  g.text(252, 10, "", PRINT_DIM, 1);
  // the mixer: a knob and a rocker a source
  for (o = 0; o < 5; o++) {
    var my = o < 4 ? ROW_Y[o] : NOISE_Y - 2;
    knobCap(g, 392, my, 6.5, false);
    g.text(424, my + 4, o < 4 ? "OSC " + (o + 1) : "NOISE", PRINT_DIM, -1);
  }
  // modifiers
  g.text(478, 12, "FILTER", PRINT_DIM, -1);
  g.text(604, 12, "FILTER CONTOUR", PRINT_DIM, -1);
  g.text(720, 12, "LOUDNESS CONTOUR", PRINT_DIM, -1);
  // output
  knobCap(g, 862, 42, 11, true);
  g.text(862, 66, "VOLUME", PRINT_DIM, 0);
  g.text(912, 66, "OCTAVE", PRINT_DIM, 0);
  // the encoder row, under a rule: the panel's black knobs
  g.fill(12, 103, 936, 1, RULE);
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, 111, 1, 42, PRINT_FAINT);
    if (!kn[c]) continue;
    if (compact) knobCap(g, c * 120 + 28, 128, 9, true); else knobCap(g, c * 120 + 34, 139, 13, true);
  }
}

function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  var compact = !!v.$segmode; // the bottom 18 pixels are Pung's: the segments' names
  g.layer("moog|" + kn.join(",") + "|" + compact, function () { panelGround(g, kn, compact); });
  segLit(g, v);
  // controllers: the sound, glide, the LFO
  var nm = txt(v, "preset_name");
  g.text(20, 32, (known(v, "preset") ? ("0" + (Math.round(num(v, "preset", 0)) + 1)).slice(-2) + "  " : "") + nm.toUpperCase(), ORANGE, -1, 110);
  if (known(v, "glide")) pointer(g, 32, 60, 9, fr(v, "glide", 0), t === "glide" ? "slot" : PRINT, 2);
  g.lfo(58, 48, 70, 32, { shape: "Sine", rate: "lfo_rate", color: CURVE });
  g.text(92, 86, fmtHz(lfoHz(fr(v, "lfo_rate", 0.3))).toUpperCase(), PRINT, 0);
  // the oscillator bank
  for (var o = 0; o < 4; o++) {
    var i = o + 1, y = ROW_Y[o], on = fr(v, "osc" + i + "_volume", 0) > 0.001, w = wave(v, i), rg = range(v, i);
    var hot = t.indexOf("osc" + i + "_") === 0, ink = hot ? "slot" : (on ? PRINT : PRINT_DIM);
    g.text(167, y + 4, known(v, "osc" + i + "_range") ? FEET[String(rg)] : "--", hot && t === "osc" + i + "_range" ? "slot" : (on ? ORANGE : PRINT_DIM), 0);
    // the wave's shape, two cycles (the range is in the window beside it)
    g.poly(cached("row|" + o + "|" + w, function () { return wavePts(194, y - 5, 56, 10, function (q) { return osc(w, q * 2); }, 1); }), 1.5, ink);
    var dc = Math.round(detuneCents(v, i));
    if (i > 1) g.text(366, y + 4, known(v, "osc" + i + "_detune") ? signed(dc, " CT") : "--", t === "osc" + i + "_detune" ? "slot" : (on ? PRINT : PRINT_DIM), 1);
    g.text(262, y + 4, WAVE_SHORT[w], ink, -1);
  }
  g.text(140, NOISE_Y + 4, "NOISE", fr(v, "noise", 0) > 0.001 ? PRINT : PRINT_DIM, -1);
  // the mixer
  var mk = ["osc1_volume", "osc2_volume", "osc3_volume", "osc4_volume", "noise"];
  for (o = 0; o < 5; o++) {
    var my = o < 4 ? ROW_Y[o] : NOISE_Y - 2, f = fr(v, mk[o], 0), mh = t === mk[o];
    if (known(v, mk[o])) pointer(g, 392, my, 6.5, f, mh ? "slot" : PRINT, 1.5);
    rocker(g, 404, my - 6, f > 0.001, BLUE, BLUE_OFF);
    if (mh) g.arc(392, my, 9, 0, Math.PI * 2, 1.5, "slot");
  }
  // modifiers: the ladder, how far the contour opens it; both contours
  var cut = fr(v, "cutoff", 0.7), amt = fr(v, "contour", 0);
  g.filter(472, 14, 128, 72, { cutoff: "cutoff", resonance: "resonance", type: "LP 24 dB", color: CURVE });
  if (amt > 0.005) {
    var x0 = 478 + 116 * cut, x1 = 478 + 116 * Math.min(1, cut + amt);
    g.fill(x0, 84, Math.max(2, x1 - x0), 2, t === "contour" ? "slot" : ORANGE);
  }
  g.envelope(600, 14, 116, 72, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", color: CURVE });
  g.envelope(716, 14, 116, 72, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", color: CURVE });
  // output
  if (known(v, "volume")) pointer(g, 862, 42, 11, fr(v, "volume", 0.7), t === "volume" ? "slot" : PRINT, 2);
  var oc = Math.round(num(v, "octave_transpose", 0));
  g.value(912, 47, known(v, "octave_transpose") ? signed(oc, "") : "--", t === "octave_transpose" ? "slot" : ORANGE, 0);
  g.text(862, 82, known(v, "volume") ? db(fr(v, "volume", 0.7)).toUpperCase() : "--", PRINT, 0);
  row(g, v);
}
// the encoder row: the panel's black knob, its legend over it, the value beside it
function row(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var c = 0; c < 8; c++) {
    var k = kn[c];
    if (!k || !v[k]) continue;
    var cmp = !!v.$segmode, x0 = c * 120, hot = k === t, cx = x0 + (cmp ? 28 : 34), cy = cmp ? 128 : 139, r = cmp ? 9 : 13;
    g.text(x0 + 60, cmp ? 114 : 118, NAMES[k] || String(v[k].name).toUpperCase(), hot ? "slot" : PRINT, 0, 104);
    if (hot) g.arc(cx, cy, r + 6, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) pointer(g, cx, cy, r - 1.5, fr(v, k, 0), hot ? "slot" : PRINT, 3);
    // the last column ends at the wooden cheek
    g.value(x0 + (c === 7 ? 78 : 84), cmp ? 135 : 146, shown(v, k), hot ? "slot" : PRINT, 0, c === 7 ? 56 : 64);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(940, 12, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, PRINT_DIM, 1);
}

// ---- segments: the panel's sections under the hands ---------------------------------------------
// Pung draws the bar above the active one; its title along the foot (or its legend) lit, as the panel names it
var SEGS = [
  { id: "ctl", label: "Controllers", rect: [14, 0, 118, 100], keys: ["glide", "lfo_rate", "lfo_pitch", "mod_pitch", "lfo_filter", "mod_filter", "bend_range", "vel_sens"] },
  { id: "osc12", label: "Osc 1 + 2", rect: [134, 4, 236, 37], keys: ["osc1_range", "osc1_wave", "osc2_range", "osc2_detune", "osc2_wave"] },
  { id: "osc34", label: "Osc 3 + 4", rect: [134, 41, 236, 34], keys: ["osc3_range", "osc3_detune", "osc3_wave", "osc4_range", "osc4_detune", "osc4_wave"] },
  { id: "mixer", label: "Mixer", rect: [372, 0, 96, 100], keys: ["osc1_volume", "osc2_volume", "osc3_volume", "osc4_volume", "noise"] },
  { id: "filter", label: "Filter", rect: [470, 0, 246, 100], keys: ["cutoff", "resonance", "contour", "key_follow", "f_attack", "f_decay", "f_sustain", "f_release"] },
  { id: "loud", label: "Loudness", rect: [716, 0, 116, 100], keys: ["attack", "decay", "sustain", "release"] },
  { id: "out", label: "Output", rect: [834, 0, 112, 100], keys: ["volume", "octave_transpose", "preset"] }];
var SEG_LIT = { // the segment's title along the foot, or legends of its own
  ctl: [[73, 99, "CONTROLLERS", 0]], osc12: [[140, 18, "1", -1], [140, 35, "2", -1]],
  osc34: [[140, 52, "3", -1], [140, 69, "4", -1]], mixer: [[420, 99, "MIXER", 0]],
  filter: [[478, 12, "FILTER", -1], [604, 12, "FILTER CONTOUR", -1]], loud: [[720, 12, "LOUDNESS CONTOUR", -1]],
  out: [[890, 99, "OUTPUT", 0]] };
function segLit(g, v) {
  if (v.$segmode !== "segment" || !SEG_LIT[v.$segment]) return;
  var L = SEG_LIT[v.$segment];
  for (var i = 0; i < L.length; i++) g.text(L[i][0], L[i][1], L[i][2], "slot", L[i][3]);
}
Object.assign(NAMES, { lfo_rate: "LFO RATE", lfo_pitch: "LFO > PITCH", lfo_filter: "LFO > FILTER", mod_pitch: "WHEEL > PITCH",
  mod_filter: "MOD > FILTER", bend_range: "BEND", vel_sens: "VELOCITY", noise: "NOISE", preset: "PRESET",
  f_attack: "F ATTACK", f_decay: "F DECAY", f_sustain: "F SUSTAIN", f_release: "F RELEASE" });
(function () { for (var i = 1; i <= 4; i++) { NAMES["osc" + i + "_range"] = "OSC " + i + " RANGE"; NAMES["osc" + i + "_wave"] = "OSC " + i + " WAVE";
  NAMES["osc" + i + "_detune"] = "OSC " + i + " TUNE"; NAMES["osc" + i + "_volume"] = "OSC " + i; } })();

push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true, segments: SEGS,
  pages: [{ label: "Panel", keys: ["cutoff", "resonance", "contour", "attack", "decay", "sustain", "release", "octave_transpose"] }],
  extra_keys: ["preset", "preset_name", "glide", "lfo_rate", "lfo_pitch", "lfo_filter", "mod_pitch", "mod_filter", "bend_range", "vel_sens", "key_follow", "osc1_wave", "osc1_range", "osc1_volume", "osc2_wave", "osc2_range", "osc2_volume",
    "osc2_detune", "osc3_wave", "osc3_range", "osc3_volume", "osc3_detune", "osc4_wave", "osc4_range", "osc4_volume", "osc4_detune",
    "noise", "f_attack", "f_decay", "f_sustain", "f_release", "volume"],
  screen: function (g, v) { panel(g, v); }
});

// ---- band screens: the wood at the left edge ---------------------------------------------------
function edge(g) { g.fill(0, 0, 4, g.h, WOOD); g.fill(4, 0, 1, g.h, WOOD_DK); }
function head(g, x, y, s, hot, align) { g.text(x, y, s, hot ? "slot" : "dim", align === undefined ? -1 : align); }

// ---- OSCILLATORS: the bank as it sounds ------------------------------------------------------------
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Osc 1 + 2", keys: ["osc1_range", "osc1_wave", "osc2_range", "osc2_detune", "osc2_wave"] },
    { label: "Osc 3 + 4", keys: ["osc3_range", "osc3_detune", "osc3_wave", "osc4_range", "osc4_detune", "osc4_wave"] }
  ],
  extra_keys: ["osc1_volume", "osc2_volume", "osc3_volume", "osc4_volume", "noise"],
  screen: function (g, v) {
    var LX = 104, LW = 420, lh = 20, MX = 590, MW = 354;
    g.layer("osc-ground", function () {
      edge(g);
      for (var q = 0; q < 4; q++) g.fill(LX, 2 + q * 21 + lh / 2, LW, 1, "faint");
      g.line(MX - 12, 6, MX - 12, 82, 1, "line");
      head(g, MX, 12, "MIXER OUT", false);
      g.fill(MX, 48, MW, 1, "faint");
    });
    var t = v.$touched || "";
    // the window: two cycles of the lowest oscillator that sounds
    var low = 2, n = 0;
    for (var i = 1; i <= 4; i++) if (fr(v, "osc" + i + "_volume", 0) > 0.001) { low = Math.min(low, range(v, i)); n++; }
    if (!n) low = range(v, 1);
    for (i = 1; i <= 4; i++) {
      var y = 2 + (i - 1) * 21, on = fr(v, "osc" + i + "_volume", 0) > 0.001, hot = t.indexOf("osc" + i + "_") === 0;
      var w = wave(v, i), rg = range(v, i), cyc = 2 * Math.pow(2, rg - low), dc = Math.round(detuneCents(v, i));
      g.text(12, y + 14, String(i), hot ? "slot" : (on ? "fg" : "faint"), -1);
      g.text(28, y + 14, FEET[String(rg)], hot && t === "osc" + i + "_range" ? "slot" : (on ? ORANGE : "faint"), -1);
      g.text(LX - 8, y + 14, i > 1 ? signed(dc, " CT") : "", hot && t === "osc" + i + "_detune" ? "slot" : (on ? "dim" : "faint"), 1);
      g.poly(cached("bank|" + i + "|" + w + "|" + cyc, function () { return wavePts(LX, y + 1, LW, lh - 2, function (q) { return osc(w, q * cyc); }, 4); }),
        on ? 1.5 : 1, hot ? "slot" : (on ? CURVE : "line"));
      g.text(LX + LW + 6, y + 14, on ? WAVE_SHORT[w] : "OFF", hot && t === "osc" + i + "_wave" ? "slot" : (on ? "fg" : "faint"), -1);
    }
    // what the mixer makes of them
    var lv = [], sig = [];
    for (i = 1; i <= 4; i++) { lv.push(fr(v, "osc" + i + "_volume", 0)); sig.push(wave(v, i) + ":" + range(v, i) + ":" + lv[i - 1].toFixed(2)); }
    var tot = lv[0] + lv[1] + lv[2] + lv[3];
    g.text(MX + MW, 12, n ? n + (n > 1 ? " OSCILLATORS" : " OSCILLATOR") + (fr(v, "noise", 0) > 0.001 ? " + NOISE" : "") : "SILENT", "dim", 1);
    if (tot > 0.001) {
      var ww = [wave(v, 1), wave(v, 2), wave(v, 3), wave(v, 4)], rr = [range(v, 1), range(v, 2), range(v, 3), range(v, 4)];
      var mul = [2 * Math.pow(2, rr[0] - low), 2 * Math.pow(2, rr[1] - low), 2 * Math.pow(2, rr[2] - low), 2 * Math.pow(2, rr[3] - low)];
      g.poly(cached("mix|" + sig.join(",") + "|" + low, function () {
        return wavePts(MX, 18, MW, 60, function (q) {
          var s = 0;
          for (var j = 0; j < 4; j++) if (lv[j] > 0.001) s += lv[j] * osc(ww[j], q * mul[j]);
          return s / tot;
        }, 4);
      }), 2, CURVE);
    }
  }
});

// ---- MIXER: Pung's mixer over the six levels ---------------------------------------------------------
push.compartment({
  id: "mixer", label: "Mixer",
  pages: [{ label: "Mixer", keys: ["osc1_volume", "osc2_volume", "osc3_volume", "osc4_volume", "noise", "volume"] }]
});

// ---- FILTER: the ladder, its contour and the keys ---------------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: ["cutoff", "resonance", "contour", "key_follow", "f_attack", "f_decay", "f_sustain", "f_release"] }],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "", half = 476;
    var cut = fr(v, "cutoff", 0.7), amt = fr(v, "contour", 0), kf = fr(v, "key_follow", 0);
    head(g, 12, 12, "LADDER  LP 24 DB", t === "cutoff" || t === "resonance");
    g.text(half - 14, 12, fmtHz(cutHz(cut)).toUpperCase() + "  EMPHASIS " + pct(fr(v, "resonance", 0)), "fg", 1);
    g.filter(6, 16, half - 18, 66, { cutoff: "cutoff", resonance: "resonance", type: "LP 24 dB", color: CURVE });
    // the contour's reach: from the cutoff up by its amount, at the top of the envelope
    var gx0 = 12, gw = half - 30;
    if (amt > 0.005) {
      var x0 = gx0 + gw * cut, x1 = gx0 + gw * Math.min(1, cut + amt), hot = t === "contour";
      g.fill(x0, 78, Math.max(2, x1 - x0), 2, hot ? "slot" : ORANGE);
      g.fill(x1 - 1, 74, 2, 6, hot ? "slot" : ORANGE);
      var lab = "CONTOUR TO " + fmtHz(cutHz(Math.min(1, cut + amt))).toUpperCase();
      var lx = x1 + 6 + g.measure(lab) > half - 16 ? x0 - 6 - g.measure(lab) : x1 + 6;
      g.fill(lx - 2, 73, g.measure(lab) + 4, 10, "#000000");
      g.text(lx, 82, lab, hot ? "slot" : ORANGE, -1);
    }
    // the keys: an octave up the keyboard opens it by
    var perOct = kf * 12 / 127;
    g.text(16, 30, kf < 0.005 ? "KEYBOARD: NONE" : "KEYBOARD: " + (perOct * 3).toFixed(2) + " OCT AN OCTAVE", t === "key_follow" ? "slot" : "dim", -1);
    g.line(half, 6, half, 82, 1, "line");
    head(g, half + 12, 12, "FILTER CONTOUR", t.indexOf("f_") === 0);
    g.envelope(half + 6, 16, half - 14, 68, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", labels: true, color: CURVE });
  }
});

// ---- LOUDNESS CONTOUR: Pung's envelope ---------------------------------------------------------------
push.compartment({
  id: "loudness", label: "Loudness",
  pages: [{ label: "Loudness Contour", keys: ["attack", "decay", "sustain", "release"] }]
});

// ---- MODULATION: the LFO, and the wheel between it and the pitch -----------------------------------------
push.compartment({
  id: "mod", label: "Modulation",
  pages: [{ label: "Modulation", keys: ["lfo_rate", "lfo_pitch", "mod_pitch", "lfo_filter", "mod_filter", "vel_sens"] }],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "";
    var r = fr(v, "lfo_rate", 0.3), lp = fr(v, "lfo_pitch", 0), mp = fr(v, "mod_pitch", 0.5), lf = fr(v, "lfo_filter", 0), mf = fr(v, "mod_filter", 0.5);
    head(g, 12, 12, "LFO  SINE", t === "lfo_rate");
    g.text(226, 12, fmtHz(lfoHz(r)).toUpperCase(), t === "lfo_rate" ? "slot" : "fg", 1);
    g.lfo(6, 16, 226, 68, { shape: "Sine", rate: "lfo_rate", color: CURVE });
    // the routes: a line as strong as how far it moves
    var X = 250, Y1 = 24, Y2 = 56;
    g.line(X - 8, 6, X - 8, 82, 1, "line");
    function route(y, label, amount, via, gated, hot, say) {
      var on = amount > 0.002, c = hot ? "slot" : (on ? "mod" : "line");
      g.dot(X + 6, y, 3, on ? CURVE : "line");
      var vx = X + 150;
      g.line(X + 10, y, vx - 34, y, on ? 1 + amount * 4 : 1, c);
      g.fill(vx - 34, y - 9, 68, 18, "#000000");
      g.line(vx - 34, y - 9, vx + 34, y - 9, 1, gated ? ORANGE : "line"); g.line(vx - 34, y + 9, vx + 34, y + 9, 1, gated ? ORANGE : "line");
      g.line(vx - 34, y - 9, vx - 34, y + 9, 1, gated ? ORANGE : "line"); g.line(vx + 34, y - 9, vx + 34, y + 9, 1, gated ? ORANGE : "line");
      g.text(vx, y + 4, via, gated ? ORANGE : "dim", 0);
      g.line(vx + 34, y, X + 318, y, on ? 1 + amount * 4 : 1, c);
      g.text(X + 326, y + 4, label, hot ? "slot" : (on ? "fg" : "faint"), -1);
      g.text(X + 326, y + 15, say, hot ? "slot" : (on ? "dim" : "faint"), -1, 360);
    }
    var semi = 2 * lp * mp, filt = 0.3 * lf * mf * 3;
    route(Y1, "PITCH", lp * mp, "WHEEL", true, t === "lfo_pitch" || t === "mod_pitch",
      semi < 0.005 ? "NO VIBRATO" : "WHEEL UP: +-" + semi.toFixed(2) + " SEMITONES");
    route(Y2, "FILTER", lf * mf, "ALWAYS", false, t === "lfo_filter" || t === "mod_filter",
      filt < 0.005 ? "NO SWEEP" : "+-" + filt.toFixed(2) + " DECADES OF CUTOFF");
    g.text(X + 6, 84, "VELOCITY SETS " + pct(fr(v, "vel_sens", 0.5)) + " OF THE LOUDNESS", t === "vel_sens" ? "slot" : "dim", -1);
  }
});

// ---- PERFORMANCE: Pung's own page -----------------------------------------------------------------
push.compartment({
  id: "perf", label: "Performance",
  pages: [{ label: "Performance", keys: ["preset", "glide", "bend_range", "octave_transpose", "volume"] }],
  extra_keys: ["preset_name"]
});
