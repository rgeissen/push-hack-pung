// Hush One (the SH-101, emulated; the module's own name) on Push.
// An overlay shipped with Pung (the module ships no push_ui.js).
//
// The SH-101 is a row of sliders in boxed sections, read left to right as
// the signal goes: MODULATOR, VCO, SOURCE MIXER, VCF, VCA, ENV. The screens
// keep that panel and its words:
//
//   PANEL     the front panel: all six sections at a glance (the LFO, the
//             pulse at its width and how far it is moved, the mixer, the
//             filter with where the envelope and the LFO take it, the VCA's
//             switch, the envelope), and the encoders as the 101's sliders,
//             two pages: VCF and ENV, then MODULATOR, VCO and MIXER
//   MODULATOR the LFO and what it moves: pitch, filter, pulse width, each in
//             its own unit
//   VCO       the range in feet, the pulse at its width and its modulation
//   MIXER     Pung's mixer over the four level knobs, and the wave they sum to
//   VCF       the response where it sounds, the envelope's and the LFO's
//             reach, where the keyboard takes it; its envelope on its own page
//   VCA / ENV Pung's own pages (the envelope is Pung's envelope)
//   PLAY      how keys play it: three notes on a timeline, where the pitch
//             glides and which notes start the envelopes again (the 101's
//             PORTAMENTO and ENV trigger switches)
//
// The engine (src/dsp/sh101_plugin.c): the cutoff is 30 + c^2 * 15 kHz at
// middle C, times 2^(key follow * octaves from C); the envelope adds its
// amount to c (twice with full range, negative with negative polarity), the
// LFO +-0.5 * depth_curve(mod) to c. Pitch LFO: +-0.85 semitone at full
// (more with the wheel). PWM: by the LFO +-0.42 * depth_curve(depth + LFO
// PWM), by the envelope +-0.45 * depth around the width. The sub oscillator
// as the engine makes it: mode 0 a square an octave down, mode 1 a square
// two octaves down, mode 2 a 25% pulse two octaves down. The module names
// the modes otherwise ("-2 Oct 50% PW", "-2 Oct", "-1 Oct"): a bug in its
// labels; push.display names them as they sound, so Pung's row and the
// pictures agree.

// ---- the panel's colours -----------------------------------------------------------------
var PANEL = "#1e1f22", BODY = "#8c8f94", BODY_INK = "#17181a", PRINT = "#ecece8", PRINT_DIM = "#8f908d";
var FRAME = "#9a9b98", FRAME_DIM = "#4a4b4d", SLOT = "#000000", CAP = "#d6d6d2", CAP_LINE = "#2a2a2c";
var LED = "#ff3b2a", LED_OFF = "#4c1a15", CURVE = "#ecece8";

// ---- values ------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? Math.max(0, Math.min(1, v[k].frac)) : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
// an enum's index among its options, whether the module answers its index or its name
function pick(v, k, opts) {
  if (!known(v, k)) return -1;
  var s = String(v[k].value), d = String(v[k].display || "");
  for (var i = 0; i < opts.length; i++) if (s === opts[i] || d === opts[i]) return i;
  var n = parseInt(s, 10);
  return isNaN(n) ? -1 : n;
}
var PWM_MODES = ["Env", "Manual", "LFO"], SUB_MODES = ["-2 Oct 50% PW", "-2 Oct", "-1 Oct"];
var LFO_WAVES = ["Tri", "Rect", "Random", "Noise"], VCA_MODES = ["Gate", "Envelope"];
var GATE_MODES = ["Gate", "Gate+Trig", "LFO"], PORTA = ["Off", "On", "Auto"];
function on(v, k) { var s = txt(v, k).toLowerCase(); return s === "on" || s === "1" || s === "retrig" || s === "sync" || s === "negative" || s === "linear"; }

function depthCurve(x) { x = Math.max(0, Math.min(1, x)); return x * x * (2 - x); }
function cutHz(c) { return 30 + c * c * 15000; }
function fmtS(s) {
  if (s >= 1) return s.toFixed(s >= 9.95 ? 0 : 2) + " s";
  var ms = s * 1000;
  return (ms >= 10 ? Math.round(ms) : ms.toFixed(1)) + " ms";
}
function fmtHz(h) { return h >= 1000 ? (h / 1000).toFixed(h >= 9950 ? 1 : 2) + " kHz" : Math.round(h) + " Hz"; }
function ten(f) { return (f * 10).toFixed(1); } // the 101's sliders are printed 0 to 10
var FEET = ["32'", "16'", "8'", "4'", "2'"];

// a value in the engine's unit, on the 101's 0..10, or the sub oscillator
// named as it sounds; undefined: the module's own text
var TEN = { saw: 1, pulse: 1, sub: 1, noise: 1, sustain: 1, f_sustain: 1, env_amt: 1, lfo_filter: 1, lfo_pwm: 1, pwm_depth: 1,
  pwm_env_depth: 1, volume: 1, velocity_sens: 1, filter_velocity_sens: 1, adsr_declick: 1, filter_volume_correction: 1 };
var SUB_SOUNDS = ["-1 Oct Sqr", "-2 Oct Sqr", "-2 Oct 25%"];
function unitText(key, raw) {
  var n = parseFloat(raw);
  if (key === "sub_mode") { var i = SUB_MODES.indexOf(String(raw)); if (i < 0 && !isNaN(n)) i = n; return SUB_SOUNDS[i]; }
  if (isNaN(n)) return undefined;
  if (TEN[key]) return ten(Math.max(0, Math.min(1, n)));
  switch (key) {
  case "cutoff": return fmtHz(cutHz(n));
  case "resonance": return ten(n / 1.2);
  case "attack": case "decay": case "release": case "f_attack": case "f_decay": case "f_release": return fmtS(n);
  case "lfo_rate": return (n >= 10 ? n.toFixed(1) : n.toFixed(2)) + " Hz";
  case "octave_transpose": return FEET[Math.max(0, Math.min(4, Math.round(n) + 2))];
  case "pulse_width": return Math.round(n * 100) + "%";
  case "glide": return Math.round(n) + " ms";
  case "lfo_pitch": return (depthCurve(n) * 0.85).toFixed(2) + " st";
  case "key_follow": return Math.round(n * 100) + "%";
  case "fine_tune": return (n > 0 ? "+" : "") + Math.round(n) + " ct";
  case "transpose": return (n > 0 ? "+" : "") + Math.round(n) + " st";
  case "bend_range": return "+/-" + Math.round(n) + " st";
  }
  return undefined;
}
// how the values read wherever Pung writes one (the row under the band
// screens, Pung's own pages, the web page)
push.display(function (key, raw) { return unitText(key, raw); });
// an encoder's value on the panel
function shown(v, k) {
  if (!known(v, k)) return "--";
  var u = unitText(k, v[k].value);
  if (u !== undefined) return u;
  if (v[k].type === "enum" || isNaN(parseFloat(v[k].value))) return txt(v, k);
  return ten(fr(v, k, 0));
}

