// Model-72 (a circuit-modelled 1970s monosynth: a port of the CA-72 model of
// the classic American mono, its board 4 ladder solved in real time) on Push.
// An overlay shipped with Pung (the module ships no push_ui.js).
//
// The instrument is the classic panel between wooden cheeks, read left to
// right as the signal goes: CONTROLLERS, OSCILLATOR BANK, MIXER, MODIFIERS
// (the ladder filter and its contour, the loudness contour), OUTPUT, the
// section names printed along its foot; black, with aluminium-capped knobs.
// Everything drawn is what CA-72's light voice (engine/ca72/src/light.rs, the
// laws in voice.rs) does with the panel:
//
//   PANEL        the whole panel: each oscillator's wave as the circuit makes
//                it (the triangle's top at the reset, the shark tooth, the
//                rectangles' real duty cycles), its footage and its pull in
//                cents; the mixer's levels through the loaded pots, in dB; the
//                ladder where CUTOFF really puts it, how far the contour takes
//                it; both contours on the circuit's own times and curves; the
//                voices in the trim, lit as notes hold them
//   OSCILLATORS  the three waves on one time base (32' half a cycle of 8'),
//                the bus they make through the mixer, and how the bank beats
//                at middle C (each oscillator's FREQUENCY in cents)
//   FILTER       the ladder's response at the cutoff and emphasis the model
//                sets, where the contour (rest, peak, sustain) and the keys
//                take it, and the filter contour
//   LOUDNESS     the loudness contour and the VCA's measured law: why SUSTAIN
//                10 is full level (the VCA is flat above 4.4 V)
//   CONTROLLERS  the modulation bus: oscillator 3 and noise through MOD MIX,
//                the wheel, to the oscillators and the filter
//   MIXER, VOICE, STEREO  Pung's own pages, in the panel's colours
//
// The laws (light.rs `laws`, voice.rs): CUTOFF -5..5 is the knob 0..1, the
// ring's pitch log2 Hz from CUTOFF_LOG2; EMPHASIS through R14 into the loop
// gain table (4 rings); AMOUNT OF CONTOUR 2.10 oct/V times its share; the
// contours RC segments: attack toward ATTACK_AIM of the plateau (so its curve
// is e^(c t) with c = ln((aim - stop)/(aim - rest))), decay toward SUSTAIN
// (faster the further it falls), release with DECAY on at DECAY's time, off
// in some 20 ms; time constants A (R/100K)^B + T0 on the pots' laws.

