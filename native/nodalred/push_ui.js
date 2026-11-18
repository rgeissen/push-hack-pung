// Nodal Red 2X (the Clavia Nord Lead 2X, emulated) on Push.
//
// The Nord has no menus: its panel is the instrument. The compartments are
// the panel's sections, and each has a picture of what its knobs do together:
//
//   SLOTS        the four slots: which sound, which are layered, which one
//                the knobs edit. The Nord is played by its slots.
//   OSCILLATORS  both waveforms as they are (pulse width, the interval, hard
//                sync), and what joins them: mix, FM, ring modulation
//   FILTER       the response of the chosen type, and its envelope
//   AMPLIFIER    the envelope, and how keys are played
//   MODULATION   who moves what: LFO 1, LFO 2 or the arpeggiator, the mod
//                envelope and the wheel on the left, what they reach on the
//                right, a line as strong as the amount
//   MORPH        the Nord's own idea: velocity or the wheel moves every knob
//                at once, each by its own range. Every range is drawn on its
//                knob: the dot is where the knob stands, the arc is where
//                full morph takes it.
//
// The native layer owns every encoder and draws each key's name and value.

function known(v, k) { return v[k] && v[k].known; }
function frac(v, k, neutral) { return known(v, k) ? v[k].frac : (neutral || 0); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(disp(v, k)); return isNaN(n) ? (d || 0) : n; }
function isOn(v, k) { var s = disp(v, k).toLowerCase(); return s === "on" || s === "1"; }
function hot(v, k) { return v.$touched === k; }

// ---- the slots, on every screen -----------------------------------------------------
// slots_info: "on,edited,osc1,osc2,cutoff,resonance,filter,mix,mode,unison,name" a slot, ";" between
var WAVES1 = ["pulse", "saw", "tri", "sine"], WAVES2 = ["pulse", "saw", "tri", "noise"];
var FILTERS = ["LP 12", "LP 24", "HP 24", "BP", "NOTCH+LP"], MODES = ["MONO", "LEGATO", "POLY"];
var SLOTS_OF = "", SLOTS = [];
function slots(v) {
  var s = disp(v, "slots_info"), out = [];
  if (!s) return out;
  if (s === SLOTS_OF) return SLOTS;
  SLOTS_OF = s; SLOTS = out;
  var parts = s.split(";");
  for (var i = 0; i < parts.length && i < 4; i++) {
    var f = parts[i].split(",");
    out.push({ on: f[0] === "1", edit: f[1] === "1", w1: +f[2] || 0, w2: +f[3] || 0, cut: (+f[4] || 0) / 127,
      res: (+f[5] || 0) / 127, ft: +f[6] || 0, mix: (+f[7] || 0) / 127, mode: +f[8] || 0, uni: f[9] === "1",
      name: f.slice(10).join(",") });
  }
  return out;
}
// the four letters, top right: lit = in the layer, boxed = the one the knobs edit
function badge(g, v) {
  var sl = slots(v);
  if (sl.length < 4) return;
  var x = g.w - 4 * 17 - 4;
  g.fill(x - 4, 1, 4 * 17 + 6, 15, "black");
  for (var i = 0; i < 4; i++) {
    var cx = x + i * 17;
    if (sl[i].edit) g.fill(cx, 2, 14, 13, "slot");
    g.text(cx + 7, 13, "ABCD".charAt(i), sl[i].edit ? "black" : (sl[i].on ? "fg" : "faint"), 0);
  }
}

// ---- waveforms -------------------------------------------------------------------
function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
// one sample of a Nord oscillator: ph in cycles, pw 0..1 (0 = square)
function osc(shape, ph, pw) {
  var p = ph - Math.floor(ph);
  switch (shape) {
  case "saw": return 1 - 2 * p;
  case "tri": return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  case "sine": return Math.sin(p * 2 * Math.PI);
  case "noise": return rnd(Math.floor(ph * 23)) * 0.8;
  }
  return p < 0.5 + pw * 0.45 ? 1 : -1; // pulse
}
// A screen is drawn many times a second and has 8 ms, on a Push whose
// processor the emulator is already using: a curve is computed when what it
// shows changes, and kept until then.
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 96) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function wavePts(x, y, w, h, fn) {
  var pts = [], mid = y + h / 2, a = h / 2 - 2, step = 3, prev = null;
  for (var px = 0; px <= w; px += step) {
    var s = fn(px / w), yy = mid - s * a;
    if (prev !== null && Math.abs(yy - prev) > a * 0.45) pts.push(x + px, prev); // an edge: straight down, not a slope
    pts.push(x + px, yy);
    prev = yy;
  }
  return pts;
}
function frame(g, x, y, w, h, on) {
  g.line(x, y, x + w, y, 1, on ? "slot" : "line"); g.line(x, y + h, x + w, y + h, 1, on ? "slot" : "line");
  g.line(x, y, x, y + h, 1, on ? "slot" : "line"); g.line(x + w, y, x + w, y + h, 1, on ? "slot" : "line");
}
function waveIndex(v, k, n) { return Math.round(frac(v, k, 0) * (n - 1)); }

