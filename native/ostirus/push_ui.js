// OsTIrus (the Access Virus TI, emulated) on Push.
//
// The TI is played from three knobs its sound designer named: the Soft
// Knobs. Every patch points them at what matters in it and calls them so
// ("Tone", "Phaser", "Fear"), and the TI's display names them right above the
// knobs. So the device opens on a front panel whose display sits over the
// first three encoders and names them, beside the five every Virus player
// reaches for: cutoff, resonance, envelope, and the two sends. Beside the
// display, what the patch is made of: the oscillator models and their waves,
// both filters' responses (live) and how they are wired, the effects that
// are on. The encoder row is the TI's: aluminium caps on the black panel,
// a red arc for where a knob stands.
//
// The other pages follow the synth's sections, eight knobs a page, the same
// knob doing the same job on sibling pages (Attack is always knob 1 of an
// envelope, Rate knob 1 of an LFO). Each has the picture of what its knobs
// do together. docs/NATIVE-MODULES.md, OsTIrus.
//
// The native layer owns every encoder and draws each key's name and value
// under a band screen.

function known(v, k) { return v[k] && v[k].known; }
function frac(v, k, neutral) { return known(v, k) ? v[k].frac : (neutral || 0); }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function num(v, k, d) { var n = parseFloat(known(v, k) ? v[k].value : ""); return isNaN(n) ? (d || 0) : n; }
function on(v, k) { var s = disp(v, k).toLowerCase(); return s !== "" && s !== "off" && s !== "0" && s !== "-"; }
// a signed knob (-64..63) as -1..1: its middle is nothing
function bi(v, k) { return known(v, k) ? (v[k].frac - 0.5) * 2 : 0; }

var RED = "#e1192f", RED_DK = "#5a0b14", BG = "#0b0d12", PANEL = "#161a22", HEAD = "#1f2430", RULE = "#2a303b";
var INK = "#e9edf3", DIM = "#8a93a2", FAINT = "#4b5260", LCD = "#0f1d27", LCD_EDGE = "#24404f", LCD_INK = "#cfeeff", LCD_DIM = "#5f8aa3";
var LED_ON = "#ff3347", LED_OFF = "#3a1218", ALU = "#b8bfc8", ALU_RIM = "#6e7682", ALU_MARK = "#15181d", F2 = "#5fb6ff";
var TAU = Math.PI * 2, A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;

var CACHE = {}, CACHED = 0;
function cached(key, make) {
  var c = CACHE[key];
  if (c) return c;
  if (CACHED > 128) { CACHE = {}; CACHED = 0; }
  CACHED++;
  return (CACHE[key] = make());
}
function wavePts(x, y, w, h, fn) {
  var pts = [], mid = y + h / 2, a = h / 2 - 2, step = w > 120 ? 3 : 2, prev = null;
  for (var px = 0; px <= w; px += step) {
    var s = Math.max(-1, Math.min(1, fn(px / w))), yy = mid - s * a;
    if (prev !== null && Math.abs(yy - prev) > a * 0.45) pts.push(x + px, prev);
    pts.push(x + px, yy);
    prev = yy;
  }
  return pts;
}
function frame(g, x, y, w, h, c) {
  g.line(x, y, x + w, y, 1, c); g.line(x, y + h, x + w, y + h, 1, c);
  g.line(x, y, x, y + h, 1, c); g.line(x + w, y, x + w, y + h, 1, c);
}
function led(g, x, y, lit) { g.dot(x, y, 2.6, lit ? LED_ON : LED_OFF); }
// One OsTIrus plays at a time (the emulator takes most of a Push); a second
// one in the Set waits, silent, and every page says so
function waiting(v) { return disp(v, "status").indexOf("Waiting") === 0; }
function edge(g, v) { // every page carries the TI's red at its left edge
  g.fill(0, 0, 3, g.h, RED);
  if (v && waiting(v)) {
    g.fill(812, 0, 140, 16, RED_DK);
    g.text(882, 12, "WAITING", LED_ON, 0);
  }
}
// a band's heading, top left of its part: lit while one of its knobs is touched
function head(g, x, s, lit, right) { g.text(x, 12, String(s).toUpperCase(), lit ? INK : DIM, right ? 1 : -1); }
// a bar from the middle (a signed amount) or from the left
function bar(g, x, y, w, f, signed, lit, active) {
  g.fill(x, y, w, 2, RULE);
  var c = lit ? "slot" : (active === false ? FAINT : RED);
  if (signed) {
    var mid = x + w / 2, e = x + w * f;
    g.fill(mid, y - 3, 1, 8, FAINT);
    if (Math.abs(f - 0.5) > 0.004) g.fill(Math.min(mid, e), y - 2, Math.max(2, Math.abs(e - mid)), 6, c);
  } else g.fill(x, y - 2, Math.max(f > 0 ? 2 : 0, Math.round(w * f)), 6, c);
}

// ---- waves -----------------------------------------------------------------------
function saw(p) { p -= Math.floor(p); return 1 - 2 * p; }
function pulse(p, pw) { p -= Math.floor(p); return p < pw ? 1 : -1; }
function tri(p) { p -= Math.floor(p); return 1 - 4 * Math.abs(p - 0.5); }
function spectral(p, n) { // a "spectral wave": a sine with the wave number's harmonics
  var s = Math.sin(p * TAU), h = 2 + (n % 7);
  return (s * 0.7 + Math.sin(p * TAU * h) * 0.3 * ((n % 3) / 2 + 0.3));
}
// ---- wavetables ------------------------------------------------------------------
// In Wavetable and Wave PWM an oscillator plays one of the TI's 100
// wavetables: Wave picks the table, Shape is the Index that moves through
// it. The engine reads the tables from the firmware as the DSP holds them
// (wave_view_<osc>: "<waves>:" and then each wave as 64 points of one cycle,
// two hex digits a point; "" while there is nothing yet, "none" when the
// firmware's tables were not found). Between two waves the TI crossfades:
// Index i plays the wave at i * (waves - 1) / 127.
var TABLE_NAMES = ["Sine", "HarmncSweep", "Glass Sweep", "Draw Bars", "Clusters", "Insine Out", "Landing", "Liquid Metal", "Opposition",
  "Overtunes 1", "Overtunes 2", "Scale Trix", "Sine Rider", "Sqr Series", "Upsine Down", "Thumbs Up", "Waterphone", "E-Chime", "Tinkabell",
  "Bellfizz", "Bellentine", "Robot Wars", "Alternator", "Finger Bass", "Fizzybar", "Flutes", "HP Love", "Majestix", "Hotch Potch", "Resynater",
  "Smooth Rough", "Sawsalito", "Bells 1", "Bells 2", "SportReport", "Metal Guru", "Bat Cave", "Acetate", "Buzzbizz", "Buzzpartout", "Vanish",
  "Overbones", "Pulsechecker", "Stratosfear", "Sooty Sweep", "Throaty", "Didgitalis", "Evil", "Chords", "FM Grit", "Bellsarnie", "Octavius",
  "Eat Pulse", "Sinzin", "Sine System", "Clip Sweep", "Roughage", "Waving", "Pling Saw", "E-Peas", "Bump Sweep", "Filter Sqr", "Fourmant",
  "Formantera", "Sundial 1", "Sundial 2", "Sundial 3", "Clipdial 1", "Clipdial 2", "Voxonix", "Solenoid", "KlingKlang", "Violator",
  "Potassium", "Pile Up", "Tincanali", "Sniper", "Squeezy", "Decomposer", "Morfants", "Pingvox", "Adenoids", "Nasal", "Partialism",
  "TableDance", "Cascade", "Prismism", "Friction", "Robotix", "Whizzfizz", "Spangly", "Fluxbin", "Fiboglide", "Fibonice", "Fibonasty",
  "Penetrator", "Blinder", "Element 5", "Bad Signs", "Domina7rix"];
var VIEW_POINTS = 64;
function tableMode(mode) { return mode === "Wavetable" || mode === "Wave PWM"; }
function tableName(v, n) {
  var t = Math.round(num(v, "osc" + n + "_wave_select", 0));
  return (TABLE_NAMES[t] || "TABLE " + t).toUpperCase();
}
// the oscillator's table as parsed waves (one parse a view)
var PARSED = {};
function parseTable(raw) {
  if (!raw || raw === "none") return null;
  var c = PARSED[raw];
  if (c) return c;
  var colon = raw.indexOf(":"), nw = parseInt(raw.substr(0, colon), 10);
  if (!(nw > 0) || raw.length < colon + 1 + nw * VIEW_POINTS * 2) return null;
  var waves = [];
  for (var w = 0; w < nw; w++) {
    var pts = [];
    for (var i = 0; i < VIEW_POINTS; i++) pts.push((parseInt(raw.substr(colon + 1 + (w * VIEW_POINTS + i) * 2, 2), 16) - 128) / 127);
    waves.push(pts);
  }
  var keys = 0;
  for (var k in PARSED) keys++;
  if (keys > 6) PARSED = {};
  return (PARSED[raw] = { n: nw, waves: waves });
}
function tableOf(v, n) { return parseTable(disp(v, "wave_view_" + n)); }
// the wave at a position (0 .. waves-1) in the table: the crossfade the TI plays
function waveAt(T, pos) {
  var a = Math.max(0, Math.min(T.n - 1, Math.floor(pos))), b = Math.min(T.n - 1, a + 1), f = pos - a, out = [];
  for (var i = 0; i < VIEW_POINTS; i++) out.push(T.waves[a][i] * (1 - f) + T.waves[b][i] * f);
  return out;
}
// where the oscillator stands in its table: Index 0..127 as a position
function tablePos(v, n, T) { return Math.max(0, Math.min(127, num(v, "osc" + n + "_shape", 0))) * (T.n - 1) / 127; }
// what the table says when it draws no wave: still reading, or not found
function tableWhy(v, n) {
  var raw = disp(v, "wave_view_" + n);
  return raw === "none" ? "WAVETABLES NOT FOUND IN THIS FIRMWARE" : "READING THE WAVETABLE";
}

