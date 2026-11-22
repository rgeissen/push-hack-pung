// Vivace (a spectral warping wavetable synthesizer) on Push.
//
// The instrument is its oscillators: three wavetables, each a stack of up to
// 257 single-cycle frames that a knob (or a modulation) scans through, then
// bent in the spectrum (spectral morph) and in time (phase warp). So the
// device opens on the three tables as the synth's own editor draws them, in
// three dimensions: the frames receding in a stack, the one the oscillator
// plays now lit, an oscillator that is off a ghost. Beside them the first
// filter's response (Pung's, live behind its spectrum), the sound's name and
// its four macros, which the encoders play.
//
// The other screens follow the synth's own sections. An oscillator's pages
// show its table large with the frame it plays in 2D beside it, its spectral
// and warp modes, the unison stack; the sources page is the routing, which
// filter each source goes through. The filter pages show both filters and
// what feeds them; envelopes and LFOs are Pung's own pictures, each with the
// destinations the sound sends it to, as the synth draws a modulation
// beside its source; the effects are the chain of nine, the lit ones on;
// the matrix pages are the sound's routes. The wavetables are the engine's
// own frames (wave_view: 17 frames across each table, 64 points a frame).
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

// ---- colours: a dark slate panel, lilac for what sounds, amber for modulation ----------
var GROUND = "#141518", PANEL = "#202125", PANEL2 = "#292a2f", HEAD = "#2f3036", RULE = "#3b3c43";
var LILAC = "#a58cf5", LILAC_LT = "#d6cbff", LILAC_DK = "#46397a", LILAC_GH = "#2e2847";
var MOD = "#f0b03a", MOD_DK = "#6b4e14";
var STACK = "#4d3f86", STACK_HI = "#7564bd";
var INK = "#ecebf2", DIM = "#9a98a6", MUTE = "#6d6b77", FAINT = "#4a4952";
var ON = "#7ee0a1";

function known(v, k) { return !!(k && v[k] && v[k].known); }
function frac(v, k, d) { return known(v, k) ? v[k].frac : (d === undefined ? 0 : d); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value || "") : ""; }
function raw(v, k) { return known(v, k) ? String(v[k].value || "") : ""; }
function num(v, k, d) { var n = parseFloat(raw(v, k)); return isNaN(n) ? (d || 0) : n; }
function up(s) { return String(s || "").toUpperCase(); }
function hot(v, k) { return !!k && v.$touched === k; }
function hotIn(v, pre) { var t = v.$touched || ""; return t !== "" && t.indexOf(pre) === 0; }
function isOn(v, k) { return disp(v, k) === "On"; }
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
function keysOf(list) { var o = []; list.forEach(function (p) { o = o.concat(p.keys); }); return o; }
function pagesOf(c) { return PAGES.filter(function (p) { return p.c === c; }); }

