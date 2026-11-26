// Helm on the Push: Matt Tytel's polyphonic synth, its effects and its
// modulation system.
//
// Helm's own interface is a dark grey panel of titled sections, each with a
// display drawn live: the oscillators' waves, the filter's response, the
// envelopes, the LFOs, the step sequencer's bars, the formant's XY pad; and
// a modulation system where any source is patched to any knob. Its pictures
// here are those displays:
//
//   FRONT PANEL  the patch at a glance: both oscillators (their waves, as
//                many copies as unison voices), the sub, the noise; where
//                the modulation goes; then over the encoders the filter
//                (LP, BP, HP as its blend sets it), the amp envelope, the
//                output
//   OSCILLATORS  each oscillator, its unison stack spread by its detune, its
//                interval; the sub, cross modulation, noise, feedback
//   FILTER       the response, the blend between its three modes, its
//                envelope
//   ENVELOPES    amp and mod envelope, and what the mod envelope reaches
//   LFOS         the three LFOs, and where each one goes
//   STEP SEQ     the whole sequence, the page's eight steps over their knobs
//   EFFECTS      the chain in Helm's order, the formant's vowel pad
//   MODULATION   each slot over its knob: source, destination, amount
//
// Colours: Helm's charcoal, its displays drawn in green on black, the
// modulation in blue. The values read in Helm's units (push.display).

var BG = "#1f1f1f", SEC = "#2b2b2b", BAR = "#353535", RULE = "#444444", INK = "#efefef", DIM = "#9a9a9a";
var GREEN = "#3ddc84", GREEN_DK = "#1d5a38", BLUE = "#4aa3ff", BLUE_DK = "#20466e", SCREEN = "#111111", TRACK = "#3c3c3c";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
// where the sound has a control now (v[k].now: Helm's live_mod, its modulation totals for the newest voice, the
// cutoff with the key track and filter envelope), 0..1 of its range; null when nothing moves it. rawNow: the
// same in Helm's units, else the knob
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? clamp(v[k].now, 0, 1) : null; }
function rawNow(v, k, d) { var n = nowOf(v, k); return n === null || !(v[k].max > v[k].min) ? num(v, k, d) : v[k].min + n * (v[k].max - v[k].min); }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function hot(v, k) { return v.$touched === k; }
function anyHot(v, ks) { for (var i = 0; i < ks.length; i++) if (v.$touched === ks[i]) return true; return false; }
function isOn(v, k) { var s = up(txt(v, k)); return s === "ON" || s === "1"; }
function idx(v, k, names) {
  if (!known(v, k)) return -1;
  var s = String(v[k].value), n = parseInt(s, 10);
  if (!isNaN(n) && String(n) === s.replace(/\.0+$/, "")) return n;
  for (var i = 0; i < names.length; i++) if (up(names[i]) === up(v[k].display || s)) return i;
  return Math.round(parseFloat(s)) || 0;
}
var memo = {}, memoN = 0;
function cached(key, make) { if (!(key in memo)) { if (++memoN > 120) { memo = {}; memoN = 1; } memo[key] = make(); } return memo[key]; }

// ---- Helm's units (its parameter table: quadratic times, frequencies as powers of 2) -----------
var OSCW = ["Sine", "Triangle", "Square", "Saw Down", "Saw Up", "3 Step", "4 Step", "8 Step", "3 Pyramid", "5 Pyramid", "9 Pyramid"];
var SYNC = ["Seconds", "Tempo", "Tempo Dotted", "Tempo Triplets"];
var TEMPO = ["32/1", "16/1", "8/1", "4/1", "2/1", "1/1", "1/2", "1/4", "1/8", "1/16", "1/32", "1/64"];
var SOURCES = ["none", "mono_lfo_1", "mono_lfo_2", "poly_lfo", "step_sequencer", "mod_envelope", "fil_envelope", "amp_envelope",
  "pitch_wheel", "mod_wheel", "aftertouch", "velocity", "note", "random"];
var SRC_NAME = ["--", "LFO 1", "LFO 2", "POLY LFO", "STEP SEQ", "MOD ENV", "FIL ENV", "AMP ENV", "BEND", "WHEEL", "PRESSURE", "VELOCITY", "NOTE", "RANDOM"];
var DESTS = ["none", "cutoff", "resonance", "volume", "bpm", "osc_1_volume", "osc_2_volume", "sub_volume", "noise_volume",
  "osc_1_transpose", "osc_2_transpose", "osc_1_tune", "osc_2_tune", "osc_1_waveform", "osc_2_waveform", "sub_waveform",
  "osc_1_unison_voices", "osc_2_unison_voices", "osc_1_unison_detune", "osc_2_unison_detune", "cross_modulation", "sub_shuffle",
  "osc_feedback_transpose", "osc_feedback_amount", "osc_feedback_tune", "poly_lfo_waveform", "poly_lfo_amplitude", "poly_lfo_frequency",
  "mono_lfo_1_waveform", "mono_lfo_1_amplitude", "mono_lfo_1_frequency", "mono_lfo_2_waveform", "mono_lfo_2_amplitude", "mono_lfo_2_frequency",
  "num_steps", "step_smoothing", "step_frequency", "arp_frequency", "arp_octaves", "arp_pattern", "arp_gate", "mod_attack", "mod_decay",
  "mod_sustain", "mod_release", "fil_attack", "fil_decay", "fil_sustain", "fil_release", "fil_env_depth", "amp_attack", "amp_decay",
  "amp_sustain", "amp_release", "keytrack", "filter_drive", "filter_blend", "stutter_frequency", "stutter_resample_frequency",
  "stutter_softness", "delay_frequency", "delay_feedback", "delay_dry_wet", "reverb_feedback", "reverb_damping", "reverb_dry_wet",
  "formant_x", "formant_y", "velocity_track", "portamento"];
