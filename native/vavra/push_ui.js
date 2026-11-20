// Vavra (the Waldorf microQ, emulated) on Push.
//
// The microQ is edited through a matrix: seven lit rows (Oscillators, Mixer,
// Filters, Amp/FX, Envelopes, LFOs, Mod Matrix), each naming what its knobs
// do. So the device opens on that matrix, in the microQ's charcoal and amber,
// beside its green dot-matrix display: the lower buttons light a row, and
// the eight encoders are that row's eight parameters.
//
// The other pages go through each section in full, each with the picture of
// what its knobs do together: the oscillators as waves, the mixer as faders
// between the two filters, the filters as their curves and how they are
// wired, the five-stage envelopes as shapes, the LFOs as waves, the matrix as
// sources reaching destinations. The effects panel names its own knobs: what
// a knob of an effect slot is depends on the effect it holds.
// docs/NATIVE-MODULES.md, Vavra.

// <pages> written by tools/gen_params.py from its LAYOUT: do not edit here
var PAGES = {
  panel: [
    { label: "Oscillators", keys: ["o1_shape", "o1_octave", "o1_semi", "o1_detune", "o2_shape", "o2_octave", "o2_semi", "o2_detune"] },
    { label: "Mixer", keys: ["o1_level", "o2_level", "o3_level", "noise_level", "ring_mod_level", "o1_balance", "o2_balance", "filter_routing"] },
    { label: "Filters", keys: ["f1_type", "f1_cutoff", "f1_resonance", "f1_env_mod", "f2_type", "f2_cutoff", "f2_resonance", "f2_env_mod"] },
    { label: "Amp / FX", keys: ["amp_volume", "amp_velocity", "fx1_type", "fx1_mix", "fx2_type", "fx2_mix", "glide_rate", "unisono_detune"] },
    { label: "Envelopes", keys: ["filter_env_attack", "filter_env_decay", "filter_env_sustain", "filter_env_release", "amp_env_attack", "amp_env_decay", "amp_env_sustain", "amp_env_release"] },
    { label: "LFOs", keys: ["lfo1_shape", "lfo1_speed", "lfo2_shape", "lfo2_speed", "lfo3_shape", "lfo3_speed", "lfo1_delay", "lfo2_delay"] },
    { label: "Mod Matrix", keys: ["slot1_ssource", "slot1_sdestination", "slot1_samount", "slot2_ssource", "slot2_sdestination", "slot2_samount", "slot1_famount", "slot2_famount"] }
  ],
  osc: [
    { label: "Osc 1", keys: ["o1_shape", "o1_octave", "o1_semi", "o1_detune", "o1_pulse_width", "o1_pwm", "o1_pwm_source", "o1_key_track"] },
    { label: "Osc 1 FM", keys: ["o1_fm_source", "o1_fm_amount", "o1_sub_freq_div", "o1_sub_volume", "o1_bend_range"] },
    { label: "Osc 2", keys: ["o2_shape", "o2_octave", "o2_semi", "o2_detune", "o2_pulse_width", "o2_pwm", "o2_pwm_source", "o2_key_track"] },
    { label: "Osc 2 FM", keys: ["o2_fm_source", "o2_fm_amount", "o2_sub_freq_div", "o2_sub_volume", "o2_bend_range", "sync"] },
    { label: "Osc 3", keys: ["o3_shape", "o3_octave", "o3_semi", "o3_detune", "o3_pulse_width", "o3_pwm", "o3_pwm_source", "o3_key_track"] },
    { label: "Osc 3 FM", keys: ["o3_fm_source", "o3_fm_amount", "o3_bend_range"] },
    { label: "Pitch / Voice", keys: ["pitch_mod_src", "pitch_mod_amount", "glide_enable", "glide_mode", "glide_rate", "voice_mode", "unisono_count", "unisono_detune"] }
  ],
  mixer: [
    { label: "Mixer", keys: ["o1_level", "o2_level", "o3_level", "noise_level", "ring_mod_level", "noise_mode_f1", "noise_mode_f2", "filter_routing"] },
    { label: "Balance", keys: ["o1_balance", "o2_balance", "o3_balance", "noise_balance", "ring_mod_balance"] }
  ],
  filter: [
    { label: "Filter 1", keys: ["f1_type", "f1_cutoff", "f1_resonance", "f1_drive", "f1_env_mod", "f1_vel_mod", "f1_key_track", "f1_pan"] },
    { label: "Filter 1 Mod", keys: ["f1_mod_source", "f1_cutoff_mod", "f1_fm_source", "f1_fm_amount", "f1_pan_mod_source", "f1_pan_mod"] },
    { label: "Filter 2", keys: ["f2_type", "f2_cutoff", "f2_resonance", "f2_drive", "f2_env_mod", "f2_vel_mod", "f2_key_track", "f2_pan"] },
    { label: "Filter 2 Mod", keys: ["f2_mod_source", "f2_cutoff_mod", "f2_fm_source", "f2_fm_amount", "f2_pan_mod_source", "f2_pan_mod"] },
    { label: "Amp", keys: ["amp_volume", "amp_velocity", "amp_mod_source", "amp_mod_amount"] }
  ],
  env: [
    { label: "Filter Env", keys: ["filter_env_attack", "filter_env_attack_level", "filter_env_decay", "filter_env_sustain", "filter_env_decay2", "filter_env_sustain2", "filter_env_release", "filter_env_mode"] },
    { label: "Amp Env", keys: ["amp_env_attack", "amp_env_attack_level", "amp_env_decay", "amp_env_sustain", "amp_env_decay2", "amp_env_sustain2", "amp_env_release", "amp_env_mode"] },
    { label: "Env 3", keys: ["env3_attack", "env3_attack_level", "env3_decay", "env3_sustain", "env3_decay2", "env3_sustain2", "env3_release", "env3_mode"] },
    { label: "Env 4", keys: ["env4_attack", "env4_attack_level", "env4_decay", "env4_sustain", "env4_decay2", "env4_sustain2", "env4_release", "env4_mode"] },
    { label: "Triggers", keys: ["filter_env_trigger_mode", "amp_env_trigger_mode", "env3_trigger_mode", "env4_trigger_mode"] }
  ],
  fx: [
    { label: "FX 1", keys: ["fx1_type", "fx1_mix", "fx1_p1", "fx1_p2", "fx1_p3", "fx1_p4", "fx1_p5", "fx1_p6"] },
    { label: "FX 1 +", keys: ["fx1_p7", "fx1_p8", "fx1_p9", "fx1_p10", "fx1_p11", "fx1_p12", "fx1_p13", "fx1_p14"] },
    { label: "FX 2", keys: ["fx2_type", "fx2_mix", "fx2_p1", "fx2_p2", "fx2_p3", "fx2_p4", "fx2_p5", "fx2_p6"] },
    { label: "FX 2 +", keys: ["fx2_p7", "fx2_p8", "fx2_p9", "fx2_p10", "fx2_p11", "fx2_p12", "fx2_p13", "fx2_p14"] }
  ],
  lfo: [
    { label: "LFO 1", keys: ["lfo1_shape", "lfo1_speed", "lfo1_sync", "lfo1_clocked", "lfo1_start_phase", "lfo1_delay", "lfo1_fade", "lfo1_key_track"] },
    { label: "LFO 2", keys: ["lfo2_shape", "lfo2_speed", "lfo2_sync", "lfo2_clocked", "lfo2_start_phase", "lfo2_delay", "lfo2_fade", "lfo2_key_track"] },
    { label: "LFO 3", keys: ["lfo3_shape", "lfo3_speed", "lfo3_sync", "lfo3_clocked", "lfo3_start_phase", "lfo3_delay", "lfo3_fade", "lfo3_key_track"] }
  ],
  matrix: [
    { label: "Fast 1-2", keys: ["slot1_fsource", "slot1_fdestination", "slot1_famount", "slot2_fsource", "slot2_fdestination", "slot2_famount"] },
    { label: "Fast 3-4", keys: ["slot3_fsource", "slot3_fdestination", "slot3_famount", "slot4_fsource", "slot4_fdestination", "slot4_famount"] },
    { label: "Fast 5-6", keys: ["slot5_fsource", "slot5_fdestination", "slot5_famount", "slot6_fsource", "slot6_fdestination", "slot6_famount"] },
    { label: "Fast 7-8", keys: ["slot7_fsource", "slot7_fdestination", "slot7_famount", "slot8_fsource", "slot8_fdestination", "slot8_famount"] },
    { label: "Slots 1-2", keys: ["slot1_ssource", "slot1_sdestination", "slot1_samount", "slot2_ssource", "slot2_sdestination", "slot2_samount"] },
    { label: "Slots 3-4", keys: ["slot3_ssource", "slot3_sdestination", "slot3_samount", "slot4_ssource", "slot4_sdestination", "slot4_samount"] },
    { label: "Slots 5-6", keys: ["slot5_ssource", "slot5_sdestination", "slot5_samount", "slot6_ssource", "slot6_sdestination", "slot6_samount"] },
    { label: "Slots 7-8", keys: ["slot7_ssource", "slot7_sdestination", "slot7_samount", "slot8_ssource", "slot8_sdestination", "slot8_samount"] },
    { label: "Modifiers 1-2", keys: ["mod1_source1", "mod1_source2", "mod1_operator", "mod1_constant", "mod2_source1", "mod2_source2", "mod2_operator", "mod2_constant"] },
    { label: "Modifiers 3-4", keys: ["mod3_source1", "mod3_source2", "mod3_operator", "mod3_constant", "mod4_source1", "mod4_source2", "mod4_operator", "mod4_constant"] }
  ],
  arp: [
    { label: "Arp", keys: ["arp_mode", "arp_pattern", "arp_clock", "arp_length", "arp_octave_range", "arp_direction", "arp_sort_order", "arp_velo_mode"] },
    { label: "Arp +", keys: ["tempo", "arp_max_notes", "arp_tfactor", "arp_same_note_overlap", "arp_pattern_reset", "arp_pattern_length"] },
    { label: "Steps 1-8", keys: ["arp00_step", "arp01_step", "arp02_step", "arp03_step", "arp04_step", "arp05_step", "arp06_step", "arp07_step"] },
    { label: "Steps 9-16", keys: ["arp08_step", "arp09_step", "arp10_step", "arp11_step", "arp12_step", "arp13_step", "arp14_step", "arp15_step"] },
    { label: "Accent 1-8", keys: ["arp00_accent", "arp01_accent", "arp02_accent", "arp03_accent", "arp04_accent", "arp05_accent", "arp06_accent", "arp07_accent"] },
    { label: "Accent 9-16", keys: ["arp08_accent", "arp09_accent", "arp10_accent", "arp11_accent", "arp12_accent", "arp13_accent", "arp14_accent", "arp15_accent"] },
    { label: "Glide 1-8", keys: ["arp00_glide", "arp01_glide", "arp02_glide", "arp03_glide", "arp04_glide", "arp05_glide", "arp06_glide", "arp07_glide"] },
    { label: "Glide 9-16", keys: ["arp08_glide", "arp09_glide", "arp10_glide", "arp11_glide", "arp12_glide", "arp13_glide", "arp14_glide", "arp15_glide"] },
    { label: "Length 1-8", keys: ["arp00_length", "arp01_length", "arp02_length", "arp03_length", "arp04_length", "arp05_length", "arp06_length", "arp07_length"] },
    { label: "Length 9-16", keys: ["arp08_length", "arp09_length", "arp10_length", "arp11_length", "arp12_length", "arp13_length", "arp14_length", "arp15_length"] },
    { label: "Timing 1-8", keys: ["arp00_timing", "arp01_timing", "arp02_timing", "arp03_timing", "arp04_timing", "arp05_timing", "arp06_timing", "arp07_timing"] },
    { label: "Timing 9-16", keys: ["arp08_timing", "arp09_timing", "arp10_timing", "arp11_timing", "arp12_timing", "arp13_timing", "arp14_timing", "arp15_timing"] }
  ],
};
// </pages>

