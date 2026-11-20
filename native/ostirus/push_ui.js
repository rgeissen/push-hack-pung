// OsTIrus (the Access Virus TI, emulated) on Push.
//
// The Virus is played from three knobs its sound designer named: the Soft
// Knobs. Every patch points them at what matters in it and calls them so
// ("Tone", "Phaser", "Fear"). So the device opens on a front panel whose
// first three encoders are those knobs, under the patch's own names, beside
// the five every Virus player reaches for: cutoff, resonance, envelope, and
// the two sends. Above them, the display and what the patch is made of:
// which oscillator models, which filters and how they are wired, which
// effects are on.
//
// The other pages follow the synth's sections, eight knobs a page, the same
// knob doing the same job on sibling pages (Attack is always knob 1 of an
// envelope, Rate knob 1 of an LFO). Each has the picture of what its knobs
// do together. docs/NATIVE-MODULES.md, OsTIrus.
//
// The native layer owns every encoder and draws each key's name and value.

function known(v, k) { return v[k] && v[k].known; }
function frac(v, k, neutral) { return known(v, k) ? v[k].frac : (neutral || 0); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? (d || 0) : n; }
function on(v, k) { var s = disp(v, k).toLowerCase(); return s !== "" && s !== "off" && s !== "0" && s !== "-"; }

var RED = "#e1192f", RED_DK = "#5a0b14", BG = "#0b0d12", PANEL = "#161a22", RULE = "#2a303b";
var INK = "#e9edf3", DIM = "#8a93a2", FAINT = "#4b5260", LCD = "#0f1d27", LCD_INK = "#bfe7ff", LCD_DIM = "#5f8aa3";
var LED_ON = "#ff3347", LED_OFF = "#3a1218";

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
    if (prev !== null && Math.abs(yy - prev) > a * 0.45) pts.push(x + px, prev);
    pts.push(x + px, yy);
    prev = yy;
  }
  return pts;
}
function frame(g, x, y, w, h, c) {
  g.line(x, y, x + w, y, 1, c); g.line(x, y + h, x + w, y + h, 1, c);
  g.line(x, y, x, y + h, 1, c); g.line(x + w, y, x + w, y + h, 1, c);
}
function led(g, x, y, lit) { g.dot(x, y, 2.6, lit ? LED_ON : LED_OFF); }
function edge(g) { g.fill(0, 0, 3, g.h, RED); } // every page carries the Virus's red at its left edge
function title(g, x, y, s, lit) { g.text(x, y, s.toUpperCase(), lit ? INK : DIM, -1); }

// ---- waves -----------------------------------------------------------------------
function saw(p) { p -= Math.floor(p); return 1 - 2 * p; }
function pulse(p, pw) { p -= Math.floor(p); return p < pw ? 1 : -1; }
function spectral(p, n) { // a "spectral wave": a sine with the wave number's harmonics
  var s = Math.sin(p * 6.2832), h = 2 + (n % 7);
  return (s * 0.7 + Math.sin(p * 6.2832 * h) * 0.3 * ((n % 3) / 2 + 0.3));
}
// what an oscillator plays in its mode, from its shape (0 wave, .5 saw, 1 pulse)
function oscFn(mode, shape, wave, pw, density) {
  if (mode === "HyperSaw") {
    var n = 2 + Math.round(density * 7);
    return function (p) { var s = 0; for (var i = 0; i < n; i++) s += saw(p * (1 + (i - n / 2) * 0.012) + i * 0.137); return s / n * 1.4; };
  }
  if (mode === "Wavetable" || mode === "Wave PWM")
    return function (p) { return spectral(p, wave) * (1 - shape) + Math.sin(p * 6.2832 * (1 + Math.round(shape * 5))) * shape; };
  if (mode.indexOf("Grain") === 0 || mode.indexOf("Formant") === 0)
    return function (p) { var env = Math.sin(Math.PI * ((p * 2) % 1)); return Math.sin(p * 6.2832 * (3 + wave % 5)) * env; };
  // Classic: wave .. saw .. pulse
  if (shape < 0.5) { var t = shape * 2; return function (p) { return spectral(p, wave) * (1 - t) + saw(p) * t; }; }
  var u = (shape - 0.5) * 2;
  return function (p) { return saw(p) * (1 - u) + pulse(p, 0.5 - pw * 0.45) * u; };
}

