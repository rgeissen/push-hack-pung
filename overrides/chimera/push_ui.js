// Schimera (a physically modelled human voice: lungs, vocal folds, a simulated airway; a port
// of the CHIMERA engine) on Push. An overlay shipped with Pung (the module ships no push_ui.js).
//
// Every sound the module makes is air through a tract: the folds open and close (the source),
// the tube from the glottis to the lips shapes it (its resonances, the formants), the velum
// opens the nose. The screens draw that chain as a phonetics plate would, from the engine's
// own model (engine/crates/chimera/src/anatomy/human.rs, sources/glottis.rs,
// voice/human_voice.rs):
//
//   PANEL    the voice (mode, sound, the body between man, woman and child), the folds' area
//            through three cycles as the source model shapes them (open quotient, skew, the
//            closure's sharpness, fry's double pulse, the leak of a breathy chink), the tract
//            in section exactly as the model computes it from the knobs (jaw, tongue body and
//            tip, lips, velum, larynx, epiglottis; a child's smaller, a woman's shorter
//            pharynx), the same air unrolled as a tube from the glottis to the lips, and the
//            formants it makes. Singing and speaking, the words move the mouth (the module
//            says where, live_mod): the lyrics with the syllable or word sounding lit, the
//            tract as the voice has it (at rest while it is silent), the body's vowels
//   MOUTH    the tract large, its tube, and the vowel chart: the body's thirteen vowels where
//            the engine measured them, and this mouth among them
//   TONE     the source large: the folds' cycles, how open, how pressed, how much air leaks
//   the rest Pung's own pages, in the plate's colours
//
// The formants: the tract's area function (the model's own rays through its own outline, here
// at a third of its density) through a lossy tube, calibrated to the formants the engine itself
// measured at its thirteen calibrated vowels for each body (vowelTargets.generated.json): at a
// vowel they are the engine's, between vowels they move as the tube does.

// ---- values ------------------------------------------------------------------------------
function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function int(v, k, d) { return Math.round(num(v, k, d)); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
// where the voice has a knob now (v[k].now: the module's live_mod, 0..1 of the range), null when
// nothing moves it; the modulation colour (Pung's) and its trail
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? clamp(v[k].now, 0, 1) : null; }
var MODC = "#3cc8e6", MOD_DK = "#1f5f6c";
function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

// ---- the knobs as the engine reads them (params_gen.rs DRIVES: lo + v (hi - lo)) ---------------
var ARTIC = { tongue_x: ["tbX", 1.0, 4.8], tongue_y: ["tbY", 4.8, 9.2], jaw: ["jaw", 0.0, 2.4], lips: ["lipAp", -0.3, 2.2],
  round: ["lipWidth", 1.0, 0.0], protrude: ["lipProt", -0.1, 1.4], nasal: ["velum", -0.25, 1.2], larynx: ["larynx", -1.5, 1.5],
  twang: ["epilarynx", 0.0, 1.0], false_folds: ["ventricular", 0.0, 1.0], tip_curl: ["ttCurl", 0.0, 1.0], tongue_root: ["root", -0.9, 0.9],
  lateral: ["lateral", 0.0, 1.0] };
var KNOB_DEF = { tongue_x: 0.5, tongue_y: 0.5, jaw: 0.25, lips: 0.4, round: 0.5, protrude: 0.2, nasal: 0.07, larynx: 0.5, twang: 0,
  false_folds: 0, tip_curl: 0, tongue_root: 0.5, lateral: 0 };
var NEUTRAL = { jaw: 0.6, tbX: 2.9, tbY: 6.85, ttX: 6.45, ttY: 7.3, ttCurl: 0, root: 0, lipAp: 0.7, lipProt: 0.2, lipWidth: 0.5, labiodental: 0,
  velum: -0.15, larynx: 0, epilarynx: 0, ventricular: 0, lateral: 0, dorsum: 0 };
// the thirteen vowels (Pick Vowel's order), each body's calibrated posture and measured formants
var VOWELS = ["AH", "EE", "IH", "AY", "EH", "AE", "AW", "OH", "UH", "OO", "BOOK", "ER", "SCHWA"];
var VKEYS = ["tbX", "tbY", "jaw", "lipAp", "lipProt", "lipWidth", "root", "larynx", "ttCurl", "ttX", "ttY"];
var VPOSE = {"male":[[2.022,5.692,1.685,2,0,1,-0.354,0.217,0,5.519,5.466],[3.683,7.739,0.413,1.046,0,1,0.514,0.798,0,6.545,7.288],[3.637,7.419,0.575,1.154,0,1,-0.001,0.357,0,6.472,7.032],[3.6,7.236,0.745,1.315,0,1,0.269,0.506,0,6.396,6.817],[3.403,6.556,1.041,1.519,0,1,0.048,0.379,0,6.218,6.32],[3.373,6.016,1.516,1.875,0,1,-0.16,0.328,0.002,6.002,5.726],[1.501,6.115,1.182,0.844,0.31,0.539,-0.328,0.175,0,5.588,6.043],[1.519,6.592,0.668,0.405,0.597,0.027,0.227,0.061,0,5.801,6.66],[1.955,6.23,1.022,0.76,0,0.607,0.212,0.053,0.002,5.791,6.227],[2.419,7.428,0.203,0.291,1.4,0.065,0.402,0.252,0,6.239,7.369],[2.317,7.139,0.516,0.44,1.228,0.199,0.478,0.425,0,6.098,6.987],[2.727,7.285,0.976,0.654,0.592,0.347,-0.9,-0.921,1,5.642,8.632],[2.944,6.685,0.505,0.323,0.352,0.533,0.421,0.149,0,6.29,6.837]],"female":[[1.847,5.832,1.682,2,0,1,-0.665,0.523,0,5.468,5.517],[3.754,7.647,0.459,1.092,0,1,0.295,1.016,0,6.55,7.215],[3.647,7.421,0.567,1.147,0,1,0.077,0.196,0,6.478,7.039],[3.593,7.368,0.8,1.369,0,1,0.08,0.853,0,6.372,6.815],[3.1,6.484,1.181,1.642,0,1,-0.105,0.773,0,6.068,6.173],[3.712,6.328,1.483,1.851,0,1,-0.094,0.854,0,6.119,5.86],[1.397,6.219,1.256,0.904,0.281,0.59,-0.619,0.254,0,5.525,6.015],[1.827,7.11,0.966,0.288,1.4,0.304,0.221,0.46,0,5.776,6.579],[1.87,6.262,1.067,0.985,0,1,0.196,0.087,0.002,5.747,6.198],[2.243,7.381,0.266,0.187,1.4,0.301,0.205,0.24,0,6.164,7.296],[2.314,7.268,0.573,0.371,1.4,0.301,0.255,0.382,0,6.076,6.981],[2.581,7.338,0.694,0.657,0.59,0.349,-0.9,-0.832,1,5.71,8.898],[2.996,6.841,0.818,0.599,0.351,0.544,0.279,0.14,0,6.186,6.614]],"child":[[1.651,6.308,1.905,2,0.361,0.952,-0.9,-0.353,0,5.302,5.497],[3.719,7.754,0.096,0.386,0.004,0.655,0.095,-0.001,0.001,6.664,7.581],[3.381,7.692,0.489,0.366,0.001,0.55,0.005,-0.025,0,6.427,7.204],[3.477,7.552,0.676,0.717,0.351,0.55,-0.219,-0.14,0,6.386,6.989],[3.101,6.836,1.071,1.177,0.355,0.548,-0.339,-0.168,0,6.115,6.391],[3.496,6.678,1.367,1.601,0.356,0.548,-0.534,-0.23,0,6.106,6.08],[1.2,6.764,1.408,0.762,1.086,0.461,-0.561,-0.049,0,5.4,6.076],[1.814,7.259,0.78,0.131,1.241,0.301,-0.566,-0.209,0,5.847,6.794],[1.88,7.088,0.861,0.569,0.369,0.516,-0.189,-0.157,0,5.835,6.664],[2.324,7.563,0.162,0.301,0.637,0.054,-0.646,-0.327,0,6.224,7.453],[2.338,7.482,0.498,0.335,0.6,0.279,-0.498,-0.249,0,6.111,7.122],[1.859,7,0.05,0.12,1.4,0.214,-0.9,-1.288,1,5.722,9.357],[2.698,7.382,0.804,0.569,0.359,0.535,-0.503,-0.379,0,6.102,6.817]]};
var VFORM = {"male":[[731,1337,2541],[337,2225,2901],[424,2031,2603],[465,1995,2591],[570,1768,2551],[623,1714,2597],[625,1010,2443],[496,915,2308],[622,1212,2394],[378,997,2238],[467,1126,2284],[463,1362,1820],[503,1456,2344]],"female":[[841,1552,2868],[428,2658,3227],[480,2355,2964],[521,2394,3008],[710,2025,2989],[657,2214,3157],[722,1162,2739],[545,1051,2630],[749,1447,2754],[457,1107,2657],[516,1229,2700],[510,1567,2172],[587,1744,2740]],"child":[[979,1710,3265],[453,3101,3632],[512,2551,3417],[564,2651,3387],[745,2275,3404],[718,2467,3493],[784,1232,3114],[595,1140,3066],[748,1565,3212],[495,1344,3081],[568,1490,3162],[553,1671,2450],[653,1934,3163]]};
var BODY_NAMES = ["male", "female", "child"];
var SWEEP_PATH = [9, 7, 0, 4, 1]; // the Vowel knob runs Oo, Oh, Ah, Eh, Ee (SWEEP_PATH)
function weights(female, child) { var f = clamp(female, 0, 1), c = clamp(child, 0, 1); return [(1 - c) * (1 - f), (1 - c) * f, c]; }
// the bodies (BODY_MALE, _FEMALE, _CHILD), blended as BodyMix::body: scale, pharynx, tongue radius, lip width
var BODIES = [[1.0, 1.0, 2.25, 4.6], [0.9, 0.88, 2.2, 4.4], [0.74, 0.8, 2.15, 4.0]];
function bodyOf(w) { var b = [0, 0, 0, 0]; for (var i = 0; i < 3; i++) for (var j = 0; j < 4; j++) b[j] += w[i] * BODIES[i][j]; return { scale: b[0], pharynx: b[1], tongueR: b[2], lipW: b[3] }; }
// a vowel's posture for a body mix, as knob values (posture(): the articulators back through DRIVES)
function vowelKnobs(i, w) {
  var o = {}, keys = { tbX: "tongue_x", tbY: "tongue_y", jaw: "jaw", lipAp: "lips", lipProt: "protrude", lipWidth: "round", root: "tongue_root", larynx: "larynx", ttCurl: "tip_curl" };
  for (var k in keys) {
    var x = 0, j = VKEYS.indexOf(k);
    for (var b = 0; b < 3; b++) x += w[b] * VPOSE[BODY_NAMES[b]][i][j];
    var d = ARTIC[keys[k]];
    o[keys[k]] = clamp((x - d[1]) / (d[2] - d[1]), 0, 1);
  }
  return o;
}
function restTip(jaw, tbX, tbY) {
  var cx = -2.5, cy = 10.5, px = 6.45, py = 7.35, ang = -jaw / 9.84, dx = px - cx, dy = py - cy;
  return [cx + dx * Math.cos(ang) - dy * Math.sin(ang) + 0.3 * (tbX - NEUTRAL.tbX), cy + dx * Math.sin(ang) + dy * Math.cos(ang) + 0.35 * (tbY - NEUTRAL.tbY)];
}
// the articulators from knob values (0..1 each), the tip resting as the engine's tip_free has it
function articOf(kv) {
  var a = {}, k;
  for (k in NEUTRAL) a[k] = NEUTRAL[k];
  for (k in ARTIC) { var d = ARTIC[k], x = kv[k] === undefined ? KNOB_DEF[k] : kv[k]; a[d[0]] = d[1] + clamp(x, 0, 1) * (d[2] - d[1]); }
  var t = restTip(a.jaw, a.tbX, a.tbY);
  a.ttX = t[0]; a.ttY = t[1];
  return a;
}