// ---- the microQ's colours ----------------------------------------------------------
var GROUND = "#232323", PANEL = "#303030", RULE = "#444240";
var AMBER = "#d89b2c", AMBER_LT = "#f4c360", AMBER_DK = "#5e4316", AMBER_GL = "#7d5a1d";
var INK = "#f1e9d6", DIM = "#a59c8b", FAINT = "#5b5650";
var LCD_BG = "#3a9a33", LCD_ON = "#10300e", LCD_OFF = "#358f2f", LCD_EDGE = "#1d4a1a";
var LED_ON = "#ff4a2e", LED_OFF = "#4c1b14";

function known(v, k) { return v[k] && v[k].known; }
function frac(v, k, neutral) { return known(v, k) ? v[k].frac : (neutral === undefined ? 0 : neutral); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? (d || 0) : n; }
function idx(v, k) { return Math.round(num(v, k, 0)); }

function edge(g, v) { // every page carries the microQ's amber at its left edge
  g.fill(0, 0, 3, g.h, AMBER);
}
function led(g, x, y, on) { g.dot(x, y, 4, on ? LED_ON : LED_OFF); }
function frame(g, x, y, w, h, c) {
  g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c); g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c);
}
function legend(g, x, y, s, c) { g.text(x, y, String(s).toUpperCase(), c || AMBER, -1); }

