// DubStarMooniCon (a two-oscillator divider voice) on Push.
// An overlay shipped with Pung (the module ships no push_ui.js).
//
// The instrument is its two oscillators and the taps each one reads off its
// own phase, every pitch a stepped ratio of the key. What knobs cannot show
// is where those partials stand: so the face is a night sky of them, VCO 1
// above a shared pitch axis and VCO 2 below it, every partial at its true
// ratio of the key and as loud as the engine makes it. Beside them the one
// resonant filter and the one contour that moves loudness and cutoff.
//
//   PANEL        the front panel: both oscillators (wave, octave, summed
//                wave, the partials on one axis), the filter (Pung's, live)
//                with the contour's sweep, the contour (Pung's, live), and
//                which oscillator the notes now sounding play
//   OSCILLATORS  one page per VCO: its summed wave and its partials, large,
//                with their ratios, intervals and the level each keeps
//   FILTER/ENV   the filter, where its coefficient stops, the contour's sweep;
//                the contour with its stage bar
//   VOICES       the module's own live state: the four voices and the VCO
//                each plays, the contour's stage and level, the pressure
//                that lengthens the release
//
// Everything drawn is the engine's own arithmetic (src/suborg.c), checked by
// compiling the engine and playing it (2026-11-23):
//
// - A tap reads phase * div (`p1 = v->phase * v->div1`), so a "1:3" tap
//   sounds at 3 x the core: 660 Hz on a 220 Hz note, measured, every ratio
//   alike. The module names them as subharmonics (1:3 Fifth); they sound as
//   harmonics, above the core. The screens draw them where they sound and
//   read them as x3; TAP_UP says so in one place, should the engine change.
// - Each tap is scaled 1/sqrt(div) (`scale1`), on top of its level.
// - The four voices are not one oscillator each: voices 1 and 2 take VCO 2's
//   settings, 3 and 4 VCO 1's (`refresh_voice(.., (i >= 2) ? 0 : 1)`). A note
//   takes the next voice and keeps it until the shared contour is idle, when
//   they all retire: the 1st, 2nd, 5th, 6th... note since silence sounds
//   VCO 2, the 3rd, 4th, 7th... VCO 1 (measured: one note with VCO 2's level
//   at 0 is silent). The voice lamps follow that from the contour's stage.
// - The cutoff is 30 Hz * 2^(9 x), but the filter's coefficient stops at
//   g = 0.5: 6.5 kHz at 44.1 kHz, and the contour takes it no further.
// - The contour (one for loudness and cutoff) runs toward each target with
//   a time constant of a fifth of its table time and moves on at 0.1% (attack)
//   or 0.05% (decay, release) of its way: those are its stage times and curves.
//   Pressure stretches the release by 1 + 3 x pressure.

var SR = 44100;
var TAP_UP = true; // the engine's taps read phase * div: they sound at f x div

// ---- the engine's tables (suborg.c) ------------------------------------------------------
var DIV = [1, 2, 3, 4, 6, 8, 9, 12];
var INTERVAL = ["UNISON", "OCT", "OCT+5TH", "2 OCT", "2 OCT+5TH", "3 OCT", "3 OCT+2ND", "3 OCT+5TH"];
var OCT_ST = [-24, -12, 0, 12, 24], OCT_NAME = ["-2 OCT", "-1 OCT", "0 OCT", "+1 OCT", "+2 OCT"];
var WAVE = ["PULSE", "PULSE 25", "SAW", "TRIANGLE", "SINE"];
var ATK_S = [0.001, 0.005, 0.02, 0.08, 0.3, 1, 3], DEC_S = [0.005, 0.02, 0.08, 0.3, 1, 2, 4];
var FENV = [0, 0.25, 0.5, 0.75, 1];
var MODE = ["LOW PASS", "BAND PASS", "HIGH PASS"], MODE_SHORT = ["LP", "BP", "HP"];
var STAGES = ["IDLE", "ATTACK", "DECAY", "SUSTAIN", "RELEASE"];
var G_MAX = 0.5, FC_MAX = Math.atan(G_MAX) * SR / Math.PI; // 6507 Hz

// the keys of each oscillator: wave, octave, the two tap ratios, the three levels
var VCO = [
  { wave: "wave1", oct: "oct1", div: ["div1a", "div1b"], lvl: ["lvl1_osc", "lvl1_sub1", "lvl1_sub2"], voices: [2, 3] },
  { wave: "wave2", oct: "oct2", div: ["div2a", "div2b"], lvl: ["lvl2_osc", "lvl2_sub1", "lvl2_sub2"], voices: [0, 1] }
];

function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function idx(v, k, n, d) { return Math.max(0, Math.min(n - 1, Math.round(raw(v, k, d === undefined ? 0 : d)))); }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function log2(x) { return Math.log(x) / Math.LN2; }

