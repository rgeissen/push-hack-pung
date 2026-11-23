// Gresil on the Push: a granular texture processor, an audio effect.
// An overlay shipped with Pung (Gresil ships no push_ui.js).
//
// Gresil is the Beads granular processor ported unchanged: the sound coming
// in is recorded into a buffer, and up to 32 grains play slices of it back,
// each with its own place in the buffer, length, envelope and pitch, each of
// the four randomised per grain. The panel is a light Eurorack module: its
// buttons and LEDs, its small knobs and attenuverters, and in the middle the
// picture that is the effect, the grain cloud:
//
//   THE CLOUD   the buffer across, now at the right edge (the recording head,
//               iced over when frozen), the past to the left, as long as the
//               medium holds; pitch upwards. Every grain the knobs make at
//               once is drawn where Time puts it, as long as Size makes it,
//               in the envelope Shape gives it, at its pitch, scattered as
//               the four Random knobs scatter them. As many as Density and
//               Size keep sounding together (rate x length, up to 32)
//   BUFFER      Freeze, the four media, the seed (free or on Live's clock)
//   RANDOM      the four attenuverters: up spreads every grain, down makes
//               occasional jumps
//   OUTPUT      feedback, dry/wet, reverb; the wet filters and the limiter
//   FILTERS     the output path in order, the wet filters drawn by Pung
//
// The laws are Beads' own (granular_player.h, grain_envelope.h,
// trigger_generator.cc, randomized_parameter.h) and Gresil's wrapper
// (gresil_move.cpp: the attenuverter law, the media's buffer lengths). The
// grains are drawn from a fixed set of random draws through those laws:
// what the knobs allow, not where the engine's last grain fell, which no
// one can know.

// ---- values -----------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function c01(x) { return clamp(x, 0, 1); }
// an enum: Gresil answers its options' names ("Clean Tape"), Pung may hand
// the index; either reads as the index here
function opt(v, k, list, d) {
  if (!known(v, k)) return d;
  var s = String(v[k].value), i = list.indexOf(s);
  if (i < 0) i = list.indexOf(String(v[k].display || ""));
  if (i < 0) { var n = parseInt(s, 10); i = isNaN(n) ? d : n; }
  return clamp(i, 0, list.length - 1);
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (key in CACHE) return CACHE[key];
  if (++CACHED > 64) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}

// ---- Beads' laws ---------------------------------------------------------------------------------
var MEDIA = ["Dirty Tape", "Clean Tape", "Vintage", "Digital"], MEDIA_SHORT = ["DIRTY", "CLEAN", "VINTAGE", "DIGITAL"];
var BUF_S = [[17.4, 34.8], [11.6, 23.2], [5.8, 11.6], [4.35, 8.7]];   // stereo, mono (the design spec's table)
var OFFON = ["Off", "On"], MODE = ["Granular", "Delay"], SEED = ["Free", "Clock"], SOURCE = ["Input", "Synth"], BUFFER = ["Stereo", "Mono"], DRY = ["Clean", "Media"];
var DIVS = ["1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2", "1 Bar"];
var DIV_RATIOS = [1, 2, 3, 4, 6, 8, 12, 16];
var DIV_BEATS = [0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 2, 4];
// on Live's clock: ticks a second at 120 BPM, then every n-th or by chance
function clockRate(v, d) {
  var tps = 2 / DIV_BEATS[opt(v, "clock_div", DIVS, 4)];
  if (d < 0.48) return tps / clockDiv(d);
  if (d > 0.52) return tps * clockProb(d);
  return 0;
}
// Gresil's attenuverter law: a dead zone at noon, then quadratic
function att(a) { var v = a * 0.5, m = Math.max(0, Math.abs(v) - 0.03); return (2 / 0.47) * v * m; }
// a grain's length (ComputeGrainDuration): the shortest, about 8 ms, at a
// third; left of it the grains play backwards; Gresil keeps Size under 0.975
function grainS(size) {
  var d = Math.min(size, 0.975), rev = d < 1 / 3;
  var cl = rev ? d * 3 * (2 - d * 3) : 1 - 1.5 * (d - 1 / 3), sh = Math.min(1, 1.025 * cl);
  return Math.pow(2, -sh * 108 / 12) * 4;
}
// grains a second (RenderPulseTrain): below 0.48 regular, from 130.8 Hz down;
// above 0.52 random, half that up top; between, none (the seed button's zone)
function grainRate(d) {
  if (d < 0.48) return 130.81278 * Math.pow(2, -d * 16);
  if (d > 0.52) return 0.5 * 130.81278 * Math.pow(2, -(1 - d) * 16);
  return 0;
}
function density(v) { return num(v, "density", 0.8); }
// on the clock: below 0.48 every n-th tick (1..16), above 0.52 a probability
function clockDiv(d) { return DIV_RATIOS[clamp(Math.floor(d * 2.15 * 8), 0, 7)]; }
function clockProb(d) { var p = Math.max(0, (d - 0.52) * 2.15); return Math.min(1, p * p); }
// a grain's envelope (GrainEnvelope::Start / Render) over its length, 0..1
function envShape(shape) {
  var sus = Math.max(1 - 3 * shape, 0), s = (shape - 1 / 3) * 1.5;
  if (s < 0) s = 0; else if (s < 0.5) s = s * s * s * 4;
  var a = s, r = (1 - a) * (1 - sus), smooth = a < 0.5 ? 2 * a : 2 - 2 * a, tot = a + sus + r || 1;
  return { a: a / tot, s: sus / tot, r: r / tot, smooth: smooth };
}
function sstep(t) { return t * t * (3 - 2 * t); }
function envAt(E, t) {
  if (t < E.a) { var x = t / E.a; return x + (sstep(x) - x) * E.smooth; }
  if (t < E.a + E.s) return 1;
  var y = 1 - (t - E.a - E.s) / Math.max(E.r, 1e-6); y = c01(y);
  var b = y * y * y * y; return b + (sstep(y) - b) * E.smooth;
}
// fixed draws, so the cloud stands still while nothing is turned
var DRAWS = (function () {
  var s = 0x2545f491, out = [];
  function r() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }
  for (var i = 0; i < 32 * 8; i++) out.push(r());
  return out;
})();
function draw(i, j) { return DRAWS[(i * 8 + j) % DRAWS.length]; }
// one randomized parameter for grain i (RandomizedParameter::value, clamped)
function rndParam(base, a, i, j) {
  var blend = a > 0 ? a : Math.min(1, -a * draw(i, j + 1) * 3);
  return c01(base + (draw(i, j) - base) * blend);
}
function rndPitch(base, a, i) {
  var blend = a > 0 ? a : Math.min(1, -a * draw(i, 6) * 3);
  return base + (2 * draw(i, 5) - 1) * 24 * blend;
}

