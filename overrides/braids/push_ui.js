// Braids on Push: its two envelopes drawn as envelopes.
// An overlay shipped with Pung (Braids itself ships no push_ui.js).
// The encoders stay where they are: each segment sits over the knob that
// shapes it, and the native layer still writes every value.

function envelope(a, d, s, r) {
  return function (g, v) {
    var w = g.w, h = g.h, top = 8, base = h - 6;
    var fa = v[a].frac, fd = v[d].frac, fs = v[s].frac, fr = v[r].frac;
    // segment widths follow the times; the sustain hold takes what is left
    var span = w - 16;
    var wa = 8 + fa * span * 0.28, wd = 8 + fd * span * 0.28, wr = 8 + fr * span * 0.28;
    var ws = Math.max(18, span - wa - wd - wr);
    var x0 = 8, x1 = x0 + wa, x2 = x1 + wd, x3 = x2 + ws, x4 = x3 + wr;
    var ys = base - fs * (base - top);
    var pts = [[x0, base], [x1, top], [x2, ys], [x3, ys], [x4, base]];
    var keys = [a, d, s, r];

    // area under the curve, as thin vertical strokes (the panel has no alpha)
    for (var x = x0; x < x4; x += 3) {
      var y = base;
      for (var i = 0; i < 4; i++) {
        var p = pts[i], q = pts[i + 1];
        if (x >= p[0] && x <= q[0]) { y = p[1] + (q[1] - p[1]) * ((x - p[0]) / Math.max(1, q[0] - p[0])); }
      }
      g.line(x, base, x, y, 1, "faint");
    }
    g.line(x0, base, x4, base, 1, "line");
    for (var i = 0; i < 4; i++) {
      var on = v.$touched === keys[i];
      g.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], on ? 3 : 1.6, on ? "slot" : "fg");
    }
    for (var i = 1; i < 4; i++) g.dot(pts[i][0], pts[i][1], 3, v.$touched === keys[i] || v.$touched === keys[i - 1] ? "slot" : "fg");
    g.fill(w - 84, 3, 80, 15, "black");
    g.text(w - 8, 14, v[a].name.indexOf("F") === 0 ? "FILTER ENV" : "AMP ENV", "dim", 1);
  };
}

push.widget({ keys: ["attack", "decay", "sustain", "release"], draw: envelope("attack", "decay", "sustain", "release") });
push.widget({ keys: ["f_attack", "f_decay", "f_sustain", "f_release"], draw: envelope("f_attack", "f_decay", "f_sustain", "f_release") });