// what an oscillator plays in its model, from its shape (0 wave, .5 saw, 1 pulse)
function oscFn(mode, shape, wave, pw, density) {
  if (mode === "HyperSaw") {
    var n = 2 + Math.round(density * 7);
    return function (p) { var s = 0; for (var i = 0; i < n; i++) s += saw(p * (1 + (i - n / 2) * 0.012) + i * 0.137); return s / n * 1.4; };
  }
  if (mode.indexOf("Grain") === 0 || mode.indexOf("Formant") === 0)
    return function (p) { var env = Math.sin(Math.PI * ((p * 2) % 1)); return Math.sin(p * TAU * (3 + wave % 5)) * env; };
  // Classic: wave .. saw .. pulse
  if (shape < 0.5) { var t = shape * 2; return function (p) { return spectral(p, wave) * (1 - t) + saw(p) * t; }; }
  var u = (shape - 0.5) * 2;
  return function (p) { return saw(p) * (1 - u) + pulse(p, 0.5 - pw * 0.45) * u; };
}
function osc3Fn(m) {
  return m === "Saw" || m === "Slave" ? saw : m === "Pulse" ? function (p) { return pulse(p, 0.5); } : m === "Triangle" ? tri
    : m === "Sine" ? function (p) { return Math.sin(p * TAU); } : function (p) { return spectral(p, parseInt(m.replace(/\D/g, ""), 10) || 3); };
}
// an oscillator's wave as a curve; null where there is none to draw (a
// table not read)
function oscCurve(v, n, x, y, w, h, cycles) {
  var p = "osc" + n + "_", mode = disp(v, p + "mode") || "Classic", shape = frac(v, p + "shape", 0.5), wave = num(v, p + "wave_select", 0), pw = frac(v, p + "pulsewidth", 0.5);
  if (tableMode(mode)) {
    var T = tableOf(v, n);
    if (!T) return null;
    var pos = tablePos(v, n, T);
    return cached(["t", n, x, y, w, h, cycles, disp(v, "wave_view_" + n).length, wave, pos.toFixed(3)].join("|"), function () {
      // the wave's own points, every one: a table's waves are smooth sums of
      // harmonics, no edge to square off
      var wv = waveAt(T, pos), pts = [], mid = y + h / 2, a = h / 2 - 2, m = cycles * VIEW_POINTS;
      for (var j = 0; j <= m; j++) pts.push(x + j / m * w, mid - wv[j % VIEW_POINTS] * a);
      return pts;
    });
  }
  return cached(["o", n, x, y, w, h, cycles, mode, shape.toFixed(2), wave, pw.toFixed(2)].join("|"), function () {
    var f = oscFn(mode, shape, wave, pw, shape);
    return wavePts(x, y, w, h, function (q) { return f(q * cycles); });
  });
}
// The table as a landscape: its first wave in front, its last at the back,
// each one hiding what stands behind it; the wave the oscillator plays (its
// Index, between two of the drawn ones) lit where it stands.
function landscape(g, v, n, x, y, w, h, lit) {
  var T = tableOf(v, n), rows = 16;
  if (!T) {
    g.text(x + w / 2, y + h / 2 + 4, tableWhy(v, n), FAINT, 0, w - 12);
    return;
  }
  var dx = Math.floor((w * 0.42) / (rows - 1)), dy = (h * 0.5) / (rows - 1), ww = w - dx * (rows - 1) - 4, amp = h * 0.24;
  var pos = tablePos(v, n, T), r = T.n > 1 ? pos / (T.n - 1) * (rows - 1) : 0;
  function rowPts(depth, wave) {
    var bx = x + depth * dx, by = y + h - amp - 2 - depth * dy, pts = [];
    for (var j = 0; j <= VIEW_POINTS; j++) pts.push(bx + j / VIEW_POINTS * ww, by - wave[j % VIEW_POINTS] * amp);
    return { pts: pts, base: by + amp + 2 };
  }
  // back to front, each row hiding what stands behind it; the playing wave
  // over them all, where it stands
  for (var i = rows - 1; i >= 0; i--) {
    var p = rowPts(i, waveAt(T, T.n > 1 ? i / (rows - 1) * (T.n - 1) : 0));
    g.area(p.pts, p.base, PANEL);
    g.poly(p.pts, 1, i % 5 === 0 ? DIM : FAINT);
  }
  g.poly(rowPts(r, waveAt(T, pos)).pts, 2, lit ? "slot" : RED);
}

// ---- the front panel ---------------------------------------------------------------
var PANEL_KEYS = ["soft1", "soft2", "soft3", "cutoff", "filter1_resonance", "filter1_env_amt", "delay_send", "reverb_send"];
function softName(v, k) {
  var sn = disp(v, k + "_name");
  return sn && sn !== "-" ? sn : "";
}
function tile(g, x, w, label) {
  g.fill(x, 24, w, 76, PANEL);
  g.fill(x, 24, w, 13, HEAD);
  g.text(x + 6, 34, label, DIM, -1);
}
// The encoder row's geometry: in segment mode the bottom 18 pixels are
// Pung's (the segments' names), so the row draws tighter, above y 142.
var ROW = { name: 119, ky: 139, cap: 11.5, arc: 17, mark: 10.5, val: 146, rule: 44 };
var ROW_SEG = { name: 116, ky: 130, cap: 8.5, arc: 11.5, mark: 7.5, val: 136, rule: 30 };
function panelGround(g, knobs, R) {
  g.fill(0, 0, 960, 160, BG);
  g.fill(0, 0, 960, 20, "#10131a");
  g.fill(0, 19, 960, 1, RED);
  g.value(10, 16, "OSTIRUS", RED, -1);
  // the display, over the three Soft Knobs it names
  g.fill(6, 23, 350, 78, LCD_EDGE);
  g.fill(7, 24, 348, 76, LCD);
  tile(g, 364, 196, "OSCILLATORS");
  tile(g, 566, 196, "FILTERS");
  tile(g, 768, 186, "EFFECTS");
  // the encoder row: the TI's aluminium caps on the black panel
  g.fill(0, 103, 960, 57, "#0e1117");
  g.fill(0, 103, 960, 1, RULE);
  for (var c = 0; c < 8; c++) {
    if (c) g.fill(c * 120, 110, 1, R.rule, RULE);
    if (!knobs[c]) continue;
    var kx = c * 120 + 28, ky = R.ky;
    g.arc(kx, ky, R.arc, A0, SWEEP, 2, RULE);
    g.dot(kx, ky, R.cap + 1.5, ALU_RIM); g.dot(kx, ky, R.cap, ALU);
  }
}
function lcd(g, v) {
  if (waiting(v)) {
    g.text(16, 38, "OSTIRUS", LCD_DIM, -1);
    g.value(16, 66, "WAITING", LCD_INK, -1, 330);
    g.text(16, 90, "ANOTHER OSTIRUS IS PLAYING. ONE AT A TIME", LCD_DIM, -1, 330);
    return;
  }
  var n = num(v, "preset", 0) + 1;
  g.text(16, 38, (disp(v, "bank_name") || "ROM").toUpperCase() + "  " + ("00" + n).slice(-3), LCD_DIM, -1);
  g.text(346, 38, disp(v, "category").toUpperCase(), LCD_DIM, 1);
  g.value(16, 66, disp(v, "preset_name") || "--", LCD_INK, -1, 330);
  // how it plays: keys, voices a key, transpose, the arpeggiator
  var uni = disp(v, "unison_mode"), arp = disp(v, "arp_mode"), tr = disp(v, "transpose");
  var st = [(disp(v, "key_mode") || "--").toUpperCase(), uni && uni !== "Off" ? "UNISON " + uni.toUpperCase() : "",
    tr && tr !== "0" ? "TRANSPOSE " + tr : "", arp && arp !== "Off" ? "ARP " + arp.toUpperCase() : ""];
  for (var i = 0, x = 16; i < st.length; i++) {
    if (!st[i]) continue;
    g.text(x, 90, st[i], i ? LCD_DIM : LCD_INK, -1);
    x += g.measure(st[i]) + 16;
  }
  // the Soft Knobs: the display names them, over their encoders (the row below)
  for (var j = 0; j < 3; j++) g.fill(59 + j * 120, 97, 2, 3, LCD_DIM);
}
function panel(g, v) {
  var t = v.$touched || "", knobs = v.$knobs || [];
  var R = v.$segmode ? ROW_SEG : ROW;
  g.layer("ground|" + knobs.join(",") + "|" + (v.$segmode ? 1 : 0), function () { panelGround(g, knobs, R); });
  segmentLit(g, v);
  var model = disp(v, "model");
  g.text(10 + g.measure("OSTIRUS", "value") + 10, 15, model.toUpperCase(), INK, -1);
  lcd(g, v);
  // the oscillators: their models, and what each puts out
  for (var o = 1; o <= 3; o++) {
    var y = 44 + (o - 1) * 19, m = disp(v, "osc" + o + "_mode"), live = o < 3 || on(v, "osc3_mode");
    g.text(372, y + 9, String(o), DIM, -1);
    if (live) {
      var pts = o < 3 ? oscCurve(v, o, 384, y, 58, 14, 2)
        : cached("p3|" + m, function () { var f = osc3Fn(m); return wavePts(384, y, 58, 14, function (q) { return f(q * 2); }); });
      if (pts) g.poly(pts, 1.5, INK);
      else g.fill(384, y + 7, 58, 1, RULE); // a wavetable not read (yet): no wave
    } else g.fill(384, y + 7, 58, 1, RULE);
    g.text(452, y + 9, (m || "--").toUpperCase(), live ? INK : FAINT, -1, 102);
  }
  // the filters: both responses on one axis, live (Pung's filter), and how they are wired
  g.text(756, 34, (disp(v, "filter_routing") || "").toUpperCase().replace(" MODE", ""), DIM, 1);
  g.filter(570, 38, 188, 50, { cutoff: "cutoff2", resonance: "filter2_resonance", type: "filter2_mode", color: F2 });
  g.filter(570, 38, 188, 50, { cutoff: "cutoff", resonance: "filter1_resonance", type: "filter1_mode", color: RED });
  g.text(574, 96, "1 " + (disp(v, "filter1_mode") || "--").toUpperCase(), RED, -1, 90);
  g.text(756, 96, "2 " + (disp(v, "filter2_mode") || "--").toUpperCase(), F2, 1, 90);
  // the effects: lit when on
  var fx = [["DELAY", on(v, "delay_send")], ["REVERB", on(v, "reverb_mode") && on(v, "reverb_send")], ["CHORUS", on(v, "chorus_type")],
    ["PHASER", on(v, "phaser_mix")], ["DISTORT", on(v, "distortion_curve")], ["ARP", on(v, "arp_mode")]];
  for (var i = 0; i < fx.length; i++) {
    var fx_x = 778 + (i % 2) * 90, fx_y = 54 + Math.floor(i / 2) * 18;
    led(g, fx_x + 3, fx_y - 4, fx[i][1]);
    g.text(fx_x + 12, fx_y, fx[i][0], fx[i][1] ? INK : FAINT, -1);
  }
  row(g, v);
}
// The encoder row, the TI's: an aluminium cap with its dark mark, a red arc
// for where the knob stands (from the top for a signed one), the name above
// (a Soft Knob's in the display's colours: the patch names it) and the value
// beside the cap. The touched one in the slot's colour.
function row(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "", R = v.$segmode ? ROW_SEG : ROW;
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, kx = x0 + 28, ky = R.ky, soft = /^soft[123]$/.test(k);
    var name = soft ? (softName(v, k) || "SOFT " + k.charAt(4)) : String(v[k].name);
    if (soft) {
      var w = Math.min(112, g.measure(name.toUpperCase()) + 10);
      g.fill(x0 + 60 - w / 2, R.name - 10, w, 13, hot ? "slot" : LCD);
      g.text(x0 + 60, R.name, name.toUpperCase(), hot ? "black" : LCD_INK, 0, 104);
    } else g.text(x0 + 60, R.name, name.toUpperCase(), hot ? "slot" : DIM, 0, 110);
    var val = "--", unit = "";
    if (known(v, k)) {
      var f = v[k].frac, d = String(v[k].display || v[k].value), c = hot ? "slot" : RED;
      val = d; unit = String(v[k].unit || "");
      if (/^[+-]\d/.test(d)) { // signed: from the top
        var sw = (f - 0.5) * SWEEP;
        if (sw >= 0) g.arc(kx, ky, R.arc, Math.PI * 1.5, sw, 3, c); else g.arc(kx, ky, R.arc, Math.PI * 1.5 + sw, -sw, 3, c);
      } else if (f > 0) g.arc(kx, ky, R.arc, A0, SWEEP * f, 3, c);
      var a = A0 + f * SWEEP;
      g.line(kx + Math.cos(a) * 3, ky + Math.sin(a) * 3, kx + Math.cos(a) * R.mark, ky + Math.sin(a) * R.mark, 2.5, ALU_MARK);
    }
    var uw = unit ? g.measure(unit) + 3 : 0, cx = x0 + 84;
    var vw = Math.min(g.measure(val, "value"), 64 - uw);
    g.value(cx - (vw + uw) / 2, R.val, val, hot ? "slot" : INK, -1, 64 - uw);
    if (unit) g.text(cx - (vw + uw) / 2 + vw + 3, R.val, unit, DIM, -1);
  }
}

