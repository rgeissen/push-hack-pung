// Frodhes (a physically modelled electric piano, vibraphone and marimba; the
// module's own name) on Push. An overlay shipped with Pung (the module ships
// no push_ui.js).
//
// Frodhes computes every note from how the instrument works: a hammer strikes
// a tine and a magnetic pickup turns its motion into a voltage (STAGE 77,
// SUITCASE, EARLY FELT, BELL DYNO), or a mallet strikes a bar and its tuned
// tube rings along (VIBES, MARIMBA). Its own panels (the desktop plugin, the
// FM-1) are black with silver knobs and an orange light, the voice split into
// HOW THE TINE IS STRUCK and HOW NOTES DIE AWAY, then the effects in their
// chain. The screens follow that, and draw the physics as the engine runs it:
//
//   PANEL   the strike as a chain, left to right as the energy goes: the
//           hammer's contact (its time), the tine's modes as struck, the
//           pickup's field with the tine swinging through it (TONE moves the
//           tine against the pole, BARK widens the swing), the voltage that
//           comes out. On VIBES and MARIMBA: the mallet, the bar with its
//           nodes and the strike point, the modes the strike excites, the
//           tube (and the motor's discs). Then the ring (Pung's envelope, on
//           the engine's own T60s) and the effects chain with its lights.
//   VOICE   the same physics at full width, a page per instrument as the
//           module names them (PIANO, VIBES, MOTOR, MARIMBA).
//   DYNAMICS the compressor's curve (6 dB soft knee, its ratio) and its gain
//           reduction live, the EQ's response.
//   DRIVE / FILTER  the drive type, the resonant filter (Pung's, live) and the
//           LFO that moves it (Pung's).
//
// Everything below is from the module's source (build/modsrc/frodhes):
// docs/model/data/params.json and rhodes_spec.json (pickup field, offsets,
// TYPE voicings, T60s, contact times, the bark per velocity), vibes.json and
// marimba.json, firmware/gen/bars_tables.h (mode frequencies, the strike
// position weights BAR_POS, KN_FAM, KN_MASS, KN_TUBE, BAR_PRATE),
// firmware/src/params.c (TONE, BARK, BELL, HAMMER, DECAY, RELEASE laws),
// plugin/ui/frui_text.c (every value's text) and fx.c (the compressor).

// ---- values ----------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function idiv(a, b) { var q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); } // C's integer division

var TYPES = ["ST77", "SUIT", "FELT", "DYNO", "VIBE", "MRMB"];
var TYPE_LONG = ["STAGE 77", "SUITCASE", "EARLY FELT", "BELL DYNO", "VIBES", "MARIMBA"];
function typeOf(v) { return known(v, "p_type") ? clamp(Math.round(num(v, "p_type", 0)), 0, 5) : -1; }
function isBars(ty) { return ty >= 4; }

// the engine's knob (0..127) behind a key: the bar types' keys are the same
// parameters (move_ui.h: p_strike is TONE + 64, p_mallet BARK, p_tube BELL,
// p_weight HAMMER, p_ring DECAY, p_damper and p_mute RELEASE)
var ENG = { tone: ["p_tone", "p_strike"], bark: ["p_bark", "p_mallet"], bell: ["p_bell", "p_tube"], hammer: ["p_hammer", "p_weight"],
  decay: ["p_decay", "p_ring"], release: ["p_release", "p_damper", "p_mute"] };
function eng(v, what) {
  var ks = ENG[what];
  for (var i = 0; i < ks.length; i++) if (known(v, ks[i])) return num(v, ks[i], 0) + (ks[i] === "p_tone" ? 64 : 0);
  return null;
}
function engKnown(v, what) { return eng(v, what) !== null; }

// ---- the values' texts: frui_text.c, the module's own ------------------------------------------
function r10(x) { var t = idiv(x * 100 + 63, 127); return t >= 100 ? "10.0" : idiv(t, 10) + "." + (t % 10); }
function bip(x) { var t = idiv((x - 64) * 50 + (x >= 64 ? 31 : -31), 63), a = Math.abs(t); return (t < 0 ? "-" : "+") + idiv(a, 10) + "." + (a % 10); }
function db10(t10, t1) { var a = Math.abs(t10); return a >= 100 ? (t10 < 0 ? "-" : "+") + Math.abs(t1) : (t10 < 0 ? "-" : "+") + idiv(a, 10) + "." + (a % 10); }
function lfoHz(x) { return 0.5 * Math.pow(24, x / 127); }  // FX_LFO_INC
function fmtHz(h) { var t = Math.round(h * 10); return t >= 100 ? String(Math.round(h)) : idiv(t, 10) + "." + (t % 10); }
function hzText(hz) {
  var c = idiv(hz + 50, 100);
  if (hz < 1000) return [String(hz), "Hz"];
  return c < 100 ? [idiv(c, 10) + "." + (c % 10), "kHz"] : [String(idiv(hz + 500, 1000)), "kHz"];
}
function flHz(x) { return Math.round(30 * Math.pow(16000 / 30, x / 127)); }          // FX_FL_HZ
function eqHz(x) { return Math.round(5000 * Math.pow(2, -(127 - x) * 2396 / 65536)); }
var DLY_T = [882,912,944,976,1010,1045,1081,1118,1157,1197,1238,1280,1325,1370,1418,1466,1517,1569,1623,1679,1737,1797,1859,1923,1989,2058,2129,2202,2278,2357,2438,2522,2609,2699,2792,2888,2988,3091,3197,3307,3421,3539,3661,3788,3918,4053,4193,4337,4487,4642,4802,4967,5138,5315,5499,5688,5884,6087,6297,6514,6739,6971,7211,7460,7717,7983,8258,8543,8837,9142,9457,9783,10120,10469,10830,11203,11589,11989,12402,12830,13272,13730,14203,14692,15199,15723,16265,16825,17405,18005,18626,19268,19932,20619,21330,22065,22826,23613,24427,25269,26140,27041,27973,28937,29935,30967,32034,33139,34281,35463,36685,37950,39258,40611,42011,43459,44957,46507,48110,49768,51484,53259,55095,56994,58958,60991,63093,65268];
function thrDb(x) { var q = (x * 27434) >> 7; return idiv(q * 60206 + 20480000, 40960000); }  // 0 .. 40
function gainT(x) { var q = (x * 16461) >> 7; return [idiv(q * 60206 + 2048000, 4096000), idiv(q * 60206 + 20480000, 40960000)]; }
function eqDb(x) { var e = x ? x - 64 : -63; return e * 15 / 63; }
var RATIO = ["1.5:1", "2:1", "3:1", "4:1", "6:1", "8:1", "10:1", "20:1"], RATIO_N = [1.5, 2, 3, 4, 6, 8, 10, 20];
var R10 = { p_spread: 1, p_delay: 1, p_bark: 1, p_bell: 1, p_hammer: 1, p_decay: 1, p_release: 1, p_noise: 1, p_tube: 1, p_weight: 1,
  p_ring: 1, p_damper: 1, p_mute: 1, p_mot_depth: 1, p_mot_shape: 1, p_cmp_atk: 1, p_cmp_rel: 1, p_drive: 1, p_drv_mix: 1,
  p_fl_reso: 1, p_fl_lfo: 1, p_tw_depth: 1, p_tw_shape: 1, p_ph_depth: 1, p_ph_fdbk: 1, p_cp_depth: 1, p_dl_depth: 1,
  p_dl_fdbk: 1, p_rv_depth: 1, p_rv_decay: 1, p_rv_mod: 1, p_dl_tone: 1 };
// [value, unit] or a word, from the raw value alone (null: the module's own)
function fmtRaw(k, x) {
  if (R10[k]) return r10(x);
  switch (k) {
  case "p_tone": case "p_drv_tone": case "p_rv_tone": return bip(x + 64);
  case "p_strike": return x === 0 ? "CENTRE" : x === 64 ? "L/3" : x === 127 ? "EDGE" : r10(x);
  case "p_mallet": return x <= 4 ? "SOFT" : x >= 123 ? "RUBBER" : r10(x);
  case "s_tune": return [x ? (x > 0 ? "+" : "") + Math.round(x) : "0", "c"];
  case "p_cmp_amt": return x ? ["-" + thrDb(x), "dB"] : "OFF";
  case "p_cmp_gain": var gt = gainT(x); return [db10(gt[0], gt[1]), "dB"];
  case "p_level": return [db10(idiv((x - 64) * 15 + (x >= 64 ? 4 : -4), 8), idiv((x - 64) * 3 + (x >= 64 ? 8 : -8), 16)), "dB"];
  case "p_eq_lo": case "p_eq_mid": case "p_eq_hi":
    var e = x ? x - 64 : -63;
    return [db10(idiv(e * 150 + (e >= 0 ? 31 : -31), 63), idiv(e * 15 + (e >= 0 ? 31 : -31), 63)), "dB"];
  case "p_eq_freq": return hzText(eqHz(x));
  case "p_fl_freq": return hzText(flHz(x));
  case "p_tw_rate": case "p_lfo_rate": return [fmtHz(lfoHz(x)), "Hz"];
  case "p_mot_rate": return [fmtHz(lfoHz(Math.min(120, x))), "Hz"];
  case "p_cp_speed": case "p_ph_speed": return [fmtHz(lfoHz(x) / 2), "Hz"];
  case "p_dl_time":
    var s = DLY_T[clamp(Math.round(x), 0, 127)], ms = idiv(s * 1000 + 22050, 44100), c = idiv(s * 10 + 22050, 44100);
    return ms < 1000 ? [String(ms), "ms"] : [idiv(c, 10) + "." + (c % 10), "s"];
  case "p_rv_predly": return [String(idiv(idiv(x * 3528, 127) * 1000 + 22050, 44100)), "ms"];
  case "p_rv_size": return x ? r10(x) : "AUTO";
  case "p_rv_locut": return x ? [String(Math.round(800 * Math.pow(2, -(127 - x) * 2767 / 65536))), "Hz"] : "OFF";
  case "p_cmp_ratio": return RATIO[clamp(Math.round(x), 0, 7)];
  }
  return null;
}
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmtRaw(key, n);
  if (f === null) return;
  return typeof f === "string" ? f : { value: f[0], unit: f[1] };
});

// a value as the panel shows it: the instrument that plays names it (the bar
// types' STRIKE, MALLET: frui_text.c's detents), a synced rate its note value
var SYNC_OF = { p_dl_time: "p_dl_sync", p_cp_speed: "p_cp_sync", p_ph_speed: "p_ph_sync", p_lfo_rate: "p_lfo_sync",
  p_mot_rate: "p_mot_sync", p_tw_rate: "p_tw_sync" };
