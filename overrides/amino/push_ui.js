// Amino on the Push: an 8-bit wavetable synth, up to four layers.
// An overlay shipped with Pung (Amino ships no push_ui.js).
//
// Amino is built of layers, each two stepped 8-bit wavetable oscillators,
// dirt noise, drive, a gritty filter, four envelopes, two LFOs and an eight
// slot matrix, into two effect slots. Its own pages edit one layer at a time
// (Edit Layer), each layer in its own colour (teal, amber, violet, coral, as
// Amino's own Remote UI paints them). The screens keep that:
//
//   PANEL       the edited layer's two oscillators, pixel for pixel: the wave
//               the engine plays (wave_view: its table, 64 points of 8 bits),
//               each sample a bar, its place among the table's 64 waves; dirt,
//               drive and the filter; the amp; the four layers at a glance,
//               each with its table, its keys and the voices it is playing
//   OSC 1 / 2   the same waves large, both at once, the one being edited lit;
//               the cross modulation from Osc 2 into Osc 1
//   WAVE ENV    the wave envelope and how far it sweeps each position
//   MIXER       what goes into the filter, the drive's own transfer curve
//   FILTER/AMP/AUX  Pung's filter and envelopes (exponential, as Amino runs
//               them) with what they reach
//   LFO / MOD   each LFO; the eight matrix slots at once, the two on the
//               encoders lit
//   FX          each slot's six knobs named and read as the effect means
//               them (Amino's own card table), the chain and the routing
//   LAYERS      the four layers side by side: on, level, route, key range
//
// Laws from Amino's DSP (util.h, voice.c): envelope stages take 20 x^3 s, the
// attack an exponential to 1.3 cut at 1, decay and release exponentials that
// reach 1 % in that time; LFOs 0.01 * 5000^x Hz; glide 5 x^2 s; the cutoff a
// note number (Hz = 440 * 2^((n - 69) / 12)), the filter envelope +-72 st.

