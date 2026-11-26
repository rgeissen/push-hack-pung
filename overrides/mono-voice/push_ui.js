// Mono Voice on the Push: a machine voice in the manner of a classic
// six-track digital machine synth (SuperWave, SID, DigiPRO, FM+ machines).
//
// Such an instrument is worked through one graphic LCD and the parameter
// pages under it: SYNTH (the machine's own eight), AMP, FILTER, EFFECT,
// LFO 1-3, each with a second layer under a function key. Every control has
// a four-letter name that changes with the machine (a SuperWave's UNIL is a
// SID's PW), every value is a three-digit number or a short word. The
// panel is that LCD:
//
// - its header: the machine in an inverse box, the page, the arpeggiator;
// - the machine itself, drawn as what it does: the SuperWave's detuned stack
//   and its sub, the pulse at its width, the ensemble's four pitches, the
//   SID's wave and its modulation, the DigiPRO's 32 tables with the one
//   playing lit, the FM+ operators with their ratios and feedback;
// - the amp envelope (Pung's, on the engine's own times), the filter as the
//   window between its high-pass and low-pass edges, the three LFOs and
//   where they go;
// - the encoder row as the LCD's parameter boxes, with the machine's own
//   four-letter names and values in its units (ui_chain.js, mono_core.c).
//
// FILTER and LFO have band screens (the window and where the envelope
// takes it; the three LFOs side by side); AMP and EFFECT are Pung's pages,
// their values in real units (push.display).

var CASE = "#1b1c1f", CASE_RULE = "#2e3036", LCD_BG = "#0d141b", LCD_EDGE = "#04070a", LCD = "#d4ecff", LCD_DIM = "#5f7c92", LCD_FAINT = "#1d2a36";
var LED_ON = "#ff3b2f", LED_OFF = "#3a1f1e", KEY = "#2a2c31", KEY_EDGE = "#3d4048", LEGEND = "#b9bcc4";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function iv(v, k, d) { if (!known(v, k)) return d; var n = parseInt(v[k].value, 10); return isNaN(n) ? d : n; }
function up(s) { return String(s).toUpperCase(); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : (x === x ? x : 0); }
// where the sound has a control now (v[k].now: the module's live_mod: an LFO's
// target, the filter's edges after its envelope, the pan after its key follow;
// null when nothing moves it), 0..1 and in the control's raw units; the
// sound's place is drawn in the modulation colour beside the knob's
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? clamp01(v[k].now) : null; }
function moved(v, k) { var n = nowOf(v, k); return n !== null && Math.abs(n - fr(v, k, 0)) > 0.004; }
function liveIv(v, k, d) { var n = nowOf(v, k); return n === null || !(v[k].max > v[k].min) ? iv(v, k, d) : v[k].min + n * (v[k].max - v[k].min); }
function nowTrack(g, v, k, x, y, w) {
  if (!moved(v, k)) return;
  var f = fr(v, k, 0), n = nowOf(v, k);
  g.fill(x + w * Math.min(f, n), y, Math.max(1, w * Math.abs(n - f)), 1, MOD_DK);
  g.dot(x + w * n, y + 0.5, 2.8, MOD);
}

// ---- the machine's vocabulary (ui_chain.js) -------------------------------------------------

var MACHINES = ["SW SAW", "SW PULS", "SW ENS", "SID6581", "DIGIPRO", "FM+STAT"];
var SYNTH = [
  ["UNIL", "UNIW", "UNIX", "SUBX", "SUB1", "SUB2", "-", "TUNE"],
  ["UNIL", "UNIW", "SUB1", "SUB2", "PW", "PWAD", "PWRS", "TUNE"],
  ["PCH2", "PCH3", "PCH4", "WAVE", "PW", "CHRL", "CHRW", "TUNE"],
  ["PW", "PWAD", "PWRS", "WAVE", "MOD", "MSRC", "MFRQ", "TUNE"],
  ["WAVE", "WP", "WPM", "WPRS", "SYNC", "SFRQ", "-", "TUNE"],
  ["1FRQ", "1FIN", "1FB", "1ENV", "2FRQ", "2VOL", "TONE", "TUNE"]];
var SYNTH_SHIFT = [
  ["BRITE", "STACK", "SUBPW", "SUBO", "DRIFT", "FOLD", "BITS", "NOISE"],
  ["ASYM", "STACK", "SUB", "SYNC", "DRIFT", "FOLD", "BITS", "NOISE"],
  ["LEV1", "LEV2", "LEV3", "LEV4", "DRIFT", "FOLD", "BITS", "NOISE"],
  ["RING", "SUB", "MODMX", "CHAOS", "DRIFT", "FOLD", "BITS", "NOISE"],
  ["WAVE2", "BLEND", "DETUN", "OCT", "DRIFT", "FOLD", "BITS", "NOISE"],
  ["2FINE", "2FB", "3FRQ", "3LVL", "DRIFT", "FOLD", "BITS", "NOISE"]];
var COMMON = { amp: ["ATK", "HOLD", "DEC", "REL", "DIST", "VOL", "PAN", "PORT", "ACRV", "DCRV", "RCRV", "VEL", "KLVL", "EAMT", "PKEY", "GAIN"],
  flt: ["BASE", "WDTH", "HPQ", "LPQ", "FATK", "FDEC", "FBA", "FWD", "KTRK", "V2F", "EAMT", "FDRV", "HPSLP", "LPSLP", "MIX", "SAT"],
  fx: ["EQF", "EQG", "SRR", "DSND", "DTIM", "DFB", "DBAS", "DWID", "EQQ", "EQMIX", "BITS", "PING", "DUCK", "DDRV", "DMODR", "DMODD"],
  lfo: ["DEST", "TRIG", "WAVE", "MULT", "SPD", "INTL", "DPTH", "PHAS", "FADE", "DELAY", "SLEW", "SYMM", "STEPS", "POL", "VEL", "KEY"] };
