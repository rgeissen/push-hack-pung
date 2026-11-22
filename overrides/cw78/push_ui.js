// CW-78 on Push: a CR-78-style rhythm box, fourteen circuit-modelled voices.
//
// The machine is a wooden box with a dark panel: a row of voice level
// sliders, the rhythm selector's coloured buttons (cream ballroom, green
// latin, blue rock, amber disco, red cancel) and its A/B lever. The screens
// are that panel:
//
//   PANEL    the whole kit at once: every voice's slider (its level), its two
//            trim pots (tune, decay), its lamp (lit as a note strikes it), a
//            red drive mark, a mute; the rhythm buttons, the lever and Play.
//            The encoders play a page of sliders (underlined) or the rhythm.
//   VOICES   a page a voice: the kit strip (which voice the knobs edit), the
//            voice's strike as the circuit rings (its pitch, ring time,
//            snappy or guiro rate, through its distortion at its drive), the
//            distortion's curve, its sends.
//   RHYTHM   the seventeen buttons and the pattern they play, on the
//            machine's own grid (48 steps a bar), both selectors merged, the
//            accents; a playhead on Live's beat while the rhythm plays.
//   EFFECTS  who is sent where (every voice's reverb and delay send at
//            once), and the delay's echoes on the beat.
//
// Values are the module's raw 0..127 pots; the module's own tables turn them
// into seconds, semitones and gains (cr78_params.h), and so does this file.

function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function frac(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }

// ---- the panel's colours ------------------------------------------------------------
var PANEL = "#1b1a18", PANEL2 = "#262421", RULE = "#3a3732", CREAM = "#e6dcc0", CREAM2 = "#a39a83", INK = "#141311";
var WOOD = "#6b3a1b", WOOD2 = "#552d15", WOOD3 = "#7d4722";
var LAMP = "#ff4a2a", LAMP_MID = "#a8301c", LAMP_OFF = "#3e1610", AMBER = "#f0a83a";
var KNOB = "#0e0e0d", KNOB_RIM = "#46433d";
var CAPS = { b: "#e7ddc4", l: "#5f9c55", r: "#4f7dbd", d: "#e4a23a", c: "#c63a2c" };
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;

// ---- the voices ------------------------------------------------------------------------
// id, plate, name, kind, factory frequency, the circuit in a line;
// tune: [min, max, exp] (semitones on the pitched lanes, a ratio on the others),
// decay: [min, max] seconds, exponential (cr78_params.h)
var V = [
  ["bd", "BD", "BASS DRUM", "drum", 62.5, "PHASE-SHIFT LADDER", [-12, 12, 0], [0.03, 1.0]],
  ["sd", "SD", "SNARE DRUM", "snare", 340, "SHELL + NOISE SNAP", [-12, 12, 0], [0.02, 0.6]],
  ["rs", "RS", "RIM SHOT", "tank", 1480, "700 MH COIL, STRUCK", [-12, 12, 0], [0.002, 0.08]],
  ["hh", "HH", "HI-HAT", "noise", 0, "NOISE, C525 ENVELOPE", [0.5, 2, 1], [0.01, 0.6]],
  ["cy", "CY", "CYMBAL", "cym", 9098, "NOISE INTO L3 TANK", [0.5, 2, 1], [0.05, 3.0]],
  ["ma", "MA", "MARACAS", "noise", 0, "NOISE, C527 ENVELOPE", [0.5, 2, 1], [0.005, 0.6]],
  ["cl", "CL", "CLAVES", "tank", 2630, "THE RIM'S COIL, SMALLER C", [-12, 12, 0], [0.005, 0.2]],
  ["hb", "HB", "HIGH BONGO", "drum", 600, "BRIDGED-T CHANNEL", [-12, 12, 0], [0.01, 0.4]],
  ["lb", "LB", "LOW BONGO", "drum", 400, "BRIDGED-T CHANNEL", [-12, 12, 0], [0.01, 0.4]],
  ["lc", "LC", "LOW CONGA", "drum", 208, "BRIDGED-T CHANNEL", [-12, 12, 0], [0.03, 1.2]],
  ["cb", "CB", "COWBELL", "bell", 800, "800 + 555 HZ, ONE BAND", [-12, 12, 0], [0.02, 0.8]],
  ["tb", "TB", "TAMBOURINE", "tamb", 3500, "NOISE + L5 TANK", [0.5, 2, 1], [0.013, 1.5]],
  ["gu", "GU", "GUIRO", "guiro", 6126, "MULTIVIBRATOR TEETH", [0.5, 2, 1], [0.05, 1.0]],
  ["mb", "MB", "METAL BEAT", "metal", 6170, "3 FREE-RUNNING OSCS", [0.5, 2, 1], [0.01, 0.5]]
];
var NV = V.length;
var DIST = ["DIODE", "CLIP", "SAT", "BFZ", "PDIST", "FOLD", "CRUSH"];
function tuneOf(i, r) { var p = V[i][6]; var t = r / 127; return p[2] ? p[0] * Math.pow(p[1] / p[0], t) : p[0] + (p[1] - p[0]) * t; }
function decayOf(i, r) { var p = V[i][7]; return p[0] * Math.pow(p[1] / p[0], r / 127); }
function tuneText(i, r) {
  var x = tuneOf(i, r);
  if (V[i][6][2]) return "x" + x.toFixed(2);
  var s = Math.round(x);
  return (s > 0 ? "+" : "") + s + " ST";
}
function secText(s) { return s < 0.1 ? Math.round(s * 1000) + " MS" : s.toFixed(2) + " S"; }

// ---- what is playing: the notes Pung saw, as voices ---------------------------------
// drum rack 36..49 (default), General MIDI, or the Move's pads (cr78_plugin.cpp)
var GM = { 35: 0, 36: 0, 38: 1, 40: 1, 37: 2, 42: 3, 44: 3, 46: 3, 49: 4, 51: 4, 52: 4, 55: 4, 57: 4, 59: 4, 70: 5, 75: 6,
  60: 7, 61: 8, 62: 9, 63: 9, 64: 9, 56: 10, 54: 11, 73: 12, 74: 12, 80: 13, 81: 13 };
