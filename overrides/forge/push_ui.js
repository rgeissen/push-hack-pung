// Forge on Push: eight FM/subtractive drum voices, two kits and the morph
// between them.
//
// Forge's own idea is Kit A and Kit B: the lower eight pads play A as the
// Morph knob takes it toward B, the upper eight play B as it is. The screens
// are a smithy: iron ground, Kit A in cold steel, Kit B in molten orange, a
// voice as hot as the morph has taken it.
//
//   PANEL      the kit and the morph (where it stands, its curve, what moves
//              it); the sixteen pads as the Move lays them out, each lower pad
//              in its heat, its level and pan; a pad lights white as it plays.
//              Pages: levels, pans, the eight Perf macros, the morph and kit.
//   ENVELOPES  the eight amp envelopes side by side (Pung's envelope, each
//              under its encoder), the curve and the repeat.
//   PITCH      each voice's pitch envelope as deep as its amount, its tune.
//   FILTER     each voice's two cutoffs on one scale, its resonance, its drive.
//   FX         who goes to the delay and the reverb, the echoes, the reverb
//              and the chorus.
// The pv1..pv8 keys are Kit A's voices (the module's own per-voice keys).

function known(v, k) { return !!(v[k] && v[k].known); }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function frac(v, k, d) { return known(v, k) ? v[k].frac : d; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : ""; }
function upper(s) { return String(s).toUpperCase(); }

// ---- the smithy's colours --------------------------------------------------------------
var IRON = "#131110", IRON2 = "#1e1a17", IRON3 = "#2a2420", RULE = "#3a322b", ASH = "#a0968b", ASH2 = "#6a625a";
var STEEL = [143, 179, 201], MOLTEN = [255, 122, 26], STEEL_DK = [52, 70, 84], MOLTEN_DK = [96, 44, 12];
var EMBER = "#ffc46b", WHITEHOT = "#fff3d6";
var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
function hex(c) { var s = "#"; for (var i = 0; i < 3; i++) { var x = Math.max(0, Math.min(255, Math.round(c[i]))); s += (x < 16 ? "0" : "") + x.toString(16); } return s; }
function heat(a, b, t) { t = Math.round(t * 12) / 12; return hex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); } // stepped: 16-bit colour, no gradients
// the morph as the engine applies it (forge.c, morph_voices)
function curved(t, c) { return c === 1 ? t * t : (c === 2 ? Math.sqrt(t) : (c === 3 ? t * t * (3 - 2 * t) : t)); }
var CURVES = ["Linear", "Exp", "Log", "S-Curve"];
function morphT(v) {
  var c = CURVES.indexOf(disp(v, "morph_curve"));
  if (c < 0) c = Math.max(0, Math.min(3, Math.round(num(v, "morph_curve", 0)) || 0));
  return { m: num(v, "morph", 0), c: c, t: curved(num(v, "morph", 0), c) };
}

