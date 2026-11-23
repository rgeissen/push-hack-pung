// setBfree (a tonewheel organ with its rotary cabinet) on Push.
// An overlay shipped with Pung (the module ships no push_ui.js).
//
// The organ's face is its console: a walnut cabinet, nine drawbars pulled out
// of a black well in their three colours (brown: the sub-octave and the
// sub-third, white: the octaves of the fundamental, black: the fifths and
// thirds above), numbered on the shaft as the organ numbers them, the
// registration read across them as organists write it ("88 8000 000"), the
// vibrato / chorus selector with its six positions, white rocker tabs for the
// vibrato and the percussion, and the rotary cabinet's half-moon switch.
//
//   ORGAN        the console: every drawbar, tab and switch, the overdrive
//                and the cabinet; its sections are the segments
//   DRAWBARS     the registration as the ear has it: each footage a partial
//                at its pitch (the 5 1/3' stands above the 8'), as loud as
//                its bar is out, the percussion's partial beside them
//   PERCUSSION   the tap on the attack: its decay (setBfree's own times and
//                levels), the partial it sounds, and the 1' bar it takes
//   VIBRATO      the scanner: V1..V3 and C1..C3 as setBfree makes them (its
//                delay line's swing at the scanner's speed, in cents)
//   DRIVE        the swell pedal and the tube's curve as setBfree's preamp
//                bends it
//   LESLIE       horn and drum turning at the speeds setBfree gives them,
//                speeding up and slowing down with their own inertia
//
// Numbers from setBfree's source (src/setbfree): tonegen.c (drawbar gains
// u/8, percussion 1 s / 4 s to -60 dB, soft -6 dB, the 1' bus muted while
// the percussion is on), vibrato.c (scanner swing 3 / 6 / 9 samples),
// overdrive.c (the transfer curve, the gains), whirl.c (rotor speeds and
// their time constants).

function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function idx(v, k, n, d) { return Math.max(0, Math.min(n - 1, Math.round(raw(v, k, d === undefined ? 0 : d)))); }
function on(v, k) { return known(v, k) && raw(v, k, 0) >= 0.5; }

// ---- setBfree's own numbers ------------------------------------------------------------------
var FOOT = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"];
var RATIO = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];                 // each footage's pitch against the 8'
var INTERVAL = ["SUB", "SUB 3RD", "FUND", "8VE", "12TH", "15TH", "17TH", "19TH", "22ND"];
var COLOUR = ["b", "b", "w", "w", "k", "w", "k", "k", "w"];   // the handle: brown, white, black
var BAR = ["drawbar_0", "drawbar_1", "drawbar_2", "drawbar_3", "drawbar_4", "drawbar_5", "drawbar_6", "drawbar_7", "drawbar_8"];
var VIB = ["V1", "C1", "V2", "C2", "V3", "C3"];
var ROTARY = ["SLOW", "STOP", "FAST"];
// whirl.c: rotor speeds (RPM) and the first-order time constants (s) toward them
var HORN_RPM = [60 * 0.672, 0, 60 * 7.056], DRUM_RPM = [60 * 0.600, 0, 60 * 5.955];
var HORN_ACC = 0.161, HORN_DEC = 0.321, DRUM_ACC = 4.127, DRUM_DEC = 1.371;
// vibrato.c: the scanner's delay line swings +-3, 6, 9 samples (at 48 kHz) at its speed
var SCAN_AMP = [3, 6, 9];
function scanCents(depth, hz) { return 1200 * Math.log(1 + 2 * Math.PI * hz * SCAN_AMP[depth] / 48000) / Math.LN2; }
// overdrive.c: gains from the 0..127 the wrapper sends, the tube's static curve
function cc(f) { return Math.round(Math.max(0, Math.min(1, f)) * 127); }
function inGain(f) { return 0.001 + 9.999 * cc(f) / 127; }
function outGain(f) { return 0.1 + 9.9 * cc(f) / 127; }
var BIAS = 0.5347, NORM = 1 - 1 / (1 + BIAS * BIAS);
function tube(u) {
  if (u < 0) { var a = u - BIAS; return 1 / (1 + a * a) - 1 + NORM; }
  var b = u + BIAS; return 1 - NORM - 1 / (1 + b * b);
}
function db(g) { var d = 20 * Math.log(g) / Math.LN10; return (d >= 0 ? "+" : "") + d.toFixed(1); }

// how the module's values read, everywhere Pung writes them
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  switch (key) {
  case "vibrato_speed": return { value: n.toFixed(2), unit: "Hz" };
  case "od_input": return { value: db(inGain(n)), unit: "dB" };
  case "od_output": return { value: db(outGain(n)), unit: "dB" };
  case "od_character": case "reverb_mix": case "volume": return { value: String(Math.round(n * 100)), unit: "%" };
  }
});

// ---- the console's colours ---------------------------------------------------------------------
var WOOD = "#4b2a16", WOOD_DK = "#2a170b", WOOD_LT = "#714429", WELL = "#0a0705", ROWG = "#1a0e06", RULE = "#3a2414";
var CREAM = "#f3e9d4", LEG = "#d1b48e", DIML = "#8f6d4c", FAINT = "#5c3d26";
// a handle: its colour, its engraving, its lit edge, its shaded edge and the shaft's step lines
var HANDLE = { b: ["#8e4b22", "#f6e8d2", "#c98a5c", "#66330f"], w: ["#efe9dd", "#1b140e", "#ffffff", "#b9ae9c"], k: ["#221d18", "#efe9dd", "#6a5f54", "#3e352d"] };
var IVORY = "#f2e9d4", IVORY_SH = "#a59680", TAB_INK = "#1d130b", TAB_DIM = "#6f6250";
var AMBER = "#ffa02e", AMBER_OFF = "#4c2b12", CHROME = "#cfc8bc", CHROME_DK = "#7c756b";
var KNOB = "#14100c";

