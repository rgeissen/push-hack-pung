// JE-8086 (JP-8000) on the Push. The compartments are the tabs of the
// module's own web panel (src/remote/assets/jp-model.js: Osc, Filter & Amp,
// LFO & Mod, FX, Play & Arp, System), their pages that panel's numbered
// sections, so the Push and the page show one instrument.
//
// One compartment draws the whole panel (front panel): Patch, the JP-8000's
// own way in, on its own slate panel:
// - its LCD: the patch number as the hardware writes it (P:A11..P:B88), the
//   name, and the parameter being turned, as its second line does;
// - MODE and PANEL SELECT as its rubber buttons with their red LEDs (Patch /
//   Perform, Upper / Lower, both lit for Both);
// - the performance across its 49 keys: Single, Dual or Split, the split
//   point, each part's own patch name (read from the emulator's patch image,
//   as the web panel reads it), which part the panel edits and where the
//   arpeggiator plays: what a performance IS, which no knob shows;
// - the panel's sections in its order: LFO 1, the oscillators, the filter,
//   the amp (Pung's LFO, filter and envelope, in the panel's ink);
// - the encoder row as the panel's controls: black pointer knobs, the
//   envelope's sliders, LED selectors for the switches.

var SLATE = "#1e2228", RULE = "#454c57", INK = "#dfe3ea", LEGEND = "#b3bac5", INK_DIM = "#8b929d";
var KNOB = "#0a0b0d", KNOB_RIM = "#3a414b", SLOT_BG = "#07080a";
var LED_ON = "#ff3b2f", LED_OFF = "#3d2321", BTN = "#2b3038", BTN_EDGE = "#4a525e";
var LCD_BEZEL = "#08090a", LCD_BG = "#2a1a06", AMBER = "#ffb547", AMBER_DIM = "#a3712a";

function pages(label, keys) { // a section: 8 keys to a page
  var out = [];
  for (var i = 0; i < keys.length; i += 8) {
    out.push({ label: i ? label + " " + (i / 8 + 1) : label, keys: keys.slice(i, i + 8) });
  }
  return out;
}
function concat() { var o = []; for (var i = 0; i < arguments.length; i++) o = o.concat(arguments[i]); return o; }
function pre(p, list) { return list.map(function (k) { return p + k; }); }

// ---- values ---------------------------------------------------------------------------