// ---- the tract, as HumanVocalTract::compute draws and measures it (points as [x, y], cm) ---------
var DEG = Math.PI / 180;
function P2(x, y) { return [x, y]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function scl(a, s) { return [a[0] * s, a[1] * s]; }
function dist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
function vlerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function polar(c, r, ang) { return [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]; }
function rotAbout(p, c, ang) { var s = Math.sin(ang), co = Math.cos(ang), dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co]; }
function bez3(p0, p1, p2, p3, n) {
  var o = [];
  for (var i = 0; i < n; i++) { var t = i / (n - 1), u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; o.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]); }
  return o;
}
function bez2(p0, p1, p2, n) { var o = []; for (var i = 0; i < n; i++) { var t = i / (n - 1), u = 1 - t; o.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); } return o; }
function catmull(pts, per) {
  var o = [];
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (var k = 0; k < per; k++) {
      var t = k / per, t2 = t * t, t3 = t2 * t;
      o.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  o.push(pts[pts.length - 1]);
  return o;
}
// where segment i of a polyline crosses the ray o + t d (NaN: it does not), as geom.rs crossing_t
function crossT(ox, oy, dx, dy, ax, ay, bx, by) {
  var sa = dx * (ay - oy) - dy * (ax - ox) >= 0, sb = dx * (by - oy) - dy * (bx - ox) >= 0;
  if (sa === sb) return NaN;
  var ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-15) return NaN;
  return ((ax - ox) * ey - (ay - oy) * ex) / den;
}
var HT = [], HE = [], SIDE = [];
// all crossings of the ray o + t d (t in [t0, t1]) with a polyline into HT, and whether each
// leaves the tissue for the air into HE (ray_crossings); their count. Each point's side of the
// ray is worked out once, and only a segment whose ends lie on two sides is solved.
function hits(o, d, pl, t0, t1) {
  var n = 0, ox = o[0], oy = o[1], dx = d[0], dy = d[1], m = pl.length, i;
  for (i = 0; i < m; i++) SIDE[i] = dx * (pl[i][1] - oy) - dy * (pl[i][0] - ox) >= 0;
  for (i = 0; i + 1 < m; i++) {
    if (SIDE[i] === SIDE[i + 1]) continue;
    var ax = pl[i][0], ay = pl[i][1], ex = pl[i + 1][0] - ax, ey = pl[i + 1][1] - ay, den = dx * ey - dy * ex;
    if (den < 1e-15 && den > -1e-15) continue;
    var t = ((ax - ox) * ey - (ay - oy) * ex) / den;
    if (t >= t0 && t <= t1) { HT[n] = t; HE[n] = dx * ey - dy * ex < 0; n++; }
  }
  return n;
}
function cumOf(pl) { var c = [0]; for (var i = 1; i < pl.length; i++) c.push(c[i - 1] + dist(pl[i], pl[i - 1])); return c; }
function projectOn(pl, cum, p) {
  var best = Infinity, bs = 0, sign = 1;
  for (var i = 0; i + 1 < pl.length; i++) {
    var ax = pl[i][0], ay = pl[i][1], ex = pl[i + 1][0] - ax, ey = pl[i + 1][1] - ay, l2 = ex * ex + ey * ey;
    if (l2 < 1e-12) continue;
    var t = clamp(((p[0] - ax) * ex + (p[1] - ay) * ey) / l2, 0, 1), qx = ax + ex * t - p[0], qy = ay + ey * t - p[1], d = qx * qx + qy * qy;
    if (d < best) { best = d; bs = cum[i] + t * Math.sqrt(l2); sign = ex * (p[1] - ay) - ey * (p[0] - ax) < 0 ? 1 : -1; }
  }
  best = Math.sqrt(best);
  return { s: bs, dist: best, signed: sign * best };
}
function pointAlong(pl, cum, s) {
  var i = 0;
  while (i + 2 < cum.length && cum[i + 1] < s) i++;
  var l = cum[i + 1] - cum[i];
  return vlerp(pl[i], pl[i + 1], l > 1e-9 ? clamp((s - cum[i]) / l, 0, 1) : 0);
}
function signedGap(pl, p) {
  var best = Infinity, inside = false, px = p[0], py = p[1];
  for (var i = 0; i + 1 < pl.length; i++) {
    var ax = pl[i][0], ay = pl[i][1], bx = pl[i + 1][0], by = pl[i + 1][1], ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    var t = l2 > 1e-12 ? clamp(((px - ax) * ex + (py - ay) * ey) / l2, 0, 1) : 0, dx = px - ax - ex * t, dy = py - ay - ey * t, d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
    if ((ay > py) !== (by > py) && px < ax + (py - ay) * ex / ey) inside = !inside;
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}
function closest(pl, cum, pts) { var d = Infinity; for (var i = 0; i < pts.length; i++) d = Math.min(d, projectOn(pl, cum, pts[i]).signed); return d; }

// a body's fixed walls (the pharynx's back, the palate, the nasal cavity), kept
var FIXED = {};
function fixedOf(body) {
  var key = body.scale.toFixed(4) + "|" + body.pharynx.toFixed(4);
  if (FIXED[key]) return FIXED[key];
  var k = body.scale, ph = body.pharynx;
  var P = function (x, y) { return [(x > 0.5 ? 0.5 + (x - 0.5) * 0.86 : x) * k, (y < 7 ? 7 - (7 - y) * ph : y) * k]; };
  var pns = P(1.0, 9.75);
  return (FIXED[key] = { P: P, pns: pns,
    pharWall: catmull([P(-1.0, -1.5), P(-1.1, 1.5), P(-1.2, 3.6), P(-1.3, 5.6), P(-1.38, 7.5), P(-1.33, 8.9), P(-1.05, 10.1), P(-0.45, 10.9), P(0.4, 11.3)], 4),
    palate: catmull([P(1.0, 9.6), P(1.8, 9.92), P(2.7, 10.18), P(3.6, 10.3), P(4.4, 10.25), P(5.1, 10.05), P(5.7, 9.72), P(6.15, 9.36), P(6.5, 9.05), P(6.78, 8.7), P(6.98, 8.3), P(7.12, 7.95)], 3),
    nasal: catmull([pns, P(2.5, 10.8), P(5.0, 11.2), P(7.3, 10.6), P(8.0, 10.1)], 4),
    condyle: P(-2.5, 10.5), polarC: P(2.6, 6.95), polarC2: P(5.0, 6.85) });
}
// compute(): the outlines; with `measure`, the area function too (rays at a third of the
// model's density: 6 across the pharynx, 13 through the mouth, 3 at the lips)
function tractOf(a, body) {
  var F = fixedOf(body), P = F.P, k = body.scale, ph = body.pharynx, i;
  var lar = a.larynx * k, glottis = add(P(0, 0), [0, lar]);
  var phi = -clamp(a.jaw, -0.2, 3.0) * k / dist(F.condyle, P(6.95, 7.75));
  var J = function (x, y) { return rotAbout(P(x, y), F.condyle, phi); };
  var vOpen = clamp(a.velum / 1.2, 0, 1), vAng = (194 + 46 * vOpen) * DEG, vLen = 2.8 * k, velOral = [], velNasal = [];
  var nrm = [-Math.sin(vAng), Math.cos(vAng)];
  for (i = 0; i <= 10; i++) {
    var s = i / 10, sag = Math.sin(s * Math.PI) * k * (0.3 * vOpen - 0.12), c = add(polar(F.pns, vLen * s, vAng), [0, -sag]), th = (0.48 - 0.2 * s) * k;
    velOral.push(add(c, scl(nrm, th))); velNasal.push(sub(c, scl(nrm, th)));
  }
  for (i = 0; i < velOral.length; i++) { var u = i / 10 / 0.35; if (u < 1) velOral[i] = vlerp(velOral[i], F.palate[0], (1 - u) * (1 - u)); }
  var outer = [], uvY = velOral[10][1] - 0.3 * k, pw = F.pharWall;
  for (i = 0; i < pw.length; i++) {
    if (pw[i][1] < uvY) { outer.push(pw[i]); continue; }
    if (i > 0) outer.push(vlerp(pw[i - 1], pw[i], clamp((uvY - pw[i - 1][1]) / Math.max(1e-9, pw[i][1] - pw[i - 1][1]), 0, 1)));
    break;
  }
  var roofStart = outer.length;
  for (i = 10; i >= 0; i--) outer.push(velOral[i]);
  for (i = 1; i < F.palate.length; i++) outer.push(F.palate[i]);
  var roofEnd = outer.length - 1;
  var prot = clamp(a.lipProt, -0.2, 1.6) * k, spreadW = clamp(a.lipWidth, 0, 1), yMid = (7.85 - 0.3 * a.jaw) * k, ap = a.lipAp * k;
  var lipFrontX = P(8.15 + 0.12 * (1 - spreadW), 0)[0] + prot * 0.95;
  var ulEdge = [lipFrontX - 0.15 * k, yMid + ap * 0.35], llEdge = [lipFrontX - 0.25 * k, yMid - ap * 0.65], ulBase = P(7.32, 8.35);
  var upperLipIn = bez3(ulBase, add(ulBase, [0.3 * k + prot * 0.4, 0.05 * k]), add(ulEdge, [-0.35 * k, 0.12 * k]), ulEdge, 7);
  for (i = 0; i < 7; i++) outer.push(upperLipIn[i]);
  var r = body.tongueR * k, b = P(a.tbX, a.tbY), b0 = P(NEUTRAL.tbX, NEUTRAL.tbY);
  var vall = add(P(0.75, 3.3), [0.45 * (b[0] - b0[0]) + a.root * k, 0.3 * (b[1] - b0[1]) + 0.55 * lar]);
  var epiBase = add(P(0.3, 2.4), [0, lar]), epiTip = add(P(0.0, 4.5), [0.35 * (vall[0] - 0.75 * k), lar * 0.8 + 0.15 * (b[1] - b0[1])]);
  var thB = 200 * DEG, pB = polar(b, r, thB), tanB = [Math.sin(thB), -Math.cos(thB)], hR = dist(vall, pB) / 3;
  var root = bez3(vall, add(vall, [0.08 * k, hR]), sub(pB, scl(tanB, hR)), pB, 9);
  var tip = P(a.ttX, a.ttY), dt = dist(tip, b);
  if (dt < r * 1.05) tip = add(b, scl(sub(tip, b), r * 1.05 / Math.max(dt, 1e-9)));
  var d0 = dist(b, tip), thF = d0 > r * 1.0001 ? Math.atan2(tip[1] - b[1], tip[0] - b[0]) + Math.acos(r / d0) : Math.atan2(tip[1] - b[1], tip[0] - b[0]);
  while (thF > thB) thF -= 2 * Math.PI;
  while (thF < thB - 2 * Math.PI) thF += 2 * Math.PI;
  var arc = [];
  for (i = 0; i < 32; i++) arc.push(polar(b, r, thB + (thF - thB) * i / 31));
  var pF = arc[31], tanF = [Math.sin(thF), -Math.cos(thF)], bl = dist(pF, tip), curl = clamp(a.ttCurl, 0, 1);
  var blade = bez2(pF, add(add(pF, scl(tanF, bl * 0.5)), [0, (0.18 + 0.5 * curl) * k]), tip, 7);
  var fren = J(5.7, 6.15), under = bez2(tip, add(tip, [-0.3 * k - curl * 0.4 * k, -0.6 * k]), fren, 6);
  var floor = [fren, J(6.2, 6.25), J(6.45, 6.55)], lowerTeeth = [J(6.45, 6.55), J(6.72, 7.15), J(6.95, 7.75), J(7.12, 7.45)], llBase = J(7.12, 7.45);
  var lowerLipIn = bez3(llBase, add(llBase, [0.25 * k + prot * 0.3, -0.05 * k]), add(llEdge, [-0.3 * k, -0.12 * k]), llEdge, 7);
  var T = { k: k, glottis: glottis, outer: outer, tip: tip, epiLen: 2.4 * k * ph,
    tongue: root.concat(arc.slice(1), blade.slice(1), under.slice(1), floor.slice(1)), velum: velNasal.concat(velOral.slice().reverse()),
    upperLip: upperLipIn.concat(bez3(ulEdge, add(ulEdge, [0.25 * k, 0.35 * k]), P(8.3, 9.6), P(7.9, 10.4), 6).slice(1)),
    lowerLip: lowerLipIn.concat(bez3(llEdge, add(llEdge, [0.3 * k, -0.4 * k]), J(8.1, 6.3), J(7.6, 5.6), 6).slice(1)),
    lowerTeeth: lowerTeeth, upperTeeth: [P(6.15, 9.36), P(6.78, 8.7), P(7.12, 7.95), P(7.38, 8.7), P(7.4, 9.3)],
    jawBone: [J(7.25, 6.75), J(7.4, 5.4), J(6.4, 4.6), J(3.5, 4.4), J(1.2, 5.2), J(-0.6, 7.4), J(-1.9, 9.6)], epiglottis: [epiBase, epiTip, vall],
    pharWall: F.pharWall, palate: F.palate, nasal: F.nasal, port: Math.max(0, a.velum) * k * k };
  // what the rays need: the inner wall they meet (epiglottis, the root above it, the tongue,
  // the floor, teeth, lip), the roof, the tongue's outline, the lips' edges
  var inner = [epiBase, epiTip], yRoot = epiTip[1] + 0.05 * k, back = root.concat(arc.slice(1)), start = -1;
  for (i = 0; i < back.length; i++) if (back[i][1] > yRoot) { start = i; break; }
  if (start < 0) start = back.length - 1;
  else if (start > 0) inner.push(vlerp(back[start - 1], back[start], clamp((yRoot - back[start - 1][1]) / Math.max(1e-9, back[start][1] - back[start - 1][1]), 0, 1)));
  var app = function (pts, skip) { for (var j = skip ? 1 : 0; j < pts.length; j++) inner.push(pts[j]); };
  if (start < root.length) { for (i = start; i < root.length; i++) inner.push(root[i]); app(arc, true); } else app(arc.slice(start - root.length + 1), true);
  app(blade, true); app(under, true); app(floor, true); app(lowerTeeth, true); app(lowerLipIn, false);
  var roof = outer.slice(roofStart, roofEnd + 1), cum = cumOf(roof), incisor = F.palate[F.palate.length - 1];
  T.m = { inner: inner, roof: roof, cum: cum, outline: root.concat(arc.slice(1), blade.slice(1), under.slice(1), floor.slice(1), [root[0]]),
    tipPts: blade.slice(2).concat(under.slice(1, 3)), arc: arc, ulEdge: ulEdge, llEdge: llEdge, ap: ap, spreadW: spreadW, incisor: incisor,
    yEpiTop: glottis[1] + 2.4 * k * ph, F: F, lipW: (1.1 + (body.lipW - 1.1) * spreadW) * k };
  return T;
}
// one ray of the grid (the model's rays at a third of its density: 6 across the pharynx, 13
// through the mouth, 3 at the lips), measured from the outer wall back to the inner one
var NRAYS = 22;
function rayOf(T, i) {
  var M = T.m, k = T.k, F = M.F;
  if (i < 6) return [[4.6 * k, lerp(M.yEpiTop + 0.12 * k, F.polarC[1], i / 6)], [-1, 0], 9 * k, false, 1];
  if (i < 19) {
    var t = (i - 6) / 12, ang = lerp(180, 36, t) * DEG, w = t < 0.45 ? 0 : (t - 0.45) / 0.55;
    return [vlerp(F.polarC, F.polarC2, w * w * (3 - 2 * w)), [Math.cos(ang), Math.sin(ang)], 8 * k, true, ang <= 150 * DEG ? 2 : 1];
  }
  var xS = M.incisor[0] + 0.03 * k, xE = Math.max(xS + 0.3 * k, Math.min(M.ulEdge[0], M.llEdge[0]) - 0.04 * k);
  return [[lerp(xS, xE, (i - 19) / 2), 4 * k], [0, 1], 8 * k, false, 3];
}
function sortHits(n) { for (var j = 1; j < n; j++) { var tt = HT[j], ee = HE[j], m = j - 1; while (m >= 0 && HT[m] > tt) { HT[m + 1] = HT[m]; HE[m + 1] = HE[m]; m--; } HT[m + 1] = tt; HE[m + 1] = ee; } }
function measureRay(T, ray) {
  var o = ray[0], d = ray[1], k = T.k, inner = T.m.inner, n = hits(o, d, T.outer, 0, ray[2]), tOut = Infinity, tIn, j;
  if (!n) return null;
  for (j = 0; j < n; j++) if (HT[j] < tOut) tOut = HT[j];
  if (ray[3]) {
    n = hits(o, d, inner, 0, tOut + 1.5 * k); sortHits(n);
    var jj = 0;
    if (n && HE[0]) { tIn = HT[0]; jj = 1; }
    else {
      var nb = hits(o, [-d[0], -d[1]], inner, 0, 2.5 * k), tb = 2.5 * k;
      for (j = 0; j < nb; j++) tb = Math.min(tb, HT[j]);
      tIn = -tb; n = hits(o, d, inner, 0, tOut + 1.5 * k); sortHits(n);
    }
    var tissue = 0;
    while (jj < n && HT[jj] < tOut) { if (HE[jj]) { jj++; continue; } tissue += Math.min(jj + 1 < n ? HT[jj + 1] : tOut + 1.5 * k, tOut) - HT[jj]; jj += 2; }
    tIn += tissue;
  } else {
    n = hits(o, d, inner, 0, tOut + 1.5 * k); tIn = -Infinity;
    for (j = 0; j < n; j++) if (HT[j] > tIn) tIn = HT[j];
    if (tIn === -Infinity) tIn = Math.max(0, tOut - 3.5 * k);
  }
  var pi = add(o, scl(d, Math.min(tIn, tOut))), po = add(o, scl(d, tOut)), g = { inner: pi, outer: po, mid: vlerp(pi, po, 0.5), d: Math.max(0, tOut - tIn), region: ray[4], area: 0, s: 0 };
  var M = T.m;
  if (ray[4] === 3 && o[0] > M.llEdge[0]) { var face = Math.min(M.llEdge[1] - (o[0] - M.llEdge[0]) * 4 / 3, po[1]); g.inner = [o[0], face]; g.mid = vlerp(g.inner, po, 0.5); g.d = po[1] - face; }
  return g;
}
// the tongue against the roof: near it the gap is the distance to the tongue's own surface
function contactOf(T, g, half) {
  var M = T.m, k = T.k, pr = projectOn(M.roof, M.cum, g.outer), onRoof = 1 - smoothstep(0.15 * k, 0.25 * k, pr.dist), roofLen = M.cum[M.cum.length - 1];
  if (onRoof <= 0) return;
  var dc = signedGap(M.outline, g.outer);
  if (dc - half - pr.dist <= 0.6 * k) for (var q = -1; q <= 1; q += 0.5) if (q) dc = Math.min(dc, signedGap(M.outline, pointAlong(M.roof, M.cum, clamp(pr.s + q * half, 0, roofLen))));
  var wgt = (1 - smoothstep(0.15 * k, 0.6 * k, dc)) * onRoof, cap = (1 - smoothstep(0.45 * k, 0.6 * k, dc)) * onRoof;
  if (wgt <= 0 && cap <= 0) return;
  var dp = Math.max(0, dc), dm = g.d + (Math.min(g.d, dp) - g.d) * cap;
  g.d = dm + (dp - dm) * wgt;
}
// the lips' contact and the areas (alpha d^beta by region, the lips an elliptical slit), the
// spikes clipped, the lateral channel, each sample's distance from the glottis
function areasOf(a, T, grid) {
  var M = T.m, k = T.k, edgeX = Math.min(M.ulEdge[0], M.llEdge[0]), i, g;
  for (i = 0; i < grid.length; i++) {
    g = grid[i];
    if (g.region === 3 && g.mid[0] >= M.incisor[0]) { var dxl = Math.max(0, edgeX - g.mid[0]); g.d = Math.min(g.d, Math.max(0, M.ap + dxl * dxl / (1.2 * k))); }
    if (g.region === 1) g.area = 2.0 * Math.pow(g.d, 1.4);
    else if (g.region === 2) g.area = lerp(2.6 * Math.pow(g.d, 1.4), 1.6 * Math.pow(g.d, 1.4), smoothstep(0, 0.4 * k, g.mid[0] - T.tip[0]));
    else g.area = lerp(2.0 * Math.pow(g.d, 1.4), Math.PI / 4 * g.d * M.lipW, clamp((g.mid[0] - M.incisor[0]) / (0.45 * k), 0, 1));
  }
  for (i = 1; i < grid.length - 1; i++) { var lim = 1.35 * Math.max(grid[i - 1].area, grid[i + 1].area); if (grid[i].area > lim) grid[i].area = lim; }
  if (a.lateral > 0) for (i = 0; i < grid.length; i++) if (grid[i].region >= 2 && dist(grid[i].mid, T.tip) < 1.4 * k) grid[i].area = Math.max(grid[i].area, a.lateral * 0.35 * k * k);
  var sAcc = T.epiLen;
  for (i = 0; i < grid.length; i++) { if (i > 0) sAcc += dist(grid[i].mid, grid[i - 1].mid); grid[i].s = sAcc; }
}
// the whole measurement as a job a frame advances by a few milliseconds (Pung's draw has 8 to
// 14): the rays, the contacts, the areas, the tube's response a band of frequencies at a time
function jobStep(J, deadline) {
  var i;
  while (Date.now() < deadline || J.st === 0) {
    if (J.st === 0) { J.T = tractOf(J.a, J.body); J.grid = []; J.ri = 0; J.st = 1; continue; }
    if (J.st === 1) {
      if (J.ri < NRAYS) { var g = measureRay(J.T, rayOf(J.T, J.ri++)); if (g) J.grid.push(g); continue; }
      var M = J.T.m, k = J.T.k;
      var near = Math.min(closest(M.roof, M.cum, M.tipPts), closest(M.roof, M.cum, M.arc));
      J.half = 0.1 * k * (1 + (1 - smoothstep(-0.06 * k, 0, near)));
      // a ray's gap moves only where the tongue comes within 6 mm of the roof (dc <= 0.6 k)
      J.ci = near > 0.62 * k ? J.grid.length : 0; J.st = 2; continue;
    }
    if (J.st === 2) { if (J.ci < J.grid.length) { contactOf(J.T, J.grid[J.ci++], J.half); continue; } areasOf(J.a, J.T, J.grid); J.af = areaFn(J.a, J.T, J.grid); J.tube = tubeStart(J.af); J.st = 3; continue; }
    if (J.st === 3) { if (!tubeSome(J.tube, 6)) continue; J.st = 4; continue; }
    if (J.st === 4) { var R = tubeEnd(J.tube); J.res = { af: J.af, mags: R.mags, raw: R.peaks, len: R.len, f: calibrate(R.peaks, J.kv, J.w) }; J.st = 5; }
    break;
  }
  return J.res || null;
}
var JOB = null, DONE = {}, NDONE = 0;
// the formants of a posture: at once when known, else the job advanced (null: not yet)
function formantsFor(a, body, w, kv, key, budgetMs) {
  if (DONE[key]) return DONE[key];
  if (!JOB || JOB.key !== key) JOB = { key: key, a: a, body: body, w: w, kv: kv, st: 0 };
  var r = jobStep(JOB, Date.now() + budgetMs);
  if (r) { if (++NDONE > 24) { DONE = {}; NDONE = 1; } DONE[key] = r; JOB = null; }
  return r;
}
// the epilarynx's area at u (0..1 along it), epilarynx_area
function epiArea(a, u, k) {
  var vent = 0.95 * (1 - 0.75 * clamp(a.ventricular, 0, 1)), top = lerp(1.9, 0.35, clamp(a.epilarynx, 0, 1));
  var f = function (x) { return x < 0.3 ? 1.3 : x < 0.5 ? vent : Math.min(lerp(1.2, top, (x - 0.5) / 0.5), top); };
  var area = f(u);
  if (Math.abs(u - 0.3) < 0.03) area = lerp(f(0.27), f(0.33), (u - 0.27) / 0.06);
  if (Math.abs(u - 0.5) < 0.03) area = lerp(f(0.47), f(0.53), (u - 0.47) / 0.06);
  return area * k * k;
}
// the area function: [s (cm from the glottis), area (cm^2)] from the glottis to the lips
function areaFn(a, T, grid) {
  var out = [], i;
  for (i = 0; i <= 4; i++) out.push([T.epiLen * i / 4, epiArea(a, i / 4, T.k)]);
  for (i = 0; i < grid.length; i++) if (grid[i].s > out[out.length - 1][0] + 1e-3) out.push([grid[i].s, Math.max(1e-3, grid[i].area)]);
  return out;
}
// the tube's resonances: N uniform sections (each the harmonic mean of the area over it, as the
// engine resamples), reflections between them, a closed glottis and the lips' radiation; the
// transfer's magnitude, dB, at each of the frequencies, and its peaks
var NSEC = 18, FMAX = 5000, FSTEP = 50;
function tubeStart(af) {
  var L = af[af.length - 1][0], A = [], i, j;
  for (i = 0; i < NSEC; i++) {
    var s0 = L * i / NSEC, s1 = L * (i + 1) / NSEC, inv = 0, n = 6;
    for (j = 0; j < n; j++) {
      var s = s0 + (s1 - s0) * (j + 0.5) / n, q = 1;
      while (q < af.length - 1 && af[q][0] < s) q++;
      var p = af[q - 1], c = af[q];
      inv += 1 / Math.max(p[1] + (c[1] - p[1]) * clamp((s - p[0]) / Math.max(1e-6, c[0] - p[0]), 0, 1), 1e-3);
    }
    A.push(n / inv);
  }
  var rk = [];
  for (i = 0; i < NSEC - 1; i++) rk.push((A[i + 1] - A[i]) / (A[i + 1] + A[i]));
  rk.push(0.82); // the lips: radiation, nearly a pressure release (r_L)
  return { rk: rk, fs: 35000 * NSEC / (2 * L), len: L, f: 0, mags: [] };
}
// n more frequencies of D(z) = [1, -r_G] prod [[1, -r_k], [-r_k z^-1, z^-1]] [1, 0]; true when done
function tubeSome(tb, n) {
  var rk = tb.rk, rG = 0.97;
  for (var c = 0; c < n && tb.f <= FMAX; c++, tb.f += FSTEP) {
    var w = 2 * Math.PI * tb.f / tb.fs, zr = Math.cos(w), zi = -Math.sin(w), pr = 1, pi = 0, qr = -rG, qi = 0;
    for (var i = 0; i < NSEC; i++) {
      var r = rk[i], qzr = qr * zr - qi * zi, qzi = qr * zi + qi * zr;
      var npr = pr - r * qzr, npi = pi - r * qzi;
      qr = qzr - r * pr; qi = qzi - r * pi; pr = npr; pi = npi;
    }
    tb.mags.push(-10 * Math.log(pr * pr + pi * pi) / Math.LN10);
  }
  return tb.f > FMAX;
}
function tubeEnd(tb) {
  var m = tb.mags, peaks = [];
  for (var i = 2; i < m.length - 1; i++) if (m[i] > m[i - 1] && m[i] >= m[i + 1]) {
    var dd = m[i - 1] - 2 * m[i] + m[i + 1];
    peaks.push(i * FSTEP + (dd ? 0.5 * (m[i - 1] - m[i + 1]) / dd * FSTEP : 0));
  }
  return { mags: m, peaks: peaks, len: tb.len };
}
// the calibration: the engine's measured formants over the tube's at each calibrated vowel
// (per body: F1, F2, F3), worked out from this very model (CAL, below)
var CAL = null;
function calibrate(peaks, kv, w) {
  if (!CAL) return peaks.slice(0, 3);
  var ks = ["tongue_x", "tongue_y", "jaw", "lips", "round", "protrude", "tongue_root", "larynx"], out = [], tot = 0, rat = [0, 0, 0], i, b, j;
  for (b = 0; b < 3; b++) {
    if (w[b] <= 0) continue;
    var wsum = 0, r = [0, 0, 0];
    for (i = 0; i < 13; i++) {
      var vk = CAL_KNOBS[b][i], d2 = 0;
      for (j = 0; j < ks.length; j++) { var dd = (kv[ks[j]] === undefined ? KNOB_DEF[ks[j]] : kv[ks[j]]) - vk[j]; d2 += dd * dd; }
      var wt = 1 / (d2 * d2 + 1e-6);
      wsum += wt;
      for (j = 0; j < 3; j++) r[j] += wt * Math.log(CAL[b][i][j]);
    }
    for (j = 0; j < 3; j++) rat[j] += w[b] * r[j] / wsum;
    tot += w[b];
  }
  for (j = 0; j < 3; j++) out.push(peaks[j] ? peaks[j] * Math.exp(rat[j] / tot) : 0);
  return out;
}
// CAL[body][vowel]: the engine's measured F1..F3 over this tube's, at the vowel's knob posture (CAL_KNOBS: tongue x, y, jaw, lips, round, protrude, root, larynx)
CAL = [[[0.9117,0.8953,0.946],[1.2019,0.9403,0.9685],[1.0963,0.932,0.9476],[1.0595,0.9378,0.9442],[1.0107,0.9236,0.9358],[0.9662,0.9081,0.9372],[0.9149,0.9243,0.9762],[1.0291,0.974,0.9834],[0.9437,0.9251,0.9689],[1.2445,1.009,0.9373],[1.083,0.9627,0.9496],[1.0617,0.9001,0.911],[1.0455,0.9399,0.9483]],[[0.8971,0.8836,0.9445],[1.1076,0.9342,0.9447],[1.0757,0.9299,0.9265],[1.0433,0.9331,0.9278],[0.9632,0.9048,0.9206],[0.9787,0.9135,0.9169],[0.8956,0.9077,0.9748],[1.0079,0.9716,0.938],[0.9272,0.9054,0.9615],[1.126,0.9941,0.928],[1.0542,0.9675,0.931],[1.0227,0.9652,0.9041],[1.0108,0.927,0.9291]],[[0.9095,0.8866,0.9561],[1.157,0.9405,0.9233],[1.1171,0.9441,0.9105],[1.0662,0.929,0.9073],[0.99,0.9179,0.9149],[0.9995,0.9187,0.9068],[0.9179,0.9485,0.9903],[1.0197,1.0214,0.9259],[0.9787,0.9495,0.9383],[1.1475,1.0708,0.9208],[1.0769,1.0042,0.9216],[1.1059,1.1575,0.8364],[1.0259,0.9315,0.917]]];
var CAL_KNOBS = [[[0.2689,0.2027,0.7021,0.92,0,0.0667,0.3033,0.5723],[0.7061,0.668,0.1721,0.5384,0,0.0667,0.7856,0.766],[0.6939,0.5952,0.2396,0.5816,0,0.0667,0.4994,0.619],[0.6842,0.5536,0.3104,0.646,0,0.0667,0.6494,0.6687],[0.6324,0.3991,0.4337,0.7276,0,0.0667,0.5267,0.6263],[0.6245,0.2764,0.6317,0.87,0,0.0667,0.4111,0.6093],[0.1318,0.2989,0.4925,0.4576,0.461,0.2733,0.3178,0.5583],[0.1366,0.4073,0.2783,0.282,0.973,0.4647,0.6261,0.5203],[0.2513,0.325,0.4258,0.424,0.393,0.0667,0.6178,0.5177],[0.3734,0.5973,0.0846,0.2364,0.935,1,0.7233,0.584],[0.3466,0.5316,0.215,0.296,0.801,0.8853,0.7656,0.6417],[0.4545,0.5648,0.4067,0.3816,0.653,0.4613,0,0.193],[0.5116,0.4284,0.2104,0.2492,0.467,0.3013,0.7339,0.5497]],[[0.2229,0.2345,0.7008,0.92,0,0.0667,0.1306,0.6743],[0.7247,0.647,0.1913,0.5568,0,0.0667,0.6639,0.8387],[0.6966,0.5957,0.2362,0.5788,0,0.0667,0.5428,0.5653],[0.6824,0.5836,0.3333,0.6676,0,0.0667,0.5444,0.7843],[0.5526,0.3827,0.4921,0.7768,0,0.0667,0.4417,0.7577],[0.7137,0.3473,0.6179,0.8604,0,0.0667,0.4478,0.7847],[0.1045,0.3225,0.5233,0.4816,0.41,0.254,0.1561,0.5847],[0.2176,0.525,0.4025,0.2352,0.696,1,0.6228,0.6533],[0.2289,0.3323,0.4446,0.514,0,0.0667,0.6089,0.529],[0.3271,0.5866,0.1108,0.1948,0.699,1,0.6139,0.58],[0.3458,0.5609,0.2387,0.2684,0.699,1,0.6417,0.6273],[0.4161,0.5768,0.2892,0.3828,0.651,0.46,0,0.2227],[0.5253,0.4639,0.3408,0.3596,0.456,0.3007,0.655,0.5467]],[[0.1713,0.3427,0.7938,0.92,0.048,0.3073,0,0.3823],[0.7155,0.6714,0.04,0.2744,0.345,0.0693,0.5528,0.4997],[0.6266,0.6573,0.2038,0.2664,0.45,0.0673,0.5028,0.4917],[0.6518,0.6255,0.2817,0.4068,0.45,0.3007,0.3783,0.4533],[0.5529,0.4627,0.4462,0.5908,0.452,0.3033,0.3117,0.444],[0.6568,0.4268,0.5696,0.7604,0.452,0.304,0.2033,0.4233],[0.0526,0.4464,0.5867,0.4248,0.539,0.7907,0.1883,0.4837],[0.2142,0.5589,0.325,0.1724,0.699,0.894,0.1856,0.4303],[0.2316,0.52,0.3588,0.3476,0.484,0.3127,0.395,0.4477],[0.3484,0.628,0.0675,0.2404,0.946,0.4913,0.1411,0.391],[0.3521,0.6095,0.2075,0.254,0.721,0.4667,0.2233,0.417],[0.2261,0.5,0.0208,0.168,0.786,1,0,0.0707],[0.4468,0.5868,0.335,0.3476,0.465,0.306,0.2206,0.3737]]];

// ---- the voice's source (sources/glottis.rs, voice/human_voice.rs apply_source) -----------------
function sourceOf(v) {
  var p = num(v, "breath", 8), ten = num(v, "pressed", 0.5), br = num(v, "breathy", 0.15), bright = num(v, "bright", 0.25);
  var rough = num(v, "rough", 0.1), fry = num(v, "fry", 0), voiced = int(v, "whisper", 0) === 0;
  var effort = clamp((Math.abs(p) - 3) / 10, 0, 1), b = bright - 0.25;
  var oq = clamp(0.78 - 0.36 * ten - 0.18 * (effort - 0.5), 0.25, 0.98);
  if (fry > 0) oq = oq * (1 - fry) + 0.28 * fry;
  return { voiced: voiced, effort: effort, oq: oq, skew: clamp(0.56 + 0.16 * ten + 0.2 * b, 0.3, 0.9),
    sharp: clamp(0.4 * ten + 1.375 * Math.max(0, ten - 0.6) + 0.8 * b, 0, 1), fry: fry,
    amp: voiced ? 0.17 * (0.45 + 0.75 * effort) : 0, statics: (voiced ? 0.1 * br * br : 0.2 + 0.1 * br) + 0.008 + 0.03 * br,
    jitter: 0.0021 + 0.0245 * rough, shimmer: 0.02 + 0.22 * rough, dip: rough > 0.5 ? (rough - 0.5) * 1.4 : 0, pressure: p };
}
function shape(ph, oq, skew, sharp) {
  if (ph >= oq || ph < 0) return 0;
  var t = ph / oq;
  if (t < skew) return 0.5 - 0.5 * Math.cos(Math.PI * t / skew);
  var u = (t - skew) / (1 - skew), soft = 0.5 + 0.5 * Math.cos(Math.PI * u);
  return soft + (Math.cos(0.5 * Math.PI * u) - soft) * sharp;
}
// the folds' area through three cycles (cm^2 at an adult man's size), the diplophonia's
// alternate cycles as the model alternates them
function pulsePts(S, x, y, w, h, top) {
  var pts = [], n = Math.max(60, Math.round(w * 1.2)), per = [1, 1 + 0.08 * S.dip, 1], amp = [1, 1 - 0.35 * S.dip, 1], tot = per[0] + per[1] + per[2];
  for (var i = 0; i <= n; i++) {
    var tt = i / n * tot, c = tt < per[0] ? 0 : tt < per[0] + per[1] ? 1 : 2, ph = (tt - (c ? per[0] + (c > 1 ? per[1] : 0) : 0)) / per[c];
    var pl = shape(ph, S.oq, S.skew, S.sharp);
    if (S.fry > 0.3) pl += 0.55 * smoothstep(0.3, 0.8, S.fry) * shape(ph - 0.38, S.oq * 0.8, S.skew, S.sharp);
    var a = S.amp * amp[c] * pl + S.statics;
    pts.push(x + w * i / n, y + h - clamp(a / top, 0, 1) * h);
  }
  return pts;
}

// ---- the plate's colours: a phonetics plate on deep slate ----------------------------------------
var GROUND = "#0e1318", FRAME = "#26313c", INK = "#e8eef3", DIM = "#7f8c99", FAINT = "#222c36";
var TISSUE = "#e3937f", TISSUE_FILL = "#6e3530", BONE = "#efe4c9", WALL = "#b9a796", AIR = "#173a4c", AIR_LINE = "#3f8fb0";
var TEAL = "#57d3c4", TEAL_DK = "#163c3a", AMBER = "#f2b04c", AMBER_DK = "#3d2b10";

var CACHE = {}, CACHED = 0;
function cached(key, make) {
  if (CACHE[key]) return CACHE[key];
  if (++CACHED > 48) { CACHE = {}; CACHED = 1; }
  return (CACHE[key] = make());
}
// the knob values the mouth is at: its knobs, and in Vowel mode moved along the Vowel path by as
// much as pad pressure moved the Vowel knob (apply_mouth)
var MOUTH_KEYS = ["tongue_x", "tongue_y", "jaw", "lips", "round", "protrude", "nasal", "larynx", "twang", "false_folds", "tip_curl", "tongue_root", "lateral"];
function knobsOf(v, w) {
  var kv = {}, i;
  for (i = 0; i < MOUTH_KEYS.length; i++) kv[MOUTH_KEYS[i]] = known(v, MOUTH_KEYS[i]) ? num(v, MOUTH_KEYS[i], 0) : KNOB_DEF[MOUTH_KEYS[i]];
  var s = num(v, "sweep", 0.5), se = num(v, "sweep:effective", s);
  if (int(v, "mode", 0) === 2 && Math.abs(se - s) > 1e-4) {
    var at = function (x) {
      var f = clamp(x, 0, 1) * 4, j = Math.min(3, Math.floor(f)), t = f - j, A = vowelKnobs(SWEEP_PATH[j], w), B = vowelKnobs(SWEEP_PATH[j + 1], w), o = {};
      for (var k in A) o[k] = A[k] + (B[k] - A[k]) * t;
      return o;
    };
    var a0 = at(s), a1 = at(se);
    for (var k in a0) kv[k] = clamp(kv[k] + a1[k] - a0[k], 0, 1);
  }
  // where the voice has the mouth, while it sounds (a sung or spoken phoneme, pressure): the engine's own
  for (i = 0; i < MOUTH_KEYS.length; i++) { var n = nowOf(v, MOUTH_KEYS[i]); if (n !== null) kv[MOUTH_KEYS[i]] = n; }
  return kv;
}
function mouthLive(v) { for (var i = 0; i < MOUTH_KEYS.length; i++) if (nowOf(v, MOUTH_KEYS[i]) !== null) return true; return false; }
function bodyW(v) { return weights(num(v, "female", 0), num(v, "child", 0)); }
function keyOf(kv, w) { var s = w.map(function (x) { return x.toFixed(3); }).join(","); for (var i = 0; i < MOUTH_KEYS.length; i++) s += "|" + kv[MOUTH_KEYS[i]].toFixed(3); return s; }

// ---- the section: head to the right, the air between the walls ----------------------------------
// a closed outline filled column by column (the panel has no polygon fill): each edge drops its
// crossings into the columns it spans, then each column fills between pairs
function fillPoly(g, pts, col) {
  var n = pts.length, minx = Infinity, maxx = -Infinity, i, x;
  for (i = 0; i < n; i++) { if (pts[i][0] < minx) minx = pts[i][0]; if (pts[i][0] > maxx) maxx = pts[i][0]; }
  var x0 = Math.ceil(minx), cols = [];
  for (x = x0; x <= maxx; x++) cols.push([]);
  for (i = 0; i < n; i++) {
    var a = pts[i], b = pts[(i + 1) % n], lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    if (hi - lo < 1e-9) continue;
    for (x = Math.ceil(lo); x < hi; x++) cols[x - x0].push(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]));
  }
  for (x = 0; x < cols.length; x++) {
    var ys = cols[x];
    if (ys.length < 2) continue;
    if (ys.length > 2) ys.sort(function (p, q) { return p - q; });
    else if (ys[0] > ys[1]) { var tmp = ys[0]; ys[0] = ys[1]; ys[1] = tmp; }
    for (i = 0; i + 1 < ys.length; i += 2) g.fill(x0 + x, ys[i], 1, Math.max(1, ys[i + 1] - ys[i]), col);
  }
}
var CLIP_Y = 1e9;
function mapPts(pts, ox, oy, s) { var o = []; for (var i = 0; i < pts.length; i++) o.push([ox + pts[i][0] * s, Math.min(CLIP_Y, oy - pts[i][1] * s)]); return o; }
function flat(pts) { var o = []; for (var i = 0; i < pts.length; i++) o.push(pts[i][0], pts[i][1]); return o; }
// the tract in section: x from the pharynx's back wall, y up from the glottis; s pixels a cm
function drawSection(g, T, ox, oy, s, rest) {
  var M = function (p) { return mapPts(p, ox, oy, s); }, tl = rest ? "#a27c72" : TISSUE, tf = rest ? "#45302c" : TISSUE_FILL, bn = rest ? "#b1a893" : BONE;
  // the air: between the outer wall and the inner one, from the folds to the lips
  var inr = T.m.inner.slice().reverse(), airPoly = M([T.glottis].concat(T.outer, inr));
  fillPoly(g, airPoly, rest ? "#1a2a35" : AIR);
  // the nose's floor and roof, the velum hanging from the hard palate
  g.poly(flat(M(T.nasal)), 1.5, rest ? FRAME : T.port > 0 ? TEAL : WALL);
  var vel = M(T.velum);
  fillPoly(g, vel, tf); g.poly(flat(vel.concat([vel[0]])), 1.5, tl);
  // the outer wall: the pharynx's back, the palate (bone), the upper teeth
  g.poly(flat(M(T.pharWall.slice(0, Math.max(2, T.pharWall.length - 4)))), 2, rest ? FRAME : WALL);
  g.poly(flat(M(T.palate)), 2.5, bn);
  var ut = M(T.upperTeeth); fillPoly(g, ut, bn);
  // the tongue (filled), the floor and the lower teeth carried by the jaw
  var tg = M(T.tongue);
  fillPoly(g, tg, tf); g.poly(flat(tg), 2, tl);
  var lt = M(T.lowerTeeth); fillPoly(g, lt, bn);
  g.poly(flat(M(T.jawBone)), 1, rest ? FRAME : "#6f6457");
  // the lips
  g.poly(flat(M(T.upperLip)), 2.5, tl); g.poly(flat(M(T.lowerLip)), 2.5, tl);
  // the epiglottis, the larynx and the folds at its floor
  g.poly(flat(M(T.epiglottis)), 1.5, rest ? FRAME : WALL);
  var gx = ox + T.glottis[0] * s, gy = oy - T.glottis[1] * s;
  g.fill(gx - 4, gy - 1, 10, 2, rest ? FRAME : AMBER);
}
// the air from the glottis to the lips, unrolled: each place drawn as wide as its area's
// diameter, the velum's place marked where the nose branches off
var TUBE_PTS = [[], []];
function drawTube(g, af, x, y, w, h, Lmax, port, splitS) {
  var pts = [], dn = [], cy = y + h / 2, sc = w / Lmax, dmax = 2 * Math.sqrt(6 / Math.PI);
  for (var i = 0; i < af.length; i++) {
    var dia = 2 * Math.sqrt(af[i][1] / Math.PI), half = clamp(dia / dmax, 0, 1) * h / 2;
    pts.push(x + af[i][0] * sc, cy - half); dn.push(x + af[i][0] * sc, cy + half);
  }
  TUBE_PTS = [pts, dn];
  g.area(pts, cy, AIR); g.area(dn, cy, AIR);
  g.poly(pts, 1.5, AIR_LINE); g.poly(dn, 1.5, AIR_LINE);
  if (splitS) { var xv = x + splitS * sc; g.fill(xv, y, 1, 4, port > 0 ? TEAL : DIM); if (port > 0) g.text(xv + 3, y + 6, "NOSE", TEAL, -1); }
}
// the tract's resonance curve over 0..5 kHz, its peaks moved to the calibrated formants
function formantCurve(R, x, y, w, h) {
  var raw = R.raw, f = R.f, m = R.mags, top = -Infinity, bot = Infinity, i;
  for (i = 0; i < m.length; i++) { top = Math.max(top, m[i]); bot = Math.min(bot, m[i]); }
  bot = Math.max(bot, top - 45);
  // piecewise-linear frequency warp: 0 -> 0, raw peaks -> calibrated, 5 kHz -> 5 kHz
  var xs = [0], ys = [0];
  for (i = 0; i < 3; i++) if (raw[i] && f[i]) { xs.push(raw[i]); ys.push(f[i]); }
  xs.push(FMAX); ys.push(FMAX);
  var warp = function (q) { for (var j = 1; j < xs.length; j++) if (q <= xs[j]) return ys[j - 1] + (ys[j] - ys[j - 1]) * (q - xs[j - 1]) / Math.max(1e-6, xs[j] - xs[j - 1]); return q; };
  var pts = [];
  for (i = 0; i < m.length; i++) pts.push(x + w * clamp(warp(i * FSTEP) / FMAX, 0, 1), y + h - clamp((m[i] - bot) / (top - bot), 0, 1) * h);
  return pts;
}

