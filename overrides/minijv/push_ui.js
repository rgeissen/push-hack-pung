// Mini-JV (JV-880) on the Push. The compartments are the panels of the
// module's own web page: Macros, Common / Control, Effects, and the Tone
// Editor's four tones with that page's sections (Wave, Pitch, Filter, Amp,
// LFO 1, LFO 2, Mod, Aftertouch, Expression), in its order and names.
//
// Macros (front panel) is the JV-880's own face, a one-unit rack: its LCD
// (the patch number as Roland counts a bank, the name, the parameter being
// turned), its PATCH / PERFORM buttons with their LEDs, and its four TONES
// at a glance: each one's TONE SWITCH, wave, level, pan and amp envelope.
// A JV patch IS four tones; a row of knobs never shows that. Live, from the
// emulated chip itself: every voice's amplitude in the LCD, and every
// voice's filter cutoff on one axis, moving as the JV's envelopes and LFOs
// move them. The encoders are the LCD's parameter line, as the JV edits
// everything through its display.
//
// The JV's 4-stage envelopes (pitch, filter, amp: T1-T4 and L1-L4) are
// Pung's own envelope, the picture every module's envelopes get
// (docs/UX-GUIDELINES.md, "Envelopes"): T1 T2 T3, the plateau where a held
// key waits at L3, T4 from the let-go. What only this module knows is how
// long its stages take: push.envelopeTimes gives Pung the JV's own times
// (JV_TIME), so every note's dot runs through them as the chip does.

var LCD_BG = "#1b250b", LCD_EDGE = "#34451a", LCD_INK = "#cfe878", LCD_DIM = "#7f9440";
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

// how the JV's bare numbers read wherever Pung writes them (its pages, the
// row under a screen): pans as Roland writes them (L64 .. C .. R63), tunings
// and transposes about their centre, key ranges as notes, parts from 1
var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function lr(n) { return n === 0 ? "C" : n < 0 ? "L" + -n : "R" + n; }
function signed(n) { return (n > 0 ? "+" : "") + n; }
push.display(function (key, raw) {
  var n = Math.round(parseFloat(raw));
  if (isNaN(n)) return;
  if (/^nvram_tone_\d_pan$/.test(key)) return lr(n);
  if (key === "nvram_patchCommon_patchpan" || key === "partpan") return lr(n - 64);
  if (key === "partcoarsetune" || key === "partfinetune" || key === "internalkeytranspose") return signed(n - 64);
  if (key === "internalkeyrangelower" || key === "internalkeyrangeupper") return NOTE[n % 12] + (Math.floor(n / 12) - 1);
  if (key === "part") return String(n + 1);
});

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

// Pung asks for the times of every JV envelope it draws or watches
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    var m = /time([1-4])$/.exec(s.key || "");
    return m && s.raw !== null ? jvSeconds(parseInt(m[1], 10) - 1, s.raw) : null;
  });
});


// ---- Macros: the front panel ------------------------------------------------------------
//
// The JV-880 is a one-unit rack: a dark face between two rack ears, its
// backlit LCD, rubber buttons with red LEDs, the TONE SWITCH buttons 1-4.
// Everything is edited through its LCD, so the encoder row is that LCD's
// parameter line: a name and a value per field, the cursor on the one
// being turned.

var FACE = "#17181b", EAR = "#26282d", HOLE = "#0b0c0d", RULE = "#34373d";
var LEGEND = "#b9bcc2", LEGEND_DIM = "#7c8088", BTN = "#2a2d33", BTN_EDGE = "#41454d";
var LED_ON = "#ff3b2f", LED_OFF = "#3b2220";

var LCD = { x: 22, y: 8, w: 442, h: 58 };
// the encoder row's LCD: the bottom 56 px, or, while segment mode is on, the
// part above Pung's segment names (y 142..160 are Pung's then)
var STRIP_FULL = { x: 16, y: 107, w: 928, h: 49, name: 14, val: 35, blk: 41 };
var STRIP_SEG = { x: 16, y: 106, w: 928, h: 34, name: 11, val: 27, blk: 29 };
function strip(v) { return v.$segmode ? STRIP_SEG : STRIP_FULL; }
var TVF = { x: 232, y: 88, w: 232 };             // the voices' cutoffs
var TONE_X = 478, TONE_W = 117;                  // the four tones, x 478..946