// ---- values ------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? Math.max(0, Math.min(1, v[k].frac)) : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function idx(v, k, n, d) { return Math.max(0, Math.min(n - 1, Math.round(num(v, k, d === undefined ? 0 : d)))); }
function on(v, k, d) { return idx(v, k, 2, d ? 1 : 0) === 1; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function log2(x) { return Math.log(x) / Math.LN2; }
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (var i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}
// a pot's law: its points (knob 0..1, value), straight between them
function track(pts, p) {
  p = clamp(p, 0, 1);
  for (var i = 1; i < pts.length; i++) if (p <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (p - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
  return pts[pts.length - 1][1];
}
function audioTaper(p) { return (Math.pow(81, clamp(p, 0, 1)) - 1) / 80; }
// a rheostat as the voice has it (time_pot, glide_pot): the generic audio taper's shape to the
// law's first point, then straight in its logarithm through the points, ohm
function rheo(p, law) {
  p = clamp(p, 0, 1);
  if (p <= law[0][0]) return law[0][1] * audioTaper(p) / audioTaper(law[0][0]);
  for (var i = 1; i < law.length; i++) if (p <= law[i][0]) return law[i - 1][1] * Math.pow(law[i][1] / law[i - 1][1], (p - law[i - 1][0]) / (law[i][0] - law[i - 1][0]));
  return law[law.length - 1][1];
}

// ---- the circuit's laws (light.rs `laws`, voice.rs) ------------------------------------------
var CUTOFF_LOG2 = [5.2, 5.5, 5.81, 6.345, 6.787, 7.257, 7.745, 8.306, 8.878, 9.459, 10.045, 10.626, 11.208,
  11.789, 12.366, 12.874, 13.375, 13.866, 14.229, 14.42, 14.55];
var KEYBOARD_CONTROL = [0.3276, 0.6486, 0.9555], TRACKING_FROM = 36;
var CONTOUR_OCT_PER_V = 2.10, AMOUNT = [0.0, 0.192, 0.487, 0.778, 1.0];
var EMPHASIS_AT = [0.0, 0.25, 0.5, 0.7, 0.72, 0.735, 0.744, 0.79, 0.85, 0.9, 1.0];
var LOOP_AT_LOG2 = [5.9, 6.44, 6.864, 7.783, 8.75, 9.745, 10.749, 11.752, 12.747, 13.711];
var LOOP = [
  [0.146, 0.502, 1.08, 1.95, 2.06, 2.14, 2.2, 2.45, 2.8, 3.2, 3.8],
  [0.154, 0.528, 1.2, 2.3, 2.45, 2.56, 2.65, 3.05, 3.55, 3.9, 4.212],
  [0.158, 0.54, 1.502, 2.79, 2.955, 3.079, 3.445, 3.805, 4.1, 4.229, 4.429],
  [0.166, 0.567, 1.575, 3.306, 3.509, 3.678, 3.693, 4.13, 4.407, 4.652, 5.229],
  [0.201, 0.616, 1.675, 3.595, 3.815, 3.962, 3.964, 4.313, 5.043, 5.669, 6.713],
  [0.238, 0.668, 1.779, 3.749, 3.986, 4.079, 4.127, 4.651, 5.436, 6.112, 7.695],
  [0.244, 0.676, 1.798, 3.82, 4.033, 4.121, 4.127, 4.707, 5.502, 6.186, 8.055],
  [0.248, 0.68, 1.81, 3.849, 4.06, 4.123, 4.127, 4.737, 5.536, 6.225, 8.29],
  [0.248, 0.68, 1.811, 3.845, 4.061, 4.125, 4.127, 4.74, 5.54, 6.23, 8.267],
  [0.248, 0.68, 1.811, 4.05, 4.123, 4.125, 4.127, 4.74, 5.54, 6.23, 8.267]];
var RING_GAIN = 2.5, THRESHOLD_AT_LOG2 = [7.74, 10.04, 12.37], THRESHOLD = [0.7923, 0.7274, 0.7164], SHIFT = [-0.0032, 0.0195, 0.0176];
var EMPHASIS_NEAR = 0.012;
var EMPHASIS_R14 = [[0.0, 50e3], [0.2, 30.68e3], [0.25, 18.82e3], [0.3, 9.47e3], [0.4, 3.64e3], [0.5, 2.91e3], [0.6, 2.30e3],
  [0.7, 1.548e3], [0.75, 1.35e3], [0.85, 834.0]];
// the contours: rest and plateau, V; the attack's aim (a share of the rise); the capacitor's
// series resistance; A (R/100K)^B + T0 time constants; DECAY's speed-up; SUSTAIN's cubic
var REST = [0.0743, -0.516], PEAK = [4.7917, 5.6014], ATTACK_AIM = [1.82, 1.40], ATTACK_ESR = [1.93e-5, 1.66e-5];
var ATTACK_TIME = [[1.11491, 1.00746, 0.0007], [1.11532, 1.00332, 0.0008]];
var DECAY_TIME = [[1.168, 1.00067, 0.0003], [1.167, 1.00055, 0.0003]];
var RELEASE_TIME = [[1.11976, 1.00292, 0.0003], [1.12386, 1.00429, 0.0003]];
var DECAY_FALL = [0.05, 0.035];
var SUSTAIN_V = [[0.0431, 3.7727, -2.2079, 2.2245], [-0.4729, 4.9704, -2.4266, 2.3829]];
var RELEASED = [0.1426, -0.4964];
var RELEASE_OFF_AT = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
var RELEASED_OFF = [[0.1392, -0.0179, -0.0688, -0.0872, -0.1049, -0.1178, -0.1263, -0.1936, -0.2195, -0.2363, -0.2443],
  [-0.4998, -0.6582, -0.6988, -0.7182, -0.7368, -0.7513, -0.7601, -0.8294, -0.8585, -0.8773, -0.886]];
var RELEASE_OFF = [[0.0005, 0.0178, 0.0209, 0.0217, 0.0224, 0.0228, 0.0231, 0.0249, 0.0256, 0.026, 0.0262],
  [0.0005, 0.0174, 0.0200, 0.0208, 0.0215, 0.0220, 0.0222, 0.0238, 0.0243, 0.0246, 0.0247]];
var POT = { // ATTACK and DECAY as the voice has them (voice.rs), ohm
  fa: [[0.15, 10.49e3], [0.2, 13.56e3], [0.4, 27.64e3], [0.5, 36.02e3], [0.6, 46.90e3], [0.7, 225.9e3], [0.85, 669.0e3], [1.0, 946.8e3]],
  fd: [[0.15, 10.47e3], [0.2, 15.94e3], [0.4, 33.12e3], [0.5, 43.46e3], [0.6, 52.19e3], [0.7, 236.8e3], [0.85, 581.7e3], [1.0, 768.2e3]],
  la: [[0.15, 10.45e3], [0.2, 14.13e3], [0.4, 30.97e3], [0.5, 41.85e3], [0.6, 47.29e3], [0.7, 267.0e3], [0.85, 703.8e3], [1.0, 982.6e3]],
  ld: [[0.15, 10.47e3], [0.2, 13.00e3], [0.4, 27.42e3], [0.5, 37.04e3], [0.6, 44.53e3], [0.7, 206.4e3], [0.85, 558.5e3], [1.0, 755.4e3]] };
var SUSTAIN_TRACK = [[0, 0], [0.2, 0.1611], [0.4, 0.3735], [0.5, 0.4924], [0.6, 0.6185], [0.8, 0.8375], [1, 1]];
var VOLUME_TRACK = [[0, 0], [0.2, 0.1548], [0.4, 0.3777], [0.6, 0.6226], [0.8, 0.8453], [1, 1]];
var EXT_TAPER = [[0.2, 0.01181], [0.4, 0.02845], [0.5, 0.03710], [0.6, 0.04645], [0.8, 0.50938], [1.0, 1.0]];
var GLIDE_LAW = [[0.25, 162e3], [0.5, 257e3], [0.75, 2.1e6], [1.0, 5e6]], GLIDE_RATE = 9.76e7, GLIDE_FALLING = 0.535;
var OSC2_CENTS = [-855.506, 1753.088, -94.505, 19.578], OSC3_CENTS = [-862.370, 1806.991, -206.463, 83.185];
var OSC3_FREE_CENTS = [-3797.431, 9228.8, -4699.331, 3541.6, -1559.71, 402.07], OSC3_FREE_KEY = 55.479;
var TUNE_CENTS = 267.44, LO_BELOW_2 = 8.74;
// the waves' levels against the sawtooth's, the rectangles' duty cycles, the triangle's bottom,
// the shark tooth's parts; each wave's source resistance into its mixer channel
var WAVE_LEVEL = { tri: 0.857, shark: 0.893, saw: 1.0, rsaw: 1.0, sq: 1.032, wide: 1.046, narrow: 1.059 };
var DUTY = { sq: 0.484, wide: 0.30, narrow: 0.179 }, TRI_BOTTOM = 0.4915;
var SHARK_T = 0.704, SHARK_S = 0.189, SHARK_AHEAD = 0.0175;
var SOURCE_OHMS = { tri: 687, saw: 2246, rsaw: 2246, sq: 3500, wide: 3500, narrow: 3500, shark: 8790 }, OSC3_LEVEL = 0.914;
var NOISE_OHMS = [700, 26.2e3];
// the VCA: its gain every 0.1 V of the loudness contour (1 at 4.455 V)
var VCA_GAIN = [0.0, 0.001, 0.0096, 0.0281, 0.0503, 0.0737, 0.0976, 0.1215, 0.1454, 0.1691, 0.1927, 0.219,
  0.245, 0.2706, 0.296, 0.3211, 0.3458, 0.3702, 0.3969, 0.4232, 0.4491, 0.4746, 0.4997,
  0.5245, 0.5512, 0.5775, 0.601, 0.6264, 0.6536, 0.6803, 0.7065, 0.7321, 0.7573, 0.782,
  0.8082, 0.8338, 0.8589, 0.8854, 0.9112, 0.9364, 0.961, 0.9839, 0.9959, 0.9992, 1.0001, 1.0];

var RANGE = ["LO", "32'", "16'", "8'", "4'", "2'"], RANGE_OCT = [LO_BELOW_2, 4, 3, 2, 1, 0];
var WAVE12 = ["tri", "shark", "saw", "sq", "wide", "narrow"], WAVE3 = ["tri", "rsaw", "saw", "sq", "wide", "narrow"];
var WAVE_NAME = { tri: "TRIANGLE", shark: "SHARK", saw: "SAW", rsaw: "REV SAW", sq: "SQUARE", wide: "WIDE", narrow: "NARROW" };

// the cutoff knob (-5..5) as the ring's pitch at the keyboard's 0 V, log2 Hz
function cutLog2(c) {
  var k = clamp((c + 5) / 10, 0, 1) * 20, i = Math.min(19, Math.floor(k));
  return CUTOFF_LOG2[i] + (CUTOFF_LOG2[i + 1] - CUTOFF_LOG2[i]) * (k - i);
}
function emphasisR14(p) {
  p = clamp(p, 0, 1);
  var n = EMPHASIS_R14[EMPHASIS_R14.length - 1];
  if (p >= n[0]) return n[1] * audioTaper(1 - p) / audioTaper(1 - n[0]);
  for (var i = 1; i < EMPHASIS_R14.length; i++) {
    var a = EMPHASIS_R14[i - 1], b = EMPHASIS_R14[i];
    if (p <= b[0]) return a[1] * Math.pow(b[1] / a[1], (p - a[0]) / (b[0] - a[0]));
  }
  return n[1];
}
// the loop's gain (4 rings) at a cutoff for EMPHASIS 0..10, as set_panel and coefficients
// work it out (without LOOP_SCALE, the pair's slope: it is in units where 4 rings)
function loopGain(emph, lg2) {
  var e = 1 - Math.log(1 + 80 * emphasisR14(emph / 10) / 50e3) / Math.log(81);
  var gains = [];
  for (var r = 0; r < LOOP.length; r++) {
    var th = interp(THRESHOLD_AT_LOG2, THRESHOLD, LOOP_AT_LOG2[r]), sh = interp(THRESHOLD_AT_LOG2, SHIFT, LOOP_AT_LOG2[r]);
    var near = 1 - clamp((th - e) / EMPHASIS_NEAR, 0, 1), at = interp(EMPHASIS_AT, LOOP[r], e + near * sh);
    gains.push(at > 4 ? 4 + (at - 4) * RING_GAIN : at);
  }
  return interp(LOOP_AT_LOG2, gains, lg2);
}
// a four-pole ladder with loop gain k peaks (1 + k)/(4 - k) over its passband; Pung's
// picture draws a peak of Q = 0.707 * 10^(1.15 r): the r that draws the ladder's peak
function resonanceOf(k) {
  if (k >= 3.995) return 1;
  var q = (1 + k) / (4 - k);
  return clamp(Math.log(q / 0.707) / Math.LN10 / 1.15, 0, 1);
}
function contourShare(amount) { return interp([0, 0.25, 0.5, 0.75, 1], AMOUNT, clamp(amount / 10, 0, 1)); }
function cubic(c, x) { return c[0] + x * (c[1] + x * (c[2] + x * c[3])); }

// a contour as the light voice runs it (ContourLaw): its levels, V, each stage's time, s,
// and the attack's curve; `which` 0 the filter's, 1 the loudness'
function contour(a, d, s, decayOn, which) {
  var tm = function (t, ohms) { return t[0] * Math.pow(ohms / 1e5, t[1]) + t[2]; };
  var rD = rheo(d / 10, which ? POT.ld : POT.fd);
  var tauA = tm(ATTACK_TIME[which], rheo(a / 10, which ? POT.la : POT.fa));
  var rest = REST[which], peak = PEAK[which], aim = rest + ATTACK_AIM[which] * (peak - rest);
  var stop = peak - (aim - peak) * ATTACK_ESR[which] / tauA;
  var sus = cubic(SUSTAIN_V[which], track(SUSTAIN_TRACK, s / 10));
  var tauD = tm(DECAY_TIME[which], rD), tauR, rel;
  if (decayOn) { tauR = tm(RELEASE_TIME[which], rD); rel = RELEASED[which]; }
  else { tauR = interp(RELEASE_OFF_AT, RELEASE_OFF[which], clamp(d / 10, 0, 1)); rel = interp(RELEASE_OFF_AT, RELEASED_OFF[which], clamp(d / 10, 0, 1)); }
  // the decay: du/dt = -u (1 + f u) / tau toward the sustain; a stage drawn to 1% of its way
  var f = DECAY_FALL[which], u0 = Math.max(0, stop - sus), u1 = u0 / 100;
  var decayS = u0 > 1e-6 ? tauD * (Math.log(u0 / (1 + f * u0)) - Math.log(u1 / (1 + f * u1))) : 0;
  return { rest: rest, stop: stop, sus: sus, rel: rel, attackS: tauA * Math.log((aim - rest) / (aim - stop)),
    attackC: Math.log((aim - stop) / (aim - rest)), decayS: decayS, releaseS: tauR * Math.log(100),
    aim: aim, tauA: tauA, tauD: tauD, tauR: tauR, f: f, u0: u0 };
}
var STAGE_C = -Math.log(100); // decay and release: RC to 1% of their way
function contourOf(v, which) {
  var p = which ? "loudness_" : "filter_";
  return contour(num(v, p + "attack", 0), num(v, p + "decay", 4), num(v, p + "sustain", 5), on(v, "decay_on", true), which);
}
// the mixer: a channel's gain for its VOLUME through the loaded pot (light.rs `channel`)
function channel(vol, src, series) {
  var law = function (p, s) {
    p = clamp(p, 0, 1);
    var up = s + 25e3 * (1 - p), dn = Math.max(25e3 * p, 1e-3);
    return (dn / (up + dn)) / (up * dn / (up + dn) + series);
  };
  return law(track(VOLUME_TRACK, vol), src) / law(1, SOURCE_OHMS.saw);
}
// each source's level against itself at 10, dB (the panel's dial), or null when off
function mixDb(v, i) {
  var k = ["osc1_volume", "ext_volume", "osc2_volume", "noise_volume", "osc3_volume"][i];
  var x = num(v, k, 0) / 10;
  if (x <= 0.0005) return null;
  if (i === 1) { var t = extTaper(x); return 20 * Math.log(extGain(t) / extGain(1)) / Math.LN10; }
  var src = i === 3 ? NOISE_OHMS[on(v, "noise_type") ? 1 : 0] : SOURCE_OHMS[oscWave(v, i === 0 ? 1 : i === 2 ? 2 : 3)];
  return 20 * Math.log(channel(x, src, i === 3 ? 11e3 : 33e3) / channel(1, src, i === 3 ? 11e3 : 33e3)) / Math.LN10;
}
function extTaper(p) { return rheo(p, EXT_TAPER); }
function extGain(t) { return 173.5 * t / (1 + 10.16 * t * (1 - t)); }
// an oscillator's gain into the bus against a sawtooth at 10 (its wave's own level too)
function busGain(v, o) {
  var w = oscWave(v, o), x = num(v, "osc" + o + "_volume", 0) / 10;
  if (x <= 0.0005) return 0;
  return channel(x, SOURCE_OHMS[w], 33e3) * WAVE_LEVEL[w] * (o === 3 ? OSC3_LEVEL : 1);
}
function oscWave(v, o) { return (o === 3 ? WAVE3 : WAVE12)[idx(v, "osc" + o + "_waveform", 6, 2)]; }
// FREQUENCY (osc 2, 3: -7.5..7.5, the pot's wiper (v + 7.5)/15) from its centre, cents
function freqCents(v, o) {
  if (o === 1) return 0;
  var x = clamp((num(v, "osc" + o + "_frequency", 0) + 7.5) / 15, 0, 1);
  if (o === 3 && !on(v, "osc3_control", true)) {
    var q = function (x) { var a = 0; for (var i = OSC3_FREE_CENTS.length - 1; i >= 0; i--) a = a * x + OSC3_FREE_CENTS[i]; return a; };
    return q(x) - q(0.5);
  }
  var c = o === 2 ? OSC2_CENTS : OSC3_CENTS;
  return cubic(c, x) - cubic(c, 0.5);
}
// semitones from a key on 2' ... (the range, the FREQUENCY, TUNE)
function oscSemis(v, o) {
  var free = o === 3 && !on(v, "osc3_control", true);
  return (2 - RANGE_OCT[idx(v, "osc" + o + "_range", 6, 3)]) * 12 + freqCents(v, o) / 100 + (free ? 0 : num(v, "tune", 0) / 2.5 * TUNE_CENTS / 100);
}
// an oscillator's Hz on a key (oscillator 3 free: as key 55.48 held, TUNE not at all)
function oscHz(v, o, key) {
  var free = o === 3 && !on(v, "osc3_control", true);
  return 440 * Math.pow(2, ((free ? OSC3_FREE_KEY : key) - 69 + oscSemis(v, o)) / 12);
}
// one sample of a wave at phase p (0..1), as Osc::tick draws it (band-limiting aside)
function waveAt(w, p) {
  p -= Math.floor(p);
  switch (w) {
  case "tri": return WAVE_LEVEL.tri * (p < TRI_BOTTOM ? 1 - p * 2 / TRI_BOTTOM : (p - TRI_BOTTOM) * 2 / (1 - TRI_BOTTOM) - 1);
  case "shark": var q = p + SHARK_AHEAD; q -= Math.floor(q); return SHARK_T * (4 * Math.abs(q - 0.5) - 1) + SHARK_S * (1 - 2 * p);
  case "saw": return 1 - 2 * p;
  case "rsaw": return -(1 - 2 * p);
  }
  var d = DUTY[w];
  return WAVE_LEVEL[w] * ((p < d ? 1 : -1) - (2 * d - 1));
}

// ---- what reads where (push.display): the circuit's units ----------------------------------
function secs(s) {
  if (s < 0.0995) return (s * 1000 < 9.95 ? (s * 1000).toFixed(1) : String(Math.round(s * 1000))) + " ms";
  if (s < 0.9995) return Math.round(s * 1000) + " ms";
  return (s < 9.95 ? s.toFixed(2) : s.toFixed(1)) + " s";
}
function hzTxt(h) { return h >= 1000 ? (h >= 9950 ? Math.round(h / 1000) : (h / 1000).toFixed(h >= 1995 ? 1 : 2)) + " kHz" : Math.round(h) + " Hz"; }
function centsTxt(c) {
  var s = c > 0.05 ? "+" : c < -0.05 ? "-" : "";
  return Math.abs(c) < 99.5 ? s + Math.abs(c).toFixed(Math.abs(c) < 9.95 ? 1 : 0) + " ct" : s + (Math.abs(c) / 100).toFixed(2) + " st";
}
function glideMs(p) { var ohms = rheo(p / 10, GLIDE_LAW) + 330; return 12 / (GLIDE_RATE / ohms) * 1000; } // an octave up, ms
var TIME_KEY = { filter_attack: [0, "a"], filter_decay: [0, "d"], loudness_attack: [1, "a"], loudness_decay: [1, "d"] };
push.display(function (key, rv) {
  var x = parseFloat(rv);
  if (isNaN(x)) return;
  if (key === "cutoff") { var t = hzTxt(Math.pow(2, cutLog2(x))).split(" "); return { value: t[0], unit: t[1] }; }
  if (key === "osc2_frequency" || key === "osc3_frequency") {
    var c = cubic(key === "osc2_frequency" ? OSC2_CENTS : OSC3_CENTS, clamp((x + 7.5) / 15, 0, 1)) - cubic(key === "osc2_frequency" ? OSC2_CENTS : OSC3_CENTS, 0.5);
    var ct = centsTxt(c).split(" "); return { value: ct[0], unit: ct[1] };
  }
  if (key === "tune") { var tt = centsTxt(x / 2.5 * TUNE_CENTS).split(" "); return { value: tt[0], unit: tt[1] }; }
  if (TIME_KEY[key]) {
    var w = TIME_KEY[key][0], c0 = contour(TIME_KEY[key][1] === "a" ? x : 0, TIME_KEY[key][1] === "d" ? x : 4, 5, true, w);
    // the stage's time as the envelope runs it: the attack to its plateau, the decay to 1% of
    // its way (its time constant through the pot, times ln 100)
    var tm = function (t, ohms) { return t[0] * Math.pow(ohms / 1e5, t[1]) + t[2]; };
    var s = TIME_KEY[key][1] === "a" ? c0.attackS : tm(DECAY_TIME[w], rheo(x / 10, w ? POT.ld : POT.fd)) * Math.log(100);
    var st = secs(s).split(" "); return { value: st[0], unit: st[1] };
  }
  if (key === "glide") { if (x <= 0.0005) return "Off"; var g = secs(glideMs(x) / 1000).split(" "); return { value: g[0], unit: g[1] + "/oct" }; }
});
function shown(v, k) {
  if (!known(v, k)) return "--";
  var d = v[k].display !== undefined && v[k].display !== "" ? String(v[k].display) : String(v[k].value);
  return (d + (v[k].unit ? " " + v[k].unit : "")).toUpperCase();
}

// ---- the contours' times for Pung's live envelope ---------------------------------------------
push.envelopeTimes(function (env) {
  var which = -1, st = env.stages, i;
  for (i = 0; i < st.length; i++) {
    if (st[i].key === "filter_attack") which = 0;
    if (st[i].key === "loudness_attack") which = 1;
  }
  if (which < 0) return st.map(function () { return null; });
  var p = which ? "loudness_" : "filter_", val = function (k, d) { var r = env.value(k); return r === null || r === undefined ? d : parseFloat(r); };
  var c = contour(val(p + "attack", 0), val(p + "decay", 4), val(p + "sustain", 5), val("decay_on", 1) >= 0.5, which);
  return st.map(function (s) {
    if (s.plateau) return null;
    return s.role === "attack" ? c.attackS : s.role === "decay" ? c.decayS : s.role === "release" ? c.releaseS : null;
  });
});
// Pung's envelope for a contour: attack and decay on their knobs, the release on DECAY (the
// panel's DECAY switch on) or on the switch itself (off: the release is some 20 ms, as a
// switch at 0 draws it), the circuit's curves
function contourPic(g, v, which, x, y, w, h, labels, col) {
  var p = which ? "loudness_" : "filter_", c = contourOf(v, which), sh = contourShape(c, which);
  g.envelope(x, y, w, h, { attack: p + "attack", decay: p + "decay", sustain: p + "sustain",
    release: on(v, "decay_on", true) ? p + "decay" : "decay_on", labels: labels,
    levels: { attack: 1, decay: sh.sus, sustain: sh.sus, release: sh.rel }, curves: sh.curves, color: col });
}
// a contour as it is heard: the filter's in its volts above rest (the cutoff moves by octaves a
// volt), the loudness' through the VCA's law (flat above 4.4 V: a plateau and a SUSTAIN of 10
// sound alike). Each stage's course is sampled from the circuit's RC segments: how far along its
// levels at 17 even times (Pung's envelope takes that as the stage's curve)
var VCA_VOLTS = VCA_GAIN.map(function (q, i) { return i * 0.1; });
function vcaGain(volts) { return volts <= 0 ? 0 : interp(VCA_VOLTS, VCA_GAIN, volts); }
function contourShape(c, which) {
  var lv = which ? vcaGain : function (volts) { return volts - c.rest; };
  var top = lv(c.stop), L = function (volts) { return top > 1e-9 ? clamp(lv(volts) / top, 0, 1) : 0; };
  var N = 16, i, att = [], dec = [], rel = [];
  var vA = function (t) { return c.aim - (c.aim - c.rest) * Math.exp(-t / c.tauA); };
  var q0 = c.u0 / (1 + c.f * c.u0), vD = function (t) { var q = q0 * Math.exp(-t / c.tauD); return c.sus + q / (1 - c.f * q); };
  var vR = function (t) { return c.rel + (c.sus - c.rel) * Math.exp(-t / c.tauR); };
  var lS = L(c.sus), lR = L(c.rel), along = function (from, to, at) { return Math.abs(to - from) < 1e-4 ? 0 : clamp((at - from) / (to - from), 0, 1); };
  for (i = 0; i <= N; i++) {
    var u = i / N;
    att.push(along(L(c.rest), 1, L(vA(u * c.attackS))));
    dec.push(along(1, lS, L(vD(u * c.decayS))));
    rel.push(along(lS, lR, L(vR(u * c.releaseS))));
  }
  att[N] = 1; dec[N] = 1; rel[N] = 1;
  return { sus: lS, rel: lR, curves: { attack: att, decay: dec, release: rel } };
}

// ---- the panel's colours: black, white print, aluminium caps, walnut ---------------------------
var PANEL = "#101010", PRINT = "#eeebe4", PRINT_DIM = "#8f8b83", PRINT_FAINT = "#34332f", RULE = "#c9c5bc";
var ALU = "#c3c6cb", ALU_DK = "#7f8388", SKIRT = "#050505", SKIRT_RIM = "#2e2e2e";
var WOOD = "#7a4424", WOOD_DK = "#4b2614", WOOD_GR = "#683819", WOOD_HI = "#8d5532";
var CURVE = "#e4e7ea", WELL = "#060606", LAMP = "#ff3b26", LAMP_OFF = "#3a110c", AMBER = "#f2a33a", AMBER_DK = "#3b2a12";
var FILL = "#2b2d30";

var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5; // a knob's travel: 7 o'clock to 5 o'clock
function cheeks(g) {
  for (var s = 0; s < 2; s++) {
    var x = s ? 950 : 0;
    g.fill(x, 0, 10, 160, WOOD);
    for (var i = 0; i < 4; i++) g.fill(x + 1 + i * 2 + (i % 2), 0, 1, 160, i % 2 ? WOOD_GR : WOOD_HI);
    g.fill(s ? 950 : 9, 0, 1, 160, WOOD_DK);
  }
}
// the panel's knob: a black skirt, its scale printed round it, the aluminium cap
function knobGround(g, x, y, r, ticks) {
  if (ticks) for (var i = 0; i <= 10; i++) {
    var a = A0 + i / 10 * SWEEP;
    g.dot(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4), i % 5 ? 0.8 : 1.4, i % 5 ? PRINT_DIM : PRINT);
  }
  g.dot(x, y, r, SKIRT_RIM); g.dot(x, y, r - 1, SKIRT);
  g.dot(x, y, r * 0.66, ALU_DK); g.dot(x, y, r * 0.66 - 1, ALU);
}
// its pointer: a black line across the cap, white on the skirt; the touched one ringed
function knobPointer(g, x, y, r, f, hot) {
  var a = A0 + clamp(f, 0, 1) * SWEEP, ca = Math.cos(a), sa = Math.sin(a);
  g.line(x + ca * r * 0.15, y + sa * r * 0.15, x + ca * (r * 0.66 - 1), y + sa * (r * 0.66 - 1), 2, SKIRT);
  g.line(x + ca * (r * 0.66 + 0.5), y + sa * (r * 0.66 + 0.5), x + ca * (r - 0.5), y + sa * (r - 0.5), 2, hot ? "slot" : PRINT);
  if (hot) g.arc(x, y, r + 3, 0, Math.PI * 2, 2, "slot");
}
// a rotary switch (RANGE, WAVEFORM): the same knob, its pointer on a detent
function detentF(i, n) { return n > 1 ? 0.1 + 0.8 * i / (n - 1) : 0.5; }
function lamp(g, x, y, lit) { g.dot(x, y, 3.5, lit ? LAMP : LAMP_OFF); if (lit) g.dot(x - 1, y - 1, 1.2, "#ffc2b5"); }
// a value in the value face, its unit after it in the label face
function valueUnit(g, x, y, s, unit, col, maxw) {
  var uw = unit ? g.measure(unit) + 4 : 0;
  g.value(x, y, s, col, -1, maxw - uw);
  if (unit) g.text(x + Math.min(g.measure(s, "value"), maxw - uw) + 4, y, unit, col, -1);
}
function parts(v, k) {
  if (!known(v, k)) return ["--", ""];
  var d = v[k].display !== undefined && v[k].display !== "" ? String(v[k].display) : String(v[k].value);
  return [d.toUpperCase(), String(v[k].unit || "").toUpperCase()];
}

// ---- PANEL -----------------------------------------------------------------------------------
var SEC = [["CONTROLLERS", 12, 94], ["OSCILLATOR BANK", 110, 272], ["MIXER", 386, 122], ["MODIFIERS", 512, 336], ["OUTPUT", 852, 96]];
var CTL_Y = [30, 52, 74], OSC_Y = [35, 52, 69], MIX_Y = [26, 40, 54, 68, 82];
var MIX_KEYS = ["osc1_volume", "ext_volume", "osc2_volume", "noise_volume", "osc3_volume"], MIX_NAMES = ["OSC 1", "FDBK", "OSC 2", "NOISE", "OSC 3"];
var FX = 516, FW = 142, CX1 = 664, CX2 = 758, CW = 90, MOD_TOP = 31, MOD_H = 57;
function panelGround(g, kn, seg) {
  g.fill(0, 0, 960, 160, PANEL);
  // the aluminium trim along the top, the instrument's name pressed into it
  g.fill(10, 0, 940, 14, ALU);
  g.fill(10, 14, 940, 1, ALU_DK);
  g.text(20, 11, "MODEL-72", SKIRT, -1);
  g.fill(84, 3, 1, 9, ALU_DK);
  cheeks(g);
  for (var i = 0; i < SEC.length; i++) {
    var s = SEC[i], tw = g.measure(s[0]);
    g.fill(s[1] + 4, 95, s[2] - 8, 1, RULE);
    g.fill(s[1] + s[2] / 2 - tw / 2 - 5, 95, tw + 10, 1, PANEL);
    g.text(s[1] + s[2] / 2, 99, s[0], PRINT, 0);
    if (i) g.fill(s[1] - 2, 20, 1, 70, PRINT_FAINT);
  }
  // controllers: TUNE, GLIDE, MODULATION MIX
  var cn = ["TUNE", "GLIDE", "MOD MIX"];
  for (i = 0; i < 3; i++) { knobGround(g, 26, CTL_Y[i], 8, false); g.text(40, CTL_Y[i] - 2, cn[i], PRINT_DIM, -1); }
  // the oscillator bank: per oscillator its RANGE, FREQUENCY and WAVEFORM
  g.text(152, 28, "RANGE", PRINT_DIM, 0); g.text(228, 28, "FREQUENCY", PRINT_DIM, 0); g.text(326, 28, "WAVEFORM", PRINT_DIM, 0);
  for (var o = 0; o < 3; o++) {
    var y = OSC_Y[o];
    g.text(116, y + 4, String(o + 1), PRINT, -1);
    knobGround(g, 136, y, 7, false);
    if (o) knobGround(g, 202, y, 7, false); else g.fill(196, y, 12, 1, PRINT_FAINT);
    knobGround(g, 280, y, 7, false);
    well(g, 292, y - 8, 50, 16);
  }
  g.text(128, 89, "OSC 3 CONTROL", PRINT_DIM, -1); g.text(246, 89, "OSC MOD", PRINT_DIM, -1);
  // the mixer: a knob a source, in the panel's order
  for (o = 0; o < 5; o++) knobGround(g, 396, MIX_Y[o], 5.5, false);
  // modifiers: the filter's window, the two contours'
  well(g, FX, MOD_TOP, FW, MOD_H); well(g, CX1, MOD_TOP, CW, MOD_H); well(g, CX2, MOD_TOP, CW, MOD_H);
  // output
  knobGround(g, 870, 34, 9, true);
  g.text(886, 31, "LEVEL", PRINT_DIM, -1);
  g.text(872, 66, "A-440", PRINT_DIM, -1);
  // the encoder row: the panel's knobs under an aluminium rule
  g.fill(10, 104, 940, 2, ALU_DK);
  var top = 110, h = seg ? 30 : 46;
  for (var c = 1; c < 8; c++) g.fill(c * 120, top, 1, h, PRINT_FAINT);
  for (c = 0; c < 8; c++) if (kn[c]) knobGround(g, c * 120 + (c === 7 ? 26 : 29), seg ? 125 : 134, seg ? 10 : 14, !seg);
}
// a window cut into the panel: black, its edge catching the light
function well(g, x, y, w, h) { g.fill(x - 1, y - 1, w + 2, h + 2, "#2a2a2a"); g.fill(x, y, w, h, WELL); }
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 64) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
// a wave over cycles (an edge straight down or up), -1..1 in h at 1.12
function waveCurve(w, x, y, wd, h, cycles) {
  return cached("w|" + w + "|" + x + "|" + y + "|" + wd + "|" + h + "|" + cycles.toFixed(4), function () {
    var n = Math.max(24, Math.min(420, Math.round(wd * 1.5))), pts = [], prev = null;
    for (var i = 0; i <= n; i++) {
      var u = i / n, s = waveAt(w, u * cycles);
      if (prev !== null && Math.abs(s - prev) > 0.6) pts.push(x + wd * u, y + h / 2 - prev / 1.12 * h / 2);
      pts.push(x + wd * u, y + h / 2 - s / 1.12 * h / 2);
      prev = s;
    }
    return pts;
  });
}

function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode, i, o;
  g.layer("m72|" + kn.map(function (k) { return k ? 1 : 0; }).join("") + "|" + seg, function () { panelGround(g, kn, seg); });
  litSegment(g, v);
  // the trim: the sound, the voices (lit as notes hold them), the page
  var pr = known(v, "preset") ? ("0" + (Math.round(num(v, "preset", 0)) + 1)).slice(-2) : "--";
  g.text(92, 11, pr + "  " + txt(v, "preset_name").toUpperCase(), SKIRT, -1, 380);
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(940, 11, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, SKIRT, 1);
  voices(g, v, seg ? 940 : 836, 7);

  // controllers
  var ctl = [["tune", (num(v, "tune", 0) + 2.5) / 5], ["glide", num(v, "glide", 0) / 10], ["mod_mix", num(v, "mod_mix", 0) / 10]];
  var gon = on(v, "glide_on"), gl = num(v, "glide", 0), mix = num(v, "mod_mix", 0) / 10;
  var cv = [centsTxt(num(v, "tune", 0) / 2.5 * TUNE_CENTS).toUpperCase(), !gon ? "OFF" : gl <= 0.0005 ? "AT ONCE" : secs(glideMs(gl) / 1000).toUpperCase() + "/OCT",
    mix < 0.005 ? "OSC 3" : mix > 0.995 ? "NOISE" : Math.round((1 - mix) * 100) + ":" + Math.round(mix * 100)];
  for (i = 0; i < 3; i++) {
    var ck = ctl[i][0], hc = t === ck || (i === 1 && t === "glide_on");
    if (known(v, ck)) knobPointer(g, 26, CTL_Y[i], 8, ctl[i][1], t === ck);
    if (hc) g.text(40, CTL_Y[i] - 2, ["TUNE", "GLIDE", "MOD MIX"][i], "slot", -1);
    g.text(40, CTL_Y[i] + 9, known(v, ck) ? cv[i] : "--", hc ? "slot" : (i === 1 && !gon) ? PRINT_DIM : PRINT, -1, 64);
  }
  // the oscillator bank
  for (o = 1; o <= 3; o++) {
    var y = OSC_Y[o - 1], vol = num(v, "osc" + o + "_volume", 0) > 0.0005, w = oscWave(v, o);
    var ri = idx(v, "osc" + o + "_range", 6, 3), wi = idx(v, "osc" + o + "_waveform", 6, 2);
    var hr = t === "osc" + o + "_range", hw = t === "osc" + o + "_waveform", hf = t === "osc" + o + "_frequency";
    var ink = vol ? PRINT : PRINT_DIM;
    if (known(v, "osc" + o + "_range")) knobPointer(g, 136, y, 7, detentF(ri, 6), hr);
    g.text(148, y + 4, known(v, "osc" + o + "_range") ? RANGE[ri] : "--", hr ? "slot" : ink, -1);
    if (o > 1) {
      var free = o === 3 && !on(v, "osc3_control", true);
      if (known(v, "osc" + o + "_frequency")) knobPointer(g, 202, y, 7, (num(v, "osc" + o + "_frequency", 0) + 7.5) / 15, hf);
      g.text(264, y + 4, !known(v, "osc" + o + "_frequency") ? "--" : free ? hzTxt(oscHz(v, 3, 60)).toUpperCase() : centsTxt(freqCents(v, o)).toUpperCase(), hf ? "slot" : free ? AMBER : ink, 1, 50);
    }
    if (known(v, "osc" + o + "_waveform")) knobPointer(g, 280, y, 7, detentF(wi, 6), hw);
    // two cycles of the wave the circuit makes
    g.poly(waveCurve(w, 295, y - 6, 44, 12, 2), hw ? 2 : 1.5, hw ? "slot" : vol ? CURVE : PRINT_DIM);
    g.text(346, y + 4, WAVE_SHORT[w], hw ? "slot" : ink, -1, 34);
  }
  lamp(g, 120, 85, on(v, "osc3_control", true)); lamp(g, 238, 85, on(v, "osc_mod"));
  if (t === "osc3_control") g.text(128, 89, "OSC 3 CONTROL", "slot", -1);
  if (t === "osc_mod") g.text(246, 89, "OSC MOD", "slot", -1);
  // the mixer: each source's level in dB against itself at 10
  for (i = 0; i < 5; i++) {
    var k = MIX_KEYS[i], my = MIX_Y[i], hm = t === k, db = mixDb(v, i);
    if (known(v, k)) knobPointer(g, 396, my, 5.5, num(v, k, 0) / 10, hm);
    var lbl = i === 3 ? (on(v, "noise_type") ? "PINK" : "WHITE") : MIX_NAMES[i];
    g.text(408, my + 4, lbl, hm || (i === 3 && t === "noise_type") ? "slot" : db !== null ? PRINT : PRINT_DIM, -1);
    g.text(504, my + 4, !known(v, k) ? "--" : db === null ? "OFF" : (db > -0.05 ? "0" : db.toFixed(db > -9.95 ? 1 : 0)) + " DB", hm ? "slot" : db !== null ? PRINT : PRINT_DIM, 1);
  }
  // modifiers: the ladder where the circuit puts it, the contour's reach, both contours
  filterPic(g, v, FX, MOD_TOP, FW, MOD_H, false);
  contourPic(g, v, 0, CX1, MOD_TOP, CW, MOD_H, false, CURVE);
  contourPic(g, v, 1, CX2, MOD_TOP, CW, MOD_H, false, CURVE);
  var fh = /^(cutoff|emphasis|contour_amount|keyboard_control|filter_mode)/.test(t);
  g.text(FX, 28, "FILTER", fh ? "slot" : PRINT_DIM, -1);
  g.text(FX + FW, 28, known(v, "cutoff") ? (on(v, "filter_mode") ? "HI " : "") + hzTxt(Math.pow(2, cutLog2(num(v, "cutoff", 0)))).toUpperCase() : "--", fh ? "slot" : PRINT, 1);
  g.text(CX1, 28, "CONTOUR", /^filter_(attack|decay|sustain)/.test(t) ? "slot" : PRINT_DIM, -1);
  g.text(CX2, 28, "LOUDNESS", /^loudness_/.test(t) || t === "decay_on" ? "slot" : PRINT_DIM, -1);
  // output: LEVEL, A-440's lamp, AUTO GAIN's correction
  var hl = t === "level";
  if (known(v, "level")) knobPointer(g, 870, 34, 9, (num(v, "level", 0) + 30) / 42, hl);
  if (hl) g.text(886, 31, "LEVEL", "slot", -1);
  g.text(886, 43, known(v, "level") ? num(v, "level", 0).toFixed(1) + " DB" : "--", hl ? "slot" : PRINT, -1, 60);
  lamp(g, 862, 62, on(v, "a440"));
  if (on(v, "a440") || t === "a440") g.text(872, 66, "A-440", t === "a440" ? "slot" : PRINT, -1);
  var ag = on(v, "auto_gain", true);
  g.text(858, 84, ag ? "AUTO " + (known(v, "auto_db") ? num(v, "auto_db", 0).toFixed(1) : "--") + " DB" : "AUTO OFF", t === "auto_gain" ? "slot" : ag ? PRINT : PRINT_DIM, -1, 88);
  row(g, v);
}
var WAVE_SHORT = { tri: "TRI", shark: "SHARK", saw: "SAW", rsaw: "R.SAW", sq: "SQR", wide: "WIDE", narrow: "NARR." };
// the voices the mode plays: a lamp each in the trim, lit while notes hold them
function voices(g, v, xr, y) {
  var mode = idx(v, "mode", 3, 0), n = mode === 0 ? 1 : clamp(Math.round(num(v, "voices", 4)), 1, 10);
  var lv = v.$live || {}, held = 0, vs = lv.voices || [];
  for (var i = 0; i < vs.length; i++) if (vs[i].held) held++;
  var lit = mode === 2 ? (held ? n : 0) : Math.min(n, held);
  var x = xr - n * 7 + 2;
  for (i = 0; i < n; i++) { g.dot(x + i * 7 + 2, y, 2.5, i < lit ? LAMP : LAMP_OFF); }
  g.text(x - 6, 11, ["MONO", "POLY", "UNISON"][mode] + (idx(v, "quality", 2) ? " HI" : ""), SKIRT, 1);
}

