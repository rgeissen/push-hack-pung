// Xenia (the Waldorf Microwave II/XT, emulated) on Push.
//
// The Microwave is a wavetable synth: a sound is a path through a table of
// 64 wave positions, and what the panel is about is where in the table each
// oscillator starts and how the envelopes move it. So the device opens on
// the table itself, drawn from the real waves the synth holds (wave_view: the
// engine asks the synth for the sound's table and its waves, as the
// Microwave's own editors do), beside the XT's 2 x 40 dot-matrix display, in
// its orange: the two start positions are lit, and the eight encoders are
// the panel's eight knobs.
//
// The other pages go through each section with the picture of what its
// knobs do together: the oscillators' pitches, the table again with its
// keytracking, the mixer, the two filters as curves, the LFOs as waves, the
// wave envelope's eight stages as the path through the table, the
// modulation slots, the arpeggiator's sixteen steps. The effect panel names
// its own knobs: what A, B and C are depends on the effect. The filter, amp
// and free envelopes are Pung's own envelope (UX-GUIDELINES.md, Envelopes).
// docs/NATIVE-MODULES.md, Xenia.

// <pages> written by tools/gen_params.py from its LAYOUT: do not edit here
var PAGES = {
  panel: [
    { label: "Xenia", keys: ["wave", "w1_start_w", "w2_start_w", "w1_env_amount", "f1_cutoff", "f1_resonance", "f1_env_amount", "amp_volume"] }
  ],
  osc: [
    { label: "Oscillators", keys: ["o1_octave", "o1_semi", "o1_detune", "o1_fm_amount", "o2_octave", "o2_semi", "o2_detune", "o2_sync"] },
    { label: "Osc Tracking", keys: ["o1_bend_range", "o1_key_track", "o2_bend_range", "o2_key_track", "o2_link", "w2_env_amount", "w1_env_vel_amount", "w2_env_vel_amount"] }
  ],
  wave: [
    { label: "Waves", keys: ["w1_start_p", "w1_keytrack", "w1_limit", "w2_start_p", "w2_keytrack", "w2_limit", "w2_link", "accuracy"] },
    { label: "Mixer", keys: ["mix_w1", "mix_w2", "mix_ring_mod", "mix_noise", "aliasing", "time_quant", "clipping", "pan"] }
  ],
  filter: [
    { label: "Filters", keys: ["f1_type", "f1_key_track", "f1_env_vel_amount", "f1_extra", "f2_type", "f2_cutoff", "f2_key_track", "amp_keytrack"] }
  ],
  env: [
    { label: "Filter / Amp", keys: ["f1_env_attack", "f1_env_decay", "f1_env_sustain", "f1_env_release", "amp_env_attack", "amp_env_decay", "amp_env_sustain", "amp_env_release"] },
    { label: "Free Env", keys: ["free_env_time1", "free_env_level1", "free_env_time2", "free_env_level2", "free_env_time3", "free_env_level3", "free_env_release_time", "free_env_release_level"] },
    { label: "Triggers", keys: ["f1_env_trigger", "amp_env_trigger", "free_env_trigger"] }
  ],
  lfo: [
    { label: "LFOs", keys: ["lfo1_rate", "lfo1_shape", "lfo1_delay", "lfo1_sync", "lfo2_rate", "lfo2_shape", "lfo2_delay", "lfo2_sync"] },
    { label: "LFO Shape", keys: ["lfo1_symmetry", "lfo1_humanize", "lfo2_symmetry", "lfo2_humanize", "lfo2_phase"] }
  ],
  fx: [
    { label: "Effect / Glide", keys: ["effect_type", "effect_param_a", "effect_param_b", "effect_param_c", "glide_enabled", "glide_time", "glide_type", "glide_mode"] }
  ],
  voice: [
    { label: "Voice", keys: ["allocation_mode", "assignment", "detune", "de_pan", "amp_velocity", "pan_keytrack", "chorus_enabled", "arp_mode"] },
    { label: "Play Params", keys: ["play_param_a", "play_param_b", "play_param_c", "play_param_d"] }
  ],
  wenv: [
    { label: "Wave Env Time", keys: ["wave_env_time1", "wave_env_time2", "wave_env_time3", "wave_env_time4", "wave_env_time5", "wave_env_time6", "wave_env_time7", "wave_env_time8"] },
    { label: "Wave Env Level", keys: ["wave_env_level1", "wave_env_level2", "wave_env_level3", "wave_env_level4", "wave_env_level5", "wave_env_level6", "wave_env_level7", "wave_env_level8"] },
    { label: "Wave Env Loop", keys: ["wave_key_on_loop", "wave_key_on_loop_start", "wave_key_on_loop_end", "wave_key_off_loop", "wave_key_off_loop_start", "wave_key_off_loop_end", "wave_env_trigger"] }
  ],
  matrix: [
    { label: "Modifiers 1-2", keys: ["mod1_source1", "mod1_source2", "mod1_type", "mod1_parameter", "mod2_source1", "mod2_source2", "mod2_type", "mod2_parameter"] },
    { label: "Modifiers 3-4", keys: ["mod3_source1", "mod3_source2", "mod3_type", "mod3_parameter", "mod4_source1", "mod4_source2", "mod4_type", "mod4_parameter"] },
    { label: "Slots 1-2", keys: ["slot1_source", "slot1_destination", "slot1_amount", "slot2_source", "slot2_destination", "slot2_amount"] },
    { label: "Slots 3-4", keys: ["slot3_source", "slot3_destination", "slot3_amount", "slot4_source", "slot4_destination", "slot4_amount"] },
    { label: "Slots 5-6", keys: ["slot5_source", "slot5_destination", "slot5_amount", "slot6_source", "slot6_destination", "slot6_amount"] },
    { label: "Slots 7-8", keys: ["slot7_source", "slot7_destination", "slot7_amount", "slot8_source", "slot8_destination", "slot8_amount"] },
    { label: "Slots 9-10", keys: ["slot9_source", "slot9_destination", "slot9_amount", "slot10_source", "slot10_destination", "slot10_amount"] },
    { label: "Slots 11-12", keys: ["slot11_source", "slot11_destination", "slot11_amount", "slot12_source", "slot12_destination", "slot12_amount"] },
    { label: "Slots 13-14", keys: ["slot13_source", "slot13_destination", "slot13_amount", "slot14_source", "slot14_destination", "slot14_amount"] },
    { label: "Slots 15-16", keys: ["slot15_source", "slot15_destination", "slot15_amount", "slot16_source", "slot16_destination", "slot16_amount"] },
    { label: "Control Delay", keys: ["mod_delay_source", "mod_delay_time"] }
  ],
  arp: [
    { label: "Arp", keys: ["arp_tempo", "arp_clock", "arp_range", "arp_pattern", "arp_direction", "arp_note_order", "arp_velocity", "arp_reset"] },
    { label: "Arp Pattern", keys: ["arp_user_pattern_length"] },
    { label: "Steps 1-8", keys: ["arp_user_pattern1", "arp_user_pattern2", "arp_user_pattern3", "arp_user_pattern4", "arp_user_pattern5", "arp_user_pattern6", "arp_user_pattern7", "arp_user_pattern8"] },
    { label: "Steps 9-16", keys: ["arp_user_pattern9", "arp_user_pattern10", "arp_user_pattern11", "arp_user_pattern12", "arp_user_pattern13", "arp_user_pattern14", "arp_user_pattern15", "arp_user_pattern16"] }
  ],
};
// </pages>

