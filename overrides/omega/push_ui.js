// Omega on Push: a techno kick synthesizer with nine kick engines, a
// feedback-free rumble of ghost kicks, a generative sequence and a performer
// stage. An overlay shipped with Pung (Omega ships no push_ui.js).
//
// Omega is one sound: the kick. So the kick is the picture, drawn from the
// engine's own equations (src/models/*.c, src/groove.c, src/dsp.c):
//
//   KICK     (front panel) the DIVE: the body's pitch falling from where
//            CURVE starts it to PITCH, on a Hz scale, the click as it bursts;
//            the HIT: one beat of the kick's waveform (every cycle where it
//            is, the amplitude falling over LENGTH) with its four ghost kicks
//            behind it on the 16th grid; the ENGINE in use, with its own
//            picture (FM sidebands, the 4-op algorithm, the drum's modes...).
//            Pages: the kick, its FX, and each engine's own knobs.
//   RUMBLE   the kick and its ghost kicks, each over its TAP encoder, the
//            decay LENGTH lays over them, the band the rumble keeps.
//   SEQUENCE the generative line as a string of beads: every step at its
//            pitch, accents solid, rests knots, the step playing lit.
//   PERFORMER the sidechain pump over a bar of kicks, the band it ducks, the
//            DJ filter and the compressor's knee.
//
// The look: a dark warehouse, the kick in signal red, the click amber, the
// rumble teal, the sequence violet; the encoders as LED bar graphs of sixteen
// segments, one per step of a techno bar.

