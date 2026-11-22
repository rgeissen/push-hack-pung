// 9W9 (a TR-909-style drum machine: circuit-modelled kick, snare, toms, rim
// and clap; sampled hats and cymbals, as the 909 had them) on Push.
//
// The 909 is a light panel of instrument sections, each headed by its name
// and holding its own knobs in two rows: BASS DRUM (tune, level, attack,
// decay), SNARE DRUM (tune, tone, snappy, level), the three toms (tune,
// decay, level), RIM SHOT and HAND CLAP, HI HAT (closed and open, a level
// and a decay each), CYMBAL (crash and ride, a level and a tune each). Here:
//
//   KIT     (front panel) those sections in the 909's order, every knob where
//           the 909 has it, an LED in each header that lights as its
//           instrument is hit. Right, the selected instrument's sound drawn
//           large, with what its knobs mean in the module's own units (a
//           tom's pitch in Hz, a hat's decay in ms). The selected instrument
//           is the page: the encoders edit it, the lower buttons select
//           another.
//   SENDS   the reverb's tail and the delay's echoes on the beat, with what
//           each instrument sends into them (the kick stays dry, by design)
//   MASTER  the kit's bus as a path, ACCENT and VELOCITY (accent is the top
//           a full hit reaches, velocity how far a soft one falls under it),
//           and which note plays which instrument
//
// A voice's picture is its own shape over the voice's own time, drawn from
// its knobs. These are one-shots: their decays are part of the sound.

var PANEL = "#e2dbcc", SECTION = "#ece6d9", DARK = "#2b2b2b", ORANGE = "#f7941d", INK = "#1a1a1a", LINE = "#b8b0a0";
var LEGEND_TX = "#4a463e", FAINT_TX = "#8a8476", KNOB = "#2b2b2b", KNOB_RIM = "#8f887a", LED = "#ff3b1f", LED_OFF = "#6b3a2a";
var WIN = "#151515", SIL_FILL = "#3a332a", WAVE = "#f2ede2", KEY = "#cfc8b8";

function known(v, k) { return !!(v[k] && v[k].known); }
function frac(v, k, d) { return known(v, k) ? v[k].frac : (d === undefined ? 0.5 : d); }
// The module answers its enums as numbers ("7.0000"): they are named here from
// its own option lists, so a choice shows as its name and its knob stands right.
var DIST = ["Diode", "Hard Clip", "SAT", "BFZ", "PDIST", "Wavefolder", "Bitcrush"];
var DIV_LIST = ["1/32", "1/16T", "1/16", "1/8T", "1/16.", "1/8", "1/4T", "1/8.", "1/4", "1/2T", "1/4.", "1/2", "1/2."];
var ENUMS = { master_dist: ["Off"].concat(DIST), dly_time: DIV_LIST, note_map: ["Drum Rack", "General MIDI"] };
function options(k) { return ENUMS[k] || (/_dist_type$/.test(k) ? DIST : null); }
function enumIndex(v, k) {
  var o = options(k);
  if (!o || !known(v, k)) return -1;
  var n = Math.round(parseFloat(v[k].value));
  if (isNaN(n)) { var d = String(v[k].display || v[k].value); for (var i = 0; i < o.length; i++) if (d.indexOf(o[i]) === 0) return i; return -1; }
  return n >= 0 && n < o.length ? n : -1;
}
function pos(v, k) { var o = options(k), i = enumIndex(v, k); return o && i >= 0 ? i / Math.max(1, o.length - 1) : v[k].frac; }
function disp(v, k) {
  if (!known(v, k)) return "";
  var o = options(k);
  if (o) { var ei = enumIndex(v, k); return ei >= 0 ? o[ei] : ""; }
  var d = String(v[k].display || v[k].value || "");
  if (/^-?\d+\.\d+$/.test(d)) d = String(Math.round(parseFloat(d)));
  return d;
}
function rawInt(v, k, d) { var n = known(v, k) ? parseFloat(v[k].value) : NaN; return isNaN(n) ? d : Math.round(n); }
function up(s) { return String(s || "").toUpperCase(); }
function lerp(a, b, f) { return a + (b - a) * f; }
// the module's own pot table: a pot (0..1 of its travel) to its engineering value
function expv(v, k, lo, hi) { return lo * Math.pow(hi / lo, frac(v, k)); }

// How its values read everywhere Pung writes one (its pages, the rows under a
// screen): the enums by name, and a pitch or a time where the module's own pot
// table gives it one (EXP: min * (max / min) ^ (pot / 127)). Levels, drives
// and the circuit decays stay 0..127 pots, as the module means them.
var UNITS = {
  sd_c_tune: [130, 320, "Hz"], lt_c_tune: [50, 90, "Hz"], mt_c_tune: [80, 125, "Hz"], ht_c_tune: [110, 170, "Hz"],
  rs_tune: [150, 300, "Hz"], hc_tune: [650, 1400, "Hz"], hc_decay: [120, 1000, "ms"],
  chh_decay: [15, 300, "ms"], ohh_decay: [20, 1200, "ms"], rc_decay: [100, 3000, "ms"], cr_decay: [100, 3000, "ms"],
  chh_pitch: [0.25, 4, "x"], ohh_pitch: [0.25, 4, "x"], rc_pitch: [0.25, 4, "x"], cr_pitch: [0.25, 4, "x"], bd_c_pitch_mod: [0.43, 4.7, "x"],
  rev_hpf: [30, 800, "Hz"], dly_hpf: [30, 800, "Hz"]
};
push.display(function (key, raw) {
  var n = parseFloat(raw);
  if (isNaN(n)) return;
  var o = options(key);
  if (o) { var i = Math.round(n); return i >= 0 && i < o.length ? o[i] : undefined; }
  var u = UNITS[key];
  if (!u) return /^-?\d+\.0+$/.test(String(raw)) ? String(Math.round(n)) : undefined;
  var x = u[0] * Math.pow(u[1] / u[0], Math.max(0, Math.min(127, n)) / 127);
  if (u[2] === "x") return "x" + x.toFixed(2);
  return { value: String(Math.round(x)), unit: u[2] };
});

