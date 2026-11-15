// Osirus (the Access Virus, emulated) on Push: its compartments.
// An overlay shipped with Pung (Osirus itself ships no push_ui.js).
//
// The compartments are the seven sections of Osirus's own web page, in its
// order, and their pages are that page's cards: the Push and the browser
// show the same structure. Two compartments have their own screen, because
// there a picture says what knobs cannot:
//
//   FILTERS    the Virus's filter routing (Serial 4, Serial 6, Parallel 4,
//              Split) as a signal path: filter 1, the saturation stage,
//              filter 2, which filter the panel edits, and both responses
//   ENVELOPES  the Virus's envelopes have a sustain SLOPE (sustain falls or
//              rises while the key is held): amp and filter, as shapes
//
// The others use Pung's default view. The native layer still owns every
// encoder and draws each key's name and value under a screen.

var TAU = Math.PI * 2;
// a value not read yet draws as its neutral position, never as 0
function frac(v, k, neutral) { return v[k] && v[k].known ? v[k].frac : (neutral || 0); }
function disp(v, k) { return v[k] ? String(v[k].display) : ""; }
function title(g, s) {
  g.fill(g.w - 10 - s.length * 7 - 8, 2, s.length * 7 + 10, 14, "black");
  g.text(g.w - 10, 13, s, "dim", 1);
}
function curve(g, pts, width, color) { g.poly(pts, width, color); } // one call: a draw has 8 ms

// ---- filters ---------------------------------------------------------------------
// |H(f)| of the Virus's filter modes: 2-pole LP/HP/BP/BS, and the analog
// ladder (Analog 1P..4P: 6 dB per pole)
function response(mode, f, fc, res) {
  var r = f / fc, q = 0.6 + res * res * 8;
  var m = /Analog (\d)P/.exec(mode);
  if (m) {
    var poles = +m[1], one = 1 / Math.sqrt(1 + r * r), g = Math.pow(one, poles);
    var peak = 1 + res * res * 6 * Math.exp(-Math.pow(Math.log(r) * 4, 2)); // the ladder's resonance at fc
    return g * peak;
  }
  var den = Math.sqrt((1 - r * r) * (1 - r * r) + (r / q) * (r / q));
  if (mode === "HighPass") return (r * r) / den;
  if (mode === "BandPass") return (r / q) / den;
  if (mode === "BandStop") return Math.abs(1 - r * r) / den;
  return 1 / den; // LowPass
}
function toY(mag, top, base) {
  var db = 20 * Math.log(Math.max(1e-6, mag)) / Math.LN10;
  db = Math.max(-36, Math.min(18, db));
  return top + (18 - db) / 54 * (base - top);
}
// curves are cached until their own inputs change: the screen is drawn many
// times a second, a value changes now and then, and a draw has 8 ms
var curveCache = {};
function respCurve(g, x0, x1, top, base, mode, fc01, res01) {
  var key = [x0, x1, top, base, mode, fc01.toFixed(3), res01.toFixed(3)].join("|");
  if (curveCache[key]) return curveCache[key];
  var fc = Math.pow(2, 5 + fc01 * 9.5), pts = [], step = Math.max(4, Math.round((x1 - x0) / 60));
  for (var x = x0; x <= x1; x += step) {
    var f = Math.pow(2, 4 + (x - x0) / (x1 - x0) * 11);
    pts.push(x, toY(response(mode, f, fc, res01), top, base));
  }
  if (Object.keys(curveCache).length > 64) curveCache = {};
  curveCache[key] = pts;
  return pts;
}

// a filter block: frame, name, mode, a small response inside
function filterBox(g, x, y, w, h, name, mode, fc, res, hot, edited) {
  g.fill(x, y, w, h, "black");
  g.line(x, y, x + w, y, hot ? 2 : 1, hot ? "slot" : "line");
  g.line(x, y + h, x + w, y + h, hot ? 2 : 1, hot ? "slot" : "line");
  g.line(x, y, x, y + h, hot ? 2 : 1, hot ? "slot" : "line");
  g.line(x + w, y, x + w, y + h, hot ? 2 : 1, hot ? "slot" : "line");
  if (edited) g.fill(x + 2, y + h - 3, w - 4, 2, "slot"); // the panel edits this one
  g.text(x + 6, y + 12, name, hot ? "fg" : "dim", -1);
  g.text(x + w - 6, y + 12, mode.toUpperCase(), "fg", 1);
  curve(g, respCurve(g, x + 6, x + w - 6, y + 16, y + h - 6, mode, fc, res), 1.5, hot ? "slot" : "fg");
}

