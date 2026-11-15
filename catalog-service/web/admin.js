// The catalog's admin page (catalog-service/server.go is its API).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KIND = { sound_generator: "Instrument", audio_fx: "Audio FX", midi_fx: "MIDI FX" };
  const STATUS = {
    new: "new", update: "update", staged: "built", current: "current", failed: "failed", withheld: "withheld", unknown: "no release",
  };
  const FILTERS = [["todo", "Needs attention"], ["all", "All"], ["staged", "Built"], ["failed", "Failed"], ["withheld", "Withheld"]];
  const st = { d: null, filter: "todo", q: "", sel: new Set(), timer: null, logId: null, logWhich: "job", ovr: [] };

  async function api(path, body) {
    const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Pung-Admin": "1" }, body: JSON.stringify(body) };
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({ ok: false, error: r.statusText }));
    if (r.status === 401) { showGate(false); throw new Error("signed out"); }
    if (!r.ok && j.ok !== false) j.ok = false;
    return j;
  }
  const ago = (iso) => {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 172800) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  };

  // ---- sign in / set up -----------------------------------------------------------
  function showGate(setup) {
    $("app").hidden = true; $("nav").hidden = true; $("gate").hidden = false;
    $("gate-title").textContent = setup ? "Set up the admin" : "Sign in";
    $("gate-intro").textContent = setup ? "No admin exists yet. The setup code is in the container's log (DSM: Docker › Container › pung-catalog › Details › Log)." : "";
    $("code-row").hidden = !setup; $("pass2-row").hidden = !setup;
    $("pass").autocomplete = setup ? "new-password" : "current-password";
    $("gate-go").textContent = setup ? "Create the admin" : "Sign in";
    $("gate-form").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("gate-err");
      err.hidden = true;
      if (setup && $("pass").value !== $("pass2").value) { err.textContent = "The two passwords differ."; err.hidden = false; return; }
      $("gate-go").disabled = true;
      const r = await api(setup ? "/api/setup" : "/api/login", { code: $("code").value, user: $("user").value, password: $("pass").value }).catch(() => ({ ok: false, error: "no answer" }));
      $("gate-go").disabled = false;
      if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
      $("pass").value = $("pass2").value = $("code").value = "";
      start();
    };
    (setup ? $("code") : $("user")).focus();
  }

  // ---- the dashboard --------------------------------------------------------------
  async function load() {
    let d;
    try { d = await api("/api/overview"); } catch (e) { return; }
    if (!d.ok) return;
    st.d = d;
    draw();
    clearTimeout(st.timer);
    const busy = d.builder && (d.builder.current || (d.builder.queue || []).length);
    st.timer = setTimeout(load, busy ? 3000 : 20000);
    if (st.logId && $("log-dlg").open) loadLog();
  }

  function draw() {
    const d = st.d;
    const rows = d.rows || [];
    const count = (f) => rows.filter((r) => match(r, f)).length;
    $("t-live").textContent = d.live.modules;
    $("t-live-s").textContent = d.live.at ? "published " + ago(d.live.at) : "";
    $("site-link").href = d.live.url + "/";
    $("t-up").textContent = d.upstream.modules || "–";
    $("t-up-s").textContent = d.upstream.error ? "can't read: " + d.upstream.error : d.upstream.checked ? "checked " + ago(d.upstream.checked) : "not checked yet";
    const nNew = rows.filter((r) => r.status === "new").length, nUp = rows.filter((r) => r.status === "update").length;
    $("t-todo").textContent = nNew + nUp;
    $("t-todo-s").textContent = `${nNew} new · ${nUp} update${nUp === 1 ? "" : "s"}`;
    $("build-changes").disabled = !(nNew + nUp);
    const df = d.diff, nChange = df.added.length + df.updated.length + df.removed.length;
    $("t-pub").textContent = nChange;
    $("t-pub-s").textContent = nChange ? `${df.added.length} new · ${df.updated.length} updated${df.removed.length ? " · " + df.removed.length + " removed" : ""}` : "nothing waiting";
    document.querySelector(".tile.hot").classList.toggle("on", nChange > 0);

    // building
    const b = d.builder;
    $("building-panel").hidden = !(b.current || (b.queue || []).length);
    if (!$("building-panel").hidden) {
      const c = b.current;
      $("building").innerHTML = (c ? `<div class="job"><span class="spin" aria-hidden="true"></span><b>${esc(nameOf(c.id))}</b>
          <span class="muted">${esc(c.step)} · started ${esc(ago(c.started))}</span>
          <button type="button" class="ghost" data-log="${esc(c.id)}">Log</button></div>` : "") +
        ((b.queue || []).length ? `<p class="muted">Next:</p><ul class="queue">${b.queue.map((j) => `<li>${esc(nameOf(j.id))}<button type="button" data-cancel="${esc(j.id)}" aria-label="Take ${esc(nameOf(j.id))} out of the queue">✕</button></li>`).join("")}</ul>` : "");
    }

    // filters
    $("filters").innerHTML = FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${st.filter === k}">${l}<span class="n">${count(k)}</span></button>`).join("");
    // rows
    const q = st.q.trim().toLowerCase();
    const shown = rows.filter((r) => match(r, st.filter) && (!q || (r.name + " " + r.id + " " + r.author).toLowerCase().includes(q)));
    $("rows").innerHTML = shown.length ? shown.map(row).join("") : `<tr><td colspan="8" class="muted">Nothing here.</td></tr>`;
    $("all").checked = shown.length > 0 && shown.every((r) => st.sel.has(r.id));
    $("bulk").hidden = !st.sel.size;
    $("bulk-n").textContent = `${st.sel.size} selected`;

    // publish
    const lst = (title, l, fmt) => l.length ? `<div><h3>${title}</h3><ul>${l.map(fmt).join("")}</ul></div>` : "";
    $("diff").innerHTML = nChange ? `<div class="diff">
        ${lst("New", df.added, (c) => `<li>${esc(c.Name)} <span class="v">${esc(c.To)}</span></li>`)}
        ${lst("Updated", df.updated, (c) => `<li>${esc(c.Name)} <span class="v">${esc(c.From)} → ${esc(c.To)}</span></li>`)}
        ${lst("Removed", df.removed, (c) => `<li>${esc(c.Name)} <span class="v">${esc(c.From)}</span></li>`)}</div>`
      : `<p class="muted">The staging catalog is what the site has. Build something to change it.</p>`;
    $("do-publish").disabled = !nChange;
    $("discard").disabled = !nChange;

    // history
    $("history").innerHTML = (d.history || []).length ? d.history.map((h) => `<li><span>${esc(new Date(h.at).toLocaleString())} <span class="muted">· ${h.modules} modules</span></span>
        <button type="button" class="ghost" data-restore="${esc(h.name)}">Restore</button></li>`).join("") : `<li class="muted">Nothing published from here yet.</li>`;
  }

  function match(r, f) {
    if (f === "all") return true;
    if (f === "todo") return ["new", "update", "failed"].includes(r.status);
    return r.status === f;
  }
  function nameOf(id) { const r = (st.d.rows || []).find((x) => x.id === id); return r ? r.name : id; }

  function row(r) {
    const s = STATUS[r.status] || r.status;
    const canBuild = r.status !== "withheld" || true;
    return `<tr>
      <td><input type="checkbox" data-sel="${esc(r.id)}" ${st.sel.has(r.id) ? "checked" : ""} aria-label="Select ${esc(r.name)}"></td>
      <td><b>${esc(r.name)}</b> <span class="id">${esc(r.id)}</span>${r.override ? ` <span class="badge alt" title="${esc(r.repo + " " + r.branch)}">fork</span>` : ""}
        ${r.why ? `<div class="why">${esc(r.why)}</div>` : ""}</td>
      <td><span class="badge">${esc(KIND[r.kind] || r.kind)}</span></td>
      <td class="v">${esc(r.live || "–")}</td>
      <td class="v">${esc(r.schwung || "–")}</td>
      <td><span class="st ${esc(r.status)}">${esc(s)}</span></td>
      <td class="v">${esc((r.licence || "").replace(/-or-later$|-only$/, "") || "")}</td>
      <td><div class="acts">${canBuild ? `<button type="button" data-build="${esc(r.id)}">${r.status === "current" || r.status === "staged" ? "Rebuild" : "Build"}</button>` : ""}
        ${r.built_at || r.last_error ? `<button type="button" data-log="${esc(r.id)}">Log</button>` : ""}</div></td>
    </tr>`;
  }

  // ---- actions --------------------------------------------------------------------
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.f) { st.filter = t.dataset.f; draw(); }
    else if (t.dataset.build) { await api("/api/build", { ids: [t.dataset.build] }); load(); }
    else if (t.dataset.cancel) { await api("/api/cancel/" + encodeURIComponent(t.dataset.cancel), {}); load(); }
    else if (t.dataset.log && t.closest("#log-dlg")) { st.logWhich = t.dataset.log; document.querySelectorAll("#log-dlg [data-log]").forEach((b) => b.setAttribute("aria-pressed", String(b === t))); loadLog(); }
    else if (t.dataset.log) { openLog(t.dataset.log); }
    else if (t.dataset.restore) {
      if (!confirm("Make this catalog the site's catalog again? The current one is kept in this list.")) return;
      const r = await api("/api/restore/" + encodeURIComponent(t.dataset.restore), {});
      if (!r.ok) alert(r.error);
      load();
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.sel) { t.checked ? st.sel.add(t.dataset.sel) : st.sel.delete(t.dataset.sel); draw(); }
  });
  $("all").onchange = () => {
    const q = st.q.trim().toLowerCase();
    (st.d.rows || []).filter((r) => match(r, st.filter) && (!q || (r.name + " " + r.id).toLowerCase().includes(q)))
      .forEach((r) => ($("all").checked ? st.sel.add(r.id) : st.sel.delete(r.id)));
    draw();
  };
  $("q").oninput = (e) => { st.q = e.target.value; draw(); };
  $("build-selected").onclick = async () => { await api("/api/build", { ids: [...st.sel] }); st.sel.clear(); load(); };
  $("build-changes").onclick = async () => { const r = await api("/api/build", { changes: true }); if (!r.ok) alert(r.error); load(); };
  $("check").onclick = async () => { $("check").disabled = true; const r = await api("/api/check", {}); $("check").disabled = false; if (!r.ok) alert(r.error); load(); };
  $("do-publish").onclick = async () => {
    const df = st.d.diff;
    if (!confirm(`Publish ${df.added.length + df.updated.length + df.removed.length} change(s) to ${st.d.live.url}? Every Push sees them the next time it checks.`)) return;
    $("do-publish").disabled = true;
    const r = await api("/api/publish", {});
    if (!r.ok) alert(r.error);
    load();
  };
  $("discard").onclick = async () => { if (confirm("Throw away what is built and not published? The site keeps what it has.")) { await api("/api/discard", {}); load(); } };
  $("sign-out").onclick = async () => { await api("/api/logout", {}).catch(() => {}); showGate(false); };

  // ---- logs -------------------------------------------------------------------------
  function openLog(id) {
    st.logId = id;
    $("log-title").textContent = nameOf(id) + ": log";
    $("log-body").textContent = "…";
    $("log-dlg").showModal();
    loadLog();
  }
  async function loadLog() {
    const r = await api("/api/log/" + encodeURIComponent(st.logId));
    const pre = $("log-body"), atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
    pre.textContent = (st.logWhich === "build" ? r.build : r.job) || "(empty)";
    if (atEnd) pre.scrollTop = pre.scrollHeight;
  }
  $("log-close").onclick = () => $("log-dlg").close();
  $("log-dlg").addEventListener("close", () => (st.logId = null));

  // ---- settings --------------------------------------------------------------------
  $("open-settings").onclick = () => {
    const s = st.d.settings;
    $("nightly").innerHTML = [`<option value="-1">Off</option>`].concat([...Array(24).keys()].map((h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`)).join("");
    $("nightly").value = String(s.nightly_at);
    st.ovr = Object.entries(s.overrides || {}).map(([id, o]) => ({ id, repo: o.repo, branch: o.branch, why: o.why }));
    drawOvr();
    $("settings-dlg").showModal();
  };
  function drawOvr() {
    $("ovr").innerHTML = st.ovr.map((o, i) => `<tr>
      <td><input data-o="${i}" data-k="id" value="${esc(o.id)}" aria-label="Module id"></td>
      <td><input data-o="${i}" data-k="repo" value="${esc(o.repo)}" placeholder="owner/name" aria-label="Repository"></td>
      <td><input data-o="${i}" data-k="branch" value="${esc(o.branch)}" placeholder="main" aria-label="Branch"></td>
      <td><button type="button" class="ghost" data-odel="${i}" aria-label="Remove">✕</button></td></tr>`).join("");
    $("ovr").querySelectorAll("input").forEach((inp) => (inp.oninput = () => (st.ovr[inp.dataset.o][inp.dataset.k] = inp.value)));
    $("ovr").querySelectorAll("[data-odel]").forEach((b) => (b.onclick = () => { st.ovr.splice(+b.dataset.odel, 1); drawOvr(); }));
  }
  $("ovr-add").onclick = () => { st.ovr.push({ id: "", repo: "", branch: "main", why: "" }); drawOvr(); };
  $("set-save").onclick = async () => {
    const overrides = {};
    st.ovr.filter((o) => o.id && o.repo).forEach((o) => (overrides[o.id.trim()] = { repo: o.repo, branch: o.branch || "main", why: o.why || "" }));
    const r = await api("/api/settings", { nightly_at: +$("nightly").value, overrides });
    if (!r.ok) { alert(r.error); return; }
    $("settings-dlg").close();
    load();
  };
  $("set-close").onclick = () => $("settings-dlg").close();
  $("pw-form").onsubmit = async (e) => {
    e.preventDefault();
    const r = await api("/api/password", { old: $("pw-old").value, new: $("pw-new").value });
    if (!r.ok) { $("pw-err").textContent = r.error; $("pw-err").hidden = false; return; }
    alert("Password changed. Sign in again.");
    $("settings-dlg").close();
    showGate(false);
  };

  // ---- start ------------------------------------------------------------------------
  async function start() {
    const s = await fetch("/api/session").then((r) => r.json()).catch(() => ({}));
    if (!s.signed_in) { showGate(!!s.setup); return; }
    $("gate").hidden = true; $("app").hidden = false; $("nav").hidden = false;
    load();
  }
  start();
})();