// ---- values in the engine's units ------------------------------------------------------------
function cutHz(x) { return Math.min(30 * Math.pow(2, 9 * clamp(x, 0, 1)), FC_MAX); }
function hz(f) { return f >= 1000 ? [(f / 1000).toFixed(f >= 10000 ? 0 : 1), "KHZ"] : [String(Math.round(f)), "HZ"]; }
function secs(s) { return s < 1 ? [String(Math.round(s * 1000)), "MS"] : [s < 10 ? s.toFixed(1).replace(/\.0$/, "") : String(Math.round(s)), "S"]; }
function ratioOf(i) { return TAP_UP ? "x" + DIV[i] : "/" + DIV[i]; }
function tapSt(i) { return (TAP_UP ? 12 : -12) * log2(DIV[i]); }
// [value, unit] for a key and its raw value, or null for the module's own
function fmt(k, x) {
  if (/^lvl/.test(k) || k === "env_sustain" || k === "volume" || k === "resonance") return [String(Math.round(x * 100)), "%"];
  if (/^div/.test(k)) { var i = clamp(Math.round(x), 0, 7); return [ratioOf(i), i ? INTERVAL[i] + (TAP_UP ? " UP" : " DOWN") : "UNISON"]; }
  if (/^oct/.test(k)) { var o = clamp(Math.round(x), 0, 4) - 2; return [(o > 0 ? "+" : "") + o, "OCT"]; }
  if (/^wave/.test(k)) return [WAVE[clamp(Math.round(x), 0, 4)], ""];
  if (k === "cutoff") return hz(cutHz(x));
  if (k === "env_attack") return secs(ATK_S[clamp(Math.round(x), 0, 6)]);
  if (k === "env_decay" || k === "env_release") return secs(DEC_S[clamp(Math.round(x), 0, 6)]);
  if (k === "filt_mode") return [MODE[clamp(Math.round(x), 0, 2)], ""];
  if (k === "filt_env") { var e = clamp(Math.round(x), 0, 4); return e ? [String(FENV[e] * 100), "%"] : ["OFF", ""]; }
  if (k === "env_stage") return [STAGES[clamp(Math.round(x), 0, 4)], ""];
  if (k === "pressure" || k === "env_level") return [String(Math.round(x * 100)), "%"];
  return null;
}
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmt(key, n);
  if (!f) return;
  return f[1] ? { value: f[0], unit: f[1] } : f[0];
});
function val(v, k) {
  if (!known(v, k)) return ["--", ""];
  return fmt(k, raw(v, k, 0)) || [txt(v, k).toUpperCase(), ""];
}

// ---- the contour: its stage times and curves, as the engine runs it -----------------------------
// tau = table time / 5; attack ends at 0.999, decay at sustain + 0.0005, release at 0.0005
var LN1000 = Math.log(1000);
function stageLogs(s) {
  return { a: LN1000, d: Math.log(Math.max(1, (1 - s) / 0.0005)), r: Math.log(Math.max(1, s / 0.0005)) };
}
function contourCurves(v) {
  var L = stageLogs(raw(v, "env_sustain", 0.7));
  return { attack: -L.a, decay: -Math.max(0.5, L.d), release: -Math.max(0.5, L.r) };
}
push.envelopeTimes(function (env) {
  var s = env.value("env_sustain"), sus = s === null || s === undefined ? 0.7 : parseFloat(s), L = stageLogs(isNaN(sus) ? 0.7 : sus);
  return env.stages.map(function (st) {
    if (st.plateau || st.raw === null || st.raw === undefined) return null;
    var i = clamp(Math.round(parseFloat(st.raw)), 0, 6);
    if (st.key === "env_attack") return ATK_S[i] / 5 * L.a;
    if (st.key === "env_decay") return DEC_S[i] / 5 * L.d;
    if (st.key === "env_release") return DEC_S[i] / 5 * L.r;
    return null;
  });
});

// ---- palette: the night it is named for ------------------------------------------------------
var NIGHT = "#0b1024", HEAD = "#05070f", WELL = "#131b3a", GRID = "#212c55", RULE = "#3a4777";
var INK = "#eef1fa", LEG = "#a3aed0", DIM = "#68749e", ROW = "#070a18";
var GOLD = "#ffc84a", MOON = "#7cc6ff", LILAC = "#c9b2ff";
var COL = [GOLD, MOON];
var COL_TAP = ["#b98d2c", "#4f8dbf"]; // a tap's stem: its oscillator's colour, below the core's
function mix(a, b, t) {
  function ch(c, i) { return parseInt(c.substr(1 + i * 2, 2), 16); }
  var s = "#";
  for (var i = 0; i < 3; i++) { var x = Math.round(ch(a, i) * (1 - t) + ch(b, i) * t); s += (x < 16 ? "0" : "") + x.toString(16); }
  return s;
}
var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 96) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}