// the saturation stage: its transfer curve
function satBox(g, x, y, w, h, curveName, hot) {
  g.fill(x, y, w, h, "black");
  var c = hot ? "slot" : "line";
  g.line(x, y, x + w, y, 1, c); g.line(x, y + h, x + w, y + h, 1, c);
  g.line(x, y, x, y + h, 1, c); g.line(x + w, y, x + w, y + h, 1, c);
  var cx = x + w / 2, cy = y + h / 2 + 4, a = Math.min(w, h) / 2 - 8;
  var key = "sat|" + x + "|" + y + "|" + w + "|" + h + "|" + curveName, pts = curveCache[key];
  if (pts) { curve(g, pts, 1.5, hot ? "slot" : "fg"); g.text(cx, y + 11, (curveName || "OFF").toUpperCase(), "dim", 0); return; }
  pts = [];
  var k = { "Light": 1.5, "Soft": 2.5, "Middle": 4, "Hard": 8 }[curveName] || 0;
  for (var i = -20; i <= 20; i++) {
    var u = i / 20, o = u;
    if (k) o = Math.tanh(u * k) / Math.tanh(k);
    else if (curveName === "Digital") o = Math.max(-0.6, Math.min(0.6, u * 1.5)) / 0.6;
    else if (curveName === "Shaper") o = Math.sin(u * 2.4) / Math.sin(2.4);
    else if (curveName === "Rectifier") o = Math.abs(u) * 2 - 1;
    else if (curveName.indexOf("Bit") === 0) o = Math.round(u * 3) / 3;
    else if (curveName.indexOf("Rate") === 0) o = Math.round(u * 5) / 5;
    pts.push(cx + u * a, cy - o * a * 0.8);
  }
  curveCache[key] = pts;
  curve(g, pts, 1.5, hot ? "slot" : "fg");
  g.text(cx, y + 11, (curveName || "OFF").toUpperCase(), "dim", 0);
}

function arrow(g, x0, y0, x1, y1) {
  g.line(x0, y0, x1, y1, 1, "dim");
  g.line(x1, y1, x1 - 5, y1 - 3, 1, "dim");
  g.line(x1, y1, x1 - 5, y1 + 3, 1, "dim");
}

push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Oscillator 1", keys: ["osc1_wave_select", "osc1_shape", "osc1_pulsewidth", "osc1_semitone", "osc1_keyfollow"] },
    { label: "Oscillator 2", keys: ["osc2_wave_select", "osc2_shape", "osc2_pulsewidth", "osc2_semitone", "osc2_detune", "osc2_sync", "osc_fm_mode", "osc2_fm_amount"] },
    { label: "Osc 2 Mod", keys: ["osc2_filt_env_amt", "fm_filt_env_amt", "osc2_keyfollow"] },
    { label: "Oscillator 3", keys: ["osc3_mode", "osc3_volume", "osc3_semitone", "osc3_detune"] },
    { label: "Mixer", keys: ["osc_balance", "osc_mainvolume", "sub_osc_volume", "sub_osc_shape", "noise_volume", "noise_color", "ringmod_volume", "osc_init_phase"] },
    { label: "Punch", keys: ["punch_intensity"] }
  ]
});

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
    var fc1 = frac(v, "cutoff"), fc2 = Math.max(0, Math.min(1, fc1 + (frac(v, "cutoff2_offset", 0.5) - 0.5)));
    var r1 = frac(v, "filter1_resonance"), r2 = frac(v, "filter2_resonance");
    var ed1 = sel !== "Filter 2", ed2 = sel !== "Filter 1";

    // the signal path, left
    var bw = 132, bh = 52, sw = 70, top = 20, mid = 46;
    g.text(4, mid + 4, "OSC", "dim", -1);
    if (routing.indexOf("Serial") === 0) {
      var x1 = 36, xs = x1 + bw + 22, x2 = xs + sw + 22;
      arrow(g, 28, mid, x1, mid);
      filterBox(g, x1, mid - bh / 2, bw, bh, "FILTER 1", m1, fc1, r1, hot1, ed1);
      arrow(g, x1 + bw, mid, xs, mid);
      satBox(g, xs, mid - bh / 2, sw, bh, disp(v, "saturation_curve"), hotS);
      arrow(g, xs + sw, mid, x2, mid);
      filterBox(g, x2, mid - bh / 2, bw, bh, "FILTER 2", m2, fc2, r2, hot2, ed2);
      arrow(g, x2 + bw, mid, x2 + bw + 18, mid);
      g.text(x2 + bw + 20, mid + 4, "AMP", "dim", -1);
    } else {
      // parallel and split: the two filters side by side in time, stacked
      var x = 60, ya = 2, yb = 44, h = 38;
      g.line(28, mid, 44, mid, 1, "dim"); g.line(44, ya + h / 2, 44, yb + h / 2, 1, "dim");
      arrow(g, 44, ya + h / 2, x, ya + h / 2); arrow(g, 44, yb + h / 2, x, yb + h / 2);
      filterBox(g, x, ya, bw, h, "FILTER 1", m1, fc1, r1, hot1, ed1);
      filterBox(g, x, yb, bw, h, "FILTER 2", m2, fc2, r2, hot2, ed2);
      var xs2 = x + bw + 20;
      arrow(g, x + bw, ya + h / 2, xs2, ya + h / 2);
      satBox(g, xs2, ya, sw, h, disp(v, "saturation_curve"), hotS);
      if (routing === "Split") { // stereo: filter 1 left, filter 2 right
        arrow(g, xs2 + sw, ya + h / 2, xs2 + sw + 20, ya + h / 2); g.text(xs2 + sw + 24, ya + h / 2 + 4, "L", "fg", -1);
        arrow(g, x + bw, yb + h / 2, xs2 + sw + 20, yb + h / 2); g.text(xs2 + sw + 24, yb + h / 2 + 4, "R", "fg", -1);
      } else {
        g.line(xs2 + sw, ya + h / 2, xs2 + sw + 14, ya + h / 2, 1, "dim");
        g.line(x + bw, yb + h / 2, xs2 + sw + 14, yb + h / 2, 1, "dim");
        g.line(xs2 + sw + 14, ya + h / 2, xs2 + sw + 14, yb + h / 2, 1, "dim");
        arrow(g, xs2 + sw + 14, mid, xs2 + sw + 30, mid); g.text(xs2 + sw + 32, mid + 4, "AMP", "dim", -1);
      }
    }
    g.text(4, 84, routing.toUpperCase(), t === "filter_routing" ? "slot" : "fg", -1);

    // both responses, right: what the two filters do together
    var px0 = 600, px1 = g.w - 8, ptop = 18, pbase = 80;
    g.line(px0, toY(1, ptop, pbase), px1, toY(1, ptop, pbase), 1, "line");
    var a = respCurve(g, px0, px1, ptop, pbase, m1, fc1, r1), b = respCurve(g, px0, px1, ptop, pbase, m2, fc2, r2);
    curve(g, b, 1.5, hot2 ? "slot" : "mod");
    curve(g, a, 2, hot1 ? "slot" : "fg");
    g.text(px0, 14, "F1", "fg", -1); g.text(px0 + 24, 14, "F2", "mod", -1);
    title(g, "FILTERS");
  }
});