function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function frac(v, k, d) { return known(v, k) ? v[k].frac : d; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function idx(v, k, n) { return clamp(Math.round(num(v, k, 0)), 0, n - 1); }

// ---- the warehouse's colours -----------------------------------------------------------------
var GROUND = "#0b0c0e", PANEL = "#14161a", WELL = "#08090b", RULE = "#2a2e36", GRID = "#1c1f25";
var INK = "#ecebe6", LEG = "#8d929b", DIMI = "#525761", FAINT = "#33373f";
var KICK = "#ff3b30", KICK_W = "#d02a22", KICK_F = "#5c1712", KICK_D = "#3a100c";
var CLICK = "#ffc861", RUMB = "#2fc8b8", RUMB_F = "#0f4843", RUMB_D = "#123634";
var SEQ = "#a58bff", SEQ_D = "#3a3166";
var LED_OFF = "#22252c";

// ---- the engines (omega.h, model_registry.c) ------------------------------------------------------
var MODELS = ["FM2", "FM4", "WTR", "PHY", "HRD", "DIG", "TRS", "ANA", "USR"];
var MODEL_NAMES = ["2-OP FM", "4-OP FM", "WAVETABLE", "PHYSICAL", "HARD LAYER", "DIGITAL", "TRANSISTOR", "ANALOG", "USER SAMPLE"];
var ENGINE_KEYS = [
  ["fm_ratio", "fm_index", "op2_wave"],
  ["fm4_algo", "fm4_opratio", "fm4_opindex", "fm4_opamp", "fm4_feedback", "fm4_algo2"],
  ["wtr_wave", "wtr_bodypitch", "wtr_transdec", "wtr_transcol"],
  ["phy_beater", "phy_shell", "phy_headtens", "phy_damping"],
  ["hrd_sample", "hrd_mix", "hrd_drive", "hrd_crush"],
  ["dig_waveidx", "dig_sample", "dig_bitdepth", "dig_pitchenv"],
  ["trs_tone", "trs_tdec", "trs_wtcol", "trs_curve"],
  ["ana_morph", "ana_sublvl", "ana_subdec", "ana_sample"],
  ["usr_sample", "usr_wtmorph", "usr_layervol", "usr_pitchenv"]
];
// the transient each engine puts before its body: ATTACK, TRS DEC and TRS
// TNE mean a click, a beater burst or a sample thump
var TRANSIENT = ["CLICK", "CLICK", "CLICK", "BEATER", "THUMP", "THUMP", "CLICK", "THUMP", "CLICK"];
function modelOf(v) { return idx(v, "model", 9); }

// ---- the engine's laws -------------------------------------------------------------------------------------------
var SR = 44100;
function lengthMs(x) { return 50 * Math.pow(30, clamp(x, 0, 1)); }            // LENGTH: the body's decay time constant
function sweepHz(f0, c) { return clamp(f0 * (1.5 + c * 7), 0, 1000); }          // CURVE's depth above PITCH
// the transient's decay (ms) and its tone, by engine
function trsDecMs(m, x) {
  if (m === 3) return Math.pow(12, x);                       // PHY: 1..12 ms, exponential
  if (m === 4 || m === 5 || m === 7) return 5 * Math.pow(24, x); // HRD/DIG/ANA: the thump, 5..120 ms
  if (m === 6) return 2 + 38 * x;                            // TRS: 2..40 ms
  return 1 + 29 * x;                                         // FM2/FM4/WTR/USR: 1..30 ms
}
function colorHz(m, x) { return m === 7 ? 50 + x * 7950 : m === 3 ? 50 + x * 15950 : 50 + x * 17950; }
// a kick's state, read once a draw
function kickOf(v, m) {
  var f0 = clamp(num(v, "pitch", 50), 30, 200), c = frac(v, "curve", 0.8);
  var K = { m: m, f0: f0, c: c, tau: lengthMs(frac(v, "length", 0.5)) / 1000, fast: 0.015, slow: 0.3, sweep: sweepHz(f0, c), mul: 1,
    phy: null, att: frac(v, "attack", 0.5), trs: trsDecMs(m, frac(v, "trs_dec", 0.5)) / 1000 };
  if (m === 2) K.mul = Math.pow(2, (frac(v, "wtr_bodypitch", 0.25) - 0.5) * 2);       // WTR BODY PCH: 0.5x..2x
  if (m === 5) K.sweep *= 0.25 + 1.5 * frac(v, "dig_pitchenv", 0.5);                  // DIG PITCH ENV: 0.25..1.75x
  if (m === 8) K.sweep *= 1 + frac(v, "usr_pitchenv", 0.5);                            // USR PITCH ENV
  if (m === 6) K.fast = Math.max(0.003, 0.015 - 0.009 * frac(v, "trs_curve", 0.5));   // TRS CURVE: the 909 snap faster
  if (m === 3) { // PHY: the head glides from tension x (1 + 3 CURVE) down to its landing
    var land = f0 * (0.75 + 0.5 * frac(v, "phy_headtens", 0.5));
    K.phy = { land: land, start: Math.min(land * (1 + c * 3), 0.45 * SR), tau: (10 + c * 60) / 1000,
      ring: 0.4 * Math.pow(60 / 400, frac(v, "phy_damping", 0.5)) };
    K.f0 = land;
  }
  return K;
}
// the body's pitch at t seconds (every engine's dual 808/909 sweep, PHY's glide)
function hzAt(K, t) {
  if (K.phy) return K.phy.land + (K.phy.start - K.phy.land) * Math.exp(-t / K.phy.tau);
  var fast = Math.exp(-t / K.fast), slow = Math.exp(-t / K.slow);
  return (K.f0 + (slow + K.c * (fast - slow)) * K.sweep) * K.mul;
}
function ampAt(K, t) {
  var a = Math.exp(-t / K.tau);
  if (K.phy) a *= Math.exp(-6.9 * t / K.phy.ring);  // the head mode rings out over DAMPING
  return a;
}
function hz(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + " KHZ" : Math.round(f) + " HZ"; }
function ms(s) { return s < 1 ? (s * 1000 < 10 ? (s * 1000).toFixed(1) : Math.round(s * 1000)) + " MS" : s.toFixed(2) + " S"; }

var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (++CACHED > 64) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
function rnd(i) { var x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

// ---- values in Omega's own terms (wherever Pung writes one) --------------------------------------------------------
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function fmt(k, x) {
  switch (k) {
  case "pitch": case "grv_groot": return hz(x);
  case "length": return ms(lengthMs(x) / 1000);
  case "curve": return x < 0.01 ? "808" : x > 0.99 ? "909" : Math.round(x * 100) + "% 909";
  case "fm_ratio": return "x" + (0.5 + 7.5 * x).toFixed(2);
  case "fm_index": return (8 * x).toFixed(1);
  case "op2_wave": return x > 1.5 ? "TRI" : x > 0.5 ? "FOLD" : "SINE";      // fm2.c: thresholds on the raw value
  case "hrd_sample": case "dig_waveidx": return ["SAW", "SQUARE", "DIGITAL"][clamp(Math.floor(x + 0.5), 0, 2)];
  case "fm4_feedback": return Math.round(x * 70) + "%";
  case "wtr_bodypitch": return "x" + Math.pow(2, (x - 0.5) * 2).toFixed(2);
  case "wtr_transdec": case "trs_tdec": return ms((2 + 38 * x) / 1000);
  case "phy_damping": return ms(0.4 * Math.pow(60 / 400, x));
  case "hrd_crush": return x < 0.005 ? "OFF" : (16 - 14 * x).toFixed(1) + " BIT";
  case "dig_bitdepth": return (14 - 8 * x).toFixed(1) + " BIT";
  case "dig_pitchenv": return "x" + (0.25 + 1.5 * x).toFixed(2);
  case "ana_subdec": return ms(0.1 * Math.pow(9, x));
  case "trs_curve": return ms(Math.max(3, 15 - 9 * x) / 1000);
  case "grv_vol": case "grv_genvol": return x <= 1 ? Math.round(x * 100) + "%" : "100% +" + Math.round((x - 1) * 100);
  case "grv_length": return ms(0.03 * Math.pow(40, x));
  case "grv_color": case "grv_genfilt": return hz(30 * Math.pow(20000 / 30, x));
  case "grv_hpf": return x <= 0.001 ? "OFF" : hz(20 * Math.pow(100, x));
  case "grv_grootnote": var n = Math.round(x); return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 2);
  case "duck": return Math.round((1 - Math.pow(1 - x, 2.5)) * 100) + "%";
  case "duck_rel": return ms((10 + 490 * x) / 1000);
  case "duck_bs": return hz(20 * Math.pow(1000, Math.pow(x, 0.6)));
  case "dj_filt": return x < 0.48 ? "LP " + hz(120 * Math.pow(150, x / 0.48)) : x > 0.52 ? "HP " + hz(30 * Math.pow(100, (x - 0.52) / 0.48)) : "OFF";
  }
  return null;
}
push.display(function (key, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return;
  var s = fmt(key, x);
  if (s === null) return;
  var m = /^(.*?) ?(HZ|KHZ|MS|S|BIT)$/.exec(s);
  return m ? { value: m[1], unit: m[2] } : s;
});
// a value as the panel writes it, knowing the engine
function valueOf(v, k, m) {
  if (!known(v, k)) return "--";
  var x = num(v, k, 0), f = frac(v, k, 0);
  if (k === "trs_dec") return ms(trsDecMs(m, f) / 1000);
  if (k === "color") return hz(colorHz(m, f));
  if (k === "trs_tne" && (m <= 2 || m === 8)) return m === 2 ? Math.round(f * 100) + "% MIX" : hz(500 + f * 15500);
  if (k === "trs_tne" && m === 6) return hz(100 + f * 1100);
  var s = fmt(k, x);
  if (s !== null) return s;
  var d = txt(v, k), u = v[k].unit || "";
  if (v[k].type === "enum") return up(d);
  if (u === "%") return Math.round(f * 100) + "%";
  return up(d + (u && d.indexOf(u) < 0 ? " " + u : ""));
}
var NAMES = { model: "ENGINE", master_vol: "VOLUME", pitch: "PITCH", length: "LENGTH", curve: "CURVE", attack: "ATTACK",
  trs_dec: "DECAY", trs_tne: "TONE", color: "FILTER", filter_route: "FILT ROUTE", fx_type: "FX TYPE", fx_amt: "FX AMOUNT",
  fx_tone: "FX TONE", fm_ratio: "RATIO", fm_index: "INDEX", op2_wave: "OP2 WAVE", fm4_algo: "ALGORITHM", fm4_opratio: "OP RATIO",
  fm4_opindex: "OP INDEX", fm4_opamp: "OP AMP", fm4_feedback: "FEEDBACK", fm4_algo2: "DETUNE", wtr_wave: "WAVE", wtr_bodypitch: "BODY PITCH",
  wtr_transdec: "TRANS DEC", wtr_transcol: "TRANS COL", phy_beater: "BEATER", phy_shell: "SHELL", phy_headtens: "HEAD TENS",
  phy_damping: "DAMPING", hrd_sample: "LAYER", hrd_mix: "MIX", hrd_drive: "DRIVE", hrd_crush: "CRUSH", dig_waveidx: "WAVE",
  dig_sample: "SAMPLE", dig_bitdepth: "BIT DEPTH", dig_pitchenv: "PITCH ENV", trs_tone: "TRS TONE", trs_tdec: "TRS DECAY",
  trs_wtcol: "WT COLOR", trs_curve: "SNAP", ana_morph: "MORPH", ana_sublvl: "SUB LEVEL", ana_subdec: "SUB DECAY", ana_sample: "SAMPLE",
  usr_sample: "SAMPLE", usr_wtmorph: "WT MORPH", usr_layervol: "LAYER VOL", usr_pitchenv: "PITCH ENV",
  grv_vol: "RUMBLE", grv_length: "LENGTH", grv_hpf: "HPF", grv_color: "LPF", grv_tap1: "TAP 1", grv_tap2: "TAP 2", grv_tap3: "TAP 3", grv_tap4: "TAP 4" };
function nameOf(v, k, m) {
  if (k === "attack" || k === "trs_dec" || k === "trs_tne") return TRANSIENT[m] + " " + (k === "attack" ? "LEVEL" : k === "trs_dec" ? "DECAY" : "TONE");
  return NAMES[k] || up((v[k] && v[k].name) || k);
}

// ---- the encoder row: an LED bar graph of sixteen steps under each encoder -------------------------------------------
var ROW = 104;
function ledBar(g, x, y, w, h, v, k, hot, col) {
  var n = 16, sw = w / n, on = known(v, k);
  if (on && v[k].type === "enum") { // a switch: one block per position, the one it is in lit
    var opts = v[k].max - v[k].min + 1, at = Math.round(num(v, k, 0)) - v[k].min;
    if (!(opts > 1 && opts <= 16)) opts = 2;
    var bw = w / opts;
    for (var o = 0; o < opts; o++) g.fill(Math.round(x + o * bw), y, Math.round(bw) - 2, h, o === at ? (hot ? "slot" : col) : LED_OFF);
    return;
  }
  // the bar, lit to its value, then the fifteen gaps cut into it as one comb
  var lit = on ? Math.round(v[k].frac * n) : 0;
  g.fill(x, y, w - 1, h, LED_OFF);
  if (lit) g.fill(x, y, Math.round(lit * sw) - 1, h, hot ? "slot" : col);
  g.area(comb(x, sw, n, y), y + h, WELL);
}
var COMBS = {};
function comb(x, sw, n, y) {
  var key = x + "/" + sw + "/" + y, c = COMBS[key];
  if (c) return c;
  c = [];
  for (var i = 1; i < n; i++) { var gx = Math.round(x + i * sw) - 1; c.push(gx - 0.01, y + 99, gx, y - 1, gx + 1, y - 1, gx + 1.01, y + 99); }
  return (COMBS[key] = c);
}
function encoderRow(g, v, m, colors) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x = c * 120 + 12, hot = k === t, col = (colors && colors[k]) || KICK;
    g.text(x, seg ? ROW + 13 : ROW + 16, nameOf(v, k, m), hot ? "slot" : LEG, -1, 100);
    g.value(x, seg ? ROW + 30 : ROW + 37, valueOf(v, k, m), hot ? "slot" : INK, -1, 100);
    ledBar(g, x, seg ? ROW + 34 : ROW + 44, 96, seg ? 3 : 5, v, k, hot, col);
  }
}
function rowGround(g, seg) {
  g.fill(0, ROW, 960, 56, WELL);
  g.fill(0, ROW, 960, 1, RULE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, ROW + 8, 1, seg ? 28 : 42, GRID);
}

