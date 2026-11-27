// modules.js: the Modules page. Installs, updates and removes modules from
// Pung's catalog, and takes the files a module needs that no package carries
// (ROMs). The API is src/modroutes.go; the rules are docs/UX-GUIDELINES.md.
//
// The same page is pung.live's Modules page (site/modules.html, <body
// data-public="1">): the release's catalog from catalog.json beside it, the
// pictures from screens/, everything read-only. A module is installed on
// the Push: connected to it (Connect your Push), this page installs, updates
// and restarts Live there itself, as Pung's own page does (src/sitecors.go;
// the browser asks the visitor first); else its buttons say how.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TYPE = {
    sound_generator: { label: "Instrument", plural: "Instruments", cls: "inst" },
    audio_fx: { label: "Audio effect", plural: "Audio effects", cls: "afx" },
    midi_fx: { label: "MIDI effect", plural: "MIDI effects", cls: "midi" },
  };
  const STATE = { queued: "Waiting", downloading: "Downloading", verifying: "Checking", unpacking: "Unpacking", testing: "Testing on the Push" };
  const ORIGIN = { pung: "Pung native", schwung: "Schwung" };
  const PUBLIC = document.body.dataset.public === "1";
  // pung.live talks to a Push only once the Pung that answers it is released (site/install.json, launched)
  const CONNECT = PUBLIC && document.body.dataset.connect === "1";
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const m = { data: null, filter: "all", origin: "all", show: "all", q: "", open: null, timer: null, down: false, busy: {}, shots: {}, face: 0 };

  async function api(path, opts) {
    const r = PUBLIC ? await pushFetch(path, opts) : await fetch(path, opts);
    const j = await r.json().catch(() => ({ ok: false, error: r.statusText }));
    if (!r.ok && j.ok !== false) j.ok = false;
    return j;
  }

  // ---- data ----------------------------------------------------------------------
  // the pictures of each module's own interface (make screens; src/web.go
  // serves them from beside Pung): {id: {panel, segments, pages: [{file, label}]}}
  let shotsAsked = false;
  function loadShots() {
    if (shotsAsked) return;
    shotsAsked = true;
    fetch(PUBLIC ? "screens/index.json" : "/screens/index.json").then((r) => (r.ok ? r.json() : {})).then((j) => { m.shots = j || {}; render(); }).catch(() => {});
  }
  const shotsOf = (x) => m.shots[x.id];
  const shotURL = (x, f) => `${PUBLIC ? "" : "/"}screens/${encodeURIComponent(x.id)}/${encodeURIComponent(f)}`;

  async function load(refresh) {
    loadShots();
    let d;
    if (PUBLIC) {
      if (!m.site) { try { m.site = await (await fetch("catalog.json")).json(); } catch (e) { m.site = null; } }
      if (push.state === "on" || push.state === "lost") await pushRead();
      d = m.data = merged();
      if (d && m.wantOpen && d.modules.some((x) => x.id === m.wantOpen)) { const id = m.wantOpen; m.wantOpen = null; render(); openSheet(id); }
      render();
      if (push.state === "on") {
        const active = d.restarting || d.modules.some((x) => x.job && !["done", "failed"].includes(x.job.state)) ||
          (d.apply && d.apply.state === "restarting-live");
        schedule(active ? 700 : 5000);
      } else if (push.state === "lost") schedule(m.applying ? 1500 : 8000);
      return;
    }
    try { d = await api("/api/catalog" + (refresh ? "?refresh=1" : "")); } catch (e) { d = null; }
    if (!d || !d.modules) {
      m.down = true; // Pung is starting again (Apply), or gone
      render();
      schedule(1000);
      return;
    }
    m.down = false; if (!d.restarting) m.applying = false;
    m.data = d;
    if (m.wantOpen && d.modules.some((x) => x.id === m.wantOpen)) { const id = m.wantOpen; m.wantOpen = null; render(); openSheet(id); }
    render();
    const active = d.restarting || d.modules.some((x) => x.job && !["done", "failed"].includes(x.job.state)) ||
      (d.apply && d.apply.state === "restarting-live");
    schedule(active ? 700 : 10000);
  }
  function schedule(ms) {
    clearTimeout(m.timer);
    if (!$("modules-view") || $("modules-view").hidden) return;
    m.timer = setTimeout(() => load(false), ms);
  }

  // ---- the page ------------------------------------------------------------------
  function rows() {
    const all = (m.data && m.data.modules || []).filter((x) => x.supported);
    const q = m.q.trim().toLowerCase();
    return all.filter((x) =>
      (m.filter === "all" || x.component_type === m.filter) &&
      (m.origin === "all" || originOf(x) === m.origin) &&
      (m.show === "all" || (m.show === "installed" && x.installed) || (m.show === "updates" && x.status === "update") || (m.show === "face" && shotsOf(x))) &&
      (!q || [x.name, x.id, x.author, x.description, x.license && x.license.spdx].join(" ").toLowerCase().includes(q)));
  }

  const originOf = (x) => (x.origin === "pung" ? "pung" : "schwung");
  // a takeover: its surface on the Push is an app of its own
  const surfaceChip = (x) => (x.surface_app
    ? `<span class="surface-kind${x.surface_app_installed ? "" : " missing"}" title="${x.surface_app_installed ? "Its surface on the Push is the " + esc(x.surface_app) + " app" : "Its surface is the " + esc(x.surface_app) + " app, which is not installed on this Push: Pung's own view opens"}">Takeover</span>`
    : "");
  const originChip = (x) => `<span class="origin ${originOf(x)}" title="${originOf(x) === "pung" ? "Written for the Push alone" : "Built from a Schwung module for Ableton Move"}">${ORIGIN[originOf(x)]}</span>`;

  function render() {
    const root = $("modules-view");
    if (!root || root.hidden) return;
    const d = m.data;
    renderStatus(d);
    renderBanner(d);
    const list = rows();
    const all = (d && d.modules || []).filter((x) => x.supported);
    const counts = { installed: all.filter((x) => x.installed).length, updates: all.filter((x) => x.status === "update").length };
    setText("mod-count-installed", counts.installed);
    setText("mod-count-pung", all.filter((x) => originOf(x) === "pung").length);
    setText("mod-count-schwung", all.filter((x) => originOf(x) === "schwung").length);
    setText("mod-count-updates", counts.updates);
    if ($("mod-count-face")) $("mod-count-face").textContent = all.filter((x) => shotsOf(x)).length || "";
    if (PUBLIC) {
      const on = push.state === "on";
      document.querySelectorAll("#mod-shows [data-needs-push]").forEach((b) => (b.hidden = !on));
      if (!on && (m.show === "installed" || m.show === "updates")) m.show = "all";
      renderPush();
    }
    $("mod-search").placeholder = `Search ${all.length} modules`;
    const grid = $("mod-grid");
    if (!d) { grid.innerHTML = `<div class="empty">${PUBLIC && m.tried ? "The catalog could not be read." : "Reading the catalog…"}</div>`; return; }
    if (!list.length) {
      grid.innerHTML = `<div class="empty">${all.length ? "No module matches." : "The catalog is empty or could not be read."}</div>`;
    } else {
      // keep the cards (and the focus) where they are; replace what changed
      const keep = new Map([...grid.querySelectorAll(".mod")].map((el) => [el.dataset.id, el]));
      grid.innerHTML = "";
      list.forEach((x) => {
        const html = card(x);
        let el = keep.get(x.id);
        if (!el || el.dataset.sig !== html) {
          const t = document.createElement("template");
          t.innerHTML = html.trim();
          el = t.content.firstChild;
          el.dataset.sig = html;
          wireCard(el, x);
        }
        grid.appendChild(el);
      });
    }
    const hidden = (d.modules || []).filter((x) => !x.supported).length;
    $("mod-foot").textContent = hidden ? `${hidden} Move tools are not listed: Pung runs instruments and effects.` : "";
    const badge = $("view-modules-badge");
    if (badge) { badge.textContent = counts.updates || ""; badge.hidden = !counts.updates; }
    renderUpdateAll(all);
    if (m.open) renderSheet();
  }

  function renderStatus(d) {
    const s = $("mod-status");
    if (PUBLIC) {
      const c = (d && d.catalog) || {};
      s.textContent = d ? `${c.pung ? "Pung " + c.pung + " · " : ""}${(d.modules || []).length} modules · catalog of ${c.generated_at ? fmtDate(c.generated_at.slice(0, 10)) : "?"}` : "";
      return;
    }
    if (m.down) { s.innerHTML = m.applying ? `<span class="warn">Pung is starting again…</span>` : ""; return; }
    if (!d) { s.textContent = ""; return; }
    const c = d.catalog || {};
    const when = c.fetched_at ? ago(new Date(c.fetched_at)) : "";
    if (c.offline && c.have) s.innerHTML = `<span class="warn">Offline</span> · the catalog as read ${esc(when)} · ${esc(c.error || "")}`;
    else if (c.offline) s.innerHTML = `<span class="warn">The catalog cannot be read</span> · ${esc(c.error || "")}`;
    else {
      // where the pack is from (modpack.go): pung.live's, or the one that came with Pung
      const when = c.generated_at ? ago(new Date(c.generated_at)) : "?";
      const from = c.source === "pung.live" ? "Modules from pung.live" : c.source === "pung" ? "The modules that came with Pung" : "Catalog";
      s.textContent = `${from} · updated ${when}`;
      s.title = c.source === "pung" && c.pack_error ? `pung.live was not read (${c.pack_error}): Pung goes on with its own modules` : "";
    }
  }

  // Update all: every module with an update, queued at once (each installs as
  // its own Update does, one after another); while they install, how far
  function renderUpdateAll(all) {
    const b = $("mod-update-all");
    if (!b) return;
    const ups = all.filter((x) => x.status === "update");
    const busy = (x) => x.job && !["done", "failed"].includes(x.job.state);
    const going = ups.filter(busy).length, left = ups.length - going;
    b.hidden = !ups.length || m.down || (PUBLIC && push.state !== "on");
    if (!ups.length) return;
    b.disabled = !left;
    b.textContent = left ? `Update all (${left})` : `Updating ${going}…`;
    b.title = left ? `Update the ${left} module${left === 1 ? "" : "s"} with a newer version in the catalog` : "";
  }

  function renderBanner(d) {
    const b = $("mod-banner");
    if (!b) return;
    if (PUBLIC && push.state !== "on" && !m.applying) { b.hidden = true; return; }
    const ap = d && d.apply;
    if (m.down && !m.applying) { b.hidden = true; return; } // the page's own bar says Pung is not answering
    if (m.down || (d && d.restarting)) {
      b.hidden = false;
      b.className = "mod-banner busy";
      b.innerHTML = `<div><b>Applying.</b> Pung is starting again with the new modules, then Live restarts and opens your Set again.</div><span class="spin" aria-hidden="true"></span>`;
      return;
    }
    if (ap && ap.state === "restarting-live") {
      b.hidden = false;
      b.className = "mod-banner busy";
      b.innerHTML = `<div><b>Live is restarting.</b> It opens your Set again in a few seconds: the new modules are in its browser under Pung.</div><span class="spin" aria-hidden="true"></span>`;
      return;
    }
    const pend = (d && d.pending) || [];
    if (pend.length) {
      b.hidden = false;
      b.className = "mod-banner";
      b.innerHTML = `<div><b>Ready for Live:</b> ${pend.map(esc).join(", ")}.<br>
        <span class="sub">Live shows new modules after it restarts. It reopens your Set as it is now, unsaved changes included.</span></div>
        <button type="button" class="primary" id="mod-apply">Restart Live now</button>`;
      $("mod-apply").onclick = apply;
      return;
    }
    if (ap && ap.state === "done" && Date.now() - new Date(ap.at) < 120000) {
      b.hidden = false;
      b.className = "mod-banner ok";
      b.innerHTML = `<div><b>Done.</b> ${esc((ap.applied || []).join(", "))}: Live has them now.</div>`;
      return;
    }
    if (ap && ap.state === "failed") {
      b.hidden = false;
      b.className = "mod-banner bad";
      b.innerHTML = `<div><b>Live did not restart:</b> ${esc(ap.error || "")}. Restart it from the Push to see the new modules.</div>`;
      return;
    }
    b.hidden = true;
  }

  function badges(x) {
    const out = [];
    if (shotsOf(x)) out.push(`<span class="tag iface" title="On the Push it opens on a front panel of its own, drawn in its own design language">Custom interface</span>`);
    if (x.license && x.license.spdx) out.push(`<span class="tag" title="Licence: ${esc(x.license.from || "")}">${esc(shortLicence(x.license.spdx))}</span>`);
    if (x.license && x.license.noncommercial) out.push(`<span class="tag" title="May not be sold or used commercially">Non-commercial</span>`);
    if (needsFiles(x)) out.push(`<span class="tag need" title="${esc(needText(x))}">${x.installed && !x.assets_ready ? "ROM missing" : "Needs ROM"}</span>`);
    if (x.in_use) out.push(`<span class="tag">In your Set${x.in_use > 1 ? " ×" + x.in_use : ""}</span>`);
    const l = x.limits || {};
    if (l.one) out.push(`<span class="tag limit" title="${esc(oneText(l))}">One at a time</span>`);
    if (l.emulator) out.push(`<span class="tag limit" title="${esc(emuText(l))}">Emulator</span>`);
    return out.join("");
  }
  // a module's limits (limits.go), in words
  function oneText(l) {
    return l.one === "refuses"
      ? "One instance on the Push: a second one in the Set reports an error and stays silent. Remove the first to use it."
      : "One instance on the Push: a second one in the Set stays silent and says Waiting; it starts the moment the first is removed.";
  }
  // what an emulator costs and when it costs nothing (limits.go: cost in percent of one core, rests)
  function emuText(l) {
    const cores = l.cost ? (l.cost / 100).toFixed(1).replace(/\.0$/, "") : "";
    const cost = cores ? `An emulated hardware DSP: about ${cores} of the Push's four processor cores while it plays.` : "An emulated hardware DSP: it takes most of a processor core.";
    const rest = l.rests ? " In silence it rests and takes none, and wakes with the next note, on time."
      : l.host_rests ? " In silence it rests and takes next to none, and wakes with the next note, on time." : "";
    return cost + rest + " Two emulators run at once, and only while the Push has room for both: another waits, silent, and starts by itself when there is.";
  }

  function action(x) {
    // on pung.live: what the connected Push has; not connected, Install asks to connect first
    if (PUBLIC && !CONNECT) return `<a class="act" href="../deployments.html#install" title="Pung installs modules on the Push, from its own Modules page">Install on your Push</a>`;
    if (PUBLIC) {
      if (push.state === "link") return `<a class="act" href="${esc(pushBase())}/#modules/${encodeURIComponent(x.id)}" target="pung-push" rel="noopener" title="Opens this module on Pung's own page on your Push">Open on your Push ↗</a>`;
      if (push.state !== "on") return `<button type="button" class="act" data-act="install" title="Connect your Push, and it installs there">Install</button>`;
      if (x.push_missing) return `<a class="act" href="../manual.html#update" title="It comes with a newer Pung than your Push has: update Pung first">Needs a newer Pung</a>`;
    }
    const j = x.job;
    if (j && !["done", "failed"].includes(j.state)) {
      const pct = j.state === "downloading" && j.total ? Math.round((100 * j.done) / j.total) : null;
      return `<div class="progress" role="progressbar" aria-label="${esc(STATE[j.state] || j.state)}" ${pct !== null ? `aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"` : ""}>
        <i style="width:${pct !== null ? pct : 100}%" class="${pct === null ? "indet" : ""}"></i></div>
        <span class="pstate">${esc(STATE[j.state] || j.state)}${pct !== null ? " " + pct + "%" : "…"}</span>`;
    }
    if (j && j.state === "failed") return `<button type="button" class="act retry" data-act="install">Try again</button>`;
    if (x.status === "needs-pung") return `<a class="act" href="${PUBLIC ? "../manual.html#update" : "https://pung.live/manual.html#update"}" ${PUBLIC ? "" : 'target="_blank" rel="noopener"'} title="This module needs Pung ${esc(x.needs_pung)} or later: update Pung first">Needs Pung ${esc(x.needs_pung)}</a>`;
    if (x.status === "update") return `<button type="button" class="act primary" data-act="install"${x.repacked ? ' title="The same version, packed again by Pung with files the first package left out"' : ""}>${x.repacked ? "Update (new build)" : "Update to " + esc(x.version)}</button>`;
    if (x.status === "installed") return `<span class="done">Installed ${esc(x.installed || "")}</span>`;
    if (x.status === "builtin") return `<span class="done">Built into Pung</span>`;
    return `<button type="button" class="act" data-act="install">Install</button>`;
  }

  // the category's name, as Schwung's catalogue and Pung's site name it
  function catLabel(x) {
    const tax = (m.data && m.data.catalog && m.data.catalog.taxonomy) || {};
    const f = ((tax.subcategories || {})[x.component_type] || []).find((c) => c.id === x.subcategory);
    return f ? f.label : (x.subcategory || "").replace(/-/g, " ");
  }

  function card(x) {
    const t = TYPE[x.component_type] || { label: x.component_type, cls: "" };
    const err = x.job && x.job.state === "failed" ? `<p class="err" role="alert">${esc(x.job.error)}</p>` : "";
    const cat = catLabel(x);
    const tags = (x.tags || []).filter((g) => g !== "needs-assets").slice(0, 3);
    const sh = shotsOf(x);
    // its own interface on the Push, edge to edge: what it looks like is the first thing told
    const face = sh ? `<figure class="face"><img src="${shotURL(x, sh.panel)}" alt="${esc(x.name)} on the Push: its front panel" width="960" height="160" loading="lazy" decoding="async"></figure>` : "";
    return `<article class="mod ${t.cls}${originOf(x) === "pung" ? " native" : ""}${sh ? " has-face" : ""}" data-id="${esc(x.id)}" tabindex="0" aria-label="${esc(x.name)}, ${esc(t.label)}, ${ORIGIN[originOf(x)]}${sh ? ", custom interface" : ""}">
      ${face}<div class="top"><h3>${esc(x.name)}</h3><span class="chips">${surfaceChip(x)}${originChip(x)}</span></div>
      <span class="badges"><span class="badge kind">${esc(t.label)}</span>${cat ? `<span class="badge cat">${esc(cat)}</span>` : ""}</span>
      <p class="desc" title="${esc(x.description || "")}">${esc(x.description || "")}</p>
      ${tags.length ? `<div class="pills">${tags.map((g) => `<span class="pill">${esc(g)}</span>`).join("")}</div>` : ""}
      <p class="by"><span>${x.author ? "by " + esc(x.author) : ""}</span><span class="ver">v${esc(String(x.installed && x.status !== "update" ? x.installed : x.version).replace(/^v/, ""))}</span></p>
      <div class="tags">${badges(x)}</div>${err}
      <footer>${x.updated ? `<span class="date">Updated ${esc(fmtDate(x.updated))}</span>` : ""}${action(x)}</footer>
    </article>`;
  }
  function fmtDate(s) {
    const d = new Date(s.length === 10 ? s + "T12:00:00Z" : s);
    return isNaN(d) ? s : d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  }

  function wireCard(el, x) {
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (b) { e.stopPropagation(); install(x.id); return; }
      openSheet(x.id);
    });
    el.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); openSheet(x.id); } });
  }

  // ---- the detail sheet ------------------------------------------------------------
  function openSheet(id) {
    if (m.open !== id) m.face = 0;
    m.open = id;
    if (PUBLIC && location.hash !== "#" + encodeURIComponent(id)) history.replaceState(null, "", "#" + encodeURIComponent(id)); // a link to it
    renderSheet();
    const dlg = $("mod-sheet");
    if (!dlg.open) dlg.showModal();
  }

  function renderSheet() {
    const x = (m.data && m.data.modules || []).find((r) => r.id === m.open);
    const body = $("mod-sheet-body");
    if (!x) { $("mod-sheet").close(); return; }
    const t = TYPE[x.component_type] || { label: x.component_type, cls: "" };
    const base = (m.data.catalog && m.data.catalog.base_url) || "";
    const src = x.source || {};
    const strip = body.querySelector(".face-strip"), stripAt = strip ? strip.scrollLeft : 0; // kept over a refresh
    const facts = [
      ["Version", x.installed ? (x.status === "update" ? (x.repacked ? `${x.installed} installed, a new build of it available` : `${x.installed} installed, ${x.version} available`) : x.installed) : x.version],
      ["Category", catLabel(x) || "—"],
      ["Released", x.released ? fmtDate(x.released) : "—"],
      ["Updated", x.updated ? fmtDate(x.updated) : "—"],
      ["Licence", x.license && x.license.spdx ? `${x.license.spdx}${x.license.noncommercial && !/commercial/i.test(x.license.spdx) ? " (non-commercial)" : ""}` : "—"],
      ["Size", x.size ? bytes(x.size) : "—"],
    ];
    const links = [];
    if (src.repo) links.push(`<a href="${esc(src.repo)}" target="_blank" rel="noopener">Repository</a>`);
    // a full address (a bundled catalog keeps its sources on GitHub), or one under the catalog's
    const srcURL = /^https?:\/\//.test(src.archive || "") ? src.archive : base + "/" + src.archive;
    if (src.archive) links.push(`<a href="${esc(srcURL)}">Source of this build${src.archive_size ? ` (${bytes(src.archive_size)})` : ""}</a>`);
    body.innerHTML = `
      <header class="sheet-head ${t.cls}">
        <span class="kind">${esc(t.label)} ${originChip(x)} ${surfaceChip(x)}</span>
        <h2 id="mod-sheet-title">${esc(x.name)}</h2>
        <p class="by">${esc(x.author || "")}</p>
      </header>
      ${facesSection(x)}
      <p class="desc">${esc(x.description || "")}</p>
      ${x.surface_app ? `<p class="note">${x.surface_app_installed
        ? `<b>Takeover.</b> On the Push, opening this device hands the screen, the pads and the buttons to the <b>${esc(x.surface_app)}</b> app, which edits it. That app's own way back to Live ends it.`
        : `<b>Takeover, but its app is missing.</b> Its surface on the Push is the <b>${esc(x.surface_app)}</b> app, a Push Hack that is not installed on this Push. Until it is, opening the device shows Pung's own view.`}</p>` : ""}
      ${x.limits && (x.limits.one || x.limits.emulator) ? `<p class="note limit"><b>Limits.</b> ${[x.limits.one ? oneText(x.limits) : "", x.limits.emulator ? emuText(x.limits) : ""].filter(Boolean).map(esc).join(" ")}</p>` : ""}
      <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${links.length ? `<p class="links">${links.join(" · ")}</p>` : ""}
      ${x.requires && !specs(x).length && !(x.asset_state || []).length ? `<p class="req">${esc(x.requires)}</p>` : ""}
      ${assetsSection(x)}
      ${x.job && x.job.state === "failed" ? `<p class="err" role="alert">${esc(x.job.error)}</p>` : ""}
      <div class="sheet-actions">
        ${x.managed && !PUBLIC ? `<button type="button" class="danger" id="mod-remove">Remove</button>` : ""}
        ${PUBLIC && push.state === "on" && x.installed ? `<a class="ghost" href="${esc(pushBase())}/#modules/${encodeURIComponent(x.id)}" target="pung-push" rel="noopener">Manage on your Push ↗</a>` : ""}
        <span class="grow"></span>
        ${action(x)}
      </div>
      <p class="err" id="mod-sheet-msg" role="alert" hidden></p>`;
    $("mod-sheet").classList.toggle("wide", !!shotsOf(x));
    if (body.querySelector(".face-strip")) body.querySelector(".face-strip").scrollLeft = stripAt;
    wireFaces(x);
    body.querySelectorAll("button[data-act]").forEach((b) => (b.onclick = () => install(x.id)));
    if ($("mod-remove")) $("mod-remove").onclick = () => remove(x);
    body.querySelectorAll(".drop").forEach((z) => wireDrop(z, x));
    body.querySelectorAll("button[data-del]").forEach((b) => (b.onclick = () => delAsset(x, b.dataset.path, b.dataset.del)));
  }

  // ---- its own interface, in the sheet ------------------------------------------------
  // the front panel large, then every screen of its own: a strip of them to
  // step through (click, or the arrow keys as Page < > on the Push)
  function faceList(x) {
    const sh = shotsOf(x);
    if (!sh) return [];
    const l = [{ file: sh.panel, label: "Front panel", note: "What the Push shows when the device opens. The encoders play the row along its foot." }];
    if (sh.segments) l.push({ file: sh.segments, label: "Segment mode", note: "Nudge the jog wheel right: the panel's sections are named over the lower buttons, and the encoders play the one chosen. Nudge left to leave." });
    (sh.pages || []).forEach((p) => l.push({ file: p.file, label: p.label, note: "A page of its own: turn to it with Page < > or the lower buttons." }));
    return l;
  }
  function facesSection(x) {
    const l = faceList(x);
    if (!l.length) return "";
    if (m.face >= l.length) m.face = 0;
    const cur = l[m.face];
    return `<section class="faces" aria-label="${esc(x.name)} on the Push">
      <figure class="face-main"><img id="face-main" src="${shotURL(x, cur.file)}" alt="${esc(x.name)} on the Push: ${esc(cur.label)}" width="960" height="160">
        <figcaption><b id="face-label">${esc(cur.label)}</b> <span id="face-count">${m.face + 1} of ${l.length}</span><span id="face-note">${esc(cur.note)}</span></figcaption></figure>
      ${l.length > 1 ? `<div class="face-strip" role="listbox" aria-label="Its screens" tabindex="0">${l.map((f, i) =>
        `<button type="button" role="option" class="thumb" data-face="${i}" aria-selected="${i === m.face}" title="${esc(f.label)}"><img src="${shotURL(x, f.file)}" alt="" width="960" height="160" loading="lazy" decoding="async"><span>${esc(f.label)}</span></button>`).join("")}</div>` : ""}
    </section>`;
  }
  function wireFaces(x) {
    const l = faceList(x);
    if (!l.length) return;
    const show = (i) => {
      m.face = (i + l.length) % l.length;
      const f = l[m.face];
      $("face-main").src = shotURL(x, f.file);
      $("face-main").alt = `${x.name} on the Push: ${f.label}`;
      $("face-label").textContent = f.label;
      $("face-count").textContent = `${m.face + 1} of ${l.length}`;
      $("face-note").textContent = f.note;
      document.querySelectorAll(".face-strip .thumb").forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.face === m.face)));
      const sel = document.querySelector(`.face-strip .thumb[data-face="${m.face}"]`);
      if (sel) sel.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    document.querySelectorAll(".face-strip .thumb").forEach((b) => (b.onclick = () => show(+b.dataset.face)));
    const strip = document.querySelector(".faces");
    if (strip) strip.onkeydown = (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); show(m.face + 1); }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); show(m.face - 1); }
    };
  }

  function needsFiles(x) {
    const st = x.asset_state;
    if (st && st.length) return x.assets_missing > 0;
    return specs(x).some((a) => (a.files || []).some((f) => f.required));
  }
  function specs(x) { const a = x.assets; return !a ? [] : Array.isArray(a) ? a : [a]; }
  function needText(x) {
    return specs(x).map((a) => a.description || a.label).filter(Boolean).join(" ");
  }

  function assetsSection(x) {
    const st = x.asset_state || [];
    if (PUBLIC && x.installed && st.length) {
      // read here; added on the Push (a ROM is the player's own: it never passes through this site)
      return `<section class="assets"><h3>Files it needs</h3>${st.map((a) => `
        <div class="asset"><h4>${esc(a.label || a.path)}${a.optional ? ` <span class="sub">optional</span>` : ""}</h4>
          ${a.description ? `<p>${esc(a.description)}</p>` : ""}
          ${(a.files || []).length ? `<ul class="files">${a.files.map((f) => `
            <li class="${f.ok ? "ok" : f.present ? "bad" : f.required ? "miss" : "opt"}"><span class="dot" aria-hidden="true"></span>
            <span class="fname">${esc(f.label || f.filename)}</span>
            <span class="fstate">${f.ok ? "present" : f.present ? esc(f.problem || "wrong file") : f.required ? "missing" : "optional"}</span></li>`).join("")}</ul>` : ""}
        </div>`).join("")}
        <p class="sub"><a href="${esc(pushBase())}/#modules/${encodeURIComponent(x.id)}" target="pung-push" rel="noopener">Add them on your Push ↗</a> on Pung's own page: a ROM goes from this computer to the Push, never through pung.live.</p></section>`;
    }
    if (!x.installed) {
      const sp = specs(x).filter((a) => (a.files || []).some((f) => f.required) || a.description);
      if (!sp.length) return "";
      return `<section class="assets"><h3>Files it needs</h3>${sp.map((a) =>
        `<p>${esc(a.description || a.label)}</p>`).join("")}<p class="sub">${PUBLIC ? "Add them on your Push, on Pung's Modules page, once the module is installed." : "Install it first; then add them here."} Pung never downloads them: they are yours to add.</p></section>`;
    }
    if (!st.length) return "";
    return `<section class="assets"><h3>Files it needs</h3>${st.map((a) => `
      <div class="asset">
        <h4>${esc(a.label || a.path)}${a.optional ? ` <span class="sub">optional</span>` : ""}</h4>
        ${a.description ? `<p>${esc(a.description)}</p>` : ""}
        ${(a.files || []).length ? `<ul class="files">${a.files.map((f) => `
          <li class="${f.ok ? "ok" : f.present ? "bad" : f.required ? "miss" : "opt"}">
            <span class="dot" aria-hidden="true"></span>
            <span class="fname">${esc(f.label || f.filename)}</span>
            <span class="fstate">${f.ok ? "present" : f.present ? esc(f.problem || "wrong file") : f.required ? "missing" : "optional"}</span>
            ${f.present ? `<button type="button" class="ghost small" data-path="${esc(a.path)}" data-del="${esc(f.filename)}" aria-label="Remove ${esc(f.label || f.filename)}">Remove</button>` : ""}
          </li>`).join("")}</ul>` : ""}
        ${(a.others || []).length ? `<p class="sub">Also in this folder: ${a.others.map(esc).join(", ")}</p>` : ""}
        <label class="drop" data-path="${esc(a.path)}" tabindex="0">
          <input type="file" multiple ${a.extensions && a.extensions.length ? `accept="${esc(a.extensions.join(","))}"` : ""}>
          <span>Drop ${esc((a.extensions || []).join(" ") || "files")} here, or <u>choose</u></span>
        </label>
        ${a.hint ? `<p class="sub">${esc(a.hint)}</p>` : ""}
      </div>`).join("")}</section>`;
  }

  function wireDrop(z, x) {
    const input = z.querySelector("input");
    const send = (files) => upload(x, z.dataset.path, [...files]);
    input.onchange = () => send(input.files);
    z.addEventListener("dragover", (e) => { e.preventDefault(); z.classList.add("over"); });
    z.addEventListener("dragleave", () => z.classList.remove("over"));
    z.addEventListener("drop", (e) => { e.preventDefault(); z.classList.remove("over"); send(e.dataTransfer.files); });
  }

  async function upload(x, path, files) {
    const msg = [];
    for (const f of files) {
      say(`Adding ${f.name}…`);
      const r = await api(`/api/catalog/${encodeURIComponent(x.id)}/assets/${encodeURIComponent(path)}/${encodeURIComponent(f.name)}`, { method: "PUT", body: f });
      if (!r.ok) msg.push(`${f.name}: ${r.error}`);
      else {
        msg.push(r.stored_as && r.stored_as !== f.name ? `${f.name}: recognised, stored as ${r.stored_as}` : `${f.name}: added`);
        if (r.missing === 0 && r.reloaded) msg.push(`all files are there: ${r.reloaded} device${r.reloaded > 1 ? "s" : ""} in your Set load it again`);
      }
    }
    await load(false);
    say(msg.join(". ") + ".", msg.some((t) => !/added|recognised|load it again/.test(t)));
  }

  async function delAsset(x, path, name) {
    if (!(await PungConfirm(`Remove ${name} from ${x.name}?`, "Remove", true))) return;
    const r = await api(`/api/catalog/${encodeURIComponent(x.id)}/assets/${encodeURIComponent(path)}/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) say(r.error, true);
    await load(false);
  }

  function say(text, bad) {
    const p = $("mod-sheet-msg");
    if (!p) return;
    p.hidden = !text;
    p.textContent = text || "";
    p.className = bad ? "err" : "note";
  }

  // ---- actions ---------------------------------------------------------------------
  async function install(id) {
    if (PUBLIC && push.state !== "on") { m.afterConnect = id; openConnect(); return; }
    const r = await api(`/api/catalog/${encodeURIComponent(id)}/install`, { method: "POST" });
    if (!r.ok) PungToast(r.error || "It could not be installed.", true);
    load(false);
  }
  async function updateAll() {
    const ups = ((m.data && m.data.modules) || []).filter((x) => x.supported && x.status === "update" &&
      !(x.job && !["done", "failed"].includes(x.job.state)));
    if (!ups.length) return;
    const size = ups.reduce((n, x) => n + (x.size || 0), 0);
    const names = ups.slice(0, 6).map((x) => x.name).join(", ") + (ups.length > 6 ? ` and ${ups.length - 6} more` : "");
    if (!(await PungConfirm(`Update ${ups.length} module${ups.length === 1 ? "" : "s"}${size ? ` (${bytes(size)})` : ""}: ${names}? ` +
      "They install one after another; Live sees them once it restarts, which this page then offers.", "Update all"))) return;
    $("mod-update-all").disabled = true;
    const r = await api("/api/catalog/update-all", { method: "POST" });
    const failed = Object.entries((r && r.failed) || {});
    if (failed.length) PungToast(failed.map(([id, e]) => `${id}: ${e}`).join("; "), true);
    else if (!r || r.error) PungToast((r && r.error) || "The updates could not be started.", true);
    load(false);
  }
  async function remove(x) {
    if (!(await PungConfirm(`Remove ${x.name}? Its files (ROMs, banks) are kept, and come back if you install it again.`, "Remove", true))) return;
    const r = await api(`/api/catalog/${encodeURIComponent(x.id)}/remove`, { method: "POST" });
    if (!r.ok) { say(r.error, true); return; }
    load(false);
  }
  async function apply() {
    if (PUBLIC && !(await PungConfirm("Restart Live on your Push now? It reopens your Set as it is, unsaved changes included, with the new modules in its browser.", "Restart Live"))) return;
    const btn = $("mod-apply");
    if (btn) btn.disabled = true;
    const r = await api("/api/catalog/apply", { method: "POST" });
    if (!r.ok) { PungToast(r.error || "Live could not be restarted.", true); if (btn) btn.disabled = false; return; }
    m.down = true; m.applying = true;
    render();
    schedule(1500);
  }

  // ---- helpers ---------------------------------------------------------------------
  function ago(d) {
    const s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  function bytes(n) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }
  function shortLicence(s) { return s.replace(/^LicenseRef-/, "").replace(/-only$|-or-later$/, ""); }

  // ---- the view switch ---------------------------------------------------------------
  function show(view) {
    const mods = view === "modules";
    // the view as a class on the page, never each section's own hidden: that
    // un-hid what the devices view keeps hidden (the module picker, a sound
    // browser with no device) on every switch back
    document.body.dataset.view = view;
    ["devices", "library", "modules", "setup"].forEach((v) => { const el = $(v + "-view"); if (el) el.hidden = v !== view; });
    if (view !== "devices" && window.PungDrawer) PungDrawer.close();
    document.title = { devices: "Pung", library: "Sounds · Pung", modules: "Modules · Pung", setup: "Setup · Pung" }[view] || "Pung";
    document.querySelectorAll(".views button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
    const want = view === "devices" ? "" : "#" + view;
    if (!(want && location.hash.startsWith(want)) && !(!want && !location.hash)) history.replaceState(null, "", want || location.pathname);
    if (mods) load(false);
    window.dispatchEvent(new CustomEvent("pung:view", { detail: { view } }));
  }

  function route() {
    const h = location.hash.match(/^#modules(?:\/(.+))?$/);
    if (h && h[1]) { m.wantOpen = decodeURIComponent(h[1]); if (m.data && m.data.modules.some((x) => x.id === m.wantOpen)) { const id = m.wantOpen; m.wantOpen = null; openSheet(id); } }
    show(h ? "modules" : location.hash.startsWith("#library") ? "library" : location.hash.startsWith("#setup") ? "setup" : "devices");
    return h;
  }

  // ---- pung.live: the Pung on your Push (site/pushlink.js: one connection for the whole site) ----
  const PP = window.PungPush || null;
  // the device in use (the visitor may have several: pushlink.js); read as it is now
  const push = PP ? new Proxy({}, { get: (_, k) => PP.state[k], set: (_, k, v) => { PP.state[k] = v; return true; } }) : { state: "off", addr: "push.local", data: null };
  const pushBase = () => (PP ? PP.base() : "");
  const pushFetch = (path, opts) => PP.fetch(path, opts);
  const openConnect = () => PP && PP.open();
  async function pushRead() {
    if (await PP.read()) { m.down = false; if (!push.data.restarting) m.applying = false; }
    else m.down = !!m.applying;
    push.restarting = !!m.applying;
  }
  // the site's catalog, and over it what the Push has: its install state, and
  // the version its own catalog would install
  function merged() {
    const site = m.site;
    if (!site) return null;
    if (!push.data || (push.state !== "on" && !m.applying)) return site;
    const by = new Map(push.data.modules.map((x) => [x.id, x]));
    const rows = site.modules.map((x) => {
      const p = by.get(x.id);
      if (!p) return { ...x, push_missing: true };
      return { ...x, status: p.status, installed: p.installed, version: p.version || x.version, job: p.job, managed: p.managed, needs_pung: p.needs_pung,
        in_use: p.in_use, repacked: p.repacked, asset_state: p.asset_state, assets_missing: p.assets_missing, assets_ready: p.assets_ready };
    });
    return { ...site, modules: rows, pending: push.data.pending, apply: push.data.apply, restarting: push.data.restarting };
  }
  const renderPush = () => PP && PP.renderChips();

  // pung.live: one view; #<id> opens a module's sheet
  function bootPublic() {
    if (PP) {
      // the chip counts the modules this page lists
      PP.setCounts(() => {
        const l = push.data && m.data ? m.data.modules : [];
        return { installed: l.filter((x) => x.installed).length, updates: l.filter((x) => x.status === "update").length };
      });
      PP.on(async (what, d) => {
        if (what === "dialog-closed") { if (push.state !== "trying") m.afterConnect = null; return; }
        if (d && d !== PP.state && what !== "removed") return; // another of the visitor's deployments: Your deployments shows it
        if (what === "selected") { await load(false); return; } // modules install on another device now
        if (what === "connected") {
          await load(false);
          if (m.afterConnect) { // Install was pressed before the Push was connected: now
            const id = m.afterConnect;
            m.afterConnect = null;
            const x = m.data.modules.find((r) => r.id === id);
            if (x && !x.push_missing && x.status === "available") install(id);
            else if (x) openSheet(id);
          }
          return;
        }
        if (what === "disconnected" || what === "removed" || push.state === "link" || push.state === "off") { m.data = merged(); render(); }
        if (push.state === "lost") schedule(8000);
      });
    }
    const want = () => { const id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
      if (m.data && m.data.modules.some((x) => x.id === id)) openSheet(id); else m.wantOpen = id; };
    $("mod-search").oninput = (e) => { m.q = e.target.value; render(); };
    document.querySelectorAll("#mod-types button").forEach((b) => (b.onclick = () => {
      m.filter = b.dataset.type;
      document.querySelectorAll("#mod-types button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      render();
    }));
    document.querySelectorAll("#mod-shows button").forEach((b) => (b.onclick = () => {
      m.show = m.show === b.dataset.show ? "all" : b.dataset.show;
      document.querySelectorAll("#mod-shows button").forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.show === m.show)));
      render();
    }));
    document.querySelectorAll("#mod-origins button").forEach((b) => (b.onclick = () => {
      m.origin = b.dataset.origin;
      document.querySelectorAll("#mod-origins button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      render();
    }));
    $("mod-sheet-close").onclick = () => $("mod-sheet").close();
    $("mod-sheet").addEventListener("close", () => { m.open = null; if (location.hash) history.replaceState(null, "", location.pathname); });
    $("mod-sheet").addEventListener("click", (e) => { if (e.target === $("mod-sheet")) $("mod-sheet").close(); });
    window.addEventListener("hashchange", want);
    $("mod-update-all").onclick = updateAll;
    want();
    loadShots();
    renderPush();
    load(false).then(() => {
      m.tried = true; render();
      // the Push it talked to before: again, without asking (the browser remembers the permission)
      if (PP) PP.resume();
    });
  }

  function boot() {
    if (PUBLIC) { bootPublic(); return; }
    // a view is a place in the history: Back leaves it, a link opens it
    document.querySelectorAll(".views button").forEach((b) => (b.onclick = () => {
      const v = b.dataset.view, want = v === "devices" ? location.pathname : "#" + v;
      if (document.body.dataset.view !== v) history.pushState(null, "", want);
      show(v);
    }));
    window.addEventListener("popstate", route);
    window.addEventListener("hashchange", route);
    $("mod-search").oninput = (e) => { m.q = e.target.value; render(); };
    document.querySelectorAll("#mod-types button").forEach((b) => (b.onclick = () => {
      m.filter = b.dataset.type;
      document.querySelectorAll("#mod-types button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      render();
    }));
    document.querySelectorAll("#mod-shows button").forEach((b) => (b.onclick = () => {
      m.show = m.show === b.dataset.show ? "all" : b.dataset.show;
      document.querySelectorAll("#mod-shows button").forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.show === m.show)));
      render();
    }));
    document.querySelectorAll("#mod-origins button").forEach((b) => (b.onclick = () => {
      m.origin = b.dataset.origin;
      document.querySelectorAll("#mod-origins button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      render();
    }));
    $("mod-refresh").onclick = () => load(true);
    $("mod-update-all").onclick = updateAll;
    $("mod-sheet-close").onclick = () => $("mod-sheet").close();
    $("mod-sheet").addEventListener("close", () => (m.open = null));
    $("mod-sheet").addEventListener("click", (e) => { if (e.target === $("mod-sheet")) $("mod-sheet").close(); });
    // #modules, or #modules/<id>: a module's sheet, to link to
    const h = route();
    // the updates badge, even while the Devices view is shown
    if (!h) api("/api/catalog").then((d) => {
      const n = (d.modules || []).filter((x) => x.supported && x.status === "update").length;
      const b = $("view-modules-badge");
      if (b) { b.textContent = n || ""; b.hidden = !n; }
    }).catch(() => {});
  }
  boot();
})();
