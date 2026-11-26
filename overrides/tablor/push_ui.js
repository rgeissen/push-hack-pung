// Tablor on the Push: two wavetable oscillators.
//
// Tablor is built around one idea: the wavetable, and where in it the sound
// is. The module publishes a digest of each loaded table (wtN_shape: 24
// frames of 64 samples, "<frames>,<samples>,<data>", one character a
// sample), so its pictures show the real table, never a stand-in:
//
//   THE WATERFALL  every frame of the table, back to front, as Tablor's own
//                  web panel draws it; the frame Position plays, in yellow,
//                  between the two frames either side of it
//   THE WAVE       that frame as it is played: bent (phase distortion) and
//                  formant-shifted by the engine's own law (gin's distort)
//   THE RAIL       Position on its knob's scale, and where a mod envelope
//                  pointed at it sweeps it
//
// Then the filter and its envelope, the mixer (sub, noise), the two spare
// envelopes and where they point. Colours from Tablor's web panel: a
// near-black ground, boxed panels with lighter title bars, the table in
// green, the played frame in yellow, the knobs' value arcs in amber.

var BG = "#0e1013", PANEL = "#191b20", BAR = "#23262c", EDGE = "#2e323a", TXT = "#c3c8d1", DIM = "#767c88";
var ACC = "#d2884f", ACC_DK = "#8a5a37", WAVE = "#4fd06a", HI = "#e8e04a", KNOB = "#0a0b0d";
var MODC = "#3cc8e6", MOD_DK = "#1f5f6c"; // the modulation colour (Pung's), and its trail

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function hot(v, k) { return v.$touched === k; }
// where the sound has a key now (v[k].now: Tablor's live_mod, the newest
// voice's), 0..1 of its range; null when nothing moves it
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? clamp(v[k].now, 0, 1) : null; }
function moved(v, k) { var n = nowOf(v, k); return n !== null && Math.abs(n - fr(v, k, 0)) > 0.004; }
// the key's raw value as the sound has it (lo..hi: its range), the knob's when nothing moves it
function numNow(v, k, d, lo, hi) { var n = nowOf(v, k); return n === null ? num(v, k, d) : lo + n * (hi - lo); }
function anyHot(v, ks) { for (var i = 0; i < ks.length; i++) if (v.$touched === ks[i]) return true; return false; }
function hex2(n) { var s = Math.round(clamp(n, 0, 255)).toString(16); return s.length < 2 ? "0" + s : s; }
function mix(a, b, t) {
  var pa = [parseInt(a.substr(1, 2), 16), parseInt(a.substr(3, 2), 16), parseInt(a.substr(5, 2), 16)];
  var pb = [parseInt(b.substr(1, 2), 16), parseInt(b.substr(3, 2), 16), parseInt(b.substr(5, 2), 16)];
  return "#" + hex2(pa[0] + (pb[0] - pa[0]) * t) + hex2(pa[1] + (pb[1] - pa[1]) * t) + hex2(pa[2] + (pb[2] - pa[2]) * t);
}
var memo = {}, memoN = 0;
function cached(key, make) { if (!(key in memo)) { if (++memoN > 120) { memo = {}; memoN = 1; } memo[key] = make(); } return memo[key]; }

// ---- the engine's laws (src/dsp/param_map.h, src/ported/wt_oscillator.h) -----------------
function pot01(x) { return clamp(x / 127, 0, 1); }
function potBi(x) { return clamp((x - 64) / 63, -1, 1); }
function attackSecs(x) { var f = pot01(x); return 0.0005 + 10 * f * f * f * f * f; }
function envSecs(x) { return Math.pow(10, pot01(x) * 4 - 3); }
function noteHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
// where the cutoff really stands on Pung's axis (three decades from 20 Hz)
function fltAtRaw(x) { return clamp(Math.log(noteHz(8 + pot01(x) * 127) / 20) / Math.LN10 / 3, 0, 1); }
function fltAt(v) { return fltAtRaw(numNow(v, "flt_freq", 127, 0, 127)); } // as the sound has it
// the filter picture at the sound's cutoff (at: above): the knob's place kept,
// marked at the foot, the way from it to the sound's in the modulation colour
function fltKnobMark(g, v, x, y, w, h) {
  if (!moved(v, "flt_freq")) return;
  var xk = x + w * fltAtRaw(num(v, "flt_freq", 127)), xn = x + w * fltAt(v), yb = y + h - 2;
  g.fill(Math.round(xk), yb - 6, 2, 7, TXT);
  g.fill(Math.min(xk, xn), yb - 1, Math.abs(xn - xk), 2, MOD_DK);
  g.dot(xn, yb, 3.2, MODC);
}
function secText(s) { return s < 1 ? Math.round(s * 1000) + " MS" : s.toFixed(s < 10 ? 2 : 1) + " S"; }

push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null) return null;
    return s.role === "attack" ? attackSecs(s.raw) : envSecs(s.raw);
  });
});