var PADS = { 68: 0, 69: 1, 70: 2, 71: 3, 76: 4, 77: 5, 78: 6, 79: 7, 84: 8, 85: 9, 86: 10, 87: 11, 92: 12, 93: 13 };
function voiceOf(note, gm) {
  if (PADS[note] !== undefined) return PADS[note];
  if (gm) return GM[note] !== undefined ? GM[note] : -1;
  return note >= 36 && note < 36 + NV ? note - 36 : -1;
}
// each voice's last strike, seconds ago (-1: none in the last seconds)
function strikes(v) {
  var out = [], i, L = v.$live;
  for (i = 0; i < NV; i++) out.push(-1);
  if (!L || !L.known || !L.voices) return out;
  var gm = raw(v, "note_map", 0) >= 1;
  for (i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], vi = voiceOf(n.note, gm);
    if (vi >= 0 && (out[vi] < 0 || n.age < out[vi])) out[vi] = n.age;
  }
  return out;
}
function lampColor(age) { return age < 0 ? LAMP_OFF : (age < 0.12 ? LAMP : (age < 0.35 ? LAMP_MID : LAMP_OFF)); }
function muted(v, i) { return (raw(v, "mutes", 0) >> i) & 1; }

// ---- a voice's strike, as its circuit rings ---------------------------------------
// The strike is drawn as a scope draws it: a column at a time, the highest and
// the lowest the sound reaches in it. A tone the columns resolve is drawn as
// its wave; noise and a tone too fast for a column fill a band as wide as they
// are loud, as on a scope. A column costs a few steps (a phasor, a decay
// multiplier), so a page turn draws a new strike within the frame's budget.
function rnd(i) { var x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
var NOISE = [];
for (var ni = 0; ni < 1024; ni++) NOISE.push(Math.abs(rnd(ni)));
// a voice as partials: a sine [f, amp], squares [[f, amp]...], noise, a
// separate noise snap [amp, seconds], a click, guiro teeth (a rate)
function partsOf(i, P) {
  var f = P.f;
  switch (V[i][3]) {
  case "drum": return { sin: [f, 1], sq: [], noise: 0, click: 0.5 };
  case "snare": return { sin: [f, 1 - 0.55 * P.snap], sq: [], noise: 0, snap: [0.25 + 0.75 * P.snap, 0.027] };
  case "tank": return { sin: [f, 1], sq: [], noise: 0 };
  case "noise": return { sin: null, sq: [], noise: 1 };
  case "cym": return { sin: [f, 0.25], sq: [], noise: 0.75 };
  case "tamb": return { sin: [f, 0.4], sq: [], noise: 0.6 };
  case "bell": return { sin: null, sq: [[f, 0.5], [f * 0.694, 0.5]], noise: 0 };
  case "metal": return { sin: null, sq: [[f, 0.34], [f * 0.911, 0.33], [f * 0.661, 0.33]], noise: 0 };
  case "guiro": return { sin: null, sq: [], noise: 0, teeth: (77 + 48 * P.rate) * P.r };
  }
  return { sin: null, sq: [], noise: 0 };
}
// a column's reach: [hi, lo] for each column, before the level and the drive
function strikeColumns(i, P, cols, win) {
  var pr = partsOf(i, P), dc = win / cols, out = [], c, q;
  var env = 1, ed = Math.exp(-6.9 * dc / P.T), sn = 1, snd = pr.snap ? Math.exp(-dc / pr.snap[1]) : 0;
  var band = pr.noise, wave = false, re = 0, im = 1, cr = 1, ci = 0, sA = 0;
  if (pr.sin) {
    if (pr.sin[0] * dc < 0.35) { wave = true; sA = pr.sin[1]; var w = Math.PI * pr.sin[0] * dc; cr = Math.cos(w); ci = Math.sin(w); }
    else band += pr.sin[1];
  }
  // squares: drawn as waves while a column holds under half a cycle, else a full band
  var sq = pr.sq, sqWave = sq.length && sq[0][0] * dc < 0.12, ph = [0, 0, 0];
  if (!sqWave) for (q = 0; q < sq.length; q++) band += sq[q][1];
  var tooth = pr.teeth ? 1 / pr.teeth : 0;
  for (c = 0; c < cols; c++) {
    var t = c * dc, hi = 0, lo = 0, nz = NOISE[(c * 7 + i * 131) & 1023];
    if (wave) { // two points a column: where the phasor stands at its start and its middle
      var r2 = re * cr - im * ci; im = re * ci + im * cr; re = r2;
      var a = sA * im; r2 = re * cr - im * ci; im = re * ci + im * cr; re = r2;
      var b = sA * im; hi = Math.max(a, b); lo = Math.min(a, b);
    }
    if (sqWave) {
      var s = 0;
      for (q = 0; q < sq.length; q++) { ph[q] += sq[q][0] * dc; s += (ph[q] - Math.floor(ph[q])) < 0.5 ? sq[q][1] : -sq[q][1]; }
      hi = Math.max(hi, s); lo = Math.min(lo, s);
    }
    var B = band * (0.55 + 0.45 * nz);
    if (tooth) { var since = t - Math.floor(t / tooth) * tooth; B += since < dc ? 1 : Math.exp(-since * 900); }
    hi = (hi + B) * env; lo = (lo - B) * env;
    if (pr.snap) { var sb = pr.snap[0] * sn * (0.55 + 0.45 * nz); hi += sb; lo -= sb; sn *= snd; }
    if (pr.click && t < 0.0015) { hi += pr.click; lo -= pr.click; }
    env *= ed;
    out.push(hi, lo);
  }
  return out;
}
// the seven distortion curves (cr78_shape.h), crush without its decimator
function shape(x, drive, type) {
  if (drive < 0.001) return x;
  var k = 1 + drive, u, w;
  switch (type) {
  case 1: u = Math.max(-1, Math.min(1, x * k)); return u / Math.pow(k, 0.6);
  case 2: u = x * k + 0.08 * k * x * x; return (0.35 * x + 0.8775 * u / (1 + Math.abs(u))) / Math.pow(k, 0.42);
  case 3: u = x * k * 2.5 + 0.22; w = (u / (1 + Math.abs(u)) - 0.22 / 1.22) * 1.05;
    var m = Math.max(0, Math.min(1, (k - 0.85) / 1.15)); return ((1 - m) * x + m * w) / Math.pow(k, 0.65);
  case 4: u = Math.max(-1, Math.min(1, x * k + 0.12)); return ((u - u * u * u / 3) - (0.12 - 0.000576)) * (1.5 / 1.479) / Math.pow(k, 0.45);
  case 5: u = x * k; for (var j = 0; j < 3; j++) { if (u > 1) u = 2 - u; if (u < -1) u = -2 - u; } return u / Math.pow(k, 0.5);
  case 6: var st = 1.5 + 9 / k; return Math.floor(x * st + 0.5) / st;
  }
  return tanh(drive * x) * (0.5 / tanh(0.5 * drive));
}
function tanh(x) { var e = Math.exp(2 * x); return (e - 1) / (e + 1); }

var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 64) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function voiceParams(v, i) {
  var id = V[i][0], tr = raw(v, id + "_tune", 64), r = V[i][6][2] ? tuneOf(i, tr) : Math.pow(2, tuneOf(i, tr) / 12);
  return { r: r, f: V[i][4] * r, T: decayOf(i, raw(v, id + "_decay", 64)), snap: raw(v, "sd_snappy", 64) / 127,
    rate: raw(v, "gu_rate", 64) / 127, drive: raw(v, id + "_drive", 0) * 10 / 127, type: Math.max(0, Math.min(6, Math.round(raw(v, id + "_dist_type", 0)))),
    level: raw(v, id + "_level", 64) * 2 / 127 };
}
// the strike, placed: the top and the bottom of the trace
function scope(i, P, x, y, w, h, win) {
  var step = 3, cols = Math.floor(w / step) + 1, sc = strikeColumns(i, P, cols, win);
  var top = [], bot = [], mid = y + h / 2, a = h / 2 - 1, g = Math.min(1.4, P.level) * 0.72, dry = P.drive < 0.001;
  for (var c = 0; c < cols; c++) {
    var hi = sc[c * 2], lo = sc[c * 2 + 1];
    if (!dry) { hi = shape(hi, P.drive, P.type); lo = shape(lo, P.drive, P.type); if (lo > hi) { var z = hi; hi = lo; lo = z; } }
    hi = Math.max(-1, Math.min(1, hi * g)); lo = Math.max(-1, Math.min(1, lo * g));
    top.push(x + c * step, mid - hi * a); bot.push(x + c * step, mid - lo * a);
  }
  return [top, bot];
}