// ---- values -----------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function idx(v, k, n) { return Math.max(0, Math.min(n - 1, Math.round(num(v, k, 0)))); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function rawStr(v, k) { return v[k] ? String(v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function c01(x) { return clamp(x, 0, 1); }
// Where the sound has a control now (v[k].now: the module's live_mod, the edit
// layer's newest voice while it sounds), 0..1 of its range; null when nothing
// moves it. The knob's own mark stays where the knob is; the sound's place
// goes beside it in the modulation colour.
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? c01(v[k].now) : null; }
function moved(v, k) { var n = nowOf(v, k); return n !== null && Math.abs(n - v[k].frac) > 0.004; }
// the value where the sound has it, in the key's own units (the knob's while nothing moves it)
function numNow(v, k, d) { return moved(v, k) ? +v[k].min + nowOf(v, k) * (+v[k].max - +v[k].min) : num(v, k, d); }
// on a horizontal track (x, y, w): a line from the knob's place to the sound's, a dot
function hMark(g, v, k, x, y, w) {
  if (!moved(v, k)) return;
  var f = v[k].frac, n = nowOf(v, k);
  g.fill(x + w * Math.min(f, n), y, Math.max(1, w * Math.abs(n - f)), 1, MOD_DK);
  g.dot(x + w * n, y + 0.5, 3, MOD);
}
// beside a fader rising from y + h: the sound's level, a tick
function vMark(g, v, k, x, y, h) { if (moved(v, k)) g.fill(x, Math.round(y + h * (1 - nowOf(v, k))) - 1, 5, 3, MOD); }
// on a table's 64 places: the one the oscillator plays now, when the knob's is another
function posMark(g, v, k, x, y, cw) {
  if (!moved(v, k)) return;
  var at = Math.round(numNow(v, k, 0));
  if (at !== idx(v, k, 64)) g.fill(x + at * cw - 1, y - 2, cw + 1, 9, MOD);
}
// the filter where the sound has its cutoff (the module's note mapped onto Pung's
// axis: at), the knob's place marked at the foot, the way between in the modulation colour
function liveFilter(g, v, x, y, w, h, ft, lc) {
  var c = num(v, "cutoff", 100), cn = numNow(v, "cutoff", c);
  g.filter(x, y, w, h, { cutoff: "cutoff", resonance: moved(v, "res") ? nowOf(v, "res") : "res", type: FNAMES[ft], at: cutAt(cn), color: lc });
  if (!moved(v, "cutoff")) return;
  var xs = x + w * cutAt(c), xn = x + w * cutAt(cn), yb = y + h - 3;
  g.fill(Math.round(xs), yb - 5, 2, 7, TEXT);
  g.fill(Math.min(xs, xn), yb, Math.abs(xn - xs), 2, MOD_DK);
  g.dot(xn, yb + 1, 3, MOD);
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (key in CACHE) return CACHE[key];
  if (++CACHED > 64) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
function hex2(n) { var s = Math.round(clamp(n, 0, 255)).toString(16); return s.length < 2 ? "0" + s : s; }
function mix(a, b, t) {
  var pa = [parseInt(a.substr(1, 2), 16), parseInt(a.substr(3, 2), 16), parseInt(a.substr(5, 2), 16)];
  var pb = [parseInt(b.substr(1, 2), 16), parseInt(b.substr(3, 2), 16), parseInt(b.substr(5, 2), 16)];
  return "#" + hex2(pa[0] + (pb[0] - pa[0]) * t) + hex2(pa[1] + (pb[1] - pa[1]) * t) + hex2(pa[2] + (pb[2] - pa[2]) * t);
}

// ---- Amino's colours (its Remote UI's tokens) -----------------------------------------------------
var BG = "#0b0e11", PANEL = "#12171c", PANEL2 = "#181f26", RAISED = "#1e262e", LINE = "#29323b", LINE2 = "#36414b";
var TEXT = "#e6ecef", DIM = "#8d9ba5", FAINT = "#5d6a74", GLOBAL = "#9fc3ff";
var LC = ["#5fe0bf", "#f2b85c", "#a98bff", "#ff7d6b"];
var LC_DK = LC.map(function (c) { return mix(BG, c, 0.36); }), LC_MID = LC.map(function (c) { return mix(BG, c, 0.62); });
function editLayer(v) { return clamp(Math.round(num(v, "edit_layer", 1)) - 1, 0, 3); }

// ---- the engine's laws ------------------------------------------------------------------------------
var TABLES = ["Basic", "Pulse", "Resonant", "Resonant 2", "Sync", "Formant A", "Formant B", "Harmonic", "Odd", "Bell", "Organ", "Digital", "Noise",
  "PWM Saw", "Fold", "Steps", "Strings", "Brass", "Bass Spectra", "Choir", "Glass", "Chaos", "Comb", "PhaseDist", "Fractal", "Upper", "Clav", "Breath",
  "SqSync", "Metal", "Stack", "Granite", "Cello", "Violin", "Voice", "EPiano", "Clavinet", "E-Organ", "FM", "Chip", "VGame", "Sax", "Flute", "Overtone",
  "Crushed", "Granular", "Upright", "Piano", "Even", "Partials", "Feedback", "Window", "Rave", "Octaves", "Logic", "Reed", "Pluck", "Sweep", "Chord",
  "Vosim", "Scanned", "Prime", "SineSync", "Mallet", "Mixer", "Sub", "Notch", "Drive", "E-Bass", "E-Guitar", "Distorted", "Theremin", "Raw", "Drawn"];
var CLASSIC = { 61: "TRI", 62: "SQR", 63: "SAW" };
var FTYPES = ["LP24", "LP12", "LADDER", "HP24", "HP12", "BP12", "OFF"], FNAMES = ["LP 24 dB", "LP 12 dB", "Ladder 24 dB", "HP 24 dB", "HP 12 dB", "BP", "Off"];
var DIRT = ["STATIC", "CRACKLE", "GEIGER", "CLICK", "BURST", "RING"], DRIVE = ["OFF", "TRANS", "TUBE", "DIODE", "FOLD"];
var XMOD = ["OFF", "PM", "AM", "SYNC"], POLY = ["POLY", "MONO", "LEGATO"], LMODE = ["STACK", "ROUND ROBIN", "RANDOM RR", "SPLIT", "CHANNEL"];
var PANM = ["FIXED", "RANDOM", "ALTERNATE", "SPREAD", "LFO 1", "LFO 2"], ROUTE = ["DRY", "FX 1", "FX 2"];
var LFO_SHAPES = ["Sine", "Tri", "Pulse", "Saw Down", "Saw Up", "S&H", "S&H"], LFO_NAMES = ["SINE", "TRI", "PULSE", "SAW DN", "SAW UP", "RAND", "S&H"];
var LFO_PHASE = ["FREE", "VOICE", "GLOBAL"];
var DIVS = ["1/32T", "1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2", "1 BAR", "2 BARS", "4 BARS", "8 BARS", "16 BARS"];
var SOURCES = ["Off", "Wave Env", "Filter Env", "Amp Env", "LFO1", "LFO2", "LFO1xMW", "LFO2xMW", "Velocity", "Release Vel", "Key", "Poly AT", "Chan AT",
  "ModWheel", "Breath", "Foot", "Expression", "Pitch Bend", "Timbre", "Sustain", "Random", "Random Bi", "Voice #", "Layer Alt", "Constant", "Flavour", "Aux Env"];
var TARGETS = ["Off", "Pitch", "Osc1 Pitch", "Osc2 Pitch", "Osc1 Wave", "Osc2 Wave", "Osc1 Level", "Osc2 Level", "Dirt Level", "Cutoff", "Resonance", "Drive",
  "Pan", "Amp Level", "LFO1 Rate", "LFO2 Rate", "LFO1 Depth", "LFO2 Depth", "E1 Decay", "E2 Decay", "E3 Decay", "E1 Attack", "E3 Release", "Glide", "FX Send", "XMod"];
var SRC_SHORT = ["OFF", "WENV", "FENV", "AENV", "LFO1", "LFO2", "L1MW", "L2MW", "VEL", "RVEL", "KEY", "PAT", "CAT", "MW", "BRTH", "FOOT", "EXPR", "BEND", "TIMB",
  "SUST", "RND", "RNDB", "VC#", "LALT", "CST", "FLAV", "XENV"];
var DST_SHORT = ["OFF", "PITCH", "O1P", "O2P", "O1W", "O2W", "O1L", "O2L", "DIRT", "CUT", "RES", "DRV", "PAN", "AMP", "L1R", "L2R", "L1D", "L2D", "E1D", "E2D",
  "E3D", "E1A", "E3R", "GLIDE", "SEND", "XMOD"];
var CATS = { IN: "INIT", BS: "BASS", LD: "LEAD", PD: "PAD", KY: "KEYS", PL: "PLUCK", FX: "EFFECT", DR: "DRONE", ML: "MULTI" };
// Amino's own card table for the effects' six knobs (cards.js CARD_META)
var FX_TYPES = ["Off", "Chorus", "Flanger", "Phaser", "Tremolo", "Drive", "Comp", "EQ", "Delay", "Reverb", "Shimmer", "Trance Gate"];
var FX_META = [null,
  [["Rate", "exp", 0.05, 5, "Hz"], ["Depth", "percent"], ["Delay", "lin", 2, 30, "ms"], ["Feedback", "lin", -90, 90, "%"], ["Spread", "lin", 0, 180, "deg"], ["Mode", "opts", ["Chorus", "Ensemble"]]],
  [["Rate", "exp", 0.02, 10, "Hz"], ["Depth", "percent"], ["Feedback", "lin", -95, 95, "%"], ["Delay", "exp", 0.1, 10, "ms"], ["Spread", "lin", 0, 180, "deg"], ["Sync", "opts", ["Off", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars"]]],
  [["Rate", "exp", 0.02, 10, "Hz"], ["Depth", "percent"], ["Feedback", "lin", -95, 95, "%"], ["Stages", "opts", ["4", "6", "8", "12"]], ["Center", "exp", 100, 4000, "Hz"], ["Spread", "lin", 0, 180, "deg"]],
  [["Rate", "exp", 0.1, 20, "Hz"], ["Depth", "percent"], ["Shape", "opts", ["Sine", "Tri", "Square", "SawUp", "SawDn", "Pump"]], ["Sync", "opts", ["Off", "1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2", "1 bar"]], ["Stereo", "percent"], ["Phase", "lin", 0, 360, "deg"]],
  [["Gain", "lin", 0, 36, "dB"], ["Tone", "lin", -6, 6, "dB"], ["Curve", "opts", ["Soft", "Tube", "Hard", "Fold", "Crush"]], ["Output", "lin", -24, 0, "dB"], ["Low Cut", "exp", 20, 500, "Hz"], ["Crush", "percent"]],
  [["Threshold", "lin", -40, 0, "dB"], ["Ratio", "exp", 1, 20, ":1"], ["Attack", "exp", 0.1, 100, "ms"], ["Release", "exp", 10, 1000, "ms"], ["Makeup", "lin", 0, 24, "dB"], ["Knee", "lin", 0, 12, "dB"]],
  [["Low", "lin", -15, 15, "dB"], ["Mid", "lin", -15, 15, "dB"], ["Mid Freq", "exp", 200, 8000, "Hz"], ["High", "lin", -15, 15, "dB"], ["Mid Q", "exp", 0.3, 4, ""], ["Low Cut", "exp", 20, 300, "Hz"]],
  [["Time", "exp", 1, 2000, "ms"], ["Sync", "opts", ["Off", "1/32", "1/16T", "1/16", "1/16d", "1/8T", "1/8", "1/8d", "1/4T", "1/4", "1/4d", "1/2", "1 bar"]], ["Feedback", "percent"], ["Tone", "lin", -100, 100, "%"], ["Ping-Pong", "percent"], ["Mod", "percent"]],
  [["Size", "percent"], ["Decay", "exp", 0.2, 20, "s"], ["Damping", "percent"], ["Pre-Delay", "lin", 0, 200, "ms"], ["Mod", "percent"], ["Width", "percent"]],
  [["Size", "percent"], ["Decay", "exp", 0.2, 20, "s"], ["Damping", "percent"], ["Shimmer", "percent"], ["Interval", "opts", ["-12 st", "+5 st", "+7 st", "+12 st", "+19 st", "+24 st"]], ["Mod", "percent"]],
  [["Pattern", "opts", ["Classic 8ths", "Offbeat 8ths", "16th Pulse", "32nd Stutter", "Rolling Trance", "Broken Rave", "Long Gate"]], ["Timing", "opts", ["1/8", "1/16", "1/32"]], ["Attack", "lin", 0, 50, "ms"], ["Release", "lin", 0, 50, "ms"], ["Gate Length", "percent"], ["Floor", "percent"]]];
function trimN(n, d) { return n.toFixed(d).replace(/\.0+$|(\.\d*?)0+$/, "$1"); }
function unitTxt(x, u) { // Amino's formatUnit
  if (u === "Hz") return x >= 1000 ? trimN(x / 1000, x >= 10000 ? 1 : 2) + " KHZ" : trimN(x, x >= 100 ? 0 : x >= 10 ? 1 : 2) + " HZ";
  if (u === "s") return x < 1 ? trimN(x * 1000, 0) + " MS" : trimN(x, x >= 10 ? 1 : 2) + " S";
  if (u === "ms") return x >= 1000 ? trimN(x / 1000, 2) + " S" : trimN(x, x >= 100 ? 0 : 1) + " MS";
  if (u === ":1") return trimN(x, x >= 10 ? 0 : 1) + ":1";
  if (u === "deg") return Math.round(x) + " DEG";
  if (u === "dB") return (x > 0.05 ? "+" : "") + trimN(x, 1) + " DB";
  if (u === "%") return Math.round(x) + "%";
  return trimN(x, Math.abs(x) >= 100 ? 0 : 2) + (u ? " " + up(u) : "");
}
function fxReading(row, x) {
  var c = c01(x);
  switch (row[1]) {
  case "opts": var n = row[2].length; return up(row[2][clamp(Math.floor(c * (n - 1) + 0.5), 0, n - 1)]);
  case "lin": return unitTxt(row[2] + (row[3] - row[2]) * c, row[4]);
  case "exp": return unitTxt(row[2] * Math.pow(row[3] / row[2], c), row[4]);
  }
  return Math.round(c * 100) + "%";
}
function fxRow(v, k) { // fx1_p3 -> its row in the table, by the slot's type
  var m = /^fx(\d)_p(\d)$/.exec(k);
  if (!m) return null;
  var rows = FX_META[idx(v, "fx" + m[1] + "_type", 12)];
  return rows ? rows[+m[2] - 1] : null;
}
function envS(x) { return Math.max(0.0005, 20 * x * x * x); }   // am_env_time
function lfoHz(x) { return 0.01 * Math.pow(5000, clamp(x, 0, 1.2)); }
function glideS(x) { return 5 * x * x; }
function noteHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
function cutAt(c) { return c01(Math.log(clamp(noteHz(c), 20, 18000) / 20) / Math.LN10 / 3); } // where it stands on Pung's 20 Hz..20 kHz axis
function noteName(n) { n = Math.round(n); return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 2); }
// the drive's shaper (voice.c shaper), gain 1 + 15 d, made up by 1 / (1 + d)
function shaper(type, x) {
  switch (type) {
  case 1: return Math.tanh(x + 0.2) - 0.19738;
  case 2: return x > 0 ? Math.tanh(x) : Math.tanh(0.6 * x) / 0.6 * 0.8;
  case 3: return clamp(x, -1, 1);
  case 4: return Math.sin(x);
  }
  return x;
}
// the envelopes' curves: the attack an exponential aimed at 1.3 (tau T / 1.466),
// decay and release with tau T / 4.6: exactly Pung's (e^(ct)-1)/(e^c-1)
var ENV_CURVES = { attack: -1.466, decay: -4.6, release: -4.6 };

// ---- how values read (push.display) ---------------------------------------------------------------
function secs(s) { return s < 1 ? [String(Math.round(s * 1000)), "ms"] : [s < 10 ? s.toFixed(2) : s.toFixed(1), "s"]; }
function hz(f) { return f >= 1000 ? [(f / 1000).toFixed(f >= 10000 ? 1 : 2), "kHz"] : [f < 10 ? f.toFixed(2) : f < 100 ? f.toFixed(1) : String(Math.round(f)), "Hz"]; }
function fmt(k, x) {
  var b = k.replace(/^l\d_/, "");
  if (/^e[1-4]_[adr]$/.test(b)) return secs(envS(x));
  if (/^lfo[12]_rate$/.test(b)) return hz(lfoHz(x));
  if (/^lfo[12]_fade$/.test(b)) return x <= 0.0005 ? "None" : secs(envS(x));
  if (b === "glide") return x <= 0.0005 ? "Off" : secs(glideS(x));
  if (b === "cutoff") return hz(clamp(noteHz(x), 20, 18000));
  if (b === "fenv") { var st = x * 72; return [(st > 0.05 ? "+" : "") + st.toFixed(1), "st"]; }
  if (b === "key_lo" || b === "key_hi") return noteName(x);
  if (b === "edit_layer") return "L" + Math.round(x);
  if (b === "res" || b === "vol" || b === "send" || b === "dirt" || b === "drive" || b === "xmod" || b === "amp_vel" || /^e[1-4]_s$/.test(b) || /level$/.test(b)) return [String(Math.round(x * 100)), "%"];
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
  var row = fxRow(v, k);
  if (row) return fxReading(row, num(v, k, 0));
  var f = fmt(k, num(v, k, 0));
  if (f !== null) return typeof f === "string" ? up(f) : f[0] + " " + up(f[1]);
  var d = txt(v, k), u = v[k].unit || "";
  if (v[k].type === "enum") return up(d);
  if (u === "%" && !isNaN(parseFloat(rawStr(v, k)))) { var x = parseFloat(rawStr(v, k)), lo = +v[k].min; return (lo < 0 && x > 0.004 ? "+" : "") + Math.round(x * 100) + "%"; }
  return up(d + (u ? " " + u : ""));
}
var NAMES = {
  osc1_table: "TABLE 1", osc1_wave: "WAVE 1", osc1_semi: "SEMI 1", osc1_fine: "FINE 1", osc1_level: "LEVEL 1", osc1_wenv: "W ENV 1", osc1_vel: "VEL W1", osc1_kbd: "KEY 1",
  osc2_table: "TABLE 2", osc2_wave: "WAVE 2", osc2_semi: "SEMI 2", osc2_fine: "FINE 2", osc2_level: "LEVEL 2", osc2_wenv: "W ENV 2", osc2_vel: "VEL W2", osc2_kbd: "KEY 2",
  osc2_link: "LINK", xmod_type: "X MODE", xmod: "X MOD", cutoff: "CUTOFF", res: "RESO", fenv: "F ENV", ftype: "FILTER", fkbd: "F KEY", fvel: "F VEL",
  dirt_type: "DIRT TYPE", dirt: "DIRT", drv_type: "DRIVE TYPE", drive: "DRIVE", drv_pos: "DRIVE POS", vol: "LAYER VOL", amp_vel: "AMP VEL",
  pan_mode: "PAN MODE", pan: "PAN", e1_a: "W ATTACK", e1_d: "W DECAY", e1_s: "W SUSTAIN", e1_r: "W RELEASE", e2_a: "F ATTACK", e2_d: "F DECAY",
  e2_s: "F SUSTAIN", e2_r: "F RELEASE", e3_a: "ATTACK", e3_d: "DECAY", e3_s: "SUSTAIN", e3_r: "RELEASE", e4_a: "AUX ATK", e4_d: "AUX DEC",
  e4_s: "AUX SUS", e4_r: "AUX REL", flavour: "FLAVOUR", layer_count: "LAYERS", layer_mode: "LAYER MODE", edit_layer: "EDIT LAYER", voices: "VOICES",
  poly: "VOICE MODE", glide: "GLIDE", octave: "OCTAVE", master_vol: "MASTER", fx1_type: "FX 1", fx1_mix: "FX 1 MIX", fx2_type: "FX 2", fx2_mix: "FX 2 MIX",
  fx_chain: "CHAIN", route: "ROUTE", send: "SEND"
};
function nameOf(v, k) {
  var row = fxRow(v, k);
  if (row) return up(row[0]);
  if (NAMES[k]) return NAMES[k];
  var m = /^l(\d)_(.*)$/.exec(k);
  if (m) return "L" + m[1] + " " + up(m[2].replace("key_lo", "low key").replace("key_hi", "high key").replace("_", " "));
  return up((v[k] && v[k].name) || k);
}

// ---- the pixel waves -----------------------------------------------------------------------------
// wave_view: 64 points of the wave the engine plays (its table's two
// samples each, averaged), 0..255 with 128 the zero line
function waveOf(v, k) {
  var s = rawStr(v, k);
  if (!known(v, k) || s.length < 128) return null;
  return cached("w" + s, function () {
    var out = [];
    for (var i = 0; i < 64; i++) { var b = parseInt(s.substr(i * 2, 2), 16); if (isNaN(b)) return null; out.push(b - 128); }
    return out;
  });
}
// each sample a bar from the zero line, the stepped outline over it
function pixelWave(g, x, y, cw, h, w, col, colDk, dim) {
  var mid = Math.round(y + h / 2), half = h / 2 - 1, n = 64;
  g.fill(x, mid, n * cw, 1, LINE2);
  if (!w) { g.text(x + n * cw / 2, mid - 5, "NO WAVE YET", FAINT, 0); return; }
  var pts = [];
  for (var i = 0; i < n; i++) {
    var yy = Math.round(mid - w[i] / 128 * half);
    if (yy < mid) g.fill(x + i * cw, yy, cw - (cw > 2 ? 1 : 0), mid - yy, dim ? RAISED : colDk);
    else if (yy > mid) g.fill(x + i * cw, mid + 1, cw - (cw > 2 ? 1 : 0), yy - mid, dim ? RAISED : colDk);
    pts.push(x + i * cw, yy, x + (i + 1) * cw, yy);
  }
  g.poly(pts, 2, dim ? FAINT : col);
}
// the table's 64 places: the wave played lit, the last three the classic
// triangle, square and saw every table ends with; a sweep's reach shaded
function positions(g, x, y, cw, pos, reach, col, colDk, hot) {
  for (var i = 0; i < 64; i++) {
    var c = i >= 61 ? LINE2 : LINE;
    if (reach && i >= Math.min(pos, reach) && i <= Math.max(pos, reach) && i <= 60) c = colDk;
    g.fill(x + i * cw, y, cw - 1, 5, c);
  }
  if (pos >= 0) g.fill(x + pos * cw - 1, y - 2, cw + 1, 9, hot ? "slot" : col);
}

// ---- the encoder row: a ring of sixteen pixels lit to the value ----------------------------------------
var ROW = 104;
var RING = (function () {
  var p = [];
  for (var i = 0; i < 15; i++) { var a = Math.PI * 0.75 + Math.PI * 1.5 * i / 14; p.push([Math.cos(a), Math.sin(a)]); }
  return p;
})();
function pixelRing(g, cx, cy, r, f, bip, col, ok) {
  var s = r > 10 ? 3 : 2, lit = Math.round(c01(f) * 14), mid = 7;
  for (var i = 0; i < 15; i++) {
    var on = ok && (bip ? (lit >= mid ? i >= mid && i <= lit : i >= lit && i <= mid) : i <= lit && (f > 0.001 || i === 0 && false));
    if (!bip && ok && f <= 0.001) on = false;
    g.fill(Math.round(cx + RING[i][0] * r) - 1, Math.round(cy + RING[i][1] * r) - 1, s, s, on ? col : LINE2);
  }
  if (ok) g.fill(Math.round(cx + RING[lit][0] * (r - 5)) - 1, Math.round(cy + RING[lit][1] * (r - 5)) - 1, s, s, col === "slot" ? "slot" : TEXT);
}
function isBip(v, k) { return v[k] && +v[k].min < 0 && +v[k].max > 0; }
function encoderRow(g, v, lc) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode;
  var cy = seg ? ROW + 19 : ROW + 27, r = seg ? 10 : 13;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x = c * 120, hot = k === t, ok = known(v, k), col = hot ? "slot" : lc;
    pixelRing(g, x + 22, cy, r, ok ? v[k].frac : 0, isBip(v, k), col, ok);
    if (moved(v, k)) { var ri = RING[Math.round(nowOf(v, k) * 14)]; g.dot(x + 22 + ri[0] * (r + 5), cy + ri[1] * (r + 5), 2.5, MOD); }
    g.text(x + 42, seg ? ROW + 14 : ROW + 20, nameOf(v, k), hot ? "slot" : DIM, -1, 76);
    g.value(x + 42, seg ? ROW + 32 : ROW + 42, valueOf(v, k), hot ? "slot" : TEXT, -1, 76);
  }
}

// ---- the front panel ----------------------------------------------------------------------------------
var CARD_Y = 24, CARD_H = 78;
var CARDS = { osc1: [6, 214], osc2: [226, 214], filter: [446, 166], amp: [618, 150], layers: [774, 180] };
function card(g, id, title, col) {
  var c = CARDS[id];
  g.fill(c[0], CARD_Y, c[1], CARD_H, PANEL);
  g.fill(c[0], CARD_Y, c[1], 15, PANEL2);
  if (title) g.text(c[0] + 7, CARD_Y + 12, title, col, -1);
}
function cardFact(g, id, s, col) { var c = CARDS[id]; if (s) g.text(c[0] + c[1] - 6, CARD_Y + 12, s, col || TEXT, 1, c[1] - 60); }
function presetParts(v) {
  var name = txt(v, "preset_name"), m = /^([A-Z]{2})\s+(.*)$/.exec(name);
  return m && CATS[m[1]] ? [CATS[m[1]], up(m[2])] : ["", up(name)];
}
// the layers' state, as rui_live tells it: active voices per layer
function voicesOf(v) {
  var s = rawStr(v, "rui_live"), m = /v=(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(s);
  return m ? [+m[2], +m[3], +m[4], +m[5]] : null;
}
function layerOn(v, i) { return known(v, "l" + (i + 1) + "_on") ? num(v, "l" + (i + 1) + "_on", 0) >= 0.5 : i < Math.round(num(v, "layer_count", 1)); }
function panelGround(g, v, seg, el) {
  var lc = LC[el];
  g.fill(0, 0, 960, 160, BG);
  g.value(8, 16, "AMINO", lc, -1);
  var pp = presetParts(v), x = 74, cw = pp[0] ? g.measure(pp[0]) + 12 : 0, nw = Math.min(400, g.measure(pp[1] || "--", "value"));
  g.fill(x, 2, cw + nw + 16, 16, RAISED);
  if (pp[0]) { g.fill(x, 2, cw, 16, LINE2); g.text(x + 6, 14, pp[0], DIM, -1); }
  g.value(x + cw + 8, 16, pp[1] || "--", TEXT, -1, 400);
  var ps = v.$pages || [], lm = idx(v, "layer_mode", 5), lcn = Math.round(num(v, "layer_count", 1)), px = 952;
  if (!seg && ps.length > 1) { var pt = up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length; g.text(px, 14, pt, DIM, 1); px -= g.measure(pt) + 24; }
  g.text(px, 14, lcn > 1 ? lcn + " LAYERS, " + LMODE[lm] : "ONE LAYER", lcn > 1 ? GLOBAL : FAINT, 1, 260);
  card(g, "osc1", "OSC 1", lc); card(g, "osc2", "OSC 2", lc);
  card(g, "filter", "FILTER", lc); card(g, "amp", "AMP", lc); card(g, "layers", "LAYERS", GLOBAL);
  g.fill(0, ROW, 960, 56, PANEL);
  for (var c = 1; c < 8; c++) g.fill(c * 120, ROW + 8, 1, seg ? 28 : 40, LINE);
}
function oscCard(g, v, n, el, t, lit) {
  var id = "osc" + n, c = CARDS[id], lc = LC[el], p = "osc" + n + "_", lvl = num(v, p + "level", 1), w = waveOf(v, n === 1 ? "wave_view" : "wave_view2");
  var tb = idx(v, p + "table", TABLES.length), pos = idx(v, p + "wave", 64), link = n === 2 && num(v, "osc2_link", 0) >= 0.5;
  var hot = t.indexOf(p) === 0 || (n === 2 && /^xmod|osc2_link/.test(t));
  if (lit) g.text(c[0] + 7, CARD_Y + 12, "OSC " + n, "slot", -1);
  cardFact(g, id, known(v, p + "table") ? up(link ? "LINKED: " + TABLES[idx(v, "osc1_table", TABLES.length)] : TABLES[tb]) : "--", t === p + "table" ? "slot" : TEXT);
  var x0 = c[0] + 11, cw = 3;
  pixelWave(g, x0, CARD_Y + 19, cw, 44, w, hot ? "slot" : lc, LC_DK[el], lvl < 0.004);
  positions(g, x0, CARD_Y + 66, cw, known(v, p + "wave") ? pos : -1, 0, lc, LC_DK[el], t === p + "wave");
  posMark(g, v, p + "wave", x0, CARD_Y + 66, cw);
  var cap = known(v, p + "wave") ? (CLASSIC[pos] ? "CLASSIC " + CLASSIC[pos] : "WAVE " + pos + " OF 64") : "--";
  g.text(x0, CARD_Y + CARD_H - 3, cap, t === p + "wave" ? "slot" : DIM, -1, 110);
  var semi = Math.round(num(v, p + "semi", 0)), fine = Math.round(num(v, p + "fine", 0));
  var right = lvl < 0.004 ? "SILENT" : (semi ? (semi > 0 ? "+" : "") + semi + " ST " : "") + (fine ? (fine > 0 ? "+" : "") + fine + " CT" : semi ? "" : "IN TUNE");
  if (n === 2) { var xt = idx(v, "xmod_type", 4), xa = num(v, "xmod", 0); if (xt) right = XMOD[xt] + " " + Math.round(xa * 100) + "% > OSC 1"; }
  g.text(c[0] + c[1] - 8, CARD_Y + CARD_H - 3, right, n === 2 && idx(v, "xmod_type", 4) ? lc : DIM, 1, 100);
}
function frontPanel(g, v) {
  var t = v.$touched || "", seg = !!v.$segmode, lit = v.$segmode === "segment" ? v.$segment : "", el = editLayer(v), lc = LC[el];
  g.layer(["ap", txt(v, "preset_name"), el, num(v, "layer_count", 1), num(v, "layer_mode", 0), v.$page, (v.$pages || []).length, seg].join("|"), function () { panelGround(g, v, seg, el); });
  oscCard(g, v, 1, el, t, lit === "osc1");
  oscCard(g, v, 2, el, t, lit === "osc2");
  // dirt and drive into the filter, Pung's response
  var c = CARDS.filter, ft = idx(v, "ftype", 7), dirt = num(v, "dirt", 0), dt = idx(v, "drv_type", 5), dr = num(v, "drive", 0);
  if (lit === "filter") g.text(c[0] + 7, CARD_Y + 12, "FILTER", "slot", -1);
  cardFact(g, "filter", known(v, "ftype") ? FTYPES[ft] : "--", t === "ftype" ? "slot" : TEXT);
  liveFilter(g, v, c[0] + 2, CARD_Y + 16, c[1] - 4, 46, ft, lc);
  var dl = dirt > 0.004 ? DIRT[idx(v, "dirt_type", 6)] + " " + Math.round(dirt * 100) + "%" : "NO DIRT";
  var drt = dt && dr > 0.004 ? DRIVE[dt] + " " + Math.round(dr * 100) + "% " + (num(v, "drv_pos", 0) >= 0.5 ? "POST" : "PRE") : "NO DRIVE";
  g.text(c[0] + 8, CARD_Y + CARD_H - 3, dl, /^dirt/.test(t) ? "slot" : dirt > 0.004 ? TEXT : FAINT, -1, 72);
  g.text(c[0] + c[1] - 7, CARD_Y + CARD_H - 3, drt, /^dr/.test(t) ? "slot" : dt && dr > 0.004 ? TEXT : FAINT, 1, 86);
  // the amp's envelope
  var a = CARDS.amp, pm = idx(v, "poly", 3);
  if (lit === "amp") g.text(a[0] + 7, CARD_Y + 12, "AMP", "slot", -1);
  cardFact(g, "amp", known(v, "poly") ? POLY[pm] + (pm && num(v, "glide", 0) > 0.0005 ? " GLIDE" : "") : "", DIM);
  g.envelope(a[0] + 2, CARD_Y + 16, a[1] - 4, 60, { attack: "e3_a", decay: "e3_d", sustain: "e3_s", release: "e3_r", curves: ENV_CURVES, color: lc });
  // the four layers
  var L = CARDS.layers, vs = voicesOf(v), lcn = Math.round(num(v, "layer_count", 1)), split = idx(v, "layer_mode", 5) === 3;
  if (lit === "layers") g.text(L[0] + 7, CARD_Y + 12, "LAYERS", "slot", -1);
  cardFact(g, "layers", "EDIT L" + (el + 1), /edit_layer/.test(t) ? "slot" : lc);
  for (var i = 0; i < 4; i++) {
    var y = CARD_Y + 20 + i * 14, on = layerOn(v, i), me = i === el, x = L[0] + 6, pre = "l" + (i + 1) + "_";
    if (me) g.fill(x - 2, y - 1, L[1] - 8, 13, RAISED);
    g.fill(x, y, 11, 11, on ? LC[i] : LINE2);
    g.text(x + 6, y + 10, String(i + 1), on ? "#000000" : FAINT, 0);
    var tn = known(v, pre + "osc1_table") ? up(TABLES[idx(v, pre + "osc1_table", TABLES.length)]) : "--";
    g.text(x + 17, y + 10, on ? tn : "OFF", on ? (me ? TEXT : DIM) : FAINT, -1, 70);
    // its keys over the keyboard's 128 (in Split mode they decide who plays)
    var lo = num(v, pre + "key_lo", 0), hi = num(v, pre + "key_hi", 127), kx = L[0] + 98, kw = 56;
    g.fill(kx, y + 5, kw, 1, LINE2);
    if (on) g.fill(kx + kw * lo / 127, y + 4, Math.max(2, kw * (hi - lo) / 127), 3, split ? LC[i] : LC_MID[i]);
    // the voices it plays now
    var nv = vs ? vs[i] : 0;
    for (var d = 0; d < 3; d++) g.fill(L[0] + 160 + d * 5, y + 3, 3, 5, nv > d ? LC[i] : on ? LINE2 : LINE);
  }
  encoderRow(g, v, lc);
}

// Pung's default pages in Amino's slate, its teal
push.theme({ ground: PANEL, panel: RAISED, ink: TEXT, dim: DIM, rule: LINE2, faint: LINE, accent: LC[0], knob: "ring" });

var LAYER_KEYS = [];
for (var li = 1; li <= 4; li++) ["on", "vol", "osc1_table", "osc1_wave", "key_lo", "key_hi", "route", "send"].forEach(function (k) { LAYER_KEYS.push("l" + li + "_" + k); });
var OSC1 = ["osc1_table", "osc1_wave", "osc1_semi", "osc1_fine", "osc1_level", "osc1_wenv", "osc1_vel", "osc1_kbd"];
var OSC2 = ["osc2_table", "osc2_wave", "osc2_semi", "osc2_fine", "osc2_level", "osc2_link", "xmod_type", "xmod"];
var FLT_SEG = ["ftype", "cutoff", "res", "fenv", "dirt_type", "dirt", "drv_type", "drive"];
var AMP_SEG = ["e3_a", "e3_d", "e3_s", "e3_r", "vol", "amp_vel", "pan_mode", "pan"];
var LAY_SEG = ["edit_layer", "layer_count", "layer_mode", "voices", "poly", "glide", "octave", "master_vol"];
push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true,
  pages: [
    { label: "Main", keys: ["cutoff", "res", "osc1_wave", "osc2_wave", "fenv", "e3_a", "e3_r", "flavour"] },
    { label: "Waves", keys: ["osc1_table", "osc1_wave", "osc2_table", "osc2_wave", "osc1_semi", "osc2_semi", "osc1_level", "osc2_level"] }
  ],
  segments: [
    { id: "osc1", label: "Osc 1", rect: [CARDS.osc1[0], CARD_Y, CARDS.osc1[1], CARD_H], keys: OSC1 },
    { id: "osc2", label: "Osc 2", rect: [CARDS.osc2[0], CARD_Y, CARDS.osc2[1], CARD_H], keys: OSC2 },
    { id: "filter", label: "Filter", rect: [CARDS.filter[0], CARD_Y, CARDS.filter[1], CARD_H], keys: FLT_SEG },
    { id: "amp", label: "Amp", rect: [CARDS.amp[0], CARD_Y, CARDS.amp[1], CARD_H], keys: AMP_SEG },
    { id: "layers", label: "Layers", rect: [CARDS.layers[0], CARD_Y, CARDS.layers[1], CARD_H], keys: LAY_SEG }
  ],
  extra_keys: ["preset", "preset_name", "wave_view", "wave_view2", "drv_pos", "poly", "glide"].concat(OSC1, OSC2, FLT_SEG, AMP_SEG, LAY_SEG, LAYER_KEYS),
  live_keys: ["rui_live"],
  screen: frontPanel
});

