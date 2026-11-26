// Crest (an 8-voice hybrid polysynth) on Push.
// An overlay shipped with Pung (Crest ships no push_ui.js).
//
// Crest's own panel (src/web/panel.js) is a graphite front panel of headed sections, its traces
// cream on black wells, its one accent a signal red, its patch name in an ice-blue display. The
// screens follow it, section by section, as one voice runs (README, "How it works"):
//
//   PANEL      the whole voice at once: three oscillators (the real wave each plays), the FM
//              between them, the mixer, the filter, the amp envelope, the effects chain in its
//              order; its encoders the panel's knobs, its sections the segments
//   OSC 1..3   the wave as a waterfall of its sixteen frames (a wavetable's own, read from the
//              module's WT_DATA; a classic wave's Shape sweep), the frame Shape plays lit, where
//              the shape source takes it, and the wave as it leaves the oscillator (density
//              copies, virtual sync)
//   FM         the cross-modulation ring: noise into 1, 1 into 2, 2 into 3, 3 back into 1, and
//              what Osc 3 and the noise do to the cutoff, each as its phase-modulation index
//   MIXER      Pung's mixer of the five sources; the noise colour, the overdrive before the
//              filter and the distortion after it, each the curve the engine applies
//   FILTER     the response at its cutoff, and where each modulation source takes the cutoff,
//              in semitones on the same axis
//   ENVELOPES  Amp, Mod 1 and Mod 2 together, each with the engine's own curves and times
//   LFOS       the four LFOs, where each one goes
//   EFFECTS    distortion, then chorus, delay and reverb in the routed order (or parallel),
//              each drawn as it acts: the transfer curve, the voices, the echoes, the tail
//
// Every number and curve comes from the module's source (src/dsp: env.c, osc.c, voice.c,
// lfo.c, fx.c, params.c; the display laws of tools/gen/params.py and src/web/format.js).

function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function idx(v, k, n, d) { return Math.max(0, Math.min(n - 1, Math.round(num(v, k, d || 0)))); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// ---- the panel's colours (src/web/style.css) ------------------------------------------------------
var BG = "#161719", PANEL = "#232427", PANEL2 = "#2b2c30", EDGE = "#3a3b40", WELL = "#0f1012", GRID = "#2e3036";
var TEXT = "#e9e7e2", LABEL = "#c9c7c1", DIM = "#8c8e94", FAINT = "#5a5c62", ACC = "#ff4a36", ACC_DK = "#7a2c24";
var TRACE = "#f4f1ea", TRACE_DIM = "#6d6f76", FILL = "#4a2420", SCREEN = "#05080b", SCREEN_FG = "#bfe6ff", SCREEN_DIM = "#5f7f93";
var CAP = "#2f3034", CAP_RIM = "#4a4b51", MODC = "#6fc3f2", MOD_DK = "#24465a";
// Where the sound has a control now (v[k].now: the module's live_mod, the newest voice's and the
// effects' while a note sounds), 0..1 of its range; null when nothing moves it. The knob's own mark
// stays where the knob is; the sound's place goes beside it in the modulation colour.
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? Math.max(0, Math.min(1, v[k].now)) : null; }
function moved(v, k) { var n = nowOf(v, k); return n !== null && Math.abs(n - v[k].frac) > 0.004; }
// the value where the sound has it, in the key's own units (the knob's while nothing moves it)
function numNow(v, k, d) { return moved(v, k) ? +v[k].min + nowOf(v, k) * (+v[k].max - +v[k].min) : num(v, k, d); }
// on a horizontal track (x, y, w): a line from the knob's place to the sound's, a dot
function hMark(g, v, k, x, y, w) {
  if (!moved(v, k)) return;
  var f = v[k].frac, n = nowOf(v, k);
  g.fill(x + w * Math.min(f, n), y, Math.max(1, w * Math.abs(n - f)), 1, MOD_DK);
  g.dot(x + w * n, y + 0.5, 3, MODC);
}
// the levels for g.mix: the sound's where modulation moves them, else the keys
function mixNow(v, ks) { return ks.map(function (k) { return moved(v, k) ? nowOf(v, k) : k; }); }

// ---- readings in real units (tools/gen/params.py DISP, src/web/format.js) -------------------------
var TABLES = ["Glass", "Reed", "Vowel", "Digital", "Bell", "Organ", "PWM Sweep", "Sync Sweep", "Formant", "Metal", "Additive",
  "Sub Bass", "Harsh", "Pluck", "Choir", "Grit", "Morph", "BS sine", "Random", "Zing", "Tubey", "Octaves", "Wobbler", "Chords",
  "Didgery", "E. Piano", "VoxOooEe", "VoxYahEe", "Winds", "SoftClav", "String", "BassOrgn", "Acid", "Buzzy", "Carousel", "Choral",
  "Climbing", "CoinFlip", "Deep", "Dub", "Eee", "Eris", "Flame", "Further", "GlassSaw", "Glassy", "Granular", "Grime", "Drow",
  "Heavy", "Hedge", "Hungry", "Ladders", "Lead", "Modeling", "Modem", "Monster", "Screech", "SeaBase", "Shmorgan", "Spirals",
  "Steel", "Sunrise", "Swell", "Thicker", "Thinner", "Tides", "Tokyo", "Tops", "V.Chord", "Variance", "Vocaloid", "Vowelled",
  "WeirdVox", "Yeah"];
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(n) { return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
function trim(x, d) { var s = x.toFixed(d); if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s; }
// [number, unit] in the module's own units
function unitOf(x, u) {
  var a = Math.abs(x);
  if (u === "s") return a < 1 ? [trim(x * 1000, a < 0.01 ? 1 : 0), "ms"] : [trim(x, a < 10 ? 2 : 1), "s"];
  if (u === "ms") return a >= 1000 ? [trim(x / 1000, 2), "s"] : [trim(x, a < 10 ? 1 : 0), "ms"];
  if (u === "Hz") return a >= 1000 ? [trim(x / 1000, a >= 10000 ? 1 : 2), "kHz"] : [trim(x, a < 1 ? 3 : a < 10 ? 2 : a < 100 ? 1 : 0), "Hz"];
  if (u === "x") return ["x" + trim(x, 2), ""];
  return [trim(x, a < 10 ? 1 : 0), u];
}
function envTime(x, tmax) { return 0.0005 * Math.pow(tmax / 0.0005, clamp(x, 0, 1)); }   // env.c env_time
function relTime(x) { return envTime(Math.pow(clamp(x, 0, 1), 0.6), 25); }                  // env_release_time
function edly(x) { return x <= 0 ? 0 : 0.001 * Math.pow(10000, clamp(x, 0, 1)); }          // env.c delay_time
function cutHz(x) { return 440 * Math.pow(2, (20 + 115 * x - 69) / 12); }
function lfoHz(x, range) { return (range === 1 ? 0.16 : 0.02) * Math.pow(10000, x); }      // lfo.c, Low/High
var DISP = {};
[1, 2, 3].forEach(function (n) {
  var p = "o" + n + "_";
  DISP[p + "penv"] = ["cube", 96, "st"]; DISP[p + "plfo"] = ["cube", 60, "st"]; DISP[p + "ddet"] = ["cube", 35, "ct"];
  DISP[p + "vsync"] = ["exp", 1, 16, "x"]; DISP[p + "fixed"] = ["note"]; DISP[p + "table"] = ["table"];
});
["fm_12", "fm_23", "fm_31", "fm_n1"].forEach(function (k) { DISP[k] = ["fm"]; });
var D2 = { flt_cut: ["cut"], flt_env: ["cube", 96, "st"], flt_ae: ["cube", 96, "st"], flt_lfo: ["cube", 96, "st"], flt_vel: ["lin", 0, 48, "st"],
  flt_div: ["lin", 0, 12, "st"], v_udet: ["udet"], v_glide: ["glide"], v_div: ["lin", 0, 40, "ct"], dst_tone: ["exp", 1500, 20000, "Hz"],
  cho_rate: ["exp", 0.05, 8, "Hz"], cho_dly: ["lin", 3, 30, "ms"], dly_time: ["exp", 10, 2000, "ms"], dly_lp: ["exp", 1000, 20000, "Hz"],
  dly_hp: ["exp", 20, 2000, "Hz"], rev_decay: ["exp", 0.2, 20, "s"], rev_hp: ["exp", 20, 1000, "Hz"], rev_pre: ["lin", 0, 500, "ms"],
  l3_rate: ["exp", 0.02, 1600, "Hz"], l4_rate: ["exp", 0.02, 1600, "Hz"] };
for (var dk in D2) DISP[dk] = D2[dk];
DISP.mac_sel = DISP.arp_rhy = ["plus1"]; DISP.preset = ["factory"]; // counted from 1, as the screens count them
var FACTORY = ["Init Saw", "Three Saws", "Warm Pad", "Sub Bass", "Pluck Keys", "Lead Saw", "Ring Bell", "Noise Sweep", "Pulse Brass",
  "Hollow Triangle", "Dirty Bass"]; // factory_presets.c
DISP.flt_o3 = DISP.flt_ns = ["oct"]; // 2^(3 x mod) on the cutoff (voice.c): up to 3 octaves either way
["ae", "m1", "m2"].forEach(function (e) {
  DISP[e + "_a"] = ["env", 20]; DISP[e + "_d"] = ["env", 22]; DISP[e + "_r"] = ["rel"];
  DISP[e + "_dly"] = ["edly"]; DISP[e + "_hold"] = ["lin", 0, 500, "ms"]; DISP[e + "_rep"] = ["rep", 127]; DISP[e + "_vel"] = ["bip"];
});
[1, 2, 3, 4].forEach(function (n) {
  DISP["l" + n + "_rep"] = ["rep"]; DISP["l" + n + "_dly"] = ["ldly"]; DISP["l" + n + "_fade"] = ["lfade"]; DISP["l" + n + "_phase"] = ["lin", 0, 360, "deg"];
});
var PCT = /^(o\d_(shape|dens)|mx_\w+|flt_(res|drive|key)|(ae|m1|m2)_s|v_(spread|drift)|patch_vol|vca_gain|l\d_slew|mac\d|fx_(dry|wet)|dst_(lvl|mix)|cho_(lvl|depth)|dly_(lvl|fb)|rev_(lvl|size|damp)|pre_od|post_dist|arp_(gate|swing))$/;
var BIP = /^(o\d_shamt|noise_col|cho_fb|mm_dep|mac_amt)$/;
function signed(s, x) { return (x > 0 ? "+" : x < 0 ? "-" : "") + s; }
// a value in Crest's terms: [number, unit], a word, or null (Pung's own)
function fmt(k, x) {
  var f = DISP[k];
  if (!f) {
    if (PCT.test(k)) return [String(Math.round(x * 100)), "%"];
    if (BIP.test(k)) return [signed(String(Math.round(Math.abs(x) * 100)), x), "%"];
    return null;
  }
  switch (f[0]) {
  case "env": return unitOf(envTime(x, f[1]), "s");
  case "rel": return unitOf(relTime(x), "s");
  case "edly": return x <= 0 ? "Off" : unitOf(edly(x), "s");
  case "ldly": return x <= 0 ? "Off" : unitOf(0.005 * Math.pow(2000, x), "s");
  case "lfade": return x > 0.001 ? unitOf(x * 10, "s") : "Off";
  case "rep": var r = Math.round(x); return r <= 0 ? "Off" : f[1] && r >= f[1] ? "Loop" : "x" + r;
  case "cut": return unitOf(cutHz(x), "Hz");
  case "glide": var gl = 5.6 * Math.pow(x, 5); return gl <= 0.0005 ? "Off" : unitOf(gl, "s");
  case "udet": return [signed(trim(Math.abs(50 * x * x * x), 1), x), "ct"];
  case "fm": return x <= 0 ? "Off" : "Index " + trim(1.5 * x * x * 2 * Math.PI, 2);
  case "cube": var c = f[1] * x * x * x, u = unitOf(Math.abs(c), f[2]); return [signed(u[0], c), u[1]];
  case "exp": return unitOf(f[1] * Math.pow(f[2] / f[1], x), f[3]);
  case "lin": return unitOf(f[1] + (f[2] - f[1]) * x, f[3]);
  case "note": return x <= 0 ? "Off" : noteName(Math.round(x));
  case "oct": return [signed(trim(Math.abs(3 * x), 2), x), "oct"];
  case "bip": return [signed(String(Math.round(Math.abs(x) * 100)), x), "%"];
  case "table": return TABLES[Math.round(x)] || null;
  case "plus1": return String(Math.round(x) + 1);
  case "factory": return FACTORY[Math.round(x)] || null;
  }
  return null;
}
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmt(key, n);
  if (f === null || f === undefined) return;
  return typeof f === "string" ? f : { value: f[0], unit: f[1] };
});
// The encoders' names in the row under a band screen and on Pung's pages: the page already says
// what they belong to (OSC 1, AMP ENV, LFO 2, REVERB), so each knob is named by what it does there.
var SHORT = { mx_o1: "Level 1", mx_o2: "Level 2", mx_o3: "Level 3", mx_noise: "Noise", mx_ring: "Ring", noise_col: "Colour",
  pre_od: "Overdrive", post_dist: "Post Dist", fm_12: "1 > 2", fm_23: "2 > 3", fm_31: "3 > 1", fm_n1: "Noise > 1",
  flt_type: "Type", flt_cut: "Cut", flt_res: "Resonance", flt_drive: "Drive", flt_key: "Key Trk", flt_env: "Env 1",
  flt_lfo: "LFO 1", flt_vel: "Velocity", flt_ae: "Amp Env", flt_o3: "Osc 3", flt_ns: "Noise", flt_div: "Diverge",
  ae_dly: "Amp", m1_dly: "Mod 1", m2_dly: "Mod 2", v_mode: "Mode", v_unison: "Unison", v_udet: "Detune", v_spread: "Spread",
  v_glide: "Glide", v_gmode: "Glide Mode", v_bend: "Bend", v_oct: "Octave", v_div: "Diverge", v_drift: "Drift",
  osc_reset: "Osc Phase", vca_gain: "VCA Gain", patch_vol: "Volume", fx_route: "Route", fx_dry: "Dry", fx_wet: "Wet",
  dst_lvl: "Drive", arp_on: "Arp", arp_scale: "Scale", arp_rhy: "Rhythm", arp_oct: "Octaves", arp_ksync: "Key Sync",
  mm_slot: "Slot", mm_s1: "Source 1", mm_s2: "Source 2", mm_dst: "Dest", mm_dep: "Depth", mm_clear: "Clear",
  mac_sel: "Macro", mac_k: "Assign", mac_dst: "Dest", mac_amt: "Amount", preset: "Factory", syx_patch: "Peak Patch",
  syx_file: "Peak Bank", anim1_mode: "Anim 1 Mode", anim2_mode: "Anim 2 Mode" };
var SHORT_O = { wave: "Wave", table: "Table", shape: "Shape", shsrc: "Src", shamt: "Shape Mod", dens: "Density", ddet: "Detune",
  vsync: "V-Sync", coarse: "Coarse", fine: "Fine", penv: "Env 2", plfo: "LFO 2", fixed: "Fixed" };
var SHORT_E = { a: "Attack", d: "Decay", s: "Sustain", r: "Release", hold: "Hold", vel: "Velocity", rep: "Repeats", trig: "Trigger" };
var SHORT_L = { wave: "Wave", rate: "Rate", sync: "Sync", phase: "Phase", dly: "Delay", fade: "Fade", slew: "Slew", trig: "Mode",
  range: "Range", rep: "Repeats", fmode: "Type", mtrig: "Mono" };
function shortName(k) {
  if (SHORT[k]) return SHORT[k];
  var m = /^o\d_(\w+)$/.exec(k);
  if (m && SHORT_O[m[1]]) return SHORT_O[m[1]];
  m = /^(ae|m1|m2)_(\w+)$/.exec(k);
  if (m && SHORT_E[m[2]]) return SHORT_E[m[2]];
  m = /^l\d_(\w+)$/.exec(k);
  if (m && SHORT_L[m[1]]) return SHORT_L[m[1]];
  m = /^(dst|cho|dly|rev|arp)_(\w+)$/.exec(k);
  if (m) return { lvl: "Level", type: "Type", tone: "Tone", mix: "Mix", rate: "Rate", depth: "Depth", dly: "Delay", fb: "Feedback",
    time: "Time", sync: "Sync", mode: "Mode", lp: "LP", hp: m[1] === "rev" ? "Low Cut" : "HP", size: "Size", decay: "Decay",
    damp: "Damping", pre: "Pre-delay", gate: "Gate", swing: "Swing", latch: "Latch" }[m[2]];
}
push.short(function (key) { return shortName(key); });

// the value as a screen prints it; an LFO's rate needs its range, a synced one says so
function val(v, k) {
  if (!known(v, k)) return "--";
  var x = num(v, k, 0), m = /^l([12])_rate$/.exec(k);
  if (m) return idx(v, "l" + m[1] + "_sync", 36) > 0 ? txt(v, "l" + m[1] + "_sync").toUpperCase() : up(unitOf(lfoHz(x, idx(v, "l" + m[1] + "_range", 2)), "Hz").join(" "));
  if (/^l[34]_rate$/.test(k) && idx(v, k.slice(0, 3) + "sync", 36) > 0) return up(txt(v, k.slice(0, 3) + "sync"));
  if (k === "dly_time" && idx(v, "dly_sync", 17) > 0) return up(txt(v, "dly_sync"));
  if (/^o\d_wave$/.test(k)) return ["SINE", "TRI", "SAW", "PULSE", "TABLE"][Math.round(x)] || "--";
  if (v[k].type === "enum") return up(txt(v, k));
  var f = fmt(k, x);
  if (f === null || f === undefined) {
    var u = v[k].unit ? " " + v[k].unit : "";
    if (/_(coarse|fine)$|^v_(bend|oct)$/.test(k)) return (x > 0 ? "+" : "") + Math.round(x) + up(u);
    return up(txt(v, k));
  }
  return typeof f === "string" ? up(f) : up(f[1] ? f[0] + " " + f[1] : f[0]);
}

// ---- the oscillators' waves (osc.c) --------------------------------------------------------------
// The wavetables are the module's own WT_DATA (src/dsp/wavetables.c): 75 tables of 16 frames, each
// frame here its 64-sample mip level (the one the engine plays at 1.4 kHz), 6 bits, normalised per
// table. Shape moves between frames as wt_read does: linear between the two nearest.
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", B64I = [];
for (var bi = 0; bi < 128; bi++) B64I.push(0);
for (bi = 0; bi < 64; bi++) B64I[B64.charCodeAt(bi)] = bi / 31.5 - 1;
var WTD = [];
function frames(t) {
  if (WTD[t]) return WTD[t];
  var s = WT[t] || "", out = [], f, i;
  for (f = 0; f < 16; f++) {
    var a = new Array(64);
    for (i = 0; i < 64; i++) a[i] = B64I[s.charCodeAt(f * 64 + i) & 127];
    out.push(a);
  }
  return (WTD[t] = out);
}
function wtAt(t, shape, ph) {
  var fr = frames(t), fp = clamp(shape, 0, 1) * 15, f0 = Math.min(14, Math.floor(fp)), mx = fp - f0;
  var pos = (ph - Math.floor(ph)) * 64, i = Math.floor(pos) & 63, j = (i + 1) & 63, k = pos - Math.floor(pos);
  var a = fr[f0][i] + (fr[f0][j] - fr[f0][i]) * k, b = fr[f0 + 1][i] + (fr[f0 + 1][j] - fr[f0 + 1][i]) * k;
  return a + (b - a) * mx;
}
// the classic waves at their Shape, as osc.c makes them (naive: the picture needs no band limit)
function classic(w, shape, t) {
  t = t - Math.floor(t);
  if (w === 0) return Math.sin(2 * Math.PI * t + 2.2 * shape * shape * Math.sin(2 * Math.PI * t));
  if (w === 1) { var r = 0.5 - 0.49 * shape; return t < r ? -1 + 2 * t / r : 1 - 2 * (t - r) / (1 - r); }
  if (w === 2) { var a = 2 * t - 1; if (shape <= 0.0005) return a; var t2 = t + 0.5 * shape; if (t2 >= 1) t2 -= 1; return 0.5 * (a + 2 * t2 - 1); }
  var pw = 0.5 - 0.47 * shape; return t < pw ? 1 : -pw / (1 - pw);
}
function waveAt(w, tab, shape, t) { return w === 4 ? wtAt(tab, shape, t) : classic(w, shape, t); }
var WAVES = ["SINE", "TRI", "SAW", "PULSE", "WAVETABLE"];
function oscOf(v, n) {
  var p = "o" + n + "_";
  return { n: n, p: p, ok: known(v, p + "wave"), wave: idx(v, p + "wave", 5, 2), table: idx(v, p + "table", 75), shape: clamp(num(v, p + "shape", 0), 0, 1),
    dens: num(v, p + "dens", 0), ddet: num(v, p + "ddet", 0.3), vsync: num(v, p + "vsync", 0), level: num(v, "mx_o" + n, 0),
    coarse: num(v, p + "coarse", 0), fine: num(v, p + "fine", 0), fixed: num(v, p + "fixed", 0), shsrc: idx(v, p + "shsrc", 3), shamt: num(v, p + "shamt", 0) };
}
// an oscillator as the sound has it now: shape, density, sync and level where modulation moves them
function liveOsc(v, o) {
  var l = {}, p = o.p;
  for (var f in o) l[f] = o[f];
  l.shape = clamp(numNow(v, p + "shape", o.shape), 0, 1); l.dens = numNow(v, p + "dens", o.dens);
  l.vsync = numNow(v, p + "vsync", o.vsync); l.level = numNow(v, "mx_o" + o.n, o.level);
  return l;
}
function waveName(o) { return o.wave === 4 ? up(TABLES[o.table] || "") : WAVES[o.wave]; }
// what reaches the mixer: virtual sync restarts the wave 2^(4 vsync) times faster each cycle;
// density (classic waves only) adds three copies detuned by +-ddet^3 * 35 cents, each faded in
// over a third of the knob, the sum normalised as osc.c does
function oscOut(o, t) {
  var r = Math.pow(2, 4 * o.vsync), base = function (ph) { return waveAt(o.wave, o.table, o.shape, o.vsync > 0.001 ? (ph * r) % 1 : ph); };
  var y = base(t);
  if (o.wave === 0 || o.wave === 4 || o.dens <= 0.001) return y;
  var OFF = [-1, 1, -0.5], dd = o.ddet * o.ddet * o.ddet * 35, norm = 1;
  for (var k = 0; k < 3; k++) {
    var lv = clamp(o.dens * 3 - k, 0, 1);
    if (lv <= 0.001) continue;
    // a copy's phase drifts from the master's: drawn after 12 cycles of the beating, so the
    // copies stand apart by what their detune makes of them
    var ratio = Math.pow(2, OFF[k] * dd / 1200);
    y += lv * base((t * ratio + 12 * (ratio - 1) + k * 0.013) % 1);
    norm += lv * lv;
  }
  return y / Math.sqrt(norm);
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 160) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
// a frame's 64 samples as they are, around oy, the cycle closed
function framePts(fr, x, oy, w, a) {
  var pts = [];
  for (var i = 0; i <= 64; i++) pts.push(Math.round(x + w * i / 64), oy - fr[i & 63] * a);
  return pts;
}
// a curve f(u), u 0..1, across a box, -1..1 into its height (or 0..1 with uni), n points
// Points sit on whole pixels across (g.area fills column by column from each point's x: a point
// between pixels, or two within one, throws its fill above the curve), and the last one is the
// cycle's end, not the next cycle's start (no drop at the right edge).
function curve(x, y, w, h, f, n, uni) {
  var pts = [], mid = y + h / 2, last = -1;
  n = Math.min(n, Math.floor(w));
  for (var i = 0; i <= n; i++) {
    var px = Math.round(x + w * i / n);
    if (px === last) continue;
    last = px;
    var s = clamp(f(i === n ? 1 - 1e-4 : i / n), -1, 1);
    pts.push(px, uni ? y + h - s * h : mid - s * h / 2);
  }
  return pts;
}
// what Shape does to each classic wave (osc.c)
function shapeWords(o) {
  var s = o.shape;
  if (o.wave === 0) return s <= 0.001 ? "PURE SINE" : "SELF-FM " + Math.round(s * 100) + "%";
  if (o.wave === 1) return "RISE " + Math.round((0.5 - 0.49 * s) * 100) + "% OF THE CYCLE";
  if (o.wave === 2) return s <= 0.0005 ? "ONE SAW" : "2ND SAW " + Math.round(s * 180) + " DEG LATE";
  return "WIDTH " + Math.round((0.5 - 0.47 * s) * 100) + "%";
}
function oscSig(o) { return [o.wave, o.table, o.shape.toFixed(3), o.dens.toFixed(3), o.ddet.toFixed(3), o.vsync.toFixed(3)].join(","); }

// ---- the effects' laws (fx.c) --------------------------------------------------------------------------
var ROUTES = [[], ["dly", "rev", "cho"], ["dly", "cho", "rev"], ["rev", "dly", "cho"], ["rev", "cho", "dly"], ["cho", "dly", "rev"], ["cho", "rev", "dly"]];
var FXNAME = { dst: "DISTORTION", cho: "CHORUS", dly: "DELAY", rev: "REVERB" }, FXSHORT = { dst: "DIST", cho: "CHORUS", dly: "DELAY", rev: "REVERB" };
var DLY_BEATS = [0, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 3 / 8, 1 / 3, 1 / 2, 3 / 4, 2 / 3, 1, 1.5, 4 / 3, 2, 8 / 3, 3, 4];
function fxOn(v, f) { return num(v, f + "_lvl", 0) > 0.001; }
// the distortion's curve: input -1..1 into the shaper at gain 1 + 30 lvl^2, trimmed by 1/sqrt(g)
function distCurve(type, lvl, u) {
  var g = 1 + 30 * lvl * lvl, x = (2 * u - 1) * g, y;
  if (type === 0) y = Math.tanh ? Math.tanh(x) : (Math.exp(2 * x) - 1) / (Math.exp(2 * x) + 1);
  else if (type === 1) y = clamp(x, -1, 1);
  else if (type === 2) y = Math.sin(x);
  else { var lv = Math.pow(2, 12 - 8 * lvl) * 0.5; var th = (Math.exp(2 * x) - 1) / (Math.exp(2 * x) + 1); y = Math.round(th * lv) / lv; }
  return y;
}
function tanh(x) { var e = Math.exp(2 * clamp(x, -20, 20)); return (e - 1) / (e + 1); }

// ---- drawing helpers -----------------------------------------------------------------------------------
function frame(g, x, y, w, h, c) { g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c); g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c); }
function section(g, x, y, w, h) { g.fill(x, y, w, h, PANEL); g.fill(x, y, w, 1, "#303136"); }
function well(g, x, y, w, h) { g.fill(x, y, w, h, WELL); g.fill(x, y + h / 2, w, 1, GRID); }
function led(g, x, y, on) { g.dot(x, y, 3, on ? ACC : "#4a1f1b"); }
function bar(g, x, y, w, f, col, h) { h = h || 3; g.fill(x, y, w, h, GRID); if (f > 0.002) g.fill(x, y, Math.max(1, Math.round(w * clamp(f, 0, 1))), h, col); }
function bbar(g, x, y, w, f, col) { // bipolar, from the middle
  g.fill(x, y, w, 3, GRID); g.fill(x + w / 2 - 0.5, y - 2, 1, 7, FAINT);
  var l = w / 2 * clamp(f, -1, 1);
  if (Math.abs(l) >= 1) g.fill(l > 0 ? x + w / 2 : x + w / 2 + l, y, Math.abs(l), 3, col);
}
var A0 = Math.PI * 0.75, SW = Math.PI * 1.5;
// Crest's knob: a black cap in its rim, the value a red arc around it, a cream pointer
function knob(g, cx, cy, r, f, bip, col, ok) {
  g.arc(cx, cy, r, A0, SW, 3, GRID);
  if (ok) {
    var a = A0 + SW * clamp(f, 0, 1);
    if (bip) { var m = A0 + SW / 2; if (Math.abs(a - m) > 0.02) g.arc(cx, cy, r, Math.min(a, m), Math.abs(a - m), 3, col); }
    else if (f > 0.004) g.arc(cx, cy, r, A0, SW * clamp(f, 0, 1), 3, col);
  }
  g.dot(cx, cy, r - 4, CAP_RIM);
  g.dot(cx, cy, r - 5, CAP);
  if (ok) { var an = A0 + SW * clamp(f, 0, 1); g.line(cx + Math.cos(an) * 2, cy + Math.sin(an) * 2, cx + Math.cos(an) * (r - 6), cy + Math.sin(an) * (r - 6), 2, TRACE); }
}
// a choice: the options as a column of LED steps (few) or a display (many)
function chooser(g, cx, cy, v, k, col) {
  var n = ENUM_N[k.replace(/^(o|l)\d_/, "$1_")] || 0, at = Math.round(num(v, k, 0)), ok = known(v, k);
  if (n >= 2 && n <= 8) {
    var sh = n <= 5 ? 4 : 3, sp = sh + (n <= 5 ? 2 : 1), h = sp * n - (sp - sh), y0 = cy - h / 2;
    for (var i = 0; i < n; i++) g.fill(cx - 6, y0 + (n - 1 - i) * sp, 12, sh, ok && i === at ? col : GRID);
    return;
  }
  g.fill(cx - 13, cy - 8, 26, 16, SCREEN);
  g.text(cx, cy + 4, ok ? String(at + 1) : "--", ok ? (col === ACC ? SCREEN_FG : col) : SCREEN_DIM, 0);
}
var ENUM_N = { o_wave: 5, o_shsrc: 3, flt_type: 6, ae_trig: 3, m1_trig: 3, m2_trig: 3, dst_type: 4, cho_type: 3, dly_mode: 3, rev_type: 3,
  l_range: 2, l_mtrig: 2, v_gmode: 2, osc_reset: 2, anim1: 2, anim2: 2, anim1_mode: 2, anim2_mode: 2, arp_on: 2, arp_latch: 2, arp_ksync: 2,
  l_trig: 4, l_fmode: 4, v_mode: 5, fx_route: 7, l_wave: 8, arp_mode: 7 };
var BIPKEY = /^(o\d_(shamt|penv|plfo|coarse|fine)|noise_col|flt_(env|lfo|ae|o3|ns)|(ae|m1|m2)_vel|cho_fb|mm_dep|mac_amt|v_oct)$/;
// the panel's own words (src/web/panel.js)
var NAMES = { flt_cut: "FREQUENCY", flt_res: "RESONANCE", flt_env: "ENV 1", flt_ae: "AMP ENV", flt_lfo: "LFO 1", flt_vel: "VELOCITY",
  flt_key: "KEY TRK", flt_drive: "DRIVE", flt_type: "TYPE", flt_div: "DIVERGE", flt_o3: "OSC 3 FM", flt_ns: "NOISE FM",
  pre_od: "OVERDRIVE", post_dist: "POST DIST", noise_col: "NOISE COL", mx_ring: "RING", mx_noise: "NOISE", fm_12: "FM 1 > 2", fm_23: "FM 2 > 3",
  fm_31: "FM 3 > 1", fm_n1: "NOISE > 1", o_wave: "WAVE", o_table: "TABLE", o_shape: "SHAPE", o_dens: "DENSITY", o_coarse: "COARSE", o_fine: "FINE",
  o_vsync: "V-SYNC", o_ddet: "DENS DET", o_penv: "ENV 2", o_plfo: "LFO 2", o_shsrc: "SHAPE SRC", o_shamt: "SHAPE MOD", o_fixed: "FIXED", ae_a: "ATTACK", ae_d: "DECAY", ae_s: "SUSTAIN", ae_r: "RELEASE", ae_hold: "HOLD", ae_dly: "AMP DELAY",
  ae_vel: "VELOCITY", ae_rep: "REPEATS", ae_trig: "TRIGGER", fx_route: "ROUTING", fx_dry: "DRY", fx_wet: "WET", dst_lvl: "DISTORTION",
  cho_lvl: "CHORUS", dly_lvl: "DELAY", rev_lvl: "REVERB", dst_type: "DIST TYPE", dly_time: "DELAY TIME", rev_decay: "REV DECAY", patch_vol: "VOLUME" };
