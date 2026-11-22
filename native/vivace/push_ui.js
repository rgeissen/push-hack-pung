// Vivace (a spectral warping wavetable synthesizer) on Push.
//
// The screens speak the synth's own editor: dark sections on a darker ground,
// each in the colour the editor gives it (the oscillators violet, the filters
// amber, envelopes, LFOs and every modulation teal, each effect its own), the
// wavetable as a 3D stack of frames that a knob scans through, bent as the
// editor bends it, and a knob as a ring whose teal outer arc is what the sound
// modulates it by.
//
// The device opens on the three tables, the playing frame lit (between the 17
// frames the engine hands over, interpolated) and phase-warped as the
// oscillator plays it, the range its modulations sweep marked under it; the
// first filter's response and the amplitude envelope (Pung's, live); the
// sound's name; the macros, named as the sound names them, each with what it
// drives. An oscillator's pages show its table large, the frame it plays in
// 2D under its warp, the unison voices where the engine puts them (detune,
// its power and the stack's intervals) and where the oscillator goes; the
// sources page is the routing as a matrix; the filter pages the filter large
// beside the path the sound takes through both; envelopes, LFOs and random
// sources are Pung's own pictures beside what each one moves; the effects
// the chain of nine with the turned one drawn as it works; the matrix pages
// one route over each encoder.
// docs/NATIVE-MODULES.md, Vivace.

// <pages> (tools/gen_params.py writes this list: do not edit)
var PAGES = [
  {c: "play", label: "Play", keys: ["macro_control_1", "macro_control_2", "macro_control_3", "macro_control_4", "volume", "velocity_track", "portamento_time", "pitch_bend_range"]},
  {c: "osc", label: "Osc 1", keys: ["osc_1_transpose", "osc_1_tune", "osc_1_wave_frame", "osc_1_spectral_morph_amount", "osc_1_distortion_amount", "osc_1_unison_voices", "osc_1_unison_detune", "osc_1_level"]},
  {c: "osc", label: "Osc 2", keys: ["osc_2_transpose", "osc_2_tune", "osc_2_wave_frame", "osc_2_spectral_morph_amount", "osc_2_distortion_amount", "osc_2_unison_voices", "osc_2_unison_detune", "osc_2_level"]},
  {c: "osc", label: "Osc 3", keys: ["osc_3_transpose", "osc_3_tune", "osc_3_wave_frame", "osc_3_spectral_morph_amount", "osc_3_distortion_amount", "osc_3_unison_voices", "osc_3_unison_detune", "osc_3_level"]},
  {c: "osc", label: "Sources", keys: ["osc_1_on", "osc_2_on", "osc_3_on", "sample_on", "osc_1_destination", "osc_2_destination", "osc_3_destination", "sample_destination"]},
  {c: "filter", label: "Filter 1", keys: ["filter_1_on", "filter_1_type", "filter_1_cutoff", "filter_1_resonance", "filter_1_drive", "filter_1_blend", "filter_1_keytrack", "filter_1_mix"]},
  {c: "filter", label: "Filter 2", keys: ["filter_2_on", "filter_2_type", "filter_2_cutoff", "filter_2_resonance", "filter_2_drive", "filter_2_blend", "filter_2_keytrack", "filter_2_mix"]},
  {c: "env", label: "Env 1", keys: ["env_1_attack", "env_1_hold", "env_1_decay", "env_1_sustain", "env_1_release", "env_1_attack_power", "env_1_decay_power", "env_1_release_power"]},
  {c: "env", label: "Env 2", keys: ["env_2_attack", "env_2_hold", "env_2_decay", "env_2_sustain", "env_2_release", "env_2_attack_power", "env_2_decay_power", "env_2_release_power"]},
  {c: "env", label: "Env 3", keys: ["env_3_attack", "env_3_hold", "env_3_decay", "env_3_sustain", "env_3_release", "env_3_attack_power", "env_3_decay_power", "env_3_release_power"]},
  {c: "lfo", label: "LFO 1", keys: ["lfo_1_sync", "lfo_1_frequency", "lfo_1_tempo", "lfo_1_sync_type", "lfo_1_phase", "lfo_1_fade_time", "lfo_1_delay_time", "lfo_1_stereo"]},
  {c: "lfo", label: "LFO 2", keys: ["lfo_2_sync", "lfo_2_frequency", "lfo_2_tempo", "lfo_2_sync_type", "lfo_2_phase", "lfo_2_fade_time", "lfo_2_delay_time", "lfo_2_stereo"]},
  {c: "fx", label: "Chorus", keys: ["chorus_on", "chorus_dry_wet", "chorus_voices", "chorus_sync", "chorus_frequency", "chorus_tempo", "chorus_mod_depth", "chorus_feedback"]},
  {c: "fx", label: "Delay", keys: ["delay_on", "delay_dry_wet", "delay_feedback", "delay_style", "delay_sync", "delay_frequency", "delay_tempo", "delay_filter_cutoff"]},
  {c: "fx", label: "Reverb", keys: ["reverb_on", "reverb_dry_wet", "reverb_decay_time", "reverb_size", "reverb_delay", "reverb_pre_low_cutoff", "reverb_pre_high_cutoff", "reverb_chorus_amount"]},
  {c: "osc", label: "Osc 1 Shape", keys: ["osc_1_spectral_morph_type", "osc_1_spectral_morph_spread", "osc_1_distortion_type", "osc_1_distortion_spread", "osc_1_distortion_phase", "osc_1_phase", "osc_1_random_phase", "osc_1_pan"]},
  {c: "osc", label: "Osc 2 Shape", keys: ["osc_2_spectral_morph_type", "osc_2_spectral_morph_spread", "osc_2_distortion_type", "osc_2_distortion_spread", "osc_2_distortion_phase", "osc_2_phase", "osc_2_random_phase", "osc_2_pan"]},
  {c: "osc", label: "Osc 3 Shape", keys: ["osc_3_spectral_morph_type", "osc_3_spectral_morph_spread", "osc_3_distortion_type", "osc_3_distortion_spread", "osc_3_distortion_phase", "osc_3_phase", "osc_3_random_phase", "osc_3_pan"]},
  {c: "osc", label: "Osc 1 Unison", keys: ["osc_1_unison_blend", "osc_1_stereo_spread", "osc_1_frame_spread", "osc_1_stack_style", "osc_1_detune_power", "osc_1_detune_range", "osc_1_spectral_unison", "osc_1_smooth_interpolation"]},
  {c: "osc", label: "Osc 2 Unison", keys: ["osc_2_unison_blend", "osc_2_stereo_spread", "osc_2_frame_spread", "osc_2_stack_style", "osc_2_detune_power", "osc_2_detune_range", "osc_2_spectral_unison", "osc_2_smooth_interpolation"]},
  {c: "osc", label: "Osc 3 Unison", keys: ["osc_3_unison_blend", "osc_3_stereo_spread", "osc_3_frame_spread", "osc_3_stack_style", "osc_3_detune_power", "osc_3_detune_range", "osc_3_spectral_unison", "osc_3_smooth_interpolation"]},
  {c: "osc", label: "Sample", keys: ["sample_level", "sample_pan", "sample_transpose", "sample_tune", "sample_keytrack", "sample_loop", "sample_bounce", "sample_random_phase"]},
  {c: "osc", label: "Key Track", keys: ["osc_1_midi_track", "osc_2_midi_track", "osc_3_midi_track"]},
  {c: "filter", label: "Filter 1 +", keys: ["filter_1_filter_input", "filter_1_formant_x", "filter_1_formant_y", "filter_1_formant_transpose", "filter_1_formant_resonance", "filter_1_formant_spread", "filter_1_blend_transpose"]},
  {c: "filter", label: "Filter 2 +", keys: ["filter_2_filter_input", "filter_2_formant_x", "filter_2_formant_y", "filter_2_formant_transpose", "filter_2_formant_resonance", "filter_2_formant_spread", "filter_2_blend_transpose"]},
  {c: "fx", label: "FX Filter", keys: ["filter_fx_on", "filter_fx_type", "filter_fx_cutoff", "filter_fx_resonance", "filter_fx_drive", "filter_fx_blend", "filter_fx_keytrack", "filter_fx_mix"]},
  {c: "fx", label: "FX Filter +", keys: ["filter_fx_formant_x", "filter_fx_formant_y", "filter_fx_formant_transpose", "filter_fx_formant_resonance", "filter_fx_formant_spread", "filter_fx_blend_transpose"]},
  {c: "env", label: "Env 4", keys: ["env_4_attack", "env_4_hold", "env_4_decay", "env_4_sustain", "env_4_release", "env_4_attack_power", "env_4_decay_power", "env_4_release_power"]},
  {c: "env", label: "Env 5", keys: ["env_5_attack", "env_5_hold", "env_5_decay", "env_5_sustain", "env_5_release", "env_5_attack_power", "env_5_decay_power", "env_5_release_power"]},
  {c: "env", label: "Env 6", keys: ["env_6_attack", "env_6_hold", "env_6_decay", "env_6_sustain", "env_6_release", "env_6_attack_power", "env_6_decay_power", "env_6_release_power"]},
  {c: "env", label: "Env Delay", keys: ["env_1_delay", "env_2_delay", "env_3_delay", "env_4_delay", "env_5_delay", "env_6_delay"]},
  {c: "lfo", label: "LFO 3", keys: ["lfo_3_sync", "lfo_3_frequency", "lfo_3_tempo", "lfo_3_sync_type", "lfo_3_phase", "lfo_3_fade_time", "lfo_3_delay_time", "lfo_3_stereo"]},
  {c: "lfo", label: "LFO 4", keys: ["lfo_4_sync", "lfo_4_frequency", "lfo_4_tempo", "lfo_4_sync_type", "lfo_4_phase", "lfo_4_fade_time", "lfo_4_delay_time", "lfo_4_stereo"]},
  {c: "lfo", label: "LFO 5", keys: ["lfo_5_sync", "lfo_5_frequency", "lfo_5_tempo", "lfo_5_sync_type", "lfo_5_phase", "lfo_5_fade_time", "lfo_5_delay_time", "lfo_5_stereo"]},
  {c: "lfo", label: "LFO 6", keys: ["lfo_6_sync", "lfo_6_frequency", "lfo_6_tempo", "lfo_6_sync_type", "lfo_6_phase", "lfo_6_fade_time", "lfo_6_delay_time", "lfo_6_stereo"]},
  {c: "lfo", label: "LFO 7", keys: ["lfo_7_sync", "lfo_7_frequency", "lfo_7_tempo", "lfo_7_sync_type", "lfo_7_phase", "lfo_7_fade_time", "lfo_7_delay_time", "lfo_7_stereo"]},
  {c: "lfo", label: "LFO 8", keys: ["lfo_8_sync", "lfo_8_frequency", "lfo_8_tempo", "lfo_8_sync_type", "lfo_8_phase", "lfo_8_fade_time", "lfo_8_delay_time", "lfo_8_stereo"]},
  {c: "lfo", label: "LFO 1+2 +", keys: ["lfo_1_smooth_mode", "lfo_1_smooth_time", "lfo_1_keytrack_transpose", "lfo_1_keytrack_tune", "lfo_2_smooth_mode", "lfo_2_smooth_time", "lfo_2_keytrack_transpose", "lfo_2_keytrack_tune"]},
  {c: "lfo", label: "LFO 3+4 +", keys: ["lfo_3_smooth_mode", "lfo_3_smooth_time", "lfo_3_keytrack_transpose", "lfo_3_keytrack_tune", "lfo_4_smooth_mode", "lfo_4_smooth_time", "lfo_4_keytrack_transpose", "lfo_4_keytrack_tune"]},
  {c: "lfo", label: "LFO 5+6 +", keys: ["lfo_5_smooth_mode", "lfo_5_smooth_time", "lfo_5_keytrack_transpose", "lfo_5_keytrack_tune", "lfo_6_smooth_mode", "lfo_6_smooth_time", "lfo_6_keytrack_transpose", "lfo_6_keytrack_tune"]},
  {c: "lfo", label: "LFO 7+8 +", keys: ["lfo_7_smooth_mode", "lfo_7_smooth_time", "lfo_7_keytrack_transpose", "lfo_7_keytrack_tune", "lfo_8_smooth_mode", "lfo_8_smooth_time", "lfo_8_keytrack_transpose", "lfo_8_keytrack_tune"]},
  {c: "lfo", label: "Random 1", keys: ["random_1_style", "random_1_sync", "random_1_frequency", "random_1_tempo", "random_1_stereo", "random_1_sync_type"]},
  {c: "lfo", label: "Random 2", keys: ["random_2_style", "random_2_sync", "random_2_frequency", "random_2_tempo", "random_2_stereo", "random_2_sync_type"]},
  {c: "lfo", label: "Random 3", keys: ["random_3_style", "random_3_sync", "random_3_frequency", "random_3_tempo", "random_3_stereo", "random_3_sync_type"]},
  {c: "lfo", label: "Random 4", keys: ["random_4_style", "random_4_sync", "random_4_frequency", "random_4_tempo", "random_4_stereo", "random_4_sync_type"]},
  {c: "fx", label: "Chorus +", keys: ["chorus_delay_1", "chorus_delay_2", "chorus_cutoff", "chorus_spread"]},
  {c: "fx", label: "Delay +", keys: ["delay_filter_spread", "delay_aux_sync", "delay_aux_frequency", "delay_aux_tempo"]},
  {c: "fx", label: "Reverb +", keys: ["reverb_low_shelf_cutoff", "reverb_low_shelf_gain", "reverb_high_shelf_cutoff", "reverb_high_shelf_gain", "reverb_chorus_frequency"]},
  {c: "fx", label: "Distortion", keys: ["distortion_on", "distortion_type", "distortion_drive", "distortion_mix", "distortion_filter_order", "distortion_filter_cutoff", "distortion_filter_resonance", "distortion_filter_blend"]},
  {c: "fx", label: "Compressor", keys: ["compressor_on", "compressor_enabled_bands", "compressor_mix", "compressor_attack", "compressor_release", "compressor_low_gain", "compressor_band_gain", "compressor_high_gain"]},
  {c: "fx", label: "Comp Levels", keys: ["compressor_low_upper_threshold", "compressor_band_upper_threshold", "compressor_high_upper_threshold", "compressor_low_lower_threshold", "compressor_band_lower_threshold", "compressor_high_lower_threshold"]},
  {c: "fx", label: "Comp Ratios", keys: ["compressor_low_upper_ratio", "compressor_band_upper_ratio", "compressor_high_upper_ratio", "compressor_low_lower_ratio", "compressor_band_lower_ratio", "compressor_high_lower_ratio"]},
  {c: "fx", label: "EQ", keys: ["eq_on", "eq_low_cutoff", "eq_low_gain", "eq_band_cutoff", "eq_band_gain", "eq_high_cutoff", "eq_high_gain", "eq_band_resonance"]},
  {c: "fx", label: "EQ +", keys: ["eq_low_mode", "eq_low_resonance", "eq_band_mode", "eq_high_mode", "eq_high_resonance"]},
  {c: "fx", label: "Flanger", keys: ["flanger_on", "flanger_dry_wet", "flanger_feedback", "flanger_sync", "flanger_frequency", "flanger_tempo", "flanger_center", "flanger_mod_depth"]},
  {c: "fx", label: "Phaser", keys: ["phaser_on", "phaser_dry_wet", "phaser_feedback", "phaser_sync", "phaser_frequency", "phaser_tempo", "phaser_center", "phaser_mod_depth"]},
  {c: "fx", label: "Mod FX +", keys: ["phaser_blend", "phaser_phase_offset", "flanger_phase_offset"]},
  {c: "matrix", label: "Matrix 1-8", keys: ["modulation_1_amount", "modulation_2_amount", "modulation_3_amount", "modulation_4_amount", "modulation_5_amount", "modulation_6_amount", "modulation_7_amount", "modulation_8_amount"]},
  {c: "matrix", label: "Matrix 9-16", keys: ["modulation_9_amount", "modulation_10_amount", "modulation_11_amount", "modulation_12_amount", "modulation_13_amount", "modulation_14_amount", "modulation_15_amount", "modulation_16_amount"]},
  {c: "voice", label: "Voice", keys: ["polyphony", "voice_priority", "voice_override", "legato", "portamento_slope", "portamento_force", "portamento_scale", "voice_tune"]},
  {c: "voice", label: "Voice +", keys: ["voice_transpose", "voice_amplitude", "stereo_mode", "stereo_routing", "oversampling", "mpe_enabled"]},
];
// </pages>

