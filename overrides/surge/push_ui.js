// Surge XT on the Push. An overlay shipped with Pung (the module ships no
// push_ui.js). The module exposes scene A of Surge's patch: three
// oscillators, the mixer, the filter block (two filter units, the
// waveshaper, eight configurations), the amp and filter EGs, six voice LFOs
// and six scene LFOs, and six modulation slots of its own.
//
// The compartments are Surge's own sections, in the order its window shows
// them, drawn in its idiom: the dark panel, Surge orange, sliders rather than
// knobs, the oscillator display with its drawn wave, the filter
// configuration as Surge pictures it.
//
//   PATCH        (front panel) the patch at a glance: the patch browser
//                (category, name), scene A, the three oscillators with their
//                waves and levels, the filter configuration as a signal path
//                and both filters' responses on one axis (live), the amp and
//                filter EGs (live). Pages: the sound (the module's own eight)
//                and the structure (every type and routing switch)
//   OSCILLATORS  (front panel) Surge's oscillator section: the display with
//                the wave the type and its parameters make, the encoders
//                named as Surge names them for that type (a Wavetable's
//                Morph, an FM2's M1 Ratio: the module names them all as
//                Classic's), the FM routing between the three; its FM page
//                shows all three waves and the routing in words
//   MIXER        the six channels as Surge's mixer strips, each over its
//                encoder on every page: level, mute, solo, and which filter
//                it feeds
//   FILTERS      the configuration as a signal path with the units' types,
//                the waveshaper's transfer curve, both responses on one axis
//                with the low cut and how far the filter EG moves each cutoff
//   ENVELOPES    the amp and filter EGs side by side (live), with their
//                Digital/Analog mode and stage shapes in Surge's words
//   LFOS, SCENE LFOS  one screen per LFO: its wave at its amplitude (live),
//                its DAHDSR envelope (live), and what the mod slots send it to
//   MODULATION   the module's six slots as routings: source, amount, target
//   SCENE        Surge's scene settings (output, sends, play mode): knobs
//
// Values are shown in Surge's units (Hz, ms, dB, cents) where this file
// draws them; under a band screen Pung's value row shows the module's raw
// numbers.

var C = {
  bg: "#0d0e11", head: "#17191e", panel: "#1a1d22", raised: "#262a31", edge: "#353a43",
  field: "#060709", ink: "#e9ebee", label: "#8f96a0", faint: "#4a505a",
  or: "#ff9000", orMid: "#b56500", orDk: "#4a2a00", blue: "#4aa8ff", red: "#e2462f"
};
var TAU = Math.PI * 2;

// ---- values ---------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function opt(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
// a text the module answers (a name): its display, else the raw value
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function isOn(v, k) { var s = opt(v, k).toLowerCase(); return s === "on" || s === "1"; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function fpart(x) { return x - Math.floor(x); }

function sgn(n, d) { var s = n.toFixed(d); if (parseFloat(s) === 0) s = (0).toFixed(d); return (parseFloat(s) > 0 ? "+" : "") + s; }
function fHz(hz) {
  if (hz >= 1000) return [(hz / 1000).toFixed(hz >= 10000 ? 1 : 2), "kHz"];
  return [hz.toFixed(hz < 100 ? 1 : 0), "Hz"];
}
function fRate(hz) { return [hz.toFixed(hz < 0.1 ? 3 : (hz < 10 ? 2 : 1)), "Hz"]; }
function fTime(s) {
  if (s < 1) { var ms = s * 1000; return [ms < 10 ? ms.toFixed(1) : ms.toFixed(0), "ms"]; }
  return [s.toFixed(s < 10 ? 2 : 1), "s"];
}
function fAmp(x) { return x <= 0.00001 ? ["-inf", "dB"] : [sgn(18 * Math.log(x) / Math.LN2, 1), "dB"]; }
function pct(f) { return [String(Math.round(f * 100)), "%"]; }
function bip(f) { return [sgn((f * 2 - 1) * 100, 0), "%"]; }
// semitones from A 440 to Hz (Surge's frequency parameters)
function noteHz(semi) { return 440 * Math.pow(2, semi / 12); }

// a value as Surge shows it: [text, unit]
// a value as Surge shows it, from the module's raw number: [text, unit],
// or null where Pung's own reading stands (the switches, the oscillators'
// parameters, which read by their type: the Oscillators panel says them)
function surgeUnits(k, r) {
  var x = parseFloat(r);
  if (isNaN(x)) return null;
  if (/^filter[12]_cutoff$/.test(k) || k === "lowcut") return fHz(noteHz(x));
  if (/_resonance$/.test(k)) return [String(Math.round(x * 100)), "%"];
  if (/_envmod$/.test(k)) return [sgn(x, 1), "st"];
  if (/^filter[12]_keytrack$/.test(k)) return [sgn(x * 100, 0), "%"];
  if (/^(env[12]|lfo\d+)_(attack|decay|release|delay|hold)$/.test(k)) return fTime(Math.pow(2, x));
  if (/_sustain$/.test(k)) return [String(Math.round(x * 100)), "%"];
  if (/^(volume|level_(o[123]|ring12|ring23|noise)|send_fx_\d)$/.test(k)) return fAmp(x);
  if (/^(level_pfg|vca_level|vca_velsense|ws_drive|fm_depth)$/.test(k)) return [sgn(x, 1), "dB"];
  if (/^(pan|pan2|feedback|f_balance|noisecol)$/.test(k)) return [sgn(x * 100, 0), "%"];
  if (k === "drift") return [String(Math.round(x * 100)), "%"];
  if (/^(pitch|osc\d_pitch)$/.test(k)) return [sgn(x, 2), "st"];
  if (k === "portamento") return fTime(Math.pow(2, x));
  if (/^lfo\d+_rate$/.test(k)) return fRate(Math.pow(2, x));
  if (/^lfo\d+_(phase|magnitude)$/.test(k)) return [String(Math.round(x * 100)), "%"];
  if (/^lfo\d+_deform$/.test(k)) return [sgn(x * 100, 0), "%"];
  if (/^mod_\d_amount$/.test(k)) return [sgn(x, 2), ""];
  return null;
}
// every Surge value reads in Surge's units wherever Pung writes one
push.display(function (key, r) {
  var u = surgeUnits(key, r);
  return u ? { value: u[0], unit: u[1] } : undefined;
});
function show(v, k) {
  if (!known(v, k)) return ["--", ""];
  if (k === "filter2_cutoff" && isOn(v, "f2_cf_is_offset")) return [sgn(raw(v, k, 0), 1), "st"];
  if (/^route_/.test(k)) return [routeShort(opt(v, k)), ""];
  return surgeUnits(k, v[k].value) || [String(v[k].display || v[k].value), v[k].unit || ""];
}
// where a cutoff (semitones from A 440) stands on Pung's filter axis: 20 Hz to 20 kHz, three decades
function axisAt(semi) { return clamp(Math.log(noteHz(semi) / 20) / Math.LN10 / 3, 0, 1); }
function routeShort(s) { return s === "Filter 1" ? "F1" : (s === "Filter 2" ? "F2" : (s === "Both" ? "F1+F2" : s)); }

// ---- the oscillator types: their parameters as Surge names them ------------------------------
// [name, how its value reads]: the module names param0..6 as the Classic
// oscillator's whatever the type (its parameters are registered once)
var OSC_PARAMS = {
  "Classic": [["Shape", "bip"], ["Width 1", "pct"], ["Width 2", "pct"], ["Sub Mix", "pct"], ["Sync", "st60"], ["Unison Detune", "cents"], ["Unison Voices", "voices"]],
  "Sine": [["Shape", "n32"], ["Feedback", "bip"], ["Behavior", "raw"], ["Low Cut", "hz"], ["High Cut", "hz"], ["Unison Detune", "cents"], ["Unison Voices", "voices"]],
  "Wavetable": [["Morph", "pct"], ["Skew Vertical", "bip"], ["Saturate", "pct"], ["Formant", "st60"], ["Skew Horizontal", "bip"], ["Unison Detune", "cents"], ["Unison Voices", "voices"]],
  "S&H Noise": [["Correlation", "bip"], ["Width", "pct"], ["Low Cut", "hz"], ["High Cut", "hz"], ["Sync", "st60"], ["Unison Detune", "cents"], ["Unison Voices", "voices"]],
  "Audio Input": [["Channel", "bip"], ["Gain", "db48"], ["", ""], ["", ""], ["", ""], ["Low Cut", "hz"], ["High Cut", "hz"]],
  "FM3": [["M1 Amount", "pct"], ["M1 Ratio", "ratio"], ["M2 Amount", "pct"], ["M2 Ratio", "ratio"], ["M3 Amount", "pct"], ["M3 Frequency", "hz"], ["Feedback", "bip"]],
  "FM2": [["M1 Amount", "pct"], ["M1 Ratio", "int32"], ["M2 Amount", "pct"], ["M2 Ratio", "int32"], ["M1/2 Offset", "hz10"], ["M1/2 Phase", "pct"], ["Feedback", "bip"]],
  "Window": [["Morph", "pct"], ["Formant", "raw"], ["Window", "win"], ["Low Cut", "hz"], ["High Cut", "hz"], ["Unison Detune", "cents"], ["Unison Voices", "voices"]],
  "Modern": [["Sawtooth", "bip"], ["Pulse", "bip"], ["Triangle", "bip"], ["Width", "pct"], ["Sync", "st60"], ["Unison Detune", "cents"], ["Unison Voices", "voices"]],
  "String": [["Exciter", "exc"], ["Exciter Level", "pct"], ["String 1 Decay", "pct"], ["String 2 Decay", "pct"], ["String 2 Detune", "bcents"], ["String Balance", "bip"], ["Stiffness", "bip"]],
  "Twist": [["Engine", "twist"], ["Harmonics", "bip"], ["Timbre", "bip"], ["Morph", "bip"], ["Aux Mix", "bip"], ["LPG Response", "pct"], ["LPG Decay", "pct"]],
  "Alias": [["Shape", "alias"], ["Wrap", "pct"], ["Mask", "raw"], ["Threshold", "pct"], ["Bitcrush", "bits"], ["Unison Detune", "cents"], ["Unison Voices", "voices"]]
};
var TWIST = ["Waveforms", "Waveshaper", "2-Op FM", "Formant/PD", "Harmonic", "Wavetable", "Chords", "Vowels/Speech",
  "Granular Cloud", "Filtered Noise", "Particle Noise", "Inharm. String", "Modal Resonator", "Analog Kick", "Analog Snare", "Analog Hi-Hat"];
var EXCITER = ["Burst Noise", "Burst Pink", "Burst Sine", "Burst Tri", "Burst Ramp", "Burst Square", "Burst Sweep", "Const Noise",
  "Const Pink", "Const Sine", "Const Tri", "Const Ramp", "Const Square", "Const Sweep", "Audio In"];
var ALIAS = ["Sine", "Ramp", "Pulse", "Noise", "Alias Mem", "Osc Mem", "Scene Mem", "DAW Mem", "Step Seq Mem", "Audio In",
  "TX 2", "TX 3", "TX 4", "TX 5", "TX 6", "TX 7", "TX 8", "Additive"];
var WINDOWS = ["Triangle", "Cosine", "Blend 1", "Blend 2", "Blend 3", "Sawtooth", "Sine", "Square", "Rectangle"];
function oscType(v, o) { var s = opt(v, "osc" + o + "_type"); return OSC_PARAMS[s] ? s : "Classic"; }
function pick(list, f) { return list[clamp(Math.round(f * (list.length - 1)), 0, list.length - 1)]; }
// a parameter of the oscillator, as its type reads it
function oscShow(v, k, kind) {
  if (!known(v, k)) return ["--", ""];
  var f = v[k].frac;
  switch (kind) {
  case "pct": return pct(f);
  case "bip": return bip(f);
  case "st60": return [(f * 60).toFixed(1), "st"];
  case "cents": return [(f * 100).toFixed(1), "ct"];
  case "bcents": return [sgn((f * 2 - 1) * 100, 1), "ct"];
  case "voices": return [String(1 + Math.round(f * 15)), "voices"];
  case "hz": return fHz(noteHz(-60 + f * 130));
  case "db48": return [sgn(-48 + f * 96, 1), "dB"];
  case "ratio": return [(f * 32).toFixed(2), ""];
  case "int32": return [String(1 + Math.round(f * 31)), ""];
  case "hz10": return [sgn(-10 + f * 20, 2), "Hz"];
  case "bits": return [(1 + f * 7).toFixed(1), "bits"];
  case "n32": return [String(1 + Math.round(f * 31)), ""];
  case "win": return [pick(WINDOWS, f), ""];
  case "exc": return [pick(EXCITER, f), ""];
  case "twist": return [pick(TWIST, f), ""];
  case "alias": return [pick(ALIAS, f), ""];
  }
  return [String(v[k].display || v[k].value), v[k].unit || ""];
}
function oscFracs(v, o) {
  var p = [];
  for (var i = 0; i < 7; i++) p.push(fr(v, "osc" + o + "_param" + i, 0));
  return p;
}

// ---- drawing helpers ----------------------------------------------------------------------
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 160) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function box(g, x, y, w, h, col, width) {
  var lw = width || 1;
  g.fill(x, y, w, lw, col); g.fill(x, y + h - lw, w, lw, col);
  g.fill(x, y, lw, h, col); g.fill(x + w - lw, y, lw, h, col);
}
function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

