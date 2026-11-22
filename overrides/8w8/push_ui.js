// 8W8 (a TR-808-style drum machine, sixteen synthesized circuit-model voices) on Push.
//
// The 808 is a wall of instruments on a dark warm-grey panel: a column each,
// a cream name plate (orange where the 808 runs an alternate instrument on
// the channel: the congas, the claves, the maracas), orange knobs with a
// white line, thin light rules between them, and along the bottom the row
// of sixteen buttons in red, orange, yellow and cream. Here:
//
//   KIT     (front panel) the sixteen instruments in the 808's panel order:
//           each one's plate, its level knob, its sound in small (how it
//           falls away), and its button in the step row, whose LED lights
//           as the instrument is hit. Right, the selected instrument drawn
//           large, with its tuning as the circuit takes it (semitones, or the
//           ratio of the metal's six oscillators). The selected instrument is
//           the page: the encoders edit it, the lower buttons select another.
//   SENDS   the reverb's tail and the delay's echoes on the beat, with what
//           each instrument sends into them
//   MASTER  the kit's bus as a path, what velocity does, and which note
//           plays which instrument
//
// A voice's picture is its own shape, drawn from its knobs over the voice's
// own time (a knob's travel spans the window), not seconds. These are
// one-shots: their decays are part of the sound, not envelopes a note holds.

var PANEL = "#4f4e4a", PANEL_HI = "#67665f", CASE = "#1d1f24", RULE = "#6f6d67", LEGEND = "#f0eee8", MUTED_TX = "#a8a49a";
var PLATE = "#ded9c9", PLATE2 = "#d1832c", INK = "#1a1a1a", ORANGE = "#e8763a", KNOB = "#e2762c", KNOB_RIM = "#8a4418";
var LED = "#ff4a32", LED_OFF = "#4a1a14", WIN = "#17181c", SIL_FILL = "#3a3833", WAVE = "#f0eee8";
var STEP = ["#d63a2a", "#e8762e", "#f0c23a", "#ebe5cf"]; // the step row: four of each

function known(v, k) { return !!(v[k] && v[k].known); }
function frac(v, k, d) { return known(v, k) ? v[k].frac : (d === undefined ? 0.5 : d); }
function disp(v, k) {
  if (!known(v, k)) return "";
  var d = String(v[k].display || v[k].value || "");
  if (/^-?\d+\.\d+$/.test(d)) d = String(Math.round(parseFloat(d)));
  return d;
}
function rawInt(v, k, d) { var n = known(v, k) ? parseFloat(v[k].value) : NaN; return isNaN(n) ? d : Math.round(n); }
function up(s) { return String(s || "").toUpperCase(); }
function lerp(a, b, f) { return a + (b - a) * f; }

// How its values read everywhere Pung writes one: a tune as the circuit takes
// it (semitones around the reference, or the metal's ratio), the buses'
// high-pass in Hz (the module's own table). The rest are the 808's pots.
var SEMIS = { bd: 12, sd: 12, rs: 12, cl: 12, ma: 12, cp: 12, lt: 2, mt: 2, ht: 2, lc: 2, mc: 2, hc: 2 };
push.display(function (key, raw) {
  var n = parseFloat(raw), m = /^([a-z]{2})_tune$/.exec(key);
  if (isNaN(n)) return;
  var f = Math.max(0, Math.min(127, n)) / 127;
  if (key === "rev_hpf" || key === "dly_hpf") return { value: String(Math.round(30 * Math.pow(800 / 30, f))), unit: "Hz" };
  if (!m) return;
  if (SEMIS[m[1]]) { var st = Math.round((f - 0.5) * 2 * SEMIS[m[1]] * 10) / 10; return { value: (st > 0 ? "+" : "") + st.toFixed(1), unit: "st" }; }
  return "x" + (0.5 * Math.pow(4, f)).toFixed(2);
});

// a value and its unit, the unit in the label face after it
function valUnit(g, x, y, v, k, c, uc) {
  var val = known(v, k) ? (disp(v, k) || "--") : "--", u = known(v, k) && v[k].unit ? String(v[k].unit) : "";
  var uw = u ? g.measure(u) + 3 : 0;
  g.value(x, y, val, c, -1, 74 - uw);
  if (u) g.text(x + Math.min(g.measure(val, "value"), 74 - uw) + 3, y, up(u), uc, -1);
}

