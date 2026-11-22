// Xenia (the Waldorf Microwave II/XT, emulated) on Push.
//
// The Microwave is a wavetable synth: a sound is a path through a table of
// 64 wave positions, and what the panel is about is where in the table each
// oscillator starts and how the envelopes move it. So the device opens on
// the XT's orange body: its 2 x 40 dot-matrix display, the table itself in a
// dark window, drawn from the real waves the synth holds (wave_view: the
// engine asks the synth for the sound's table and its waves, as the
// Microwave's own editors do), the two start positions lit, and under them
// the panel's eight knobs: black pointer knobs on the orange, their legends
// printed, each value in a small window. The display says what a turned knob
// is, as the XT's does.
//
// The other pages show their whole section at once, the page's part lit:
// the oscillators' pitches, the table with its keytracking, the mixer and
// the XT's digital character, the two filters in series, the LFOs, the
// free envelope and the wave envelope (Pung's envelope), the voices, eight
// of the sixteen modulation slots, the four modifiers, the arpeggiator's
// sixteen steps. The effect panel names its own knobs: what A, B and C are
// depends on the effect. The filter and amp envelopes are Pung's own
// envelope on its default pages (UX-GUIDELINES.md, Envelopes).
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

// ---- the XT's colours ------------------------------------------------------------------
var BODY = "#d4740f", BODY_DK = "#a85a0b", SILK = "#2b1606";             // the orange body, its printing
var WINDOW = "#1a120c", KNOB = "#2a221d", SKIRT = "#120c08";             // the dark window, the knobs
var PANEL = "#2a1f17", PANEL_HI = "#3a2b20", RULE = "#4d3c2e", GROUND = "#140e0a";
var ORANGE = "#e07e18", ORANGE_LT = "#ffa64a", ORANGE_DK = "#6a3a0c", ORANGE_GL = "#a3560c";
var CREAM = "#f0dfb8", INK = "#f3e7d9", DIM = "#a89886", MUTE = "#7e7064", FAINT = "#574b41";
var BROWN = "#3b2414", BROWN_LT = "#5a3a22";
var LCD_BG = "#8fb43a", LCD_ON = "#1c2a0b", LCD_OFF = "#86aa36";
var LED_ON = "#ff5a26", LED_OFF = "#4a1d10";

function known(v, k) { return !!(k && v[k] && v[k].known); }
function frac(v, k, neutral) { return known(v, k) ? v[k].frac : (neutral === undefined ? 0 : neutral); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? (d || 0) : n; }
function idx(v, k) { return Math.round(num(v, k, 0)); }
// a value as the engine names it, as an option index into a list (an enum's display is its name)
function opt(v, k, list) { var s = disp(v, k), i = list.indexOf(s); return i < 0 ? 0 : i; }
function up(s) { return String(s || "").toUpperCase(); }
function hot(v, k) { return !!k && v.$touched === k; }
function hotIn(v, prefix) { var t = v.$touched || ""; return t !== "" && t.indexOf(prefix) === 0; }
function isOff(s) { return !s || s === "Off"; }
function withUnit(v, k) {
  var d = disp(v, k);
  if (!d) return "--";
  var u = v[k].unit || "";
  if (u && d.slice(-u.length) !== u) d += (u === "%" ? "" : " ") + u;
  return d;
}
function pad(s, n) { s = String(s || ""); while (s.length < n) s += " "; return s.slice(0, n); }
function padl(s, n) { s = String(s || ""); while (s.length < n) s = " " + s; return s.slice(-n); }

function led(g, x, y, on) { g.dot(x, y, 3.5, on ? LED_ON : LED_OFF); }
function frame(g, x, y, w, h, c) {
  g.fill(x, y, w, 1, c); g.fill(x, y + h - 1, w, 1, c); g.fill(x, y, 1, h, c); g.fill(x + w - 1, y, 1, h, c);
}
// a section: a dark plate under an orange legend plate, as the XT prints its
// sections; the one the encoders edit now in full orange
function plate(g, x, y, w, h, title, lit, right, rightC) {
  g.fill(x, y, w, h, PANEL);
  var s = up(title), tw = g.measure(s) + 14;
  g.fill(x, y, tw, 15, lit ? ORANGE : ORANGE_DK);
  g.text(x + 7, y + 12, s, lit ? GROUND : ORANGE, -1);
  if (lit) g.fill(x + tw, y, w - tw, 1, ORANGE);
  if (right) g.text(x + w - 8, y + 12, up(right), rightC || (lit ? INK : DIM), 1, w - tw - 16);
}
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
function bar(g, x, y, w, f, bipolar, c, h) {
  h = h || 4;
  g.fill(x, y, w, h, RULE);
  if (bipolar) {
    var m = x + w / 2, e = x + w * f;
    g.fill(Math.min(m, e), y, Math.max(2, Math.abs(e - m)), h, c);
    g.fill(m - 1, y - 2, 2, h + 4, DIM);
  } else if (f > 0) g.fill(x, y, Math.max(2, w * f), h, c);
}

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
// the display in its dark surround, on the orange: 480 x 32 px of characters.
// Its second line changes as a knob turns: it is drawn over the panel's
// layer (lcd2), not in it
var LX = 26, LY = 20;
function lcd(g, l1) {
  g.fill(LX - 14, LY - 12, 508, 60, BROWN);
  g.fill(LX - 10, LY - 8, 500, 52, BROWN_LT);
  g.fill(LX - 8, LY - 6, 496, 48, LCD_BG);
  lcdLine(g, LX, LY, l1);
}
function lcd2(g, l2) { lcdLine(g, LX, LY + 19, l2); }
// "A001 CS-80 T&WMF" as the XT shows a sound: bank letter, number, name
function soundTitle(v) {
  var bank = (disp(v, "bank_name") || "").replace("Bank ", "");
  var n = ("00" + (num(v, "preset", 0) + 1)).slice(-3);
  return (bank ? bank.charAt(0) : "-") + n + " " + pad(disp(v, "preset_name"), 16);
}
// the display's second line while a knob turns: what it is, where it stands
function touchLine(name, value) { return pad(up(name), 22) + padl(value || "--", 18); }