// ---- a pixel font for what a drawbar has engraved: its numbers, its fraction -----------------------
// 5 x 7 digits (rows of 5 bits, top first)
var DIG = { "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [31, 2, 4, 2, 1, 17, 14], "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8], "8": [14, 17, 17, 14, 17, 17, 14] };
// 3 x 5 digits for a fraction's numerator and denominator
var MINI = { "1": [2, 6, 2, 2, 7], "2": [6, 1, 2, 4, 7], "3": [6, 1, 2, 1, 6], "5": [7, 4, 6, 1, 6] };
// runs: each row's lit bits as [dx, dy, w], computed once
function runs(rows, w) {
  var out = [];
  for (var y = 0; y < rows.length; y++) {
    var x = 0;
    while (x < w) {
      if (rows[y] & (1 << (w - 1 - x))) {
        var s = x;
        while (x < w && rows[y] & (1 << (w - 1 - x))) x++;
        out.push([s, y, x - s]);
      } else x++;
    }
  }
  return out;
}
var DIGR = {}, MINIR = {};
(function () { var k; for (k in DIG) DIGR[k] = runs(DIG[k], 5); for (k in MINI) MINIR[k] = runs(MINI[k], 3); })();
function glyph(g, r, x, y, col) { for (var i = 0; i < r.length; i++) g.fill(x + r[i][0], y + r[i][1], r[i][2], 1, col); }
// a footage as the handle has it: "16'", or "5" and a fraction 1/3 (numerator up, denominator down)
function footW(i) { var f = FOOT[i]; return f.indexOf("/") < 0 ? f.length * 7 : 7 + 10; }
function foot(g, i, cx, base, col) {
  var f = FOOT[i];
  if (f.indexOf("/") < 0) { g.text(cx, base, f, col, 0); return; }
  var x = Math.round(cx - footW(i) / 2);
  g.text(x, base, f.charAt(0), col, -1);
  glyph(g, MINIR[f.charAt(2)], x + 8, base - 10, col);           // numerator
  for (var s = 0; s < 5; s++) g.fill(x + 13 - s, base - 8 + s, 1, 1, col); // the slash
  glyph(g, MINIR[f.charAt(4)], x + 13, base - 4, col);           // denominator
}

// ---- the parts ---------------------------------------------------------------------------------------
// a drawbar: its shaft out of the well by n steps (numbered 1..n from the handle up), the handle with
// its footage. top: the well's lip; step: pixels a step; hot: under a finger; mute: sounding nothing
var STEP = 8, HANDLE_H = 15, SHAFT = 21;
function drawbar(g, i, cx, top, n, w, mute) {
  var c = HANDLE[COLOUR[i]], hy = top + n * STEP, x = Math.round(cx - SHAFT / 2);
  var body = mute ? FAINT : c[0], ink = mute ? DIML : c[1], rule = mute ? "#4a3020" : c[3];
  if (n > 0) {
    g.fill(x, top, SHAFT, n * STEP, body);
    // the numbers, each in its step: 1 next to the handle, n at the lip (where the setting is read)
    for (var s = 1; s <= n; s++) {
      var y = hy - s * STEP;
      glyph(g, DIGR[String(s)], cx - 2, y, ink);
      g.fill(x, y + STEP - 1, SHAFT, 1, rule);
    }
  }
  // the handle: wider than the shaft, its footage engraved
  g.fill(cx - w / 2, hy, w, HANDLE_H, body);
  if (!mute) { g.fill(cx - w / 2, hy, w, 1, c[2]); g.fill(cx - w / 2, hy + HANDLE_H - 1, w, 1, c[3]); }
  foot(g, i, cx, hy + 12, ink);
}
// a white rocker tab, two words: the one in force is lit (its half up, bright), the other in shade
function tab(g, x, y, w, h, top, bot, which, ok, hot) {
  var half = Math.round(h / 2);
  var upC = which === 0 && ok ? IVORY : IVORY_SH, dnC = which === 1 && ok ? IVORY : IVORY_SH;
  if (hot) { g.fill(x - 2, y - 2, w + 4, h + 4, "slot"); }
  g.fill(x, y, w, half, upC);
  g.fill(x, y + half, w, h - half, dnC);
  g.fill(x, y + half, w, 1, "#5d5243");
  g.text(x + w / 2, y + half / 2 + 5, top, which === 0 && ok ? TAB_INK : TAB_DIM, 0);
  g.text(x + w / 2, y + half + (h - half) / 2 + 5, bot, which === 1 && ok ? TAB_INK : TAB_DIM, 0);
}
// a pointer knob (setBfree's own controls): black cap, cream pointer over a 270-degree travel
var K0 = Math.PI * 0.75, KS = Math.PI * 1.5;
function knob(g, cx, cy, r, f, ok, hot) {
  g.arc(cx, cy, r + 3, K0, KS, 2, "#6a4a30");
  if (ok) g.arc(cx, cy, r + 3, K0, KS * f, 2, hot ? "slot" : LEG);
  g.dot(cx, cy, r, KNOB);
  if (ok) { var a = K0 + KS * f; g.line(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, hot ? "slot" : CREAM); }
}
// the half-moon switch: SLOW (left), STOP (up), FAST (right); its lever at the one in force
function halfmoon(g, cx, cy, r, at, ok, hot, labels) {
  g.arc(cx, cy, r, Math.PI, Math.PI, 2, CHROME_DK);
  g.fill(cx - r - 1, cy, 2 * r + 2, 2, CHROME_DK);
  if (labels) {
    g.text(cx - r - 4, cy + 4, "SLOW", ok && at === 0 ? CREAM : DIML, 1);
    g.text(cx, cy - r - 4, "STOP", ok && at === 1 ? CREAM : DIML, 0);
    g.text(cx + r + 4, cy + 4, "FAST", ok && at === 2 ? CREAM : DIML, -1);
  }
  for (var p = 0; p < 3; p++) {
    var pa = Math.PI + p * Math.PI / 2;
    g.dot(cx + Math.cos(pa) * (r + 4), cy + Math.sin(pa) * (r + 4), 1.5, ok && p === at ? CREAM : DIML);
  }
  if (!ok) return;
  var a = Math.PI + at * Math.PI / 2;
  g.line(cx, cy, cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3), 3, hot ? "slot" : CHROME);
  g.dot(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3), 3, hot ? "slot" : CHROME);
  g.dot(cx, cy, 3, CHROME_DK);
}
// the vibrato / chorus selector: six positions over 240 degrees, V1 lower left round to C3 lower right
function vibAngle(i) { return Math.PI * (150 + 48 * i) / 180; }
function selector(g, cx, cy, r, lr, at, ok, hot, live) {
  for (var i = 0; i < 6; i++) {
    var a = vibAngle(i), lit = ok && i === at;
    g.text(cx + Math.cos(a) * lr, cy + Math.sin(a) * lr + 5, VIB[i], lit ? (hot ? "slot" : live ? CREAM : LEG) : DIML, 0);
  }
  g.dot(cx, cy, r + 2, CHROME_DK);
  g.dot(cx, cy, r, KNOB);
  if (ok) { var b = vibAngle(at); g.line(cx, cy, cx + Math.cos(b) * (r - 1), cy + Math.sin(b) * (r - 1), 2, hot ? "slot" : CREAM); }
}

