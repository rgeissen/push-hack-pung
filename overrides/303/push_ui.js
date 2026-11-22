// 303 (Open303 with the Devilfish modifications and a Soft/RAT drive) on Push.
// An overlay shipped with Pung (the module ships no push_ui.js).
//
// The instrument is its silver panel: one row of knobs, a waveform switch,
// and what makes it sing, the accent, the slide and an envelope that sweeps
// a resonant filter. The compartments are the module's own sections:
//
//   PANEL      the front panel: the knob row on the encoders, in the 303's
//              order (WAVEFORM, TUNING, CUT OFF FREQ, RESONANCE, ENV MOD,
//              DECAY, ACCENT, VOLUME), each value in the engine's own units.
//              Over each its window: the oscillator's wave and the A it is
//              tuned to; the note keys with the ACCENT and SLIDE lamps (lit
//              by the notes as the engine reads them: velocity 100 and up
//              accents, a key pressed before the last is let go slides); the
//              filter where it sounds, with how far the envelope and the
//              accent sweep it; the filter envelope (Pung's, running on the
//              engine's times); what an accent adds; what leaves (the drive,
//              the level as it sounds).
//   DEVILFISH  the modification: the filter envelope, the VCA and the accent
//              envelope side by side, the slide, the feedback highpass and
//              the square the shaper makes. Off, the stock 303's fixed
//              values are drawn, and the knobs wait.
//   DRIVE      the stage after the synth: the clipping curve of the model,
//              and the 303's wave before and after it, at the mix.
//
// The engine's units (src/dsp/plugin.cpp): cutoff 314..2394 Hz (exp),
// decay 200..2000 ms (30..3000 with the Devilfish), tuning A = 400..480 Hz,
// volume -60..0 dB; Devilfish: amp and accent decay 30..3000 ms, feedback
// highpass 350..100 Hz (exp), soft attack 0.3..3000 ms (exp), slide 2..360
// ms, shaper drive 25..80 dB. Stock: amp decay 1230 ms, accent decay 200 ms,
// highpass 150 Hz, attack 3 ms, slide 60 ms, shaper 36.9 dB.

// ---- the panel's colours ---------------------------------------------------------------
var SILVER = "#c2c4c0", SILVER_LO = "#a6a8a4", RULE = "#7e807c", INK = "#141414", INK_DIM = "#4e504c";
var WIN = "#0b0b0b", WIN_EDGE = "#5c5e5a", PRINT = "#e4e4df", PRINT_DIM = "#8b8c88", PRINT_FAINT = "#3a3b39";
var RED = "#ff2a17", RED_OFF = "#6b2a22", KNOB = "#1a1a1a", KEY = "#ecece7", CURVE = "#deded8";

// ---- values -----------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? Math.max(0, Math.min(1, v[k].frac)) : d; }
// an enum's second option: the module answers "1" or the option's name
function second(v, k, name) {
  if (!known(v, k)) return false;
  var s = String(v[k].value).toLowerCase(), d = String(v[k].display || "").toLowerCase();
  return s === "1" || s.indexOf(name) === 0 || d.indexOf(name) === 0;
}
function devil(v) { return second(v, "devil_mod_switch", "on"); }
function square(v) { return second(v, "waveform", "sq"); }
function rat(v) { return second(v, "drive_model", "rat"); }

// the engine's own mappings (linToExp, linToLin)
function expMap(f, a, b) { return a * Math.pow(b / a, f); }
function cutHz(f) { return expMap(f, 314, 2394); }
function decayMs(f, dv) { return dv ? expMap(f, 30, 3000) : expMap(f, 200, 2000); }
function linMs(f) { return 30 + 2970 * f; }
function hpfHz(f) { return expMap(f, 350, 100); }
function attackMs(f) { return expMap(f, 0.3, 3000); }
function slideMs(f) { return 2 + 358 * f; }
function shaperDb(f) { return 25 + 55 * f; }
var STOCK = { amp: 1230, accent: 200, hpf: 150, attack: 3, slide: 60, shaper: 36.9 };

function fmtMs(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(ms >= 9950 ? 0 : 2) + " s";
  if (ms >= 100) return Math.round(ms) + " ms";
  if (ms >= 10) return ms.toFixed(0) + " ms";
  return ms.toFixed(1) + " ms";
}
function fmtHz(h) { return h >= 1000 ? (h / 1000).toFixed(2) + " kHz" : Math.round(h) + " Hz"; }
function pct(f) { return Math.round(f * 100) + "%"; }
function signed(n, unit) { return (n > 0 ? "+" : "") + n + unit; }