// ---- an oscillator's partials and its summed wave ----------------------------------------------
// [{st, amp, part, div}] relative to the key: part 0 the core, 1 and 2 the taps
function partials(v, o) {
  var V = VCO[o], oct = OCT_ST[idx(v, V.oct, 5, 2)], out = [];
  out.push({ st: oct, amp: raw(v, V.lvl[0], 0), part: 0, div: 0 });
  for (var t = 0; t < 2; t++) {
    var d = idx(v, V.div[t], 8, 0);
    out.push({ st: oct + tapSt(d), amp: raw(v, V.lvl[t + 1], 0) / Math.sqrt(DIV[d]), part: t + 1, div: d });
  }
  return out;
}
// the engine's shapes (wave_sample, without the band-limiting)
function shape(w, p) {
  p -= Math.floor(p);
  switch (w) {
  case 0: return p < 0.5 ? 1 : -1;
  case 1: return p < 0.25 ? 1 : -1 / 3;
  case 2: return 2 * p - 1;
  case 3: return 4 * Math.abs(p - 0.5) - 1;
  default: return Math.sin(2 * Math.PI * p);
  }
}
// the oscillator's output over `periods` of its core, across x0..x1 (a point every `step` px)
// about mid; one component alone with `only`, on the scale of the whole so it reads as its share.
// The samples are kept per sound, the points per place.
function waveSamples(v, o, n, periods) {
  var V = VCO[o], w = idx(v, V.wave, 5, 0), lv = [], dv = [1], i;
  for (i = 0; i < 3; i++) lv.push(raw(v, V.lvl[i], 0));
  dv.push(DIV[idx(v, V.div[0], 8, 0)], DIV[idx(v, V.div[1], 8, 0)]);
  var key = "ws|" + [o, w, lv.join(","), dv.join(","), n, periods].join("|");
  return { key: key, s: cached(key, function () {
    var sum = [], comp = [[], [], []], peak = 0, j, k, gk = [];
    for (k = 0; k < 3; k++) gk.push(k ? lv[k] / Math.sqrt(dv[k]) : lv[0]);
    for (j = 0; j <= n; j++) {
      var ph = periods * Math.min(j / n, 0.99999), s = 0;
      for (k = 0; k < 3; k++) {
        var y = gk[k] > 0 ? gk[k] * shape(w, TAP_UP ? ph * dv[k] : ph / dv[k]) : 0;
        comp[k].push(y); s += y;
      }
      sum.push(s); if (Math.abs(s) > peak) peak = Math.abs(s);
    }
    return { sum: sum, comp: comp, peak: peak };
  }) };
}
function wavePts(v, o, x0, x1, mid, half, periods, only, step) {
  step = step || 1;
  var n = Math.round((x1 - x0) / step), W = waveSamples(v, o, n, periods);
  return cached(W.key + "|" + [x0, mid, half, step, only].join("|"), function () {
    var src = only === undefined ? W.s.sum : W.s.comp[only], sc = W.s.peak < 1e-4 ? 0 : half / W.s.peak, pts = [];
    for (var j = 0; j <= n; j++) pts.push(x0 + j * step, mid - src[j] * sc);
    return { pts: pts, silent: W.s.peak < 1e-4 };
  });
}

// ---- the pitch axis the partials stand on (semitones from the key) ---------------------------
var ST_LO = -26, ST_HI = 70;
function axis(x0, x1) { return function (st) { return x0 + (x1 - x0) * (st - ST_LO) / (ST_HI - ST_LO); }; }
// a partial's head: a small star
function star(g, x, y, r, c) {
  g.dot(x, y, r, c);
  g.fill(x - r - 2, y - 0.5, 2 * r + 4, 1, c);
  g.fill(x - 0.5, y - r - 2, 1, 2 * r + 4, c);
}
// an oscillator's partials on an axis: base y, height for amplitude 1, dir -1 up / +1 down.
// Coinciding partials (a unison tap) add up as the engine adds them, stacked. Each tap is
// named by its ratio; a silent one is a ring on the base, where it would sound.
function drawPartials(g, v, o, X, base, height, dir, touch) {
  var P = partials(v, o), V = VCO[o], ok = known(v, V.lvl[0]) && known(v, V.oct);
  var groups = {}, order = [], i;
  for (i = 0; i < 3; i++) {
    var key = P[i].st.toFixed(2);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(P[i]);
  }
  order.sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
  var lastR = -1e9, lastY = 0;
  for (var gi = 0; gi < order.length; gi++) {
    var grp = groups[order[gi]], x = Math.round(X(grp[0].st)), acc = 0, hotAny = false, names = [];
    for (i = 0; i < grp.length; i++) {
      var p = grp[i], hot = touch[p.part], h = Math.min(height - acc, p.amp * height);
      if (hot) hotAny = true;
      if (p.part && p.div > 0) names.push(ratioOf(p.div));
      if (h >= 1) {
        var y0 = base + dir * acc, y1 = base + dir * (acc + h);
        g.fill(x - 2.5, Math.min(y0, y1), 5, Math.abs(y1 - y0), hot ? "slot" : !ok ? DIM : p.part ? COL_TAP[o] : COL[o]);
        acc += h;
      }
    }
    var silent = acc < 1, hy = base + dir * acc;
    if (silent) {
      g.dot(x, base + dir * 3, 3, hotAny ? "slot" : RULE);
      g.dot(x, base + dir * 3, 1.5, WELL);
    } else star(g, x, hy, 3, hotAny ? "slot" : !ok ? DIM : COL[o]);
    if (!names.length) continue;
    var s = names.join("+"), lx = x + 6, ly = silent ? base + dir * 3 + 3 : hy + 3;
    if (lx < lastR + 4 && Math.abs(ly - lastY) < 9) ly = lastY - dir * 9; // a neighbour's label is there: past it
    g.text(lx, ly, s, hotAny ? "slot" : silent ? DIM : LEG, -1);
    lastR = lx + g.measure(s); lastY = ly;
  }
}

