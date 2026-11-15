// Hera (Juno-60) on Push. An overlay shipped with Pung (Hera ships no push_ui.js).
//
//   DCO   the wave the oscillator puts out: saw, pulse, the sub oscillator
//         an octave down and noise, summed at their levels, over the four
//         level knobs; beside it the pulse width and, when the LFO or the
//         envelope moves it, how far. The touched source is drawn on its own
//         behind the sum. Knobs side by side cannot show the sum.
//   VCF   Pung's filter response, and where the envelope takes the cutoff
//         (Hera's VCF Env is bipolar: it can close the filter, too).
//
// Hera's own help: PWM Mod 0 = Manual, 1 = LFO, 2 = Envelope; the pulse is
// square with no PWM depth.

function fr(v, k, d) { return v[k] && v[k].known ? v[k].frac : d; }
function known(v, keys) { for (var i = 0; i < keys.length; i++) if (!v[keys[i]] || !v[keys[i]].known) return false; return true; }

var LEVELS = ["saw_level", "pulse_level", "sub_level", "noise_level"];
var PWM_SRC = ["MAN", "LFO", "ENV"];

// the pulse is high for this part of a cycle: square (0.5) with no depth,
// narrow (0.05) at full
function width(depth) { return 0.5 - 0.45 * depth; }

function noise(i) { var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

// one source at phase ph (in cycles of the main oscillator), -1..1
function part(src, ph, pw) {
  var t = ph - Math.floor(ph);
  switch (src) {
    case 0: return 2 * t - 1;                                  // saw
    case 1: return t < pw ? 1 : -1;                            // pulse
    case 2: var s = ph / 2; return s - Math.floor(s) < 0.5 ? 1 : -1; // sub: square, an octave down
  }
  return 0;
}

push.widget({
  keys: ["saw_level", "pulse_level", "sub_level", "noise_level", "pwm_depth", "pwm_mod"],
  draw: function (g, v) {
    var ok = known(v, LEVELS.concat(["pwm_depth", "pwm_mod"]));
    var lv = [], i;
    for (i = 0; i < 4; i++) lv.push(ok ? fr(v, LEVELS[i], 0) : [0.8, 0.5, 0.4, 0][i]);
    var depth = fr(v, "pwm_depth", 0), src = Math.round(fr(v, "pwm_mod", 0) * 2);
    // a moving width is drawn at the middle of where it goes
    var pw = src === 0 ? width(depth) : width(depth / 2);
    var touched = LEVELS.indexOf(v.$touched || "");

    // ---- the sum, over the four level knobs (columns 0 to 3) ----
    var x0 = 4, x1 = 4 * 120 - 12, top = 10, base = g.h - 10, mid = (top + base) / 2;
    // the pitched sources summed; the noise as a band around them (drawn
    // into the curve it would hide the wave it rides on)
    var n = 240, pts = [], peak = 0, raw = [];
    for (i = 0; i <= n; i++) {
      var ph = 2 * Math.min(i / n, 0.9999), s = 0;
      for (var k = 0; k < 3; k++) s += lv[k] * part(k, ph, pw);
      raw.push(s);
      peak = Math.max(peak, Math.abs(s) + lv[3]);
    }
    g.line(x0, mid, x1, mid, 1, "line");
    if (peak < 1e-3) {
      g.text((x0 + x1) / 2, mid - 6, "NO SOURCE UP", "dim", 0);
    } else {
      var amp = (base - top) / 2 / peak;
      if (lv[3] > 0) {
        var up = [], nc = touched === 3 ? "slot" : ok ? "#4a4a44" : "#2a2a28";
        for (i = 0; i <= n; i++) up.push([x0 + (x1 - x0) * i / n, mid - (raw[i] + lv[3] * (0.55 + 0.45 * Math.abs(noise(i)))) * amp]);
        var down = [];
        for (i = 0; i <= n; i++) down.push([x0 + (x1 - x0) * i / n, mid - (raw[i] - lv[3] * (0.55 + 0.45 * Math.abs(noise(i + 999)))) * amp]);
        for (i = 1; i <= n; i++) g.fill(up[i][0], up[i][1], (x1 - x0) / n + 1, down[i][1] - up[i][1], nc);
      }
      if (touched >= 0 && touched < 3 && lv[touched] > 0) { // the source under the finger, alone
        var one = [];
        for (i = 0; i <= n; i++) one.push([x0 + (x1 - x0) * i / n, mid - lv[touched] * part(touched, 2 * Math.min(i / n, 0.9999), pw) * amp]);
        g.poly(one, 2, "slot");
      }
      for (i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n, mid - raw[i] * amp]);
      if (!(lv[3] > 0)) g.area(pts, mid, ok ? "#3d2414" : "#24262b");
      g.poly(pts, 2, ok ? "fg" : "dim");
    }

    // ---- the pulse width, over PWM depth and its source (columns 4 and 5) ----
    var px0 = 4 * 120 + 8, px1 = g.w - 8, hi = top + 8, lo = base - 4;
    var hot = v.$touched === "pwm_depth" || v.$touched === "pwm_mod" || v.$touched === "pulse_level";
    var col = !ok ? "dim" : hot ? "slot" : "fg";
    var cw = px1 - px0;
    if (src !== 0 && depth > 0) { // where the moving edge goes
      g.fill(px0 + cw * width(depth), hi, cw * (0.5 - width(depth)), lo - hi, "#2a2a3a");
      g.text(px0 + cw * 0.5 + 4, hi + 12, PWM_SRC[src], "mod", -1);
    }
    var e = px0 + cw * pw;
    g.poly([[px0, lo], [px0, hi], [e, hi], [e, lo], [px1, lo], [px1, hi]], 2, col);
    g.text(px1, top, src === 0 ? "PW " + Math.round(pw * 100) + "%" : "PW MOVES", "dim", 1);
  }
});

// the filter, and where the envelope takes the cutoff
push.widget({
  keys: ["vcf_cutoff", "vcf_resonance", "vcf_env"],
  draw: function (g, v) {
    g.filter(0, 0, g.w, g.h, { cutoff: "vcf_cutoff", resonance: "vcf_resonance" });
    if (!known(v, ["vcf_cutoff", "vcf_env"])) return;
    var x0 = 6, x1 = g.w - 6, base = g.h - 6;
    var c = fr(v, "vcf_cutoff", 0), env = fr(v, "vcf_env", 0.5) * 2 - 1; // -1..1
    if (Math.abs(env) < 0.02) return;
    var xc = x0 + (x1 - x0) * c;
    var xe = x0 + (x1 - x0) * Math.max(0, Math.min(1, c + env * 0.5));
    var y = base - 4, col = v.$touched === "vcf_env" ? "slot" : "mod";
    g.line(xc, y, xe, y, 2, col);
    g.poly([[xe + (env > 0 ? -6 : 6), y - 4], [xe, y], [xe + (env > 0 ? -6 : 6), y + 4]], 2, col);
    g.text(xe + (env > 0 ? -8 : 8), y - 8, "ENV", col, env > 0 ? 1 : -1);
  }
});