// ---- the wavetables (wave_view) -----------------------------------------------------------
var tableCache = { src: null, tables: null };
function tables(v) {
  var s = raw(v, "wave_view");
  if (s === tableCache.src) return tableCache.tables;
  var out = null;
  try {
    var j = JSON.parse(s);
    if (!j || !Array.isArray(j.tables)) throw "no tables";
    out = j.tables.map(function (t) {
      var frames = [];
      for (var f = 0; f < t.k; f++) {
        var pts = [];
        for (var i = 0; i < 64; i++) pts.push((parseInt(t.w.substr((f * 64 + i) * 2, 2), 16) - 128) / 127);
        frames.push(pts);
      }
      return { n: t.frames, frames: frames };
    });
  } catch (e) { out = null; }
  tableCache = { src: s, tables: out };
  polyCache = {};
  return out;
}
// the frame a position plays, among the 17 drawn: its index
function frameAt(t, pos) {
  if (!t || t.frames.length < 2) return 0;
  var p = Math.max(0, Math.min(1, pos / Math.max(1, t.n - 1)));
  return Math.round(p * (t.frames.length - 1));
}
// The synth's 3D view: the frames receding up and to the right, the first in
// front; the one being played lit, over the stack.
function stackGeom(x, y, w, h, n) {
  var depthX = n > 1 ? w * 0.24 : 0, depthY = n > 1 ? h * 0.42 : h * 0.1, ww = w - depthX, amp = (h - depthY) * 0.42;
  return { dx: n > 1 ? depthX / (n - 1) : 0, dy: n > 1 ? depthY / (n - 1) : 0, ww: ww, amp: amp, x0: x, y0: y + h - amp - 2 };
}
function framePoly(G, f, pts, step) {
  var out = [], ox = G.x0 + f * G.dx, oy = G.y0 - f * G.dy, n = pts.length, st = step || 1;
  for (var i = 0; i < n; i += st) out.push(ox + G.ww * i / (n - 1), oy - pts[i] * G.amp);
  out.push(ox + G.ww, oy - pts[n - 1] * G.amp);
  return out;
}
// the stack: every frame where it is large (an oscillator's page), every
// other frame at half the points where three share the panel (a draw's
// budget: the layer draws it once a sound)
function drawStack(g, x, y, w, h, t, on, sparse) {
  if (!t) { g.text(x + w / 2, y + h / 2 + 4, "READING THE TABLE", FAINT, 0); return; }
  var n = t.frames.length, G = stackGeom(x, y, w, h, n), every = sparse && n > 9 ? 2 : 1;
  for (var f = n - 1; f >= 0; f -= every)
    g.poly(framePoly(G, f, t.frames[f], sparse ? 2 : 1), 1, on ? (f % 4 === 0 ? STACK_HI : STACK) : FAINT);
}
var polyCache = {};
function cached(key, fn) {
  var e = polyCache[key];
  if (!e) { e = fn(); polyCache[key] = e; }
  return e;
}
function drawPlayed(g, x, y, w, h, t, pos, on, c, osc) {
  if (!t) return;
  var f = frameAt(t, pos);
  var pts = cached(["p", osc, x, y, w, h, f].join("|"), function () {
    return framePoly(stackGeom(x, y, w, h, t.frames.length), f, t.frames[f]);
  });
  g.poly(pts, 2, on ? (c || LILAC_LT) : DIM);
}

// ---- Vivace's knobs: a ring with the value as an arc, as the synth's own ----------------
var ROW = 104;
function ring(g, cx, cy, r, f, bip, c, track) {
  var a0 = Math.PI * 0.75, sw = Math.PI * 1.5;
  g.arc(cx, cy, r, a0, sw, 3, track || RULE);
  if (f === null) return;
  if (bip) {
    var mid = a0 + sw / 2, d = (f - 0.5) * sw;
    if (d >= 0) g.arc(cx, cy, r, mid, Math.max(0.04, d), 3, c);
    else g.arc(cx, cy, r, mid + d, -d, 3, c);
  } else if (f > 0.002) g.arc(cx, cy, r, a0, sw * f, 3, c);
  var a = a0 + sw * f;
  g.line(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8), cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), 2, INK);
}
function isBip(v, k) { var d = disp(v, k); return /^[+-]/.test(d) || (d === "0%" && /pan|keytrack|velocity|tune/.test(k)); }
function knobGround(g, v, names) {
  g.fill(0, ROW, 960, 56, PANEL);
  g.fill(0, ROW, 960, 1, RULE);
  var knobs = v.$knobs || [];
  for (var i = 1; i < 8; i++) g.fill(i * 120, ROW + 8, 1, 40, RULE);
  for (var j = 0; j < 8; j++) {
    var k = knobs[j] || "", nm = names && names[j] ? names[j] : (k && v[k] ? (v[k].name || "") : "");
    if (nm) g.text(j * 120 + 60, ROW + 14, up(nm), DIM, 0, 112);
  }
}
function knobRow(g, v, names, values) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i] || "";
    if (!k) continue;
    var on = k === t, x = i * 120, cx = x + 26, cy = ROW + 35;
    if (on) {
      g.fill(x + 6, ROW + 4, 108, 13, PANEL2);
      var nm = names && names[i] ? names[i] : (v[k] ? v[k].name || "" : "");
      g.text(x + 60, ROW + 14, up(nm), "slot", 0, 108);
    }
    ring(g, cx, cy, 14, known(v, k) ? v[k].frac : null, isBip(v, k), on ? "slot" : LILAC);
    g.value(x + 82, ROW + 40, values && values[i] ? values[i] : up(withUnit(v, k)), on ? "slot" : INK, 0, 70);
  }
}

