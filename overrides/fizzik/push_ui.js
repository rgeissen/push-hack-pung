// Fizzik (a polyphonic simplex physical-modelling synth) on Push.
//
// Fizzik makes sound the way objects do: a short burst (noise, a mallet's
// single cycle, crackle) strikes two resonators, each a string, a beam, a
// plate or a membrane; a spring between them (Couple) feeds each one's
// motion into the other. The screens are drawn as a physics notebook draws
// such a system: graph paper, the bodies in section with their supports,
// the strike and the pickup marked on them, the modes they ring in, and the
// partials those modes put out, A above its line and B below, on one axis,
// so where the two agree (where Fizzik sings) can be seen.
//
// Everything a picture shows is computed from the module's own DSP
// (fizzik.c): the modal frequencies and weights (Beam, Plate, Membrane, as
// modal_recompute builds them), the string's partials through its
// dispersion allpasses and loop filter (wg_set), the ring times, the exact
// times and ranges of every knob (map_exp), the LFO targets' reach, the
// aftertouch curve. Envelopes, filters and LFOs are Pung's own pictures.
//
//   PANEL        the front panel: the burst, A and B side by side with the
//                spring between, each one's share of the output (Balance),
//                the global filter and the amp envelope (Pung's, live)
//   EXCITER      the burst as a signal, its colour filter, its AD envelope,
//                what velocity does to it
//   RESONATORS   one page each for A and B: the body (shape, stiffness or
//                aspect, strike and pickup), its first modes, the partials
//                of both against one axis, the ring time
//   VOICE        the coupled pair and the balance, glide, the amp envelope,
//                the stereo spread of the voices, the drive's curve, level
//   FX           the reverb's comb echoes and the ping-pong delay's taps, in
//                time; the stereo width
//   FX 2         default (EQ, chorus, glue, limiter)
//   MOD          both LFOs (Pung's), each with what it moves and how far
//   AFTERTOUCH   what full pressure does, in the engine's units; the curve
//   MPE          default

var REF = 261.626, SR = 44100;

// ---- palette: a physics notebook at night ---------------------------------------------
var GROUND = "#09141f", GRID = "#0f1f2e", GRID2 = "#13283b", RULE = "#24405c";
var INK = "#e9eef4", INK2 = "#93a9c0", INK3 = "#4d6781", INK4 = "#2c4258";
var ACOL = "#ffc94a", BCOL = "#ff86aa", SCOPE = "#7ee0a8"; // A, B, and what is measured
var MODELS = ["String", "Beam", "Plate", "Membrane"];

function known(v, k) { return !!(v[k] && v[k].known); }
function fr(v, k, d) { return known(v, k) ? v[k].frac : (d === undefined ? 0 : d); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function mexp(x, lo, hi) { return lo * Math.pow(hi / lo, clamp(x, 0, 1)); }
function hot(v, k) { return v.$touched === k; }
function hotAny(v, ks) { for (var i = 0; i < ks.length; i++) if (v.$touched === ks[i]) return true; return false; }
function modelOf(v, k) {
  if (!known(v, k)) return -1;
  var s = String(v[k].value), i = MODELS.indexOf(s);
  if (i >= 0) return i;
  var n = parseInt(s, 10);
  return isNaN(n) ? Math.round(v[k].frac * 3) : clamp(n, 0, 3);
}

// colours mixed toward another, kept (the panel has no alpha)
var MIXED = {};
function mix(a, b, t) {
  var key = a + b + t.toFixed(2);
  if (MIXED[key]) return MIXED[key];
  function ch(c, i) { return parseInt(c.substr(1 + i * 2, 2), 16); }
  var s = "#";
  for (var i = 0; i < 3; i++) {
    var x = Math.round(ch(a, i) * (1 - t) + ch(b, i) * t);
    s += (x < 16 ? "0" : "") + x.toString(16);
  }
  return (MIXED[key] = s);
}

var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 160) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

// ---- values in the engine's own units (fizzik.c: render_block's map_exp) -----------------
function msU(ms) {
  if (ms >= 1000) return [(ms / 1000).toFixed(ms >= 10000 ? 1 : 2), "S"];
  return [ms < 10 ? ms.toFixed(1) : String(Math.round(ms)), "MS"];
}
function hzU(hz) {
  if (hz >= 1000) return [(hz / 1000).toFixed(hz >= 10000 ? 1 : 2), "KHZ"];
  return [hz < 1 ? hz.toFixed(2) : (hz < 10 ? hz.toFixed(1) : String(Math.round(hz))), "HZ"];
}
function pct(x) { return [String(Math.round(x * 100)), "%"]; }
function st(n) { return [(n > 0 ? "+" : "") + n, "ST"]; }
var UNITS = {
  exc_attack: function (x) { return msU(mexp(x, 0.2, 40)); },
  exc_decay: function (x) { return msU(mexp(x, 2, 400)); },
  amp_attack: function (x) { return msU(mexp(x, 0.5, 200)); },
  amp_release: function (x) { return msU(mexp(x, 20, 3000)); },
  glide: function (x) { return x < 0.001 ? ["OFF", ""] : msU(mexp(x + 1e-4, 1, 500)); },
  cutoff: function (x) { return hzU(mexp(x, 30, 18000)); },
  exc_color: function (x) { return hzU(mexp(x, 300, 16000)); },
  dly_time: function (x) { return msU(mexp(x, 30, 700)); },
  dly_tone: function (x) { return hzU(mexp(x, 800, 12000)); },
  dly_fb: function (x) { return pct(x * 0.85); },
  lfo1_rate: function (x) { return hzU(mexp(x + 1e-4, 0.05, 20)); },
  lfo2_rate: function (x) { return hzU(mexp(x + 1e-4, 0.05, 20)); },
  cho_rate: function (x) { return hzU(mexp(x + 1e-4, 0.05, 6)); },
  at_vrate: function (x) { return hzU(mexp(x + 1e-4, 3, 9)); },
  lim_ceil: function (x) { return [(20 * Math.log(0.5 + 0.49 * x) / Math.LN10).toFixed(1), "DB"]; },
  level: function (x) { return x < 0.005 ? ["OFF", ""] : [(40 * Math.log(x) / Math.LN10).toFixed(1), "DB"]; },
  balance: function (x) {
    if (x < 0.495) return ["A " + Math.round((1 - x) * 100), "%"];
    if (x > 0.505) return ["B " + Math.round(x * 100), "%"];
    return ["EVEN", ""];
  },
  mpe_smooth: function (x) { return msU(1 + 59 * x); }
};
var INTS = { a_tune: 1, b_tune: 1, mpe_bend: 1, mpe_mbend: 1 };
var ENUMS = { preset: 31, a_model: 4, b_model: 4, ftype: 4, voicing: 12, lfo1_shape: 5, lfo1_target: 8, lfo2_shape: 5,
  lfo2_target: 8, at_preset: 10, mpe: 2, mpe_zone: 2, mpe_cc74_tgt: 4 };
var TRIGGERS = { rnd_patch: 1, rnd_exc: 1, rnd_reson: 1 };
function shown(v, k) {
  if (!known(v, k)) return ["--", ""];
  if (UNITS[k]) return UNITS[k](num(v, k, 0));
  if (INTS[k]) return st(Math.round(num(v, k, 0)));
  if (ENUMS[k] || TRIGGERS[k]) return [txt(v, k), ""];
  return pct(num(v, k, 0));
}

// Pung writes the module's values this way everywhere (its own pages, the row
// under a band screen): the module answers bare 0..1 numbers.
var LOWER = { MS: "ms", S: "s", HZ: "Hz", KHZ: "kHz", DB: "dB", ST: "st", "%": "%" };
push.display(function (key, raw) {
  if (ENUMS[key] || TRIGGERS[key] || key === "preset") return null;
  var x = parseFloat(raw);
  if (isNaN(x)) return null;
  var u = UNITS[key] ? UNITS[key](x) : (INTS[key] ? (key.indexOf("tune") > 0 ? st(Math.round(x)) : [String(Math.round(x)), "st"]) : pct(x));
  return { value: u[0], unit: LOWER[u[1]] !== undefined ? LOWER[u[1]] : u[1] };
});