// The XT's characters, 5 x 7 dots each (the same face as Vavra's microQ)
var GLYPH = {
  "A": ["01110","10001","10001","11111","10001","10001","10001"], "B": ["11110","10001","10001","11110","10001","10001","11110"],
  "C": ["01110","10001","10000","10000","10000","10001","01110"], "D": ["11100","10010","10001","10001","10001","10010","11100"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"], "F": ["11111","10000","10000","11110","10000","10000","10000"],
  "G": ["01110","10001","10000","10111","10001","10001","01111"], "H": ["10001","10001","10001","11111","10001","10001","10001"],
  "I": ["01110","00100","00100","00100","00100","00100","01110"], "J": ["00111","00010","00010","00010","00010","10010","01100"],
  "K": ["10001","10010","10100","11000","10100","10010","10001"], "L": ["10000","10000","10000","10000","10000","10000","11111"],
  "M": ["10001","11011","10101","10101","10001","10001","10001"], "N": ["10001","10001","11001","10101","10011","10001","10001"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"], "P": ["11110","10001","10001","11110","10000","10000","10000"],
  "Q": ["01110","10001","10001","10001","10101","10010","01101"], "R": ["11110","10001","10001","11110","10100","10010","10001"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"], "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"], "V": ["10001","10001","10001","10001","10001","01010","00100"],
  "W": ["10001","10001","10001","10101","10101","10101","01010"], "X": ["10001","10001","01010","00100","01010","10001","10001"],
  "Y": ["10001","10001","10001","01010","00100","00100","00100"], "Z": ["11111","00001","00010","00100","01000","10000","11111"],
  "a": ["00000","00000","01110","00001","01111","10001","01111"], "b": ["10000","10000","10110","11001","10001","10001","11110"],
  "c": ["00000","00000","01110","10000","10000","10001","01110"], "d": ["00001","00001","01101","10011","10001","10001","01111"],
  "e": ["00000","00000","01110","10001","11111","10000","01110"], "f": ["00110","01001","01000","11100","01000","01000","01000"],
  "g": ["00000","01111","10001","10001","01111","00001","01110"], "h": ["10000","10000","10110","11001","10001","10001","10001"],
  "i": ["00100","00000","01100","00100","00100","00100","01110"], "j": ["00010","00000","00110","00010","00010","10010","01100"],
  "k": ["10000","10000","10010","10100","11000","10100","10010"], "l": ["01100","00100","00100","00100","00100","00100","01110"],
  "m": ["00000","00000","11010","10101","10101","10001","10001"], "n": ["00000","00000","10110","11001","10001","10001","10001"],
  "o": ["00000","00000","01110","10001","10001","10001","01110"], "p": ["00000","00000","11110","10001","11110","10000","10000"],
  "q": ["00000","00000","01101","10011","01111","00001","00001"], "r": ["00000","00000","10110","11001","10000","10000","10000"],
  "s": ["00000","00000","01110","10000","01110","00001","11110"], "t": ["01000","01000","11100","01000","01000","01001","00110"],
  "u": ["00000","00000","10001","10001","10001","10011","01101"], "v": ["00000","00000","10001","10001","10001","01010","00100"],
  "w": ["00000","00000","10001","10001","10101","10101","01010"], "x": ["00000","00000","10001","01010","00100","01010","10001"],
  "y": ["00000","00000","10001","10001","01111","00001","01110"], "z": ["00000","00000","11111","00010","00100","01000","11111"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"], "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"], "3": ["11111","00010","00100","00010","00001","10001","01110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"], "5": ["11111","10000","11110","00001","00001","10001","01110"],
  "6": ["00110","01000","10000","11110","10001","10001","01110"], "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"], "9": ["01110","10001","10001","01111","00001","00010","01100"],
  " ": ["00000","00000","00000","00000","00000","00000","00000"], "-": ["00000","00000","00000","11111","00000","00000","00000"],
  ".": ["00000","00000","00000","00000","00000","01100","01100"], ",": ["00000","00000","00000","00000","01100","00100","01000"],
  ":": ["00000","01100","01100","00000","01100","01100","00000"], "/": ["00000","00001","00010","00100","01000","10000","00000"],
  "+": ["00000","00100","00100","11111","00100","00100","00000"], "'": ["01100","00100","01000","00000","00000","00000","00000"],
  "!": ["00100","00100","00100","00100","00100","00000","00100"], "?": ["01110","10001","00001","00010","00100","00000","00100"],
  "&": ["01100","10010","10100","01000","10101","10010","01101"], "(": ["00010","00100","01000","01000","01000","00100","00010"],
  ")": ["01000","00100","00010","00010","00010","00100","01000"], "#": ["01010","01010","11111","01010","11111","01010","01010"],
  "*": ["00000","00100","10101","01110","10101","00100","00000"], "_": ["00000","00000","00000","00000","00000","00000","11111"],
  "=": ["00000","00000","11111","00000","11111","00000","00000"], "<": ["00010","00100","01000","10000","01000","00100","00010"],
  ">": ["01000","00100","00010","00001","00010","00100","01000"], "%": ["11000","11001","00010","00100","01000","10011","00011"]
};

// ---- the XT's colours ------------------------------------------------------------------
var GROUND = "#1d1916", PANEL = "#2a231e", RULE = "#463d35";
var ORANGE = "#d4740f", ORANGE_LT = "#f39a3a", ORANGE_DK = "#5a3208", ORANGE_GL = "#a3560c";
var CREAM = "#eadbb4", INK = "#f3e7d9", DIM = "#a89886", FAINT = "#5c5148";
var BROWN = "#3b2414", BROWN_LT = "#5a3a22";
var LCD_BG = "#8fb43a", LCD_ON = "#1c2a0b", LCD_OFF = "#86aa36";
var LED_ON = "#ff5a26", LED_OFF = "#4a1d10";

function known(v, k) { return v[k] && v[k].known; }
function frac(v, k, neutral) { return known(v, k) ? v[k].frac : (neutral === undefined ? 0 : neutral); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? (d || 0) : n; }
function idx(v, k) { return Math.round(num(v, k, 0)); }
// a value as the engine names it, as an option index into a list (an enum's display is its name)
function opt(v, k, list) { var s = disp(v, k), i = list.indexOf(s); return i < 0 ? 0 : i; }

function edge(g) { g.fill(0, 0, 3, g.h, ORANGE); } // every page carries the XT's orange at its left edge
function led(g, x, y, on) { g.dot(x, y, 4, on ? LED_ON : LED_OFF); }
function frame(g, x, y, w, h, c) {
  g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c); g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c);
}
function legend(g, x, y, s, c) { g.text(x, y, String(s).toUpperCase(), c || ORANGE, -1); }
function pad(s, n) { s = String(s || ""); while (s.length < n) s += " "; return s.slice(0, n); }
function padl(s, n) { s = String(s || ""); while (s.length < n) s = " " + s; return s.slice(-n); }

// ---- the dot-matrix display ------------------------------------------------------------
// The XT's 2 x 40 characters, 5 x 7 dots each. A cell is one block of unlit
// dots and its lit ones on top (2 px on a 2 px pitch: at this size an LCD's
// dots run together): 80 cells and their dots, in a cached layer.
function lcdLine(g, x, y, s) {
  s = String(s || "");
  for (var c = 0; c < 40; c++) {
    var cx = x + c * 12, ch = c < s.length ? s.charAt(c) : " ";
    g.fill(cx - 1, y - 1, 10, 14, LCD_OFF);
    var gl = GLYPH[ch] || GLYPH[ch.toUpperCase()] || GLYPH["?"];
    for (var r = 0; r < 7; r++)
      for (var col = 0; col < 5; col++)
        if (gl[r].charAt(col) === "1") g.fill(cx + col * 2 - 1, y + r * 2 - 1, 2, 2, LCD_ON);
  }
}
// the display in its brown surround: 480 x 32 px of characters
function lcd(g, x, y, l1, l2) {
  g.fill(x - 14, y - 12, 508, 60, BROWN);
  g.fill(x - 10, y - 8, 500, 52, BROWN_LT);
  g.fill(x - 8, y - 6, 496, 48, LCD_BG);
  lcdLine(g, x, y, l1);
  lcdLine(g, x, y + 19, l2);
}
// "A001 CS-80 T&WMF" as the XT shows a sound: bank letter, number, name
function soundTitle(v) {
  var bank = (disp(v, "bank_name") || "").replace("Bank ", "");
  var n = ("00" + (num(v, "preset", 0) + 1)).slice(-3);
  return (bank ? bank.charAt(0) : "-") + n + " " + pad(disp(v, "preset_name"), 16);
}

// ---- the encoder row a front panel draws itself ---------------------------------------
function dial(g, cx, cy, r, f, on, bipolar) {
  g.arc(cx, cy, r, 135, 270, 2, FAINT);
  if (bipolar) {
    var m = 270, a = 135 + 270 * f;
    g.arc(cx, cy, r, Math.min(m, a), Math.abs(a - m) + 1, 3, on ? ORANGE_LT : ORANGE);
  } else if (f > 0) g.arc(cx, cy, r, 135, 270 * f, 3, on ? ORANGE_LT : ORANGE);
}
var BIPOLAR = /Env|Detune|Semi|Amount|Amt|Keys|Symmetry|Level/;
function knobRow(g, v, names, values, y) {
  var knobs = v.$knobs || [], t = v.$touched;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], x = i * 120, on = k && k === t;
    var name = names ? names[i] : (k && v[k] ? (v[k].short || v[k].name) : "");
    if (!name) continue;
    if (on) g.fill(x + 4, y - 2, 112, 46, ORANGE_DK);
    var bip = k && v[k] && BIPOLAR.test(v[k].name || "") && !/Type|Trig/.test(v[k].name || "");
    g.text(x + 60, y + 9, String(name).toUpperCase(), on ? ORANGE_LT : ORANGE, 0, 110);
    dial(g, x + 20, y + 30, 10, frac(v, k, 0), on, bip);
    g.value(x + 36, y + 37, values ? values[i] : (disp(v, k) || "--"), INK, -1, 80);
  }
}
// the lower buttons as Pung maps them (draws_tabs): a page's name, "<" or ">"
function tabs(g, v, y) {
  var ts = v.$tabs || [], cur = v.$tab === undefined ? -1 : v.$tab;
  for (var i = 0; i < 8; i++) {
    var t = ts[i] || "", x = i * 120;
    if (t === "<" || t === ">") {
      var cx = x + 60, d = t === "<" ? -1 : 1;
      g.poly([cx - 6 * d, y - 9, cx + 6 * d, y - 4, cx - 6 * d, y + 1, cx - 6 * d, y - 9], 2, ORANGE);
      continue;
    }
    if (!t) continue;
    if (i === cur) g.fill(x + 6, y - 11, 108, 15, ORANGE);
    g.text(x + 60, y, t.toUpperCase(), i === cur ? GROUND : DIM, 0, 104);
  }
}