// ---- the kits -----------------------------------------------------------------------------
// 64 Razzmatazz ports, 64 Forge originals, 9 LXR ports (forge.c, init_factory_kits)
var KITS = ["AeroVan", "BoomClap", "Cannon", "DatKick", "DNB", "ElectroBoom", "ElectroPunk", "HeavyIDM", "Krafty", "Smolder", "SpeakerDama", "Transformer", "Velocity", "SergeantKic", "BassDrive", "RoundHouse", "BrokenBot", "Thump", "DeepTech", "Tighty", "SiM", "NewBeat", "BitSmash", "Hacked", "Drip", "Flanged", "DubTech", "GlitchMetal", "HeadHunter", "AmbientPerc", "Bounce", "BinaryCrush", "RadioBuzz", "Distorted", "BoombapSlap", "Citadel", "BassKick", "Classic", "TheHorror", "EBM", "Industry", "Acid", "Deutschland", "Chippy", "Pulsar", "TwoFourTwo", "Florida", "CYBERDRUNK", "Moombahton", "DubBubbles", "SynthWave", "DDoS", "TechnoPure", "Pound", "Ritual", "BitMetal", "Miami", "Hardcore", "Slammer", "TheCave", "SpaceKit", "Marge", "SawzAll", "StunGun", "Plastic", "Anvil", "Forge", "Cinder", "Spark", "Dust", "Phasma", "Static", "Glass", "Marteau", "808", "909", "707", "CR-78", "Linn", "DMX", "SP-12", "Simmons", "Boom", "Trap", "LXR", "Riga", "Schmidt", "Indus", "Lattice", "Caustic", "Steam", "Iron", "Burn", "Cathedral", "Razz", "Bell", "Chime", "Pluck", "Wire", "Vinyl", "Snap", "Bounce", "Toy", "Crystal", "Digi", "Plaits", "Cycles", "Volca", "Wavefold", "BaseWidth", "Comb", "ThreeOp", "Index", "DX", "Techno", "House", "Detroit", "Acid", "Footwork", "Jungle", "Garage", "Dubstep", "Bossa", "Glitch", "Frost", "Magma", "Smoke", "Chaos", "808_BF", "808_2_BF", "808_3_BF", "808_4_BF", "808_9_BF", "7_8_9_BF", "909_BF", "707_BF", "Tech_BF"];
function kitName(i) { return KITS[i] ? upper(KITS[i]) : ""; }

// ---- values in their units (forge.c) ---------------------------------------------------------
function ms(x) { return x < 1 ? [String(Math.round(x * 1000 * 10) / 10), "MS"] : [x.toFixed(2), "S"]; }
function fmt(k, raw) {
  var x = parseFloat(raw), m = /^p?v\d_(.*)$/.exec(k), p = m ? m[1] : k;
  if (k === "kit") { var n = Math.round(x); return isNaN(n) ? null : [(n + 1) + " " + kitName(n), ""]; }
  if (isNaN(x)) return null;
  switch (p) {
  case "e1_atk": case "e1_dec": case "e2_dec": case "pe_dec": return ms(x);
  case "e1_crv": case "e2_crv": return Math.abs(x) < 0.02 ? ["LIN", ""] : [(x < 0 ? "EXP " : "LOG ") + Math.round(Math.abs(x) * 100), "%"];
  case "pe_amt": case "mod_dpth": return [(x > 0 ? "+" : "") + Math.round(x * 100), "%"];
  case "tune": return [(x > 0 ? "+" : "") + x.toFixed(Math.abs(x - Math.round(x)) < 0.05 ? 0 : 1), "ST"];
  case "f1_res": return [x.toFixed(1), "Q"];
  case "lfo_r": return [x < 10 ? x.toFixed(2) : x.toFixed(1), "HZ"];
  case "pan": return Math.abs(x) < 0.01 ? ["C", ""] : [(x < 0 ? "L" : "R") + Math.round(Math.abs(x) * 100), ""];
  case "all_decay": return [Math.round(x * 100), "%"];
  case "master_tune": return [(x > 0 ? "+" : "") + Math.round(x), "CT"];
  case "eq_lo": case "eq_mid": case "eq_hi": return [(x > 0 ? "+" : "") + x.toFixed(1), "DB"];
  case "lo_freq": case "mid_freq": case "hi_freq": case "dly_bpf_cut": return x >= 1000 ? [(x / 1000).toFixed(1), "KHZ"] : [String(Math.round(x)), "HZ"];
  case "cho_rate": return [x.toFixed(2), "HZ"];
  }
  if (/^(lvl|level|fx1|fx2|pwm|fbk|f1_drv|f1_cut|f2_cut|e1_rep|lfo_d|morph|all_\w+|rev_\w+|dly_mix|dly_fdbk|dly_tone|dly_bpf_w|cho_mix|cho_depth|cho_width|cho_tone|cho_fb|comp|drive|bit|rate|master)$/.test(p))
    return [String(Math.round(x * 100)), "%"];
  return null;
}
push.display(function (k, raw) { var r = fmt(k, raw); return r ? { value: r[0], unit: r[1] } : undefined; });
function val(v, k) { if (!known(v, k)) return ["--", ""]; return fmt(k, v[k].value) || [String(v[k].display || v[k].value), String(v[k].unit || "")]; }

