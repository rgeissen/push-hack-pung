#!/usr/bin/env python3
# governor-bench.py [seconds playing, default 600]: the governor's benchmark, run ON the Push
# (scripts/governor.sh copies it there and runs it). docs/GOVERNOR.md says what it must show.
#
# It builds the reference Set in the Set that is open, which must hold no Pung device (open a
# new Set first: nothing is saved, and the devices stay in it for you to look at or throw away):
# two emulators (OsTIrus, Vavra) and four instruments (OB-Xd, Plaits, Dexed, Surge XT), a MIDI
# track each. Then, pass or fail:
#   silent   nobody plays: the emulators rest, and all of Pung costs next to nothing
#   playing  a chord held on every device for the time given: no late block, no underrun,
#            and the Push keeps its free share
#   waking   a note into each rested emulator sounds, with no underrun
#   view     Pung's view open: the frames it draws at rest and while the sound moves
import json, socket, sys, time, struct, urllib.request, urllib.parse

B, PM = "http://127.0.0.1:7720", "http://127.0.0.1:7701"
PLAY = int(sys.argv[1]) if len(sys.argv) > 1 else 600
RACKS = [("ostirus", "OsTIrus.adg"), ("vavra", "Vavra.adg"), ("obxd", "OB-Xd.adg"), ("plaits", "Plaits.adg"),
         ("dexed", "Dexed.adg"), ("surge", "Surge XT.adg")]
EMUS = ["ostirus", "vavra"]
CHORD = [48, 55, 60, 64, 67, 72]
# what passes (percent of one core)
SILENT_MAX = 12.0      # all of Pung with the six devices silent and the view closed
FREE_MIN = 50.0        # the Push's free share while everything plays (govFreeShare)
REST_FPS_MAX = 3.0     # the view at rest
MOVE_FPS_MAX = 32.0    # the view while the sound moves (30 a second)

def get(p, raw=False, base=B):
    b = urllib.request.urlopen(base + p, timeout=PLAY + 300).read()
    return b if raw else json.loads(b)
def post(p, o, base=B):
    return urllib.request.urlopen(urllib.request.Request(base + p, json.dumps(o).encode(), {"Content-Type": "application/json"}), timeout=60).read()
def rs(m):
    s = socket.create_connection(("127.0.0.1", 7704), timeout=60); m["id"] = "b"
    s.sendall((json.dumps(m) + "\n").encode()); buf = b""
    while not buf.endswith(b"\n"):
        c = s.recv(65536)
        if not c: break
        buf += c
    return json.loads(buf)
def devices(): return get("/api/pung-devices")["devices"]
def nof(mod): return next((d["n"] for d in devices() if d["module"] == mod), None)
def par(n, key): return str(get("/api/devices/%d/param?key=%s" % (n, urllib.parse.quote("synth:" + key))).get("value", ""))
def dbg(n): return dict(kv.split("=") for kv in par(n, "debug_info").split() if "=" in kv)
def late(): return {d.get("n", i): d.get("late") or 0 for i, d in enumerate(get("/api/devices").get("devices", []))}
def underruns(): return {m: int(dbg(nof(m)).get("underruns", 0)) for m in EMUS}
def notes(vel, mods=None):
    for d in devices():
        if mods is None or d["module"] in mods:
            for n in CHORD: post("/api/devices/%d/note" % d["n"], {"note": n, "velocity": vel})
def frames(): return get("/api/surface/state")["frames"]
def view(open_):
    try:
        if open_: post("/api/surface/open", {"id": "pung"}, PM)
        else: post("/api/surface/leave", {"app": "pung", "to": "live"}, PM)
    except Exception: pass  # (409: it was not open)
    time.sleep(4)

results = []
def check(ok, what):
    results.append((ok, what)); print("  %s %s" % ("PASS" if ok else "FAIL", what), flush=True)

# ---- the Set
have = [d["module"] for d in devices()]
if sorted(have) != sorted(m for m, _ in RACKS):
    if have:
        sys.exit("the open Set holds Pung devices (%s): open a new Set first" % ", ".join(have))
    print("building the reference Set ...", flush=True)
    tracks = [t for t in rs({"ns": "track", "cmd": "list"})["data"]["tracks"] if t["kind"] == "midi"]
    while len(tracks) < len(RACKS):
        rs({"ns": "track", "cmd": "create", "kind": "midi"})
        tracks = [t for t in rs({"ns": "track", "cmd": "list"})["data"]["tracks"] if t["kind"] == "midi"]
    for (mod, rack), t in zip(RACKS, tracks):
        rs({"ns": "track", "cmd": "select", "track": t["ref"]})
        r = rs({"ns": "browser", "cmd": "load", "name": rack})
        if not r.get("ok"): sys.exit("could not load %s: %s" % (rack, r))
        for i in range(90):  # one at a time: an emulator boots before the next is asked for
            time.sleep(2)
            if nof(mod) is not None and (mod not in EMUS or par(nof(mod), "resting") in ("0", "1")) and (mod not in EMUS or dbg(nof(mod)).get("fill")): break
        else: sys.exit("%s did not start (see Pung's log: it may be waiting for room)" % mod)
        time.sleep(6 if mod not in EMUS else 30)
