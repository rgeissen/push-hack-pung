// pushlink.js: pung.live and the Pung on a visitor's own Push. One connection
// for every page of the site (the Modules page installs through it, Your Push
// shows and configures it): the address, the browser's permission, what the
// Push answers, and the dialog and chip that say where it stands.
//
// The Push is reached over the visitor's home network, never through the
// internet: an https page may talk to a device's http there once the visitor
// allows it (Local Network Access: Chrome and Edge 142 on, Firefox 151 on),
// and Pung lets only pung.live read the few calls this needs (src/sitecors.go).
//
// Offered once the Pung that answers it is released (<body data-connect="1">:
// site/install.json, launched).
window.PungPush = (function () {
  "use strict";
  const KEY = "pung.push";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const enabled = document.body.dataset.connect === "1";
  // where the site's other pages are from here (the Modules page is a folder down)
  const up = document.body.dataset.up || "";
  // state: off (not connected) | trying | on | lost (it was, and does not answer) | link (this browser cannot: buttons open Pung's own page)
  const st = { addr: localStorage.getItem(KEY) || "push.local", state: "off", data: null, version: "", err: "", restarting: false };
  const subs = [];
  const changed = (what) => { renderChips(); renderDialog(); subs.forEach((f) => { try { f(what || "state"); } catch (e) { /* a page's own */ } }); };

  // the address as typed: a name or an address, a port after it if not Pung's own 7720
  function split(a) {
    const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(a) || (/^[^:]+:(\d+)$/.test(a) ? [a, a.replace(/:\d+$/, ""), a.split(":").pop()] : null);
    return m ? { host: m[1], port: m[2] || "7720" } : { host: a, port: "7720" };
  }
  const base = () => { const { host, port } = split(st.addr); return `http://${host.includes(":") ? "[" + host + "]" : host}:${port}`; };
  function norm(a) {
    a = String(a || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/:7720$/, "");
    return a || "push.local";
  }
  // how the browser is told the Push is on the home network: a .local name and
  // a private address it knows by themselves. A plain name needs
  // targetAddressSpace; given for push.local it fails wherever the name also
  // has a global IPv6 address, which the browser counts as public (Chrome 158).
  function reach() {
    const h = split(st.addr).host;
    return /\.local$/i.test(h) || /^[\d.]+$/.test(h) || h.includes(":") ? {} : { targetAddressSpace: "local" };
  }
  function pfetch(path, opts) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    return fetch(base() + path, { ...(opts || {}), ...reach(), mode: "cors", cache: "no-store", signal: ctl.signal }).finally(() => clearTimeout(t));
  }
  async function json(path, opts) {
    const r = await pfetch(path, opts);
    if (!r.ok) throw new Error("Pung answered " + r.status);
    return r.json();
  }
  // read: what the Push has now (its catalog, with what is installed); true if it answered
  async function read() {
    try {
      const d = await json("/api/catalog");
      if (!d || !d.modules) throw new Error("no catalog");
      const was = st.state;
      st.data = d; st.state = "on";
      if (!st.version) json("/api/status").then((s) => { st.version = s.version || ""; changed(); }).catch(() => {});
      if (was !== "on") changed();
      return true;
    } catch (e) {
      if (st.state === "on") { st.state = "lost"; changed(); }
      return false;
    }
  }
  // why it did not connect, as far as the browser tells
  async function why(e) {
    let perm = "";
    for (const name of ["local-network", "local-network-access"]) { // Chrome 145 on: local-network (the other its earlier name)
      try { perm = (await navigator.permissions.query({ name })).state; break; } catch (_) { perm = "unknown"; }
    }
    if (perm === "denied") return "denied";
    if (e && e.name === "AbortError") return "timeout";
    try { // it answers, but its Pung does not let pung.live read: one from before 0.6.0
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      await fetch(base() + "/api/status", { ...reach(), mode: "no-cors", cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      return "old";
    } catch (_) { /* no answer at all */ }
    return perm === "unknown" ? "browser" : "unreachable";
  }
  async function connect(addr, quiet) {
    st.addr = norm(addr);
    st.state = "trying"; st.err = "";
    changed();
    try {
      const d = await json("/api/catalog");
      if (!d || !d.modules) throw new Error("no catalog");
      st.data = d; st.state = "on";
      localStorage.setItem(KEY, st.addr);
      localStorage.setItem(KEY + ".on", "1");
      localStorage.removeItem(KEY + ".link");
      try { st.version = (await json("/api/status")).version || ""; } catch (_) { /* the catalog is what counts */ }
      if (!quiet) toast(`Connected to your Push${st.version ? ", Pung " + st.version : ""}.`);
      const dlg = document.getElementById("pl-dialog");
      if (dlg && dlg.open) dlg.close();
      changed("connected");
      return true;
    } catch (e) {
      st.err = await why(e);
      st.state = quiet ? "lost" : "off";
      changed();
      return false;
    }
  }
  function disconnect() {
    st.state = "off"; st.data = null; st.version = "";
    localStorage.removeItem(KEY + ".on");
    localStorage.removeItem(KEY + ".link");
    const dlg = document.getElementById("pl-dialog");
    if (dlg && dlg.open) dlg.close();
    changed("disconnected");
  }
  function useLinks() {
    const f = document.getElementById("pl-addr");
    st.addr = norm(f ? f.value : st.addr);
    st.state = "link"; st.data = null;
    localStorage.setItem(KEY, st.addr);
    localStorage.setItem(KEY + ".link", "1");
    localStorage.removeItem(KEY + ".on");
    document.getElementById("pl-dialog").close();
    changed();
  }
  // the Push it talked to before: again, without asking (the browser remembers the permission)
  function resume() {
    if (!enabled) return;
    if (localStorage.getItem(KEY + ".link")) { st.state = "link"; changed(); }
    else if (localStorage.getItem(KEY + ".on")) connect(st.addr, true);
  }

  // ---- the chip: where the Push stands, in a page's head ------------------------------------
  // counts(): a page may say what to count (the Modules page: the modules it lists)
  let counts = () => {
    const ms = st.data ? st.data.modules.filter((x) => x.supported && x.in_catalog) : [];
    return { installed: ms.filter((x) => x.installed).length, updates: ms.filter((x) => x.status === "update").length };
  };
  function renderChips() {
    if (!enabled) return;
    document.querySelectorAll("[data-push-chip]").forEach((el) => {
      const a = esc(st.addr), c = counts();
      let html;
      if (st.state === "on") html = `<button type="button" class="pl-chip on" aria-haspopup="dialog"><i class="pl-led on" aria-hidden="true"></i><span class="t">Your Push</span><span class="s">${st.version ? "Pung " + esc(st.version) + " · " : ""}${c.installed} installed${c.updates ? " · " + c.updates + " update" + (c.updates === 1 ? "" : "s") : ""}</span></button>`;
      else if (st.state === "trying") html = `<span class="pl-chip busy" role="status"><span class="pl-spin" aria-hidden="true"></span><span class="t">Connecting to ${a}…</span></span>`;
      else if (st.state === "lost") html = `<button type="button" class="pl-chip bad" aria-haspopup="dialog"><i class="pl-led bad" aria-hidden="true"></i><span class="t">${st.restarting ? "Pung is starting again…" : "Your Push is not answering"}</span><span class="s">${a}${st.restarting ? "" : " · trying again"}</span></button>`;
      else if (st.state === "link") html = `<button type="button" class="pl-chip link" aria-haspopup="dialog"><span class="t">Your Push: ${a}</span><span class="s">buttons open Pung there</span></button>`;
      else html = `<button type="button" class="pl-btn primary" aria-haspopup="dialog">Connect your Push</button>`;
      if (el.dataset.sig === html) return;
      el.dataset.sig = html;
      el.innerHTML = html;
      const b = el.querySelector("button");
      if (b) b.onclick = () => open();
    });
  }

  // ---- the dialog ------------------------------------------------------------------------------
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
      dlg.addEventListener("close", () => subs.forEach((f) => { try { f("dialog-closed"); } catch (e) { /* a page's own */ } }));
    }
    return dlg;
  }
  function open() {
    const dlg = dialog();
    renderDialog();
    if (!dlg.open) dlg.showModal();
    const f = document.getElementById("pl-addr");
    if (f && st.state !== "on") { f.focus(); f.select(); }
  }
  const other = (a) => (/\.local$/i.test(a) ? "Its IP address works too." : "Check the address, or try push.local.");
  const WHY = {
    denied: () => `Your browser blocks pung.live from your home network. Allow <b>Local network access</b> for pung.live in the site's settings (the icon left of the address), then connect again.`,
    timeout: (a) => `No answer from <b>${a}</b> in 8 seconds. Is the Push on, on the same network as this computer, with Pung running? ${other(a)}`,
    unreachable: (a) => `No answer from <b>${a}</b>. Is the Push on, on the same network as this computer, with Pung running? ${other(a)}`,
    old: () => `Your Push answers, but its Pung is older than 0.6.0, the first that talks to pung.live. <a href="${up}manual.html#update">Update Pung</a> and connect again. Until then, the buttons can open Pung's own page on your Push.`,
    browser: () => `This browser does not let a web page reach your Push. Chrome and Edge (142 and later) and Firefox (151 and later) do, once you allow it. Here, the buttons can open Pung's own page on your Push instead.`,
  };
  function renderDialog() {
    const body = document.getElementById("pl-body");
    if (!body) return;
    const a = esc(st.addr);
    const openPung = `<a class="pl-btn" href="${esc(base())}/#modules" target="pung-push" rel="noopener">Open Pung on your Push ↗</a>`;
    if (st.state === "on") {
      const c = counts();
      body.innerHTML = `
        <p class="pl-kicker">Connected</p>
        <h2 id="pl-title"><i class="pl-led on" aria-hidden="true"></i> Your Push</h2>
        <dl class="pl-facts"><dt>Address</dt><dd>${a}</dd><dt>Pung</dt><dd>${esc(st.version || "—")}</dd>
          <dt>Installed</dt><dd>${c.installed} module${c.installed === 1 ? "" : "s"}</dd><dt>Updates</dt><dd>${c.updates || "none"}</dd></dl>
        <p class="pl-sub">This site installs and updates modules on your Push and changes Pung's settings there, over your home network. A module's ROM and removing a module stay on Pung's own page.</p>
        <div class="pl-acts"><button type="button" class="pl-btn ghost" id="pl-off">Disconnect</button><span class="pl-grow"></span><a class="pl-btn" href="${up}push.html">Your Push</a>${openPung}</div>`;
      document.getElementById("pl-off").onclick = disconnect;
      return;
    }
    const busy = st.state === "trying";
    const err = st.err && !busy ? `<div class="pl-err" role="alert"><p>${WHY[st.err](a)}</p>
        <div class="pl-acts">${openPung}${["browser", "denied", "old"].includes(st.err) ? `<button type="button" class="pl-btn ghost" id="pl-links">Use links instead</button>` : ""}</div></div>` : "";
    body.innerHTML = `
      <p class="pl-kicker">pung.live and your Push</p>
      <h2 id="pl-title">Connect your Push</h2>
      <p>pung.live talks to Pung on your Push over your home network, the way Pung's own page does: nothing passes through the internet.</p>
      <ol class="pl-steps">
        <li>Your Push is on, with Pung running, on the same network as this computer.</li>
        <li>Press <b>Connect</b>. Your browser asks whether pung.live may reach devices on your local network: choose <b>Allow</b>.</li>
      </ol>
      <form id="pl-form" class="pl-form" novalidate>
        <label for="pl-addr">Your Push</label>
        <div class="pl-row"><input id="pl-addr" type="text" inputmode="url" autocomplete="off" spellcheck="false" value="${a}" ${busy ? "disabled" : ""} aria-describedby="pl-hint">
        <button type="submit" class="pl-btn primary" ${busy ? "disabled" : ""}>${busy ? `<span class="pl-spin" aria-hidden="true"></span> Connecting…` : "Connect"}</button></div>
        <p class="pl-sub" id="pl-hint">push.local finds it on most home networks; its IP address works too. Pung answers on port 7720; another port goes after a colon (push.local:7711).</p>
      </form>
      ${err}
      ${st.state === "link" ? `<p class="pl-sub">Now the buttons open Pung's own page on your Push. Connect to do it from here.</p>` : ""}
      <p class="pl-sub">No Pung on your Push yet? <a href="${up}push.html#install">Install it</a>.</p>`;
    document.getElementById("pl-form").onsubmit = (e) => { e.preventDefault(); connect(document.getElementById("pl-addr").value); };
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
    enabled, state: st, base, fetch: pfetch, json, read, connect, disconnect, open, resume, toast, confirm,
    on: (f) => subs.push(f), changed, renderChips,
    setCounts: (f) => { counts = f; },
  };
})();