var LFO_DEST = ["OFF", "PITCH", "SYN1", "SYN2", "SYN3", "SYN4", "SYN5", "SYN6", "SYN7", "TUNE", "AATK", "AHOLD", "ADEC", "AREL", "DIST", "VOL", "PAN", "PORT",
  "FBASE", "FWID", "HPQ", "LPQ", "FATK", "FDEC", "EBASE", "EWID", "EQFRQ", "EQGN", "SRATE", "DSEND", "DTIME", "DFB", "DBASE", "DWID",
  "L1DST", "L1TRG", "L1WAV", "L1MUL", "L1SPD", "L1INT", "L1DEP", "L1PHS", "L2DST", "L2TRG", "L2WAV", "L2MUL", "L2SPD", "L2INT", "L2DEP", "L2PHS",
  "L3DST", "L3TRG", "L3WAV", "L3MUL", "L3SPD", "L3INT", "L3DEP", "L3PHS", "ALT1", "ALT2", "ALT3", "ALT4", "DRIFT", "FOLD", "BITS", "NOISE",
  "ACRV", "DCRV", "RCRV", "VEL", "KLVL", "EAMT", "PKEY", "GAIN", "KTRK", "V2F", "FEAMT", "FDRV", "HPSLP", "LPSLP", "FMIX", "FSAT",
  "EQQ", "EQMIX", "BITS", "PING", "DUCK", "DDRV", "DMODR", "DMODD", "L1FAD", "L1DLY", "L1SLW", "L1SYM", "L1STP", "L1POL", "L1VEL", "L1KEY",
  "L2FAD", "L2DLY", "L2SLW", "L2SYM", "L2STP", "L2POL", "L2VEL", "L2KEY", "L3FAD", "L3DLY", "L3SLW", "L3SYM", "L3STP", "L3POL", "L3VEL", "L3KEY"];
