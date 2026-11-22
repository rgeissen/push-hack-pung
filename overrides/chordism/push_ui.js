// Chordism on the Push: one note in, a four-voice chord out.
//
// What the module is, is the chord: a played note becomes four voices, each
// on a degree of the chord type (or the player's own intervals, or a chord per
// pitch class), spread wider or narrower, rotated across the voices, snapped
// to a scale, each voice with its own wave, level, pan and FM. So the panel
// shows the chord the engine builds (chord_on in chordism_plugin.cpp, its
// tables copied here): the four voices on top, each wired to the key it plays
// on a keyboard, the scale's notes marked, the chord named. The compartments
// are the module's own menu levels; screens where a picture says more:
//
//   CHORD        (front panel) the chord, voices to keys, filter, amp
//   OSCILLATORS  each voice's wave as its shape bends it, its degree, its FM role
//   MORPH        where the level and pan morphs put the four voices
//   MIXER        the four levels, and the FM matrix: the modulator, its carriers
//   SCALE        the scale on a keyboard from its root, or the intervals
//   CHORDMULTI   a chord for each pitch class, built on its key
//   ARP          the euclidean pattern, its variations
//
// Voice colours (coral, amber, mint, periwinkle) name the four voices on
// every screen; the slot colour is only ever the knob under a finger.

var GROUND = "#0e1320", PANEL = "#141b2b", RULE = "#2a3552", INK = "#e9eefb", INK_DIM = "#8f9bb8", LEGEND = "#b7c1da";
var KEY_W = "#c9d0de", KEY_B = "#1a2030", KEY_LINE = "#8e97aa";
var VC = ["#ff8a65", "#ffcf4d", "#4fd6a8", "#93a9ff"];

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : "--"; }
function up(s) { return String(s).toUpperCase(); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : (x === x ? x : 0); }
function hex2(n) { var s = Math.round(n).toString(16); return s.length < 2 ? "0" + s : s; }
function mixc(a, b, t) {
  var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  return "#" + hex2(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t) + hex2(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t) + hex2((pa & 255) * (1 - t) + (pb & 255) * t);
}
// an enum or int as its index, whether the module says 8 or "Maj 9"
function idx(v, k, d) {
  if (!known(v, k)) return d;
  var n = parseInt(v[k].value, 10);
  if (!isNaN(n)) return n;
  return d;
}

// ---- the engine's tables (chordism_plugin.cpp) ---------------------------------------------

var CHORDS = [[0, 12, 24, 36], [0, 7, 12, 19], [0, 3, 7, 12], [0, 3, 7, 10], [0, 3, 7, 14], [0, 3, 7, 17], [0, 4, 7, 12],
  [0, 4, 7, 11], [0, 4, 7, 14], [0, 5, 7, 12], [0, 4, 9, 14], [0, 3, 7, 9], [0, 4, 7, 16], [0, 4, 7, 10], [0, 4, 7, 13], [0, 3, 6, 10]];
var CHORD_NAMES = ["OCT", "5TH", "MIN", "MIN7", "MIN9", "MIN11", "MAJ", "MAJ7", "MAJ9", "SUS4", "6/9", "MIN6", "10TH", "7", "7B9", "M7B5"];
var SCALES = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
  [0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10],
  [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 2, 3, 4, 7, 9], [0, 3, 5, 6, 7, 10],
  [0, 2, 4, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 1, 4, 5, 7, 8, 11], [0, 1, 5, 6, 10], [0, 1, 3, 7, 8],
  [0, 2, 5, 7, 10], [0, 2, 3, 7, 8, 10], [0, 1, 5, 7, 8], [0, 2, 3, 6, 7, 8, 11], [0, 1, 3, 4, 5, 7, 8, 11], [0, 2, 4, 6, 8, 10]];
var LEVEL_LUT = [[1, 1, 1, 1], [.2, .5, .8, 1], [1, .8, .5, .2], [1, 0, 0, 0], [0, 0, 0, 1], [1, 0, 0, 1], [0, 1, 1, 0], [1, 0, 1, 0],
  [0, 1, 0, 1], [.1, .3, .7, 1], [.3, 1, 1, .3], [1, .3, .3, 1], [0, 0, .5, 1], [1, .7, .3, 0], [1, 1, .5, .5], [.5, .5, 1, 1]];