// ---- the kick's pictures ------------------------------------------------------------------------------------------------------
// one hit, `span` seconds of it over w pixels: per column the lowest and
// highest the body reaches (its cycles where they are), and its amplitude
function hitShape(K, span, w) {
  var key = ["hit", K.m, K.f0.toFixed(2), K.c.toFixed(3), K.tau.toFixed(4), K.sweep.toFixed(2), K.mul.toFixed(3), K.fast, span.toFixed(3), w,
    K.phy ? K.phy.start.toFixed(1) + "/" + K.phy.ring.toFixed(4) : ""].join("|");
  return cached(key, function () {
    // two pixels a column, four looks a column; every decay a running product
    var n = Math.ceil(w / 2), sub = 3, dt = span / (n * sub), hi = [], lo = [], env = [], ph = 0, tw = 2 * Math.PI;
    var fa = 1, sl = 1, am = 1, gl = 1, rg = 1;
    var dfa = Math.exp(-dt / K.fast), dsl = Math.exp(-dt / K.slow), dam = Math.exp(-dt / K.tau);
    var dgl = K.phy ? Math.exp(-dt / K.phy.tau) : 1, drg = K.phy ? Math.exp(-6.9 * dt / K.phy.ring) : 1;
    for (var x = 0; x < n; x++) {
      var mx = -2, mn = 2;
      env.push(am * rg);
      for (var s = 0; s < sub; s++) {
        var q = am * rg * SINE[Math.floor((ph - Math.floor(ph)) * 1024)];
        if (q > mx) mx = q;
        if (q < mn) mn = q;
        var f = K.phy ? K.phy.land + (K.phy.start - K.phy.land) * gl : (K.f0 + (sl + K.c * (fa - sl)) * K.sweep) * K.mul;
        ph += f * dt; fa *= dfa; sl *= dsl; am *= dam; gl *= dgl; rg *= drg;
      }
      hi.push(mx); lo.push(mn);
    }
    return { hi: hi, lo: lo, env: env, n: n, pts: {} };
  });
}
var SINE = [];
for (var si_ = 0; si_ <= 1024; si_++) SINE.push(Math.sin(2 * Math.PI * si_ / 1024));
function envAt(S, px) { var i = px >> 1; return S.env[i < S.n ? i : S.n - 1]; }
// a burst of noise falling e^(-3x/len) over len pixels, as one jagged outline (top half)
function burst(x0, base, len, hgt, seed, step) {
  var out = [x0, base];
  for (var i = 0; i <= len; i += step) out.push(x0 + i, base - hgt * Math.exp(-3 * i / len) * (0.5 + 0.5 * Math.abs(rnd(i + seed))));
  out.push(x0 + len, base);
  return out;
}
// the rumble's ghost kicks (groove.c): tap k reads the kick k sixteenths back,
// weighted TAPk x e^(-age/LENGTH), all of it made up to equal power
function taps(v, bpm) {
  var tau = 0.03 * Math.pow(40, frac(v, "grv_length", 0.5)), spq = 60 / bpm / 4, w = [], e = 0;
  for (var k = 1; k <= 4; k++) {
    var x = frac(v, "grv_tap" + k, 0.6) * Math.exp(-k * spq / tau);
    w.push(x); e += x * x;
  }
  var norm = 2 / Math.sqrt(Math.max(e, 0.25)), vol = Math.min(1, num(v, "grv_vol", 0));
  return { w: w, norm: norm, vol: vol, tau: tau, spq: spq, on: vol > 0.004 };
}