// ---- PANEL ---------------------------------------------------------------------------------------
var MODES = ["SPEAK", "SING", "VOWEL"];
var SEC_A = [8, 142], SEC_B = [158, 140], SEC_C = [306, 92], SEC_D = [408, 206], SEC_E = [624, 190], SEC_F = [824, 128];
function title(g, x, w, s) { g.text(x, 12, s, DIM, -1); var tw = g.measure(s); if (w > tw + 8) g.fill(x + tw + 6, 8, w - tw - 6, 1, FRAME); }
function panelGround(g, mode, seg) {
  g.fill(0, 0, 960, 160, GROUND);
  title(g, SEC_A[0], SEC_A[1], "VOICE"); title(g, SEC_B[0], SEC_B[1], "FOLDS"); title(g, SEC_C[0], SEC_C[1], "TRACT");
  if (mode === 2) { title(g, SEC_D[0], SEC_D[1], "AIR, GLOTTIS TO LIPS"); title(g, SEC_E[0], SEC_E[1], "FORMANTS"); }
  else title(g, SEC_D[0], SEC_D[1] + SEC_E[1] + 8, mode === 1 ? "SUNG: A SYLLABLE A KEY" : "SPOKEN: THE LINE A KEY");
  title(g, SEC_F[0], SEC_F[1], "VOWELS");
  // the body's triangle: man, woman, child
  g.poly([22, 92, 62, 92, 42, 60, 22, 92], 1, FRAME);
  g.text(16, 100, "M", DIM, 0); g.text(68, 100, "W", DIM, 0); g.text(42, 57, "C", DIM, 0);
  // the folds' axes
  g.fill(SEC_B[0], 78, SEC_B[1], 1, FRAME);
  if (mode === 2) {
    g.fill(SEC_E[0], 78, SEC_E[1], 1, FRAME);
    for (var k = 1; k <= 4; k++) g.fill(SEC_E[0] + SEC_E[1] * k / 5, 76, 1, 3, DIM);
    g.text(SEC_E[0], 89, "0", DIM, -1); g.text(SEC_E[0] + SEC_E[1], 89, "5 KHZ", DIM, 1); g.text(SEC_E[0] + SEC_E[1] / 2, 89, "HZ", DIM, 0);
  }
  // the encoder row
  g.fill(0, 104, 960, 1, FRAME);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 28 : 44, FAINT);
}
function panel(g, v, t) {
  var kn = v.$knobs || [], tch = v.$touched || "", seg = !!v.$segmode, mode = clamp(int(v, "mode", 0), 0, 2), i;
  var w = bodyW(v), kv = knobsOf(v, w), a = articOf(kv), body = bodyOf(w), key = keyOf(kv, w), R = null;
  var T = cached("tract|" + key, function () { return tractOf(a, body); });
  // the ground and the tract in section: they change only with the mode and the mouth
  var built = false, rest = mode !== 2 && !mouthLive(v); // singing or speaking, the mouth as the voice has it
  g.layer("chm|" + mode + "|" + seg + "|" + rest + "|" + key, function () {
    built = true;
    panelGround(g, mode, seg);
    CLIP_Y = 101; drawSection(g, T, SEC_C[0] + 18, 96, 7.0, rest); CLIP_Y = 1e9;
    if (rest) g.text(SEC_C[0] + SEC_C[1], 101, "AT REST", DIM, 1);
  });
  // VOICE: the mode, the sound, the body
  for (i = 0; i < 3; i++) g.text(SEC_A[0] + i * 46, 26, MODES[i], i === mode ? (tch === "mode" ? "slot" : INK) : DIM, -1);
  g.fill(SEC_A[0] + mode * 46, 29, g.measure(MODES[mode]), 2, tch === "mode" ? "slot" : TEAL);
  g.value(SEC_A[0], 47, txt(v, "preset_name") || "--", INK, -1, SEC_A[1]);
  var bx = 22 * w[0] + 62 * w[1] + 42 * w[2], by = 92 * (w[0] + w[1]) + 60 * w[2], hb = tch === "female" || tch === "child";
  g.dot(bx, by, 4, hb ? "slot" : TEAL);
  var pct = function (x) { return Math.round(x * 100); }, parts = [];
  if (w[0] > 0.005) parts.push(pct(w[0]) + "% MAN"); if (w[1] > 0.005) parts.push(pct(w[1]) + "% WOMAN"); if (w[2] > 0.005) parts.push(pct(w[2]) + "% CHILD");
  for (i = 0; i < parts.length; i++) g.text(76, 70 + i * 11, parts[i], hb ? "slot" : INK, -1, 72);
  // FOLDS: the glottis's area through three cycles, and what the source is
  var S = sourceOf(v), hs = /^(breath|pressed|bright|breathy|rough|fry|whisper)$/.test(tch);
  var pp = cached("pulse|" + [S.oq, S.skew, S.sharp, S.fry, S.amp, S.statics, S.dip].map(function (q) { return q.toFixed(3); }).join(","), function () { return pulsePts(S, SEC_B[0], 18, SEC_B[1], 60, 0.32); });
  g.area(pp, 78, hs ? "#3a3a3a" : AMBER_DK); g.poly(pp, 2, hs ? "slot" : AMBER);
  var sy = 18 + 60 - clamp(S.statics / 0.32, 0, 1) * 60;
  if (S.statics > 0.012) g.fill(SEC_B[0], sy, SEC_B[1], 1, DIM);
  g.text(SEC_B[0], 90, S.voiced ? "OPEN " + Math.round(S.oq * 100) + "%" : "WHISPER", INK, -1);
  g.text(SEC_B[0] + SEC_B[1], 90, num(v, "breath", 8).toFixed(1) + " CMH2O", tch === "breath" ? "slot" : INK, 1);
  g.text(SEC_B[0], 101, S.voiced ? (S.fry > 0.3 ? "FRY: A DOUBLE PULSE" : S.dip > 0 ? "ROUGH: CYCLES ALTERNATE" : S.sharp > 0.6 ? "PRESSED: A HARD CLOSE" : "SOFT CLOSE") : "OPEN, NOT VIBRATING", DIM, -1, SEC_B[1]);
  if (mode === 2) {
    // the air, and the formants it makes: measured a few milliseconds a frame until known
    // (a frame that drew the section anew measures for 2 ms, any other for 6)
    R = formantsFor(a, body, w, kv, key, built ? 2 : 6);
    if (!R) {
      // the last tract's air and formants, faint, while this one is measured; reading the
      // time asks Pung for the next frame, which goes on measuring
      if (+t >= 0 && LAST) { g.poly(LAST.up, 1, FRAME); g.poly(LAST.dn, 1, FRAME); g.poly(LAST.curve, 1.5, FRAME); }
      g.text(SEC_D[0] + SEC_D[1] / 2, 51, "MEASURING", DIM, 0);
    } else {
      var L = 18.5;
      drawTube(g, R.af, SEC_D[0], 18, SEC_D[1], 60, L, T.port, R.af[4][0]);
      g.text(SEC_D[0], 90, "GLOTTIS", DIM, -1); g.text(SEC_D[0] + SEC_D[1], 90, "LIPS", DIM, 1);
      g.text(SEC_D[0] + SEC_D[1] / 2, 90, R.len.toFixed(1) + " CM", INK, 0);
      var cpts = cached("fc|" + key, function () { return formantCurve(R, SEC_E[0], 29, SEC_E[1], 47); });
      g.area(cpts, 78, TEAL_DK); g.poly(cpts, 2, TEAL);
      LAST = { curve: cpts, up: TUBE_PTS[0], dn: TUBE_PTS[1] };
      // each formant named over its peak, its frequency under the axis
      var lastX = -99;
      for (i = 0; i < 3; i++) if (R.f[i]) {
        var fx = SEC_E[0] + SEC_E[1] * clamp(R.f[i] / FMAX, 0, 1), lx = Math.max(fx, lastX + 40);
        g.text(fx, 25, "F" + (i + 1), INK, 0);
        g.text(lx, 100, String(Math.round(R.f[i])), INK, 0);
        lastX = lx;
      }
      if (T.port > 0) g.text(SEC_E[0] + SEC_E[1], 25, "NOSE OPEN", TEAL, 1);
    }
  } else if (mode === 1) {
    // singing: the syllables, and the vibrato every sung note carries (Pung's LFO at its rate)
    lyrics(g, v, SEC_D[0] + 2, 36, SEC_D[1] + 6, mode);
    var hv = tch === "vibrato" || tch === "vib_rate";
    g.text(SEC_E[0], 26, "VIBRATO", hv ? "slot" : DIM, -1);
    g.text(SEC_E[0] + SEC_E[1], 26, num(v, "vibrato", 35).toFixed(0) + " CENTS AT " + num(v, "vib_rate", 6).toFixed(1) + " HZ", hv ? "slot" : INK, 1);
    if (num(v, "vibrato", 35) > 0.5) g.lfo(SEC_E[0], 32, SEC_E[1], 56, { shape: "Sine", rate: "vib_rate", color: AMBER });
    else g.text(SEC_E[0] + SEC_E[1] / 2, 62, "NO VIBRATO: A STRAIGHT TONE", DIM, 0);
  } else lyrics(g, v, SEC_D[0] + 2, 36, SEC_D[1] + SEC_E[1], mode);
  chart(g, w, mode === 2 && R ? R.f : null, SEC_F[0] + 4, 28, SEC_F[1] - 10, 62, tch === "sweep" || tch === "vowel");
  row(g, v);
}
var LAST = null;
// the vowel chart: F2 across (front vowels left), F1 down (open vowels low), the body's thirteen
// vowels where the engine measured them, the Vowel knob's path through five of them, this mouth
var CH_F1 = [220, 1050], CH_F2 = [3300, 750];
function chartXY(f1, f2, x, y, w, h) {
  var u = (Math.log(f2) - Math.log(CH_F2[0])) / (Math.log(CH_F2[1]) - Math.log(CH_F2[0])), q = (Math.log(f1) - Math.log(CH_F1[0])) / (Math.log(CH_F1[1]) - Math.log(CH_F1[0]));
  return [x + clamp(u, 0, 1) * w, y + clamp(q, 0, 1) * h];
}
function chart(g, w, cur, x, y, wd, h, hot) {
  var vf = [], i, b, j;
  for (i = 0; i < 13; i++) { var f = [0, 0]; for (b = 0; b < 3; b++) for (j = 0; j < 2; j++) f[j] += w[b] * VFORM[BODY_NAMES[b]][i][j]; vf.push(chartXY(f[0], f[1], x, y, wd, h)); }
  var path = [];
  for (i = 0; i < SWEEP_PATH.length; i++) path.push(vf[SWEEP_PATH[i]][0], vf[SWEEP_PATH[i]][1]);
  g.poly(path, 1.5, hot ? "slot" : FRAME);
  for (i = 0; i < 13; i++) g.dot(vf[i][0], vf[i][1], 2, DIM);
  var lab = { 1: [0, -4, -1, "EE"], 9: [0, -4, 1, "OO"], 0: [0, 10, 0, "AH"], 5: [-2, 9, 1, "AE"], 7: [3, 3, -1, "OH"] };
  for (var k in lab) { var L = lab[k], p = vf[+k]; g.text(p[0] + L[0], p[1] + L[1], L[3], DIM, L[2]); }
  if (cur && cur[0] && cur[1]) { var c = chartXY(cur[0], cur[1], x, y, wd, h); g.dot(c[0], c[1], 4.5, TEAL); g.dot(c[0], c[1], 2, GROUND); }
}
// the words: Sing's syllables (the one sounding, or the next to sing, lit), Speak's line (the
// word being said lit), as the module's own pages show them
function lyrics(g, v, x, y, w, mode) {
  var view = known(v, "chm_view") ? String(v.chm_view.value || "") : "", toks = [], lit = -1, i;
  var clean = function (s) { return s.replace(/[^\x20-\x7e]/g, ""); };
  if (mode === 1 && view.charAt(0) === "S") {
    var a = view.indexOf("|", 2), words = view.slice(a + 1).split(" ");
    lit = parseInt(view.slice(2, a), 10);
    for (i = 0; i < words.length; i++) if (words[i]) { var sy = words[i].split("·"); for (var k = 0; k < sy.length; k++) toks.push({ t: clean(sy[k]) + (k < sy.length - 1 ? "-" : ""), gap: k === 0 }); }
  } else if (mode === 0 && view.charAt(0) === "P") {
    var p1 = view.indexOf("|", 2), p2 = view.indexOf("|", p1 + 1), el = parseInt(view.slice(2, p1), 10);
    var ends = view.slice(p1 + 1, p2).split(",").filter(Boolean).map(Number), ws = view.slice(p2 + 1).split(/\s+/).filter(Boolean);
    for (i = 0; i < ws.length; i++) toks.push({ t: clean(ws[i]), gap: true });
    if (el >= 0) { for (i = 0; i < ends.length; i++) if (ends[i] > el) { lit = i; break; } if (lit < 0) lit = toks.length - 1; }
  }
  if (!toks.length) { g.text(x, y + 12, known(v, "lyrics") ? clean(txt(v, "lyrics")).toUpperCase() : "--", INK, -1, w); return; }
  // flowed in the value face, the lit token's line kept in view
  var lines = [[]], lx = 0;
  for (i = 0; i < toks.length; i++) {
    var tw = g.measure(toks[i].t, "value"), gp = lines[lines.length - 1].length && toks[i].gap ? 9 : 0;
    if (lines[lines.length - 1].length && lx + gp + tw > w) { lines.push([]); lx = 0; gp = 0; }
    lines[lines.length - 1].push({ i: i, x: lx + gp, t: toks[i].t, w: tw }); lx += gp + tw;
  }
  var at = 0;
  for (i = 0; i < lines.length; i++) for (var j = 0; j < lines[i].length; j++) if (lines[i][j].i === lit) at = i;
  var first = clamp(at - 1, 0, Math.max(0, lines.length - 3));
  for (var r = 0; r < 3 && first + r < lines.length; r++) {
    var L = lines[first + r], yy = y + 4 + r * 22;
    for (j = 0; j < L.length; j++) {
      if (L[j].i === lit) { g.fill(x + L[j].x - 3, yy - 15, L[j].w + 6, 20, TEAL_DK); g.fill(x + L[j].x - 3, yy + 5, L[j].w + 6, 2, TEAL); }
      g.value(x + L[j].x, yy, L[j].t, L[j].i === lit ? INK : L[j].i < lit ? DIM : "#b8c4cf", -1);
    }
  }
}
// the encoder row: name, value, and a gauge of where it stands in its range
function row(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", seg = !!v.$segmode;
  for (var c = 0; c < 8; c++) {
    var k = kn[c];
    if (!k) continue;
    var x0 = c * 120 + 10, hot = k === t, tw = 100;
    g.text(x0, seg ? 118 : 123, NAMES[k] || String((v[k] && v[k].name) || k).toUpperCase(), hot ? "slot" : DIM, -1, tw);
    var pv = known(v, k) ? [String(v[k].display !== undefined && v[k].display !== "" ? v[k].display : v[k].value).toUpperCase(), String(v[k].unit || "").toUpperCase()] : ["--", ""];
    var uw = pv[1] ? g.measure(pv[1]) + 4 : 0;
    g.value(x0, seg ? 135 : 143, pv[0], hot ? "slot" : INK, -1, tw - uw);
    if (pv[1]) g.text(x0 + Math.min(g.measure(pv[0], "value"), tw - uw) + 4, seg ? 135 : 143, pv[1], hot ? "slot" : DIM, -1);
    var f = known(v, k) ? clamp(v[k].frac, 0, 1) : 0, gy = seg ? 139 : 150;
    g.fill(x0, gy, tw, 2, FAINT);
    if (known(v, k)) g.fill(x0, gy, Math.max(2, tw * f), 2, hot ? "slot" : TEAL);
    var n = nowOf(v, k); // where the voice has it, beside the knob's
    if (n !== null && Math.abs(n - f) > 0.004) { g.fill(x0 + tw * Math.min(f, n), gy + 3, Math.max(1, tw * Math.abs(n - f)), 1, MOD_DK); g.dot(x0 + tw * n, gy + 1, 3, MODC); }
  }
}
var NAMES = { tongue_x: "TONGUE FRONT", tongue_y: "TONGUE HIGH", jaw: "JAW", lips: "LIPS OPEN", round: "ROUND", protrude: "POUT",
  tip_curl: "TIP CURL", vowel: "PICK VOWEL", larynx: "LARYNX", false_folds: "FALSE FOLDS", twang: "TWANG", tongue_root: "TONGUE ROOT",
  nasal: "NASAL", lateral: "SIDE", breath: "BREATH", pressed: "PRESSED", bright: "BRIGHT", breathy: "AIRY", rough: "ROUGH", fry: "FRY",
  whisper: "WHISPER", drift: "DRIFT", sweep: "VOWEL", press_amt: "PUSH", hold: "HOLD", vibrato: "VIBRATO", vib_rate: "VIB RATE",
  glide: "GLIDE", legato: "LEGATO", mode: "MODE", words: "WORDS", female: "WOMAN", child: "CHILD", volume: "VOLUME", rate: "RATE",
  expression: "EXPRESSION", position: "POSITION" };