// ---- band screens: Amino's slate, a header strip in the layer's colour -----------------------------------
function band(g, key, col, strips) {
  g.layer(key + "|" + col, function () {
    g.fill(0, 0, g.w, g.h, PANEL);
    for (var i = 0; i < strips.length; i++) {
      var s = strips[i];
      g.fill(s[0], 0, s[1], 12, PANEL2);
      g.fill(s[0], 11, s[1], 1, s[3] || col);
      g.text(s[0] + 6, 10, s[2], s[3] || col, -1, s[1] - 10);
    }
  });
}
function hotIn(t, ks) { return ks.indexOf(t) >= 0; }
function bar(g, x, y, w, f, col, bip) {
  g.fill(x, y, w, 3, LINE);
  if (bip) { var m = x + w / 2, d = clamp(f, -1, 1) * w / 2; g.fill(Math.min(m, m + d), y, Math.abs(d), 3, col); g.fill(m, y - 2, 1, 7, FAINT); }
  else g.fill(x, y, Math.max(0, w * c01(f)), 3, col);
}
function layerTag(g, v, x, y) { var el = editLayer(v); g.fill(x, y - 9, 22, 11, LC[el]); g.text(x + 11, y, "L" + (el + 1), "#000000", 0); }

// ---- OSCILLATORS: one oscillator a page, each part over its encoder ---------------------------------------
// Table over its knob, the wave (Wave, Semi, Fine) across the next three, then
// the level and what the oscillator's own knobs do: Osc 1 its sweeps and key
// tracking, Osc 2 its link and the cross modulation it drives into Osc 1
function smallBox(g, x, y, w, label, on, hot, col) {
  g.fill(x, y, w, 15, hot ? "slot" : on ? col : RAISED);
  g.text(x + w / 2, y + 11, label, hot || on ? "#000000" : FAINT, 0);
}
function oscScreen(n) {
  return function (g, v) {
    var el = editLayer(v), lc = LC[el], t = v.$touched || "", p = "osc" + n + "_";
    band(g, "osc" + n, lc, [[0, 117, "TABLE"], [119, 355, "OSC " + n + "  WAVE  /  SEMI  /  FINE"], [476, 117, "LEVEL"],
      n === 1 ? [595, 117, "WAVE ENV"] : [595, 117, "LINK"], n === 1 ? [714, 117, "VELOCITY"] : [714, 238, "CROSS MOD INTO OSC 1"], n === 1 ? [833, 119, "KEYS"] : null].filter(function (x) { return x; }));
    layerTag(g, v, 924, 10);
    var tb = idx(v, p + "table", TABLES.length), link = n === 2 && num(v, "osc2_link", 0) >= 0.5, lvl = num(v, p + "level", 1), pos = idx(v, p + "wave", 64);
    var tt = link ? idx(v, "osc1_table", TABLES.length) : tb, th = t === p + "table";
    // the table list, as the Table knob steps through it
    g.text(8, 28, tt > 0 ? up(TABLES[tt - 1]) : "", FAINT, -1, 104);
    g.value(8, 47, up(TABLES[tt]), th ? "slot" : TEXT, -1, 106);
    g.text(8, 64, tt < TABLES.length - 1 ? up(TABLES[tt + 1]) : "", FAINT, -1, 104);
    g.text(8, 84, link ? "OSC 1'S TABLE" : (tt + 1) + " OF 74", link ? lc : FAINT, -1, 104);
    // the wave, pixel for pixel, and its place in the table
    var w = waveOf(v, n === 1 ? "wave_view" : "wave_view2"), cw = 5, wx = 137, wh = hotIn(t, [p + "wave", p + "semi", p + "fine"]);
    pixelWave(g, wx, 16, cw, 44, w, wh ? "slot" : lc, LC_DK[el], lvl < 0.004);
    var we = n === 1 ? num(v, "osc1_wenv", 0) : 0, reach = Math.abs(we) > 0.004 && pos <= 60 ? clamp(Math.round(pos + we * 63), 0, 60) : 0;
    positions(g, wx, 66, cw, known(v, p + "wave") ? pos : -1, reach, lc, LC_DK[el], t === p + "wave");
    posMark(g, v, p + "wave", wx, 66, cw);
    g.text(wx, 84, CLASSIC[pos] ? "CLASSIC " + CLASSIC[pos] : "WAVE " + pos + " OF 64", t === p + "wave" ? "slot" : TEXT, -1, 150);
    var semi = Math.round(num(v, p + "semi", 0)), fine = Math.round(num(v, p + "fine", 0));
    g.text(wx + 64 * cw, 84, (semi ? (semi > 0 ? "+" : "") + semi + " ST  " : "") + (fine ? (fine > 0 ? "+" : "") + fine + " CT" : semi ? "" : "IN TUNE"), hotIn(t, [p + "semi", p + "fine"]) ? "slot" : DIM, 1, 160);
    // the level: a fader
    var lh = t === p + "level";
    g.fill(500, 18, 12, 58, LINE);
    g.fill(500, 18 + 58 * (1 - c01(lvl)), 12, 58 * c01(lvl), lh ? "slot" : lc);
    vMark(g, v, p + "level", 513, 18, 58);
    g.text(522, 52, lvl < 0.004 ? "SILENT" : "", FAINT, -1);
    if (n === 1) {
      // the wave envelope's reach on the table
      var wh2 = t === "osc1_wenv";
      g.text(605, 34, Math.abs(we) < 0.004 ? "NO SWEEP" : pos > 60 ? "CLASSIC: FIXED" : "TO WAVE " + reach, wh2 ? "slot" : Math.abs(we) > 0.004 ? TEXT : FAINT, -1, 104);
      bar(g, 605, 50, 98, we, wh2 ? "slot" : lc, true);
      g.text(605, 70, "AT ITS PEAK", FAINT, -1);
      // velocity to wave: where a hard note lands
      var vw = num(v, "osc1_vel", 0), vh = t === "osc1_vel", vr = pos <= 60 ? clamp(Math.round(pos + vw * 63), 0, 60) : pos;
      g.text(724, 34, Math.abs(vw) < 0.004 ? "NO CHANGE" : "HARD: WAVE " + vr, vh ? "slot" : Math.abs(vw) > 0.004 ? TEXT : FAINT, -1, 104);
      bar(g, 724, 50, 98, vw, vh ? "slot" : lc, true);
      // keytracking
      var kb = num(v, "osc1_kbd", 1) >= 0.5, kh = t === "osc1_kbd";
      g.value(843, 44, kb ? "TRACKS" : "FIXED", kh ? "slot" : TEXT, -1);
      g.text(843, 64, kb ? "PLAYS THE KEYS" : "ONE PITCH", DIM, -1, 104);
    } else {
      var lh2 = t === "osc2_link";
      smallBox(g, 605, 26, 46, "OWN", !link, lh2 && !link, lc);
      smallBox(g, 655, 26, 46, "LINK", link, lh2 && link, lc);
      g.text(605, 64, link ? "OSC 1'S TABLE" : "ITS OWN TABLE", DIM, -1, 104);
      g.text(605, 78, link ? "AND POSITION" : "AND POSITION", DIM, -1, 104);
      // cross modulation: its kind and amount, Osc 2 driving Osc 1
      var xt = idx(v, "xmod_type", 4), xa = num(v, "xmod", 0), xh = hotIn(t, ["xmod_type", "xmod"]);
      for (var i = 0; i < 4; i++) smallBox(g, 724 + i * 54, 26, 50, XMOD[i], known(v, "xmod_type") && i === xt, t === "xmod_type" && i === xt, lc);
      bar(g, 724, 54, 212, xt ? xa : 0, t === "xmod" ? "slot" : xt ? lc : FAINT);
      if (xt) hMark(g, v, "xmod", 724, 55, 212);
      g.text(724, 76, !xt ? "THE OSCILLATORS RUN APART" : xt === 1 ? "OSC 2 BENDS OSC 1'S PHASE" : xt === 2 ? "OSC 2 SCALES OSC 1" : "OSC 1 RESTARTS, UP TO +36 ST",
        xh ? "slot" : xt ? TEXT : FAINT, -1, 220);
    }
  };
}
// the wave envelope and how far it sweeps each oscillator's position
function wenvScreen(g, v) {
  var el = editLayer(v), lc = LC[el], t = v.$touched || "";
  band(g, "wenv", lc, [[0, 474, "WAVE ENVELOPE"], [478, 236, "OSC 1 POSITION"], [716, 236, "OSC 2 POSITION"]]);
  g.envelope(0, 13, 474, 73, { attack: "e1_a", decay: "e1_d", sustain: "e1_s", release: "e1_r", curves: ENV_CURVES, labels: true, color: lc });
  for (var n = 1; n <= 2; n++) {
    var p = "osc" + n + "_", x0 = n === 1 ? 486 : 724, pos = idx(v, p + "wave", 64), we = num(v, p + "wenv", 0), cw = 3, hot = hotIn(t, [p + "wave", p + "wenv"]);
    var reach = pos <= 60 ? clamp(Math.round(pos + we * 63), 0, 60) : pos, w = waveOf(v, n === 1 ? "wave_view" : "wave_view2");
    pixelWave(g, x0, 16, cw, 36, w, hot ? "slot" : lc, LC_DK[el], num(v, p + "level", 1) < 0.004);
    positions(g, x0, 60, cw, known(v, p + "wave") ? pos : -1, Math.abs(we) > 0.004 ? reach : 0, lc, LC_DK[el], t === p + "wave");
    posMark(g, v, p + "wave", x0, 60, cw);
    if (Math.abs(we) > 0.004 && pos <= 60) {
      var xa = x0 + pos * cw + 1, xb = x0 + reach * cw + 1, ac = t === p + "wenv" ? "slot" : lc;
      g.fill(Math.min(xa, xb), 70, Math.abs(xb - xa), 2, ac);
      g.poly([xb + (we > 0 ? -4 : 4), 67, xb, 71, xb + (we > 0 ? -4 : 4), 75], 2, ac);
    }
    g.text(x0, 85, pos > 60 ? "CLASSIC: NOT SWEPT" : Math.abs(we) < 0.004 ? "STAYS AT " + pos : pos + " TO " + reach + " AT THE PEAK", t === p + "wenv" ? "slot" : Math.abs(we) > 0.004 ? TEXT : FAINT, -1, 220);
  }
}
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Osc 1", keys: OSC1, screen: oscScreen(1) },
    { label: "Osc 2", keys: OSC2, screen: oscScreen(2) },
    { label: "Wave Env", keys: ["e1_a", "e1_d", "e1_s", "e1_r", "osc1_wave", "osc1_wenv", "osc2_wave", "osc2_wenv"], screen: wenvScreen }
  ],
  extra_keys: ["edit_layer", "wave_view", "wave_view2", "osc1_table", "osc2_table", "osc1_wave", "osc2_wave", "osc1_level", "osc2_level", "osc1_wenv", "osc2_wenv",
    "osc2_link", "xmod_type", "xmod"]
});