var STRIKE_N = ["CENTRE", "L/3", "EDGE"], STRIKE_V = [0, 64, 127];
var FAM_V = [0, 42, 85, 127], FAM_VIBE = ["SOFT", "YARN", "CORD", "RUBBER"], FAM_MRMB = ["SOFT", "MED", "HARD", "RUBBER"];
function valueOf(v, k, ty) {
  if (!known(v, k)) return ["--", ""];
  var x = num(v, k, 0), sy = SYNC_OF[k];
  if (v[k].type === "enum" || v[k].type === "string") return [txt(v, k), ""];
  if (sy && known(v, sy) && num(v, sy, 0) > 0 && !(k === "p_tw_rate" && num(v, "s_twkind", 0) === 3)) return [txt(v, sy), ""];
  if (isBars(ty) && (k === "p_tone" || k === "p_strike")) {
    var r = k === "p_tone" ? x + 64 : x;
    for (var i = 0; i < 3; i++) if (r === STRIKE_V[i]) return [STRIKE_N[i], ""];
    return [r10(r), ""];
  }
  if (isBars(ty) && (k === "p_bark" || k === "p_mallet")) {
    for (var j = 0; j < 4; j++) if (x + 4 >= FAM_V[j] && x <= FAM_V[j] + 4) return [(ty === 5 ? FAM_MRMB : FAM_VIBE)[j], ""];
    return [r10(x), ""];
  }
  if (k === "p_tw_rate" && num(v, "s_twkind", 0) === 3) return [r10(x), ""];
  if (k === "p_tw_shape" && num(v, "s_twkind", 0) === 3) return ["-", ""];
  if (k === "p_rv_decay" && num(v, "p_rv_type", 0) === 3 && x >= 120) return [x >= 127 ? "FREEZE" : "SUSTAIN", ""];
  var f = fmtRaw(k, x);
  if (f === null) return [txt(v, k), v[k].unit || ""];
  return typeof f === "string" ? [f, ""] : f;
}
// the names, the instrument's own (the bar types rename the voice knobs)
var NAMES = { p_type: "TYPE", p_tone: "TONE", p_bark: "BARK", p_bell: "BELL", p_hammer: "HAMMER", p_decay: "DECAY", p_release: "RELEASE",
  p_noise: "NOISE", s_tune: "TUNE", p_spread: "SPREAD", s_sustain: "SUSTAIN", s_fx: "EFFECTS", p_level: "LEVEL", p_delay: "DELAY",
  p_strike: "STRIKE", p_mallet: "MALLET", p_tube: "TUBE", p_weight: "WEIGHT", p_ring: "RING", p_damper: "DAMPER", p_mute: "MUTE",
  p_mot_on: "MOTOR", p_mot_depth: "DEPTH", p_mot_rate: "SPEED", p_mot_shape: "SHAPE", p_mot_sync: "SYNC",
  p_cmp_sw: "COMP", p_cmp_amt: "THRESH", p_cmp_ratio: "RATIO", p_cmp_atk: "ATTACK", p_cmp_rel: "RELEASE", p_cmp_gain: "MAKEUP",
  p_eq_lo: "LOW", p_eq_mid: "MID", p_eq_freq: "MID FREQ", p_eq_hi: "HIGH",
  p_drv_sw: "DRIVE", p_drive: "DRIVE AMT", p_drv_tone: "TONE", p_drv_mix: "MIX",
  p_fl_type: "FILTER", p_fl_freq: "CUTOFF", p_fl_reso: "RESO", p_fl_lfo: "LFO",
  p_lfo_shape: "LFO SHAPE", p_lfo_rate: "LFO RATE", p_lfo_sync: "LFO SYNC", p_lfo_retrig: "RETRIG",
  s_twkind: "TREM/WAH", p_tw_depth: "DEPTH", p_tw_rate: "RATE", p_tw_shape: "SHAPE", p_tw_sync: "SYNC",
  p_ph_sw: "PHASER", p_ph_depth: "DEPTH", p_ph_speed: "SPEED", p_ph_fdbk: "FEEDBK", p_ph_sync: "SYNC",
  p_cp_sw: "CHORUS", p_cp_depth: "DEPTH", p_cp_speed: "SPEED", p_cp_sync: "SYNC",
  p_dl_sw: "DELAY", p_dl_depth: "DELAY MIX", p_dl_time: "TIME", p_dl_fdbk: "FEEDBK", p_dl_tone: "TONE", p_dl_sync: "SYNC",
  p_rv_type: "REVERB", p_rv_depth: "REVERB MIX", p_rv_decay: "DECAY", p_rv_tone: "TONE", p_rv_predly: "PRE-DLY", p_rv_size: "SIZE",
  p_rv_mod: "MOD", p_rv_locut: "LOW CUT", s_vresp: "RESPONSE" };
var BAR_NAMES = { p_tone: "STRIKE", p_bark: "MALLET", p_bell: "TUBE", p_hammer: "WEIGHT", p_decay: "RING", p_release: "DAMPER" };
function nameOf(v, k, ty) {
  if (isBars(ty) && BAR_NAMES[k]) return ty === 5 && k === "p_release" ? "MUTE" : BAR_NAMES[k];
  if (ty === 5 && k === "p_damper") return "MUTE";
  return NAMES[k] || String((v[k] && v[k].name) || k).toUpperCase();
}

// ---- the colours: the plugin's black panel, silver knobs, the orange light ----------------------
var GROUND = "#0d0d0d", CARD = "#181818", CARD_HI = "#202020", EDGE = "#2b2b2b", TOPBAR = "#050505";
var INK = "#f0f0f0", SILVER = "#cfcfcf", SILVER_LO = "#8f8f8f", LEG = "#8a8a8a", DIM = "#5c5c5c", FAINT = "#333333";
var ORANGE = "#f5892b", ORANGE_LO = "#6e3a10", ORANGE_FILL = "#3a2210", LED_OFF = "#3a2c22";
var ALU = "#b8bcc1", ALU_LO = "#6d7177", ROSE = "#9a5534", ROSE_LO = "#5b2e1b", TUBE_C = "#c9a35a", TUBE_LO = "#4e3f22";

// ---- the physics ----------------------------------------------------------------------------------
// The pickup (params.json "pickup", IMPLEMENTATION-v3 6.8): the flux through
// the coil against the tine tip's position u (gap units, 0 on the pole's
// axis), Phi(u) = integral of g0, g0(u) = (f1 - 2)/f1^2 - (f2 - 2)/f2^2,
// f1 = (u - R)^2 + 1, f2 = (u + R)^2 + 1, R = 1 (the middle keys' family).
// The voltage is dPhi/dt = g0(u) du/dt.
var PU_R = 1.0, PU_U = 2.4;
function g0(u) { var f1 = (u - PU_R) * (u - PU_R) + 1, f2 = (u + PU_R) * (u + PU_R) + 1; return (f1 - 2) / (f1 * f1) - (f2 - 2) / (f2 * f2); }
var PHI = (function () {           // Phi on 241 points over -2.4 .. 2.4 (the flux is greatest on the axis)
  var n = 240, out = [], sub = 8, du = 2 * PU_U / n / sub, u = -PU_U, i, s, p = 0; // relative to u = -2.4
  out.push(p);
  for (i = 0; i < n; i++) {
    for (s = 0; s < sub; s++) { p += g0(u + du * (s + 0.5)) * du; }
    u += du * sub;
    out.push(p);
  }
  return out;
}());
function phiAt(u) { var x = (clamp(u, -PU_U, PU_U) + PU_U) / (2 * PU_U) * 240, i = Math.min(239, Math.floor(x)); return PHI[i] + (PHI[i + 1] - PHI[i]) * (x - i); }
var PHI_MAX = Math.max.apply(null, PHI), PHI_MIN = Math.min.apply(null, PHI);

// The TYPE voicings (params.json "types"): pickup offset change (gap), tip
// swing scale (bark), hammer contact-rate scale, overtone force scale (bell)
var TY_OFF = [0, -0.05, -0.2, 0.1], TY_BARK = [1, 0.8, 0.75, 1.1], TY_HAM = [1, 1, 0.7, 1.2], TY_BELL = [1, 0.9, 0.45, 1.8];
// the tine's rest against the pole: -0.3 gap, TONE (params.c P_TONE: (v - 64)/128
// gap below the middle, 0.2 gap over the upper half), never past -0.1 gap
function pickupOff(tone7, ty) {
  var o = -0.3 + (ty >= 0 && ty < 4 ? TY_OFF[ty] : 0) + (tone7 <= 64 ? (tone7 - 64) / 128 : 0.2 * (tone7 - 64) / 63);
  return Math.min(-0.1, o);
}
// the tip's swing at C4 per velocity anchor (gap): solved offline so this
// pickup gives rhodes_spec.json's measured bark (H2..H5 re H1) at each anchor
var V_ANCH = [1, 8, 24, 40, 56, 72, 88, 104, 120, 127];
var SWING = [0.0094, 0.0114, 0.018, 0.0281, 0.0437, 0.0675, 0.1038, 0.1572, 0.235, 0.2812];
// the hammer's contact at C4 per anchor (ms; rhodes_spec.json pulse.tc_ms)
var TC_MS = [3.146, 3.013, 2.705, 2.428, 2.181, 1.980, 1.810, 1.667, 1.558, 1.522];
function anch(tab, vel) {
  vel = clamp(vel, 1, 127);
  for (var i = 0; i < 9; i++) if (vel <= V_ANCH[i + 1]) return lerp(tab[i], tab[i + 1], (vel - V_ANCH[i]) / (V_ANCH[i + 1] - V_ANCH[i]));
  return tab[9];
}
function barkScale(b7, ty) { return Math.pow(2, (b7 - 64) / 64) * (ty >= 0 && ty < 4 ? TY_BARK[ty] : 1); }     // KN_P64
function bellScale(b7, ty) { return Math.pow(2, (b7 - 64) / 32) * (ty >= 0 && ty < 4 ? TY_BELL[ty] : 1); }     // KN_P32
function hamRate(h7, ty) { return Math.pow(2, (h7 - 64) / 128) * (ty >= 0 && ty < 4 ? TY_HAM[ty] : 1); }       // KN_HAM
// the tine's modes at C4 (rhodes_tables.h, rhodes_spec.json): V1, O1 at 6.80 f0,
// O2 at 18.44 f0, their weights at the tip
var TINE_R = [1, 6.798, 18.441], TINE_W = [0.3918, 0.1535, 0.0202], F0 = 261.63;
// a contact of tc seconds: the reach of its force spectrum (a half sine's
// main lobe, then the envelope of its side lobes), at f Hz
function reach(f, tc) {
  var x = f * tc;
  if (x < 0.5) return Math.abs(Math.cos(Math.PI * x) / (1 - 4 * x * x));
  return Math.min(Math.PI / 4, 1 / (4 * x * x - 1));
}

// The bars (bars_tables.h, at C4): the modes V1 V2 V3 V4 and the twisting
// T1 T2, their frequencies re f0 per type, and how strongly the mallet
// excites each at the 17 strike points (BAR_POS: CENTRE .. L/3 .. EDGE)
var BAR_R = [[1, 4.00, 10.56, 14.19, 3.25, 12.31], [1, 4.00, 9.84, 16.83, 1.89, 7.67]];
var BAR_MODE = ["V1", "V2", "V3", "V4", "T1", "T2"];
var BAR_POS = [
  [[16384,0,16384,0,0,0],[16290,3481,15878,5532,0,0],[16018,6805,14449,10411,0,0],[15567,9820,12221,14084,0,0],[14939,12385,9400,16148,0,0],[14137,14356,6260,16384,0,0],[13180,15669,3136,14979,0,0],[12092,16326,308,12372,0,0],[10901,16384,2039,9100,0,0],[10824,16375,2174,8885,1934,1934],[10824,16375,2174,8885,3998,3998],[10824,16375,2174,8885,6063,6063],[10824,16375,2174,8885,8127,8127],[10824,16375,2174,8885,10191,10191],[10824,16375,2174,8885,12255,12255],[10824,16375,2174,8885,14320,14320],[10824,16375,2174,8885,16384,16384]],
  [[16384,0,16384,0,0,0],[16295,3386,15884,5613,0,0],[16036,6625,14471,10543,0,0],[15608,9576,12267,14219,0,0],[15015,12110,9471,16237,0,0],[14258,14094,6344,16384,0,0],[13355,15465,3205,14855,0,0],[12329,16215,328,12095,0,0],[11202,16384,2090,8655,0,0],[11130,16383,2230,8430,1934,1934],[11130,16383,2230,8430,3998,3998],[11130,16383,2230,8430,6063,6063],[11130,16383,2230,8430,8127,8127],[11130,16383,2230,8430,10191,10191],[11130,16383,2230,8430,12255,12255],[11130,16383,2230,8430,14320,14320],[11130,16383,2230,8430,16384,16384]]];