// what an encoder shows: the engine's value in its unit ("" when unread)
function shown(v, k) {
  if (!known(v, k)) return "--";
  var f = fr(v, k, 0), dv = devil(v);
  switch (k) {
  case "waveform": return square(v) ? "Square" : "Saw";
  case "tuning": return signed(Math.round(1200 * Math.log(tuneHz(f) / 440) / Math.LN2), " ct");
  case "cutoff": return fmtHz(cutHz(f));
  case "decay": return fmtMs(decayMs(f, dv));
  case "volume": return f <= 0 ? "-inf dB" : Math.round(-60 + 60 * f) + " dB";
  case "devil_mod_switch": return dv ? "On" : "Off";
  case "normal_decay": case "accent_decay": return fmtMs(linMs(f));
  case "feedback_hpf": return Math.round(hpfHz(f)) + " Hz";
  case "soft_attack": return fmtMs(attackMs(f));
  case "slide_time": return fmtMs(slideMs(f));
  case "tanh_shaper_drive": return shaperDb(f).toFixed(1) + " dB";
  case "drive_model": return rat(v) ? "RAT" : "Soft";
  }
  return pct(f);
}
function tuneHz(f) { return 400 + 80 * f; }

// how the values read wherever Pung writes one (the row under the band
// screens, the web page): the engine's units. DECAY is left to Pung: its
// range depends on the Devilfish switch, which a single value cannot know.
var UNITS = { tuning: 1, cutoff: 1, volume: 1, normal_decay: 1, accent_decay: 1, feedback_hpf: 1, soft_attack: 1, slide_time: 1,
  tanh_shaper_drive: 1, resonance: 1, env_mod: 1, accent: 1, drive: 1, drive_mix: 1 };
push.display(function (key, raw) {
  var f = parseFloat(raw);
  if (!UNITS[key] || isNaN(f)) return;
  var v = {}; v[key] = { known: true, frac: Math.max(0, Math.min(1, f)), value: raw };
  return shown(v, key);
});

// ---- small parts ------------------------------------------------------------------------
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
function win(g, x, y, w, h) { g.fill(x - 1, y - 1, w + 2, h + 2, WIN_EDGE); g.fill(x, y, w, h, WIN); }
function lamp(g, x, y, on) { g.dot(x, y, 3.2, on ? RED : RED_OFF); }

// one cycle of the 303's oscillator as it leaves the engine (Open303's
// tables, turned over by getSample): the saw falls; the square is the ramp
// pushed through a tanh at the shaper's drive, its width set by the drive
// (the ramp is cut at -4.37 / k)
function osc303(ph, sq, k) {
  var p = ph - Math.floor(ph), s = p < 0.5 ? 2 * p : 2 * p - 2;
  if (!sq) return -s;
  return Math.tanh(k * s + 4.37);
}
function wavePts(x, y, w, h, cycles, sq, db) {
  var k = Math.pow(10, db / 20), pts = [], mid = y + h / 2, a = h / 2, prev = null, n = 96;
  for (var i = 0; i <= n; i++) {
    var s = osc303(cycles * Math.min(i / n, 0.99999), sq, k), yy = mid - s * a;
    if (prev !== null && Math.abs(yy - prev) > a * 0.6) pts.push(x + w * i / n, prev); // an edge stands upright
    pts.push(x + w * i / n, yy);
    prev = yy;
  }
  return pts;
}

// the knob of the panel: a black cap with its white line, the printed scale
// around it (eleven marks, 7 to 5 o'clock)
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
function knobBody(g, cx, cy, r) {
  for (var i = 0; i <= 10; i++) {
    var a = A0 + SWEEP * i / 10, r1 = r + 3, r2 = r + (i % 5 === 0 ? 7 : 5);
    g.line(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, 1, INK_DIM);
  }
  g.dot(cx, cy, r, KNOB);
}
function knobPointer(g, cx, cy, r, f, hot, unknown) {
  if (hot) g.arc(cx, cy, r + 2.5, 0, Math.PI * 2, 2, "slot");
  if (unknown) return;
  var a = A0 + SWEEP * f;
  g.line(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, hot ? "slot" : "#f4f4f0");
}

// ---- the knob row: the encoders, as the 303's own row ----------------------------------
// Drawn from v.$knobs: the page's keys, or a segment's. While segment mode is
// on, Pung names the segments in the bottom 18 pixels: the row is tighter and
// ends above y 142.
var ROW = 104;
var LEGEND = { waveform: "WAVEFORM", tuning: "TUNING", cutoff: "CUT OFF FREQ", resonance: "RESONANCE", env_mod: "ENV MOD",
  decay: "DECAY", accent: "ACCENT", volume: "VOLUME", devil_mod_switch: "DEVILFISH", soft_attack: "SOFT ATTACK",
  normal_decay: "VCA DECAY", accent_decay: "ACCENT DECAY", feedback_hpf: "FEEDBACK HPF", slide_time: "SLIDE TIME",
  tanh_shaper_drive: "SHAPER DRIVE", drive_model: "DRIVE MODEL", drive: "DRIVE", drive_mix: "DRIVE MIX" };
