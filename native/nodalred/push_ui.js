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
// an LFO synced to the clock: its sync names a note value
function synced(v, k) { var d = disp(v, k); return d !== "" && d.toLowerCase() !== "off"; }
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
function badge(g, v, right) {
  var sl = slots(v);
  if (sl.length < 4) return;
  var x = (right || g.w) - 4 * 17 - 4;
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
// hardware has it, standing where the sound has it, the sections in the
// hardware's order (LFOs, mod envelope, oscillators, filter, amplifier).
// Nothing is hidden behind a page: the sound can be read at a glance, as on
// the instrument itself. The encoders play the eight things a hand reaches
// for first, drawn as the panel's own knobs: black, a white pointer, the
// legend printed above, the value in the Nord's red LED display.
var RED = "#b3101d", RED_DK = "#7d0b15", KNOB = "#141414", KNOB_RIM = "#2c2c2c", INK = "#ffffff", SOFT = "#f2b8bd";
var LED_ON = "#ffe08a", LED_OFF = "#6d0912", LED_RED = "#ff3b30", LED_GLASS = "#0c0203";
// A knob is drawn in two parts: its body and its legend never change (the
// kept layer), its pointer does.
var KNOBS = [ // key, x, y, legend under it, bipolar
  ["lfo1_rate", 180, 47, "RATE", 0], ["lfo1_amount", 208, 47, "AMT", 0], ["lfo2_rate", 180, 85, "", 0], ["lfo2_amount", 208, 85, "", 0],
  ["modenv_attack", 326, 47, "ATK", 0], ["modenv_decay", 356, 47, "DEC", 0], ["modenv_amount", 388, 47, "AMT", 1],
  ["osc2_semi", 542, 47, "SEMI", 1], ["osc2_fine", 574, 47, "FINE", 1], ["mix", 614, 47, "MIX", 1], ["fm", 440, 83, "", 0], ["pw", 494, 83, "", 0],
  ["flt_attack", 670, 47, "A", 0], ["flt_decay", 698, 47, "D", 0], ["flt_sustain", 726, 47, "S", 0], ["flt_release", 754, 47, "R", 0],
  ["cutoff", 668, 83, "", 0], ["resonance", 722, 83, "", 0], ["filter_env", 774, 83, "", 0],
  ["amp_attack", 842, 47, "A", 0], ["amp_decay", 870, 47, "D", 0], ["amp_sustain", 898, 47, "S", 0], ["amp_release", 926, 47, "R", 0],
  ["amp_gain", 842, 83, "", 0]
];
function section(g, x, w, title) {
  g.fill(x, 22, w, 11, "black");
  g.text(x + 5, 31, title, INK, -1);
  g.fill(x, 33, 1, 66, RED_DK); g.fill(x + w - 1, 33, 1, 66, RED_DK);
}
function pill(g, x, y, s, lit) { // a selector's choice, as the lit LED's legend
  var w = g.measure(s) + 8;
  g.fill(x, y - 9, w, 12, lit ? "black" : RED_DK);
  g.text(x + 4, y, s, lit ? LED_ON : SOFT, -1);
  return x + w + 4;
}
function led(g, x, y, on) { g.dot(x, y, 2.5, on ? LED_ON : LED_OFF); }
function short(s) {
  return String(s).toUpperCase().replace("TRIANGLE", "TRI").replace("SOFT RANDOM", "SOFT RND").replace("RANDOM", "RND")
    .replace("SQUARE", "SQR").replace("OSC 1+2", "OSC1+2").replace("LFO ", "").replace("ARP ", "");
}
// a Nord knob: the black cap (kept in the layer) and its white pointer
// Where the sound has a knob now (v[k].now: the module's live_mod, read from
// the Nord's DSPs while a note sounds: the newest voice's cutoff): outside
// the knob, an arc in the modulation colour from the pointer and a dot.
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function modMark(g, v, k, x, y, r) {
  if (!known(v, k) || typeof v[k].now !== "number") return;
  var f = v[k].frac, n = Math.max(0, Math.min(1, v[k].now));
  if (Math.abs(n - f) < 0.004) return;
  g.arc(x, y, r + 4, A0 + Math.min(f, n) * SWEEP, Math.abs(n - f) * SWEEP, 2, MOD_DK);
  g.dot(x + Math.cos(A0 + n * SWEEP) * (r + 4), y + Math.sin(A0 + n * SWEEP) * (r + 4), 2.8, MOD);
}
function capPointer(g, x, y, r, f, color, width) {
  var a = A0 + f * SWEEP;
  g.line(x + Math.cos(a) * r * 0.22, y + Math.sin(a) * r * 0.22, x + Math.cos(a) * (r - 1.5), y + Math.sin(a) * (r - 1.5), width, color);
}
// everything on the panel that never changes: drawn once, kept (g.layer)
function panelGround(g, R) {
  g.fill(0, 0, 960, 160, RED);
  g.value(10, 17, "NODAL RED 2X", INK, -1);
  section(g, 6, 140, "SLOT");
  g.fill(12, 38, 60, 34, LED_GLASS);
  section(g, 152, 150, "LFO");
  g.text(180, 66, "RATE", SOFT, 0); g.text(208, 66, "AMT", SOFT, 0);
  g.text(158, 51, "1", INK, -1);
  section(g, 308, 104, "MOD ENV");
  section(g, 418, 226, "OSCILLATORS");
  g.fill(424, 38, 44, 20, "black"); g.fill(474, 38, 44, 20, "black");
  g.text(446, 68, "OSC 1", SOFT, 0); g.text(496, 68, "OSC 2", SOFT, 0);
  g.text(456, 87, "FM", SOFT, -1); g.text(510, 87, "PW", SOFT, -1);
  section(g, 650, 168, "FILTER");
  g.text(681, 87, "FREQ", SOFT, -1); g.text(735, 87, "RES", SOFT, -1); g.text(787, 87, "ENV", SOFT, -1);
  section(g, 824, 130, "AMPLIFIER");
  g.text(855, 87, "GAIN", SOFT, -1);
  for (var i = 0; i < KNOBS.length; i++) {
    var k = KNOBS[i];
    g.dot(k[1], k[2], 9, KNOB_RIM); g.dot(k[1], k[2], 8, KNOB);
    if (k[3] && k[0].indexOf("lfo") !== 0) g.text(k[1], k[2] + 19, k[3], SOFT, 0);
  }
  // the encoder row: the same red, under a black rule, eight knobs and their LED displays
  g.fill(0, 102, 960, 2, "black");
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, 110, 1, R.rule, RED_DK);
  }
}
// The encoder row's geometry: in segment mode the bottom 18 pixels are
// Pung's (the segments' names), so the row draws tighter, above y 142.
var ROW = { name: 119, ky: 138, kr: 13.5, ring: 17, glass: 127, glassH: 24, val: 146, rule: 44 };
var ROW_SEG = { name: 116, ky: 129, kr: 10, ring: 12.5, glass: 120, glassH: 20, val: 136, rule: 30 };
function panel(g, v) {
  var t = v.$touched || "", sl = slots(v), R = v.$segmode ? ROW_SEG : ROW;
  // the ground and the encoder row's empty knobs, kept until the knobs change
  var kn = v.$knobs || [];
  g.layer("panel|" + kn.join(",") + "|" + (v.$segmode ? 1 : 0), function () {
    panelGround(g, R);
    for (var c = 0; c < 8; c++) {
      if (!kn[c] || !v[kn[c]]) continue;
      var kx = c * 120 + 28;
      g.dot(kx, R.ky, R.kr + 1.5, KNOB_RIM); g.dot(kx, R.ky, R.kr, KNOB);
      // the scale's two ends, printed on the panel
      g.dot(kx + Math.cos(A0) * (R.kr + 5), R.ky + Math.sin(A0) * (R.kr + 5), 1.2, SOFT);
      g.dot(kx + Math.cos(A0 + SWEEP) * (R.kr + 5), R.ky + Math.sin(A0 + SWEEP) * (R.kr + 5), 1.2, SOFT);
      g.fill(c * 120 + 50, R.glass, 64, R.glassH, LED_GLASS);
    }
  });
  segmentLit(g, v);
  // the pointers
  for (var i = 0; i < KNOBS.length; i++) {
    var k = KNOBS[i];
    if (k[0] === t) g.arc(k[1], k[2], 11, 0, Math.PI * 2, 2, "slot");
    if (known(v, k[0])) capPointer(g, k[1], k[2], 8, frac(v, k[0], 0), INK, 2);
    modMark(g, v, k[0], k[1], k[2], 9);
  }
  var nm = disp(v, "preset_name");
  var nw = nm ? g.measure(nm.toUpperCase()) : 0;
  g.text(950, 15, nm ? nm.toUpperCase() : "", INK, 1, 420);
  g.text(950 - nw - 14, 15, (disp(v, "bank_name") || "").toUpperCase(), SOFT, 1, 300);
  // slots: the display (the program's number, in the Nord's red LEDs) and the four buttons
  var pn = known(v, "preset") ? ("0" + (num(v, "preset", 0) + 1)).slice(-2) : "--";
  g.value(42, 62, pn, LED_RED, 0);
  for (var j = 0; j < 4; j++) {
    var s = sl[j] || { on: j === 0, edit: j === 0 }, bx = 12 + j * 33;
    led(g, bx + 13, 79, s.on);
    g.fill(bx, 84, 27, 12, s.edit ? INK : KNOB);
    // a slot that is off cannot be chosen to edit: its letter is unlit
    g.text(bx + 13, 94, "ABCD".charAt(j), s.edit ? "black" : (s.on ? INK : "#5a5a5a"), 0);
  }
  pill(g, 80, 48, disp(v, "voice_mode").toUpperCase() || "POLY", true);
  pill(g, 80, 62, "UNISON", isOn(v, "unison"));
  pill(g, 80, 76, "PORTA", frac(v, "portamento", 0) > 0.01);
  // LFO 1 over LFO 2 / the arpeggiator
  pill(g, 226, 44, short(disp(v, "lfo1_wave") || "TRI"), true);
  pill(g, 226, 58, short(disp(v, "lfo1_dest") || ""), frac(v, "lfo1_amount", 0) > 0.005);
  var d2 = disp(v, "lfo2_dest"), off2 = !d2 || /off/i.test(d2), arp = !off2 && !/^LFO /i.test(d2) ;
  g.text(158, 89, "2", INK, -1);
  pill(g, 226, 82, off2 ? "OFF" : (arp ? (/echo/i.test(d2) ? "ECHO" : "ARP " + short(d2)) : short(d2)), !off2);
  var s2 = disp(v, "lfo2_sync"), s1 = disp(v, "lfo1_sync");
  if (synced(v, "lfo2_sync")) pill(g, 226, 96, s2, true);
  if (synced(v, "lfo1_sync")) g.text(296, 31, "SYNC " + s1, LED_ON, 1);
  // the mod envelope, and the wheel
  pill(g, 314, 82, short(disp(v, "modenv_dest") || "NONE"), Math.abs(frac(v, "modenv_amount", 0.5) - 0.5) > 0.01);
  g.text(314, 96, "WHEEL " + short(disp(v, "modwheel_dest") || ""), SOFT, -1, 94);
  // oscillators
  var w1 = WAVES1[waveIndex(v, "osc1_wave", 4)], w2 = WAVES2[waveIndex(v, "osc2_wave", 4)];
  g.poly(cached("p1|" + w1, function () { return wavePts(426, 39, 40, 18, function (q) { return osc(w1, q * 2, 0); }); }), 1.5, t === "osc1_wave" ? "slot" : INK);
  g.poly(cached("p2|" + w2, function () { return wavePts(476, 39, 40, 18, function (q) { return osc(w2, q * 2, 0); }); }), 1.5, t === "osc2_wave" ? "slot" : INK);
  led(g, 548, 83, isOn(v, "sync")); g.text(555, 87, "SYNC", isOn(v, "sync") ? INK : SOFT, -1);
  led(g, 598, 83, isOn(v, "ringmod")); g.text(605, 87, "RING", isOn(v, "ringmod") ? INK : SOFT, -1);
  // filter: its type, distortion
  pill(g, 772, 44, short(disp(v, "filter_type") || "LP 12").replace("NOTCH+LP", "NOTCH").replace(" ", ""), true);
  led(g, 777, 56, isOn(v, "distortion")); g.text(784, 60, "DIST", isOn(v, "distortion") ? INK : SOFT, -1);
  // amplifier: the octave the keys play in
  var oc = disp(v, "octave");
  pill(g, 896, 87, "OCT " + (oc && oc !== "0" && oc.charAt(0) !== "-" ? "+" : "") + (oc || "0"), !!oc && oc !== "0");
}
// The encoder row, as the Nord shows a knob: the legend printed on the red,
// the black knob with its white pointer, and beside it the value in the red
// LED display the Nord shows a turned knob in. The touched knob: its legend
// and value in the slot's colour, a ring around the knob.
function panelRow(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "", R = v.$segmode ? ROW_SEG : ROW;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, kx = x0 + 28, ky = R.ky;
    var nm = String(v[k].name).toUpperCase();
    // the touched one's legend lit on black, as the panel's lit selector legends are
    if (hot) { var nw = Math.min(112, g.measure(nm) + 10); g.fill(x0 + 60 - nw / 2, R.name - 10, nw, 13, "black"); }
    g.text(x0 + 60, R.name, nm, hot ? "slot" : INK, 0, 104);
    if (hot) g.arc(kx, ky, R.ring, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) capPointer(g, kx, ky, R.kr, v[k].frac, hot ? "slot" : INK, 3);
    modMark(g, v, k, kx, ky, R.kr + 2);
    var val = known(v, k) ? String(v[k].display || v[k].value) : "--", unit = known(v, k) ? String(v[k].unit || "") : "";
    var uw = unit ? g.measure(unit) + 3 : 0, cx = x0 + 82;
    var vw = Math.min(g.measure(val, "value"), 58 - uw);
    g.value(cx - (vw + uw) / 2, R.val, val, hot ? "slot" : LED_RED, -1, 58 - uw);
    if (unit) g.text(cx - (vw + uw) / 2 + vw + 3, R.val, unit, SOFT, -1);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 31, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, SOFT, 1);
}
// The panel's sections, each one press away (segment mode): where it sits,
// and the knobs a hand reaches for in it, in the panel's order.
var SEGMENTS = [
  { id: "slot", label: "Slot", rect: [6, 22, 140, 78], keys: ["slot", "slot_a", "slot_b", "slot_c", "slot_d", "voice_mode", "unison", "portamento"] },
  { id: "lfo", label: "LFO", rect: [152, 22, 150, 78], keys: ["lfo1_rate", "lfo1_amount", "lfo1_wave", "lfo1_dest", "lfo2_rate", "lfo2_amount", "lfo2_dest", "lfo2_sync"] },
  { id: "modenv", label: "Mod Env", rect: [308, 22, 104, 78], keys: ["modenv_attack", "modenv_decay", "modenv_amount", "modenv_dest", "modwheel_dest"] },
  { id: "osc", label: "Oscillators", rect: [418, 22, 226, 78], keys: ["osc1_wave", "osc2_wave", "osc2_semi", "osc2_fine", "mix", "fm", "pw", "sync"] },
  { id: "filter", label: "Filter", rect: [650, 22, 168, 78], keys: ["cutoff", "resonance", "filter_env", "filter_type", "flt_attack", "flt_decay", "flt_sustain", "flt_release"] },
  { id: "amp", label: "Amplifier", rect: [824, 22, 130, 78], keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_release", "amp_gain", "octave"] }
];
// the segment the encoders play: its section's legend lit (the title bar in
// the slot's colour); Pung draws the bar above it
function segmentLit(g, v) {
  if (v.$segmode !== "segment" || !v.$segment) return;
  for (var i = 0; i < SEGMENTS.length; i++) {
    var s = SEGMENTS[i];
    if (s.id !== v.$segment) continue;
    var x = s.rect[0], w = s.rect[2];
    g.fill(x, 22, w, 11, "slot");
    g.text(x + 5, 31, s.label.toUpperCase(), "black", -1);
  }
}
// Pung's default pages in the Nord's red, with its black knobs
push.theme({ ground: RED, panel: KNOB, ink: INK, dim: SOFT, rule: KNOB_RIM, faint: "#d2646b", accent: LED_ON, knob: "pointer" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [
    { label: "Panel", keys: ["slot", "cutoff", "resonance", "filter_env", "mix", "amp_attack", "amp_release", "portamento"] }
  ],
  segments: SEGMENTS, draws_segments: true,
  extra_keys: ["slots_info", "preset", "preset_name", "bank_name", "voice_mode", "unison", "lfo1_rate", "lfo1_amount", "lfo1_wave", "lfo1_dest",
    "lfo1_sync", "lfo2_rate", "lfo2_amount", "lfo2_dest", "lfo2_sync", "modenv_attack", "modenv_decay", "modenv_amount", "modenv_dest",
    "modwheel_dest", "osc1_wave", "osc2_wave", "osc2_semi", "osc2_fine", "fm", "pw", "sync", "ringmod", "amp_decay", "amp_sustain",
    "amp_gain", "octave", "flt_attack", "flt_decay", "flt_sustain", "flt_release", "filter_type", "distortion"],
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
  g.fill(x + 6, y + 64, Math.round((w - 12) * s.cut), 2, s.on ? "dim" : "faint");
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
    // over the Edit Slot knob: the letter the panel edits, in the Nord's LED display
    var e = disp(v, "slot") || "A";
    g.text(60, 13, "THE KNOBS EDIT", "dim", 0);
    g.fill(14, 20, 92, 40, "#1c0407"); frame(g, 14, 20, 92, 40, false);
    g.value(60, 47, e, t === "slot" ? "slot" : LED_RED, 0);
    var kn = v.$knobs || [], onl = "";
    for (var q = 0; q < sl.length; q++) if (sl[q].on) onl += (onl ? " " : "") + "ABCD".charAt(q);
    // the knob moves among the slots that are on: with one, there is nowhere to go
    if (kn[0] === "slot") g.text(60, 76, onl.length > 1 ? "TURN: " + onl : "ONLY SLOT ON", "faint", 0, 104);
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
// a band's heading: the section's name, and what it says beside it
function heading(g, x, s, lit) { g.text(x, 12, s, lit ? "fg" : "dim", -1); }
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["cutoff", "resonance", "filter_env", "filter_type", "flt_attack", "flt_decay", "flt_sustain", "flt_release"] },
    { label: "Filter +", keys: ["filter_kbt", "filter_velo", "distortion"] }
  ],
  extra_keys: ["slots_info"],
  screen: function (g, v) {
    red(g);
    var half = 480, t = v.$touched || "";
    heading(g, 10, short(disp(v, "filter_type") || "LP 12"), t === "filter_type");
    // what else shapes it, in the panel's words
    var flags = [], kt = disp(v, "filter_kbt");
    if (kt && kt.toLowerCase() !== "off") flags.push("KBD " + kt.toUpperCase());
    if (isOn(v, "filter_velo")) flags.push("VELOCITY");
    if (isOn(v, "distortion")) flags.push("DIST");
    g.text(half - 14, 12, flags.join("  "), "dim", 1, 300);
    g.filter(4, 16, half - 14, 68, { cutoff: "cutoff", resonance: "resonance", type: "filter_type" });
    // where the envelope takes the cutoff: a mark on the frequency axis
    var env = frac(v, "filter_env", 0), cut = frac(v, "cutoff", 0);
    if (env > 0.01) {
      var x0 = 10 + (half - 26) * cut, x1 = 10 + (half - 26) * Math.min(1, cut + env * (1 - cut));
      g.fill(x0, 80, Math.max(2, x1 - x0), 2, t === "filter_env" ? "slot" : "mod");
      var lx = x1 + 4 > half - 40 ? x0 - 30 : x1 + 4;
      g.fill(lx - 2, 75, 28, 10, "#000000");
      g.text(lx, 84, "ENV", t === "filter_env" ? "slot" : "mod", -1);
    }
    g.line(half, 6, half, 82, 1, "line");
    heading(g, half + 12, "FILTER ENVELOPE", t.indexOf("flt_") === 0);
    g.envelope(half + 8, 16, half - 16, 68, { attack: "flt_attack", decay: "flt_decay", sustain: "flt_sustain", release: "flt_release", labels: true });
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
    var half = 480, t = v.$touched || "";
    heading(g, 10, "AMP ENVELOPE", t.indexOf("amp_") === 0 && t !== "amp_gain");
    g.envelope(4, 16, half - 14, 68, { attack: "amp_attack", decay: "amp_decay", sustain: "amp_sustain", release: "amp_release", labels: true });
    g.line(half, 6, half, 82, 1, "line");
    // gain: the output's level, a meter's scale
    var x = half + 14, gain = frac(v, "amp_gain", 1);
    heading(g, x, "GAIN", t === "amp_gain");
    for (var i = 0; i < 16; i++) {
      var on = i < Math.round(gain * 16);
      g.fill(x + i * 7, 20, 5, 10, on ? (t === "amp_gain" ? "slot" : "fg") : "line");
    }
    g.text(x, 48, "OCTAVE", "dim", -1);
    var oc = disp(v, "octave") || "0";
    g.value(x, 72, (oc !== "0" && oc.charAt(0) !== "-" ? "+" : "") + oc, t === "octave" ? "slot" : "fg", -1);
    g.text(x + 56, 72, "BEND " + (disp(v, "bend_range") || "--"), t === "bend_range" ? "slot" : "dim", -1);
    // how keys are played, in words
    var mode = disp(v, "voice_mode").toUpperCase() || "POLY", uni = isOn(v, "unison"), porta = frac(v, "portamento", 0);
    var voices = mode === "POLY" ? (uni ? 2 : 1) : (uni ? 4 : 1), x2 = half + 160;
    g.value(x2, 28, mode, t === "voice_mode" ? "slot" : "fg", -1);
    var say = mode === "POLY" ? "CHORDS" : (mode === "LEGATO" ? "ONE NOTE, TIED NOTES DO NOT RETRIGGER" : "ONE NOTE, EVERY KEY RETRIGGERS");
    g.text(x2, 46, say, "dim", -1, 300);
    g.text(x2, 62, uni ? "UNISON: " + voices + " VOICES A KEY" + (disp(v, "unison_detune") ? ", DETUNE " + disp(v, "unison_detune") : "") : "ONE VOICE A KEY",
      t === "unison" || t === "unison_detune" ? "slot" : (uni ? "mod" : "dim"), -1, 300);
    g.text(x2, 78, porta > 0.01 ? "GLIDE" + (isOn(v, "porta_auto") ? " ON TIED NOTES" : " ON EVERY NOTE") : "NO GLIDE",
      t === "portamento" || t === "porta_auto" ? "slot" : (porta > 0.01 ? "fg" : "faint"), -1, 300);
    badge(g, v);
  }
});