// the ladder's response where the circuit sets it, and how far the contour takes it
function filterGeom(v) {
  var lg = cutLog2(num(v, "cutoff", 0)), k = loopGain(num(v, "emphasis", 0), lg), c = contourOf(v, 0);
  var oct = CONTOUR_OCT_PER_V * contourShare(num(v, "contour_amount", 5));
  return { lg: lg, k: k, peak: lg + oct * (c.stop - c.rest), sus: lg + oct * (c.sus - c.rest) };
}
function axisX(x, w, lg2) { return x + 6 + (w - 12) * clamp((lg2 - log2(20)) / log2(1000), 0, 1); }
function filterPic(g, v, x, y, w, h, big) {
  var f = filterGeom(v), t = v.$touched || "";
  var at = clamp((f.lg - log2(20)) / log2(1000), 0, 1);
  g.filter(x, y, w, h, { cutoff: "cutoff", resonance: resonanceOf(f.k), type: on(v, "filter_mode") ? "HP 24 dB" : "LP 24 dB", at: at, color: CURVE });
  if (!known(v, "cutoff")) return;
  // the contour's reach along the foot: from the cutoff to its peak, the sustain marked
  var xa = axisX(x, w, f.lg), xp = axisX(x, w, f.peak), xs = axisX(x, w, f.sus), yb = y + h - 5, hot = t === "contour_amount";
  if (xp - xa > 1.5) {
    var col = hot ? "slot" : AMBER;
    g.fill(xa, yb, xp - xa, 2, col);
    g.poly([xp - 4, yb - 3, xp, yb + 1, xp - 4, yb + 5], 2, col);
    g.fill(xs - 1, yb - 4, 2, 10, col);
  }
  if (big) {
    // the keys: where C1 to C6 take the cutoff (KEYBOARD CONTROL 1, 2, both)
    var kc = (on(v, "keyboard_control_1", true) ? 1 : 0) + (on(v, "keyboard_control_2") ? 2 : 0);
    if (kc) for (var key = 36; key <= 96; key += 12) {
      var xk = axisX(x, w, f.lg + KEYBOARD_CONTROL[kc - 1] * (key - TRACKING_FROM) / 12);
      g.fill(xk, y + 3, 1, 6, /^keyboard/.test(t) ? "slot" : PRINT_DIM);
      if (key === 36 || key === 96) g.text(xk, y + 17, key === 36 ? "C1" : "C6", /^keyboard/.test(t) ? "slot" : PRINT_DIM, 0);
    }
  }
}