// The panel's sections, each one press away (segment mode): the display and
// the Soft Knobs it names, the oscillators, the filters, the effects.
var SEGMENTS = [
  { id: "soft", label: "Soft Knobs", rect: [6, 23, 350, 78], keys: ["soft1", "soft2", "soft3", "patch_volume", "key_mode", "unison_mode", "unison_detune", "transpose"] },
  { id: "osc", label: "Oscillators", rect: [364, 24, 196, 76], keys: ["osc1_mode", "osc1_shape", "osc2_mode", "osc2_shape", "osc_balance", "osc2_semitone", "osc3_mode", "suboscillator_volume"] },
  { id: "filter", label: "Filters", rect: [566, 24, 196, 76], keys: ["cutoff", "filter1_resonance", "filter1_env_amt", "filter1_mode", "cutoff2", "filter2_resonance", "filter2_mode", "filter_routing"] },
  { id: "fx", label: "Effects", rect: [768, 24, 186, 76], keys: ["delay_send", "delay_time", "delay_feedback", "reverb_send", "reverb_time", "chorus_mix", "phaser_mix", "distortion_intensity"] }
];
// the segment the encoders play (Pung's bar over it): its heading lit in the
// slot's colour
function segmentLit(g, v) {
  if (v.$segmode !== "segment" || !v.$segment) return;
  for (var i = 0; i < SEGMENTS.length; i++) {
    var s = SEGMENTS[i];
    if (s.id === v.$segment && s.id !== "soft") g.text(s.rect[0] + 6, 34, s.label.toUpperCase(), "slot", -1);
  }
}
push.compartment({
  id: "virus", label: "OsTIrus", front_panel: true, segments: SEGMENTS, draws_segments: true,
  pages: [{ label: "Panel", keys: ["soft1", "soft2", "soft3", "cutoff", "filter1_resonance", "filter1_env_amt", "delay_send", "reverb_send"] }],
  extra_keys: ["status", "soft1_name", "soft2_name", "soft3_name", "preset", "preset_name", "bank_name", "category", "model",
    "osc1_mode", "osc2_mode", "osc3_mode", "filter1_mode", "filter2_mode", "filter_routing", "reverb_mode", "chorus_type",
    "phaser_mix", "distortion_curve", "arp_mode", "unison_mode", "key_mode", "cutoff2", "filter2_resonance", "transpose",
    "osc1_shape", "osc1_wave_select", "osc1_pulsewidth", "osc2_shape", "osc2_wave_select", "osc2_pulsewidth", "wave_view_1", "wave_view_2"],
  screen: function (g, v) { panel(g, v); }
});

