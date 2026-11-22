// Hera (an emulation of the Roland Juno-60) on Push.
// An overlay shipped with Pung (Hera ships no push_ui.js).
//
// The Juno-60 is a row of faders under coloured section strips, read left to
// right as the sound flows: LFO, DCO, HPF, VCF, VCA, ENV, CHORUS, with a few
// toggle switches between them. The compartments are those sections, and the
// encoders are drawn as the faders they are:
//
//   PANEL   every fader and switch where the Juno has it, standing where the
//           sound has it; the faders the encoders hold are lit
//   LFO     its wave and rate, its delay and fade-in, and where it goes (DCO
//           pitch, the pulse width, the VCF): the Juno has one LFO for all
//   DCO     the footage, the pulse width and what moves it, and the wave the
//           DCO puts out: pulse, saw, sub an octave down and noise, summed at
//           their levels, over their own faders
//   HPF/VCF the 24 dB low pass and the high pass before it, where the
//           envelope (either way) and the LFO take the cutoff
//   VCA/ENV the Juno's one envelope (Pung's, live) and everything it moves:
//           the VCA (or a gate), the VCF, the pulse width
//   CHORUS  the BBD chorus: I, II, or both (the Juno-60's fast vibrato mode)
//
// Times, rates and frequencies come from Hera's own tables (HeraTables.cpp),
// measured on a Juno-60; the chorus rates from its BBD model (HeraChorus).

function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function idx(v, k, n) { return Math.max(0, Math.min(n - 1, Math.round(raw(v, k, 0)))); }

// ---- Hera's tables: evenly spaced points, linear between ----------------------------------
function lerp(tab, x) {
  x = Math.max(0, Math.min(1, x)) * (tab.length - 1);
  var i = Math.min(tab.length - 2, Math.floor(x));
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}
var T_LFO_HZ = [0.3, 0.85, 3.39, 11.49, 22.22], T_LFO_DELAY = [0.0, 0.0639, 0.85, 1.2, 2.685], T_LFO_FADE = [0.001, 0.053, 0.188, 0.348, 1.15];
var T_HPF_HZ = [140, 250, 520, 1220];
var T_ATTACK = [0.001, 0.03, 0.24, 0.65, 3.25], T_DECAY = [0.002, 0.096, 0.984, 4.449, 19.783], T_RELEASE = T_DECAY;
var STAGE = { attack: T_ATTACK, decay: T_DECAY, release: T_RELEASE };

function secs(s) { return s < 1 ? [Math.round(s * 1000), "ms"] : [s < 10 ? s.toFixed(1) : Math.round(s), "s"]; }
function hz(f) { return f >= 1000 ? [(f / 1000).toFixed(1), "kHz"] : [f < 10 ? f.toFixed(1) : Math.round(f), "Hz"]; }
function up(f) { return typeof f === "string" ? f.toUpperCase() : (f[0] + " " + f[1]).toUpperCase(); }
function secTxt(s) { return up(secs(s)); }
function hzTxt(f) { return up(hz(f)); }
function hpfHz(x) { return lerp(T_HPF_HZ, x); }

var RANGE = ["16'", "8'", "4'"], PWM_SRC = ["MAN", "LFO", "ENV"], VCA_MODE = ["ENV", "GATE"], TRIG = ["FREE", "KEY"];
var SWITCH = { pitch_range: RANGE, pwm_mod: PWM_SRC, vca_type: VCA_MODE, lfo_trigger: TRIG, chorus_i: ["OFF", "ON"], chorus_ii: ["OFF", "ON"] };

// the sliders the Juno prints a 0..10 scale beside
var SCALE10 = { saw_level: 1, pulse_level: 1, sub_level: 1, noise_level: 1, pwm_depth: 1, pitch_mod: 1, vcf_cutoff: 1,
  vcf_resonance: 1, vcf_lfo: 1, vcf_key: 1, vcf_bend: 1, vca_depth: 1, sustain: 1, volume: 1 };
// a value in Hera's own terms: its tables' times and Hz, the Juno's 0..10,
// the switches' positions; [number, unit] or a word (null: the module's own).
// Pung's pages, the row under a band screen and the panels all read them so.
function fmt(k, x) {
  if (SWITCH[k]) { var o = SWITCH[k]; return o[Math.max(0, Math.min(o.length - 1, Math.round(x)))]; }
  if (STAGE[k]) return secs(lerp(STAGE[k], x));
  if (SCALE10[k]) return (x * 10).toFixed(1);
  switch (k) {
  case "lfo_rate": return hz(lerp(T_LFO_HZ, x));
  case "lfo_delay": return x <= 0.001 ? "None" : secs(lerp(T_LFO_DELAY, x));
  case "hpf": return x <= 0.001 ? "Flat" : hz(hpfHz(x));
  case "vcf_env": return (x > 0.004 ? "+" : x < -0.004 ? "-" : "") + Math.abs(x * 10).toFixed(1);
  case "octave_transpose": return (x > 0 ? "+" : "") + Math.round(x);
  }
  return null;
}
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmt(key, n);
  if (f === null) return;
  return typeof f === "string" ? f : { value: String(f[0]), unit: f[1] };
});
function valueOf(v, k) {
  if (!known(v, k)) return "--";
  var f = fmt(k, raw(v, k, 0));
  return f === null ? txt(v, k) : up(f);
}
function ten(x) { return (x * 10).toFixed(1); } // the Juno's scale

