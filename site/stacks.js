// stacks.js: pung.live's Stacks page. A stack is everything of Pung's in one project (in Live: a Set):
// every Pung device with its module, version and sound, and what those need (docs/PUNG-STACK.md). This
// page is where the visitor's stacks live: taken from a deployment (GET /api/stack, src/setstack.go), kept
// in this browser (IndexedDB "pung", store "stacks"; a file for another browser or a backup), and held
// against a deployment before the Set goes there (POST /api/stack/check): what it lacks is installed from
// its module pack from here (POST /api/catalog/{id}/install) and Live restarted on the visitor's word.
// The Set itself, with its notes and automation, travels as Ableton moves it; Pung never reads a Set file.
//
// What ONE Pung device holds is a patch (pung_stack 1: GET /api/stacks/playing/{n}, POST /api/stacks):
// kept here too, under its own heading, and sent to a deployment as a preset in Push's browser.
// (A deployment is "device" in this code; on the page that word is kept for what it means in Live.)
(function () {
  "use strict";
  const PP = window.PungPush, box = document.getElementById("sk");
  if (!PP || !PP.enabled || !box) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ROLE = { midi_fx: "MIDI", synth: "Instrument", audio_fx: "Effect" };
  const EXT = ".pungstack";

  // ---- the library, in this browser -----------------------------------------------------------
  // a record: {id, name, stack (the document), added, from: {name, kind} | null (a file)}
  let lib = [], dbFail = false;
  const db = new Promise((done) => {
    try {
      const rq = indexedDB.open("pung", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("stacks", { keyPath: "id" });
      rq.onsuccess = () => done(rq.result);
      rq.onerror = () => { dbFail = true; done(null); };
    } catch (e) { dbFail = true; done(null); }
  });
  const tx = async (mode, f) => {
    const d = await db;
    if (!d) return null;
    return new Promise((done) => {
      const t = d.transaction("stacks", mode), rq = f(t.objectStore("stacks"));
      t.oncomplete = () => done(rq && rq.result);
      t.onerror = t.onabort = () => { dbFail = true; done(null); };
    });
  };
  const put = (rec) => { const i = lib.findIndex((x) => x.id === rec.id); if (i < 0) lib.unshift(rec); else lib[i] = rec; return tx("readwrite", (s) => s.put(rec)); };
  const drop = (rec) => { lib = lib.filter((x) => x.id !== rec.id); return tx("readwrite", (s) => s.delete(rec.id)); };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  // a name no other stack has: "Glass arp", "Glass arp 2"
  function freeName(name, but) {
    const taken = new Set(lib.filter((x) => x !== but).map((x) => x.name.toLowerCase()));
    name = String(name || "").trim().slice(0, 60) || "Stack";
    if (!taken.has(name.toLowerCase())) return name;
    const base = name.replace(/ \d+$/, "");
    for (let n = 2; ; n++) if (!taken.has((base + " " + n).toLowerCase())) return base + " " + n;
  }
  // is it a stack this page reads?
  const isSet = (st) => !!st && st.pung_stack === 2;
  function checkPatch(st) {
    if (!st || st.pung_stack !== 1) return "It is not a stack this page reads.";
    if (!Array.isArray(st.modules) || !st.modules.length) return "It holds no module.";
    for (const m of st.modules) if (!m || !ROLE[m.role] || typeof m.id !== "string" || !/^[\w.-]+$/.test(m.id)) return "It names a module this page cannot read.";
    return "";
  }
  function check(st) {
    if (!isSet(st)) return checkPatch(st);
    if (!Array.isArray(st.modules)) return "The stack names no devices.";
    for (const e of st.modules) { const bad = !e || checkPatch(e.patch); if (bad) return "The stack holds a device this page cannot read."; }
    return "";
  }
  // a stack's devices by track, in the Set's order; those the host gave no place last
  function byTrack(st) {
    const out = new Map();
    for (const e of st.modules) {
      const k = e.live ? e.live.track_index : 1e9;
      if (!out.has(k)) out.set(k, { name: e.live ? e.live.track : "", index: k, devices: [] });
      out.get(k).devices.push(e);
    }
    return [...out.values()].sort((a, b) => a.index - b.index);
  }
  const KIND = { instrument: "Instrument", effect: "Effect", midi: "MIDI" };
  const count = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

  // ---- the modules' names and pictures (the site's own catalog) --------------------------------
  let names = {}, shots = {};
  fetch("modules/catalog.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => { for (const m of (j && j.modules) || []) names[m.id] = m.name; draw(); }).catch(() => {});
  fetch("modules/screens/index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => { shots = j || {}; draw(); }).catch(() => {});
  const nameOf = (m) => m.name || names[m.id] || m.id;
  const lead = (st) => st.modules.find((m) => m.role === "synth") || st.modules.find((m) => m.role === "midi_fx") || st.modules[0];
  function picture(st) {
    const m = lead(st), s = shots[m.id];
    const f = s && (s.panel || (s.pages && s.pages[0] && s.pages[0].file));
    return f ? `<img class="sk-pic" src="modules/screens/${encodeURIComponent(m.id)}/${encodeURIComponent(f)}" alt="${esc(nameOf(m))} on the Push's screen" loading="lazy">` : `<div class="sk-pic none" aria-hidden="true"></div>`;
  }

  // ---- what the devices have: what plays, what they keep ----------------------------------------
  const at = new Map(); // device id -> {playing, kept, knows (its Pung knows stacks), at}
  const of = (d) => { if (!at.has(d.id)) at.set(d.id, { playing: [], kept: [], knows: null, set: null, sets: null }); return at.get(d.id); };
  async function look(d) {
    const a = of(d);
    try {
      const r = await PP.jsonOf(d, "/api/stacks");
      a.playing = r.playing || []; a.kept = r.kept || []; a.knows = true;
      // the stack of the Set that is open there (a Pung from before it answers 404: it knows patches only)
      try { const q = await PP.jsonOf(d, "/api/stack"); a.set = q.stack || null; a.sets = true; } catch (e) { a.set = null; a.sets = false; }
    } catch (e) {
      // a Pung that answers its catalog but not this: older than stacks
      if (d.state === "on" && a.knows === null) a.knows = false;
    }
  }
  const online = () => PP.devices.filter((d) => d.state === "on");

  // ---- words ------------------------------------------------------------------------------------
  function when(iso) {
    const t = new Date(iso), s = (Date.now() - t.getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " minutes ago";
    if (s < 86400) return Math.round(s / 3600) + " hours ago";
    return t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  const SRC = { lfo_a: "LFO A", lfo_b: "LFO B", wheel: "Wheel", pressure: "Pressure" };
  function over(st) {
    const routes = (st.mod && st.mod.routes) || [];
    if (!routes.length) return "";
    const by = [...new Set(routes.map((r) => SRC[r.src] || r.src))].join(", ");
    return `<p class="sk-mod"><i aria-hidden="true"></i>Pung's modulation: ${esc(by)} on ${routes.length} control${routes.length === 1 ? "" : "s"}</p>`;
  }
  function needs(st) {
    const n = st.needs || {}, out = [];
    for (const f of n.firmware || []) out.push(`${esc(names[f.module] || f.module)}'s ${esc(f.label || "firmware")}, your own`);
    if (n.emulators) out.push(`${n.emulators} emulator${n.emulators === 1 ? "" : "s"}`);
    if (n.pung) out.push(`Pung ${esc(n.pung)} or later`);
    return out.length ? `<p class="dv-note"><b>Needs</b> ${out.join(" · ")}</p>` : "";
  }
  const why = (u) => {
    const n = esc(u.name || names[u.module] || u.module || "It");
    return {
      install: `<b>${n}</b> is not installed there. <a href="modules/#${encodeURIComponent(u.module)}">Install it on the Modules page</a>, restart Live there, and the stack is ready.`,
      restart: `<b>${n}</b> is installed there and becomes a device in Live when Live restarts: <a href="modules/">restart Live from the Modules page</a>.`,
      pung: `${u.module ? `<b>${n}</b> needs` : "The stack needs"} Pung ${esc(u.detail)} or later there.`,
      firmware: `<b>${n}</b> needs its ${esc(u.detail || "firmware")} there: yours, added on its own Modules page.`,
      unknown: `No module pack names <b>${esc(u.module)}</b>: it cannot be installed there.`,
      shape: esc(u.detail || "It cannot hold this stack as one device."),
    }[u.why] || esc(u.detail || u.why);
  };

  // ---- the cards ---------------------------------------------------------------------------------
  let renaming = "", fresh = "";
  function chain(st) {
    return `<ol class="sk-chain" aria-label="Its modules, in the order they play">${st.modules.map((m) =>
      `<li class="${m.role}"><span>${ROLE[m.role]}</span><b>${esc(nameOf(m))}</b>${m.version ? `<i>${esc(m.version)}</i>` : ""}</li>`).join("")}</ol>`;
  }
  // a stack's devices, track by track
  function rows(st, limit) {
    const tracks = byTrack(st);
    let n = 0;
    const lines = [];
    for (const t of tracks) for (const e of t.devices) {
      const m = lead(e.patch);
      lines.push(`<li class="${n >= limit ? "more" : ""}"><span class="sk-tr">${t.name ? esc(t.name) : "No track given"}</span>
        <span class="sk-dv ${esc(e.device)}"><i>${KIND[e.device] || esc(e.device)}</i><b>${esc(nameOf(m))}</b>${m.version ? `<em>${esc(m.version)}</em>` : ""}</span>
        <span class="sk-snd">${e.patch.sound ? esc(e.patch.sound) : ""}</span></li>`);
      n++;
    }
    const rest = n - limit;
    return `<ul class="sk-set${rest > 0 ? " cut" : ""}">${lines.join("")}</ul>${rest > 0 ? `<button type="button" class="sk-link sk-all">and ${count(rest, "more device")}</button>` : ""}`;
  }
  function sums(st) {
    const tracks = byTrack(st).filter((t) => t.index < 1e9).length, n = st.modules.length;
    return `${count(n, "Pung device")}${tracks ? ` on ${count(tracks, "track")}` : ""}`;
  }
  function setCard(rec) {
    const st = rec.stack;
    const title = renaming === rec.id
      ? `<form class="dv-rename" data-id="${esc(rec.id)}"><input type="text" value="${esc(rec.name)}" maxlength="60" aria-label="The stack's name"><button class="btn primary" type="submit">Save</button></form>`
      : `<h3>${esc(rec.name)} <button type="button" class="dv-edit" data-rename="${esc(rec.id)}" aria-label="Rename it" title="Rename it">✎</button></h3>`;
    const old = st.modules.filter((e) => !e.portable).length;
    return `<article class="sk-card sk-setcard${fresh === rec.id ? " fresh" : ""}" data-id="${esc(rec.id)}">
      <div class="sk-body">
        <header>${title}<p class="dv-sub">${rec.from ? `Taken from ${esc(rec.from.name)}` : "From a file"} · ${esc(when(rec.added))} · <b>${esc(sums(st))}</b></p></header>
        ${st.modules.length ? rows(st, 8) : `<p class="dv-note">The Set held no Pung device when this was taken.</p>`}
        ${needs(st)}
        ${old ? `<p class="dv-note sk-bound"><b>Automation</b> ${old === st.modules.length ? "The Set's automation and MIDI mappings of these devices" : `For ${count(old, "of its devices", "of its devices")}, the Set's automation and MIDI mappings`} follow the order of modules on the Pung it was made on. A Pung that lays devices out by the Set contract lifts that.</p>` : ""}
        <div class="dv-acts"><button type="button" class="btn primary" data-prep="${esc(rec.id)}">Check a deployment</button>
          <button type="button" class="btn" data-file="${esc(rec.id)}">Download</button>
          <button type="button" class="btn" data-copy="${esc(rec.id)}">Duplicate</button>
          <button type="button" class="btn" data-del="${esc(rec.id)}">Delete</button></div>
      </div></article>`;
  }
  function card(rec) {
    if (isSet(rec.stack)) return setCard(rec);
    const st = rec.stack, on = [];
    for (const d of online()) {
      const k = of(d).kept.find((x) => x.id === rec.id);
      if (!k) continue;
      on.push(`<li><i class="pl-led ${k.ready ? "on" : ""}" aria-hidden="true"></i><span><b>${esc(PP.nameOf(d))}</b> ${k.ready
        ? `keeps it${k.name !== rec.name ? ` as “${esc(k.name)}”` : ""}: in its browser under ${esc((k.where || "").replace(/ › [^›]*$/, ""))}.`
        : `keeps it, and waits: ${(k.unmet || []).map(why).join(" ")}`}
        <button type="button" class="sk-link" data-unkeep="${esc(rec.id)}" data-dev="${d.id}">Remove it there</button></span></li>`);
    }
    const title = renaming === rec.id
      ? `<form class="dv-rename" data-id="${esc(rec.id)}"><input type="text" value="${esc(rec.name)}" maxlength="60" aria-label="The stack's name"><button class="btn primary" type="submit">Save</button></form>`
      : `<h3>${esc(rec.name)} <button type="button" class="dv-edit" data-rename="${esc(rec.id)}" aria-label="Rename it" title="Rename it">✎</button></h3>`;
    return `<article class="sk-card${fresh === rec.id ? " fresh" : ""}" data-id="${esc(rec.id)}">
      ${picture(st)}
      <div class="sk-body">
        <header>${title}<p class="dv-sub">${rec.from ? `Taken from ${esc(rec.from.name)}` : "From a file"} · ${esc(when(rec.added))}${st.sound && st.sound !== rec.name ? ` · was “${esc(st.sound)}”` : ""}</p></header>
        ${chain(st)}${over(st)}${needs(st)}
        ${on.length ? `<ul class="sk-on">${on.join("")}</ul>` : ""}
        <div class="dv-acts"><button type="button" class="btn primary" data-send="${esc(rec.id)}">Send to a deployment</button>
          <button type="button" class="btn" data-file="${esc(rec.id)}">Download</button>
          <button type="button" class="btn" data-copy="${esc(rec.id)}">Duplicate</button>
          <button type="button" class="btn" data-del="${esc(rec.id)}">Delete</button></div>
      </div></article>`;
  }

  // what each connected deployment has open: its Set's stack to take, and its devices one by one (patches)
  function playing() {
    const ds = PP.devices;
    if (!ds.length) return `<div class="dv-empty"><p>Connect a deployment to take the stack of the Set that is open on it, and to check it against a stack. pung.live talks to it over your home network; your stacks stay in this browser.</p><div data-push-chip></div></div>`;
    return ds.map((d) => {
      const a = of(d);
      let body;
      if (d.state !== "on") body = `<p class="dv-note">${d.state === "trying" ? "Looking for it…" : `Not connected. <a href="deployments.html">Deployments</a> has it.`}</p>`;
      else if (a.knows === false) body = `<p class="dv-note">Its Pung does not know stacks yet. <a href="deployments.html#installer">Update Pung</a> on it.</p>`;
      else {
        const st = a.set;
        const open = a.sets === false
          ? `<p class="dv-note">Its Pung reads one device at a time, not yet a whole Set. <a href="deployments.html#installer">Update Pung</a> on it to take a Set's stack.</p>`
          : !st ? `<p class="dv-note">Reading the open Set…</p>`
          : !st.modules.length ? `<p class="dv-note">The Set that is open there holds no Pung device. Load one there, and its stack appears here.</p>`
          : `<div class="sk-open"><p class="sk-openhead"><b>The open Set</b> <span>${esc(sums(st))}</span></p>${rows(st, 6)}${needs(st)}
              <div class="dv-acts"><button type="button" class="btn primary" data-takeset data-dev="${d.id}">Take this Set's stack</button></div></div>`;
        const one = a.playing.length ? `<details class="sk-one"><summary>One device on its own, as a patch</summary>
            <ul class="sk-play">${a.playing.map((p) => `<li><span class="sk-what"><b>${esc(p.name)}</b>${p.sound ? ` <span>${esc(p.sound)}</span>` : ""}${p.midi_fx ? ` <i>${esc(names[p.midi_fx] || p.midi_fx)} in front</i>` : ""}</span>
              <button type="button" class="btn" data-take="${p.n}" data-dev="${d.id}">Take as a patch</button></li>`).join("")}</ul></details>` : "";
        body = open + one;
      }
      return `<section class="sk-dev"><header><i class="pl-led ${d.state === "on" ? "on" : d.state === "lost" ? "bad" : ""}" aria-hidden="true"></i><h3>${esc(PP.nameOf(d))}</h3><p class="dv-sub">${esc(PP.KINDS[d.kind].label)}</p></header>${body}</section>`;
    }).join("");
  }

  let sig = "";
  function draw() {
    const sets = lib.filter((x) => isSet(x.stack)), patches = lib.filter((x) => !isSet(x.stack));
    const cards = sets.length
      ? `<div class="sk-grid sets">${sets.map(card).join("")}</div>`
      : `<div class="dv-empty sk-first"><p><b>No stacks here yet.</b> A stack is everything of Pung's in one Set: every Pung device, its module and version, its sound, and what they need.</p>
          <ol class="sk-steps"><li><b>Take</b> the stack of the Set that is open on a deployment, below.</li><li><b>Keep</b> it here, under a name of yours.</li><li><b>Check</b> another deployment against it: what it lacks is installed from here, before the Set goes there.</li></ol></div>`;
    const html = `<section class="home-sec"><div class="sk-bar"><div class="sec-head"><p class="eyebrow">In this browser</p><h2>Your stacks</h2></div>
        <div class="dv-acts"><button type="button" class="btn" id="sk-open">Open a file</button><input type="file" id="sk-input" accept="${EXT},.json,application/json" multiple hidden></div></div>
        ${dbFail ? `<p class="dv-note sk-warn">This browser does not let the page keep anything (a private window?). Stacks you take stay until the page closes: download the ones you want.</p>` : ""}
        ${cards}</section>
      <section class="home-sec"><div class="sec-head"><p class="eyebrow">On your deployments</p><h2>Open now</h2></div><div class="sk-devs">${playing()}</div></section>
      ${patches.length ? `<section class="home-sec"><div class="sec-head"><p class="eyebrow">One device each</p><h2>Your patches</h2></div>
        <p class="dv-note sk-first">A patch is what one Pung device holds: its instrument, the MIDI effect in front, Pung's modulation. Sent to a deployment it is a preset in its browser.</p>
        <div class="sk-grid">${patches.map(card).join("")}</div></section>` : ""}`;
    if (html === sig) { PP.renderChips(); return; }
    if (box.querySelector(".dv-rename input:focus")) return; // a name being typed is not redrawn under the hands
    sig = html;
    box.innerHTML = html;
    PP.renderChips();
    const rec = (id) => lib.find((x) => x.id === id), dev = (id) => PP.devices.find((x) => x.id === id);
    const on = (sel, f) => box.querySelectorAll(sel).forEach((b) => (b.onclick = () => f(b)));
    on("[data-take]", (b) => take(dev(b.dataset.dev), +b.dataset.take, b));
    on("[data-takeset]", (b) => takeSet(dev(b.dataset.dev), b));
    on("[data-prep]", (b) => prepare(rec(b.dataset.prep)));
    on(".sk-all", (b) => { b.previousElementSibling.classList.remove("cut"); b.remove(); });
    on("[data-send]", (b) => send(rec(b.dataset.send)));
    on("[data-file]", (b) => download(rec(b.dataset.file)));
    on("[data-copy]", async (b) => { const r = rec(b.dataset.copy), c = { id: newId(), name: freeName(r.name), stack: JSON.parse(JSON.stringify(r.stack)), added: new Date().toISOString(), from: r.from };
      await put(c); fresh = c.id; redraw(); PP.toast(`“${c.name}” is a copy of “${r.name}”.`); });
    on("[data-del]", async (b) => { const r = rec(b.dataset.del);
      const kept = online().filter((d) => of(d).kept.some((k) => k.id === r.id)).map((d) => PP.nameOf(d));
      if (await PP.confirm(`Delete “${r.name}” from this browser?${kept.length ? ` ${kept.join(" and ")} keep${kept.length === 1 ? "s" : ""} the copy sent there.` : ""} A stack you have not downloaded is gone.`, "Delete", true)) { await drop(r); redraw(); } });
    on("[data-rename]", (b) => { renaming = b.dataset.rename; redraw(); const i = box.querySelector(".dv-rename input"); if (i) { i.focus(); i.select(); } });
    on("[data-unkeep]", async (b) => { const d = dev(b.dataset.dev), r = rec(b.dataset.unkeep);
      if (!(await PP.confirm(`Remove “${r.name}” from ${PP.nameOf(d)}? It leaves the browser there; a device in its Set that plays it goes on playing. The stack stays here.`, "Remove", true))) return;
      try { await post(d, "/api/stacks/remove", { id: r.id }); PP.toast(`${PP.nameOf(d)} no longer keeps “${r.name}”.`); } catch (e) { PP.toast(e.message, true); }
      await look(d); redraw(); });
    box.querySelectorAll(".dv-rename").forEach((f) => (f.onsubmit = async (e) => { e.preventDefault(); const r = rec(f.dataset.id); renaming = "";
      f.querySelector("input").blur(); // Enter leaves the field focused, and a focused field is not redrawn
      const name = freeName(f.querySelector("input").value || r.name, r);
      if (name !== r.name) { r.name = name; await put(r); }
      redraw(); }));
    const input = document.getElementById("sk-input");
    document.getElementById("sk-open").onclick = () => input.click();
    input.onchange = () => { open([...input.files]); input.value = ""; };
  }
  const redraw = () => { sig = ""; draw(); };

  // ---- take, files ---------------------------------------------------------------------------------
  async function post(d, path, body) {
    return PP.jsonOf(d, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  // postAny: an answer that is a refusal is still an answer (409 with its reasons)
  async function postAny(d, path, body) {
    const r = await PP.fetchOf(d, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not Pung's answer */ }
    if (!j) throw new Error("It answered " + r.status + ".");
    return j;
  }
  async function take(d, n, btn) {
    btn.disabled = true; btn.innerHTML = `<i class="pl-spin"></i> Taking…`;
    try {
      const r = await PP.jsonOf(d, "/api/stacks/playing/" + n);
      const bad = check(r.stack);
      if (bad) throw new Error(bad);
      const rec = { id: newId(), name: freeName(r.stack.name), stack: r.stack, added: new Date().toISOString(), from: { name: PP.nameOf(d), kind: d.kind } };
      await put(rec);
      fresh = renaming = rec.id; // a new stack wants its name
      redraw();
      const i = box.querySelector(".dv-rename input");
      if (i) { i.focus(); i.select(); i.closest(".sk-card").scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
      PP.toast(`Taken from ${PP.nameOf(d)}. Give it a name.`);
    } catch (e) {
      PP.toast(`${PP.nameOf(d)} did not hand it over: ${e.message}`, true);
      redraw();
    }
  }
  async function takeSet(d, btn) {
    btn.disabled = true; btn.innerHTML = `<i class="pl-spin"></i> Taking…`;
    try {
      const r = await PP.jsonOf(d, "/api/stack");
      const bad = check(r.stack);
      if (bad) throw new Error(bad);
      const day = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
      const rec = { id: newId(), name: freeName(`Set on ${PP.nameOf(d)}, ${day}`), stack: r.stack, added: new Date().toISOString(), from: { name: PP.nameOf(d), kind: d.kind } };
      await put(rec);
      fresh = renaming = rec.id; // a new stack wants its name: the Set's own
      redraw();
      const i = box.querySelector(".dv-rename input");
      if (i) { i.focus(); i.select(); i.closest(".sk-card").scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
      PP.toast(`Taken from ${PP.nameOf(d)}. Give it the Set's name.`);
    } catch (e) {
      PP.toast(`${PP.nameOf(d)} did not hand it over: ${e.message}`, true);
      redraw();
    }
  }
  function download(rec) {
    const st = Object.assign({}, rec.stack, { id: rec.id, name: rec.name });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(st, null, 1)], { type: "application/json" }));
    a.download = rec.name.replace(/[^\w .()-]+/g, "_") + EXT;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function open(files) {
    let added = 0, last = "";
    for (const f of files) {
      try {
        if (f.size > 8 << 20) throw new Error("too large for a stack");
        const st = JSON.parse(await f.text()), bad = check(st);
        if (bad) throw new Error(bad);
        // the same stack again (its id): the one here is replaced, not doubled
        const had = st.id && lib.find((x) => x.id === st.id);
        const rec = { id: had ? had.id : st.id || newId(), name: had ? had.name : freeName(st.name || f.name.replace(/\.[^.]+$/, "")), stack: st, added: new Date().toISOString(), from: null };
        await put(rec); added++; fresh = rec.id; last = rec.name;
      } catch (e) {
        PP.toast(`${f.name}: ${e.message || "not a stack"}`, true);
      }
    }
    redraw();
    if (added) PP.toast(added === 1 ? `“${last}” is here now.` : `${added} files are here now.`);
  }
  // a file dropped anywhere on the page
  addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); document.body.classList.add("sk-drop"); } });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("sk-drop"); });
  addEventListener("drop", (e) => { document.body.classList.remove("sk-drop"); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); open([...e.dataTransfer.files]); } });

  // ---- send -------------------------------------------------------------------------------------------
  // the dialog: which device, what that device says about the stack, where it goes
  let sd = null; // {rec, dev, check, busy, onto, done}
  function sendDialog() {
    let dlg = document.getElementById("sk-send");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "sk-send"; dlg.className = "pl-dialog"; dlg.setAttribute("aria-labelledby", "sk-send-title");
      dlg.innerHTML = `<button type="button" class="pl-btn icon pl-close" aria-label="Close">✕</button><div id="sk-send-body"></div>`;
      document.body.appendChild(dlg);
      dlg.querySelector(".pl-close").onclick = () => dlg.close();
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener("close", () => { if (!dlg.open) sd = null; }); // (opened again before the event came: that send goes on)
    }
    return dlg;
  }
  const doc = (rec) => Object.assign({}, rec.stack, { id: rec.id, name: rec.name });
  async function ask(d) {
    sd.dev = d; sd.check = null; sd.onto = ""; sd.done = null; sd.err = "";
    drawSend();
    try {
      await look(d);
      if (of(d).knows === false) throw new Error("Its Pung does not know stacks yet: update Pung on it.");
      const c = await postAny(d, "/api/stacks", { stack: doc(sd.rec), check: true });
      if (!sd || sd.dev !== d) return;
      if (c.ok === false) throw new Error(c.error || "It refused the stack.");
      sd.check = c;
    } catch (e) {
      if (!sd || sd.dev !== d) return;
      sd.err = e.message === "Failed to fetch" ? "It does not answer right now." : e.message;
    }
    drawSend();
  }
  function drawSend() {
    if (!sd) return;
    const body = document.getElementById("sk-send-body"), r = sd.rec, ds = online();
    const m = lead(r.stack);
    let h = `<p class="pl-kicker">Send a patch</p><h2 id="sk-send-title">${esc(r.name)}</h2>`;
    if (sd.done) {
      const d = sd.dev, c = sd.done;
      h += c.loaded
        ? `<p><b>${esc(PP.nameOf(d))} plays it now.</b> It is also kept there: in its browser under ${esc((c.where || "").replace(/ › [^›]*$/, ""))}.</p>`
        : c.ready
          ? `<p><b>${esc(PP.nameOf(d))} keeps it.</b> On the ${esc(PP.KINDS[d.kind].short)}, open its browser and load it from</p><p class="sk-where">${esc(c.where || "")}</p><p class="pl-sub">It comes as ${esc(nameOf(m))} with the whole stack in it, on any track, as often as you like, without this page.</p>`
          : `<p><b>${esc(PP.nameOf(d))} keeps it, and waits.</b></p><ul class="sk-unmet">${(c.unmet || []).map((u) => `<li>${why(u)}</li>`).join("")}</ul><p class="pl-sub">Once that is met, the stack appears in its browser by itself.</p>`;
      if (c.load_error) h += `<div class="pl-err">It could not load it into the device that plays: ${esc(c.load_error)}</div>`;
      h += `<div class="pl-acts end"><button type="button" class="pl-btn primary" id="sk-ok">Done</button></div>`;
      body.innerHTML = h;
      document.getElementById("sk-ok").onclick = () => sendDialog().close();
      return;
    }
    if (!ds.length) {
      h += `<p>No deployment is connected. Connect one and send again.</p><div class="pl-acts end"><a class="pl-btn primary" href="deployments.html">Deployments</a></div>`;
      body.innerHTML = h;
      return;
    }
    h += `<div class="pl-form"><label for="sk-to">To</label><select id="sk-to">${ds.map((d) => `<option value="${d.id}" ${sd.dev === d ? "selected" : ""}>${esc(PP.nameOf(d))} · ${esc(PP.KINDS[d.kind].label)}</option>`).join("")}</select></div>`;
    const c = sd.check;
    if (sd.err) h += `<div class="pl-err">${esc(sd.err)}</div>`;
    else if (!c) h += `<p class="pl-sub"><i class="pl-spin" style="display:inline-block;vertical-align:-3px"></i> Asking ${esc(PP.nameOf(sd.dev))} what it has…</p>`;
    else {
      const hard = (c.unmet || []).some((u) => ["shape", "unknown", "pung"].includes(u.why));
      if (c.ready) {
        const here = of(sd.dev).playing.filter((p) => p.module === m.id);
        h += `<p><i class="pl-led on" aria-hidden="true"></i> It has everything the stack needs.</p>
          <div class="pl-pick" role="radiogroup" aria-label="Where it goes">
            <label><input type="radio" name="sk-onto" value="" ${sd.onto === "" ? "checked" : ""}><span><b>Keep it on the ${esc(PP.KINDS[sd.dev.kind].short)}</b><br><span class="pl-sub">It appears in its own browser; load it from there on any track.</span></span></label>
            ${here.map((p) => `<label><input type="radio" name="sk-onto" value="${p.n}" ${sd.onto === String(p.n) ? "checked" : ""}><span><b>And play it now on ${esc(p.name)}${p.sound ? ` (“${esc(p.sound)}”)` : ""}</b><br><span class="pl-sub">It replaces what that device in the Set plays. Take that first if you want to keep it.</span></span></label>`).join("")}
          </div>`;
      } else {
        h += `<p><i class="pl-led bad" aria-hidden="true"></i> ${hard ? "It cannot play this stack:" : "It lacks something the stack needs:"}</p><ul class="sk-unmet">${c.unmet.map((u) => `<li>${why(u)}</li>`).join("")}</ul>`;
        if (!hard) h += `<p class="pl-sub">You can send it now: it is kept there, and appears in the browser once this is met.</p>`;
      }
      h += `<div class="pl-acts end"><button type="button" class="pl-btn" id="sk-no">Cancel</button>${hard ? "" : `<button type="button" class="pl-btn primary" id="sk-go" ${sd.busy ? "disabled" : ""}>${sd.busy ? `<i class="pl-spin"></i> Sending…` : c.ready ? "Send" : "Send anyway"}</button>`}</div>`;
    }
    body.innerHTML = h;
    const sel = document.getElementById("sk-to");
    if (sel) sel.onchange = () => ask(PP.devices.find((d) => d.id === sel.value));
    body.querySelectorAll("input[name=sk-onto]").forEach((i) => (i.onchange = () => { sd.onto = i.value; }));
    const no = document.getElementById("sk-no"), go = document.getElementById("sk-go");
    if (no) no.onclick = () => sendDialog().close();
    if (go) go.onclick = async () => {
      const d = sd.dev, body = { stack: doc(sd.rec) };
      if (sd.onto !== "") body.onto = +sd.onto;
      sd.busy = true; drawSend();
      try {
        const res = await postAny(d, "/api/stacks", body);
        if (!sd) return;
        sd.busy = false;
        if (res.ok === false) { sd.err = res.error || "It refused the stack."; sd.check = null; }
        else sd.done = res;
      } catch (e) {
        if (!sd) return;
        sd.busy = false; sd.err = "It did not answer: " + e.message; sd.check = null;
      }
      drawSend();
      await look(d); redraw();
    };
  }
  function send(rec) {
    const ds = online(), dlg = sendDialog();
    sd = { rec, dev: null, check: null, busy: false, onto: "", done: null, err: "" };
    if (!dlg.open) dlg.showModal();
    if (ds.length) ask(ds.includes(PP.inUse()) ? PP.inUse() : ds[0]); else drawSend();
  }

  // ---- check a deployment against a Set's stack, and make it ready ------------------------------------
  // the dialog: which deployment, how each module the stack names stands there, and what this page can do
  // about it: install what the module pack has, and (on the visitor's word) restart Live there
  let pd = null; // {rec, dev, res, err, busy: "" | "install" | "restart", note}
  function prepDialog() {
    let dlg = document.getElementById("sk-prep");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "sk-prep"; dlg.className = "pl-dialog sk-prepdlg"; dlg.setAttribute("aria-labelledby", "sk-prep-title");
      dlg.innerHTML = `<button type="button" class="pl-btn icon pl-close" aria-label="Close">✕</button><div id="sk-prep-body"></div>`;
      document.body.appendChild(dlg);
      dlg.querySelector(".pl-close").onclick = () => dlg.close();
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener("close", () => { if (!dlg.open) pd = null; });
    }
    return dlg;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const OLDER = "Its Pung reads one device at a time, not yet a whole Set: update Pung on it.";
  async function askSet(d) {
    pd.dev = d; pd.res = null; pd.err = ""; pd.note = "";
    drawPrep();
    await recheck();
  }
  async function recheck() {
    const d = pd && pd.dev;
    if (!d) return;
    try {
      const c = await postAny(d, "/api/stack/check", { stack: doc(pd.rec) });
      if (!pd || pd.dev !== d) return;
      if (c.ok === false) throw new Error(/not found/i.test(c.error || "") ? OLDER : c.error || "It refused the stack.");
      pd.res = c; pd.err = "";
    } catch (e) {
      if (!pd || pd.dev !== d) return;
      pd.res = null;
      pd.err = e.message === "Failed to fetch" ? "It does not answer right now." : /answered 40[45]/.test(e.message) ? OLDER : e.message;
    }
    drawPrep();
  }
  // a module's line: how it stands there, in words
  function stands(m, d) {
    const own = `${PP.baseOf(d)}/#modules/${encodeURIComponent(m.module)}`;
    return {
      ready: `<span class="ok">Ready</span>${m.here ? ` <em>${esc(m.here)}</em>` : ""}`,
      install: `<span class="todo">Not installed</span> <em>the module pack has it</em>`,
      update: `<span class="todo">Older there</span> <em>${esc(m.here || "?")}; the stack was saved with ${esc(m.detail || m.wanted)}</em>`,
      restart: `<span class="wait">Installed</span> <em>a device in Live once Live restarts there</em>`,
      firmware: `<span class="yours">Needs its ${esc(m.detail || "firmware")}</span> <em>yours: <a href="${esc(own)}" target="_blank" rel="noopener">add it on the ${esc(PP.KINDS[d.kind].short)}'s own page</a></em>`,
      pung: `<span class="yours">Needs Pung ${esc(m.detail)} or later</span> <em><a href="deployments.html#installer">update Pung there</a></em>`,
      unknown: `<span class="bad">Not in any module pack</span> <em>it cannot be installed from here</em>`,
    }[m.state] || esc(m.state);
  }
  function drawPrep() {
    if (!pd) return;
    const body = document.getElementById("sk-prep-body"), r = pd.rec, ds = online();
    let h = `<p class="pl-kicker">Check a deployment</p><h2 id="sk-prep-title">${esc(r.name)}</h2><p class="pl-sub">${esc(sums(r.stack))}</p>`;
    if (!ds.length) {
      body.innerHTML = h + `<p>No deployment is connected. Connect the one the Set is going to, and check again.</p><div class="pl-acts end"><a class="pl-btn primary" href="deployments.html">Deployments</a></div>`;
      return;
    }
    h += `<div class="pl-form"><label for="sk-on">On</label><select id="sk-on" ${pd.busy ? "disabled" : ""}>${ds.map((d) => `<option value="${d.id}" ${pd.dev === d ? "selected" : ""}>${esc(PP.nameOf(d))} · ${esc(PP.KINDS[d.kind].label)}</option>`).join("")}</select></div>`;
    const c = pd.res, d = pd.dev;
    if (pd.err) h += `<div class="pl-err">${esc(pd.err)}</div><div class="pl-acts end"><button type="button" class="pl-btn" id="sk-again">Ask again</button></div>`;
    else if (!c) h += `<p class="pl-sub"><i class="pl-spin" style="display:inline-block;vertical-align:-3px"></i> Asking ${esc(PP.nameOf(d))} what it has…</p>`;
    else {
      const mods = c.modules || [], by = (st) => mods.filter((m) => m.state === st);
      const todo = [...by("install"), ...by("update")], wait = by("restart"), yours = [...by("firmware"), ...by("pung")], bad = by("unknown");
      h += c.ready
        ? `<p class="sk-verdict ok"><i class="pl-led on" aria-hidden="true"></i><b>${esc(PP.nameOf(d))} has everything this stack needs.</b></p>
           <p class="pl-sub">Bring the Set there as you move any Set, and open it: every Pung device comes up with its sound.</p>`
        : `<p class="sk-verdict"><i class="pl-led bad" aria-hidden="true"></i><b>${esc(PP.nameOf(d))} is not ready for this stack yet.</b></p>`;
      if (mods.length) h += `<ul class="sk-stands">${mods.map((m) => `<li class="${esc(m.state)}"><b>${esc(m.name)}</b><span>${stands(m, d)}</span></li>`).join("")}</ul>`;
      if (c.pung) h += `<p class="dv-note"><b>Pung</b> The stack was made with a newer Pung: it asks for ${esc(c.pung)} or later there. <a href="deployments.html#installer">Update Pung on it.</a></p>`;
      if (c.emulators) h += `<p class="dv-note"><b>Emulators</b> The Set has ${c.emulators.wanted.length} (${c.emulators.wanted.map((x) => esc(names[x] || x)).join(", ")}); a ${esc(PP.KINDS[d.kind].short)} plays ${c.emulators.at_once} at once. The others wait, silent, until one is removed.</p>`;
      if (pd.note) h += `<p class="dv-note sk-step">${pd.note}</p>`;
      const acts = [];
      if (pd.busy === "install") acts.push(`<button type="button" class="pl-btn primary" disabled><i class="pl-spin"></i> Installing…</button>`);
      else if (pd.busy === "restart") acts.push(`<button type="button" class="pl-btn primary" disabled><i class="pl-spin"></i> Live is restarting there…</button>`);
      else if (todo.length) acts.push(`<button type="button" class="pl-btn primary" id="sk-inst">Install ${todo.length === 1 ? esc(todo[0].name) : "the " + todo.length + " modules"} there</button>`);
      else if (wait.length) acts.push(`<button type="button" class="pl-btn primary" id="sk-restart">Restart Live there</button>`);
      acts.unshift(`<button type="button" class="pl-btn" id="sk-close">${c.ready ? "Done" : "Close"}</button>`);
      if (!c.ready && !todo.length && !wait.length && (yours.length || bad.length || c.pung)) h += `<p class="pl-sub">What is left is yours to bring: nothing more can be installed from here.</p>`;
      h += `<div class="pl-acts end">${acts.join("")}</div>`;
    }
    body.innerHTML = h;
    const $ = (id) => document.getElementById(id);
    if ($("sk-on")) $("sk-on").onchange = () => askSet(PP.devices.find((x) => x.id === $("sk-on").value));
    if ($("sk-again")) $("sk-again").onclick = () => askSet(pd.dev);
    if ($("sk-close")) $("sk-close").onclick = () => prepDialog().close();
    if ($("sk-inst")) $("sk-inst").onclick = install;
    if ($("sk-restart")) $("sk-restart").onclick = restart;
  }
  // install what the stack names and the deployment lacks, from its own module pack
  async function install() {
    const d = pd.dev, want = (pd.res.modules || []).filter((m) => m.state === "install" || m.state === "update");
    pd.busy = "install"; pd.note = ""; drawPrep();
    const failed = [];
    for (const m of want) {
      try { await post(d, `/api/catalog/${encodeURIComponent(m.module)}/install`, {}); } catch (e) { failed.push(`${m.name}: ${e.message}`); }
    }
    // the installs run there, one after another: watched until none is under way (ten minutes at most)
    const ids = new Set(want.map((m) => m.module));
    for (let i = 0; i < 300 && pd && pd.dev === d; i++) {
      await sleep(2000);
      let cat;
      try { cat = await PP.jsonOf(d, "/api/catalog"); } catch (e) { continue; }
      const mine = (cat.modules || []).filter((x) => ids.has(x.id));
      const busy = mine.filter((x) => x.job && !["done", "failed"].includes(x.job.state));
      for (const x of mine) {
        const n = names[x.id] || x.id;
        if (x.job && x.job.state === "failed" && !failed.some((f) => f.startsWith(n + ":"))) failed.push(`${n}: ${x.job.error || "it failed"}`);
      }
      if (!busy.length) break;
      pd.note = `Installing on ${esc(PP.nameOf(d))}: ${busy.map((x) => esc(names[x.id] || x.id)).join(", ")}…`; drawPrep();
    }
    if (!pd || pd.dev !== d) return;
    pd.busy = "";
    pd.note = failed.length ? `Not everything was installed: ${failed.map(esc).join("; ")}.` : "";
    await recheck();
  }
  // Live takes a new module in when it starts: on the visitor's word alone, because it stops what plays there
  async function restart() {
    const d = pd.dev;
    if (!(await PP.confirm(`Restart Live on ${PP.nameOf(d)} now? What plays there stops for about a minute. The open Set comes back as it is, with its unsaved changes.`, "Restart Live", true))) return;
    if (!pd || pd.dev !== d) return;
    pd.busy = "restart"; pd.note = ""; drawPrep();
    try { await post(d, "/api/catalog/apply", {}); } catch (e) { pd.busy = ""; pd.note = `It did not restart: ${esc(e.message)}.`; drawPrep(); return; }
    // it goes away and comes back: asked every few seconds until it answers again (four minutes at most)
    let back = false;
    for (let i = 0; i < 80 && pd && pd.dev === d; i++) {
      await sleep(3000);
      try {
        const cat = await PP.jsonOf(d, "/api/catalog");
        if (i > 3 && !cat.restarting) { back = true; break; }
      } catch (e) { /* not back yet */ }
    }
    if (!pd || pd.dev !== d) return;
    pd.busy = "";
    pd.note = back ? "" : `${esc(PP.nameOf(d))} has not answered yet. Give it a moment, and ask again.`;
    await recheck();
    await look(d); redraw();
  }
  function prepare(rec) {
    const ds = online(), dlg = prepDialog();
    pd = { rec, dev: null, res: null, err: "", busy: "", note: "" };
    if (!dlg.open) dlg.showModal();
    if (ds.length) askSet(ds.includes(PP.inUse()) ? PP.inUse() : ds[0]); else drawPrep();
  }

  // ---- kept current while the page is open ---------------------------------------------------------
  async function poll() {
    if (document.hidden) return;
    await Promise.all(PP.devices.map(async (d) => {
      if (d.state === "lost") await PP.readOf(d);
      if (d.state === "on") await look(d);
    }));
    draw();
  }
  PP.on((what, d) => {
    if (what === "connected" && d) look(d).then(draw);
    if (what === "disconnected" && d) at.delete(d.id);
    draw();
  });
  tx("readonly", (s) => s.getAll()).then((all) => {
    lib = (all || []).filter((x) => x && x.id && x.stack && !check(x.stack)).sort((a, b) => String(b.added).localeCompare(String(a.added)));
    draw();
  });
  setInterval(poll, 4000);
  draw();
  PP.resume();
})();