// a value and its unit, the unit in the label face after it
function valUnit(g, x, y, v, k, c, uc) {
  var val = known(v, k) ? (disp(v, k) || "--") : "--", u = known(v, k) && v[k].unit ? String(v[k].unit) : "";
  var uw = u ? g.measure(u) + 3 : 0;
  g.value(x, y, val, c, -1, 74 - uw);
  if (u) g.text(x + Math.min(g.measure(val, "value"), 74 - uw) + 3, y, up(u), uc, -1);
}

// ---- the kit ------------------------------------------------------------------------------
// bit: the module's lane (its mutes); p: the knob keys by role
var VOICES = [
  { id: "bd", bit: 0, name: "BASS DRUM", short: "BD", kind: "kick",
    p: { tune: "bd_c_tune", level: "bd_c_level", attack: "bd_c_attack", decay: "bd_c_decay", depth: "bd_c_sweep_depth", pitch: "bd_c_pitch_mod", drive: "bd_c_drive", dist: "bd_c_dist_type" },
    keys: ["bd_c_tune", "bd_c_level", "bd_c_attack", "bd_c_decay", "bd_c_sweep_depth", "bd_c_pitch_mod", "bd_c_drive", "bd_c_dist_type"] },
  { id: "sd", bit: 1, name: "SNARE DRUM", short: "SD", kind: "snare",
    p: { tune: "sd_c_tune", tone: "sd_c_noise_decay", snappy: "sd_c_snappy", level: "sd_c_level", drive: "sd_c_drive", dist: "sd_c_dist_type", rev: "sd_c_rev", dly: "sd_c_dly" },
    keys: ["sd_c_tune", "sd_c_noise_decay", "sd_c_snappy", "sd_c_level", "sd_c_drive", "sd_c_dist_type"] },
  tom("lt", 2, "LOW TOM", 50, 90), tom("mt", 3, "MID TOM", 80, 125), tom("ht", 4, "HI TOM", 110, 170),
  { id: "rs", bit: 5, name: "RIM SHOT", short: "RS", kind: "rim",
    p: { tune: "rs_tune", level: "rs_volume", drive: "rs_saturation", dist: "rs_dist_type", rev: "rs_rev", dly: "rs_dly" },
    keys: ["rs_volume", "rs_tune", "rs_saturation", "rs_dist_type"] },
  { id: "cp", bit: 6, name: "HAND CLAP", short: "CP", kind: "clap",
    p: { tune: "hc_tune", decay: "hc_decay", level: "hc_volume", drive: "hc_drive", dist: "hc_dist_type", rev: "hc_rev", dly: "hc_dly" },
    keys: ["hc_volume", "hc_tune", "hc_decay", "hc_drive", "hc_dist_type"] },
  metal("ch", 8, "CLOSED HAT", "chh", "chat"), metal("oh", 7, "OPEN HAT", "ohh", "ohat"),
  metal("cr", 10, "CRASH", "cr", "crash"), metal("rd", 9, "RIDE", "rc", "ride")
];
function tom(id, bit, name, lo, hi) {
  var c = id + "_c_";
  return { id: id, bit: bit, name: name, short: up(id), kind: "tom", hz: [lo, hi],
    p: { tune: c + "tune", decay: c + "decay", level: c + "level", attack: c + "attack", drive: c + "drive", dist: c + "dist_type", rev: c + "rev", dly: c + "dly" },
    keys: [c + "tune", c + "decay", c + "level", c + "attack", c + "drive", c + "dist_type"] };
}
function metal(id, bit, name, pre, kind) {
  return { id: id, bit: bit, name: name, short: up(id), kind: kind, pre: pre,
    p: { level: pre + "_volume", decay: pre + "_decay", tune: pre + "_pitch", drive: pre + "_drive", dist: pre + "_dist_type", rev: pre + "_rev", dly: pre + "_dly" },
    keys: [pre + "_volume", pre + "_decay", pre + "_pitch", pre + "_drive", pre + "_dist_type"] };
}
var BY = {}; VOICES.forEach(function (vo, i) { BY[vo.id] = i; });
// which note plays which instrument (the module's own maps)
var RACK = { 36: "bd", 37: "sd", 38: "lt", 39: "mt", 40: "ht", 41: "rs", 42: "cp", 43: "ch", 44: "oh", 45: "cr", 46: "rd" };
var GM = { 35: "bd", 36: "bd", 38: "sd", 40: "sd", 41: "lt", 45: "lt", 47: "mt", 48: "mt", 43: "ht", 50: "ht", 37: "rs", 39: "cp",
  42: "ch", 46: "oh", 51: "rd", 49: "cr" };
function isGM(v) { return rawInt(v, "note_map", 0) === 1; }
function hits(v) {
  var L = v.$live, out = {}, map = isGM(v) ? GM : RACK;
  if (!L || !L.known || !L.voices) return out;
  for (var i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], id = map[n.note];
    if (id !== undefined) { var vi = BY[id]; if (out[vi] === undefined || n.age < out[vi]) out[vi] = n.age; }
  }
  return out;
}
var LIT = 0.13;
function muted(v, vo) { return (rawInt(v, "mutes", 0) >> vo.bit) & 1; }