function nameOf(v, k, kn) {
  var lv = /^mx_o(\d)$/.exec(k);
  if (lv) return kn && kn.indexOf("o" + lv[1] + "_wave") >= 0 ? "LEVEL" : "OSC " + lv[1];
  if (NAMES[k]) return NAMES[k];
  if (/^o\d_/.test(k) && NAMES["o_" + k.slice(3)]) return NAMES["o_" + k.slice(3)];
  var m = /^o(\d)_(\w+)$/.exec(k), s = String((v[k] && v[k].name) || k);
  if (m) return up(s.replace(/^Osc \d /, ""));
  return up(s);
}

// ---- the encoder row: Crest's knobs, at the bottom of the panel --------------------------------------
var ROW = 104;
function encoderRowGround(g, seg) {
  g.fill(0, ROW, 960, 56, BG);
  g.fill(0, ROW, 960, 1, "#000000");
  for (var c = 1; c < 8; c++) g.fill(c * 120, ROW + 8, 1, seg ? 26 : 40, GRID);
}
// a knob the wave does not use (osc.c): the table off a wavetable, density on a sine or a table
function inert(v, k) {
  var m = /^o(\d)_(table|dens|ddet)$/.exec(k);
  if (!m) return false;
  var w = idx(v, "o" + m[1] + "_wave", 5, 2);
  return m[2] === "table" ? w !== 4 : w === 0 || w === 4;
}
function encoderRow(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode;
  var cy = seg ? ROW + 19 : ROW + 27, r = seg ? 11 : 15, ny = seg ? ROW + 15 : ROW + 20, vy = seg ? ROW + 34 : ROW + 44;
  for (var i = 0; i < 8; i++) {
    var k = kn[i] || "";
    if (!k) continue;
    var x = i * 120, hot = k === t, ok = known(v, k), col = hot ? "slot" : ACC, kx = x + 21;
    if (v[k] && v[k].type === "enum") chooser(g, kx, cy, v, k, hot ? "slot" : ACC);
    else knob(g, kx, cy, r, ok ? v[k].frac : 0, BIPKEY.test(k), col, ok);
    if (moved(v, k) && !(v[k] && v[k].type === "enum")) { // the sound's place: an arc from the knob's, a dot
      var kf = v[k].frac, kn2 = nowOf(v, k);
      g.arc(kx, cy, r + 4, A0 + SW * Math.min(kf, kn2), SW * Math.abs(kn2 - kf), 2, MOD_DK);
      g.dot(kx + Math.cos(A0 + SW * kn2) * (r + 4), cy + Math.sin(A0 + SW * kn2) * (r + 4), 2.8, MODC);
    }
    g.text(x + 41, ny, nameOf(v, k, kn), hot ? "slot" : LABEL, -1, 76);
    var vs = val(v, k), vc = hot ? "slot" : inert(v, k) ? DIM : TEXT;
    // a long choice (a routing) in the label face rather than cut
    if (v[k] && v[k].type === "enum" && g.measure(vs, "value") > 76) g.text(x + 41, vy - 1, vs, vc, -1, 76);
    else g.value(x + 41, vy, vs, vc, -1, 76);
  }
}

// ---- the front panel ------------------------------------------------------------------------------------
var TOP = 24, OSC_X = [4, 130, 256], OSC_W = 122, OSC_H = 60, FM_Y = 88, FM_W = 374;
var MIX_X = 382, MIX_W = 170, FLT_X = 556, FLT_W = 146, ENV_X = 706, ENV_W = 124, FX_X = 834, FX_W = 122, SEC_H = 78;
var FT = ["LP24", "LP12", "BP12", "BP6", "HP24", "HP12"];
// g.filter's axis is 20 Hz .. 20 kHz; the cutoff knob is MIDI note 20 + 115 x (voice.c)
function cutAt(x) { return clamp(Math.log(cutHz(x) / 20) / Math.log(1000), 0, 1); }
// the filter where the sound has its cutoff (at: its place on g.filter's axis) and resonance, the
// knob's place marked at the foot, the way between in the modulation colour
function liveFilter(g, v, x, y, w, h, type) {
  var c = num(v, "flt_cut", 0.5), cn = numNow(v, "flt_cut", c);
  g.filter(x, y, w, h, { cutoff: "flt_cut", resonance: moved(v, "flt_res") ? nowOf(v, "flt_res") : "flt_res", type: type, at: cutAt(cn), color: ACC });
  if (!moved(v, "flt_cut")) return;
  var xs = x + w * cutAt(c), xn = x + w * cutAt(cn), yb = y + h - 3;
  g.fill(Math.round(xs), yb - 5, 2, 7, TEXT);
  g.fill(Math.min(xs, xn), yb, Math.abs(xn - xs), 2, MOD_DK);
  g.dot(xn, yb + 1, 3, MODC);
}
// each stage's bend as env.c makes it: the attack aims at 3 and stops at 1, the decay aims 0.01
// below the sustain, the release 0.01 below zero (from the sustain level here)
function envCurves(v, p) {
  var s = clamp(num(v, p + "s", 0.5), 0, 1);
  return { attack: -0.4055, decay: -Math.log((1 - s + 0.01) / 0.01), release: -Math.log((s + 0.01) / 0.01) };
}
function envSpec(v, p, extra) {
  var o = { delay: p + "dly", attack: p + "a", decay: p + "d", sustain: p + "s", release: p + "r", curves: envCurves(v, p) };
  if (num(v, p + "hold", 0) > 0.001) o.hold = p + "hold"; // a hold of 0 is no stage at all (env.c start_hold)
  for (var e in extra) o[e] = extra[e];
  return o;
}
function segLit(v, id) { return v.$segmode === "segment" && v.$segment === id; }
function heading(g, v, id, x, y, s) { g.text(x, y, s, segLit(v, id) ? ACC : LABEL, -1); }
function routeOf(v) { return idx(v, "fx_route", 7, 5); }
function fxOrder(v) { var r = routeOf(v); return r === 0 ? ["cho", "dly", "rev"] : ROUTES[r]; }

function panelGround(g, seg) {
  g.fill(0, 0, 960, 160, BG);
  // the name, spaced as the panel prints it, and the display
  var L = "CREST";
  for (var i = 0; i < L.length; i++) g.value(10 + i * 14, 16, L.charAt(i), TEXT, -1);
  g.fill(92, 3, 318, 17, SCREEN);
  frame(g, 92, 3, 318, 17, "#1d2830");
  for (var o = 0; o < 3; o++) {
    section(g, OSC_X[o], TOP, OSC_W, OSC_H);
    well(g, OSC_X[o] + 5, TOP + 15, OSC_W - 10, OSC_H - 20);
  }
  section(g, 4, FM_Y, FM_W, 14);
  g.text(10, FM_Y + 11, "FM", LABEL, -1);
  section(g, MIX_X, TOP, MIX_W, SEC_H);
  section(g, FLT_X, TOP, FLT_W, SEC_H);
  section(g, ENV_X, TOP, ENV_W, SEC_H);
  section(g, FX_X, TOP, FX_W, SEC_H);
  encoderRowGround(g, seg);
}
function frontPanel(g, v) {
  var seg = !!v.$segmode, t = v.$touched || "", i;
  g.layer("crest|" + (seg ? 1 : 0), function () { panelGround(g, seg); });
  // the display: the patch, how it plays
  g.value(100, 16, txt(v, "preset_name") || txt(v, "name") || "--", SCREEN_FG, -1, 220);
  var mode = known(v, "v_mode") ? up(txt(v, "v_mode")) : "", uni = Math.round(num(v, "v_unison", 1));
  g.text(402, 15, mode + (uni > 1 ? " X" + uni : ""), SCREEN_DIM, 1, 80);
  // Animate 1 and 2, the arpeggiator: the panel's lit buttons
  var leds = [["anim1", "ANIMATE 1"], ["anim2", "ANIMATE 2"], ["arp_on", "ARP"]], lx = 428;
  for (i = 0; i < 3; i++) {
    var on = num(v, leds[i][0], 0) >= 0.5;
    led(g, lx + 3, 11, on);
    g.text(lx + 10, 15, leds[i][1], on ? TEXT : DIM, -1);
    lx += 22 + g.measure(leds[i][1]);
  }
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(952, 15, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, DIM, 1, 200);

  // the three oscillators: the wave each one plays, as it leaves it
  for (var n = 1; n <= 3; n++) {
    var o = oscOf(v, n), x = OSC_X[n - 1], id = "osc" + n;
    heading(g, v, id, x + 6, TOP + 11, "OSC " + n);
    var hot = t === o.p + "wave" || t === o.p + "table" || t === o.p + "shape";
    g.text(x + OSC_W - 6, TOP + 11, o.ok ? waveName(o) : "--", hot ? "slot" : TEXT, 1, 66);
    var wx = x + 7, wy = TOP + 17, ww = OSC_W - 14, wh = OSC_H - 24;
    if (!o.ok) continue;
    o = liveOsc(v, o); // the wave the sound makes now
    var pts = cached("fp" + n + "|" + oscSig(o), function () { return curve(wx, wy, ww, wh, function (u) { return 0.92 * oscOut(o, u); }, 96); });
    var live = o.level > 0.001;
    if (live) g.area(pts, wy + wh / 2, FILL);
    g.poly(pts, 2, hot ? "slot" : live ? TRACE : TRACE_DIM);
  }
  // FM: the four routes of the ring, each its knob
  heading(g, v, "fm", 10, FM_Y + 11, "FM");
  var fm = [["fm_12", "1>2"], ["fm_23", "2>3"], ["fm_31", "3>1"], ["fm_n1", "N>1"]];
  for (i = 0; i < 4; i++) {
    var fx = 34 + i * 85, f = num(v, fm[i][0], 0), fh = t === fm[i][0], act = f > 0.001;
    g.text(fx, FM_Y + 11, fm[i][1], fh ? "slot" : act ? TEXT : DIM, -1);
    bar(g, fx + 26, FM_Y + 6, 48, f, fh ? "slot" : ACC);
    hMark(g, v, fm[i][0], fx + 26, FM_Y + 7, 48);
  }
  // the mixer: Pung's, in Crest's red
  heading(g, v, "mix", MIX_X + 6, TOP + 11, "MIXER");
  g.mix(MIX_X + 2, TOP + 15, MIX_W - 4, 50, mixNow(v, ["mx_o1", "mx_o2", "mx_o3", "mx_ring", "mx_noise"]), { color: ACC });
  var ML = ["1", "2", "3", "RM", "NOISE"], mcw = (MIX_W - 4) / 5;
  for (i = 0; i < 5; i++) g.text(MIX_X + 2 + mcw * (i + 0.5), TOP + 74, ML[i], t === ["mx_o1", "mx_o2", "mx_o3", "mx_ring", "mx_noise"][i] ? "slot" : DIM, 0);
  // the filter
  var ft = idx(v, "flt_type", 6);
  heading(g, v, "filter", FLT_X + 6, TOP + 11, "FILTER");
  g.text(FLT_X + FLT_W - 6, TOP + 11, known(v, "flt_type") ? FT[ft] : "--", t === "flt_type" ? "slot" : TEXT, 1);
  liveFilter(g, v, FLT_X + 2, TOP + 15, FLT_W - 4, 48, FT[ft]);
  g.text(FLT_X + 6, TOP + 74, known(v, "flt_cut") ? val(v, "flt_cut") : "--", t === "flt_cut" ? "slot" : TEXT, -1);
  g.text(FLT_X + FLT_W - 6, TOP + 74, "RES " + val(v, "flt_res"), t === "flt_res" ? "slot" : DIM, 1);
  // the amp envelope, on the engine's curves
  heading(g, v, "amp", ENV_X + 6, TOP + 11, "AMP ENV");
  var rep = Math.round(num(v, "ae_rep", 0));
  if (rep > 0) g.text(ENV_X + ENV_W - 6, TOP + 11, rep >= 127 ? "LOOP" : "X" + rep, TEXT, 1);
  g.envelope(ENV_X + 2, TOP + 15, ENV_W - 4, 58, envSpec(v, "ae_", { color: ACC }));
  // the effects in the order the routing gives them
  heading(g, v, "fx", FX_X + 6, TOP + 11, "EFFECTS");
  var par = routeOf(v) === 0;
  var chain = ["dst"].concat(fxOrder(v)), rh = t === "fx_route";
  // the way through: a chain of the four, or the distortion feeding three side by side
  g.fill(FX_X + 9, TOP + 21, 2, par ? 12 : 40, rh ? "slot" : FAINT);
  if (par) { g.fill(FX_X + 4, TOP + 33, 6, 2, rh ? "slot" : FAINT); g.fill(FX_X + 4, TOP + 33, 2, 28, rh ? "slot" : FAINT); }
  for (i = 0; i < 4; i++) {
    var e = chain[i], yy = TOP + 24 + i * 13, lvl = num(v, e + "_lvl", 0), eh = t === e + "_lvl", lit = lvl > 0.001;
    if (par && i > 0) g.fill(FX_X + 4, yy - 4, 6, 2, rh ? "slot" : FAINT);
    led(g, FX_X + 10, yy - 3, lit);
    g.text(FX_X + 18, yy, FXSHORT[e], eh ? "slot" : lit ? TEXT : DIM, -1);
    bar(g, FX_X + 68, yy - 5, FX_W - 76, lvl, eh ? "slot" : ACC);
    hMark(g, v, e + "_lvl", FX_X + 68, yy - 4, FX_W - 76);
  }
  g.text(FX_X + FX_W / 2, TOP + 75, par ? "IN PARALLEL" : "IN SERIES", rh ? "slot" : DIM, 0);
  encoderRow(g, v);
}

// ---- Pung's default pages in Crest's graphite, its black knobs and red arcs ------------------------------
push.theme({ ground: PANEL, panel: CAP, ink: TEXT, dim: LABEL, rule: CAP_RIM, faint: GRID, accent: ACC, knob: "pointer" });

var OSC_KEYS = function (n) { var p = "o" + n + "_"; return [p + "wave", p + "table", p + "shape", p + "dens", p + "coarse", p + "fine", p + "vsync", "mx_o" + n]; };
var OSC_MOD = function (n) { var p = "o" + n + "_"; return [p + "shsrc", p + "shamt", p + "ddet", p + "penv", p + "plfo", p + "fixed"]; };
var PANEL_EXTRA = ["preset_name", "name", "v_mode", "v_unison", "anim1", "anim2", "arp_on", "fm_12", "fm_23", "fm_31", "fm_n1", "mx_o1", "mx_o2", "mx_o3",
  "mx_ring", "mx_noise", "flt_type", "flt_cut", "flt_res", "ae_dly", "ae_a", "ae_hold", "ae_d", "ae_s", "ae_r", "ae_rep", "fx_route",
  "dst_lvl", "cho_lvl", "dly_lvl", "rev_lvl"];
[1, 2, 3].forEach(function (n) { PANEL_EXTRA = PANEL_EXTRA.concat(OSC_KEYS(n), ["o" + n + "_ddet", "o" + n + "_fixed"]); });
push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true,
  pages: [
    { label: "Main", keys: ["flt_cut", "flt_res", "flt_env", "pre_od", "ae_a", "ae_d", "ae_s", "ae_r"] },
    { label: "Sources", keys: ["o1_shape", "o2_shape", "o3_shape", "mx_o1", "mx_o2", "mx_o3", "mx_ring", "mx_noise"] },
    { label: "Effects", keys: ["fx_route", "dst_lvl", "cho_lvl", "dly_lvl", "rev_lvl", "dly_time", "rev_decay", "patch_vol"] }
  ],
  // the panel's sections, each one press away, in the order the voice runs
  segments: [
    { id: "osc1", label: "Osc 1", rect: [OSC_X[0], TOP, OSC_W, OSC_H], keys: OSC_KEYS(1) },
    { id: "osc2", label: "Osc 2", rect: [OSC_X[1], TOP, OSC_W, OSC_H], keys: OSC_KEYS(2) },
    { id: "osc3", label: "Osc 3", rect: [OSC_X[2], TOP, OSC_W, OSC_H], keys: OSC_KEYS(3) },
    { id: "fm", label: "FM", rect: [4, FM_Y, FM_W, 14], keys: ["fm_12", "fm_23", "fm_31", "fm_n1", "flt_o3", "flt_ns", "flt_div", "flt_ae"] },
    { id: "mix", label: "Mixer", rect: [MIX_X, TOP, MIX_W, SEC_H], keys: ["mx_o1", "mx_o2", "mx_o3", "mx_ring", "mx_noise", "noise_col", "pre_od", "post_dist"] },
    { id: "filter", label: "Filter", rect: [FLT_X, TOP, FLT_W, SEC_H], keys: ["flt_type", "flt_cut", "flt_res", "flt_drive", "flt_key", "flt_env", "flt_lfo", "flt_vel"] },
    { id: "amp", label: "Amp Env", rect: [ENV_X, TOP, ENV_W, SEC_H], keys: ["ae_a", "ae_d", "ae_s", "ae_r", "ae_hold", "ae_dly", "ae_vel", "ae_rep"] },
    { id: "fx", label: "Effects", rect: [FX_X, TOP, FX_W, SEC_H], keys: ["fx_route", "dst_lvl", "cho_lvl", "dly_lvl", "rev_lvl", "fx_dry", "fx_wet", "dst_type"] }
  ],
  extra_keys: PANEL_EXTRA,
  screen: frontPanel
});

// ---- the band screens ----------------------------------------------------------------------------------------
function band(g, key, parts) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, BG);
    for (var i = 0; i < parts.length; i++) section(g, parts[i][0], 0, parts[i][1], g.h);
  });
}

// OSC n: the waterfall of its frames, the frame Shape plays, the wave it puts out
// the waterfall: frames from the front (left, low) to the back (right, high), under a title strip
var WF_X = 8, WF_Y = 23, WF_W = 228, WF_A = 16, WF_DEPX = 124, WF_DEPY = 29;
function wfX(s) { return WF_X + s * WF_DEPX; }
function wfY(s) { return WF_Y + (1 - s) * WF_DEPY + WF_A; } // a frame's centre line
function oscScreen(n) {
  return function (g, v) {
    var o = oscOf(v, n), t = v.$touched || "", p = o.p, i;
    var key = "osc" + n + "|" + (o.ok ? o.wave + "|" + (o.wave === 4 ? o.table : "") : "?");
    // the waterfall: a table's 16 frames, or six steps of a classic wave's Shape sweep; frame 0 in
    // front, the last at the back, each one hiding what is behind it
    g.layer(key, function () {
      g.fill(0, 0, g.w, g.h, BG);
      section(g, 0, 0, 372, 86); section(g, 376, 0, 330, 86); section(g, 710, 0, 242, 86);
      g.fill(382, 16, 318, 64, WELL); g.fill(382, 48, 318, 1, GRID);
      if (!o.ok) return;
      var nf = o.wave === 4 ? 16 : 6;
      for (var f = nf - 1; f >= 0; f--) {
        var s = f / (nf - 1), ox = wfX(s), oy = wfY(s);
        var pts = o.wave === 4 ? framePts(frames(o.table)[f], ox, oy, WF_W, WF_A * 0.95)
          : curve(ox, oy - WF_A, WF_W, 2 * WF_A, function (u) { return 0.95 * classic(o.wave, s, u); }, 76);
        g.area(pts, oy + WF_A, PANEL);
        var major = o.wave !== 4 || f % 5 === 0; // a classic wave's six steps fade toward the back
        g.poly(pts, major ? 2 : 1, o.wave !== 4 ? ["#7c7e84", "#6e7076", "#62646a", "#57595f", "#4e5056", "#46484e"][f] : major ? "#6b6d73" : "#4a4c52");
      }
    });
    if (!o.ok) { g.text(186, 50, "--", DIM, 0); return; }
    // where the shape source takes it: Mod Env 1 from Shape up (or down), LFO 1 either way
    var lo = o.shape, hi = o.shape;
    if (o.shsrc === 1) { lo = Math.min(o.shape, o.shape + o.shamt); hi = Math.max(o.shape, o.shape + o.shamt); }
    if (o.shsrc === 2) { lo = o.shape - Math.abs(o.shamt); hi = o.shape + Math.abs(o.shamt); }
    lo = clamp(lo, 0, 1); hi = clamp(hi, 0, 1);
    var mh = t === p + "shamt" || t === p + "shsrc", moved = o.shsrc > 0 && Math.abs(o.shamt) > 0.004;
    if (moved) { // a bracket along the depth, beside the frames' right ends
      var bx0 = wfX(lo) + WF_W + 6, by0 = wfY(lo), bx1 = wfX(hi) + WF_W + 6, by1 = wfY(hi);
      g.line(bx0, by0, bx1, by1, 3, mh ? "slot" : MODC);
      g.line(bx0 - 3, by0, bx0 + 3, by0, 2, mh ? "slot" : MODC);
      g.line(bx1 - 3, by1, bx1 + 3, by1, 2, mh ? "slot" : MODC);
    }
    // the frame Shape plays, lit at its depth
    var fx = wfX(o.shape), fy = wfY(o.shape);
    var sh = t === p + "shape" || t === p + "table" || t === p + "wave";
    var lit = cached("wfl" + n + "|" + o.wave + "|" + o.table + "|" + o.shape.toFixed(3), function () {
      return curve(fx, fy - WF_A, WF_W, 2 * WF_A, function (u) { return 0.95 * waveAt(o.wave, o.table, o.shape, u); }, 76);
    });
    g.poly(lit, 2, sh ? "slot" : TRACE);
    var lo2 = liveOsc(v, o);
    if (lo2.shape !== o.shape && Math.abs(lo2.shape - o.shape) > 0.004) { // the frame the sound plays now, at its depth, in the modulation colour
      var nfx = wfX(lo2.shape), nfy = wfY(lo2.shape);
      g.poly(cached("wfn" + n + "|" + o.wave + "|" + o.table + "|" + lo2.shape.toFixed(3), function () {
        return curve(nfx, nfy - WF_A, WF_W, 2 * WF_A, function (u) { return 0.95 * waveAt(o.wave, o.table, lo2.shape, u); }, 76);
      }), 1.5, MODC);
    }
    // the title strip: the table's name and number, the frame (or what Shape does), its mover
    var nm = o.wave === 4 ? TABLES[o.table] : ["Sine", "Triangle", "Saw", "Pulse"][o.wave];
    g.value(8, 16, nm, sh ? "slot" : TEXT, -1, 130);
    var nw = Math.min(130, g.measure(nm, "value")), ms = moved ? (o.shsrc === 1 ? "ENV 1 " : "LFO 1 ") + val(v, p + "shamt") : "";
    var mw = ms ? g.measure(ms) + 10 : 0;
    g.text(16 + nw, 15, o.wave === 4 ? "TABLE " + (o.table + 1) : "CLASSIC", sh ? "slot" : DIM, -1, 60);
    g.text(364 - mw, 15, o.wave === 4 ? "FRAME " + trim(1 + o.shape * 15, 1) + " OF 16" : shapeWords(o), sh ? "slot" : TEXT, 1, 364 - mw - nw - 90);
    if (ms) g.text(364, 15, ms, mh ? "slot" : MODC, 1);
    // what leaves the oscillator: virtual sync, the density copies, its level
    var live = o.level > 0.001, wh = t === p + "dens" || t === p + "vsync" || t === p + "ddet";
    var out = cached("out" + n + "|" + oscSig(lo2), function () { return curve(384, 18, 314, 60, function (u) { return 0.92 * oscOut(lo2, (u * 2) % 1); }, 200); }); // as the sound has it now
    if (live) g.area(out, 48, FILL);
    g.poly(out, 2, wh ? "slot" : live ? TRACE : TRACE_DIM);
    g.text(382, 12, "TO THE MIXER", LABEL, -1);
    var tags = [];
    if (o.vsync > 0.001) tags.push("SYNC " + val(v, p + "vsync"));
    if (o.dens > 0.001) tags.push(o.wave === 0 || o.wave === 4 ? "NO DENSITY ON " + (o.wave === 0 ? "SINE" : "TABLES") : "DENSITY " + Math.round(o.dens * 100) + "%");
    g.text(700, 12, tags.join("   "), wh ? "slot" : TEXT, 1, 210);
    if (!live) g.text(541, 52, "MUTED IN THE MIXER", DIM, 0);
    // pitch and level, as the voice takes them
    var x = 718, ph = t === p + "coarse" || t === p + "fine" || t === p + "fixed";
    g.text(x, 12, "PITCH", LABEL, -1);
    g.value(x, 31, o.fixed > 0 ? "FIXED " + noteName(Math.round(o.fixed)) : (o.coarse > 0 ? "+" : "") + Math.round(o.coarse) + " ST " + (o.fine > 0 ? "+" : "") + Math.round(o.fine) + " CT", ph ? "slot" : TEXT, -1, 226);
    var mods = [[p + "penv", "MOD ENV 2", num(v, p + "penv", 0)], [p + "plfo", "LFO 2", num(v, p + "plfo", 0)]];
    for (i = 0; i < 2; i++) {
      var yy = 46 + i * 13, mt = t === mods[i][0], on = Math.abs(mods[i][2]) > 0.004;
      g.text(x, yy, mods[i][1], mt ? "slot" : on ? TEXT : DIM, -1);
      bbar(g, x + 72, yy - 5, 70, mods[i][2], mt ? "slot" : MODC);
      g.text(944, yy, on ? val(v, mods[i][0]) : "", mt ? "slot" : TEXT, 1);
    }
    var lh = t === "mx_o" + n;
    g.text(x, 78, "LEVEL", lh ? "slot" : LABEL, -1);
    bar(g, x + 72, 73, 70, o.level, lh ? "slot" : ACC);
    hMark(g, v, "mx_o" + n, x + 72, 74, 70);
    g.text(944, 78, val(v, "mx_o" + n), lh ? "slot" : TEXT, 1);
  };
}
[1, 2, 3].forEach(function (n) {
  var ex = OSC_KEYS(n).concat(OSC_MOD(n));
  push.compartment({
    id: "osc" + n, label: "Osc " + n, extra_keys: ex,
    pages: [{ label: "Osc " + n, keys: OSC_KEYS(n) }, { label: "Osc " + n + " Mod", keys: OSC_MOD(n) }],
    screen: oscScreen(n)
  });
});

// ---- FM: the cross-modulation ring (voice.c) --------------------------------------------------------------
// Osc 1 into 2, 2 into 3, 3 back into 1 (its previous block) and noise into 1, as phase modulation of
// 1.5 f^2 cycles per unit of the modulator; Osc 3 and noise move the cutoff by up to 3 octaves.
function arrowHead(g, x, y, dir, c) { // dir: 1 right, -1 left, 2 up, -2 down
  if (dir === 1 || dir === -1) g.poly([x - 6 * dir, y - 5, x, y, x - 6 * dir, y + 5], 2, c);
  else { var d = dir === 2 ? -1 : 1; g.poly([x - 5, y - 6 * d, x, y, x + 5, y - 6 * d], 2, c); }
}
function route(g, pts, f, hot, head) {
  var on = f > 0.001, c = hot ? "slot" : on ? ACC : FAINT, w = on ? 2 + Math.round(f * 3) : 1;
  g.poly(pts, w, c);
  var n = pts.length;
  arrowHead(g, pts[n - 2], pts[n - 1], head, c);
}
function fmIndex(f) { return trim(1.5 * f * f * 2 * Math.PI, 2); }
var FM_BOX = [[8, 92, "NOISE"], [132, 252, "OSC 1"], [292, 412, "OSC 2"], [452, 572, "OSC 3"], [648, 944, "CUTOFF"]];
function fmScreen(g, v) {
  var t = v.$touched || "", i;
  g.layer("fm", function () {
    g.fill(0, 0, g.w, g.h, BG);
    for (var b = 0; b < FM_BOX.length; b++) {
      var B = FM_BOX[b];
      section(g, B[0], 20, B[1] - B[0], 40);
      g.text(B[0] + 6, 31, B[2], LABEL, -1);
      if (b > 0 && b < 4) g.fill(B[0] + 5, 35, B[1] - B[0] - 10, 21, WELL);
    }
  });
  // each oscillator's own wave, as it reaches the ring
  for (i = 1; i <= 3; i++) {
    var o = oscOf(v, i), B = FM_BOX[i];
    g.text(B[1] - 6, 31, o.ok ? waveName(o) : "--", DIM, 1, 70);
    if (!o.ok) continue;
    o = liveOsc(v, o); // the wave the sound makes now
    var pts = cached("fmw" + i + "|" + oscSig(o), function () { return curve(B[0] + 6, 36, B[1] - B[0] - 12, 19, function (u) { return 0.9 * oscOut(o, (2 * u) % 1); }, 64); });
    g.poly(pts, 2, o.level > 0.001 ? TRACE : TRACE_DIM);
  }
  // noise: its colour
  var nc = num(v, "noise_col", 0);
  g.text(14, 48, nc < -0.001 ? "DARK" : nc > 0.001 ? "THIN" : "WHITE", DIM, -1);
  var f12 = num(v, "fm_12", 0), f23 = num(v, "fm_23", 0), f31 = num(v, "fm_31", 0), fn1 = num(v, "fm_n1", 0);
  var fo3 = num(v, "flt_o3", 0), fns = num(v, "flt_ns", 0);
  // each route as thick as the sound has it now (the numbers stay the knobs')
  route(g, [92, 40, 130, 40], numNow(v, "fm_n1", fn1), t === "fm_n1", 1);
  route(g, [252, 40, 290, 40], numNow(v, "fm_12", f12), t === "fm_12", 1);
  route(g, [412, 40, 450, 40], numNow(v, "fm_23", f23), t === "fm_23", 1);
  route(g, [512, 60, 512, 76, 192, 76, 192, 62], numNow(v, "fm_31", f31), t === "fm_31", 2);
  route(g, [572, 40, 646, 40], Math.abs(numNow(v, "flt_o3", fo3)), t === "flt_o3", 1);
  var nsl = "NOISE > CUTOFF  " + (Math.abs(fns) > 0.002 ? val(v, "flt_ns") : "OFF"), nw = g.measure(nsl) / 2 + 8;
  g.poly([50, 20, 50, 9, 420 - nw, 9], 1, FAINT);
  route(g, [420 + nw, 9, 796, 9, 796, 18], Math.abs(fns), t === "flt_ns", -2);
  if (Math.abs(fns) > 0.002) g.poly([50, 20, 50, 9, 420 - nw, 9], 2 + Math.round(Math.abs(fns) * 3), t === "flt_ns" ? "slot" : ACC);
  // the indexes, where they act
  function lab(x, y, s, on, hot) { g.text(x, y, s, hot ? "slot" : on ? TEXT : FAINT, 0); }
  lab(111, 34, fn1 > 0.001 ? fmIndex(fn1) : "OFF", fn1 > 0.001, t === "fm_n1");
  lab(271, 34, f12 > 0.001 ? fmIndex(f12) : "OFF", f12 > 0.001, t === "fm_12");
  lab(431, 34, f23 > 0.001 ? fmIndex(f23) : "OFF", f23 > 0.001, t === "fm_23");
  lab(352, 72, "3 > 1  " + (f31 > 0.001 ? "INDEX " + fmIndex(f31) : "OFF"), f31 > 0.001, t === "fm_31");
  lab(609, 34, Math.abs(fo3) > 0.002 ? val(v, "flt_o3") : "OFF", Math.abs(fo3) > 0.002, t === "flt_o3");
  lab(420, 12, nsl, Math.abs(fns) > 0.002, t === "flt_ns");
  // the cutoff's other movers on this page: the amp envelope and the voices' divergence
  var x = 656, ae = num(v, "flt_ae", 0), dv = num(v, "flt_div", 0);
  g.text(x + 90, 31, "SWUNG AT AUDIO RATE", DIM, -1);
  g.text(x, 44, "BY OSC 3", t === "flt_o3" ? "slot" : Math.abs(fo3) > 0.002 ? TEXT : DIM, -1);
  g.text(x + 140, 44, Math.abs(fo3) > 0.002 ? "±" + trim(Math.abs(fo3) * 3, 1) + " OCT" : "--", t === "flt_o3" ? "slot" : Math.abs(fo3) > 0.002 ? TEXT : DIM, 1);
  g.text(x + 160, 44, "BY NOISE", t === "flt_ns" ? "slot" : Math.abs(fns) > 0.002 ? TEXT : DIM, -1);
  g.text(x + 280, 44, Math.abs(fns) > 0.002 ? "±" + trim(Math.abs(fns) * 3, 1) + " OCT" : "--", t === "flt_ns" ? "slot" : Math.abs(fns) > 0.002 ? TEXT : DIM, 1);
  g.text(x, 74, "AMP ENV", t === "flt_ae" ? "slot" : LABEL, -1);
  bbar(g, x + 54, 69, 80, ae, t === "flt_ae" ? "slot" : MODC);
  g.text(x + 140, 74, val(v, "flt_ae"), t === "flt_ae" ? "slot" : TEXT, -1);
  g.text(x + 196, 74, "DIVERGE " + val(v, "flt_div"), t === "flt_div" ? "slot" : dv > 0.001 ? TEXT : DIM, -1, 92);
}
push.compartment({
  id: "fm", label: "FM",
  pages: [{ label: "FM", keys: ["fm_12", "fm_23", "fm_31", "fm_n1", "flt_o3", "flt_ns", "flt_div", "flt_ae"] }],
  extra_keys: ["noise_col", "mx_o1", "mx_o2", "mx_o3"].concat(OSC_KEYS(1), OSC_KEYS(2), OSC_KEYS(3)),
  screen: fmScreen
});