function destName(i) {
  var s = DESTS[i] || "none";
  if (s === "none") return "--";
  return up(s).replace(/^OSC_(\d)_/, "OSC $1 ").replace(/^MONO_LFO_(\d)_/, "LFO $1 ").replace(/^POLY_LFO_/, "POLY LFO ")
    .replace(/^FIL_ENV_DEPTH/, "FIL ENV DEPTH").replace(/^FIL_/, "FIL ENV ").replace(/^AMP_/, "AMP ").replace(/^MOD_/, "MOD ENV ")
    .replace(/_/g, " ").replace("UNISON ", "UNI ").replace("TRANSPOSE", "TRANSP.").replace("FREQUENCY", "FREQ");
}
function noteHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
function hzText(h) { return h < 1000 ? [h < 10 ? h.toFixed(2) : String(Math.round(h)), "Hz"] : [(h / 1000).toFixed(h < 10000 ? 1 : 0), "kHz"]; }
function sText(t) { return t < 1 ? [t < 0.01 ? (t * 1000).toFixed(1) : String(Math.round(t * 1000)), "ms"] : [t.toFixed(t < 10 ? 2 : 1), "s"]; }
function sgn(x, d) { return (x > 0 ? "+" : "") + (d ? x.toFixed(d) : String(Math.round(x))); }
function readout(k, rawS) {
  var r = parseFloat(rawS);
  if (isNaN(r)) return null;
  if (/_(attack|decay|release)$/.test(k)) return sText(r * r);                   // quadratic seconds
  if (/_sustain$/.test(k) || /_volume$/.test(k) || /_dry_wet$/.test(k) || /_mix$/.test(k) || k === "osc_mix" ||
    k === "resonance" || k === "arp_gate" || k === "sub_shuffle" || k === "stutter_softness" || k === "reverb_damping" ||
    /^formant_[xy]$/.test(k)) return [String(Math.round(r * 100)), "%"];
  if (k === "volume") return [String(Math.round(r / 1.4143 * 100)), "%"];
  if (k === "cutoff") return hzText(noteHz(r));
  if (/(_frequency)$/.test(k)) {
    var hz = Math.pow(2, r);
    if (k === "delay_frequency") return sText(1 / hz);
    return hzText(hz);
  }
  if (/_transpose$/.test(k) || k === "fil_env_depth" || k === "pitch_bend_range") return [sgn(Math.round(r)), "st"];
  if (/_tune$/.test(k)) return [sgn(Math.round(r * 100)), "ct"];
  if (/_unison_detune$/.test(k)) return [String(Math.round(r)), "ct"];
  if (/_amplitude$/.test(k) || k === "keytrack" || k === "velocity_track" || /^mod_\d+_amount$/.test(k) && Math.abs(r) <= 1 ||
    k === "osc_feedback_amount" || k === "delay_feedback") return [sgn(Math.round(r * 100)), "%"];
  if (k === "cross_modulation") return [String(Math.round(r * 200)), "%"];
  if (k === "filter_drive" || k === "distortion_drive") return [sgn(r, 1), "dB"];
  if (k === "filter_blend") return [r < 0.25 ? "LP" : r < 0.75 ? "LP/BP" : r < 1.25 ? "BP" : r < 1.75 ? "BP/HP" : "HP", ""];
  if (k === "portamento") return sText(Math.pow(2, r));
  if (k === "reverb_feedback") return [String(Math.round((r - 0.8) / 0.2 * 100)), "%"];
  if (k === "step_smoothing") return [String(Math.round(r * 200)), "%"];
  if (/^step_seq_\d+$/.test(k)) return [sgn(r, 2), ""];
  return null;
}
push.display(function (key, raw) { var r = readout(key, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) { return s.plateau || s.raw === null || s.role === "sustain" ? null : s.raw * s.raw; });
});

// ---- waves: Helm's oscillator shapes, drawn ---------------------------------------------------
function wave(kind, p) {
  p -= Math.floor(p);
  switch (kind) {
  case 0: return Math.sin(2 * Math.PI * p);
  case 1: return p < 0.25 ? 4 * p : (p < 0.75 ? 2 - 4 * p : 4 * p - 4);
  case 2: return p < 0.5 ? 1 : -1;
  case 3: return 1 - 2 * p;
  case 4: return 2 * p - 1;
  case 5: case 6: case 7: var n = kind === 5 ? 3 : (kind === 6 ? 4 : 8); return Math.floor(p * n) / (n - 1) * 2 - 1;
  case 8: case 9: case 10: // a stepped triangle
    var m = kind === 8 ? 3 : (kind === 9 ? 5 : 9), tri = p < 0.5 ? 2 * p : 2 - 2 * p;
    return Math.min(m - 1, Math.floor(tri * m)) / (m - 1) * 2 - 1;
  }
  return 0;
}
function wavePts(kind, x, y, w, h, cyc, phase) {
  return cached("w|" + [kind, x, y, w, h, cyc, phase.toFixed(3)].join(","), function () {
    var pts = [], n = 96, prev = null;
    for (var i = 0; i <= n; i++) {
      var yy = y + h / 2 - wave(kind, cyc * i / n + phase) * (h / 2 - 1);
      if (prev !== null && Math.abs(yy - prev) > h * 0.3) pts.push(x + w * i / n, prev);
      pts.push(x + w * i / n, yy); prev = yy;
    }
    return pts;
  });
}
// an oscillator's display: its wave, and behind it one copy per unison
// voice, shifted as far as the detune drifts them apart
function oscDisplay(g, v, o, x, y, w, h, lit) {
  var p = "osc_" + o + "_", kind = idx(v, p + "waveform", OSCW), vol = num(v, p + "volume", 0.5);
  var uni = Math.round(clamp(num(v, p + "unison_voices", 1), 1, 15)), det = num(v, p + "unison_detune", 0);
  g.fill(x, y, w, h, SCREEN);
  if (kind < 0) { g.text(x + w / 2, y + h / 2 + 4, "--", DIM, 0); return; }
  var a = 0.3 + 0.7 * Math.sqrt(clamp(vol, 0, 1)), hh = (h - 4) * a, yy = y + (h - hh) / 2;
  g.fill(x, y + h / 2, w, 1, "#262626");
  var copies = Math.min(uni, 7);
  for (var i = copies - 1; i >= 1; i--) {
    var s = (i % 2 ? 1 : -1) * Math.ceil(i / 2) / Math.ceil((copies - 1) / 2 || 1);
    g.poly(wavePts(kind, x + 2, yy, w - 4, hh, 2, s * clamp(det / 100, 0, 1) * 0.25), 1, GREEN_DK);
  }
  g.poly(wavePts(kind, x + 2, yy, w - 4, hh, 2, 0), 2, lit ? "slot" : (vol > 0.005 ? GREEN : RULE));
}

