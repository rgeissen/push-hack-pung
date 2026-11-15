#!/usr/bin/env python3
"""On-device test of the Pung devices in Live (DESIGN-v2). Runs ON the Push.

What it proves, each step checked in Live (PushHack Remote Script, :7704) and
in the Pung service (/api/devices: what every device rendered, heard and
played):

  1. Live's last plugin scan lists every class in vst3-classes.json, and as
     what (instr / audiofx / midifx).
  2. Each browser entry loads from the User Library as the rack it should be:
     an Instrument Rack, a MIDI Effect Rack, an Audio Effect Rack.
  3. A clip played into Braids sounds (Live's meter and the service).
  4. Braids' "MIDI FX" selector runs Chord in front of its synth.
  5. Chord Track on a second MIDI track plays triads, and Braids'
     track hears them through Live's "MIDI From" routing.
     (Live 13.0b25 files a MIDI-in/MIDI-out plugin as an audio effect, so a
     Pung MIDI effect cannot sit in Live's MIDI-effect position.)
  6. Freeverb after the instrument receives audio and returns it.

Works on ONE MIDI track (default: the first MIDI track with no devices, or
one holding only Pung devices). Leaves the chain built and the clip
stopped, so the result can be heard by hand.

    python3 vst3_devices_test.py [track-index]
"""
import json
import os
import re
import socket
import sys
import time
import urllib.request

PUNG = "http://127.0.0.1:7720"
CLASSES = "/data/.vst3/Pung.vst3/Contents/Resources/classes.json"
SCANLOG = "/data/.config/Ableton/Live 13.0b25/PluginScanner.txt"
results = []


def live(ns, cmd, **args):
    s = socket.create_connection(("127.0.0.1", 7704), timeout=30)
    f = s.makefile("rw")
    f.write(json.dumps(dict(id=1, ns=ns, cmd=cmd, **args)) + "\n")
    f.flush()
    r = json.loads(f.readline())
    s.close()
    return r


def devices_svc():
    with urllib.request.urlopen(PUNG + "/api/devices", timeout=5) as r:
        return json.loads(r.read())["devices"]


def svc(module, kind=None):
    """The newest service-side device for a module (Live may have made several)."""
    found = [d for d in devices_svc() if d["module"] == module and (kind is None or d["kind"] == kind)]
    return found[-1] if found else None


def check(ok, what):
    results.append((bool(ok), what))
    print(("PASS " if ok else "FAIL ") + what, flush=True)
    return ok


def note(what):
    print("     " + what, flush=True)


def track_devices(t):
    return live("device", "list", track=t).get("data", {}).get("devices", [])


def rack_inner(t, i):
    return live("device", "list", track=t, path=[i], chain=0).get("data", {}).get("devices", [])


def scan_types():
    """name -> device-class-id kind, from the last scan of Pung.vst3."""
    try:
        text = open(SCANLOG, errors="replace").read()
    except OSError as e:
        return None, str(e)
    blocks = text.split('check plugin at path: "/data/.vst3/Pung.vst3"')
    if len(blocks) < 2:
        return {}, "Pung.vst3 never scanned"
    last = blocks[-1].split("check plugin at path:")[0]
    out = {}
    for m in re.finditer(r"found: (.+?)\n(.*?)(?=found: |\Z)", last, re.S):
        k = re.search(r"device-class-id: device:vst3:(\w+):", m.group(2))
        out[m.group(1).strip()] = k.group(1) if k else "?"
    return out, None


NAMES = set()  # the class names (main fills it)


def pung_only(devs):
    """Only Pung devices: by class name, or a rack from an older build
    ("Braids")."""
    return all(d["name"] in NAMES or d["name"].startswith("Pung ") for d in devs)


def pick_track():
    if len(sys.argv) > 1:
        return int(sys.argv[1])
    tracks = live("track", "list")["data"]["tracks"]
    for t in tracks:
        if t["kind"] != "midi":
            continue
        devs = track_devices(t["ref"])
        if not devs or pung_only(devs):
            return t["ref"]
    return None