// ---- the oscillators' waves ---------------------------------------------------------------
// the wave a type makes from its parameters (p: the seven, 0..1), as a
// function of the phase in cycles; null where there is no wave to draw (a
// wavetable's frames are not readable, an audio input, Twist's engines)
function oscFn(type, p) {
  var s, w1, w2, sub, ratio, a, b, c, n;
  switch (type) {
  case "Classic":
    s = p[0] * 2 - 1; w1 = clamp(p[1], 0.03, 0.97); w2 = clamp(p[2], 0.03, 0.97); sub = p[3]; ratio = Math.pow(2, p[4] * 5);
    return function (ph) {
      var t = fpart(fpart(ph) * ratio), saw = 2 * t - 1, tri = t < 0.5 ? 4 * t - 1 : 3 - 4 * t, pul = t < w1 ? 1 : -1;
      var main = s < 0 ? saw * (1 + s) + tri * -s : saw * (1 - s) + pul * s;
      var sb = fpart(ph / 2) < w2 ? 1 : -1;
      return main * (1 - sub) + sb * sub;
    };
  case "Sine":
    var fb = (p[1] * 2 - 1) * 1.4, prev = 0;
    return function (ph) { prev = Math.sin(TAU * ph + fb * prev); return prev; };
  case "S&H Noise":
    c = p[0] * 2 - 1; var y = 0, last = -1;
    return function (ph) {
      var i = Math.floor(ph * 12);
      if (i !== last) { y = clamp(c * y + (1 - Math.abs(c)) * rnd(i) * 1.2, -1, 1); last = i; }
      return y;
    };
  case "FM2":
    var r1 = 1 + Math.round(p[1] * 31), r2 = 1 + Math.round(p[3] * 31), i1 = p[0] * 3, i2 = p[2] * 3;
    return function (ph) { return Math.sin(TAU * ph + i1 * Math.sin(TAU * r1 * ph) + i2 * Math.sin(TAU * r2 * ph)); };
  case "FM3":
    var q1 = p[1] * 32, q2 = p[3] * 32, j1 = p[0] * 3, j2 = p[2] * 3;
    return function (ph) { return Math.sin(TAU * ph + j1 * Math.sin(TAU * q1 * ph) + j2 * Math.sin(TAU * q2 * ph)); };
  case "Modern":
    a = p[0] * 2 - 1; b = p[1] * 2 - 1; c = p[2] * 2 - 1; w1 = clamp(p[3], 0.03, 0.97); ratio = Math.pow(2, p[4] * 5);
    n = Math.max(1, Math.abs(a) + Math.abs(b) + Math.abs(c));
    return function (ph) {
      var t = fpart(fpart(ph) * ratio);
      return (a * (2 * t - 1) + b * (t < w1 ? 1 : -1) + c * (t < 0.5 ? 4 * t - 1 : 3 - 4 * t)) / n;
    };
  case "String":
    var dec = (1 - p[2]) * 2.2, lvl = p[1], bright = 0.5 + p[6] * 0.5;
    return function (ph) {
      var t = fpart(ph), env = Math.exp(-dec * ph * 0.5);
      var shape = Math.sin(TAU * t) * (1 - bright * 0.5) + (t < 0.5 ? 4 * t - 1 : 3 - 4 * t) * bright * 0.5;
      var burst = ph < 0.35 ? rnd(Math.floor(ph * 40)) * lvl * (1 - ph / 0.35) : 0;
      return clamp(env * shape + burst, -1, 1);
    };
  case "Alias":
    var wv = Math.round(p[0] * 17);
    if (wv >= 4 && wv <= 9) return null; // a wave from memory or the input: nothing to read here
    var wrap = 1 + p[1] * 3, lev = Math.pow(2, 1 + p[4] * 7) / 2, thr = clamp(p[3], 0.03, 0.97);
    return function (ph) {
      var t = fpart(ph), y;
      if (wv === 1) y = 2 * t - 1;
      else if (wv === 2) y = t < thr ? 1 : -1;
      else if (wv === 3) y = rnd(Math.floor(ph * 24));
      else y = Math.sin(TAU * t);
      y = fpart((y * wrap + 1) / 2) * 2 - 1;
      return Math.round(y * lev) / lev;
    };
  }
  return null;
}
// points of a wave across a box: cycles cycles, an edge drawn straight down
// (smooth: a wave with no edges, FM or a sine, whose steep slopes are not jumps)
function wavePts(fn, x, y, w, h, cycles, step, ph0, smooth) {
  var pts = [], mid = y + h / 2, amp = h / 2 - 1, prev = null;
  for (var px = 0; px <= w; px += step) {
    var s = clamp(fn((ph0 || 0) + px / w * cycles), -1, 1), yy = mid - s * amp;
    if (!smooth && prev !== null && Math.abs(yy - prev) > amp * 0.6) pts.push(x + px, prev);
    pts.push(x + px, yy);
    prev = yy;
  }
  return pts;
}
// a wavetable's frames, as Surge's display stacks them: the one morph plays in orange
function tableStack(g, x, y, w, h, morph, col, n) {
  var frames = n || 9, dx = Math.min(10, w * 0.04), dy = h / (frames + 3), fw = w - dx * (frames - 1);
  var sel = Math.round(morph * (frames - 1));
  for (var i = frames - 1; i >= 0; i--) {
    var fx = x + i * dx, fy = y + h - 4 - i * dy;
    g.fill(fx, fy, fw, i === sel ? 2 : 1, i === sel ? col : C.faint);
  }
}
// an oscillator's display: its wave, or what stands for it
function oscDisplay(g, v, o, x, y, w, h, col, big) {
  var type = oscType(v, o), p = oscFracs(v, o);
  if (!known(v, "osc" + o + "_type")) { g.fill(x, y + h / 2, w, 1, C.faint); return; }
  if (type === "Wavetable" || type === "Window") {
    tableStack(g, x + 4, y + (big ? 12 : 2), w - 8, h - (big ? 14 : 4), p[0], col, big ? 13 : 7);
    return;
  }
  if (!oscFn(type, p)) { // no wave to draw: what plays instead
    g.fill(x, y + h / 2, w, 1, C.faint);
    var s = type === "Twist" ? pick(TWIST, p[0]).toUpperCase() : (type === "Alias" ? pick(ALIAS, p[0]).toUpperCase() : "AUDIO IN");
    if (big) g.value(x + w / 2, y + h / 2 - 6, s, col, 0, w - 20);
    else g.text(x + w / 2, y + h / 2 - 3, s, col, 0, w - 6);
    return;
  }
  var smooth = type === "Sine" || type === "FM2" || type === "FM3" || type === "String";
  var cycles = type === "String" ? 4 : 2, step = smooth ? 1 : 2;
  var sig = [o, type, x, y, w, h, cycles, p.map(function (q) { return q.toFixed(3); }).join(",")].join("|");
  // unison: the extra voices, detuned (Surge's spread), behind the first
  var uni = (type in { Classic: 1, Wavetable: 1, "S&H Noise": 1, Modern: 1, Alias: 1, Sine: 1, Window: 1 }) ? 1 + Math.round(p[6] * 15) : 1;
  if (big && uni > 1) {
    var spread = 0.02 + p[5] * 0.25;
    for (var u = 1; u < Math.min(uni, 3); u++) {
      var off = (u % 2 ? 1 : -1) * Math.ceil(u / 2) * spread * 0.5;
      g.poly(cached("u" + u + "|" + sig, function () { return wavePts(oscFn(type, p), x, y + 3, w, h - 6, cycles, step, off, smooth); }), 1, "#6e3f00");
    }
  }
  g.poly(cached("w|" + sig, function () { return wavePts(oscFn(type, p), x, y + 3, w, h - 6, cycles, step, 0, smooth); }), big ? 2 : 1.5, col);
}