// ---- oscillators ---------------------------------------------------------------------
// What each knob means depends on the oscillator's model: the same knob is
// another thing in another model. The screen says it in the model's words.
var MEANS = {
  "HyperSaw": [["SHAPE", "DENSITY"], ["PW", "SPREAD"], ["WAVE", "--"]],
  "Wavetable": [["SHAPE", "INDEX"], ["WAVE", "TABLE"], ["PW", "--"]],
  "Wave PWM": [["SHAPE", "INDEX"], ["WAVE", "TABLE"], ["PW", "PULSE WIDTH"]],
  "Classic": [["SHAPE", "WAVE > SAW > PULSE"], ["WAVE", "SPECTRAL WAVE"], ["PW", "PULSE WIDTH"]]
};
function oscScreen(n) {
  return function (g, v) {
    edge(g, v);
    var p = "osc" + n + "_", mode = disp(v, p + "mode") || "Classic", t = v.$touched || "";
    head(g, 12, "OSC " + n, t.indexOf(p) === 0);
    g.fill(8, 18, 444, 66, PANEL);
    var wl = t === p + "shape" || t === p + "wave_select" || t === p + "pulsewidth";
    if (tableMode(mode)) landscape(g, v, n, 12, 20, 436, 62, wl); // the table it plays, and where in it
    else {
      g.fill(12, 51, 436, 1, RULE);
      g.poly(oscCurve(v, n, 14, 20, 432, 62, 2), 2, wl ? "slot" : RED);
    }
    // the model, and what its knobs are in it
    g.value(470, 30, mode, t === p + "mode" ? "slot" : INK, -1, 280);
    var means = MEANS[mode] || (mode.indexOf("Grain") === 0 || mode.indexOf("Formant") === 0 ? [["SHAPE", "INDEX"], ["WAVE", "TABLE"], ["PW", "--"]] : MEANS.Classic);
    if (tableMode(mode)) { // the table by its name, the Index by its number
      var T = tableOf(v, n);
      means = [["SHAPE", "INDEX " + Math.round(num(v, p + "shape", 0))], ["WAVE", tableName(v, n) + (T && T.n > 1 ? "  " + T.n + " WAVES" : "")], means[2]];
    }
    var keys = [p + "shape", p + "wave_select", p + "pulsewidth"];
    for (var i = 0; i < 3; i++) {
      var lit = t === keys[i], y = 50 + i * 15;
      g.text(470, y, means[i][0], lit ? INK : DIM, -1);
      g.text(520, y, means[i][1], lit ? "slot" : (means[i][1] === "--" ? FAINT : INK), -1, 230);
    }
    // its pitch
    var rows = [["SEMI", p + "semitone"], n === 2 ? ["FINE", "osc2_detune"] : null, ["KEYS", p + "keyfollow"]];
    for (var r = 0, y2 = 30; r < rows.length; r++) {
      if (!rows[r]) continue;
      var lt = t === rows[r][1];
      g.text(800, y2, rows[r][0], lt ? INK : DIM, -1);
      g.text(944, y2, disp(v, rows[r][1]) || "--", lt ? "slot" : INK, 1);
      y2 += 18;
    }
    if (n === 2 && on(v, "osc2_sync")) g.text(944, 84, "SYNCED TO OSC 1", DIM, 1);
  };
}
function labels(g, x, w, names, keys, v) {
  var t = v.$touched || "";
  for (var i = 0; i < names.length; i++) g.text(x + w * (i + 0.5) / names.length, 84, names[i], t === keys[i] ? "slot" : DIM, 0, w / names.length - 4);
}
push.compartment({
  // Mix + FM draws both oscillators: their models and waves are read there too
  id: "osc", label: "Oscillators", extra_keys: ["status", "wave_view_1", "wave_view_2", "osc1_mode", "osc1_shape", "osc1_wave_select",
    "osc1_pulsewidth", "osc2_mode", "osc2_shape", "osc2_wave_select", "osc2_pulsewidth"],
  pages: [
    { label: "Osc 1", keys: ["osc1_mode", "osc1_shape", "osc1_wave_select", "osc1_pulsewidth", "osc1_semitone", "osc1_keyfollow",
      "osc1_wavetable_formantshift", "osc1_wavetable_internal_detune"], screen: oscScreen(1) },
    { label: "Osc 2", keys: ["osc2_mode", "osc2_shape", "osc2_wave_select", "osc2_pulsewidth", "osc2_semitone", "osc2_detune",
      "osc2_keyfollow", "osc2_filt_env_amt"], screen: oscScreen(2) },
    { label: "Osc 3 + Sub", keys: ["osc3_mode", "osc3_volume", "osc3_semitone", "osc3_detune", "suboscillator_volume",
      "suboscillator_shape", "noise_volume", "noise_color"],
      screen: function (g, v) {
        edge(g, v);
        var t = v.$touched || "", m3 = disp(v, "osc3_mode") || "Off", on3 = on(v, "osc3_mode");
        // the third oscillator, the sub an octave down, the noise: what each adds
        head(g, 12, "OSC 3", t.indexOf("osc3_") === 0);
        g.text(232, 12, m3.toUpperCase() + (on3 ? "  " + (disp(v, "osc3_semitone") || "0") : ""), on3 ? INK : FAINT, 1, 150);
        g.fill(8, 18, 226, 66, PANEL);
        if (on3) g.poly(cached("o3|" + m3, function () { var f = osc3Fn(m3); return wavePts(12, 22, 218, 58, function (q) { return f(q * 4); }); }), 2, t.indexOf("osc3_") === 0 ? "slot" : RED);
        else g.text(121, 56, "OFF", FAINT, 0);
        var sq = disp(v, "suboscillator_shape") === "Square", subOn = frac(v, "suboscillator_volume") > 0.01;
        head(g, 248, "SUB", t.indexOf("suboscillator_") === 0);
        g.text(468, 12, (disp(v, "suboscillator_shape") || "").toUpperCase() + "  -1 OCT", subOn ? INK : FAINT, 1);
        g.fill(244, 18, 226, 66, PANEL);
        g.poly(cached("sub|" + sq, function () { return wavePts(248, 22, 218, 58, function (q) { return sq ? pulse(q * 2, 0.5) : tri(q * 2); }); }), 2,
          t.indexOf("suboscillator_") === 0 ? "slot" : (subOn ? RED : FAINT));
        head(g, 486, "NOISE", t.indexOf("noise_") === 0);
        var nc = bi(v, "noise_color"), nOn = frac(v, "noise_volume") > 0.01;
        g.text(704, 12, nc < -0.05 ? "DARK" : nc > 0.05 ? "BRIGHT" : "WHITE", nOn ? INK : FAINT, 1);
        g.fill(480, 18, 226, 66, PANEL);
        if (nOn) g.poly(cached("nz|" + nc.toFixed(1), function () { return wavePts(484, 22, 218, 58, function (q) { var i = Math.floor(q * (60 + nc * 50)); var x = Math.sin(i * 127.1 + 311.7) * 43758.5; return ((x - Math.floor(x)) * 2 - 1) * 0.9; }); }), 1.5,
          t.indexOf("noise_") === 0 ? "slot" : RED);
        else g.text(593, 56, "OFF", FAINT, 0);
        // their levels (Pung's mixer)
        g.mix(722, 2, 222, 74, ["osc3_volume", "suboscillator_volume", "noise_volume"]);
        labels(g, 722, 222, ["OSC 3", "SUB", "NOISE"], ["osc3_volume", "suboscillator_volume", "noise_volume"], v);
      } },
    { label: "Mix + FM", keys: ["osc_balance", "osc_mainvolume", "osc2_fm_amount", "osc_fm_mode", "osc2_sync", "fm_filt_env_amt",
      "ringmodulator_volume", "punch_intensity"],
      screen: function (g, v) {
        edge(g, v);
        var t = v.$touched || "", b = frac(v, "osc_balance", 0.5);
        // the balance: oscillator 1 on the left, 2 on the right, the mix of them between
        head(g, 12, "BALANCE", t === "osc_balance");
        g.text(300, 12, disp(v, "osc_balance") || "--", t === "osc_balance" ? "slot" : INK, 1);
        g.fill(8, 18, 296, 40, PANEL);
        var c1 = oscCurve(v, 1, 12, 20, 140, 36, 2), c2 = oscCurve(v, 2, 160, 20, 140, 36, 3);
        if (c1) g.poly(c1, 1.5, b < 0.75 ? INK : FAINT); else g.fill(12, 38, 140, 1, RULE);
        if (c2) g.poly(c2, 1.5, b > 0.25 ? INK : FAINT); else g.fill(160, 38, 140, 1, RULE);
        g.text(14, 74, "OSC 1", b < 0.5 ? INK : DIM, -1); g.text(300, 74, "OSC 2", b > 0.5 ? INK : DIM, 1);
        g.fill(60, 70, 196, 2, RULE);
        g.fill(60 + Math.round(190 * b), 64, 6, 14, t === "osc_balance" ? "slot" : RED);
        // frequency modulation: what oscillator 2 does to 1
        var fm = frac(v, "osc2_fm_amount", 0), sync = on(v, "osc2_sync");
        head(g, 326, "FM  " + (disp(v, "osc_fm_mode") || ""), t === "osc2_fm_amount" || t === "osc_fm_mode" || t === "fm_filt_env_amt");
        g.text(620, 12, sync ? "SYNC" : "", INK, 1);
        g.fill(322, 18, 302, 66, PANEL);
        g.poly(cached("fm" + fm.toFixed(2) + sync, function () {
          return wavePts(326, 20, 294, 62, function (x) { var p = x * 3; return sync ? saw((p % 1) * 1.6) : Math.sin(p * TAU + fm * 5 * Math.sin(p * TAU * 2)); });
        }), 2, t === "osc2_fm_amount" ? "slot" : (fm > 0.01 || sync ? RED : FAINT));
        // the output stage
        var lv = [["OSC VOL", "osc_mainvolume", true], ["RING MOD", "ringmodulator_volume", false], ["PUNCH", "punch_intensity", false], ["ENV > FM", "fm_filt_env_amt", true]];
        for (var i = 0; i < lv.length; i++) {
          var y = 22 + i * 18, lit = t === lv[i][1];
          g.text(642, y, lv[i][0], lit ? INK : DIM, -1);
          bar(g, 720, y - 4, 150, frac(v, lv[i][1], lv[i][2] ? 0.5 : 0), lv[i][2], lit);
          g.text(944, y, disp(v, lv[i][1]) || "--", lit ? "slot" : INK, 1);
        }
      } }
  ]
});