// ---- the wavetable -----------------------------------------------------------------------
// wave_view: positions 0, 4 .. 60 of the sound's table, 32 points each, two
// hex digits a point; "" while the waves are still coming, "algo" for a table
// the synth computes (there is nothing to ask it for)
function parseWaves(s) {
  if (!s || s.length < 16 * 64) return null;
  var out = [];
  for (var w = 0; w < 16; w++) {
    var pts = [];
    for (var i = 0; i < 32; i++) pts.push((parseInt(s.substr((w * 32 + i) * 2, 2), 16) - 128) / 128);
    out.push(pts);
  }
  return out;
}
// the table as a landscape: the first position in front, the last at the
// back, each wave hiding what stands behind it; a start position lit. Beside
// it the three waves every table ends in (61-63: triangle, square, saw), lit
// where an oscillator starts on one of them
function fixedWaves(g, x, y, h, starts) {
  var rh = h / 3, a = rh / 2 - 4;
  for (var f = 0; f < 3; f++) {
    var c = RULE, label = "", cy = y + rh * f + rh / 2;
    for (var s = 0; s < starts.length; s++) if (starts[s].fixed === f) { c = starts[s].color; label = label ? label + " " + starts[s].label : starts[s].label; }
    var pts = f === 0 ? [x, cy, x + 6, cy - a, x + 19, cy + a, x + 26, cy]                          // triangle
      : f === 1 ? [x, cy, x, cy - a, x + 13, cy - a, x + 13, cy + a, x + 26, cy + a, x + 26, cy]    // square
      : [x, cy, x + 13, cy - a, x + 13, cy + a, x + 26, cy];                                       // saw
    g.poly(pts, label ? 2 : 1, c);
    if (label) g.text(x + 30, cy + 4, label, c, -1);
  }
}
function wavetable(g, x, y, w, h, v, starts) {
  fixedWaves(g, x + w - 38, y, h, starts);
  w -= 46;
  var raw = disp(v, "wave_view"), waves = parseWaves(raw);
  var n = 16, dx = Math.floor((w * 0.42) / (n - 1)), dy = (h * 0.5) / (n - 1), ww = w - dx * (n - 1), amp = h * 0.25;
  if (!waves) {
    frame(g, x, y, w, h, RULE);
    var what = raw === "algo" ? "CALCULATED BY THE SYNTH" : known(v, "wave_view") ? "READING THE WAVES" : "";
    g.text(x + w / 2, y + h / 2 + 4, what, raw === "algo" ? DIM : FAINT, 0, w - 20);
    return;
  }
  for (var i = n - 1; i >= 0; i--) {
    var bx = x + i * dx, by = y + h - amp - 2 - i * dy, pts = [];
    for (var j = 0; j < 32; j++) pts.push(bx + j / 31 * ww, by - waves[i][j] * amp);
    var lit = -1;
    for (var s = 0; s < starts.length; s++) if (starts[s].pos === i) lit = s;
    g.area(pts, by + amp + 2, GROUND);
    g.poly(pts, lit >= 0 ? 2 : 1, lit >= 0 ? starts[lit].color : i % 4 === 0 ? ORANGE_GL : BROWN_LT);
    if (lit >= 0) g.text(bx + ww + 4, by + 4, starts[lit].label, starts[lit].color, -1);
  }
}
// where an oscillator starts in the table: its start wave, 0..60 drawn at
// the nearest of the 16 positions, 61..63 one of the three fixed waves
function startOf(v, k, label, color) {
  var w = Math.round(num(v, k, 0));
  if (w > 60) return { pos: -1, fixed: w - 61, label: label, color: color };
  return { pos: Math.max(0, Math.min(15, Math.round(w / 4))), fixed: -1, label: label, color: color };
}

