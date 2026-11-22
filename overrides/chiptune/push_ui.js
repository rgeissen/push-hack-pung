// Chiptune (two sound chips of the 8-bit era, emulated) on Push.
//
// The module is a chip: four channels with fixed voices (two pulses, a
// triangle or a 32-step wave, a noise), 4-bit volumes, registers. Its screens
// are drawn as the chip sounds, pixel for pixel: a pulse is its duty cycle at
// its 4-bit level, the triangle its 32 stairs, the wave the table the module
// loads (its own 16 bytes), the noise the chip's own shift register, long or
// short. The palette is the chip's: bright colours on night blue for the NES
// APU, the four greens of the handheld's screen for the GB APU.
//
//   PANEL     front panel: the chip, the sound, the four channels and which
//             of them the notes go to, the envelope (Pung's, on the engine's
//             times); encoder pages Play, Chip, Pitch hold every parameter
//   CHANNELS  the four channels large: the duty, the wave tables, the noise's
//             two modes, how notes are dealt to channels, unison
//   PITCH     what happens to a note's pitch: octave, the pitch drop, the
//             GB's hardware sweep, vibrato, detune
//
// Everything is from the module's DSP (chiptune_plugin.cpp): an attack of A
// takes A/60 s, a decay falls the whole way in D/15 s, a release in R/15 s;
// the pitch drop decays with a time constant of speed/60 s; vibrato is a sine
// of depth cents at rate Hz; the GB sweep adds a quarter of the frequency
// every n x 7.8 ms until it overflows and the channel stops.

