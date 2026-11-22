// OB-Xd (an emulation of the Oberheim OB-X) on Push.
// An overlay shipped with Pung (OB-Xd itself ships no push_ui.js).
//
// The OB-X is a long black panel of knob rows, cut into sections by its
// legends: CONTROL, MODULATION, OSCILLATORS, FILTER, the two envelopes; push
// buttons with red LEDs choose waves and routes. The compartments are those
// sections, in the panel's order, and each screen shows what its knobs do
// together:
//
//   PANEL        the whole instrument at a glance, every knob where the panel
//                has it, standing where the sound has it; both envelopes and
//                the filter as Pung draws them (live while notes play). The
//                encoders' knobs are the ones whose legends are lit.
//   CONTROL      the eight voice boards: how many play, how a key takes them
//                (one each, or all of them in unison), each one's pan
//   MODULATION   who moves what: the LFO through its two depths (frequency,
//                pulse width) to the destinations its buttons select, the
//                filter envelope to pitch and pulse width, the wheel's vibrato
//   OSCILLATORS  both waveforms as they are (saw, pulse, both, or the
//                triangle when neither is on; the width; the interval; sync;
//                cross modulation) and the mixer
//   FILTER       the response of the mode the multimode knob reaches (LP to
//                notch or band pass to HP at 12 dB; 24 down to 6 dB with four
//                poles), where the envelope takes the cutoff, and the envelope
//   LOUDNESS     Pung's envelope (the default view)
//
// What a value means comes from OB-Xd's engine (SynthEngine.h, AdsrEnvelope.h,
// Filter.h, ObxdVoice.h): envelope times, LFO and vibrato rates, the detune,
// the pitch offsets and the filter modes are its own formulas.

// ---- values ----------------------------------------------------------------------------

function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function p01(v, k, d) { return known(v, k) ? raw(v, k, 0) / 100 : d; } // a 0..100 knob as the engine's 0..1
function on(v, k) { return known(v, k) && raw(v, k, 0) >= 0.5; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }

// SynthEngine.h's scale
function logsc(p, lo, hi, roll) { roll = roll || 19; return ((Math.exp(p * Math.log(roll + 1)) - 1) / roll) * (hi - lo) + lo; }
function signed(n) { return (n > 0 ? "+" : "") + n; }

// stage times in ms, as the engine sets them
var ENV_MS = {
  attack: [4, 60000], decay: [4, 60000], release: [8, 60000],
  f_attack: [1, 60000], f_decay: [1, 60000], f_release: [1, 60000]
};
function envMs(k, p) { var r = ENV_MS[k]; return logsc(p, r[0], r[1], 900); }
// osc pitch: 0..48 semitones (param * 48); shown from the knob's middle
function semis(p) { return Math.round(p * 48 - 24); }
var LEGATO = ["Legato", "Amp Retrig", "Flt Retrig", "Retrig"]; // bit 0 amp, bit 1 filter envelope
var TOGGLES = { unison: 1, as_played: 1, osc1_saw: 1, osc1_pulse: 1, osc2_saw: 1, osc2_pulse: 1, osc2_sync: 1,
  osc_quantize: 1, pw_env_both: 1, bandpass: 1, fourpole: 1, self_osc: 1, fenv_inv: 1, lfo_sin: 1, lfo_square: 1,
  lfo_sh: 1, lfo_sync: 1, lfo_osc1: 1, lfo_osc2: 1, lfo_filter: 1, lfo_pw1: 1, lfo_pw2: 1, env_pitch_both: 1, bend_osc2: 1 };

// a value in the engine's own units where it has them: [number, unit] or a
// word (null: the module's own number). Pung's pages, the row under a band
// screen and the panels all read them so (push.display).
function fmt(k, r) {
  var p = r / 100;
  if (TOGGLES[k]) return r >= 0.5 ? "On" : "Off";
  if (ENV_MS[k]) { var t = envMs(k, p); return t < 1000 ? [Math.round(t), "ms"] : [t < 10000 ? (t / 1000).toFixed(1) : Math.round(t / 1000), "s"]; }
  if (/^pan_/.test(k)) { var d = Math.round(r - 50); return d === 0 ? "C" : (d < 0 ? "L" + (-d) : "R" + d); }
  switch (k) {
  case "lfo_rate": return hz(logsc(p, 0, 50, 120));
  case "vibrato": return hz(logsc(p, 3, 10));
  case "osc1_pitch": case "osc2_pitch": return [signed(semis(p)), "st"];
  case "osc2_detune": return [Math.round(logsc(p, 0.001, 0.6) * 100), "ct"];
  case "unison_det": return [Math.round(logsc(p, 0.001, 0.9) * 100), "ct"];
  case "legato": return LEGATO[Math.max(0, Math.min(3, Math.round(r)))];
  case "bend_range": return [r >= 0.5 ? 12 : 2, "st"];
  case "octave": case "octave_transpose": return signed(Math.round(r));
  case "tune": return signed(Math.round(r - 50));
  }
  return null;
}
function hz(f) { return [f < 1 ? f.toFixed(2) : f < 10 ? f.toFixed(1) : Math.round(f), "Hz"]; }
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmt(key, n);
  if (f === null) return;
  return typeof f === "string" ? f : { value: String(f[0]), unit: f[1] };
});
// the same, as the panels print it (capitals, the unit after a space)
function valueOf(v, k) {
  if (!known(v, k)) return "--";
  var f = fmt(k, raw(v, k, 0));
  if (f === null) return txt(v, k);
  return (typeof f === "string" ? f : f[0] + " " + f[1]).toUpperCase();
}