// ---- the front panel ----------------------------------------------------------------------
var SOUND = ["status", "preset", "preset_name", "bank_name", "wave_view"];
function waiting(v) { return disp(v, "status").indexOf("Waiting") === 0; }
// the display's second line: what the touched knob says, else where the oscillators start
function panelLine(v) {
  var t = v.$touched;
  if (t && v[t]) return pad((v[t].name || t).toUpperCase(), 20) + padl(disp(v, t), 20);
  return pad("W1 " + (disp(v, "w1_start_w") || "-"), 13) + pad("W2 " + (disp(v, "w2_start_w") || "-"), 13) +
    padl("CUTOFF " + (disp(v, "f1_cutoff") || "-"), 14);
}
function frontPanel(g, v) {
  var l1 = pad(soundTitle(v), 21) + padl(disp(v, "wave"), 19), l2 = panelLine(v);
  var starts = [startOf(v, "w1_start_w", "1", ORANGE_LT), startOf(v, "w2_start_w", "2", CREAM)];
  // one layer (a layer replaces the frame drawn so far: there is one, and it comes first)
  g.layer("xp|" + l1 + "|" + l2 + "|" + disp(v, "wave_view") + "|" + starts[0].pos + "/" + starts[0].fixed + "|" + starts[1].pos + "/" + starts[1].fixed, function () {
    g.fill(0, 0, 960, 96, GROUND);
    g.fill(0, 0, 524, 96, ORANGE_GL);
    g.fill(2, 2, 520, 92, ORANGE);
    lcd(g, 22, 16, l1, l2);
    g.text(14, 88, "XENIA", GROUND, -1);
    g.text(70, 88, "MICROWAVE II/XT", BROWN, -1);
    g.text(510, 88, "WAVETABLE " + (disp(v, "wave") || "").toUpperCase(), BROWN, 1, 300);
    wavetable(g, 534, 4, 418, 88, v, starts);
  });
  knobRow(g, v, null, null, 100);
}

// ---- the effect panel ---------------------------------------------------------------------
var FX_TYPES = ["Off", "Chorus", "Flanger 1", "Flanger 2", "AutoWah LP", "AutoWah BP", "Overdrive", "Amp Mod", "Delay", "Pan Delay",
  "Mod Delay"];
