// Essaim on the Push: a swarm of 32 self-triggering oscillators.
//
// Each of the 32 voices pulses on its own: a rhythm (Speed, in Hz, through
// its LFO shape) on its own pitch (snapped to the root and scale), through
// its own state-variable filter whose mode (LP, BP, HP) the module chose at
// random. Knobs edit one voice at a time (the last pad played) or the whole
// swarm (Same Freq, Same Speed, the randomizers). So the panel shows the
// swarm itself, read from the module's `state` (every voice's speed,
// frequency, filter mode, cutoff and volume):
//
// - a field: each voice a firefly, across by how fast it pulses (log Hz),
//   up by the note it sings, as big as it is loud, coloured by its filter
//   (LP amber, BP lime, HP cyan), the voice on the knobs ringed. Same
//   Speed stands the swarm in a column, Same Freq lays it in a row;
// - the voice on the knobs: its rhythm (Pung's LFO in its shape, at its
//   speed), its filter (Pung's, the voice's own mode and Q), its envelope;
// - the encoder row as rings of dots, a swarm of their own.
//
// FX is the output chain (essaim.c render_block): the pitch shift, the
// saturator's curve, the DJ filter, the delay's echoes.

var GROUND = "#0a1210", PANEL = "#0f1a17", RULE = "#22362f", FAINT = "#162621", INK = "#e4f2e6", INK_DIM = "#86a397", LEGEND = "#aac4b8";
var MODE_COL = ["#ffb547", "#c6f04a", "#5ee0ff"], MODE_NAME = ["LP", "BP", "HP"], GLOW = "#c6f04a";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : "--"; }
function raw(v, k) { return known(v, k) ? String(v[k].value) : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : (x === x ? x : 0); }
// where the sound has a control now (v[k].now: Essaim's live_mod, the selected
// voice's speed, cutoff and volume as its rhythm LFO and drift move them; null
// when nothing moves it), 0..1 and in the key's own units; the pictures draw the
// sound's, the knobs keep their marks, the sound's beside them in cyan
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? clamp01(v[k].now) : null; }
function moved(v, k) { var n = nowOf(v, k); return n !== null && Math.abs(n - clamp01(v[k].frac)) > 0.004; }
function lnum(v, k, d) { var n = nowOf(v, k); return n === null || !(v[k].max > v[k].min) ? num(v, k, d) : v[k].min + n * (v[k].max - v[k].min); }
function filterNow(g, x, y, w, h, knobAt, soundAt, ink) {   // a g.filter given at: (the sound's): the knob's place and the way there
  if (Math.abs(soundAt - knobAt) <= 0.002) return;
  var x0 = x + 6, x1 = x + w - 6, b = y + h - 6, xs = x0 + (x1 - x0) * knobAt, xc = x0 + (x1 - x0) * soundAt;
  g.fill(xs, b - 7, 2, 7, ink);
  g.line(xs, b - 2, xc, b - 2, 2, MOD_DK);
  g.dot(xc, b - 2, 3, MOD);
}
function hex2(n) { var s = Math.round(n).toString(16); return s.length < 2 ? "0" + s : s; }
function mixc(a, b, t) {
  var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  return "#" + hex2(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t) + hex2(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t) + hex2((pa & 255) * (1 - t) + (pb & 255) * t);
}

// ---- the engine (essaim.c) ---------------------------------------------------------------