// ---- MIXER: Pung's mixer, and what the signal meets before and after the filter (voice.c, params.c) ------
function mixerScreen(g, v) {
  var t = v.$touched || "";
  band(g, "mixer", [[0, 595], [599, 116], [719, 115], [838, 114]]);
  g.mix(4, 14, 587, 72, mixNow(v, ["mx_o1", "mx_o2", "mx_o3", "mx_ring", "mx_noise"]), { color: ACC });
  g.text(8, 10, "MIXER", LABEL, -1);
  g.text(587, 10, "LEVELS GAIN X^1.5, SUMMED, SOFT-SATURATED", DIM, 1);
  // the noise's colour: one pole, low pass 20 kHz..200 Hz to the left, high pass 20 Hz..8 kHz right
  var col = num(v, "noise_col", 0), ch = t === "noise_col";
  g.text(605, 10, "NOISE COLOUR", ch ? "slot" : LABEL, -1);
  g.fill(605, 16, 104, 66, WELL);
  var nz = cached("nz" + col.toFixed(3), function () {
    return curve(607, 20, 100, 56, function (u) {
      var f = 20 * Math.pow(1000, u), m = 1;
      if (col < -0.001) { var fc = 20000 * Math.pow(0.01, -col); m = 1 / Math.sqrt(1 + (f / fc) * (f / fc)); }
      else if (col > 0.001) { var fh = 20 * Math.pow(400, col); m = (f / fh) / Math.sqrt(1 + (f / fh) * (f / fh)); }
      return clamp(1 + 20 * Math.log(Math.max(1e-4, m)) / Math.LN10 / 40, 0, 1);
    }, 60, true);
  });
  g.area(nz, 76, FILL);
  g.poly(nz, 2, ch ? "slot" : TRACE);
  g.text(657, 72, col < -0.001 ? "LP " + val2Hz(20000 * Math.pow(0.01, -col)) : col > 0.001 ? "HP " + val2Hz(20 * Math.pow(400, col)) : "WHITE", ch ? "slot" : TEXT, 0);
  // the overdrive before the filter: tanh at gain 1 + 15 p^2, over 1 + 0.6 p
  var od = numNow(v, "pre_od", 0), oh = t === "pre_od"; // the curves at the drive the sound has now
  g.text(725, 10, "OVERDRIVE", oh ? "slot" : LABEL, -1);
  transfer(g, 725, 16, 104, 66, "od" + od.toFixed(3), function (x) { return od <= 0.001 ? x : tanh((1 + 15 * od * od) * x) / (1 + 0.6 * od); }, oh, od > 0.001);
  // the distortion after it: asymmetric (a bias of 0.15 p), gain 1 + 24 p^2, over 1 + p
  var pd = numNow(v, "post_dist", 0), ph = t === "post_dist";
  g.text(844, 10, "POST DIST", ph ? "slot" : LABEL, -1);
  transfer(g, 844, 16, 104, 66, "pd" + pd.toFixed(3), function (x) { var gg = 1 + 24 * pd * pd, b = 0.15 * pd; return pd <= 0.001 ? x : (tanh(gg * x + b) - tanh(b)) / (1 + pd); }, ph, pd > 0.001);
}
function val2Hz(f) { return up(unitOf(f, "Hz").join(" ")); }
// a waveshaper's curve, input -1..1 across, output up
function transfer(g, x, y, w, h, key, fn, hot, on) {
  g.fill(x, y, w, h, WELL);
  g.fill(x + w / 2, y, 1, h, GRID); g.fill(x, y + h / 2, w, 1, GRID);
  var pts = cached("tf" + key + w + h, function () { return curve(x + 3, y + 3, w - 6, h - 6, function (u) { return fn(2 * u - 1); }, 48); });
  g.poly([x + 3, y + h - 3, x + w - 3, y + 3], 1, FAINT);
  g.poly(pts, 2, hot ? "slot" : on ? TRACE : TRACE_DIM);
}
push.compartment({
  id: "mixer", label: "Mixer",
  pages: [{ label: "Mixer", keys: ["mx_o1", "mx_o2", "mx_o3", "mx_ring", "mx_noise", "noise_col", "pre_od", "post_dist"] }],
  screen: mixerScreen
});

// ---- FILTER: the response, and where each source takes the cutoff --------------------------------------------
// The cutoff is MIDI note 20 + 115 x; Mod Env 1, the amp envelope and LFO 1 add up to 96 x^3 semitones,
// velocity 48 x (vel - 0.5), the key x (note - 60) (voice.c). On g.filter's axis a semitone is a
// fixed distance, so each reach is drawn exactly.
var FA_X = 124, FA_W = 588;
function stX(st) { return FA_X + 6 + (FA_W - 12) * clamp((st - 15.486) / 119.589, 0, 1); } // note 15.486 = 20 Hz, 119.589 st = 1000x
function filterScreen(g, v) {
  var t = v.$touched || "", ft = idx(v, "flt_type", 6), i;
  band(g, "filter", [[0, 120], [FA_X, FA_W], [716, 236]]);
  // the six types, as the panel's selector
  g.text(8, 10, "TYPE", t === "flt_type" ? "slot" : LABEL, -1);
  for (i = 0; i < 6; i++) {
    var col = i % 2, row = Math.floor(i / 2), bx = 8 + col * 54, by = 18 + row * 22, on = known(v, "flt_type") && i === ft;
    g.fill(bx, by, 50, 18, on ? (t === "flt_type" ? "slot" : ACC) : PANEL2);
    g.text(bx + 25, by + 13, FT[i], on ? "#1a0d0b" : DIM, 0);
  }
  var cut = num(v, "flt_cut", 0.5), cst = 20 + 115 * cut;
  liveFilter(g, v, FA_X, 2, FA_W, 50, FT[ft]);
  // the reaches, one row each, from the cutoff
  var rows = [], fe = num(v, "flt_env", 0), fae = num(v, "flt_ae", 0), fl = num(v, "flt_lfo", 0), fv = num(v, "flt_vel", 0), fk = num(v, "flt_key", 0);
  [["MOD ENV 1", "flt_env", 96 * fe * fe * fe, 0], ["AMP ENV", "flt_ae", 96 * fae * fae * fae, 0], ["LFO 1", "flt_lfo", 96 * fl * fl * fl, 1],
    ["VELOCITY", "flt_vel", 24 * fv, 1]].forEach(function (R) { if (Math.abs(R[2]) >= 0.05 || t === R[1]) rows.push(R); });
  if (rows.length > 3) rows.splice(3);
  if (!rows.length) g.text(FA_X + FA_W / 2, 72, "NOTHING MOVES THE CUTOFF", FAINT, 0);
  for (i = 0; i < rows.length; i++) {
    var R = rows[i], y = 58 + i * 10, hot = t === R[1], st = R[2], c = hot ? "slot" : MODC, x0 = stX(cst);
    if (Math.abs(st) < 0.05) continue;
    var xa = R[3] ? stX(cst - Math.abs(st)) : x0, xb = stX(cst + (R[3] ? Math.abs(st) : st));
    g.fill(Math.min(xa, xb), y, Math.max(2, Math.abs(xb - xa)), 3, c);
    if (R[3]) { g.fill(xa, y - 2, 2, 7, c); g.fill(xb - 2, y - 2, 2, 7, c); }
    else g.fill(xb + (st > 0 ? -2 : 0), y - 2, 2, 7, c);
    var lx = Math.min(xa, xb) - 6, rx = Math.max(xa, xb) + 6;
    var s = R[0] + " " + (R[3] ? "±" : "") + (R[3] ? trim(Math.abs(st), 1) + " ST" : val(v, R[1]));
    if (lx - g.measure(s) > FA_X + 4) g.text(lx, y + 4, s, hot ? "slot" : TEXT, 1);
    else g.text(rx, y + 4, s, hot ? "slot" : TEXT, -1);
  }
  g.fill(stX(cst) - 0.5, 53, 1, 33, t === "flt_cut" ? "slot" : FAINT);
  // the right: cutoff, resonance and drive in words, key tracking across the keyboard
  var x = 724;
  g.text(x, 12, "CUTOFF", t === "flt_cut" ? "slot" : LABEL, -1);
  g.value(x, 31, val(v, "flt_cut"), t === "flt_cut" ? "slot" : TEXT, -1, 110);
  g.text(x + 120, 12, "RESONANCE", t === "flt_res" ? "slot" : LABEL, -1);
  g.value(x + 120, 31, val(v, "flt_res"), t === "flt_res" ? "slot" : TEXT, -1, 100);
  var dr = num(v, "flt_drive", 0), dh = t === "flt_drive";
  g.text(x, 50, "DRIVE", dh ? "slot" : LABEL, -1);
  bar(g, x + 50, 45, 80, dr, dh ? "slot" : ACC);
  hMark(g, v, "flt_drive", x + 50, 46, 80);
  g.text(944, 50, val(v, "flt_drive"), dh ? "slot" : TEXT, 1);
  var kh = t === "flt_key";
  g.text(x, 68, "KEY TRACK", kh ? "slot" : LABEL, -1);
  g.text(944, 68, fk > 0.995 ? "FULL" : fk > 0.004 ? val(v, "flt_key") : "OFF", kh ? "slot" : TEXT, 1);
  g.text(x, 81, fk > 0.004 ? "C2 " + sst(fk * (36 - 60)).replace(" ST", "") + "   C4 0   C7 " + sst(fk * (96 - 60)) : "THE SAME ON EVERY KEY", kh ? "slot" : DIM, -1, 220);
}
function sst(st) { return (st > 0.5 ? "+" : st < -0.5 ? "-" : "") + Math.round(Math.abs(st)) + " ST"; }
push.compartment({
  id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: ["flt_type", "flt_cut", "flt_res", "flt_drive", "flt_key", "flt_env", "flt_lfo", "flt_vel"] }],
  extra_keys: ["flt_ae"],
  screen: filterScreen
});

// ---- ENVELOPES: Amp, Mod 1 and Mod 2 at once, each on the engine's curves and times (env.c) ---------------------
var ENVS = [["ae_", "AMP ENV", "amp"], ["m1_", "MOD ENV 1", "m1"], ["m2_", "MOD ENV 2", "m2"]];
function envTargets(v, e) {
  var out = [], n;
  if (e === "amp") {
    out.push("VCA");
    if (Math.abs(num(v, "flt_ae", 0)) > 0.004) out.push("CUTOFF " + val(v, "flt_ae"));
  } else if (e === "m1") {
    if (Math.abs(num(v, "flt_env", 0)) > 0.004) out.push("CUTOFF " + val(v, "flt_env"));
    for (n = 1; n <= 3; n++) if (idx(v, "o" + n + "_shsrc", 3) === 1 && Math.abs(num(v, "o" + n + "_shamt", 0)) > 0.004) out.push("SHAPE " + n);
  } else {
    for (n = 1; n <= 3; n++) if (Math.abs(num(v, "o" + n + "_penv", 0)) > 0.004) out.push("PITCH " + n + " " + val(v, "o" + n + "_penv"));
  }
  return uniq(out, matrixFrom(v, e === "amp" ? 12 : e === "m1" ? 13 : 14));
}
// the fixed routes first, then the matrix's (a name once: "CUTOFF +4.1 ST" covers a matrix CUTOFF)
function uniq(a, b) {
  var out = a.slice();
  b.forEach(function (n) { if (!out.some(function (o) { return o === n || o.indexOf(n + " ") === 0; })) out.push(n); });
  return out;
}
function envScreen(g, v) {
  var t = v.$touched || "", pg = v.$page || 0, i;
  band(g, "env", [[0, 314], [319, 314], [638, 314]]);
  for (i = 0; i < 3; i++) {
    var E = ENVS[i], x = i * 319, cur = pg === i, p = E[0];
    g.text(x + 8, 10, E[1], cur ? TEXT : LABEL, -1);
    var tg = envTargets(v, E[2]), tags = [];
    var rep = Math.round(num(v, p + "rep", 0)), trig = idx(v, p + "trig", 3), nw = g.measure(E[1]);
    if (rep > 0) tags.push(rep >= 127 ? "LOOP" : "X" + rep);
    if (trig > 0) tags.push(trig === 1 ? "SINGLE" : "RESET");
    if (tags.length) g.text(x + 16 + nw, 10, tags.join(" "), t === p + "rep" || t === p + "trig" ? "slot" : MODC, -1, 80);
    var tw = 298 - nw - (tags.length ? g.measure(tags.join(" ")) + 12 : 0);
    g.text(x + 306, 10, tg.length ? "> " + tg.join(", ") : "> NOTHING", tg.length ? (cur ? ACC : TEXT) : FAINT, 1, tw);
    g.envelope(x + 2, 14, 310, 72, envSpec(v, p, { labels: true, color: cur || pg === 3 ? ACC : "#a8473a" }));
  }
}
var ENV_PAGES = ENVS.map(function (E) {
  var p = E[0];
  return { label: E[1].replace("ENV", "Env").replace("AMP", "Amp").replace("MOD", "Mod"), keys: [p + "a", p + "d", p + "s", p + "r", p + "hold", p + "vel", p + "rep", p + "trig"] };
});
ENV_PAGES.push({ label: "Delays", keys: ["ae_dly", "m1_dly", "m2_dly"] });
var ENV_EXTRA = ["ae_dly", "m1_dly", "m2_dly", "flt_ae", "flt_env", "o1_shsrc", "o2_shsrc", "o3_shsrc", "o1_shamt", "o2_shamt", "o3_shamt", "o1_penv", "o2_penv", "o3_penv"];
ENVS.forEach(function (E) { ["a", "d", "s", "r", "hold", "rep", "trig"].forEach(function (s) { ENV_EXTRA.push(E[0] + s); }); });

// ---- the mod matrix, read for what each source drives -------------------------------------------------------
var MM_SRC = ["Off", "Direct", "Wheel", "Chan AT", "Poly AT", "Expr", "Breath", "Sustain", "Bend", "Velocity", "Key", "Random", "Amp Env",
  "Mod Env 1", "Mod Env 2", "LFO 1", "LFO 2", "LFO 3", "LFO 4", "Animate 1", "Animate 2", "Macro 1", "Macro 2", "Macro 3", "Macro 4",
  "Macro 5", "Macro 6", "Macro 7", "Macro 8", "LFO 1+", "LFO 2+", "LFO 3+", "LFO 4+"];
var MM_DST = ["Off", "Pitch", "Pitch 1", "Pitch 2", "Pitch 3", "Shape 1", "Shape 2", "Shape 3", "VSync 1", "VSync 2", "VSync 3",
  "Density 1", "Density 2", "Density 3", "Level 1", "Level 2", "Level 3", "Noise", "Ring", "Overdrive", "Cutoff", "Resonance",
  "Filt Drive", "Post Dist", "Amp", "Pan", "Amp A", "Amp D", "Amp R", "Mod1 A", "Mod1 D", "Mod1 R", "Mod2 A", "Mod2 D", "Mod2 R",
  "LFO 1 Rate", "LFO 2 Rate", "LFO 3 Rate", "LFO 4 Rate", "Glide", "Uni Detune", "Dist", "Chorus", "Delay", "Reverb", "Dly Fdbk",
  "FM 1>2", "FM 2>3", "FM 3>1", "FM N>1", "Osc3>Cut", "Noise>Cut", "Dly Time", "Rev Decay", "Cho Rate", "Cho Depth", "Cho Fdbk",
  "Rev Damp", "Rev LoCut"];
var MM_KEYS = [];
for (var mi = 1; mi <= 20; mi++) { var mp = "mm" + (mi < 10 ? "0" : "") + mi + "_"; MM_KEYS.push(mp + "s1", mp + "s2", mp + "dst", mp + "dep"); }
function slots(v) {
  if (v.$mmSlots) return v.$mmSlots; // read once a frame, however many pictures ask
  var out = [];
  for (var i = 1; i <= 20; i++) {
    var p = "mm" + (i < 10 ? "0" : "") + i + "_", s1 = idx(v, p + "s1", 33), d = idx(v, p + "dst", 59), dep = num(v, p + "dep", 0);
    if (s1 > 0 && d > 0) out.push({ n: i, s1: s1, s2: idx(v, p + "s2", 33), d: d, dep: dep });
  }
  v.$mmSlots = out;
  return out;
}
// the destinations the matrix gives a source (a source index; its unipolar twin counts too)
function matrixFrom(v, src) {
  return slots(v).filter(function (s) { return (s.s1 === src || s.s1 === src + 14) && Math.abs(s.dep) > 0.004; })
    .map(function (s) { return up(MM_DST[s.d]); });
}
push.compartment({ id: "env", label: "Envelopes", pages: ENV_PAGES, extra_keys: ENV_EXTRA.concat(MM_KEYS), screen: envScreen });

// ---- LFOS: the four at once, where each one goes (lfo.c) -------------------------------------------------------------
// LFO 1 and 2 run per voice (Low and High ranges), 3 and 4 are global. Each is Pung's LFO, given the
// cycle lfo.c computes (its triangle starts at the bottom, Exp is a falling cubic); S&H and Rnd (a
// smoothed random) are Pung's random.
var LFO_SHAPE = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "S&H", "Smooth", "Exp"];
function lfoWave(w, ph) {
  ph -= Math.floor(ph);
  switch (w) {
  case 0: return Math.sin(2 * Math.PI * ph);
  case 1: return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
  case 2: return 2 * ph - 1;
  case 3: return 1 - 2 * ph;
  case 4: return ph < 0.5 ? 1 : -1;
  }
  var q = 1 - ph; return 2 * q * q * q - 1;
}
var LFO_TAB = {};
function lfoTable(w) {
  if (LFO_TAB[w]) return LFO_TAB[w];
  var t = [];
  for (var i = 0; i < 128; i++) t.push(lfoWave(w, i / 128));
  return (LFO_TAB[w] = t);
}
function lfoTargets(v, n) {
  var out = [], k;
  if (n === 1) {
    if (Math.abs(num(v, "flt_lfo", 0)) > 0.004) out.push("CUTOFF");
    for (k = 1; k <= 3; k++) if (idx(v, "o" + k + "_shsrc", 3) === 2 && Math.abs(num(v, "o" + k + "_shamt", 0)) > 0.004) out.push("SHAPE " + k);
  }
  if (n === 2) for (k = 1; k <= 3; k++) if (Math.abs(num(v, "o" + k + "_plfo", 0)) > 0.004) out.push("PITCH " + k);
  return uniq(out, matrixFrom(v, 14 + n));
}
var LFO_Y = 15, LFO_H = 56, LFO_W = 231;
// An LFO that runs free (Free, or Common: every voice in step) has no phase Pung can know, so its
// picture never moves (UX-GUIDELINES.md, Live pictures): it is drawn once into the layer. One that
// is synced to the beat or restarted by notes is drawn every frame, live.
function lfoSpec(v, i, cur, t) {
  var n = i + 1, p = "l" + n + "_", w = idx(v, p + "wave", 8, 1), trig = idx(v, p + "trig", 4), rnd = w === 5 || w === 6;
  var rh = t === p + "rate" || t === p + "sync" || t === p + "range";
  return { live: idx(v, p + "sync", 36) > 0 || trig === 1 || trig === 3, sig: [w, known(v, p + "rate") ? v[p + "rate"].value : "?", rh].join(","),
    o: { shape: rnd ? LFO_SHAPE[w] : lfoTable(w), name: LFO_SHAPE[w], rate: p + "rate", trig: trig === 1 || trig === 3,
      color: rh ? "slot" : ACC } };
}
// the page's LFO is named in white; turning the page keeps the pictures (the layer does not change)
function lfoScreen(g, v) {
  var t = v.$touched || "", pg = v.$page || 0, cur = [0, 0, 1, 1, 2, 3][pg], i, specs = [], key = "lfo";
  for (i = 0; i < 4; i++) { specs.push(lfoSpec(v, i, cur, t)); key += "|" + (specs[i].live ? "live" : specs[i].sig); }
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, BG);
    for (var b = 0; b < 4; b++) {
      section(g, b * 239, 0, 235, 86);
      if (!specs[b].live) g.lfo(b * 239 + 2, LFO_Y, LFO_W, LFO_H, specs[b].o);
    }
  });
  for (i = 0; i < 4; i++) {
    var n = i + 1, p = "l" + n + "_", x = i * 239, on = cur === i;
    var sync = idx(v, p + "sync", 36) > 0, trig = idx(v, p + "trig", 4), rh = t === p + "rate" || t === p + "sync" || t === p + "range";
    g.text(x + 8, 11, "LFO " + n + (n > 2 ? " GLOBAL" : ""), on ? TEXT : LABEL, -1);
    // Pung's LFO: the curve, its fill, its playhead and restart flash
    if (specs[i].live) g.lfo(x + 2, LFO_Y, LFO_W, LFO_H, specs[i].o);
    g.text(x + 228, 11, (sync ? "SYNC " : "") + val(v, p + "rate") + (n <= 2 && !sync ? " " + up(txt(v, p + "range")) : ""), rh ? "slot" : TEXT, 1, 120);
    var tg = lfoTargets(v, n);
    g.text(x + 8, 82, tg.length ? "> " + tg.join(", ") : "> NOTHING", tg.length ? (on ? ACC : TEXT) : FAINT, -1, 160);
    var dl = num(v, p + "dly", 0), fd = num(v, p + "fade", 0), extra = [];
    if (dl > 0) extra.push("DELAY " + val(v, p + "dly"));
    if (fd > 0.001) extra.push(up(txt(v, p + "fmode")) + " " + val(v, p + "fade"));
    if (!extra.length) extra.push(["FREE", "KEY", "COMMON", "COMMON KEY"][trig]);
    g.text(x + 228, 82, extra.join(" "), t === p + "dly" || t === p + "fade" || t === p + "fmode" || t === p + "trig" ? "slot" : DIM, 1, 56);
  }
}
var LFO_PAGES = [
  { label: "LFO 1", keys: ["l1_wave", "l1_range", "l1_rate", "l1_sync", "l1_phase", "l1_slew", "l1_trig", "l1_rep"] },
  { label: "LFO 1 Fade", keys: ["l1_fade", "l1_fmode", "l1_dly", "l1_mtrig"] },
  { label: "LFO 2", keys: ["l2_wave", "l2_range", "l2_rate", "l2_sync", "l2_phase", "l2_slew", "l2_trig", "l2_rep"] },
  { label: "LFO 2 Fade", keys: ["l2_fade", "l2_fmode", "l2_dly", "l2_mtrig"] },
  { label: "LFO 3", keys: ["l3_wave", "l3_rate", "l3_sync", "l3_phase", "l3_slew", "l3_trig", "l3_fade", "l3_dly"] },
  { label: "LFO 4", keys: ["l4_wave", "l4_rate", "l4_sync", "l4_phase", "l4_slew", "l4_trig", "l4_fade", "l4_dly"] }
];
var LFO_EXTRA = ["flt_lfo", "o1_shsrc", "o2_shsrc", "o3_shsrc", "o1_shamt", "o2_shamt", "o3_shamt", "o1_plfo", "o2_plfo", "o3_plfo", "l3_fmode", "l4_fmode"];
LFO_PAGES.forEach(function (P) { LFO_EXTRA = LFO_EXTRA.concat(P.keys); });
push.compartment({ id: "lfo", label: "LFOs", pages: LFO_PAGES, extra_keys: LFO_EXTRA.concat(MM_KEYS), screen: lfoScreen });

// ---- EFFECTS: distortion, then chorus, delay and reverb in the routed order (fx.c) -------------------------------------
var FXB_X = [0, 242, 484, 726], FXB_W = 226;
function fxScreen(g, v) {
  var t = v.$touched || "", pg = v.$page || 0, par = routeOf(v) === 0, chain = ["dst"].concat(fxOrder(v)), i;
  var curFx = ["", "dst", "cho", "dly", "rev"][pg] || "";
  g.layer("fx|" + par, function () {
    g.fill(0, 0, g.w, g.h, BG);
    for (var b = 0; b < 4; b++) { section(g, FXB_X[b], 6, FXB_W, 80); g.fill(FXB_X[b] + 6, 22, FXB_W - 12, 38, WELL); }
    if (par) { // the distortion feeds the three side by side; what each adds is summed
      g.fill(FXB_X[0] + FXB_W, 1, FXB_X[3] + FXB_W / 2 - FXB_X[0] - FXB_W + 1, 2, FAINT);
      g.fill(FXB_X[0] + FXB_W - 6, 1, 6, 2, FAINT); g.fill(FXB_X[0] + FXB_W - 6, 1, 2, 6, FAINT);
      for (var d = 1; d < 4; d++) g.fill(FXB_X[d] + FXB_W / 2, 1, 2, 5, FAINT);
    }
  });
  for (i = 0; i < 4; i++) {
    var e = chain[i], x = FXB_X[i], lvl = num(v, e + "_lvl", 0), on = lvl > 0.001, lh = t === e + "_lvl", cur = curFx === e;
    led(g, x + 11, 13, on);
    g.text(x + 19, 17, FXNAME[e], cur ? TEXT : on ? LABEL : DIM, -1);
    var ty = e + "_type";
    if (e !== "dly") g.text(x + FXB_W - 8, 17, up(txt(v, ty)), t === ty ? "slot" : on ? TEXT : DIM, 1, 90);
    else g.text(x + FXB_W - 8, 17, up(txt(v, "dly_mode")), t === "dly_mode" ? "slot" : on ? TEXT : DIM, 1, 90);
    g.text(x + 8, 82, "LEVEL", lh ? "slot" : LABEL, -1);
    bar(g, x + 50, 77, 120, lvl, lh ? "slot" : ACC);
    hMark(g, v, e + "_lvl", x + 50, 78, 120);
    g.text(x + FXB_W - 8, 82, val(v, e + "_lvl"), lh ? "slot" : on ? TEXT : DIM, 1);
    FXDRAW[e](g, v, x + 6, 22, FXB_W - 12, 38, on, t);
    // the signal's way on: in series an arrow, in parallel each fed from the distortion
    if (i < 3) {
      var ax = x + FXB_W + 2, c = FAINT;
      if (!par || i === 0) { g.fill(ax, 44, 10, 2, c); arrowHead(g, ax + 11, 45, 1, c); }
      else g.text(ax + 6, 49, "+", DIM, 0);
    }
  }
}
// a tick under the picture every second (every half second on a short span): the time axis, no words
function timeTicks(g, x, w, base, span) {
  var step = span < 2 ? 0.5 : 1;
  for (var s = step; s < span - 0.01; s += step) g.fill(Math.round(x + w * s / span), base - 4, 1, 4, s % 1 ? GRID : FAINT);
}
var FXDRAW = {
  dst: function (g, v, x, y, w, h, on, t) {
    var lvl = num(v, "dst_lvl", 0), ty = idx(v, "dst_type", 4), hot = t === "dst_lvl" || t === "dst_type";
    g.fill(x + w / 2, y, 1, h, GRID); g.fill(x, y + h / 2, w, 1, GRID);
    var pts = cached("dst" + ty + lvl.toFixed(3), function () {
      return curve(x + 4, y + 3, w - 8, h - 6, function (u) { return distCurve(ty, lvl, u); }, ty === 3 ? 200 : 64);
    });
    g.poly([x + 4, y + h - 3, x + w - 4, y + 3], 1, FAINT);
    g.poly(pts, 2, hot ? "slot" : on ? TRACE : TRACE_DIM);
    g.text(x + 2, y + h + 11, "TONE " + val(v, "dst_tone"), t === "dst_tone" ? "slot" : DIM, -1);
    g.text(x + w - 2, y + h + 11, "MIX " + val(v, "dst_mix"), t === "dst_mix" ? "slot" : DIM, 1);
  },
  cho: function (g, v, x, y, w, h, on, t) {
    // its voices (1, 2 or 3 for Ensemble), each a delay line swept around the base delay by one
    // sine, the voices a phase apart: time across (3 s), each voice's delay up and down
    var nv = idx(v, "cho_type", 3) + 1, rate = 0.05 * Math.pow(160, num(v, "cho_rate", 0.3)), base = 3 + 27 * num(v, "cho_dly", 0.3);
    var dep = Math.min(num(v, "cho_depth", 0.5) * 6, 0.9 * base), hot = t === "cho_rate" || t === "cho_depth" || t === "cho_dly" || t === "cho_type";
    var mid = y + h / 2, sc = (h / 2 - 4) / 6; // +-6 ms, the deepest sweep, fills the height
    g.fill(x, mid, w, 1, GRID);
    for (var k = 0; k < nv; k++) {
      var pts = cached("cho" + k + nv + rate.toFixed(3) + dep.toFixed(2) + w, function () {
        var p = [];
        for (var i = 0; i <= 90; i++) { var tt = i / 90 * 3; p.push(x + 3 + (w - 6) * i / 90, mid - sc * dep * Math.sin(2 * Math.PI * (rate * tt + k / nv))); }
        return p;
      });
      g.poly(pts, 2, hot ? "slot" : on ? [TRACE, "#c9a29b", "#9a7f7a"][k] : TRACE_DIM);
    }
    var fb = num(v, "cho_fb", 0), fbs = Math.abs(fb) > 0.004 ? "FB " + val(v, "cho_fb") : "";
    if (fbs) g.text(x + w - 2, y + h + 11, fbs, t === "cho_fb" ? "slot" : DIM, 1);
    g.text(x + 2, y + h + 11, trim(base, 1) + " MS ±" + trim(dep, 1) + " AT " + val(v, "cho_rate"), t === "cho_dly" || t === "cho_depth" || t === "cho_rate" ? "slot" : DIM, -1, w - 12 - (fbs ? g.measure(fbs) : 0));
  },
  dly: function (g, v, x, y, w, h, on, t) {
    // the echoes: one every delay time, each 0.98 fb^1.5 of the one before; a synced time at Live's tempo
    var sync = idx(v, "dly_sync", 17), lv = v.$live || {}, bpm = lv.bpm > 20 ? lv.bpm : 120;
    var tsec = sync > 0 ? DLY_BEATS[sync] * 60 / bpm : 0.01 * Math.pow(200, num(v, "dly_time", 0.5));
    var fbx = num(v, "dly_fb", 0.35), fb = 0.98 * fbx * Math.sqrt(fbx), hot = t === "dly_time" || t === "dly_sync" || t === "dly_fb";
    var span = clamp(tsec * 9, 0.5, 4), X = function (s) { return x + 6 + (w - 12) * s / span; }, base = y + h - 4, mode = idx(v, "dly_mode", 3);
    g.fill(X(0), y + 4, 2, h - 8, on ? TRACE_DIM : FAINT);
    var a = 1, k = 1;
    while (k * tsec <= span && a > 0.01 && k < 64) {
      var xx = X(k * tsec), hh = (h - 10) * a, alt = mode === 1 && k % 2 === 0;
      g.fill(xx - 1, base - hh, 3, hh, hot ? "slot" : on ? (alt ? "#c9a29b" : ACC) : TRACE_DIM);
      a *= fb; k++;
    }
    timeTicks(g, x + 6, w - 12, y + h, span);
    g.text(x + 2, y + h + 11, (sync > 0 ? up(txt(v, "dly_sync")) + " AT " + Math.round(bpm) + " BPM" : val(v, "dly_time")), t === "dly_time" || t === "dly_sync" ? "slot" : DIM, -1, 130);
    g.text(x + w - 2, y + h + 11, "FB " + val(v, "dly_fb"), t === "dly_fb" ? "slot" : DIM, 1);
  },
  rev: function (g, v, x, y, w, h, on, t) {
    // the tail: -60 dB over the decay time, after the pre-delay, over 6 seconds
    var t60 = 0.2 * Math.pow(100, num(v, "rev_decay", 0.65)), pre = 0.5 * num(v, "rev_pre", 0), span = 6;
    var hot = t === "rev_decay" || t === "rev_pre" || t === "rev_size";
    var pts = cached("rev" + t60.toFixed(3) + pre.toFixed(3) + w, function () {
      return curve(x + 6, y + 6, w - 12, h - 10, function (u) { var s = u * span; return s < pre ? 0 : Math.pow(10, -3 * (s - pre) / t60); }, 90, true);
    });
    g.area(pts, y + h - 4, on ? FILL : PANEL2);
    g.poly(pts, 2, hot ? "slot" : on ? TRACE : TRACE_DIM);
    timeTicks(g, x + 6, w - 12, y + h, span);
    var prs = pre > 0.001 ? "PRE " + val(v, "rev_pre") : "NO PRE-DELAY";
    g.text(x + w - 2, y + h + 11, prs, t === "rev_pre" ? "slot" : DIM, 1);
    g.text(x + 2, y + h + 11, val(v, "rev_decay") + "  SIZE " + val(v, "rev_size"), t === "rev_decay" || t === "rev_size" ? "slot" : DIM, -1, w - 16 - g.measure(prs));
  }
};
var FX_PAGES = [
  { label: "Routing", keys: ["fx_route", "fx_dry", "fx_wet"] },
  { label: "Distortion", keys: ["dst_lvl", "dst_type", "dst_tone", "dst_mix"] },
  { label: "Chorus", keys: ["cho_lvl", "cho_type", "cho_rate", "cho_depth", "cho_dly", "cho_fb"] },
  { label: "Delay", keys: ["dly_lvl", "dly_time", "dly_sync", "dly_fb", "dly_mode", "dly_lp", "dly_hp"] },
  { label: "Reverb", keys: ["rev_lvl", "rev_type", "rev_size", "rev_decay", "rev_damp", "rev_hp", "rev_pre"] }
];
var FX_EXTRA = [];
FX_PAGES.forEach(function (P) { FX_EXTRA = FX_EXTRA.concat(P.keys); });
push.compartment({ id: "fx", label: "Effects", pages: FX_PAGES, extra_keys: FX_EXTRA, screen: fxScreen });

