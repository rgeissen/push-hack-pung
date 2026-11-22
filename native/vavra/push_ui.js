// Vavra (the Waldorf microQ, emulated) on Push.
//
// The microQ is edited through a matrix: seven rows (Oscillators, Mixer,
// Filters, Amp/FX, Envelopes, LFOs, Mod Matrix), each naming what its knobs
// do. So the device opens on that matrix, on the microQ's charcoal with its
// amber legends and red row LEDs, beside its green dot-matrix display: the
// lower buttons light a row, the eight encoders are that row's eight
// parameters, and the display says what the turned one is, as the microQ's
// does. The encoders are the microQ's endless encoders: a rubber cap, a dot
// where the value stands, the value beside it.
//
// Every other page shows its whole section at once, the page's own part lit:
// the three oscillators with their waves and pitches, the five sources'
// levels and where each goes between the two filters, both filters' curves
// and how they are wired, Pung's envelope for each of the four envelopes,
// the three LFOs, all eight slots of a modulation bank, the four modifiers,
// the arpeggiator's run and its sixteen steps. The effects panel names its
// own knobs: what a knob of an effect slot is depends on the effect it holds.
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
var GROUND = "#1f1f20", PANEL = "#2c2c2d", PANEL_HI = "#3a3a3b", RULE = "#4a4641", BEZEL = "#121213";
var AMBER = "#e09b2d", AMBER_LT = "#ffc768", AMBER_DK = "#5c4115", AMBER_GL = "#8a6424";
var INK = "#f1e9d6", DIM = "#a59c8b", MUTE = "#7c756b", FAINT = "#57524c";
var SKIRT = "#0e0e0f", CAP = "#3c3c3e", CAP_TOP = "#29292a";
var LCD_BG = "#3a9a33", LCD_ON = "#10300e", LCD_OFF = "#358f2f", LCD_EDGE = "#1d4a1a";
var LED_ON = "#ff4a2e", LED_OFF = "#4c1b14";

function known(v, k) { return !!(k && v[k] && v[k].known); }
function frac(v, k, neutral) { return known(v, k) ? v[k].frac : (neutral === undefined ? 0 : neutral); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? (d || 0) : n; }
function idx(v, k) { return Math.round(num(v, k, 0)); }
function up(s) { return String(s || "").toUpperCase(); }
function hot(v, k) { return !!k && v.$touched === k; }
function hotIn(v, prefix) { var t = v.$touched || ""; return t !== "" && t.indexOf(prefix) === 0; }
function isOff(s) { return !s || s === "Off" || s === "Bypass"; }
// a value with its unit, as the encoder row says it
function withUnit(v, k) {
  var d = disp(v, k);
  if (!d) return "--";
  var u = v[k].unit || "";
  if (u && d.slice(-u.length) !== u) d += (u === "%" ? "" : " ") + u;
  return d;
}
// "SOURCE AMOUNT" where a source is on, "OFF" where none is
function srcAmt(v, s, a) { var src = disp(v, s); return isOff(src) ? "Off" : src + (a ? " " + (disp(v, a) || "") : ""); }

function led(g, x, y, on) { g.dot(x, y, 3.5, on ? LED_ON : LED_OFF); }
function frame(g, x, y, w, h, c) {
  g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c); g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c);
}
// a section of the panel: a charcoal plate, its name in the microQ's amber;
// lit (an amber edge on top) where the encoders edit it now
function plate(g, x, y, w, h, title, lit, right, rightC) {
  g.fill(x, y, w, h, PANEL);
  if (lit) g.fill(x, y, w, 2, AMBER);
  var rw = right ? Math.min(g.measure(up(right)), w / 2) : 0;
  g.text(x + 8, y + 15, up(title), lit ? AMBER : DIM, -1, w - 24 - rw);
  if (right) g.text(x + w - 8, y + 15, up(right), rightC || (lit ? INK : DIM), 1, w / 2);
}
// a line of "LABEL value" pairs, as the microQ's display lists them; a
// touched one in the slot's colour; what does not fit is left out
function pairs(g, v, x, y, list, maxX, dim) {
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (!p) continue;
    var lab = up(p[0]), val = up(p[1] || "--"), lw = g.measure(lab), vw = g.measure(val);
    if (x + lw + 5 + vw > maxX) break;
    g.text(x, y, lab, dim ? FAINT : MUTE, -1);
    g.text(x + lw + 5, y, val, p[2] && hot(v, p[2]) ? "slot" : dim ? DIM : INK, -1);
    x += lw + vw + 19;
  }
}
// a bar from the middle (a bipolar amount) or from the left
function bar(g, x, y, w, f, bipolar, c, h) {
  h = h || 4;
  g.fill(x, y, w, h, RULE);
  if (bipolar) {
    var m = x + w / 2, e = x + w * f;
    g.fill(Math.min(m, e), y, Math.max(2, Math.abs(e - m)), h, c);
    g.fill(m - 1, y - 2, 2, h + 4, DIM);
  } else if (f > 0) g.fill(x, y, Math.max(2, w * f), h, c);
}

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
// one line of the display: 16 cells of 5 x 7 dots (dot d px, pitch d + 1).
// The unlit dots are columns cut into rows by the gaps (86 fills a line),
// the lit ones dot by dot over them
function lcdLine(g, x, y, s, d) {
  s = String(s || "");
  var pitch = d + 1, cw = 6 * pitch, c, r, col;
  for (c = 0; c < 16; c++)
    for (col = 0; col < 5; col++) g.fill(x + c * cw + col * pitch, y, d, 7 * pitch - 1, LCD_OFF);
  for (r = 1; r < 7; r++) g.fill(x, y + r * pitch - 1, 16 * cw, 1, LCD_BG);
  for (c = 0; c < s.length && c < 16; c++) {
    var ch = s.charAt(c), gl = GLYPH[ch] || GLYPH[ch.toUpperCase()] || GLYPH["?"];
    if (ch === " ") continue;
    for (r = 0; r < 7; r++)
      for (col = 0; col < 5; col++)
        if (gl[r].charAt(col) === "1") g.fill(x + c * cw + col * pitch, y + r * pitch, d, d, LCD_ON);
  }
}
function pad(s, n) { s = String(s || ""); while (s.length < n) s += " "; return s.slice(0, n); }
function padl(s, n) { s = String(s || ""); while (s.length < n) s = " " + s; return s.slice(-n); }
// the display in its bezel, the module's name and what the panel shows under
// it; its second line changes as a knob turns, so it is drawn over the
// panel's layer (display2), not in it
function display(g, l1, caption) {
  g.fill(8, 6, 360, 86, BEZEL);
  g.fill(20, 12, 336, 62, LCD_EDGE);
  g.fill(24, 16, 328, 54, LCD_BG);
  lcdLine(g, 44, 22, l1, 2);
  g.text(22, 87, "VAVRA", AMBER, -1);
  if (caption) g.text(354, 87, up(caption), MUTE, 1, 250);
}
function display2(g, l2) { lcdLine(g, 44, 47, l2, 2); }
function soundLine(v) { return pad(disp(v, "preset_name") || "--", 16); }
function infoLine(v, right) {
  var bank = (disp(v, "bank_name") || "").replace("Bank ", "");
  var n = ("00" + (num(v, "preset", 0) + 1)).slice(-3);
  var left = (bank ? bank.charAt(0) : "-") + n + " " + pad(disp(v, "category"), 4);
  return pad(left, 16 - right.length - 1) + " " + right;
}
// the second line while a knob turns: what it is and where it stands, as the
// microQ's display says it
function touchLine(v, name, value) {
  value = String(value || "--");
  return pad(name, 15 - value.length) + " " + value;
}