function posWeights(bt, s7) {      // bars.c: q = raw 4096 / 127, point q >> 8, linear between
  var q = s7 * 4096 / 127, i = Math.min(15, Math.floor(q / 256)), t = q / 256 - i, P = BAR_POS[bt], out = [];
  for (var m = 0; m < 6; m++) out.push((P[i][m] + (P[i + 1][m] - P[i][m]) * t) / 16384);
  if (s7 <= 64) { out[4] = 0; out[5] = 0; }  // the twisting modes only off the centre line
  return out;
}
// where the mallet lands (vibes.json T13a): CENTRE x = 0.5 L, L/3 at x = 0.35 L on
// the centre line, EDGE 0.35 L at 0.45 W off it; linear over the knob's halves
function strikeAt(s7) { return s7 <= 64 ? [lerp(0.5, 0.35, s7 / 64), 0] : [0.35, 0.45 * (s7 - 64) / 63]; }
// the mallets' contact at C4 v104 (ms; BAR_PRATE: 4096 64 / (prate fs)) per family
var FAM_TC = [[2.153, 1.249, 0.458, 0.280, 0.156], [3.607, 1.992, 1.152, 0.637, 0.146]];
var FAM_NAME = [["SOFT YARN", "MED YARN", "DEFAULT", "CORD", "RUBBER"], ["SOFT YARN", "MED YARN", "DEFAULT", "HARD YARN", "RUBBER"]];
var KN_FAM = [[0,6,12,18,24,30,37,43,49,55,61,67,73,79,85,91,98,104,110,116,122,128,134,140,146,152,158,165,171,177,183,189,195,201,207,213,219,226,232,238,244,250,256,268,279,291,303,314,326,337,349,361,372,384,396,407,419,431,442,454,465,477,489,500,512,524,536,549,561,573,585,597,610,622,634,646,658,670,683,695,707,719,731,743,756,768,774,780,786,793,799,805,811,817,823,829,835,841,847,853,860,866,872,878,884,890,896,902,908,914,920,927,933,939,945,951,957,963,969,975,981,987,994,1000,1006,1012,1018,1024],[0,3,7,10,14,18,22,27,31,37,43,49,56,63,73,82,91,100,109,118,126,134,141,148,155,162,168,174,180,186,192,197,203,209,214,220,225,230,235,241,246,251,256,262,268,275,283,292,302,315,331,349,367,384,399,413,426,438,450,461,471,482,492,502,512,522,533,543,554,565,577,588,600,612,624,637,649,662,675,688,702,715,729,743,756,768,776,784,792,797,801,804,808,812,816,820,824,829,833,838,843,849,854,860,866,872,877,882,888,894,901,908,915,923,930,938,945,952,959,966,973,980,987,994,1001,1008,1015,1024]];
var KN_TUBE = [[0,2068,5488,7173,8473,9404,10404,11016,11665,12352,13065,13499,13947,14410,14889,15384,15895,16423,16762,17108,17460,17821,18188,18563,18946,19337,19736,20143,20558,20892,21196,21504,21817,22134,22456,22783,23114,23451,23792,24138,24489,24845,25206,25573,25945,26265,26573,26884,27199,27517,27839,28165,28495,28829,29167,29509,29855,30205,30559,30917,31280,31646,32017,32391,32768,33025,33284,33544,33807,34072,34338,34607,34878,35150,35425,35702,35981,36262,36545,36831,37118,37408,37700,37995,38291,38590,38891,39195,39501,39809,40120,40433,40749,41067,41388,41711,42037,42365,42696,43029,43365,43704,44046,44390,44737,45086,45438,45793,46151,46511,46875,47241,47610,47982,48357,48735,49116,49500,49887,50277,50670,51066,51465,51867,52273,52681,53093,47514],[0,2068,4526,5980,7084,8096,8825,9556,10348,10866,11404,11969,12561,13132,13541,13962,14396,14844,15305,15781,16272,16664,17014,17372,17737,18110,18491,18880,19277,19683,20097,20519,20881,21208,21540,21878,22221,22569,22922,23281,23646,24017,24393,24775,25163,25558,25958,26308,26650,26996,27347,27702,28062,28427,28796,29170,29548,29931,30319,30712,31110,31512,31920,32333,32768,32885,33003,33121,33240,33359,33479,33599,33720,33841,33963,34085,34208,34331,34455,34579,34704,34829,34955,35081,35208,35335,35463,35591,35720,35849,35979,36109,36240,36371,36503,36636,36769,36902,37036,37171,37306,37442,37578,37715,37852,37990,38128,38267,38407,38547,38688,38829,38971,39113,39256,39400,39544,39689,39834,39980,40127,40274,40422,40570,40719,40869,41019,39322]];
// the mallet's mass scales its contact (KN_MASS: 4096 at 64; vibes 10..70 g,
// marimba 12..55 g): a heavier head stays on longer
function massRate(bt, w7) {
  var lo = bt ? 5300 / 4096 : 5907 / 4096, hi = bt ? 0.9385 : 0.9307;
  return w7 <= 64 ? 4096 / (4096 * Math.pow(lo, (64 - w7) / 64)) : 4096 / (4096 * Math.pow(hi, (w7 - 64) / 16));
}
function malletTc(bt, m7, w7) {    // ms: KN_FAM's families, log between, x the mass
  var q = KN_FAM[bt][clamp(Math.round(m7), 0, 127)], f = Math.min(3, q >> 8), a = (q & 255) / 256;
  if (q >= 1024) { f = 4; a = 0; }
  var tc = f >= 4 ? FAM_TC[bt][4] : Math.exp(lerp(Math.log(FAM_TC[bt][f]), Math.log(FAM_TC[bt][f + 1]), a));
  return tc * massRate(bt, w7);
}
function malletName(bt, m7) {
  var q = KN_FAM[bt][clamp(Math.round(m7), 0, 127)], f = q >> 8, a = q & 255;
  if (q >= 1024 || a === 0) return FAM_NAME[bt][Math.min(4, f)];
  return a < 128 ? FAM_NAME[bt][f] : FAM_NAME[bt][f + 1];
}
function tubeScale(bt, t7) { return KN_TUBE[bt][clamp(Math.round(t7), 0, 127)] / 32768; }

// The ring (T60, seconds) per key: params.json t60_v1 and release_t60;
// vibes.json T1b (the median of +-3 reference notes) and T3; marimba.json T1b
function logPts(pts, n) {
  if (n <= pts[0][0]) return pts[0][1];
  for (var i = 0; i < pts.length - 1; i++) if (n <= pts[i + 1][0]) {
    var t = (n - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
    return Math.exp(lerp(Math.log(pts[i][1]), Math.log(pts[i + 1][1]), t));
  }
  return pts[pts.length - 1][1];
}
var EP_T60 = [[31, 28], [39, 23], [45, 18], [51, 19], [57, 20], [63, 18], [69, 18], [75, 13], [81, 6.5], [87, 4.2], [93, 4.0], [96, 2.8]];
var VIB_T60 = [[53, 6.6], [55, 6.1], [57, 6.1], [59, 5.2], [60, 5.2], [62, 5.0], [64, 5.2], [65, 5.2], [67, 5.7], [69, 6.1], [71, 6.5],
  [72, 6.1], [74, 6.7], [76, 7.4], [77, 6.7], [79, 6.7], [81, 6.4], [83, 6.0], [84, 6.0], [86, 5.2], [88, 4.6], [89, 2.4]];
var VIB_FELT = [[53, 1.7], [57, 1.7], [60, 1.0], [83, 1.0], [86, 1.7], [89, 1.7]];
var MAR_T60 = [[36, 1.6], [48, 1.33], [54, 0.98], [60, 0.88], [72, 0.5], [84, 0.3], [96, 0.11]];
function ringT60(ty, n) {
  if (ty === 4) return logPts(VIB_T60, n);
  if (ty === 5) return logPts(MAR_T60, n);
  if (n > 96) return Math.max(0.8, 2.8 * Math.pow(0.5, (n - 96) / 4));
  return logPts(EP_T60, n);
}
function relT60(ty, n) {
  if (ty === 4) return Math.min(0.5 * logPts(VIB_FELT, n), ringT60(4, n));
  if (ty === 5) return null;                     // the hand's mute: no damper law Pung can state
  return n <= 33 ? 0.25 : n <= 60 ? 0.18 : n <= 83 ? 0.14 : 0.12;
}
function decayS(d7) { return Math.pow(2, (d7 - 64) / 32); }                                       // DECAY_K: S
function releaseS(r7, ty) { return ty < 4 && r7 > 64 ? Math.pow(2, 3 * (r7 - 64) / 63) : Math.pow(2, (r7 - 64) / 32); } // rel_k

// the note sounding now, from Pung's notes: its key, velocity, and how far its
// swing has died (the key's own T60s, held then let go); null: none
function liveNote(v, ty, d7, r7) {
  var L = v.$live;
  if (!L || !L.known || !L.voices || !L.voices.length) return null;
  var best = null;
  for (var i = 0; i < L.voices.length; i++) if (!best || L.voices[i].age < best.age) best = L.voices[i];
  if (!best) return null;
  var n = best.note, held = best.held ? best.age : Math.max(0, best.age - (best.released || 0));
  var t60 = ringT60(ty, n) * decayS(d7), lv = Math.pow(10, -3 * held / t60);
  if (!best.held) {
    var rt = relT60(ty, n);
    var rel = rt === null ? t60 : rt * releaseS(r7, ty);
    lv *= Math.pow(10, -3 * (best.released || 0) / rel);
  }
  return { note: n, vel: best.vel, level: lv };
}

// ---- drawing helpers ------------------------------------------------------------------------------
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 64) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
function led(g, x, y, on) { g.dot(x, y, 3, on ? ORANGE : LED_OFF); }
// the plugin's knob: ticks, the travel as an orange arc, a silver cap, its pointer
function knob(g, cx, cy, r, f, ok, hot, bipolar) {
  var a0 = Math.PI * 0.75, sw = Math.PI * 1.5;
  for (var i = 0; i <= 10; i++) {
    var a = a0 + sw * i / 10, c = Math.cos(a), s = Math.sin(a);
    g.line(cx + c * (r + 3), cy + s * (r + 3), cx + c * (r + 6), cy + s * (r + 6), 1.5, i === 0 || i === 10 || i === 5 ? SILVER_LO : FAINT);
  }
  if (ok) {
    var from = bipolar ? a0 + sw / 2 : a0, to = a0 + sw * f;
    if (Math.abs(to - from) > 0.02) g.arc(cx, cy, r + 4.5, Math.min(from, to), Math.abs(to - from), 2.5, hot ? "slot" : ORANGE);
  }
  g.dot(cx, cy, r, hot ? "slot" : ok ? SILVER : DIM);
  g.dot(cx, cy, r - 3, hot ? "slot" : ok ? "#dedede" : DIM);
  if (ok) {
    var ap = a0 + sw * f;
    g.line(cx + Math.cos(ap) * (r * 0.25), cy + Math.sin(ap) * (r * 0.25), cx + Math.cos(ap) * (r - 1), cy + Math.sin(ap) * (r - 1), 2.5, "#151515");
  }
}
function fracOf(v, k) {
  if (!known(v, k)) return 0;
  var it = v[k], lo = it.min, hi = it.max, x = num(v, k, 0);
  if (it.type === "enum") return it.frac;
  if (lo === undefined || hi === undefined || hi <= lo) return it.frac;
  return clamp((x - lo) / (hi - lo), 0, 1);
}
var BIPOLAR = { p_tone: 1, p_drv_tone: 1, p_rv_tone: 1, s_tune: 1, p_eq_lo: 1, p_eq_mid: 1, p_eq_hi: 1, p_level: 1 };