// ---- the panel's colours -----------------------------------------------------------------
// black, silver legends and skirts, and the era's blue and red rules: blue
// over what moves (control, modulation, envelopes), red over the sound's
// own path (oscillators, filter). The filter envelope is drawn red, as the
// filter it moves; the loudness envelope blue.
var BLACK = "#0b0c0e", ROW = "#151619", SILVER = "#c3c7cc", LEG = "#8d939b", RULE = "#3a3d43";
var SKIRT = "#9fa4aa", CAP = "#18191c", INK = "#ffffff";
var BLUE = "#3f82dc", RED = "#d8382c", LED_ON = "#ff4433", LED_OFF = "#43120f";

var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5; // a knob: from 7 o'clock, three quarters round

function knobBody(g, x, y, r) { g.dot(x, y, r, SKIRT); g.dot(x, y, r * 0.74, CAP); }
function pointer(g, x, y, r, f, col) {
  var a = A0 + f * SWEEP;
  g.line(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15, x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95, 2, col);
}
function led(g, x, y, lit, s, legend) {
  g.dot(x, y, 2.5, lit ? LED_ON : LED_OFF);
  if (s) g.text(x + 6, y + 4, s, legend || (lit ? INK : LEG), -1);
}
// a section's legend: its name between two rules in its colour
function legend(g, x, w, y, name, col, ink) {
  var tw = g.measure(name), cx = x + w / 2;
  g.text(cx, y + 4, name, ink || SILVER, 0);
  g.fill(x + 4, y - 1, cx - tw / 2 - 8 - x - 4, 2, col);
  g.fill(cx + tw / 2 + 8, y - 1, x + w - 4 - (cx + tw / 2 + 8), 2, col);
}

// ---- PANEL ---------------------------------------------------------------------------------
// [key, x, y, legend]
var KNOBS = [
  ["portamento", 26, 48, "PORTA"], ["unison_det", 70, 48, "SPREAD"],
  ["lfo_rate", 122, 48, "RATE"], ["lfo_amt1", 122, 82, "FREQ"], ["lfo_amt2", 216, 82, "PW"],
  ["osc1_pitch", 280, 48, "OSC 1"], ["osc2_pitch", 326, 48, "OSC 2"], ["osc2_detune", 372, 48, "DETUNE"],
  ["pw", 418, 48, "PW"], ["xmod", 462, 48, "X-MOD"], ["brightness", 508, 48, "BRIGHT"],
  ["osc1_mix", 424, 82, "MIX 1"], ["osc2_mix", 466, 82, "MIX 2"], ["noise", 508, 82, "NOISE"],
  ["cutoff", 566, 48, "CUTOFF"], ["resonance", 610, 48, "RES"], ["filter_env", 654, 48, "ENV"], ["key_follow", 698, 48, "KEY"]
];
var KR = 9.5;
// [key, x, y, legend]: the push buttons and their LEDs
var LEDS = [
  ["unison", 12, 80, "UNISON"],
  ["lfo_sin", 144, 44, "SIN"], ["lfo_square", 196, 44, "SQR"], ["lfo_sh", 144, 60, "S&H"], ["lfo_sync", 196, 60, "SYNC"],
  ["lfo_osc1", 142, 78, "O1"], ["lfo_osc2", 142, 94, "O2"], ["lfo_filter", 172, 78, "FLT"], ["lfo_pw1", 232, 78, "1"], ["lfo_pw2", 232, 94, "2"],
  ["osc1_saw", 266, 78, "SAW"], ["osc1_pulse", 266, 94, "PULSE"], ["osc2_saw", 312, 78, "SAW"], ["osc2_pulse", 312, 94, "PULSE"],
  ["osc2_sync", 358, 78, "SYNC"], ["osc_quantize", 358, 94, "STEP"]
];
var SECTIONS = [[4, 92, "CONTROL", BLUE], [100, 152, "MODULATION", BLUE], [256, 284, "OSCILLATORS", RED],
  [544, 180, "FILTER", RED], [728, 228, "ENVELOPES", BLUE]];

// the panel's ground; seg: segment mode, the encoder row ends at y 142 (Pung
// names the segments under it)
function panelGround(g, seg) {
  g.fill(0, 0, 960, 160, BLACK);
  g.value(8, 17, "OB-Xd", INK, -1);
  g.fill(62, 3, 34, 15, "#000000"); // the program display
  for (var s = 0; s < SECTIONS.length; s++) {
    var S = SECTIONS[s];
    legend(g, S[0], S[1], 27, S[2], S[3]);
    if (s > 0) g.fill(S[0] - 2, 34, 1, 68, RULE);
  }
  for (var i = 0; i < KNOBS.length; i++) {
    var k = KNOBS[i];
    knobBody(g, k[1], k[2], KR);
    g.text(k[1], k[2] + 20, k[3], LEG, 0);
  }
  for (i = 0; i < LEDS.length; i++) g.text(LEDS[i][1] + 6, LEDS[i][2] + 4, LEDS[i][3], LEG, -1);
  g.text(22, 100, "VOICES", LEG, -1);
  g.text(734, 54, "FILT", LEG, -1);
  g.text(734, 90, "AMP", LEG, -1);
  // the encoder row
  g.fill(0, 104, 960, 56, ROW);
  g.fill(0, 104, 960, 1, RULE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 28 : 44, RULE);
  for (c = 0; c < 8; c++) knobBody(g, c * 120 + 26, seg ? ROW_Y_SEG : ROW_Y, seg ? 11 : 14);
}
var ROW_Y = 133, ROW_Y_SEG = 124;