// ---- the dot-matrix display ------------------------------------------------------------
// The microQ's 2 x 16 characters, 5 x 7 dots each, drawn dot by dot
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
// one line of the display: 16 cells of 5 x 7 dots (dot d px, pitch d + 1)
function lcdLine(g, x, y, s, d) {
  s = String(s || "");
  var pitch = d + 1, cw = 6 * pitch;
  for (var c = 0; c < 16; c++) {
    var ch = c < s.length ? s.charAt(c) : " ", gl = GLYPH[ch] || GLYPH[ch.toUpperCase()] || GLYPH["?"];
    for (var r = 0; r < 7; r++) {
      var row = gl[r];
      for (var col = 0; col < 5; col++)
        g.fill(x + c * cw + col * pitch, y + r * pitch, d, d, row.charAt(col) === "1" ? LCD_ON : LCD_OFF);
    }
  }
}
// the display with its two lines, at (x, y): 16 * 6 * 3 = 288 px wide
function lcd(g, x, y, l1, l2) {
  g.fill(x - 12, y - 10, 312, 66, LCD_EDGE);
  g.fill(x - 8, y - 6, 304, 58, LCD_BG);
  lcdLine(g, x, y, l1, 2);
  lcdLine(g, x, y + 25, l2, 2);
}
function pad(s, n) { s = String(s || ""); while (s.length < n) s += " "; return s.slice(0, n); }
function soundLine(v) { return pad(disp(v, "preset_name"), 16); }
function infoLine(v, right) {
  var bank = (disp(v, "bank_name") || "").replace("Bank ", "");
  var n = ("00" + (num(v, "preset", 0) + 1)).slice(-3);
  var left = (bank ? bank.charAt(0) : "-") + n + " " + pad(disp(v, "category"), 4);
  return pad(left, 16 - right.length - 1) + " " + right;
}

// ---- the encoder row a full-screen page draws itself -----------------------------------
function dial(g, cx, cy, r, f, on, bipolar) {
  g.arc(cx, cy, r, 135, 270, 2, FAINT);
  if (bipolar) {
    var m = 270, a = 135 + 270 * f;
    g.arc(cx, cy, r, Math.min(m, a), Math.abs(a - m) + 1, 3, on ? AMBER_LT : AMBER);
  } else if (f > 0) g.arc(cx, cy, r, 135, 270 * f, 3, on ? AMBER_LT : AMBER);
}
function knobRow(g, v, names, values, y) {
  var knobs = v.$knobs || [], t = v.$touched;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], x = i * 120, on = k && k === t;
    var name = names ? names[i] : (k && v[k] ? v[k].name : "");
    if (!name) continue;
    if (on) g.fill(x + 4, y - 2, 112, 46, AMBER_DK);
    var bip = k && v[k] && /Detune|Semi|Amt|Amount|Env|Pwm|PWM|Velocity|Pan Mod|Mod Amt/.test(v[k].name || "");
    g.text(x + 60, y + 9, String(name).toUpperCase(), on ? AMBER_LT : AMBER, 0, 110);
    dial(g, x + 20, y + 30, 10, frac(v, k, 0), on, bip);
    g.value(x + 36, y + 37, values ? values[i] : (disp(v, k) || "--"), INK, -1, 80);
  }
}
// the lower buttons' names, as Pung's own tabs: a full-screen page hides them
function tabs(g, v, y) {
  var ps = v.$pages || [], cur = v.$page || 0;
  for (var i = 0; i < 8 && i < ps.length; i++) {
    var x = i * 120;
    if (i === cur) g.fill(x + 6, y - 11, 108, 15, AMBER);
    g.text(x + 60, y, String(ps[i]).toUpperCase(), i === cur ? GROUND : DIM, 0, 104);
  }
}

// ---- the front panel: the edit matrix ------------------------------------------------------
// what each matrix row's knob pairs are, as the microQ's panel prints them
var LEGEND = [
  ["Shape  Octave", "Semi  Detune", "Shape  Octave", "Semi  Detune"],
  ["Osc1  Osc2", "Osc3  Noise", "RingMod  Bal1", "Bal2  Routing"],
  ["Type  Cutoff", "Reso  Env", "Type  Cutoff", "Reso  Env"],
  ["Volume  Velo", "FX1 Type  Mix", "FX2 Type  Mix", "Glide  Detune"],
  ["Attack  Decay", "Sustain  Rel", "Attack  Decay", "Sustain  Rel"],
  ["Shape  Speed", "Shape  Speed", "Shape  Speed", "Delay 1  2"],
  ["Src  Dest", "Amount  Src", "Dest  Amount", "Fast 1  2"]
];
// a row's name on the display's second line
var CODE = { "Oscillators": "OSC", "Mixer": "MIX", "Filters": "FILT", "Amp / FX": "AMP", "Envelopes": "ENV", "LFOs": "LFO",
  "Mod Matrix": "MOD" };