// ---- the encoder row a front panel draws itself ------------------------------------------
// The microQ's endless encoders: a rubber cap with a lit dot where the value
// stands, its name in the panel's amber above, the value beside it; the
// turned one in the slot's colour. Under them, the lower buttons as Pung maps
// them (draws_tabs): a page's name, "<" or ">" where the row moves along.
var ROW = 96;
function encoder(g, cx, cy, f, c) {
  g.dot(cx, cy, 14, SKIRT);
  g.dot(cx, cy, 12, CAP);
  g.dot(cx, cy, 9, CAP_TOP);
  if (f === null) return; // no value yet: no position to show
  var a = Math.PI * (0.75 + 1.5 * f);
  g.line(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, 2.5, c);
}
function encoderRow(g, v, names, values) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  g.fill(0, ROW, 960, 1, RULE);
  for (var i = 0; i < 8; i++) {
    var k = knobs[i] || "", x = i * 120, has = !!(k && v[k]);
    var name = names ? names[i] : (has ? v[k].name : "");
    if (!name) continue;
    var on = !!k && k === t;
    var val = values ? (values[i] || "--") : withUnit(v, k);
    if (i > 0) g.fill(x, ROW + 8, 1, 34, PANEL);
    if (on) { g.fill(x + 3, ROW + 3, 114, 42, PANEL_HI); g.fill(x + 3, ROW + 3, 114, 2, "slot"); }
    g.text(x + 60, ROW + 17, up(name), on ? "slot" : AMBER, 0, 110);
    encoder(g, x + 25, ROW + 32, known(v, k) ? v[k].frac : null, on ? "slot" : AMBER_LT);
    g.value(x + 45, ROW + 38, val, on ? "slot" : INK, -1, 70);
  }
}
function tabs(g, v) {
  if (v.$segmode) return; // segment mode: the lower buttons are the segments, and Pung names them
  var ts = v.$tabs || [], cur = v.$tab === undefined ? -1 : v.$tab, y = ROW + 49;
  for (var i = 0; i < 8; i++) {
    var s = ts[i] || "", x = i * 120;
    if (s === "<" || s === ">") {
      var cx = x + 60, d = s === "<" ? -1 : 1;
      g.poly([cx - 4 * d, y + 2, cx + 4 * d, y + 7, cx - 4 * d, y + 12], 2, AMBER);
      continue;
    }
    if (!s) continue;
    var lit = i === cur;
    g.fill(x + 8, y, 104, 14, lit ? AMBER : PANEL);
    g.text(x + 60, y + 11, up(s), lit ? GROUND : DIM, 0, 98);
  }
}

// ---- the front panel: the edit matrix ------------------------------------------------------
// what each matrix row's eight knobs are, as the microQ's panel prints them
var LEGEND = [
  ["Shape", "Octave", "Semi", "Detune", "Shape", "Octave", "Semi", "Detune"],
  ["Osc 1", "Osc 2", "Osc 3", "Noise", "RingMod", "Bal 1", "Bal 2", "Routing"],
  ["Type", "Cutoff", "Reso", "Env", "Type", "Cutoff", "Reso", "Env"],
  ["Volume", "Velo", "FX1", "Mix", "FX2", "Mix", "Glide", "Detune"],
  ["Attack", "Decay", "Sustain", "Release", "Attack", "Decay", "Sustain", "Release"],
  ["Shape", "Speed", "Shape", "Speed", "Shape", "Speed", "Delay 1", "Delay 2"],
  ["Source", "Dest", "Amount", "Source", "Dest", "Amount", "Fast 1", "Fast 2"]
];
// a row's name on the display's second line
var CODE = { "Oscillators": "OSC", "Mixer": "MIX", "Filters": "FILT", "Amp / FX": "AMP", "Envelopes": "ENV", "LFOs": "LFO",
  "Mod Matrix": "MOD" };
var MX = 380, MW = 55; // the matrix: its left edge, a legend column
function legendX(c) { return MX + 132 + Math.floor(c / 2) * 110 + (c % 2) * MW; }
// the matrix rows are the panel's segments (segment mode puts any row under
// the encoders from wherever the pages stand): the segment's row is lit as
// the microQ lights it (Pung's bar above it: 3 px free between the rows)
var SEG_IDS = ["osc", "mixer", "filters", "amp", "env", "lfo", "mod"];
function rowY(r) { return 4 + r * 13; }
function matrixPanel(g, v) {
  var ps = v.$pages || [], t = v.$touched || "", knobs = v.$knobs || [];
  var seg = v.$segmode === "segment" ? SEG_IDS.indexOf(v.$segment || "") : -1;
  var row = seg >= 0 ? seg : (v.$page || 0);
  var ti = t ? knobs.indexOf(t) : -1;
  var l2 = ti >= 0 && v[t] ? touchLine(v, v[t].name, withUnit(v, t)) : infoLine(v, CODE[String(PAGES.panel[row].label)] || "");
  g.layer("panel|" + soundLine(v), function () {
    g.fill(0, 0, 960, 160, GROUND);
    display(g, soundLine(v), "");
    // the four column pairs, ruled apart
    for (var p = 1; p < 4; p++) g.fill(MX + 127 + p * 110, 4, 1, 88, PANEL);
  });
  // over the layer, as they change with the row, the segment and the touch:
  // the caption and the matrix
  g.text(354, 87, up(seg >= 0 ? "Segment " + (seg + 1) + "  " + PAGES.panel[row].label : "Row " + (row + 1) + " of " + (ps.length || 7)), MUTE, 1, 250);
  // the matrix: a LED and a row's name, its eight legends in the encoders' order
  for (var r = 0; r < LEGEND.length; r++) {
    var y = rowY(r), lit = r === row;
    led(g, MX + 8, y + 5, lit);
    if (lit) g.fill(MX + 16, y - 1, 114, 12, AMBER);
    g.text(MX + 21, y + 9, up(PAGES.panel[r].label), lit ? GROUND : DIM, -1, 106);
    for (var c = 0; c < 8; c++) {
      var on = lit && c === ti;
      g.text(legendX(c), y + 9, up(LEGEND[r][c]), on ? "slot" : lit ? AMBER_LT : MUTE, -1, MW - 1);
    }
  }
  display2(g, l2);
  encoderRow(g, v, null, null);
  tabs(g, v);
}