// ---- what plays: notes 36..51 are the sixteen pads; a pad plays voice (pad mod 8) ----------
function strikes(v) {
  var out = [], L = v.$live, i;
  for (i = 0; i < 16; i++) out.push(-1);
  if (!L || !L.known || !L.voices) return out;
  for (i = 0; i < L.voices.length; i++) {
    var n = L.voices[i], p = n.note - 36;
    if (p >= 0 && p < 16 && (out[p] < 0 || n.age < out[p])) out[p] = n.age;
  }
  return out;
}
function voiceHit(h, i) { var a = h[i], b = h[i + 8]; return a < 0 ? b : (b < 0 ? a : Math.min(a, b)); }
function hot(age) { return age >= 0 && age < 0.15; }

// ---- the encoder row: iron knobs, each ring in its voice's heat -----------------------------
var NAMES = { morph: "MORPH", morph_curve: "CURVE", morph_src: "MORPHED BY", kit: "KIT", all_decay: "ALL DECAY", master: "MASTER",
  rnd_kit: "RND KIT", rnd_voice: "RND VOICE", all_punch: "PUNCH", all_bright: "BRIGHT", all_drive: "DRIVE", all_snap: "SNAP",
  all_bend: "BEND", all_tune: "TUNE", all_fx: "FX" };
var PNAMES = { lvl: "LEVEL", pan: "PAN", fx1: "DELAY", fx2: "REVERB", e1_atk: "ATTACK", e1_dec: "DECAY", e1_crv: "CURVE", e1_rep: "REPEAT",
  e2_dec: "ENV 2 DEC", e2_crv: "ENV 2 CRV", pe_amt: "PITCH ENV", pe_dec: "P. DECAY", tune: "TUNE", f1_cut: "CUTOFF", f1_res: "RESO",
  f1_drv: "DRIVE", f2_cut: "CUTOFF 2", fbk: "FM FEEDBK", pwm: "PWM", level: "OSC LVL", lfo_r: "LFO RATE", lfo_d: "LFO DEPTH", mod_dpth: "MOD DEPTH" };
function knobName(v, k) {
  var m = /^p?v(\d)_(.*)$/.exec(k);
  if (m && PNAMES[m[2]]) return m[1] + " " + PNAMES[m[2]];
  return NAMES[k] || upper(v[k].name);
}
function voiceColor(v, i, mt) { return heat(STEEL, MOLTEN, mt.t); }
function encoderRow(g, v, mt) {
  var kn = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = kn[i], x0 = i * 120;
    if (!k || !v[k]) continue;
    var h = k === t, perVoice = /^p?v\d_/.test(k), c = h ? "slot" : (perVoice ? voiceColor(v, i, mt) : EMBER), kx = x0 + 24, seg = !!v.$segmode, ky = seg ? 128 : 139; // in segment mode the row draws above y 142
    g.text(x0 + 60, seg ? 114 : 120, knobName(v, k), h ? "slot" : ASH, 0, 112);
    g.dot(kx, ky, 13, "#2b2622"); g.dot(kx, ky, 10.5, IRON);
    if (known(v, k)) {
      var f = v[k].frac, bip = /_pan$|pe_amt|mod_dpth|_crv$|^master_tune$/.test(k);
      if (bip) { var s = Math.min(f, 0.5), e = Math.max(f, 0.5); g.arc(kx, ky, 12, A0 + s * SWEEP, Math.max(0.04, (e - s) * SWEEP), 3, c); }
      else if (f > 0.004) g.arc(kx, ky, 12, A0, f * SWEEP, 3, c);
      var a = A0 + f * SWEEP;
      g.line(kx + Math.cos(a) * 3, ky + Math.sin(a) * 3, kx + Math.cos(a) * 9, ky + Math.sin(a) * 9, 2.5, h ? "slot" : WHITEHOT);
    }
    var vt = val(v, k), unit = vt[1], uw = unit ? g.measure(unit) + 3 : 0, room = 74 - uw, vw = Math.min(g.measure(vt[0], "value"), room), cx = x0 + 82;
    g.value(cx - (vw + uw) / 2, seg ? 139 : 147, vt[0], h ? "slot" : WHITEHOT, -1, room);
    if (unit) g.text(cx - (vw + uw) / 2 + vw + 3, seg ? 139 : 147, unit, ASH2, -1);
  }
}