// ---- the front panel ---------------------------------------------------------------
function lcd(g, v) {
  g.fill(10, 26, 372, 72, LCD);
  frame(g, 10, 26, 372, 72, "#24404f");
  var n = num(v, "preset", 0) + 1;
  g.text(20, 42, (disp(v, "bank_name") || "ROM") + "  " + ("00" + n).slice(-3), LCD_DIM, -1);
  g.text(372, 42, disp(v, "category").toUpperCase(), LCD_DIM, 1);
  g.value(20, 72, disp(v, "preset_name") || "--", LCD_INK, -1, 350);
  var s = [disp(v, "soft1_name"), disp(v, "soft2_name"), disp(v, "soft3_name")];
  for (var i = 0; i < 3; i++) {
    var x = 20 + i * 118;
    g.text(x, 91, (i + 1) + " " + (s[i] && s[i] !== "-" ? s[i] : "--").toUpperCase(), s[i] && s[i] !== "-" ? LCD_INK : LCD_DIM, -1, 110);
  }
}
function block(g, x, w, label) {
  g.fill(x, 26, w, 72, PANEL);
  g.fill(x, 26, w, 13, "#1f2430");
  g.text(x + 6, 36, label, DIM, -1);
}
function panel(g, v) {
  g.layer("ground", function () {
    g.fill(0, 0, 960, 160, BG);
    g.fill(0, 0, 960, 20, "#10131a");
    g.fill(0, 19, 960, 1, RED);
    g.text(10, 14, "VIRUS", RED, -1);
    g.fill(0, 102, 960, 58, "#0e1117");
    for (var c = 1; c < 8; c++) g.fill(c * 120, 108, 1, 46, RULE);
  });
  g.text(58, 14, (disp(v, "model") || "TI").toUpperCase(), INK, -1);
  g.text(950, 14, "OSTIRUS", FAINT, 1);
  lcd(g, v);
  // oscillators: the models, and whether the third is on
  block(g, 392, 170, "OSCILLATORS");
  g.text(400, 56, "1 " + (disp(v, "osc1_mode") || "--").toUpperCase(), INK, -1, 160);
  g.text(400, 72, "2 " + (disp(v, "osc2_mode") || "--").toUpperCase(), INK, -1, 160);
  var o3 = disp(v, "osc3_mode");
  g.text(400, 88, "3 " + (o3 || "--").toUpperCase(), on(v, "osc3_mode") ? INK : FAINT, -1, 160);
  // filters: the two modes and how they are wired, drawn
  block(g, 568, 190, "FILTERS");
  var r = disp(v, "filter_routing"), par = r.indexOf("Parallel") === 0 || r.indexOf("Split") === 0;
  g.text(576, 56, "1 " + (disp(v, "filter1_mode") || "--").toUpperCase(), INK, -1, 120);
  g.text(576, 72, "2 " + (disp(v, "filter2_mode") || "--").toUpperCase(), INK, -1, 120);
  g.text(576, 88, (r || "--").toUpperCase(), DIM, -1, 120);
  var bx = 708, by = 48;
  if (par) {
    g.fill(bx, by, 18, 10, RULE); g.fill(bx, by + 18, 18, 10, RULE);
    g.text(bx + 9, by + 8, "1", INK, 0); g.text(bx + 9, by + 26, "2", INK, 0);
    g.line(bx - 6, by + 14, bx, by + 5, 1, DIM); g.line(bx - 6, by + 14, bx, by + 23, 1, DIM);
    g.line(bx + 18, by + 5, bx + 26, by + 14, 1, DIM); g.line(bx + 18, by + 23, bx + 26, by + 14, 1, DIM);
  } else {
    g.fill(bx - 8, by + 9, 16, 10, RULE); g.fill(bx + 16, by + 9, 16, 10, RULE);
    g.text(bx, by + 17, "1", INK, 0); g.text(bx + 24, by + 17, "2", INK, 0);
    g.line(bx + 8, by + 14, bx + 16, by + 14, 1, DIM);
  }
  // effects: lit when on
  block(g, 764, 188, "EFFECTS");
  var fx = [["DELAY", on(v, "delay_send")], ["REVERB", on(v, "reverb_mode") && on(v, "reverb_send")], ["CHORUS", on(v, "chorus_type")],
    ["PHASER", on(v, "phaser_mix")], ["DIST", on(v, "distortion_curve")], ["ARP", on(v, "arp_mode")]];
  for (var i = 0; i < fx.length; i++) {
    var fx_x = 772 + (i % 2) * 92, fx_y = 54 + Math.floor(i / 2) * 16;
    led(g, fx_x + 3, fx_y - 4, fx[i][1]);
    g.text(fx_x + 11, fx_y, fx[i][0], fx[i][1] ? INK : FAINT, -1);
  }
  var uni = disp(v, "unison_mode");
  g.text(944, 36, uni && uni !== "Off" ? "UNISON " + uni.toUpperCase() : (disp(v, "key_mode") || "").toUpperCase(), DIM, 1);
  row(g, v);
}
// the encoder row: the Soft Knobs under the patch's names for them
function row(g, v) {
  var knobs = v.$knobs || [], t = v.$touched;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], cx = i * 120 + 60;
    if (!k || !v[k]) continue;
    var name = String(v[k].name);
    if (k === "soft1" || k === "soft2" || k === "soft3") {
      var sn = disp(v, k + "_name");
      name = sn && sn !== "-" ? sn : "SOFT " + k.charAt(4);
    }
    var hot = k === t, f = frac(v, k, 0);
    if (hot) g.fill(i * 120 + 4, 106, 112, 50, "#2a0e14");
    g.arc(cx - 34, 135, 9, Math.PI * 0.75, Math.PI * 1.5, 2, RULE);
    g.arc(cx - 34, 135, 9, Math.PI * 0.75, Math.PI * 1.5 * f, 2, hot ? LED_ON : RED);
    g.text(cx + 12, 122, name.toUpperCase(), hot ? INK : DIM, 0, 84);
    g.value(cx + 12, 147, disp(v, k) || "--", INK, 0, 84);
  }
}