def load(t, name, want_class):
    live("track", "select", track=t)
    t0 = time.time()
    r = live("browser", "load", name=name)
    took = time.time() - t0
    if not check(r.get("ok"), "browser loads %s (%.1f s)" % (name, took)):
        note(json.dumps(r))
        return None
    time.sleep(1.5)
    for d in track_devices(t):
        if d["name"] == name:
            inner = rack_inner(t, d["i"])
            check(d["class"] == want_class, "%s is a %s (got %s)" % (name, want_class, d["class"]))
            check(any(x["class"] == "PluginDevice" and x["name"] == name for x in inner),
                  "%s holds the plugin (%s)" % (name, [x["name"] + "/" + x["class"] for x in inner]))
            names = [x["name"] for x in live("device", "params", track=t, path=[d["i"], 0, 0])
                     .get("data", {}).get("params", [])]
            # placeholders (a no-break space) fill a bank to a whole Push page:
            # one name, many parameters, by design
            dup = sorted({n for n in names if names.count(n) > 1 and n.strip()})
            check(names and not dup, "%s lists each parameter once (%d%s)" % (
                name, len(names), "" if not dup else ", twice: %s" % dup))
            return d["i"]
    check(False, "%s is on the track (%s)" % (name, [d["name"] for d in track_devices(t)]))
    return None


def wait_notes(module, kind=None, secs=4.0):
    a = svc(module, kind)
    time.sleep(secs)
    b = svc(module, kind)
    if not a or not b or a["id"] != b["id"]:
        return b, 0, 0
    return b, b["notes_in"] - a["notes_in"], b["notes_out"] - a["notes_out"]