function matrixPanel(g, v) {
  var row = v.$page || 0, ps = v.$pages || [];
  var page = String(ps[row] || "").toUpperCase();
  g.layer("panel|" + row + "|" + disp(v, "preset_name") + "|" + disp(v, "category") + "|" + disp(v, "bank_name") + "|" + disp(v, "preset"), function () {
    g.fill(0, 0, 960, 160, GROUND);
    // the display, its gold surround and the name
    g.fill(0, 2, 372, 92, AMBER_GL);
    g.fill(4, 6, 364, 84, PANEL);
    lcd(g, 40, 16, soundLine(v), infoLine(v, CODE[String(ps[row] || "")] || ""));
    g.text(28, 86, "VAVRA", AMBER, -1);
    g.text(84, 86, "MICROQ", FAINT, -1);
    // the matrix
    for (var r = 0; r < LEGEND.length; r++) {
      var y = 4 + r * 13, lit = r === row;
      led(g, 392, y + 6, lit);
      g.fill(402, y, 116, 11, lit ? AMBER : AMBER_DK);
      g.text(406, y + 9, String(ps[r] || "").toUpperCase(), lit ? GROUND : AMBER, -1, 110);
      for (var c = 0; c < 4; c++) g.text(530 + c * 106, y + 9, LEGEND[r][c].toUpperCase(), lit ? AMBER_LT : DIM, -1, 102);
    }
  });
  knobRow(g, v, null, null, 100);
}

// ---- pictures --------------------------------------------------------------------------
// a wave over a box: f(t) for t in 0..1 (two cycles), -1..1
function wave(g, x, y, w, h, f, c, width) {
  var pts = [];
  for (var i = 0; i <= 96; i++) {
    var t = i / 96;
    pts.push(x + t * w, y + h / 2 - f(t * 2 % 1) * (h / 2 - 2));
  }
  g.poly(pts, width || 2, c);
}
function oscWave(name, pw) {
  pw = 0.5 + 0.45 * (pw - 0.5) * 2 * 0.98;
  switch (name) {
  case "Pulse": return function (t) { return t < pw ? 0.9 : -0.9; };
  case "Saw": return function (t) { return 0.9 - 1.8 * t; };
  case "Triangle": return function (t) { return t < 0.5 ? -0.9 + 3.6 * t : 2.7 - 3.6 * t; };
  case "Sine": return function (t) { return 0.9 * Math.sin(t * 2 * Math.PI); };
  case "Alt 1": return function (t) { return 0.9 * (Math.sin(t * 2 * Math.PI) * 0.6 + Math.sin(t * 6 * Math.PI) * 0.4); };
  case "Alt 2": return function (t) { return 0.9 * (Math.sin(t * 2 * Math.PI) * 0.5 + (t < 0.5 ? 0.5 : -0.5)); };
  default: return function () { return 0; };
  }
}
function oscScreen(n) {
  var p = "o" + n + "_";
  return function (g, v) {
    edge(g, v);
    var shape = disp(v, p + "shape") || "Off", on = shape !== "Off", t = v.$touched || "";
    g.fill(10, 4, 440, g.h - 8, PANEL);
    frame(g, 10, 4, 440, g.h - 8, t === p + "shape" || t === p + "pulse_width" ? AMBER : RULE);
    legend(g, 18, 18, "Osc " + n, AMBER);
    g.text(442, 18, shape.toUpperCase(), on ? INK : FAINT, 1);
    wave(g, 20, 22, 420, g.h - 32, oscWave(shape, frac(v, p + "pulse_width", 0.5)), on ? AMBER_LT : FAINT, 2);
    // the pitch, as the microQ's display would say it
    var rows = [["OCTAVE", disp(v, p + "octave")], ["SEMI", disp(v, p + "semi")], ["DETUNE", disp(v, p + "detune")],
      ["KEYS", disp(v, p + "key_track")]];
    for (var i = 0; i < rows.length; i++) {
      g.text(474, 18 + i * 20, rows[i][0], DIM, -1);
      g.value(600, 18 + i * 20, rows[i][1] || "--", INK, -1, 120);
    }
    if (n < 3) {
      var sub = num(v, "o" + n + "_sub_volume", 0);
      g.text(740, 18, "SUB", DIM, -1);
      g.fill(780, 10, 160 * Math.min(1, sub / 31), 8, sub > 0 ? AMBER : FAINT);
      g.text(740, 38, "FM " + (disp(v, p + "fm_source") || "Off").toUpperCase(), DIM, -1, 200);
      g.fill(740, 46, 200, 4, RULE);
      g.fill(740, 46, 200 * frac(v, p + "fm_amount", 0), 4, AMBER);
    }
    g.text(740, 70, "PWM " + (disp(v, p + "pwm_source") || "Off").toUpperCase(), DIM, -1, 200);
  };
}
function pitchScreen(g, v) {
  edge(g, v);
  var uni = disp(v, "unisono_count") || "Off", n = uni === "Off" ? 1 : uni === "Dual" ? 2 : Math.max(1, parseInt(uni, 10) || 1);
  var det = frac(v, "unisono_detune", 0);
  legend(g, 18, 18, "Voices", AMBER);
  g.value(18, 50, (disp(v, "voice_mode") === "On" ? "MONO" : "POLY") + (n > 1 ? " x" + n : ""), INK, -1, 220);
  for (var i = 0; i < n; i++) {
    var off = n > 1 ? i / (n - 1) - 0.5 : 0, x = 360 + off * 240 * det * 2;
    g.fill(x - 2, 20, 4, 66, AMBER);
  }
  g.fill(240, 86, 240, 1, RULE);
  legend(g, 620, 18, "Glide", AMBER);
  g.text(620, 40, disp(v, "glide_enable") === "On" ? (disp(v, "glide_mode") || "").toUpperCase() : "OFF", INK, -1, 300);
  g.fill(620, 50, 300, 4, RULE);
  g.fill(620, 50, 300 * frac(v, "glide_rate", 0), 4, disp(v, "glide_enable") === "On" ? AMBER : FAINT);
  g.text(620, 76, "PITCH MOD " + (disp(v, "pitch_mod_src") || "Off").toUpperCase() + "  " + (disp(v, "pitch_mod_amount") || ""), DIM, -1, 320);
}

// the mixer: five sources, a fader each, between filter 1 and filter 2
var MIX = [["OSC 1", "o1_level", "o1_balance"], ["OSC 2", "o2_level", "o2_balance"], ["OSC 3", "o3_level", "o3_balance"],
  ["NOISE", "noise_level", "noise_balance"], ["RING", "ring_mod_level", "ring_mod_balance"]];