// ---- the FM routing between the oscillators -----------------------------------------------
function fmDiagram(g, v, x, y, w, hot) {
  var sw = opt(v, "fm_switch") || "Off", on = sw !== "Off";
  var bx = [x, x + w / 2 - 14, x + w - 28], by = y + 10, col = hot ? "slot" : (on ? C.or : C.faint);
  for (var i = 0; i < 3; i++) {
    var aud = audible(v, i + 1);
    g.fill(bx[i], by, 28, 18, aud ? C.raised : C.panel);
    box(g, bx[i], by, 28, 18, hot ? "slot" : C.edge);
    g.text(bx[i] + 14, by + 13, String(i + 1), aud ? C.ink : C.faint, 0);
  }
  function arrowL(xa, xb, yy) { // from xa leftwards to xb
    g.line(xa, yy, xb + 2, yy, 2, col); g.line(xb + 2, yy, xb + 7, yy - 3, 2, col); g.line(xb + 2, yy, xb + 7, yy + 3, 2, col);
  }
  var my = by + 9;
  if (sw === "2 > 1" || sw === "3 > 2 > 1" || sw === "2 > 1 < 3") arrowL(bx[1], bx[0] + 28, my);
  if (sw === "3 > 2 > 1") arrowL(bx[2], bx[1] + 28, my);
  if (sw === "2 > 1 < 3") { // 3 reaches over 2 to 1
    var ty = by - 6;
    g.line(bx[2] + 14, by, bx[2] + 14, ty, 2, col); g.line(bx[2] + 14, ty, bx[0] + 14, ty, 2, col);
    g.line(bx[0] + 14, ty, bx[0] + 14, by - 1, 2, col); g.line(bx[0] + 14, by - 1, bx[0] + 11, by - 6, 2, col); g.line(bx[0] + 14, by - 1, bx[0] + 17, by - 6, 2, col);
  }
  if (!on) g.text(x + w / 2, by + 33, "NO FM", C.faint, 0);
  else g.text(x + w / 2, by + 33, sw + "   " + show(v, "fm_depth").join(" ").toUpperCase(), hot ? "slot" : C.ink, 0, w + 10);
}
function audible(v, o) {
  return known(v, "level_o" + o) && !isOn(v, "mute_o" + o) && raw(v, "level_o" + o, 0) > 0.0001;
}

// ---- the filter block ---------------------------------------------------------------------
// a filter type as Pung's response reads it ("LP 24 dB", "Notch"); types
// it cannot draw (comb, allpass, S&H, the multi-mode units) keep a name, and
// Pung draws no curve for them
function pungType(s) {
  if (!s || s === "Off") return "Off";
  var db = /(\d+) dB/.exec(s), poles = db ? db[1] : (/Ladder/.test(s) ? "24" : "12");
  if (/^LP /.test(s)) return "LP " + poles + " dB";
  if (/^HP /.test(s)) return "HP " + poles + " dB";
  if (/^BP /.test(s)) return "BP " + poles + " dB";
  if (/^N /.test(s)) return "Notch";
  if (/Comb/.test(s)) return "Comb";
  if (/Allpass|AP$/.test(s)) return "All-pass";
  return s.replace(/^(FX|MULTI) /, "");
}
function typeShort(s) {
  if (!s) return "--";
  return s.replace(/^FX /, "").replace(/^MULTI /, "").replace(" Cutoff Warp", " C-WARP").replace(" Res Warp", " R-WARP")
    .replace("Sample & Hold", "S&H").replace(" Ladder", " LADDER").replace("Legacy", "LEG.").replace("Vintage", "VINT.").toUpperCase();
}
// the filter block's state, read once a draw
function fblock(v) {
  var t1 = opt(v, "filter1_type"), t2 = opt(v, "filter2_type"), ws = opt(v, "ws_type");
  return {
    cfg: opt(v, "fb_config") || "Serial 1",
    f1: t1, f2: t2, ws: ws,
    f1on: !!t1 && t1 !== "Off", f2on: !!t2 && t2 !== "Off", wson: !!ws && ws !== "Off",
    fb: raw(v, "feedback", 0), bal: raw(v, "f_balance", 0)
  };
}
// the configuration as Surge draws it: the units, the waveshaper, the
// feedback path, mono or a stereo pair. Big: the units show their types.
function cfgDiagram(g, x, y, w, h, s, hot, big) {
  var bw = big ? 76 : 30, bh = big ? 26 : 14, pad = big ? 22 : 14;
  var cx = function (c) { return x + pad + (w - 2 * pad) * c / 4; };
  var two = s.cfg !== "Serial 1" && s.cfg !== "Serial 2";
  var yt = y + h * (big ? 0.40 : 0.42), yb = y + h * (big ? 0.82 : 0.81), ym = two ? (yt + yb) / 2 : y + h * 0.58, yl = y + (big ? 6 : 4);
  var wire = C.label, dim = C.faint;
  function unit(c, yy, kind) {
    var on = kind === "F1" ? s.f1on : (kind === "F2" ? s.f2on : s.wson);
    var name = kind === "F1" ? s.f1 : (kind === "F2" ? s.f2 : s.ws), h1 = hot[kind];
    var bx = cx(c) - bw / 2, by = yy - bh / 2;
    g.fill(bx, by, bw, bh, on ? C.raised : C.field);
    box(g, bx, by, bw, bh, h1 ? "slot" : (on ? (kind === "F2" ? C.blue : (kind === "WS" ? C.label : C.or)) : C.edge), h1 ? 2 : 1);
    var label = kind === "WS" ? "WS" : kind;
    if (big) {
      g.text(bx + 6, by + 11, kind === "WS" ? "SHAPER" : (kind === "F1" ? "FILTER 1" : "FILTER 2"), h1 ? "slot" : C.label, -1);
      g.text(bx + 6, by + 22, on ? typeShort(name) : (name ? "OFF" : "--"), on ? C.ink : C.faint, -1, bw - 10);
    } else {
      g.text(bx + bw / 2, by + 11, label, on ? C.ink : C.faint, 0);
    }
  }
  function line(pts, col) { g.poly(pts, big ? 1.5 : 1, col || wire); }
  function node(xx, yy, sym) { // a sum or a product
    g.dot(xx, yy, big ? 6 : 4, C.field); g.arc(xx, yy, big ? 6 : 4, 0, TAU, 1, wire);
    g.text(xx, yy + (big ? 4 : 3), sym, C.ink, 0);
  }
  function io(xx, yy, sname, left) { g.text(xx, yy + 4, sname, C.label, left ? 1 : -1); }
  var xin = cx(0) - (big ? 6 : 4), xout = cx(4) + (big ? 6 : 4), sx = cx(0) + (big ? 12 : 6);
  io(xin, ym, "IN", true);
  // the feedback path: out back to in; Serial 1 has none
  var fbOn = Math.abs(s.fb) > 0.004, hasFb = s.cfg !== "Serial 1", fcol = hot.FB ? "slot" : (fbOn ? C.or : dim);
  if (s.cfg === "Serial 1" || s.cfg === "Serial 2") {
    line([xin + 2, ym, cx(1) - bw / 2, ym]);
    line([cx(1) + bw / 2, ym, cx(2) - bw / 2, ym]);
    line([cx(2) + bw / 2, ym, cx(3) - bw / 2, ym]);
    line([cx(3) + bw / 2, ym, xout - 2, ym]);
    unit(1, ym, "F1"); unit(2, ym, "WS"); unit(3, ym, "F2");
    io(xout, ym, "OUT", false);
  } else if (s.cfg === "Serial 3") { // filter 2 only in the feedback path
    line([xin + 2, yt, cx(1) - bw / 2, yt]); line([cx(1) + bw / 2, yt, cx(2) - bw / 2, yt]); line([cx(2) + bw / 2, yt, xout - 2, yt]);
    unit(1, yt, "F1"); unit(2, yt, "WS");
    io(xout, yt, "OUT", false);
    line([cx(3.4), yt, cx(3.4), yb, cx(2.5) + bw / 2, yb], fcol);
    line([cx(2.5) - bw / 2, yb, sx, yb, sx, yt], fcol);
    unit(2.5, yb, "F2");
    fbLabel(g, cx(1.2), yb, s.fb, fcol, big);
    hasFb = false;
  } else if (s.cfg === "Stereo" || s.cfg === "Wide") {
    line([xin + 2, ym, sx, ym]); line([sx, yt, sx, yb]);
    var lanes = [yt, yb];
    for (var i = 0; i < 2; i++) {
      var yy = lanes[i];
      if (s.cfg === "Wide") {
        line([sx, yy, cx(1) - bw / 2, yy]); line([cx(1) + bw / 2, yy, cx(2) - bw / 2, yy]); line([cx(2) + bw / 2, yy, cx(3) - bw / 2, yy]); line([cx(3) + bw / 2, yy, xout - 2, yy]);
        unit(1, yy, "F1"); unit(2, yy, "WS"); unit(3, yy, "F2");
      } else {
        line([sx, yy, cx(1.3) - bw / 2, yy]); line([cx(1.3) + bw / 2, yy, cx(2.7) - bw / 2, yy]); line([cx(2.7) + bw / 2, yy, xout - 2, yy]);
        unit(1.3, yy, i ? "F2" : "F1"); unit(2.7, yy, "WS");
      }
      io(xout, yy, i ? "R" : "L", false);
    }
  } else { // Dual 1, Dual 2, Ring: two units side by side, then summed or multiplied
    line([xin + 2, ym, sx, ym]); line([sx, yt, sx, yb]);
    line([sx, yt, cx(1) - bw / 2, yt]); line([sx, yb, cx(1) - bw / 2, yb]);
    unit(1, yt, "F1"); unit(1, yb, "F2");
    var mx;
    if (s.cfg === "Dual 2") { // the shaper on filter 1's side only
      line([cx(1) + bw / 2, yt, cx(2) - bw / 2, yt]); unit(2, yt, "WS");
      mx = cx(3);
      line([cx(2) + bw / 2, yt, mx, yt, mx, ym - (big ? 6 : 4)]);
      line([cx(1) + bw / 2, yb, mx, yb, mx, ym + (big ? 6 : 4)]);
      node(mx, ym, "+");
      line([mx + (big ? 6 : 4), ym, xout - 2, ym]);
    } else {
      mx = cx(2);
      line([cx(1) + bw / 2, yt, mx, yt, mx, ym - (big ? 6 : 4)]);
      line([cx(1) + bw / 2, yb, mx, yb, mx, ym + (big ? 6 : 4)]);
      node(mx, ym, s.cfg === "Ring" ? "x" : "+");
      line([mx + (big ? 6 : 4), ym, cx(3) - bw / 2, ym]); unit(3, ym, "WS");
      line([cx(3) + bw / 2, ym, xout - 2, ym]);
    }
    io(xout, ym, "OUT", false);
  }
  if (hasFb) { // the loop over the top, from the output back to the input
    var fx0 = cx(3.65), fx1 = sx + (two ? 0 : 6), fy = two ? yt - bh / 2 : ym;
    line([fx0, fy - (two ? 0 : bh / 2 + 0), fx0, yl, fx1, yl, fx1, two ? yt - bh / 2 - 1 : ym], fcol);
    if (!two) { g.line(fx1, ym - 1, fx1 - 3, ym - 5, 1, fcol); g.line(fx1, ym - 1, fx1 + 3, ym - 5, 1, fcol); }
    fbLabel(g, (fx0 + fx1) / 2, yl, s.fb, fcol, big);
  }
}
function fbLabel(g, x, y, fb, col, big) {
  var s = Math.abs(fb) > 0.004 ? "FB " + sgn(fb * 100, 0) + "%" : (big ? "FEEDBACK 0" : "FB 0");
  var w = g.measure(s) + 8;
  g.fill(x - w / 2, y - 5, w, 10, C.panel);
  g.text(x, y + 4, s, col, 0);
}

