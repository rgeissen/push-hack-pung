// JE-8086 (JP-8000) on the Push. The compartments are the tabs of the
// module's own web panel (src/remote/assets/jp-model.js: Osc, Filter & Amp,
// LFO & Mod, FX, Play & Arp, System), their pages that panel's numbered
// sections, so the Push and the page show one instrument.
//
// One compartment draws the whole panel (takeover): Patch, the JP-8000's own
// way in. Its LCD (patch numbers as the hardware writes them, P:A11..P:B88,
// and the parameter being turned), and the front panel at a glance: both
// oscillators, the filter's response, the amp envelope, LFO 1. What knobs
// side by side cannot show: the whole patch on one screen while the
// encoders play its eight macros.

var AMBER = "#ffb340", LCD_BG = "#1c1306", LCD_EDGE = "#4a3510", PANEL = "#16181c";

function pages(label, keys) { // a section: 8 keys to a page
  var out = [];
  for (var i = 0; i < keys.length; i += 8) {
    out.push({ label: i ? label + " " + (i / 8 + 1) : label, keys: keys.slice(i, i + 8) });
  }
  return out;
}
function concat() { var o = []; for (var i = 0; i < arguments.length; i++) o = o.concat(arguments[i]); return o; }
function pre(p, list) { return list.map(function (k) { return p + k; }); }

// ---- Patch: the takeover -----------------------------------------------------------

function known(v, k) { return v[k] && v[k].known; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : "--"; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }

// the hardware's patch number: bank letter, group 1-8, number 1-8
function patchNumber(v) {
  var bank = known(v, "bank") ? String(v.bank.display) : "A";
  var letter = bank.charAt(bank.length - 1);
  if (!known(v, "patch")) return "P:" + letter + "--";
  var i = parseInt(v.patch.value, 10) || 0;
  return "P:" + letter + (Math.floor(i / 8) % 8 + 1) + (i % 8 + 1); // P:A11, as the hardware's LCD
}

function lcd(g, v) {
  var x = 8, y = 6, w = 444, h = 70;
  g.fill(x - 1, y - 1, w + 2, h + 2, LCD_EDGE);
  g.fill(x, y, w, h, LCD_BG);
  var perf = known(v, "mode") && parseInt(v.mode.value, 10) === 1;
  var name = perf ? disp(v, "performance_name") : disp(v, "patch_name");
  var num = perf ? "PERF" : patchNumber(v);
  g.value(x + 14, y + 30, num, AMBER, -1);
  g.value(x + 104, y + 30, name === "--" ? "" : name.toUpperCase(), AMBER, -1);
  // line 2: what is being turned, as the JP-8000's own LCD does; else the patch's state
  var t = v.$touched;
  if (t && v[t]) {
    g.text(x + 14, y + 58, String(v[t].name).toUpperCase(), AMBER, -1);
    g.text(x + w - 14, y + 58, disp(v, t) + (v[t].unit ? " " + v[t].unit : ""), AMBER, 1);
  } else {
    var parts = [disp(v, "part"), disp(v, "key_mode")];
    if (known(v, "arp_switch") && v.arp_switch.frac > 0.5) parts.push("ARP " + disp(v, "arp_mode"));
    if (known(v, "tempo")) parts.push(disp(v, "tempo") + " BPM");
    g.text(x + 14, y + 58, parts.join("   ").toUpperCase(), "#a87a2a", -1);
  }
}

function chip(g, x, y, s, on) {
  var w = s.length * 7 + 12;
  if (on) { g.fill(x, y, w, 15, AMBER); g.text(x + 6, y + 12, s, "black", -1); }
  else { g.fill(x, y, w, 15, "#2a2418"); g.text(x + 6, y + 12, s, "dim", -1); }
  return x + w + 6;
}

function modeRow(g, v) {
  var m = known(v, "mode") ? parseInt(v.mode.value, 10) : -1;
  var x = chip(g, 8, 84, "PATCH", m === 0);
  x = chip(g, x, 84, "PERFORM", m === 1);
  x += 10;
  var p = known(v, "part") ? String(v.part.display).toUpperCase() : "";
  x = chip(g, x, 84, "UPPER", p === "UPPER");
  x = chip(g, x, 84, "LOWER", p === "LOWER");
  chip(g, x, 84, "BOTH", p === "BOTH");
}

// a waveform, by the name the module gives it
function wave(g, x, y, w, h, name, col) {
  var n = String(name).toUpperCase(), pts = [], i, k = 4, mid = y + h / 2;
  if (n.indexOf("NOISE") >= 0 || n === "NSE") {
    for (i = 0; i <= 24; i++) pts.push([x + i * w / 24, mid + (((i * 7919) % 13) / 13 - 0.5) * h]);
  } else if (n.indexOf("SUPER") >= 0) { // seven detuned saws: three drawn
    for (var s = 0; s < 3; s++) {
      var q = [], off = s * 3;
      for (i = 0; i < 3; i++) { q.push([x + off + i * w / 3, y + h - s * 2]); q.push([x + off + (i + 1) * w / 3 - 1, y + s * 2]); }
      g.poly(q, s ? 1 : 2, s ? "dim" : col);
    }
    return;
  } else if (n.indexOf("SQR") >= 0 || n.indexOf("PWM") >= 0 || n.indexOf("SQUARE") >= 0) {
    for (i = 0; i < 3; i++) { var a = x + i * w / 3; pts.push([a, y + h], [a, y], [a + w / 6, y], [a + w / 6, y + h]); }
    pts.push([x + w, y + h]);
  } else if (n.indexOf("TRI") >= 0) {
    for (i = 0; i <= 6; i++) pts.push([x + i * w / 6, i % 2 ? y : y + h]);
  } else if (n.indexOf("FEEDBACK") >= 0 || n.indexOf("FBK") >= 0) {
    for (i = 0; i <= 30; i++) { var ph = i / 30 * 6.283 * 2; pts.push([x + i * w / 30, mid - Math.sin(ph + Math.sin(ph) * 1.4) * h / 2]); }
  } else if (n.indexOf("RANDOM") >= 0 || n === "RND") {
    var lv = [0.2, 0.8, 0.4, 0.9, 0.1, 0.6];
    for (i = 0; i < 6; i++) { pts.push([x + i * w / 6, y + lv[i] * h], [x + (i + 1) * w / 6, y + lv[i] * h]); }
  } else { // saw
    for (i = 0; i < 3; i++) { pts.push([x + i * w / 3, y + h], [x + (i + 1) * w / 3 - 1, y]); }
    pts.push([x + w, y + h]);
  }
  g.poly(pts, 2, col);
  void k;
}