function mixScreen(g, v) {
  edge(g, v);
  var t = v.$touched || "";
  g.text(500, 14, "F1", AMBER, 0);
  g.text(940, 14, "F2", AMBER, 1);
  g.text(18, 14, (disp(v, "filter_routing") || "").toUpperCase() + " ROUTING", DIM, -1);
  var step = Math.floor((g.h - 26) / MIX.length);
  for (var i = 0; i < MIX.length; i++) {
    var y = 20 + i * step, lvl = frac(v, MIX[i][1], 0), bal = frac(v, MIX[i][2], 0.5), lit = t === MIX[i][1] || t === MIX[i][2];
    g.text(18, y + 8, MIX[i][0], lit ? AMBER_LT : DIM, -1);
    g.fill(90, y + 2, 360, 6, RULE);
    g.fill(90, y + 2, 360 * lvl, 6, lit ? AMBER_LT : AMBER);
    // where it goes: filter 1 at the left, filter 2 at the right
    g.fill(500, y + 4, 440, 2, RULE);
    g.dot(500 + 440 * bal, y + 5, lvl > 0 ? 5 : 3, lvl > 0 ? (lit ? AMBER_LT : AMBER) : FAINT);
  }
}

// a filter's curve, from its type, cutoff and resonance
function filterCurve(type, fc, res) {
  var c = 0.08 + 0.84 * fc, q = res * 0.9;
  return function (x) { // x 0..1 across the spectrum, answer 0..1 (1 = loud)
    var d = (x - c) * 9, peak = q * Math.exp(-d * d * 6);
    if (/LP/.test(type)) return Math.max(0, Math.min(1, (x < c ? 0.62 : 0.62 - (x - c) * (/24/.test(type) ? 3.2 : 1.8)) + peak * 0.5));
    if (/HP/.test(type)) return Math.max(0, Math.min(1, (x > c ? 0.62 : 0.62 - (c - x) * (/24/.test(type) ? 3.2 : 1.8)) + peak * 0.5));
    if (/BP/.test(type)) return Math.max(0, Math.min(1, 0.7 - Math.abs(x - c) * (/24/.test(type) ? 4 : 2.4) + peak * 0.4));
    if (/Notch/.test(type)) return Math.max(0, Math.min(1, 0.62 - 0.6 * Math.exp(-d * d * 3) + peak * 0.2));
    if (/Comb/.test(type)) return Math.max(0, Math.min(1, 0.4 + (/\+/.test(type) ? 0.25 : -0.25) * Math.cos(x * 40 * c) + peak * 0.2));
    return 0.62;
  };
}
function drawFilter(g, x, y, w, h, type, fc, res, c) {
  var f = filterCurve(type, fc, res), pts = [];
  for (var i = 0; i <= 80; i++) pts.push(x + i / 80 * w, y + h - f(i / 80) * h);
  g.area(pts, y + h, c === AMBER_LT ? AMBER_GL : AMBER_DK);
  g.poly(pts, 2, c);
}
function filterScreen(g, v) {
  edge(g, v);
  var t = v.$touched || "", serial = disp(v, "filter_routing") === "Serial";
  for (var n = 1; n <= 2; n++) {
    var p = "f" + n + "_", x = n === 1 ? 14 : 500, type = disp(v, p + "type") || "Off", on = type !== "Off";
    var lit = t.indexOf(p) === 0;
    g.fill(x, 4, 440, 80, PANEL);
    legend(g, x + 8, 18, "Filter " + n + "  " + type, on ? (lit ? AMBER_LT : AMBER) : FAINT);
    g.text(x + 432, 18, "DRIVE " + (disp(v, p + "drive") || "0"), DIM, 1);
    if (on) drawFilter(g, x + 8, 24, 424, 56, type, frac(v, p + "cutoff", 0.5), frac(v, p + "resonance", 0), lit ? AMBER_LT : AMBER);
    else g.fill(x + 8, 80, 424, 1, FAINT);
  }
  // how the two are wired
  g.fill(454, 42, 46, 2, serial ? AMBER : FAINT);
  g.text(477, 96, serial ? "SERIAL" : "PARALLEL", serial ? AMBER : DIM, 0);
}
function ampScreen(g, v) {
  edge(g, v);
  legend(g, 18, 18, "Amplifier", AMBER);
  g.value(18, 54, disp(v, "amp_volume") || "--", INK, -1);
  g.fill(120, 40, 600, 8, RULE);
  g.fill(120, 40, 600 * frac(v, "amp_volume", 0), 8, AMBER);
  g.text(120, 74, "VELOCITY " + (disp(v, "amp_velocity") || "") + "    MOD " + (disp(v, "amp_mod_source") || "Off").toUpperCase() + " " +
    (disp(v, "amp_mod_amount") || ""), DIM, -1, 600);
}

// the microQ's envelope: attack to a level, two decays to two sustains, release
function envScreen(label, p) {
  return function (g, v) {
    edge(g, v);
    var t = v.$touched || "", mode = disp(v, p + "mode") || "ADSR", five = mode !== "ADSR";
    // (the attack level and the second decay and sustain are the five-stage modes'; ADSR attacks to the top)
    var a = frac(v, p + "attack"), al = five ? frac(v, p + "attack_level", 1) : 1, d = frac(v, p + "decay"), s = frac(v, p + "sustain");
    var d2 = frac(v, p + "decay2"), s2 = frac(v, p + "sustain2"), r = frac(v, p + "release");
    var x0 = 14, y0 = g.h - 6, H = g.h - 22, W = 820, seg = W / 5;
    var xa = x0 + seg * (0.05 + a), xd = xa + seg * (0.05 + d), xd2 = five ? xd + seg * (0.05 + d2) : xd, xs = xd2 + seg * 0.9;
    var ys2 = five ? s2 : s, xr = xs + seg * (0.05 + r);
    var pts = [x0, y0, xa, y0 - H * al, xd, y0 - H * s];
    if (five) pts.push(xd2, y0 - H * s2);
    pts.push(xs, y0 - H * ys2, xr, y0);
    g.area(pts, y0, AMBER_DK);
    g.poly(pts, 2, AMBER_LT);
    g.fill(x0, y0, W + 10, 1, RULE);
    legend(g, 20, 14, label, AMBER);
    g.text(950, 14, mode.toUpperCase(), INK, 1);
    var st = [["A", xa], ["D", xd], ["S", xs], ["R", xr]];
    if (five) st.splice(2, 0, ["D2", xd2]);
    for (var i = 0; i < st.length; i++) g.text(st[i][1] - 8, y0 - 4, st[i][0], INK, 1);
    var trig = disp(v, p + "trigger_mode");
    if (trig) g.text(950, 34, "TRIGGER " + trig.toUpperCase(), DIM, 1);
  };
}
function triggerScreen(g, v) {
  edge(g, v);
  var envs = [["FILTER ENV", "filter_env_"], ["AMP ENV", "amp_env_"], ["ENV 3", "env3_"], ["ENV 4", "env4_"]];
  for (var i = 0; i < 4; i++) {
    var x = 18 + i * 236;
    legend(g, x, 18, envs[i][0], AMBER);
    g.value(x, 50, (disp(v, envs[i][1] + "trigger_mode") || "--").toUpperCase(), INK, -1, 220);
    g.text(x, 76, (disp(v, envs[i][1] + "mode") || "").toUpperCase(), DIM, -1, 220);
  }
}