// ---- the voices: which oscillator each sounding note plays -------------------------------------
// A note takes the next of the four voices (the oldest when all are taken) and
// keeps it until the contour is idle; voices 1 and 2 play VCO 2, 3 and 4 VCO 1.
// Followed from the module's contour stage (a live key) and Pung's note count;
// unknown after a gap in which no screen followed it, until the next idle.
var VS = { notes: -1, n: 0, ok: false, t: -1 };
function voiceState(v) {
  var L = v.$live || {}, st = known(v, "env_stage") ? Math.round(raw(v, "env_stage", 0)) : -1;
  if (!L.known || st < 0) { VS.ok = false; VS.notes = -1; return null; }
  var now = typeof L.t === "number" ? L.t : -1, gap = VS.t >= 0 && now >= 0 && now - VS.t > 0.25;
  VS.t = now;
  if (st === 0) { VS.n = 0; VS.ok = true; VS.notes = L.notes; return { stage: 0, n: 0, ok: true, level: 0 }; }
  if (VS.notes < 0 || gap) { VS.ok = false; VS.notes = L.notes; }
  else if (L.notes > VS.notes) { VS.n += L.notes - VS.notes; VS.notes = L.notes; }
  return { stage: st, n: VS.n, ok: VS.ok, level: raw(v, "env_level", 0) };
}
function voiceLit(s, i) { return !!(s && s.ok && s.stage > 0 && s.n > i); }
function voiceNewest(s, i) { return voiceLit(s, i) && ((s.n - 1) % 4) === i; }
// the four voices as lamps from x: 1-2 in VCO 2's colour, 3-4 in VCO 1's
function voiceLamps(g, v, x, y) {
  var s = voiceState(v);
  g.text(x, y + 4, "VOICES", LEG, -1);
  x += 54;
  for (var i = 0; i < 4; i++) {
    var o = i < 2 ? 1 : 0, cx = x + i * 15 + (i >= 2 ? 7 : 0), lit = voiceLit(s, i);
    g.dot(cx, y, 5, lit ? COL[o] : mix(COL[o], HEAD, 0.7));
    if (voiceNewest(s, i)) g.dot(cx, y, 2, HEAD);
  }
  if (s && s.stage > 0 && !s.ok) g.text(x + 70, y + 4, "--", DIM, -1);
}