// the waveshaper's transfer curve: input across, output up, at its drive
function wsFn(name, drive) {
  var n = (name || "Off").toLowerCase(), gain = Math.pow(10, drive / 20);
  var cheb = /chebyshev(\d?)/.exec(n), order = cheb ? (cheb[1] ? +cheb[1] + 1 : 2) : 0;
  return function (u) {
    var x = u * gain;
    if (n === "off") return clamp(u, -1, 1);
    if (cheb) { var c = clamp(x, -1, 1); return Math.cos(order * Math.acos(c)); }
    if (/fold/.test(n)) return Math.asin(Math.sin(x * Math.PI / 2)) * 2 / Math.PI;
    if (/bitcrush|digital|decimat|sample/.test(n)) return Math.round(clamp(x, -1, 1) * 4) / 4;
    if (/fuzz\+oct/.test(n)) return clamp(Math.tanh(Math.abs(x) * 2) * 2 - 1, -1, 1);
    if (/fuzz/.test(n)) return (x < 0 ? -1 : 1) * Math.min(1, Math.pow(Math.abs(x), 0.35));
    if (/asym/.test(n)) return x > 0 ? Math.tanh(x) : Math.max(-0.55, Math.tanh(x * 0.7) * 0.8);
    if (/sine|sinus/.test(n)) return Math.sin(clamp(x, -3, 3));
    if (/s-curve|waveshaper/.test(n)) { var q = clamp(x, -1.5, 1.5); return clamp(q - q * q * q / 3.375 * 0.9, -1, 1); }
    if (/hard|clip/.test(n) && !/soft/.test(n)) return clamp(x, -1, 1);
    if (/slew/.test(n)) return clamp(u, -1, 1);
    return Math.tanh(x);
  };
}
function wsBox(g, x, y, w, h, name, drive, hot, on, read) {
  g.fill(x, y, w, h, C.field);
  box(g, x, y, w, h, hot ? "slot" : C.edge, hot ? 2 : 1);
  var cx = x + w / 2, cy = y + h / 2, a = Math.min(w - 12, h - 32) / 2;
  g.fill(cx - a, cy, a * 2, 1, C.faint); g.fill(cx, cy - a, 1, a * 2, C.faint);
  var pts = cached(["ws", x, y, w, h, name, drive.toFixed(1)].join("|"), function () {
    var f = wsFn(name, drive), out = [];
    for (var i = -24; i <= 24; i++) out.push(cx + i / 24 * a, cy - clamp(f(i / 24), -1, 1) * a);
    return out;
  });
  g.poly(pts, 2, hot ? "slot" : (on ? C.ink : C.faint));
  g.text(x + 5, y + 11, "SHAPER", hot ? "slot" : C.label, -1);
  g.text(x + w / 2, y + h - 4, on ? name.toUpperCase() : (read ? "OFF" : "--"), on ? C.ink : C.faint, 0, w - 8);
}

// ---- Surge's sliders: the encoder row of its front panels -------------------------------
// items: eight of {key, name, val: [text, unit], bip, steps}; the touched one in the slot's colour
// (while segment mode is on, Pung names the segments in the bottom 18 px: the row ends above y 142)
function sliderRow(g, v, items) {
  var t = v.$touched || "", seg = !!v.$segmode, yn = seg ? 115 : 121, ty = seg ? 121 : 130, yv = seg ? 141 : 153, hh = seg ? 9 : 13;
  for (var i = 0; i < 8; i++) {
    var it = items[i];
    if (!it || !it.key) continue;
    var cx = i * 120 + 60, hot = it.key === t, k = it.key;
    g.text(cx, yn, (it.name || "").toUpperCase(), hot ? C.ink : C.label, 0, 112);
    var x0 = cx - 46, tw = 92;
    if (!known(v, k)) {
      g.fill(x0, ty, tw, 3, C.raised);
      g.value(cx, yv, "--", C.faint, 0);
      continue;
    }
    var f = v[k].frac;
    if (it.steps && it.steps <= 8) { // a switch: its positions, the one it stands at lit
      var n = it.steps, sw = (tw - (n - 1) * 3) / n, at = Math.round(f * (n - 1));
      for (var s = 0; s < n; s++) g.fill(x0 + s * (sw + 3), ty - 1, sw, 5, s === at ? (hot ? "slot" : C.or) : C.raised);
    } else {
      g.fill(x0, ty, tw, 3, C.raised);
      var hx = x0 + f * tw, from = it.bip ? x0 + tw / 2 : x0;
      if (it.bip) g.fill(x0 + tw / 2, ty - 3, 1, 9, C.edge);
      g.fill(Math.min(from, hx), ty, Math.abs(hx - from), 3, hot ? "slot" : C.orMid);
      g.fill(hx - 3, ty + 1 - hh / 2, 7, hh, hot ? "slot" : C.ink);
      g.fill(hx - 1, ty + 3 - hh / 2, 3, hh - 4, hot ? C.ink : C.or);
    }
    var val = it.val || show(v, k), unit = val[1] ? val[1] : "";
    var uw = unit ? g.measure(unit.toUpperCase()) + 4 : 0, vw = Math.min(g.measure(val[0], "value"), 108 - uw);
    var vx = cx - (vw + uw) / 2;
    g.value(vx, yv, val[0], hot ? "slot" : C.ink, -1, 108 - uw);
    if (unit) g.text(vx + vw + 4, yv, unit.toUpperCase(), C.label, -1);
  }
}
function rowGround(g) {
  g.fill(0, 104, 960, 56, C.head);
  g.fill(0, 104, 960, 1, "#000000");
  for (var c = 1; c < 8; c++) g.fill(c * 120, 112, 1, 42, C.raised);
}

// ---- the top bar: scene, the patch browser, the page --------------------------------------
var PLAY = { "Poly": "POLY", "Mono": "MONO", "Mono (Single Trigger)": "MONO ST", "Mono (Fingered Portamento)": "MONO FP",
  "Mono (Single Trigger & Fingered Portamento)": "MONO ST+FP", "Latch (Monophonic)": "LATCH" };
function topGround(g) {
  g.fill(0, 0, 960, 160, C.bg);
  g.fill(0, 0, 960, 25, C.head);
  g.fill(0, 25, 960, 1, "#000000");
  g.fill(134, 3, 492, 19, C.field);
  g.text(950, 16, "SURGE XT", C.ink, 1);
}
function topBar(g, v, section) {
  // the scene buttons: the module plays scene A
  g.fill(8, 4, 20, 17, C.or); g.text(18, 16, "A", "#000000", 0);
  g.fill(30, 4, 20, 17, C.raised); g.text(40, 16, "B", C.faint, 0);
  var pm = opt(v, "polymode");
  g.text(60, 16, PLAY[pm] || (pm ? pm.toUpperCase() : "--"), v.$touched === "polymode" ? "slot" : C.label, -1, 70);
  // the patch browser: category, name, number
  var cat = txt(v, "bank_name").toUpperCase(), name = txt(v, "preset_name");
  var n = parseInt(txt(v, "preset"), 10), cnt = parseInt(txt(v, "preset_count"), 10);
  var num = isNaN(n) ? "" : (n + 1) + (isNaN(cnt) ? "" : " / " + cnt);
  var nw = num ? g.measure(num) + 14 : 0;
  var cw = cat ? Math.min(150, g.measure(cat)) + 14 : 0;
  if (cat) g.text(144, 16, cat, C.or, -1, 150);
  g.value(144 + cw, 18, name || "--", C.ink, -1, 474 - cw - nw);
  if (num) g.text(618, 16, num, C.label, 1);
  // where the encoders are
  var ps = v.$pages || [], s = section.toUpperCase();
  g.text(636, 16, s, C.ink, -1);
  if (ps.length > 1) g.text(636 + g.measure(s) + 10, 16, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, C.label, -1, 236 - g.measure(s));
}
function section(g, x, y, w, h, title) {
  g.fill(x, y, w, h, C.panel);
  g.text(x + 6, y + 11, title, C.label, -1);
}

// ---- PATCH: the front panel ---------------------------------------------------------------
var PATCH_NAMES = {
  filter1_cutoff: "F1 Cutoff", filter1_resonance: "F1 Resonance", filter1_envmod: "F1 FEG Mod", env1_attack: "AEG Attack",
  env1_decay: "AEG Decay", env1_sustain: "AEG Sustain", env1_release: "AEG Release", volume: "Volume",
  osc1_type: "Osc 1", osc2_type: "Osc 2", osc3_type: "Osc 3", fm_switch: "FM Routing", fb_config: "Filter Config",
  filter1_type: "Filter 1", ws_type: "Waveshaper", filter2_type: "Filter 2",
  filter2_cutoff: "F2 Cutoff", filter2_resonance: "F2 Resonance", filter2_envmod: "F2 FEG Mod", feedback: "Feedback",
  f_balance: "Balance", ws_drive: "WS Drive", lowcut: "Low Cut", level_pfg: "Pre-Filter", pan: "Pan", pan2: "Width",
  polymode: "Play Mode", octave: "Octave", pitch: "Pitch", portamento: "Portamento", send_fx_1: "Send FX 1"
};