function known(v, k) { return v[k] && v[k].known; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : "--"; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function up(s) { return String(s).toUpperCase(); }
// an enum as its index, whether the module says 1 or "Performance"
function pick(v, k, names) {
  if (!known(v, k)) return -1;
  var s = String(v[k].value), n = parseInt(s, 10);
  if (!isNaN(n) && String(n) === s.trim()) return n;
  var d = String(v[k].display || s).toLowerCase();
  for (var i = 0; i < names.length; i++) if (d.indexOf(names[i]) === 0) return i;
  return -1;
}
function modeIndex(v) { return pick(v, "mode", ["patch", "perf", "sys"]); }
function partIndex(v) { return pick(v, "part", ["upper", "lower", "both"]); }
function keyMode(v) { return pick(v, "key_mode", ["single", "dual", "split"]); }
function isOn(v, k) { var d = known(v, k) ? String(v[k].display || v[k].value).toLowerCase() : ""; return d === "on" || d === "1"; }

// the hardware's patch number: P (preset), bank letter, group 1-8, number 1-8
function patchNumber(v) {
  var bank = known(v, "bank") ? String(v.bank.display) : "A";
  var letter = bank.charAt(bank.length - 1);
  if (!known(v, "patch")) return "P:---";
  var i = parseInt(v.patch.value, 10) || 0;
  return "P:" + letter + (Math.floor(i / 8) % 8 + 1) + (i % 8 + 1); // P:A11, as the hardware's LCD
}
function perfNumber(v) {
  if (!known(v, "performance")) return "P:--";
  var i = parseInt(v.performance.value, 10) || 0;
  return "P:" + (Math.floor(i / 8) % 8 + 1) + (i % 8 + 1);
}

// the two parts' patch names, from the emulator's patch image ("temp", as the
// web panel reads it: jp-model.js, OFFSET.patch_up / patch_lo)
var tempMemo = { s: null, up: "", lo: "" };
function partNames(v) {
  if (!known(v, "temp")) return null;
  var s = String(v.temp.value);
  if (s !== tempMemo.s) {
    var at = function (off) {
      var n = "";
      for (var i = 0; i < 16; i++) {
        var c = parseInt(s.substr((off + i) * 2, 2), 16);
        n += c >= 32 && c < 127 ? String.fromCharCode(c) : " ";
      }
      return n.replace(/\s+$/, "");
    };
    tempMemo = { s: s, up: s.length >= 610 ? at(50) : "", lo: s.length >= 610 ? at(289) : "" };
  }
  return tempMemo;
}

var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(n) { return NOTE[n % 12] + (Math.floor(n / 12) - 1); }

// how the JP's bare numbers read wherever Pung writes them (its pages, the
// row under a screen), as its web panel writes them (jp-model.js,
// valueText): notes by name, the master tune in Hz, the bender as a switch
push.display(function (key, raw) {
  var n = Math.round(parseFloat(raw));
  if (isNaN(n)) return;
  if (key === "split_point") return noteName(n);
  if (key === "trigger_note") return n >= 128 ? "All" : noteName(n);
  if (key === "active_bender") return n ? "On" : "Off";
  if (key === "sys_master_tune") return { value: (427.4 + 25.2 * n / 100).toFixed(1), unit: "Hz" };
});

// ---- the panel's ground: the slate, the LCD's glass, the keys, the printed rules -------------

var LCD = { x: 8, y: 6, w: 308, h: 54 };
var KB = { x: 8, y: 86, w: 464, h: 14, lo: 36, hi: 84 }; // the JP-8000's 49 keys, C2..C6
var SEC = [ // the panel's sections, in its order
  { id: "lfo", x: 484, w: 112, title: "LFO 1" },
  { id: "osc", x: 604, w: 112, title: "OSC 1 / 2" },
  { id: "filter", x: 724, w: 112, title: "FILTER" },
  { id: "amp", x: 844, w: 112, title: "AMP" }
];
var BTNS = [ // MODE and PANEL SELECT
  { x: 328, y: 6, label: "PATCH" }, { x: 402, y: 6, label: "PERFORM" },
  { x: 328, y: 34, label: "UPPER" }, { x: 402, y: 34, label: "LOWER" }
];

function isBlack(n) { var m = n % 12; return m === 1 || m === 3 || m === 6 || m === 8 || m === 10; }
var kbX = null;
function keyX(n) { // a key's centre on the strip
  if (!kbX) {
    kbX = {};
    var whites = 0, n0, wi = 0;
    for (n0 = KB.lo; n0 <= KB.hi; n0++) if (!isBlack(n0)) whites++;
    var ww = KB.w / whites;
    for (n0 = KB.lo; n0 <= KB.hi; n0++) {
      if (isBlack(n0)) kbX[n0] = KB.x + wi * ww;
      else { kbX[n0] = KB.x + (wi + 0.5) * ww; wi++; }
    }
    kbX.ww = ww;
  }
  return kbX[Math.max(KB.lo, Math.min(KB.hi, n))];
}

// the kind of control the panel has for a key: the envelopes' sliders, LED
// selectors for its switches (and any choice of a few), else a knob
var SWITCH = { part: ["upper", "lower", "both"], mode: ["patch", "perf", "sys"], bank: ["factory a", "factory b"], perf_bank: ["factory"] };
function choices(v, k) { // how many choices an enum has, where Pung says
  var e = v[k];
  return e && e.type === "enum" && typeof e.max === "number" && typeof e.min === "number" && e.max > e.min ? e.max - e.min + 1 : 0;
}
function kindOf(v, k) {
  if (SWITCH[k]) return "leds";
  if (/(attack|decay|sustain|release)$/.test(k) || k === "osc_balance" || k === "amp_level") return "slider";
  var n = choices(v, k);
  if (n >= 2 && n <= 5) return "leds";
  return "knob";
}

// the encoder row's lines: the whole bottom 56 px, or, while segment mode is
// on, the 38 px above Pung's segment names (y 142..160 are Pung's then)
function rowGeo(v) {
  return v.$segmode ? { name: 114, cy: 129, r: 9.5, tick: 12.5, top: 118, h: 23, val: 135, led: 7 }
    : { name: 117, cy: 139, r: 12, tick: 16, top: 122, h: 34, val: 147, led: 10 };
}

function ground(g, v, knobs) {
  var kinds = knobs.map(function (k) { return k && v[k] ? kindOf(v, k) : ""; });
  g.fill(0, 0, 960, 160, SLATE);
  // the LCD's bezel and glass
  g.fill(LCD.x - 3, LCD.y - 3, LCD.w + 6, LCD.h + 6, LCD_BEZEL);
  g.fill(LCD.x, LCD.y, LCD.w, LCD.h, LCD_BG);
  // the keyboard
  keyX(KB.lo);
  var n, ww = kbX.ww;
  g.fill(KB.x, KB.y, KB.w, KB.h, "#a7acb4");
  for (n = KB.lo; n <= KB.hi; n++) if (!isBlack(n) && n > KB.lo) g.fill(Math.round(kbX[n] - ww / 2), KB.y, 1, KB.h, "#7d828b");
  for (n = KB.lo; n <= KB.hi; n++) if (isBlack(n)) g.fill(Math.round(kbX[n] - ww * 0.3), KB.y, Math.round(ww * 0.6), 9, "#101215");
  // the sections: a printed title and the rule under it
  SEC.forEach(function (s) { g.fill(s.x, 17, s.w, 1, RULE); });
  // the encoder row: the panel's rule, the knobs' scales, the sliders' slots
  g.fill(0, 104, 960, 1, RULE);
  var G = rowGeo(v);
  for (var i = 0; i < 8; i++) {
    var cx = i * 120 + 60, kx = cx - 34, ky = G.cy;
    if (kinds[i] === "knob") {
      for (var t = 0; t <= 10; t++) {
        var a = Math.PI * (0.75 + 1.5 * t / 10);
        g.dot(kx + Math.cos(a) * G.tick, ky + Math.sin(a) * G.tick, t % 5 ? 0.8 : 1.3, t % 5 ? INK_DIM : INK);
      }
    } else if (kinds[i] === "slider") {
      for (var s = 0; s <= 6; s++) g.fill(kx - 12, G.top + 2 + Math.round(s * (G.h - 4) / 6), 5, 1, s % 3 ? RULE : INK_DIM);
      g.fill(kx - 2, G.top, 4, G.h, SLOT_BG);
    }
  }
}

// ---- the LCD, the buttons, the performance ---------------------------------------------

function lcd(g, v) {
  var x = LCD.x + 10, r = LCD.x + LCD.w - 10, perf = modeIndex(v) === 1;
  var num = perf ? perfNumber(v) : patchNumber(v);
  var name = perf ? disp(v, "performance_name") : disp(v, "patch_name");
  g.value(x, LCD.y + 23, num, AMBER, -1);
  var nx = x + g.measure(num, "value") + 12;
  // which page of the panel the encoders are on, at the line's end
  var ps = v.$pages || [], pg = ps.length > 1 ? up(ps[v.$page]) + " " + (v.$page + 1) + "/" + ps.length : "";
  if (pg) g.text(r, LCD.y + 21, pg, AMBER_DIM, 1);
  g.value(nx, LCD.y + 23, name === "--" ? "" : up(name), AMBER, -1, r - nx - (pg ? g.measure(pg) + 12 : 0));
  // line 2: what is being turned, as the JP-8000's own LCD does; else the state
  var t = v.$touched;
  if (t && v[t]) {
    var val = disp(v, t) + (known(v, t) && v[t].unit ? " " + v[t].unit : "");
    g.text(r, LCD.y + 45, up(val), AMBER, 1);
    g.text(x, LCD.y + 45, up(v[t].name), AMBER, -1, r - x - g.measure(up(val)) - 14);
  } else {
    var parts = [];
    if (perf && known(v, "key_mode")) parts.push(disp(v, "key_mode"));
    if (isOn(v, "arp_switch")) parts.push("ARP " + disp(v, "arp_mode") + " " + disp(v, "arp_beat").replace(/^NORMAL\s*/i, ""));
    if (known(v, "tempo")) parts.push(disp(v, "tempo") + " BPM");
    g.text(x, LCD.y + 45, up(parts.join("   ")), AMBER_DIM, -1, r - x);
  }
}

function button(g, b, lit, hot) {
  g.fill(b.x, b.y, 70, 22, hot ? "slot" : BTN_EDGE);
  g.fill(b.x + 1, b.y + 1, 68, 20, BTN);
  g.dot(b.x + 10, b.y + 11, 3, lit ? LED_ON : LED_OFF);
  g.text(b.x + 18, b.y + 15, b.label, lit ? INK : INK_DIM, -1);
}

function buttons(g, v) {
  var m = modeIndex(v), p = partIndex(v), t = v.$touched || "";
  button(g, BTNS[0], m === 0, t === "mode");
  button(g, BTNS[1], m === 1, t === "mode");
  button(g, BTNS[2], p === 0 || p === 2, t === "part");
  button(g, BTNS[3], p === 1 || p === 2, t === "part");
}

// the performance over the keys: which part plays where, under which name
function zones(g, v) {
  var y = 64, h = 18, perf = modeIndex(v) === 1, km = perf ? keyMode(v) : 0, p = partIndex(v);
  var names = partNames(v) || { up: "", lo: "" }, arp = isOn(v, "arp_switch");
  var dest = pick(v, "arp_dest", ["lower & upper", "lower", "upper"]);
  var x0 = KB.x, x1 = KB.x + KB.w;
  function band(bx0, bx1, by, bh, title, name, editing, arpHere) {
    g.fill(bx0, by, bx1 - bx0, bh, editing ? "#3a4250" : "#2a2f37");
    if (editing) g.fill(bx0, by + bh - 2, bx1 - bx0, 2, INK);
    var tx = bx0 + 6;
    g.text(tx, by + bh - 5, title, editing ? INK : INK_DIM, -1);
    tx += g.measure(title) + 8;
    var room = bx1 - tx - 6 - (arpHere ? 34 : 0);
    if (name && room > 20) g.text(tx, by + bh - 5, up(name), editing ? AMBER : AMBER_DIM, -1, room);
    if (arpHere) { g.fill(bx1 - 34, by + 3, 28, bh - 7, LED_OFF); g.text(bx1 - 20, by + bh - 6, "ARP", LED_ON, 0); }
  }
  if (!perf) { // a patch: one sound over the keys
    var pn = disp(v, "patch_name");
    band(x0, x1, y, h, "PATCH", pn === "--" ? "" : pn, true, arp);
    return;
  }
  if (km === 2) { // split: lower below the point, upper from it
    var sp = known(v, "split_point") ? parseInt(v.split_point.value, 10) : 60;
    var sx = Math.round(keyX(sp) - (isBlack(sp) ? 0 : kbX.ww / 2));
    sx = Math.max(x0 + 60, Math.min(x1 - 60, sx));
    band(x0, sx - 1, y, h, "LOWER", names.lo, p === 1 || p === 2, arp && dest !== 2);
    band(sx + 1, x1, y, h, "UPPER", names.up, p === 0 || p === 2, arp && dest !== 1);
    g.fill(sx - 1, y, 2, KB.y - y + KB.h, AMBER);
    var sn = noteName(sp), sw = g.measure(sn) + 6;
    g.fill(sx + 1, KB.y + 1, sw, KB.h - 2, AMBER);
    g.text(sx + 4, KB.y + KB.h - 3, sn, "#101215", -1);
  } else if (km === 1) { // dual: both over every key
    var hw = Math.floor((x1 - x0) / 2);
    band(x0, x0 + hw - 1, y, h, "UPPER", names.up, p === 0 || p === 2, arp && dest !== 1);
    band(x0 + hw + 1, x1, y, h, "LOWER", names.lo, p === 1 || p === 2, arp && dest !== 2);
  } else { // single: the part the panel selects
    var lo = p === 1;
    band(x0, x1, y, h, lo ? "LOWER" : "UPPER", lo ? names.lo : names.up, true, arp);
  }
}

// ---- the panel's sections --------------------------------------------------------------

// an oscillator's wave, by the name the module gives it (Pung has no picture
// for an oscillator: drawn here, cached per wave and place)
var waveMemo = {};
function wavePts(name, x, y, w, h) {
  var key = name + "|" + x + "|" + y + "|" + w + "|" + h;
  if (waveMemo[key]) return waveMemo[key];
  var n = up(name), pts = [], i, mid = y + h / 2, out = [];
  if (n.indexOf("NOISE") >= 0) {
    for (i = 0; i <= 32; i++) pts.push([x + i * w / 32, mid + (((i * 7919) % 13) / 13 - 0.5) * h]);
  } else if (n.indexOf("SUPER") >= 0) { // seven detuned saws: three drawn, the first in front
    for (var s = 0; s < 3; s++) {
      var q = [], off = s * 4;
      for (i = 0; i < 3; i++) { q.push([x + off + i * (w - 8) / 3, y + h]); q.push([x + off + (i + 1) * (w - 8) / 3 - 1, y]); }
      q.push([x + off + w - 8, y + h]);
      out.push(q);
    }
    return (waveMemo[key] = out);
  } else if (n.indexOf("SQR") >= 0 || n.indexOf("PWM") >= 0 || n.indexOf("SQUARE") >= 0) {
    for (i = 0; i < 3; i++) { var a = x + i * w / 3; pts.push([a, y + h], [a, y], [a + w / 6, y], [a + w / 6, y + h]); }
    pts.push([x + w, y + h]);
  } else if (n.indexOf("TRIANGLE MOD") >= 0) { // a triangle folded at its peaks
    for (i = 0; i < 3; i++) {
      var b = x + i * w / 3, c = w / 3;
      pts.push([b, y + h], [b + c * 0.35, y + h * 0.15], [b + c * 0.5, y + h * 0.4], [b + c * 0.65, y + h * 0.15]);
    }
    pts.push([x + w, y + h]);
  } else if (n.indexOf("TRI") >= 0) {
    for (i = 0; i <= 6; i++) pts.push([x + i * w / 6, i % 2 ? y : y + h]);
  } else if (n.indexOf("FEEDBACK") >= 0) {
    for (i = 0; i <= 40; i++) { var ph = i / 40 * 6.283 * 3; pts.push([x + i * w / 40, mid - Math.sin(ph + Math.sin(ph) * 1.4) * h / 2]); }
  } else { // saw
    for (i = 0; i < 3; i++) { pts.push([x + i * w / 3, y + h], [x + (i + 1) * w / 3 - 1, y]); }
    pts.push([x + w, y + h]);
  }
  return (waveMemo[key] = [pts]);
}
function wave(g, name, x, y, w, h, col) {
  if (name === "--") { g.fill(x, y + h / 2, w, 1, RULE); return; } // not read yet: a flat line
  var ps = wavePts(name, x, y, w, h);
  for (var i = ps.length - 1; i >= 0; i--) g.poly(ps[i], i ? 1 : 2, i ? INK_DIM : col);
}

function shortWave(s) {
  return up(s).replace("FEEDBACK OSC", "FEEDBACK").replace("SQR (PWM)", "SQUARE").replace("TRIANGLE MOD", "TRI MOD");
}

// the sections' printed parts and own drawings (in the panel's layer)
function sections(g, v) {
  var t = v.$touched || "", s, hot;
  // LFO 1
  s = SEC[0]; hot = /^lfo1/.test(t) || segLit(v, "lfo");
  g.text(s.x, 13, s.title, hot ? "slot" : INK, -1);
  g.text(s.x + s.w, 13, up(disp(v, "lfo1_waveform")).replace("SAWTOOTH", "SAW"), INK_DIM, 1, 60);
  g.text(s.x, 96, "RATE " + disp(v, "lfo1_rate"), INK_DIM, -1);
  g.text(s.x + s.w, 96, "FADE " + disp(v, "lfo1_fade"), INK_DIM, 1);
  // the oscillators, and the balance between them
  s = SEC[1]; hot = /^osc/.test(t) || segLit(v, "osc");
  g.text(s.x, 13, s.title, hot ? "slot" : INK, -1);
  var bal = fr(v, "osc_balance", 0.5);
  g.text(s.x, 31, "1", INK_DIM, -1);
  wave(g, disp(v, "osc1_waveform"), s.x + 12, 22, s.w - 12, 13, bal < 0.97 ? INK : RULE);
  g.text(s.x + 12, 47, shortWave(disp(v, "osc1_waveform")), INK_DIM, -1, s.w - 12);
  g.text(s.x, 64, "2", INK_DIM, -1);
  wave(g, disp(v, "osc2_waveform"), s.x + 12, 55, s.w - 12, 13, bal > 0.03 ? INK : RULE);
  g.text(s.x + 12, 80, shortWave(disp(v, "osc2_waveform")), INK_DIM, -1, s.w - 12);
  // OSC BALANCE: a slider on the panel, laid on its side here
  var bx = s.x + 12, bw = s.w - 12, bhot = t === "osc_balance";
  g.fill(bx, 92, bw, 2, SLOT_BG);
  g.fill(bx + bw / 2, 89, 1, 8, RULE);
  g.fill(bx + Math.round(bal * (bw - 8)), 88, 8, 10, bhot ? "slot" : KNOB);
  g.fill(bx + Math.round(bal * (bw - 8)) + 3, 88, 2, 10, bhot ? "slot" : INK);
  // the filter
  s = SEC[2]; hot = /^(cutoff|resonance|filter_type|cutoff_slope|filter_env)/.test(t) || segLit(v, "filter");
  var ft = known(v, "filter_type") ? up(v.filter_type.display || "LPF") : "LPF", slope = fr(v, "cutoff_slope", 1) > 0.5 ? 24 : 12;
  g.text(s.x, 13, s.title, hot ? "slot" : INK, -1);
  g.text(s.x + s.w, 13, ft + " -" + slope, INK_DIM, 1);
  // the amp
  s = SEC[3]; hot = /^amp_/.test(t) || segLit(v, "amp");
  g.text(s.x, 13, s.title, hot ? "slot" : INK, -1);
}

// Pung's pictures, live while the sound plays: drawn over the layer
function pictures(g, v) {
  var s = SEC[0];
  g.lfo(s.x - 4, 20, s.w + 8, 62, { shape: "lfo1_waveform", rate: "lfo1_rate", color: INK });
  s = SEC[2];
  var ft = known(v, "filter_type") ? up(v.filter_type.display || "LPF") : "LPF", slope = fr(v, "cutoff_slope", 1) > 0.5 ? 24 : 12;
  g.filter(s.x - 4, 20, s.w + 8, 80, { cutoff: "cutoff", resonance: "resonance", type: ft.replace("PF", "P") + " " + slope + " dB", color: INK });
  s = SEC[3];
  g.envelope(s.x - 4, 20, s.w + 8, 80, { attack: "amp_attack", decay: "amp_decay", sustain: "amp_sustain", release: "amp_release", color: INK });
}

// ---- the encoder row: the panel's own controls ----------------------------------------------

function knob(g, cx, cy, r, f, ok, hot) {
  g.dot(cx, cy, r, hot ? "slot" : KNOB_RIM);
  g.dot(cx, cy, r - 1.5, KNOB);
  if (!ok) return;
  var a = Math.PI * (0.75 + 1.5 * Math.max(0, Math.min(1, f)));
  g.line(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), 2.5, hot ? "slot" : INK);
}