// ---- the encoder row: stepped selectors and level strips ------------------------------------------
var NAMES = {
  wave1: "WAVE", oct1: "OCTAVE", div1a: "SUB 1 RATIO", div1b: "SUB 2 RATIO", lvl1_osc: "VCO 1", lvl1_sub1: "SUB 1", lvl1_sub2: "SUB 2",
  wave2: "WAVE", oct2: "OCTAVE", div2a: "SUB 1 RATIO", div2b: "SUB 2 RATIO", lvl2_osc: "VCO 2", lvl2_sub1: "SUB 1", lvl2_sub2: "SUB 2",
  cutoff: "CUTOFF", resonance: "RESONANCE", filt_mode: "MODE", filt_env: "ENV AMOUNT", volume: "VOLUME",
  env_attack: "ATTACK", env_decay: "DECAY", env_sustain: "SUSTAIN", env_release: "RELEASE"
};
var STEPS = { wave1: 5, wave2: 5, oct1: 5, oct2: 5, div1a: 8, div1b: 8, div2a: 8, div2b: 8, filt_mode: 3, filt_env: 5, env_attack: 7, env_decay: 7, env_release: 7 };
function vcoOf(k) { return /^(wave|oct|div|lvl)1/.test(k) ? 0 : /^(wave|oct|div|lvl)2/.test(k) ? 1 : -1; }
function colourOf(k) { var o = vcoOf(k); return o >= 0 ? COL[o] : k === "volume" ? INK : LILAC; }
function encoderRow(g, v, seg) {
  var kn = v.$knobs || [], t = v.$touched || "";
  var ny = seg ? 117 : 120, vy = seg ? 134 : 141, ty = seg ? 138 : 150;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x = c * 120 + 10, hot = k === t, ok = known(v, k), col = colourOf(k), o = vcoOf(k), nx = x;
    if (o >= 0) { // the oscillator's badge
      g.fill(x, ny - 8, 11, 10, hot ? "slot" : col);
      g.text(x + 6, ny, String(o + 1), "#000000", 0);
      nx = x + 16;
    }
    g.text(nx, ny, NAMES[k] || String((v[k] && v[k].name) || k).toUpperCase(), hot ? "slot" : LEG, -1, 100 - (nx - x));
    var f = val(v, k);
    g.value(x, vy, f[0], hot ? "slot" : ok ? INK : DIM, -1, 100);
    if (f[1]) {
      var vw = g.measure(f[0], "value"), uw = g.measure(f[1]);
      if (vw + 5 + uw <= 102) g.text(x + vw + 4, vy, f[1], hot ? "slot" : LEG, -1);
    }
    // the control: a stepped selector (a pip per step, the chosen one lit) or a level strip
    var n = STEPS[k], w = 100;
    if (n) {
      var at = idx(v, k, n, 0), pw = (w - (n - 1) * 3) / n;
      for (var s = 0; s < n; s++) g.fill(x + s * (pw + 3), ty, pw, 3, ok && s === at ? (hot ? "slot" : col) : GRID);
    } else {
      var fr = ok ? clamp(v[k].frac, 0, 1) : 0;
      g.fill(x, ty, w, 3, GRID);
      if (ok && fr > 0) g.fill(x, ty, Math.max(2, w * fr), 3, hot ? "slot" : col);
      if (k === "cutoff") g.fill(x + w * log2(FC_MAX / 30) / 9, ty - 3, 1, 9, LEG); // the coefficient's stop
    }
  }
}