// ---- the rotary cabinet's motors (whirl.c), run in time ------------------------------------------------
// horn and drum each approach their speed with their own time constant (faster up than down for the
// horn, the drum heavy both ways), so a change of speed drifts them apart and they settle again
var ROT = { t: -1, sel: -1, hs: HORN_RPM[0], ds: DRUM_RPM[0], ha: 0.1, da: 0.6 };
function rotorStep(sel, now) {
  if (ROT.sel < 0) { ROT.sel = sel; ROT.hs = HORN_RPM[sel]; ROT.ds = DRUM_RPM[sel]; }
  ROT.sel = sel;
  if (ROT.t < 0 || now < ROT.t) { ROT.t = now; return; }
  var dt = Math.min(30, now - ROT.t);
  ROT.t = now;
  function run(s, target, acc, dec, ang) {
    var tau = target > s ? acc : dec, e = Math.exp(-dt / tau);
    var turns = (target * dt + (s - target) * tau * (1 - e)) / 60;
    return [target + (s - target) * e, (ang + turns) % 1];
  }
  var h = run(ROT.hs, HORN_RPM[sel], HORN_ACC, HORN_DEC, ROT.ha), d = run(ROT.ds, DRUM_RPM[sel], DRUM_ACC, DRUM_DEC, ROT.da);
  ROT.hs = h[0]; ROT.ha = h[1]; ROT.ds = d[0]; ROT.da = d[1];
}
function settled(sel) { return Math.abs(ROT.hs - HORN_RPM[sel]) < 0.5 && Math.abs(ROT.ds - DRUM_RPM[sel]) < 0.5; }
function sounding(v) { var L = v.$live; return !!(L && L.known && (L.held > 0 || L.level > 0.01)); }
// the time is read (and the picture moves) only while the organ sounds or a motor changes speed
function rotorTick(v, t) {
  var sel = idx(v, "rotary", 3, 0);
  if (ROT.sel !== sel || !settled(sel) || sounding(v)) rotorStep(sel, +t);
  else ROT.t = -1;
  return sel;
}
// the horn seen from above: a bell and its dummy on one axis; past a few turns a second only a blur
function horn(g, cx, cy, r, ang, rpm, col, dim) {
  g.dot(cx, cy, r + 1, "#20130a");
  if (rpm > 150) g.arc(cx, cy, r - 4, 0, Math.PI * 2, 6, dim);
  var a = ang * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), k = r / 15;
  // one horn sounds, the other (blocked) balances it: both flare toward the rim
  function bell(dir, colr) {
    function seg(f0, f1, w) { g.line(cx + dir * c * r * f0, cy + dir * s * r * f0, cx + dir * c * r * f1, cy + dir * s * r * f1, w, colr); }
    seg(0.1, 0.55, Math.max(2, 2 * k)); seg(0.5, 0.78, Math.max(3, 4 * k)); seg(0.75, 0.95, Math.max(5, 7 * k));
  }
  bell(-1, CHROME_DK);
  bell(1, col);
  g.dot(cx, cy, Math.max(2.5, 3 * k), "#20130a");
  g.dot(cx, cy, Math.max(1.5, 2 * k), CHROME_DK);
}
// the drum seen from above: a disc and its scoop (the opening that throws the sound)
function drum(g, cx, cy, r, ang, rpm, col, dim) {
  g.dot(cx, cy, r + 1, "#20130a");
  g.arc(cx, cy, r - 1, 0, Math.PI * 2, 2, dim);
  var a = ang * Math.PI * 2;
  g.arc(cx, cy, r - 3, a - 0.9, 1.8, rpm > 150 ? 3 : 5, col);
  g.dot(cx, cy, 2.5, CHROME);
}

// ---- ORGAN: the console ---------------------------------------------------------------------------------------
// drawbars: centres (three groups as the colours make them), their well
var P = 37, BX0 = 199, LIP = 22;
function barX(i) { return BX0 + i * P + (i >= 2 ? 8 : 0) + (i >= 6 ? 8 : 0); }
var HW = 31; // a handle's width
var TABS = [["perc_enable", "ON", "OFF", 1], ["perc_volume", "NORM", "SOFT", 0], ["perc_decay", "FAST", "SLOW", 1], ["perc_harmonic", "2ND", "3RD", 1]];
// each tab: key, upper word, lower word, the raw value the upper word means
var TAB_X = [536, 574, 612, 650], TAB_W = 32, TAB_Y = 42, TAB_H = 56;
var VTAB = [["vibrato_upper", "UPPER"], ["vibrato_lower", "LOWER"]], VTAB_X = [102, 142];

function registration(v) {
  var s = "";
  for (var i = 0; i < 9; i++) s += known(v, BAR[i]) ? String(idx(v, BAR[i], 9)) : "-";
  return s;
}
// the section legends: [segment, x, y, text, align]; the active segment's lit (draws_segments)
var LEGENDS = [["vibrato", 12, 33, "VIBRATO / CHORUS", -1], ["perc", 593, 33, "PERCUSSION", 0], ["drive", 698, 33, "DRIVE", -1],
  ["leslie", 822, 33, "LESLIE", -1]];
function ground(g, reg, perc, seg) {
  g.fill(0, 0, 960, 104, WOOD);
  g.fill(0, 0, 960, 19, WOOD_DK);
  g.fill(0, 19, 960, 1, WOOD_LT);
  g.value(10, 15, "setBfree", CREAM, -1);
  // the drawbar well, from the 16' to the 1'
  g.fill(barX(0) - 22, LIP - 2, barX(8) - barX(0) + 44, 84, WELL);
  g.fill(barX(0) - 22, LIP - 2, barX(8) - barX(0) + 44, 2, "#000000");
  for (var i = 0; i < 9; i++) {
    var n = reg.charAt(i) === "-" ? 0 : +reg.charAt(i);
    drawbar(g, i, barX(i), LIP, n, HW, i === 8 && perc);
  }
  // the section legends
  // the percussion's tabs stand on a strip of their own
  g.fill(TAB_X[0] - 8, TAB_Y - 4, TAB_X[3] - TAB_X[0] + TAB_W + 16, TAB_H + 8, WOOD_DK);
  g.fill(VTAB_X[0] - 16, TAB_Y + 1, 76, TAB_H + 3, WOOD_DK);
  // the encoder row
  g.fill(0, 104, 960, 56, ROWG);
  g.fill(0, 104, 960, 1, WOOD_LT);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 28 : 44, RULE);
}