// ---- the strike, drawn: the piano types --------------------------------------------------------
// The hammer's contact: its force over time (a half sine of the contact time),
// on a 0..4 ms axis
function drawHammer(g, x, y, w, h, tc, ok, hot) {
  var base = y + h, pts = [], n = 24, span = 4.0, tw = Math.min(1, tc / span) * w;
  g.fill(x, base, w, 1, FAINT);
  for (var i = 0; i <= 4; i++) g.fill(x + w * i / 4, base, 1, 3, FAINT);
  if (!ok) return;
  for (var j = 0; j <= n; j++) pts.push(x + tw * j / n, base - (h - 4) * Math.sin(Math.PI * j / n));
  g.area(pts, base, hot ? "#3a2c1a" : ORANGE_FILL);
  g.poly(pts, 2, hot ? "slot" : ORANGE);
}
// The tine's modes as struck: lines on a log axis of f/f0 (1 .. 24), heights in
// dB re V1 (0 .. -60): the tip weights, x BELL on O1/O2, x the hammer's reach
function tineModes(bell, tc) {
  var out = [], ref = TINE_W[0] * reach(F0, tc);
  for (var m = 0; m < 3; m++) {
    var a = TINE_W[m] * (m ? bell : 1) * reach(F0 * TINE_R[m], tc);
    out.push(20 * Math.log(Math.max(1e-9, a / ref)) / Math.LN10);
  }
  return out;
}
function drawModes(g, x, y, w, h, ratios, dbs, top, col, ok) {
  var lmax = Math.log(top), base = y + h;
  for (var d = 1; d <= 2; d++) g.fill(x, base - (h - 2) * (1 - d * 20 / 60), w, 1, "#232323");  // -20, -40 dB
  g.fill(x, base, w, 1, FAINT);
  for (var k = 1; k <= top; k *= 2) { var xx = x + w * Math.log(k) / lmax; g.fill(xx, base, 1, 3, FAINT); }
  for (var m = ratios.length - 1; m >= 0; m--) {
    if (ratios[m] <= 0) continue;
    var xm = x + 2 + (w - 4) * Math.log(ratios[m]) / lmax, dd = Math.max(-60, dbs[m]), hh = ok ? Math.max(0, (h - 2) * (1 + dd / 60)) : 0;
    if (hh > 0.5) g.fill(xm - 1, base - hh, 3, hh, m === 0 ? SILVER : col);
  }
}
// The pickup: its field (the flux, greatest on the pole's axis) over the tine's
// travel, the pole and its coil under it, the tine at rest (TONE) and the
// stretch of the field one swing covers (BARK, the velocity)
function drawPickup(g, x, y, w, h, off, amp, ok, hotT, hotB) {
  var base = y + h - 6, top = y + 2;
  function X(u) { return x + w * (u + PU_U) / (2 * PU_U); }
  function Y(u) { return base - 2 - (base - 2 - top) * (phiAt(u) - PHI_MIN) / (PHI_MAX - PHI_MIN); }
  var pts = cached("pu" + x + "|" + w + "|" + h, function () {
    var p = [], n = 60;
    for (var i = 0; i <= n; i++) { var u = -PU_U + 2 * PU_U * i / n; p.push(X(u), Y(u)); }
    return p;
  });
  // the pole piece and its coil, under the field's axis
  var cx = X(0);
  g.fill(cx - 9, base + 1, 18, 5, "#8a5a2b");
  g.fill(cx - 2, base - 1, 4, 7, SILVER);
  g.fill(cx, top + 4, 1, base - top - 4, "#262626");
  g.poly(pts, 2, ok ? "#a8a8a8" : DIM);
  if (!ok) return;
  var u0 = off - amp, u1 = off + amp, seg = [], n = 16;
  for (var j = 0; j <= n; j++) { var u = lerp(u0, u1, j / n); seg.push(X(u), Y(u)); }
  var col = hotB ? "slot" : ORANGE;
  g.poly(seg, 4, col);
  g.dot(X(off), Y(off), 3, hotT ? "slot" : INK);
}
// The voltage out: dPhi/dt over two periods of the tine's swing, to its own peak
function pickupWave(off, amp, n) {
  var raw = [], pk = 0, i;
  for (i = 0; i <= n; i++) {
    var th = 4 * Math.PI * i / n, s = g0(off + amp * Math.sin(th)) * amp * Math.cos(th);
    raw.push(s); pk = Math.max(pk, Math.abs(s));
  }
  return { raw: raw, pk: pk };
}
// H2..H5 re H1 of one period (dB): the bark this pickup makes
function barkDb(off, amp) {
  var n = 64, re = [0, 0, 0, 0, 0, 0], im = [0, 0, 0, 0, 0, 0];
  for (var i = 0; i < n; i++) {
    var th = 2 * Math.PI * i / n, s = g0(off + amp * Math.sin(th)) * Math.cos(th);
    for (var k = 1; k <= 5; k++) { re[k] += s * Math.cos(k * th); im[k] += s * Math.sin(k * th); }
  }
  var h1 = re[1] * re[1] + im[1] * im[1], hs = 0;
  for (var m = 2; m <= 5; m++) hs += re[m] * re[m] + im[m] * im[m];
  return h1 > 0 ? 10 * Math.log(hs / h1 + 1e-12) / Math.LN10 : -99;
}
function drawWave(g, x, y, w, h, off, amp, ok, hot) {
  var mid = y + h / 2;
  g.fill(x, mid, w, 1, FAINT);
  if (!ok) return;
  var c = cached("wv" + off.toFixed(3) + "|" + amp.toFixed(4) + "|" + w + "|" + h, function () {
    var n = 96, wv = pickupWave(off, amp, n), p = [];
    for (var i = 0; i <= n; i++) p.push(x + w * i / n, mid - (h / 2 - 2) * (wv.pk > 0 ? wv.raw[i] / wv.pk : 0));
    return p;
  });
  g.poly(c, 2, hot ? "slot" : ORANGE);
}

// ---- the strike, drawn: the bars --------------------------------------------------------------
// The bar from above: its two nodes (where it hangs: 0.224 L of a free bar),
// the strike point (CENTRE .. L/3 .. EDGE) with the mallet's head on it
function drawBar(g, x, y, w, h, bt, s7, ok, hot, malletHot) {
  var col = bt ? ROSE : ALU, lo = bt ? ROSE_LO : ALU_LO, cy = y + h / 2, bh = h;
  g.fill(x, y, w, bh, col);
  g.fill(x, y + bh - 3, w, 3, lo);
  // the undercut under the middle (it tunes 1:4:10), seen as a shade
  g.fill(x + w * 0.3, y + bh - 3, w * 0.4, 3, "#000000");
  var nodes = [0.224, 0.776];
  for (var i = 0; i < 2; i++) { var nx = x + w * nodes[i]; g.fill(nx - 1, y - 3, 2, bh + 6, "#1a1a1a"); g.dot(nx, cy, 2, "#1a1a1a"); }
  if (!ok) return;
  var at = strikeAt(s7), sx = x + w * at[0], sy = cy - (bh / 2) * at[1] * 2 * 0.92;
  g.dot(sx, sy, 7, malletHot ? "slot" : "#101010");
  g.dot(sx, sy, 5, hot ? "slot" : ORANGE);
}
// the tube under the bar (from the side): its mouth under the bar's middle, as
// wide as it couples (KN_TUBE: 0 a bare bar, 1 at 64), the air column in it
// lit by how much it takes part; the motor's disc in its mouth on the
// vibraphone (level: open, tilted: turning)
function drawTube(g, x, y, w, h, bt, t7, ok, hot, motor) {
  var s = ok ? tubeScale(bt, t7) : 0, cx = x + 14, tw = 16, wall = bt ? "#3c3c3c" : TUBE_C;
  g.fill(cx - tw / 2, y + 4, tw, h - 4, "#101010");
  g.fill(cx - tw / 2, y + 4, 2, h - 4, wall);
  g.fill(cx + tw / 2 - 2, y + 4, 2, h - 4, wall);
  g.fill(cx - tw / 2, y + h - 2, tw, 2, wall);
  var air = clamp(s / 1.6, 0, 1), ah = Math.round((h - 8) * air);
  if (ah > 0) g.fill(cx - tw / 2 + 3, y + h - 3 - ah, tw - 6, ah, hot ? "slot" : ok ? (bt ? ROSE_LO : TUBE_LO) : DIM);
  if (motor) {
    if (motor.on) g.line(cx - 9, y + 5, cx + 9, y + 1, 2, SILVER); else g.fill(cx - 9, y + 2, 18, 2, DIM);
  }
  // the coupling as a scale beside it: 0 .. 1.6
  var mx = cx + 16, mw = w - (mx - x) - 2;
  if (mw > 30) {
    g.fill(mx, y + h - 2, mw, 1, FAINT);
    g.fill(mx + mw / 1.6, y + h - 5, 1, 4, DIM);
    if (ok) g.fill(mx, y + h - 5, Math.round(mw * air), 3, hot ? "slot" : ORANGE);
  }
}

// ---- the panel ------------------------------------------------------------------------------------
var SEC_A = [4, 22, 446, 80], SEC_B = [454, 22, 196, 80], SEC_C = [654, 22, 302, 80];
// the effects in their chain (fx.c), a row per segment: [label, switch, x, w]
var FX_ROWS = [
  [["COMP", "p_cmp_sw"], ["EQ", null]],
  [["DRIVE", "p_drv_sw"], ["FILTER", "p_fl_type"]],
  [["TREM", "s_twkind"], ["PHASER", "p_ph_sw"], ["CHORUS", "p_cp_sw"]],
  [["DELAY", "p_dl_sw"], ["REVERB", "p_rv_type"]]];
var FX_Y0 = 39, FX_DY = 16, FX_X0 = 660, FX_W = 292;
function fxRect(r) { return [FX_X0 - 2, FX_Y0 + r * FX_DY - 1, FX_W + 4, 14]; }
var SEGMENTS = [
  { id: "strike", label: "Strike", rect: SEC_A, keys: ["p_tone", "p_bark", "p_bell", "p_hammer", "p_type", "s_vresp"] },
  { id: "ring", label: "Ring", rect: SEC_B, keys: ["p_decay", "p_release", "p_noise", "s_tune", "s_sustain", "p_spread", "p_level"] },
  { id: "dyn", label: "Comp / EQ", rect: fxRect(0), keys: ["p_cmp_sw", "p_cmp_amt", "p_cmp_ratio", "p_cmp_atk", "p_eq_lo", "p_eq_mid", "p_eq_freq", "p_eq_hi"] },
  { id: "drive", label: "Drive/Filter", rect: fxRect(1), keys: ["p_drv_sw", "p_drive", "p_drv_tone", "p_drv_mix", "p_fl_type", "p_fl_freq", "p_fl_reso", "p_fl_lfo"] },
  { id: "mod", label: "Trem/Pha/Cho", rect: fxRect(2), keys: ["s_twkind", "p_tw_depth", "p_tw_rate", "p_ph_sw", "p_ph_depth", "p_ph_speed", "p_cp_sw", "p_cp_depth"] },
  { id: "space", label: "Delay/Reverb", rect: fxRect(3), keys: ["p_dl_sw", "p_dl_depth", "p_dl_time", "p_dl_fdbk", "p_rv_type", "p_rv_depth", "p_rv_decay", "p_rv_tone"] }
];
var FX_SEG = ["dyn", "drive", "mod", "space"];
var SEG_OF = {};
(function () { for (var i = 0; i < SEGMENTS.length; i++) SEG_OF[SEGMENTS[i].id] = SEGMENTS[i]; }());