// ---- the kit ------------------------------------------------------------------------------
// In the 808's panel order (the module keeps them in its pad order: idx).
// tune: "st" semitones (its range), or "x" the metal's ratio (0.5 to 2, exponential)
function V(id, idx, name, kind, extra, alt, tune) {
  var keys = [id + "_level", id + "_tune"].concat(extra || [], [id + "_decay", id + "_drive", id + "_dist_type"]);
  return { id: id, idx: idx, name: name, short: up(id), kind: kind, keys: keys, alt: !!alt, tune: tune };
}
var VOICES = [
  V("bd", 0, "BASS DRUM", "kick", ["bd_tone", "bd_attack"], false, 12),
  V("sd", 1, "SNARE DRUM", "snare", ["sd_snappy"], false, 12),
  V("lt", 2, "LOW TOM", "ltom", null, false, 2),
  V("mt", 3, "MID TOM", "mtom", null, false, 2),
  V("ht", 4, "HI TOM", "htom", null, false, 2),
  V("lc", 5, "LOW CONGA", "lconga", null, true, 2),
  V("mc", 6, "MID CONGA", "mconga", null, true, 2),
  V("hc", 7, "HI CONGA", "hconga", null, true, 2),
  V("rs", 8, "RIM SHOT", "rim", null, false, 12),
  V("cl", 9, "CLAVES", "claves", null, true, 12),
  V("ma", 10, "MARACAS", "maracas", ["ma_attack"], true, 12),
  V("cp", 11, "HAND CLAP", "clap", null, false, 12),
  V("cb", 12, "COW BELL", "cowbell", null, false, "x"),
  V("cy", 15, "CYMBAL", "cym", null, false, "x"),
  V("oh", 14, "OPEN HIHAT", "ohat", null, false, "x"),
  V("ch", 13, "CLSD HIHAT", "chat", null, false, "x")
];
VOICES[14].keys.push("hh_choke"); // the open hat: what cuts it

// which note plays which instrument (the module's own maps), as the module's index
var GM = { 35: 0, 36: 0, 38: 1, 40: 1, 41: 2, 43: 2, 45: 3, 47: 3, 48: 4, 50: 4, 64: 5, 62: 6, 63: 7, 37: 8, 75: 9, 70: 10, 39: 11, 56: 12,
  42: 13, 44: 13, 46: 14, 49: 15, 51: 15, 57: 15, 59: 15 };
function isGM(v) { return rawInt(v, "note_map", 0) === 1; }
function idxOf(note, gm) {
  if (gm) return GM[note] === undefined ? -1 : GM[note];
  return note >= 36 && note <= 51 ? note - 36 : -1;
}
// the instruments just hit: module index -> seconds since
function hits(v) {
  var L = v.$live, out = {}, gm = isGM(v);
  if (!L || !L.known || !L.voices) return out;
  for (var i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], vi = idxOf(n.note, gm);
    if (vi >= 0 && (out[vi] === undefined || n.age < out[vi])) out[vi] = n.age;
  }
  return out;
}
var LIT = 0.13; // an LED stays lit this long after a hit, as a step LED does
function muted(v, idx) { return (rawInt(v, "mutes", 0) >> idx) & 1; }

