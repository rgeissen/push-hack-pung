// Mini-JV (JV-880) on the Push. The compartments are the panels of the
// module's own web page: Macros, Common / Control, Effects, and the Tone
// Editor's four tones with that page's sections (Wave, Pitch, Filter, Amp,
// LFO 1, LFO 2, Mod, Aftertouch, Expression), in its order and names.
//
// Two pictures, each showing what knobs cannot:
// - Macros (takeover): the JV-880's LCD, and its four TONES at a glance:
//   which sound, which wave, how loud, where panned, their amp envelopes.
//   A JV patch IS four tones; a row of knobs never shows that. Live, from
//   the emulated chip itself: every voice's amplitude in the LCD, and every
//   voice's filter cutoff on one axis, moving as the JV's envelopes and LFOs
//   move them.
// - The JV's 4-stage envelopes (pitch, filter, amp: T1-T4 and L1-L4), each
//   stage drawn over its own two knobs (time, level), key-off between 3 and
//   4. Eight knobs of numbers become one envelope. Live, every note played
//   is a dot running through the stages in the JV's own time (JV_TIME), and
//   the bar under the envelope lights the stage each note is in.

var ACCENT = "#ff8a3d", LCD_BG = "#1d270c", LCD_EDGE = "#3c4f18", LCD_INK = "#cfe878", LCD_DIM = "#7f9440";
var CARD = "#1d2026", ON = "#4ade80";
var PC = "nvram_patchCommon_";