// ---- PANEL ------------------------------------------------------------------------------------
var MX0 = 46, MX1 = 914, MY = 33;
function panel(g, v) {
  var kn = v.$knobs || [], t = v.$touched || "", hits = strikes(v), mt = morphT(v);
  g.layer("forge|" + (v.$segmode || ""), function () {
    g.fill(0, 0, 960, 160, IRON);
    g.fill(0, 103, 960, 1, RULE);
    for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, v.$segmode ? 30 : 42, IRON3);
    g.value(10, 16, "FORGE", hex(MOLTEN), -1);
    // the morph's scale, from Kit A to Kit B: twenty-four steps of heat
    for (var s = 0; s < 24; s++) g.fill(MX0 + s * (MX1 - MX0) / 24, MY - 1, (MX1 - MX0) / 24 - 1, 3, heat(STEEL_DK, MOLTEN_DK, s / 23));
    g.value(14, MY + 6, "A", hex(STEEL), -1);
    g.value(946, MY + 6, "B", hex(MOLTEN), 1);
  });
  // the kit, and what moves the morph
  var kit = Math.round(num(v, "kit", 0));
  g.value(84, 16, (kit + 1) + "  " + kitName(kit), t === "kit" ? "slot" : WHITEHOT, -1, 330);
  var src = disp(v, "morph_src") || "Knob";
  var ps = v.$pages || [], pl = ps.length > 1 ? upper(ps[v.$page] || "") + "  " + ((v.$page || 0) + 1) + "/" + ps.length : "";
  g.text(950, 14, pl, ASH2, 1);
  g.text(950 - g.measure(pl) - 18, 14, "MORPH " + Math.round(mt.m * 100) + "%  " + upper(CURVES[mt.c]) + "  BY " + upper(src),
    t === "morph" || t === "morph_curve" || t === "morph_src" ? "slot" : ASH, 1);
  // the morph: how far A has gone toward B (the curve applied), and the knob itself
  var mx = MX0 + (MX1 - MX0) * mt.t, kx = MX0 + (MX1 - MX0) * mt.m, mc = heat(STEEL, MOLTEN, mt.t);
  g.fill(MX0, MY - 1, Math.max(0, mx - MX0), 3, mc);
  if (Math.abs(kx - mx) > 2) g.fill(kx - 1, MY - 7, 2, 15, ASH2);
  g.fill(mx - 4, MY - 8, 9, 17, t === "morph" ? "slot" : mc);
  g.fill(mx - 1, MY - 5, 3, 11, WHITEHOT);
  // the pads, as the Move lays them out: B above, A morphing toward B below
  var page = kn[0] ? (/^v1_(lvl|pan)$/.exec(kn[0]) || [])[1] : "";
  for (var i = 0; i < 8; i++) {
    var x = i * 120 + 6, w = 108, hb = hot(hits[i + 8]), ha = hot(hits[i]);
    g.fill(x, 46, w, 24, hb ? WHITEHOT : hex(MOLTEN_DK));
    g.fill(x, 46, w, 2, hex(MOLTEN));
    g.text(x + 6, 62, String(i + 9), hb ? IRON : hex(MOLTEN), -1);
    g.text(x + w - 6, 62, "B" + (i + 1), hb ? IRON : ASH2, 1);
    g.fill(x, 74, w, 26, ha ? WHITEHOT : heat(STEEL_DK, MOLTEN_DK, mt.t));
    g.fill(x, 74, w, 2, mc);
    g.text(x + 6, 90, String(i + 1), ha ? IRON : mc, -1);
    // the voice's level and pan, on its pad
    var lk = "v" + (i + 1) + "_lvl", pk = "v" + (i + 1) + "_pan", lv = frac(v, lk, 0.85), pn = num(v, pk, 0);
    var bx = x + 22, bw = w - 30, lit = page === "lvl" || page === "pan";
    g.fill(bx, 85, bw, 3, ha ? IRON3 : IRON);
    g.fill(bx, 85, Math.round(bw * lv), 3, t === lk ? "slot" : (ha ? IRON : (page === "lvl" ? WHITEHOT : ASH)));
    g.fill(bx + Math.round((bw - 2) * (pn + 1) / 2), 81, 2, 11, t === pk ? "slot" : (ha ? IRON : (page === "pan" ? WHITEHOT : ASH2)));
  }
  encoderRow(g, v, mt);
}
// segments: the morph and what it does between the kits, and the pads two voices at a time
// (each voice's tune, decay, cutoff and level, Kit A's own keys). Pung's bar marks the active one.
var SEGS = [{ id: "morph", label: "Morph", rect: [4, 21, 952, 24], keys: ["morph", "morph_curve", "morph_src", "all_decay", "copy_a_b", "copy_b_a", "swap_ab", "rnd_b_from_a"] }];
for (var sq = 0; sq < 4; sq++) {
  var ka = [], vv;
  for (vv = sq * 2 + 1; vv <= sq * 2 + 2; vv++) ka.push("pv" + vv + "_tune", "pv" + vv + "_e1_dec", "pv" + vv + "_f1_cut", "v" + vv + "_lvl");
  SEGS.push({ id: "pads" + (sq * 2 + 1), label: "Pads " + (sq * 2 + 1) + "-" + (sq * 2 + 2), rect: [sq * 240 + 6, 46, 228, 54], keys: ka });
}
function across(p) { var out = []; for (var i = 1; i <= 8; i++) out.push(p.replace("#", i)); return out; }
var PEX = ["kit", "morph", "morph_curve", "morph_src"].concat(across("v#_lvl"), across("v#_pan"));
// Pung's default pages in the smithy's iron, its knobs' steel arcs
push.theme({ ground: IRON, panel: IRON2, ink: WHITEHOT, dim: ASH, rule: RULE, faint: IRON3, accent: "#8fb3c9", knob: "pointer" });
push.compartment({
  id: "panel", label: "Panel", front_panel: true,
  pages: [
    { label: "Levels", keys: across("v#_lvl") },
    { label: "Pans", keys: across("v#_pan") },
    { label: "Perf", keys: ["all_punch", "all_bright", "all_decay", "all_drive", "all_snap", "all_bend", "all_tune", "all_fx"] },
    { label: "Morph", keys: ["morph", "morph_curve", "morph_src", "kit", "master", "rnd_kit", "rnd_voice", "rnd_kit_params"] }
  ],
  segments: SEGS,
  extra_keys: PEX,
  screen: panel
});