// ---- a voice, drawn as it sounds -----------------------------------------------------------
function nz(i) { var s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }
function ex(t, tau) { return Math.exp(-t / tau); }
function sine(c, t) { return Math.sin(c * t * 2 * Math.PI); }
function voiceFn(kind, p) {
  var tau, c0;
  switch (kind) {
  case "kick": // the bridged-T ringing, falling a little into its pitch; tone is its edge, attack its click
    tau = lerp(0.06, 0.55, p.decay); c0 = lerp(2.2, 4.6, p.tune);
    return {
      env: function (t) { return ex(t, tau); },
      sig: function (t) {
        var ph = c0 * (t + 0.8 * 0.04 * (1 - ex(t, 0.04)));
        var s = Math.sin(ph * 2 * Math.PI) + 0.35 * p.tone * Math.sin(ph * 4 * Math.PI) * ex(t, 0.05);
        var click = t < 0.025 ? p.attack * (1 - t / 0.025) * 0.6 : 0;
        return Math.max(-1, Math.min(1, s * ex(t, tau) + click));
      }
    };
  case "snare": // two shells under the snappy: snappy is how much of the noise
    tau = lerp(0.05, 0.45, p.decay); c0 = lerp(6, 11, p.tune);
    return {
      env: function (t) { return Math.max(ex(t, tau * 0.6), ex(t, tau) * (0.3 + 0.7 * p.snappy)); },
      sig: function (t, px) {
        var body = (sine(c0, t) + 0.5 * sine(c0 * 1.585, t)) / 1.5 * ex(t, tau * 0.6);
        var nn = nz(px) * ex(t, tau) * (0.3 + 0.7 * p.snappy);
        return Math.max(-1, Math.min(1, body * (1 - 0.4 * p.snappy) + nn * 0.85));
      }
    };
  case "ltom": case "mtom": case "htom": case "lconga": case "mconga": case "hconga":
    var base = { ltom: 4, mtom: 6, htom: 8, lconga: 9, mconga: 13, hconga: 17 }[kind], conga = kind.indexOf("conga") > 0;
    tau = lerp(0.05, conga ? 0.3 : 0.5, p.decay); c0 = base * Math.pow(2, (p.tune - 0.5) * 4 / 12) * 1.4;
    return {
      env: function (t) { return ex(t, tau); },
      sig: function (t, px) {
        var ph = c0 * (t + (conga ? 0 : 0.3 * 0.06 * (1 - ex(t, 0.06))));
        return Math.sin(ph * 2 * Math.PI) * ex(t, tau) + (conga ? 0 : nz(px) * 0.12 * ex(t, 0.04));
      }
    };
  case "rim": case "claves": // a struck resonator: high, short
    tau = kind === "rim" ? lerp(0.015, 0.12, p.decay) : lerp(0.03, 0.25, p.decay);
    c0 = (kind === "rim" ? 18 : 26) * Math.pow(2, (p.tune - 0.5) * 24 / 12 * 0.5);
    return {
      env: function (t) { return ex(t, tau); },
      sig: function (t) { return (kind === "rim" ? (sine(c0, t) * 0.7 + 0.3 * sine(c0 * 2.3, t)) : sine(c0, t)) * ex(t, tau); }
    };
  case "maracas": // noise, its attack a rise, its decay short
    tau = lerp(0.02, 0.22, p.decay);
    var rise = lerp(0.004, 0.08, p.attack);
    var env = function (t) { return t < rise ? t / rise : ex(t - rise, tau); };
    return { env: env, sig: function (t, px) { return nz(px * 3 + 1) * env(t); } };
  case "clap": // the sawtooth bursts, then the reverb tail
    tau = lerp(0.06, 0.5, p.decay);
    var gap = lerp(0.04, 0.026, p.tune);
    var burst = function (t) {
      var e = 0;
      for (var b = 0; b < 3; b++) { var dt = t - b * gap; if (dt >= 0 && dt < gap) e = Math.max(e, 1 - dt / gap * 0.85); }
      var tt = t - 3 * gap;
      if (tt >= 0) e = Math.max(e, ex(tt, tau) * 0.8);
      return e;
    };
    return { env: burst, sig: function (t, px) { return nz(px + 3) * burst(t); } };
  case "cowbell": // two square oscillators a fifth-and-a-bit apart, a fast drop then a long fall
    tau = lerp(0.08, 0.6, p.decay); c0 = 9 * p.ratio;
    var e2 = function (t) { return 0.55 * ex(t, 0.03) + 0.45 * ex(t, tau); };
    return {
      env: e2,
      sig: function (t) { return ((sine(c0, t) > 0 ? 0.5 : -0.5) + (sine(c0 * 1.48, t) > 0 ? 0.5 : -0.5)) * e2(t); }
    };
  case "chat": case "ohat": case "cym": // six square oscillators through the band-pass, under their envelope
    tau = kind === "chat" ? lerp(0.02, 0.2, p.decay) : (kind === "ohat" ? lerp(0.05, 0.5, p.decay) : lerp(0.12, 0.7, p.decay));
    var fr = [1, 1.47, 1.71, 2.13, 2.59, 3.07], sc = 12 * p.ratio * (kind === "cym" ? 0.75 : 1);
    return {
      env: function (t) { return ex(t, tau); },
      sig: function (t) {
        var s = 0;
        for (var i = 0; i < 6; i++) s += Math.sin(t * sc * fr[i] * 2 * Math.PI * 3.1 + i) > 0 ? 1 : -1;
        return s / 6 * 1.6 * ex(t, tau);
      }
    };
  }
  return { env: function () { return 0; }, sig: function () { return 0; } };
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 160) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function voiceShape(kind, p, x, y, w, h, step) {
  var key = [kind, x, y, w, h, p.tune.toFixed(2), p.decay.toFixed(2), p.attack.toFixed(2), p.tone.toFixed(2), p.snappy.toFixed(2),
    p.ratio.toFixed(2), p.drive.toFixed(2)].join("|");
  return cached(key, function () {
    var f = voiceFn(kind, p), mid = y + h / 2, a = h / 2 - 1, wave = [], top = [], bot = [];
    var k = 1 + p.drive * 7, norm = Math.tanh(k), st = step || 1;
    for (var px = 0; px <= w; px += st) {
      var t = px / w, e = Math.min(1, f.env(t)), sv = f.sig(t, px);
      if (p.drive > 0.02) { sv = Math.tanh(sv * k) / norm; e = Math.tanh(e * k) / norm; }
      wave.push(x + px, mid - Math.max(-1, Math.min(1, sv)) * a);
      if (px % 2 === 0 || px === w) { top.push(x + px, mid - e * a); bot.push(x + px, mid + e * a); }
    }
    // a sound that has died away draws nothing more: its silence is part of its shape
    var end = w;
    while (end > 6 && Math.min(1, f.env(end / w)) < 0.012) end--;
    end = Math.min(w, end + 2);
    return { wave: wave.slice(0, 2 * (Math.floor(end / (st || 1)) + 1)), top: top.slice(0, 2 * (Math.floor(end / 2) + 1)),
      bot: bot.slice(0, 2 * (Math.floor(end / 2) + 1)), mid: mid };
  });
}
// the metal's tune: a ratio, 0.5 to 2, exponential
function ratio(v, k) { return 0.5 * Math.pow(4, frac(v, k)); }
function voiceParams(v, vo) {
  var id = vo.id;
  return { tune: frac(v, id + "_tune"), decay: frac(v, id + "_decay"), attack: frac(v, id === "ma" ? "ma_attack" : "bd_attack", 0.2),
    tone: frac(v, "bd_tone"), snappy: frac(v, "sd_snappy"), ratio: ratio(v, id + "_tune"), drive: frac(v, id + "_drive", 0) };
}
function drawVoice(g, v, vo, x, y, w, h, waveC, fillC, edgeC, lw) {
  var s = voiceShape(vo.kind, voiceParams(v, vo), x, y, w, h);
  g.area(s.top, s.mid, fillC);
  g.area(s.bot, s.mid, fillC);
  if (edgeC) { g.poly(s.top, 1.5, edgeC); g.poly(s.bot, 1.5, edgeC); }
  g.poly(s.wave, lw || 1.2, waveC);
}
// the tuning, as the circuit takes it
function tuneText(v, vo) {
  var k = vo.id + "_tune";
  if (!known(v, k)) return "--";
  if (vo.tune === "x") return "RATIO X" + ratio(v, k).toFixed(2);
  var st = (v[k].frac - 0.5) * 2 * vo.tune, r = Math.round(st * 10) / 10;
  return (r > 0 ? "+" : "") + (Math.abs(r) < 0.05 ? "0" : r.toFixed(1)) + " SEMITONES";
}