// ---- the panel's sections ---------------------------------------------------------------------
function section(g, x, y, w, h, title) {
  g.fill(x, y, w, h, SEC);
  g.fill(x, y, w, 12, BAR);
  g.text(x + 5, y + 10, title, DIM, -1);
}
function filterType(v) {
  if (known(v, "filter_on") && !isOn(v, "filter_on")) return "Off";
  var st = idx(v, "filter_style", ["12dB", "24dB", "Shelf"]), b = num(v, "filter_blend", 0);
  if (st === 2) { var sh = idx(v, "filter_shelf", ["Low Shelf", "Band Shelf", "High Shelf"]); return sh === 0 ? "LP 12 dB" : sh === 2 ? "HP 12 dB" : "BP"; }
  var poles = st === 1 ? " 24 dB" : " 12 dB";
  return b < 0.5 ? "LP" + poles : (b < 1.5 ? "BP" : "HP" + poles);
}
function cutAt(n) { return clamp(Math.log(noteHz(n) / 20) / Math.LN10 / 3, 0, 1); }
function filterAt(v) { return cutAt(num(v, "cutoff", 100)); }
// the response is drawn where the sound has the cutoff (g.filter, given at, does not follow it by itself); while
// modulation moves it, the knob's own mark under the response and the way from there to the sound's place
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function filterNowAt(v) { return cutAt(rawNow(v, "cutoff", 100)); }
function filterMod(g, v, x, y, w, h) {
  var n = nowOf(v, "cutoff");
  if (n === null || Math.abs(n - v.cutoff.frac) < 0.004) return;
  var x0 = x + 6, x1 = x + w - 6, base = y + h - 6, xs = x0 + (x1 - x0) * filterAt(v), xc = x0 + (x1 - x0) * filterNowAt(v);
  g.fill(xs, base - 7, 2, 7, INK);
  g.fill(Math.min(xs, xc), base - 3, Math.max(1, Math.abs(xc - xs)), 2, MOD_DK);
  g.dot(xc, base - 2, 3, MOD);
}
// the sound's place beside an encoder's ring (r: the mark's radius): an arc in the modulation colour from the
// knob's place, and a dot
function modMark(g, v, k, cx, cy, r) {
  var n = nowOf(v, k);
  if (n === null || Math.abs(n - v[k].frac) < 0.004) return;
  var f = v[k].frac;
  g.arc(cx, cy, r, A0 + Math.min(f, n) * SWEEP, Math.abs(n - f) * SWEEP, 2, MOD_DK);
  g.dot(cx + Math.cos(A0 + n * SWEEP) * r, cy + Math.sin(A0 + n * SWEEP) * r, 2.8, MOD);
}
function filterName(v) {
  if (known(v, "filter_on") && !isOn(v, "filter_on")) return "OFF";
  var st = idx(v, "filter_style", ["12dB", "24dB", "Shelf"]);
  if (st === 2) return up(["Low Shelf", "Band Shelf", "High Shelf"][idx(v, "filter_shelf", ["Low Shelf", "Band Shelf", "High Shelf"])] || "SHELF");
  return readout("filter_blend", num(v, "filter_blend", 0))[0] + (st === 1 ? " 24" : " 12");
}
// the modulation slots: [slot, source, destination, amount]
function routes(v) {
  var out = [];
  for (var i = 0; i < 16; i++) {
    var en = num(v, "mod_" + i + "_enable", 0), s = Math.round(num(v, "mod_" + i + "_source", 0)), d = Math.round(num(v, "mod_" + i + "_dest", 0));
    if (en > 0.5 && s > 0 && d > 0) out.push([i, s, d, num(v, "mod_" + i + "_amount", 0)]);
  }
  return out;
}
var MOD_KEYS = [];
for (var mi = 0; mi < 16; mi++) MOD_KEYS.push("mod_" + mi + "_enable", "mod_" + mi + "_source", "mod_" + mi + "_dest", "mod_" + mi + "_amount");

// ---- the front panel ----------------------------------------------------------------------------
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5, COL = 120;
// the encoder row's geometry: in segment mode Pung names the segments in the
// bottom 18 pixels, and the row moves up
function rowGeo(v) { return v.$segmode ? { ky: 127, r: 10, name: 114, val: 137 } : { ky: 139, r: 13, name: 117, val: 146 }; }
function ground(g, knobs, v) {
  var rg = rowGeo(v);
  g.layer("helm|" + knobs.join(",") + "|" + rg.ky, function () {
    g.fill(0, 0, 960, 160, BG);
    section(g, 4, 20, 136, 42, "OSC 1"); section(g, 144, 20, 136, 42, "OSC 2"); section(g, 284, 20, 192, 42, "SUB  NOISE  X-MOD");
    section(g, 484, 20, 472, 42, "MODULATION");
    g.fill(4, 65, 352, 36, SEC); g.fill(364, 65, 472, 36, SEC); g.fill(844, 65, 112, 36, SEC);
    g.fill(0, 104, 960, 1, RULE);
    for (var c = 0; c < 8; c++) {
      if (!knobs[c]) continue;
      if (c) g.fill(c * COL, 110, 1, v.$segmode ? 30 : 44, SEC);
      g.arc(c * COL + 24, rg.ky, rg.r, A0, SWEEP, 4, TRACK);
    }
  });
}
// the active segment (Pung's bar over it), as Helm says a section is in focus: its title tab lit
var SEG_AT = { osc1: [4, 20, 136, "OSC 1"], osc2: [144, 20, 136, "OSC 2"], sub: [284, 20, 192, "SUB  NOISE  X-MOD"],
  mod: [484, 20, 472, "MODULATION"], filter: [4, 65, 352, "FILTER"], amp: [364, 65, 472, "AMP"], out: [844, 65, 112, "OUT"] };