var STEPS = { fm_switch: 4, fb_config: 8, octave: 7, polymode: 6 };
var BIPOLAR = /envmod|keytrack|^pan|feedback|balance|_pitch$|^pitch$|noisecol|deform|amount|level_pfg|vca_level|ws_drive/;
function patchPanel(g, v) {
  var t = v.$touched || "", s = fblock(v), sg = v.$segmode === "segment" ? v.$segment || "" : ""; // the segment: its name lit (Pung's bar above it)
  g.layer("surge-patch-1", function () {
    topGround(g);
    section(g, 4, 29, 316, 73, "OSCILLATORS");
    section(g, 324, 29, 380, 73, "FILTERS");
    section(g, 708, 29, 248, 73, "");
    for (var i = 0; i < 3; i++) g.fill(12 + i * 102, 58, 98, 26, C.field);
    rowGround(g);
  });
  topBar(g, v, "Patch");
  // the oscillators: type, wave, level, mute
  var fmsw = opt(v, "fm_switch");
  if (fmsw && fmsw !== "Off") g.text(314, 40, "FM " + fmsw, t === "fm_switch" ? "slot" : C.or, 1);
  else if (t === "fm_switch") g.text(314, 40, "NO FM", "slot", 1);
  for (var o = 1; o <= 3; o++) {
    var x = 12 + (o - 1) * 102, aud = audible(v, o), hot = t === "osc" + o + "_type" || t === "level_o" + o;
    g.fill(x, 44, 13, 12, aud ? C.or : C.raised);
    g.text(x + 7, 54, String(o), aud ? "#000000" : C.label, 0);
    g.text(x + 18, 54, opt(v, "osc" + o + "_type").toUpperCase() || "--", hot || sg === "osc" + o ? "slot" : (aud ? C.ink : C.label), -1, 80);
    oscDisplay(g, v, o, x + 2, 58, 94, 26, hot ? "slot" : (aud ? C.or : C.orDk), false);
    if (hot) box(g, x, 58, 98, 26, "slot");
    var lv = fr(v, "level_o" + o, 0);
    g.fill(x, 90, 50, 3, C.raised);
    g.fill(x, 90, Math.round(50 * lv), 3, aud ? C.orMid : C.faint);
    var oc = opt(v, "osc" + o + "_octave");
    g.text(x + 98, 95, isOn(v, "mute_o" + o) ? "MUTE" : (oc && oc !== "0" ? "OCT " + oc : ""), isOn(v, "mute_o" + o) ? C.red : C.label, 1);
  }
  // the filter block: the configuration, and both responses on one axis
  g.text(698, 40, (opt(v, "fb_config") || "--").toUpperCase(), t === "fb_config" || sg === "config" ? "slot" : C.or, 1);
  if (sg === "filters") g.text(330, 40, "FILTERS", "slot", -1);
  cfgDiagram(g, 328, 42, 186, 58, s, { F1: t.indexOf("filter1_") === 0, F2: t.indexOf("filter2_") === 0, WS: t.indexOf("ws_") === 0, FB: t === "feedback" }, false);
  responses(g, v, 516, 42, 184, 58, s);
  // the envelopes
  g.text(714, 40, "AMP EG", t.indexOf("env1_") === 0 || sg === "aeg" ? "slot" : C.label, -1);
  g.text(836, 40, "FILTER EG", t.indexOf("env2_") === 0 || sg === "feg" ? "slot" : C.label, -1);
  g.envelope(712, 44, 116, 56, { attack: "env1_attack", decay: "env1_decay", sustain: "env1_sustain", release: "env1_release", color: C.or });
  g.envelope(834, 44, 118, 56, { attack: "env2_attack", decay: "env2_decay", sustain: "env2_sustain", release: "env2_release", color: C.blue });
  // the encoders
  var kn = v.$knobs || [], items = [];
  for (var i = 0; i < 8; i++) items.push(knobItem(v, kn[i] || ""));
  sliderRow(g, v, items);
}
// an encoder of the panel: an oscillator's named as its type names it, the rest in Surge's words
function shortName(s) {
  return String(s || "").replace(/^Amp EG /, "AEG ").replace(/^Filter EG /, "FEG ").replace(/^Filter 1 /, "F1 ").replace(/^Filter 2 /, "F2 ")
    .replace(/^Waveshaper /, "WS ").replace(/ Shape$/, " Shape").replace(/ Envelope Mode$/, " Mode").replace(/ FEG Mod Amount$/, " FEG Mod");
}
function knobItem(v, k) {
  if (!k) return null;
  if (!PATCH_NAMES[k] && (/^osc\d_/.test(k) || /^(level|mute|solo|route)_o\d$/.test(k))) {
    var m = /(\d)/.exec(k);
    return oscItem(v, k, oscType(v, +m[1]));
  }
  var steps = STEPS[k];
  if (/^env\d_(attack|decay|release)_shape$/.test(k)) steps = 3;
  if (/^env\d_mode$/.test(k)) steps = 2;
  return { key: k, name: PATCH_NAMES[k] || shortName(v[k] ? v[k].name : k), bip: BIPOLAR.test(k), steps: steps,
    val: /_type$/.test(k) ? [opt(v, k), ""] : null };
}
// both filters' responses on one axis (F2 behind F1), live
function responses(g, v, x, y, w, h, s) {
  var s1 = raw(v, "filter1_cutoff", 3);
  if (s.f2on) {
    var s2 = raw(v, "filter2_cutoff", 3) + (isOn(v, "f2_cf_is_offset") ? s1 : 0);
    g.filter(x, y, w, h, { cutoff: "filter2_cutoff", at: axisAt(s2), resonance: isOn(v, "f2_link_resonance") ? "filter1_resonance" : "filter2_resonance", type: pungType(s.f2), color: C.blue });
  }
  if (s.f1on || !s.f2on) g.filter(x, y, w, h, { cutoff: "filter1_cutoff", at: axisAt(s1), resonance: "filter1_resonance", type: pungType(s.f1), color: C.or });
}
// Pung's default pages in Surge's colours and sliders
push.theme({ ground: C.bg, panel: C.raised, ink: C.ink, dim: C.label, rule: C.edge, faint: C.faint, accent: C.or, knob: "fader" });
push.compartment({
  id: "patch", label: "Patch", front_panel: true,
  pages: [
    { label: "Sound", keys: ["filter1_cutoff", "filter1_resonance", "filter1_envmod", "env1_attack", "env1_decay", "env1_sustain", "env1_release", "volume"] },
    { label: "Structure", keys: ["osc1_type", "osc2_type", "osc3_type", "fm_switch", "fb_config", "filter1_type", "ws_type", "filter2_type"] }
  ],
  segments: [
    { id: "osc1", label: "Osc 1", rect: [12, 44, 98, 54], keys: ["osc1_type", "osc1_octave", "osc1_pitch", "osc1_param0", "osc1_param1", "osc1_param2", "osc1_param3", "level_o1"] },
    { id: "osc2", label: "Osc 2", rect: [114, 44, 98, 54], keys: ["osc2_type", "osc2_octave", "osc2_pitch", "osc2_param0", "osc2_param1", "osc2_param2", "osc2_param3", "level_o2"] },
    { id: "osc3", label: "Osc 3", rect: [216, 44, 98, 54], keys: ["osc3_type", "osc3_octave", "osc3_pitch", "osc3_param0", "osc3_param1", "osc3_param2", "osc3_param3", "level_o3"] },
    { id: "config", label: "Config", rect: [326, 30, 190, 70], keys: ["fb_config", "feedback", "f_balance", "ws_type", "ws_drive", "lowcut", "level_pfg"] },
    { id: "filters", label: "Filters", rect: [516, 30, 186, 70], keys: ["filter1_type", "filter1_cutoff", "filter1_resonance", "filter1_envmod",
      "filter2_type", "filter2_cutoff", "filter2_resonance", "filter2_envmod"] },
    { id: "aeg", label: "Amp EG", rect: [710, 30, 120, 70], keys: ["env1_attack", "env1_decay", "env1_sustain", "env1_release",
      "env1_attack_shape", "env1_decay_shape", "env1_release_shape", "env1_mode"] },
    { id: "feg", label: "Filter EG", rect: [832, 30, 122, 70], keys: ["env2_attack", "env2_decay", "env2_sustain", "env2_release",
      "env2_attack_shape", "env2_decay_shape", "env2_release_shape", "env2_mode"] },
    { id: "scene", label: "Scene", rect: [4, 3, 626, 21], keys: ["volume", "pan", "pan2", "polymode", "octave", "pitch", "portamento", "send_fx_1"] }
  ],
  draws_segments: true,
  extra_keys: ["preset", "preset_name", "bank_name", "preset_count", "polymode",
    "osc1_type", "osc2_type", "osc3_type", "osc1_octave", "osc2_octave", "osc3_octave",
    "osc1_param0", "osc1_param1", "osc1_param2", "osc1_param3", "osc1_param4", "osc1_param5", "osc1_param6",
    "osc2_param0", "osc2_param1", "osc2_param2", "osc2_param3", "osc2_param4", "osc2_param5", "osc2_param6",
    "osc3_param0", "osc3_param1", "osc3_param2", "osc3_param3", "osc3_param4", "osc3_param5", "osc3_param6",
    "level_o1", "level_o2", "level_o3", "mute_o1", "mute_o2", "mute_o3", "fm_switch", "fm_depth",
    "fb_config", "feedback", "f_balance", "filter1_type", "filter2_type", "filter2_cutoff", "filter2_resonance",
    "f2_cf_is_offset", "f2_link_resonance", "ws_type", "ws_drive",
    "env2_attack", "env2_decay", "env2_sustain", "env2_release"],
  screen: patchPanel
});