var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5; // a dial: from 7 o'clock, three quarters round

// ---- PANEL: the instrument, in its red -----------------------------------------------
// The whole Push screen as the Nord's front panel: every knob where the
// hardware has it, standing where the sound has it. Nothing is hidden behind
// a page: the sound can be read at a glance, as on the instrument itself. The
// encoders play the eight things a hand reaches for first.
var RED = "#b3101d", RED_DK = "#7d0b15", RED_ROW = "#3a060b", KNOB = "#141414", INK = "#ffffff", SOFT = "#f2b8bd", LED_ON = "#ffe08a", LED_OFF = "#6d0912";
// A knob is drawn in two parts: its body and its legend never change (the
// kept layer), its pointer does.
var KNOBS = [ // key, x, y, legend under it, bipolar
  ["lfo1_rate", 172, 47, "", 0], ["lfo1_amount", 200, 47, "", 0], ["lfo2_rate", 216, 85, "", 0], ["lfo2_amount", 244, 85, "", 0],
  ["modenv_attack", 326, 47, "ATK", 0], ["modenv_decay", 356, 47, "DEC", 0], ["modenv_amount", 388, 47, "AMT", 1],
  ["osc2_semi", 542, 47, "SEMI", 1], ["osc2_fine", 574, 47, "FINE", 1], ["mix", 614, 47, "MIX", 1], ["fm", 440, 83, "", 0], ["pw", 494, 83, "", 0],
  ["amp_attack", 668, 47, "A", 0], ["amp_decay", 698, 47, "D", 0], ["amp_sustain", 728, 47, "S", 0], ["amp_release", 758, 47, "R", 0], ["amp_gain", 668, 83, "", 0],
  ["flt_attack", 812, 47, "A", 0], ["flt_decay", 840, 47, "D", 0], ["flt_sustain", 868, 47, "S", 0], ["flt_release", 896, 47, "R", 0],
  ["cutoff", 810, 83, "", 0], ["resonance", 866, 83, "", 0], ["filter_env", 915, 83, "", 0]
];
function section(g, x, w, title) {
  g.fill(x, 22, w, 11, "black");
  g.text(x + 5, 31, title, INK, -1);
  g.fill(x, 33, 1, 66, RED_DK); g.fill(x + w - 1, 33, 1, 66, RED_DK);
}
function pill(g, x, y, s, lit) { // a selector's choice, as the lit LED's legend
  var w = s.length * 7 + 8;
  g.fill(x, y - 9, w, 12, lit ? "black" : RED_DK);
  g.text(x + 4, y, s, lit ? LED_ON : SOFT, -1);
  return x + w + 4;
}
function led(g, x, y, on) { g.dot(x, y, 2.5, on ? LED_ON : LED_OFF); }
function short(s) {
  return String(s).toUpperCase().replace("TRIANGLE", "TRI").replace("SOFT RANDOM", "SOFT RND").replace("RANDOM", "RND")
    .replace("SQUARE", "SQR").replace("OSC 1+2", "OSC1+2").replace("LFO ", "").replace("ARP ", "");
}
// everything on the panel that never changes: drawn once, kept (g.layer)
function panelGround(g) {
  g.fill(0, 0, 960, 104, RED);
  g.value(10, 17, "NODAL RED 2X", INK, -1);
  section(g, 6, 140, "SLOT");
  g.fill(12, 38, 60, 34, "black");
  section(g, 152, 150, "LFO 1");
  g.text(172, 66, "RATE", SOFT, 0); g.text(202, 66, "AMT", SOFT, 0);
  section(g, 308, 104, "MOD ENV");
  section(g, 418, 226, "OSCILLATORS");
  g.fill(424, 38, 44, 20, "black"); g.fill(474, 38, 44, 20, "black");
  g.text(446, 68, "OSC 1", SOFT, 0); g.text(496, 68, "OSC 2", SOFT, 0);
  g.text(456, 87, "FM", SOFT, -1); g.text(510, 87, "PW", SOFT, -1);
  section(g, 650, 138, "AMPLIFIER");
  g.text(684, 87, "GAIN", SOFT, -1);
  section(g, 794, 160, "FILTER");
  g.text(823, 87, "FREQ", SOFT, -1); g.text(879, 87, "RES", SOFT, -1); g.text(928, 87, "ENV", SOFT, -1);
  for (var i = 0; i < KNOBS.length; i++) {
    var k = KNOBS[i];
    g.dot(k[1], k[2], 8.5, KNOB);
    if (k[3]) g.text(k[1], k[2] + 19, k[3], SOFT, 0);
  }
  // the encoder row's ground
  g.fill(0, 104, 960, 56, RED_ROW);
  g.fill(0, 104, 960, 2, "black");
  for (var c = 1; c < 8; c++) g.fill(c * 120, 112, 1, 42, RED_DK);
}
function panel(g, v) {
  var t = v.$touched || "", sl = slots(v);
  g.layer("panel", function () { panelGround(g); });
  // the pointers
  for (var i = 0; i < KNOBS.length; i++) {
    var k = KNOBS[i], f = frac(v, k[0], k[4] ? 0.5 : 0), a = A0 + f * SWEEP;
    if (k[0] === t) g.arc(k[1], k[2], 10.5, 0, Math.PI * 2, 2, INK);
    g.line(k[1] + Math.cos(a) * 2, k[2] + Math.sin(a) * 2, k[1] + Math.cos(a) * 8, k[2] + Math.sin(a) * 8, 2, INK);
  }
  var nm = disp(v, "preset_name");
  var nw = nm ? g.measure(nm.toUpperCase()) : 0;
  g.text(950, 15, nm ? nm.toUpperCase() : "", INK, 1, 420);
  g.text(950 - nw - 14, 15, (disp(v, "bank_name") || "").toUpperCase(), SOFT, 1, 300);
  // slots: the display and the four buttons
  var e = disp(v, "slot") || "A";
  g.value(42, 62, e, "#ff3b30", 0);
  for (var j = 0; j < 4; j++) {
    var s = sl[j] || { on: j === 0, edit: j === 0 }, bx = 12 + j * 33;
    if (!s.on && !s.edit) continue; // a slot that is off is not there to choose: its button is not drawn
    led(g, bx + 13, 79, s.on);
    g.fill(bx, 84, 27, 12, s.edit ? INK : KNOB);
    g.text(bx + 13, 94, "ABCD".charAt(j), s.edit ? "black" : (s.on ? INK : "#777777"), 0);
  }
  pill(g, 80, 48, disp(v, "voice_mode").toUpperCase() || "POLY", true);
  pill(g, 80, 62, "UNISON", isOn(v, "unison"));
  pill(g, 80, 76, "PORTA", frac(v, "portamento", 0) > 0.01);
  // LFO 1 over LFO 2 / arpeggiator
  pill(g, 220, 44, short(disp(v, "lfo1_wave") || "TRI"), true);
  pill(g, 220, 58, short(disp(v, "lfo1_dest") || ""), frac(v, "lfo1_amount", 0) > 0.005);
  var d2 = disp(v, "lfo2_dest"), arp = d2 && !/^LFO |off/i.test(d2);
  g.text(157, 78, arp ? "ARP" : "LFO 2", INK, -1);
  pill(g, 258, 89, short(d2 || "OFF").slice(0, 6), !!d2 && !/off/i.test(d2));
  // the mod envelope, and the wheel
  pill(g, 314, 82, short(disp(v, "modenv_dest") || "NONE"), Math.abs(frac(v, "modenv_amount", 0.5) - 0.5) > 0.01);
  g.text(314, 96, "WHEEL " + short(disp(v, "modwheel_dest") || ""), SOFT, -1, 94);
  // oscillators
  var w1 = WAVES1[waveIndex(v, "osc1_wave", 4)], w2 = WAVES2[waveIndex(v, "osc2_wave", 4)];
  g.poly(cached("p1|" + w1, function () { return wavePts(426, 39, 40, 18, function (q) { return osc(w1, q * 2, 0); }); }), 1.5, t === "osc1_wave" ? LED_ON : INK);
  g.poly(cached("p2|" + w2, function () { return wavePts(476, 39, 40, 18, function (q) { return osc(w2, q * 2, 0); }); }), 1.5, t === "osc2_wave" ? LED_ON : INK);
  led(g, 548, 83, isOn(v, "sync")); g.text(555, 87, "SYNC", isOn(v, "sync") ? INK : SOFT, -1);
  led(g, 598, 83, isOn(v, "ringmod")); g.text(605, 87, "RING", isOn(v, "ringmod") ? INK : SOFT, -1);
  // amplifier, filter
  var oc = disp(v, "octave");
  if (oc && oc !== "0") pill(g, 730, 87, "OCT " + oc, true);
  pill(g, 912, 44, short(disp(v, "filter_type") || "LP 12").replace("NOTCH+LP", "NOTCH").replace(" ", ""), true);
  led(g, 918, 56, isOn(v, "distortion")); g.text(925, 60, "DIST", isOn(v, "distortion") ? INK : SOFT, -1);
}
// the encoder row, in the panel's colours: names and values where the hands expect them
function panelRow(g, v) {
  var knobs = v.$knobs || [], t = v.$touched;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], cx = i * 120 + 60;
    if (!k || !v[k]) continue;
    var on = k === t;
    if (on) g.fill(i * 120 + 4, 108, 112, 48, RED);
    g.text(cx, 124, String(v[k].name).toUpperCase(), on ? INK : SOFT, 0, 112);
    g.value(cx, 149, disp(v, k) || "--", INK, 0, 112);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 31, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, SOFT, 1);
}
push.compartment({
  id: "panel", label: "Panel", takeover: true,
  pages: [
    { label: "Panel", keys: ["slot", "cutoff", "resonance", "filter_env", "mix", "amp_attack", "amp_release", "portamento"] }
  ],
  extra_keys: ["slots_info", "preset_name", "bank_name", "voice_mode", "unison", "lfo1_rate", "lfo1_amount", "lfo1_wave", "lfo1_dest",
    "lfo2_rate", "lfo2_amount", "lfo2_dest", "modenv_attack", "modenv_decay", "modenv_amount", "modenv_dest", "modwheel_dest",
    "osc1_wave", "osc2_wave", "osc2_semi", "osc2_fine", "fm", "pw", "sync", "ringmod", "amp_decay", "amp_sustain", "amp_gain",
    "octave", "flt_attack", "flt_decay", "flt_sustain", "flt_release", "filter_type", "distortion"],
  screen: function (g, v) { panel(g, v); panelRow(g, v); }
});
// every other screen carries the red at its left edge
function red(g) { g.fill(0, 0, 3, g.h, RED); }