// ---- MODULATION: who moves what ---------------------------------------------------------
// The Nord's modulation is a few fixed routes: each source has its selector,
// and its LEDs name where it can go. Left, the sources that move in time (an
// LFO, the mod envelope: Pung's pictures, live); on the Wheel / Pedal page,
// what pressure and the pedal do. Right, the routes as the panel has them: a
// row a source, a column a destination, a faint dot where its selector could
// point, the lit one where it does, as large as its amount.
var DCOLS = ["OSC1+2", "OSC 2", "FM", "PW", "FILTER", "AMP", "LFO 1", "MORPH"];
function destCol(name) {
  var s = String(name).toUpperCase();
  if (s === "LFO 1") return 6;
  s = s.replace(/^LFO /, "").replace("OSC 1+2", "OSC1+2");
  for (var i = 0; i < DCOLS.length; i++) if (DCOLS[i] === s) return i;
  return -1;
}
var CAN = [[3, 4, 1, 0, 2], [5, 0, 4], [1, 2, 3], [4, 2, 1, 6, 7]]; // LFO 1, LFO 2, mod env, wheel: where each selector can point
var SRC = ["LFO 1", "LFO 2", "MOD ENV", "WHEEL"];
var GX = 512, CX0 = 574, GW = 47, GROWS = [29, 45, 61, 77]; // the routes: a column a destination, a row a source
function lfo2Text(v) {
  var d2 = disp(v, "lfo2_dest"), a = frac(v, "lfo2_amount", 0), r = Math.round(a * 4);
  if (!d2 || /off/i.test(d2)) return "OFF";
  if (/echo/i.test(d2)) return "ECHO  " + Math.round(a * 8) + " REPEATS";
  return "ARP " + d2.replace(/^Arp /i, "").toUpperCase() + "  " + (r ? r + " OCT" : "RANGE OFF");
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
    var t = v.$touched || "", pg = v.$page || 0;
    var d2 = disp(v, "lfo2_dest"), lfo2 = /^LFO /i.test(d2), amt = (frac(v, "modenv_amount", 0.5) - 0.5) * 2;
    if (pg < 3) {
      // the LFO this page is about (LFO 1 on the others): synced to the clock, it runs on Live's beat
      var n = pg === 1 ? 2 : 1, p = "lfo" + n + "_", sync = synced(v, p + "sync");
      heading(g, 10, n === 2 && !lfo2 ? (/echo/i.test(d2) ? "ECHO" : "ARPEGGIATOR") : "LFO " + n, t.indexOf(p) === 0);
      if (n === 1 || lfo2) {
        g.text(230, 12, (n === 1 ? short(disp(v, "lfo1_wave")) : "TRI") + (sync ? "  " + disp(v, p + "sync") : ""), "dim", 1);
        g.lfo(4, 16, 232, 70, { shape: n === 1 ? "lfo1_wave" : "Triangle", rate: sync ? p + "sync" : p + "rate" });
      } else {
        g.text(230, 12, sync ? disp(v, "lfo2_sync") : "", "dim", 1);
        g.value(12, 50, lfo2Text(v), /off/i.test(d2) || !d2 ? "faint" : (t.indexOf("lfo2_") === 0 ? "slot" : "fg"), -1, 230);
        g.text(12, 72, "PLAYED BY LFO 2'S KNOBS", "faint", -1, 230);
      }
      // the mod envelope: attack and decay, up or down at its destination (a note runs along it)
      heading(g, 254, "MOD ENV", t.indexOf("modenv_") === 0);
      g.text(254 + g.measure("MOD ENV") + 10, 12, (amt < -0.02 ? "INVERTED " : "") + (disp(v, "modenv_amount") || ""), amt < -0.02 ? "mod" : "dim", -1);
      g.envelope(246, 16, 256, 70, { attack: "modenv_attack", decay: "modenv_decay" });
    } else {
      // pressure and the pedal: a destination and how much (0 to 7)
      var rows = [["PRESSURE", "pressure_"], ["PEDAL", "pedal_"]];
      for (var r = 0; r < 2; r++) {
        var k = rows[r][1], a = Math.round(num(v, k + "amount", 0)), h = t.indexOf(k) === 0, y = 14 + r * 40;
        g.text(10, y, rows[r][0], h ? "fg" : "dim", -1);
        g.value(10, y + 22, a ? disp(v, k + "dest") : "OFF", h ? "slot" : (a ? "fg" : "faint"), -1, 300);
        for (var q = 0; q < 7; q++) g.fill(330 + q * 24, y + 8, 18, 12, q < a ? (h ? "slot" : "mod") : "line");
      }
    }
    g.line(506, 6, 506, 82, 1, "line");
    // the routes
    function reach(row, name, amount, touched) {
      var can = CAN[row], d = destCol(name), y = GROWS[row];
      g.text(GX + 4, y + 4, SRC[row], row === pg || touched ? "fg" : "dim", -1);
      for (var i = 0; i < can.length && (row !== 1 || lfo2); i++) g.dot(CX0 + can[i] * GW + GW / 2, y, 1.8, "line");
      if (d < 0 || amount <= 0.004) return -1;
      var cx = CX0 + d * GW + GW / 2;
      g.line(CX0, y, cx - 6, y, 1, touched ? "slot" : (row === pg ? "dim" : "line"));
      g.dot(cx, y, 3 + amount * 4, touched ? "slot" : "mod");
      return d;
    }
    var used = {};
    used[reach(0, disp(v, "lfo1_dest"), frac(v, "lfo1_amount", 0), t === "lfo1_dest" || t === "lfo1_amount")] = 1;
    used[reach(1, lfo2 ? d2 : "", frac(v, "lfo2_amount", 0), t === "lfo2_dest" || t === "lfo2_amount")] = 1;
    used[reach(2, disp(v, "modenv_dest"), Math.abs(amt), t === "modenv_dest" || t === "modenv_amount")] = 1;
    used[reach(3, disp(v, "modwheel_dest"), 0.6, t === "modwheel_dest")] = 1; // the wheel has no amount: it goes the whole way
    if (!lfo2) g.text(CX0 + 4, GROWS[1] + 4, d2 && !/off/i.test(d2) ? "PLAYS THE ARPEGGIATOR" : "", "faint", -1);
    for (var c = 0; c < DCOLS.length; c++) g.text(CX0 + c * GW + GW / 2, 13, DCOLS[c], used[c] ? "fg" : "faint", 0, GW - 4);
    badge(g, v, 500);
  }
});