var LFO_TRIG = ["FREE", "TRIG", "HOLD", "ONE", "HALF"], LFO_WAVE = ["SINE", "SAW", "TRI", "SQR", "RAND"];
var LFO_PUNG = ["Sine", "Saw Up", "Triangle", "Square", "S&H"], LFO_MULT = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];
var FM_RATIO = ["1/64", "1/32", "1/16", "3/32", "1/8", "3/16", "1/4", "5/16", "3/8", "7/16", "1/2", "5/8", "3/4", "7/8", "1", "1.25", "1.5", "1.75", "2", "2.5",
  "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "12", "16", "24"];
var ARP_MODE = ["UP", "DOWN", "PEND", "RAND", "PLAY", "CNVRG"], ARP_RATE = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T", "1/64"];
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function band(x, n) { return Math.max(0, Math.min(n - 1, Math.floor(x * n / 128))); }
function noteName(x) { return NOTE[x % 12] + (Math.floor(x / 12) - 1); }
function secs(x, max) { return x <= 0 ? 0 : 0.002 * Math.pow(max / 0.002, x / 127); }
function shortTime(s) { return s <= 0 ? "0MS" : s < 1 ? Math.round(s * 1000) + "MS" : (s < 10 ? s.toFixed(2) : s.toFixed(1)) + "S"; }

// a key's place in the engine's parameter map (pages of eight, the shift
// layer from 56): ui_chain.js currentParamId
var PAGE = { syn: 0, amp: 1, flt: 2, fx: 3, lfo1_: 4, lfo2_: 5, lfo3_: 6 };
function pid(k) {
  var m = /^(syn|amp|flt|fx|lfo[123]_)(\d+)$/.exec(k);
  if (!m) return -1;
  var n = parseInt(m[2], 10) - 1, p = PAGE[m[1]];
  return n < 8 ? p * 8 + n : 56 + p * 8 + (n - 8);
}
function abbrev(k, machine) {
  var m = /^(syn|amp|flt|fx|lfo[123]_)(\d+)$/.exec(k);
  if (!m) return k === "machine" ? "MACH" : up(k);
  var n = parseInt(m[2], 10) - 1;
  if (m[1] === "syn") return n < 8 ? SYNTH[machine][n] : SYNTH_SHIFT[machine][n - 8];
  return COMMON[m[1].replace(/\d_$/, "")][n];
}
var TIMES = { 8: 4, 9: 4, 10: 12, 11: 8, 15: 3, 20: 4, 21: 8, 88: 8, 89: 4, 90: 2, 96: 8, 97: 4, 98: 2, 104: 8, 105: 4, 106: 2 };
// a value as the machine's own LCD writes it (ui_chain.js parameterValue)
function valueOf(k, x, machine) {
  if (k === "machine") return MACHINES[Math.max(0, Math.min(5, x))];
  var p = pid(k);
  if (p < 0) return String(x);
  if (p < 8) { // the machine's own
    var i = p;
    if (machine === 1 && i === 6) return x < 64 ? "OFF" : "ON";
    if (machine === 2 && i < 3) return x < 4 ? "OFF" : x >= 112 ? ["6/5", "5/4", "4/3", "3/2"][Math.min(3, Math.floor((x - 112) / 4))] : Math.round((x - 4) * 24 / 107) + "ST";
    if (machine === 3) {
      if (i === 2) return x < 64 ? "OFF" : "ON";
      if (i === 3) return ["TRI", "SAW", "PULS", "MIX", "NOIS"][band(x, 5)];
      if (i === 4) return ["OFF", "RING", "SYNC", "R+S"][band(x, 4)];
      if (i === 5) return x < 64 ? "MFRQ" : "PRCH";
      if (i === 6) return noteName(x);
    }
    if (machine === 4) {
      if (i === 0) { var w = band(x, 32); return "W" + (w < 10 ? "0" : "") + w; }
      if (i === 3) return x < 64 ? "OFF" : "ON";
      if (i === 4) return ["OFF", "SFRQ", "PRCH"][band(x, 3)];
      if (i === 5) return noteName(x);
    }
    if (machine === 5 && (i === 0 || i === 4)) return FM_RATIO[band(x, 32)];
  }
  if (p >= 32 && p < 56) { // the LFOs' first layer
    var j = (p - 32) % 8;
    if (j === 0) return LFO_DEST[Math.max(0, Math.min(LFO_DEST.length - 1, x))];
    if (j === 1) return LFO_TRIG[Math.floor(x * 5 / 128)];
    if (j === 2) return LFO_WAVE[Math.floor(x * 5 / 128)];
    if (j === 3) { var mu = LFO_MULT[band(x, 8)]; return "X" + (mu < 1 ? "1/" + (1 / mu) : mu); }
  }
  if (TIMES[p]) return shortTime(secs(x, TIMES[p]));
  if (p === 28) return shortTime(0.015 + 1.82 * x / 127);
  if (p === 24) { var hz = 18 * Math.pow(1000, x / 127); return hz >= 1000 ? (hz / 1000).toFixed(hz < 10000 ? 1 : 0) + "K" : Math.round(hz) + "HZ"; }
  if (p === 7) { var c = Math.round((x - 64) * 100 / 64); return (c >= 0 ? "+" : "") + c + "C"; }
  if (p === 14) { var pn = Math.round((x - 64) * 100 / 64); return pn === 0 ? "CENTR" : (pn < 0 ? "L" : "R") + Math.abs(pn); }
  if (p === 25) { var gn = x - 64; return gn === 0 ? "0DB" : (gn > 0 ? "+" : "") + gn + "DB"; }
  if (p === 76 || p === 77) return x < 64 ? "12DB" : "24DB";
  if (p === 93 || p === 101 || p === 109) return x < 64 ? "UNI" : "BI";
  if (p === 62 || p === 82) return (16 - Math.round(x * 12 / 127)) + "BIT";
  return (x < 10 ? "00" : x < 100 ? "0" : "") + x;
}

// Pung's own pages read the same, except the machine's eight, which change
// meaning with the machine (they are read on the panel, by the machine)
push.display(function (key, raw) {
  var x = parseInt(raw, 10);
  if (isNaN(x) || /^syn([1-9]|1[0-2])$/.test(key) || key === "machine" || /^lfo\d_1$/.test(key)) return;
  return valueOf(key, x, 0);
});

// the amp's stages (amp_env_tick): attack and hold on a 4 s curve, decay to
// silence on 12 s, release from where it is on 8 s; the filter's attack 4 s,
// decay 8 s
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    var x = parseInt(s.raw, 10), max = { amp1: 4, amp2: 4, amp3: 12, amp4: 8, flt5: 4, flt6: 8 }[s.key];
    return max && !isNaN(x) ? Math.max(0.001, secs(x, max)) : null;
  });
});

// ---- the LCD ------------------------------------------------------------------------

var SCR = { x: 10, y: 6, w: 640, h: 94 };
var MACH = { x: 18, y: 26, w: 196, h: 66 }, AMP = { x: 226, y: 30, w: 196, h: 62 }, FLT = { x: 434, y: 26, w: 208, h: 66 };

function caseGround(g) {
  g.layer("mono-panel", function () {
    g.fill(0, 0, 960, 160, CASE);
    g.fill(SCR.x - 4, SCR.y - 4, SCR.w + 8, SCR.h + 8, LCD_EDGE);
    g.fill(SCR.x, SCR.y, SCR.w, SCR.h, LCD_BG);
    // the encoder row: the LCD's parameter strip
    g.fill(4, 106, 952, 52, LCD_EDGE);
    g.fill(6, 108, 948, 48, LCD_BG);
    // the LCD's own rules between its sections
    g.fill(220, 24, 1, 70, LCD_FAINT);
    g.fill(428, 24, 1, 70, LCD_FAINT);
    g.fill(SCR.x, 22, SCR.w, 1, LCD_FAINT);
    g.text(AMP.x + 2, 32, "AMP", LCD_DIM, -1);
    g.text(FLT.x, 32, "FILTER", LCD_DIM, -1);
    // the LFO bank, right of the LCD
    for (var i = 0; i < 3; i++) g.fill(664, 8 + i * 31, 288, 29, "#202227");
  });
}