// ---- the physics: what A and B ring at (fizzik.c) -------------------------------------
// One mode: r its frequency over the played note's, a its weight as the engine
// sets it, t60 its ring time (s) at middle C, m and n its numbers.
function zeta(d) { return 0.1 * Math.pow(10, -clamp(d, 0, 1) * 5); }
function modalModes(model, s, dec, dmp, pos) {
  var cand = [], nyq = SR * 0.49 / REF;
  if (model === 1) { // Beam: f_n = f0 n sqrt((1-b) + b n^2), struck at 0.15, heard at pos
    var b = clamp(s, 0, 1), out = clamp(0.1 + 0.85 * pos, 0.02, 0.98);
    for (var n = 1; n <= 256; n++) {
      var f = n * Math.sqrt((1 - b) + b * n * n);
      cand.push({ r: f, a: 2 * Math.sin(n * Math.PI * 0.15) * Math.sin(n * Math.PI * out), m: n, n: 0 });
      if (f > nyq) break;
    }
  } else { // Plate (Kirchhoff) and Membrane (2-D wave): rectangular modes, aspect 1..5
    var asp = 1 + 4 * clamp(s, 0, 1), outX = clamp(0.1 + 0.85 * pos, 0.02, 0.98), outY = 0.55;
    var kmax = Math.ceil(Math.sqrt(24)) + 3, nmax = Math.ceil(kmax * asp) + 2;
    var dpl = 1 + 1 / (asp * asp), dme = Math.sqrt(dpl);
    for (var mm = 1; mm <= kmax && cand.length < 256; mm++) {
      for (var nn = 1; nn <= nmax && cand.length < 256; nn++) {
        var fn = nn / asp, q = mm * mm + fn * fn;
        var r = model === 2 ? q / dpl : Math.sqrt(q) / dme;
        var phi = (2 * Math.sin(mm * Math.PI * 0.15) * Math.sin(nn * Math.PI * 0.15)) *
          (2 * Math.sin(mm * Math.PI * outX) * Math.sin(nn * Math.PI * outY));
        cand.push({ r: r, a: phi, m: mm, n: nn });
      }
    }
  }
  cand.sort(function (x, y) { return x.r - y.r; });
  var z0 = zeta(dec), z1 = zeta(1 - dmp) * 0.5, outp = [];
  for (var i = 0; i < cand.length && outp.length < 24; i++) {
    var c = cand[i];
    if (c.r * REF < 20 || c.r > nyq) continue;
    var z = clamp(z0 + z1 * (c.r - 1), 2.5e-4, 0.99);
    var gc = clamp(Math.sqrt(0.02 / z), 0.5, 16);
    outp.push({ r: c.r, a: Math.abs(c.a) * gc, t60: 6.91 / (z * 2 * Math.PI * c.r * REF), m: c.m, n: c.n });
  }
  return outp;
}
// The string: one loop of delay, a one-pole lowpass (Tone, less with Damp) and
// four dispersion allpasses (Structure); a partial is where the loop's phase
// lag is a whole number of turns. Heard through the pickup comb at Position.
function stringModes(s, dec, dmp, pos, tone) {
  var ap = -0.85 * clamp(s, 0, 1), rt = SR / REF, w0 = 2 * Math.PI * REF / SR;
  var rr = 0.6 * rt / 4, acap = Math.min(0, (1 - rr) / (1 + rr));
  if (ap < acap) ap = acap;
  var gd = (1 - ap * ap) / (1 + 2 * ap * Math.cos(w0) + ap * ap);
  var len = Math.max(8, rt - 4 * gd - 1);
  var cut = clamp(mexp(tone, 500, 15000) * (1 - 0.75 * clamp(dmp, 0, 1)), 80, SR * 0.45);
  var lpc = 1 - Math.exp(-2 * Math.PI * cut / SR), fb = 0.95 + 0.0495 * clamp(dec, 0, 1);
  var p = clamp(0.02 + 0.9 * pos, 0.02, 0.98);
  function lag(w) {
    var c = Math.cos(w), sn = Math.sin(w);
    var apl = -(Math.atan2(-sn, ap + c) - Math.atan2(-ap * sn, 1 + ap * c));
    var lpl = Math.atan2((1 - lpc) * sn, 1 - (1 - lpc) * c);
    return w * (len + 1) + 4 * apl + lpl;
  }
  // the lag rises steadily with frequency: a secant step or three from the
  // harmonic finds each partial
  var out = [], f1 = 0, top = lag(Math.PI * 0.98), w = 0;
  for (var n = 1; n <= 24; n++) {
    var target = 2 * Math.PI * n;
    if (top < target) break;
    var wa = n === 1 ? target / (len + 1 + 4 * gd) : w * n / (n - 1), la = lag(wa);
    var wb = wa * 1.02, lb = lag(wb);
    for (var it = 0; it < 4 && Math.abs(lb - target) > 1e-4; it++) {
      var wn = wb + (target - lb) * (wb - wa) / ((lb - la) || 1e-9);
      wa = wb; la = lb; wb = clamp(wn, 1e-4, Math.PI * 0.98); lb = lag(wb);
    }
    w = wb;
    var c = Math.cos(w), mag = lpc / Math.sqrt(1 - 2 * (1 - lpc) * c + (1 - lpc) * (1 - lpc));
    var g = fb * mag;
    if (n === 1) f1 = w;
    out.push({ r: w / f1, a: Math.abs(2 * Math.sin(Math.PI * n * p)), t60: (-3 / (Math.log(g) / Math.LN10)) / REF, m: n, n: 0 });
  }
  return out;
}
function modesOf(v, pre) {
  var model = modelOf(v, pre + "model");
  if (model < 0) return null;
  var s = num(v, pre + "struct", 0), dec = num(v, pre + "decay", 0.5), dmp = num(v, pre + "damp", 0.5);
  var pos = num(v, pre + "pos", 0.2), tone = num(v, pre + "tone", 0.5);
  var key = [model, s.toFixed(2), dec.toFixed(2), dmp.toFixed(2), pos.toFixed(2), model === 0 ? tone.toFixed(2) : ""].join("|");
  return cached("modes|" + key, function () {
    var ms = model === 0 ? stringModes(s, dec, dmp, pos, tone) : modalModes(model, s, dec, dmp, pos);
    var amax = 0, tmax = 0;
    for (var i = 0; i < ms.length; i++) { amax = Math.max(amax, ms[i].a); tmax = Math.max(tmax, ms[i].t60); }
    for (var j = 0; j < ms.length; j++) {
      ms[j].h = amax > 0 ? ms[j].a / amax : 0;
      // how long it rings beside the longest, on a log scale: 1 rings, 0 dies at once
      ms[j].ring = tmax > 0 ? clamp(1 + Math.log(ms[j].t60 / tmax) / Math.log(40), 0, 1) : 0;
    }
    return { model: model, list: ms, t60: ms.length ? ms[0].t60 : 0 };
  });
}
function t60Text(t) { return t >= 10 ? Math.round(t) + " S" : (t >= 1 ? t.toFixed(1) + " S" : Math.round(t * 1000) + " MS"); }
function structWord(model, s) {
  if (model === 0) return "STIFF " + Math.round(s * 100) + "%";
  if (model === 1) return "BEAM " + Math.round(s * 100) + "%";
  return "1 : " + (1 + 4 * s).toFixed(1);
}

