// KrautDrums on Push: the 1969 organ-top rhythm box (sixteen bridged-T
// resonators, sixteen preset rhythms) and the studio it was recorded through.
//
// The look is the late-sixties Italian organ unit: a teak case, a brushed
// aluminium name strip, a dark fascia with coloured organ tabs for the
// rhythms, organ drawbars for the voice levels (brown for the low drums,
// white for the drums, black for the metal), chrome knobs, a red jewel lamp.
//
//   PANEL      the rhythm tabs (lit: in one of the eight slots), the eight
//              level drawbars (a lamp on each as its voices strike), the
//              clock (tempo, sync, density, drift, all decay), the echo and
//              the reverb as they are set.
//   RHYTHMS    what the eight slots play together: the sequencer's 32-step
//              loop, a row a resonator, each step as strong as its velocity
//              (the slots merge by the loudest), the density's odds.
//   ECHO       the delay machine chosen (tape loop, magnetic drum, space
//              echo's heads), its echoes in time, fed back; the reverb (plate,
//              spring, chamber) and the bus.
//   ATTITUDE   the studio chain in order, each stage lit by its amount, and
//              the ladder filter's response (Pung's filter) with the HPF and
//              the shelves on the same axis.

function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function frac(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function upper(s) { return String(s).toUpperCase(); }

// ---- the box's colours -------------------------------------------------------------
var TEAK = "#7a4824", TEAK2 = "#5e3519", TEAK3 = "#8d5730";
var FASCIA = "#1b1815", FASCIA2 = "#27231f", RULE = "#3b352e";
var ALU = "#bdb7a9", ALU2 = "#8f897c", ALU_INK = "#1c1a17";
var IVORY = "#efe6cf", IVORY2 = "#a8a08b", BRASS = "#d9b46a";
var JEWEL = "#ff3a26", JEWEL_MID = "#a32418", JEWEL_OFF = "#40130e";
var CHROME = "#cfcbc2", CHROME_RIM = "#7c786f";
var ECHO_GRN = "#22302a", ECHO_GRN2 = "#34473d", TAPE = "#6e4a2c";
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;

// ---- the voices: sixteen resonators in eight level groups ------------------------------
// name, group (the drawbar), its row in the patterns (the base voice it varies)
var VOICES = [["BASS", 0, 0], ["CONGA", 1, 1], ["TOM 1", 2, 2], ["TOM 2", 3, 3], ["CLAVES", 4, 4], ["SNARE", 5, 5],
  ["SHORT CYM", 7, 6], ["LONG CYM", 7, 7], ["COWBELL", 6, 8], ["BASS 2", 0, 0], ["TOM 3", 3, 3], ["CONGA 2", 1, 1],
  ["CLAVES 2", 4, 4], ["SNARE 2", 5, 5], ["MID CYM", 7, 7], ["COWBELL 2", 6, 8]];
// the drawbars: key, plate, colour of the handle (brown low, white drums, black metal)
var BARS = [["lvl_bass", "BD", "b"], ["lvl_conga", "CG", "b"], ["lvl_tom1", "T1", "w"], ["lvl_tom2", "T2", "w"],
  ["lvl_claves", "CL", "k"], ["lvl_snare", "SN", "w"], ["lvl_cowbell", "CB", "k"], ["lvl_cymbals", "CY", "k"]];
var HANDLE = { b: ["#6b3f22", "#efe6cf"], w: ["#efe6cf", "#1c1a17"], k: ["#121110", "#efe6cf"] };
// what struck: notes 36..51 are the sixteen voices; each group's last strike, seconds ago
function strikes(v) {
  var groups = [-1, -1, -1, -1, -1, -1, -1, -1], rows = [-1, -1, -1, -1, -1, -1, -1, -1, -1], L = v.$live;
  if (L && L.known && L.voices) {
    for (var i = 0; i < L.voices.length; i++) {
      var n = L.voices[i], vi = n.note - 36;
      if (vi < 0 || vi > 15) continue;
      var gr = VOICES[vi][1], r = VOICES[vi][2];
      if (groups[gr] < 0 || n.age < groups[gr]) groups[gr] = n.age;
      if (rows[r] < 0 || n.age < rows[r]) rows[r] = n.age;
    }
  }
  return { g: groups, r: rows };
}
function jewel(age) { return age < 0 ? JEWEL_OFF : (age < 0.12 ? JEWEL : (age < 0.35 ? JEWEL_MID : JEWEL_OFF)); }

// ---- the rhythms ---------------------------------------------------------------------------
// the panel's sixteen, in its order; the tab's colour by row
var RNAMES = ["Waltz", "Tango", "Polka", "Paso Doble", "Swing", "Slow", "Beguine", "Cha-Cha", "Rumba", "Samba", "Mambo",
  "Bossa-Nova", "Rock", "Slow Rock", "Shake", "R & Blues"];
var TABLBL = ["WALTZ", "TANGO", "POLKA", "PASO D.", "SWING", "SLOW", "BEGUINE", "CHA-CHA", "RUMBA", "SAMBA", "MAMBO",
  "BOSSA", "ROCK", "SLOW RK", "SHAKE", "R&BLUES"];
var TABCOL = [["#efe6cf", "#5b574c"], ["#e8c23a", "#5e5124"], ["#e27a2e", "#5c3519"], ["#cf3a2c", "#561c16"]];
// the patterns (krautdrums.c): name, steps (16ths), a row a base voice
// (bass conga tom1 tom2 claves snare short-cym long-cym cowbell), a step's strength 1..9
var KRHY = [
  ["Waltz", 12, ["8...........","............","............","............","............","....6...6...","6...6...6...","............","............"]],
  ["Tango", 16, ["8..6....7.......","................","................","................","7..6..7.7...7...","............6...","5.5.5.5.5.5.5.5.","................","................"]],
  ["Polka", 16, ["8.......7.......","................","................","................","................","....7.......7...","6.6.6.6.6.6.6.6.","................","................"]],
  ["Paso Doble", 16, ["8...7...8...7...","................","..............66","................","................","....6.......6...","6...6...6...6...","8.......8.......","................"]],
  ["Swing", 16, ["6.......6.......","................","................","................","................","....6.......6...","7.4.74..7.4.74..","................","................"]],
  ["Slow", 16, ["7.......6.......","................","................","................","................","....7.......7...","5.5.5.5.5.5.5.5.","................","................"]],
  ["Beguine", 16, ["8.........7.....","..4...4...4...4.","................","................","7..6..7...7.7...","....6.......6...","4.4.4.4.4.4.4.4.","................","................"]],
  ["Cha-Cha", 16, ["8...7...7...7.7.","..4...4...4...4.","................","................","............7.7.","................","6.6.6.6.6.6.6.6.","................","8...7...7...7.7."]],
  ["Rumba", 16, ["7.....6.....7...","...44..44..44..4","................","................","7..6..7...7.7...","....5.......5...","................","................","................"]],
  ["Samba", 16, ["8.....7.......7.","..5..5..5..5..5.","................","................","7...6..7..7...6.","................","5555555555555555","................","................"]],
  ["Mambo", 16, ["7.....6...7...6.","4.4...4.4.4...4.","................","................","..7..7..7..7.7..","................","................","................","8.7.8.7.8.7.8.7."]],
  ["Bossa-Nova", 16, ["8......47......4","..4..4...4...4..","................","................","7..6..7...7.7...","................","5555555555555555","................","................"]],
  ["Rock", 16, ["8.......7.7.....","................","................","................","................","....8.......8...","6.6.6.6.6.6.6.6.","................","................"]],
  ["Slow Rock", 12, ["8.....7.....","............","............","............","............","...7.....7..","644644644644","............","............"]],
  ["Shake", 16, ["7...7...7...7...","................","................","................","................","....7.......7...","7474747474747474","8...............","................"]],
  ["R & Blues", 16, ["8.....6.7.....6.","................","................","................","................","....7.......7...","6.6.6.6.6.6.6.6.","................","................"]]
];
var ROWS = ["BASS", "CONGA", "TOM 1", "TOM 2", "CLAVES", "SNARE", "SH.CYM", "LG.CYM", "COWBELL"];
// which rhythms the slots hold (a set: duplicates play once, krautdrums.c)
function activeRhythms(v) {
  var on = {}, list = [];
  for (var s = 1; s <= 8; s++) {
    var d = disp(v, "rhythm_" + s), i = RNAMES.indexOf(d);
    if (i < 0) { var n = Math.round(num(v, "rhythm_" + s, 0)); i = n >= 1 && n <= 16 && !isNaN(parseFloat(v["rhythm_" + s] && v["rhythm_" + s].value)) ? n - 1 : -1; }
    if (i >= 0 && !on[i]) { on[i] = 1; list.push(i); }
  }
  return { on: on, list: list };
}

// ---- knobs and the encoder row ---------------------------------------------------------------
function chrome(g, x, y, r) { g.dot(x, y, r + 1.5, CHROME_RIM); g.dot(x, y, r, CHROME); g.dot(x, y, r * 0.45, "#e2dfd8"); }
function pointer(g, x, y, r, f, color, width) {
  var a = A0 + f * SWEEP;
  g.line(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1), width, color);
}
var NAMES = { lvl_bass: "BASS", lvl_conga: "CONGA", lvl_tom1: "TOM 1", lvl_tom2: "TOM 2", lvl_claves: "CLAVES", lvl_snare: "SNARE",
  lvl_cowbell: "COWBELL", lvl_cymbals: "CYMBALS", master_vol: "VOLUME", tempo_mode: "CLOCK", all_decay: "ALL DECAY",
  bus_comp: "BUS COMP", preamp_drive: "PREAMP", tape_amount: "TAPE", hpf_freq: "HPF", eq_body: "BODY", eq_air: "AIR",
  filter_cutoff: "CUTOFF", filter_reso: "RESONANCE", phaser_amount: "PHASER" };