// the patch number: the bank, then group and number as Roland counts a bank of
// 64 (11..88); the module's list is Preset A, Preset B, Internal, then
// the expansions
function patchNumber(v) {
  if (!known(v, "preset")) return "---";
  var i = parseInt(v.preset.value, 10) || 0, b = Math.floor(i / 64), n = i % 64;
  var bank = b === 0 ? "PR-A" : b === 1 ? "PR-B" : b === 2 ? "INT" : "EXP";
  if (b > 2) return bank + " " + ("000" + (i - 191)).slice(-4);
  return bank + " " + (Math.floor(n / 8) + 1) + (n % 8 + 1);
}

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

// amplitude in the LCD: one column per voice, dB scaled, in whole rows of
// the LCD's dots; a keyed voice in ink, one ringing out after its key dim
function voiceMeter(g, vs, x, y, w, h) {
  var n = vs.length, cw = w / n;
  for (var i = 0; i < n; i++) {
    var a = vs[i].amp, bw = Math.max(2, Math.round(cw * 0.6)), bx = Math.round(x + i * cw + (cw - bw) / 2);
    if (a <= 0) continue;
    var db = 20 * Math.log(a) / Math.LN10, f = Math.max(0, Math.min(1, (db + 48) / 48));
    if (f <= 0) continue;
    var fh = Math.max(3, Math.round(f * h / 3) * 3);
    g.fill(bx, y + h - fh, bw, fh, vs[i].keyed ? LCD_INK : LCD_DIM);
  }
}

// the filters: each sounding voice's cutoff as a mark on one axis (the
// chip's coefficient, on a log scale): a filter envelope or an LFO is seen
// moving them
function tvfStrip(g, vs, x, y, w) {
  for (var i = 0; i < vs.length; i++) {
    var vo = vs[i];
    if (vo.amp <= 0.0005) continue;
    var u = Math.max(0, Math.min(1, (Math.log(Math.max(1, vo.cut)) / Math.LN2 - 6) / 9)); // 2^6 .. 2^15
    g.fill(Math.round(x + u * w) - 1, y - 6, 3, 13, vo.keyed ? "mod" : "#2a5a66");
  }
}

// the face, the ears, the LCDs' glass, the printed legends, the encoder
// fields' dot blocks
var BLOCKS = 14;
function blockX(c, b) { return c * 120 + 60 - (BLOCKS * 6 - 2) / 2 + b * 6; }
function ground(g, v) {
  var fields = (v.$knobs || []).map(function (k) { return !!(k && v[k]); });
  g.fill(0, 0, 960, 160, FACE);
  // the rack ears, each with its two slots
  [0, 950].forEach(function (x) {
    g.fill(x, 0, 10, 160, EAR);
    g.fill(x ? x : 9, 0, 1, 160, HOLE);
    [22, 138].forEach(function (y) { g.fill(x + 3, y - 6, 4, 12, HOLE); g.dot(x + 5, y - 6, 2, HOLE); g.dot(x + 5, y + 6, 2, HOLE); });
  });
  // the LCD
  g.fill(LCD.x - 3, LCD.y - 3, LCD.w + 6, LCD.h + 6, "#050605");
  g.fill(LCD.x, LCD.y, LCD.w, LCD.h, LCD_BG);
  // the TVF axis beside the buttons: every voice's cutoff, low to high
  g.text(TVF.x - 10, TVF.y + 4, "TVF", LEGEND_DIM, 1);
  g.fill(TVF.x, TVF.y, TVF.w, 1, RULE);
  for (var q = 0; q <= 4; q++) g.fill(TVF.x + Math.round(q * (TVF.w - 1) / 4), TVF.y - 2, 1, 5, RULE);
  // the tone section's rules
  for (var i = 1; i < 4; i++) g.fill(TONE_X + i * TONE_W, 8, 1, 90, RULE);
  // the encoder row: the LCD's parameter line, its fields, and each
  // field's row of dot blocks
  var STRIP = strip(v);
  g.fill(STRIP.x - 3, STRIP.y - 3, STRIP.w + 6, STRIP.h + 6, "#050605");
  g.fill(STRIP.x, STRIP.y, STRIP.w, STRIP.h, LCD_BG);
  for (var c = 1; c < 8; c++) g.fill(c * 120, STRIP.y + 6, 1, STRIP.h - 12, LCD_EDGE);
  for (c = 0; c < 8; c++) {
    if (!fields[c]) continue;
    for (var b = 0; b < BLOCKS; b++) g.fill(blockX(c, b), STRIP.y + STRIP.blk, 4, 3, LCD_EDGE);
  }
}