// the OB-Xd's filter as Pung's filter names it: 2 poles morph LP > notch >
// HP (or LP > BP > HP with the band-pass switch); 4 poles morph 24 > 6 dB LP
function filterMode(v) {
  var mm = fr(v, "multimode", 0);
  if (on(v, "fourpole")) {
    var db = 24 - 6 * Math.round(mm * 3);
    return { type: "LP " + db + " dB", name: "LP " + db + " DB" };
  }
  var bp = on(v, "bandpass");
  if (mm < 0.25) return { type: "LP 12 dB", name: "LP 12 DB" };
  if (mm > 0.75) return { type: "HP 12 dB", name: "HP 12 DB" };
  return bp ? { type: "BandPass", name: "BP 12 DB" } : { type: "Notch", name: "NOTCH" };
}

function panel(g, v) {
  var t = v.$touched || "", kn = v.$knobs || [], held = {}, i;
  for (i = 0; i < kn.length; i++) if (kn[i]) held[kn[i]] = 1;
  // segment mode: Pung's bar marks the segment; the panel lights its section's legend
  var segOn = !!v.$segmode, act = null, segs = v.$segments || [];
  if (v.$segmode === "segment") for (i = 0; i < segs.length; i++) if (segs[i].id === v.$segment) act = segs[i];
  var R = act ? act.rect : null, litSec = -1;
  g.layer("panel|" + (segOn ? "seg" : ""), function () { panelGround(g, segOn); });
  if (R) for (i = 0; i < SECTIONS.length; i++) {
    var S = SECTIONS[i];
    if (R[0] < S[0] + S[1] && R[0] + R[2] > S[0]) { litSec = i; if (S[2] !== "FILTER") { g.fill(S[0], 22, S[1], 11, BLACK); legend(g, S[0], S[1], 27, S[2], S[3], "slot"); } }
  }
  // knobs: pointers, the touched one ringed, the encoders' legends lit
  for (i = 0; i < KNOBS.length; i++) {
    var k = KNOBS[i], key = k[0], ok = known(v, key);
    if (key === t) g.arc(k[1], k[2], KR + 3, 0, Math.PI * 2, 2, "slot");
    pointer(g, k[1], k[2], KR * 0.74, ok ? fr(v, key, 0) : 0.5, ok ? INK : LEG);
    if (held[key]) g.text(k[1], k[2] + 20, k[3], key === t ? "slot" : INK, 0);
  }
  // the program, its name and bank
  var pr = known(v, "preset") ? Math.round(raw(v, "preset", 0)) + 1 : 0;
  g.value(79, 17, pr ? (pr < 10 ? "0" : "") + pr : "--", LED_ON, 0);
  var name = txt(v, "preset_name").toUpperCase();
  g.text(104, 15, name, SILVER, -1, 330);
  var nw = Math.min(330, g.measure(name));
  if (txt(v, "bank_name")) g.text(104 + nw + 14, 15, txt(v, "bank_name").toUpperCase(), LEG, -1, 160);
  var ps = v.$pages || [];
  // with segments on, the segment row says where the hands are
  if (!segOn && ps.length > 1) g.text(952, 15, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);

  // the push buttons: LEDs, the lit ones' legends white
  for (i = 0; i < LEDS.length; i++) {
    var L = LEDS[i], lt = on(v, L[0]), lh = L[0] === t;
    g.dot(L[1], L[2], 2.5, lt ? LED_ON : LED_OFF);
    if (lh || held[L[0]] || lt) g.text(L[1] + 6, L[2] + 4, L[3], lh ? "slot" : INK, -1);
  }
  var vc = known(v, "voice_count") ? String(Math.round(raw(v, "voice_count", 8))) : "-";
  g.text(12, 100, vc, LED_ON, -1);
  // FILTER: the response, its mode named on the legend's rule
  var fm = filterMode(v);
  g.filter(548, 70, 172, 34, { cutoff: "cutoff", resonance: "resonance", type: fm.type, color: RED });
  // its legend names the mode the multimode knob and the switches reach
  g.fill(544, 21, 180, 12, BLACK);
  legend(g, 544, 180, 27, "FILTER " + fm.name + (on(v, "self_osc") ? " SELF" : ""), RED, litSec === 3 ? "slot" : null);
  // ENVELOPES: Pung's, live while notes play
  g.envelope(762, 34, 192, 34, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", color: RED });
  g.envelope(762, 70, 192, 34, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", color: BLUE });
  if (on(v, "fenv_inv")) { g.fill(732, 58, 26, 10, BLACK); g.text(734, 66, "INV", LED_ON, -1); }

  // the encoder row: each encoder an OB-X knob, its name and its value (above
  // y 142 while segments are on: Pung names them under it)
  var ry = segOn ? ROW_Y_SEG : ROW_Y, kr = segOn ? 11 : 14;
  for (var c = 0; c < 8; c++) {
    var key2 = kn[c] || "", x = c * 120, hot = key2 !== "" && key2 === t, cx = x + 26;
    if (!key2) { g.fill(x + 4, 108, 112, segOn ? 32 : 50, ROW); continue; } // no encoder here: no knob
    var ok2 = known(v, key2), f = fr(v, key2, 0.5);
    g.arc(cx, ry, kr + 4, A0, SWEEP, 2, RULE);
    if (ok2) g.arc(cx, ry, kr + 4, A0, Math.max(0.02, f) * SWEEP, 2, hot ? "slot" : BLUE);
    pointer(g, cx, ry, kr * 0.74, ok2 ? f : 0.5, hot ? "slot" : INK);
    g.text(x + 50, segOn ? 119 : 124, short(v, key2), hot ? "slot" : LEG, -1, 66);
    g.value(x + 50, segOn ? 138 : 148, valueOf(v, key2), hot ? "slot" : INK, -1, 66);
  }
}

// the panel's names for the knobs an encoder may hold
var NAMES = { cutoff: "CUTOFF", resonance: "RESONANCE", filter_env: "ENV AMT", osc2_detune: "DETUNE",
  attack: "ATTACK", decay: "DECAY", sustain: "SUSTAIN", release: "RELEASE", osc2_pitch: "OSC 2", pw: "PULSE W",
  xmod: "X-MOD", lfo_rate: "LFO RATE", lfo_amt1: "LFO FREQ", lfo_amt2: "LFO PW", portamento: "PORTA",
  unison_det: "SPREAD", osc1_pitch: "OSC 1", noise: "NOISE", key_follow: "KEY", brightness: "BRIGHT" };
function short(v, k) { return NAMES[k] || (v[k] && v[k].name ? String(v[k].name).toUpperCase() : k.toUpperCase()); }

push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true,
  // the OB-X's sections (the two crowded ones by their rows), each under the hands
  segments: [
    { id: "control", label: "Control", rect: [4, 22, 92, 82], keys: ["portamento", "unison_det", "unison", "voice_count", "legato", "octave", "tune", "volume"] },
    { id: "lfo", label: "LFO", rect: [100, 22, 152, 48], keys: ["lfo_rate", "lfo_sin", "lfo_square", "lfo_sh", "lfo_sync"] },
    { id: "depth", label: "LFO Depth", rect: [100, 72, 152, 32], keys: ["lfo_amt1", "lfo_osc1", "lfo_osc2", "lfo_filter", "lfo_amt2", "lfo_pw1", "lfo_pw2"] },
    { id: "osc", label: "Oscillators", rect: [256, 22, 284, 48], keys: ["osc1_pitch", "osc2_pitch", "osc2_detune", "pw", "xmod", "brightness", "osc_quantize"] },
    { id: "waves", label: "Waves & Mix", rect: [256, 72, 284, 32], keys: ["osc1_saw", "osc1_pulse", "osc2_saw", "osc2_pulse", "osc2_sync", "osc1_mix", "osc2_mix", "noise"] },
    { id: "filter", label: "Filter", rect: [544, 22, 180, 82], keys: ["cutoff", "resonance", "filter_env", "key_follow", "multimode", "fourpole", "bandpass", "self_osc"] },
    { id: "env", label: "Envelopes", rect: [728, 22, 228, 82], keys: ["f_attack", "f_decay", "f_sustain", "f_release", "attack", "decay", "sustain", "release"] }
  ],
  pages: [
    { label: "Panel", keys: ["cutoff", "resonance", "filter_env", "osc2_detune", "attack", "decay", "sustain", "release"] },
    { label: "Sound", keys: ["osc2_pitch", "pw", "xmod", "noise", "lfo_rate", "lfo_amt1", "lfo_amt2", "portamento"] }
  ],
  extra_keys: ["preset", "preset_name", "bank_name", "unison", "unison_det", "voice_count", "lfo_sin", "lfo_square", "lfo_sh",
    "lfo_sync", "lfo_osc1", "lfo_osc2", "lfo_filter", "lfo_pw1", "lfo_pw2", "osc1_pitch", "osc1_saw", "osc1_pulse",
    "osc2_saw", "osc2_pulse", "osc2_sync", "osc_quantize", "brightness", "osc1_mix", "osc2_mix", "key_follow",
    "multimode", "bandpass", "fourpole", "self_osc", "fenv_inv", "f_attack", "f_decay", "f_sustain", "f_release"],
  screen: panel
});