// ---- the panel's colours ------------------------------------------------------------------
// charcoal, black fader slots, cream caps, and the strip's red, orange, yellow
var PANEL = "#1b1a18", ROWG = "#121110", SLOT = "#000000", CAPC = "#e9e3d3", CAPLINE = "#7d776a";
var INK = "#ffffff", LEG = "#a19d94", DIMI = "#5e5b55", TICK = "#3a3833";
var STRIPE_R = "#d2452f", STRIPE_O = "#e5832f", STRIPE_Y = "#e8bd3c", LED_ON = "#ff4b2b", LED_OFF = "#4a1a12";

// ---- PANEL: the Juno's row of faders ----------------------------------------------------------
// elements: [kind, key, x, label]; a fader's x is its slot's centre, a
// switch's x its lever's
var F_TOP = 50, F_BOT = 96;
var ELEMENTS = [
  ["f", "lfo_rate", 21, "RATE"], ["f", "lfo_delay", 56, "DELAY"], ["s", "lfo_trigger", 80, "TRIG"],
  ["s", "pitch_range", 132, "RANGE"], ["f", "pitch_mod", 180, "LFO"], ["f", "pwm_depth", 215, "PWM"], ["s", "pwm_mod", 236, "MODE"],
  ["f", "pulse_level", 284, "PULSE"], ["f", "saw_level", 319, "SAW"], ["f", "sub_level", 354, "SUB"], ["f", "noise_level", 389, "NOISE"],
  ["f", "hpf", 432, "FREQ"],
  ["f", "vcf_cutoff", 476, "FREQ"], ["f", "vcf_resonance", 511, "RES"], ["b", "vcf_env", 546, "ENV"], ["f", "vcf_lfo", 581, "LFO"], ["f", "vcf_key", 616, "KYBD"],
  ["s", "vca_type", 646, "MODE"], ["f", "vca_depth", 700, "LEVEL"],
  ["f", "attack", 740, "A"], ["f", "decay", 775, "D"], ["f", "sustain", 810, "S"], ["f", "release", 845, "R"]
];
var SECTIONS = [[4, 116, "LFO", STRIPE_R], [124, 282, "DCO", STRIPE_O], [410, 44, "HPF", STRIPE_Y], [458, 176, "VCF", STRIPE_R],
  [638, 80, "VCA", STRIPE_O], [722, 141, "ENV", STRIPE_Y], [867, 89, "CHORUS", STRIPE_R]];
// a switch's legend stands over its lever and its positions
function labelX(e) { return e[0] === "s" ? e[2] + 12 : e[2]; }
var CHORUS_X = [889, 933];

function switchPositions(k) { return SWITCH[k].length; }
function switchY(i, n) { return n === 3 ? 58 + i * 14 : 62 + i * 18; }