// ---- values in their units, everywhere Pung writes one: the pots' raw 0..127 through
// the module's own tables (cr78_params.h)
function potExp(lo, hi, r) { return lo * Math.pow(hi / lo, r / 127); }
function fmt(k, raw) {
  var r = parseFloat(raw);
  if (isNaN(r)) return null;
  var m = /^([a-z]{2})_(tune|decay|level|drive|rev|dly)$/.exec(k);
  if (m && VID[m[1]] !== undefined) {
    var i = VID[m[1]];
    switch (m[2]) {
    case "tune": var tt = tuneText(i, r).split(" "); return [tt[0], tt[1] || ""];
    case "decay": var s = decayOf(i, r); return s < 1 ? [String(Math.round(s * 1000)), "MS"] : [s.toFixed(2), "S"];
    case "level": var gn = r * 2 / 127; return gn < 0.001 ? ["OFF", ""] : [(20 * Math.log(gn) / Math.LN10 > 0 ? "+" : "") + (20 * Math.log(gn) / Math.LN10).toFixed(1), "DB"];
    case "drive": return r < 0.5 ? ["OFF", ""] : [(r * 10 / 127).toFixed(1), ""];
    default: return [String(Math.round(r / 1.27)), "%"];
    }
  }
  switch (k) {
  case "sd_snappy": case "comp": case "volume": case "vel_depth": case "rev_tone": case "dly_tone": return [String(Math.round(r / 1.27)), "%"];
  case "gu_rate": return [String(Math.round(77 + 48 * r / 127)), "HZ"];
  case "master_drive": return r < 0.5 ? ["OFF", ""] : [(r * 10 / 127).toFixed(1), ""];
  case "rev_decay": return [String(Math.round((0.2 + 0.73 * r / 127) * 100)), "%"];
  case "rev_level": case "dly_level": return [String(Math.round(120 * r / 127)), "%"];
  case "dly_fdbk": return [String(Math.round(85 * r / 127)), "%"];
  case "rev_hpf": case "dly_hpf": return [String(Math.round(potExp(30, 800, r))), "HZ"];
  }
  return null;
}
push.display(function (k, raw) { var x = fmt(k, raw); return x ? { value: x[0], unit: x[1] } : undefined; });

// ---- knobs and the encoder row, as the panel has them -------------------------------
function pointer(g, x, y, r, f, color, width) {
  var a = A0 + f * SWEEP;
  g.line(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25, x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1), width, color);
}
function knobBody(g, x, y, r) { g.dot(x, y, r + 1.5, KNOB_RIM); g.dot(x, y, r, KNOB); }
function upper(s) { return String(s).toUpperCase(); }
// a knob's name without the voice it belongs to when the page says it
var VID = {};
for (var vx = 0; vx < 14; vx++) VID["bd sd rs hh cy ma cl hb lb lc cb tb gu mb".split(" ")[vx]] = vx;
var NAMES = { rhy_mode: "RHYTHM", rhy_ab: "A/B LEVER", rhy_style: "RHYTHM 1", rhy_style2: "RHYTHM 2", vel_depth: "VELOCITY",
  hat_choke: "CHOKE", master_drive: "MASTER DRIVE", master_dist: "MASTER DIST" };
// a knob's name as the panel prints it: the voice's plate, then what it does
function knobName(v, k) {
  if (NAMES[k]) return NAMES[k];
  var m = /^([a-z]{2})_(.*)$/.exec(k), n = upper(v[k].name);
  if (m && VID[m[1]] !== undefined) return V[VID[m[1]]][1] + " " + n.replace(/^\S+ /, "");
  return n;
}
// the row's lines: in segment mode the bottom 18 pixels are Pung's (the segments' names),
// so the row draws tighter, above y 142
function rowGeo(v) { return v.$segmode ? { name: 114, ky: 128, r: 10, val: 139 } : { name: 120, ky: 139, r: 12.5, val: 147 }; }
function encoderRow(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", G = rowGeo(v);
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, kx = x0 + 25, ky = G.ky;
    g.text(x0 + 60, G.name, knobName(v, k), hot ? "slot" : CREAM2, 0, 112);
    if (hot) g.arc(kx, ky, G.r + 3.5, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) pointer(g, kx, ky, G.r, v[k].frac, hot ? "slot" : "#ffffff", 2.5);
    var val = known(v, k) ? String(v[k].display || v[k].value) : "--", unit = known(v, k) ? String(v[k].unit || "") : "";
    var uw = unit ? g.measure(unit) + 3 : 0, room = 72 - uw, vw = Math.min(g.measure(val, "value"), room), cx = x0 + 83;
    g.value(cx - (vw + uw) / 2, G.val, val, hot ? "slot" : CREAM, -1, room);
    if (unit) g.text(cx - (vw + uw) / 2 + vw + 3, G.val, unit, CREAM2, -1);
  }
}
function encoderGround(g, v) {
  var kn = v.$knobs || [], G = rowGeo(v);
  g.fill(0, 104, 960, 56, PANEL);
  g.fill(14, 103, 932, 1, RULE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, v.$segmode ? 30 : 42, RULE);
  for (var i = 0; i < 8; i++) if (kn[i] && v[kn[i]]) knobBody(g, i * 120 + 25, G.ky, G.r);
}
function wood(g, x, h) {
  g.fill(x, 0, 12, h, WOOD);
  g.fill(x + 3, 0, 1, h, WOOD2); g.fill(x + 7, 0, 1, h, WOOD3); g.fill(x + 10, 0, 1, h, WOOD2);
}