function organ(g, v, t) {
  var tk = v.$touched || "", kn = v.$knobs || [], seg = !!v.$segmode, i;
  var reg = registration(v), perc = on(v, "perc_enable");
  g.layer("organ|" + reg + "|" + perc + "|" + seg, function () { ground(g, reg, perc, seg); });
  // the registration as organists write it, each digit over its bar (the 1' grey while the percussion takes it)
  for (i = 0; i < 9; i++) {
    var hot = tk === BAR[i], mute = i === 8 && perc;
    g.value(barX(i), 15, reg.charAt(i), hot ? "slot" : mute ? DIML : CREAM, 0);
    if (hot) {
      var n = reg.charAt(i) === "-" ? 0 : +reg.charAt(i), hy = LIP + n * STEP;
      g.fill(barX(i) - HW / 2, hy, HW, HANDLE_H, "slot");
      foot(g, i, barX(i), hy + 12, "#000000");
    }
  }
  // VIBRATO: the selector, the scanner's speed, its two tabs (no effect with both off; this organ has
  // no lower manual, so LOWER moves nothing either)
  var up = on(v, "vibrato_upper"), live = up;
  selector(g, 46, 68, 11, 27, idx(v, "vibrato_knob", 6, 5), known(v, "vibrato_knob"), tk === "vibrato_knob", live);
  var sp = raw(v, "vibrato_speed", 7.25), sh = tk === "vibrato_speed";
  g.text(46, 100, sp.toFixed(2) + " HZ", sh ? "slot" : live ? LEG : DIML, 0);
  for (i = 0; i < 2; i++) {
    var vk = VTAB[i][0];
    tab(g, VTAB_X[i] - 9, TAB_Y + 17, 34, TAB_H - 17, "ON", "OFF", on(v, vk) ? 0 : 1, known(v, vk), tk === vk);
    g.text(VTAB_X[i] + 8, TAB_Y + 13, VTAB[i][1], tk === vk ? "slot" : i === 1 ? DIML : LEG, 0);
  }
  for (i = 0; i < LEGENDS.length; i++) {
    var L = LEGENDS[i];
    g.text(L[1], L[2], L[3], v.$segment === L[0] ? CREAM : LEG, L[4]);
  }
  // PERCUSSION: four tabs
  for (i = 0; i < 4; i++) {
    var T = TABS[i], which = idx(v, T[0], 2, 0) === T[3] ? 0 : 1;
    tab(g, TAB_X[i], TAB_Y, TAB_W, TAB_H, T[1], T[2], which, known(v, T[0]), tk === T[0]);
  }
  // DRIVE: the swell pedal's level, the jewel, the tube's three controls
  var od = on(v, "od_enable"), dh = tk === "od_enable";
  g.dot(764, 29, 4, od ? AMBER : AMBER_OFF);
  if (dh) g.arc(764, 29, 6, 0, Math.PI * 2, 2, "slot");
  g.text(798, 33, od ? "ON" : "OFF", dh ? "slot" : od ? CREAM : DIML, 1);
  var sw = fr(v, "volume", 0.8), swh = tk === "volume";
  g.text(698, 50, "SWELL", swh ? "slot" : LEG, -1);
  g.text(798, 50, known(v, "volume") ? Math.round(sw * 100) + "%" : "--", swh ? "slot" : CREAM, 1);
  g.fill(698, 56, 100, 4, "#20130a");
  g.fill(698, 56, Math.round(100 * sw), 4, swh ? "slot" : known(v, "volume") ? CREAM : DIML);
  var DK = [["od_character", "CHAR"], ["od_input", "IN"], ["od_output", "OUT"]];
  for (i = 0; i < 3; i++) {
    var kx = 710 + i * 38, kh = tk === DK[i][0];
    knob(g, kx, 78, 7, fr(v, DK[i][0], 0), known(v, DK[i][0]), kh);
    g.text(kx, 101, DK[i][1], kh ? "slot" : od ? LEG : DIML, 0);
  }
  // LESLIE: horn and drum turning, the half-moon, the reverb in front of it
  var sel = rotorTick(v, t), rh = tk === "rotary", stop = sel === 1;
  horn(g, 836, 64, 15, ROT.ha, ROT.hs, stop ? CHROME_DK : CHROME, FAINT);
  drum(g, 874, 64, 15, ROT.da, ROT.ds, stop ? CHROME_DK : CHROME, FAINT);
  g.text(836, 91, "HORN", DIML, 0);
  g.text(874, 91, "DRUM", DIML, 0);
  g.text(855, 102, Math.round(ROT.hs) + "/" + Math.round(ROT.ds) + " RPM", LEG, 0);
  halfmoon(g, 928, 76, 15, sel, known(v, "rotary"), rh, false);
  g.text(928, 98, known(v, "rotary") ? ROTARY[sel] : "--", rh ? "slot" : CREAM, 0);
  var rv = fr(v, "reverb_mix", 0.1), rvh = tk === "reverb_mix";
  g.text(950, 33, "REV " + (known(v, "reverb_mix") ? Math.round(rv * 100) + "%" : "--"), rvh ? "slot" : LEG, 1);
  // the organ takes a second to build its tonewheels; it is silent until then
  var building = known(v, "ready") && raw(v, "ready", 1) < 0.5;
  if (building) g.text(952, 14, "BUILDING THE TONEWHEELS", AMBER, 1);
  // the page, when there are several
  var ps = v.$pages || [];
  if (!seg && !building && ps.length > 1) g.text(952, 14, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  // the encoder row
  encoders(g, v, kn, tk, seg, perc);
}

// ---- the encoder row: each encoder as the console has it ----------------------------------------------------------
var NAMES = { drawbar_0: "16'", drawbar_1: "5 1/3'", drawbar_2: "8'", drawbar_3: "4'", drawbar_4: "2 2/3'", drawbar_5: "2'",
  drawbar_6: "1 3/5'", drawbar_7: "1 1/3'", drawbar_8: "1'", perc_enable: "PERCUSSION", perc_volume: "PERC VOLUME",
  perc_decay: "PERC DECAY", perc_harmonic: "PERC HARMONIC", vibrato_knob: "VIBRATO", vibrato_upper: "VIB UPPER",
  vibrato_lower: "VIB LOWER", vibrato_speed: "SCANNER", od_enable: "DRIVE", od_character: "CHARACTER", od_input: "DRIVE IN",
  od_output: "DRIVE OUT", reverb_mix: "REVERB", rotary: "LESLIE", volume: "SWELL" };
var WORDS = { perc_enable: ["OFF", "ON"], perc_volume: ["NORMAL", "SOFT"], perc_decay: ["SLOW", "FAST"], perc_harmonic: ["THIRD", "SECOND"],
  vibrato_upper: ["OFF", "ON"], vibrato_lower: ["OFF", "ON"], od_enable: ["OFF", "ON"] };
function valueText(v, k, perc) {
  if (!known(v, k)) return "--";
  var n = raw(v, k, 0), d = v[k].display;
  if (BAR.indexOf(k) >= 0) return String(Math.round(n));
  if (WORDS[k]) return WORDS[k][Math.round(n) ? 1 : 0];
  if (k === "vibrato_knob") return VIB[idx(v, k, 6)];
  if (k === "rotary") return ROTARY[idx(v, k, 3)];
  return String(d || n).toUpperCase() + (v[k].unit && String(d).indexOf(v[k].unit) < 0 ? " " + String(v[k].unit).toUpperCase() : "");
}
function encoders(g, v, kn, tk, seg, perc) {
  var top = 110, len = seg ? 28 : 40;
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x0 = c * 120, cx = x0 + 18, hot = k === tk, ok = known(v, k), b = BAR.indexOf(k);
    if (b >= 0) {
      // a small drawbar, out by its setting
      var n = ok ? idx(v, k, 9) : 0, st = (len - 8) / 8, mute = b === 8 && perc, hc = HANDLE[COLOUR[b]];
      g.fill(cx - 7, top - 1, 14, 2, WELL);
      if (n > 0) g.fill(cx - 3, top + 1, 6, n * st, mute ? FAINT : hc[0]);
      g.fill(cx - 8, top + 1 + n * st, 16, 7, hot ? "slot" : mute ? FAINT : hc[0]);
      if (COLOUR[b] === "k" && !hot && !mute) g.fill(cx - 8, top + 1 + n * st, 16, 1, hc[2]);
    } else if (WORDS[k]) {
      var w = Math.round(raw(v, k, 0)) ? 1 : 0;
      tab(g, cx - 8, top + 1, 16, len - 2, "", "", k === "perc_volume" || k === "perc_decay" || k === "perc_harmonic" ? (w ? 1 : 0) : w ? 0 : 1, ok, hot);
    } else if (k === "rotary") {
      halfmoon(g, cx - 2, top + len - 8, 10, idx(v, k, 3), ok, hot, false);
    } else if (k === "vibrato_knob") {
      g.dot(cx, top + len / 2, 11, CHROME_DK);
      g.dot(cx, top + len / 2, 9, KNOB);
      if (ok) { var a = vibAngle(idx(v, k, 6)); g.line(cx, top + len / 2, cx + Math.cos(a) * 8, top + len / 2 + Math.sin(a) * 8, 2, hot ? "slot" : CREAM); }
    } else {
      knob(g, cx, top + len / 2, 8, ok ? v[k].frac : 0, ok, hot);
    }
    var name = NAMES[k] || String((v[k] && v[k].name) || k).toUpperCase();
    if (b === 8 && perc) name = "1'  MUTED";
    g.text(x0 + 38, seg ? 119 : 124, name, hot ? "slot" : LEG, -1, 78);
    var val = valueText(v, k, perc);
    g.value(x0 + 38, seg ? 138 : 148, val, hot ? "slot" : ok ? CREAM : DIML, -1, 78);
  }
}