// ---- small parts --------------------------------------------------------------------------
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 64) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function box(g, x, y, w, h, c) {
  g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c);
  g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c);
}
function lamp(g, x, y, lit) { g.dot(x, y, 2.6, lit ? LED : LED_OFF); }
// a section as the 101 prints it: a white frame, its name set into the top line
// lit 2: the active segment's section, its name in the slot colour
function section(g, x, y, w, h, title, lit) {
  box(g, x, y, w, h, lit ? FRAME : FRAME_DIM);
  var tw = g.measure(title);
  g.fill(x + 5, y - 5, tw + 8, 10, PANEL);
  g.text(x + 9, y + 4, title, lit === 2 ? "slot" : (lit ? PRINT : PRINT_DIM), -1);
}

// the sources at phase ph (cycles of the VCO), as the engine makes them
function pulseAt(ph, pw) { var p = ph - Math.floor(ph); return p < pw ? 1 : -0.95; }
function sawAt(ph) { var p = ph - Math.floor(ph); return 2 * p - 1; }
function subAt(ph, mode) {
  var s = mode === 0 ? ph / 2 : ph / 4, p = s - Math.floor(s);
  if (mode === 2) return p < 0.25 ? 1 : -1;
  return p < 0.5 ? 0.94 : -1;
}
var SUB_SAYS = ["SQUARE -1 OCT", "SQUARE -2 OCT", "PULSE -2 OCT"];

// ---- the encoder row: the 101's sliders ----------------------------------------------------
// Drawn from v.$knobs: the page's keys, or a segment's. A level is a slider,
// a switch a column of lamps (one a position), RANGE a rotary. While segment
// mode is on, Pung names the segments in the bottom 18 pixels: the row is
// tighter and ends above y 142.
var ROW = 104;
var LEGEND = { cutoff: "VCF FREQ", resonance: "VCF RES", env_amt: "VCF ENV", lfo_filter: "VCF MOD", key_follow: "VCF KYBD",
  filter_velocity_sens: "VCF VELO", filter_env_polarity: "ENV POLARITY", filter_env_full_range: "ENV FULL RANGE",
  filter_volume_correction: "VOL CORRECT", f_attack: "VCF ATTACK", f_decay: "VCF DECAY", f_sustain: "VCF SUSTAIN", f_release: "VCF RELEASE",
  attack: "ATTACK", decay: "DECAY", sustain: "SUSTAIN", release: "RELEASE", gate_trig_mode: "ENV TRIGGER", adsr_declick: "DECLICK",
  lfo_rate: "LFO RATE", lfo_waveform: "LFO WAVE", lfo_trigger: "LFO TRIG", lfo_sync: "LFO SYNC", lfo_invert: "LFO INVERT",
  lfo_pitch: "VCO MOD", lfo_pwm: "LFO PWM", lfo_pitch_snap: "PITCH SNAP", octave_transpose: "RANGE", transpose: "TRANSPOSE",
  fine_tune: "FINE TUNE", pulse_width: "PULSE WIDTH", pwm_mode: "PWM SOURCE", pwm_depth: "PWM LFO", pwm_env_depth: "PWM ENV",
  pulse: "PULSE", saw: "SAW", sub: "SUB OSC", noise: "NOISE", sub_mode: "SUB MODE", white_noise: "WHITE NOISE",
  vca_mode: "VCA MODE", volume: "VOLUME", velocity_sens: "VCA VELO", velocity_mode: "VEL MODE" };
