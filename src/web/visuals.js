// visuals.js: the pictures Pung draws for structures it recognizes in any
// module's parameters, the web half of src/visuals.go. The detection rules
// and the geometry are the SAME as there, constant for constant, so the page
// and the Push show one picture (docs/UX-GUIDELINES.md). Change one, change
// both.
//
// The page adds what the Push cannot: the handles can be dragged.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const ROLE = /^(.*?)_?(attack|decay|hold|sustain|release)(?:_(time|level|rate))?$/;
  const LETTER = { attack: "A", hold: "H", decay: "D", sustain: "S", slope: "S", release: "R" };

  // envelopeGroups: as visuals.go. keys -> [{prefix, keys:{role:key}, start, end}]
  function envelopeGroups(keys) {
    const by = new Map();
    keys.forEach((k, col) => {
      const m = ROLE.exec(String(k).toLowerCase());
      if (!m) return;
      let role = m[2];
      if (role === "sustain" && m[3] === "time") role = "slope";
      const p = m[1].replace(/_$/, "");
      if (!by.has(p)) by.set(p, []);
      by.get(p).push({ role, col });
    });
    const out = [];
    by.forEach((hits, prefix) => {
      const g = { prefix, keys: {}, start: 99, end: -1 };
      hits.forEach((h) => {
        if (g.keys[h.role]) return;
        g.keys[h.role] = keys[h.col];
        g.start = Math.min(g.start, h.col);
        g.end = Math.max(g.end, h.col + 1);
      });
      const n = Object.keys(g.keys).length;
      const a = !!g.keys.attack, d = !!g.keys.decay, r = !!g.keys.release;
      // attack+release alone is a compressor's timing, not an envelope
      if (!a || (!d && !(r && n >= 3)) || g.end - g.start !== n) return;
      out.push(g);
    });
    return out;
  }

  // layout: as drawEnvelope in visuals.go. Times in proportion to their
  // knobs, never to scale: the shape is what the hand turns.
  function layout(e, x0, x1, top, base) {
    const span = x1 - x0;
    const seg = (f) => span * (0.05 + 0.25 * f);
    let wa = seg(e.A), wd = e.HasD ? seg(e.D) : 0, wh = e.HasH ? seg(e.H) * 0.6 : 0, wr = e.HasR ? seg(e.R) : 0;
    let ws = e.HasS ? Math.max(span * 0.16, span - wa - wd - wh - wr) : 0;
    // without a sustain, the width is what the stages take at their longest
    let k = 1;
    const used = wa + wd + wh + ws + wr;
    if (!e.HasS) k = span / (seg(1) * (1 + (e.HasD ? 1 : 0) + (e.HasR ? 1 : 0) + (e.HasH ? 0.6 : 0)));
    else if (used > span) k = span / used;
    wa *= k; wd *= k; wh *= k; ws *= k; wr *= k;
    const lvl = (f) => base - f * (base - top);
    const sus = e.HasS ? e.S : 0;
    const endSus = e.HasSlope ? Math.max(0, Math.min(1, sus + (e.Slope - 0.5) * 1.6)) : sus;
    const pts = [{ x: x0, y: base, role: "" }];
    let x = x0 + wa;
    pts.push({ x, y: top, role: "attack" });
    if (e.HasH) { x += wh; pts.push({ x, y: top, role: "hold" }); }
    if (e.HasD) { x += wd; pts.push({ x, y: e.HasS ? lvl(sus) : base, role: "decay" }); }
    if (e.HasS) { x += ws; pts.push({ x, y: lvl(endSus), role: e.HasSlope ? "slope" : "sustain" }); }
    if (e.HasR) { x += wr; pts.push({ x, y: base, role: "release" }); }
    return { pts, k, span, sus, lvl };
  }

  // one figure: an envelope group drawn from live values, redrawn on change
  const figures = new Set();

  // envFigure(g, io): io = {meta(key) -> param, value(key) -> raw, set(key, raw), label(key) -> text}
  function envFigure(g, io) {
    const W = 480, H = 110, x0 = 10, x1 = W - 10, top = 12, base = H - 26;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "env");
    svg.setAttribute("role", "img");
    let hot = "", drag = null;

    const frac = (key) => {
      const p = io.meta(key), v = parseFloat(io.value(key));
      if (!p || isNaN(v)) return null;
      const lo = p.min ?? 0, hi = p.max ?? 1;
      return hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0;
    };
    const shape = () => {
      const e = { Known: true };
      const get = (role) => {
        const k = g.keys[role];
        if (!k) return [0, false];
        const f = frac(k);
        if (f === null) e.Known = false;
        return [f || 0, true];
      };
      [e.A] = get("attack");
      [e.D, e.HasD] = get("decay");
      [e.H, e.HasH] = get("hold");
      [e.S, e.HasS] = get("sustain");
      [e.Slope, e.HasSlope] = get("slope");
      [e.R, e.HasR] = get("release");
      if (!e.Known) return { A: 0.25, D: 0.35, S: 0.6, R: 0.35, HasD: true, HasS: true, HasR: true, Known: false };
      return e;
    };
    const isHot = (role) => hot && (hot === role || (role === "slope" && hot === "sustain"));

    function draw() {
      const e = shape(), L = layout(e, x0, x1, top, base), pts = L.pts;
      svg.classList.toggle("unknown", !e.Known);
      let h = "";
      const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      h += `<polygon class="fill" points="${poly} ${pts[pts.length - 1].x},${base}"/>`;
      h += `<line class="base" x1="${x0}" y1="${base}" x2="${x1}" y2="${base}"/>`;
      if (e.HasS && e.HasD) {
        const sy = L.lvl(L.sus).toFixed(1);
        h += `<line class="guide" x1="${x0}" y1="${sy}" x2="${pts[pts.length - 2].x.toFixed(1)}" y2="${sy}"/>`;
      }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        h += `<line class="seg${isHot(b.role) ? " hot" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
        h += `<text class="letter${isHot(b.role) ? " hot" : ""}" x="${(a.x + b.x) / 2}" y="${base + 18}">${LETTER[b.role]}</text>`;
      }
      // the handles: every stage's end except the last at the baseline
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (i === pts.length - 1 && p.role !== "release") continue;
        const big = isHot(p.role) || (p.role === "decay" && hot === "sustain");
        const y = p.role === "release" ? base : p.y;
        h += `<circle class="handle${big ? " hot" : ""}" data-role="${p.role}" cx="${p.x}" cy="${y}" r="${big ? 6 : 4.5}"/>`;
        h += `<circle class="grab" data-role="${p.role}" cx="${p.x}" cy="${y}" r="14"/>`;
      }
      svg.innerHTML = h;
      svg.setAttribute("aria-label", "Envelope: " + Object.entries(g.keys).map(([, k]) => io.label(k)).join(", "));
      return L;
    }

    // dragging: a handle moves the knobs that place it
    const toLocal = (ev) => {
      const r = svg.getBoundingClientRect();
      return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
    };
    const setFrac = (role, f) => {
      const key = g.keys[role], p = key && io.meta(key);
      if (!p) return;
      f = Math.max(0, Math.min(1, f));
      const lo = p.min ?? 0, hi = p.max ?? 1;
      let v = lo + f * (hi - lo);
      v = p.type === "int" ? Math.round(v) : +v.toFixed(4);
      if (String(v) !== String(io.value(key))) io.set(key, String(v));
    };
    svg.addEventListener("pointerdown", (ev) => {
      const role = ev.target.dataset && ev.target.dataset.role;
      if (!role) return;
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      const L = layout(shape(), x0, x1, top, base);
      const i = L.pts.findIndex((p) => p.role === role);
      drag = { role, from: L.pts[i - 1].x, k: L.k, span: L.span };
      hot = role === "slope" ? "sustain" : role;
      draw();
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const q = toLocal(ev), d = drag, w = (q.x - d.from) / (d.span * d.k);
      const level = (base - q.y) / (base - top);
      const e = shape();
      switch (d.role) {
        case "attack": setFrac("attack", (w - 0.05) / 0.25); break;
        case "hold": setFrac("hold", (w / 0.6 - 0.05) / 0.25); break;
        case "decay": setFrac("decay", (w - 0.05) / 0.25); if (e.HasS) setFrac("sustain", level); break;
        case "sustain": setFrac("sustain", level); break;
        case "slope": setFrac("slope", (level - e.S) / 1.6 + 0.5); break;
        case "release": setFrac("release", (w - 0.05) / 0.25); break;
      }
      draw();
    });
    const end = () => { drag = null; hot = ""; draw(); };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    const fig = {
      el: svg,
      draw,
      touch(key) { // a control of this group is under the hand
        const role = Object.keys(g.keys).find((r) => g.keys[r] === key) || "";
        if (!drag && role !== hot) { hot = role; draw(); }
      },
      alive() { return svg.isConnected; },
    };
    figures.add(fig);
    draw();
    return fig;
  }

  // ---- filters, LFOs, mixes: as visuals_shapes.go, constant for constant ----

  const FLT_CUTOFF = /^(.*?)_?(cutoff|cutofffrequency|cutoff_freq|cutoff_frequency)$/;
  const FLT_FREQ = /^(.*?)_?(freq|frequency)$/;
  const FLT_RES = /^(.*?)_?f?(resonance|reso|res|q|emphasis)$/;
  const FLT_TYPE = /^(.*?)_?(f|filter_?|flt_?|filt_?|vcf_?)?(type|mode)$/;
  const FLT_WORD = /_?(filter|filt|flt|vcf|lpf|hpf)(\d*)$/;
  const fltCanon = (p) => {
    const m = FLT_WORD.exec(p);
    return m ? [p.slice(0, m.index) + m[2], true] : [p, false];
  };

  function filterGroups(keys) {
    const by = new Map();
    const get = (p) => { if (!by.has(p)) by.set(p, { cut: -1, res: -1, typ: -1 }); return by.get(p); };
    keys.forEach((key, col) => {
      const k = String(key).toLowerCase();
      let m;
      if ((m = FLT_CUTOFF.exec(k))) { const q = get(fltCanon(m[1])[0]); if (q.cut < 0) q.cut = col; return; }
      if ((m = FLT_FREQ.exec(k))) { const [p, named] = fltCanon(m[1]); if (named) { const q = get(p); if (q.cut < 0) q.cut = col; } return; }
      if ((m = FLT_RES.exec(k))) { const q = get(fltCanon(m[1])[0]); if (q.res < 0) q.res = col; return; }
      if ((m = FLT_TYPE.exec(k))) { const [p, named] = fltCanon(m[1]); if (m[2] || named) { const q = get(p); if (q.typ < 0) q.typ = col; } }
    });
    const out = [];
    by.forEach((q, p) => {
      if (q.cut < 0 || p.includes("macro")) return;
      const g = { kind: "filter", keys: { cutoff: keys[q.cut] }, start: q.cut, end: q.cut + 1 };
      const near = (c) => c >= 0 && (c === g.start - 1 || c === g.end);
      if (near(q.res)) { g.keys.resonance = keys[q.res]; g.start = Math.min(g.start, q.res); g.end = Math.max(g.end, q.res + 1); }
      if (q.typ >= 0) {
        g.keys.type = keys[q.typ];
        if (near(q.typ)) { g.start = Math.min(g.start, q.typ); g.end = Math.max(g.end, q.typ + 1); }
      }
      if (g.end - g.start >= 2) out.push(g);
    });
    return out;
  }

  function filterKind(name) {
    const s = String(name || "").trim().toLowerCase();
    let poles = 2, m;
    if ((m = /(\d+)\s*db/.exec(s))) poles = Math.floor(+m[1] / 6);
    else if ((m = /(?:lp|hp|bp)\s*(\d+)/.exec(s))) poles = Math.floor(+m[1] / 6);
    else if ((m = /(\d)\s*p(?:ole)?\b/.exec(s))) poles = +m[1];
    else if (s.includes("ladder")) poles = 4;
    poles = Math.max(1, Math.min(4, poles || 2));
    if (s === "off" || s.includes("bypass") || s === "thru") return ["off", poles];
    if (/notch|stop|reject|^br\b|^n\s?\d|\bn\s?\d+\s*db/.test(s)) return ["notch", 2];
    if (s.includes("hp+lp") || s.includes("lp+hp") || s.includes("band") || s.startsWith("bp") || s.includes(" bp") || s.includes("peak")) return ["bp", 2];
    if (s.includes("hp") || s.includes("high")) return ["hp", poles];
    if (s.includes("lp") || s.includes("low") || s.includes("ladder") || s.includes("analog")) return ["lp", poles];
    return ["?", poles];
  }

  const FLT_DECADES = 3, FLT_DB_TOP = 21, FLT_DB_BOT = -39;
  const filterQ = (f) => (f.HasRes ? 0.707 * Math.pow(10, f.Res * 1.15) : 0.707);
  function filterDB(f, u) {
    const w = Math.pow(10, FLT_DECADES * (u - f.Cutoff)), q = filterQ(f), w2 = w * w;
    const den = Math.sqrt((1 - w2) * (1 - w2) + (w / q) * (w / q)), one = Math.sqrt(1 + w2);
    let m = 1;
    if (f.Kind === "lp") m = f.Poles === 1 ? 1 / one : Math.pow(1 / one, f.Poles - 2) / den;
    else if (f.Kind === "hp") m = f.Poles === 1 ? w / one : (Math.pow(w / one, f.Poles - 2) * w2) / den;
    else if (f.Kind === "bp") m = w / q / den;
    else if (f.Kind === "notch") m = Math.abs(1 - w2) / den;
    return 20 * Math.log10(Math.max(m, 1e-6));
  }

  const LFO_SHAPE = /^(.*lfo.*?)_?(shape|wave|waveform|wav|form)$/;
  const LFO_RATE = /^(.*lfo.*?)_?(rate|speed|freq|frequency)$/;
  function lfoGroups(keys) {
    const shape = new Map(), rate = new Map();
    keys.forEach((key, col) => {
      const k = String(key).toLowerCase();
      let m;
      if ((m = LFO_SHAPE.exec(k))) { const p = m[1].replace(/_$/, ""); if (!shape.has(p)) shape.set(p, col); }
      else if ((m = LFO_RATE.exec(k))) { const p = m[1].replace(/_$/, ""); if (!rate.has(p)) rate.set(p, col); }
    });
    const out = [];
    shape.forEach((s, p) => {
      const r = rate.get(p);
      if (r === undefined || Math.abs(s - r) !== 1) return;
      out.push({ kind: "lfo", keys: { shape: keys[s], rate: keys[r] }, start: Math.min(s, r), end: Math.max(s, r) + 1 });
    });
    return out;
  }
  const WAVES = {
    sine: "sine", sin: "sine", sinus: "sine", triangle: "tri", tri: "tri",
    saw: "sawup", sawup: "sawup", sawtooth: "sawup", rampup: "sawup", ramp: "sawup", sawtoothup: "sawup",
    sawdown: "sawdown", rampdown: "sawdown", invsaw: "sawdown", sawtoothdown: "sawdown",
    square: "square", sqr: "square", squ: "square", rect: "square", pulse: "square",
    "s&h": "sh", "s+h": "sh", sh: "sh", sampleandhold: "sh", "sample&hold": "sh", random: "sh", rnd: "sh", rand: "sh",
    rnd1: "sh", // the JV-880's: stepped random, and smoothed
    "s&g": "smooth", smoothrandom: "smooth", smooth: "smooth", sng: "smooth", rnd2: "smooth", noise: "noise",
  };
  const lfoWave = (name) => WAVES[String(name || "").toLowerCase().replace(/[ _\-.]/g, "")] || "";
  const lfoCycles = (rate) => 1 + 4 * rate;
  // a fixed random step (not the Push's numbers, the same idea: still between frames)
  const lfoRand = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  function lfoValue(wave, ph) {
    const t = ph - Math.floor(ph);
    switch (wave) {
      case "sine": return Math.sin(2 * Math.PI * ph);
      case "tri": return t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4;
      case "sawup": return 2 * t - 1;
      case "sawdown": return 1 - 2 * t;
      case "square": return t < 0.5 ? 1 : -1;
      case "sh": return lfoRand(Math.floor(ph));
      case "smooth": { const i = Math.floor(ph), a = lfoRand(i), b = lfoRand(i + 1); return a + (b - a) * (1 - Math.cos(Math.PI * t)) / 2; }
      case "noise": return lfoRand(Math.floor(ph * 24));
    }
    return 0;
  }

  const MIX_SUFFIX = /^(.+)_(level|lvl|vol|volume|mix)$|^(.+\d)(level|lvl|vol|mix)$/;
  const MIX_PREFIX = /^(level|lvl|vol|mix)_(.+)$|^(level|lvl|vol|mix)(\d.*)$/;
  const MIX_NOT = /^(attack|decay|sustain|release|hold|env|eg|op\d|operator\d|vel|velocity|key|lfo|rev|reverb|dly|delay|cho|chorus|fx|send|master|main|out|output|input|in)$|env|_eg|^eg_/;
  function mixGroups(keys) {
    const parse = (key) => {
      const k = String(key).toLowerCase();
      let m;
      if ((m = MIX_PREFIX.exec(k))) { const src = (m[2] || "") + (m[4] || ""); if (!MIX_NOT.test(src)) return { form: "pre:" + (m[1] || "") + (m[3] || ""), src }; }
      if ((m = MIX_SUFFIX.exec(k))) { const src = (m[1] || "") + (m[3] || ""); if (!MIX_NOT.test(src)) return { form: "suf:" + (m[2] || "") + (m[4] || ""), src }; }
      return null;
    };
    const out = [];
    for (let i = 0; i < keys.length; ) {
      const a = parse(keys[i]);
      if (!a) { i++; continue; }
      let j = i + 1;
      const seen = new Set([a.src]);
      for (; j < keys.length; j++) {
        const b = parse(keys[j]);
        if (!b || b.form !== a.form || seen.has(b.src)) break;
        seen.add(b.src);
      }
      if (j - i >= 3) {
        const g = { kind: "mix", keys: {}, start: i, end: j };
        for (let c = i; c < j; c++) g.keys[String(c - i)] = keys[c];
        out.push(g);
      }
      i = j;
    }
    return out;
  }

  // pictureGroups: as visuals_shapes.go. Envelopes first, none overlapping, left to right.
  function pictureGroups(keys) {
    const out = [], taken = new Set();
    const add = (g) => {
      for (let c = g.start; c < g.end; c++) if (taken.has(c)) return;
      for (let c = g.start; c < g.end; c++) taken.add(c);
      out.push(g);
    };
    envelopeGroups(keys).forEach((g) => add({ kind: "env", keys: g.keys, start: g.start, end: g.end }));
    filterGroups(keys).forEach(add);
    lfoGroups(keys).forEach(add);
    mixGroups(keys).forEach(add);
    return out.sort((a, b) => a.start - b.start);
  }

  // one figure for a filter, an LFO or a mix; io as for envFigure, plus text(key) -> the value as shown
  function shapeFigure(g, io) {
    const W = 480, H = 110;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "env pic-" + g.kind);
    svg.setAttribute("role", "img");
    let hot = "", drag = null;
    const frac = (key) => {
      const p = io.meta(key), v = parseFloat(io.value(key));
      if (!p || isNaN(v)) return null;
      const lo = p.min ?? 0, hi = p.max ?? 1;
      return hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0;
    };
    const setFrac = (key, f) => {
      const p = key && io.meta(key);
      if (!p || p.type === "enum") return;
      f = Math.max(0, Math.min(1, f));
      const lo = p.min ?? 0, hi = p.max ?? 1;
      let v = lo + f * (hi - lo);
      v = p.type === "int" ? Math.round(v) : +v.toFixed(4);
      if (String(v) !== String(io.value(key))) io.set(key, String(v));
    };
    const roleOf = (key) => Object.keys(g.keys).find((r) => g.keys[r] === key) || "";
    const known = () => Object.values(g.keys).every((k) => io.value(k) !== undefined && io.value(k) !== null);
    const xy = (ev) => { const r = svg.getBoundingClientRect(); return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H }; };
    const pts = (arr) => arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    let geo = {};

    function drawFilter(k) {
      const x0 = 6, x1 = W - 6, top = 6, base = H - 6;
      let f = { Cutoff: 0.6, Res: 0.35, HasRes: true, Kind: "lp", Poles: 2 };
      let name = "";
      if (k) {
        f = { Cutoff: frac(g.keys.cutoff) || 0, Res: 0, HasRes: !!g.keys.resonance, Kind: "lp", Poles: 2 };
        if (g.keys.resonance) f.Res = frac(g.keys.resonance) || 0;
        if (g.keys.type) { name = io.text(g.keys.type); [f.Kind, f.Poles] = filterKind(name); }
      }
      const yOf = (db) => top + ((FLT_DB_TOP - Math.max(FLT_DB_BOT, Math.min(FLT_DB_TOP, db))) / (FLT_DB_TOP - FLT_DB_BOT)) * (base - top);
      let h = "";
      for (let d = 1; d < FLT_DECADES; d++) { const x = x0 + ((x1 - x0) * d) / FLT_DECADES; h += `<line class="grid" x1="${x}" y1="${top}" x2="${x}" y2="${base}"/>`; }
      h += `<line class="guide" x1="${x0}" y1="${yOf(0)}" x2="${x1}" y2="${yOf(0)}"/><line class="base" x1="${x0}" y1="${base}" x2="${x1}" y2="${base}"/>`;
      const xc = x0 + (x1 - x0) * f.Cutoff;
      geo = { x0, x1, top, base };
      if (f.Kind === "?" || f.Kind === "off") {
        if (f.Kind === "off") h += `<line class="seg" x1="${x0}" y1="${yOf(0)}" x2="${x1}" y2="${yOf(0)}"/>`;
        h += `<line class="guide" x1="${xc}" y1="${top}" x2="${xc}" y2="${base}"/>`;
        const t = f.Kind === "off" ? "OFF" : /^[\d.\- ]*$/.test(name) ? "" : name.toUpperCase();
        h += `<text class="letter" x="${W / 2}" y="${top + 14}">${esc(t)}</text>`;
        return h;
      }
      const curve = [];
      for (let x = x0; x <= x1; x += 2) curve.push([x, yOf(filterDB(f, (x - x0) / (x1 - x0)))]);
      h += `<polygon class="fill" points="${x0},${base} ${pts(curve)} ${curve[curve.length - 1][0]},${base}"/>`;
      h += `<polyline class="seg${hot === "resonance" || hot === "type" ? " hot" : ""}" fill="none" points="${pts(curve)}"/>`;
      const yc = yOf(filterDB(f, f.Cutoff));
      if (hot === "cutoff") h += `<line class="guide hot" x1="${xc}" y1="${yc + 6}" x2="${xc}" y2="${base}"/>`;
      h += `<circle class="handle${hot === "cutoff" ? " hot" : ""}" cx="${xc}" cy="${yc}" r="${hot === "cutoff" ? 6 : 4.5}"/>`;
      if (k) h += `<circle class="grab" data-role="cutoff" cx="${xc}" cy="${yc}" r="14"/>`;
      return h;
    }
    function drawLFO(k) {
      const x0 = 6, x1 = W - 6, top = 8, base = H - 8, mid = (top + base) / 2, amp = (base - top) / 2;
      let wave = "sine", rate = 0.25, name = "";
      if (k) { name = io.text(g.keys.shape); wave = lfoWave(name); rate = frac(g.keys.rate) || 0; }
      let h = `<line class="guide" x1="${x0}" y1="${mid}" x2="${x1}" y2="${mid}"/>`;
      if (!wave) return h + `<text class="letter" x="${W / 2}" y="${mid - 6}">${esc(name.toUpperCase())}</text>`;
      const n = lfoCycles(rate), curve = [];
      for (let x = x0; x <= x1; x += 1) curve.push([x, mid - lfoValue(wave, n * Math.min((x - x0) / (x1 - x0), 0.9999)) * amp]);
      h += `<polygon class="fill" points="${x0},${mid} ${pts(curve)} ${x1},${mid}"/>`;
      h += `<polyline class="seg${hot ? " hot" : ""}" fill="none" points="${pts(curve)}"/>`;
      return h;
    }
    function drawMix(k) {
      const n = g.end - g.start, levels = [];
      for (let i = 0; i < n; i++) levels.push(k ? frac(g.keys[String(i)]) || 0 : 0.5);
      const touched = hot === "" ? -1 : +hot;
      const sx = 6, sw = W - 12, cw = W / n, top = 26, base = H - 6;
      geo = { top, base, cw };
      let h = "";
      const sum = levels.reduce((a, b) => a + b, 0);
      if (sum <= 0) h += `<rect class="share none" x="${sx}" y="4" width="${sw}" height="8"/>`;
      else {
        let x = sx;
        levels.forEach((v, i) => {
          const w = (sw * v) / sum;
          if (w >= 1) h += `<rect class="share s${i % 2}${i === touched ? " hot" : ""}" x="${x.toFixed(1)}" y="4" width="${Math.max(1, w - 2).toFixed(1)}" height="8"/>`;
          x += w;
        });
      }
      levels.forEach((v, i) => {
        const cx = cw * (i + 0.5), y = base - v * (base - top), on = i === touched;
        h += `<rect class="track" x="${cx - 3}" y="${top}" width="6" height="${base - top}"/>`;
        if (v > 0) h += `<rect class="bar${on ? " hot" : ""}" x="${cx - 11}" y="${y}" width="22" height="${base - y}"/>`;
        h += `<rect class="cap${on ? " hot" : ""}" x="${cx - 15}" y="${y - 1}" width="30" height="3"/>`;
        if (k) h += `<rect class="grab" data-role="${i}" x="${cx - cw / 2 + 4}" y="${top - 8}" width="${cw - 8}" height="${base - top + 12}"/>`;
      });
      return h;
    }
    function draw() {
      const k = known();
      svg.classList.toggle("unknown", !k);
      svg.innerHTML = g.kind === "filter" ? drawFilter(k) : g.kind === "lfo" ? drawLFO(k) : drawMix(k);
      const what = { filter: "Filter", lfo: "LFO", mix: "Mix" }[g.kind];
      svg.setAttribute("aria-label", `${what}: ` + Object.values(g.keys).map((key) => io.label(key)).join(", "));
    }
    // dragging: the cutoff's handle sideways (and up and down for the
    // resonance), a fader up and down
    svg.addEventListener("pointerdown", (ev) => {
      const role = ev.target.dataset && ev.target.dataset.role;
      if (role === undefined) return;
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      drag = { role, from: xy(ev), res: g.keys.resonance ? frac(g.keys.resonance) || 0 : 0 };
      hot = role;
      draw();
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const q = xy(ev);
      if (g.kind === "filter") {
        setFrac(g.keys.cutoff, (q.x - geo.x0) / (geo.x1 - geo.x0));
        if (g.keys.resonance) setFrac(g.keys.resonance, drag.res + (drag.from.y - q.y) / 80);
      } else if (g.kind === "mix") {
        setFrac(g.keys[drag.role], (geo.base - q.y) / (geo.base - geo.top));
      }
      draw();
    });
    const end = () => { drag = null; hot = ""; draw(); };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    const fig = {
      el: svg,
      draw,
      touch(key) { const r = roleOf(key); if (!drag && r !== hot) { hot = r; draw(); } },
      alive() { return svg.isConnected; },
    };
    figures.add(fig);
    draw();
    return fig;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // figure: the picture for any recognized group
  function figure(g, io) { return !g.kind || g.kind === "env" ? envFigure(g, io) : shapeFigure(g, io); }

  function redrawAll() {
    figures.forEach((f) => (f.alive() ? f.draw() : figures.delete(f)));
  }

  window.PungVisuals = { envelopeGroups, pictureGroups, filterKind, filterDB, lfoWave, layout, figure, redrawAll };
})();