// Pung's own pages in the console's walnut, its drawbars as faders
push.theme({ ground: WOOD, panel: IVORY, ink: CREAM, dim: LEG, rule: DIML, faint: WOOD_DK, accent: "#e0a060", knob: "fader" });

push.compartment({
  id: "organ", label: "Organ", front_panel: true, draws_segments: true,
  segments: [
    { id: "vibrato", label: "Vibrato", rect: [4, 20, 172, 84], keys: ["vibrato_knob", "vibrato_upper", "vibrato_lower", "vibrato_speed"] },
    { id: "drawbars", label: "Drawbars", rect: [180, 20, 312, 84], keys: ["drawbar_0", "drawbar_1", "drawbar_2", "drawbar_3", "drawbar_4", "drawbar_5", "drawbar_6", "drawbar_7"] },
    { id: "perc", label: "Perc + 1'", rect: [492, 20, 194, 84], keys: ["perc_enable", "perc_volume", "perc_decay", "perc_harmonic", "drawbar_8"] },
    { id: "drive", label: "Drive", rect: [690, 20, 120, 84], keys: ["volume", "od_enable", "od_character", "od_input", "od_output"] },
    { id: "leslie", label: "Leslie", rect: [814, 20, 142, 84], keys: ["rotary", "reverb_mix"] }
  ],
  pages: [
    { label: "Drawbars", keys: ["drawbar_0", "drawbar_1", "drawbar_2", "drawbar_3", "drawbar_4", "drawbar_5", "drawbar_6", "drawbar_7"] },
    { label: "Tabs", keys: ["drawbar_8", "perc_enable", "perc_volume", "perc_decay", "perc_harmonic", "vibrato_knob", "vibrato_upper", "vibrato_lower"] },
    { label: "Cabinet", keys: ["vibrato_speed", "volume", "od_enable", "od_character", "od_input", "od_output", "reverb_mix", "rotary"] }
  ],
  extra_keys: ["ready"],
  screen: organ
});