// dim: a segment is under the hands, the rest of the panel recedes (its
// strips greyed); seg: segment mode, the encoder row ends at y 142
var DIM_CAP = "#5f5a51";
function strip(g, S, col, ink) { g.fill(S[0], 22, S[1], 11, col); g.text(S[0] + 4, 31, S[2], ink, -1); }
function panelGround(g, seg) {
  g.fill(0, 0, 960, 104, PANEL);
  g.fill(0, 0, 960, 20, "#000000");
  g.value(8, 16, "Hera", INK, -1);
  for (var s = 0; s < SECTIONS.length; s++) {
    strip(g, SECTIONS[s], SECTIONS[s][3], "#000000");
  }
  for (var i = 0; i < ELEMENTS.length; i++) {
    var e = ELEMENTS[i], x = e[2];
    if (e[0] === "s") {
      var n = switchPositions(e[1]), opts = SWITCH[e[1]];
      g.fill(x - 3, switchY(0, n) - 6, 6, switchY(n - 1, n) - switchY(0, n) + 12, SLOT);
      for (var o = 0; o < n; o++) g.text(x + 8, switchY(o, n) + 4, opts[o], DIMI, -1);
      g.text(labelX(e), 44, e[3], LEG, 0);
      continue;
    }
    // the slot and its scale: ten steps, the ends and the middle longer
    g.fill(x - 1.5, F_TOP, 3, F_BOT - F_TOP, SLOT);
    for (var tk = 0; tk <= 10; tk++) {
      var ty = Math.round(F_BOT - (F_BOT - F_TOP) * tk / 10), len = tk % 5 === 0 ? 5 : 3;
      g.fill(x - 9 - len + 3, ty, len, 1, TICK);
    }
    if (e[0] === "b") { g.text(x + 12, F_TOP + 4, "+", DIMI, 0); g.text(x + 12, F_BOT + 2, "-", DIMI, 0); }
    g.text(x, 44, e[3], LEG, 0);
  }
  // the chorus buttons
  for (var b = 0; b < 2; b++) g.fill(CHORUS_X[b] - 17, 58, 34, 20, "#2c2a27");
  // the encoder row
  g.fill(0, 104, 960, 56, ROWG);
  g.fill(0, 104, 960, 2, "#000000");
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 28 : 44, TICK);
}
// a fader cap: cream, its index line across the middle
function cap(g, x, y, col) {
  g.fill(x - 8, y - 5, 16, 10, col);
  g.fill(x - 8, y, 16, 1, CAPLINE);
}
function panel(g, v) {
  var t = v.$touched || "", kn = v.$knobs || [], held = {}, i;
  for (i = 0; i < kn.length; i++) if (kn[i]) held[kn[i]] = 1;
  // segment mode: Pung's bar marks the active section; its faders' legends
  // are lit as the encoders' always are (held), nothing else changes
  var segOn = !!v.$segmode;
  g.layer("panel|" + (segOn ? "seg" : ""), function () { panelGround(g, segOn); });
  for (i = 0; i < ELEMENTS.length; i++) {
    var e = ELEMENTS[i], k = e[1], x = e[2], hot = k === t, ok = known(v, k);
    if (held[k]) g.text(labelX(e), 44, e[3], hot ? "slot" : INK, 0);
    if (e[0] === "s") {
      var n = switchPositions(k), at = idx(v, k, n);
      if (!ok) continue;
      g.fill(x - 5, switchY(at, n) - 3, 10, 6, hot ? "slot" : CAPC);
      g.text(x + 8, switchY(at, n) + 4, SWITCH[k][at], hot ? "slot" : INK, -1);
      continue;
    }
    var f = ok ? fr(v, k, 0) : 0.5;
    cap(g, x, F_BOT - 4 - (F_BOT - F_TOP - 8) * f, hot ? "slot" : ok ? CAPC : DIM_CAP);
  }
  // chorus: I and II, each a button with its LED
  var c1 = known(v, "chorus_i") && raw(v, "chorus_i", 0) >= 0.5, c2 = known(v, "chorus_ii") && raw(v, "chorus_ii", 0) >= 0.5;
  var cb = [["chorus_i", "I", c1], ["chorus_ii", "II", c2]];
  for (var b = 0; b < 2; b++) {
    var bx = CHORUS_X[b], bh = t === cb[b][0];
    if (bh) g.fill(bx - 17, 58, 34, 20, "slot");
    g.dot(bx, 48, 3, cb[b][2] ? LED_ON : LED_OFF);
    g.text(bx, 72, cb[b][1], bh ? "#000000" : cb[b][2] || held[cb[b][0]] ? INK : LEG, 0);
  }
  // the patch: its number as the Juno's red display shows it, its name
  var pr = known(v, "preset") ? Math.round(raw(v, "preset", 0)) + 1 : 0;
  g.fill(54, 3, 34, 15, "#2a0a05");
  g.value(71, 16, pr ? (pr < 10 ? "0" : "") + pr : "--", LED_ON, 0);
  g.text(98, 14, txt(v, "preset_name").toUpperCase(), INK, -1, 420);
  var ps = v.$pages || [];
  if (!segOn && ps.length > 1) g.text(952, 14, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  // the encoder row: each encoder a fader (or a switch), its name, its value
  // (above y 142 while segments are on: Pung names them under it)
  var top = 110, len = segOn ? 28 : 44;
  for (var c = 0; c < 8; c++) {
    var key = kn[c] || "";
    if (!key) continue;
    var cx = c * 120 + 20, hot2 = key === t, ok2 = known(v, key);
    if (SWITCH[key]) {
      var n2 = SWITCH[key].length, at2 = idx(v, key, n2), span = len - 12;
      if (/^chorus/.test(key)) at2 = n2 - 1 - at2; // a button: on is up
      g.fill(cx - 3, top, 6, len, SLOT);
      for (var o = 0; o < n2; o++) g.fill(cx - 1, top + 5 + o * span / (n2 - 1), 2, 2, TICK);
      if (ok2) g.fill(cx - 6, top + 2 + at2 * span / (n2 - 1), 12, 8, hot2 ? "slot" : CAPC);
    } else {
      g.fill(cx - 1.5, top, 3, len, SLOT);
      if (key === "vcf_env") g.fill(cx - 6, top + len / 2, 3, 1, TICK);
      var f2 = ok2 ? fr(v, key, 0) : 0.5;
      cap(g, cx, top + len - 5 - (len - 10) * f2, hot2 ? "slot" : ok2 ? CAPC : DIMI);
    }
    g.text(cx + 18, segOn ? 119 : 124, NAMES[key] || String((v[key] && v[key].name) || key).toUpperCase(), hot2 ? "slot" : LEG, -1, 80);
    g.value(cx + 18, segOn ? 138 : 148, valueOf(v, key), hot2 ? "slot" : INK, -1, 80);
  }
}
var NAMES = { vcf_cutoff: "VCF FREQ", vcf_resonance: "VCF RES", vcf_env: "VCF ENV", vcf_key: "VCF KYBD", vcf_lfo: "VCF LFO",
  vcf_bend: "VCF BEND", attack: "ATTACK", decay: "DECAY", sustain: "SUSTAIN", release: "RELEASE", lfo_rate: "LFO RATE",
  lfo_delay: "LFO DELAY", lfo_trigger: "LFO TRIG", pitch_mod: "DCO LFO", pwm_depth: "PWM", pwm_mod: "PWM MODE",
  pitch_range: "RANGE", saw_level: "SAW", pulse_level: "PULSE", sub_level: "SUB OSC", noise_level: "NOISE", hpf: "HPF",
  vca_depth: "VCA LEVEL", vca_type: "VCA MODE", chorus_i: "CHORUS I", chorus_ii: "CHORUS II", volume: "VOLUME", octave_transpose: "OCTAVE" };

// Pung's default pages in the Juno's charcoal, its fader slots and cream caps
push.theme({ ground: PANEL, panel: CAPC, ink: INK, dim: LEG, rule: CAPLINE, faint: SLOT, knob: "fader" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true,
  // the Juno's sections, each under the hands, its faders in panel order
  segments: [
    { id: "lfo", label: "LFO", rect: [4, 22, 116, 82], keys: ["lfo_rate", "lfo_delay", "lfo_trigger"] },
    { id: "dco", label: "DCO", rect: [124, 22, 282, 82], keys: ["pitch_range", "pitch_mod", "pwm_depth", "pwm_mod", "pulse_level", "saw_level", "sub_level", "noise_level"] },
    { id: "vcf", label: "HPF / VCF", rect: [410, 22, 224, 82], keys: ["hpf", "vcf_cutoff", "vcf_resonance", "vcf_env", "vcf_lfo", "vcf_key", "vcf_bend"] },
    { id: "env", label: "VCA / ENV", rect: [638, 22, 225, 82], keys: ["vca_type", "vca_depth", "attack", "decay", "sustain", "release"] },
    { id: "chorus", label: "Chorus", rect: [867, 22, 89, 82], keys: ["chorus_i", "chorus_ii", "volume", "octave_transpose"] }
  ],
  pages: [
    { label: "Filter & Env", keys: ["vcf_cutoff", "vcf_resonance", "vcf_env", "vcf_key", "attack", "decay", "sustain", "release"] },
    { label: "DCO & LFO", keys: ["lfo_rate", "lfo_delay", "pitch_mod", "pwm_depth", "pulse_level", "saw_level", "sub_level", "noise_level"] },
    { label: "HPF & Switches", keys: ["lfo_trigger", "pitch_range", "pwm_mod", "hpf", "vcf_lfo", "vca_type", "chorus_i", "chorus_ii"] }
  ],
  extra_keys: ["preset", "preset_name", "lfo_rate", "lfo_delay", "lfo_trigger", "pitch_range", "pitch_mod", "pwm_depth", "pwm_mod",
    "pulse_level", "saw_level", "sub_level", "noise_level", "hpf", "vcf_lfo", "vca_type", "vca_depth", "chorus_i", "chorus_ii"],
  screen: panel
});

// ---- the band screens: the panel's charcoal, a section's strip ------------------------------------
function band(g, key, strips) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, PANEL);
    for (var i = 0; i < strips.length; i++) {
      var s = strips[i];
      g.fill(s[0], 0, s[1], 11, s[3]);
      g.text(s[0] + 4, 9, s[2], "#000000", -1);
    }
  });
}
function bar(g, x, y, w, f, col) { g.fill(x, y, w, 3, SLOT); g.fill(x, y, Math.max(0, Math.round(w * f)), 3, col); }
// a switch drawn as the Juno's: its positions, the lever at the one it is in
function toggle(g, x, y, k, v, hot) {
  var opts = SWITCH[k], n = opts.length, at = idx(v, k, n), ok = known(v, k);
  g.fill(x - 3, y - 5, 6, (n - 1) * 15 + 10, SLOT);
  for (var o = 0; o < n; o++) {
    var yy = y + o * 15;
    if (ok && o === at) g.fill(x - 6, yy - 3, 12, 7, hot ? "slot" : CAPC);
    g.text(x + 12, yy + 4, opts[o], ok && o === at ? (hot ? "slot" : INK) : DIMI, -1);
  }
}