var PAN_LUT = [[0, 0, 0, 0], [-1, -.3, .3, 1], [1, .3, -.3, -1], [-1, 1, -1, 1], [1, -1, 1, -1], [-1, -1, 1, 1], [-1, 0, 0, 1],
  [0, -1, 1, 0], [-.5, .5, -.5, .5], [.5, -.5, .5, -.5], [-1, -.5, .5, 1], [0, -1, 0, 1], [0, 1, 0, -1], [-1, 1, 0, 0], [0, 0, 1, -1], [.7, -.7, -.7, .7]];
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(n) { return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
function isBlack(n) { var m = ((n % 12) + 12) % 12; return m === 1 || m === 3 || m === 6 || m === 8 || m === 10; }

// scale_quantize: the nearest degree, the lower one on a tie
function quantize(note, si, root) {
  var sc = SCALES[Math.max(0, Math.min(SCALES.length - 1, si))], rel = note - root;
  var oct = Math.floor(rel / 12), pc = rel - oct * 12, best = sc[0], bd = 99;
  for (var i = 0; i < sc.length; i++) { var d = Math.abs(pc - sc[i]); if (d < bd) { bd = d; best = sc[i]; } }
  return root + oct * 12 + best;
}
function tuningMode(v) { return idx(v, "tuning_mode", 0); }
function chordIndex(v, root) {
  var c = idx(v, "chord_type", 6);
  if (tuningMode(v) === 2 && root !== null) c = idx(v, "chord_pc_" + (((root % 12) + 12) % 12), 6);
  return Math.max(0, Math.min(15, c));
}
// chord_on: the four voices' notes for a root, as the engine builds them
function chordOf(v, root, chordOverride) {
  var mode = tuningMode(v), ivs;
  if (mode === 1) ivs = [0, idx(v, "interval_1", 4), idx(v, "interval_2", 7), idx(v, "interval_3", 12)];
  else ivs = CHORDS[chordOverride !== undefined ? chordOverride : chordIndex(v, root)];
  var spread = num(v, "chord_spread", 0.5) * 2, rot = Math.max(0, Math.min(3, Math.floor(num(v, "chord_rotation", 0) * 3.999)));
  var si = idx(v, "scale_index", 0), sr = idx(v, "scale_root", 0), out = [];
  for (var i = 0; i < 4; i++) {
    var iv = Math.trunc(ivs[(i + rot) % 4] * spread);
    if (si > 0) iv = quantize(root + iv, si, sr) - root;
    out.push(root + iv);
  }
  return out;
}
// the played note: the newest held, else the newest let go; else none
function lastNote(v) {
  var L = v.$live, best = null;
  if (!L || !L.known || !L.voices) return null;
  for (var i = 0; i < L.voices.length; i++) {
    var x = L.voices[i];
    if (!best || (x.held && !best.held) || (x.held === best.held && x.age < best.age)) best = x;
  }
  return best ? best.note : null;
}
// each voice's level: the level morph's row (interpolated, toward flat by its
// intensity) times the mixer's trim
function morphLevels(v) {
  var x = clamp01(num(v, "morph_index", 0)) * 15, lo = Math.floor(x), hi = Math.min(15, lo + 1), f = x - lo, it = num(v, "morph_intensity", 0), out = [];
  for (var i = 0; i < 4; i++) {
    var lut = LEVEL_LUT[lo][i] * (1 - f) + LEVEL_LUT[hi][i] * f;
    out.push(1 + (lut - 1) * it);
  }
  return out;
}
function morphPans(v) {
  var x = clamp01(num(v, "pan_morph_index", 0)) * 15, lo = Math.floor(x), hi = Math.min(15, lo + 1), f = x - lo, it = num(v, "pan_morph_intensity", 0), out = [];
  for (var i = 0; i < 4; i++) out.push((PAN_LUT[lo][i] * (1 - f) + PAN_LUT[hi][i] * f) * it);
  return out;
}
// where each voice sits, -1 left .. 1 right (the width spread plus the pan morph)
function pans(v) {
  var w = num(v, "width", 1), pm = morphPans(v), out = [];
  for (var i = 0; i < 4; i++) out.push(Math.max(-1, Math.min(1, ((i / 3 - 0.5) * w + pm[i] * 0.5) * 2)));
  return out;
}

// osc_sample, without the band-limiting: a voice's wave at its shape
function wavefold(x) { for (var i = 0; i < 8; i++) { if (x > 1) x = 2 - x; else if (x < -1) x = -2 - x; else break; } return x; }
function osc(w, p, s) {
  p -= Math.floor(p);
  switch (w) {
  case 1: return wavefold((1 + s * 5) * Math.sin(2 * Math.PI * p));
  case 2: var pk = Math.max(1e-4, 0.5 * (1 - s)); return p < pk ? p / pk * 2 - 1 : 1 - (p - pk) / (1 - pk) * 2;
  case 3: var p2 = p * 2 - Math.floor(p * 2); return (2 * p - 1) * (1 - s) + (2 * p2 - 1) * s;
  case 4: return p < 0.05 + s * 0.9 ? 1 : -1;
  case 5: return p < 0.02 + s * 0.28 ? 1 : -1;
  case 6: var t = Math.sin(2 * Math.PI * p), n = 1 + Math.floor(s * 7); for (var h = 2; h <= n; h++) t += Math.sin(2 * Math.PI * p * h) / h; return t * 0.5 * 1.25;
  }
  return 0;
}
var WAVE_NAMES = ["OFF", "SINE", "TRI", "SAW", "SQUARE", "PULSE", "TABLE"];
var waveMemo = {};
function wavePts(w, s, x, y, ww, hh, cycles) {
  var key = [w, Math.round(s * 100), x, y, ww, hh, cycles].join("|");
  if (waveMemo[key]) return waveMemo[key];
  var pts = [], n = Math.max(24, Math.round(ww)), mid = y + hh / 2;
  for (var i = 0; i <= n; i++) {
    var ph = i / n * cycles, val = osc(w, ph, s);
    // the square's edges stand upright
    if ((w === 4 || w === 5) && i > 0 && val !== osc(w, (i - 1) / n * cycles, s)) pts.push([x + i * ww / n, mid - osc(w, (i - 1) / n * cycles, s) * hh / 2]);
    pts.push([x + i * ww / n, mid - Math.max(-1, Math.min(1, val)) * hh / 2]);
  }
  return (waveMemo[key] = pts);
}
function waveOf(v, i) { return idx(v, "wave_" + (i + 1), 1); }
function shapeOf(v, i) { return clamp01(num(v, "shape_" + (i + 1), 0)); }

// a degree's name from its distance to the root
function degree(iv) {
  var m = ((iv % 12) + 12) % 12, o = Math.floor(iv / 12);
  var n = ["R", "B2", "2", "B3", "3", "4", "B5", "5", "#5", "6", "B7", "7"][m];
  if (o >= 1 && (m === 2 || m === 5 || m === 9)) n = ["9", "11", "13"][[2, 5, 9].indexOf(m)];
  if (o >= 1 && m === 1) n = "B9";
  if (o >= 1 && m === 4) n = "10";
  return (iv < 0 ? "-" : "") + n;
}

// ---- drawing helpers -------------------------------------------------------------------

// a keyboard from lo to hi; returns each note's x centre and the white key width
function keyboard(g, x, y, w, h, lo, hi) {
  var whites = 0, n;
  for (n = lo; n <= hi; n++) if (!isBlack(n)) whites++;
  var ww = w / whites, xs = {}, wi = 0;
  g.fill(x, y, w, h, KEY_W);
  for (n = lo; n <= hi; n++) {
    if (isBlack(n)) { xs[n] = x + wi * ww; continue; }
    xs[n] = x + (wi + 0.5) * ww;
    if (wi > 0) g.fill(Math.round(x + wi * ww), y, 1, h, KEY_LINE);
    wi++;
  }
  for (n = lo; n <= hi; n++) if (isBlack(n)) g.fill(Math.round(xs[n] - ww * 0.32), y, Math.max(3, Math.round(ww * 0.64)), Math.round(h * 0.6), KEY_B);
  return { xs: xs, ww: ww };
}
function markKey(g, kb, n, y, h, col, label) {
  var x = kb.xs[n];
  if (x === undefined) return;
  var b = isBlack(n), cy = b ? y + h * 0.6 - 5 : y + h - 6;
  g.dot(x, cy, Math.max(3.5, Math.min(5.5, kb.ww * 0.38)), col);
  if (label) g.text(x, cy + 3, label, "#0e1320", 0);
}

// ---- the panel: the chord ---------------------------------------------------------------

var VOX = { x: 240, y: 6, w: 336 }, KB = { x: 240, y: 70, w: 336, h: 30 };
var FLT = { x: 592, y: 20, w: 152, h: 80 }, AMP = { x: 760, y: 20, w: 194, h: 80 };

function panelGround(g) {
  g.layer("chord-panel", function () {
    g.fill(0, 0, 960, 160, GROUND);
    g.fill(0, 104, 960, 56, PANEL);
    g.fill(0, 104, 960, 1, RULE);
    for (var i = 1; i < 8; i++) g.fill(i * 120, 112, 1, 42, RULE);
    g.fill(230, 8, 1, 92, RULE);
    g.fill(584, 8, 1, 92, RULE);
    g.fill(752, 8, 1, 92, RULE);
  });
}

function chordTitle(v, root) {
  var mode = tuningMode(v), r = root !== null ? NOTE[((root % 12) + 12) % 12] + " " : "";
  if (mode === 1) return r + "INTERVALS";
  return r + CHORD_NAMES[chordIndex(v, root)];
}

function titleBlock(g, v, root) {
  var x = 12, t = v.$touched || "";
  g.text(x, 14, "CHORDISM", INK_DIM, -1);
  var ps = v.$pages || [];
  if (v.$segmode === "segment") { var sl = (v.$segments || []).filter(function (s) { return s.id === v.$segment; })[0]; if (sl) g.text(222, 14, up(sl.label), "slot", 1); }
  else if (ps.length > 1) g.text(222, 14, up(ps[v.$page] || "") + " " + (v.$page + 1) + "/" + ps.length, INK_DIM, 1);
  g.value(x, 35, known(v, "preset_name") ? up(v.preset_name.display || v.preset_name.value) : "--", INK, -1, 210);
  var chHot = /^chord_type|^tuning_mode|^chord_pc/.test(t), ct = chordTitle(v, root);
  g.value(x, 62, ct, chHot ? "slot" : VC[1], -1, 150);
  g.text(Math.min(x + g.measure(ct, "value"), 162) + 8, 61, root !== null ? "FROM " + noteName(root) : "SHOWN ON C3", INK_DIM, -1);
  var mode = tuningMode(v);
  g.text(x, 80, mode === 2 ? "CHORD PER KEY" : mode === 1 ? "OWN INTERVALS" : "CHORD", INK_DIM, -1);
  var si = idx(v, "scale_index", 0), scHot = /^scale/.test(t);
  g.text(x + 112, 80, si > 0 ? NOTE[idx(v, "scale_root", 0)] + " " + up(disp(v, "scale_index")) : "NO SCALE", scHot ? "slot" : INK_DIM, -1, 100);
  var sp = num(v, "chord_spread", 0.5) * 2, rot = Math.floor(num(v, "chord_rotation", 0) * 3.999);
  g.text(x, 96, "SPREAD x" + sp.toFixed(2), t === "chord_spread" ? "slot" : INK_DIM, -1);
  g.text(x + 112, 96, "ROTATE " + rot, t === "chord_rotation" ? "slot" : INK_DIM, -1);
}

// the four voices over the keys, each wired to the key it plays
function voicesToKeys(g, v, root) {
  var r = root !== null ? root : 48, notes = chordOf(v, r), lo = Math.floor(Math.min(r, notes[0], notes[1], notes[2], notes[3]) / 12) * 12;
  var hi = Math.max(lo + 35, Math.max(notes[0], notes[1], notes[2], notes[3]) + 1);
  hi = Math.min(lo + 71, hi);
  while (isBlack(hi)) hi++;
  var kb = keyboard(g, KB.x, KB.y, KB.w, KB.h, lo, hi);
  // the scale's notes, quiet
  var si = idx(v, "scale_index", 0), sr = idx(v, "scale_root", 0);
  if (si > 0) {
    var sc = SCALES[si];
    for (var n = lo; n <= hi; n++) {
      var pc = (((n - sr) % 12) + 12) % 12;
      if (sc.indexOf(pc) >= 0) g.fill(Math.round(kb.xs[n] - 1), isBlack(n) ? KB.y + 2 : KB.y + KB.h - 3, 3, 2, isBlack(n) ? "#5b6782" : "#7d8699");
    }
  }
  var lv = morphLevels(v), fm = idx(v, "fm_modulator", 0), fmOn = num(v, "fm_amount", 0) > 0, cw = VOX.w / 4, t = v.$touched || "";
  for (var i = 0; i < 4; i++) {
    var cx = VOX.x + i * cw + cw / 2, w = waveOf(v, i), off = w === 0, mix = num(v, "mix_" + (i + 1), 1);
    var col = off ? RULE : VC[i], hot = t === "wave_" + (i + 1) || t === "shape_" + (i + 1) || t === "mix_" + (i + 1);
    // the voice: its number, its wave, its level
    g.fill(VOX.x + i * cw + 4, VOX.y, 14, 13, hot ? "slot" : col);
    g.text(VOX.x + i * cw + 11, VOX.y + 10, String(i + 1), GROUND, 0);
    if (!off) g.poly(wavePts(w, shapeOf(v, i), VOX.x + i * cw + 22, VOX.y + 1, cw - 30, 12, 2), 1.6, col);
    var lvl = clamp01(lv[i] * mix);
    g.fill(VOX.x + i * cw + 4, VOX.y + 18, cw - 12, 2, RULE);
    g.fill(VOX.x + i * cw + 4, VOX.y + 18, Math.round((cw - 12) * lvl), 2, col);
    // its degree, and its part in the FM
    var nt = notes[i];
    g.text(VOX.x + i * cw + 4, VOX.y + 33, off ? "OFF" : noteName(nt), off ? INK_DIM : INK, -1);
    g.text(VOX.x + i * cw + cw - 8, VOX.y + 33, off ? "" : degree(nt - r), INK_DIM, 1);
    if (fmOn && !off) g.text(VOX.x + i * cw + 4, VOX.y + 46, i === fm ? "FM MOD" : "FM " + Math.round(num(v, "fm_amount", 0) * num(v, "fm_amount_" + (i + 1), 0.5) * 100), i === fm ? VC[i] : INK_DIM, -1);
    // the wire to its key
    var kx = kb.xs[nt];
    if (!off && kx !== undefined) {
      g.line(cx, VOX.y + (fmOn ? 50 : 38), kx, KB.y - 2, 1.5, mixc(GROUND, col, 0.75));
      markKey(g, kb, nt, KB.y, KB.h, col, "");
    }
  }
}

function filterBox(g, v) {
  var mode = disp(v, "filter_mode"), slope = disp(v, "filter_slope"), t = v.$touched || "";
  var hot = /^filter_(cutoff|resonance|mode|slope)/.test(t);
  g.text(FLT.x, 14, "FILTER", hot ? "slot" : LEGEND, -1);
  g.text(FLT.x + FLT.w, 14, up(mode === "--" ? "LP" : mode) + " " + up(slope === "--" ? "" : slope), INK_DIM, 1);
  g.filter(FLT.x - 2, FLT.y, FLT.w + 4, FLT.h, { cutoff: "filter_cutoff", resonance: "filter_resonance", type: (mode === "--" ? "LP" : mode) + " " + (slope === "--" ? "12 dB" : slope), color: INK });
}

// the amp: ASR holds while the key is down, AD falls from the peak, Looping
// starts again while held (still: no note runs it as a held note would)
function ampBox(g, v, x, y, w, h, title) {
  var m = idx(v, "vca_mode", 1), drone = idx(v, "vca_drone", 0) === 1, t = v.$touched || "";
  g.text(x, 14, title || "AMP", /^(attack|release|vca_)/.test(t) ? "slot" : LEGEND, -1);
  g.text(x + w, 14, drone ? "DRONE" : ["AD", "ASR", "LOOP"][m] || "", INK_DIM, 1);
  if (m === 0) g.envelope(x - 2, y, w + 4, h, { attack: "attack", decay: "release", sustain: 0, color: INK, labels: true });
  else if (m === 2) g.envelope(x - 2, y, w + 4, h, { attack: "attack", decay: "release", sustain: 0, color: INK, labels: true, still: true });
  else g.envelope(x - 2, y, w + 4, h, { attack: "attack", sustain: 1, release: "release", color: INK, labels: true });
}

// ---- the encoder row: gauges ---------------------------------------------------------------

// the ranges that run either side of a middle (chain_params: min -1 or -24)
var SIGNED = { filter_env_depth: 1, sweep_amount: 1, ctrl_to_cutoff: 1, ctrl_to_morph: 1, ctrl_to_vib: 1, ctrl_to_shape: 1, ctrl_to_fm: 1,
  interval_1: 1, interval_2: 1, interval_3: 1, arp_variation_interval: 1 };
function isChoice(v, k) { var d = String(v[k].display || ""); return d !== "" && isNaN(parseFloat(d)); }
function valueText(v, k) {
  if (!known(v, k)) return "--";
  return String(v[k].display || v[k].value) + (v[k].unit ? " " + v[k].unit : "");
}

// how the values read everywhere (Pung's pages too): the engine's units
// where the source says them, hundredths elsewhere
function hz(x) { return x >= 1000 ? (x / 1000).toFixed(x < 10000 ? 1 : 0) + " kHz" : x >= 10 ? Math.round(x) + " Hz" : x.toFixed(2) + " Hz"; }
function secText(s) { return s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(s < 10 ? 2 : 1) + " s"; }
push.display(function (key, raw) {
  var r = String(raw);
  if (key === "fm_modulator") return "Voice " + ((parseInt(r, 10) || 0) + 1);
  if (r.indexOf(".") < 0) return; // enums and counts: Pung's own (their names)
  var x = parseFloat(r);
  if (isNaN(x)) return;
  switch (key) {
  case "chord_spread": return "x" + (x * 2).toFixed(2);
  case "chord_rotation": return String(Math.floor(x * 3.999));
  case "attack": case "filter_env_attack": return secText(0.001 * Math.pow(16000, x));
  case "release": case "filter_env_decay": return secText(0.001 * Math.pow(16000, x));
  case "filter_cutoff": return hz(20 * Math.pow(1000, x));
  case "lfo_rate": case "filter_lfo_rate": case "lm_lfo_rate": case "pm_lfo_rate": case "amp_lfo_rate": return hz(0.02 * Math.pow(2500, x));
  case "vib_speed": return hz(0.1 * Math.pow(120, x));
  case "vib_depth": return Math.round(x * 100) + " ct";
  case "vib_delay": return secText(x * 2);
  case "detune": return "+" + Math.round(x * 50) + " ct";
  case "glide_rate": return x <= 0 ? "Off" : secText(x * 2);
  case "sweep_amount": return (x > 0 ? "+" : "") + (x * 12).toFixed(1) + " st";
  case "arp_tempo": return Math.round(30 + 210 * x) + " BPM";
  }
  return (SIGNED[key] && x > 0 ? "+" : "") + Math.round(x * 100);
});
function row(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    // in segment mode the bottom 18 pixels are Pung's: the row closes up
    var sm = !!v.$segmode, x0 = i * 120, hot = k === t, ok = known(v, k), col = hot ? "slot" : INK;
    g.text(x0 + 12, sm ? 116 : 122, up(v[k].name), hot ? "slot" : LEGEND, -1, 100);
    var f = fr(v, k, 0), gx = x0 + 12, gw = 96, gy = sm ? 122 : 130;
    if (isChoice(v, k)) {
      // a selector: the choice as a block on its track
      g.fill(gx, gy, gw, 2, RULE);
      if (ok) g.fill(gx + Math.round(f * (gw - 10)), gy - 2, 10, 6, col);
    } else {
      g.fill(gx, gy, gw, 2, RULE);
      if (ok) {
        if (SIGNED[k]) { // signed: from the middle
          var mid = gx + gw / 2, px = gx + f * gw;
          g.fill(Math.round(Math.min(mid, px)), gy - 1, Math.max(2, Math.round(Math.abs(px - mid))), 4, col);
          g.fill(Math.round(mid), gy - 3, 1, 8, INK_DIM);
        } else {
          g.fill(gx, gy - 1, Math.max(2, Math.round(f * gw)), 4, col);
        }
      }
    }
    g.value(gx, sm ? 139 : 152, valueText(v, k), hot ? "slot" : INK, -1, gw);
  }
}

