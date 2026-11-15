#!/usr/bin/env python3
"""On-device test of the Pung view (DESIGN-v2 step 1). Runs ON the Push.

Drives the Pung view through its test door (POST /api/surface/press: one raw
Push message, as the Push port would deliver it) and checks every effect in
Live itself, through the PushHack Remote Script. Needs: the Remote Script
active, a Pung device selected in Live. Hands the surface back to Live at
the end, whatever happens.

    python3 pung_view_test.py [pung-port]
"""
import json
import socket
import sys
import time
import urllib.request

PUNG = "http://127.0.0.1:%s" % (sys.argv[1] if len(sys.argv) > 1 else "7720")
PM = "http://127.0.0.1:7701"
results = []


def http(url, body=None, headers=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                 headers=dict({"Content-Type": "application/json"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def live(ns, cmd, **args):
    s = socket.create_connection(("127.0.0.1", 7704), timeout=8)
    f = s.makefile("rw")
    f.write(json.dumps(dict(id=1, ns=ns, cmd=cmd, **args)) + "\n")
    f.flush()
    r = json.loads(f.readline())
    s.close()
    return r


def press(*msg):
    return http(PUNG + "/api/surface/press", {"msg": list(msg)})


def state():
    return http(PUNG + "/api/surface/state")


def check(ok, what):
    results.append((bool(ok), what))
    print(("PASS " if ok else "FAIL ") + what, flush=True)
    return ok


def live_param(track, path, name):
    r = live("device", "params", track=track, path=path)
    for p in r.get("data", {}).get("params", []):
        if p["name"] == name:
            return p
    return None


def turn(enc, clicks):
    v = 1 if clicks > 0 else 127
    for _ in range(abs(clicks)):
        press(0xB0, 71 + enc, v)
        time.sleep(0.03)


def main():
    http(PM + "/api/surface/open", {"id": "pung"})
    for _ in range(40):
        st = state()
        if st.get("focused") and st.get("live_params"):
            break
        time.sleep(0.25)
    st = state()
    check(st.get("focused"), "the Pung view owns the surface")
    check(st.get("live"), "the Remote Script is connected")
    path = st.get("live_path") or []
    pos = st.get("position") or {}
    check(path, "the selected Pung device was found in Live (path %s)" % path)
    check(pos.get("Module"), "it is a Pung device: %s" % pos.get("Name"))
    lp = st.get("live_params") or {}
    check(len(lp) >= 8, "%d of its parameters map to Live's" % len(lp))
    if not path:
        return
    track = live("device", "selected")["data"]["track"]

    # an encoder writes through Live
    keys = st.get("keys") or []
    if "cutoff" in keys:
        enc = keys.index("cutoff")
        before = live_param(track, path, "Cutoff")
        turn(enc, -12)
        time.sleep(0.6)
        after = live_param(track, path, "Cutoff")
        check(before and after and after["v"] < before["v"],
              "encoder %d turned Cutoff down in Live: %s -> %s" % (enc + 1, before and before["display"], after and after["display"]))
        turn(enc, 12)
        time.sleep(0.6)
        back = live_param(track, path, "Cutoff")
        check(back and before and abs(back["v"] - before["v"]) < 0.02,
              "and back up: %s" % (back and back["display"]))

    # an enum steps one option per step
    if "engine" in keys:
        enc = keys.index("engine")
        before = live_param(track, path, "Algorithm")
        turn(enc, 1)
        time.sleep(0.6)
        after = live_param(track, path, "Algorithm")
        check(before and after and after["display"] != before["display"],
              "encoder %d stepped Algorithm in Live: %s -> %s" % (enc + 1, before and before["display"], after and after["display"]))
        time.sleep(0.15)
        turn(enc, -1)
        time.sleep(0.6)

    # MPE pad data (CC 74 on another channel) must not move encoder 4
    before = live_param(track, path, "Cutoff")
    for v in (10, 60, 120):
        press(0xB2, 74, v)
    time.sleep(0.5)
    after = live_param(track, path, "Cutoff")
    check(before and after and abs(after["v"] - before["v"]) < 1e-6, "MPE slide (CC 74, channel 3) leaves Cutoff alone")

    # values shown are Live's values
    st = state()
    check(st.get("live_params"), "values are present after the writes")

    # Page < > step the banks (Push's own buttons for that)
    banks = st.get("banks") or []
    if len(banks) > 1:
        press(0xB0, 63, 127)
        press(0xB0, 63, 0)
        time.sleep(0.3)
        st2 = state()
        check(st2.get("bank") == 1 and st2.get("keys") != keys, "Page > opens bank %s" % banks[1])
        press(0xB0, 62, 127)
        press(0xB0, 62, 0)
        time.sleep(0.3)
        check(state().get("bank") == 0, "Page < goes back to bank %s" % banks[0])

    # the upper row is the track's devices, as on Push; the selected device's
    # button opens its bank list, and a bank button there picks one
    st = state()
    sel = st.get("device_row_selected", -1)
    check(st.get("device_row") and sel >= 0, "the upper row shows the track's devices %s, selected %d" % (st.get("device_row"), sel))
    if sel >= 0 and len(banks) > 1:
        press(0xB0, 102 + sel, 127)
        press(0xB0, 102 + sel, 0)
        time.sleep(0.3)
        check(state().get("bank_list"), "the selected device's button opens its banks")
        press(0xB0, 103, 127)
        press(0xB0, 103, 0)
        time.sleep(0.3)
        st2 = state()
        check(st2.get("bank") == 1 and not st2.get("bank_list"), "bank button 2 picks %s, and the devices are back" % banks[1])
        press(0xB0, 62, 127)
        press(0xB0, 62, 0)
    # (pads: Live plays them now, tested through Push3 in pads_test.py)

try:
    main()
finally:
    http(PM + "/api/surface/leave", {"app": "pung", "to": "live"}, {"X-Push-Hack-App": "pung"})
    failed = [w for ok, w in results if not ok]
    print("\n%d passed, %d failed" % (len(results) - len(failed), len(failed)))
    sys.exit(1 if failed else 0)