push.compartment({
  id: "virus", label: "Virus", front_panel: true,
  pages: [{ label: "Virus", keys: ["soft1", "soft2", "soft3", "cutoff", "filter1_resonance", "filter1_env_amt", "delay_send", "reverb_send"] }],
  extra_keys: ["soft1_name", "soft2_name", "soft3_name", "preset", "preset_name", "bank_name", "category", "model",
    "osc1_mode", "osc2_mode", "osc3_mode", "filter1_mode", "filter2_mode", "filter_routing", "reverb_mode", "chorus_type",
    "phaser_mix", "distortion_curve", "arp_mode", "unison_mode", "key_mode"],
  screen: function (g, v) { panel(g, v); }
});

// ---- oscillators ---------------------------------------------------------------------
function oscScreen(n) {
  return function (g, v) {
    edge(g);
    var p = "osc" + n + "_", mode = disp(v, p + "mode") || "Classic", t = v.$touched || "";
    var shape = frac(v, p + "shape", 0.5), wave = num(v, p + "wave_select", 0), pw = frac(v, p + "pulsewidth", 0.5);
    var sig = [mode, shape.toFixed(2), wave, pw.toFixed(2)].join("|");
    frame(g, 10, 4, 440, 78, RULE);
    g.text(18, 17, "OSC " + n, DIM, -1);
    g.text(442, 17, mode.toUpperCase(), INK, 1);
    g.poly(cached("o" + n + sig, function () { return wavePts(16, 22, 428, 56, function (x) { return oscFn(mode, shape, wave, pw, shape)(x * 2); }); }), 2, RED);
    // what each knob means in this model: the same knob is another thing in another
    var means = mode === "HyperSaw" ? [["SHAPE", "DENSITY"], ["PULSEWIDTH", "SPREAD"], ["WAVE", "--"]]
      : mode === "Wavetable" ? [["SHAPE", "INDEX"], ["WAVE", "TABLE"], ["PULSEWIDTH", "--"]]
        : [["SHAPE", "WAVE>SAW>PULSE"], ["WAVE", "SPECTRAL WAVE"], ["PULSEWIDTH", "PULSE WIDTH"]];
    g.text(470, 17, "IN " + mode.toUpperCase(), DIM, -1);
    for (var i = 0; i < means.length; i++) {
      var lit = t === p + ["shape", "wave_select", "pulsewidth"][i];
      g.text(470, 36 + i * 16, means[i][0], lit ? INK : DIM, -1);
      g.text(580, 36 + i * 16, means[i][1], lit ? RED : INK, -1);
    }
    var semi = disp(v, p + "semitone");
    g.text(940, 36, "SEMI " + (semi || "0"), DIM, 1);
    if (n === 2) g.text(940, 52, "FINE " + (disp(v, "osc2_detune") || "0"), DIM, 1);
    g.text(940, 68, "KEYS " + (disp(v, p + "keyfollow") || "--"), DIM, 1);
  };
}
function levelBar(g, x, y, w, label, f, lit) {
  g.text(x, y, label, lit ? INK : DIM, -1);
  g.fill(x + 70, y - 7, w, 6, RULE);
  g.fill(x + 70, y - 7, Math.round(w * f), 6, lit ? LED_ON : RED);
}
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Osc 1", keys: ["osc1_mode", "osc1_shape", "osc1_wave_select", "osc1_pulsewidth", "osc1_semitone", "osc1_keyfollow",
      "osc1_wavetable_formantshift", "osc1_wavetable_internal_detune"], screen: oscScreen(1) },
    { label: "Osc 2", keys: ["osc2_mode", "osc2_shape", "osc2_wave_select", "osc2_pulsewidth", "osc2_semitone", "osc2_detune",
      "osc2_keyfollow", "osc2_filt_env_amt"], screen: oscScreen(2) },
    { label: "Osc 3 + Sub", keys: ["osc3_mode", "osc3_volume", "osc3_semitone", "osc3_detune", "suboscillator_volume",
      "suboscillator_shape", "noise_volume", "noise_color"],
      screen: function (g, v) {
        edge(g);
        var t = v.$touched || "";
        frame(g, 10, 4, 300, 78, RULE); g.text(18, 17, "OSC 3  " + (disp(v, "osc3_mode") || "--").toUpperCase(), DIM, -1);
        if (on(v, "osc3_mode")) g.poly(cached("o3" + disp(v, "osc3_mode"), function () { var m = disp(v, "osc3_mode"); return wavePts(16, 22, 288, 56, function (x) { var p = x * 3; return m === "Saw" ? saw(p) : m === "Pulse" ? pulse(p, 0.5) : m === "Triangle" ? 1 - 4 * Math.abs(p - Math.floor(p) - 0.5) : Math.sin(p * 6.2832); }); }), 2, RED);
        frame(g, 320, 4, 300, 78, RULE); g.text(328, 17, "SUB  " + (disp(v, "suboscillator_shape") || "").toUpperCase(), DIM, -1);
        var sq = disp(v, "suboscillator_shape") === "Square";
        g.poly(cached("sub" + sq, function () { return wavePts(326, 22, 288, 56, function (x) { var p = x * 1.5; return sq ? pulse(p, 0.5) : 1 - 4 * Math.abs(p - Math.floor(p) - 0.5); }); }), 2, frac(v, "suboscillator_volume") > 0.01 ? RED : FAINT);
        levelBar(g, 640, 30, 220, "OSC 3", frac(v, "osc3_volume"), t === "osc3_volume");
        levelBar(g, 640, 48, 220, "SUB", frac(v, "suboscillator_volume"), t === "suboscillator_volume");
        levelBar(g, 640, 66, 220, "NOISE", frac(v, "noise_volume"), t === "noise_volume");
      } },
    { label: "Mix + FM", keys: ["osc_balance", "osc_mainvolume", "osc2_fm_amount", "osc_fm_mode", "osc2_sync", "fm_filt_env_amt",
      "ringmodulator_volume", "punch_intensity"],
      screen: function (g, v) {
        edge(g);
        var t = v.$touched || "", b = frac(v, "osc_balance", 0.5);
        g.text(18, 17, "1", b < 0.5 ? INK : DIM, -1); g.text(300, 17, "2", b > 0.5 ? INK : DIM, 1);
        g.fill(18, 24, 282, 4, RULE); g.fill(18 + Math.round(276 * b), 20, 6, 12, t === "osc_balance" ? LED_ON : RED);
        levelBar(g, 18, 50, 212, "OSC VOL", frac(v, "osc_mainvolume"), t === "osc_mainvolume");
        levelBar(g, 18, 70, 212, "RING MOD", frac(v, "ringmodulator_volume"), t === "ringmodulator_volume");
        frame(g, 330, 4, 300, 78, RULE);
        g.text(338, 17, "FM  " + (disp(v, "osc_fm_mode") || "").toUpperCase(), DIM, -1);
        var fm = frac(v, "osc2_fm_amount", 0), sync = on(v, "osc2_sync");
        g.poly(cached("fm" + fm.toFixed(2), function () { return wavePts(336, 22, 288, 56, function (x) { var p = x * 3; return Math.sin(p * 6.2832 + fm * 4 * Math.sin(p * 6.2832 * 2)); }); }), 2, fm > 0.01 ? RED : FAINT);
        led(g, 660, 30, sync); g.text(670, 34, "SYNC", sync ? INK : FAINT, -1);
        levelBar(g, 660, 56, 200, "PUNCH", frac(v, "punch_intensity"), t === "punch_intensity");
      } }
  ]
});

