// Aphex (a hybrid of the classic Japanese semi-modular monos of 1978: two
// VCOs, a high pass and a low pass in cascade with their peaks, two
// envelopes, a modulation generator, an external signal processor and a
// patch panel; the module's own name) on Push. An overlay shipped with Pung
// (the module ships no push_ui.js).
//
// The instrument is its black panel with white print: the synth's sections
// on the left, the patch panel on the right, and the patch cables that make
// it what it is. The module exposes each input jack as a parameter naming
// what is plugged into it (pb_*): the screens draw those as cables.
//
//   PANEL      the front panel: VCO 1 and 2 (wave, scale, level, sync and
//              ring), both filters' responses (Pung's, live), EG 1 and EG 2
//              (Pung's envelopes, on the engine's times), the MG, and the
//              cables patched now, source jack to input jack
//   VCO 1+2    both oscillators' waves as they sound (pulse width, sync,
//              ring) and the mix of the two
//   MIXER      Pung's mixer over the sources; the FREQUENCY MODULATION pair
//              (MG/T.EXT, EG1/EXT) with what the patch panel feeds them
//   FILTERS    the high pass and the low pass side by side in the cascade's
//              order, each with its two attenuators and their sources
//   EG 1, EG 2 both envelopes, with where each one goes
//   MG         its two outputs (the slope, the rectangle) and where they go
//   ESP        the external signal processor as its panel prints it: signal
//              in, pre amp, band pass, then the envelope follower, the F/V
//              converter and the Schmitt trigger, and where each output is
//              patched
//   PATCHBAY   the patch panel: the eleven input jacks, the outputs, and the
//              cables between them, hanging; a jack left alone shows its
//              normalled source, a jack set to None a dummy plug
//   MODERN     Pung's own page (drift, MS-10 mode, the wheel, velocity)
//
// The engine (src/dsp/aphex.c): cutoffs 20 Hz * 900^c, the key tracking
// adds (note - 60) / 12 * track octaves; MG 0.05 * 800^r Hz, its slope
// rising (0), triangle (0.5), falling (1), its rectangle's duty 1 - pw; EG 1
// delay, an exponential attack (to the top in about 3 x its time), the top
// held, a linear release; EG 2 the same with its Hold as a delay before the
// attack, a linear decay to the sustain; ESP lo cut 50 * 50^x Hz, hi cut
// 100 * 50^x Hz, the gate opens at the threshold and closes at 0.7 of it.
// VCO 2's pitch is semitones (-24..24); scales are 32' to 4' (VCO 1) and
// 16' to 2' (VCO 2).

// ---- the panel's colours ---------------------------------------------------------------
var PANEL = "#0f0f0f", SILK = "#ecebe5", SILK_DIM = "#8f8e88", SILK_FAINT = "#3a3a38", SILK_LINE = "#5c5c58";
var CAP = "#050505", CAP_RIM = "#3c3c3a", NUT = "#8d8d88", NUT_LO = "#2a2a29", HOLE = "#000000";
var LED = "#ff3d2e", LED_OFF = "#4a1611", WIN = "#000000";
// the cables: a colour an input jack, so a cable keeps its colour on every screen
var CABLE = ["#e6c229", "#e4473a", "#3f8fe6", "#4cc062", "#d36fd0", "#f08c2e", "#7fd8d2", "#c7e05a", "#ff8fb4", "#a58cff", "#e8e6df"];
var CABLE_DK = "#000000";

// ---- values ------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? Math.max(0, Math.min(1, v[k].frac)) : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function opt(v, k) { return known(v, k) ? String(v[k].value) : ""; }
function on(v, k) { var s = opt(v, k).toLowerCase(); return s === "on" || s === "1"; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

// ---- the engine's units ------------------------------------------------------------------------
function cutHz(c) { return 20 * Math.pow(900, c); }
function atOf(v, k) { return clamp(Math.log(cutHz(num(v, k, 0.5)) / 20) / Math.LN10 / 3, 0, 1); }
function mgHz(r) { return 0.05 * Math.pow(800, r); }
function fmtHz(h) { return h >= 1000 ? (h >= 9950 ? Math.round(h / 1000) : (h / 1000).toFixed(1)) + " kHz" : (h >= 10 ? Math.round(h) : h.toFixed(h >= 1 ? 1 : 2)) + " Hz"; }
function fmtS(s) { return s >= 1 ? s.toFixed(s >= 9.95 ? 0 : 2) + " s" : (s * 1000 >= 10 ? Math.round(s * 1000) : (s * 1000).toFixed(1)) + " ms"; }
function pct(f) { return Math.round(f * 100) + "%"; }
function sgn(n, d) { var s = n.toFixed(d); return (n > 0 && s !== (0).toFixed(d) ? "+" : "") + s; }
function bip(v, k) { return num(v, k, 0); } // a -1..1 attenuator
function mode(v) { return on(v, "ms10_mode") ? "LP only" : (opt(v, "filter_mode") || "HP+LP"); }
function rev(v) { return /rev\.?\s*2|ota/i.test(opt(v, "filter_rev")) ? "REV.2 OTA" : "REV.1 K35"; }
function mgShape(v) { var s = fr(v, "mg_shape", 0.5); return s < 0.25 ? "Saw Up" : (s > 0.75 ? "Saw Down" : "Triangle"); }
function mgShapeWord(v) { var s = fr(v, "mg_shape", 0.5); return s < 0.25 ? "RISING" : (s > 0.75 ? "FALLING" : "TRIANGLE"); }

// how a value reads, in the engine's own unit, everywhere Pung writes it (push.display)
var BIPOLAR = { vco_mg: 1, vco_eg: 1, hpf_mg: 1, hpf_eg: 1, lpf_mg: 1, lpf_eg: 1, esp_cv_adj: 1, v2_detune: 1 };
var PERCENT = { hpf_reso: 1, lpf_reso: 1, mg_depth: 1, mg_shape: 1, mg_pw: 1, drive: 1, volume: 1, portamento: 1, v1_pw: 1, v2_pw: 1,
  mix_v1: 1, mix_v2: 1, mix_sub: 1, mix_noise: 1, mix_esp: 1, mix_fb: 1, e2_sus: 1, esp_threshold: 1, esp_pitch_slew: 1, esp_aud_mix: 1,
  drift: 1, key_track: 1, v1_drift: 1, v2_drift: 1, x_mod_amt: 1, mw_mg: 1, mw_filt: 1, vel_amt: 1 };
function vu(s) { var m = /^(-?[\d.]+)\s*(.*)$/.exec(s); return m ? { value: m[1], unit: m[2] } : { value: s }; }
function readout(k, raw) {
  if (k === "filter_rev") return /2|ota/i.test(raw) ? { value: "Rev.2 OTA" } : { value: "Rev.1 K35" };
  if (k === "rnd_patch" || k === "mutate" || k === "rnd_mod" || k === "reset_patch" || k === "trigger") return { value: "Turn" };
  var n = parseFloat(raw);
  if (isNaN(n)) return null;
  switch (k) {
  case "hpf_cut": case "lpf_cut": return vu(fmtHz(cutHz(n)));
  case "mg_freq": return vu(fmtHz(mgHz(n)));
  case "master_tune": return { value: sgn(Math.round(n * 100), 0), unit: "ct" };
  case "v2_fine": return { value: sgn(n, Math.abs(n) >= 10 ? 0 : 1), unit: "st" };
  case "octave": return { value: sgn(n, 0) };
  case "esp_lo_cut": return vu(fmtHz(50 * Math.pow(50, n)));
  case "esp_hi_cut": return vu(fmtHz(100 * Math.pow(50, n)));
  case "esp_in_gain": return { value: "x" + n.toFixed(2) };
  }
  if (/^(e1|e2|esp_env)_/.test(k) && k !== "e2_sus") return vu(fmtS(n));
  if (BIPOLAR[k]) return { value: sgn(Math.round(n * 100), 0), unit: "%" };
  if (PERCENT[k]) return { value: String(Math.round(n * 100)), unit: "%" };
  return null;
}
push.display(function (key, raw) { return readout(key, raw) || undefined; });
function shown(v, k) {
  if (!known(v, k)) return "--";
  var r = readout(k, String(v[k].value));
  return r ? r.value + (r.unit ? " " + r.unit : "") : txt(v, k);
}
var NAMES = { hpf_cut: "HP CUTOFF", hpf_reso: "HP PEAK", lpf_cut: "LP CUTOFF", lpf_reso: "LP PEAK", mg_freq: "MG FREQ", mg_depth: "MG DEPTH",
  drive: "DRIVE", volume: "VOLUME", preset: "PATCH", octave: "OCTAVE", portamento: "PORTAMENTO", master_tune: "MASTER TUNE",
  rnd_patch: "RANDOM", mutate: "MUTATE", rnd_mod: "RANDOM MOD", reset_patch: "RESET" };

// Pung's envelope dots run on the engine's times: the knobs are seconds; an
// attack approaches 1.05 and reaches the top in ln 21 = 3.04 times its knob
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined || !/^e[12]_/.test(s.key || "") || s.key === "e2_sus") return null;
    var x = parseFloat(s.raw);
    if (isNaN(x)) return null;
    return /_atk$/.test(s.key) ? x * 3.04 : x;
  });
});