function legend(v, k) { return LEGEND[k] || (v[k] && v[k].name ? String(v[k].name).toUpperCase() : k.toUpperCase()); }
function kindOf(v, k) {
  if (k === "octave_transpose") return "range";
  return v[k] && v[k].type === "enum" ? "switch" : "slider";
}
function positions(v, k) { var n = v[k] ? v[k].max - v[k].min + 1 : 2; return n >= 2 && n <= 6 ? n : 2; }
function rowGeo(tight) {
  return tight ? { name: ROW + 12, top: ROW + 18, len: 18, travel: 13, cy: ROW + 28, r: 6, val: ROW + 34, rule: 28 }
    : { name: ROW + 15, top: ROW + 22, len: 31, travel: 26, cy: ROW + 38, r: 9, val: ROW + 45, rule: 46 };
}
function rowGround(g, v, keys, tight) {
  var G = rowGeo(tight);
  g.fill(0, ROW, 960, 160 - ROW, PANEL);
  g.fill(0, ROW, 960, 1, FRAME_DIM);
  for (var c = 1; c < 8; c++) g.fill(c * 120, ROW + 8, 1, G.rule, FRAME_DIM);
  for (var i = 0; i < 8; i++) {
    var k = keys[i], x = i * 120, kind = kindOf(v, k);
    if (!k) continue;
    g.text(x + 60, G.name, legend(v, k), PRINT, 0, 112);
    if (kind === "slider") {
      g.fill(x + 22, G.top - 1, 6, G.len + 2, "#2c2d30");
      g.fill(x + 23, G.top, 4, G.len, SLOT);
      for (var j = 0; j <= 5; j++) g.fill(x + (j % 5 === 0 ? 13 : 15), G.top + Math.round(j * (G.len - 1) / 5), j % 5 === 0 ? 7 : 5, 1, PRINT_DIM);
    } else if (kind === "range") { // the VCO's RANGE: a rotary switch, five feet
      for (var r = 0; r < 5; r++) {
        var ra = Math.PI * 0.75 + Math.PI * 1.5 * r / 4;
        g.line(x + 25 + Math.cos(ra) * (G.r + 3), G.cy + Math.sin(ra) * (G.r + 3), x + 25 + Math.cos(ra) * (G.r + 6), G.cy + Math.sin(ra) * (G.r + 6), 1, PRINT_DIM);
      }
      g.dot(x + 25, G.cy, G.r, "#3b3c40");
    }
  }
}
function rowValues(g, v, keys, tight) {
  var t = v.$touched || "", G = rowGeo(tight);
  for (var i = 0; i < 8; i++) {
    var k = keys[i], x = i * 120;
    if (!k) continue;
    var hot = t === k, kn = known(v, k), f = fr(v, k, 0), kind = kindOf(v, k);
    if (hot) {
      g.fill(x + 6, G.name - 10, 108, 13, "slot");
      g.text(x + 60, G.name, legend(v, k), "black", 0, 104);
    }
    if (kind === "slider") {
      var cy = G.top + G.len - 3 - Math.round(f * G.travel);
      if (kn) { g.fill(x + 17, cy - 3, 16, 7, hot ? "slot" : CAP); g.fill(x + 17, cy, 16, 1, CAP_LINE); }
    } else if (kind === "range") {
      if (kn) {
        var a = Math.PI * 0.75 + Math.PI * 1.5 * f;
        g.line(x + 25 + Math.cos(a) * 2, G.cy + Math.sin(a) * 2, x + 25 + Math.cos(a) * G.r, G.cy + Math.sin(a) * G.r, 2, hot ? "slot" : PRINT);
      }
      if (hot) g.arc(x + 25, G.cy, G.r + 3.5, 0, Math.PI * 2, 2, "slot");
    } else { // a switch: a lamp a position, the set one lit
      var n = positions(v, k), at = Math.round(f * (n - 1)), step = Math.min(8, (G.len - 2) / (n - 1));
      for (var p = 0; p < n; p++) g.dot(x + 25, G.top + G.len - 2 - p * step, 2.6, kn && p === at ? (hot ? "slot" : LED) : "#5e2820");
    }
    g.value(x + 44, G.val, shown(v, k), kn ? (hot ? "slot" : PRINT) : PRINT_DIM, -1, 72);
  }
}

// ---- pictures shared by the panel and the band screens -------------------------------------

// the pulse at its width; behind it, the band where PWM takes its edge
// (the LFO's swing, or the envelope's from its floor to its peak)
function pwmSwing(v) {
  var mode = pick(v, "pwm_mode", PWM_MODES);
  if (mode === 2) return 0.42 * depthCurve(num(v, "pwm_depth", 0) + num(v, "lfo_pwm", 0));
  if (mode === 0) return 0.45 * num(v, "pwm_env_depth", 0);
  return 0;
}
function pulseWave(g, v, x, y, w, h, cyc, t, col) {
  var pw = num(v, "pulse_width", 0.5), sw = pwmSwing(v);
  if (sw > 0.005) {
    var a = Math.max(0.05, pw - sw), b = Math.min(0.95, pw + sw);
    for (var c = 0; c < cyc; c++) g.fill(x + w * (c + a) / cyc, y, Math.max(1, w * (b - a) / cyc), h, /^(pwm_|lfo_pwm)/.test(t) ? "#4a3a2a" : "#3b3c40");
  }
  g.poly(cached("pw|" + pw.toFixed(3) + "|" + x + "|" + w + "|" + cyc, function () {
    var pts = [];
    for (var c2 = 0; c2 < cyc; c2++) {
      var x0 = x + w * c2 / cyc, x1 = x + w * (c2 + pw) / cyc, x2 = x + w * (c2 + 1) / cyc;
      pts.push(x0, y + h, x0, y, x1, y, x1, y + h, x2, y + h);
    }
    return pts;
  }), 2, known(v, "pulse_width") ? (t === "pulse_width" ? "slot" : (col || CURVE)) : PRINT_DIM);
}

// the filter as it stands at middle C, on Pung's axis (20 Hz to 20 kHz over
// three decades): the response stands at its place (g.filter's at), as the
// engine maps the knob (the knob's travel would put 1.76 kHz at 210 Hz); the
// key keeps the live spectrum behind it. Under the curve: where the envelope
// takes it (mod), the LFO's swing (dim).
function place(hz) { return Math.log(Math.max(20, hz) / 20) / Math.LN10 / 3; }
function envReach(v) {
  var e = num(v, "env_amt", 0);
  if (on(v, "filter_env_full_range") && !on(v, "filter_env_polarity")) e *= 2;
  return on(v, "filter_env_polarity") ? -e : e;
}
// h is the whole area: the response above, two rows under it (ENV, LFO)
function filterWithReach(g, v, x, y, w, h, t) {
  var c = num(v, "cutoff", 0.5), e = envReach(v), lfo = 0.5 * depthCurve(num(v, "lfo_filter", 0));
  var fh = h - 15;
  g.filter(x, y, w, fh, { cutoff: "cutoff", at: known(v, "cutoff") ? place(cutHz(c)) : undefined, resonance: "resonance", type: "LP 24 dB", color: CURVE });
  var x0 = x + 6, x1 = x + w - 6;
  function X(cn) { return x0 + (x1 - x0) * place(cutHz(Math.max(0, Math.min(1, cn)))); }
  var xc = X(c);
  function row(a, b, yy, label, col, hot) {
    g.fill(a, yy - 2, Math.max(2, b - a), 3, hot ? "slot" : col);
    g.fill(xc, yy - 4, 1, 7, hot ? "slot" : col);
    var lw = g.measure(label);
    if (b + 5 + lw <= x1 + 6) g.text(b + 5, yy + 3, label, hot ? "slot" : col, -1);
    else g.text(a - 5, yy + 3, label, hot ? "slot" : col, 1);
  }
  if (Math.abs(e) > 0.002 && known(v, "env_amt")) row(X(Math.min(c, c + e)), X(Math.max(c, c + e)), y + fh + 3, "ENV", "mod", t === "env_amt");
  if (lfo > 0.002 && known(v, "lfo_filter")) row(X(c - lfo), X(c + lfo), y + fh + 11, "LFO", PRINT_DIM, t === "lfo_filter");
  return X;
}