// the encoder row: the panel's knobs, the legend over the value
function row(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode;
  for (var c = 0; c < 8; c++) {
    var k = kn[c];
    if (!k) continue;
    var x0 = c * 120, hot = k === t, cx = x0 + (c === 7 ? 26 : 29), cy = seg ? 125 : 134, r = seg ? 10 : 14;
    if (known(v, k)) knobPointer(g, cx, cy, r, knobF(v, k), hot);
    var tx = x0 + (seg ? 45 : c === 7 ? 46 : 52), tw = (c === 7 ? 946 : x0 + 117) - tx, pv = parts(v, k);
    g.text(tx, seg ? 120 : 125, NAMES[k] || String((v[k] && v[k].name) || k).toUpperCase(), hot ? "slot" : PRINT_DIM, -1, tw);
    valueUnit(g, tx, seg ? 139 : 149, pv[0], pv[1], hot ? "slot" : PRINT, tw);
  }
}
// where a knob points: its travel, a switch on its stop
function knobF(v, k) {
  if (v[k] && v[k].type === "enum") { var n = Math.round((v[k].max || 1) - (v[k].min || 0)) + 1; return detentF(idx(v, k, n, 0), n); }
  return fr(v, k, 0);
}
var NAMES = { tune: "TUNE", glide: "GLIDE", glide_on: "GLIDE SW", decay_on: "DECAY SW", mod_mix: "MOD MIX", mod_wheel: "WHEEL",
  osc_mod: "OSC MOD", osc3_control: "OSC 3 CTL", filter_mod: "FILT MOD", cutoff: "CUTOFF", emphasis: "EMPHASIS",
  contour_amount: "CONTOUR", filter_attack: "F ATTACK", filter_decay: "F DECAY", filter_sustain: "F SUSTAIN",
  loudness_attack: "L ATTACK", loudness_decay: "L DECAY", loudness_sustain: "L SUSTAIN", keyboard_control_1: "KBD CTL 1",
  keyboard_control_2: "KBD CTL 2", filter_mode: "FILT MODE", osc1_volume: "OSC 1", osc2_volume: "OSC 2",
  osc3_volume: "OSC 3", noise_volume: "NOISE", ext_volume: "FEEDBACK", noise_type: "NOISE", drive: "DRIVE",
  bass_comp: "BASS COMP", level: "LEVEL", auto_gain: "AUTO GAIN", auto_db: "AUTO DB", a440: "A-440", mode: "MODE", voices: "VOICES",
  quality: "QUALITY", entropy: "ENTROPY", midi_bend_range: "BEND", at_mod: "AT > MOD", note_priority: "PRIORITY" };
