// modules.js: the Modules page. Installs, updates and removes modules from
// Pung's catalog, and takes the files a module needs that no package carries
// (ROMs). The API is src/modroutes.go; the rules are docs/UX-GUIDELINES.md.
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
  const m = { data: null, filter: "all", show: "all", q: "", open: null, timer: null, down: false, busy: {} };

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({ ok: false, error: r.statusText }));
    if (!r.ok && j.ok !== false) j.ok = false;
    return j;
  }

  // ---- data ----------------------------------------------------------------------
  async function load(refresh) {
    let d;
    try { d = await api("/api/catalog" + (refresh ? "?refresh=1" : "")); } catch (e) { d = null; }
    if (!d || !d.modules) {
      m.down = true; // Pung is starting again (Apply), or gone
      render();
      schedule(1000);
      return;
    }
    m.down = false;
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
      (m.show === "all" || (m.show === "installed" && x.installed) || (m.show === "updates" && x.status === "update")) &&
      (!q || [x.name, x.id, x.author, x.description, x.license && x.license.spdx].join(" ").toLowerCase().includes(q)));
  }

  function render() {
    const root = $("modules-view");
    if (!root || root.hidden) return;
    const d = m.data;
    renderStatus(d);
    renderBanner(d);
    const list = rows();
    const all = (d && d.modules || []).filter((x) => x.supported);
    const counts = { installed: all.filter((x) => x.installed).length, updates: all.filter((x) => x.status === "update").length };
    $("mod-count-installed").textContent = counts.installed;
    $("mod-count-updates").textContent = counts.updates;
    $("mod-search").placeholder = `Search ${all.length} modules`;
    const grid = $("mod-grid");
    if (!d) { grid.innerHTML = `<div class="empty">Reading the catalog…</div>`; return; }
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
    if (m.open) renderSheet();
  }

  function renderStatus(d) {
    const s = $("mod-status");
    if (m.down) { s.innerHTML = `<span class="warn">Pung is starting again…</span>`; return; }
    if (!d) { s.textContent = ""; return; }
    const c = d.catalog || {};
    const when = c.fetched_at ? ago(new Date(c.fetched_at)) : "";
    if (c.offline && c.have) s.innerHTML = `<span class="warn">Offline</span> · the catalog as read ${esc(when)} · ${esc(c.error || "")}`;
    else if (c.offline) s.innerHTML = `<span class="warn">The catalog cannot be read</span> · ${esc(c.error || "")}`;
    else s.textContent = `Catalog updated ${c.generated_at ? ago(new Date(c.generated_at)) : "?"}`;
  }

  function renderBanner(d) {
    const b = $("mod-banner");
    const ap = d && d.apply;
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
    if (x.license && x.license.spdx) out.push(`<span class="tag" title="Licence: ${esc(x.license.from || "")}">${esc(shortLicence(x.license.spdx))}</span>`);
    if (x.license && x.license.noncommercial) out.push(`<span class="tag" title="May not be sold or used commercially">Non-commercial</span>`);
    if (needsFiles(x)) out.push(`<span class="tag need" title="${esc(needText(x))}">${x.installed && !x.assets_ready ? "ROM missing" : "Needs ROM"}</span>`);
    if (x.in_use) out.push(`<span class="tag">In your Set${x.in_use > 1 ? " ×" + x.in_use : ""}</span>`);
    return out.join("");
  }

  function action(x) {
    const j = x.job;
    if (j && !["done", "failed"].includes(j.state)) {
      const pct = j.state === "downloading" && j.total ? Math.round((100 * j.done) / j.total) : null;
      return `<div class="progress" role="progressbar" aria-label="${esc(STATE[j.state] || j.state)}" ${pct !== null ? `aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"` : ""}>
        <i style="width:${pct !== null ? pct : 100}%" class="${pct === null ? "indet" : ""}"></i></div>
        <span class="pstate">${esc(STATE[j.state] || j.state)}${pct !== null ? " " + pct + "%" : "…"}</span>`;
    }
    if (j && j.state === "failed") return `<button type="button" class="act retry" data-act="install">Try again</button>`;
    if (x.status === "update") return `<button type="button" class="act primary" data-act="install">Update to ${esc(x.version)}</button>`;
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
    return `<article class="mod ${t.cls}" data-id="${esc(x.id)}" tabindex="0" aria-label="${esc(x.name)}, ${esc(t.label)}">
      <h3>${esc(x.name)}</h3>
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
    m.open = id;
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
    const facts = [
      ["Version", x.installed ? (x.status === "update" ? `${x.installed} installed, ${x.version} available` : x.installed) : x.version],
      ["Category", catLabel(x) || "—"],
      ["Released", x.released ? fmtDate(x.released) : "—"],
      ["Updated", x.updated ? fmtDate(x.updated) : "—"],
      ["Licence", x.license && x.license.spdx ? `${x.license.spdx}${x.license.noncommercial && !/commercial/i.test(x.license.spdx) ? " (non-commercial)" : ""}` : "—"],
      ["Size", x.size ? `${(x.size / 1024).toFixed(0)} KB` : "—"],
    ];
    const links = [];
    if (src.repo) links.push(`<a href="${esc(src.repo)}" target="_blank" rel="noopener">Repository</a>`);
    if (src.archive) links.push(`<a href="${esc(base + "/" + src.archive)}">Source of this build${src.archive_size ? ` (${(src.archive_size / 1048576).toFixed(1)} MB)` : ""}</a>`);
    body.innerHTML = `
      <header class="sheet-head ${t.cls}">
        <span class="kind">${esc(t.label)}</span>
        <h2 id="mod-sheet-title">${esc(x.name)}</h2>
        <p class="by">${esc(x.author || "")}</p>
      </header>
      <p class="desc">${esc(x.description || "")}</p>
      <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${links.length ? `<p class="links">${links.join(" · ")}</p>` : ""}
      ${x.requires && !specs(x).length && !(x.asset_state || []).length ? `<p class="req">${esc(x.requires)}</p>` : ""}
      ${assetsSection(x)}
      ${x.job && x.job.state === "failed" ? `<p class="err" role="alert">${esc(x.job.error)}</p>` : ""}
      <div class="sheet-actions">
        ${x.managed ? `<button type="button" class="danger" id="mod-remove">Remove</button>` : ""}
        <span class="grow"></span>
        ${action(x)}
      </div>
      <p class="err" id="mod-sheet-msg" role="alert" hidden></p>`;
    body.querySelectorAll("button[data-act]").forEach((b) => (b.onclick = () => install(x.id)));
    if ($("mod-remove")) $("mod-remove").onclick = () => remove(x);
    body.querySelectorAll(".drop").forEach((z) => wireDrop(z, x));
    body.querySelectorAll("button[data-del]").forEach((b) => (b.onclick = () => delAsset(x, b.dataset.path, b.dataset.del)));
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
    if (!x.installed) {
      const sp = specs(x).filter((a) => (a.files || []).some((f) => f.required) || a.description);
      if (!sp.length) return "";
      return `<section class="assets"><h3>Files it needs</h3>${sp.map((a) =>
        `<p>${esc(a.description || a.label)}</p>`).join("")}<p class="sub">Install it first; then add them here. Pung never downloads them: they are yours to add.</p></section>`;
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
    if (!confirm(`Remove ${name} from ${x.name}?`)) return;
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
    const r = await api(`/api/catalog/${encodeURIComponent(id)}/install`, { method: "POST" });
    if (!r.ok) alert(r.error);
    load(false);
  }
  async function remove(x) {
    if (!confirm(`Remove ${x.name}? Its files (ROMs, banks) are kept, and come back if you install it again.`)) return;
    const r = await api(`/api/catalog/${encodeURIComponent(x.id)}/remove`, { method: "POST" });
    if (!r.ok) { say(r.error, true); return; }
    load(false);
  }
  async function apply() {
    const btn = $("mod-apply");
    if (btn) btn.disabled = true;
    const r = await api("/api/catalog/apply", { method: "POST" });
    if (!r.ok) { alert(r.error); if (btn) btn.disabled = false; return; }
    m.down = true;
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
  function shortLicence(s) { return s.replace(/^LicenseRef-/, "").replace(/-only$|-or-later$/, ""); }

  // ---- the view switch ---------------------------------------------------------------
  function show(view) {
    const mods = view === "modules";
    document.querySelectorAll("[data-view-of=devices]").forEach((el) => (el.hidden = mods));
    $("modules-view").hidden = !mods;
    document.querySelectorAll(".views button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
    if (!(mods && location.hash.startsWith("#modules")) && !(!mods && !location.hash)) history.replaceState(null, "", mods ? "#modules" : location.pathname);
    if (mods) load(false);
  }

  function boot() {
    document.querySelectorAll(".views button").forEach((b) => (b.onclick = () => show(b.dataset.view)));
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
    $("mod-refresh").onclick = () => load(true);
    $("mod-sheet-close").onclick = () => $("mod-sheet").close();
    $("mod-sheet").addEventListener("close", () => (m.open = null));
    $("mod-sheet").addEventListener("click", (e) => { if (e.target === $("mod-sheet")) $("mod-sheet").close(); });
    // #modules, or #modules/<id>: a module's sheet, to link to
    const h = location.hash.match(/^#modules(?:\/(.+))?$/);
    if (h && h[1]) m.wantOpen = decodeURIComponent(h[1]);
    show(h ? "modules" : "devices");
    // the updates badge, even while the Devices view is shown
    if (!h) api("/api/catalog").then((d) => {
      const n = (d.modules || []).filter((x) => x.supported && x.status === "update").length;
      const b = $("view-modules-badge");
      if (b) { b.textContent = n || ""; b.hidden = !n; }
    }).catch(() => {});
  }
  boot();
})();