// ---- segments: the panel's sections under the hands ------------------------------------------
var SEGMENTS = [
  { id: "chord", label: "Chord", rect: [2, 2, 226, 100], keys: ["chord_type", "tuning_mode", "interval_1", "interval_2", "interval_3", "detune", "glide_rate", "glide_legato"] },
  { id: "voices", label: "Voices", rect: [236, 2, 342, 20], keys: ["wave_1", "shape_1", "wave_2", "shape_2", "wave_3", "shape_3", "wave_4", "shape_4"] },
  { id: "levels", label: "Levels", rect: [236, 23, 342, 31], keys: ["mix_1", "mix_2", "mix_3", "mix_4", "fm_amount", "fm_modulator", "morph_index", "morph_intensity"] },
  { id: "keys", label: "Voicing", rect: [236, 56, 342, 46], keys: ["chord_spread", "chord_rotation", "scale_index", "scale_root", "width", "pan_morph_index", "pan_morph_intensity"] },
  { id: "filter", label: "Filter", rect: [586, 2, 164, 100], keys: ["filter_cutoff", "filter_resonance", "filter_mode", "filter_slope", "filter_env_depth", "filter_env_attack", "filter_env_decay", "drive"] },
  { id: "amp", label: "Amp", rect: [754, 2, 204, 100], keys: ["attack", "release", "vca_mode", "volume", "width", "vca_drone", "reverb_mix", "delay_mix"] }
];
// Pung's default pages in Chordism's night blue
push.theme({ ground: GROUND, panel: PANEL, ink: INK, dim: INK_DIM, rule: RULE, accent: LEGEND, knob: "ring" });
push.compartment({
  id: "chord", label: "Chord", front_panel: true, segments: SEGMENTS, draws_segments: true,
  pages: [
    { label: "Main", keys: ["chord_type", "width", "filter_cutoff", "filter_resonance", "drive", "shape", "reverb_mix", "volume"] },
    { label: "Voicing", keys: ["chord_type", "chord_spread", "chord_rotation", "detune", "scale_index", "scale_root", "tuning_mode", "glide_rate"] }
  ],
  extra_keys: ["preset_name", "chord_type", "chord_spread", "chord_rotation", "tuning_mode", "interval_1", "interval_2", "interval_3",
    "scale_index", "scale_root", "wave_1", "wave_2", "wave_3", "wave_4", "shape_1", "shape_2", "shape_3", "shape_4",
    "mix_1", "mix_2", "mix_3", "mix_4", "morph_index", "morph_intensity", "fm_modulator", "fm_amount",
    "fm_amount_1", "fm_amount_2", "fm_amount_3", "fm_amount_4", "filter_mode", "filter_slope", "filter_cutoff", "filter_resonance",
    "attack", "release", "vca_mode", "vca_drone",
    "chord_pc_0", "chord_pc_1", "chord_pc_2", "chord_pc_3", "chord_pc_4", "chord_pc_5", "chord_pc_6", "chord_pc_7",
    "chord_pc_8", "chord_pc_9", "chord_pc_10", "chord_pc_11"],
  screen: function (g, v) {
    var root = lastNote(v);
    panelGround(g);
    titleBlock(g, v, root);
    voicesToKeys(g, v, root);
    filterBox(g, v);
    ampBox(g, v, AMP.x, AMP.y, AMP.w, AMP.h);
    row(g, v);
  }
});