var SWITCHES = { waveform: 1, devil_mod_switch: 1, drive_model: 1 };
function legend(v, k) { return LEGEND[k] || (v[k] && v[k].name ? String(v[k].name).toUpperCase() : k.toUpperCase()); }
function rowGeo(tight) {
  return tight ? { name: ROW + 13, cy: ROW + 27, r: 8, val: ROW + 33, sw: ROW + 18, swh: 20, rule: 28 }
    : { name: ROW + 16, cy: ROW + 36, r: 11, val: ROW + 43, sw: ROW + 22, swh: 30, rule: 44 };
}
// a lever switch where the panel has one (SAW over SQUARE, OFF over ON)
function switchBody(g, x, y, h) {
  g.fill(x, y, 14, h, KNOB);
  g.fill(x + 3, y + 3, 8, h - 6, "#2e2e2e");
}
// the row's ground, legends and bodies (the layer: they change with the keys)
function rowGround(g, v, keys, tight) {
  var G = rowGeo(tight);
  g.fill(0, ROW, 960, 160 - ROW, SILVER);
  g.fill(0, ROW, 960, 2, RULE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, ROW + 8, 1, G.rule, SILVER_LO);
  for (var i = 0; i < 8; i++) {
    var k = keys[i], x = i * 120;
    if (!k) continue;
    g.text(x + 60, G.name, legend(v, k), INK, 0, 112);
    if (SWITCHES[k]) switchBody(g, x + 23, G.sw, G.swh);
    else knobBody(g, x + 30, G.cy, G.r);
  }
}
function rowValues(g, v, keys, tight) {
  var t = v.$touched || "", G = rowGeo(tight);
  for (var i = 0; i < 8; i++) {
    var k = keys[i], x = i * 120;
    if (!k) continue;
    var hot = t === k, kn = known(v, k);
    if (hot) { // the touched legend, reversed out of the slot colour
      g.fill(x + 6, G.name - 10, 108, 13, "slot");
      g.text(x + 60, G.name, legend(v, k), INK, 0, 104);
    }
    if (SWITCHES[k]) {
      if (kn) {
        var on = second(v, k, "sq") || second(v, k, "rat") || second(v, k, "on");
        g.fill(x + 26, on ? G.sw + G.swh - 12 : G.sw + 3, 8, 9, hot ? "slot" : "#f4f4f0");
      }
      if (hot) box(g, x + 21, G.sw - 2, 18, G.swh + 4, "slot");
    } else {
      knobPointer(g, x + 30, G.cy, G.r, fr(v, k, 0), hot, !kn);
    }
    g.value(x + 52, G.val, shown(v, k), kn ? INK : INK_DIM, -1, 64);
  }
}

// ---- the notes, as the engine reads them -----------------------------------------------
// the newest held note (else the last let go, for a moment); it slid when a
// key was still down as it began; it is accented from velocity 100
function playing(v) {
  var L = v.$live;
  if (!L || !L.known || !L.voices) return null;
  var cur = null, held = 0, i, x;
  for (i = 0; i < L.voices.length; i++) {
    x = L.voices[i];
    if (x.held) { held++; if (!cur || !cur.held || x.age < cur.age) cur = x; }
  }
  if (!cur) {
    for (i = 0; i < L.voices.length; i++) {
      x = L.voices[i];
      if (x.released >= 0 && x.released < 0.25 && (!cur || x.released < cur.released)) cur = x;
    }
  }
  if (!cur) return null;
  return { note: cur.note, accent: cur.vel >= 100, slide: cur.held && held > 1 };
}
var NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK = [1, 3, -1, 6, 8, 10];
function keyRect(pc) { // the 303's note keys: C to C, the sharps above
  var wi = WHITE.indexOf(pc);
  if (wi >= 0) return [KX + wi * KW, KY + 15, KW - 3, 15];
  var bi = BLACK.indexOf(pc);
  return [KX + bi * KW + KW / 2 + 1, KY, KW - 5, 12];
}
var KX = 10, KY = 67, KW = 19;
function keysGround(g) {
  for (var pc = 0; pc < 12; pc++) {
    var r = keyRect(pc);
    g.fill(r[0], r[1], r[2], r[3], WHITE.indexOf(pc) >= 0 ? KEY : KNOB);
    if (WHITE.indexOf(pc) >= 0) box(g, r[0], r[1], r[2], r[3], INK_DIM);
  }
  g.fill(KX + 7 * KW, KY + 15, KW - 3, 15, KEY); box(g, KX + 7 * KW, KY + 15, KW - 3, 15, INK_DIM); // the upper C
  g.text(KX + 8 * KW + 8, KY + 10, "ACCENT", INK, -1);
  g.text(KX + 8 * KW + 8, KY + 27, "SLIDE", INK, -1);
}
function keysLive(g, v) {
  var p = playing(v);
  lamp(g, KX + 8 * KW + 1, KY + 6, !!(p && p.accent));
  lamp(g, KX + 8 * KW + 1, KY + 23, !!(p && p.slide));
  if (!p) return;
  var r = keyRect(p.note % 12);
  g.fill(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4, RED);
  g.text(KX + 8 * KW + 62, KY + 27, NAMES[p.note % 12] + (Math.floor(p.note / 12) - 1), INK, -1);
}