// the same names wherever Pung writes one (its own pages, a knob's detail)
push.short(function (key) { return NAMES[key]; });

// ---- segments: the plate's sections --------------------------------------------------------------
var SEGS = [
  { id: "voice", label: "Voice", rect: [8, 15, 142, 87], keys: ["mode", "words", "female", "child", "volume", "rate", "expression", "position"] },
  { id: "folds", label: "Folds", rect: [158, 15, 140, 87], keys: ["breath", "pressed", "bright", "breathy", "rough", "fry", "whisper", "drift"] },
  { id: "mouth", label: "Mouth", rect: [306, 15, 94, 87], keys: ["vowel", "tongue_x", "tongue_y", "jaw", "round", "lips", "protrude", "tip_curl"] },
  { id: "throat", label: "Throat", rect: [408, 15, 208, 87], keys: ["larynx", "false_folds", "twang", "tongue_root", "nasal", "lateral"] },
  { id: "sound", label: "Vowel & Pitch", rect: [624, 15, 328, 87], keys: ["sweep", "press_amt", "hold", "vibrato", "vib_rate", "glide", "legato"] }];
var SEG_T = { voice: [SEC_A[0], "VOICE"], folds: [SEC_B[0], "FOLDS"], mouth: [SEC_C[0], "TRACT"], throat: [SEC_D[0], null], sound: [SEC_F[0], "VOWELS"] };
function litSegment(g, v) {
  if (v.$segmode !== "segment" || !SEG_T[v.$segment]) return;
  var s = SEG_T[v.$segment], mode = clamp(int(v, "mode", 0), 0, 2);
  var name = s[1] || (v.$segment === "throat" ? (mode === 2 ? "AIR, GLOTTIS TO LIPS" : "THROAT") : (mode === 2 ? "FORMANTS" : "VOWEL AND PITCH"));
  g.fill(s[0] - 2, 3, g.measure(name) + 4, 10, GROUND);
  g.text(s[0], 12, name, "slot", -1);
}