// ---- SLOTS ---------------------------------------------------------------------------
function slotTile(g, x, w, s, letter, touched) {
  var y = 2, h = 82;
  g.fill(x, y, w, h, "black");
  frame(g, x, y, w, h, s.edit || touched);
  if (s.edit) g.fill(x, y, w, 3, "slot");
  g.value(x + 8, y + 24, letter, s.on ? "fg" : "faint", -1);
  g.text(x + w - 6, y + 14, s.on ? (s.edit ? "EDIT" : "ON") : "OFF", s.edit ? "slot" : (s.on ? "fg" : "faint"), 1);
  var c = s.on ? "fg" : "faint";
  if (s.name) g.text(x + 6, y + 40, s.name.toUpperCase(), s.on ? "dim" : "faint", -1, w - 12);
  var ww = (w - 18) / 2;
  g.poly(cached("t1|" + x + "|" + s.w1, function () { return wavePts(x + 6, y + 46, ww, 16, function (t) { return osc(WAVES1[s.w1], t * 2, 0); }); }), 1.5, s.mix < 0.9 ? c : "faint");
  g.poly(cached("t2|" + x + "|" + s.w2, function () { return wavePts(x + 12 + ww, y + 46, ww, 16, function (t) { return osc(WAVES2[s.w2], t * 2, 0); }); }), 1.5, s.mix > 0.1 ? c : "faint");
  g.text(x + 6, y + 76, FILTERS[s.ft] || "", c, -1);
  g.text(x + w - 6, y + 76, MODES[s.mode] + (s.uni ? " U" : ""), s.on ? "dim" : "faint", 1);
  // cutoff: a bar under the waves
  g.fill(x + 6, y + 64, w - 12, 2, "line");
  g.fill(x + 6, y + 64, Math.round((w - 12) * s.cut), 2, s.on ? "slot" : "faint");
}
push.compartment({
  id: "slots", label: "Slots",
  pages: [
    { label: "Slots", keys: ["slot", "slot_a", "slot_b", "slot_c", "slot_d", "gain", "out_mode", "bend_range"] },
    { label: "Sound", keys: ["preset", "unison_detune", "master_tune"] }
  ],
  extra_keys: ["slots_info", "preset_name", "bank_name"],
  screen: function (g, v) {
    red(g);
    var sl = slots(v), t = v.$touched || "";
    // over the Edit Slot knob: the letter the panel edits
    var e = disp(v, "slot") || "A";
    g.text(8, 14, "THE KNOBS EDIT", "dim", -1);
    g.value(60, 62, "SLOT " + e, "slot", 0);
    var kn = v.$knobs || [];
    var nOn = 0;
    for (var q = 0; q < sl.length; q++) if (sl[q].on) nOn++;
    // the knob moves among the slots that are on: with one, there is nowhere to go
    if (kn[0] === "slot") g.text(60, 80, nOn > 1 ? "TURN TO CHANGE" : "THE ONLY SLOT ON", "faint", 0);
    for (var i = 0; i < 4; i++) {
      var s = sl[i] || { on: false, edit: false, w1: 0, w2: 0, cut: 0, res: 0, ft: 0, mix: 0.5, mode: 2, uni: false, name: "" };
      slotTile(g, 124 + i * 120, 112, s, "ABCD".charAt(i), t === "slot_" + "abcd".charAt(i));
    }
    // right: the sound, and what layering costs
    var x = 5 * 120 + 12, n = 0;
    for (var j = 0; j < sl.length; j++) if (sl[j].on) n++;
    g.text(x, 14, (disp(v, "bank_name") || "").toUpperCase(), "dim", -1, 330);
    g.value(x, 40, disp(v, "preset_name") || "", "fg", -1, 330);
    g.text(x, 62, n > 1 ? n + " SLOTS LAYERED: EVERY KEY PLAYS " + n + " VOICES" : "ONE SLOT: 20 VOICES", n > 1 ? "mod" : "dim", -1, 330);
    g.text(x, 78, "A SOUND FROM SOUNDS LOADS INTO SLOT " + e, "faint", -1, 330);
  }
});