// ---- how values read -----------------------------------------------------------------------------
function msTxt(s) { return s < 1 ? [String(Math.round(s * 1000)), "ms"] : [s.toFixed(2), "s"]; }
function fmt(k, x) {
  switch (k) {
  case "size": { var s = msTxt(grainS(x)); return x < 1 / 3 ? { value: s[0], unit: s[1] + " rev" } : { value: s[0], unit: s[1] }; }
  case "density": { var r = grainRate(x); return r <= 0 ? "None" : { value: r < 10 ? r.toFixed(1) : String(Math.round(r)), unit: x > 0.52 ? "/s rnd" : "/s" }; }
  case "pitch": { var p = Math.round(x); return { value: (p > 0 ? "+" : "") + p, unit: "st" }; }
  case "time_rnd": case "size_rnd": case "shape_rnd": case "pitch_rnd": case "filter": {
    var n = Math.round(x * 100); return { value: (n > 0 ? "+" : "") + n, unit: "%" };
  }
  case "time": case "shape": case "feedback": case "reverb": case "dry_wet": return { value: String(Math.round(x * 100)), unit: "%" };
  case "filter_hp": return x < 5 ? "Off" : { value: String(Math.round(x)), unit: "Hz" };
  case "filter_lp": return x > 19990 ? "Off" : { value: (x / 1000).toFixed(1), unit: "kHz" };
  case "drive": case "low_boost": return { value: (x > 0.05 ? "+" : "") + x.toFixed(1), unit: "dB" };
  case "limiter_pre": case "limiter_post": return { value: (x > 0.05 ? "+" : "") + x.toFixed(1), unit: "dB" };
  case "low_freq": return { value: String(Math.round(x)), unit: "Hz" };
  case "low_q": return { value: x.toFixed(1), unit: "" };
  }
  return null;
}
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  return fmt(key, n) || undefined;
});
function valueOf(v, k) {
  if (!known(v, k)) return "--";
  var n = parseFloat(v[k].value);
  if (!isNaN(n)) {
    var f = fmt(k, n);
    if (f) return typeof f === "string" ? up(f) : up(f.value + (f.unit ? " " + f.unit : ""));
  }
  if (k === "media") return ["DIRTY", "CLEAN", "VINTAGE", "DIGITAL"][opt(v, k, MEDIA, 1)];
  return up(txt(v, k));
}
var NAMES = { time: "TIME", size: "SIZE", shape: "SHAPE", density: "DENSITY", pitch: "PITCH", feedback: "FEEDBACK", reverb: "REVERB", dry_wet: "DRY / WET",
  time_rnd: "TIME RND", size_rnd: "SIZE RND", shape_rnd: "SHAPE RND", pitch_rnd: "PITCH RND", freeze: "FREEZE", media: "MEDIA", seed: "SEED", clock_div: "CLOCK DIV",
  mode: "MODE", filter: "DELAY FILT", source: "SOURCE", buffer: "BUFFER", dry: "DRY PATH", mono_grains: "MONO GRAIN", freeze_save: "KEEP FRZ", trim: "TRIM",
  filter_hp: "WET HPF", filter_lp: "WET LPF", drive: "DRIVE", limiter_on: "LIMITER", limiter_pre: "PRE GAIN", limiter_post: "POST GAIN", low_boost: "LOW BOOST",
  low_freq: "LOW FREQ", low_q: "LOW Q" };
function nameOf(v, k) { return NAMES[k] || up((v[k] && v[k].name) || k); }