// ---- the palette: the synth's editor ---------------------------------------------------------
function hexRGB(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }
// a colour t of the way from a to b (the panel has no alpha: a fade is a mix)
function mix(a, b, t) {
  var x = hexRGB(a), y = hexRGB(b), s = "#";
  for (var i = 0; i < 3; i++) { var n = Math.round(x[i] + (y[i] - x[i]) * t); s += (n < 16 ? "0" : "") + n.toString(16); }
  return s;
}
var BG = "#111416", BODY = "#1d2125", HEAD = "#2a2e32", RULE = "#3a3e42", LINE = "#4c4f52";
var TEXT = "#d3d6d6", HI = "#ffffff", MUTED = "#8a8d90", FAINT = "#5c5f62";
var OSC = "#aa88ff", OSC_LT = mix(OSC, HI, 0.4), OSC_MID = mix(BODY, OSC, 0.5), OSC_DK = mix(BODY, OSC, 0.26), OSC_GH = mix(BODY, OSC, 0.12);
var FLT = "#ffb74d", FLT_DK = mix(BODY, FLT, 0.3);
var MODC = "#1de9b6", MOD_LT = "#64ffda", MOD_MID = mix(BODY, MODC, 0.5), MOD_DK = mix(BODY, MODC, 0.28);
// the stack, front to back: strong enough to read on the Push's display
// (at 15..42% of the violet it faded into the ground there, 2026-11-22)
var DEPTH = [0, 1, 2, 3].map(function (i) { return mix(BODY, OSC, 0.75 - i * 0.13); });
var DEPTH_OFF = [0, 1, 2, 3].map(function (i) { return mix(BODY, MUTED, 0.62 - i * 0.1); }); // off: grey, still readable