// ---- pictures (a page's band: 952 x 86) -------------------------------------------------
// three plates side by side
var THIRD = 314, THIRDS = [0, 319, 638];

// an oscillator's wave over a box: f(t) for t in 0..1, -1..1, two cycles
function wave(g, x, y, w, h, f, c, width, cycles) {
  var pts = [], n = 96;
  cycles = cycles || 2;
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    pts.push(x + t * w, y + h / 2 - f(t * cycles % 1) * (h / 2 - 1));
  }
  g.poly(pts, width || 2, c);
}
function oscWave(name, pw) {
  pw = 0.5 + 0.9 * (pw - 0.5);
  switch (name) {
  case "Pulse": return function (t) { return t < pw ? 0.9 : -0.9; };
  case "Saw": return function (t) { return 0.9 - 1.8 * t; };
  case "Triangle": return function (t) { return t < 0.5 ? -0.9 + 3.6 * t : 2.7 - 3.6 * t; };
  case "Sine": return function (t) { return 0.9 * Math.sin(t * 2 * Math.PI); };
  default: return function () { return 0; };
  }
}
// one oscillator: its wave (the pulse at its width), its sub an octave
// under it, its pitch, what modulates it
function oscPlate(g, v, m, lit) {
  var p = "o" + m + "_", x = THIRDS[m - 1], w = THIRD;
  var shape = disp(v, p + "shape"), on = !isOff(shape), sync = m === 2 && disp(v, "sync") === "On";
  plate(g, x, 0, w, 86, "Osc " + m, lit, on ? shape : "Off", !on ? FAINT : hot(v, p + "shape") ? "slot" : lit ? INK : DIM);
  if (sync) { led(g, x + 66, 10, true); g.text(x + 74, 15, "SYNC", hot(v, "sync") ? "slot" : AMBER_LT, -1); }
  // the wave
  var wx = x + 8, wy = 24, ww = 172, wh = 40;
  g.fill(wx, wy + wh / 2, ww, 1, RULE);
  var sub = m < 3 ? num(v, p + "sub_volume", 0) / 31 : 0;
  if (on && sub > 0)
    wave(g, wx, wy + wh / 2 - wh * sub / 2, ww, wh * sub, oscWave("Pulse", 0.5), hot(v, p + "sub_volume") ? "slot" : AMBER_GL, 1, 1);
  // Alt 1 and Alt 2 are the microQ's own waves, shaped by the pulse width:
  // no table of them can be read (not in the ROM, not in the DSP's memory),
  // so they are named, never drawn as a guess
  var alt = shape === "Alt 1" || shape === "Alt 2";
  if (on && !alt) wave(g, wx, wy, ww, wh, oscWave(shape, frac(v, p + "pulse_width", 0.5)),
    hot(v, p + "shape") || hot(v, p + "pulse_width") ? "slot" : lit ? AMBER_LT : DIM, 2);
  if (on && alt) g.text(wx + ww / 2, wy + wh / 2 + 4, up(shape) + "  /  PW " + (disp(v, p + "pulse_width") || "--") + " SHAPES IT",
    hot(v, p + "shape") || hot(v, p + "pulse_width") ? "slot" : lit ? AMBER_LT : DIM, 0, ww);
  // the pitch
  var rows = [["Octave", p + "octave"], ["Semi", p + "semi"], ["Detune", p + "detune"]];
  for (var i = 0; i < 3; i++) {
    var y = 32 + i * 16;
    g.text(x + 192, y, up(rows[i][0]), MUTE, -1);
    g.text(x + w - 8, y, disp(v, rows[i][1]) || "--", hot(v, rows[i][1]) ? "slot" : lit ? INK : DIM, 1);
  }
  pairs(g, v, x + 8, 81, [["FM", srcAmt(v, p + "fm_source", p + "fm_amount"), hotIn(v, p + "fm") ? p + "fm_source" : ""],
    ["PWM", srcAmt(v, p + "pwm_source", p + "pwm"), v.$touched === p + "pwm" ? p + "pwm" : p + "pwm_source"]], x + w - 8, !lit);
}
function oscScreen(n) {
  return function (g, v) { for (var m = 1; m <= 3; m++) oscPlate(g, v, m, m === n); };
}
// pitch and voices: how many voices a note takes and how far apart, the
// glide between two notes, what bends the pitch
function unisonCount(s) { return s === "Dual" ? 2 : Math.max(1, parseInt(s, 10) || 1); }
function pitchScreen(g, v) {
  var x = THIRDS[0], w = THIRD;
  var uni = disp(v, "unisono_count"), n = unisonCount(uni), det = frac(v, "unisono_detune", 0);
  var mono = disp(v, "voice_mode") === "On";
  plate(g, x, 0, w, 86, "Voices", true, mono ? "Mono" : "Poly", hot(v, "voice_mode") ? "slot" : INK);
  // the voices a note takes, spread by the unison detune around its pitch
  var cx = x + w / 2, cu = hot(v, "unisono_count") || hot(v, "unisono_detune") ? "slot" : AMBER_LT;
  g.fill(x + 24, 62, w - 48, 1, RULE);
  g.fill(cx, 58, 1, 8, DIM);
  for (var i = 0; i < n; i++) {
    var off = n > 1 ? i / (n - 1) - 0.5 : 0, vx = cx + off * (w - 64) * Math.max(det, 0.03);
    g.fill(Math.round(vx) - 1, 24, 3, 36, cu);
  }
  pairs(g, v, x + 8, 81, [["Unison", isOff(uni) ? "Off" : n + " voices", "unisono_count"], ["Detune", disp(v, "unisono_detune"), "unisono_detune"]], x + w - 8);

  // the glide: from one note to the next, as long as its rate, in steps for a glissando
  x = THIRDS[1];
  var gon = disp(v, "glide_enable") === "On", mode = disp(v, "glide_mode") || "Portamento";
  plate(g, x, 0, w, 86, "Glide", true, gon ? mode : "Off", gon ? INK : FAINT);
  var x0 = x + 20, x1 = x0 + 30, gx = x1 + 12 + frac(v, "glide_rate", 0) * (w - 92), lo = 60, hi = 28;
  var gc = !gon ? FAINT : hot(v, "glide_rate") || hot(v, "glide_mode") ? "slot" : AMBER_LT, pts = [x0, lo, x1, lo];
  if (/Gliss/.test(mode)) {
    for (var s = 1; s <= 7; s++) pts.push(x1 + (gx - x1) * (s - 1) / 7, lo + (hi - lo) * s / 7, x1 + (gx - x1) * s / 7, lo + (hi - lo) * s / 7);
  } else {
    for (var e = 1; e <= 16; e++) { var f = e / 16; pts.push(x1 + (gx - x1) * f, lo + (hi - lo) * (1 - Math.exp(-4 * f)) / (1 - Math.exp(-4))); }
  }
  pts.push(x + w - 20, hi);
  g.poly(pts, 2, gc);
  g.dot(x0, lo, 3, gon ? DIM : FAINT);
  g.dot(x + w - 20, hi, 3, gon ? DIM : FAINT);
  pairs(g, v, x + 8, 81, [["Rate", disp(v, "glide_rate"), "glide_rate"], /Fingered/.test(mode) && gon ? ["Only", "legato notes"] : null], x + w - 8, !gon);

  // what bends the pitch
  x = THIRDS[2];
  var src = disp(v, "pitch_mod_src"), pon = !isOff(src);
  plate(g, x, 0, w, 86, "Pitch Mod", true, pon ? src : "Off", hot(v, "pitch_mod_src") ? "slot" : pon ? INK : FAINT);
  g.text(x + 8, 42, pon ? up(src) + "  >  PITCH" : "NOTHING BENDS THE PITCH", pon ? DIM : FAINT, -1, w - 16);
  bar(g, x + 8, 54, w - 16, frac(v, "pitch_mod_amount", 0.5), true, hot(v, "pitch_mod_amount") ? "slot" : pon ? AMBER : FAINT, 5);
  pairs(g, v, x + 8, 81, [["Amount", disp(v, "pitch_mod_amount"), "pitch_mod_amount"]], x + w - 8, !pon);
}