// ---- OSCILLATORS -----------------------------------------------------------------------
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Oscillators", keys: ["osc1_wave", "osc2_wave", "osc2_semi", "osc2_fine", "mix", "fm", "pw", "sync"] },
    { label: "Osc +", keys: ["ringmod", "osc2_kbt", "octave"] }
  ],
  extra_keys: ["slots_info"],
  screen: function (g, v) {
    red(g);
    var t = v.$touched || "";
    var w1 = WAVES1[waveIndex(v, "osc1_wave", 4)], w2 = WAVES2[waveIndex(v, "osc2_wave", 4)];
    var pw = frac(v, "pw", 0), semi = num(v, "osc2_semi", 0) + (num(v, "osc2_fine", 0)) / 64 * 0.5;
    var ratio = Math.pow(2, semi / 12), sync = isOn(v, "sync"), ring = isOn(v, "ringmod");
    var mix = frac(v, "mix", 0.5), fm = frac(v, "fm", 0);
    var cyc = 2; // cycles of oscillator 1 across a box
    // FM: oscillator 2 moves oscillator 1's phase
    // noise has no pitch: its "interval" is its colour, and sync does nothing to it
    var o2 = w2 === "noise" ? function (ph) { return osc("noise", ph * 3, 0); }
      : function (ph) { return osc(w2, sync ? (ph - Math.floor(ph)) * ratio : ph * ratio, pw); };
    var o1 = function (ph) { return osc(w1, ph + fm * 0.35 * (w2 === "noise" ? 0 : o2(ph)), pw); };
    var bw = 228, y = 4, h = 78;
    var sig = [w1, w2, pw.toFixed(2), semi.toFixed(2), sync, ring, fm.toFixed(2)].join("|");
    // oscillator 1
    frame(g, 6, y, bw, h, t === "osc1_wave" || t === "fm" || t === "pw");
    g.text(12, y + 12, "OSC 1", "dim", -1);
    g.text(6 + bw - 6, y + 12, w1.toUpperCase() + (fm > 0.01 ? "  FM" : ""), "fg", 1);
    g.poly(cached("o1|" + sig, function () { return wavePts(12, y + 16, bw - 12, h - 20, function (x) { return o1(x * cyc); }); }), 2, mix > 0.97 ? "faint" : "fg");
    // oscillator 2
    var x2 = 246;
    frame(g, x2, y, bw, h, t === "osc2_wave" || t === "osc2_semi" || t === "osc2_fine" || t === "sync");
    g.text(x2 + 6, y + 12, "OSC 2", "dim", -1);
    var iv = Math.round(num(v, "osc2_semi", 0));
    g.text(x2 + bw - 6, y + 12, w2 === "noise" ? "NOISE" : w2.toUpperCase() + "  " + (iv > 0 ? "+" : "") + iv + (sync ? "  SYNC" : ""), "fg", 1);
    g.poly(cached("o2|" + sig, function () { return wavePts(x2 + 6, y + 16, bw - 12, h - 20, function (x) { return o2(x * cyc); }); }), 2, mix < 0.03 ? "faint" : (sync && w2 !== "noise" ? "mod" : "fg"));
    if (sync && w2 !== "noise") for (var c = 1; c < cyc; c++) g.line(x2 + 6 + (bw - 12) * c / cyc, y + 18, x2 + 6 + (bw - 12) * c / cyc, y + h - 4, 1, "line");
    // what leaves the oscillators: the mix (ring modulation multiplies them)
    var x3 = 486, w3 = 340;
    frame(g, x3, y, w3, h, t === "mix" || t === "ringmod");
    g.text(x3 + 6, y + 12, ring ? "OSC 1 x OSC 2 (RING MOD)" : "MIX", "dim", -1);
    g.poly(cached("mx|" + sig + "|" + mix.toFixed(2), function () {
      return wavePts(x3 + 6, y + 16, w3 - 12, h - 20, function (x) {
        var a = o1(x * cyc * 1.5), b = o2(x * cyc * 1.5);
        return ring ? ((1 - mix) * a + mix * a * b) : ((1 - mix) * a + mix * b);
      });
    }), 2, "slot");
    // the balance, as the panel's knob says it
    var bx = 836, bwid = 108;
    g.text(bx, y + 12, "1", mix < 0.5 ? "fg" : "dim", -1); g.text(bx + bwid, y + 12, "2", mix > 0.5 ? "fg" : "dim", 1);
    g.fill(bx, y + 20, bwid, 3, "line");
    g.fill(bx + Math.round((bwid - 6) * mix), y + 16, 6, 11, "slot");
    g.text(bx, y + 44, "FM", "dim", -1); g.fill(bx + 28, y + 38, 80, 3, "line"); g.fill(bx + 28, y + 38, Math.round(80 * fm), 3, fm > 0 ? "mod" : "line");
    g.text(bx, y + 60, "PW", "dim", -1); g.fill(bx + 28, y + 54, 80, 3, "line"); g.fill(bx + 28, y + 54, Math.round(80 * pw), 3, "fg");
    g.text(bx, y + 76, isOn(v, "osc2_kbt") || !known(v, "osc2_kbt") ? "OSC 2: KEYS" : "OSC 2: FIXED", "faint", -1, bwid);
  }
});

