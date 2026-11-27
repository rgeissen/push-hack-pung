// The Pung Installer's page: what the installer (main.go) is doing, and the
// next thing to press. It asks for the state twice a second.
(function () {
  "use strict";
  const KEY = location.hash.slice(1);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let S = null, sig = "", lastPhase = "";

  async function call(path, body) {
    const r = await fetch("/api/" + path, { method: "POST", headers: { "X-Pung-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error("the installer answered " + r.status);
    return r.json();
  }
  async function tick() {
    try { S = await call("state"); render(); } catch (e) { gone(); }
    setTimeout(tick, S && /ing$/.test(S.phase) ? 400 : 1000);
  }
  function gone() {
    $("panel").innerHTML = `<p class="kicker">Installer</p><h1>The installer has stopped</h1><p class="lead">Start Pung Installer again to go on.</p>`;
  }
  const act = (path, body) => call(path, body).then((s) => { S = s; render(); }).catch(gone);

  // which step of the rail the phase belongs to
  const STEP = { find: "find", finding: "find", key: "key", waiting: "key", inspecting: "ready", ready: "ready", installing: "install", done: "install", failed: "install" };
  const ORDER = ["find", "key", "ready", "install"];

  function rail() {
    const cur = STEP[S.phase] || "find";
    const at = ORDER.indexOf(cur);
    document.querySelectorAll("#rail li").forEach((li) => {
      const i = ORDER.indexOf(li.dataset.step);
      const done = i < at || (S.phase === "done" && i === at);
      li.className = done ? "done" : i === at ? "now" : "";
      li.querySelector("b").textContent = done ? "✓" : String(i + 1);
      if (i === at) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
  }

  function render() {
    if (!S) return;
    $("ver").textContent = "v" + S.version;
    rail();
    const html = view();
    if (html === sig) return;
    const focused = document.activeElement && document.activeElement.id;
    const val = $("addr") ? $("addr").value : null;
    sig = html;
    $("panel").innerHTML = html;
    wire();
    if (val !== null && $("addr") && S.phase === "find") $("addr").value = val;
    if (focused && $(focused)) $(focused).focus();
    else if (S.phase !== lastPhase) { const f = $("panel").querySelector("input, .btn.primary"); if (f) f.focus(); }
    lastPhase = S.phase;
  }

  const spin = `<span class="spin" aria-hidden="true"></span>`;
  const mb = (n) => (n / 1048576).toFixed(n > 104857600 ? 0 : 1) + " MB";

  function view() {
    const a = esc(S.addr);
    const err = S.error ? `<div class="alert" role="alert"><p>${esc(S.error)}</p>${S.error_why === "host-changed" ? `<div class="row"><button class="btn" id="forget">Forget the old one and find it again</button></div>` : ""}</div>` : "";
    switch (S.phase) {
      case "find":
      case "finding": {
        const busy = S.phase === "finding";
        return `<p class="kicker">Step 1</p><h1>Find your Push</h1>
          <p class="lead">Turn your Push 3 on in Standalone mode, on the same network as this computer. Most home networks know it as <b>push.local</b>.</p>
          <form id="find" class="field"><label for="addr">Your Push</label>
            <div class="row"><input id="addr" type="text" value="${a}" autocomplete="off" spellcheck="false" ${busy ? "disabled" : ""}>
            <button class="btn primary" type="submit" ${busy ? "disabled" : ""}>${busy ? spin + " Looking…" : "Find it"}</button></div></form>
          ${err}
          <p class="sub">If push.local is not found, use the Push's IP address: your router's list of devices shows it.</p>`;
      }
      case "key":
      case "waiting":
        return `<p class="kicker">Step 2</p><h1>Let this computer in</h1>
          <p class="lead">Your Push lets a computer in once you allow it, on the Push. This happens once.</p>
          <ol class="how">
            <li><div><p>Copy this computer's key.</p>
              <div class="key"><code id="pub">${esc(S.pubkey)}</code><button class="btn" id="copy" type="button">Copy</button></div></div></li>
            <li><div><p>Open your Push's key page, paste the key there and save it.</p>
              <div class="row"><a class="btn" href="http://${a}/ssh" target="_blank" rel="noopener">Open ${a}/ssh ↗</a></div></div></li>
            <li><div><p>On the Push, press <kbd>Shift</kbd> + <kbd>Select</kbd> + <kbd>Preferences</kbd> (the gear) to allow it.</p></div></li>
          </ol>
          ${err}
          <div class="wait">${spin}<span>Waiting for your Push to let this computer in. This page goes on by itself.</span></div>
          <div class="row"><button class="btn ghost" id="back" type="button">Back</button></div>`;
      case "inspecting":
        return `<p class="kicker">Step 3</p><h1>Looking at your Push</h1><div class="wait">${spin}<span>Reading what is installed on ${a}…</span></div>`;
      case "ready":
        return ready();
      case "installing":
        return installing();
      case "done":
        return done();
      case "failed":
        return `<p class="kicker">Step 4</p><h1>Something went wrong</h1>${steps()}${err}
          <p class="sub">Nothing was left half done: Pung stays as it was until a new one is in place. Try again, or ask on the Pung page.</p>
          <div class="row"><button class="btn primary" id="install" type="button">Try again</button><button class="btn ghost" id="recheck" type="button">Look at the Push again</button></div>`;
    }
    return "";
  }

  function plan() {
    const p = S.push || {}, m = S.manifest || {}, l = S.latest;
    const needPH = !p.push_hack_ok || !p.remote_script;
    const pungAct = !p.pung ? "install" : l && l.version !== p.pung ? "update" : "reinstall";
    return { p, m, l, needPH, pungAct };
  }

  function ready() {
    const { p, m, l, needPH, pungAct } = plan();
    const rows = [];
    rows.push(p.push_hack_ok
      ? `<div><span class="dot ok">✓</span><span><b>Push Hack</b> <span class="sub">the framework Pung runs on</span></span><span class="v">${esc(p.push_hack || "installed")}</span></div>`
      : `<div><span class="dot add">+</span><span><b>Push Hack</b> <span class="sub">the framework Pung runs on: installed first</span></span><span class="v">${esc(m.push_hack && m.push_hack.version)}</span></div>`);
    if (p.push_hack_ok && !p.remote_script) rows.push(`<div><span class="dot add">+</span><span><b>PushHack Remote Script</b> <span class="sub">how Pung reaches Live</span></span><span class="v">added</span></div>`);
    rows.push(!p.pung
      ? `<div><span class="dot add">+</span><span><b>Pung</b> <span class="sub">not installed yet</span></span><span class="v">${l ? esc(l.version) : "…"}</span></div>`
      : pungAct === "update"
        ? `<div><span class="dot up">↑</span><span><b>Pung</b> <span class="sub">${esc(p.pung)} installed, a newer one is out</span></span><span class="v">${esc(p.pung)} → ${esc(l.version)}</span></div>`
        : `<div><span class="dot ok">✓</span><span><b>Pung</b> <span class="sub">the newest, ${p.pung_running ? "running" : "installed"}</span></span><span class="v">${esc(p.pung)}</span></div>`);
    const label = !l ? "Install Pung" : pungAct === "install" ? `Install Pung ${esc(l.version)}` : pungAct === "update" ? `Update Pung to ${esc(l.version)}` : `Install Pung ${esc(l.version)} again`;
    const notes = [];
    if (needPH && !p.push_hack_ok) notes.push(`<p><b>Save your Set first.</b> Installing Push Hack restarts the Push's own software once, Live with it.</p>`);
    if (p.pung) notes.push(`<p>Pung restarts while it is replaced: its devices in your Set pause for a few seconds. Your sounds, ROMs and settings stay.</p>`);
    return `<p class="kicker">Step 3</p><h1>Your Push</h1>
      <p class="lead">Found at <b>${esc(p.addr)}</b>${p.firmware ? ` <span class="sub">· system ${esc(p.firmware)}</span>` : ""}. This is what the installer will do:</p>
      <div class="have">${rows.join("")}</div>
      ${notes.length ? `<div class="alert note">${notes.join("")}</div>` : ""}
      ${l ? "" : `<p class="sub">${spin} Asking pung.live for the newest Pung…</p>`}
      <div class="row"><button class="btn primary" id="install" type="button" ${l ? "" : "disabled"}>${label}</button>
        <button class="btn ghost" id="back" type="button">Another Push</button></div>`;
  }

  function steps() {
    if (!S.steps || !S.steps.length) return "";
    return `<ul class="steps">${S.steps.map((s) => `<li class="${s.state}"><span class="s">${s.state === "doing" ? spin : s.state === "done" ? "✓" : "✕"}</span><span>${esc(s.text)}</span></li>`).join("")}</ul>`;
  }

  function installing() {
    const t = S.dl_total, d = S.dl_done;
    const dl = d > 0 && t > 0 && d < t ? `<div class="dl"><div class="bar-dl" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((100 * d) / t)}"><i style="width:${((100 * d) / t).toFixed(1)}%"></i></div>
      <span class="sub">${mb(d)} of ${mb(t)}</span></div>` : "";
    return `<p class="kicker">Step 4</p><h1>Installing</h1>${steps()}${dl}
      <p class="sub">Keep the Push on and this page open. It takes a minute or two.</p>`;
  }

  function done() {
    const p = S.push || {}, did = S.did || [];
    const port = p.pung_port || 7720;
    const items = [];
    if (did.includes("push-hack")) items.push(`<div class="item"><span class="n">${items.length + 1}</span><div><p><b>Turn on the PushHack control surface.</b> On the Push, in Live's settings: MIDI → Control Surface, choose <b>PushHack</b>. Pung reads Live's tracks and devices through it.</p></div></div>`);
    items.push(`<div class="item"><span class="n">${items.length + 1}</span><div><p><b>Restart Live once,</b> so Pung's devices appear in Push's browser. Save your Set first; Live reopens it.</p>
      <div class="row"><button class="btn primary" id="restart" type="button" ${S.live_restarting ? "disabled" : ""}>${S.live_restarting ? spin + " Live is restarting…" : "Restart Live now"}</button></div></div></div>`);
    items.push(`<div class="item"><span class="n">${items.length + 1}</span><div><p><b>Add modules.</b> Pung's page on your Push, or pung.live, installs them in one press.</p>
      <div class="row"><a class="btn" href="http://${esc(p.addr)}:${port}/#modules" target="_blank" rel="noopener">Pung on your Push ↗</a><a class="btn" href="https://pung.live/modules/" target="_blank" rel="noopener">Modules on pung.live ↗</a></div></div></div>`);
    return `<p class="kicker">Done</p><h1>Pung ${esc(p.pung)} is on your Push</h1>${steps()}
      <div class="alert ok"><p>Pung runs on your Push${p.push_hack ? `, on Push Hack ${esc(p.push_hack)}` : ""}. You can close the installer, or keep it for the steps below.</p></div>
      <div class="next">${items.join("")}</div>
      <div class="row"><button class="btn ghost" id="quit" type="button">Close the installer</button></div>`;
  }

  function wire() {
    const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
    if ($("find")) $("find").onsubmit = (e) => { e.preventDefault(); act("find", { addr: $("addr").value }); };
    on("forget", () => act("forget"));
    on("back", () => act("back"));
    on("install", () => act("install"));
    on("recheck", () => act("recheck"));
    on("copy", async () => {
      try { await navigator.clipboard.writeText(S.pubkey); } catch (e) {
        const r = document.createRange(); r.selectNodeContents($("pub")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand("copy");
      }
      $("copy").textContent = "Copied ✓";
      setTimeout(() => { if ($("copy")) $("copy").textContent = "Copy"; }, 2000);
    });
    on("restart", () => {
      if (confirm("Restart Live on your Push now? Save your Set first: Live reopens it.")) act("restart-live");
    });
    on("quit", () => { call("quit").catch(() => {}); setTimeout(gone, 400); });
    // the key step waits by itself
    if (S.phase === "key") call("wait-key").catch(() => {});
  }

  if (!KEY) { gone(); return; }
  tick();
})();