// ---- filters -------------------------------------------------------------------------
// The TI's two filters and how they are wired (Serial 4, Serial 6, Parallel
// 4, Split): a signal path, the saturation stage between them, which one is
// louder; beside it both responses on one axis, live (Pung's filter).
function fbox(g, x, y, w, h, n, mode, lit, col) {
  g.fill(x, y, w, h, PANEL);
  frame(g, x, y, w, h, lit ? "slot" : col);
  g.text(x + 6, y + 12, "FILTER " + n, lit ? INK : col, -1);
  g.text(x + 6, y + h - 6, String(mode || "--").toUpperCase(), INK, -1, w - 12);
}
function arrow(g, x0, y0, x1, y1) {
  g.line(x0, y0, x1, y1, 1, DIM);
  g.line(x1, y1, x1 - 5, y1 - 3, 1, DIM);
  g.line(x1, y1, x1 - 5, y1 + 3, 1, DIM);
}
function filterScreen(g, v) {
  edge(g, v);
  var t = v.$touched || "", r = disp(v, "filter_routing") || "Serial 4", sat = disp(v, "saturation_curve") || "Off";
  var h1 = t === "cutoff" || t.indexOf("filter1_") === 0, h2 = t === "cutoff2" || t.indexOf("filter2_") === 0;
  var m1 = disp(v, "filter1_mode"), m2 = disp(v, "filter2_mode"), bal = bi(v, "filter_balance");
  head(g, 12, r.replace(" Mode", ""), t === "filter_routing");
  g.text(470, 12, "BALANCE " + (disp(v, "filter_balance") || "--"), t === "filter_balance" ? "slot" : DIM, 1);
  var mid = 52;
  g.text(12, mid + 4, "IN", DIM, -1);
  if (r.indexOf("Serial") === 0) {
    arrow(g, 28, mid, 44, mid);
    fbox(g, 44, mid - 22, 130, 44, 1, m1, h1, RED);
    arrow(g, 174, mid, 192, mid);
    g.fill(192, mid - 14, 84, 28, PANEL); frame(g, 192, mid - 14, 84, 28, t === "saturation_curve" ? "slot" : RULE);
    g.text(234, mid + 4, sat.toUpperCase(), sat === "Off" ? FAINT : INK, 0, 78);
    arrow(g, 276, mid, 294, mid);
    fbox(g, 294, mid - 22, 130, 44, 2, m2, h2, F2);
    arrow(g, 424, mid, 444, mid);
    g.text(448, mid + 4, "OUT", DIM, -1);
    g.text(234, mid - 20, r.indexOf("6") > 0 ? "6 POLES" : "4 POLES", FAINT, 0);
  } else {
    var split = r.indexOf("Split") === 0, ya = 18, yb = 52, bh = 30;
    g.line(28, mid, 40, mid, 1, DIM); g.line(40, ya + bh / 2, 40, yb + bh / 2, 1, DIM);
    arrow(g, 40, ya + bh / 2, 56, ya + bh / 2); arrow(g, 40, yb + bh / 2, 56, yb + bh / 2);
    fbox(g, 56, ya, 160, bh, 1, m1, h1, RED);
    fbox(g, 56, yb, 160, bh, 2, m2, h2, F2);
    // the balance: how much of each is heard
    g.fill(232, ya + 6, 6, bh + yb - ya - 12, RULE);
    g.fill(232, ya + 6 + Math.round((bal + 1) / 2 * (bh + yb - ya - 18)), 6, 6, t === "filter_balance" ? "slot" : INK);
    if (split) {
      arrow(g, 216, ya + bh / 2, 300, ya + bh / 2); g.text(306, ya + bh / 2 + 4, "LEFT", INK, -1);
      arrow(g, 216, yb + bh / 2, 300, yb + bh / 2); g.text(306, yb + bh / 2 + 4, "RIGHT", INK, -1);
    } else {
      g.line(216, ya + bh / 2, 260, ya + bh / 2, 1, DIM); g.line(216, yb + bh / 2, 260, yb + bh / 2, 1, DIM);
      g.line(260, ya + bh / 2, 260, yb + bh / 2, 1, DIM);
      arrow(g, 260, mid, 290, mid); g.text(296, mid + 4, "OUT", DIM, -1);
    }
    g.text(452, 84, "SATURATION " + sat.toUpperCase(), t === "saturation_curve" ? "slot" : (sat === "Off" ? FAINT : DIM), 1, 140);
  }
  if (on(v, "filter2_cutoff_link")) g.text(12, 84, "CUTOFF 2 FOLLOWS CUTOFF 1", FAINT, -1, 260);
  // both responses on one axis: filter 1 in the TI's red, filter 2 in blue
  g.line(478, 6, 478, 82, 1, RULE);
  g.filter(484, 2, 464, 82, { cutoff: "cutoff2", resonance: "filter2_resonance", type: "filter2_mode", color: F2 });
  g.filter(484, 2, 464, 82, { cutoff: "cutoff", resonance: "filter1_resonance", type: "filter1_mode", color: RED });
}
push.compartment({
  id: "filter", label: "Filters",
  pages: [
    { label: "Filters", keys: ["cutoff", "filter1_resonance", "filter1_env_amt", "filter_balance", "cutoff2", "filter2_resonance",
      "filter2_env_amt", "filter_routing"] },
    { label: "Filters +", keys: ["filter1_mode", "filter1_keyfollow", "filter1_env_polarity", "saturation_curve", "filter2_mode",
      "filter2_keyfollow", "filter2_env_polarity", "filter2_cutoff_link"] }
  ],
  extra_keys: ["status", "filter_balance", "saturation_curve", "filter2_cutoff_link", "filter_routing", "filter1_mode", "filter2_mode",
    "cutoff", "cutoff2", "filter1_resonance", "filter2_resonance"],
  screen: filterScreen
});

// ---- envelopes -----------------------------------------------------------------------
// Two at a time, as they work together: the filter and the amplifier, then
// the two free envelopes (sources in the matrix). The Virus's sustain is a
// slope: the plateau falls or rises while the key is held (Pung's envelope
// draws it), said in words beside the name.
var ENVS = [["FILTER ENVELOPE", "filter_env_"], ["AMP ENVELOPE", "amp_env_"], ["ENVELOPE 3", "envelope_3_"], ["ENVELOPE 4", "envelope_4_"]];
function slopeWords(v, p) {
  var d = disp(v, p + "sustain_time");
  if (!d) return "";
  if (/inf/i.test(d)) return "SUSTAIN HOLDS";
  if (/fall/i.test(d)) return "SUSTAIN FALLS";
  return "SLOPE " + d.toUpperCase();
}
function envScreen(page) {
  var a = page < 2 ? 0 : 2;
  return function (g, v) {
    edge(g, v);
    var t = v.$touched || "";
    for (var i = 0; i < 2; i++) {
      var e = ENVS[a + i], x = 4 + i * 476, mine = a + i === page;
      head(g, x + 8, e[0], mine || t.indexOf(e[1]) === 0);
      g.text(x + 462, 12, slopeWords(v, e[1]), mine ? DIM : FAINT, 1);
      g.envelope(x, 16, 468, 70, { attack: e[1] + "attack", decay: e[1] + "decay", sustain: e[1] + "sustain", slope: e[1] + "sustain_time",
        release: e[1] + "release", labels: true, color: mine ? undefined : DIM });
    }
    g.line(478, 6, 478, 82, 1, RULE);
  };
}
var ENV_EXTRA = ["status"];
for (var ei = 0; ei < ENVS.length; ei++) ["attack", "decay", "sustain", "sustain_time", "release"].forEach(function (s) { ENV_EXTRA.push(ENVS[ei][1] + s); });
push.compartment({
  id: "env", label: "Envelopes", extra_keys: ENV_EXTRA,
  pages: [
    { label: "Filter Env", keys: ["filter_env_attack", "filter_env_decay", "filter_env_sustain", "filter_env_sustain_time",
      "filter_env_release", "flt1_envamt_velocity", "flt2_envamt_velocity", "filter_keytrack_base"], screen: envScreen(0) },
    { label: "Amp Env", keys: ["amp_env_attack", "amp_env_decay", "amp_env_sustain", "amp_env_sustain_time", "amp_env_release",
      "amp_velocity", "patch_volume", "panorama"], screen: envScreen(1) },
    { label: "Env 3", keys: ["envelope_3_attack", "envelope_3_decay", "envelope_3_sustain", "envelope_3_sustain_time",
      "envelope_3_release"], screen: envScreen(2) },
    { label: "Env 4", keys: ["envelope_4_attack", "envelope_4_decay", "envelope_4_sustain", "envelope_4_sustain_time",
      "envelope_4_release"], screen: envScreen(3) }
  ]
});