// how the module's values read: its 0..1 knobs as the anatomy they set
push.display(function (key, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return;
  if (/^(tongue_x|tongue_y|round|twang|false_folds|tip_curl|tongue_root|lateral|pressed|bright|breathy|rough|fry|female|child|volume|expression|sweep)$/.test(key)) return { value: String(Math.round(x * 100) + 0), unit: "%" };
  if (key === "press_amt") { var pa = Math.round(x * 100); return { value: (pa > 0 ? "+" : "") + (pa + 0), unit: "%" }; }
  if (key === "jaw") return { value: (x * 2.4 * 10).toFixed(0), unit: "mm" };
  if (key === "lips") { var ap = -0.3 + 2.5 * x; return ap <= 0 ? "Pressed" : { value: (ap * 10).toFixed(0), unit: "mm" }; }
  if (key === "protrude") return { value: ((-0.1 + 1.5 * x) * 10).toFixed(0), unit: "mm" };
  if (key === "larynx") { var l = (-1.5 + 3 * x) * 10; return { value: (l > 0.5 ? "+" : "") + l.toFixed(0), unit: "mm" }; }
  if (key === "nasal") { var vp = -0.25 + 1.45 * x; return vp <= 0 ? "Closed" : { value: (vp * 100).toFixed(0), unit: "mm2" }; }
});