// ---- MORPH: every range on its knob ---------------------------------------------------------
// A range is in the knob's own steps (-128..127): at full morph the knob
// stands at its value plus the range, kept on the dial. Each knob as the
// panel has it, black with its white pointer; around it, the arc full morph
// sweeps it through, ending in a dot; under it, from where to where.
function morphDial(g, col, v, key, base, steps) {
  var cx = col * 120 + 60, cy = 44, r = 25;
  var b = frac(v, base, 0), range = num(v, key, 0) / steps, to = Math.max(0, Math.min(1, b + range)), on = hot(v, key);
  g.arc(cx, cy, r, A0, SWEEP, 1, "line");
  g.dot(cx, cy, 16, KNOB_RIM); g.dot(cx, cy, 14.5, KNOB);
  if (known(v, base)) capPointer(g, cx, cy, 14.5, b, INK, 2.5);
  if (Math.abs(to - b) > 0.004 && known(v, key)) {
    var from = Math.min(b, to), len = Math.abs(to - b);
    g.arc(cx, cy, r, A0 + from * SWEEP, len * SWEEP, 4, on ? "slot" : "mod");
    var ta = A0 + to * SWEEP; // the arrow's head: where full morph ends
    g.dot(cx + Math.cos(ta) * r, cy + Math.sin(ta) * r, 4, on ? "slot" : "mod");
    // from where to where, in the knob's own numbers
    var raw = num(v, base, 0), lo = raw - b * steps, tgt = Math.round(lo + to * steps);
    g.text(cx, 84, (known(v, base) ? disp(v, base) : "--") + " > " + tgt, on ? "slot" : "fg", 0, 112);
  } else {
    g.text(cx, 84, known(v, key) ? "NO MORPH" : "--", "faint", 0, 112);
  }
}
function morphPage(label, pairs) {
  var keys = [], bases = [];
  for (var i = 0; i < pairs.length; i++) { keys.push("morph_" + pairs[i][0]); bases.push(pairs[i][0]); }
  return {
    label: "Morph " + label, keys: keys,
    screen: function (g, v) {
      red(g);
      for (var i = 0; i < pairs.length; i++) morphDial(g, i, v, keys[i], bases[i], pairs[i][1] || 127);
      // the legend, where a column is free
      var x = pairs.length * 120 + 10;
      if (pairs.length < 8) {
        g.text(x, 30, "MORPH", "fg", -1);
        g.text(x, 46, "VELOCITY OR", "dim", -1);
        g.text(x, 58, "THE WHEEL", "dim", -1);
        g.text(x, 70, "TURNS EVERY", "dim", -1);
        g.text(x, 82, "KNOB AT ONCE", "dim", -1);
      }
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