function slider(g, cx, G, f, ok, hot) {
  if (!ok) return;
  var y = Math.round(G.top + G.h - 4 - Math.max(0, Math.min(1, f)) * (G.h - 8));
  g.fill(cx - 9, y - 4, 18, 9, hot ? "slot" : KNOB_RIM);
  g.fill(cx - 8, y - 3, 16, 7, KNOB);
  g.fill(cx - 8, y, 16, 1, hot ? "slot" : INK);
}

// an LED selector: one LED per choice, the chosen one lit (the JP's own way
// for a switch with few positions: its buttons step through printed choices)
function leds(g, cx, G, v, k, hot) {
  var n, sel;
  if (SWITCH[k]) { n = SWITCH[k].length; sel = pick(v, k, SWITCH[k]); }
  else { n = choices(v, k); sel = known(v, k) ? Math.round(v[k].frac * (n - 1)) : -1; }
  var y0 = G.cy - (n - 1) * G.led / 2;
  for (var j = 0; j < n; j++) g.dot(cx, y0 + j * G.led, G.led > 8 ? 3.2 : 2.6, j === sel ? (hot ? "slot" : LED_ON) : LED_OFF);
}

function row(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "", G = rowGeo(v);
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    var cx = i * 120 + 60, hot = k === t, ok = known(v, k), f = fr(v, k, 0);
    g.text(cx, G.name, up(v[k].name), hot ? "slot" : LEGEND, 0, 112);
    var kind = kindOf(v, k);
    if (kind === "slider") slider(g, cx - 34, G, f, ok, hot);
    else if (kind === "leds") leds(g, cx - 34, G, v, k, hot);
    else knob(g, cx - 34, G.cy, G.r, f, ok, hot);
    var val = ok ? (k === "mode" ? ["Patch", "Perform", "System"][modeIndex(v)] || disp(v, k) : String(v[k].display || v[k].value)) : "--", unit = ok && v[k].unit ? up(v[k].unit) : "";
    var uw = unit ? g.measure(unit) + 4 : 0, vx = cx + 22;
    g.value(vx - uw / 2, G.val, val, hot ? "slot" : INK, 0, 70 - uw);
    if (unit) g.text(vx - uw / 2 + Math.min(70 - uw, g.measure(val, "value")) / 2 + 4, G.val, unit, INK_DIM, -1);
  }
}

