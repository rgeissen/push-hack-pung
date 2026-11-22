// Osirus (the Access Virus A, B and C, emulated) on Push: its compartments.
// An overlay shipped with Pung (Osirus itself ships no push_ui.js).
//
// The compartments are the seven sections of Osirus's own web page, in its
// order, and their pages are that page's cards: the Push and the browser
// show the same structure. The classic Virus is not the TI (OsTIrus): a
// red-brown panel with its sections framed in printed lines, a two-line
// character display, and every value shown on that display as the knob
// turns, with a bar. Its screens:
//
//   VIRUS        (front panel) the display (bank, number, name, how it
//                plays, which effects are on), both oscillators' waves, both
//                filters' responses on one axis and the amp envelope, live;
//                the encoder row as the display's readouts
//   OSCILLATORS  each oscillator's wave (the Shape knob morphs the selected
//                wave through saw to pulse), its pitch; the mixer's levels
//   FILTERS      the filter routing (Serial 4, Serial 6, Parallel 4, Split)
//                as a signal path, the saturation stage, both responses live
//   ENVELOPES    amp and filter together, the sustain SLOPE in words; what
//                velocity moves
//   LFOS         each LFO (live) and what it modulates, by how much
//
// The others use Pung's default view. The native layer still owns every
// encoder and draws each key's name and value under a band screen.

var TAU = Math.PI * 2;
// a value not read yet draws as its neutral position, never as 0
function frac(v, k, neutral) { return v[k] && v[k].known ? v[k].frac : (neutral || 0); }
function disp(v, k) { return v[k] && v[k].known ? String(v[k].display || v[k].value || "") : ""; }
// a text the module answers (a name, a model): its display, else the raw value
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function vnum(v, k, d) { var n = v[k] && v[k].known ? parseFloat(v[k].value) : NaN; return isNaN(n) ? d : n; }
function von(v, k) { var d = disp(v, k); return v[k] && v[k].known && d !== "Off" && d !== "0" && d !== "" && v[k].frac > 0; }
// a knob whose middle (64) is nothing: its value as -64..+63
function signed(v, k) { var n = vnum(v, k, NaN); return isNaN(n) ? "--" : (n > 64 ? "+" : "") + (n - 64); }
function frame(g, x, y, w, h, c, wd) {
  wd = wd || 1;
  g.line(x, y, x + w, y, wd, c); g.line(x, y + h, x + w, y + h, wd, c);
  g.line(x, y, x, y + h, wd, c); g.line(x + w, y, x + w, y + h, wd, c);
}
function head(g, x, s, lit, align) { g.text(x, 12, String(s).toUpperCase(), lit ? "fg" : "dim", align || -1); }

// The classic Virus's colours: the panel, its printed lines, the display
var CV = { panel: "#3a0c11", deep: "#250709", line: "#b9787d", ink: "#f6e3e4", dim: "#c79a9e", red: "#ff4b55",
  lcd: "#0d170b", lcdEdge: "#2a3a1c", lcdInk: "#c8f25a", lcdDim: "#6f8a3a", lcdOff: "#2c3a1c", f2: "#7fd0ff" };

// ---- waves -----------------------------------------------------------------------
var cache = {}, cached_n = 0;
function cached(key, make) {
  var c = cache[key];
  if (c) return c;
  if (cached_n > 96) { cache = {}; cached_n = 0; }
  cached_n++;
  return (cache[key] = make());
}
// the selected wave: sine, triangle, or one of the spectral waves
function baseWave(sel, p) {
  var s = Math.sin(TAU * p);
  if (sel === "Sine" || sel === "") return s;
  if (sel === "Triangle") { var q = p - Math.floor(p); return 1 - 4 * Math.abs(q - 0.5); }
  var n = parseInt(sel.replace(/\D/g, ""), 10) || 3, h = 2 + (n % 6);
  return s * 0.7 + Math.sin(TAU * p * h) * 0.3 * ((n % 3) / 2 + 0.4);
}
// the Virus's Shape knob: the selected wave (0) through saw (64) to pulse (127)
function oscSample(sel, shape, pw, p) {
  var ph = p - Math.floor(p), saw = 1 - 2 * ph, pulse = ph < Math.max(0.05, pw) ? 1 : -1;
  return shape < 0.5 ? baseWave(sel, p) + (saw - baseWave(sel, p)) * shape * 2 : saw + (pulse - saw) * (shape - 0.5) * 2;
}
function oscPts(v, o, x, y, w, h, cycles) {
  var sel = disp(v, "osc" + o + "_wave_select"), shape = frac(v, "osc" + o + "_shape", 0.5);
  // the Virus's pulse width: 0 a square, 127 the narrowest pulse
  var pw = 0.5 - 0.45 * frac(v, "osc" + o + "_pulsewidth", 0);
  return cached(["w", x, y, w, h, cycles, sel, shape.toFixed(2), pw.toFixed(2)].join("|"), function () {
    var pts = [], prev = null, a = h / 2 - 2, mid = y + h / 2, step = w > 150 ? 3 : 2;
    for (var px = 0; px <= w; px += step) {
      var yy = mid - Math.max(-1, Math.min(1, oscSample(sel, shape, pw, px / w * cycles))) * a;
      if (prev !== null && Math.abs(yy - prev) > a * 0.5) pts.push(x + px, prev);
      pts.push(x + px, yy);
      prev = yy;
    }
    return pts;
  });
}