// ---- the routes the sound modulates by (mod_routes) --------------------------------------
var routeCache = { src: null, list: [] };
function routes(v) {
  var s = raw(v, "mod_routes");
  if (s !== routeCache.src) routeCache = { src: s, list: arr(v, "mod_routes") };
  return routeCache.list;
}
function routesFrom(v, src) { return routes(v).filter(function (r) { return r.src === src; }); }
function amountKey(i) { return "modulation_" + i + "_amount"; }
var MOD_KEYS = []; for (var mi = 1; mi <= 16; mi++) MOD_KEYS.push(amountKey(mi));
// a modulation's amount, -1..1, where the matrix pages carry it
function amountOf(v, r) { var k = amountKey(r.i); return known(v, k) ? (v[k].frac * 2 - 1) : null; }
// what a source moves: a list of its destinations, each with its amount as a bar
function targets(g, v, x, y, w, h, list, extra) {
  var rows = (extra || []).concat(list.map(function (r) { return { name: r.dest, amt: amountOf(v, r) }; }));
  g.text(x, y + 10, "MODULATES", MUTE, -1);
  if (!rows.length) { g.text(x, y + 30, "NOTHING YET", FAINT, -1); return; }
  var per = 15, max = Math.floor((h - 16) / per);
  for (var i = 0; i < rows.length && i < max; i++) {
    var yy = y + 26 + i * per, r = rows[i];
    g.text(x, yy, up(r.name), INK, -1, w - 70);
    var bx = x + w - 60, bw = 56;
    g.fill(bx, yy - 5, bw, 3, RULE);
    if (r.amt !== null && r.amt !== undefined) {
      var c = bx + bw / 2, d = r.amt * bw / 2;
      g.fill(d >= 0 ? c : c + d, yy - 6, Math.max(2, Math.abs(d)), 5, MOD);
    } else if (r.fixed) g.fill(bx, yy - 6, bw, 5, MOD_DK);
  }
  if (rows.length > max) g.text(x + w, y + 10, "+" + (rows.length - max) + " MORE", MUTE, 1);
}