var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var SCALES = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 7, 8, 11]];
var SCALE_NAMES = ["Chromatic", "Major", "Minor", "Pentatonic", "Whole Tone", "Harm Minor"];
var TRANSPOSE = [-36, -24, -12, -4, 0, 4, 7, 12, 24], TRANSPOSE_NAMES = ["-3oct", "-2oct", "-1oct", "-3rd", "0", "+3rd", "+5th", "+1oct", "+2oct"];
var LFO_NAMES = ["Sine", "Triangle", "Soft Saw", "Soft Square", "Skewed Sine", "Warm Pulse"];
var LFO_PUNG = ["Sine", "Triangle", "Saw Up", "Square", "Sine", "Pulse"];
function noteName(n) { n = Math.round(n); return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
function nameIndex(v, k, names, d) {
  if (!known(v, k)) return d;
  // the module answers names ("0" is a transpose's name, not its index)
  var s = String(v[k].value).trim(), i = names.indexOf(s);
  if (i >= 0) return i;
  var n = parseInt(s, 10);
  return String(n) === s && n >= 0 && n < names.length ? n : d;
}
// quantize_to_scale: Frequency (0..1) is 84 semitones above the root's
// second octave, snapped to the nearest degree
function voiceNote(freq, octave, root, scale) {
  var semis = freq * 84, sc = SCALES[scale] || SCALES[0], oct = Math.floor(semis / 12), rem = semis - oct * 12, best = 999, deg = 0;
  for (var i = 0; i < sc.length; i++) {
    var d = Math.abs(rem - sc[i]), dw = Math.abs(rem - (sc[i] + 12));
    if (dw < d) { if (dw < best) { best = dw; deg = sc[i] + 12; } } else if (d < best) { best = d; deg = sc[i]; }
  }
  return root + 12 + oct * 12 + deg + octave * 12;
}
function cutoffHz(c) { return 30 * Math.pow(433, c * c); }
function cutoffAt(c) { return clamp01(Math.log(cutoffHz(c) / 20) / Math.log(1000)); }

// every voice, from `state`: "root scale transpose sat filter dmix drate dfb
// dtone dmode mono fine drone" then per voice "speed mod decay timbre freq
// noise cutoff volume svf_mode svf_q pan lfo_shape mod_dest attack octave"
var swarmMemo = { s: null, out: null };
function swarm(v) {
  var s = raw(v, "state");
  if (!s) return null;
  if (s === swarmMemo.s) return swarmMemo.out;
  var f = s.trim().split(/\s+/), out = [];
  for (var i = 0; i < 32; i++) {
    var o = 13 + i * 15;
    if (f.length < o + 15) break;
    out.push({ speed: +f[o], mod: +f[o + 1], decay: +f[o + 2], timbre: +f[o + 3], freq: +f[o + 4], noise: +f[o + 5], cutoff: +f[o + 6],
      volume: +f[o + 7], mode: Math.max(0, Math.min(2, +f[o + 8] | 0)), q: +f[o + 9], pan: +f[o + 10], lfo: +f[o + 11] | 0, dest: +f[o + 12] | 0,
      attack: +f[o + 13], octave: +f[o + 14] | 0 });
  }
  swarmMemo = { s: s, out: out.length === 32 ? out : null };
  return swarmMemo.out;
}
// the voice on the knobs: the one whose values these are
function currentVoice(v, sw) {
  if (!sw || !known(v, "speed")) return -1;
  var sp = num(v, "speed", 0), fq = num(v, "frequency", 0), dc = num(v, "decay", 0), md = num(v, "mod", 0), best = -1, bd = 1e9;
  for (var i = 0; i < 32; i++) {
    var d = Math.abs(sw[i].speed - sp) + Math.abs(sw[i].freq - fq) + Math.abs(sw[i].decay - dc) + Math.abs(sw[i].mod - md);
    if (d < bd) { bd = d; best = i; }
  }
  return bd < 0.01 ? best : -1;
}

// ---- how its values read ---------------------------------------------------------------

function pct(x) { return Math.round(x * 100) + "%"; }
function ms(sec) { return sec < 1 ? Math.round(sec * 1000) + " ms" : sec.toFixed(2) + " s"; }
push.display(function (key, r) {
  var n = parseFloat(r);
  if (/^rnd_|^init_freq$/.test(key)) return "Turn";
  // the module answers names; "0" is a name here, not an index
  if (key === "transpose" && TRANSPOSE_NAMES.indexOf(String(r)) >= 0) return String(r);
  if (key === "v_octave" && ["-3", "-2", "-1", "0", "+1", "+2"].indexOf(String(r)) >= 0) return String(r) + " oct";
  if (isNaN(n)) return;
  switch (key) {
  case "speed": case "same_speed": return n.toFixed(n < 10 ? 2 : 1) + " Hz";
  case "mod": return (n >= 0.5 ? "+" : "") + Math.round((n - 0.5) * 200) + "%";
  case "decay": case "v_attack": case "dly_rate": return ms(n);
  case "cutoff": var hz = cutoffHz(n); return hz >= 1000 ? (hz / 1000).toFixed(1) + " kHz" : Math.round(hz) + " Hz";
  case "v_pan": return Math.abs(n) < 0.01 ? "C" : (n < 0 ? "L" : "R") + Math.round(Math.abs(n) * 100);
  case "fine": var st = n * 12; return Math.abs(st) < 0.05 ? "0 st" : (st > 0 ? "+" : "") + st.toFixed(1) + " st";
  case "filter": return n < 0.49 ? "LP " + Math.round((0.49 - n) / 0.49 * 100) + "%" : n > 0.51 ? "HP " + Math.round((n - 0.51) / 0.49 * 100) + "%" : "Off";
  case "timbre": case "frequency": case "same_freq": case "noisiness": case "volume": case "saturation": case "dly_mix": case "dly_feedback": case "dly_tone":
    return pct(n);
  }
});

// the voice's envelope: a one-pole rise to the top while the pad is held
// (its attack the time constant: three of them to get there), and a fall
// with Decay as its time constant when let go (to -60 dB in 6.9 of them)
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    var x = parseFloat(s.raw);
    if (isNaN(x)) return null;
    if (s.key === "v_attack") return x * 3;
    if (s.key === "decay") return x * 6.9;
    return null;
  });
});

