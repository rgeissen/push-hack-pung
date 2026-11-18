/* Pung on Push: the web page, the Devices view.
 *
 * A Pung device in Live is a unit in a rack here: its name and where it
 * comes from, its sound, and its compartments, one at a time, as the Push
 * shows them. Each compartment is its Push screen and its encoders' controls,
 * eight to a row.
 *
 * It is also the PARENT of a module's own web_ui.html: the iframe includes
 * /static/schwung-remote-api.js (schwung-manager's, unmodified) and talks
 * postMessage to this page. The protocol below answers it exactly as
 * schwung-manager's remote-ui.js does. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KIND = { instrument: "Instrument", effect: "Audio effect", audio_fx: "Audio effect", midi_fx: "MIDI effect", midi: "MIDI effect" };
  const ORIGIN = { pung: "Pung native", schwung: "Schwung" };
  const ORIGIN_TIP = {
    pung: "Written for the Push alone",
    schwung: "Built from a Schwung module for Ableton Move",
  };

  let state = { comp: "synth", info: null, values: {}, base: "", devices: [], dev: -1, follow: true,
                comps: null, enabled: null, shown: "", pics: {}, status: null };
  let frame = null, frameComp = null, frameSubscribed = false;

  const api = (path, opts) => fetch(path, opts).then((r) => r.json());
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // ---- a word to the user, where the hands are ---------------------------------
  let toastTimer = null;
  function toast(text, bad) {
    const t = $("toast");
    t.textContent = text;
    t.className = "toast" + (bad ? " bad" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), bad ? 7000 : 3500);
  }
  window.PungToast = toast;

  // a question that needs a yes: asked in the page, never by the browser's box
  window.PungConfirm = (text, yes, danger) => new Promise((done) => {
    const dlg = $("confirm"), ok = $("confirm-yes"), no = $("confirm-no");
    $("confirm-text").textContent = text;
    ok.textContent = yes || "OK";
    ok.className = "btn " + (danger ? "danger" : "primary");
    const end = (v) => { dlg.removeEventListener("close", onClose); ok.onclick = no.onclick = null; if (dlg.open) dlg.close(); done(v); };
    const onClose = () => end(false);
    dlg.addEventListener("close", onClose);
    ok.onclick = () => end(true);
    no.onclick = () => end(false);
    dlg.showModal();
    no.focus();
  });

  // ---- status: Pung, Live, the devices ------------------------------------------
  async function refreshStatus() {
    let st;
    try { st = await api("/api/status"); } catch (e) {
      $("health").innerHTML = `<span class="row"><i class="led bad"></i>Pung is not answering</span>`;
      // twice in a row: one missed answer is a restart passing by, not an outage
      state.missed = (state.missed || 0) + 1;
      if (state.missed >= 2) { $("offline").hidden = false; document.body.classList.add("down"); }
      return;
    }
    state.missed = 0;
    $("offline").hidden = true; document.body.classList.remove("down");
    state.status = st;
    $("rail-version").textContent = st.version ? "v" + st.version : "";
    let dv = { devices: [], selected: -1 };
    try { dv = await api("/api/pung-devices"); } catch (e) { /* an older Pung */ }
    state.devices = dv.devices || [];
    const n = state.devices.length;
    const e = st.engine || {};
    const load = e.budget_us ? Math.round((e.avg_us / e.budget_us) * 100) : 0;
    $("health").innerHTML =
      `<span class="row"><i class="led on"></i>Pung running</span>` +
      `<span class="row"><i class="led ${n ? "on" : ""}"></i>${n ? n + " device" + (n > 1 ? "s" : "") + " in Live" : "No device in Live"}</span>` +
      (load ? `<span class="row"><i class="led ${load > 80 ? "warn" : "on"}"></i>Engine ${load}%</span>` : "");
    const cnt = $("view-devices-count");
    cnt.textContent = n || ""; cnt.hidden = !n;
    renderSystem(st);
    let want = state.dev;
    if (state.follow && dv.selected >= 0) want = dv.selected;
    if (!state.devices.some((d) => d.n === want)) want = n ? state.devices[0].n : -1;
    if (want !== state.dev) selectDevice(want);
    renderRack();
    $("no-devices").hidden = n > 0;
    $("unit").hidden = n === 0;
    if (!n) window.dispatchEvent(new CustomEvent("pung:device", { detail: { n: -1, mode: "devices" } }));
  }

  function renderSystem(st) {
    const el = $("sys-facts");
    if (!el) return;
    const e = st.engine || {};
    const rows = [
      ["Version", st.version || "?"],
      ["Devices in Live", String(state.devices.length)],
      ["Audio", e.rate ? `${e.rate} Hz, ${e.period} frames a block` : "?"],
      ["Web page", location.host],
    ];
    el.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  }

  // ---- the rack: one unit per device ----------------------------------------------
  let rackSig = "";
  function renderRack() {
    const nav = $("slots");
    const sig = JSON.stringify(state.devices.map((d) => [d.n, d.name, d.track, d.origin, d.selected, d.n === state.dev]));
    if (sig !== rackSig) {
      rackSig = sig;
      nav.innerHTML = "";
      state.devices.forEach((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dev";
        b.dataset.n = d.n;
        b.dataset.name = d.name;
        b.setAttribute("aria-current", d.n === state.dev ? "true" : "false");
        const o = d.origin === "pung" ? "pung" : "schwung";
        b.innerHTML = `<span class="meter" aria-hidden="true">${"<i></i>".repeat(6)}</span>` +
          `<span class="nm">${esc(d.name)}</span>` +
          `<span class="sub"><i class="dot ${o}" title="${esc(ORIGIN[o])}"></i><span class="where">${esc(d.track || KIND[d.kind] || "")}</span>` +
          (d.selected ? `<span class="sel" title="Selected in Live">● Live</span>` : "") + `</span>`;
        b.setAttribute("aria-label", `${d.name}, ${ORIGIN[o]}${d.track ? ", on " + d.track : ""}${d.selected ? ", selected in Live" : ""}`);
        b.onclick = () => { setFollow(false); selectDevice(d.n); renderRack(); };
        nav.appendChild(b);
      });
    }
    // the meters: how loud each device is now
    state.devices.forEach((d) => {
      const b = nav.querySelector(`.dev[data-n="${d.n}"]`);
      if (!b) return;
      const lit = Math.max(0, Math.min(6, Math.round(((d.peak_db ?? -120) + 48) / 8)));
      b.querySelectorAll(".meter i").forEach((seg, i) => seg.classList.toggle("on", i < lit));
    });
  }

  function setFollow(on) {
    state.follow = on;
    $("follow-live").checked = on;
  }

  function selectDevice(n) {
    const d = state.devices.find((x) => x.n === n);
    state.dev = n;
    state.base = `/api/devices/${n}`;
    state.comp = d ? d.component : "synth";
    closeDrawer();
    // the sound browser (sounds.js) follows the device shown
    window.dispatchEvent(new CustomEvent("pung:device", { detail: { n, mode: "devices", name: d ? d.name : "" } }));
    if (n >= 0) loadPanel();
  }

  // ---- the sound, live: one stream per open panel (GET <base>/live) ----------------
  // Frames arrive about 30 times a second while the sound moves and now and
  // then while it rests; the server drops a frame the page is too slow for.
  // Only the pictures of the compartment shown are asked for, only while the
  // page is visible; a module's own page gets each frame as {type:"live"}.
  let liveES = null, liveURL = "";
  function liveConnect() {
    const info = state.info || {};
    let url = "";
    if (!document.hidden && info.module && state.base && document.body.dataset.view === "devices") {
      const pics = {};
      Object.entries(state.pics || {}).forEach(([k, p]) => {
        if (!p.section || !state.enabled || state.enabled.has(p.section)) pics[k] = { kind: p.kind, keys: p.keys };
      });
      const keys = frame ? [...new Set((state.comps || []).flatMap((c) => c.live_keys || []))] : [];
      if (Object.keys(pics).length || keys.length) {
        url = `${state.base}/live?comp=${encodeURIComponent(state.comp)}&pics=${encodeURIComponent(JSON.stringify(pics))}&keys=${encodeURIComponent(keys.join(","))}`;
      }
    }
    if (url === liveURL && liveES) return;
    if (liveES) { liveES.close(); liveES = null; }
    liveURL = url;
    if (!url) return;
    liveES = new EventSource(url);
    liveES.onmessage = (e) => {
      let f;
      try { f = JSON.parse(e.data); } catch (err) { return; }
      if (window.PungVisuals) PungVisuals.live(f);
      if (frame && frameSubscribed) toFrame({ type: "live", frame: f });
    };
  }
  document.addEventListener("visibilitychange", liveConnect);
  window.addEventListener("pung:view", liveConnect);

  // ---- the unit ----------------------------------------------------------------------
  // loadPanel: only the newest call draws. Two in flight (a device change and
  // the status poll) each cleared the panel, waited, then appended: the page
  // showed the module twice.
  let panelGen = 0;
  async function loadPanel() {
    state.pics = {};
    liveConnect(); // the last panel's stream ends
    const gen = ++panelGen;
    let r;
    try { r = await api(`${state.base}/component/${state.comp}`); } catch (e) { return; }
    if (gen !== panelGen) return;
    const info = (state.info = r.info || {});
    state.values = info.values || {};
    const d = state.devices.find((x) => x.n === state.dev) || {};
    const o = d.origin === "pung" ? "pung" : "schwung";
    const at = state.devices.findIndex((x) => x.n === state.dev);
    $("unit-kicker").textContent = `Device ${String(at + 1).padStart(2, "0")} · ${KIND[d.kind] || KIND[info.type] || "Device"}${d.track ? " · " + d.track : ""}`;
    $("panel-title").textContent = info.module ? `${info.name || info.module}` : "Empty";
    $("unit-meta").innerHTML = info.module
      ? `<span class="origin ${o}" title="${esc(ORIGIN_TIP[o])}">${esc(ORIGIN[o])}</span>` +
        `<span>${esc(info.module)}${d.version ? " · v" + esc(String(d.version).replace(/^v/, "")) : ""}</span>` +
        (d.author ? `<span>${esc(d.author)}</span>` : "")
      : "";
    const body = $("panel-body");
    body.innerHTML = "";
    frame = null; frameComp = null; frameSubscribed = false;
    if (!info.module) {
      body.innerHTML = `<div class="bank"><div class="empty">This device holds no module.</div></div>`;
      return;
    }
    state.comps = null; state.shown = "";
    try {
      const c = await api(`${state.base}/compartments`);
      if (gen !== panelGen) return;
      state.comps = c.compartments || []; state.shown = c.shown || "";
    } catch (e) { state.comps = null; }
    if (gen !== panelGen) return;
    body.innerHTML = ""; // a call that started earlier may have drawn meanwhile
    if (state.comps && state.comps.length > 1) body.appendChild(compartmentTabs());
    else loadEnabled();
    if (info.web_ui) {
      // the module's own page, unmodified, in a sandbox
      frame = document.createElement("iframe");
      frame.className = "frame";
      frame.setAttribute("sandbox", "allow-scripts allow-forms");
      frame.title = `${info.name} panel`;
      frame.src = `/modules/${encodeURIComponent(info.module)}/web_ui.html?component=${encodeURIComponent(state.comp)}`;
      frameComp = state.comp;
      body.appendChild(frame);
      frame.addEventListener("load", applyEnabled); // the page is told which are on
    } else {
      body.appendChild(buildControls(info));
    }
    applyEnabled();
    markShown();
    liveConnect();
  }

  // banks from ui_hierarchy, else the chain_params order (a module with no compartments)
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

  // ---- compartments: one screen on the Push = one tab here ------------------------
  // A tab shows its compartment alone, as the Push shows one screen at a
  // time, and turns the Push to it (when the Push shows this device). "All"
  // lays every compartment out in one long page. The choice is remembered
  // per module, in this browser. A lit square marks the tab the Push shows.
  // The module's own page is told which are on ({type:"compartments"}).
  const compKey = () => `pung.comps.${(state.info && state.info.module) || ""}`;
  function loadEnabled() {
    const all = (state.comps || []).map((c) => c.id);
    let ids = null;
    try { ids = JSON.parse(localStorage.getItem(compKey()) || "null"); } catch (e) { /* none kept */ }
    ids = Array.isArray(ids) ? ids.filter((i) => all.includes(i)) : null;
    if (!ids || !ids.length) ids = all.length > 1 ? [all.includes(state.shown) ? state.shown : all[0]] : all;
    if (ids.length !== 1 && ids.length !== all.length) ids = [ids[0]]; // one, or all
    state.enabled = new Set(ids);
  }
  function saveEnabled() {
    try { localStorage.setItem(compKey(), JSON.stringify([...state.enabled])); } catch (e) { /* kept for this visit only */ }
  }
  function compartmentTabs() {
    loadEnabled();
    const nav = document.createElement("nav");
    nav.className = "compartments";
    nav.setAttribute("aria-label", "Compartments: the device's screens");
    state.comps.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.compartment = c.id;
      b.innerHTML = `<span class="ix">${String(i + 1).padStart(2, "0")}</span><span>${esc(c.label)}</span>` +
        (c.custom ? `<i class="scr" title="Has its own screen on the Push"></i>` : "") + `<i class="onpush" aria-hidden="true"></i>`;
      b.onclick = () => setEnabled([c.id], true);
      nav.appendChild(b);
    });
    const all = document.createElement("button");
    all.type = "button";
    all.className = "all";
    all.textContent = "All";
    all.title = "Every compartment on one page";
    all.onclick = () => setEnabled(state.comps.map((c) => c.id), true);
    nav.appendChild(all);
    return nav;
  }
  function setEnabled(ids, fromHere) {
    state.enabled = new Set(ids);
    saveEnabled();
    applyEnabled();
    if (state.enabled.size === 1) {
      const id = ids[0];
      if (fromHere) {
        // chosen here: the Push turns to it, when it shows this device
        post(`${state.base}/compartment`, { id }).then((r) => {
          if (r && r.ok && r.shown) { state.shown = id; markShown(); }
        }).catch(() => {});
      }
      showHere(id);
    }
  }
  function applyEnabled() {
    if (!state.comps || !state.enabled) return;
    const allOn = state.enabled.size === state.comps.length && state.comps.length > 1;
    document.querySelectorAll(".compartments button[data-compartment]").forEach((b) =>
      b.setAttribute("aria-pressed", !allOn && state.enabled.has(b.dataset.compartment) ? "true" : "false"));
    const allBtn = document.querySelector(".compartments .all");
    if (allBtn) allBtn.setAttribute("aria-pressed", allOn ? "true" : "false");
    // a section without a compartment ("More") only with every one on
    document.querySelectorAll(".bank").forEach((sec) => {
      const id = sec.dataset.compartment;
      sec.hidden = id ? !state.enabled.has(id) : !(allOn || state.comps.length <= 1);
    });
    if (frame) toFrame({ type: "compartments", enabled: [...state.enabled] });
    liveConnect();
    if (window.PungVisuals) PungVisuals.redrawAll();
    refreshScreens();
  }
  // showOnPush: the Push turns to a compartment (when it shows this device)
  async function showOnPush(id) {
    showHere(id);
    let r = null;
    try { r = await post(`${state.base}/compartment`, { id }); } catch (e) { /* said below */ }
    const c = (state.comps || []).find((x) => x.id === id);
    if (r && r.ok && r.shown) { state.shown = id; markShown(); toast(`The Push shows ${c ? c.label : "it"} now.`); }
    else if (r && r.ok) toast(`The Push is not showing this device in the Pung view. Open it there, and it turns to ${c ? c.label : "this screen"}.`);
    else toast("Pung did not answer.", true);
  }
  function showHere(id) {
    const comp = (state.comps || []).find((x) => x.id === id);
    if (frame && comp) toFrame({ type: "compartment", id: comp.id, label: comp.label, keys: comp.keys });
    const tab = document.querySelector(`.compartments button[data-compartment="${CSS.escape(id)}"]`);
    if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function markShown() {
    document.querySelectorAll("[data-compartment]").forEach((el) => {
      const on = el.dataset.compartment === state.shown;
      el.classList.toggle("shown", on);
      if (el.tagName === "BUTTON" && el.parentElement.classList.contains("compartments")) el.title = on ? "On the Push now" : "";
    });
  }
  // the Push turned to another compartment: the page follows it (one tab at
  // a time), and tells the module's own page ({type:"compartment"})
  async function refreshCompartment() {
    if (!state.comps || document.hidden || document.body.dataset.view !== "devices") return;
    let c;
    try { c = await api(`${state.base}/compartments`); } catch (e) { return; }
    // the Push shows no compartment of this device (another device is on
    // it): the page keeps the one chosen here
    if ((c.shown || "") === state.shown) return;
    state.shown = c.shown || "";
    markShown();
    if (!c.shown) return; // the Push shows something else now: the page stays where it is
    if (state.enabled && state.enabled.size === 1 && !state.enabled.has(c.shown) && !document.querySelector("#panel-body :focus")) setEnabled([c.shown], false);
    else showHere(state.shown);
  }

  // ---- a compartment: its screen, and its controls by encoder page ------------------
  function buildControls(info) {
    const wrap = document.createElement("div");
    let { banks, byKey } = banksOf(info);
    if (state.comps && state.comps.length) {
      // the module's compartments, as the Push shows them
      banks = state.comps.map((c) => ({ name: c.label, keys: c.keys, id: c.id, custom: c.custom, takeover: c.takeover, pages: c.pages }));
      const seen = new Set(banks.flatMap((b) => b.keys));
      const rest = (info.chain_params || []).map((p) => p.key).filter((k) => !seen.has(k));
      if (rest.length) banks.push({ name: "More", keys: rest });
    }
    if (!banks.length) {
      wrap.innerHTML = `<div class="bank"><div class="empty">This module publishes no parameters.</div></div>`;
      return wrap;
    }
    state.pics = {};
    banks.forEach((b, bi) => {
      const sec = document.createElement("section");
      sec.className = "bank";
      if (b.id) sec.dataset.compartment = b.id;
      const head = document.createElement("div");
      head.className = "bank-head";
      head.innerHTML = `<span class="ix">${String(bi + 1).padStart(2, "0")}</span><h3>${esc(b.name)}</h3>` +
        (b.takeover ? `<span class="chip" title="On the Push this screen fills the whole display">Full screen</span>` :
         b.custom ? `<span class="chip" title="This compartment has its own screen on the Push">Own screen</span>` : "") +
        `<span class="chip live">On the Push now</span>`;
      if (b.id) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn small";
        btn.textContent = "Show on Push";
        btn.onclick = () => showOnPush(b.id);
        head.appendChild(btn);
      }
      sec.appendChild(head);
      // a compartment with its own screen on the Push: the same screen here,
      // drawn by the same code from this device's values (UX-GUIDELINES 1.2)
      if (b.id && b.custom) sec.appendChild(screenBox(b, -1));
      // the encoder pages, eight controls to a row, in the Push's order
      let pages = (b.pages && b.pages.length) ? b.pages.map((p) => ({ label: p.label, keys: p.keys || [], screen: !!p.screen })) : [];
      if (!pages.length) for (let i = 0; i < b.keys.length; i += 8) pages.push({ label: "", keys: b.keys.slice(i, i + 8) });
      const named = pages.length > 1;
      pages.forEach((pg, pi) => {
        const keys = pg.keys.filter((k) => byKey[k]);
        if (!keys.length) return;
        const pe = document.createElement("div");
        pe.className = "page";
        if (named) pe.innerHTML = `<p class="pg-label">${esc(pg.label || "Page " + (pi + 1))}</p>`;
        // a page with a screen of its own on the Push (Nodal Red's Morph): that screen
        if (b.id && pg.screen) pe.appendChild(screenBox(b, pi));
        const grid = document.createElement("div");
        grid.className = "grid";
        // an envelope among the keys is drawn over its own controls, as on
        // the Push (visuals.js); the rest are plain controls, in order. A
        // compartment with its own screen keeps that screen as its picture.
        const groups = window.PungVisuals && !b.custom && !pg.screen ? PungVisuals.pictureGroups(keys) : [];
        let cells = 0;
        for (let i = 0; i < keys.length; i++) {
          const g = groups.find((x) => x.start === i);
          if (!g) { grid.appendChild(control(byKey[keys[i]])); cells++; continue; }
          // its live state comes over the page's stream (liveConnect), under this key
          const key = `w/${bi}/${pi}/${g.kind}/${g.start}`;
          state.pics[key] = { kind: g.kind, keys: g.keys, section: b.id || "" };
          grid.appendChild(envelopeCard(g, keys.slice(g.start, g.end), byKey, key));
          cells += g.end - g.start;
          i = g.end - 1;
        }
        // the row is filled to eight, so the hairlines close
        for (let i = cells % 8; i && i < 8; i++) { const f = document.createElement("div"); f.className = "ctl filler"; f.setAttribute("aria-hidden", "true"); grid.appendChild(f); }
        pe.appendChild(grid);
        sec.appendChild(pe);
      });
      wrap.appendChild(sec);
    });
    setTimeout(markShown, 0);
    return wrap;
  }

  function screenURL(id, page) { return `${state.base}/compartments/${encodeURIComponent(id)}/screen.png?t=${Date.now()}${page >= 0 ? "&page=" + page : ""}`; }
  // a screen of the Push, in its bezel; a press turns the Push to it
  function screenBox(b, page) {
    const box = document.createElement("button");
    box.type = "button";
    box.className = "screenwrap";
    box.title = "Show on the Push";
    box.setAttribute("aria-label", `${b.name}, as the Push shows it. Press to show it on the Push.`);
    const img = document.createElement("img");
    img.className = "screen" + (b.takeover && page < 0 ? " takeover" : "");
    img.alt = "";
    img.dataset.compartment = b.id;
    img.dataset.page = page;
    img.src = screenURL(b.id, page);
    box.appendChild(img);
    box.onclick = () => showOnPush(b.id);
    return box;
  }
  // the screens follow the values; one request at a time per screen, and
  // only the screens in view
  function refreshScreens() {
    document.querySelectorAll("img.screen").forEach((img) => {
      if (img.dataset.loading || img.closest("[hidden]")) return;
      img.dataset.loading = "1";
      const next = new Image();
      next.onload = () => { img.src = next.src; delete img.dataset.loading; };
      next.onerror = () => { delete img.dataset.loading; };
      next.src = screenURL(img.dataset.compartment, +(img.dataset.page ?? -1));
    });
  }

  // a picture and its controls, one card spanning their columns
  function envelopeCard(g, keys, byKey, liveKey) {
    const card = document.createElement("div");
    card.className = "envcard";
    card.style.setProperty("--n", keys.length);
    const full = (k) => `${state.comp}:${k}`;
    const fig = PungVisuals.figure(g, {
      meta: (k) => byKey[k],
      value: (k) => state.values[full(k)],
      set: (k, v) => { setParam(full(k), v); syncControl(full(k), v, true); },
      label: (k) => `${(byKey[k] && (byKey[k].name || k)) || k} ${byKey[k] ? fmt(byKey[k], state.values[full(k)]) : ""}`,
      text: (k) => (byKey[k] ? fmt(byKey[k], state.values[full(k)]) : String(state.values[full(k)] ?? "")),
    });
    fig.key = liveKey;
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

  // ---- one control -------------------------------------------------------------------
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
  // a value and its unit, the unit small
  function fmtHTML(p, v) {
    const t = String(fmt(p, v));
    if (p.unit && t.endsWith(" " + p.unit)) return `${esc(t.slice(0, -p.unit.length - 1))}<small>${esc(p.unit)}</small>`;
    return esc(t);
  }
  // an option's index, whether the module says 2 or "Saw"
  function enumIndex(p, v) {
    if (v === undefined || v === null) return -1;
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return (p.options || []).indexOf(v);
  }
  const isOnOff = (p) => p.options && p.options.length === 2 && /^off$/i.test(p.options[0]) && /^on$/i.test(p.options[1]);
  // a few short options are buttons; more, or longer ones, a list (a cell is an eighth of the row)
  const isShort = (p) => p.options && ((p.options.length <= 3 && p.options.join("").length <= 12) || (p.options.length === 4 && p.options.join("").length <= 8));
  // the fill of a slider: from the left, or from the middle for a value around zero
  function paintRange(r) {
    const min = +r.min, max = +r.max, v = +r.value;
    const at = max > min ? ((v - min) / (max - min)) * 100 : 0;
    if (min < 0 && max > 0) {
      const mid = ((0 - min) / (max - min)) * 100;
      r.style.setProperty("--f0", Math.min(at, mid) + "%");
      r.style.setProperty("--fw", Math.abs(at - mid) + "%");
    } else {
      r.style.setProperty("--f0", "0%");
      r.style.setProperty("--fw", at + "%");
    }
  }

  function control(p) {
    const key = `${state.comp}:${p.key}`;
    const d = document.createElement("div");
    d.className = "ctl";
    const id = "c_" + key.replace(/[^a-z0-9]/gi, "_");
    const v = state.values[key];
    const name = esc(p.name || p.key);
    if ((p.type === "filepath" || p.type === "file") && window.PungFiles) {
      // a file: its outline and name; a click opens the file browser (files.js)
      return PungFiles.control(p, key, v, state.base, (nv) => { state.values[key] = nv; refreshScreens(); });
    }
    d.dataset.key = key;
    d.title = p.name || p.key;
    if (p.type === "enum" && p.options && p.options.length) {
      const asIndex = () => { const cur = state.values[key]; return cur === undefined || /^\s*\d+\s*$/.test(cur); };
      const send = (i) => setParam(key, asIndex() ? String(i) : p.options[i]);
      const idx = enumIndex(p, v);
      if (isOnOff(p)) {
        d.dataset.kind = "toggle";
        d.innerHTML = `<span class="lbl" id="${id}_l">${name}</span>`;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tgl";
        b.setAttribute("aria-labelledby", `${id}_l`);
        const show = (on) => { b.setAttribute("aria-pressed", String(on)); b.innerHTML = `<i></i><span>${on ? "On" : "Off"}</span>`; };
        show(idx === 1);
        b.onclick = () => { const on = b.getAttribute("aria-pressed") !== "true"; show(on); send(on ? 1 : 0); };
        d.appendChild(b);
        d.showValue = (nv) => show(enumIndex(p, nv) === 1);
      } else if (isShort(p)) {
        d.dataset.kind = "opts";
        d.innerHTML = `<span class="lbl" id="${id}_l">${name}</span>`;
        const g = document.createElement("div");
        g.className = "opts";
        g.setAttribute("role", "group");
        g.setAttribute("aria-labelledby", `${id}_l`);
        const show = (i) => g.querySelectorAll("button").forEach((b, bi) => b.setAttribute("aria-pressed", String(bi === i)));
        p.options.forEach((o, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = o;
          b.title = o;
          b.onclick = () => { show(i); send(i); };
          g.appendChild(b);
        });
        show(idx);
        d.appendChild(g);
        d.showValue = (nv) => show(enumIndex(p, nv));
        // the module says which options can be chosen now ("1010"): the others are there, and not to press
        if (p.available_param) {
          d.dataset.avail = p.available_param;
          d.setAvail = (mask) => g.querySelectorAll("button").forEach((b, bi) => { b.disabled = mask[bi] === "0"; });
        }
      } else {
        d.dataset.kind = "select";
        d.innerHTML = `<label for="${id}">${name}</label>`;
        const s = document.createElement("select");
        s.id = id;
        p.options.forEach((o, i) => s.add(new Option(o, String(i))));
        if (idx >= 0) s.value = String(idx);
        s.onchange = () => send(parseInt(s.value, 10));
        d.appendChild(s);
        d.showValue = (nv) => { const i = enumIndex(p, nv); if (i >= 0) s.value = String(i); };
      }
      return d;
    }
    d.dataset.kind = "range";
    d.innerHTML = `<label for="${id}">${name}</label><output id="${id}_o" for="${id}">${fmtHTML(p, v)}</output>`;
    const r = document.createElement("input");
    r.type = "range";
    r.id = id;
    r.min = p.min ?? 0; r.max = p.max ?? 1;
    r.step = p.step || (p.type === "int" ? 1 : ((p.max ?? 1) - (p.min ?? 0)) / 200);
    if (v !== undefined) r.value = v;
    paintRange(r);
    const out = d.querySelector("output");
    r.oninput = () => { out.innerHTML = fmtHTML(p, r.value); paintRange(r); setParam(key, r.value); };
    // a double click puts a value around zero back to zero, as on a mixer
    if (+r.min < 0 && +r.max > 0) r.ondblclick = () => { r.value = 0; r.oninput(); };
    d.appendChild(r);
    d.showValue = (nv) => { r.value = nv; out.innerHTML = fmtHTML(p, nv); paintRange(r); };
    return d;
  }

  // syncControl: a control shows a value that changed elsewhere (the Push,
  // a dragged handle). A control being edited keeps its own, unless forced.
  // which options a control offers now: asked when a value changed, and for a control just built
  function refreshAvail(all) {
    document.querySelectorAll(".ctl[data-avail]").forEach((el) => {
      if (!all && el.dataset.availRead) return;
      el.dataset.availRead = "1";
      api(`${state.base}/param?key=${encodeURIComponent(state.comp + ":" + el.dataset.avail)}`)
        .then((r) => { if (r && typeof r.value === "string" && el.setAvail) el.setAvail(r.value); }).catch(() => {});
    });
  }
  function syncControl(k, v, force) {
    const el = document.querySelector(`.ctl[data-key="${CSS.escape(k)}"]`);
    if (!el || (!force && el.contains(document.activeElement) && el.dataset.kind === "range")) return;
    if (el.showValue) el.showValue(v);
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
    Promise.all(Object.entries(batch).map(([key, value]) => post(`${state.base}/param`, { key, value })))
      .then((rs) => {
        const bad = rs.find((r) => r && r.ok === false);
        if (bad) toast(bad.error || "The device did not take that value.", true);
        refreshScreens();
      })
      .catch(() => toast("Pung did not answer: the value was not set.", true));
  }

  // live values: changes from the Push encoders reach the page and the iframe
  async function refreshValues() {
    if (!state.info || !state.info.module || document.hidden || state.dev < 0 || document.body.dataset.view !== "devices") return;
    let r;
    try { r = await api(`${state.base}/component/${state.comp}/values`); } catch (e) { return; }
    const changed = {};
    Object.entries(r.values || {}).forEach(([k, v]) => {
      if (state.values[k] !== v && !(k in pending)) { state.values[k] = v; changed[k] = v; }
    });
    refreshAvail(Object.keys(changed).length > 0);
    if (!Object.keys(changed).length) return;
    if (frame && frameSubscribed) toFrame({ type: "paramUpdate", params: changed });
    Object.entries(changed).forEach(([k, v]) => syncControl(k, v, false));
    if (window.PungVisuals) PungVisuals.redrawAll();
    refreshScreens();
  }

  // ---- the module page bridge (schwung-manager's protocol) ---------------------------
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
        liveConnect();
        toFrame({ type: "paramUpdate", params: Object.assign({}, state.values) });
        if (state.enabled) toFrame({ type: "compartments", enabled: [...state.enabled] });
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

  // ---- the sound browser: a drawer (sounds.js fills it) --------------------------------
  let drawerFrom = null;
  function openDrawer() {
    if ($("sounds").hidden) return;
    drawerFrom = document.activeElement;
    document.body.classList.add("drawer-open");
    $("drawer-back").hidden = false;
    setTimeout(() => $("snd-list").focus(), 60);
    window.dispatchEvent(new CustomEvent("pung:drawer", { detail: { open: true } }));
  }
  function closeDrawer() {
    if (!document.body.classList.contains("drawer-open")) return;
    document.body.classList.remove("drawer-open");
    $("drawer-back").hidden = true;
    if (drawerFrom && document.contains(drawerFrom)) drawerFrom.focus();
    window.dispatchEvent(new CustomEvent("pung:drawer", { detail: { open: false } }));
  }
  window.PungDrawer = { open: openDrawer, close: closeDrawer, isOpen: () => document.body.classList.contains("drawer-open") };
  // the device's sound, as sounds.js knows it: the header says it
  window.addEventListener("pung:sound", (e) => {
    const v = e.detail && e.detail.v;
    const box = $("unit-sound");
    if (!v || (!v.factory && !v.has_state)) { box.hidden = true; closeDrawer(); return; }
    box.hidden = false;
    const f = v.factory, nm = $("unit-sound-name");
    // nothing loaded from a list yet (or its entry was deleted): the device still
    // plays the module's own sound at this place in the bank, and that has a name
    const cur = v.current && v.current.name ? v.current : f && f.name && f.index >= 0 ? { name: f.name, source: "factory" } : null;
    nm.classList.toggle("none", !cur);
    nm.innerHTML = cur ? `${v.edited ? '<span class="edited" title="Changed since it was loaded">●</span> ' : ""}${esc(cur.name)}` : "No sound chosen yet";
    nm.title = cur ? cur.name + (v.edited ? " (changed since it was loaded)" : "") : "";
    $("unit-sound-bank").textContent = cur && cur.source === "user" ? "Your sound" : f && f.bank ? f.bank + (f.count > 0 && f.index >= 0 ? ` · ${f.index + 1} of ${f.count}` : "") : f && f.count > 0 ? `${f.count} sounds` : "";
    const steps = !!(f && f.count > 1);
    $("snd-prev").disabled = !steps;
    $("snd-next").disabled = !steps;
  });

  // Pung's settings (settings.go)
  async function loadPrefs() {
    const box = $("pref-touch-card");
    if (!box) return;
    try { box.checked = !!(await api("/api/settings")).settings.touch_card; } catch (e) { return; }
    box.onchange = async () => {
      let r = { ok: false };
      try { r = await post("/api/settings", { touch_card: box.checked }); } catch (e) { /* said below */ }
      if (!r.ok) { box.checked = !box.checked; toast(r.error || "The setting could not be saved.", true); }
      else toast(box.checked ? "The detail card is on." : "The detail card is off.");
    };
  }

  async function boot() {
    $("follow-live").onchange = (e) => { state.follow = e.target.checked; if (state.follow) refreshStatus(); };
    $("snd-open").onclick = openDrawer;
    $("snd-close").onclick = closeDrawer;
    $("drawer-back").onclick = closeDrawer;
    $("snd-prev").onclick = () => window.PungSounds && PungSounds.step(-1);
    $("snd-next").onclick = () => window.PungSounds && PungSounds.step(1);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && PungDrawer.isOpen() && !e.defaultPrevented && $("snd-form").hidden) closeDrawer();
    });
    document.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const b = document.querySelector(`.views button[data-view="${a.dataset.goto}"]`);
      if (b) b.click();
    }));
    loadPrefs();
    await refreshStatus();
    setInterval(refreshStatus, 1000);
    setInterval(refreshValues, 350);
    setInterval(refreshCompartment, 500);
  }
  boot();
})();
