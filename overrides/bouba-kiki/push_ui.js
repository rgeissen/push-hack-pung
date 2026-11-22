// Bouba-Kiki on the Push: a contour synth, whose shape IS its wave.
//
// The module scans a closed 2D outline: the carrier reads its X and Y as the
// left and right channels, a sharpened copy of it is the modulator, and six
// geometric controls deform it. So the panel is the shape, drawn with the
// module's own geometry (canvas.js / shape.c: the Bouba and Kiki contours,
// the same lobe, tooth, pinch and shear terms), and what the shape makes of
// the sound:
//
// - the outline itself, filled, from round (bouba) to spiky (kiki), its
//   colour moving with Morph from the round side's blue to the sharp side's
//   orange; while a note sounds it is the DSP's own shape (the `visual`
//   telemetry: pressure on Morph, the wobble's phase, the envelope's swell);
// - the wave it makes: one cycle of the scan, left and right as the module
//   matrixes X and Y (.85x + .35y / .35x + .85y): Tilt reads as width;
// - the FM numbers the shape sets at once (README, "One shape drives three
//   FM parameters"): the operator ratio (2 + 1.414 Spikes + 1.732 Pinch:
//   harmonic at 2, metallic past it) and the modulation index;
// - the amp ADSR (Pung's envelope, on the module's own times);
// - the encoder row as six little shapes, each the circle bent by its knob
//   alone, then the envelope's knobs.

var GROUND = "#121116", PANEL = "#1b1a20", RULE = "#34323c", INK = "#ece6da", INK_DIM = "#9c968c";
var LEGEND = "#bdb6aa", BOUBA = "#61a3ff", KIKI = "#ff5f38";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : "--"; }
function up(s) { return String(s).toUpperCase(); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : (x === x ? x : 0); }