function segLit(g, v) {
  if (v.$segmode !== "segment") return;
  var a = SEG_AT[v.$segment];
  if (!a) return;
  if (a[1] === 20) { g.fill(a[0], a[1], g.measure(a[3]) + 10, 12, "slot"); g.text(a[0] + 5, a[1] + 10, a[3], "black", -1); }
  else { g.fill(a[0] + 4, 67, g.measure(a[3]) + 8, 12, "slot"); g.text(a[0] + 8, 77, a[3], "black", -1); }
}
function header(g, v) {
  g.value(8, 16, "HELM", INK, -1);
  var x = 8 + g.measure("HELM", "value") + 10, bank = up(txt(v, "bank_name"));
  if (bank) { g.text(x, 15, bank, DIM, -1, 100); x += Math.min(100, g.measure(bank)) + 10; }
  var fx = [["REVERB", "reverb_on"], ["DELAY", "delay_on"], ["STUTTER", "stutter_on"], ["DISTORTION", "distortion_on"], ["FORMANT", "formant_on"], ["ARP", "arp_on"]];
  var r = 950;
  for (var i = 0; i < fx.length; i++) {
    var lit = isOn(v, fx[i][1]), w = g.measure(fx[i][0]) + 10;
    g.fill(r - w, 4, w, 12, lit ? GREEN_DK : SEC);
    g.text(r - w + 5, 14, fx[i][0], lit ? GREEN : DIM, -1);
    r -= w + 4;
  }
  var name = up(txt(v, "preset_name"));
  if (name) g.value(x, 16, name, INK, -1, r - x - 8);
}
function frontOsc(g, v) {
  for (var o = 1; o <= 2; o++) {
    var x = o === 1 ? 4 : 144, p = "osc_" + o + "_", tr = Math.round(num(v, p + "transpose", 0)), uni = Math.round(num(v, p + "unison_voices", 1));
    g.text(x + 131, 30, (tr ? sgn(tr) + " ST" : "") + (uni > 1 ? "  x" + uni : ""), DIM, 1);
    oscDisplay(g, v, o, x + 3, 34, 130, 26, false);
  }
  // the sub, the noise, cross modulation: Helm's middle column
  var sx = 287, sk = idx(v, "sub_waveform", OSCW), sv = num(v, "sub_volume", 0);
  g.fill(sx, 34, 60, 26, SCREEN);
  if (sk >= 0) g.poly(wavePts(sk, sx + 2, 37, 56, 20, 1, 0), 1.5, sv > 0.005 ? GREEN : RULE);
  var nv = num(v, "noise_volume", 0), nx = sx + 66;
  g.fill(nx, 34, 52, 26, SCREEN);
  g.poly(cached("nz", function () { var p = []; for (var i = 0; i <= 26; i++) { var r = Math.sin(i * 91.7) * 4375.5; r -= Math.floor(r); p.push(nx + 2 + i * 48 / 26, 47 + (r - 0.5) * 18); } return p; }), 1, nv > 0.005 ? GREEN : RULE);
  var xm = num(v, "cross_modulation", 0), xx = nx + 58;
  g.fill(xx, 45, 52, 4, SCREEN);
  if (xm > 0.002) g.fill(xx, 45, Math.max(2, Math.round(52 * xm * 2)), 4, GREEN);
  g.text(xx, 58, Math.round(xm * 200) + "%", DIM, -1);
}
function frontMod(g, v) {
  var rs = routes(v), x = 492;
  if (!rs.length) { g.text(x, 48, "NO SOURCE PATCHED", DIM, -1); return; }
  g.text(948, 30, rs.length + (rs.length === 1 ? " ROUTE" : " ROUTES"), DIM, 1);
  for (var i = 0; i < Math.min(4, rs.length); i++) {
    var cx = x + (i % 2) * 232, cy = 42 + Math.floor(i / 2) * 13, r = rs[i];
    var a = readout("mod_x_amount", r[3]), amt = Math.abs(r[3]) <= 1 ? sgn(Math.round(r[3] * 100)) + "%" : sgn(r[3], 1);
    g.text(cx, cy, SRC_NAME[r[1]], BLUE, -1);
    g.text(cx + 70, cy, "> " + destName(r[2]), INK, -1, 112);
    g.text(cx + 222, cy, amt, DIM, 1);
  }
  if (rs.length > 4) g.text(948, 98, "", DIM, 1);
}
function frontLower(g, v) {
  var nm = filterName(v), lit = anyHot(v, ["cutoff", "resonance", "fil_env_depth"]);
  g.text(10, 76, "FILTER", DIM, -1);
  g.text(10, 90, nm, nm === "OFF" ? DIM : GREEN, -1);
  g.filter(70, 66, 284, 35, { cutoff: "cutoff", at: filterNowAt(v), resonance: "resonance", type: filterType(v), color: INK });
  filterMod(g, v, 70, 66, 284, 35);
  // where the filter envelope takes the cutoff, in semitones
  var dep = num(v, "fil_env_depth", 0), c = filterAt(v);
  if (Math.abs(dep) > 0.5 && nm !== "OFF") {
    var to = clamp(c + dep / 12 / 9.966, 0, 1), x0 = 76 + 272 * Math.min(c, to), x1 = 76 + 272 * Math.max(c, to);
    g.fill(Math.round(x0), 97, Math.max(2, Math.round(x1 - x0)), 2, hot(v, "fil_env_depth") ? "slot" : BLUE);
  }
  g.text(370, 76, "AMP", DIM, -1);
  g.envelope(400, 66, 432, 35, { attack: "amp_attack", decay: "amp_decay", sustain: "amp_sustain", release: "amp_release", color: INK });
  // the output: Helm's volume, and the sound's level measured
  var vol = clamp(num(v, "volume", 1) / 1.4143, 0, 1), lv = v.$live, meter = lv && lv.known ? clamp(lv.level, 0, 1) : -1;
  g.text(850, 76, "OUT", DIM, -1);
  g.fill(880, 72, 70, 4, SCREEN); g.fill(880, 72, Math.round(70 * vol), 4, hot(v, "volume") ? "slot" : INK);
  g.fill(880, 84, 70, 8, SCREEN);
  if (meter > 0) g.fill(880, 84, Math.round(70 * meter), 8, GREEN);
}
var SHORT = { cutoff: "CUTOFF", resonance: "RESONANCE", fil_env_depth: "ENV DEPTH", amp_attack: "ATTACK", amp_decay: "DECAY",
  amp_sustain: "SUSTAIN", amp_release: "RELEASE", volume: "VOLUME" };