function known(v, k) { return !!(k && v[k] && v[k].known); }
function frac(v, k, d) { return known(v, k) ? v[k].frac : (d === undefined ? 0 : d); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value || "") : ""; }
function raw(v, k) { return known(v, k) ? String(v[k].value || "") : ""; }
function num(v, k, d) { var n = parseFloat(raw(v, k)); return isNaN(n) ? (d || 0) : n; }
function up(s) { return String(s || "").toUpperCase(); }
function hot(v, k) { return !!k && v.$touched === k; }
function hotIn(v, pre) { var t = v.$touched || ""; return t !== "" && t.indexOf(pre) === 0; }
function hotAny(v, list) { var t = v.$touched || ""; return t !== "" && list.indexOf(t) >= 0; }
function isOn(v, k) { return disp(v, k) === "On"; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function withUnit(v, k) {
  var d = disp(v, k);
  if (!d) return "--";
  var u = v[k].unit || "";
  if (u && d.slice(-u.length) !== u) d += (u === "%" ? "" : " ") + u;
  return d;
}
function json(v, k, d) {
  var s = raw(v, k);
  if (!s) return d;
  try { return JSON.parse(s); } catch (e) { return d; }
}
// a list the module answers as JSON; [] for anything else (a value not read yet)
function arr(v, k) { var a = json(v, k, []); return Array.isArray(a) ? a : []; }
function obj(v, k) { var o = json(v, k, {}); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }
function pagesOf(c) { return PAGES.filter(function (p) { return p.c === c; }); }
function pageKeys(label) { return PAGES.filter(function (p) { return p.label === label; })[0].keys; }

// ---- shapes -------------------------------------------------------------------------------------
// a rounded box (the editor rounds every section and display)
function box(g, x, y, w, h, r, c) {
  if (r <= 0 || w < 2 * r || h < 2 * r) { g.fill(x, y, w, h, c); return; }
  g.fill(x + r, y, w - 2 * r, h, c);
  g.fill(x, y + r, w, h - 2 * r, c);
  g.dot(x + r, y + r, r, c); g.dot(x + w - r, y + r, r, c);
  g.dot(x + r, y + h - r, r, c); g.dot(x + w - r, y + h - r, r, c);
}
// a section: its body and its heading strip
function section(g, x, y, w, h, head) {
  box(g, x, y, w, h, 4, BODY);
  if (head) { g.fill(x + 4, y, w - 8, head, HEAD); g.fill(x, y + 4, w, head - 4, HEAD); g.dot(x + 4, y + 4, 4, HEAD); g.dot(x + w - 4, y + 4, 4, HEAD); }
}
// a power button as the editor draws it: a ring, filled in the section's colour when on
function power(g, cx, cy, on, c) {
  g.dot(cx, cy, 4, on ? c : LINE);
  if (!on) g.dot(cx, cy, 2.5, HEAD);
}
// a label pill (the editor's knob names sit on one)
function pill(g, cx, y, s, tc, bg, maxW) {
  var w = Math.min(maxW || 999, g.measure(s) + 14);
  g.fill(cx - w / 2 + 6.5, y, w - 13, 13, bg);
  g.dot(cx - w / 2 + 6.5, y + 6.5, 6.5, bg); g.dot(cx + w / 2 - 6.5, y + 6.5, 6.5, bg);
  g.text(cx, y + 10, s, tc, 0, w - 10);
}

// ---- the wavetables (wave_view) -------------------------------------------------------------------
var HEXV = []; for (var hc = 0; hc < 128; hc++) HEXV.push(hc >= 48 && hc <= 57 ? hc - 48 : hc >= 97 && hc <= 102 ? hc - 87 : hc >= 65 && hc <= 70 ? hc - 55 : 0);
var tableCache = { src: null, tables: null };
// The tables as the engine hands them: per table its frame count and 17
// frames of 64 points, a byte a point in hex. A frame is decoded the first
// time it is drawn (t.frame(f)).
function tables(v) {
  var s = raw(v, "wave_view");
  if (s === tableCache.src) return tableCache.tables;
  var out = null;
  try {
    var j = JSON.parse(s);
    if (!j || !Array.isArray(j.tables)) throw "no tables";
    out = j.tables.map(function (t) {
      var w = String(t.w || ""), dec = [], k = Math.max(1, Math.min(t.k | 0, Math.floor(w.length / 128)));
      return { n: t.frames, k: k, frame: function (f) {
        var d = dec[f];
        if (d) return d;
        d = [];
        for (var i = 0, o = f * 128; i < 64; i++, o += 2) d.push((HEXV[w.charCodeAt(o)] * 16 + HEXV[w.charCodeAt(o + 1)] - 128) / 127);
        dec[f] = d;
        return d;
      } };
    });
  } catch (e) { out = null; }
  tableCache = { src: s, tables: out };
  memo = {}; memoN = 0;
  return out;
}
// computed curves, by what decides them (a few hundred at most: a knob swept
// through its travel starts the list again)
var memo = {}, memoN = 0;
function cached(key, fn) {
  var e = memo[key];
  if (e === undefined) {
    if (++memoN > 400) { memo = {}; memoN = 1; }
    e = fn(); memo[key] = e;
  }
  return e;
}
// where a frame position (0 .. frames-1) falls among the drawn frames: a
// continuous index, and the wave there (between two drawn frames, blended)
function depthOf(t, pos) {
  if (!t || t.k < 2) return 0;
  return clamp(pos / Math.max(1, t.n - 1), 0, 1) * (t.k - 1);
}
function waveAt(t, p) {
  var k = t.k;
  if (k < 2) return t.frame(0);
  var i = Math.min(k - 2, Math.floor(p)), f = p - i, a = t.frame(i), b = t.frame(i + 1), out = [];
  if (f < 0.002) return a;
  for (var j = 0; j < a.length; j++) out.push(a[j] + (b[j] - a[j]) * f);
  return out;
}

// The oscillator's phase warp, as the engine computes it
// (SynthOscillator::adjustPhase and its window, in turns): the editor draws
// the frame bent by it, and so do these screens. The frequency and ring
// modulations need the other oscillator's sound: those frames stay as they are.
function sgn1(x) { x = (x + 0.5) % 1; if (x < 0) x += 1; return x - 0.5; }
function sampleWave(pts, u) {
  var n = pts.length, x = (((u % 1) + 1) % 1) * n - 0.5, i = Math.floor(x), f = x - i;
  var a = pts[(i + n) % n], b = pts[(i + 1) % n];
  return a + (b - a) * f;
}
var WARPS = { "Sync": 1, "Formant": 2, "Quantize": 3, "Bend": 4, "Squeeze": 5, "Pulse": 6 };
function warpable(type) { return !!WARPS[type]; }
function warped(pts, type, a, ph, N) {
  var kind = WARPS[type] || 0, dp = ph - 0.5, out = [];
  var m = Math.pow(2, (a - 0.5) * 8);
  var q = Math.pow(2, Math.pow(1 - a, 3) * 0.85 * 32 + 1);
  var o = 2 * (a - a * a), sq = a * 2 * 0.95 + 0.05, pw = 1 / Math.max(1 - a, 1e-6);
  for (var j = 0; j < N; j++) {
    var t = j / N, P = t, w = 1;
    if (kind === 1 || kind === 2) {
      P = (t - 0.5) * m + 0.5 + dp;
      if (kind === 2) w = Math.cos(Math.PI * (t - 0.5));
    } else if (kind === 3) {
      var s = sgn1(t), fl = s * q + dp;
      P = ((fl < 0 ? Math.ceil(fl) : Math.floor(fl)) - dp) / q;
    } else if (kind === 4) {
      var f = sgn1(t - dp) + 0.5, f2 = f * f, f3 = f2 * f;
      P = f3 + (3 * a + o) * (f2 - f3) + (3 * a - o) * (f - 2 * f2 + f3) - 0.5 + dp;
    } else if (kind === 5) {
      var s5 = sgn1(t - dp), as = Math.abs(s5), np = as > sq * 0.25 ? 0.5 - (0.5 - as) / (2 - sq) : as / sq;
      P = (s5 > 0 ? np : -np) + dp;
    } else if (kind === 6) {
      var s6 = sgn1(t) * pw;
      if (s6 <= -0.5) w = 0;
      P = clamp(s6, -0.5, 0.5) + dp;
    }
    out.push(w * sampleWave(pts, P));
  }
  return out;
}
// an oscillator's warp now: its type, its amount and phase (0..1); none: null
function warpOf(v, n) {
  var p = "osc_" + n + "_", type = disp(v, p + "distortion_type");
  if (!warpable(type)) return null;
  return { type: type, a: frac(v, p + "distortion_amount", 0.5), ph: frac(v, p + "distortion_phase", 0.5) };
}

// The editor's 3D view: the frames recede up and to the right, the first in
// front, each a line; the one being played is lit, filled to its centre line.
function stackGeom(x, y, w, h, k) {
  var dX = k > 1 ? w * 0.27 : 0, dY = k > 1 ? h * 0.44 : 0, ww = w - dX, amp = (h - dY) * 0.46;
  return { dx: k > 1 ? dX / (k - 1) : 0, dy: k > 1 ? dY / (k - 1) : 0, ww: ww, amp: amp, x0: x, y0: y + h - amp - 1 };
}
function framePts(G, p, pts, step) {
  var out = [], ox = G.x0 + p * G.dx, oy = G.y0 - p * G.dy, n = pts.length, st = step || 1;
  for (var i = 0; i < n; i += st) out.push(ox + G.ww * i / (n - 1), oy - pts[i] * G.amp);
  if ((n - 1) % st) out.push(ox + G.ww, oy - pts[n - 1] * G.amp);
  return out;
}
// the stack (in a layer: once a sound): every frame where it is large,
// every other where three share the panel
function drawStack(g, x, y, w, h, t, on, step) {
  if (!t) { g.text(x + w / 2, y + h / 2 + 4, "READING THE TABLE", FAINT, 0); return; }
  var k = t.k, pal = on ? DEPTH : DEPTH_OFF, every = step > 1 && k > 9 ? 2 : 1;
  var lines = cached(["st", t.n, k, t.frame(0)[0], t.frame(k - 1)[7], x, y, w, h, step].join("|"), function () {
    var G = stackGeom(x, y, w, h, k), out = [];
    for (var f = 0; f < k; f += every) out.push([f, framePts(G, f, t.frame(f), step)]);
    if (out[out.length - 1][0] !== k - 1) out.push([k - 1, framePts(G, k - 1, t.frame(k - 1), step)]);
    return out;
  });
  for (var i = lines.length - 1; i >= 0; i--) g.poly(lines[i][1], 1, pal[Math.min(3, Math.floor(lines[i][0] * 4 / Math.max(1, k)))]);
}
// the frame being played, over the stack: lit and filled, bent by the warp
function drawPlayed(g, x, y, w, h, t, pos, on, n, wp, c) {
  if (!t) return;
  var p = Math.round(depthOf(t, pos) * 8) / 8;
  var e = cached(["pl", n, x, y, w, h, p, wp ? [wp.type, Math.round(wp.a * 200), Math.round(wp.ph * 200)].join(",") : ""].join("|"), function () {
    var G = stackGeom(x, y, w, h, t.k), base = waveAt(t, p);
    var pts = wp ? warped(base, wp.type, wp.a, wp.ph, 96) : base;
    return { line: framePts(G, p, pts), base: G.y0 - p * G.dy };
  });
  if (on) g.area(e.line, e.base, OSC_DK);
  g.poly(e.line, 2, on ? (c || OSC_LT) : MUTED);
}

// ---- the sound's modulations (mod_routes) ------------------------------------------------------------
var routeCache = { src: null, list: [] };
function routes(v) {
  var s = raw(v, "mod_routes");
  if (s !== routeCache.src) routeCache = { src: s, list: arr(v, "mod_routes") };
  return routeCache.list;
}
function amountKey(i) { return "modulation_" + i + "_amount"; }
var MOD_KEYS = []; for (var mi = 1; mi <= 16; mi++) MOD_KEYS.push(amountKey(mi));
// a modulation's amount, -1..1 of its destination's range (the matrix pages carry it)
function amountOf(v, r) { var k = amountKey(r.i); return known(v, k) ? clamp(num(v, k) / 64, -1, 1) : null; }
function routesFrom(v, src) { return routes(v).filter(function (r) { return r.src === src; }); }
function routesTo(v, dst) { return routes(v).filter(function (r) { return r.dst === dst; }); }
// how far the modulations of a control reach from where it stands (fractions of its range)
function modSpan(v, k) {
  var lo = 0, hi = 0, any = false;
  routesTo(v, k).forEach(function (r) {
    var a = amountOf(v, r);
    if (a === null) return;
    any = true;
    if (a > 0) hi += a; else lo += a;
  });
  return any ? { lo: lo, hi: hi } : null;
}
// a destination in a few letters, as a knob's caption has room for
function shortDest(s) {
  return up(s).replace(/^FILTER (\d)/, "F$1").replace(/^OSC (\d)/, "OSC$1").replace(/^ENV (\d)/, "ENV$1").replace(/^LFO (\d)/, "LFO$1")
    .replace("SPECTRAL", "SPEC").replace("RESONANCE", "RESO");
}

// ---- the editor's knob: a ring, the value an arc from its start (or centre),
// a white hand, and outside it the teal arc of what modulates it ----------------------------------------
var A0 = Math.PI * 0.75, SW = Math.PI * 1.5;
function isEnum(v, k) { return !!(v[k] && v[k].type === "enum"); }
function isBip(v, k) { return known(v, k) && v[k].min < 0 && v[k].max > 0; }
function knobStatic(g, cx, cy, r) {
  g.arc(cx, cy, r, A0, SW, 3, LINE);
  g.dot(cx, cy, r - 4, "#262a2e");
}
function knobValue(g, cx, cy, r, f, bip, c, span) {
  if (f === null) return;
  if (bip) {
    var mid = A0 + SW / 2, d = (f - 0.5) * SW;
    if (Math.abs(d) > 0.02) g.arc(cx, cy, r, d >= 0 ? mid : mid + d, Math.abs(d), 3, c);
  } else if (f > 0.004) g.arc(cx, cy, r, A0, SW * f, 3, c);
  if (span) {
    var a = clamp(f + span.lo, 0, 1), b = clamp(f + span.hi, 0, 1);
    if (b - a > 0.004) g.arc(cx, cy, r + 4, A0 + SW * a, SW * (b - a), 2, MODC);
  }
  var an = A0 + SW * f;
  g.line(cx + Math.cos(an) * 2, cy + Math.sin(an) * 2, cx + Math.cos(an) * (r - 5), cy + Math.sin(an) * (r - 5), 2, HI);
}

// The front panel's encoder row: under each encoder its name on a pill, the
// knob and its value; a macro also names what it drives. In segment mode
// Pung names the segments in the bottom 18 pixels: the row closes above them.
var ROW = 104;
function segOn(v) { return !!v.$segmode; }
function rowGeom(v) {
  var s = segOn(v);
  return { pill: ROW + (s ? 2 : 3), cy: ROW + (s ? 26 : 34), r: s ? 10 : 14, vy: ROW + (s ? 31 : 32), ty: ROW + 49, tgt: !s };
}
function knobName(v, k, names, i) {
  if (names && names[i]) return names[i];
  return String(v[k] ? v[k].name || "" : "").replace(/^(Osc \d|Filter \d|Env \d|LFO \d|Random \d|Sample) /, "");
}
function rowStatic(g, v, names) {
  var R = rowGeom(v), knobs = v.$knobs || [];
  g.fill(0, ROW, 960, 56, BG);
  for (var i = 1; i < 8; i++) g.fill(i * 120, ROW + 8, 1, segOn(v) ? 26 : 40, HEAD);
  for (var j = 0; j < 8; j++) {
    var k = knobs[j] || "";
    if (!k) continue;
    pill(g, j * 120 + 60, R.pill, up(knobName(v, k, names, j)), MUTED, HEAD, 112);
    if (isEnum(v, k)) box(g, j * 120 + 10, R.cy - 11, 100, 22, 4, BODY);
    else knobStatic(g, j * 120 + 24, R.cy, R.r);
  }
}
function rowLive(g, v, names, colors, captions) {
  var R = rowGeom(v), knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i] || "";
    if (!k) continue;
    var x = i * 120, on = k === t, c = (colors && colors[i]) || OSC;
    if (on) {
      pill(g, x + 60, R.pill, up(knobName(v, k, names, i)), "slot", HEAD, 112);
    }
    if (isEnum(v, k)) { // a menu, as the editor's: the choice in a box
      var d = disp(v, k) || "--";
      if (d === "On" || d === "Off") power(g, x + 24, R.cy, d === "On", c);
      g.value(d === "On" || d === "Off" ? x + 36 : x + 60, R.cy + 6, d, on ? "slot" : HI, d === "On" || d === "Off" ? -1 : 0, 92);
    } else {
      knobValue(g, x + 24, R.cy, R.r, known(v, k) ? v[k].frac : null, isBip(v, k), on ? "slot" : c, modSpan(v, k));
      g.value(x + 46, R.vy, withUnit(v, k), on ? "slot" : HI, -1, 70);
    }
    if (R.tgt && captions && captions[i]) g.text(x + 46, R.ty, captions[i], MODC, -1, 70);
  }
}