function header(g, v, machine) {
  var t = v.$touched || "", name = MACHINES[machine], x = SCR.x + 6;
  var w = g.measure(name, "value") + 12;
  g.fill(x - 2, SCR.y + 2, w, 15, t === "machine" ? "slot" : LCD);
  g.text(x + 4, SCR.y + 13, name, LCD_BG, -1);
  var ps = v.$pages || [];
  var pg = ps.length ? up(ps[v.$page] || "") + (ps.length > 1 ? " " + (v.$page + 1) + "/" + ps.length : "") : "";
  if (v.$segmode === "segment") { var sl = (v.$segments || []).filter(function (q) { return q.id === v.$segment; })[0]; pg = sl ? up(sl.label) : pg; }
  g.text(x + w + 8, SCR.y + 13, pg, LCD, -1);
  // the touched control, by its long name, as the LCD's top line does
  var right = SCR.x + SCR.w - 6;
  if (t && v[t]) {
    var val = known(v, t) ? valueOf(t, iv(v, t, 0), machine) : "--";
    g.text(right, SCR.y + 13, val, LCD, 1);
    g.text(right - g.measure(val) - 10, SCR.y + 13, up(v[t].name), LCD_DIM, 1, 220);
  } else {
    var on = iv(v, "arp_enabled", 0) === 1;
    var s = on ? "ARP " + (ARP_MODE[iv(v, "arp_mode", 0)] || "") + " " + (ARP_RATE[iv(v, "arp_rate", 3)] || "") + (iv(v, "arp_latch", 0) ? " LATCH" : "") : "ARP OFF";
    g.text(right, SCR.y + 13, s, on ? LCD : LCD_DIM, 1);
  }
}

// ---- the machine, drawn as what it does ----------------------------------------------------

var memo = {};
function cached(key, make) { if (memo[key]) return memo[key]; if (Object.keys(memo).length > 48) memo = {}; return (memo[key] = make()); }
function saw(x, y, w, h, cycles, off) {
  var p = [], cw = w / cycles;
  for (var i = 0; i < cycles; i++) { p.push([x + off + i * cw, y + h], [x + off + (i + 1) * cw - 0.5, y]); }
  p.push([x + off + w, y + h]);
  return p;
}
function pulse(x, y, w, h, cycles, pw) {
  var p = [], cw = w / cycles;
  for (var i = 0; i < cycles; i++) { var a = x + i * cw, b = a + cw * pw; p.push([a, y + h], [a, y], [b, y], [b, y + h]); }
  p.push([x + w, y + h]);
  return p;
}
function tri(x, y, w, h, cycles) { var p = []; for (var i = 0; i <= cycles * 2; i++) p.push([x + i * w / (cycles * 2), i % 2 ? y : y + h]); return p; }

function machinePicture(g, v, m) {
  var x = MACH.x, y = MACH.y, w = MACH.w, s = [], kv = [];
  for (var i = 1; i <= 16; i++) { kv[i] = iv(v, "syn" + i, 0); s[i] = Math.round(liveIv(v, "syn" + i, 0)); }
  var hot = /^syn/.test(v.$touched || "") ? "slot" : LCD;
  if (m === 0 || m === 1) { // SuperWave: the stack, detuned, and the sub
    var uni = s[1] / 127, wid = s[2] / 127, pw = m === 1 ? 0.05 + 0.9 * s[5] / 127 : 0;
    // the unison voices around the centre one, as loud as UNIL, as far as UNIW
    if (uni > 0) for (var k = 6; k >= 1; k--) {
      var off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (1 + wid * 5);
      g.poly(m === 1 ? pulse(x + 8 + off, y + 6, w - 24, 26, 3, pw) : saw(x + 8, y + 6, w - 24, 26, 3, off), 1, uni > 0.5 ? LCD_DIM : LCD_FAINT);
    }
    g.poly(m === 1 ? pulse(x + 8, y + 6, w - 24, 26, 3, pw) : saw(x + 8, y + 6, w - 24, 26, 3, 0), 2, hot);
    var sub = (m === 0 ? s[5] + s[6] : s[3] + s[4]) / 254;
    if (sub > 0) g.poly(pulse(x + 8, y + 44, w - 24, Math.max(3, Math.round(16 * sub)), 1.5, 0.5), 1.6, LCD);
    var ksub = (m === 0 ? kv[5] + kv[6] : kv[3] + kv[4]) / 254;
    g.text(x, y + 62, "UNISON " + kv[1] + "  WIDTH " + kv[2] + "  " + (ksub > 0 ? "SUB " + Math.round(ksub * 100) + "%" : "NO SUB"), LCD_DIM, -1, w);
  } else if (m === 2) { // the ensemble: four pitched voices over the root
    var lv = [127, s[9], s[10], s[11], s[12]];
    for (var e = 0; e < 4; e++) {
      var val = e === 0 ? "ROOT" : valueOf("syn" + e, kv[e], 2), lx = x + 4 + e * 48, on = e === 0 || val !== "OFF";
      var hh = Math.round(36 * (on ? (lv[e + 1] === undefined ? 1 : lv[e + 1] / 127) : 0));
      g.fill(lx, y + 44 - hh, 30, hh, on ? (e === 0 ? LCD : LCD_DIM) : LCD_FAINT);
      g.fill(lx, y + 44, 30, 1, LCD_FAINT);
      g.text(lx + 15, y + 56, val, on ? LCD : LCD_DIM, 0);
    }
    g.text(x, y + 66, "CHORUS " + kv[6] + "  WIDTH " + kv[7], LCD_DIM, -1);
  } else if (m === 3) { // SID: the wave, its width, its modulation
    var wv = band(s[4], 5), pws = s[1] / 127;
    var pts = wv === 0 ? tri(x + 8, y + 6, w - 24, 30, 3) : wv === 1 ? saw(x + 8, y + 6, w - 24, 30, 3, 0) : wv === 2 ? pulse(x + 8, y + 6, w - 24, 30, 3, 0.05 + 0.9 * pws) : null;
    if (wv === 3) { g.poly(tri(x + 8, y + 6, w - 24, 30, 3), 1, LCD_DIM); pts = pulse(x + 8, y + 6, w - 24, 30, 3, 0.05 + 0.9 * pws); }
    if (wv === 4) { pts = []; for (var q = 0; q <= 48; q++) pts.push([x + 8 + q * (w - 24) / 48, y + 6 + ((q * 7919) % 31)]); }
    g.poly(pts, 2, hot);
    var mod = valueOf("syn5", kv[5], 3);
    g.text(x, y + 52, "WAVE " + ["TRI", "SAW", "PULS", "MIX", "NOIS"][band(kv[4], 5)], LCD, -1);
    g.text(x, y + 66, "MOD " + mod + (mod !== "OFF" ? " " + valueOf("syn7", kv[7], 3) : ""), LCD_DIM, -1);
  } else if (m === 4) { // DigiPRO: 32 tables, the one playing (and the blend's second)
    var wi = band(s[1], 32), w2 = band(s[9], 32), bl = s[10] / 127;
    for (var c = 0; c < 32; c++) {
      var cx = x + 4 + (c % 16) * 12, cy = y + 6 + Math.floor(c / 16) * 18;
      g.fill(cx, cy, 10, 14, c === wi ? hot : c === w2 && bl > 0 ? LCD_DIM : LCD_FAINT);
    }
    var kw2 = band(kv[9], 32), kbl = kv[10] / 127;
    g.text(x, y + 52, "WAVE " + valueOf("syn1", kv[1], 4) + (kbl > 0 ? "  BLEND W" + (kw2 < 10 ? "0" : "") + kw2 + " " + Math.round(kbl * 100) + "%" : ""), LCD, -1);
    g.text(x, y + 66, "SYNC " + valueOf("syn5", kv[5], 4), LCD_DIM, -1);
  } else { // FM+ static: the operators, their ratios, the feedback
    var r1 = FM_RATIO[band(s[1], 32)], r2 = FM_RATIO[band(s[5], 32)], fb = s[3], l2 = s[6];
    var ops = [{ n: "1", r: r1, x: x + 4 }, { n: "2", r: r2, x: x + 70 }, { n: "3", r: FM_RATIO[band(s[11], 32)], x: x + 136 }];
    for (var o = 0; o < 3; o++) {
      g.fill(ops[o].x, y + 14, 52, 26, o === 0 ? LCD : LCD_FAINT);
      g.text(ops[o].x + 6, y + 26, "OP" + ops[o].n, o === 0 ? LCD_BG : LCD_DIM, -1);
      g.text(ops[o].x + 46, y + 36, ops[o].r, o === 0 ? LCD_BG : LCD, 1);
    }
    if (fb > 0) { g.line(ops[0].x + 26, y + 14, ops[0].x + 26, y + 6, 1.5, LCD); g.line(ops[0].x + 26, y + 6, ops[0].x + 60, y + 6, 1.5, LCD); }
    g.text(x, y + 56, "FB " + kv[3] + "  OP2 LVL " + kv[6] + "  OP3 LVL " + kv[12], LCD, -1);
    g.text(x, y + 66, "TONE " + kv[7], LCD_DIM, -1);
  }
}