function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k) { return known(v, k) ? String(v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(raw(v, k)); return isNaN(n) ? d : n; }
function hot(v, k) { return v.$touched === k; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function isGB(v) { var s = raw(v, "chip").toUpperCase(); return s === "GB" || s === "1"; }
function allocOf(v) { var s = raw(v, "alloc_mode").toLowerCase(); return s === "auto" || s === "0" ? 0 : (s === "locked" || s === "2" ? 2 : 1); }
function shortNoise(v) { var s = raw(v, "noise_mode").toLowerCase(); return s === "short" || s === "1"; }

// ---- the chip's palette --------------------------------------------------------------------
var NES = { ground: "#0b0b18", cell: "#13132a", scope: "#05050c", rule: "#2c2c52", ink: "#fcfcfc", dim: "#a8a8c8", faint: "#545478",
  ch: ["#3cbcfc", "#58d854", "#f878f8", "#f8b800"], env: "#3cbcfc", title: "#f8f8f8", ic: "#202020", pin: "#9c9c9c" };
var GBP = { ground: "#0f2a0f", cell: "#163a16", scope: "#0a200a", rule: "#306230", ink: "#c4de3c", dim: "#8bac0f", faint: "#4a7a2a",
  ch: ["#c4de3c", "#c4de3c", "#c4de3c", "#c4de3c"], env: "#8bac0f", title: "#c4de3c", ic: "#0a200a", pin: "#6a8c2a" };
function pal(v) { return isGB(v) ? GBP : NES; }

// ---- a 5x7 pixel face, for the chip's own words ----------------------------------------------
var GLYPH = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31], "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14], "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12],
  "-": [0, 0, 0, 31, 0, 0, 0], "+": [0, 4, 4, 31, 4, 4, 0], ".": [0, 0, 0, 0, 0, 12, 12], "/": [0, 1, 2, 4, 8, 16, 0],
  "%": [24, 25, 2, 4, 8, 19, 3], "&": [12, 18, 20, 8, 21, 18, 13], "'": [4, 4, 8, 0, 0, 0, 0]
};
function pixWidth(s, sc) { return s.length ? s.length * 6 * sc - sc : 0; }
// the face is drawn in runs: a row's lit pixels side by side are one rectangle
function pix(g, x, y, s, sc, color) {
  s = String(s).toUpperCase();
  for (var i = 0; i < s.length; i++) {
    var gl = GLYPH[s.charAt(i)], cx = x + i * 6 * sc;
    if (!gl) continue;
    for (var r = 0; r < 7; r++) {
      var bits = gl[r], c = 0;
      while (c < 5) {
        if (bits & (16 >> c)) {
          var c0 = c;
          while (c < 5 && (bits & (16 >> c))) c++;
          g.fill(cx + c0 * sc, y + r * sc, (c - c0) * sc, sc, color);
        } else c++;
      }
    }
  }
  return pixWidth(s, sc);
}
// words onto lines of at most `max` pixels
function wrap(s, sc, max) {
  var words = String(s).toUpperCase().split(" "), lines = [], cur = "";
  for (var i = 0; i < words.length; i++) {
    var t = cur ? cur + " " + words[i] : words[i];
    if (pixWidth(t, sc) <= max || !cur) cur = t; else { lines.push(cur); cur = words[i]; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---- the engine's numbers ------------------------------------------------------------------
var DUTY = [12.5, 25, 50, 75];
var TABLES = ["Saw", "Square", "Triangle", "Sine", "Pulse", "Bass", "Growl", "Metallic"];
// the GB wave tables, as the module writes them into wave RAM (16 bytes, 32 nibbles)
var TABLE_BYTES = [
  [0xFF, 0xEE, 0xDD, 0xCC, 0xBB, 0xAA, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x00],
  [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, 0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10],
  [0x89, 0xBC, 0xDE, 0xEF, 0xFF, 0xFE, 0xED, 0xCB, 0xA8, 0x76, 0x43, 0x21, 0x10, 0x01, 0x12, 0x34],
  [0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00],
  [0xFD, 0xEC, 0xDB, 0xCA, 0xB9, 0xA8, 0x97, 0x86, 0x75, 0x64, 0x53, 0x42, 0x31, 0x20, 0x10, 0x00],
  [0xFF, 0xDD, 0xBB, 0x99, 0xFF, 0xDD, 0xBB, 0x99, 0x77, 0x55, 0x33, 0x11, 0x77, 0x55, 0x33, 0x11],
  [0xF0, 0xF0, 0x00, 0x00, 0xF0, 0xF0, 0x00, 0x00, 0xF0, 0x00, 0xF0, 0x00, 0x0F, 0x0F, 0x0F, 0x0F]
];
function nibbles(t) {
  var b = TABLE_BYTES[clamp(t, 0, 7)], out = [];
  for (var i = 0; i < 16; i++) { out.push(b[i] >> 4); out.push(b[i] & 15); }
  return out;
}
var TRI32 = (function () { var o = []; for (var i = 0; i < 32; i++) o.push(i < 16 ? 15 - i : i - 16); return o; })();
// the GB wave channel has four volumes: the module picks one from the 4-bit volume
function waveShare(vol) { return vol >= 12 ? 1 : (vol >= 8 ? 0.5 : (vol >= 4 ? 0.25 : 0)); }
// the noise: the chip's 15-bit shift register; short mode feeds back from bit 6
// (the NES: a loop of 93 steps) or runs 7 bits wide (the GB: 127 steps)
function noiseBits(gb, short, n) {
  var r = 1, out = [];
  for (var i = 0; i < n; i++) {
    out.push(r & 1 ? 0 : 1);
    var fb;
    if (gb) { fb = (r ^ (r >> 1)) & 1; r = (r >> 1) | (fb << 14); if (short) r = (r & ~(1 << 6)) | (fb << 6); }
    else { fb = (r ^ (r >> (short ? 6 : 1))) & 1; r = (r >> 1) | (fb << 14); }
  }
  return out;
}
function noiseLoop(gb, short) { return short ? (gb ? 127 : 93) : 32767; }

var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 120) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
// A chip's output is unipolar: 0 to its 4-bit level. Every wave is drawn in
// steps from the baseline (y + h), no slopes: what the DAC puts out.
function steps(x, y, w, h, levels, amp) {
  var pts = [], n = levels.length, sw = w / n, base = y + h, prev = null;
  for (var i = 0; i < n; i++) {
    var yy = Math.round(base - levels[i] / 15 * amp * h), xx = Math.round(x + i * sw);
    if (prev !== null && yy !== prev) pts.push(xx, prev);
    pts.push(xx, yy);
    prev = yy;
  }
  pts.push(Math.round(x + w), prev);
  return pts;
}
function pulseLevels(duty, cycles) {
  var o = [], per = 32;
  for (var c = 0; c < cycles; c++) for (var i = 0; i < per; i++) o.push(i < per * DUTY[duty] / 100 ? 15 : 0);
  return o;
}
function chanPts(kind, x, y, w, h, p) {
  return cached([kind, x, y, w, h, p.duty, p.amp, p.table, p.gb, p.short, p.cyc].join("|"), function () {
    if (kind === 0) return steps(x, y, w, h, pulseLevels(p.duty, p.cyc), p.amp);
    if (kind === 2) return steps(x, y, w, h, p.gb ? nibbles(p.table) : TRI32, p.amp);
    var bits = noiseBits(p.gb, p.short, p.cyc), lv = [];
    for (var i = 0; i < bits.length; i++) lv.push(bits[i] * 15);
    return steps(x, y, w, h, lv, p.amp);
  });
}

// ---- the channels and who plays them -------------------------------------------------------
function shortNames(gb) { return gb ? ["PULSE", "PULSE", "WAVE", "NOISE"] : ["PULSE", "PULSE", "TRI", "NOISE"]; }
function chanNames(gb) { return gb ? ["PULSE", "PULSE", "WAVE", "NOISE"] : ["PULSE", "PULSE", "TRIANGLE", "NOISE"]; }
// What each channel does with the notes, from the module's allocator: Lead
// plays every note on the first channel in the mask; Auto and Locked deal
// notes to the free channels in order (pulses, then the third, then noise).
// Detune above 0 with both pulses in the mask doubles a pulse note on the
// other pulse, detuned: unison.
function dealing(v) {
  var mask = num(v, "channel_mask", 1) | 0, mode = allocOf(v), det = num(v, "detune", 0);
  var uni = det > 0 && (mask & 3) === 3, out = [], n = 0, first = -1;
  for (var c = 0; c < 4; c++) {
    var on = !!(mask & (1 << c));
    if (!on) { out.push({ on: false, say: "OFF", order: -1 }); continue; }
    if (first < 0) first = c;
    if (mode === 1) {
      if (c === first) out.push({ on: true, say: "EVERY NOTE", order: 0 });
      else if (uni && c === 1 && first === 0) out.push({ on: true, say: "UNISON", order: 0 });
      else out.push({ on: true, say: "UNUSED", order: -1, idle: true });
    } else if (uni && c === 1) out.push({ on: true, say: "UNISON", order: 0 });
    else { n++; out.push({ on: true, say: "NOTE " + n, order: n - 1 }); }
  }
  out.uni = uni;
  out.notes = mode === 1 ? (first >= 0 ? 1 : 0) : n;
  return out;
}
// how many notes sound now (held, or in their release): from the notes and the release's time
function sounding(v) {
  var L = v.$live;
  if (!L || !L.known || !L.voices) return 0;
  var rel = num(v, "env_release", 0) / 15 * num(v, "env_sustain", 15) / 15, n = 0;
  for (var i = 0; i < L.voices.length; i++) {
    var vo = L.voices[i];
    if (vo.held || (vo.released !== undefined && vo.released >= 0 && vo.released < rel)) n++;
  }
  return n;
}

// ---- how the values read, everywhere -------------------------------------------------------
function ms(s) { return s < 1 ? { value: String(Math.round(s * 1000)), unit: "ms" } : { value: s.toFixed(2), unit: "s" }; }
push.display(function (key, r) {
  var n = parseFloat(r);
  if (key === "duty" && !isNaN(n)) return { value: String(DUTY[clamp(Math.round(n), 0, 3)]), unit: "%" };
  if (key === "wavetable" && !isNaN(n)) return TABLES[clamp(Math.round(n), 0, 7)];
  if (key === "channel_mask" && !isNaN(n)) {
    var m = Math.round(n), s = [];
    for (var c = 0; c < 4; c++) if (m & (1 << c)) s.push(String(c + 1));
    return s.length ? s.join("+") : "None";
  }
  if (isNaN(n)) return;
  switch (key) {
  case "env_attack": return n <= 0 ? "Instant" : ms(n / 60);
  case "env_decay": case "env_release": return n <= 0 ? "Instant" : ms(n / 15);
  case "env_sustain": case "volume": return { value: String(Math.round(n)), unit: "/15" };
  case "vibrato_depth": return n <= 0 ? "Off" : { value: String(Math.round(n)), unit: "ct" };
  case "vibrato_rate": return n <= 0 ? "Off" : { value: String(Math.round(n)), unit: "Hz" };
  case "detune": return n <= 0 ? "Off" : { value: "+" + Math.round(n), unit: "ct" };
  case "octave_transpose": return { value: (n > 0 ? "+" : "") + Math.round(n), unit: "oct" };
  case "pitch_env_depth": return n <= 0 ? "Off" : { value: "+" + Math.round(n), unit: "st" };
  case "pitch_env_speed": return n <= 0 ? "Hold" : ms(n / 60);
  case "sweep": return n <= 0 ? "Off" : { value: (n * 7.8).toFixed(1), unit: "ms" };
  }
});
// Pung runs every note through the envelope on the engine's times
push.envelopeTimes(function (env) {
  var S = parseFloat(env.value("env_sustain"));
  if (isNaN(S)) S = 15;
  return env.stages.map(function (s) {
    var r = s.raw === null || s.raw === undefined ? NaN : parseFloat(s.raw);
    if (isNaN(r)) return null;
    if (s.key === "env_attack") return r / 60;
    if (s.key === "env_decay") return Math.max(0.003, (1 - S / 15) * r / 15);
    if (s.key === "env_release") return Math.max(0.003, S / 15 * r / 15);
    if (s.key === "pitch_env_speed") return r <= 0 ? null : 4.6 * r / 60; // to 1% of the drop
    return null;
  });
});

// ---- PANEL ---------------------------------------------------------------------------------
var CH_X = 236, CH_W = 120, ENV_X = 722;
function icChip(g, P, x, y, gb) {
  // a DIP package: the body, a notch, eight pins a side
  for (var i = 0; i < 8; i++) { g.fill(x + 5 + i * 8, y, 4, 4, P.pin); g.fill(x + 5 + i * 8, y + 36, 4, 4, P.pin); }
  g.fill(x, y + 4, 68, 32, P.ic);
  g.fill(x, y + 16, 3, 8, P.ground);
  var nm = gb ? "GB" : "NES";
  pix(g, x + 36 - pixWidth(nm, 2) / 2, y + 8, nm, 2, P.title);
  g.text(x + 36, y + 32, "APU", P.dim, 0);
}
function panelGround(g, v, P, gb) {
  g.fill(0, 0, 960, 160, P.ground);
  // left: the title, the chip, the sound
  pix(g, 8, 6, "CHIPTUNE", 2, P.title);
  icChip(g, P, 8, 28, gb);
  var nm = known(v, "preset_name") ? String(v.preset_name.value) : "";
  var lines = wrap(nm || "--", 2, 140);
  if (lines.length > 2) lines = wrap(nm, 1, 140).slice(0, 3);
  var sc = lines.length > 2 || pixWidth(lines[0], 2) > 140 ? 1 : 2;
  for (var i = 0; i < lines.length && i < 3; i++) pix(g, 86, (sc === 2 ? 42 : 44) + i * (sc === 2 ? 18 : 10), lines[i], sc, P.ink);
  // the channels: four cells
  for (var c = 0; c < 4; c++) {
    var x0 = CH_X + c * CH_W;
    g.fill(x0 + 2, 4, CH_W - 4, 96, P.cell);
    g.fill(x0 + 10, 18, 100, 56, P.scope);
  }
  // the envelope
  g.fill(ENV_X, 4, 234, 96, P.cell);
  // the encoder row: under a rule, eight register fields
  g.fill(0, 103, 960, 1, P.rule);
  for (var k = 1; k < 8; k++) g.fill(k * 120, 108, 1, v.$segmode ? 32 : 46, P.rule);
}
function panelTop(g, v, P, gb) {
  var deal = dealing(v), names = shortNames(gb), vol = num(v, "volume", 15), duty = clamp(num(v, "duty", 2) | 0, 0, 3);
  var live = sounding(v), t = v.$touched || "";
  // the sound's number, over its name
  var pn = known(v, "preset") ? ("0" + (num(v, "preset", 0) + 1)).slice(-2) : "--";
  g.text(86, 36, "NO. " + pn + (known(v, "preset_count") ? " OF " + raw(v, "preset_count") : ""), P.dim, -1);
  // how it plays, and its pitch, in the chip's words
  var mode = ["AUTO", "LEAD", "LOCKED"][allocOf(v)];
  var say = mode + ": " + (deal.notes === 1 ? "ONE NOTE" : (deal.notes ? deal.notes + " NOTES" : "NO CHANNEL")) + (deal.uni ? ", UNISON" : "");
  var oc = num(v, "octave_transpose", 0);
  g.text(8, 86, say, hot(v, "alloc_mode") || hot(v, "channel_mask") ? "slot" : P.ink, -1, 160);
  g.text(226, 86, "OCT " + (oc > 0 ? "+" : "") + oc, hot(v, "octave_transpose") ? "slot" : (oc ? P.ink : P.dim), 1);
  var pitch = [], vd = num(v, "vibrato_depth", 0), vr = num(v, "vibrato_rate", 0), pd = num(v, "pitch_env_depth", 0);
  if (vd > 0 && vr > 0) pitch.push("VIB " + vd + " CT " + vr + " HZ");
  if (pd > 0) pitch.push("DROP " + pd + " ST");
  if (gb && num(v, "sweep", 0) > 0 && deal[0].on) pitch.push("SWEEP");
  if (deal.uni) pitch.push("DETUNE " + num(v, "detune", 0) + " CT");
  // as many as fit, whole
  var line = "";
  for (var pi = 0; pi < pitch.length; pi++) { var nx = line ? line + "  " + pitch[pi] : pitch[pi]; if (g.measure(nx) > 218) break; line = nx; }
  g.text(8, 98, line || "STEADY PITCH", v.$segmode === "segment" && v.$segment === "pitch" ? "slot" : (line ? P.dim : P.faint), -1, 220);
  // the four channels
  var p = { duty: duty, amp: vol / 15, table: num(v, "wavetable", 0) | 0, gb: gb, short: shortNoise(v) };
  for (var c = 0; c < 4; c++) {
    var x0 = CH_X + c * CH_W, d = deal[c], col = d.on && !d.idle ? P.ch[c] : P.faint;
    g.text(x0 + 10, 14, (c + 1) + " " + names[c], v.$segment === ["p1", "p2", "ch3", "noise"][c] && v.$segmode === "segment" ? "slot" : col, -1);
    var tag = c < 2 ? DUTY[duty] + "%" : (c === 2 ? (gb ? TABLES[p.table].toUpperCase() : "") : (p.short ? "SHORT" : "LONG"));
    var tagHot = (c < 2 && t === "duty") || (c === 2 && gb && t === "wavetable") || (c === 3 && t === "noise_mode");
    g.text(x0 + 110, 14, tag, tagHot ? "slot" : (d.on ? P.dim : P.faint), 1);
    // the wave, as this channel puts it out: a pulse at the 4-bit volume, the
    // triangle always full (it has no volume), the GB wave at its volume step
    var q = { duty: duty, table: p.table, gb: gb, short: p.short, amp: p.amp, cyc: 2 };
    var kind = c < 2 ? 0 : (c === 2 ? 2 : 3);
    if (kind === 2) q.amp = gb ? waveShare(vol) : 1;
    if (kind === 3) q.cyc = 50;
    if (kind === 2) q.cyc = 1;
    if (q.amp <= 0) { g.fill(x0 + 14, 70, 92, 2, P.faint); }
    else g.poly(chanPts(kind, x0 + 14, 22, 92, 48, q), 2, tagHot ? "slot" : col);
    // who plays it: lit while a note sounds on it
    var lit = d.on && !d.idle && d.order >= 0 && live > d.order;
    g.fill(x0 + 10, 82, 10, 10, lit ? P.ch[c] : (d.on && !d.idle ? P.rule : P.scope));
    if (lit) g.fill(x0 + 12, 84, 6, 6, P.ink);
    g.text(x0 + 26, 91, d.say, d.on && !d.idle ? (lit ? P.ink : P.dim) : P.faint, -1, 84);
  }
  // the envelope (Pung's, on the engine's times): every channel's volume follows it
  var envHot = t.indexOf("env_") === 0;
  g.text(ENV_X + 8, 14, "ENVELOPE", envHot || (v.$segmode === "segment" && v.$segment === "env") ? "slot" : P.ink, -1);
  var s = num(v, "env_sustain", 15);
  g.text(ENV_X + 228, 14, s > 0 ? "VOLUME " + vol + "/15" : "ONE-SHOT, VOLUME " + vol, hot(v, "volume") ? "slot" : P.dim, 1, 150);
  g.envelope(ENV_X + 4, 18, 226, 80, { attack: "env_attack", decay: "env_decay", sustain: "env_sustain", release: "env_release", labels: true, color: P.env });
  // the page
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(226, 15, String(ps[v.$page] || "").toUpperCase() + " " + ((v.$page || 0) + 1) + "/" + ps.length, P.dim, 1);
}
// The encoder row as the chip's registers: each value a field of steps (a
// 4-bit volume is sixteen), lit up to where it stands; a choice lights one.
var CHOICE = { chip: 2, alloc_mode: 3, noise_mode: 2, duty: 4, wavetable: 8 };
function choiceIndex(v, k) {
  if (k === "chip") return isGB(v) ? 1 : 0;
  if (k === "alloc_mode") return allocOf(v);
  if (k === "noise_mode") return shortNoise(v) ? 1 : 0;
  return num(v, k, 0) | 0;
}
function panelRow(g, v, P) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  // in segment mode Pung names the segments in the bottom 18 pixels: the row ends above them
  var seg = !!v.$segmode, NY = seg ? 113 : 117, FY = seg ? 117 : 123, FH = seg ? 5 : 7, VY = seg ? 138 : 152;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var on = k === t, kn = known(v, k);
    g.text(x0 + 60, NY, String(v[k].name || k).toUpperCase(), on ? "slot" : P.dim, 0, 110);
    // the field
    var n = CHOICE[k] || 0, lit = 0, sel = -1;
    if (n) sel = kn ? choiceIndex(v, k) : -1;
    else if (k === "channel_mask") n = 4;
    else n = 16;
    var gap = 2, sw = Math.floor((100 - gap * (n - 1)) / n), w = sw * n + gap * (n - 1), fx = x0 + 60 - w / 2;
    if (k === "channel_mask") {
      var m = num(v, k, 0) | 0;
      for (var b = 0; b < 4; b++) {
        var bx = fx + b * (sw + gap), isOn = kn && (m & (1 << b));
        g.fill(bx, FY, sw, FH, isOn ? (on ? "slot" : P.ch[b]) : P.cell);
      }
    } else {
      if (!n || sel < 0) lit = kn ? Math.round(v[k].frac * n) : 0;
      for (var j = 0; j < n; j++) {
        var litj = sel >= 0 ? j === sel : j < lit;
        g.fill(fx + j * (sw + gap), FY, sw, FH, litj ? (on ? "slot" : P.ink) : P.cell);
      }
    }
    // the value, with its unit
    var val = kn ? String(v[k].display || v[k].value) : "--", unit = kn ? String(v[k].unit || "") : "";
    if (k === "channel_mask") continue;
    var uw = unit ? g.measure(unit) + 3 : 0, room = 104 - uw, vw = Math.min(g.measure(val, "value"), room);
    g.value(x0 + 60 - (vw + uw) / 2, VY, val, on ? "slot" : P.ink, -1, room);
    if (unit) g.text(x0 + 60 - (vw + uw) / 2 + vw + 3, VY, unit, P.dim, -1);
  }
  // the mask: which channels, in words, under its field
  var mi = knobs.indexOf("channel_mask");
  if (mi >= 0 && known(v, "channel_mask")) {
    var d = dealing(v), names = chanNames(isGB(v)), on2 = [];
    for (var c = 0; c < 4; c++) if (d[c].on) on2.push(c < 2 ? "P" + (c + 1) : names[c].slice(0, 3));
    g.value(mi * 120 + 60, VY, on2.length ? on2.join(" ") : "NONE", t === "channel_mask" ? "slot" : P.ink, 0, 110);
  }
}
// The panel's sections as segments: the chip, the pitch line, the four
// channels, the envelope. The one under the hands has its name lit (Pung's
// bar stands above it).
var SEGS = [
  { id: "chip", label: "Chip", rect: [4, 4, 228, 70], keys: ["chip", "alloc_mode", "channel_mask", "octave_transpose", "volume"] },
  { id: "pitch", label: "Pitch", rect: [4, 76, 228, 26], keys: ["vibrato_depth", "vibrato_rate", "pitch_env_depth", "pitch_env_speed", "sweep", "detune", "octave_transpose"] },
  { id: "p1", label: "Pulse 1", rect: [CH_X + 2, 4, 116, 96], keys: ["duty", "volume", "sweep", "channel_mask", "alloc_mode"] },
  { id: "p2", label: "Pulse 2", rect: [CH_X + 122, 4, 116, 96], keys: ["duty", "volume", "detune", "channel_mask", "alloc_mode"] },
  { id: "ch3", label: "Tri/Wave", rect: [CH_X + 242, 4, 116, 96], keys: ["wavetable", "volume", "channel_mask", "alloc_mode"] },
  { id: "noise", label: "Noise", rect: [CH_X + 362, 4, 116, 96], keys: ["noise_mode", "volume", "channel_mask", "alloc_mode"] },
  { id: "env", label: "Envelope", rect: [ENV_X, 4, 234, 96], keys: ["env_attack", "env_decay", "env_sustain", "env_release", "volume"] }
];
function segMark(g, v, P) {
  if (v.$segmode !== "segment") return;
  // the chip: its name lit, in its own pixels (the channels and the envelope light their names in panelTop)
  if (v.$segment === "chip") pix(g, 8, 6, "CHIPTUNE", 2, "slot");
}
var PANEL_EXTRA = ["preset", "preset_name", "preset_count", "chip", "alloc_mode", "channel_mask", "noise_mode", "duty", "wavetable", "volume",
  "detune", "octave_transpose", "vibrato_depth", "vibrato_rate", "pitch_env_depth", "sweep", "env_attack", "env_decay", "env_sustain", "env_release"];
