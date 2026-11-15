// OB-Xd on Push: the synth drawn as a synth.
// An overlay shipped with Pung (OB-Xd itself ships no push_ui.js).
// Every widget sits over the knobs that shape it, so the hand stays where
// Push puts it; the native layer still writes every value.
//
//   MAIN        the filter's response (cutoff, resonance, env amount),
//               the amp envelope
//   OSC1, OSC2  the waveform the oscillator makes (saw, pulse or both), and
//               its level in the mix; the pitch keeps its own number below
//   OSC COMMON  the pulse width, and how far the envelope moves it
//   FILTER      low-pass to band-pass to high-pass, 12 or 24 dB, key follow
//   FILT ENV    the filter envelope
//   LFO         the shape the LFO makes, moving at its rate

var TAU = Math.PI * 2;

function frac(v, k) { return v[k] ? v[k].frac : 0; }
function hot(v, keys) { for (var i = 0; i < keys.length; i++) if (v.$touched === keys[i]) return true; return false; }

// a curve, and the area under it: one call each (a draw has 8 ms)
function curve(g, pts, width, color) { g.poly(pts, width, color); }
function under(g, pts, base, color) { g.area(pts, base, color); }

function title(g, s) {
  g.fill(g.w - 6 - s.length * 7 - 8, 3, s.length * 7 + 8, 14, "black");
  g.text(g.w - 8, 14, s, "dim", 1);
}

// ---- filter response -----------------------------------------------------------
// |H| of a resonant 2-pole (squared for 4-pole); mode 0 low-pass, 0.5
// band-pass, 1 high-pass, morphing as OB-Xd's multimode does.
function response(f, fc, q, mode, poles) {
  var r = f / fc;
  var den = Math.sqrt((1 - r * r) * (1 - r * r) + (r / q) * (r / q));
  var lp = 1 / den, bp = (r / q) / den, hp = (r * r) / den;
  var m = mode < 0.5 ? lp + (bp - lp) * (mode * 2) : bp + (hp - bp) * ((mode - 0.5) * 2);
  return poles === 4 ? m * m : m;
}

function filterCurve(g, fc01, res01, mode, poles, color, envAmt) {
  var w = g.w, top = 10, base = g.h - 8;
  var fc = Math.pow(2, 4 + fc01 * 10);      // 16 Hz .. 16 kHz
  var q = 0.55 + res01 * res01 * 9;
  var pts = [];
  for (var x = 6; x <= w - 6; x += 3) {
    var f = Math.pow(2, 4 + (x - 6) / (w - 12) * 10.4);
    var db = 20 * Math.log(Math.max(1e-6, response(f, fc, q, mode, poles))) / Math.LN10;
    db = Math.max(-42, Math.min(24, db));
    pts.push([x, top + (24 - db) / 66 * (base - top)]);
  }
  under(g, pts, base, "faint");
  g.line(6, top + 24 / 66 * (base - top), w - 6, top + 24 / 66 * (base - top), 1, "line"); // 0 dB
  curve(g, pts, 2, color);
  var xc = 6 + (Math.log(fc) / Math.LN2 - 4) / 10.4 * (w - 12);
  g.line(xc, base, xc, base - 6, 2, color);
  if (envAmt > 0.01) { // where the envelope takes the cutoff
    var xe = Math.min(w - 8, xc + envAmt * (w - 12) * 0.45);
    g.line(xc, base - 3, xe, base - 3, 1, "mod");
    g.dot(xe, base - 3, 2, "mod");
  }
}

push.widget({
  keys: ["cutoff", "resonance", "filter_env"],
  draw: function (g, v) {
    filterCurve(g, frac(v, "cutoff"), frac(v, "resonance"), 0, 4, hot(v, ["cutoff", "resonance"]) ? "slot" : "fg", frac(v, "filter_env"));
    title(g, "FILTER");
  }
});

push.widget({
  keys: ["key_follow", "multimode", "fourpole"],
  draw: function (g, v) {
    var poles = frac(v, "fourpole") > 0.5 ? 4 : 2;
    var mode = poles === 4 ? 0 : frac(v, "multimode"); // OB-Xd's 24 dB is low-pass only
    filterCurve(g, 0.55, 0.45, mode, poles, hot(v, ["multimode", "fourpole"]) ? "slot" : "fg", 0);
    var name = poles === 4 ? "LP 24 DB" : mode < 0.2 ? "LP 12 DB" : mode < 0.4 ? "LP-BP" : mode < 0.6 ? "BP 12 DB" : mode < 0.8 ? "BP-HP" : "HP 12 DB";
    title(g, name);
    var kf = frac(v, "key_follow"); // the cutoff following the keyboard: a tilt
    g.line(10, g.h - 14, 60, g.h - 14 - kf * 20, 2, v.$touched === "key_follow" ? "slot" : "dim");
    g.text(10, g.h - 2, "KEY", "dim", -1);
  }
});