function row(g, v) {
  var knobs = v.$knobs || [];
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    var rg = rowGeo(v), on = v.$touched === k, x0 = i * COL, cx = x0 + 24, f = fr(v, k, 0);
    g.text(x0 + 8, rg.name, SHORT[k] || up(v[k].name || k), on ? "slot" : DIM, -1, COL - 16);
    if (known(v, k)) {
      var bip = (v[k].min !== undefined && v[k].min < 0) || /depth|amount|tune|transpose/.test(k);
      if (bip) { var m = A0 + SWEEP / 2, a = A0 + SWEEP * f; g.arc(cx, rg.ky, rg.r, Math.min(m, a), Math.abs(a - m), 4, on ? "slot" : INK); }
      else if (f > 0.004) g.arc(cx, rg.ky, rg.r, A0, SWEEP * f, 4, on ? "slot" : INK);
      modMark(g, v, k, cx, rg.ky, rg.r + 4);
    }
    var s = known(v, k) ? (readout(k, v[k].value) || [txt(v, k), v[k].unit || ""]) : ["--", ""], uw = s[1] ? g.measure(s[1]) + 3 : 0;
    g.value(x0 + 46, rg.val, s[0], on ? "slot" : INK, -1, COL - 52 - uw);
    if (s[1]) g.text(x0 + 46 + Math.min(COL - 52 - uw, g.measure(s[0], "value")) + 3, rg.val, up(s[1]), DIM, -1);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 30, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, DIM, 1);
}
// Pung's default pages in Helm's charcoal, its white ring knobs
push.theme({ ground: BG, panel: SEC, ink: INK, dim: DIM, rule: RULE, faint: TRACK, accent: INK, knob: "ring" });
push.compartment({
  id: "helm", label: "Helm", front_panel: true,
  pages: [{ label: "Helm", keys: ["cutoff", "resonance", "fil_env_depth", "amp_attack", "amp_decay", "amp_sustain", "amp_release", "volume"] }],
  extra_keys: ["preset", "preset_name", "bank_name", "osc_1_waveform", "osc_2_waveform", "osc_1_volume", "osc_2_volume",
    "osc_1_transpose", "osc_2_transpose", "osc_1_unison_voices", "osc_2_unison_voices", "osc_1_unison_detune", "osc_2_unison_detune",
    "sub_waveform", "sub_volume", "noise_volume", "cross_modulation", "filter_on", "filter_style", "filter_blend", "filter_shelf",
    "reverb_on", "delay_on", "stutter_on", "distortion_on", "formant_on", "arp_on"].concat(MOD_KEYS),
  // Helm's sections under the hands, as the panel lays them out
  // the top row's rects start a pixel into their boxes: Pung's bar above them clears the header's text
  segments: [
    { id: "osc1", label: "Osc 1", rect: [4, 21, 136, 41], keys: ["osc_1_waveform", "osc_1_volume", "osc_1_transpose", "osc_1_tune", "osc_1_unison_voices", "osc_1_unison_detune", "unison_1_harmonize"] },
    { id: "osc2", label: "Osc 2", rect: [144, 21, 136, 41], keys: ["osc_2_waveform", "osc_2_volume", "osc_2_transpose", "osc_2_tune", "osc_2_unison_voices", "osc_2_unison_detune", "unison_2_harmonize"] },
    { id: "sub", label: "Sub/Noise", rect: [284, 21, 192, 41], keys: ["sub_waveform", "sub_volume", "sub_octave", "sub_shuffle", "noise_volume", "cross_modulation", "osc_mix"] },
    { id: "mod", label: "Mod", rect: [484, 21, 472, 41], keys: ["mod_0_amount", "mod_1_amount", "mod_2_amount", "mod_3_amount", "mod_4_amount", "mod_5_amount", "mod_6_amount", "mod_7_amount"] },
    { id: "filter", label: "Filter", rect: [4, 65, 352, 36], keys: ["filter_on", "filter_style", "filter_blend", "cutoff", "resonance", "fil_env_depth", "keytrack", "filter_drive"] },
    { id: "amp", label: "Amp", rect: [364, 65, 472, 36], keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_release", "velocity_track"] },
    { id: "out", label: "Out", rect: [844, 65, 112, 36], keys: ["volume", "polyphony", "portamento", "portamento_type", "legato", "pitch_bend_range"] },
    { id: "fx", label: "Effects", rect: [600, 4, 350, 12], keys: ["formant_on", "distortion_on", "distortion_drive", "stutter_on", "delay_on", "delay_dry_wet", "reverb_on", "reverb_dry_wet"] }
  ],
  draws_segments: true,
  screen: function (g, v) {
    ground(g, v.$knobs || [], v);
    header(g, v);
    frontOsc(g, v);
    frontMod(g, v);
    frontLower(g, v);
    segLit(g, v);
    row(g, v);
  }
});

// ---- OSCILLATORS ----------------------------------------------------------------------------------
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Osc 1", keys: ["osc_1_waveform", "osc_1_volume", "osc_1_transpose", "osc_1_tune", "osc_1_unison_voices", "osc_1_unison_detune", "unison_1_harmonize"] },
    { label: "Osc 2", keys: ["osc_2_waveform", "osc_2_volume", "osc_2_transpose", "osc_2_tune", "osc_2_unison_voices", "osc_2_unison_detune", "unison_2_harmonize"] },
    { label: "Sub & Mix", keys: ["sub_waveform", "sub_volume", "sub_octave", "sub_shuffle", "osc_mix", "cross_modulation", "noise_volume"] },
    { label: "Feedback", keys: ["osc_feedback_amount", "osc_feedback_transpose", "osc_feedback_tune"] }
  ],
  extra_keys: ["osc_1_waveform", "osc_2_waveform", "osc_1_volume", "osc_2_volume", "osc_1_transpose", "osc_2_transpose", "osc_1_tune", "osc_2_tune",
    "osc_1_unison_voices", "osc_2_unison_voices", "osc_1_unison_detune", "osc_2_unison_detune", "unison_1_harmonize", "unison_2_harmonize",
    "sub_waveform", "sub_volume", "sub_octave", "noise_volume", "cross_modulation", "osc_feedback_amount", "osc_feedback_transpose"],
  screen: function (g, v) {
    var t = v.$touched || "", page = v.$page || 0;
    for (var o = 1; o <= 2; o++) {
      var p = "osc_" + o + "_", x = o === 1 ? 4 : 312, lit = t.indexOf(p) === 0 || t === "unison_" + o + "_harmonize";
      var kind = idx(v, p + "waveform", OSCW), uni = Math.round(num(v, p + "unison_voices", 1)), tr = Math.round(num(v, p + "transpose", 0));
      var tu = Math.round(num(v, p + "tune", 0) * 100), det = num(v, p + "unison_detune", 0);
      g.fill(x, 2, 300, 1, page === o - 1 ? INK : RULE);
      g.text(x + 4, 13, "OSC " + o + "  " + up(OSCW[kind] || "--"), page === o - 1 ? INK : DIM, -1);
      g.text(x + 296, 13, sgn(tr) + " ST" + (tu ? " " + sgn(tu) + " CT" : "") + "  " + Math.round(num(v, p + "volume", 0) * 100) + "%", lit ? "slot" : DIM, 1);
      oscDisplay(g, v, o, x, 18, 300, 52, lit);
      g.text(x + 4, 84, uni > 1 ? uni + " VOICES, " + Math.round(det) + " CT APART" + (isOn(v, "unison_" + o + "_harmonize") ? ", HARMONIZED" : "") : "ONE VOICE", lit ? "slot" : DIM, -1, 292);
    }
    // the middle: osc 1 crosses into osc 2, the mix, the sub, the noise, the feedback
    var x3 = 620, sk = idx(v, "sub_waveform", OSCW), sv = num(v, "sub_volume", 0), oc = Math.round(num(v, "sub_octave", 0));
    var sl = /^sub_/.test(t);
    g.fill(x3, 2, 328, 1, page >= 2 ? INK : RULE);
    g.text(x3 + 4, 13, "SUB  " + up(OSCW[sk] || "--") + (oc ? "  -2 OCT" : "  -1 OCT"), page === 2 ? INK : DIM, -1);
    g.text(x3 + 324, 13, Math.round(sv * 100) + "%", sl ? "slot" : DIM, 1);
    g.fill(x3, 18, 160, 30, SCREEN);
    if (sk >= 0) g.poly(wavePts(sk, x3 + 2, 21, 156, 24, 1, 0), 2, sl ? "slot" : (sv > 0.005 ? GREEN : RULE));
    var xm = num(v, "cross_modulation", 0), nv = num(v, "noise_volume", 0), fb = num(v, "osc_feedback_amount", 0);
    var bars = [["X-MOD", xm * 2, "cross_modulation"], ["NOISE", nv, "noise_volume"], ["FEEDBACK", Math.abs(fb), "osc_feedback_amount"]];
    for (var i = 0; i < 3; i++) {
      var by = 26 + i * 12;
      g.text(x3 + 170, by + 3, bars[i][0], DIM, -1);
      g.fill(x3 + 236, by - 2, 88, 4, SCREEN);
      if (bars[i][1] > 0.004) g.fill(x3 + 236, by - 2, Math.max(2, Math.round(88 * clamp(bars[i][1], 0, 1))), 4, t === bars[i][2] ? "slot" : GREEN);
    }
    var ft = Math.round(num(v, "osc_feedback_transpose", 0));
    g.text(x3 + 4, 66, "FEEDBACK " + (Math.abs(fb) > 0.004 ? sgn(Math.round(fb * 100)) + "% AT " + sgn(ft) + " ST" : "OFF"), page === 3 ? INK : DIM, -1, 320);
    g.text(x3 + 4, 84, xm > 0.002 ? "OSC 1 MODULATES OSC 2 " + Math.round(xm * 200) + "%" : "NO CROSS MODULATION", t === "cross_modulation" ? "slot" : DIM, -1, 320);
  }
});