// ---- a voice, drawn as it sounds -----------------------------------------------------------
function nz(i) { var s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }
function ex(t, tau) { return Math.exp(-t / tau); }
function sine(c, t) { return Math.sin(c * t * 2 * Math.PI); }
function voiceFn(kind, p) {
  var tau, c0;
  switch (kind) {
  case "kick": // the 909's sweep: a fast fall, a hold, then the body; P.Depth and Pitch move where it sweeps from
    tau = lerp(0.06, 0.5, p.decay); c0 = lerp(2.4, 4.4, p.tune) * Math.pow(p.pitch, p.depth * 0.6);
    var sw = 1.6 + 1.2 * p.depth;
    return {
      env: function (t) { return ex(t, tau); },
      sig: function (t) {
        var ph = c0 * (t + sw * 0.05 * (1 - ex(t, 0.05)));
        var click = t < 0.02 ? (0.3 + 0.7 * p.attack) * (1 - t / 0.02) * 0.6 : 0;
        return Math.max(-1, Math.min(1, Math.sin(ph * 2 * Math.PI) * ex(t, tau) + click));
      }
    };
  case "snare": // two shells 1.585 apart under the noise: tone is how long the noise rings, snappy how much
    c0 = lerp(6, 11, p.tune); tau = lerp(0.08, 0.6, p.tone);
    return {
      env: function (t) { return Math.max(ex(t, 0.1), ex(t, tau) * (0.3 + 0.7 * p.snappy)); },
      sig: function (t, px) {
        var body = (sine(c0, t) + 0.6 * sine(c0 * 1.585, t)) / 1.6 * ex(t, 0.1);
        var nn = nz(px) * ex(t, tau) * (0.3 + 0.7 * p.snappy);
        return Math.max(-1, Math.min(1, body * (1 - 0.4 * p.snappy) + nn * 0.85));
      }
    };
  case "tom": // three oscillators at 1 : 1.5 : 2.75, the upper two only on the attack
    tau = lerp(0.05, 0.6, p.decay); c0 = p.cyc;
    return {
      env: function (t) { return ex(t, tau); },
      sig: function (t) {
        var ph = c0 * (t + 0.4 * 0.05 * (1 - ex(t, 0.05)));
        var up2 = (0.35 * Math.sin(ph * 1.5 * 2 * Math.PI) + 0.25 * Math.sin(ph * 2.75 * 2 * Math.PI)) * ex(t, 0.035) * (0.5 + p.attack);
        return Math.max(-1, Math.min(1, (Math.sin(ph * 2 * Math.PI) + up2) * ex(t, tau)));
      }
    };
  case "rim": // the trigger shock-exciting two resonators: the tock and the tick
    c0 = lerp(14, 24, p.tune);
    return {
      env: function (t) { return ex(t, 0.06); },
      sig: function (t) { return (0.7 * sine(c0, t) * ex(t, 0.06) + 0.4 * sine(c0 * 2.27, t) * ex(t, 0.025)); }
    };
  case "clap": // four rising echoes, then the room tail off the main hit
    tau = lerp(0.06, 0.5, p.decay);
    var gap = 0.03, hold = Math.round(lerp(3, 1, p.tune));
    var burst = function (t) {
      var e = 0;
      for (var b = 0; b < 4; b++) { var dt = t - b * gap; if (dt >= 0 && dt < gap) e = Math.max(e, (0.55 + 0.15 * b) * ex(dt, 0.009)); }
      var tt = t - 3 * gap;
      if (tt >= 0) e = Math.max(e, ex(tt, tau) * 0.85);
      return e;
    };
    return { env: burst, sig: function (t, px) { return nz(Math.floor(px / hold) + 3) * burst(t); } };
  case "chat": case "ohat": case "crash": case "ride": // the 6-bit samples: metal, under their decay
    tau = { chat: lerp(0.015, 0.25, p.decay), ohat: lerp(0.03, 0.6, p.decay), crash: lerp(0.1, 0.8, p.decay), ride: lerp(0.1, 0.8, p.decay) }[kind];
    var hold2 = p.tune > 0.6 ? 1 : 2, bell = kind === "ride" ? 1 : 0;
    return {
      env: function (t) { return kind === "crash" ? Math.min(1, t / 0.02 + 0.3) * ex(t, tau) : ex(t, tau); },
      sig: function (t, px) {
        var e = kind === "crash" ? Math.min(1, t / 0.02 + 0.3) * ex(t, tau) : ex(t, tau);
        var s = nz(Math.floor(px / hold2) + 5) * (bell ? 0.7 : 1) + bell * 0.3 * sine(30 * p.ratio, t);
        return Math.round(s * 6) / 6 * e; // six bits
      }
    };
  }
  return { env: function () { return 0; }, sig: function () { return 0; } };
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 120) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function voiceShape(kind, p, x, y, w, h) {
  var key = [kind, x, y, w, h, p.tune.toFixed(2), p.decay.toFixed(2), p.attack.toFixed(2), p.tone.toFixed(2), p.snappy.toFixed(2),
    p.depth.toFixed(2), p.pitch.toFixed(2), p.cyc.toFixed(2), p.ratio.toFixed(2), p.drive.toFixed(2)].join("|");
  return cached(key, function () {
    var f = voiceFn(kind, p), mid = y + h / 2, a = h / 2 - 1, wave = [], top = [], bot = [];
    var k = 1 + p.drive * 6, norm = Math.tanh(k);
    for (var px = 0; px <= w; px += 1) {
      var t = px / w, e = Math.min(1, f.env(t)), sv = f.sig(t, px);
      if (p.drive > 0.05) { sv = Math.tanh(sv * k) / norm; e = Math.tanh(e * k) / norm; }
      wave.push(x + px, mid - Math.max(-1, Math.min(1, sv)) * a);
      if (px % 2 === 0 || px === w) { top.push(x + px, mid - e * a); bot.push(x + px, mid + e * a); }
    }
    // a sound that has died away draws nothing more: its silence is part of its shape
    var end = w, st = 1;
    while (end > 6 && Math.min(1, f.env(end / w)) < 0.012) end--;
    end = Math.min(w, end + 2);
    return { wave: wave.slice(0, 2 * (Math.floor(end / (st || 1)) + 1)), top: top.slice(0, 2 * (Math.floor(end / 2) + 1)),
      bot: bot.slice(0, 2 * (Math.floor(end / 2) + 1)), mid: mid };
  });
}
function voiceParams(v, vo) {
  var P = vo.p;
  return { tune: frac(v, P.tune), decay: frac(v, P.decay || ""), attack: frac(v, P.attack || "", 0.2), tone: frac(v, P.tone || ""),
    snappy: frac(v, P.snappy || ""), depth: frac(v, P.depth || "", 0), pitch: P.pitch ? expv(v, P.pitch, 0.43, 4.7) : 1,
    cyc: vo.hz ? expv(v, P.tune, vo.hz[0], vo.hz[1]) / 16 : 4, ratio: vo.pre ? expv(v, P.tune, 0.25, 4) : 1, drive: frac(v, P.drive, 0) };
}
// what its knobs mean, in the module's own units (its pot table)
function readout(v, vo) {
  var P = vo.p, out = [];
  switch (vo.kind) {
  case "kick":
    var d = frac(v, P.depth, 0);
    out.push(d < 0.005 ? "STOCK SWEEP" : "PITCH X" + expv(v, P.pitch, 0.43, 4.7).toFixed(2) + " BY " + Math.round(d * 100) + "%");
    break;
  case "snare": out.push("SHELL " + Math.round(expv(v, P.tune, 130, 320)) + " HZ"); break;
  case "tom": out.push(Math.round(expv(v, P.tune, vo.hz[0], vo.hz[1])) + " HZ  (" + vo.hz[0] + "-" + vo.hz[1] + ")"); break;
  case "rim": out.push("TOCK " + Math.round(expv(v, P.tune, 150, 300)) + " HZ"); break;
  case "clap": out.push("BAND " + Math.round(expv(v, P.tune, 650, 1400)) + " HZ   TAIL " + Math.round(expv(v, P.decay, 120, 1000)) + " MS"); break;
  default:
    var rng = { chat: [15, 300], ohat: [20, 1200], crash: [100, 3000], ride: [100, 3000] }[vo.kind];
    out.push("X" + expv(v, P.tune, 0.25, 4).toFixed(2) + "  DECAY " + Math.round(expv(v, P.decay, rng[0], rng[1])) + " MS");
  }
  return out.join("  ");
}