// ---- Oscillators: the four voices ---------------------------------------------------------
// Each voice over its two knobs (wave, shape): its wave as the shape bends it
// (osc_sample: the sine folds, the triangle leans into a saw, the saw takes
// its octave, the square's and the pulse train's widths, the table's
// partials), the degree it plays, and its part in the FM.

push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Voices", keys: ["wave_1", "shape_1", "wave_2", "shape_2", "wave_3", "shape_3", "wave_4", "shape_4"] },
    { label: "Voicing", keys: ["chord_type", "chord_spread", "chord_rotation", "detune", "width", "fm_modulator", "fm_amount", "shape"] }
  ],
  extra_keys: ["chord_type", "chord_spread", "chord_rotation", "tuning_mode", "interval_1", "interval_2", "interval_3", "scale_index", "scale_root",
    "fm_modulator", "fm_amount", "fm_amount_1", "fm_amount_2", "fm_amount_3", "fm_amount_4", "detune",
    "wave_1", "wave_2", "wave_3", "wave_4", "shape_1", "shape_2", "shape_3", "shape_4"],
  screen: function (g, v) {
    var root = lastNote(v), r = root !== null ? root : 48, notes = chordOf(v, r), t = v.$touched || "";
    var fm = idx(v, "fm_modulator", 0), fmAmt = num(v, "fm_amount", 0), det = num(v, "detune", 0);
    g.fill(0, 0, g.w, g.h, GROUND);
    for (var i = 0; i < 4; i++) {
      var x = i * 238 + 6, w = waveOf(v, i), s = shapeOf(v, i), off = w === 0, col = off ? RULE : VC[i];
      var hot = t === "wave_" + (i + 1) || t === "shape_" + (i + 1);
      if (i) g.fill(i * 238 - 1, 4, 1, 78, RULE);
      g.fill(x, 4, 16, 14, hot ? "slot" : col);
      g.text(x + 8, 15, String(i + 1), GROUND, 0);
      g.text(x + 24, 15, off ? "OFF" : WAVE_NAMES[w], col, -1);
      g.text(x + 224, 15, off ? "" : noteName(notes[i]) + "  " + degree(notes[i] - r), INK_DIM, 1);
      // the wave, two cycles
      g.fill(x, 50, 224, 1, "#1d2638");
      if (!off) {
        var pts = wavePts(w, s, x, 24, 224, 52, 2);
        g.poly(pts, hot ? 2.6 : 2, hot ? "slot" : col);
      }
      // detune: each voice a step sharper (50 cents a step at full)
      var foot = [];
      if (det > 0 && i > 0) foot.push("+" + Math.round(i * det * 50) + " CT");
      if (fmAmt > 0 && !off) foot.push(i === fm ? "FM MODULATOR" : "FM " + Math.round(fmAmt * num(v, "fm_amount_" + (i + 1), 0.5) * 100) + "%");
      g.text(x, 86, foot.join("   "), i === fm && fmAmt > 0 ? col : INK_DIM, -1, 224);
    }
  }
});

