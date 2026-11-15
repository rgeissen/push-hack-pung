#!/usr/bin/env python3
"""On-device test: Pung's web page edits Pung devices in Live, both ways.

Uses the modules with the most to show: OB-Xd (its own web_ui.html, ~90
parameters, presets that move every one of them), then Dexed and Hera (no
page of their own: the generic one, from chain_params). Runs ON the Push, as
root, with Live up.

It works on one MIDI track called "Pung Web Test", made the first time
(track.ensure: a second run finds it) and left holding OB-Xd at the end.

    python3 web_devices_test.py
"""
import json
import socket
import sys
import time
import urllib.request

TRACK_NAME = "Pung Web Test"
WEB = "http://127.0.0.1:7720"
results = []


def live(ns, cmd, **args):
    s = socket.create_connection(("127.0.0.1", 7704), timeout=15)
    f = s.makefile("rw")
    f.write(json.dumps(dict(id=1, ns=ns, cmd=cmd, **args)) + "\n")
    f.flush()
    r = json.loads(f.readline())
    s.close()
    return r


def get(path):
    with urllib.request.urlopen(WEB + path, timeout=5) as r:
        body = r.read()
        return json.loads(body) if r.headers.get("Content-Type", "").startswith("application/json") else body


def post(path, data):
    req = urllib.request.Request(WEB + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def check(ok, what):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + what, flush=True)
    return ok


def note(what):
    print("     " + what, flush=True)


def track_devices(t):
    return live("device", "list", track=t).get("data", {}).get("devices", [])


def live_params(t, path):
    return live("device", "params", track=t, path=path).get("data", {}).get("params", [])


def load(t, name, module):
    """Empties the track, loads the browser entry, returns (Live path, Pung n)."""
    for d in reversed(track_devices(t)):
        live("device", "delete", track=t, device=d["i"])
    live("track", "select", track=t)
    r = live("browser", "load", name=name)
    if not check(r.get("ok"), "browser loads %s" % name):
        note(json.dumps(r))
        return None, -1
    path = None
    for _ in range(20):
        time.sleep(0.5)
        for d in track_devices(t):
            if d["name"] == name:
                path = [d["i"], 0, 0]
        if path:
            break
    if not check(path, "%s is on the track" % name):
        return None, -1
    live("device", "select", track=t, path=path)
    n = -1
    for _ in range(20):
        time.sleep(0.4)
        s = get("/api/pung-devices")
        if s["selected"] >= 0 and any(d["n"] == s["selected"] and d["module"] == module for d in s["devices"]):
            n = s["selected"]
            break
    check(n >= 0, "the web page knows which device Live selected (%s, chain %d)" % (module, n))
    return path, n


def by_name(params):
    return {p["name"]: p for p in params}


def changed(before, after):
    a, b = by_name(before), by_name(after)
    return sorted(k for k in b if k in a and abs(a[k]["v"] - b[k]["v"]) > 1e-4)


def meta_of(info, key):
    for p in info.get("chain_params") or []:
        if p.get("key") == key:
            return p
    return None


def web_to_live(t, path, n, info, key, value, what):
    """A write from the web page reaches Live, and only that parameter moves."""
    m = meta_of(info, key.split(":", 1)[1])
    before = live_params(t, path)
    post("/api/devices/%d/param" % n, {"key": key, "value": value})
    time.sleep(0.8)
    after = live_params(t, path)
    moved = changed(before, after)
    name = m.get("name") if m else key
    ok = check(moved == [name] or (name in moved and len(moved) <= 2),
               "%s: the web page sets %s = %s, Live's %r follows (moved: %s)" % (what, key, value, name, moved))
    if ok:
        p = by_name(after)[name]
        note("Live shows %s = %s" % (name, p.get("display")))
    return after


def live_to_web(t, path, n, key, live_name, norm, what):
    """A change in Live (Push's encoder, automation) reaches the web page's values."""
    params = live_params(t, path)
    p = by_name(params).get(live_name)
    if not check(p, "%s: Live has %r" % (what, live_name)):
        return
    old = get("/api/devices/%d/param?key=%s" % (n, key))["value"]
    live("device", "set_param", track=t, path=path, index=p["i"], norm=norm)
    time.sleep(0.6)
    vals = get("/api/devices/%d/component/synth/values" % n)["values"]
    new = vals.get(key)
    check(new is not None and new != old, "%s: Live sets %r, the web page's values follow (%s -> %s)" % (what, live_name, old, new))


def plays(t, n):
    live("session", "delete_clip", track=t, scene=0)
    live("session", "create_clip", track=t, scene=0, length=4.0)
    live("clip", "add_notes", track=t, scene=0, notes=[
        {"pitch": 48 + 7 * (i % 3), "start": i * 0.5, "duration": 0.4, "velocity": 110} for i in range(8)])
    live("clip", "set", track=t, scene=0, looping=True)
    live("clip", "fire", track=t, scene=0)
    peak = 0.0
    for _ in range(25):
        time.sleep(0.12)
        peak = max(peak, max(live("meters", "get")["data"]["tracks"][t]))
    live("clip", "stop", track=t, scene=0)
    return peak