// ---- the filter: the window between the two edges ------------------------------------------
// BASE is the high-pass edge, an octave each eight steps from two octaves
// under the note; WDTH is the octaves from there to the low-pass edge. The
// envelope moves both, by (FBA - 64) and (FWD - 64) times its amount, at its
// peak (mono_core.c, the filter block).

function octaves(v) {
  var base = iv(v, "flt1", 0), wid = iv(v, "flt2", 127), amt = iv(v, "flt11", 127) / 127;
  var eb = Math.max(0, Math.min(127, base + (iv(v, "flt7", 64) - 64) * amt));
  var ew = Math.max(0, Math.min(127, wid + (iv(v, "flt8", 64) - 64) * amt));
  return { hp: base / 8 - 2, lp: base / 8 - 2 + wid / 8, ehp: eb / 8 - 2, elp: eb / 8 - 2 + ew / 8 };
}
function windowStrip(g, v, x, y, w, h, lo, hi, ink, dim, faint, labels) {
  var o = octaves(v), t = v.$touched || "";
  var X = function (oc) { return x + (Math.max(lo, Math.min(hi, oc)) - lo) / (hi - lo) * w; };
  for (var oc = Math.ceil(lo); oc <= hi; oc += 2) g.fill(Math.round(X(oc)), y, 1, h, faint);
  // the played note
  g.fill(Math.round(X(0)), y - 4, 1, h + 4, dim);
  if (labels === 2) g.text(X(0), y - 6, "NOTE", dim, 0);
  // where the envelope's peak takes it, outlined
  var ex0 = X(o.ehp), ex1 = X(o.elp);
  if (Math.abs(o.ehp - o.hp) > 0.05 || Math.abs(o.elp - o.lp) > 0.05) {
    g.fill(Math.round(ex0), y + 2, Math.max(1, Math.round(ex1 - ex0)), 1, dim);
    g.fill(Math.round(ex0), y + h - 3, Math.max(1, Math.round(ex1 - ex0)), 1, dim);
    g.fill(Math.round(ex0), y + 2, 1, h - 4, dim); g.fill(Math.round(ex1), y + 2, 1, h - 4, dim);
  }
  // the window as it stands
  var x0 = X(o.hp), x1 = X(o.lp), hot = /^flt[1-4]$/.test(t);
  g.fill(Math.round(x0), y + 6, Math.max(2, Math.round(x1 - x0)), h - 12, hot ? "slot" : ink);
  // where the sound has it now (the envelope, velocity, LFOs on BASE and WDTH)
  if (moved(v, "flt1") || moved(v, "flt2")) {
    var lb = liveIv(v, "flt1", 0), lw = liveIv(v, "flt2", 127), n0 = X(lb / 8 - 2), n1 = X(lb / 8 - 2 + lw / 8);
    g.fill(Math.round(n0), y + h - 4, Math.max(2, Math.round(n1 - n0)), 2, MOD);
    g.fill(Math.round(n0), y + 2, 2, h - 4, MOD); g.fill(Math.round(n1) - 1, y + 2, 2, h - 4, MOD);
  }
  if (labels) {
    g.text(x0, y + h + 9, "HP", t === "flt1" ? "slot" : ink, 0);
    g.text(x1, y + h + 9, "LP", t === "flt2" ? "slot" : ink, 0);
  }
}