// ---- the band screens: the panel's black, a section's legend ----------------------------------
function band(g, key) { g.layer(key, function () { g.fill(0, 0, g.w, g.h, BLACK); }); }
function title(g, x, w, name, col) { legend(g, x, w, 6, name, col); }

// ---- CONTROL: the eight voice boards ---------------------------------------------------------
function voicesScreen(g, v) {
  band(g, "voices");
  var t = v.$touched || "", n = Math.round(raw(v, "voice_count", 8)), uni = on(v, "unison"), ok = known(v, "voice_count");
  // how a key takes the voices, in words, over the boards
  var lg = Math.max(0, Math.min(3, Math.round(raw(v, "legato", 0))));
  var how = !ok ? "--" : uni ? "UNISON: ALL " + n + " VOICES ON EVERY KEY, SPREAD " + valueOf(v, "unison_det")
    : n === 1 ? "ONE VOICE: ONE NOTE AT A TIME" : n + " VOICES, ONE A KEY";
  g.text(6, 11, how, uni ? LED_ON : SILVER, -1, 560);
  var re = ["A TAKEN VOICE KEEPS BOTH ENVELOPES", "A TAKEN VOICE RESTARTS THE AMP ENV", "A TAKEN VOICE RESTARTS THE FILTER ENV", "A TAKEN VOICE RESTARTS BOTH ENVELOPES"][lg];
  g.text(946, 11, known(v, "legato") ? re : "", LEG, 1, 380);
  for (var i = 0; i < 8; i++) {
    var x = i * 120 + 4, w = 110, y = 18, h = 66, lit = ok && i < n, pk = "pan_" + (i + 1), hot = t === pk;
    g.fill(x, y, w, h, lit ? "#16181c" : "#0f1012");
    g.fill(x, y, w, 2, hot ? "slot" : lit ? (uni ? RED : BLUE) : RULE);
    led(g, x + 10, y + 13, lit, "", null);
    g.text(x + 18, y + 17, "VOICE " + (i + 1), lit ? SILVER : RULE, -1);
    // its pan: a dot on the stereo line
    var px = fr(v, pk, 0.5), lx = x + 12, lw = w - 24, ly = y + 40;
    g.fill(lx, ly, lw, 2, lit ? RULE : "#1c1d20");
    g.fill(lx + lw / 2, ly - 4, 1, 10, lit ? LEG : RULE);
    g.text(lx - 6, ly + 4, "L", RULE, 0); g.text(lx + lw + 6, ly + 4, "R", RULE, 0);
    if (known(v, pk)) g.dot(lx + lw * px, ly + 1, hot ? 5 : 4, hot ? "slot" : lit ? INK : RULE);
    g.text(x + w / 2, y + 60, known(v, pk) ? valueOf(v, pk) : "--", hot ? "slot" : lit ? LEG : RULE, 0);
  }
}