// the mixer: Pung's faders for the five sources, each over its encoder, and
// under each where it goes between filter 1 and filter 2; beside them how
// the filters are wired
var MIX = [["o1_level", "o1_balance"], ["o2_level", "o2_balance"], ["o3_level", "o3_balance"], ["noise_level", "noise_balance"],
  ["ring_mod_level", "ring_mod_balance"]];
function mixScreen(g, v) {
  g.mix(0, 0, 600, 64, MIX.map(function (m) { return m[0]; }), { color: AMBER });
  for (var i = 0; i < MIX.length; i++) {
    var x = i * 120, lvl = frac(v, MIX[i][0], 0), bal = frac(v, MIX[i][1], 0.5), h = hot(v, MIX[i][1]);
    g.text(x + 14, 82, "1", MUTE, 0);
    g.text(x + 106, 82, "2", MUTE, 0);
    g.fill(x + 24, 77, 72, 2, RULE);
    g.fill(x + 59, 74, 2, 8, FAINT);
    g.dot(x + 24 + 72 * bal, 78, 4.5, h ? "slot" : lvl > 0 ? AMBER_LT : FAINT);
  }
  // the filters, parallel or one into the other
  var x0 = 608, w = 344, serial = disp(v, "filter_routing") === "Serial", rc = hot(v, "filter_routing") ? "slot" : AMBER;
  plate(g, x0, 0, w, 86, "Filter Routing", false, serial ? "Serial" : "Parallel", hot(v, "filter_routing") ? "slot" : INK);
  function box(x, y, s) { g.fill(x, y, 62, 18, PANEL_HI); frame(g, x, y, 62, 18, rc); g.text(x + 31, y + 13, s, INK, 0); }
  if (serial) {
    g.line(x0 + 16, 42, x0 + 68, 42, 2, rc); box(x0 + 68, 33, "F1");
    g.line(x0 + 130, 42, x0 + 164, 42, 2, rc); box(x0 + 164, 33, "F2");
    g.line(x0 + 226, 42, x0 + 300, 42, 2, rc);
  } else {
    g.poly([x0 + 16, 42, x0 + 48, 42, x0 + 48, 30, x0 + 108, 30], 2, rc); box(x0 + 108, 21, "F1");
    g.poly([x0 + 48, 42, x0 + 48, 54, x0 + 108, 54], 2, rc); box(x0 + 108, 45, "F2");
    g.poly([x0 + 170, 30, x0 + 232, 30, x0 + 232, 54, x0 + 170, 54], 2, rc);
    g.line(x0 + 232, 42, x0 + 300, 42, 2, rc);
  }
  g.poly([x0 + 296, 37, x0 + 304, 42, x0 + 296, 47], 2, rc);
  g.text(x0 + w - 8, 46, "OUT", DIM, 1);
  pairs(g, v, x0 + 8, 81, [["Noise > F1", disp(v, "noise_mode_f1"), "noise_mode_f1"], ["F2", disp(v, "noise_mode_f2"), "noise_mode_f2"]], x0 + w - 8);
}