// ---- segments: the panel's sections under the hands -----------------------------------
// The JP's own sections, each with the keys its panel has there, in the
// panel's order. Pung draws the bar above the active one; a titled section
// lights its legend too, as a touch does.

var SEGMENTS = [
  { id: "mode", label: "Mode", rect: [5, 3, 470, 59], keys: ["mode", "bank", "perf_bank", "part", "mod_lever", "tempo"] },
  { id: "perform", label: "Perform", rect: [5, 62, 470, 40], keys: ["key_mode", "split_point", "part", "part_detune", "voice_assign", "arp_switch", "arp_mode", "arp_range"] },
  { id: "lfo", label: "LFO 1", rect: [480, 0, 120, 102], keys: ["lfo1_waveform", "lfo1_rate", "lfo1_fade", "lfo1_env_dest", "osc_lfo1_depth", "filter_lfo1_depth", "amp_lfo1_depth", "amp_lfo1_mode"] },
  { id: "osc", label: "Osc", rect: [600, 0, 120, 102], keys: ["osc1_waveform", "osc1_ctrl1", "osc1_ctrl2", "osc_balance", "osc2_waveform", "osc2_range", "osc2_fine", "cross_mod_depth"] },
  { id: "filter", label: "Filter", rect: [720, 0, 120, 102], keys: ["filter_type", "cutoff", "resonance", "filter_env_depth", "filter_attack", "filter_decay", "filter_sustain", "filter_release"] },
  { id: "amp", label: "Amp", rect: [840, 0, 120, 102], keys: ["amp_level", "amp_attack", "amp_decay", "amp_sustain", "amp_release", "amp_lfo1_depth", "amp_lfo2_depth", "amp_lfo1_mode"] }
];
// the active segment's legend lit, as a touch lights it (Pung draws the bar above)
function segLit(v, id) { return v.$segmode === "segment" && v.$segment === id; }