// ---- where the envelope and the accent take the cutoff ---------------------------------
// Open303 (calculateEnvModScalerAndOffset, getSample): the envelope moves
// the cutoff from 2^(-s*o) to 2^(s*(1-o)) of the knob's, s and o measured
// off the hardware; an accent adds up to its amount in octaves.
// Everything stands where it sounds, on Pung's filter axis: 20 Hz to 20 kHz
// over three decades (a frequency's place is log10(f / 20) / 3). The cutoff
// stands at that place (g.filter's at), not at the knob's travel (which
// would put 314 Hz at 20 Hz); the key keeps the live spectrum behind it.
function place(hz) { return Math.log(hz / 20) / Math.LN10 / 3; }
var OCT = 1 / (3 * Math.log(10) / Math.LN2); // one octave on that axis
function sweep(v) {
  var e = fr(v, "env_mod", 0.5), c = fr(v, "cutoff", 0.5), a = fr(v, "accent", 0.5), p = place(cutHz(c));
  var s = (1 - c) * (3.774 * e + 0.737) + c * (4.195 * e + 0.864), o = 0.0483 * c + 0.2944;
  return { cut: p, lo: p - s * o * OCT, hi: p + s * (1 - o) * OCT, acc: p + (s * (1 - o) + a) * OCT,
    hiHz: cutHz(c) * Math.pow(2, s * (1 - o)), accHz: cutHz(c) * Math.pow(2, s * (1 - o) + a) };
}
// the sweep, under the curve
function sweepBar(g, x, w, y, v, hotEnv, hotAcc) {
  var sw = sweep(v), x0 = x + 6, x1 = x + w - 6;
  function X(f) { return x0 + (x1 - x0) * Math.max(0, Math.min(1, f)); }
  var a = X(sw.lo), b = X(sw.hi), c = X(sw.acc);
  g.fill(b, y, Math.max(2, c - b), 3, hotAcc ? "slot" : RED);
  g.fill(a, y, Math.max(2, b - a), 3, hotEnv ? "slot" : "mod");
  g.fill(a, y - 3, 1, 9, hotEnv ? "slot" : "mod");
  g.text(a - 4, y + 5, "ENV", hotEnv ? "slot" : "mod", 1);
  var lx = c + 4;
  if (lx + 24 > x1) lx = Math.max(b + 2, c - 26);
  g.text(lx, y + 5, "ACC", hotAcc ? "slot" : RED, -1);
}

// the accent's gain at a note's start (getSample: the VCA is the amp
// envelope plus 0.45 of the main envelope, plus 4 times its amount on an
// accented note)
function accentDb(a) { return 20 * Math.log((1.45 + 4 * a) / 1.45) / Math.LN10; }

// the filter envelope's attack: the soft attack knob while the modification
// runs; stock (3 ms) a knob turned up would draw an attack that is not
// there, so the attack is drawn as none (the picture then cannot run: Pung
// runs only an envelope whose every stage is a knob)
function meg(v) { return devil(v) || fr(v, "soft_attack", 0) < 0.02 ? "soft_attack" : 0; }

// ---- PANEL --------------------------------------------------------------------------------
var P_KEYS = ["waveform", "tuning", "cutoff", "resonance", "env_mod", "decay", "accent", "volume"];
// the windows over the knobs they show
var WA = [8, 24, 224, 40], WB = [248, 24, 344, 76], WC = [608, 24, 104, 76], WD = [728, 24, 104, 76], WE = [848, 24, 104, 76];
// the segments: each window with what it shows, under the hands (and the
// modification, at its lamp)
var SEGMENTS = [
  { id: "osc", label: "Oscillator", rect: [8, 24, 224, 78], keys: ["waveform", "tuning", "tanh_shaper_drive", "slide_time"] },
  { id: "vcf", label: "VCF", rect: [248, 24, 344, 76], keys: ["cutoff", "resonance", "env_mod", "accent", "feedback_hpf"] },
  { id: "env", label: "VCF Env", rect: [608, 24, 104, 76], keys: ["decay", "soft_attack", "accent_decay", "normal_decay"] },
  { id: "accent", label: "Accent", rect: [728, 24, 104, 76], keys: ["accent", "accent_decay"] },
  { id: "out", label: "Out", rect: [848, 24, 104, 76], keys: ["volume", "drive_model", "drive", "drive_mix"] },
  { id: "devilfish", label: "Devilfish", rect: [868, 2, 88, 18],
    keys: ["devil_mod_switch", "soft_attack", "normal_decay", "accent_decay", "slide_time", "feedback_hpf", "tanh_shaper_drive"] }
];
var SEG_TITLE = { vcf: [WB, "VCF"], env: [WC, "VCF ENV"], accent: [WD, "ACCENT"], out: [WE, "OUT"] };
// the active segment, as the panel says it: its window's legend in the slot
// colour (the lamp's legend for the modification, the wave's for the
// oscillator); Pung's bar stands above it
function segId(v) { return v.$segmode === "segment" ? v.$segment || "" : ""; }
function segMark(g, v) {
  var st = SEG_TITLE[segId(v)];
  if (st) g.text(st[0][0] + 6, st[0][1] + 11, st[1], "slot", -1);
}

