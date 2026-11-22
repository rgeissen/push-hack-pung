// Weird Dreams on Push: eight analog drum voices, 64 kits, 41 voice presets.
//
// Each voice is an oscillator that morphs sine > triangle > saw > square with
// a falling pitch, and a noise through its own filter, mixed, enveloped,
// distorted. The screens are a night: indigo ground, every voice in the colour
// of its kind (kicks rose, snares amber, toms gold, hats cyan, cymbals blue,
// claps violet, percussion green, effects pink).
//
//   PANEL    the kit at once, a voice under each encoder: its preset, its
//            strike (the oscillator's first moments as its pitch falls, the
//            noise beside it as loud as the mix), pitch and decay, level and
//            pan; the card lights as its pad plays. The pages turn the eight
//            encoders across the kit: volume, pan, pitch, decay, tone, mix,
//            preset; the row a page edits is lit on every card.
//   VOICE n  one voice whole: the oscillator's strike, the amp envelope, the
//            noise filter's response and the noise envelope, the output (pan,
//            sends); the page's own part lit.
//   SPACE    every voice's reverb and delay send under its encoder, the
//            delay's echoes, the reverb.
//   BUS      the three-band EQ's curve with its bands, the DJ filter, the
//            compressor and the master.

function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function frac(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function upper(s) { return String(s).toUpperCase(); }

// ---- the night's colours ---------------------------------------------------------------
var NIGHT = "#0d0b1c", CARD = "#17142c", CARD2 = "#211d3d", RULE = "#2c2750", LAV = "#b9a7ff", LAV2 = "#7a6fae", MOON = "#f1ecda";
var KIND = ["#ff6b8b", "#ffb36b", "#ffd970", "#7fe3ff", "#8fb0ff", "#d39bff", "#7dffb0", "#ff8fd1", "#b9a7ff"];
var KINDS = ["KICK", "SNARE", "TOM", "HAT", "CYMBAL", "CLAP", "PERC", "FX", "CUSTOM"];
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;

var PRESETS = ["Sub Kick", "Punch Kick", "FM Kick", "Dusty Kick", "Long Kick", "Snare", "Snap Snare", "Fat Snare", "Crack Snare",
  "Noise Snare", "Low Tom", "Mid Tom", "High Tom", "Acid Tom", "Conga", "Closed HH", "Open HH", "Pedal HH", "Metal HH", "Trash HH",
  "Crash", "Ride", "Ride Bell", "Dark Crash", "Sizzle", "Clap 808", "Tight Clap", "Big Clap", "Dirty Clap", "Snap Clap", "Rimshot",
  "Cowbell", "Clave", "Shaker", "Tamb", "Zap", "Glitch", "Drone Hit", "Blip", "Noise Burst", "Custom"];
var KITS = ["Default", "808", "909", "LinnDrum", "CR-78", "Techno", "House", "Electro", "Hip Hop", "Trap", "DnB", "Dub", "Garage",
  "Jungle", "Breakbeat", "Reggaetn", "Afrobeat", "Disco", "Funk", "New Wave", "Synthwav", "EBM", "Footwork", "Gqom", "JrsyClub",
  "Minimal", "Industrl", "Lo-Fi", "Ambient", "Noise", "Glitch", "Metal", "Organic", "Bright", "Dark", "Fast", "Weird", "Dusty",
  "Crispy", "Heavy", "Tight", "Loose", "Saturatn", "Clean", "Punchy", "Muted", "Fizzy", "Thump", "Micro", "PercOnly", "FX Only",
  "Clap Lab", "Tom Rack", "HH Stack", "CymbWash", "KickArmy", "SnrRack", "Kick+Prc", "Snare+FX", "Tom+Cymb", "808+FX", "909+Perc",
  "DroneKit", "Chaos"];
function presetOf(v, i) { var p = Math.round(num(v, "v" + i + "_preset", 40)); return p >= 0 && p < PRESETS.length ? p : 40; }
function kindOf(v, i) { return Math.min(8, Math.floor(presetOf(v, i) / 5)); }
function colorOf(v, i) { return KIND[kindOf(v, i)]; }

// ---- values in their units, everywhere Pung writes one (weird_dreams.c) -------------------
function hz(x) { return x >= 1000 ? [(x / 1000).toFixed(x >= 10000 ? 1 : 2), "KHZ"] : [String(Math.round(x)), "HZ"]; }
function secs(x) { return x < 1 ? [String(Math.round(x * 1000 * 10) / 10), "MS"] : [x.toFixed(2), "S"]; }
function waveName(w) {
  var names = ["SINE", "TRI", "SAW", "SQUARE"], p = Math.max(0, Math.min(1, w)) * 3, i = Math.floor(p), f = p - i;
  if (i >= 3 || f < 0.04) return names[Math.min(3, i)];
  if (f > 0.96) return names[i + 1];
  return names[i] + ">" + names[i + 1];
}
function fmt(k, raw) {
  var x = parseFloat(raw), m = /^(?:v\d|cv)_(.*)$/.exec(k), p = m ? m[1] : k;
  if (p === "preset") { var n = Math.round(x); return isNaN(n) || !PRESETS[n] ? null : [upper(PRESETS[n]), ""]; }
  if (k === "kit") { var kk = Math.round(x); return isNaN(kk) || !KITS[kk] ? null : [upper(KITS[kk]), ""]; }
  if (isNaN(x)) return null;
  switch (p) {
  case "freq": case "cutoff": case "lo_freq": case "mid_freq": case "hi_freq": return hz(x);
  case "decay": case "attack": case "nattack": case "ndecay": case "prate": return secs(x);
  case "wave": return [waveName(x), ""];
  case "penv": return ["+" + Math.round(x * 1000), "HZ"];
  case "lrate": return [x.toFixed(1), "HZ"];
  case "fres": case "q_lo": case "q_mid": case "q_hi": return [x.toFixed(1), "Q"];
  case "mix": return [String(Math.round(x * 100)), "% NOISE"];
  case "dist": return [x.toFixed(1), "DB"];
  case "pan": return Math.abs(x) < 0.01 ? ["C", ""] : [(x < 0 ? "L" : "R") + Math.round(Math.abs(x) * 100), ""];
  case "eq_lo": case "eq_mid": case "eq_hi": return [(x > 0 ? "+" : "") + x.toFixed(1), "DB"];
  case "dly_rate": return [String(Math.round(10 * Math.pow(100, x))), "MS"];
  case "dly_tone": return x < 0.48 ? ["DARK " + Math.round((0.5 - x) * 200), "%"] : (x > 0.52 ? ["BRITE " + Math.round((x - 0.5) * 200), "%"] : ["CLEAN", ""]);
  case "dj_filter": return x < 0.49 ? ["LP " + Math.round((0.49 - x) / 0.49 * 100), "%"] : (x > 0.51 ? ["HP " + Math.round((x - 0.51) / 0.49 * 100), "%"] : ["OFF", ""]);
  case "same_freq": return x > 0 ? hz(x) : ["OFF", ""];
  }
  if (/^(vol|level|lamt|rsend|dsend|comp|master|rev_mix|rev_size|rev_decay|dly_mix|dly_fdbk)$/.test(p)) return [String(Math.round(x * 100)), "%"];
  return null;
}
push.display(function (k, raw) { var r = fmt(k, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
function val(v, k) {
  if (!known(v, k)) return ["--", ""];
  return fmt(k, v[k].value) || [String(v[k].display || v[k].value), String(v[k].unit || "")];
}

// ---- what plays: notes 36..43 (and 44..51) strike voices 1..8 ----------------------------
function strikes(v) {
  var out = [-1, -1, -1, -1, -1, -1, -1, -1], L = v.$live;
  if (!L || !L.known || !L.voices) return out;
  for (var i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], vi = n.note - 36;
    if (vi < 0 || vi > 15) continue;
    vi = vi % 8;
    if (out[vi] < 0 || n.age < out[vi]) out[vi] = n.age;
  }
  return out;
}
function glow(age) { return age >= 0 && age < 0.15 ? 2 : (age >= 0 && age < 0.4 ? 1 : 0); }

// ---- a voice's strike: the oscillator as its pitch falls, the noise beside it ----------------
// the oscillator morph (weird_dreams.c, osc_next)
function osc(p, w) {
  p = p - Math.floor(p);
  var sine = Math.sin(p * 2 * Math.PI), tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p, saw = 2 * p - 1, sq = p < 0.5 ? 1 : -1;
  var x = Math.max(0, Math.min(1, w)) * 3;
  if (x < 1) return sine * (1 - x) + tri * x;
  if (x < 2) return tri * (2 - x) + saw * (x - 1);
  return saw * (3 - x) + sq * (x - 2);
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 80) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function rnd(i) { var x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
// the oscillator's first `win` seconds: the pitch starts penv x 1000 Hz above and
// falls back over prate; the amp envelope rises in attack, falls over decay.
// A tone the points cannot follow is drawn as the band it fills.
function strikePts(P, x, y, w, h, win, step) {
  var top = [], bot = [], mid = y + h / 2, a = h / 2 - 1, ph = 0, n = Math.floor(w / step);
  var dt = win / n, sub = 4;
  for (var c = 0; c <= n; c++) {
    var hi = -2, lo = 2;
    for (var s = 0; s < sub; s++) {
      var t = (c + s / sub) * dt, f = P.freq + P.penv * 1000 * Math.exp(-t / Math.max(0.001, P.prate));
      var env = t < P.attack ? t / Math.max(0.0001, P.attack) : Math.exp(-4.6 * (t - P.attack) / Math.max(0.001, P.decay));
      var q;
      if (f * dt / sub > 0.3) q = env * rnd(c * 4 + s); // too fast to follow: its band
      else { q = osc(ph, P.wave) * env; }
      ph += f * dt / sub;
      q *= (1 - P.mix);
      if (q > hi) hi = q;
      if (q < lo) lo = q;
    }
    top.push(x + c * step, mid - hi * a); bot.push(x + c * step, mid - lo * a);
  }
  return [top, bot];
}
function voiceP(v, i) {
  var p = "v" + i + "_";
  return { freq: num(v, p + "freq", 100), wave: num(v, p + "wave", 0), penv: num(v, p + "penv", 0), prate: num(v, p + "prate", 0.05),
    attack: num(v, p + "attack", 0.001), decay: num(v, p + "decay", 0.3), mix: num(v, p + "mix", 0) };
}
function strikeKey(P) { return [P.freq, P.wave, P.penv, P.prate, P.attack, P.decay, P.mix].join("|"); }

// ---- the encoder row: a ring a knob, in the colour of the voice it belongs to --------------
var NAMES = { kit: "KIT", master: "MASTER", comp: "COMPRESS", dj_filter: "DJ FILTER" };
function knobName(v, k) {
  var m = /^v(\d)_(.*)$/.exec(k);
  if (m) return m[1] + " " + upper(v[k].name).replace(/^V\d /, "");
  return NAMES[k] || upper(v[k].name);
}
function encoderRow(g, v, colors) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    // a voice's key rings in the voice's colour; in segment mode the row draws above y 142 (Pung's names below)
    var vm = /^v(\d)_/.exec(k), seg = !!v.$segmode;
    var hot = k === t, c = hot ? "slot" : (colors && vm ? colorOf(v, +vm[1]) : LAV), kx = x0 + 24, ky = seg ? 128 : 139;
    g.text(x0 + 60, seg ? 114 : 120, knobName(v, k), hot ? "slot" : LAV2, 0, 112);
    g.arc(kx, ky, 11, A0, SWEEP, 3, RULE);
    if (known(v, k)) {
      var f = v[k].frac, bip = /_pan$|^eq_/.test(k);
      if (bip) { var s = Math.min(f, 0.5), e = Math.max(f, 0.5); g.arc(kx, ky, 11, A0 + s * SWEEP, Math.max(0.03, (e - s) * SWEEP), 3, c); }
      else if (f > 0.004) g.arc(kx, ky, 11, A0, f * SWEEP, 3, c);
      var a = A0 + f * SWEEP;
      g.dot(kx + Math.cos(a) * 11, ky + Math.sin(a) * 11, 3, hot ? "slot" : MOON);
    }
    var vt = val(v, k), unit = vt[1], uw = unit ? g.measure(unit) + 3 : 0, room = 74 - uw, vw = Math.min(g.measure(vt[0], "value"), room), cx = x0 + 82;
    g.value(cx - (vw + uw) / 2, seg ? 139 : 147, vt[0], hot ? "slot" : MOON, -1, room);
    if (unit) g.text(cx - (vw + uw) / 2 + vw + 3, seg ? 139 : 147, unit, LAV2, -1);
  }
}

// ---- PANEL: the kit, a voice under each encoder
function card(g, v, i, hit, rowLit, t) {
  var lit = function (n) { return rowLit === n || rowLit === "all"; }; // "all": the card is the segment
  var x = i * 120 + 4, w = 112, y = 24, h = 76, c = colorOf(v, i + 1), gl = glow(hit), p = "v" + (i + 1) + "_";
  g.fill(x, y, w, h, gl ? CARD2 : CARD);
  g.fill(x, y, w, 2, gl === 2 ? MOON : c);
  // the preset: its name in its kind's colour
  g.text(x + 6, y + 13, String(i + 1), gl === 2 ? MOON : c, -1);
  g.text(x + 16, y + 13, upper(PRESETS[presetOf(v, i + 1)]), lit("preset") ? (t === p + "preset" ? "slot" : MOON) : (gl ? MOON : LAV), -1, w - 20);
  // the strike: the oscillator falling into its pitch, the noise as loud as the mix
  var P = voiceP(v, i + 1), sx = x + 6, sy = y + 17, sw = 78, sh = 30;
  var win = Math.max(0.012, Math.min(0.15, 6 / P.freq));
  var tb = cached("c|" + i + "|" + strikeKey(P), function () { return strikePts(P, sx, sy, sw, sh, win, 2); });
  g.area(tb[0], sy + sh / 2, c); g.area(tb[1], sy + sh / 2, c);
  var nb = Math.round((sh - 4) * P.mix);
  if (nb > 0) for (var q = 0; q < 6; q++) {
    var hh = Math.max(1, Math.round(nb * (0.5 + 0.5 * Math.abs(rnd(i * 9 + q))))), nx = x + 90 + q * 3;
    g.fill(nx, sy + sh / 2 - hh / 2, 2, hh, lit("mix") ? (t === p + "mix" ? "slot" : MOON) : LAV2);
  }
  // pitch and decay, then the level with the pan
  var fr = val(v, p + "freq"), dc = val(v, p + "decay");
  var tone = rowLit === "cutoff" ? val(v, p + "cutoff") : null;
  g.text(x + 6, y + 60, tone ? (disp(v, p + "ftype") || "LP") + " " + tone[0] + " " + tone[1] : fr[0] + " " + fr[1], lit("freq") || tone ? (t === p + "freq" || t === p + "cutoff" ? "slot" : MOON) : LAV2, -1);
  if (!tone) g.text(x + w - 6, y + 60, dc[0] + " " + dc[1], lit("decay") ? (t === p + "decay" ? "slot" : MOON) : LAV2, 1);
  var vol = frac(v, p + "vol", 0.8), pan = num(v, p + "pan", 0), ly = y + 68;
  g.fill(x + 6, ly, w - 12, 3, RULE);
  g.fill(x + 6, ly, Math.round((w - 12) * vol), 3, lit("vol") ? (t === p + "vol" ? "slot" : MOON) : c);
  g.fill(x + 6 + Math.round((w - 13) * (pan + 1) / 2), ly - 3, 2, 9, lit("pan") ? (t === p + "pan" ? "slot" : MOON) : LAV2);
}
function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", hit = strikes(v);
  g.layer("wd|" + (v.$segmode || ""), function () {
    g.fill(0, 0, 960, 160, NIGHT);
    g.fill(0, 104, 960, 56, NIGHT);
    g.fill(0, 103, 960, 1, RULE);
    for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, v.$segmode ? 30 : 42, "#1c1838");
  });
  // the kit's name in the sky, the moon beside it
  g.dot(14, 10, 6, MOON); g.dot(17, 8, 5, NIGHT);
  g.text(26, 15, "WEIRD DREAMS", LAV, -1);
  var kit = Math.round(num(v, "kit", 0)), kn0 = KITS[kit] ? upper(KITS[kit]) : "--";
  g.value(126, 17, (kit < 9 ? "0" : "") + (kit + 1) + " " + kn0, t === "kit" ? "slot" : MOON, -1, 300);
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 15, upper(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LAV2, 1);
  // which row the page edits: a voice's key under each encoder
  var m = kn[0] ? /^v1_(.*)$/.exec(kn[0]) : null, row = m ? m[1] : "";
  var colors = [];
  // in a segment the voice's card is the one lit: every row on it (Pung's bar above it)
  var sm = v.$segmode === "segment" ? /^v(\d)$/.exec(v.$segment || "") : null;
  for (var i = 0; i < 8; i++) card(g, v, i, hit[i], sm ? (+sm[1] === i + 1 ? "all" : "") : row, t);
  encoderRow(g, v, true);
}
function across(p) { var out = []; for (var i = 1; i <= 8; i++) out.push("v" + i + "_" + p); return out; }
var PEXTRA = ["kit"];
var PER = ["preset", "freq", "decay", "wave", "penv", "prate", "attack", "mix", "vol", "pan", "ftype", "cutoff"];
for (var pe = 0; pe < PER.length; pe++) PEXTRA = PEXTRA.concat(across(PER[pe]));
// segments: a voice each, on its card: its sound's main knobs
var SEGS = [];
for (var sv = 1; sv <= 8; sv++) {
  var sp = "v" + sv + "_";
  SEGS.push({ id: "v" + sv, label: "Voice " + sv, rect: [(sv - 1) * 120 + 4, 24, 112, 76],
    keys: [sp + "freq", sp + "decay", sp + "wave", sp + "penv", sp + "mix", sp + "cutoff", sp + "vol", sp + "pan"] });
}
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [
    { label: "Volume", keys: across("vol") },
    { label: "Pan", keys: across("pan") },
    { label: "Pitch", keys: across("freq") },
    { label: "Decay", keys: across("decay") },
    { label: "Tone", keys: across("cutoff") },
    { label: "Noise", keys: across("mix") },
    { label: "Preset", keys: across("preset") },
    { label: "Kit", keys: ["kit", "master", "comp", "dj_filter", "rev_mix", "dly_mix", "rnd_kit", "rnd_pitch"] }
  ],
  segments: SEGS,
  draws_segments: true,
  extra_keys: PEXTRA,
  screen: panel
});

