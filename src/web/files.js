/* Pung on Push: the file browser (docs/SAMPLES.md, "On the web page").
 *
 * A file parameter (a sample, a wavetable, a kit) is chosen here as on the
 * Push: the places along the top, folders and files below, a file is heard
 * where the cursor rests and becomes the device's only on Load; Cancel puts
 * back the file from before. The page adds what a Push has no hands for:
 * search, hearing a file on this computer, and bringing files onto the Push
 * (drop them on the list). */
(function () {
  "use strict";
  const api = (path, opts) => fetch(path, opts).then((r) => r.json()).catch(() => ({ ok: false, error: "The Push did not answer." }));
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const q = encodeURIComponent;
  const AUDITION_MS = 150;

  let dlg = null;
  // the browse: one at a time
  let S = null;

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "files";
    dlg.setAttribute("aria-labelledby", "fl-title");
    dlg.innerHTML = `
      <header class="fl-head">
        <h2 id="fl-title">Choose a file</h2>
        <span class="fl-cur" id="fl-cur"></span>
        <span class="grow"></span>
        <button type="button" class="ghost" id="fl-x" aria-label="Cancel and close">✕</button>
      </header>
      <div class="fl-tools">
        <div class="seg" id="fl-places" role="group" aria-label="Place"></div>
        <input type="search" id="fl-search" placeholder="Search this place" aria-label="Search this place" autocomplete="off">
      </div>
      <nav class="fl-crumbs" id="fl-crumbs" aria-label="Folder"></nav>
      <div class="fl-body">
        <div class="fl-list" id="fl-list" role="listbox" tabindex="0" aria-label="Files: arrows play, Enter loads or opens a folder, Backspace goes up, Escape cancels"></div>
        <aside class="fl-info" id="fl-info" aria-live="polite"></aside>
      </div>
      <footer class="fl-foot">
        <label class="fl-check"><input type="checkbox" id="fl-preview"> Play on the Push while browsing</label>
        <span class="fl-status" id="fl-status" aria-live="polite"></span>
        <span class="grow"></span>
        <label class="tool file" id="fl-upload-label">Add files…<input type="file" id="fl-upload" multiple></label>
        <button type="button" class="tool" id="fl-cancel">Cancel</button>
        <button type="button" class="act primary" id="fl-load">Load</button>
      </footer>
      <audio id="fl-audio" preload="none"></audio>`;
    document.body.appendChild(dlg);
    const $ = (id) => dlg.querySelector("#" + id);
    $("fl-x").onclick = $("fl-cancel").onclick = () => close(false);
    $("fl-load").onclick = () => load();
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(false); }); // Escape
    $("fl-preview").onchange = (e) => { S.preview = e.target.checked; post("/api/files/preview", { on: S.preview }); if (S.preview) audition(); else post(`${S.base}/files/audition`, { key: S.key, path: "" }); };
    let st = null;
    $("fl-search").oninput = (e) => { clearTimeout(st); st = setTimeout(() => { S.query = e.target.value.trim(); read(); }, 180); };
    const list = $("fl-list");
    list.addEventListener("keydown", onKey);
    list.addEventListener("click", (e) => {
      const star = e.target.closest("[data-fav]");
      const row = e.target.closest(".fl-row");
      if (!row) return;
      const i = +row.dataset.i;
      if (star) { fav(i); return; }
      move(i, true);
    });
    list.addEventListener("dblclick", (e) => { const row = e.target.closest(".fl-row"); if (row) enter(+row.dataset.i); });
    // files from the computer: dropped on the list, or chosen
    ["dragenter", "dragover"].forEach((t) => list.addEventListener(t, (e) => { if (S && S.canAdd) { e.preventDefault(); list.classList.add("drop"); } }));
    ["dragleave", "drop"].forEach((t) => list.addEventListener(t, () => list.classList.remove("drop")));
    list.addEventListener("drop", (e) => { if (S && S.canAdd) { e.preventDefault(); upload([...e.dataTransfer.files]); } });
    $("fl-upload").onchange = (e) => { upload([...e.target.files]); e.target.value = ""; };
  }

  const $ = (id) => dlg.querySelector("#" + id);

  /* open({base, key, name, onChange}): base "/api/devices/3", key "synth:sample_path" */
  async function open(o) {
    if (!dlg) build();
    const r = await post(`${o.base}/files/open`, { key: o.key });
    if (!r.ok) { PungToast(r.error || "This file cannot be chosen now.", true); return; }
    const f = r.file;
    S = { base: o.base, key: o.key, onChange: o.onChange, file: f, before: f.value, place: f.at.place, dir: f.at.dir || "",
          rows: [], crumbs: [], cursor: 0, query: "", preview: f.preview, timer: null, info: null, infoPath: "", canAdd: false, done: false };
    $("fl-title").textContent = `Choose ${f.audio ? (f.kind === "wavetable" ? "a wavetable" : "a sample") : "a file"}: ${f.name}`;
    $("fl-cur").textContent = f.shown ? `now: ${f.shown}` : "nothing loaded yet";
    $("fl-preview").checked = S.preview;
    $("fl-preview").closest("label").hidden = !f.audio;
    $("fl-search").value = "";
    $("fl-upload").accept = f.audio ? "audio/*," + f.filter.join(",") : f.filter.join(",");
    dlg.showModal();
    await read(f.value);
    $("fl-list").focus();
  }

  async function close(keep) {
    if (!S || S.done) return;
    S.done = true;
    clearTimeout(S.timer);
    $("fl-audio").pause();
    const s = S;
    dlg.close();
    if (!keep) {
      const r = await post(`${s.base}/files/cancel`, { key: s.key });
      if (s.onChange && r.ok) s.onChange(r.file.value, r.file.shown);
    }
  }

  async function load() {
    const row = S.rows[S.cursor];
    if (!row || row.dir || row.missing) return;
    $("fl-status").textContent = row.convert ? "Converting to WAV…" : "Loading…";
    $("fl-load").disabled = true;
    const r = await post(`${S.base}/files/load`, { key: S.key, path: row.path });
    $("fl-load").disabled = false;
    if (!r.ok) { $("fl-status").textContent = r.error || "That did not load."; return; }
    const s = S;
    S.done = true;
    $("fl-audio").pause();
    dlg.close();
    if (s.onChange) s.onChange(r.value, r.file.shown);
  }

  // ---- reading -------------------------------------------------------------
  async function read(select) {
    const place = S.file.places.find((p) => p.id === S.place) || S.file.places[0];
    S.place = place.id;
    let r;
    if (S.query) r = await api(`${S.base}/files/search?key=${q(S.key)}&place=${q(S.place)}&q=${q(S.query)}`);
    else r = await api(`${S.base}/files/list?key=${q(S.key)}&place=${q(S.place)}&dir=${q(S.dir)}`);
    if (!S || S.done) return;
    if (!r.ok) { S.rows = []; S.crumbs = []; S.canAdd = false; S.error = r.error; }
    else { S.rows = r.rows || []; S.crumbs = r.crumbs || []; S.canAdd = !!r.writable && !S.query; S.error = ""; S.more = !!r.more; }
    S.cursor = 0;
    if (select) { const i = S.rows.findIndex((x) => x.path === select); if (i >= 0) S.cursor = i; }
    render();
    showInfo();
  }

  // ---- drawing -------------------------------------------------------------
  function render() {
    const f = S.file;
    const seg = $("fl-places");
    seg.innerHTML = "";
    f.places.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `${esc(p.name)} <span class="count">${p.count}</span>`;
      b.setAttribute("aria-pressed", p.id === S.place ? "true" : "false");
      if (!p.count && !p.writable) b.classList.add("empty");
      b.onclick = () => { S.place = p.id; S.dir = ""; S.query = ""; $("fl-search").value = ""; read(); $("fl-list").focus(); };
      seg.appendChild(b);
    });
    const place = f.places.find((p) => p.id === S.place);
    // the crumbs: the place, then the folders
    const c = $("fl-crumbs");
    c.innerHTML = "";
    const crumb = (name, dir, last) => {
      const b = document.createElement(last ? "span" : "button");
      if (!last) { b.type = "button"; b.onclick = () => { S.dir = dir; S.query = ""; $("fl-search").value = ""; read(); }; }
      b.textContent = name;
      b.className = last ? "here" : "up";
      c.appendChild(b);
    };
    if (S.query) crumb(`"${S.query}" in ${place.name}`, "", true);
    else {
      crumb(place.name, "", !S.crumbs.length);
      S.crumbs.forEach((x, i) => { c.appendChild(document.createTextNode(" / ")); crumb(x.name, x.dir, i === S.crumbs.length - 1); });
    }
    $("fl-search").placeholder = `Search ${place.name}`;
    $("fl-search").disabled = !!place.virtual;
    $("fl-upload-label").hidden = !S.canAdd;
    drawList();
  }

  function drawList() {
    const box = $("fl-list");
    if (!S.rows.length) {
      const place = S.file.places.find((p) => p.id === S.place);
      let why = S.error || (S.query ? "Nothing here has that in its name." : "Nothing here for this device.");
      if (!S.error && !S.query && place.id === "favourites") why = "No favourites yet: the star on a file adds it.";
      if (!S.error && !S.query && place.id === "recent") why = "Nothing chosen yet.";
      if (!S.error && !S.query && S.canAdd) why = `Nothing here yet. Drop ${S.file.audio ? "audio" : ""} files here to put them on the Push, or add them in Live.`;
      box.innerHTML = `<div class="fl-empty">${esc(why)}</div>`;
      box.removeAttribute("aria-activedescendant");
      $("fl-load").disabled = true;
      $("fl-status").textContent = "";
      return;
    }
    let html = "";
    S.rows.forEach((r, i) => {
      const on = i === S.cursor;
      let tag = "";
      if (r.missing) tag = "gone";
      else if (r.path === S.before) tag = "current";
      else if (r.convert) tag = "to WAV";
      html += `<div class="fl-row${on ? " on" : ""}${r.dir ? " dir" : ""}${r.missing ? " gone" : ""}" role="option" id="fl-r${i}" aria-selected="${on}" data-i="${i}">` +
        `<span class="ic" aria-hidden="true">${r.dir ? "▸" : ""}</span>` +
        `<span class="nm">${esc(r.shown || r.name)}</span>` +
        (r.where ? `<span class="wh">${esc(r.where)}</span>` : "") +
        (tag ? `<span class="tg${tag === "current" ? " cur" : ""}">${tag}</span>` : "") +
        (r.dir ? `<span class="ct">${r.count}</span>` : `<button type="button" class="ico star" data-fav="1" aria-pressed="${!!r.fav}" title="Favourite" aria-label="Favourite ${esc(r.shown || r.name)}">${r.fav ? "★" : "☆"}</button>`) +
        `</div>`;
    });
    box.innerHTML = html;
    box.setAttribute("aria-activedescendant", "fl-r" + S.cursor);
    const el = box.querySelector(".fl-row.on");
    if (el) el.scrollIntoView({ block: "nearest" });
    const row = S.rows[S.cursor];
    $("fl-load").disabled = !row || !!row.dir || !!row.missing;
    const n = S.rows.filter((r) => !r.dir).length, d = S.rows.length - n;
    $("fl-status").textContent = [d ? `${d} folder${d === 1 ? "" : "s"}` : "", n ? `${n} file${n === 1 ? "" : "s"}` : "", S.more ? "the first 500 shown: search for less" : ""].filter(Boolean).join(" · ");
  }

  async function showInfo() {
    const box = $("fl-info");
    const row = S.rows[S.cursor];
    if (!row) { box.innerHTML = ""; return; }
    if (row.dir) {
      box.innerHTML = `<h3>${esc(row.name)}</h3><p class="facts">${row.count} ${S.file.audio ? "sample" : "file"}${row.count === 1 ? "" : "s"}</p><p class="hint">Enter or a double click opens it.</p>`;
      return;
    }
    if (row.missing) { box.innerHTML = `<h3>${esc(row.shown || row.name)}</h3><p class="facts">This file is no longer there.</p>`; return; }
    const path = row.path;
    box.innerHTML = `<h3>${esc(row.shown || row.name)}</h3><canvas class="wave" id="fl-wave" width="640" height="150" title="Click to listen on this computer, from there"></canvas>` +
      `<p class="facts" id="fl-facts">&nbsp;</p><p class="where">${esc(row.where || whereText())}</p>` +
      `<div class="fl-acts">${S.file.audio ? `<button type="button" class="tool" id="fl-listen">Listen here</button>` : ""}</div>` +
      (row.convert ? `<p class="hint">This device reads WAV only. Load makes a WAV of this file in your User Library (Samples / Converted) and loads that.</p>` : "") +
      (S.file.live_preview ? `<p class="hint">While you browse, this file is in the device: play it from the Push's pads.</p>` : "");
    const listen = dlg.querySelector("#fl-listen");
    if (listen) listen.onclick = () => listenHere(path, 0);
    const r = await api(`/api/files/info?path=${q(path)}`);
    if (!S || S.done || (S.rows[S.cursor] || {}).path !== path) return;
    if (!r.ok) return;
    S.info = r; S.infoPath = path;
    const facts = (r.facts || []).concat(r.size_text ? [r.size_text] : []);
    const el = dlg.querySelector("#fl-facts");
    if (el) el.innerHTML = facts.length ? `<b>${esc(facts[0])}</b>${facts.slice(1).map((x) => " · " + esc(x)).join("")}` : "&nbsp;";
    drawWave(r.peaks, 0);
    const cv = dlg.querySelector("#fl-wave");
    if (cv && S.file.audio) cv.onclick = (e) => { const b = cv.getBoundingClientRect(); listenHere(path, (e.clientX - b.left) / b.width); };
  }

  function whereText() {
    const place = S.file.places.find((p) => p.id === S.place);
    return [place.name].concat(S.crumbs.map((c) => c.name)).join(" / ");
  }

  // the outline, as the Push draws it; played: how far "Listen here" has got (0..1)
  function drawWave(peaks, played) {
    const cv = dlg.querySelector("#fl-wave");
    if (!cv) return;
    const g = cv.getContext("2d"), w = cv.width, h = cv.height, mid = h / 2;
    const css = getComputedStyle(dlg);
    const slot = css.getPropertyValue("--slot").trim() || "#ff8a1f", fg = css.getPropertyValue("--fg").trim() || "#ecebe5";
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(255,138,31,.25)";
    g.fillRect(0, mid, w, 1);
    if (!peaks || !peaks.max || !peaks.max.length) return;
    const n = peaks.max.length;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, peaks.max[i], -peaks.min[i]);
    if (peak < 1e-4) return;
    const gain = (mid - 3) / Math.max(peak, 0.05);
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x * n / w), b = Math.max(a + 1, Math.floor((x + 1) * n / w));
      let lo = 0, hi = 0;
      for (let i = a; i < b && i < n; i++) { lo = Math.min(lo, peaks.min[i]); hi = Math.max(hi, peaks.max[i]); }
      const y0 = mid - hi * gain, y1 = mid - lo * gain;
      g.fillStyle = x / w < played ? fg : slot;
      g.globalAlpha = x / w < played ? 0.9 : 0.6;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    g.globalAlpha = 1;
  }

  // ---- hearing ---------------------------------------------------------------
  // on the Push, through the device (as the Push's own browser previews)
  function audition() {
    clearTimeout(S.timer);
    const row = S.rows[S.cursor];
    S.timer = setTimeout(() => {
      if (!S || S.done) return;
      if (!row || row.dir || row.missing) { post(`${S.base}/files/audition`, { key: S.key, path: "" }); return; }
      post(`${S.base}/files/audition`, { key: S.key, path: row.path });
    }, AUDITION_MS);
  }

  // on this computer: the file itself, from where the outline was clicked
  function listenHere(path, from) {
    const a = $("fl-audio");
    const src = `/api/files/audio?path=${q(path)}`;
    const start = () => {
      if (isFinite(a.duration) && from > 0) a.currentTime = a.duration * from;
      a.play().catch(() => { $("fl-status").textContent = "This browser cannot play that format: it still plays on the Push."; });
    };
    a.ontimeupdate = () => { if (S && S.infoPath === path && S.info && isFinite(a.duration)) drawWave(S.info.peaks, a.currentTime / a.duration); };
    a.onended = () => { if (S && S.infoPath === path && S.info) drawWave(S.info.peaks, 0); };
    if (a.dataset.path === path && a.readyState > 0) { start(); return; }
    a.dataset.path = path;
    a.src = src;
    a.onloadedmetadata = start;
    a.load();
  }

  // ---- doing -----------------------------------------------------------------
  function move(to, play) {
    if (!S.rows.length) return;
    S.cursor = Math.max(0, Math.min(S.rows.length - 1, to));
    $("fl-audio").pause();
    drawList();
    showInfo();
    if (play) audition();
  }

  function enter(i) {
    const row = S.rows[i];
    if (!row) return;
    if (row.dir) { S.dir = row.path; S.query = ""; $("fl-search").value = ""; read(); return; }
    S.cursor = i;
    load();
  }

  function up() {
    if (S.query) { S.query = ""; $("fl-search").value = ""; read(); return; }
    if (!S.crumbs.length) return;
    const from = S.dir;
    S.dir = S.crumbs.length > 1 ? S.crumbs[S.crumbs.length - 2].dir : "";
    read(from);
  }

  async function fav(i) {
    const row = S.rows[i];
    if (!row || row.dir) return;
    const r = await post("/api/files/fav", { kind: S.file.kind, path: row.path });
    if (!r.ok) return;
    row.fav = r.fav;
    const p = S.file.places.find((x) => x.id === "favourites");
    if (p) p.count += r.fav ? 1 : -1;
    if (S.place === "favourites") read(); else render();
  }

  function onKey(e) {
    const page = 10;
    switch (e.key) {
      case "ArrowDown": move(S.cursor + 1, true); break;
      case "ArrowUp": move(S.cursor - 1, true); break;
      case "PageDown": move(S.cursor + page, true); break;
      case "PageUp": move(S.cursor - page, true); break;
      case "Home": move(0, true); break;
      case "End": move(S.rows.length - 1, true); break;
      case "Enter": enter(S.cursor); break;
      case "ArrowRight": if ((S.rows[S.cursor] || {}).dir) enter(S.cursor); break;
      case "ArrowLeft": case "Backspace": up(); break;
      case " ": { const r = S.rows[S.cursor]; if (r && !r.dir && S.file.audio) listenHere(r.path, 0); break; }
      default: return;
    }
    e.preventDefault();
  }

  // files from this computer into the folder shown (the User Library, or
  // the module's own folder)
  async function upload(files) {
    if (!files.length || !S.canAdd) return;
    let done = 0, last = "", refused = [];
    for (const f of files) {
      $("fl-status").textContent = `Sending ${f.name} (${done + 1} of ${files.length})…`;
      let r = await api(`${S.base}/files/upload?key=${q(S.key)}&dir=${q(S.dir)}&name=${q(f.name)}`, { method: "PUT", body: f });
      if (!r.ok && /already there/.test(r.error || "") && (await PungConfirm(`${f.name} is already there. Replace it?`, "Replace", true)))
        r = await api(`${S.base}/files/upload?key=${q(S.key)}&dir=${q(S.dir)}&name=${q(f.name)}&replace=1`, { method: "PUT", body: f });
      if (r.ok) { done++; last = r.path; } else refused.push(`${f.name}: ${r.error || "not sent"}`);
    }
    const again = await api(`${S.base}/files?key=${q(S.key)}`);
    if (again.ok && S) S.file.places = again.file.places;
    await read(last);
    $("fl-status").textContent = `${done} file${done === 1 ? "" : "s"} added` + (refused.length ? ` · ${refused.join("; ")}` : "");
    if (last) audition();
  }

  /* control(p, key, value, base, onChange): the control a device's page shows
   * for a file parameter: its outline and name; a click opens the browser. */
  function control(p, key, value, base, onChange) {
    const d = document.createElement("div");
    d.className = "ctl file";
    d.dataset.key = key;
    d.innerHTML = `<label>${esc(p.name || p.key)}</label><button type="button" class="fl-open"><canvas width="240" height="54" aria-hidden="true"></canvas><span class="nm"></span><span class="go">Browse…</span></button>`;
    const btn = d.querySelector("button"), nm = d.querySelector(".nm"), cv = d.querySelector("canvas");
    const show = async (v) => {
      d.dataset.value = v || "";
      const base = (v || "").split("/").pop();
      nm.textContent = base ? base.replace(/\.(wav|aiff?|aifc|flac|mp3|ogg|m4a|wt\d+)$/i, "") : "No file";
      const g = cv.getContext("2d");
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = "rgba(255,138,31,.25)";
      g.fillRect(0, cv.height / 2, cv.width, 1);
      if (!v) return;
      const r = await api(`/api/files/info?path=${q(v)}`);
      if (d.dataset.value !== v || !r.ok || !r.peaks) return;
      const n = r.peaks.max.length, mid = cv.height / 2;
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, r.peaks.max[i], -r.peaks.min[i]);
      if (peak < 1e-4) return;
      g.fillStyle = "#ff8a1f";
      for (let x = 0; x < cv.width; x++) {
        const a = Math.floor(x * n / cv.width), b = Math.max(a + 1, Math.floor((x + 1) * n / cv.width));
        let lo = 0, hi = 0;
        for (let i = a; i < b && i < n; i++) { lo = Math.min(lo, r.peaks.min[i]); hi = Math.max(hi, r.peaks.max[i]); }
        const k = (mid - 2) / Math.max(peak, 0.05);
        g.fillRect(x, mid - hi * k, 1, Math.max(1, (hi - lo) * k));
      }
    };
    d.showValue = show;
    btn.onclick = () => open({ base, key, onChange: (v) => { show(v); if (onChange) onChange(v); } });
    show(value);
    return d;
  }

  window.PungFiles = { open, control };
})();