view(False)
gov = get("/api/governor?seconds=1"); rest_ms = gov.get("rest_after_ms", 0)
print("reference Set up: %s; modules rest after %d ms" % (", ".join(d["module"] for d in devices()), rest_ms), flush=True)
if rest_ms <= 0: sys.exit("rest is off (POST /api/governor/rest): nothing to measure")

# ---- silent
print("silent:", flush=True)
time.sleep(rest_ms / 1000 + 25)  # (a sound's tail, then the rest time)
g = get("/api/governor?seconds=30")
for m in EMUS: check(par(nof(m), "resting") == "1", "%s rests" % m)
check(g["pung_total"] <= SILENT_MAX, "all of Pung, six silent devices: %.1f percent of a core (at most %.0f)" % (g["pung_total"], SILENT_MAX))
check(sum(e["cpu"] for e in g["engines"]) < 1.0, "the emulators' processes: %.1f" % sum(e["cpu"] for e in g["engines"]))
silent = g

# ---- waking
print("waking:", flush=True)
u0 = underruns()
for m in EMUS:
    n = nof(m)
    get("/api/devices/%d/capture.wav?arm=3" % n); time.sleep(0.3)
    post("/api/devices/%d/note" % n, {"note": 60, "velocity": 110}); time.sleep(0.6)
    post("/api/devices/%d/note" % n, {"note": 60, "velocity": 0}); time.sleep(0.4)
    w = get("/api/devices/%d/capture.wav" % n, raw=True)[44:]
    f = struct.unpack("<%df" % (len(w) // 4), w)
    check(max(abs(x) for x in f) > 0.003, "a note into the rested %s sounds" % m)
time.sleep(2)
check(underruns() == u0, "no underrun waking them (%s)" % {m: underruns()[m] - u0[m] for m in EMUS})

# ---- playing
print("playing %d s:" % PLAY, flush=True)
l0, u0 = late(), underruns()
notes(100); time.sleep(3)
g = get("/api/governor?seconds=%d" % min(PLAY, 120))  # (the longest window the API gives)
worst_free = g["system"]["free"]
left = PLAY - min(PLAY, 120)
while left > 0:
    w = min(left, 120); gg = get("/api/governor?seconds=%d" % w); left -= w
    worst_free = min(worst_free, gg["system"]["free"])
l1, u1 = late(), underruns()
notes(0)
check(all(l1.get(k, 0) == v for k, v in l0.items()), "no late block on any device (%s)" % {k: l1.get(k, 0) - v for k, v in l0.items()})
check(u1 == u0, "no underrun in an emulator (%s)" % {m: u1[m] - u0[m] for m in EMUS})
check(worst_free >= FREE_MIN, "the Push keeps %.0f percent of a core free while all six play (at least %.0f)" % (worst_free, FREE_MIN))
check(all(not d["silent"] for d in g["devices"]), "every device sounded")
playing = g

# ---- the view
print("view:", flush=True)
time.sleep(rest_ms / 1000 + 25)
view(True); time.sleep(4)
f0 = frames(); gi = get("/api/governor?seconds=20"); fps_rest = (frames() - f0) / 20.0
notes(100, ["obxd", "surge"]); time.sleep(2)
f0 = frames(); gp = get("/api/governor?seconds=20"); fps_move = (frames() - f0) / 20.0
notes(0, ["obxd", "surge"]); view(False)
check(fps_rest <= REST_FPS_MAX, "the view at rest draws %.1f frames a second (at most %.0f)" % (fps_rest, REST_FPS_MAX))
check(fps_move <= MOVE_FPS_MAX, "the view while the sound moves draws %.1f frames a second (at most %.0f)" % (fps_move, MOVE_FPS_MAX))

row = lambda name, g: "  %-26s Pung %6.1f  (devices %5.1f, Go %5.1f, emulators %6.1f)  Live %5.1f  Push busy %6.1f free %6.1f" % (
    name, g["pung_total"], g["pung"]["device_threads"], g["pung"]["go"], sum(e["cpu"] for e in g["engines"]), g.get("live", 0), g["system"]["busy"], g["system"]["free"])
print("percent of one core:"); print(row("silent, view closed", silent)); print(row("playing, view closed", playing))
print(row("view open, at rest", gi)); print(row("view open, two playing", gp))
bad = [w for ok, w in results if not ok]
print("== %s" % ("ALL PASS (%d checks)" % len(results) if not bad else "%d of %d FAILED" % (len(bad), len(results))))
sys.exit(1 if bad else 0)