// ---- the front panel --------------------------------------------------------------------------------
var CARD_Y = 26, CARD_H = 74, OSC_X = [6, 212, 418], OSC_W = 200, FLT_X = 624, FLT_W = 162, ENV_X = 792, ENV_W = 162;
var ON_K = ["osc_1_on", "osc_2_on", "osc_3_on"], FR_K = ["osc_1_wave_frame", "osc_2_wave_frame", "osc_3_wave_frame"];
function soundName(v) { return disp(v, "preset_name") || "--"; }
function macroNames(v) {
  var info = obj(v, "patch_info");
  return [1, 2, 3, 4].map(function (i) { var s = info["macro" + i]; return s && String(s).trim() ? String(s) : "Macro " + i; });
}
// a filter's response as Pung draws it, from the model and where the blend
// stands (the 12 and 24 dB models morph low, band, high pass)
function filterKind(v, pre) {
  var t = disp(v, pre + "type"), b = frac(v, pre + "blend") * 2;
  if (/Notch/.test(t)) return "Notch";
  if (/B\/P\/N/.test(t)) return b < 1 ? "BP" : "Notch";
  if (/Low Shelf/.test(t)) return "LP 12 dB";
  if (/Low Cut/.test(t)) return "HP 12 dB";
  if (/Formant/.test(t)) return "BP";
  if (/Comb|Phaser/.test(t)) return "Notch";
  var pole = /24dB/.test(t) ? " 24 dB" : " 12 dB";
  return (b < 0.5 ? "LP" : b < 1.5 ? "BP" : "HP") + pole;
}
// the model's two words: its family and its style
function filterWords(v, pre) {
  var t = disp(v, pre + "type"), m = /^(\S+)\s+(.*)$/.exec(t);
  return m ? [up(m[1]), up(m[2]).replace("DB", " DB")] : [up(t), ""];
}
function segLit(v, id) { return v.$segmode === "segment" && v.$segment === id; }
function frontPanel(g, v) {
  var tbl = tables(v), names = arr(v, "wavetable_names"), info = obj(v, "patch_info"), mn = macroNames(v);
  var knobs = v.$knobs || [];
  var rowNames = knobs.map(function (k) { var m = /^macro_control_(\d)$/.exec(k || ""); return m ? mn[+m[1] - 1] : ""; });
  var captions = knobs.map(function (k) {
    var m = /^macro_control_(\d)$/.exec(k || "");
    if (!m) return "";
    var rs = routesFrom(v, k);
    return rs.length ? shortDest(rs[0].dest) + (rs.length > 1 ? " +" + (rs.length - 1) : "") : "";
  });
  var colors = knobs.map(function (k) { return /^filter_/.test(k || "") ? FLT : /^env_|^lfo_|^random_|^modulation_/.test(k || "") ? MODC : OSC; });
  var onS = ON_K.map(function (k) { return isOn(v, k); }), f1 = isOn(v, "filter_1_on");
  var key = ["vf", raw(v, "wave_view").length, raw(v, "wave_view").slice(0, 40), names.join("|"), onS.join(""), f1,
    soundName(v), disp(v, "bank_name"), info.preset_style || "", knobs.join(","), rowNames.join("|"), v.$page, (v.$pages || []).length,
    v.$segmode || ""].join("#");
  g.layer(key, function () {
    g.fill(0, 0, 960, 160, BG);
    // the header: the name, the sound in its display, its style and bank
    // the header as the editor has it: the sound in a display in the middle
    g.text(10, 15, "VIVACE", OSC, -1);
    var pages = v.$pages || [];
    if (pages.length > 1 && !segOn(v)) g.text(76, 15, up(pages[v.$page] || "") + "  " + (v.$page + 1) + "/" + pages.length, MUTED, -1, 200);
    box(g, 300, 2, 360, 19, 4, BODY);
    g.value(480, 17, soundName(v), HI, 0, 330);
    var st = up(info.preset_style || ""), bank = up(disp(v, "bank_name"));
    g.text(950, 15, bank, MUTED, 1, 200);
    if (st) pill(g, 950 - g.measure(bank) - 14 - (g.measure(st) + 14) / 2, 5, st, MUTED, HEAD);
    // the three oscillators
    for (var o = 0; o < 3; o++) {
      var x = OSC_X[o];
      section(g, x, CARD_Y, OSC_W, CARD_H, 15);
      power(g, x + 11, CARD_Y + 7.5, onS[o], OSC);
      g.text(x + 21, CARD_Y + 11, "OSC " + (o + 1), onS[o] ? TEXT : MUTED, -1);
      g.text(x + OSC_W - 8, CARD_Y + 11, up(names[o] || ""), onS[o] ? OSC_LT : FAINT, 1, OSC_W - 72);
      drawStack(g, x + 8, CARD_Y + 20, OSC_W - 16, 44, tbl ? tbl[o] : null, onS[o], 2);
      g.fill(x + 8, CARD_Y + 68, OSC_W - 16, 1, RULE);
    }
    // the first filter, the amplitude envelope
    section(g, FLT_X, CARD_Y, FLT_W, CARD_H, 15);
    power(g, FLT_X + 11, CARD_Y + 7.5, f1, FLT);
    section(g, ENV_X, CARD_Y, ENV_W, CARD_H, 15);
    g.dot(ENV_X + 11, CARD_Y + 7.5, 4, MODC);
    g.text(ENV_X + 21, CARD_Y + 11, "ENV 1", TEXT, -1);
    g.text(ENV_X + ENV_W - 8, CARD_Y + 11, "AMP", MUTED, 1);
    rowStatic(g, v, rowNames);
  });
  // the playing frames, and the span their modulations sweep under each
  for (var oo = 0; oo < 3; oo++) {
    var t = tbl ? tbl[oo] : null, x0 = OSC_X[oo] + 8, sw = OSC_W - 16, pos = num(v, FR_K[oo]), lit = hot(v, FR_K[oo]);
    drawPlayed(g, x0, CARD_Y + 20, sw, 44, t, pos, onS[oo], oo, warpOf(v, oo + 1), lit ? "slot" : OSC_LT);
    if (t) scrub(g, v, x0, CARD_Y + 68, sw, FR_K[oo], onS[oo], lit);
  }
  for (var s = 0; s < 3; s++) {
    if (segLit(v, "osc" + (s + 1))) g.text(OSC_X[s] + 21, CARD_Y + 11, "OSC " + (s + 1), "slot", -1);
    if (tbl && tbl[s]) bends(g, v, s + 1, OSC_X[s] + 10, CARD_Y + 29, onS[s]);
  }
  var fw = filterWords(v, "filter_1_");
  g.text(FLT_X + 21, CARD_Y + 11, "FILTER 1", segLit(v, "filter") ? "slot" : f1 ? TEXT : MUTED, -1);
  g.text(FLT_X + FLT_W - 8, CARD_Y + 11, /DB$/.test(fw[1]) ? fw[1] : fw[0], f1 ? mix(FLT, HI, 0.3) : FAINT, 1, 70);
  g.filter(FLT_X + 4, CARD_Y + 18, FLT_W - 8, CARD_H - 21, { cutoff: "filter_1_cutoff", resonance: "filter_1_resonance", type: filterKind(v, "filter_1_"), color: f1 ? FLT : MUTED });
  if (segLit(v, "env")) g.text(ENV_X + 21, CARD_Y + 11, "ENV 1", "slot", -1);
  g.envelope(ENV_X + 4, CARD_Y + 18, ENV_W - 8, CARD_H - 21, { delay: "env_1_delay", attack: "env_1_attack", hold: "env_1_hold", decay: "env_1_decay",
    sustain: "env_1_sustain", release: "env_1_release", color: MODC });
  rowLive(g, v, rowNames, colors, captions);
}
// what bends a table: its spectral morph and its warp, where they are on
function bends(g, v, n, x, y, on) {
  var p = "osc_" + n + "_", rows = [["spectral_morph_type", "spectral_morph_amount"], ["distortion_type", "distortion_amount"]], yy = y;
  for (var i = 0; i < 2; i++) {
    var t = disp(v, p + rows[i][0]);
    if (!t || t === "None") continue;
    var lit = hot(v, p + rows[i][0]) || hot(v, p + rows[i][1]);
    var name = up(t.replace("<-", "FROM").replace(/ Stretch$/, " STR."));
    g.text(x, yy, name, lit ? "slot" : on ? OSC_LT : FAINT, -1, 96);
    g.text(x + Math.min(96, g.measure(name)) + 6, yy, disp(v, p + rows[i][1]), lit ? "slot" : on ? MUTED : FAINT, -1);
    yy += 11;
  }
}
// a frame position on its track: where it stands, and the frames its
// modulations sweep, in teal
function scrub(g, v, x, y, w, k, on, lit) {
  var f = frac(v, k, 0), sp = modSpan(v, k);
  if (sp) {
    var a = clamp(f + sp.lo, 0, 1), b = clamp(f + sp.hi, 0, 1), c = on ? MODC : MOD_DK;
    g.fill(x + w * a, y, Math.max(1, w * (b - a)), 1, c);
    g.fill(x + w * a, y - 2, 1, 5, c);
    g.fill(x + w * b - 1, y - 2, 1, 5, c);
  }
  g.fill(x + w * f - 1, y - 3, 3, 7, lit ? "slot" : on ? HI : MUTED);
}

// ---- an oscillator ----------------------------------------------------------------------------------
// Its table large over the first three encoders (pitch, fine, frame); the
// frame it plays in 2D, under its warp, over the spectral and warp encoders;
// the unison voices over detune; where it goes and how loud over level.
// Its Shape and Unison pages show the same: the part a touched knob changes
// lights up.
var STACK_MULT = [[1, 1, 1, 1, 1, 1, 1, 1], [0.5, 1, 1, 1, 1, 1, 1, 1], [0.25, 1, 1, 1, 1, 1, 1, 1], [1, 2, 1, 2, 1, 2, 1, 2],
  [1, 2, 3, 1, 2, 3, 1, 2], [1, 1.49830707688, 2, 1, 1.49830707688, 2, 1, 1.49830707688],
  [1, 1.49830707688, 2, 2 * 1.49830707688, 4, 1, 1.49830707688, 2], [1, 1.25992104989, 1.49830707688, 2, 1, 1.25992104989, 1.49830707688, 2],
  [1, 1.189207115, 1.49830707688, 2, 1, 1.189207115, 1.49830707688, 2], [1, 2, 3, 4, 5, 6, 7, 8], [1, 3, 5, 7, 9, 11, 13, 15]];