push.theme({ ground: GROUND, panel: "#1b2530", ink: INK, dim: DIM, rule: "#3a4754", faint: FAINT, accent: TEAL, knob: "ring" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true, segments: SEGS,
  pages: [
    { label: "Play", keys: ["mode", "words", "sweep", "press_amt", "female", "child", "breath", "volume"] },
    { label: "Mouth", keys: ["vowel", "tongue_x", "tongue_y", "jaw", "round", "lips", "protrude", "tip_curl"] },
    { label: "Throat", keys: ["larynx", "false_folds", "twang", "tongue_root", "nasal", "lateral"] },
    { label: "Tone", keys: ["breath", "pressed", "bright", "breathy", "rough", "fry", "whisper", "drift"] },
    { label: "Pitch", keys: ["vibrato", "vib_rate", "glide", "legato", "hold", "rate", "expression", "position"] }
  ],
  extra_keys: ["preset_name", "mode", "vibrato", "vib_rate", "female", "child", "chm_view", "lyrics", "sweep", "breath", "pressed", "bright", "breathy", "rough", "fry", "whisper",
    "tongue_x", "tongue_y", "jaw", "lips", "round", "protrude", "nasal", "larynx", "twang", "false_folds", "tip_curl", "tongue_root", "lateral"],
  live_keys: ["chm_view", "sweep:effective"],
  screen: function (g, v, t) { panel(g, v, t); litSegment(g, v); }
});