// ---- the patch panel ------------------------------------------------------------------------------
// the input jacks: key, legend, its normalled source (what plays with no cable)
var INS = [
  ["pb_kbd_cv", "VCO 1+2 CV", "KBD"], ["pb_total", "TOTAL", "MG"], ["pb_freq", "FREQ", "EG 1"], ["pb_hpf_cv", "HP CUTOFF", "EG 1"],
  ["pb_lpf_cv", "LP CUTOFF", "EG 1"], ["pb_vca_in", "INITIAL GAIN", ""], ["pb_pwm_in", "PWM", ""], ["pb_ext_sig", "EXT SIGNAL", ""],
  ["pb_vco2_cv", "VCO 2 CV", ""], ["pb_eg1_trig", "EG 1 TRIG", ""], ["pb_eg12_trig", "EG 1+2 TRIG", ""]];
// the output jacks, in the panel's groups
var OUTS = [
  ["mgtri", "MG TRI"], ["mgsq", "MG RECT"], ["eg1", "EG 1"], ["eg1r", "EG1 REV"], ["eg2", "EG 2"], ["eg2r", "EG2 REV"],
  ["sh", "S&H"], ["noise", "NOISE"], ["wheel", "WHEEL"], ["kbd", "KBD CV"],
  ["espcv", "ESP CV"], ["espenv", "ESP ENV"], ["espgate", "ESP GATE"], ["espaud", "ESP AUDIO"], ["trigcv", "TRIG CV"], ["mix", "MIXER"],
  ["trk1", "TRACK 1"], ["trk2", "TRACK 2"], ["trk3", "TRACK 3"], ["trk4", "TRACK 4"]];
var OUT_OF = { "mg": "mgtri", "mg tri": "mgtri", "mg sq": "mgsq", "eg1": "eg1", "eg2": "eg2", "eg1 rev": "eg1r", "eg2 rev": "eg2r",
  "s&h": "sh", "noise": "noise", "wheel": "wheel", "kbd cv": "kbd", "esp cv": "espcv", "esp env": "espenv", "esp gate": "espgate",
  "esp audio": "espaud", "trig cv": "trigcv", "mixer out": "mix", "track 1": "trk1", "track 2": "trk2", "track 3": "trk3", "track 4": "trk4" };
function outLabel(id) { for (var i = 0; i < OUTS.length; i++) if (OUTS[i][0] === id) return OUTS[i][1]; return ""; }
// what a jack holds: {cable: output id} | {normal: true} | {dummy: true} (None where a source is normalled) | {empty: true}
function jack(v, j) {
  var s = opt(v, INS[j][0]).toLowerCase();
  if (!s) return { unknown: true };
  if (s === "normal" || (INS[j][2] && OUT_OF[s] && INS[j][2].replace(" ", "").toLowerCase() === s.replace(" ", "") && j !== 0)) return { normal: true };
  if (s === "none") return INS[j][2] ? { dummy: true } : { empty: true };
  var id = OUT_OF[s];
  return id ? { cable: id } : { unknown: true };
}
// a jack on the panel: the nut, the hole
function socket(g, x, y, r) { g.dot(x, y, r, NUT); g.dot(x, y, r - 1.5, NUT_LO); g.dot(x, y, r * 0.45, HOLE); }
function plug(g, x, y, r, c) { g.dot(x, y, r, c); g.dot(x, y, r * 0.45, CABLE_DK); }
// a cable between two jacks, hanging: a curve sagging under its weight, resting on the floor
function cablePts(x0, y0, x1, y1, floor) {
  var dx = Math.abs(x1 - x0), sag = 14 + dx * 0.08 + Math.abs(y1 - y0) * 0.2, pts = [];
  for (var i = 0; i <= 24; i++) {
    var t = i / 24, u = 1 - t;
    var x = u * u * u * x0 + 3 * u * u * t * (x0 + (x1 - x0) * 0.15) + 3 * u * t * t * (x1 - (x1 - x0) * 0.15) + t * t * t * x1;
    var y = u * u * u * y0 + 3 * u * u * t * (y0 + sag) + 3 * u * t * t * (y1 + sag) + t * t * t * y1;
    pts.push(x, Math.min(y, floor));
  }
  return pts;
}
function cable(g, pts, c, w) { g.poly(pts, (w || 3) + 2, CABLE_DK); g.poly(pts, w || 3, c); }

// ---- waves ------------------------------------------------------------------------------------
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
function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
// VCO 1: Tri, Saw, PW-Square, Noise; VCO 2: Saw, Square, Pulse, Ring
// a wave's name as a code, once a draw (not once a sample)
function code1(w) { return /tri/i.test(w) ? 0 : /saw/i.test(w) ? 1 : /noise/i.test(w) ? 2 : 3; }
function code2(w) { return /ring/i.test(w) ? 0 : /saw/i.test(w) ? 1 : /square/i.test(w) ? 2 : 3; }
function vco1(c, ph, pw) {
  var p = ph - Math.floor(ph);
  if (c === 0) return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  if (c === 1) return 1 - 2 * p;
  if (c === 2) return rnd(Math.floor(ph * 29)) * 0.85;
  return p < pw ? 1 : -1;
}
function vco2(c, ph, pw, o1) {
  var p = ph - Math.floor(ph);
  if (c === 0) return o1 * (p < 0.5 ? 1 : -1);
  if (c === 1) return 1 - 2 * p;
  if (c === 2) return p < 0.5 ? 1 : -1;
  return p < (pw || 0.15) ? 1 : -1;
}
var V1_SCALE = { "32'": -24, "16'": -12, "8'": 0, "4'": 12 }, V2_SCALE = { "16'": -12, "8'": 0, "4'": 12, "2'": 24 };
// VCO 2 against VCO 1, in semitones
function interval(v) {
  var a = V1_SCALE[opt(v, "v1_pitch")] || 0, b = V2_SCALE[opt(v, "v2_pitch")] || 0;
  return b - a + num(v, "v2_fine", 0) + num(v, "v2_detune", 0);
}