// ---- the bodies, as a mechanics text draws them ------------------------------------------
function tri(g, x, y, s, c) { g.area([[x - s, y + s * 1.4], [x, y], [x + s, y + s * 1.4]], y + s * 1.4, c); }
function hatch(g, x0, y0, x1, y1, step, c) { // diagonal section hatching inside a box
  var w = x1 - x0, h = y1 - y0;
  for (var d = step; d < w + h; d += step) {
    var ax = x0 + Math.min(d, w), ay = y0 + Math.max(0, d - w);
    var bx = x0 + Math.max(0, d - h), by = y0 + Math.min(d, h);
    g.line(ax, ay, bx, by, 1, c);
  }
}
function box(g, x, y, w, h, wd, c) {
  g.line(x, y, x + w, y, wd, c); g.line(x, y + h, x + w, y + h, wd, c);
  g.line(x, y, x, y + h, wd, c); g.line(x + w, y, x + w, y + h, wd, c);
}
function mallet(g, x, y, c) { // a mallet coming down on (x, y)
  g.line(x, y - 4, x, y - 13, 1.5, c);
  g.dot(x, y - 4, 3, c);
}
function pickup(g, x, y, c) { // a pickup's ring
  g.dot(x, y, 3.2, c); g.dot(x, y, 1.6, GROUND);
}
// the plate's or membrane's outline at its aspect, fitted in w x h
function rectFit(x, y, w, h, s) {
  var asp = 1 + 4 * clamp(s, 0, 1), rh = h, rw = h * asp;
  if (rw > w) { rw = w; rh = w / asp; }
  return { x: x + (w - rw) / 2, y: y + (h - rh) / 2, w: rw, h: rh };
}
// model, its structure and position: the body in x..x+w, y..y+h
function body(g, x, y, w, h, model, s, pos, col, big) {
  var mid = y + h / 2, lw = big ? 2 : 1.5;
  if (model === 0) { // String: two bridges, displaced as a pluck at Position
    var p = clamp(0.02 + 0.9 * pos, 0.02, 0.98), x0 = x + 5, x1 = x + w - 5, ax = x0 + (x1 - x0) * p;
    var by = mid + h * 0.12, amp = h * 0.36;
    g.line(x0, by, x1, by, 1, INK4);
    tri(g, x0, by, big ? 5 : 3.5, INK2); tri(g, x1, by, big ? 5 : 3.5, INK2);
    g.poly([x0, by, ax, by - amp, x1, by], lw + 1.6 * clamp(s, 0, 1) * (big ? 1.5 : 1), col);
    pickup(g, ax, by - amp - (big ? 7 : 5), col);
    return { sx: ax, sy: by - amp, px: ax, py: by - amp, l: x0, r: x1, y: by };
  }
  if (model === 1) { // Beam: a bar on two supports, bent in its first mode; Structure thickens it
    var b0 = x + 6, b1 = x + w - 6, th = 2 + (big ? 9 : 5) * clamp(s, 0, 1), ba = h * 0.16, cy = mid + h * 0.05;
    var top = [], bot = [];
    for (var i = 0; i <= 24; i++) {
      var u = i / 24, xx = b0 + (b1 - b0) * u, yy = cy - ba * Math.sin(Math.PI * u);
      top.push(xx, yy - th / 2); bot.push(xx, yy + th / 2);
    }
    if (th > 4) { var ar = []; for (var j = 0; j < top.length; j += 2) ar.push([top[j], top[j + 1]]); g.area(ar, cy + th / 2 + 1, mix(col, GROUND, 0.7)); }
    g.poly(top, lw, col); g.poly(bot, lw, col);
    g.line(b0, top[1], b0, bot[1], lw, col); g.line(b1, top[top.length - 1], b1, bot[bot.length - 1], lw, col);
    tri(g, b0, cy + th / 2 + 1, big ? 5 : 3.5, INK2); tri(g, b1, cy + th / 2 + 1, big ? 5 : 3.5, INK2);
    var su = 0.15, pu = clamp(0.1 + 0.85 * pos, 0.02, 0.98);
    var sx = b0 + (b1 - b0) * su, sy = cy - ba * Math.sin(Math.PI * su) - th / 2;
    var px = b0 + (b1 - b0) * pu, py = cy - ba * Math.sin(Math.PI * pu) + th / 2;
    mallet(g, sx, sy - 1, INK);
    pickup(g, px, py + 5, col);
    return { sx: sx, sy: sy, px: px, py: py, l: b0, r: b1, y: cy };
  }
  // Plate: a sheet in section (hatched); Membrane: a skin on a rim with its lugs
  var r = rectFit(x + 2, y + (big ? 2 : 1), w - 4, h - (big ? 4 : 2), s);
  if (model === 2) {
    g.fill(r.x, r.y, r.w, r.h, mix(col, GROUND, 0.8));
    hatch(g, r.x, r.y, r.x + r.w, r.y + r.h, big ? 7 : 6, mix(col, GROUND, 0.55));
    box(g, r.x, r.y, r.w, r.h, lw, col);
  } else {
    g.fill(r.x, r.y, r.w, r.h, mix(col, GROUND, 0.86));
    box(g, r.x, r.y, r.w, r.h, lw, col);
    box(g, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 1, mix(col, GROUND, 0.5));
    var lug = big ? 12 : 10;
    for (var lx = r.x + lug / 2; lx < r.x + r.w; lx += lug) { g.fill(lx - 1, r.y - 1, 2, 3, col); g.fill(lx - 1, r.y + r.h - 2, 2, 3, col); }
  }
  // struck at (0.15, 0.15), heard at (0.55 along, 0.1 + 0.85 pos across)
  var ox = r.x + r.w * 0.15, oy = r.y + r.h * 0.15;
  var qx = r.x + r.w * 0.55, qy = r.y + r.h * clamp(0.1 + 0.85 * pos, 0.02, 0.98);
  mallet(g, ox, oy + 2, INK);
  pickup(g, qx, qy, col);
  return { sx: ox, sy: oy, px: qx, py: qy, l: r.x, r: r.x + r.w, y: r.y + r.h / 2 };
}

// the partials on a log axis, x1/4 to x32 of the played note, a line each:
// as tall as the engine weights it, as bright as it rings
var LO = Math.log(0.25), SPAN = Math.log(32) - Math.log(0.25);
function axisX(x, w, r) { return x + (Math.log(r) - LO) / SPAN * w; }
function partials(g, x, w, base, h, md, tune, col, dir, faint, lw) {
  if (!md) return;
  var k = Math.pow(2, tune / 12), list = md.list;
  for (var i = 0; i < list.length; i++) {
    var p = list[i], r = p.r * k;
    if (r < 0.25 || r > 32 || p.h < 0.02) continue;
    var xx = axisX(x, w, r), hh = Math.max(2, h * p.h);
    var c = faint ? mix(col, GROUND, 0.45 + 0.3 * (1 - p.ring)) : mix(col, GROUND, 0.62 * (1 - p.ring));
    g.line(xx, base, xx, base - dir * hh, lw || 2, c);
  }
}
function octaves(g, x, w, y0, y1, labels, ly) {
  for (var o = -2; o <= 5; o++) {
    var xx = axisX(x, w, Math.pow(2, o));
    g.fill(Math.round(xx), y0, 1, y1 - y0, o === 0 ? INK3 : GRID2);
    if (labels) g.text(xx, ly, o < 0 ? "1/" + Math.pow(2, -o) : String(Math.pow(2, o)), o === 0 ? INK2 : INK3, 0);
  }
}
// a spring of n coils from (x, y0) down to (x, y1)
function spring(g, x, y0, y1, w, k, c, lw) {
  var pts = [x, y0], n = 7, step = (y1 - y0 - 6) / n;
  pts.push(x, y0 + 3);
  for (var i = 0; i < n; i++) pts.push(x + (i % 2 ? -w : w), y0 + 3 + step * (i + 0.5));
  pts.push(x, y1 - 3, x, y1);
  g.poly(pts, lw, c);
}

// ---- the exciter's burst, as a signal ------------------------------------------------------
// noise and the mallet's one cycle (at middle C), the crackle's clicks, through
// the colour lowpass, shaped by the burst's attack and decay
function burstPts(x, y, w, h, mixv, crk, col, atk, dec) {
  var N = Math.max(24, Math.floor(w / 2)), T = atk + dec, mid = y + h / 2, a = h / 2 - 1;
  var fc = mexp(col, 300, 16000), dt = T / N / 1000, lp = 1 - Math.exp(-2 * Math.PI * fc * dt);
  var norm = 1 / Math.sqrt(lp / (2 - lp)) * 0.55, ny = 0, pts = [];
  var clicks = Math.min(24, Math.round(crk * 0.03 * SR * T / 1000)), at = {};
  for (var c = 0; c < clicks; c++) at[Math.floor((rnd(c * 7 + 3) * 0.5 + 0.5) * N)] = rnd(c * 13 + 1) > 0 ? 1 : -1;
  for (var i = 0; i <= N; i++) {
    var t = i / N * T, env = t < atk ? t / atk : Math.max(0, 1 - (t - atk) / dec);
    ny += lp * (rnd(i + 11) - ny);
    var mal = t < 1000 / REF ? Math.sin(2 * Math.PI * t * REF / 1000) : 0;
    var sgl = ((1 - mixv) * clamp(ny * norm, -1, 1) + mixv * mal) * env;
    if (at[i] !== undefined) sgl += at[i] * 0.9 * Math.max(env, 0.25);
    pts.push(x + w * i / N, mid - clamp(sgl, -1, 1) * a);
  }
  return pts;
}
function burst(g, v, x, y, w, h, color) {
  var m = num(v, "exc_mix", 0.5), c = num(v, "exc_crackle", 0), cl = num(v, "exc_color", 0.5);
  var atk = mexp(num(v, "exc_attack", 0.1), 0.2, 40), dec = mexp(num(v, "exc_decay", 0.5), 2, 400);
  var key = ["b", x, y, w, h, m.toFixed(2), c.toFixed(2), cl.toFixed(2), atk.toFixed(1), dec.toFixed(1)].join("|");
  g.line(x, y + h / 2, x + w, y + h / 2, 1, INK4);
  if (!known(v, "exc_mix") || !known(v, "exc_decay")) return 0; // nothing read yet: the bare axis
  g.poly(cached(key, function () { return burstPts(x, y, w, h, m, c, cl, atk, dec); }), 1.5, color);
  return atk + dec;
}