function fxOn(v, sw) {
  if (!sw) return known(v, "p_eq_lo") && (num(v, "p_eq_lo", 64) !== 64 || num(v, "p_eq_mid", 64) !== 64 || num(v, "p_eq_hi", 64) !== 64);
  if (sw === "p_cmp_sw") return num(v, "p_cmp_sw", 0) > 0 && num(v, "p_cmp_amt", 0) > 0;
  return num(v, sw, 0) > 0;
}
function eqShort(v, k) { var d = eqDb(num(v, k, 64)); return (d >= 0 ? "+" : "") + (Math.abs(d) >= 9.95 ? Math.round(d) : d.toFixed(1)); }
// what each effect is doing, in the plugin's words
function fxValue(v, name, ty) {
  function vt(k) { return valueOf(v, k, ty).join(" ").replace(/ $/, ""); }
  switch (name) {
  case "COMP": return num(v, "p_cmp_amt", 0) > 0 ? vt("p_cmp_amt") + "  " + RATIO[clamp(num(v, "p_cmp_ratio", 3), 0, 7)] : "OFF";
  case "EQ": return fxOn(v, null) ? eqShort(v, "p_eq_lo") + " " + eqShort(v, "p_eq_mid") + " " + eqShort(v, "p_eq_hi") : "FLAT";
  case "DRIVE": return num(v, "p_drv_sw", 0) > 0 ? txt(v, "p_drv_sw") + "  " + vt("p_drive") : "OFF";
  case "FILTER":
    if (!(num(v, "p_fl_type", 0) > 0)) return "OFF";
    var fh = hzText(flHz(num(v, "p_fl_freq", 127)));
    return txt(v, "p_fl_type") + "  " + fh[0] + (fh[1] === "kHz" ? "K" : "");
  case "TREM": return num(v, "s_twkind", 0) > 0 ? txt(v, "s_twkind") : "OFF";
  case "PHASER": return num(v, "p_ph_sw", 0) > 0 ? vt("p_ph_depth") : "OFF";
  case "CHORUS": return num(v, "p_cp_sw", 0) > 0 ? vt("p_cp_depth") : "OFF";
  case "DELAY": return num(v, "p_dl_sw", 0) > 0 ? txt(v, "p_dl_sw") + "  " + vt("p_dl_depth") : "OFF";
  case "REVERB": return num(v, "p_rv_type", 0) > 0 ? txt(v, "p_rv_type") + "  " + vt("p_rv_depth") : "OFF";
  }
  return "";
}
var FX_TOUCH = { COMP: /^p_cmp/, EQ: /^p_eq/, DRIVE: /^p_dr/, FILTER: /^p_fl/, TREM: /^(s_twkind|p_tw)/, PHASER: /^p_ph/,
  CHORUS: /^p_cp/, DELAY: /^p_dl/, REVERB: /^p_rv/ };

// the strike's parts, left to right as the energy goes: [x, w, name]
var PARTS_EP = [[12, 64, "HAMMER"], [90, 104, "TINE"], [208, 122, "PICKUP"], [344, 98, "OUT"]];
var PARTS_BAR = [[12, 64, "MALLET"], [90, 132, "BAR"], [236, 116, "MODES"], [366, 76, "TUBE"]];
function panelGround(g, ty, seg) {
  g.fill(0, 0, 960, 160, GROUND);
  g.fill(0, 0, 960, 20, TOPBAR);
  // the wordmark, spaced as the plugin's
  var word = "FRODHES", x = 10;
  for (var i = 0; i < word.length; i++) { g.value(x, 16, word[i], SILVER, -1); x += g.measure(word[i], "value") + 3; }
  g.dot(x + 4, 10, 3, ORANGE);
  var secs = [SEC_A, SEC_B, SEC_C];
  for (var s = 0; s < 3; s++) g.fill(secs[s][0], secs[s][1], secs[s][2], secs[s][3], CARD);
  g.text(SEC_A[0] + 8, 33, isBars(ty) ? "HOW THE MALLET STRIKES" : "HOW THE TINE IS STRUCK", LEG, -1);
  g.text(SEC_B[0] + 8, 33, "HOW NOTES DIE AWAY", LEG, -1);
  // the strike's chain: its parts' names, the arrows between
  var parts = isBars(ty) ? PARTS_BAR : PARTS_EP;
  for (var p = 0; p < parts.length; p++) {
    g.text(parts[p][0], 46, parts[p][2], DIM, -1);
    if (p) g.text(parts[p][0] - 8, 70, ">", DIM, 0);
  }
  // the effects: a rule between their rows, the chain read top to bottom
  for (var r = 1; r < FX_ROWS.length; r++) g.fill(FX_X0, FX_Y0 + r * FX_DY - 2, FX_W, 1, EDGE);
  // the encoder row
  g.fill(0, 104, 960, 56, "#111111");
  g.fill(0, 104, 960, 1, "#000000");
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 26 : 44, FAINT);
}

function panel(g, v, t) {
  var ty = typeOf(v), touched = v.$touched || "", kn = v.$knobs || [], segOn = !!v.$segmode, i;
  var held = {};
  for (i = 0; i < kn.length; i++) if (kn[i]) held[kn[i]] = 1;
  g.layer("p|" + ty + "|" + (segOn ? 1 : 0), function () { panelGround(g, ty, segOn); });

  // ---- the top bar: the preset, the instrument, sustain and effects
  var pn = txt(v, "preset_name"), sp = pn.indexOf(" "), code = sp > 0 ? pn.slice(0, sp) : "", name = sp > 0 ? pn.slice(sp + 1) : pn;
  var px = 156;
  if (code) { g.value(px, 16, code, ORANGE, -1); px += g.measure(code, "value") + 8; }
  g.text(px, 15, (name || "--").toUpperCase(), INK, -1, 470 - px);
  for (i = 0; i < 6; i++) {
    var tx = 484 + i * 50, on = i === ty, th = touched === "p_type";
    if (on) g.fill(tx - 4, 3, 46, 15, th ? "slot" : "#262626");
    g.text(tx + 19, 14, TYPES[i], on ? (th ? "#000000" : ORANGE) : DIM, 0);
  }
  var sus = num(v, "s_sustain", 0) > 0, fxo = num(v, "s_fx", 1) > 0;
  led(g, 800, 10, sus); g.text(808, 14, "SUS", sus ? INK : DIM, -1);
  led(g, 846, 10, fxo); g.text(854, 14, "FX", fxo ? INK : DIM, -1);
  var ps = v.$pages || [];
  if (!segOn && ps.length > 1) g.text(952, 14, String(ps[v.$page] || "").toUpperCase() + " " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);

  // the active section's heading lit (segment mode)
  var segId = v.$segmode === "segment" ? v.$segment : "";
  if (segId === "strike") g.text(SEC_A[0] + 8, 33, isBars(ty) ? "HOW THE MALLET STRIKES" : "HOW THE TINE IS STRUCK", INK, -1);
  if (segId === "ring") g.text(SEC_B[0] + 8, 33, "HOW NOTES DIE AWAY", INK, -1);

  drawStrike(g, v, ty, touched, held);
  drawRing(g, v, ty, touched);
  drawFx(g, v, ty, touched, segId);

  // ---- the encoder row: the plugin's knobs, a name, a value
  for (var c = 0; c < 8; c++) {
    var key = kn[c] || "";
    if (!key) continue;
    var x0 = c * 120, hot = key === touched, ok = known(v, key), f = fracOf(v, key);
    var cy = segOn ? 124 : 132, r = segOn ? 9 : 12;
    knob(g, x0 + 26, cy, r, f, ok, hot, !!BIPOLAR[key]);
    var val = valueOf(v, key, ty), tx0 = x0 + 46, room = 120 - 50;
    g.text(tx0, segOn ? 118 : 123, nameOf(v, key, ty), hot ? "slot" : LEG, -1, room);
    var uw = val[1] ? g.measure(val[1]) + 3 : 0, vs = val[0];
    g.value(tx0, segOn ? 137 : 146, vs, hot ? "slot" : (ok ? INK : DIM), -1, room - uw);
    if (val[1]) g.text(tx0 + Math.min(g.measure(vs, "value"), room - uw) + 3, segOn ? 137 : 146, val[1].toUpperCase(), hot ? "slot" : LEG, -1);
  }
}

function drawStrike(g, v, ty, touched, held) {
  var tone = eng(v, "tone"), bark = eng(v, "bark"), bell = eng(v, "bell"), ham = eng(v, "hammer");
  var d7 = eng(v, "decay"), r7 = eng(v, "release");
  var ok = ty >= 0 && tone !== null && bark !== null && bell !== null && ham !== null;
  var hT = touched === "p_tone" || touched === "p_strike", hB = touched === "p_bark" || touched === "p_mallet";
  var hL = touched === "p_bell" || touched === "p_tube", hH = touched === "p_hammer" || touched === "p_weight";
  var live = ok ? liveNote(v, ty, d7 === null ? 64 : d7, r7 === null ? 64 : r7) : null;
  var vel = live ? live.vel : 100;
  var P = isBars(ty) ? PARTS_BAR : PARTS_EP, Y = 52, H = 34, CAP = 98;
  if (!isBars(ty)) {
    var tc = ok ? anch(TC_MS, vel) / hamRate(ham, ty) : 1.7;
    drawHammer(g, P[0][0], Y, P[0][1], H, tc, ok, hH);
    g.text(P[0][0], CAP, ok ? tc.toFixed(1) + " MS" : "--", hH ? "slot" : LEG, -1);
    var dbs = ok ? tineModes(bellScale(bell, ty), tc / 1000) : [0, -60, -60];
    drawModes(g, P[1][0], Y, P[1][1], H, TINE_R, dbs, 24, hL || hH ? "slot" : ORANGE, ok);
    g.text(P[1][0], CAP, ok ? "BELL " + Math.round(dbs[1]) + " DB" : "--", hL ? "slot" : LEG, -1);
    if (ok) g.text(P[1][0] + 2 + (P[1][1] - 4) * Math.log(TINE_R[1]) / Math.log(24), Y + H - (H - 2) * (1 + Math.max(-60, dbs[1]) / 60) - 3, "6.8", hL ? "slot" : ORANGE, 0);
    var off = ok ? pickupOff(tone, ty) : -0.3, amp = ok ? anch(SWING, vel) * barkScale(bark, ty) : 0;
    if (live) amp *= live.level;
    drawPickup(g, P[2][0], Y - 2, P[2][1], H + 6, off, amp, ok, hT, hB);
    g.text(P[2][0], CAP, ok ? (off < 0 ? "-" : "+") + Math.abs(off).toFixed(2) + " GAP" : "--", hT ? "slot" : LEG, -1);
    g.text(P[2][0] + P[2][1], CAP, ok ? (live ? "V" + vel : "V100") : "", hB ? "slot" : DIM, 1);
    drawWave(g, P[3][0], Y - 2, P[3][1], H + 4, off, Math.max(amp, 0.0005), ok, hB || hT);
    g.text(P[3][0], CAP, ok ? "BARK " + Math.round(barkDb(off, Math.max(amp, 0.0005))) + " DB" : "--", hB || hT ? "slot" : LEG, -1);
    return;
  }
  var bt = ty - 4, mtc = ok ? malletTc(bt, bark, ham) : 1;
  drawHammer(g, P[0][0], Y, P[0][1], H, mtc, ok, hB || hH);
  g.text(P[0][0], CAP, ok ? malletName(bt, bark) : "--", hB ? "slot" : LEG, -1, P[0][1] + 10);
  drawBar(g, P[1][0], Y + 4, P[1][1], 24, bt, ok ? tone : 64, ok, hT, hB);
  g.text(P[1][0], CAP, ok ? valueOf(v, "p_tone", ty)[0] : "--", hT ? "slot" : LEG, -1);
  var w = ok ? posWeights(bt, tone) : [1, 0, 0, 0, 0, 0], dbm = [];
  for (var m = 0; m < 6; m++) {
    var a = w[m] * reach(F0 * BAR_R[bt][m], mtc / 1000) / (w[0] * reach(F0, mtc / 1000));
    dbm.push(a > 0 ? 20 * Math.log(a) / Math.LN10 : -99);
  }
  drawModes(g, P[2][0], Y, P[2][1], H, BAR_R[bt], dbm, 24, hT || hB ? "slot" : ORANGE, ok);
  g.text(P[2][0], CAP, "1 : 4 : " + BAR_R[bt][2].toFixed(1), LEG, -1);
  var mot = ty === 4 ? { on: num(v, "p_mot_on", 0) > 0 } : null;
  drawTube(g, P[3][0], Y, P[3][1], H + 2, bt, ok ? bell : 64, ok, hL, mot);
  g.text(P[3][0], CAP, ok ? "x" + tubeScale(bt, bell).toFixed(2) : "--", hL ? "slot" : LEG, -1, P[3][1]);
}