// ---- the band screens: walnut, each section's legend on its dark strip --------------------------------------------
function band(g, key, strips, extra) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, WOOD);
    for (var i = 0; i < strips.length; i++) {
      var s = strips[i];
      g.fill(s[0], 0, s[1], 13, WOOD_DK);
      g.text(s[0] + 6, 10, s[2], LEG, -1);
      if (s[3]) g.text(s[0] + s[1] - 6, 10, s[3], DIML, 1);
    }
    if (extra) extra();
  });
}
// the encoder columns' centres under a band (where a picture points to its knob)
function colX(c) { return c * 120 + 56; }

// ---- DRAWBARS: the registration as partials ------------------------------------------------------------------------
// each footage at its pitch over four octaves (16' to 1'), as tall as its bar is out (setBfree's gain is the
// setting / 8): the 5 1/3' stands between the 8' and the 4', since it sounds a fifth above the 8'
var LX0 = 46, LX1 = 880, LTOP = 18, LBASE = 58;
function pitchX(r) { return LX0 + (LX1 - LX0) * (Math.log(r) / Math.LN2 + 1) / 4; }
function drawbarsScreen(g, v) {
  var tk = v.$touched || "", perc = on(v, "perc_enable"), i;
  band(g, "bars", [], function () {
    var oct = [0.5, 1, 2, 4, 8];
    for (var o = 0; o < oct.length; o++) g.fill(pitchX(oct[o]), LTOP, 1, LBASE - LTOP, FAINT);
    g.fill(LX0 - 30, LBASE, LX1 - LX0 + 60, 1, DIML);
    g.text(944, 12, "EACH FOOTAGE AT ITS PITCH", DIML, 1);
  });
  for (i = 0; i < 9; i++) {
    var k = BAR[i], x = pitchX(RATIO[i]), ok = known(v, k), n = ok ? idx(v, k, 9) : 0, hot = tk === k;
    var mute = i === 8 && perc, hc = HANDLE[COLOUR[i]], hgt = Math.round((LBASE - LTOP - 4) * n / 8);
    if (n > 0) {
      g.fill(x - 10, LBASE - hgt, 20, hgt, hot ? "slot" : mute ? FAINT : hc[0]);
      if (COLOUR[i] === "k" && !hot && !mute) { g.fill(x - 10, LBASE - hgt, 1, hgt, hc[2]); g.fill(x + 9, LBASE - hgt, 1, hgt, hc[2]); g.fill(x - 10, LBASE - hgt, 20, 1, hc[2]); }
    } else g.fill(x - 10, LBASE - 2, 20, 2, hot ? "slot" : FAINT);
    if (n > 0 || hot) g.text(x, LBASE - hgt - 4, ok ? String(n) : "-", hot ? "slot" : mute ? DIML : CREAM, 0);
    foot(g, i, x, LBASE + 13, hot ? "slot" : mute ? DIML : CREAM);
    g.text(x, LBASE + 25, mute ? "MUTED" : INTERVAL[i], hot ? "slot" : mute ? AMBER : DIML, 0);
  }
  // the percussion's partial beside its footage: the 4' (second) or the 2 2/3' (third), a tap on the
  // attack (soft: 0.5012 of normal, 6 dB down)
  if (perc) {
    var pr = idx(v, "perc_harmonic", 2, 1) ? 2 : 3, px = pitchX(pr) + 16, soft = idx(v, "perc_volume", 2, 0) === 1;
    var ph = Math.round((LBASE - LTOP - 4) * (soft ? 0.5012 : 1));
    for (var d = LBASE - ph; d < LBASE; d += 4) g.fill(px - 1, d, 3, 2, AMBER);
    g.text(px + 6, LBASE - ph + 8, "PERC", AMBER, -1);
  }
}

// ---- PERCUSSION: the tap on the attack ---------------------------------------------------------------------------------
// tonegen.c: from 1.0 (normal) or 0.5012 (soft, -6 dB) down to -60 dB in 1 s (fast) or 4 s (slow), a capacitor's
// exponential; single-triggered: it sounds only when a key is struck with every other key up
function percScreen(g, v) {
  var tk = v.$touched || "", ok = known(v, "perc_enable"), en = on(v, "perc_enable");
  var fast = idx(v, "perc_decay", 2, 1) === 1, soft = idx(v, "perc_volume", 2, 0) === 1, second = idx(v, "perc_harmonic", 2, 1) === 1;
  band(g, "perc", [[0, 476, "THE TAP ON THE ATTACK", ""], [480, 472, "WHAT IT SOUNDS", ""]]);
  // Pung's envelope in its numbered form, so the tap starts at its real level (soft: 0.5012 of normal): an
  // instant rise, the decay (setBfree's exponential, to -60 dB in its time, as a table), nothing after it
  var w = 456, h = 58, x = 10, y = 16, top = soft ? 0.5012 : 1, col = en ? AMBER : DIML, r = 0.001 / top, dec = [];
  for (var j = 0; j <= 32; j++) dec.push(1 - Math.pow(r, j / 32));
  g.envelope(x, y, w, h, { time1: 0, level1: top, time2: fast ? 0.1 : 1, level2: 0, time3: 0, still: true, curves: { time2: dec }, color: col });
  // its seconds: Pung gives a stage 5 % of the width plus 25 % at its knob's end (slow, 4 s, 30 %; fast 7.5 %)
  var span = w - 12, d0 = x + 6 + 0.05 * span, base = y + h - 6;
  for (var s = 0; s <= 4; s++) { var tx = d0 + 0.3 * span * s / 4; g.fill(tx, base + 1, 1, 4, DIML); if (s === 1 || s === 4) g.text(tx, base + 15, s + " S", DIML, 0); }
  var dh = tk === "perc_decay", vh = tk === "perc_volume";
  g.value(x + w - 4, y + 16, fast ? "1 S" : "4 S", dh ? "slot" : en ? CREAM : DIML, 1);
  g.text(x + w - 4, y + 30, (fast ? "FAST" : "SLOW") + " TO -60 DB", dh ? "slot" : LEG, 1);
  g.text(x + w - 4, y + 44, soft ? "SOFT: 6 DB DOWN" : "NORMAL LEVEL", vh ? "slot" : en ? LEG : DIML, 1);
  // what it sounds: the partial (over its footage), the 1' it takes, the rule of the first key
  var X = 494, hh = tk === "perc_harmonic", eh = tk === "perc_enable";
  g.value(X, 38, !ok ? "--" : en ? (second ? "SECOND" : "THIRD") + " HARMONIC" : "PERCUSSION OFF", eh || hh ? "slot" : en ? CREAM : LEG, -1, 300);
  g.text(X, 56, en ? (second ? "THE 4' PITCH, AN OCTAVE UP" : "THE 2 2/3' PITCH, A TWELFTH UP") : "", LEG, -1);
  g.text(X, 76, "ONLY A KEY STRUCK WITH ALL OTHERS UP", DIML, -1);
  // the 1' drawbar, which the percussion takes for itself while it is on
  var n8 = idx(v, "drawbar_8", 9), b8 = tk === "drawbar_8";
  g.fill(846, 18, 34, 64, WELL);
  drawbarMini(g, 8, 863, 20, n8, en, b8);
  g.value(892, 38, "1'", b8 ? "slot" : CREAM, -1);
  g.text(892, 56, en ? "MUTED" : "SOUNDS", en ? AMBER : LEG, -1);
  g.text(892, 70, en ? "BY PERC" : "", DIML, -1);
}
// a drawbar at a smaller step, for a band
function drawbarMini(g, i, cx, top, n, mute, hot) {
  var c = HANDLE[COLOUR[i]], st = 5, body = mute ? FAINT : c[0];
  if (n > 0) g.fill(cx - 6, top, 12, n * st, body);
  g.fill(cx - 12, top + n * st, 24, 12, hot ? "slot" : body);
  if (!hot && !mute) g.fill(cx - 12, top + n * st, 24, 1, c[2]);
}