var STACK_NAMES = ["Unison", "Center Drop 12", "Center Drop 24", "Octave", "2x Octave", "Power Chord", "2x Power Chord", "Major Chord", "Minor Chord", "Harmonics", "Odd Harmonics"];
function powerScale(t, p) { return Math.abs(p) < 0.01 ? t : (Math.exp(p * t) - 1) / (Math.exp(p) - 1); }
// The unison voices as SynthOscillator::setPhaseIncMults places them: pairs,
// one sharp and one flat, at the detune's power curve, each pair at its
// stack's interval; loud as setAmplitude makes them. In semitones.
function unisonVoices(v, p) {
  var u = clamp(Math.round(num(v, p + "unison_voices", 1)), 1, 16), active = u + (u % 2), half = active / 2;
  // the detune knob is quadratic (its display: 25% at half way), the power -5..5
  var range = num(v, p + "detune_range", 2 * 128 / 48) / 128 * 48, det = Math.pow(frac(v, p + "unison_detune", 0.42), 2), pw = (frac(v, p + "detune_power", 0.65) * 2 - 1) * 5;
  var style = Math.max(0, STACK_NAMES.indexOf(disp(v, p + "stack_style"))), mult = STACK_MULT[style];
  var b = frac(v, p + "unison_blend", 0.8), center = 1, detuned = 0;
  if (u > 2) {
    center = 1 + (0.4 - 1) * b;
    var db = (1 - b) * (1 - b);
    detuned = 0.6 * (1 - db);
    var adj = 1 / Math.sqrt(center * center + detuned * detuned * (half - 1));
    center *= adj; detuned *= adj;
  }
  var out = [], div = Math.max(1, u - 1), bump = u % 2 === 0 ? 1 : 0;
  for (var i = 0; i < half; i++) {
    var t = (2 * i + bump) / div, c = powerScale(t, pw) * range * det, st = 12 * Math.log(mult[i % 8]) / Math.LN2, lv = i === 0 ? center : detuned;
    out.push({ st: st + c, lv: lv });
    if (t > 0) out.push({ st: st - c, lv: lv }); // an odd stack's centre voice is one
  }
  return { voices: out, range: range, style: STACK_NAMES[style], u: u };
}
var OSC_SHAPE_KEYS = ["spectral_morph_type", "spectral_morph_spread", "spectral_morph_amount", "distortion_type", "distortion_spread", "distortion_phase", "distortion_amount"];
var OSC_UNI_KEYS = ["unison_voices", "unison_detune", "unison_blend", "stereo_spread", "frame_spread", "stack_style", "detune_power", "detune_range", "spectral_unison"];
function oscScreen(n) {
  var p = "osc_" + n + "_";
  return function (g, v) {
    var tbl = tables(v), t = tbl ? tbl[n - 1] : null, on = isOn(v, p + "on"), names = arr(v, "wavetable_names");
    var tn = up(names[n - 1] || "");
    g.layer(["os", n, raw(v, "wave_view").length, raw(v, "wave_view").slice(0, 40), on, tn].join("#"), function () {
      g.fill(0, 0, 952, 86, BG);
      section(g, 0, 0, 352, 86, 0);
      section(g, 356, 0, 236, 86, 0);
      section(g, 596, 0, 236, 86, 0);
      section(g, 836, 0, 116, 86, 0);
      power(g, 10, 9, on, OSC);
      g.text(20, 13, "OSC " + n, on ? TEXT : MUTED, -1);
      g.text(68, 13, tn, on ? OSC_LT : FAINT, -1, 200);
      drawStack(g, 12, 18, 328, 56, t, on, 1);
      g.fill(12, 79, 328, 1, RULE);
      g.text(604, 13, "UNISON", MUTED, -1);
      g.text(844, 13, "OUTPUT", MUTED, -1);
    });
    var fk = p + "wave_frame", pos = num(v, fk), wp = warpOf(v, n);
    drawPlayed(g, 12, 18, 328, 56, t, pos, on, n - 1 + 10, wp, hot(v, fk) ? "slot" : OSC_LT);
    if (t) {
      scrub(g, v, 12, 79, 328, fk, on, hot(v, fk));
      g.text(340, 13, t.n > 1 ? Math.round(pos) + " / " + (t.n - 1) : "ONE FRAME", hot(v, fk) ? "slot" : on ? TEXT : MUTED, 1);
    }
    // the frame in 2D, as it plays: warped; the frame as the table has it, faint behind
    var spT = disp(v, p + "spectral_morph_type") || "--", wT = disp(v, p + "distortion_type") || "--";
    var shapeHot = hotAny(v, OSC_SHAPE_KEYS.map(function (s) { return p + s; }));
    g.text(364, 13, wp ? "FRAME, WARPED" : "FRAME", shapeHot ? "slot" : MUTED, -1);
    if (t) {
      var dpt = Math.round(depthOf(t, pos) * 8) / 8;
      var e = cached(["2d", n, dpt, wp ? [wp.type, Math.round(wp.a * 200), Math.round(wp.ph * 200)].join(",") : ""].join("|"), function () {
        var base = waveAt(t, dpt), w = wp ? warped(base, wp.type, wp.a, wp.ph, 128) : null, L = [], B = [];
        var src = w || base, cx = 364, cw = 220, cy = 44, a = 24;
        for (var i = 0; i < src.length; i++) L.push(cx + cw * i / (src.length - 1), cy - src[i] * a);
        if (w) for (var j = 0; j < base.length; j++) B.push(cx + cw * j / (base.length - 1), cy - base[j] * a);
        return { line: L, base: B };
      });
      g.fill(364, 44, 220, 1, RULE);
      if (e.base.length) g.poly(e.base, 1, on ? OSC_MID : FAINT);
      g.area(e.line, 44, on ? OSC_DK : HEAD);
      g.poly(e.line, 2, on ? OSC : MUTED);
    }
    // under it, over the two encoders: the spectral morph and the warp, by name
    var spHot = hotIn(v, p + "spectral_morph"), wHot = hotIn(v, p + "distortion");
    g.text(364, 80, spT === "None" ? "NO MORPH" : up(spT), spHot ? "slot" : spT === "None" ? FAINT : OSC_LT, -1, 112);
    g.text(584, 80, wT === "None" ? "NO WARP" : up(wT.replace("<-", "FROM")), wHot ? "slot" : wT === "None" ? FAINT : OSC_LT, 1, 112);
    // the unison voices on a pitch line
    unisonPicture(g, v, p, 604, 18, 220, 62, on);
    // where it goes, how loud
    var dest = disp(v, p + "destination") || "--", lk = p + "level", pk = p + "pan";
    g.text(844, 32, "TO", MUTED, -1);
    g.text(862, 32, up(dest), hot(v, p + "destination") ? "slot" : on ? TEXT : MUTED, -1, 82);
    var lf = frac(v, lk), lx = 844, lw = 100;
    g.fill(lx, 48, lw, 3, RULE);
    g.fill(lx, 48, Math.max(2, lw * lf), 3, hot(v, lk) ? "slot" : on ? OSC : LINE);
    g.text(lx, 64, "LEVEL", MUTED, -1);
    g.text(lx + lw, 64, up(disp(v, lk)), hot(v, lk) ? "slot" : TEXT, 1);
    var pf = frac(v, pk, 0.5);
    g.fill(lx, 74, lw, 1, RULE);
    g.fill(lx + lw / 2, 71, 1, 7, LINE);
    g.dot(lx + lw * pf, 74.5, 3, hot(v, pk) ? "slot" : on ? OSC_LT : LINE);
    g.text(lx + lw, 84, pf === 0.5 ? "C" : up(disp(v, pk)), MUTED, 1);
    g.text(lx, 84, "PAN", MUTED, -1);
  };
}
function unisonPicture(g, v, p, x, y, w, h, on) {
  var U = unisonVoices(v, p), hotU = hotAny(v, OSC_UNI_KEYS.map(function (s) { return p + s; }));
  g.text(x + w, y - 5, U.u + (U.u === 1 ? " VOICE" : " VOICES"), hotU ? "slot" : on ? TEXT : MUTED, 1);
  var lo = 0, hi = 0;
  U.voices.forEach(function (o) { lo = Math.min(lo, o.st); hi = Math.max(hi, o.st); });
  // the axis: the detune range either side, wider where the stack reaches
  var span = Math.max(U.range, hi, -lo, 0.01), sym = hi <= U.range * 1.01 && lo >= -U.range * 1.01;
  var a = sym ? -span : lo - U.range * 0.2, b = sym ? span : hi + U.range * 0.2;
  if (!sym) { a = Math.min(a, -U.range); b = Math.max(b, U.range); }
  var base = y + h - 12, top = y + 4, X = function (st) { return x + 6 + (w - 12) * (st - a) / (b - a); };
  g.fill(x, base, w, 1, RULE);
  g.fill(X(0), top - 2, 1, base - top + 6, LINE);
  for (var i = U.voices.length - 1; i >= 0; i--) {
    var o = U.voices[i], hh = Math.max(3, (base - top) * clamp(o.lv, 0, 1));
    g.fill(Math.round(X(o.st)) - 1, base - hh, 2, hh, on ? (hotU ? "slot" : OSC) : LINE);
  }
  if (U.u === 1) return; // one voice: nothing detunes
  var label = U.style === "Unison" ? "DETUNE  " + up(disp(v, p + "unison_detune")) : up(U.style);
  g.text(x, y + h + 2, label, hot(v, p + "stack_style") ? "slot" : on ? MUTED : FAINT, -1, 130);
  if (sym) g.text(x + w, y + h + 2, "+-" + (Math.round(U.range * 10) / 10) + " ST", FAINT, 1);
  else for (var oc = 12; oc <= b; oc += 12) {
    g.fill(Math.round(X(oc)), base, 1, 4, LINE);
    if (X(oc) < x + w - 30 || oc + 12 > b) g.text(X(oc), y + h + 2, "+" + oc, FAINT, 0);
  }
}

// ---- the sources and where each goes: the routing as a matrix ------------------------------------------
// Over the first four encoders the sources (on or off), over the last four
// where each goes: one lit row in each column, so a row read across is what
// that destination hears.
var SRC = [["OSC 1", "osc_1_on", "osc_1_destination", 0], ["OSC 2", "osc_2_on", "osc_2_destination", 1],
  ["OSC 3", "osc_3_on", "osc_3_destination", 2], ["SAMPLE", "sample_on", "sample_destination", -1]];
var DEST_ROWS = ["FILTER 1", "FILTER 2", "EFFECTS", "DIRECT OUT"];
function destRows(d) {
  if (d === "Filter 1") return [0];
  if (d === "Filter 2") return [1];
  if (d === "Filter 1+2") return [0, 1];
  if (d === "Direct Out") return [3];
  return d ? [2] : []; // the effects, or one effect of their chain
}
function sourcesScreen(g, v) {
  var tbl = tables(v), names = arr(v, "wavetable_names");
  g.fill(0, 0, 952, 86, BG);
  for (var i = 0; i < 4; i++) {
    var s = SRC[i], on = isOn(v, s[1]), x = i * 120 - 4 + 4, lit = hot(v, s[1]);
    section(g, x, 0, 112, 86, 0);
    power(g, x + 10, 10, on, OSC);
    g.text(x + 20, 14, s[0], lit ? "slot" : on ? TEXT : MUTED, -1);
    var t = s[3] >= 0 && tbl ? tbl[s[3]] : null, pos = s[3] >= 0 ? num(v, "osc_" + (s[3] + 1) + "_wave_frame") : 0;
    if (t) {
      var e = cached(["src", s[3], Math.round(depthOf(t, pos) * 4)], function () {
        var w = waveAt(t, Math.round(depthOf(t, pos) * 4) / 4), L = [];
        for (var j = 0; j < w.length; j++) L.push(x + 8 + 96 * j / (w.length - 1), 46 - w[j] * 18);
        return L;
      });
      g.fill(x + 8, 46, 96, 1, RULE);
      g.area(e, 46, on ? OSC_DK : HEAD);
      g.poly(e, 2, on ? OSC : MUTED);
      g.text(x + 8, 80, up(names[s[3]] || ""), on ? OSC_LT : FAINT, -1, 100);
    } else if (s[3] < 0 && on) {
      g.text(x + 8, 80, "LEVEL " + up(disp(v, "sample_level")), OSC_LT, -1, 100);
    }
  }
  // the matrix: rows are destinations, columns the four outputs
  for (var c = 0; c < 4; c++) {
    var sx = 480 + c * 120, src = SRC[c], son = isOn(v, src[1]), d = disp(v, src[2]), rows = destRows(d), lk = hot(v, src[2]);
    section(g, sx, 0, 112, 86, 0);
    for (var r = 0; r < 4; r++) {
      var ry = 3 + r * 20.5, sel = rows.indexOf(r) >= 0;
      var label = r === 2 && sel && d !== "Effects" ? "FX " + up(d) : DEST_ROWS[r];
      if (sel) box(g, sx + 4, ry, 104, 17, 4, son ? (lk ? HEAD : OSC_DK) : HEAD);
      g.text(sx + 56, ry + 12, label, sel ? (lk ? "slot" : son ? HI : MUTED) : FAINT, 0, 100);
    }
  }
}