// ---- the front panel: the classic Virus at a glance -----------------------------------
function box(g, x, y, w, h, title) { // a section, framed in the panel's printed line, its name in a gap
  frame(g, x, y, w, h, CV.line);
  if (!title) return;
  var tw = g.measure(title) + 8;
  g.fill(x + 6, y - 6, tw, 12, CV.panel);
  g.text(x + 10, y + 4, title, CV.ink, -1);
}
var BIPOLAR = { filter_balance: 1, osc_balance: 1, panorama: 1, osc2_filt_env_amt: 1, fm_filt_env_amt: 1, cutoff2_offset: 1,
  osc1_semitone: 1, osc2_semitone: 1, amp_sustain_time: 1, amp_velocity: 1 };
// The encoder row's cells: in segment mode the bottom 18 pixels are Pung's
// (the segments' names), so the cells end above y 142.
var ROW = { top: 107, h: 50, name: 120, val: 141, bar: 147, barH: 5 };
var ROW_SEG = { top: 105, h: 36, name: 116, val: 133, bar: 136, barH: 3 };
function panelGround(g, knobs, R) {
  g.fill(0, 0, 960, 160, CV.panel);
  g.value(10, 17, "OSIRUS", CV.ink, -1);
  // the display
  g.fill(8, 26, 296, 72, CV.lcdEdge);
  g.fill(10, 28, 292, 68, CV.lcd);
  box(g, 314, 30, 196, 68, "OSCILLATORS");
  box(g, 520, 30, 214, 68, "FILTERS");
  box(g, 744, 30, 208, 68, "AMPLIFIER");
  // the encoder row: the display's readout, a cell an encoder
  g.fill(0, 103, 960, 57, CV.deep);
  for (var c = 0; c < 8; c++) {
    if (!knobs[c]) continue;
    g.fill(c * 120 + 5, R.top, 110, R.h, CV.lcdEdge);
    g.fill(c * 120 + 6, R.top + 1, 108, R.h - 2, CV.lcd);
  }
}
// The encoder row as the classic Virus shows a turned knob: on its display,
// the name and the value, and the bar it draws under them (from the middle
// for a knob whose middle is nothing). The touched one in the slot's colour.
function lcdRow(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "", R = v.$segmode ? ROW_SEG : ROW;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, known = v[k].known, f = known ? v[k].frac : 0;
    if (hot) frame(g, x0 + 5, R.top, 110, R.h, "slot", 2);
    g.text(x0 + 12, R.name, String(v[k].name).toUpperCase(), hot ? "slot" : CV.lcdDim, -1, 96);
    var val = known ? (BIPOLAR[k] && v[k].type !== "enum" ? signed(v, k) : String(v[k].display || v[k].value)) : "--";
    g.value(x0 + 12, R.val, val, hot ? "slot" : CV.lcdInk, -1, 96);
    // the bar: 16 blocks
    var n = 16, bw = 5, gap = 1, bx = x0 + 12, lit = Math.round(f * n), on = hot ? "slot" : CV.lcdInk;
    for (var b = 0; b < n; b++) {
      var l = BIPOLAR[k] ? (f >= 0.5 ? b >= n / 2 && b < Math.max(n / 2 + 1, lit) : b < n / 2 && b >= lit) : b < lit;
      g.fill(bx + b * (bw + gap), R.bar, bw, R.barH, known && l ? on : CV.lcdOff);
    }
  }
}
function virusPanel(g, v) {
  var t = v.$touched || "", knobs = v.$knobs || [];
  var R = v.$segmode ? ROW_SEG : ROW;
  g.layer("osirus|" + knobs.join(",") + "|" + (v.$segmode ? 1 : 0), function () { panelGround(g, knobs, R); });
  segmentLit(g, v);
  g.text(10 + g.measure("OSIRUS", "value") + 10, 16, "ROM " + txt(v, "rom_model").toUpperCase(), CV.dim, -1);
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 16, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, CV.ink, 1);
  // the display: bank and number, how it plays; the name; the effects that are on
  var n = vnum(v, "preset", 0) + 1, uni = disp(v, "unison_mode");
  g.text(18, 43, (txt(v, "bank_name") || "BANK").toUpperCase() + "  " + ("00" + n).slice(-3), CV.lcdDim, -1);
  g.text(294, 43, (uni && uni !== "Off" ? "UNISON " + uni : disp(v, "key_mode")).toUpperCase(), CV.lcdDim, 1);
  g.value(18, 70, (txt(v, "preset_name") || "--").replace(/\s+$/, ""), CV.lcdInk, -1, 276);
  var dr = vnum(v, "delay_reverb_mode", 0), fx = [
    ["DELAY", dr > 0 && von(v, "effect_send")], ["CHORUS", von(v, "chorus_mix")], ["PHASER", von(v, "phaser_mix")],
    ["DIST", von(v, "distortion_curve")], ["ARP", von(v, "arp_mode")]];
  for (var i = 0, x = 18; i < fx.length; i++) {
    g.text(x, 90, fx[i][0], fx[i][1] ? CV.lcdInk : CV.lcdOff, -1);
    x += g.measure(fx[i][0]) + 12;
  }
  // the oscillators: their waves, the balance between them
  var bal = frac(v, "osc_balance", 0.5);
  for (var o = 1; o <= 2; o++) {
    var oy = 40 + (o - 1) * 28, hot = t.indexOf("osc" + o + "_") === 0, heard = o === 1 ? bal < 0.97 : bal > 0.03;
    g.text(324, oy + 15, String(o), hot ? "slot" : CV.dim, -1);
    g.poly(oscPts(v, o, 336, oy, 116, 22, 2), 2, hot ? "slot" : (heard ? CV.ink : CV.dim));
    var tag = o === 2 ? (von(v, "osc2_sync") ? "SYNC" : von(v, "osc2_fm_amount") ? "FM" : "") : "";
    g.text(502, oy + 15, tag, CV.dim, 1);
  }
  // the filters: both responses on one axis, live, and how they are wired
  g.text(726, 44, (disp(v, "filter_routing") || "").toUpperCase(), CV.dim, 1);
  var c2 = Math.max(0, Math.min(1, frac(v, "cutoff", 0.5) + frac(v, "cutoff2_offset", 0.5) - 0.5));
  g.filter(524, 46, 206, 50, { cutoff: c2, resonance: "filter2_resonance", type: "filter2_mode", color: CV.f2 });
  g.filter(524, 46, 206, 50, { cutoff: "cutoff", resonance: "filter1_resonance", type: "filter1_mode", color: CV.ink });
  // the amplifier: attack, decay, sustain and its slope, release
  g.envelope(748, 38, 200, 58, { attack: "amp_attack", decay: "amp_decay", sustain: "amp_sustain", slope: "amp_sustain_time", release: "amp_release", color: CV.ink });
  lcdRow(g, v);
}