// ---- the voice, the arpeggiator, performance: the module's own pages -------------------------------------------------
push.compartment({
  id: "voice", label: "Voice",
  pages: [{ label: "Voice", keys: ["v_mode", "v_unison", "v_udet", "v_spread", "v_glide", "v_gmode", "v_bend", "v_oct"] },
    { label: "Character", keys: ["osc_reset", "v_div", "v_drift", "vca_gain", "patch_vol"] }]
});
// ARP: the rhythm as its steps (rhythms_gen.h: bit i plays step i), each as long as the gate, every
// second step late by the swing
var RHY = [[0xFFFF, 16], [0x5555, 16], [0x2929, 16], [0x1249, 16], [0x1111, 16], [0x0421, 16], [0x2A95, 16], [0x6AD5, 16], [0x6D6D, 16],
  [0x76DB, 16], [0x7777, 16], [0x7DEF, 16], [0x0101, 16], [0x006D, 8], [0x0029, 8], [0x007F, 8], [0x0035, 7], [0x0015, 7], [0x000D, 5],
  [0x0005, 5], [0x02A5, 12], [0x06B5, 12], [0x0111, 12], [0xDDDD, 16], [0x4949, 16], [0x7777, 16], [0xB5B5, 16], [0x51D1, 16],
  [0x3BBB, 16], [0xAAAA, 16], [0x6D6D, 16], [0x0F0F, 16], [0x94A5, 16]];
function arpScreen(g, v) {
  var t = v.$touched || "", on = num(v, "arp_on", 0) >= 0.5, r = RHY[idx(v, "arp_rhy", 33)], gate = num(v, "arp_gate", 0.5), sw = clamp(num(v, "arp_swing", 0.5), 0.2, 0.8);
  band(g, "arp", [[0, 714], [718, 234]]);
  led(g, 11, 7, on);
  g.text(19, 11, "ARPEGGIATOR", on ? TEXT : LABEL, -1);
  g.text(706, 11, "RHYTHM " + (idx(v, "arp_rhy", 33) + 1) + "  " + r[1] + " STEPS", t === "arp_rhy" ? "slot" : DIM, 1);
  // 16 steps across, a pair of steps the swing splits
  var x0 = 8, cw = 698 / 16, hot = t === "arp_rhy" || t === "arp_gate" || t === "arp_swing";
  for (var s = 0; s < 16; s++) {
    var pair = Math.floor(s / 2), st = (s & 1) ? x0 + pair * 2 * cw + 2 * cw * sw : x0 + pair * 2 * cw;
    var len = (s & 1) ? 2 * cw * (1 - sw) : 2 * cw * sw, inPat = s < r[1], play = inPat && ((r[0] >> s) & 1);
    g.fill(x0 + s * cw + 1, 74, cw - 2, 2, inPat ? GRID : PANEL);
    if (play) g.fill(st + 1, 24, Math.max(2, len * gate - 2), 40, hot ? "slot" : on ? ACC : "#6a2c25");
    else if (inPat) g.fill(st + 1, 60, Math.max(2, len - 2), 4, PANEL2);
  }
  var x = 726;
  g.text(x, 12, "MODE", t === "arp_mode" ? "slot" : LABEL, -1);
  g.value(x, 30, up(txt(v, "arp_mode")) || "--", t === "arp_mode" ? "slot" : TEXT, -1, 100);
  g.text(x + 116, 12, "RATE", t === "arp_rate" ? "slot" : LABEL, -1);
  g.value(x + 116, 30, up(txt(v, "arp_rate")) || "--", t === "arp_rate" ? "slot" : TEXT, -1, 100);
  var oc = Math.round(num(v, "arp_oct", 1));
  g.text(x, 52, "OCTAVES", t === "arp_oct" ? "slot" : LABEL, -1);
  for (var o = 0; o < 6; o++) g.fill(x + 60 + o * 14, 45, 10, 7, o < oc ? (t === "arp_oct" ? "slot" : ACC) : GRID);
  var lat = num(v, "arp_latch", 0) >= 0.5, ks = num(v, "arp_ksync", 0) >= 0.5;
  led(g, x + 3, 73, lat); g.text(x + 10, 77, "LATCH", lat ? TEXT : DIM, -1);
  led(g, x + 70, 73, ks); g.text(x + 77, 77, "KEY SYNC", ks ? TEXT : DIM, -1);
  g.text(944, 77, "SCALE " + up(txt(v, "arp_scale")), DIM, 1);
}
push.compartment({
  id: "arp", label: "Arp",
  pages: [{ label: "Arpeggiator", keys: ["arp_mode", "arp_rate", "arp_rhy", "arp_oct", "arp_gate", "arp_swing", "arp_latch", "arp_ksync"] },
    { label: "Arp On", keys: ["arp_on", "arp_scale"] }],
  extra_keys: ["arp_on", "arp_scale"],
  screen: arpScreen
});
// MACROS: what each macro drives, over its knob (four assignments each)
var MAC_EXTRA = [];
for (var mm = 1; mm <= 8; mm++) for (var ma = 1; ma <= 4; ma++) MAC_EXTRA.push("mac" + mm + "_d" + ma, "mac" + mm + "_a" + ma);
function macroScreen(g, v) {
  var t = v.$touched || "";
  band(g, "mac", [[0, 115], [119, 115], [238, 115], [357, 115], [476, 115], [595, 115], [714, 115], [833, 119]]);
  for (var m = 1; m <= 8; m++) {
    var x = (m - 1) * 119, hot = t === "mac" + m, used = 0;
    g.text(x + 8, 11, "MACRO " + m, hot ? "slot" : LABEL, -1);
    for (var a = 1; a <= 4; a++) {
      var d = idx(v, "mac" + m + "_d" + a, 59), amt = num(v, "mac" + m + "_a" + a, 0);
      if (d <= 0) continue;
      var y = 26 + used * 16;
      g.text(x + 8, y, up(MM_DST[d]), hot ? "slot" : TEXT, -1, 100);
      bbar(g, x + 8, y + 4, 100, amt, hot ? "slot" : MOD_DK);
      var at = clamp(amt * num(v, "mac" + m, 0), -1, 1), mx = x + 58 + 50 * at;
      g.fill(mx - 1, y + 1, 3, 9, hot ? "slot" : MODC);
      used++;
    }
    if (!used) g.text(x + 58, 48, "NOT ASSIGNED", FAINT, 0);
  }
}
push.compartment({
  id: "perform", label: "Perform",
  pages: [{ label: "Macros", keys: ["mac1", "mac2", "mac3", "mac4", "mac5", "mac6", "mac7", "mac8"], screen: macroScreen },
    { label: "Animate", keys: ["anim1", "anim2", "anim1_mode", "anim2_mode", "patch_vol", "v_drift", "arp_on", "arp_scale"] },
    { label: "Macro Edit", keys: ["mac_sel", "mac_k", "mac_dst", "mac_amt"] },
    { label: "Patch", keys: ["preset", "syx_file", "syx_patch"] }],
  extra_keys: MAC_EXTRA
});
// MATRIX: the twenty slots, the ones in use as what drives what
function matrixScreen(g, v) {
  var t = v.$touched || "", sel = Math.round(num(v, "mm_slot", 1)), S = slots(v), i;
  band(g, "mm", [[0, 952]]);
  g.text(8, 11, "MOD MATRIX", LABEL, -1);
  g.text(944, 11, S.length + " OF 20 SLOTS IN USE", DIM, 1);
  if (!S.length) { g.text(476, 50, "NO SLOT IN USE", FAINT, 0); return; }
  for (i = 0; i < Math.min(S.length, 12); i++) {
    var s = S[i], col = i % 3, row = Math.floor(i / 3), x = 8 + col * 316, y = 28 + row * 16, me = s.n === sel;
    g.text(x, y, (s.n < 10 ? "0" : "") + s.n, me ? ACC : DIM, -1);
    g.text(x + 22, y, up(MM_SRC[s.s1] + (s.s2 > 0 ? " X " + MM_SRC[s.s2] : "") + " > " + MM_DST[s.d]), me ? TEXT : LABEL, -1, 200);
    bbar(g, x + 228, y - 5, 76, s.dep, me ? ACC : MODC);
  }
}
push.compartment({
  id: "matrix", label: "Matrix",
  pages: [{ label: "Matrix Slot", keys: ["mm_slot", "mm_s1", "mm_s2", "mm_dst", "mm_dep", "mm_clear"] }],
  extra_keys: MM_KEYS,
  screen: matrixScreen
});

// ---- Pung's envelope on Crest's own times (env.c) -----------------------------------------------------------------------
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    var m = /^(ae|m1|m2)_(a|d|r|hold|dly)$/.exec(s.key || "");
    if (!m || s.raw === null || s.raw === undefined) return null;
    var x = parseFloat(s.raw);
    if (isNaN(x)) return null;
    switch (m[2]) {
    case "a": return envTime(x, 20);
    case "d": return envTime(x, 22);
    case "r": return relTime(x);
    case "hold": return clamp(x, 0, 1) * 0.5;
    }
    return edly(x);
  });
});

// mm_sel is the module's list selection on Move: the same slot mm_slot turns, counted from 0 (tools/gen/params.py)
push.unused(["mm_sel"]);