// ---- the engine's envelope times ----------------------------------------------------------
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null) return null;
    switch (s.key) {
    case "exc_attack": return mexp(s.raw, 0.2, 40) / 1000;
    case "exc_decay": return mexp(s.raw, 2, 400) / 1000;
    case "amp_attack": return mexp(s.raw, 0.5, 200) / 1000;
    case "amp_release": return mexp(s.raw, 20, 3000) * 6.9 / 1000; // exponential: to -60 dB
    }
    return null;
  });
});

// ---- the encoder row: panel meters --------------------------------------------------------
// Each encoder is a laboratory panel meter: a scale, a needle, the reading in
// the engine's own unit above its number. Choices are a selector's positions;
// the randomizers a push button.
var ROW = 104;
// In segment mode Pung names the segments in the bottom 18 pixels: the meters
// shrink and the row ends above them.
function meterGeo(seg) { return seg ? { cy: 138, r: 15, ny: ROW + 11, uy: ROW + 21, vy: ROW + 34, by: ROW + 16 } : { cy: 152, r: 21, ny: ROW + 14, uy: ROW + 29, vy: ROW + 47, by: ROW + 22 }; }
function meterGround(g, kn, seg) {
  var M = meterGeo(seg);
  g.fill(0, ROW, 960, 56, GROUND);
  g.fill(0, ROW, 960, 1, RULE);
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, ROW + 6, 1, seg ? 30 : 44, INK4);
    var k = kn[c];
    if (!k || ENUMS[k] || TRIGGERS[k]) continue;
    var cx = c * 120 + 32, cy = M.cy, r = M.r;
    g.arc(cx, cy, r, Math.PI, Math.PI, 1, INK3);
    for (var i = 0; i <= 4; i++) {
      var a = Math.PI + i * Math.PI / 4, r1 = r + 2, r2 = r + (i % 2 ? 4 : 6);
      g.line(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, 1, i % 2 ? INK3 : INK2);
    }
  }
}
function meterRow(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode, M = meterGeo(seg);
  for (var c = 0; c < 8; c++) {
    var k = kn[c], x0 = c * 120;
    if (!k || !v[k]) continue;
    var h = k === t, ink = h ? "slot" : INK;
    g.text(x0 + 8, M.ny, String(v[k].name || k).toUpperCase(), h ? "slot" : INK2, -1, 106);
    var sv = shown(v, k);
    if (TRIGGERS[k]) {
      g.fill(x0 + 22, M.by + 2, 76, seg ? 18 : 22, h ? "slot" : INK4);
      g.text(x0 + 60, M.by + (seg ? 15 : 17), "ROLL", h ? "black" : INK, 0);
      if (!seg) g.text(x0 + 60, ROW + 53, "TURN TO FIRE", INK3, 0);
      continue;
    }
    if (ENUMS[k]) {
      var n = ENUMS[k], f = fr(v, k, 0), sel = Math.round(f * (n - 1));
      if (n <= 12) {
        var sw = Math.min(10, Math.floor(96 / n)), sx = x0 + 60 - (n * sw) / 2;
        for (var i = 0; i < n; i++) g.fill(sx + i * sw + 1, M.by, sw - 2, 4, known(v, k) && i === sel ? (h ? "slot" : INK) : INK4);
      } else {
        g.fill(x0 + 12, M.by + 2, 96, 1, INK4);
        if (known(v, k)) g.fill(x0 + 12 + Math.round(94 * f), M.by - 2, 3, 9, h ? "slot" : INK);
      }
      g.value(x0 + 60, M.vy, sv[0], ink, 0, 110);
      continue;
    }
    var cx = x0 + 32, cy = M.cy;
    if (known(v, k)) {
      var a = Math.PI + clamp(v[k].frac, 0, 1) * Math.PI;
      g.line(cx, cy, cx + Math.cos(a) * (M.r - 2), cy + Math.sin(a) * (M.r - 2), h ? 3 : 2, h ? "slot" : INK);
    }
    g.dot(cx, cy, 3, h ? "slot" : INK2);
    if (sv[1]) g.text(x0 + 113, M.uy, sv[1], h ? "slot" : INK3, 1);
    g.value(x0 + 113, M.vy, sv[0], ink, 1, 56);
  }
}
function header(g, v, title) {
  var ps = v.$pages || [];
  g.value(10, 17, "FIZZIK", INK, -1);
  var nm = txt(v, "preset");
  g.text(90, 16, nm ? nm.toUpperCase() : "", ACOL, -1, 380);
  if (ps.length > 1) g.text(950, 16, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, INK2, 1);
}
function paper(g, x, y, w, h) { // the notebook's squares
  g.fill(x, y, w, h, GROUND);
  for (var gx = x + 12; gx < x + w; gx += 24) g.fill(gx, y, 1, h, GRID);
  for (var gy = y + 12; gy < y + h; gy += 24) g.fill(x, gy, w, 1, GRID);
}