// ---- filters -------------------------------------------------------------------------
function filterScreen(g, v) {
  edge(g);
  g.filter(10, 2, 300, 82, { cutoff: "cutoff", resonance: "filter1_resonance", type: "filter1_mode" });
  g.filter(330, 2, 300, 82, { cutoff: "cutoff2", resonance: "filter2_resonance", type: "filter2_mode" });
  g.text(18, 14, "1", INK, -1); g.text(338, 14, "2", INK, -1);
  var r = disp(v, "filter_routing");
  g.text(650, 22, (r || "--").toUpperCase(), INK, -1);
  g.text(650, 40, "BALANCE " + (disp(v, "filter_balance") || "--"), DIM, -1);
  g.text(650, 56, "SATURATION " + (disp(v, "saturation_curve") || "--").toUpperCase(), DIM, -1, 290);
  g.text(650, 72, "LINK " + (disp(v, "filter2_cutoff_link") || "--").toUpperCase(), DIM, -1);
}
push.compartment({
  id: "filter", label: "Filters",
  pages: [
    { label: "Filters", keys: ["cutoff", "filter1_resonance", "filter1_env_amt", "filter_balance", "cutoff2", "filter2_resonance",
      "filter2_env_amt", "filter_routing"] },
    { label: "Filters +", keys: ["filter1_mode", "filter1_keyfollow", "filter1_env_polarity", "saturation_curve", "filter2_mode",
      "filter2_keyfollow", "filter2_env_polarity", "filter2_cutoff_link"] }
  ],
  extra_keys: ["filter_balance", "saturation_curve", "filter2_cutoff_link", "filter_routing", "filter1_mode", "filter2_mode",
    "cutoff", "cutoff2", "filter1_resonance", "filter2_resonance"],
  screen: filterScreen
});