function knobName(v, k) { return NAMES[k] || upper(v[k].name); }
// a value in the module's own words (krautdrums.c), everywhere Pung writes one:
// levels and amounts in percent, the delay in ms or a note value, Hz, dB
var SYNCED = false; // the delay's sync, as last seen: its time reads by it
function fmt(k, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return null;
  if (/^lvl_|_mix$|^density$|^drift$|^bus_comp$|^master_vol$|^tape_amount$|^preamp_drive$|^phaser_amount$|^reverb_decay$|^reverb_tone$|^delay_fb$|^filter_reso$/.test(k))
    return [String(Math.round(x * 100)), "%"];
  if (k === "all_decay") return [(1 + x * 3).toFixed(2), "X"];
  if (k === "delay_time") return SYNCED ? [DIVS[Math.max(0, Math.min(11, Math.round(x * 11)))], ""] : [String(Math.round(10 * Math.pow(100, x))), "MS"];
  if (k === "tempo") return [String(Math.round(x)), "BPM"];
  if (k === "filter_cutoff") return x >= 1000 ? [(x / 1000).toFixed(1), "KHZ"] : [String(Math.round(x)), "HZ"];
  if (k === "hpf_freq") return [String(Math.round(x)), "HZ"];
  if (k === "eq_body" || k === "eq_air") return [(x > 0 ? "+" : "") + x.toFixed(1), "DB"];
  return null;
}
push.display(function (k, raw) { var r = fmt(k, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
function valueText(v, k) {
  if (!known(v, k)) return ["--", ""];
  var r = fmt(k, v[k].value);
  return r || [String(v[k].display || v[k].value), String(v[k].unit || "")];
}
var DIVS = ["1/64", "1/32T", "1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2T", "1/2", "1/1"];
var DIV_BEATS = [0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.333, 2, 4];
function synced(v) { SYNCED = /sync/i.test(disp(v, "delay_sync")); return SYNCED; }
function delayText(v) { synced(v); return valueText(v, "delay_time"); }
function delaySeconds(v) {
  var n = num(v, "delay_time", 0.35);
  if (synced(v)) { var bpm = num(v, "tempo", 120), L = v.$live; if (L && L.known && L.bpm) bpm = L.bpm; return DIV_BEATS[Math.max(0, Math.min(11, Math.round(n * 11)))] * 60 / bpm; }
  return 0.01 * Math.pow(100, n);
}
// in segment mode the bottom 18 pixels are Pung's (the segments' names): the row draws above y 142
function rowGeo(v) { return v.$segmode ? { name: 114, ky: 128, r: 10, val: 139 } : { name: 120, ky: 139, r: 12, val: 147 }; }
function encoderGround(g, v) {
  var kn = v.$knobs || [], G = rowGeo(v);
  g.fill(0, 104, 960, 56, FASCIA);
  g.fill(12, 103, 936, 1, RULE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, v.$segmode ? 30 : 42, RULE);
  for (var i = 0; i < 8; i++) if (kn[i] && v[kn[i]]) chrome(g, i * 120 + 25, G.ky, G.r);
}
function encoderRow(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", G = rowGeo(v);
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var hot = k === t, kx = x0 + 25, ky = G.ky;
    g.text(x0 + 60, G.name, knobName(v, k), hot ? "slot" : ALU, 0, 112);
    if (hot) g.arc(kx, ky, G.r + 4, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) pointer(g, kx, ky, G.r, v[k].frac, hot ? "slot" : ALU_INK, 2.5);
    var vt = valueText(v, k), val = vt[0], unit = vt[1] === "%" ? "%" : vt[1];
    var uw = unit ? g.measure(unit) + 3 : 0, room = 72 - uw, vw = Math.min(g.measure(val, "value"), room), cx = x0 + 83;
    g.value(cx - (vw + uw) / 2, G.val, val, hot ? "slot" : IVORY, -1, room);
    if (unit) g.text(cx - (vw + uw) / 2 + vw + 3, G.val, unit, IVORY2, -1);
  }
}
function teak(g, x, h) { g.fill(x, 0, 12, h, TEAK); g.fill(x + 2, 0, 1, h, TEAK3); g.fill(x + 6, 0, 1, h, TEAK2); g.fill(x + 9, 0, 1, h, TEAK3); }

// ---- the echo machines, drawn as they work ------------------------------------------------------
// tape: a loop past the record head and the play head, their distance the time;
// magnetic: a drum turning past four play heads; space: a loop with three
function echoMachine(g, x, y, w, h, type, f, hot) {
  var c = hot ? "slot" : IVORY, dim = IVORY2;
  if (/magnet/i.test(type)) {
    var cx = x + h / 2 + 2, cy = y + h / 2, r = h / 2 - 3;
    g.dot(cx, cy, r, "#3a3a36"); g.dot(cx, cy, r - 4, ECHO_GRN); g.dot(cx, cy, 3, dim);
    for (var k = 0; k < 5; k++) { // the record head at the top, four play heads round the drum
      var a = -Math.PI / 2 + k * (0.35 + f * 0.9), hx = cx + Math.cos(a) * (r + 3), hy = cy + Math.sin(a) * (r + 3);
      g.fill(hx - 2.5, hy - 2.5, 5, 5, k ? c : JEWEL);
    }
    return;
  }
  var lx = x + 4, ly = y + 6, lw = w - 8, lh = h - 14, heads = /space/i.test(type) ? 3 : 1;
  g.line(lx + 8, ly, lx + lw - 8, ly, 2, TAPE); g.line(lx + 8, ly + lh, lx + lw - 8, ly + lh, 2, TAPE);
  g.arc(lx + 8, ly + lh / 2, lh / 2, Math.PI / 2, Math.PI, 2, TAPE); g.arc(lx + lw - 8, ly + lh / 2, lh / 2, -Math.PI / 2, Math.PI, 2, TAPE);
  var rx = lx + 12;
  g.fill(rx, ly + lh - 2, 6, 7, JEWEL); // the record head, then the play heads at their distance
  for (var p = 0; p < heads; p++) {
    var px = rx + 10 + (lw - 34) * f * (heads === 1 ? 1 : (p + 1) / 3);
    g.fill(px, ly + lh - 2, 6, 7, c);
  }
}
// the reverbs: a plate with its two transducers, a spring, a room
function reverbMachine(g, x, y, w, h, type, hot) {
  var c = hot ? "slot" : IVORY, d = IVORY2;
  if (/spring/i.test(type)) {
    g.fill(x + 2, y + h / 2 - 6, 4, 12, d); g.fill(x + w - 6, y + h / 2 - 6, 4, 12, d);
    var pts = [];
    for (var i = 0; i <= 48; i++) { var px = x + 6 + (w - 12) * i / 48; pts.push(px, y + h / 2 + (i % 2 ? -5 : 5)); }
    g.poly(pts, 1.5, c);
  } else if (/chamber/i.test(type)) {
    g.line(x + 2, y + 3, x + w - 2, y + 3, 1.5, c); g.line(x + 2, y + h - 3, x + w - 2, y + h - 3, 1.5, c);
    g.line(x + 2, y + 3, x + 2, y + h - 3, 1.5, c); g.line(x + w - 2, y + 3, x + w - 2, y + h - 3, 1.5, c);
    g.fill(x + 6, y + h / 2 - 4, 6, 8, d); g.dot(x + w - 10, y + h / 2, 3, d);
    for (var r = 0; r < 3; r++) g.arc(x + 12, y + h / 2, 8 + r * 7, -0.6, 1.2, 1, d);
  } else {
    g.fill(x + 4, y + 3, w - 8, h - 6, "#4a4843"); g.fill(x + 6, y + 5, w - 12, h - 10, "#6d6a62");
    g.dot(x + w * 0.3, y + h / 2, 3, c); g.dot(x + w * 0.7, y + h / 2 - 3, 3, c);
    g.dot(x + 6, y + 5, 1.5, d); g.dot(x + w - 6, y + 5, 1.5, d); g.dot(x + 6, y + h - 5, 1.5, d); g.dot(x + w - 6, y + h - 5, 1.5, d);
  }
}

// ---- PANEL ------------------------------------------------------------------------------------
var TX = 18, TW = 51, TP = 53.5, DBX = 462, DBP = 33, EX = 742;
function tab(g, x, y, i, lit) {
  var col = TABCOL[Math.floor(i / 4)], ink = i >= 12 ? IVORY : ALU_INK;
  g.fill(x, y, TW, 22, lit ? col[0] : col[1]);
  if (lit) { g.fill(x, y + 22, TW, 2, "#000000"); g.dot(x + TW - 6, y + 5, 2, JEWEL); }
  else g.fill(x, y, TW, 3, col[0]);
  g.text(x + TW / 2, y + 16, TABLBL[i], lit ? (i >= 12 || i >= 8 && i < 12 ? IVORY : ALU_INK) : IVORY2, 0, TW - 2);
}
function panelGround(g, v) {
  g.fill(0, 0, 960, 160, FASCIA);
  teak(g, 0, 160); teak(g, 948, 160);
  g.fill(12, 0, 936, 19, ALU);
  g.fill(12, 19, 936, 1, ALU2);
  g.value(20, 15, "KRAUTDRUMS", ALU_INK, -1);
  g.text(152, 14, "RHYTHM UNIT", ALU_INK, -1);
  // the drawbars' rail and plates
  g.fill(DBX - 6, 22, 8 * DBP + 4, 1, RULE);
  for (var b = 0; b < 8; b++) {
    var x = DBX + b * DBP;
    g.fill(x + 10, 26, 10, 4, "#050505");
  }
  // the echo cabinet
  g.fill(EX, 24, 198, 76, ECHO_GRN);
  g.fill(EX, 24, 198, 1, ECHO_GRN2);
  g.fill(EX + 99, 30, 1, 64, ECHO_GRN2);
  g.text(EX + 6, 34, "ECHO", BRASS, -1);
  g.text(EX + 105, 34, "REVERB", BRASS, -1);
}
function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", hit = strikes(v), act = activeRhythms(v);
  g.layer("kd|" + kn.join(",") + "|" + act.list.join(",") + "|" + (v.$segmode || ""), function () {
    panelGround(g, v); encoderGround(g, v);
    for (var i = 0; i < 16; i++) tab(g, TX + (i % 8) * TP, 26 + Math.floor(i / 8) * 28, i, !!act.on[i]);
  });
  // the clock: its lamp burns while a rhythm is in a slot
  var y0 = 94, ac = act.list.length;
  g.dot(TX + 7, y0 - 4, 5, ac ? JEWEL : JEWEL_OFF);
  var sy = /sync/i.test(disp(v, "tempo_mode")), L = v.$live || {};
  var bpm = sy && L.known && L.bpm ? Math.round(L.bpm) : Math.round(num(v, "tempo", 120));
  g.value(TX + 18, y0, String(bpm), t === "tempo" ? "slot" : IVORY, -1);
  g.text(TX + 18 + g.measure(String(bpm), "value") + 4, y0, "BPM " + (sy ? "SYNC" : "FREE"), t === "tempo_mode" ? "slot" : IVORY2, -1);
  var dens = Math.round(num(v, "density", 1) * 100);
  g.text(TX + 150, y0, "DENSITY " + dens + "%", t === "density" ? "slot" : (dens < 100 ? BRASS : IVORY2), -1);
  g.text(TX + 260, y0, "DRIFT " + Math.round(num(v, "drift", 0) * 100) + "%", t === "drift" ? "slot" : IVORY2, -1);
  g.text(TX + 340, y0, "DECAY " + (1 + num(v, "all_decay", 0) * 3).toFixed(2) + "X", t === "all_decay" ? "slot" : IVORY2, -1);
  if (!ac) g.text(TX + 424, 15, "", ALU_INK, 1);
  // the drawbars: pulled out as far as the level, the group's lamp on the handle
  var onPage = {};
  for (var c = 0; c < 8; c++) if (kn[c]) onPage[kn[c]] = 1;
  for (var b = 0; b < 8; b++) {
    var x = DBX + b * DBP, k = BARS[b][0], f = frac(v, k, 0.5), hot = t === k, len = 6 + f * 50, hd = HANDLE[BARS[b][2]];
    g.fill(x + 13, 30, 4, len, "#9a958b");
    for (var m = 1; m <= 8; m++) if (m * 6.25 < len - 2) g.fill(x + 13, 30 + m * 6.25, 4, 1, "#6a665e");
    var hy = 30 + len;
    g.fill(x + 6, hy, 18, 14, hot ? "slot" : hd[0]);
    g.fill(x + 6, hy + 14, 18, 2, "#000000");
    var age = hit.g[b];
    if (age >= 0 && age < 0.35) g.dot(x + 15, hy + 7, 3, jewel(age));
    g.text(x + 15, 102, BARS[b][1], onPage[k] ? (hot ? "slot" : IVORY) : IVORY2, 0, DBP - 1);
  }
  // the echo and the reverb, as set
  var dt = disp(v, "delay_type") || "Tape", rt = disp(v, "reverb_type") || "Plate", dmix = num(v, "delay_mix", 0), rmix = num(v, "reverb_mix", 0);
  g.text(EX + 93, 34, upper(dt), dmix > 0 ? IVORY : IVORY2, 1);
  echoMachine(g, EX + 6, 40, 88, 36, dt, num(v, "delay_time", 0.35), false);
  var d = delayText(v);
  g.text(EX + 6, 94, dmix > 0 ? d[0] + (d[1] ? " " + d[1] : "") + "  " + Math.round(dmix * 100) + "%" : "OFF", dmix > 0 ? IVORY : IVORY2, -1, 88);
  g.text(EX + 192, 34, upper(rt), rmix > 0 ? IVORY : IVORY2, 1);
  reverbMachine(g, EX + 106, 42, 86, 32, rt, false);
  g.text(EX + 106, 94, rmix > 0 ? "MIX " + Math.round(rmix * 100) + "%" : "OFF", rmix > 0 ? IVORY : IVORY2, -1);
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(940, 14, upper(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, ALU_INK, 1);
  // the segment the encoders play: its brass legend lit (Pung draws the bar above)
  var sg = v.$segmode === "segment" ? v.$segment : "";
  if (sg === "echo") g.text(EX + 6, 34, "ECHO", "slot", -1);
  if (sg === "reverb") g.text(EX + 105, 34, "REVERB", "slot", -1);
  encoderRow(g, v);
}
// segments: the rhythm tabs (the eight slots), the echo, the reverb and the bus
var SEGS = [
  { id: "rhythms", label: "Rhythms", rect: [14, 24, 432, 54], keys: ["rhythm_1", "rhythm_2", "rhythm_3", "rhythm_4", "rhythm_5", "rhythm_6", "rhythm_7", "rhythm_8"] },
  { id: "echo", label: "Echo", rect: [EX, 24, 99, 76], keys: ["delay_mix", "delay_time", "delay_fb", "delay_type", "delay_sync"] },
  { id: "reverb", label: "Reverb", rect: [EX + 99, 24, 99, 76], keys: ["reverb_mix", "reverb_decay", "reverb_tone", "reverb_type", "bus_comp", "limiter", "master_vol"] }
];
var EXTRA = ["rhythm_1", "rhythm_2", "rhythm_3", "rhythm_4", "rhythm_5", "rhythm_6", "rhythm_7", "rhythm_8", "tempo", "tempo_mode",
  "density", "drift", "all_decay", "delay_type", "delay_time", "delay_sync", "delay_mix", "reverb_type", "reverb_mix"];
for (var bi = 0; bi < 8; bi++) EXTRA.push(BARS[bi][0]);
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [
    { label: "Levels", keys: ["lvl_bass", "lvl_conga", "lvl_tom1", "lvl_tom2", "lvl_claves", "lvl_snare", "lvl_cowbell", "lvl_cymbals"] },
    { label: "Clock", keys: ["tempo", "tempo_mode", "density", "drift", "all_decay", "bus_comp", "master_vol", "limiter"] }
  ],
  segments: SEGS,
  draws_segments: true,
  extra_keys: EXTRA,
  screen: panel
});