// ---- the panel's parts -------------------------------------------------------------------------
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
// a knob as the panel prints it: the scale's eleven ticks, the black cap
function knobCap(g, x, y, r) {
  for (var i = 0; i <= 10; i++) {
    var a = A0 + i / 10 * SWEEP, c = Math.cos(a), s = Math.sin(a);
    g.line(x + c * (r + 3), y + s * (r + 3), x + c * (r + (i % 5 ? 5 : 7)), y + s * (r + (i % 5 ? 5 : 7)), 1, i % 5 ? SILK_DIM : SILK);
  }
  g.dot(x, y, r, CAP_RIM); g.dot(x, y, r - 1.5, CAP);
}
function pointer(g, x, y, r, f, c, w) {
  var a = A0 + f * SWEEP;
  g.line(x, y, x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2), w || 2, c);
}
// a section's title as the panel prints it: the words, a rule running on to the section's end
function title(g, x, w, y, s, hot) {
  g.text(x, y, s, hot ? "slot" : SILK, -1);
  var tw = g.measure(s) + 6;
  if (w > tw + 4) g.fill(x + tw, y - 4, w - tw, 1, SILK_LINE);
}
function led(g, x, y, lit) { g.dot(x, y, 2.5, lit ? LED : LED_OFF); }

// ---- PANEL --------------------------------------------------------------------------------------
var VX = 8, FX = 160, EX = 398, PX = 636;
function panelGround(g, kn, compact) {
  g.fill(0, 0, 960, 160, PANEL);
  g.value(8, 16, "APHEX", SILK, -1);
  title(g, VX, 118, 31, "VCO 1 / 2", false);
  g.text(VX + 144, 31, "LVL", SILK_DIM, 1);
  title(g, FX, 112, 31, "HIGH PASS", false);
  title(g, FX + 120, 112, 31, "LOW PASS", false);
  title(g, EX, 112, 31, "EG 1", false);
  title(g, EX + 120, 112, 31, "EG 2", false);
  title(g, PX, 72, 31, "MG", false);
  title(g, PX + 82, 236, 31, "PATCH", false);
  g.text(VX, 48, "1", SILK_DIM, -1); g.text(VX, 72, "2", SILK_DIM, -1);
  g.fill(VX + 10, 36, 76, 16, WIN); g.fill(VX + 10, 60, 76, 16, WIN);
  // the encoder row, its own printed box
  g.fill(4, 102, 952, 1, SILK_LINE);
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, 110, 1, 44, SILK_FAINT);
    if (!kn[c] || kn[c] === "preset") continue;
    if (compact) knobCap(g, c * 120 + 26, 128, 9); else knobCap(g, c * 120 + 30, 139, 12);
  }
}
function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  var compact = !!v.$segmode; // the bottom 18 pixels are Pung's: the segments' names
  g.layer("aphex|" + kn.join(",") + "|" + compact, function () { panelGround(g, kn, compact); });
  segLit(g, v);
  // the header: the patch, the circuit, the cascade
  var hx = 8 + g.measure("APHEX", "value") + 12;
  g.text(hx, 15, txt(v, "preset").toUpperCase(), t === "preset" ? "slot" : SILK, -1, 220);
  var flags = [rev(v), mode(v).toUpperCase()];
  if (on(v, "ms10_mode")) flags.unshift("MS-10 MODE");
  g.text(636, 15, flags.join("   "), SILK_DIM, -1, 220);
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(952, 15, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, SILK_DIM, 1);
  // VCO 1 and 2: the waves, the scales, the levels; sync and ring
  var w1 = opt(v, "v1_wave") || "Saw", w2 = opt(v, "v2_wave") || "Saw", pw = fr(v, "v1_pw", 0.5) * 0.9 + 0.05, c1 = code1(w1), c2 = code2(w2), pw2 = fr(v, "v2_pw", 0.15);
  var ms10 = on(v, "ms10_mode"), sync = on(v, "v2_sync");
  g.poly(cached("f1|" + w1 + "|" + pw.toFixed(2), function () { return wavePts(VX + 12, 37, 72, 14, function (q) { return vco1(c1, q * 2, pw); }, 2); }), 1.5,
    t === "v1_wave" ? "slot" : SILK);
  var iv = interval(v), r2 = Math.pow(2, iv / 12);
  g.poly(cached("f2|" + w2 + "|" + iv.toFixed(2) + "|" + sync + "|" + w1 + "|" + pw.toFixed(2) + "|" + pw2.toFixed(2), function () {
    return wavePts(VX + 12, 61, 72, 14, function (q) {
      var ph = q * 2, o1 = vco1(c1, ph, pw);
      return vco2(c2, sync ? (ph - Math.floor(ph)) * r2 : ph * r2, pw2, o1);
    }, 1);
  }), 1.5, ms10 ? SILK_FAINT : (t === "v2_wave" ? "slot" : SILK));
  g.text(VX + 92, 48, opt(v, "v1_pitch") || "--", t === "v1_pitch" ? "slot" : SILK, -1);
  g.text(VX + 92, 72, ms10 ? "OFF" : (opt(v, "v2_pitch") || "--"), t === "v2_pitch" ? "slot" : (ms10 ? SILK_DIM : SILK), -1);
  // the mixer's two levels, as bars beside the waves
  var l1 = fr(v, "mix_v1", 0), l2 = ms10 ? 0 : fr(v, "mix_v2", 0), lv = [l1, l2], lk = ["mix_v1", "mix_v2"];
  for (var q = 0; q < 2; q++) {
    var ly = 36 + q * 24, lh = Math.round(16 * lv[q]);
    g.fill(VX + 134, ly, 6, 16, SILK_FAINT);
    if (lh) g.fill(VX + 134, ly + 16 - lh, 6, lh, t === lk[q] ? "slot" : SILK);
  }
  if (/ring/i.test(w2) && !ms10) g.text(VX + 112, 92, "RING", SILK, -1);
  led(g, VX + 4, 88, sync); g.text(VX + 10, 92, "SYNC", sync ? SILK : SILK_DIM, -1);
  var fm = on(v, "v2_xmod") || fr(v, "x_mod_amt", 0) > 0.005;
  led(g, VX + 52, 88, fm); g.text(VX + 58, 92, "FM", fm ? SILK : SILK_DIM, -1);
  var oc = Math.round(num(v, "octave", 0));
  g.text(VX + 144, 92, oc ? "OCT " + sgn(oc, 0) : "", t === "octave" ? "slot" : SILK, 1);
  // the filters: Pung's responses, live; one switched out by the cascade is drawn off
  var md = mode(v);
  g.filter(FX - 4, 34, 120, 66, { cutoff: "hpf_cut", at: atOf(v, "hpf_cut"), resonance: "hpf_reso", type: /lp only/i.test(md) ? "Off" : "HP 12 dB", color: SILK });
  g.filter(FX + 116, 34, 120, 66, { cutoff: "lpf_cut", at: atOf(v, "lpf_cut"), resonance: "lpf_reso", type: /hp only/i.test(md) ? "Off" : "LP 12 dB", color: SILK });
  // the envelopes: EG 1's delay, attack, the top held, release; EG 2's hold (a delay), A D S R
  g.envelope(EX - 4, 34, 120, 66, { delay: "e1_delay", attack: "e1_atk", sustain: 1, release: "e1_rel", color: SILK });
  g.envelope(EX + 116, 34, 120, 66, { delay: "e2_hold", attack: "e2_atk", decay: "e2_dcy", sustain: "e2_sus", release: "e2_rel", color: SILK });
  // MG: its slope output, its rate
  // as tall as its depth: MG DEPTH scales both outputs
  var mh = Math.max(10, Math.round(52 * fr(v, "mg_depth", 0.4)));
  g.lfo(PX - 4, 34 + Math.round((52 - mh) / 2), 80, mh, { shape: mgShape(v), rate: "mg_freq", color: t === "mg_depth" || t === "mg_freq" ? "slot" : SILK });
  g.text(PX, 96, known(v, "mg_freq") ? fmtHz(mgHz(num(v, "mg_freq", 0.3))).toUpperCase() : "--", t === "mg_freq" ? "slot" : SILK, -1);
  // the cables patched now
  patchList(g, v, PX + 82, 236);
  row(g, v);
}
// the cables, a row each: the output jack, the cable hanging, the input jack
function patchList(g, v, x, w) {
  var t = v.$touched || "", rows = [], normals = [];
  for (var j = 0; j < INS.length; j++) {
    var jk = jack(v, j);
    if (jk.cable) rows.push([j, jk.cable]);
    else if (jk.normal && INS[j][2] && j) normals.push(j);
  }
  var y0 = 44, rh = 13, max = 4;
  if (!rows.length) {
    g.text(x, 52, "NO CABLES", SILK_DIM, -1);
    g.text(x, 68, "EVERY JACK ON ITS NORMAL", SILK_FAINT, -1, w);
    return;
  }
  for (var i = 0; i < rows.length && i < max; i++) {
    var r = rows[i], y = y0 + i * rh, hot = t === INS[r[0]][0], c = hot ? "slot" : CABLE[r[0]];
    var xa = x + 66, xb = x + w - 92;
    g.text(xa - 8, y + 4, outLabel(r[1]), hot ? "slot" : SILK, 1, 64);
    g.text(xb + 8, y + 4, INS[r[0]][1], hot ? "slot" : SILK, -1, 86);
    socket(g, xa, y, 4.5); socket(g, xb, y, 4.5);
    var pts = [];
    for (var k = 0; k <= 12; k++) { var q = k / 12; pts.push(xa + (xb - xa) * q, y + Math.sin(q * Math.PI) * 5); }
    cable(g, pts, c, 2);
    plug(g, xa, y, 3.5, c); plug(g, xb, y, 3.5, c);
  }
  if (rows.length > max) g.text(x + w, y0 + max * rh + 2, "+" + (rows.length - max) + " MORE: PATCHBAY", SILK_DIM, 1);
}
// the encoder row: the panel's knob in its printed scale, the legend over it, the value beside it
function row(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var c = 0; c < 8; c++) {
    var k = kn[c];
    if (!k || !v[k]) continue;
    var cmp = !!v.$segmode, x0 = c * 120, hot = k === t, cx = x0 + (cmp ? 26 : 30), cy = cmp ? 128 : 139, r = cmp ? 9 : 12;
    g.text(x0 + 60, cmp ? 114 : 117, NAMES[k] || String(v[k].name).toUpperCase(), hot ? "slot" : SILK, 0, 112);
    if (k === "preset") {
      g.fill(x0 + 6, cmp ? 119 : 125, 108, cmp ? 20 : 26, WIN);
      g.value(x0 + 60, cmp ? 134 : 144, shown(v, k), hot ? "slot" : SILK, 0, 102);
      continue;
    }
    if (hot) g.arc(cx, cy, r + 8, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) pointer(g, cx, cy, r - 1, fr(v, k, 0), hot ? "slot" : SILK, 2.5);
    g.value(x0 + 82, cmp ? 135 : 146, shown(v, k), hot ? "slot" : SILK, 0, 66);
  }
}