// ---- the band screens: eight columns, a voice under each encoder ---------------------------------
function columns(g, v, title) {
  var mt = morphT(v), hits = strikes(v), c = heat(STEEL, MOLTEN, mt.t);
  g.fill(0, 0, 3, g.h, c);
  for (var i = 0; i < 8; i++) {
    var x = i * 119;
    if (i) g.fill(x, 4, 1, 78, IRON3);
    var hh = hot(voiceHit(hits, i));
    g.text(x + 8, 10, String(i + 1), hh ? WHITEHOT : c, -1);
    if (hh) g.dot(x + 112, 6, 3, WHITEHOT);
  }
  return { mt: mt, c: c };
}
function hotKey(t, i, keys) { for (var j = 0; j < keys.length; j++) if (t === "pv" + (i + 1) + "_" + keys[j]) return true; return false; }

// ENVELOPES: the eight amp envelopes, each under its encoder
push.compartment({
  id: "env", label: "Envelopes",
  pages: [
    { label: "Attack", keys: across("pv#_e1_atk") },
    { label: "Decay", keys: across("pv#_e1_dec") },
    { label: "Curve", keys: across("pv#_e1_crv") },
    { label: "Repeat", keys: across("pv#_e1_rep") },
    { label: "Env 2 Decay", keys: across("pv#_e2_dec") },
    { label: "Env 2 Curve", keys: across("pv#_e2_crv") }
  ],
  extra_keys: ["morph", "morph_curve"],
  screen: function (g, v) {
    var C = columns(g, v), t = v.$touched || "", pg = v.$page || 0;
    for (var i = 0; i < 8; i++) {
      var x = i * 119, p = "pv" + (i + 1) + "_", two = pg >= 4;
      // env 1 is the amp; env 2 (decay and curve only) moves what its voice routes it to
      if (two) g.envelope(x + 4, 12, 112, 56, { attack: 0, decay: p + "e2_dec", color: C.c, still: true });
      else g.envelope(x + 4, 12, 112, 56, { attack: p + "e1_atk", decay: p + "e1_dec", color: C.c, still: true });
      g.text(x + 112, 10, two ? "ENV 2" : "AMP", "faint", 1);
      var cv = val(v, p + (two ? "e2_crv" : "e1_crv")), rp = num(v, p + "e1_rep", 0);
      g.text(x + 8, 80, cv[0] + (cv[1] === "%" ? "%" : ""), hotKey(t, i, ["e1_crv", "e2_crv"]) ? "slot" : (pg === 2 || pg === 5 ? "fg" : "dim"), -1);
      if (!two) g.text(x + 112, 80, rp > 0.005 ? "REPEAT " + Math.round(rp * 100) + "%" : "ONE HIT", hotKey(t, i, ["e1_rep"]) ? "slot" : (rp > 0.005 ? EMBER : (pg === 3 ? "dim" : "faint")), 1);
    }
  }
});