// the digest: "<frames>,<samples>,<data>", 64 levels over -1..1
var KQ = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_", LUT = [];
for (var q0 = 0; q0 < 128; q0++) LUT.push(0);
for (var q1 = 0; q1 < KQ.length; q1++) LUT[KQ.charCodeAt(q1)] = q1 / 63 * 2 - 1;
var lastShape = ["", "", ""], lastTable = [null, null, null];
function table(v, o) {
  var s = known(v, "wt" + o + "_shape") ? String(v["wt" + o + "_shape"].value || "") : "";
  if (s === lastShape[o]) return lastTable[o];
  lastShape[o] = s; lastTable[o] = null;
  var c1 = s.indexOf(","), c2 = s.indexOf(",", c1 + 1);
  if (c1 < 0 || c2 < 0) return null;
  var nf = parseInt(s.substring(0, c1), 10), ns = parseInt(s.substring(c1 + 1, c2), 10), d0 = c2 + 1;
  if (!(nf > 0) || !(ns > 1) || s.length - d0 < nf * ns) return null;
  var frames = [];
  for (var f = 0; f < nf; f++) {
    var row = [], at = d0 + f * ns;
    for (var i = 0; i < ns; i++) row.push(LUT[s.charCodeAt(at + i) & 127]);
    frames.push(row);
  }
  lastTable[o] = { frames: frames, nf: nf, ns: ns, id: o + "|" + s.length + "|" + s.substr(-40) + "|" + s.substr(s.length >> 1, 40) };
  return lastTable[o];
}
// the frame Position plays: between the two digest frames either side
function frameAt(t, pos) {
  var fp = clamp(pos, 0, 1) * (t.nf - 1), a = Math.floor(fp), b = Math.min(t.nf - 1, a + 1), u = fp - a, out = [];
  for (var i = 0; i < t.ns; i++) out.push(t.frames[a][i] * (1 - u) + t.frames[b][i] * u);
  return out;
}
// gin's bend (phase distortion) and formant, as wt_oscillator.h distort()
function distort(ph, bend, fmul) {
  if (bend > 0) { var add = Math.pow(1 - ph, 8); ph = ph + (1 - add - ph) * bend; }
  else if (bend < 0) { var sub = Math.pow(ph, 8); ph = ph + (sub - ph) * -bend; }
  return Math.min(0.99999, ph * fmul);
}
function sampleAt(fr0, ph) { var n = fr0.length, x = ph * n, i = Math.floor(x) % n, j = (i + 1) % n, u = x - Math.floor(x); return fr0[i] * (1 - u) + fr0[j] * u; }