// ---- FILTER & AMP: what goes in, the drive, the filter, the envelopes ---------------------------------------
function mixerScreen(g, v) {
  var el = editLayer(v), lc = LC[el], t = v.$touched || "";
  band(g, "mixer", lc, [[0, 236, "INTO THE FILTER"], [238, 236, "DIRT"], [476, 357, "DRIVE"], [835, 117, "LAYER"]]);
  layerTag(g, v, 924, 10);
  g.mix(0, 13, 236, 73, ["osc1_level", "osc2_level"].map(function (k) { return moved(v, k) ? nowOf(v, k) : k; }), { color: lc }); // the mix the sound has now
  // dirt: its kind and how loud, under the filter
  var dt = idx(v, "dirt_type", 6), dl = num(v, "dirt", 0), dh = hotIn(t, ["dirt_type", "dirt"]);
  for (var i = 0; i < 6; i++) {
    var sel = known(v, "dirt_type") && i === dt, x = 246 + (i % 3) * 76, y = 30 + Math.floor(i / 3) * 18;
    if (sel) g.fill(x - 4, y - 11, 72, 15, t === "dirt_type" ? "slot" : dl > 0.004 ? lc : LINE2);
    g.text(x, y, DIRT[i], sel ? "#000000" : FAINT, -1);
  }
  bar(g, 246, 66, 218, dl, t === "dirt" ? "slot" : lc);
  hMark(g, v, "dirt", 246, 67, 218);
  g.text(246, 84, dl < 0.004 ? "NO NOISE" : dt === 5 ? "OSC 1 x OSC 2 RING, " + Math.round(dl * 100) + "%" : "NOISE " + Math.round(dl * 100) + "%", dh ? "slot" : dl > 0.004 ? TEXT : FAINT, -1, 218);
  // drive: its own transfer curve at this gain (voice.c shaper), and where it sits
  var ty = idx(v, "drv_type", 5), d = num(v, "drive", 0), on = ty > 0 && d > 0.004, gx = 590, gy = 48, gs = 32, dh2 = hotIn(t, ["drv_type", "drive"]);
  g.fill(gx - gs, gy, 2 * gs, 1, LINE); g.fill(gx, gy - gs, 1, 2 * gs, LINE);
  var dn = numNow(v, "drive", d), onN = ty > 0 && dn > 0.004; // the curve at the gain the sound has now
  var pts = cached("drv" + ty + "|" + dn.toFixed(3), function () {
    var out = [];
    for (var j = 0; j <= 48; j++) { var xx = -1 + 2 * j / 48, yy = onN ? shaper(ty, xx * (1 + 15 * dn)) / (1 + dn) : xx; out.push(gx + xx * gs, gy - clamp(yy, -1.2, 1.2) * gs * 0.9); }
    return out;
  });
  g.poly(pts, 2, dh2 ? "slot" : on ? lc : FAINT);
  for (i = 0; i < 5; i++) {
    var s2 = known(v, "drv_type") && i === ty, yy2 = 26 + i * 13;
    g.text(486, yy2, DRIVE[i], s2 ? (t === "drv_type" ? "slot" : on || i === 0 ? TEXT : DIM) : FAINT, -1);
  }
  var post = num(v, "drv_pos", 0) >= 0.5;
  g.text(640, 30, "GAIN x" + (1 + 15 * d).toFixed(1), t === "drive" ? "slot" : on ? TEXT : FAINT, -1);
  g.text(640, 50, post ? "AFTER THE FILTER" : "BEFORE THE FILTER", t === "drv_pos" ? "slot" : on ? lc : FAINT, -1);
  g.text(640, 70, on ? "" : ty ? "DRIVE AT 0" : "DRIVE OFF", FAINT, -1);
  // the layer's volume
  var vol = num(v, "vol", 0.8);
  g.fill(851, 18, 14, 60, LINE);
  g.fill(851, 18 + 60 * (1 - vol), 14, 60 * vol, t === "vol" ? "slot" : lc);
  vMark(g, v, "vol", 866, 18, 60);
  g.text(874, 52, Math.round(vol * 100) + "%", t === "vol" ? "slot" : TEXT, -1);
}
function filterScreen(g, v) {
  var el = editLayer(v), lc = LC[el], t = v.$touched || "", ft = idx(v, "ftype", 7);
  band(g, "filter", lc, [[0, 474, "FILTER"], [476, 476, "FILTER ENVELOPE"]]);
  layerTag(g, v, 924, 10);
  liveFilter(g, v, 0, 13, 474, 73, ft, lc);
  g.text(466, 27, FTYPES[ft], t === "ftype" ? "slot" : lc, 1);
  // where the envelope takes the cutoff at its peak: +-72 semitones at full
  var fe = num(v, "fenv", 0), c = num(v, "cutoff", 100);
  if (Math.abs(fe) > 0.004 && known(v, "cutoff")) {
    var x0 = 6, x1 = 468, xc = x0 + (x1 - x0) * cutAt(c), xe = x0 + (x1 - x0) * cutAt(c + fe * 72), y = 78, ec = t === "fenv" ? "slot" : lc, d = fe > 0 ? -6 : 6;
    g.fill(Math.min(xc, xe), y - 1, Math.abs(xe - xc), 2, ec);
    g.poly([xe + d, y - 5, xe, y, xe + d, y + 5], 2, ec);
    g.text(xe - d * 1.5, y - 6, (fe > 0 ? "+" : "") + Math.round(fe * 72) + " ST", ec, fe > 0 ? 1 : -1);
  }
  g.envelope(476, 13, 476, 73, { attack: "e2_a", decay: "e2_d", sustain: "e2_s", release: "e2_r", curves: ENV_CURVES, labels: true, color: lc });
}
function ampScreen(g, v) {
  var el = editLayer(v), lc = LC[el], t = v.$touched || "";
  band(g, "amp", lc, [[0, 474, "AMP ENVELOPE"], [476, 117, "LEVEL"], [595, 117, "VELOCITY"], [714, 238, "PAN"]]);
  layerTag(g, v, 924, 10);
  g.envelope(0, 13, 474, 73, { attack: "e3_a", decay: "e3_d", sustain: "e3_s", release: "e3_r", curves: ENV_CURVES, labels: true, color: lc });
  var vol = num(v, "vol", 0.8), av = num(v, "amp_vel", 0.5);
  g.fill(492, 18, 14, 60, LINE); g.fill(492, 18 + 60 * (1 - vol), 14, 60 * vol, t === "vol" ? "slot" : lc);
  vMark(g, v, "vol", 507, 18, 60);
  // velocity: the level a soft and a hard note reach (1 - amount x (1 - vel))
  for (var i = 0; i < 5; i++) {
    var vel = (i + 1) / 5, lv = 1 - av * (1 - vel), bh = 50 * lv;
    g.fill(608 + i * 18, 70 - bh, 12, bh, t === "amp_vel" ? "slot" : i === 4 ? lc : LC_MID[el]);
  }
  g.text(608, 84, "SOFT", FAINT, -1); g.text(696, 84, "HARD", FAINT, 1);
  // pan: where the voices go
  var pm = idx(v, "pan_mode", 6), pn = num(v, "pan", 0), cx = 833, w = 100, ph = hotIn(t, ["pan_mode", "pan"]);
  g.fill(cx - w, 46, 2 * w, 1, LINE2); g.fill(cx, 36, 1, 20, FAINT);
  g.text(cx - w - 4, 50, "L", FAINT, 1); g.text(cx + w + 4, 50, "R", FAINT, -1);
  var pc = ph ? "slot" : lc;
  if (pm === 0) { g.dot(cx + pn * w, 46, 6, pc); hMark(g, v, "pan", cx - w, 46, 2 * w); }
  else if (pm === 4 || pm === 5) { g.fill(cx - Math.abs(pn) * w, 44, 2 * Math.abs(pn) * w, 5, LC_DK[el]); g.dot(cx, 46, 4, pc); }
  else { for (var j = -2; j <= 2; j++) g.dot(cx + j / 2 * Math.abs(pn) * w, 46, 4, pc); }
  g.text(cx, 30, PANM[pm] + (pm >= 4 ? " MOVES IT" : pm ? " PER NOTE" : ""), t === "pan_mode" ? "slot" : TEXT, 0, 230);
  g.text(cx, 74, pm === 0 ? (Math.abs(pn) < 0.01 ? "CENTRE" : Math.round(Math.abs(pn) * 100) + "% " + (pn < 0 ? "LEFT" : "RIGHT")) : "WIDTH " + Math.round(Math.abs(pn) * 100) + "%", t === "pan" ? "slot" : DIM, 0, 230);
}
function auxScreen(g, v) {
  var el = editLayer(v), lc = LC[el], t = v.$touched || "";
  band(g, "aux", lc, [[0, 474, "AUX ENVELOPE"], [476, 476, "WHERE IT GOES"]]);
  layerTag(g, v, 924, 10);
  g.envelope(0, 13, 474, 73, { attack: "e4_a", decay: "e4_d", sustain: "e4_s", release: "e4_r", curves: ENV_CURVES, labels: true, color: lc });
  for (var r = 0; r < 2; r++) {
    var dk = "e4_dst" + (r + 1), ak = "e4_amt" + (r + 1), d = idx(v, dk, TARGETS.length), a = num(v, ak, 0), x = 488 + r * 238, on = d > 0 && Math.abs(a) > 0.004;
    var hot = hotIn(t, [dk, ak]);
    g.text(x, 32, "AUX ENV", on ? DIM : FAINT, -1);
    g.text(x + 64, 32, ">", on ? lc : FAINT, -1);
    g.value(x, 54, d ? up(TARGETS[d]) : "OFF", t === dk ? "slot" : on ? TEXT : FAINT, -1, 220);
    bar(g, x, 66, 220, a, t === ak ? "slot" : on ? lc : FAINT, true);
    g.text(x, 84, on ? (a > 0 ? "+" : "") + Math.round(a * 100) + "%" : d ? "AMOUNT 0" : "", hot ? "slot" : DIM, -1);
  }
}
push.compartment({
  id: "tone", label: "Filter & Amp",
  pages: [
    { label: "Mixer", keys: ["osc1_level", "osc2_level", "dirt_type", "dirt", "drv_type", "drive", "drv_pos", "vol"], screen: mixerScreen },
    { label: "Filter", keys: ["cutoff", "res", "fenv", "ftype", "e2_a", "e2_d", "e2_s", "e2_r"], screen: filterScreen },
    { label: "Amp", keys: ["e3_a", "e3_d", "e3_s", "e3_r", "vol", "amp_vel", "pan_mode", "pan"], screen: ampScreen },
    { label: "Aux Env", keys: ["e4_a", "e4_d", "e4_s", "e4_r", "e4_dst1", "e4_amt1", "e4_dst2", "e4_amt2"], screen: auxScreen }
  ],
  extra_keys: ["edit_layer"]
});