// ---- the front panel ----------------------------------------------------------------------------------------------------------------
var TOP = 24, BOX_H = 76;
var DIVE = [8, TOP, 222, BOX_H], HIT = [238, TOP, 468, BOX_H], ENG = [714, TOP, 238, BOX_H];
function boxGround(g, b, title) {
  g.fill(b[0], b[1], b[2], b[3], PANEL);
  g.text(b[0] + 6, b[1] + 11, title, LEG, -1);
}
function panelGround(g, seg) {
  g.fill(0, 0, 960, 104, GROUND);
  g.value(8, 16, "OMEGA", INK, -1);
  // the engine strip: nine engines, the one playing lit (drawn live)
  for (var i = 0; i < 9; i++) g.fill(88 + i * 44, 4, 40, 14, PANEL);
  boxGround(g, DIVE, "DIVE");
  boxGround(g, HIT, "ONE BEAT");
  boxGround(g, ENG, "ENGINE");
  // the dive's scales: Hz (log 25..1600) and 0..200 ms
  var x0 = DIVE[0] + 34, x1 = DIVE[0] + DIVE[2] - 8, y0 = DIVE[1] + 16, y1 = DIVE[1] + DIVE[3] - 14;
  [50, 100, 200, 400, 800].forEach(function (f) {
    var y = diveY(f);
    g.fill(x0, y, x1 - x0, 1, GRID);
    if (f !== 100 && f !== 400) g.text(x0 - 4, y + 3, String(f), DIMI, 1);
  });
  // time on a square-root scale: the first milliseconds, where the dive is, get the room
  [[0, "0"], [0.01, "10"], [0.05, "50"], [0.1, ""], [0.2, "200 MS"]].forEach(function (tk) {
    var x = diveX(tk[0]);
    g.fill(x, y1 + 1, 1, 3, FAINT);
    if (tk[1]) g.text(x, y1 + 12, tk[1], DIMI, tk[0] === 0 ? -1 : tk[0] === 0.2 ? 1 : 0);
  });
  // one beat: its four sixteenths
  var hx0 = HIT[0] + 8, hx1 = HIT[0] + HIT[2] - 8;
  for (var q = 0; q <= 4; q++) {
    var x = hx0 + (hx1 - hx0) * q / 4;
    g.fill(Math.round(x), HIT[1] + 14, 1, HIT[3] - 16, q === 0 || q === 4 ? RULE : GRID);
    if (q > 0 && q < 4) g.text(Math.round(x) + 3, HIT[1] + HIT[3] - 3, q + "/16", DIMI, -1);
  }
  g.fill(hx0, HIT[1] + 14 + (HIT[3] - 16) / 2, hx1 - hx0, 1, GRID);
  rowGround(g, seg);
}
// the dive's scales: Hz (log, 25..1600) and time (square root, 0..200 ms)
var DIVE_T = 0.2;
function diveX(t) { var x0 = DIVE[0] + 34, x1 = DIVE[0] + DIVE[2] - 8; return Math.round(x0 + (x1 - x0) * Math.sqrt(clamp(t / DIVE_T, 0, 1))); }
function diveY(f) {
  var y0 = DIVE[1] + 18, y1 = DIVE[1] + DIVE[3] - 15;
  return Math.round(y1 - (Math.log(clamp(f, 25, 1600) / 25) / Math.log(64)) * (y1 - y0));
}
function drawDive(g, v, K, hot) {
  var x0 = DIVE[0] + 34, x1 = DIVE[0] + DIVE[2] - 8, y1 = DIVE[1] + DIVE[3] - 14, w = x1 - x0, T = DIVE_T;
  var key = ["dive", K.m, K.f0.toFixed(2), K.c.toFixed(3), K.sweep.toFixed(2), K.mul.toFixed(3), K.fast, K.phy ? K.phy.start.toFixed(1) : ""].join("|");
  var pts = cached(key, function () {
    var p = [];
    for (var x = 0; x <= w; x += 2) { var u = x / w; p.push(x0 + x, diveY(hzAt(K, T * u * u))); }
    return p;
  });
  // where it lands: PITCH
  var yl = diveY(K.f0 * K.mul);
  for (var dx = x0; dx < x1; dx += 6) g.fill(dx, yl, 3, 1, hot.pitch ? "slot" : KICK_F);
  // the transient: a burst at the start, as loud as its level, as long as its decay
  if (K.att > 0.004) { // its level falls e^(-t/decay); drawn on the same square-root time, one jagged outline
    var bh = 2 + 10 * K.att, bp = [x0, y1];
    for (var i = 0; i < w; i += 2) {
      var tt = T * (i / w) * (i / w), a = Math.exp(-tt / K.trs);
      bp.push(x0 + i, y1 - Math.max(1, bh * a * (0.55 + 0.45 * Math.abs(rnd(i + 7)))));
      if (a < 0.03) break;
    }
    bp.push(bp[bp.length - 2], y1);
    g.area(bp, y1, hot.trs ? "slot" : CLICK);
  }
  g.poly(pts, 2, hot.dive ? "slot" : KICK);
  // from where to where, in the box's heading
  var f1 = hzAt(K, 0), tx = DIVE[0] + DIVE[2] - 6;
  g.text(tx, DIVE[1] + 11, hz(K.f0 * K.mul), hot.pitch ? "slot" : INK, 1);
  var w2 = g.measure(hz(K.f0 * K.mul));
  g.text(tx - w2 - 4, DIVE[1] + 11, hz(f1) + " TO", hot.dive ? "slot" : LEG, 1);
}
function drawHit(g, v, K, bpm, hot) {
  var hx0 = HIT[0] + 8, hx1 = HIT[0] + HIT[2] - 8, w = hx1 - hx0, top = HIT[1] + 16, h = HIT[3] - 20, mid = top + h / 2, span = 60 / bpm;
  var S = hitShape(K, span, w), amp = h / 2 - 2, R = taps(v, bpm);
  // the ghost kicks behind it, each from its sixteenth
  var gscale = R.norm * (R.on ? R.vol : 1);
  for (var k = 0; k < 4; k++) {
    var wk = R.w[k] * gscale;
    if (wk < 0.004) continue;
    var xs = Math.round((k + 1) * w / 4), up_ = [], dn = [];
    for (var x = xs; x < w; x += 4) {
      var e = envAt(S, x - xs) * Math.min(1, wk);
      up_.push(hx0 + x, mid - e * amp); dn.push(hx0 + x, mid + e * amp);
    }
    if (up_.length < 4) continue;
    var gc = hot.rumble ? "slot" : R.on ? RUMB : RUMB_D;
    if (R.on) { g.area(up_, mid, RUMB_F); g.area(dn, mid, RUMB_F); }
    g.poly(up_, R.on ? 2 : 1, R.on || hot.rumble ? gc : FAINT); g.poly(dn, R.on ? 2 : 1, R.on || hot.rumble ? gc : FAINT);
  }
  // the kick itself: its cycles, filled under (the outline kept with the shape)
  var P = S.pts[hx0 + "/" + mid + "/" + amp];
  if (!P) {
    P = { t: [], b: [] };
    for (var i = 0; i < S.n; i++) { P.t.push(hx0 + i * 2, mid - S.hi[i] * amp); P.b.push(hx0 + i * 2, mid - S.lo[i] * amp); }
    S.pts[hx0 + "/" + mid + "/" + amp] = P;
  }
  // solid, as a recording's waveform is drawn: every column from its lowest to its highest
  var kc = hot.body ? "slot" : KICK;
  if (!P.e) { // the amplitude's outline over it: few points, smooth
    P.e = []; P.f = [];
    for (var ei = 0; ei < S.n; ei += 3) { P.e.push(hx0 + ei * 2, mid - S.env[ei] * amp); P.f.push(hx0 + ei * 2, mid + S.env[ei] * amp); }
  }
  g.area(P.t, mid + 1, hot.body ? "slot" : KICK_W); g.area(P.b, mid, hot.body ? "slot" : KICK_W);
  g.poly(P.e, 2, kc); g.poly(P.f, 2, kc);
  // the click on its front: as loud as its level, falling over its decay
  if (K.att > 0.004) {
    var cw = Math.max(4, Math.min(w / 4, w * K.trs * 3 / span)), ch = (h / 2 - 2) * K.att * 0.67, cc = hot.trs ? "slot" : CLICK;
    var bt = burst(hx0, mid, cw, ch, 31, 2), bb = [];
    for (var j = 0; j < bt.length; j += 2) bb.push(bt[j], 2 * mid - bt[j + 1]);
    g.area(bt, mid, cc); g.area(bb, mid, cc);
  }
  var lbl = R.on ? "RUMBLE " + Math.round(R.vol * 100) + "%" : "RUMBLE OFF";
  g.text(HIT[0] + HIT[2] - 6, HIT[1] + 11, lbl, hot.rumble ? "slot" : R.on ? RUMB : DIMI, 1);
  g.text(HIT[0] + 74, HIT[1] + 11, Math.round(bpm) + " BPM  LENGTH " + ms(K.tau), hot.body ? "slot" : DIMI, -1);
}

// ---- each engine's own picture (in the engine box, or on its page) -------------------------------------------------------------
function besselJ(n, x) {
  var s = 0;
  for (var k = 0; k < 14; k++) {
    var d = 1, e = 1, j;
    for (j = 2; j <= k; j++) d *= j;
    for (j = 2; j <= k + n; j++) e *= j;
    s += (k & 1 ? -1 : 1) * Math.pow(x / 2, 2 * k + n) / (d * e);
  }
  return s;
}
// FM4's routing (fm4.c g_fm4_algo, g_fm4_carrier): who modulates whom, who is heard
var ALGO_MOD = [[1, 2, 3, -1], [1, -1, 3, -1], [3, 3, 3, -1], [3, -1, -1, -1]], ALGO_CAR = [[1, 0, 0, 0], [1, 0, 1, 0], [1, 1, 1, 0], [1, 1, 1, 0]];
var ALGO_NAMES = ["CHAIN", "STACKS", "BRIGHT", "HOLLOW"];
var WAVES6 = ["SINE", "TRI", "SAW", "SQR", "DIGI", "ANLG"];
function bar(g, x, y, w, f, col) { g.fill(x, y, w, 3, LED_OFF); g.fill(x, y, Math.max(0, Math.round(w * clamp(f, 0, 1))), 3, col); }
// FM4's flow, left to right into the output: [op, column, row] (fm4.c's
// g_fm4_algo and g_fm4_carrier: op 4 modulates, op 1 is always heard)
var ALGO_FLOW = [ // [op, column 0..3, row: 0 top, 1 bottom]; carriers on the bottom row feed the output under it
  [[4, 0, 1], [3, 1, 1], [2, 2, 1], [1, 3, 1]],
  [[4, 0, 1], [3, 1, 1], [2, 2, 1], [1, 3, 1]],
  [[4, 1.5, 0], [3, 0.5, 1], [2, 1.5, 1], [1, 2.5, 1]],
  [[4, 0.5, 0], [1, 0.5, 1], [2, 1.5, 1], [3, 2.5, 1]]];