function panelGround(g, v, keys, tight) {
  g.fill(0, 0, 960, 160, SILVER);
  g.value(10, 17, "303", INK, -1);
  g.fill(0, 21, 960, 1, RULE);
  win(g, WA[0], WA[1], WA[2], WA[3]);
  win(g, WB[0], WB[1], WB[2], WB[3]);
  win(g, WC[0], WC[1], WC[2], WC[3]);
  win(g, WD[0], WD[1], WD[2], WD[3]);
  win(g, WE[0], WE[1], WE[2], WE[3]);
  g.text(WE[0] + 6, WE[1] + 11, "OUT", PRINT_DIM, -1);
  g.text(WE[0] + 6, WE[1] + 71, "LEVEL", PRINT_DIM, -1);
  g.text(WD[0] + 6, WD[1] + 11, "ACCENT", PRINT_DIM, -1);
  g.text(WD[0] + 15, WD[1] + 71, "N", PRINT_DIM, 0);
  g.text(WD[0] + 37, WD[1] + 71, "A", PRINT_DIM, 0);
  g.text(WD[0] + 74, WD[1] + 71, "LOUDER", PRINT_DIM, 0);
  keysGround(g);
  rowGround(g, v, keys, tight);
}

function panel(g, v) {
  var keys = v.$knobs && v.$knobs.length ? v.$knobs : P_KEYS, tight = !!v.$segmode;
  g.layer("303-panel|" + keys.join(",") + "|" + tight, function () { panelGround(g, v, keys, tight); });
  var t = v.$touched || "", dv = devil(v), sq = square(v);
  // the modification's lamp, top right
  g.text(950, 16, "DEVILFISH", segId(v) === "devilfish" ? "slot" : (dv ? INK : INK_DIM), 1);
  lamp(g, 950 - g.measure("DEVILFISH") - 9, 12, dv);

  // the oscillator: its wave, and the tuning's A
  var db = dv ? shaperDb(fr(v, "tanh_shaper_drive", 0)) : STOCK.shaper;
  var wk = known(v, "waveform");
  g.poly(cached("w|" + sq + "|" + db.toFixed(1), function () { return wavePts(WA[0] + 8, WA[1] + 14, WA[2] - 16, WA[3] - 20, 3, sq, db); }),
    2, !wk ? PRINT_FAINT : (t === "waveform" ? "slot" : PRINT));
  g.text(WA[0] + 6, WA[1] + 11, sq ? "SQUARE" : "SAW", t === "waveform" || segId(v) === "osc" ? "slot" : PRINT_DIM, -1);
  var tf = fr(v, "tuning", 0.5);
  g.text(WA[0] + WA[2] - 6, WA[1] + 11, known(v, "tuning") ? "A = " + tuneHz(tf).toFixed(1) + " HZ" : "", t === "tuning" ? "slot" : PRINT_DIM, 1);
  keysLive(g, v);

  // the filter, and its sweep
  var sw = sweep(v), hotC = t === "cutoff";
  g.filter(WB[0], WB[1] + 4, WB[2], WB[3] - 14, { cutoff: "cutoff", at: known(v, "cutoff") ? sw.cut : undefined, resonance: "resonance", type: "LP 24 dB", color: CURVE });
  g.text(WB[0] + 6, WB[1] + 11, "VCF", hotC ? "slot" : PRINT_DIM, -1);
  g.text(WB[0] + WB[2] - 6, WB[1] + 11, known(v, "env_mod") ? "ENV TO " + fmtHz(sw.hiHz).toUpperCase() + "   ACCENT TO " + fmtHz(sw.accHz).toUpperCase() : "",
    t === "env_mod" || t === "accent" ? "slot" : PRINT_DIM, 1);
  if (known(v, "cutoff") && known(v, "env_mod")) sweepBar(g, WB[0], WB[2], WB[1] + WB[3] - 7, v, t === "env_mod", t === "accent");

  // the filter envelope: a decay (the soft attack before it, with the mod)
  g.envelope(WC[0] + 2, WC[1] + 14, WC[2] - 4, WC[3] - 16, { attack: meg(v), decay: "decay", labels: true, color: CURVE });
  g.text(WC[0] + 6, WC[1] + 11, "VCF ENV", t === "decay" ? "slot" : PRINT_DIM, -1);

  // what an accented note adds: its level at the start, against a plain one
  var a = fr(v, "accent", 0.5), hotA = t === "accent", top = WD[1] + 18, base = WD[1] + 61;
  var hA = (base - top) * (1.45 / (1.45 + 4)), hB = (base - top) * ((1.45 + 4 * a) / (1.45 + 4));
  g.fill(WD[0] + 9, base - hA, 12, hA, PRINT_DIM);
  if (known(v, "accent")) g.fill(WD[0] + 31, base - hB, 12, hB, hotA ? "slot" : RED);
  g.value(WD[0] + 74, WD[1] + 48, known(v, "accent") ? "+" + accentDb(a).toFixed(1) : "--", hotA ? "slot" : PRINT, 0, 56);
  g.text(WD[0] + 74, WD[1] + 60, "DB", PRINT_DIM, 0);

  // what leaves: the drive (after the synth), and the level as it sounds
  var drv = known(v, "drive") && fr(v, "drive", 0) > 0 && fr(v, "drive_mix", 1) > 0;
  lamp(g, WE[0] + WE[2] - 10, WE[1] + 8, drv);
  g.text(WE[0] + 6, WE[1] + 30, drv ? "DRIVE " + (rat(v) ? "RAT" : "SOFT") : "NO DRIVE", drv ? PRINT : PRINT_DIM, -1);
  if (drv) g.text(WE[0] + 6, WE[1] + 43, pct(fr(v, "drive", 0)) + "  MIX " + pct(fr(v, "drive_mix", 1)), PRINT_DIM, -1);
  var L = v.$live, mw = WE[2] - 12, my = WE[1] + 52;
  g.fill(WE[0] + 6, my, mw, 7, "#1d1d1d");
  if (L && L.known && L.db > -60) {
    var lw = Math.round(mw * Math.max(0, Math.min(1, (L.db + 60) / 60)));
    g.fill(WE[0] + 6, my, lw, 7, L.db > -1 ? RED : PRINT);
  }
  for (var q = 1; q < 6; q++) g.fill(WE[0] + 6 + Math.round(mw * q / 6), my + 8, 1, 3, PRINT_FAINT); // every 10 dB

  segMark(g, v);
  rowValues(g, v, keys, tight);
}