// ---- envelopes -----------------------------------------------------------------------
function envScreen(label, p) {
  return function (g, v) {
    edge(g);
    g.text(18, 14, label, DIM, -1);
    g.envelope(10, 2, 940, 82, { attack: p + "attack", decay: p + "decay", sustain: p + "sustain", release: p + "release", labels: true });
  };
}
push.compartment({
  id: "env", label: "Envelopes",
  pages: [
    { label: "Filter Env", keys: ["filter_env_attack", "filter_env_decay", "filter_env_sustain", "filter_env_sustain_time",
      "filter_env_release", "flt1_envamt_velocity", "flt2_envamt_velocity", "filter_keytrack_base"], screen: envScreen("FILTER ENVELOPE", "filter_env_") },
    { label: "Amp Env", keys: ["amp_env_attack", "amp_env_decay", "amp_env_sustain", "amp_env_sustain_time", "amp_env_release",
      "amp_velocity", "patch_volume", "panorama"], screen: envScreen("AMP ENVELOPE", "amp_env_") },
    { label: "Env 3", keys: ["envelope_3_attack", "envelope_3_decay", "envelope_3_sustain", "envelope_3_sustain_time",
      "envelope_3_release"], screen: envScreen("ENVELOPE 3", "envelope_3_") },
    { label: "Env 4", keys: ["envelope_4_attack", "envelope_4_decay", "envelope_4_sustain", "envelope_4_sustain_time",
      "envelope_4_release"], screen: envScreen("ENVELOPE 4", "envelope_4_") }
  ]
});