// the two filters: Pung's filter picture (the sound's spectrum behind each
// curve while it plays), in the microQ's amber, and how they are wired
function filterScreen(g, v) {
  var page = v.$page || 0, focus = page < 4 ? (page < 2 ? 1 : 2) : 0, mod = page % 2 === 1;
  var serial = disp(v, "filter_routing") === "Serial", w = 456;
  for (var n = 1; n <= 2; n++) {
    var p = "f" + n + "_", x = n === 1 ? 0 : 496, type = disp(v, p + "type"), on = !!type && !isOff(type), lit = n === focus;
    plate(g, x, 0, w, 86, "Filter " + n, lit, on ? type : "Off", hot(v, p + "type") ? "slot" : on ? (lit ? INK : DIM) : FAINT);
    if (on) g.filter(x + 4, 20, w - 8, 46, { cutoff: p + "cutoff", resonance: p + "resonance", type: p + "type", color: lit ? AMBER : AMBER_GL });
    else g.fill(x + 8, 52, w - 16, 1, FAINT);
    var list = mod
      ? [["Mod", srcAmt(v, p + "mod_source", p + "cutoff_mod"), hotIn(v, p + "mod_source") ? p + "mod_source" : p + "cutoff_mod"],
         ["FM", srcAmt(v, p + "fm_source", p + "fm_amount"), hotIn(v, p + "fm_source") ? p + "fm_source" : p + "fm_amount"],
         ["Pan Mod", srcAmt(v, p + "pan_mod_source", p + "pan_mod"), hotIn(v, p + "pan_mod_source") ? p + "pan_mod_source" : p + "pan_mod"]]
      : [["Env", disp(v, p + "env_mod"), p + "env_mod"], ["Velo", disp(v, p + "vel_mod"), p + "vel_mod"], ["Keys", disp(v, p + "key_track"), p + "key_track"],
         ["Drive", disp(v, p + "drive"), p + "drive"], ["Pan", disp(v, p + "pan"), p + "pan"]];
    pairs(g, v, x + 8, 81, list, x + w - 8, !lit && focus > 0);
  }
  // how the two are wired: filter 1 into filter 2, or side by side
  var rc = hot(v, "filter_routing") ? "slot" : serial ? AMBER : MUTE;
  g.text(476, 30, serial ? "SER" : "PAR", rc, 0);
  if (serial) { g.line(460, 44, 490, 44, 2, rc); g.poly([484, 39, 491, 44, 484, 49], 2, rc); }
  else { g.fill(466, 40, 20, 2, rc); g.fill(466, 48, 20, 2, rc); }
}
// the amplifier: its envelope (Pung's, live), its volume, what else moves it
function ampScreen(g, v) {
  plate(g, 0, 0, 630, 86, "Amp Envelope", false, disp(v, "amp_env_mode") || "", DIM);
  g.envelope(4, 20, 622, 64, envSpec("amp_env_", disp(v, "amp_env_mode") || "ADSR", false));
  var x = 638, w = 314;
  plate(g, x, 0, w, 86, "Amplifier", true);
  g.value(x + 8, 44, disp(v, "amp_volume") || "--", hot(v, "amp_volume") ? "slot" : INK, -1);
  bar(g, x + 60, 36, w - 68, frac(v, "amp_volume", 0), false, hot(v, "amp_volume") ? "slot" : AMBER, 5);
  pairs(g, v, x + 8, 64, [["Velocity", disp(v, "amp_velocity"), "amp_velocity"]], x + w - 8);
  pairs(g, v, x + 8, 81, [["Mod", srcAmt(v, "amp_mod_source", "amp_mod_amount"), hotIn(v, "amp_mod_source") ? "amp_mod_source" : "amp_mod_amount"]], x + w - 8);
}

// the microQ's envelope: Pung's envelope (each note a dot on its clock), in
// the microQ's amber. ADSR is the four named stages; the five-stage modes
// attack to a level, then two decays to two sustains, then release. A
// one-shot or a loop does not run as a held note would: its shape, still.
function envSpec(p, mode, labels) {
  var spec = mode === "ADSR"
    ? { attack: p + "attack", decay: p + "decay", sustain: p + "sustain", release: p + "release" }
    : { time1: p + "attack", level1: p + "attack_level", time2: p + "decay", level2: p + "sustain", time3: p + "decay2",
        level3: p + "sustain2", time4: p + "release" };
  spec.labels = labels !== false;
  spec.color = AMBER;
  spec.still = mode !== "ADSR" && mode !== "ADS1DS2R";
  return spec;
}
var ENV_MODE_SAYS = { "ADSR": "attack, decay, sustain, release", "ADS1DS2R": "two decays to two sustains",
  "One Shot": "runs through, held or not", "Loop S1S2": "loops sustain 1 to 2 held", "Loop All": "loops every stage held" };
function envScreen(label, p) {
  return function (g, v) {
    var mode = disp(v, p + "mode") || "ADSR";
    plate(g, 0, 0, 706, 86, label, true);
    g.envelope(4, 20, 698, 64, envSpec(p, mode));
    var x = 712, w = 240;
    plate(g, x, 0, w, 86, "Mode", true);
    g.value(x + 8, 44, mode.toUpperCase(), hot(v, p + "mode") ? "slot" : INK, -1, w - 16);
    g.text(x + 8, 62, up(ENV_MODE_SAYS[mode] || ""), MUTE, -1, w - 16);
    pairs(g, v, x + 8, 81, [["Trigger", disp(v, p + "trigger_mode"), p + "trigger_mode"]], x + w - 8);
  };
}
// the four envelopes at once, each with how a note starts it
var ENVS = [["Filter Env", "filter_env_"], ["Amp Env", "amp_env_"], ["Env 3", "env3_"], ["Env 4", "env4_"]];
function triggerScreen(g, v) {
  for (var i = 0; i < 4; i++) {
    var p = ENVS[i][1], x = Math.round(i * 239.4), w = 234, mode = disp(v, p + "mode") || "ADSR";
    plate(g, x, 0, w, 86, ENVS[i][0], true, disp(v, p + "trigger_mode") || "--", hot(v, p + "trigger_mode") ? "slot" : INK);
    g.envelope(x + 4, 22, w - 8, 48, envSpec(p, mode, false));
    g.text(x + 8, 82, mode.toUpperCase(), MUTE, -1, w - 16);
  }
}

// the three LFOs: Pung's LFO picture (a flash as a note restarts it, when it
// is key synced), in the microQ's amber; the page's own lit
function lfoPlate(g, v, n, lit) {
  var p = "lfo" + n + "_", x = THIRDS[n - 1], w = THIRD, clocked = disp(v, p + "clocked") === "On";
  plate(g, x, 0, w, 86, "LFO " + n, lit, disp(v, p + "shape") || "--", hot(v, p + "shape") ? "slot" : lit ? INK : DIM);
  g.lfo(x + 4, 20, w - 8, 38, { shape: p + "shape", rate: p + "speed", trig: p + "sync", color: lit ? AMBER : AMBER_GL });
  pairs(g, v, x + 8, 70, [[clocked ? "Clock" : "Speed", disp(v, p + "speed"), p + "speed"], ["Sync", disp(v, p + "sync"), p + "sync"],
    ["Phase", disp(v, p + "start_phase"), p + "start_phase"]], x + w - 8, !lit);
  pairs(g, v, x + 8, 83, [["Delay", disp(v, p + "delay"), p + "delay"], ["Fade", disp(v, p + "fade"), p + "fade"],
    ["Keys", disp(v, p + "key_track"), p + "key_track"]], x + w - 8, !lit);
}
function lfoScreen(n) {
  return function (g, v) { for (var m = 1; m <= 3; m++) lfoPlate(g, v, m, m === n); };
}