// a colour between two, flat (the panel has no alpha)
function hex2(n) { var s = Math.round(n).toString(16); return s.length < 2 ? "0" + s : s; }
function mixc(a, b, t) {
  var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  var r = ((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t;
  var g = ((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t;
  var bl = (pa & 255) * (1 - t) + (pb & 255) * t;
  return "#" + hex2(r) + hex2(g) + hex2(bl);
}
// Morph's colour: round blue through violet to sharp orange (hue, not a grey
// mix: the middle of the way is as vivid as its ends)
function hsv(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  var i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  var rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return "#" + hex2(rgb[0] * 255) + hex2(rgb[1] * 255) + hex2(rgb[2] * 255);
}
var colMemo = {};
function shapeColor(m) {
  var k = Math.round(clamp01(m) * 50);
  return colMemo[k] || (colMemo[k] = hsv(216 + 160 * k / 50, 0.62 + 0.1 * k / 50, 1));
}

// the Bouba and Kiki contours the morph runs between (canvas.js CONTOURS.morphBouba,
// morphKiki: 256 points each, x0,y0,x1,y1...)
var BK_B = [.2970,-.9284,.3352,-.9232,.3696,-.9060,.3931,-.8760,.4036,-.8388,.4077,-.8004,.4083,-.7617,.4061,-.7231,.4020,-.6846,.3960,-.6463,.3884,-.6084,.3803,-.5706,.3723,-.5327,.3646,-.4948,.3571,-.4568,.3499,-.4188,.3435,-.3806,.3380,-.3423,.3342,-.3038,.3345,-.2651,.3448,-.2283,.3741,-.2044,.4119,-.2035,.4461,-.2213,.4763,-.2455,.5046,-.2719,.5319,-.2993,.5591,-.3269,.5873,-.3533,.6167,-.3785,.6478,-.4015,.6811,-.4212,.7173,-.4344,.7557,-.4357,.7925,-.4238,.8265,-.4055,.8577,-.3826,.8861,-.3563,.9115,-.3272,.9347,-.2962,.9564,-.2642,.9756,-.2306,.9906,-.1950,.9988,-.1572,.9994,-.1186,.9871,-.0825,.9606,-.0544,.9299,-.0309,.8956,-.0131,.8593,.0003,.8220,.0105,.7842,.0190,.7462,.0260,.7080,.0324,.6698,.0388,.6317,.0453,.5936,.0521,.5557,.0597,.5184,.0700,.4859,.0905,.4866,.1253,.5095,.1563,.5348,.1857,.5607,.2145,.5869,.2429,.6134,.2711,.6401,.2992,.6666,.3273,.6928,.3558,.7183,.3849,.7431,.4147,.7665,.4455,.7876,.4779,.8035,.5131,.8086,.5512,.7964,.5875,.7688,.6142,.7335,.6296,.6952,.6341,.6572,.6271,.6205,.6151,.5844,.6011,.5488,.5859,.5135,.5701,.4784,.5537,.4433,.5373,.4081,.5214,.3724,.5064,.3354,.4951,.3161,.5148,.3334,.5492,.3542,.5819,.3755,.6142,.3962,.6469,.4158,.6802,.4336,.7146,.4480,.7505,.4561,.7882,.4514,.8263,.4315,.8591,.4030,.8851,.3690,.9034,.3319,.9143,.2938,.9206,.2552,.9244,.2166,.9268,.1780,.9283,.1393,.9272,.1035,.9139,.0739,.8890,.0511,.8579,.0334,.8235,.0177,.7881,.0033,.7522,-.0100,.7159,-.0227,.6793,-.0346,.6425,-.0460,.6055,-.0573,.5685,-.0693,.5317,-.0821,.4951,-.0974,.4597,-.1313,.4700,-.1612,.4946,-.1900,.5204,-.2188,.5463,-.2480,.5716,-.2779,.5962,-.3085,.6199,-.3400,.6424,-.3725,.6634,-.4064,.6820,-.4424,.6960,-.4807,.7012,-.5194,.7008,-.5575,.6944,-.5897,.6735,-.6164,.6455,-.6413,.6159,-.6642,.5847,-.6845,.5518,-.7016,.5171,-.7147,.4807,-.7226,.4429,-.7235,.4043,-.7192,.3659,-.7060,.3296,-.6837,.2982,-.6548,.2726,-.6226,.2511,-.5887,.2325,-.5539,.2157,-.5185,.1999,-.4829,.1848,-.4470,.1703,-.4112,.1558,-.3756,.1406,-.3407,.1238,-.3078,.1035,-.2928,.0718,-.3259,.0528,-.3641,.0469,-.4026,.0434,-.4412,.0405,-.4799,.0382,-.5185,.0362,-.5572,.0345,-.5959,.0331,-.6345,.0317,-.6732,.0300,-.7119,.0280,-.7505,.0256,-.7890,.0222,-.8274,.0173,-.8653,.0095,-.9018,-.0031,-.9354,-.0221,-.9648,-.0471,-.9862,-.0792,-.9974,-.1161,-.9994,-.1546,-.9923,-.1924,-.9714,-.2243,-.9389,-.2447,-.9019,-.2557,-.8635,-.2604,-.8248,-.2615,-.7861,-.2605,-.7475,-.2582,-.7089,-.2548,-.6705,-.2504,-.6321,-.2457,-.5938,-.2402,-.5555,-.2345,-.5172,-.2287,-.4790,-.2229,-.4406,-.2175,-.4022,-.2127,-.3638,-.2085,-.3252,-.2054,-.2865,-.2039,-.2479,-.2063,-.2123,-.2200,-.2129,-.2528,-.2396,-.2806,-.2687,-.3061,-.2984,-.3310,-.3284,-.3555,-.3586,-.3796,-.3890,-.4035,-.4195,-.4274,-.4497,-.4517,-.4795,-.4763,-.5088,-.5015,-.5373,-.5277,-.5646,-.5551,-.5898,-.5845,-.6117,-.6164,-.6295,-.6507,-.6413,-.6875,-.6434,-.7260,-.6353,-.7637,-.6179,-.7981,-.5936,-.8281,-.5642,-.8531,-.5318,-.8742,-.4973,-.8917,-.4604,-.9032,-.4221,-.9086,-.3835,-.9111,-.3448,-.9121,-.3065,-.9074,-.2710,-.8922,-.2375,-.8728,-.2067,-.8495,-.1798,-.8218,-.1564,-.7909,-.1354,-.7584,-.1160,-.7249,-.0974,-.6910,-.0792,-.6569,-.0603,-.6231,-.0404,-.5899,-.0164,-.5654,.0044,-.5980,.0231,-.6319,.0409,-.6662,.0583,-.7008,.0761,-.7352,.0949,-.7690,.1151,-.8020,.1371,-.8339,.1618,-.8636,.1899,-.8901,.2223,-.9111,.2586,-.9240];
var BK_K = [.5953,-.9886,.5888,-.9517,.5824,-.9148,.5760,-.8778,.5695,-.8409,.5631,-.8040,.5567,-.7671,.5502,-.7302,.5438,-.6933,.5374,-.6564,.5309,-.6195,.5245,-.5826,.5181,-.5456,.5116,-.5087,.5052,-.4718,.4988,-.4349,.4923,-.3980,.4859,-.3611,.4795,-.3242,.4730,-.2873,.4666,-.2504,.4602,-.2134,.4537,-.1765,.4473,-.1396,.4409,-.1027,.4344,-.0658,.4280,-.0289,.4418,-.0100,.4792,-.0122,.5166,-.0144,.5540,-.0166,.5914,-.0188,.6288,-.0210,.6662,-.0232,.7036,-.0254,.7410,-.0276,.7784,-.0298,.8158,-.0320,.8532,-.0342,.8906,-.0364,.9280,-.0386,.9435,-.0340,.9116,-.0143,.8797,.0053,.8478,.0249,.8159,.0445,.7839,.0641,.7520,.0837,.7201,.1034,.6882,.1230,.6563,.1426,.6243,.1622,.5924,.1818,.5605,.2014,.5286,.2211,.4966,.2407,.4780,.2629,.5001,.2931,.5223,.3233,.5445,.3535,.5667,.3837,.5888,.4139,.6110,.4441,.6332,.4743,.6553,.5045,.6775,.5347,.6997,.5649,.7218,.5952,.7440,.6254,.7662,.6556,.7741,.6763,.7377,.6673,.7014,.6583,.6650,.6494,.6286,.6404,.5922,.6314,.5558,.6225,.5195,.6135,.4831,.6046,.4467,.5956,.4103,.5866,.3739,.5777,.3376,.5687,.3012,.5597,.2806,.5837,.2649,.6177,.2492,.6517,.2334,.6857,.2177,.7197,.2019,.7537,.1862,.7877,.1704,.8217,.1547,.8557,.1390,.8897,.1232,.9237,.1075,.9577,.0917,.9917,.0853,.9718,.0819,.9344,.0785,.8971,.0751,.8598,.0717,.8225,.0683,.7852,.0649,.7479,.0615,.7106,.0582,.6733,.0548,.6359,.0514,.5986,.0480,.5613,.0446,.5240,.0412,.4867,.0378,.4494,.0041,.4658,-.0296,.4822,-.0633,.4985,-.0970,.5149,-.1308,.5311,-.1645,.5474,-.1983,.5636,-.2321,.5798,-.2660,.5959,-.2998,.6119,-.3337,.6279,-.3676,.6438,-.4016,.6597,-.4356,.6755,-.4695,.6912,-.5036,.7069,-.5376,.7225,-.5717,.7381,-.6058,.7537,-.6398,.7693,-.6739,.7848,-.7081,.8003,-.7422,.8158,-.7660,.8238,-.7408,.7960,-.7157,.7683,-.6905,.7406,-.6653,.7128,-.6402,.6850,-.6151,.6572,-.5900,.6294,-.5649,.6015,-.5399,.5736,-.5149,.5457,-.4899,.5178,-.4650,.4898,-.4401,.4619,-.4152,.4338,-.3904,.4058,-.3656,.3776,-.3409,.3495,-.3162,.3213,-.2916,.2931,-.2670,.2648,-.2425,.2365,-.2180,.2081,-.2440,.1889,-.2769,.1709,-.3097,.1529,-.3426,.1349,-.3755,.1170,-.4083,.0990,-.4412,.0810,-.4741,.0630,-.5069,.0450,-.5398,.0270,-.5727,.0091,-.6056,-.0089,-.6384,-.0269,-.6713,-.0449,-.7042,-.0629,-.7370,-.0808,-.7699,-.0988,-.8028,-.1168,-.8356,-.1348,-.8685,-.1528,-.9014,-.1708,-.9343,-.1887,-.9384,-.1968,-.9015,-.1906,-.8645,-.1845,-.8276,-.1783,-.7906,-.1721,-.7537,-.1660,-.7167,-.1598,-.6797,-.1536,-.6428,-.1475,-.6058,-.1413,-.5689,-.1351,-.5319,-.1290,-.4950,-.1228,-.4580,-.1167,-.4210,-.1105,-.3841,-.1043,-.3471,-.0982,-.3102,-.0920,-.2732,-.0858,-.2363,-.0797,-.1993,-.0735,-.1623,-.0673,-.1702,-.1004,-.1811,-.1362,-.1921,-.1721,-.2030,-.2079,-.2140,-.2437,-.2249,-.2795,-.2359,-.3154,-.2469,-.3512,-.2578,-.3870,-.2688,-.4229,-.2797,-.4587,-.2907,-.4945,-.3017,-.5303,-.3126,-.5662,-.3236,-.6020,-.3312,-.6326,-.3034,-.6074,-.2756,-.5823,-.2479,-.5571,-.2201,-.5320,-.1923,-.5068,-.1645,-.4817,-.1367,-.4566,-.1090,-.4314,-.0812,-.4063,-.0534,-.3811,-.0256,-.3560,.0021,-.3308,.0299,-.3057,.0577,-.2805,.0832,-.2764,.1049,-.3070,.1266,-.3375,.1483,-.3680,.1700,-.3986,.1917,-.4291,.2134,-.4597,.2351,-.4902,.2568,-.5208,.2785,-.5513,.3002,-.5818,.3219,-.6124,.3436,-.6429,.3653,-.6735,.3870,-.7040,.4087,-.7346,.4304,-.7651,.4521,-.7956,.4738,-.8262,.4955,-.8567,.5172,-.8873,.5389,-.9178,.5606,-.9484,.5823,-.9789];

// ---- the module's geometry (shape.c, canvas.js) ------------------------------------------

var TAU = Math.PI * 2, N = 256;
var C2 = [], C3 = [], C5 = [], S5 = [], TOOTH = [];
for (var i0 = 0; i0 < N; i0++) {
  var a0 = TAU * i0 / N;
  C2.push(Math.cos(2 * a0)); C3.push(Math.cos(3 * a0));
  C5.push(Math.cos(5 * a0)); S5.push(Math.sin(5 * a0));
  TOOTH.push(Math.pow(Math.max(0, Math.cos(11 * a0)), 6));
}

// The same smoothing the DSP applies above 420 Hz (synth.c band_limit), so
// the drawn teeth are the heard ones.
function bandLimit(raw, hz) {
  if (!(hz > 420)) return raw;
  var keep = Math.floor(15000 / hz), n = raw.length;
  if (keep >= n / 2) return raw;
  var width = Math.floor(n / (keep > 0 ? keep : 1));
  if (width < 2) return raw;
  if (width > n / 4) width = Math.floor(n / 4);
  var half = width >> 1, out = raw;
  for (var pass = 0; pass < 2; pass++) {
    var src = out, dst = new Array(n), sx = 0, sy = 0, k;
    for (k = 0; k < width; k++) { var j = ((k - half) % n + n) % n; sx += src[j][0]; sy += src[j][1]; }
    for (var i = 0; i < n; i++) {
      dst[i] = [sx / width, sy / width];
      var drop = ((i - half) % n + n) % n, add = ((i - half + width) % n + n) % n;
      sx += src[add][0] - src[drop][0]; sy += src[add][1] - src[drop][1];
    }
    out = dst;
  }
  return out;
}

// the contour, in the module's units: p {morph, bulge, pinch, spikes, tilt, wobble}
// (circle: a plain circle as the base instead of the Bouba-Kiki pair, for a
// knob's own glyph: what that one term does to a circle)
function contour(p, phase, hz, step, circle) {
  var out = [], cp = Math.cos(phase), sp = Math.sin(phase), tilt = p.tilt - 0.5;
  for (var i = 0; i < N; i += step) {
    var x, y;
    if (circle) { var a = TAU * i / N + 0.31; x = 0.8 * Math.sin(a); y = -0.8 * Math.cos(a); }
    else {
      x = BK_B[2 * i] + (BK_K[2 * i] - BK_B[2 * i]) * p.morph;
      y = BK_B[2 * i + 1] + (BK_K[2 * i + 1] - BK_B[2 * i + 1]) * p.morph;
    }
    var lobe = 1 + p.bulge * (0.65 + 1.1 * C3[i]);
    var warp = lobe * (1 + p.spikes * (2.8 * TOOTH[i] - 0.45)) * (1 + 0.7 * p.wobble * (S5[i] * cp + C5[i] * sp));
    x *= warp * (1 - 0.93 * p.pinch * (0.5 + 0.5 * C2[i]));
    y *= warp * (1 + 0.6 * p.pinch);
    x += 2.4 * tilt * y;
    out.push([x, y]);
  }
  return step === 1 ? bandLimit(out, hz) : out;
}

// into a box, as canvas.js fits it: never larger than the unit outline at
// rest, so a shape that grows is seen growing until it fills the box
function fitted(raw, cx, cy, w, h, swell) {
  var mx = 1, my = 1, i;
  for (i = 0; i < raw.length; i++) { mx = Math.max(mx, Math.abs(raw[i][0])); my = Math.max(my, Math.abs(raw[i][1])); }
  var s = 0.5 * Math.min(w / mx, h / my) * swell, pts = [];
  for (i = 0; i < raw.length; i++) pts.push([cx + raw[i][0] * s, cy + raw[i][1] * s]);
  pts.push(pts[0]);
  return pts;
}

// a closed outline as horizontal spans [y, x0, x1, ...]: each edge adds its
// crossings to the rows it spans, so a fill costs a few hundred steps
function spans(pts) {
  var rows = {}, ylo = 1e9, yhi = -1e9, i;
  for (i = 1; i < pts.length; i++) {
    var x0 = pts[i - 1][0], y0 = pts[i - 1][1], x1 = pts[i][0], y1 = pts[i][1];
    if (y0 === y1) continue;
    var a = Math.ceil(Math.min(y0, y1) - 0.5), b = Math.floor(Math.max(y0, y1) - 0.5);
    for (var y = a; y <= b; y++) {
      var t = (y + 0.5 - y0) / (y1 - y0);
      if (t < 0 || t >= 1) continue;
      (rows[y] || (rows[y] = [])).push(x0 + (x1 - x0) * t);
      if (y < ylo) ylo = y;
      if (y > yhi) yhi = y;
    }
  }
  var out = [];
  for (var r = ylo; r <= yhi; r++) {
    var xs = rows[r];
    if (!xs) continue;
    xs.sort(function (p, q) { return p - q; });
    for (var k = 0; k + 1 < xs.length; k += 2) out.push(r, Math.round(xs[k]), Math.round(xs[k + 1]));
  }
  return out;
}
function fillSpans(g, sp, col) {
  for (var i = 0; i < sp.length; i += 3) if (sp[i + 2] > sp[i + 1]) g.fill(sp[i + 1], sp[i], sp[i + 2] - sp[i + 1], 1, col);
}
// every other row, two high: half the calls, the same silhouette
function spans2(sp) {
  var out = [];
  for (var i = 0; i < sp.length; i += 3) if (sp[i] % 2 === 0) out.push(sp[i], sp[i + 1], sp[i + 2]);
  return out;
}
function fillSpans2(g, sp, col) {
  for (var i = 0; i < sp.length; i += 3) if (sp[i + 2] > sp[i + 1]) g.fill(sp[i + 1], sp[i], sp[i + 2] - sp[i + 1], 2, col);
}

// ---- what the module says while it sounds (`visual`) ---------------------------------------
// "id,serial,velocity,pressure,env, morph,bulge,pinch,spikes,tilt,wobble (effective),
//  phase, morph..wobble (base), hz" (bouba_kiki_plugin.c)

var GEO = ["morph", "bulge", "pinch", "spikes", "tilt", "wobble"];
var lastPhase = 0;
function sounding(v) {
  var L = v.$live;
  return !!(L && L.known && (L.held > 0 || (L.since_off >= 0 && L.since_off < 4) || L.level > 0.002));
}
function shapeNow(v) {
  var p = {}, i, base = { morph: 0, bulge: 0, pinch: 0, spikes: 0, tilt: 0.5, wobble: 0 };
  for (i = 0; i < 6; i++) p[GEO[i]] = known(v, GEO[i]) ? clamp01(num(v, GEO[i], 0)) : base[GEO[i]];
  var vis = known(v, "visual") ? String(v.visual.value).split(",").map(Number) : [];
  var env = 0, hz = 0, live = sounding(v);
  if (vis.length >= 19 && live) {
    // the knob as turned now, plus what pressure adds in the DSP
    for (i = 0; i < 6; i++) p[GEO[i]] = clamp01(p[GEO[i]] + vis[5 + i] - vis[12 + i]);
    env = clamp01(vis[4]);
    hz = isFinite(vis[18]) ? vis[18] : 0;
    if (isFinite(vis[11])) lastPhase = vis[11];
  }
  return { p: p, env: env, hz: hz, phase: p.wobble > 0 ? lastPhase : 0, live: live && vis.length >= 19 };
}

// the FM pair the shape sets (voice.c): ratio from Spikes and Pinch alone,
// index from every control but Tilt and Wobble (at full velocity, low keys)
function ratioOf(p) { return 2 + 1.41421356 * p.spikes + 1.7320508 * p.pinch; }
function indexOf(p) { return 0.025 + 0.28 * p.spikes + 0.22 * p.pinch + 0.3 * p.morph + 0.2 * p.bulge; }

// ---- the panel ----------------------------------------------------------------------------

var STAGE = { x: 206, y: 3, w: 226, h: 98 };
var SCAN = { x: 448, y: 24, w: 180, h: 68 };
var ENV = { x: 650, y: 20, w: 304, h: 82 };

function ground(g, v) {
  g.layer("bk", function () {
    g.fill(0, 0, 960, 160, GROUND);
    g.fill(0, 104, 960, 56, PANEL);
    g.fill(0, 104, 960, 1, RULE);
    for (var i = 1; i < 8; i++) g.fill(i * 120, 112, 1, 42, RULE);
    g.fill(200, 8, 1, 88, RULE);
    g.fill(640, 8, 1, 88, RULE);
    // the stage is an X/Y scope: the module's X and Y are the stereo pair,
    // so the outline is traced as a scope in X/Y mode draws it
    var cx = STAGE.x + STAGE.w / 2, cy = STAGE.y + STAGE.h / 2, r = STAGE.h / 2;
    for (var d = -4; d <= 4; d++) {
      g.fill(Math.round(cx + d * r / 4), cy - 1, 1, 3, d ? "#2b2a32" : RULE);
      g.fill(cx - 1, Math.round(cy + d * r / 4), 3, 1, d ? "#2b2a32" : RULE);
    }
    g.fill(cx - r, cy, 2 * r, 1, "#222128");
    g.fill(cx, STAGE.y, 1, STAGE.h, "#222128");

    // the scan's frame: its zero line and the cycle's halves
    g.fill(SCAN.x, SCAN.y + SCAN.h / 2, SCAN.w, 1, RULE);
    g.fill(SCAN.x + SCAN.w / 2, SCAN.y, 1, SCAN.h, "#26252c");
    g.text(SCAN.x - 2, 14, "THE WAVE", LEGEND, -1);
    g.text(ENV.x + 4, 14, "AMP", LEGEND, -1);
  });
}

// the contour for the stage and the wave, computed once for both
var rawMemo = { sig: "", raw: null };
function rawContour(s) {
  var p = s.p, sig = [p.morph, p.bulge, p.pinch, p.spikes, p.tilt, p.wobble, Math.round(s.phase * 60), Math.round(s.hz)].join("|");
  if (sig !== rawMemo.sig) rawMemo = { sig: sig, raw: contour(p, s.phase, s.hz, 1) };
  return rawMemo;
}
var stageMemo = { sig: "", pts: null, sp: null };
function stage(g, s, hot) {
  var p = s.p, swell = 0.82 + 0.18 * s.env, rc = rawContour(s);
  var sig = rc.sig + "|" + Math.round(swell * 100);
  if (sig !== stageMemo.sig) {
    var pts = fitted(rc.raw, STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2, STAGE.w, STAGE.h, swell);
    // the outline drawn through every other point (the fill keeps them all)
    var out = [];
    for (var i = 0; i < pts.length; i += 2) out.push(pts[i]);
    out.push(pts[pts.length - 1]);
    stageMemo = { sig: sig, pts: out, sp: spans2(spans(pts)) };
  }
  var col = shapeColor(p.morph);
  fillSpans2(g, stageMemo.sp, mixc(GROUND, col, 0.3));
  g.poly(stageMemo.pts, hot ? 3 : 2.2, hot ? "slot" : col);
}

// one cycle of the scan, twice: X and Y matrixed to left and right (voice.c)
var waveMemo = { sig: "", l: null, r: null };
function wave(g, s, col) {
  var rc = rawContour(s), sig = rc.sig;
  if (sig !== waveMemo.sig) {
    var raw = rc.raw, L = [], R = [], m = 1e-6, i;
    for (i = 0; i < N; i += 4) {
      var x = raw[i][0], y = raw[i][1];
      L.push(0.85 * x + 0.35 * y); R.push(0.35 * x + 0.85 * y);
    }
    var mean = function (a) { var t = 0; for (var k = 0; k < a.length; k++) t += a[k]; return t / a.length; };
    var ml = mean(L), mr = mean(R); // the DSP's DC blocker takes the offset out
    for (i = 0; i < L.length; i++) { L[i] -= ml; R[i] -= mr; m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); }
    var pl = [], pr = [], n = L.length, cy = SCAN.y + SCAN.h / 2, a = (SCAN.h / 2 - 3) / m;
    for (var c = 0; c < 2; c++) {
      for (i = 0; i < n; i++) {
        var px = SCAN.x + (c * n + i) * SCAN.w / (2 * n);
        pl.push([px, cy - L[i] * a]); pr.push([px, cy - R[i] * a]);
      }
    }
    pl.push([SCAN.x + SCAN.w, cy - L[0] * a]); pr.push([SCAN.x + SCAN.w, cy - R[0] * a]);
    waveMemo = { sig: sig, l: pl, r: pr };
  }
  g.poly(waveMemo.r, 1.5, INK_DIM);
  g.poly(waveMemo.l, 2, col);
  g.text(SCAN.x + SCAN.w, 14, "R", INK_DIM, 1);
  g.text(SCAN.x + SCAN.w - 22, 14, "L", col, 1);
}

// the small shapes: a circle bent by one control alone (Morph: the pair)
var glyphMemo = {}, glyphN = 0;
function glyph(g, key, val, cx, cy, r, hot, col) {
  var mk = key + "|" + Math.round(val * 100) + "|" + cx + "|" + cy + "|" + r;
  var gm = glyphMemo[mk];
  if (!gm) {
    if (++glyphN > 96) { glyphMemo = {}; glyphN = 0; }
    var p = { morph: 0, bulge: 0, pinch: 0, spikes: 0, tilt: 0.5, wobble: 0 };
    p[key] = val;
    var pts = fitted(contour(p, 0, 0, 4, key !== "morph"), cx, cy, 2 * r, 2 * r, 1);
    gm = glyphMemo[mk] = { pts: pts };
  }
  g.poly(gm.pts, hot ? 2.2 : 1.6, hot ? "slot" : col);
}

function titleBlock(g, v, s) {
  var x = 12, col = shapeColor(s.p.morph);
  g.value(x, 22, "BOUBA-KIKI", INK, -1);
  // the preset, or Edited once a knob moved
  var name = known(v, "preset_name") ? up(v.preset_name.display || v.preset_name.value) : "";
  var pi = known(v, "preset") ? parseInt(v.preset.value, 10) : -1;
  var tag = name === "EDITED" || pi < 0 ? "" : (pi + 1) + "/6";
  g.text(x, 40, name || "--", col, -1, 150);
  if (tag) g.text(190, 40, tag, INK_DIM, 1);
  // Morph: the axis between the two words of the experiment
  var ay = 63, ax0 = x + 22, ax1 = 168, hot = v.$touched === "morph";
  glyph(g, "morph", 0, x + 8, ay, 8, false, BOUBA);
  glyph(g, "morph", 1, 182, ay, 9, false, KIKI);
  g.fill(ax0, ay, ax1 - ax0, 1, RULE);
  var mx = ax0 + s.p.morph * (ax1 - ax0);
  g.fill(ax0, ay - 1, Math.round(mx - ax0), 3, mixc(GROUND, col, 0.7));
  g.dot(mx, ay, hot ? 5 : 4, hot ? "slot" : col);
  g.text(ax0, ay - 7, "BOUBA", s.p.morph < 0.5 ? BOUBA : INK_DIM, -1);
  g.text(ax1, ay - 7, "KIKI", s.p.morph >= 0.5 ? KIKI : INK_DIM, 1);
  // the FM pair the shape sets
  var ratio = ratioOf(s.p), idx = indexOf(s.p), harm = ratio < 2.005;
  var fmHot = v.$touched === "spikes" || v.$touched === "pinch";
  g.text(x, 86, "RATIO", INK_DIM, -1);
  g.text(x + 44, 86, ratio.toFixed(2), fmHot ? "slot" : INK, -1);
  g.text(x + 90, 86, "INDEX", INK_DIM, -1);
  g.text(x + 134, 86, idx.toFixed(2), INK, -1);
  g.text(x, 98, harm ? "HARMONIC: IN TUNE" : "INHARMONIC: METALLIC", harm ? INK_DIM : KIKI, -1, 186);
}

// ---- the encoder row ------------------------------------------------------------------

function ring(g, cx, cy, r, f, ok, hot, col) {
  g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 1.5, 2, RULE);
  if (!ok) return;
  g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 1.5 * clamp01(f), hot ? 3 : 2, hot ? "slot" : col);
  var a = Math.PI * (0.75 + 1.5 * clamp01(f));
  g.line(cx + Math.cos(a) * (r - 7), cy + Math.sin(a) * (r - 7), cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), 2, hot ? "slot" : INK);
}