// ---- the LFO bank -------------------------------------------------------------------------

function lfoInfo(v, n) {
  var p = "lfo" + n + "_";
  var d = iv(v, p + "1", 0), trig = Math.floor(iv(v, p + "2", 0) * 5 / 128), wave = Math.floor(iv(v, p + "3", 0) * 5 / 128);
  var mult = LFO_MULT[band(iv(v, p + "4", 32), 8)], spd = iv(v, p + "5", 32), depth = iv(v, p + "7", 0);
  var perBeat = mult * (0.125 + 3.875 * spd / 127); // cycles a beat (lfo_tick: on the tempo)
  return { dest: LFO_DEST[Math.max(0, Math.min(LFO_DEST.length - 1, d))], trig: trig, wave: wave, depth: depth, perBeat: perBeat, mult: mult, on: d > 0 && depth > 0 };
}
function lfoBank(g, v) {
  var t = v.$touched || "";
  for (var n = 1; n <= 3; n++) {
    var L = lfoInfo(v, n), y = 8 + (n - 1) * 31, hot = t.indexOf("lfo" + n + "_") === 0 || segLit(v, "lfo" + n);
    g.text(670, y + 12, "LFO" + n, hot ? "slot" : LEGEND, -1);
    g.dot(674, y + 21, 3, L.on ? LED_ON : LED_OFF);
    g.lfo(704, y + 1, 76, 27, { shape: LFO_PUNG[L.wave], rate: clamp01((L.perBeat * 4 - 1) / 4), trig: L.trig > 0, color: L.on ? LCD : LCD_DIM });
    g.text(788, y + 12, L.dest, L.on ? LCD : LCD_DIM, -1, 90);
    g.text(946, y + 12, LFO_TRIG[L.trig], LCD_DIM, 1);
    // the depth, as a bar
    g.fill(788, y + 19, 158, 3, "#30333a");
    g.fill(788, y + 19, Math.round(158 * L.depth / 127), 3, L.on ? LCD : LCD_DIM);
    nowTrack(g, v, "lfo" + n + "_7", 788, y + 23, 158);
  }
}

// ---- the encoder row: the LCD's parameter boxes ---------------------------------------------

function row(g, v, machine) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    // in segment mode the bottom 18 pixels are Pung's: the boxes close up
    var sm = !!v.$segmode, x0 = 6 + i * 118.5, hot = k === t, ok = known(v, k), x = Math.round(x0 + 4), ty = sm ? 110 : 112;
    var name = abbrev(k, machine);
    // the name in an inverse tab, the knob, the value
    var nw = g.measure(name) + 10;
    g.fill(x, ty, nw, 13, hot ? "slot" : LCD);
    g.text(x + 5, ty + 10, name, LCD_BG, -1);
    if (!/^syn/.test(k)) g.text(x + nw + 6, ty + 10, up(v[k].name), LCD_DIM, -1, 108 - nw - 6);
    var cx = x + 14, cy = sm ? 132 : 142, r = sm ? 8 : 10, f = fr(v, k, 0);
    g.arc(cx, cy, r, 0, Math.PI * 2, 1.5, hot ? "slot" : LCD_DIM);
    if (ok) {
      var a = Math.PI * (0.75 + 1.5 * clamp01(f));
      g.line(cx, cy, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, hot ? "slot" : LCD);
      if (moved(v, k)) {
        var nf = nowOf(v, k), lo = Math.min(f, nf), an = Math.PI * (0.75 + 1.5 * nf);
        g.arc(cx, cy, r + 3, Math.PI * (0.75 + 1.5 * clamp01(lo)), Math.PI * 1.5 * Math.abs(nf - clamp01(f)), 2, MOD_DK);
        g.dot(cx + Math.cos(an) * (r + 3), cy + Math.sin(an) * (r + 3), 2.6, MOD);
      }
    }
    g.value(x + 32, sm ? 139 : 150, ok ? valueOf(k, iv(v, k, 0), machine) : "--", hot ? "slot" : LCD, -1, 78);
    if (i) g.fill(Math.round(x0) - 1, ty, 1, sm ? 30 : 40, LCD_FAINT);
  }
}