// ---- the panel -----------------------------------------------------------------------------
// What never changes while the page, the mutes and the lower buttons stay is
// drawn once into the kept layer: the panel, the plates, the knobs' bodies,
// the step row. A frame then draws only what moves: pointers, waves, LEDs.
var CW = 48, WALL = 16 * CW, SX = WALL + 8, SW = 960 - SX - 6, KY = 47, EY = 130;
function knobBody(g, cx, cy, r) { g.dot(cx, cy, r + 1.2, KNOB_RIM); g.dot(cx, cy, r, KNOB); }
function pointer(g, cx, cy, r, f, c) { // an 808 knob's white line, where it stands
  var a = Math.PI * (0.75 + 1.5 * f);
  g.line(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, c || "#ffffff");
}
function selected(v) { var p = v.$page || 0; return p >= 0 && p < VOICES.length ? p : 0; }
function stripName(name) { return up(String(name || "").replace(/^[A-Z]{2} /, "")).replace("DISTORTION", "DIST TYPE"); }
function stepColor(i) { return STEP[Math.floor(i / 4)]; }
// Segments: the 808's rows across the kit, in two halves of eight (the
// panel's order): the level knobs, the tunings (the name plates), the decays
// (the voices' pictures); and the master. A row is what a hand rides while a
// pattern plays: every level, every decay, without paging an instrument.
function row(id, label, from, y, h, suffix) {
  return { id: id, label: label, rect: [from * CW, y, 8 * CW, h], keys: VOICES.slice(from, from + 8).map(function (vo) { return vo.id + suffix; }) };
}
var SEGS = [
  row("lv1", "LEVEL 1-8", 0, 36, 22, "_level"), row("lv2", "LEVEL 9-16", 8, 36, 22, "_level"),
  row("tn1", "TUNE 1-8", 0, 22, 14, "_tune"), row("tn2", "TUNE 9-16", 8, 22, 14, "_tune"),
  row("dc1", "DECAY 1-8", 0, 59, 20, "_decay"), row("dc2", "DECAY 9-16", 8, 59, 20, "_decay"),
  { id: "master", label: "MASTER", rect: [0, 0, 960, 21], keys: ["volume", "comp", "master_drive", "master_dist", "vel_depth", "hh_choke", "note_map"] }
];
function segOf(v) {
  if (v.$segmode !== "segment") return null;
  for (var i = 0; i < SEGS.length; i++) if (SEGS[i].id === v.$segment) return SEGS[i];
  return null;
}
function ground(g, v, sel) {
  var kn = v.$knobs || [], ts = v.$tabs || [], cur = v.$tab === undefined ? -1 : v.$tab;
  g.fill(0, 0, 960, 160, PANEL);
  if (!v.$segmode) g.fill(sel * CW, 21, CW, 79, PANEL_HI); // the selected instrument's column
  g.value(10, 17, "8W8", ORANGE, -1);
  var vs = VOICES[sel];
  for (var i = 0; i < 16; i++) {
    var vo = VOICES[i], x0 = i * CW, cx = x0 + CW / 2, m = muted(v, vo.idx);
    if (i) g.fill(x0, 22, 1, 78, RULE);
    g.fill(x0 + 4, 23, CW - 8, 12, vo.alt ? PLATE2 : PLATE);
    g.text(cx, 33, vo.short, INK, 0);
    knobBody(g, cx, KY, 10);
    g.fill(x0 + 4, 59, CW - 8, 18, WIN);
    g.dot(cx, 82, 2.2, LED_OFF);
    g.fill(x0 + 5, 86, CW - 10, 12, m ? "#3b3a37" : stepColor(i));
    if (m) g.text(cx, 96, "MUTE", MUTED_TX, 0);
    if (i === sel && !v.$segmode) { g.fill(x0 + 5, 86, CW - 10, 2, "slot"); g.fill(x0 + 5, 96, CW - 10, 2, "slot"); g.fill(x0 + 5, 86, 2, 12, "slot"); g.fill(x0 + CW - 7, 86, 2, 12, "slot"); }
  }
  // the scope: the selected instrument, large
  g.fill(WALL, 21, 960 - WALL, 79, CASE);
  g.text(SX, 33, vs.name, LEGEND, -1, SW - 30);
  g.dot(SX + SW - 6, 29, 3, LED_OFF);
  g.fill(SX, 38, SW, 40, WIN);
  // the deck: the encoders' names and bodies, the lower buttons
  g.fill(0, 100, 960, 60, CASE);
  g.fill(0, 100, 960, 1, "#9a978f");
  for (var c = 0; c < 8; c++) {
    var k = kn[c], x = c * 120;
    if (c) g.fill(x, 108, 1, 30, "#34363c");
    if (k && v[k]) knobBody(g, x + 24, EY, 10.5);
    var s = v.$segmode ? "" : (ts[c] || ""), y = 145; // while the segments are on, the bottom strip is Pung's
    if (s === "<" || s === ">") {
      var ax = x + 60, d = s === "<" ? -1 : 1;
      g.poly([ax - 4 * d, y + 2, ax + 4 * d, y + 7, ax - 4 * d, y + 12], 2, ORANGE);
    } else if (s) {
      g.fill(x + 10, y, 100, 13, c === cur ? ORANGE : "#2c2e34");
      g.text(x + 60, y + 10, up(s), c === cur ? INK : "#b8b4aa", 0, 92);
    }
  }
}
function panel(g, v) {
  var sel = selected(v), t = v.$touched || "", h = hits(v), kn = v.$knobs || [];
  // the kept layer does not change with the segment: moving between segments costs a frame like any other
  g.layer(["8w8", sel, rawInt(v, "mutes", 0), kn.map(function (k) { return k && v[k] ? 1 : 0; }).join(""), (v.$tabs || []).join(","), v.$tab, v.$segmode].join("|"),
    function () { ground(g, v, sel); });
  var sg = segOf(v), vs0 = VOICES[sel], hd = sg ? "SEGMENT" : "INSTRUMENT " + (sel + 1) + "/16", nm = sg ? sg.label : vs0.name;
  // after the name, clear of the upper buttons' labels Pung shows over the right (SEGMENTS, EXIT)
  // the segment the encoders play: its name lit (Pung's bar stands over its row)
  g.text(64, 15, nm, sg ? "slot" : LEGEND, -1);
  g.text(64 + g.measure(nm) + 12, 15, hd, MUTED_TX, -1);
  for (var i = 0; i < 16; i++) {
    var vo = VOICES[i], x0 = i * CW, cx = x0 + CW / 2, m = muted(v, vo.idx);
    var lit = h[vo.idx] !== undefined && h[vo.idx] < LIT, lk = vo.id + "_level";
    if (t === lk) { g.arc(cx, KY, 13, 0, Math.PI * 2, 2.5, "slot"); }
    if (known(v, lk)) pointer(g, cx, KY, 10, v[lk].frac);
    var touchV = t.indexOf(vo.id + "_") === 0 && t !== lk;
    var s = voiceShape(vo.kind, voiceParams(v, vo), x0 + 6, 60, CW - 12, 16);
    g.poly(s.wave, 1, m ? "#5a5852" : (lit ? "#ffffff" : (touchV ? "slot" : WAVE)));
    if (lit) g.dot(cx, 82, 2.4, LED);
  }
  // the selected instrument: its sound large, its tuning
  var vs = VOICES[sel], m2 = muted(v, vs.idx), lit2 = h[vs.idx] !== undefined && h[vs.idx] < LIT;
  if (lit2) g.dot(SX + SW - 6, 29, 3, LED);
  var shape = t === vs.id + "_decay" || t === "bd_attack" || t === "ma_attack";
  var tnT = t === vs.id + "_tune" || t === "bd_tone" || t === "sd_snappy" || t === vs.id + "_drive" || t === vs.id + "_dist_type";
  drawVoice(g, v, vs, SX + 3, 40, SW - 6, 36, m2 ? "#5a5852" : (lit2 ? "#ffffff" : (tnT ? "slot" : WAVE)), m2 ? "#26252a" : "#3b3934",
    shape ? "slot" : null, 1.4);
  if (m2) g.text(SX + SW - 4, 50, "MUTED", LED, 1);
  g.text(SX, 92, tuneText(v, vs), t === vs.id + "_tune" ? "slot" : MUTED_TX, -1, SW - 50);
  if (frac(v, vs.id + "_drive", 0) > 0.02) g.text(SX + SW, 92, up(disp(v, vs.id + "_dist_type")), ORANGE, 1, 46);
  // the encoders: the pointer, the name, the value; the touched one in the slot's colour
  for (var c = 0; c < 8; c++) {
    var k = kn[c], x = c * 120;
    if (!k || !v[k]) continue;
    var hot = k === t;
    g.text(x + 60, 114, v.$segmode === "segment" ? up(v[k].name).replace("DISTORTION", "DIST") : stripName(v[k].name), hot ? "slot" : "#c9c5ba", 0, 112);
    if (hot) g.arc(x + 24, EY, 14, 0, Math.PI * 2, 2.5, "slot");
    if (known(v, k)) pointer(g, x + 24, EY, 10.5, v[k].frac);
    valUnit(g, x + 43, 137, v, k, hot ? "slot" : LEGEND, hot ? "slot" : "#c9c5ba");
  }
}
// Pung's default pages in the 808's colours: its grey panel, cream legends, orange knobs
push.theme({ ground: PANEL, ink: LEGEND, dim: MUTED_TX, rule: RULE, panel: KNOB, accent: PLATE, knob: "pointer" });
push.compartment({
  id: "kit", label: "Kit", front_panel: true, draws_tabs: true, segments: SEGS, draws_segments: true,
  pages: VOICES.map(function (vo) { return { label: vo.short, keys: vo.keys }; }),
  extra_keys: ["mutes", "note_map"],
  screen: panel
});

