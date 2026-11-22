// 6W6 (a TR-606-style drum machine, every voice synthesized) on Push.
//
// The 606 is a small silver box: a row of instruments, each with its level
// knob, and an instrument selector. Here the whole Push screen is that box:
//
//   KIT     (front panel) the eight instruments side by side, in the 606's
//           order, each over its own lower button: its name, a red LED that
//           lights as it is hit, the voice drawn as it sounds (a kick's pitch
//           falling into its body, a snare's shell under its wires, a hat's
//           decay), and its level knob. The selected instrument is the page:
//           the encoders edit it, the lower buttons select another.
//   SENDS   both buses at once: the reverb's tail, the delay's echoes on the
//           beat, and how much each instrument sends to each
//   MASTER  the kit's bus as a path (distortion, compressor, volume), what
//           velocity does to a hit, and which note plays which instrument
//
// Each voice's picture is the voice's own shape, drawn from its knobs; its
// time axis is the voice's own (a knob's travel spans the window), not
// seconds. Pung's envelope is not used: these are one-shot drums whose
// decays are part of the sound, not envelopes a note holds.

var SILVER = "#d4d4cf", SILVER_DK = "#b4b4ae", SILVER_LT = "#ecece8", STRIP = "#161616", INK = "#111111";
var RED = "#e0261c", LED_OFF = "#4a1210", GREY = "#77776f", WIN = "#0d0d0d", SIL_FILL = "#2c2c2a", WAVE = "#e9e9e4";
var KEY = "#c8c8c2";

// ---- values ------------------------------------------------------------------------------
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

// How its values read everywhere Pung writes one: the metal's and the shells'
// tune as the ratio the module turns it into (0.5 to 2), the buses' high-pass
// in Hz (the module's own table). The rest are the 606's pots.
push.display(function (key, raw) {
  var n = parseFloat(raw);
  if (isNaN(n)) return;
  var f = Math.max(0, Math.min(127, n)) / 127;
  if (key === "rev_hpf" || key === "dly_hpf") return { value: String(Math.round(30 * Math.pow(800 / 30, f))), unit: "Hz" };
  if (/^(sd|lt|ht|ch|oh|cy|cp)_tune$/.test(key)) return "x" + (0.5 * Math.pow(4, f)).toFixed(2);
});

// a value and its unit, the unit in the label face after it
function valUnit(g, x, y, v, k, c, uc) {
  var val = known(v, k) ? (disp(v, k) || "--") : "--", u = known(v, k) && v[k].unit ? String(v[k].unit) : "";
  var uw = u ? g.measure(u) + 3 : 0;
  g.value(x, y, val, c, -1, 74 - uw);
  if (u) g.text(x + Math.min(g.measure(val, "value"), 74 - uw) + 3, y, up(u), uc, -1);
}

// ---- the kit ------------------------------------------------------------------------------
// id, the panel's name, its picture, its knobs (in the order the encoders take them)
var VOICES = [
  { id: "bd", name: "BASS DRUM", short: "BD", kind: "kick", keys: ["bd_level", "bd_tune", "bd_decay", "bd_attack", "bd_drive", "bd_dist_type"] },
  { id: "sd", name: "SNARE", short: "SD", kind: "snare", keys: ["sd_level", "sd_tune", "sd_decay", "sd_snappy", "sd_tone", "sd_drive", "sd_dist_type"] },
  { id: "lt", name: "LOW TOM", short: "LT", kind: "ltom", keys: ["lt_level", "lt_tune", "lt_decay", "lt_drive", "lt_dist_type"] },
  { id: "ht", name: "HI TOM", short: "HT", kind: "htom", keys: ["ht_level", "ht_tune", "ht_decay", "ht_drive", "ht_dist_type"] },
  { id: "ch", name: "CLOSED HAT", short: "CH", kind: "chat", keys: ["ch_level", "ch_tune", "ch_decay", "ch_drive", "ch_dist_type"] },
  { id: "oh", name: "OPEN HAT", short: "OH", kind: "ohat", keys: ["oh_level", "oh_tune", "oh_decay", "hh_choke", "oh_drive", "oh_dist_type"] },
  { id: "cy", name: "CYMBAL", short: "CY", kind: "cym", keys: ["cy_level", "cy_tune", "cy_decay", "cy_drive", "cy_dist_type"] },
  { id: "cp", name: "HAND CLAP", short: "CP", kind: "clap", keys: ["cp_level", "cp_tune", "cp_decay", "cp_noise", "cp_drive", "cp_dist_type"] }
];
var ALL_VOICE_KEYS = [];
VOICES.forEach(function (vo) { ALL_VOICE_KEYS = ALL_VOICE_KEYS.concat(vo.keys); });