// ---- VIBRATO: the scanner --------------------------------------------------------------------------------------------
// vibrato.c: a delay line read +-3, 6 or 9 samples around its writer at the scanner's speed; the pitch swings by
// the rate of that change. V: the swung signal alone; C: mixed with the straight one, which beats against it
function vibScreen(g, v) {
  var tk = v.$touched || "", at = idx(v, "vibrato_knob", 6, 5), hz = raw(v, "vibrato_speed", 7.25);
  var up = on(v, "vibrato_upper"), lo = on(v, "vibrato_lower"), ok = known(v, "vibrato_knob");
  band(g, "vib|" + hz.toFixed(2), [[0, 356, "THE SCANNER", ""], [360, 592, "V: VIBRATO ALONE   C: CHORUS, WITH THE STRAIGHT PITCH", "SWING AT " + hz.toFixed(2) + " HZ"]]);
  var live = up, sh = tk === "vibrato_speed";
  // its motion: the scanner turns freely, a sine at its speed
  g.lfo(8, 16, 220, 48, { shape: "Sine", rate: "vibrato_speed", trig: false, color: live ? AMBER : DIML });
  g.value(118, 80, hz.toFixed(2) + " HZ", sh ? "slot" : live ? CREAM : DIML, 0);
  // where it acts: the upper manual (the one played here); this organ has no lower manual
  var uh = tk === "vibrato_upper", lh = tk === "vibrato_lower";
  g.text(244, 32, "UPPER", uh ? "slot" : LEG, -1);
  g.text(344, 32, up ? "ON" : "OFF", uh ? "slot" : up ? CREAM : DIML, 1);
  g.text(244, 50, "LOWER", lh ? "slot" : DIML, -1);
  g.text(344, 50, lo ? "ON" : "OFF", lh ? "slot" : DIML, 1);
  g.text(244, 74, up ? "IN THE SOUND" : "BYPASSED", up ? DIML : AMBER, -1, 116);
  // the six positions: each one's swing as a wave, to scale (20 cents to the edge); chorus adds the
  // straight pitch it beats against
  var kh = tk === "vibrato_knob";
  for (var i = 0; i < 6; i++) {
    var x = 372 + i * 96, depth = i >> 1, chorus = i & 1, c = scanCents(depth, hz), lit = ok && i === at;
    var col = lit ? (kh ? "slot" : up ? AMBER : CREAM) : LEG;
    g.value(x + 40, 32, VIB[i], lit ? (kh ? "slot" : CREAM) : DIML, 0);
    var amp = 14 * Math.min(1, c / 20), cy = 52, pts = [];
    for (var j = 0; j <= 32; j++) pts.push(x + 8 + 64 * j / 32, cy - amp * Math.sin(Math.PI * 2 * 1.5 * j / 32));
    if (chorus) g.fill(x + 8, cy, 65, 2, lit ? CREAM : DIML);
    else g.fill(x + 8, cy, 65, 1, FAINT);
    g.poly(pts, lit ? 2.5 : 2, col);
    g.text(x + 40, 78, "±" + c.toFixed(1) + " CT", lit ? col : DIML, 0);
  }
}