// ---- PLAY: expression and the voice (Pung's pages, Amino's colours) ---------------------------------------------
// the player's routes, each over its encoder: what velocity, the key and
// aftertouch reach, and how far (Amino's dedicated routes, outside the matrix)
function playScreen(g, v) {
  var el = editLayer(v), lc = LC[el], t = v.$touched || "";
  band(g, "play", lc, [[0, 474, "VELOCITY"], [476, 117, "KEY"], [595, 357, "AFTERTOUCH"]]);
  layerTag(g, v, 924, 10);
  var R = [["osc1_vel", "WAVE 1", "±63 WAVES"], ["osc2_vel", "WAVE 2", "±63 WAVES"], ["fvel", "CUTOFF", "±48 ST"], ["amp_vel", "LEVEL", "SOFT QUIETER"],
    ["fkbd", "CUTOFF", "FOLLOWS KEYS"], ["at_wave", "WAVES", "±63 WAVES"], ["at_cut", "CUTOFF", "±72 ST"], ["at_vib", "VIBRATO", "LFO 1 > PITCH"]];
  for (var i = 0; i < 8; i++) {
    var k = R[i][0], x = i * 119 + 8, f = num(v, k, 0), hot = t === k, on = Math.abs(f) > 0.004, bip = isBip(v, k);
    g.text(x, 30, "> " + R[i][1], hot ? "slot" : on ? TEXT : FAINT, -1, 106);
    if (k === "fkbd") { // 0..2: none, half, full, double the key's pitch
      g.value(x, 54, Math.round(f * 100) + "%", hot ? "slot" : on ? TEXT : FAINT, -1);
      g.text(x, 72, f > 1.05 ? "MORE THAN THE KEYS" : f > 0.95 ? "AS THE KEYS" : on ? "PART OF THE WAY" : "THE SAME EVERYWHERE", DIM, -1, 108);
      continue;
    }
    bar(g, x, 46, 100, bip ? f : f, hot ? "slot" : on ? lc : FAINT, bip);
    g.value(x, 70, (bip && f > 0.004 ? "+" : "") + Math.round(f * 100) + "%", hot ? "slot" : on ? TEXT : FAINT, -1);
    g.text(x, 84, on ? R[i][2] : "OFF", on ? DIM : FAINT, -1, 108);
  }
}
push.compartment({
  id: "play", label: "Play",
  pages: [
    { label: "Play", keys: ["osc1_vel", "osc2_vel", "fvel", "amp_vel", "fkbd", "at_wave", "at_cut", "at_vib"], screen: playScreen },
    { label: "Voice", keys: ["octave", "poly", "glide", "scale", "chord", "osc_mode", "osc1_kbd", "osc2_kbd"] }
  ]
});