// PITCH: each voice's pitch envelope, as deep as its amount; its tune
push.compartment({
  id: "pitch", label: "Pitch",
  pages: [
    { label: "Tune", keys: across("pv#_tune") },
    { label: "Pitch Env", keys: across("pv#_pe_amt") },
    { label: "Pitch Decay", keys: across("pv#_pe_dec") }
  ],
  extra_keys: ["morph", "morph_curve"],
  screen: function (g, v) {
    var C = columns(g, v), t = v.$touched || "";
    for (var i = 0; i < 8; i++) {
      var x = i * 119, p = "pv" + (i + 1) + "_", amt = num(v, p + "pe_amt", 0), h = Math.round(16 + 42 * Math.min(1, Math.abs(amt)));
      if (Math.abs(amt) > 0.005) g.envelope(x + 4, 70 - h, 112, h, { attack: 0, decay: p + "pe_dec", color: C.c, still: true });
      else g.text(x + 60, 46, "NO PITCH ENV", "faint", 0);
      var pe = val(v, p + "pe_amt"), tu = val(v, p + "tune");
      g.text(x + 112, 10, amt < -0.005 ? "RISES" : (amt > 0.005 ? "FALLS " + pe[0] + "%" : ""), hotKey(t, i, ["pe_amt", "pe_dec"]) ? "slot" : "dim", 1);
      g.text(x + 8, 80, "TUNE " + tu[0] + " " + tu[1], hotKey(t, i, ["tune"]) ? "slot" : "dim", -1);
    }
  }
});