// ---- LFO ------------------------------------------------------------------------------------------
push.compartment({
  id: "lfo", label: "LFO",
  pages: [{ label: "LFO", keys: ["lfo_rate", "lfo_delay", "lfo_trigger"] }],
  extra_keys: ["pitch_mod", "pwm_depth", "pwm_mod", "vcf_lfo"],
  screen: function (g, v) {
    band(g, "lfo", [[0, 356, "LFO", STRIPE_R], [364, 588, "WHERE IT GOES", STRIPE_R]]);
    var t = v.$touched || "", trig = idx(v, "lfo_trigger", 2) === 1;
    // its wave (a sine in Hera), at its rate; a note restarts it in KEY mode
    g.lfo(0, 12, 236, 52, { shape: "Sine", rate: "lfo_rate", trig: trig, color: STRIPE_O });
    g.text(118, 82, valueOf(v, "lfo_rate"), t === "lfo_rate" ? "slot" : INK, 0);
    // the delay, then the fade-in, from each note (KEY) or the first (FREE)
    var dl = lerp(T_LFO_DELAY, raw(v, "lfo_delay", 0)), fd = lerp(T_LFO_FADE, raw(v, "lfo_delay", 0));
    var dh = t === "lfo_delay", x0 = 248, w = 100, sc = w / 4; // 4 s from the note
    g.text(x0, 24, "AFTER A NOTE", dh ? "slot" : LEG, -1);
    g.fill(x0, 36, w, 1, TICK);
    for (var s = 0; s <= 4; s++) g.fill(x0 + s * sc, 33, 1, 4, TICK);
    g.fill(x0, 30, 2, 10, INK); // the note
    var xd = x0 + Math.min(w, dl * sc), xf = x0 + Math.min(w, (dl + fd) * sc);
    // a time line, not a curve: waiting (dim), fading in (thin), full (thick)
    if (xd > x0 + 1) g.fill(x0 + 2, 35, xd - x0 - 2, 3, dh ? "slot" : DIMI);
    if (xf > xd + 1) g.fill(xd, 34, xf - xd, 2, dh ? "slot" : STRIPE_O);
    if (x0 + w > xf + 1) g.fill(xf, 32, x0 + w - xf, 5, dh ? "slot" : STRIPE_O);
    g.text(x0, 54, dl < 0.002 ? "NO DELAY" : "WAITS " + secTxt(dl), dl < 0.002 ? LEG : INK, -1);
    g.text(x0, 68, "FADES IN " + secTxt(fd), LEG, -1);
    g.text(x0, 82, trig ? "KEY: EVERY NOTE" : "FREE RUNNING", t === "lfo_trigger" ? "slot" : LEG, -1);
    // where it goes: the DCO's pitch, the pulse width (when PWM is on LFO), the VCF
    var dest = [["DCO PITCH", raw(v, "pitch_mod", 0), true], ["PULSE WIDTH", raw(v, "pwm_depth", 0), idx(v, "pwm_mod", 3) === 1],
      ["VCF CUTOFF", raw(v, "vcf_lfo", 0), true]];
    for (var i = 0; i < 3; i++) {
      var y = 28 + i * 22, live = dest[i][2] && dest[i][1] > 0.004, x = 380;
      g.text(x, y + 4, dest[i][0], live ? INK : DIMI, -1);
      bar(g, x + 100, y, 300, dest[i][2] ? dest[i][1] : 0, live ? STRIPE_O : DIMI);
      g.text(x + 560, y + 4, !dest[i][2] ? "PWM IS ON " + PWM_SRC[idx(v, "pwm_mod", 3)] : ten(dest[i][1]), live ? INK : DIMI, 1);
    }
  }
});