(function () { for (var o = 1; o <= 3; o++) { NAMES["osc" + o + "_range"] = "RANGE " + o; NAMES["osc" + o + "_waveform"] = "WAVE " + o; NAMES["osc" + o + "_frequency"] = "FREQ " + o; } })();

// ---- segments: the panel's sections under the hands ------------------------------------------
var SEGS = [
  { id: "ctl", label: "Controllers", rect: [12, 20, 94, 82], keys: ["tune", "glide", "glide_on", "mod_mix", "mod_wheel", "osc_mod", "filter_mod", "decay_on"] },
  { id: "osc", label: "Oscillators", rect: [110, 20, 272, 82], keys: ["osc1_range", "osc1_waveform", "osc2_range", "osc2_frequency", "osc2_waveform", "osc3_range", "osc3_frequency", "osc3_waveform"] },
  { id: "mixer", label: "Mixer", rect: [386, 20, 122, 82], keys: ["osc1_volume", "ext_volume", "osc2_volume", "noise_volume", "osc3_volume", "noise_type", "drive", "bass_comp"] },
  { id: "filter", label: "Filter", rect: [512, 20, 242, 82], keys: ["cutoff", "emphasis", "contour_amount", "filter_attack", "filter_decay", "filter_sustain", "keyboard_control_1", "keyboard_control_2"] },
  { id: "loud", label: "Loudness", rect: [756, 20, 94, 82], keys: ["loudness_attack", "loudness_decay", "loudness_sustain", "decay_on", "level"] },
  { id: "out", label: "Output", rect: [852, 20, 96, 82], keys: ["level", "a440", "auto_gain", "mode", "voices", "quality", "entropy", "note_priority"] }];