// the matrix: all eight slots of a bank, the page's two lit: a source
// reaching a destination, the line as strong as the amount
function slotRow(g, v, x, y, label, src, dst, amt, keys, lit) {
  var on = !isOff(src) && Math.abs(amt - 0.5) > 0.004, a = Math.abs(amt - 0.5) * 2;
  var tc = function (k, c) { return hot(v, k) ? "slot" : c; };
  var txt = on ? (lit ? INK : DIM) : FAINT;
  g.text(x + 10, y + 13, label, lit ? AMBER : MUTE, 0);
  g.fill(x + 22, y, 150, 18, lit ? PANEL_HI : PANEL);
  g.text(x + 97, y + 13, up(src || "Off"), tc(keys[0], txt), 0, 144);
  if (on) {
    var lc = tc(keys[2], lit ? AMBER_LT : AMBER_GL);
    g.line(x + 172, y + 9, x + 256, y + 9, 1 + a * 5, lc);
    g.poly([x + 254, y + 4, x + 261, y + 9, x + 254, y + 14], 2, lc);
  } else g.fill(x + 172, y + 9, 90, 1, RULE);
  g.fill(x + 262, y, 150, 18, lit ? PANEL_HI : PANEL);
  g.text(x + 337, y + 13, up(dst || "--"), tc(keys[1], txt), 0, 144);
  g.text(x + 466, y + 13, on || hot(v, keys[2]) ? (disp(v, keys[2]) || "") : "", tc(keys[2], lit ? INK : DIM), 1);
}
function slotsScreen(kind, first) {
  return function (g, v) {
    for (var n = 1; n <= 8; n++) {
      var p = "slot" + n + "_" + kind, x = n <= 4 ? 0 : 481, y = 2 + ((n - 1) % 4) * 21;
      slotRow(g, v, x, y, String(n), disp(v, p + "source"), disp(v, p + "destination"), frac(v, p + "amount", 0.5),
        [p + "source", p + "destination", p + "amount"], n === first || n === first + 1);
    }
    g.fill(475, 2, 1, 82, PANEL);
  };
}
// the four modifiers: two sources, an operator, a constant; the page's two lit
function modifierScreen(a) {
  return function (g, v) {
    for (var n = 1; n <= 4; n++) {
      var p = "mod" + n + "_", y = 2 + (n - 1) * 21, lit = n === a || n === a + 1;
      var s1 = disp(v, p + "source1") || "Off", s2 = disp(v, p + "source2") || "Off", on = !isOff(s1) || !isOff(s2);
      var txt = on ? (lit ? INK : DIM) : FAINT, tc = function (k, c) { return hot(v, k) ? "slot" : c; };
      g.text(8, y + 13, "MODIFIER " + n, lit ? AMBER : MUTE, -1);
      g.fill(100, y, 250, 18, lit ? PANEL_HI : PANEL);
      g.text(225, y + 13, up(s1), tc(p + "source1", txt), 0, 244);
      g.fill(360, y, 70, 18, lit ? AMBER_DK : PANEL);
      g.text(395, y + 13, up(disp(v, p + "operator") || "+"), tc(p + "operator", lit ? AMBER_LT : DIM), 0, 66);
      g.fill(440, y, 250, 18, lit ? PANEL_HI : PANEL);
      g.text(565, y + 13, up(s2), tc(p + "source2", txt), 0, 244);
      g.text(712, y + 13, "CONSTANT", MUTE, -1);
      bar(g, 790, y + 7, 110, frac(v, p + "constant", 0.5), true, tc(p + "constant", lit ? AMBER : AMBER_GL));
      g.text(944, y + 13, disp(v, p + "constant") || "--", tc(p + "constant", lit ? INK : DIM), 1);
    }
  };
}

// the arpeggiator: its clock and mode, and how it runs through the notes
// held: as many octaves as it spans, in its direction (drawn for three held
// notes, as the picture has to hold some)
function arpRun(dir, m, n) {
  var seq = [], i;
  if (dir === "Down") for (i = m - 1; i >= 0; i--) seq.push(i);
  else if (dir === "Alt Up") { for (i = 0; i < m; i++) seq.push(i); for (i = m - 2; i > 0; i--) seq.push(i); }
  else if (dir === "Alt Down") { for (i = m - 1; i >= 0; i--) seq.push(i); for (i = 1; i < m - 1; i++) seq.push(i); }
  else for (i = 0; i < m; i++) seq.push(i);
  var out = [];
  for (i = 0; i < n; i++) out.push(seq[i % seq.length]);
  return out;
}
function arpScreen(g, v) {
  var mode = disp(v, "arp_mode") || "Off", on = !isOff(mode);
  var x = 0, w = 300;
  plate(g, x, 0, w, 86, "Arpeggiator", true);
  led(g, x + w - 14, 10, on);
  g.value(x + 8, 44, mode.toUpperCase(), hot(v, "arp_mode") ? "slot" : on ? INK : FAINT, -1, w - 16);
  pairs(g, v, x + 8, 66, [["Clock", disp(v, "arp_clock"), "arp_clock"], ["Length", disp(v, "arp_length"), "arp_length"]], x + w - 8, !on);
  pairs(g, v, x + 8, 81, [["Tempo", disp(v, "tempo") ? disp(v, "tempo") + " bpm" : "", "tempo"], ["Notes", disp(v, "arp_max_notes"), "arp_max_notes"]], x + w - 8, !on);

  x = 306; w = 646;
  var oct = Math.max(1, Math.min(10, idx(v, "arp_octave_range") || 1)), dir = disp(v, "arp_direction") || "Up";
  var pat = disp(v, "arp_pattern") || "Off";
  plate(g, x, 0, w, 86, "Run", true, dir + "  " + oct + (oct > 1 ? " octaves" : " octave"),
    hot(v, "arp_direction") || hot(v, "arp_octave_range") ? "slot" : on ? INK : DIM);
  // the octaves as bands, the notes as steps through them
  var top = 22, bot = 66, m = oct * 3, run = arpRun(dir, m, 16), cw = (w - 16) / 16;
  for (var o = 0; o <= oct; o++) g.fill(x + 8, Math.round(bot - (bot - top) * o / oct), w - 16, 1, o === 0 || o === oct ? RULE : PANEL_HI);
  for (var i = 0; i < 16; i++) {
    var y = bot - 3 - (bot - top - 6) * run[i] / Math.max(1, m - 1);
    g.fill(x + 8 + i * cw + 3, Math.round(y) - 1, cw - 6, 4, on ? (i === 0 ? AMBER_LT : AMBER) : FAINT);
  }
  pairs(g, v, x + 8, 81, [["Pattern", pat, "arp_pattern"], ["Order", disp(v, "arp_sort_order"), "arp_sort_order"],
    ["Velocity", disp(v, "arp_velo_mode"), "arp_velo_mode"]], x + w - 120, !on);
  g.text(x + w - 8, 81, "3 NOTES HELD", FAINT, 1);
}

// the user pattern: sixteen steps in a row, the page's eight lit; a step's
// type as its symbol, its accent as height, a glide as a tie to the next,
// its length as width and its timing as a shift
var STEP_SYMBOL = { "Normal": "*", "Pause": "", "Previous": "-", "First": "<", "Last": ">", "First+Last": "<>", "Chord": "CH",
  "Random": "?" };