// The panel's sections, each one press away (segment mode): the display (how
// the patch plays), the oscillators, the filters, the amplifier.
var SEGMENTS = [
  { id: "patch", label: "Patch", rect: [8, 26, 296, 72], keys: ["patch_volume", "panorama", "key_mode", "unison_mode", "unison_detune", "portamento_time", "effect_send", "chorus_mix"] },
  { id: "osc", label: "Oscillators", rect: [314, 24, 196, 74], keys: ["osc1_wave_select", "osc1_shape", "osc1_pulsewidth", "osc2_wave_select", "osc2_shape", "osc2_semitone", "osc2_detune", "osc_balance"] },
  { id: "filter", label: "Filters", rect: [520, 24, 214, 74], keys: ["cutoff", "filter1_resonance", "filter1_env_amt", "filter1_mode", "cutoff2_offset", "filter2_resonance", "filter_routing", "filter_balance"] },
  { id: "amp", label: "Amplifier", rect: [744, 24, 208, 74], keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_sustain_time", "amp_release", "amp_velocity"] }
];
// the segment the encoders play (Pung's bar over it): its printed name lit in
// the slot's colour. (A rect's top is its box's name: the bar stays off it.)
function segmentLit(g, v) {
  if (v.$segmode !== "segment" || !v.$segment) return;
  for (var i = 0; i < SEGMENTS.length; i++) {
    var s = SEGMENTS[i], r = s.rect;
    if (s.id !== v.$segment || s.id === "patch") continue;
    g.text(r[0] + 10, 34, s.label.toUpperCase(), "slot", -1);
  }
}
// Pung's default pages in the Virus's colours: its deep red, its printed ink, its knobs
push.theme({ ground: CV.deep, panel: CV.panel, ink: CV.ink, dim: CV.dim, accent: CV.red, knob: "pointer" });
push.compartment({
  id: "panel", label: "Osirus", front_panel: true, segments: SEGMENTS, draws_segments: true,
  pages: [
    { label: "Panel", keys: ["cutoff", "filter1_resonance", "filter1_env_amt", "filter_balance", "amp_attack", "amp_decay", "amp_sustain", "amp_release"] },
    { label: "Sound", keys: ["osc1_shape", "osc2_shape", "osc_balance", "osc2_detune", "unison_detune", "effect_send", "chorus_mix", "patch_volume"] }
  ],
  extra_keys: ["preset", "preset_name", "bank_name", "rom_model", "unison_mode", "key_mode", "filter_routing", "filter1_mode", "filter2_mode",
    "filter2_resonance", "cutoff2_offset", "osc1_pulsewidth", "osc2_pulsewidth", "osc2_sync", "osc2_fm_amount", "amp_sustain_time",
    "delay_reverb_mode", "phaser_mix", "distortion_curve", "arp_mode", "osc1_wave_select", "osc2_wave_select", "osc_balance",
    "osc1_shape", "osc2_shape", "effect_send", "chorus_mix"],
  screen: virusPanel
});

// ---- oscillators -----------------------------------------------------------------
// An oscillator's page: its wave as the Shape knob makes it from the selected
// wave, and the three stops the knob passes (wave, saw, pulse); its pitch.
function oscScreen(o) {
  return function (g, v) {
    var t = v.$touched || "", p = "osc" + o + "_", sel = disp(v, p + "wave_select") || "Sine", shape = frac(v, p + "shape", 0.5);
    var hot = t === p + "shape" || t === p + "wave_select" || t === p + "pulsewidth";
    head(g, 6, "OSCILLATOR " + o, t.indexOf(p) === 0);
    g.text(466, 12, o === 2 && von(v, "osc2_sync") ? "SYNCED TO OSC 1" : "", "dim", 1);
    g.fill(2, 47, 468, 1, "line");
    g.poly(oscPts(v, o, 4, 18, 464, 62, 2), 2, hot ? "slot" : "fg");
    g.line(484, 6, 484, 82, 1, "line");
    // the Shape knob's way: the selected wave, saw, pulse
    var x0 = 500, w = 240, stops = [sel.toUpperCase(), "SAW", "PULSE"];
    head(g, x0, "SHAPE", t === p + "shape");
    g.fill(x0, 34, w, 2, "line");
    for (var i = 0; i < 3; i++) {
      var sx = x0 + w * i / 2;
      g.fill(sx - 1, 30, 2, 10, "dim");
      g.text(sx, 54, stops[i], t === p + "wave_select" && i === 0 ? "slot" : "dim", i === 0 ? -1 : i === 2 ? 1 : 0);
    }
    g.dot(x0 + w * shape, 35, t === p + "shape" ? 5 : 4, t === p + "shape" ? "slot" : "fg");
    var pwOn = shape > 0.5;
    g.text(x0, 78, "PULSE WIDTH " + (disp(v, p + "pulsewidth") || "--"), t === p + "pulsewidth" ? "slot" : (pwOn ? "dim" : "faint"), -1);
    // its pitch
    var rows = [["SEMITONE", signed(v, p + "semitone"), p + "semitone"]];
    if (o === 2) rows.push(["DETUNE", disp(v, "osc2_detune") || "--", "osc2_detune"]);
    rows.push(["KEY FOLLOW", disp(v, p + "keyfollow") || "--", p + "keyfollow"]);
    if (o === 2) rows.push(["FM " + (disp(v, "osc_fm_mode") || "").toUpperCase(), disp(v, "osc2_fm_amount") || "--", "osc2_fm_amount"]);
    for (var r = 0; r < rows.length; r++) {
      var lit = t === rows[r][2], y = 30 + r * 16;
      g.text(780, y, rows[r][0], lit ? "fg" : "dim", -1, 110);
      g.text(944, y, rows[r][1], lit ? "slot" : "fg", 1);
    }
  };
}
// the mixer: the balance between the two oscillators, and every level
function mixerScreen(g, v) {
  var t = v.$touched || "", b = frac(v, "osc_balance", 0.5);
  head(g, 6, "OSC BALANCE", t === "osc_balance");
  g.text(300, 12, signed(v, "osc_balance"), t === "osc_balance" ? "slot" : "fg", 1);
  g.poly(oscPts(v, 1, 4, 20, 144, 40, 2), 1.5, b < 0.97 ? "fg" : "faint");
  g.poly(oscPts(v, 2, 156, 20, 144, 40, 2), 1.5, b > 0.03 ? "fg" : "faint");
  g.text(6, 82, "OSC 1", b < 0.5 ? "fg" : "dim", -1); g.text(300, 82, "OSC 2", b > 0.5 ? "fg" : "dim", 1);
  g.fill(56, 77, 194, 2, "line");
  g.fill(56 + Math.round(188 * b), 71, 6, 14, t === "osc_balance" ? "slot" : "fg");
  g.line(316, 6, 316, 82, 1, "line");
  // the levels into the filters (Pung's mixer)
  var keys = ["osc_mainvolume", "sub_osc_volume", "noise_volume", "ringmod_volume"], names = ["OSCS", "SUB " + (disp(v, "sub_osc_shape") || "").toUpperCase(), "NOISE", "RING"];
  g.mix(330, 0, 400, 74, keys);
  for (var i = 0; i < 4; i++) g.text(330 + 50 + i * 100, 84, names[i], t === keys[i] ? "slot" : "dim", 0, 96);
  g.line(744, 6, 744, 82, 1, "line");
  var nc = frac(v, "noise_color", 0.5);
  g.text(760, 30, "NOISE COLOUR", t === "noise_color" ? "fg" : "dim", -1);
  g.text(944, 30, nc < 0.45 ? "DARK" : nc > 0.55 ? "BRIGHT" : "WHITE", t === "noise_color" ? "slot" : "fg", 1);
  g.text(760, 48, "INIT PHASE", t === "osc_init_phase" ? "fg" : "dim", -1);
  g.text(944, 48, frac(v, "osc_init_phase", 0) > 0 ? disp(v, "osc_init_phase") : "FREE", t === "osc_init_phase" ? "slot" : "fg", 1);
}
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Oscillator 1", keys: ["osc1_wave_select", "osc1_shape", "osc1_pulsewidth", "osc1_semitone", "osc1_keyfollow"], screen: oscScreen(1) },
    { label: "Oscillator 2", keys: ["osc2_wave_select", "osc2_shape", "osc2_pulsewidth", "osc2_semitone", "osc2_detune", "osc2_sync", "osc_fm_mode", "osc2_fm_amount"], screen: oscScreen(2) },
    { label: "Osc 2 Mod", keys: ["osc2_filt_env_amt", "fm_filt_env_amt", "osc2_keyfollow"] },
    { label: "Oscillator 3", keys: ["osc3_mode", "osc3_volume", "osc3_semitone", "osc3_detune"] },
    { label: "Mixer", keys: ["osc_balance", "osc_mainvolume", "sub_osc_volume", "sub_osc_shape", "noise_volume", "noise_color", "ringmod_volume", "osc_init_phase"], screen: mixerScreen },
    { label: "Punch", keys: ["punch_intensity"] }
  ],
  extra_keys: ["osc1_wave_select", "osc1_shape", "osc1_pulsewidth", "osc2_wave_select", "osc2_shape", "osc2_pulsewidth", "osc2_sync", "osc2_keyfollow"]
});