// ---- FILTER: the response, the blend, the envelope ----------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["filter_on", "filter_style", "filter_blend", "filter_shelf", "cutoff", "resonance", "keytrack", "filter_drive"] },
    { label: "Filter Env", keys: ["fil_attack", "fil_decay", "fil_sustain", "fil_release", "fil_env_depth"] },
    { label: "Filter +", keys: ["filter_saturation", "filter_type"] }
  ],
  extra_keys: ["filter_on", "filter_style", "filter_blend", "filter_shelf", "cutoff", "fil_env_depth"],
  screen: function (g, v) {
    var nm = filterName(v), t = v.$touched || "";
    g.text(8, 11, nm, nm === "OFF" ? DIM : GREEN, -1);
    var hz = hzText(noteHz(num(v, "cutoff", 100)));
    g.text(470, 11, hz[0] + " " + up(hz[1]) + "  DRIVE " + readout("filter_drive", num(v, "filter_drive", 0))[0] + " DB", DIM, 1);
    g.filter(2, 13, 472, 58, { cutoff: "cutoff", at: filterNowAt(v), resonance: "resonance", type: filterType(v), color: INK });
    filterMod(g, v, 2, 13, 472, 58);
    // the blend: Helm's one knob from low-pass through band-pass to high-pass
    var b = clamp(num(v, "filter_blend", 0) / 2, 0, 1), shelf = idx(v, "filter_style", ["12dB", "24dB", "Shelf"]) === 2;
    var bx = 40, bw = 400, by = 80;
    g.text(8, by + 4, shelf ? "SHELF" : "LP", DIM, -1);
    if (!shelf) { g.text(bx + bw / 2, by + 4, "", DIM, 0); g.text(bx + bw + 30, by + 4, "HP", DIM, 1); }
    g.fill(bx, by, bw, 2, TRACK); g.fill(bx + bw / 2, by - 3, 1, 8, DIM);
    if (!shelf) g.fill(Math.round(bx + bw * b) - 2, by - 4, 5, 10, t === "filter_blend" ? "slot" : GREEN);
    g.text(bx + bw / 2 + 4, by - 2, shelf ? "" : "BP", DIM, -1);
    var dep = num(v, "fil_env_depth", 0);
    g.line(480, 4, 480, 84, 1, RULE);
    g.text(490, 11, "FILTER ENVELOPE", /^fil_/.test(t) ? INK : DIM, -1);
    g.text(946, 11, Math.abs(dep) > 0.5 ? "CUTOFF " + sgn(Math.round(dep)) + " ST AT ITS PEAK" : "DEPTH 0", t === "fil_env_depth" ? "slot" : (Math.abs(dep) > 0.5 ? BLUE : DIM), 1);
    g.envelope(484, 13, 464, 73, { attack: "fil_attack", decay: "fil_decay", sustain: "fil_sustain", release: "fil_release", labels: true, color: INK });
  }
});

// ---- ENVELOPES: amp and mod, and what the mod envelope reaches -------------------------------------
function routeList(g, v, src, x, y, w, max) {
  var rs = routes(v), n = 0;
  for (var i = 0; i < rs.length && n < max; i++) {
    if (src.indexOf(rs[i][1]) < 0) continue;
    var amt = Math.abs(rs[i][3]) <= 1 ? sgn(Math.round(rs[i][3] * 100)) + "%" : sgn(rs[i][3], 1);
    g.text(x, y + n * 12, "> " + destName(rs[i][2]), INK, -1, w - 60);
    g.text(x + w, y + n * 12, amt, BLUE, 1);
    n++;
  }
  if (!n) g.text(x, y, "NOT PATCHED", DIM, -1);
  return n;
}
push.compartment({
  id: "env", label: "Envelopes",
  pages: [
    { label: "Amp Env", keys: ["amp_attack", "amp_decay", "amp_sustain", "amp_release"] },
    { label: "Mod Env", keys: ["mod_attack", "mod_decay", "mod_sustain", "mod_release"] }
  ],
  extra_keys: MOD_KEYS,
  screen: function (g, v) {
    var page = v.$page || 0;
    g.text(8, 11, "AMP", page === 0 ? INK : DIM, -1);
    g.envelope(2, 13, 472, 73, { attack: "amp_attack", decay: "amp_decay", sustain: "amp_sustain", release: "amp_release", labels: true, color: INK });
    g.line(480, 4, 480, 84, 1, RULE);
    g.text(490, 11, "MOD", page === 1 ? INK : DIM, -1);
    g.envelope(484, 13, 300, 73, { attack: "mod_attack", decay: "mod_decay", sustain: "mod_sustain", release: "mod_release", labels: true, color: BLUE });
    g.text(796, 11, "REACHES", DIM, -1);
    routeList(g, v, [5], 796, 26, 150, 5);
  }
});