// ---- the look: an aluminium panel, black legends, a night window of ice --------------------------------
var ALU = "#c4c8cb", ALU_DK = "#aeb3b7", ALU_LT = "#d6d9db", INK = "#14181b", LEG = "#3b4247", LEG_DIM = "#6e767c";
var WIN = "#0b131b", WIN_LINE = "#1c2a37", WIN_GRID = "#15202b", ICE = "#cfeeff", ICE_MID = "#6fa9d6", ICE_DK = "#244a6b", FROST = "#8fd3ff";
var KNOB = "#262b30", KNOB_RIM = "#11151a", ARC = "#1f5f9e", LED_OFF = "#7d8489";
var MEDIA_LED = ["#e0892f", "#3fbf6f", "#e0b52f", "#4aa8ff"];

// a Eurorack knob: a dark cap, a white index line, the value arc around it
var A0 = Math.PI * 0.75, SW = Math.PI * 1.5;
function euroKnob(g, cx, cy, r, f, bip, col, ok) {
  g.arc(cx, cy, r + 3, A0, SW, 2, ALU_DK);
  if (ok) {
    var a = bip ? 0.5 : 0, b = c01(f);
    if (b < a) { var t0 = a; a = b; b = t0; }
    if (b - a > 0.003) g.arc(cx, cy, r + 3, A0 + SW * a, SW * (b - a), 3, col);
  }
  g.dot(cx, cy, r, KNOB_RIM);
  g.dot(cx, cy, r - 2, KNOB);
  if (!ok) return;
  var an = A0 + SW * c01(f);
  g.line(cx + Math.cos(an) * 1, cy + Math.sin(an) * 1, cx + Math.cos(an) * (r - 2), cy + Math.sin(an) * (r - 2), 2, col === "slot" ? "slot" : "#f4f6f7");
}
function led(g, x, y, on, col) { g.dot(x, y, 4, on ? col : LED_OFF); if (on) g.dot(x - 1, y - 1, 1.5, "#ffffff"); }

// the encoder row, on the panel's aluminium
var ROW = 104;
var BIP = { time_rnd: 1, size_rnd: 1, shape_rnd: 1, pitch_rnd: 1, filter: 1, pitch: 1, limiter_pre: 1, limiter_post: 1 };
var ENUMS = { freeze: OFFON, media: MEDIA, seed: SEED, clock_div: DIVS, mode: MODE, source: SOURCE, buffer: BUFFER, dry: DRY, mono_grains: OFFON,
  freeze_save: OFFON, limiter_on: OFFON, trim: OFFON };
function encoderRow(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode, cy = seg ? ROW + 19 : ROW + 27, r = seg ? 10 : 13;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x = c * 120, hot = k === t, ok = known(v, k), col = hot ? "slot" : ARC;
    if (ENUMS[k]) { // a switch or a selector: a push button with its LED
      var n = ENUMS[k].length, i = opt(v, k, ENUMS[k], 0), on = n === 2 ? i === 1 : true;
      g.fill(x + 10, cy - 10, 26, 20, hot ? "slot" : KNOB);
      g.fill(x + 12, cy - 8, 22, 16, hot ? "slot" : "#3a4046");
      // the LED says on (a switch), the clock (Seed) or the medium's colour;
      // a two-way choice of names (Mode, Source...) has none to say
      var lit = ENUMS[k] === OFFON || k === "seed" || k === "media";
      if (ok && lit) led(g, x + 23, cy, on, k === "media" ? MEDIA_LED[i] : k === "freeze" ? FROST : "#3fbf6f");
    } else euroKnob(g, x + 23, cy, r, ok ? v[k].frac : 0.5, !!BIP[k], col, ok);
    g.text(x + 44, seg ? ROW + 14 : ROW + 20, nameOf(v, k), hot ? "slot" : LEG, -1, 74);
    g.value(x + 44, seg ? ROW + 32 : ROW + 42, valueOf(v, k), hot ? "slot" : INK, -1, 74);
  }
}

