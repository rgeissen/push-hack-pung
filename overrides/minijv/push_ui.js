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
//   4. Eight knobs of numbers become one envelope.

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

function jvEnvelope(g, v, t, sec, x0, x1, top, base, small) {
  var e = ENV[sec], touched = v.$touched || "";
  var mid = (top + base) / 2;
  var y = function (f) { return e.signed ? mid - (f - 0.5) * (base - top) : base - f * (base - top); };
  var start = e.signed ? mid : base, ok = true, i;
  for (i = 0; i < 4; i++) if (!known(v, tk(t, e.t[i]))) ok = false;
  var pts = [], hold = [], prev = start, w = (x1 - x0) / 4;
  for (i = 0; i < 4; i++) {
    var rx = small ? x0 + i * w : stageX(i);
    var rw = small ? w : (i < 3 ? stageX(i + 1) : x1) - rx;
    var lvl = e.l[i] ? y(fr(v, tk(t, e.l[i]), 0.5)) : start; // amp's last stage falls to nothing
    var ex = rx + Math.max(small ? 2 : 6, fr(v, tk(t, e.t[i]), 0.3) * (rw - (small ? 4 : 16)));
    if (i === 0) pts.push([rx, prev]);
    pts.push([ex, lvl]);
    if (i < 3) { pts.push([rx + rw, lvl]); hold.push([ex, lvl, rx + rw]); }
    prev = lvl;
  }
  var col = ok ? "fg" : "dim";
  if (e.signed) g.line(x0, mid, x1, mid, 1, "line");
  else g.area(pts, base, ok ? "#3d2414" : "#24262b");
  g.line(x0, base, x1, base, 1, "line");
  g.poly(pts, small ? 1.5 : 2, col);
  if (small) return;
  // the stage being turned, and its handle
  for (i = 0; i < 4; i++) {
    var hot = touched === tk(t, e.t[i]) || (e.l[i] && touched === tk(t, e.l[i]));
    var a = pts[i === 0 ? 0 : 2 * i], b = pts[2 * i + 1];
    if (hot) g.line(a[0], a[1], b[0], b[1], 3.5, ACCENT);
    g.dot(b[0], b[1], hot ? 5 : 3, hot ? ACCENT : col);
    g.text(stageX(i) + 8, top - 10, String(i + 1), hot ? ACCENT : "dim", -1);
  }
  // the notes, live (v.$live): held, the stages up to key off light along
  // the base; let go and still sounding, the fourth
  var lv = v.$live;
  if (lv && lv.known) {
    if (lv.held > 0) g.fill(x0, base - 1, stageX(3) - x0, 3, "mod");
    else if (lv.db > -72 && lv.since_off >= 0) g.fill(stageX(3), base - 1, x1 - stageX(3), 3, "#2a7f92");
  }
  // key off: the last stage starts when the key is let go
  var ko = stageX(3);
  for (var yy = top - 18; yy < base; yy += 6) g.line(ko, yy, ko, yy + 3, 1, "dim");
  g.text(x1 - 6, top - 10, "KEY OFF", "dim", 1);
}

function envScreen(t, sec) {
  return function (g, v) { jvEnvelope(g, v, t, sec, 0, g.w, 24, 80, false); };
}

// ---- Macros: the takeover ------------------------------------------------------------

// ---- the chip's voices, live -------------------------------------------------------
// The module reads them from the emulated PCM chip (live_voices): each
// voice's amplitude (both TVA stages, as the firmware's envelope and LFO
// drive them) and its TVF coefficient. Pung reads it every frame while this
// screen shows (live_keys); nothing here is estimated.

function voices(v) {
  if (!known(v, "live_voices")) return null;
  var s = String(v.live_voices.value);
  if (s.indexOf("v1 ") !== 0) return null;
  var out = [];
  for (var i = 3; i + 11 <= s.length; i += 11) {
    out.push({ amp: parseInt(s.substr(i, 4), 16) / 65535, cut: parseInt(s.substr(i + 4, 4), 16), pan: parseInt(s.substr(i + 8, 2), 16) / 255, keyed: s.charAt(i + 10) === "1" });
  }
  return out;
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