// ---- the rhythm selector ------------------------------------------------------------------
// the seventeen buttons as the panel prints them; [label, group, pattern for A, for B]
var BTN = [
  ["WALTZ", "b", 0, 0], ["SHUFFLE", "b", 1, 1], ["SLOW ROCK", "b", 2, 2], ["SWING", "b", 3, 3], ["FOX/TANGO", "b", 4, 5],
  ["BOOGIE", "b", 6, 6], ["ENKA", "b", 7, 7], ["BOSSA", "l", 8, 8], ["SAMBA", "l", 9, 9], ["MAMBO/CHA", "l", 10, 11],
  ["BEG/RHUMBA", "l", 12, 13], ["ROCK 1", "r", 14, 14], ["ROCK 2", "r", 15, 15], ["ROCK 3", "r", 16, 16], ["ROCK 4", "r", 17, 17],
  ["DISCO 1", "d", 18, 18], ["DISCO 2", "d", 19, 19]
];
var CAPLBL = ["WALTZ", "SHUFFLE", "SLOW RK", "SWING", "FOX TROT", "BOOGIE", "ENKA", "BOSSA", "SAMBA", "MAMBO", "BEGUINE",
  "ROCK 1", "ROCK 2", "ROCK 3", "ROCK 4", "DISCO 1", "DISCO 2"];
var CAPLBL_B = { 4: "TANGO", 9: "CHA CHA", 10: "RHUMBA" }; // the dual caps say what the lever picks
// the buttons, three rows of six as the panel's strip: cancel last
function caps(g, x, y, w, h, gap, st) {
  for (var b = 0; b < 18; b++) {
    var bx = x + (b % 6) * (w + gap), by = y + Math.floor(b / 6) * (h + 3);
    if (b === 17) cap(g, bx, by, w, h, -1, false, false, "CANCEL");
    else cap(g, bx, by, w, h, b, b === st.b1, b === st.b2, st.ab && CAPLBL_B[b] ? CAPLBL_B[b] : CAPLBL[b]);
  }
}
// the patterns, from the service notes' notation (cr78_rhythms.h): steps a bar,
// name, bar A (voice:steps|...), its accents, bar B, its accents
var RHY = [
  [36, "Waltz", "0:0|4:0.24|8:12.24", "24", "0:0|4:0.24.30|8:12.18.24", "24"],
  [48, "Shuffle", "0:0.24|1:12.36|4:0.8.12.20.24.32.36.44", "0.12.24.36", "0:0.20.24|1:12.36|4:0.8.12.20.24.32.36.44", "0.12.24.36"],
  [48, "Slow Rock", "0:0.24|1:12.36|3:0.4.8.12.16.20.24.28.32.36.40.44", "0.12.24.36", "0:0.20.24.44|1:12.36|3:0.4.8.12.16.20.24.28.32.36.40.44", "0.12.24.36"],
  [48, "Swing", "0:0.24|4:0.12.20.24.36.44", "0.24", "0:0.24|4:0.12.20.24.36.44|7:36|8:12", "0.24"],
  [48, "Fox Trot", "0:0.24|1:12.36|4:0.12.24.36", "0.24", "0:0.18.24|1:12.36|4:0.12.24.36", "0.24"],
  [48, "Tango", "0:0.18.24.36|2:36|6:0.24", "0.24", "0:0.18.24.36|2:36.42|6:0.24", "0.24"],
  [48, "Boogie", "0:0.12.24.36|1:12.36|4:0.8.12.20.24.32.36.44", "0.12.24.36", "0:0.12.24.36.44|1:12.36|4:0.8.12.20.24.32.36.44", "0.12.24.36"],
  [48, "Enka", "0:0.24|1:12.36|7:18.42|8:6.30", "0.24", "0:0.24|1:12.36|7:18.42.45|8:6.30", "0.24"],
  [48, "Bossa Nova", "0:0.18.24.42|2:0.9.24|5:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45", "0.24", "0:0.18.24.42|2:6.18|5:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45", "0.24"],
  [48, "Samba", "0:0.9.24.33|2:12.36|5:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45|9:6.18.30.42", "0.24", "0:0.9.24.33|2:12.27.36|5:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45|9:6.18.30.42", "0.24"],
  [48, "Mambo", "0:0.18.24.42|7:18.42|9:6.30|10:0.12.24.36", "0.24", "0:0.18.24.42|7:18.42|8:45|9:6.30|10:0.12.24.36", "0.24"],
  [48, "Cha Cha", "0:0.24|6:0.18.24|7:45|9:36.42|10:12.36", "0.24", "0:0.24|6:12.36|7:45|9:36.42|10:12.36", "0.24"],
  [48, "Beguine", "0:0.18.24.42|2:0.9.18.27.36|5:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45|7:36|9:12", "0.24", "0:0.18.24.42|2:6.15.24.33.42|5:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45|7:36|9:12", "0.24"],
  [48, "Rhumba", "0:0.18.24.42|5:0.6.12.18.24.30.36.42|6:0.9.24|9:12.36", "0.24", "0:0.18.24.42|5:0.6.12.18.24.30.36.42|6:6.18|7:45|9:12.36", "0.24"],
  [48, "Rock 1", "0:0.18.24.36|1:12.36|3:0.6.12.18.24.30.36.42", "0.12.24.36", "0:0.18.21.24.36|1:12.36|3:0.6.12.18.24.30.36.42", "0.12.24.36"],
  [48, "Rock 2", "0:0.24.30|1:12.36|3:0.6.12.18.24.30.36.42", "0.12.24.36", "0:0.24.30.42|1:12.36|3:0.6.12.18.24.30.36.42", "0.12.24.36"],
  [48, "Rock 3", "0:0.18.24|1:12.36|3:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45", "0.12.24.36", "0:0.18.24.42|1:12.36|3:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45", "0.12.24.36"],
  [48, "Rock 4", "0:0.9.18.24.33|1:12.36|3:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45", "0.12.24.36", "0:0.9.18.24.33|1:12.30.36|3:0.3.6.9.12.15.18.21.24.27.30.33.36.39.42.45", "0.12.24.36"],
  [48, "Disco 1", "0:0.12.24.36|1:12.36|4:6|5:0.6.12.18.24.30.36.42", "0.12.24.36", "0:0.12.24.36.42|1:12.36|4:6.42|5:0.6.12.18.24.30.36.42", "0.12.24.36"],
  [48, "Disco 2", "0:0.12.24.36|1:12.36|4:0.18.24.42|5:6.18.30.42", "0.12.24.36", "0:0.12.24.36.45|1:12.36|4:0.18.24.42|5:6.18.30.42", "0.12.24.36"]
];
// what a button plays at the lever: {pattern, bar}; a dual button picks the
// style and plays its bar A, a single one plays bar A or B (cr78_plugin.cpp)
function resolve(button, ab) {
  if (button < 0 || button >= BTN.length) return null;
  var b = BTN[button], dual = b[2] !== b[3];
  return { p: ab ? b[3] : b[2], bar: dual ? 0 : ab };
}
function bar(sel) {
  return cached("bar|" + sel.p + "|" + sel.bar, function () {
    var r = RHY[sel.p], hits = r[2 + sel.bar * 2].split("|"), out = { n: r[0], name: r[1], v: {}, acc: {} };
    for (var i = 0; i < hits.length; i++) {
      var f = hits[i].split(":"), steps = f[1].split(".");
      out.v[+f[0]] = {};
      for (var j = 0; j < steps.length; j++) out.v[+f[0]][+steps[j]] = 1;
    }
    var ac = r[3 + sel.bar * 2].split(".");
    for (var a = 0; a < ac.length; a++) out.acc[+ac[a]] = 1;
    return out;
  });
}
function rhythmState(v) {
  var ab = raw(v, "rhy_ab", 0) >= 1 ? 1 : 0, b1 = Math.round(raw(v, "rhy_style", 11)), b2 = Math.round(raw(v, "rhy_style2", 0)) - 1;
  return { play: raw(v, "rhy_mode", 0) >= 1, ab: ab, b1: b1, b2: b2, s1: resolve(b1, ab), s2: resolve(b2, ab) };
}
function rhythmName(st) {
  if (!st.s1) return "--";
  var n = upper(RHY[st.s1.p][1]);
  if (!BTN[st.b1] || BTN[st.b1][2] === BTN[st.b1][3]) n += " " + (st.ab ? "B" : "A");
  if (st.s2) n += " + " + upper(RHY[st.s2.p][1]);
  return n;
}
// a cap: the group's colour, lit (white rim, its lamp) when chosen
function cap(g, x, y, w, h, i, lit, second, label) {
  var c = CAPS[i < 0 ? "c" : BTN[i][1]];
  g.fill(x, y, w, h, lit || second ? c : PANEL2);
  if (!lit && !second) g.fill(x, y, 3, h, c);
  if (lit) { g.fill(x - 2, y - 2, w + 4, 2, "#ffffff"); g.fill(x - 2, y + h, w + 4, 2, "#ffffff"); g.fill(x - 2, y, 2, h, "#ffffff"); g.fill(x + w, y, 2, h, "#ffffff"); }
  else if (second) { g.fill(x - 2, y + h, w + 4, 2, AMBER); }
  g.text(x + w / 2 + 1, y + h - 3, label, lit || second ? INK : CREAM2, 0, w + 6);
}