push.compartment({
  id: "control", label: "Control",
  pages: [
    { label: "Voices", keys: ["voice_count", "unison", "unison_det", "legato", "portamento", "as_played", "octave", "tune"], screen: voicesScreen },
    { label: "Pan", keys: ["pan_1", "pan_2", "pan_3", "pan_4", "pan_5", "pan_6", "pan_7", "pan_8"], screen: voicesScreen },
    { label: "Drift", keys: ["filter_var", "env_var", "level_var", "porta_var"] },
    { label: "Master", keys: ["volume", "octave_transpose", "bend_range", "bend_osc2"] }
  ],
  extra_keys: ["voice_count", "unison", "unison_det", "legato", "portamento", "pan_1", "pan_2", "pan_3", "pan_4", "pan_5", "pan_6", "pan_7", "pan_8"]
});

// ---- MODULATION: who moves what -----------------------------------------------------------------
// The OB-X's modulation section: one LFO through two depths, FREQUENCY and
// PULSE WIDTH, each to the destinations its buttons select. Beside it the
// filter envelope's reach into pitch and pulse width, and the wheel's vibrato.
var DEST = [["osc1", "OSC 1 PITCH"], ["osc2", "OSC 2 PITCH"], ["filter", "FILTER"], ["pw1", "OSC 1 PW"], ["pw2", "OSC 2 PW"]];
function lfoShapeName(v) {
  var s = on(v, "lfo_sin"), q = on(v, "lfo_square"), h = on(v, "lfo_sh");
  if (s + q + h !== 1) return null; // none, or a sum Pung has no picture for
  return s ? "Sine" : q ? "Square" : "S&H";
}
// LFO depth 1 in semitones (lfoa1 = logsc(logsc(p, 0, 1, 60), 0, 60, 10))
function lfoSemis(p) { return logsc(logsc(p, 0, 1, 60), 0, 60, 10); }
function stTxt(s) { return s < 1 ? Math.round(s * 100) + " CT" : (s < 10 ? s.toFixed(1) : String(Math.round(s))) + " ST"; }
push.compartment({
  id: "mod", label: "Modulation",
  pages: [
    { label: "LFO", keys: ["lfo_rate", "lfo_sin", "lfo_square", "lfo_sh", "lfo_sync", "lfo_amt1", "lfo_amt2"] },
    { label: "LFO Routes", keys: ["lfo_osc1", "lfo_osc2", "lfo_filter", "lfo_pw1", "lfo_pw2"] },
    { label: "Env & Wheel", keys: ["env_pitch", "env_pitch_both", "pw_env", "pw_env_both", "vibrato"] }
  ],
  extra_keys: ["f_attack", "f_decay", "f_sustain", "f_release"],
  screen: function (g, v) {
    band(g, "mod");
    var t = v.$touched || "";
    var DY = [10, 27, 44, 61, 78], DX = 790, lit = [0, 0, 0, 0, 0];
    // a route: from a depth's end to a destination, as thick as the depth
    function route(y0, d, amt, col) {
      lit[d] = 1;
      g.poly([466, y0, 520, y0, DX - 90, DY[d] - 4, DX - 10, DY[d] - 4], 1.2 + amt * 3.5, col);
    }
    function depth(y, name, a, key, amount, col) {
      var hot = t === key;
      g.text(290, y + 4, name, hot ? "slot" : LEG, -1);
      g.text(372, y + 4, amount, hot ? "slot" : (a > 0 ? INK : LEG), 1);
      g.fill(380, y - 1, 82, 3, RULE);
      if (a > 0) g.fill(380, y - 1, Math.max(2, Math.round(82 * a)), 3, hot ? "slot" : col);
    }
    // the LFO
    var lh = /^lfo_/.test(t), shape = lfoShapeName(v);
    g.text(6, 16, "LFO", lh ? "slot" : SILVER, -1);
    if (shape) g.lfo(48, -2, 168, 32, { shape: shape, rate: "lfo_rate", trig: on(v, "lfo_sync"), color: BLUE });
    else g.text(132, 18, !known(v, "lfo_sin") ? "--" : on(v, "lfo_sin") || on(v, "lfo_square") || on(v, "lfo_sh") ? "WAVES SUMMED" : "NO WAVE ON", LEG, 0);
    g.text(226, 12, valueOf(v, "lfo_rate"), t === "lfo_rate" ? "slot" : INK, -1);
    g.text(226, 26, on(v, "lfo_sync") ? "KEY SYNC" : "FREE RUN", t === "lfo_sync" ? "slot" : LEG, -1);
    var a1 = p01(v, "lfo_amt1", 0), a2 = p01(v, "lfo_amt2", 0);
    depth(10, "FREQ", a1, "lfo_amt1", stTxt(lfoSemis(a1)), BLUE);
    depth(24, "PW", a2, "lfo_amt2", Math.round(a2 * 70) + "%", BLUE);
    function rc(k) { return t === k ? "slot" : BLUE; }
    if (a1 > 0) {
      if (on(v, "lfo_osc1")) route(10, 0, a1, rc("lfo_osc1"));
      if (on(v, "lfo_osc2")) route(10, 1, a1, rc("lfo_osc2"));
      if (on(v, "lfo_filter")) route(10, 2, a1, rc("lfo_filter"));
    }
    if (a2 > 0) {
      if (on(v, "lfo_pw1")) route(24, 3, a2, rc("lfo_pw1"));
      if (on(v, "lfo_pw2")) route(24, 4, a2, rc("lfo_pw2"));
    }
    // the filter envelope: osc 2's pitch and width, and osc 1's with BOTH
    var eh = /^(env_pitch|pw_env)/.test(t);
    g.text(6, 48, "F.ENV", eh ? "slot" : SILVER, -1);
    g.envelope(48, 33, 168, 26, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", color: RED });
    var ep = p01(v, "env_pitch", 0), pe = p01(v, "pw_env", 0);
    depth(42, "PITCH", ep, "env_pitch", Math.round(ep * 36) + " ST", RED);
    depth(56, "PW", pe, "pw_env", Math.round(pe * 85) + "%", RED);
    function ec(k, both) { return t === k || t === both ? "slot" : RED; }
    if (ep > 0) { route(42, 1, ep, ec("env_pitch", "env_pitch_both")); if (on(v, "env_pitch_both")) route(42, 0, ep, ec("env_pitch", "env_pitch_both")); }
    if (pe > 0) { route(56, 4, pe, ec("pw_env", "pw_env_both")); if (on(v, "pw_env_both")) route(56, 3, pe, ec("pw_env", "pw_env_both")); }
    g.text(226, 48, ep > 0 || pe > 0 ? (on(v, "env_pitch_both") || on(v, "pw_env_both") ? "BOTH OSCS" : "OSC 2") : "", LEG, -1);
    // the wheel: vibrato into both pitches, as deep as the wheel is up
    var vh = t === "vibrato";
    g.text(6, 80, "WHEEL", vh ? "slot" : SILVER, -1);
    g.text(48, 80, "VIBRATO AT " + valueOf(v, "vibrato"), vh ? "slot" : LEG, -1);
    g.text(290, 80, "DEPTH: THE WHEEL", LEG, -1);
    g.poly([466, 76, 520, 76, DX - 90, DY[0] - 2, DX - 10, DY[0] - 2], 1, vh ? "slot" : RULE);
    g.poly([466, 76, 520, 76, DX - 90, DY[1] - 2, DX - 10, DY[1] - 2], 1, vh ? "slot" : RULE);
    // the destinations
    for (var d = 0; d < DEST.length; d++) {
      var dh = t === "lfo_" + DEST[d][0];
      g.dot(DX - 6, DY[d] - 4, 3, lit[d] ? INK : RULE);
      g.text(DX + 2, DY[d], DEST[d][1], dh ? "slot" : lit[d] ? INK : LEG, -1);
    }
  }
});

// ---- OSCILLATORS --------------------------------------------------------------------------------
// one sample of an OB-Xd oscillator, ph in cycles: saw, pulse or both summed;
// neither is a triangle (the engine's own fallback)
function oscAt(saw, pul, ph, duty) {
  var p = ph - Math.floor(ph), s = 0, n = 0;
  if (saw) { s += 1 - 2 * p; n++; }
  if (pul) { s += p < duty ? 1 : -1; n++; }
  if (!n) return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  return s / n;
}
// the pulse's high part: square at 0, narrow toward 0.95 (pulseWidth = 0..0.95)
function duty(w) { return 0.5 * (1 - Math.min(0.95, w)); }
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 64) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
function wavePts(x, y, w, h, fn) {
  var pts = [], mid = y + h / 2, a = h / 2 - 2, prev = null;
  for (var px = 0; px <= w; px += 2) {
    var yy = mid - fn(px / w) * a;
    if (prev !== null && Math.abs(yy - prev) > a * 0.5) pts.push(x + px, prev); // an edge stands straight
    pts.push(x + px, yy); prev = yy;
  }
  return pts;
}
// the mixer page: Pung's mixer over its three encoders, and what leaves the
// oscillators: both waves at their levels, the noise a band around them
function rnd(i) { var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
function mixerScreen(g, v) {
  band(g, "mixer");
  var t = v.$touched || "";
  title(g, 0, 356, "MIXER", RED);
  g.mix(0, 12, 356, 74, ["osc1_mix", "osc2_mix", "noise"], { color: RED });
  var s1 = on(v, "osc1_saw"), q1 = on(v, "osc1_pulse"), s2 = on(v, "osc2_saw"), q2 = on(v, "osc2_pulse");
  var pw = p01(v, "pw", 0), d1 = duty(pw * 0.95), d2 = duty(pw * 0.95 + p01(v, "pw_ofs", 0) * 0.75);
  var st = (raw(v, "osc2_pitch", 50) - raw(v, "osc1_pitch", 50)) * 0.48, sync = on(v, "osc2_sync");
  var ratio = Math.pow(2, Math.max(-24, Math.min(36, st)) / 12);
  var m1 = p01(v, "osc1_mix", 0), m2 = p01(v, "osc2_mix", 0), nz = logsc(p01(v, "noise", 0), 0, 1, 35);
  var x0 = 372, w = 572, y = 18, h = 64, mid = y + h / 2, cyc = 2, n = 143;
  title(g, 364, 588, "WHAT LEAVES THE OSCILLATORS", RED);
  g.fill(364, y, 588, h, "#121316");
  if (!(known(v, "osc1_mix") && known(v, "osc2_mix") && known(v, "osc1_saw"))) { g.text(x0 + w / 2, mid + 4, "--", LEG, 0); return; }
  var sig = [s1, q1, s2, q2, d1.toFixed(3), d2.toFixed(3), st.toFixed(2), sync, m1, m2, nz.toFixed(3)].join("|");
  var c = cached("mx|" + sig, function () {
    var ys = [], peak = 0, i;
    for (i = 0; i <= n; i++) {
      var p1 = i / n * cyc;
      var a = oscAt(s1, q1, p1, d1), b = oscAt(s2, q2, sync ? (p1 - Math.floor(p1)) * ratio : p1 * ratio, d2);
      ys.push(m1 * a + m2 * b); peak = Math.max(peak, Math.abs(m1 * a + m2 * b) + nz);
    }
    var amp = peak < 1e-3 ? 0 : (h / 2 - 3) / peak, pts = [], band = [];
    for (i = 0; i <= n; i++) {
      pts.push(x0 + w * i / n, mid - ys[i] * amp);
      band.push([mid - (ys[i] + nz * (0.5 + 0.5 * Math.abs(rnd(i)))) * amp, mid - (ys[i] - nz * (0.5 + 0.5 * Math.abs(rnd(i + 77)))) * amp]);
    }
    return { pts: pts, band: band, silent: peak < 1e-3 };
  });
  if (c.silent) { g.text(x0 + w / 2, mid + 4, "ALL LEVELS DOWN", LEG, 0); return; }
  if (nz > 0.002) for (var i = 0; i < n; i += 2) g.fill(x0 + w * i / n, c.band[i][0], w * 2 / n, c.band[i][1] - c.band[i][0], t === "noise" ? "slot" : "#3a3d43");
  g.poly(c.pts, 2, /_mix$/.test(t) ? "slot" : INK);
}

push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Osc 1 & 2", keys: ["osc1_saw", "osc1_pulse", "osc1_pitch", "osc2_saw", "osc2_pulse", "osc2_pitch", "osc2_detune", "osc2_sync"] },
    { label: "Common", keys: ["pw", "pw_ofs", "xmod", "brightness", "osc_quantize"] },
    { label: "Mixer", keys: ["osc1_mix", "osc2_mix", "noise"], screen: mixerScreen }
  ],
  extra_keys: ["osc1_saw", "osc1_pulse", "osc2_saw", "osc2_pulse", "osc1_pitch", "osc2_pitch", "osc2_sync", "pw", "pw_ofs"],
  screen: function (g, v) {
    band(g, "osc");
    var t = v.$touched || "";
    var s1 = on(v, "osc1_saw"), q1 = on(v, "osc1_pulse"), s2 = on(v, "osc2_saw"), q2 = on(v, "osc2_pulse");
    var pw = p01(v, "pw", 0), ofs = p01(v, "pw_ofs", 0) * 0.75, d1 = duty(pw * 0.95), d2 = duty(pw * 0.95 + ofs);
    var st = (raw(v, "osc2_pitch", 50) - raw(v, "osc1_pitch", 50)) * 0.48, sync = on(v, "osc2_sync");
    var ratio = Math.pow(2, Math.max(-24, Math.min(36, st)) / 12), xm = p01(v, "xmod", 0);
    var ok = known(v, "osc1_saw") && known(v, "osc2_saw");
    function name(saw, pul) { return !ok ? "--" : saw && pul ? "SAW + PULSE" : saw ? "SAW" : pul ? "PULSE" : "TRIANGLE"; }
    // OSC 1
    var b1 = 0, w1 = 300, y = 18, h = 64, cyc = 2;
    var hot1 = /^osc1_(saw|pulse|pitch)$/.test(t) || t === "pw";
    title(g, b1, w1, "OSC 1", RED);
    g.fill(b1 + 4, y, w1 - 8, h, "#121316");
    g.text(b1 + 10, y + 12, name(s1, q1), hot1 ? "slot" : SILVER, -1);
    g.text(b1 + w1 - 10, y + 12, valueOf(v, "osc1_pitch"), LEG, 1);
    var sig = [s1, q1, s2, q2, d1.toFixed(3), d2.toFixed(3), st.toFixed(2), sync].join("|");
    if (ok) g.poly(cached("o1|" + sig, function () { return wavePts(b1 + 10, y + 16, w1 - 20, h - 20, function (q) { return oscAt(s1, q1, q * cyc, d1); }); }), 2, hot1 ? "slot" : INK);
    // X-MOD: osc 1 bends osc 2's pitch
    var xh = t === "xmod";
    if (xm > 0.004) {
      g.poly([w1 - 2, 50, w1 + 22, 50], 1 + xm * 4, xh ? "slot" : RED);
      g.poly([w1 + 16, 44, w1 + 23, 50, w1 + 16, 56], 2, xh ? "slot" : RED);
    }
    g.text(w1 + 12, 72, xm > 0.004 ? "XMOD" : "", xh ? "slot" : LEG, 0);
    // OSC 2: its interval, its own width, sync to osc 1
    var b2 = 324, w2 = 330;
    var hot2 = /^osc2_/.test(t) || t === "pw_ofs" || t === "osc_quantize";
    title(g, b2, w2, "OSC 2", RED);
    g.fill(b2 + 4, y, w2 - 8, h, "#121316");
    var iv = Math.round(st);
    g.text(b2 + 10, y + 12, name(s2, q2) + (sync ? "  SYNC" : ""), hot2 ? "slot" : SILVER, -1);
    g.text(b2 + w2 - 10, y + 12, (iv > 0 ? "+" : "") + iv + " ST  " + valueOf(v, "osc2_detune") + (on(v, "osc_quantize") ? "  STEP" : ""), LEG, 1);
    if (ok) g.poly(cached("o2|" + sig, function () {
      return wavePts(b2 + 10, y + 16, w2 - 20, h - 20, function (q) {
        var p1 = q * cyc;
        return oscAt(s2, q2, sync ? (p1 - Math.floor(p1)) * ratio : p1 * ratio, d2);
      });
    }), 2, hot2 ? "slot" : INK);
    if (sync) for (var c = 1; c < cyc; c++) g.fill(b2 + 10 + (w2 - 20) * c / cyc, y + 18, 1, h - 22, RED);
    // the mixer: Pung's
    var bm = 678, wm = 274, mh = /_mix$|^noise$/.test(t);
    title(g, bm, wm, "MIXER", RED);
    var mw = wm - 96;
    g.mix(bm + 4, y - 2, mw, h - 10, ["osc1_mix", "osc2_mix", "noise"], { color: RED });
    g.text(bm + 4 + mw / 6, 84, "OSC 1", t === "osc1_mix" ? "slot" : LEG, 0);
    g.text(bm + 4 + mw / 2, 84, "OSC 2", t === "osc2_mix" ? "slot" : LEG, 0);
    g.text(bm + 4 + mw * 5 / 6, 84, "NOISE", t === "noise" ? "slot" : LEG, 0);
    // brightness: the low-pass every voice has before its filter (7 to 26 kHz)
    var bh = t === "brightness", bx = bm + wm - 4;
    g.text(bx, 30, "BRIGHT", bh ? "slot" : LEG, 1);
    g.value(bx, 52, known(v, "brightness") ? String(Math.round(7 + 19 * p01(v, "brightness", 1))) : "--", bh ? "slot" : INK, 1);
    g.text(bx, 66, "KHZ", LEG, 1);
    if (mh) g.fill(bm + 4, y + h - 1, mw, 2, "slot");
  }
});