// ---- MODULATION: the LFOs, the eight slots at once ----------------------------------------------------------------
function lfoScreen(n) {
  return function (g, v) {
    var el = editLayer(v), lc = LC[el], t = v.$touched || "", p = "lfo" + n + "_";
    band(g, "lfo" + n, lc, [[0, 236, "LFO " + n], [238, 236, "RATE  /  SYNC"], [476, 236, "PHASE  /  FADE IN"], [714, 238, "WHEEL  /  TO PITCH"]]);
    layerTag(g, v, 924, 10);
    var sh = idx(v, p + "shape", 7), sync = num(v, p + "sync", 0) >= 0.5, ph = idx(v, p + "phase", 3);
    g.lfo(0, 13, 236, 73, { shape: LFO_SHAPES[sh], rate: p + "rate", sync: p + "sync", div: p + "div", trig: ph === 1, color: lc });
    g.text(228, 27, LFO_NAMES[sh], t === p + "shape" ? "slot" : lc, 1);
    var rh = hotIn(t, [p + "rate", p + "div", p + "sync"]);
    g.value(248, 44, sync ? DIVS[idx(v, p + "div", DIVS.length)] : hz(lfoHz(num(v, p + "rate", 0.4))).join(" ").toUpperCase(), rh ? "slot" : TEXT, -1);
    g.text(248, 64, sync ? "ON THE BEAT" : "FREE RATE", sync ? lc : DIM, -1);
    g.text(248, 82, sync ? "RATE KNOB UNUSED" : "DIVISION UNUSED", FAINT, -1);
    g.value(486, 44, LFO_PHASE[ph], t === p + "phase" ? "slot" : TEXT, -1);
    g.text(486, 64, ph === 1 ? "EACH NOTE RESTARTS IT" : ph === 2 ? "ONE PHASE FOR ALL" : "RUNS ON ITS OWN", DIM, -1, 220);
    var fd = num(v, p + "fade", 0);
    g.text(486, 82, fd > 0.0005 ? "FADES IN OVER " + secs(envS(fd)).join(" ").toUpperCase() : "NO FADE-IN", t === p + "fade" ? "slot" : fd > 0.0005 ? TEXT : FAINT, -1, 220);
    var mw = num(v, p + "mw", 0) >= 0.5, pt = num(v, p + "pitch", 0);
    g.value(724, 44, mw ? "WHEEL" : "ALWAYS", t === p + "mw" ? "slot" : TEXT, -1);
    g.text(724, 64, mw ? "THE MOD WHEEL SETS ITS DEPTH" : "FULL DEPTH", DIM, -1, 220);
    bar(g, 724, 74, 216, pt, t === p + "pitch" ? "slot" : lc, true);
    g.text(944, 64, Math.abs(pt) > 0.004 ? "VIBRATO ±" + (Math.abs(pt) * 12).toFixed(1) + " ST" : "", lc, 1);
  };
}
function routeOf(v, s) {
  var p = "m" + s + "_";
  return { src: idx(v, p + "src", SOURCES.length), dst: idx(v, p + "dst", TARGETS.length), amt: num(v, p + "amt", 0), via: idx(v, p + "via", SOURCES.length), vd: num(v, p + "via_depth", 1) };
}
function modScreen(a) { // slots a and a+1 on the encoders
  return function (g, v) {
    var el = editLayer(v), lc = LC[el], t = v.$touched || "";
    band(g, "mod" + a, lc, [[0, 474, "SLOT " + a], [476, 476, "SLOT " + (a + 1)]]);
    layerTag(g, v, 924, 10);
    for (var j = 0; j < 2; j++) {
      var s = a + j, r = routeOf(v, s), x = j * 476 + 8, on = r.src > 0 && r.dst > 0 && Math.abs(r.amt) > 0.0005, p = "m" + s + "_";
      // source > target, over their encoders; the amount; via
      g.value(x, 40, r.src ? up(SOURCES[r.src]) : "OFF", t === p + "src" ? "slot" : r.src ? TEXT : FAINT, -1, 104);
      g.text(x + 110, 36, ">", on ? lc : FAINT, 0);
      g.value(x + 119, 40, r.dst ? up(TARGETS[r.dst]) : "OFF", t === p + "dst" ? "slot" : r.dst ? TEXT : FAINT, -1, 112);
      bar(g, x + 238, 33, 108, r.amt, t === p + "amt" ? "slot" : on ? lc : FAINT, true);
      g.text(x + 292, 54, (r.amt > 0.0005 ? "+" : "") + (r.amt * 100).toFixed(1) + "%", t === p + "amt" ? "slot" : on ? TEXT : FAINT, 0);
      g.value(x + 357, 40, r.via ? "x " + up(SOURCES[r.via]) : "NO VIA", t === p + "via" ? "slot" : r.via ? TEXT : FAINT, -1, 104);
    }
    // the eight slots, the two on the encoders lit
    for (var k = 1; k <= 8; k++) {
      var q = routeOf(v, k), used = q.src > 0 && q.dst > 0 && Math.abs(q.amt) > 0.0005, xx = 8 + (k - 1) * 118, mine = k === a || k === a + 1;
      g.fill(xx, 64, 110, 1, mine ? lc : LINE2);
      g.text(xx, 78, k + "  " + (used ? SRC_SHORT[q.src] + ">" + DST_SHORT[q.dst] + " " + (q.amt > 0 ? "+" : "") + Math.round(q.amt * 100) : "-"), mine ? (used ? TEXT : DIM) : used ? DIM : FAINT, -1, 110);
    }
  };
}
// each slot's Via Depth over its encoder: how much of the Via source scales
// the route (0: the route unscaled, 1: the source at full strength)
function viaScreen(g, v) {
  var el = editLayer(v), lc = LC[el], t = v.$touched || "";
  band(g, "via", lc, [[0, 952, "VIA DEPTH: HOW FAR EACH SLOT'S VIA SOURCE SCALES IT"]]);
  layerTag(g, v, 924, 10);
  for (var k = 1; k <= 8; k++) {
    var q = routeOf(v, k), x = (k - 1) * 119 + 8, used = q.src > 0 && q.dst > 0 && Math.abs(q.amt) > 0.0005, hot = t === "m" + k + "_via_depth";
    g.text(x, 30, k + " " + (q.src ? up(SOURCES[q.src]).slice(0, 8) : "OFF"), used ? TEXT : FAINT, -1, 108);
    g.text(x, 46, "> " + (q.dst ? up(TARGETS[q.dst]).slice(0, 10) : "OFF"), used ? DIM : FAINT, -1, 108);
    g.text(x, 66, q.via ? "x " + up(SOURCES[q.via]).slice(0, 9) : "NO VIA", q.via ? lc : FAINT, -1, 108);
    bar(g, x, 76, 100, q.vd, hot ? "slot" : q.via ? lc : FAINT);
  }
}
var MOD_EXTRA = [];
for (var ms = 1; ms <= 8; ms++) ["src", "dst", "amt", "via", "via_depth"].forEach(function (k) { MOD_EXTRA.push("m" + ms + "_" + k); });
push.compartment({
  id: "mod", label: "Modulation",
  pages: [
    { label: "LFO 1", keys: ["lfo1_shape", "lfo1_rate", "lfo1_div", "lfo1_sync", "lfo1_phase", "lfo1_fade", "lfo1_mw", "lfo1_pitch"], screen: lfoScreen(1) },
    { label: "LFO 2", keys: ["lfo2_shape", "lfo2_rate", "lfo2_div", "lfo2_sync", "lfo2_phase", "lfo2_fade", "lfo2_mw", "lfo2_pitch"], screen: lfoScreen(2) },
    { label: "Mod 1-2", keys: ["m1_src", "m1_dst", "m1_amt", "m1_via", "m2_src", "m2_dst", "m2_amt", "m2_via"], screen: modScreen(1) },
    { label: "Mod 3-4", keys: ["m3_src", "m3_dst", "m3_amt", "m3_via", "m4_src", "m4_dst", "m4_amt", "m4_via"], screen: modScreen(3) },
    { label: "Mod 5-6", keys: ["m5_src", "m5_dst", "m5_amt", "m5_via", "m6_src", "m6_dst", "m6_amt", "m6_via"], screen: modScreen(5) },
    { label: "Mod 7-8", keys: ["m7_src", "m7_dst", "m7_amt", "m7_via", "m8_src", "m8_dst", "m8_amt", "m8_via"], screen: modScreen(7) },
    { label: "Via Depth", keys: ["m1_via_depth", "m2_via_depth", "m3_via_depth", "m4_via_depth", "m5_via_depth", "m6_via_depth", "m7_via_depth", "m8_via_depth"], screen: viaScreen }
  ],
  extra_keys: ["edit_layer"].concat(MOD_EXTRA)
});

