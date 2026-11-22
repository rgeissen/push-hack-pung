// NoiseMaker on the Push: a port of a classic freeware VA (6 voices, two
// oscillators and a sub, twelve filters, two LFOs, a free envelope).
//
// The front panel is the module's own macro page, laid out as the
// instrument's panel is: the oscillators, the filter, its envelope, the amp
// envelope, the master volume, each section over the encoders that play it.
//
//   OSCILLATORS  the sound the oscillators actually make: osc 1, osc 2 at its
//                interval and the sub (a pulse two octaves down) summed at
//                their levels, ring modulation as the engine mixes it. Under
//                it, the Wave macro's ten stops (sine, FM, triangle ... sub
//                bass) with the caret where it stands: one knob that sweeps
//                the whole oscillator section (0 leaves the patch's own)
//   FILTER       Pung's response of the chosen type (Moog and the state-
//                variable ones drawn as the slopes they have) and how far
//                the envelope opens it
//   ENVELOPES    filter and amp, each with its Time macro: one knob that
//                stretches attack, decay and release together
//
// Then the oscillators, the filter, the modulation (both LFOs, the free
// envelope and the drawn envelope, with a grid of where each one goes).
//
// The look: the plugin's grey panel and black pointer knobs, with orange
// LEDs. The name is the module's: NoiseMaker.

var PANEL = "#303337", INSET = "#232528", RULE = "#4a4e54", INK = "#eeeeee", DIM = "#a3a7ad";
var LED = "#ff8b26", LED_OFF = "#4d3420", KNOB = "#111213", KNOB_RIM = "#5c6066", TICK = "#8a8e94";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
function up(s) { return String(s).toUpperCase(); }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function hot(v, k) { return v.$touched === k; }
function anyHot(v, ks) { for (var i = 0; i < ks.length; i++) if (v.$touched === ks[i]) return true; return false; }
var memo = {}, memoN = 0;
function cached(key, make) { if (!(key in memo)) { if (++memoN > 100) { memo = {}; memoN = 1; } memo[key] = make(); } return memo[key]; }
// an enum as its index, whether the module answers 2 or "Osc2"
function pick(v, k, names) {
  if (!known(v, k)) return -1;
  var s = String(v[k].value), n = parseInt(s, 10);
  if (!isNaN(n) && String(n) === s.trim()) return n;
  var d = up(v[k].display || s);
  for (var i = 0; i < names.length; i++) if (up(names[i]) === d) return i;
  return -1;
}
function pct(v, k, d) { return known(v, k) ? clamp(num(v, k, d * 100) / 100, 0, 1) : d; }
function on(v, k) { var s = up(txt(v, k)); return s === "ON" || s === "1"; }

// ---- the engine's own laws (Engine/AudioUtils.h, Vco.h, the wrapper's macros) ---------------
var OSC1W = ["Saw", "Pulse", "Noise"], OSC2W = ["Saw", "Pulse", "Tri", "Sine", "Noise"];
var FILT = ["LP24", "LP18", "LP12", "LP6", "HP24", "BP24", "Notch", "SV-LP", "SV-HP", "SV-BP", "Moog", "Moog2"];
var FILT_PUNG = ["LP 24 dB", "LP 18 dB", "LP 12 dB", "LP 6 dB", "HP 24 dB", "BP", "Notch", "LP 12 dB", "HP 12 dB", "BP", "LP 24 dB", "LP 24 dB"];
var WAVE_STOPS = [[1, "SINE", "sine"], [12, "FM", "fm"], [23, "TRIANGLE", "tri"], [34, "SAW", "saw"], [45, "DUAL SAW", "saw2"],
  [56, "SQUARE", "square"], [67, "THIN PULSE", "pulse"], [78, "PULSE+SAW", "pulsesaw"], [89, "RING", "ring"], [100, "SUB BASS", "sub"]];
function semis(v, k) { return Math.floor(pct(v, k, 0.5) * 48 - 24); }                 // getOscTuneValue
function fine(v, k) { return (pct(v, k, 0.5) - 0.5) * 2; }                             // getOscFineTuneValue
function tune2Semis(raw) {                                                             // the Osc2 Pitch macro
  raw = Math.round(clamp(raw, 0, 255));
  var c = [0, 128, 255], s = [0, 12, 24];
  for (var i = 0; i < 3; i++) if (Math.abs(raw - c[i]) <= 8) return s[i] + (raw - c[i]) / 8 * 0.2;
  return Math.floor(raw * 24 / 255 + 0.5);
}
function timeShift(v, k) { return Math.round((pct(v, k, 0.5) - 0.5) * 200); }          // -100..100, 0 at the detent
function waveStop(d) { // the stops either side of the Wave macro, and how far between
  if (d < 1) return null;
  var i = 0;
  while (i < WAVE_STOPS.length - 2 && d > WAVE_STOPS[i + 1][0]) i++;
  var a = WAVE_STOPS[i], b = WAVE_STOPS[i + 1];
  return { a: a, b: b, f: clamp((d - a[0]) / (b[0] - a[0]), 0, 1) };
}