// ---- filters ----------------------------------------------------------------------------------------
// The filter of the page large, over its first five encoders; beside it the
// path through both: what each filter hears, whether one feeds the other,
// both responses small.
function feeds(v, n) {
  var out = [];
  for (var i = 0; i < 4; i++) {
    var d = disp(v, SRC[i][2]);
    if (isOn(v, SRC[i][1]) && (d === "Filter " + n || d === "Filter 1+2")) out.push(SRC[i][0] === "SAMPLE" ? "SMP" : SRC[i][0].replace(" ", ""));
  }
  return out;
}
var FORMANT_CORNERS = { "Formant AOIE": ["A", "O", "I", "E"], "Formant AIUO": ["A", "I", "U", "O"] };
function filterScreen(n) {
  var pre = n === 3 ? "filter_fx_" : "filter_" + n + "_";
  return function (g, v) {
    var on = n === 3 ? isOn(v, "filter_fx_on") : isOn(v, pre + "on"), words = filterWords(v, pre), type = disp(v, pre + "type");
    g.layer(["fl", n, on, type].join("#"), function () {
      g.fill(0, 0, 952, 86, BG);
      section(g, 0, 0, 592, 86, 0);
      section(g, 596, 0, 356, 86, 0);
    });
    var lit = hotIn(v, pre);
    power(g, 10, 9, on, FLT);
    g.text(20, 13, n === 3 ? "FX FILTER" : "FILTER " + n, lit ? "slot" : on ? TEXT : MUTED, -1);
    g.text(96, 13, words[0], on ? FLT : FAINT, -1);
    g.text(96 + g.measure(words[0]) + 8, 13, words[1], on ? mix(FLT, HI, 0.35) : FAINT, -1, 200);
    var corners = FORMANT_CORNERS[type];
    if (corners) formantPad(g, v, pre, corners, on);
    else g.filter(4, 16, 584, 68, { cutoff: pre + "cutoff", resonance: pre + "resonance", type: filterKind(v, pre), color: on ? FLT : MUTED });
    blendScale(g, v, pre, type, on, 556);
    if (n === 3) fxChainSide(g, v);
    else filterPath(g, v, n);
  };
}
// the blend: where a model stands between its responses (top right of the response)
function blendScale(g, v, pre, type, on, xr) {
  var ends = /Notch Blend/.test(type) ? ["LP", "NOTCH", "HP"] : /Notch Spread/.test(type) ? ["", "", ""] : /B\/P\/N/.test(type) ? ["BP", "PEAK", "NOTCH"] :
    /12dB|24dB/.test(type) ? ["LP", "BP", "HP"] : null;
  if (!ends || !ends[0]) return;
  var k = pre + "blend", f = frac(v, k), w = 120, x = xr - w, y = 9, h = hot(v, k);
  g.fill(x, y, w, 1, RULE);
  for (var i = 0; i < 3; i++) g.fill(x + w * i / 2, y - 2, 1, 5, LINE);
  g.dot(x + w * f, y + 0.5, 3, h ? "slot" : on ? FLT : LINE);
  g.text(x - 6, y + 4, ends[0], f < 0.25 ? (on ? TEXT : MUTED) : FAINT, 1);
  g.text(x + w + 6, y + 4, ends[2], f > 0.75 ? (on ? TEXT : MUTED) : FAINT, -1);
}
// a formant filter: where X and Y stand between its four vowels
function formantPad(g, v, pre, corners, on) {
  var x = 8, y = 18, w = 420, h = 62, fx = frac(v, pre + "formant_x", 0.5), fy = frac(v, pre + "formant_y", 0.5);
  box(g, x, y, w, h, 4, BG);
  g.fill(x + w / 2, y + 4, 1, h - 8, HEAD);
  g.fill(x + 4, y + h / 2, w - 8, 1, HEAD);
  var cx = [x + 12, x + w - 12, x + 12, x + w - 12], cy = [y + 14, y + 14, y + h - 6, y + h - 6];
  for (var i = 0; i < 4; i++) g.value(cx[i], cy[i], corners[i], on ? mix(FLT, HI, 0.3) : FAINT, 0);
  var hx = x + 24 + (w - 48) * fx, hy = y + 8 + (h - 16) * fy, hk = hot(v, pre + "formant_x") || hot(v, pre + "formant_y");
  g.fill(hx, y + 2, 1, h - 4, on ? FLT_DK : HEAD);
  g.fill(x + 2, hy, w - 4, 1, on ? FLT_DK : HEAD);
  g.dot(hx, hy, 5, hk ? "slot" : on ? FLT : LINE);
  g.text(x + w + 14, y + 12, "VOWEL", MUTED, -1);
  g.text(x + w + 14, y + 30, "X  " + up(disp(v, pre + "formant_x")), hot(v, pre + "formant_x") ? "slot" : on ? TEXT : MUTED, -1);
  g.text(x + w + 14, y + 44, "Y  " + up(disp(v, pre + "formant_y")), hot(v, pre + "formant_y") ? "slot" : on ? TEXT : MUTED, -1);
  g.text(x + w + 14, y + 58, "SHIFT " + up(disp(v, pre + "formant_transpose")), MUTED, -1, 140);
}
function filterPath(g, v, n) {
  var x = 596, rowY = [6, 48], bx = x + 124, bw = 150, bh = 32;
  for (var m = 1; m <= 2; m++) {
    var pre = "filter_" + m + "_", on = isOn(v, pre + "on"), y = rowY[m - 1], cur = m === n, srcs = feeds(v, m), mid = y + bh / 2;
    // what it hears, left, wired in
    g.text(x + 10, mid + 4, srcs.length ? srcs.join(" ") : "--", on && srcs.length ? TEXT : FAINT, -1, 104);
    if (srcs.length) g.fill(x + 112, mid, bx - x - 112, 1, on ? LINE : HEAD);
    // the filter, its response small
    box(g, bx, y, bw, bh, 4, cur ? HEAD : BG);
    g.filter(bx + 2, y + 2, bw - 4, bh - 4, { cutoff: pre + "cutoff", resonance: pre + "resonance", type: filterKind(v, pre), color: on ? (cur ? FLT : FLT_DK) : LINE });
    g.text(bx + 6, y + bh - 4, "F" + m, cur ? HI : MUTED, -1);
    // out, right
    g.fill(bx + bw, mid, 20, 1, on ? LINE : HEAD);
    // one filter hearing the other: an amber arrow between them
    if (isOn(v, pre + "filter_input")) {
      var ax = bx + bw - 30, from = m === 1 ? rowY[1] : rowY[0] + bh, to = m === 1 ? rowY[0] + bh : rowY[1];
      g.fill(ax, Math.min(from, to), 2, Math.abs(to - from), FLT);
      var d = to < from ? -1 : 1;
      g.poly([ax - 3, to - d * 4, ax + 1, to, ax + 5, to - d * 4], 2, FLT);
    }
  }
  var jx = bx + bw + 20, my = (rowY[0] + rowY[1] + bh) / 2;
  g.fill(jx, rowY[0] + bh / 2, 1, rowY[1] - rowY[0] + 1, LINE);
  g.fill(jx, my, 12, 1, LINE);
  g.text(jx + 16, my + 4, "OUT", MUTED, -1);
}
function fxChainSide(g, v) {
  g.text(606, 22, "IN THE EFFECTS CHAIN", MUTED, -1);
  g.text(606, 42, "KEYS " + up(disp(v, "filter_fx_keytrack")), TEXT, -1);
  g.text(606, 58, "DRIVE " + up(disp(v, "filter_fx_drive")), TEXT, -1);
  g.text(606, 74, "MIX " + up(disp(v, "filter_fx_mix")), TEXT, -1);
}

// ---- envelopes, LFOs, random: Pung's pictures, and what each moves ------------------------------------
// what a source moves: each destination with its amount, a bar from the centre
function targets(g, v, x, y, w, h, list, extra) {
  var rows = (extra || []).concat(list.map(function (r) { return { name: r.dest, amt: amountOf(v, r), key: amountKey(r.i) }; }));
  g.text(x, y + 11, "MODULATES", MUTED, -1);
  if (!rows.length) { g.text(x, y + 34, "NOTHING IN THIS SOUND", FAINT, -1); return; }
  var per = 17, max = Math.floor((h - 18) / per);
  for (var i = 0; i < rows.length && i < max; i++) {
    var yy = y + 31 + i * per, r = rows[i], lit = r.key && hot(v, r.key);
    g.text(x, yy, up(r.name), lit ? "slot" : TEXT, -1, w - 150);
    var bx = x + w - 140, bw = 90, c = bx + bw / 2;
    g.fill(bx, yy - 4, bw, 1, RULE);
    g.fill(c, yy - 7, 1, 7, LINE);
    if (r.amt !== null && r.amt !== undefined) {
      var d = r.amt * bw / 2;
      g.fill(d >= 0 ? c : c + d, yy - 6, Math.max(2, Math.abs(d)), 5, lit ? "slot" : MODC);
      g.text(x + w, yy, up(disp(v, r.key)), lit ? "slot" : MUTED, 1);
    } else if (r.fixed) { g.fill(c, yy - 6, bw / 2, 5, MOD_DK); g.text(x + w, yy, "ALWAYS", MUTED, 1); }
  }
  if (rows.length > max) g.text(x + w, y + 11, "+" + (rows.length - max) + " MORE", MUTED, 1);
}
function modFrame(g) {
  g.fill(0, 0, 952, 86, BG);
  section(g, 0, 0, 592, 86, 0);
  section(g, 596, 0, 356, 86, 0);
}
function envScreen(n) {
  var p = "env_" + n + "_";
  return function (g, v) {
    modFrame(g);
    g.envelope(4, 4, 584, 80, { delay: p + "delay", attack: p + "attack", hold: p + "hold", decay: p + "decay", sustain: p + "sustain",
      release: p + "release", labels: true, color: MODC });
    targets(g, v, 606, 2, 336, 82, routesFrom(v, "env_" + n), n === 1 ? [{ name: "Amplitude", fixed: true }] : []);
  };
}
function lfoScreen(n) {
  var p = "lfo_" + n + "_";
  return function (g, v) {
    var shapes = arr(v, "lfo_shapes"), shape = shapes[n - 1] || "Triangle", sync = disp(v, p + "sync"), mode = disp(v, p + "sync_type");
    modFrame(g);
    var o = { shape: shape, rate: p + "frequency", trig: mode === "Trigger" || mode === "Envelope" || mode === "Sustain Envelope", color: MODC };
    if (sync && sync !== "Seconds" && sync !== "Keytrack") { o.sync = p + "sync"; o.div = p + "tempo"; }
    g.lfo(4, 18, 584, 66, o);
    g.text(10, 13, up(shape), MOD_LT, -1);
    if (shape === "Custom") g.text(10 + g.measure("CUSTOM") + 8, 13, "DRAWN IN THE SOUND", MUTED, -1);
    var rate = sync === "Seconds" ? up(disp(v, p + "frequency")) : sync === "Keytrack" ? "KEYTRACK" :
      up(disp(v, p + "tempo")) + (sync === "Tempo Dotted" ? " DOTTED" : sync === "Tempo Triplets" ? " TRIPLET" : "");
    g.text(582, 13, up(mode) + "   " + rate, hotAny(v, [p + "sync", p + "frequency", p + "tempo", p + "sync_type"]) ? "slot" : TEXT, 1, 360);
    targets(g, v, 606, 2, 336, 82, routesFrom(v, "lfo_" + n));
  };
}
var RANDOM_SHAPE = { "Perlin": "Smooth", "Sample & Hold": "S&H", "Sine Interpolate": "Smooth", "Lorenz Attractor": "Noise" };
function randomScreen(n) {
  var p = "random_" + n + "_";
  return function (g, v) {
    var style = disp(v, p + "style");
    modFrame(g);
    g.lfo(4, 18, 584, 66, { shape: RANDOM_SHAPE[style] || "S&H", rate: p + "frequency", trig: isOn(v, p + "sync_type"), color: MODC });
    g.text(10, 13, up(style || "--"), hot(v, p + "style") ? "slot" : MOD_LT, -1);
    targets(g, v, 606, 2, 336, 82, routesFrom(v, "random_" + n));
  };
}