var ALGO_WIRES = [[[4, 3], [3, 2], [2, 1]], [[4, 3], [2, 1]], [[4, 3], [4, 2], [4, 1]], [[4, 1]]];
function engineArt(g, v, m, x, y, w, h, live, t) {
  var col = live ? KICK : DIMI, lit = live ? INK : DIMI, side = live ? CLICK : DIMI, i;
  var hk = function (k) { return t === k; };
  if (m === 0) { // FM2: the spectrum at the strike: the carrier and its sidebands at |1 +- k RATIO|, as tall as J_k(INDEX)
    var ratio = 0.5 + 7.5 * frac(v, "fm_ratio", 0.1), ind = 8 * frac(v, "fm_index", 0.05), hot = hk("fm_ratio") || hk("fm_index");
    g.fill(x, y + h, w, 1, RULE);
    var J = cached("bessel|" + ind.toFixed(3), function () { var o = []; for (var n = 0; n <= 6; n++) o.push(Math.min(1, Math.abs(besselJ(n, ind)))); return o; });
    for (var s = -6; s <= 6; s++) {
      var f = Math.abs(1 + s * ratio);
      if (f > 16) continue;
      var xx = x + 4 + Math.log(1 + f) / Math.log(17) * (w - 8), hh = Math.round(J[Math.abs(s)] * (h - 12));
      if (hh > 0) g.fill(Math.round(xx) - 1, y + h - hh, 3, hh, hot ? "slot" : s === 0 ? col : side);
    }
    g.text(x + w, y + 7, "RATIO x" + ratio.toFixed(2), hk("fm_ratio") ? "slot" : lit, 1);
    g.text(x + w, y + 18, "INDEX " + ind.toFixed(1), hk("fm_index") ? "slot" : lit, 1);
    g.text(x + w, y + 29, "OP2 " + fmt("op2_wave", num(v, "op2_wave", 0)), hk("op2_wave") ? "slot" : LEG, 1);
    return;
  }
  if (m === 1) { // FM4: the four operators, the algorithm's wires, op 4's feedback
    var al = idx(v, "fm4_algo", 4), fb = frac(v, "fm4_feedback", 0.1), P = {}, ah = hk("fm4_algo");
    // operators as boxes 28 x 12, columns 52 px apart: nothing touches
    var BW = 28, BH = 12, cx0 = x + 18, cdx = (w - 44) / 3, ry = function (r) { return r ? y + h - 14 : y + 7; }, outY = y + h - 1;
    ALGO_FLOW[al].forEach(function (o) { P[o[0]] = [cx0 + o[1] * cdx, ry(o[2])]; });
    ALGO_WIRES[al].forEach(function (wv) {
      var a0 = P[wv[0]], b0 = P[wv[1]], wc = ah ? "slot" : LEG;
      if (Math.abs(a0[1] - b0[1]) < 1) g.line(a0[0] + BW / 2, a0[1], b0[0] - BW / 2 - 3, b0[1], 2, wc);   // along the row
      else g.line(a0[0] + (b0[0] - a0[0]) * 0.3, a0[1] + BH / 2, b0[0], b0[1] - BH / 2 - 2, 2, wc);       // down into it
      var hx = Math.abs(a0[1] - b0[1]) < 1 ? b0[0] - BW / 2 - 2 : b0[0], hy = Math.abs(a0[1] - b0[1]) < 1 ? b0[1] : b0[1] - BH / 2 - 1;
      g.dot(hx, hy, 2, wc);
    });
    var xs = [];
    [1, 2, 3, 4].forEach(function (o) { if (ALGO_CAR[al][o - 1]) xs.push(P[o][0]); });
    g.fill(Math.round(Math.min.apply(null, xs)) - 2, outY, Math.round(Math.max.apply(null, xs) - Math.min.apply(null, xs)) + 4, 2, col);
    [1, 2, 3, 4].forEach(function (o) {
      var c = P[o], car = ALGO_CAR[al][o - 1];
      if (car) g.fill(Math.round(c[0]) - 1, c[1] + BH / 2, 2, outY - c[1] - BH / 2, col);
      g.fill(Math.round(c[0] - BW / 2), Math.round(c[1] - BH / 2), BW, BH, car ? col : "#3a3f48");
      g.text(c[0], c[1] + 4, "OP" + o, car ? GROUND : lit, 0);
    });
    // op 4's feedback: a loop on its corner (the algorithm and the amount are in the box's heading)
    if (fb > 0.004) g.arc(P[4][0] + BW / 2, P[4][1] - BH / 2, 5, Math.PI * 0.5, Math.PI * 1.5, 2, hk("fm4_feedback") ? "slot" : side);
    return;
  }
  if (m === 3) { // PHY (phy.c): the head and the shell's two modes, where each rings, how loud, how long
    var p = clamp(num(v, "pitch", 50), 30, 200), sh = frac(v, "phy_shell", 0.5), ma = 0.3 + 0.7 * frac(v, "phy_beater", 0.5);
    var ring = 400 * Math.pow(60 / 400, frac(v, "phy_damping", 0.5));
    var modes = [[p * (0.75 + 0.5 * frac(v, "phy_headtens", 0.5)), 0.9, 1, "HEAD", "phy_headtens"], [p * (2 - 0.8 * sh), 0.5, 0.5, "SHELL", "phy_shell"],
      [p * (3 - 1.2 * sh), 0.25, 0.3, "", "phy_shell"]];
    var fx = function (f) { return x + 4 + Math.log(f / 20) / Math.log(32) * (w - 8); };
    g.fill(x, y + h, w, 1, RULE);
    [50, 100, 200, 400].forEach(function (f) { g.fill(Math.round(fx(f)), y + h + 1, 1, 3, FAINT); });
    for (i = 2; i >= 0; i--) {
      var mx_ = Math.round(fx(modes[i][0])), mh = Math.max(2, Math.round(modes[i][1] * ma * (h - 4))), mhot = hk(modes[i][4]) || hk("phy_beater");
      var tail = Math.round(Math.min(x + w - mx_, (w - 8) * ring * modes[i][2] / 400));
      g.fill(mx_, y + h - 3, tail, 2, hk("phy_damping") ? "slot" : i === 0 ? KICK_F : RULE);
      g.fill(mx_ - 2, y + h - mh, 4, mh, mhot ? "slot" : i === 0 ? col : side);
    }
    g.text(x, y + 7, "HEAD " + hz(modes[0][0]) + "  SHELL " + hz(modes[1][0]), hk("phy_shell") || hk("phy_headtens") ? "slot" : lit, -1);
    g.text(x + w, y + 18, "RINGS " + ms(ring / 1000), hk("phy_damping") ? "slot" : LEG, 1);
    return;
  }
  if (m === 4 || m === 5) { // HRD / DIG: one cycle through the steps its bits leave
    var bk = m === 4 ? "hrd_crush" : "dig_bitdepth", wk = m === 4 ? "hrd_sample" : "dig_waveidx", mk = m === 4 ? "hrd_mix" : "dig_sample";
    var bits = m === 4 ? 16 - 14 * frac(v, "hrd_crush", 0) : 14 - 8 * frac(v, "dig_bitdepth", 0.5);
    var lv = Math.pow(2, bits - 1), pts = [], my = y + 22 + (h - 22) / 2, amp = (h - 22) / 2 - 1;
    for (i = 0; i <= w; i += 2) {
      var q = Math.sin(2 * Math.PI * i / w);
      if (lv <= 48) q = Math.round(q * lv) / lv;
      pts.push(x + i, my - q * amp);
    }
    g.fill(x, my, w, 1, RULE);
    g.poly(pts, 2, hk(bk) ? "slot" : col);
    g.text(x, y + 7, fmt(wk, num(v, wk, 0)) + " LAYER " + Math.round(frac(v, mk, 0.5) * 100) + "%", hk(wk) || hk(mk) ? "slot" : lit, -1);
    g.text(x + w, y + 7, bits >= 15.9 ? "16 BIT" : bits.toFixed(1) + " BIT", hk(bk) ? "slot" : lit, 1);
    if (m === 4) g.text(x + w, y + 18, frac(v, "hrd_drive", 0.2) > 0.3 ? "DRIVE FOLDS" : "DRIVE SATURATES", hk("hrd_drive") ? "slot" : LEG, 1);
    else g.text(x + w, y + 18, "SWEEP x" + (0.25 + 1.5 * frac(v, "dig_pitchenv", 0.5)).toFixed(2), hk("dig_pitchenv") ? "slot" : LEG, 1);
    return;
  }
  // WTR, TRS, ANA, USR: their knobs as bars; WTR's scan across its six waves
  var rows = {
    2: [["wtr_wave", "SCAN"], ["wtr_bodypitch", "BODY"], ["wtr_transdec", "T DECAY"], ["wtr_transcol", "T COLOR"]],
    6: [["trs_tone", "TONE"], ["trs_tdec", "DECAY"], ["trs_wtcol", "SIN > SAW"], ["trs_curve", "SNAP"]],
    7: [["ana_morph", "MORPH"], ["ana_sublvl", "SUB"], ["ana_subdec", "SUB DECAY"], ["ana_sample", "SAMPLE"]],
    8: [["usr_wtmorph", "MORPH"], ["usr_layervol", "LAYER"], ["usr_pitchenv", "PITCH ENV"], ["usr_sample", "SAMPLE"]]
  }[m] || [];
  var ry0 = y;
  if (m === 2) { // the six factory waves WAVE scans across
    var sp = frac(v, "wtr_wave", 0.6), cw = w / 6, wh = hk("wtr_wave");
    for (i = 0; i < 6; i++) g.text(x + cw * i + cw / 2, y + 7, WAVES6[i], Math.round(sp * 5) === i ? (wh ? "slot" : lit) : DIMI, 0);
    g.fill(x, y + 11, w, 2, LED_OFF); g.fill(x + Math.round(sp * (w - 6)), y + 10, 6, 4, wh ? "slot" : col);
    rows = rows.slice(1); ry0 = y + 15;
  }
  for (i = 0; i < rows.length; i++) {
    var k = rows[i][0], yy = ry0 + 3 + i * (m === 2 ? 10 : 11);
    g.text(x, yy + 4, rows[i][1], hk(k) ? "slot" : LEG, -1);
    bar(g, x + 76, yy, w - 76 - 64, frac(v, k, 0), hk(k) ? "slot" : col);
    g.text(x + w, yy + 4, valueOf(v, k, m), hk(k) ? "slot" : lit, 1, 60);
  }
}