push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["filter_cutoff", "filter_resonance", "filter_mode", "filter_slope", "filter_env_attack", "filter_env_decay", "filter_env_depth", "fenv_mode"] },
    { label: "Filter LFO", keys: ["filter_lfo_rate", "filter_lfo_depth", "filter_lfo_spread", "filter_lfo_shape", "filter_lfo_mode", "fenv_hard_reset", "drive"] }
  ]
});

push.compartment({
  id: "mod", label: "Modulation",
  pages: [
    { label: "LFO & Vibrato", keys: ["lfo_shape", "lfo_rate", "lfo_depth", "shape_lfo_mode", "vib_depth", "vib_speed", "vib_delay", "vib_stray"] },
    { label: "Sweep & Glide", keys: ["sweep_amount", "sweep_rate", "glide_rate", "glide_legato", "lfo_phase_1", "lfo_phase_2", "lfo_phase_3", "lfo_phase_4"] }
  ]
});

push.compartment({
  id: "env", label: "Envelope",
  pages: [
    { label: "Amp", keys: ["attack", "release", "volume", "vca_mode", "amp_lfo_rate", "amp_lfo_depth", "vca_hard_reset", "vca_drone"] },
    { label: "Tremolo", keys: ["amp_lfo_shape"] }
  ]
});