// ---- FILTER ----------------------------------------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["cutoff", "resonance", "filter_env", "filter_type", "flt_attack", "flt_decay", "flt_sustain", "flt_release"] },
    { label: "Filter +", keys: ["filter_kbt", "filter_velo", "distortion"] }
  ],
  extra_keys: ["slots_info"],
  screen: function (g, v) {
    red(g);
    var half = 480;
    g.filter(4, 2, half - 12, 82, { cutoff: "cutoff", resonance: "resonance", type: "filter_type" });
    // where the envelope takes the cutoff: a mark on the frequency axis
    var env = frac(v, "filter_env", 0), cut = frac(v, "cutoff", 0);
    if (env > 0.01) {
      var x0 = 10 + (half - 24) * cut, x1 = 10 + (half - 24) * Math.min(1, cut + env * (1 - cut));
      g.fill(x0, 80, Math.max(2, x1 - x0), 2, "mod");
      // the label on its own ground: the curve's floor runs through here
      var lx = x1 + 4 > half - 34 ? x0 - 30 : x1 + 4;
      g.fill(lx - 2, 76, 28, 10, "#000000");
      g.text(lx, 84, "ENV", "mod", -1);
    }
    g.line(half, 6, half, 82, 1, "line");
    g.envelope(half + 8, 2, half - 16, 82, { attack: "flt_attack", decay: "flt_decay", sustain: "flt_sustain", release: "flt_release", labels: true });
    var flags = [];
    if (isOn(v, "filter_velo")) flags.push("VELOCITY");
    if (isOn(v, "distortion")) flags.push("DISTORTION");
    var kt = disp(v, "filter_kbt");
    if (kt && kt.toLowerCase() !== "off") flags.push("KEYS " + kt.toUpperCase());
    if (flags.length) g.text(half - 12, 13, flags.join("  "), "dim", 1);
    badge(g, v);
  }
});