// ---- the front panel: the three tables, the filter, the sound -----------------------------
var OSC_X = [8, 246, 484], OSC_W = 230;
function soundName(v) { return disp(v, "preset_name") || "--"; }
function frontPanel(g, v) {
  var tbl = tables(v), info = obj(v, "patch_info");
  var names = arr(v, "wavetable_names");
  var onK = ["osc_1_on", "osc_2_on", "osc_3_on"], frK = ["osc_1_wave_frame", "osc_2_wave_frame", "osc_3_wave_frame"];
  var macroNames = [1, 2, 3, 4].map(function (i) { var s = info["macro" + i]; return s && s.trim() ? s : "MACRO " + i; });
  var rowNames = (v.$knobs || []).map(function (k) {
    var m = /^macro_control_(\d)$/.exec(k || "");
    return m ? macroNames[+m[1] - 1] : "";
  });
  var key = ["vf", raw(v, "wave_view").length, raw(v, "wave_view").slice(0, 48), names.join("|"), onK.map(function (k) { return disp(v, k); }).join(""),
    soundName(v), disp(v, "bank_name"), info.preset_style || "", (v.$knobs || []).join(","), rowNames.join("|"), v.$page, (v.$pages || []).length].join("#");
  g.layer(key, function () {
    g.fill(0, 0, 960, 160, GROUND);
    // the sound, as the synth's preset bar names it
    g.fill(0, 0, 960, 20, PANEL);
    g.text(10, 14, "VIVACE", LILAC, -1);
    g.value(80, 15, up(soundName(v)), INK, -1, 420);
    var st = up([disp(v, "bank_name"), info.preset_style || ""].filter(function (s) { return s; }).join("  /  "));
    g.text(722, 14, st, DIM, -1, 150);
    var pages = v.$pages || [];
    if (pages.length > 1) g.text(950, 14, up(pages[v.$page] || "") + "  " + (v.$page + 1) + "/" + pages.length, MUTE, 1, 90);
    for (var o = 0; o < 3; o++) {
      var x = OSC_X[o], on = isOn(v, onK[o]);
      g.fill(x, 24, OSC_W, 76, PANEL);
      g.fill(x, 24, OSC_W, 14, on ? HEAD : PANEL2);
      g.dot(x + 9, 31, 3, on ? ON : FAINT);
      g.text(x + 18, 35, "OSC " + (o + 1), on ? INK : MUTE, -1);
      g.text(x + OSC_W - 6, 35, up(names[o] || ""), on ? LILAC_LT : FAINT, 1, OSC_W - 70);
      drawStack(g, x + 10, 42, OSC_W - 20, 54, tbl ? tbl[o] : null, on, true);
    }
    g.fill(722, 24, 230, 76, PANEL);
    g.fill(722, 24, 230, 14, HEAD);
    g.text(730, 35, "FILTER 1", isOn(v, "filter_1_on") ? INK : MUTE, -1);
    knobGround(g, v, rowNames);
  });
  for (var oo = 0; oo < 3; oo++)
    drawPlayed(g, OSC_X[oo] + 10, 42, OSC_W - 20, 54, tbl ? tbl[oo] : null, num(v, frK[oo]), isOn(v, onK[oo]),
      hot(v, frK[oo]) ? "slot" : LILAC_LT, oo);
  g.text(944, 35, up(disp(v, "filter_1_type")), isOn(v, "filter_1_on") ? LILAC_LT : FAINT, 1, 140);
  g.filter(726, 40, 222, 58, { cutoff: "filter_1_cutoff", resonance: "filter_1_resonance", type: filterKind(v, 1), color: isOn(v, "filter_1_on") ? LILAC : FAINT });
  knobRow(g, v, rowNames);
}

// a filter's response as Pung draws it: the model's style and where the
// blend stands (low pass, band pass, high pass), in Pung's words
function filterKind(v, n) {
  var t = disp(v, "filter_" + n + "_type"), b = num(v, "filter_" + n + "_blend", 0) / 128 * 2;
  if (/Notch/.test(t)) return "Notch";
  if (/Formant|Comb|Phaser|Diode/.test(t)) return t;
  var pole = /24dB/.test(t) ? " 24 dB" : " 12 dB";
  return (b < 0.5 ? "LP" : b < 1.5 ? "BP" : "HP") + pole;
}