// ---- PANEL ----------------------------------------------------------------------------------
var PAGES = [
  { label: "VCF / ENV", keys: ["cutoff", "resonance", "env_amt", "lfo_filter", "attack", "decay", "sustain", "release"],
    lit: { VCF: 1, "VCF ENV": 1, ENV: 1 } },
  { label: "Mod / VCO / Mixer", keys: ["lfo_rate", "lfo_pitch", "octave_transpose", "pulse_width", "pulse", "saw", "sub", "noise"],
    lit: { MODULATOR: 1, VCO: 1, "SOURCE MIXER": 1 } }
];
// the sections, left to right: x, width
var S_MOD = [4, 104], S_VCO = [114, 124], S_MIX = [244, 150], S_VCF = [400, 318], S_VCA = [724, 48], S_ENV = [778, 178];
var SY = 30, SH = 70;
// the segments: the 101's sections, each under the hands (the VCF's own
// envelope, Hush One's addition, a segment of its own)
var SEGMENTS = [
  { id: "mod", label: "Modulator", rect: [S_MOD[0], SY - 6, S_MOD[1], SH + 6],
    keys: ["lfo_rate", "lfo_waveform", "lfo_trigger", "lfo_sync", "lfo_invert", "lfo_pitch", "lfo_filter", "lfo_pwm"] },
  { id: "vco", label: "VCO", rect: [S_VCO[0], SY - 6, S_VCO[1], SH + 6],
    keys: ["lfo_pitch", "octave_transpose", "pulse_width", "pwm_mode", "pwm_depth", "pwm_env_depth", "transpose", "fine_tune"] },
  { id: "mixer", label: "Mixer", rect: [S_MIX[0], SY - 6, S_MIX[1], SH + 6], keys: ["pulse", "saw", "sub", "noise", "sub_mode", "white_noise"] },
  { id: "vcf", label: "VCF", rect: [S_VCF[0], SY - 6, 218, SH + 6],
    keys: ["cutoff", "resonance", "env_amt", "lfo_filter", "key_follow", "filter_velocity_sens", "filter_env_polarity", "filter_env_full_range"] },
  { id: "fenv", label: "VCF Env", rect: [S_VCF[0] + 218, SY + 4, S_VCF[1] - 218, SH - 4],
    keys: ["f_attack", "f_decay", "f_sustain", "f_release", "filter_volume_correction"] },
  { id: "vca", label: "VCA", rect: [S_VCA[0], SY - 6, S_VCA[1], SH + 6], keys: ["vca_mode", "volume", "velocity_sens", "velocity_mode"] },
  { id: "env", label: "ENV", rect: [S_ENV[0], SY - 6, S_ENV[1], SH + 6], keys: ["attack", "decay", "sustain", "release", "gate_trig_mode", "adsr_declick"] }
];
var SEG_SECTION = { mod: "MODULATOR", vco: "VCO", mixer: "SOURCE MIXER", vcf: "VCF", fenv: "VCF ENV", vca: "VCA", env: "ENV" };

function panelGround(g, v, page, keys, tight, active) {
  var P = PAGES[page] || PAGES[0], lit = P.lit;
  // in a segment every section in full view, the active one's title lit (Pung's bar over it)
  if (active) { lit = { MODULATOR: 1, VCO: 1, "SOURCE MIXER": 1, VCF: 1, VCA: 1, ENV: 1 }; lit[SEG_SECTION[active]] = 2; }
  g.fill(0, 0, 960, 160, PANEL);
  g.fill(0, 0, 960, 20, BODY);
  g.value(10, 16, "HUSH ONE", BODY_INK, -1);
  section(g, S_MOD[0], SY, S_MOD[1], SH, "MODULATOR", lit.MODULATOR);
  section(g, S_VCO[0], SY, S_VCO[1], SH, "VCO", lit.VCO);
  section(g, S_MIX[0], SY, S_MIX[1], SH, "SOURCE MIXER", lit["SOURCE MIXER"]);
  section(g, S_VCF[0], SY, S_VCF[1], SH, "VCF", lit.VCF);
  section(g, S_VCA[0], SY, S_VCA[1], SH, "VCA", lit.VCA);
  section(g, S_ENV[0], SY, S_ENV[1], SH, "ENV", lit.ENV);
  var mw = (S_MIX[1] - 8) / 4, ml = ["PULSE", "SAW", "SUB", "NOISE"];
  for (var i = 0; i < 4; i++) g.text(S_MIX[0] + 4 + mw * (i + 0.5), SY + SH - 4, ml[i], PRINT_DIM, 0);
  g.text(S_VCA[0] + 18, SY + 28, "ENV", PRINT_DIM, -1);
  g.text(S_VCA[0] + 18, SY + 50, "GATE", PRINT_DIM, -1);
  g.text(S_VCO[0] + 8, SY + SH - 6, "RANGE", PRINT_DIM, -1);
  g.text(S_VCO[0] + S_VCO[1] - 6, SY + 52, "PWM", PRINT_DIM, 1);
  g.text(S_VCF[0] + 222, SY + 14, "VCF ENV", lit["VCF ENV"] === 2 ? "slot" : PRINT_DIM, -1);
  rowGround(g, v, keys, tight);
}