push.compartment({
  id: "panel", label: "Chiptune", front_panel: true,
  pages: [
    { label: "Play", keys: ["env_attack", "env_decay", "env_sustain", "env_release", "duty", "vibrato_depth", "vibrato_rate", "volume"] },
    { label: "Chip", keys: ["chip", "alloc_mode", "channel_mask", "duty", "wavetable", "noise_mode", "detune", "volume"] },
    { label: "Pitch", keys: ["octave_transpose", "pitch_env_depth", "pitch_env_speed", "sweep", "vibrato_depth", "vibrato_rate", "detune"] }
  ],
  segments: SEGS, draws_segments: true,
  extra_keys: PANEL_EXTRA.concat(["pitch_env_speed"]),
  screen: function (g, v) {
    var P = pal(v), gb = isGB(v);
    g.layer("chip|" + gb + "|" + raw(v, "preset_name") + "|" + !!v.$segmode, function () { panelGround(g, v, P, gb); });
    panelTop(g, v, P, gb);
    segMark(g, v, P);
    panelRow(g, v, P);
  }
});

// ---- CHANNELS: the four, large ---------------------------------------------------------------
function bandGround(g, P) { g.fill(0, 0, g.w, g.h, P.ground); }
function channelsScreen(g, v) {
  var P = pal(v), gb = isGB(v), t = v.$touched || "";
  var CW = 238;
  g.layer("ch|" + gb, function () {
    bandGround(g, P);
    for (var c = 0; c < 4; c++) { g.fill(c * CW + 2, 0, CW - 4, 86, P.cell); g.fill(c * CW + 8, 16, CW - 16, 46, P.scope); }
  });
  var deal = dealing(v), names = chanNames(gb), vol = num(v, "volume", 15), duty = clamp(num(v, "duty", 2) | 0, 0, 3);
  var table = clamp(num(v, "wavetable", 0) | 0, 0, 7), sh = shortNoise(v), live = sounding(v), det = num(v, "detune", 0);
  for (var c = 0; c < 4; c++) {
    var x0 = c * CW, d = deal[c], use = d.on && !d.idle, col = use ? P.ch[c] : P.faint;
    var maskHot = t === "channel_mask" || t === "alloc_mode";
    var title = (c + 1) + " " + names[c];
    g.text(x0 + 8, 11, title, col, -1);
    if (c === 2 && gb) g.text(x0 + 14 + g.measure(title), 11, TABLES[table].toUpperCase() + (vol < 12 ? " " + Math.round(waveShare(vol) * 100) + "%" : ""), t === "wavetable" || t === "volume" ? "slot" : P.ink, -1);
    var lit = use && d.order >= 0 && live > d.order;
    g.text(x0 + CW - 8, 11, d.say + (d.say === "UNISON" ? " +" + det + " CT" : ""), maskHot ? "slot" : (lit ? P.ink : (use ? P.dim : P.faint)), 1, 120);
    var q = { duty: duty, table: table, gb: gb, short: sh, amp: vol / 15, cyc: 3 }, kind = c < 2 ? 0 : (c === 2 ? 2 : 3);
    if (kind === 2) { q.amp = gb ? waveShare(vol) : 1; q.cyc = 1; }
    if (kind === 3) q.cyc = 111;
    var waveHot = (kind === 0 && t === "duty") || (kind === 2 && t === "wavetable") || (kind === 3 && t === "noise_mode") || t === "volume";
    if (q.amp <= 0) g.fill(x0 + 12, 58, CW - 24, 2, P.faint);
    else g.poly(chanPts(kind, x0 + 14, 20, CW - 28, 40, q), 2, waveHot ? "slot" : col);
    // under each, its own choice
    var y = 70;
    if (kind === 0) {
      // the duty: four widths, one lit (both pulses share it)
      for (var i = 0; i < 4; i++) {
        var bx = x0 + 8 + i * 56, sel = i === duty;
        g.poly(cached("dt|" + bx + "|" + i, function () { return steps(bx + 4, y, 22, 10, pulseLevels(i, 1), 1); }), 1.5, sel ? (t === "duty" ? "slot" : col) : P.faint);
        g.text(bx + 30, y + 10, DUTY[i] + "%", sel ? (t === "duty" ? "slot" : P.ink) : P.faint, -1);
      }
    } else if (kind === 2 && gb) {
      // the eight tables the module can load, the one in wave RAM lit
      for (var j = 0; j < 8; j++) {
        var tx = x0 + 8 + j * 28, s2 = j === table;
        g.poly(cached("tb|" + tx + "|" + j, function () { return steps(tx + 1, y - 1, 24, 13, nibbles(j), 1); }), s2 ? 2 : 1, s2 ? (t === "wavetable" ? "slot" : P.ink) : P.faint);
      }
    } else if (kind === 2) {
      g.text(x0 + 8, y + 9, "32 STEPS, NO VOLUME CONTROL", use ? P.dim : P.faint, -1, CW - 16);
    } else {
      var lp = noiseLoop(gb, sh);
      g.text(x0 + 8, y + 9, sh ? "SHORT LOOP OF " + lp + ": METALLIC" : "LONG: 32767 STEPS, HISS", t === "noise_mode" ? "slot" : (use ? P.dim : P.faint), -1, CW - 16);
    }
  }
}
push.compartment({
  id: "channels", label: "Channels",
  pages: [{ label: "Channels", keys: ["chip", "alloc_mode", "channel_mask", "duty", "wavetable", "noise_mode", "detune", "volume"] }],
  extra_keys: ["env_sustain", "env_release"],
  screen: channelsScreen
});