// ---- EFFECTS: the chain; each slot's knobs named as its effect means them ------------------------------------------
function fxRoute(g, v, t) {
  var chain = num(v, "fx_chain", 1) >= 0.5, f1 = idx(v, "fx1_type", 12), f2 = idx(v, "fx2_type", 12), lc = t === "fx_chain" ? "slot" : DIM;
  // the layers, each into its route
  for (var i = 0; i < 4; i++) {
    var y = 20 + i * 15, on = layerOn(v, i), r = idx(v, "l" + (i + 1) + "_route", 3);
    g.fill(10, y, 13, 12, on ? LC[i] : LINE2);
    g.text(17, y + 10, String(i + 1), on ? "#000000" : FAINT, 0);
    g.text(30, y + 10, on ? ROUTE[r] : "OFF", on ? TEXT : FAINT, -1);
  }
  function box(x, y, n, name, mixv, hot, lit) {
    g.fill(x, y, 120, 28, lit ? RAISED : PANEL2);
    g.text(x + 6, y + 11, "FX " + n, FAINT, -1);
    g.text(x + 114, y + 11, up(name), hot ? "slot" : lit ? TEXT : FAINT, 1, 80);
    g.fill(x + 6, y + 19, 108, 3, LINE);
    g.fill(x + 6, y + 19, 108 * c01(mixv), 3, lit ? GLOBAL : FAINT);
  }
  if (chain) {
    box(96, 30, 1, FX_TYPES[f1], num(v, "fx1_mix", 0.3), hotIn(t, ["fx1_type", "fx1_mix"]), f1 > 0);
    box(240, 30, 2, FX_TYPES[f2], num(v, "fx2_mix", 0.3), hotIn(t, ["fx2_type", "fx2_mix"]), f2 > 0);
    g.fill(74, 44, 22, 2, lc); g.fill(216, 44, 24, 2, lc); g.fill(360, 44, 40, 2, lc);
  } else {
    box(120, 18, 1, FX_TYPES[f1], num(v, "fx1_mix", 0.3), hotIn(t, ["fx1_type", "fx1_mix"]), f1 > 0);
    box(120, 52, 2, FX_TYPES[f2], num(v, "fx2_mix", 0.3), hotIn(t, ["fx2_type", "fx2_mix"]), f2 > 0);
    g.fill(240, 32, 30, 2, lc); g.fill(240, 66, 30, 2, lc); g.fill(270, 32, 2, 36, lc); g.fill(270, 49, 130, 2, lc);
  }
  g.text(406, 49, "OUT", TEXT, -1);
  g.text(96, 84, chain ? "SERIAL: FX 1 INTO FX 2" : "PARALLEL: SIDE BY SIDE", t === "fx_chain" ? "slot" : DIM, -1);
}
function fxSlotScreen(n) {
  return function (g, v) {
    var el = editLayer(v), lc = LC[el], t = v.$touched || "", ty = idx(v, "fx" + n + "_type", 12), rows = FX_META[ty];
    band(g, "fx" + n, GLOBAL, [[0, 236, "FX " + n], [238, 714, ty ? up(FX_TYPES[ty]) : "OFF"]]);
    g.value(10, 44, ty ? up(FX_TYPES[ty]) : "OFF", t === "fx" + n + "_type" ? "slot" : TEXT, -1, 110);
    var mx = num(v, "fx" + n + "_mix", 0.3);
    g.text(129, 30, "MIX", t === "fx" + n + "_mix" ? "slot" : DIM, -1);
    bar(g, 129, 38, 100, mx, t === "fx" + n + "_mix" ? "slot" : GLOBAL);
    g.value(129, 62, Math.round(mx * 100) + "%", t === "fx" + n + "_mix" ? "slot" : TEXT, -1);
    // the six knobs, each named and read over its own encoder
    for (var i = 0; i < 6; i++) {
      var k = "fx" + n + "_p" + (i + 1), x = 238 + i * 119 + 4, row = rows ? rows[i] : null, f = num(v, k, 0), hot = t === k;
      if (!rows) { g.text(x, 44, "-", FAINT, -1); continue; }
      g.text(x, 30, up(row[0]), hot ? "slot" : DIM, -1, 110);
      g.value(x, 52, fxReading(row, f), hot ? "slot" : TEXT, -1, 110);
      if (row[1] === "opts") {
        var nn = row[2].length, at = clamp(Math.floor(f * (nn - 1) + 0.5), 0, nn - 1), cw = Math.min(12, Math.floor(108 / nn));
        for (var o = 0; o < nn; o++) g.fill(x + o * cw, 64, cw - 2, 6, o === at ? (hot ? "slot" : GLOBAL) : LINE);
      } else bar(g, x, 66, 104, f, hot ? "slot" : GLOBAL);
    }
    g.text(10, 84, ty ? "" : "CHOOSE AN EFFECT", FAINT, -1);
  };
}
function fxScreen(g, v) {
  var t = v.$touched || "";
  band(g, "fxr", GLOBAL, [[0, 474, "LAYERS > EFFECTS > OUT"], [476, 476, "THE EDITED LAYER'S SEND"]]);
  fxRoute(g, v, t);
  var el = editLayer(v), r = idx(v, "route", 3), s = num(v, "send", 1), mv = num(v, "master_vol", 0.8);
  layerTag(g, v, 488, 40);
  g.value(518, 40, ROUTE[r], t === "route" ? "slot" : TEXT, -1);
  g.text(600, 36, r ? "SEND " + Math.round(s * 100) + "%" : "NO SEND", t === "send" ? "slot" : r ? LC[el] : FAINT, -1);
  bar(g, 488, 54, 200, r ? s : 0, t === "send" ? "slot" : LC[el]);
  g.text(760, 36, "MASTER", t === "master_vol" ? "slot" : DIM, -1);
  bar(g, 760, 46, 180, mv, t === "master_vol" ? "slot" : GLOBAL);
  g.value(760, 72, Math.round(mv * 100) + "%", t === "master_vol" ? "slot" : TEXT, -1);
}
var FX_P = [];
for (var fn = 1; fn <= 2; fn++) for (var fp = 1; fp <= 6; fp++) FX_P.push("fx" + fn + "_p" + fp);
push.compartment({
  id: "fx", label: "Effects",
  pages: [
    { label: "FX", keys: ["fx1_type", "fx1_mix", "fx2_type", "fx2_mix", "fx_chain", "route", "send", "master_vol"], screen: fxScreen },
    { label: "FX 1", keys: ["fx1_type", "fx1_mix", "fx1_p1", "fx1_p2", "fx1_p3", "fx1_p4", "fx1_p5", "fx1_p6"], screen: fxSlotScreen(1) },
    { label: "FX 2", keys: ["fx2_type", "fx2_mix", "fx2_p1", "fx2_p2", "fx2_p3", "fx2_p4", "fx2_p5", "fx2_p6"], screen: fxSlotScreen(2) }
  ],
  extra_keys: ["edit_layer", "layer_count", "fx1_type", "fx2_type", "fx1_mix", "fx2_mix", "fx_chain"].concat(LAYER_KEYS)
});