// ---- PANEL ---------------------------------------------------------------------------------
// The coupled pair as a mechanics text draws two oscillators: A and B side by
// side, the spring between them, each body in its material with the strike
// and the pickup marked; the burst that strikes both on the left; what each
// gives to the output (Balance) along the bottom, into the filter.
var PX = { exc: 8, excW: 120, a: 144, b: 372, bw: 170, flt: 568, fltW: 186, amp: 768, ampW: 184 };
var BODY_Y = 40, BODY_H = 44, BUS = 97;
function panelGround(g, kn, seg) {
  paper(g, 0, 0, 960, ROW);
  g.fill(0, 21, 960, 1, RULE);
  g.text(PX.exc, 33, "EXCITER", INK2, -1);
  g.text(PX.flt, 33, "FILTER", INK2, -1);
  g.text(PX.amp, 33, "AMP", INK2, -1);
  g.fill(PX.amp - 7, 26, 1, 72, INK4);
  g.value(PX.a, 37, "A", ACOL, -1);
  g.value(PX.b, 37, "B", BCOL, -1);
  meterGround(g, kn, seg);
}
// a spring of n coils from (x0, y) across to (x1, y)
function springH(g, x0, x1, y, amp, c, lw) {
  var n = 6, step = (x1 - x0 - 12) / n, pts = [x0, y, x0 + 6, y];
  for (var i = 0; i < n; i++) pts.push(x0 + 6 + step * (i + 0.5), y + (i % 2 ? amp : -amp));
  pts.push(x1 - 6, y, x1, y);
  g.poly(pts, lw, c);
}
function bodyLabel(g, v, pre, x, md) {
  var model = modelOf(v, pre + "model"), tn = Math.round(num(v, pre + "tune", 0));
  var mh = hot(v, pre + "model") || hot(v, pre + "struct");
  var th = hot(v, pre + "tune");
  g.text(x + 18, 33, model >= 0 ? MODELS[model].toUpperCase() : "--", mh ? "slot" : INK, -1, 80);
  var mw = model >= 0 ? g.measure(MODELS[model].toUpperCase()) : 14;
  var ts = (tn > 0 ? "+" : "") + tn + " ST";
  g.text(x + 26 + mw, 33, ts, th ? "slot" : INK2, -1);
  if (md) { // its ring time at middle C, where the line has room for it
    var rt = "T60 " + t60Text(md.t60), room = PX.bw - 26 - mw - g.measure(ts) - 10;
    if (g.measure(rt) > room) rt = t60Text(md.t60);
    g.text(x + PX.bw, 33, rt, hotAny(v, [pre + "decay", pre + "damp"]) ? "slot" : INK3, 1);
  }
  return model;
}
function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "";
  var seg = !!v.$segmode;
  g.layer("panel|" + kn.join(",") + "|" + seg, function () { panelGround(g, kn, seg); });
  header(g, v);
  // the burst that strikes both
  var exHot = t.indexOf("exc_") === 0;
  var T = burst(g, v, PX.exc, BODY_Y, PX.excW, BODY_H, exHot ? "slot" : INK);
  g.text(PX.exc + PX.excW, 33, (T ? msU(T).join(" ") : "--"), exHot ? "slot" : INK2, 1);
  var m = num(v, "exc_mix", 0.5);
  g.text(PX.exc, 99, m < 0.5 ? "NOISE " + Math.round((1 - m) * 100) + "%" : "MALLET " + Math.round(m * 100) + "%", exHot ? "slot" : INK3, -1);
  // A and B, the spring between
  var amd = modesOf(v, "a_"), bmd = modesOf(v, "b_");
  var ma = bodyLabel(g, v, "a_", PX.a, amd), mb = bodyLabel(g, v, "b_", PX.b, bmd);
  var ah = hotAny(v, ["a_model", "a_struct", "a_pos"]), bh = hotAny(v, ["b_model", "b_struct", "b_pos"]);
  var A = ma >= 0 ? body(g, PX.a, BODY_Y, PX.bw, BODY_H, ma, num(v, "a_struct", 0), num(v, "a_pos", 0.2), ah ? "slot" : ACOL, true) : null;
  var B = mb >= 0 ? body(g, PX.b, BODY_Y, PX.bw, BODY_H, mb, num(v, "b_struct", 0), num(v, "b_pos", 0.2), bh ? "slot" : BCOL, true) : null;
  var cp = num(v, "couple", 0), ch = hot(v, "couple"), x0 = A ? A.r : PX.a + PX.bw, x1 = B ? B.l : PX.b, cy = BODY_Y + BODY_H / 2;
  var gx = (PX.a + PX.bw + PX.b) / 2, cseg = v.$segmode === "segment" && v.$segment === "couple";
  if (known(v, "couple") && cp > 0.005) {
    springH(g, x0 + 2, x1 - 2, cy, 5, ch ? "slot" : INK, 1.2 + 1.8 * cp);
    g.text(gx, cy - 10, Math.round(cp * 100) + "%", ch ? "slot" : INK, 0);
    g.text(gx, cy + 18, "COUPLE", ch || cseg ? "slot" : INK3, 0);
  } else {
    g.text(gx, cy + 3, "APART", ch || cseg ? "slot" : INK3, 0);
  }
  // what each gives to the output: a line as heavy as its share
  var bal = num(v, "balance", 0.5), bhot = hot(v, "balance");
  var ax = PX.a + PX.bw / 2, bx = PX.b + PX.bw / 2, wa = 1 + 4 * (1 - bal), wb = 1 + 4 * bal;
  var ca = bhot ? "slot" : mix(ACOL, GROUND, 0.2 + 0.5 * bal), cb = bhot ? "slot" : mix(BCOL, GROUND, 0.7 - 0.5 * bal);
  var nx = PX.flt - 14, ny = BUS - 2;
  g.line(ax, BODY_Y + BODY_H + 4, ax, BUS, wa, ca);
  g.line(ax, BUS, nx - 4, BUS, wa, ca);
  g.line(bx, BODY_Y + BODY_H + 4, bx, BUS - 4, wb, cb);
  g.line(bx, BUS - 4, nx - 4, BUS - 4, wb, cb);
  g.dot(nx, ny, 5, bhot ? "slot" : INK); g.dot(nx, ny, 3, GROUND);
  g.text(gx, 92, "A " + Math.round((1 - bal) * 100) + " : " + Math.round(bal * 100) + " B", bhot ? "slot" : INK2, 0);
  // the filter: Pung's, live
  var ft = txt(v, "ftype") || "LP", vo = txt(v, "voicing");
  g.text(PX.flt + PX.fltW, 33, (ft + " " + vo).toUpperCase(), hotAny(v, ["ftype", "voicing"]) ? "slot" : INK, 1, 130);
  // the knob spans 30 Hz .. 18 kHz; Pung's axis 20 Hz .. 20 kHz: the handle where the engine has it
  var at = known(v, "cutoff") ? clamp(Math.log(mexp(num(v, "cutoff", 1), 30, 18000) / 20) / Math.LN10 / 3, 0, 1) : undefined;
  g.filter(PX.flt, 38, PX.fltW, 62, { cutoff: "cutoff", at: at, resonance: "resonance", type: filterName(v), color: SCOPE });
  // the amp envelope: Pung's, every note running along it
  var eh = hotAny(v, ["amp_attack", "amp_release"]);
  g.text(PX.amp + PX.ampW, 33, UNITS.amp_attack(num(v, "amp_attack", 0)).join(" ") + " / " + UNITS.amp_release(num(v, "amp_release", 0)).join(" "), eh ? "slot" : INK2, 1, 150);
  g.envelope(PX.amp - 4, 38, PX.ampW + 8, 62, { attack: "amp_attack", release: "amp_release", color: SCOPE });
  segMark(g, v);
  meterRow(g, v);
}
// the type with its slope, as the voicing makes it (fizzik.c: filter_process)
var POLES = [2, 2, 2, 2, 4, 2, 1, 4, 4, 4, 2, 4];
function filterName(v) {
  var ft = (txt(v, "ftype") || "LP").toUpperCase(), vi = ["Clean SVF", "SEM", "MS-20", "Steiner", "Ladder 4P", "Ladder 2P",
    "Ladder 1P", "Prophet", "Oberheim", "Diode", "Sallen-Key", "Vintage"].indexOf(txt(v, "voicing"));
  var p = vi >= 0 ? POLES[vi] : 2;
  if (ft === "LP" || ft === "HP") return ft + " " + p * 6 + " dB";
  return ft === "BP" ? "BandPass" : "Notch";
}
// The panel's sections as segments. Pung's bar marks the one under the hands;
// the panel lights its heading in the highlighter's colour (the coupling: its
// legend under the spring, in panel()).
var SEGS = [
  { id: "exc", label: "Exciter", rect: [PX.exc - 4, 22, PX.excW + 8, 80], keys: ["exc_mix", "exc_crackle", "exc_color", "exc_attack", "exc_decay", "exc_reso", "vel_level", "vel_color"] },
  { id: "a", label: "Reson A", rect: [PX.a - 4, 22, PX.bw + 8, 66], keys: ["a_model", "a_struct", "a_decay", "a_damp", "a_pos", "a_tone", "a_tune", "a_tension"] },
  { id: "couple", label: "Couple", rect: [PX.a + PX.bw + 6, 40, PX.b - PX.a - PX.bw - 12, 62], keys: ["couple", "balance", "a_tune", "b_tune", "glide", "spread"] },
  { id: "b", label: "Reson B", rect: [PX.b - 4, 22, PX.bw + 8, 66], keys: ["b_model", "b_struct", "b_decay", "b_damp", "b_pos", "b_tone", "b_tune", "b_tension"] },
  { id: "flt", label: "Filter", rect: [PX.flt - 4, 22, PX.fltW + 8, 80], keys: ["cutoff", "resonance", "ftype", "voicing", "eq_tone", "eq_body"] },
  { id: "amp", label: "Amp", rect: [PX.amp - 6, 22, PX.ampW + 10, 80], keys: ["amp_attack", "amp_release", "level", "drive", "width", "comp_amt"] }
];
function segMark(g, v) {
  if (v.$segmode !== "segment") return;
  for (var i = 0; i < SEGS.length; i++) {
    var sg = SEGS[i];
    if (sg.id !== v.$segment) continue;
    if (sg.id === "couple") continue;
    // the heading, in the highlighter's colour
    if (sg.id === "a" || sg.id === "b") g.value(sg.id === "a" ? PX.a : PX.b, 37, sg.id.toUpperCase(), "slot", -1);
    else g.text(sg.id === "exc" ? PX.exc : (sg.id === "flt" ? PX.flt : PX.amp), 33, sg.id === "exc" ? "EXCITER" : (sg.id === "flt" ? "FILTER" : "AMP"), "slot", -1);
  }
}
var PANEL_EXTRA = ["preset", "exc_mix", "exc_crackle", "exc_color", "exc_attack", "exc_decay", "exc_reso",
  "a_model", "a_struct", "a_decay", "a_damp", "a_pos", "a_tone", "a_tune", "b_model", "b_struct", "b_decay", "b_damp",
  "b_pos", "b_tone", "b_tune", "couple", "balance", "cutoff", "resonance", "ftype", "voicing", "amp_attack", "amp_release"];
push.compartment({
  id: "panel", label: "Fizzik", front_panel: true, segments: SEGS, draws_segments: true,
  pages: [
    { label: "Patch", keys: ["preset", "rnd_patch", "rnd_exc", "rnd_reson", "cutoff", "resonance", "ftype", "voicing"] },
    { label: "Play", keys: ["exc_mix", "exc_color", "a_decay", "b_decay", "a_tune", "b_tune", "couple", "balance"] }
  ],
  extra_keys: PANEL_EXTRA,
  screen: function (g, v) { panel(g, v); }
});

// ---- band screens -----------------------------------------------------------------------------
function band(g, key) { g.layer(key, function () { paper(g, 0, 0, g.w, g.h); }); }
function title(g, x, s, lit, right) { g.text(x, 11, s, lit ? "slot" : INK2, right ? 1 : -1); }