def main():
    classes = json.load(open(CLASSES))["classes"]
    names = {c["name"]: c["kind"] for c in classes}
    NAMES.update(names)

    # 1. the scan
    types, err = scan_types()
    if types is None or err:
        check(False, "Live scanned Pung.vst3 (%s)" % err)
    else:
        missing = [n for n in names if n not in types]
        check(not missing, "Live's scan lists all %d classes%s" % (
            len(names), "" if not missing else " (missing: %s)" % ", ".join(missing)))
        for n in sorted(names):
            if n in types:
                note("%-30s %-10s scanned as %s" % (n, names[n], types[n]))

    t = pick_track()
    if t is None:
        check(False, "a MIDI track to test on (empty, or only Pung devices)")
        return
    note("testing on track %d" % t)
    for d in reversed(track_devices(t)):  # start clean: only Pung devices are here
        live("device", "delete", track=t, device=d["i"])

    # 2 + 3. instrument, clip, sound
    if load(t, "Braids", "InstrumentGroupDevice") is None:
        return
    live("session", "delete_clip", track=t, scene=0)
    live("session", "create_clip", track=t, scene=0, length=4.0)
    live("clip", "add_notes", track=t, scene=0, notes=[
        {"pitch": p, "start": i * 0.5, "duration": 0.4, "velocity": 110}
        for i, p in enumerate([48, 52, 55, 60, 55, 52, 48, 43])])
    live("clip", "set", track=t, scene=0, looping=True)
    live("clip", "fire", track=t, scene=0)
    time.sleep(2.5)
    peak = 0.0
    for _ in range(10):
        m = live("meters", "get")["data"]["tracks"][t]
        peak = max(peak, max(m))
        time.sleep(0.1)
    b = svc("braids", "instrument")
    check(peak > 0.01, "the clip sounds through Braids (Live meter %.3f)" % peak)
    check(b and b["out_peak"] > 0.001 and b["notes_in"] > 0,
          "the service renders Braids (%s)" % (b and {k: b[k] for k in ("blocks", "notes_in", "out_peak")}))

    # 4. a MIDI effect inside the instrument: Braids' "MIDI FX" selector
    bi = next((d["i"] for d in track_devices(t) if d["name"] == "Braids"), None)
    path = [bi, 0, 0]
    sel = None
    for p in live("device", "params", track=t, path=path).get("data", {}).get("params", []):
        if p["name"] == "MIDI FX":
            sel = p
    opts = next((q.get("options", []) for c in classes if c.get("ref") == "braids" and c["kind"] == "instrument"
                 for q in c["params"] if q.get("role") == "midifx"), [])
    if check(sel and "Chord" in opts, "Braids offers a MIDI FX selector (%s)" % opts):
        def pick(name):
            r = live("device", "set_param", track=t, path=path, index=sel["i"], norm=opts.index(name) / (len(opts) - 1.0))
            if not r.get("ok"):
                note("set_param %s -> %s; devices: %s" % (name, json.dumps(r)[:300],
                     [(d["id"], d["module"], d["midi_fx"]) for d in devices_svc()]))
            time.sleep(2.5)
            p = next(x for x in live("device", "params", track=t, path=path)["data"]["params"] if x["name"] == "MIDI FX")
            return "%s=%s" % (p["v"], p["display"]), svc("braids", "instrument")
        shown, b = pick("Chord")
        check(b and b["midi_fx"] == "chord", "Braids runs Chord in front of its synth (shows %r, midi_fx=%r)" % (
            shown, b and b["midi_fx"]))
        peak = max(max(live("meters", "get")["data"]["tracks"][t]) for _ in range(5))
        check(peak > 0.01, "Braids + Chord sounds (meter %.3f)" % peak)
        shown, b = pick("None")
        check(b and b["midi_fx"] == "", "MIDI FX back to None (shows %r, midi_fx=%r)" % (shown, b and b["midi_fx"]))

    # 5. a MIDI effect on its own track, heard through Live's "MIDI From"
    tracks = live("track", "list")["data"]["tracks"]
    u = next((x["ref"] for x in tracks if x["kind"] == "midi" and x["ref"] != t and
              pung_only(track_devices(x["ref"]))), None)
    if check(u is not None, "a second MIDI track for the Chord Track (%s)" % u):
        for d in reversed(track_devices(u)):
            live("device", "delete", track=u, device=d["i"])
        if load(u, "Chord Track", "InstrumentGroupDevice") is not None:
            live("clip", "stop", track=t, scene=0)
            live("session", "delete_clip", track=u, scene=0)
            live("session", "create_clip", track=u, scene=0, length=4.0)
            live("clip", "add_notes", track=u, scene=0, notes=[
                {"pitch": p, "start": i * 0.5, "duration": 0.4, "velocity": 110}
                for i, p in enumerate([48, 50, 52, 53, 55, 57, 59, 60])])
            before = live("track", "routing", track=t)["data"]["input"]
            if "Chord Track" in before["type"]:  # a run that died left our own route behind
                before = {"type": "All Ins", "channel": "All Channels"}
            before_mon = live("track", "get", track=t)["data"].get("monitoring", 1)
            # Live renames a track after the instrument it gets: read it now
            uname = next(x["name"] for x in live("track", "list")["data"]["tracks"] if x["ref"] == u)
            # Live names a plugin's MIDI output "<rack> | <device> | <plugin>"
            r = live("track", "set_routing", track=t, input_type=uname,
                     input_channel=["Chord Track | Chord Track | Chord Track", "Chord Track"])
            ok = check(r.get("ok"), "Braids' track takes MIDI From %s / Chord Track" % uname)
            if not ok:
                note(json.dumps(r)[:600])
                note(json.dumps(live("track", "routing", track=t))[:900])
            else:
                live("track", "set", track=t, monitoring=0)
                live("clip", "fire", track=u, scene=0)
                b0 = svc("braids", "instrument")
                c, nin, nout = wait_notes("chord", "midi", 4.0)
                b1 = svc("braids", "instrument")
                heard = b1["notes_in"] - b0["notes_in"] if b0 and b1 and b0["id"] == b1["id"] else -1
                check(nin > 0 and nout == 3 * nin, "Chord Track plays a triad per note (%d in, %d out)" % (nin, nout))
                check(heard > 0 and abs(heard - nout) <= 3,
                      "Braids hears what the Chord Track played (%d heard, %d played)" % (heard, nout))
                peak = max(max(live("meters", "get")["data"]["tracks"][t]) for _ in range(5))
                check(peak > 0.01, "Braids' track sounds from the Chord Track (meter %.3f)" % peak)
                live("clip", "stop", track=u, scene=0)
            # put the track back as it was, and say so if that fails
            r = live("track", "set_routing", track=t, input_type=before["type"], input_channel=before["channel"])
            check(r.get("ok"), "Braids' track input restored (%s / %s)" % (before["type"], before["channel"]))
            live("track", "set", track=t, monitoring=before_mon)
            live("clip", "fire", track=t, scene=0)
            time.sleep(1.5)

    # 6. an audio effect after the instrument
    i = load(t, "Freeverb", "AudioEffectGroupDevice")
    if i is not None:
        time.sleep(2)
        f = svc("freeverb", "effect")
        check(f and f["in_peak"] > 0.001 and f["out_peak"] > 0.001,
              "Freeverb gets the instrument's audio and returns it (%s)" % (
                  f and {k: round(f[k], 3) for k in ("in_peak", "out_peak")}))
        peak = max(max(live("meters", "get")["data"]["tracks"][t]) for _ in range(5))
        check(peak > 0.01, "the track still sounds with Freeverb (meter %.3f)" % peak)

    live("clip", "stop", track=t, scene=0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # a crash is a failure, never a silent stop
        import traceback
        traceback.print_exc()
        check(False, "the test ran to the end (%s)" % e)
    finally:
        bad = [w for ok, w in results if not ok]
        print("\n%d/%d passed" % (len(results) - len(bad), len(results)))
        sys.exit(1 if bad else 0)