var PATCH_PAGES = [
  { label: "Patch", keys: ["cutoff", "resonance", "filter_env_depth", "part", "amp_attack", "amp_decay", "amp_sustain", "amp_release"] },
  { label: "Select", keys: ["mode", "bank", "perf_bank", "mod_lever", "tempo"] }
];
var PATCH_EXTRA = ["patch", "performance", "patch_name", "performance_name", "temp", "osc1_waveform", "osc2_waveform",
  "osc_balance", "filter_type", "cutoff_slope", "lfo1_waveform", "lfo1_rate", "lfo1_fade", "key_mode", "split_point",
  "arp_switch", "arp_mode", "arp_beat", "arp_dest"];
// what the panel's layer shows depends on: every value but the patch image
// (its two names stand for it), the touch and the page
var PATCH_SIG = PATCH_PAGES[0].keys.concat(PATCH_PAGES[1].keys, PATCH_EXTRA).filter(function (k) { return k !== "temp"; });
function panelSig(v) {
  var n = partNames(v), ks = v.$knobs || [], out = [v.$touched || "", v.$page, v.$segmode || "", v.$segment || "", ks.join(","), n ? n.up + "/" + n.lo : "-"];
  for (var j = 0; j < ks.length; j++) if (ks[j] && v[ks[j]]) out.push(v[ks[j]].value + "~" + v[ks[j]].display);
  for (var i = 0; i < PATCH_SIG.length; i++) { var k = PATCH_SIG[i]; out.push(known(v, k) ? v[k].value + "~" + v[k].display : "?"); }
  return out.join("|");
}

