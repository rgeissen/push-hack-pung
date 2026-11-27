// places.js: the place switcher. One control, in the same place on pung.live and on every deployment's own
// page: it names where you are (pung.live, or the deployment by its name with its state) and opens the list
// of where you can go: pung.live, and every deployment this browser knows. One press switches, in the same
// tab, to the same section there (Modules to Modules).
//
// The same file serves both: Pung has it built in (its own page: <div data-places="deployment">), and
// pung.live's build copies it (site/build.py: <div data-places="site" data-here="<page>" data-up="<to the
// site's root>">). It brings its own styles, in the colours of whichever stylesheet the page has.
//
// What each side knows:
//   pung.live      the visitor's deployments, kept in their browser by pushlink.js ("pung.devices"); where
//                  pushlink.js runs (Modules, Stacks, Deployments) also which of them answer.
//   a deployment   itself, and pung.live. Its siblings only once pung.live has handed them over: switching to
//                  a deployment carries the list along (?places=…), and its page keeps it ("pung.places").
//                  A list from a link is taken for names and home-network addresses, nothing else.
(function () {
  "use strict";
  const box = document.querySelector("[data-places]");
  if (!box) return;
  const SITE = "https://pung.live/";
  const onSite = box.dataset.places === "site";
  const KINDS = { push: { label: "Ableton Push 3", short: "Push", port: "7720" } };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const PP = window.PungPush || null;

  // ---- addresses ---------------------------------------------------------------------------------------
  // a deployment with a certificate has a name under one of these and answers there over https (secure.go)
  const SECURE = ["d.pung.live"];
  const secure = (host) => SECURE.some((s) => String(host).toLowerCase().endsWith("." + s));
  // a name or an address on a home network, with or without a port: what a deployment's address may be
  function home(a) {
    a = String(a || "");
    if (!/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{2,5})?$/i.test(a) || a.length > 80) return false;
    const host = a.replace(/:\d+$/, "");
    return /^\[/.test(host) || /\.local$/i.test(host) || /^(10\.|192\.168\.|169\.254\.|127\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || !host.includes(".") || secure(host);
  }
  function baseOf(d) {
    const a = d.addr, port = (KINDS[d.kind] || KINDS.push).port;
    const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(a) || (/^[^:]+:(\d+)$/.test(a) ? [a, a.replace(/:\d+$/, ""), a.split(":").pop()] : null);
    const host = m ? m[1] : a, tls = secure(host), p = (m && m[2]) || (tls ? String(+port + 1) : port);
    return `${tls ? "https" : "http"}://${host.includes(":") ? "[" + host + "]" : host}:${p}`;
  }
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")))));
  // only what a list may hold: an id, a name, a kind this page knows, a home-network address
  function clean(list) {
    const out = [];
    for (const d of Array.isArray(list) ? list.slice(0, 64) : []) {
      if (!d || !home(d.addr)) continue;
      out.push({ id: String(d.id || d.addr).slice(0, 40), name: String(d.name || "").slice(0, 60), kind: KINDS[d.kind] ? d.kind : "push", addr: String(d.addr) });
    }
    return out;
  }

  // ---- the deployments this page knows --------------------------------------------------------------------
  let kept = { list: [], self: "" };   // a deployment's page: what pung.live handed over
  if (!onSite) {
    try { kept = JSON.parse(localStorage.getItem("pung.places") || "null") || kept; } catch (e) { /* none kept */ }
    const q = new URLSearchParams(location.search).get("places");
    if (q) {
      try {
        const got = dec(q);
        kept = { list: clean(got.list), self: String(got.at || "").slice(0, 40) };
        localStorage.setItem("pung.places", JSON.stringify(kept));
      } catch (e) { /* not a list: the page opens as it would without one */ }
      history.replaceState(null, "", location.pathname + location.hash);
    }
    kept.list = clean(kept.list);
  }
  function deployments() {
    if (onSite) {
      if (PP) return PP.devices.map((d) => ({ id: d.id, name: PP.nameOf(d), kind: d.kind, addr: d.addr, state: d.state, version: d.version, behind: PP.behind(d) }));
      let l = [];
      try { l = JSON.parse(localStorage.getItem("pung.devices") || "[]") || []; } catch (e) { l = []; }
      return clean(l).map((d) => ({ ...d, name: d.name || "Your " + KINDS[d.kind].short, state: "" }));
    }
    const mine = kept.list.find((d) => d.id === kept.self) || kept.list.find((d) => baseOf(d) === location.origin);
    const self = { id: mine ? mine.id : "self", name: (mine && mine.name) || "This " + KINDS.push.short, kind: mine ? mine.kind : "push",
      addr: location.host.replace(/:7720$/, ""), state: "on", self: true };
    return [self, ...kept.list.filter((d) => d !== mine).map((d) => ({ ...d, name: d.name || "A " + KINDS[d.kind].short, state: reach[d.id] || "" }))];
  }

  // ---- who answers (a deployment's page asks, when the list is opened) ---------------------------------------
  const reach = {};
  let siteUp = onSite ? true : null;
  function ping(url, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    return fetch(url, { mode: "no-cors", cache: "no-store", signal: c.signal }).then(() => true, () => false).finally(() => clearTimeout(t));
  }
  function ask() {
    if (onSite) return;
    ping(SITE + "install.json", 5000).then((ok) => { siteUp = ok; draw(); });
    for (const d of kept.list) {
      if (baseOf(d) === location.origin) continue;
      ping(baseOf(d) + "/api/status", 3000).then((ok) => { reach[d.id] = ok ? "on" : "lost"; draw(); });
    }
  }

  // ---- where a switch lands: the same section there -------------------------------------------------------------
  const view = () => (onSite ? box.dataset.here || "" : document.body.dataset.view || "devices");
  function toDeployment(d, all) {
    const there = view() === "modules" ? "#modules" : "";
    const list = all.filter((x) => !x.site).map((x) => ({ id: x.id, name: x.name, kind: x.kind, addr: x.addr }));
    return `${baseOf(d)}/?places=${enc({ v: 1, at: d.id, list })}${there}`;
  }
  // this deployment's secure address, where it has a certificate: what pung.live is given, so that a browser
  // that refuses plain http from a secure page (Safari, every browser on an iPad) can still talk to it
  let mine = "";
  if (!onSite) fetch("/api/status").then((r) => r.json()).then((j) => {
    const sec = j && j.secure;
    if (sec && secure(sec.name)) mine = sec.name + (String(sec.port) === "7721" ? "" : ":" + sec.port);
  }).catch(() => {});
  function toSite() {
    const here = mine || (location.port && location.port !== "7720" ? location.hostname + ":" + location.port : location.hostname);
    return `${SITE}${view() === "modules" ? "modules/" : "deployments.html"}#add=${encodeURIComponent(here)}`;
  }

  // ---- the control ----------------------------------------------------------------------------------------------
  const GLOBE = `<svg class="pls-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>`;
  const CARET = `<svg class="pls-car" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>`;
  const led = (st) => `<i class="pls-led ${st === "on" ? "on" : st === "lost" || st === "off" ? "off" : ""}" aria-hidden="true"></i>`;
  let open = false, find = "";
  function sub(d) {
    const k = (KINDS[d.kind] || KINDS.push).label, parts = [k, d.addr];
    if (d.version) parts.push("Pung " + d.version);
    if (d.state === "lost" || d.state === "off") parts.push("not answering");
    return parts.join(" · ");
  }
  function draw() {
    const ds = deployments(), here = onSite ? null : ds.find((d) => d.self);
    const shown = ds.filter((d) => !find || d.name.toLowerCase().includes(find.toLowerCase()) || d.addr.toLowerCase().includes(find.toLowerCase()));
    const siteRow = `<button type="button" class="pls-item" role="menuitem" data-site aria-current="${onSite}" ${!onSite && siteUp === false ? "disabled" : ""}>${GLOBE}
        <span><b>pung.live</b><small>${!onSite && siteUp === false ? "Not reachable from here right now" : "All your deployments, modules, stacks, the manual"}</small></span>${onSite ? `<span class="pls-tag here">Here</span>` : "<span></span>"}</button>`;
    const rows = shown.map((d) => `<button type="button" class="pls-item" role="menuitem" data-go="${esc(d.id)}" aria-current="${!!d.self}">${led(d.state)}
        <span><b>${esc(d.name)}</b><small>${esc(sub(d))}</small></span>${d.self ? `<span class="pls-tag here">Here</span>` : d.behind ? `<span class="pls-tag upd">Update</span>` : "<span></span>"}</button>`).join("");
    const none = onSite ? `<p class="pls-note">None yet. Add your Push on the Deployments page.</p>`
      : `<p class="pls-note">Your other deployments appear here when you come from pung.live.</p>`;
    box.innerHTML = `<button type="button" class="pls-btn" aria-haspopup="menu" aria-expanded="${open}" aria-label="You are on ${esc(onSite ? "pung.live" : here.name)}. Switch place">
        ${onSite ? GLOBE : led("on")}<span class="pls-name">${esc(onSite ? "pung.live" : here.name)}</span>${CARET}</button>
      <div class="pls-menu" role="menu" ${open ? "" : "hidden"}>
        <p class="pls-k">Switch to</p>${siteRow}
        <hr><p class="pls-k">Your deployments</p>
        ${ds.length > 6 ? `<input class="pls-find" type="search" placeholder="Find a deployment" aria-label="Find a deployment" value="${esc(find)}">` : ""}
        ${rows || (find ? `<p class="pls-note">None by that name.</p>` : "")}${!onSite && ds.length < 2 || onSite && !ds.length ? none : ""}
        <hr><a class="pls-item" role="menuitem" href="${onSite ? esc((box.dataset.up || "") + "deployments.html") : SITE + "deployments.html"}"><span></span><span><b>Add a deployment</b><small>On pung.live, Deployments</small></span><span></span></a>
      </div>`;
    const btn = box.querySelector(".pls-btn"), menu = box.querySelector(".pls-menu");
    btn.onclick = (e) => { e.stopPropagation(); open = !open; find = ""; if (open) ask(); draw(); };
    if (open) place(btn, menu);
    const site = box.querySelector("[data-site]");
    site.onclick = () => { if (onSite) { open = false; draw(); } else location.href = toSite(); };
    box.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
      const d = ds.find((x) => x.id === b.dataset.go);
      if (!d || d.self) { open = false; draw(); return; }
      location.href = toDeployment(d, ds);
    }));
    const f = box.querySelector(".pls-find");
    if (f) {
      f.onclick = (e) => e.stopPropagation();
      f.oninput = () => { find = f.value; const at = f.selectionStart; draw(); const g = box.querySelector(".pls-find"); if (g) { g.focus(); g.setSelectionRange(at, at); } };
    }
  }
  // the list hangs under the control, inside the window whatever stands beside it
  function place(btn, menu) {
    const r = btn.getBoundingClientRect(), w = Math.min(380, innerWidth - 24);
    menu.style.width = w + "px";
    const left = r.left > innerWidth / 2 ? r.right - w : r.left;
    menu.style.left = Math.min(Math.max(12, left), innerWidth - w - 12) + "px";
    menu.style.top = r.bottom + 8 + "px";
    menu.style.maxHeight = Math.max(160, innerHeight - r.bottom - 20) + "px";
  }
  const shut = () => { if (open) { open = false; draw(); } };
  document.addEventListener("click", (e) => { if (!e.target.closest("[data-places]")) shut(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
  addEventListener("resize", shut);
  addEventListener("scroll", shut, { passive: true });
  if (PP && PP.on) PP.on(() => { if (!box.querySelector(".pls-find:focus")) draw(); });

  // ---- its looks: the page's own colours (pung.css: --ink is the text; Pung's app.css: --fg is, --ink the ground) ----
  const css = document.createElement("style");
  css.textContent = `
[data-places] { position: relative; flex: none; --pls-fg: var(--fg, var(--ink)); --pls-bg: var(--panel, var(--surface)); --pls-ground: var(--ground, var(--ink));
  --pls-acc: var(--amber, var(--pung)); --pls-cyan: var(--mod, var(--cyan)); font-family: var(--sans, var(--body, system-ui, sans-serif)); }
.pls-btn { display: inline-flex; align-items: center; gap: 9px; height: 32px; padding: 0 10px 0 12px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--pls-bg); color: var(--pls-fg); cursor: pointer; max-width: min(46vw, 260px); font: inherit; font-size: 14px; -webkit-tap-highlight-color: transparent; }
.pls-btn:hover, .pls-btn[aria-expanded="true"] { border-color: var(--pls-acc); }
.pls-btn:focus-visible, .pls-item:focus-visible, .pls-find:focus-visible { outline: 2px solid var(--pls-acc); outline-offset: 2px; }
.pls-name { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pls-car { width: 10px; height: 10px; flex: none; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pls-led { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; display: block; }
.pls-led.on { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.pls-led.off { background: transparent; border: 1.5px solid var(--muted); }
.pls-glyph { width: 14px; height: 14px; flex: none; fill: none; stroke: var(--pls-acc); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.pls-menu { position: fixed; z-index: 80; box-sizing: border-box; overflow-y: auto; background: var(--pls-bg); color: var(--pls-fg); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 24px 60px #0007; padding: 8px; display: grid; gap: 2px; text-align: left; line-height: 1.4; }
.pls-menu[hidden] { display: none; }
.pls-k { margin: 0; padding: 10px 10px 6px; font: 500 10.5px/1.3 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.pls-note { margin: 0; padding: 4px 10px 10px; color: var(--muted); font-size: 13px; }
.pls-item { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; width: 100%; box-sizing: border-box; text-align: left; padding: 10px;
  border: 0; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 14px; text-decoration: none; }
.pls-item:hover { background: var(--raise); }
.pls-item[aria-current="true"] { background: color-mix(in srgb, var(--pls-acc) 12%, transparent); }
.pls-item[disabled] { opacity: .6; cursor: default; }
.pls-item .pls-led, .pls-item .pls-glyph { justify-self: center; }
.pls-item b { font-weight: 650; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pls-item small { display: block; color: var(--muted); font: 500 11.5px/1.4 var(--mono); letter-spacing: .03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pls-tag { font: 600 10px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--line); color: var(--muted); }
.pls-tag.here { border-color: var(--pls-acc); color: var(--pls-acc); }
.pls-tag.upd { border-color: var(--pls-cyan); color: var(--pls-cyan); }
.pls-menu hr { border: 0; border-top: 1px solid var(--line); margin: 6px 4px; width: auto; }
.pls-find { margin: 2px 6px 6px; display: block; width: calc(100% - 12px); box-sizing: border-box; height: 34px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--pls-ground); color: var(--pls-fg); padding: 0 10px; font: inherit; font-size: 14px; }
`;
  document.head.appendChild(css);
  draw();
  if (!onSite) ask();
})();