// ---- filters ---------------------------------------------------------------------
// a filter block: frame, name, mode; the panel edits the one underlined
function filterBox(g, x, y, w, h, name, mode, hot, edited, col) {
  g.fill(x, y, w, h, "black");
  frame(g, x, y, w, h, hot ? "slot" : "line", hot ? 2 : 1);
  if (edited) g.fill(x + 2, y + h - 3, w - 4, 2, hot ? "slot" : col);
  g.text(x + 6, y + 13, name, col, -1);
  g.text(x + w - 6, y + h - 8, mode.toUpperCase(), "fg", 1, w - 12);
}
// the saturation stage: its transfer curve (what comes in across, what goes out up)
function satBox(g, x, y, w, h, curveName, hot) {
  g.fill(x, y, w, h, "black");
  frame(g, x, y, w, h, hot ? "slot" : "line", hot ? 2 : 1);
  var cx = x + w / 2, cy = y + h / 2 + 4, a = Math.min(w, h) / 2 - 8;
  var pts = cached(["sat", x, y, w, h, curveName].join("|"), function () {
    var out = [], k = { "Light": 1.5, "Soft": 2.5, "Middle": 4, "Hard": 8 }[curveName] || 0;
    for (var i = -20; i <= 20; i++) {
      var u = i / 20, o = u;
      if (k) o = Math.tanh(u * k) / Math.tanh(k);
      else if (curveName === "Digital") o = Math.max(-0.6, Math.min(0.6, u * 1.5)) / 0.6;
      else if (curveName === "Shaper") o = Math.sin(u * 2.4) / Math.sin(2.4);
      else if (curveName === "Rectifier") o = Math.abs(u) * 2 - 1;
      else if (curveName.indexOf("Bit") === 0) o = Math.round(u * 3) / 3;
      else if (curveName.indexOf("Rate") === 0) o = Math.round(u * 5) / 5;
      out.push(cx + u * a, cy - o * a * 0.8);
    }
    return out;
  });
  g.poly(pts, 1.5, hot ? "slot" : (curveName && curveName !== "Off" ? "fg" : "faint"));
  g.text(cx, y + 12, (curveName || "OFF").toUpperCase(), "dim", 0, w - 6);
}
function arrow(g, x0, y0, x1, y1) {
  g.line(x0, y0, x1, y1, 1, "dim");
  g.line(x1, y1, x1 - 5, y1 - 3, 1, "dim");
  g.line(x1, y1, x1 - 5, y1 + 3, 1, "dim");
}
push.compartment({
  id: "filter", label: "Filters",
  pages: [
    { label: "Filter 1", keys: ["cutoff", "filter1_resonance", "filter1_env_amt", "filter1_keyfollow", "filter1_mode", "filter1_env_polarity"] },
    { label: "Filter 2", keys: ["cutoff2_offset", "filter2_resonance", "filter2_env_amt", "filter2_keyfollow", "filter2_mode", "filter2_env_polarity", "filter2_cutoff_link"] },
    { label: "Routing", keys: ["filter_routing", "filter_select", "filter_balance", "saturation_curve", "filter_keytrack_base"] }
  ],
  screen: function (g, v) {
    var t = v.$touched || "";
    var hot1 = t === "cutoff" || t.indexOf("filter1_") === 0;
    var hot2 = t === "cutoff2_offset" || t.indexOf("filter2_") === 0;
    var hotS = t === "saturation_curve";
    var routing = disp(v, "filter_routing") || "Serial 4";
    var sel = disp(v, "filter_select");
    var m1 = disp(v, "filter1_mode") || "LowPass", m2 = disp(v, "filter2_mode") || "LowPass";
    var ed1 = sel !== "Filter 2", ed2 = sel !== "Filter 1";
    head(g, 6, routing, t === "filter_routing");
    g.text(470, 12, "PANEL EDITS " + (sel || "--").toUpperCase(), t === "filter_select" ? "slot" : "dim", 1);

    // the signal path, left
    var bw = 120, bh = 46, sw = 76, mid = 50;
    g.text(4, mid + 4, "IN", "dim", -1);
    if (routing.indexOf("Serial") === 0) {
      var x1 = 34, xs = x1 + bw + 20, x2 = xs + sw + 20;
      arrow(g, 20, mid, x1, mid);
      filterBox(g, x1, mid - bh / 2, bw, bh, "FILTER 1", m1, hot1, ed1, "fg");
      arrow(g, x1 + bw, mid, xs, mid);
      satBox(g, xs, mid - bh / 2, sw, bh, disp(v, "saturation_curve"), hotS);
      arrow(g, xs + sw, mid, x2, mid);
      filterBox(g, x2, mid - bh / 2, bw, bh, "FILTER 2", m2, hot2, ed2, "mod");
      arrow(g, x2 + bw, mid, x2 + bw + 14, mid);
      g.text(x2 + bw + 16, mid + 4, "OUT", "dim", -1);
    } else {
      // parallel and split: the two filters side by side in time, stacked
      var x = 46, ya = 20, yb = 54, h = 30, xs2 = x + bw + 18;
      g.line(20, mid, 32, mid, 1, "dim"); g.line(32, ya + h / 2, 32, yb + h / 2, 1, "dim");
      arrow(g, 32, ya + h / 2, x, ya + h / 2); arrow(g, 32, yb + h / 2, x, yb + h / 2);
      filterBox(g, x, ya, bw, h, "FILTER 1", m1, hot1, ed1, "fg");
      filterBox(g, x, yb, bw, h, "FILTER 2", m2, hot2, ed2, "mod");
      arrow(g, x + bw, ya + h / 2, xs2, ya + h / 2);
      satBox(g, xs2, ya, sw, h, disp(v, "saturation_curve"), hotS);
      // the balance between them
      var bal = frac(v, "filter_balance", 0.5), bx = xs2 + sw + 14;
      if (routing === "Split") { // stereo: filter 1 left, filter 2 right
        arrow(g, xs2 + sw, ya + h / 2, xs2 + sw + 40, ya + h / 2); g.text(xs2 + sw + 44, ya + h / 2 + 4, "LEFT", "fg", -1);
        arrow(g, x + bw, yb + h / 2, xs2 + sw + 40, yb + h / 2); g.text(xs2 + sw + 44, yb + h / 2 + 4, "RIGHT", "fg", -1);
      } else {
        g.line(xs2 + sw, ya + h / 2, bx, ya + h / 2, 1, "dim");
        g.line(x + bw, yb + h / 2, bx, yb + h / 2, 1, "dim");
        g.fill(bx - 2, ya + h / 2, 4, yb - ya, "line");
        g.fill(bx - 4, ya + h / 2 + Math.round((yb - ya - 6) * bal), 8, 6, t === "filter_balance" ? "slot" : "fg");
        arrow(g, bx + 4, mid, bx + 30, mid); g.text(bx + 34, mid + 4, "OUT", "dim", -1);
      }
    }
    if (routing.indexOf("6") > 0) g.text(4, 84, "6 POLES IN ALL", "faint", -1);
    if (disp(v, "filter2_cutoff_link") === "On") g.text(470, 84, "CUTOFF 2 FOLLOWS CUTOFF 1", "faint", 1);

    // both responses on one axis, live: filter 1 white, filter 2 blue
    g.line(484, 6, 484, 82, 1, "line");
    var fc2 = Math.max(0, Math.min(1, frac(v, "cutoff") + (frac(v, "cutoff2_offset", 0.5) - 0.5)));
    head(g, 496, "FILTER 1", hot1);
    g.text(496 + g.measure("FILTER 1") + 12, 12, "FILTER 2", hot2 ? "fg" : "mod", -1);
    g.filter(490, 16, 458, 70, { cutoff: fc2, resonance: "filter2_resonance", type: m2, color: "mod" });
    g.filter(490, 16, 458, 70, { cutoff: "cutoff", resonance: "filter1_resonance", type: "filter1_mode" });
  }
});

