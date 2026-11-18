/* Pung on Push: Sounds, the library over every module (docs/PRESETS.md).
 *
 * Every module's own sounds and favourites, starred, renamed and deleted
 * without a device, loaded onto any Pung device in Live running that
 * module; the whole library exported as the folder a Move keeps, and
 * imported back sorted by module. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => fetch(path, opts).then((r) => r.json());
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KIND = { sound_generator: ["Instrument", ""], audio_fx: ["Audio effect", "afx"], midi_fx: ["MIDI effect", "midi"] };

  let mods = [], devices = [], q = "", show = "mine", ask = "", renaming = "";
  let rowsByKey = {}; // what each row's buttons act on

  async function load() {
    try {
      const [l, d] = await Promise.all([api("/api/library"), api("/api/pung-devices").catch(() => ({ devices: [] }))]);
      mods = l.modules || [];
      devices = d.devices || [];
    } catch (e) { $("lib-status").textContent = "Pung is not answering"; return; }
    render();
  }

  // a row's key, as it reads back from an attribute (a control character
  // does not: it comes back as U+FFFD, and no button found its row)
  const key = (m, name) => `${m}||${name}`;

  function render() {
    rowsByKey = {};
    const list = $("lib-list");
    const needle = q.trim().toLowerCase();
    const total = mods.reduce((n, m) => n + m.user.length, 0);
    const nmods = mods.filter((m) => m.user.length).length;
    $("lib-status").textContent = `${total} sound${total === 1 ? "" : "s"} of yours, in ${nmods} module${nmods === 1 ? "" : "s"}`;
    $("lib-export").hidden = !total;
    let html = "";
    let shown = 0;
    mods.forEach((m) => {
      // a module's rows: its own sounds, then its favourite factory sounds
      let rows = m.user.map((u) => ({ kind: "user", name: u.name, fav: u.fav, ref: { source: "user", name: u.name } }));
      m.favourites.filter((f) => f.source === "factory").forEach((f) => rows.push({
        kind: "factory", name: f.name || `#${f.index + 1}`, fav: true, ref: f, src: `Factory${f.bank ? " · " + f.bank : ""} · ${f.index + 1}`,
      }));
      if (needle) rows = rows.filter((r) => r.name.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle));
      if (!rows.length && (needle || show === "mine")) return;
      shown++;
      const [kind, cls] = KIND[m.type] || ["Module", ""];
      const devs = devices.filter((d) => m.devices.includes(d.n));
      const sub = [`${m.user.length} of yours`, m.favourites.length ? `${m.favourites.length} favourites` : "",
        m.named ? `${m.named} names known` : "", m.installed ? "" : "not installed"].filter(Boolean).join(" · ");
      html += `<section class="lib-mod ${cls}" data-module="${esc(m.id)}"><header><h3>${esc(m.name)}</h3><span class="sub">${esc(kind)} · ${esc(sub)}</span>` +
        `<span class="acts">${m.user.length ? `<a class="tool" href="/api/sounds/${encodeURIComponent(m.id)}/export" download>Export</a>` : ""}` +
        `<label class="tool file">Import…<input type="file" data-import="${esc(m.id)}" accept=".zip,.json,application/zip,application/json" multiple></label></span></header>`;
      if (!rows.length) { html += `<p class="sub">No sounds of yours yet: Save As in the device's Sound section, or on the Push, keeps one.</p></section>`; return; }
      html += `<ul class="lib-sounds">`;
      rows.forEach((r) => {
        const k = key(m.id, r.ref.source === "user" ? r.name : `f:${r.ref.bank}:${r.ref.index}`);
        const loadBtns = devs.map((d) => `<button type="button" class="tool small" data-act="load" data-dev="${d.n}" data-k="${esc(k)}" title="Load on ${esc(d.track || d.name)}">Load on ${esc(d.track || d.name)}</button>`).join("");
        let line;
        if (renaming === k) {
          line = `<input class="rename" data-k="${esc(k)}" value="${esc(r.name)}" aria-label="New name for ${esc(r.name)}"><button type="button" class="tool small" data-act="rename-ok" data-k="${esc(k)}">Rename</button><button type="button" class="tool small" data-act="rename-no">Cancel</button>`;
        } else if (ask === k) {
          line = `<span class="nm">${esc(r.name)}</span><span class="ask">Delete for good?</span><button type="button" class="ico" data-act="delete-no" id="lib-no">No</button><button type="button" class="ico yes" data-act="delete-yes" data-k="${esc(k)}">Yes</button>`;
        } else {
          line = `<span class="nm">${esc(r.name)}${r.src ? `<span class="src">${esc(r.src)}</span>` : ""}</span>${loadBtns}` +
            (r.kind === "user" ? `<button type="button" class="ico" data-act="rename" data-k="${esc(k)}" title="Rename" aria-label="Rename ${esc(r.name)}">Ren</button>` +
                                 `<button type="button" class="ico" data-act="delete" data-k="${esc(k)}" title="Delete" aria-label="Delete ${esc(r.name)}">Del</button>` : "") +
            `<button type="button" class="ico star" data-act="fav" data-k="${esc(k)}" aria-pressed="${r.fav}" aria-label="Favourite ${esc(r.name)}">${r.fav ? "★" : "☆"}</button>`;
        }
        html += `<li>${line}</li>`;
        rowsByKey[k] = { module: m.id, row: r };
      });
      html += `</ul></section>`;
    });
    if (!shown) html = `<div class="lib-empty">${needle ? "Nothing matches." : "No sounds of yours yet. Save As on a device keeps one; Import brings them from a Move or another Push."}</div>`;
    list.innerHTML = html;
    const inp = list.querySelector("input.rename");
    if (inp) { inp.focus(); inp.select(); }
    const no = $("lib-no");
    if (no) no.focus();
  }
  async function act(path, body, msg) {
    const r = await post(path, body);
    if (!r.ok) { $("lib-status").textContent = r.error || "That did not work."; return; }
    if (r.modules) mods = r.modules;
    render();
    if (msg) $("lib-status").textContent = msg;
  }

  async function onClick(e) {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const k = b.dataset.k, it = rowsByKey[k];
    const m = it && it.module, r = it && it.row;
    switch (b.dataset.act) {
      case "fav": return act(`/api/library/${encodeURIComponent(m)}/fav`, r.ref);
      case "rename": renaming = k; ask = ""; return render();
      case "rename-no": renaming = ""; return render();
      case "rename-ok": {
        const v = (document.querySelector("input.rename") || {}).value || "";
        renaming = "";
        if (v.trim() && v.trim() !== r.name) return act(`/api/library/${encodeURIComponent(m)}/rename`, { name: r.name, to: v.trim() }, "Renamed");
        return render();
      }
      case "delete": ask = k; renaming = ""; return render();
      case "delete-no": ask = ""; return render();
      case "delete-yes": ask = ""; return act(`/api/library/${encodeURIComponent(m)}/delete`, { name: r.name }, `Deleted ${r.name}`);
      case "load": {
        const res = await post(`/api/devices/${b.dataset.dev}/sounds/keep`, r.ref);
        $("lib-status").textContent = res.ok ? `Loaded ${r.name}` : res.error || "Could not load it";
        return;
      }
    }
  }

  async function importTo(module, files) {
    let added = 0, skipped = [];
    for (const f of files) {
      const url = module ? `/api/sounds/${encodeURIComponent(module)}/import` : "/api/library/import";
      const res = await fetch(url, { method: "POST", body: f }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!res.ok) { skipped.push(`${f.name}: ${res.error || "not read"}`); continue; }
      added += module ? res.added.length : res.count;
      skipped = skipped.concat(res.skipped || []);
    }
    await load();
    $("lib-status").textContent = `${added} sound${added === 1 ? "" : "s"} added` + (skipped.length ? ` · left out: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? "…" : ""}` : "");
  }

  function wire() {
    $("lib-list").addEventListener("click", onClick);
    $("lib-list").addEventListener("keydown", (e) => {
      if (e.target.matches("input.rename")) {
        if (e.key === "Enter") { e.preventDefault(); const ok = e.target.parentElement.querySelector('[data-act="rename-ok"]'); if (ok) ok.click(); }
        if (e.key === "Escape") { e.preventDefault(); renaming = ""; render(); }
      }
    });
    $("lib-list").addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.import && t.files.length) { importTo(t.dataset.import, [...t.files]); t.value = ""; }
    });
    $("lib-import").addEventListener("change", (e) => { if (e.target.files.length) importTo("", [...e.target.files]); e.target.value = ""; });
    $("lib-search").addEventListener("input", (e) => { q = e.target.value; render(); });
    document.querySelectorAll("#lib-shows button").forEach((b) => (b.onclick = () => {
      show = b.dataset.show;
      document.querySelectorAll("#lib-shows button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      render();
    }));
    window.addEventListener("pung:view", (e) => { if (e.detail.view === "library") load(); });
  }
  wire();
})();