// ---- segments: the panel's sections under the hands --------------------------------------------
// the active one is lit as the panel prints its titles: the words in the slot's colour (Pung's bar
// stands above them)
var SEG_TITLES = {
  vco: [[VX, 118, "VCO 1 / 2"]], vcf: [[FX, 112, "HIGH PASS"], [FX + 120, 112, "LOW PASS"]], eg: [[EX, 112, "EG 1"], [EX + 120, 112, "EG 2"]],
  mg: [[PX, 72, "MG"]], patch: [[PX + 82, 236, "PATCH"]] };
var SEGS = [
  { id: "vco", label: "VCO", rect: [4, 20, 152, 80], keys: ["v1_wave", "v1_pitch", "v1_pw", "v2_wave", "v2_pitch", "v2_fine", "mix_v1", "mix_v2"] },
  { id: "vcf", label: "HPF / LPF", rect: [156, 20, 238, 80], keys: ["hpf_cut", "hpf_reso", "hpf_mg", "hpf_eg", "lpf_cut", "lpf_reso", "lpf_mg", "lpf_eg"] },
  { id: "eg", label: "EG 1 / EG 2", rect: [394, 20, 238, 80], keys: ["e1_delay", "e1_atk", "e1_rel", "e2_hold", "e2_atk", "e2_dcy", "e2_sus", "e2_rel"] },
  { id: "mg", label: "MG", rect: [632, 20, 82, 80], keys: ["mg_freq", "mg_shape", "mg_pw", "mg_depth", "mw_mg"] },
  { id: "patch", label: "Patch", rect: [714, 20, 242, 80], keys: ["pb_kbd_cv", "pb_total", "pb_freq", "pb_hpf_cv", "pb_lpf_cv", "pb_vca_in", "pb_pwm_in", "pb_ext_sig"] }];