function drawRing(g, v, ty, touched) {
  var bars = isBars(ty);
  g.envelope(SEC_B[0] + 6, 38, SEC_B[2] - 12, 62, { attack: 0, decay: "p_decay", release: "p_release",
    curves: { decay: -6.9, release: -6.9 }, labels: true, color: ORANGE });
}

function drawFx(g, v, ty, touched, segId) {
  var all = num(v, "s_fx", 1) > 0;
  g.text(SEC_C[0] + 8, 33, all ? "EFFECTS" : "EFFECTS  OFF", LEG, -1);
  for (var r = 0; r < FX_ROWS.length; r++) {
    var row = FX_ROWS[r], n = row.length, w = FX_W / n, y = FX_Y0 + r * FX_DY, lit = segId === FX_SEG[r];
    for (var i = 0; i < n; i++) {
      var it = row[i], x = FX_X0 + i * w, on = all && fxOn(v, it[1]), hot = touched && FX_TOUCH[it[0]].test(touched);
      led(g, x + 4, y + 5, on);
      g.text(x + 12, y + 9, it[0], hot ? "slot" : lit || on ? INK : LEG, -1);
      var nw = g.measure(it[0]) + 18;
      g.text(x + w - 8, y + 9, fxValue(v, it[0], ty), hot ? "slot" : on ? ORANGE : DIM, 1, w - nw - 8);
    }
  }
}

// ---- theme: Pung's own pages in the plugin's black, silver knobs, orange travel ---------------------
push.theme({ ground: CARD, panel: SILVER, ink: INK, dim: LEG, rule: SILVER_LO, faint: FAINT, accent: ORANGE, knob: "pointer" });

var FX_KEYS = ["p_cmp_sw", "p_cmp_amt", "p_cmp_ratio", "p_eq_lo", "p_eq_mid", "p_eq_hi", "p_drv_sw", "p_drive", "p_fl_type", "p_fl_freq",
  "s_twkind", "p_tw_depth", "p_ph_sw", "p_ph_depth", "p_cp_sw", "p_cp_depth", "p_dl_sw", "p_dl_depth", "p_rv_type", "p_rv_depth"];
push.compartment({
  id: "panel", label: "Frodhes", front_panel: true, draws_segments: true,
  segments: SEGMENTS,
  pages: [
    { label: "Voice", keys: ["p_type", "p_tone", "p_bark", "p_bell", "p_hammer", "p_decay", "p_release", "p_noise"] },
    { label: "Perform", keys: ["p_drive", "p_fl_freq", "p_dl_depth", "p_rv_depth", "s_sustain", "s_fx", "p_spread", "p_level"] }
  ],
  extra_keys: ["preset", "preset_name", "p_type", "s_sustain", "s_fx", "s_tune", "p_mot_on", "p_tone", "p_bark", "p_bell", "p_hammer",
    "p_decay", "p_release"].concat(FX_KEYS),
  screen: panel
});

// ---- Pung's envelope runs on the engine's own times, at middle C -------------------------------------
push.envelopeTimes(function (env) {
  var ty = clamp(Math.round(+(env.value("p_type") || 0)), 0, 5);
  return env.stages.map(function (s) {
    if (s.raw === null || s.raw === undefined) return s.role === "attack" ? 0.002 : null;
    var x = +s.raw;
    if (/^p_(decay|ring)$/.test(s.key)) return ringT60(ty, 60) * decayS(x);
    if (/^p_(release|damper|mute)$/.test(s.key)) { var r = relT60(ty, 60); return r === null ? null : r * releaseS(x, ty); }
    return null;
  });
});

// ---- the band screens: the panel's black, a section's heading -------------------------------------------
function bandGround(g, key, heads) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, CARD);
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      if (h[3]) g.fill(h[0], 14, h[3], 1, EDGE);
      g.text(h[0], 10, h[1], h[2] ? LEG : DIM, -1);
    }
  });
}
function hotIn(touched, keys) { for (var i = 0; i < keys.length; i++) if (touched === keys[i]) return true; return false; }

// ---- VOICE: the strike at full width ---------------------------------------------------------------
var VOICE_PAGES = [
  { label: "Piano", keys: ["p_tone", "p_bark", "p_bell", "p_hammer", "p_decay", "p_release", "p_noise", "s_tune"] },
  { label: "Vibes", keys: ["p_strike", "p_mallet", "p_tube", "p_weight", "p_ring", "p_damper", "p_noise", "s_tune"] },
  { label: "Motor", keys: ["p_mot_on", "p_mot_depth", "p_mot_rate", "p_mot_shape", "p_mot_sync"] },
  { label: "Marimba", keys: ["p_strike", "p_mallet", "p_tube", "p_weight", "p_ring", "p_mute", "p_noise", "s_tune"] }];