// ---- DRIVE: the swell pedal and the tube ----------------------------------------------------------------------------------
// overdrive.c: the input scaled (In: 0.001..10), through the biased tube's curve (it never gives more than 0.78),
// scaled again (Out: 0.1..10); the swell pedal sits before it, so backing off cleans the tone as well
function driveScreen(g, v) {
  var tk = v.$touched || "", od = on(v, "od_enable"), sw = fr(v, "volume", 0.8);
  var gi = inGain(fr(v, "od_input", 0.26)), go = outGain(fr(v, "od_output", 0.44));
  band(g, "drive", [[0, 236, "SWELL PEDAL", "FIRST"], [240, 400, "THE TUBE AFTER IT", "OUT AGAINST IN"], [644, 308, "HOW HARD", ""]]);
  // the swell pedal from the side: the heel on its hinge, the toe pressed down as far as the pedal is open
  var swh = tk === "volume", hx = 34, hy = 70, len = 118, a = -0.44 * (1 - sw) - 0.05;
  var ex = hx + Math.cos(a) * len, ey = hy + Math.sin(a) * len;
  g.fill(14, 74, 180, 2, WOOD_DK);
  g.line(hx, hy, ex, ey, 10, swh ? "slot" : "#17100b");
  g.line(hx + Math.sin(a) * 5, hy - Math.cos(a) * 5, ex + Math.sin(a) * 5, ey - Math.cos(a) * 5, 2, swh ? "slot" : known(v, "volume") ? CHROME : DIML);
  g.dot(hx, hy, 5, CHROME_DK);
  g.value(226, 36, known(v, "volume") ? Math.round(sw * 100) + "%" : "--", swh ? "slot" : CREAM, 1);
  g.text(226, 52, sw > 0.97 ? "WIDE OPEN" : sw < 0.03 ? "CLOSED" : "OPEN", DIML, 1);
  // the curve: out against in for a signal of full level (setBfree's 1.0) through the pedal
  var X0 = 260, Y0 = 18, W = 180, H = 64, cy = Y0 + H / 2, drive = gi * sw, i;
  g.fill(X0, cy, W, 1, FAINT);
  g.fill(X0 + W / 2, Y0, 1, H, FAINT);
  var pts = [];
  for (i = 0; i <= 48; i++) {
    var x = -1 + 2 * i / 48, y = od ? tube(drive * x) / (1 - NORM) : x * Math.min(1, sw);
    pts.push(X0 + W * i / 48, cy - y * (H / 2 - 2));
  }
  g.poly(pts, 2, od ? AMBER : CREAM);
  var ih = tk === "od_input", oh = tk === "od_output", ch = tk === "od_character", eh = tk === "od_enable";
  g.text(X0 + W + 16, 30, "IN", ih ? "slot" : LEG, -1);
  g.text(X0 + W + 190, 30, db(gi) + " DB", ih ? "slot" : od ? CREAM : DIML, 1);
  g.text(X0 + W + 16, 50, "OUT", oh ? "slot" : LEG, -1);
  g.text(X0 + W + 190, 50, db(go) + " DB", oh ? "slot" : od ? CREAM : DIML, 1);
  g.text(X0 + W + 16, 70, "CHARACTER", ch ? "slot" : LEG, -1);
  g.text(X0 + W + 190, 70, Math.round(fr(v, "od_character", 0.07) * 100) + "%", ch ? "slot" : od ? CREAM : DIML, 1);
  // how hard: the tube's output at the peak of a full-level signal, against what it can give
  var sat = od ? tube(drive) / (1 - NORM) : 0;
  g.dot(664, 30, 5, od ? AMBER : AMBER_OFF);
  if (eh) g.arc(664, 30, 8, 0, Math.PI * 2, 2, "slot");
  g.value(678, 36, od ? "DRIVE ON" : "CLEAN", eh ? "slot" : od ? CREAM : LEG, -1);
  g.fill(664, 54, 270, 6, WOOD_DK);
  if (od) g.fill(664, 54, Math.round(270 * sat), 6, sat > 0.9 ? AMBER : CREAM);
  g.text(664, 78, od ? "FULL SCALE IN: " + Math.round(sat * 100) + "% OF WHAT THE TUBE GIVES" : "THE TUBE IS BYPASSED", od ? LEG : DIML, -1);
}

// ---- LESLIE: horn and drum ------------------------------------------------------------------------------------------------
function leslieScreen(g, v, t) {
  var tk = v.$touched || "", sel = rotorTick(v, t), rh = tk === "rotary", ok = known(v, "rotary");
  band(g, "leslie", [[0, 300, "THE CABINET FROM ABOVE", ""], [304, 648, "ROTOR SPEEDS", "RPM"]], function () {
    // the speed scales: 0 to 450 RPM, the slow and fast speeds marked
    for (var r = 0; r < 2; r++) {
      var y = 32 + r * 26;
      g.fill(420, y, 500, 3, WOOD_DK);
      var M = r ? DRUM_RPM : HORN_RPM;
      for (var m = 0; m < 3; m += 2) { var mx = 420 + 500 * M[m] / 450; g.fill(mx, y - 5, 1, 13, DIML); }
    }
  });
  var stop = sel === 1, col = stop ? CHROME_DK : CHROME;
  horn(g, 66, 45, 28, ROT.ha, ROT.hs, col, FAINT);
  drum(g, 150, 45, 28, ROT.da, ROT.ds, col, FAINT);
  g.text(66, 82, "HORN", DIML, 0);
  g.text(150, 82, "DRUM", DIML, 0);
  halfmoon(g, 246, 58, 20, sel, ok, rh, false);
  g.text(246, 80, ok ? ROTARY[sel] : "--", rh ? "slot" : CREAM, 0);
  var rows = [["HORN", ROT.hs, HORN_RPM[sel]], ["DRUM", ROT.ds, DRUM_RPM[sel]]];
  for (var r = 0; r < 2; r++) {
    var y = 32 + r * 26, x = 420 + 500 * Math.min(450, rows[r][1]) / 450;
    g.text(320, y + 5, rows[r][0], LEG, -1);
    g.text(408, y + 5, String(Math.round(rows[r][1])), CREAM, 1);
    g.fill(420, y, Math.max(0, x - 420), 3, stop ? CHROME_DK : AMBER);
    g.fill(x - 1, y - 6, 3, 15, CREAM);
  }
  var moving = Math.abs(ROT.hs - HORN_RPM[sel]) > 0.5 || Math.abs(ROT.ds - DRUM_RPM[sel]) > 0.5;
  g.text(940, 22, ["SLOW: CHORALE", "STOPPED", "FAST: TREMOLO"][sel] + (moving ? ", ON ITS WAY" : ""), moving ? AMBER : LEG, 1);
  g.text(420, 82, "THE LIGHT HORN GETS THERE AT ONCE, THE HEAVY DRUM TAKES SECONDS", DIML, -1);
}

push.compartment({ id: "drawbars", label: "Drawbars",
  pages: [{ label: "16' - 1 1/3'", keys: ["drawbar_0", "drawbar_1", "drawbar_2", "drawbar_3", "drawbar_4", "drawbar_5", "drawbar_6", "drawbar_7"] },
    { label: "1'", keys: ["drawbar_8"] }],
  extra_keys: ["perc_enable", "perc_harmonic", "perc_volume"], screen: drawbarsScreen });
push.compartment({ id: "percussion", label: "Percussion",
  pages: [{ label: "Percussion", keys: ["perc_enable", "perc_volume", "perc_decay", "perc_harmonic", "drawbar_8"] }], screen: percScreen });
push.compartment({ id: "vibrato", label: "Vibrato",
  pages: [{ label: "Vibrato", keys: ["vibrato_knob", "vibrato_upper", "vibrato_lower", "vibrato_speed"] }], screen: vibScreen });
push.compartment({ id: "drive", label: "Drive",
  pages: [{ label: "Swell & Drive", keys: ["volume", "od_enable", "od_input", "od_output", "od_character"] }], screen: driveScreen });
push.compartment({ id: "leslie", label: "Leslie",
  pages: [{ label: "Leslie", keys: ["rotary", "reverb_mix", "ready"] }], screen: leslieScreen });