function segLit(g, v) {
  if (v.$segmode !== "segment" || !v.$segment) return;
  var ts = SEG_TITLES[v.$segment] || [];
  for (var i = 0; i < ts.length; i++) g.text(ts[i][0], 31, ts[i][2], "slot", -1);
}
Object.assign(NAMES, { v1_wave: "VCO1 WAVE", v1_pitch: "VCO1 SCALE", v1_pw: "VCO1 PW", v2_wave: "VCO2 WAVE", v2_pitch: "VCO2 SCALE",
  v2_fine: "VCO2 PITCH", mix_v1: "VCO1 LEVEL", mix_v2: "VCO2 LEVEL", hpf_mg: "HP MG/T.EXT", hpf_eg: "HP EG/EXT", lpf_mg: "LP MG/T.EXT",
  lpf_eg: "LP EG/EXT", e1_delay: "EG1 DELAY", e1_atk: "EG1 ATTACK", e1_rel: "EG1 RELEASE", e2_hold: "EG2 HOLD", e2_atk: "EG2 ATTACK",
  e2_dcy: "EG2 DECAY", e2_sus: "EG2 SUSTAIN", e2_rel: "EG2 RELEASE", mg_shape: "MG WAVE", mg_pw: "MG PULSE W", mw_mg: "WHEEL > MG",
  pb_kbd_cv: "VCO 1+2 CV", pb_total: "TOTAL", pb_freq: "FREQ", pb_hpf_cv: "HP CUTOFF", pb_lpf_cv: "LP CUTOFF", pb_vca_in: "INIT GAIN",
  pb_pwm_in: "PWM", pb_ext_sig: "EXT SIGNAL" });

// Pung's default pages in the MS-20's colours: black panel, white print, black knobs
push.theme({ ground: PANEL, ink: SILK, dim: SILK_DIM, rule: SILK_LINE, faint: SILK_FAINT, panel: CAP, accent: SILK, knob: "pointer" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true, segments: SEGS,
  pages: [
    { label: "Panel", keys: ["hpf_cut", "hpf_reso", "lpf_cut", "lpf_reso", "mg_freq", "mg_depth", "drive", "volume"] },
    { label: "Patch", keys: ["preset", "octave", "portamento", "master_tune", "rnd_patch", "mutate", "rnd_mod", "reset_patch"] }
  ],
  extra_keys: ["preset", "filter_rev", "filter_mode", "ms10_mode", "v1_wave", "v1_pitch", "v1_pw", "v2_wave", "v2_pitch", "v2_fine", "v2_detune",
    "v2_pw", "v2_sync", "v2_xmod", "x_mod_amt", "mix_v1", "mix_v2", "octave", "hpf_cut", "hpf_reso", "lpf_cut", "lpf_reso",
    "e1_delay", "e1_atk", "e1_rel", "e2_hold", "e2_atk", "e2_dcy", "e2_sus", "e2_rel", "mg_freq", "mg_depth", "mg_shape",
    "pb_kbd_cv", "pb_total", "pb_freq", "pb_hpf_cv", "pb_lpf_cv", "pb_vca_in", "pb_pwm_in", "pb_ext_sig", "pb_vco2_cv", "pb_eg1_trig", "pb_eg12_trig",
    "hpf_mg", "hpf_eg", "lpf_mg", "lpf_eg", "mg_pw", "mw_mg"],
  screen: function (g, v) { panel(g, v); }
});

// ---- band screens ---------------------------------------------------------------------------------
function edge(g) { g.fill(0, 0, 3, g.h, SILK_LINE); }
// an attenuator as the panel has it: a bipolar bar from its middle, and the source the jack feeds it
function atten(g, x, y, w, label, val, src, hot, live) {
  g.text(x, y, label, hot ? "slot" : SILK_DIM, -1);
  g.text(x + w, y, src, hot ? "slot" : (live ? SILK : SILK_FAINT), 1);
  var mid = x + w / 2, by = y + 5;
  g.fill(x, by, w, 3, SILK_FAINT);
  g.fill(mid, by - 2, 1, 7, SILK_DIM);
  var len = Math.round(Math.abs(val) * w / 2);
  if (len) g.fill(val < 0 ? mid - len : mid, by, len, 3, hot ? "slot" : (live ? "mod" : SILK_DIM));
}
// what a jack feeds now, in words
function feeds(v, j) {
  var jk = jack(v, j);
  if (jk.unknown) return "--";
  if (jk.normal) return INS[j][2];
  if (jk.dummy || jk.empty) return "NONE";
  return outLabel(jk.cable);
}

// ---- VCO 1+2 ------------------------------------------------------------------------------------
push.compartment({
  id: "vco", label: "VCO 1+2",
  pages: [
    { label: "VCO 1+2", keys: ["v1_wave", "v1_pitch", "v1_pw", "v2_wave", "v2_pitch", "v2_fine", "v2_sync", "v2_xmod"] },
    { label: "VCO +", keys: ["v2_pw", "v2_detune", "x_mod_amt"] }
  ],
  extra_keys: ["mix_v1", "mix_v2", "ms10_mode", "pb_pwm_in", "pb_vco2_cv"],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "", w1 = opt(v, "v1_wave") || "Saw", w2 = opt(v, "v2_wave") || "Saw", pw = fr(v, "v1_pw", 0.5) * 0.9 + 0.05, c1 = code1(w1), c2 = code2(w2), pw2 = fr(v, "v2_pw", 0.15);
    var sync = on(v, "v2_sync"), iv = interval(v), r2 = Math.pow(2, iv / 12), ms10 = on(v, "ms10_mode"), xm = fr(v, "x_mod_amt", 0);
    var o1 = function (ph) { return vco1(c1, ph, pw); };
    var o2 = function (ph) { return vco2(c2, sync ? (ph - Math.floor(ph)) * r2 : ph * r2, pw2, o1(ph)); };
    var bw = 280, y = 4, h = 78, sig = [w1, w2, pw.toFixed(2), iv.toFixed(2), sync, fr(v, "v2_pw", 0).toFixed(2)].join("|");
    function box(x, w, hot) { g.line(x, y, x + w, y, 1, hot ? "slot" : "line"); g.line(x, y + h, x + w, y + h, 1, hot ? "slot" : "line"); }
    // VCO 1
    var x = 10;
    box(x, bw, /^v1_/.test(t));
    g.text(x, y + 14, "VCO 1", "dim", -1);
    g.text(x + bw, y + 14, String(w1).toUpperCase() + "  " + (opt(v, "v1_pitch") || "") + (/pw|square/i.test(w1) ? "  PW " + pct(pw) : ""), "fg", 1);
    g.poly(cached("v1|" + sig, function () { return wavePts(x, y + 20, bw, h - 26, function (q) { return o1(q * 2); }, 2); }), 2, "fg");
    var pj = feeds(v, 6);
    if (pj !== "NONE" && /pw|square/i.test(w1)) g.text(x, y + h - 4, "PWM FROM " + pj, "mod", -1);
    // VCO 2
    x = 306;
    box(x, bw, /^v2_|x_mod/.test(t));
    g.text(x, y + 14, "VCO 2", "dim", -1);
    g.text(x + bw, y + 14, ms10 ? "OFF (MS-10)" : String(w2).toUpperCase() + "  " + (opt(v, "v2_pitch") || "") + "  " + sgn(iv, 1) + " ST" + (sync ? "  SYNC" : ""), "fg", 1);
    g.poly(cached("v2|" + sig, function () { return wavePts(x, y + 20, bw, h - 26, function (q) { return o2(q * 2); }, 2); }), 2, ms10 ? "faint" : (sync ? "mod" : "fg"));
    if (sync && !ms10) for (var c = 1; c < 2; c++) g.line(x + bw * c / 2, y + 22, x + bw * c / 2, y + h - 6, 1, "line");
    var fm = on(v, "v2_xmod") || xm > 0.005;
    g.text(x, y + h - 4, (fm ? "FM " + pct(xm) + "  " : "") + (feeds(v, 8) !== "NONE" ? "CV FROM " + feeds(v, 8) : ""), fm ? "mod" : "dim", -1, bw);
    // the mix: both at their levels
    x = 602; var mw = 342, l1 = fr(v, "mix_v1", 0), l2 = ms10 ? 0 : fr(v, "mix_v2", 0);
    box(x, mw, false);
    g.text(x, y + 14, "VCO MIXER", "dim", -1);
    g.text(x + mw, y + 14, "1 " + pct(l1) + "   2 " + pct(l2), "fg", 1);
    if (l1 + l2 > 0.001) g.poly(cached("mx|" + sig + "|" + l1.toFixed(2) + l2.toFixed(2), function () {
      return wavePts(x, y + 20, mw, h - 26, function (q) { return (l1 * o1(q * 3) + l2 * o2(q * 3)) / (l1 + l2); }, 3);
    }), 2, SILK);
  }
});