// ---- the front panel -----------------------------------------------------------------------------
var TOP = 22, H = 80;
var BOX = { buffer: [4, 140], cloud: [148, 500], random: [652, 150], output: [806, 150] };
function panelGround(g, v, seg) {
  g.fill(0, 0, 960, 160, ALU);
  g.fill(0, 0, 960, 1, ALU_LT);
  // the module's name as the panel prints it, its screws
  g.value(10, 16, "GRESIL", INK, -1);
  g.text(80, 15, "GRANULAR TEXTURES", LEG_DIM, -1);
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(950, 15, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  // the sections: printed frames
  ["buffer", "random", "output"].forEach(function (id) {
    var b = BOX[id];
    g.fill(b[0], TOP, b[1], H, ALU_LT);
    g.fill(b[0], TOP, b[1], 1, LEG_DIM);
  });
  // the cloud's window
  var c = BOX.cloud;
  g.fill(c[0], TOP, c[1], H, "#2a3036");
  g.fill(c[0] + 2, TOP + 2, c[1] - 4, H - 4, WIN);
  cloudGround(g);
  // legends
  g.text(BOX.buffer[0] + 6, TOP + 12, "BUFFER", INK, -1);
  g.text(BOX.random[0] + 6, TOP + 12, "RANDOM", INK, -1);
  g.text(BOX.output[0] + 6, TOP + 12, "OUTPUT", INK, -1);
  // the encoder row
  g.fill(0, ROW, 960, 56, ALU_LT);
  g.fill(0, ROW, 960, 1, ALU_DK);
  for (var i = 1; i < 8; i++) g.fill(i * 120, ROW + 8, 1, seg ? 28 : 40, ALU_DK);
}
function litTitle(g, id, word, lit) { if (lit) { var b = BOX[id]; g.text(b[0] + 6, TOP + 12, word, "slot", -1); } }

// the cloud, in two panes. THE BUFFER: every grain the knobs keep sounding
// at once, where Time (and its spread) puts it in the recording, now at the
// right, and at its pitch (+-24 st to the edges); its width the audio it
// plays (at least a few pixels). ONE SECOND: the grains as they come and go
// in time, Density's rate (regular, or random) and Size's length, each in the
// envelope Shape gives it, their height their share of the level (1/sqrt n)
var SPLIT = 0.55;
function cloudGeom() {
  var c = BOX.cloud, x0 = c[0] + 6, x1 = c[0] + c[1] - 6, y0 = TOP + 6, y1 = TOP + H - 16, xs = Math.round(x0 + (x1 - x0) * SPLIT);
  return { x0: x0, x1: x1, y0: y0, y1: y1, xs: xs };
}
function cloudGround(g) { // the window's fixed lines (inside the panel's layer)
  var G = cloudGeom(), mid = (G.y0 + G.y1) / 2;
  for (var s = -24; s <= 24; s += 12) g.fill(G.x0, Math.round(mid - s / 30 * (mid - G.y0 - 2)), G.xs - 8 - G.x0, 1, s ? WIN_GRID : WIN_LINE);
  g.fill(G.xs, G.y0, 1, G.y1 - G.y0 + 10, WIN_LINE);
  g.fill(G.xs + 8, G.y1, G.x1 - G.xs - 8, 1, WIN_LINE);
  for (var q = 0; q <= 4; q++) g.fill(Math.round(G.xs + 8 + (G.x1 - G.xs - 8) * q / 4), G.y1 + 1, 1, q % 2 ? 2 : 4, WIN_LINE);
}
function cloud(g, v, t) {
  var G = cloudGeom(), x0 = G.x0, bx1 = G.xs - 8, y0 = G.y0, y1 = G.y1, w = bx1 - x0, mid = (y0 + y1) / 2;
  var media = opt(v, "media", MEDIA, 1), mono = opt(v, "buffer", BUFFER, 0), L = BUF_S[media][mono], frozen = opt(v, "freeze", OFFON, 0) === 1;
  var synth = opt(v, "source", SOURCE, 0) === 1, delay = !synth && opt(v, "mode", MODE, 0) === 1;
  var time = num(v, "time", 0.2), size = num(v, "size", 0.75), shape = num(v, "shape", 0.5), pitch = Math.round(num(v, "pitch", 0)), dens = density(v);
  var aT = att(num(v, "time_rnd", 0)), aS = att(num(v, "size_rnd", 0)), aH = att(num(v, "shape_rnd", 0)), aP = att(num(v, "pitch_rnd", 0));
  var clock = opt(v, "seed", SEED, 0) === 1, ty = y1 + 10;
  var pyOf = function (st) { return mid - clamp(st / 30, -1, 1) * (mid - y0 - 2); };
  g.text(x0, ty, synth ? "WAVETABLE" : "-" + L + " S", ICE_DK, -1);
  g.text(bx1, ty, synth ? "" : frozen ? "FROZEN" : "NOW", frozen ? FROST : ICE_DK, 1);
  // the recording head: it stops when frozen
  if (!synth) {
    if (frozen) { for (var fy = y0; fy < y1; fy += 6) g.fill(bx1 - 3, fy, 3, 3, FROST); }
    else g.fill(bx1 - 2, y0, 2, y1 - y0, ICE_MID);
  }
  if (delay) { // the multitap delay: Time sets its length, the filter its colour
    var xd = bx1 - w * c01(time), fl = att(num(v, "filter", 0)), tc = t === "time" ? "slot" : ICE;
    g.fill(Math.round(xd), y0 + 4, 2, y1 - y0 - 8, tc);
    g.fill(xd, mid, bx1 - xd, 1, ICE_MID);
    g.text(G.xs + 12, y0 + 14, "DELAY TAPS", tc, -1);
    g.text(G.xs + 12, y0 + 32, Math.abs(fl) < 0.01 ? "FILTER OPEN" : fl < 0 ? "LOW PASS " + Math.round(-fl * 100) + "%" : "HIGH PASS " + Math.round(fl * 100) + "%", t === "filter" ? "slot" : ICE_MID, -1, 170);
    return { n: 0, rate: 0, dur: 0, L: L };
  }
  if (!known(v, "time") || !known(v, "size") || !known(v, "density")) {
    g.text((x0 + G.x1) / 2, mid - 4, "--", ICE_MID, 0);
    return { n: 0, rate: 0, dur: 0, L: L };
  }
  var dur = grainS(size), rate = clock ? clockRate(v, dens) : grainRate(dens), n = 0;
  if (rate > 0) n = clamp(Math.round(rate * dur), 1, 32);
  var monoG = opt(v, "mono_grains", OFFON, 0) === 1;
  if (monoG && n > 1) n = 1;
  if (!n) {
    g.text((x0 + G.x1) / 2, mid - 4, dens >= 0.48 && dens <= 0.52 ? "DENSITY AT NOON: NO GRAINS" : "NO GRAINS", ICE_MID, 0);
    return { n: 0, rate: rate, dur: dur, L: L };
  }
  var hotT = t === "time" || t === "time_rnd", hotP = t === "pitch" || t === "pitch_rnd", hotS = t === "size" || t === "size_rnd" || t === "shape" || t === "shape_rnd" || t === "density";
  // where the random knobs let a grain land: Time Rnd up pulls each grain's
  // place toward anywhere in the buffer, Pitch Rnd up spreads it +-24 st (the
  // knobs turned down jump there now and then)
  var bT = Math.abs(aT), bP = Math.abs(aP);
  if (bT > 0.005 || bP > 0.005) {
    var tl = time * (1 - bT), th = time + (1 - time) * bT, pl = pyOf(pitch + 24 * bP), ph = pyOf(pitch - 24 * bP);
    g.fill(bx1 - w * th, Math.min(pl, ph) - 3, w * (th - tl) + 4, Math.abs(ph - pl) + 6, aT < 0 || aP < 0 ? "#101b26" : "#13212e");
  }
  // THE BUFFER: the grains sounding together
  var grains = [];
  for (var i = 0; i < n; i++) {
    var pos = rndParam(time, aT, i, 0), sz = rndParam(size, aS, i, 2), sh = rndParam(shape, aH, i, 4), st = rndPitch(pitch, aP, i);
    var d = grainS(sz), rev = Math.min(sz, 0.975) < 1 / 3, gw = Math.max(5, w * d * Math.pow(2, st / 12) / L), xs0 = bx1 - w * pos;
    var xa = clamp(rev ? xs0 - gw : xs0, x0, bx1 - 4), gy = Math.round(pyOf(st));
    if (xa + gw > bx1) gw = Math.max(4, bx1 - xa);
    grains.push({ sh: sh, d: d, rev: rev });
    g.fill(xa, gy - 2, gw, 5, hotT || hotP ? "slot" : i ? FROST : ICE);
    if (rev) g.fill(xa, gy - 4, 2, 9, hotT || hotP ? "slot" : ICE);
  }
  if (Math.abs(aT) < 0.005 && Math.abs(aP) < 0.005 && n > 1) g.text(Math.min(bx1 - 10, bx1 - w * time + 8), Math.round(pyOf(pitch)) - 6, "x" + n, ICE_MID, -1);
  // ONE SECOND: the stream of grains, from the first draw of the intervals
  var sx0 = G.xs + 10, sx1 = G.x1, sw = sx1 - sx0, base = y1 - 1, top = y0 + 2, win = 1;
  var gh = (base - top) * clamp(1.4 / Math.sqrt(n), 0.3, 1), at = 0, k = 0;
  while (at < win && k < 48) {
    var gi = grains[k % grains.length], d2 = gi.d, E = cached("e" + gi.sh.toFixed(2), function () { return envShape(gi.sh); }), pts = [];
    var xA = sx0 + sw * at / win, xw = Math.max(2, sw * d2 / win), steps = xw > 30 ? 16 : 8;
    for (var j = 0; j <= steps; j++) {
      var u = j / steps, xx = xA + xw * u;
      if (xx > sx1) { pts.push(sx1, base - envAt(E, gi.rev ? 1 - u : u) * gh); break; }
      pts.push(xx, base - envAt(E, gi.rev ? 1 - u : u) * gh);
    }
    if (pts.length >= 4) g.poly(pts, k === 0 ? 2 : 1.5, hotS ? "slot" : k === 0 ? ICE : FROST);
    // the next grain: a regular train, or random intervals (an exponential's
    // draw, as RenderPulseTrain's ratio), or the clock's division
    var ivl;
    if (clock) { // the clock's ticks, every n-th, or each by chance
      var tick = DIV_BEATS[opt(v, "clock_div", DIVS, 4)] * 0.5, skip = 1;
      if (dens < 0.48) skip = clockDiv(dens);
      else { var pr = clockProb(dens); while (skip < 64 && draw(k + skip, 7) > pr) skip++; }
      ivl = tick * skip;
    } else ivl = dens > 0.52 ? -Math.log(0.1 + 0.9 * draw(k, 7)) / rate : 1 / rate;
    at += Math.max(ivl, 1 / 400);
    k++;
  }
  g.text(sx0, ty, "0", ICE_DK, -1);
  g.text(sx1, ty, "1 S", ICE_DK, 1);
  return { n: n, rate: rate, dur: dur, L: L };
}
function frontPanel(g, v) {
  var t = v.$touched || "", seg = !!v.$segmode, lit = v.$segmode === "segment" ? v.$segment : "";
  g.layer(["gp", v.$page, (v.$pages || []).length, seg].join("|"), function () { panelGround(g, v, seg); });
  litTitle(g, "buffer", "BUFFER", lit === "buffer"); litTitle(g, "random", "RANDOM", lit === "random"); litTitle(g, "output", "OUTPUT", lit === "output");
  // BUFFER: freeze, the four media, the seed
  var b = BOX.buffer, bx = b[0] + 8, media = opt(v, "media", MEDIA, 1), frozen = opt(v, "freeze", OFFON, 0) === 1, clock = opt(v, "seed", SEED, 0) === 1;
  var mono = opt(v, "buffer", BUFFER, 0);
  // two push buttons with their LEDs: FREEZE, SEED (lit: on Live's clock)
  function button(y, label, on, col, hot) {
    led(g, bx + 4, y + 8, on, col);
    g.fill(bx + 12, y, 30, 16, hot ? "slot" : KNOB);
    g.text(bx + 27, y + 12, label, hot ? "#000000" : "#dfe3e6", 0);
  }
  button(TOP + 20, "FRZ", frozen, FROST, t === "freeze");
  button(TOP + 42, "SEED", clock, "#3fbf6f", t === "seed");
  for (var m = 0; m < 4; m++) {
    var my = TOP + 22 + m * 12;
    led(g, bx + 54, my, m === media && known(v, "media"), MEDIA_LED[m]);
    g.text(bx + 62, my + 4, MEDIA_SHORT[m], m === media ? (t === "media" ? "slot" : INK) : LEG_DIM, -1, 66);
  }
  g.text(bx, TOP + 76, BUF_S[media][mono] + " S " + (mono ? "MONO" : "STEREO"), t === "buffer" ? "slot" : LEG, -1, 130);
  // THE CLOUD
  var info = cloud(g, v, t), c = BOX.cloud;
  if (lit === "grains") g.text(c[0] + 8, TOP + 14, "GRAINS", "slot", -1);
  var synth = opt(v, "source", SOURCE, 0) === 1, delay = !synth && opt(v, "mode", MODE, 0) === 1, dens = density(v);
  var cap;
  if (delay) cap = "DELAY MODE";
  else if (clock) cap = dens < 0.48 ? "EVERY " + (clockDiv(dens) > 1 ? clockDiv(dens) + " x " : "") + up(DIVS[opt(v, "clock_div", DIVS, 4)]) : dens > 0.52 ? Math.round(clockProb(dens) * 100) + "% OF " + up(DIVS[opt(v, "clock_div", DIVS, 4)]) + " TICKS" : "NO GRAINS";
  else cap = info.rate > 0 ? (info.rate < 10 ? info.rate.toFixed(1) : Math.round(info.rate)) + (dens > 0.52 ? " A SECOND, RANDOM" : " A SECOND, EVEN") : "";
  var G = cloudGeom(), ty = G.y1 + 10;
  if (!delay) g.text((G.xs + 10 + G.x1) / 2, ty, cap, t === "density" ? "slot" : ICE_MID, 0, G.x1 - G.xs - 60);
  if (!delay && info.n) g.text((G.x0 + G.xs) / 2 + 6, ty, info.n + (info.n === 1 ? " GRAIN, " : " AT ONCE, ") + up(msTxt(info.dur).join(" ")) + (Math.min(num(v, "size", 0.75), 0.975) < 1 / 3 ? " BACKWARDS" : ""),
    /^size|^density/.test(t) ? "slot" : ICE_MID, 0, G.xs - G.x0 - 90);
  if (synth) g.text(G.x0 + 2, G.y0 + 8, "SYNTH VOICE: BANK " + (1 + Math.min(11, Math.floor(num(v, "feedback", 0) * 12))), FROST, -1);
  // RANDOM: the four attenuverters
  var r = BOX.random, RND = [["time_rnd", "TIME"], ["size_rnd", delay ? "FILT" : "SIZE"], ["shape_rnd", "SHAPE"], ["pitch_rnd", "PITCH"]];
  for (var i = 0; i < 4; i++) {
    var k = delay && i === 1 ? "filter" : RND[i][0], kx = r[0] + 22 + (i % 2) * 74, ky = TOP + 34 + Math.floor(i / 2) * 30, f = num(v, k, 0), hk = t === k;
    euroKnob(g, kx, ky, 8, known(v, k) ? (f + 1) / 2 : 0.5, true, hk ? "slot" : ARC, known(v, k));
    g.text(kx + 16, ky - 2, RND[i][1], hk ? "slot" : INK, -1);
    var a = att(f);
    g.text(kx + 16, ky + 9, Math.abs(a) < 0.005 ? "FIXED" : a > 0 ? "SPREAD" : "JUMPS", Math.abs(a) < 0.005 ? LEG_DIM : hk ? "slot" : LEG, -1);
  }
  // OUTPUT: feedback, dry/wet, reverb
  var o = BOX.output, OUT = [["feedback", "FBK"], ["dry_wet", "MIX"], ["reverb", "VERB"]];
  for (var j = 0; j < 3; j++) {
    var ok2 = OUT[j][0], ox = o[0] + 26 + j * 48, oy = TOP + 38, hk2 = t === ok2;
    euroKnob(g, ox, oy, 10, num(v, ok2, 0), false, hk2 ? "slot" : ARC, known(v, ok2));
    g.text(ox, oy + 25, OUT[j][1], hk2 ? "slot" : INK, 0);
  }
  var hp = num(v, "filter_hp", 0), lp = num(v, "filter_lp", 20000), dr = num(v, "drive", 0), lim = opt(v, "limiter_on", OFFON, 1) === 1;
  var wet = (hp >= 5 ? "HP " + Math.round(hp) : "") + (hp >= 5 && lp <= 19990 ? " " : "") + (lp <= 19990 ? "LP " + (lp / 1000).toFixed(1) + "K" : "");
  g.text(o[0] + 6, TOP + H - 3, (wet || "WET FULL") + (lim ? "  LIMIT" : "") + (dr > 0.05 ? "  +" + dr.toFixed(0) + "DB" : ""), LEG, -1, 140);
  // the output level, as Pung measures it (the sound itself)
  var lv = v.$live && v.$live.known ? c01(v.$live.level || 0) : 0;
  if (lv > 0.002) { var cx1 = c[0] + c[1] - 4, ly = TOP + 4, lh = H - 18; g.fill(cx1 - 2, ly + lh * (1 - lv), 2, lh * lv, FROST); }
  encoderRow(g, v);
}

// Pung's default pages on the panel's aluminium, black legends, Eurorack knobs
// the row under the Filters and Limiter bands, where a value shares its column: the
// sections already say LOW SHELF and TAPE LIMITER ("LOW BO.", "PRE GA." were cut)
var SHORT = { low_boost: "BOOST", low_freq: "FREQ", low_q: "Q", limiter_pre: "IN", limiter_post: "OUT" };
push.short(function (key) { return SHORT[key]; });
push.theme({ ground: ALU_LT, panel: KNOB, ink: INK, dim: LEG, rule: ALU_DK, faint: ALU, accent: ARC, knob: "pointer" });

var GRAINS = ["time", "size", "shape", "density", "pitch", "mode", "filter"];
push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true,
  pages: [
    { label: "Beads", keys: ["time", "size", "shape", "density", "pitch", "feedback", "reverb", "dry_wet"] },
    { label: "Random", keys: ["time_rnd", "size_rnd", "shape_rnd", "pitch_rnd", "seed", "clock_div", "freeze", "trim"] },
    { label: "Setup", keys: ["mode", "filter", "source", "media", "buffer", "dry", "mono_grains", "freeze_save"] }
  ],
  segments: [
    { id: "buffer", label: "Buffer", rect: [BOX.buffer[0], TOP, BOX.buffer[1], H], keys: ["freeze", "media", "buffer", "seed", "clock_div", "source", "trim", "freeze_save"] },
    { id: "grains", label: "Grains", rect: [BOX.cloud[0], TOP, BOX.cloud[1], H], keys: GRAINS },
    { id: "random", label: "Random", rect: [BOX.random[0], TOP, BOX.random[1], H], keys: ["time_rnd", "size_rnd", "shape_rnd", "pitch_rnd", "mono_grains"] },
    { id: "output", label: "Output", rect: [BOX.output[0], TOP, BOX.output[1], H], keys: ["feedback", "dry_wet", "reverb", "dry", "filter_hp", "filter_lp", "drive", "limiter_on"] }
  ],
  extra_keys: ["time", "size", "shape", "density", "pitch", "feedback", "reverb", "dry_wet", "time_rnd", "size_rnd", "shape_rnd", "pitch_rnd", "freeze", "media",
    "seed", "clock_div", "source", "buffer", "mode", "filter", "mono_grains", "filter_hp", "filter_lp", "drive", "limiter_on"],
  screen: frontPanel
});