push.compartment({
  id: "fx", label: "FX",
  pages: [
    { label: "Reverb", keys: ["reverb_mix", "reverb_decay", "reverb_damp", "reverb_shimmer", "reverb_lowcut", "reverb_size", "reverb_mod_rate", "reverb_mod_depth"] },
    { label: "Lo-Fi", keys: ["grind", "bit_shift", "decimator", "quality_position"] }
  ]
});

push.compartment({
  id: "delay", label: "Delay",
  pages: [
    { label: "Delay", keys: ["delay_mix", "delay_time", "delay_feedback", "delay_tone_hi", "delay_tone_lo", "delay_mode", "delay_mod_rate", "delay_mod_depth"] },
    { label: "Tone", keys: ["delay_tone"] }
  ]
});

// ---- Arp: the euclidean pattern ------------------------------------------------------------
// The engine's pattern (arp_euclid_recompute: step i fires when i*beats mod
// steps < beats; no beats: every step), and its variations: after each pass
// the notes move by the interval, Count times before they return.

push.compartment({
  id: "arp", label: "Arp",
  pages: [
    { label: "Arp", keys: ["arp_enabled", "arp_tempo", "arp_direction", "arp_hold", "arp_euclid_steps", "arp_euclid_beats", "arp_clock_sync", "arp_clock_division"] },
    { label: "Variations", keys: ["arp_variation_interval", "arp_variations"] }
  ],
  extra_keys: ["arp_enabled", "arp_euclid_steps", "arp_euclid_beats", "arp_variation_interval", "arp_variations", "arp_tempo", "arp_clock_sync", "arp_direction"],
  screen: function (g, v) {
    var t = v.$touched || "", on = idx(v, "arp_enabled", 0) === 1;
    var s = Math.max(1, Math.min(16, idx(v, "arp_euclid_steps", 16))), b = Math.max(0, Math.min(s, idx(v, "arp_euclid_beats", 0)));
    g.fill(0, 0, g.w, g.h, GROUND);
    var hot = t === "arp_euclid_steps" || t === "arp_euclid_beats";
    // on, and its clock (over On and Tempo)
    var bpm = Math.round(30 + 210 * num(v, "arp_tempo", 0.4)), ext = idx(v, "arp_clock_sync", 0) === 1;
    g.value(10, 34, on ? "ARP ON" : "ARP OFF", t === "arp_enabled" ? "slot" : (on ? VC[1] : INK_DIM), -1);
    g.text(10, 54, ext ? "MIDI CLOCK, " + up(disp(v, "arp_clock_division")) : bpm + " BPM, QUARTERS", t === "arp_tempo" || /^arp_clock/.test(t) ? "slot" : INK_DIM, -1);
    g.text(10, 70, idx(v, "arp_hold", 0) === 1 ? "HOLD: NOTES LATCH" : "PLAYS WHILE HELD", t === "arp_hold" ? "slot" : INK_DIM, -1);
    // the direction through the held notes (over Direction)
    var dir = idx(v, "arp_direction", 0), dx = 254, dhot = t === "arp_direction";
    var seqs = [[0, 1, 2, 3], [3, 2, 1, 0], [0, 1, 2, 3, 2, 1], [2, 0, 3, 1]], sq = seqs[Math.max(0, Math.min(3, dir))], dp = [];
    for (var q = 0; q < sq.length; q++) dp.push([dx + q * (sq.length > 4 ? 19 : 28), 66 - sq[q] * 12]);
    g.text(dx, 12, up(disp(v, "arp_direction")), dhot ? "slot" : LEGEND, -1);
    g.poly(dp, dhot ? 2.4 : 1.6, dhot ? "slot" : mixc(GROUND, VC[2], 0.6));
    for (q = 0; q < dp.length; q++) g.dot(dp[q][0], dp[q][1], 3.5, dir === 3 ? INK_DIM : VC[2]);
    // the pattern over the Steps and Beats knobs: sixteen pads, those past
    // Steps dark, the firing ones lit
    var x0 = 482, pw = 26, y = 22;
    g.text(x0, 12, b ? b + " BEATS IN " + s + " STEPS" : "EVERY STEP OF " + s, hot ? "slot" : LEGEND, -1);
    for (var i = 0; i < 16; i++) {
      var px = x0 + (i % 8) * (pw + 3), py = y + Math.floor(i / 8) * (pw + 4);
      var fire = i < s && (b === 0 || (i * b) % s < b);
      g.fill(px, py, pw, pw, i >= s ? "#121826" : fire ? (on ? VC[1] : mixc(GROUND, VC[1], 0.45)) : "#222b40");
    }
    // the variations: the transposition each pass adds (over the clock)
    var n = Math.max(1, Math.min(8, idx(v, "arp_variations", 1))), iv = idx(v, "arp_variation_interval", 0);
    var vhot = /^arp_variation/.test(t), vx = 728;
    g.text(vx, 12, n > 1 && iv !== 0 ? n + " PASSES, " + (iv > 0 ? "+" : "") + iv + " EACH" : "NO VARIATIONS", vhot ? "slot" : LEGEND, -1);
    if (n > 1 && iv !== 0) {
      var span = Math.max(1, Math.abs((n - 1) * iv)), bw = Math.min(26, Math.floor(216 / n));
      for (var k = 0; k < n; k++) {
        var o = k * iv, by = 46 - Math.round(o / span * 26 * (iv > 0 ? 1 : 1)) + (iv < 0 ? -26 : 0) + 13;
        g.fill(vx + k * bw, by, bw - 4, 4, vhot ? "slot" : VC[2]);
      }
    }
  }
});

