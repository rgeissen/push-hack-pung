// SIMIAN on Push: a ten-voice drum synthesiser on sixteen pads, every drum an
// oscillator and a noise built, not played back. An overlay shipped with Pung
// (SIMIAN ships no push_ui.js).
//
// One SIMIAN voice is a tuned oscillator (a soft triangle that morphs into a
// struck cymbal) crossfaded with noise through a resonant low pass, a click
// over the attack, and ONE envelope that drags the pitch and the cutoff down
// as it falls (drum.dsp). Ten such drums sit on sixteen pads: six pads are a
// second pad on a drum another owns, sharing everything but their tune.
//
//   KIT      (front panel) the pads as hexagons, the pads that are one drum
//            linked, each lit as it is hit; the ten drums side by side, each
//            its strike as the engine shapes it (the tone's cycles falling in
//            pitch, the noise, the click, the envelope's fall over DECAY,
//            bent by PUNCH), its pitch and decay, where it sits between tone
//            and noise. The pages are the drums: each puts the drum's eight
//            main knobs on the encoders, and its column lights.
//   KICK.. CYMBAL  one drum whole (its Tone, Noise and Mix pages): the
//            oscillator and the bend that drags it, the noise filter (Pung's,
//            live) and its sweep, the strike, where it goes.
//
// The look: graphite, the hexagonal pads of the early-80s electronic kit,
// each drum in its own colour of the OneTrick palette.