// ---- the panel: the swarm ---------------------------------------------------------------

var FIELD = { x: 214, y: 10, w: 400, h: 84 }, SPMIN = 0.1, SPMAX = 40, NLO = 24, NHI = 108;
function sx(sp) { return FIELD.x + Math.log(Math.max(SPMIN, Math.min(SPMAX, sp)) / SPMIN) / Math.log(SPMAX / SPMIN) * FIELD.w; }
function ny(n) { return FIELD.y + FIELD.h - (Math.max(NLO, Math.min(NHI, n)) - NLO) / (NHI - NLO) * FIELD.h; }
var RIGHT = { x: 630 };

function ground(g) {
  g.layer("essaim", function () {
    g.fill(0, 0, 960, 160, GROUND);
    g.fill(0, 104, 960, 56, PANEL);
    g.fill(0, 104, 960, 1, RULE);
    for (var i = 1; i < 8; i++) g.fill(i * 120, 112, 1, 42, RULE);
    g.fill(204, 8, 1, 92, RULE);
    g.fill(622, 8, 1, 92, RULE);
    // the field's grid: octaves up, speeds across
    for (var n = 36; n <= 96; n += 12) {
      var y = Math.round(ny(n));
      for (var x = FIELD.x; x < FIELD.x + FIELD.w; x += 4) g.fill(x, y, 1, 1, RULE);
      g.text(FIELD.x + FIELD.w + 2, y + 3, "C" + (n / 12 - 1), "#4f6b60", -1);
    }
    [0.25, 1, 4, 16].forEach(function (s) {
      var x = Math.round(sx(s));
      for (var y = FIELD.y; y < FIELD.y + FIELD.h; y += 4) g.fill(x, y, 1, 1, RULE);
      g.text(x, FIELD.y + FIELD.h + 9, (s < 1 ? ".25" : String(s)) + (s === 1 ? " HZ" : ""), "#4f6b60", 0);
    });
  });
}