// ---- RHYTHMS: what the slots play together ------------------------------------------------------------
function band(g) { g.fill(0, 0, 4, g.h, TEAK); g.fill(948, 0, 4, g.h, TEAK); }
// the merged loop: the sequencer counts 32 steps, each rhythm takes its own
// length (a 12-step waltz turns against a 16-step rock), the loudest wins
var MERGE = {};
function merged(list) {
  var key = list.join(",");
  if (MERGE[key]) return MERGE[key];
  var m = [];
  for (var r = 0; r < 9; r++) {
    var row = [];
    for (var s = 0; s < 32; s++) {
      var best = 0;
      for (var i = 0; i < list.length; i++) {
        var R = KRHY[list[i]];
        if (!R) continue;
        var c = R[2][r].charAt(s % R[1]);
        if (c !== "." && +c > best) best = +c;
      }
      row.push(best);
    }
    m.push(row);
  }
  return (MERGE[key] = m);
}
push.compartment({
  id: "rhythms", label: "Rhythms",
  pages: [{ label: "Rhythms", keys: ["rhythm_1", "rhythm_2", "rhythm_3", "rhythm_4", "rhythm_5", "rhythm_6", "rhythm_7", "rhythm_8"] }],
  extra_keys: ["density", "tempo", "tempo_mode"],
  screen: function (g, v) {
    band(g);
      var act = activeRhythms(v), hit = strikes(v), t = v.$touched || "", n = act.list.length;
    var names = [];
    for (var i = 0; i < n; i++) names.push(upper(RNAMES[act.list[i]]));
    if (!n) {
      // nothing in the slots: the sixteen rhythms as their pads lay them out (notes 52..67)
      g.text(12, 12, "NO RHYTHM IN THE SLOTS: TURN ONE BELOW, OR PRESS ITS PAD", "dim", -1);
      for (var p = 0; p < 16; p++) {
        var tx = 12 + (p % 8) * 116, ty = 24 + Math.floor(p / 8) * 30, col = TABCOL[Math.floor(p / 4)];
        g.fill(tx, ty, 110, 24, col[1]); g.fill(tx, ty, 3, 24, col[0]);
        g.text(tx + 10, ty + 16, upper(RNAMES[p]), IVORY, -1, 70);
        g.text(tx + 104, ty + 16, String(52 + p), IVORY2, 1);
      }
      return;
    }
    var dens = num(v, "density", 1), keep = n > 1 ? dens / Math.sqrt(n) : dens;
    g.text(12, 10, names.join(" + "), "fg", -1, 560);
    g.text(938, 10, keep >= 0.999 ? "EVERY STEP PLAYS" : "A STEP PLAYS " + Math.round(keep * 100) + "% OF THE TIME", t === "density" ? "slot" : (keep < 0.999 ? BRASS : "dim"), 1, 370);
    var m = merged(act.list), rows = [];
    for (var r = 0; r < 9; r++) { for (var q = 0; q < 32; q++) if (m[r][q]) { rows.push(r); break; } }
    var gx = 74, gw = 864, gy = 16, rh = Math.min(12, 68 / Math.max(1, rows.length)), sw = gw / 32;
    // the 16ths, a beat every four, the sequencer's loop of 32
    for (var s = 0; s <= 32; s++) g.fill(gx + s * sw, gy, 1, rows.length * rh, s % 16 === 0 ? "dim" : (s % 4 === 0 ? "line" : "#1a1a1a"));
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri], y = gy + ri * rh, age = hit.r[row];
      g.text(gx - 8, y + rh - 3, ROWS[row], age >= 0 && age < 0.2 ? JEWEL : "dim", 1);
      for (var qq = 0; qq < 32; qq++) {
        var st = m[row][qq];
        if (st) g.fill(gx + qq * sw + 2, y + 1, sw - 3, rh - 2, st >= 8 ? IVORY : (st >= 6 ? "#b9b09a" : "#77705f"));
      }
    }
  }
});