function lcd(g, v) {
  var x = LCD.x + 10, r = LCD.x + LCD.w - 10, t = v.$touched;
  var perf = modeIndex(v) === 1, num = perf ? "PERF " + (known(v, "performance") ? ("0" + (parseInt(v.performance.value, 10) + 1)).slice(-2) : "--") : patchNumber(v);
  g.value(x, LCD.y + 21, num, LCD_INK, -1);
  var nx = x + g.measure(num, "value") + 12, ps = v.$pages || [];
  var pg = ps.length > 1 ? String(ps[v.$page]).toUpperCase() + " " + (v.$page + 1) + "/" + ps.length : "";
  if (pg) g.text(r, LCD.y + 19, pg, LCD_DIM, 1);
  var name = disp(v, "preset_name").replace(/\s+$/, "");
  g.value(nx, LCD.y + 21, name === "--" ? "" : name.toUpperCase(), LCD_INK, -1, r - nx - (pg ? g.measure(pg) + 12 : 0));
  if (t && v[t]) { // the second line: what is being turned, as the JV's edit line
    var val = disp(v, t) + (known(v, t) && v[t].unit ? " " + v[t].unit : "");
    g.text(r, LCD.y + 52, val.toUpperCase(), LCD_INK, 1);
    g.text(x, LCD.y + 52, String(v[t].name).toUpperCase(), LCD_INK, -1, r - x - g.measure(val.toUpperCase()) - 14);
  } else {
    var on = [];
    for (var i = 0; i < 4; i++) on.push(toneOn(v, i) ? String(i + 1) : "-");
    g.text(x, LCD.y + 52, "TONE " + on.join(" ") + (fr(v, "link_tones", 0) > 0.5 ? "   LINKED" : ""), LCD_DIM, -1);
  }
}

// the chip, live: every voice's level in the LCD, how many sound, every
// voice's cutoff on the TVF axis (drawn over the layer, every frame)
function chip(g, v, vs) {
  var x = LCD.x + 10, r = LCD.x + LCD.w - 10;
  voiceMeter(g, vs, x - 2, LCD.y + 27, r - x + 4, 12);
  if (!v.$touched || !v[v.$touched]) {
    var sounding = 0;
    for (var j = 0; j < vs.length; j++) if (vs[j].amp > 0.0005) sounding++;
    g.text(r, LCD.y + 52, sounding + "/" + vs.length + " VOICES", sounding ? LCD_INK : LCD_DIM, 1);
  }
  tvfStrip(g, vs, TVF.x, TVF.y, TVF.w);
}

// a rubber button, its LED over it, the legend printed on the face beside it
function button(g, x, y, s, lit, hot) {
  g.fill(x, y, 18, 12, hot ? "slot" : BTN_EDGE);
  g.fill(x + 1, y + 1, 16, 10, BTN);
  g.dot(x + 9, y - 5, 2.5, lit ? LED_ON : LED_OFF);
  g.text(x + 24, y + 10, s, hot ? "slot" : lit ? LEGEND : LEGEND_DIM, -1);
}

function buttons(g, v) {
  var m = modeIndex(v), t = v.$touched || "";
  button(g, LCD.x, 84, "PATCH", m === 0, t === "mode");
  button(g, LCD.x + 78, 84, "PERFORM", m === 1, t === "mode");
}