// an LFO: its wave, how fast, how it fades in
function lfoWave(name) {
  switch (name) {
  case "Triangle": return function (t) { return t < 0.5 ? -0.9 + 3.6 * t : 2.7 - 3.6 * t; };
  case "Square": return function (t) { return t < 0.5 ? 0.9 : -0.9; };
  case "Saw": return function (t) { return 0.9 - 1.8 * t; };
  case "Random": return function (t) { var k = Math.floor(t * 8); return Math.sin(k * 12.9898) * 0.9; };
  case "S&H": return function (t) { var k = Math.floor(t * 4); return Math.sin(k * 78.233 + 1) * 0.9; };
  default: return function (t) { return 0.9 * Math.sin(t * 2 * Math.PI); };
  }
}
function lfoScreen(n) {
  var p = "lfo" + n + "_";
  return function (g, v) {
    edge(g, v);
    var shape = disp(v, p + "shape") || "Sine", clocked = disp(v, p + "clocked") === "On";
    g.fill(10, 4, 520, g.h - 8, PANEL);
    legend(g, 18, 18, "LFO " + n + "  " + shape, AMBER);
    // the delay as the flat start, the fade as the swell after it
    var dl = frac(v, p + "delay", 0) * 0.4, pts = [];
    for (var i = 0; i <= 120; i++) {
      var t = i / 120, amp = t < dl ? 0 : Math.min(1, (t - dl) / 0.2 + 0.2);
      var f = lfoWave(shape)((t * (1 + frac(v, p + "speed", 0.3) * 5)) % 1);
      pts.push(20 + t * 500, 54 - f * amp * 26);
    }
    g.poly(pts, 2, AMBER_LT);
    g.text(560, 18, clocked ? "CLOCKED" : "FREE", clocked ? AMBER : DIM, -1);
    g.value(560, 50, clocked ? "SYNC " + (disp(v, p + "speed") || "") : (disp(v, p + "speed") || "--"), INK, -1, 380);
    g.text(560, 76, "PHASE " + (disp(v, p + "start_phase") || "") + "   FADE " + (disp(v, p + "fade") || "") +
      "   KEYS " + (disp(v, p + "key_track") || ""), DIM, -1, 390);
  };
}

// the matrix: a source reaching a destination, the line as strong as the amount
function slotPair(kind, a) {
  return function (g, v) {
    edge(g, v);
    var t = v.$touched || "";
    for (var i = 0; i < 2; i++) {
      var n = a + i, p = "slot" + n + "_" + kind, y = 8 + i * 42;
      var src = disp(v, p + "source") || "Off", dst = disp(v, p + "destination") || "", f = frac(v, p + "amount", 0.5);
      var amt = Math.abs(f - 0.5) * 2, live = src !== "Off" && amt > 0.01, lit = t.indexOf(p) === 0;
      g.text(18, y + 10, (kind === "f" ? "FAST " : "SLOT ") + n, lit ? AMBER_LT : DIM, -1);
      g.fill(90, y, 260, 22, live ? AMBER_DK : PANEL);
      g.text(220, y + 15, src.toUpperCase(), live ? INK : FAINT, 0, 250);
      g.line(350, y + 11, 600, y + 11, live ? 1 + amt * 5 : 1, live ? (lit ? AMBER_LT : AMBER) : RULE);
      g.fill(600, y, 260, 22, live ? PANEL : GROUND);
      frame(g, 600, y, 260, 22, live ? AMBER : RULE);
      g.text(730, y + 15, dst.toUpperCase(), live ? INK : FAINT, 0, 250);
      g.text(950, y + 15, live ? disp(v, p + "amount") : "", DIM, 1);
    }
  };
}
function modifierScreen(a) {
  return function (g, v) {
    edge(g, v);
    for (var i = 0; i < 2; i++) {
      var n = a + i, p = "mod" + n + "_", y = 8 + i * 42;
      g.text(18, y + 14, "MODIFIER " + n, DIM, -1);
      g.fill(150, y, 250, 24, PANEL);
      g.text(275, y + 16, (disp(v, p + "source1") || "Off").toUpperCase(), INK, 0, 240);
      g.fill(420, y, 80, 24, AMBER_DK);
      g.value(460, y + 18, disp(v, p + "operator") || "+", AMBER_LT, 0);
      g.fill(520, y, 250, 24, PANEL);
      g.text(645, y + 16, (disp(v, p + "source2") || "Off").toUpperCase(), INK, 0, 240);
      g.text(950, y + 16, "CONST " + (disp(v, p + "constant") || "0"), DIM, 1);
    }
  };
}