// ---- envelopes: attack, decay, sustain level, sustain SLOPE, release ---------------
// Pung's own envelope (g.envelope), the one its default view and the web page
// draw, so the three agree. What this screen adds is the Virus's: both
// envelopes at once, and the sustain slope said in words.
function virusEnv(g, x0, x1, v, p, name, mine, t) {
  g.envelope(x0, 16, x1 - x0, 70, {
    attack: p + "_attack", decay: p + "_decay", sustain: p + "_sustain",
    slope: p + "_sustain_time", release: p + "_release", labels: true, color: mine ? undefined : "dim"
  });
  var slope = frac(v, p + "_sustain_time", 0.5) - 0.5;
  var word = slope < -0.03 ? "SUSTAIN FALLS WHILE HELD" : slope > 0.03 ? "SUSTAIN RISES WHILE HELD" : "SUSTAIN HOLDS";
  g.text(x0 + 6, 12, name, mine || t.indexOf(p + "_") === 0 ? "fg" : "dim", -1);
  g.text(x1 - 6, 12, word, mine ? "dim" : "faint", 1);
}
function envScreen(first) {
  return function (g, v) {
    var t = v.$touched || "", half = g.w / 2;
    virusEnv(g, 0, half - 8, v, "amp", "AMPLIFIER", first === "amp", t);
    g.line(half, 6, half, 82, 1, "line");
    virusEnv(g, half + 8, g.w, v, "flt", "FILTER", first === "flt", t);
  };
}
// velocity: what playing harder moves, and which way (from the middle, 64)
var VEL = [["osc1_shape_velocity", "OSC 1 SHAPE"], ["osc2_shape_velocity", "OSC 2 SHAPE"], ["pulsewidth_velocity", "PULSE WIDTH"],
  ["fm_amount_velocity", "FM AMOUNT"], ["flt1_envamt_velocity", "FILTER 1 ENV"], ["flt2_envamt_velocity", "FILTER 2 ENV"],
  ["resonance1_velocity", "RESONANCE 1"], ["resonance2_velocity", "RESONANCE 2"], ["amp_velocity", "AMPLIFIER"], ["panorama_velocity", "PANORAMA"]];