// ---- MIXER and FREQUENCY MODULATION ----------------------------------------------------------------
push.compartment({
  id: "mixer", label: "Mixer",
  pages: [
    { label: "Mixer", keys: ["mix_v1", "mix_v2", "mix_sub", "mix_noise", "mix_esp", "mix_fb", "noise_color"] },
    { label: "Freq Mod", keys: ["vco_mg", "vco_eg"] }
  ],
  extra_keys: ["pb_total", "pb_freq", "pb_ext_sig"],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "";
    g.text(10, 12, "VCO MIXER", "fg", -1);
    // a fader over each level's knob
    g.mix(0, 16, 716, 70, ["mix_v1", "mix_v2", "mix_sub", "mix_noise", "mix_esp", "mix_fb"], { color: SILK });
    g.text(706, 12, (opt(v, "noise_color") || "White").toUpperCase() + " NOISE", t === "noise_color" ? "slot" : "dim", 1);
    g.line(718, 6, 718, 82, 1, "line");
    var x = 730, w = 212;
    g.text(x, 12, "FREQUENCY MOD  (VCO 1+2)", "fg", -1);
    var tj = jack(v, 1), fj = jack(v, 2);
    atten(g, x, 36, w, "MG / T.EXT", bip(v, "vco_mg"), feeds(v, 1), t === "vco_mg", !tj.dummy && !tj.empty);
    atten(g, x, 64, w, "EG 1 / EXT", bip(v, "vco_eg"), feeds(v, 2), t === "vco_eg", !fj.dummy && !fj.empty);
    var ej = jack(v, 7);
    g.text(x, 84, ej.cable ? "EXT SIGNAL: " + outLabel(ej.cable) : "±1 OCTAVE AT FULL", ej.cable ? "mod" : "faint", -1, w);
  }
});

// ---- FILTERS: the cascade ----------------------------------------------------------------------------
push.compartment({
  id: "filters", label: "Filters",
  pages: [
    { label: "HPF + LPF", keys: ["hpf_cut", "hpf_reso", "hpf_mg", "hpf_eg", "lpf_cut", "lpf_reso", "lpf_mg", "lpf_eg"] },
    { label: "Filter +", keys: ["filter_mode", "filter_rev", "key_track", "drive", "mw_filt"] }
  ],
  extra_keys: ["pb_total", "pb_hpf_cv", "pb_lpf_cv", "ms10_mode"],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "", md = mode(v), half = 476;
    var hpOff = /lp only/i.test(md), lpOff = /hp only/i.test(md), notch = /notch/i.test(md);
    function side(x, p, name, off, jj) {
      var hot = t.indexOf(p) === 0;
      g.text(x, 12, name, hot ? "slot" : "fg", -1);
      g.text(x + 250, 12, off ? "SWITCHED OUT" : fmtHz(cutHz(num(v, p + "cut", 0.5))).toUpperCase() + "  PEAK " + pct(fr(v, p + "reso", 0)), off ? "faint" : "dim", 1);
      g.filter(x - 6, 16, 264, 70, { cutoff: p + "cut", at: atOf(v, p + "cut"), resonance: p + "reso", type: off ? "Off" : (p === "hpf_" ? "HP 12 dB" : "LP 12 dB"), color: SILK });
      var tj = jack(v, 1), ej = jack(v, jj);
      atten(g, x + 268, 30, 158, "MG / T.EXT", bip(v, p + "mg"), feeds(v, 1), t === p + "mg", !tj.dummy && !tj.empty);
      atten(g, x + 268, 60, 158, "EG / EXT", bip(v, p + "eg"), feeds(v, jj), t === p + "eg", !ej.dummy && !ej.empty);
    }
    side(10, "hpf_", "HIGH PASS", hpOff, 3);
    g.line(half, 6, half, 82, 1, "line");
    side(half + 12, "lpf_", "LOW PASS", lpOff, 4);
    // the cascade between them
    var mx = half, cas = notch ? "HP + LP PARALLEL" : (hpOff ? "LP ONLY" : (lpOff ? "HP ONLY" : "HP > LP")), rv = rev(v) + (on(v, "ms10_mode") ? " MS-10" : "");
    var bw = Math.max(g.measure(cas), g.measure(rv)) + 10;
    g.fill(mx - bw / 2, 64, bw, 22, "#000000");
    g.text(mx, 73, rv, t === "filter_rev" || t === "ms10_mode" ? "slot" : "dim", 0);
    g.text(mx, 84, cas, t === "filter_mode" ? "slot" : "mod", 0);
  }
});

// ---- EG 1 and EG 2 ----------------------------------------------------------------------------------
// where an envelope goes: the panel's attenuators whose jack it feeds, and the VCA
function egTo(v, n) {
  var out = [], id = "eg" + n;
  function via(j, label, k) { var jk = jack(v, j); if (((jk.normal && INS[j][2] === "EG " + n) || jk.cable === id) && Math.abs(bip(v, k)) > 0.005) out.push(label); }
  via(2, "PITCH", "vco_eg"); via(3, "HPF", "hpf_eg"); via(4, "LPF", "lpf_eg");
  if (jack(v, 5).cable === id) out.push("GAIN");
  if (jack(v, 6).cable === id) out.push("PWM");
  if (n === 2) out.unshift("VCA");
  if (jack(v, 1).cable === id + "r") out.push("TOTAL (REV)");
  return out.length ? out.join(", ") : "NOWHERE";
}
push.compartment({
  id: "env", label: "EG 1 / EG 2",
  pages: [{ label: "EG 1 / EG 2", keys: ["e1_delay", "e1_atk", "e1_rel", "e2_hold", "e2_atk", "e2_dcy", "e2_sus", "e2_rel"] }],
  extra_keys: ["pb_freq", "pb_hpf_cv", "pb_lpf_cv", "pb_vca_in", "pb_pwm_in", "pb_total", "vco_eg", "hpf_eg", "lpf_eg", "ms10_mode"],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "", w1 = 3 * 120 - 14, ms10 = on(v, "ms10_mode");
    g.text(10, 12, "EG 1  DELAY ATTACK RELEASE", /^e1_/.test(t) ? "slot" : "fg", -1);
    g.text(w1 + 4, 12, ms10 ? "OFF (MS-10)" : "TO " + egTo(v, 1), ms10 ? "faint" : "mod", 1, 170);
    g.envelope(4, 16, w1 + 4, 70, { delay: "e1_delay", attack: "e1_atk", sustain: 1, release: "e1_rel", labels: true, color: SILK });
    g.line(w1 + 12, 6, w1 + 12, 82, 1, "line");
    var x2 = w1 + 22;
    g.text(x2, 12, "EG 2  HOLD ATTACK DECAY SUSTAIN RELEASE", /^e2_/.test(t) ? "slot" : "fg", -1);
    g.text(944, 12, "TO " + egTo(v, 2), "mod", 1, 200);
    g.envelope(x2 - 6, 16, 944 - x2 + 10, 70, { delay: "e2_hold", attack: "e2_atk", decay: "e2_dcy", sustain: "e2_sus", release: "e2_rel", labels: true, color: SILK });
  }
});