// one sample of each oscillator, phase in cycles
function rnd(i) { var s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
function osc(kind, ph, duty) {
  var p = ph - Math.floor(ph);
  switch (kind) {
  case "Pulse": return p < duty ? 1 : -1;
  case "Tri": return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  case "Sine": return Math.sin(2 * Math.PI * p);
  case "Noise": return rnd(Math.floor(ph * 37)) * 2 - 1;
  }
  return 1 - 2 * p; // saw
}
function dutyOf(pw) { return clamp(0.5 - Math.abs(pw - 0.5) * 0.9, 0.06, 0.5); }
// the oscillator section's sum over two cycles of osc 1 (Vco.h: osc 3 is a
// pulse two octaves down; ring modulation crossfades the sum into the product)
function oscState(v) {
  var w1 = OSC1W[pick(v, "osc1_wave", OSC1W)] || "Saw", w2 = OSC2W[pick(v, "osc2_wave", OSC2W)] || "Saw";
  var r = Math.pow(2, (semis(v, "osc2_tune") + fine(v, "osc2_fine") - semis(v, "osc1_tune") - fine(v, "osc1_fine")) / 12);
  return { w1: w1, w2: w2, v1: pct(v, "osc1_vol", 0.8), v2: pct(v, "osc2_vol", 0), v3: pct(v, "osc3_vol", 0),
    duty: dutyOf(pct(v, "osc1_pw", 0.5)), ratio: r, ring: pct(v, "ringmod", 0), sync: on(v, "osc_sync"), fm: pct(v, "osc2_fm", 0) };
}
function stateKey(s) { return [s.w1, s.w2, s.v1, s.v2, s.v3, s.duty.toFixed(2), s.ratio.toFixed(3), s.ring, s.sync, s.fm].join("|"); }
function mixPts(s, x, y, w, h, cyc, which) {
  return cached("mx|" + which + "|" + stateKey(s) + "|" + [x, y, w, h, cyc].join(","), function () {
    var pts = [], n = 120, peak = 0.001, raw = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n * cyc, ph2 = s.sync ? (t - Math.floor(t)) * s.ratio : t * s.ratio;
      ph2 += s.fm * 2 * Math.sin(2 * Math.PI * t); // osc 1 bends osc 2's phase
      var a = osc(s.w1, t, s.duty), b = osc(s.w2, ph2, 0.5), sub = osc("Pulse", t / 4, 0.5), val;
      if (which === 1) val = a * s.v1;
      else if (which === 2) val = b * s.v2;
      else if (which === 3) val = sub * s.v3;
      else val = (a * s.v1 + b * s.v2) * (1 - s.ring) + a * b * s.ring * Math.max(s.v1, s.v2) + sub * s.v3;
      raw.push(val); peak = Math.max(peak, Math.abs(val));
    }
    var norm = which ? 1 : 1 / Math.max(1, peak);
    for (var j = 0; j <= n; j++) pts.push(x + w * j / n, y + h / 2 - raw[j] * norm * (h / 2 - 1));
    return pts;
  });
}
// a Wave stop's own little picture (the module's card draws these too)
function glyph(kind, x, y, w, h) {
  return cached("gl|" + kind + "|" + [x, y, w, h].join(","), function () {
    var out = [[]], n = 24;
    function f(k, t) { var p = t - Math.floor(t);
      if (k === "fm") return Math.sin(2 * Math.PI * t + 2.6 * Math.sin(4 * Math.PI * t));
      if (k === "ring") return Math.sin(2 * Math.PI * t) * Math.sin(10 * Math.PI * t);
      if (k === "tri") return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      if (k === "square") return p < 0.5 ? 1 : -1;
      if (k === "pulse") return p < 0.18 ? 1 : -1;
      if (k === "sine") return Math.sin(2 * Math.PI * t);
      return 1 - 2 * p; }
    var parts = kind === "saw2" ? ["saw", "saw"] : kind === "pulsesaw" ? ["pulse", "saw"] : kind === "sub" ? ["saw", "square"] : [kind];
    var hh = parts.length > 1 ? (h - 2) / 2 : h;
    for (var q = 0; q < parts.length; q++) {
      var pts = [], y0 = y + q * (hh + 2), prev = null;
      for (var i = 0; i <= n; i++) {
        var t = i / n * (parts[q] === "square" && kind === "sub" ? 1 : 2), yy = y0 + hh / 2 - f(parts[q], t) * (hh / 2);
        if (prev !== null && Math.abs(yy - prev) > hh * 0.6) pts.push(x + w * i / n, prev);
        pts.push(x + w * i / n, yy); prev = yy;
      }
      out[q] = pts;
    }
    return out;
  });
}