// whether a tone sounds (its TONE SWITCH): unknown until read
function toneOn(v, i) { return known(v, tk(i, "toneswitch")) && v[tk(i, "toneswitch")].frac > 0.5; }

// a tone: its TONE SWITCH (the LED says it sounds), its wave, level and pan,
// and its amp envelope (Pung's, on the JV's own times)
function tone(g, v, i) { // its printed parts (in the layer)
  var x = TONE_X + i * TONE_W + 8, w = TONE_W - 16, on = toneOn(v, i), t = v.$touched || "";
  var hot = t.indexOf("nvram_tone_" + i + "_") === 0;
  button(g, x, 14, "TONE " + (i + 1), on, hot);
  var grp = disp(v, tk(i, "wavegroup")), wn = known(v, tk(i, "wavenumber")) ? ("00" + disp(v, tk(i, "wavenumber"))).slice(-3) : "---";
  g.text(x, 41, (grp === "--" ? "" : grp.toUpperCase() + " ") + wn, on ? LCD_INK : LCD_DIM, -1);
  // its level as a bar, its pan in words beside it
  var lv = fr(v, tk(i, "level"), 0), pk = tk(i, "pan"), pn = known(v, pk) ? parseInt(v[pk].value, 10) : 0;
  var pan = !known(v, pk) ? "--" : pn === 0 ? "C" : pn < 0 ? "L" + -pn : "R" + pn;
  g.fill(x, 47, w - 30, 3, RULE);
  g.fill(x, 47, Math.round(lv * (w - 30)), 3, on ? LCD_INK : LCD_DIM);
  g.text(x + w, 51, pan, on ? LEGEND : LEGEND_DIM, 1);
}
function toneEnvelope(g, v, i) { // Pung's envelope, live: over the layer
  var x = TONE_X + i * TONE_W + 8, w = TONE_W - 16;
  g.envelope(x - 4, 56, w + 8, 44, { keys: envKeys(i, "Amp"), color: toneOn(v, i) ? LCD_INK : LCD_DIM });
}

// the encoder row: the LCD's parameter line, a field per encoder
function row(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "", STRIP = strip(v);
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    var cx = i * 120 + 60, hot = k === t, ok = known(v, k);
    var x0 = i ? i * 120 + 6 : STRIP.x + 6, x1 = i < 7 ? i * 120 + 114 : STRIP.x + STRIP.w - 6;
    g.text(cx, STRIP.y + STRIP.name, String(v[k].name).toUpperCase(), hot ? "slot" : LCD_DIM, 0, x1 - x0);
    var val = ok ? String(v[k].display || v[k].value) : "--", unit = ok && v[k].unit ? v[k].unit.toUpperCase() : "";
    var uw = unit ? g.measure(unit) + 4 : 0;
    g.value(cx - uw / 2, STRIP.y + STRIP.val, val, hot ? "slot" : LCD_INK, 0, x1 - x0 - uw);
    if (unit) g.text(cx - uw / 2 + g.measure(val, "value") / 2 + 4, STRIP.y + STRIP.val, unit, LCD_DIM, -1);
    // where the value sits in its range, in the field's dot blocks (from the
    // middle for a value either side of zero)
    if (!ok) continue;
    var f = v[k].frac, d = String(v[k].display || v[k].value).trim();
    var both = /^([+-]\d|[LR]\d|C$)/.test(d) || (d === "0" && Math.abs(f - 0.5) < 0.02);
    var a = both ? Math.min(f, 0.5) : 0, b = both ? Math.max(f, 0.5) : f;
    for (var s = 0; s < BLOCKS; s++) {
      if ((s + 1) / BLOCKS > a + 1e-6 && s / BLOCKS < b - 1e-6) g.fill(blockX(i, s), STRIP.y + STRIP.blk, 4, 3, hot ? "slot" : LCD_INK);
    }
  }
}