// ---- PANEL ------------------------------------------------------------------------------
var COLW = 36, VX = 20, SL_TOP = 58, SL_BOT = 96, RX = 546;
function panelGround(g, v) {
  g.fill(0, 0, 960, 160, PANEL);
  wood(g, 0, 160); wood(g, 948, 160);
  g.value(22, 17, "CW-78", CREAM, -1);
  // the voice section: a plate a voice, its two trim pots, its slider's slot and scale
  for (var i = 0; i < NV; i++) {
    var cx = VX + i * COLW + COLW / 2;
    if (i) g.fill(VX + i * COLW, 26, 1, 74, "#24221f");
    g.fill(cx - 12, 25, 24, 11, "#2f2c28");
    g.text(cx + 2, 34, V[i][1], CREAM, 0);
    knobBody(g, cx - 8, 46, 5.5); knobBody(g, cx + 8, 46, 5.5);
    g.fill(cx - 1, SL_TOP, 3, SL_BOT - SL_TOP, "#050505");
    for (var q = 0; q <= 4; q++) g.fill(cx - 10, SL_TOP + 3 + q * (SL_BOT - SL_TOP - 6) / 4, 5, 1, q === 2 ? CREAM2 : RULE);
  }
  // the rhythm section: the display plate, the buttons
  g.fill(RX - 12, 24, 1, 76, RULE);
  g.fill(RX, 24, 394, 22, CREAM);
  g.text(RX + 6, 33, "RHYTHM", INK, -1);
  g.text(RX + 6, 43, "SELECT", INK, -1);
  g.text(RX + 334, 39, "A", INK, 0); g.text(RX + 382, 39, "B", INK, 0);
  g.fill(RX + 342, 33, 32, 5, "#2a2824");
}
function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", st = rhythmState(v), hit = strikes(v);
  g.layer("cw78|" + kn.join(",") + "|" + st.b1 + "|" + st.b2 + "|" + st.ab + "|" + (v.$segmode || ""), function () { panelGround(g, v); encoderGround(g, v); caps(g, RX, 51, 64, 14, 2.4, st); });
  var onPage = {};
  for (var c = 0; c < 8; c++) if (kn[c]) onPage[kn[c]] = c + 1;
  for (var i = 0; i < NV; i++) {
    var id = V[i][0], cx = VX + i * COLW + COLW / 2, m = muted(v, i), drv = raw(v, id + "_drive", 0);
    // the lamp: lit as a note strikes the voice
    var lit = !m && hit[i] >= 0 && hit[i] < 0.12;
    g.dot(cx - 9, 30, 2, m ? "#5a5a5a" : lampColor(hit[i]));
    if (lit) { g.fill(cx - 12, 25, 24, 11, LAMP); g.text(cx + 2, 34, V[i][1], INK, 0); }
    // tune and decay: the two trim pots
    var tk = id + "_tune", dk = id + "_decay";
    if (known(v, tk)) pointer(g, cx - 8, 46, 5.5, v[tk].frac, t === tk ? "slot" : "#ffffff", 1.5);
    if (known(v, dk)) pointer(g, cx + 8, 46, 5.5, v[dk].frac, t === dk ? "slot" : "#ffffff", 1.5);
    // the level slider: its cap where the level stands (unity is the middle mark)
    var lk = id + "_level", f = frac(v, lk, 0.5), y = SL_BOT - 4 - f * (SL_BOT - SL_TOP - 8), hot = t === lk;
    g.fill(cx - 8, y - 4, 17, 8, m ? "#4a4741" : (hot ? "slot" : CREAM));
    g.fill(cx - 8, y, 17, 1, INK);
    if (m) g.text(cx + 1, y + 3, "M", LAMP, 0);
    // drive: the initial of its curve, in red, by the slider
    if (drv > 0) g.text(cx + 13, SL_TOP + 8, DIST[Math.max(0, Math.min(6, Math.round(raw(v, id + "_dist_type", 0))))].charAt(0), LAMP, 0);
    if (onPage[lk]) g.fill(cx - 12, 99, 25, 2, hot ? "slot" : CREAM2);
  }
  // the segment the encoders play: its plates lit (the rhythm: its legend in the slot colour);
  // Pung's bar stands above it
  var sg = v.$segmode === "segment" ? v.$segment : "";
  if (sg) {
    var sm = /^v(\d)$/.exec(sg);
    if (sm) {
      var a = +sm[1] * 2;
      for (var q = a; q < a + 2; q++) { var qx = VX + q * COLW + COLW / 2; g.fill(qx - 12, 25, 24, 11, CREAM); g.text(qx + 2, 34, V[q][1], INK, 0); }
    } else if (sg === "rhythm") { g.text(RX + 6, 33, "RHYTHM", "slot", -1); g.text(RX + 6, 43, "SELECT", "slot", -1); }
  }
  // the rhythm: what plays, its lamp (it flashes on Live's beat while it plays), the lever
  var L = v.$live || {};
  g.value(RX + 58, 41, rhythmName(st), INK, -1, 200);
  var beat = st.play && L.known && L.playing && typeof L.beat === "number";
  var flash = beat && (L.beat - Math.floor(L.beat)) < 0.18;
  g.dot(RX + 274, 35, 5, flash ? LAMP : (st.play ? LAMP_MID : "#8d8370"));
  g.text(RX + 283, 39, st.play ? "PLAY" : "OFF", t === "rhy_mode" ? "slot" : INK, -1);
  g.fill(RX + (st.ab ? 358 : 342), 30, 16, 11, t === "rhy_ab" ? "slot" : INK);
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(940, 15, upper(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, CREAM2, 1);
  encoderRow(g, v);
}
var LEVELS = [], ALLK = ["rhy_mode", "rhy_ab", "rhy_style", "rhy_style2", "mutes", "note_map", "sd_snappy", "gu_rate"];
for (var li = 0; li < NV; li++) {
  LEVELS.push(V[li][0] + "_level");
  ALLK.push(V[li][0] + "_tune", V[li][0] + "_decay", V[li][0] + "_drive", V[li][0] + "_dist_type", V[li][0] + "_level");
}
var SEGS = [];
for (var sp = 0; sp < 7; sp++) {
  var va = V[sp * 2][0], vb = V[sp * 2 + 1][0];
  SEGS.push({ id: "v" + sp, label: V[sp * 2][1] + " " + V[sp * 2 + 1][1], rect: [VX + sp * 2 * COLW, 23, 2 * COLW, 80],
    keys: [va + "_tune", va + "_decay", va + "_drive", va + "_level", vb + "_tune", vb + "_decay", vb + "_drive", vb + "_level"] });
}
SEGS.push({ id: "rhythm", label: "Rhythm", rect: [RX - 4, 21, 402, 80], keys: ["rhy_mode", "rhy_style", "rhy_ab", "rhy_style2"] });
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [
    { label: "Levels 1", keys: LEVELS.slice(0, 8) },
    { label: "Levels 2", keys: LEVELS.slice(8).concat(["volume", "comp"]) },
    { label: "Master", keys: ["volume", "master_dist", "master_drive", "comp", "vel_depth", "hat_choke", "note_map"] }
  ],
  // segments: the voices two by two (tune, decay, drive, level each), and the rhythm plate
  segments: SEGS,
  draws_segments: true,
  extra_keys: ALLK,
  screen: panel
});