function titleBlock(g, v, sw, cur) {
  var x = 12, t = v.$touched || "";
  g.text(x, 14, "ESSAIM", INK_DIM, -1);
  var ps = v.$pages || [];
  if (v.$segmode === "segment") { var sl = (v.$segments || []).filter(function (s) { return s.id === v.$segment; })[0]; if (sl) g.text(196, 14, up(sl.label), "slot", 1); }
  else if (ps.length > 1) g.text(196, 14, up(ps[v.$page] || "") + " " + (v.$page + 1) + "/" + ps.length, INK_DIM, 1);
  g.value(x, 36, up(disp(v, "preset")), t === "preset" ? "slot" : INK, -1, 184);
  var root = nameIndex(v, "root_note", NOTE, 0), sc = nameIndex(v, "scale", SCALE_NAMES, 0);
  g.text(x, 54, NOTE[root] + " " + up(SCALE_NAMES[sc]), /^(root_note|scale)$/.test(t) ? "slot" : GLOW, -1);
  var tr = nameIndex(v, "transpose", TRANSPOSE_NAMES, 4), fine = num(v, "fine", 0) * 12;
  if (tr !== 4 || Math.abs(fine) >= 0.05) g.text(x + 112, 54, (TRANSPOSE_NAMES[tr] === "0" ? "" : up(TRANSPOSE_NAMES[tr]) + " ") + (Math.abs(fine) >= 0.05 ? (fine > 0 ? "+" : "") + fine.toFixed(1) + "ST" : ""), INK_DIM, -1);
  var drone = /drone/i.test(disp(v, "mode"));
  g.text(x, 70, drone ? "DRONE: PADS TOGGLE" : "PLAY: PADS HOLD", t === "mode" ? "slot" : INK_DIM, -1);
  g.text(x, 84, /on/i.test(disp(v, "all_mono")) ? "ALL MONO" : "SPREAD IN STEREO", t === "all_mono" ? "slot" : INK_DIM, -1);
  var L = v.$live, held = L && L.known ? L.held : 0;
  if (held > 0) g.text(x + 184, 98, held + " HELD", GLOW, 1);
  // what the colours say: each voice's filter
  for (var m = 0; m < 3; m++) { g.dot(x + 3 + m * 34, 95, 3, MODE_COL[m]); g.text(x + 9 + m * 34, 98, MODE_NAME[m], INK_DIM, -1); }
}

function field(g, v, sw, cur) {
  if (!sw) { g.text(FIELD.x + FIELD.w / 2, FIELD.y + FIELD.h / 2, "--", INK_DIM, 0); return; }
  var root = nameIndex(v, "root_note", NOTE, 0), sc = nameIndex(v, "scale", SCALE_NAMES, 0), t = v.$touched || "";
  var allHot = /^(same_|rnd_|init_freq|root_note|scale)/.test(t);
  for (var i = 0; i < 32; i++) {
    var w = sw[i], x = sx(w.speed), y = ny(voiceNote(w.freq, w.octave, root, sc));
    var r = 1.8 + clamp01(w.volume) * 4, col = MODE_COL[w.mode];
    g.dot(x, y, r + 2, mixc(GROUND, col, 0.22 + 0.3 * clamp01(w.cutoff)));
    g.dot(x, y, r, allHot ? "slot" : col);
  }
  if (cur >= 0) {
    var c = sw[cur], cx = sx(c.speed), cy = ny(voiceNote(c.freq, c.octave, root, sc)), hot = t !== "" && !allHot;
    g.arc(cx, cy, 9, 0, Math.PI * 2, 1.6, INK);
    g.text(cx + 12, cy - 6, "V" + (cur + 1), INK, -1);
    if (moved(v, "speed") || moved(v, "volume"))   // the voice as it sounds now: its speed and its level
      g.dot(known(v, "speed") ? sx(lnum(v, "speed", c.speed)) : cx, cy, 1.8 + clamp01(lnum(v, "volume", c.volume)) * 4, MOD);
  }
}