var toneExtras = [];
for (var ti = 0; ti < 4; ti++) {
  ["toneswitch", "wavegroup", "wavenumber", "level", "pan"].concat(ENV.Amp.t, ENV.Amp.l).forEach(function (s) { toneExtras.push(tk(ti, s)); });
}

// ---- segments: the JV's own sections under the hands ------------------------------------
// COMMON (the patch's own values, edited on the JV through its LCD) and the
// four tones, each with what its strip shows and a player reaches for. Pung
// draws the bar above the active one; a tone's legend is lit too, as the JV
// marks the tone it edits (TONE SELECT).

var SEGMENTS = [
  { id: "common", label: "Common", rect: [16, 2, 456, 100], keys: [PC + "patchlevel", PC + "patchpan", PC + "analogfeel", PC + "keyassign", PC + "portamentoswitch", PC + "portamentotime", PC + "bendrangeup", PC + "bendrangedown"] }
];
for (var si = 0; si < 4; si++) {
  SEGMENTS.push({ id: "tone" + (si + 1), label: "Tone " + (si + 1), rect: [TONE_X + si * TONE_W, 2, TONE_W, 100],
    keys: ["toneswitch", "wavenumber", "level", "pan", "cutofffrequency", "resonance", "tvaenvtime1", "tvaenvtime4"].map(function (s) { return tk(si, s); }) });
}

function segmentMark(g, v) {
  if (v.$segmode !== "segment" || !v.$segment) return;
  var m = /^tone([1-4])$/.exec(v.$segment);
  if (!m) return;
  var i = +m[1] - 1, x = TONE_X + i * TONE_W;
  g.fill(x + 31, 14, 60, 12, FACE);
  g.text(x + 32, 24, "TONE " + (i + 1), "slot", -1);
}

var MACRO_PAGES = [
  { label: "Macros", keys: ["macro_cutoff", "macro_resonance", "macro_attack", "macro_decay", "macro_sustain", "macro_release", "macro_tvf_env_depth", "macro_lfo_depth"] },
  { label: "Patch", keys: ["mode", "part", "octave_transpose", "link_tones"] }
];
var MACRO_EXTRA = ["preset", "preset_name", "performance"].concat(toneExtras);
// what the face's layer shows depends on: every value but the chip's live
// voices, the touch and the page
var MACRO_SIG = MACRO_PAGES[0].keys.concat(MACRO_PAGES[1].keys, MACRO_EXTRA);
function faceSig(v) {
  var ks = v.$knobs || [], out = [v.$touched || "", v.$page, v.$segmode || "", v.$segment || "", ks.join(",")];
  for (var j = 0; j < ks.length; j++) if (ks[j] && v[ks[j]]) out.push(v[ks[j]].value + "~" + v[ks[j]].display);
  for (var i = 0; i < MACRO_SIG.length; i++) { var k = MACRO_SIG[i]; out.push(known(v, k) ? v[k].value + "~" + v[k].display : "?"); }
  return out.join("|");
}

push.compartment({
  id: "macros", label: "Macros", front_panel: true,
  pages: MACRO_PAGES,
  extra_keys: MACRO_EXTRA,
  live_keys: ["live_voices"],
  segments: SEGMENTS,
  draws_segments: true,
  screen: function (g, v) {
    // the face is one layer, drawn again only when a value it shows, the
    // touch or the page changes; the chip's voices and Pung's envelopes,
    // which move while the JV plays, are drawn over it
    g.layer("jv|" + faceSig(v), function () {
      ground(g, v);
      lcd(g, v);
      buttons(g, v);
      for (var i = 0; i < 4; i++) tone(g, v, i);
      row(g, v);
      segmentMark(g, v);
    });
    var vs = voices(v);
    if (vs) chip(g, v, vs);
    for (var j = 0; j < 4; j++) toneEnvelope(g, v, j);
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
    if (ENV[sec]) out.push({ label: sec + " Env", keys: envKeys(t, sec) }); // Pung's own envelope picture
  });
  return out;
}

for (var tn = 0; tn < 4; tn++) {
  push.compartment({ id: "tone" + (tn + 1), label: "Tone " + (tn + 1), pages: tonePages(tn) });
}