// the active segment's title along the foot, or its legends, lit in the slot's colour
var SEG_LIT = { ctl: [[59, 99, "CONTROLLERS", 0]], osc: [[246, 99, "OSCILLATOR BANK", 0]], mixer: [[447, 99, "MIXER", 0]],
  filter: [[FX, 28, "FILTER", -1], [CX1, 28, "CONTOUR", -1]], loud: [[CX2, 28, "LOUDNESS", -1]], out: [[900, 99, "OUTPUT", 0]] };
function litSegment(g, v) {
  if (v.$segmode !== "segment" || !SEG_LIT[v.$segment]) return;
  var L = SEG_LIT[v.$segment];
  for (var i = 0; i < L.length; i++) g.text(L[i][0], L[i][1], L[i][2], "slot", L[i][3]);
}

// the names under a band screen and on Pung's pages, where the page already says what they
// belong to (the module's own are cut there: "OSC 2.", "FILTER S.", "EXT IN /.")
var SHORT = { osc1_range: "RANGE 1", osc1_waveform: "WAVE 1", osc2_range: "RANGE 2", osc2_frequency: "FREQ 2", osc2_waveform: "WAVE 2",
  osc3_range: "RANGE 3", osc3_frequency: "FREQ 3", osc3_waveform: "WAVE 3", osc1_volume: "OSC 1", ext_volume: "FDBK", osc2_volume: "OSC 2",
  noise_volume: "NOISE", osc3_volume: "OSC 3", noise_type: "COLOR", drive: "DRIVE", bass_comp: "BASS CMP", cutoff: "CUTOFF",
  emphasis: "EMPHASIS", contour_amount: "AMOUNT", filter_attack: "ATTACK", filter_decay: "DECAY", filter_sustain: "SUSTAIN",
  keyboard_control_1: "KBD 1", keyboard_control_2: "KBD 2", filter_mode: "MODE", filter_mod: "MOD", loudness_attack: "ATTACK",
  loudness_decay: "DECAY", loudness_sustain: "SUSTAIN", decay_on: "DECAY SW", level: "LEVEL", auto_gain: "AUTO", auto_db: "CORR",
  a440: "A-440", tune: "TUNE", glide: "GLIDE", glide_on: "GLIDE SW", midi_bend_range: "BEND", mod_mix: "MOD MIX", mod_wheel: "WHEEL",
  osc_mod: "OSC MOD", osc3_control: "OSC3 CTL", at_mod: "AT>MOD", mode: "MODE", voices: "VOICES", note_priority: "PRIORITY",
  retrigger: "RETRIG", entropy: "ENTROPY", quality: "QUALITY", spread: "WIDTH", inner: "INNER", double: "DETUNE", played_as: "PLAYED",
  placement: "PLACE" };
push.short(function (key) { return SHORT[key]; });

// Pung's default pages on the panel's black, its aluminium-capped knobs and white print
push.theme({ ground: PANEL, panel: ALU, ink: PRINT, dim: PRINT_DIM, rule: "#5d5b57", faint: PRINT_FAINT, accent: CURVE, knob: "pointer" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true, segments: SEGS,
  pages: [
    { label: "Play", keys: ["cutoff", "emphasis", "contour_amount", "filter_decay", "loudness_decay", "glide", "mod_wheel", "level"] },
    { label: "Contours", keys: ["filter_attack", "filter_decay", "filter_sustain", "contour_amount", "loudness_attack", "loudness_decay", "loudness_sustain", "decay_on"] }
  ],
  extra_keys: ["preset", "preset_name", "tune", "glide_on", "mod_mix", "osc3_control", "osc_mod", "filter_mod", "decay_on",
    "osc1_range", "osc1_waveform", "osc2_range", "osc2_waveform", "osc2_frequency", "osc3_range", "osc3_waveform", "osc3_frequency",
    "osc1_volume", "osc2_volume", "osc3_volume", "noise_volume", "ext_volume", "noise_type", "filter_attack", "filter_sustain",
    "loudness_attack", "loudness_sustain", "keyboard_control_1", "keyboard_control_2", "filter_mode", "a440", "auto_gain", "auto_db",
    "mode", "voices", "quality"],
  screen: panel
});

// ---- band screens: the panel's black, a walnut edge, titles as the panel prints them -----------
function band(g, key, titles) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, PANEL);
    g.fill(0, 0, 4, g.h, WOOD); g.fill(4, 0, 1, g.h, WOOD_DK);
    for (var i = 0; i < titles.length; i++) {
      var s = titles[i], tw = g.measure(s[2]);
      g.text(s[0], 9, s[2], PRINT_DIM, -1);
      if (s[1] > tw + 12) g.fill(s[0] + tw + 6, 5, s[1] - tw - 6, 1, PRINT_FAINT);
    }
    if (titles.extra) titles.extra(g);
  });
}