push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [{ label: "303", keys: P_KEYS }],
  segments: SEGMENTS, draws_segments: true,
  extra_keys: ["devil_mod_switch", "soft_attack", "tanh_shaper_drive", "drive", "drive_model", "drive_mix"],
  screen: function (g, v) { panel(g, v); }
});

// ---- the band screens: the panel's silver at the left edge -----------------------------
function edge(g) { g.fill(0, 0, 3, g.h, SILVER); }
// a column's frame (the band starts 4 pixels into the display)
function colX(i) { return i * 120 - 4; }

// ---- DEVILFISH ------------------------------------------------------------------------------
// When the modification is off the engine runs the stock values; its knobs
// are kept and wait.
var D_KEYS = ["devil_mod_switch", "soft_attack", "normal_decay", "accent_decay", "slide_time", "feedback_hpf", "tanh_shaper_drive"];
function devilfish(g, v) {
  var dv = devil(v), t = v.$touched || "", y = 2, h = 82;
  edge(g);
  // the switch
  var x = colX(0) + 10, dk = known(v, "devil_mod_switch");
  g.text(x, y + 12, "DEVILFISH", t === "devil_mod_switch" ? "slot" : "dim", -1);
  g.fill(x, y + 22, 48, 20, dv ? (t === "devil_mod_switch" ? "slot" : RED) : "#262626");
  g.fill(x + (dv ? 26 : 2), y + 24, 20, 16, dv ? "black" : "#6a6a6a");
  g.text(x + 56, y + 37, !dk ? "--" : (dv ? "ON" : "OFF"), dv ? "fg" : "dim", -1);
  if (dk) g.text(x, y + 60, dv ? "THE KNOBS" : "STOCK 303:", dv ? "dim" : "fg", -1);
  if (dk) g.text(x, y + 74, dv ? "ARE LIVE" : "FIXED VALUES", dv ? "dim" : "fg", -1);
  var ink = dv ? CURVE : "#7c7c78";

  // three envelopes, over their knobs: the filter's for a plain note (its
  // soft attack, the main DECAY), the VCA's, and the filter's for an accent
  var x1 = colX(1) + 6, w = 108;
  g.text(x1, y + 10, "VCF", t === "soft_attack" ? "slot" : "dim", -1);
  g.text(x1 + w - 2, y + 10, "ATK " + fmtMs(dv ? attackMs(fr(v, "soft_attack", 0)) : STOCK.attack).toUpperCase(), dv ? "fg" : "dim", 1);
  g.envelope(x1 - 4, y + 12, w + 4, h - 12, { attack: meg(v), decay: "decay", labels: true, color: ink });
  var x2 = colX(2) + 6;
  g.text(x2, y + 10, "VCA", t === "normal_decay" ? "slot" : "dim", -1);
  g.text(x2 + w - 2, y + 10, fmtMs(dv ? linMs(fr(v, "normal_decay", 0.5)) : STOCK.amp).toUpperCase(), dv ? "fg" : "dim", 1);
  g.envelope(x2 - 4, y + 12, w + 4, h - 12, { attack: 0.0, decay: dv ? "normal_decay" : (STOCK.amp - 30) / 2970, labels: true, color: ink, still: true });
  var x3 = colX(3) + 6;
  g.text(x3, y + 10, "ACCENT", t === "accent_decay" ? "slot" : "dim", -1);
  g.text(x3 + w - 2, y + 10, fmtMs(dv ? linMs(fr(v, "accent_decay", 0.5)) : STOCK.accent).toUpperCase(), dv ? "fg" : "dim", 1);
  g.envelope(x3 - 4, y + 12, w + 4, h - 12, { attack: 0.0, decay: dv ? "accent_decay" : (STOCK.accent - 30) / 2970, labels: true, color: ink, still: true });

  // the slide: the pitch going from one note to the next, on a 400 ms axis
  var x4 = colX(4) + 8, w4 = 104, ms = dv ? slideMs(fr(v, "slide_time", 0.3)) : STOCK.slide, hot4 = t === "slide_time";
  g.text(x4, y + 10, "SLIDE", hot4 ? "slot" : "dim", -1);
  g.text(x4 + w4, y + 10, fmtMs(ms).toUpperCase(), dv ? "fg" : "dim", 1);
  var lo = y + 64, hi = y + 26, t0 = x4 + 18;
  g.line(x4, y + 72, x4 + w4, y + 72, 1, "line");
  g.poly(cached("sl|" + ms.toFixed(1) + "|" + x4, function () {
    var pts = [x4, lo, t0, lo], tau = 0.2 * ms; // Open303: the slew limiter's time constant is 0.2 of the slide time
    for (var i = 1; i <= 40; i++) {
      var tm = i / 40 * (400 - 40), px = t0 + (w4 - 18) * tm / 360;
      pts.push(px, hi + (lo - hi) * Math.exp(-tm / Math.max(0.4, tau)));
    }
    return pts;
  }), 2, hot4 ? "slot" : ink);
  g.fill(t0, y + 68, 1, 8, "dim");
  g.text(x4 + w4, y + 70, "400 MS", "faint", 1);

  // the feedback highpass: what it takes out of the resonance (Pung's axis,
  // 20 Hz to 20 kHz over three decades)
  var x5 = colX(5) + 4, hz = dv ? hpfHz(fr(v, "feedback_hpf", 0.5)) : STOCK.hpf, hot5 = t === "feedback_hpf";
  g.text(x5 + 4, y + 10, "FEEDBACK HPF", hot5 ? "slot" : "dim", -1);
  g.filter(x5, y + 12, 112, h - 14, { cutoff: Math.log(hz / 20) / Math.LN10 / 3, type: "HP 6 dB", color: hot5 ? "slot" : ink });
  g.text(x5 + 108, y + 26, Math.round(hz) + " HZ", dv ? "fg" : "dim", 1);

  // the square the shaper makes: its edges and its width move with the drive
  var x6 = colX(6) + 8, w6 = 224, db = dv ? shaperDb(fr(v, "tanh_shaper_drive", 0)) : STOCK.shaper, hot6 = t === "tanh_shaper_drive";
  var k = Math.pow(10, db / 20), width = Math.max(0, (1 - 4.37 / k) / 2);
  g.text(x6, y + 10, "SQUARE SHAPER", hot6 ? "slot" : "dim", -1);
  g.text(x6 + w6 - 4, y + 10, db.toFixed(1) + " DB  PW " + Math.round(width * 100) + "%", dv ? "fg" : "dim", 1);
  g.line(x6, y + 47, x6 + w6 - 4, y + 47, 1, "line");
  g.poly(cached("sq|" + db.toFixed(1), function () { return wavePts(x6, y + 22, w6 - 4, 50, 2, true, db); }), 2, hot6 ? "slot" : ink);
}
push.compartment({
  id: "devilfish", label: "Devilfish",
  pages: [{ label: "Devilfish", keys: D_KEYS }],
  extra_keys: ["decay"],
  screen: devilfish
});

