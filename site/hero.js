// hero.js: the Push screen on pung.live's front page, playing. Two kinds of
// view, as on the Push: PUNG CUSTOM, the front panels of Pung's own
// instruments (loops recorded from Pung's renderer: scripts/hero-loops.sh),
// and PUNG DEFAULT, the page every module gets, drawn here live. They take
// turns until a tab is pressed; the Push's lower buttons are tabs too.
//
// The default page's pictures are
// Pung's own (src/web/visuals.js, the code that draws them on Pung's web page,
// the same geometry as on the Push): an envelope with every note a dot on it,
// a filter with the sound behind it and its cutoff where the LFO has it, an
// LFO with its playhead. What moves them here is a small sound made up on the
// page: a chord every few seconds, and an LFO on the cutoff.
//
// The handles can be dragged, as on Pung's web page. Still where motion is
// turned down, and while the screen is not in view.
(function () {
  "use strict";
  const root = document.getElementById("livescreen");
  if (!root || !window.PungVisuals) return;
  const V = window.PungVisuals;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");

  // one page of a synth, as a Push shows it: eight controls, one per encoder
  const KEYS = ["amp_attack", "amp_decay", "amp_sustain", "amp_release", "cutoff", "resonance", "lfo1_rate", "lfo1_shape"];
  const NAME = ["Attack", "Decay", "Sustain", "Release", "Cutoff", "Resonance", "LFO Rate", "LFO Shape"];
  const SHAPES = ["Sine", "Triangle", "Saw", "Square"];
  const meta = {}, val = {};
  KEYS.forEach((k) => (meta[k] = { key: k, min: 0, max: 1, type: "float" }));
  meta.lfo1_shape = { key: "lfo1_shape", min: 0, max: 3, type: "enum", options: SHAPES };
  Object.assign(val, { amp_attack: 0.5, amp_decay: 0.7, amp_sustain: 0.55, amp_release: 0.86, cutoff: 0.5, resonance: 0.45, lfo1_rate: 0.32, lfo1_shape: 0 });

  // what a knob's travel means here
  const secs = (f) => 0.02 * Math.pow(100, f);           // an envelope time
  const hertz = (f) => 20 * Math.pow(1000, f);            // the cutoff, three decades as the picture draws them
  const lfoHz = (f) => 0.12 * Math.pow(30, f);
  const fmtTime = (s) => (s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(2) + " s");
  const fmtHz = (h) => (h < 1000 ? Math.round(h) + " Hz" : (h / 1000).toFixed(h < 10000 ? 2 : 1) + " kHz");
  const text = (k, f) => {
    if (f === undefined) f = val[k];
    if (k === "amp_sustain" || k === "resonance") return Math.round(f * 100) + " %";
    if (k === "cutoff") return fmtHz(hertz(f));
    if (k === "lfo1_rate") return lfoHz(f).toFixed(2) + " Hz";
    if (k === "lfo1_shape") return SHAPES[Math.round(val[k])] || "";
    return fmtTime(secs(f));
  };

  // ---- the screen: the pictures over the columns of their controls, the values below ----
  const groups = V.pictureGroups(KEYS).sort((a, b) => a.start - b.start);
  const figs = {};
  const tiles = document.createElement("div");
  tiles.className = "ls-tiles";
  const TITLE = { env: "Amp envelope", filter: "Filter · low pass", lfo: "LFO 1 → cutoff" };
  groups.forEach((g) => {
    const kind = g.kind || "env";
    const tile = document.createElement("div");
    tile.className = "ls-tile ls-" + kind;
    tile.style.setProperty("--c", `${g.start + 1} / ${g.end + 1}`); // the columns of its controls (one column on a phone: pung.css)
    const head = document.createElement("div");
    head.className = "ls-head";
    head.innerHTML = `<span>${TITLE[kind] || ""}</span><b></b>`;
    const fig = V.figure(g, {
      meta: (k) => meta[k],
      value: (k) => String(val[k]),
      set: (k, v) => { val[k] = Math.max(meta[k].min, Math.min(meta[k].max, parseFloat(v))); cells(); V.redrawAll(); },
      label: (k) => `${NAME[KEYS.indexOf(k)]} ${text(k)}`,
      text: (k) => text(k),
    });
    fig.key = kind === "env" ? "amp" : kind === "lfo" ? "lfo1" : "";
    figs[kind] = { fig, g, head: head.querySelector("b") };
    tile.append(head, fig.el);
    tiles.appendChild(tile);
  });
  const row = document.createElement("div");
  row.className = "ls-row";
  const cell = KEYS.map((k, i) => {
    const c = document.createElement("div");
    c.className = "ls-cell";
    c.innerHTML = `<span class="n">${NAME[i]}</span><span class="v"></span><i class="arc"><i></i><b></b></i>`;
    row.appendChild(c);
    return c;
  });
  function cells(modCut) {
    KEYS.forEach((k, i) => {
      const f = (val[k] - meta[k].min) / (meta[k].max - meta[k].min);
      cell[i].querySelector(".v").textContent = text(k);
      cell[i].querySelector(".arc > i").style.width = (f * 100).toFixed(1) + "%";
      const m = cell[i].querySelector(".arc > b");
      const on = k === "cutoff" && modCut !== undefined && Math.abs(modCut - f) > 0.004;
      m.style.display = on ? "block" : "none";
      if (on) m.style.left = (modCut * 100).toFixed(1) + "%";
    });
  }
  // ---- the views: Pung's own instruments' front panels, and the default page ------------
  const VIEWS = [
    { id: "vivace", name: "Vivace", kind: "custom", cap: "Vivace, Pung's own wavetable synth: its tables in three dimensions, the filter and the envelope as a chord plays." },
    { id: "nodalred", name: "Nodal Red 2X", kind: "custom", cap: "Nodal Red 2X, the Clavia Nord Lead 2X: its red panel, section by section, with the knobs a modulation moves marked in cyan." },
    { id: "ostirus", name: "OsTIrus", kind: "custom", cap: "OsTIrus, the Access Virus TI: oscillators, both filters with the sound behind them, the effects." },
    { id: "xenia", name: "Xenia", kind: "custom", cap: "Xenia, the Waldorf Microwave II/XT: its display, and the wavetable as a landscape of waves." },
    { id: "vavra", name: "Vavra", kind: "custom", cap: "Vavra, the Waldorf microQ: its display and the edit matrix, a row under the encoders." },
    { id: "default", name: "Pung default", kind: "default", cap: "The page every module gets, with no work from its maker: every note a dot on the envelope, the sound behind the filter, the cutoff where the LFO has it. Drag a handle." },
  ];
  const live = document.createElement("div");
  live.className = "ls-live";
  live.append(tiles, row);
  const video = document.createElement("video");
  video.className = "ls-video";
  video.muted = true; video.loop = true; video.playsInline = true; video.preload = "none";
  video.setAttribute("muted", ""); video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  root.textContent = "";
  root.append(video, live);
  root.classList.add("on");
  cells();

  const fig = root.closest("figure");
  const capB = fig && fig.querySelector("figcaption b"), capS = fig && fig.querySelector("figcaption span");
  const lower = fig ? fig.querySelectorAll(".push .row.btns")[1] : null;
  const tabs = document.createElement("div");
  tabs.className = "ls-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "The view on the Push screen");
  tabs.innerHTML = `<span class="g">Pung custom</span>` + VIEWS.map((v, i) =>
    `${v.kind === "default" ? '<span class="g">or</span>' : ""}<button type="button" role="tab" data-i="${i}" aria-selected="false">${v.name}</button>`).join("");
  if (fig) fig.insertBefore(tabs, fig.firstChild);
  let view = -1, auto = true, turn = 0;
  function show(i, byHand) {
    if (byHand) { auto = false; clearTimeout(turn); }
    if (i === view) return;
    view = i;
    const v = VIEWS[i];
    root.dataset.view = v.kind;
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.i === i)));
    if (lower) [...lower.children].forEach((b, n) => { b.className = n === i ? "sel" : n < VIEWS.length ? "lit" : ""; });
    if (capB) capB.textContent = v.kind === "default" ? "Pung default" : "Pung custom · " + v.name;
    if (capS) capS.textContent = v.cap;
    if (v.kind === "custom") {
      video.poster = `hero/${v.id}.png`;
      video.src = `hero/${v.id}.mp4`;
      if (!still.matches) video.play().catch(() => {});
    } else {
      video.pause();
    }
    loop();
    next();
  }
  // their turns: a panel for a loop and a half, the default page a little longer
  function next() {
    clearTimeout(turn);
    if (!auto || still.matches) return;
    turn = setTimeout(() => { if (seen && !document.hidden) show((view + 1) % VIEWS.length); else next(); }, VIEWS[view].kind === "default" ? 9000 : 6000);
  }
  tabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(+b.dataset.i, true); });
  if (lower) [...lower.children].forEach((b, n) => {
    if (n >= VIEWS.length) return;
    b.setAttribute("role", "button"); b.tabIndex = 0; b.title = VIEWS[n].name; b.setAttribute("aria-label", VIEWS[n].name);
    b.addEventListener("click", () => show(n, true));
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(n, true); } });
  });

  // ---- the sound: a chord every few seconds, an LFO on the cutoff ------------------------
  const CHORD_EVERY = 3.4, HELD = 1.5, STRUM = [0, 0.11, 0.23];
  let voices = [];        // {on, off (-1 held), vel}: times in seconds of the page's clock
  let now = 0, nextChord = 0.5, lfoPh = 0, trail = [];
  const envGroup = groups.find((g) => !g.kind || g.kind === "env");
  const frac = (k) => (val[k] - meta[k].min) / (meta[k].max - meta[k].min);
  const shapeNow = () => V.envShapeOf(envGroup.keys, frac, () => 0, "");
  // a voice as the envelope reads it: [age, since its key went up, velocity, a time per segment]
  function times(e) {
    return e.Segs.map((s) => (s.Plateau ? 0 : s.Role === "attack" ? secs(val.amp_attack) : s.Role === "decay" ? secs(val.amp_decay) : s.Role === "release" ? secs(val.amp_release) : 0));
  }
  function frame(dt) {
    now += dt;
    if (now >= nextChord) {
      STRUM.forEach((d, i) => voices.push({ on: now + d, off: now + d + HELD, vel: 0.7 + 0.1 * i }));
      nextChord = now + CHORD_EVERY;
    }
    const e = shapeNow(), tt = times(e);
    const vs = [];
    let level = 0;
    voices = voices.filter((v) => {
      if (now < v.on) return true;
      const age = now - v.on, off = now >= v.off ? now - v.off : -1;
      const arr = [age, off, v.vel, ...tt];
      const at = V.envAt(arr, 0, e);
      if (at.done) return false;
      vs.push(arr);
      level += (at.level || 0) * v.vel;
      return true;
    });
    level = Math.min(1, level / 1.6);

    // the LFO, and where it has the cutoff now (with a little of the envelope)
    const hz = lfoHz(val.lfo1_rate);
    lfoPh += hz * dt;
    const n = 1 + 4 * val.lfo1_rate;                     // the cycles the picture draws
    const ph = lfoPh % n;
    trail.push(ph);
    if (trail.length > 7) trail.shift();
    const wave = ["sine", "tri", "sawup", "square"][Math.round(val.lfo1_shape)] || "sine";
    const u = lfoPh % 1;
    const lv = wave === "sine" ? Math.sin(2 * Math.PI * u) : wave === "tri" ? 1 - 4 * Math.abs(u - 0.5) : wave === "sawup" ? 2 * u - 1 : u < 0.5 ? 1 : -1;
    const modCut = Math.max(0.02, Math.min(0.98, val.cutoff + 0.16 * lv + 0.1 * level));

    // the sound's spectrum: a bright source, through the filter where it is now, as loud as the notes
    const f = { Cutoff: modCut, Res: val.resonance, HasRes: true, Kind: "lp", Poles: 2 };
    const spec = [];
    const N = 56, quiet = 20 * Math.log10(Math.max(level, 0.0004));
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      const src = -10 - 26 * x + 3.2 * Math.sin(x * 38 + now * 1.7) + 2.2 * Math.sin(x * 91 - now * 2.6);
      spec.push(Math.max(-84, src + V.filterDB(f, x) + quiet));
    }
    V.live({ envs: { amp: { v: vs } }, spec, lfos: { lfo1: { ph, tr: trail.slice(), rs: 0 } }, mod: { "hero:cutoff": modCut } });
    cells(modCut);
    if (figs.filter) figs.filter.head.textContent = fmtHz(hertz(modCut));
    if (figs.lfo) figs.lfo.head.textContent = hz.toFixed(2) + " Hz";
    if (figs.env) figs.env.head.textContent = vs.length ? vs.length + (vs.length === 1 ? " note" : " notes") : "";
  }

  // ---- when it runs: its view shown, in view, the tab in front, motion allowed -----------
  let seen = true, raf = 0, last = 0;
  function tick(t) {
    raf = 0;
    const dt = Math.min(0.1, last ? (t - last) / 1000 : 0.016);
    last = t;
    frame(dt);
    loop();
  }
  function loop() {
    const run = seen && !document.hidden && !still.matches && view >= 0 && VIEWS[view].kind === "default";
    if (run && !raf) raf = requestAnimationFrame(tick);
    if (!run) { last = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => {
      seen = es[0].isIntersecting; loop();
      if (view >= 0 && VIEWS[view].kind === "custom") { if (seen && !still.matches) video.play().catch(() => {}); else video.pause(); }
    }, { threshold: 0.05 }).observe(root);
  }
  document.addEventListener("visibilitychange", loop);
  still.addEventListener("change", loop);
  if (still.matches) {
    // one moment of it, held: three notes on their way, the LFO a third through
    now = 0; nextChord = 0; frame(0.001); frame(0.45);
  }
  show(0);
})();
