// Pung's module catalog page: reads catalog.json (scripts/build-catalog.py)
// and draws it. Filters by kind and category, searches, sorts; #<id> links
// to one module.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KINDS = [
    ["all", "All"], ["sound_generator", "Instruments"], ["audio_fx", "Audio FX"], ["midi_fx", "MIDI FX"],
  ];
  const KIND_LABEL = { sound_generator: "Instrument", audio_fx: "Audio FX", midi_fx: "MIDI FX" };
  const st = { mods: [], tax: {}, kind: "all", sub: "all", q: "", sort: "updated" };

  const date = (s) => {
    if (!s) return "";
    const d = new Date(s + (s.length === 10 ? "T12:00:00Z" : ""));
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  };
  const catLabel = (m) => {
    const list = (st.tax.subcategories || {})[m.component_type] || [];
    const f = list.find((x) => x.id === m.subcategory);
    return f ? f.label : (m.subcategory || "").replace(/-/g, " ");
  };
  // Schwung's catalogue tells Move users where to put a ROM; on the Push,
  // Pung's Modules page takes it
  const optional = (m) => /^\s*optional/i.test(m.requires || "");
  const requires = (m) => {
    const r = (m.requires || "").replace(/\s*\((?:place|put|copy)[^)]*\)\s*/gi, " ").replace(/^\s*optional:?\s*/i, "").trim().replace(/\.$/, "");
    if (!r) return "";
    return optional(m) ? `Optional: ${r}, added on the Push, in Pung.` : `Needs: ${r}. You add it on the Push, in Pung.`;
  };
  const needsFiles = (m) => {
    const a = m.assets ? (Array.isArray(m.assets) ? m.assets : [m.assets]) : [];
    return a.some((x) => (x.files || []).some((f) => f.required)) || ((m.tags || []).includes("needs-assets") && !optional(m));
  };
  const shortLic = (s) => (s || "").replace(/^LicenseRef-/, "").replace(/-only$|-or-later$/, "");
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  function card(m) {
    const cat = catLabel(m);
    const tags = (m.tags || []).filter((t) => t !== "needs-assets");
    const req = requires(m);
    return `<article class="card" id="${esc(m.id)}" tabindex="-1">
      <div class="head">
        <h3 class="name">${esc(m.name)}</h3>
        <div class="badges"><span class="badge kind">${esc(KIND_LABEL[m.component_type] || m.component_type)}</span>${cat ? `<span class="badge cat">${esc(cat)}</span>` : ""}</div>
      </div>
      <p class="desc" title="${esc(m.description)}">${esc(m.description)}</p>
      ${tags.length || needsFiles(m) ? `<div class="tags">${needsFiles(m) ? `<span class="pill need">needs files</span>` : ""}${tags.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="meta"><span class="by">by ${esc(m.author || "—")}</span><span class="v">v${esc(String(m.version).replace(/^v/, ""))}</span></div>
      ${m.released || m.updated ? `<div class="dates">${m.released ? `<span>Released ${date(m.released)}</span>` : ""}${m.updated ? `<span>Updated ${date(m.updated)}</span>` : ""}</div>` : ""}
      ${req ? `<p class="req">${esc(req)}</p>` : ""}
      <div class="foot-row">
        <span class="lic">${esc(shortLic(m.license && m.license.spdx))}${m.license && m.license.noncommercial ? ` <span class="pill">non-commercial</span>` : ""}</span>
        <span class="links">
          ${m.source && m.source.repo ? `<a href="${esc(m.source.repo)}" rel="noopener">Repo</a>` : ""}
          <a href="${esc(m.source && m.source.archive)}" title="The complete source of this build${m.source && m.source.archive_size ? ", " + size(m.source.archive_size) : ""}">Source</a>
          <a href="${esc(m.asset)}" title="The package Pung installs, ${size(m.size)}">Package</a>
        </span>
      </div>
    </article>`;
  }

  function filtered() {
    const q = st.q.trim().toLowerCase();
    const list = st.mods.filter((m) =>
      (st.kind === "all" || m.component_type === st.kind) &&
      (st.sub === "all" || m.subcategory === st.sub) &&
      (!q || [m.name, m.id, m.author, m.description, catLabel(m), (m.tags || []).join(" ")].join(" ").toLowerCase().includes(q)));
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      updated: (a, b) => (b.updated || "").localeCompare(a.updated || "") || a.name.localeCompare(b.name),
      released: (a, b) => (b.released || "").localeCompare(a.released || "") || a.name.localeCompare(b.name),
    }[st.sort];
    return list.sort(by);
  }

  function chips() {
    $("types").innerHTML = KINDS.map(([k, l]) => {
      const n = k === "all" ? st.mods.length : st.mods.filter((m) => m.component_type === k).length;
      return `<button type="button" data-k="${k}" aria-pressed="${st.kind === k}">${l}<span class="n">${n}</span></button>`;
    }).join("");
    $("types").querySelectorAll("button").forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; st.sub = "all"; draw(); }));
    // the categories this kind has modules in, in the taxonomy's order
    if (st.kind === "all") { $("subs").innerHTML = ""; return; }
    const have = new Set(st.mods.filter((m) => m.component_type === st.kind).map((m) => m.subcategory).filter(Boolean));
    const list = ((st.tax.subcategories || {})[st.kind] || []).filter((x) => have.has(x.id));
    $("subs").innerHTML = [`<button type="button" data-s="all" aria-pressed="${st.sub === "all"}">All ${esc(KINDS.find((k) => k[0] === st.kind)[1].toLowerCase())}</button>`]
      .concat(list.map((x) => `<button type="button" data-s="${esc(x.id)}" aria-pressed="${st.sub === x.id}">${esc(x.label)}</button>`)).join("");
    $("subs").querySelectorAll("button").forEach((b) => (b.onclick = () => { st.sub = b.dataset.s; draw(); }));
  }

  function draw() {
    chips();
    const list = filtered();
    $("count").textContent = `${list.length} module${list.length === 1 ? "" : "s"}`;
    $("grid").innerHTML = list.length ? list.map(card).join("") : `<p class="empty">No module matches.</p>`;
  }

  function focusHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (el && el.classList.contains("card")) {
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 2000);
    }
  }

  fetch("catalog.json", { cache: "no-cache" }).then((r) => r.json()).then((c) => {
    st.mods = (c.modules || []).filter((m) => KIND_LABEL[m.component_type]);
    st.tax = c.taxonomy || {};
    $("generated").textContent = c.generated_at ? `Catalog updated ${date(c.generated_at.slice(0, 10))}.` : "";
    $("q").oninput = (e) => { st.q = e.target.value; draw(); };
    $("sort").onchange = (e) => { st.sort = e.target.value; draw(); };
    draw();
    focusHash();
    window.addEventListener("hashchange", focusHash);
  }).catch(() => { $("grid").innerHTML = `<p class="empty">The catalog could not be read.</p>`; });
})();