// ---- FILTER ---------------------------------------------------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["cutoff", "resonance", "filter_env", "key_follow", "multimode", "bandpass", "fourpole", "self_osc"] },
    { label: "Filter Env", keys: ["f_attack", "f_decay", "f_sustain", "f_release", "vel_filter", "fenv_inv"] }
  ],
  screen: function (g, v) {
    band(g, "filter");
    var t = v.$touched || "", fm = filterMode(v), four = on(v, "fourpole"), bp = on(v, "bandpass");
    var half = 476;
    title(g, 0, half - 4, "FILTER  " + fm.name, RED);
    g.filter(2, 12, half - 8, 74, { cutoff: "cutoff", resonance: "resonance", type: fm.type, color: RED });
    // where the envelope takes the cutoff (down, inverted)
    var env = p01(v, "filter_env", 0), cut = fr(v, "cutoff", 0), inv = on(v, "fenv_inv");
    if (env > 0.004 && known(v, "cutoff")) {
      var x0 = 8 + (half - 20) * cut, reach = env * 140 / 120; // 140 semitones of a 120-semitone knob
      var x1 = 8 + (half - 20) * Math.max(0, Math.min(1, cut + (inv ? -reach : reach)));
      var ec = t === "filter_env" || t === "fenv_inv" ? "slot" : INK;
      g.fill(Math.min(x0, x1), 78, Math.max(2, Math.abs(x1 - x0)), 2, ec);
      g.poly([x1 + (inv ? 6 : -6), 74, x1, 79, x1 + (inv ? 6 : -6), 84], 2, ec);
    }
    // the multimode knob's travel, in the mode the switches set
    var mx = half + 6, mw = 150, my = 26, mm = fr(v, "multimode", 0), mh = t === "multimode" || t === "fourpole" || t === "bandpass";
    g.text(mx, 14, "MULTIMODE", mh ? "slot" : LEG, -1);
    var stops = four ? ["24", "18", "12", "6 DB"] : bp ? ["LP", "BP", "HP"] : ["LP", "NOTCH", "HP"];
    g.fill(mx, my + 6, mw, 2, RULE);
    for (var i = 0; i < stops.length; i++) {
      var sx = mx + mw * i / (stops.length - 1);
      g.fill(sx, my + 3, 1, 8, LEG);
      g.text(sx, my + 22, stops[i], LEG, i === 0 ? -1 : i === stops.length - 1 ? 1 : 0);
    }
    if (known(v, "multimode")) g.fill(mx + mw * mm - 3, my, 6, 14, mh ? "slot" : INK);
    var kf = p01(v, "key_follow", 0), kh = t === "key_follow";
    g.text(mx, 66, "KEY FOLLOW", kh ? "slot" : LEG, -1);
    g.fill(mx, 72, mw, 2, RULE); g.fill(mx, 72, Math.round(mw * kf), 2, kh ? "slot" : INK);
    g.text(mx, 84, on(v, "self_osc") ? "SELF OSC: RINGS AT CUTOFF" : "", LED_ON, -1, mw + 10);
    // the filter envelope, Pung's
    var ex = half + 170, ew = g.w - ex;
    title(g, ex, ew, inv ? "FILTER ENV  INVERTED" : "FILTER ENV", RED);
    g.envelope(ex, 12, ew, 74, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", labels: true, color: RED });
    var vf = p01(v, "vel_filter", 0);
    if (vf > 0.004) g.text(g.w - 6, 24, "VEL " + Math.round(vf * 100), t === "vel_filter" ? "slot" : LEG, 1);
  }
});

// ---- LOUDNESS: Pung's envelope, as on every module ----------------------------------------------------
push.compartment({
  id: "loudness", label: "Loudness",
  pages: [{ label: "Loudness", keys: ["attack", "decay", "sustain", "release", "vel_amp"] }]
});

// ---- the engine's envelope times (AdsrEnvelope.h) -----------------------------------------------------
// A stage knob sets a time T (logsc, in ms). The attack climbs toward 1.3 and
// ends at 0.9: 0.32 T. The decay falls from 0.9 to the sustain in about T (to -60 dB,
// 0.75 T, with none). The release falls to -100 dB in T: to -60 dB, 0.6 T.
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.raw === null || s.raw === undefined || !ENV_MS[s.key]) return null;
    var T = envMs(s.key, s.raw / 100) / 1000;
    if (s.role === "attack") return 0.32 * T;
    if (s.role === "release") return 0.6 * T;
    if (s.role === "decay") {
      var sus = s.level === null || s.level === undefined ? 0 : Math.min(0.99, s.level / 100);
      return sus > 0.001 ? Math.max(0, T * Math.log(sus / 0.9) / Math.log(sus + 0.0001)) : 0.75 * T;
    }
    return null;
  });
});