// ---- LAYERS: the four side by side -------------------------------------------------------------------------------
function layersScreen(g, v) {
  var t = v.$touched || "", el = editLayer(v), lm = idx(v, "layer_mode", 5), lcn = Math.round(num(v, "layer_count", 1)), vs = voicesOf(v);
  band(g, "layers", GLOBAL, [[0, 952, "LAYERS  " + LMODE[lm] + "  " + (lm === 3 ? "(THE KEYS DECIDE)" : lm === 4 ? "(THE MIDI CHANNEL DECIDES)" : lm === 0 ? "(ALL PLAY EVERY NOTE)" : "(NOTES TAKE TURNS)")]]);
  for (var i = 0; i < 4; i++) {
    var x = i * 238 + 6, pre = "l" + (i + 1) + "_", on = layerOn(v, i), me = i === el, col = LC[i];
    if (me) g.fill(x - 4, 14, 234, 72, RAISED);
    g.fill(x, 18, 16, 16, on ? col : LINE2);
    g.text(x + 8, 30, String(i + 1), on ? "#000000" : FAINT, 0);
    g.text(x + 24, 30, !on ? "OFF" : me ? "EDITING" : "ON", me ? col : on ? DIM : FAINT, -1);
    var tn = up(TABLES[idx(v, pre + "osc1_table", TABLES.length)]);
    g.value(x + 24, 50, on ? tn : "--", hotIn(t, [pre + "on"]) ? "slot" : on ? TEXT : FAINT, -1, 120);
    // level and route
    var vol = num(v, pre + "vol", 0.8), r = idx(v, pre + "route", 3), s = num(v, pre + "send", 1);
    g.fill(x + 156, 20, 10, 34, LINE);
    g.fill(x + 156, 20 + 34 * (1 - vol), 10, 34 * vol, t === pre + "vol" ? "slot" : on ? col : LINE2);
    g.text(x + 176, 30, ROUTE[r], t === pre + "route" ? "slot" : on ? TEXT : FAINT, -1);
    g.text(x + 176, 46, r ? Math.round(s * 100) + "%" : "", t === pre + "send" ? "slot" : DIM, -1);
    // its keys on a keyboard of 128
    var lo = num(v, pre + "key_lo", 0), hi = num(v, pre + "key_hi", 127), kx = x, kw = 220, kh = hotIn(t, [pre + "key_lo", pre + "key_hi"]);
    g.fill(kx, 60, kw, 4, LINE);
    for (var o = 0; o <= 10; o++) g.fill(kx + kw * o * 12 / 127, 65, 1, 3, LINE2);
    if (on) g.fill(kx + kw * lo / 127, 60, Math.max(2, kw * (hi - lo) / 127), 4, kh ? "slot" : col);
    g.text(kx, 80, lo <= 0 && hi >= 127 ? "EVERY KEY" : noteName(lo) + " TO " + noteName(hi), kh ? "slot" : on ? DIM : FAINT, -1);
    if (vs) for (var d = 0; d < 4; d++) g.fill(x + 24 + g.measure(!on ? "OFF" : me ? "EDITING" : "ON") + 8 + d * 6, 22, 4, 7, vs[i] > d ? col : LINE2);
  }
}
push.compartment({
  id: "layers", label: "Layers",
  pages: [
    { label: "Layers", keys: ["layer_count", "layer_mode", "edit_layer", "voices", "master_vol", "bend_range", "mpe", "flavour_global"] },
    { label: "Edit Layer", keys: ["edit_layer", "on", "vol", "route", "send", "key_lo", "key_hi", "midi_ch"] }
  ],
  extra_keys: LAYER_KEYS,
  live_keys: ["rui_live"],
  screen: layersScreen
});

push.compartment({
  id: "tools", label: "Tools",
  pages: [{ label: "Tools", keys: ["preset", "pb_index", "init_layer", "randomize", "rand_amt", "patch_gain", "preset_count", "pb_count"] }]
});

// ---- Amino's envelope times: 20 x^3 s each stage (util.h am_env_time) --------------------------------------------
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    return /(^|_)e[1-4]_[adr]$/.test(s.key) ? envS(s.raw) : null;
  });
});