// ---- LFOs ----------------------------------------------------------------------------
function lfoScreen(n, amounts) {
  return function (g, v) {
    edge(g);
    var p = "lfo" + n + "_", t = v.$touched || "";
    g.lfo(10, 2, 420, 82, { shape: p + "shape", rate: p + "rate" });
    g.text(18, 14, "LFO " + n, DIM, -1);
    var clk = disp(v, p + "clock");
    g.text(422, 14, (clk && clk !== "Off" ? clk : (disp(v, p + "rate") || "")).toUpperCase(), INK, 1);
    for (var i = 0; i < amounts.length; i++) {
      var k = amounts[i][0], y = 16 + i * 14, f = frac(v, k, 0.5), lit = t === k;
      g.text(450, y, amounts[i][1], lit ? INK : DIM, -1);
      g.fill(560, y - 6, 200, 4, RULE);
      var mid = 560 + 100, x = 560 + Math.round(200 * f);
      g.fill(Math.min(mid, x), y - 7, Math.max(2, Math.abs(x - mid)), 6, lit ? LED_ON : RED);
      g.text(940, y, disp(v, k) || "--", lit ? INK : DIM, 1);
    }
  };
}
push.compartment({
  id: "lfo", label: "LFOs",
  pages: [
    { label: "LFO 1", keys: ["lfo1_rate", "lfo1_shape", "lfo1_clock", "lfo1_mode", "lfo1_symmetry", "lfo1_keyfollow", "lfo1_keytrigger",
      "lfo1_env_mode"], screen: lfoScreen(1, [["osc1_lfo1_amount", "OSC 1"], ["osc2_lfo1_amount", "OSC 2"], ["pw_lfo1_amount", "PULSEWIDTH"],
      ["reso_lfo1_amount", "RESONANCE"], ["filtgain_lfo1_amount", "FILTER GAIN"]]) },
    { label: "LFO 1 Amounts", keys: ["osc1_lfo1_amount", "osc2_lfo1_amount", "pw_lfo1_amount", "reso_lfo1_amount", "filtgain_lfo1_amount",
      "lfo1_assign_dest", "lfo1_assign_amount"], screen: lfoScreen(1, [["osc1_lfo1_amount", "OSC 1"], ["osc2_lfo1_amount", "OSC 2"],
      ["pw_lfo1_amount", "PULSEWIDTH"], ["reso_lfo1_amount", "RESONANCE"], ["filtgain_lfo1_amount", "FILTER GAIN"]]) },
    { label: "LFO 2", keys: ["lfo2_rate", "lfo2_shape", "lfo2_clock", "lfo2_mode", "lfo2_symmetry", "lfo2_keyfollow", "lfo2_keytrigger",
      "lfo2_env_mode"], screen: lfoScreen(2, [["shape_lfo2_amount", "SHAPE"], ["fm_lfo2_amount", "FM"], ["cutoff1_lfo2_amount", "CUTOFF 1"],
      ["cutoff2_lfo2_amount", "CUTOFF 2"], ["pan_lfo2_amount", "PAN"]]) },
    { label: "LFO 2 Amounts", keys: ["shape_lfo2_amount", "fm_lfo2_amount", "cutoff1_lfo2_amount", "cutoff2_lfo2_amount", "pan_lfo2_amount",
      "lfo2_assign_dest", "lfo2_assign_amount"], screen: lfoScreen(2, [["shape_lfo2_amount", "SHAPE"], ["fm_lfo2_amount", "FM"],
      ["cutoff1_lfo2_amount", "CUTOFF 1"], ["cutoff2_lfo2_amount", "CUTOFF 2"], ["pan_lfo2_amount", "PAN"]]) },
    { label: "LFO 3", keys: ["lfo3_rate", "lfo3_shape", "lfo3_clock", "lfo3_mode", "lfo3_keyfollow", "lfo3_destination", "osc_lfo3_amount",
      "lfo3_fade_in_time"], screen: lfoScreen(3, [["osc_lfo3_amount", "AMOUNT"]]) }
  ],
  extra_keys: ["osc1_lfo1_amount", "osc2_lfo1_amount", "pw_lfo1_amount", "reso_lfo1_amount", "filtgain_lfo1_amount", "shape_lfo2_amount",
    "fm_lfo2_amount", "cutoff1_lfo2_amount", "cutoff2_lfo2_amount", "pan_lfo2_amount", "osc_lfo3_amount"]
});

// ---- the modulation matrix: a source, three destinations, a line as strong as its amount
var SLOT_KEYS = [
  ["assign1_source", "assign1_destination", "assign1_amount", "assign_1_destination_2", "assign_1_amount_2", "assign_1_destination_3", "assign_1_amount_3"],
  ["assign2_source", "assign2_destination1", "assign2_amount1", "assign2_destination2", "assign2_amount2", "assign_2_destination_3", "assign_2_amount_3"],
  ["assign3_source", "assign3_destination1", "assign3_amount1", "assign3_destination2", "assign3_amount2", "assign3_destination3", "assign3_amount3"],
  ["assign_4_source", "assign_4_destination", "assign_4_amount", "assign_4_destination_2", "assign_4_amount_2", "assign_4_destination_3", "assign_4_amount_3"],
  ["assign_5_source", "assign_5_destination", "assign_5_amount", "assign_5_destination_2", "assign_5_amount_2", "assign_5_destination_3", "assign_5_amount_3"],
  ["assign_6_source", "assign_6_destination", "assign_6_amount", "assign_6_destination_2", "assign_6_amount_2", "assign_6_destination_3", "assign_6_amount_3"]
];
function matrixScreen(n) {
  return function (g, v) {
    edge(g);
    var k = SLOT_KEYS[n], t = v.$touched || "", src = disp(v, k[0]) || "Off";
    g.text(18, 14, "SLOT " + (n + 1), DIM, -1);
    g.fill(18, 34, 220, 22, src === "Off" ? PANEL : RED_DK);
    g.text(128, 49, src.toUpperCase(), src === "Off" ? FAINT : INK, 0, 210);
    for (var d = 0; d < 3; d++) {
      var dk = k[1 + d * 2], ak = k[2 + d * 2], dest = disp(v, dk) || "Off", f = frac(v, ak, 0.5), y = 18 + d * 26;
      var amt = Math.abs(f - 0.5) * 2, live = src !== "Off" && dest !== "Off" && amt > 0.01, lit = t === dk || t === ak;
      g.line(238, 45, 520, y + 6, live ? 1 + Math.round(amt * 4) : 1, live ? (lit ? LED_ON : RED) : RULE);
      g.fill(520, y - 4, 300, 20, dest === "Off" ? BG : PANEL);
      g.text(530, y + 10, dest.toUpperCase(), dest === "Off" ? FAINT : INK, -1, 280);
      g.text(940, y + 10, dest === "Off" ? "" : (disp(v, ak) || ""), lit ? INK : DIM, 1);
    }
  };
}
var MATRIX_PAGES = [];
for (var mi = 0; mi < 6; mi++) MATRIX_PAGES.push({ label: "Slot " + (mi + 1), keys: SLOT_KEYS[mi], screen: matrixScreen(mi) });
push.compartment({ id: "matrix", label: "Matrix", pages: MATRIX_PAGES });