function panel(g, v) {
  var page = Math.max(0, Math.min(PAGES.length - 1, v.$page || 0)), P = PAGES[page], t = v.$touched || "";
  var keys = v.$knobs && v.$knobs.length ? v.$knobs : P.keys, tight = !!v.$segmode;
  var active = v.$segmode === "segment" ? (v.$segment || "") : "";
  g.layer(["hush1-panel", page, keys.join(","), tight, active].join("|"), function () { panelGround(g, v, page, keys, tight, active); });

  // the body: the sound's number and name, which page of how many
  var ps = v.$pages || [], pg = ps.length > 1 ? String(ps[page] || P.label).toUpperCase() + "   " + (page + 1) + "/" + ps.length : "";
  if (v.$segmode) pg = active ? "SEGMENT: " + SEG_SECTION[active] : "SEGMENTS";
  g.text(v.$segmode ? 720 : 950, 15, pg, BODY_INK, 1);
  var nm = txt(v, "preset_name");
  if (nm) g.text(112, 15, (known(v, "preset") ? "#" + (num(v, "preset", 0) + 1) + "  " : "") + nm.toUpperCase(), BODY_INK, -1, v.$segmode ? 420 : 560);

  // MODULATOR: Pung's LFO (a note restarts it when it retriggers)
  var x = S_MOD[0], hotM = /^lfo_(rate|waveform|trigger)$/.test(t);
  g.lfo(x + 4, SY + 6, S_MOD[1] - 8, SH - 24, { shape: "lfo_waveform", rate: "lfo_rate", trig: "lfo_trigger", color: CURVE });
  g.text(x + 8, SY + SH - 6, (txt(v, "lfo_waveform") || "--").toUpperCase().replace("RANDOM", "RAND"), hotM ? "slot" : PRINT_DIM, -1, 44);
  g.text(x + S_MOD[1] - 6, SY + SH - 6, known(v, "lfo_rate") ? shown(v, "lfo_rate").toUpperCase() : "", t === "lfo_rate" ? "slot" : PRINT, 1);

  // VCO: the pulse at its width, the range in feet, PWM's source
  x = S_VCO[0];
  pulseWave(g, v, x + 8, SY + 11, S_VCO[1] - 16, 28, 2, t);
  var oct = Math.round(num(v, "octave_transpose", 0)), mode = pick(v, "pwm_mode", PWM_MODES);
  g.value(x + 50, SY + SH - 5, known(v, "octave_transpose") ? FEET[Math.max(0, Math.min(4, oct + 2))] : "--", t === "octave_transpose" ? "slot" : PRINT, -1);
  g.text(x + S_VCO[1] - 6, SY + SH - 6, mode < 0 ? "--" : ["ENV", "MAN", "LFO"][mode], /^pwm_/.test(t) ? "slot" : PRINT, 1);

  // SOURCE MIXER: Pung's mixer
  x = S_MIX[0];
  g.mix(x + 4, SY + 4, S_MIX[1] - 8, SH - 18, ["pulse", "saw", "sub", "noise"], { color: CAP });

  // VCF: the response where it sounds, the envelope's reach; its own envelope
  x = S_VCF[0];
  filterWithReach(g, v, x + 2, SY + 4, 214, SH - 6, t);
  g.envelope(x + 220, SY + 16, S_VCF[1] - 224, SH - 20, { attack: "f_attack", decay: "f_decay", sustain: "f_sustain", release: "f_release", color: CURVE });

  // VCA: the switch, its lamp at the chosen side
  var vm = pick(v, "vca_mode", VCA_MODES);
  lamp(g, S_VCA[0] + 10, SY + 25, vm === 1);
  lamp(g, S_VCA[0] + 10, SY + 47, vm === 0);

  // ENV: Pung's envelope; how notes start it
  x = S_ENV[0];
  g.envelope(x + 4, SY + 13, S_ENV[1] - 8, SH - 17, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", labels: true, color: CURVE });
  var gm = txt(v, "gate_trig_mode").toUpperCase();
  if (gm) { var gw = g.measure(gm); g.fill(x + S_ENV[1] - gw - 14, SY - 5, gw + 8, 10, PANEL); g.text(x + S_ENV[1] - 10, SY + 4, gm, PRINT_DIM, 1); }

  rowValues(g, v, keys, tight);
}

push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [{ label: PAGES[0].label, keys: PAGES[0].keys }, { label: PAGES[1].label, keys: PAGES[1].keys }],
  segments: SEGMENTS, draws_segments: true,
  extra_keys: ["preset", "preset_name", "lfo_waveform", "lfo_trigger", "pwm_mode", "pwm_depth", "pwm_env_depth", "lfo_pwm",
    "f_attack", "f_decay", "f_sustain", "f_release", "vca_mode", "gate_trig_mode", "filter_env_full_range",
    "filter_env_polarity", "cutoff", "resonance", "env_amt", "lfo_filter", "attack", "decay", "sustain", "release",
    "lfo_rate", "lfo_pitch", "octave_transpose", "pulse_width", "pulse", "saw", "sub", "noise"],
  screen: function (g, v) { panel(g, v); }
});

// ---- band screens: the body's grey at the left edge; a column's left (the band starts at x 4)
function edge(g) { g.fill(0, 0, 3, g.h, BODY); }
function colX(i) { return i * 120 - 4; }
function head(g, x, y, s, hot) { g.text(x, y, s, hot ? "slot" : "dim", -1); }