// ---- VOICE n: one voice whole ------------------------------------------------------------------------
function band(g, c) { g.fill(0, 0, 3, g.h, c); }
function axisOf(hzv) { return Math.max(0, Math.min(1, Math.log(Math.max(20, hzv) / 20) / Math.LN10 / 3)); }
function voiceScreen(i) {
  var p = "v" + i + "_";
  return function (g, v) {
    var c = colorOf(v, i), t = v.$touched || "", pg = v.$page || 0, hit = strikes(v)[i - 1];
    band(g, c);
    var P = voiceP(v, i);
    // the oscillator: its strike, and its envelope
    var lit0 = pg === 0, sx = 10, sw = 220;
    g.text(sx, 10, "OSC  " + waveName(P.wave) + "  " + val(v, p + "freq").join(" "), lit0 ? "fg" : "dim", -1);
    if (glow(hit) === 2) g.dot(sx + sw - 4, 6, 3, c);
    var tb = cached("v|" + i + "|" + strikeKey(P), function () { return strikePts(P, sx, 16, sw, 40, 0.06, 2); });
    var oc = t === p + "freq" || t === p + "wave" || t === p + "penv" || t === p + "prate" ? "slot" : c;
    g.area(tb[0], 36, oc); g.area(tb[1], 36, oc);
    g.text(sx, 66, P.penv > 0.004 ? "FALLS " + Math.round(P.penv * 1000) + " HZ IN " + val(v, p + "prate").join(" ") : "NO PITCH FALL", t === p + "penv" || t === p + "prate" ? "slot" : "dim", -1, sw);
    var la = num(v, p + "lamt", 0);
    g.text(sx, 80, la > 0.004 ? "WOBBLE " + Math.round(la * 100) + "% AT " + val(v, p + "lrate").join(" ") : "NO WOBBLE", t === p + "lamt" || t === p + "lrate" ? "slot" : "faint", -1, sw);
    g.envelope(240, 2, 220, 84, { attack: p + "attack", decay: p + "decay", color: c, still: true, labels: true });
    // the noise: its filter and its envelope
    var nx = 476;
    g.fill(nx - 8, 6, 1, 76, "line");
    var lit1 = pg === 1, ft = disp(v, p + "ftype") || "LP";
    g.text(nx, 10, "NOISE  " + Math.round(P.mix * 100) + "%  " + ft + " " + val(v, p + "cutoff").join(" "), lit1 ? "fg" : "dim", -1);
    g.filter(nx - 4, 14, 230, 72, { cutoff: p + "cutoff", at: axisOf(num(v, p + "cutoff", 1000)), resonance: p + "fres",
      type: ft === "HP" ? "HP" : (ft === "BP" ? "BandPass" : "LP 12 dB"), color: c });
    g.envelope(712, 2, 150, 84, { attack: p + "nattack", decay: p + "ndecay", color: c, still: true, labels: true });
    // the output: level, distortion, pan, sends
    var ox = 872, lit2 = pg === 2;
    g.fill(ox - 6, 6, 1, 76, "line");
    g.text(ox, 12, "OUT", lit2 ? "fg" : "dim", -1);
    var pan = num(v, p + "pan", 0);
    g.fill(ox, 24, 70, 2, RULE); g.fill(ox + 34, 21, 1, 8, LAV2);
    g.fill(ox + Math.round(68 * (pan + 1) / 2), 19, 3, 12, t === p + "pan" ? "slot" : MOON);
    var rows = [["VOL", p + "vol"], ["REV", p + "rsend"], ["DLY", p + "dsend"]];
    for (var r = 0; r < 3; r++) {
      var k = rows[r][1], f = frac(v, k, 0), yy = 44 + r * 14;
      g.text(ox, yy, rows[r][0], t === k ? "slot" : "dim", -1);
      g.fill(ox + 28, yy - 5, 42, 3, RULE); g.fill(ox + 28, yy - 5, Math.round(42 * f), 3, t === k ? "slot" : c);
    }
    g.text(ox, 84, "DIST " + val(v, p + "dist")[0], t === p + "dist" ? "slot" : "faint", -1);
  };
}
for (var vi = 1; vi <= 8; vi++) {
  var p = "v" + vi + "_";
  push.compartment({
    id: "voice" + vi, label: "Voice " + vi,
    pages: [
      { label: "V" + vi + " Osc", keys: [p + "freq", p + "wave", p + "penv", p + "prate", p + "attack", p + "decay", p + "lamt", p + "lrate"] },
      { label: "V" + vi + " Noise", keys: [p + "mix", p + "ftype", p + "cutoff", p + "fres", p + "nattack", p + "ndecay", p + "dist", p + "level"] },
      { label: "V" + vi + " Out", keys: [p + "vol", p + "pan", p + "rsend", p + "dsend", p + "preset"] }
    ],
    screen: voiceScreen(vi)
  });
}