// ---- effects: the chain of nine, the one in the hands drawn as it works ---------------------------------
var FX = [
  { id: "chorus", name: "Chorus", on: "chorus_on", mix: "chorus_dry_wet", c: "#aa88ff" },
  { id: "compressor", name: "Compressor", on: "compressor_on", mix: "compressor_mix", c: "#1de9b6" },
  { id: "delay", name: "Delay", on: "delay_on", mix: "delay_dry_wet", c: "#ff99e9" },
  { id: "distortion", name: "Distortion", on: "distortion_on", mix: "distortion_mix", c: "#ff5252" },
  { id: "eq", name: "EQ", on: "eq_on", mix: null, c: "#fff6e1" },
  { id: "filter", name: "Filter", on: "filter_fx_on", mix: "filter_fx_mix", c: "#ffb74d" },
  { id: "flanger", name: "Flanger", on: "flanger_on", mix: "flanger_dry_wet", c: "#ffd740" },
  { id: "phaser", name: "Phaser", on: "phaser_on", mix: "phaser_dry_wet", c: "#40c4ff" },
  { id: "reverb", name: "Reverb", on: "reverb_on", mix: "reverb_dry_wet", c: "#8fa0ff" }];
var FX_PAGE = { "Chorus": 0, "Chorus +": 0, "Compressor": 1, "Comp Levels": 1, "Comp Ratios": 1, "Delay": 2, "Delay +": 2,
  "Distortion": 3, "EQ": 4, "EQ +": 4, "FX Filter": 5, "FX Filter +": 5, "Flanger": 6, "Phaser": 7, "Mod FX +": 7, "Reverb": 8, "Reverb +": 8 };
function fxChain(g, v, cur) {
  var w = 952 / 9;
  for (var i = 0; i < 9; i++) {
    var f = FX[i], x = Math.round(i * w), ww = Math.round((i + 1) * w) - x - 4, on = isOn(v, f.on), lit = i === cur;
    box(g, x, 0, ww, 22, 4, lit ? HEAD : BODY);
    if (lit) g.fill(x + 4, 0, ww - 8, 2, f.c);
    power(g, x + 10, 11, on, f.c);
    g.text(x + 19, 15, up(f.name), lit ? HI : on ? TEXT : FAINT, -1, ww - 22);
  }
}
function fxScreen(g, v) {
  var cur = FX_PAGE[(v.$pages || [])[v.$page]];
  if (cur === undefined) cur = 0;
  var f = FX[cur], on = isOn(v, f.on);
  g.fill(0, 0, 952, 86, BG);
  fxChain(g, v, cur);
  section(g, 0, 26, 952, 60, 0);
  // the effect's name and mix, left
  g.value(10, 46, f.name, on ? f.c : MUTED, -1, 150);
  g.text(10, 62, on ? "ON" : "OFF", on ? TEXT : FAINT, -1);
  if (f.mix) {
    var m = frac(v, f.mix), mh = hot(v, f.mix);
    g.text(44, 62, "MIX " + up(disp(v, f.mix)), mh ? "slot" : on ? TEXT : FAINT, -1);
    g.fill(10, 72, 120, 3, RULE);
    g.fill(10, 72, Math.max(2, 120 * m), 3, mh ? "slot" : on ? f.c : LINE);
  }
  var c = on ? f.c : LINE, dk = mix(BODY, on ? f.c : LINE, 0.3);
  var P = FX_PICTURES[f.id];
  if (P) P(g, v, 160, 30, 784, 52, c, dk, on);
}
// each effect as it works, from its own values
function axisHz(x, w, lo, hi) { var a = Math.log(lo), b = Math.log(hi); return function (hz) { return x + w * clamp((Math.log(hz) - a) / (b - a), 0, 1); }; }
function hz(v, k, lo, hi) {
  var d = disp(v, k), m = /([\d.]+)\s*(k?)Hz/i.exec(d);
  if (m) return parseFloat(m[1]) * (m[2] ? 1000 : 1);
  return lo * Math.pow(hi / lo, frac(v, k, 0.5));
}
function dB(v, k) { var m = /(-?[\d.]+)\s*dB/.exec(disp(v, k)); return m ? parseFloat(m[1]) : 0; }
var FX_PICTURES = {
  // the echoes: one a beat apart, each the feedback quieter; ping pong left and right
  delay: function (g, v, x, y, w, h, c, dk) {
    var fb = Math.abs(num(v, "delay_feedback", 0) / 64), style = disp(v, "delay_style"), pp = /Ping/.test(style);
    var base = pp ? y + h / 2 + 2 : y + h - 2, full = pp ? h / 2 - 6 : h - 14;
    g.fill(x, base, w * 0.8, 1, RULE);
    var lv = 1;
    for (var i = 0; i < 16 && lv > 0.02; i++) {
      var xx = x + 6 + i * (w * 0.8 - 12) / 15, hh = Math.max(1, full * lv), upw = !pp || i % 2 === 0;
      g.fill(xx - 1, upw ? base - hh : base + 1, 3, hh, i === 0 ? c : dk);
      lv *= fb;
    }
    if (pp) { g.text(x + w * 0.8 + 8, base - 6, "L", MUTED, -1); g.text(x + w * 0.8 + 8, base + 12, "R", MUTED, -1); }
    g.text(x + w, y + 8, up(style), MUTED, 1);
    g.text(x + w, y + 22, disp(v, "delay_sync") === "Seconds" ? up(disp(v, "delay_frequency")) : up(disp(v, "delay_tempo")), TEXT, 1);
    g.text(x + w, y + 36, "FEEDBACK " + up(disp(v, "delay_feedback")), MUTED, 1);
  },
  // the transfer curve: what the drive and the type do to a level
  distortion: function (g, v, x, y, w, h, c, dk) {
    var type = disp(v, "distortion_type"), drive = Math.pow(10, dB(v, "distortion_drive") / 20), cx = x + w / 2, cy = y + h / 2, sx = Math.min(w / 2, h * 2.2);
    var e = cached(["dist", type, Math.round(drive * 100), x, y, w, h].join("|"), function () {
      var L = [];
      for (var i = 0; i <= 80; i++) {
        var a = i / 40 - 1, z = a * drive, o;
        if (type === "Hard Clip") o = clamp(z, -1, 1);
        else if (type === "Linear Fold") { o = ((z + 1) % 4 + 4) % 4; o = o < 2 ? o - 1 : 3 - o; }
        else if (type === "Sine Fold") o = Math.sin(z * Math.PI / 2);
        else if (type === "Bit Crush") o = Math.round(a * 8) / 8;
        else if (type === "Down Sample") o = a;
        else o = Math.tanh(z);
        L.push(cx + a * sx, cy - o * (h / 2 - 2));
      }
      return L;
    });
    g.fill(cx - sx, cy, sx * 2, 1, RULE);
    g.fill(cx, y, 1, h, RULE);
    g.poly([cx - sx, cy + h / 2 - 2, cx + sx, cy - h / 2 + 2], 1, LINE);
    g.poly(e, 2, c);
    g.text(x + w, y + 8, up(type), MUTED, 1);
    g.text(x, y + 8, "IN > OUT", FAINT, -1);
  },
  // Pung's filter, in the effect's amber
  filter: function (g, v, x, y, w, h, c) {
    g.filter(x, y - 2, w, h + 4, { cutoff: "filter_fx_cutoff", resonance: "filter_fx_resonance", type: filterKind(v, "filter_fx_"), color: c });
    g.text(x + w, y + 8, up(disp(v, "filter_fx_type")), MUTED, 1);
  },
  // the three bands on the spectrum: where each sits, how far up or down
  eq: function (g, v, x, y, w, h, c, dk) {
    var X = axisHz(x, w, 20, 20000), mid = y + h / 2;
    g.fill(x, mid, w, 1, RULE);
    [[100, "100"], [1000, "1K"], [10000, "10K"]].forEach(function (t) { g.fill(X(t[0]), y, 1, h, HEAD); g.text(X(t[0]) + 4, y + h + 2, t[1], FAINT, -1); });
    [[100, "LOW", "eq_low_cutoff", "eq_low_gain", "eq_low_mode"], [1000, "BAND", "eq_band_cutoff", "eq_band_gain", "eq_band_mode"],
      [10000, "HIGH", "eq_high_cutoff", "eq_high_gain", "eq_high_mode"]].forEach(function (b) {
      var xx = X(hz(v, b[2], 8, 21000)), gn = dB(v, b[3]) / 15, yy = mid - gn * (h / 2 - 6), lit = hot(v, b[2]) || hot(v, b[3]);
      g.fill(xx, Math.min(mid, yy), 1, Math.abs(yy - mid) + 1, dk);
      g.dot(xx, yy, 4, lit ? "slot" : c);
      g.text(xx + 8, yy + 4, b[1] + (disp(v, b[4]) ? " " + up(disp(v, b[4])) : ""), MUTED, -1, 120);
    });
  },
  // each band a line of levels (-80 to 0 dB): under its lower threshold the
  // sound is lifted, over its upper one pressed down
  compressor: function (g, v, x, y, w, h, c, dk) {
    var bands = [["LOW", "low"], ["BAND", "band"], ["HIGH", "high"]], which = disp(v, "compressor_enabled_bands");
    var use = which === "Low Band" ? [0, 1] : which === "High Band" ? [1, 2] : which === "Single Band" ? [1] : [0, 1, 2];
    var X = function (db) { return x + 60 + (w - 150) * clamp((db + 80) / 80, 0, 1); }, rh = Math.floor(h / 3);
    for (var i = 0; i < 3; i++) {
      var yy = y + i * rh + rh / 2, act = use.indexOf(i) >= 0, b = bands[i][1];
      var up1 = X(dB(v, "compressor_" + b + "_upper_threshold")), lo1 = X(dB(v, "compressor_" + b + "_lower_threshold"));
      g.text(x, yy + 4, single(i, which) ? "SINGLE" : bands[i][0], act ? TEXT : FAINT, -1);
      g.fill(X(-80), yy, X(0) - X(-80), 1, RULE);
      if (act) {
        g.fill(X(-80), yy - 3, lo1 - X(-80), 7, mix(BODY, c, 0.14));
        g.fill(up1, yy - 3, X(0) - up1, 7, dk);
        g.fill(lo1 - 1, yy - 5, 2, 11, mix(c, BODY, 0.35));
        g.fill(up1 - 1, yy - 5, 2, 11, c);
        g.text(x + w, yy + 4, up(disp(v, "compressor_" + b + "_gain")), MUTED, 1);
      }
    }
  },
  // the sweep: between where the effect's centre goes and how deep it moves it
  phaser: function (g, v, x, y, w, h, c, dk) { sweep(g, v, "phaser", x, y, w, h, c, dk); },
  flanger: function (g, v, x, y, w, h, c, dk) { sweep(g, v, "flanger", x, y, w, h, c, dk); },
  chorus: function (g, v, x, y, w, h, c, dk) {
    // its voices between the two delays, as the chorus spreads them
    var n = Math.max(1, parseInt(disp(v, "chorus_voices"), 10) || 4), d1 = frac(v, "chorus_delay_1"), d2 = frac(v, "chorus_delay_2");
    var mid = y + h / 2 + 6, a = Math.min(d1, d2), b = Math.max(d1, d2);
    g.fill(x, mid, w, 1, RULE);
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 0.5 : i / (n - 1), xx = x + 20 + (w - 40) * (a + (b - a) * t), hh = h / 2 - 12;
      g.fill(xx - 1, mid - hh, 2, hh * 2, i % 2 ? dk : c);
    }
    g.text(x, y + 8, up(disp(v, "chorus_delay_1")), MUTED, -1);
    g.text(x + w, y + 8, up(disp(v, "chorus_delay_2")), MUTED, 1);
    g.text(x + w / 2, y + 8, n + " VOICES   DEPTH " + up(disp(v, "chorus_mod_depth")), MUTED, 0);
  },
  // the space: its tail falling 60 dB over the decay time after the pre-delay
  // (on 8 seconds), and the band of the sound it takes in
  reverb: function (g, v, x, y, w, h, c, dk) {
    var dec = secs(disp(v, "reverb_decay_time"), 1), pre = secs(disp(v, "reverb_delay"), 0), T = 8, bw = w * 0.6, base = y + h - 10, top = y + 4;
    g.fill(x, base, bw, 1, RULE);
    for (var i = 0; i < 64; i++) {
      var ts = pre + i * T / 64, lvl = Math.exp(-6.9 * (ts - pre) / Math.max(0.02, dec));
      if (ts > T || lvl < 0.01) break;
      g.fill(x + bw * ts / T, base - (base - top) * lvl, 2, Math.max(1, (base - top) * lvl), i === 0 ? c : dk);
    }
    g.text(x, base + 10, "0", FAINT, -1);
    g.text(x + bw, base + 10, "8 S", FAINT, 1);
    var bx = x + w * 0.68, bww = w * 0.32, X = axisHz(bx, bww, 20, 20000);
    var lo = X(hz(v, "reverb_pre_low_cutoff", 8, 13300)), hi = X(hz(v, "reverb_pre_high_cutoff", 8, 13300));
    g.fill(bx, base, bww, 1, RULE);
    g.fill(Math.min(lo, hi), base - 16, Math.max(2, Math.abs(hi - lo)), 16, dk);
    g.fill(Math.min(lo, hi), base - 16, Math.max(2, Math.abs(hi - lo)), 2, c);
    g.text(bx, base + 10, "20 HZ", FAINT, -1);
    g.text(bx + bww, base + 10, "20 KHZ", FAINT, 1);
    g.text(bx, y + 8, "IT HEARS", MUTED, -1);
  }
};
function secs(s, d) { var m = /([\d.]+)\s*(ms|s)\b/.exec(s || ""); return m ? parseFloat(m[1]) / (m[2] === "ms" ? 1000 : 1) : d; }
function single(i, which) { return which === "Single Band" && i === 1; }
function sweep(g, v, id, x, y, w, h, c, dk) {
  var X = axisHz(x, w, 20, 20000), mid = y + h / 2;
  var center = hz(v, id + "_center", 8, 13000), depth = num(v, id + "_mod_depth", 0);
  var st = /([\d.]+)\s*st/.exec(disp(v, id + "_mod_depth")), d = st ? parseFloat(st[1]) : depth / 128 * 48;
  var lo = center / Math.pow(2, d / 24), hi = center * Math.pow(2, d / 24);
  g.fill(x, mid, w, 1, RULE);
  g.fill(X(lo), mid - 10, Math.max(2, X(hi) - X(lo)), 20, dk);
  g.fill(X(center) - 1, y + 4, 2, h - 8, c);
  g.text(X(center) + 6, y + 12, up(disp(v, id + "_center")), MUTED, -1);
  g.text(x + w, y + h, "FEEDBACK " + up(disp(v, id + "_feedback")) + "   " + (disp(v, id + "_sync") === "Seconds" ? up(disp(v, id + "_frequency")) : up(disp(v, id + "_tempo"))), MUTED, 1);
}

