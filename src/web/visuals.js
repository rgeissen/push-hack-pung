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

  // figure(g, io): io = {meta(key) -> param, value(key) -> raw, set(key, raw), label(key) -> text}
  function figure(g, io) {
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

  function redrawAll() {
    figures.forEach((f) => (f.alive() ? f.draw() : figures.delete(f)));
  }

  window.PungVisuals = { envelopeGroups, layout, figure, redrawAll };
})();
