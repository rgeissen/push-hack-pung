# push-playtest.py <module id> <rack file> [keep] [after=<module id>]: run ON the Push (python3 is there):
#
#   scp scripts/push-playtest.py root@<push>:/tmp/ && ssh root@<push> python3 /tmp/push-playtest.py vial Vial.adg
#
# Plays a module once as a device in Live (CLAUDE.md, Release: every new module is, before a release): loads
# its rack through the Remote Script onto the Set's second track, which must be an EMPTY MIDI track, plays a
# chord through Pung, reads Live's own meter of that track and the module's live_mod, and takes the device off
# again (the track is empty and named as before). One module at a time: an emulator is gone before the next.
# "keep" leaves it on the track (to put an effect behind it); "after=<id>" plays the instrument in front.
import json, socket, sys, time, urllib.request, urllib.parse
B = "http://127.0.0.1:7720"
def get(p): return json.loads(urllib.request.urlopen(B + p, timeout=20).read())
def post(p, o): return urllib.request.urlopen(urllib.request.Request(B + p, json.dumps(o).encode(), {"Content-Type": "application/json"}), timeout=20).read()
def rs(m):
    s = socket.create_connection(("127.0.0.1", 7704), timeout=60); m["id"] = "p"
    s.sendall((json.dumps(m) + "\n").encode()); buf = b""
    while not buf.endswith(b"\n"):
        c = s.recv(65536)
        if not c: break
        buf += c
    s.close(); return json.loads(buf)
mod, rack = sys.argv[1], sys.argv[2]
keep = "keep" in sys.argv[3:]
tracks = rs({"ns": "track", "cmd": "list"})["data"]["tracks"]
# the second track, the MIDI track that was empty (Live names it after what is on it: 2-MIDI, 2-Vial)
t = [x for x in tracks if x["name"].startswith("2-") and x["kind"] == "midi"]
if not t: sys.exit("no second MIDI track: %s" % [x["name"] for x in tracks])
ref = t[0]["ref"]
devs = rs({"ns": "device", "cmd": "list", "track": ref})["data"]["devices"]
print("the test track (%s) before:" % t[0]["name"], [d["name"] for d in devs])
before = {p["n"] for p in get("/api/stacks")["playing"]}
n, i = None, -1
have = [p for p in get("/api/stacks")["playing"] if p["module"] == mod and devs]
if have:  # it is on the track already (a run before this one)
    n = have[0]["n"]
else:
    rs({"ns": "track", "cmd": "select", "track": ref})
    r = rs({"ns": "browser", "cmd": "load", "name": rack})
    if not r.get("ok"): sys.exit("could not load %s: %s" % (rack, r))
    for i in range(60):
        time.sleep(1)
        new = [p for p in get("/api/stacks")["playing"] if p["n"] not in before and p["module"] == mod]
        if new: n = new[0]["n"]; break
if n is None: sys.exit("%s did not become a Pung device (see Pung's log)" % mod)
print("%s is Pung device %d after %d s" % (mod, n, i + 1))
def meter():
    m = rs({"ns": "meters", "cmd": "get"})["data"]["tracks"]
    return m[ref] if isinstance(ref, int) and ref < len(m) else [0, 0]
# the instrument that sounds: this one, or (an effect) the one in front of it
src = n
if "after" in " ".join(sys.argv[3:]):
    srcmod = [a.split("=")[1] for a in sys.argv[3:] if a.startswith("after=")][0]
    src = [p["n"] for p in get("/api/stacks")["playing"] if p["module"] == srcmod][0]
peak, lm, t0 = 0.0, set(), time.time()
while time.time() - t0 < 75:
    for note in (57, 60, 64): post("/api/devices/%d/note" % src, {"note": note, "velocity": 100})
    for k in range(8):
        time.sleep(0.25)
        mt = meter()
        lv = max(mt or [0])
        peak = max(peak, lv)
        try:
            v = get("/api/devices/%d/param?key=%s" % (n, urllib.parse.quote("synth:live_mod"))).get("value", "")
            if v and v != "{}": lm.add(v[:70])
        except Exception: pass
    for note in (57, 60, 64): post("/api/devices/%d/note" % src, {"note": note, "velocity": 0})
    if peak > 0.02: break
    time.sleep(2)
late = [d.get("late") for d in get("/api/devices").get("devices", [])]
print("heard after %.0f s: Live's meter peak %.2f | live_mod readings: %s | late blocks: %s" % (time.time() - t0, peak, sorted(lm)[:3] or "none", late))
if not keep:
    time.sleep(1)
    devs = rs({"ns": "device", "cmd": "list", "track": ref})["data"]["devices"]
    for i in reversed(range(len(devs))): rs({"ns": "device", "cmd": "delete", "track": ref, "device": i})
    time.sleep(3)
    print("the test track after:", [d["name"] for d in rs({"ns": "device", "cmd": "list", "track": ref})["data"]["devices"]], "| Pung devices:", [p["module"] for p in get("/api/stacks")["playing"]])