// ---- OSCILLATORS: Surge's oscillator section (front panel) ----------------------------------
var OSC_COMMON = { type: "Type", octave: "Octave", pitch: "Pitch", keytrack: "Keytrack", retrigger: "Retrigger" };
function oscPages() {
  var out = [];
  for (var o = 1; o <= 3; o++) {
    var p = "osc" + o + "_";
    out.push({ label: "Osc " + o, keys: [p + "type", p + "octave", p + "pitch", p + "param0", p + "param1", p + "param2", p + "param3", p + "param4"] });
    out.push({ label: "Osc " + o + " +", keys: [p + "param5", p + "param6", p + "keytrack", p + "retrigger", "level_o" + o, "mute_o" + o, "solo_o" + o, "route_o" + o] });
  }
  out.push({ label: "FM", keys: ["fm_switch", "fm_depth", "drift", "noisecol", "ktrkroot"] });
  return out;
}
var OSC_STEPS = { octave: 7, keytrack: 2, retrigger: 2 };
function oscItem(v, k, type) {
  var m = /^osc(\d)_(.*)$/.exec(k), it = { key: k };
  if (m && /^param\d$/.test(m[2])) {
    var spec = OSC_PARAMS[type][+m[2].charAt(5)];
    it.name = spec[0]; it.bip = /bip|bcents|hz10|db48/.test(spec[1]); it.val = oscShow(v, k, spec[1]);
    if (!spec[0]) it.key = ""; // the type uses no parameter here
    if (spec[1] === "voices") it.steps = 0;
    return it;
  }
  if (m) {
    it.name = OSC_COMMON[m[2]] || m[2]; it.steps = OSC_STEPS[m[2]]; it.bip = m[2] === "pitch";
    if (m[2] === "type") it.val = [opt(v, k), ""];
    return it;
  }
  var mx = /^(level|mute|solo|route)_o\d$/.exec(k);
  if (mx) {
    it.name = { level: "Level", mute: "Mute", solo: "Solo", route: "Route" }[mx[1]];
    it.steps = mx[1] === "route" ? 3 : (mx[1] === "level" ? 0 : 2);
    return it;
  }
  it.name = { fm_switch: "FM Routing", fm_depth: "FM Depth", drift: "Osc Drift", noisecol: "Noise Color", ktrkroot: "Keytrack Root" }[k] || "";
  it.steps = k === "fm_switch" ? 4 : 0; it.bip = k === "noisecol";
  if (k === "ktrkroot") it.val = [opt(v, k), ""];
  return it;
}
function oscPanel(g, v) {
  var t = v.$touched || "", page = v.$page || 0, o = Math.min(3, Math.floor(page / 2) + 1), fmPage = page >= 6;
  if (v.$segmode === "segment" && v.$segment) { // a segment puts its oscillator (or FM) on the panel
    var sm = /^osc(\d)/.exec(v.$segment);
    if (sm) { o = +sm[1]; fmPage = false; } else if (v.$segment === "fm") fmPage = true;
  }
  var type = oscType(v, o), p = "osc" + o + "_";
  g.layer("surge-osc-1", function () {
    topGround(g);
    section(g, 4, 29, 222, 73, "");
    g.fill(230, 29, 486, 73, C.field);
    section(g, 720, 29, 236, 73, "FM ROUTING");
    rowGround(g);
  });
  topBar(g, v, "Oscillators");
  // the select buttons, the type, how it is tuned and played
  for (var i = 1; i <= 3; i++) {
    var sel = i === o && !fmPage, bx = 10 + (i - 1) * 24;
    g.fill(bx, 33, 21, 16, sel ? C.or : C.raised);
    g.text(bx + 10, 45, String(i), sel ? "#000000" : (audible(v, i) ? C.ink : C.faint), 0);
  }
  if (fmPage) oscCommon(g, v, t);
  else {
    g.value(84, 47, opt(v, p + "type") || "--", t === p + "type" ? "slot" : C.ink, -1, 136);
    var oc = opt(v, p + "octave"), pi = show(v, p + "pitch");
    g.text(10, 66, "OCTAVE " + (oc || "--") + "   PITCH " + pi[0] + " " + pi[1].toUpperCase(), t === p + "octave" || t === p + "pitch" ? "slot" : C.label, -1, 210);
    var kt = isOn(v, p + "keytrack"), rt = isOn(v, p + "retrigger");
    chip(g, 10, 72, "KEYTRACK", kt, t === p + "keytrack");
    chip(g, 82, 72, "RETRIGGER", rt, t === p + "retrigger");
    var muted = isOn(v, "mute_o" + o), lv = show(v, "level_o" + o);
    var mixHot = t === "level_o" + o || t === "mute_o" + o || t === "solo_o" + o || t === "route_o" + o;
    g.text(10, 98, muted ? "MUTED" : "LEVEL " + lv[0] + " " + lv[1].toUpperCase(), muted ? C.red : (mixHot ? "slot" : C.label), -1, 120);
    g.text(220, 98, "TO " + (routeShort(opt(v, "route_o" + o)) || "--") + (isOn(v, "solo_o" + o) ? "  SOLO" : ""), mixHot ? "slot" : C.label, 1);
  }
  // the display: the wave the type makes
  var aud = audible(v, o);
  g.fill(234, 65, 478, 1, C.raised);
  var lanes = fmPage || !!v.$segmode; // the three as lanes, where the segments are
  g.text(238, 41, lanes ? "OSC 1 2 3" : "OSC " + o, C.label, -1);
  var flags = [], pf = oscFracs(v, o);
  if (type === "Classic" || type === "Modern" || type === "S&H Noise") { if (pf[4] > 0.002) flags.push("SYNC " + (pf[4] * 60).toFixed(1) + " ST"); }
  if (type === "Classic" && pf[3] > 0.005) flags.push("SUB " + Math.round(pf[3] * 100) + "%");
  var uni = OSC_PARAMS[type][6][1] === "voices" ? 1 + Math.round(pf[6] * 15) : 1;
  if (type === "Window") flags.push("WINDOW " + pick(WINDOWS, pf[2]).toUpperCase());
  if (type === "Wavetable" || type === "Window") flags.push("MORPH " + Math.round(pf[0] * 100) + "%");
  if (uni > 1) flags.push("UNISON x" + uni + "  " + (pf[5] * 100).toFixed(0) + " CT");
  if (flags.length && !fmPage && v.$segmode !== "select") g.text(708, 41, flags.join("   "), C.label, 1);
  var hotWave = /^osc\d_param\d$/.test(t) || t === p + "type";
  if (lanes) { // the three, one above the other: what FM sends into what (a segment's lane: its number lit)
    var actO = v.$segmode === "segment" && !fmPage ? o : 0;
    for (var q = 1; q <= 3; q++) {
      var qy = 46 + (q - 1) * 18, qa = audible(v, q);
      g.text(244, qy + 12, String(q), q === actO ? "slot" : (qa ? C.ink : C.faint), 0);
      g.text(704, qy + 12, opt(v, "osc" + q + "_type").toUpperCase(), qa ? C.label : C.faint, 1);
      oscDisplay(g, v, q, 256, qy, 360, 14, q === actO && hotWave ? "slot" : (qa ? C.or : C.orDk), false);
    }
  } else oscDisplay(g, v, o, 236, 44, 472, 54, hotWave ? "slot" : (aud ? C.or : C.orMid), true);
  // FM between the three, and the key the oscillators' keytrack turns about
  fmDiagram(g, v, 744, 42, 188, t === "fm_switch" || t === "fm_depth");
  g.text(838, 98, "KEYTRACK ROOT " + (opt(v, "ktrkroot") || "--"), t === "ktrkroot" ? "slot" : C.label, 0, 226);
  var kn = v.$knobs || [], items = [];
  for (var j = 0; j < 8; j++) items.push(kn[j] ? oscItem(v, kn[j], oscType(v, +((/^osc(\d)/.exec(kn[j]) || [0, o])[1]))) : null);
  if (v.$segmode === "segment" && v.$segment === "fm") g.text(726, 40, "FM ROUTING", "slot", -1); // its heading lit
  sliderRow(g, v, items);
}
// the FM page's left block: the routing in words, its depth, drift and the noise's colour
var FM_WORDS = { "Off": "THE THREE RUN APART", "2 > 1": "OSC 2 MODULATES OSC 1", "3 > 2 > 1": "3 MODULATES 2, 2 MODULATES 1",
  "2 > 1 < 3": "2 AND 3 MODULATE OSC 1" };
function oscCommon(g, v, t) {
  var sw = opt(v, "fm_switch"), hot = t === "fm_switch" || t === "fm_depth";
  g.value(84, 47, sw === "Off" || !sw ? "No FM" : "FM " + sw, hot ? "slot" : C.ink, -1, 136);
  g.text(10, 66, FM_WORDS[sw] || "", sw && sw !== "Off" ? C.or : C.label, -1, 210);
  var d = show(v, "fm_depth");
  g.text(10, 82, "DEPTH " + d[0] + " " + d[1].toUpperCase(), t === "fm_depth" ? "slot" : (sw && sw !== "Off" ? C.ink : C.faint), -1, 210);
  var dr = show(v, "drift"), nc = show(v, "noisecol");
  g.text(10, 98, "DRIFT " + dr[0] + "%   NOISE COLOR " + nc[0] + "%", t === "drift" || t === "noisecol" ? "slot" : C.label, -1, 210);
}
function chip(g, x, y, s, on, hot) {
  var w = g.measure(s) + 10;
  g.fill(x, y, w, 14, on ? (hot ? "slot" : C.or) : C.raised);
  g.text(x + 5, y + 11, s, on ? "#000000" : (hot ? "slot" : C.label), -1);
}
var OSC_EXTRA = ["preset", "preset_name", "bank_name", "preset_count", "polymode", "fm_switch", "fm_depth",
  "level_o1", "level_o2", "level_o3", "mute_o1", "mute_o2", "mute_o3", "route_o1", "route_o2", "route_o3", "solo_o1", "solo_o2", "solo_o3"];
for (var oo = 1; oo <= 3; oo++) {
  OSC_EXTRA.push("osc" + oo + "_type", "osc" + oo + "_octave", "osc" + oo + "_pitch", "osc" + oo + "_keytrack", "osc" + oo + "_retrigger");
  for (var pp = 0; pp < 7; pp++) OSC_EXTRA.push("osc" + oo + "_param" + pp);
}
push.compartment({
  id: "osc", label: "Oscillators", front_panel: true,
  pages: oscPages(),
  // the three oscillators as the display's lanes (it shows them so while they are chosen), and FM
  segments: [
    { id: "osc1", label: "Osc 1", rect: [232, 45, 482, 18], keys: ["osc1_type", "osc1_octave", "osc1_pitch", "osc1_param0", "osc1_param1", "osc1_param2", "osc1_param3", "osc1_param4"] },
    { id: "osc2", label: "Osc 2", rect: [232, 63, 482, 18], keys: ["osc2_type", "osc2_octave", "osc2_pitch", "osc2_param0", "osc2_param1", "osc2_param2", "osc2_param3", "osc2_param4"] },
    { id: "osc3", label: "Osc 3", rect: [232, 81, 482, 18], keys: ["osc3_type", "osc3_octave", "osc3_pitch", "osc3_param0", "osc3_param1", "osc3_param2", "osc3_param3", "osc3_param4"] },
    { id: "fm", label: "FM", rect: [720, 29, 236, 73], keys: ["fm_switch", "fm_depth", "drift", "noisecol", "ktrkroot"] }
  ],
  draws_segments: true,
  extra_keys: OSC_EXTRA,
  screen: oscPanel
});