// ---- DRIVE ------------------------------------------------------------------------------------
// After the synth: Soft (a tanh, a little uneven) or RAT (the op-amp's gain
// into x / (1 + x^4)^(1/4)). Drive 0 bypasses it; Mix blends the clean 303.
function clipOf(model, d) {
  if (model) { // RAT: up to 2307 times the gain, into the algebraic clipper
    var G = 1.877 * (1 + d * 2306) * 0.02 + 0.6;
    return function (x) { var u = G * x; return u / Math.sqrt(Math.sqrt(1 + u * u * u * u)); };
  }
  var gs = Math.pow(10, d * 24 / 20) * 1.2; // Soft: up to 24 dB into tanh(x + 0.15) - tanh(0.15)
  return function (x) { return Math.tanh(gs * x + 0.15) - 0.14888503; };
}
function drive(g, v) {
  edge(g);
  var t = v.$touched || "", y = 2, h = 82, m = rat(v), d = fr(v, "drive", 0), mix = fr(v, "drive_mix", 1);
  var on = d > 0 && mix > 0 && known(v, "drive");
  // the box: its model, its lamp
  var x = colX(0) + 10;
  g.fill(x, y + 4, 100, 76, "#1c1c1c");
  box(g, x, y + 4, 100, 76, t === "drive_model" ? "slot" : "#3a3a3a");
  g.value(x + 50, y + 30, m ? "RAT" : "SOFT", t === "drive_model" ? "slot" : "fg", 0);
  g.text(x + 50, y + 46, m ? "OP-AMP CLIP" : "WARM TANH", "dim", 0);
  g.dot(x + 50, y + 62, 4, on ? RED : RED_OFF);
  g.text(x + 50, y + 77, on ? "ON" : (known(v, "drive") ? "BYPASSED" : "--"), on ? "fg" : "dim", 0);

  var clip = clipOf(m, d), peak = Math.abs(clip(1)) || 1, trough = Math.abs(clip(-1)) || 1;
  function out(x) { var c = clip(x) / (x >= 0 ? peak : trough); return on ? (1 - mix) * x + mix * c : x; }
  var sig = [m, d.toFixed(2), mix.toFixed(2), on].join("|");
  // the curve: in across, out up; the straight line is the clean signal
  var cx = colX(1) + 12, cw = 200, cy = y + 6, ch = 74;
  g.text(cx, y + 12, "CURVE", t === "drive" ? "slot" : "dim", -1);
  g.line(cx + cw / 2, cy, cx + cw / 2, cy + ch, 1, "line");
  g.line(cx + 30, cy + ch / 2, cx + cw - 30, cy + ch / 2, 1, "line");
  g.line(cx + 30, cy + ch - 4, cx + cw - 30, cy + 4, 1, "faint");
  g.poly(cached("c|" + sig, function () {
    var pts = [];
    for (var i = 0; i <= 48; i++) { var xx = -1 + 2 * i / 48; pts.push(cx + 30 + (cw - 60) * i / 48, cy + ch / 2 - out(xx) * (ch / 2 - 4)); }
    return pts;
  }), 2.2, t === "drive" || t === "drive_mix" ? "slot" : CURVE);

  // the 303's wave, clean and through the drive, at the mix
  var wx = colX(3) + 8, ww = 5 * 120 - 12, wy = y + 16, wh = 62, sq = square(v);
  g.text(wx, y + 12, "THE 303 THROUGH IT", "dim", -1);
  g.text(wx + ww, y + 12, on ? "MIX " + pct(mix) : "CLEAN", on ? "fg" : "dim", 1);
  var k = Math.pow(10, STOCK.shaper / 20);
  g.poly(cached("dry|" + sq, function () {
    var pts = [];
    for (var i = 0; i <= 120; i++) pts.push(wx + ww * i / 120, wy + wh / 2 - osc303(3 * Math.min(i / 120, 0.99999), sq, k) * 0.8 * (wh / 2));
    return pts;
  }), 1, "#5a5a58");
  if (on) g.poly(cached("wet|" + sq + "|" + sig, function () {
    var pts = [];
    for (var i = 0; i <= 120; i++) pts.push(wx + ww * i / 120, wy + wh / 2 - out(osc303(3 * Math.min(i / 120, 0.99999), sq, k) * 0.8) * (wh / 2));
    return pts;
  }), 2, t === "drive" || t === "drive_mix" ? "slot" : RED);
}
push.compartment({
  id: "drive", label: "Drive",
  pages: [{ label: "Drive", keys: ["drive_model", "drive", "drive_mix"] }],
  extra_keys: ["waveform"],
  screen: drive
});

// ---- the filter envelope's times, as the engine runs it -----------------------------------
// Open303's main envelope decays with the DECAY time as its time constant:
// drawn to 5% (three of them). The soft attack (Devilfish) is a leaky
// integrator's time constant before it; stock it is 3 ms.
push.envelopeTimes(function (env) {
  var dv = env.value("devil_mod_switch") === 1;
  return env.stages.map(function (s) {
    if (s.raw === null) return null;
    if (s.key === "decay") return 3 * decayMs(s.raw, dv) / 1000;
    if (s.key === "soft_attack") return dv ? Math.min(3, 2 * attackMs(s.raw) / 1000) : 0.003;
    return null;
  });
});