// ---- oscillators ---------------------------------------------------------------------------
function oscScreen(n) {
  var p = "osc_" + n + "_";
  return function (g, v) {
    var tbl = tables(v), t = tbl ? tbl[n - 1] : null, on = isOn(v, p + "on"), names = arr(v, "wavetable_names");
    g.layer(["os", n, raw(v, "wave_view").length, raw(v, "wave_view").slice(0, 48), on, names[n - 1] || ""].join("#"), function () {
      g.fill(0, 0, 952, 86, GROUND);
      g.fill(0, 0, 330, 86, PANEL);
      g.fill(336, 0, 200, 86, PANEL);
      g.fill(542, 0, 410, 86, PANEL);
      g.text(8, 12, up(names[n - 1] || ("OSC " + n)), on ? LILAC_LT : MUTE, -1, 230);
      g.text(344, 12, "FRAME", MUTE, -1);
      drawStack(g, 12, 16, 312, 66, t, on);
      g.fill(344, 49, 184, 1, RULE);
    });
    var pos = num(v, p + "wave_frame");
    drawPlayed(g, 12, 16, 312, 66, t, pos, on, hot(v, p + "wave_frame") ? "slot" : LILAC_LT, n - 1);
    g.text(322, 12, (on ? "" : "OFF  ") + Math.round(pos) + " / " + (t ? t.n - 1 : "--"), on ? INK : MUTE, 1);
    // the frame it plays, in 2D
    if (t) {
      var fi = frameAt(t, pos);
      g.poly(cached(["2d", n, fi].join("|"), function () {
        var f = t.frames[fi], pts = [];
        for (var i = 0; i < f.length; i++) pts.push(344 + 184 * i / (f.length - 1), 49 - f[i] * 30);
        return pts;
      }), 2, on ? LILAC : DIM);
    }
    // what bends it: the spectrum, the phase, and the unison stack
    var x = 552;
    modeLine(g, v, x, 16, "SPECTRAL", p + "spectral_morph_type", p + "spectral_morph_amount");
    modeLine(g, v, x, 36, "WARP", p + "distortion_type", p + "distortion_amount");
    var uv = Math.max(1, Math.round(num(v, p + "unison_voices", 1))), det = frac(v, p + "unison_detune");
    g.text(x, 62, "UNISON", hotIn(v, p + "unison") ? "slot" : MUTE, -1);
    var cx = x + 150, spread = 6 + 90 * Math.sqrt(det);
    for (var u = 0; u < uv; u++) {
      var off = uv === 1 ? 0 : (u / (uv - 1) - 0.5) * spread, hh = uv === 1 ? 16 : 16 - 8 * Math.abs(off) / Math.max(1, spread / 2) * (1 - frac(v, p + "unison_blend", 0.8));
      g.fill(cx + off - 1, 74 - hh, 2, hh, on ? LILAC : FAINT);
    }
    g.text(x + 60, 62, uv + "V", INK, -1);
    g.text(x + 60, 78, up(disp(v, p + "unison_detune")), DIM, -1);
    g.text(944, 62, "TO " + up(disp(v, p + "destination") || "--"), on ? INK : MUTE, 1, 140);
    g.text(944, 78, up(disp(v, p + "level")) + "  PAN " + up(disp(v, p + "pan")), DIM, 1, 160);
  };
}
function modeLine(g, v, x, y, label, typeK, amtK) {
  var t = disp(v, typeK) || "--", none = t === "None";
  g.text(x, y + 10, label, hot(v, typeK) || hot(v, amtK) ? "slot" : MUTE, -1);
  g.text(x + 74, y + 10, up(t), none ? FAINT : INK, -1, 170);
  g.fill(x + 250, y + 5, 130, 4, RULE);
  if (!none) g.fill(x + 250, y + 5, Math.max(2, 130 * frac(v, amtK)), 4, hot(v, amtK) ? "slot" : LILAC);
  g.text(x + 390, y + 10, none ? "" : up(disp(v, amtK)), DIM, 1);
}

// the sources and where each goes: the synth's routing, as a picture
var DESTS = ["FILTER 1", "FILTER 2", "EFFECTS", "OUT"];
function destCols(d) {
  if (d === "Filter 1") return [0];
  if (d === "Filter 2") return [1];
  if (d === "Filter 1+2") return [0, 1];
  if (d === "Direct Out") return [3];
  return [2]; // the effects, or one effect in their chain
}
function sourcesScreen(g, v) {
  var src = [["OSC 1", "osc_1_on", "osc_1_destination"], ["OSC 2", "osc_2_on", "osc_2_destination"],
    ["OSC 3", "osc_3_on", "osc_3_destination"], ["SMP", "sample_on", "sample_destination"]];
  g.fill(0, 0, 952, 86, GROUND);
  var dy = [10, 30, 50, 70];
  for (var d = 0; d < 4; d++) {
    var fon = d < 2 ? isOn(v, "filter_" + (d + 1) + "_on") : true;
    g.fill(720, dy[d] - 9, 200, 16, PANEL);
    g.text(730, dy[d] + 3, DESTS[d] + (d < 2 && !fon ? "  (OFF)" : ""), d < 2 && !fon ? MUTE : INK, -1);
  }
  for (var i = 0; i < 4; i++) {
    var s = src[i], on = isOn(v, s[1]), y = dy[i], lit = hot(v, s[1]) || hot(v, s[2]);
    g.fill(20, y - 9, 120, 16, on ? PANEL2 : PANEL);
    g.dot(30, y - 1, 3, on ? ON : FAINT);
    g.text(40, y + 3, s[0], lit ? "slot" : on ? INK : MUTE, -1);
    var dname = disp(v, s[2]), cols = destCols(dname);
    g.text(150, y + 3, up(dname), on ? DIM : FAINT, -1, 120);
    for (var c = 0; c < cols.length; c++) {
      var ty = dy[cols[c]];
      g.poly([280, y - 1, 440, y - 1, 560, ty - 1, 716, ty - 1], lit ? 3 : 2, !on ? FAINT : lit ? "slot" : LILAC);
    }
  }
}