// ---- ECHO: the delay machine and the reverb ------------------------------------------------------------
push.compartment({
  id: "echo", label: "Echo",
  pages: [
    { label: "Delay", keys: ["delay_mix", "delay_time", "delay_fb", "delay_type", "delay_sync"] },
    { label: "Reverb", keys: ["reverb_mix", "reverb_decay", "reverb_tone", "reverb_type", "bus_comp", "limiter"] }
  ],
  extra_keys: ["tempo", "tempo_mode"],
  screen: function (g, v) {
    band(g);
      var t = v.$touched || "", dt = disp(v, "delay_type") || "Tape", dhot = /^delay_/.test(t);
    var mix = num(v, "delay_mix", 0), fb = num(v, "delay_fb", 0.35), sec = delaySeconds(v), d = delayText(v);
    // the machine
    g.fill(10, 4, 150, 78, ECHO_GRN);
    g.text(16, 15, upper(dt) + " ECHO", BRASS, -1);
    echoMachine(g, 14, 24, 142, 50, dt, num(v, "delay_time", 0.35), t === "delay_time" || t === "delay_type");
    // its echoes in time: the dry strike, then each repeat fed back (RE-style feedback past 100% runs away)
    var ex = 176, ew = 380, ey = 14, eh = 52, span = Math.max(0.25, Math.min(4, sec * 6));
    g.text(ex, 10, mix > 0 ? "ECHOES  " + d[0] + (d[1] ? " " + d[1] : "") + (synced(v) ? " ON THE BEAT" : "") : "ECHO OFF: MIX AT 0", mix > 0 ? (dhot ? "fg" : "dim") : "faint", -1);
    g.fill(ex, ey + eh, ew, 1, "line");
    g.fill(ex, ey + 4, 3, eh - 4, "dim");
    var a = mix, x = sec, k = 0;
    while (x <= span && k < 40 && a > 0.015) {
      var hx = ex + ew * x / span, hh = Math.max(2, (eh - 4) * Math.min(1, a));
      g.fill(hx - 1, ey + eh - hh, 3, hh, dhot ? "slot" : IVORY);
      a *= fb; x += sec; k++;
    }
    g.text(ex, 82, "0", "faint", -1);
    g.text(ex + ew, 82, span < 1 ? Math.round(span * 1000) + " MS" : span.toFixed(1) + " S", "faint", 1);
    g.text(ex + ew / 2, 82, "FEEDBACK " + Math.round(fb * 100) + "%", t === "delay_fb" ? "slot" : "dim", 0);
    // the reverb, and the bus
    var rt = disp(v, "reverb_type") || "Plate", rhot = /^reverb_/.test(t), rm = num(v, "reverb_mix", 0);
    var rx = 580;
    g.fill(rx - 10, 4, 1, 78, "line");
    g.text(rx, 15, upper(rt) + (rm > 0 ? "  MIX " + Math.round(rm * 100) + "%" : "  OFF"), rhot ? "fg" : "dim", -1);
    reverbMachine(g, rx, 22, 120, 40, rt, t === "reverb_type");
    var tone = num(v, "reverb_tone", 0.5), dec = num(v, "reverb_decay", 0.55);
    g.text(rx + 136, 32, "DECAY", t === "reverb_decay" ? "slot" : "dim", -1);
    g.fill(rx + 186, 27, 160, 4, "line"); g.fill(rx + 186, 27, Math.round(160 * dec), 4, t === "reverb_decay" ? "slot" : IVORY);
    g.text(rx + 136, 50, "TONE", t === "reverb_tone" ? "slot" : "dim", -1);
    g.text(rx + 186, 50, "DARK", "faint", -1); g.text(rx + 346, 50, "BRIGHT", "faint", 1);
    g.fill(rx + 186 + Math.round(154 * tone), 38, 6, 6, t === "reverb_tone" ? "slot" : IVORY);
    g.fill(rx + 186, 40, 160, 2, "line");
    var bc = num(v, "bus_comp", 0);
    g.text(rx, 78, "BUS " + (bc > 0 ? "COMP " + Math.round(bc * 100) + "%" : "COMP OFF") + "   LIMITER " + upper(disp(v, "limiter") || "--"),
      t === "bus_comp" || t === "limiter" ? "slot" : "dim", -1);
  }
});