// which engine a page is about (-1: the kick's own pages)
function pageEngine(v) {
  var ps = v.$pages || [], p = String(ps[v.$page] || "");
  return MODELS.indexOf(p);
}
// the panel is a function of its values: all of it is one layer keyed by
// them, and a frame that only the sound moves (the playhead) is a copy and a line
var PANEL_KEYS = [];
function signature(v, keys) {
  var out = [v.$touched || "", (v.$knobs || []).join(","), v.$page, v.$segmode || "", v.$segment || "", (v.$pages || []).length,
    v.$live && v.$live.bpm > 20 ? Math.round(v.$live.bpm) : 120];
  for (var i = 0; i < keys.length; i++) { var x = v[keys[i]]; out.push(x && x.known ? x.value : "?"); }
  return out.join("|");
}
function frontPanel(g, v) {
  var m = modelOf(v), bpm = (v.$live && v.$live.bpm > 20) ? v.$live.bpm : 120, K = kickOf(v, m);
  g.layer("omega|" + signature(v, PANEL_KEYS), function () { panelBody(g, v, m, K, bpm); });
  // the playhead: the time since the last note, through the beat and down the dive
  var L = v.$live;
  if (L && L.known && L.since_on >= 0 && L.since_on < 60 / bpm) {
    var hx = HIT[0] + 8 + (HIT[2] - 16) * L.since_on / (60 / bpm);
    g.fill(Math.round(hx), HIT[1] + 15, 1, HIT[3] - 18, "mod");
    if (L.since_on < DIVE_T) g.dot(diveX(L.since_on), diveY(hzAt(K, L.since_on)), 3, "mod");
  }
}
function panelBody(g, v, m, K, bpm) {
  var seg = !!v.$segmode, t = v.$touched || "";
  panelGround(g, seg);
  // the engine strip
  for (var i = 0; i < 9; i++) {
    var on = i === m;
    if (on) g.fill(88 + i * 44, 4, 40, 14, t === "model" ? "slot" : KICK);
    g.text(108 + i * 44, 15, MODELS[i], on ? GROUND : DIMI, 0);
  }
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(952, 15, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  var hot = { dive: t === "curve" || t === "pitch" || t === "model", pitch: t === "pitch", trs: /^(attack|trs_dec|trs_tne)$/.test(t),
    body: t === "length", rumble: /^grv_/.test(t) };
  // a segment's heading lit as the encoders are on it
  var sg = v.$segmode === "segment" ? v.$segment : "";
  if (sg === "kick") g.text(DIVE[0] + 6, DIVE[1] + 11, "DIVE", INK, -1);
  if (sg === "rumble") g.text(HIT[0] + 6, HIT[1] + 11, "ONE BEAT", INK, -1);
  if (sg === "engine") g.text(ENG[0] + 6, ENG[1] + 11, "ENGINE", INK, -1);
  drawDive(g, v, K, hot);
  drawHit(g, v, K, bpm, hot);
  // the engine: the page's when the page is one, else the one playing
  var pe = pageEngine(v), em = pe >= 0 ? pe : m, live = em === m;
  g.value(ENG[0] + 62, ENG[1] + 12, MODELS[em], live ? (t === "model" ? "slot" : KICK) : DIMI, -1);
  // the heading's right: what the engine is, or for FM4 its algorithm and feedback; "NOT PLAYING" for another's page
  var head = live ? MODEL_NAMES[em] : "NOT PLAYING", hh = false;
  if (em === 1 && live) {
    var fbv = frac(v, "fm4_feedback", 0.1);
    head = ALGO_NAMES[idx(v, "fm4_algo", 4)] + (fbv > 0.004 ? "  FB " + Math.round(fbv * 70) + "%" : "");
    hh = t === "fm4_algo" || t === "fm4_feedback";
  }
  g.text(ENG[0] + ENG[2] - 6, ENG[1] + 11, head, hh ? "slot" : live ? LEG : DIMI, 1);
  // an engine's page gives its picture the whole box; elsewhere the filter and FX stand under it
  engineArt(g, v, em, ENG[0] + 8, ENG[1] + 17, ENG[2] - 16, pe >= 0 ? 54 : 44, live, t);
  if (pe < 0) {
    var fxOn = frac(v, "fx_amt", 0) > 0.004, fxt = up(txt(v, "fx_type") || "--");
    g.text(ENG[0] + 8, ENG[1] + ENG[3] - 5, "LPF " + hz(colorHz(m, frac(v, "color", 0.5))), t === "color" ? "slot" : LEG, -1);
    g.text(ENG[0] + ENG[2] - 6, ENG[1] + ENG[3] - 5, fxOn ? fxt + " " + Math.round(frac(v, "fx_amt", 0) * 100) + "%" : fxt + " OFF",
      /^fx_/.test(t) ? "slot" : fxOn ? CLICK : DIMI, 1);
  }
  var colors = { grv_vol: RUMB, grv_length: RUMB, grv_hpf: RUMB, grv_color: RUMB, grv_tap1: RUMB, grv_tap2: RUMB, grv_tap3: RUMB, grv_tap4: RUMB,
    attack: CLICK, trs_dec: CLICK, trs_tne: CLICK };
  encoderRow(g, v, m, colors);
}

var ENGINE_PAGES = MODELS.map(function (n, i) { return { label: n, keys: ENGINE_KEYS[i] }; });
var ALL_ENGINE_KEYS = [].concat.apply([], ENGINE_KEYS);

// Pung's own pages in the warehouse's colours, the knobs as rings in the kick's red
// keys Omega declares that do nothing: grv_type (Rumble/Seq) is read by nothing since v0.4,
// where rumble and sequence run together, each on its own volume (src/ui.c); gen_* are the GEN
// engine's, which the model list (FM2..USR) never offers. They had a page of leftovers.
push.unused(["grv_type", "gen_seed", "gen_scale", "gen_density", "gen_seqlen", "gen_lpffreq", "gen_lpfpole"]);
push.theme({ ground: PANEL, ink: INK, dim: LEG, rule: RULE, faint: LED_OFF, panel: "#22252c", accent: KICK, knob: "ring" });

var KICK_SPEC = {
  id: "kick", label: "Kick", front_panel: true, draws_segments: true,
  pages: [
    { label: "Kick", keys: ["model", "pitch", "length", "curve", "attack", "trs_dec", "trs_tne", "color"] },
    { label: "FX", keys: ["fx_type", "fx_amt", "fx_tone", "filter_route", "master_vol"] }
  ].concat(ENGINE_PAGES),
  segments: [
    { id: "kick", label: "Dive", rect: DIVE, keys: ["pitch", "curve", "length", "attack", "trs_dec", "trs_tne", "color", "model"] },
    { id: "rumble", label: "Rumble", rect: HIT, keys: ["grv_vol", "grv_length", "grv_hpf", "grv_color", "grv_tap1", "grv_tap2", "grv_tap3", "grv_tap4"] },
    { id: "engine", label: "Engine", rect: ENG, keys: ["model", "color", "fx_type", "fx_amt", "fx_tone", "filter_route", "master_vol"] }
  ],
  extra_keys: ["grv_vol", "grv_length", "grv_tap1", "grv_tap2", "grv_tap3", "grv_tap4"].concat(ALL_ENGINE_KEYS),
  screen: frontPanel
};
(function () { // every key the panel reads, once
  var seen = {}, add = function (k) { if (k && !seen[k]) { seen[k] = 1; PANEL_KEYS.push(k); } };
  KICK_SPEC.pages.forEach(function (p) { p.keys.forEach(add); });
  KICK_SPEC.segments.forEach(function (s) { s.keys.forEach(add); });
  KICK_SPEC.extra_keys.forEach(add);
})();
push.compartment(KICK_SPEC);

// ---- RUMBLE: the ghost kicks, each over its TAP -------------------------------------------------------------------------------------------
function bandGround(g, key, heads) {
  g.layer(key, function () {
    g.fill(0, 0, 952, 86, PANEL);
    for (var i = 0; i < heads.length; i++) { g.fill(heads[i][0], 0, heads[i][1], 1, heads[i][3]); g.text(heads[i][0] + 2, 10, heads[i][2], heads[i][3], -1); }
  });
}
function rumbleScreen(g, v) {
  bandGround(g, "rumble", [[0, 352, "THE BAND IT KEEPS", RUMB], [360, 592, "THE KICK AND ITS GHOSTS, A SIXTEENTH APART", RUMB]]);
  var t = v.$touched || "", m = modelOf(v), bpm = (v.$live && v.$live.bpm > 20) ? v.$live.bpm : 120, R = taps(v, bpm), K = kickOf(v, m);
  // the band: the high pass (1 pole, 20 Hz..2 kHz, off at the bottom) and the
  // 2-pole low pass COLOR (30 Hz..20 kHz) the ghosts go through
  var lpAt = Math.log(30 * Math.pow(20000 / 30, frac(v, "grv_color", 0.4375)) / 20) / Math.log(1000), ft = idx(v, "grv_filtype", 3);
  if (ft < 2) g.filter(0, 14, 352, 72, { cutoff: "grv_color", at: lpAt, type: ft ? "HP 12 dB" : "LP 12 dB", color: RUMB });
  else { g.fill(6, 40, 340, 2, RUMB); g.text(176, 34, "FILTER OFF", t === "grv_filtype" ? "slot" : LEG, 0); }
  var hp = frac(v, "grv_hpf", 0);
  if (hp > 0.001) {
    var fh = 20 * Math.pow(100, hp), xh = 6 + 340 * Math.log(fh / 20) / Math.log(1000), hh = t === "grv_hpf";
    g.fill(6, 22, Math.max(0, xh - 6), 56, hh ? "#3a2a10" : RUMB_D);
    g.fill(Math.round(xh), 22, 2, 56, hh ? "slot" : RUMB);
    g.text(xh + 5, 30, "HPF " + hz(fh), hh ? "slot" : RUMB, -1);
  } else g.text(10, 30, "HPF OFF", t === "grv_hpf" ? "slot" : DIMI, -1);
  // the beat: the kick at x 420, each ghost one sixteenth (120 px) on, over its TAP encoder
  var x0 = 420, q = 120, top = 18, base = 80, hgt = base - top, span = q / (R.spq) ; // px per second
  var S = hitShape(K, R.spq * 4.5, 540);
  // (S.env is per two pixels)
  g.fill(x0 - 56, base, 588, 1, RULE);
  for (var k = 1; k <= 4; k++) g.fill(x0 + k * q, top, 1, base - top, GRID);
  // the kick, small, in red
  var kp = [];
  for (var i = 0; i < 540; i += 4) kp.push(x0 + i, base - envAt(S, i) * hgt * 0.5);
  g.poly(kp, 2, KICK);
  g.text(x0 - 4, base - hgt * 0.5 - 3, "KICK", KICK, 1);
  // LENGTH's decay over the sixteenths: what each tap is multiplied by
  var dpts = [];
  for (var x = 0; x <= 4 * q; x += 4) dpts.push(x0 + x, base - Math.exp(-(x / q) * R.spq / R.tau) * hgt);
  var lh = t === "grv_length";
  for (var d = 2; d < dpts.length; d += 4) g.fill(dpts[d - 2], dpts[d - 1], 2, 2, lh ? "slot" : RUMB);
  // each ghost: its level after the decay, made up to equal power, at RUMBLE's volume
  for (k = 1; k <= 4; k++) {
    var tk = "grv_tap" + k, wk = R.w[k - 1] * R.norm * (R.on ? R.vol : 1), gx = x0 + k * q, hot = t === tk || t === "grv_vol" || lh;
    var gp = [];
    for (i = 0; i < Math.min(540 - k * q, 4.5 * q - k * q); i += 4) gp.push(gx + i, base - envAt(S, i) * Math.min(1.3, wk) * hgt * 0.7);
    if (gp.length > 3) { if (R.on) g.area(gp, base, RUMB_F); g.poly(gp, 2, hot ? "slot" : R.on ? RUMB : DIMI); }
    g.fill(gx - 1, base - 3, 3, 6, hot ? "slot" : R.on ? RUMB : DIMI);
  }
  g.text(946, 24, R.on ? "RUMBLE " + Math.round(R.vol * 100) + "%" : "RUMBLE OFF: TURN RUMBLE UP", t === "grv_vol" ? "slot" : R.on ? RUMB : LEG, 1);
  g.text(946, 36, "LENGTH " + ms(R.tau) + " AT " + Math.round(bpm) + " BPM", lh ? "slot" : DIMI, 1);
}

push.compartment({
  id: "rumble", label: "Rumble",
  pages: [
    { label: "Rumble", keys: ["grv_vol", "grv_length", "grv_hpf", "grv_color", "grv_tap1", "grv_tap2", "grv_tap3", "grv_tap4"], screen: rumbleScreen },
    { label: "Rumble FX", keys: ["grv_drive", "grv_lfospd", "grv_lfoamt", "grv_route", "grv_rvmix", "grv_rvdecay", "grv_rvtone", "grv_rvtype"] },
    { label: "Rumble Out", keys: ["grv_filtype", "grv_mono"] },
    { label: "Space", keys: ["grv_rvrmb", "grv_rvseq", "grv_rvkick", "grv_rvdly", "grv_dlysend", "grv_dlytime", "grv_dlyfb", "grv_dlytone"] }
  ],
  extra_keys: ["model", "pitch", "length", "curve", "attack", "trs_dec", "grv_filtype"]
});

// ---- SEQUENCE: the line as beads on a string -------------------------------------------------------------------------------------------
var AL = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function steps(s) {
  if (typeof s !== "string" || !s.length) return null;
  var out = [];
  for (var i = 0; i < s.length && i < 64; i++) {
    var c = s.charAt(i);
    if (c === ".") { out.push(null); continue; }
    var n = AL.indexOf(c);
    if (n < 0) return null;
    out.push({ semi: (n % 31) - 15, acc: n >= 31 });
  }
  return out;
}
var VOICES = ["BASIC", "DETUNE", "FM", "ACID SAW", "ACID SQR", "DIRT", "DIRT 2", "BLEEP", "STAB"];
function seqScreen(g, v) {
  bandGround(g, "seq", [[0, 952, "THE SEQUENCE", SEQ]]);
  var t = v.$touched || "", st = steps(v.grv_gview ? String(v.grv_gview.value || "") : ""), cur = known(v, "grv_gstep") ? Math.round(num(v, "grv_gstep", -1)) : -1;
  var on = num(v, "grv_genvol", 0) > 0.004;
  g.text(946, 10, (on ? "SEQ " + Math.round(Math.min(1, num(v, "grv_genvol", 0)) * 100) + "%" : "SEQ OFF: TURN SEQ VOL UP") + "   " +
    VOICES[idx(v, "grv_gvoice", 9)] + "   " + up(txt(v, "grv_gscale")) + " FROM " + (known(v, "grv_groot") ? hz(num(v, "grv_groot", 45)) : "--"),
    t === "grv_genvol" ? "slot" : on ? SEQ : LEG, 1);
  if (!st) { g.text(476, 50, "NO PATTERN READ YET", DIMI, 0); return; }
  var n = st.length, x0 = 12, w = 928, cw = w / n, top = 22, bot = 76, mid = (top + bot) / 2;
  function yOf(s) { return mid - clamp(s, -15, 15) / 15 * (bot - top) / 2; }
  g.fill(x0, mid, w, 1, GRID);
  g.text(x0, mid - 3, "ROOT", DIMI, -1);
  var thread = [];
  for (var i = 0; i < n; i++) thread.push(x0 + (i + 0.5) * cw, st[i] ? yOf(st[i].semi) : bot + 4);
  g.poly(thread, 1, SEQ_D);
  var hotPat = /^grv_g(seed|seqlen|density|rotate|pattern|accent|octjump)$/.test(t);
  for (i = 0; i < n; i++) {
    var cx = x0 + (i + 0.5) * cw, s = st[i], now = i === cur;
    if (i % 4 === 0) g.fill(Math.round(x0 + i * cw), bot + 7, 1, 3, FAINT);
    if (!s) { g.fill(Math.round(cx) - 2, bot + 2, 5, 3, now ? "mod" : LEG); continue; }
    var r = Math.max(2, Math.min(6, cw / 3)) * (s.acc ? 1.35 : 1), y = yOf(s.semi);
    if (s.acc) g.dot(cx, y, r, now ? "mod" : hotPat ? "slot" : SEQ);
    else { g.dot(cx, y, r, now ? "mod" : hotPat ? "slot" : SEQ); g.dot(cx, y, Math.max(1, r - 2), PANEL); }
  }
  if (cur >= 0 && cur < n) g.fill(Math.round(x0 + cur * cw), bot + 7, Math.max(2, Math.round(cw)), 3, "mod");
}
push.compartment({
  id: "sequence", label: "Sequence",
  pages: [
    { label: "Sequence", keys: ["grv_genvol", "grv_gscale", "grv_groot", "grv_grange", "grv_gretrig", "grv_gnotelen", "grv_gswingamt", "grv_gentaps"] },
    { label: "Pattern", keys: ["grv_gseed", "grv_gseqlen", "grv_gdensity", "grv_grotate", "grv_gpattern", "grv_gaccent", "grv_goctjump", "grv_gswing"] },
    { label: "Variation", keys: ["grv_gratchet", "grv_gslide", "grv_gnrand", "grv_gloop", "grv_gvoice", "grv_genfilt", "grv_grootnote"] },
    { label: "Voices 1", keys: ["grv_gwave", "grv_gfold", "grv_gdtwave", "grv_gdetune", "grv_gfmwave", "grv_gfmamt", "grv_gasres", "grv_gasenv"] },
    { label: "Voices 2", keys: ["grv_gaqres", "grv_gaqenv", "grv_gd1noise", "grv_gd1nfm", "grv_gd2fm", "grv_gd2nfm", "grv_gblwave", "grv_gblip"] },
    { label: "Voices 3", keys: ["grv_gstwave", "grv_gchord"] }
  ],
  extra_keys: ["grv_gview"], live_keys: ["grv_gstep"],
  screen: seqScreen
});

// ---- PERFORMER: the pump, the ducked band, the DJ filter, the knee -------------------------------------------------------------------------
function perfScreen(g, v) {
  bandGround(g, "perf", [[0, 116, "OUT", KICK], [120, 476, "THE PUMP", RUMB], [600, 236, "DJ FILTER", KICK], [840, 112, "CMPDR", KICK]]);
  var t = v.$touched || "", bpm = (v.$live && v.$live.bpm > 20) ? v.$live.bpm : 120;
  // OUT: the master volume, a column of 16 LEDs
  var mv = frac(v, "master_vol", 1), lit = Math.round(mv * 16);
  for (var i = 0; i < 16; i++) g.fill(40, 78 - i * 4, 36, 3, i < lit ? (t === "master_vol" ? "slot" : i > 13 ? CLICK : KICK) : LED_OFF);
  // the pump (dsp.c perf_config, render): a kick sets the duck to full; it
  // falls back over DUCK REL; the gain follows it at DUCK SLEW's pace
  var depth = 1 - Math.pow(1 - frac(v, "duck", 0.5), 2.5), rel = 0.01 + 0.49 * frac(v, "duck_rel", 0.4), smt = frac(v, "duck_smt", 0.3);
  var key = ["pump", depth.toFixed(3), rel.toFixed(4), smt.toFixed(3), Math.round(bpm)].join("|");
  var x0 = 128, w = 460, top = 18, base = 78, beat = 60 / bpm;
  var pts = cached(key, function () {
    var a = 0.02 + (1 - smt) * 0.6, gs = 1, out = [], T = 4 * beat, per = T / w, sub = Math.max(1, Math.round(per * SR / 128)), dt = per / sub;
    // per look: the duck falls by e^(-dt/REL), the gain closes (1-a)^(samples) of its gap
    var envStep = Math.exp(-dt / rel), gainStep = Math.pow(1 - a, dt * SR), envc = 1, nextKick = 0, tt = 0;
    for (var x = 0; x <= w; x += 2) {
      for (var s = 0; s < sub * 2; s++) {
        if (tt >= nextKick) { envc = 1; nextKick += beat; }
        envc *= envStep;
        var target = 1 - depth * envc;
        gs = target + (gs - target) * gainStep;
        tt += dt;
      }
      out.push(x0 + x, base - gs * (base - top));
    }
    return out;
  });
  g.fill(x0, top, w, 1, GRID); g.fill(x0, base, w, 1, RULE);
  for (var k = 0; k < 4; k++) { g.fill(x0 + k * w / 4, top, 2, base - top, KICK_F); }
  g.area(pts, base, RUMB_F);
  g.poly(pts, 2, /^duck/.test(t) && t !== "duck_bs" ? "slot" : RUMB);
  g.text(x0 + w, 10, Math.round(depth * 100) + "% DOWN, BACK OVER " + ms(rel * 5) + ", BELOW " + hz(20 * Math.pow(1000, Math.pow(frac(v, "duck_bs", 0.5), 0.6))), /^duck/.test(t) ? "slot" : LEG, 1);
  // the DJ filter: low pass under the middle, high pass over it, off between
  var dj = frac(v, "dj_filt", 0.5), dh = t === "dj_filt" || t === "dj_reso";
  if (dj < 0.48 || dj > 0.52) {
    var lp = dj < 0.48, fc = lp ? 120 * Math.pow(150, dj / 0.48) : 30 * Math.pow(100, (dj - 0.52) / 0.48);
    g.filter(600, 14, 236, 72, { cutoff: "dj_filt", at: Math.log(fc / 20) / Math.log(1000), resonance: "dj_reso", type: lp ? "LP 12 dB" : "HP 12 dB", color: KICK });
  } else {
    g.fill(606, 50, 224, 2, dh ? "slot" : DIMI);
    g.text(718, 40, "OPEN: THE MIDDLE IS OFF", dh ? "slot" : LEG, 0);
  }
  // CMPDR: the transfer, the threshold falling as the makeup rises
  var a2 = frac(v, "cmpdr", 0), thr = 1 - a2 * 0.75, mk = 1 + a2 * 1.5, cx = 852, cw2 = 88, cy = 80, ch = 62, cp = [];
  for (var j = 0; j <= 22; j++) {
    var xin = j / 22, yo = xin <= thr ? xin : thr + (xin - thr) / 4;
    cp.push(cx + xin * cw2, cy - Math.min(1.25, yo * mk) / 1.25 * ch);
  }
  g.fill(cx, cy, cw2, 1, RULE); g.fill(cx, cy - ch, 1, ch, RULE);
  g.poly(cp, 2, t === "cmpdr" ? "slot" : a2 > 0.004 ? KICK : DIMI);
  if (a2 <= 0.004) g.text(cx + cw2 / 2, cy - 30, "OFF", DIMI, 0);
}
push.compartment({
  id: "performer", label: "Performer",
  pages: [{ label: "Performer", keys: ["master_vol", "duck", "duck_rel", "duck_smt", "duck_bs", "dj_filt", "dj_reso", "cmpdr"] }],
  screen: perfScreen
});