// ---- VOICES: a page a voice ------------------------------------------------------------------
function band(g) { g.fill(0, 0, 4, g.h, WOOD); g.fill(948, 0, 4, g.h, WOOD); }
function kitStrip(g, v, sel, hit) {
  // the kit, small: every voice's lamp, its plate, its level; the one the knobs edit boxed
  for (var i = 0; i < NV; i++) {
    var x = 10 + i * 17, f = frac(v, V[i][0] + "_level", 0.5), m = muted(v, i), on = i === sel;
    if (on) g.fill(x - 1, 4, 16, 80, "#2f2c28");
    g.dot(x + 7, 10, 2.5, m ? "#5a5a5a" : lampColor(hit[i]));
    g.fill(x + 6, 22, 3, 46, "#050505");
    var y = 64 - f * 40;
    g.fill(x + 1, y, 13, 5, m ? "#55524b" : (on ? "slot" : CREAM2));
    g.text(x + 7, 81, V[i][1], on ? "fg" : (m ? "faint" : "dim"), 0);
  }
}
function distCurve(g, x, y, s, P, hot) {
  g.fill(x, y, s, s, "#000000");
  g.line(x, y + s / 2, x + s, y + s / 2, 1, "line"); g.line(x + s / 2, y, x + s / 2, y + s, 1, "line");
  var pts = cached("dc|" + P.type + "|" + P.drive.toFixed(2) + "|" + x, function () {
    var out = [];
    for (var j = 0; j <= 40; j++) {
      var xi = j / 20 - 1, yo = Math.max(-1, Math.min(1, shape(xi, P.drive, P.type) * 1.0));
      out.push(x + 2 + (s - 4) * j / 40, y + s / 2 - yo * (s / 2 - 2));
    }
    return out;
  });
  g.poly(pts, 2, hot ? "slot" : (P.drive > 0.01 ? LAMP : "dim"));
}
function sendBar(g, x, y, w, label, k, v, t) {
  var f = frac(v, k, 0), on = known(v, k), hot = t === k;
  g.text(x, y, label, hot ? "fg" : "dim", -1);
  g.fill(x + 34, y - 6, w - 34, 4, "line");
  if (on && f > 0) g.fill(x + 34, y - 6, Math.max(2, Math.round((w - 34) * f)), 4, hot ? "slot" : CREAM);
}
function voicePage(i) {
  var id = V[i][0], keys = [id + "_tune", id + "_decay"];
  if (id === "sd") keys.push("sd_snappy");
  if (id === "gu") keys.push("gu_rate");
  keys.push(id + "_drive", id + "_dist_type", id + "_level");
  if (id !== "bd") keys.push(id + "_rev", id + "_dly");
  return { label: V[i][2].replace("METAL BEAT", "METAL").replace("TAMBOURINE", "TAMB").replace("HIGH ", "HI ").toLowerCase().replace(/(^| )(\w)/g, function (m) { return m.toUpperCase(); }), keys: keys };
}
var VPAGES = [];
for (var vp = 0; vp < NV; vp++) VPAGES.push(voicePage(vp));
push.compartment({
  id: "voices", label: "Voices",
  pages: VPAGES,
  extra_keys: ALLK,
  screen: function (g, v) {
    band(g);
    var i = Math.max(0, Math.min(NV - 1, v.$page || 0)), id = V[i][0], t = v.$touched || "", hit = strikes(v);
    kitStrip(g, v, i, hit);
    var P = voiceParams(v, i), x = 262, w = 440, y = 18, h = 58;
    // the strike: the voice's sound as its circuit rings, at its pitch, ring time and drive
    var win = Math.max(0.012, Math.min(1.6, P.T * 1.25));
    if (V[i][3] === "snare") win = Math.max(win, 0.06);
    if (V[i][3] === "guiro") win = Math.max(win, 0.08);
    g.text(x, 11, V[i][2], hit[i] >= 0 && hit[i] < 0.15 ? LAMP : "fg", -1);
    g.text(x + g.measure(V[i][2]) + 10, 11, V[i][5] + (V[i][4] ? "  " + Math.round(P.f) + " HZ" : ""), "dim", -1, 250);
    g.fill(x, y + h / 2, w, 1, "line");
    var key = [i, P.f.toFixed(1), P.T.toFixed(4), P.snap.toFixed(2), P.rate.toFixed(2), P.drive.toFixed(2), P.type, P.level.toFixed(2)].join("|");
    var tb = cached("s|" + key, function () { return scope(i, P, x, y, w, h, win); });
    var col = muted(v, i) ? "faint" : (t === id + "_tune" || t === id + "_decay" || t === "sd_snappy" || t === "gu_rate" ? "slot" : CREAM);
    g.area(tb[0], y + h / 2, col); g.area(tb[1], y + h / 2, col);
    // the time it rings, on its axis
    g.text(x, 84, "0", "faint", -1);
    g.text(x + w, 84, secText(win), "faint", 1);
    var tx = x + Math.min(w - 2, w * P.T / win), dh = t === id + "_decay";
    g.fill(tx, y + 4, 1, h - 4, dh ? "slot" : "line");
    var rt = "RING " + secText(P.T), rw = g.measure(rt);
    g.text(tx + rw + 8 < x + w - 50 ? tx + 4 : tx - 4, 84, rt, dh ? "slot" : "dim", tx + rw + 8 < x + w - 50 ? -1 : 1);
    var tt = "TUNE " + tuneText(i, raw(v, id + "_tune", 64));
    g.text(x + w, 11, tt, t === id + "_tune" ? "slot" : "dim", 1);
    if (muted(v, i)) g.text(x + w - 4, 28, "MUTED", LAMP, 1);
    // the distortion: its curve at the drive, and the sends
    var dx = 720, dhot = t === id + "_drive" || t === id + "_dist_type";
    distCurve(g, dx, 16, 64, P, dhot);
    g.text(dx + 74, 24, P.drive > 0.01 ? DIST[P.type] : "NO DRIVE", dhot ? "slot" : (P.drive > 0.01 ? LAMP : "dim"), -1);
    g.text(dx + 74, 36, P.drive > 0.01 ? "DRIVE " + P.drive.toFixed(1) : "DRY: OUT OF THE PATH", "dim", -1, 150);
    if (id === "bd") g.text(dx + 74, 72, "THE KICK STAYS DRY", "faint", -1);
    else { sendBar(g, dx + 74, 62, 150, "REV", id + "_rev", v, t); sendBar(g, dx + 74, 76, 150, "DLY", id + "_dly", v, t); }
  }
});