function velocityScreen(g, v) {
  var t = v.$touched || "", n = 0;
  for (var q = 0; q < VEL.length; q++) if (Math.abs(frac(v, VEL[q][0], 0.5) - 0.5) > 0.004) n++;
  head(g, 6, "VELOCITY", false);
  g.value(6, 44, n ? n + (n > 1 ? " TARGETS" : " TARGET") : "NONE", n ? "fg" : "faint", -1, 150);
  g.text(6, 64, "PLAYING HARDER", "dim", -1);
  g.text(6, 78, "MOVES EACH ONE", "dim", -1);
  g.line(164, 6, 164, 82, 1, "line");
  for (var r = 0; r < VEL.length; r++) {
    var k = VEL[r][0], x0 = 178 + Math.floor(r / 5) * 390, y = 16 + (r % 5) * 16, f = frac(v, k, 0.5), lit = t === k, act = Math.abs(f - 0.5) > 0.004;
    g.text(x0, y, VEL[r][1], lit ? "fg" : (act ? "dim" : "faint"), -1);
    var bx = x0 + 110, bw = 200, mid = bx + bw / 2, e = bx + bw * f;
    g.fill(bx, y - 4, bw, 1, "line"); g.fill(mid, y - 7, 1, 7, "faint");
    if (act || lit) g.fill(Math.min(mid, e), y - 6, Math.max(2, Math.abs(e - mid)), 5, lit ? "slot" : "fg");
    g.text(x0 + 360, y, signed(v, k), lit ? "slot" : (act ? "fg" : "faint"), 1);
  }
}
push.compartment({
  id: "env", label: "Envelopes",
  pages: [
    { label: "Amplifier", keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_sustain_time", "amp_release"], screen: envScreen("amp") },
    { label: "Filter Env", keys: ["flt_attack", "flt_decay", "flt_sustain", "flt_sustain_time", "flt_release"], screen: envScreen("flt") },
    { label: "Velocity", keys: ["osc1_shape_velocity", "osc2_shape_velocity", "pulsewidth_velocity", "fm_amount_velocity", "flt1_envamt_velocity", "flt2_envamt_velocity", "resonance1_velocity", "resonance2_velocity"], screen: velocityScreen },
    { label: "Velocity 2", keys: ["amp_velocity", "panorama_velocity"], screen: velocityScreen }
  ],
  extra_keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_sustain_time", "amp_release", "flt_attack", "flt_decay", "flt_sustain",
    "flt_sustain_time", "flt_release", "osc1_shape_velocity", "osc2_shape_velocity", "pulsewidth_velocity", "fm_amount_velocity",
    "flt1_envamt_velocity", "flt2_envamt_velocity", "resonance1_velocity", "resonance2_velocity", "amp_velocity", "panorama_velocity"]
});