var STEP_FIELD = { step: "Step Type", accent: "Accent", glide: "Glide", length: "Length", timing: "Timing" };
function stepKey(i, field) { return "arp" + (i < 10 ? "0" : "") + i + "_" + field; }
function stepScreen(first, field) {
  return function (g, v) {
    var len = Math.max(1, idx(v, "arp_pattern_length") || 16), user = disp(v, "arp_pattern") === "User";
    var cw = 50, base = 66;
    for (var i = 0; i < 16; i++) {
      var x = i * cw, lit = i >= first && i < first + 8, inPat = i < len;
      var type = disp(v, stepKey(i, "step")) || "Normal", pause = type === "Pause";
      var acc = idx(v, stepKey(i, "accent")), h = acc === 0 ? 3 : 8 + (acc - 1) * 6;
      var li = idx(v, stepKey(i, "length")), sw = li === 0 ? cw - 4 : Math.min(cw - 10, Math.round((cw - 10) * (0.3 + 0.12 * li)));
      var ti = idx(v, stepKey(i, "timing")), dx = ti === 0 ? 0 : (ti - 4) * 2;
      var th = hot(v, stepKey(i, field));
      var c = !inPat ? FAINT : th ? "slot" : pause ? RULE : lit ? (user ? AMBER_LT : AMBER_GL) : (user ? AMBER_GL : RULE);
      g.fill(x + 1, 0, cw - 2, 86, lit ? PANEL : GROUND);
      if (lit && i === first) g.fill(x + 1, 0, 8 * cw - 2, 2, AMBER);
      if (!pause && inPat) g.fill(x + 6 + dx, base - h, sw, h, c);
      if (pause && inPat) g.fill(x + 6, base - 1, cw - 12, 1, c);
      if (disp(v, stepKey(i, "glide")) === "On" && inPat && !pause) g.fill(x + 6 + dx + sw, base - Math.round(h / 2) - 1, cw - sw - dx - 4, 2, c);
      if (ti === 0 && inPat) g.text(x + cw / 2, base - h - 4, "?", c, 0);
      g.text(x + cw / 2, 16, STEP_SYMBOL[type] !== undefined ? STEP_SYMBOL[type] : "", inPat ? (lit ? INK : DIM) : FAINT, 0);
      g.text(x + cw / 2, 82, String(i + 1), th ? "slot" : lit ? AMBER : inPat ? MUTE : FAINT, 0);
    }
    // the pattern's end
    if (len < 16) g.fill(len * cw - 1, 4, 2, 78, AMBER);
    // what the page edits, and whether the arpeggiator plays this pattern
    var x0 = 808, w = 144;
    plate(g, x0, 0, w, 86, STEP_FIELD[field], true);
    g.text(x0 + 8, 40, user ? "USER PATTERN" : "PATTERN " + up(disp(v, "arp_pattern") || "Off"), user ? INK : DIM, -1, w - 16);
    g.text(x0 + 8, 58, len + " STEPS", hot(v, "arp_pattern_length") ? "slot" : user ? DIM : MUTE, -1, w - 16);
    if (!user) g.text(x0 + 8, 78, "NOT PLAYED", FAINT, -1, w - 16);
  };
}

// ---- the effects: a panel naming its own knobs ---------------------------------------------
function fxPanel(g, v) {
  // which slot and which of its knobs: from the keys on the encoders (a page, or a segment)
  var page = v.$page || 0, t = v.$touched || "", knobs = v.$knobs || [], k0 = knobs[0] || "";
  var fx = /^fx2_/.test(k0) ? 2 : 1, more = k0 === "fx" + fx + "_p7", segOn = v.$segmode === "segment";
  var type = disp(v, "fx" + fx + "_type") || "Bypass", off = isOff(type);
  var labels = disp(v, "fx" + fx + "_labels").split("|"), values = disp(v, "fx" + fx + "_values").split("|");
  var names = [], vals = [], i;
  for (i = 0; i < 8; i++) {
    var k = knobs[i] || "", m = /^fx(\d)_(type|mix|p(\d+))$/.exec(k), nm = "", vl = "";
    if (m && m[2] === "type") { nm = "Type"; vl = disp(v, k) || "Bypass"; }
    else if (m && m[2] === "mix") { nm = off ? "" : "Mix"; vl = disp(v, k); }
    else if (m) { nm = off ? "" : labels[+m[3] - 1] || ""; vl = values[+m[3] - 1] || ""; }
    names.push(nm); vals.push(vl);
  }
  var ti = t ? knobs.indexOf(t) : -1;
  var l2 = ti >= 0 && names[ti] ? touchLine(v, names[ti], vals[ti]) : infoLine(v, more ? "MORE" : "");
  var l1 = pad("FX" + fx + " " + type, 16);
  g.layer("fx|" + page + "|" + fx + "|" + segOn + "|" + l1 + "|" + disp(v, "fx1_type") + "|" + disp(v, "fx2_type"), function () {
    g.fill(0, 0, 960, 160, GROUND);
    display(g, l1, segOn ? "Segment FX " + fx : "Effects  " + (page + 1) + " of 4");
    // both slots, in series: the shown one lit
    for (var s = 1; s <= 2; s++) {
      var st = disp(v, "fx" + s + "_type") || "Bypass", x = 392 + (s - 1) * 288, lit = s === fx;
      g.fill(x, 8, 264, 82, lit ? PANEL_HI : PANEL);
      if (lit && !segOn) g.fill(x, 8, 264, 2, AMBER); // in a segment Pung's bar stands there
      led(g, x + 14, 23, !isOff(st));
      g.text(x + 24, 27, "FX " + s, lit ? AMBER : DIM, -1);
      g.value(x + 14, 56, st.toUpperCase(), isOff(st) ? FAINT : lit ? INK : DIM, -1, 236);
      g.text(x + 14, 81, "MIX", MUTE, -1);
    }
    g.line(658, 49, 676, 49, 2, AMBER_GL);
    g.poly([671, 44, 678, 49, 671, 54], 2, AMBER_GL);
  });
  display2(g, l2);
  // each slot's mix, dry to wet
  for (var q = 1; q <= 2; q++) {
    var qx = 392 + (q - 1) * 288, qoff = isOff(disp(v, "fx" + q + "_type"));
    bar(g, qx + 44, 75, 176, qoff ? 0 : frac(v, "fx" + q + "_mix", 0), false, hot(v, "fx" + q + "_mix") ? "slot" : q === fx ? AMBER : AMBER_GL);
    g.text(qx + 250, 81, qoff ? "" : disp(v, "fx" + q + "_mix"), q === fx ? INK : DIM, 1);
  }
  encoderRow(g, v, names, vals);
  // most effects have six knobs or fewer: the second page is the larger ones' (Vocoder, Five FX, Reverb)
  var any = false;
  for (i = 0; i < 8; i++) if (names[i]) any = true;
  if (!any) g.text(480, ROW + 30, off ? "NO EFFECT IN FX " + fx : type.toUpperCase() + " HAS NO MORE KNOBS", MUTE, 0);
  tabs(g, v);
}