// ---- RHYTHM: the buttons and the pattern they play -------------------------------------------------
push.compartment({
  id: "rhythm", label: "Rhythm",
  pages: [{ label: "Rhythm", keys: ["rhy_mode", "rhy_style", "rhy_ab", "rhy_style2"] }],
  extra_keys: ["mutes", "note_map"],
  screen: function (g, v) {
    band(g);
    var st = rhythmState(v), t = v.$touched || "", L = v.$live || {};
    // the buttons
    caps(g, 12, 20, 64, 16, 2, st);
    g.text(12, 12, st.play ? "PLAYING WHILE LIVE PLAYS" : "MODE OFF: THE RHYTHM IS SILENT", t === "rhy_mode" ? "slot" : (st.play ? "fg" : "dim"), -1);
    g.text(12, 84, "LEVER " + (st.ab ? "B" : "A"), t === "rhy_ab" ? "slot" : "dim", -1);
    g.text(80, 84, st.s2 ? "+ " + upper(BTN[st.b2][0]) + " (RHYTHM 2)" : "RHYTHM 2 OFF", t === "rhy_style2" ? "slot" : (st.s2 ? AMBER : "faint"), -1, 290);
    // the pattern: a row a voice it uses, the machine's 48 steps (12 a beat)
    if (!st.s1) return;
    var A = bar(st.s1), B = st.s2 ? bar(st.s2) : null, n = Math.max(A.n, B ? B.n : 0), rows = [];
    for (var vi = 0; vi < NV; vi++) if (A.v[vi] || (B && B.v[vi])) rows.push(vi);
    var gx = 438, gw = 500, gy = 16, gh = 68, rh = Math.min(12, gh / (rows.length + 1)), sw = gw / n;
    g.text(gx, 10, upper(A.name) + (BTN[st.b1][2] === BTN[st.b1][3] ? " " + (st.ab ? "B" : "A") : "") + (B ? " + " + upper(B.name) : ""), t === "rhy_style" ? "slot" : "fg", -1, 300);
    g.text(gx + gw, 10, n === 36 ? "3/4" : "4/4", "dim", 1);
    for (var s = 0; s <= n; s += 12) g.fill(gx + s * sw, gy, 1, rows.length * rh + rh, s % (n) === 0 ? "dim" : "line");
    for (var r = 0; r < rows.length; r++) {
      var yy = gy + r * rh, id = rows[r];
      g.text(gx - 6, yy + rh - 2, V[id][1], muted(v, id) ? "faint" : "dim", 1);
      for (var q = 0; q < n; q++) {
        var a = A.v[id] && A.v[id][q % A.n], bb = B && B.v[id] && B.v[id][q % B.n];
        if (!a && !bb) continue;
        g.fill(gx + q * sw + 1, yy + 2, Math.max(3, sw * 2 - 2), rh - 4, muted(v, id) ? "#55524b" : (a ? CREAM : AMBER));
      }
    }
    // the accent line (one control voltage for the whole machine)
    var ay = gy + rows.length * rh;
    g.text(gx - 6, ay + rh - 2, "ACC", "faint", 1);
    for (var c = 0; c < n; c++) if (A.acc[c % A.n] || (B && B.acc[c % B.n])) g.dot(gx + c * sw + sw, ay + rh / 2, 2.5, LAMP);
    // the playhead: the module plays its step from Live's beat (12 ticks a beat)
    if (st.play && L.known && L.playing && typeof L.beat === "number") {
      var tick = Math.floor(L.beat * 12) % n;
      if (tick < 0) tick += n;
      var px = gx + tick * sw + sw / 2;
      g.fill(px, gy - 2, 2, rows.length * rh + rh + 2, "mod");
    }
  }
});