// ---- LFOs: each one, live, and what it moves ---------------------------------------
// Pung's LFO picture (a playhead where its phase is known: on Live's beat when
// clocked, from the last note when key triggered); beside it the LFO's own
// destinations, each a bar from the middle (64 is none), and its assignable one.
var LFO_DEST = {
  1: [["osc1_lfo1_amount", "OSC 1 PITCH"], ["osc2_lfo1_amount", "OSC 2 PITCH"], ["pw_lfo1_amount", "PULSE WIDTH"], ["reso_lfo1_amount", "RESONANCE"], ["filtgain_lfo1_amount", "FILTER GAIN"]],
  2: [["shape_lfo2_amount", "OSC SHAPE"], ["fm_lfo2_amount", "FM AMOUNT"], ["cutoff1_lfo2_amount", "CUTOFF 1"], ["cutoff2_lfo2_amount", "CUTOFF 2"], ["pan_lfo2_amount", "PANORAMA"]]
};
function lfoScreen(n) {
  return function (g, v) {
    var t = v.$touched || "", p = "lfo" + n + "_", clk = disp(v, p + "clock"), clocked = clk && clk !== "Off";
    head(g, 6, "LFO " + n + "  " + (disp(v, p + "shape") || ""), t.indexOf(p) === 0);
    g.text(424, 12, (clocked ? clk : "RATE " + (disp(v, p + "rate") || "--")) + (disp(v, p + "mode") === "Mono" ? "  MONO" : ""), "dim", 1);
    g.lfo(0, 16, 430, 70, { shape: p + "shape", rate: clocked ? p + "clock" : p + "rate", trig: frac(v, p + "keytrigger", 0) > 0 });
    g.line(440, 6, 440, 82, 1, "line");
    head(g, 452, "MODULATES", false);
    if (n === 3) {
      var amt = frac(v, "osc_lfo3_amount", 0), lit = t === "osc_lfo3_amount" || t === "lfo3_destination";
      g.value(452, 42, disp(v, "lfo3_destination") || "--", t === "lfo3_destination" ? "slot" : (amt > 0 ? "fg" : "faint"), -1, 300);
      g.fill(452, 54, 380, 2, "line"); g.fill(452, 52, Math.round(380 * amt), 6, lit ? "slot" : (amt > 0 ? "fg" : "faint"));
      g.text(944, 58, disp(v, "osc_lfo3_amount") || "--", lit ? "slot" : "fg", 1);
      var fi = frac(v, "lfo3_fadein_time", 0);
      g.text(452, 80, fi > 0 ? "FADES IN OVER " + disp(v, "lfo3_fadein_time") : "NO FADE IN", t === "lfo3_fadein_time" ? "slot" : (fi > 0 ? "dim" : "faint"), -1);
      return;
    }
    var rows = LFO_DEST[n].concat([[p + "assign_amount", (disp(v, p + "assign_dest") || "ASSIGN").toUpperCase(), p + "assign_dest"]]);
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i][0], y = 25 + i * 12, f = frac(v, k, 0.5), lt = t === k || t === rows[i][2], act = Math.abs(f - 0.5) > 0.004;
      g.text(452, y, rows[i][1], lt ? "fg" : (act ? "dim" : "faint"), -1, 130);
      var bx = 592, bw = 280, mid = bx + bw / 2, e = bx + bw * f;
      g.fill(bx, y - 4, bw, 1, "line"); g.fill(mid, y - 7, 1, 7, "faint");
      if (act || lt) g.fill(Math.min(mid, e), y - 6, Math.max(2, Math.abs(e - mid)), 5, lt ? "slot" : "fg");
      g.text(944, y, signed(v, k), lt ? "slot" : (act ? "fg" : "faint"), 1);
    }
  };
}
var LFO_KEYS = ["lfo1_rate", "lfo1_clock", "lfo1_shape", "lfo1_mode", "lfo1_keytrigger", "lfo2_rate", "lfo2_clock", "lfo2_shape", "lfo2_mode", "lfo2_keytrigger",
  "lfo1_assign_dest", "lfo1_assign_amount", "lfo2_assign_dest", "lfo2_assign_amount"];