// ---- EXCITER -----------------------------------------------------------------------------------
push.compartment({
  id: "exciter", label: "Exciter",
  pages: [{ label: "Exciter", keys: ["exc_mix", "exc_crackle", "exc_color", "exc_reso", "exc_attack", "exc_decay", "vel_level", "vel_color"] }],
  screen: function (g, v) {
    band(g, "exc");
    var t = v.$touched || "";
    // cols 1-2: the burst itself
    var bh = hotAny(v, ["exc_mix", "exc_crackle"]);
    title(g, 8, "THE STRIKE", bh);
    var T = burst(g, v, 8, 18, 224, 60, bh ? "slot" : INK);
    g.text(232, 11, (T ? msU(T).join(" ") : "--"), INK3, 1);
    var m = num(v, "exc_mix", 0.5);
    g.text(8, 84, "NOISE " + Math.round((1 - m) * 100) + "  MALLET " + Math.round(m * 100), INK3, -1);
    // cols 3-4: the colour lowpass
    var cl = mexp(num(v, "exc_color", 0.5), 300, 16000);
    title(g, 248, "COLOUR", hotAny(v, ["exc_color", "exc_reso"]));
    g.text(472, 11, hzU(cl).join(" "), INK3, 1);
    g.filter(244, 16, 232, 70, { cutoff: clamp(Math.log(cl / 20) / Math.LN10 / 3, 0, 1), resonance: num(v, "exc_reso", 0), type: "LP 12 dB", color: SCOPE });
    // cols 5-6: the burst's attack and decay (a one-shot: it runs whether the key is held or not)
    title(g, 488, "BURST", hotAny(v, ["exc_attack", "exc_decay"]));
    g.envelope(484, 16, 232, 70, { attack: "exc_attack", decay: "exc_decay", labels: true, color: SCOPE });
    // cols 7-8: a soft and a hard hit
    title(g, 728, "SOFT HIT", hotAny(v, ["vel_level", "vel_color"]));
    title(g, 944, "HARD HIT", false, true);
    var vl = num(v, "vel_level", 0), vc = num(v, "vel_color", 0), base = num(v, "exc_color", 0.5);
    var soft = 1 - vl * 0.75, sc = clamp(base + vc * (0.25 - 0.5), 0, 1), hc = clamp(base + vc * 0.5, 0, 1);
    var sg = 20 * Math.log(Math.max(soft, 0.01)) / Math.LN10;
    var hb = cached("vh|" + base.toFixed(2) + vc.toFixed(2), function () { return burstPts(838, 18, 106, 52, m, 0, hc, 1, 30); });
    var sb = cached("vs|" + base.toFixed(2) + vc.toFixed(2) + vl.toFixed(2), function () {
      var p = burstPts(728, 18, 106, 52, m, 0, sc, 1, 30);
      for (var i = 1; i < p.length; i += 2) p[i] = 44 + (p[i] - 44) * soft;
      return p;
    });
    g.line(728, 44, 834, 44, 1, INK4); g.line(838, 44, 944, 44, 1, INK4);
    g.poly(sb, 1.5, hot(v, "vel_level") || hot(v, "vel_color") ? "slot" : INK2);
    g.poly(hb, 1.5, INK);
    g.text(728, 84, (sg > -0.05 ? "0" : sg.toFixed(1)) + " DB  " + hzU(mexp(sc, 300, 16000)).join(" "), INK3, -1);
    g.text(944, 84, hzU(mexp(hc, 300, 16000)).join(" "), INK3, 1);
  }
});

// ---- RESONATORS ----------------------------------------------------------------------------------
// a mode's shape: the string's or the beam's n-th, the sheet's (m, n) as its
// nodal lines with the halves moving opposite ways
function modeTile(g, x, y, w, h, model, p, s, col, lit) {
  var c = lit ? col : mix(col, GROUND, 0.6), dim = mix(col, GROUND, lit ? 0.72 : 0.85);
  if (model <= 1) {
    var pts = [], mid = y + h / 2;
    for (var i = 0; i <= 20; i++) pts.push(x + w * i / 20, mid - Math.sin(p.m * Math.PI * i / 20) * (h / 2 - 1));
    g.line(x, mid, x + w, mid, 1, INK4);
    g.poly(pts, 1.5, c);
    for (var k = 0; k <= p.m; k++) g.dot(x + w * k / p.m, mid, 1.6, INK2);
    return;
  }
  var r = rectFit(x, y, w, h, s), cw = r.w / p.n, chh = r.h / p.m;
  for (var a = 0; a < p.m; a++) for (var b = 0; b < p.n; b++) if ((a + b) % 2 === 0) g.fill(r.x + b * cw, r.y + a * chh, cw, chh, dim);
  box(g, r.x, r.y, r.w, r.h, 1, c);
}
function resonScreen(g, v) {
  var pg = v.$page || 0, me = pg === 1 ? "b_" : "a_", other = pg === 1 ? "a_" : "b_";
  var col = pg === 1 ? BCOL : ACOL, ocol = pg === 1 ? ACOL : BCOL, L = pg === 1 ? "B" : "A", OL = pg === 1 ? "A" : "B";
  band(g, "reson");
  var model = modelOf(v, me + "model"), s = num(v, me + "struct", 0), md = modesOf(v, me), od = modesOf(v, other);
  // the body: its shape, stiffness or aspect, where it is struck and heard
  var bh = hotAny(v, [me + "model", me + "struct", me + "pos"]);
  g.value(8, 18, L, col, -1);
  g.text(26, 11, model >= 0 ? MODELS[model].toUpperCase() : "--", hot(v, me + "model") ? "slot" : INK, -1);
  g.text(26, 21, model >= 0 ? structWord(model, s) : "", hot(v, me + "struct") ? "slot" : INK2, -1);
  if (model >= 0) {
    var at = body(g, 12, 25, 268, 52, model, s, num(v, me + "pos", 0.2), bh ? "slot" : col, true);
    var ph = hot(v, me + "pos") ? "slot" : INK3;
    if (model === 0) g.text(clamp(at.px - 4, 12, 150), 84, "PLUCKED AND HEARD HERE", ph, -1);
    else { g.text(12, 84, "STRUCK", INK3, -1); g.text(280, 84, "HEARD AT " + Math.round(num(v, me + "pos", 0) * 100) + "%", ph, 1); }
  }
  // the modes it rings in, lowest first
  g.line(296, 4, 296, 82, 1, INK4);
  title(g, 306, "FIRST MODES", hotAny(v, [me + "struct", me + "pos"]));
  if (md) {
    for (var i = 0; i < 6 && i < md.list.length; i++) {
      var p = md.list[i], tx = 306 + (i % 3) * 110, ty = 18 + Math.floor(i / 3) * 34;
      modeTile(g, tx, ty, 64, 22, model, p, s, col, p.h > 0.15);
      g.text(tx + 70, ty + 9, "X" + (p.r < 10 ? p.r.toFixed(2) : p.r.toFixed(1)), p.h > 0.15 ? INK : INK3, -1);
      g.fill(tx + 70, ty + 15, 34, 3, INK4);
      g.fill(tx + 70, ty + 15, Math.max(1, Math.round(34 * p.h)), 3, p.h > 0.15 ? col : INK3);
    }
  }
  // its partials over the other's, on one axis: where they meet, the coupling sings
  var sx = 636, sw = 308;
  g.line(626, 4, 626, 82, 1, INK4);
  title(g, sx, "PARTIALS", hotAny(v, [me + "tune", me + "decay", me + "damp", me + "tone"]));
  g.text(sx + sw, 11, md ? "RINGS " + t60Text(md.t60) + " AT C4" : "", hot(v, me + "decay") ? "slot" : INK2, 1);
  octaves(g, sx, sw, 16, 80, false, 0);
  g.fill(sx, 52, sw, 1, INK3);
  partials(g, sx, sw, 52, 34, md, num(v, me + "tune", 0), col, 1, false, 2);
  partials(g, sx, sw, 53, 26, od, num(v, other + "tune", 0), ocol, -1, true, 1.5);
  g.text(sx + 2, 84, OL + " BELOW", mix(ocol, GROUND, 0.4), -1);
  // what this model ignores, said where its knobs are
  var ign = [];
  if (model > 0) ign.push("TONE AND TENSION: STRING ONLY");
  else if (num(v, me + "tension", 0) > 0.01) ign.push("HARD HITS GLIDE DOWN TO PITCH");
  g.text(sx + sw, 84, ign.join(""), hotAny(v, [me + "tone", me + "tension"]) ? "slot" : INK3, 1);
}
push.compartment({
  id: "reson", label: "Resonators",
  pages: [
    { label: "Reson A", keys: ["a_model", "a_struct", "a_decay", "a_damp", "a_pos", "a_tone", "a_tune", "a_tension"] },
    { label: "Reson B", keys: ["b_model", "b_struct", "b_decay", "b_damp", "b_pos", "b_tone", "b_tune", "b_tension"] }
  ],
  extra_keys: ["a_model", "a_struct", "a_decay", "a_damp", "a_pos", "a_tone", "a_tune", "a_tension",
    "b_model", "b_struct", "b_decay", "b_damp", "b_pos", "b_tone", "b_tune", "b_tension"],
  screen: resonScreen
});