// ---- OSCILLATORS: the bank on one time base, the bus it makes, how it beats ---------------------------
var LANE_X = 118, LANE_W = 382;
function oscScreen(g, v) {
  band(g, "m72-osc", [[10, 490, "OSCILLATOR BANK: TWO CYCLES OF 8'"], [520, 200, "THE BUS INTO THE LADDER"]]);
  var t = v.$touched || "", o;
  for (o = 1; o <= 3; o++) {
    var y = 17 + (o - 1) * 23, w = oscWave(v, o), ri = idx(v, "osc" + o + "_range", 6, 3), gain = busGain(v, o);
    var hot = t.indexOf("osc" + o + "_") === 0, free = o === 3 && !on(v, "osc3_control", true);
    var cyc = free ? 2 * oscHz(v, 3, 60) / (440 * Math.pow(2, -9 / 12)) : 2 * Math.pow(2, 2 - RANGE_OCT[ri]) * Math.pow(2, freqCents(v, o) / 1200);
    var ink = hot ? "slot" : gain > 0 ? PRINT : PRINT_DIM;
    g.text(10, y + 10, String(o), ink, -1);
    g.text(24, y + 10, (known(v, "osc" + o + "_range") ? RANGE[ri] : "--"), t === "osc" + o + "_range" ? "slot" : ink, -1);
    g.text(52, y + 10, WAVE_NAME[w], t === "osc" + o + "_waveform" ? "slot" : ink, -1, 62);
    g.fill(LANE_X, y + 6, LANE_W, 1, PRINT_FAINT);
    g.poly(waveCurve(w, LANE_X, y - 2, LANE_W, 16, Math.min(cyc, 48)), hot ? 2 : 1.5, hot ? "slot" : gain > 0 ? CURVE : PRINT_DIM);
  }
  // the bus: the three at their mixer levels, summed
  var gs = [busGain(v, 1), busGain(v, 2), busGain(v, 3)], ws = [oscWave(v, 1), oscWave(v, 2), oscWave(v, 3)];
  var cy = [1, 2, 3].map(function (o) {
    if (o === 3 && !on(v, "osc3_control", true)) return oscHz(v, 3, 60) / (440 * Math.pow(2, -9 / 12));
    return Math.pow(2, 2 - RANGE_OCT[idx(v, "osc" + o + "_range", 6, 3)]);
  });
  var sig = gs.map(function (x) { return x.toFixed(3); }).join(",") + ws.join(",") + cy.map(function (x) { return x.toFixed(4); }).join(",");
  var bus = cached("bus|" + sig, function () {
    var n = 320, raw = [], pk = 0, i;
    for (i = 0; i <= n; i++) { var u = i / n, s = 0; for (var q = 0; q < 3; q++) if (gs[q]) s += gs[q] * waveAt(ws[q], u * 2 * cy[q]); raw.push(s); pk = Math.max(pk, Math.abs(s)); }
    for (i = 0; i <= n; i++) raw[i] = pk ? raw[i] / pk : 0;
    return { raw: raw, pk: pk };
  });
  // how the bank beats at middle C: the bus's level (its RMS over a cycle of the lowest) over two
  // seconds. Each pair of oscillators an octave apart (or in unison) correlates by how far one
  // has drifted from the other: their cross-correlation, worked out once, read along the drift
  var cents = [2, 3].map(function (o) { return freqCents(v, o).toFixed(2); }).join(",") + "|" + num(v, "tune", 0) + "|" + on(v, "osc3_control", true);
  var beat = cached("beat|" + sig + "|" + cents, function () {
    var hz = [1, 2, 3].map(function (o) { return oscHz(v, o, 60); }), n = 211, i, a2, b2, j, N = 32;
    var self = 0, pairs = [];
    for (a2 = 0; a2 < 3; a2++) if (gs[a2]) {
      var m = 0;
      for (j = 0; j < N; j++) { var x = waveAt(ws[a2], j / N); m += x * x; }
      self += gs[a2] * gs[a2] * m / N;
    }
    for (a2 = 0; a2 < 3; a2++) for (b2 = 0; b2 < 3; b2++) {
      if (a2 === b2 || !gs[a2] || !gs[b2] || hz[b2] < hz[a2] || (hz[b2] === hz[a2] && b2 < a2)) continue;
      var R = Math.pow(2, Math.round(log2(hz[b2] / hz[a2])));
      if (Math.abs(log2(hz[b2] / hz[a2]) - log2(R)) > 0.03) continue; // not a unison or octave: no steady correlation
      var C = [];
      for (var k = 0; k < N; k++) { var acc = 0; for (j = 0; j < N; j++) acc += waveAt(ws[a2], j / N) * waveAt(ws[b2], R * j / N + k / N); C.push(acc / N); }
      pairs.push({ g: 2 * gs[a2] * gs[b2], C: C, d: hz[b2] - R * hz[a2] });
    }
    var env = [], mx = 0;
    for (i = 0; i <= n; i++) {
      var tt = 2 * i / n, e = self;
      for (j = 0; j < pairs.length; j++) { var ph = pairs[j].d * tt, f = (ph - Math.floor(ph)) * N, i0 = Math.floor(f) % N, fr = f - Math.floor(f); e += pairs[j].g * (pairs[j].C[i0] + (pairs[j].C[(i0 + 1) % N] - pairs[j].C[i0]) * fr); }
      env.push(Math.sqrt(Math.max(0, e))); mx = Math.max(mx, env[i]);
    }
    var pts = [];
    for (i = 0; i <= n; i++) pts.push(522 + 422 * i / n, 84 - (mx ? env[i] / mx : 0) * 22);
    var bh = 0;
    for (j = 0; j < pairs.length; j++) if (Math.abs(pairs[j].d) > 0.005) bh = bh ? Math.min(bh, Math.abs(pairs[j].d)) : Math.abs(pairs[j].d);
    return { pts: pts, bh: bh };
  });
  // in tune the bus takes the whole height; beating, it shares it with the beat (its caption on
  // a line of its own between them)
  var beating = !!(bus.pk && beat.bh), by = beating ? 31 : 50, ba = beating ? 14 : 32;
  var bpts = cached("busp|" + sig + "|" + beating, function () { var o = []; for (var q = 0; q < bus.raw.length; q++) o.push(522 + 422 * q / (bus.raw.length - 1), by - bus.raw[q] * ba); return o; });
  g.fill(522, by, 422, 1, PRINT_FAINT);
  if (bus.pk) { g.area(bpts, by, FILL); g.poly(bpts, 2, CURVE); }
  else g.text(733, 52, "NO OSCILLATOR UP IN THE MIXER", PRINT_DIM, 0);
  g.text(944, 9, !bus.pk ? "" : beating ? "SLOWEST BEAT " + (beat.bh < 10 ? beat.bh.toFixed(2) : beat.bh.toFixed(1)) + " HZ" : "IN TUNE: NO BEAT", PRINT, 1);
  if (beating) {
    g.text(522, 56, "HOW IT BEATS AT MIDDLE C, OVER 2 SECONDS", PRINT_DIM, -1);
    g.area(beat.pts, 84, AMBER_DK); g.poly(beat.pts, 2, AMBER);
  }
}
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [{ label: "Oscillators", keys: ["osc1_range", "osc1_waveform", "osc2_range", "osc2_frequency", "osc2_waveform", "osc3_range", "osc3_frequency", "osc3_waveform"] }],
  extra_keys: ["osc1_volume", "osc2_volume", "osc3_volume", "osc3_control", "tune"],
  screen: oscScreen
});

// ---- MIXER: Pung's mixer at the levels the loaded pots give, and what feeds the ladder -------------------
push.compartment({ id: "mixer", label: "Mixer", pages: [{ label: "Mixer", keys: ["osc1_volume", "ext_volume", "osc2_volume", "noise_volume", "osc3_volume", "noise_type", "drive", "bass_comp"] }] });

// ---- FILTER: the ladder where the circuit puts it, the contour's reach, the keys --------------------
function filterScreen(g, v) {
  band(g, "m72-filter", [[10, 398, "FILTER: FOUR-POLE LADDER"], [420, 152, "IN NUMBERS"], [584, 360, "FILTER CONTOUR"]]);
  var t = v.$touched || "", f = filterGeom(v), hz = function (l) { return hzTxt(Math.pow(2, l)).toUpperCase(); };
  filterPic(g, v, 8, 14, 404, 72, true);
  if (!known(v, "cutoff")) return;
  var x = 420, ring = f.k >= 3.995, pk = (1 + f.k) / Math.max(1e-3, 4 - f.k), oct = f.peak - f.lg;
  var kc = (on(v, "keyboard_control_1", true) ? 1 : 0) + (on(v, "keyboard_control_2") ? 2 : 0);
  var rows = [
    ["CUTOFF", (on(v, "filter_mode") ? "HI " : "") + hz(f.lg), t === "cutoff" || t === "filter_mode"],
    ["EMPHASIS", ring ? "RINGS" : pk > 1.01 ? "+" + (20 * Math.log(pk) / Math.LN10).toFixed(1) + " DB" : "NO PEAK", t === "emphasis"],
    ["CONTOUR", oct > 0.05 ? "+" + oct.toFixed(1) + " OCT" : "NONE", t === "contour_amount"],
    ["HOLDS AT", oct > 0.05 ? hz(f.sus) : "--", t === "filter_sustain"],
    ["KEYS", kc ? KEYBOARD_CONTROL[kc - 1].toFixed(2) + " /OCT" : "OFF", /^keyboard/.test(t)]];
  for (var i = 0; i < rows.length; i++) {
    var y = 24 + i * 13;
    g.text(x, y, rows[i][0], rows[i][2] ? "slot" : PRINT_DIM, -1);
    g.text(572, y, rows[i][1], rows[i][2] ? "slot" : (i === 1 && ring) || (i === 2 && oct > 0.05) ? AMBER : PRINT, 1);
  }
  contourPic(g, v, 0, 584, 14, 360, 72, true, CURVE);
}
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["cutoff", "emphasis", "contour_amount", "filter_attack", "filter_decay", "filter_sustain", "keyboard_control_1", "keyboard_control_2"] },
    { label: "Mode", keys: ["filter_mode", "filter_mod", "decay_on", "drive", "bass_comp"] }],
  extra_keys: ["filter_mode", "decay_on"],
  screen: filterScreen
});