// ---- MIXER: Surge's six channel strips ------------------------------------------------------
var CH = [["o1", "OSC 1"], ["o2", "OSC 2"], ["o3", "OSC 3"], ["ring12", "RING 1x2"], ["ring23", "RING 2x3"], ["noise", "NOISE"]];
function mixerScreen(g, v) {
  var t = v.$touched || "", anySolo = false, i;
  for (i = 0; i < 6; i++) if (isOn(v, "solo_" + CH[i][0])) anySolo = true;
  var to1 = [], to2 = [];
  for (i = 0; i < 6; i++) {
    var id = CH[i][0], cx = i * 120 + 56, lk = "level_" + id;
    var muted = isOn(v, "mute_" + id), solo = isOn(v, "solo_" + id), r = opt(v, "route_" + id);
    var heard = !muted && (!anySolo || solo) && raw(v, lk, 0) > 0.0001;
    var hot = t === lk || t === "mute_" + id || t === "solo_" + id || t === "route_" + id;
    g.text(cx, 11, CH[i][1], hot ? "slot" : (heard ? C.ink : C.label), 0);
    // the vertical fader
    var fx = cx - 36, top = 18, h = 60, f = fr(v, lk, 0);
    g.fill(fx - 1, top, 4, h, C.raised);
    var hy = top + h - f * h;
    g.fill(fx - 1, hy, 4, top + h - hy, t === lk ? "slot" : (heard ? C.orMid : C.faint));
    g.fill(fx - 7, hy - 3, 16, 7, t === lk ? "slot" : (heard ? C.ink : C.label));
    g.fill(fx - 5, hy - 1, 12, 3, heard ? C.or : C.raised);
    // mute, solo, and where it goes
    btn(g, cx - 16, 20, "M", muted, C.red, t === "mute_" + id);
    btn(g, cx + 6, 20, "S", solo, "#e8d44a", t === "solo_" + id);
    var r1 = r === "Filter 1" || r === "Both", r2 = r === "Filter 2" || r === "Both";
    lamp(g, cx - 6, 45, "F1", r1, heard, t === "route_" + id, C.or);
    lamp(g, cx + 16, 45, "F2", r2, heard, t === "route_" + id, C.blue);
    var lv = show(v, lk);
    g.text(cx - 16, 74, lv[0] + " " + lv[1].toUpperCase(), t === lk ? "slot" : (heard ? C.ink : C.faint), -1, 72);
    if (heard && r1) to1.push(CH[i][1].replace("OSC ", ""));
    if (heard && r2) to2.push(CH[i][1].replace("OSC ", ""));
  }
  // the pre-filter gain, and what each filter hears
  var gx = 6 * 120 + 56, pg = raw(v, "level_pfg", 0), gf = fr(v, "level_pfg", 0.5), ghot = t === "level_pfg";
  g.text(gx, 11, "PRE-FILTER", ghot ? "slot" : C.label, 0);
  g.fill(gx - 2, 17, 4, 60, C.raised);
  g.fill(gx - 8, 47, 16, 1, C.edge);
  var py = 77 - gf * 60;
  if (known(v, "level_pfg")) {
    g.fill(gx - 2, Math.min(py, 47), 4, Math.abs(py - 47), ghot ? "slot" : C.orMid);
    g.fill(gx - 8, py - 3, 16, 7, ghot ? "slot" : C.ink);
  }
  g.text(gx + 14, 50, known(v, "level_pfg") ? sgn(pg, 1) + " DB" : "--", ghot ? "slot" : C.ink, -1);
  var ox = 7 * 120 + 4;
  g.text(ox, 22, "FILTER 1 HEARS", C.label, -1);
  g.text(ox, 36, to1.length ? to1.join(" ") : "NOTHING", to1.length ? C.or : C.faint, -1, 104);
  g.text(ox, 58, "FILTER 2 HEARS", C.label, -1);
  g.text(ox, 72, to2.length ? to2.join(" ") : "NOTHING", to2.length ? C.blue : C.faint, -1, 104);
}
function btn(g, x, y, s, on, col, hot) {
  g.fill(x, y, 16, 14, on ? col : C.raised);
  if (hot) box(g, x - 1, y - 1, 18, 16, "slot");
  g.text(x + 8, y + 11, s, on ? "#000000" : C.label, 0);
}
// a route lamp: lit where the channel feeds that filter (dimmed while the channel is not heard)
function lamp(g, x, y, s, on, heard, hot, col) {
  g.fill(x - 10, y - 6, 20, 14, on ? (heard ? col : C.edge) : C.raised);
  if (hot) box(g, x - 11, y - 7, 22, 16, "slot");
  g.text(x, y + 5, s, on ? (heard ? "#000000" : C.label) : C.faint, 0);
}
push.compartment({
  id: "mixer", label: "Mixer",
  pages: [
    { label: "Levels", keys: ["level_o1", "level_o2", "level_o3", "level_ring12", "level_ring23", "level_noise", "level_pfg"] },
    { label: "Mute", keys: ["mute_o1", "mute_o2", "mute_o3", "mute_ring12", "mute_ring23", "mute_noise"] },
    { label: "Solo", keys: ["solo_o1", "solo_o2", "solo_o3", "solo_ring12", "solo_ring23", "solo_noise"] },
    { label: "Route", keys: ["route_o1", "route_o2", "route_o3", "route_ring12", "route_ring23", "route_noise"] }
  ],
  screen: mixerScreen
});

// ---- FILTERS: the configuration, the waveshaper, both responses ------------------------------
function filterScreen(g, v) {
  var t = v.$touched || "", s = fblock(v);
  var hot = { F1: t.indexOf("filter1_") === 0, F2: t.indexOf("filter2_") === 0 || t.indexOf("f2_") === 0, WS: t.indexOf("ws_") === 0, FB: t === "feedback" };
  g.text(4, 11, (opt(v, "fb_config") || "--").toUpperCase(), t === "fb_config" ? "slot" : C.or, -1);
  var bal = raw(v, "f_balance", 0);
  if (Math.abs(bal) > 0.005) g.text(428, 11, "BALANCE " + sgn(bal * 100, 0) + "%", t === "f_balance" ? "slot" : C.label, 1);
  cfgDiagram(g, 0, 14, 432, 72, s, hot, true);
  wsBox(g, 440, 4, 92, 80, s.ws || "Off", raw(v, "ws_drive", 0), hot.WS, s.wson, !!s.ws);
  // both responses, the low cut, and how far each filter's EG moves it
  var rx = 540, rw = 408;
  responses(g, v, rx, 2, rw, 82, s);
  var lc = noteHz(raw(v, "lowcut", -72)), u = Math.log(Math.max(20, lc) / 20) / Math.LN10 / 3;
  if (known(v, "lowcut") && lc > 20) {
    var lx = rx + 6 + (rw - 12) * u;
    g.fill(lx, 8, 1, 70, t === "lowcut" ? "slot" : C.label);
    g.text(lx + 3, 16, "LOW CUT", t === "lowcut" ? "slot" : C.label, -1);
  }
  envReach(g, v, "filter1_", rx, rw, 74, C.or, s.f1on, t === "filter1_envmod");
  envReach(g, v, "filter2_", rx, rw, 80, C.blue, s.f2on, t === "filter2_envmod");
  var link = [];
  if (isOn(v, "f2_cf_is_offset")) link.push("F2 OFFSET FROM F1");
  if (isOn(v, "f2_link_resonance")) link.push("RESONANCE LINKED");
  if (link.length) g.text(rx + rw - 6, 16, link.join("  "), C.blue, 1);
}
// the filter EG's reach: from the cutoff to where the EG's peak takes it (its amount in semitones)
function envReach(g, v, p, rx, rw, y, col, on, hot) {
  if (!on || !known(v, p + "envmod")) return;
  var amt = raw(v, p + "envmod", 0);
  if (Math.abs(amt) < 0.5 && !hot) return;
  var sc = raw(v, p + "cutoff", 3);
  if (p === "filter2_" && isOn(v, "f2_cf_is_offset")) sc += raw(v, "filter1_cutoff", 3);
  var c = axisAt(sc), to = axisAt(sc + amt), x0 = rx + 6 + (rw - 12) * Math.min(c, to), x1 = rx + 6 + (rw - 12) * Math.max(c, to);
  g.fill(x0, y, Math.max(2, x1 - x0), 3, hot ? "slot" : col);
  var ex = amt >= 0 ? x1 : x0;
  g.fill(ex - 1, y - 3, 3, 9, hot ? "slot" : col);
  var lab = "FEG " + sgn(amt, 0) + " ST", lw = g.measure(lab) + 6, lx = amt >= 0 ? x1 + 4 : x0 - lw - 2;
  if (lx + lw > rx + rw) lx = x0 - lw - 2;
  if (lx < rx) lx = x1 + 4;
  g.fill(lx - 2, y - 5, lw, 11, "#000000");
  g.text(lx + 1, y + 4, lab, hot ? "slot" : col, -1);
}
push.compartment({
  id: "filter", label: "Filters",
  pages: [
    { label: "Config", keys: ["fb_config", "feedback", "f_balance", "lowcut", "ws_type", "ws_drive"] },
    { label: "Filter 1", keys: ["filter1_type", "filter1_subtype", "filter1_cutoff", "filter1_resonance", "filter1_envmod", "filter1_keytrack"] },
    { label: "Filter 2", keys: ["filter2_type", "filter2_subtype", "filter2_cutoff", "filter2_resonance", "filter2_envmod", "filter2_keytrack", "f2_cf_is_offset", "f2_link_resonance"] }
  ],
  screen: filterScreen
});

// ---- ENVELOPES: the amp and filter EGs, as one picture --------------------------------------
var SHAPE_WORD = { Convex: "CONVEX", Linear: "LINEAR", Concave: "CONCAVE", Quadratic: "QUADRATIC", Cubic: "CUBIC" };
function egHalf(g, v, n, x, w, title, col) {
  var p = "env" + n + "_", t = v.$touched || "", hot = t.indexOf(p) === 0;
  g.text(x + 4, 11, title, hot ? "slot" : C.ink, -1);
  var mode = opt(v, p + "mode");
  if (mode) {
    var mw = g.measure(mode.toUpperCase()) + 10, mx = x + g.measure(title) + 14;
    g.fill(mx, 2, mw, 12, t === p + "mode" ? "slot" : C.raised);
    g.text(mx + 5, 11, mode.toUpperCase(), t === p + "mode" ? "#000000" : C.ink, -1);
  }
  var shapes = ["attack", "decay", "release"], sx = x + w - 4;
  if (n === 1 && (v.$page || 0) === 2) { // the VCA after it: its gain, and what velocity takes from it
    var a = show(v, "vca_level"), b = show(v, "vca_velsense");
    var vs = "VELOCITY > GAIN " + b[0] + " DB";
    g.text(sx, 11, vs, t === "vca_velsense" ? "slot" : C.ink, 1);
    g.text(sx - g.measure(vs) - 16, 11, "GAIN " + a[0] + " DB", t === "vca_level" ? "slot" : C.ink, 1);
    shapes = [];
  }
  for (var i = shapes.length - 1; i >= 0; i--) {
    var k = p + shapes[i] + "_shape", s = SHAPE_WORD[opt(v, k)] || opt(v, k).toUpperCase() || "--";
    var lab = shapes[i].charAt(0).toUpperCase() + " " + s;
    g.text(sx, 11, lab, t === k ? "slot" : C.label, 1);
    sx -= g.measure(lab) + 12;
  }
  g.envelope(x, 16, w, 70, { attack: p + "attack", decay: p + "decay", sustain: p + "sustain", release: p + "release", labels: true, color: col });
}
push.compartment({
  id: "env", label: "Envelopes",
  pages: [
    { label: "Amp EG", keys: ["env1_attack", "env1_decay", "env1_sustain", "env1_release", "env1_attack_shape", "env1_decay_shape", "env1_release_shape", "env1_mode"] },
    { label: "Filter EG", keys: ["env2_attack", "env2_decay", "env2_sustain", "env2_release", "env2_attack_shape", "env2_decay_shape", "env2_release_shape", "env2_mode"] },
    { label: "Amp", keys: ["vca_level", "vca_velsense"] }
  ],
  screen: function (g, v) {
    egHalf(g, v, 1, 0, 470, "AMP EG", C.or);
    g.fill(476, 4, 1, 80, C.raised);
    egHalf(g, v, 2, 482, 470, "FILTER EG", C.blue);
  }
});