// ---- MODULATOR: the LFO and what it moves ------------------------------------------------------
var LFO_SYNC = [0.125, 0.1666667, 0.25, 0.3333333, 0.5, 0.6666667, 1, 1.3333333, 2, 2.6666667, 4, 5.3333333, 8, 10.6666667, 16, 21.3333333, 32];
function syncedRate(hz) { var b = LFO_SYNC[0]; for (var i = 1; i < LFO_SYNC.length; i++) if (Math.abs(hz - LFO_SYNC[i]) < Math.abs(hz - b)) b = LFO_SYNC[i]; return b; }
// a destination: its depth as a swing about a centre line, and its words
function dest(g, x, title, depth, words, hot, live) {
  var cy = 44, h = 26;
  head(g, x + 6, 12, title, hot);
  g.line(x + 6, cy, x + 108, cy, 1, "line");
  if (live && depth > 0.002) g.fill(x + 6, cy - h * depth, 102, Math.max(2, 2 * h * depth), hot ? "#5a3a1a" : "#203a44");
  if (live && depth > 0.002) { g.fill(x + 6, cy - h * depth, 102, 2, hot ? "slot" : "mod"); g.fill(x + 6, cy + h * depth - 2, 102, 2, hot ? "slot" : "mod"); }
  g.text(x + 6, 82, words, live ? "fg" : "faint", -1, 106);
}
function modulator(g, v) {
  edge(g);
  var t = v.$touched || "";
  var hotL = /^lfo_(rate|waveform|trigger|sync|invert)$/.test(t);
  head(g, 8, 12, "LFO", hotL);
  g.lfo(4, 16, 5 * 120 - 20, 54, { shape: "lfo_waveform", rate: "lfo_rate", trig: "lfo_trigger", color: CURVE });
  var hz = num(v, "lfo_rate", 5), sy = on(v, "lfo_sync"), flags = [];
  flags.push((sy ? syncedRate(hz) : hz).toFixed(hz >= 10 ? 1 : 2) + " HZ" + (sy ? " (SYNC: ROUNDED FROM " + hz.toFixed(2) + ")" : ""));
  flags.push(on(v, "lfo_trigger") ? "EVERY NOTE RESTARTS IT" : "FREE RUNNING");
  if (on(v, "lfo_invert")) flags.push("INVERTED");
  g.text(8, 82, flags.join("   "), "dim", -1, 580);
  // the three it reaches, over their knobs
  var p = depthCurve(num(v, "lfo_pitch", 0)) * 0.85, f = 0.5 * depthCurve(num(v, "lfo_filter", 0));
  var mode = pick(v, "pwm_mode", PWM_MODES), pwm = 0.42 * depthCurve(num(v, "pwm_depth", 0) + num(v, "lfo_pwm", 0));
  dest(g, colX(5), "PITCH", Math.min(1, p / 0.85), p > 0.001 ? "+/-" + p.toFixed(2) + " ST" + (on(v, "lfo_pitch_snap") ? " STEPS" : "") : "OFF",
    t === "lfo_pitch", true);
  var c = num(v, "cutoff", 0.5);
  dest(g, colX(6), "FILTER", Math.min(1, f / 0.5), f > 0.001 ? fmtHz(cutHz(Math.max(0, c - f))).toUpperCase() + "-" + fmtHz(cutHz(Math.min(1, c + f))).toUpperCase() : "OFF",
    t === "lfo_filter", true);
  dest(g, colX(7), "PWM", Math.min(1, pwm / 0.42), mode !== 2 ? "PWM FROM " + ["ENV", "MAN"][Math.max(0, mode)] : (pwm > 0.001 ? "+/-" + Math.round(pwm * 100) + "% WIDTH" : "OFF"),
    t === "lfo_pwm", mode === 2);
}
push.compartment({
  id: "mod", label: "Modulator",
  pages: [{ label: "Modulator", keys: ["lfo_rate", "lfo_waveform", "lfo_trigger", "lfo_sync", "lfo_invert", "lfo_pitch", "lfo_filter", "lfo_pwm"] }],
  extra_keys: ["lfo_pitch_snap", "pwm_mode", "pwm_depth", "cutoff"],
  screen: modulator
});

// ---- VCO: range, the pulse and its modulation -------------------------------------------------
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function vco(g, v) {
  edge(g);
  var t = v.$touched || "";
  // RANGE: the five feet, the one set lit
  var oct = Math.round(num(v, "octave_transpose", 0)), hotR = t === "octave_transpose";
  head(g, 8, 12, "RANGE", hotR);
  for (var i = 0; i < 5; i++) {
    var lx = 8 + i * 23, lit = known(v, "octave_transpose") && oct === i - 2;
    g.dot(lx + 8, 27, 2.6, lit ? (hotR ? "slot" : LED) : LED_OFF);
    g.text(lx + 8, 43, FEET[i], lit ? "fg" : "dim", 0);
  }
  // what a middle C sounds as
  var semis = oct * 12 + Math.round(num(v, "transpose", 0)), cents = Math.round(num(v, "fine_tune", 0)), n = 60 + semis;
  head(g, colX(1) + 10, 12, "MIDDLE C PLAYS", t === "transpose" || t === "fine_tune");
  var pk = known(v, "octave_transpose") && known(v, "transpose");
  if (pk) g.value(colX(1) + 10, 43, NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1) + (cents ? (cents > 0 ? " +" : " ") + cents + " ct" : ""), "fg", -1, 220);
  if (pk) g.text(colX(1) + 10, 62, semis === 0 ? "AT PITCH" : (semis > 0 ? "+" : "") + semis + " SEMITONES", "dim", -1, 220);
  // PWM: the 101's switch, LFO / MAN / ENV
  var mode = pick(v, "pwm_mode", PWM_MODES), sw = pwmSwing(v), sx = colX(3) + 10;
  head(g, sx, 12, "PWM", t === "pwm_mode");
  var opts = [["LFO", 2], ["MAN", 1], ["ENV", 0]];
  for (var j = 0; j < 3; j++) {
    var sel = mode === opts[j][1];
    g.dot(sx + 4, 27 + j * 17, 2.6, sel ? (t === "pwm_mode" ? "slot" : LED) : LED_OFF);
    g.text(sx + 14, 31 + j * 17, opts[j][0], sel ? "fg" : "dim", -1);
  }
  // the pulse: its width, and where the chosen source takes it
  var x = colX(4) + 8, w = 3 * 120 - 16;
  head(g, x, 12, "PULSE", t === "pulse_width");
  pulseWave(g, v, x, 20, w, 42, 3, t);
  g.text(x, 80, known(v, "pulse_width") ? "WIDTH " + Math.round(num(v, "pulse_width", 0.5) * 100) + "%" : "", t === "pulse_width" ? "slot" : "fg", -1);
  g.text(colX(5) + 10, 80, "LFO " + (mode === 2 ? "+/-" + Math.round(sw * 100) + "%" : "OFF"), t === "pwm_depth" ? "slot" : (mode === 2 ? "fg" : "faint"), -1);
  g.text(colX(6) + 10, 80, "ENV " + (mode === 0 ? "+/-" + Math.round(sw * 100) + "%" : "OFF"), t === "pwm_env_depth" ? "slot" : (mode === 0 ? "fg" : "faint"), -1);
  // the LFO's pitch: smooth, or in semitones
  var x7 = colX(7) + 10, sn = on(v, "lfo_pitch_snap");
  head(g, x7, 12, "LFO PITCH", t === "lfo_pitch_snap");
  if (!known(v, "lfo_pitch_snap")) return;
  g.text(x7, 30, sn ? "IN SEMITONES" : "SMOOTH", "fg", -1, 104);
  g.poly(sn ? [x7, 66, x7 + 20, 66, x7 + 20, 56, x7 + 40, 56, x7 + 40, 46, x7 + 60, 46, x7 + 60, 56, x7 + 80, 56, x7 + 80, 66, x7 + 100, 66]
    : [x7, 66, x7 + 50, 46, x7 + 100, 66], 2, t === "lfo_pitch_snap" ? "slot" : CURVE);
}
push.compartment({
  id: "vco", label: "VCO",
  pages: [{ label: "VCO", keys: ["octave_transpose", "transpose", "fine_tune", "pwm_mode", "pulse_width", "pwm_depth", "pwm_env_depth", "lfo_pitch_snap"] }],
  extra_keys: ["lfo_pwm"],
  screen: vco
});