// ---- segments: the machine's pages, where they sit on the panel --------------------------------
function lfoKeys(n) { var o = []; for (var i = 1; i <= 8; i++) o.push("lfo" + n + "_" + i); return o; }
var SEGMENTS = [
  { id: "synth", label: "Synth", rect: [12, 24, 206, 74], keys: ["machine", "syn1", "syn2", "syn3", "syn4", "syn5", "syn6", "syn7"] },
  { id: "amp", label: "Amp", rect: [222, 24, 204, 74], keys: ["amp1", "amp2", "amp3", "amp4", "amp5", "amp6", "amp7", "amp8"] },
  { id: "filter", label: "Filter", rect: [430, 24, 218, 74], keys: ["flt1", "flt2", "flt3", "flt4", "flt5", "flt6", "flt7", "flt8"] },
  { id: "lfo1", label: "LFO 1", rect: [664, 8, 288, 29], keys: lfoKeys(1) },
  { id: "lfo2", label: "LFO 2", rect: [664, 39, 288, 29], keys: lfoKeys(2) },
  { id: "lfo3", label: "LFO 3", rect: [664, 70, 288, 29], keys: lfoKeys(3) }
];
// the active page: Pung draws the bar above it; its legend on the LCD lit
function segLit(v, id) { return v.$segmode === "segment" && v.$segment === id; }
function segmentMark(g, v) {
  if (segLit(v, "amp")) g.text(AMP.x + 2, 32, "AMP", "slot", -1);
  if (segLit(v, "filter")) g.text(FLT.x, 32, "FILTER", "slot", -1);
}

function machineOf(v) { return Math.max(0, Math.min(5, iv(v, "machine", 0))); }

var SYN = [], AMPK = [], FLTK = [], FXK = [], ALL_LFO = [];
for (var n0 = 1; n0 <= 16; n0++) { SYN.push("syn" + n0); AMPK.push("amp" + n0); FLTK.push("flt" + n0); FXK.push("fx" + n0); }
for (var l0 = 1; l0 <= 3; l0++) for (var n1 = 1; n1 <= 16; n1++) ALL_LFO.push("lfo" + l0 + "_" + n1);

// Pung's default pages in the mono voice's blue-white LCD
push.theme({ ground: LCD_BG, panel: LCD_BG, ink: LCD, dim: LCD_DIM, rule: LCD_DIM, faint: LCD_FAINT, accent: LCD, knob: "pointer" });
push.compartment({
  id: "machine", label: "Machine", front_panel: true, segments: SEGMENTS, draws_segments: true,
  pages: [
    { label: "Synth", keys: SYN.slice(0, 8) },
    { label: "Synth +", keys: SYN.slice(8) },
    { label: "Machine", keys: ["machine", "amp6", "amp5", "amp7", "amp8", "flt1", "flt2", "fx4"] }
  ],
  extra_keys: ["machine", "arp_enabled", "arp_mode", "arp_rate", "arp_latch"].concat(SYN, ["amp1", "amp2", "amp3", "amp4", "flt1", "flt2", "flt7", "flt8", "flt11", "flt3", "flt4"], ALL_LFO.filter(function (k) { return /_[1-7]$/.test(k); })),
  screen: function (g, v) {
    var m = machineOf(v);
    caseGround(g);
    header(g, v, m);
    machinePicture(g, v, m);
    g.envelope(AMP.x - 2, AMP.y + 4, AMP.w + 4, AMP.h - 4, { attack: "amp1", hold: "amp2", decay: "amp3", sustain: 0, release: "amp4", color: LCD });
    var ft = v.$touched || "";
    windowStrip(g, v, FLT.x + 4, FLT.y + 22, FLT.w - 12, 26, -2, 14, LCD, LCD_DIM, LCD_FAINT, true);
    g.text(FLT.x + FLT.w - 6, 32, "Q " + iv(v, "flt3", 0) + "/" + iv(v, "flt4", 0), /^flt[34]$/.test(ft) ? "slot" : LCD_DIM, 1);
    lfoBank(g, v);
    segmentMark(g, v);
    row(g, v, m);
  }
});

// AMP: the envelope over its four knobs (attack, hold, decay: the AHD shape
// the machine plays whatever the key does, release when let go early);
// over the rest, the distortion's curve, the level, where it sits, the glide
push.compartment({
  id: "amp", label: "Amp",
  pages: [{ label: "Amp", keys: AMPK.slice(0, 8) }, { label: "Amp +", keys: AMPK.slice(8) }],
  extra_keys: AMPK,
  screen: function (g, v) {
    var t = v.$touched || "";
    g.fill(0, 0, g.w, g.h, LCD_BG);
    g.text(6, 12, "AMP ENVELOPE", /^amp[1-4]$/.test(t) ? "slot" : LCD, -1);
    g.text(470, 12, "CURVES " + (iv(v, "amp9", 64) - 64) + " / " + (iv(v, "amp10", 64) - 64) + " / " + (iv(v, "amp11", 64) - 64), /^amp(9|10|11)$/.test(t) ? "slot" : LCD_DIM, 1);
    g.envelope(2, 16, 472, 70, { attack: "amp1", hold: "amp2", decay: "amp3", sustain: 0, release: "amp4", color: LCD });
    // distortion: tanh(x * drive) / tanh(drive), drive 1 + 15 DIST
    var d = 1 + iv(v, "amp5", 0) / 127 * 15, pts = [], dh = t === "amp5";
    for (var i = 0; i <= 40; i++) { var xi = i / 20 - 1; pts.push([492 + i * 2.2, 50 - Math.tanh(xi * d) / Math.tanh(d) * 30]); }
    g.fill(492, 50, 88, 1, LCD_FAINT);
    g.text(492, 12, "DIST", dh ? "slot" : LCD_DIM, -1);
    g.poly(pts, dh ? 2.6 : 2, dh ? "slot" : LCD);
    // volume, a bar
    var vol = iv(v, "amp6", 110) / 127, vh = t === "amp6";
    g.text(612, 12, "VOL", vh ? "slot" : LCD_DIM, -1);
    g.fill(614, 22, 12, 58, LCD_FAINT);
    g.fill(614, 80 - Math.round(58 * vol), 12, Math.round(58 * vol), vh ? "slot" : LCD);
    if (moved(v, "amp6")) g.fill(610, 80 - Math.round(58 * nowOf(v, "amp6")), 20, 2, MOD);
    // pan, a position
    var pan = (iv(v, "amp7", 64) - 64) / 64, ph = t === "amp7";
    g.text(732, 12, "PAN " + valueOf("amp7", iv(v, "amp7", 64)), ph ? "slot" : LCD_DIM, -1);
    g.fill(732, 50, 96, 1, LCD_FAINT); g.fill(780, 44, 1, 13, LCD_DIM);
    g.fill(Math.round(778 + pan * 46), 42, 5, 17, ph ? "slot" : LCD);
    if (moved(v, "amp7")) g.dot(780 + (liveIv(v, "amp7", 64) - 64) / 64 * 46, 64, 3, MOD);
    // portamento: the glide's time
    var pt = iv(v, "amp8", 0), gh = t === "amp8";
    g.text(852, 12, "GLIDE " + (pt ? shortTime(secs(pt, 3)) : "OFF"), gh ? "slot" : LCD_DIM, -1);
    var gw = pt ? 20 + 70 * pt / 127 : 0;
    g.poly(pt ? [[852, 70], [852 + 4, 70], [856 + gw, 32], [944, 32]] : [[852, 70], [852, 32], [944, 32]], gh ? 2.6 : 2, gh ? "slot" : LCD);
  }
});