// ---- the orange body and its knob row -------------------------------------------------------
// The XT's knobs: black pointer knobs on the orange, a printed scale around
// each and its legend above, the value in a small dark window beside it; the
// turned one in the slot's colour. The lower buttons as Pung maps them
// (draws_tabs): a page's name, "<" or ">" where the row moves along.
var ROW = 96;
// a knob's name: the effect's A, B and C by the effect (FX_KNOBS), else the module's
function knobName(v, k) {
  if (!k || !v[k]) return "";
  var m = /^effect_param_([abc])$/.exec(k);
  if (m) { var n = (FX_KNOBS[disp(v, "effect_type")] || [])["abc".indexOf(m[1])]; return n || ""; }
  return v[k].name;
}
// in segment mode Pung names the segments in the bottom 18 px: the knobs move up clear of it
function lift(v) { return v.$segmode ? -4 : 0; }
// the row's printing: the legends, each knob's scale, its value window, the
// lower buttons. Drawn over the panel's layer, not in it: a page turn or a
// segment changes it, and a layer redrawn would cost the whole display again
function bodyRow(g, v, names) {
  var knobs = v.$knobs || [];
  g.fill(0, ROW, 960, 64, BODY);
  g.fill(0, ROW, 960, 1, BODY_DK);
  for (var i = 0; i < 8; i++) {
    var k = knobs[i] || "", x = i * 120, name = names ? names[i] : knobName(v, k);
    if (i > 0) g.fill(x, ROW + 8, 1, 38, BODY_DK);
    if (!name) continue;
    g.text(x + 60, ROW + 14, up(name), SILK, 0, 110);
    var cx = x + 26, cy = ROW + 34 + lift(v);
    g.arc(cx, cy, 17, Math.PI * 0.75, Math.PI * 1.5, 1.5, SILK);
    for (var d = 0; d <= 2; d++) {
      var a = Math.PI * (0.75 + 0.75 * d);
      g.dot(cx + Math.cos(a) * 17, cy + Math.sin(a) * 17, 2, SILK);
    }
    g.fill(x + 48, ROW + 24 + lift(v), 68, 20, WINDOW);
  }
  if (v.$segmode) return; // segment mode: the lower buttons are the segments, and Pung names them
  var ts = v.$tabs || [], cur = v.$tab === undefined ? -1 : v.$tab, y = ROW + 50;
  for (var j = 0; j < 8; j++) {
    var s = ts[j] || "", tx = j * 120;
    if (s === "<" || s === ">") {
      var c = tx + 60, dd = s === "<" ? -1 : 1;
      g.poly([c - 4 * dd, y + 1, c + 4 * dd, y + 6, c - 4 * dd, y + 11], 2, SILK);
      continue;
    }
    if (!s) continue;
    var lit = j === cur;
    g.fill(tx + 8, y, 104, 13, lit ? WINDOW : BODY_DK);
    g.text(tx + 60, y + 10, up(s), lit ? ORANGE_LT : SILK, 0, 98);
  }
}
// what moves: the knobs' pointers and values, the touched one
function knobRow(g, v, names, values) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i] || "", x = i * 120, name = names ? names[i] : knobName(v, k);
    if (!name) continue;
    var on = !!k && k === t, cx = x + 26, cy = ROW + 34 + lift(v);
    if (on) {
      g.fill(x + 4, ROW + 3, 112, 14, WINDOW);
      g.text(x + 60, ROW + 14, up(name), "slot", 0, 108);
    }
    g.dot(cx, cy, 13, SKIRT);
    g.dot(cx, cy, 11, KNOB);
    if (known(v, k)) {
      var a = Math.PI * (0.75 + 1.5 * v[k].frac);
      g.line(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, 2.5, on ? "slot" : CREAM);
    }
    g.value(x + 82, ROW + 40 + lift(v), values ? (values[i] || "--") : withUnit(v, k), on ? "slot" : CREAM, 0, 64);
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
  var rh = h / 3, a = rh / 2 - 5;
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
// the starts at position i: their labels together ("1 2" where both start
// on the same wave) and the first one's colour; null where none does
function startsAt(starts, i) {
  var label = "", color = null;
  for (var s = 0; s < starts.length; s++) if (starts[s].pos === i) { label = label ? label + " " + starts[s].label : starts[s].label; color = color || starts[s].color; }
  return color ? { label: label, color: color } : null;
}
// the landscape over a ground of colour bg (each wave hides what is behind it in that colour)
function wavetable(g, x, y, w, h, v, starts, bg) {
  fixedWaves(g, x + w - 38, y, h, starts);
  g.fill(x + w - 46, y + 4, 1, h - 8, RULE);
  w -= 52;
  var raw = disp(v, "wave_view"), waves = parseWaves(raw);
  var n = 16, dx = Math.floor((w * 0.42) / (n - 1)), dy = (h * 0.5) / (n - 1), ww = w - dx * (n - 1) - 14, amp = h * 0.25;
  if (!waves) {
    // no waves to draw (a table the synth computes, or the waves still
    // coming): the same landscape as rails, the start positions lit on them
    for (var r = n - 1; r >= 0; r--) {
      var rx = x + r * dx, ry = y + h - amp - 2 - r * dy, on = startsAt(starts, r);
      g.line(rx, ry, rx + ww, ry, on ? 2 : 1, on ? on.color : r % 4 === 0 ? ORANGE_GL : RULE);
      if (on) g.text(rx + ww + 4, ry + 4, on.label, on.color, -1);
    }
    var what = raw === "algo" ? "WAVES COMPUTED BY THE SYNTH" : known(v, "wave_view") ? "READING THE WAVES" : "";
    g.text(x + 4, y + h - 2, what, MUTE, -1, w - 12);
    return;
  }
  for (var i = n - 1; i >= 0; i--) {
    var bx = x + i * dx, by = y + h - amp - 2 - i * dy, pts = [];
    for (var j = 0; j < 32; j++) pts.push(bx + j / 31 * ww, by - waves[i][j] * amp);
    var lit = startsAt(starts, i);
    g.area(pts, by + amp + 2, bg);
    g.poly(pts, lit ? 2 : 1, lit ? lit.color : i % 4 === 0 ? ORANGE_GL : BROWN_LT);
    if (lit) g.text(bx + ww + 4, by + 4, lit.label, lit.color, -1);
  }
}
// where an oscillator starts in the table: its start wave, 0..60 drawn at
// the nearest of the 16 positions, 61..63 one of the three fixed waves
function startOf(v, k, label, color) {
  var w = Math.round(num(v, k, 0));
  if (w > 60) return { pos: -1, fixed: w - 61, label: label, color: color };
  return { pos: Math.max(0, Math.min(15, Math.round(w / 4))), fixed: -1, label: label, color: color };
}
function startsKey(s) { return s[0].pos + "/" + s[0].fixed + "|" + s[1].pos + "/" + s[1].fixed; }