// ---- the panel ---------------------------------------------------------------------------
var COL = 120, TOP = 22, BOT = 100;
var SECTIONS = [[0, 2, "OSCILLATORS", "osc"], [2, 3, "FILTER", "filter"], [5, 1, "FILTER ENV", "fenv"], [6, 1, "AMP ENV", "aenv"], [7, 1, "MASTER", "master"]];
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
// the encoder row's geometry: in segment mode Pung names the segments in the
// bottom 18 pixels, and the row moves up and its knobs shrink
function rowGeo(v) { return v.$segmode ? { ky: 128, rs: 0.62, name: 113, val: 138, vx: 44 } : { ky: 138, rs: 1, name: 116, val: 146, vx: 52 }; }
function ground(g, knobs, v) {
  var rg = rowGeo(v);
  g.layer("nm|" + knobs.join(",") + "|" + rg.ky, function () {
    g.fill(0, 0, 960, 160, PANEL);
    for (var i = 0; i < SECTIONS.length; i++) {
      var x = SECTIONS[i][0] * COL + 4, w = SECTIONS[i][1] * COL - 8;
      g.fill(x, TOP, w, BOT - TOP, INSET);
      g.fill(x, TOP, w, 1, RULE);
      g.text(x + 6, TOP + 11, SECTIONS[i][2], DIM, -1);
    }
    // the Wave macro's stops, printed under the oscillators
    for (var s = 0; s < WAVE_STOPS.length; s++) {
      var gx = 10 + s * 22.6, gl = glyph(WAVE_STOPS[s][2], gx, BOT - 14, 16, 10);
      for (var q = 0; q < gl.length; q++) g.poly(gl[q], 1, TICK);
    }
    // the encoder row: the panel's black knobs with their scales
    g.fill(0, 103, 960, 1, RULE);
    for (var c = 0; c < 8; c++) {
      if (!knobs[c]) continue;
      var kx = c * COL + 26, ky = rg.ky, rs = rg.rs;
      for (var t = 0; t <= 10; t++) {
        var a = A0 + SWEEP * t / 10;
        g.line(kx + Math.cos(a) * 15.5 * rs, ky + Math.sin(a) * 15.5 * rs, kx + Math.cos(a) * 18 * rs, ky + Math.sin(a) * 18 * rs, 1, t % 5 ? RULE : TICK);
      }
      g.dot(kx, ky, 13 * rs, KNOB_RIM); g.dot(kx, ky, 12 * rs, KNOB);
    }
  });
}
// the active segment, as the panel says it: its section's legend lit in the
// slot colour (Pung draws the bar above it)
function segLit(g, v) {
  if (v.$segmode !== "segment") return;
  for (var i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i][3] !== v.$segment) continue;
    var x = SECTIONS[i][0] * COL + 4, w = SECTIONS[i][1] * COL - 8, tw = g.measure(SECTIONS[i][2]) + 12;
    g.fill(x, TOP, tw, 14, "slot");
    g.text(x + 6, TOP + 11, SECTIONS[i][2], "black", -1);
  }
}
function led(g, x, y, s, lit) {
  g.dot(x, y - 3, 2.5, lit ? LED : LED_OFF);
  g.text(x + 6, y, s, lit ? INK : DIM, -1);
  return x + 14 + g.measure(s);
}
function header(g, v) {
  g.value(8, 17, "NOISEMAKER", INK, -1);
  var x = 8 + g.measure("NOISEMAKER", "value") + 12, bank = up(txt(v, "bank_name"));
  if (bank) { g.text(x, 16, bank, DIM, -1, 120); x += Math.min(120, g.measure(bank)) + 10; }
  var name = up(txt(v, "preset_name")).replace(/\s+TAL$/, "");
  // the effects, lit where they are in the sound (bitcrush at 100 is off)
  var r = 950;
  var fx = [["DELAY", pct(v, "delay_wet", 0) > 0.005], ["REVERB", pct(v, "reverb_wet", 0) > 0.005], ["CHORUS II", on(v, "chorus2")],
    ["CHORUS I", on(v, "chorus1")], ["CRUSH", known(v, "bitcrush") && pct(v, "bitcrush", 1) < 0.995]];
  for (var i = 0; i < fx.length; i++) { var w = g.measure(fx[i][0]) + 14; led(g, r - w, 16, fx[i][0], fx[i][1]); r -= w + 6; }
  if (name) g.value(x, 17, name, INK, -1, r - x - 10);
}
function oscSection(g, v) {
  var s = oscState(v), x = 10, w = 2 * COL - 20, y = TOP + 15, h = 44;
  var d = Math.round(num(v, "wave", 0)), st = waveStop(d), lit = hot(v, "wave");
  // what the Wave macro is doing: OFF (the patch's own), or between two stops
  var label = !known(v, "wave") ? "--" : (!st ? "WAVE OFF" : (st.f < 0.08 ? st.a[1] : (st.f > 0.92 ? st.b[1] : st.a[1] + " > " + st.b[1])));
  g.text(2 * COL - 10, TOP + 11, label, lit ? "slot" : LED, 1, 120);
  var t2 = num(v, "tune2", 0), ts = tune2Semis(t2), tl = "OSC 2 " + (ts >= 0 ? "+" : "") + (ts % 1 ? ts.toFixed(1) : ts) + " ST";
  if (known(v, "tune2") && (ts !== 0 || hot(v, "tune2"))) g.text(2 * COL - 10, y + h - 1, tl, hot(v, "tune2") ? "slot" : DIM, 1);
  g.fill(x, y + h / 2, w, 1, RULE);
  g.poly(mixPts(s, x, y, w, h, 2, 0), 2, lit || hot(v, "tune2") ? "slot" : INK);
  // the caret over the stops
  if (st) {
    var cx = 10 + 8 + (d - 1) / 99 * 9 * 22.6;
    g.fill(Math.round(cx) - 1, BOT - 18, 3, 3, lit ? "slot" : LED);
    var near = st.f < 0.5 ? st.a : st.b, ni = WAVE_STOPS.indexOf(near), gl = glyph(near[2], 10 + ni * 22.6, BOT - 14, 16, 10);
    for (var q = 0; q < gl.length; q++) g.poly(gl[q], 1.5, lit ? "slot" : LED);
  }
}
function filterSection(g, v) {
  var x = 2 * COL + 4, w = 3 * COL - 8, ti = pick(v, "filter_type", FILT), type = FILT_PUNG[ti] || "LP 24 dB";
  var lit = anyHot(v, ["cutoff", "resonance"]);
  var drive = pct(v, "filter_drive", 0), kf = pct(v, "keyfollow", 0);
  g.text(x + w - 6, TOP + 11, (drive > 0.005 ? "DRIVE " + Math.round(drive * 100) + "  " : "") + (kf > 0.005 ? "KEY " + Math.round(kf * 100) + "  " : "") + (ti >= 0 ? up(FILT[ti]) : "--"), LED, 1);
  g.filter(x, TOP + 13, w, BOT - TOP - 15, { cutoff: "cutoff", resonance: "resonance", type: type, color: INK });
  // the envelope's reach: Filter Env opens the cutoff by up to its whole travel
  var env = pct(v, "filter_env", 0), c = pct(v, "cutoff", 0.5);
  if (env > 0.005) {
    var x0 = x + 6 + (w - 12) * c, x1 = x + 6 + (w - 12) * Math.min(1, c + env * (1 - c));
    g.fill(Math.round(x0), BOT - 6, Math.max(2, Math.round(x1 - x0)), 2, hot(v, "filter_env") ? "slot" : LED);
    g.dot(x1, BOT - 5, 2.5, hot(v, "filter_env") ? "slot" : LED);
  }
}
function envSection(g, v, col, p, macro) {
  var x = col * COL + 4, w = COL - 8, sh = timeShift(v, macro);
  g.envelope(x, TOP + 13, w, BOT - TOP - 27, { attack: p + "a", decay: p + "d", sustain: p + "s", release: p + "r", color: INK });
  var s = known(v, macro) ? (sh === 0 ? "TIME AS SET" : "TIME " + (sh > 0 ? "+" : "") + sh) : "--";
  g.text(x + w / 2, BOT - 4, s, hot(v, macro) ? "slot" : (sh ? LED : DIM), 0);
}
function master(g, v) {
  var x = 7 * COL + 4, w = COL - 8, vol = pct(v, "volume", 0.6), lv = v.$live, segs = 14;
  // the volume as the knob sets it, and the sound's level, measured
  var meter = lv && lv.known ? clamp(lv.level, 0, 1) : -1;
  for (var i = 0; i < segs; i++) {
    var sy = BOT - 8 - i * 4.6, lit = meter >= 0 && i < Math.round(meter * segs);
    g.fill(x + 12, Math.round(sy), 30, 3, lit ? (i > 11 ? LED : INK) : RULE);
  }
  g.fill(x + 56, TOP + 18, 4, BOT - TOP - 26, KNOB);
  var fy = BOT - 8 - Math.round(vol * (BOT - TOP - 30));
  g.fill(x + 50, fy - 3, 16, 6, hot(v, "volume") ? "slot" : INK);
  var vc = Math.round(num(v, "voices", 6));
  g.text(x + w - 4, BOT - 4, known(v, "voices") ? (vc === 1 ? "MONO" : vc + " VOICES") : "", DIM, 1);
}
// how NoiseMaker's values read, everywhere (push.display): the macros and
// the tunings in what they do, not as 0..100
function readout(k, rawS) {
  var raw = parseFloat(rawS);
  if (isNaN(raw)) return null;
  var f = clamp(raw / 100, 0, 1);
  switch (k) {
  case "wave": var st = waveStop(Math.round(raw)); return [st ? (st.f < 0.5 ? st.a[1] : st.b[1]) : "OFF", ""];
  case "tune2": var ts = tune2Semis(raw); return [(ts >= 0 ? "+" : "") + (ts % 1 ? ts.toFixed(1) : String(ts)), "st"];
  case "fenv_time": case "aenv_time": case "free_amt": var sh = Math.round((f - 0.5) * 200); return [(sh > 0 ? "+" : "") + sh, ""];
  case "osc1_tune": case "osc2_tune": case "osc_tune": var s = Math.floor(f * 48 - 24); return [(s > 0 ? "+" : "") + s, "st"];
  case "osc1_fine": case "osc2_fine": var c = Math.round((f - 0.5) * 200); return [(c > 0 ? "+" : "") + c, "ct"];
  }
  return null;
}
push.display(function (key, raw) { var r = readout(key, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
function shown(v, k) {
  if (!known(v, k)) return ["--", ""];
  return readout(k, v[k].value) || [txt(v, k), v[k].unit || ""];
}
var SHORT = { wave: "WAVE", tune2: "OSC 2 PITCH", cutoff: "CUTOFF", resonance: "RESONANCE", filter_env: "FILTER ENV",
  fenv_time: "FILTER TIME", aenv_time: "AMP TIME", volume: "VOLUME" };
function row(g, v) {
  var knobs = v.$knobs || [];
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    var rg = rowGeo(v), rs = rg.rs, h = v.$touched === k, x0 = i * COL, kx = x0 + 26, ky = rg.ky;
    g.text(x0 + 8, rg.name, SHORT[k] || up(v[k].name || k), h ? "slot" : DIM, -1, COL - 16);
    if (h) g.arc(kx, ky, 15 * rs, 0, Math.PI * 2, 2, "slot");
    if (known(v, k)) {
      var a = A0 + SWEEP * fr(v, k, 0);
      g.line(kx + Math.cos(a) * 3, ky + Math.sin(a) * 3, kx + Math.cos(a) * 11 * rs, ky + Math.sin(a) * 11 * rs, 2.5, h ? "slot" : INK);
    }
    var s = shown(v, k), uw = s[1] ? g.measure(s[1]) + 3 : 0;
    g.value(x0 + rg.vx, rg.val, s[0], h ? "slot" : INK, -1, COL - rg.vx - 6 - uw);
    if (s[1]) g.text(x0 + rg.vx + Math.min(COL - rg.vx - 6 - uw, g.measure(s[0], "value")) + 3, rg.val, s[1], DIM, -1);
  }
  var ps = v.$pages || [];
  if (ps.length > 1) g.text(950, 31, up(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length, DIM, 1);
}

// Pung's default pages in Noisemaker's grey, with its knobs and orange LED
push.theme({ ground: INSET, panel: KNOB, ink: INK, dim: DIM, rule: KNOB_RIM, faint: RULE, accent: INK, knob: "pointer" });
push.compartment({
  id: "panel", label: "NoiseMaker", front_panel: true,
  pages: [{ label: "Macros", keys: ["wave", "tune2", "cutoff", "resonance", "filter_env", "fenv_time", "aenv_time", "volume"] }],
  extra_keys: ["preset", "preset_name", "bank_name", "osc1_wave", "osc2_wave", "osc1_vol", "osc2_vol", "osc3_vol", "osc1_tune", "osc2_tune",
    "osc1_fine", "osc2_fine", "osc1_pw", "osc2_fm", "ringmod", "osc_sync", "filter_type", "filter_drive", "keyfollow",
    "fenv_a", "fenv_d", "fenv_s", "fenv_r", "aenv_a", "aenv_d", "aenv_s", "aenv_r", "voices",
    "chorus1", "chorus2", "reverb_wet", "delay_wet", "bitcrush"],
  // the panel's sections under the hands, the effects over their LEDs
  segments: [
    { id: "osc", label: "Osc", rect: [4, 22, 232, 78], keys: ["osc1_wave", "osc1_tune", "osc1_pw", "osc1_vol", "osc2_wave", "osc2_tune", "osc2_vol", "osc3_vol"] },
    { id: "filter", label: "Filter", rect: [244, 22, 352, 78], keys: ["filter_type", "cutoff", "resonance", "keyfollow", "filter_env", "filter_drive"] },
    { id: "fenv", label: "Filter Env", rect: [604, 22, 112, 78], keys: ["fenv_a", "fenv_d", "fenv_s", "fenv_r", "fenv_time"] },
    { id: "aenv", label: "Amp Env", rect: [724, 22, 112, 78], keys: ["aenv_a", "aenv_d", "aenv_s", "aenv_r", "aenv_time"] },
    { id: "master", label: "Master", rect: [844, 22, 112, 78], keys: ["volume", "voices", "portamento", "porta_mode", "detune", "vintage", "highpass"] },
    { id: "fx", label: "Effects", rect: [600, 0, 356, 20], keys: ["chorus1", "chorus2", "bitcrush", "reverb_wet", "reverb_decay", "delay_wet", "delay_time", "delay_fb"] }
  ],
  draws_segments: true,
  screen: function (g, v) {
    ground(g, v.$knobs || [], v);
    header(g, v);
    oscSection(g, v);
    filterSection(g, v);
    envSection(g, v, 5, "fenv_", "fenv_time");
    envSection(g, v, 6, "aenv_", "aenv_time");
    master(g, v);
    segLit(g, v);
    row(g, v);
  }
});

// ---- OSCILLATORS: each wave as it is, and what leaves the section -----------------------------
function box(g, x, w, title, right, lit) {
  g.fill(x, 2, w, 1, lit ? INK : RULE);
  g.text(x + 4, 13, title, lit ? INK : DIM, -1);
  if (right) g.text(x + w - 4, 13, right, lit ? INK : DIM, 1, w - 60);
}
push.compartment({
  id: "osc", label: "Oscillators",
  pages: [
    { label: "Osc 1", keys: ["osc1_wave", "osc1_tune", "osc1_fine", "osc1_phase", "osc1_pw", "osc1_vol"] },
    { label: "Osc 2", keys: ["osc2_wave", "osc2_tune", "osc2_fine", "osc2_phase", "osc2_fm", "osc2_vol"] },
    { label: "Master", keys: ["osc3_vol", "ringmod", "osc_sync", "detune", "osc_tune", "vintage", "highpass", "volume"] }
  ],
  extra_keys: ["osc1_wave", "osc2_wave", "osc1_vol", "osc2_vol", "osc3_vol", "osc1_tune", "osc2_tune", "osc1_fine", "osc2_fine",
    "osc1_pw", "osc2_fm", "ringmod", "osc_sync"],
  screen: function (g, v) {
    var s = oscState(v), page = v.$page || 0, t = v.$touched || "";
    var h1 = /^osc1_/.test(t), h2 = /^osc2_/.test(t) || t === "osc_sync", hm = !h1 && !h2 && t !== "";
    // osc 1
    var st1 = semis(v, "osc1_tune"), st2 = semis(v, "osc2_tune");
    box(g, 4, 230, "OSC 1", up(s.w1) + (s.w1 === "Pulse" ? " " + Math.round(s.duty * 100) + "%" : "") + "  " + (st1 > 0 ? "+" : "") + st1 + " ST", page === 0);
    g.fill(10, 50, 218, 1, RULE);
    g.poly(mixPts(s, 10, 20, 218, 60, 2, 1), 2, h1 ? "slot" : (s.v1 > 0.005 ? INK : RULE));
    // osc 2, at its interval to osc 1, synced, bent by FM
    box(g, 244, 230, "OSC 2", up(s.w2) + "  " + (st2 > 0 ? "+" : "") + st2 + " ST" + (s.sync ? "  SYNC" : "") + (s.fm > 0.005 ? "  FM" : ""), page === 1);
    g.fill(250, 50, 218, 1, RULE);
    g.poly(mixPts(s, 250, 20, 218, 60, 2, 2), 2, h2 ? "slot" : (s.v2 > 0.005 ? INK : RULE));
    // the sub and the sum: what the filter is given
    box(g, 484, 464, s.ring > 0.005 ? "THE SUM  (RING " + Math.round(s.ring * 100) + "%)" : "THE SUM", "", page === 2);
    g.text(944, 13, "SUB  2 OCT DOWN", hm && t === "osc3_vol" ? "slot" : DIM, 1);
    g.fill(490, 50, 300, 1, RULE);
    g.poly(mixPts(s, 490, 34, 300, 32, 2, 3), 1.5, t === "osc3_vol" ? "slot" : (s.v3 > 0.005 ? DIM : RULE));
    g.poly(mixPts(s, 490, 18, 300, 64, 2, 0), 2, hm ? "slot" : LED);
    // the three levels, as the panel's faders
    var lv = [["1", s.v1, "osc1_vol"], ["2", s.v2, "osc2_vol"], ["SUB", s.v3, "osc3_vol"]];
    for (var i = 0; i < 3; i++) {
      var fx = 816 + i * 44;
      g.fill(fx + 10, 22, 4, 52, KNOB);
      g.fill(fx + 10, 74 - Math.round(52 * lv[i][1]), 4, Math.round(52 * lv[i][1]), t === lv[i][2] ? "slot" : (lv[i][1] > 0.005 ? INK : RULE));
      g.text(fx + 12, 84, lv[i][0], DIM, 0);
    }
  }
});

// ---- FILTER: the response and its envelope -------------------------------------------------------
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Filter", keys: ["filter_type", "cutoff", "resonance", "keyfollow", "filter_env", "filter_drive"] },
    { label: "Filter Env", keys: ["fenv_a", "fenv_d", "fenv_s", "fenv_r", "fenv_time"] }
  ],
  screen: function (g, v) {
    var ti = pick(v, "filter_type", FILT), lit = anyHot(v, ["filter_type", "cutoff", "resonance"]);
    g.text(8, 11, ti >= 0 ? up(FILT[ti]) : "--", hot(v, "filter_type") ? "slot" : LED, -1);
    var env = pct(v, "filter_env", 0), c = pct(v, "cutoff", 0.5);
    g.text(470, 11, "ENV " + Math.round(env * 100) + "  DRIVE " + Math.round(pct(v, "filter_drive", 0) * 100) + "  KEY " + Math.round(pct(v, "keyfollow", 0) * 100), DIM, 1);
    g.filter(2, 13, 472, 73, { cutoff: "cutoff", resonance: "resonance", type: FILT_PUNG[ti] || "LP 24 dB", color: INK });
    if (env > 0.005) {
      var x0 = 8 + 460 * c, x1 = 8 + 460 * Math.min(1, c + env * (1 - c));
      g.fill(Math.round(x0), 80, Math.max(2, Math.round(x1 - x0)), 2, hot(v, "filter_env") ? "slot" : LED);
    }
    g.line(480, 4, 480, 84, 1, RULE);
    var sh = timeShift(v, "fenv_time");
    g.text(490, 11, "FILTER ENVELOPE", anyHot(v, ["fenv_a", "fenv_d", "fenv_s", "fenv_r"]) ? INK : DIM, -1);
    g.text(946, 11, known(v, "fenv_time") ? (sh ? "TIME " + (sh > 0 ? "+" : "") + sh : "TIME AS SET") : "", hot(v, "fenv_time") ? "slot" : (sh ? LED : DIM), 1);
    g.envelope(484, 13, 464, 73, { attack: "fenv_a", decay: "fenv_d", sustain: "fenv_s", release: "fenv_r", labels: true, color: INK });
  }
});