// ---- Morph: where the level and pan morphs put the four voices ------------------------------
// Left, over the level morph's knobs: the four levels the morph's sixteen
// rows give at the index (toward flat by the intensity); right, over the pan
// morph's: where each voice sits across the stereo field.

push.compartment({
  id: "morph", label: "Morph",
  pages: [
    { label: "Morph", keys: ["morph_index", "morph_intensity", "lm_lfo_rate", "lm_lfo_depth", "pan_morph_index", "pan_morph_intensity", "pm_lfo_rate", "pm_lfo_depth"] },
    { label: "Morph LFOs", keys: ["lm_lfo_shape", "lm_lfo_mode", "pm_lfo_shape", "pm_lfo_mode"] }
  ],
  extra_keys: ["morph_index", "morph_intensity", "pan_morph_index", "pan_morph_intensity", "width", "wave_1", "wave_2", "wave_3", "wave_4"],
  screen: function (g, v) {
    var t = v.$touched || "", lv = morphLevels(v), pn = pans(v);
    g.fill(0, 0, g.w, g.h, GROUND);
    var lhot = /^(morph_|lm_)/.test(t), phot = /^(pan_morph|pm_)/.test(t);
    g.text(8, 12, "LEVEL MORPH  ROW " + (clamp01(num(v, "morph_index", 0)) * 15).toFixed(1), lhot ? "slot" : LEGEND, -1);
    // the sixteen rows the index runs through, each the four voices' levels;
    // the index between them
    var rw = 14, near = Math.round(clamp01(num(v, "morph_index", 0)) * 15);
    for (var r = 0; r < 16; r++) for (var j = 0; j < 4; j++) {
      var lvl = LEVEL_LUT[r][j], hh = Math.max(1, Math.round(lvl * 26));
      g.fill(8 + r * rw + j * 3, 78 - hh, 2, hh, r === near ? VC[j] : mixc(GROUND, VC[j], 0.4));
    }
    var ix = 8 + clamp01(num(v, "morph_index", 0)) * 15 * rw + 5;
    g.fill(Math.round(ix) - 6, 82, 13, 2, lhot ? "slot" : INK);
    g.fill(Math.round(ix), 44, 1, 38, lhot ? "slot" : INK_DIM);
    // the four levels now
    for (var i = 0; i < 4; i++) {
      var bx = 268 + i * 44, h = Math.round(clamp01(lv[i]) * 60);
      g.fill(bx, 22, 30, 60, "#182036");
      g.fill(bx, 82 - h, 30, h, waveOf(v, i) === 0 ? RULE : VC[i]);
      g.text(bx + 15, 18 + 0, String(i + 1), INK_DIM, 0);
    }
    // the stereo field
    var fx0 = 492, fw = 452, cx = fx0 + fw / 2;
    g.text(fx0, 12, "PAN MORPH", phot ? "slot" : LEGEND, -1);
    g.text(fx0, 86, "L", INK_DIM, -1); g.text(fx0 + fw, 86, "R", INK_DIM, 1);
    g.fill(fx0 + 10, 80, fw - 20, 1, RULE);
    g.fill(Math.round(cx), 22, 1, 62, RULE);
    for (i = 0; i < 4; i++) {
      var px = cx + pn[i] * (fw / 2 - 16), py = 30 + i * 13;
      g.fill(Math.round(Math.min(cx, px)), py, Math.max(1, Math.round(Math.abs(px - cx))), 2, mixc(GROUND, VC[i], 0.45));
      g.dot(px, py + 1, 5, waveOf(v, i) === 0 ? RULE : VC[i]);
      g.text(px, py + 4, String(i + 1), GROUND, 0);
    }
  }
});

// ---- Mixer: the levels and the FM matrix ------------------------------------------------------
// Left, over the four mix knobs: Pung's mixer. Right, over the four FM
// amounts: one voice is the modulator (FM Modulator); every other voice's
// phase is pushed by it, by FM Amount times its own amount (its slot on the
// modulator is unused). Post-Morph: the morph's level scales what it sends.