function known(v, k) { return v[k] && v[k].known; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : "--"; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
// the mode, as an index, whether the module says 1 or "Performance"
function modeIndex(v) {
  if (!known(v, "mode")) return -1;
  var s = String(v.mode.value).toLowerCase(), n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  return s.indexOf("perf") === 0 ? 1 : s.indexOf("patch") === 0 ? 0 : s.indexOf("sys") === 0 ? 2 : -1;
}
function tk(t, s) { return "nvram_tone_" + t + "_" + s; }

// ---- the JV's 4-stage envelope ------------------------------------------------------

var ENV = {
  Pitch: { t: ["penvtime1", "penvtime2", "penvtime3", "penvtime4"], l: ["penvlevel1", "penvlevel2", "penvlevel3", "penvlevel4"], signed: true },
  Filter: { t: ["tvfenvtime1", "tvfenvtime2", "tvfenvtime3", "tvfenvtime4"], l: ["tvfenvlevel1", "tvfenvlevel2", "tvfenvlevel3", "tvfenvlevel4"] },
  Amp: { t: ["tvaenvtime1", "tvaenvtime2", "tvaenvtime3", "tvaenvtime4"], l: ["tvaenvlevel1", "tvaenvlevel2", "tvaenvlevel3"] }
};
// a page's keys: T1 L1 T2 L2 T3 L3 T4 (L4), so each stage sits over its two knobs
function envKeys(t, sec) {
  var e = ENV[sec], out = [];
  for (var i = 0; i < 4; i++) { out.push(tk(t, e.t[i])); if (e.l[i]) out.push(tk(t, e.l[i])); }
  return out;
}

// stage i over encoder columns 2i and 2i+1 (the band starts 4 px into column 0)
function stageX(i) { return i * 240 - (i ? 4 : 0); }

// ---- the JV's own times --------------------------------------------------------------
// How long a stage takes for each time value (0..127), in seconds, measured
// off the emulated JV-880 itself: a note played through each stage, the
// chip's envelope read every 128-sample block until it settled. T1, T2/T3
// and T4 each have their own scale; a stage takes its time whatever levels
// it moves between (measured: from L0, L32 and L64 to L127, and down to
// L0, L32, L64, L100 alike). The pitch and filter envelopes run on the same
// envelope generator, and so on the same times.
var JV_TIME = [ // T1, T2, T3, T4: [time value, seconds]
  [[0, 0.000], [4, 0.000], [8, 0.000], [16, 0.000], [24, 0.000], [32, 0.000], [36, 0.000], [40, 0.000], [44, 0.000], [48, 0.000], [49, 0.000], [50, 0.000], [51, 0.000], [52, 0.000], [53, 0.000], [54, 0.067], [56, 0.165], [58, 0.293], [60, 0.415], [64, 0.700], [68, 1.065], [72, 1.474], [80, 2.580], [88, 4.168], [96, 6.461], [104, 9.726], [112, 14.376], [120, 20.997], [127, 29.161]],
  [[0, 0.000], [4, 0.038], [8, 0.052], [16, 0.113], [24, 0.209], [32, 0.328], [36, 0.415], [40, 0.444], [44, 0.447], [48, 0.444], [49, 0.453], [50, 0.453], [51, 0.453], [52, 0.949], [53, 0.987], [54, 1.048], [56, 1.144], [58, 1.245], [60, 1.379], [64, 1.681], [68, 2.023], [72, 2.435], [80, 3.547], [88, 5.117], [96, 7.329], [104, 10.638], [112, 15.322], [120, 22.166], [127, 30.633]],
  [[0, 0.000], [4, 0.029], [8, 0.052], [16, 0.116], [24, 0.209], [32, 0.328], [36, 0.424], [40, 0.444], [44, 0.456], [48, 0.444], [49, 0.444], [50, 0.447], [51, 0.453], [52, 0.938], [53, 0.996], [54, 1.036], [56, 1.144], [58, 1.245], [60, 1.376], [64, 1.675], [68, 2.023], [72, 2.435], [80, 3.538], [88, 5.114], [96, 7.329], [104, 10.638], [112, 15.316], [120, 22.166], [127, 30.633]],
  [[0, 0.006], [4, 0.456], [8, 0.447], [16, 0.447], [24, 0.456], [32, 0.444], [36, 0.456], [40, 0.456], [44, 0.453], [48, 0.456], [49, 0.456], [50, 0.456], [51, 0.447], [52, 1.837], [53, 1.884], [54, 1.939], [56, 2.116], [58, 2.247], [60, 2.383], [64, 2.673], [68, 3.001], [72, 3.422], [80, 4.525], [88, 6.089], [96, 8.339], [104, 11.569], [112, 16.268], [120, 23.130], [127, 31.553]]
];
function jvSeconds(stage, raw) {
  var tab = JV_TIME[stage], x = Math.max(0, Math.min(127, raw));
  for (var i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      var a = tab[i - 1], b = tab[i], f = (x - a[0]) / Math.max(1, b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return tab[tab.length - 1][1];
}
function rawOf(v, k) { var n = known(v, k) ? parseFloat(v[k].value) : NaN; return isNaN(n) ? 64 : n; }

// where one note is in a tone's envelope: its clock (age, and since let go)
// through the stages at their times; held after the third, at its level;
// let go, the fourth runs from wherever the level was
function jvAt(age, rel, secs, lv, start) {
  var pre = function (t) {
    var from = start;
    for (var i = 0; i < 3; i++) {
      if (t < secs[i]) { var p = secs[i] > 1e-6 ? t / secs[i] : 1; return { stage: i, p: p, level: from + (lv[i] - from) * p }; }
      t -= secs[i];
      from = lv[i];
    }
    return { stage: 2, p: 1, level: lv[2], sus: true };
  };
  if (rel < 0) return pre(age);
  var was = pre(age - rel), q = secs[3] > 1e-6 ? rel / secs[3] : 1;
  if (q >= 1) return null;
  return { stage: 3, p: q, from: was.level, level: was.level + (lv[3] - was.level) * q };
}

function jvEnvelope(g, v, t, sec, x0, x1, top, base, small) {
  var e = ENV[sec], touched = v.$touched || "";
  var mid = (top + base) / 2;
  var y = function (f) { return e.signed ? mid - (f - 0.5) * (base - top) : base - f * (base - top); };
  var start = e.signed ? mid : base, ok = true, i;
  for (i = 0; i < 4; i++) if (!known(v, tk(t, e.t[i]))) ok = false;
  var pts = [], prev = start, w = (x1 - x0) / 4, lv = [];
  for (i = 0; i < 4; i++) {
    var rx = small ? x0 + i * w : stageX(i);
    var rw = small ? w : (i < 3 ? stageX(i + 1) : x1) - rx;
    var lf = e.l[i] ? fr(v, tk(t, e.l[i]), 0.5) : 0; // amp's last stage falls to nothing
    lv.push(lf);
    var lvl = y(lf);
    var ex = rx + Math.max(small ? 2 : 6, fr(v, tk(t, e.t[i]), 0.3) * (rw - (small ? 4 : 16)));
    if (i === 0) pts.push([rx, prev]);
    pts.push([ex, lvl]);
    if (i < 3) pts.push([rx + rw, lvl]);
    prev = lvl;
  }
  var col = ok ? "fg" : "dim";
  if (e.signed) g.line(x0, mid, x1, mid, 1, "line");
  else g.area(pts, base, ok ? "#3d2414" : "#24262b");
  g.line(x0, base, x1, base, 1, "line");
  g.poly(pts, small ? 1.5 : 2, col);
  if (small) return;
  // the stage being turned, and its handle
  var hotStage = -1;
  for (i = 0; i < 4; i++) {
    var hot = touched === tk(t, e.t[i]) || (e.l[i] && touched === tk(t, e.l[i]));
    if (hot) hotStage = i;
    var a = pts[i === 0 ? 0 : 2 * i], b = pts[2 * i + 1];
    if (hot) g.line(a[0], a[1], b[0], b[1], 3.5, ACCENT);
    g.dot(b[0], b[1], hot ? 5 : 3, hot ? ACCENT : col);
    g.text(stageX(i) + 8, top - 10, String(i + 1), hot ? ACCENT : "dim", -1);
  }
  // key off: the last stage starts when the key is let go
  var ko = stageX(3);
  for (var yy = top - 18; yy < base; yy += 6) g.line(ko, yy, ko, yy + 3, 1, "dim");
  g.text(x1 - 6, top - 10, "KEY OFF", "dim", 1);

  // every note, live, on its clock (v.$live.voices: age and since let go,
  // at the session's frame): a dot running along this tone's lines, a trail
  // behind it, the newest note's stage lit up to its dot
  var lit = {}, sus = false, live = v.$live;
  if (ok && live && live.known && live.voices && live.voices.length) {
    var secs = [], st0 = e.signed ? 0.5 : 0;
    for (i = 0; i < 4; i++) secs.push(jvSeconds(i, rawOf(v, tk(t, e.t[i]))));
    var place = function (q) {
      if (q.stage < 3) {
        var a = pts[q.stage === 0 ? 0 : 2 * q.stage], b = pts[2 * q.stage + 1];
        return [a[0] + (b[0] - a[0]) * q.p, a[1] + (b[1] - a[1]) * q.p];
      }
      var bx = pts[7][0]; // the fourth, from the level it was let go at
      return [ko + (bx - ko) * q.p, y(q.level)];
    };
    var vs = live.voices.slice().sort(function (p, q) { return p.age - q.age; }).slice(0, 8);
    for (var n = vs.length - 1; n >= 0; n--) {
      var vo = vs[n], rel = vo.held ? -1 : vo.released, cur = jvAt(vo.age, rel, secs, lv, st0);
      if (!cur) continue;
      lit[cur.stage] = true;
      if (cur.sus) sus = true;
      for (var k = 9; k >= 1; k--) {
        var back = k * 0.033;
        if (vo.age - back < 0) continue;
        var bq = jvAt(vo.age - back, rel < 0 ? -1 : rel - back, secs, lv, st0);
        if (!bq) continue;
        var tp = place(bq), f = 1 - k / 10;
        g.dot(tp[0], tp[1], 1.2 + 1.6 * f, f > 0.6 ? "#2a8ea6" : "#1f5f70");
      }
      var at = place(cur), r = 3.2 + 1.4 * (vo.vel / 127);
      if (n === 0) {
        if (cur.stage === 3) {
          if (Math.abs(y(cur.from) - pts[6][1]) > 1) g.line(ko, y(cur.from), pts[7][0], pts[7][1], 1, "#1f5f70"); // its own way down
          g.line(ko, y(cur.from), at[0], at[1], 3.4, "mod");
        } else if (!cur.sus) {
          var sa = pts[cur.stage === 0 ? 0 : 2 * cur.stage];
          g.line(sa[0], sa[1], at[0], at[1], 3.4, "mod");
        }
        for (var gy = at[1] + 7; gy < base - 2; gy += 5) g.line(at[0], gy, at[0], Math.min(gy + 2, base - 2), 1, "#2a8ea6");
        r = 4.6;
      }
      g.dot(at[0], at[1], r + 1.8, "black");
      g.dot(at[0], at[1], r, "mod");
    }
  }
  // the stages as a bar under the envelope: lit while a note is in it; the
  // third reads SUSTAIN while a held key keeps its level there
  var by = base + 5, bh = 13;
  for (i = 0; i < 4; i++) {
    var sx = stageX(i) + (i ? 1 : 0), w2 = (i < 3 ? stageX(i + 1) : x1) - sx - (i < 3 ? 1 : 0);
    var on = ok && !!lit[i], txt = i === 2 && sus && on ? "T3  SUSTAIN" : "T" + (i + 1);
    g.fill(sx, by, w2, bh, on ? "mod" : ok ? "#282a2e" : "#1c1c1b");
    if (hotStage === i) {
      g.fill(sx, by, w2, 1, ACCENT); g.fill(sx, by + bh - 1, w2, 1, ACCENT);
      g.fill(sx, by, 1, bh, ACCENT); g.fill(sx + w2 - 1, by, 1, bh, ACCENT);
    }
    g.text(sx + w2 / 2, by + bh - 2, txt, on ? "black" : hotStage === i ? ACCENT : "dim", 0);
  }
}

function envScreen(t, sec) {
  return function (g, v) { jvEnvelope(g, v, t, sec, 0, g.w, 24, 64, false); };
}

// ---- Macros: the takeover ------------------------------------------------------------

// ---- the chip's voices, live -------------------------------------------------------
// The module reads them from the emulated PCM chip (live_voices): each
// voice's amplitude (both TVA stages, as the firmware's envelope and LFO
// drive them) and its TVF coefficient. Pung reads it every frame while this
// screen shows (live_keys); nothing here is estimated.

function voices(v) {
  if (!known(v, "live_voices")) return null;
  var s = String(v.live_voices.value), out = [], i;
  if (s.indexOf("v2 ") === 0) {
    for (i = 3; i + 15 <= s.length; i += 15) {
      out.push({ slot: out.length, amp: parseInt(s.substr(i, 4), 16) / 65535, env: parseInt(s.substr(i + 4, 4), 16) / 0x7f80,
        cut: parseInt(s.substr(i + 8, 4), 16), pan: parseInt(s.substr(i + 12, 2), 16) / 255, keyed: s.charAt(i + 14) === "1" });
    }
    return out;
  }
  if (s.indexOf("v1 ") === 0) {
    for (i = 3; i + 11 <= s.length; i += 11) {
      out.push({ slot: out.length, amp: parseInt(s.substr(i, 4), 16) / 65535, env: -1, cut: parseInt(s.substr(i + 4, 4), 16), pan: parseInt(s.substr(i + 8, 2), 16) / 255, keyed: parseInt(s.substr(i, 4), 16) > 0 });
    }
    return out;
  }
  return null;
}

// amplitude in the LCD: one bar per voice, dB scaled; a keyed voice in ink,
// one ringing out after its key in the dim ink
function voiceMeter(g, vs, x, y, w, h) {
  var n = vs.length, cw = w / n;
  for (var i = 0; i < n; i++) {
    var a = vs[i].amp, bx = x + i * cw + 2, bw = Math.max(2, cw - 4);
    g.fill(bx, y + h - 1, bw, 1, LCD_EDGE);
    if (a <= 0) continue;
    var db = 20 * Math.log(a) / Math.LN10, f = Math.max(0, Math.min(1, (db + 48) / 48));
    if (f <= 0) continue;
    g.fill(bx, y + h - f * h, bw, f * h, vs[i].keyed ? LCD_INK : LCD_DIM);
  }
}

// the filters: each sounding voice's cutoff as a mark on one axis (the
// chip's coefficient, on a log scale): a filter envelope or an LFO is seen
// moving them
function tvfStrip(g, vs, x, y, w) {
  g.text(x, y + 11, "TVF", "dim", -1);
  var ax = x + 30, aw = w - 30, mid = y + 7;
  g.fill(ax, mid, aw, 1, "line");
  for (var i = 0; i < vs.length; i++) {
    var vo = vs[i];
    if (vo.amp <= 0.0005) continue;
    var u = Math.max(0, Math.min(1, (Math.log(Math.max(1, vo.cut)) / Math.LN2 - 6) / 9)); // 2^6 .. 2^15
    g.fill(ax + u * aw - 1, mid - 5, 3, 11, vo.keyed ? "mod" : "#2a5a66");
  }
}

function lcd(g, v) {
  var x = 8, y = 6, w = 444, h = 70;
  g.fill(x - 1, y - 1, w + 2, h + 2, LCD_EDGE);
  g.fill(x, y, w, h, LCD_BG);
  var num = known(v, "preset") ? ("00" + (parseInt(v.preset.value, 10) + 1)).slice(-3) : "---";
  g.value(x + 14, y + 24, "#" + num, LCD_INK, -1);
  var name = disp(v, "preset_name");
  g.value(x + 92, y + 24, name === "--" ? "" : name.toUpperCase(), LCD_INK, -1);
  var vs = voices(v);
  if (vs) voiceMeter(g, vs, x + 10, y + 31, w - 20, 22);
  var t = v.$touched;
  if (t && v[t]) {
    g.text(x + 14, y + 65, String(v[t].name).toUpperCase(), LCD_INK, -1);
    g.text(x + w - 14, y + 65, disp(v, t) + (v[t].unit ? " " + v[t].unit : ""), LCD_INK, 1);
  } else {
    var on = [];
    for (var i = 0; i < 4; i++) if (fr(v, tk(i, "toneswitch"), 1) > 0.5) on.push(i + 1);
    var sounding = 0;
    if (vs) for (var j = 0; j < vs.length; j++) if (vs[j].amp > 0.0005) sounding++;
    g.text(x + 14, y + 65, ("TONES " + (on.length ? on.join(" ") : "OFF")) + (fr(v, "link_tones", 0) > 0.5 ? "   LINKED" : ""), LCD_DIM, -1);
    if (vs) g.text(x + w - 14, y + 65, sounding + " OF " + vs.length + " VOICES", sounding ? LCD_INK : LCD_DIM, 1);
  }
}

function chip(g, x, y, s, on) {
  var w = s.length * 7 + 12;
  g.fill(x, y, w, 15, on ? ACCENT : "#262a31");
  g.text(x + 6, y + 12, s, on ? "black" : "dim", -1);
  return x + w + 6;
}

function toneCard(g, v, i) {
  var x = 464 + i * 122, on = fr(v, tk(i, "toneswitch"), 1) > 0.5, ink = on ? "fg" : "dim";
  g.fill(x, 6, 116, 94, CARD);
  g.text(x + 8, 19, "TONE " + (i + 1), on ? "fg" : "dim", -1);
  g.dot(x + 104, 15, 4, on ? ON : "#3a3f48");
  var grp = disp(v, tk(i, "wavegroup"));
  g.text(x + 8, 35, (grp === "--" ? "" : grp.toUpperCase() + " ") + "#" + disp(v, tk(i, "wavenumber")), ink, -1);
  // level, and pan under it
  var lv = fr(v, tk(i, "level"), 0), pan = fr(v, tk(i, "pan"), 0.5);
  g.fill(x + 8, 42, 100, 3, "line");
  g.fill(x + 8, 42, lv * 100, 3, on ? ACCENT : "dim");
  g.fill(x + 8 + pan * 96, 48, 4, 4, ink);
  jvEnvelope(g, v, i, "Amp", x + 6, x + 110, 58, 94, true);
}

function knobRow(g, v) {
  var knobs = v.$knobs || [], t = v.$touched;
  g.fill(0, 104, 960, 1, "line");
  for (var i = 0; i < 8; i++) {
    var k = knobs[i], cx = i * 120 + 60;
    if (i) g.fill(i * 120, 112, 1, 44, "faint");
    if (!k || !v[k]) continue;
    var hot = k === t;
    g.text(cx, 124, String(v[k].name).toUpperCase().slice(0, 15), hot ? "fg" : "dim", 0);
    g.value(cx, 149, disp(v, k), hot ? ACCENT : "fg", 0);
    if (hot) g.fill(cx - 20, 154, 40, 2, ACCENT);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(452, 96, String(ps[v.$page]).toUpperCase() + "  " + (v.$page + 1) + "/" + ps.length, "dim", 1);
}

var toneExtras = [];
for (var ti = 0; ti < 4; ti++) {
  ["toneswitch", "wavegroup", "wavenumber", "level", "pan"].concat(ENV.Amp.t, ENV.Amp.l).forEach(function (s) { toneExtras.push(tk(ti, s)); });
}

push.compartment({
  id: "macros", label: "Macros", takeover: true,
  pages: [
    { label: "Macros", keys: ["macro_cutoff", "macro_resonance", "macro_attack", "macro_decay", "macro_sustain", "macro_release", "macro_tvf_env_depth", "macro_lfo_depth"] },
    { label: "Patch", keys: ["mode", "part", "octave_transpose", "link_tones"] }
  ],
  extra_keys: ["preset", "preset_name"].concat(toneExtras),
  live_keys: ["live_voices"],
  screen: function (g, v) {
    lcd(g, v);
    var m = modeIndex(v);
    var x = chip(g, 8, 84, "PATCH", m === 0);
    x = chip(g, x, 84, "PERFORM", m === 1);
    x = chip(g, x + 10, 84, "LINK TONES", fr(v, "link_tones", 0) > 0.5);
    var vs = voices(v), ps = v.$pages || [];
    var pageW = ps.length > 1 ? g.measure(String(ps[v.$page]).toUpperCase() + "  " + (v.$page + 1) + "/" + ps.length) + 14 : 0;
    if (vs) tvfStrip(g, vs, x + 8, 84, 452 - x - 8 - pageW);
    for (var i = 0; i < 4; i++) toneCard(g, v, i);
    knobRow(g, v);
  }
});

// ---- the web page's other panels -----------------------------------------------------

push.compartment({
  id: "common", label: "Common / Control",
  pages: [
    { label: "Voice", keys: [PC + "patchlevel", PC + "patchpan", PC + "analogfeel", PC + "keyassign", PC + "sololegato", PC + "velocityswitch"] },
    { label: "Bend & Porta", keys: [PC + "bendrangeup", PC + "bendrangedown", PC + "portamentoswitch", PC + "portamentomode", PC + "portamentotype", PC + "portamentotime"] }
  ]
});

push.compartment({
  id: "fx", label: "Effects",
  pages: [
    { label: "Reverb", keys: [PC + "reverbtype", PC + "reverblevel", PC + "reverbtime", PC + "reverbfeedback"] },
    { label: "Chorus", keys: [PC + "chorustype", PC + "choruslevel", PC + "chorusdepth", PC + "chorusrate", PC + "chorusfeedback", PC + "chorusoutput"] }
  ]
});

// the Tone Editor: one compartment per tone, its sections as the web page orders them
var SUFFIXES = ["toneswitch", "wavegroup", "wavenumber", "fxmswitch", "fxmdepth", "level", "pan", "levelkeyfollow",
  "panningkeyfollow", "cutofffrequency", "resonance", "filtermode", "resonancemode", "cutoffkeyfollow", "pitchcoarse",
  "pitchfine", "randompitchdepth", "pitchkeyfollow", "lfo1form", "lfo1rate", "lfo1delay", "lfo1fadetime", "lfo1offset",
  "lfo1synchro", "lfo1pitchdepth", "lfo1tvfdepth", "lfo1tvadepth", "lfo2form", "lfo2rate", "lfo2delay", "lfo2fadetime",
  "lfo2pitchdepth", "lfo2tvfdepth", "lfo2tvadepth", "penvdepth", "tvfenvdepth", "tvfenvvelocitylevelsense",
  "tvaenvvelocitylevelsense", "tvaenvvelocitycurve", "velocityrangelower", "velocityrangeupper", "tonedelaymode",
  "tonedelaytime", "drylevel", "reverbsendlevel", "chorussendlevel",
  "moddesta", "modsensa", "moddestb", "modsensb", "moddestc", "modsensc", "moddestd", "modsensd",
  "aftdesta", "aftsensa", "aftdestb", "aftsensb", "aftdestc", "aftsensc", "aftdestd", "aftsensd",
  "expdesta", "expsensa", "expdestb", "expsensb", "expdestc", "expsensc", "expdestd", "expsensd"];

// the web page's own rule (web_ui.html, toneSection)
function toneSection(s) {
  if (/^mod(dest|sens)/.test(s)) return "Mod";
  if (/^aft(dest|sens)/.test(s)) return "Aftertouch";
  if (/^exp(dest|sens)/.test(s)) return "Expression";
  if (/^lfo1/.test(s)) return "LFO 1";
  if (/^lfo2/.test(s)) return "LFO 2";
  if (/^(penv|pitch|randompitch)/.test(s)) return "Pitch";
  if (/^(tvf|cutoff|resonance|filtermode)/.test(s)) return "Filter";
  if (/^(tva|level|pan|drylevel|reverbsend|chorussend|bias)/.test(s)) return "Amp";
  if (/^(wave|fxm|toneswitch)/.test(s)) return "Wave";
  return "More";
}
var ORDER = ["Wave", "Pitch", "Filter", "Amp", "LFO 1", "LFO 2", "Mod", "Aftertouch", "Expression", "More"];

function tonePages(t) {
  var by = {};
  SUFFIXES.forEach(function (s) { var sec = toneSection(s); (by[sec] = by[sec] || []).push(tk(t, s)); });
  var out = [];
  ORDER.forEach(function (sec) {
    var keys = by[sec] || [];
    for (var i = 0; i < keys.length; i += 8) out.push({ label: sec + (i ? " " + (i / 8 + 1) : ""), keys: keys.slice(i, i + 8) });
    if (ENV[sec]) out.push({ label: sec + " Env", keys: envKeys(t, sec), screen: envScreen(t, sec) });
  });
  return out;
}

for (var tn = 0; tn < 4; tn++) {
  push.compartment({ id: "tone" + (tn + 1), label: "Tone " + (tn + 1), pages: tonePages(tn) });
}