// ---- LFOS: three side by side, each with where it goes ---------------------------------------------
function lfoBox(g, v, p, x, w, title, src, lit, retrig) {
  var s = idx(v, p + "sync", SYNC), rate = s > 0 ? p + "tempo" : p + "frequency";
  var r = s > 0 ? (TEMPO[idx(v, p + "tempo", TEMPO)] || "") + (s === 2 ? "." : s === 3 ? "T" : "") : (known(v, p + "frequency") ? hzText(Math.pow(2, num(v, p + "frequency", 0))).join(" ") : "");
  g.text(x + 4, 11, title + "  " + up(txt(v, p + "waveform")), lit ? INK : DIM, -1, w - 70);
  g.text(x + w - 4, 11, up(r), lit ? INK : DIM, 1);
  g.lfo(x, 13, w, 48, { shape: p + "waveform", rate: rate, sync: p + "sync", trig: retrig, color: GREEN });
  routeList(g, v, src, x + 4, 72, w - 8, 2);
}
push.compartment({
  id: "lfo", label: "LFOs",
  pages: [
    { label: "Mono LFO 1", keys: ["mono_lfo_1_waveform", "mono_lfo_1_amplitude", "mono_lfo_1_frequency", "mono_lfo_1_sync", "mono_lfo_1_tempo", "mono_lfo_1_retrigger"] },
    { label: "Mono LFO 2", keys: ["mono_lfo_2_waveform", "mono_lfo_2_amplitude", "mono_lfo_2_frequency", "mono_lfo_2_sync", "mono_lfo_2_tempo", "mono_lfo_2_retrigger"] },
    { label: "Poly LFO", keys: ["poly_lfo_waveform", "poly_lfo_amplitude", "poly_lfo_frequency", "poly_lfo_sync", "poly_lfo_tempo"] }
  ],
  extra_keys: ["mono_lfo_1_waveform", "mono_lfo_1_frequency", "mono_lfo_1_sync", "mono_lfo_1_tempo", "mono_lfo_1_retrigger",
    "mono_lfo_2_waveform", "mono_lfo_2_frequency", "mono_lfo_2_sync", "mono_lfo_2_tempo", "mono_lfo_2_retrigger",
    "poly_lfo_waveform", "poly_lfo_frequency", "poly_lfo_sync", "poly_lfo_tempo"].concat(MOD_KEYS),
  screen: function (g, v) {
    var page = v.$page || 0;
    lfoBox(g, v, "mono_lfo_1_", 2, 312, "LFO 1", [1], page === 0, idx(v, "mono_lfo_1_retrigger", ["Free", "Retrigger", "Sync to Playhead"]) === 1);
    g.line(318, 4, 318, 84, 1, RULE);
    lfoBox(g, v, "mono_lfo_2_", 322, 312, "LFO 2", [2], page === 1, idx(v, "mono_lfo_2_retrigger", ["Free", "Retrigger", "Sync to Playhead"]) === 1);
    g.line(638, 4, 638, 84, 1, RULE);
    lfoBox(g, v, "poly_lfo_", 642, 306, "POLY LFO", [3], page === 2, true);
  }
});

// ---- STEP SEQUENCER: the whole sequence; on a page of steps, those eight over their knobs ----------
var STEPS = [];
for (var si = 0; si < 32; si++) STEPS.push("step_seq_" + (si < 10 ? "0" : "") + si);
function stepPages() {
  var out = [{ label: "Step Seq", keys: ["num_steps", "step_frequency", "step_sequencer_retrigger", "step_sequencer_sync", "step_sequencer_tempo", "step_smoothing"] }];
  for (var p = 0; p < 4; p++) out.push({ label: "Steps " + (p * 8 + 1) + "-" + (p * 8 + 8), keys: STEPS.slice(p * 8, p * 8 + 8) });
  return out;
}
push.compartment({
  id: "steps", label: "Step Seq",
  pages: stepPages(),
  extra_keys: STEPS.concat(["num_steps", "step_smoothing", "step_frequency", "step_sequencer_sync", "step_sequencer_tempo"], MOD_KEYS),
  screen: function (g, v) {
    var page = v.$page || 0, n = Math.round(clamp(num(v, "num_steps", 8), 1, 32)), sm = num(v, "step_smoothing", 0), t = v.$touched || "";
    var s = idx(v, "step_sequencer_sync", SYNC);
    var rate = s > 0 ? (TEMPO[idx(v, "step_sequencer_tempo", TEMPO)] || "") + (s === 2 ? "." : s === 3 ? "T" : "") : hzText(Math.pow(2, num(v, "step_frequency", 0))).join(" ");
    if (page === 0) {
      // the whole sequence, its smoothing as the line through it
      var x = 8, w = 640, mid = 48, hh = 30, sw = w / 32;
      g.text(8, 11, n + " STEPS  " + up(rate) + (sm > 0.005 ? "  SMOOTHED " + Math.round(sm * 200) + "%" : ""), anyHot(v, ["num_steps", "step_smoothing", "step_frequency", "step_sequencer_tempo"]) ? "slot" : DIM, -1);
      g.fill(x, mid, w, 1, RULE);
      for (var i = 0; i < 32; i++) {
        var val = num(v, STEPS[i], 0), bh = Math.round(val * hh), bx = Math.round(x + i * sw);
        g.fill(bx + 1, bh > 0 ? mid - bh : mid, Math.round(sw) - 2, Math.max(1, Math.abs(bh)), i < n ? GREEN : GREEN_DK);
      }
      g.fill(Math.round(x + n * sw) - 1, 16, 2, 66, t === "num_steps" ? "slot" : INK);
      g.text(668, 30, "REACHES", DIM, -1);
      routeList(g, v, [4], 668, 46, 280, 3);
      return;
    }
    // a page of eight: each step's bar over its knob, the rest small above
    var first = (page - 1) * 8;
    for (var j = 0; j < 32; j++) {
      var on = j >= first && j < first + 8, vv = num(v, STEPS[j], 0);
      g.fill(600 + j * 11, 10 - Math.round(vv * 6), 9, Math.max(1, Math.abs(Math.round(vv * 6))), on ? INK : (j < n ? GREEN_DK : SEC));
    }
    g.text(590, 12, n + " STEPS", DIM, 1);
    for (var k = 0; k < 8; k++) {
      var st = first + k, val2 = num(v, STEPS[st], 0), cx = k * 120 + 60, m2 = 52, b2 = Math.round(val2 * 30);
      g.fill(k * 120 + 20, m2, 80, 1, RULE);
      if (known(v, STEPS[st])) g.fill(cx - 14, b2 > 0 ? m2 - b2 : m2, 28, Math.max(2, Math.abs(b2)), t === STEPS[st] ? "slot" : (st < n ? GREEN : GREEN_DK));
      if (st >= n) g.text(cx, 88, "", DIM, 0);
    }
  }
});

push.compartment({
  id: "arp", label: "Arp",
  pages: [{ label: "Arpeggiator", keys: ["arp_on", "arp_pattern", "arp_sync", "arp_tempo", "arp_octaves", "arp_gate", "arp_frequency"] }]
});