// Pung's default pages in the JP-8000's slate, with its black pointer knobs
push.theme({ ground: SLATE, panel: KNOB, ink: INK, dim: LEGEND, rule: KNOB_RIM, faint: BTN, accent: INK, knob: "pointer" });
push.compartment({
  id: "patch", label: "Patch", front_panel: true,
  pages: PATCH_PAGES,
  extra_keys: PATCH_EXTRA,
  segments: SEGMENTS,
  draws_segments: true,
  screen: function (g, v) {
    // everything but Pung's live pictures is one layer: drawn again only
    // when a value it shows, the touch or the page changes
    g.layer("jp|" + panelSig(v), function () {
      ground(g, v, v.$knobs || []);
      lcd(g, v);
      buttons(g, v);
      zones(g, v);
      sections(g, v);
      row(g, v);
    });
    pictures(g, v);
  }
});


// ---- the panel's sections, by the web panel's tabs ------------------------------

push.compartment({
  id: "osc", label: "Osc",
  pages: [
    { label: "OSC 1", keys: ["osc1_waveform", "osc1_ctrl1", "osc1_ctrl2"] },
    { label: "OSC 2", keys: ["osc2_waveform", "osc2_sync", "osc2_range", "osc2_fine", "osc2_ctrl1", "osc2_ctrl2"] },
    { label: "OSC Common", keys: ["ring_mod", "cross_mod_depth", "osc_balance", "pitch_env_depth", "pitch_env_attack", "pitch_env_decay"] }
  ]
});