// ---- SENDS: the two buses ------------------------------------------------------------------
var SENDERS = VOICES.filter(function (vo) { return vo.id !== "bd"; }); // the kick has no sends
var DIVS = { "1/32": 0.125, "1/16T": 1 / 6, "1/16": 0.25, "1/8T": 1 / 3, "1/16.": 0.375, "1/8": 0.5, "1/4T": 2 / 3, "1/8.": 0.75,
  "1/4": 1, "1/2T": 4 / 3, "1/4.": 1.5, "1/2": 2, "1/2.": 3 };
function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? "0" : "") + n.toString(16); }
function shade(f) { return "#" + hex2(240 * f) + hex2(238 * f) + hex2(232 * f); }
function hpfHz(v, k) { return known(v, k) ? Math.round(30 * Math.pow(800 / 30, v[k].frac)) + " HZ" : "--"; }
function edge(g) { g.fill(0, 0, 3, g.h, ORANGE); }
function hdr(g, x, s, lit) { g.text(x, 11, s, lit ? "fg" : "dim", -1); }
// every instrument's send into a bus, a bar each, in the step row's colours
function sends(g, v, x, w, suffix, t) {
  var cw = w / SENDERS.length, h = hits(v);
  for (var i = 0; i < SENDERS.length; i++) {
    var vo = SENDERS[i], cx = x + cw * i + cw / 2, k = vo.id + suffix, f = frac(v, k, 0), lit = h[vo.idx] !== undefined && h[vo.idx] < LIT;
    g.text(cx, 84, vo.short, lit ? "fg" : "dim", 0);
    g.fill(cx - 7, 20, 14, 54, "#1c1c1c");
    g.fill(cx - 7, 72, 14, 2, stepColor(i + 1));
    if (f > 0) g.fill(cx - 7, 74 - f * 54, 14, f * 54, t === k ? "slot" : "fg");
  }
}
function reverbScreen(g, v) {
  var t = v.$touched || "", w = 466, x = 12, base = 76, top = 18;
  edge(g);
  var dec = frac(v, "rev_decay"), tone = frac(v, "rev_tone"), lvl = frac(v, "rev_level");
  var hot = t === "rev_decay" || t === "rev_tone" || t === "rev_level";
  hdr(g, x, "REVERB TAIL", t.indexOf("rev_") === 0);
  g.text(x + w - 8, 11, "LOW CUT " + hpfHz(v, "rev_hpf"), t === "rev_hpf" ? "slot" : "dim", 1);
  var len = lerp(0.1, 1, dec) * (w - 20);
  var pts = cached(["rv", dec.toFixed(2), tone.toFixed(2), lvl.toFixed(2)].join("|"), function () {
    var out = [], hold = Math.round(lerp(6, 1, tone));
    for (var px = 0; px <= w - 20; px += 1) {
      var e = px > len ? 0 : Math.pow(1 - px / len, 2.2) * (0.25 + 0.75 * lvl);
      out.push(x + 14 + px, base - e * (base - top) * (0.6 + 0.4 * Math.abs(nz(Math.floor(px / hold) + 11))));
    }
    return out;
  });
  g.fill(x, top, 4, base - top, "dim");
  g.area(pts, base, hot ? "#4a3a2a" : "#2e2e2e");
  g.poly(pts, 1, hot ? "slot" : "fg");
  g.fill(x, base, w - 6, 1, "line");
  g.text(x + w - 8, 30, tone < 0.35 ? "DARK" : (tone > 0.7 ? "BRIGHT" : ""), "faint", 1);
  g.fill(482, 4, 1, 80, "line");
  hdr(g, 494, "WHAT EACH INSTRUMENT SENDS IN", t.indexOf("_rev") > 0);
  sends(g, v, 490, 460, "_rev", t);
}
function delayScreen(g, v) {
  var t = v.$touched || "", w = 588, x = 12, base = 76, top = 18;
  edge(g);
  var div = disp(v, "dly_time"), beats = DIVS[div] || 0.75, fb = frac(v, "dly_fdbk"), tone = frac(v, "dly_tone"), lvl = frac(v, "dly_level");
  var L = v.$live, bpm = L && L.known && L.bpm > 0 ? L.bpm : 0;
  hdr(g, x, "ECHOES  " + (div || "--") + (bpm ? "  =  " + Math.round(beats * 60000 / bpm) + " MS AT " + Math.round(bpm) + " BPM" : ""), t.indexOf("dly_") === 0);
  g.text(x + w - 8, 11, "LOW CUT " + hpfHz(v, "dly_hpf"), t === "dly_hpf" ? "slot" : "dim", 1);
  var span = 4, pw = w - 20;
  for (var b = 0; b <= span; b++) g.fill(x + pw * b / span, top, 1, base - top, b % 4 === 0 ? "line" : "faint");
  g.fill(x, top, 4, base - top, "dim");
  var a = 1, n = 0, hot = t === "dly_time" || t === "dly_fdbk" || t === "dly_level" || t === "dly_tone";
  for (var tb = beats; tb <= span + 0.001 && n < 40; tb += beats, n++) {
    a = n === 0 ? lvl : a * fb;
    if (a < 0.02) break;
    var px = x + pw * tb / span, hh = a * (base - top);
    g.fill(px - 2, base - hh, 4, hh, hot ? "slot" : shade(Math.max(0.25, 1 - n * (1 - tone) * 0.18)));
  }
  g.fill(x, base, w - 6, 1, "line");
  g.fill(606, 4, 1, 80, "line");
  hdr(g, 618, "SENDS", t.indexOf("_dly") > 0);
  sends(g, v, 612, 340, "_dly", t);
}
var REV_SENDS = SENDERS.map(function (vo) { return vo.id + "_rev"; }), DLY_SENDS = SENDERS.map(function (vo) { return vo.id + "_dly"; });
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