// ---- effects: what the effect is, and how much of it there is ---------------------------
var FX_LABEL = { delay_time: "TIME", delay_feedback: "FEEDBACK", dly_rate_rev_decay: "RATE", dly_depth: "DEPTH", delay_color: "COLOR",
  reverb_time: "TIME", reverb_damping: "DAMPING", reverb_color: "COLOR", reverb_predelay: "PREDELAY", reverb_feedback: "FEEDBACK",
  chorus_rate: "RATE", chorus_depth: "DEPTH", chorus_delay: "DELAY", chorus_feedback: "FEEDBACK", chorus_x_over: "X-OVER",
  phaser_rate: "RATE", phaser_depth: "DEPTH", phaser_frequency: "FREQ", phaser_feedback: "FEEDBACK", phaser_spread: "SPREAD",
  patch_distortion_mix: "MIX", patch_distortion_treble_booster: "TREBLE", patch_distortion_high_cut: "HIGH CUT",
  bass_intensity: "BASS", bass_tune: "BASS TUNE", loweq_gain: "LOW", mideq_gain: "MID", mideq_q_factor: "MID Q",
  higheq_gain: "HIGH", mideq_frequency: "MID FREQ", filter_bank_frequency: "FREQ", filter_bank_resonance: "RESO",
  filter_bank_slope: "SLOPE", filter_bank_poles: "POLES", filter_bank_stereo_phase: "STEREO" };
function fxScreen(name, typeKey, amountKey, keys) {
  return function (g, v) {
    edge(g);
    var t = v.$touched || "", type = typeKey ? disp(v, typeKey) : "", active = amountKey ? on(v, amountKey) : true;
    if (typeKey && (type === "Off" || type === "")) active = false;
    led(g, 20, 14, active);
    g.text(30, 18, name, active ? INK : DIM, -1);
    if (type) g.value(18, 52, type.toUpperCase(), active ? INK : FAINT, -1, 300);
    if (amountKey) g.text(18, 74, "AMOUNT " + (disp(v, amountKey) || "--"), DIM, -1);
    // every knob of the page as a bar: the shape of the effect at a glance
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], x = 340 + i * 76, f = frac(v, k, 0), lit = t === k;
      g.fill(x, 12, 52, 62, PANEL);
      g.fill(x, 12 + Math.round(62 * (1 - f)), 52, Math.max(1, Math.round(62 * f)), lit ? LED_ON : (active ? RED : FAINT));
      g.text(x + 26, 84, FX_LABEL[k] || String(v[k] ? v[k].name : "").toUpperCase(), lit ? INK : DIM, 0, 72);
    }
  };
}
push.compartment({
  id: "fx", label: "Effects",
  pages: [
    { label: "Delay", keys: ["delay_type", "delay_send", "delay_time", "delay_feedback", "delay_clock", "dly_rate_rev_decay", "dly_depth", "delay_color"],
      screen: fxScreen("DELAY", "delay_type", "delay_send", ["delay_time", "delay_feedback", "dly_rate_rev_decay", "dly_depth", "delay_color"]) },
    { label: "Reverb", keys: ["reverb_mode", "reverb_send", "reverb_type", "reverb_time", "reverb_damping", "reverb_color", "reverb_predelay", "reverb_feedback"],
      screen: fxScreen("REVERB", "reverb_mode", "reverb_send", ["reverb_time", "reverb_damping", "reverb_color", "reverb_predelay", "reverb_feedback"]) },
    { label: "Chorus", keys: ["chorus_type", "chorus_mix", "chorus_rate", "chorus_depth", "chorus_delay", "chorus_feedback", "chorus_lfo_shape", "chorus_x_over"],
      screen: fxScreen("CHORUS", "chorus_type", "chorus_mix", ["chorus_rate", "chorus_depth", "chorus_delay", "chorus_feedback", "chorus_x_over"]) },
    { label: "Phaser", keys: ["phaser_mode", "phaser_mix", "phaser_rate", "phaser_depth", "phaser_frequency", "phaser_feedback", "phaser_spread"],
      screen: fxScreen("PHASER", "phaser_mode", "phaser_mix", ["phaser_rate", "phaser_depth", "phaser_frequency", "phaser_feedback", "phaser_spread"]) },
    { label: "Distortion", keys: ["distortion_curve", "distortion_intensity", "patch_distortion_mix", "patch_distortion_treble_booster",
      "patch_distortion_high_cut", "character_type", "bass_intensity", "bass_tune"],
      screen: fxScreen("DISTORTION", "distortion_curve", "distortion_intensity", ["patch_distortion_mix", "patch_distortion_treble_booster",
        "patch_distortion_high_cut", "bass_intensity", "bass_tune"]) },
    { label: "EQ", keys: ["loweq_frequency", "loweq_gain", "mideq_frequency", "mideq_gain", "mideq_q_factor", "higheq_frequency", "higheq_gain"],
      screen: fxScreen("EQUALIZER", null, null, ["loweq_gain", "mideq_gain", "mideq_q_factor", "higheq_gain", "mideq_frequency"]) },
    { label: "Filter Bank", keys: ["filter_bank_type", "filter_bank_mix", "filter_bank_frequency", "filter_bank_resonance", "filter_bank_slope",
      "filter_bank_poles", "filter_bank_stereo_phase"],
      screen: fxScreen("FILTER BANK", "filter_bank_type", "filter_bank_mix", ["filter_bank_frequency", "filter_bank_resonance",
        "filter_bank_slope", "filter_bank_poles", "filter_bank_stereo_phase"]) }
  ]
});

