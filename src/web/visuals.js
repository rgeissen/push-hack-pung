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
  // ---- envelopes: as envmodel.go, constant for constant ------------------------------
  //
  // An envelope is a start level and SEGMENTS: timed stages, at most one
  // PLATEAU (where a held key waits), then the RELEASE stages. A segment is
  // as wide as its time knob has travelled (a rate's reversed); a note's dot
  // crosses it in the stage's real time; the stage bar has one segment per
  // drawn segment, exactly as wide.

  const ENV_WORD = /^(.*?)_?(attack|atk|att|decay|dcy|dec|hold|hld|sustain|sus|release|rel|delay)(?:_(time|level|rate|lvl|ms|sec|s))?$/;
  const ENV_LETTER = /^(.+?)_([adhsr])(?:_(time|level|ms))?$/;
  const ENV_NUMBERED = /^(.*?)_?(time|rate|level|lvl|t|r|l)_?([1-8])$/;
  const ENV_PREFIX_OK = /(env|eg)[0-9]*$/;
  const ENV_LOOPING = /^(cycle|cyc|loop)/;
  const ENV_WORD_ROLE = {
    attack: "attack", atk: "attack", att: "attack", a: "attack",
    decay: "decay", dcy: "decay", dec: "decay", d: "decay",
    hold: "hold", hld: "hold", h: "hold",
    sustain: "sustain", sus: "sustain", s: "sustain",
    release: "release", rel: "release", r: "release",
    delay: "delay",
  };
  const NUM_KIND = { time: "time", t: "time", rate: "rate", r: "rate", level: "level", lvl: "level", l: "level" };

  // envRoleOf: as envmodel.go. key -> [prefix, role] or null
  function envRoleOf(key) {
    const k = String(key).toLowerCase();
    let m = ENV_NUMBERED.exec(k);
    if (m) {
      const p = m[1].replace(/_$/, "");
      if (ENV_PREFIX_OK.test(p)) return [p, NUM_KIND[m[2]] + m[3]];
    }
    m = ENV_WORD.exec(k);
    if (m) {
      let role = ENV_WORD_ROLE[m[2]];
      if (role === "sustain" && m[3] === "time") role = "slope";
      const p = m[1].replace(/_$/, "");
      if (role === "delay" && p === "") return null;
      return [p, role];
    }
    m = ENV_LETTER.exec(k);
    if (m) return [m[1], ENV_WORD_ROLE[m[2]]];
    return null;
  }
  const isNumberedRole = (r) => /^(time|rate|level)/.test(r);

  // envStageCount: as envmodel.go. -> [n, rates]
  function envStageCount(keys) {
    let n = 0, rates = false;
    for (let i = 1; i <= 8; i++) {
      const t = ("time" + i) in keys, r = ("rate" + i) in keys;
      if (!t && !r) break;
      if (t && r) return [0, false];
      n = i; rates = r;
    }
    for (const role in keys) {
      if (/^(time|rate)/.test(role) && parseInt(role.slice(4), 10) > n) return [0, false];
    }
    return [n, rates];
  }

  // envNumberedComplete: as envmodel.go: four stages or more, every level they need
  function envNumberedComplete(keys) {
    const [n, rates] = envStageCount(keys);
    if (n < 4) return false;
    for (let i = 1; i <= (rates ? n : n - 1); i++) if (!(("level" + i) in keys)) return false;
    return true;
  }

  // envelopeGroups: as envmodel.go. keys -> [{prefix, keys:{role:key}, start, end}]
  function envelopeGroups(keys) {
    const by = new Map();
    keys.forEach((k, col) => {
      const hit = envRoleOf(k);
      if (!hit) return;
      if (!by.has(hit[0])) by.set(hit[0], []);
      by.get(hit[0]).push({ role: hit[1], col });
    });
    const out = [];
    by.forEach((hits, prefix) => {
      const g = { prefix, keys: {}, start: 99, end: -1 };
      let numbered = 0, named = 0;
      hits.forEach((h) => {
        if (g.keys[h.role]) return;
        g.keys[h.role] = keys[h.col];
        g.start = Math.min(g.start, h.col);
        g.end = Math.max(g.end, h.col + 1);
        if (isNumberedRole(h.role)) numbered++; else named++;
      });
      const n = Object.keys(g.keys).length;
      if (g.end - g.start !== n || (numbered && named)) return;
      if (numbered) {
        if (!envNumberedComplete(g.keys)) return;
      } else {
        const a = !!g.keys.attack, d = !!g.keys.decay, r = !!g.keys.release;
        if (!a || (!d && !(r && n >= 3))) return;
      }
      out.push(g);
    });
    return out;
  }

  // envShapeOf: as envmodel.go. frac(key) -> 0..1 or null (unread);
  // min(key) -> the knob's minimum
  function envShapeOf(keys, frac, minOf, touched) {
    const e = { Start: 0, Segs: [], Signed: false, Rates: false, Known: true, Still: false, Hot: -1, Corner: -1 };
    const get = (role, def) => {
      const k = keys[role];
      if (!k) return [def, "", false];
      const f = frac(k);
      if (f === null || f === undefined) { e.Known = false; return [def, k, true]; }
      return [Math.max(0, Math.min(1, f)), k, true];
    };
    Object.values(keys).forEach((k) => {
      const hit = envRoleOf(k);
      if (hit && ENV_LOOPING.test(hit[0])) e.Still = true;
    });
    const [n, rates] = envStageCount(keys);
    if (n > 0) {
      e.Rates = rates;
      const kind = rates ? "rate" : "time", letter = rates ? "R" : "T";
      Object.values(keys).forEach((k) => {
        const lk = String(k).toLowerCase(), m = minOf(k);
        if (lk.includes("pitch") || lk.includes("penv") || (m !== null && m !== undefined && m < 0)) e.Signed = true;
      });
      const rest = e.Signed ? 0.5 : 0, defLevel = [1, 0.7, 0.6, 0, 0, 0, 0, 0];
      for (let i = 1; i <= n; i++) {
        let [w, tk] = get(kind + i, 0.35);
        if (rates) w = 1 - w;
        let [level, lk, ok] = get("level" + i, defLevel[i - 1]);
        if (!ok) level = rest;
        const s = { Role: kind + i, Label: letter + i, W: w, Level: level, TimeKey: tk, Keys: [tk, lk], Release: i === n, Plateau: false };
        if (i === n && n > 1) {
          const hold = e.Segs[e.Segs.length - 1];
          e.Segs.push({ Role: "sustain", Label: "S", W: 0, Level: hold.Level, Plateau: true, Release: false, TimeKey: "", Keys: [] });
        }
        e.Segs.push(s);
      }
      e.Start = rates ? e.Segs[e.Segs.length - 1].Level : rest;
    } else {
      const [sus, susKey, hasS] = get("sustain", 0.6);
      const [slope, slopeKey, hasSlope] = get("slope", 0.5);
      const hasR = get("release", 0)[2];
      const add = (role, label, level, def) => {
        const [w, k, ok] = get(role, def);
        if (!ok) return;
        const s = { Role: role, Label: label, W: w, Level: level, TimeKey: k, Keys: [k], Plateau: false, Release: role === "release" };
        if (role === "decay" && hasS) s.Keys.push(susKey);
        e.Segs.push(s);
      };
      add("delay", "DL", 0, 0.2);
      add("attack", "A", 1, 0.25);
      add("hold", "H", 1, 0.3);
      add("decay", "D", hasS ? sus : 0, 0.35);
      if (hasS || hasR) {
        let level = e.Segs.length ? e.Segs[e.Segs.length - 1].Level : 1;
        if (hasS) level = sus;
        if (hasSlope) level = Math.max(0, Math.min(1, sus + (slope - 0.5) * 1.6));
        e.Segs.push({ Role: "sustain", Label: "S", W: 0, Level: level, Plateau: true, Release: false, TimeKey: "", Keys: hasS ? [susKey, slopeKey] : [] });
      }
      add("release", "R", 0, 0.35);
    }
    if (!e.Known) e.Segs.forEach((s) => { s.W = 0.3; });
    e.Segs.forEach((s, i) => {
      s.Keys.forEach((k, j) => {
        if (k && k === touched) {
          e.Hot = i; e.Corner = i + 1;
          if (s.Plateau && j === 0) e.Corner = i;
        }
      });
    });
    return e;
  }
  const plateauOf = (e) => e.Segs.findIndex((s) => s.Plateau);
  const levelBefore = (e, i) => (i <= 0 ? e.Start : e.Segs[i - 1].Level);

  // layout: as envLayout in envmodel.go -> {pts:[{x,y}], k, span}
  function layout(e, x0, x1, top, base) {
    const span = x1 - x0, seg = (f) => span * (0.05 + 0.25 * f);
    const ws = e.Segs.map(() => 0);
    let used = 0, timed = 0, pl = -1;
    e.Segs.forEach((s, i) => {
      if (s.Plateau) { pl = i; return; }
      ws[i] = seg(s.W); used += ws[i]; timed++;
    });
    let k = 1;
    if (pl >= 0) {
      ws[pl] = Math.max(span * 0.16, span - used);
      if (used + ws[pl] > span) k = span / (used + ws[pl]);
    } else if (timed > 0) k = span / (seg(1) * timed);
    const lvl = (f) => base - f * (base - top);
    const pts = [{ x: x0, y: lvl(e.Start) }];
    let x = x0;
    e.Segs.forEach((s, i) => { x += ws[i] * k; pts.push({ x, y: lvl(s.Level) }); });
    return { pts, k, span, lvl };
  }

  // relStart, envAt: as envmodel.go. v = [age, off (< 0 held), vel, T0, T1, ...] (seconds, per segment)
  function relStart(e, lv) {
    const pl = plateauOf(e);
    if (pl < 0 || pl + 1 >= e.Segs.length) return 0;
    const from = e.Segs[pl].Level, to = e.Segs[pl + 1].Level;
    if (Math.abs(from - to) < 1e-6) return 0;
    return Math.max(0, Math.min(1, (from - lv) / (from - to)));
  }
  const TRAIL = 9, TRAIL_DT = 0.033;
  function envAt(v, dt, e) {
    const age = v[0] + dt, off = v[1] >= 0 ? v[1] + dt : -1;
    const tt = (i) => (3 + i < v.length ? v[3 + i] : 0);
    const pos = (i, p) => { const a = levelBefore(e, i), b = e.Segs[i].Level; return { seg: i, prog: p, level: a + (b - a) * p }; };
    const run = (i, p, t, stopAt) => {
      for (; i < e.Segs.length && i !== stopAt; i++) {
        const d = tt(i), left = d * (1 - p);
        if (t < left && d > 1e-6) return pos(i, p + t / d);
        t -= left; p = 0;
      }
      if (i === stopAt && i < e.Segs.length) return pos(i, 0);
      return { seg: e.Segs.length - 1, prog: 1, done: true };
    };
    const pl = plateauOf(e);
    if (pl < 0) return run(0, 0, age, -1);
    if (off < 0) return run(0, 0, age, pl);
    if (pl + 1 >= e.Segs.length) return { seg: pl, done: true };
    const at = run(0, 0, age - off, pl);
    return run(pl + 1, relStart(e, at.level), off, -1);
  }
  // a stage's name, if it fits its segment: as envBarLabel in visuals.go
  const barLabel = (l, w) => (w >= 7 + 7 * l.length || (l.length === 1 && w >= 9) ? l : "");

  // one figure: an envelope group drawn from live values, redrawn on change
  const figures = new Set();

  // envFigure(g, io): io = {meta(key) -> param, value(key) -> raw, set(key, raw), label(key) -> text}
  function envFigure(g, io) {
    const W = 480, H = 112, x0 = 10, x1 = W - 10, top = 12, base = H - 30;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "env");
    svg.setAttribute("role", "img");
    let hot = "", drag = null;

    const frac = (key) => {
      if (String(key).startsWith("#")) return null;
      const p = io.meta(key), v = parseFloat(io.value(key));
      if (!p || isNaN(v)) return null;
      const lo = p.min ?? 0, hi = p.max ?? 1;
      return hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0;
    };
    const minOf = (key) => { const p = io.meta(key); return p ? p.min ?? 0 : null; };
    const shape = () => envShapeOf(g.keys, frac, minOf, hot);

    let lastL = null, lastE = null, lastLive = null;
    function draw() {
      const e = shape(), L = layout(e, x0, x1, top, base), pts = L.pts;
      lastL = L; lastE = e;
      svg.classList.toggle("unknown", !e.Known);
      const floor = e.Signed ? (top + base) / 2 : base;
      let h = "";
      const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      h += `<polygon class="fill" points="${x0},${floor} ${poly} ${pts[pts.length - 1].x.toFixed(1)},${floor}"/>`;
      h += `<line class="base" x1="${x0}" y1="${base}" x2="${x1}" y2="${base}"/>`;
      if (e.Signed) h += `<line class="base" x1="${x0}" y1="${floor}" x2="${x1}" y2="${floor}"/>`;
      const pl = plateauOf(e);
      if (pl > 0) h += `<line class="guide" x1="${x0}" y1="${pts[pl].y.toFixed(1)}" x2="${pts[pl].x.toFixed(1)}" y2="${pts[pl].y.toFixed(1)}"/>`;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        h += `<line class="seg${e.Hot === i - 1 ? " hot" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      }
      // the stage bar: one segment per drawn segment, exactly as wide; lit
      // while a note's dot is in it (paintLive), outlined while its knob is touched
      for (let i = 1; i < pts.length; i++) {
        const sx = pts[i - 1].x + (i === 1 ? 0 : 1), ex = pts[i].x - (i === pts.length - 1 ? 0 : 1), w = ex - sx;
        if (w < 2) continue;
        const hc = e.Hot === i - 1 ? " hot" : "", txt = barLabel(e.Segs[i - 1].Label, w);
        h += `<rect class="stage${hc}" data-seg="${i - 1}" x="${sx.toFixed(1)}" y="${base + 5}" width="${w.toFixed(1)}" height="14" rx="1"/>`;
        if (txt) h += `<text class="sl${hc}" data-seg="${i - 1}" x="${((sx + ex) / 2).toFixed(1)}" y="${base + 15.5}">${txt}</text>`;
      }
      // the handles: every point where two segments meet
      for (let i = 1; i < pts.length - 1; i++) {
        const big = e.Corner === i;
        h += `<circle class="handle${big ? " hot" : ""}" data-pt="${i}" cx="${pts[i].x}" cy="${pts[i].y}" r="${big ? 6 : 4.5}"/>`;
        h += `<circle class="grab" data-pt="${i}" cx="${pts[i].x}" cy="${pts[i].y}" r="14"/>`;
      }
      h += `<g class="live"></g>`;
      svg.innerHTML = h;
      svg.setAttribute("aria-label", "Envelope: " + Object.entries(g.keys).map(([, k]) => io.label(k)).join(", "));
      if (lastLive) paintLive();
      return L;
    }

    // the sound in it, as the Push draws it (visuals.go, envclock.go): the
    // frame carries each note's clock (its age and its segments' times), and
    // the page runs it on every animation frame, so the dots move as
    // smoothly as the screen: each along its lines, a short trail behind
    // it; the newest note's segment lit up to its dot; the bar lit where notes are
    let liveAt = 0, raf = 0;
    function liveEnv(d) {
      lastLive = d;
      liveAt = performance.now();
      paintLive();
    }
    function paintLive() {
      raf = 0;
      const d = lastLive, e = lastE;
      const lay = svg.querySelector("g.live");
      if (!lay || !lastL || !e || !svg.isConnected) return;
      const lit = new Set();
      let h = "";
      if (d && e.Known && !e.Still) {
        const pts = lastL.pts;
        const at = (p) => {
          const i = p.seg;
          if (i < 0 || i + 1 >= pts.length) return null;
          const a = pts[i], b = pts[i + 1], t = Math.max(0, Math.min(1, p.prog));
          return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, i];
        };
        const dt = Math.min(0.25, (performance.now() - liveAt) / 1000);
        if (d.rt) h += `<line class="retrig" x1="${x0}" y1="${top}" x2="${x0}" y2="${base}" style="opacity:${Math.max(0, d.rt - dt / 0.3).toFixed(2)}"/>`;
        const vs = d.v || [];
        for (let n = vs.length - 1; n >= 0; n--) { // the newest drawn last, on top
          const v = vs[n], cur = envAt(v, dt, e);
          if (cur.done) continue;
          lit.add(cur.seg);
          for (let k = TRAIL; k >= 1; k--) {
            const back = dt - k * TRAIL_DT;
            if (v[0] + back < 0) continue;
            const bq = envAt(v, back, e);
            if (bq.done) continue;
            const q = at(bq);
            if (!q) continue;
            const f = 1 - k / (TRAIL + 1);
            h += `<circle class="trail" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${(1.4 + 1.8 * f).toFixed(1)}" style="opacity:${(0.12 + 0.45 * f).toFixed(2)}"/>`;
          }
          const q = at(cur);
          if (!q) continue;
          let r = 3.6 + 1.6 * v[2];
          if (n === 0) {
            const a = pts[q[2]];
            h += `<line class="lit" x1="${a.x}" y1="${a.y}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}"/>`;
            h += `<line class="hair" x1="${q[0].toFixed(1)}" y1="${(q[1] + 7).toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${base - 2}"/>`;
            r = 5.2;
          }
          h += `<circle class="ring" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${(r + 2.2).toFixed(1)}"/><circle class="dot" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${r.toFixed(1)}"/>`;
        }
      }
      lay.innerHTML = h;
      svg.querySelectorAll("[data-seg]").forEach((el) => el.classList.toggle("on", lit.has(+el.dataset.seg)));
      if (lit.size && !raf) raf = requestAnimationFrame(paintLive); // runs while a note is in it
    }

    // dragging: a handle is the end of a segment. Across, it sets that
    // segment's time knob (its width); up and down, its level knob (the
    // plateau's: the sustain, and its slope at its end)
    const toLocal = (ev) => {
      const r = svg.getBoundingClientRect();
      return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
    };
    const setFrac = (key, f) => {
      const p = key && io.meta(key);
      if (!p) return;
      f = Math.max(0, Math.min(1, f));
      const lo = p.min ?? 0, hi = p.max ?? 1;
      let v = lo + f * (hi - lo);
      v = p.type === "int" ? Math.round(v) : +v.toFixed(4);
      if (String(v) !== String(io.value(key))) io.set(key, String(v));
    };
    svg.addEventListener("pointerdown", (ev) => {
      const pt = ev.target.dataset && +ev.target.dataset.pt;
      if (!pt) return;
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      const e = shape(), L = layout(e, x0, x1, top, base);
      drag = { seg: pt - 1, from: L.pts[pt - 1].x, k: L.k, span: L.span };
      const s = e.Segs[pt - 1];
      hot = s.Plateau ? s.Keys[1] || s.Keys[0] || "" : s.Keys[s.Keys.length - 1] || s.TimeKey;
      draw();
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const q = toLocal(ev), e = shape(), s = e.Segs[drag.seg];
      const level = (base - q.y) / (base - top);
      if (s.Plateau) {
        const [susK, slopeK] = s.Keys;
        if (slopeK) { const sus = frac(susK) || 0; setFrac(slopeK, (level - sus) / 1.6 + 0.5); }
        else if (susK) setFrac(susK, level);
      } else {
        const w = ((q.x - drag.from) / (drag.span * drag.k) - 0.05) / 0.25;
        setFrac(s.TimeKey, e.Rates ? 1 - w : w);
        const lk = s.Keys[1];
        if (lk) setFrac(lk, level);
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
        if (!drag && key !== hot) { hot = key; draw(); }
      },
      live(f) { if (fig.key) liveEnv(f && f.envs ? f.envs[fig.key] : null); },
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
      if (q.cut < 0 || p.includes("macro") || p.includes("morph")) return;
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
  const SPEC_TOP = -6, SPEC_BOT = -84; // the spectrum's scale (visuals_shapes.go specTopDB, specBotDB)
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
        h += `<g class="spec"></g>`;
        if (f.Kind === "off") h += `<line class="seg" x1="${x0}" y1="${yOf(0)}" x2="${x1}" y2="${yOf(0)}"/>`;
        h += `<line class="guide" x1="${xc}" y1="${top}" x2="${xc}" y2="${base}"/>`;
        const t = f.Kind === "off" ? "OFF" : /^[\d.\- ]*$/.test(name) ? "" : name.toUpperCase();
        h += `<text class="letter" x="${W / 2}" y="${top + 14}">${esc(t)}</text>`;
        return h;
      }
      const curve = [];
      for (let x = x0; x <= x1; x += 2) curve.push([x, yOf(filterDB(f, (x - x0) / (x1 - x0)))]);
      geo.f = f;
      geo.yOf = yOf;
      h += `<polygon class="fill" points="${x0},${base} ${pts(curve)} ${curve[curve.length - 1][0]},${base}"/>`;
      h += `<g class="spec"></g>`; // the sound itself, behind the curve that shapes it (live)
      h += `<polyline class="seg${hot === "resonance" || hot === "type" ? " hot" : ""}" fill="none" points="${pts(curve)}"/>`;
      h += `<g class="mod"></g>`; // where the sound's modulation has the filter now (live: frame.mod)
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
      geo = { x0, x1, top, base, mid, amp, n, wave };
      return h + `<g class="live"></g>`;
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
    let lastLive = null;
    function draw() {
      const k = known();
      svg.classList.toggle("unknown", !k);
      svg.innerHTML = g.kind === "filter" ? drawFilter(k) : g.kind === "lfo" ? drawLFO(k) : drawMix(k);
      const what = { filter: "Filter", lfo: "LFO", mix: "Mix" }[g.kind];
      svg.setAttribute("aria-label", `${what}: ` + Object.values(g.keys).filter((key) => io.meta(key)).map((key) => io.label(key)).join(", "));
      if (lastLive) live(lastLive);
    }
    // the sound, as the Push draws it (visuals_shapes.go): the spectrum
    // behind a filter, an LFO's playhead where its phase is known
    // where the module's modulation has a key now, 0..1 of its range (frame.mod: "<comp>:<key>" -> raw), or null
    function modFrac(f, key) {
      if (!f || !f.mod || !key) return null;
      const k = Object.keys(f.mod).find((m) => m.endsWith(":" + key));
      const p = k && io.meta(key);
      if (!p || !(p.max > p.min)) return null;
      return Math.max(0, Math.min(1, (+f.mod[k] - p.min) / (p.max - p.min)));
    }
    function liveMod(f) {
      const lay = svg.querySelector("g.mod");
      if (!lay) return;
      const nc = modFrac(f, g.keys.cutoff), nr = modFrac(f, g.keys.resonance);
      if (!geo.f || svg.classList.contains("unknown") || (nc === null && nr === null)) { lay.innerHTML = ""; return; }
      const m = Object.assign({}, geo.f);
      if (nc !== null) m.Cutoff = nc;
      if (nr !== null) m.Res = nr;
      if (Math.abs(m.Cutoff - geo.f.Cutoff) < 0.004 && Math.abs(m.Res - geo.f.Res) < 0.004) { lay.innerHTML = ""; return; }
      const curve = [];
      for (let x = geo.x0; x <= geo.x1; x += 2) curve.push([x, geo.yOf(filterDB(m, (x - geo.x0) / (geo.x1 - geo.x0)))]);
      const xc = geo.x0 + (geo.x1 - geo.x0) * m.Cutoff, yc = geo.yOf(filterDB(m, m.Cutoff));
      lay.innerHTML = `<polyline class="modcurve" fill="none" points="${pts(curve)}"/><circle class="moddot" cx="${xc}" cy="${yc}" r="4"/>`;
    }
    function live(f) {
      lastLive = f;
      if (g.kind === "filter") {
        liveMod(f);
        const lay = svg.querySelector("g.spec");
        if (!lay) return;
        const sp = f && f.spec;
        if (!sp || !sp.length || svg.classList.contains("unknown") || geo.x0 === undefined) { lay.innerHTML = ""; return; }
        const n = sp.length, line = [];
        for (let i = 0; i < n; i++) {
          const t = Math.max(0, Math.min(1, (sp[i] - SPEC_BOT) / (SPEC_TOP - SPEC_BOT)));
          line.push([geo.x0 + (geo.x1 - geo.x0) * i / (n - 1), geo.base - t * (geo.base - geo.top)]);
        }
        lay.innerHTML = `<polygon class="specfill" points="${geo.x0},${geo.base} ${pts(line)} ${geo.x1},${geo.base}"/><polyline class="specline" fill="none" points="${pts(line)}"/>`;
        return;
      }
      if (g.kind !== "lfo") return;
      const lay = svg.querySelector("g.live");
      const d = f && f.lfos && fig.key ? f.lfos[fig.key] : null;
      if (!lay) return;
      if (!d || svg.classList.contains("unknown") || !geo.wave) { lay.innerHTML = ""; return; }
      let h = "";
      if (d.rs) h += `<line class="retrig" x1="${geo.x0}" y1="${geo.top}" x2="${geo.x0}" y2="${geo.base}" style="opacity:${d.rs}"/>`;
      if (d.ph >= 0) {
        const pos = (ph) => {
          let u = (ph % geo.n) / geo.n;
          if (u < 0) u += 1;
          return [geo.x0 + (geo.x1 - geo.x0) * u, geo.mid - lfoValue(geo.wave, geo.n * Math.min(u, 0.9999)) * geo.amp];
        };
        (d.tr || []).slice(0, -1).forEach((ph, i, arr) => {
          const q = pos(ph), k = (i + 1) / (arr.length + 1);
          h += `<circle class="trail" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${(1.6 + 1.8 * k).toFixed(1)}" style="opacity:${(0.15 + 0.5 * k).toFixed(2)}"/>`;
        });
        const q = pos(d.ph);
        h += `<line class="hair" x1="${q[0].toFixed(1)}" y1="${geo.top}" x2="${q[0].toFixed(1)}" y2="${geo.base}"/>`;
        h += `<circle class="ring" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="7.5"/><circle class="dot" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="5.2"/>`;
      }
      lay.innerHTML = h;
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
      live,
      alive() { return svg.isConnected; },
    };
    figures.add(fig);
    draw();
    return fig;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // figure: the picture for any recognized group
  function figure(g, io) { return !g.kind || g.kind === "env" ? envFigure(g, io) : shapeFigure(g, io); }

  // live: one frame of the sound (GET .../live), to every figure on the page
  function live(f) {
    figures.forEach((fig) => (fig.alive() ? fig.live && fig.live(f) : figures.delete(fig)));
  }

  function redrawAll() {
    figures.forEach((f) => (f.alive() ? f.draw() : figures.delete(f)));
  }

  window.PungVisuals = { envAt, envShapeOf, envRoleOf, envelopeGroups, pictureGroups, filterKind, filterDB, lfoWave, layout, figure, redrawAll, live };
})();