// ---- filters --------------------------------------------------------------------------------
function feeds(v, n) {
  var out = [], names = ["OSC 1", "OSC 2", "OSC 3", "SMP"], on = ["osc_1_on", "osc_2_on", "osc_3_on", "sample_on"],
    dk = ["osc_1_destination", "osc_2_destination", "osc_3_destination", "sample_destination"];
  for (var i = 0; i < 4; i++) {
    var d = disp(v, dk[i]);
    if (isOn(v, on[i]) && (d === "Filter " + n || d === "Filter 1+2")) out.push(names[i]);
  }
  if (isOn(v, "filter_" + n + "_filter_input")) out.push("FILTER " + (3 - n));
  return out;
}
function filterScreen(g, v) {
  g.fill(0, 0, 952, 86, GROUND);
  for (var n = 1; n <= 2; n++) {
    var x = n === 1 ? 0 : 480, p = "filter_" + n + "_", on = isOn(v, p + "on"), lit = hotIn(v, p);
    g.fill(x, 0, 472, 86, PANEL);
    g.fill(x, 0, 472, 14, lit ? PANEL2 : HEAD);
    g.dot(x + 9, 7, 3, on ? ON : FAINT);
    g.text(x + 18, 11, "FILTER " + n, lit ? "slot" : on ? INK : MUTE, -1);
    g.text(x + 100, 11, up(disp(v, p + "type")), on ? LILAC_LT : FAINT, -1, 200);
    var f = feeds(v, n);
    g.text(x + 464, 11, f.length ? "FROM " + f.join(" + ") : "NOTHING IN", f.length && on ? DIM : FAINT, 1, 160);
    g.filter(x + 4, 16, 464, 68, { cutoff: p + "cutoff", resonance: p + "resonance", type: filterKind(v, n), color: on ? LILAC : FAINT });
  }
}