// the discs' opening over two turns (bars.c bar_motor_block): o = 1 - |cos phi|,
// SHAPE draws it toward o^2 (a narrower open window), DEPTH closes the tube to
// 1 - DEPTH (1 - 0.2) at the least; the level make-up (bar_mot_mk) left out
function motorCurve(depth, shape, n) {
  var gmin = 1 - depth / 127 * (1 - 6554 / 32768), pts = [];
  for (var i = 0; i <= n; i++) {
    var ph = 2 * Math.PI * i / n, o = 1 - Math.abs(Math.cos(ph)), op = o + (o * o - o) * shape / 127;
    pts.push(gmin + (1 - gmin) * op);
  }
  return pts;
}
// each page draws what its own knobs mean: Piano the tine (in the piano TYPE
// playing, else STAGE 77's voicing), Vibes and Motor the vibraphone, Marimba
// the marimba; a page whose instrument is not the TYPE playing says so
var PAGE_INST = ["piano", "vibe", "vibe", "mrmb"];
// the page's knobs are the same engine parameters on every TYPE (move_ui.h): a page whose instrument
// is not the one playing draws its own instrument, and says so
var PAGE_OTHER = { piano: "DRAWN AS ON ST77", vibe: "DRAWN AS ON VIBE", mrmb: "DRAWN AS ON MRMB" };
function instOf(ty) { return ty === 4 ? "vibe" : ty === 5 ? "mrmb" : ty >= 0 ? "piano" : ""; }
function voiceScreen(g, v, t) {
  var ty = typeOf(v), touched = v.$touched || "", pg = clamp(v.$page || 0, 0, 3), motorPage = pg === 2;
  var inst = PAGE_INST[pg], plays = instOf(ty) === inst, bars = inst !== "piano";
  // the voicing drawn: the TYPE playing when it is this page's instrument
  var vt = plays ? ty : inst === "vibe" ? 4 : inst === "mrmb" ? 5 : 0;
  var parts = motorPage ? [[8, 150, "MALLET"], [178, 300, "BAR"], [506, 438, "MOTOR: THE TUBES' OPENING"]]
    : bars ? [[8, 150, "MALLET"], [178, 300, "BAR"], [506, 200, "MODES STRUCK"], [734, 210, "TUBE"]]
    : [[8, 150, "HAMMER"], [178, 210, "TINE"], [416, 250, "PICKUP"], [694, 250, "OUT"]];
  bandGround(g, "voice|" + pg, parts.map(function (p) { return [p[0], p[2], 1, p[1]]; }));
  if (motorPage) g.text(944, 10, ty === 4 ? "VIBES" : "ACTS ON VIBE ONLY", ty === 4 ? LEG : INK, 1);
  else if (plays) g.text(944, 10, TYPE_LONG[ty] + " / MIDDLE C", LEG, 1);
  else g.text(944, 10, PAGE_OTHER[inst], INK, 1);
  var tone = eng(v, "tone"), bark = eng(v, "bark"), bell = eng(v, "bell"), ham = eng(v, "hammer");
  var d7 = eng(v, "decay"), r7 = eng(v, "release");
  var ok = tone !== null && bark !== null && bell !== null && ham !== null;
  var hT = hotIn(touched, ["p_tone", "p_strike"]), hB = hotIn(touched, ["p_bark", "p_mallet"]);
  var hL = hotIn(touched, ["p_bell", "p_tube"]), hH = hotIn(touched, ["p_hammer", "p_weight"]);
  var live = ok && plays ? liveNote(v, ty, d7 === null ? 64 : d7, r7 === null ? 64 : r7) : null, vel = live ? live.vel : 100;
  var Y = 22, H = 46, CAP = 80;
  if (!bars) {
    var tc = ok ? anch(TC_MS, vel) / hamRate(ham, vt) : 1.7;
    drawHammer(g, 8, Y, 150, H, tc, ok, hH);
    g.text(8, CAP, ok ? "CONTACT " + tc.toFixed(2) + " MS" : "--", hH ? "slot" : INK, -1);
    g.text(158, CAP, live ? "V" + vel : "V100", DIM, 1);
    var dbs = ok ? tineModes(bellScale(bell, vt), tc / 1000) : [0, -60, -60];
    drawModes(g, 178, Y, 210, H, TINE_R, dbs, 24, hL || hH ? "slot" : ORANGE, ok);
    var lx = function (r) { return 178 + 2 + 206 * Math.log(r) / Math.log(24); };
    g.text(lx(1) + 5, Y + 8, "F0", LEG, -1);
    if (ok) {
      g.text(lx(TINE_R[1]), Y + H - (H - 2) * (1 + Math.max(-60, dbs[1]) / 60) - 3, "6.8 F0", hL ? "slot" : ORANGE, 0);
      if (dbs[2] > -58) g.text(lx(TINE_R[2]), Y + H - (H - 2) * (1 + dbs[2] / 60) - 3, "18.4", hL ? "slot" : ORANGE, 0);
    }
    g.text(178, CAP, ok ? "BELL " + Math.round(dbs[1]) + " DB" : "--", hL ? "slot" : INK, -1);
    g.text(388, CAP, "-20  -40 DB", DIM, 1);
    var off = ok ? pickupOff(tone, vt) : -0.3, a0 = ok ? anch(SWING, vel) * barkScale(bark, vt) : 0, amp = live ? a0 * live.level : a0;
    drawPickup(g, 416, Y - 4, 250, H + 10, off, amp, ok, hT, hB);
    g.text(416, CAP, ok ? "AT " + off.toFixed(2) + " GAP" : "--", hT ? "slot" : INK, -1);
    g.text(666, CAP, ok ? "SWING " + amp.toFixed(2) + (live ? "  V" + vel : "  V100") : "", hB ? "slot" : LEG, 1);
    drawWave(g, 694, Y, 250, H, off, Math.max(amp, 0.0005), ok, hB || hT);
    g.text(694, CAP, ok ? "BARK " + Math.round(barkDb(off, Math.max(amp, 0.0005))) + " DB" : "--", hB || hT ? "slot" : INK, -1);
    g.text(944, CAP, "H2 - H5 RE F0", DIM, 1);
    return;
  }
  var bt = inst === "mrmb" ? 1 : 0, mtc = ok ? malletTc(bt, bark, ham) : 1;
  drawHammer(g, 8, Y, 150, H, mtc, ok, hB || hH);
  g.text(8, CAP, ok ? malletName(bt, bark) : "--", hB ? "slot" : INK, -1, 100);
  g.text(158, CAP, ok ? mtc.toFixed(2) + " MS" : "", hH ? "slot" : LEG, 1);
  drawBar(g, 178, Y + 8, 300, 30, bt, ok ? tone : 64, ok, hT, hB);
  g.text(178, CAP, ok ? "STRIKE " + valueOf(v, "p_tone", vt)[0] : "--", hT ? "slot" : INK, -1);
  if (ok) { var at = strikeAt(tone); g.text(478, CAP, at[1] > 0 ? Math.round(at[1] * 100) + "% W OFF THE CENTRE" : at[0].toFixed(2) + " L FROM THE END", LEG, 1); }
  if (motorPage) {
    var known_ = known(v, "p_mot_on"), on = num(v, "p_mot_on", 0) > 0, dep = num(v, "p_mot_depth", 110), shp = num(v, "p_mot_shape", 0);
    var x0 = 506, w = 438, top = Y + 2, base = Y + H, n = 120;
    var c = cached("mot" + dep + "|" + shp, function () { return motorCurve(dep, shp, n); });
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push(x0 + w * i / n, base - (base - top) * c[i]);
    g.fill(x0, top, w, 1, "#232323"); g.fill(x0, base, w, 1, FAINT); g.fill(x0 + w / 2, top, 1, base - top, "#232323");
    var hm = hotIn(touched, ["p_mot_depth", "p_mot_shape"]);
    if (known_) { g.area(pts, base, on ? ORANGE_FILL : "#202020"); g.poly(pts, 2, hm ? "slot" : on ? ORANGE : DIM); }
    var rate = valueOf(v, "p_mot_rate", 4);
    g.text(x0, CAP, !known_ ? "--" : on ? "TURNING " + rate.join(" ").toUpperCase() : "OFF: THE DISCS STAND OPEN",
      hotIn(touched, ["p_mot_on", "p_mot_rate", "p_mot_sync"]) ? "slot" : INK, -1, 250);
    g.text(944, CAP, "AT THEIR LEAST " + Math.round(100 * (1 - dep / 127 * 0.8)) + "% OPEN", hm ? "slot" : LEG, 1, 170);
    return;
  }
  var wts = ok ? posWeights(bt, tone) : [1, 0, 0, 0, 0, 0], dbm = [];
  for (var m = 0; m < 6; m++) {
    var a = wts[m] * reach(F0 * BAR_R[bt][m], mtc / 1000) / (wts[0] * reach(F0, mtc / 1000));
    dbm.push(a > 0 ? 20 * Math.log(a) / Math.LN10 : -99);
  }
  drawModes(g, 506, Y, 200, H, BAR_R[bt], dbm, 24, hT || hB ? "slot" : ORANGE, ok);
  // each mode's name over its line, the loudest first; a name that would touch one already placed
  // is left out (the ratios stand in the caption), so none overlaps
  var placed = [], order = [];
  for (var k = 1; k < 6; k++) if (ok && dbm[k] > -58) order.push(k);
  order.sort(function (a, b) { return dbm[b] - dbm[a]; });
  if (ok) { g.text(506 + 8, Y + 8, BAR_MODE[0], LEG, -1); placed.push([506, 506 + 8 + g.measure(BAR_MODE[0]), Y + 8]); }
  for (var q = 0; q < order.length; q++) {
    var km = order[q], xm = 506 + 2 + 196 * Math.log(BAR_R[bt][km]) / Math.log(24), hh = (H - 2) * (1 + Math.max(-60, dbm[km]) / 60);
    var ym = Math.max(Y + 7, Y + H - hh - 3), wm = g.measure(BAR_MODE[km]), a0 = xm - wm / 2 - 2, a1 = xm + wm / 2 + 2, clash = false;
    for (var pi = 0; pi < placed.length; pi++) if (a0 < placed[pi][1] && a1 > placed[pi][0] && Math.abs(ym - placed[pi][2]) < 9) clash = true;
    if (clash) continue;
    g.text(xm, ym, BAR_MODE[km], hT || hB ? "slot" : ORANGE, 0);
    placed.push([a0, a1, ym]);
  }
  g.text(506, CAP, "1 : 4 : " + BAR_R[bt][2].toFixed(1) + (bt ? "  ROSEWOOD" : "  ALUMINIUM"), INK, -1);
  var mot = bt === 0 ? { on: num(v, "p_mot_on", 0) > 0 } : null;
  drawTube(g, 734, Y, 210, H + 2, bt, ok ? bell : 64, ok, hL, mot);
  g.text(734, CAP, ok ? "COUPLING " + tubeScale(bt, bell).toFixed(2) : "--", hL ? "slot" : INK, -1);
  if (ok) g.text(764, 40, tubeScale(bt, bell) > 0.01 ? "THE TUBE BLOOMS F0" : "A BARE BAR: NO BLOOM", LEG, -1, 180);
  if (bt === 0) g.text(944, CAP, num(v, "p_mot_on", 0) > 0 ? "MOTOR ON" : "MOTOR OFF", LEG, 1);
}
push.compartment({
  id: "voice", label: "Voice", pages: VOICE_PAGES,
  extra_keys: ["p_type", "p_tone", "p_bark", "p_bell", "p_hammer", "p_decay", "p_release", "p_mot_on", "p_mot_depth", "p_mot_shape", "p_mot_rate", "p_mot_sync"],
  screen: voiceScreen
});