// ---- MG ---------------------------------------------------------------------------------------------
function mgTo(v) {
  var out = [], tj = jack(v, 1);
  if (tj.normal) {
    if (Math.abs(bip(v, "vco_mg")) > 0.005) out.push("PITCH");
    if (Math.abs(bip(v, "hpf_mg")) > 0.005) out.push("HPF");
    if (Math.abs(bip(v, "lpf_mg")) > 0.005) out.push("LPF");
  }
  var pj = jack(v, 6);
  if (pj.cable === "mgtri" || pj.cable === "mgsq") out.push("PWM");
  return out;
}
push.compartment({
  id: "mg", label: "MG",
  pages: [{ label: "MG", keys: ["mg_freq", "mg_shape", "mg_pw", "mg_depth", "mw_mg"] }],
  extra_keys: ["pb_total", "pb_pwm_in", "vco_mg", "hpf_mg", "lpf_mg"],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "", hz = mgHz(num(v, "mg_freq", 0.3)), pw = fr(v, "mg_pw", 0.5);
    g.text(10, 12, "MG  " + mgShapeWord(v), t === "mg_shape" ? "slot" : "fg", -1);
    g.text(346, 12, fmtHz(hz).toUpperCase() + "  DEPTH " + pct(fr(v, "mg_depth", 0)), t === "mg_freq" || t === "mg_depth" ? "slot" : "dim", 1);
    g.lfo(4, 16, 348, 70, { shape: mgShape(v), rate: "mg_freq", color: SILK });
    g.line(362, 6, 362, 82, 1, "line");
    g.text(372, 12, "RECTANGLE", t === "mg_pw" ? "slot" : "fg", -1);
    g.text(596, 12, "DUTY " + Math.round((1 - clamp(pw, 0.05, 0.95)) * 100) + "%", t === "mg_pw" ? "slot" : "dim", 1);
    g.lfo(366, 16, 234, 70, { shape: "Square", rate: "mg_freq", color: SILK });
    g.line(612, 6, 612, 82, 1, "line");
    var to = mgTo(v), tj = jack(v, 1);
    g.text(624, 12, "WHERE IT GOES", "fg", -1);
    g.text(624, 32, to.length ? to.join("  ") : "NOWHERE NOW", to.length ? "mod" : "faint", -1, 320);
    g.text(624, 50, tj.cable ? "TOTAL TAKES " + outLabel(tj.cable) + " IN ITS PLACE" : (tj.dummy ? "TOTAL HAS A DUMMY PLUG" : "THROUGH TOTAL: THE MG/T.EXT KNOBS"), "dim", -1, 320);
    g.text(624, 68, "WHEEL ADDS " + pct(fr(v, "mw_mg", 0)) + " DEPTH", t === "mw_mg" ? "slot" : "dim", -1);
  }
});

// ---- ESP: the external signal processor ----------------------------------------------------------------
push.compartment({
  id: "esp", label: "ESP",
  pages: [
    { label: "ESP", keys: ["esp_in_gain", "esp_lo_cut", "esp_hi_cut", "esp_threshold", "esp_env_atk", "esp_env_rel", "esp_pitch_slew", "esp_cv_adj"] },
    { label: "ESP +", keys: ["esp_pitch_mode", "esp_gate_pol", "esp_aud_mix", "mix_esp"] }
  ],
  extra_keys: ["pb_kbd_cv", "pb_total", "pb_freq", "pb_hpf_cv", "pb_lpf_cv", "pb_vca_in", "pb_pwm_in", "pb_ext_sig", "pb_vco2_cv", "pb_eg1_trig", "pb_eg12_trig"],
  screen: function (g, v) {
    edge(g);
    var t = v.$touched || "";
    // where each output is patched
    var dest = { espcv: [], espenv: [], espgate: [], espaud: [] };
    for (var j = 0; j < INS.length; j++) { var jk = jack(v, j); if (jk.cable && dest[jk.cable]) dest[jk.cable].push(INS[j][1]); }
    if (fr(v, "mix_esp", 0) > 0.005) dest.espaud.push("MIXER " + pct(fr(v, "mix_esp", 0)));
    function blockAt(x, y, w, h, label, hot) {
      g.line(x, y, x + w, y, 1, hot ? "slot" : SILK_DIM); g.line(x, y + h, x + w, y + h, 1, hot ? "slot" : SILK_DIM);
      g.line(x, y, x, y + h, 1, hot ? "slot" : SILK_DIM); g.line(x + w, y, x + w, y + h, 1, hot ? "slot" : SILK_DIM);
      g.text(x + w / 2, y + 12, label, hot ? "slot" : "fg", 0);
    }
    function flow(x0, y0, x1, y1) { g.line(x0, y0, x1, y1, 1, SILK_DIM); }
    // signal in, the pre amp
    g.text(10, 12, "SIGNAL IN", "dim", -1);
    socket(g, 26, 44, 6);
    flow(33, 44, 50, 44);
    blockAt(50, 30, 92, 28, "PRE AMP", t === "esp_in_gain");
    g.text(96, 70, "x" + num(v, "esp_in_gain", 1).toFixed(2), t === "esp_in_gain" ? "slot" : "dim", 0);
    flow(142, 44, 160, 44);
    // the band pass: lo cut to hi cut, on the frequency axis
    var lc = 50 * Math.pow(50, num(v, "esp_lo_cut", 0)), hc = 100 * Math.pow(50, num(v, "esp_hi_cut", 1));
    var bx = 160, bw = 200, hotB = t === "esp_lo_cut" || t === "esp_hi_cut";
    blockAt(bx, 30, bw, 28, "", hotB);
    g.text(bx + 6, 42, "BAND PASS", hotB ? "slot" : "fg", -1);
    function ax(h) { return bx + 4 + (bw - 8) * clamp(Math.log(h / 20) / Math.LN10 / 3, 0, 1); }
    var x1 = ax(lc), x2 = ax(Math.max(hc, lc));
    g.fill(bx + 4, 50, bw - 8, 2, SILK_FAINT);
    g.fill(x1, 48, Math.max(2, x2 - x1), 6, hotB ? "slot" : SILK);
    g.text(bx + bw / 2, 70, fmtHz(lc).toUpperCase() + " TO " + fmtHz(hc).toUpperCase(), hotB ? "slot" : "dim", 0);
    // the three processors and the audio, each to its output jack
    var px = 400, rows = [
      ["ENV FOLLOWER", "espenv", "A " + fmtS(num(v, "esp_env_atk", 0.005)) + " R " + fmtS(num(v, "esp_env_rel", 0.1)), /esp_env/.test(t)],
      ["F/V CONVERTER", "espcv", (opt(v, "esp_pitch_mode") || "Track").toUpperCase() + "  SLEW " + pct(fr(v, "esp_pitch_slew", 0)) + "  " + sgn(Math.round(bip(v, "esp_cv_adj") * 100), 0),
        /esp_pitch|esp_cv/.test(t)],
      ["SCHMITT TRIGGER", "espgate", "AT " + pct(fr(v, "esp_threshold", 0.1)) + "  " + (opt(v, "esp_gate_pol") === "-" ? "INVERTED" : "POSITIVE"), /esp_threshold|esp_gate/.test(t)],
      ["AUDIO", "espaud", "MIX " + pct(fr(v, "esp_aud_mix", 1)), t === "esp_aud_mix" || t === "mix_esp"]];
    g.line(368, 44, 380, 44, 1, SILK_DIM);
    g.line(380, 14, 380, 80, 1, SILK_DIM);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], y = 14 + i * 22, hot = r[3], used = dest[r[1]];
      flow(380, y, 396, y);
      g.text(px, y + 4, r[0], hot ? "slot" : "fg", -1);
      g.text(px + 128, y + 4, r[2], hot ? "slot" : "dim", -1, 160);
      socket(g, 700, y, 5.5);
      if (used.length) {
        plug(g, 700, y, 4.5, "mod");
        g.line(706, y, 724, y, 2, "mod");
        g.text(728, y + 4, used.join(", "), "mod", -1, 216);
      } else g.text(714, y + 4, "NOT PATCHED", "faint", -1);
    }
  }
});