// ---- arpeggiator: the notes it climbs through ----------------------------------------
push.compartment({
  id: "arp", label: "Arp",
  pages: [{ label: "Arp", keys: ["arp_mode", "arp_pattern_selct", "arp_octave_range", "arp_hold_enable", "arp_note_length", "arp_swing",
    "arp_clock", "clock_tempo"] }],
  screen: function (g, v) {
    edge(g);
    var mode = disp(v, "arp_mode") || "Off", running = mode !== "Off";
    led(g, 20, 14, running); g.text(30, 18, "ARPEGGIATOR  " + mode.toUpperCase(), running ? INK : DIM, -1);
    var oct = Math.max(1, num(v, "arp_octave_range", 0) + 1), len = frac(v, "arp_note_length", 0.5), sw = frac(v, "arp_swing", 0);
    var steps = 16, w = 52, down = mode.indexOf("Down") === 0;
    for (var s = 0; s < steps; s++) {
      var o = Math.floor(s / 4) % oct, step = s % 4, h = down ? (oct - 1 - o) * 4 + (3 - step) : o * 4 + step;
      var x = 18 + s * w + (s % 2 ? Math.round(sw * 20) : 0), y = 78 - Math.round(h * (54 / Math.max(4, oct * 4)));
      g.fill(x, y, Math.max(4, Math.round((w - 4) * (0.2 + len * 0.8))), 5, running ? RED : FAINT);
    }
    g.text(940, 18, (disp(v, "arp_clock") || "").toUpperCase() + "   " + (disp(v, "clock_tempo") || "").toUpperCase(), DIM, 1);
  }
});

// ---- voice: how many voices a key sounds, and how they spread -------------------------
push.compartment({
  id: "voice", label: "Voice",
  pages: [
    { label: "Voice", keys: ["key_mode", "unison_mode", "unison_detune", "unison_pan_spread", "unison_lfo_phase", "portamento_time", "transpose",
      "bender_range_up"] },
    { label: "Velocity", keys: ["osc1_shape_velocity", "osc2_shape_velocity", "pulsewidth_velocity", "fm_amount_velocity", "resonance1_velocity",
      "resonance2_velocity", "panorama_velocity", "bender_range_down"] }
  ],
  extra_keys: ["key_mode", "unison_mode", "unison_detune", "unison_pan_spread"],
  screen: function (g, v) {
    edge(g);
    var u = disp(v, "unison_mode") || "Off", n = u === "Off" ? 1 : u === "Twin" ? 2 : Math.max(1, parseInt(u, 10) || 1);
    var det = frac(v, "unison_detune", 0), spread = frac(v, "unison_pan_spread", 0);
    g.text(18, 18, (disp(v, "key_mode") || "--").toUpperCase(), INK, -1);
    g.text(18, 36, n > 1 ? n + " VOICES A KEY" : "ONE VOICE A KEY", n > 1 ? RED : DIM, -1);
    for (var i = 0; i < n; i++) {
      var off = n > 1 ? (i / (n - 1) - 0.5) : 0, x = 480 + Math.round(off * 360 * spread), h = 64 - Math.abs(off) * 20;
      g.fill(x - 2, 82 - h, 4, h, RED);
      g.text(x, 82 - h - 4, n > 1 ? (off * det * 100 >= 0 ? "+" : "") + Math.round(off * det * 100) : "", DIM, 0);
    }
  }
});