// ---- SPACE: the sends, the delay, the reverb ---------------------------------------------------------------
push.compartment({
  id: "space", label: "Space",
  pages: [
    { label: "Reverb", keys: ["rev_mix", "rev_type", "rev_size", "rev_decay"] },
    { label: "Delay", keys: ["dly_mix", "dly_rate", "dly_fdbk", "dly_tone"] },
    { label: "Rev Sends", keys: across("rsend") },
    { label: "Dly Sends", keys: across("dsend") }
  ],
  extra_keys: across("preset"),
  screen: function (g, v) {
    band(g, LAV);
    var t = v.$touched || "", hit = strikes(v);
    // a column a voice, under its encoder: its reverb and delay sends as moons
    for (var i = 0; i < 8; i++) {
      var cx = i * 119 + 60, c = colorOf(v, i + 1), gl = glow(hit[i]);
      g.text(cx, 10, (i + 1) + " " + upper(PRESETS[presetOf(v, i + 1)]), gl ? MOON : c, 0, 110);
      var r = frac(v, "v" + (i + 1) + "_rsend", 0), d = frac(v, "v" + (i + 1) + "_dsend", 0);
      var rh = t === "v" + (i + 1) + "_rsend", dh = t === "v" + (i + 1) + "_dsend";
      g.dot(cx - 20, 30, 1.5, RULE); g.dot(cx + 20, 30, 1.5, RULE);
      if (r > 0.004) g.dot(cx - 20, 30, 2 + r * 10, rh ? "slot" : c); else if (rh) g.arc(cx - 20, 30, 6, 0, 6.3, 1.5, "slot");
      if (d > 0.004) g.dot(cx + 20, 30, 2 + d * 10, dh ? "slot" : c); else if (dh) g.arc(cx + 20, 30, 6, 0, 6.3, 1.5, "slot");
      g.text(cx - 20, 50, "R", rh ? "slot" : "faint", 0); g.text(cx + 20, 50, "D", dh ? "slot" : "faint", 0);
    }
    // the delay: its echoes; the reverb: its room in words
    var ex = 10, ew = 460, ey = 54, eh = 28, ms = 10 * Math.pow(100, num(v, "dly_rate", 0.3)) / 1000, fb = num(v, "dly_fdbk", 0.3), mix = num(v, "dly_mix", 0);
    var span = Math.max(0.2, Math.min(3, ms * 7)), dhot = /^dly_/.test(t);
    g.fill(ex, ey + eh, ew, 1, RULE);
    g.fill(ex, ey + 2, 2, eh - 2, LAV2);
    var a = Math.max(mix, 0.0001), x = ms, n = 0;
    while (x <= span && n < 40 && a > 0.015 && mix > 0) {
      var hh = Math.max(2, (eh - 2) * a);
      g.fill(ex + ew * x / span - 1, ey + eh - hh, 3, hh, dhot ? "slot" : LAV);
      a *= fb; x += ms; n++;
    }
    g.text(ex + 8, ey + 8, mix > 0 ? "DELAY " + Math.round(ms * 1000) + " MS, " + Math.round(fb * 100) + "% BACK, " + val(v, "dly_tone").join("") : "DELAY OFF", mix > 0 ? (dhot ? "fg" : "dim") : "faint", -1);
    var rx = 500, rm = num(v, "rev_mix", 0), rhot = /^rev_/.test(t);
    g.text(rx, 60, "REVERB  " + upper(disp(v, "rev_type") || "--") + (rm > 0 ? "  " + Math.round(rm * 100) + "% WET" : "  OFF"), rhot ? "fg" : (rm > 0 ? "dim" : "faint"), -1);
    g.text(rx, 76, "SIZE " + Math.round(num(v, "rev_size", 0.5) * 100) + "%   DECAY " + Math.round(num(v, "rev_decay", 0.5) * 100) + "%", rhot ? "dim" : "faint", -1);
  }
});