push.compartment({
  id: "amp", label: "Amp Env",
  pages: [{ label: "Amp Env", keys: ["aenv_a", "aenv_d", "aenv_s", "aenv_r", "aenv_time"] }]
});

// ---- MODULATION: the sources, and a grid of where each goes ---------------------------------------
var LFO1D = ["None", "Filter", "Osc1", "Osc2", "PW", "FM", "LFO2", "Osc1+2"];
var LFO2D = ["None", "Filter", "Osc1", "Osc2", "Pan", "Volume", "LFO1", "Osc1+2"];
var ENV3D = ["Off", "Filter", "Osc1", "Osc2", "PW", "FM"];
var DRAWD = ["Off", "Filter", "Osc1", "Osc2", "Osc1+2", "FM", "RingMod", "Volume"];
var COLS = ["FILTER", "OSC1", "OSC2", "OSC1+2", "PW", "FM", "RINGMOD", "PAN", "VOLUME", "LFO1", "LFO2"];
var COLN = ["FLT", "OSC1", "OSC2", "1+2", "PW", "FM", "RING", "PAN", "VOL", "LFO1", "LFO2"];
function colOf(name) { return COLS.indexOf(up(name)); }
push.compartment({
  id: "mod", label: "Modulation",
  pages: [
    { label: "LFO 1", keys: ["lfo1_wave", "lfo1_rate", "lfo1_amount", "lfo1_phase", "lfo1_dest", "lfo1_sync", "lfo1_keytrig"] },
    { label: "LFO 2", keys: ["lfo2_wave", "lfo2_rate", "lfo2_amount", "lfo2_phase", "lfo2_dest", "lfo2_sync", "lfo2_keytrig"] },
    { label: "Env 3", keys: ["free_a", "free_d", "free_amt", "free_dest"] },
    { label: "Env Draw", keys: ["env_dest", "env_amt", "env_speed"] }
  ],
  extra_keys: ["lfo1_dest", "lfo1_amount", "lfo2_dest", "lfo2_amount", "free_dest", "free_amt", "env_dest", "env_amt", "env_speed",
    "vel_vol", "vel_cut", "pw_cutoff"],
  screen: function (g, v) {
    var page = v.$page || 0, t = v.$touched || "";
    // left: the source this page edits
    if (page < 2) {
      var p = "lfo" + (page + 1) + "_";
      g.text(8, 11, "LFO " + (page + 1) + "  " + up(txt(v, p + "wave")) + (on(v, p + "sync") ? "  SYNC" : "") + (on(v, p + "keytrig") ? "  KEY TRIG" : ""), t.indexOf(p) === 0 ? INK : DIM, -1);
      g.lfo(2, 14, 420, 72, { shape: p + "wave", rate: p + "rate", sync: p + "sync", trig: p + "keytrig", color: INK });
    } else if (page === 2) {
      var amt = timeShift(v, "free_amt");
      g.text(8, 11, "ENV 3  ATTACK, DECAY  " + (amt ? (amt > 0 ? "+" : "") + amt : "AMOUNT 0"), t.indexOf("free_") === 0 ? INK : DIM, -1);
      g.envelope(2, 14, 420, 72, { attack: "free_a", decay: "free_d", labels: true, color: INK });
    } else {
      g.text(8, 11, "ENV DRAW", DIM, -1);
      g.value(8, 44, "THE PRESET'S OWN CURVE", INK, -1, 410);
      g.text(8, 62, "DRAWN WITH THE PATCH, SPEED " + up(txt(v, "env_speed") || "x1"), DIM, -1, 410);
      g.text(8, 78, "AMOUNT " + Math.round(pct(v, "env_amt", 0) * 100) + "%", anyHot(v, ["env_amt", "env_speed"]) ? "slot" : DIM, -1);
    }
    g.line(432, 4, 432, 84, 1, RULE);
    // right: every source's destination, as large as its amount
    var gx = 520, cw = 39;
    for (var c = 0; c < COLS.length; c++) g.text(gx + c * cw + cw / 2, 11, COLN[c], DIM, 0, cw - 2);
    var rows = [
      ["LFO 1", LFO1D[pick(v, "lfo1_dest", LFO1D)], pct(v, "lfo1_amount", 0), page === 0, ["lfo1_dest", "lfo1_amount"]],
      ["LFO 2", LFO2D[pick(v, "lfo2_dest", LFO2D)], pct(v, "lfo2_amount", 0), page === 1, ["lfo2_dest", "lfo2_amount"]],
      ["ENV 3", ENV3D[pick(v, "free_dest", ENV3D)], Math.abs(pct(v, "free_amt", 0.5) - 0.5) * 2, page === 2, ["free_dest", "free_amt"]],
      ["DRAW", DRAWD[pick(v, "env_dest", DRAWD)], pct(v, "env_amt", 0), page === 3, ["env_dest", "env_amt"]]
    ];
    for (var r = 0; r < rows.length; r++) {
      var y = 28 + r * 16, rw = rows[r], hit = anyHot(v, rw[4]);
      g.text(440, y + 4, rw[0], rw[3] ? INK : DIM, -1);
      g.fill(gx, y, cw * COLS.length, 1, "#2b2e32");
      var col = colOf(rw[1] || "");
      if (col < 0 || rw[2] < 0.005) continue;
      var cx = gx + col * cw + cw / 2;
      g.line(gx, y, cx - 4, y, 1, hit ? "slot" : (rw[3] ? DIM : RULE));
      g.dot(cx, y, 2.5 + rw[2] * 4, hit ? "slot" : LED);
    }
    // what the keys and the wheel reach: velocity and the wheel, as fixed routes
    var y2 = 28 + 4 * 16, vel = [["VOLUME", pct(v, "vel_vol", 0)], ["FILTER", pct(v, "vel_cut", 0)]];
    g.text(440, y2 + 4, "VELO", DIM, -1);
    g.fill(gx, y2, cw * COLS.length, 1, "#2b2e32");
    for (var i = 0; i < vel.length; i++) if (vel[i][1] > 0.005) g.dot(gx + colOf(vel[i][0]) * cw + cw / 2, y2, 2.5 + vel[i][1] * 4, DIM);
  }
});

push.compartment({
  id: "control", label: "Control",
  pages: [{ label: "Voicing / Vel", keys: ["voices", "portamento", "porta_mode", "vel_vol", "vel_env", "vel_cut", "pw_cutoff", "pw_pitch"] }]
});
push.compartment({
  id: "fx", label: "Effects",
  pages: [
    { label: "Chorus, Reverb", keys: ["chorus1", "chorus2", "bitcrush", "reverb_wet", "reverb_decay", "reverb_pre", "reverb_hi", "reverb_lo"] },
    { label: "Delay", keys: ["delay_wet", "delay_time", "delay_sync", "delay_fac_l", "delay_fac_r", "delay_hi", "delay_lo", "delay_fb"] }
  ]
});
