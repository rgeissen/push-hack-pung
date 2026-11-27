// pushlink.js: pung.live and the visitor's deployments: each a Pung that runs
// somewhere. Today that is on an Ableton Push 3; the site is made for more kinds
// of hardware, and for several of a kind (two Pushes). One list for every page: the
// Modules page installs on the one in use, Deployments shows and configures each.
//
// The word: the pages say "deployment" (the owner's, 2026-11-27: "device" is Live's word
// for what a module becomes on a track). This code still says device, and the list's
// keys in the browser (pung.devices, pung.device) stay as they are.
//
// A device is reached over the visitor's home network, never through the
// internet: an https page may talk to a device's http there once the visitor
// allows it (Local Network Access: Chrome and Edge 142 on, Firefox 151 on),
// and Pung lets only pung.live read the few calls this needs (src/sitecors.go).
//
// The list lives in this browser (localStorage): pung.live keeps nothing.
// Offered once the Pung that answers it is released (<body data-connect="1">:
// site/install.json, launched).
window.PungPush = (function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const enabled = document.body.dataset.connect === "1";
  const up = document.body.dataset.up || ""; // where the site's other pages are from here

  // the kinds of device Pung runs on: one today
  const KINDS = {
    push: { label: "Ableton Push 3", short: "Push", addr: "push.local", port: "7720",
      hint: "push.local finds it on most home networks; its IP address works too. Pung answers on port 7720; another port goes after a colon (push.local:7711)." },
  };

  // ---- the devices, kept in this browser ------------------------------------------------------
  // a device: {id, kind, addr, name, link (this browser cannot talk to it: its buttons open Pung there), was (it was connected)}
  // and, while the page is open: state (off | trying | on | lost | link), data (its catalog), version, sys, err, restarting
  const LIST = "pung.devices", USE = "pung.device";
  const fresh = (o) => Object.assign({ id: "d" + Math.random().toString(36).slice(2, 9), kind: "push", addr: "push.local", name: "", link: false, was: false,
    state: "off", data: null, version: "", sys: null, err: "", restarting: false }, o);
  let devices = [];
  try { devices = (JSON.parse(localStorage.getItem(LIST) || "[]") || []).filter((d) => d && d.addr && KINDS[d.kind || "push"]).map(fresh); } catch (e) { devices = []; }
  if (!devices.length && localStorage.getItem("pung.push") && (localStorage.getItem("pung.push.on") || localStorage.getItem("pung.push.link"))) {
    // one Push, as this site first kept it
    devices = [fresh({ addr: localStorage.getItem("pung.push"), was: !!localStorage.getItem("pung.push.on"), link: !!localStorage.getItem("pung.push.link") })];
  }
  let draft = fresh({});          // the device being added (not in the list until it answers)
  let inUse = localStorage.getItem(USE) || "";
  const save = () => {
    localStorage.setItem(LIST, JSON.stringify(devices.map((d) => ({ id: d.id, kind: d.kind, addr: d.addr, name: d.name, link: d.link, was: d.was }))));
    localStorage.setItem(USE, inUse);
  };
  // cur: the device in use (the one modules install on); none yet: the one being added
  const cur = () => devices.find((d) => d.id === inUse) || devices[0] || draft;
  const nameOf = (d) => d.name || (d.sys && d.sys.name && d.sys.name !== "localhost" ? d.sys.name : "") || "Your " + KINDS[d.kind].short;

  const subs = [];
  const changed = (what, d) => { renderChips(); renderDialog(); subs.forEach((f) => { try { f(what || "state", d); } catch (e) { /* a page's own */ } }); };

  // ---- reaching a device ----------------------------------------------------------------------
  // the address as typed: a name or an address, a port after it if not Pung's own
  function split(d) {
    const a = d.addr, port = KINDS[d.kind].port;
    const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(a) || (/^[^:]+:(\d+)$/.test(a) ? [a, a.replace(/:\d+$/, ""), a.split(":").pop()] : null);
    return m ? { host: m[1], port: m[2] || port } : { host: a, port };
  }
  const baseOf = (d) => { const { host, port } = split(d); return `http://${host.includes(":") ? "[" + host + "]" : host}:${port}`; };
  function norm(a, kind) {
    a = String(a || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(new RegExp(":" + KINDS[kind].port + "$"), "");
    return a || KINDS[kind].addr;
  }
  // how the browser is told the device is on the home network: a .local name
  // and a private address it knows by themselves. A plain name needs
  // targetAddressSpace; given for push.local it fails wherever the name also
  // has a global IPv6 address, which the browser counts as public (Chrome 158).
  function reach(d) {
    const h = split(d).host;
    return /\.local$/i.test(h) || /^[\d.]+$/.test(h) || h.includes(":") ? {} : { targetAddressSpace: "local" };
  }
  function fetchOf(d, path, opts) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    return fetch(baseOf(d) + path, { ...(opts || {}), ...reach(d), mode: "cors", cache: "no-store", signal: ctl.signal }).finally(() => clearTimeout(t));
  }
  async function jsonOf(d, path, opts) {
    const r = await fetchOf(d, path, opts);
    if (!r.ok) throw new Error("Pung answered " + r.status);
    return r.json();
  }
  // readOf: what the device has now (its catalog, with what is installed); true if it answered
  async function readOf(d) {
    try {
      const c = await jsonOf(d, "/api/catalog");
      if (!c || !c.modules) throw new Error("no catalog");
      const was = d.state;
      d.data = c; d.state = "on";
      if (!d.version) jsonOf(d, "/api/status").then((s) => { d.version = s.version || ""; changed("state", d); }).catch(() => {});
      if (was !== "on") changed("state", d);
      return true;
    } catch (e) {
      if (d.state === "on") { d.state = "lost"; changed("state", d); }
      return false;
    }
  }
  // systemOf: the device itself (processor, memory, disk, battery: Pung 0.6.0 on); null if it does not say
  async function systemOf(d) {
    try { d.sys = await jsonOf(d, "/api/system"); return d.sys; } catch (e) { return null; }
  }
  // why it did not connect, as far as the browser tells
  async function why(d, e) {
    let perm = "";
    for (const name of ["local-network", "local-network-access"]) { // Chrome 145 on: local-network (the other its earlier name)
      try { perm = (await navigator.permissions.query({ name })).state; break; } catch (_) { perm = "unknown"; }
    }
    if (perm === "denied") return "denied";
    if (e && e.name === "AbortError") return "timeout";
    try { // it answers, but its Pung does not let pung.live read: one from before 0.6.0
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      await fetch(baseOf(d) + "/api/status", { ...reach(d), mode: "no-cors", cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      return "old";
    } catch (_) { /* no answer at all */ }
    return perm === "unknown" ? "browser" : "unreachable";
  }
  // connectTo: a device answers; one that is new joins the list
  async function connectTo(d, quiet) {
    d.state = "trying"; d.err = "";
    changed("state", d);
    try {
      const c = await jsonOf(d, "/api/catalog");
      if (!c || !c.modules) throw new Error("no catalog");
      d.data = c; d.state = "on"; d.was = true; d.link = false;
      if (!devices.includes(d)) { devices.push(d); if (d === draft) draft = fresh({}); }
      if (!devices.some((x) => x.id === inUse)) inUse = d.id;
      save();
      try { d.version = (await jsonOf(d, "/api/status")).version || ""; } catch (_) { /* the catalog is what counts */ }
      systemOf(d).then(() => changed("state", d));
      if (!quiet) toast(`Connected to ${nameOf(d)}${d.version ? ", Pung " + d.version : ""}.`);
      const dlg = document.getElementById("pl-dialog");
      if (dlg && dlg.open) dlg.close();
      changed("connected", d);
      return true;
    } catch (e) {
      d.err = await why(d, e);
      d.state = quiet ? "lost" : "off";
      changed("state", d);
      return false;
    }
  }
  // connect(addr): the device at that address (one of the list, or a new one)
  function connect(addr, quiet, kind) {
    kind = kind || "push";
    const a = norm(addr, kind);
    let d = devices.find((x) => x.kind === kind && x.addr === a);
    if (!d) { draft.addr = a; draft.kind = kind; d = draft; }
    return connectTo(d, quiet);
  }
  // disconnect: this page stops talking to it; it stays in the list
  function disconnect(d) {
    d = d || cur();
    d.state = "off"; d.data = null; d.version = ""; d.sys = null; d.was = false;
    save();
    const dlg = document.getElementById("pl-dialog");
    if (dlg && dlg.open) dlg.close();
    changed("disconnected", d);
  }
  function remove(d) {
    devices = devices.filter((x) => x !== d);
    if (inUse === d.id) inUse = devices[0] ? devices[0].id : "";
    save();
    changed("removed", d);
  }
  function select(d) { inUse = d.id; save(); changed("selected", d); }
  function rename(d, name) { d.name = String(name || "").trim().slice(0, 40); save(); changed("state", d); }
  function useLinks() {
    const f = document.getElementById("pl-addr"), d = dialogDev;
    if (f) d.addr = norm(f.value, d.kind);
    d.state = "link"; d.link = true; d.was = false; d.data = null;
    if (!devices.includes(d)) { devices.push(d); if (d === draft) draft = fresh({}); }
    if (!devices.some((x) => x.id === inUse)) inUse = d.id;
    save();
    document.getElementById("pl-dialog").close();
    changed("state", d);
  }
  // arrived(): the visitor came from a device's own page (Pung's page on a Push
  // links here with #add=<its address>): that device, connected, without typing
  // the address again. The address is taken off the page's address at once.
  function arrived() {
    const m = /^#add=([^&]+)$/.exec(location.hash);
    if (!m) return "";
    history.replaceState(null, "", location.pathname + location.search);
    let a = "";
    try { a = decodeURIComponent(m[1]); } catch (e) { return ""; }
    // a name or an address on a home network, nothing else (the link is the device's own, but anyone can write one)
    if (!/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{2,5})?$/i.test(a) || a.length > 80) return "";
    const host = a.replace(/:\d+$/, "");
    const home = /^\[/.test(host) || /\.local$/i.test(host) || /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || !host.includes(".");
    return home ? a : "";
  }
  const cameFrom = arrived();

  // the devices it talked to before: again, without asking (the browser remembers the permission)
  function resume() {
    if (!enabled) return;
    if (cameFrom) {
      const a = norm(cameFrom, "push");
      const d = devices.find((x) => x.addr === a);
      if (d) { inUse = d.id; save(); } // the one they came from is the one in use
      connect(a, false).then((ok) => { if (!ok) open(devices.find((x) => x.addr === a) || "add-failed"); });
    }
    devices.forEach((d) => {
      if (cameFrom && d.addr === norm(cameFrom, "push")) return; // being connected above
      if (d.link) { d.state = "link"; changed("state", d); }
      else if (d.was) connectTo(d, true);
    });
  }

  // ---- the chip: where the device in use stands, in a page's head ---------------------------------
  // counts(): a page may say what to count (the Modules page: the modules it lists)
  let counts = (d) => {
    const ms = d.data ? d.data.modules.filter((x) => x.supported && x.in_catalog) : [];
    return { installed: ms.filter((x) => x.installed).length, updates: ms.filter((x) => x.status === "update").length };
  };
  function renderChips() {
    if (!enabled) return;
    document.querySelectorAll("[data-push-chip]").forEach((el) => {
      const d = cur(), a = esc(d.addr), n = esc(nameOf(d)), c = counts(d), more = devices.length > 1 ? ` <span class="n">${devices.indexOf(d) + 1}/${devices.length}</span>` : "";
      let html;
      if (!devices.length && d.state !== "trying") html = `<button type="button" class="pl-btn primary" aria-haspopup="dialog">Connect your Push</button>`;
      else if (d.state === "on") html = `<button type="button" class="pl-chip on" aria-haspopup="dialog"><i class="pl-led on" aria-hidden="true"></i><span class="t">${n}${more}</span><span class="s">${d.version ? "Pung " + esc(d.version) + " · " : ""}${c.installed} installed${c.updates ? " · " + c.updates + " update" + (c.updates === 1 ? "" : "s") : ""}</span></button>`;
      else if (d.state === "trying") html = `<span class="pl-chip busy" role="status"><span class="pl-spin" aria-hidden="true"></span><span class="t">Connecting to ${a}…</span></span>`;
      else if (d.state === "lost") html = `<button type="button" class="pl-chip bad" aria-haspopup="dialog"><i class="pl-led bad" aria-hidden="true"></i><span class="t">${d.restarting ? "Pung is starting again…" : n + " is not answering"}${more}</span><span class="s">${a}${d.restarting ? "" : " · trying again"}</span></button>`;
      else if (d.state === "link") html = `<button type="button" class="pl-chip link" aria-haspopup="dialog"><span class="t">${n}: ${a}</span><span class="s">buttons open Pung there</span></button>`;
      else html = `<button type="button" class="pl-chip" aria-haspopup="dialog"><i class="pl-led" aria-hidden="true"></i><span class="t">${n}${more}</span><span class="s">${a} · not connected</span></button>`;
      if (el.dataset.sig === html) return;
      el.dataset.sig = html;
      el.innerHTML = html;
      const b = el.querySelector("button");
      if (b) b.onclick = () => open();
    });
  }

  // ---- the dialog: connect a device, or the device in use ---------------------------------------
  let dialogDev = draft, adding = false;
  function dialog() {
    let dlg = document.getElementById("pl-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "pl-dialog"; dlg.className = "pl-dialog";
      dlg.setAttribute("aria-labelledby", "pl-title");
      dlg.innerHTML = `<button type="button" class="pl-btn icon pl-close" aria-label="Close">✕</button><div id="pl-body"></div>`;
      document.body.appendChild(dlg);
      dlg.querySelector(".pl-close").onclick = () => dlg.close();
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener("close", () => { adding = false; subs.forEach((f) => { try { f("dialog-closed"); } catch (e) { /* a page's own */ } }); });
    }
    return dlg;
  }
  // open(): the device in use; open(d): that one; open("add"): another device
  function open(what) {
    adding = what === "add" || what === "add-failed";
    if (what === "add") draft = fresh({});
    dialogDev = adding ? draft : what ? what : cur();
    const dlg = dialog();
    renderDialog();
    if (!dlg.open) dlg.showModal();
    const f = document.getElementById("pl-addr");
    if (f && dialogDev.state !== "on") { f.focus(); f.select(); }
  }
  const other = (a) => (/\.local$/i.test(a) ? "Its IP address works too." : "Check the address, or try push.local.");
  const WHY = {
    denied: () => `Your browser blocks pung.live from your home network. Allow <b>Local network access</b> for pung.live in the site's settings (the icon left of the address), then connect again.`,
    timeout: (a) => `No answer from <b>${a}</b> in 8 seconds. Is it switched on, on the same network as this computer, with Pung running? ${other(a)}`,
    unreachable: (a) => `No answer from <b>${a}</b>. Is it switched on, on the same network as this computer, with Pung running? ${other(a)}`,
    old: () => `It answers, but its Pung is older than 0.6.0, the first that talks to pung.live. <a href="${up}manual.html#update">Update Pung</a> and connect again. Until then, the buttons can open Pung's own page there.`,
    browser: () => `This browser does not let a web page reach anything on your network. Chrome and Edge (142 and later) and Firefox (151 and later) do, once you allow it. Here, the buttons can open Pung's own page there instead.`,
  };
  function renderDialog() {
    const body = document.getElementById("pl-body");
    if (!body) return;
    if (!adding && !devices.includes(dialogDev) && dialogDev !== draft) dialogDev = cur();
    if (dialogDev === draft && !adding && devices.length) dialogDev = cur();
    const d = dialogDev, a = esc(d.addr), k = KINDS[d.kind];
    const openPung = `<a class="pl-btn" href="${esc(baseOf(d))}/#modules" target="pung-device" rel="noopener">Open Pung on it ↗</a>`;
    if (d.state === "on" && !adding) {
      const c = counts(d);
      const others = devices.length > 1 ? `<div class="pl-pick"><p class="pl-kicker">Modules install on</p>${devices.map((x) =>
        `<label><input type="radio" name="pl-use" value="${x.id}" ${x === cur() ? "checked" : ""}><span><b>${esc(nameOf(x))}</b> <span class="pl-sub">${esc(KINDS[x.kind].label)} · ${esc(x.addr)}${x.state === "on" ? "" : " · not connected"}</span></span></label>`).join("")}</div>` : "";
      body.innerHTML = `
        <p class="pl-kicker">Connected · ${esc(k.label)}</p>
        <h2 id="pl-title"><i class="pl-led on" aria-hidden="true"></i> ${esc(nameOf(d))}</h2>
        <dl class="pl-facts"><dt>Address</dt><dd>${a}</dd><dt>Pung</dt><dd>${esc(d.version || "—")}</dd>
          <dt>Installed</dt><dd>${c.installed} module${c.installed === 1 ? "" : "s"}</dd><dt>Updates</dt><dd>${c.updates || "none"}</dd></dl>
        ${others}
        <p class="pl-sub">This site installs and updates modules on it and changes Pung's settings there, over your home network. A module's ROM and removing a module stay on Pung's own page.</p>
        <div class="pl-acts"><button type="button" class="pl-btn ghost" id="pl-off">Disconnect</button><span class="pl-grow"></span><a class="pl-btn" href="${up}deployments.html">Deployments</a>${openPung}</div>`;
      document.getElementById("pl-off").onclick = () => disconnect(d);
      body.querySelectorAll('input[name="pl-use"]').forEach((r) => (r.onchange = () => { const x = devices.find((y) => y.id === r.value); if (x) { select(x); dialogDev = x; renderDialog(); } }));
      return;
    }
    const busy = d.state === "trying";
    const err = d.err && !busy ? `<div class="pl-err" role="alert"><p>${WHY[d.err](a)}</p>
        <div class="pl-acts">${openPung}${["browser", "denied", "old"].includes(d.err) ? `<button type="button" class="pl-btn ghost" id="pl-links">Use links instead</button>` : ""}</div></div>` : "";
    const kinds = Object.keys(KINDS);
    body.innerHTML = `
      <p class="pl-kicker">pung.live and your deployments</p>
      <h2 id="pl-title">${adding && devices.length ? "Add a deployment" : "Connect your " + esc(k.short)}</h2>
      <p>pung.live talks to your Pung over your home network, the way Pung's own page does: nothing passes through the internet.</p>
      <ol class="pl-steps">
        <li>It is on, with Pung running, on the same network as this computer.</li>
        <li>Press <b>Connect</b>. Your browser asks whether pung.live may reach devices on your local network: choose <b>Allow</b>.</li>
      </ol>
      <form id="pl-form" class="pl-form" novalidate>
        ${kinds.length > 1 ? `<label for="pl-kind">Runs on</label><select id="pl-kind">${kinds.map((x) => `<option value="${x}" ${x === d.kind ? "selected" : ""}>${esc(KINDS[x].label)}</option>`).join("")}</select>` : ""}
        <label for="pl-addr">${esc(k.label)}</label>
        <div class="pl-row"><input id="pl-addr" type="text" inputmode="url" autocomplete="off" spellcheck="false" value="${a}" ${busy ? "disabled" : ""} aria-describedby="pl-hint">
        <button type="submit" class="pl-btn primary" ${busy ? "disabled" : ""}>${busy ? `<span class="pl-spin" aria-hidden="true"></span> Connecting…` : "Connect"}</button></div>
        <p class="pl-sub" id="pl-hint">${k.hint}${devices.length ? " A second one of a kind needs its IP address: both answer to the same name." : ""}</p>
      </form>
      ${err}
      ${d.state === "link" ? `<p class="pl-sub">Now the buttons open Pung's own page on it. Connect to do it from here.</p>` : ""}
      <p class="pl-sub">No Pung on it yet? <a href="${up}deployments.html#install">Install it</a>.</p>`;
    document.getElementById("pl-form").onsubmit = (e) => {
      e.preventDefault();
      const kind = document.getElementById("pl-kind") ? document.getElementById("pl-kind").value : d.kind;
      const addr = norm(document.getElementById("pl-addr").value, kind);
      const known = devices.find((x) => x.kind === kind && x.addr === addr);
      if (known) { dialogDev = known; connectTo(known); return; }
      if (devices.includes(d)) { d.addr = addr; save(); connectTo(d); return; } // its address changed
      d.addr = addr; d.kind = kind; connectTo(d);
    };
    const l = document.getElementById("pl-links");
    if (l) l.onclick = useLinks;
  }

  // ---- a word and a question, in the page (Pung's own page has its own) ---------------------------
  let tt = null;
  function toast(text, bad) {
    if (window.PungToast && window.PungToast !== toast) return window.PungToast(text, bad);
    let t = document.getElementById("pl-toast");
    if (!t) { t = document.createElement("div"); t.id = "pl-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.textContent = text; t.className = "pl-toast" + (bad ? " bad" : ""); t.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), bad ? 7000 : 3500);
  }
  function confirm(text, yes, danger) {
    return new Promise((done) => {
      let dlg = document.getElementById("pl-confirm");
      if (!dlg) {
        dlg = document.createElement("dialog");
        dlg.id = "pl-confirm"; dlg.className = "pl-dialog pl-confirm";
        dlg.innerHTML = `<p id="pl-confirm-text"></p><div class="pl-acts end"><button type="button" class="pl-btn" id="pl-no">Cancel</button><button type="button" class="pl-btn primary" id="pl-yes">OK</button></div>`;
        document.body.appendChild(dlg);
      }
      const ok = dlg.querySelector("#pl-yes"), no = dlg.querySelector("#pl-no");
      dlg.querySelector("#pl-confirm-text").textContent = text;
      ok.textContent = yes || "OK";
      ok.className = "pl-btn " + (danger ? "danger" : "primary");
      const end = (v) => { dlg.removeEventListener("close", onClose); ok.onclick = no.onclick = null; if (dlg.open) dlg.close(); done(v); };
      const onClose = () => end(false);
      dlg.addEventListener("close", onClose);
      ok.onclick = () => end(true);
      no.onclick = () => end(false);
      dlg.showModal();
      no.focus();
    });
  }
  if (!window.PungToast) window.PungToast = toast;
  if (!window.PungConfirm) window.PungConfirm = confirm;

  return {
    enabled, KINDS,
    // the device in use, as the Modules page reads it
    get state() { return cur(); },
    base: () => baseOf(cur()), fetch: (p, o) => fetchOf(cur(), p, o), json: (p, o) => jsonOf(cur(), p, o), read: () => readOf(cur()),
    connect, disconnect, open, resume, toast, confirm,
    // every device
    get devices() { return devices.slice(); },
    nameOf, baseOf, fetchOf, jsonOf, readOf, systemOf, connectTo, remove, select, rename, inUse: () => cur(),
    on: (f) => subs.push(f), changed, renderChips,
    setCounts: (f) => { counts = f; },
  };
})();