// ---- LOUDNESS: the contour and the VCA's law ----------------------------------------------------------
function loudScreen(g, v) {
  band(g, "m72-loud", [[10, 566, "LOUDNESS CONTOUR"], [590, 354, "THE VCA'S LAW"]]);
  var t = v.$touched || "", c = contourOf(v, 1);
  contourPic(g, v, 1, 8, 14, 568, 72, true, CURVE);
  // the VCA's gain against the contour's volts, 0 to 5.6 V; its sustain and plateau on it
  var x0 = 594, x1 = 760, y0 = 68, y1 = 18, vmax = 5.6;
  var law = cached("vca", function () {
    var pts = [];
    for (var i = 0; i < VCA_GAIN.length; i++) pts.push(x0 + (x1 - x0) * (i * 0.1) / vmax, y0 - (y0 - y1) * VCA_GAIN[i]);
    pts.push(x1, y1);
    return pts;
  });
  for (var vt = 0; vt <= 5; vt++) g.fill(x0 + (x1 - x0) * vt / vmax, y0 + 1, 1, 3, PRINT_DIM);
  g.fill(x0, y0, x1 - x0, 1, PRINT_FAINT);
  g.area(law, y0, FILL);
  g.poly(law, 2, CURVE);
  var vx = function (volts) { return x0 + (x1 - x0) * clamp(volts, 0, vmax) / vmax; };
  var gain = vcaGain;
  var sh = t === "loudness_sustain", sg = gain(c.sus);
  g.fill(vx(c.stop), y1, 1, y0 - y1, PRINT_DIM);
  g.fill(vx(c.sus) - 1, y1, 2, y0 - y1, sh ? "slot" : AMBER);
  g.dot(vx(c.sus), y0 - (y0 - y1) * sg, 3.5, sh ? "slot" : AMBER);
  g.text(x0, 79, "0 V", PRINT_DIM, -1); g.text(x0 + (x1 - x0) * 5 / vmax, 79, "5 V", PRINT_DIM, 0); g.text(x0 + (x1 - x0) / 2, 79, "CONTOUR", PRINT_DIM, 0);
  var tx = 774;
  g.text(tx, 24, "SUSTAIN", sh ? "slot" : PRINT_DIM, -1);
  g.text(944, 24, sg >= 0.9995 ? "FULL LEVEL" : (20 * Math.log(Math.max(1e-4, sg)) / Math.LN10).toFixed(1) + " DB", sh ? "slot" : AMBER, 1);
  g.text(tx, 38, "FLAT ABOVE 4.4 V:", PRINT_DIM, -1);
  g.text(tx, 49, "THE PEAK AND A SUSTAIN", PRINT_DIM, -1);
  g.text(tx, 60, "OF 10 ARE ONE LEVEL", PRINT_DIM, -1);
  g.text(tx, 76, "RELEASE", t === "decay_on" ? "slot" : PRINT_DIM, -1);
  g.text(944, 76, on(v, "decay_on", true) ? "AT DECAY'S TIME" : "AT ONCE", t === "decay_on" ? "slot" : PRINT, 1);
}
push.compartment({
  id: "loud", label: "Loudness",
  pages: [{ label: "Loudness", keys: ["loudness_attack", "loudness_decay", "loudness_sustain", "decay_on", "level", "auto_gain", "auto_db", "a440"] }],
  screen: loudScreen
});

// ---- CONTROLLERS: tune, glide, and the modulation bus -------------------------------------------------
function ctlScreen(g, v) {
  band(g, "m72-ctl", [[10, 300, "CONTROLLERS"], [324, 620, "MODULATION: OSC 3 AND NOISE, THROUGH THE WHEEL"]]);
  var t = v.$touched || "";
  var gon = on(v, "glide_on"), gl = num(v, "glide", 0);
  g.text(10, 26, "TUNE", t === "tune" ? "slot" : PRINT_DIM, -1);
  var tc = centsTxt(num(v, "tune", 0) / 2.5 * TUNE_CENTS).toUpperCase().split(" ");
  valueUnit(g, 10, 44, known(v, "tune") ? tc[0] : "--", known(v, "tune") ? tc[1] : "", t === "tune" ? "slot" : PRINT, 120);
  g.text(150, 26, "GLIDE", t === "glide" || t === "glide_on" ? "slot" : PRINT_DIM, -1);
  if (!gon || gl <= 0.0005) g.value(150, 44, !gon ? "OFF" : "AT ONCE", gon ? PRINT : PRINT_DIM, -1, 150);
  else {
    var up = secs(glideMs(gl) / 1000).toUpperCase().split(" ");
    valueUnit(g, 150, 44, up[0], up[1] + " AN OCTAVE UP", t === "glide" ? "slot" : PRINT, 160);
    g.text(150, 56, secs(glideMs(gl) / 1000 / GLIDE_FALLING).toUpperCase() + " DOWN", PRINT_DIM, -1, 160);
  }
  g.text(10, 66, "BEND", t === "midi_bend_range" ? "slot" : PRINT_DIM, -1);
  g.text(10, 78, known(v, "midi_bend_range") ? num(v, "midi_bend_range", 2).toFixed(1) + " ST UP AND DOWN" : "--", t === "midi_bend_range" ? "slot" : PRINT, -1);
  g.text(150, 66, "DECAY", t === "decay_on" ? "slot" : PRINT_DIM, -1);
  g.text(150, 78, on(v, "decay_on", true) ? "ON: RELEASE AT DECAY" : "OFF: RELEASE AT ONCE", t === "decay_on" ? "slot" : PRINT, -1, 160);
  // the bus: OSC 3 and NOISE mixed, the wheel, to the oscillators and the filter
  var mix = num(v, "mod_mix", 0) / 10, wheel = num(v, "mod_wheel", 0), om = on(v, "osc_mod"), fm = on(v, "filter_mod"), at = on(v, "at_mod");
  var o3 = oscWave(v, 3), A = "#3d3c38", y1 = 32, y2 = 70, mx = 548, wx = 662, dx = 744;
  var s1 = 1 - mix > 0.005, s2 = mix > 0.005, flow = wheel > 0.001 || at;
  g.text(334, y1 - 8, "OSC 3", s1 ? PRINT : PRINT_DIM, -1);
  g.poly(waveCurve(o3, 334, y1 - 4, 110, 14, on(v, "osc3_control", true) ? 3 : 1.5), 1.5, s1 ? CURVE : PRINT_DIM);
  g.text(334, y2 - 8, on(v, "noise_type") ? "PINK NOISE" : "WHITE NOISE", s2 ? PRINT : PRINT_DIM, -1);
  for (var i = 0; i < 22; i++) {
    var nx = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; nx -= Math.floor(nx);
    g.fill(334 + i * 5, y2 + 3 - nx * 6, 2, 2 + nx * 12, s2 ? PRINT_DIM : PRINT_FAINT);
  }
  g.line(452, y1 + 3, mx - 14, 50, s1 ? 2 : 1, s1 ? CURVE : A);
  g.line(452, y2 + 3, mx - 14, 50, s2 ? 2 : 1, s2 ? CURVE : A);
  knobGround(g, mx, 50, 11, true);
  knobPointer(g, mx, 50, 11, mix, t === "mod_mix");
  g.text(mx, 80, "MOD MIX " + Math.round((1 - mix) * 100) + ":" + Math.round(mix * 100), t === "mod_mix" ? "slot" : PRINT_DIM, 0);
  // the wheel (and pad pressure, when AT > MOD turns it)
  g.line(mx + 16, 50, wx - 12, 50, 2, flow ? CURVE : A);
  g.fill(wx - 9, 20, 18, 50, SKIRT_RIM); g.fill(wx - 7, 22, 14, 46, SKIRT);
  for (i = 0; i < 8; i++) g.fill(wx - 7, 25 + i * 6, 14, 1, "#1c1c1c");
  var wy = 64 - 38 * clamp(wheel, 0, 1);
  g.fill(wx - 7, wy - 2, 14, 4, t === "mod_wheel" ? "slot" : ALU);
  g.text(wx, 81, "WHEEL " + Math.round(wheel * 100) + "%" + (at ? " + PRESS" : ""), t === "mod_wheel" || t === "at_mod" ? "slot" : PRINT_DIM, 0);
  // where it goes
  var po = om && flow, pf = fm && flow;
  g.line(wx + 12, 50, dx, 50, 2, flow ? CURVE : A);
  g.line(dx, 50, dx + 26, y1, po ? 2 : 1, po ? CURVE : A);
  g.line(dx, 50, dx + 26, y2, pf ? 2 : 1, pf ? CURVE : A);
  lamp(g, dx + 34, y1, om); lamp(g, dx + 34, y2, fm);
  g.text(dx + 44, y1 - 2, "OSC MOD", t === "osc_mod" ? "slot" : om ? PRINT : PRINT_DIM, -1);
  g.text(dx + 44, y1 + 9, on(v, "osc3_control", true) ? "PITCH OF OSC 1, 2, 3" : "PITCH OF OSC 1, 2", t === "osc3_control" ? "slot" : PRINT_DIM, -1, 150);
  g.text(dx + 44, y2 - 2, "FILTER MOD", t === "filter_mod" ? "slot" : fm ? PRINT : PRINT_DIM, -1);
  g.text(dx + 44, y2 + 9, "THE CUTOFF", PRINT_DIM, -1);
}
push.compartment({
  id: "ctl", label: "Controllers",
  pages: [
    { label: "Controllers", keys: ["tune", "glide", "glide_on", "decay_on", "a440", "midi_bend_range", "keyboard_control_1", "keyboard_control_2"] },
    { label: "Modulation", keys: ["mod_mix", "mod_wheel", "osc_mod", "filter_mod", "osc3_control", "at_mod"] }
  ],
  extra_keys: ["osc3_waveform", "osc3_range", "osc3_frequency", "noise_type"],
  screen: ctlScreen
});

// Pung's own pages for the voices and the stereo field
push.compartment({ id: "voice", label: "Voice", pages: [{ label: "Voice", keys: ["mode", "voices", "note_priority", "retrigger", "entropy", "quality"] }] });
push.compartment({ id: "stereo", label: "Stereo", pages: [{ label: "Stereo", keys: ["spread", "inner", "double", "played_as", "placement"] }] });