// the voice on the knobs: its rhythm, its filter, its envelope
function voiceBlock(g, v, sw, cur) {
  var x = RIGHT.x, t = v.$touched || "", root = nameIndex(v, "root_note", NOTE, 0), sc = nameIndex(v, "scale", SCALE_NAMES, 0);
  var me = sw && cur >= 0 ? sw[cur] : null, mode = me ? me.mode : -1;
  var octv = nameIndex(v, "v_octave", ["-3", "-2", "-1", "0", "+1", "+2"], 3) - 3;
  var nt = voiceNote(num(v, "frequency", 0), me ? me.octave : octv, root, sc);
  g.text(x, 14, (me ? "VOICE " + (cur + 1) : "THIS VOICE") + "  " + (known(v, "frequency") ? noteName(nt) : "--"), INK, -1);
  g.text(952, 14, me ? MODE_NAME[mode] + " FILTER" : "", me ? MODE_COL[mode] : INK_DIM, 1);
  var sp = num(v, "speed", 1), lfoI = nameIndex(v, "v_lfo_shape", LFO_NAMES, 0);
  g.text(x, 30, "RHYTHM", LEGEND, -1);
  g.text(x + 100, 30, sp.toFixed(1) + "HZ", t === "speed" ? "slot" : INK_DIM, 1);
  g.lfo(x - 2, 34, 106, 64, { shape: LFO_PUNG[lfoI] || "Sine", rate: clamp01((lnum(v, "speed", 1) - 1) / 4), color: me ? MODE_COL[mode] : GLOW });   // at the speed the sound has
  g.text(x + 112, 30, "FILTER", LEGEND, -1);
  g.filter(x + 110, 34, 106, 64, { cutoff: "cutoff", at: cutoffAt(lnum(v, "cutoff", 0.7)), resonance: me ? clamp01(me.q) : 0.5,
    type: me ? MODE_NAME[mode] : "LP", color: me ? MODE_COL[mode] : INK });
  filterNow(g, x + 110, 34, 106, 64, cutoffAt(num(v, "cutoff", 0.7)), cutoffAt(lnum(v, "cutoff", 0.7)), INK);
  g.text(x + 224, 30, "AMP", LEGEND, -1);
  g.envelope(x + 222, 34, 102, 64, { attack: "v_attack", sustain: 1, release: "decay", color: INK });
}

// ---- the encoder row: rings of dots ------------------------------------------------------

function dotRing(g, cx, cy, f, ok, hot, signed, R) {
  R = R || 14;
  var n = 15;
  for (var j = 0; j < n; j++) {
    var u = j / (n - 1), a = Math.PI * (0.75 + 1.5 * u), lit;
    if (!ok) lit = false;
    else if (signed) lit = f >= 0.5 ? (u >= 0.5 && u <= f + 0.01) : (u <= 0.5 && u >= f - 0.01);
    else lit = u <= f + 0.01;
    g.dot(cx + Math.cos(a) * R, cy + Math.sin(a) * R, lit ? 2.2 : 1.3, lit ? (hot ? "slot" : GLOW) : RULE);
  }
}
var SIGNED = { mod: 1, fine: 1, v_pan: 1, filter: 1 };
function row(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    // in segment mode the bottom 18 pixels are Pung's: the row closes up
    var sm = !!v.$segmode, x0 = i * 120, hot = k === t, ok = known(v, k), cy = sm ? 129 : 140;
    g.text(x0 + 60, sm ? 116 : 120, up(v[k].name), hot ? "slot" : LEGEND, 0, 110);
    var trig = /^rnd_|^init_freq$/.test(k);
    if (trig) {
      // a randomizer: a turn fires it, nothing to point at
      for (var j = 0; j < 7; j++) g.dot(x0 + 22 + (j * 37 % 17), cy - 12 + (j * 23 % (sm ? 13 : 19)), 1.6, hot ? "slot" : INK_DIM);
    } else dotRing(g, x0 + 30, cy, fr(v, k, 0), ok, hot, SIGNED[k], sm ? 10 : 14);
    if (!trig && ok && moved(v, k)) {   // the sound's place on the ring
      var an = Math.PI * (0.75 + 1.5 * nowOf(v, k)), rr = (sm ? 10 : 14) + 4;
      g.dot(x0 + 30 + Math.cos(an) * rr, cy + Math.sin(an) * rr, 2.8, MOD);
    }
    var val = ok ? String(v[k].display || v[k].value) : "--";
    g.value(x0 + 82, sm ? 138 : 149, val, hot ? "slot" : INK, 0, 70);
  }
}