// ---- envelopes, LFOs, random: Pung's pictures, and what each moves ---------------------------
function envScreen(n) {
  var p = "env_" + n + "_";
  return function (g, v) {
    g.fill(0, 0, 952, 86, GROUND);
    g.fill(0, 0, 640, 86, PANEL);
    g.fill(646, 0, 306, 86, PANEL);
    g.envelope(4, 2, 632, 82, { delay: p + "delay", attack: p + "attack", hold: p + "hold", decay: p + "decay", sustain: p + "sustain",
      release: p + "release", labels: true, color: LILAC });
    targets(g, v, 656, 2, 288, 82, routesFrom(v, "env_" + n), n === 1 ? [{ name: "Amplitude (always)", fixed: true }] : []);
  };
}
function lfoScreen(n) {
  var p = "lfo_" + n + "_";
  return function (g, v) {
    var shapes = arr(v, "lfo_shapes"), shape = shapes[n - 1] || "Triangle", sync = disp(v, p + "sync");
    var mode = disp(v, p + "sync_type");
    g.fill(0, 0, 952, 86, GROUND);
    g.fill(0, 0, 640, 86, PANEL);
    g.fill(646, 0, 306, 86, PANEL);
    var o = { shape: shape, rate: p + "frequency", trig: mode === "Trigger" || mode === "Envelope" || mode === "Sustain Envelope", color: LILAC };
    if (sync && sync !== "Seconds" && sync !== "Keytrack") { o.sync = p + "sync"; o.div = p + "tempo"; }
    g.lfo(4, 14, 632, 70, o);
    g.text(10, 11, up(shape) + (shape === "Custom" ? "  (DRAWN IN THE SOUND)" : ""), DIM, -1);
    g.text(630, 11, up(mode) + "   " + (sync === "Seconds" ? up(disp(v, p + "frequency")) : sync === "Keytrack" ? "KEYTRACK" : up(disp(v, p + "tempo")) +
      (sync === "Tempo Dotted" ? " DOTTED" : sync === "Tempo Triplets" ? " TRIPLET" : "")), INK, 1, 400);
    targets(g, v, 656, 2, 288, 82, routesFrom(v, "lfo_" + n));
  };
}
var RANDOM_SHAPE = { "Perlin": "Smooth", "Sample & Hold": "S&H", "Sine Interpolate": "Smooth", "Lorenz Attractor": "Noise" };
function randomScreen(n) {
  var p = "random_" + n + "_";
  return function (g, v) {
    var style = disp(v, p + "style");
    g.fill(0, 0, 952, 86, GROUND);
    g.fill(0, 0, 640, 86, PANEL);
    g.fill(646, 0, 306, 86, PANEL);
    var o = { shape: RANDOM_SHAPE[style] || "S&H", rate: p + "frequency", trig: isOn(v, p + "sync_type"), color: LILAC };
    g.lfo(4, 14, 632, 70, o);
    g.text(10, 11, up(style || "--"), DIM, -1);
    targets(g, v, 656, 2, 288, 82, routesFrom(v, "random_" + n));
  };
}

// ---- effects: the chain of nine --------------------------------------------------------------
var FX = [["CHORUS", "chorus_on", "chorus_dry_wet"], ["COMPRESSOR", "compressor_on", "compressor_mix"], ["DELAY", "delay_on", "delay_dry_wet"],
  ["DISTORTION", "distortion_on", "distortion_mix"], ["EQ", "eq_on", null], ["FILTER", "filter_fx_on", "filter_fx_mix"],
  ["FLANGER", "flanger_on", "flanger_dry_wet"], ["PHASER", "phaser_on", "phaser_dry_wet"], ["REVERB", "reverb_on", "reverb_dry_wet"]];
var FX_PAGE = { "Chorus": 0, "Chorus +": 0, "Compressor": 1, "Comp Levels": 1, "Comp Ratios": 1, "Delay": 2, "Delay +": 2,
  "Distortion": 3, "EQ": 4, "EQ +": 4, "FX Filter": 5, "FX Filter +": 5, "Flanger": 6, "Phaser": 7, "Mod FX +": 7, "Reverb": 8, "Reverb +": 8 };
var FX_KEYS = []; FX.forEach(function (f) { FX_KEYS.push(f[1]); if (f[2]) FX_KEYS.push(f[2]); });
function fxScreen(g, v) {
  var cur = FX_PAGE[(v.$pages || [])[v.$page]], w = 952 / 9;
  g.fill(0, 0, 952, 86, GROUND);
  for (var i = 0; i < 9; i++) {
    var f = FX[i], x = Math.round(i * w), on = isOn(v, f[1]), lit = i === cur;
    g.fill(x + 2, 4, Math.round(w) - 4, 78, lit ? PANEL2 : PANEL);
    if (lit) g.fill(x + 2, 4, Math.round(w) - 4, 2, "slot");
    g.dot(x + 12, 18, 3.5, on ? ON : FAINT);
    g.text(x + 20, 22, f[0], lit ? INK : on ? DIM : MUTE, -1, w - 26);
    if (f[2]) {
      var m = frac(v, f[2]);
      g.fill(x + 10, 66, w - 20, 4, RULE);
      if (on) g.fill(x + 10, 66, Math.max(2, (w - 20) * m), 4, hot(v, f[2]) ? "slot" : LILAC);
      g.text(x + w / 2, 58, on ? "MIX " + up(disp(v, f[2])) : "OFF", on ? INK : FAINT, 0, w - 12);
    } else g.text(x + w / 2, 58, on ? "ON" : "OFF", on ? INK : FAINT, 0);
    if (i < 8) g.poly([x + w - 3, 40, x + w + 3, 44, x + w - 3, 48], 1, MUTE);
  }
}