// FILTER: two cutoffs on one scale, the resonance, the drive
push.compartment({
  id: "filter", label: "Filter",
  pages: [
    { label: "Cutoff", keys: across("pv#_f1_cut") },
    { label: "Reso", keys: across("pv#_f1_res") },
    { label: "Drive", keys: across("pv#_f1_drv") },
    { label: "Cutoff 2", keys: across("pv#_f2_cut") }
  ],
  extra_keys: ["morph", "morph_curve"],
  screen: function (g, v) {
    var C = columns(g, v), t = v.$touched || "";
    for (var i = 0; i < 8; i++) {
      var x = i * 119, p = "pv" + (i + 1) + "_", y0 = 18, y1 = 74, H = y1 - y0;
      // the scale: the module's cutoff knob is exponential, its position the frequency's
      for (var d = 0; d <= 4; d++) g.fill(x + 30, y0 + H * d / 4, 60, 1, IRON3);
      var c1 = frac(v, p + "f1_cut", 0.8), c2 = frac(v, p + "f2_cut", 0.8), q = num(v, p + "f1_res", 0.7), dr = num(v, p + "f1_drv", 0);
      var ya = y1 - H * c1, yb = y1 - H * c2, h1 = hotKey(t, i, ["f1_cut", "f1_res"]), h2 = hotKey(t, i, ["f2_cut"]);
      g.fill(x + 34, ya, 24, y1 - ya, heat(STEEL_DK, MOLTEN_DK, C.mt.t));
      g.fill(x + 34, ya - 1, 24, 2, h1 ? "slot" : C.c);
      var qh = Math.min(14, (q - 0.5) * 1.2);
      if (qh > 1) g.fill(x + 44, ya - 1 - qh, 4, qh, h1 ? "slot" : EMBER);
      g.fill(x + 62, yb, 24, y1 - yb, IRON3);
      g.fill(x + 62, yb - 1, 24, 2, h2 ? "slot" : ASH);
      g.text(x + 46, 82, "F1", "faint", 0); g.text(x + 74, 82, "F2", "faint", 0);
      g.text(x + 112, 10, "Q " + q.toFixed(1), hotKey(t, i, ["f1_res"]) ? "slot" : (q > 2 ? EMBER : "dim"), 1);
      if (dr > 0.005) g.text(x + 112, 82, "DRV " + Math.round(dr * 100), hotKey(t, i, ["f1_drv"]) ? "slot" : EMBER, 1);
    }
  }
});

// TONE and MOD: the default view
push.compartment({
  id: "tone", label: "Tone",
  pages: [
    { label: "FM Feedback", keys: across("pv#_fbk") },
    { label: "PWM", keys: across("pv#_pwm") },
    { label: "Osc Level", keys: across("pv#_level") }
  ]
});
push.compartment({
  id: "mod", label: "Mod",
  pages: [
    { label: "LFO Rate", keys: across("pv#_lfo_r") },
    { label: "LFO Depth", keys: across("pv#_lfo_d") },
    { label: "Mod Depth", keys: across("pv#_mod_dpth") }
  ]
});