// ---- segments: the panel's sections under the hands ------------------------------------------
var SEGMENTS = [
  { id: "swarm", label: "Swarm", rect: [2, 2, 200, 100], keys: ["root_note", "scale", "same_freq", "same_speed", "rnd_patch", "rnd_mod", "rnd_pan", "mode"] },
  { id: "voice", label: "Voice", rect: [208, 2, 412, 100], keys: ["frequency", "v_octave", "speed", "volume", "v_pan", "decay", "rnd_voice", "init_freq"] },
  { id: "rhythm", label: "Rhythm", rect: [629, 20, 107, 82], keys: ["speed", "mod", "v_lfo_shape", "v_mod_dest"] },
  { id: "filter", label: "Filter", rect: [738, 20, 110, 82], keys: ["cutoff", "timbre", "noisiness", "frequency", "v_octave"] },
  { id: "amp", label: "Amp", rect: [850, 20, 108, 82], keys: ["v_attack", "decay", "volume", "v_pan"] }
];
// Pung's bar marks the active section; the panel names it in the title
// block, lit (titleBlock), where the page's name stands otherwise

// Pung's default pages in the swarm's night green and its glowing LED rings
push.theme({ ground: PANEL, ink: INK, dim: INK_DIM, rule: RULE, faint: FAINT, accent: GLOW, knob: "ring" });
push.compartment({
  id: "swarm", label: "Swarm", front_panel: true, segments: SEGMENTS, draws_segments: true,
  pages: [
    { label: "Voice", keys: ["speed", "mod", "decay", "timbre", "frequency", "noisiness", "cutoff", "volume"] },
    { label: "Voice 2", keys: ["v_attack", "v_pan", "v_octave", "v_lfo_shape", "v_mod_dest"] },
    { label: "Global", keys: ["root_note", "scale", "rnd_patch", "same_freq", "init_freq", "same_speed", "rnd_mod", "rnd_pan"] },
    { label: "Global 2", keys: ["all_mono", "rnd_voice", "preset", "mode"] }
  ],
  extra_keys: ["state", "preset", "root_note", "scale", "transpose", "fine", "mode", "all_mono",
    "speed", "mod", "decay", "frequency", "cutoff", "v_attack", "v_octave", "v_lfo_shape"],
  screen: function (g, v) {
    var sw = swarm(v), cur = currentVoice(v, sw);
    ground(g);
    titleBlock(g, v, sw, cur);
    field(g, v, sw, cur);
    voiceBlock(g, v, sw, cur);
    row(g, v);
  }
});

// ---- FX: the output chain ----------------------------------------------------------------