// ---- the waterfall, the wave, the rail -----------------------------------------------------
// geometry of a waterfall in a box: frame f's baseline and its left shift
function geo(x, y, w, h, nf) {
  return { x: x, y: y, w: w, h: h, nf: nf, amp: h * 0.16, row: function (f) {
    var t = nf > 1 ? f / (nf - 1) : 1;
    return { y: y + h * (0.18 + t * 0.78), xs: x + h * (1 - t) * 0.42, t: t };
  } };
}
function framePts(gm, fr0, f, stride) {
  var r = gm.row(f), pts = [], n = fr0.length, x1 = gm.x + gm.w - (gm.h * 0.42 - (r.xs - gm.x)), st = stride || 1;
  for (var i = 0; i < n; i += st) pts.push(r.xs + (x1 - r.xs) * i / (n - st), r.y - fr0[i] * gm.amp);
  return pts;
}
// the table, kept in the layer: back frames dim, front ones brighter
function drawTable(g, t, x, y, w, h) {
  if (!t) { g.text(x + w / 2, y + h / 2 + 4, "NO TABLE YET", DIM, 0); return; }
  var gm = geo(x, y, w, h, t.nf);
  for (var f = 0; f < t.nf; f++) g.poly(framePts(gm, t.frames[f], f, 2), 1, mix(WAVE, PANEL, 0.82 - 0.62 * gm.row(f).t));
}
function drawPlayed(g, t, pos, x, y, w, h, lit) {
  if (!t) return;
  var gm = geo(x, y, w, h, t.nf), fp = clamp(pos, 0, 1) * (t.nf - 1);
  g.poly(framePts(gm, frameAt(t, pos), fp), 2, lit ? "slot" : HI);
}
function playedWave(t, pos, bend, form, x, y, w, h) {
  return cached("pw|" + t.id + "|" + pos.toFixed(3) + "|" + bend.toFixed(2) + "|" + form.toFixed(2) + "|" + [x, y, w, h].join(","), function () {
    var f0 = frameAt(t, pos), fmul = Math.exp(form * 1.60943791243), pts = [], n = 72;
    for (var i = 0; i <= n; i++) pts.push(x + w * i / n, y + h / 2 - sampleAt(f0, distort(i / n * 0.99999, bend, fmul)) * (h / 2 - 1));
    return pts;
  });
}
// where a mod envelope pointed at a position sweeps it: env * bipolar amount
function sweepOf(v, o) {
  var dst = "WT" + o + " POS", out = [];
  for (var e = 1; e <= 2; e++) {
    var d = txt(v, "me" + e + "_dst"), amt = potBi(num(v, "me" + e + "_amt", 64));
    if (up(d) === dst && Math.abs(amt) > 0.01) out.push([e, amt]);
  }
  return out;
}
function rail(g, v, o, x, y, w, lit) {
  var pos = pot01(num(v, "wt" + o + "_pos", 0));
  g.fill(x, y, w, 1, EDGE);
  var sw = sweepOf(v, o);
  for (var i = 0; i < sw.length; i++) {
    var to = clamp(pos + sw[i][1], 0, 1), a = Math.min(pos, to), b = Math.max(pos, to);
    g.fill(Math.round(x + w * a), y - 1 - i * 3, Math.max(2, Math.round(w * (b - a))), 2, ACC);
    g.dot(x + w * to, y - i * 3, 2.5, ACC);
  }
  if (known(v, "wt" + o + "_pos")) g.fill(Math.round(x + w * pos) - 1, y - 5, 3, 11, lit ? "slot" : HI);
  if (moved(v, "wt" + o + "_pos")) { // where the sound has it now
    var nx = x + w * nowOf(v, "wt" + o + "_pos");
    g.fill(Math.min(x + w * pos, nx), y, Math.abs(nx - x - w * pos), 1, MOD_DK);
    g.dot(nx, y + 0.5, 3.2, MODC);
  }
}
function tableName(v, o) {
  var s = txt(v, "wt" + o + "_select");
  if (/^\d+$/.test(s)) { var p = txt(v, "wt" + o + "_table"); s = p ? p.replace(/^.*\//, "").replace(/\.[^.]*$/, "") : (s === "0" ? "Init" : ""); }
  return up(s || "--");
}

// ---- knobs, the web panel's: a dark cap, the value as an amber arc ---------------------------
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
function knob(g, cx, cy, r, f, ok, on, bipolar, now) {
  g.arc(cx, cy, r + 3, A0, SWEEP, 2, EDGE);
  g.dot(cx, cy, r, KNOB);
  if (!ok) return;
  var a = A0 + SWEEP * f;
  if (bipolar) { var m = A0 + SWEEP / 2; g.arc(cx, cy, r + 3, Math.min(m, a), Math.abs(a - m), 2.5, on ? "slot" : ACC); }
  else if (f > 0.004) g.arc(cx, cy, r + 3, A0, SWEEP * f, 2.5, on ? "slot" : ACC);
  g.line(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, on ? "slot" : TXT);
  if (now === null || now === undefined || Math.abs(now - f) <= 0.004) return;
  var an = A0 + SWEEP * now; // where the sound has it: beside the knob's arc, in the modulation colour
  g.arc(cx, cy, r + 6, A0 + SWEEP * Math.min(f, now), SWEEP * Math.abs(now - f), 1.5, MOD_DK);
  g.dot(cx + Math.cos(an) * (r + 6), cy + Math.sin(an) * (r + 6), 3, MODC);
}
var BIPOLAR = /_(tune|pan|bend|formant)$|^sub_tune$|_amt$/;
// how Tablor's values read, everywhere (push.display): pot positions 0..127
// in the engine's own units (param_map.h)
function hzText(hz) { return hz < 1000 ? [String(Math.round(hz)), "Hz"] : [(hz / 1000).toFixed(hz < 10000 ? 1 : 0), "kHz"]; }
function sText(t) { var ms = t * 1000; return t < 1 ? [ms < 10 ? ms.toFixed(1) : String(Math.round(ms)), "ms"] : [t.toFixed(t < 10 ? 2 : 1), "s"]; }
function readout(k, rawS) {
  var raw = parseFloat(rawS);
  if (isNaN(raw)) return null;
  if (/_tune$/.test(k)) return [(raw > 0 ? "+" : "") + Math.round(raw), "st"];
  if (k === "flt_freq") return hzText(noteHz(8 + pot01(raw) * 127));
  if (/^(vca|flt|me1|me2)_a$/.test(k)) return sText(attackSecs(raw));
  if (/^(vca|flt|me1|me2)_[dr]$/.test(k)) return sText(envSecs(raw));
  if (/_level$/.test(k)) return [String(Math.round(pot01(raw) * pot01(raw) * 100)), "%"]; // levels are squared (potSquared)
  if (/^(vca|flt|me1|me2)_s$/.test(k) || k === "volume") return [String(Math.round(pot01(raw) * 100)), "%"];
  if (/_(pan|bend|formant)$/.test(k) || /_amt$/.test(k) || k === "flt_env") { var b = Math.round(potBi(raw) * 100); return [(b > 0 ? "+" : "") + b, ""]; }
  if (k === "glide") return sText(0.001 * Math.pow(2000, pot01(raw)));
  if (/_detune$/.test(k)) return [String(Math.round(pot01(raw) * 100)), "ct"];
  if (/_spread$/.test(k) || /^flt_(key|vel)$/.test(k) || k === "vca_vel" || k === "flt_res") return [String(Math.round(pot01(raw) * 100)), "%"];
  return null;
}
push.display(function (key, raw) { var r = readout(key, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
function shown(v, k) {
  if (!known(v, k)) return ["--", ""];
  if (/_select$/.test(k)) return [tableName(v, k.charAt(2)).replace(/^AKWP /, "").replace(/^NK - /, ""), ""];
  if (/_pos$/.test(k)) return [String(Math.round(num(v, k, 0))), ""];
  return readout(k, v[k].value) || [txt(v, k), v[k].unit || ""];
}
var COL_W = 120, SHORT = { wt1_select: "TABLE 1", wt1_pos: "POSITION 1", wt1_level: "LEVEL 1", wt2_select: "TABLE 2",
  wt2_pos: "POSITION 2", wt2_level: "LEVEL 2", flt_freq: "CUTOFF", flt_res: "RESONANCE" };
function row(g, v, knobs) {
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    var on = v.$touched === k, x0 = i * 120;
    var sg = !!v.$segmode;
    g.text(x0 + 8, sg ? 114 : 116, SHORT[k] || up(v[k].name || k), on ? "slot" : DIM, -1, COL_W - 16);
    knob(g, x0 + 22, sg ? 127 : 138, sg ? 9 : 12, fr(v, k, 0), known(v, k), on, BIPOLAR.test(k), nowOf(v, k));
    var s = shown(v, k), uw = s[1] ? g.measure(s[1]) + 3 : 0;
    g.value(x0 + 46, sg ? 136 : 146, s[0], on ? "slot" : ACC, -1, 70 - uw);
    if (s[1]) g.text(x0 + 46 + Math.min(70 - uw, g.measure(s[0], "value")) + 3, sg ? 136 : 146, s[1], DIM, -1);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 15, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, DIM, 1);
}

// ---- the front panel --------------------------------------------------------------------------
// OSC 1 over its three encoders, OSC 2 over its three, the filter over its two
var FP = { top: 20, bot: 101 };
function box(g, x, w, title) {
  g.fill(x, FP.top, w, FP.bot - FP.top, PANEL);
  g.fill(x, FP.top, w, 13, BAR);
  g.dot(x + 8, FP.top + 6.5, 2.5, ACC_DK);
  g.text(x + 15, FP.top + 10, title, DIM, -1);
}
function frontGround(g, v, t1, t2, knobs) {
  // the tables are the costly part: the layer depends on nothing else (a page,
  // a segment or the mode must not redraw them)
  var key = "tb|" + (t1 ? t1.id : "-") + "|" + (t2 ? t2.id : "-");
  g.layer(key, function () {
    g.fill(0, 0, 960, 160, BG);
    box(g, 4, 352, "OSC 1"); box(g, 364, 352, "OSC 2"); box(g, 724, 232, "FILTER");
    drawTable(g, t1, 10, FP.top + 16, 224, 62);
    drawTable(g, t2, 370, FP.top + 16, 224, 62);
    g.fill(244, FP.top + 18, 106, 56, BG); g.fill(604, FP.top + 18, 106, 56, BG);
    g.fill(0, 104, 960, 1, EDGE);
  });
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, v.$segmode ? 30 : 44, BAR);
}
function oscFront(g, v, o, x0, t) {
  var p = "wt" + o + "_", pos = pot01(num(v, p + "pos", 0)), lit = anyHot(v, [p + "pos", p + "select"]);
  var name = tableName(v, o), posNow = pot01(numNow(v, p + "pos", 0, 0, 127));
  g.text(x0 + 346, FP.top + 10, name, hot(v, p + "select") ? "slot" : ACC, 1, 260);
  drawPlayed(g, t, posNow, x0 + 6, FP.top + 16, 224, 62, lit);
  rail(g, v, o, x0 + 10, FP.bot - 4, 216, hot(v, p + "pos"));
  // the frame as it is played, bent and formant-shifted, at its level
  var wx = x0 + 244, wy = FP.top + 18, ww = 106, wh = 56;
  if (t) {
    var lv = pot01(numNow(v, p + "level", 100, 0, 127)), a = 0.25 + 0.75 * lv * lv;
    var pts = playedWave(t, posNow, potBi(numNow(v, p + "bend", 64, 0, 127)), potBi(numNow(v, p + "formant", 64, 0, 127)), wx + 4, wy + wh / 2 - (wh / 2 - 3) * a, ww - 8, (wh - 6) * a);
    g.fill(wx + 4, wy + wh / 2, ww - 8, 1, EDGE);
    g.poly(pts, 2, hot(v, p + "level") ? "slot" : (lv > 0.01 ? HI : DIM));
  }
  var uni = Math.round(num(v, p + "uni", 1)), tune = Math.round(num(v, p + "tune", 0));
  var tags = (tune ? (tune > 0 ? "+" : "") + tune + " ST  " : "") + (uni > 1 ? "x" + uni : "");
  if (tags) g.text(wx + ww - 4, wy + wh - 4, tags, DIM, 1);
}
// the active segment, as the web panel would say it (Pung's bar above it):
// its title bar's dot and name lit in the slot colour
function segLit(g, v) {
  if (v.$segmode !== "segment") return;
  var b = { osc1: [4, 352, "OSC 1"], osc2: [364, 352, "OSC 2"], filter: [724, 232, "FILTER"] }[v.$segment];
  if (b) {
    g.dot(b[0] + 8, FP.top + 6.5, 3, "slot");
    g.fill(b[0] + 14, FP.top + 1, g.measure(b[2]) + 4, 11, BAR);
    g.text(b[0] + 15, FP.top + 10, b[2], "slot", -1);
  } else if (v.$segment === "amp") {
    g.text(732, FP.top + 66, "AMP", "slot", -1);
  }
}
function filterFront(g, v) {
  var x = 724, w = 232, ft = txt(v, "flt_type") || "LP 24";
  g.text(x + w - 8, FP.top + 10, up(ft), hot(v, "flt_type") ? "slot" : ACC, 1);
  g.filter(x + 2, FP.top + 13, w - 4, 42, { cutoff: "flt_freq", at: fltAt(v), resonance: "flt_res", type: "flt_type", color: TXT });
  fltKnobMark(g, v, x + 2, FP.top + 13, w - 4, 42);
  g.fill(x + 8, FP.top + 55, w - 16, 1, EDGE);
  g.text(x + 8, FP.top + 66, "AMP", DIM, -1);
  g.envelope(x + 30, FP.top + 56, w - 32, FP.bot - FP.top - 56, { attack: "vca_a", decay: "vca_d", sustain: "vca_s", release: "vca_r", color: TXT });
}

// Pung's default pages in Tablor's colours and knobs
push.theme({ ground: BG, panel: BAR, ink: TXT, dim: DIM, rule: EDGE, accent: ACC, knob: "pointer" });
push.compartment({
  id: "tablor", label: "Tablor", front_panel: true,
  pages: [{ label: "Tablor", keys: ["wt1_select", "wt1_pos", "wt1_level", "wt2_select", "wt2_pos", "wt2_level", "flt_freq", "flt_res"] }],
  extra_keys: ["wt1_shape", "wt2_shape", "wt1_table", "wt2_table", "wt1_bend", "wt1_formant", "wt2_bend", "wt2_formant",
    "wt1_uni", "wt2_uni", "wt1_tune", "wt2_tune", "flt_type", "vca_a", "vca_d", "vca_s", "vca_r",
    "me1_dst", "me1_amt", "me2_dst", "me2_amt"],
  // the panel's boxes under the hands: each oscillator whole, the filter with
  // its envelope, the amp
  segments: [
    { id: "osc1", label: "Osc 1", rect: [4, 20, 352, 81], keys: ["wt1_select", "wt1_pos", "wt1_level", "wt1_tune", "wt1_bend", "wt1_formant", "wt1_uni", "wt1_detune"] },
    { id: "osc2", label: "Osc 2", rect: [364, 20, 352, 81], keys: ["wt2_select", "wt2_pos", "wt2_level", "wt2_tune", "wt2_bend", "wt2_formant", "wt2_uni", "wt2_detune"] },
    { id: "filter", label: "Filter", rect: [724, 20, 232, 55], keys: ["flt_freq", "flt_res", "flt_type", "flt_env", "flt_a", "flt_d", "flt_s", "flt_r"] },
    { id: "amp", label: "Amp", rect: [724, 77, 232, 24], keys: ["vca_a", "vca_d", "vca_s", "vca_r", "vca_vel", "volume"] }
  ],
  draws_segments: true,
  screen: function (g, v) {
    var t1 = table(v, 1), t2 = table(v, 2), knobs = v.$knobs || [];
    frontGround(g, v, t1, t2, knobs);
    g.value(8, 15, "TABLOR", TXT, -1);
    g.text(8 + g.measure("TABLOR", "value") + 10, 14, "2-OSC WAVETABLE", DIM, -1);
    oscFront(g, v, 1, 4, t1);
    oscFront(g, v, 2, 364, t2);
    filterFront(g, v);
    segLit(g, v);
    row(g, v, knobs);
  }
});

// ---- OSC 1, OSC 2: one oscillator across the band ------------------------------------------------
// Osc page: cols 1-2 the table (Table, Position), 3-4 the wave as played
// (Bend, Formant), 5-7 its level, tune and place in the stereo field.
// Unison page: cols 1-3 the voices (Unison, Detune, Spread), 4-8 the table.
function playedBox(g, v, o, t, x, y, w, h) {
  var p = "wt" + o + "_", pos = pot01(numNow(v, p + "pos", 0, 0, 127)), bend = potBi(num(v, p + "bend", 64)), form = potBi(num(v, p + "formant", 64));
  var lit = anyHot(v, [p + "bend", p + "formant"]), bendNow = potBi(numNow(v, p + "bend", 64, 0, 127)), formNow = potBi(numNow(v, p + "formant", 64, 0, 127));
  g.text(x, y + 8, "AS PLAYED", lit ? "slot" : DIM, -1);
  g.text(x + w, y + 8, (Math.abs(bend) > 0.01 ? "BEND " + (bend > 0 ? "+" : "") + Math.round(bend * 100) + "  " : "") +
    (Math.abs(form) > 0.01 ? "FORMANT " + (form > 0 ? "+" : "") + Math.round(form * 100) : ""), lit ? "slot" : DIM, 1);
  if (!t) return;
  g.fill(x, y + 14 + (h - 14) / 2, w, 1, EDGE);
  g.poly(playedWave(t, pos, bendNow, formNow, x, y + 14, w, h - 14), 2, lit ? "slot" : HI);
}
function tableBox(g, v, o, t, x, y, w, h) {
  var p = "wt" + o + "_", pos = pot01(numNow(v, p + "pos", 0, 0, 127));
  g.text(x + 2, y + 8, tableName(v, o), hot(v, p + "select") ? "slot" : ACC, -1, w - 50);
  g.text(x + w, y + 8, "POS " + Math.round(num(v, p + "pos", 0)), hot(v, p + "pos") ? "slot" : DIM, 1);
  drawPlayed(g, t, pos, x, y + 6, w, h - 18, anyHot(v, [p + "pos", p + "select"]));
  rail(g, v, o, x + 4, y + h - 4, w - 8, hot(v, p + "pos"));
}
function unisonBox(g, v, o, x, w, lit) {
  var p = "wt" + o + "_", uni = Math.round(clamp(num(v, p + "uni", 1), 1, 4)), det = pot01(num(v, p + "detune", 0));
  var spr = pot01(num(v, p + "spread", 0)), pan = potBi(numNow(v, p + "pan", 64, 0, 127)), lv = pot01(numNow(v, p + "level", 100, 0, 127));
  var cx = x + w / 2, base = 72, top = 30;
  g.fill(x, base, w, 1, EDGE);
  g.text(x, base + 12, "L", DIM, -1); g.text(x + w, base + 12, "R", DIM, 1);
  g.fill(Math.round(cx), base, 1, 4, DIM);
  for (var i = 0; i < uni; i++) {
    var s = uni > 1 ? i / (uni - 1) * 2 - 1 : 0;   // -1..1 across the stack: detune and stereo place
    var px = clamp(pan + s * spr, -1, 1), bx = Math.round(cx + px * (w / 2 - 8));
    var bh = Math.round((base - top) * (0.25 + 0.75 * lv));
    g.fill(bx - 1, base - bh, 3, bh, lit ? "slot" : (lv > 0.01 ? HI : DIM));
    if (uni > 1) g.text(bx, base - bh - 4, (s > 0 ? "+" : "") + Math.round(s * det * 50) + (i === uni - 1 ? " CT" : ""), DIM, 0);
  }
}
function oscPage(o) {
  var p = "wt" + o + "_";
  return function (g, v) {
    var t = table(v, o);
    g.layer("ob|" + o + "|" + (t ? t.id : "-"), function () { drawTable(g, t, 6, 8, 228, 64); });
    tableBox(g, v, o, t, 6, 2, 228, 84);
    playedBox(g, v, o, t, 252, 2, 220, 80);
    // level (a fader's travel: the knob is squared), tune, pan
    var lv = pot01(num(v, p + "level", 100)), tu = Math.round(num(v, p + "tune", 0)), pan = potBi(num(v, p + "pan", 64));
    var lx = 494;
    g.text(lx, 10, "LEVEL", hot(v, p + "level") ? "slot" : DIM, -1);
    g.fill(lx + 30, 22, 8, 60, BAR);
    g.fill(lx + 30, 22 + Math.round(60 * (1 - lv)), 8, Math.round(60 * lv), hot(v, p + "level") ? "slot" : ACC);
    g.text(lx + 46, 82, Math.round(lv * lv * 100) + "%", DIM, -1);
    if (moved(v, p + "level")) { var ly = 22 + 60 * (1 - nowOf(v, p + "level")); g.fill(lx + 40, Math.min(ly, 22 + 60 * (1 - lv)), 1, Math.abs(60 * (lv - nowOf(v, p + "level"))), MOD_DK); g.dot(lx + 41, ly, 3, MODC); }
    var tx = 614;
    g.text(tx, 10, "TUNE", hot(v, p + "tune") ? "slot" : DIM, -1);
    g.value(tx, 50, (tu > 0 ? "+" : "") + tu, hot(v, p + "tune") ? "slot" : TXT, -1);
    g.text(tx, 66, tu % 12 === 0 && tu ? (tu / 12) + " OCT" : "SEMITONES", DIM, -1);
    var px = 734, pw = 100;
    g.text(px, 10, "PAN", hot(v, p + "pan") ? "slot" : DIM, -1);
    g.fill(px, 50, pw, 2, BAR); g.fill(px + pw / 2, 44, 1, 14, DIM);
    g.fill(Math.round(px + pw / 2 + pan * pw / 2) - 2, 43, 5, 16, hot(v, p + "pan") ? "slot" : ACC);
    if (moved(v, p + "pan")) { var pn = px + pw / 2 + potBi(127 * nowOf(v, p + "pan")) * pw / 2, pk = px + pw / 2 + pan * pw / 2; g.fill(Math.min(pk, pn), 51, Math.abs(pn - pk), 1, MOD_DK); g.dot(pn, 51, 3, MODC); }
    g.text(px, 70, "L", DIM, -1); g.text(px + pw, 70, "R", DIM, 1);
    var uni = Math.round(clamp(num(v, p + "uni", 1), 1, 4));
    g.text(948, 10, "UNISON", DIM, 1);
    g.value(948, 50, "x" + uni, TXT, 1);
  };
}
// the unison voices as they sound: the played frame once a voice, each
// drifting from the centre by its detune over two cycles (unison 4 at a
// detune of 1 semitone: the outer voices half a semitone either side)
function unisonWaves(t, v, o, x, y, w, h) {
  var p = "wt" + o + "_", uni = Math.round(clamp(num(v, p + "uni", 1), 1, 4)), det = pot01(num(v, p + "detune", 0));
  var pos = pot01(numNow(v, p + "pos", 0, 0, 127)), bend = potBi(numNow(v, p + "bend", 64, 0, 127)), form = potBi(numNow(v, p + "formant", 64, 0, 127));
  return cached("uw|" + t.id + "|" + [uni, det.toFixed(2), pos.toFixed(3), bend.toFixed(2), form.toFixed(2), x, y, w, h].join(","), function () {
    var f0 = frameAt(t, pos), fmul = Math.exp(form * 1.60943791243), out = [], cyc = 3, n = 96;
    for (var i = 0; i < uni; i++) {
      var s0 = uni > 1 ? i / (uni - 1) * 2 - 1 : 0, ratio = Math.pow(2, s0 * det / 2 / 12) * (1 + s0 * 0.004), ph0 = i * 0.37, pts = [];
      for (var j = 0; j <= n; j++) {
        var ph = ph0 + cyc * ratio * j / n;
        ph -= Math.floor(ph);
        pts.push(x + w * j / n, y + h / 2 - sampleAt(f0, distort(ph * 0.99999, bend, fmul)) * (h / 2 - 2));
      }
      out.push([Math.abs(s0), pts]);
    }
    return out.sort(function (a, b) { return b[0] - a[0]; });
  });
}
function unisonPage(o) {
  var p = "wt" + o + "_";
  return function (g, v) {
    var t = table(v, o), uni = Math.round(clamp(num(v, p + "uni", 1), 1, 4)), lit = anyHot(v, [p + "uni", p + "detune", p + "spread"]);
    var det = pot01(num(v, p + "detune", 0)), spr = pot01(num(v, p + "spread", 0));
    g.text(8, 10, uni > 1 ? uni + " VOICES" : "ONE VOICE", lit ? "slot" : DIM, -1);
    g.text(350, 10, uni > 1 ? "DETUNE " + det.toFixed(2) + " ST  SPREAD " + Math.round(spr * 100) + "%" : "", lit ? "slot" : DIM, 1);
    unisonBox(g, v, o, 12, 330, lit);
    g.line(368, 4, 368, 84, 1, EDGE);
    g.text(380, 10, tableName(v, o) + "  POS " + Math.round(num(v, p + "pos", 0)), DIM, -1, 500);
    if (!t) { g.text(660, 50, "NO TABLE YET", DIM, 0); return; }
    var ws = unisonWaves(t, v, o, 380, 16, 566, 66);
    g.fill(380, 49, 566, 1, EDGE);
    for (var i = 0; i < ws.length; i++) g.poly(ws[i][1], ws[i][0] < 0.01 ? 2 : 1.5, lit && ws[i][0] < 0.01 ? "slot" : (ws[i][0] < 0.01 ? HI : mix(HI, BG, 0.25 + 0.3 * ws[i][0])));
  };
}
function oscComp(o) {
  var p = "wt" + o + "_";
  return {
    id: "osc" + o, label: "Osc " + o,
    pages: [
      { label: "Osc " + o, keys: [p + "select", p + "pos", p + "bend", p + "formant", p + "level", p + "tune", p + "pan"], screen: oscPage(o) },
      { label: "Unison " + o, keys: [p + "uni", p + "detune", p + "spread"], screen: unisonPage(o) }
    ],
    extra_keys: [p + "shape", p + "table", p + "uni", p + "detune", p + "spread", p + "pan", p + "level", p + "pos", p + "bend", p + "formant", p + "select",
      "me1_dst", "me1_amt", "me2_dst", "me2_amt"]
  };
}
push.compartment(oscComp(1));
push.compartment(oscComp(2));

// ---- MIXER: the four sources, the sub's wave, the noise's colour -----------------------------------
var SUBW = ["Sine", "Triangle", "Saw", "Square", "Pulse", "Pulse Tr"];
function subSample(k, ph) {
  ph -= Math.floor(ph);
  switch (k) {
  case 1: return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
  case 2: return 2 * ph - 1;
  case 3: return ph < 0.5 ? 1 : -1;
  case 4: return ph < 0.25 ? 1 : -1;
  case 5: return ph < 0.25 ? 1 : (ph < 0.5 ? 0 : -1); // pulse tr: a pulse that steps through zero
  }
  return Math.sin(2 * Math.PI * ph);
}
function idxOf(v, k, names) {
  var s = txt(v, k), n = parseInt(s, 10);
  if (!isNaN(n) && String(n) === s) return n;
  for (var i = 0; i < names.length; i++) if (up(names[i]) === up(s)) return i;
  return 0;
}
push.compartment({
  id: "mixer", label: "Mixer",
  pages: [{ label: "Sub & Noise", keys: ["sub_level", "sub_wave", "sub_tune", "noise_level", "noise_type", "volume"] }],
  extra_keys: ["wt1_level", "wt2_level"],
  screen: function (g, v) {
    // the sub over its three knobs: its wave, an octave (or Sub Tune) below
    var sw = idxOf(v, "sub_wave", SUBW), st = Math.round(num(v, "sub_tune", -12)), sl = pot01(numNow(v, "sub_level", 0, 0, 127));
    var sh = anyHot(v, ["sub_level", "sub_wave", "sub_tune"]);
    g.text(8, 10, "SUB  " + up(SUBW[sw] || "") + "  " + (st > 0 ? "+" : "") + st + " ST", sh ? "slot" : DIM, -1);
    g.poly(cached("sub|" + sw + "|" + sl.toFixed(2), function () {
      var p = [], a = 6 + 28 * sl;
      for (var i = 0; i <= 96; i++) p.push(10 + 330 * i / 96, 48 - subSample(sw, i / 96 * 2) * a);
      return p;
    }), 2, sh ? "slot" : (sl > 0.005 ? HI : DIM));
    // the noise over its two: white is flat, pink falls 3 dB an octave
    var nl = pot01(numNow(v, "noise_level", 0, 0, 127)), pink = /pink/i.test(txt(v, "noise_type")) || txt(v, "noise_type") === "1";
    var nh = anyHot(v, ["noise_level", "noise_type"]);
    g.text(368, 10, "NOISE  " + (pink ? "PINK" : "WHITE"), nh ? "slot" : DIM, -1);
    g.poly(cached("nz|" + pink + "|" + nl.toFixed(2), function () {
      var p = [], last = 0;
      for (var i = 0; i <= 90; i++) {
        var r = Math.sin(i * 78.233 + 1.7) * 43758.5453; r = (r - Math.floor(r)) * 2 - 1;
        last = pink ? last * 0.7 + r * 0.55 : r;
        p.push(366 + 220 * i / 90, 48 - last * (4 + 26 * nl));
      }
      return p;
    }), 1.5, nh ? "slot" : (nl > 0.005 ? TXT : DIM));
    // what each source puts in (levels are squared: the knob is a fader)
    g.text(608, 10, "THE MIX", DIM, -1);
    g.mix(604, 12, 344, 74, ["wt1_level", "wt2_level", "sub_level", "noise_level"], { color: ACC });
  }
});

// ---- FILTER: the response and its envelope ---------------------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["flt_freq", "flt_res", "flt_type", "flt_env", "flt_key", "flt_vel"] },
    { label: "Filter Env", keys: ["flt_a", "flt_d", "flt_s", "flt_r"] }
  ],
  screen: function (g, v) {
    var amt = potBi(num(v, "flt_env", 64)), lit = anyHot(v, ["flt_freq", "flt_res", "flt_type"]);
    g.text(8, 10, up(txt(v, "flt_type") || "LP 24"), lit ? "slot" : ACC, -1);
    var hz = noteHz(8 + pot01(num(v, "flt_freq", 127)) * 127);
    g.text(470, 10, (hz < 1000 ? Math.round(hz) + " HZ" : (hz / 1000).toFixed(1) + " KHZ") + (Math.abs(amt) > 0.01 ? "  ENV " + (amt > 0 ? "+" : "") + Math.round(amt * 100) : ""), DIM, 1);
    g.filter(2, 12, 472, 74, { cutoff: "flt_freq", at: fltAt(v), resonance: "flt_res", type: "flt_type", color: TXT });
    fltKnobMark(g, v, 2, 12, 472, 74);
    g.line(480, 4, 480, 84, 1, EDGE);
    g.text(490, 10, "FILTER ENVELOPE", anyHot(v, ["flt_a", "flt_d", "flt_s", "flt_r"]) ? TXT : DIM, -1);
    g.envelope(484, 12, 464, 74, { attack: "flt_a", decay: "flt_d", sustain: "flt_s", release: "flt_r", labels: true, color: TXT });
  }
});