function row(g, v, s) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    // in segment mode the bottom 18 pixels are Pung's: the row closes up
    var sm = !!v.$segmode, x0 = i * 120, hot = k === t, ok = known(v, k), cx = x0 + 32, cy = sm ? 129 : 137, r = sm ? 10 : 15;
    g.text(x0 + 60, sm ? 116 : 120, up(v[k].name), hot ? "slot" : LEGEND, 0, 108);
    if (GEO.indexOf(k) >= 0) {
      glyph(g, k, ok ? clamp01(num(v, k, 0)) : (k === "tilt" ? 0.5 : 0), cx, cy, r, hot, ok ? shapeColor(k === "morph" ? num(v, k, 0) : s.p.morph) : INK_DIM);
    } else if (k === "preset") {
      var pi = ok ? parseInt(v[k].value, 10) : -1;
      for (var j = 0; j < 6; j++) g.dot(x0 + 14 + (j % 3) * 14, (sm ? 124 : 131) + Math.floor(j / 3) * (sm ? 9 : 13), j === pi ? 4 : 2.5, j === pi ? (hot ? "slot" : INK) : RULE);
    } else {
      ring(g, cx, cy, sm ? 10 : 14, fr(v, k, 0), ok, hot, INK);
    }
    var val = ok ? disp(v, k) : "--";
    g.value(x0 + 84, sm ? 138 : 149, val, hot ? "slot" : INK, 0, 66);
  }
  // which page of how many, or which segment
  var ps = v.$pages || [];
  if (v.$segmode === "segment") g.text(948, 14, up(segLabel(v)), "slot", 1);
  else if (ps.length > 1) g.text(948, 14, up(ps[v.$page] || "") + "  " + (v.$page + 1) + "/" + ps.length, INK_DIM, 1);
}