// ---- MASTER: the bus, velocity, the notes ---------------------------------------------------
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(n) { return NOTE[n % 12] + (Math.floor(n / 12) - 2); }
var BY_IDX = []; VOICES.forEach(function (vo) { BY_IDX[vo.idx] = vo; });
var GM_FIRST = {}; Object.keys(GM).forEach(function (n) { var i = GM[n]; if (GM_FIRST[i] === undefined || +n < GM_FIRST[i]) GM_FIRST[i] = +n; });
push.compartment({
  id: "master", label: "Master",
  pages: [{ label: "Master", keys: ["volume", "comp", "master_drive", "master_dist", "vel_depth", "note_map"] }],
  extra_keys: ["mutes"],
  screen: function (g, v) {
    var t = v.$touched || "", h = hits(v);
    edge(g);
    hdr(g, 12, "THE KIT'S BUS", t === "master_dist" || t === "master_drive" || t === "comp" || t === "volume");
    var dOn = rawInt(v, "master_dist", 0) > 0 && frac(v, "master_drive", 0) > 0, cOn = frac(v, "comp", 0) > 0;
    var stages = [["KIT", "+ SENDS", true, ""],
      [dOn ? up(disp(v, "master_dist")) : "DIST", dOn ? "DRIVE " + disp(v, "master_drive") : "OFF", dOn, "master_dist|master_drive"],
      ["COMP", cOn ? disp(v, "comp") : "OFF", cOn, "comp"],
      ["VOLUME", disp(v, "volume") || "--", true, "volume"]];
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i], x = 12 + i * 96, hot = s[3] && s[3].split("|").indexOf(t) >= 0;
      g.fill(x, 22, 82, 42, hot ? "#3a3a3a" : "#1c1c1c");
      g.fill(x, 22, 82, 2, hot ? "slot" : (s[2] ? ORANGE : "#3a3a3a"));
      g.text(x + 7, 38, s[0], hot ? "slot" : (s[2] ? "fg" : "dim"), -1, 70);
      g.value(x + 7, 58, s[1], hot ? "slot" : (s[2] ? "fg" : "faint"), -1, 70);
      if (i < 3) g.poly([x + 84, 43, x + 94, 43], 2, "line");
    }
    var vx = 410, vw = 150, vd = frac(v, "vel_depth", 1);
    hdr(g, vx, "VELOCITY", t === "vel_depth");
    g.fill(vx, 74, vw, 1, "line");
    g.text(vx, 84, "SOFT", "faint", -1); g.text(vx + vw, 84, "HARD", "faint", 1);
    g.area([vx, 72 - (1 - vd) * 50, vx + vw, 22], 74, t === "vel_depth" ? "#4a3a2a" : "#262626");
    g.poly([vx, 72 - (1 - vd) * 50, vx + vw, 22], 2, t === "vel_depth" ? "slot" : "fg");
    // the notes, as a drum rack lays out sixteen pads
    var nx = 584, gm = isGM(v);
    hdr(g, nx, gm ? "GENERAL MIDI NOTES" : "DRUM RACK NOTES", t === "note_map");
    for (var j = 0; j < 16; j++) {
      var vo = BY_IDX[j], col = j % 4, row = 3 - Math.floor(j / 4), cx = nx + col * 92, cy = 16 + row * 17;
      var lit = h[j] !== undefined && h[j] < LIT, mm = muted(v, j);
      g.fill(cx, cy, 88, 15, lit ? LEGEND : "#1c1c1c");
      g.fill(cx, cy, 3, 15, stepColor(VOICES.indexOf(vo)));
      g.text(cx + 8, cy + 11, vo.short, lit ? INK : (mm ? LED : "fg"), -1);
      g.text(cx + 84, cy + 11, gm ? noteName(GM_FIRST[j]) : noteName(36 + j), lit ? INK : (t === "note_map" ? "slot" : "dim"), 1);
    }
  }
});