function tile(g, x, title, hot) {
  g.fill(x, 6, 116, 94, PANEL);
  g.text(x + 8, 19, title, hot ? AMBER : "dim", -1);
}

var curveKey = "", curvePts = null;
function filterCurve(g, x, y, w, h, v) {
  var type = known(v, "filter_type") ? String(v.filter_type.display) : "LPF";
  var c = fr(v, "cutoff", 0.7), r = fr(v, "resonance", 0.2), steep = fr(v, "cutoff_slope", 1) > 0.5 ? 4 : 2;
  var key = [type, c.toFixed(3), r.toFixed(3), steep, x].join("|");
  if (key !== curveKey) {
    curvePts = [];
    for (var i = 0; i <= 40; i++) {
      var f = i / 40, d = (f - c) * 6, mag;
      if (type === "HPF") mag = d > 0 ? 1 : Math.exp(d * steep * 0.5);
      else if (type === "BPF") mag = Math.exp(-Math.abs(d) * steep * 0.5);
      else mag = d < 0 ? 1 : Math.exp(-d * steep * 0.5);
      mag += r * 1.4 * Math.exp(-d * d * 8);
      curvePts.push([x + f * w, y + h - Math.min(1.25, mag) / 1.25 * h]);
    }
    curveKey = key;
  }
  g.area(curvePts, y + h, "#3a2a10");
  g.poly(curvePts, 2, "fg");
}

function overview(g, v) {
  var t = v.$touched || "";
  var x = 464;
  // OSC 1 and OSC 2
  tile(g, x, "OSC 1 / 2", /^osc/.test(t));
  wave(g, x + 10, 30, 96, 22, disp(v, "osc1_waveform"), "fg");
  wave(g, x + 10, 62, 96, 18, disp(v, "osc2_waveform"), "dim");
  var bal = fr(v, "osc_balance", 0.5);
  g.fill(x + 10, 88, 96, 2, "line");
  g.fill(x + 8 + bal * 96, 85, 4, 8, AMBER);
  x += 122;
  tile(g, x, known(v, "filter_type") ? "FILTER " + disp(v, "filter_type") : "FILTER", /cutoff|resonance|filter/.test(t));
  filterCurve(g, x + 8, 28, 100, 60, v);
  x += 122;
  tile(g, x, "AMP", /^amp/.test(t));
  g.envelope(x + 2, 24, 112, 72, { attack: "amp_attack", decay: "amp_decay", sustain: "amp_sustain", release: "amp_release" });
  x += 122;
  tile(g, x, "LFO 1", /lfo1/.test(t));
  wave(g, x + 10, 34, 96, 30, disp(v, "lfo1_waveform"), "fg");
  g.text(x + 8, 90, "RATE " + disp(v, "lfo1_rate"), "dim", -1);
}

function knobRow(g, v) {
  var knobs = v.$knobs || [], t = v.$touched;
  g.fill(0, 104, 960, 1, "line");
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], cx = i * 120 + 60;
    if (i) g.fill(i * 120, 112, 1, 44, "faint");
    if (!k || !v[k]) continue;
    var hot = k === t;
    g.text(cx, 124, String(v[k].name).toUpperCase().slice(0, 15), hot ? "fg" : "dim", 0);
    g.value(cx, 149, disp(v, k), hot ? AMBER : "fg", 0);
    if (hot) g.fill(cx - 20, 154, 40, 2, AMBER);
  }
  // which page of this screen the encoders are on
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(452, 96, String(ps[v.$page]).toUpperCase() + "  " + (v.$page + 1) + "/" + ps.length, "dim", 1);
}

push.compartment({
  id: "patch", label: "Patch", takeover: true,
  pages: [
    { label: "Patch", keys: ["cutoff", "resonance", "filter_env_depth", "part", "amp_attack", "amp_decay", "amp_sustain", "amp_release"] },
    { label: "Select", keys: ["mode", "bank", "perf_bank", "mod_lever", "tempo"] }
  ],
  extra_keys: ["patch", "patch_name", "performance_name", "osc1_waveform", "osc2_waveform", "osc_balance",
    "filter_type", "cutoff_slope", "lfo1_waveform", "lfo1_rate", "key_mode", "arp_switch", "arp_mode"],
  screen: function (g, v) {
    lcd(g, v);
    modeRow(g, v);
    overview(g, v);
    knobRow(g, v);
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