// ---- the panel -----------------------------------------------------------------------------
// The sections: a column is a pair of knobs, top and bottom row, of one instrument.
var COLW = 42, GAP = 6;
var SECTIONS = [
  { title: "BASS DRUM", cols: [["bd", "tune", "TUNE", "attack", "ATTACK"], ["bd", "level", "LEVEL", "decay", "DECAY"]] },
  { title: "SNARE DRUM", cols: [["sd", "tune", "TUNE", "snappy", "SNAPPY"], ["sd", "tone", "TONE", "level", "LEVEL"]] },
  { title: "LOW TOM", cols: [["lt", "tune", "TUNE", "level", "LEVEL"], ["lt", "decay", "DECAY", null, ""]] },
  { title: "MID TOM", cols: [["mt", "tune", "TUNE", "level", "LEVEL"], ["mt", "decay", "DECAY", null, ""]] },
  { title: "HI TOM", cols: [["ht", "tune", "TUNE", "level", "LEVEL"], ["ht", "decay", "DECAY", null, ""]] },
  { title: "RIM CLAP", cols: [["rs", "level", "RIM", "tune", "TUNE"], ["cp", "level", "CLAP", "decay", "TAIL"]] },
  { title: "HI HAT", cols: [["ch", "level", "CLOSED", "decay", "DECAY"], ["oh", "level", "OPEN", "decay", "DECAY"]] },
  { title: "CYMBAL", cols: [["cr", "level", "CRASH", "tune", "TUNE"], ["rd", "level", "RIDE", "tune", "TUNE"]] }
];
// every knob on the panel, placed: [key, x, y, voice index]
var PANEL_KNOBS = [], HEAD_LEDS = [], SEC_X = [];
(function () {
  var x = 6;
  SECTIONS.forEach(function (s) {
    SEC_X.push(x);
    var seen = {};
    s.cols.forEach(function (c, ci) {
      var vo = VOICES[BY[c[0]]], cx = x + ci * COLW + COLW / 2;
      PANEL_KNOBS.push([vo.p[c[1]], cx, 46, BY[c[0]], c[2]]);
      if (c[3]) PANEL_KNOBS.push([vo.p[c[3]], cx, 78, BY[c[0]], c[4]]);
      // its LED in the header: the left end, or the right end for a section's second instrument
      if (!seen[c[0]]) { seen[c[0]] = 1; HEAD_LEDS.push([BY[c[0]], ci ? x + 2 * COLW - 7 : x + 7, SEC_X.length - 1]); }
    });
    x += s.cols.length * COLW + GAP;
  });
})();
var SX = 6 + SECTIONS.length * (2 * COLW + GAP) + 2, SW = 960 - SX - 6;
var EY = 130;
// Segments: the 909's own sections under the hands, each knob on the encoder
// in the order the panel reads (the top row, then the bottom): the two drums,
// the three toms' tune and decay, rim and clap, the hats, the cymbals; and the
// master with the 909's ACCENT. One press away from a pattern's whole section.
function secRect(a, b) { return [SEC_X[a], 24, SEC_X[b] + 2 * COLW - SEC_X[a], 74]; }
var SEGS = [
  { id: "drums", label: "BD SD", rect: secRect(0, 1), secs: [0, 1],
    keys: ["bd_c_tune", "bd_c_level", "sd_c_tune", "sd_c_noise_decay", "bd_c_attack", "bd_c_decay", "sd_c_snappy", "sd_c_level"] },
  { id: "toms", label: "TOMS", rect: secRect(2, 4), secs: [2, 3, 4],
    keys: ["lt_c_tune", "lt_c_decay", "mt_c_tune", "mt_c_decay", "ht_c_tune", "ht_c_decay", "lt_c_level", "mt_c_level"] },
  { id: "rimclap", label: "RIM CLAP", rect: secRect(5, 5), secs: [5], keys: ["rs_volume", "hc_volume", "rs_tune", "hc_decay"] },
  { id: "hats", label: "HI HAT", rect: secRect(6, 6), secs: [6], keys: ["chh_volume", "ohh_volume", "chh_decay", "ohh_decay", "chh_pitch", "ohh_pitch"] },
  { id: "cym", label: "CYMBAL", rect: secRect(7, 7), secs: [7], keys: ["cr_volume", "rc_volume", "cr_pitch", "rc_pitch", "cr_decay", "rc_decay"] },
  { id: "master", label: "MASTER", rect: [0, 0, 960, 21], secs: [],
    keys: ["accent", "volume", "master_comp", "master_drive", "master_dist", "vel_depth", "note_map"] }
];
function secOfLed(j) { return HEAD_LEDS[j][2]; }
function segOf(v) {
  if (v.$segmode !== "segment") return null;
  for (var i = 0; i < SEGS.length; i++) if (SEGS[i].id === v.$segment) return SEGS[i];
  return null;
}
function knobBody(g, cx, cy, r) { g.dot(cx, cy, r + 1.2, KNOB_RIM); g.dot(cx, cy, r, KNOB); }
function pointer(g, cx, cy, r, f, c) {
  var a = Math.PI * (0.75 + 1.5 * f);
  g.line(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, c || "#ffffff");
}
function selected(v) { var p = v.$page || 0; return p >= 0 && p < VOICES.length ? p : 0; }
function stripName(name) { return up(String(name || "").replace(/^[A-Z]{2} /, "")).replace("DISTORTION", "DIST TYPE"); }
function ground(g, v, sel) {
  var kn = v.$knobs || [], ts = v.$tabs || [], cur = v.$tab === undefined ? -1 : v.$tab;
  g.fill(0, 0, 960, 160, PANEL);
  g.value(10, 16, "9W9", INK, -1);
  g.fill(0, 19, 960, 2, ORANGE);
  var vs = VOICES[sel];
  for (var s = 0; s < SECTIONS.length; s++) {
    var x = SEC_X[s], w = SECTIONS[s].cols.length * COLW;
    g.fill(x, 24, w, 74, SECTION);
    g.fill(x, 24, w, 11, DARK);
    var two = SECTIONS[s].cols[0][0] !== SECTIONS[s].cols[1][0];
    g.text(two ? x + w / 2 : x + 13, 33, SECTIONS[s].title, ORANGE, two ? 0 : -1, two ? w - 24 : w - 12);
  }
  // the selected instrument: its knobs' legends in ink, a bar under them
  for (var i = 0; i < PANEL_KNOBS.length; i++) {
    var k = PANEL_KNOBS[i], on = k[3] === sel && !v.$segmode;
    knobBody(g, k[1], k[2], 8.5);
    g.text(k[1], k[2] + 19, k[4], on ? INK : FAINT_TX, 0, COLW + 4);
    if (on) g.fill(k[1] - COLW / 2 + 3, 96, COLW - 6, 2, "slot");
  }
  for (var j = 0; j < HEAD_LEDS.length; j++) g.dot(HEAD_LEDS[j][1], 29.5, 2.2, LED_OFF);
  // the display: the selected instrument, large
  g.fill(SX, 24, SW, 74, DARK);
  g.text(SX + 8, 36, vs.name, ORANGE, -1, SW - 100);
  g.fill(SX + 6, 41, SW - 12, 40, WIN);
  // the deck: the encoders on the panel, the lower buttons as the 909's keys
  g.fill(0, 101, 960, 1, LINE);
  for (var c = 0; c < 8; c++) {
    var kk = kn[c], ex0 = c * 120;
    if (c) g.fill(ex0, 108, 1, 30, LINE);
    if (kk && v[kk]) knobBody(g, ex0 + 24, EY, 10.5);
    var st = v.$segmode ? "" : (ts[c] || ""), y = 145; // while the segments are on, the bottom strip is Pung's
    if (st === "<" || st === ">") {
      var ax = ex0 + 60, d = st === "<" ? -1 : 1;
      g.poly([ax - 4 * d, y + 2, ax + 4 * d, y + 7, ax - 4 * d, y + 12], 2, INK);
    } else if (st) {
      g.fill(ex0 + 10, y, 100, 13, c === cur ? ORANGE : KEY);
      g.text(ex0 + 60, y + 10, up(st), INK, 0, 92);
    }
  }
}
function panel(g, v) {
  var sel = selected(v), t = v.$touched || "", h = hits(v), kn = v.$knobs || [];
  // the kept layer does not change with the segment: moving between segments costs a frame like any other
  g.layer(["9w9", sel, kn.map(function (k) { return k && v[k] ? 1 : 0; }).join(""), (v.$tabs || []).join(","), v.$tab, v.$segmode].join("|"),
    function () { ground(g, v, sel); });
  var sg = segOf(v), hd = sg ? "SEGMENT" : "INSTRUMENT " + (sel + 1) + "/" + VOICES.length, nm = sg ? sg.label : VOICES[sel].name;
  // after the name, clear of the upper buttons' labels Pung shows over the right (SEGMENTS, EXIT)
  // the master segment: its name lit (it has no section header of its own)
  g.text(56, 14, nm, sg && sg.id === "master" ? "slot" : INK, -1);
  g.text(56 + g.measure(nm) + 12, 14, hd, FAINT_TX, -1);
  // a section segment, as the 909 would light it: its sections' headers lit
  // orange (Pung's bar stands above them)
  if (sg) {
    sg.secs.forEach(function (si) {
      var x = SEC_X[si], w = SECTIONS[si].cols.length * COLW, two = SECTIONS[si].cols[0][0] !== SECTIONS[si].cols[1][0];
      g.fill(x, 24, w, 11, ORANGE);
      g.text(two ? x + w / 2 : x + 13, 33, SECTIONS[si].title, INK, two ? 0 : -1, two ? w - 24 : w - 12);
    });
    for (var jj = 0; jj < HEAD_LEDS.length; jj++) if (sg.secs.indexOf(secOfLed(jj)) >= 0) g.dot(HEAD_LEDS[jj][1], 29.5, 2.2, LED_OFF);
  }
  for (var i = 0; i < PANEL_KNOBS.length; i++) {
    var k = PANEL_KNOBS[i];
    if (t === k[0]) g.arc(k[1], k[2], 11.5, 0, Math.PI * 2, 2.5, "slot");
    if (known(v, k[0])) pointer(g, k[1], k[2], 8.5, v[k[0]].frac, muted(v, VOICES[k[3]]) ? "#6a6a6a" : "#ffffff");
  }
  for (var j = 0; j < HEAD_LEDS.length; j++) {
    var vi = HEAD_LEDS[j][0];
    if (h[vi] !== undefined && h[vi] < LIT) g.dot(HEAD_LEDS[j][1], 29.5, 2.6, LED);
    if (muted(v, VOICES[vi])) g.dot(HEAD_LEDS[j][1], 29.5, 1.2, "#000000");
  }
  // the selected instrument
  var vs = VOICES[sel], P = vs.p, m = muted(v, vs), lit = h[sel] !== undefined && h[sel] < LIT;
  g.dot(SX + SW - 10, 32, 3, lit ? LED : LED_OFF);
  var shape = t === P.decay || t === P.attack || t === P.tone;
  var tnT = !shape && t !== P.level && vs.keys.indexOf(t) >= 0;
  var s = voiceShape(vs.kind, voiceParams(v, vs), SX + 9, 43, SW - 18, 36);
  g.area(s.top, s.mid, m ? "#26252a" : SIL_FILL);
  g.area(s.bot, s.mid, m ? "#26252a" : SIL_FILL);
  if (shape) { g.poly(s.top, 1.5, "slot"); g.poly(s.bot, 1.5, "slot"); }
  g.poly(s.wave, 1.3, m ? "#5a5852" : (lit ? "#ffffff" : (tnT ? "slot" : WAVE)));
  if (m) g.text(SX + SW - 10, 54, "MUTED", LED, 1);
  g.text(SX + 8, 93, readout(v, vs), tnT ? "slot" : "#bdb5a5", -1, SW - 16);
  // its distortion, where the drive bites (the module: from about pot 12)
  if (known(v, P.drive) && frac(v, P.drive, 0) > 0.09) g.text(SX + SW - 20, 36, up(disp(v, P.dist)), t === P.drive || t === P.dist ? "slot" : ORANGE, 1, 70);
  // the encoders: the touched one on a dark key, its name and value in the slot's colour
  for (var c = 0; c < 8; c++) {
    var kk = kn[c], x = c * 120;
    if (!kk || !v[kk]) continue;
    var hot = kk === t;
    if (hot) { g.fill(x + 3, 104, 114, 38, DARK); knobBody(g, x + 24, EY, 10.5); }
    g.text(x + 60, 114, v.$segmode === "segment" ? up(v[kk].name).replace("DISTORTION", "DIST") : stripName(v[kk].name), hot ? "slot" : LEGEND_TX, 0, 112);
    if (known(v, kk)) pointer(g, x + 24, EY, 10.5, pos(v, kk), hot ? "slot" : "#ffffff");
    valUnit(g, x + 43, 137, v, kk, hot ? "slot" : INK, hot ? "slot" : LEGEND_TX);
  }
}
push.compartment({
  id: "kit", label: "Kit", front_panel: true, draws_tabs: true, segments: SEGS, draws_segments: true,
  pages: VOICES.map(function (vo) { return { label: vo.short, keys: vo.keys }; }),
  extra_keys: ["mutes", "note_map"],
  screen: panel
});