def main():
    r = live("track", "ensure", kind="midi", name=TRACK_NAME)
    if not check(r.get("ok"), "a MIDI track %r (%s)" % (TRACK_NAME, "made" if r.get("data", {}).get("created") else "found")):
        note(json.dumps(r))
        return
    t = r["data"]["track"]

    # ---- OB-Xd: a module with its own web page ----------------------------------
    path, n = load(t, "OB-Xd", "obxd")
    if n < 0:
        return
    info = get("/api/devices/%d/component/synth" % n)["info"]
    check(info.get("module") == "obxd" and info.get("web_ui"), "OB-Xd offers its own page (web_ui %s)" % info.get("web_ui"))
    page = get("/modules/obxd/web_ui.html")
    check(isinstance(page, bytes) and b"schwungRemote" in page, "its page is served (%d bytes)" % len(page))
    check(len(info.get("chain_params") or []) >= 40, "and its parameters (%d)" % len(info.get("chain_params") or []))
    peak = plays(t, n)
    check(peak > 0.01, "OB-Xd sounds from a clip (meter %.3f)" % peak)

    cut = meta_of(info, "cutoff")
    lo, hi = cut.get("min", 0), cut.get("max", 1)
    params = web_to_live(t, path, n, info, "synth:cutoff", str(int(lo + (hi - lo) * 0.23)), "OB-Xd")
    live_to_web(t, path, n, "synth:resonance", (meta_of(info, "resonance") or {}).get("name", "Resonance"), 0.71, "OB-Xd")

    # a preset moves many parameters: Live hears of all of them, not only the preset key
    pm = meta_of(info, "preset")
    if check(pm, "OB-Xd has presets"):
        before = live_params(t, path)
        cur = int(float(get("/api/devices/%d/param?key=synth:preset" % n)["value"] or 0))
        post("/api/devices/%d/param" % n, {"key": "synth:preset", "value": str(cur + 3)})
        time.sleep(1.2)
        after = live_params(t, path)
        moved = changed(before, after)
        check(len(moved) >= 5, "a preset chosen on the web page moves %d of Live's parameters" % len(moved))
        # and Live and the chain agree on them
        vals = get("/api/devices/%d/component/synth/values" % n)["values"]
        bad = []
        for p in info.get("chain_params") or []:
            lp = by_name(after).get(p.get("name"))
            if not lp or p.get("type") not in ("int", "float") or p["key"] not in ("cutoff", "resonance", "attack", "release", "osc2_detune", "volume"):
                continue
            v = vals.get("synth:" + p["key"])
            if v is None:
                continue
            want = (float(v) - p.get("min", 0)) / ((p.get("max", 1) - p.get("min", 0)) or 1)
            if abs(want - lp["v"]) > 0.02:
                bad.append("%s chain %s Live %.3f" % (p["key"], v, lp["v"]))
        check(not bad, "Live and the chain agree after the preset%s" % ("" if not bad else ": " + "; ".join(bad)))

    # ---- Dexed and Hera: the generic page --------------------------------------------
    for name, module, key in (("Dexed", "dexed", None), ("Hera", "hera", None)):
        path2, n2 = load(t, name, module)
        if n2 < 0:
            continue
        info2 = get("/api/devices/%d/component/synth" % n2)["info"]
        cp = info2.get("chain_params") or []
        check(not info2.get("web_ui") and len(cp) >= 8, "%s: the generic page, %d parameters" % (name, len(cp)))
        vals = get("/api/devices/%d/component/synth/values" % n2)["values"]
        check(len(vals) >= len(cp) * 0.8, "%s: values for the page (%d)" % (name, len(vals)))
        # the first int or float parameter Live has, set from the page
        lp = by_name(live_params(t, path2))
        target = next((p for p in cp if p.get("type") in ("int", "float") and p.get("name") in lp and p["key"] != "preset"), None)
        if check(target, "%s: a parameter to set" % name):
            lo, hi = target.get("min", 0), target.get("max", 1)
            v = lo + (hi - lo) * 0.37
            web_to_live(t, path2, n2, info2, "synth:" + target["key"], str(int(round(v))) if target["type"] == "int" else "%.4f" % v, name)
        peak = plays(t, n2)
        check(peak > 0.01, "%s sounds (meter %.3f)" % (name, peak))

    # leave OB-Xd there, selected, for a look
    load(t, "OB-Xd", "obxd")


main()
print("\n%d/%d passed" % (sum(results), len(results)))
sys.exit(0 if results and all(results) else 1)