// ---- the front panel ----------------------------------------------------------------------
var SOUND = ["status", "preset", "preset_name", "bank_name", "wave_view"];
function waiting(v) { return disp(v, "status").indexOf("Waiting") === 0; }
// the display's second line: what the touched knob says, else where the oscillators start
function panelLine(v) {
  var t = v.$touched;
  if (t && v[t]) return touchLine(v[t].name || t, withUnit(v, t));
  return pad("W1 START " + (disp(v, "w1_start_w") || "-"), 14) + pad("W2 START " + (disp(v, "w2_start_w") || "-"), 14) +
    padl("CUTOFF " + (disp(v, "f1_cutoff") || "-"), 12);
}
// the panel's sections, its segments: the table in its window, and a row of
// lit section buttons on the orange body under the display (the XT's red
// LEDs); the one under the encoders lit
var SEGS = [
  { id: "osc", label: "Osc", keys: PAGES.osc[0].keys },
  { id: "wave", label: "Wave", keys: ["wave", "w1_start_w", "w2_start_w", "w1_env_amount", "w2_env_amount", "w1_keytrack", "w2_keytrack", "w2_link"] },
  { id: "mixer", label: "Mixer", keys: PAGES.wave[1].keys },
  { id: "filter", label: "Filter", keys: ["f1_cutoff", "f1_resonance", "f1_env_amount", "f1_type", "f1_env_attack", "f1_env_decay", "f1_env_sustain",
    "f1_env_release"] },
  { id: "amp", label: "Amp", keys: ["amp_volume", "amp_velocity", "amp_keytrack", "", "amp_env_attack", "amp_env_decay", "amp_env_sustain",
    "amp_env_release"] },
  { id: "lfo", label: "LFO", keys: PAGES.lfo[0].keys },
  { id: "fx", label: "FX", keys: PAGES.fx[0].keys }
];
var WIN = [530, 4, 424, 88];
(function () {
  var b = 0;
  SEGS.forEach(function (sg) { sg.rect = sg.id === "wave" ? WIN : [92 + (b++) * 71, 71, 68, 20]; });
})();
function sectionButtons(g, v) {
  var act = v.$segmode === "segment" ? v.$segment || "" : "";
  SEGS.forEach(function (sg) {
    var r = sg.rect, on = sg.id === act;
    if (sg.id === "wave") return; // the table's window: Pung's bar over it
    g.fill(r[0], r[1], r[2], r[3], on ? WINDOW : BODY_DK);
    led(g, r[0] + 10, r[1] + r[3] / 2, on);
    g.text(r[0] + 19, r[1] + 14, up(sg.label), on ? ORANGE_LT : SILK, -1, r[2] - 22);
  });
}
function frontPanel(g, v) {
  var l1 = pad(soundTitle(v), 21) + padl("TABLE " + (disp(v, "wave") || "-"), 19), l2 = panelLine(v);
  var starts = [startOf(v, "w1_start_w", "1", ORANGE_LT), startOf(v, "w2_start_w", "2", CREAM)];
  // one layer (a layer replaces the frame drawn so far: there is one, and it comes first)
  g.layer("xp|" + l1 + "|" + disp(v, "wave_view") + "|" + startsKey(starts), function () {
    g.fill(0, 0, 960, ROW, BODY);
    lcd(g, l1);
    g.value(14, 90, "XENIA", SILK, -1);
    // the table, in its window
    g.fill(530, 4, 424, 88, BODY_DK);
    g.fill(532, 6, 420, 84, WINDOW);
    wavetable(g, 540, 10, 406, 78, v, starts, WINDOW);
  });
  sectionButtons(g, v);
  bodyRow(g, v, null);
  lcd2(g, l2);
  knobRow(g, v, null, null);
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
var FX_SEGS = [
  { id: "effect", label: "Effect", rect: [535, 8, 414, 50], keys: ["effect_type", "effect_param_a", "effect_param_b", "effect_param_c"] },
  { id: "glide", label: "Glide", rect: [535, 60, 414, 30], keys: ["glide_enabled", "glide_time", "glide_type", "glide_mode"] }
];
function fxPanel(g, v) {
  var type = disp(v, "effect_type") || "Off", on = !isOff(type), glide = disp(v, "glide_enabled") === "On";
  // the names by the keys on the encoders (the page, or a segment of it)
  var NAME = { effect_type: "Effect", glide_enabled: "Glide", glide_time: "Time", glide_type: "Type", glide_mode: "Mode" };
  var names = [], values = [], kn = v.$knobs || [];
  for (var q = 0; q < 8; q++) {
    var kk = kn[q] || "";
    names.push(NAME[kk] || (/^effect_param_/.test(kk) ? knobName(v, kk) : ""));
    values.push(kk === "effect_type" ? type : disp(v, kk));
  }
  var t = v.$touched || "", ti = t ? (v.$knobs || []).indexOf(t) : -1;
  var l1 = pad(soundTitle(v), 21) + padl("EFFECT " + type, 19);
  var l2 = ti >= 0 && names[ti] ? touchLine(names[ti], values[ti])
    : pad("GLIDE " + (glide ? (disp(v, "glide_type") || "") : "OFF"), 24) + padl(glide ? disp(v, "glide_mode") : "", 16);
  g.layer("xf|" + l1, function () {
    g.fill(0, 0, 960, ROW, BODY);
    lcd(g, l1);
    g.value(14, 90, "XENIA", SILK, -1);
    g.text(518, 88, "EFFECT / GLIDE", SILK, 1);
    g.fill(530, 4, 424, 88, BODY_DK);
    g.fill(532, 6, 420, 84, WINDOW);
    // the effects, the chosen one lit
    for (var i = 1; i < FX_TYPES.length; i++) {
      var c = (i - 1) % 5, r = Math.floor((i - 1) / 5), x = 540 + c * 82, y = 12 + r * 24, lit = FX_TYPES[i] === type;
      g.fill(x, y, 78, 19, lit ? ORANGE : PANEL);
      g.text(x + 39, y + 14, FX_TILE[i].toUpperCase(), lit ? GROUND : on ? DIM : MUTE, 0, 74);
    }
  });
  bodyRow(g, v, names);
  lcd2(g, l2);
  // the glide: from one note to the next, as long as its time, in steps for a glissando
  var gt = frac(v, "glide_time", 0), x0 = 548, x1 = 580, gx = x1 + 10 + gt * 260, lo = 84, hi = 66;
  var gc = !glide ? FAINT : hot(v, "glide_time") || hot(v, "glide_type") || hot(v, "glide_mode") ? "slot" : ORANGE_LT, pts = [x0, lo, x1, lo];
  if (/Gliss/.test(disp(v, "glide_type"))) {
    for (var s = 1; s <= 6; s++) pts.push(x1 + (gx - x1) * (s - 1) / 6, lo + (hi - lo) * s / 6, x1 + (gx - x1) * s / 6, lo + (hi - lo) * s / 6);
  } else if (disp(v, "glide_mode") === "Linear") pts.push(gx, hi);
  else for (var e = 1; e <= 14; e++) { var f = e / 14; pts.push(x1 + (gx - x1) * f, lo + (hi - lo) * (1 - Math.exp(-4 * f)) / (1 - Math.exp(-4))); }
  pts.push(870, hi);
  g.poly(pts, 2, gc);
  g.text(944, 80, glide ? up(disp(v, "glide_time") || "") : "NO GLIDE", glide ? INK : MUTE, 1);
  knobRow(g, v, names, values);
}

// ---- pictures (a page's band: 952 x 86) -------------------------------------------------
// the oscillators: where each one sounds on a ruler of octaves, osc 1 above
// it, osc 2 below; the FM and the sync between them
var OCT = ["-4", "-3", "-2", "-1", "0", "+1", "+2", "+3", "+4"];
function oscScreen(g, v) {
  plate(g, 0, 0, 630, 86, "Pitch", true);
  var x0 = 34, W = 568, mid = x0 + W / 2, perOct = W / 8, y = 48;
  g.fill(x0, y, W, 1, RULE);
  for (var o = -4; o <= 4; o++) {
    g.fill(Math.round(mid + o * perOct), y - 3, 1, 7, o === 0 ? DIM : FAINT);
    g.text(mid + o * perOct, 82, o > 0 ? "+" + o : String(o), o === 0 ? DIM : FAINT, 0);
  }
  for (var n = 1; n <= 2; n++) {
    var p = "o" + n + "_", oct = opt(v, p + "octave", OCT) - 4;
    var semi = num(v, p + "semi", 0), det = num(v, p + "detune", 0) / 64;
    var x = Math.round(mid + (oct + (semi + det) / 12) * perOct), c = hotIn(v, p) ? "slot" : n === 1 ? ORANGE_LT : CREAM;
    if (n === 1) { g.fill(x - 1, y - 22, 3, 22, c); g.text(x + 6, y - 12, "OSC 1", c, -1); }
    else { g.fill(x - 1, y + 1, 3, 20, c); g.text(x + 6, y + 18, "OSC 2", c, -1); }
  }
  // FM and sync: what osc 2 does to osc 1
  var x1 = 636, w = 316, fm = frac(v, "o1_fm_amount", 0), sync = disp(v, "o2_sync") === "On";
  plate(g, x1, 0, w, 86, "Osc 1 / Osc 2", true);
  var cols = [["OCT", "octave"], ["SEMI", "semi"], ["DETUNE", "detune"]];
  for (var c2 = 0; c2 < 3; c2++) g.text(x1 + 140 + c2 * 64, 31, cols[c2][0], MUTE, 1);
  for (var m = 1; m <= 2; m++) {
    var yy = 31 + m * 15;
    g.text(x1 + 8, yy, "OSC " + m, m === 1 ? ORANGE_LT : CREAM, -1);
    for (var k = 0; k < 3; k++) {
      var key = "o" + m + "_" + cols[k][1];
      g.text(x1 + 140 + k * 64, yy, disp(v, key) || "--", hot(v, key) ? "slot" : INK, 1);
    }
  }
  g.text(x1 + 8, 81, "FM", MUTE, -1);
  bar(g, x1 + 30, 76, 120, fm, false, hot(v, "o1_fm_amount") ? "slot" : ORANGE);
  led(g, x1 + 214, 77, sync);
  g.text(x1 + 222, 81, "SYNC", hot(v, "o2_sync") ? "slot" : sync ? INK : MUTE, -1);
}
// the waves: the table, where each oscillator starts and how far the keys move it
function wavesScreen(g, v) {
  var starts = [startOf(v, "w1_start_w", "1", ORANGE_LT), startOf(v, "w2_start_w", "2", CREAM)];
  g.layer("ws|" + disp(v, "wave") + "|" + disp(v, "wave_view") + "|" + startsKey(starts), function () {
    plate(g, 0, 0, 470, 86, "Table " + (disp(v, "wave") || "-"), false);
    wavetable(g, 6, 16, 458, 68, v, starts, PANEL);
  });
  var x0 = 476, w = 476;
  plate(g, x0, 0, w, 86, "Start / Keys", true, disp(v, "w2_link") === "On" ? "Wave 2 follows wave 1" : "", hot(v, "w2_link") ? "slot" : DIM);
  for (var n = 1; n <= 2; n++) {
    var p = "w" + n + "_", y = 34 + (n - 1) * 26, c = n === 1 ? ORANGE_LT : CREAM, rx = x0 + 70, rw = 252;
    g.text(x0 + 8, y + 4, "WAVE " + n, c, -1);
    // the table's 64 positions, the start, and the keys' reach from it
    g.fill(rx, y, rw, 1, RULE);
    for (var q = 0; q <= 64; q += 16) g.fill(rx + q / 64 * rw, y - 3, 1, 7, FAINT);
    var st = num(v, p + "start_w", 0) / 63, kt = (frac(v, p + "keytrack", 0.5) - 0.5) * 2;
    var reach = Math.max(0, Math.min(1, st + kt * 0.5)), kc = hot(v, p + "keytrack") ? "slot" : c;
    if (Math.abs(reach - st) > 0.004) g.line(rx + st * rw, y, rx + reach * rw, y, 3, kc);
    g.fill(Math.round(rx + st * rw) - 1, y - 7, 3, 15, c);
    pairs(g, v, rx + rw + 16, y + 4, [["Phase", disp(v, p + "start_p"), p + "start_p"],
      disp(v, p + "limit") === "On" || hot(v, p + "limit") ? ["Limit", disp(v, p + "limit"), p + "limit"] : null], x0 + w - 8);
  }
  pairs(g, v, x0 + 8, 81, [["Accuracy", disp(v, "accuracy"), "accuracy"]], x0 + w - 8);
}
// the mixer: Pung's faders for the four sources, each over its encoder; the
// digital character the XT can keep, and where the voice sits
function mixerScreen(g, v) {
  g.mix(0, 0, 480, 86, ["mix_w1", "mix_w2", "mix_ring_mod", "mix_noise"], { color: ORANGE });
  var x0 = 488, w = 464;
  plate(g, x0, 0, w, 86, "Digital Character", true);
  var flags = [["Aliasing", "aliasing"], ["Quantize", "time_quant"], ["Clipping", "clipping"], ["Accuracy", "accuracy"]];
  for (var i = 0; i < flags.length; i++) {
    var y = 40 + (i % 2) * 22, x = x0 + 8 + Math.floor(i / 2) * 172, val = disp(v, flags[i][1]), on = !!val && !isOff(val) && val !== "Saturate";
    led(g, x + 4, y - 4, on);
    g.text(x + 14, y, up(flags[i][0]), MUTE, -1);
    g.text(x + 160, y, up(val || "--"), hot(v, flags[i][1]) ? "slot" : on ? INK : DIM, 1);
  }
  // the pan, under its encoder
  var px = x0 + w - 96, pw = 84, pan = frac(v, "pan", 0.5);
  g.text(px + pw / 2, 30, "PAN", MUTE, 0);
  g.fill(px, 44, pw, 2, RULE);
  g.fill(px + pw / 2, 40, 1, 10, DIM);
  g.dot(px + pw * pan, 45, 5, hot(v, "pan") ? "slot" : ORANGE_LT);
  g.text(px + pw / 2, 64, up(disp(v, "pan") || "--"), INK, 0);
}
// the two filters: Pung's filter picture (the sound's spectrum behind each
// curve while it plays), in the XT's orange; filter 1 feeds filter 2
function filterScreen(g, v) {
  var t1 = disp(v, "f1_type") || "--", t2 = disp(v, "f2_type") || "--";
  plate(g, 0, 0, 586, 86, "Filter 1", true, t1, hot(v, "f1_type") ? "slot" : INK);
  g.filter(4, 18, 578, 50, { cutoff: "f1_cutoff", resonance: "f1_resonance", type: "f1_type", color: ORANGE });
  pairs(g, v, 8, 81, [["Cutoff", disp(v, "f1_cutoff"), "f1_cutoff"], ["Reso", disp(v, "f1_resonance"), "f1_resonance"],
    ["Keys", disp(v, "f1_key_track"), "f1_key_track"], ["Env Vel", disp(v, "f1_env_vel_amount"), "f1_env_vel_amount"],
    ["Extra", disp(v, "f1_extra"), "f1_extra"]], 578);
  g.line(588, 43, 612, 43, 2, ORANGE);
  g.poly([606, 38, 613, 43, 606, 48], 2, ORANGE);
  plate(g, 616, 0, 336, 86, "Filter 2", true, t2, hot(v, "f2_type") ? "slot" : INK);
  g.filter(620, 18, 328, 50, { cutoff: "f2_cutoff", type: "f2_type", color: ORANGE });
  pairs(g, v, 624, 81, [["Cutoff", disp(v, "f2_cutoff"), "f2_cutoff"], ["Keys", disp(v, "f2_key_track"), "f2_key_track"],
    ["Amp Keys", disp(v, "amp_keytrack"), "amp_keytrack"]], 944);
}
// the two LFOs: Pung's LFO picture, in the XT's orange. (Their rates have no
// unit and nothing restarts them on a note that Pung can read: they are
// drawn still, as their phase cannot be known.)
function lfoScreen(g, v) {
  var shapePage = (v.$page || 0) === 1;
  for (var n = 1; n <= 2; n++) {
    var p = "lfo" + n + "_", x = n === 1 ? 0 : 479, w = 473;
    plate(g, x, 0, w, 86, "LFO " + n, true, disp(v, p + "shape") || "--", hot(v, p + "shape") ? "slot" : INK);
    g.lfo(x + 4, 18, w - 8, 44, { shape: p + "shape", rate: p + "rate", color: ORANGE });
    var list = shapePage
      ? [["Symmetry", disp(v, p + "symmetry"), p + "symmetry"], ["Humanize", disp(v, p + "humanize"), p + "humanize"],
         n === 2 ? ["Phase", disp(v, "lfo2_phase"), "lfo2_phase"] : null]
      : [["Rate", disp(v, p + "rate"), p + "rate"], ["Sync", disp(v, p + "sync"), p + "sync"], ["Delay", disp(v, p + "delay"), p + "delay"]];
    pairs(g, v, x + 8, 80, list, x + w - 8);
  }
}
// the free envelope: three times and levels, a release: Pung's envelope
function freeEnvScreen(g, v) {
  plate(g, 0, 0, 952, 86, "Free Envelope", true, "Trigger " + (disp(v, "free_env_trigger") || "--"), hot(v, "free_env_trigger") ? "slot" : DIM);
  g.envelope(4, 18, 944, 66, {
    time1: "free_env_time1", level1: "free_env_level1", time2: "free_env_time2", level2: "free_env_level2",
    time3: "free_env_time3", level3: "free_env_level3", time4: "free_env_release_time", level4: "free_env_release_level",
    labels: true, color: ORANGE
  });
}
// the voices: poly or mono, one, two or six per note, how far apart in
// pitch and in the stereo field; what else plays
function voiceScreen(g, v) {
  var as = disp(v, "assignment") || "Normal", mono = disp(v, "allocation_mode") === "Mono";
  var n = as === "Unisono" ? 6 : as === "Dual" ? 2 : 1, det = frac(v, "detune", 0), sp = frac(v, "de_pan", 0);
  plate(g, 0, 0, 586, 86, "Voices", true, (mono ? "Mono" : "Poly") + "  " + as, hot(v, "allocation_mode") || hot(v, "assignment") ? "slot" : INK);
  // a voice a line: across, its pitch (the detune); up and down, its place left to right (the de-pan)
  var cx = 293, vc = hot(v, "detune") || hot(v, "de_pan") ? "slot" : ORANGE_LT;
  g.fill(40, 50, 506, 1, RULE);
  g.fill(cx, 22, 1, 56, FAINT);
  g.text(36, 54, "LOW", FAINT, 1);
  g.text(550, 54, "HIGH", FAINT, -1);
  for (var i = 0; i < n; i++) {
    var off = n > 1 ? i / (n - 1) - 0.5 : 0, x = Math.round(cx + off * 480 * Math.max(det, 0.03)), y = Math.round(50 + (i % 2 ? 1 : -1) * Math.abs(off) * 48 * sp);
    g.fill(x - 1, y - 12, 3, 24, vc);
  }
  pairs(g, v, 8, 81, [["Detune", disp(v, "detune"), "detune"], ["De-pan", disp(v, "de_pan"), "de_pan"]], 578);
  var x0 = 592, w = 360;
  plate(g, x0, 0, w, 86, "Play", true);
  pairs(g, v, x0 + 8, 36, [["Velocity", disp(v, "amp_velocity"), "amp_velocity"], ["Pan Keys", disp(v, "pan_keytrack"), "pan_keytrack"]], x0 + w - 8);
  var ch = disp(v, "chorus_enabled") === "On", arp = disp(v, "arp_mode") || "Off";
  led(g, x0 + 12, 54, ch);
  g.text(x0 + 22, 58, "CHORUS", hot(v, "chorus_enabled") ? "slot" : ch ? INK : MUTE, -1);
  led(g, x0 + 12, 76, !isOff(arp));
  g.text(x0 + 22, 80, "ARP " + up(arp), hot(v, "arp_mode") ? "slot" : !isOff(arp) ? INK : MUTE, -1);
}
// the wave envelope: eight stages, each a time and a level that is a place
// in the table: Pung's envelope, still (where the XT holds a note and how it
// loops are its own: the loops are named beside it)
function wenvScreen(g, v) {
  var spec = { labels: true, color: ORANGE, still: true };
  for (var i = 1; i <= 8; i++) { spec["time" + i] = "wave_env_time" + i; spec["level" + i] = "wave_env_level" + i; }
  plate(g, 0, 0, 706, 86, "Wave Envelope", true, "Through the table", DIM);
  g.envelope(4, 18, 698, 66, spec);
  var x0 = 712, w = 240;
  plate(g, x0, 0, w, 86, "Loops", true, disp(v, "wave_env_trigger") || "", hot(v, "wave_env_trigger") ? "slot" : DIM);
  var loops = [["Key On", "wave_key_on_loop"], ["Key Off", "wave_key_off_loop"]];
  for (var l = 0; l < 2; l++) {
    var k = loops[l][1], on = disp(v, k) === "On", y = 40 + l * 24;
    led(g, x0 + 12, y - 4, on);
    g.text(x0 + 22, y, up(loops[l][0]), hot(v, k) ? "slot" : on ? INK : MUTE, -1);
    var a = disp(v, k + "_start") || "-", b = disp(v, k + "_end") || "-";
    g.text(x0 + w - 8, y, on || hotIn(v, k) ? "STAGE " + a + " TO " + b : "OFF", hot(v, k + "_start") || hot(v, k + "_end") ? "slot" : on ? INK : FAINT, 1);
  }
}
// the matrix: eight of the sixteen slots, the page's two lit: a source
// reaching a destination, the line as strong as the amount
function slotRow(g, v, x, y, label, p, lit) {
  var src = disp(v, p + "source") || "Off", dst = disp(v, p + "destination") || "--", amt = frac(v, p + "amount", 0.5);
  var on = !isOff(src) && Math.abs(amt - 0.5) > 0.004, a = Math.abs(amt - 0.5) * 2;
  var txt = on ? (lit ? INK : DIM) : FAINT;
  var tc = function (k, c) { return hot(v, k) ? "slot" : c; };
  g.text(x + 12, y + 13, label, lit ? ORANGE : MUTE, 0);
  g.fill(x + 26, y, 148, 18, lit && on ? ORANGE_DK : lit ? PANEL_HI : PANEL);
  g.text(x + 100, y + 13, up(src), tc(p + "source", txt), 0, 142);
  if (on) {
    var lc = tc(p + "amount", lit ? ORANGE_LT : ORANGE_GL);
    g.line(x + 174, y + 9, x + 258, y + 9, 1 + a * 5, lc);
    g.poly([x + 256, y + 4, x + 263, y + 9, x + 256, y + 14], 2, lc);
  } else g.fill(x + 174, y + 9, 90, 1, RULE);
  g.fill(x + 264, y, 148, 18, lit ? PANEL_HI : PANEL);
  if (lit && on) frame(g, x + 264, y, 148, 18, ORANGE);
  g.text(x + 338, y + 13, up(dst), tc(p + "destination", txt), 0, 142);
  g.text(x + 468, y + 13, on || hot(v, p + "amount") ? (disp(v, p + "amount") || "") : "", tc(p + "amount", lit ? INK : DIM), 1);
}
function slotsScreen(first) {
  var base = first <= 8 ? 1 : 9;
  return function (g, v) {
    for (var i = 0; i < 8; i++) {
      var n = base + i;
      slotRow(g, v, i < 4 ? 0 : 480, 2 + (i % 4) * 21, String(n), "slot" + n + "_", n === first || n === first + 1);
    }
    g.fill(475, 2, 1, 82, PANEL);
  };
}
// the four modifiers: two sources, an operation, its parameter; the page's two lit
function modifierScreen(a) {
  return function (g, v) {
    for (var n = 1; n <= 4; n++) {
      var p = "mod" + n + "_", y = 2 + (n - 1) * 21, lit = n === a || n === a + 1;
      var s1 = disp(v, p + "source1") || "Off", s2 = disp(v, p + "source2") || "Off", on = !isOff(s1) || !isOff(s2);
      var txt = on ? (lit ? INK : DIM) : FAINT, tc = function (k, c) { return hot(v, k) ? "slot" : c; };
      g.text(8, y + 13, "MODIFIER " + n, lit ? ORANGE : MUTE, -1);
      g.fill(100, y, 250, 18, lit ? PANEL_HI : PANEL);
      g.text(225, y + 13, up(s1), tc(p + "source1", txt), 0, 244);
      g.fill(360, y, 90, 18, lit ? ORANGE_DK : PANEL);
      g.text(405, y + 13, up(disp(v, p + "type") || "+"), tc(p + "type", lit ? ORANGE_LT : DIM), 0, 86);
      g.fill(460, y, 250, 18, lit ? PANEL_HI : PANEL);
      g.text(585, y + 13, up(s2), tc(p + "source2", txt), 0, 244);
      g.text(730, y + 13, "PARAMETER", MUTE, -1);
      bar(g, 808, y + 7, 100, frac(v, p + "parameter", 0), false, tc(p + "parameter", lit ? ORANGE : ORANGE_GL));
      g.text(944, y + 13, disp(v, p + "parameter") || "--", tc(p + "parameter", lit ? INK : DIM), 1);
    }
  };
}
// the arpeggiator: its clock, its range, and the sixteen steps of its user pattern
function stepKey(i) { return "arp_user_pattern" + (i + 1); }
function arpScreen(first) {
  return function (g, v) {
    var mode = disp(v, "arp_mode") || "Off", on = !isOff(mode), user = disp(v, "arp_pattern") === "User";
    var len = Math.max(1, num(v, "arp_user_pattern_length", 16));
    // (a tempo the sound holds below the range, 0 in some factory sounds, has no name: it is left out)
    var tempo = disp(v, "arp_tempo"), bpm = tempo === "External" ? "Ext" : +tempo >= 50 ? tempo + " bpm" : "";
    plate(g, 0, 0, 952, 86, "Arpeggiator", true, (on ? mode : "Off") + "   " + (disp(v, "arp_clock") || "") + (bpm ? "   " + bpm : "") + "   " +
      (disp(v, "arp_range") || "1") + " oct", hot(v, "arp_mode") ? "slot" : on ? INK : MUTE);
    led(g, 112, 7, on);
    var cw = 58, x0 = 8, y = 22;
    for (var i = 0; i < 16; i++) {
      var x = x0 + i * cw, inPat = i < len, hit = disp(v, stepKey(i)) === "On", lit = first >= 0 && i >= first && i < first + 8;
      var c = hot(v, stepKey(i)) ? "slot" : !inPat ? FAINT : hit ? (lit ? ORANGE_LT : ORANGE_GL) : RULE;
      if (hit && inPat) g.fill(x, y, cw - 8, 34, c); else frame(g, x, y, cw - 8, 34, c);
      g.text(x + (cw - 8) / 2, y + 22, String(i + 1), hit && inPat ? GROUND : lit ? ORANGE : FAINT, 0);
      if (lit) g.fill(x, y + 38, cw - 8, 2, ORANGE);
    }
    if (len < 16) g.fill(x0 + len * cw - 5, y - 2, 2, 38, ORANGE);
    pairs(g, v, 8, 81, [["Pattern", disp(v, "arp_pattern"), "arp_pattern"], ["Steps", String(len), "arp_user_pattern_length"],
      ["Direction", disp(v, "arp_direction"), "arp_direction"], ["Order", disp(v, "arp_note_order"), "arp_note_order"],
      ["Velocity", disp(v, "arp_velocity"), "arp_velocity"], ["Reset", disp(v, "arp_reset"), "arp_reset"]], 944, !on);
    if (!user) g.text(944, 81, "PLAYS PATTERN " + up(disp(v, "arp_pattern")), MUTE, 1);
  };
}

// ---- the compartments ----------------------------------------------------------------
function keysOf(list) { var out = []; list.forEach(function (pg) { out = out.concat(pg.keys); }); return out; }
push.compartment({
  id: "panel", label: "Xenia", front_panel: true, draws_tabs: true, draws_segments: true,
  pages: PAGES.panel, extra_keys: SOUND.concat(["effect_type"]),
  segments: SEGS,
  screen: function (g, v) {
    frontPanel(g, v);
    if (waiting(v)) { g.fill(532, 6, 420, 84, WINDOW); g.value(742, 54, "WAITING: ANOTHER XENIA PLAYS", ORANGE, 0, 400); }
  }
});
push.compartment({
  id: "osc", label: "Oscillators", extra_keys: ["status"].concat(keysOf(PAGES.osc)),
  pages: [
    { label: PAGES.osc[0].label, keys: PAGES.osc[0].keys, screen: oscScreen },
    { label: PAGES.osc[1].label, keys: PAGES.osc[1].keys }
  ]
});
push.compartment({
  id: "wave", label: "Waves", extra_keys: ["status", "wave", "wave_view", "w1_start_w", "w2_start_w"].concat(keysOf(PAGES.wave)),
  pages: [
    { label: PAGES.wave[0].label, keys: PAGES.wave[0].keys, screen: wavesScreen },
    { label: PAGES.wave[1].label, keys: PAGES.wave[1].keys, screen: mixerScreen }
  ]
});
push.compartment({
  id: "filter", label: "Filters", extra_keys: ["status", "f1_cutoff", "f1_resonance"],
  pages: [{ label: PAGES.filter[0].label, keys: PAGES.filter[0].keys, screen: filterScreen }]
});
// the filter and amp envelopes: Pung's own envelope, found on their pages
// as on every module's; the free envelope's keys it cannot read alone
push.compartment({
  id: "env", label: "Envelopes", extra_keys: ["status", "free_env_trigger"],
  pages: PAGES.env.map(function (pg) {
    return pg.label === "Free Env" ? { label: pg.label, keys: pg.keys, screen: freeEnvScreen } : { label: pg.label, keys: pg.keys };
  })
});
push.compartment({
  id: "lfo", label: "LFOs",
  // each page's picture is both LFOs whole: what the other page edits comes with it
  extra_keys: ["status"].concat(keysOf(PAGES.lfo)),
  pages: PAGES.lfo.map(function (pg) { return { label: pg.label, keys: pg.keys, screen: lfoScreen }; })
});
push.compartment({
  id: "fx", label: "Effect", front_panel: true, draws_tabs: true,
  pages: PAGES.fx, extra_keys: SOUND,
  segments: FX_SEGS,
  screen: fxPanel
});
push.compartment({
  id: "voice", label: "Voice", extra_keys: ["status"],
  pages: [
    { label: PAGES.voice[0].label, keys: PAGES.voice[0].keys, screen: voiceScreen },
    { label: PAGES.voice[1].label, keys: PAGES.voice[1].keys }
  ]
});
push.compartment({
  id: "wenv", label: "Wave Env", extra_keys: ["status"].concat(keysOf(PAGES.wenv)),
  pages: PAGES.wenv.map(function (pg) { return { label: pg.label, keys: pg.keys, screen: wenvScreen }; })
});
push.compartment({
  id: "matrix", label: "Matrix", extra_keys: ["status"].concat(keysOf(PAGES.matrix)),
  pages: PAGES.matrix.map(function (pg) {
    var m = /^Modifiers (\d)/.exec(pg.label), s = /^Slots (\d+)/.exec(pg.label);
    return m ? { label: pg.label, keys: pg.keys, screen: modifierScreen(+m[1]) }
      : s ? { label: pg.label, keys: pg.keys, screen: slotsScreen(+s[1]) } : { label: pg.label, keys: pg.keys };
  })
});
var STEP_KEYS = [];
for (var si = 0; si < 16; si++) STEP_KEYS.push(stepKey(si));
push.compartment({
  id: "arp", label: "Arp",
  extra_keys: ["status", "arp_mode"].concat(keysOf(PAGES.arp)),
  pages: PAGES.arp.map(function (pg) {
    return { label: pg.label, keys: pg.keys, screen: arpScreen(/9-16/.test(pg.label) ? 8 : /1-8/.test(pg.label) ? 0 : -1) };
  })
});