// ---- SENDS: the two buses ------------------------------------------------------------------
var SENDERS = VOICES.filter(function (vo) { return vo.p.rev; }); // the kick stays dry
var DIVS = { "1/32": 0.125, "1/16T": 1 / 6, "1/16": 0.25, "1/8T": 1 / 3, "1/16.": 0.375, "1/8": 0.5, "1/4T": 2 / 3, "1/8.": 0.75,
  "1/4": 1, "1/2T": 4 / 3, "1/4.": 1.5, "1/2": 2, "1/2.": 3 };
function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? "0" : "") + n.toString(16); }
function shade(f) { return "#" + hex2(242 * f) + hex2(237 * f) + hex2(226 * f); }
function edge(g) { g.fill(0, 0, 3, g.h, ORANGE); }
function hdr(g, x, s, lit) { g.text(x, 11, s, lit ? "fg" : "dim", -1); }
function sends(g, v, x, w, bus, t) {
  var cw = w / SENDERS.length, h = hits(v);
  for (var i = 0; i < SENDERS.length; i++) {
    var vo = SENDERS[i], cx = x + cw * i + cw / 2, k = vo.p[bus], f = frac(v, k, 0), vi = BY[vo.id], lit = h[vi] !== undefined && h[vi] < LIT;
    g.text(cx, 84, vo.short, lit ? "fg" : "dim", 0);
    g.fill(cx - 8, 20, 16, 54, "#1c1c1c");
    if (f > 0) g.fill(cx - 8, 74 - f * 54, 16, f * 54, t === k ? "slot" : "fg");
    else g.fill(cx - 8, 73, 16, 1, "faint");
  }
}
function reverbScreen(g, v) {
  var t = v.$touched || "", w = 466, x = 12, base = 76, top = 18;
  edge(g);
  var dec = frac(v, "rev_decay"), tone = frac(v, "rev_tone"), lvl = frac(v, "rev_level");
  var hot = t === "rev_decay" || t === "rev_tone" || t === "rev_level";
  hdr(g, x, "REVERB TAIL", t.indexOf("rev_") === 0);
  g.text(x + w - 8, 11, "LOW CUT " + (known(v, "rev_hpf") ? Math.round(expv(v, "rev_hpf", 30, 800)) + " HZ" : "--"), t === "rev_hpf" ? "slot" : "dim", 1);
  var len = lerp(0.1, 1, dec) * (w - 20);
  var pts = cached(["rv", dec.toFixed(2), tone.toFixed(2), lvl.toFixed(2)].join("|"), function () {
    var out = [], hold = Math.round(lerp(6, 1, tone));
    for (var px = 0; px <= w - 20; px += 1) {
      var e = px > len ? 0 : Math.pow(1 - px / len, 2.2) * (0.25 + 0.75 * lvl / 1.0);
      out.push(x + 14 + px, base - Math.min(1, e) * (base - top) * (0.6 + 0.4 * Math.abs(nz(Math.floor(px / hold) + 11))));
    }
    return out;
  });
  g.fill(x, top, 4, base - top, "dim");
  g.area(pts, base, hot ? "#4a3a2a" : "#2e2e2e");
  g.poly(pts, 1, hot ? "slot" : "fg");
  g.fill(x, base, w - 6, 1, "line");
  g.text(x + w - 8, 30, tone < 0.35 ? "DARK" : (tone > 0.7 ? "BRIGHT" : ""), "faint", 1);
  g.fill(482, 4, 1, 80, "line");
  hdr(g, 494, "WHAT EACH INSTRUMENT SENDS IN  (THE KICK STAYS DRY)", t.indexOf("_rev") > 0);
  sends(g, v, 490, 460, "rev", t);
}
function delayScreen(g, v) {
  var t = v.$touched || "", w = 588, x = 12, base = 76, top = 18;
  edge(g);
  var div = disp(v, "dly_time"), beats = DIVS[div] || 0.75, fb = frac(v, "dly_fdbk") * 0.85, tone = frac(v, "dly_tone"), lvl = frac(v, "dly_level");
  var L = v.$live, bpm = L && L.known && L.bpm > 0 ? L.bpm : 0;
  hdr(g, x, "ECHOES  " + (div || "--") + (bpm ? "  =  " + Math.round(beats * 60000 / bpm) + " MS AT " + Math.round(bpm) + " BPM" : ""), t.indexOf("dly_") === 0);
  g.text(x + w - 8, 11, "LOW CUT " + (known(v, "dly_hpf") ? Math.round(expv(v, "dly_hpf", 30, 800)) + " HZ" : "--"), t === "dly_hpf" ? "slot" : "dim", 1);
  var span = 4, pw = w - 20;
  for (var b = 0; b <= span; b++) g.fill(x + pw * b / span, top, 1, base - top, b % 4 === 0 ? "line" : "faint");
  g.fill(x, top, 4, base - top, "dim");
  var a = 1, n = 0, hot = t === "dly_time" || t === "dly_fdbk" || t === "dly_level" || t === "dly_tone";
  for (var tb = beats; tb <= span + 0.001 && n < 40; tb += beats, n++) {
    a = n === 0 ? lvl : a * fb; // feedback tops out at 0.85, as the module has it
    if (a < 0.02) break;
    var px = x + pw * tb / span, hh = a * (base - top);
    g.fill(px - 2, base - hh, 4, hh, hot ? "slot" : shade(Math.max(0.25, 1 - n * (1 - tone) * 0.18)));
  }
  g.fill(x, base, w - 6, 1, "line");
  g.fill(606, 4, 1, 80, "line");
  hdr(g, 618, "SENDS", t.indexOf("_dly") > 0);
  sends(g, v, 612, 340, "dly", t);
}
var REV_SENDS = SENDERS.map(function (vo) { return vo.p.rev; }), DLY_SENDS = SENDERS.map(function (vo) { return vo.p.dly; });
push.compartment({
  id: "sends", label: "Sends",
  pages: [
    { label: "Reverb", keys: ["rev_decay", "rev_tone", "rev_hpf", "rev_level"], screen: reverbScreen },
    { label: "Delay", keys: ["dly_time", "dly_fdbk", "dly_tone", "dly_hpf", "dly_level"], screen: delayScreen },
    { label: "Rev Sends", keys: REV_SENDS },
    { label: "Dly Sends", keys: DLY_SENDS }
  ],
  extra_keys: REV_SENDS.concat(DLY_SENDS, ["note_map"])
});

