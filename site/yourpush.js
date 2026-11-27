// yourpush.js: the Your Push page of pung.live. Connected (pushlink.js), it
// shows the Pung on the visitor's Push: its version against the newest, where
// its modules come from, what is installed, and Pung's own switches
// (src/settings.go: the two pung.live may change, src/sitecors.go).
(function () {
  "use strict";
  const PP = window.PungPush, box = document.getElementById("yp");
  if (!PP || !PP.enabled || !box) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const st = PP.state;
  let newest = "", settings = null, sig = "";
  fetch("release.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { newest = (j && j.version) || ""; render(); }).catch(() => {});

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

  async function loadSettings() {
    try { settings = (await PP.json("/api/settings")).settings || {}; } catch (e) { settings = null; }
    render();
  }
  async function setSwitch(key, on, said) {
    try {
      const r = await PP.json("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: on }) });
      settings = r.settings || settings;
      PP.toast(said);
      if (key === "own_pack_only") PP.read().then(render);
    } catch (e) {
      PP.toast("The setting could not be saved: your Push did not answer.", true);
    }
    render();
  }

  function render() {
    let html;
    if (st.state !== "on") {
      const words = {
        off: "Connect your Push to see its Pung here and change its settings. pung.live talks to it over your home network; nothing passes through the internet.",
        trying: "Looking for your Push…",
        lost: "Your Push does not answer right now. This page keeps trying.",
        link: "This browser cannot reach your Push from a web page. The button opens Pung's own page on your Push, where everything on this page is too.",
      };
      html = `<div class="yp-card"><p>${words[st.state] || words.off}</p><div data-push-chip></div>${st.state === "link" ? `<p><a class="btn" href="${esc(PP.base())}/#setup" target="pung-push" rel="noopener">Open Pung on your Push ↗</a></p>` : ""}</div>`;
    } else {
      const ms = (st.data && st.data.modules.filter((x) => x.supported && x.in_catalog)) || [];
      const inst = ms.filter((x) => x.installed).length, ups = ms.filter((x) => x.status === "update").length;
      const c = (st.data && st.data.catalog) || {};
      const own = c.source === "pung" || (!c.source && String(c.url || "").startsWith("file:")); // a Pung before 0.6.0 names no source
      const pack = c.source === "pung.live" ? "pung.live's current pack" : own ? "the pack that came with your Pung" : "a catalog named on the Push";
      const behind = newest && st.version && older(st.version, newest);
      const sw = (key, label, note, said) => {
        const on = settings && !!settings[key];
        return `<label class="yp-switch"><input type="checkbox" role="switch" data-key="${key}" data-on="${esc(said[0])}" data-off="${esc(said[1])}" ${on ? "checked" : ""} ${settings ? "" : "disabled"}>
          <span><b>${label}</b><span>${note}</span></span></label>`;
      };
      html = `
      <div class="yp-grid">
        <div class="yp-card">
          <p class="yp-k">Pung</p>
          <p class="yp-big">${esc(st.version || "?")}</p>
          <p class="yp-note">${behind ? `Pung ${esc(newest)} is out. <a href="#install">Update it</a> the way you installed it; your modules, sounds and settings stay.` : newest ? "The newest Pung." : ""}</p>
        </div>
        <div class="yp-card">
          <p class="yp-k">Modules</p>
          <p class="yp-big">${inst} <span>installed</span></p>
          <p class="yp-note">${ups ? `${ups} update${ups === 1 ? "" : "s"} waiting. ` : ""}From ${pack}${c.generated_at ? ", made " + ago(c.generated_at) : ""}. <a href="modules/">${ups ? "Update them" : "Install more"}</a>.</p>
        </div>
        <div class="yp-card">
          <p class="yp-k">Address</p>
          <p class="yp-big yp-addr">${esc(st.addr)}</p>
          <p class="yp-note"><a href="${esc(PP.base())}/" target="pung-push" rel="noopener">Pung's own page on your Push ↗</a>: your devices, sounds, ROMs.</p>
        </div>
      </div>
      <div class="yp-card yp-settings">
        <p class="yp-k">Pung's settings</p>
        ${sw("own_pack_only", "Only the modules that came with this Pung", "Off: online, Pung asks pung.live for new and newer modules. On: it never asks.", ["Only the modules that came with Pung.", "Pung asks pung.live for newer modules."])}
        ${sw("touch_card", "A large card while an encoder is touched", "Off: the touched column shows its range and fine adjustment in place. The Push's columns are wide enough for off.", ["The detail card is on.", "The detail card is off."])}
        ${settings ? "" : `<p class="yp-note">Your Push did not hand over its settings. They are on <a href="${esc(PP.base())}/#setup" target="pung-push" rel="noopener">Pung's own page ↗</a> too.</p>`}
      </div>
      <div class="yp-acts"><div data-push-chip></div><button type="button" class="btn" id="yp-off">Disconnect</button></div>`;
    }
    if (html === sig) { PP.renderChips(); return; }
    sig = html;
    box.innerHTML = html;
    PP.renderChips();
    box.querySelectorAll("input[data-key]").forEach((i) => (i.onchange = () => setSwitch(i.dataset.key, i.checked, i.checked ? i.dataset.on : i.dataset.off)));
    const off = document.getElementById("yp-off");
    if (off) off.onclick = () => PP.disconnect();
  }

  let timer = 0;
  PP.on((what) => {
    if (what === "connected") loadSettings();
    if (what === "disconnected") settings = null;
    render();
  });
  // what the Push has, kept current while the page is open
  timer = setInterval(() => { if (!document.hidden && (st.state === "on" || st.state === "lost")) PP.read().then(render); }, 6000);
  render();
  PP.resume();
})();