// ---- DYNAMICS: the compressor's curve and its reduction, the EQ's response ---------------------------------
// the compressor (fx.c fx_comp): THRESH 0 .. -40 dB, a soft knee 6 dB wide, the
// ratio above it, MAKEUP on top (the auto make-up below -17.6 dB is the
// engine's own, moment to moment: not drawn)
function compOut(inDb, thr, ratio, mk) {
  var over = inDb - thr, sl = 1 - 1 / ratio, gr;
  if (over <= -3) gr = 0; else if (over >= 3) gr = over * sl; else gr = sl * (over + 3) * (over + 3) / 12;
  return inDb - gr + mk;
}
// RBJ cookbook (fx_eq.c): shelves S = 1 at 120 Hz and 5 kHz, a peak Q 0.9
function biquadDb(b0, b1, b2, a0, a1, a2, w) {
  var c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w);
  var nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log((nr * nr + ni * ni) / (dr * dr + di * di)) / Math.LN10;
}
function shelfDb(f0, gDb, hi, f) {
  var A = Math.pow(10, gDb / 40), w0 = 2 * Math.PI * f0 / 44100, al = Math.sin(w0) / 2 * Math.sqrt(2), c = Math.cos(w0), sa = 2 * Math.sqrt(A) * al;
  var w = 2 * Math.PI * f / 44100;
  if (!hi) return biquadDb(A * ((A + 1) - (A - 1) * c + sa), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sa),
    (A + 1) + (A - 1) * c + sa, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sa, w);
  return biquadDb(A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa),
    (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa, w);
}
function peakDb(f0, gDb, q, f) {
  var A = Math.pow(10, gDb / 40), w0 = 2 * Math.PI * f0 / 44100, al = Math.sin(w0) / (2 * q), c = Math.cos(w0), w = 2 * Math.PI * f / 44100;
  return biquadDb(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A, w);
}
var GR_SCALE = [10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 180, 200, 240, 270, 300]; // ui.c, tenths of a dB
function dynScreen(g, v, t) {
  var touched = v.$touched || "";
  bandGround(g, "dyn", [[8, "COMPRESSOR  (IN, OUT: DB)", 1, 300], [330, "GAIN REDUCTION", 1, 150], [500, "EQ  (20 HZ - 20 KHZ, ±15 DB)", 1, 444]]);
  // the curve: in -48..0 dB across, out the same up
  var x0 = 8, y0 = 20, s = 62, on = num(v, "p_cmp_sw", 0) > 0 && num(v, "p_cmp_amt", 0) > 0;
  var thr = -thrDb(num(v, "p_cmp_amt", 0)), ri = clamp(Math.round(num(v, "p_cmp_ratio", 3)), 0, 7), gt = gainT(num(v, "p_cmp_gain", 0)), mk = gt[0] / 10;
  function X(d) { return x0 + s * 1.5 * (d + 48) / 48; }
  function Y(d) { return y0 + s - s * (clamp(d, -48, 0) + 48) / 48; }
  g.fill(x0, y0, s * 1.5, s, "#141414");
  for (var d = -36; d < 0; d += 12) { g.fill(X(d), y0, 1, s, "#222222"); g.fill(x0, Y(d), s * 1.5, 1, "#222222"); }
  var hc = hotIn(touched, ["p_cmp_amt", "p_cmp_ratio", "p_cmp_gain", "p_cmp_sw"]);
  var c = cached("cmp" + thr + "|" + ri + "|" + mk + "|" + on, function () {
    var p = [];
    for (var i = 0; i <= 48; i++) { var ind = -48 + i; p.push(X(ind), Y(on ? compOut(ind, thr, RATIO_N[ri], mk) : ind)); }
    return p;
  });
  g.poly([X(-48), Y(-48), X(0), Y(0)], 1, DIM);
  if (known(v, "p_cmp_amt")) g.poly(c, 2, hc ? "slot" : on ? ORANGE : SILVER_LO);
  if (on) g.fill(X(thr), y0, 1, s, hotIn(touched, ["p_cmp_amt"]) ? "slot" : LEG);
  var tx = x0 + s * 1.5 + 12;
  g.text(tx, 30, on ? "THRESH " + thr + " DB" : "OFF", hotIn(touched, ["p_cmp_amt", "p_cmp_sw"]) ? "slot" : INK, -1);
  g.text(tx, 44, "RATIO " + RATIO[ri], touched === "p_cmp_ratio" ? "slot" : on ? INK : LEG, -1);
  g.text(tx, 58, "KNEE 6 DB", LEG, -1);
  g.text(tx, 72, "MAKEUP " + db10(gt[0], gt[1]) + " DB" + (on && thr < -17.6 ? " + AUTO" : ""), touched === "p_cmp_gain" ? "slot" : LEG, -1, 300 - tx + 8);
  // the reduction now: ui.c's 15 segments, the peak held (r_cmp_gr: "now peak" in tenths)
  var gr = known(v, "r_cmp_gr") ? String(v.r_cmp_gr.value) : "", parts = gr.split(" "), now = parseInt(parts[0], 10), pk = parseInt(parts[1], 10);
  var reading = gr !== "" && gr !== "OFF" && !isNaN(now);
  function segs(db10v) { if (!(db10v > 0)) return 0; for (var i = 0; i < GR_SCALE.length; i++) if (db10v <= GR_SCALE[i]) return i + 1; return GR_SCALE.length; }
  var lit = reading ? segs(now) : 0, pks = reading && pk > 0 ? segs(pk) : 0, mx = 330, mw = 150, sw = mw / 15;
  for (var j = 0; j < 15; j++) {
    var sx = mx + mw - (j + 1) * sw + 1;
    if (j < lit) g.fill(sx, 34, sw - 2, 18, ORANGE);
    else if (j === pks - 1) g.fill(sx, 30, sw - 2, 22, INK);
    else g.fill(sx, 50, sw - 2, 2, FAINT);
  }
  var marks = [[2, "3"], [5, "6"], [7, "10"], [11, "20"], [14, "30"]];
  for (var q = 0; q < marks.length; q++) g.text(mx + mw - (marks[q][0] + 0.5) * sw, 64, marks[q][1], DIM, 0);
  g.text(mx, 82, !on ? "COMP OFF" : reading ? "-" + (now / 10).toFixed(1) + " DB NOW" : "NO READING YET", on && reading ? INK : LEG, -1);
  // the EQ
  var lo = eqDb(num(v, "p_eq_lo", 64)), md = eqDb(num(v, "p_eq_mid", 64)), hi = eqDb(num(v, "p_eq_hi", 64)), fm = eqHz(num(v, "p_eq_freq", 64));
  var ex = 500, ew = 444, ey = 20, eh = 52, mid = ey + eh / 2;
  function EX(f) { return ex + ew * Math.log(f / 20) / Math.log(1000); }
  g.fill(ex, mid, ew, 1, FAINT);
  var fl = [100, 1000, 10000];
  for (var fi = 0; fi < 3; fi++) { g.fill(EX(fl[fi]), ey, 1, eh, "#222222"); g.text(EX(fl[fi]) + 3, ey + 8, fi === 0 ? "100" : fi === 1 ? "1K" : "10K", DIM, -1); }
  var he = hotIn(touched, ["p_eq_lo", "p_eq_mid", "p_eq_freq", "p_eq_hi"]);
  var ec = cached("eq" + lo + "|" + md + "|" + hi + "|" + fm, function () {
    var p = [];
    for (var i = 0; i <= 110; i++) {
      var f = 20 * Math.pow(1000, i / 110), db = (lo ? shelfDb(120, lo, false, f) : 0) + (md ? peakDb(fm, md, 0.9, f) : 0) + (hi ? shelfDb(5000, hi, true, f) : 0);
      p.push(ex + ew * i / 110, mid - (eh / 2 - 1) * clamp(db / 15, -1, 1));
    }
    return p;
  });
  if (known(v, "p_eq_lo")) { g.area(ec, mid, he ? "#3a2c1a" : ORANGE_FILL); g.poly(ec, 2, he ? "slot" : (lo || md || hi ? ORANGE : SILVER_LO)); }
  g.fill(EX(120), mid - 3, 1, 7, touched === "p_eq_lo" ? "slot" : LEG);
  g.fill(EX(fm), mid - 3, 1, 7, hotIn(touched, ["p_eq_mid", "p_eq_freq"]) ? "slot" : LEG);
  g.fill(EX(5000), mid - 3, 1, 7, touched === "p_eq_hi" ? "slot" : LEG);
  g.text(ex, 82, lo || md || hi ? "LOW " + valueOf(v, "p_eq_lo", 0).join(" ") + "   MID " + valueOf(v, "p_eq_mid", 0).join(" ") + " AT " + valueOf(v, "p_eq_freq", 0).join(" ") + "   HIGH " + valueOf(v, "p_eq_hi", 0).join(" ")
    : "FLAT: THE EQ IS OUT OF THE SOUND", INK, -1, 444);
}
push.compartment({
  id: "dyn", label: "Comp / EQ",
  pages: [{ label: "Compressor", keys: ["p_cmp_sw", "p_cmp_amt", "p_cmp_ratio", "p_cmp_atk", "p_cmp_rel", "p_cmp_gain"] },
    { label: "EQ", keys: ["p_eq_lo", "p_eq_mid", "p_eq_freq", "p_eq_hi"] }],
  extra_keys: ["r_cmp_gr"], live_keys: ["r_cmp_gr"],
  screen: dynScreen
});

// ---- DRIVE / FILTER: the drive's circuit, the resonant filter after it, its LFO --------------------------------
var DRIVES = { FDRV: "WARM, AMP-LIKE", KHLON: "CLEAN BLEND, GERMANIUM", TSH8: "MID HUMP, SINGING", OHCD: "MOSFET, A FIRMER EDGE", BHLUE: "TWO SOFT STAGES" };
function driveScreen(g, v, t) {
  var touched = v.$touched || "";
  bandGround(g, "drv", [[8, "DRIVE", 1, 250], [276, "FILTER", 1, 460], [754, "ITS LFO", 1, 190]]);
  var dsw = num(v, "p_drv_sw", 0), dname = txt(v, "p_drv_sw"), don = dsw > 0;
  g.value(8, 34, known(v, "p_drv_sw") ? (don ? dname : "OFF") : "--", touched === "p_drv_sw" ? "slot" : don ? ORANGE : LEG, -1);
  g.text(250, 32, don ? (DRIVES[dname] || "") : "THE CLEAN PIANO", LEG, 1, 160);
  var rows = [["AMOUNT", "p_drive", false], ["TONE", "p_drv_tone", true], ["MIX", "p_drv_mix", false]];
  for (var i = 0; i < 3; i++) {
    var y = 46 + i * 13, k = rows[i][1], x7 = num(v, k, 0) + (rows[i][2] ? 64 : 0), hot = touched === k, bx = 62, bw = 140;
    g.text(8, y + 4, rows[i][0], hot ? "slot" : LEG, -1);
    g.fill(bx, y, bw, 3, FAINT);
    if (rows[i][2]) { var c0 = bx + bw / 2, c1 = bx + bw * x7 / 127; g.fill(Math.min(c0, c1), y, Math.max(2, Math.abs(c1 - c0)), 3, hot ? "slot" : don ? ORANGE : DIM); g.fill(c0, y - 2, 1, 7, LEG); }
    else g.fill(bx, y, Math.round(bw * x7 / 127), 3, hot ? "slot" : don ? ORANGE : DIM);
    g.text(250, y + 4, valueOf(v, k, 0)[0], hot ? "slot" : INK, 1);
  }
  // the filter: Pung's, live; where its cutoff stands on Pung's axis (20 Hz .. 20 kHz)
  var hz = flHz(num(v, "p_fl_freq", 127)), at = Math.log(hz / 20) / Math.log(1000), fon = num(v, "p_fl_type", 0) > 0;
  g.filter(276, 16, 460, 52, { cutoff: "p_fl_freq", resonance: "p_fl_reso", type: "p_fl_type", at: at, color: ORANGE });
  var lfo = num(v, "p_fl_lfo", 0) / 127;
  if (fon && lfo > 0.004) { // the LFO's reach: +-4 octaves at full
    var oct = 4 * lfo, xc = 282 + 448 * at, px = 448 / Math.log2(1000), sw = oct * px, lc = touched === "p_fl_lfo" ? "slot" : SILVER_LO;
    var l0 = Math.max(282, xc - sw), l1 = Math.min(730, xc + sw);
    g.fill(l0, 70, l1 - l0, 2, lc); g.fill(l0, 67, 2, 7, lc); g.fill(l1 - 2, 67, 2, 7, lc);
  }
  g.text(276, 82, fon ? txt(v, "p_fl_type") + "  " + valueOf(v, "p_fl_freq", 0).join(" ") + "  RESO " + r10(num(v, "p_fl_reso", 0)) : "OFF: THE SOUND PASSES UNTOUCHED",
    hotIn(touched, ["p_fl_type", "p_fl_freq", "p_fl_reso"]) ? "slot" : INK, -1);
  // its LFO: Pung's
  g.lfo(754, 18, 190, 48, { shape: "p_lfo_shape", rate: "p_lfo_rate", sync: "p_lfo_sync", trig: "p_lfo_retrig", color: lfo > 0.004 && fon ? ORANGE : SILVER_LO });
  g.text(754, 82, valueOf(v, "p_lfo_rate", 0).join(" ") + "  " + (num(v, "p_lfo_retrig", 0) > 0 ? "KEY" : "FREE") + "  DEPTH " + r10(num(v, "p_fl_lfo", 0)),
    hotIn(touched, ["p_lfo_rate", "p_lfo_sync", "p_lfo_retrig", "p_fl_lfo", "p_lfo_shape"]) ? "slot" : INK, -1, 190);
}
push.compartment({
  id: "drive", label: "Drive / Filter",
  pages: [{ label: "Drive", keys: ["p_drv_sw", "p_drive", "p_drv_tone", "p_drv_mix"] },
    { label: "Filter", keys: ["p_fl_type", "p_fl_freq", "p_fl_reso", "p_fl_lfo", "p_lfo_shape", "p_lfo_rate", "p_lfo_sync", "p_lfo_retrig"] }],
  screen: driveScreen
});

// ---- the rest on Pung's pages, in the module's own groups -----------------------------------------------
push.compartment({
  id: "mod", label: "Trem / Phaser / Chorus",
  pages: [{ label: "Trem / Wah", keys: ["s_twkind", "p_tw_depth", "p_tw_rate", "p_tw_shape", "p_tw_sync"] },
    { label: "Phaser", keys: ["p_ph_sw", "p_ph_depth", "p_ph_speed", "p_ph_fdbk", "p_ph_sync"] },
    { label: "Chorus", keys: ["p_cp_sw", "p_cp_depth", "p_cp_speed", "p_cp_sync"] }]
});
push.compartment({
  id: "space", label: "Delay / Reverb",
  pages: [{ label: "Delay", keys: ["p_dl_sw", "p_dl_depth", "p_dl_time", "p_dl_fdbk", "p_dl_tone", "p_dl_sync"] },
    { label: "Reverb", keys: ["p_rv_type", "p_rv_depth", "p_rv_decay", "p_rv_tone", "p_rv_predly", "p_rv_size", "p_rv_mod", "p_rv_locut"] }]
});
push.compartment({
  id: "play", label: "Play",
  pages: [{ label: "Play", keys: ["p_type", "p_spread", "s_sustain", "s_fx", "p_delay", "s_vresp", "p_level", "s_mch"] },
    { label: "Arpeggio", keys: ["s_arpmode", "s_arprate", "s_arpoct", "s_arpgate", "s_arphold"] },
    { label: "Mappings", keys: ["m_at_cc", "m_at_lo", "m_at_hi", "m_pa_cc", "m_pa_lo", "m_pa_hi", "r_version"] }]
});