push.compartment({
  id: "mixer", label: "Mixer",
  pages: [
    { label: "Mix & FM", keys: ["mix_1", "mix_2", "mix_3", "mix_4", "fm_amount_1", "fm_amount_2", "fm_amount_3", "fm_amount_4"] },
    { label: "FM", keys: ["fm_amount", "fm_modulator", "fm_position", "vib_osc_enable", "sweep_osc_enable"] }
  ],
  extra_keys: ["fm_amount", "fm_modulator", "fm_position", "wave_1", "wave_2", "wave_3", "wave_4"],
  screen: function (g, v) {
    var t = v.$touched || "", fm = idx(v, "fm_modulator", 0), amt = num(v, "fm_amount", 0), post = idx(v, "fm_position", 0) === 1;
    g.fill(0, 0, g.w, g.h, GROUND);
    g.mix(4, 4, 468, 80, ["mix_1", "mix_2", "mix_3", "mix_4"], { color: LEGEND });
    var y = 52, xs = [], hot = /^fm_/.test(t);
    for (var i = 0; i < 4; i++) xs.push(480 + i * 120 + 56);
    g.text(484, 12, amt > 0 ? "FM " + Math.round(amt * 100) + "%  " + (post ? "AFTER MORPH" : "BEFORE MORPH") : "FM OFF", hot ? "slot" : LEGEND, -1);
    // the modulator's wires to each carrier, as strong as what reaches it
    for (i = 0; i < 4; i++) {
      if (i === fm) continue;
      var a = amt * num(v, "fm_amount_" + (i + 1), 0.5), x0 = xs[fm], x1 = xs[i];
      if (a <= 0) continue;
      var lift = 18 + Math.abs(i - fm) * 4, pts = [];
      for (var k = 0; k <= 16; k++) { var u = k / 16; pts.push([x0 + (x1 - x0) * u, y - 12 - Math.sin(u * Math.PI) * lift]); }
      g.poly(pts, 1 + a * 4, t === "fm_amount_" + (i + 1) ? "slot" : mixc(GROUND, VC[fm], 0.35 + 0.65 * a));
      g.dot(x1, y - 12, 3, mixc(GROUND, VC[fm], 0.8));
    }
    for (i = 0; i < 4; i++) {
      var mod = i === fm, col = waveOf(v, i) === 0 ? RULE : VC[i];
      g.fill(xs[i] - 22, y - 10, 44, 22, mod ? col : "#182036");
      g.fill(xs[i] - 22, y - 10, 44, 2, col);
      g.text(xs[i], y + 5, mod ? "MOD" : String(i + 1), mod ? GROUND : col, 0);
      g.text(xs[i], 84, mod ? "SENDS" : Math.round(num(v, "fm_amount_" + (i + 1), 0.5) * 100) + "% IN", mod ? col : INK_DIM, 0);
    }
  }
});

// ---- Scale: the scale from its root, or the intervals --------------------------------------

push.compartment({
  id: "scale", label: "Scale",
  pages: [{ label: "Scale", keys: ["scale_index", "scale_root", "tuning_mode", "interval_1", "interval_2", "interval_3"] }],
  extra_keys: ["scale_index", "scale_root", "tuning_mode", "interval_1", "interval_2", "interval_3"],
  screen: function (g, v) {
    var t = v.$touched || "", si = idx(v, "scale_index", 0), sr = idx(v, "scale_root", 0), mode = tuningMode(v);
    g.fill(0, 0, g.w, g.h, GROUND);
    // two octaves from the root, the scale's degrees lit (over Scale and Root)
    var lo = 48 + sr, kb = keyboard(g, 8, 22, 344, 56, lo - (isBlack(lo) ? 1 : 0), lo + 24);
    var sc = SCALES[Math.max(0, Math.min(24, si))];
    g.text(8, 12, si > 0 ? NOTE[sr] + " " + up(disp(v, "scale_index")) + ": CHORD NOTES SNAP TO IT" : "NO SCALE: CHORD NOTES AS THEY ARE", /^scale/.test(t) ? "slot" : LEGEND, -1);
    for (var n = lo; n <= lo + 24; n++) {
      var pc = (((n - sr) % 12) + 12) % 12, d = sc.indexOf(pc);
      if (si > 0 && d >= 0) markKey(g, kb, n, 22, 56, pc === 0 ? VC[1] : "#5d6a88", "");
    }
    // the intervals: the four voices of Interval mode, from a root
    var ix = 380, on = mode === 1, ivs = [0, idx(v, "interval_1", 4), idx(v, "interval_2", 7), idx(v, "interval_3", 12)];
    g.text(ix, 12, on ? "INTERVAL MODE: THE VOICES ARE" : (mode === 2 ? "CHORD MULTI: A CHORD PER KEY" : "CHORD MODE: INTERVALS UNUSED"), /^(tuning|interval)/.test(t) ? "slot" : LEGEND, -1);
    var kb2 = keyboard(g, ix, 22, 564, 56, 36, 84);
    for (var i = 0; i < 4; i++) {
      var note = 60 + ivs[i];
      if (note < 36 || note > 84) continue;
      markKey(g, kb2, note, 22, 56, on ? VC[i] : "#5d6a88", String(i + 1));
    }
  }
});

// ---- ChordMulti: a chord for each pitch class -----------------------------------------------
// In Chord Multi tuning the note's pitch class picks the chord. Over each
// key's knob: that pitch class and its chord, built on it.

function multiPage(label, pcs) {
  return {
    label: label, keys: pcs.map(function (p) { return "chord_pc_" + p; }),
    screen: function (g, v) {
      var t = v.$touched || "", on = tuningMode(v) === 2;
      g.fill(0, 0, g.w, g.h, GROUND);
      for (var i = 0; i < pcs.length; i++) {
        var pc = pcs[i], k = "chord_pc_" + pc, x = i * 120, hot = t === k, ci = Math.max(0, Math.min(15, idx(v, k, 6)));
        var notes = chordOf(v, 48 + pc, ci);
        g.text(x + 8, 12, NOTE[pc], hot ? "slot" : (on ? VC[1] : INK_DIM), -1);
        g.text(x + 112, 12, CHORD_NAMES[ci], hot ? "slot" : INK, 1);
        // the chord on a short keyboard from its root
        var kb = keyboard(g, x + 8, 20, 104, 60, 48 + pc - (isBlack(48 + pc) ? 1 : 0), 48 + pc + 26);
        for (var j = 0; j < 4; j++) markKey(g, kb, notes[j], 20, 60, on ? VC[j] : "#5d6a88", "");
      }
    }
  };
}
push.compartment({
  id: "chordmulti", label: "ChordMulti",
  pages: [multiPage("C to G", [0, 1, 2, 3, 4, 5, 6, 7]), multiPage("G# to B", [8, 9, 10, 11])],
  extra_keys: ["tuning_mode", "chord_spread", "chord_rotation", "scale_index", "scale_root"]
});

push.compartment({
  id: "ctrl", label: "Ctrl Src",
  pages: [{ label: "Ctrl Src", keys: ["ctrl_source", "ctrl_cc", "ctrl_to_cutoff", "ctrl_to_morph", "ctrl_to_vib", "ctrl_to_shape", "ctrl_to_fm"] }]
});

// the engine's times (env_time_exp: 1 ms .. 16 s, geometric over the knob);
// the release falls exponentially, to silence in about 1.8 of its time
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    var x = clamp01(parseFloat(s.raw)), sec = 0.001 * Math.pow(16000, x);
    if (s.key === "attack" || s.key === "filter_env_attack") return sec;
    if (s.key === "release" || s.key === "filter_env_decay") return sec * 1.84;
    return null;
  });
});