// FX: the sends under their encoders, the echoes, the reverb, the chorus
push.compartment({
  id: "fx", label: "FX",
  pages: [
    { label: "Dly Sends", keys: across("v#_fx1") },
    { label: "Rev Sends", keys: across("v#_fx2") },
    { label: "Delay", keys: ["dly_mix", "dly_rate", "dly_fdbk", "dly_tone", "dly_bpf_cut", "dly_bpf_w", "dly_pp", "dly_sync"] },
    { label: "Reverb", keys: ["rev_mix", "rev_decay", "rev_size", "rev_type", "rev_gate", "rev_predelay", "rev_damping"] },
    { label: "Chorus", keys: ["cho_mix", "cho_rate", "cho_depth", "cho_width", "cho_voices", "cho_tone", "cho_fb"] }
  ],
  extra_keys: ["morph", "morph_curve"],
  screen: function (g, v) {
    var C = columns(g, v), t = v.$touched || "";
    for (var i = 0; i < 8; i++) {
      var cx = i * 119 + 60, d = frac(v, "v" + (i + 1) + "_fx1", 0), r = frac(v, "v" + (i + 1) + "_fx2", 0);
      var dh = t === "v" + (i + 1) + "_fx1", rh = t === "v" + (i + 1) + "_fx2";
      g.dot(cx - 20, 28, 1.5, RULE); g.dot(cx + 20, 28, 1.5, RULE);
      if (d > 0.004) g.dot(cx - 20, 28, 2 + d * 10, dh ? "slot" : C.c); else if (dh) g.arc(cx - 20, 28, 6, 0, 6.3, 1.5, "slot");
      if (r > 0.004) g.dot(cx + 20, 28, 2 + r * 10, rh ? "slot" : EMBER); else if (rh) g.arc(cx + 20, 28, 6, 0, 6.3, 1.5, "slot");
      g.text(cx - 20, 48, "DLY", dh ? "slot" : "faint", 0); g.text(cx + 20, 48, "REV", rh ? "slot" : "faint", 0);
    }
    // the delay's echoes; the reverb (its gate cuts the tail); the chorus
    var mix = num(v, "dly_mix", 0), fb = num(v, "dly_fdbk", 0.3), sy = disp(v, "dly_sync") || "Free";
    var L = v.$live || {}, bpm = L.known && L.bpm ? L.bpm : 120;
    var DV = { "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/32": 0.125 };
    var sec = DV[sy] ? DV[sy] * 60 / bpm : 0.01 * Math.pow(100, num(v, "dly_rate", 0.3));
    var ex = 10, ew = 400, ey = 56, eh = 26, span = Math.max(0.2, Math.min(3, sec * 7)), dhot = /^dly_/.test(t);
    g.fill(ex, ey + eh, ew, 1, RULE); g.fill(ex, ey + 2, 2, eh - 2, ASH2);
    var a = mix, x = sec, n = 0;
    while (mix > 0 && x <= span && n < 40 && a > 0.015) {
      var hh = Math.max(2, (eh - 2) * a);
      g.fill(ex + ew * x / span - 1, ey + eh - hh, 3, hh, dhot ? "slot" : C.c);
      a *= fb; x += sec; n++;
    }
    g.text(ex + 8, ey + 8, mix > 0 ? "DELAY " + (DV[sy] ? sy : Math.round(sec * 1000) + " MS") + (/on/i.test(disp(v, "dly_pp")) ? ", PING-PONG" : "") : "DELAY OFF", mix > 0 ? (dhot ? "fg" : "dim") : "faint", -1);
    var rx = 440, rm = num(v, "rev_mix", 0), gate = num(v, "rev_gate", 0), rhot = /^rev_/.test(t);
    g.text(rx, 66, "REVERB " + upper(disp(v, "rev_type") || "--") + (rm > 0 ? " " + Math.round(rm * 100) + "%" : " OFF") + (gate > 0.005 ? ", GATED" : ""), rhot ? "fg" : (rm > 0 ? "dim" : "faint"), -1);
    var cm = num(v, "cho_mix", 0);
    g.text(rx, 80, cm > 0 ? "CHORUS " + Math.round(cm * 100) + "%, " + disp(v, "cho_voices") + " VOICES" : "CHORUS OFF", /^cho_/.test(t) ? "fg" : (cm > 0 ? "dim" : "faint"), -1);
  }
});

// MASTER, EQ and KIT: the default view
push.compartment({
  id: "master", label: "Master",
  pages: [
    { label: "Master", keys: ["comp", "drive", "drive_type", "bit", "rate", "limiter", "master", "master_tune"] },
    { label: "EQ", keys: ["eq_lo", "lo_freq", "q_lo", "eq_mid", "mid_freq", "q_mid", "eq_hi", "hi_freq"] },
    { label: "EQ +", keys: ["q_hi", "midi_ch"] }
  ]
});
push.compartment({
  id: "kit", label: "Kit",
  pages: [
    { label: "Kit", keys: ["kit", "save_kit", "rnd_kit", "rnd_kit_params", "rnd_voice", "rnd_pitch", "rnd_pan", "all_mono"] },
    { label: "Morph & Copy", keys: ["morph_src", "morph_curve", "copy_a_b", "copy_b_a", "swap_ab", "rnd_b_from_a", "init_decay", "init_freq"] },
    { label: "Same Freq", keys: ["same_freq"] }
  ]
});
