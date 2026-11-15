/* Pung on Push: the Sounds section (docs/PRESETS.md, "On the web page").
 *
 * The selected device's sounds, as on the Push: Factory, User, Favourites,
 * Recent; a bank, a search; a sound plays where the cursor rests, Load keeps
 * it, Cancel puts back the sound from before. A list of 4133 is drawn as a
 * window of rows (the ones in view), never as 4133 elements. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => fetch(path, opts).then((r) => r.json());
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ROW = 32, AUDITION_MS = 150;
  const SOURCES = [["factory", "Factory"], ["user", "User"], ["favourites", "Favourites"], ["recent", "Recent"]];

  let dev = -1, v = null, source = "factory", filter = "", cursor = 0, sig = "", timer = null, compare = false;
  let rows = [];
  let askDelete = -1; // the row asking "Delete?"
  let formDo = null;  // what the name form does on Save

  const refKey = (r) => (r.source === "user" ? "u:" + r.name : `f:${r.bank || ""}:${r.index}`);
  const same = (a, b) => a && b && a.source === b.source && (a.source === "user" ? a.name === b.name : (a.bank || "") === (b.bank || "") && a.index === b.index);

  function buildRows() {
    if (!v) return [];
    const favs = new Set((v.favourites || []).map(refKey));
    let out = [];
    if (source === "factory" && v.factory) {
      const f = v.factory, names = f.names || {};
      for (let i = 0; i < Math.max(0, f.count); i++) {
        const ref = { source: "factory", bank: f.bank || "", index: i, name: names[i] || "" };
        out.push({ ref, num: i + 1, name: names[i] || "", fav: favs.has(refKey(ref)) });
      }
    } else if (source === "user") {
      out = (v.user || []).map((u, i) => ({ ref: { source: "user", name: u.name }, num: i + 1, name: u.name, fav: !!u.fav, user: true }));
    } else if (source === "favourites" || source === "recent") {
      out = ((source === "recent" ? v.recent : v.favourites) || []).map((r) => ({
        ref: r, num: r.source === "factory" ? r.index + 1 : 0, name: r.name || "", fav: favs.has(refKey(r)),
        tag: r.source === "user" ? "User" : (r.bank || "Factory"), user: r.source === "user",
      }));
    }
    const q = filter.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || String(r.num) === q);
    return out;
  }

  // ---- reading -----------------------------------------------------------
  async function load(keepCursor) {
    if (dev < 0) return;
    let r;
    try { r = await api(`/api/devices/${dev}/sounds`); } catch (e) { return; }
    if (!r.ok) { hide(); return; }
    const first = !v || v.module !== r.sounds.module;
    v = r.sounds;
    if (first) {
      source = v.factory ? "factory" : "user";
      if (v.current && v.current.source === "user") source = "user";
      filter = ""; $("snd-search").value = "";
    }
    render(first || !keepCursor);
  }

  function hide() { $("sounds").hidden = true; }

  // ---- drawing -----------------------------------------------------------
  function render(placeCursor) {
    const sec = $("sounds");
    if (!v || (!v.factory && !v.has_state)) { sec.hidden = true; return; }
    sec.hidden = false;
    const cur = v.current;
    $("snd-cur").innerHTML = cur && cur.name ? `${v.edited ? '<span class="edited" title="Changed since">*</span> ' : ""}${esc(cur.name)}` : '<span class="muted">no sound chosen yet</span>';
    // the sources
    const seg = $("snd-sources");
    seg.innerHTML = "";
    SOURCES.forEach(([id, label]) => {
      if (id === "factory" && !v.factory) return;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", id === source ? "true" : "false");
      b.onclick = () => { source = id; cursor = 0; render(true); $("snd-list").focus(); };
      seg.appendChild(b);
    });
    // the bank
    const sel = $("snd-bank");
    const f = v.factory;
    const banks = source === "factory" && f && f.banks && f.banks.length ? f.banks : null;
    sel.hidden = !banks;
    if (banks) {
      const at = bankIndex(f);
      sel.innerHTML = banks.map((b, i) => `<option value="${b.index}"${i === at ? " selected" : ""}>${esc(b.name)}</option>`).join("") +
        (at < 0 ? `<option value="" selected disabled>${esc(f.bank || "Bank")}</option>` : "");
    }
    // the actions that need a user sound
    const canSave = cur && cur.source === "user" && !v.browsing;
    $("snd-save").disabled = !canSave;
    $("snd-saveas").disabled = !v.has_state;
    $("snd-export").hidden = !(v.user && v.user.length);
    $("snd-export").href = `/api/sounds/${encodeURIComponent(v.module)}/export`;
    $("snd-cancel").disabled = !v.browsing;
    rows = buildRows();
    if (placeCursor) {
      cursor = 0;
      const want = source === "factory" && f ? f.index : -1;
      const i = rows.findIndex((r) => (want >= 0 ? r.ref.index === want : cur && same(r.ref, cur)));
      if (i >= 0) cursor = i;
    }
    cursor = Math.max(0, Math.min(rows.length - 1, cursor));
    drawList(placeCursor);
    $("snd-status").textContent = status();
  }

  function bankIndex(f) {
    let at = f.banks.findIndex((b) => b.name === f.bank || (f.bank_index >= 0 && b.index === f.bank_index));
    if (at < 0 && f.bank) at = f.banks.findIndex((b) => b.name.toLowerCase().includes(f.bank.toLowerCase()));
    return at;
  }

  function status() {
    if (!v) return "";
    const f = v.factory;
    if (source === "factory" && f) {
      if (f.count < 0) return "The module is still loading its sounds.";
      const named = Object.keys(f.names || {}).length;
      const tail = f.all_named || named >= f.count ? "" : ` · ${named} named so far: a sound's name appears once it has played`;
      const match = filter.trim() ? `${rows.length} of ` : "";
      return `${match}${f.count} sounds${f.mode ? " · " + f.mode + " mode" : ""}${tail}`;
    }
    if (source === "user") return v.user.length ? `${v.user.length} sound${v.user.length === 1 ? "" : "s"} of yours · Schwung's own user presets: a Move opens them too` : "";
    return "";
  }

  function emptyText() {
    if (filter.trim()) return "Nothing matches.";
    if (source === "user") return v.has_state ? "No sounds of yours yet: Save As keeps the device's sound." : "This module cannot save its sound.";
    if (source === "favourites") return "No favourites yet: the star on a sound adds it.";
    if (source === "recent") return "Nothing chosen yet.";
    return "This module has no sounds of its own.";
  }

  function drawList(scrollTo) {
    const box = $("snd-list"), inner = $("snd-inner");
    if (!rows.length) {
      inner.style.height = "auto";
      inner.innerHTML = `<div class="snd-empty">${esc(emptyText())}</div>`;
      box.removeAttribute("aria-activedescendant");
      return;
    }
    inner.style.height = rows.length * ROW + "px";
    if (scrollTo) {
      const top = cursor * ROW, h = box.clientHeight || 320;
      if (top < box.scrollTop || top + ROW > box.scrollTop + h) box.scrollTop = Math.max(0, top - h / 2);
    }
    const first = Math.max(0, Math.floor(box.scrollTop / ROW) - 6);
    const last = Math.min(rows.length, first + Math.ceil((box.clientHeight || 320) / ROW) + 12);
    const playing = v.browsing ? v.applied : null;
    let html = "";
    for (let i = first; i < last; i++) {
      const r = rows[i];
      const on = i === cursor;
      let st = "";
      if (playing && same(r.ref, playing)) st = "playing";
      else if (v.current && same(r.ref, v.current)) st = v.edited ? "edited" : "current";
      html += `<div class="snd-row${on ? " on" : ""}" role="option" id="snd-r${i}" aria-selected="${on}" data-i="${i}" style="top:${i * ROW}px">` +
        `<span class="num">${r.num || ""}</span>` +
        `<span class="nm${r.name ? "" : " unknown"}">${r.name ? esc(r.name) : "–"}</span>` +
        (r.tag ? `<span class="tg">${esc(r.tag)}</span>` : "") +
        (st ? `<span class="st">${st}</span>` : "") +
        (r.user && askDelete === i ? `<span class="ask">Delete?</span><button type="button" class="ico yes" data-act="delete-yes" data-i="${i}">Yes</button>` +
                  `<button type="button" class="ico" data-act="delete-no" data-i="${i}" id="snd-no">No</button>` :
         r.user ? `<button type="button" class="ico" data-act="rename" data-i="${i}" title="Rename" aria-label="Rename ${esc(r.name)}">✎</button>` +
                  `<button type="button" class="ico" data-act="delete" data-i="${i}" title="Delete" aria-label="Delete ${esc(r.name)}">🗑</button>` : "") +
        `<button type="button" class="ico star" data-act="fav" data-i="${i}" aria-pressed="${r.fav}" title="Favourite" aria-label="Favourite ${esc(r.name || "#" + r.num)}">${r.fav ? "★" : "☆"}</button>` +
        `</div>`;
    }
    inner.innerHTML = html;
    box.setAttribute("aria-activedescendant", "snd-r" + cursor);
  }

  // ---- doing ---------------------------------------------------------------
  function move(to, play) {
    if (!rows.length) return;
    cursor = Math.max(0, Math.min(rows.length - 1, to));
    drawList(true);
    if (play) audition();
  }

  function audition() {
    const r = rows[cursor];
    if (!r) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await post(`/api/devices/${dev}/sounds/try`, r.ref);
      setTimeout(() => load(true), 400); // its name, learned as it plays
    }, AUDITION_MS);
  }

  async function act(path, body, msg) {
    const r = await post(`/api/devices/${dev}/sounds/${path}`, body);
    if (!r.ok) { say(r.error || "That did not work."); return r; }
    if (r.sounds) { v = r.sounds; render(false); }
    if (msg) say(msg);
    return r;
  }

  function say(t) { $("snd-status").textContent = t; }

  async function keep() {
    clearTimeout(timer);
    const r = rows[cursor];
    await act("keep", r ? r.ref : null, r && r.name ? `Kept: ${r.name}` : "Kept");
  }

  async function cancel() {
    clearTimeout(timer);
    await act("cancel", {}, "The sound from before is back.");
    render(true);
  }

  // the name form: Save As and Rename, in place (no browser dialog)
  function askName(label, value, ok, fn) {
    $("snd-form-label").textContent = label;
    $("snd-form-ok").textContent = ok;
    $("snd-name").value = value;
    $("snd-form").hidden = false;
    formDo = fn;
    $("snd-name").focus();
    $("snd-name").select();
  }
  function closeForm() { $("snd-form").hidden = true; formDo = null; }

  function saveAs() {
    // as the Push: the sound it came from, else the device and the date
    const dname = (document.querySelector(".slots .dev[aria-current=true]") || {}).firstChild;
    const suggest = (v.current && v.current.name) || `${dname ? dname.textContent : v.module} ${new Date().toISOString().slice(0, 10)}`;
    askName("Save the device's sound as", suggest, "Save", async (name) => {
      const r = await act("save", { as: true, name });
      if (r.ok && r.sounds) {
        source = "user";
        filter = ""; $("snd-search").value = ""; // the sound saved, never hidden by a search
        v = r.sounds;
        render(true);
        say(`Saved as ${v.current ? v.current.name : name}`);
      }
    });
  }

  async function rowAction(kind, i) {
    const r = rows[i];
    if (!r) return;
    if (kind === "fav") return act("fav", r.ref);
    if (kind === "rename") {
      askName(`Rename "${r.name}" to`, r.name, "Rename", (to) => {
        if (to !== r.name) act("rename", { name: r.name, to }, "Renamed");
      });
    }
    if (kind === "delete") { askDelete = i; drawList(false); const no = $("snd-no"); if (no) no.focus(); }
    if (kind === "delete-no") { askDelete = -1; drawList(false); $("snd-list").focus(); }
    if (kind === "delete-yes") { askDelete = -1; act("delete", { name: r.name }, `Deleted ${r.name}`); }
  }

  async function importFiles(files) {
    if (!v) return;
    let added = 0, skipped = [];
    for (const f of files) {
      const res = await fetch(`/api/sounds/${encodeURIComponent(v.module)}/import`, { method: "POST", body: f }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!res.ok) { skipped.push(`${f.name}: ${res.error || "not read"}`); continue; }
      added += res.added.length;
      skipped = skipped.concat(res.skipped || []);
    }
    source = "user";
    await load(false);
    say(`${added} sound${added === 1 ? "" : "s"} added` + (skipped.length ? ` · left out: ${skipped.join("; ")}` : ""));
  }

  // ---- wiring ----------------------------------------------------------------
  function wire() {
    const box = $("snd-list");
    box.addEventListener("scroll", () => drawList(false));
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (b) { rowAction(b.dataset.act, +b.dataset.i); return; }
      const row = e.target.closest(".snd-row");
      if (row) move(+row.dataset.i, true);
    });
    box.addEventListener("dblclick", (e) => { if (e.target.closest(".snd-row") && !e.target.closest("button")) keep(); });
    box.addEventListener("keydown", (e) => {
      const page = Math.max(1, Math.floor(box.clientHeight / ROW) - 1);
      const k = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page }[e.key];
      if (k) { e.preventDefault(); move(cursor + k, true); return; }
      if (e.key === "Home") { e.preventDefault(); move(0, true); }
      else if (e.key === "End") { e.preventDefault(); move(rows.length - 1, true); }
      else if (e.key === "Enter") { e.preventDefault(); keep(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      else if (e.key === "f" || e.key === "*") { e.preventDefault(); rowAction("fav", cursor); }
    });
    $("snd-search").addEventListener("input", (e) => { filter = e.target.value; cursor = 0; rows = buildRows(); drawList(true); $("snd-status").textContent = status(); });
    $("snd-bank").addEventListener("change", async (e) => {
      if (e.target.value === "") return;
      await act("bank", { index: +e.target.value });
      setTimeout(() => load(false), 500); // the list follows the bank
    });
    $("snd-load").onclick = keep;
    $("snd-cancel").onclick = cancel;
    $("snd-save").onclick = () => act("save", {}, "Saved");
    $("snd-saveas").onclick = saveAs;
    const cmp = $("snd-compare");
    const hold = (on) => { if (on === compare) return; compare = on; cmp.setAttribute("aria-pressed", String(on)); post(`/api/devices/${dev}/sounds/compare`, { before: on }); };
    cmp.addEventListener("pointerdown", () => hold(true));
    ["pointerup", "pointerleave", "pointercancel"].forEach((t) => cmp.addEventListener(t, () => hold(false)));
    cmp.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); hold(true); } });
    cmp.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") hold(false); });
    $("snd-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("snd-name").value.trim();
      const fn = formDo;
      closeForm();
      if (name && fn) fn(name);
      $("snd-list").focus();
    });
    $("snd-form-cancel").onclick = () => { closeForm(); $("snd-list").focus(); };
    $("snd-name").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeForm(); $("snd-list").focus(); } });
    $("snd-import").addEventListener("change", (e) => { if (e.target.files.length) importFiles([...e.target.files]); e.target.value = ""; });
    // the device the page shows (app.js)
    window.addEventListener("pung:device", (e) => {
      if (e.detail.mode !== "devices" || e.detail.n < 0) { dev = -1; v = null; hide(); return; }
      if (e.detail.n !== dev) { dev = e.detail.n; v = null; load(false); }
    });
    // the Push browses too: follow what it does, unless the hands are here
    setInterval(() => {
      if (dev < 0 || document.hidden || $("sounds").hidden) return;
      if (document.activeElement === $("snd-search") || !$("snd-form").hidden || askDelete >= 0) return;
      load(true);
    }, 2000);
  }
  wire();
})();