// ---- SOURCE MIXER: the four levels, and the wave they make -----------------------------------
// The engine sums them and saturates the sum (tanh(1.4 * 0.42 * sum)): drawn
// so. Noise is a band around the pitched wave (drawn into the curve it would
// hide the wave it rides on).
function mixer(g, v) {
  edge(g);
  var t = v.$touched || "";
  g.mix(4, 2, 4 * 120 - 12, 82, ["pulse", "saw", "sub", "noise"], { color: CAP });
  var lv = [num(v, "pulse", 0), num(v, "saw", 0), num(v, "sub", 0), num(v, "noise", 0)];
  var pw = num(v, "pulse_width", 0.5), sm = pick(v, "sub_mode", SUB_MODES), wn = on(v, "white_noise");
  var x = colX(4) + 10, w = 4 * 120 - 20, mid = 44, a = 32;
  head(g, x, 12, "OUT OF THE MIXER", false);
  g.text(x + w, 12, "SUB: " + (sm < 0 ? "--" : SUB_SAYS[sm]) + "   NOISE: " + (wn ? "WHITE" : "COLOURED"), t === "sub_mode" || t === "white_noise" ? "slot" : "dim", 1);
  g.line(x, mid, x + w, mid, 1, "line");
  var key = [lv.join(","), pw.toFixed(3), sm, wn].join("|");
  // the scale: the loudest the sum gets (with the noise's share), at full height
  var full = Math.tanh(1.4 * 0.42 * (lv[0] * 0.98 + lv[1] + lv[2] + lv[3])) || 1;
  var pts = cached("sum|" + key, function () {
    var out = [], n = 220, cyc = sm === 0 ? 4 : 8, prev = null;
    for (var i = 0; i <= n; i++) {
      var ph = cyc * Math.min(i / n, 0.99999), s = lv[0] * pulseAt(ph, pw) + lv[1] * sawAt(ph) + lv[2] * subAt(ph, Math.max(0, sm));
      var y = mid - Math.tanh(1.4 * 0.42 * s) / full * a;
      if (prev !== null && Math.abs(y - prev) > a * 0.5) out.push(x + w * i / n, prev);
      out.push(x + w * i / n, y);
      prev = y;
    }
    return out;
  });
  if (lv[3] > 0.005) { // the noise: a band as wide as its share
    var nb = Math.tanh(1.4 * 0.42 * lv[3]) / full * a * (wn ? 1 : 0.8);
    g.poly(cached("nz|" + nb.toFixed(1) + "|" + x, function () {
      var z = [], seed = 7;
      for (var i = 0; i <= 150; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; z.push(x + w * i / 150, mid + nb * (seed / 1073741824 - 1)); }
      return z;
    }), 1, t === "noise" || t === "white_noise" ? "slot" : "#55575c");
  }
  g.poly(pts, 2, lv[0] + lv[1] + lv[2] > 0.005 ? CURVE : "faint");
}
push.compartment({
  id: "mixer", label: "Mixer",
  pages: [{ label: "Source Mixer", keys: ["pulse", "saw", "sub", "noise", "sub_mode", "white_noise"] }],
  extra_keys: ["pulse_width"],
  screen: mixer
});

// ---- VCF: the response where it sounds, and what moves it -------------------------------------
var KEYS_SHOWN = [36, 60, 84]; // C2, C4, C6: where the keyboard takes the cutoff
function vcf(g, v) {
  edge(g);
  var t = v.$touched || "", w = 6 * 120 - 16;
  var X = filterWithReach(g, v, 4, 0, w, 86, t);
  // the keyboard: where a low and a high C put the cutoff (follow * octaves from C4)
  var kf = num(v, "key_follow", 0), c = num(v, "cutoff", 0.5), hotK = t === "key_follow";
  if (kf > 0.005 && known(v, "cutoff")) {
    for (var i = 0; i < 3; i++) {
      if (i === 1) continue;
      var hz = Math.max(20, Math.min(18000, cutHz(c) * Math.pow(2, (KEYS_SHOWN[i] - 60) / 12 * kf)));
      var px = 10 + (w - 12) * place(hz);
      g.fill(px, 12, 1, 8, hotK ? "slot" : "dim");
      g.text(px, 10, i === 0 ? "C2" : "C6", hotK ? "slot" : "dim", 0);
    }
  }
  void X;
  // in words, over their knobs
  var x = colX(6) + 10, vs = num(v, "filter_velocity_sens", 0);
  head(g, x, 12, "KEYBOARD", hotK);
  g.text(x, 26, !known(v, "key_follow") ? "--" : (kf > 0.005 ? Math.round(kf * 100) + "% OF EACH OCTAVE" : "FIXED"), "fg", -1, 220);
  head(g, x, 44, "VELOCITY", t === "filter_velocity_sens");
  var vm = txt(v, "velocity_mode").toLowerCase();
  if (known(v, "filter_velocity_sens")) g.text(x, 58, vm === "off" ? "OFF (VELOCITY MODE)" : (vs > 0.005 ? "SOFT NOTES UP TO " + Math.round(vs * 27) + "% LOWER" : "NONE"), vm === "off" ? "faint" : "fg", -1, 220);
  var e = envReach(v), hotE = t === "filter_env_polarity" || t === "filter_env_full_range";
  if (known(v, "filter_env_polarity")) g.text(x, 80, (e < 0 ? "ENV CLOSES" : "ENV OPENS") + (on(v, "filter_env_full_range") && !on(v, "filter_env_polarity") ? "  FULL RANGE" : ""), hotE ? "slot" : "dim", -1, 220);
}
push.compartment({
  id: "vcf", label: "VCF",
  extra_keys: ["velocity_mode"],
  pages: [
    { label: "VCF", keys: ["cutoff", "resonance", "env_amt", "lfo_filter", "key_follow", "filter_velocity_sens", "filter_env_polarity", "filter_env_full_range"], screen: vcf },
    { label: "VCF Env", keys: ["f_attack", "f_decay", "f_sustain", "f_release", "filter_volume_correction"] }
  ]
});