// ---- PATCHBAY: the cables ------------------------------------------------------------------------------
// The panel as the instrument lays it out: the outputs along the top in their
// printed groups, the inputs along the bottom in the signal's order, and the
// cables hanging between them.
var OUT_ROW = [ // group, [id, legend]...
  ["KBD", ["kbd", "CV"], ["trigcv", "TRIG"]], ["ESP", ["espcv", "F/V"], ["espenv", "ENV"], ["espgate", "GATE"], ["espaud", "AUDIO"]],
  ["MG", ["mgtri", "TRI"], ["mgsq", "RECT"]], ["S&H", ["sh", "OUT"]], ["NOISE", ["noise", "OUT"]], ["WHEEL", ["wheel", "OUT"]],
  ["EG 1", ["eg1", "OUT"], ["eg1r", "REV"]], ["EG 2", ["eg2", "OUT"], ["eg2r", "REV"]], ["MIXER", ["mix", "OUT"]],
  ["TRACKS", ["trk1", "1"], ["trk2", "2"], ["trk3", "3"], ["trk4", "4"]]];
var IN_ORDER = [0, 8, 2, 1, 6, 7, 3, 4, 5, 9, 10]; // VCO CV, VCO 2 CV, FREQ, TOTAL, PWM, EXT, HP, LP, GAIN, the triggers
var IN_SHORT = { pb_vca_in: "INIT GAIN", pb_eg12_trig: "EG1+2 TRIG" };
var OUT_X = (function () {
  var m = {}, x = 26, gap = 41, groupGap = 12;
  for (var gi = 0; gi < OUT_ROW.length; gi++) {
    for (var k = 1; k < OUT_ROW[gi].length; k++) { m[OUT_ROW[gi][k][0]] = x; x += gap; }
    x += groupGap;
  }
  return m;
})();
var OUT_Y = 34, IN_Y = 64;
function inX(j) { for (var i = 0; i < IN_ORDER.length; i++) if (IN_ORDER[i] === j) return 50 + i * 86; return 0; }
function patchGround(g) {
  edge(g);
  g.fill(3, 0, 949, 86, PANEL);
  for (var gi = 0; gi < OUT_ROW.length; gi++) {
    var grp = OUT_ROW[gi], x0 = OUT_X[grp[1][0]] - 18, x1 = OUT_X[grp[grp.length - 1][0]] + 18;
    g.text((x0 + x1) / 2, 9, grp[0], SILK, 0);
    g.fill(x0, 12, x1 - x0, 1, SILK_LINE);
    for (var k = 1; k < grp.length; k++) {
      var x = OUT_X[grp[k][0]];
      g.text(x, 23, grp[k][1], SILK_DIM, 0);
      socket(g, x, OUT_Y, 6.5);
    }
  }
  for (var i = 0; i < IN_ORDER.length; i++) socket(g, 50 + i * 86, IN_Y, 6.5);
}
push.compartment({
  id: "patch", label: "Patchbay",
  pages: [
    { label: "Jacks", keys: ["pb_kbd_cv", "pb_total", "pb_freq", "pb_hpf_cv", "pb_lpf_cv", "pb_vca_in", "pb_vco2_cv", "pb_ext_sig"] },
    { label: "Jacks +", keys: ["pb_pwm_in", "pb_eg1_trig", "pb_eg12_trig"] }
  ],
  screen: function (g, v) {
    g.layer("patch-ground", function () { patchGround(g); });
    var t = v.$touched || "", cables = [];
    for (var j = 0; j < INS.length; j++) {
      var jk = jack(v, j);
      if (jk.cable && OUT_X[jk.cable] !== undefined) cables.push([j, jk.cable, t === INS[j][0]]);
    }
    // the cables, the touched one last (on top)
    cables.sort(function (a, b) { return (a[2] ? 1 : 0) - (b[2] ? 1 : 0); });
    for (var c = 0; c < cables.length; c++) {
      var xi = inX(cables[c][0]), xo = OUT_X[cables[c][1]], col = cables[c][2] ? "slot" : CABLE[cables[c][0]];
      cable(g, cablePts(xo, OUT_Y, xi, IN_Y, 84), col, 3);
      plug(g, xo, OUT_Y, 5.5, col);
    }
    // the inputs: legend, plug or what is normalled
    for (j = 0; j < INS.length; j++) {
      var x = inX(j), hot = t === INS[j][0], jj = jack(v, j), k = INS[j][0], lab = IN_SHORT[k] || INS[j][1];
      var lw = g.measure(lab) + 6;
      g.fill(x - lw / 2, 44, lw, 10, PANEL);
      g.text(x, 52, lab, hot ? "slot" : SILK, 0, 86);
      if (jj.cable) { plug(g, x, IN_Y, 5.5, hot ? "slot" : CABLE[j]); continue; }
      if (jj.dummy) { g.dot(x, IN_Y, 6, "#2e2e2e"); g.dot(x, IN_Y, 3, "#555555"); }
      var say = jj.normal ? "= " + INS[j][2] : (jj.dummy ? "DUMMY PLUG" : "");
      if (say) g.text(x, 83, say, hot ? "slot" : SILK_DIM, 0, 86);
      else if (hot) g.arc(x, IN_Y, 8.5, 0, Math.PI * 2, 2, "slot");
    }
  }
});

// ---- MODERN: Pung's own page ----------------------------------------------------------------------------
push.compartment({
  id: "modern", label: "Modern",
  pages: [{ label: "Modern", keys: ["drift", "v1_drift", "v2_drift", "ms10_mode", "key_track", "mw_mg", "mw_filt", "vel_amt"] }]
});