// which note plays which instrument (the module's own maps)
var GM = { 35: 0, 36: 0, 38: 1, 40: 1, 41: 2, 45: 2, 48: 3, 50: 3, 42: 4, 44: 4, 46: 5, 49: 6, 51: 6, 57: 6, 39: 7 };
function voiceOf(note, gm) {
  if (gm) return GM[note] === undefined ? -1 : GM[note];
  return note >= 36 && note <= 43 ? note - 36 : -1;
}
function isGM(v) { return rawInt(v, "note_map", 0) === 1; }
// the instruments just hit: index -> seconds since
function hits(v) {
  var L = v.$live, out = {}, gm = isGM(v);
  if (!L || !L.known || !L.voices) return out;
  for (var i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], vi = voiceOf(n.note, gm);
    if (vi >= 0 && (out[vi] === undefined || n.age < out[vi])) out[vi] = n.age;
  }
  return out;
}
var LIT = 0.13; // an LED stays lit this long after a hit, as a trigger LED does
function muted(v, i) { return (rawInt(v, "mutes", 0) >> i) & 1; }

// ---- a voice, drawn as it sounds -----------------------------------------------------------
// Each kind: its envelope over the window (0..1), and its signal under it.
// p: the voice's knobs as 0..1 (tune, decay, and its own: attack, snappy, tone, noise).
function nz(i) { var s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }
function lerp(a, b, f) { return a + (b - a) * f; }
function voiceFn(kind, p) {
  var tau, c0;
  switch (kind) {
  case "kick": // a sine that falls into its body; attack is the click on top
    tau = lerp(0.05, 0.42, p.decay); c0 = lerp(2.6, 5.2, p.tune);
    return {
      env: function (t) { return Math.exp(-t / tau); },
      sig: function (t) {
        var ph = c0 * (t + 2.4 * 0.05 * (1 - Math.exp(-t / 0.05)));
        var click = t < 0.03 ? p.attack * (1 - t / 0.03) * 0.5 : 0;
        return Math.min(1, Math.max(-1, Math.sin(ph * 2 * Math.PI) * Math.exp(-t / tau) + click));
      }
    };
  case "snare": // a tuned shell under the wires: snappy is how much wire, tone its colour
    tau = lerp(0.04, 0.5, p.decay); c0 = lerp(7, 12, p.tune);
    var hold = Math.round(lerp(4, 1, p.tone));
    return {
      env: function (t) { return Math.exp(-t / tau); },
      sig: function (t, px) {
        var body = Math.sin(c0 * t * 2 * Math.PI) * Math.exp(-t / (tau * 0.45)) * (1 - 0.6 * p.snappy);
        var wire = nz(Math.floor(px / hold)) * Math.exp(-t / tau) * (0.25 + 0.75 * p.snappy);
        return Math.max(-1, Math.min(1, body + wire * 0.8));
      }
    };
  case "ltom": case "htom": // the main mode, falling a little into its pitch
    tau = lerp(0.05, 0.55, p.decay); c0 = lerp(kind === "ltom" ? 4 : 7, kind === "ltom" ? 8 : 12, p.tune);
    return {
      env: function (t) { return Math.exp(-t / tau); },
      sig: function (t) { var ph = c0 * (t + 0.35 * 0.08 * (1 - Math.exp(-t / 0.08))); return Math.sin(ph * 2 * Math.PI) * Math.exp(-t / tau); }
    };
  case "chat": case "ohat": case "cym": // the metal: dense partials (tune) under their envelope
    tau = kind === "chat" ? lerp(0.02, 0.22, p.decay) : lerp(0.06, 0.6, p.decay);
    // six square partials, as the metal circuit has them: dense, and higher with the tune
    var fr = [1, 1.47, 1.71, 2.13, 2.59, 3.07], sc = lerp(9, 17, p.tune) * (kind === "cym" ? 0.7 : 1);
    return {
      env: function (t) { return Math.exp(-t / tau); },
      sig: function (t) {
        var s = 0;
        for (var i = 0; i < 6; i++) s += Math.sin(t * sc * fr[i] * 2 * Math.PI * 3.1 + i) > 0 ? 1 : -1;
        return s / 6 * 1.6 * Math.exp(-t / tau);
      }
    };
  case "clap": // four timed bursts, then the diffuse tail (noise: how much of it)
    tau = lerp(0.04, 0.45, p.decay);
    var gap = lerp(0.045, 0.03, p.tune);
    var burst = function (t) {
      var e = 0;
      for (var b = 0; b < 3; b++) { var dt = t - b * gap; if (dt >= 0 && dt < gap) e = Math.max(e, Math.exp(-dt / 0.012)); }
      var tt = t - 3 * gap;
      if (tt >= 0) e = Math.max(e, Math.exp(-tt / tau) * (0.55 + 0.45 * p.noise));
      return e;
    };
    return { env: burst, sig: function (t, px) { return nz(px + 3) * burst(t); } };
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
// the wave and its silhouette, in the box (x, y, w, h)
function voiceShape(kind, p, x, y, w, h) {
  var key = [kind, x, y, w, h, p.tune.toFixed(2), p.decay.toFixed(2), (p.attack || 0).toFixed(2), (p.snappy || 0).toFixed(2),
    (p.tone || 0).toFixed(2), (p.noise || 0).toFixed(2), (p.drive || 0).toFixed(2)].join("|");
  return cached(key, function () {
    var f = voiceFn(kind, p), mid = y + h / 2, a = h / 2 - 1, wave = [], top = [], bot = [];
    // drive: the wave pushed into its distortion, flattening its peaks
    var k = 1 + (p.drive || 0) * 7, norm = Math.tanh(k);
    for (var px = 0; px <= w; px += 1) {
      var t = px / w, e = Math.min(1, f.env(t)), sv = f.sig(t, px);
      if (p.drive > 0.02) sv = Math.tanh(sv * k) / norm;
      wave.push(x + px, mid - sv * a);
      if (p.drive > 0.02) e = Math.tanh(e * k) / norm;
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
  var id = vo.id;
  return { tune: frac(v, id + "_tune"), decay: frac(v, id + "_decay"), attack: frac(v, "bd_attack", 0.9), snappy: frac(v, "sd_snappy"),
    tone: frac(v, "sd_tone"), noise: frac(v, "cp_noise"), drive: frac(v, id + "_drive", 0) };
}
function drawVoice(g, v, vo, x, y, w, h, waveC, fillC, edgeC) {
  var s = voiceShape(vo.kind, voiceParams(v, vo), x, y, w, h);
  g.area(s.top, s.mid, fillC);
  g.area(s.bot, s.mid, fillC);
  if (edgeC) { g.poly(s.top, 1, edgeC); g.poly(s.bot, 1, edgeC); }
  g.poly(s.wave, 1.4, waveC);
}

// ---- the panel -----------------------------------------------------------------------------
// What never changes while the page and the lower buttons stay (the panel,
// the names, the knobs' caps, the keys) is drawn once into the kept layer; a
// frame draws only pointers, values, waves and lit LEDs.
function cap(g, cx, cy, r) { g.dot(cx, cy, r + 1, "#5c5c58"); g.dot(cx, cy, r, SILVER_LT); }
function knob(g, cx, cy, r, f, c) { // a 606 knob's black line, where it stands (its cap is in the layer)
  if (f === null) return;
  var a = Math.PI * (0.75 + 1.5 * f);
  g.line(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, c || INK);
}
function selected(v) { var p = v.$page || 0; return p >= 0 && p < VOICES.length ? p : 0; }
function stripName(name) { return up(String(name || "").replace(/^[A-Z]{2} /, "")).replace("DISTORTION", "DIST TYPE"); }

// Segments: what the hand reaches across the kit, where the 606 has it. The
// level knobs' row; the tunes and decays of the drums and of the metal (each
// instrument's tune on the encoder under its own column); the master.
var SEGS = [
  { id: "levels", label: "LEVELS", rect: [0, 80, 960, 20], keys: VOICES.map(function (vo) { return vo.id + "_level"; }) },
  { id: "drums", label: "BD SD TOM", rect: [0, 22, 480, 58], keys: ["bd_tune", "sd_tune", "lt_tune", "ht_tune", "bd_decay", "sd_decay", "lt_decay", "ht_decay"] },
  { id: "metal", label: "HAT CY CP", rect: [480, 22, 480, 58], keys: ["ch_decay", "oh_decay", "cy_decay", "cp_decay", "ch_tune", "oh_tune", "cy_tune", "cp_tune"] },
  { id: "master", label: "MASTER", rect: [0, 0, 960, 21], keys: ["volume", "comp", "master_drive", "master_dist", "vel_depth", "hh_choke", "note_map"] }
];
function segOf(v) {
  if (v.$segmode !== "segment") return null;
  for (var i = 0; i < SEGS.length; i++) if (SEGS[i].id === v.$segment) return SEGS[i];
  return null;
}
function ground(g, v, sel) {
  var kn = v.$knobs || [], sg = segOf(v);
  g.fill(0, 0, 960, 160, SILVER);
  // the part the encoders play: the selected instrument's column (a segment:
  // Pung's bar over it, its name lit in the header)
  if (!sg) g.fill(sel * 120 + 1, 22, 119, 78, "#e7e7e2");
  g.value(10, 17, "6W6", INK, -1);
  g.fill(0, 21, 960, 1, SILVER_DK);
  for (var i = 0; i < 8; i++) {
    var x0 = i * 120;
    if (i) g.fill(x0, 22, 1, 78, SILVER_DK);
    g.fill(x0 + 7, 37, 106, 40, WIN);
    g.text(x0 + 33, 94, "LEVEL", GREY, -1);
    g.dot(x0 + 14, 30, 3.2, LED_OFF);
    g.text(x0 + 22, 34, VOICES[i].name, i === sel && !sg ? INK : GREY, -1, 92);
    cap(g, x0 + 20, 90, 8);
  }
  var vs = VOICES[sel], hd = sg ? "SEGMENT" : "INSTRUMENT " + (sel + 1) + "/" + VOICES.length;
  // after the name, clear of the upper buttons' labels Pung shows over the right (SEGMENTS, EXIT)
  var nm = sg ? sg.label : vs.name;
  g.text(64, 15, nm, sg ? "slot" : INK, -1);
  g.text(64 + g.measure(nm) + 12, 15, hd, GREY, -1);
  // the lower deck: black, the encoders and the keys
  g.fill(0, 100, 960, 60, STRIP);
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, 108, 1, 30, "#2e2e2c");
    if (kn[c] && v[kn[c]]) cap(g, c * 120 + 24, 130, 10);
  }
  if (!v.$segmode) keys(g, v); // while the segments are on, the bottom strip is Pung's
}
function panel(g, v) {
  var sel = selected(v), t = v.$touched || "", h = hits(v), kn = v.$knobs || [];
  g.layer(["6w6", sel, kn.join(","), (v.$tabs || []).join(","), v.$tab, v.$segmode, v.$segment].join("|"), function () { ground(g, v, sel); });
  var sg = segOf(v);
  for (var i = 0; i < 8; i++) {
    var vo = VOICES[i], x0 = i * 120, on = i === sel, m = muted(v, i);
    var lit = h[i] !== undefined && h[i] < LIT;
    // the LED and the name
    if (lit) g.dot(x0 + 14, 30, 3.2, RED);
    // the voice: its own picture, in its black window
    var touchV = t.indexOf(vo.id + "_") === 0 || (vo.id === "oh" && t === "hh_choke");
    var shape = t === vo.id + "_decay" || t === vo.id + "_attack" || t === vo.id + "_noise";
    drawVoice(g, v, vo, x0 + 10, 39, 100, 36, m ? "#5a5a56" : (lit ? "#ffffff" : (touchV && !shape && t !== vo.id + "_level" ? "slot" : WAVE)),
      m ? "#1c1c1b" : (lit ? "#4a4a46" : SIL_FILL), shape ? "slot" : null);
    if (on && !sg && !v.$segmode) g.fill(x0 + 7, 77, 106, 2, "slot");
    if (m) { g.fill(x0 + 74, 40, 36, 11, RED); g.text(x0 + 92, 49, "MUTE", "#ffffff", 0); }
    // its level knob, as on the 606; its distortion, where it is driven
    var lk = vo.id + "_level";
    knob(g, x0 + 20, 90, 8, known(v, lk) ? v[lk].frac : null, t === lk ? "slot" : INK);
    g.text(x0 + 73, 94, disp(v, lk) || "--", t === lk ? "slot" : INK, -1);
    var dr = frac(v, vo.id + "_drive", 0);
    if (dr > 0.07) g.text(x0 + 113, 94, up(disp(v, vo.id + "_dist_type")), RED, 1, 30);
  }
  encoderRow(g, v);
}
// the encoders: on the black deck, a silver knob each, the name over it, the value beside
function encoderRow(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t;
    // in a segment the keys come from several instruments: the full name
    g.text(x0 + 60, 114, v.$segmode === "segment" ? up(v[k].name).replace("DISTORTION", "DIST") : stripName(v[k].name), hot ? "slot" : "#a9a9a3", 0, 112);
    if (hot) g.arc(x0 + 24, 130, 13.5, 0, Math.PI * 2, 2.5, "slot");
    knob(g, x0 + 24, 130, 10, known(v, k) ? v[k].frac : null, INK);
    valUnit(g, x0 + 42, 137, v, k, hot ? "slot" : "#f2f2ee", hot ? "slot" : "#a9a9a3");
  }
}
// the lower buttons: the 606's keys, each named as Pung maps it, the lit one's LED red
function keys(g, v) {
  var ts = v.$tabs || [], cur = v.$tab === undefined ? -1 : v.$tab;
  for (var i = 0; i < 8; i++) {
    var s = ts[i] || "", x0 = i * 120, y = 145;
    if (s === "<" || s === ">") {
      var cx = x0 + 60, d = s === "<" ? -1 : 1;
      g.poly([cx - 4 * d, y + 2, cx + 4 * d, y + 7, cx - 4 * d, y + 12], 2, KEY);
      continue;
    }
    if (!s) continue;
    var lit = i === cur;
    g.fill(x0 + 10, y, 100, 13, lit ? SILVER_LT : "#3a3a38");
    g.dot(x0 + 20, y + 6.5, 2.6, lit ? RED : LED_OFF);
    g.text(x0 + 64, y + 10, up(s), lit ? INK : "#bdbdb7", 0, 80);
  }
}
// Pung's default pages as the 606's knob row: its dark strip, white knobs, silver print, red LEDs
push.theme({ ground: STRIP, ink: SILVER_LT, dim: GREY, faint: "#4a4a46", rule: GREY, panel: SILVER_LT, accent: RED, knob: "pointer" });
push.compartment({
  id: "kit", label: "Kit", front_panel: true, draws_tabs: true, segments: SEGS, draws_segments: true,
  pages: VOICES.map(function (vo) { return { label: vo.short, keys: vo.keys }; }),
  extra_keys: ["mutes", "note_map"],
  screen: panel
});

// ---- SENDS: the two buses ------------------------------------------------------------------
// Every instrument feeds both buses, after its level. The Reverb page: the
// tail (how long, how dark, how loud) and what each instrument sends into it.
// The Delay page: the echoes on the beat (the division, what feedback leaves
// of each repeat, darker by the tone) and the sends. The sends' own pages are
// plain knobs, one instrument an encoder.
var DIVS = { "1/32": 0.125, "1/16T": 1 / 6, "1/16": 0.25, "1/8T": 1 / 3, "1/16.": 0.375, "1/8": 0.5, "1/4T": 2 / 3, "1/8.": 0.75,
  "1/4": 1, "1/2T": 4 / 3, "1/4.": 1.5, "1/2": 2, "1/2.": 3 };
function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? "0" : "") + n.toString(16); }
function shade(f) { var c = 230 * f; return "#" + hex2(c) + hex2(c) + hex2(c * 0.97); } // a grey, f of the way to white
// the buses' high-pass, in Hz (the module's own table: 30 to 800 Hz, exponential)
function hpfHz(v, k) { return known(v, k) ? Math.round(30 * Math.pow(800 / 30, v[k].frac)) + " HZ" : "--"; }
function edge(g) { g.fill(0, 0, 3, g.h, SILVER); }
function hdr(g, x, s, lit) { g.text(x, 11, s, lit ? "fg" : "dim", -1); }
function sends(g, v, x, w, suffix, t) {
  var cw = w / 8, h = hits(v);
  for (var i = 0; i < 8; i++) {
    var vo = VOICES[i], cx = x + cw * i + cw / 2, k = vo.id + suffix, f = frac(v, k, 0), lit = h[i] !== undefined && h[i] < LIT;
    g.text(cx, 82, vo.short, lit ? "fg" : "dim", 0);
    g.fill(cx - 6, 20, 12, 52, SIL_FILL);
    if (f > 0) g.fill(cx - 6, 72 - f * 52, 12, f * 52, t === k ? "slot" : "fg");
    else g.fill(cx - 6, 71, 12, 1, "faint");
  }
}
function reverbScreen(g, v) {
  var t = v.$touched || "", w = 466, x = 12, base = 76, top = 18;
  edge(g);
  var dec = frac(v, "rev_decay"), tone = frac(v, "rev_tone"), lvl = frac(v, "rev_level");
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
  g.fill(x, top, 4, base - top, "dim"); // the hit
  g.area(pts, base, t === "rev_decay" || t === "rev_tone" || t === "rev_level" ? "#4a3a2a" : "#2e2e2e");
  g.poly(pts, 1, t === "rev_decay" || t === "rev_tone" || t === "rev_level" ? "slot" : "fg");
  g.fill(x, base, w - 6, 1, "line");
  g.text(x + w - 8, 30, tone < 0.35 ? "DARK" : (tone > 0.7 ? "BRIGHT" : ""), "faint", 1);
  g.fill(482, 4, 1, 80, "line");
  hdr(g, 496, "WHAT EACH INSTRUMENT SENDS IN", t.indexOf("_rev") > 0);
  sends(g, v, 492, 456, "_rev", t);
}
function delayScreen(g, v) {
  var t = v.$touched || "", w = 588, x = 12, base = 76, top = 18;
  edge(g);
  var div = disp(v, "dly_time"), beats = DIVS[div] || 0.75, fb = frac(v, "dly_fdbk"), tone = frac(v, "dly_tone"), lvl = frac(v, "dly_level");
  var L = v.$live, bpm = L && L.known && L.bpm > 0 ? L.bpm : 0;
  hdr(g, x, "ECHOES  " + (div || "--") + (bpm ? "  =  " + Math.round(beats * 60000 / bpm) + " MS AT " + Math.round(bpm) + " BPM" : ""), t.indexOf("dly_") === 0);
  g.text(x + w - 8, 11, "LOW CUT " + hpfHz(v, "dly_hpf"), t === "dly_hpf" ? "slot" : "dim", 1);
  var span = 4, pw = w - 20; // one bar, its beats
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
  sends(g, v, 612, 336, "_dly", t);
}
var REV_SENDS = VOICES.map(function (vo) { return vo.id + "_rev"; }), DLY_SENDS = VOICES.map(function (vo) { return vo.id + "_dly"; });
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
var GM_NOTES = [[36, 35], [38, 40], [41, 45], [48, 50], [42, 44], [46], [49, 51, 57], [39]];
push.compartment({
  id: "master", label: "Master",
  pages: [{ label: "Master", keys: ["volume", "comp", "master_drive", "master_dist", "vel_depth", "note_map"] }],
  extra_keys: ["mutes"],
  screen: function (g, v) {
    var t = v.$touched || "", h = hits(v);
    edge(g);
    // the bus, as a path: the kit and its sends, the distortion, the compressor, the volume
    hdr(g, 12, "THE KIT'S BUS", t === "master_dist" || t === "master_drive" || t === "comp" || t === "volume");
    var dOn = rawInt(v, "master_dist", 0) > 0 && frac(v, "master_drive", 0) > 0, cOn = frac(v, "comp", 0) > 0;
    var stages = [["KIT", "+ SENDS", true, ""],
      [dOn ? up(disp(v, "master_dist")) : "DIST", dOn ? "DRIVE " + disp(v, "master_drive") : "OFF", dOn, "master_dist|master_drive"],
      ["COMP", cOn ? disp(v, "comp") : "OFF", cOn, "comp"],
      ["VOLUME", disp(v, "volume") || "--", true, "volume"]];
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i], x = 12 + i * 104, hot = s[3] && s[3].split("|").indexOf(t) >= 0;
      g.fill(x, 22, 88, 42, hot ? "#3a3a3a" : SIL_FILL);
      if (hot) g.fill(x, 22, 88, 2, "slot");
      g.text(x + 8, 38, s[0], hot ? "slot" : (s[2] ? "fg" : "dim"), -1, 76);
      g.value(x + 8, 58, s[1], hot ? "slot" : (s[2] ? "fg" : "faint"), -1, 76);
      if (i < 3) g.poly([x + 91, 43, x + 101, 43], 2, "line");
    }
    // velocity: how far a soft hit falls below a full one
    var vx = 448, vw = 190, vd = frac(v, "vel_depth", 1);
    hdr(g, vx, "VELOCITY", t === "vel_depth");
    g.fill(vx, 74, vw, 1, "line");
    g.text(vx, 84, "SOFT", "faint", -1); g.text(vx + vw, 84, "HARD", "faint", 1);
    g.text(vx + vw, 11, vd < 0.02 ? "EVERY HIT THE SAME" : "SOFT HITS FALL", "dim", 1);
    g.area([vx, 72 - (1 - vd) * 50, vx + vw, 22], 74, t === "vel_depth" ? "#4a3a2a" : "#262626");
    g.poly([vx, 72 - (1 - vd) * 50, vx + vw, 22], 2, t === "vel_depth" ? "slot" : "fg");
    // which note plays which instrument, as a drum rack lays them out
    var nx = 664, gm = isGM(v);
    hdr(g, nx, gm ? "GENERAL MIDI NOTES" : "DRUM RACK NOTES", t === "note_map");
    for (var j = 0; j < 8; j++) {
      var col = j % 4, row = 1 - Math.floor(j / 4), cx = nx + col * 71, cy = 20 + row * 33;
      var ns = gm ? GM_NOTES[j].map(noteName).join(" ") : noteName(36 + j), lit = h[j] !== undefined && h[j] < LIT;
      g.fill(cx, cy, 67, 29, lit ? "#e7e7e2" : SIL_FILL);
      g.text(cx + 6, cy + 12, VOICES[j].short + (muted(v, j) ? " MUTE" : ""), lit ? INK : (muted(v, j) ? RED : "fg"), -1);
      g.text(cx + 6, cy + 24, ns, lit ? INK : (t === "note_map" ? "slot" : "dim"), -1, 58);
    }
  }
});