// ---- ATTITUDE: the studio chain ----------------------------------------------------------------------------
var CHAIN = [["preamp_drive", "PREAMP"], ["tape_amount", "TAPE"], ["hpf_freq", "HPF"], ["eq_body", "BODY"], ["eq_air", "AIR"],
  ["filter_cutoff", "LADDER"], ["phaser_amount", "PHASER"]];
// where a frequency stands on Pung's filter axis (20 Hz .. 20 kHz, three decades)
function axisOf(hz) { return Math.max(0, Math.min(1, Math.log(hz / 20) / Math.LN10 / 3)); }
push.compartment({
  id: "attitude", label: "Attitude",
  pages: [{ label: "Attitude", keys: ["preamp_drive", "tape_amount", "hpf_freq", "eq_body", "eq_air", "filter_cutoff", "filter_reso", "phaser_amount"] }],
  screen: function (g, v) {
    band(g);
    var t = v.$touched || "";
    g.text(12, 10, "THE STUDIO CHAIN, BEFORE THE ECHO", "dim", -1);
    // the chain, in its order: a stage lit as far as it works
    var cx = 12, cw = 58;
    for (var i = 0; i < CHAIN.length; i++) {
      var k = CHAIN[i][0], x = cx + i * (cw + 8), amt;
      if (k === "hpf_freq") amt = (num(v, k, 60) - 30) / 470;
      else if (k === "eq_body" || k === "eq_air") amt = Math.abs(num(v, k, 0)) / 6;
      else if (k === "filter_cutoff") amt = 1 - axisOf(num(v, k, 15000)) / axisOf(15000);
      else amt = num(v, k, 0);
      var on = amt > 0.01, hot = t === k || (k === "filter_cutoff" && t === "filter_reso");
      g.fill(x, 18, cw, 28, on ? ECHO_GRN2 : "#151515");
      if (on) g.fill(x, 44, Math.max(2, Math.round(cw * Math.min(1, amt))), 2, hot ? "slot" : BRASS);
      g.text(x + cw / 2, 35, CHAIN[i][1], hot ? "slot" : (on ? IVORY : "faint"), 0, cw - 2);
      if (i < CHAIN.length - 1) g.line(x + cw + 1, 32, x + cw + 7, 32, 1, "dim");
    }
    for (var j = 0; j < CHAIN.length; j++) {
      var kk = CHAIN[j][0], vv = kk === "preamp_drive" ? [(1 + num(v, kk, 0) * 5).toFixed(1), "X"] : valueText(v, kk);
      g.text(cx + j * (cw + 8) + cw / 2, 62, vv[0] + (vv[1] && vv[1] !== "%" ? " " + vv[1] : vv[1]), t === kk ? "slot" : "dim", 0, cw + 6);
    }

    // the ladder's response, with the HPF and the shelves where they act
    var fx = 488, fw = 452;
    var x0 = fx + 6, x1 = fx + fw - 6, hx = x0 + (x1 - x0) * axisOf(num(v, "hpf_freq", 60));
    g.fill(x0, 8, Math.max(1, hx - x0), 72, "#2a1410");
    g.filter(fx, 2, fw, 84, { cutoff: "filter_cutoff", at: axisOf(num(v, "filter_cutoff", 15000)), resonance: "filter_reso", type: "LP 24 dB", color: BRASS });
    g.fill(hx, 8, 1, 72, t === "hpf_freq" ? "slot" : JEWEL_MID);
    g.text(hx + 4, 18, "HPF", t === "hpf_freq" ? "slot" : JEWEL_MID, -1);
    var bx = x0 + (x1 - x0) * axisOf(80), ax = x0 + (x1 - x0) * axisOf(6000), bb = num(v, "eq_body", 0), aa = num(v, "eq_air", 0);
    if (Math.abs(bb) > 0.05) g.text(bx, 76, (bb > 0 ? "+" : "") + bb.toFixed(1), t === "eq_body" ? "slot" : BRASS, 0);
    if (Math.abs(aa) > 0.05) g.text(ax, 76, (aa > 0 ? "+" : "") + aa.toFixed(1), t === "eq_air" ? "slot" : BRASS, 0);
  }
});
