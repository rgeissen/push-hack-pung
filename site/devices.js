// devices.js: pung.live's Your devices page. Every device the visitor has
// connected (pushlink.js: the list lives in their browser), each a panel:
// the device itself (processor with its last minute, memory, storage,
// battery: GET /api/system, src/system.go), what plays on it, its Pung against
// the newest, where its modules come from, and Pung's own switches
// (src/settings.go: the two pung.live may change, src/sitecors.go).
(function () {
  "use strict";
  const PP = window.PungPush, box = document.getElementById("dv");
  if (!PP || !PP.enabled || !box) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let newest = "";
  fetch("release.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { newest = (j && j.version) || ""; render(); }).catch(() => {});
  // per device, while the page is open: its settings, the processor's last minute, what is open
  const more = new Map();
  const of = (d) => { if (!more.has(d.id)) more.set(d.id, { settings: null, cpu: [], renaming: false, noSys: false }); return more.get(d.id); };

  // a < b, as versions (1.2.10 after 1.2.9)
  function older(a, b) {
    const pa = String(a).split(/[.-]/), pb = String(b).split(/[.-]/);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = parseInt(pa[i] || "0", 10), y = parseInt(pb[i] || "0", 10);
      if (x !== y) return x < y;
    }
    return false;
  }
  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 3600) return "just now";
    if (s < 86400 * 2) return Math.round(s / 3600) + " hours ago";
    return Math.round(s / 86400) + " days ago";
  }
  const gb = (n) => (n >= 1e9 ? (n / 1073741824).toFixed(n >= 1e10 ? 0 : 1) + " GB" : Math.round(n / 1048576) + " MB"); // memory, as it is counted
  const disk = (n) => (n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + " GB" : Math.round(n / 1e6) + " MB");              // storage, as it is sold
  // "AbletonOS 4.2" of ("AbletonOS", "abletonos-x86_64-intel-v4.2")
  const system = (s) => { const m = /v?(\d+(?:\.\d+)+)$/.exec(s.version || ""); return [s.name, m ? m[1] : s.version].filter(Boolean).join(" "); };
  function span(s) {
    if (s < 90) return "a minute";
    if (s < 5400) return Math.round(s / 60) + " minutes";
    if (s < 86400 * 2) return Math.round(s / 3600) + " hours";
    return Math.round(s / 86400) + " days";
  }

  // ---- the tiles ---------------------------------------------------------------------------------
  const bar = (frac, cls) => `<div class="dv-bar ${cls || ""}" role="img" aria-label="${Math.round(frac * 100)} percent"><i style="width:${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%"></i></div>`;
  // the processor's last minute, a line (one point a reading)
  function spark(pts) {
    if (pts.length < 2) return `<svg class="dv-spark" viewBox="0 0 240 44" aria-hidden="true"></svg>`;
    // the readings there are fill the width (a minute's worth once the page has been open that long)
    const w = 240, h = 44, at = (v, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${(h - 3 - Math.min(100, v) / 100 * (h - 6)).toFixed(1)}`;
    const line = pts.map(at).join(" ");
    const x0 = "0";
    return `<svg class="dv-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon class="f" points="${x0},${h} ${line} ${w},${h}"/><polyline points="${line}" fill="none"/></svg>`;
  }
  function tiles(d) {
    const s = d.sys, m = of(d), out = [];
    if (s && s.cpu) {
      const c = s.cpu, parts = [];
      if (c.live !== undefined) parts.push(`Live ${c.live.toFixed(0)} %`);
      parts.push(`Pung ${c.pung.toFixed(0)} %`);
      if (c.emulators > 0.5) parts.push(`emulators ${c.emulators.toFixed(0)} %`);
      if (c.background > 1) parts.push(`background ${c.background.toFixed(0)} %`);
      out.push(`<div class="dv-tile wide"><p class="dv-k">Processor</p>
        <div class="dv-cpu"><p class="dv-big">${c.busy.toFixed(0)}<span> % busy</span></p>${spark(m.cpu)}</div>
        <p class="dv-note">${parts.join(" · ")} · ${c.cores} cores${s.temperature ? ` · ${s.temperature.toFixed(0)} °C` : ""}</p></div>`);
    }
    if (s && s.memory) {
      const used = s.memory.total - s.memory.available;
      out.push(`<div class="dv-tile"><p class="dv-k">Memory</p><p class="dv-big">${gb(s.memory.available)}<span> free</span></p>${bar(used / s.memory.total)}
        <p class="dv-note">${gb(used)} of ${gb(s.memory.total)} in use</p></div>`);
    }
    if (s && s.disk) {
      const used = s.disk.total - s.disk.free, low = s.disk.free < 1.5e9;
      out.push(`<div class="dv-tile"><p class="dv-k">Storage</p><p class="dv-big">${disk(s.disk.free)}<span> free</span></p>${bar(used / s.disk.total, low ? "warn" : "")}
        <p class="dv-note">of ${disk(s.disk.total)}${s.modules && s.modules.bytes ? ` · Pung's modules take ${disk(s.modules.bytes)}` : ""}${low ? " · running low" : ""}</p></div>`);
    }
    if (s && s.battery) {
      const b = s.battery;
      out.push(`<div class="dv-tile"><p class="dv-k">Battery</p><p class="dv-big">${b.percent}<span> %</span></p>${bar(b.percent / 100, b.percent < 20 && !b.charging ? "warn" : "ok")}
        <p class="dv-note">${b.charging ? (b.status === "Full" ? "Full, on power" : "Charging") : "On battery"}</p></div>`);
    }
    // what plays
    if (s) {
      const devs = s.devices || [], emus = devs.filter((x) => x.emulator);
      const playing = emus.filter((x) => !x.resting).length;
      out.push(`<div class="dv-tile" data-fill><p class="dv-k">In your Set</p><p class="dv-big">${devs.length}<span> Pung device${devs.length === 1 ? "" : "s"}</span></p>
        <p class="dv-note">${devs.length ? esc([...new Set(devs.map((x) => x.name || x.module))].slice(0, 6).join(", ")) + (emus.length ? `. ${emus.length} emulator${emus.length === 1 ? "" : "s"}: ${playing} playing, ${emus.length - playing} resting.` : ".") : "None loaded in Live right now."}</p></div>`);
    }
    // Pung
    const behind = newest && d.version && older(d.version, newest);
    out.push(`<div class="dv-tile"><p class="dv-k">Pung</p><p class="dv-big">${esc(d.version || "?")}</p>
      <p class="dv-note">${behind ? `Pung ${esc(newest)} is out. <a href="#install">Update it</a> the way you installed it; modules, sounds and settings stay.` : newest ? "The newest Pung." : ""}${s && s.pung ? ` Running for ${span(s.pung.uptime_s)}.` : ""}${s && s.system && (s.system.name || s.system.version) ? ` ${esc(system(s.system))}.` : ""}</p></div>`);
    // modules
    const ms = (d.data && d.data.modules.filter((x) => x.supported && x.in_catalog)) || [];
    const inst = ms.filter((x) => x.installed).length, ups = ms.filter((x) => x.status === "update").length;
    const c = (d.data && d.data.catalog) || {};
    const own = c.source === "pung" || (!c.source && String(c.url || "").startsWith("file:")); // a Pung before 0.6.0 names no source
    const pack = c.source === "pung.live" ? "pung.live's current pack" : own ? "the pack that came with its Pung" : "a catalog named on the device";
    out.push(`<div class="dv-tile" data-fill2><p class="dv-k">Modules</p><p class="dv-big">${inst}<span> installed</span></p>
      <p class="dv-note">${ups ? `<b>${ups} update${ups === 1 ? "" : "s"} waiting.</b> ` : ""}From ${pack}${c.generated_at ? ", made " + ago(c.generated_at) : ""}. <a href="modules/">${ups ? "Update them" : "Install more"}</a>.</p></div>`);
    // the last row is full: the tile that has most to say takes what is left of four columns
    const units = out.length + (out[0] && out[0].includes("dv-tile wide") ? 1 : 0), left = (4 - units % 4) % 4;
    let html = out.join("");
    if (left) html = html.includes("data-fill>") ? html.replace("data-fill>", `style="grid-column: span ${left + 1}">`) : html.replace("data-fill2>", `style="grid-column: span ${left + 1}">`);
    return html;
  }

  function settingsCard(d) {
    const m = of(d), s = m.settings;
    const sw = (key, label, note, on, off) => `<label class="yp-switch"><input type="checkbox" role="switch" data-dev="${d.id}" data-key="${key}" data-on="${esc(on)}" data-off="${esc(off)}" ${s && s[key] ? "checked" : ""} ${s ? "" : "disabled"}>
        <span><b>${label}</b><span>${note}</span></span></label>`;
    return `<div class="dv-settings"><p class="dv-k">Pung's settings</p>
      ${sw("own_pack_only", "Only the modules that came with this Pung", "Off: online, Pung asks pung.live for new and newer modules. On: it never asks.", "Only the modules that came with Pung.", "Pung asks pung.live for newer modules.")}
      ${sw("touch_card", "A large card while an encoder is touched", "Off: the touched column shows its range and fine adjustment in place. The Push's columns are wide enough for off.", "The detail card is on.", "The detail card is off.")}
      ${s ? "" : `<p class="dv-note">It did not hand over its settings. They are on <a href="${esc(PP.baseOf(d))}/#setup" target="pung-device" rel="noopener">Pung's own page ↗</a> too.</p>`}</div>`;
  }

  function panel(d) {
    const m = of(d), k = PP.KINDS[d.kind], use = PP.inUse() === d, many = PP.devices.length > 1;
    const led = d.state === "on" ? "on" : d.state === "lost" ? "bad" : "";
    const where = d.sys && d.sys.addresses && d.sys.addresses.length ? d.sys.addresses.join(", ") + (d.sys.addresses.includes(d.addr) ? "" : " · " + d.addr) : d.addr;
    const name = m.renaming
      ? `<form class="dv-rename" data-dev="${d.id}"><input type="text" value="${esc(PP.nameOf(d))}" maxlength="40" aria-label="Its name"><button class="btn primary" type="submit">Save</button></form>`
      : `<h2>${esc(PP.nameOf(d))} <button type="button" class="dv-edit" data-rename="${d.id}" aria-label="Rename it" title="Rename it">✎</button></h2>`;
    const head = `<header class="dv-head"><i class="pl-led ${led}" aria-hidden="true"></i><div class="dv-title">${name}
        <p class="dv-sub">${esc(k.label)} · ${esc(where)}${many && use ? ` · <b>modules install here</b>` : ""}</p></div>
      <div class="dv-acts">${d.state === "on" ? `<a class="btn" href="${esc(PP.baseOf(d))}/" target="pung-device" rel="noopener">Pung's own page ↗</a>` : ""}
        ${many && !use && d.state === "on" ? `<button type="button" class="btn" data-use="${d.id}">Install modules here</button>` : ""}
        ${d.state === "on" ? `<button type="button" class="btn" data-off="${d.id}">Disconnect</button>` : `<button type="button" class="btn primary" data-connect="${d.id}" ${d.state === "trying" ? "disabled" : ""}>${d.state === "trying" ? "Connecting…" : d.state === "link" ? "Try to connect" : "Connect"}</button>`}
        <button type="button" class="btn" data-remove="${d.id}" aria-label="Remove ${esc(PP.nameOf(d))} from this page">Remove</button></div></header>`;
    let body;
    if (d.state === "on") {
      body = `<div class="dv-tiles">${tiles(d)}</div>
        ${m.noSys ? `<p class="dv-note dv-old">Its Pung is older than 0.6.0 and says less about the device: <a href="#install">update Pung</a> for processor, memory, storage and battery here.</p>` : ""}
        ${settingsCard(d)}`;
    } else {
      const words = {
        off: "Not connected. Connect to see it here.",
        trying: "Looking for it…",
        lost: "It does not answer right now: off, asleep, or off this network. This page keeps trying.",
        link: "This browser cannot reach it from a web page. Its buttons open Pung's own page on the device, where everything on this page is too.",
      };
      body = `<p class="dv-note dv-quiet">${words[d.state] || words.off}${d.state === "link" ? ` <a href="${esc(PP.baseOf(d))}/#setup" target="pung-device" rel="noopener">Open Pung on it ↗</a>` : ""}</p>`;
    }
    return `<article class="dv-panel ${d.state}" data-id="${d.id}">${head}${body}</article>`;
  }

  let sig = "";
  function render() {
    const ds = PP.devices;
    const html = ds.length
      ? ds.map(panel).join("") + `<div class="dv-add"><button type="button" class="btn" id="dv-add">Add another device</button><span class="dv-note">Another Push, or, when Pung runs on more, another kind of device.</span></div>`
      : `<div class="dv-empty"><p>Connect your Push to see it here: its processor, memory and storage, what plays, its Pung and its settings. pung.live talks to it over your home network; nothing passes through the internet, and the list of your devices stays in this browser.</p>
          <div data-push-chip></div></div>`;
    if (html === sig) { PP.renderChips(); return; }
    // a name being typed is not redrawn under the hands
    if (box.querySelector(".dv-rename input:focus")) return;
    sig = html;
    box.innerHTML = html;
    PP.renderChips();
    const dev = (id) => PP.devices.find((x) => x.id === id);
    box.querySelectorAll("[data-connect]").forEach((b) => (b.onclick = () => { const d = dev(b.dataset.connect); if (d.state === "link" || d.err) PP.open(d); else PP.connectTo(d); }));
    box.querySelectorAll("[data-off]").forEach((b) => (b.onclick = () => PP.disconnect(dev(b.dataset.off))));
    box.querySelectorAll("[data-use]").forEach((b) => (b.onclick = () => PP.select(dev(b.dataset.use))));
    box.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => {
      const d = dev(b.dataset.remove);
      if (await PP.confirm(`Remove ${PP.nameOf(d)} from this page? Nothing changes on the device; connect it again any time.`, "Remove", true)) { more.delete(d.id); PP.remove(d); }
    }));
    box.querySelectorAll("[data-rename]").forEach((b) => (b.onclick = () => { of(dev(b.dataset.rename)).renaming = true; sig = ""; render(); const i = box.querySelector(".dv-rename input"); if (i) { i.focus(); i.select(); } }));
    box.querySelectorAll(".dv-rename").forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); const d = dev(f.dataset.dev); of(d).renaming = false; sig = ""; PP.rename(d, f.querySelector("input").value); }));
    box.querySelectorAll("input[data-key]").forEach((i) => (i.onchange = () => setSwitch(dev(i.dataset.dev), i.dataset.key, i.checked, i.checked ? i.dataset.on : i.dataset.off)));
    const add = document.getElementById("dv-add");
    if (add) add.onclick = () => PP.open("add");
  }

  async function loadSettings(d) {
    try { of(d).settings = (await PP.jsonOf(d, "/api/settings")).settings || {}; } catch (e) { of(d).settings = null; }
    render();
  }
  async function setSwitch(d, key, on, said) {
    try {
      const r = await PP.jsonOf(d, "/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: on }) });
      of(d).settings = r.settings || of(d).settings;
      PP.toast(said);
      if (key === "own_pack_only") PP.readOf(d).then(render);
    } catch (e) {
      PP.toast("The setting could not be saved: the device did not answer.", true);
    }
    sig = "";
    render();
  }

  // what each device has, kept current while the page is open: the device itself every
  // 2 seconds (the processor's line), its modules every 8
  let n = 0;
  async function poll() {
    if (document.hidden) return;
    n++;
    await Promise.all(PP.devices.map(async (d) => {
      if (d.state !== "on" && d.state !== "lost") return;
      if (n % 4 === 0 || d.state === "lost") await PP.readOf(d);
      if (d.state !== "on") return;
      const m = of(d), s = await PP.systemOf(d);
      m.noSys = !s;
      if (s && s.cpu) { m.cpu.push(s.cpu.busy); if (m.cpu.length > 30) m.cpu.shift(); }
    }));
    render();
  }
  PP.on((what, d) => {
    if (what === "connected" && d) { loadSettings(d); PP.systemOf(d).then((s) => { of(d).noSys = !s; render(); }); }
    if (what === "disconnected" && d) { of(d).settings = null; of(d).cpu = []; }
    render();
  });
  setInterval(poll, 2000);
  render();
  PP.resume();
})();