// ---- effects: what the effect does, drawn ----------------------------------------------
// Left, the effect as the TI names it: lit when it is heard, its type, how
// much of it. Right, what its knobs do together: the echoes, the reverb's
// tail, the chorus's LFO, the phaser's notches, the distortion's curve, the
// equalizer's curve.
function fxHead(g, v, name, typeKey, amountKey) {
  var type = typeKey ? disp(v, typeKey) : "", active = amountKey ? on(v, amountKey) : true;
  if (typeKey && (type === "Off" || type === "")) active = false;
  led(g, 14, 9, active);
  g.text(22, 13, name, active ? INK : DIM, -1);
  if (type) g.value(12, 46, type, active ? INK : FAINT, -1, 286);
  if (amountKey) {
    var t = v.$touched || "", lit = t === amountKey;
    g.text(12, 70, String(v[amountKey] ? v[amountKey].name : "").toUpperCase(), lit ? INK : DIM, -1);
    g.text(300, 70, disp(v, amountKey) || "--", lit ? "slot" : INK, 1);
    bar(g, 12, 80, 288, frac(v, amountKey, 0), false, lit, active);
  }
  g.line(316, 6, 316, 82, 1, RULE);
  return active;
}
var PX = 330, PW = 614; // the picture's place
function col(active, lit) { return lit ? "slot" : (active ? RED : FAINT); }
function delayPic(g, v, active) {
  var t = v.$touched || "", fb = frac(v, "delay_feedback", 0), clk = disp(v, "delay_clock"), time = frac(v, "delay_time", 0.3);
  // the dry note, then its echoes: each the feedback's share of the one before
  // across the picture: two bars (a clocked delay's note value) or two seconds
  var nv = { "1/64": 1 / 64, "1/32": 1 / 32, "1/16": 1 / 16, "1/8": 1 / 8, "1/4": 1 / 4, "1/2": 1 / 2, "3/64": 3 / 64, "3/32": 3 / 32, "3/16": 3 / 16, "3/8": 3 / 8 }[clk];
  var step = nv ? nv / 2 : Math.max(0.02, (parseFloat(disp(v, "delay_time")) || time * 700) / 2000);
  var x = PX + 10, h = 66, base = 80, a = 1, lit = t === "delay_time" || t === "delay_feedback" || t === "delay_clock";
  g.fill(PX, base, PW, 1, RULE);
  g.fill(x, base - h, 4, h, INK);
  for (var i = 1; i < 24; i++) {
    a *= Math.max(0.15, fb);
    var ex = x + i * step * PW;
    if (ex > PX + PW - 6 || a < 0.02) break;
    g.fill(ex, base - h * a * 0.85, 5, h * a * 0.85, col(active, lit));
  }
  g.text(PX + PW, 12, (clk && clk !== "Off" ? clk + " (CLOCK)" : disp(v, "delay_time")) + "   FEEDBACK " + (disp(v, "delay_feedback") || "--"), DIM, 1);
}
function reverbPic(g, v, active) {
  var t = v.$touched || "", pre = frac(v, "reverb_predelay", 0), time = frac(v, "reverb_time", 0.5), damp = frac(v, "reverb_damping", 0);
  var x0 = PX + 10, base = 80, h = 64, lit = t.indexOf("reverb_") === 0 && t !== "reverb_send" && t !== "reverb_mode";
  g.fill(PX, base, PW, 1, RULE);
  g.fill(x0, base - h, 4, h, INK);
  var px = x0 + 12 + pre * 120, len = 80 + time * (PW - 160);
  // the tail: dense reflections dying away (damping takes the top off sooner)
  var pts = cached(["rv", px, len, damp.toFixed(2)].join("|"), function () {
    var out = [];
    for (var x = 0; x <= len; x += 3) {
      var u = x / len, e = Math.exp(-u * (3 + damp * 2)) * (0.75 + 0.25 * Math.sin(x * 1.7) * Math.sin(x * 0.37));
      out.push(px + x, base - h * 0.8 * e);
    }
    return out;
  });
  g.area(pts, base, lit ? "slot" : (active ? RED_DK : RULE));
  g.poly(pts, 1.5, col(active, lit));
  if (pre > 0.15) { g.fill(x0 + 6, base - 4, px - x0 - 8, 1, DIM); g.text((x0 + px) / 2 + 4, base - 8, "PRE", DIM, 0); }
  g.text(PX + PW, 12, (disp(v, "reverb_type") || "").toUpperCase() + "   TIME " + (disp(v, "reverb_time") || "--"), DIM, 1);
}
function chorusPic(g, v, active) {
  g.text(PX + 4, 12, "LFO", DIM, -1);
  g.lfo(PX, 16, 300, 70, { shape: "chorus_lfo_shape", rate: "chorus_rate", color: active ? RED : DIM });
  var rows = [["DEPTH", "chorus_depth", false], ["DELAY", "chorus_delay", false], ["FEEDBACK", "chorus_feedback", true], ["X-OVER", "chorus_x_over", false]];
  kv(g, v, rows, PX + 320, active);
}
function kv(g, v, rows, x, active) { // a few knobs as labelled bars
  var t = v.$touched || "";
  for (var i = 0; i < rows.length; i++) {
    var y = 20 + i * 16, lit = t === rows[i][1];
    g.text(x, y, rows[i][0], lit ? INK : DIM, -1);
    bar(g, x + 80, y - 4, 140, frac(v, rows[i][1], rows[i][2] ? 0.5 : 0), rows[i][2], lit, active);
    g.text(PX + PW, y, disp(v, rows[i][1]) || "--", lit ? "slot" : INK, 1);
  }
}
function phaserPic(g, v, active) {
  var t = v.$touched || "", st = Math.max(1, parseInt(disp(v, "phaser_mode"), 10) || 4), fq = frac(v, "phaser_frequency", 0.5);
  var sp = frac(v, "phaser_spread", 0.5), dp = frac(v, "phaser_depth", 0.5), fb = bi(v, "phaser_feedback");
  var lit = t === "phaser_frequency" || t === "phaser_spread" || t === "phaser_mode" || t === "phaser_feedback";
  // its notches across the spectrum: one a stage, spread apart, deeper with feedback
  var pts = cached(["ph", st, fq.toFixed(2), sp.toFixed(2), fb.toFixed(2)].join("|"), function () {
    var out = [], top = 22, base = 80;
    for (var x = 0; x <= PW; x += 3) {
      var u = x / PW, gsum = 1;
      for (var s = 0; s < st; s++) {
        var c = 0.15 + fq * 0.5 + (s - (st - 1) / 2) * (0.05 + sp * 0.12), d = (u - c) / (0.025 + 0.02 * (1 - Math.abs(fb)));
        gsum *= 1 - (0.6 + 0.35 * Math.abs(fb)) * Math.exp(-d * d);
      }
      out.push(PX + x, base - (base - top) * gsum);
    }
    return out;
  });
  g.fill(PX, 80, PW, 1, RULE);
  g.area(pts, 80, active ? RED_DK : RULE);
  g.poly(pts, 2, col(active, lit));
  g.text(PX + PW, 12, st + (st > 1 ? " NOTCHES" : " NOTCH") + "   RATE " + (disp(v, "phaser_rate") || "--") + "   DEPTH " + (disp(v, "phaser_depth") || "--"), DIM, 1);
  void dp;
}
function curveOf(name, u, k) {
  var s = String(name).toLowerCase();
  if (s.indexOf("digital") >= 0) return Math.max(-1, Math.min(1, u * (1 + k * 4)));
  if (s.indexOf("shaper") >= 0) return Math.sin(u * (1.5 + k * 5)) / Math.max(0.3, Math.abs(Math.sin(1.5 + k * 5)));
  if (s.indexOf("rectif") >= 0) return Math.abs(u) * 2 - 1;
  if (s.indexOf("bit") >= 0) { var q = Math.max(2, Math.round(16 - k * 13)); return Math.round(u * q / 2) / (q / 2); }
  if (s.indexOf("rate") >= 0) return Math.round(u * 6) / 6;
  var d = 1 + k * 8 * ({ light: 0.4, soft: 0.7, medium: 1, middle: 1, hard: 1.6 }[s] || 1);
  return Math.tanh(u * d) / Math.tanh(d);
}
function distPic(g, v, active) {
  var t = v.$touched || "", type = disp(v, "distortion_curve") || "Off", k = frac(v, "distortion_intensity", 0);
  var cx = PX + 120, cy = 47, a = 34, lit = t === "distortion_curve" || t === "distortion_intensity";
  // its transfer curve: what comes in (across), what goes out (up)
  g.fill(cx - a, cy, 2 * a, 1, RULE); g.fill(cx, cy - a, 1, 2 * a, RULE);
  if (type !== "Off") {
    var pts = cached(["ds", type, k.toFixed(2)].join("|"), function () {
      var out = [];
      for (var i = -30; i <= 30; i++) { var u = i / 30; out.push(cx + u * a, cy - curveOf(type, u, k) * a * 0.92); }
      return out;
    });
    g.poly(pts, 2, col(active, lit));
  } else g.line(cx - a, cy + a, cx + a, cy - a, 1, FAINT);
  var rows = [["MIX", "patch_distortion_mix", false], ["TREBLE", "patch_distortion_treble_booster", false], ["HIGH CUT", "patch_distortion_high_cut", false],
    ["BASS", "bass_intensity", false]];
  kv(g, v, rows, PX + 280, active);
  g.text(PX + PW, 84, "CHARACTER " + (disp(v, "character_type") || "--").toUpperCase(), t === "character_type" ? "slot" : DIM, 1);
}
function eqPic(g, v) {
  var t = v.$touched || "";
  var lg = bi(v, "loweq_gain"), mg = bi(v, "mideq_gain"), hg = bi(v, "higheq_gain");
  var lf = frac(v, "loweq_frequency", 0.3), mf = frac(v, "mideq_frequency", 0.5), hf = frac(v, "higheq_frequency", 0.7), q = frac(v, "mideq_q_factor", 0.3);
  var lit = /eq_/.test(t);
  // three bands on one curve: a low shelf, a bell, a high shelf (log frequency across)
  var pts = cached(["eq", lg, mg, hg, lf, mf, hf, q].map(function (x) { return typeof x === "number" ? x.toFixed(2) : x; }).join("|"), function () {
    var out = [];
    for (var x = 0; x <= PW; x += 4) {
      var u = x / PW, lo = lg / (1 + Math.exp((u - (0.1 + lf * 0.3)) * 25)), hi = hg / (1 + Math.exp(-(u - (0.55 + hf * 0.35)) * 25));
      var d = (u - (0.2 + mf * 0.6)) / (0.03 + (1 - q) * 0.12), md = mg * Math.exp(-d * d);
      out.push(PX + x, 47 - (lo + md + hi) * 30);
    }
    return out;
  });
  g.fill(PX, 47, PW, 1, RULE);
  for (var gx = 1; gx < 4; gx++) g.fill(PX + PW * gx / 4, 18, 1, 60, "#161a22");
  g.poly(pts, 2, lit ? "slot" : RED);
  // where each band sits
  var bands = [[0.1 + lf * 0.3, "loweq_"], [0.2 + mf * 0.6, "mideq_"], [0.55 + hf * 0.35, "higheq_"]];
  for (var b = 0; b < 3; b++) g.fill(PX + PW * bands[b][0], 70, 2, 6, t.indexOf(bands[b][1]) === 0 ? "slot" : DIM);
  g.text(PX, 84, "LOW " + (disp(v, "loweq_gain") || "--"), t.indexOf("loweq_") === 0 ? "slot" : DIM, -1);
  g.text(PX + PW / 2, 84, "MID " + (disp(v, "mideq_gain") || "--") + "  Q " + (disp(v, "mideq_q_factor") || "--"), t.indexOf("mideq_") === 0 ? "slot" : DIM, 0);
  g.text(PX + PW, 84, "HIGH " + (disp(v, "higheq_gain") || "--"), t.indexOf("higheq_") === 0 ? "slot" : DIM, 1);
}
function fbankPic(g, v, active) {
  var rows = [["FREQUENCY", "filter_bank_frequency", true], ["RESONANCE", "filter_bank_resonance", false], ["SLOPE", "filter_bank_slope", false],
    ["POLES", "filter_bank_poles", false]];
  kv(g, v, rows, PX + 10, active);
  g.text(PX + PW, 84, "STEREO PHASE " + (disp(v, "filter_bank_stereo_phase") || "--"), DIM, 1);
}
function fxScreen(name, typeKey, amountKey, pic) {
  return function (g, v) {
    edge(g, v);
    var active = fxHead(g, v, name, typeKey, amountKey);
    pic(g, v, active);
  };
}
push.compartment({
  id: "fx", label: "Effects", extra_keys: ["status"],
  pages: [
    { label: "Delay", keys: ["delay_type", "delay_send", "delay_time", "delay_feedback", "delay_clock", "dly_rate_rev_decay", "dly_depth", "delay_color"],
      screen: fxScreen("DELAY", "delay_type", "delay_send", delayPic) },
    { label: "Reverb", keys: ["reverb_mode", "reverb_send", "reverb_type", "reverb_time", "reverb_damping", "reverb_color", "reverb_predelay", "reverb_feedback"],
      screen: fxScreen("REVERB", "reverb_mode", "reverb_send", reverbPic) },
    { label: "Chorus", keys: ["chorus_type", "chorus_mix", "chorus_rate", "chorus_depth", "chorus_delay", "chorus_feedback", "chorus_lfo_shape", "chorus_x_over"],
      screen: fxScreen("CHORUS", "chorus_type", "chorus_mix", chorusPic) },
    { label: "Phaser", keys: ["phaser_mode", "phaser_mix", "phaser_rate", "phaser_depth", "phaser_frequency", "phaser_feedback", "phaser_spread"],
      screen: fxScreen("PHASER", "phaser_mode", "phaser_mix", phaserPic) },
    { label: "Distortion", keys: ["distortion_curve", "distortion_intensity", "patch_distortion_mix", "patch_distortion_treble_booster",
      "patch_distortion_high_cut", "character_type", "bass_intensity", "bass_tune"],
      screen: fxScreen("DISTORTION", "distortion_curve", "distortion_intensity", distPic) },
    { label: "EQ", keys: ["loweq_frequency", "loweq_gain", "mideq_frequency", "mideq_gain", "mideq_q_factor", "higheq_frequency", "higheq_gain"],
      screen: fxScreen("EQUALIZER", null, null, eqPic) },
    { label: "Filter Bank", keys: ["filter_bank_type", "filter_bank_mix", "filter_bank_frequency", "filter_bank_resonance", "filter_bank_slope",
      "filter_bank_poles", "filter_bank_stereo_phase"],
      screen: fxScreen("FILTER BANK", "filter_bank_type", "filter_bank_mix", fbankPic) }
  ]
});