// FILTER: the window between the edges, where the envelope takes it, and
// the envelope itself (over its knobs)
push.compartment({
  id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: FLTK.slice(0, 8) }, { label: "Filter +", keys: FLTK.slice(8) }],
  extra_keys: ["flt1", "flt2", "flt3", "flt4", "flt5", "flt6", "flt7", "flt8", "flt11", "flt13", "flt14"],
  screen: function (g, v) {
    var t = v.$touched || "";
    g.fill(0, 0, g.w, g.h, LCD_BG);
    var o = octaves(v);
    g.text(6, 12, "PASSBAND  " + (o.lp - o.hp).toFixed(1) + " OCT, FROM " + (o.hp >= 0 ? "+" : "") + o.hp.toFixed(1) + " OCT OF THE NOTE", /^flt[12]$/.test(t) ? "slot" : LCD, -1);
    g.text(470, 12, "HP " + valueOf("flt13", iv(v, "flt13", 0)) + "  LP " + valueOf("flt14", iv(v, "flt14", 0)), LCD_DIM, 1);
    windowStrip(g, v, 12, 32, 452, 34, -2, 14, LCD, LCD_DIM, LCD_FAINT, 2);
    g.text(486, 12, "ENVELOPE  AMOUNT " + iv(v, "flt11", 0), /^flt(5|6|7|8|11)$/.test(t) ? "slot" : LCD, -1);
    g.envelope(484, 18, 460, 68, { attack: "flt5", decay: "flt6", sustain: 0, color: LCD });
  }
});

push.compartment({
  id: "effect", label: "Effect",
  pages: [{ label: "Effect", keys: FXK.slice(0, 8) }, { label: "Effect +", keys: FXK.slice(8) }]
});

// LFO 1-3: all three at once, the page's own lit: what each moves, how deep,
// its wave at its speed on the tempo (cycles a beat: multiplier times speed)
function lfoPages() {
  var out = [];
  for (var n = 1; n <= 3; n++) {
    var ks = ALL_LFO.filter(function (k) { return k.indexOf("lfo" + n + "_") === 0; });
    out.push({ label: "LFO " + n, keys: ks.slice(0, 8) }, { label: "LFO " + n + " +", keys: ks.slice(8) });
  }
  return out;
}
push.compartment({
  id: "lfo", label: "LFO",
  pages: lfoPages(),
  extra_keys: ALL_LFO,
  screen: function (g, v) {
    var page = Math.floor((v.$page || 0) / 2) + 1;
    g.fill(0, 0, g.w, g.h, LCD_BG);
    for (var n = 1; n <= 3; n++) {
      var L = lfoInfo(v, n), x = (n - 1) * 318, me = n === page, p = "lfo" + n + "_";
      if (n > 1) g.fill(x - 3, 4, 1, 78, LCD_FAINT);
      var tw = g.measure("LFO" + n) + 10;
      g.fill(x + 4, 2, tw, 13, me ? LCD : LCD_FAINT);
      g.text(x + 9, 12, "LFO" + n, me ? LCD_BG : LCD_DIM, -1);
      g.text(x + tw + 12, 12, L.on ? "TO " + L.dest : "OFF", L.on ? LCD : LCD_DIM, -1, 140);
      g.text(x + 306, 12, LFO_TRIG[L.trig] + "  " + LFO_WAVE[L.wave], LCD_DIM, 1);
      g.lfo(x + 2, 18, 200, 66, { shape: LFO_PUNG[L.wave], rate: clamp01((L.perBeat * 4 - 1) / 4), trig: L.trig > 0, color: me ? LCD : LCD_DIM });
      // speed, depth, phase and the shaping the picture does not draw
      var y = 30, rx = x + 210;
      var lines = [L.perBeat.toFixed(2) + " / BEAT", "DEPTH " + L.depth, "PHASE " + iv(v, p + "8", 0),
        "SYMM " + (iv(v, p + "12", 64) - 64), "STEPS " + iv(v, p + "13", 0), (iv(v, p + "14", 127) < 64 ? "UNIPOLAR" : "BIPOLAR")];
      for (var i = 0; i < lines.length; i++) g.text(rx, y + i * 10, lines[i], me ? LCD : LCD_DIM, -1);
    }
  }
});