push.compartment({
  id: "filteramp", label: "Filter & Amp",
  pages: [
    { label: "Filter", keys: ["filter_type", "cutoff_slope", "cutoff", "resonance", "key_follow", "filter_env_depth"] },
    { label: "Filter Env", keys: ["filter_attack", "filter_decay", "filter_sustain", "filter_release"] },
    { label: "Amp", keys: ["amp_level", "amp_attack", "amp_decay", "amp_sustain", "amp_release"] }
  ]
});

// the ribbon and velocity families, grouped as the web panel's drawers are
var FAMILY = [
  ["Filter", ["cutoff_frequency", "resonance", "filter_env_depth", "filter_env_attack_time", "filter_env_decay_time", "filter_env_sustain_level", "filter_env_release_time", "cutoff_freq_key_follow", "filter_lfo1_depth", "filter_lfo2_depth"]],
  ["Amp", ["amp_level", "amp_env_attack_time", "amp_env_decay_time", "amp_env_sustain_level", "amp_env_release_time", "amp_lfo1_depth", "amp_lfo2_depth"]],
  ["Pitch", ["pitch_lfo1_depth", "pitch_lfo2_depth", "pitch_envelope_depth", "pitch_envelope_attack_time", "pitch_envelope_decay_time", "portamento_time"]],
  ["Oscillators", ["osc1_control1", "osc1_control2", "osc2_range", "osc2_fine_wide", "osc2_control1", "osc2_control2", "oscillator_balance", "cross_modulation_depth"]],
  ["LFO & FX", ["lfo1_rate", "lfo1_fade", "lfo2_rate", "tone_control_bass", "tone_control_treble", "multi_effects_level", "delay_time", "delay_feedback"]],
  ["Delay", ["delay_level"]]
];
function family(prefix, title) {
  var out = [];
  FAMILY.forEach(function (f) {
    var keys = pre(prefix, f[1]);
    if (prefix === "vel_") keys = keys.map(function (k) { return k === "vel_filter_env_sustain_level" ? "vel_filter_env_sus_level" : k; });
    out = out.concat(pages(title + ": " + f[0], keys));
  });
  return out;
}