// ---- segments: the panel's sections under the hands ------------------------------------------
var SEGMENTS = [
  { id: "preset", label: "Preset", rect: [4, 2, 194, 100], keys: ["preset", "morph"] },
  { id: "shape", label: "Shape", rect: [204, 2, 232, 100], keys: ["morph", "bulge", "pinch", "spikes", "tilt", "wobble"] },
  { id: "amp", label: "Amp", rect: [646, 2, 310, 100], keys: ["attack", "decay", "sustain", "release"] }
];
function segLabel(v) {
  var ss = v.$segments || SEGMENTS;
  for (var i = 0; i < ss.length; i++) if (ss[i].id === v.$segment) return ss[i].label;
  return "";
}
// Pung's default pages in Bouba-Kiki's colours and its own thin rings
push.theme({ ground: GROUND, panel: PANEL, ink: INK, dim: INK_DIM, rule: RULE, accent: INK, knob: "ring" });
push.compartment({
  id: "shape", label: "Shape", front_panel: true,
  pages: [
    { label: "Shape", keys: ["morph", "bulge", "pinch", "spikes", "tilt", "wobble", "attack", "release"] },
    { label: "Envelope", keys: ["attack", "decay", "sustain", "release", "preset"] }
  ],
  segments: SEGMENTS, draws_segments: true,
  extra_keys: ["preset_name", "visual", "morph", "bulge", "pinch", "spikes", "tilt", "wobble", "decay", "sustain", "preset"],
  live_keys: ["visual"],
  screen: SCREEN
});
function SCREEN(g, v) {
    var s = shapeNow(v), t = v.$touched || "";
    ground(g, v);
    titleBlock(g, v, s);
    stage(g, s, false);
    wave(g, s, shapeColor(s.p.morph));
    g.envelope(ENV.x, ENV.y, ENV.w, ENV.h, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", color: INK, labels: true });
    row(g, v, s);
}

// The engine's own times (synth.c, seconds()): attack .002 + 2a^2, decay
// .005 + 4d^2 from full to the sustain, release .01 + 4r^2, all linear.
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    var x = clamp01(parseFloat(s.raw));
    if (s.key === "attack") return 0.002 + 2 * x * x;
    if (s.key === "decay") return 0.005 + 4 * x * x;
    if (s.key === "release") return 0.01 + 4 * x * x;
    return null;
  });
});

// how the values read everywhere: the engine's seconds, the shape's terms in
// hundredths (Tilt either side of upright), the preset by its number
push.display(function (key, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return;
  var ms = function (s) { return s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(2) + " s"; };
  switch (key) {
  case "attack": return ms(0.002 + 2 * x * x);
  case "decay": return ms(0.005 + 4 * x * x);
  case "release": return ms(0.01 + 4 * x * x);
  case "sustain": return Math.round(x * 100) + "%";
  case "tilt": var t = Math.round((x - 0.5) * 200); return (t > 0 ? "+" : "") + t;
  case "preset": return String(Math.round(x) + 1);
  case "morph": case "bulge": case "pinch": case "spikes": case "wobble": return String(Math.round(x * 100));
  }
});