// ---- the front panel ------------------------------------------------------------------------
// two lanes on one axis: VCO 1 above (y 22..57), VCO 2 below (68..103), the
// octaves of the key between them; the filter and the contour to the right
var LX0 = 222, LX1 = 626, AX = axis(LX0, LX1);
function panelGround(g, seg) {
  g.fill(0, 0, 960, 160, NIGHT);
  g.fill(0, 0, 960, 20, HEAD);
  // the crescent and the name
  g.dot(12, 10, 7, INK); g.dot(15.5, 8, 6.2, HEAD);
  g.value(26, 16, "DubStarMooniCon", INK, -1);
  // the wells: a lane per oscillator, the filter, the contour
  g.fill(4, 22, 646, 35, WELL); g.fill(4, 68, 646, 35, WELL);
  g.fill(654, 22, 148, 81, WELL); g.fill(806, 22, 150, 81, WELL);
  // the oscillators' names, beside a rule
  g.text(10, 31, "VCO 1", GOLD, -1); g.text(10, 77, "VCO 2", MOON, -1);
  g.fill(70, 26, 1, 27, GRID); g.fill(70, 72, 1, 27, GRID);
  g.fill(212, 26, 1, 27, GRID); g.fill(212, 72, 1, 27, GRID);
  // the octaves of the key, through both lanes, named between them
  for (var o = -2; o <= 5; o++) {
    var x = Math.round(AX(o * 12));
    g.fill(x, 24, 1, 31, o === 0 ? RULE : GRID);
    g.fill(x, 71, 1, 31, o === 0 ? RULE : GRID);
    g.text(x, 64, o === 0 ? "KEY" : (o > 0 ? "+" : "") + o, o === 0 ? INK : DIM, 0);
  }
  g.text(LX1 + 12, 64, "OCT", DIM, -1);
  g.fill(LX0 - 8, 56, LX1 - LX0 + 16, 1, RULE);
  g.fill(LX0 - 8, 69, LX1 - LX0 + 16, 1, RULE);
  g.text(660, 32, "FILTER", LEG, -1); g.text(812, 32, "CONTOUR", LEG, -1);
  // the encoder row
  g.fill(0, 104, 960, 56, ROW);
  g.fill(0, 104, 960, 1, RULE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 28 : 44, GRID);
}
function lane(g, v, o, t) {
  var V = VCO[o], top = o ? 68 : 22, mid = top + 18, okw = known(v, V.wave), i;
  // its wave and its octave
  g.text(10, top + 20, val(v, V.wave)[0], t === V.wave ? "slot" : okw ? INK : DIM, -1, 58);
  g.text(10, top + 31, val(v, V.oct).join(" "), t === V.oct ? "slot" : LEG, -1, 58);
  // the summed wave: two periods of the core; the component under the finger alone
  var touched = -1;
  for (i = 0; i < 3; i++) if (t === V.lvl[i] || (i && t === V.div[i - 1])) touched = i;
  var W = wavePts(v, o, 78, 204, mid, 12, 2);
  g.fill(78, mid, 126, 1, GRID);
  if (W.silent) g.text(141, mid + 3, "SILENT", DIM, 0);
  else {
    if (touched >= 0) g.poly(wavePts(v, o, 78, 204, mid, 12, 2, touched).pts, 1.5, "slot");
    g.poly(W.pts, 2, t === V.wave ? "slot" : okw ? COL[o] : DIM);
  }
  // the partials on the shared axis
  var touch = {};
  for (i = 0; i < 3; i++) touch[i] = t === V.lvl[i] || (i > 0 && t === V.div[i - 1]) || (i === 0 && t === V.oct);
  if (o === 0) drawPartials(g, v, 0, AX, 55, 29, -1, touch);
  else drawPartials(g, v, 1, AX, 70, 29, 1, touch);
}
// the contour's sweep of the cutoff, over a filter picture's axis (x0..x1 its 20 Hz..20 kHz)
function sweep(g, v, x0, x1, y, t, big) {
  if (!known(v, "cutoff") || !known(v, "filt_env")) return;
  var amt = FENV[idx(v, "filt_env", 5, 0)], fc = cutHz(raw(v, "cutoff", 0));
  if (amt <= 0) return;
  function xOf(f) { return x0 + (x1 - x0) * Math.log(f / 20) / Math.log(1000); }
  var gc = Math.min(G_MAX, Math.tan(Math.PI * fc / SR)), ge = Math.min(G_MAX, gc * (1 + 4 * amt));
  var fe = Math.atan(ge) * SR / Math.PI, xc = xOf(fc), xe = xOf(fe), col = t === "filt_env" ? "slot" : LILAC;
  if (xe - xc < 4) { if (big) g.text(470, 9, "AT ITS STOP: THE CONTOUR CANNOT OPEN IT", col, 1); return; }
  g.fill(xc, y - 1, xe - xc - 3, 2, col);
  g.fill(xc, y - 4, 2, 8, col);
  g.poly([xe - 6, y - 4, xe, y, xe - 6, y + 4], 2, col);
  if (big) g.text(470, 9, "THE CONTOUR TAKES IT TO " + hz(fe).join(" "), col, 1);
}
function filterAt(v) { return Math.log(cutHz(raw(v, "cutoff", 0.75)) / 20) / Math.log(1000); }
function panel(g, v) {
  var seg = !!v.$segmode, t = v.$touched || "";
  g.layer("dsm|" + (seg ? 1 : 0), function () { panelGround(g, seg); });
  // the page, at the right of the header
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(952, 14, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  voiceLamps(g, v, 560, 10);
  lane(g, v, 0, t);
  lane(g, v, 1, t);
  // the filter: Pung's, live, where the engine really puts it; the contour's sweep over it
  g.text(796, 32, known(v, "filt_mode") ? MODE_SHORT[idx(v, "filt_mode", 3, 0)] + " 12 DB" : "--", t === "filt_mode" ? "slot" : INK, 1);
  g.filter(654, 34, 148, 69, { cutoff: "cutoff", resonance: "resonance", type: "filt_mode", at: filterAt(v), color: LILAC });
  sweep(g, v, 660, 796, 44, t, false);
  // the contour: Pung's envelope, live, on the engine's own times and curves
  g.envelope(806, 34, 150, 69, { attack: "env_attack", decay: "env_decay", sustain: "env_sustain", release: "env_release",
    curves: contourCurves(v), color: LILAC });
  encoderRow(g, v, seg);
}

push.theme({ ground: NIGHT, panel: WELL, ink: INK, dim: LEG, rule: RULE, faint: GRID, accent: LILAC, knob: "ring" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  segments: [
    { id: "vco1", label: "VCO 1", rect: [4, 22, 646, 35], keys: ["wave1", "div1a", "div1b", "oct1", "lvl1_osc", "lvl1_sub1", "lvl1_sub2"] },
    { id: "vco2", label: "VCO 2", rect: [4, 68, 646, 35], keys: ["wave2", "div2a", "div2b", "oct2", "lvl2_osc", "lvl2_sub1", "lvl2_sub2"] },
    { id: "filter", label: "Filter", rect: [654, 22, 148, 81], keys: ["cutoff", "resonance", "filt_mode", "filt_env", "volume"] },
    { id: "contour", label: "Contour", rect: [806, 22, 150, 81], keys: ["env_attack", "env_decay", "env_sustain", "env_release"] }
  ],
  pages: [
    { label: "Levels", keys: ["lvl1_osc", "lvl1_sub1", "lvl1_sub2", "lvl2_osc", "lvl2_sub1", "lvl2_sub2", "cutoff", "volume"] },
    { label: "Ratios", keys: ["wave1", "oct1", "div1a", "div1b", "wave2", "oct2", "div2a", "div2b"] },
    { label: "Filter / Env", keys: ["cutoff", "resonance", "filt_mode", "filt_env", "env_attack", "env_decay", "env_sustain", "env_release"] }
  ],
  extra_keys: ["wave1", "oct1", "div1a", "div1b", "lvl1_osc", "lvl1_sub1", "lvl1_sub2", "wave2", "oct2", "div2a", "div2b",
    "lvl2_osc", "lvl2_sub1", "lvl2_sub2", "cutoff", "resonance", "filt_mode", "filt_env", "env_attack", "env_decay", "env_sustain",
    "env_release", "volume"],
  live_keys: ["env_stage", "env_level"],
  screen: panel
});

// ---- the band screens: the night, a heading per part ------------------------------------------------
function bandGround(g, key, heads) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, NIGHT);
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      g.fill(h[0], 0, h[1], 12, WELL);
      g.text(h[0] + 6, 9, h[2], h[3], -1);
    }
  });
}