// ---- envelopes ----------------------------------------------------------------
function envelope(a, d, s, r, name) {
  return function (g, v) {
    var w = g.w, top = 10, base = g.h - 8, span = w - 16;
    var wa = 8 + frac(v, a) * span * 0.28, wd = 8 + frac(v, d) * span * 0.28, wr = 8 + frac(v, r) * span * 0.28;
    var ws = Math.max(18, span - wa - wd - wr);
    var x0 = 8, x1 = x0 + wa, x2 = x1 + wd, x3 = x2 + ws, x4 = x3 + wr;
    var ys = base - frac(v, s) * (base - top);
    var pts = [[x0, base], [x1, top], [x2, ys], [x3, ys], [x4, base]], keys = [a, d, s, r], fill = [];
    for (var x = x0; x < x4; x += 2) {
      var y = base;
      for (var i = 0; i < 4; i++) {
        var p = pts[i], q = pts[i + 1];
        if (x >= p[0] && x <= q[0]) y = p[1] + (q[1] - p[1]) * ((x - p[0]) / Math.max(1, q[0] - p[0]));
      }
      fill.push([x, y]);
    }
    under(g, fill, base, "faint");
    g.line(x0, base, x4, base, 1, "line");
    for (var i = 0; i < 4; i++) {
      var on = v.$touched === keys[i];
      g.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], on ? 3 : 2, on ? "slot" : "fg");
    }
    for (var i = 1; i < 4; i++) g.dot(pts[i][0], pts[i][1], 3, v.$touched === keys[i] || v.$touched === keys[i - 1] ? "slot" : "fg");
    title(g, name);
  };
}
push.widget({ keys: ["attack", "decay", "sustain", "release"], draw: envelope("attack", "decay", "sustain", "release", "AMP ENV") });
push.widget({ keys: ["f_attack", "f_decay", "f_sustain", "f_release"], draw: envelope("f_attack", "f_decay", "f_sustain", "f_release", "FILTER ENV") });

// ---- oscillators ----------------------------------------------------------------
// two periods of saw * level + pulse * level, scaled by the oscillator's mix
function oscillator(n) {
  var saw = "osc" + n + "_saw", pulse = "osc" + n + "_pulse", mix = "osc" + n + "_mix";
  return function (g, v) {
    var w = g.w, mid = g.h / 2 + 4, amp = (g.h / 2 - 14);
    var s = frac(v, saw) > 0.5 ? 1 : frac(v, saw), p = frac(v, pulse) > 0.5 ? 1 : frac(v, pulse);
    var lvl = 0.25 + 0.75 * frac(v, mix), sum = Math.max(1, s + p);
    var pts = [], period = (w - 24) / 2;
    for (var x = 12; x <= w - 12; x += 2) {
      var ph = ((x - 12) % period) / period;
      var y = (s * (1 - 2 * ph) + p * (ph < 0.5 ? 1 : -1)) / sum;
      pts.push([x, mid - y * amp * lvl]);
    }
    g.line(12, mid, w - 12, mid, 1, "line");
    if (s + p === 0) {
      g.text(w / 2, mid + 4, "OSC " + n + " OFF", "dim", 0);
    } else {
      curve(g, pts, 2, hot(v, [saw, pulse, mix]) ? "slot" : "fg");
    }
    title(g, "OSC " + n);
    g.fill(w - 8, g.h - 8 - lvl * (g.h - 32), 4, lvl * (g.h - 32), v.$touched === mix ? "slot" : "dim"); // its level in the mix
  };
}
push.widget({ keys: ["osc1_saw", "osc1_pulse", "osc1_pitch", "osc1_mix"], draw: oscillator(1) });
push.widget({ keys: ["osc2_saw", "osc2_pulse", "osc2_pitch", "osc2_mix"], draw: oscillator(2) });

// ---- pulse width ----------------------------------------------------------------
push.widget({
  keys: ["pw", "pw_env"],
  draw: function (g, v) {
    var w = g.w, top = 22, base = g.h - 10, period = (w - 24) / 2;
    var duty = 0.5 - 0.45 * frac(v, "pw"), env = Math.min(0.48, duty + 0.45 * frac(v, "pw_env"));
    function wave(d, width, color) {
      for (var k = 0; k < 2; k++) {
        var x0 = 12 + k * period, xh = x0 + d * period, x1 = x0 + period;
        g.line(x0, base, x0, top, width, color); g.line(x0, top, xh, top, width, color);
        g.line(xh, top, xh, base, width, color); g.line(xh, base, x1, base, width, color);
      }
    }
    if (frac(v, "pw_env") > 0.01) wave(env, 1, "mod");
    wave(duty, 2, hot(v, ["pw"]) ? "slot" : "fg");
    title(g, "PULSE " + Math.round(duty * 100) + "%");
  }
});

// ---- LFO ------------------------------------------------------------------------
push.widget({
  keys: ["lfo_rate", "lfo_sin", "lfo_square", "lfo_sh"],
  draw: function (g, v, t) {
    var w = g.w, mid = g.h / 2 + 4, amp = g.h / 2 - 14;
    var a = frac(v, "lfo_sin") > 0.5 ? 1 : 0, b = frac(v, "lfo_square") > 0.5 ? 1 : 0, c = frac(v, "lfo_sh") > 0.5 ? 1 : 0;
    var n = a + b + c, hz = 0.05 + frac(v, "lfo_rate") * frac(v, "lfo_rate") * 20;
    var cycles = 2.5, shift = (t * hz) % 1, pts = [];
    for (var x = 12; x <= w - 12; x += 2) {
      var ph = ((x - 12) / (w - 24)) * cycles + shift, f = ph - Math.floor(ph), y = 0;
      if (a) y += Math.sin(f * TAU);
      if (b) y += f < 0.5 ? 1 : -1;
      if (c) { var k = Math.floor(ph * 4); y += ((k * 9301 + 49297) % 233280) / 116640 - 1; }
      pts.push([x, mid - (n ? y / n : 0) * amp]);
    }
    g.line(12, mid, w - 12, mid, 1, "line");
    if (n) curve(g, pts, 2, hot(v, ["lfo_rate", "lfo_sin", "lfo_square", "lfo_sh"]) ? "slot" : "fg");
    else g.text(w / 2, mid + 4, "NO WAVE CHOSEN", "dim", 0);
    title(g, "LFO " + (hz < 1 ? hz.toFixed(2) : hz.toFixed(1)) + " HZ");
  }
});