// ---- EFFECTS: who is sent where, and the echoes ------------------------------------------------------
function beatsOf(s) { // a note value: "1/8." -> 0.75 beats
  var m = /1\/(\d+)(T|\.)?/.exec(s || "");
  if (!m) return 0.75;
  var b = 4 / +m[1];
  if (m[2] === "T") b *= 2 / 3; else if (m[2] === ".") b *= 1.5;
  return b;
}
var SENDS_R = [], SENDS_D = [];
for (var si = 1; si < NV; si++) { SENDS_R.push(V[si][0] + "_rev"); SENDS_D.push(V[si][0] + "_dly"); }
push.compartment({
  id: "fx", label: "Effects",
  pages: [
    { label: "Reverb", keys: ["rev_decay", "rev_tone", "rev_hpf", "rev_level"] },
    { label: "Delay", keys: ["dly_time", "dly_fdbk", "dly_tone", "dly_hpf", "dly_level"] },
    { label: "Rev Sends", keys: SENDS_R.slice(0, 8) },
    { label: "Rev Sends 2", keys: SENDS_R.slice(8) },
    { label: "Dly Sends", keys: SENDS_D.slice(0, 8) },
    { label: "Dly Sends 2", keys: SENDS_D.slice(8) }
  ],
  extra_keys: ["mutes", "note_map"],
  screen: function (g, v) {
    band(g);
    var t = v.$touched || "", hit = strikes(v);
    // the sends: a column a voice, a row a bus, a disc as large as the send
    var x0 = 70, cw = 33;
    g.text(14, 44, "REVERB", t.indexOf("rev_") === 0 || /_rev$/.test(t) ? "fg" : "dim", -1);
    g.text(14, 72, "DELAY", t.indexOf("dly_") === 0 || /_dly$/.test(t) ? "fg" : "dim", -1);
    for (var i = 0; i < NV; i++) {
      var cx = x0 + i * cw + cw / 2, id = V[i][0];
      g.dot(cx, 8, 2.5, lampColor(hit[i]));
      g.text(cx, 24, V[i][1], muted(v, i) ? "faint" : "dim", 0);
      if (i === 0) { g.text(cx, 44, "DRY", "faint", 0); g.text(cx, 72, "DRY", "faint", 0); continue; }
      var rows = [[id + "_rev", 40], [id + "_dly", 68]];
      for (var r = 0; r < 2; r++) {
        var k = rows[r][0], f = frac(v, k, 0), hot = t === k;
        g.dot(cx, rows[r][1], 1.5, "line");
        if (known(v, k) && f > 0.004) g.dot(cx, rows[r][1], 2 + f * 9, hot ? "slot" : CREAM);
        else if (hot) g.arc(cx, rows[r][1], 6, 0, Math.PI * 2, 1.5, "slot");
      }
    }
    // the delay: its echoes on the beat, each one fed back
    var ex = 560, ew = 380, ey = 14, eh = 44, beats = 2;
    g.fill(ex - 14, 4, 1, 78, "line");
    var dv = disp(v, "dly_time"), bt = beatsOf(dv), fb = raw(v, "dly_fdbk", 52) / 127 * 0.85, lv = raw(v, "dly_level", 85) / 127;
    var dhot = t.indexOf("dly_") === 0;
    g.text(ex, 10, "DELAY " + (dv || "--") + "  ON THE BEAT", dhot ? "fg" : "dim", -1);
    for (var b = 0; b <= beats * 4; b++) g.fill(ex + ew * b / (beats * 4), ey + eh - (b % 4 ? 4 : 10), 1, b % 4 ? 4 : 10, b % 4 ? "line" : "dim");
    g.fill(ex, ey + eh, ew, 1, "line");
    g.fill(ex, ey + 4, 3, eh - 4, "dim");
    var a = lv, x = bt;
    while (x <= beats && a > 0.02) {
      var hx = ex + ew * x / beats, hh = Math.max(2, (eh - 4) * Math.min(1, a));
      g.fill(hx - 1, ey + eh - hh, 3, hh, t === "dly_time" || t === "dly_fdbk" || t === "dly_level" ? "slot" : CREAM);
      a *= fb; x += bt;
    }
    // the reverb, in its own words
    var rhot = t.indexOf("rev_") === 0;
    var dec = 0.2 + raw(v, "rev_decay", 73) / 127 * 0.73, hpf = 30 * Math.pow(800 / 30, raw(v, "rev_hpf", 62) / 127);
    g.text(ex, 76, "REVERB  DECAY " + Math.round(dec * 100) + "%   HPF " + Math.round(hpf) + " HZ   LEVEL " + Math.round(raw(v, "rev_level", 85) / 127 * 120) + "%", rhot ? "fg" : "dim", -1, 390);
  }
});