// ---- DCO ------------------------------------------------------------------------------------------
var LEVELS = ["pulse_level", "saw_level", "sub_level", "noise_level"];
// the pulse's high part: square with no PWM, narrow toward full
function width(depth) { return 0.5 - 0.45 * depth; }
function noise(i) { var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
// one source at phase ph (cycles of the DCO), -1..1: pulse, saw, sub (a
// square an octave down)
function part(src, ph, pw) {
  var p = ph - Math.floor(ph);
  if (src === 0) return p < pw ? 1 : -1;
  if (src === 1) return 1 - 2 * p;
  var s = ph / 2; return s - Math.floor(s) < 0.5 ? 1 : -1;
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 48) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
push.compartment({
  id: "dco", label: "DCO",
  pages: [{ label: "DCO", keys: ["pitch_range", "pitch_mod", "pwm_depth", "pwm_mod", "pulse_level", "saw_level", "sub_level", "noise_level"] }],
  screen: function (g, v) {
    band(g, "dco", [[0, 476, "DCO", STRIPE_O], [480, 472, "THE WAVE IT PUTS OUT", STRIPE_O]]);
    var t = v.$touched || "", i;
    var ok = known(v, "saw_level") && known(v, "pulse_level") && known(v, "sub_level") && known(v, "noise_level");
    // RANGE: the footage switch, over its encoder
    toggle(g, 24, 28, "pitch_range", v, t === "pitch_range");
    // LFO into the pitch, over its encoder
    var pm = raw(v, "pitch_mod", 0), ph = t === "pitch_mod";
    g.text(130, 30, "LFO MOD", ph ? "slot" : LEG, -1);
    bar(g, 130, 40, 96, pm, ph ? "slot" : STRIPE_O);
    g.text(130, 60, pm > 0.004 ? "LFO " + ten(pm) : "NONE", pm > 0.004 ? INK : DIMI, -1);
    // PWM: the width and where its source takes it, over PWM and MODE
    var depth = raw(v, "pwm_depth", 0), src = idx(v, "pwm_mod", 3), wh = t === "pwm_depth" || t === "pwm_mod";
    var px0 = 248, px1 = 352, hi = 22, lo = 70, cw = px1 - px0;
    var pw = src === 0 ? width(depth) : 0.5; // a moving width starts square, depth takes it narrower
    if (src !== 0 && depth > 0.004) g.fill(px0 + cw * width(depth), hi, cw * (0.5 - width(depth)), lo - hi, "#3b2615");
    var e = px0 + cw * pw;
    g.poly([px0, lo, px0, hi, e, hi, e, lo, px1, lo, px1, hi], 2, !known(v, "pwm_depth") ? DIMI : wh ? "slot" : CAPC);
    g.text(px0, 84, src === 0 ? "WIDTH " + Math.round(pw * 100) + "%" : depth > 0.004 ? "50 TO " + Math.round(width(depth) * 100) + "% BY " + PWM_SRC[src] : "SQUARE", wh ? "slot" : LEG, -1);
    toggle(g, 384, 28, "pwm_mod", v, t === "pwm_mod");
    // the sum, over the four level faders
    var lv = [];
    for (i = 0; i < 4; i++) lv.push(ok ? raw(v, LEVELS[i], 0) : [0.5, 0.8, 0.4, 0][i]);
    var x0 = 486, x1 = 946, top = 18, base = 82, mid = (top + base) / 2, n = 184;
    var sig = lv.map(function (a) { return a.toFixed(3); }).join(",") + "|" + pw.toFixed(3);
    var curve = cached(sig, function () {
      var raw0 = [], peak = 0;
      for (var j = 0; j <= n; j++) {
        var phs = 2 * Math.min(j / n, 0.9999), s = 0;
        for (var k = 0; k < 3; k++) s += lv[k] * part(k, phs, pw);
        raw0.push(s); peak = Math.max(peak, Math.abs(s) + lv[3]);
      }
      var amp = peak < 1e-3 ? 0 : (base - top) / 2 / peak, pts = [], up = [], dn = [];
      for (j = 0; j <= n; j++) {
        var x = x0 + (x1 - x0) * j / n;
        pts.push(x, mid - raw0[j] * amp);
        up.push(mid - (raw0[j] + lv[3] * (0.55 + 0.45 * Math.abs(noise(j)))) * amp);
        dn.push(mid - (raw0[j] - lv[3] * (0.55 + 0.45 * Math.abs(noise(j + 999)))) * amp);
      }
      return { pts: pts, up: up, dn: dn, silent: peak < 1e-3, raw: raw0, amp: amp };
    });
    g.fill(x0, mid, x1 - x0, 1, TICK);
    var touched = LEVELS.indexOf(t);
    if (curve.silent) {
      g.text((x0 + x1) / 2, mid - 6, "NO SOURCE UP", DIMI, 0);
    } else {
      if (lv[3] > 0.004) { // noise: a band around the wave it rides on
        var nc = touched === 3 ? "slot" : "#4a4640", cw2 = (x1 - x0) / n + 1;
        for (i = 1; i <= n; i += 2) g.fill(x0 + (x1 - x0) * i / n, curve.up[i], cw2 * 2, curve.dn[i] - curve.up[i], nc);
      }
      if (touched >= 0 && touched < 3 && lv[touched] > 0) { // the source under the finger, alone
        var one = [];
        for (i = 0; i <= n; i += 2) one.push(x0 + (x1 - x0) * i / n, mid - lv[touched] * part(touched, 2 * Math.min(i / n, 0.9999), pw) * curve.amp);
        g.poly(one, 2, "slot");
      }
      if (!(lv[3] > 0.004)) g.area(curve.pts, mid, "#3b2615");
      g.poly(curve.pts, 2, ok ? CAPC : DIMI);
    }
  }
});

// ---- HPF / VCF -------------------------------------------------------------------------------------
push.compartment({
  id: "vcf", label: "HPF / VCF",
  pages: [{ label: "HPF / VCF", keys: ["hpf", "vcf_cutoff", "vcf_resonance", "vcf_env", "vcf_lfo", "vcf_key", "vcf_bend"] }],
  screen: function (g, v) {
    band(g, "vcf", [[0, 116, "HPF", STRIPE_Y], [120, 832, "VCF  24 DB LOW PASS", STRIPE_R]]);
    var t = v.$touched || "", x0 = 6, x1 = 714; // g.filter's axis: 20 Hz to 20 kHz over its width less 6 each side
    g.filter(0, 12, 720, 74, { cutoff: "vcf_cutoff", resonance: "vcf_resonance", type: "LP 24 dB", color: STRIPE_R });
    function xOf(hz) { return x0 + (x1 - x0) * Math.log(hz / 20) / Math.log(1000); }
    // the high pass before it: everything under its frequency is cut
    var hp = raw(v, "hpf", 0), hh = t === "hpf";
    if (hp > 0.001) {
      var xh = xOf(hpfHz(hp));
      g.fill(x0, 18, xh - x0, 62, hh ? "#3a2a10" : "#2a2620");
      g.fill(xh, 18, 2, 62, hh ? "slot" : STRIPE_Y);
      g.text(xh + 6, 28, "HPF " + hzTxt(hpfHz(hp)), hh ? "slot" : STRIPE_Y, -1);
    } else g.text(10, 28, "HPF FLAT", hh ? "slot" : DIMI, -1);
    // where the envelope takes the cutoff (either way) and the LFO's swing
    var c = fr(v, "vcf_cutoff", 0), env = raw(v, "vcf_env", 0), lfo = raw(v, "vcf_lfo", 0);
    if (known(v, "vcf_cutoff")) {
      var xc = x0 + (x1 - x0) * c, y = 76;
      if (Math.abs(env) > 0.004) {
        var xe = x0 + (x1 - x0) * Math.max(0, Math.min(1, c + env * 0.5)), ec = t === "vcf_env" ? "slot" : STRIPE_O, d = env > 0 ? -6 : 6;
        g.fill(Math.min(xc, xe), y - 1, Math.abs(xe - xc), 2, ec);
        g.poly([xe + d, y - 5, xe, y, xe + d, y + 5], 2, ec);
        g.text(xe - d * 1.4, y - 7, "ENV", ec, env > 0 ? 1 : -1);
      }
      if (lfo > 0.004) {
        var sw = (x1 - x0) * lfo * 0.15, lc = t === "vcf_lfo" ? "slot" : STRIPE_Y;
        g.fill(xc - sw, 64, sw * 2, 2, lc);
        g.fill(xc - sw, 61, 2, 8, lc); g.fill(xc + sw - 2, 61, 2, 8, lc);
      }
    }
    // what follows the keys and the bender, in words
    var x = 740, kh = t === "vcf_key", bh = t === "vcf_bend";
    g.text(x, 28, "KEYBOARD", kh ? "slot" : LEG, -1);
    bar(g, x, 34, 200, raw(v, "vcf_key", 0), kh ? "slot" : STRIPE_O);
    g.text(x, 50, raw(v, "vcf_key", 0) > 0.95 ? "FOLLOWS THE KEYS FULLY" : raw(v, "vcf_key", 0) > 0.004 ? "FOLLOWS THE KEYS IN PART" : "THE SAME ON EVERY KEY", DIMI, -1, 210);
    g.text(x, 68, "BENDER", bh ? "slot" : LEG, -1);
    bar(g, x, 74, 200, raw(v, "vcf_bend", 0), bh ? "slot" : STRIPE_O);
  }
});

// ---- VCA / ENV: one envelope for everything ---------------------------------------------------------
push.compartment({
  id: "env", label: "VCA / ENV",
  pages: [{ label: "VCA / ENV", keys: ["vca_type", "vca_depth", "attack", "decay", "sustain", "release"] }],
  extra_keys: ["vcf_env", "pwm_mod", "pwm_depth"],
  screen: function (g, v) {
    band(g, "env", [[0, 236, "VCA", STRIPE_O], [240, 476, "ENV", STRIPE_Y], [720, 232, "THE ENVELOPE MOVES", STRIPE_Y]]);
    var t = v.$touched || "", gate = idx(v, "vca_type", 2) === 1;
    toggle(g, 24, 32, "vca_type", v, t === "vca_type");
    var lh = t === "vca_depth";
    g.text(130, 30, "LEVEL", lh ? "slot" : LEG, -1);
    bar(g, 130, 40, 96, raw(v, "vca_depth", 0), lh ? "slot" : STRIPE_O);
    g.text(130, 60, valueOf(v, "vca_depth"), INK, -1);
    g.text(24, 82, gate ? "THE VCA OPENS WITH THE KEY: AN ORGAN" : "THE VCA FOLLOWS THE ENVELOPE", gate ? STRIPE_Y : DIMI, -1, 210);
    // Pung's envelope, live: every note a dot on Hera's own times
    g.envelope(240, 12, 476, 74, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", labels: true, color: STRIPE_Y });
    // what it moves
    var x = 730, env = raw(v, "vcf_env", 0), pwm = idx(v, "pwm_mod", 3) === 2, pd = raw(v, "pwm_depth", 0);
    var rows = [["VCA", gate ? "GATE INSTEAD" : "LEVEL", !gate], ["VCF CUTOFF", valueOf(v, "vcf_env") + (env < -0.004 ? " DOWN" : ""), Math.abs(env) > 0.004],
      ["PULSE WIDTH", pwm ? ten(pd) : "PWM ON " + PWM_SRC[idx(v, "pwm_mod", 3)], pwm && pd > 0.004]];
    for (var i = 0; i < 3; i++) {
      var y = 30 + i * 22;
      g.dot(x + 3, y - 3, 3, rows[i][2] ? STRIPE_Y : TICK);
      g.text(x + 12, y + 1, rows[i][0], rows[i][2] ? INK : DIMI, -1);
      g.text(946, y + 1, rows[i][1], rows[i][2] ? INK : DIMI, 1);
    }
  }
});

// ---- CHORUS: Hera's BBD model, the Juno-60's three modes ----------------------------------------------------
push.compartment({
  id: "chorus", label: "Chorus",
  pages: [{ label: "Chorus", keys: ["chorus_i", "chorus_ii", "volume", "octave_transpose"] }],
  screen: function (g, v) {
    band(g, "chorus", [[0, 236, "CHORUS", STRIPE_R], [240, 712, "BUCKET-BRIGADE DELAY", STRIPE_R]]);
    var t = v.$touched || "", c1 = raw(v, "chorus_i", 0) >= 0.5, c2 = raw(v, "chorus_ii", 0) >= 0.5, ok = known(v, "chorus_i") && known(v, "chorus_ii");
    function button(x, k, name, lit) {
      var hot = t === k;
      g.fill(x - 22, 40, 44, 26, hot ? "slot" : "#2c2a27");
      g.dot(x, 30, 3, lit ? LED_ON : LED_OFF);
      g.text(x, 58, name, hot ? "#000000" : lit ? INK : LEG, 0);
    }
    button(60, "chorus_i", "I", ok && c1);
    button(180, "chorus_ii", "II", ok && c2);
    var mode = !ok ? "--" : c1 && c2 ? "I + II" : c1 ? "I" : c2 ? "II" : "OFF";
    // the rates and delay ranges are Hera's BBD model's (HeraChorus)
    var say = !ok ? "" : c1 && c2 ? "SWEEPS AT 9.75 HZ, SHALLOW: A FAST SHIMMER" : c1 ? "SWEEPS AT 0.51 HZ: SLOW AND GENTLE" : c2 ? "SWEEPS AT 0.86 HZ: QUICKER AND DEEPER" : "THE DRY SOUND";
    g.value(260, 44, "CHORUS " + mode, ok && (c1 || c2) ? INK : LEG, -1);
    g.text(260, 66, say, LEG, -1, 460);
    g.text(260, 82, ok && (c1 || c2) ? "STEREO: LEFT AND RIGHT FROM TWO DELAY LINES" : "", DIMI, -1, 460);
    g.text(946, 30, "BOTH BUTTONS: I + II", DIMI, 1);
  }
});

// ---- Hera's envelope times (HeraTables.cpp) --------------------------------------------------------
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    var tab = STAGE[s.key];
    return tab && s.raw !== null && s.raw !== undefined ? lerp(tab, s.raw) : null;
  });
});