// ---- FILTERS: the output path in order -------------------------------------------------------------
var FKEYS = ["filter_hp", "filter_lp", "low_boost", "low_freq", "low_q", "drive", "limiter_on", "limiter_pre", "limiter_post"];
function at20k(hz) { return c01(Math.log(Math.max(20, hz) / 20) / Math.LN10 / 3); }
push.compartment({
  id: "filters", label: "Filters",
  // each section over the encoders that play it (120 px a column): on Filters drive, the
  // two wet filters, the shelf's three; on Limiter its three, the rest summed up beside it
  pages: [
    { label: "Filters", keys: ["drive", "filter_hp", "filter_lp", "low_boost", "low_freq", "low_q"] },
    { label: "Limiter", keys: ["limiter_on", "limiter_pre", "limiter_post"] }
  ],
  extra_keys: FKEYS.concat(["dry_wet", "dry"]),
  screen: function (g, v) {
    var t = v.$touched || "", lim1 = v.$page === 1;
    function head(x, w, s) { g.fill(x, 0, w, 12, ALU); g.fill(x, 11, w, 1, LEG_DIM); g.text(x + 6, 10, s, INK, -1, w - 10); }
    g.layer("filters" + (lim1 ? "L" : "F"), function () {
      g.fill(0, 0, 952, 86, ALU_LT);
      if (lim1) { head(0, 356, "TAPE LIMITER: LAST, ON EVERYTHING"); head(360, 592, "BEFORE IT"); }
      else { head(0, 116, "IN: DRIVE"); head(120, 236, "WET ONLY: 6 DB HP + LP"); head(360, 356, "WHOLE OUTPUT: LOW SHELF"); head(720, 232, "TAPE LIMITER"); }
    });
    var dr = num(v, "drive", 0), hp = num(v, "filter_hp", 0), lp = num(v, "filter_lp", 20000);
    var lb = num(v, "low_boost", 0), lf = num(v, "low_freq", 100), lq = num(v, "low_q", 0.7), sh = /^low_/.test(t);
    var lim = opt(v, "limiter_on", OFFON, 1) === 1, pre = num(v, "limiter_pre", 0), post = num(v, "limiter_post", 0);
    function db(x) { return (x > 0.05 ? "+" : "") + x.toFixed(1) + " DB"; }
    var drTxt = dr < 0.05 ? "NOTHING CLIPS" : "TAPE SOFT CLIP";
    var shTxt = lb < 0.05 ? "NO LOW BOOST" : "BELOW " + Math.round(lf) + " HZ, Q " + lq.toFixed(1);
    if (!lim1) {
      // drive: the input's gain, dry included
      g.value(8, 46, db(dr), t === "drive" ? "slot" : INK, -1);
      g.text(8, 66, drTxt, LEG, -1, 108);
      g.text(8, 82, "DRY TOO", LEG_DIM, -1);
      // the wet path's two one-pole filters, as Pung draws them, each over its knob
      g.filter(120, 13, 116, 73, { cutoff: "filter_hp", type: hp < 5 ? "Off" : "HP 6 dB", at: at20k(hp), color: ARC });
      g.filter(240, 13, 116, 73, { cutoff: "filter_lp", type: lp > 19990 ? "Off" : "LP 6 dB", at: at20k(lp), color: ARC });
      // the shelf over its three, the limiter (next page) as it stands
      g.value(368, 46, lb < 0.05 ? "FLAT" : "+" + lb.toFixed(1) + " DB", sh ? "slot" : INK, -1);
      g.text(368, 66, shTxt, LEG, -1, 340);
      led(g, 734, 40, lim, "#3fbf6f");
      g.value(746, 46, lim ? "ON" : "OFF", INK, -1);
      g.text(728, 66, lim ? "IN " + db(pre) + "  OUT " + db(post) : "THE OUTPUT AS IT IS", LEG, -1, 220);
      g.text(728, 82, "ITS KNOBS: NEXT PAGE", LEG_DIM, -1);
    } else {
      led(g, 14, 40, lim, "#3fbf6f");
      g.value(26, 46, lim ? "ON" : "OFF", t === "limiter_on" ? "slot" : INK, -1);
      g.text(8, 66, lim ? "SOFT TAPE CLIP" : "NOTHING HOLDS", LEG, -1, 108);
      // its transfer curve over IN and OUT: the input (+-2 full scale) through PRE GAIN, the
      // engine's tape_soft_clip (a cubic soft clip into a sine shaper), then POST GAIN
      var bx = 128, by = 16, bw = 224, bh = 64, hot = /^limiter_p/.test(t);
      g.fill(bx, by, bw, bh, ALU);
      g.line(bx, by + bh / 2, bx + bw, by + bh / 2, 1, LEG_DIM); g.line(bx + bw / 2, by, bx + bw / 2, by + bh, 1, LEG_DIM);
      g.line(bx, by + bh, bx + bw, by, 1, LEG_DIM);
      var gi = Math.pow(10, pre / 20), go = Math.pow(10, post / 20), pts = [];
      for (var k = 0; k <= 48; k++) {
        var x = -2 + 4 * k / 48, y = x;
        if (lim) { var u = x * gi, a = Math.abs(u), c;
          if (a > 1.5) c = u > 0 ? 1 : -1; else { var cn = Math.max(-1, Math.min(1, u * 0.6666667)); c = (cn - cn * cn * cn / 3) * 1.5; }
          y = Math.sin(Math.min(Math.abs(c), Math.PI / 2)) * (c > 0 ? 1 : -1) * go; }
        pts.push([bx + bw * k / 48, by + bh / 2 - Math.max(-1.25, Math.min(1.25, y)) * bh / 4]);
      }
      g.poly(pts, 2, hot || t === "limiter_on" ? "slot" : ARC);
      g.text(bx + 4, by + 10, "OUT", LEG_DIM, -1); g.text(bx + bw - 4, by + bh - 4, "IN", LEG_DIM, 1);
      // the chain before it, read left to right as the sound goes
      var cells = [["DRIVE", db(dr)], ["HIGH PASS", hp < 5 ? "OFF" : Math.round(hp) + " HZ"], ["LOW PASS", lp > 19990 ? "OFF" : (lp >= 1000 ? (lp / 1000).toFixed(1) + " KHZ" : Math.round(lp) + " HZ")], ["LOW SHELF", lb < 0.05 ? "FLAT" : "+" + lb.toFixed(1) + " DB"]];
      for (var i = 0; i < cells.length; i++) {
        var x = 368 + i * 148;
        g.text(x, 34, cells[i][0], LEG, -1, 140);
        g.value(x, 58, cells[i][1], INK, -1);
      }
      g.text(368, 82, "DRIVE ON THE DRY TOO; THE FILTERS ON THE WET ONLY", LEG_DIM, -1, 580);
    }
  }
});