// ---- BUS: the EQ's curve, the DJ filter, the compressor -------------------------------------------------------
// a band's gain at f (dB): a peak for the middle, shelves at the ends (RBJ shapes, by their Q)
function bandDB(f, fc, gain, q, kind) {
  var r = Math.log(f / fc) / Math.LN2; // octaves from the band
  if (kind === 0) return gain / (1 + Math.exp(r * 3 * q));
  if (kind === 2) return gain / (1 + Math.exp(-r * 3 * q));
  return gain / (1 + Math.pow(r * q * 1.4, 2));
}
push.compartment({
  id: "bus", label: "Bus",
  pages: [
    { label: "EQ", keys: ["eq_lo", "lo_freq", "q_lo", "eq_mid", "mid_freq", "q_mid", "eq_hi", "hi_freq"] },
    { label: "Bus", keys: ["q_hi", "comp", "dj_filter", "master", "reset_eq"] }
  ],
  screen: function (g, v) {
    band(g, LAV);
    var t = v.$touched || "", x = 10, w = 600, y = 10, h = 70, mid = y + h / 2;
    var B = [[num(v, "lo_freq", 200), num(v, "eq_lo", 0), num(v, "q_lo", 0.7), 0, "LO"], [num(v, "mid_freq", 1000), num(v, "eq_mid", 0), num(v, "q_mid", 0.7), 1, "MID"],
      [num(v, "hi_freq", 5000), num(v, "eq_hi", 0), num(v, "q_hi", 0.7), 2, "HI"]];
    for (var d = 1; d < 3; d++) g.fill(x + w * d / 3, y, 1, h, "#1c1838");
    g.fill(x, mid, w, 1, RULE);
    g.text(x + 2, y + 8, "+12", "faint", -1); g.text(x + 2, y + h, "-12", "faint", -1);
    var key = B.map(function (b) { return b.slice(0, 3).join(","); }).join("|");
    var pts = cached("eq|" + key, function () {
      var out = [];
      for (var px = 0; px <= w; px += 3) {
        var f = 20 * Math.pow(1000, px / w), db = 0;
        for (var b = 0; b < 3; b++) db += bandDB(f, B[b][0], B[b][1], B[b][2], B[b][3]);
        out.push(x + px, mid - Math.max(-12, Math.min(12, db)) / 12 * (h / 2 - 2));
      }
      return out;
    });
    g.poly(pts, 2, LAV);
    var bk = [["lo_freq", "eq_lo", "q_lo"], ["mid_freq", "eq_mid", "q_mid"], ["hi_freq", "eq_hi", "q_hi"]];
    for (var b2 = 0; b2 < 3; b2++) {
      var bx = x + w * axisOf(B[b2][0]), by = mid - Math.max(-12, Math.min(12, B[b2][1])) / 12 * (h / 2 - 2);
      var hot = t === bk[b2][0] || t === bk[b2][1] || t === bk[b2][2];
      g.dot(bx, by, 5, hot ? "slot" : KIND[b2 * 3]);
      g.text(bx, by - 9, B[b2][4], hot ? "slot" : "dim", 0);
    }
    // the DJ filter, the compressor, the master
    var rx = 640, dj = num(v, "dj_filter", 0.5);
    g.fill(rx - 12, 6, 1, 76, "line");
    g.text(rx, 14, "DJ FILTER", t === "dj_filter" ? "slot" : "dim", -1);
    g.fill(rx, 26, 290, 3, RULE); g.fill(rx + 145, 22, 1, 11, LAV2);
    g.text(rx, 44, "LP", "faint", -1); g.text(rx + 290, 44, "HP", "faint", 1);
    g.fill(rx + Math.round(286 * dj), 21, 5, 13, t === "dj_filter" ? "slot" : MOON);
    g.text(rx + 145, 44, val(v, "dj_filter").join(""), dj < 0.49 || dj > 0.51 ? MOON : "faint", 0);
    var cp = num(v, "comp", 0), ms = num(v, "master", 0.8);
    g.text(rx, 64, "COMPRESS", t === "comp" ? "slot" : "dim", -1);
    g.fill(rx + 80, 59, 210, 3, RULE); g.fill(rx + 80, 59, Math.round(210 * cp), 3, t === "comp" ? "slot" : KIND[5]);
    g.text(rx, 80, "MASTER", t === "master" ? "slot" : "dim", -1);
    g.fill(rx + 80, 75, 210, 3, RULE); g.fill(rx + 80, 75, Math.round(210 * ms), 3, t === "master" ? "slot" : MOON);
  }
});

// ---- KIT and the last pad: the default view -----------------------------------------------------------------------
push.compartment({
  id: "kit", label: "Kit",
  pages: [{ label: "Kit", keys: ["kit", "rnd_kit", "rnd_voice", "rnd_pitch", "same_freq", "init_freq", "rnd_pan", "all_mono", "save_kit"] }]
});
// the cv_ keys edit the voice whose pad played last: the module's own Voice page
push.compartment({
  id: "lastpad", label: "Last Pad",
  pages: [
    { label: "Last Pad", keys: ["cv_vol", "cv_pan", "cv_freq", "cv_decay", "cv_wave", "cv_mix", "cv_cutoff", "cv_preset"] },
    { label: "Last Pad 2", keys: ["cv_attack", "cv_penv", "cv_prate", "cv_lamt", "cv_lrate", "cv_ftype", "cv_fres", "cv_nattack"] },
    { label: "Last Pad 3", keys: ["cv_ndecay", "cv_dist", "cv_level", "cv_rsend", "cv_dsend"] }
  ]
});