// ---- the matrix: one route over each encoder ------------------------------------------------------------
function splitDest(s) {
  var m = /^((?:Osc|Filter|Env|LFO|Random|Macro|FX|Sample)\s*\d*)\s+(.*)$/i.exec(s || "");
  return m ? [up(m[1]), up(m[2])] : [up(s), ""];
}
function matrixScreen(first) {
  return function (g, v) {
    var by = {};
    routes(v).forEach(function (r) { by[r.i] = r; });
    g.fill(0, 0, 952, 86, BG);
    for (var j = 0; j < 8; j++) {
      var i = first + j, r = by[i], x = j * 120, k = amountKey(i), lit = hot(v, k);
      section(g, x, 0, 112, 86, 0);
      g.text(x + 8, 12, String(i), FAINT, -1);
      if (!r) { g.text(x + 56, 48, "EMPTY", FAINT, 0); continue; }
      box(g, x + 22, 2, 86, 14, 6, MOD_DK);
      g.text(x + 65, 12, up(r.source), lit ? "slot" : MOD_LT, 0, 80);
      g.fill(x + 56, 17, 1, 6, MOD_MID);
      g.poly([x + 52, 21, x + 56, 25, x + 60, 21], 1, MOD_MID);
      var d = splitDest(r.dest);
      g.text(x + 56, 37, d[0], TEXT, 0, 104);
      g.text(x + 56, 50, d[1], TEXT, 0, 104);
      var a = amountOf(v, r), bx = x + 8, bw = 96, c = bx + bw / 2;
      g.fill(bx, 66, bw, 1, RULE);
      g.fill(c, 62, 1, 9, LINE);
      if (a !== null) {
        g.fill(a >= 0 ? c : c + a * bw / 2, 64, Math.max(2, Math.abs(a) * bw / 2), 5, lit ? "slot" : MODC);
        g.text(x + 56, 82, up(disp(v, k)), lit ? "slot" : MUTED, 0);
      }
    }
  };
}

// ---- how the values read (push.display) -----------------------------------------------------------------
push.display(function (key, rawv) {
  var n = parseFloat(rawv);
  if (isNaN(n)) return;
  if (/_transpose$/.test(key) && !/formant|blend/.test(key)) return { value: (n > 0 ? "+" : "") + Math.round(n), unit: "st" };
  if (key === "pitch_bend_range") return { value: String(Math.round(n)), unit: "st" };
});

// ---- Pung's envelope on the synth's own times ----------------------------------------------------------
// An envelope knob's position (0..128) is the engine's value v over its
// range; the stage then takes v^4 seconds (the engine's quartic scale).
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    var m = /^env_\d_(attack|decay|release|hold|delay)$/.exec(s.key || "");
    if (!m || s.raw === null || s.raw === undefined) return null;
    var range = (m[1] === "hold" || m[1] === "delay") ? 1.4142135624 : 2.37842;
    var x = parseFloat(s.raw) / 128 * range;
    return isNaN(x) ? null : x * x * x * x;
  });
});

// ---- the compartments -------------------------------------------------------------------------------------
var SOUND = ["preset_name", "bank_name", "patch_info", "wave_view", "wavetable_names", "mod_routes"].concat(MOD_KEYS, ON_K, FR_K,
  ["filter_1_on", "filter_1_type", "filter_1_cutoff", "filter_1_resonance", "filter_1_blend",
    "env_1_delay", "env_1_attack", "env_1_hold", "env_1_decay", "env_1_sustain", "env_1_release"]);
[1, 2, 3].forEach(function (n) { ["distortion_type", "distortion_amount", "distortion_phase"].forEach(function (s) { SOUND.push("osc_" + n + "_" + s); }); });
// Pung's own pages in the editor's colours: its knobs (a cap, the hand, the arc), its violet
push.theme({ ground: "#16191c", panel: "#262a2e", ink: TEXT, dim: MUTED, rule: LINE, faint: HEAD, accent: OSC, knob: "pointer" });
push.compartment({
  id: "panel", label: "Vivace", front_panel: true, draws_segments: true,
  pages: pagesOf("play"), extra_keys: SOUND,
  // the panel's sections, each one press away (Pung draws the bar over the one in the hands)
  segments: [
    { id: "osc1", label: "Osc 1", rect: [OSC_X[0], CARD_Y, OSC_W, CARD_H], keys: pageKeys("Osc 1") },
    { id: "osc2", label: "Osc 2", rect: [OSC_X[1], CARD_Y, OSC_W, CARD_H], keys: pageKeys("Osc 2") },
    { id: "osc3", label: "Osc 3", rect: [OSC_X[2], CARD_Y, OSC_W, CARD_H], keys: pageKeys("Osc 3") },
    { id: "filter", label: "Filter 1", rect: [FLT_X, CARD_Y, FLT_W, CARD_H], keys: pageKeys("Filter 1") },
    { id: "env", label: "Env 1", rect: [ENV_X, CARD_Y, ENV_W, CARD_H], keys: pageKeys("Env 1") }
  ],
  screen: frontPanel
});
var OSC_EXTRA = ["wave_view", "wavetable_names", "mod_routes", "sample_on", "sample_destination", "sample_level"].concat(MOD_KEYS);
[1, 2, 3].forEach(function (n) {
  var p = "osc_" + n + "_";
  ["on", "destination", "level", "pan", "wave_frame"].concat(OSC_SHAPE_KEYS, OSC_UNI_KEYS).forEach(function (s) { OSC_EXTRA.push(p + s); });
});
push.compartment({
  id: "osc", label: "Oscillators", extra_keys: OSC_EXTRA,
  pages: pagesOf("osc").map(function (pg) {
    var m = /^Osc (\d)/.exec(pg.label);
    if (m) return { label: pg.label, keys: pg.keys, screen: oscScreen(+m[1]) };
    if (pg.label === "Sources") return { label: pg.label, keys: pg.keys, screen: sourcesScreen };
    return { label: pg.label, keys: pg.keys };
  })
});
var FLT_EXTRA = ["osc_1_on", "osc_2_on", "osc_3_on", "sample_on", "osc_1_destination", "osc_2_destination", "osc_3_destination",
  "sample_destination", "filter_1_filter_input", "filter_2_filter_input"];
[1, 2].forEach(function (n) {
  ["on", "type", "cutoff", "resonance", "blend", "formant_x", "formant_y", "formant_transpose"].forEach(function (s) { FLT_EXTRA.push("filter_" + n + "_" + s); });
});
push.compartment({
  id: "filter", label: "Filters", extra_keys: FLT_EXTRA,
  pages: pagesOf("filter").map(function (pg) { return { label: pg.label, keys: pg.keys, screen: filterScreen(/2/.test(pg.label) ? 2 : 1) }; })
});
push.compartment({
  id: "env", label: "Envelopes", extra_keys: ["mod_routes"].concat(MOD_KEYS, [1, 2, 3, 4, 5, 6].map(function (n) { return "env_" + n + "_delay"; })),
  pages: pagesOf("env").map(function (pg) {
    var m = /^Env (\d)$/.exec(pg.label);
    if (!m) return { label: pg.label, keys: pg.keys };
    return { label: pg.label, keys: pg.keys, screen: envScreen(+m[1]) };
  })
});
push.compartment({
  id: "lfo", label: "Modulators", extra_keys: ["mod_routes", "lfo_shapes"].concat(MOD_KEYS),
  pages: pagesOf("lfo").map(function (pg) {
    var m = /^LFO (\d)$/.exec(pg.label), r = /^Random (\d)$/.exec(pg.label);
    if (m) return { label: pg.label, keys: pg.keys, screen: lfoScreen(+m[1]) };
    if (r) return { label: pg.label, keys: pg.keys, screen: randomScreen(+r[1]) };
    return { label: pg.label, keys: pg.keys };
  })
});
var FX_EXTRA = [];
pagesOf("fx").forEach(function (pg) { FX_EXTRA = FX_EXTRA.concat(pg.keys); });
push.compartment({
  id: "fx", label: "Effects", extra_keys: FX_EXTRA,
  pages: pagesOf("fx").map(function (pg) {
    return { label: pg.label, keys: pg.keys, screen: fxScreen };
  })
});
push.compartment({
  id: "matrix", label: "Matrix", extra_keys: ["mod_routes"].concat(MOD_KEYS),
  pages: pagesOf("matrix").map(function (pg) {
    var m = /^Matrix (\d+)/.exec(pg.label);
    return { label: pg.label, keys: pg.keys, screen: matrixScreen(+m[1]) };
  })
});
push.compartment({ id: "voice", label: "Voice", pages: pagesOf("voice") });