// ---- the wavetables: WT_DATA, 75 tables x 16 frames x 64 samples, base64url 6-bit (tools: wavegen.py) ----
var WT = [
 "grxyyzzwusrpoonnmnnmmnnoopqqppolgaXWWVVWXXYYZZYYZYYXXWUTRPMMNNOUgw3420xsomlkklmllllkkkkklnpqrsrngYUTUVWYabbbbbaaaaZabbaZXTOLJHIPg0861wqkhiklmnnmmmmllkkiijmoqtupgWRSVXZcddbbaaZZZZYYZabdebVPKFDLg2_5vojghmppoonmlmmmmnmkiijkotvrgUQSXbcddbZYZZZZaZYXXWWZefcXQGAJg4_1oihjosspnnnmmnnmmnonljihlrvrgUQUaedcaYXYZZYYZZYYYWTTXcedXKAHg38wjglqsspmlnonmnnmllnnnmjhiourgURXdecZYYYaaZYYZYXYaZWTTVafcPDIg36rgirurommnoommmnmmlllnomigmtrgUSZfdZXYaaaZZYZZZXXYZZXURUdfUFIg33nfnvunlnoonnmmnnmmnmklopkgkrrgUUbfbWXabZYZZYYZZYYXXYaYRQYgYIIg20lhsxqjmqpmmonmnnllnnkjmpmhjqqgVVceZWZcbYYaaYYZYXZZWVZcVOTeaLJg0ylkuvnjpsnknpmknomkmoljlpnikppgWWbdYWacaXZbZXYbZWYbYTWcYQRbaNLgxwnmttmlqrmkoqmknpmkmomjlomjlongYXacZXacZXZbZWYbZVXbZUVaZSSZYPOguwporrnnpqmmoomlnomlmnlkmnlkmomgZXZbaYZbaYZaZXYaZXXZZVWYYUUXWPRgtvroqqonppnmoommnnmlmmllmmllmomgZXZaaZZaaZZaZYYZZXXZYWWYXVVXUQSgsvroqqpnopnnnonmnnmlmmllmmllmomgZXZaaZZaaZZaZYYZYXYYYWXYWVVXUQTgsvroqqpnopnnnnnmnnmlmmllmmllmnmgZYZaaZZaaZZaZYYZYYYYYWXYWVVXUQTgsvroqqpnopnnnnnmnnmlmmllmmllmnmgZYZaaZZaaZZaZYYZYYYYYWXYWVVXUQT",
 "gz62z120z00zyyyxwxxwvwwvuuvtstvqgVQSTSQRRQPPQPOOPONNNMLLMLJKMJFMg173z120y00yxyyxwwxvuvvutuusrtuqgVRSUTRRSRQQRQOPPONNONLLNLJKMIEKg3930230y00yxyywvwwvuuutsttsqsuqgVRTVTSSTSRRRQPPQPNNONLLNLIJLICIg4_40230yz0ywxxwvvvutuusrstrqrtpgWSUVUSTUTRRSRQQQPOOPNLMNLIJLHAHg4_3z12zxyywvwwutuusrssrqrrpoqrogXUVXWUUVUTTUTRRSRPPQPNNOMJKMIAHg281wyzwuvwusttsrsrqpqqooppnmopmgZWXZYWWXXVVWVUTUTSSTRPQRPMNPKDJg05yuwxusttrqrrqpqponoonmnnmlmnlgaYZaZYYZYXXYXWVWVUUVUSSTROPRNGLgz3wsuvsqrrqppponoommnmllmlkklmkgbZabbaZaaZYZZXXYXWWWVUUVTQRTPIMgx1uqstqpqqonoommnmllllkkkkjjkkjgcbbccbbbbaaaaZYZZXXYXVVWVSTVRKOgwztprrpnoonmnnllllkkkkjjjjiijjigdccddccccbbbbaaaaYYZYXXYWUUWSMPgvxropqnmnnllmlkkkkjjjjiijiihiihgeddeddcddccccbbbbaZaaYYZYVWXUOQguwqmopmlmmlklljjkjiijjiiiihhiihgeddeeddddccddcbccaabaZZaZWXZVPRgtuplnnlkllkjkkjijjiiiihhihhhhhggfeeeeedeeddddccdcbbcbaabaYYaWRSgstolmnkjkkjjjjiiiihhihhhhhgghhggfeeffeeeeedeeddddccccbbcbYZaXSTgrsnklmkjkkiijjihiihhhhgghhggggggfffffeeffeeeeddedccddbbcbZabYTUgqrmjlljijjiiiihhihhhhhgghgggggfggfffffeffeeeeedeeddddccdcaacZUV",
 "g4_1oigdaZchmooljhggghhhhhhggggggfffffeeeeeefffecaXXZejmlifdXKAHg5_1srphXUYdilnnmkihgggghhhggggfggffffeeeffffedbZYYadinroeWUTKAGg5-2z2ykYVYZbgklmmljihhgghgggggfggfffffeffeedcaZZabfkmnqnbNJMJBGg283494pfdbXWbfgilljjjigghgfghgfggfefgfeffdcccaadfgkpokigWHCHIDJgw21584uolhbZbccehihijihhihfghgfggfefgedeedcdedehjjkmkeaXRHDGKJPgsz25860wtoiffecdfgfgihhhhhgghgfggfeffeeeeedfgfgijhggdXSPLFDGJMTgpw035641yvroljhhgggghhhhhhggggggfffffeeeeeeffffeecaXUQNKHFGILPWgnswz13220ywuspomlkjjiiiihhhhggggfffeeeeddddccbaZXWTRPNLJJIKMPTYgnswz13221zwusqnmlkjjiiiihhhhggggfffeeeeddddccbaZYVTRPMKJJIKMPTYgsxx17720zwqnmkhghhgghhghhhgghgfggfeffeeefeeffeefebZYVPMLJEEKOOTgz520485yrmjgedddefgghhhhhhggggggfffffeeeeeeffghiiihfcZUNGDHLJGMgz9-4ytpnkhdbbcdfghiiiihhhgggggggffffffeeeddddefgijkkiebYWSNHBCMgw7-83wrnkifedddefghhhhhhhgggggggffffffeeeeeeefghiiihgdbYUPIDBEPgv5-961xtqomjigffffgghhhhhhggggggfffffeeeeeeffggggfdcZXVSOKFCBGQgs15652zxvtrpnmkjiihhhhhhhhggggggfffffeeeeeeeeddcbZYWUSQOMJGFGKTgpx1221zywvutsqpomllkjjiiihhhhgggffeeeedddccbaaZXWVTSRQPNMKJJKOW",
 "g1_92xusrrqpoonmmmlkkkjjiiihhhgggffeeedddccbbbaZZZYXXWVUUTROJCAKgy55550srtsoopomlnmkklkiijihhhgfggfeeedcddbabbZYaZXWXXTSUTLGGGGNg14xz88xrttqoppmmnmkklkiijihhigfggfdeedcddbabbZYZZWWXVSSUODDMOHKg04wu185ytsrqpoonmmllkkjjiihhhgggffeeeddccbbaaZZYXXWVUTSNGDKRPHLgy4ytv1550urqrpnnnmlllkjjjihhhgfggfeeedcccbaaaZYYYWUVURLGGKQSNHNgz3wtvwx272tqsrnmonlkmljjkjhhigfggfdeecbccaZbaYXZYUTVSJEJOPQSPIMg03vswwtv361trrqonnmlllkjjihhhgggffeeedccbaaaZYYXVUUSKFIQSPPTQILgy3wruwurv251vrqponmmlkkjjiihhgggffeeddccbbaZZYXWVUQKGJQURPRUPINgy3wstvtstvz33wppqpmlnljjkjhhihfggedeecbccaYaZWVWWPIIMQSTSQSTPINg02usvursutsx43vqqqnmmmkjkjhhihfggedeecbcbZZZYVVVQIHOTSRTURQTRJLgz3vrtvsqsurrx33wrppnmllkjjiihhggfeeddccbaaZYWWUPIIOUURTVTQSUQIMgy2wrtusqrtsqrw12yrnoomkkljiiihfggedddcabbZXXYUNJKPUVTSUVTRSUPJNgz2uruurqsrqrsrtz4yqnpokklkhiihfggeddebabbXWYVNHMSUTUVUTVURRURJMgz2urtuqqsrppsrpsz3yronnlkkjihhggfeedcbbaYYXUNIMTWUTWWUTVVRSURJMgy2vrsurpqrqoqrqory1zsnmmlkjiihggfeddcbaZZYTMKNUXVUVXVUVWURTUQJNgz2vrttrprrpppppppqv00tmmnliijhfggecddaYZZSLLQVWWWWWWWUUWUSSUQJM",
 "gmtx13443210zxwvutsrqponmmlkjhhggfeecbaZZYXWVUTSRQPOMLKJIHHIKOSZgnty13443210yxwvutsqponmmllkjhgggffecbaaZZYXWVTSRQPONLKJIHHIKNSYgnuy2444321zyxwvutrqponmmllkihgggffedbaaZZYXWVUSRQPONMKJIHHHJNRYgouz2454321zywvvusrqponmlllkihgggffedbaaaZYXWVUTRQQPNMKJIHGHJMRXgov03555320zxwvutsrqpommlllkihgggffedbaaaZZXWVUTSRQPOMLJIGGGILQXgpw14555320yxvvutsqponmllllkihgfggfedbaaaaZYXWVTSRQQONLJIGGGHKPWgpx24665310ywvuutrqponmllllkigffgggfdbaaaaZYXWVUSRRQPNLKIGFFHJOWgqy3566531zxwuuttrpoonllkllkigffgggfdbaabaaYXXWUSSRRPOMKIGFFGINVgqz4676531zxvuttsrponmlkkllkigffgggfdbaabbaZYXWUTSSRQOMKIGFEFHMVgr05676520ywutttsqponmlkklmkifefgghgdbZabbaZYXWVTSSSRPNLJGFEFGLUgs1677752zxwutsssqonnmkjklmkhfeeghhgebZabcbZYYXVTTTSRPOMJGEEEFKTgt2788752zxvtssssqonmmkijlmlhedeghiheaZacdbZZYXVTTTTSQOMJGEDDEJSgu4888741ywusrrsspnmmljijlnlhedeghiheaYacdcaZZYWTTUUTRPNKHEDDDHRgv5998740xvtrqrsrpmlmljhilnlhdcdgijieaYadecaZaZWUTUVUSQOLHEDCCGQgw7-98630wutrpqsrpmlmligimomhcbdgikjeZXZdfdaZaZWUTVWUSRPLIFDCBEPgy9_9863zvtsqoprrolkllifhmpmgcbdgikjfZWZegdaabaXUUWXVTSQMIFDCACN",
 "gkptwy000zywvvuttsrqomkhecaZZabdgiklmmljhebZXVUTSSRQQPNMLLLNPSWbglrvy000zyxwuuttssrqomjhfdbaZZbdgikmmlkigecZXVUTTSSRRPONMLLLNQUagntx0110zxwvttsssrrpomjhfdcaZZadgilmmljigecZXWUUTTTSSQPOMLKKLOSYgouz2210yxvusrrrrrqpnljigecaZZacgjlmmljhfdcaYWVUUUUUTRQONLKJJMRXgpw13320ywutrqqqqqqonljihfdbZYZcgjmnmkigedcaYXVVVVVVUSRPNLJIIKPWgpy3542zxvtrqppppppomkjihgebZYZcgjmnmkhfedcbZXWWWWWWVUSQOMJHGINWgqz5652zwusqponooponmkjiihfcZYZbgkmnmjgeddcbZYXWXXYXWVTRPMJGFGMVgr16762yvtrpnmmnnoonlkjiihfdaYYbgknnligeddcbaYXXYYZZYWUSQNJFEFKUgs27962yuspomlllmnnmkjijjigdaYYbgknnlifdccdcbZYYZaaaZXWTRNJFCEJTgt39972xtqomlkkkmmmlkjijjjheaYYbgknnlhecccdcbaZZZbbbaZXVSOJECCISgt4--72wspnlkjijlmmljiijkkieaYYbgknnlhdbbcddcaZZacdcbaYWTPJEBBHSgu5__71wromkihhikllkjiijkkifaYYbgknnlgdbbcddcbaabdeedbZXUPKEAAGRgu5__71vqnljhgghjkkkihijkljfbYYbgknnkgcabcdedbbbceffecaYVQKEAAGRgu5__60upmkigffgijkjihhjlljfbYYaglnnkgcaaceedcbcdfggfdbZWRLFAAGRgu5__6ztoljhfeefhjjihhhjllkgbYYaglnnkfbaaceeedcceghhgecaXSMFAAGRgu6_-6zsnkigeddfhijihghjlmkgcYYaglnnjfbZacefedcdegiihfdbYTMFBAFR",
 "gptrqrsrqrrrqrrrqrrrqrrrqrsrqrtpgWSUVUTUVUUUVUUUVUUUVUUUVUTUVUSWgrurqssrrssrrssrssrrssrrssrrtriXTVWVUVVUUVVUVVVUVVVUVVUUVVUUWVTWhrutrstssstssstssstsssttrsuskZTVWWVVWWVVWWVVWVVVWVVVWVVVWVVVXVTXhsvtstuttutttutttutstussvumaUVXWVWXWWWWWWWWWWWWWWWWWWWWWWWVWXWUXiswutuvutuuuuuuutuvuttvvodVVXXWWXXWWXXWWXXWWXXWWXXWWXXWXXXWXYWUYjuxvuvwuuvvuvwvuvwvuwxqeWWYYWXYXXXXXXXXXXXXXXXXXXXXXXXXXXXWXYXVYkuywvwxwvwwwwwwxvvxyshXWYZXXYYXXYYXXYYXXYYXXYYXXYYXXYYXYYYXYZXVZkw0xwyyxwyywxyxwx0vjYWZZYYZYYYYYYYYYYYYYYYYYYYYYYYYYYYYYZYYYZYWZmx0zxyzzyyzzyxz0xmaWYaZYZaZYZZYYZZYYZZYYZZYYZZYYZZYYZZYZaZYZaYWamz30y11zz11zz30obXZaZZZaZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZaZZZaZXao042112221242reXZbaYZbaZaaaZaaaZaaZZaaZZaaZZaaZZaaZZaaZabaYabZXbp3742563266ufYZbaaabaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabaaabaYcr48755687yjZZccaacbabcbabcbabcbabcbabbbabbbabbaacbabcbabcbZbdbYdq495379zkbbddbccccccccccccccccccccccccccccccccccccccccccccbcdcads47772ocaefcceeccedcdedcdedcdddcdddcdddcdddcddccddccedcdedbdfdafr5_3oeceeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeedeeecf",
 "fKEJMKKMONOQRQRTUTUWXWXZZabccdefgghijjklmmopoprsrsuvuvyyxz11z271VNLNQRRSUVVXYZabdeefhiikmmnoqrrtvvvxzzz24338_0dLJPSQQTVUVYZZZcfccKHMPOPSUUWYZacefgjklmpqqtvwwz2117-wXGIPPOQUUUXaaadffgkllmqrqtzuNLMOQRTVWYabdfgiklnprrtwxx062kPINSRRVYYYceefjlkmprrsxywz63lQINSRYMJOTSTXaacgiilpqquyyy48xYIKSTSVZaaehijnqprwywz76nRINSTTWZbcehljfLHOSSTXbbdhkkmrtsv33nRHLSSSWabcgjklpttt04uYIIQTSUZbbeikkostty4zTOLPVXXafhikpssu15xdNKQWXXbghilqssv25uaLLSWWXcghimrssw34rXKMSXYXbMKQVWYdghlqssy5zdKJSWVYehhlrssz6wZJLTVVafginrrt15tWILUWWaghhnurMPOPVbbciooou31kSLOVZachmoot12qWLNUZZbglnosz3ubMLTYZafkmnrx2xgPJYMLTZZbinnpx4yfOKSZabhnopx4xdMLUZZcjnoqy4wcMLUaacjooqz5uYLNVYaghfMKTYZdknnu2wbKLVZZelnow2tWJNWZZgmmpy2pSJPXZahmmq01kPJRYYbjmns1zRKQXXajnmt3ycMPXZcjnnu3wZLPXadjnow3tXKQZadknpx2rUKRabdloqx2oQJVabOMUcfhmt0xiQKSdgfku0wiSLRchgju1xiSMRbhhjs2yiRMRagijr00kQLTachppJNRVbgjoxznULScgglw0raNOYggis0wfPNVdgipyzmULScgglw0rZNOYghjs1wfOWOPXehkt1ubMPaggmx1oVMSdgipzziQMWfgjs1vcNOZghlw1qWMRcghoz0kRMVfffNNYfglxzjPMWfgkv0mRLVegju0pULTdgis0rWLRcfhq0uZLQbfgpzwcMOafgnyx",
 "gu48741ywuspnlkjjiiiiiiihhhhgggggffffeeeedddddddccbaYWTRPNKHEDHRgy9-62yvtpligffgghhhhhhhhhgggggggffffffeeeeeeeeeffggfdaWSQNJFBCNg0-92xvsmhdbbdfghhhhhhhggggggggggfffffffffeeeeeeefgikkieZTQOJCBLg3_6yvsmeYYadghiiiihhhgggggggggggffffffffffeeeddddefilnnhZTQNFAIg4_2vtndVVaehjkkiihggggggggggggfggffffffffffffeddbbcehlqqiYSQJAHg5-0tphVRYgjkmmighhgghhgghgfgggfggfffgfeffeeffeefdZZbcfnuqeWSLBGg49zqkZRUgnnmmkffhhggihgghgfghgfggfefgfeffedffeeggbZZYYfrumbVMCHg38zndUSbnroljgefiihhihgghhfghgfggfefgeeffedeeddghfcaXUYktriYMDIg28yiWTYjssmhffgijjhhhhgghgggggfggfffffeffeeeeccdfggeZTTcnspdNDJg27vdTVfqupieehjjjihhhhhhhgggggfggfffffeeeeeeedcccehhdWRVgqsiQEJg37sYRZmutkedgkljihhhihhhhgggggggffffffeeeedeeedcabfihbSRZmunTEIg36oVSftwofcfkmkihhiiihhhhhggggggfffffeeeeedddeedbZbgjgXPSgtqXFIg44kSVmxtibeknlighiiihhhhhhggggggfffffeeeeeedddefdaYbhkdSOZqtbHHg53gRasyodcinnjghjjihhhhhhhggggggfffffeeeeeeedccefcYYdjiXNTlufIGg51cRfxwiafnokghjkjhhiihhhhggggggfffffeeeeddeecbcefbXYgldPOgujKGg6zZSl0sdblqmhgjkjihiiihhhhgggggggffffeeeedddedcbcfeZVakiTLatmMF",
 "WfopqvxslknmcSPSVVPHDHQcnvsieo34pccfbYabSHOhpgYfrphjsrjlz6sYTZaVXgoqquxslknlbROSWVOHDGQcovsidn35qcbfcYabSHOgofYgrphkrrjm05sZTYaWYgorqtvsmlolaPOTWUOHDGPcovsidm36rcbfcYacSHNgoeXgrohkrqjm05saTYbYZgorrsusmlolZONTXTNGDFPcovsjdm27sdbecYbcSGNgndXhroilrpjn05sbUYbZbgpsrrtsnlolYMMUXTMGDEOdpvsjcl28udaecYbdSGNgmcXhroilroin15tbUXcbcgptrqssnlolXLMVXSLGDEOdpvsjck29vdaecYbdSGNglbXisoimrnio15tcVXcddhpusprsomolWJLVYRKGDDNdqvsjbi2-wdZecYbeSGNglaXjsnimrmip24tdVXcefhpvsnpromokVILWZRKHDDNdqusjbh1-xdZedZceTGNgkZXjsninqlhp13tfWXdghhpvsmnrpmnkVHLYaQJHEDNequrjag0_yeZedZcfTHNfjYXkrminqkhq12tgXXdiihpwslmqpmnkUGLZaQJIFDNeqtrjafz_zeYedZdfUHOfiXXkrmioqjhq11thXWekkhowsjkppmnjTFLabQJJGENeqtqjaey_zeYeeadgUIOfhWXlrliophgq00siYWfmliowriippmnjTFLbcQJKIFNfqsqjacw-0fYeeaegVJPfgVXlrkiooggr0zsjZXfnniowrggopmmiSFMcdQJLJGOfqrpjZbv-0fYeebehWKQffVXlqkipoffrzxskaXgpoiowrffnpmmiSEMdeQJMLGOfqrpjZau-0fYefbfhXLRfeUXmqjipnefrywrlbXgrpinwrednpmliRENeeQKNMHOgqqojZZs91fYefbfiXMRedTYmpiipmdfryvrmcXhsqinwqccmpmlhRENffQKONIPgqpnjZYr91gYefcfiYNSecTYmpiipmcerxtqndXht",
 "g4_51441z00ywxwuttsqqqpnmmljjjhggfecccaZZYWVVVTSSRPOPNLLMKHHKGAHg1941341010yxxxvuutsrrqonnmkkkihgedbbbZYYXVUUTSRRQOOONLKLKHIKHCKgz631331011zyyxwvvutssrpoonmlkjhgecbaZYXXWUTTSRQQPONNMKKLKIIKIFMgx420231011zyzyxwwvutssqppommlkigdbaZZXWWVTTSRQPPONMNMKKLKIJLJHOgv1001210110zzyxxwwuutsrqqpnmmljgcaZZYWVVUTSRRPPOONMMLKKLKJKLLKQgtzzz0110110zzzyxxwvuutsrrqonmljgcaZYXVUUTSRRQPOONMMMLKKLKKLMMMSgsxyy0100110zzzyyxxwvvutsrqponmjgcZYXWVUTSRQQPOONNMMMLKKLLKLNNOTgqwxxz00000000zzyyxxwvvutsrqoomkgbZXXVUTSRQQPOONNMMLLLLLLLLMOOPVgpuvwyzzz000000zzyyxwwvuttsqponkgbYXWVTSSRQPPONNMMLLLLLLMMMNPQRWgotuvxyzz000000zzzyyxxwvutsrponkgbYXWUTSRQPOONNMMMLLLLLLMMNOQRSXgnrtvwyyzz000000zzzyyxwvvutrqpnkgbYWVUSRQQPONNMMMLLLLLLMMNNPQSUYgmqsuwxyyzz000000zzzyyxwvutsqpnkgbYWVTSRQPONNMMMLLLLLLMMNNOPRTVZglprtvwxyzz0000000zzyyxwvvusrpnkgbYWUTRQQPONNMMLLLLLLLMMNOPQSUWaglprsuwxxyzz0000000zzyyxwvusrpnkgbYWUTRQPONNMMLLLLLLLMMNOOPRTUWagkoqsuvwxyzz00000000zzyxwvutrpnkgbYWUSRQPONMMLLLLLLLLMMNOPQRTVXbgknprtuwxyyzz0000000zzyyxwutrpnkgbYWUSRPONNMMLLLLLLLMMNNOPRSUWYb",
 "giknprtvxy0123344433210yxvtrpnkigdbYWUSQONLKJIIHHHIIJKLNOQSUWYbdgilnqsuwyz122344443210zxwusqomkigdbZXVTRPOMLKJIHHHHIJJKMNPRTVYadgjlortvxz0123344433210yxvtrpnljhgecaYWUSQONLKJIIHHHIIJKLMOQSUXacgjmpsuxy0123334433210zxwusqomkjhgecbZXVTRPOMLKJIIHHIIIJKLNORTWZcgjnqtwyz1223333332210yxvtrpnmkihgedbZYWUSQONLKJJIIIIIIJJKMNPSVYcgknruxz1233333332210zywusqonljihgedcaYXVTRPNMLKJJIIIIIIIJKMORUYbgkosvy0233443332210zyxvtrqomkjihgedcbZXVUSQONMLKJJIIIHHIIJLNQTXbgkptwz1344443322100zxwutrpnlkjhggfecbaYWUSRPOMLLKJJIIHHHHIKMPSWbglpux0345554322100zyxvusqomljihggfedcaZXVTRQONMLLKJJIHGGGHILORWaglqvz24566543210zzyxwutrpomkjihggfedcbZXWUSRPONMMLKJIHGFFGHJMQVaglrw03567654320zyyxwvtsrpnmkjihggfedcbZYWUTSQPONNMLJIHGFEFGILPUagmrx14677764310yxwwvutrqonlkihhggfeedbaYXVUSRQPPONLKIHFEEEFHKOUZgmsx2578876420zxwvuutsrpomljihhggfeedcaZXWUTSRRQPOMLJHFEDDEGJOTZgmty3689986420ywvuttsrqpnmljihhggfeedcaZYWVUTSSRQPNLJHFDCCDFINSZgntz479--8641zxvutsrrqponmkjihhggfeedcbZYXWVUUTSRQOMKHFDBBCEHMSYgnu058-_-9641ywussrqqpponlkjihhggfeedcbaYXWWVVUTTRPNKHFCBABDGLRY",
 "g9-slqrkjmmhhkjfgigefgdceeaZdZONgyxmimlhhjifghfdfgcbeeZZcbUVaTBCg8_vloqlilmihjjgfhifefgdbdfbXZgjgcfmokgikifghgdegfccedZadaVXaQADg9-tlqsmklkhikighigeghedfeYYhnjeghcYennhgihefhfdefdbdebabZTVaSBCg8-tlqsmjmnjijjgfiifeggbZdjlkhgggffebacimkffhgddgfccdcYZcZTVaSBDg9-tlprmkmmjjkjiiifdfeabkplfhkhdgiebegaWbklhgigdddcbccZZbZUWaSBCg9-tlqrljmmihkkggihdbglljiihhhgfggfeeeddcaafkiedffbbedZZcaUVaSBCg8-tlprmkmmjijigfecfnqmikmidgigdgifdfidZbdZVYgjhgfdcdcZZbZUWaSBDg9-slqrkimlggkiccjpolkkjjjiiijgeghfcdddcccbbaXWcjjdbffaZdbUVaTBCg8-ulormikligefjoqmikmkhjkigikgdgifbdfdbcebZbdZVXcghfdabdZUXaRBDg--slqrkimkdenroklmjjkjiijhfghgfggfefgecddcbccZabXUYhibZdbUVaTBBg8-ukorlffjnrroklnlkllhegiheghfdgigefhedfheaabaYabXUUYcggaUXbRBDg-9rlqofgrvplnolklkhhjjggiighigeghfdefddffcceebabaXYaWQUfgXVaUCBg7-thjqsssqonmkijkjijkjhijhfghgeghfefgecdecbcdcbcdbZYXVTTTVceSBEg97nkx1smppkjnnjjlkhhkjghjhfgigeghfdfgecefcbeebaccYYcbWWZTKObYECg4_3vtsqooomlmlkkkjiijihhihgghgfggfeffedeedcddcbbbaZaZXXXVTSQIAHg9-tlqsmjnnjilliikjhhjiggihfghgfggfefgedffdceecbddaadcYYcZTVaSBC",
 "g3_63552011zxyxvuutrqqpnnmlkjjhggfeccbaZYYWVVUSRRQONOMKKLJGGIFAIg2-63553111zyyxvuutrrqponnlkjjhggfeccbaYYXWVUUSRRQONNMKKKIGGIFBJg0864553221zyyxwvutsrqponnlkjjhggfeccbaYYXWVUTSRQPONNMKJJIGGHFDLgz7645532210zyxwvvusrrqonnmkjjiggfdccbZYYXVUUTRQQPONMLKJJIGGHFEMgy6545532220zzywvvusrrqonnmkjjiggfdccbZYYXVUUTRQQPNMMLJJJIGGHGFNgw5545543220zzywvvutsrqoonmkkjiggfdcbbZYXXVUTSRQQPNMMLJJIHGGHGGPgv4545543220zzyxwvutsrqponmlkjiggfdcbaZYXWVUTSRQPONMMLJJIHGGHGHQgu34455433210zyxwvutsrqponmlkjiggfdcbaZYXWVUTSRQPONMLKJIIHGGHHIRgu24455433210zyxwvutsrqponmlkjiggfdcbaZYXWVUTSRQPONMLKJIIHGGHHJRgt13455433210zyxwvutsrqponmlkjiggfdcbaZYXWVUTSRQPONMLKJIIHGGHIKSgs034554332100zywwvtsrqponmlkjihgedcbaZYXWVUTSQPPNMLLKJIIHGGHILTgsz24454432100zyxwvutsqponmlkjihgedcbaZYXWVTSRQPONMLLKJIHHGHHJMTgrz23454432210zyxwvutsrponmlkjihgedcbaZYXWUTSRQPONMLKJJIHHGHIJMUgqy23444433210zyxwvutsrqonmlkjihgedcbaZYXVUTSRQPONMLKJIIHHHHIJNVgqx13444433210zyxwvutsrqpnmlkjihgedcbaZYWVUTSRQPONMLKJIIHHHHIKOVgqx13444433210zyxwvutsrqpomlkjihgedcbaZXWVUTSRQPONMLKJIIHHHHIKOV",
 "RVdoutnlpz8-2oWGAISSNPZeaYdeXTZeXQXkqmjjiffjpuyxpilrqljmlfbbZUQPRUcnutolpy792nVHCJTTOQafcaefYVaeYRXkpmjjieejoswwohkqqljlkfccaVRQRTbmtsolox691mVHDLUVPQahfdffZWbfYRXkoljjhdejnrvungjqqkjlkfccaWSRRSalssolow690lUIEMVVQRbihfgfZWcfYSYkoljjhdeimpttmgjppkikjfccbWTSRSZkrsolnv580kUIFNVWQRbkkhheZXcfYSYkokijhddhlosslfippkikjfddbXUTRRYjqrolnv580kTIGNWWRScmmjheZYdfYTZkokiigddhknrrkeioojhjjgddbXVUSRXipromnu480kTIGOWWRSdnplhdYYdeYTZloliigddgjnrqjehoojhjjhedaYWVSRWhoqomnu470kTIHOWWRTeprnidYYdeYTalplhhgedfhmrqjdhnojgikifdaYXWTRWgnpnmnu370kSHGOWWRUfrtoicXYdeXTamqlgggfddgmrqidgnnifiljgcaYYXTRVfmonlnu370kSHGOVVRUhsvqibXYddXTbnrmgfgfdcfmsqhcgnnheilkgcZZZXTRVelnmlnu371lSGFNVVRViuxribWXcdWTbotmfeggdaemtrhbfnngeimmhcZZaYURVekmllou371mTGENUURWkwysjaVXccWTcqunecghdZcmurgafnngchnnicZZaYUSWeklkkov372nTFDMUURXmyzsjaUVbcWScrwndbghcXbnwsgZfnmebhppjcYZaZVTWejkijov373oUECLTTRZoz0sjaUUacVSctyocagicWanxtgYenmdaiqqjcYZbZWUXeiihiov263qVEBKTTSaq0zskbTTZcWScu0pbZfibUZnyufXenlcZirrkcYabZXVZfigfhnv153rWEAJSTScs1zrkcTRYcWRcv2qaYfibTYo0vfXdmkbZisskcZabZ",
 "smihkjecfidYckjZTXfjeUNRdjls44nXWaVMOWXTSVWXeomeckrsrqnjjlhceoxxkntuldcbVRXeeejojZYegbYagotnWJOYZPKLNNSaglqtqlnqlaXdjkiinv10tponXehedfhimrvvuvy1zsjdZZdgcTSclicgophcYQJRmzujgifXTWcfbTSbliWSagbUmrttrmhglrsngehibRMOQPMLLQbllebfhbWYcbbfidXcnsniikjikljhkpsqlhfhgbPLUegbVTTTTUUQMQZdYUahfbfr27-91uqoigntmZXfjhhlnoqqgUVipljmmbUZTQOQUagkmllkgaXXZYWVbjhTLXs2xpomiiosqqv0ywuqifggcbhnnmmkcVWXSLLRnqsoiijgaadbXbkolijhcckphXYgjcUSVabVPPWaUOQXabfkjfhr371rjdZahpspcXbiiaVZionifimkdYYZZcinqtvtlcXahkhdipnbXk04zwwqijpoaKCCJVdaQPZgplilpkccihWPVfhaUVelkbXbfaRPTVUZhiehv54wrmhhpwuokifbZZXVVagjgcfmmZXhlfaehbWXXQNYnqgahrskfksvssxwohhjgaaeiq13qWORTTYebRMPWbhjecjsaRORWZchmmicZZaWQOOOSclmkjlmkifditvnfiqqns13vppqtxvjagpjRJQXUSYebqqiglhXSUVTXgkmsyvllv0rfadjqrlefnqpquuqmljinvwlYRRSRNKNTVQOTVONmjeegcXcnoaMLPRTYZXZffVNUgllr263yvrolhZValtupieiqrgXZggbXZccbadjWbebfonZQUWPKRZXUalqolkhhlmhdffbWWabaYUSZlrpmkdXZinkffkorpnr4_zeYUMILRZjpmbUWdjjhhowwqkigfhifelsmbanwtligdfihdfjeRQdmiemtncbhfZXxzwoigedjuvjagngTQVURUcfbZYSOTaWQUfjcWWZdmvseUWaZYfosofYXfqy10xw",
 "ghjlnprsuvwxyzzzzzzzyxwvusrpnljhgecaYWUTRQPONMMMMMMMNOPQRTUWYacegorrrtvvvxxxyyyyyyxwwvutsqpnmljhgecaZYWVTSRQPPONNNNNNOOOQQQSUUUXguywvxyxwxyxxxxwvvvuttsqppnmlkihgedbaZYWWVTSSRQQQPOOOONOPONOQPNRgy40xz0yxyywvwvuttsrqqponnlkjjiggfdccbaYYXWVVUTSSRQPQPNNONLMOLHNg061y01yxxxvuuusrsrpppommmljjjiggfdcccaZZZXWWWUTUTRRRQOOONKLNKFLgy40xz0xwxxvuvutsssrqqqoooommmmkgbZZZZXXXXVVVUTTTSRQRQOOPOLMOLHNgw1yvxywvwwvuuuttttsrssrqqqpopqngYVWXWVVVUTTUTSSSSRRRQPPQPNOQNKPgtyvtvwvuuvutuuuttutstttsttsrsuqgVRTUTSSTSSSTSRSSRRRSRQRRQPQSQNSgu0xvwywututttutsstssstsrstsrsuqgVRTUTSTUTSTTTSTTSRSSSRSRPNPQOLRgy52z131vsssrsssqqqpppqpooponoqngYVXYXWXXWVWWWVVVTTTUTTTQKIKMJGNg1951473wrpqqqqqonmmmmnmlllkkllkgbaabbaaaZYZZZZYXVVVVVWUPIEHKGCKg3_73695wpnooooomkjkkkkjihhhhhihgedeeeeedcbbbbcbZXXXXXYWPGCFIEAIgqspnopnkjjiiijihhhhhhhggggggggggfffffffffeeeeeeedcdddccbYWXYWTVgnokjkkjiiihhhhhghhggggggggggggfggffffffffffffeefeeeeedddcbbcbXYgmmjhijihhhhghhggggggggggggggggfggffffffffffffffffeefeeeedcdecZZgllihiihghhgghhggggggggggggfgggfggfffgffffffffffffeeffeefeddedaa",
 "giknpruwxz1234455544321zxwurpnkigdbYWURPOMKJIHHGGGHHIJKMOPRUWYbdgilnqsuxy01344555543210yxvtrpmkigdbZWUSQONLKJIHGGGGHHIKLNORTVYadgilortvxz1234555544320zxwusqomkigdbZXVTRPOMLJIHHGGGGHIJKMOQSUXadgjmpruwy0234555544321zywvtrpnlkigdbaYWUSQPNMKJIHHGGGGHIJLNPRUWZcgjmpsvx01345555543210zxwusrpnljhgecaYWUTRPOMLKJIHGGGGGHIKLOQTWZcgjnqtwz1244555544320zywvtsqomljhgecaZXVTSQPNMLJIHHGGGGHHJKMPSVYcgjnrux02345555543210yxvusrpomkjhgecbZXWUTRQONLKJIHGGGGGHIJLORUYcgkosvy1345666544310zxwvtsqpnmkjhgecbZYWVTSQPOMLKIHHGFFFGHIKNQTXbgkptw0245666654321zyxvusrponlkihgedbaYXWUTRQONMKJIHGFFFFGHJLPSWbglpuy1356666543210zxwutrqpomlkihgedbaZXWVUSRPOMLKJIHGFFFFGIKNRWaglqvz256777654320zywvtsrponmljihgedcaZYXWUTSQPNMLJIHGFEEEFGJMQVaglrw0467877653210yxvutrqponlkjihgedcbaYXWVUSRQONLKJIGFEEDEFHLPUagmsx257888754310zxwvtsrponmlkjihgedcbaZYXWUTSQPOMLKIHGEDDDEGJOTZgmtz36899875320zywvutrqponmlkjihgedcbaZYXWVUSRQPNMLJIGEDCCDFIMSZgnu058--986421zyxwutsrponmlkkjihgedcbbaZYXWUTSRPONMKJHFDCBBDGLRYgov169__-86310yxwvusrqpnmmlkjiihgeddcbaZZYWVUTRQPONLKIFDBAACFKQX",
 "fWUdgZYiojejkcblqeTWefgnpidhidemkUMXkiekqlglpibfjeVTUVesviYdnpmlbTVegaZiolijhbdoqdTWdefmpkgihcenkTKVjkgjokhmqlefidVSTVdptldgnpmiWRWfgaZhooljeZfqqcSWcdekpmjjgcfnkTITjmiimkimqngfhcVRSVcnrnhjopmgSPXghbZhorpjbXgsqbRVcccjppmkfbfnkSHQiokijjimrpjgfbUQRUbkqqmmoqmdPPYhhcagnsrjYXitpaSWcbbhoqokebgnjTIQhplhhijlqqlgebVRRWbhnrqooplaOPaihcbgmtsiXXjtoaTXcbbfnrpkebgmiUKQhqmgfhjlpqmgdbWSTXbelrtpnokZOPbkjdchouukXVkxtfYcgdaemqojcYdkgQHRlunffiijpsohdYSNOTXbjrtolnlaSSdmkfeiostlYWjxwkeikfaeknlicXagdPIVpvmefhghnroidXQLMSVZhpqliklcWVfnmgfjnrslaXjyzpknogadikjgbWXdbOKZswlefhefmrojdXOJLQUXfnojgikeZYgonhgjnqrmcXiy1tpsribdhhgfbVVbZNLcvxkdfhddkqojeWNIKQSWdlmhdgkgbaipoihknoqndYiy3xtwujbcgfeeaUTZXNMexxkcfgccjqokeWMHKPRUbjkfbejicagmlghlopqneZhv0vsvukcdgfefbVTYXONduujehhdemroidUKFIOSWdklgdfjidafkifgnqqqogagtyusvuldefedfdWUYYPOcrrifiiegpsohcTJEHOTYfklhegjidadhgdgosrqoicgqvsrvuleefddgeWUYYQOboohgjifjruogaSIDGOUaglljghjieacfdbgpusqojdfnsqquumfffddgfXUYZRPallghljgluvofZRHBFNVcilmkhijieaadbZgrwtqpkeelppquumhgfcchgYUYZSQZiifimkhnwxneYQGAENWejmmljijj",
 "gz-91qgZXaegijiihhhggggggggggggfggffffffffffffeeeddcdfhlomfVKCBMg4_yfTUclpnjggghhhhhghgggggggggfggfffffffffefeeeeefffcYWajrsgNAHg76hQWnuofdgjkihghhhhhhggggggggfggffffffffeeeeeefedbcfigXRYpveFEg7wVUqyjYgolfgjigiiggihgghhfghgfggfefgeeffedffddfdcfgaXfncNVrqPEgxpagtpcepndemleelkefkiefjhdfjgdgifcgiecghdbghbahhaZhiYWhjWSflWOgookjlliikjhijjhhjighihgghgfghgfggfefgfeffedefdceeccdecbddaacbXXgnolkkljjjjiiiiihiihhhhgghgggggfggfffffeffeeeeddedddddccccabbaXYgnolklljjjjiijiiiiihhhhhghgggggfggfffffefeeeeedddddcddccccaabaXYgnpmkllkjkjjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdccbcbaabZWYgopmkllkjkkjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdcbbcbaabZWXgopmkllkjkkjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdcbbcbaabZWXgopmkllkjkkjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdcbbcbaabZWXgopmkllkjkkjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdcbbcbaabZWXgopmkllkjkkjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdcbbcbaabZWXgopmkllkjkkjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdcbbcbaabZWXgopmkllkjkkjijjiiiihhhhhhhgggggfggfffffeeeeeeeddddccdcbbcbaabZWX",
 "gjnqtwy1356789-----9876531ywtqnjgcZWTQNKIGFDCBBAAABBCDFGIKNQTWZchkosvx023567788888887765320xvsokhdZVSOMJHGEDCCBBBBBCCDEGHJMOSVZdhmquxz134556677777776655431zxuqmhdYUQNKIGFEDDDCCCCCDDDEFGIKNQUYdinswy12344555556665555544321ywsnidXTOLJHGFEEEDDDDDDDEEEFGHJLOTXdjpux0133444445555555444443310xupjdWRNKIHGFFEEEEEEEEEEEFFGHIKNRWdkqvz1233444444444444444443321zvqkcVQMJHGGFFFFFFFFFFFFFFFGGHJMQVclsx012333333333333333333333210xslcUOKIHGGFFFFFFFFFFFFFFFGGHIKOUclty022333333333333333333333220ytlcTNKIHGGGFFFFFFFFFFFFFGGGHIKNTcmuz122333333333333333333333221zumcTMJHGGGGGGGGGGGGGGGGGGGGGHJMTcnvz122333333333333333333333221zvncSLIHGGGGGGGGGGGGGGGGGGGGGHILScnw01222233323333333332333222210wncRKIHGGGGGGGGGGGGGGGGGGGGGHIKRcox02222222222222222222222222220xobQKIHGGGGGGGGGGGGGGGGGGGGGHIKQbox12222222222222222222222222221xobPJHHGGHHGGHGGGHGGGHGGHHGGHHJPbpy12222222222222222222222222221ypbPJHHGGHHGGHHGGHGGHHGGHHGGHHJPbpz12222222222222222222222222221zpbOIHHGGHHGGHHGHHHGHHGGHHGGHHIObqz22222222222222222222222222222zqbOIHHGGHHGHHHGHHHGHHHGHHGGHHIOb",
 "gmsx14678887543210ywtqnkhfdbbbcdgijkkkigebYVSPNLKJIHGEDDDEFHKOTZgnu047899975310zyyxurnjgdaYWWWYbgknpppnlifcYURONNMLKIGECCCDEHLRYgpx379-99852ywuuvwwtqlgcYWTRQRUZgmruvuspnjfaVSPPQRRPNJGDCCBCEIOWgr169-98752xspnosvwtpkdYVSPMLMPWgpwz0zwtqnibWSPQTXYWTOJGEDCBCFKUgu49_-6432xrlgehovxvqjbWUSOJHHKSgt1442xtrpkcVQOQXehfaUOJIHFBACHRgx7--71xzzuldYWZlw0xrkaUUUQJFEGPgw5762vrrrlbUOLPampniaRMMOKEBBEOg1--83upuysgYSOSjz3ztkYSWaVLFDCLg09860qlptnbSMIMctxtnfTNRWRIDBBKg4_74ylfpyrdVQIMh26ytlWPYibOIFBHg4-63xkdnwpaSNFJez3vqiUNWgaNHEAHg7-1zueWl0sbVRGGg67wsmUMbqiSNKBEg7-1ytdVkzrZTPEFf55uqkTLaphRMKBEg-8uusYOj3tZWVGDg96qqnTIdxnTSSDBg-8ttsYOi3sYVVFCf85qpmSIcxnTRRDBg_4lprVIh6tWYbIBg-3knpSFe3qUWaHAg_4lprVIh6tWYbIBf-3knpSFe3qUWaHAg-zelsVGg7sUbiNBg-ydkrTEf5qTahMBg-zelsVGg7sUbiNBf-ydkrTEf5qTahMBg8uYjtWGg6qTdnSDg8tYisVFf5pScnRDg8uYjtWGg6qTdnSDf8tYisVFf5pScnRDg4pVhtYIg3nSeqWHg4pVhtYIf3nSeqWHg4pVhtYIg3nSeqWHf4pVhtYIf3nSeqWHgzlVgsbNgykTfqaMgzlVgsbNfykTfqaMgzlVgsbNgykTfqaMfzlVgsbNfykTfqaMgujWgqdRguiVfpcRgujWgqdRfuiVfpcRgujWgqdRguiVfpcRgujWgqdRfuiVfpcR",
 "giknpsuwyz1234555554321zywuspnkigdbYWTRPNMKJIHGGGGGHIJKMNPRTWYbdgjmpsuwyz012223333322210zywuspmjgcZWTRPNMLKJJJIIIIIJJJKLMNPRTWZcgjnrtwyz00111111111111100zywtrnjgcYUSPNMLLKKKKKKKKKKKKKLLMNPSUYcgkosvxz0000000000000000000zxvsokgbXTQOMLLLLLLLLLLLLLLLLLLLMOQTXbglquxz0000zzz0000000zzz0000zxuqlgaVROMLLLLMMMLLLLLLLMMMLLLLMORVagmrvy000zzyyzz00000zzyyzz000yvrmgZUQNLLLMMNNMMLLLLLMMNNMMLLLNQUZgntx010zyxxxyz00100zyxxxyz010xtngYSOLKLMNOOONMLLKLLMNOOONMLKLOSYgovz110ywvvwxz01210zxwvvwy011zvogXQMKKLNPQQPOMLKJKLMOPQQPNLKKMQXgpx232zwuttuwy13331ywuttuwz232xpgWOJIJMPRSSRPNKIIIKNPRSSRPMJIJOWgr0552ytqppruy24542yurppqty2550rgULGGJNSVWWURNJHGHJNRUWWVSNJGGLUgt3761vpmklnsx26762xsnlkmpv1673tgSIEFKQWZbaYTOJFEFJOTYabZWQKFEISgv6-6zrkgefjpw38-83wpjfegkrz6-6vgQFBFMUbfhgcWPIDBDIPWcghfbUMFBFQgx9_5vleZYZdkt29_92tkdZYZelv5_9xgOCAGQahmnmibSJCACJSbimnmhaQGACOgy9-2qfXTRTYgq08_80qgYTRTXfq2-9ygNCBJVgosusnfVLDADLVfnsusogVJBCNgz98xlZSONOTbmx6-6xmbTONOSZlx89zgMCDOamtxyxskZOFBFOZksxyxtmaODCMgy84tfUOKKLQXiu484uiXQLKKOUft48ygNDHSgrx110vodRHDHRdov011xrgSHDN",
 "g3_4voicXTQTdkllqtogfjigfhijhZOQgvxmecdegfdcgfXSVaabisvsojdXQHAIg59wnmkfaXTUdmnkmqogdjniccjokYPRguwnbXcjjdYcifXVZbYZirsolgbZYPCGg65neimidbXVcnpjhopgbjrlYWjtnYQUgrvnYScpnaUckfWXecWYjqokidZdhYGFg40dVfnlhgcXcorhckofYjvoVRjxqZSXgotmVOcuqXQcngXbjeUXjojfeaYgqiLHg3wXPcnmkkgZdoqfajofXiwpUPiyraUZgmrlUNdwrWPdogXclgVXimfbbZYjwoPIg3ybRZiklmicekjcfpqdVgtpZVgspeWYgnphWTfqmWSfqiVWgjcbhjdZabdmukNIg40eSXehmolfghcZjwsbUdpofafmohXWgpoeXZglgXWirkTPcmjefgaXZehothLHg41hUVZfmrnihdVXo2taSblnkgdgmkZVgqmbZfifbYaktlSJXoqiedYUZgmqreKHg54mYXYcjomjidUXp1tbVcjmmhcemlZUgrmaZhjeZZcjqkSKWoridcZXcjnonZHGg68sfcbadhihifabmvpfcgjkjfbemkYUgrnbZhkgcbcfjgWQZklgdedeilkjgTDFg5-xlhdYXbegihfekomiijjigdaeljYUgrncahlifdccddZXbhgedfhkonieaOBGg5_0qlfWSWbehjjhijklmmigebaeljYUgrncahlkhfdZZabcdeccehkptpgaVLAGg69wnkfXVZcdgkjggjlllljgcbcimhWUgrpeZdjkjfcaaaacffcbfijmqogbYPCFg66pgifZZefdfljdelojhklgaagnneUTgsrhYYfllfabecXahicagighmmgdfWFFg63hZfgbeljceljbcnqidimgYalsocRTgsujXTalngZdidVYjkcahjcahkfgmeIFg5yaTcgdiqmbdliYbpshZgnfWaowpaQTgsvlWPXlpgYfmeTWkndaikZVdifjslNG",
 "gw40usv1552xurpnljhfeeeddeeeefffgggghhhhiihhhgecaYWUROJGGKQTRLHPgz61uty574ysomkhedcbbbccdeefffffgggggghhijjkkkjihebZXTNHEGNSRKFMg181uv276zsmjgebZYYZabdefggggggggfffffffghiklmnnmkhfcZTMFEJQRKDKg391uw582tkgdbYWWXYacefghiiihhgggffeedddefghjlnoppnkifbSJDGPRKCIg4-0ty76xleaYWUUWZbegijjjjihhggggfffeedccccdfhkmprrpnlhaOFENSLBHg6_zt083pdYWUTTVZdgikllkjihgffffgggggfedcbaabdfimqssrpniWIDLSMAFg7_yt27xgXVUSTVaeilmmlkihgfeeeffggghhhgfedbaZZadhlqstrqofOEJSNAEg8-wt34pYSTTSVbgknonlkifeeedefffgggghihhhgdbaYXYbfkqtsstnWHISPBDg89vt30iSQUTUahlnpoligeddeefghgfggfefghhiihfdaXWYaelrsrvtdLISQCDg78ut2vaNQVVXgopppmheddbdfgghihfggedeffgikiiheZWWWXfoqqvylQJSRDEg77uu0qULRXXbmsqnmjdbcdcfiighigfggfdefddgjijkicZYVTZkoou0rVLRREEg66uuxkQKUabhsvokjfZZdffhkifghfeghgefgdbeggimmgcbXQTeklr1vbORRFFg45vttfNLXefmvulffcYagihikieegfdgigfhhdbdedflnjggaRQZgho0ygSSQGHg25wspaMNaikqvrgbcbZdkkhijgdegfdgigfhifcdebbimkjkfUQVbdlyzlWTPGJg15xqkXMQdmostmbYbcdhmlhggedfhgeghfegihffeaZeijknkZSTXZivzobVOGKg04xpfUNThqrspgYXcfhkmjfefeegihfggedfhhghgcZbegjonfWTUVesyrgWOHL",
 "gmqstvxyz0011121110zyywvusqpnljhgecaYWVTRQPNNMLKKKJKKKLLMNOQSTVZgorrswyxxz1101221000zxwvusqpnljhgecaYWVTRQPOMLLLKJJKLKKMOONPTUUXgqsprxzxwz2200231z00zxwvusqonljhgecaYXVTRQPOMLLMKIJLLJJMPOMOUWTVgrsoqx1xvz32zz231zz0zxvvusqonljhgecaYXVTRQQOMLMMKIJMMJIMQOKOVXTUgttnpy2wty43yy241yz0zwvvusqonmjhgecZYXVTRQQPMLMNKHJNNIHNSPJNWYSSgutloz3wsy53xx341xz1zwvvusponmjhgecZYXWTRQQPMKMOKHIOOIGNTPIMXaSRgvuknz4wqy64ww350xy1zwuvusponmjhgecZYXWTRQRPMKNOLGIPPHFNVPHMYbRQgxujl05vpx74ww350wy10vuvusponmjhgecZYXWTRQRQLKNPLGIPPHEOWQGLacROgyuhk16vox74vv360vy10vtuvsponmjhgecZYXWTQRSQLKNQLFIQQHEOXQFKbeRNgzvgj17umw84uu360ux10vtuvsonnmjggfcZYYXTQRSQLKORLFIRRHDPZREKcfQMg0vfi28ulw95tt36zux10usuvsonnmjggfcZYYXTQRTRLKORMFISSGCPaRDJdgQLg2weh28tkv95ss37ztw10usuvronnmjggfcZYYXUQRTRLKPSMEITTGCQbSDJehPJg3wdg29tjv-5rr37zsw1zusuuronnmjggfcZYYXURRTRMKPTMEIUUGBQcSCJfiPIg4wcf3-shu-5rq37ysv1ztruurnnnmiggfdZYYYURRUSMKQTNEIVUGBReTBIgjPHg5wae3-sgu-5qp27yrv1ztrturnmnmiggfdZYZYURSUSMKQUNEJWVGBRfTBIhlPGg5xZd3_sfu_5pp27yqv1zsqturnmnmiggfdZYZYURSVTMKQVNEJWWGARgTAIimOG",
 "gz--3tlgdcaZZbdgijjiihgggggggggggffffffffffeddccdfikmmljifaSIBBMgy--4vnifdbaZacegiiiihhggggggggggfffffffffeeddddfhjlmlkigdYQHBBNgy9-5wplifdbZabdfhhiihhhgggggggfggfffffffeeeddeegiklmkigdaWPGBCNgy9-5yrnkifcaabcefhhhhhhgggggggfggfffffffeeeeeeghjklljgdbYUNGBCNgx8-60tpmkhecbbbdegghhhhhggggggggfffffffeeeeeffhikkkjhebZWSLFBDOgx8-71vrpnkhecbccefgghhhhggggggggfffffffeeeeffghjjkjhebYWUQKEBDOgw7-82xurpnjgedcdeefggghhggggggggfffffffeefffghhijihfcYWUROJDBEPgw7-84zwusqmjgfedeefgggggggggggggffffffffffffghhihgfcZVTRPMHDBEPgx8-73zyxvsokhfedeeffggghhgggggggffffffeefffgghhihgebXTQONMIEBDOgy8841121xqkgeddddefgghhhhgggggggffffffeeeeffghiiiihfbVOKJKKHDDNgz7512661tlhedcccdefgghhhhgggggggffffffeeeeffghijjjiheaSKFFJKGEMgz6316-6wojgdbabcdffghhhhhgggggggffffffeeeeefggijklkifcXPFBFKIFMgz4129-1rmjfaZabcefghhhhhhgggggfggfffffeeeeeefghjklmlgcZUKBCJKHMgy215_8womibYZbacfgghiihghgfgggfggfffgfefeddeffgjlkmnkdZXPDAGKJNgw237-5uolfYWZaacghghjigghgfghgfggfefgfeffdcefefjllmpngaXRGBEIJPgu25882tnicXWZabehihijigghgfgggfggfffgfeffdcdedehklmpojdYSJDDGJR",
 "gnsw033210xtrpmkjjihhhhghhhgghgfggfeffeeefeeeedccbZWUSOLKJIILPTYgrxz4861ywrlihfddefefhhgghhgghgfggfeffeeffeeghghiigedaUPNKFDHMOUgv00595vpnibYabacfgggiigghgfghgfggfefgfeffddfffgjlklnkdYWQGCGLLQg0525-3oedaVUZdegjkiijigghgffggfggffggfeffdcddbcfhimrqlihXIBGJGLg49214yhUTWWYdjklllihhgffggfgggfggfffgffggfeedaaabcinppsreNHKJCHg5-0uuqcRQXcgknnljhgffggghgggggfggfffffefffggfecaYYbfjovujVRRLBGg5-ynkiaSTbjnonkigfefghhhhgggggfggfffffeeeefghgfdbYXYckstldbYNBGg5_yibaZYagnqokgeefghhhhgggggggggffffffffeeeefghhfbXVYflnmlkdNAGg5_yhaaZZbhnqojfeefghihhgggggggggffffffffeedefghhgcXVYekmmlleNAGg5-xlhfZTVemppmigeefghhhhggggggfggffffffeeeefghhfdZWWZhqsmgeaOBGg59yqpkYPSbjmooligfefghghhgggggfggfffffeefefghgfdaXXZcktwnbWVNCGg59zvwoYOSZdglpnkjhfegggghhggggfggffffeeffffhgecbYWafimtxnXPQMCGg48213saRTWWainmlmkhfggffhgfghgfggfefgfeggffgebZaZYdlppsulTIKJDHg17467wgXXWTWeiikmlihihffhgfghgfggfefgfeggededaZbddhpspoofPEFHEKgw3466ymfcYUVadehkkiijhfghgfghgfggfefgfefgecddbbehilqrnjgZNFFHIPgt03661smhcYXZbbehihiiigghgfgggfggfffgfeffdddedehkkmonjeZTKFFILS",
 "suwxxxwwwxwvvwvutuuuuuutsrqpomkhfdaXUROMKIFEEFEEFHJKMPSVXZcfjmopsuwxxxwvwxwuvwvtttuuuvvtrqqponkhfdaXUROMKIFDEFFEFHJKMPSVXZcfjmopsvwxyxvvwxwuvwvtstuuuvvtrqpppnkhfdaXUSOLKIFDEGFEFHJKMPSVXZbejmopsvxyyxvuwxvuvwvtstuuuvvtrppppnkhgebXVSOLKIECEGGEFIKLMPTVXZbejmnpsvxyyxvuwxvtuxwsrtuuuvvtqppppnkhgebXVSOLKIECEGGEFIKLMPTVXYaejmnpsvxyyxuuwxvtuxwsrtuuuwwtqooppnkhgebYVSOLKIECEHGEFILLMQTWXYaeimnorvyyyxutvxvtuxwsrtuuuwwtqooppnkhgebYVSOLKIEBEHHEFJLLMQTWXYadimnorwyyzxutvxvsuxwsqtuuuwwtqooppnjhgfbYVSOLKIEBEIHEFJLLMQUWXYZdimnorwyzzxtsvxvsuxwrqsuuuwwtpnnppnjhgfcYVSOLLIDBEIIFFJMMMQUWXXZdimnorwyzzxtsvxuruxwrpsuuuwxtpnnopnjhgfcYWTOMLIDBEJIFFKMMNQUWXXZcimnorwyzzxtrvxurtxwrpsuuuxxtpnnopnjggfcYWTOMLJDBEJIFFKMMNRUWXXYcimnnrwyzzxsrvxurtywqpsuuuxxtomnopnjggfcYWTPMLJDAFKJFGKNMNRVXXXYcimnnrwzzzxsruxuqtywqosuuuxxtommopnjggfcYWTPMLJDAFKJFGLNMNRVXXXYcimnnrwzzzxsquxuqtywqosuuuxxtolmopnjgggcYWTPMLJDAFLKFGLONNRVXXXXbimmnrwzzzxsquxuqtywqoruuuxxtolmopnjgggcZWTPMMJDAFLKFGLONNRVXXXXbimmnrwzzzxrpuxtqtywpnruuuxxtnlmopnjgggdZWTPMMJDAFLKGGLONNRWXXWXbimmm",
 "g1_950tooqolklljjjjiiiihhhhgghgfggfeffeeeeddddccccaabaXVXXSLGCAKg074352tnnpommljjkkjiiihhihgghgfggfeffedeedddcbbccaZZXWYYSJGIHELgx520241upnmmnnmljjjjjjiihhgghgggffeffeeddccccccaZYYZZYWRKHJLJGOgw31z0100xrmlnnllmljiiihiihhhhgfggfeeeeddedddcaZaaYYaZUOLLKLMKIPgw1zy00yy0ysnllllllkkkjihhhhhhgggffeeeeeedcbbbaaaaaaYTNLNNLLNMKPgu0ywyzyxyzyuplkklkkkkkjjjhggggfggffffecccbbbbbabbaWRNMNONMNPNLRguzxwyyxwxxwxwrljklkjkjiijjihhgfggfeedccddcbcbabcaUPOPOOPONNPOMRgtywvwxwvwxwvwwtnkjjjjjiiiiiiiihgeddddddddcccccbYSPPQPOPQPOPQPNSgtywvwwwvwwvvvvvtplijkjiijihiihfggeddedcddcbcdaWSQQQQQPPQPPPQPNSgtxvuwwvvvvuuvutuurmjijiiiihgggfggfffeddddcdcZURRSRQRRQQQQPPRQOSgsxvuuvvuuvuuuvuttusokiihhgggggggffffffeeddbXTRSSRQRRRQRRQQRRQOTgrvutuvutuuuuuuuuuuutqkgfggffggfggffggffgfbVSRRRRRRRRRRRSRQRSRQUgswvuvvutuuttuutttsrrsqmigghgggggffffeffdZVTUUTSSSRRSSRRSRQQRQPTgrwvtuvuuuuttttsrrrrqrrqokggghgfggfefffbXVUUVUUUUTSSSSRRRRQRSQPUgswutuvuuuuttssrrrrrrrqqrplhgggfggfffeaWUVVUUUUUUUTTSSRRRRQRSRPTgrwutuvutttsrsssrssqqqrqqqqnigfggfgfdYVVVVUVVVTTUTTTUTSSSRQRSRPU",
 "g2_84541zzywusqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVTRPNMMKHGHDAJg2_84541zzzwusqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVTRPMMMKHGHDAJg2_74541z0zwusqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVTRPMLMKHGHEAJg3_74541z00wtsqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVTSPLLMKHGHEAIg3_74541010wtrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUSPLKLKHGHEAIg3_74441010wtrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUSPLKLKHHHEAIg3_73441010wsrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUTPLKLKHHIEAIg3_73441120wsrqononmmnnmmmlkjjiggfdccbaZZZYYZZYXYXVUTPLJKKHHIEAIg3_63442120vsrqononmmnnmmmlkjjiggfdccbaZZZYYZZYXYXVUTQLJKJHHIFAIg3_63442120vsrqononmmnnmmmlkjjiggfdccbaZZZYYZZYXYXVUTQLJKJHHIFAIg3_6344222zvsrqononmmnnmmmlkjjiggfdccbaZZZYYZZYXYXVUTQMJJJHHIFAIg3_6344322zusrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUTRMJJIHHIFAIg3_6344322zusrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUTRMJJIHHIFAIg3_6245322zurrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUURMJJIGHJFAIg3_6235421yusrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUTRNKJHGIJFAIg3_6235421yusrqonnnmmnnmmmlkjjiggfdccbaZZZYYZZYYYXVUTRNKJHGIJFAI",
 "gkpuy1467876531yvtqnljhgfeeeeeffggghhhhhgfecaYVSQNKIGFEDEFHKNRWbglqvz2578876420xvsqnljihgfeeeeffggghhhhgfedcaYVTQOLJHFEDDEGJMQVaglrw0367887531zwuspnlkihgffeeeefgghhhhggfedbaYWTRPMKIGEDDEFILPUagmrx1468886530yvtrpnmkjihgffeeefgghhhggfedcbZYWUSQNLIGFDDDFHKOUZgmsy257887642zxvsrpnmkjihggfeeefgghhhgffedcbZYWUTQOMJHFEDDEGJNTZgntz367887641zwusqonmlkjihgfeeefgghhhgfedcbaZYXVTRPMKHFEDDEFIMSYgnu0468887530yvtrponmlkjiigfeeeeghhhhgfddcbaZYXWUSQNLIGEDDDFHLRYgov1578987530xusqponmlkkjihgeddeghiihfedcbbaZYXWVTROLIGEDCDEGKQXgow268998752zwtrqonmmllkkjigeddeghiihfdcbbaaZZYXVUSPMJGEDCCDFJPXgpx368998641yvsqponmmlllkkigeddeghiihfdbbaaaZZYXWVTQNKHFDCCDFIOWgpy479987641yusponnmlllllkjgeccdgijjhfcbaaaaaZYYXWTRNKHFEDCCEHNWgqy589987530xurpnnmmlllmmljheccdgijjhecaZZaaaZZYYWUROLIGEDCCDGNVgqz69-987530wtqonmmlllmmnmkhebbdgikkhebZYZZaaaZZYXVSPLIGEDCBCFMVgr07--98642zwspnmmllllmnnnkhebbcgjkkhebYYYZaaaaZZYWTPMJHFDCBBELUgr18--97642zvromllllllmnonlhdaacgjllieaYXYZaaaaaaZXUQMJHFECBBDKUgs29__97531yvromlkkkklmopomidaZcgjmlidZXWXZabbbbaZXUQNKIGECAACJT",
 "gjmpsvxz001100zxwvtsrponmlkjihhggfeedcbaZYXWUTSQPOMLLKKLLMOQTWZcgr07__84ysnkihijlmoooonmlkjihhgggffeedcbaZYXXXXZacdedbYTNHDAAELUgw7_81tnmoswzzwtqnmmmnnnmlkjihhggfeedcbaZYYYZZZYVSPMMPTXZYSKDAEPgz97zsquz31wroprttronmmmmlkjihhggfeedcbaZZZZYXUSSUWXUPKIMRVTMECMg182ttz42vrrvxvrppqqpnmlllkjiihggfeddcbaaaZYWVVWWUQOQUUQJHMSSJDKg27yu050tsxzvrrttrooponlllkjiihggfeddcbaaaYXWXXUSSUUQMOTSLGLRNEJg25xy41uu0zsrvvqpssonoolklliiihfggedddaabaXXYXTTWVQQUTMLRRKHNOGJgy51z0zxwxwuuutrrrqooonlllkiiihggfedddbaaaYXXXVUUUSRRRPOPOMLMKGNgy52yz0ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLMNJGNgz51yz0ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLMNKGMgz51yz0ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLMNKGMgz61yz0ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLMNKFMgz61yz0ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLMNKFMgz61y00ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLLNKFMg061y00ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLLNKFLg061y00ywxwvuutsrrqpoonmllkjiihggfeddcbaaZYXXWVUUTSRRQPOPNLLNKFL",
 "jloqqw5_6wrqoljjhgedZWXacbbccbbccbaaaabcbaaaabccbbccbbcaXWZdefhjkmpprz8-2tppnkjihecZXYaccbcccbbbaabbbbccbbbbaabbbbccbbcbYXYbegiikoppu3-7yrpomjihfbYXZbcccccccbbaabbcbcccbccbaabbccccccccaYXaehiilopqx7-3uppnjiigbYYaccccccccbbbccccbccccbbcccbbbbcccccccbZXZdhiimops198zrpolihgbXYbdccddccbbbcccccccbbbbcccccccbbcccddccdbYYcgiimopu5-5vpomjhfcYZcdccddcbccccdcccdcbcccbcdcccdccccbcddccdcZYcfhjnnqy791sonliebZZcedcddcbcddcddccccccddccccccddccdcbbddcdedaZaehkmnt296wpmmjeaabdeddddccddddddccdddccddcdddccddcdddcccdddedcaachlmov692rnmkeaacdeeddccdddddddddddddddddddddddddddddddccddeedcabglmpz87womkfabeeddddcdeddddddddddddddddddddddeddddddeedcdddeedaaglms383smkfbbefdcdeddeeddeeddedddedddedddeddeeddeeddeeddedcegeabfknw56yoifccefecdfeddeedeeddeeddeeddeeddeeddeeddeedeeddefdcdfecceho063siddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeddgq37xkddfeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeefedfs53oddgfdeffeefeeefeeffeeffeeffeeffeeffeefeeefeeffeeffeeffeegfcfv3ugbfhedfgeeffeeffeeffeeffefffefffeffeeffeeffeeffeeffeegfdehfbg",
 "gouwz246678765420zywutsrqppnmmmkgbZZZYWWVUTSRPNMLJHGFEDEFFHJMPRXgpvy14677765310yxwvvuuuuuutsqqplgaWVVTSRRRRRRQQPONLKIGFEEEFHKNQWgry135530xvtssuvy1355542zwuqonmkgbZYXVRPMJHGGGIKNQRTTSQOLIGGIKNUgt131zuqnorw27--841xvvvwxyxvsqplgaWVTQONOPQQQOKHDBBEJPUXYVRMKIKSgv20unkmt29-60vux27851xutuwvsqolgaXVTQPRSROKGDEJORQLFBCJSZbYRLJQgw2vlioz781try6-81wvz440vsstsrplgaWUTSTTQLHHMQPKDBFNUSKDEMXdaQJPgx0pgky75vpu5_7xtz793vtw11vomptqgVSWZXQKKPSQICEMSOEAGRWQGENbfWLOgyzmfo37yps3_6xt1980tw34xrquwslhgeaTPRVUOHIPSLDCKSOFAITWNEIXgZMNgyzmfo37yps3_6xt1980tw34xrquwslhgeaTPRVUOHIPSLDCKSOFAITWNEIXgZMNgx0pgky75vpu5_7xtz793vtw11vomptqgVSWZXQKKPSQICEMSOEAGRWQGENbfWLOgw2vlioz781try6-81wvz440vsstsrplgaWUTSTTQLHHMQPKDBFNUSKDEMXdaQJPgv20unkmt29-60vux27851xutuwvsqolgaXVTQPRSROKGDEJORQLFBCJSZbYRLJQgt131zuqnorw27--841xvvvwxyxvsqplgaWVTQONOPQQQOKHDBBEJPUXYVRMKIKSgry135530xvtssuvy1355542zwuqonmkgbZYXVRPMJHGGGIKNQRTTSQOLIGGIKNUgpvy14677765310yxwvvuuuuuutsqqplgaWVVTSRRRRRRQQPONLKIGFEEEFHKNQWgouwz246678765420zywutsrqppnmmmkgbZZZYWWVUTSRPNMLJHGFEDEFFHJMPRX",
 "JWmvxsgPEJdw0oYUdqtmdacefimmeTQex5tZOViohZYeklkmookeVJEPn57xlbPGJVkuytgPFJbtzpbXfqsmeacdfhlkdTSfx4taQVglgYXelonopnjcSHEQo690nbOHJUitxsgPFKarxpdZhqtmebbcehjicUVhx3tbRVeieXXemqqqpnhZPFERo6-2obPHKTgrvrfPGKapvpfcjrtnfbabdgihbVXjy3tcSUcgcXYfottspmfWMEFSo6_3qdQJKTeospdPHLZoupifltuphbZZbehfaWZky2tdUUadbXZgpuvtqldUKDFTo6_5seSKLSclplaNHLZntqkjouwqibYYadfeaXbmx1seVUYbaYahqwwuqkcSJDGUo5_5ugUMMSailhXMHMYlsrnmqwxskcYXZcecZYcmxzsfWUXaaZcjrwxupjaRJEHUo4-6viWNNRYegdUKHMYkrspptyzuleZXZbcbZZdnwyrgXVXZaadkrwxupiaRJFJVn296wkXPNRYegdUKHMYkrspptyzuleZXZbcbZZdnwyrgXVXZaadkrwxupiaRJFJVn296wkXPMSailhXMHMYlsrnmqwxskcYXZcecZYcmxzsfWUXaaZcjrwxupjaRJEHUo4-6viWNLSclplaNHLZntqkjouwqibYYadfeaXbmx1seVUYbaYahqwwuqkcSJDGUo5_5ugUMKTeospdPHLZoupifltuphbZZbehfaWZky2tdUUadbXZgpuvtqldUKDFTo6_5seSKKTgrvrfPGKapvpfcjrtnfbabdgihbVXjy3tcSUcgcXYfottspmfWMEFSo6_3qdQJJUitxsgPFKarxpdZhqtmebbcehjicUVhx3tbRVeieXXemqqqpnhZPFERo6-2obPHJVkuytgPFJbtzpbXfqsmeacdfhlkdTSfx4taQVglgYXelonopnjcSHEQo690nbOHJWmvxsgPEJdw0oYUdqtmdacefimmeTQex5tZOViohZYeklkmookeVJEPn57xlbPG",
 "gmqrsuwwxyyyyyyxwvusrqponmljjihggfedccaZYXWVUTRQPONNNNNNOPPRTUVZgu3775zrhaURRUaflqtutqnjfcaZabceghjklmljgcYVSRSVaglruurleUMGEEIRg1_6rbQOYnz3ymaTUcmstpicZadhklkigdbabeilmjdWSTZjrslZNIMYnxvkUFAKg79nQOh25pVQdv0paUcotoeZcjmkgedeghihfbZcjmhXSXjrlWLQivqWGJexvYCEg-zSQu9nPYy2fRfxtaWjtlablngcfjhfggecgjfYaklaScplSOgugJNnwYCRvtMBgvnbkvlbkulajtkZisjZhriYhqhXgpgXgofWfoeVendUemcTdmbSclaRbkaQbkYQglnlkllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaabaYaglmlkllkkkkjjjjjjjiiiiihhhhggggggfffffeeeedddddcccccccbbbbaabaZaglmlkllkkkkjjjjjjjiiiiihhhhggggggfffffeeeedddddcccccccbbbbaabaZaglnlkllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaabaYaglnllllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaaaaYaglnllllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaaaaYaglnllllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaaaaYaglnlkllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaabaYaglnlkllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaabaYaglnlkllkkkkkjjjjjjiiiiihhhhggggggfffffeeeedddddccccccbbbbbaabaYa",
 "TNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRMTNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRMTNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRMTNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRMTNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRMTNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRMTNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRMTNMUfmideovqeWXZXTXipnijrvpfadhjiiidXWdospklrsjVMQahhfhmnjffhifaICBHRWWYcbVRSVXZcgimpsuwxwrmlpz7__82rgejpty1yqkgaVXehaUSSNLQWWRM",
 "gnswy1356899-______-99865420xvrmgZUQOLJHGFDCCBAAAAAABCCDFGIKNPTYgntwz1457899--__----98875420xvsmgZTQOLJHGEDDCBBBBAABBCCDEGHKMPSYgntwz2467899-------998875430yvsngYTQNLIHGEDDCCBBBBBBBCCDEFHJMPSYgntx024678999---999998876531yvsngYTQNKIGFEDDCCCCCBBBCCCDEFHJLOSYgntx035678999999999988876531ywsngYTPNKIGFEDDDCCCCCCCCCCDEFGILOSYgoux035788999999889888876541zwsngYTPMKHGFEDDDDCDDCCCCCCDDEGILORXgouy136789999988888888876542zwtngYSPMJHGFEDDDDDDDDDCCCCCDEFIKNRXgouy146789998888788888877642zxtngYSOMJHFEEDDDDDDEDDDDCCCDEFHKNRXgouy1468899988877777788776530xtngYSOLIGFEEDDEEEEEEDDDCCCDDFHKNRXgouy2578999988777777788876530xtngYSOLIGFEDDDEEEEEEEDDCCCCDEGJNRXgovz2578999887766667778877530xtngYSOLIGEEDDEEEFFFFEEDDCCCDEGJMQXgovz2579999887666666778877641ytngYSNKHFEEDDEEFFFFFFEDDCCCCEGJMQXgovz3689999877655566678887641yuogXRNKHFEDDDEFFFGGGFEEDCCCCDFIMQXgov03689999876655556678887641yuogXRNKHFEDDDEFFGGGGFFEDCCCCDFILQXgov03689--9876544455678888752yuogXRNJGEDDDDEFGGHHHGFEDCBBCDFILQXgpv0479---9876544445678888752zuogXRMJGEDDDDEFGHHHHGFEDCBBBCEHLQW",
 "gjmpsuxz24679--___--97642zxuspmjgcZWTROMJHFECBBAAABBCEFHJMORTWZcgjnpsvx0246789-___-9876420xvspnjgcYWTQOLJHFEDCBAAABCDEFHJLOQTWYcgknqtvy0246789-----9876420yvtqnkgbYVSQNLJHFEDCBBBBBCDEFHJLNQSVYbglortwy02467899---99876420ywtrolgaXUSPNLJHFEDCCBBBCCDEFHJLNPSUXaglpsuwz0246788999998876420zwusplgaWTRPMLJHFEDDCCCCCDDEFHJLMPRTWagmqsuxz1245678999998765421zxusqmgZVTROMKJHGFEDCCCCCDEFGHJKMORTVZgnrtvxz1245678999998765421zxvtrngYUSQOMKJHGFEDCCCCCDEFGHJKMOQSUYgnsuvy012456778888877654210yvusngYTRQNLKJHGFEEDDDDDEEFGHJKLNQRTYgotuwy012456678888876654210ywutogXSRPNLKJHGFFEDDDDDEFFGHJKLNPRSXgpuvwy122456677777776654221ywvupgWRQPNKJJHGFFEEEEEEEFFGHJJKNPQRWgpuwxz122455667777766554221zxwupgWRPOMKJJHGGFFEEEEEFFGGHJJKMOPRWgqvwxz122455567767765554221zxwvqgVQPOMKJJHGGGFEEFEEFGGGHJJKMOPQVgqwxy02224555666666655542220yxwqgVPONLJJJHGGGFFFFFFFGGGHJJJLNOPVgrxyy02224555566566555542220yyxrgUONNLJJJHGGGGFFGFFGGGGHJJJLNNOUgsyyy02223444555555544432220yyysgTNNNLJJJIHHHGGGGGGGHHHIJJJLNNNTgsyzz12223444555455544432221zzysgTNMMKJJJIHHHGGGHGGGHHHIJJJKMMNT",
 "gqx26-_-851wrnifcbaZZabcdeffgggfggfffgghijklmmlkjgdYUPKGDBABFJOVgqx26-_-851wrnifcbaZaabcdeffgggfggfffgghijkllmlkjgdYUPKGDBABFJOVgqx26-_-851wrmifcbaZaabcdeffgggfggfffgghijkllmlkjgdZUPKGDBABFJOVgqx26-_-851vrmifcbaZaabcdeffgggfggfffgghijkllmlkjgdZUQKGDBABFJOVgqx26-_-851vrmifcbaZaabcdeffgggfggfffgghijkllmlkjgdZUQKGDBABFJOVgqx26-_-850vrmifcbaZaabcdeffgggfggfffgghijkllmlkjgdZUQLGDBABFJOVgqx269_-750vrmifcbaZaabcdeffgggfggfffgghijkllmlkjgdZUQLGEBACFJOVgqx269-9750vrmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZUQLGECBCFJOVgqx269-9740vrmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZUQLHECBCFJOVgpx169-9740vrmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZUQLHECBCFKOWgpx169-9740vqmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZVQLHECBCFKOWgpx159-9740vqmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZVQLHECBCGKOWgpw159-9740vqmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZVQLHECBCGKPWgpw159-9740vqmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZVQLHECBCGKPWgpw159-9740vqmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZVQLHECBCGKPWgpw15898640vqmifcbaZabbcdeffgggfggfffgghijkklmlkjgdZVQLHFDCDGKPW",
 "VYaZZabbZXVTQNMLLORVYZZbfkosx2786421zwtqonmllllkjhebabdfecbaYVTTVZaaaabbaYVTQNLLLNRVYZZaejosx2797311zwtpommllllkjhebZbdfecbaYVSSVZaaabccaYWTQNLKLNRVYZYaejosx3897310zwspnmlllllkjhdaZbeffdbaYVSSVZbaabccbZWTQNLKLNRVZZYZdjosx38-7310zwsonmlkkllljhdaYaegfdbbZVSSVabbabddcZXUQNLKKNRWZZYZdjosx39-7310zwromlkkkllljhdZYaegfdbbZVRRVacbacdecaXURNLKKMRWZZYYdjorw39_7200zvrnmlkjklllkhdZXaehgdcbZVRRVbdbbceedaYVRNLKKMRWaZXYcjnrw3-_72zzzvqmlkjjklllkhdZXafhgdcbZVQRWbdcbcffdbYVROLKKNRXaaXXcinqv3-_61yzyupmkjjijlllkhdYXafiheccaVQQWcecbdfgebZWSOLKKNSYbaXXbinqv29_60xyxuolkjiijkllkhdYWafjheccaVQQWdfdbdghfcZXTPMLLNSYcbXWbinpu29-5zwxxtokjiihjkllkhdYWZgjiecdbVQQWdfdbdhhfcaXTPMLLNSZdbXWbimpt19-4yvxwsnjiihhikllkidXVZgkieddbVQQXegdcehigdbYUPNLLOTaebXVaimos19-4wuwwsmiihhgikllkidXVZgkiedecWPQXfheceiigdbZUQNMMOTaecWVahmnr09-3vtvwrlihhggikllkidXUZhljededWPPXgheceijhecZVQNMMOUbfcWUahmnq09-2usuvrkhhhgfhkllkidXUZhmjedfdWPPYhiecejkhecaWRONNPUcgdWUZhlmpz891sruvqkgggffhkllkidWTYinkedfeWPPYhjecfjkhedbWRONNPVdheWTZhlloy890rptuqjfggfehkllkjdWTYinkedffXOP",
 "PTWXYYYWVVXXVTVaddeghhhjkkmqux049-84zusttsrqokgecaZaaZXVTQOPSSPNUaddcccaZbedYUVYaYYacccdegjpuwz38_-71uqqqpnmkgbaaaaabaXVSQORUVSQORVXYYXVVXZZXUWadccdefghjmptvx048-850wutsqnmmjgdddddbZXVSPOPRRPNagmoonlgccebVRVbebaabaYYXYcinqu18_93wpmmmljjifbYYYYaaaYXVSRUZbZXUbfffffdcfiicWWbcaYZbaaabcglqtx38984wnijlkiiheaZacefhgebWRQTXWSQVbfffghebdjjbUWcdZWYaabcdcfmqru29-71tmkmolijkgaYZbbdffdaWROSZaVSWbfgfebYWZefYSUbeccegeddefimopt29962woloqmjkmjcZZbdffdZXUQORWYVTQXaaadebXYdfZTWdgdcefdcefgjpttv17962wolmnkjllhcbefefgebZWSPSWVPLZfknmkhecdggbVUadcbbaYYabbejmmpx6961tmjkmkijjeYXZabdgebXTQRXddYWXdijigdaYbggZTYhlgcehhgebYbiljlu363xoebfjhgjlhaYcfikljfcYSPUbdYUTZdeddcZYbggaUVcgfdeghgfedgmpopv473wnhhjlllppjbZaceghgecYTRVaZURRZdccffbWWcdXRVfjgfhigeffegmqpqw352xqkilnmlopkdbcdcdedbaYUSVaZSOSagihigcYaffXQVeiecfgcbegeflonow340wpiglpnlnoicbbZXafebZZVTXeeXQafijiihebbfgbVXehebbcccdcadknmmu130vqljmlhehjfaadecdfecbYTSWcdZWYeijiigcZbghbWYfjhghgeceeddhihipwzwrkfdhihgjkgcbdeehjifcZWVZffaWahjihhgdYagjcUWfjecgjeacfeeilkkpwzxuohfijhhklfabddeijeabbWTYffYV",
 "gtyxwxzyxyzyyyzyyyzyyyzyxyzxwxytgSNOPOMNONMNNNMNNNMNNNMNONMOPONSgu0ywyzyyyzzyzzyyyzyxyyxxxywvwxsgTOPQPNOOONNONMNNNMMNMMNNNMNPNLRgv1zxz0zyz0zyzzyyyzyxxyxwwxvuvwrgUPQRQOPPONOONMNNNMMNMLMNMLMOMKQgw2zyz10zz0zyzzyyyyxxxxwvwwvtuvqgVQRSQPPQPOOOONNNNMMNMLMMLKMNMJPgw30y010z00zzzzyyyyxwxxwvvvustuqgVRSTRQQQPOOPONNNNMMMMLLMLKLNLIPgx41z121z010zzzyxyyxwwwvuuutsstpgWSTTSRRRQPPPONNONMMMLKLMKJKMKHOgy5202310110zzzyxyywwwwutuusrrsogXTUUTRRSRPPPPNNONMMMLKKLKIJLJGNgz5202310110zzzyxyxwvvvutttrqqqngYVVVUSSSRQQQPONONMMMLKKLKIJLJGMg06313420120z0zyxxxwvvutsssqpppmgZWWWVTTTSRQQPOOONMLMLJKLJHIKIFLg07313421220z0zyxxxvuuusrsrpooolgaXXXWUTUTRRRQOOONMLMLJJKJHIKIELg18424521220z0zyxxwvuutsrrqononkgbYXYXVUUTSRRQPOONMLMLJJKJGHJHDKg19424531220z0zxwxwutttrqqponnmjgcZYYXWVVUSSSRPOPOMLMLJJKIGHJHCKg29525631320z0zxwwwuttsqqponmmligdaZZYXWVVTSSRPPPOMLMLJIKIFGJGCJg3-535632330z0zxwwvtttrqppomllkigdbaaZXWWVUSSSQPPOMLMLIIJIFGIGBIg3-636632330z0zxwwvtssrpoonlkkjhgecbbaYXXWUTTSQPPOMLMLIIJIFFIFBIg4_636742330z0zwvwvsssqoonmkkjiggfdcbbZYXXVTTTQPQPMLMLIIJHEFIFAH",
 "g_8qq45sqyzrqvvposrmmpojknkhikheghebdebYbcXWZZUTXWQQVUMNVTGHVVDAg56vu32utyysrvuppsrnnpnkkmkhijheghecdebZbbYWYYUTWWRQUTNNSRJIRQFGg15yw10vuxxtsutqqrqononllmkiijhfggecddbZaaYXYXVUVVSRTSOORQLKPNGKg050xz0wvxwututrqrqooonlllkiiihggfedddbaaaYXXXVUVUSRSRPOQPLMOLGLgz50xz0xwwwututrqrqooonlllkjiihggfeddcbaaaYXXXVUVUSRSRPPPOLMOLGMg061yz0xwxwututrrrqpoonmllkjiihggfeddcbaaZYXXWVUUUSRSRPOPOLMNKFLg061y00ywxxvuuusrrqpoonmllkjiihggfeddcbaaZYXXWVUUTRRRQOOPNLLNKFLg061y01ywxxvuuusrrqpoonmllkjiihggfeddcbaaZYXXWVUUTRRRQOOPNKLNKFLg072y01yxxxvuuusrrqpoonmllkjiihggfeddcbaaZYXXWVUUTRRRQOOONKLNJELg061y01ywxxvuuusrrqpoonmllkjiihggfeddcbaaZYXXWVUUTRRRQOOPNKLNKFLg061y01ywxxvuuusrrqpoonmllkjiihggfeddcbaaZYXXWVUUTRRRQOOPNKLNKFLg072y01yxxxvuuusrrqpoonmllkjiihggfeddcbaaZYXXWVUUTRRRQOOONKLNJELg072y01yxxxvuuusrrrpoonmllkjiihggfeddcbaaZYXXWUUUTRRRQOOONKLNJELg172z01yxyxvuvusrrrpoonmllkjiihggfeddcbaaZYXXWUUUTRQRQONONKLMJEKg172z11zxyxvuvusrsrpopomllkjjihggfedccbaaZXWXWUTUTRQRQONOMKKMJEKg182z12zxyywuvusssrpppommlkjjihggfedccbaZZXWWWUTTTRQRPNNOMJKMJDK",
 "gs3872vnihjou0589740wspopqtvwvsmgZTQPQSVWXWTPLHECDGLRXcedYQJEDITgu485ypifhmu05786420xvspoprtvvsngYTQQSUWXWTQOLJHFDEGLRZegdWNGDHRgv583tjeekt278630z0110wsonoruvtngYSQRUXYXTPLKKLMLIFDEJSbhhcSIDGQgw66znebgq08-72wuvy2540uollosvtogXSQTXaaXRLHGJNQRPJEBDLVfkhYMFFPgw65viabjw6_93xtsvz3551vpkkmrutogXSRUZbbWQKGGIMQTSOICAFPckldQGFPgy73reYeq3-94yuuwz12331ysmjlpttogXSSWacZTNKIIJKMPRRNHCBIVhnhUIENgz71maYix8-4wsuz341yxz11wpkjnstpgWSTYcbWPKKMONKHIMRTPHBDOdnlZKEMgz6yhXao4_7xqpw486zutw13zrjhlrtpgWSUaecUMIKPSRMFDHPWVOEAHXloeNFMg06vdVdu8-2sns0784yutw030tkgjqtpgWSVcfbSLILPSRNHDELTYTJBDRiqiQFLg15raVi1_7voqz5631zywwx01wnhiotqgVSXdeYPKLOPPNMKIFGMVXQEAKdqlUGKg24oWWo6-0onw682wx240utw1zqigmsqgVTZfdVMKPSRLHJOPJDFPYXLBFXppXHJg23kUZt-7tjp2-6xsw471tqu01siflsqgVTagdTKLRVSKEHPTOFBJWcSEBSmrbIJg32hTcz_2nju792vuz451vqtz1ujfkrrgUUbgcRKMSVQKGHMRQJCERcYJAMjseJIg30dSh4-wjn294xw02111zurv0xmfirrgUUdgZOLQURMKKKJLPOHCJYcPBHetiLIg4yaSm86oht88wsz64xw13xpryzofhqrgUVegXMNUWOIKPOHFMTPDDSeXFDZtlNHg4wXUr-1ii0_3rs392uu15yppx0qffprgUWggVLOWWNGKRRJCITUIALddKBUroPH",
 "jlpsmcZfjfekqpr2_4lbeklllgYTVYYWURLIJJHHLPPLKPXcelw32wspkioy0tljjpsmZSTWWailhbcfhffeZQIFJTejhfffedbXUVafknolkr371tnjedkqpjhhhhggNOeurbWdgbbijZRTYafpuoeZZbfmrtsncUXgiddjmkkorpjebbeeaairtqolcUTSWUTWbdhs3zmcaXWfrriddYSYjeMIXjeXagfhppcVfrlYbpvneccdir14yoeaaaXXdbq42toollsshUTWSKKNOQYffcityqfaehgbadghnwvePVmundWMFOfnigmmghpoWVYVTesukcelsvmUMXkiYZgbMHUdYOQWVNNZklefr32skhhjs00ustlbgwzhSWgfeiprjdkz3ukheaahljjmjXVn78tjkpqpnifijdVUWRLQZZRQYcWVemhVRYdbWXcemwsijmhXVbfecdiprmhggeiz-vVPdonlpofchlkpwrdWcdTJIIJSaRBEZnkiswldrx2zvutrmiecegcQGBELTRHDMacTQYffgmsqibbjuzsifecbiqneadggkonhiqvsbSNLMOTcjhXRXkstsuxwuw375yrlhfhlomhfggaWZggXQTaZUVflgWTaiicXYejificTPQSTVZddegfYPNXlttrrrqppngbelldWailmt1yhVcswngkkZLLamolljcVYpcXfnkgkmdUZnoaRYihdholbZfeUOWlv02ymZXdfYQQYjomgekqpiaUONXnskcisutheqwmYVZZaiogSQeojbciiglvvmgjkbQOUahorjcejeTRenlfgkmnpoidbVMNdVouldhmmmt1tZLNVYVVZcippbMPhsnffjfYYhnnjhhlrsnjoskWNQZgnoiacjgTKUVYZadhijlnlgfinu21siebVSUTJBIYifbbccekrstw01wqkhcYZejhfinkZTVZYmicaejjecefaTNIDBGOSUYbaZfrxtoorsuxshZZbXQPUagmqpmoqmgdfhkqy30tp",
 "fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLNPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwy00z14415_4fHAGKHHKMLLOPOPRSSTVVVWYZZacccefgghjjjlmmnpqqqsttuwxwx00z14415_4fHBGJHHLMKLPPNOSTRSVXVVYaZZbdddeghiiikmmlnqqoqtustxyww01z04425-3fKDIKHGIIHJOSSQRSRRRRUYccaacbaacgjllkjlljjnruuuutuvttx2433541381",
 "glqtuvwwxyz00zyxwusrponmlkjihhgggffeedcbaZYXWUTRPONMLLMNOPPQRSVagmruwxyyz0110zywtsqomlkiihggggffgggffffeddbaZXVTSPNMLKKLMNNOPRUZgntwyzz001210ywtqomkihgfeeeeeeffggghhhhhhgfedbZXVSPNLKJKLLMMNPSYgovy01111221yvspmjhfedcccccddeefgghhiijjjjjihgecZWTQNKJJKKKKLNQXgpw02222221zwsokhfdbbaaabbcddeefgghhiijkklllkkigebXTPMKJJJJJJLPWgqy23322220wsnjfcaZYYZZabcdeffffggggghijklmmnnmljgcYTPLJJJJIIJNVgs04443220xtnieaYXXXYZbcefghhhhggfeeeefghjkmnooonlhdYSOLJJIHHHLTgt2554321yupidZWVVWXZbdfhijjjjihgedccccdegikmopqqpmidWRNKJIHGGJSgu366421zwrkdYVTUVXZbegiklllkjihgedcbaaabdfhkmoqrsqnibUPMKJHFFIRgv476410xtnfZUSSUWZcfiklmmllkjiggfdcbaaZZabdgjmprttrmgYSOLKHFEHQgw68631yvqjbVRRTWZdgjlnnnmkjihgggffedcbZYYYacfimpsuuqkcVQNKIFDFPgx79630xtmeWRQRVZdhknoonmkigffffgggggfdbZYXXYbeimquvuphZSOLIFCEOgx8-62yvqjaTPQTYdiloqqpmkhfddddeghiiiigebZWVVXadinsvwslcVQNJFBDOgy9-51xtnfWQORWchmprrqokhfdcbcdeghijkjigebXVUUWZejpuxvpgYSOKGBCNgz--5zvrkbTOPUahmqssrolifdcccdeeghhijjjigdaXUTTVZelrwxskbUQMGBBMg0_-4yuphYQNQXflqttsplifdccdefffgggghijjigdaWTSSVagovyvneWRNHBAL",
 "gz7669_-887521zwvusqppomllkjiihggfeddcbaaZXWWVTRQPMKJGEDDBACFFEMgz7669_9887521zxvusqpponmmljjjiggfdcccaZZYXWWVTRQOMKJGEDDCACFFEMgz7669_9887421zxvutrqponmmlkjjihgedccbaZZYXWVUSRQOMKJHEDDCACFFEMgz6669-9887421zxvutrqqpnnnmkkkihgedbbbZYYYWVVUSRQOMKJHEDDCBCFFFMgy6559-9887421zxvutrqqponnmlkkjhgecbbaZYYXWVVUSRQOMKJHEDDCBCGGFNgy6558-98874210xvvtsrqqoonnllkjhgecbaaYYXXVVUTSQQOLKJHEDDCBDGGFNgy6558-98874210xvvtsrrqpoonmllkigdbaaZYXXWVUUTSQQOLKJHEDDCBDGGFNgy6558-98874210xvvusrrqpoonmllkigdbaaZYXXWVUUTRQQOLKJHEDDCBDGGFNgy6558-87874210xwvusrrqppoomllkigdbaaZXXWWVUUTRQPOLKJHEDEDBDGGFNgy5558-87774210xwvusrrrppponmlligdaaZYXWWWUUUTRQPOLKJHEEEDBDGGGNgy5558987774210xwvusssrqpponmmljgcaZZYXWWVUTTTRQPOLKJHEEEDCDGGGNgy5558987764210xwvutssrqpppnmmljgcaZZYWWWVUTTSRQPOLKJHFEEDCDGGGNgy5448987764210xwvutssrqqppnmmljgcaZZYWWVVUTTSRQPOLKJHFEEDCDHHGNgx5447987764210xwvutssrqqqponmmjgcZZYXWVVVUTTSRQPOLKJHFEEDCEHHGOgx5447987764210xwvutsssrqqponnmjgcZYYXWVVUTTTSRQPOLKJHFEEDCEHHGOgx5447987764210xwvvtsssrqqponnmjgcZYYXWVVUTTTSQQPOLKJHFEEDCEHHGO",
 "pvwuuwvtwzoTEEIHEHIFEQgnljlmkkmlhffgffffffghhhihhhihhiiiijiijjijnx0wv0yjSMRSNPamqpoppnlkklkkkmmmmmmmnonmoqiSGGJIFJUabaaabcffffegnu01tePJKRcmrpmlkiiklkklmkloodNCADJSZZXYcfdcdecadkrwxuqnmlljfccho05wcMKVktsommmmnonnqriPABMXaacfgffedhrz0uppolhggdaaZWTSUVTUYdefj56kONdsvrnnpqoptseKCLZecejjeemw1ytqomjgedbXVVWVXcifVMPajjedeYOQ14waNauwnlrqnrvhLFTeefjiejw2wrpnifgcXWYWWdjdSPYhjhdZUQNKPafYVesy52lUWlurllqtpcOKUgjfejqvxtmiigbYYWVaheTQbkibZWOJQabWZlttkXNQfsx0wyhXfsuomsukUNVilggpxxtplhfdZWZggYVbijfZSORZcaeqxpZQUjz2mTQZaNHZfrmbguvmnvpVNamjflvxtpmhfdZYdidWZjmeWTTVbegmvsZNax2obXWUVUQRdkdW0tccqtnoumTPclhhrzumkjdXZdebYbhjcRPXcafsvePXs0oZUVVTPRbjdSZtxfUjsmijmqttkXUbikmtxskgeaYdfaYglcQRZbcmvlSUr2nUTZUMSegYXirogbaYWbmuzshemvtiZXZdkrsrpkbXbeaXcieVSUWcosfTbuudSUUPRbeZZkrkaXYYbkroihoximkjousfVXglotvpeaccaaegdZURXlsjXbqthURSTWbcbgooeVWbgmqojltthURZkjikqtlZVbjossnfZacbadfbSQZmofZgqoaPPUXYaeiljbUVfnnkkoqnfUOWnyvojijnsrhXXgpssogZZccbefXPWlpfZhrlXPRWYadimkbUXhonkmqpiXPVn1xgUXfjdjlorodWblttohbabbdfcTSepkbepoYNRZZYfnmdXXempmlprgRQgwymZVbkngWV",
 "gv2zuruz22yurpomlkjihhhhgggggggggffffffffeeeedcbaZXWURNJJMRURMJQgw42wtuy11yuqnlkjihggggggggggggggfffffffffffffedcbaYVRNKKNRSPJHPgx65zvuwzzxsoljhgggfffgggggggggggffffffffffgggfffecaXTOMMPRQMGFOgx771wuuwwuqmjhffeeefffggggggggggfffffffffggghhhggecZVRPPRRPKEEOgw672xtrssqnjhfddeeefffggggggggggfffffffffggghhhiigecYVTTUSOJEFPgw573xspoomkhfdccdeeffgggggggggfggfffffffffgghhijjigebZXXWTOIEGPgw672wqnmljhecbbcdefgggggggggggfggfffffffffffghijkkjhecaZYVPJEFPgx671uoljigecbbbdefgghhggggggggfggffffffffeeffghikkkjhfdcaXRKEFOgx770smihgecaabceghhhhhggggffgffgggfggffffeeeeefhjklljhfedZTLEEOgy76zqjgedcaZaceghihhhggggfffggfggffgggffffeeedefhjlmljihfcVMFENgy86yohdccbaaceghiiihggfffffgggfggfffgggggffedddefhjllkjjieXNFDNg0-6ujdbaaZacfhjjjiggffffggggggfggffffffggggffdcccegjlmllkicRFBLg2_4qfaZZZacfjlljhgfffffgggggggfggfffffffgggggfecaacgjlmmmlgVHAJg3_2mbYYZacfjmmjhfeeffggggggggffgggffffffffgghhgecZZcgjlmnnkZJAIg4_yhXXZacfjmmkgedefghhggggffggfggffggffffeefghihfbZZcgjlmooeNAHg49vdVXaceimnkgdcefghhggffffgggfggfffggggffeefghjifbYZdhjloqiQCH",
 "fRMPRPOPQPOPQPPPQPPPQPOPQPOPRPMRguzwuwxwvwxwvwwwvwwwvwxwvwxwuwzufRMPRPOPQPOPQPPPQPPPQPOPQPOPRPMRguzwuwxwvwxwvwwwvwwwvwxwvwxwuwzufOIMNLKMMLLMMLLMMMMLLScihefhgefhgeghfeghedjt00zzzz00zz00zz10y03xfMGJMKIKLKIKLKILSXZYYYYYYYYYZYXZgmonmnnnnnnnnnmou03101310131z25yfLEILJHIKJHILPUVUTUVUTUUTWchgefhgeghfejpsrrsrqrsrqrw034213420370fKEIKHGIIHJOSSQRSRRRSUYccaacbaacgjllkjlljjnrtuuutuvttx2433541381fKDHJHGHIKORQOPQPOSXZXXYYWXaeggggfffhlopnnoomotxwvwxvuy134542481fKCGJHEHMNNOPONOSUVVVVUVZbccccbcgjkjjjjkmqrqqqqrtxyxwxyyz4742591fJCHJFFKNNMNNMOSUTSTTVXaaZYabdghgefiklnmlloqsstsrtxzyyzyy1662492fICGIGGLNMKMNPRSSQRUXXXXXYbddcceghjjiiknoooooruvttuwyz1zy0553592fIBGIGHLNKJMPQQQQRUWWUVYaaaabcfhgegjkllllnqrppruvvvvwz21y04535-2fIBFIHILMJKOQPOQSTUUUVXZZXZceddeghiihjmommoqrrrstvxwvx12z03436-2fIBFIHILLJLPPNORTSSTWXXXYZbcbbeggfhkkjkmnooopsttsuxyww01013336-2fIAFJIIKKKMOONPSSQSWWVVYaZZbdddeghiiikmmlnqqpptvttwyxxz1113326_2fIAFJIHJLLMNOPQRRSUVUVXZYYbdcbeggfhkjiknnmoqrqrtuuvwxyz0024326_2fIAFKIHJMMLMPPPQSTTTVWWXZaabcdeeghhijkllmoppqssstvwwwz0zz24226_3",
 "i285245444544455445544554358zeLHMOKKMNKKMMKKMMKLMMKLMMKLNLJLOLHOz01zz00zz00zz10zz11yy31lPDEIIFGHHGGHHGGHHGGHHGFHIGDLfy4zx01zy01zhr0zvwzywxzxwyzwvz1oSCAEFCCEEDCEEDCEEDCEFBAMjz1wvzzwwzywxzxvy1vjex52y032z022zz24wdLDHKJGHJIGHJJGGKJFFRm141y031z032yz44qVHEHKJGEMh18314522551381eLHMMJKMLJLMKJMMHLe18315522541381hNHKNLJLMLJLNKHN2322222331253nRFHMLHILKHIMLGHVq45202431145wdLFJMKHJMKHJMJFLfz631zz11zz21y05ydJEIJGGIHGIJFEPl24zy12zy24sWGEIJGGIHGIJFFVt41x020y12fz61z33z06zdJFKKHIJIIKHHWv72y25zy54kNGIJIJJIIKIFQo54z141z45rVGDMh074234451kOEJPLGKOLFKcv56322463qVGGNOIHNOHFUq35442267vaKHKMMJHO732452265oRGJOLHLOJGTq56333460hLFMOJINNGIcx6533356vYHHNMIJOLGNj23y151y37tVHIKIILJFJbv540z36wbJGKKIJKHHWs550z36zgNEILJHKJGQo65y05bz92w280fNGIJKJIGNf082x28zeMGIJJJIGNg181x38ydLGIKJJIHOh181x39xZOf292z68tWJIKLLJIPj491z77pTIJLLLJIRn680085lQIJLLLJIUq77z193hNIKJMs98z2-4iPJKLNLIOk5812-3gNIKMMKIRn781391eLILMMJJTq87039zaKJMMLJKV233245wcJELOJENi05235xcJELOJENi05235wcJELOJENi05235xcJELOJENi053nw4432rUDFOMDHcx4234uYGEMNFFWt4214ydIELNGESo34231kMCJPICOl0334zp",
 "gz852240sidcdeefggghhhhhgggggggfggfffffffeeeeefffghhijidTLHJJGDMg096223zpgbbdefghihhhhhggggggggfggfffgffffeeeeedefghikkfWMIJJFCLg1-6122xmdabdfgijjihhhhggggggggfggffffffffeeeedccdfgikliZOJJKFBKg2_6112vkcZcfhijkkihhhgggggggggfggfffffffffeeedbbcdegjmjbQJKKFAJg3_6110ujbadgikllkigghgghhgggggfggfffffeeffeffdbaabdfilkcRLKKFAIg3_600zsiccfiklmlkhgghgghhgfgggfggfffgfeeffeffebaZabdgjjdTMLLFAIg3_50zysjdehjlmmljgfghhhhhgfgggfggfffgfeeeeefgfcaZZacehicTNMLGAIg3_5zzyskggikmmmligfghhhihgfgggfggfffgfedeeefgfdaZZZbdffbTNMMGAIg3_5yyxtmiijkmmmkigfghihihgfghgfggfefgfededefgfdbZZZbcddZSONNGAIg3-4xwxuoljjklmmkiffgiiiihffghgfggfefggeddddfggdbZZabccaXROPOHBIg2-3wvwvrnkijlmlkiffhiiihhffghgggffefggeedddeggdbaZacdbYUQPQPIBJg292utwwtokiikmlkiffhiiihgffghhggfeefggfedddeggdbaZbddbXSPPSRJCJg291sswxupjhikmlkhffhjihhgffghgggffefggfeedceggebaZbdecWROPTTKCJg290rqwyvpighkmljhgghiihhgffghgggffefggfeeddeffecaZbefdWQNPVULCJg28zqpwzwohfhlmljhggiiihhggfghgggffefgffeedddffecaZaegeXPMPWVMDJg28yopw0wngfimmkihghiihhhggggggggfffffffeeeddefedbZZdgfYPLPWXNDJ",
 "gz70laXbecZco3-3kSKShsuroqtqeOGNgy5xhVSVXURTet1tbIBIXjmjhkolaLEMgvsbRbuyjUYq1rZVk0weTevzjTXoynVRguqYNXoscMQhshPLbqmUKVnrcNRkukTQg32jZdcVXt_2cPYkklx6sSIavxonqfLJg20gVYXOQl3tTFOabbnwjJASoqjimcJIgxgQhyiSj0kTk1kUk1kUk1kTjziRhygPgwfNeudMcsbKbrbKbrbKbsbLctdNevfOgz70laXbecZco3-3kSKShsuroqtqeOGNgy5xhVSVXURTet1tbIBIXjmjhkolaLEMgvsbRbuyjUYq1rZVk0weTevzjTXoynVRguqYNXoscMQhshPLbqmUKVnrcNRkukTQg32jZdcVXt_2cPYkklx6sSIavxonqfLJg20gVYXOQl3tTFOabbnwjJASoqjimcJIgxgQhyiSj0kTk1kUk1kUk1kTjziRhygPgwfNeudMcsbKbrbKbrbKbsbLctdNevfOgz70laXbecZco3-3kSKShsuroqtqeOGNgy5xhVSVXURTet1tbIBIXjmjhkolaLEMgvsbRbuyjUYq1rZVk0weTevzjTXoynVRguqYNXoscMQhshPLbqmUKVnrcNRkukTQg32jZdcVXt_2cPYkklx6sSIavxonqfLJg20gVYXOQl3tTFOabbnwjJASoqjimcJIgxgQhyiSj0kTk1kUk1kUk1kTjziRhygPgwfNeudMcsbKbrbKbrbKbsbLctdNevfOgz70laXbecZco3-3kSKShsuroqtqeOGNgy5xhVSVXURTet1tbIBIXjmjhkolaLEMgvsbRbuyjUYq1rZVk0weTevzjTXoynVRguqYNXoscMQhshPLbqmUKVnrcNRkukTQg32jZdcVXt_2cPYkklx6sSIavxonqfLJg20gVYXOQl3tTFOabbnwjJASoqjimcJIgxgQhyiSj0kTk1kUk1kUk1kTjziRhygPgwfNeudMcsbKbrbKbrbKbsbLctdNevfO",
 "gs1454442ysnjgedcdddeeeedddddddeghiiiiiiihhhhiiijihfcYTNJHHHGHKTgt2665430vpjfcbbbcdefffeeddddcdeghijiiiihhggghijkkkjgcWQLIHGFFJSgu487541xslfbZZZbcefgggfeeddccceghjjjiihhgfffghjkmmmkgaTOKHGEDHRgv69852zuohbYWXZbdfhiihgfeddcccdgijjjiihgfeddegikmopnkeXRMJGDCFQgw7-841wrkdYVVWZcfhijjihfedccccdgijjjjihgedccdegjmpqqnibUPKHDBEPgx8_84ztngaVTUXadgjkkkjhfedccbcdgijkjjihgecbbbcfilorsqlfYSMHDADOgx9_72wqkdXTSUYcfikllkjhfedccbcdgijkjjihgecbaabdgjnrtsoibVPJEACOgy9_70tngaVSTWaehkllkkihfeddcbcdgijkjiihgedbbaabehlpstqlfYSLEACNgy9_6yqjdXTSUYdgjllkkjigffedcccdgijjjihggfdcbbaacfinrtsoicVNFACNgy9-4wngaVTTWbfjllkjjihggfedcccdgijjjihgffedccbaacgkpssqlfYPHBCNgz--3tkdXUTUYdillljihhggggfedccdgijjihgffffeedcaaadinrsroibSIBBMgz--2rhaVTTWbgkmmkiggggggggedccdgijjihffffffffdbZZbfkpssqleUJBBMgz--1pfXUTUYejmnljgfefghhhgfdccdgijjigfeeefghgfcaYZchnrsrogWKBBMg0-9zncVSTWbhmonlhfddfghiihfdccdgijjigeddefgiigeaYXZekpstqjYMCBLg0_9ykZTRTYekopnjgdcdfgiiihfdcbdgikjigedddfgijifcYWXbhnsusmbNCALg0_8wiXRRVahmppmieccdfhijihfdcbdgikjigedcdegijjhdZWWZelquuodPDAL",
 "g_4aNbpngfihghigghhgghhfghgfgggfggfffgfefgeeffeeffdefedgfYWkylHAg-zUOitkbgkhehjgfiiffhhffhgffhgeghfeggfeggeeggddgfcehebfkbSdxrMBg6tRSoufZimgdikfeiiefihefihefigeghfdghedghedghddhgbdifZdmgRXtuSFg1pTXqrcZknecjkeejjefjiefihdfigdgifdgiedghdcghcchhbcjhYbmjUVosWKgulWbpobblledkkeejiefjhefihdfigdgifdgiedghecghdchhbbihaakkXWkpaRgpjbenldekkeejjefjiefihefigefigeghfdghfdghedghdcghcchhbbhiaYhkcWgliegkjfgjifgiifgihfghhfghgfghgeghfefgfefgeefgedfgddfgdcfgcbfhdagjighjiggihggihgghhgghgfghgfgggfggfffgfefgfeffeeffedffedffdcefdcgiihhihhhhhghhhgghhggggggggggggfggffffffffffffeeffeeefeeeeedeeddghihhhhhhhhhhhhgghgggggggggggggfggfffffffffffffeffeeeeeeeeeeeedeghihhhhhhhhhhhhhghgggggggggggggggffffffffffffffefeeeeeeeeeeeeedeghihhhhhhhhhhhhhghgggggggggggggggffffffffffffffefeeeeeeeeeeeeedeghihhhhhhhhhhhhhghgggggggggggggggffffffffffffffefeeeeeeeeeeeeedeghihhhhhhhhhhhhhhhgggggggggggggggffffffffffffffeeeeeeeeeeeeeeedeghihhhhhhhhhhhhhhhgggggggggggggggffffffffffffffeeeeeeeeeeeeeeedeghihhhhhhhhhhhhhhhgggggggggggggggffffffffffffffeeeeeeeeeeeeeeede",
 "glortvxy01223444444432210yxvtrolgaXUSQONLKJJIHHHHHHHIJJKLNOQSUXagmqtuwyz0123344444432210zywvtrokgbXUSQPNMLKJJIHHHHHHIIJKLMNPRSVZgnsuwyz0123334443333211zyxwusqokgbXVTRPONMKKJIIIIHHHIIIJKLMNPRTYgpuwxz01123334433332110zyxvtrqnkgbYVUSQONMLKKJIIIIHHIIIJKKLMOPRWgqwxy01223333433332110zyxwutrpnjgcYWUSRPONMLKKJIIIIHIIIIJJKLNOPVgrxyz1222343333322210zyxwvusqpmjgcZWVTRQPONMLKJJJIIIIIHIJJJKMNOUgsz00233344333322210zzywvutrqomjgcZXVUSRQPNMMLKJJJIIIIHHIIIJLLMTgu01134334433332110zzyxwvusqpnljgcaYWVTRQPONMMLKKJIIIIHHIIHIKKLRgv22245444433332110zyxwvutrqonligdaYXVUSRQPONMLKKJIIIIHHHHGHJJJQgw3434544443332100zyxxvutsrpomkigdbZXWUTSRQOONMLLKJIIIHHHHGHIHIPgx5545654543322100zxwwvtsrqonmkigdbZYXVUTSQPPOMLLKJJIIHGHGFGHGGOgy66567545532220zzyxwvusrrpomlkhgebaZXWUUTRQPONMMLJJJIGGHGEFGFFNgz87577655532210zyxwvutsrqpnmljhgecaZYWVUTSRQPONMLKJJIGGGFEEGEDMg09867865553221zyyxvuusrqpomlkjhgecbaZXWVUTRRQONNMKJJIGGGFDEFDCLg1-978865553210zyxwvutsqponmlkihgedbaZYXWVTSRQPONMLKJIGGGFDDECBKg2_-89975553110yxxwutsrpoomlkjiggfdcbaZXXWUTSRPOONLKKIGGGECCDBAJ",
 "gox38__962xsolkjjkmnnnnljhfedddeghiiihgecaYYYYZbccbaXTOJFCAADIOXgpx48-_962xsomkjjklmnnnljigedccdgijjihfdcaYYYZabccbZXTOJFCABDHOWgqy48--962xspmkjjllmnnnlkigedcbcgjkjihfdbaYYYZaaccbZWTOJFCBBDHNVgrz48--862xspmkjjllmnnnlkigfdcacgjljigfdbaYYYZaaccbZWTOJFDBBDHMUgs05899852xspnkijlllmnnlkjhfdbabgklkigecbaYYZaaacdbYWTOJGDCCDGLTgt15799752xspnkijlllmnnlkjhfdbZaglmkigecbaYYZaaacdbYWTOJGECCEGKSgt25798751wsqnkijllkmnnlkjigdaYZgmnlifdcbaYYZbaacdbYVTPKGEDCEGJSgu36788651wsqokijllklnnlkkigdaXYgnolifdbbaYYabaacdbXVTPKGFDDEFIRgv36787641wsqokijllklnnlkkigeaWYgnplhfdbbaYYabaacdbXVTPKHFEDEFIQgw46777641wsqokijlljlnnlkkjgeZVXgoqmhfcbbaYYacaacdbXVTPKHFEEEFHPgw56676541wsqpkijlkjlnnlkljheZUWgprmhecabaYYacbacdbWVTPKHGFEFFGPgx66666541wsrpkhjlkjknnlkljheZUVgqrmhecabaYYbcbacebWUTPKHGFFFFFOgy67665431wsrpkhjmkiknnlllkheYTVgqsnhebaaaYYbdbZcebWUTPKIHGFFEFNgy77655331vsrpkhjmkiknnlllkheYSUgrtnhebaaaYYbdbZcebWUTQKIIGGFEENgz87554330vrrqkhjmkijnnllmkieYRTgsunhdbZaaYYcdbZcebVUUQLIIHGGEDMg087543220vrrqlhjmkhjnnllmlieXRSgtuohdaZaaYYcebZceaVUUQLJJIHGEDL",
 "vsmjjjhgggffffeeeeededddddddddddddddddddddddedeeeeeffffggghjjjms2xurnlljhggfeeedcccbabbaaaaZZaaZZaaZZaaZabaabcbbcdddfgffiljfm0_-2xtrpmkjigffedddcbbbbaaaaZZZZYZZZYZZZYZaZZabaaccbbefccimgZds59750xuqonljihgeeedccbbaaaZZZZYYZZYYZYYYZZYYaZYZbaYafdYZingWWht27-84zwtromlkiggfeddcbbbaZZaZYYZYXYZYXYZYXZaYXabZWafcVWhniXTXgqz68753zwsqpmkjihffedcccbaaaZYZZYYZYXXZYXXZZWWbbWUbgcTTemkcVTVdox368741ywtqonljihgedddbbbaZZaZYYZYWXZXVXaYUWcbUSahcSRZikhbTQUclt1677641yusromlkiggfecccbaaaZYZZXWZZWVYbWSWdbSRagdUQUbikgYRQTZhry2577421xvsqonkjihfeedbbcbZZbZWXaZVVabVRXebRQXfeXRQVdkjeXSPQWfnu0566652zwusqnmljhhgecdebZbcZWYcZUVccURXebTQVcebVPQXfjieXROQVbjrx1466431zwtrqoljkjfegfbaddZXbdYTWdcUQXdcVRSYdeZROSYeiidWRPPSYgntz344542zyvuronnkhhigccgeYXdfYTXecVRWcdYSQUbfcWQPSYfjhdXSONRWcjqwz255322zwurrqmjklhdfifYZfgYUYedWSUadbVQRXdeaVQOSZfhheYSOOPSZgmrx123441zzyvtompoifilgZbhhZVYeeZUTXdeZSQUZdeaTPPTYeiieYTPMNRWbipux0342120wuqqtrjhmohbdjibXZdfdXTVcfcWRRVbfeYSPPSYehheaUPNOPSZglpv011342yy0wxtlkpqjdfkkeZZcggaUUZeeaVRRXdfcYTPOTZdgigaUROMNSXbgotvx241z23ysu",
 "g5_3xuqkknkeflqrttpjhihggiihikiggfdbdeddffedecWSSUVaghbYbbVROIAGg4_4xuqmlmidfmrstsojhihfgiihjkiggfdbceddfgedecXTSTUZgidZaZVROHAHg4_4xtqnmlhdfmrttrnjijhfghiijkiggfdbcddefgecdcYUSSUZgieaZYVSOHAHg3_4xtrpnkfdgnstsqnkjjhffhiijjiggfdccddeggeccbYVTSTYfigbYWUSOHAIg3_4wtsqnjechottspnlkjhffhijjjiggfdcccdeggecbaYWTSSXejhcYVTSPHAIg3_4wutrniddhpttrpomkigefhijjjiggfdcccdeghfdbZXWUSSWeiidYUSRPHAIg3_4wuurmhddjqtsqppnkifegijijjihgedccdcdfhgdbYWWVTSVciieZURRPHAIg3_4wvvsmgcekqtrqqpnkhffgiiiijihgedcddddfggebYWVVUSVbhjfZTQQPHAIg4_4wvwslfcelqsqqrqnjhffhiiijjihgedccdddeggecYVUVVTVahjgaTPQPHAHg4_3wwwskecflqrqqsrnjggghiiijjihgedccdddefffcYUTVVUVagjhbTPPPIAHg4-3wwxsjddgmqqprsrmiggghhiijjiggfdccddeefffdZUTUWVVZfiicTOPPIBHg4-3wxysjddhmpppstrlihhgghiijjiggfdccddeffeedaUSTWWWZeiicTNOPIBHg4-2wyyrideimooqstqlihhgghijjjiggfdcccdeffeedaVSTVXXZdhidUNNPJBHg4-2wyyrhdfjmnorttpkiihgfhijjjiggfdcccdegfeddbWSSUXYZcgieUNNPJBHg4-2xzzqgdgjlmorutpkjihffhijjjihgedcccdeggedcbWSRUXZacfifVMMOJBHg492xzzqgdgkkmpsusoljjgffijijjihgedccdcdggfccaXTRTWZbbfifVMMOJCH",
 "gjmpruvxy0011221110zyxwutsqonljhgecaYXVTSRPONMLKKKJJKKLLNOQRUWZcgjmpsuwxz0112221100zyxvutrqomljhgecaZXVUSRQONMLLKKJJJKKLMOPRTWZcgjnqsvwyz011222110zzywvusrpomljhgecaZXWUTRQPNMMLKKJJJKKLMNPQTVYcgkortvxyz011221110zyxwvusrpomkjhgecbZXWUTRQPONMLKKKJJKKLMNOQSUXbgkoruwyz0111211100zyxwutsqpnmkjhgecbZYWVTSRPONMLLKKKJKKKLMNPRUXbglpsvxyz011111100zyxwvutrqpnmkjhgecbZYWVUSRQPONMLLKKKKKKLMNOQTWagmrtwxz011111110zzyxwvusrqonlkihgedbaYXVUTRQPONMMLKKKKKKKLMOPSUZgnsvxy0011211100zyxwvutsqpomlkihgedbaZXWVTSRQPONMLLKKKJKKLLNOQTYgpuwyz111221100zyyxvuusrqpnmlkihgedbaZYWVUTRRQONNMLLKKJJKKKMNPRWgrxyz121122100zyxxwvutsqponmkjihgedcbZYXWVTSRQPOONMLLKJJKKJKMNOUgt0002221110zzzxwwvutsrqpomlkjiggfdcbaZXWVUTSRQPPOMMMLKKKJJJLLLSgx421232111zyyywvvussrqponmkkjiggfdcbbZYXWVUTTRQQPNNNMKKKJIJKJHOg1841341000yxxwvuutrqqpnnmlkjjhggfeccbaZYYWVVUSRRQPOONLLLKHIKHDKg4_4022zxyyvuvusrsrpoonmllkjiihggfeddcbaaZYXXWUTUTRQRQNNOMJJLHAHgx0uqssqoppnmnnllllkjkjiiiihhhgfggfeeeddddcbcbaaaaYYZYWWXVTTVRLOgrtolmnlkkkjjjjiiiihhihhhhhggggfggffffeeeeedeeddddccccbbbaYZaXSU",
 "0xtojcVPMKKMPSXhpvxyzvogZTPORXelquvuqiaURRUbjquxyxtmeXQMLOUbipv00voicWRNLKKKLMQYhpv044zrjbUQRVbiorsqleXTSUYfmsuvusoicXSPQTaipv02xrjcWQMJIHHHHILTbkrx230unfZVVYdjpssqleXTTXdjqtutsqolhdZWVXdjqw01unfYSNJHGGGGFGJQYgnuz1yuohbYYbfkpttsnfZVVagntvusqppomieaYZekqvyyrkdWQMIGGGGGFFIOXelrwyxtoidaacglpsutohaWXbiqvxurpppqolgbZaekquwvpibVQLHFFGGGFEHOWekpuxwtoidbbehlpsutqjbXXcksxxuqooqrqmhcabfkptvuohaVQLHFFGHGFDGNWdjotvvsoidbcfimpsuurkcXXdltyyuqnoqsrnidabfkptutngZUQLHEEGHHFDFNWdinsvvsoiecdfjmorturldXYdluzzupnortsoidabfkpsusnfYUQMHEEGIIFCFNXdhmruvsoiecdgjmortvsldYYdmu0zupmortspjdacglortsnfYUQMHEEGIIFCENXehlquusniecdgkmoqtvtmdYYdmv0zuomorttpjdacglortsneXTRMHEDGJJFBENYegkquusniecdhkmoqtvtmdYYemv00uomorttpjdacgloqssneXTRNHDDGJKFBDNYegjquurniecdhknoptvumdYYemv10unmorutpjdachloqssndWTRNHDDGJKGBDNZefjpuurnjecdhlnopsvumdYZemv10unlorutqjdachlnpssndWTSNHDDGJKGACNZefipuurnjecdhlnopsvumdYZemv10unlosutqjdachmnpssndVTSNHDDGKLGACNaeeipuurnjebdhlnnpswundYZemv11tnlosutqkdachmnpstndVTSNHDDGKLHABOafeipuuqnjebdilnnpswvndYZemv21tmlosutqkdacimnort",
 "rw4_-401574wnoz71ogcYSTYbZYYWWcknifecTNOSSPPTWWRPSVXXbggYQQSUWdlqv4_-3z1474wnnz71nfcXSSYbaYYWWclnjffcTNOSSPPTXWSPSWXYbhgYQPSUWdlqv4_-3y0464vmnz81nfcXRSYbaYYWWclojffdUNOTTQPUYXSPSWYYcihYQPSTVdlqv4_-2yz464ukmz81necXRSYcaYYWVcmpjfgdUNOTTQQUYXSQSXYYcihYQPSTVclpu3_91xz363ujly81mecXRSYcaZZWVcmpkggeUNOUUQQVZYTQTXYYcjiYPPSTVckpu3_90wy253tiky81mdbXQRZcaZZXVcnqkgheUNPUVRQVaZTQTYZYdjjZPPSTUckpt2-8zux142shjx81ldbXQRZdaZZXVcnqkghfVNPVVRRWaZURTYZZdkjZPPSTUckos197ytv031rgix81ldbXQRZdbZZXVcorkghfVNQWWSRWbaURUZaZdkkZQPSTUbkor086xsuz20qfhw70kcbXQSadbZaXWdorkgigWOQWXTSXcbVSUZaZelkaQPTTUbknrz75wrty1zpegv60kcbXRSaebaaYWdorkgigWPRXYTTYdbWSVabaellaQQTUVbjmqy63upsx0yodfu5zjcbXRTaecabYWdorkgihXPSYZUUZdcWTWabaellaRRUUVbjmpx42toqvzxndet5yjccYSTbecbbYWdorkgihXQTZZVUZedXUWbcbfmlbRRVVVbjlow31snpuxwncds4xibcYSTbfcbbZXdorkgjhYRTaaWVafdYUXccbfmlbSSVVVbjlnu1zrmotwumbdr2wibcZTUcfdbcZXdoqkgjhZSUabXWbfeYVYccbfmlcTTWWWcikmt0yplnsvtlbcq1vhbcZTVcfdccaYdnqkgjiZTVbbXXbgeZWYddcfmlcTUXXWciklsywokmqtskbcp0uhbcZUVdgdccaYenpjgjiaTWccYXcgfaXZddcfmlcUUYXXci",
 "gsuolnnlklljjkjiijihhihhhhhggggfggffffeeeeedeedcddcbccaabaYYaXRTg16zuwxusttrqqqooonmlmlkjkjihihfggededcbcbaZaZYXXXVVVUSSTROPRMFKg3_63563121zyyxvuvusrrqonnmkjjiggfdccbZYYXVUUTRQRQONNMKJKIFGIFAIgx432453233100zyxwvutsrqponlkjiggfdcbaYXWVUTSRQPONMLLKIIJIGHJIHOgsz013433332211zzyxvuusrqpnmlkihgedbaZYWVUTRRQONMMKKJJIIIIHIKLMTgpvxz123333322210zyxwvtsrqonlkihgedbaYXVUTSQPONMLKJJJIIIIIJKMOQWgnsvxz122333332110zyxwutsqpnmkjhgecbZYWVTSRPONMLKKJIIIIIJJKMOQTYgmqtwy0123333332110zywvusrpomljhgecaZXWUTRQPNMLKKJIIIIIIJKLNPSVZglpsvxz012333333210zyxwutrqomljhgecaZXVUSRPONMLKJIIIIIIJKLMOQTWagkoruwyz123333332210zywvtsqonljhgecaYXVTSQPNMLKJJIIIIIIJKMNPRUXbgjnqtvxz012333333210zyxvusrpnljhgecaYWUTRQONMLKJIIIIIIJKLMOQSVYcgjmpsuwy0123333332210zxwutrpnljhgecaYWUSRPOMLKJJIIIIIIJKLNPRTWZcgjmpruwyz122333333210zywvtrpnmkigdbZYWUSQPNMLKJIIIIIIJJKMNPRUWZcgjmortvxz012334333210zywvtrqomkigdbZXVUSQPNMLKJIIIHIIJKLMOQSUXZcgilortvxz012334433221zyxvtsqomkigdbZXVTSQONMKJJIIHHIIJKLMOQSUXadgiloqtvxy0123344332210yxvusqomkigdbZXVTRQONLKJJIIHHIIJKLNOQSVXad",
 "gv452zvsrrqpoonmmmlkkkkjjiihhhgggffeeeddccbbbbaZZZYXXWVUUTQMJGHQgy760vrqpponmmmllkkjjjjiiihhhhgggffeeeedddccccbbaaZZZYXWWVUQLFENg1-6xqonmmllkkkjjjjiiiihhhhggggggfffffeeeeddddccccbbbaaZZYXVOFBKg3_2qkjkjjjiiiiihihhhhhhgggggggggffffffffeeeeeededddddcccbcbVJAIg38vjfhhhhhhhhhhhhhgghgggggggggfggfffffffffeffeeeeeeeeeeeeegcQDIg34pddhhghihhhihhhhhghhgghgggggfggfffffeffeefeeeeedeeedefeeiiWHIg21kaekjijkjijkiijjihiihhhhgghgfggfeffeeeeddedccddbcdcbcdcbhlbKJg1yhbionlnomlmmlklljjkjiijighhgfggfeefdcddcbccaabaZZaZXYaYXdkeNKgzxieourprspoqqnnonllmljjkjhhihfggedeecbccaZaaYXYYVVXWTUWURXhdOMgyxllw1wtwxtrttqprqnnonkklkiiihfggedddbabbYXYYVUWVSSUSOPSPKPaaONgyyqt460x00wuwwsrtspopomlmliijhfggecddaZaZXWXWTSUTPPRPLLOLFHSVNNgy1x1--3032ywyxututqpqpmmnljjjhfggecccaYZZWVWVSRSRONPNJILIBBKOKNgx226_93021xwxwtstspppommmljjjhfggecccaZZZXWWWTSTSPOPOKJLICAFJJOgu13563ywxwuttsqqqpnnnmlkkjiiihggfedddcbbaZYYYWVVVTSSRPOPNIFGIKRgu3443zvuutrqrqooonmmmlkjjjihhhggfeeedcccbaZZZYXXXVUVUSRRQMIHHIRgv452zvsrrqpoonmmmlkkkkjjiihhhgggffeeeddccbbbbaZZZYXXWVUUTQMJGHQ",
 "gilortwy02356788888765320ywtroligdaXUSPNLJIGFEDDDDDEFGIJLNPSUXadglptxz12344555677888753zwspmkihggfedbZWTPMIGEDDDEEFGGGHHIJKMOSWagnty2456665433334678862xrmhedcdeghijiheZUOJFDDEFHIIIIHGFFFGHJNSYgpx26788876420yy0258861tmfaXWWYcgjnppolgZSKFDDGJLNNLJHFEDDDEFJOWgr05888888630wtstx26860qgYTQPRUZgmruwvsnfVLFDFJOSTSPLIFDDDDDDGLUgt3787778873xsnlmrx486znbSNKKMRXgouz11ytkYMFDHOUZaYTOIEDDEEEDEISgv5875447872vnhefjs187xjWMIGGINVgqy3553zpcOEDKTcgheYQJEDEHHGEDGQgx7840z04882siaXXcmy77wgRIEDDFKTgs168873ufPEENZjooldTJDDHLMLHDEOgy860usv1781qdUQQVfu67vcMFDDDDHRgu488886zjQEFRgqvvriVKDEKQTRLFDNg084unlpx681nZPKKPZp57uZJDDEEDFPgw6877882mREGWmw11wmYKDFOWaYRHDLg280ngeit480kUKGGJTl37sVGDGIGDEOgx7853585qTEIas2551rbLDHSdhfYLDJg38vgYWbo280iQGDEFNg17rSEEKNKFDMgz861y177tUEKfy6785vdLDJXkpnfQDIg46qZRQUi08zfMDDEDIb07pPDHQTQIDKg183vsv48wWELk38788zgMDLdrvumVFHg55kSMKOdy8ycJBEFDEXy7oNDLWbWLDJg280pkp08yXENo7867-2jNDNix1ztbGGg62eMHGIYv7xaHBGJECTw6mLDQeidQEIg37vidhv80ZFPs9725-4lOEQn354zhJFg60YHFEETs6wYFCLPHAPu6lJFWlqkVFHg46qbVap62aFRw_4w096nPFTs7764nLF",
 "otpkkiYPQZksreUdsmOESiko10cHMdgbfkcVdofRb2_sYXbWPVp62fNUt6uZQUZfnqmhiibTUbkqocTdsoSIUhhkwwbIPgidhldWeofQZx6pYZfaTYp3ydMTr4ubUXafmojfijdWWcjomaScspVLWhfhsubLSikegkdXgpgRXu2mYbieVYo1xcMTq3sbVZdglmhehkfYXcjnlZRbrqXOYieepsbNUkkdfjdXgqhRWszkYckgXYmzvdNUp1rbXbfhkkgdhkgZZdimkZSbrpXPajdbmqbOWlkcejdXhriSWrxiXdmjZYkwudQVpzpbYdghjkfdgkgaadhlkaTbpoXRckdZkpcQYljbejeXgqiTXqwhXdnkaYjuteSXoxnaafhhijfdgjgbbdgkjbUbonXSdkcYjpcRZljaekeXfqjUXpugXeolbZissfUZoulbbhhgijfdgjgccdfijcVbnmYTekcXiodSaliadkfYfpjVYotgXfolcaiqqgWantkbcihgijgdgjgccefhidWbmlYUfkcXhndTblhZdkfYfpjWZnrgYfnldbippgYbmrjceihfhjgdgigddeegidXblkZVfkcXgmdUblhZdkfZeojYanqgZgnkecioohacmpjcejhfhjgdgigddeeghdYbjjZWfjcYgldWckgadkfZenjZampgbgmkedimnhbdlojdfjhfhigegifdeeefheZbiiaXeicYfkdWcjgadjfaemiablngbhmjfeimmhdelniegjhfhigeghfdeeefgeZbihaYehcZfjdXcjgaejfaelibclngchljffilliefkniegjhghigeghfdefefgeabhhaYehcZeidYcifbeifbekibdkmgdhljggilliefkmifgjhghigeghfeeeeegeabggbZegcZehdZchfbeifcfkicdklgehkjggiklifgklifhihghigfghfeeeeefebcggbZegcaehdZdhfbehfcfjhdejlgehkjggikkiggklighihg",
 "g4-vdUXcdccgllgeimibYbefeiqunVGJg25qYRVdhghknkdZdhfaafjjijoriQBHg5-whabbYUWfopjgknhXTahjhhmqnYJLg02nYVZeecelsoeYbfcWXgprnkklePBGg48xnifZTPRbosmimphUSahjjjjllbOOgxxkaacccceltreWZdZTXkuwsmgdYODHg26ytqhVQPPWltojoshUUcfgjligieTRgushdfdacfgjrreTXcXSapwwvqeVSNFJg14xxwiTQROQgrojqujWYfebhmhcgiYTgsndfjeZekhgnpcRVcXUfvxuvsdPOOHKg02w00kUSUOMbomhqwlZdjdXfmfYejaUgrlchngZgoicimaPVeZXkzxrtrbLLPJLgz0w12mWVWOKXkjgpwndhmeWdjdWdibVgqkdipiciphZeiYPWfcbo1xpqpZJKPLMgxzx11oaXXPLVggfowphknfYbgaVagaXgolflqlfkngYbeWPXgffq0woolXKKOMOgxzv02pbZZQLVgfeowphlpgXbgZTagaWgplflsmfkofWaeWPXhgfq0vmmkWJLQMOgzztz3pZZaQKVifcoypfkpgWbhZTbiaUgrldksmekpfWbgWNXjgdq1vlmmWIMSMMg01vy1qcYWNLXhecoyrginhZbeYVdhYTgsneiqnhkmeYdfUNXjheo0ypnjVKNQKLg05yuvriZQLOagdeoxshfjkfaYXbhfVTgsqgekonlgbcgeTOXhiflx0vmdUQRNGLg17zqpqmbPKQaffhouqifilgYUYhldSSgttiaenrnfadgdVRXegglv1wkZVWVMEKg2-2qlmkdSMPXehkoqojijidWWdllaPRguwlaaippidcdcXVXbehowztibZaVJBJg2_5ukgfbVQQWcimopnljheZYbimiXPSgtwodZdknmhecaYWXZdjpvvqkgfbRGAJgz98yneZWUTUXdimpqnkhdaZchkkeWRUgruphbbejmliebYVWZdiorsrpmhYNDCM",
 "g051y00wuvusqrqppqponnmllmljihgggffedcaZaaZYYXWVWWVUVTRQRPLLNKGLgx2ywxxvuvwvuvtrrrrqqpomllkiiihggfedddbaaZXWVVUUUUSQRQPQRQOOPNJOgy3zwyyvuvwuttutssrpponlklkjhhgfggfeecbabaYXWWUTTSRSSRPQRQNNPMINgz50xzzxvwwtrrqoooonnnonnmlkjjiggfdccbaZYYXYYYXXXXVUUSPPQOMMOLGMgw1ywxyvuwwvuutsrrqppppoonljjigfggfdccaYXXWWWWVUUTSRRQPPRQNOPNKPgx2yvwwutvvuuutsstsqqrrpnlkjjihfggedccbaYWUUVVTSTTSRRRQQSRPPQNJOgw1ywyyxvwwvuuutssrqqoljjjhgggffgggfffecccaXVVUTTSRRRQPPQONNPNKPgz50xyzwvwwusssrqrrpnljhggffgggfggfffggffecaYWUUVUTTTRPPQPMNOLGMgy40yz0yxxwuttsqqqokjjjiiihgggffgggfffedddcccbXVVVTSSRPOONLMNLHNgx3yvxywvwwvvvwvtqnllmmkkllkjihggfedcbaabbZZaaYVSQPQQQPPQPNOQNIOgy3zxz0xwxxvvwupllmlkkkjjjjijihgggedcdccccbbbaZaaWRPQQOOPOLMOMINgx2zxzzxxyzxvtpnnonllmlkkljihihggfededcabbaZaaYXYYWSQOMNOOMMOMJOgz40x01yxz0wqonnnmmllmligghggfgggffgffeffdaZaaZZYYYXVPLMONKLOLHMg062z0100zunlnomlmmlkkkjkjihhhgfggfeeedcbcbbbaZZaZXYaYRMLLKLMJFLg183z251snmoppponmllllllkjiijihggfedcddcbaaaaaaZYXWWWXZYTKGJMIDKg5_5472qlnqonmkhikkihjihjkjijliggfdacdcbcedcedbbdebZYXVYaVJEHGAG",
 "g59taTYeedfmrphZXafjkkigedefghhggfeefghihfdbbcglomeWUZgihhnslSCGg45ofjlaOQeproljgcZadhjjihgfeeefgghhhgfedcceilmjfcaXUWhvxlacgXGHg31noxpUMVcablspkjhdabdefiihhhgfggfeeeddghikliecbWTakljqzrWOXYKIgxytx1qcYaVPUfiglrpihjfacfecfigeghfdgjhgjlgcedWUafdgrwqlnjVKOSNOgsxz11wpjeYTSVWYdikkmnlihhfddeeeghhhiigeedaYZbbdinpqtsnhcWPKKMOTgrx0230vpjdYUTTUXbegjklkkjigggffgggfffdcbbabcfhkorssrnicWQLIJLOUgqw0243zvqkfaXVUVWYbdfhijjjjiihggfeddccccdegiknpqrqolgbVQMIHJLPVgpvy1342zwrmiebYXXXYZbcefghhhhhggfeeeeefghjkmnooonkhdZUPMJHIKNQWgpvy1331yvqlhdaXWXXYacdeghhhiihggfeddeeefhijlnoopolieaVQNKIIKNQWgwvov50omqkYVaZUVbecejkhikjghigeghfdefcbdebchjhkqrmlqnbVZXLGQXQPg47tnx6ziWVYYUTXdijklmljigfeeeefgghhhhgfdcaZabcdiosrnnqpdMFOYSEHg2_6tjfhigaURUbhmnnlkihfeddeefffgggghhiihgedbaYYZekrurlfdegcSFAJgz86xnfcdeebXWYcgkmmljhgfeeeeeffggghhhhhgfecaZZbfjnpokhhijgYOFDMgy87zpiffhgdZWVXbfiklkjihgffeeffggghhggfedcbabdgkoqpmifeggdWMEDNgx770sliikkhcYVVXadghijjiiihgggfggfffedddccdefiloqqnjebbddaTLEEOgw672uokknnmidZWWXZbdfghhiiiihhggfeeddddeefgikmoppmidZYYbbXRJEFP",
 "gy74ukcabddaXXbgloomjgedddeefggggfffghhiiihfcZXXafkooliikljbRHENg1-4rfZYbdbYYcioqplgdbbbdfghiiihgedddefgikkkifaWVXdjnnkiknmgUHBKg3_3nbWYccaYcjpspjdaZbdfhiihhgffgggfeeddegikmlicWTWcjnljjnpkYIAIg3-ziXWadcacipsohbYYcfijjjhfeddeghiihgecccdgjnnkeXTWdjljilpodMBIg39veVXcdccgospgZXZeikkihfeeefgggffghhhgedbbdhmomfWTXfjjijoqhQCIg37saUYdedflrphYVZfklkifdddegiihgeddfhiiigdbabgmqneWUagihinrlTEIg34odeicSRdqupiedcabejkjigfeeeffggghhhgfdcbchkljihdWRViutjdhiXHIg31miqnWLSfkikqqjdaabdfhjjigfeeeghhhgfdccegikllicVVbdbgt0pYVdZKIg1ympxoUPZbVYlsnkmleabcbdhihijhfggecdedeikjklhaZbYTanqkmwrXOWZNKgwwruypbYbWQVfiglroihjfZbfecfjheghecgjhgkmgcedXUafdgqvpknkWNRUPPgqvwxxslgcXTTWYafkllmnkhgfdbceddgiihjkigfebYZaabglnpssojfaTOOPQVgpuwxxupkfaWUVWXbfhjlmljihfeeeeeghhhhhgedcaZacegkopqrplgbWROOPRWgpuwxywsnjeaXVVVXadfijkkkjihhggfggffeedcbbbcdgiloqqqolhcYTPNOPRWgotvxyyvrnjeaYWVWXZbeghjjkkjjihggfedccbbccefhkmopqpnlhcYUQNNOQSXgotvwyzwurnifcZXWXXYacefhiijiihggfeddcddeghjlnoopomjgdYURPMNPQSXgnsuwyzywurnkhebZYYYYabcdefggggggfffffghijklnnnnmkhebYURPNMNPRTY",
 "mgfkojXQWimeXblofYckldZejeTQbnogdn293uu15vbJEHKHFNdsyuolkjeVPSdlsompndPLUkrmedikfYZfklmnjYQSgqodWervndhx_5kNFJPNLRj17zngggaPJPdprttriUJKYpxrgadigZUXgrxugQKUmxsgagpoaPUp9_sVJLTWVamyyobYdjiYPOYknxzrbMIRjxxkWScoqfTQar1wfNKYqxqdYgrreQQfy5vcPNUafjprmaSTeqvmXMNZlyzoXKLas1tbMNevykSMWo0wfONctxmXTdrwmXRYnxuhWSVbgkopiYRTerxrbOLVlvwnYMMas1tZKMfxzlTMVmyvgQOctynWQctzpXPXnwsgWVYceinpkYQSesyqaONXottndRLTm1yeMNfutgWVbipsmYPWnyqZTevzkRNcv1rbSUacciqtkUKPhy1pVJNbqtrnhWLLcx2mSRhqgTXkogdnthPNfvthcksoaPSj03rZPRWZdmwvfPKTkx0oVIMcqusnfWOMUn2wdVhnYIUtyiamufJLgusmorlYRTcny3vdONTXbnyudQTcimqnYLOdrrurcPOSTdw4oZdkWGRs0keqrXHQjrpquqdRPXhpx2yhPKRUWhwxiZfkeZfhWNWluqutcMNWWYp2tddiYKTotkjqmVOYjlmrriaVVZkuyzwjRIMQRas0slpobRVYROcsusurfSRWWZjspggibUYjmiknjaYdggilidbdehpyzvpfRGHLQZp10wvqcQPQOQdrqrspiaXXXZfjjhhifcdijijkhdbccccddehlosw0yriYMEEIPanz31yrgVQONRakjmnmjfcbabdeffhjihhijhggeaYYYZacgkpuy01zumcSJEEHOYjtyzxsldYUSTYefhiihfedcceeefhiihhhhedcaXWWYbeinsx1331xrjaRKGFINUdkprsrnjgcaZadfffgfdddddeeedfggeeedaZZYXXaehmrw158862xrjaSLHGHKOVbfilmmkjhfdde",
 "gouy14431zvsomjiggfffggggggggggggfffffffffffgggffdcZXTQMKIHHKNRXgpv035530xtpmjhfeeeeffgggggggggggffffffffffgghhhhgecZWSOLIGGILQWgpw14653zvrmjgedddeeffgggggggggfggfffffffffgghhiiihfcZUQMIGFHKPWgqy25752xtojfdcbcddefgggghgggggfggfffffeffffghiijkjigcXSOJGEGJNVgry2564zuqkfcbaabdeefhhgghgggggfggfffffeffeeghhikllkjgbVRMHFGJNUgry2563xrnhcaaaabeffghhgghgfgggfggfffgfeffeefgghklllljeYUOIFGJNUgsz2561uokeZYZZacfgghihgghgfgggfggfffgfeffedeffgjlmmnmhbXRKFGJMTgt02550rlhcXWZaadhhghihgghgffggfggffggfeffedefeeillmpojeaULGGJLSgw2256ymgdYTVaccfjjhhjhffhgefhgeghfeghfeggeceeccgjjlqsnifZNFGJJPg04136vgZZWSVdhgimlhgihefhgefhgeghfeghfeghedfeaZdfeiqtpmmfQFIKHLg25xz2saSWXVYhljjlkgfggefhgfghgeghfefgfeghffgfbaccaenqoptlTJMOGJg46vtxpXOUZadjnljjifefgffhgfghgfggfefgfeggfghgdccaYcilmrxoWOSQFHg57uormXOSbgimnligfeefggghgfgggfggfffgfefffghhgfdaYZdfktxoZUXREGg58ujjiYRTdknnligeeefghggggffggfggffggffffefghhhfdaYYbisundccRDGg6-ugccaWYfmpnjfedefghhggggfgggfggfffgffffeefghihgcYWZgnpljjfRBFg6_weVWabeimnlhdcefghhhggggggggggfffffffffeeefghjieaYZdhklpqhPAF"
];