var FX_TILE = ["", "Chorus", "Flanger 1", "Flanger 2", "Wah LP", "Wah BP", "Drive", "Amp Mod", "Delay", "Pan Dly", "Mod Dly"];
// what A, B and C are, by the effect (the Microwave XT manual's effect chapter)
var FX_KNOBS = {
  "Chorus": ["Speed", "Depth", "Mix"], "Flanger 1": ["Speed", "Feedback", "Mix"], "Flanger 2": ["Speed", "Feedback", "Mix"],
  "AutoWah LP": ["Sense", "Cutoff", "Resonance"], "AutoWah BP": ["Sense", "Cutoff", "Resonance"],
  "Overdrive": ["Drive", "Gain", "Amp Type"], "Amp Mod": ["Speed", "Spread", "Mix"], "Delay": ["Time", "Feedback", "Mix"],
  "Pan Delay": ["Time", "Feedback", "Mix"], "Mod Delay": ["Time", "Speed", "Depth"]
};
function fxPanel(g, v) {
  var type = disp(v, "effect_type") || "Off", on = type !== "Off", glide = disp(v, "glide_enabled") === "On";
  var l1 = pad(soundTitle(v), 21) + padl("EFFECT " + type, 19);
  var l2 = pad("GLIDE " + (glide ? (disp(v, "glide_type") || "") : "OFF"), 24) + padl(glide ? disp(v, "glide_mode") : "", 16);
  g.layer("xf|" + l1 + "|" + l2, function () {
    g.fill(0, 0, 960, 96, GROUND);
    g.fill(0, 0, 524, 96, ORANGE_GL);
    g.fill(2, 2, 520, 92, ORANGE);
    lcd(g, 22, 16, l1, l2);
    g.text(14, 88, "XENIA", GROUND, -1);
    g.text(70, 88, "EFFECT / GLIDE", BROWN, -1);
    // the effects, the chosen one lit
    for (var i = 1; i < FX_TYPES.length; i++) {
      var c = (i - 1) % 5, r = Math.floor((i - 1) / 5), x = 540 + c * 84, y = 8 + r * 26, lit = FX_TYPES[i] === type;
      g.fill(x, y, 80, 20, lit ? ORANGE : PANEL);
      if (!lit) frame(g, x, y, 80, 20, RULE);
      g.text(x + 40, y + 14, FX_TILE[i].toUpperCase(), lit ? GROUND : DIM, 0, 76);
    }
  });
  // the glide: from one note to the next, as long as its time
  var gt = frac(v, "glide_time", 0), gx = 540 + 30 + gt * 300;
  g.fill(540, 62, 412, 30, PANEL);
  g.line(548, 84, 570, 84, 2, glide ? ORANGE : FAINT);
  if (/Gliss/.test(disp(v, "glide_type"))) {
    var steps = 6, pts = [570, 84];
    for (var s = 0; s < steps; s++) { var x0 = 570 + (gx - 570) * s / steps, x1 = 570 + (gx - 570) * (s + 1) / steps, yy = 84 - 16 * (s + 1) / steps; pts.push(x0, yy, x1, yy); }
    g.poly(pts, 2, glide ? ORANGE_LT : FAINT);
  } else g.line(570, 84, gx, 68, 2, glide ? ORANGE_LT : FAINT);
  g.line(gx, 68, 944, 68, 2, glide ? ORANGE : FAINT);
  g.text(944, 86, glide ? (disp(v, "glide_time") || "") : "GLIDE OFF", glide ? INK : FAINT, 1);
  var knobs = FX_KNOBS[type] || ["", "", ""];
  knobRow(g, v, ["Type", on ? knobs[0] : "", on ? knobs[1] : "", on ? knobs[2] : "", "Glide", "Time", "Type", "Mode"],
    [type, disp(v, "effect_param_a"), disp(v, "effect_param_b"), disp(v, "effect_param_c"), disp(v, "glide_enabled"),
      disp(v, "glide_time"), disp(v, "glide_type"), disp(v, "glide_mode")], 100);
}

