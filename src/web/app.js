/* Pung on Push: the web page.
 *
 * It is also the PARENT of a module's own web_ui.html: the iframe includes
 * /static/schwung-remote-api.js (schwung-manager's, unmodified) and talks
 * postMessage to this page. The protocol below answers it exactly as
 * schwung-manager's remote-ui.js does. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SLOT_COLORS = ["#ff8a1f", "#5ab0ff", "#ff5fa2", "#7bd88f", "#ffd23f", "#a48cff", "#3cc8e6", "#ff5a4e"];
  const KIND = { midi: "MIDI FX", synth: "Synth", fx: "Audio FX" };
  const KCOL = { midi: "var(--midi)", synth: "var(--inst)", fx: "var(--afx)" };

  // mode "devices": Pung's devices in Live (/api/pung-devices), the
  // panel on /api/devices/<n>; mode "slots": version 1's Pung tracks.
  let state = { slot: 1, comp: "synth", slots: [], info: null, values: {}, modules: [],
                mode: "slots", base: "/api/slots/1", devices: [], dev: -1, follow: true };
  let frame = null, frameComp = null, frameSubscribed = false;
  let pickerMode = "add", pickerKind = "audio_fx";

  const api = (path, opts) => fetch(path, opts).then((r) => r.json());
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  function setSlotColor() {
    document.documentElement.style.setProperty("--slot", SLOT_COLORS[(state.slot - 1) % SLOT_COLORS.length]);
  }

  // ---- status, slots, chain ------------------------------------------------
  async function refreshStatus() {
    let st;
    try { st = await api("/api/status"); } catch (e) { $("health").innerHTML = '<span class="bad">Pung is not answering</span>'; return; }
    state.slots = st.slots || [];
    let dv = { devices: [], selected: -1 };
    try { dv = await api("/api/pung-devices"); } catch (e) { /* an older Pung */ }
    state.devices = dv.devices || [];
    if (state.devices.length || !state.slots.length) return refreshDevices(dv.selected);
    const e = st.engine, t = st.transport;
    const bus = state.slots.some((s) => s.bus);
    $("health").innerHTML = `${bus ? "audio bus on" : '<span class="bad">no audio bus</span>'} · ` +
      `DSP ${Math.round((e.avg_us / Math.max(1, e.budget_us)) * 100)}% · ` +
      (t.clock ? `${t.running ? "playing" : "stopped"} ${t.bpm ? t.bpm.toFixed(1) + " BPM" : ""}` : "no clock");
    renderSlots();
    const cur = state.slots.find((s) => s.slot === state.slot);
    if (cur) renderChain(cur);
  }

  // ---- Pung's devices in Live ---------------------------------------------
  function refreshDevices(selected) {
    if (state.mode !== "devices") {
      state.mode = "devices";
      $("chain").parentElement.hidden = true;
      $("howto").innerHTML = "<h2>Pung devices in your Live Set</h2><p>Select a Pung device in Live, " +
        "or here. Changes here reach Live too: Push's device view, the Pung view, automation.</p>";
    }
    $("health").textContent = state.devices.length ? `${state.devices.length} Pung devices in Live` +
      (state.follow ? " · following Live's selection" : "") : "No Pung device in your Live Set yet";
    let want = state.dev;
    if (state.follow && selected >= 0) want = selected;
    if (!state.devices.some((d) => d.n === want)) want = state.devices.length ? state.devices[0].n : -1;
    if (want !== state.dev) selectDevice(want, false);
    renderDevices();
  }

  function renderDevices() {
    const nav = $("slots");
    nav.innerHTML = "";
    state.devices.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dev";
      b.setAttribute("aria-current", d.n === state.dev ? "true" : "false");
      b.innerHTML = `${esc(d.name)}${d.track ? `<span class="where">${esc(d.track)}</span>` : ""}`;
      b.title = d.selected ? "Selected in Live" : "";
      b.onclick = () => { state.follow = false; selectDevice(d.n, true); };
      nav.appendChild(b);
    });
  }

  function selectDevice(n, user) {
    const d = state.devices.find((x) => x.n === n);
    state.dev = n;
    state.base = `/api/devices/${n}`;
    state.comp = d ? d.component : "synth";
    if (n >= 0) loadPanel();
    if (user) renderDevices();
  }

  function renderSlots() {
    const nav = $("slots");
    nav.innerHTML = "";
    state.slots.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.style.color = s.slot === state.slot ? "#000" : SLOT_COLORS[(s.slot - 1) % 8];
      b.setAttribute("aria-current", s.slot === state.slot ? "true" : "false");
      const lvl = Math.max(0, Math.min(1, (s.peak_db + 48) / 48));
      b.innerHTML = `${s.slot}<span class="meter"><i style="width:${(lvl * 100).toFixed(0)}%"></i></span>`;
      b.title = `Track ${s.slot}: ${s.chain.synth || "no synth"}`;
      b.onclick = () => selectSlot(s.slot);
      nav.appendChild(b);
    });
  }

  function positionsOf(slot) {
    const c = slot.chain, out = [];
    c.midi_fx.forEach((m, i) => m && out.push({ kind: "midi", comp: "midi_fx" + (i + 1), n: i + 1, module: m }));
    out.push({ kind: "synth", comp: "synth", n: 1, module: c.synth });
    c.fx.forEach((m, i) => m && out.push({ kind: "fx", comp: "fx" + (i + 1), n: i + 1, module: m }));
    return out;
  }

  function moduleName(id) {
    const m = state.modules.find((x) => x.id === id);
    return m ? m.name : id;
  }

  let chainSig = "";
  function renderChain(slot) {
    const ps = positionsOf(slot);
    const sig = JSON.stringify([state.slot, state.comp, ps]);
    if (sig === chainSig) return;
    chainSig = sig;
    const row = $("chain");
    row.innerHTML = "";
    ps.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pos";
      b.style.setProperty("--k", KCOL[p.kind]);
      b.setAttribute("aria-pressed", p.comp === state.comp ? "true" : "false");
      b.innerHTML = `<span class="kind">${KIND[p.kind]}</span><span class="name">${p.module ? esc(moduleName(p.module)) : "No synth"}</span>`;
      b.onclick = () => (p.module ? selectComp(p.comp) : openPicker("swap", "sound_generator"));
      row.appendChild(b);
      const a = document.createElement("span");
      a.className = "arrow";
      a.textContent = "›";
      row.appendChild(a);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "pos add";
    add.textContent = "+ Add";
    add.onclick = () => openPicker("add", "audio_fx");
    row.appendChild(add);
  }

  function selectSlot(n) {
    state.slot = n;
    state.base = `/api/slots/${n}`;
    setSlotColor();
    state.comp = "synth";
    chainSig = "";
    refreshStatus().then(() => loadPanel());
  }

  function selectComp(comp) {
    state.comp = comp;
    chainSig = "";
    refreshStatus();
    loadPanel();
  }

  // ---- the component panel ------------------------------------------------
  // loadPanel: only the newest call draws. Two in flight (a device change and
  // the status poll) each cleared the panel, waited, then appended: the page
  // showed the module twice.
  let panelGen = 0;
  async function loadPanel() {
    const gen = ++panelGen;
    const r = await api(`${state.base}/component/${state.comp}`);
    if (gen !== panelGen) return;
    const info = (state.info = r.info || {});
    state.values = info.values || {};
    $("panel-title").textContent = info.module ? `${info.name || info.module}` : "Empty";
    const tools = $("panel-tools");
    tools.innerHTML = "";
    const body = $("panel-body");
    body.innerHTML = "";
    frame = null; frameComp = null; frameSubscribed = false;
    if (!info.module) {
      body.innerHTML = `<div class="empty">Nothing here yet. Choose a module with Swap.</div>`;
      tools.appendChild(toolButton("Choose", () => openPicker("swap", "sound_generator")));
      return;
    }
    if (state.mode === "devices") {
      // a device in Live: Live adds, removes and bypasses it; here it is edited
      tools.appendChild(toolButton(state.follow ? "Following Live" : "Follow Live", () => {
        state.follow = true; refreshStatus();
      }));
    } else {
      tools.appendChild(toolButton("Make Live MIDI track", makeTracks));
      tools.appendChild(toolButton(info.bypassed ? "Turn on" : "Bypass", toggleBypass));
      tools.appendChild(toolButton("Swap", () => openPicker("swap", info.type || "audio_fx")));
      tools.appendChild(toolButton("Remove", removeComp, true));
    }
    state.comps = null; state.shown = "";
    if (state.mode === "devices") {
      try {
        const c = await api(`${state.base}/compartments`);
        if (gen !== panelGen) return;
        state.comps = c.compartments || []; state.shown = c.shown || "";
      } catch (e) { state.comps = null; }
      if (gen !== panelGen) return;
      body.innerHTML = ""; // a call that started earlier may have drawn meanwhile
    }
    if (info.web_ui) {
      // the compartments as a strip over the module's own page: the screen
      // the Push shows is marked, and a click turns the Push to another
      if (state.comps && state.comps.length) body.appendChild(compartmentStrip());
      // the module's own page, unmodified, in a sandbox
      frame = document.createElement("iframe");
      frame.className = "frame";
      frame.setAttribute("sandbox", "allow-scripts allow-forms");
      frame.title = `${info.name} panel`;
      frame.src = `/modules/${encodeURIComponent(info.module)}/web_ui.html?component=${encodeURIComponent(state.comp)}`;
      frameComp = state.comp;
      body.appendChild(frame);
    } else {
      body.appendChild(buildControls(info));
    }
  }

  function toolButton(text, fn, danger) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tool" + (danger ? " danger" : "");
    b.textContent = text;
    b.onclick = fn;
    return b;
  }

  // banks from ui_hierarchy, else the chain_params order
  function banksOf(info) {
    const cp = info.chain_params || [];
    const byKey = Object.fromEntries(cp.map((p) => [p.key, p]));
    const levels = info.hierarchy && info.hierarchy.levels;
    const banks = [];
    const keysOf = (l) => (l.knobs || l.params || []).map((x) => (typeof x === "string" ? x : x && x.key)).filter(Boolean);
    if (levels && levels.root) {
      const root = levels.root;
      if (root.knobs) banks.push({ name: "Main", keys: keysOf({ knobs: root.knobs }) });
      (root.params || []).forEach((x) => {
        if (x && x.level && levels[x.level]) banks.push({ name: x.label || x.level, keys: keysOf(levels[x.level]) });
      });
    }
    const seen = new Set(banks.flatMap((b) => b.keys));
    const rest = cp.map((p) => p.key).filter((k) => !seen.has(k));
    if (rest.length) banks.push({ name: banks.length ? "More" : "Parameters", keys: rest });
    return { banks, byKey };
  }

  // ---- compartments: one screen on the Push = one section here ---------------
  function compartmentStrip() {
    const nav = document.createElement("nav");
    nav.className = "compartments";
    nav.setAttribute("aria-label", "Compartments");
    state.comps.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.compartment = c.id;
      b.textContent = c.label + (c.custom ? " ◆" : "");
      b.title = c.custom ? "Has its own screen on the Push" : "";
      b.onclick = () => showOnPush(c.id);
      nav.appendChild(b);
    });
    markShown();
    return nav;
  }
  async function showOnPush(id) {
    const r = await post(`${state.base}/compartment`, { id });
    if (r && r.shown) { state.shown = id; markShown(); }
  }
  function markShown() {
    document.querySelectorAll("[data-compartment]").forEach((el) => {
      const on = el.dataset.compartment === state.shown;
      el.classList.toggle("shown", on);
      if (el.tagName === "BUTTON") el.setAttribute("aria-current", on ? "true" : "false");
    });
  }
  // the Push turned to another compartment: follow it here, and tell the
  // module's own page (it may show the same section: {type:"compartment"})
  async function refreshCompartment() {
    if (state.mode !== "devices" || !state.comps || document.hidden) return;
    let c;
    try { c = await api(`${state.base}/compartments`); } catch (e) { return; }
    if ((c.shown || "") === state.shown) return;
    state.shown = c.shown || "";
    markShown();
    const sec = document.querySelector(`.bank[data-compartment="${CSS.escape(state.shown)}"]`);
    if (sec) sec.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const comp = state.comps.find((x) => x.id === state.shown);
    if (frame && comp) toFrame({ type: "compartment", id: comp.id, label: comp.label, keys: comp.keys });
  }

  function buildControls(info) {
    const wrap = document.createElement("div");
    let { banks, byKey } = banksOf(info);
    if (state.comps && state.comps.length) {
      // the module's compartments, as the Push shows them
      banks = state.comps.map((c) => ({ name: c.label, keys: c.keys, id: c.id, custom: c.custom, takeover: c.takeover }));
      const seen = new Set(banks.flatMap((b) => b.keys));
      const rest = (info.chain_params || []).map((p) => p.key).filter((k) => !seen.has(k));
      if (rest.length) banks.push({ name: "More", keys: rest });
    }
    if (!banks.length) {
      wrap.innerHTML = `<div class="empty">This module publishes no parameters.</div>`;
      return wrap;
    }
    banks.forEach((b) => {
      const sec = document.createElement("div");
      sec.className = "bank";
      if (b.id) {
        // a compartment: its title turns the Push to it
        sec.dataset.compartment = b.id;
        const h = document.createElement("h3");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "comp-title";
        btn.textContent = b.name + (b.custom ? " ◆" : "");
        btn.title = "Show on the Push";
        btn.onclick = () => showOnPush(b.id);
        h.appendChild(btn);
        sec.appendChild(h);
      } else {
        sec.innerHTML = `<h3>${esc(b.name)}</h3>`;
      }
      // a compartment with its own screen on the Push: the same screen here,
      // drawn by the same code from this device's values (UX-GUIDELINES 1.2)
      if (b.id && b.custom) {
        const img = document.createElement("img");
        img.className = "screen" + (b.takeover ? " takeover" : "");
        img.alt = `${b.name}, as the Push shows it`;
        img.title = "Show on the Push";
        img.dataset.compartment = b.id;
        img.src = screenURL(b.id);
        img.onclick = () => showOnPush(b.id);
        sec.appendChild(img);
      }
      const grid = document.createElement("div");
      grid.className = "grid";
      // an envelope among the keys is drawn over its own controls, as on
      // the Push (visuals.js); the rest are plain controls, in order
      const groups = window.PungVisuals ? PungVisuals.envelopeGroups(b.keys) : [];
      for (let i = 0; i < b.keys.length; i++) {
        const g = groups.find((x) => x.start === i);
        if (!g) {
          if (byKey[b.keys[i]]) grid.appendChild(control(byKey[b.keys[i]]));
          continue;
        }
        grid.appendChild(envelopeCard(g, b.keys.slice(g.start, g.end), byKey));
        i = g.end - 1;
      }
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });
    setTimeout(markShown, 0);
    return wrap;
  }

  function screenURL(id) { return `${state.base}/compartments/${encodeURIComponent(id)}/screen.png?t=${Date.now()}`; }
  // the screens follow the values; one request at a time per screen
  function refreshScreens() {
    document.querySelectorAll("img.screen").forEach((img) => {
      if (img.dataset.loading) return;
      img.dataset.loading = "1";
      const next = new Image();
      next.onload = () => { img.src = next.src; delete img.dataset.loading; };
      next.onerror = () => { delete img.dataset.loading; };
      next.src = screenURL(img.dataset.compartment);
    });
  }

  // an envelope and its controls, one card spanning the row
  function envelopeCard(g, keys, byKey) {
    const card = document.createElement("div");
    card.className = "envcard";
    const full = (k) => `${state.comp}:${k}`;
    const fig = PungVisuals.figure(g, {
      meta: (k) => byKey[k],
      value: (k) => state.values[full(k)],
      set: (k, v) => { setParam(full(k), v); syncControl(full(k), v, true); },
      label: (k) => `${(byKey[k] && (byKey[k].name || k)) || k} ${byKey[k] ? fmt(byKey[k], state.values[full(k)]) : ""}`,
    });
    card.appendChild(fig.el);
    const row = document.createElement("div");
    row.className = "envrow";
    row.style.setProperty("--n", keys.length);
    keys.forEach((k) => {
      if (!byKey[k]) return;
      const c = control(byKey[k]);
      // the stage under the hand is the stage drawn hot, as an encoder's touch on the Push
      ["pointerenter", "focusin"].forEach((t) => c.addEventListener(t, () => fig.touch(k)));
      ["pointerleave", "focusout"].forEach((t) => c.addEventListener(t, () => fig.touch("")));
      row.appendChild(c);
    });
    card.appendChild(row);
    return card;
  }

  // syncControl: a control shows a value that changed elsewhere (the Push,
  // a dragged handle). A control being edited keeps its own, unless forced.
  function syncControl(k, v, force) {
    const el = document.querySelector(`.ctl[data-key="${CSS.escape(k)}"]`);
    if (!el || (!force && el.contains(document.activeElement))) return;
    const p = (state.info.chain_params || []).find((x) => `${state.comp}:${x.key}` === k);
    const input = el.querySelector("input,select");
    if (input && input.tagName === "INPUT") { input.value = v; const o = el.querySelector("output"); if (o && p) o.textContent = fmt(p, v); }
    else if (input && p) { const asIndex = /^\s*\d+\s*$/.test(v); input.value = String(asIndex ? parseInt(v, 10) : (p.options || []).indexOf(v)); }
  }

  function fmt(p, v) {
    if (v === undefined || v === null) return "--";
    if (p.type === "enum") {
      const i = parseInt(v, 10);
      return !isNaN(i) && p.options && p.options[i] !== undefined && String(i) === String(v).trim() ? p.options[i] : v;
    }
    let f = parseFloat(v);
    if (isNaN(f)) return v;
    if (p.unit === "%" && p.max <= 1.0001) f *= 100;
    const s = p.type === "int" ? String(Math.round(f)) : Math.abs(f) >= 100 || p.unit === "%" ? f.toFixed(0) : f.toFixed(2);
    return s + (p.unit ? " " + p.unit : "");
  }

  function control(p) {
    const key = `${state.comp}:${p.key}`;
    const d = document.createElement("div");
    d.className = "ctl";
    const id = "c_" + key.replace(/[^a-z0-9]/gi, "_");
    const v = state.values[key];
    if (p.type === "enum" && p.options) {
      d.innerHTML = `<label for="${id}">${esc(p.name || p.key)}</label>`;
      const s = document.createElement("select");
      s.id = id;
      p.options.forEach((o, i) => s.add(new Option(o, String(i))));
      const asIndex = /^\s*\d+\s*$/.test(v || "");
      const idx = asIndex ? parseInt(v, 10) : p.options.indexOf(v);
      if (idx >= 0) s.value = String(idx);
      s.onchange = () => setParam(key, asIndex || v === undefined ? s.value : p.options[parseInt(s.value, 10)]);
      d.appendChild(s);
    } else {
      d.innerHTML = `<label for="${id}">${esc(p.name || p.key)} <output id="${id}_o">${esc(fmt(p, v))}</output></label>`;
      const r = document.createElement("input");
      r.type = "range";
      r.id = id;
      r.min = p.min ?? 0; r.max = p.max ?? 1;
      r.step = p.step || (p.type === "int" ? 1 : ((p.max ?? 1) - (p.min ?? 0)) / 200);
      if (v !== undefined) r.value = v;
      r.oninput = () => { $(id + "_o").textContent = fmt(p, r.value); setParam(key, r.value); };
      d.appendChild(r);
    }
    d.dataset.key = key;
    return d;
  }

  let pending = {}, sendTimer = null;
  function setParam(key, value) {
    state.values[key] = String(value);
    pending[key] = String(value);
    if (window.PungVisuals) PungVisuals.redrawAll();
    if (!sendTimer) sendTimer = setTimeout(flush, 40); // a dragged slider sends ~25 writes a second
  }
  function flush() {
    sendTimer = null;
    const batch = pending;
    pending = {};
    Promise.all(Object.entries(batch).map(([key, value]) => post(`${state.base}/param`, { key, value }))).then(refreshScreens);
  }

  async function makeTracks() {
    $("health").textContent = "asking Live...";
    const r = await post(`${state.base}/tracks`, {});
    $("health").textContent = r.ok ? `MIDI track "Pung ${state.slot}" is ready. Now make an audio track by hand: input PushHack, channel Pung ${state.slot}, Monitor In.` : r.error;
  }

  async function toggleBypass() {
    await post(`${state.base}/param`, { key: `${state.comp}:bypassed`, value: state.info.bypassed ? "0" : "1" });
    chainSig = "";
    await refreshStatus();
    loadPanel();
  }

  async function removeComp() {
    const c = state.comp;
    if (c === "synth") await post(`${state.base}/param`, { key: "synth:module", value: "" });
    else if (c.startsWith("midi_fx")) await post(`${state.base}/param`, { key: "midi_fx:remove", value: c.slice(7) });
    else await post(`${state.base}/param`, { key: "fx:remove", value: c.slice(2) });
    state.comp = "synth";
    chainSig = "";
    await refreshStatus();
    loadPanel();
  }

  // live values: changes from the Push encoders reach the page and the iframe
  async function refreshValues() {
    if (!state.info || !state.info.module || document.hidden) return;
    let r;
    try { r = await api(`${state.base}/component/${state.comp}/values`); } catch (e) { return; }
    const changed = {};
    Object.entries(r.values || {}).forEach(([k, v]) => {
      if (state.values[k] !== v && !(k in pending)) { state.values[k] = v; changed[k] = v; }
    });
    if (!Object.keys(changed).length) return;
    if (frame && frameSubscribed) toFrame({ type: "paramUpdate", params: changed });
    Object.entries(changed).forEach(([k, v]) => syncControl(k, v, false));
    if (window.PungVisuals) PungVisuals.redrawAll();
    refreshScreens();
  }

  // ---- the module page bridge (schwung-manager's protocol) ----------------
  function toFrame(msg) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, "*"); }

  window.addEventListener("message", (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || !m.type) return;
    const info = state.info || {};
    switch (m.type) {
      case "height": {
        const h = Number(m.height);
        if (isFinite(h) && h > 0) frame.style.height = Math.min(Math.max(Math.round(h), 200), 4000) + "px";
        break;
      }
      case "getParam":
        if (!m.id || !m.key) return;
        if (m.key in state.values) toFrame({ type: "paramResult", id: m.id, value: state.values[m.key] });
        else api(`${state.base}/param?key=${encodeURIComponent(m.key)}`).then((r) => {
          if (r.value !== null && r.value !== undefined) state.values[m.key] = r.value;
          toFrame({ type: "paramResult", id: m.id, value: r.value ?? "" });
        });
        break;
      case "setParam":
        if (m.key) setParam(m.key, m.value);
        break;
      case "subscribe":
        frameSubscribed = true;
        toFrame({ type: "paramUpdate", params: Object.assign({}, state.values) });
        break;
      case "getHierarchy":
        toFrame({ type: "hierarchy", id: m.id || null, component: frameComp, data: info.hierarchy || null });
        break;
      case "getChainParams":
        toFrame({ type: "chainParams", id: m.id || null, component: frameComp, data: info.chain_params || null });
        break;
      case "showCompartment":
        if (m.id) showOnPush(String(m.id));
        break;
      case "resubscribe":
        api(`${state.base}/component/${state.comp}/values`).then((r) => {
          Object.assign(state.values, r.values || {});
          toFrame({ type: "paramUpdate", params: r.values || {} });
        });
        break;
    }
  });

  // ---- module picker ------------------------------------------------------
  function openPicker(mode, kind) {
    pickerMode = mode;
    $("picker").hidden = false;
    $("picker-title").textContent = mode === "swap" ? "Replace this module" : "Add a module";
    setPickerKind(kind);
    $("picker").scrollIntoView({ block: "nearest" });
  }

  function setPickerKind(kind) {
    pickerKind = kind;
    document.querySelectorAll(".kinds button").forEach((b) => b.setAttribute("aria-selected", b.dataset.kind === kind ? "true" : "false"));
    const cards = $("picker-cards");
    cards.innerHTML = "";
    const list = state.modules.filter((m) => m.type === kind && m.loadable);
    if (!list.length) cards.innerHTML = `<div class="empty">No modules of this kind are installed.</div>`;
    list.forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "card";
      b.innerHTML = `<b>${esc(m.name)}</b><span>${esc(m.author || "")}</span><span>${esc(m.version || "")}</span>`;
      b.onclick = () => choose(m);
      cards.appendChild(b);
    });
  }

  async function choose(m) {
    const slot = state.slots.find((s) => s.slot === state.slot);
    const c = slot.chain;
    const used = (list) => list.filter(Boolean).length;
    let key, at, comp;
    if (m.type === "sound_generator") { key = "synth:module"; comp = "synth"; }
    else if (pickerMode === "swap" && kindOfComp(state.comp) === m.type) { key = `${state.comp}:module`; comp = state.comp; }
    else if (m.type === "audio_fx") { at = used(c.fx) + 1; key = `fx${at}:module`; comp = `fx${at}`; }
    else { at = used(c.midi_fx) + 1; key = `midi_fx${at}:module`; comp = `midi_fx${at}`; }
    if (at > 8) { alertBox("The chain is full."); return; }
    await post(`${state.base}/param`, { key, value: m.id });
    $("picker").hidden = true;
    state.comp = comp;
    chainSig = "";
    await refreshStatus();
    loadPanel();
  }

  function kindOfComp(c) { return c === "synth" ? "sound_generator" : c.startsWith("midi_fx") ? "midi_fx" : "audio_fx"; }
  function alertBox(t) { $("health").textContent = t; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  document.querySelectorAll(".kinds button").forEach((b) => (b.onclick = () => setPickerKind(b.dataset.kind)));
  $("picker-close").onclick = () => ($("picker").hidden = true);

  async function boot() {
    setSlotColor();
    try { state.modules = (await api("/api/modules")).modules || []; } catch (e) { /* the status line says why */ }
    await refreshStatus();
    loadPanel();
    setInterval(refreshStatus, 1000);
    setInterval(refreshValues, 350);
    setInterval(refreshCompartment, 500);
  }
  boot();
})();