// ---- LFOs ----------------------------------------------------------------------------
function lfoScreen(n, amounts) {
  return function (g, v) {
    edge(g, v);
    var p = "lfo" + n + "_", t = v.$touched || "";
    // clocked, it runs on Live's beat at its note value; key triggered (Off, or the phase it starts at), a note restarts it
    var clocked = disp(v, p + "clock") && disp(v, p + "clock") !== "Off";
    var kt = disp(v, p + "keytrigger");
    head(g, 12, "LFO " + n + "  " + (disp(v, p + "shape") || ""), t.indexOf(p) === 0);
    var clk = disp(v, p + "clock");
    g.text(424, 12, (clk && clk !== "Off" ? clk : "RATE " + (disp(v, p + "rate") || "")).toUpperCase() + (disp(v, p + "mode") === "Mono" ? "  MONO" : ""), DIM, 1);
    g.lfo(4, 16, 424, 70, { shape: p + "shape", rate: clocked ? p + "clock" : p + "rate", trig: kt !== "" && kt !== "Off", color: RED });
    g.line(440, 6, 440, 82, 1, RULE);
    // where it goes, and how much (signed: up or down)
    head(g, 452, "MODULATES", false);
    for (var i = 0; i < amounts.length; i++) {
      var k = amounts[i][0], y = 28 + i * 14, f = frac(v, k, 0.5), lit = t === k, act = Math.abs(f - 0.5) > 0.004;
      g.text(452, y, amounts[i][1], lit ? INK : (act ? DIM : FAINT), -1);
      bar(g, 580, y - 4, 260, f, true, lit, act);
      g.text(944, y, disp(v, k) || "--", lit ? "slot" : (act ? INK : FAINT), 1);
    }
  };
}
var L1 = [["osc1_lfo1_amount", "OSC 1 PITCH"], ["osc2_lfo1_amount", "OSC 2 PITCH"], ["pw_lfo1_amount", "PULSEWIDTH"], ["reso_lfo1_amount", "RESONANCE"], ["filtgain_lfo1_amount", "FILTER GAIN"]];
var L2 = [["shape_lfo2_amount", "SHAPE"], ["fm_lfo2_amount", "FM AMOUNT"], ["cutoff1_lfo2_amount", "CUTOFF 1"], ["cutoff2_lfo2_amount", "CUTOFF 2"], ["pan_lfo2_amount", "PANORAMA"]];
function l3Screen(g, v) {
  edge(g, v);
  var t = v.$touched || "", clocked = disp(v, "lfo3_clock") && disp(v, "lfo3_clock") !== "Off";
  head(g, 12, "LFO 3  " + (disp(v, "lfo3_shape") || ""), t.indexOf("lfo3_") === 0);
  g.text(424, 12, (clocked ? disp(v, "lfo3_clock") : "RATE " + (disp(v, "lfo3_rate") || "")).toUpperCase(), DIM, 1);
  g.lfo(4, 16, 424, 70, { shape: "lfo3_shape", rate: clocked ? "lfo3_clock" : "lfo3_rate", trig: false, color: RED });
  g.line(440, 6, 440, 82, 1, RULE);
  head(g, 452, "MODULATES", false);
  var amt = frac(v, "osc_lfo3_amount", 0), lit = t === "osc_lfo3_amount" || t === "lfo3_destination";
  g.value(452, 44, disp(v, "lfo3_destination") || "--", t === "lfo3_destination" ? "slot" : (amt > 0 ? INK : FAINT), -1, 380);
  bar(g, 452, 60, 380, amt, false, lit, amt > 0);
  g.text(944, 64, disp(v, "osc_lfo3_amount") || "--", lit ? "slot" : INK, 1);
  var fi = frac(v, "lfo3_fade_in_time", 0);
  g.text(452, 82, fi > 0 ? "FADES IN OVER " + disp(v, "lfo3_fade_in_time") : "NO FADE IN", t === "lfo3_fade_in_time" ? "slot" : (fi > 0 ? DIM : FAINT), -1);
}
push.compartment({
  id: "lfo", label: "LFOs",
  pages: [
    { label: "LFO 1", keys: ["lfo1_rate", "lfo1_shape", "lfo1_clock", "lfo1_mode", "lfo1_symmetry", "lfo1_keyfollow", "lfo1_keytrigger",
      "lfo1_env_mode"], screen: lfoScreen(1, L1) },
    { label: "LFO 1 Amounts", keys: ["osc1_lfo1_amount", "osc2_lfo1_amount", "pw_lfo1_amount", "reso_lfo1_amount", "filtgain_lfo1_amount",
      "lfo1_assign_dest", "lfo1_assign_amount"], screen: lfoScreen(1, L1) },
    { label: "LFO 2", keys: ["lfo2_rate", "lfo2_shape", "lfo2_clock", "lfo2_mode", "lfo2_symmetry", "lfo2_keyfollow", "lfo2_keytrigger",
      "lfo2_env_mode"], screen: lfoScreen(2, L2) },
    { label: "LFO 2 Amounts", keys: ["shape_lfo2_amount", "fm_lfo2_amount", "cutoff1_lfo2_amount", "cutoff2_lfo2_amount", "pan_lfo2_amount",
      "lfo2_assign_dest", "lfo2_assign_amount"], screen: lfoScreen(2, L2) },
    { label: "LFO 3", keys: ["lfo3_rate", "lfo3_shape", "lfo3_clock", "lfo3_mode", "lfo3_keyfollow", "lfo3_destination", "osc_lfo3_amount",
      "lfo3_fade_in_time"], screen: l3Screen }
  ],
  // the amounts pages draw the LFO they belong to, so its wave and rate are read there too
  extra_keys: ["status", "osc1_lfo1_amount", "osc2_lfo1_amount", "pw_lfo1_amount", "reso_lfo1_amount", "filtgain_lfo1_amount", "shape_lfo2_amount",
    "fm_lfo2_amount", "cutoff1_lfo2_amount", "cutoff2_lfo2_amount", "pan_lfo2_amount", "osc_lfo3_amount",
    "lfo1_shape", "lfo1_rate", "lfo1_clock", "lfo1_keytrigger", "lfo1_mode", "lfo2_shape", "lfo2_rate", "lfo2_clock", "lfo2_keytrigger", "lfo2_mode"]
});

// ---- the modulation matrix: a source, three destinations, a line as strong as its amount
var SLOT_KEYS = [
  ["assign1_source", "assign1_destination", "assign1_amount", "assign_1_destination_2", "assign_1_amount_2", "assign_1_destination_3", "assign_1_amount_3"],
  ["assign2_source", "assign2_destination1", "assign2_amount1", "assign2_destination2", "assign2_amount2", "assign_2_destination_3", "assign_2_amount_3"],
  ["assign3_source", "assign3_destination1", "assign3_amount1", "assign3_destination2", "assign3_amount2", "assign3_destination3", "assign3_amount3"],
  ["assign_4_source", "assign_4_destination", "assign_4_amount", "assign_4_destination_2", "assign_4_amount_2", "assign_4_destination_3", "assign_4_amount_3"],
  ["assign_5_source", "assign_5_destination", "assign_5_amount", "assign_5_destination_2", "assign_5_amount_2", "assign_5_destination_3", "assign_5_amount_3"],
  ["assign_6_source", "assign_6_destination", "assign_6_amount", "assign_6_destination_2", "assign_6_amount_2", "assign_6_destination_3", "assign_6_amount_3"]
];
function matrixScreen(n) {
  return function (g, v) {
    edge(g, v);
    var k = SLOT_KEYS[n], t = v.$touched || "", src = disp(v, k[0]) || "Off", rows = [], any = false;
    // a destination does something only with a source and an amount: an
    // unused slot keeps its old destinations at amount 0, drawn as off
    for (var d = 0; d < 3; d++) {
      var dk = k[1 + d * 2], ak = k[2 + d * 2], dest = disp(v, dk) || "Off", f = frac(v, ak, 0.5);
      var amt = Math.abs(f - 0.5) * 2, live = src !== "Off" && dest !== "Off" && amt > 0.01;
      rows.push({ dk: dk, ak: ak, dest: dest, f: f, live: live, lit: t === dk || t === ak });
      any = any || live;
    }
    head(g, 12, "SLOT " + (n + 1), false);
    // the source
    g.fill(12, 34, 230, 24, any ? RED_DK : PANEL);
    frame(g, 12, 34, 230, 24, t === k[0] ? "slot" : (any ? RED : RULE));
    g.text(127, 50, src.toUpperCase(), t === k[0] ? "slot" : (any ? INK : FAINT), 0, 220);
    for (var i = 0; i < 3; i++) {
      var r = rows[i], y = 22 + i * 26, shown = r.live || r.lit;
      g.line(242, 46, 470, y, r.live ? 1 + Math.round(Math.abs(r.f - 0.5) * 8) : 1, r.lit ? "slot" : (r.live ? RED : RULE));
      g.fill(470, y - 10, 300, 20, shown ? PANEL : BG);
      g.text(480, y + 4, r.dest.toUpperCase(), r.lit ? INK : (shown ? INK : FAINT), -1, 284);
      if (r.dest !== "Off") {
        bar(g, 790, y, 100, r.f, true, r.lit, r.live);
        g.text(944, y + 4, disp(v, r.ak) || "", r.lit ? "slot" : (r.live ? INK : FAINT), 1);
      }
    }
  };
}
var MATRIX_PAGES = [];
for (var mi = 0; mi < 6; mi++) MATRIX_PAGES.push({ label: "Slot " + (mi + 1), keys: SLOT_KEYS[mi], screen: matrixScreen(mi) });
push.compartment({ id: "matrix", label: "Matrix", extra_keys: ["status"], pages: MATRIX_PAGES });