// ---- OSCILLATORS: one page per VCO, its wave and its partials, large --------------------------------
var BX0 = 500, BX1 = 864, BAX = axis(BX0, BX1);
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "VCO 1", keys: ["wave1", "div1a", "div1b", "oct1", "lvl1_osc", "lvl1_sub1", "lvl1_sub2"] },
    { label: "VCO 2", keys: ["wave2", "div2a", "div2b", "oct2", "lvl2_osc", "lvl2_sub1", "lvl2_sub2"] }
  ],
  screen: function (g, v) {
    var o = (v.$page || 0) === 1 ? 1 : 0, V = VCO[o], t = v.$touched || "", col = COL[o], i;
    bandGround(g, "osc|" + o, [[0, 476, "VCO " + (o + 1) + "  THE WAVE IT PUTS OUT", col], [480, 472, "ITS PARTIALS, FROM THE KEY", col]]);
    // which notes it plays, at the heading's right
    g.text(470, 9, "PLAYS VOICES " + (V.voices[0] + 1) + " AND " + (V.voices[1] + 1), LEG, 1);
    // the wave: three periods of the core, the component under the finger alone
    var mid = 49, touched = -1;
    for (i = 0; i < 3; i++) if (t === V.lvl[i] || (i && t === V.div[i - 1])) touched = i;
    g.fill(8, mid, 460, 1, GRID);
    for (i = 1; i < 3; i++) g.fill(8 + 460 * i / 3, 18, 1, 62, GRID); // the core's periods
    var W = wavePts(v, o, 8, 468, mid, 30, 3, undefined, 2);
    if (W.silent) g.text(238, mid - 6, "ALL THREE LEVELS AT 0: SILENT", DIM, 0);
    else {
      if (touched >= 0) g.poly(wavePts(v, o, 8, 468, mid, 30, 3, touched, 2).pts, 2, "slot");
      g.poly(W.pts, 2.5, t === V.wave ? "slot" : known(v, V.wave) ? col : DIM);
    }
    // the partials: the core and both taps at their ratio of the key, as loud as the engine makes them
    for (var oc = -2; oc <= 5; oc++) {
      var x = Math.round(BAX(oc * 12));
      g.fill(x, 16, 1, 58, oc === 0 ? RULE : GRID);
      g.text(x, 84, oc === 0 ? "KEY" : (oc > 0 ? "+" : "") + oc, oc === 0 ? INK : DIM, 0);
    }
    g.text(BX1 + 10, 84, "OCT", DIM, -1);
    g.fill(BX0 - 8, 74, BX1 - BX0 + 16, 1, RULE);
    var touch = {};
    for (i = 0; i < 3; i++) touch[i] = t === V.lvl[i] || (i > 0 && t === V.div[i - 1]) || (i === 0 && t === V.oct);
    drawPartials(g, v, o, BAX, 73, 54, -1, touch);
    // each tap in words: its ratio, its interval, what 1/sqrt(ratio) leaves of its level
    var P = partials(v, o);
    for (i = 1; i < 3; i++) {
      var y = 23 + (i - 1) * 31, d = P[i].div, hot = t === V.div[i - 1] || t === V.lvl[i];
      g.text(946, y, "SUB " + i + "  " + ratioOf(d), hot ? "slot" : INK, 1);
      g.text(946, y + 10, d ? INTERVAL[d] + (TAP_UP ? " UP" : " DOWN") : "THE CORE'S PITCH", hot ? "slot" : LEG, 1);
      g.text(946, y + 20, "LEVEL x" + (1 / Math.sqrt(DIV[d])).toFixed(2), DIM, 1);
    }
  }
});