push.compartment({
  id: "lfo", label: "LFO & Mod",
  pages: concat(
    [{ label: "LFO 1", keys: ["lfo1_waveform", "lfo1_rate", "lfo1_fade", "osc_lfo1_depth", "lfo1_env_dest", "filter_lfo1_depth", "amp_lfo1_depth", "amp_lfo1_mode"] },
     { label: "LFO 2", keys: ["lfo2_rate", "mod_lever", "pitch_lfo2_depth", "filter_lfo2_depth", "amp_lfo2_depth", "lfo2_depth_select"] },
     { label: "Controller", keys: ["bend_up", "bend_down", "morph_bend", "active_bender", "active_control", "active_velocity"] }],
    family("ctl_", "Ribbon"),
    family("vel_", "Velocity"))
});

push.compartment({
  id: "fx", label: "FX",
  pages: [
    { label: "Tone, Chorus, Delay", keys: ["tone_bass", "tone_treble", "chorus_level", "chorus_type", "delay_time", "delay_feedback", "delay_level", "delay_type"] }
  ]
});

push.compartment({
  id: "play", label: "Play & Arp",
  pages: [
    { label: "Key & Panel", keys: ["key_mode", "split_point", "part_detune", "voice_assign", "output_assign"] },
    { label: "Keyboard", keys: ["portamento", "portamento_time", "velocity_switch", "mono", "legato", "osc_shift"] },
    { label: "Arpeggiator", keys: ["arp_switch", "arp_hold", "tempo", "arp_mode", "arp_range", "arp_beat", "arp_dest"] },
    { label: "Upper Part", keys: pre("up_", ["midi_ch", "transpose", "lfo1_sync", "chorus_sync", "delay_sync"]) },
    { label: "Lower Part", keys: pre("lo_", ["midi_ch", "transpose", "lfo1_sync", "chorus_sync", "delay_sync"]) },
    { label: "Ext Trigger", keys: ["trigger_switch", "trigger_dest", "trigger_ch", "trigger_note"] }
  ]
});

push.compartment({
  id: "system", label: "System",
  pages: [
    { label: "MIDI", keys: ["sys_remote_ch", "sys_perf_ctrl_ch", "sys_midi_sync", "sys_txrx_pc", "sys_txrx_edit", "sys_txrx_edit_mode"] },
    { label: "Tuning, Ribbon", keys: ["sys_master_tune", "sys_gate_ratio", "sys_ribbon_rel", "sys_ribbon_hold", "buffer_ms"] }
  ]
});