// ---- AMP: Pung's envelope -------------------------------------------------------------------------
push.compartment({
  id: "amp", label: "Amp",
  pages: [{ label: "Amp", keys: ["vca_a", "vca_d", "vca_s", "vca_r", "vca_vel"] }]
});

// ---- MOD ENVS: two spare envelopes, each pointed at one place ------------------------------------
function modEnvBand(g, v) {
  var page = v.$page || 0, e = page + 1, p = "me" + e + "_";
  g.text(8, 10, "ENV " + e, anyHot(v, [p + "a", p + "d", p + "s", p + "r"]) ? TXT : DIM, -1);
  g.envelope(2, 12, 472, 74, { attack: p + "a", decay: p + "d", sustain: p + "s", release: p + "r", labels: true, color: TXT });
  g.line(480, 4, 480, 84, 1, EDGE);
  // both routes: where each points, how far, which way
  for (var i = 1; i <= 2; i++) {
    var q = "me" + i + "_", d = txt(v, q + "dst") || "None", amt = potBi(num(v, q + "amt", 64)), y = 22 + (i - 1) * 36;
    var off = /^none$/i.test(d) || d === "0" || Math.abs(amt) < 0.01, on = anyHot(v, [q + "dst", q + "amt"]);
    g.text(492, y, "ENV " + i, i === e ? TXT : DIM, -1);
    g.value(546, y + 2, off ? "--" : up(d), on ? "slot" : (off ? DIM : TXT), -1, 200);
    var bx = 760, bw = 180, c = bx + bw / 2;
    g.fill(bx, y - 4, bw, 2, EDGE); g.fill(Math.round(c), y - 8, 1, 10, DIM);
    if (!off) {
      var len = Math.round(amt * bw / 2);
      g.fill(len > 0 ? c : c + len, y - 6, Math.abs(len), 6, on ? "slot" : ACC);
    }
    g.text(bx + bw, y + 14, off ? "" : (amt > 0 ? "+" : "") + Math.round(amt * 100) + (amt > 0 ? " UP" : " DOWN"), DIM, 1);
  }
}
push.compartment({
  id: "modenv", label: "Mod Envs",
  pages: [
    { label: "Env 1", keys: ["me1_a", "me1_d", "me1_s", "me1_r", "me1_dst", "me1_amt"] },
    { label: "Env 2", keys: ["me2_a", "me2_d", "me2_s", "me2_r", "me2_dst", "me2_amt"] }
  ],
  extra_keys: ["me1_dst", "me1_amt", "me2_dst", "me2_amt"],
  screen: modEnvBand
});

push.compartment({
  id: "voice", label: "Voice",
  pages: [{ label: "Voice", keys: ["voice_mode", "voices", "glide", "glide_mode", "legato", "pb_range"] }]
});