// ---- FILTER / ENV: the one filter, and the one contour that moves it and the level -------------------
push.compartment({
  id: "filter", label: "Filter / Env",
  pages: [{ label: "Filter / Env", keys: ["cutoff", "resonance", "filt_mode", "filt_env", "env_attack", "env_decay", "env_sustain", "env_release"] }],
  screen: function (g, v) {
    var t = v.$touched || "";
    bandGround(g, "flt", [[0, 476, "FILTER  12 DB STATE VARIABLE", LILAC], [480, 472, "ONE CONTOUR: THE LEVEL AND THE CUTOFF", LILAC]]);
    g.filter(0, 12, 476, 74, { cutoff: "cutoff", resonance: "resonance", type: "filt_mode", at: filterAt(v), color: LILAC });
    // the coefficient's stop: neither the knob nor the contour takes the cutoff past it
    var xs = Math.round(6 + 464 * Math.log(FC_MAX / 20) / Math.log(1000));
    for (var y = 18; y < 80; y += 6) g.fill(xs, y, 1, 3, LEG);
    g.text(xs + 5, 24, "STOP " + (FC_MAX / 1000).toFixed(1) + "K", LEG, -1);
    sweep(g, v, 6, 470, 20, t, true);
    g.envelope(480, 12, 472, 74, { attack: "env_attack", decay: "env_decay", sustain: "env_sustain", release: "env_release",
      curves: contourCurves(v), labels: true, color: LILAC });
  }
});

// ---- VOICES: the module's own live state -----------------------------------------------------------
push.compartment({
  id: "voices", label: "Voices",
  pages: [{ label: "Voices", keys: ["env_stage", "env_level", "pressure", "voices", "ready"] }],
  live_keys: ["env_stage", "env_level", "pressure"],
  screen: function (g, v) {
    bandGround(g, "voices", [[0, 236, "THE CONTOUR NOW", LILAC], [240, 116, "PRESSURE", LILAC], [360, 592, "THE FOUR VOICES AND THE VCO EACH PLAYS", LILAC]]);
    var s = voiceState(v), st = known(v, "env_stage") ? idx(v, "env_stage", 5, 0) : -1, lvl = raw(v, "env_level", 0), i;
    // the contour's stage, lit, and its level
    for (i = 0; i < 5; i++) {
      var bx = 8 + i * 45, on = i === st;
      g.fill(bx, 22, 41, 16, on ? LILAC : WELL);
      g.text(bx + 20, 33, STAGES[i].substr(0, i === 0 ? 4 : 3), on ? "#000000" : DIM, 0);
    }
    g.fill(8, 50, 221, 6, WELL);
    if (st > 0) g.fill(8, 50, Math.max(2, 221 * clamp(lvl, 0, 1)), 6, LILAC);
    g.text(8, 72, st < 0 ? "--" : "LEVEL " + Math.round(lvl * 100) + "%", st > 0 ? INK : DIM, -1);
    g.text(229, 72, known(v, "ready") && raw(v, "ready", 1) < 0.5 ? "STARTING" : "", DIM, 1);
    // pressure: it stretches the release
    var pr = clamp(raw(v, "pressure", 0), 0, 1), rel = DEC_S[idx(v, "env_release", 7, 3)];
    g.fill(248, 22, 6, 50, WELL);
    if (pr > 0) g.fill(248, 72 - 50 * pr, 6, 50 * pr, LILAC);
    g.text(262, 32, Math.round(pr * 100) + "%", INK, -1);
    g.text(262, 50, "RELEASE", LEG, -1);
    g.text(262, 62, "x" + (1 + 3 * pr).toFixed(1), pr > 0 ? INK : LEG, -1);
    g.text(262, 74, known(v, "env_release") ? secs(rel * (1 + 3 * pr)).join(" ") : "", DIM, -1);
    // the voices: 1 and 2 play VCO 2, 3 and 4 VCO 1; lit while their note sounds
    for (i = 0; i < 4; i++) {
      var o = i < 2 ? 1 : 0, x = 368 + i * 146, lit = voiceLit(s, i), col = COL[o];
      g.fill(x, 20, 138, 44, lit ? mix(col, NIGHT, 0.62) : WELL);
      g.fill(x, 20, 3, 44, col);
      g.text(x + 12, 32, "VOICE " + (i + 1), lit ? INK : LEG, -1);
      g.value(x + 12, 54, "VCO " + (o + 1), lit ? col : mix(col, NIGHT, 0.45), -1);
      if (lit) g.fill(x + 12, 58, Math.max(2, 118 * clamp(lvl, 0, 1)), 3, col);
      if (voiceNewest(s, i)) g.text(x + 130, 32, "NEWEST", INK, 1);
    }
    g.text(368, 78, "A NOTE TAKES THE NEXT VOICE; ALL FOUR RETIRE WHEN THE CONTOUR GOES IDLE", DIM, -1, 576);
    if (s && s.stage > 0 && !s.ok) g.text(946, 9, "FOLLOWING FROM THE NEXT SILENCE", LEG, 1);
  }
});