// ---- VOICE -----------------------------------------------------------------------------------------
push.compartment({
  id: "voice", label: "Voice",
  pages: [{ label: "Voice", keys: ["couple", "balance", "glide", "amp_attack", "amp_release", "spread", "drive", "level"] }],
  extra_keys: ["a_model", "b_model"],
  screen: function (g, v) {
    band(g, "voice");
    // cols 1-2: the coupled pair, and what of each is heard
    var cp = num(v, "couple", 0), bal = num(v, "balance", 0.5), ch = hot(v, "couple"), bh = hot(v, "balance");
    title(g, 8, "A AND B", ch || bh);
    var ma = modelOf(v, "a_model"), mb = modelOf(v, "b_model");
    g.fill(10, 18, 76, 18, mix(ACOL, GROUND, 0.75)); box(g, 10, 18, 76, 18, 1.5, ACOL);
    g.text(48, 31, "A " + (ma >= 0 ? MODELS[ma].toUpperCase() : ""), ACOL, 0, 72);
    g.fill(10, 56, 76, 18, mix(BCOL, GROUND, 0.75)); box(g, 10, 56, 76, 18, 1.5, BCOL);
    g.text(48, 69, "B " + (mb >= 0 ? MODELS[mb].toUpperCase() : ""), BCOL, 0, 72);
    if (cp > 0.005) spring(g, 48, 37, 55, 7, cp, ch ? "slot" : INK, 1.2 + 1.8 * cp);
    g.text(62, 50, cp > 0.005 ? Math.round(cp * 100) + "%" : "APART", ch ? "slot" : INK2, -1);
    g.line(87, 27, 214, 46, 1 + 4 * (1 - bal), bh ? "slot" : mix(ACOL, GROUND, 0.25));
    g.line(87, 65, 214, 46, 1 + 4 * bal, bh ? "slot" : mix(BCOL, GROUND, 0.25));
    g.dot(218, 46, 5, bh ? "slot" : INK); g.dot(218, 46, 3, GROUND);
    g.text(218, 30, Math.round((1 - bal) * 100) + ":" + Math.round(bal * 100), bh ? "slot" : INK2, 0);
    g.text(10, 84, cp > 0.005 ? Math.round(cp * 100) + "% OF EACH DRIVES THE OTHER" : "A AND B RING APART", ch ? "slot" : INK3, -1, 226);
    // col 3: glide, a note sliding to the next
    var gl = num(v, "glide", 0), gh = hot(v, "glide");
    title(g, 248, "GLIDE", gh);
    var gms = gl < 0.001 ? 0 : mexp(gl + 1e-4, 1, 500);
    var gp = cached("gl|" + gms.toFixed(1), function () {
      var pts = [], x0 = 248, w = 104, tau = gms / 500 * w * 0.5;
      for (var i = 0; i <= 26; i++) {
        var x = i / 26 * w, y;
        if (x < 24) y = 70; else y = tau < 0.5 ? 34 : 34 + 36 * Math.exp(-(x - 24) / tau);
        pts.push(x0 + x, y);
      }
      return pts;
    });
    g.poly(gp, 2, gh ? "slot" : INK);
    g.text(352, 84, gms ? msU(gms).join(" ") : "OFF", INK3, 1);
    // cols 4-5: the amp envelope (held as long as the key is)
    title(g, 368, "AMP", hotAny(v, ["amp_attack", "amp_release"]));
    g.envelope(364, 16, 232, 70, { attack: "amp_attack", release: "amp_release", labels: true, color: SCOPE });
    // col 6: where the voices land in the stereo field
    var sp = num(v, "spread", 0), sh = hot(v, "spread");
    title(g, 608, "SPREAD", sh);
    g.dot(660, 76, 3, INK2);
    for (var k = 0; k < 6; k++) {
      var pan = (k / 5 * 2 - 1) * sp, a = -Math.PI / 2 + pan * Math.PI / 3;
      g.line(660, 76, 660 + Math.cos(a) * 52, 76 + Math.sin(a) * 52, 1.5, sh ? "slot" : (k % 2 ? INK2 : INK));
    }
    g.text(612, 84, "L", INK3, -1); g.text(708, 84, "R", INK3, 1);
    // col 7: the drive's curve (tanh, blended with the dry sound)
    var dr = num(v, "drive", 0), dh = hot(v, "drive");
    title(g, 728, "DRIVE", dh);
    var dp = cached("dr|" + dr.toFixed(2), function () {
      var pts = [], gg = 1 + dr * 4, cmp = 1 / (1 + dr * 1.2);
      for (var i = 0; i <= 24; i++) {
        var x = i / 24 * 2 - 1, y = ((1 - dr) * x + dr * Math.tanh(x * gg) * cmp);
        pts.push(736 + (x + 1) * 44, 50 - clamp(y, -1, 1) * 30);
      }
      return pts;
    });
    g.line(736, 50, 824, 50, 1, INK4); g.line(780, 18, 780, 82, 1, INK4);
    g.poly(dp, 2, dh ? "slot" : INK);
    // col 8: the patch's level
    var lv = num(v, "level", 0.6), lh = hot(v, "level");
    title(g, 848, "LEVEL", lh);
    for (var q = 0; q < 12; q++) g.fill(850 + q * 8, 40, 6, 22, q < Math.round(lv * 12) ? (lh ? "slot" : INK) : INK4);
    g.text(944, 84, UNITS.level(lv).join(" "), INK3, 1);
  }
});

// ---- FX ------------------------------------------------------------------------------------------------
// The reverb is four combs (1557, 1617, 1491, 1422 samples) fed back at 0.60 to
// 0.98 by Size: their echoes, in time. The delay ping-pongs: its taps left
// above, right below, each Feedback x 0.85 of the last, darker with Tone.
var COMBS = [1557, 1617, 1491, 1422];
push.compartment({
  id: "fx", label: "FX",
  pages: [{ label: "FX", keys: ["rev_mix", "rev_size", "rev_damp", "dly_mix", "dly_time", "dly_fb", "dly_tone", "width"] }],
  screen: function (g, v) {
    band(g, "fx");
    var rm = num(v, "rev_mix", 0), rs = num(v, "rev_size", 0.5), rd = num(v, "rev_damp", 0.4);
    var rh = hotAny(v, ["rev_mix", "rev_size", "rev_damp"]);
    var fb = 0.6 + 0.38 * rs, t60 = -3 * (1522 / SR) / (Math.log(fb) / Math.LN10);
    title(g, 8, "REVERB", rh);
    g.text(352, 11, "TAIL " + t60Text(t60), rh ? "slot" : INK2, 1);
    // 0 .. 2.5 s
    var x0 = 8, w = 344, span = Math.max(1, Math.min(4, t60 * 1.1));
    g.fill(x0, 70, w, 1, INK3);
    var rp = cached("rv|" + rm.toFixed(2) + rs.toFixed(2) + rd.toFixed(2), function () {
      var out = [];
      for (var c = 0; c < 4; c++) for (var k = 1; k < 200; k++) {
        var tt = k * COMBS[c] / SR; if (tt > span) break;
        var a = Math.pow(fb, k); if (a < 0.02) break;
        out.push([x0 + tt / span * w, a, Math.pow(1 - (0.05 + 0.6 * rd) * 0.5, k)]);
      }
      return out;
    });
    var amp = 0.25 + 0.75 * rm;
    for (var i = 0; i < rp.length; i++) {
      var e = rp[i], c = mix(rh ? "#ffffff" : INK, GROUND, 1 - clamp(e[2], 0.15, 1));
      g.line(e[0], 70, e[0], 70 - 50 * e[1] * amp, 1, rm > 0.005 ? c : INK4);
    }
    g.text(8, 84, "0", INK3, -1); g.text(352, 84, span.toFixed(1) + " S", INK3, 1);
    // the delay
    var dm = num(v, "dly_mix", 0), dt = mexp(num(v, "dly_time", 0.4), 30, 700), df = num(v, "dly_fb", 0) * 0.85;
    var tone = num(v, "dly_tone", 0.5), dh = hotAny(v, ["dly_mix", "dly_time", "dly_fb", "dly_tone"]);
    title(g, 368, "PING-PONG DELAY", dh);
    g.text(824, 11, msU(dt).join(" ") + "  " + (df > 0.005 ? "FEEDBACK " + Math.round(df * 100) + "%" : "ONE ECHO"), dh ? "slot" : INK2, 1);
    var dx = 368, dw = 456, dspan = Math.max(dt * 8, 600) / 1000;
    g.fill(dx, 48, dw, 1, INK3);
    g.text(dx + 6, 22, "NOTE", INK3, -1);
    g.text(dx + dw, 30, "L", INK3, 1); g.text(dx + dw, 74, "R", INK3, 1);
    g.line(dx + 2, 48 - 30, dx + 2, 48 + 30, 1, INK3);
    var lvl = 1;
    for (var k2 = 1; k2 < 40; k2++) {
      var tx = dx + (k2 * dt / 1000) / dspan * dw;
      if (tx > dx + dw - 12 || lvl < 0.03) break;
      var col = dm > 0.005 ? mix(dh ? "#ffffff" : INK, GROUND, clamp((k2 - 1) * (1 - tone) * 0.18, 0, 0.8)) : INK4;
      var hh = Math.max(3, 30 * lvl * (dm > 0.005 ? dm : 0.5)), dir = k2 % 2 ? -1 : 1;
      g.line(tx, 48, tx, 48 + dir * hh, 3, col);
      lvl *= df;
      if (df <= 0.005) break;
    }
    g.text(dx, 84, "0", INK3, -1); g.text(dx + dw, 84, dspan.toFixed(1) + " S", INK3, 1);
    // the stereo width: M/S, half is the sound as it is
    var wd = num(v, "width", 0.5), wh = hot(v, "width");
    title(g, 848, "WIDTH", wh);
    var ang = wd * Math.PI * 0.45;
    g.arc(896, 78, 40, -Math.PI / 2 - ang, 2 * ang + 0.001, 6, wh ? "slot" : mix(SCOPE, GROUND, 0.55));
    g.dot(896, 78, 3, INK2);
    g.line(896, 78, 896 - Math.sin(ang) * 46, 78 - Math.cos(ang) * 46, 2, wh ? "slot" : INK);
    g.line(896, 78, 896 + Math.sin(ang) * 46, 78 - Math.cos(ang) * 46, 2, wh ? "slot" : INK);
    g.text(944, 84, wd < 0.495 ? "NARROWER" : (wd > 0.505 ? "WIDER" : "AS IS"), INK3, 1);
  }
});