// ---- AMPLIFIER ---------------------------------------------------------------------------
push.compartment({
  id: "amp", label: "Amplifier",
  pages: [
    { label: "Amplifier", keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_release", "amp_gain", "voice_mode", "unison", "portamento"] },
    { label: "Play", keys: ["porta_auto", "octave", "bend_range", "unison_detune"] }
  ],
  extra_keys: ["slots_info"],
  screen: function (g, v) {
    red(g);
    var half = 480;
    g.envelope(4, 2, half - 12, 82, { attack: "amp_attack", decay: "amp_decay", sustain: "amp_sustain", release: "amp_release", labels: true });
    g.line(half, 6, half, 82, 1, "line");
    // gain: a level
    var gain = frac(v, "amp_gain", 1), x = half + 12;
    g.text(x, 14, "GAIN", "dim", -1);
    g.fill(x, 22, 96, 6, "line"); g.fill(x, 22, Math.round(96 * gain), 6, hot(v, "amp_gain") ? "slot" : "fg");
    // how keys are played, in words
    var mode = disp(v, "voice_mode").toUpperCase() || "POLY", uni = isOn(v, "unison"), porta = frac(v, "portamento", 0);
    var voices = mode === "POLY" ? (uni ? 2 : 1) : (uni ? 4 : 1);
    g.value(x + 120, 30, mode, hot(v, "voice_mode") ? "slot" : "fg", -1);
    var say = mode === "POLY" ? "CHORDS" : (mode === "LEGATO" ? "ONE NOTE, TIED NOTES DO NOT RETRIGGER" : "ONE NOTE, EVERY KEY RETRIGGERS");
    g.text(x + 120, 46, say, "dim", -1, 330);
    g.text(x + 120, 62, uni ? "UNISON: " + voices + " VOICES A KEY" : "ONE VOICE A KEY", uni ? "mod" : "dim", -1, 330);
    g.text(x + 120, 78, porta > 0.01 ? "GLIDE" + (isOn(v, "porta_auto") ? " ON TIED NOTES" : " ON EVERY NOTE") : "NO GLIDE", porta > 0.01 ? "fg" : "faint", -1, 330);
    g.text(x, 46, "OCTAVE", "dim", -1); g.text(x, 62, disp(v, "octave") || "0", "fg", -1);
    badge(g, v);
  }
});

// ---- MODULATION: who moves what ---------------------------------------------------------
var DESTS = ["OSC 1+2", "OSC 2", "FM", "PW", "FILTER", "AMP", "MORPH"];
function destOf(name) {
  var s = String(name).toUpperCase().replace(/^LFO /, "");
  if (s === "OSC 1+2") return 0;
  if (s === "OSC 2") return 1;
  if (s === "FM") return 2;
  if (s === "PW") return 3;
  if (s === "FILTER") return 4;
  if (s === "AMP") return 5;
  if (s === "MORPH") return 6;
  return -1;
}
push.compartment({
  id: "mod", label: "Modulation",
  pages: [
    { label: "LFO 1", keys: ["lfo1_rate", "lfo1_amount", "lfo1_wave", "lfo1_dest", "lfo1_sync"] },
    { label: "LFO 2 / Arp", keys: ["lfo2_rate", "lfo2_amount", "lfo2_dest", "lfo2_sync"] },
    { label: "Mod Env", keys: ["modenv_attack", "modenv_decay", "modenv_amount", "modenv_dest"] },
    { label: "Wheel / Pedal", keys: ["modwheel_dest", "pressure_amount", "pressure_dest", "pedal_amount", "pedal_dest"] }
  ],
  extra_keys: ["slots_info"],
  screen: function (g, v) {
    red(g);
    var t = v.$touched || "", srcX = 250, dstX = 640, rows = [12, 32, 52, 72];
    // destinations
    var used = [0, 0, 0, 0, 0, 0, 0];
    function link(row, name, amount, mine) {
      var d = destOf(name);
      if (d < 0 || amount <= 0.004) return;
      used[d] = 1;
      var y0 = rows[row], y1 = 8 + d * 11.5;
      g.poly([srcX, y0, srcX + 60, y0, dstX - 60, y1, dstX, y1], 1 + amount * 3, mine ? "slot" : "mod");
    }
    // LFO 1
    var l1 = t.indexOf("lfo1_") === 0;
    g.text(8, rows[0] + 4, "LFO 1", l1 ? "fg" : "dim", -1);
    g.lfo(60, rows[0] - 9, 110, 18, { shape: "lfo1_wave", rate: "lfo1_rate" });
    g.text(srcX - 6, rows[0] + 4, disp(v, "lfo1_sync") && disp(v, "lfo1_sync").toLowerCase() !== "off" ? disp(v, "lfo1_sync") : "", "dim", 1);
    link(0, disp(v, "lfo1_dest"), frac(v, "lfo1_amount", 0), l1);
    // LFO 2, or the arpeggiator
    var l2 = t.indexOf("lfo2_") === 0, d2 = disp(v, "lfo2_dest"), isLfo = /^LFO /i.test(d2);
    g.text(8, rows[1] + 4, isLfo || !d2 || /off/i.test(d2) ? "LFO 2" : "ARP", l2 ? "fg" : "dim", -1);
    if (isLfo) {
      g.lfo(60, rows[1] - 9, 110, 18, { shape: "Triangle", rate: "lfo2_rate" });
      link(1, d2, frac(v, "lfo2_amount", 0), l2);
    } else if (d2 && !/off/i.test(d2)) {
      var range = Math.round(frac(v, "lfo2_amount", 0) * 4);
      g.text(60, rows[1] + 4, d2.replace(/^Arp /i, "").toUpperCase() + (/echo/i.test(d2) ? "  " + Math.round(frac(v, "lfo2_amount", 0) * 8) + " REPEATS" : (range ? "  " + range + " OCT" : "  RANGE OFF")), "mod", -1, 180);
    } else {
      g.text(60, rows[1] + 4, "OFF", "faint", -1);
    }
    // the mod envelope: attack and decay, up or down
    var me = t.indexOf("modenv_") === 0, amt = (frac(v, "modenv_amount", 0.5) - 0.5) * 2;
    g.text(8, rows[2] + 4, "MOD ENV", me ? "fg" : "dim", -1);
    var a = frac(v, "modenv_attack", 0), dcy = frac(v, "modenv_decay", 0), ex = 70, ew = 100, top = rows[2] - 8, bot = rows[2] + 8;
    var peakY = amt >= 0 ? top : bot, zeroY = amt >= 0 ? bot : top, ax = ex + 4 + a * ew * 0.4;
    g.poly([ex, zeroY, ax, peakY, ax + 6 + dcy * ew * 0.55, zeroY, ex + ew, zeroY], 1.5, Math.abs(amt) > 0.02 ? "fg" : "faint");
    link(2, disp(v, "modenv_dest"), Math.abs(amt), me);
    // the wheel
    var mw = t === "modwheel_dest", wd = disp(v, "modwheel_dest");
    g.text(8, rows[3] + 4, "WHEEL", mw ? "fg" : "dim", -1);
    if (/lfo 1/i.test(wd)) g.text(60, rows[3] + 4, "RAISES LFO 1", "mod", -1);
    else link(3, wd, 0.5, mw);
    for (var i = 0; i < DESTS.length; i++) g.text(dstX + 8, 12 + i * 11.5, DESTS[i], used[i] ? "fg" : "faint", -1);
    // pressure and the pedal, in words
    var x = 760, pa = Math.round(frac(v, "pressure_amount", 0) * 7), pe = Math.round(frac(v, "pedal_amount", 0) * 7);
    g.text(x, 14, "PRESSURE", "dim", -1); g.text(x, 28, pa ? disp(v, "pressure_dest").toUpperCase() + "  " + pa : "OFF", pa ? "fg" : "faint", -1, 190);
    g.text(x, 50, "PEDAL", "dim", -1); g.text(x, 64, pe ? disp(v, "pedal_dest").toUpperCase() + "  " + pe : "OFF", pe ? "fg" : "faint", -1, 190);
    badge(g, v);
  }
});

// ---- MORPH: every range on its knob ---------------------------------------------------------
// A range is in the knob's own steps (-128..127): at full morph the knob
// stands at its value plus the range, kept on the dial.
function morphDial(g, col, v, key, base, steps) {
  var cx = col * 120 + 60, cy = 50, r = 27;
  var b = frac(v, base, 0), range = num(v, key, 0) / steps, to = Math.max(0, Math.min(1, b + range)), on = hot(v, key);
  g.arc(cx, cy, r, A0, SWEEP, 2, "line");
  if (Math.abs(to - b) > 0.004) {
    var from = Math.min(b, to), len = Math.abs(to - b);
    g.arc(cx, cy, r, A0 + from * SWEEP, len * SWEEP, 5, on ? "slot" : "mod");
    var ta = A0 + to * SWEEP; // the arrow's head: where full morph ends
    g.dot(cx + Math.cos(ta) * r, cy + Math.sin(ta) * r, 4, on ? "slot" : "mod");
  }
  var ba = A0 + b * SWEEP;
  g.line(cx + Math.cos(ba) * (r - 9), cy + Math.sin(ba) * (r - 9), cx + Math.cos(ba) * (r + 4), cy + Math.sin(ba) * (r + 4), 2, "fg");
  g.text(cx, cy + 4, known(v, base) ? disp(v, base) : "", "dim", 0);
}
function morphPage(label, pairs) {
  var keys = [], bases = [];
  for (var i = 0; i < pairs.length; i++) { keys.push("morph_" + pairs[i][0]); bases.push(pairs[i][0]); }
  return {
    label: "Morph " + label, keys: keys,
    screen: function (g, v) {
    red(g);
      g.text(8, 12, "MORPH", "dim", -1);
      g.text(g.w - 84, 12, "LINE: THE KNOB   ARC: WHERE VELOCITY OR THE WHEEL TAKES IT", "dim", 1);
      for (var i = 0; i < pairs.length; i++) morphDial(g, i, v, keys[i], bases[i], pairs[i][1] || 127);
      badge(g, v);
    }
  };
}
var MORPH = [
  morphPage("Filter", [["cutoff"], ["resonance"], ["filter_env"], ["flt_attack"], ["flt_decay"], ["flt_sustain"], ["flt_release"]]),
  morphPage("Osc", [["osc2_semi", 120], ["osc2_fine"], ["mix"], ["fm"], ["pw"], ["portamento"]]),
  morphPage("Amp", [["amp_attack"], ["amp_decay"], ["amp_sustain"], ["amp_release"], ["gain"]]),
  morphPage("Mod", [["lfo1_rate"], ["lfo1_amount"], ["lfo2_rate"], ["lfo2_amount"], ["modenv_attack"], ["modenv_decay"], ["modenv_amount"]])
];
// the amplifier's knob is amp_gain; its morph range is morph_gain
MORPH[2].screen = (function (inner) {
  return function (g, v) { v.gain = v.amp_gain; inner(g, v); };
})(MORPH[2].screen);
push.compartment({
  id: "morph", label: "Morph",
  pages: MORPH,
  extra_keys: ["slots_info", "cutoff", "resonance", "filter_env", "flt_attack", "flt_decay", "flt_sustain", "flt_release",
    "osc2_semi", "osc2_fine", "mix", "fm", "pw", "portamento", "amp_attack", "amp_decay", "amp_sustain", "amp_release",
    "amp_gain", "lfo1_rate", "lfo1_amount", "lfo2_rate", "lfo2_amount", "modenv_attack", "modenv_decay", "modenv_amount"]
});