// ---- pictures (a page's band: 952 x 86) -------------------------------------------------
// the oscillators: where each one sounds, on a ruler of octaves, the FM and the sync between them
function oscScreen(g, v) {
  edge(g);
  var t = v.$touched || "";
  // the pitch ruler, in octaves: osc 1 above it, osc 2 below
  var x0 = 40, W = 600, mid = x0 + W / 2, perOct = W / 8;
  g.fill(x0, 44, W, 1, RULE);
  for (var o = -4; o <= 4; o++) g.fill(mid + o * perOct, 40, 1, 9, o === 0 ? DIM : FAINT);
  g.text(x0 - 8, 48, "-4", FAINT, 1);
  g.text(x0 + W + 8, 48, "+4 OCT", FAINT, -1);
  for (var n = 1; n <= 2; n++) {
    var p = "o" + n + "_", oct = opt(v, p + "octave", ["-4", "-3", "-2", "-1", "0", "+1", "+2", "+3", "+4"]) - 4;
    var semi = num(v, p + "semi", 0), det = num(v, p + "detune", 0) / 64;
    var x = mid + (oct + (semi + det) / 12) * perOct, lit = t.indexOf(p) === 0, c = n === 1 ? ORANGE_LT : CREAM;
    g.fill(x - 1, n === 1 ? 22 : 46, 3, 22, lit ? INK : c);
    g.text(x, n === 1 ? 16 : 82, "OSC " + n, c, 0);
  }
  var fm = frac(v, "o1_fm_amount", 0), sync = disp(v, "o2_sync") === "On";
  g.text(712, 18, "FM", DIM, -1);
  g.fill(750, 11, 190, 6, RULE);
  g.fill(750, 11, 190 * fm, 6, fm > 0 ? ORANGE : FAINT);
  g.text(712, 40, "SYNC", DIM, -1);
  led(g, 764, 36, sync);
  g.text(778, 40, sync ? "OSC 2 TO OSC 1" : "OFF", sync ? INK : FAINT, -1);
  for (var m = 1; m <= 2; m++)
    g.text(712, 52 + m * 14, "OSC " + m + "  " + [disp(v, "o" + m + "_octave"), disp(v, "o" + m + "_semi"), disp(v, "o" + m + "_detune")].join(" / "),
      DIM, -1, 230);
}
// the waves: the table, where each oscillator starts and how far the keys move it
function wavesScreen(g, v) {
  var starts = [startOf(v, "w1_start_w", "1", ORANGE_LT), startOf(v, "w2_start_w", "2", CREAM)];
  g.layer("ws|" + disp(v, "wave_view") + "|" + starts[0].pos + "/" + starts[0].fixed + "|" + starts[1].pos + "/" + starts[1].fixed, function () {
    edge(g);
    wavetable(g, 12, 2, 460, 82, v, starts);
  });
  legend(g, 500, 14, "Wavetable " + (disp(v, "wave") || ""), ORANGE);
  for (var n = 1; n <= 2; n++) {
    var p = "w" + n + "_", y = 26 + (n - 1) * 30, c = n === 1 ? ORANGE_LT : CREAM;
    g.text(500, y + 8, "WAVE " + n, c, -1);
    // the table's 64 positions, the start, and the keys' reach from it
    g.fill(570, y + 4, 256, 2, RULE);
    var st = num(v, p + "start_w", 0) / 63, kt = (frac(v, p + "keytrack", 0.5) - 0.5) * 2;
    g.fill(570 + st * 256 - 1, y - 2, 3, 14, c);
    var reach = Math.max(0, Math.min(1, st + kt * 0.5));
    g.line(570 + st * 256, y + 5, 570 + reach * 256, y + 5, 3, c);
    g.text(944, y + 8, "PHASE " + (disp(v, p + "start_p") || "") + (disp(v, p + "limit") === "On" ? "  LIMIT" : ""), DIM, 1, 110);
  }
  g.text(500, 82, disp(v, "w2_link") === "On" ? "WAVE 2 FOLLOWS WAVE 1" : "", DIM, -1);
}
// the mixer: four sources into the filter, and the digital artefacts it can keep
function mixerScreen(g, v) {
  edge(g);
  g.mix(12, 4, 460, 78, ["mix_w1", "mix_w2", "mix_ring_mod", "mix_noise"]);
  var flags = [["ALIASING", disp(v, "aliasing")], ["QUANTIZE", disp(v, "time_quant")], ["CLIPPING", disp(v, "clipping")],
    ["ACCURACY", disp(v, "accuracy")]];
  legend(g, 500, 14, "The Microwave's grit", ORANGE);
  for (var i = 0; i < flags.length; i++) {
    var y = 30 + i * 15, val = flags[i][1] || "", on = val && val !== "Off" && val !== "Saturate";
    led(g, 506, y - 4, on);
    g.text(518, y, flags[i][0], DIM, -1);
    g.text(640, y, val.toUpperCase(), on ? INK : FAINT, -1);
  }
  var pan = frac(v, "pan", 0.5);
  g.text(760, 30, "PAN", DIM, -1);
  g.fill(760, 40, 180, 2, RULE);
  g.dot(760 + 180 * pan, 41, 5, ORANGE);
}
// a filter's curve, from its type, cutoff and resonance
function filterCurve(type, fc, res) {
  var c = 0.08 + 0.84 * fc, q = res * 0.9;
  return function (x) { // x 0..1 across the spectrum, answer 0..1 (1 = loud)
    var d = (x - c) * 9, peak = q * Math.exp(-d * d * 6), steep = /24/.test(type) ? 3.2 : /6 dB/.test(type) ? 0.9 : 1.8;
    if (/Notch/.test(type)) return Math.max(0, Math.min(1, 0.62 - 0.6 * Math.exp(-d * d * 3) + peak * 0.2));
    if (/BP/.test(type) && !/LP\/BP/.test(type)) return Math.max(0, Math.min(1, 0.7 - Math.abs(x - c) * (steep + 0.8) + peak * 0.4));
    if (/HP/.test(type)) return Math.max(0, Math.min(1, (x > c ? 0.62 : 0.62 - (c - x) * steep) + peak * 0.5));
    return Math.max(0, Math.min(1, (x < c ? 0.62 : 0.62 - (x - c) * steep) + peak * 0.5));
  };
}
function drawFilter(g, x, y, w, h, type, fc, res, c) {
  var f = filterCurve(type, fc, res), pts = [];
  for (var i = 0; i <= 80; i++) pts.push(x + i / 80 * w, y + h - f(i / 80) * h);
  g.area(pts, y + h, c === ORANGE_LT ? ORANGE_GL : ORANGE_DK);
  g.poly(pts, 2, c);
}
function filterScreen(g, v) {
  edge(g);
  var t = v.$touched || "";
  var t1 = disp(v, "f1_type") || "24 dB LP", t2 = disp(v, "f2_type") || "6 dB LP";
  g.fill(12, 2, 560, 82, PANEL);
  legend(g, 20, 16, "Filter 1  " + t1, t.indexOf("f1_") === 0 ? ORANGE_LT : ORANGE);
  g.text(564, 16, "EXTRA " + (disp(v, "f1_extra") || "0"), DIM, 1);
  drawFilter(g, 20, 22, 544, 58, t1, frac(v, "f1_cutoff", 0.5), frac(v, "f1_resonance", 0), t.indexOf("f1_") === 0 ? ORANGE_LT : ORANGE);
  g.line(572, 50, 600, 50, 2, ORANGE);
  g.fill(600, 2, 344, 82, PANEL);
  legend(g, 608, 16, "Filter 2  " + t2, t.indexOf("f2_") === 0 ? ORANGE_LT : ORANGE);
  drawFilter(g, 608, 22, 328, 58, t2, frac(v, "f2_cutoff", 0.5), 0, t.indexOf("f2_") === 0 ? ORANGE_LT : ORANGE);
}
// an LFO: its wave, bent by its symmetry, flat for its delay, slow or fast
function lfoWave(name, sym) {
  var k = 0.5 + sym * 0.45; // where the cycle turns
  switch (name) {
  case "Triangle": return function (t) { return t < k ? -0.9 + 1.8 * t / k : 0.9 - 1.8 * (t - k) / (1 - k); };
  case "Square": return function (t) { return t < k ? 0.9 : -0.9; };
  case "Saw": return function (t) { return 0.9 - 1.8 * t; };
  case "Random": return function (t) { var j = Math.floor(t * 8); return Math.sin(j * 12.9898) * 0.9; };
  case "S&H": return function (t) { var j = Math.floor(t * 4); return Math.sin(j * 78.233 + 1) * 0.9; };
  default: return function (t) { var u = t < k ? t / k * 0.5 : 0.5 + (t - k) / (1 - k) * 0.5; return 0.9 * Math.sin(u * 2 * Math.PI); };
  }
}
function lfoScreen(g, v) {
  edge(g);
  var t = v.$touched || "";
  for (var n = 1; n <= 2; n++) {
    var p = "lfo" + n + "_", x = n === 1 ? 12 : 486, shape = disp(v, p + "shape") || "Sine", lit = t.indexOf(p) === 0;
    var sym = (frac(v, p + "symmetry", 0.5) - 0.5) * 2, f = lfoWave(shape, sym), dl = frac(v, p + "delay", 0) * 0.4;
    var rate = 1 + frac(v, p + "rate", 0.3) * 5, pts = [];
    g.fill(x, 2, 460, 82, PANEL);
    legend(g, x + 8, 16, "LFO " + n + "  " + shape, lit ? ORANGE_LT : ORANGE);
    g.text(x + 452, 16, (disp(v, p + "sync") === "On" ? "SYNC  " : "") + (disp(v, p + "rate") || ""), DIM, 1);
    for (var i = 0; i <= 120; i++) {
      var u = i / 120, a = u < dl ? 0 : Math.min(1, (u - dl) / 0.15 + 0.15);
      pts.push(x + 10 + u * 440, 52 - f((u * rate) % 1) * a * 26);
    }
    g.poly(pts, 2, lit ? INK : ORANGE_LT);
    if (n === 2 && disp(v, "lfo2_phase") && disp(v, "lfo2_phase") !== "Free") g.text(x + 452, 80, "PHASE " + disp(v, "lfo2_phase"), DIM, 1);
  }
}
// the voices: poly or mono, one, two or many per note, and how far apart
function voiceScreen(g, v) {
  edge(g);
  var as = disp(v, "assignment") || "Normal", mono = disp(v, "allocation_mode") === "Mono";
  var n = as === "Unisono" ? 6 : as === "Dual" ? 2 : 1, det = frac(v, "detune", 0), sp = frac(v, "de_pan", 0);
  legend(g, 18, 16, "Voices", ORANGE);
  g.value(18, 50, (mono ? "MONO" : "POLY") + (n > 1 ? " " + as.toUpperCase() : ""), INK, -1, 260);
  for (var i = 0; i < n; i++) {
    var off = n > 1 ? i / (n - 1) - 0.5 : 0, x = 420 + off * 260 * Math.max(det, 0.04) * 2, y = 44 + off * 50 * sp;
    g.fill(x - 2, y - 20, 4, 40, ORANGE);
  }
  g.text(944, 76, "DETUNE " + (disp(v, "detune") || "") + "   DE-PAN " + (disp(v, "de_pan") || ""), DIM, 1, 300);
  g.text(940, 16, "CHORUS " + (disp(v, "chorus_enabled") || "Off").toUpperCase(), DIM, 1);
  g.text(940, 36, "ARP " + (disp(v, "arp_mode") || "Off").toUpperCase(), DIM, 1);
  g.text(940, 56, "VELOCITY " + (disp(v, "amp_velocity") || ""), DIM, 1);
}
// the wave envelope: eight stages, each a time and a level that is a place
// in the table; the key-on loop repeats while a key is held, the key-off
// loop after it is let go
function wenvScreen(g, v) {
  edge(g);
  var t = v.$touched || "", x0 = 20, W = 900, top = 18, H = 56, xs = [x0], ys = [];
  g.text(x0, 12, "WAVE ENVELOPE: WHERE IN THE TABLE, OVER TIME", FAINT, -1);
  var total = 0, times = [];
  for (var i = 1; i <= 8; i++) { times.push(0.06 + frac(v, "wave_env_time" + i, 0)); total += times[i - 1]; }
  var x = x0, pts = [x0, top + H]; // from the start position
  for (var s = 0; s < 8; s++) {
    x += times[s] / total * W;
    var y = top + H - frac(v, "wave_env_level" + (s + 1), 0) * H;
    xs.push(x); ys.push(y);
    pts.push(x, y);
  }
  g.fill(x0, top + H, W, 1, RULE);
  g.area(pts, top + H, ORANGE_DK);
  g.poly(pts, 2, ORANGE_LT);
  for (var k = 0; k < 8; k++) {
    var lit = t === "wave_env_time" + (k + 1) || t === "wave_env_level" + (k + 1);
    g.dot(xs[k + 1], ys[k], lit ? 5 : 3, lit ? INK : ORANGE);
    g.text(xs[k + 1], top + H + 12, String(k + 1), lit ? INK : DIM, 0);
  }
  // the loops, as brackets over the stages they repeat
  function loop(on, a, b, y, c, label) {
    if (!on) return;
    var xa = xs[Math.max(0, a)], xb = xs[Math.min(8, b + 1)];
    g.fill(xa, y, Math.max(2, xb - xa), 2, c);
    g.fill(xa, y, 2, 6, c); g.fill(xb - 2, y, 2, 6, c);
    g.text(xa + 4, y - 2, label, c, -1);
  }
  var LOOP = ["1", "2", "3", "4", "5", "6", "7", "8"];
  loop(disp(v, "wave_key_on_loop") === "On", opt(v, "wave_key_on_loop_start", LOOP), opt(v, "wave_key_on_loop_end", LOOP), 24, ORANGE_LT, "KEY ON");
  loop(disp(v, "wave_key_off_loop") === "On", opt(v, "wave_key_off_loop_start", LOOP), opt(v, "wave_key_off_loop_end", LOOP), 34, CREAM, "KEY OFF");
  g.text(944, 14, (disp(v, "wave_env_trigger") || "").toUpperCase(), DIM, 1);
}
// the matrix: a source reaching a destination, the line as strong as the amount
function slotPair(a) {
  return function (g, v) {
    edge(g);
    var t = v.$touched || "";
    for (var i = 0; i < 2; i++) {
      var n = a + i, p = "slot" + n + "_", y = 8 + i * 42;
      var src = disp(v, p + "source") || "Off", dst = disp(v, p + "destination") || "", f = frac(v, p + "amount", 0.5);
      var amt = Math.abs(f - 0.5) * 2, live = src !== "Off" && amt > 0.01, lit = t.indexOf(p) === 0;
      g.text(18, y + 15, "SLOT " + n, lit ? ORANGE_LT : DIM, -1);
      g.fill(90, y, 260, 24, live ? ORANGE_DK : PANEL);
      g.text(220, y + 16, src.toUpperCase(), live ? INK : FAINT, 0, 250);
      g.line(350, y + 12, 600, y + 12, live ? 1 + amt * 5 : 1, live ? (lit ? ORANGE_LT : ORANGE) : RULE);
      g.fill(600, y, 260, 24, live ? PANEL : GROUND);
      frame(g, 600, y, 260, 24, live ? ORANGE : RULE);
      g.text(730, y + 16, dst.toUpperCase(), live ? INK : FAINT, 0, 250);
      g.text(944, y + 16, live ? disp(v, p + "amount") : "", DIM, 1);
    }
  };
}
// a modifier: two sources, an operation, a parameter
function modifierScreen(a) {
  return function (g, v) {
    edge(g);
    var t = v.$touched || "";
    for (var i = 0; i < 2; i++) {
      var n = a + i, p = "mod" + n + "_", y = 8 + i * 42, lit = t.indexOf(p) === 0;
      g.text(18, y + 16, "MODIFIER " + n, lit ? ORANGE_LT : DIM, -1);
      g.fill(150, y, 250, 24, PANEL);
      g.text(275, y + 16, (disp(v, p + "source1") || "Off").toUpperCase(), INK, 0, 240);
      g.fill(416, y, 120, 24, ORANGE_DK);
      g.text(476, y + 16, (disp(v, p + "type") || "+").toUpperCase(), ORANGE_LT, 0, 116);
      g.fill(552, y, 250, 24, PANEL);
      g.text(677, y + 16, (disp(v, p + "source2") || "Off").toUpperCase(), INK, 0, 240);
      g.text(944, y + 16, "PARAM " + (disp(v, p + "parameter") || "0"), DIM, 1);
    }
  };
}
// the arpeggiator: its clock, its range, and the sixteen steps of its user pattern
function stepKey(i) { return "arp_user_pattern" + (i + 1); }
function arpScreen(first) {
  return function (g, v) {
    edge(g);
    var mode = disp(v, "arp_mode") || "Off", on = mode !== "Off", user = disp(v, "arp_pattern") === "User";
    var len = Math.max(1, num(v, "arp_user_pattern_length", 16)), t = v.$touched || "";
    led(g, 22, 12, on);
    legend(g, 34, 16, "Arpeggiator  " + mode, on ? ORANGE : FAINT);
    g.text(300, 16, user ? "USER PATTERN, " + len + " STEPS" : "PATTERN " + (disp(v, "arp_pattern") || "").toUpperCase() +
      " (THE STEPS ARE THE USER PATTERN'S)", user ? DIM : FAINT, -1, 380);
    // (a tempo the sound holds below the range, 0 in some factory sounds, has no name: it is left out)
    var tempo = disp(v, "arp_tempo"), bpm = tempo === "External" ? "EXT   " : +tempo >= 50 ? tempo + " BPM   " : "";
    g.text(944, 16, (disp(v, "arp_clock") || "") + "   " + bpm + (disp(v, "arp_range") || "1") + " OCT", INK, 1, 260);
    var cw = 57, x0 = 22, y = 32;
    for (var i = 0; i < 16; i++) {
      var x = x0 + i * cw, inPat = i < len, hit = disp(v, stepKey(i)) === "On", lit = first >= 0 && i >= first && i < first + 8;
      var touched = t === stepKey(i), c = !inPat ? FAINT : touched ? INK : hit ? (lit ? ORANGE_LT : ORANGE) : RULE;
      if (lit) g.fill(x - 3, y - 5, cw - 2, 44, PANEL);
      if (hit && inPat) g.fill(x, y, cw - 8, 34, c); else frame(g, x, y, cw - 8, 34, c);
      g.text(x + (cw - 8) / 2, y + 22, String(i + 1), hit && inPat ? GROUND : lit ? ORANGE : FAINT, 0);
    }
  };
}

