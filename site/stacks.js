// stacks.js: pung.live's Stacks page. A stack is what travels between
// devices (docs/STACKS.md): the modules in their order, the state of each,
// Pung's modulation over them. This page is where the visitor's stacks live:
// taken from a device (GET /api/stacks/playing/{n}), kept in this browser
// (IndexedDB "pung", store "stacks"; a file for another browser or a backup),
// sent to a deployment (POST /api/stacks, src/stacks.go). A deployment (a Pung that runs somewhere:
// "device" in this code; on the page that word is kept for what it means in Live) plays a stack
// and keeps what it was sent; it has no library of its own.
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
  function check(st) {
    if (!st || st.pung_stack !== 1) return "It is not a stack this page reads.";
    if (!Array.isArray(st.modules) || !st.modules.length) return "The stack holds no module.";
    for (const m of st.modules) if (!m || !ROLE[m.role] || typeof m.id !== "string" || !/^[\w.-]+$/.test(m.id)) return "The stack names a module this page cannot read.";
    return "";
  }

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
  const of = (d) => { if (!at.has(d.id)) at.set(d.id, { playing: [], kept: [], knows: null }); return at.get(d.id); };
  async function look(d) {
    const a = of(d);
    try {
      const r = await PP.jsonOf(d, "/api/stacks");
      a.playing = r.playing || []; a.kept = r.kept || []; a.knows = true;
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
  function card(rec) {
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

  // what plays on each connected device: a stack to take
  function playing() {
    const ds = PP.devices;
    if (!ds.length) return `<div class="dv-empty"><p>Connect a deployment to take what it plays, and to send a stack to it. pung.live talks to it over your home network; your stacks stay in this browser.</p><div data-push-chip></div></div>`;
    return ds.map((d) => {
      const a = of(d);
      let body;
      if (d.state !== "on") body = `<p class="dv-note">${d.state === "trying" ? "Looking for it…" : `Not connected. <a href="deployments.html">Deployments</a> has it.`}</p>`;
      else if (a.knows === false) body = `<p class="dv-note">Its Pung does not know stacks yet. <a href="deployments.html#install">Update Pung</a> on it.</p>`;
      else if (!a.playing.length) body = `<p class="dv-note">No Pung device in its Set right now. Load one there, shape its sound, and take it here.</p>`;
      else body = `<ul class="sk-play">${a.playing.map((p) => `<li><span class="sk-what"><b>${esc(p.name)}</b>${p.sound ? ` <span>${esc(p.sound)}</span>` : ""}${p.midi_fx ? ` <i>${esc(names[p.midi_fx] || p.midi_fx)} in front</i>` : ""}</span>
          <button type="button" class="btn" data-take="${p.n}" data-dev="${d.id}">Take as a stack</button></li>`).join("")}</ul>`;
      return `<section class="sk-dev"><header><i class="pl-led ${d.state === "on" ? "on" : d.state === "lost" ? "bad" : ""}" aria-hidden="true"></i><h3>${esc(PP.nameOf(d))}</h3><p class="dv-sub">${esc(PP.KINDS[d.kind].label)} · playing now</p></header>${body}</section>`;
    }).join("");
  }

  let sig = "";
  function draw() {
    const cards = lib.length
      ? `<div class="sk-grid">${lib.map(card).join("")}</div>`
      : `<div class="dv-empty sk-first"><p><b>No stacks here yet.</b> A stack is a sound with everything it stands on: the modules in their order, each one's state, and Pung's modulation over them.</p>
          <ol class="sk-steps"><li><b>Take</b> what a deployment plays, below.</li><li><b>Keep</b> it here, under a name of yours.</li><li><b>Send</b> it to a deployment: the same one later, or another.</li></ol></div>`;
    const html = `<section class="home-sec"><div class="sk-bar"><div class="sec-head"><p class="eyebrow">In this browser</p><h2>Your stacks</h2></div>
        <div class="dv-acts"><button type="button" class="btn" id="sk-open">Open a file</button><input type="file" id="sk-input" accept="${EXT},.json,application/json" multiple hidden></div></div>
        ${dbFail ? `<p class="dv-note sk-warn">This browser does not let the page keep anything (a private window?). Stacks you take stay until the page closes: download the ones you want.</p>` : ""}
        ${cards}</section>
      <section class="home-sec"><div class="sec-head"><p class="eyebrow">On your deployments</p><h2>Playing now</h2></div><div class="sk-devs">${playing()}</div></section>`;
    if (html === sig) { PP.renderChips(); return; }
    if (box.querySelector(".dv-rename input:focus")) return; // a name being typed is not redrawn under the hands
    sig = html;
    box.innerHTML = html;
    PP.renderChips();
    const rec = (id) => lib.find((x) => x.id === id), dev = (id) => PP.devices.find((x) => x.id === id);
    const on = (sel, f) => box.querySelectorAll(sel).forEach((b) => (b.onclick = () => f(b)));
    on("[data-take]", (b) => take(dev(b.dataset.dev), +b.dataset.take, b));
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
    if (added) PP.toast(added === 1 ? `“${last}” is in your stacks.` : `${added} stacks are in your stacks.`);
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
    let h = `<p class="pl-kicker">Send a stack</p><h2 id="sk-send-title">${esc(r.name)}</h2>`;
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