// ---- arpeggiator: the notes it climbs through ----------------------------------------
push.compartment({
  id: "arp", label: "Arp", extra_keys: ["status"],
  pages: [{ label: "Arp", keys: ["arp_mode", "arp_pattern_selct", "arp_octave_range", "arp_hold_enable", "arp_note_length", "arp_swing",
    "arp_clock", "clock_tempo"] }],
  screen: function (g, v) {
    edge(g, v);
    var t = v.$touched || "", mode = disp(v, "arp_mode") || "Off", running = mode !== "Off";
    led(g, 14, 9, running);
    g.text(22, 13, "ARPEGGIATOR", running ? INK : DIM, -1);
    g.value(12, 46, mode, t === "arp_mode" ? "slot" : (running ? INK : FAINT), -1, 200);
    g.text(12, 66, "PATTERN " + (disp(v, "arp_pattern_selct") || "--").toUpperCase(), t === "arp_pattern_selct" ? "slot" : DIM, -1);
    g.text(12, 82, on(v, "arp_hold_enable") ? "HOLD" : "", INK, -1);
    g.line(226, 6, 226, 82, 1, RULE);
    // a bar of sixteen steps: the notes it plays over the octaves, their length, the swing
    var oct = Math.max(1, (parseInt(disp(v, "arp_octave_range"), 10) || 1)), len = frac(v, "arp_note_length", 0.5), sw = frac(v, "arp_swing", 0);
    var down = mode.indexOf("Down") === 0, ud = mode.indexOf("Up&") === 0, rnd = mode === "Random", chord = mode === "Chord";
    var x0 = 240, w = 44, rowsN = oct * 3, top = 18, hgt = 64;
    for (var b = 0; b <= 16; b += 4) g.fill(x0 + b * w, top, 1, hgt, b % 16 ? RULE : DIM);
    for (var s = 0; s < 16; s++) {
      var seq = ud ? (s % (2 * rowsN - 2 || 1)) : s % rowsN, h = ud && seq >= rowsN ? 2 * rowsN - 2 - seq : seq;
      if (down) h = rowsN - 1 - (s % rowsN);
      if (rnd) h = Math.floor((Math.sin(s * 91.7) * 0.5 + 0.5) * rowsN);
      var x = x0 + s * w + (s % 2 ? Math.round(sw * w * 0.5) : 0) + 2, bw = Math.max(4, Math.round((w - 4) * (0.15 + len * 0.85)));
      if (chord) { for (var c = 0; c < 3; c++) g.fill(x, top + hgt - 6 - c * 8, bw, 5, running ? RED : FAINT); continue; }
      var y = top + hgt - 6 - Math.round(h * (hgt - 8) / Math.max(1, rowsN - 1));
      g.fill(x, y, bw, 5, t === "arp_note_length" || t === "arp_swing" ? "slot" : (running ? RED : FAINT));
    }
    g.text(944, 12, (disp(v, "arp_clock") || "").toUpperCase() + "   " + (disp(v, "clock_tempo") || "").toUpperCase() + "   " + oct + (oct > 1 ? " OCTAVES" : " OCTAVE"), DIM, 1);
  }
});

// ---- voice: how many voices a key sounds, and how they spread -------------------------
function voiceScreen(g, v) {
  edge(g, v);
  var u = disp(v, "unison_mode") || "Off", n = u === "Off" ? 1 : u === "Twin" ? 2 : Math.max(1, parseInt(u, 10) || 1);
  var det = frac(v, "unison_detune", 0), spread = frac(v, "unison_pan_spread", 0), t = v.$touched || "";
  head(g, 12, "KEYS", t === "key_mode");
  g.value(12, 40, disp(v, "key_mode") || "--", t === "key_mode" ? "slot" : INK, -1, 200);
  g.text(12, 60, n > 1 ? n + " VOICES A KEY" : "ONE VOICE A KEY", t === "unison_mode" ? "slot" : (n > 1 ? INK : DIM), -1);
  g.text(12, 76, frac(v, "portamento_time", 0) > 0 ? "GLIDE " + disp(v, "portamento_time") : "NO GLIDE", t === "portamento_time" ? "slot" : DIM, -1);
  g.line(226, 6, 226, 82, 1, RULE);
  // the stereo field the unison voices stand in, left to right, each detuned
  var x0 = 260, w = 400, cx = x0 + w / 2, lit = t === "unison_detune" || t === "unison_pan_spread";
  head(g, 240, "UNISON", t.indexOf("unison_") === 0);
  g.fill(x0, 80, w, 1, RULE); g.fill(cx, 74, 1, 8, DIM);
  g.text(x0 - 8, 84, "L", FAINT, 1); g.text(x0 + w + 8, 84, "R", FAINT, -1);
  for (var i = 0; i < n; i++) {
    var off = n > 1 ? (i / (n - 1) - 0.5) : 0, x = cx + Math.round(off * w * spread), h = 50 - Math.abs(off) * 18;
    g.fill(x - 2, 78 - h, 4, h, lit ? "slot" : RED);
    if (n > 1 && det > 0) g.text(x, 74 - h, (off >= 0 ? "+" : "") + Math.round(off * det * 100), DIM, 0);
  }
  var rows = [["TRANSPOSE", "transpose"], ["BEND UP", "bender_range_up"], ["BEND DOWN", "bender_range_down"], ["LFO PHASE", "unison_lfo_phase"]];
  for (var r = 0; r < rows.length; r++) {
    var lt = t === rows[r][1], y = 24 + r * 18;
    g.text(724, y, rows[r][0], lt ? INK : DIM, -1);
    g.text(944, y, disp(v, rows[r][1]) || "--", lt ? "slot" : INK, 1);
  }
}
// ---- velocity: how much harder playing moves, and which way ----------------------------
var VEL_ROWS = [["osc1_shape_velocity", "SHAPE 1"], ["osc2_shape_velocity", "SHAPE 2"], ["pulsewidth_velocity", "PULSEWIDTH"],
  ["fm_amount_velocity", "FM AMOUNT"], ["resonance1_velocity", "RESO 1"], ["resonance2_velocity", "RESO 2"], ["panorama_velocity", "PANORAMA"]];
function velocityScreen(g, v) {
  edge(g, v);
  var t = v.$touched || "", any = 0;
  for (var q = 0; q < VEL_ROWS.length; q++) if (Math.abs(frac(v, VEL_ROWS[q][0], 0.5) - 0.5) > 0.004) any++;
  head(g, 12, "VELOCITY", false);
  g.value(12, 44, any ? any + (any > 1 ? " TARGETS" : " TARGET") : "NONE", any ? INK : FAINT, -1, 200);
  g.text(12, 64, "PLAYING HARDER MOVES", DIM, -1);
  g.text(12, 78, "EACH BY ITS AMOUNT", DIM, -1);
  g.line(226, 6, 226, 82, 1, RULE);
  // two columns, a bar from the middle each: right is more, left is less
  for (var r = 0; r < VEL_ROWS.length; r++) {
    var k = VEL_ROWS[r][0], x0 = r < 4 ? 242 : 600, y = 22 + (r % 4) * 18, f = frac(v, k, 0.5), lit = t === k, act = Math.abs(f - 0.5) > 0.004;
    g.text(x0, y, VEL_ROWS[r][1], lit ? INK : (act ? DIM : FAINT), -1);
    bar(g, x0 + 96, y - 4, 160, f, true, lit, act);
    g.text(x0 + 336, y, disp(v, k) || "--", lit ? "slot" : (act ? INK : FAINT), 1);
  }
}
push.compartment({
  id: "voice", label: "Voice",
  pages: [
    { label: "Voice", keys: ["key_mode", "unison_mode", "unison_detune", "unison_pan_spread", "unison_lfo_phase", "portamento_time", "transpose",
      "bender_range_up"], screen: voiceScreen },
    { label: "Velocity", keys: ["osc1_shape_velocity", "osc2_shape_velocity", "pulsewidth_velocity", "fm_amount_velocity", "resonance1_velocity",
      "resonance2_velocity", "panorama_velocity", "bender_range_down"], screen: velocityScreen }
  ],
  extra_keys: ["status", "key_mode", "unison_mode", "unison_detune", "unison_pan_spread", "portamento_time", "transpose", "bender_range_up",
    "bender_range_down", "unison_lfo_phase"]
});