// ---- the matrix: the sound's routes, eight a page ---------------------------------------------
function matrixScreen(first) {
  return function (g, v) {
    var rs = routes(v), by = {};
    rs.forEach(function (r) { by[r.i] = r; });
    g.fill(0, 0, 952, 86, GROUND);
    for (var j = 0; j < 8; j++) {
      var i = first + j, r = by[i], col = j % 2, row = Math.floor(j / 2), x = col * 476, y = row * 21;
      var k = amountKey(i), lit = hot(v, k);
      g.fill(x + 2, y + 2, 472, 19, lit ? PANEL2 : PANEL);
      g.text(x + 10, y + 15, String(i), MUTE, -1);
      if (!r) { g.text(x + 34, y + 15, "--", FAINT, -1); continue; }
      g.text(x + 34, y + 15, up(r.source), lit ? "slot" : MOD, -1, 110);
      g.text(x + 150, y + 15, up(r.dest), INK, -1, 220);
      var a = known(v, k) ? v[k].frac * 2 - 1 : 0, bx = x + 380, bw = 84, c = bx + bw / 2;
      g.fill(bx, y + 10, bw, 3, RULE);
      g.fill(a >= 0 ? c : c + a * bw / 2, y + 9, Math.max(2, Math.abs(a) * bw / 2), 5, lit ? "slot" : MOD);
    }
  };
}

// ---- Pung's envelope on the synth's own times --------------------------------------------------
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

// ---- the compartments ---------------------------------------------------------------------------
var SOUND = ["preset_name", "bank_name", "patch_info", "wave_view", "wavetable_names", "osc_1_on", "osc_2_on", "osc_3_on",
  "osc_1_wave_frame", "osc_2_wave_frame", "osc_3_wave_frame", "filter_1_on", "filter_1_type", "filter_1_cutoff",
  "filter_1_resonance", "filter_1_blend"];
push.compartment({
  id: "panel", label: "Vivace", front_panel: true,
  pages: pagesOf("play"), extra_keys: SOUND,
  screen: frontPanel
});
var OSC_EXTRA = ["wave_view", "wavetable_names", "osc_1_on", "osc_2_on", "osc_3_on", "sample_on", "osc_1_destination",
  "osc_2_destination", "osc_3_destination", "sample_destination", "filter_1_on", "filter_2_on"];
[1, 2, 3].forEach(function (n) {
  var p = "osc_" + n + "_";
  ["on", "spectral_morph_type", "spectral_morph_amount", "distortion_type", "distortion_amount", "unison_voices", "unison_detune",
    "unison_blend", "destination", "level", "pan", "wave_frame"].forEach(function (s) { OSC_EXTRA.push(p + s); });
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
  ["on", "type", "cutoff", "resonance", "blend"].forEach(function (s) { FLT_EXTRA.push("filter_" + n + "_" + s); });
});
push.compartment({
  id: "filter", label: "Filters", extra_keys: FLT_EXTRA,
  pages: pagesOf("filter").map(function (pg) { return { label: pg.label, keys: pg.keys, screen: filterScreen }; })
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
push.compartment({
  id: "fx", label: "Effects", extra_keys: FX_KEYS,
  pages: pagesOf("fx").map(function (pg) { return { label: pg.label, keys: pg.keys, screen: fxScreen }; })
});
push.compartment({
  id: "matrix", label: "Matrix", extra_keys: ["mod_routes"].concat(MOD_KEYS),
  pages: pagesOf("matrix").map(function (pg) {
    var m = /^Matrix (\d+)/.exec(pg.label);
    return { label: pg.label, keys: pg.keys, screen: matrixScreen(+m[1]) };
  })
});
push.compartment({ id: "voice", label: "Voice", pages: pagesOf("voice") });