function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function frac(v, k, d) { return known(v, k) ? v[k].frac : d; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// ---- graphite and the drums' colours ---------------------------------------------------------------
var GROUND = "#111113", CARD = "#1a1a1e", CARD_ON = "#26262c", RULE = "#2e2e35", WELL = "#0b0b0d";
var INK = "#f2f2f0", LEG = "#9b9ba4", DIMI = "#5b5b64", FAINT = "#3a3a42", KNOB = "#2c2c32";

// the ten drums (simian_plugin.cpp VOICES, PADS): the pad that owns each, its
// second pad, its colour; in the order the panel stands them
var DRUMS = [
  { id: "kick", name: "KICK", short: "BD", pad: 1, alias: 0, col: "#ff5a4e" },
  { id: "snare", name: "SNARE", short: "SD", pad: 3, alias: 4, col: "#ffad3d" },
  { id: "rim", name: "RIM", short: "RM", pad: 2, alias: 0, col: "#ffe14a" },
  { id: "clap", name: "CLAP", short: "CP", pad: 5, alias: 0, col: "#bdf04a" },
  { id: "lotom", name: "LOW TOM", short: "LT", pad: 6, alias: 10, col: "#4fe39a" },
  { id: "midtom", name: "MID TOM", short: "MT", pad: 12, alias: 16, col: "#45d6e6" },
  { id: "hitom", name: "HIGH TOM", short: "HT", pad: 9, alias: 13, col: "#5aa0ff" },
  { id: "hhcl", name: "HH CLOSED", short: "CH", pad: 7, alias: 8, col: "#a08aff" },
  { id: "hhop", name: "HH OPEN", short: "OH", pad: 11, alias: 0, col: "#da84ff" },
  { id: "cym", name: "CYMBAL", short: "CY", pad: 14, alias: 15, col: "#ff7ac8" }
];
// pad (1..16) -> the drum it plays
var PAD_DRUM = [];
DRUMS.forEach(function (d, i) { PAD_DRUM[d.pad] = i; if (d.alias) PAD_DRUM[d.alias] = i; });
function dark(c, f) { // a colour toward graphite, in flat steps
  var r = parseInt(c.substr(1, 2), 16), g = parseInt(c.substr(3, 2), 16), b = parseInt(c.substr(5, 2), 16);
  function h(x) { x = Math.round(x * f + 0x11 * (1 - f)); return (x < 16 ? "0" : "") + x.toString(16); }
  return "#" + h(r) + h(g) + h(b);
}
DRUMS.forEach(function (d) { d.dk = dark(d.col, 0.34); d.md = dark(d.col, 0.6); d.page = d.name.replace("HIGH", "HI").replace("CLOSED", "CL"); });
function K(d, k) { return "pad" + d.pad + "_" + k; }

// ---- values in SIMIAN's own units ---------------------------------------------------------------------
function hz(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + " KHZ" : Math.round(f) + " HZ"; }
function msTxt(x) { return x >= 1000 ? (x / 1000).toFixed(2) + " S" : Math.round(x) + " MS"; }
function sign(x, d) { return (x > 0 ? "+" : x < 0 ? "-" : "") + Math.abs(x).toFixed(d); }
function fmt(k, x) {
  var p = k.replace(/^pad\d+_/, "");
  switch (p) {
  case "pitch": case "cutoff": return hz(x);
  case "decay": return msTxt(x);
  case "bend": case "lp_bend": return sign(Math.round(x * 10) / 10, Math.abs(x - Math.round(x)) < 0.05 ? 0 : 1) + " ST";
  case "tune": case "transpose": return sign(Math.round(x), 0) + " ST";
  case "pan": return Math.abs(x) < 0.5 ? "C" : (x < 0 ? "L" : "R") + Math.round(Math.abs(x));
  case "volume": case "gain": case "drive": case "rev_gate": return (k === "rev_gate" && x <= -99.5) ? "OFF" : sign(Math.round(x * 10) / 10, 1) + " DB";
  case "noise": return x < 0.5 ? "TONE" : x > 99.5 ? "NOISE" : Math.round(x) + "% NOISE";
  }
  if (/^(wave|bend_dyn|lp_dyn|res|punch|click|vel_vol|sat|reverb|send_a|send_b|master_sat|rev_size|sens)$/.test(p)) return Math.round(x) + "%";
  return null;
}
push.display(function (key, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return;
  var s = fmt(key, x);
  if (s === null) return;
  var m = /^(.*?) (HZ|KHZ|MS|S|ST|DB)$/.exec(s);
  return m ? { value: m[1], unit: m[2] } : s;
});
function valueOf(v, k) {
  if (!known(v, k)) return "--";
  var s = fmt(k, num(v, k, 0));
  return s === null ? up(txt(v, k)) : s;
}
var NAMES = { pitch: "PITCH", wave: "WAVE", bend: "BEND", bend_dyn: "BEND DYN", decay: "DECAY", punch: "PUNCH", noise: "TONE/NSE",
  click: "CLICK", cutoff: "CUTOFF", res: "RES", lp_bend: "LP BEND", lp_dyn: "LP DYN", volume: "VOLUME", pan: "PAN", vel_vol: "VEL VOL",
  sat: "SAT", reverb: "REVERB", send_a: "SEND A", send_b: "SEND B", tune: "TUNE", gain: "GAIN", drive: "DRIVE", master_sat: "SAT",
  rev_size: "REV SIZE", rev_gate: "REV GATE", sens: "VEL SENS", transpose: "TRANSPOSE" };
function drumOfKey(k) { var m = /^pad(\d+)_/.exec(k); return m ? PAD_DRUM[+m[1]] : -1; }
function nameOf(k, mixed) {
  var p = k.replace(/^pad\d+_/, ""), di = drumOfKey(k), n = NAMES[p] || up(p);
  if (p === "tune" && di >= 0) { var pd = +/^pad(\d+)/.exec(k)[1]; return DRUMS[di].short + (pd === DRUMS[di].alias ? " 2" : "") + " TUNE"; }
  return mixed && di >= 0 ? DRUMS[di].short + " " + n : n;
}
// the encoders' names under a drum's band: its page says which drum ("KICK / BD
// TONE"), so "PITCH" where SIMIAN says "Kick Pitch" (the row cut it to "KICK PI.")
push.short(function (key) { return /^pad\d+_/.test(key) ? nameOf(key, false) : undefined; });

// ---- the engine (drum.dsp, shared.lib) ------------------------------------------------------------------
// One envelope: 1 ms up, then down over DECAY on SIMIAN's slope, its middle
// at lerp(PUNCH, 0.5, 0.9) (0.5: an even fall); the amplitude is its square
// (lin2LogGain), the pitch and the cutoff ride it in semitones.
function slope(u, h) { u = clamp(u, 0, 1); return u / ((1 / h - 2) * (1 - u) + 1); }
function drumOf(v, d) {
  return { pitch: num(v, K(d, "pitch"), 220), wave: num(v, K(d, "wave"), 0) / 100, bend: num(v, K(d, "bend"), 0),
    decay: num(v, K(d, "decay"), 200) / 1000, h: 0.5 + 0.4 * num(v, K(d, "punch"), 0) / 100, noise: num(v, K(d, "noise"), 25) / 100,
    click: num(v, K(d, "click"), 50) / 100, cutoff: num(v, K(d, "cutoff"), 10000), lpb: num(v, K(d, "lp_bend"), 0) };
}
// the decay as Pung's envelope takes a curve: how far down its levels the
// amplitude (the level squared) is, at 33 evenly spaced times
function slopeTable(h) {
  return cached("tab|" + h.toFixed(4), function () {
    var out = [];
    for (var i = 0; i <= 32; i++) { var L = 1 - slope(i / 32, h); out.push(1 - L * L); }
    return out;
  });
}
function levelAt(D, t) { return t < 0.001 ? t / 0.001 : 1 - slope((t - 0.001) / D.decay, D.h); }
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (++CACHED > 80) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
function rnd(i) { var x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
// the strike over its decay, w columns: per column the lowest and highest the
// voice reaches. The tone: a triangle at PITCH x 2^(BEND x env / 12), through
// the 338.6 Hz one-pole SIMIAN softens it with, morphing into the cymbal
// (noise-like) by WAVE; crossfaded into the noise by TONE/NSE; the click
// crossfades toward noise over the first 19 ms; all of it times env squared.
var NOISE = [];
for (var n_ = 0; n_ < 1024; n_++) NOISE.push(rnd(n_));
function strike(D, w) {
  var key = ["st", D.pitch, D.wave, D.bend, D.decay, D.h, D.noise, D.click, w].join("|");
  return cached(key, function () {
    var n = Math.ceil(w / 2), sub = 4, hi = [], lo = [], T = D.decay + 0.001, dt = T / (n * sub), ph = 0, k = D.bend * Math.LN2 / 12;
    for (var x = 0; x < n; x++) {
      var mx = -2, mn = 2;
      for (var s = 0; s < sub; s++) {
        var i = x * sub + s, t = i * dt, L = levelAt(D, t), f = D.pitch * Math.exp(k * L);
        var p = ph - Math.floor(ph), tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p, r = f / 338.6;
        var nz = NOISE[(i * 7 + 3) & 1023] * 0.8;
        var tone = (1 - D.wave) * tri / Math.sqrt(1 + r * r) + D.wave * NOISE[i & 1023] * 0.8;
        var ck = t < 0.001 ? t / 0.001 : Math.max(0, 1 - (t - 0.001) / 0.019), c = D.click * ck * ck;
        var q = ((tone * (1 - D.noise) + nz * D.noise) * (1 - c) + nz * c) * L * L;
        if (q > mx) mx = q;
        if (q < mn) mn = q;
        ph += f * dt;
      }
      hi.push(mx); lo.push(mn);
    }
    return { hi: hi, lo: lo, n: n, pts: {} };
  });
}
function drawStrike(g, D, x, y, w, h, col, fillc) {
  var S = strike(D, w), mid = y + h / 2, a = h / 2 - 1, gk = x + "/" + y + "/" + h, P = S.pts[gk];
  if (!P) {
    P = { t: [], b: [] };
    for (var i = 0; i < S.n; i++) { P.t.push(x + i * 2, mid - S.hi[i] * a); P.b.push(x + i * 2, mid - S.lo[i] * a); }
    S.pts[gk] = P;
  }
  // solid, as a recording's waveform is drawn: every column from its lowest to its highest
  g.area(P.t, mid + 1, col); g.area(P.b, mid, col);
}

// what plays: notes 36..51 strike pads 1..16
function hits(v) {
  var out = {}, L = v.$live;
  if (!L || !L.known || !L.voices) return out;
  for (var i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], p = n.note - 35;
    if (p < 1 || p > 16) continue;
    if (out[p] === undefined || n.age < out[p]) out[p] = n.age;
  }
  return out;
}

// ---- hexagons ------------------------------------------------------------------------------------------------
function hexPts(cx, cy, r) {
  var w = r * 0.866;
  return { top: [cx - w, cy - r / 2, cx, cy - r, cx + w, cy - r / 2], bot: [cx - w, cy + r / 2, cx, cy + r, cx + w, cy + r / 2],
    ring: [cx, cy - r, cx + w, cy - r / 2, cx + w, cy + r / 2, cx, cy + r, cx - w, cy + r / 2, cx - w, cy - r / 2, cx, cy - r] };
}
function hexFill(g, cx, cy, r, c) {
  var p = hexPts(cx, cy, r);
  g.fill(Math.round(cx - r * 0.866), Math.round(cy - r / 2), Math.round(r * 1.732), Math.round(r), c);
  g.area(p.top, cy - r / 2 + 1, c); g.area(p.bot, cy + r / 2 - 1, c);
}
function hexRing(g, cx, cy, r, w, c) { g.poly(hexPts(cx, cy, r).ring, w, c); }

// the honeycomb: pads 1..16, four to a row from the bottom, as the Move lays them
// the pad map: the Move's 4 x 4 grid, pad 1 bottom left, each pad a flat
// hexagon; a pad that owns its drum is filled and named, a second pad is the
// same drum's colour in outline, bridged to its first
var PR = 11, PH = PR * 1.732, PC_X = 22, PC_DX = 34, PC_Y = 93, PC_DY = 20;
function padXY(p) {
  var i = p - 1, row = Math.floor(i / 4), col = i % 4;
  return [PC_X + col * PC_DX, PC_Y - row * PC_DY];
}
function flatPts(cx, cy, r) {
  var h = r * 0.866;
  return { top: [cx - r, cy, cx - r / 2, cy - h, cx + r / 2, cy - h, cx + r, cy], bot: [cx - r, cy, cx - r / 2, cy + h, cx + r / 2, cy + h, cx + r, cy],
    ring: [cx - r, cy, cx - r / 2, cy - h, cx + r / 2, cy - h, cx + r, cy, cx + r / 2, cy + h, cx - r / 2, cy + h, cx - r, cy] };
}
function flatFill(g, cx, cy, r, c) { var q = flatPts(cx, cy, r); g.area(q.top, cy + 1, c); g.area(q.bot, cy, c); }
function flatRing(g, cx, cy, r, w, c) { g.poly(flatPts(cx, cy, r).ring, w, c); }

// ---- the front panel --------------------------------------------------------------------------------------------
var ROW = 104, COL_X = 152, COL_W = 80, TOP = 24, BOT = 100;
function colX(i) { return COL_X + i * COL_W; }
function panelGround(g, seg) {
  g.fill(0, 0, 960, 160, GROUND);
  g.value(8, 16, "SIMIAN", INK, -1);
  g.fill(0, 20, 960, 1, RULE);
  // the bridges: a second pad joined to the pad that owns its drum
  DRUMS.forEach(function (d) {
    if (!d.alias) return;
    var a = padXY(d.pad), b = padXY(d.alias);
    g.line(a[0], a[1], b[0], b[1], 5, d.md);
  });
  // the pads, dark in their drum's colour (a second pad in outline)
  for (var p = 1; p <= 16; p++) {
    var c = padXY(p), d = DRUMS[PAD_DRUM[p]];
    if (p === d.alias) { flatFill(g, c[0], c[1], PR - 1, GROUND); flatRing(g, c[0], c[1], PR - 2, 2, d.md); }
    else flatFill(g, c[0], c[1], PR - 1, d.md);
  }
  for (var i = 0; i < 10; i++) {
    var x = colX(i), d2 = DRUMS[i];
    g.fill(x, TOP, COL_W - 3, BOT - TOP, CARD);
    flatFill(g, x + 9, TOP + 8, 6, d2.col);
  }
  // the encoder row's well
  g.fill(0, ROW, 960, 56, WELL);
  for (var c2 = 1; c2 < 8; c2++) g.fill(c2 * 120, ROW + 8, 1, seg ? 28 : 42, RULE);
}
function knob(g, cx, cy, r, f, col, ok) {
  var a0 = Math.PI * 0.75, sw = Math.PI * 1.5;
  g.dot(cx, cy, r, KNOB);
  g.arc(cx, cy, r + 3, a0, sw, 2, FAINT);
  if (!ok) return;
  if (f > 0.005) g.arc(cx, cy, r + 3, a0, sw * f, 3, col);
  var a = a0 + sw * f;
  g.line(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, INK);
}
function encoderRow(g, v, mixed) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x = c * 120, hot = k === t, di = drumOfKey(k), col = hot ? "slot" : di >= 0 ? DRUMS[di].col : INK;
    knob(g, x + 24, seg ? ROW + 21 : ROW + 30, seg ? 9 : 12, frac(v, k, 0), col, known(v, k));
    g.text(x + 46, seg ? ROW + 13 : ROW + 21, nameOf(k, mixed), hot ? "slot" : LEG, -1, 72);
    g.value(x + 46, seg ? ROW + 31 : ROW + 41, valueOf(v, k), hot ? "slot" : INK, -1, 72);
  }
}
function drumKeys(d) { return [K(d, "pitch"), K(d, "bend"), K(d, "decay"), K(d, "punch"), K(d, "noise"), K(d, "click"), K(d, "cutoff"), K(d, "volume")]; }
function kitName(v) { var n = txt(v, "preset_name"); return n ? up(n) : "--"; }
// the panel is a function of its values: one layer keyed by them; the hits
// (pads lit, the strikes' playheads) are drawn over it
var PANEL_KEYS = [];
function signature(v, keys) {
  var out = [v.$touched || "", (v.$knobs || []).join(","), v.$page, v.$segmode || "", v.$segment || "", (v.$pages || []).length];
  for (var i = 0; i < keys.length; i++) { var x = v[keys[i]]; out.push(x && x.known ? x.value : "?"); }
  return out.join("|");
}
function selOf(v) {
  var ps = v.$pages || [], page = up(String(ps[v.$page] || "")), t = v.$touched || "";
  for (var i = 0; i < 10; i++) if (DRUMS[i].page === page) return i;
  return t ? drumOfKey(t) : -1;
}
function frontPanel(g, v) {
  g.layer("simian|" + signature(v, PANEL_KEYS), function () { panelBody(g, v); });
  var H = hits(v), sel = selOf(v), t = v.$touched || "", any = false, p;
  for (p in H) { any = true; break; }
  if (!any) return;
  for (p = 1; p <= 16; p++) {
    var age = H[p];
    if (age === undefined || age >= 0.25) continue;
    var c = padXY(p), di = PAD_DRUM[p], d = DRUMS[di];
    flatFill(g, c[0], c[1], PR - 1, age < 0.08 ? INK : d.col);
    if (p !== d.alias && t !== "pad" + p + "_tune") g.text(c[0], c[1] + 3, d.short, GROUND, 0);
  }
  for (var i = 0; i < 10; i++) {
    var dr = DRUMS[i], x = colX(i), w = COL_W - 3, ha = H[dr.pad];
    if (dr.alias && H[dr.alias] !== undefined && (ha === undefined || H[dr.alias] < ha)) ha = H[dr.alias];
    if (ha === undefined) continue;
    if (ha < 0.12) flatFill(g, x + 9, TOP + 8, 6, INK);
    var dec = num(v, K(dr, "decay"), 200) / 1000;
    if (ha < dec) g.fill(x + 2 + Math.round((w - 4) * ha / dec), TOP + 17, 1, 34, "mod");
  }
}
function panelBody(g, v) {
  var seg = !!v.$segmode, t = v.$touched || "", ps = v.$pages || [], page = String(ps[v.$page] || "");
  panelGround(g, seg);
  var H = {}, sg = v.$segmode === "segment" ? v.$segment : "";
  // the kit and the master stage, along the top
  var kn = known(v, "preset") ? Math.round(num(v, "preset", 0)) + 1 : 0;
  g.text(108, 15, (kn ? (kn < 10 ? "0" : "") + kn + " " : "") + kitName(v), INK, -1, 220);
  var mt = /^(gain|drive|master_sat|rev_size|rev_gate|sens|transpose)$/.test(t);
  g.text(seg ? 952 : 780, 15, "GAIN " + valueOf(v, "gain") + "   DRIVE " + valueOf(v, "drive") + "   SAT " + valueOf(v, "master_sat") +
    "   REVERB " + valueOf(v, "rev_size") + (num(v, "rev_gate", -100) > -99.5 ? " GATED " + valueOf(v, "rev_gate") : ""), mt || sg === "master" ? (mt ? "slot" : INK) : LEG, 1, 470);
  if (!seg && ps.length > 1) g.text(952, 15, up(page) + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  // the drum the page is about
  var sel = -1;
  for (var i = 0; i < 10; i++) if (DRUMS[i].page === up(page)) sel = i;
  if (sel < 0 && t) sel = drumOfKey(t);
  // the pad map: a pad lit as it is hit, the page's drum's pads ringed; an
  // owning pad named, a second pad's tune shown only while its knob is touched
  for (var p = 1; p <= 16; p++) {
    var c = padXY(p), di = PAD_DRUM[p], d = DRUMS[di], age = H[p], lit = age !== undefined && age < 0.25, tk = t === "pad" + p + "_tune";
    if (lit) flatFill(g, c[0], c[1], PR - 1, age < 0.08 ? INK : d.col);
    if (di === sel || tk || (sg === "pads" && p === d.alias)) flatRing(g, c[0], c[1], PR + 1, 2, tk ? "slot" : INK);
    if (tk) { var tu = Math.round(num(v, "pad" + p + "_tune", 0)); g.text(c[0], c[1] + 3, (tu > 0 ? "+" : "") + tu, "slot", 0); }
    else if (p !== d.alias) g.text(c[0], c[1] + 3, d.short, GROUND, 0);
  }
  // the ten drums
  for (i = 0; i < 10; i++) {
    var x = colX(i), dr = DRUMS[i], on = i === sel, D = drumOf(v, dr), w = COL_W - 3, hot = drumOfKey(t) === i;
    var ha = H[dr.pad] !== undefined ? H[dr.pad] : (dr.alias && H[dr.alias] !== undefined ? H[dr.alias] : undefined);
    if (dr.alias && H[dr.alias] !== undefined && (ha === undefined || H[dr.alias] < ha)) ha = H[dr.alias];
    if (on) g.fill(x, TOP, w, BOT - TOP, CARD_ON);
    if (ha !== undefined && ha < 0.12) flatFill(g, x + 9, TOP + 8, 6, INK);
    var lit = on || inSeg(sg, i);
    g.text(x + 19, TOP + 12, dr.page, lit ? INK : dr.col, -1, w - 22);
    var okd = known(v, K(dr, "decay"));
    if (okd) drawStrike(g, D, x + 2, TOP + 17, w - 4, 34, hot ? "slot" : dr.col, on ? dr.md : dr.dk);
    else { g.fill(x + 2, TOP + 34, w - 4, 1, FAINT); }
    // the strike's playhead: the time since the pad was hit, through its decay
    var tk = t === K(dr, "pitch") || t === K(dr, "bend"), dk = t === K(dr, "decay") || t === K(dr, "punch");
    // the strike spans its decay: its length stands at its end
    g.text(x + w - 3, TOP + 24, okd ? msTxt(D.decay * 1000) : "", dk ? "slot" : lit ? INK : DIMI, 1);
    g.text(x + 3, TOP + 66, okd ? (D.pitch >= 1000 ? (D.pitch / 1000).toFixed(1) + "K" : Math.round(D.pitch) + " HZ") : "--", tk ? "slot" : lit ? INK : LEG, -1);
    // (a pitch in kHz to one decimal: "1.22K" ran into the T; the knob row has it exact)
    // between tone and noise: T on the left, N on the right, the crossfade's marker
    var nz = D.noise, nh = t === K(dr, "noise"), gx = x + w - 30;
    g.text(gx - 3, TOP + 66, "T", DIMI, 1); g.text(x + w - 1, TOP + 66, "N", DIMI, 1);
    g.fill(gx, TOP + 62, 20, 2, FAINT);
    if (okd) g.fill(gx + Math.round(17 * nz), TOP + 59, 3, 8, nh ? "slot" : lit ? INK : dr.col);
  }
  encoderRow(g, v, false);
}
// the segments a column belongs to
var SEG_DRUMS = { kick: [0], snare: [1], rimclap: [2, 3], toms: [4, 5, 6], hats: [7, 8], cym: [9] };
function inSeg(sg, i) { var s = SEG_DRUMS[sg]; return !!s && s.indexOf(i) >= 0; }

var D_ = DRUMS;
var ALL_TUNES = [], ALL_DRUM = [];
for (var p_ = 1; p_ <= 16; p_++) ALL_TUNES.push("pad" + p_ + "_tune");
DRUMS.forEach(function (d) { ["pitch", "wave", "bend", "decay", "punch", "noise", "click", "cutoff", "lp_bend"].forEach(function (k) { ALL_DRUM.push(K(d, k)); }); });
function rect(i0, n) { return [colX(i0), TOP, n * COL_W - 3, BOT - TOP]; }

// Pung's own pages in graphite, the knobs as OneTrick's: a dark disc, its arc
push.theme({ ground: CARD, ink: INK, dim: LEG, rule: RULE, faint: FAINT, panel: KNOB, accent: "#ff5a4e", knob: "pointer" });

var KIT_SPEC = {
  id: "kit", label: "Kit", front_panel: true, draws_segments: true,
  pages: DRUMS.map(function (d) { return { label: d.page, keys: drumKeys(d) }; })
    .concat([{ label: "Master", keys: ["gain", "drive", "master_sat", "rev_size", "rev_gate", "sens", "transpose"] }]),
  segments: [
    { id: "pads", label: "Pads", rect: [4, TOP, 140, BOT - TOP + 2], keys: ["pad4_tune", "pad8_tune", "pad10_tune", "pad13_tune", "pad15_tune", "pad16_tune", "transpose"] },
    { id: "kick", label: "Kick", rect: rect(0, 1), keys: drumKeys(D_[0]) },
    { id: "snare", label: "Snare", rect: rect(1, 1), keys: drumKeys(D_[1]) },
    { id: "rimclap", label: "Rim Clap", rect: rect(2, 2), keys: [K(D_[2], "pitch"), K(D_[2], "decay"), K(D_[2], "noise"), K(D_[2], "volume"),
      K(D_[3], "cutoff"), K(D_[3], "decay"), K(D_[3], "click"), K(D_[3], "volume")] },
    { id: "toms", label: "Toms", rect: rect(4, 3), keys: [K(D_[4], "pitch"), K(D_[5], "pitch"), K(D_[6], "pitch"), K(D_[4], "bend"),
      K(D_[4], "decay"), K(D_[5], "decay"), K(D_[6], "decay"), K(D_[5], "bend")] },
    { id: "hats", label: "Hats", rect: rect(7, 2), keys: [K(D_[7], "pitch"), K(D_[7], "decay"), K(D_[7], "cutoff"), K(D_[7], "volume"),
      K(D_[8], "pitch"), K(D_[8], "decay"), K(D_[8], "cutoff"), K(D_[8], "volume")] },
    { id: "cym", label: "Cymbal", rect: rect(9, 1), keys: [K(D_[9], "pitch"), K(D_[9], "wave"), K(D_[9], "decay"), K(D_[9], "noise"),
      K(D_[9], "cutoff"), K(D_[9], "res"), K(D_[9], "lp_bend"), K(D_[9], "volume")] },
    { id: "master", label: "Master", rect: [0, 0, 960, 20], keys: ["gain", "drive", "master_sat", "rev_size", "rev_gate", "sens", "transpose"] }
  ],
  extra_keys: ["preset", "preset_name", "gain", "drive", "master_sat", "rev_size", "rev_gate"].concat(ALL_TUNES, ALL_DRUM),
  screen: frontPanel
};
(function () { // every key the panel reads, once
  var seen = {}, add = function (k) { if (k && !seen[k]) { seen[k] = 1; PANEL_KEYS.push(k); } };
  KIT_SPEC.pages.forEach(function (p) { p.keys.forEach(add); });
  KIT_SPEC.segments.forEach(function (s) { s.keys.forEach(add); });
  KIT_SPEC.extra_keys.forEach(add);
})();
push.compartment(KIT_SPEC);

// ---- one drum whole ------------------------------------------------------------------------------------------------
// the band: OSC (the wave WAVE morphs, the bend dragging the pitch over the
// decay), NOISE (Pung's filter on the cutoff, live; LP BEND's sweep), the
// STRIKE, and where the drum goes (pan, level, sat, sends)
var DRUM_KEYS = DRUMS.map(function (d) {
  return ["pitch", "wave", "bend", "bend_dyn", "decay", "punch", "noise", "click", "cutoff", "lp_bend", "volume", "pan", "sat", "reverb", "send_a", "send_b"]
    .map(function (k) { return K(d, k); });
});
function drumScreen(di) {
  var d = DRUMS[di];
  return function (g, v) {
    var t = v.$touched || "", D = drumOf(v, d), p = t.replace(/^pad\d+_/, "");
    // everything but the live pictures: one layer, keyed by the drum's values
    g.layer("drum" + di + "|" + signature(v, DRUM_KEYS[di]), function () { drumBody(g, v, d, D, p); });
    // NOISE: the resonant low pass (Pung's, live), and where LP BEND starts it
    var cAt = Math.log(clamp(D.cutoff, 20, 20000) / 20) / Math.log(1000);
    g.filter(240, 14, 236, 60, { cutoff: K(d, "cutoff"), at: cAt, resonance: K(d, "res"), type: "LP 12 dB", color: d.col });
    if (Math.abs(D.lpb) > 0.05) {
      var c0 = 246 + 224 * cAt, c1 = 246 + 224 * Math.log(clamp(D.cutoff * Math.pow(2, D.lpb / 12), 20, 20000) / 20) / Math.log(1000), lc = p === "lp_bend" || p === "lp_dyn" ? "slot" : INK;
      g.line(c1, 70, c0, 70, 2, lc);
      g.poly([c0 + (c1 > c0 ? 5 : -5), 66, c0, 70, c0 + (c1 > c0 ? 5 : -5), 74], 2, lc);
    }
    // the ENVELOPE, Pung's (live, every hit a dot on its clock): 1 ms up, then
    // down over DECAY on SIMIAN's slope, squared for the amplitude: the table
    // says how far down its levels it is at each moment
    g.envelope(482, 16, 148, 70, { attack: 0, decay: K(d, "decay"), curves: { decay: slopeTable(D.h) }, labels: true, color: d.col });
    var H = hits(v), age = H[d.pad] !== undefined ? H[d.pad] : H[d.alias];
    if (age !== undefined && age < D.decay) g.fill(638 + Math.round(152 * age / D.decay), 18, 1, 52, "mod");
  };
}
function drumBody(g, v, d, D, p) {
  var i;
  g.fill(0, 0, 952, 86, GROUND);
  [[0, 236, "OSCILLATOR"], [240, 236, "NOISE"], [480, 152, "ENVELOPE"], [636, 156, "THE STRIKE"], [796, 156, "OUT"]].forEach(function (s) {
    g.fill(s[0], 0, s[1], 2, d.col); g.text(s[0] + 2, 12, s[2], d.col, -1);
  });
  // which pads play it: a second pad shares everything but its tune
  g.text(948, 12, d.alias ? "PADS " + d.pad + " + " + d.alias : "PAD " + d.pad, LEG, 1);
  // OSC: one cycle of what WAVE has made of it (triangle, softened, toward the cymbal) ...
  var wv = D.wave, cy = [], ox = 8, ow = 70, my = 48;
  for (i = 0; i <= ow; i += 2) {
    var ph = i / ow, tri = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
    cy.push(ox + i, my - ((1 - wv) * tri + wv * NOISE[(i * 3) & 1023] * 0.9) * 20);
  }
  g.fill(ox, my, ow, 1, RULE);
  g.poly(cy, 2, p === "wave" ? "slot" : d.col);
  g.text(ox, 80, wv < 0.005 ? "TRIANGLE" : wv > 0.995 ? "CYMBAL" : Math.round(wv * 100) + "% CYMBAL", p === "wave" ? "slot" : LEG, -1);
  // ... and the pitch over the decay: from PITCH x 2^(BEND/12) down to PITCH on the envelope
  // (on a log scale around the drum: an octave either side of where it runs)
  var f0 = D.pitch, f1 = D.pitch * Math.pow(2, D.bend / 12), bx = 92, bw = 136, top = 22, bot = 70;
  var lo = Math.log(Math.min(f0, f1) / 2), hi = Math.log(Math.max(f0, f1) * 2);
  var fy = function (f) { return bot - (Math.log(f) - lo) / (hi - lo) * (bot - top); };
  var pp = [];
  for (i = 0; i <= bw; i += 4) { var L = levelAt(D, D.decay * i / bw); pp.push(bx + i, fy(D.pitch * Math.pow(2, D.bend * L / 12))); }
  g.fill(bx, fy(D.pitch), bw, 1, RULE);
  g.text(bx + bw, 12, "PITCH OVER " + msTxt(D.decay * 1000), LEG, 1);
  g.poly(pp, 2, p === "bend" || p === "pitch" || p === "bend_dyn" ? "slot" : d.col);
  g.text(bx + bw, 80, Math.abs(D.bend) < 0.05 ? hz(D.pitch) + " STRAIGHT" : hz(f1) + " > " + hz(D.pitch), p === "pitch" || p === "bend" ? "slot" : LEG, 1);
  g.text(244, 84, "LP " + hz(D.cutoff) + (Math.abs(D.lpb) > 0.05 ? "  SWEEP " + fmt("lp_bend", D.lpb) : ""), /cutoff|res|lp_/.test(p) ? "slot" : LEG, -1);
  // THE STRIKE: the drum as it sounds over its decay
  drawStrike(g, D, 638, 18, 152, 52, /noise|click|decay|punch/.test(p) ? "slot" : d.col, d.dk);
  g.text(638, 82, Math.round((1 - D.noise) * 100) + "% TONE, CLICK " + Math.round(D.click * 100) + "%", p === "noise" || p === "click" ? "slot" : LEG, -1);
  g.text(630, 12, (D.h > 0.505 ? "PUNCH " + Math.round((D.h - 0.5) / 0.4 * 100) + "%" : "EVEN FALL"), p === "decay" || p === "punch" ? "slot" : LEG, 1);
  // OUT: pan, level, saturation, sends
  var rows = [["volume", "LEVEL", (num(v, K(d, "volume"), 0) + 60) / 66], ["pan", "PAN", null], ["sat", "SAT", num(v, K(d, "sat"), 0) / 100],
    ["reverb", "REVERB", num(v, K(d, "reverb"), 0) / 100], ["send_a", "SEND A", num(v, K(d, "send_a"), 0) / 100], ["send_b", "SEND B", num(v, K(d, "send_b"), 0) / 100]];
  for (i = 0; i < rows.length; i++) {
    var y = 20 + i * 11, hk = p === rows[i][0], x0 = 850;
    g.text(800, y + 4, rows[i][1], hk ? "slot" : LEG, -1);
    g.fill(x0, y, 100, 3, FAINT);
    if (rows[i][2] === null) { var pn = num(v, K(d, "pan"), 0) / 100; g.fill(x0 + 49, y - 2, 1, 7, DIMI); g.fill(Math.round(x0 + 48 + pn * 48), y - 1, 4, 5, hk ? "slot" : d.col); }
    else g.fill(x0, y, Math.round(100 * clamp(rows[i][2], 0, 1)), 3, hk ? "slot" : d.col);
  }
}
DRUMS.forEach(function (d, i) {
  var tone = [K(d, "tune"), K(d, "pitch"), K(d, "wave"), K(d, "bend"), K(d, "bend_dyn"), K(d, "decay"), K(d, "punch")];
  if (d.alias) tone.push("pad" + d.alias + "_tune");
  push.compartment({
    id: d.id, label: d.name.charAt(0) + d.name.slice(1).toLowerCase(),
    pages: [
      { label: d.short + " Tone", keys: tone },
      { label: d.short + " Noise", keys: [K(d, "cutoff"), K(d, "res"), K(d, "lp_bend"), K(d, "lp_dyn"), K(d, "noise"), K(d, "click")] },
      { label: d.short + " Mix", keys: [K(d, "volume"), K(d, "pan"), K(d, "vel_vol"), K(d, "sat"), K(d, "reverb"), K(d, "send_a"), K(d, "send_b")] }
    ],
    screen: drumScreen(i)
  });
});