// ---- VCA and ENV: Pung's own pages (its envelope) ------------------------------------------------
push.compartment({
  id: "env", label: "VCA / ENV",
  pages: [
    { label: "ENV", keys: ["attack", "decay", "sustain", "release", "adsr_declick"] },
    { label: "VCA", keys: ["vca_mode", "volume", "velocity_sens", "velocity_mode"] }
  ]
});

// ---- PLAY: how keys play it ---------------------------------------------------------------------
// Three notes on a timeline: the second pressed while the first is held (a
// tied note), the third after a gap. The pitch line glides where the
// portamento says (ON: every note; AUTO: tied notes only), over the glide
// time on the drawn scale; under each note, whether it starts the envelopes
// again (the ENV switch: GATE+TRIG always, GATE only with Retrigger on a
// tied note, LFO never: the LFO does).
var TL_MS = 1600;
function play(g, v) {
  edge(g);
  var t = v.$touched || "", x0 = 12, w = 5 * 120 - 28;
  function X(ms) { return x0 + w * ms / TL_MS; }
  var pm = pick(v, "portamento_mode", PORTA), lin = on(v, "portamento_linear"), gl = Math.max(0, num(v, "glide", 0));
  var gm = pick(v, "gate_trig_mode", GATE_MODES), rt = txt(v, "retrigger").toLowerCase() === "trig" || txt(v, "retrigger") === "1";
  var notes = [[0, 700, 0.15], [450, 1000, 0.75], [1150, 1550, 0.4]]; // start, end (ms), height
  var yOf = function (lv) { return Math.round(48 - lv * 36); };
  // the keys
  for (var i = 0; i < 3; i++) {
    g.fill(X(notes[i][0]), i === 1 ? 70 : 64, X(notes[i][1]) - X(notes[i][0]), 4, "#55565a");
  }
  g.text(X(450), 86, "TIED", "dim", -1);
  g.text(X(1150), 86, "APART", "dim", -1);
  // the pitch
  var hotG = t === "glide" || t === "portamento_mode" || t === "portamento_linear";
  var pts = cached(["gl", pm, lin, gl.toFixed(0)].join("|"), function () {
    var out = [X(0), yOf(notes[0][2])];
    for (var n = 1; n < 3; n++) {
      var from = notes[n - 1][2], to = notes[n][2], st = notes[n][0], tied = n === 1;
      var glides = gl > 0.5 && (pm === 1 || (pm === 2 && tied));
      out.push(X(st), yOf(from));
      if (!glides) { out.push(X(st), yOf(to)); continue; }
      var endMs = n === 1 ? notes[2][0] : TL_MS;
      for (var k = 1; k <= 24; k++) {
        var tm = (endMs - st) * k / 24, f = lin ? Math.min(1, tm / gl) : 1 - Math.exp(-tm / gl);
        out.push(X(st + tm), yOf(from + (to - from) * f));
      }
    }
    out.push(X(TL_MS), yOf(notes[2][2]));
    return out;
  });
  g.poly(pts, 2, pm < 0 ? "faint" : (hotG ? "slot" : CURVE));
  // where the envelopes start again
  var hotT = t === "gate_trig_mode" || t === "retrigger";
  for (var j = 0; j < 3 && gm >= 0; j++) {
    var tied2 = j === 1, trig = gm === 1 ? true : (gm === 0 ? (!tied2 || rt) : !tied2);
    var px = X(notes[j][0]);
    g.fill(px, 54, 2, 20, trig ? (hotT ? "slot" : LED) : "#3a3a3a");
    g.text(px + 5, 60, trig ? "ENV" : "", hotT ? "slot" : LED, -1);
  }
  // in words, over their knobs
  var x = colX(5) + 10;
  head(g, x, 12, "PORTAMENTO", hotG);
  if (pm >= 0) g.text(x, 26, pm === 0 ? "OFF" : (pm === 1 ? "EVERY NOTE GLIDES" : "AUTO: TIED NOTES GLIDE"), "fg", -1, 340);
  if (pm > 0) g.text(x, 40, pm === 0 ? "" : Math.round(gl) + " MS, " + (lin ? "LINEAR" : "EXPONENTIAL"), "dim", -1, 340);
  head(g, x, 60, "ENV TRIGGER", hotT);
  if (gm >= 0) g.text(x, 74, gm === 1 ? "GATE+TRIG: EVERY NOTE" : (gm === 0 ? (rt ? "GATE: EVERY NOTE (RETRIGGER)" : "GATE: NOT ON TIED NOTES") : "LFO: THE LFO RETRIGGERS WHILE HELD"), "fg", -1, 340);
}
push.compartment({
  id: "play", label: "Play",
  pages: [
    { label: "Play", keys: ["glide", "portamento_mode", "portamento_linear", "gate_trig_mode", "retrigger", "priority", "hold", "bend_range"], screen: play },
    { label: "Play +", keys: ["same_note_quirk", "preset"] }
  ]
});