// ---- MASTER: the bus, accent and velocity, the notes ----------------------------------------
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(n) { return NOTE[n % 12] + (Math.floor(n / 12) - 2); }
var NOTE_OF = {}; Object.keys(RACK).forEach(function (n) { NOTE_OF[RACK[n]] = +n; });
var GM_OF = {}; Object.keys(GM).forEach(function (n) { var id = GM[n]; if (GM_OF[id] === undefined || +n < GM_OF[id]) GM_OF[id] = +n; });
var RACK_ORDER = ["bd", "sd", "lt", "mt", "ht", "rs", "cp", "ch", "oh", "cr", "rd"];
push.compartment({
  id: "master", label: "Master",
  pages: [{ label: "Master", keys: ["volume", "master_comp", "master_drive", "master_dist", "accent", "vel_depth", "note_map"] }],
  extra_keys: ["mutes"],
  screen: function (g, v) {
    var t = v.$touched || "", h = hits(v);
    edge(g);
    hdr(g, 12, "THE KIT'S BUS", t === "master_dist" || t === "master_drive" || t === "master_comp" || t === "volume");
    var dOn = enumIndex(v, "master_dist") > 0, cOn = frac(v, "master_comp", 0) > 0;
    var stages = [["KIT", "+ SENDS", true, ""],
      [dOn ? up(disp(v, "master_dist")) : "DIST", dOn ? "DRIVE " + disp(v, "master_drive") : "OFF", dOn, "master_dist|master_drive"],
      ["COMP", cOn ? disp(v, "master_comp") : "OFF", cOn, "master_comp"],
      ["VOLUME", disp(v, "volume") || "--", true, "volume"]];
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i], x = 12 + i * 96, hot = s[3] && s[3].split("|").indexOf(t) >= 0;
      g.fill(x, 22, 82, 42, hot ? "#3a3a3a" : "#1c1c1c");
      g.fill(x, 22, 82, 2, hot ? "slot" : (s[2] ? ORANGE : "#3a3a3a"));
      g.text(x + 7, 38, s[0], hot ? "slot" : (s[2] ? "fg" : "dim"), -1, 70);
      g.value(x + 7, 58, s[1], hot ? "slot" : (s[2] ? "fg" : "faint"), -1, 70);
      if (i < 3) g.poly([x + 84, 43, x + 94, 43], 2, "line");
    }
    // accent and velocity: a full hit reaches the accent level; velocity is how far a soft one falls under it
    var vx = 410, vw = 160, acc = frac(v, "accent", 0.5), vd = frac(v, "vel_depth", 1);
    var topY = 74 - (0.3 + 0.7 * acc) * 52, lowY = topY + vd * (74 - topY) * 0.85;
    hdr(g, vx, "ACCENT / VELOCITY", t === "accent" || t === "vel_depth");
    g.fill(vx, 74, vw, 1, "line");
    g.fill(vx, topY, vw, 1, t === "accent" ? "slot" : "faint");
    g.text(vx + vw, topY - 3, "ACCENT", t === "accent" ? "slot" : "dim", 1);
    g.area([vx, lowY, vx + vw, topY], 74, t === "vel_depth" ? "#4a3a2a" : "#262626");
    g.poly([vx, lowY, vx + vw, topY], 2, t === "vel_depth" || t === "accent" ? "slot" : "fg");
    g.text(vx, 84, "SOFT", "faint", -1); g.text(vx + vw, 84, "HARD", "faint", 1);
    var nx = 596, gm = isGM(v);
    hdr(g, nx, gm ? "GENERAL MIDI NOTES" : "DRUM RACK NOTES", t === "note_map");
    for (var j = 0; j < RACK_ORDER.length; j++) {
      var id = RACK_ORDER[j], vi = BY[id], col = j % 4, row = 3 - Math.floor(j / 4), cx = nx + col * 88, cy = 16 + (row - 1) * 22 + 2;
      var lit = h[vi] !== undefined && h[vi] < LIT, mm = muted(v, VOICES[vi]);
      g.fill(cx, cy, 84, 19, lit ? "#f2ede2" : "#1c1c1c");
      g.text(cx + 7, cy + 13, VOICES[vi].short, lit ? INK : (mm ? LED : "fg"), -1);
      g.text(cx + 78, cy + 13, noteName(gm ? GM_OF[id] : NOTE_OF[id]), lit ? INK : (t === "note_map" ? "slot" : "dim"), 1);
    }
  }
});