// ---- how its values read ----------------------------------------------------------
// The numbers the engine hands over bare, where the microQ says what they
// mean: a modifier's constant is -64..+63 around its middle, an LFO's start
// phase is free at 0 and otherwise degrees (1..127 of a turn, as the XT's)
push.display(function (key, raw) {
  var n = parseInt(raw, 10);
  if (isNaN(n)) return;
  if (/^mod\d_constant$/.test(key)) return (n > 64 ? "+" : "") + (n - 64);
  if (/^lfo\d_start_phase$/.test(key)) return n === 0 ? "Free" : { value: String(Math.round(n * 360 / 128)), unit: "deg" };
});

// ---- the compartments ----------------------------------------------------------------
var SOUND = ["status", "preset", "preset_name", "bank_name", "category"];
function waiting(v) { return disp(v, "status").indexOf("Waiting") === 0; }
// every key of a section's pages: a screen shows the whole section at once
function keysOf(list) { var out = []; list.forEach(function (pg) { out = out.concat(pg.keys); }); return out; }

// Pung's default pages on the microQ's charcoal, amber legends, its knobs
push.theme({ ground: GROUND, panel: CAP, ink: INK, dim: DIM, rule: RULE, faint: FAINT, accent: AMBER, knob: "pointer" });
push.compartment({
  id: "panel", label: "Vavra", front_panel: true, draws_tabs: true, draws_segments: true,
  pages: PAGES.panel,
  // the matrix rows, each where it sits on the panel, its eight knobs as the legend prints them
  segments: PAGES.panel.map(function (pg, r) {
    return { id: SEG_IDS[r], label: pg.label, rect: [MX + 2, rowY(r) - 1, 960 - MX - 6, 12], keys: pg.keys };
  }),
  extra_keys: SOUND,
  screen: function (g, v) {
    matrixPanel(g, v);
    if (waiting(v)) { g.fill(MX, 2, 960 - MX, 92, GROUND); g.value(MX + (960 - MX) / 2, 54, "WAITING: ANOTHER VAVRA PLAYS", AMBER, 0, 540); }
  }
});
push.compartment({
  id: "osc", label: "Oscillators", extra_keys: ["status", "sync"].concat(keysOf(PAGES.osc)),
  pages: PAGES.osc.map(function (pg, i) {
    return { label: pg.label, keys: pg.keys, screen: i < 6 ? oscScreen(Math.floor(i / 2) + 1) : pitchScreen };
  })
});
push.compartment({
  id: "mixer", label: "Mixer", extra_keys: ["status"].concat(keysOf(PAGES.mixer)),
  pages: PAGES.mixer, screen: mixScreen
});
push.compartment({
  id: "filter", label: "Filters",
  extra_keys: ["status", "filter_routing", "amp_env_attack", "amp_env_attack_level", "amp_env_decay", "amp_env_sustain", "amp_env_decay2",
    "amp_env_sustain2", "amp_env_release", "amp_env_mode"].concat(keysOf(PAGES.filter)),
  pages: PAGES.filter.map(function (pg, i) { return { label: pg.label, keys: pg.keys, screen: i < 4 ? filterScreen : ampScreen }; })
});
push.compartment({
  id: "env", label: "Envelopes", extra_keys: ["status"].concat(keysOf(PAGES.env)),
  pages: [
    { label: PAGES.env[0].label, keys: PAGES.env[0].keys, screen: envScreen("Filter Envelope", "filter_env_") },
    { label: PAGES.env[1].label, keys: PAGES.env[1].keys, screen: envScreen("Amp Envelope", "amp_env_") },
    { label: PAGES.env[2].label, keys: PAGES.env[2].keys, screen: envScreen("Envelope 3", "env3_") },
    { label: PAGES.env[3].label, keys: PAGES.env[3].keys, screen: envScreen("Envelope 4", "env4_") },
    { label: PAGES.env[4].label, keys: PAGES.env[4].keys, screen: triggerScreen }
  ]
});
push.compartment({
  id: "fx", label: "Effects", front_panel: true, draws_tabs: true, draws_segments: true,
  pages: PAGES.fx,
  // the two effect slots, each its tile: its type, its mix, its first six knobs
  segments: [
    { id: "fx1", label: "FX 1", rect: [392, 8, 264, 82], keys: PAGES.fx[0].keys },
    { id: "fx2", label: "FX 2", rect: [680, 8, 264, 82], keys: PAGES.fx[2].keys }
  ],
  extra_keys: SOUND.concat(["fx1_labels", "fx1_values", "fx2_labels", "fx2_values", "fx1_type", "fx2_type", "fx1_mix", "fx2_mix"]),
  screen: fxPanel
});
push.compartment({
  id: "lfo", label: "LFOs", extra_keys: ["status"].concat(keysOf(PAGES.lfo)),
  pages: PAGES.lfo.map(function (pg, i) { return { label: pg.label, keys: pg.keys, screen: lfoScreen(i + 1) }; })
});
var MOD_KEYS = keysOf(PAGES.matrix);
push.compartment({
  id: "matrix", label: "Matrix", extra_keys: ["status"].concat(MOD_KEYS),
  pages: PAGES.matrix.map(function (pg) {
    var f = /^Fast (\d)/.exec(pg.label), s = /^Slots (\d)/.exec(pg.label), m = /^Modifiers (\d)/.exec(pg.label);
    return { label: pg.label, keys: pg.keys, screen: f ? slotsScreen("f", +f[1]) : s ? slotsScreen("s", +s[1]) : modifierScreen(+m[1]) };
  })
});
var STEP_KEYS = [];
for (var si = 0; si < 16; si++) ["step", "accent", "glide", "length", "timing"].forEach(function (f) { STEP_KEYS.push(stepKey(si, f)); });
push.compartment({
  id: "arp", label: "Arp",
  extra_keys: ["status"].concat(PAGES.arp[0].keys, PAGES.arp[1].keys, STEP_KEYS),
  pages: PAGES.arp.map(function (pg, i) {
    var f = /^(\w+) (\d+)-/.exec(pg.label), field = f ? { Steps: "step", Accent: "accent", Glide: "glide", Length: "length", Timing: "timing" }[f[1]] : "";
    return { label: pg.label, keys: pg.keys, screen: i < 2 ? arpScreen : stepScreen(/9-16/.test(pg.label) ? 8 : 0, field) };
  })
});