// the arpeggiator: its pattern as steps, its clock
function arpScreen(g, v) {
  edge(g, v);
  var mode = disp(v, "arp_mode") || "Off", on = mode !== "Off", oct = idx(v, "arp_octave_range") || 1;
  led(g, 22, 14, on);
  legend(g, 34, 18, "Arpeggiator  " + mode, on ? AMBER : FAINT);
  g.text(950, 18, (disp(v, "arp_clock") || "") + "   " + (disp(v, "tempo") || "") + " BPM", INK, 1);
  // the notes it climbs through: as many octaves as it spans, in its direction
  var dir = disp(v, "arp_direction") || "Up", n = 16;
  for (var i = 0; i < n; i++) {
    var step = i % (oct * 3), h = 10 + step * (54 / Math.max(1, oct * 3));
    if (/Down/.test(dir)) h = 64 - step * (54 / Math.max(1, oct * 3));
    g.fill(30 + i * 56, 88 - h, 40, 4, on ? AMBER : FAINT);
  }
  g.text(30, 100, "PATTERN " + (disp(v, "arp_pattern") || "").toUpperCase() + "   " + dir.toUpperCase() + "   " + oct + " OCT", DIM, -1, 900);
}

// the user pattern: sixteen steps in a row, the page's eight lit; a step's
// type as its symbol, its accent as height, a glide as a tie to the next,
// its length as width and its timing as a shift
var STEP_SYMBOL = { "Normal": "*", "Pause": "", "Previous": "-", "First": "<", "Last": ">", "First+Last": "<>", "Chord": "CH",
  "Random": "?" };
function stepKey(i, field) { return "arp" + (i < 10 ? "0" : "") + i + "_" + field; }
function stepScreen(first) {
  return function (g, v) {
    edge(g, v);
    var len = idx(v, "arp_pattern_length"), user = disp(v, "arp_pattern") === "User", t = v.$touched || "";
    var cw = 50, x0 = 10, base = g.h - 18;
    for (var i = 0; i < 16; i++) {
      var x = x0 + i * cw, lit = i >= first && i < first + 8, inPat = i < len;
      var type = disp(v, stepKey(i, "step")) || "Normal", pause = type === "Pause";
      var acc = idx(v, stepKey(i, "accent")), h = 10 + Math.max(0, acc - 1) * 7;
      var lenIdx = idx(v, stepKey(i, "length")), w = lenIdx === 0 ? cw - 4 : Math.max(8, (cw - 14) * (0.4 + lenIdx * 0.1));
      var tim = idx(v, stepKey(i, "timing")), dx = tim === 0 ? 0 : (tim - 4) * 3;
      var touched = t.indexOf(stepKey(i, "")) === 0;
      var c = !inPat ? FAINT : pause ? RULE : touched ? AMBER_LT : lit ? AMBER : AMBER_GL;
      if (lit) g.fill(x, 2, cw - 2, base + 14, PANEL);
      if (!pause) g.fill(x + 4 + dx, base - h, w, h, c);
      if (disp(v, stepKey(i, "glide")) === "On" && inPat) g.line(x + 4 + dx + w, base - h / 2, x + cw + 4, base - h / 2, 2, c);
      g.text(x + cw / 2, 14, STEP_SYMBOL[type] !== undefined ? STEP_SYMBOL[type] : "", inPat ? INK : FAINT, 0);
      g.text(x + cw / 2, base + 12, String(i + 1), lit ? AMBER : FAINT, 0);
    }
    // whether the arpeggiator plays this pattern at all
    g.text(950, 18, user ? "USER" : "PATTERN", user ? AMBER : DIM, 1, 140);
    g.text(950, 34, user ? "PATTERN" : (disp(v, "arp_pattern") || "").toUpperCase(), user ? AMBER : DIM, 1, 140);
    if (!user) g.text(950, 50, "NOT USED", FAINT, 1, 140);
    g.text(950, 70, len + " STEPS", DIM, 1, 140);
  };
}

// ---- the effects: a panel naming its own knobs ---------------------------------------------
function fxPanel(g, v) {
  var page = v.$page || 0, ps = v.$pages || [], fx = page < 2 ? 1 : 2, more = page % 2 === 1;
  var type = disp(v, "fx" + fx + "_type") || "Bypass";
  var labels = disp(v, "fx" + fx + "_labels").split("|"), values = disp(v, "fx" + fx + "_values").split("|");
  g.layer("fx|" + page + "|" + type + "|" + disp(v, "preset_name"), function () {
    g.fill(0, 0, 960, 160, GROUND);
    g.fill(0, 2, 372, 92, AMBER_GL);
    g.fill(4, 6, 364, 84, PANEL);
    lcd(g, 40, 16, pad("FX " + fx + " " + type, 16), infoLine(v, more ? "MORE" : ""));
    g.text(28, 86, "VAVRA", AMBER, -1);
    g.text(84, 86, "EFFECTS", FAINT, -1);
    // both slots, the shown one lit
    for (var s = 1; s <= 2; s++) {
      var t = disp(v, "fx" + s + "_type") || "Bypass", x = 400 + (s - 1) * 280, lit = s === fx;
      g.fill(x, 14, 260, 64, lit ? AMBER_DK : PANEL);
      frame(g, x, 14, 260, 64, lit ? AMBER : RULE);
      led(g, x + 14, 28, t !== "Bypass");
      g.text(x + 26, 32, "FX " + s, lit ? AMBER_LT : DIM, -1);
      g.value(x + 14, 64, t.toUpperCase(), t === "Bypass" ? FAINT : INK, -1, 236);
    }
  });
  var names = [], vals = [];
  if (!more) {
    names.push("Type", "Mix");
    vals.push(type, disp(v, "fx" + fx + "_mix"));
    for (var i = 0; i < 6; i++) { names.push(labels[i] || ""); vals.push(values[i] || ""); }
  } else {
    for (var j = 6; j < 14; j++) { names.push(labels[j] || ""); vals.push(values[j] || ""); }
  }
  knobRow(g, v, names, vals, 100);
  tabs(g, v, 157);
}

// ---- the compartments ----------------------------------------------------------------
var SOUND = ["status", "preset", "preset_name", "bank_name", "category"];
function waiting(v) { return disp(v, "status").indexOf("Waiting") === 0; }

push.compartment({
  id: "panel", label: "Vavra", front_panel: true,
  pages: PAGES.panel,
  extra_keys: SOUND,
  screen: function (g, v) {
    matrixPanel(g, v);
    tabs(g, v, 157);
    if (waiting(v)) { g.fill(392, 4, 556, 90, GROUND); g.value(670, 54, "WAITING: ANOTHER VAVRA PLAYS", AMBER, 0, 540); }
  }
});
var OSC_KEYS = [];
for (var on_ = 1; on_ <= 3; on_++)
  ["shape", "octave", "semi", "detune", "pulse_width", "key_track", "fm_source", "fm_amount", "pwm_source", "sub_volume"].forEach(function (k) {
    if (on_ < 3 || k !== "sub_volume") OSC_KEYS.push("o" + on_ + "_" + k);
  });