// ---- EFFECTS: the chain in Helm's order; the formant's vowel pad --------------------------------------
push.compartment({
  id: "fx", label: "Effects",
  pages: [
    { label: "Formant", keys: ["formant_on", "formant_x", "formant_y"] },
    { label: "Distortion", keys: ["distortion_on", "distortion_type", "distortion_drive", "distortion_mix"] },
    { label: "Stutter", keys: ["stutter_on", "stutter_frequency", "stutter_sync", "stutter_tempo", "stutter_softness", "stutter_resample_frequency", "stutter_resample_sync", "stutter_resample_tempo"] },
    { label: "Delay", keys: ["delay_on", "delay_dry_wet", "delay_feedback", "delay_frequency", "delay_sync", "delay_tempo"] },
    { label: "Reverb", keys: ["reverb_on", "reverb_dry_wet", "reverb_feedback", "reverb_damping"] }
  ],
  extra_keys: ["formant_on", "formant_x", "formant_y", "distortion_on", "distortion_type", "distortion_drive", "stutter_on", "stutter_frequency",
    "stutter_sync", "stutter_tempo", "delay_on", "delay_dry_wet", "delay_feedback", "delay_frequency", "delay_sync", "delay_tempo",
    "reverb_on", "reverb_dry_wet", "reverb_feedback"],
  screen: function (g, v) {
    var page = v.$page || 0, t = v.$touched || "";
    // the formant pad: X and Y move the vowel; the dot is where it stands
    var px = 10, py = 6, ps = 76, fon = isOn(v, "formant_on");
    g.fill(px, py, ps * 1.6, ps, SCREEN);
    g.text(px + 4, py + 10, "FORMANT", page === 0 ? INK : DIM, -1);
    g.fill(px + Math.round(ps * 0.8), py + 14, 1, ps - 16, "#262626"); g.fill(px + 2, py + 14 + (ps - 16) / 2, ps * 1.6 - 4, 1, "#262626");
    var fx = num(v, "formant_x", 0.5), fy = num(v, "formant_y", 0.5);
    g.dot(px + 4 + (ps * 1.6 - 8) * fx, py + ps - 4 - (ps - 20) * fy, anyHot(v, ["formant_x", "formant_y"]) ? 5 : 4, anyHot(v, ["formant_x", "formant_y"]) ? "slot" : (fon ? GREEN : DIM));
    // the chain, after the voices: distortion, stutter, delay, reverb
    var chain = [
      ["DISTORTION", "distortion_on", up(txt(v, "distortion_type")) + "  " + readout("distortion_drive", num(v, "distortion_drive", 0)).join(" ")],
      ["STUTTER", "stutter_on", (function () { var s = idx(v, "stutter_sync", SYNC); return s > 0 ? (TEMPO[idx(v, "stutter_tempo", TEMPO)] || "") + (s === 2 ? "." : s === 3 ? "T" : "") : hzText(Math.pow(2, num(v, "stutter_frequency", 0))).join(" "); })()],
      ["DELAY", "delay_on", (function () { var s = idx(v, "delay_sync", SYNC); return (s > 0 ? (TEMPO[idx(v, "delay_tempo", TEMPO)] || "") + (s === 2 ? "." : s === 3 ? "T" : "") : sText(1 / Math.pow(2, num(v, "delay_frequency", 0))).join(" ")) + "  FB " + Math.round(num(v, "delay_feedback", 0) * 100) + "%"; })()],
      ["REVERB", "reverb_on", "SIZE " + readout("reverb_feedback", num(v, "reverb_feedback", 0.9))[0] + "%  MIX " + Math.round(num(v, "reverb_dry_wet", 0) * 100) + "%"]
    ];
    var cx = 146, cw = 196;
    for (var i = 0; i < chain.length; i++) {
      var x = cx + i * (cw + 6), lit = isOn(v, chain[i][1]), cur = page === i + 1;
      g.fill(x, 20, cw, 50, cur ? BAR : SEC);
      if (cur) g.fill(x, 20, cw, 2, INK);
      g.dot(x + 10, 33, 3, lit ? GREEN : "#3a3a3a");
      g.text(x + 18, 37, chain[i][0], lit ? INK : DIM, -1);
      g.text(x + 10, 58, up(chain[i][2]), lit ? (t.indexOf(chain[i][1].replace("_on", "")) === 0 ? "slot" : GREEN) : DIM, -1, cw - 16);
      if (i < chain.length - 1) g.text(x + cw + 3, 49, ">", DIM, 0);
    }
    g.text(146, 84, "AFTER THE VOICES, IN THIS ORDER", DIM, -1);
  }
});

// ---- MODULATION: each slot over its knob ------------------------------------------------------------
function slotPage(first) {
  var keys = [];
  for (var i = 0; i < 8; i++) keys.push("mod_" + (first + i) + "_amount");
  return { label: "Slots " + (first + 1) + "-" + (first + 8), keys: keys };
}
push.compartment({
  id: "mod", label: "Modulation",
  pages: [slotPage(0), slotPage(8)],
  extra_keys: MOD_KEYS,
  screen: function (g, v) {
    var first = (v.$page || 0) * 8, t = v.$touched || "", rs = routes(v);
    g.text(8, 10, rs.length + " OF 16 SLOTS PATCHED", DIM, -1);
    for (var i = 0; i < 8; i++) {
      var n = first + i, x = i * 120, en = num(v, "mod_" + n + "_enable", 0) > 0.5;
      var s = Math.round(num(v, "mod_" + n + "_source", 0)), d = Math.round(num(v, "mod_" + n + "_dest", 0)), a = num(v, "mod_" + n + "_amount", 0);
      var lit = t === "mod_" + n + "_amount", live = en && s > 0 && d > 0;
      g.fill(x + 6, 18, 108, 66, live ? SEC : "#181818");
      g.text(x + 12, 30, "SLOT " + (n + 1), DIM, -1);
      if (!live) { g.text(x + 60, 56, "EMPTY", "#555555", 0); continue; }
      g.text(x + 12, 44, SRC_NAME[s], BLUE, -1, 98);
      g.text(x + 12, 57, destName(d), INK, -1, 98);
      // the amount, either way from the middle
      var m = x + 60, span = 46, f = clamp(Math.abs(a) <= 1 ? a : a / Math.max(1, Math.abs(a)), -1, 1), len = Math.round(f * span);
      g.fill(x + 14, 72, 92, 2, TRACK); g.fill(m, 68, 1, 10, DIM);
      if (len) g.fill(len > 0 ? m : m + len, 70, Math.abs(len), 6, lit ? "slot" : BLUE);
    }
  }
});

push.compartment({
  id: "settings", label: "Settings",
  pages: [
    { label: "Settings", keys: ["polyphony", "volume", "velocity_track", "pitch_bend_range", "octave_transpose", "bpm", "sync_bpm"] },
    { label: "Glide", keys: ["portamento", "portamento_type", "legato"] }
  ]
});