// ---- PITCH: what happens to a note's pitch -------------------------------------------------------
// The GB sweep, on pulse 1: each step adds a quarter of the frequency register
// (shift 2, up); past 2047 the channel stops. From C3 that is three steps.
function sweepSteps(note) {
  var f = 440 * Math.pow(2, (note - 69) / 12), x = Math.round(2048 - 131072 / f), out = [x];
  while (out.length < 24) { x = x + (x >> 2); if (x > 2047) break; out.push(x); }
  return out;
}
function pitchScreen(g, v) {
  var P = pal(v), gb = isGB(v), t = v.$touched || "";
  g.layer("pi|" + gb, function () {
    bandGround(g, P);
    var cols = [[0, 120], [120, 240], [360, 120], [480, 240], [720, 232]];
    for (var i = 0; i < cols.length; i++) g.fill(cols[i][0] + 2, 0, cols[i][1] - 4, 86, P.cell);
  });
  // octave
  var oc = num(v, "octave_transpose", 0), oH = t === "octave_transpose";
  g.text(10, 12, "OCTAVE", oH ? "slot" : P.dim, -1);
  pix(g, 60 - pixWidth((oc > 0 ? "+" : "") + oc, 3) / 2, 26, (oc > 0 ? "+" : "") + oc, 3, oH ? "slot" : (oc ? P.ink : P.dim));
  g.text(60, 78, oc ? "C4 PLAYS C" + (4 + oc) : "AS PLAYED", P.dim, 0, 110);
  // the pitch drop: a note starts this far up and falls back (Pung's envelope, on its times)
  var pd = num(v, "pitch_env_depth", 0), ps = num(v, "pitch_env_speed", 0), dH = t === "pitch_env_depth" || t === "pitch_env_speed";
  g.text(130, 12, "PITCH DROP", dH ? "slot" : P.dim, -1);
  if (pd > 0 && ps > 0) {
    g.text(350, 12, "+" + pd + " ST  " + Math.round(4.6 * ps / 60 * 1000) + " MS", P.ink, 1, 150);
    g.envelope(124, 16, 232, 68, { attack: 0, decay: "pitch_env_speed", sustain: 0, color: P.ch[2] });
  } else if (pd > 0) {
    g.value(240, 52, "+" + pd + " ST, HELD", dH ? "slot" : P.ink, 0, 220);
    g.text(240, 72, "SPEED 0: THE PITCH NEVER FALLS", P.dim, 0, 220);
  } else {
    g.value(240, 52, "NONE", dH ? "slot" : P.faint, 0);
    g.text(240, 72, "NOTES START ON PITCH", P.faint, 0, 220);
  }
  // the GB sweep: the pitch climbs a step at a time until the channel cuts out
  var sw = num(v, "sweep", 0), sH = t === "sweep", deal = dealing(v);
  g.text(370, 12, "SWEEP", sH ? "slot" : P.dim, -1);
  if (!gb) {
    g.text(420, 50, "GB ONLY", P.faint, 0);
    g.text(420, 64, "(PULSE 1)", P.faint, 0);
  } else if (sw <= 0) {
    g.value(420, 52, "OFF", sH ? "slot" : P.faint, 0);
  } else {
    var st = sweepSteps(48), x0 = 370, w = 90, top = 26, h = 44;
    var pts = cached("sw|" + sw, function () {
      var o = [], n = st.length, dx = w / n, f0 = 131072 / (2048 - st[0]), smax = 12 * Math.log(131072 / (2048 - st[n - 1]) / f0) / Math.LN2 || 1;
      for (var i = 0; i < n; i++) {
        var semis = 12 * Math.log(131072 / (2048 - st[i]) / f0) / Math.LN2, yy = top + h - semis / smax * h;
        o.push(x0 + i * dx, yy, x0 + (i + 1) * dx, yy);
      }
      return o;
    });
    g.poly(pts, 2, sH ? "slot" : (deal[0].on ? P.ch[0] : P.faint));
    var ex = pts[pts.length - 2] + 4, ey = pts[pts.length - 1];
    g.line(ex, ey - 4, ex + 8, ey + 4, 2, P.dim); g.line(ex, ey + 4, ex + 8, ey - 4, 2, P.dim);
    g.text(470, 12, (sw * 7.8).toFixed(1) + " MS", P.ink, 1);
    g.text(370, 82, "C3: " + (st.length - 1) + " STEPS", P.dim, -1, 104);
  }
  // vibrato: a sine of depth cents at rate Hz (free running: still)
  var vd = num(v, "vibrato_depth", 0), vr = num(v, "vibrato_rate", 0), vH = t === "vibrato_depth" || t === "vibrato_rate";
  g.text(490, 12, "VIBRATO", vH ? "slot" : P.dim, -1);
  if (vd > 0 && vr > 0) {
    g.text(710, 12, "+/-" + vd + " CT AT " + vr + " HZ", P.ink, 1);
    g.lfo(484, 16, 232, 68, { shape: "Sine", rate: "vibrato_rate", color: P.ch[1] });
  } else {
    g.value(600, 52, "OFF", vH ? "slot" : P.faint, 0);
    g.text(600, 72, vd > 0 ? "RATE 0: NO VIBRATO" : "THE MOD WHEEL SETS ITS DEPTH", P.faint, 0, 220);
  }
  // detune: pulse 2 above pulse 1 in unison, and how fast they beat
  var det = num(v, "detune", 0), tH = t === "detune";
  g.text(730, 12, "DETUNE", tH ? "slot" : P.dim, -1);
  if (det > 0 && deal.uni) {
    var beat = 261.63 * (Math.pow(2, det / 1200) - 1);
    g.value(730, 44, "PULSE 2 +" + det + " CT", tH ? "slot" : P.ink, -1, 210);
    g.text(730, 62, "EVERY PULSE NOTE ON BOTH", P.dim, -1, 210);
    g.text(730, 78, "BEATS " + (beat < 10 ? beat.toFixed(1) : Math.round(beat)) + " HZ AT C4", P.dim, -1, 210);
  } else if (det > 0) {
    g.value(730, 44, "+" + det + " CT", tH ? "slot" : P.faint, -1);
    g.text(730, 62, "UNISON NEEDS PULSES 1 AND 2", P.dim, -1, 210);
    g.text(730, 78, "IN THE CHANNEL MASK", P.dim, -1, 210);
  } else {
    g.value(730, 44, "OFF", tH ? "slot" : P.faint, -1);
    g.text(730, 62, "ONE PULSE A NOTE", P.faint, -1, 210);
  }
}
push.compartment({
  id: "pitch", label: "Pitch",
  pages: [{ label: "Pitch", keys: ["octave_transpose", "pitch_env_depth", "pitch_env_speed", "sweep", "vibrato_depth", "vibrato_rate", "detune"] }],
  extra_keys: ["chip", "channel_mask"],
  screen: pitchScreen
});