// ---- FX 2 (default view) --------------------------------------------------------------------------------
push.compartment({
  id: "fx2", label: "FX 2",
  pages: [{ label: "FX 2", keys: ["eq_tone", "eq_body", "cho_mix", "cho_rate", "cho_depth", "comp_amt", "lim_drive", "lim_ceil"] }]
});

// ---- MOD: two LFOs and what they move ---------------------------------------------------------------------
// Each LFO adds its wave x Depth to one target: half the target knob's range at
// full depth, or 4 semitones of pitch (fizzik.c: render_block). They run free,
// so Pung draws their waves still.
var REACH = { Cutoff: "CUTOFF", Pitch: "PITCH", Couple: "COUPLE", Balance: "BALANCE", Tension: "TENSION", Tone: "TONE", Reso: "RESO" };
function lfoHalf(g, v, n, x) {
  var p = "lfo" + n + "_", tg = txt(v, p + "target"), off = !tg || tg === "Off", d = num(v, p + "depth", 0);
  var lh = hotAny(v, [p + "rate", p + "shape"]);
  title(g, x, "LFO " + n, lh || hotAny(v, [p + "depth", p + "target"]));
  g.text(x + 228, 11, UNITS[p + "rate"](num(v, p + "rate", 0)).join(" ") + "  " + txt(v, p + "shape").toUpperCase(), lh ? "slot" : INK2, 1);
  g.lfo(x - 4, 16, 236, 70, { shape: p + "shape", rate: p + "rate", trig: false, color: off || d < 0.005 ? INK4 : SCOPE });
  // what it moves, and how far
  var th = hotAny(v, [p + "target", p + "depth"]), tx = x + 246;
  g.text(tx, 26, "MOVES", INK3, -1);
  g.value(tx, 48, off ? "NOTHING" : (REACH[tg] || tg.toUpperCase()), th ? "slot" : (off ? INK3 : INK), -1, 220);
  var reach = off ? "" : (tg === "Pitch" ? "+/- " + (d * 4).toFixed(1) + " ST" : "+/- " + Math.round(d * 50) + "% OF ITS RANGE");
  g.text(tx, 66, d < 0.005 && !off ? "DEPTH 0: STILL" : reach, th ? "slot" : INK2, -1, 220);
  if (!off) {
    g.fill(tx, 74, 100, 3, INK4);
    g.fill(tx, 74, Math.round(100 * d), 3, th ? "slot" : INK);
  }
}
push.compartment({
  id: "mod", label: "Mod",
  pages: [{ label: "Mod", keys: ["lfo1_rate", "lfo1_depth", "lfo1_shape", "lfo1_target", "lfo2_rate", "lfo2_depth", "lfo2_shape", "lfo2_target"] }],
  screen: function (g, v) {
    band(g, "mod");
    lfoHalf(g, v, 1, 8);
    g.line(476, 4, 476, 82, 1, INK4);
    lfoHalf(g, v, 2, 488);
  }
});

// ---- AFTERTOUCH: pressing into a held note ----------------------------------------------------------------
// At full pressure (fizzik.c): Bright adds half its depth to the resonators'
// tone, Bow re-excites the note with noise, Cutoff opens the global filter by
// its depth of the range, Bend raises it up to 2 semitones, Vibrato swings up
// to 1 semitone at 3 to 9 Hz. Curve bends how pressure gets there.
push.compartment({
  id: "touch", label: "Aftertouch",
  pages: [{ label: "Aftertouch", keys: ["at_preset", "at_bright", "at_bow", "at_cutoff", "at_bend", "at_vib", "at_vrate", "at_curve"] }],
  screen: function (g, v) {
    band(g, "touch");
    var ph = hot(v, "at_preset");
    title(g, 8, "FEEL", ph);
    g.value(8, 44, txt(v, "at_preset").toUpperCase() || "--", ph ? "slot" : INK, -1, 104);
    g.text(8, 62, "SETS ALL SEVEN", INK3, -1);
    g.text(8, 76, "PRESSED FULLY:", INK3, -1);
    var rows = [["at_bright", 128, "BRIGHTER", function (d) { return "TONE +" + Math.round(d * 50) + "%"; }],
      ["at_bow", 248, "BOWED", function (d) { return "NOISE " + Math.round(d * 35) + "%"; }],
      ["at_cutoff", 368, "OPENS", function (d) { return "CUTOFF +" + Math.round(d * 100) + "%"; }],
      ["at_bend", 488, "BENDS UP", function (d) { return "+" + (d * 2).toFixed(2) + " ST"; }]];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], d = num(v, r[0], 0), h = hot(v, r[0]), x = r[1];
      title(g, x, r[2], h);
      // a column as full as the depth
      g.fill(x, 20, 12, 56, INK4);
      g.fill(x, 20 + Math.round(56 * (1 - d)), 12, Math.round(56 * d), h ? "slot" : (d > 0.005 ? INK : INK4));
      g.text(x + 20, 76, d > 0.005 ? r[3](d) : "NONE", h ? "slot" : (d > 0.005 ? INK2 : INK3), -1, 92);
    }
    // vibrato: Pung's LFO, restarted by every note
    var vh = hotAny(v, ["at_vib", "at_vrate"]), vd = num(v, "at_vib", 0);
    title(g, 608, "VIBRATO", vh);
    g.text(824, 11, "+/- " + vd.toFixed(2) + " ST  " + UNITS.at_vrate(num(v, "at_vrate", 0.5)).join(" "), vh ? "slot" : INK2, 1);
    g.lfo(604, 16, 224, 70, { shape: "Sine", rate: "at_vrate", trig: true, color: vd > 0.005 ? SCOPE : INK4 });
    // the response: pressure in, effect out
    var cv = num(v, "at_curve", 0.5), ch = hot(v, "at_curve");
    title(g, 848, "CURVE", ch);
    var cp = cached("atc|" + cv.toFixed(2), function () {
      var e = cv < 0.5 ? 1 + (0.5 - cv) * 3 : 1 / (1 + (cv - 0.5) * 3), pts = [];
      for (var i = 0; i <= 20; i++) { var p = i / 20; pts.push(850 + p * 92, 80 - Math.pow(p, e) * 60); }
      return pts;
    });
    g.line(850, 80, 942, 80, 1, INK3); g.line(850, 20, 850, 80, 1, INK3);
    g.line(850, 80, 942, 20, 1, INK4);
    g.poly(cp, 2, ch ? "slot" : INK);
  }
});

// ---- MPE (default view) -------------------------------------------------------------------------------------
push.compartment({
  id: "mpe", label: "MPE",
  pages: [{ label: "MPE", keys: ["mpe", "mpe_zone", "mpe_bend", "mpe_mbend", "mpe_press", "mpe_cc74", "mpe_cc74_tgt", "mpe_smooth"] }]
});