LFO_DEST[1].concat(LFO_DEST[2]).forEach(function (r) { LFO_KEYS.push(r[0]); });
push.compartment({
  id: "lfo", label: "LFOs",
  pages: [
    { label: "LFO 1", keys: ["lfo1_rate", "lfo1_clock", "lfo1_shape", "lfo1_mode", "lfo1_env_mode", "lfo1_symmetry", "lfo1_keyfollow", "lfo1_keytrigger"], screen: lfoScreen(1) },
    { label: "LFO 1 Dest", keys: ["osc1_lfo1_amount", "osc2_lfo1_amount", "pw_lfo1_amount", "reso_lfo1_amount", "filtgain_lfo1_amount", "lfo1_assign_dest", "lfo1_assign_amount"], screen: lfoScreen(1) },
    { label: "LFO 2", keys: ["lfo2_rate", "lfo2_clock", "lfo2_shape", "lfo2_mode", "lfo2_env_mode", "lfo2_symmetry", "lfo2_keyfollow", "lfo2_keytrigger"], screen: lfoScreen(2) },
    { label: "LFO 2 Dest", keys: ["shape_lfo2_amount", "fm_lfo2_amount", "cutoff1_lfo2_amount", "cutoff2_lfo2_amount", "pan_lfo2_amount", "lfo2_assign_dest", "lfo2_assign_amount"], screen: lfoScreen(2) },
    { label: "LFO 3", keys: ["lfo3_rate", "lfo3_clock", "lfo3_shape", "lfo3_mode", "lfo3_keyfollow", "lfo3_fadein_time", "lfo3_destination", "osc_lfo3_amount"], screen: lfoScreen(3) }
  ],
  extra_keys: LFO_KEYS
});

push.compartment({
  id: "fx", label: "Effects",
  pages: [
    { label: "Chorus", keys: ["chorus_mix", "chorus_rate", "chorus_depth", "chorus_delay", "chorus_feedback", "chorus_lfo_shape"] },
    { label: "Delay / Reverb", keys: ["delay_reverb_mode", "effect_send", "delay_time", "delay_rate_rev_decay", "delay_feedback", "delay_depth", "delay_color", "delay_lfo_shape"] },
    { label: "Phaser", keys: ["phaser_mode", "phaser_mix", "phaser_rate", "phaser_depth", "phaser_frequency", "phaser_feedback", "phaser_spread"] },
    { label: "EQ", keys: ["low_eq_gain", "low_eq_freq", "mid_eq_gain", "mid_eq_freq", "mid_eq_q", "high_eq_gain", "high_eq_freq"] },
    { label: "Distortion", keys: ["distortion_curve", "distortion_intensity", "input_ringmod", "bass_intensity", "bass_tune", "delay_clock"] }
  ]
});

push.compartment({
  id: "voice", label: "Arp / Voice",
  pages: [
    { label: "Arpeggiator", keys: ["arp_mode", "arp_pattern", "arp_octave_range", "arp_hold", "arp_note_length", "arp_swing", "arp_clock", "clock_tempo"] },
    { label: "Unison", keys: ["unison_mode", "unison_detune", "unison_pan_spread", "unison_lfo_phase", "input_mode", "input_follower_mode", "vocoder_mode"] },
    { label: "Voice", keys: ["patch_volume", "panorama", "key_mode", "transpose", "portamento_time", "bender_range_up", "bender_range_down"] }
  ]
});