push.compartment({
  id: "fx", label: "FX",
  pages: [
    { label: "FX", keys: ["transpose", "fine", "saturation", "filter", "dly_mix", "dly_rate", "dly_feedback", "dly_tone"] },
    { label: "Delay Mode", keys: ["dly_mode"] }
  ],
  extra_keys: ["transpose", "fine", "saturation", "filter", "dly_mix", "dly_rate", "dly_feedback", "dly_tone", "dly_mode"],
  screen: function (g, v) {
    var t = v.$touched || "";
    g.fill(0, 0, g.w, g.h, GROUND);
    for (var c = 1; c < 8; c++) if (c !== 1 && c < 5) g.fill(c * 120 - 1, 6, 1, 74, FAINT);
    // the pitch (over Transpose and Fine): semitones the whole swarm moves
    var tr = TRANSPOSE[nameIndex(v, "transpose", TRANSPOSE_NAMES, 4)], fine = num(v, "fine", 0) * 12, tot = tr + fine;
    g.text(8, 14, "PITCH", LEGEND, -1);
    g.value(8, 46, (tot > 0 ? "+" : "") + (Math.abs(tot - Math.round(tot)) < 0.05 ? Math.round(tot) : tot.toFixed(1)) + " ST", t === "transpose" || t === "fine" ? "slot" : INK, -1);
    var py = 66, mid = 120;
    g.fill(16, py, 208, 1, RULE);
    g.fill(mid, py - 4, 1, 9, INK_DIM);
    for (var o = -36; o <= 36; o += 12) g.fill(Math.round(mid + o / 36 * 100), py - 2, 1, 5, RULE);
    g.fill(Math.round(mid + Math.max(-36, Math.min(36, tot)) / 36 * 100) - 2, py - 5, 5, 11, GLOW);
    // the saturator (over Saturation): its curve, drive 1 + 19 sat^2, the
    // level held at 0.6 peak
    var sat = clamp01(num(v, "saturation", 0)), drive = 1 + sat * sat * 19, comp = 0.6 / (Math.tanh(0.6 * drive) + 0.001), pts = [];
    g.text(248, 14, "SATURATE", t === "saturation" ? "slot" : LEGEND, -1);
    for (var j = 0; j <= 40; j++) { var xin = j / 20 - 1; pts.push([248 + j * 2.6, 48 - Math.max(-1.2, Math.min(1.2, Math.tanh(xin * drive) * comp)) * 26]); }
    g.fill(248, 48, 104, 1, RULE);
    g.poly(pts, t === "saturation" ? 2.6 : 2, t === "saturation" ? "slot" : GLOW);
    // the DJ filter (over Filter): lowpass below the middle, highpass above
    var f = num(v, "filter", 0.5), ftype = f < 0.49 ? "LP 36 dB" : f > 0.51 ? "HP 36 dB" : "Off", at;
    if (f < 0.49) at = clamp01(Math.log(18000 * Math.pow(200 / 18000, (0.49 - f) / 0.49) / 20) / Math.log(1000));
    else if (f > 0.51) at = clamp01(Math.log(20 * Math.pow(400, (f - 0.51) / 0.49) / 20) / Math.log(1000));
    else at = 1;
    g.text(368, 14, ftype === "Off" ? "FILTER OFF" : "DJ FILTER", t === "filter" ? "slot" : LEGEND, -1);
    g.filter(364, 20, 112, 60, { cutoff: "filter", at: at, type: ftype, resonance: 0.3, color: GLOW });
    // the delay (over its four knobs): each echo where it falls in 4 s, as
    // loud as the mix and feedback leave it, darker as the tone closes
    var mix = clamp01(num(v, "dly_mix", 0)), rate = Math.max(0.004, num(v, "dly_rate", 0.5)), fb = Math.max(0, Math.min(0.95, num(v, "dly_feedback", 0.4)));
    var tone = clamp01(num(v, "dly_tone", 0.5)), x0 = 488, w = 456, base = 78, dh = /^dly_/.test(t);
    g.text(x0, 14, "DELAY  " + up(disp(v, "dly_mode")) + "  " + ms(rate), dh ? "slot" : LEGEND, -1);
    g.fill(x0, base, w, 1, RULE);
    g.fill(x0, base - 52, 3, 52, INK_DIM); // the dry note
    var col = mixc("#3c5a50", GLOW, 0.3 + 0.7 * tone);
    for (var k = 1, lvl = mix; k < 80; k++, lvl *= fb) {
      var ex = x0 + k * rate / 4 * w;
      if (ex > x0 + w || lvl < 0.01) break;
      var h = Math.max(1, Math.round(lvl * 52));
      g.fill(Math.round(ex), base - h, 3, h, dh ? "slot" : col);
    }
    if (mix <= 0.005) g.text(x0 + w, 40, "DRY: NO ECHOES", INK_DIM, 1);
  }
});