push.compartment({
  id: "osc", label: "Oscillators", extra_keys: ["status"].concat(OSC_KEYS),
  pages: [
    { label: PAGES.osc[0].label, keys: PAGES.osc[0].keys, screen: oscScreen(1) },
    { label: PAGES.osc[1].label, keys: PAGES.osc[1].keys, screen: oscScreen(1) },
    { label: PAGES.osc[2].label, keys: PAGES.osc[2].keys, screen: oscScreen(2) },
    { label: PAGES.osc[3].label, keys: PAGES.osc[3].keys, screen: oscScreen(2) },
    { label: PAGES.osc[4].label, keys: PAGES.osc[4].keys, screen: oscScreen(3) },
    { label: PAGES.osc[5].label, keys: PAGES.osc[5].keys, screen: oscScreen(3) },
    { label: PAGES.osc[6].label, keys: PAGES.osc[6].keys, screen: pitchScreen }
  ]
});
push.compartment({
  id: "mixer", label: "Mixer", extra_keys: ["status", "filter_routing", "o1_level", "o2_level", "o3_level", "noise_level", "ring_mod_level",
    "o1_balance", "o2_balance", "o3_balance", "noise_balance", "ring_mod_balance"],
  pages: PAGES.mixer, screen: mixScreen
});
push.compartment({
  id: "filter", label: "Filters", extra_keys: ["status", "f1_type", "f1_cutoff", "f1_resonance", "f1_drive", "f2_type", "f2_cutoff",
    "f2_resonance", "f2_drive", "filter_routing"],
  pages: [
    { label: PAGES.filter[0].label, keys: PAGES.filter[0].keys, screen: filterScreen },
    { label: PAGES.filter[1].label, keys: PAGES.filter[1].keys, screen: filterScreen },
    { label: PAGES.filter[2].label, keys: PAGES.filter[2].keys, screen: filterScreen },
    { label: PAGES.filter[3].label, keys: PAGES.filter[3].keys, screen: filterScreen },
    { label: PAGES.filter[4].label, keys: PAGES.filter[4].keys, screen: ampScreen }
  ]
});
push.compartment({
  id: "env", label: "Envelopes", extra_keys: ["status", "filter_env_trigger_mode", "amp_env_trigger_mode", "env3_trigger_mode",
    "env4_trigger_mode", "filter_env_mode", "amp_env_mode", "env3_mode", "env4_mode"],
  pages: [
    { label: PAGES.env[0].label, keys: PAGES.env[0].keys, screen: envScreen("Filter Envelope", "filter_env_") },
    { label: PAGES.env[1].label, keys: PAGES.env[1].keys, screen: envScreen("Amp Envelope", "amp_env_") },
    { label: PAGES.env[2].label, keys: PAGES.env[2].keys, screen: envScreen("Envelope 3", "env3_") },
    { label: PAGES.env[3].label, keys: PAGES.env[3].keys, screen: envScreen("Envelope 4", "env4_") },
    { label: PAGES.env[4].label, keys: PAGES.env[4].keys, screen: triggerScreen }
  ]
});
push.compartment({
  id: "fx", label: "Effects", front_panel: true,
  pages: PAGES.fx,
  extra_keys: ["status", "preset", "preset_name", "bank_name", "category", "fx1_labels", "fx1_values", "fx2_labels", "fx2_values"],
  screen: fxPanel
});
push.compartment({
  id: "lfo", label: "LFOs", extra_keys: ["status"],
  pages: [
    { label: PAGES.lfo[0].label, keys: PAGES.lfo[0].keys, screen: lfoScreen(1) },
    { label: PAGES.lfo[1].label, keys: PAGES.lfo[1].keys, screen: lfoScreen(2) },
    { label: PAGES.lfo[2].label, keys: PAGES.lfo[2].keys, screen: lfoScreen(3) }
  ]
});
push.compartment({
  id: "matrix", label: "Matrix", extra_keys: ["status"],
  pages: [
    { label: PAGES.matrix[0].label, keys: PAGES.matrix[0].keys, screen: slotPair("f", 1) },
    { label: PAGES.matrix[1].label, keys: PAGES.matrix[1].keys, screen: slotPair("f", 3) },
    { label: PAGES.matrix[2].label, keys: PAGES.matrix[2].keys, screen: slotPair("f", 5) },
    { label: PAGES.matrix[3].label, keys: PAGES.matrix[3].keys, screen: slotPair("f", 7) },
    { label: PAGES.matrix[4].label, keys: PAGES.matrix[4].keys, screen: slotPair("s", 1) },
    { label: PAGES.matrix[5].label, keys: PAGES.matrix[5].keys, screen: slotPair("s", 3) },
    { label: PAGES.matrix[6].label, keys: PAGES.matrix[6].keys, screen: slotPair("s", 5) },
    { label: PAGES.matrix[7].label, keys: PAGES.matrix[7].keys, screen: slotPair("s", 7) },
    { label: PAGES.matrix[8].label, keys: PAGES.matrix[8].keys, screen: modifierScreen(1) },
    { label: PAGES.matrix[9].label, keys: PAGES.matrix[9].keys, screen: modifierScreen(3) }
  ]
});
var STEP_KEYS = [];
for (var si = 0; si < 16; si++) ["step", "accent", "glide", "length", "timing"].forEach(function (f) { STEP_KEYS.push(stepKey(si, f)); });
push.compartment({
  id: "arp", label: "Arp",
  extra_keys: ["status", "tempo", "arp_clock", "arp_mode", "arp_direction", "arp_octave_range", "arp_pattern", "arp_pattern_length"]
    .concat(STEP_KEYS),
  pages: PAGES.arp.map(function (pg, i) {
    return { label: pg.label, keys: pg.keys, screen: i < 2 ? arpScreen : stepScreen(/9-16/.test(pg.label) ? 8 : 0) };
  })
});