// ---- LFOS: one screen per LFO ---------------------------------------------------------------
var SRC_NAME = { velocity: "VELOCITY", keytrack: "KEYTRACK", polyaftertouch: "POLY AT", aftertouch: "AFTERTOUCH", pitchbend: "PITCH BEND",
  modwheel: "MOD WHEEL", ampeg: "AMP EG", filtereg: "FILTER EG", timbre: "TIMBRE", releasevelocity: "REL. VELOCITY",
  random_bipolar: "RANDOM", random_unipolar: "RANDOM UNI", alternate_bipolar: "ALTERNATE", alternate_unipolar: "ALTERNATE UNI",
  breath: "BREATH", expression: "EXPRESSION", sustain: "SUSTAIN PEDAL", lowest_key: "LOWEST KEY", highest_key: "HIGHEST KEY", latest_key: "LATEST KEY" };
function srcName(s) {
  if (!s) return "--";
  if (SRC_NAME[s]) return SRC_NAME[s];
  var m = /^(s?)lfo(\d)$/.exec(s);
  if (m) return (m[1] ? "S-LFO " : "LFO ") + m[2];
  m = /^macro(\d)$/.exec(s);
  if (m) return "MACRO " + m[1];
  return s.toUpperCase();
}
var DEST_PART = { cutoff: "CUTOFF", resonance: "RESO", envmod: "FEG MOD", keytrack: "KEYTRACK", attack: "ATTACK", decay: "DECAY",
  sustain: "SUSTAIN", release: "RELEASE", pitch: "PITCH", octave: "OCTAVE", type: "TYPE", rate: "RATE", magnitude: "AMPLITUDE",
  deform: "DEFORM", phase: "PHASE", delay: "DELAY", hold: "HOLD", subtype: "SUBTYPE" };
function destName(d) {
  if (!d || d === "none") return "--";
  var m = /^filter(\d)_(.*)$/.exec(d);
  if (m) return "F" + m[1] + " " + (DEST_PART[m[2]] || m[2].toUpperCase());
  m = /^env(\d)_(.*)$/.exec(d);
  if (m) return (m[1] === "1" ? "AEG " : "FEG ") + (DEST_PART[m[2]] || m[2].replace(/_/g, " ").toUpperCase());
  m = /^osc(\d)_(.*)$/.exec(d);
  if (m) return "OSC " + m[1] + " " + (/^param\d$/.test(m[2]) ? "P" + (+m[2].charAt(5) + 1) : (DEST_PART[m[2]] || m[2].toUpperCase()));
  m = /^lfo(\d+)_(.*)$/.exec(d);
  if (m) return (+m[1] < 6 ? "LFO " + (+m[1] + 1) : "S-LFO " + (+m[1] - 5)) + " " + (DEST_PART[m[2]] || m[2].toUpperCase());
  m = /^level_(.*)$/.exec(d);
  if (m) return (m[1].charAt(0) === "o" ? "OSC " + m[1].slice(1) : m[1].toUpperCase()) + " LEVEL";
  return d.replace(/_/g, " ").toUpperCase();
}
var MOD_KEYS = [];
for (var mi = 0; mi < 6; mi++) MOD_KEYS.push("mod_" + mi + "_enable", "mod_" + mi + "_source", "mod_" + mi + "_dest", "mod_" + mi + "_amount");
function modSlot(v, i) {
  var p = "mod_" + i + "_";
  return { on: isOn(v, p + "enable"), src: opt(v, p + "source"), dest: opt(v, p + "dest"), amt: raw(v, p + "amount", 0), known: known(v, p + "source") };
}
function lfoPages(first, n, prefix) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var p = "lfo" + (first + i) + "_";
    out.push({ label: prefix + " " + (i + 1), keys: [p + "shape", p + "rate", p + "phase", p + "magnitude", p + "deform", p + "trigmode", p + "unipolar"] });
    out.push({ label: prefix + " " + (i + 1) + " EG", keys: [p + "delay", p + "attack", p + "hold", p + "decay", p + "sustain", p + "release"] });
  }
  return out;
}
function lfoScreen(first, prefix, srcPrefix) {
  return function (g, v) {
    var page = v.$page || 0, li = Math.floor(page / 2), n = first + li, p = "lfo" + n + "_", t = v.$touched || "";
    var shape = opt(v, p + "shape"), egPage = page % 2 === 1;
    // the title: which, its type, its rate, how notes start it
    var rate = show(v, p + "rate"), tm = opt(v, p + "trigmode");
    g.text(4, 11, prefix + " " + (li + 1), C.ink, -1);
    g.text(4 + g.measure(prefix + " " + (li + 1)) + 12, 11, (shape || "--").toUpperCase() + "   " + rate[0] + " " + rate[1].toUpperCase() +
      "   " + (tm || "").toUpperCase() + (isOn(v, p + "unipolar") ? "   UNIPOLAR" : ""), egPage ? C.label : C.or, -1, 560);
    // the wave at its amplitude, and its envelope
    var amp = fr(v, p + "magnitude", 1), isEnv = shape === "Envelope";
    var wx = 4, ww = 470, ex = 484, ew = 300;
    if (isEnv) { ex = 4; ew = 780; }
    else {
      var hh = Math.max(10, 70 * amp), yy = 16 + (70 - hh) / 2;
      if (amp < 0.005) { g.fill(wx + 6, 51, ww - 12, 1, C.faint); g.text(wx + ww / 2, 46, "AMPLITUDE 0", C.faint, 0); }
      else g.lfo(wx, yy, ww, hh, { shape: p + "shape", rate: p + "rate", trig: tm === "Keytrigger", color: egPage ? C.orMid : C.or });
      g.fill(479, 18, 1, 66, C.raised);
    }
    g.envelope(ex, 16, ew, 70, { delay: p + "delay", attack: p + "attack", hold: p + "hold", decay: p + "decay", sustain: p + "sustain",
      release: p + "release", labels: true, color: egPage ? C.or : C.orMid });
    // where the mod slots send it
    var src = srcPrefix + (li + 1), rx = 796, y = 12, any = false;
    g.text(rx, y, "MODULATES", C.label, -1);
    for (var i = 0; i < 6; i++) {
      var s = modSlot(v, i);
      if (!s.known || s.src !== src || s.dest === "none") continue;
      any = true; y += 14;
      if (y > 84) break;
      g.text(rx, y, destName(s.dest), s.on ? C.ink : C.faint, -1, 104);
      g.text(948, y, sgn(s.amt, 2), s.on ? C.blue : C.faint, 1);
    }
    if (!any) g.text(rx, 26, "NO SLOT", C.faint, -1);
  };
}
push.compartment({ id: "lfo", label: "LFOs", pages: lfoPages(0, 6, "LFO"), extra_keys: MOD_KEYS, screen: lfoScreen(0, "LFO", "lfo") });
push.compartment({ id: "slfo", label: "Scene LFOs", pages: lfoPages(6, 6, "S-LFO"), extra_keys: MOD_KEYS, screen: lfoScreen(6, "S-LFO", "slfo") });

// ---- MODULATION: the module's six slots, as routings -------------------------------------------
function modScreen(g, v) {
  var page = v.$page || 0, t = v.$touched || "";
  for (var h = 0; h < 2; h++) { // the page's two slots, each over its four encoders
    var i = page * 2 + h, s = modSlot(v, i), p = "mod_" + i + "_", x = h * 480 - 4;
    var col = s.on ? C.ink : C.faint, live = s.on && s.dest !== "none";
    g.text(x + 60, 11, "SLOT " + (i + 1), t.indexOf(p) === 0 ? "slot" : C.label, 0);
    g.fill(x + 44, 18, 32, 15, s.on ? (t === p + "enable" ? "slot" : C.or) : C.raised);
    g.text(x + 60, 29, s.on ? "ON" : "OFF", s.on ? "#000000" : (t === p + "enable" ? "slot" : C.label), 0);
    g.text(x + 180, 11, "SOURCE", C.label, 0);
    g.value(x + 180, 32, srcName(s.src), t === p + "source" ? "slot" : col, 0, 104);
    g.text(x + 300, 11, "TARGET", C.label, 0);
    g.value(x + 300, 32, destName(s.dest), t === p + "dest" ? "slot" : col, 0, 104);
    // from source to target: an arrow on the columns' border
    var ax = x + 240, ac = live ? C.label : C.faint;
    g.line(ax - 3, 22, ax + 3, 26, 1.5, ac); g.line(ax - 3, 30, ax + 3, 26, 1.5, ac);
    // the amount, Surge's modulation blue, from the middle
    var a = clamp(s.amt, -1, 1), bx = x + 420, bw = 96, hot = t === p + "amount";
    g.text(bx, 11, "AMOUNT", C.label, 0);
    g.fill(bx - bw / 2, 25, bw, 3, C.raised);
    g.fill(bx, 19, 1, 15, C.edge);
    g.fill(a >= 0 ? bx : bx + a * bw / 2, 23, Math.abs(a) * bw / 2, 7, hot ? "slot" : (live ? C.blue : C.faint));
  }
  // all six at once
  g.fill(0, 42, 944, 1, C.raised);
  g.fill(314, 50, 1, 32, C.raised); g.fill(630, 50, 1, 32, C.raised);
  for (var j = 0; j < 6; j++) {
    var m = modSlot(v, j), cx = (j % 3) * 316, cy = 60 + Math.floor(j / 3) * 20, mine = Math.floor(j / 2) === page;
    var c = m.on && m.dest !== "none" ? (mine ? C.ink : C.label) : C.faint;
    g.text(cx + 4, cy, String(j + 1), mine ? C.or : C.faint, -1);
    g.text(cx + 18, cy, srcName(m.src), c, -1, 100);
    g.text(cx + 124, cy, ">", C.faint, -1);
    g.text(cx + 136, cy, destName(m.dest), c, -1, 118);
    g.text(cx + 304, cy, m.known ? sgn(m.amt, 2) : "--", m.on ? C.blue : C.faint, 1);
  }
}
push.compartment({
  id: "mod", label: "Modulation",
  pages: [
    { label: "Slots 1-2", keys: MOD_KEYS.slice(0, 8) },
    { label: "Slots 3-4", keys: MOD_KEYS.slice(8, 16) },
    { label: "Slots 5-6", keys: MOD_KEYS.slice(16, 24) }
  ],
  screen: modScreen
});

// ---- SCENE: Surge's scene settings, as knobs -----------------------------------------------------
push.compartment({
  id: "scene", label: "Scene",
  pages: [
    { label: "Output", keys: ["volume", "pan", "pan2", "send_fx_1", "send_fx_2", "send_fx_3", "send_fx_4"] },
    { label: "Play", keys: ["polymode", "octave", "pitch", "portamento", "pbrange_up", "pbrange_dn", "octave_transpose"] },
    { label: "Global", keys: ["preset", "sync_bpm", "bpm", "mpe_enabled", "mpe_pitch_bend_range"] }
  ]
});