// ---- envelopes: attack, decay, sustain level, sustain SLOPE, release ---------------
// Pung's own envelope (g.envelope), the one its default view and the web page
// draw, so the three agree. What this screen adds is the Virus's: both
// envelopes at once, and the sustain slope said in words.
function virusEnv(g, x0, x1, v, p, name, t) {
  var mine = t.indexOf(p + "_") === 0;
  g.envelope(x0, 18, x1 - x0, 68, {
    attack: p + "_attack", decay: p + "_decay", sustain: p + "_sustain",
    slope: p + "_sustain_time", release: p + "_release", labels: true
  });
  var slope = frac(v, p + "_sustain_time", 0.5) - 0.5;
  var word = slope < -0.03 ? "FALLS WHILE HELD" : slope > 0.03 ? "RISES WHILE HELD" : "HOLDS";
  g.text(x0 + 6, 13, name, mine ? "fg" : "dim", -1);
  g.text(x1 - 6, 13, "SUSTAIN " + word, "dim", 1);
}

push.compartment({
  id: "env", label: "Envelopes",
  pages: [
    { label: "Amplifier", keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_sustain_time", "amp_release"] },
    { label: "Filter Env", keys: ["flt_attack", "flt_decay", "flt_sustain", "flt_sustain_time", "flt_release"] },
    { label: "Velocity", keys: ["osc1_shape_velocity", "osc2_shape_velocity", "pulsewidth_velocity", "fm_amount_velocity", "flt1_envamt_velocity", "flt2_envamt_velocity", "resonance1_velocity", "resonance2_velocity"] },
    { label: "Velocity 2", keys: ["amp_velocity", "panorama_velocity"] }
  ],
  screen: function (g, v) {
    var t = v.$touched || "", half = g.w / 2;
    virusEnv(g, 0, half - 8, v, "amp", "AMPLIFIER", t);
    g.line(half, 6, half, 82, 1, "line");
    virusEnv(g, half + 8, g.w, v, "flt", "FILTER", t);
  }
});

push.compartment({
  id: "lfo", label: "LFOs",
  pages: [
    { label: "LFO 1", keys: ["lfo1_rate", "lfo1_clock", "lfo1_shape", "lfo1_mode", "lfo1_env_mode", "lfo1_symmetry", "lfo1_keyfollow", "lfo1_keytrigger"] },
    { label: "LFO 1 Dest", keys: ["osc1_lfo1_amount", "osc2_lfo1_amount", "pw_lfo1_amount", "reso_lfo1_amount", "filtgain_lfo1_amount", "lfo1_assign_dest", "lfo1_assign_amount"] },
    { label: "LFO 2", keys: ["lfo2_rate", "lfo2_clock", "lfo2_shape", "lfo2_mode", "lfo2_env_mode", "lfo2_symmetry", "lfo2_keyfollow", "lfo2_keytrigger"] },
    { label: "LFO 2 Dest", keys: ["shape_lfo2_amount", "fm_lfo2_amount", "cutoff1_lfo2_amount", "cutoff2_lfo2_amount", "pan_lfo2_amount", "lfo2_assign_dest", "lfo2_assign_amount"] },
    { label: "LFO 3", keys: ["lfo3_rate", "lfo3_clock", "lfo3_shape", "lfo3_mode", "lfo3_keyfollow", "lfo3_fadein_time", "lfo3_destination", "osc_lfo3_amount"] }
  ]
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