// ---- the compartments ----------------------------------------------------------------
push.compartment({
  id: "panel", label: "Xenia", front_panel: true, draws_tabs: true,
  pages: PAGES.panel, extra_keys: SOUND,
  screen: function (g, v) {
    frontPanel(g, v);
    tabs(g, v, 157);
    if (waiting(v)) { g.fill(528, 0, 432, 96, GROUND); g.value(744, 54, "WAITING: ANOTHER XENIA PLAYS", ORANGE, 0, 420); }
  }
});
push.compartment({
  id: "osc", label: "Oscillators", extra_keys: ["status"],
  pages: [
    { label: PAGES.osc[0].label, keys: PAGES.osc[0].keys, screen: oscScreen },
    { label: PAGES.osc[1].label, keys: PAGES.osc[1].keys }
  ]
});
push.compartment({
  id: "wave", label: "Waves", extra_keys: ["status", "wave", "wave_view", "w1_start_w", "w2_start_w"],
  pages: [
    { label: PAGES.wave[0].label, keys: PAGES.wave[0].keys, screen: wavesScreen },
    { label: PAGES.wave[1].label, keys: PAGES.wave[1].keys, screen: mixerScreen }
  ]
});
push.compartment({
  id: "filter", label: "Filters", extra_keys: ["status", "f1_cutoff", "f1_resonance"],
  pages: [{ label: PAGES.filter[0].label, keys: PAGES.filter[0].keys, screen: filterScreen }]
});
// the filter, amp and free envelopes: Pung's own envelope, the same as every module's
push.compartment({ id: "env", label: "Envelopes", pages: PAGES.env });
push.compartment({
  id: "lfo", label: "LFOs",
  // each page's picture is both LFOs whole: what the other page edits comes with it
  extra_keys: ["status", "lfo1_shape", "lfo1_rate", "lfo1_delay", "lfo1_sync", "lfo1_symmetry", "lfo2_shape", "lfo2_rate", "lfo2_delay",
    "lfo2_sync", "lfo2_symmetry", "lfo2_phase"],
  pages: PAGES.lfo.map(function (pg) { return { label: pg.label, keys: pg.keys, screen: lfoScreen }; })
});
push.compartment({
  id: "fx", label: "Effect", front_panel: true, draws_tabs: true,
  pages: PAGES.fx, extra_keys: SOUND,
  screen: function (g, v) { fxPanel(g, v); tabs(g, v, 157); }
});
push.compartment({
  id: "voice", label: "Voice", extra_keys: ["status"],
  pages: [
    { label: PAGES.voice[0].label, keys: PAGES.voice[0].keys, screen: voiceScreen },
    { label: PAGES.voice[1].label, keys: PAGES.voice[1].keys }
  ]
});
var WENV_KEYS = [];
for (var wi = 1; wi <= 8; wi++) WENV_KEYS.push("wave_env_time" + wi, "wave_env_level" + wi);
push.compartment({
  id: "wenv", label: "Wave Env",
  extra_keys: ["status", "wave_key_on_loop", "wave_key_on_loop_start", "wave_key_on_loop_end", "wave_key_off_loop",
    "wave_key_off_loop_start", "wave_key_off_loop_end", "wave_env_trigger"].concat(WENV_KEYS),
  pages: PAGES.wenv.map(function (pg) { return { label: pg.label, keys: pg.keys, screen: wenvScreen }; })
});
push.compartment({
  id: "matrix", label: "Matrix", extra_keys: ["status"],
  pages: PAGES.matrix.map(function (pg) {
    var m = /^Modifiers (\d)/.exec(pg.label), s = /^Slots (\d+)/.exec(pg.label);
    return m ? { label: pg.label, keys: pg.keys, screen: modifierScreen(+m[1]) }
      : s ? { label: pg.label, keys: pg.keys, screen: slotPair(+s[1]) } : { label: pg.label, keys: pg.keys };
  })
});
var STEP_KEYS = [];
for (var si = 0; si < 16; si++) STEP_KEYS.push(stepKey(si));
push.compartment({
  id: "arp", label: "Arp",
  extra_keys: ["status", "arp_mode", "arp_clock", "arp_tempo", "arp_range", "arp_pattern", "arp_user_pattern_length"].concat(STEP_KEYS),
  pages: PAGES.arp.map(function (pg) {
    return { label: pg.label, keys: pg.keys, screen: arpScreen(/9-16/.test(pg.label) ? 8 : /1-8/.test(pg.label) ? 0 : -1) };
  })
});
