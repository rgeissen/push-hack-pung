#!/usr/bin/env python3
# governor-rest.py <module> [trials] [long rest s]: one emulator's rest, in depth, run ON the Push (scripts/governor.sh)
import json, sys, time, struct, math, urllib.request, urllib.parse, statistics
B = "http://127.0.0.1:7720"
def get(p, raw=False):
    b = urllib.request.urlopen(B + p, timeout=300).read()
    return b if raw else json.loads(b)
def post(p, o): return urllib.request.urlopen(urllib.request.Request(B + p, json.dumps(o).encode(), {"Content-Type": "application/json"}), timeout=30).read()
mod = sys.argv[1]; trials = int(sys.argv[2]) if len(sys.argv) > 2 else 15; long_rest = int(sys.argv[3]) if len(sys.argv) > 3 else 120
n = [d["n"] for d in get("/api/pung-devices")["devices"] if d["module"] == mod][0]
def par(key):
    v = get("/api/devices/%d/param?key=%s" % (n, urllib.parse.quote("synth:" + key)))
    return str(v.get("value", ""))
def setp(key, val): post("/api/devices/%d/param" % n, {"key": "synth:" + key, "value": str(val)})
def dbg(): return dict(kv.split("=") for kv in par("debug_info").split() if "=" in kv)
def late(): return sum(d.get("late") or 0 for d in get("/api/devices").get("devices", []))
def rest(ms): post("/api/governor/rest", {"ms": ms})
def wait_rest(limit=40):
    t = time.time()
    while time.time() - t < limit:
        if par("resting") == "1": return True
        time.sleep(0.1)
    return False
def engine(secs=10):
    g = get("/api/governor?seconds=%d" % secs)
    return sum(e["cpu"] for e in g["engines"] if e["module"] == mod), g["pung_total"]
def trial(note=60):
    get("/api/devices/%d/capture.wav?arm=3" % n); t_arm = time.monotonic()
    time.sleep(0.4)
    t0 = time.monotonic(); post("/api/devices/%d/note" % n, {"note": note, "velocity": 110}); t1 = time.monotonic()
    time.sleep(0.6); post("/api/devices/%d/note" % n, {"note": note, "velocity": 0}); time.sleep(0.3)
    w = get("/api/devices/%d/capture.wav" % n, raw=True)[44:]
    f = struct.unpack("<%df" % (len(w) // 4), w)
    on = next((i // 2 for i in range(0, len(f), 2) if abs(f[i]) > 0.003 or abs(f[i + 1]) > 0.003), None)
    if on is None: return None
    seg = f[on * 2:(on + 22050) * 2]  # the half second from its onset
    rms = math.sqrt(sum(x * x for x in seg) / max(1, len(seg)))
    return (on / 44100.0 - ((t0 + t1) / 2 - t_arm)) * 1000, 20 * math.log10(max(rms, 1e-9)), 20 * math.log10(max(max(abs(x) for x in seg), 1e-9))
def series(name, before):
    out = []
    for i in range(trials):
        ok = before()
        r = trial()
        if r is not None and ok is not False: out.append(r)
        time.sleep(1.0)
    if not out: print("  %s: NOTHING SOUNDED" % name); return None
    lat = sorted(r[0] for r in out)
    res = (statistics.median(lat), lat[0], lat[-1], statistics.median(r[1] for r in out), statistics.median(r[2] for r in out))
    print("  %-7s %d/%d sounded; note to sound ms: median %.1f (%.1f to %.1f); level: rms %.1f dB, peak %.1f dB" % ((name, len(out), trials) + res))
    # how far a series' level may be off by chance: the spread of its notes over the root of their number
    # (a sound that moves by itself: Xenia's first, 7 dB between one note and the next, 2026-11-26)
    se = lambda k: statistics.pstdev(r[k] for r in out) / math.sqrt(len(out)) if len(out) > 1 else 0.0
    return res + (se(1), se(2))
fails = []
def check(ok, what):
    print("  %s %s" % ("ok  " if ok else "FAIL", what))
    if not ok: fails.append(what)
print("==", mod, "device", n, dbg())
# Warm first: an emulator compiles a sound's code the first time it plays it, and underruns while it
# does (a fresh Vavra: ten on the first note of a sound not played since its start, rest or no rest,
# measured 2026-11-25). The test's two sounds are played once before anything is counted.
rest(0); time.sleep(2)
try:
    _p = par("preset"); trial(); setp("preset", str(int(float(_p)) + 1)); time.sleep(3); trial(); setp("preset", _p); time.sleep(3); trial()
except Exception as e:
    print("  (not warmed: %s)" % e)
u0, l0 = int(dbg().get("underruns", 0)), late()
rest(10000)
check(par("rest_after_ms") not in ("", "0"), "the governor told it when to rest (rest_after_ms=%s)" % par("rest_after_ms"))
rest(0); time.sleep(6)
check(par("resting") == "0", "rest off: awake")
awake_cpu, awake_total = engine()
a = series("awake", lambda: time.sleep(5))
rest(4000)
check(wait_rest(), "rests after 4 s of silence")
rest_cpu, rest_total = engine()
check(par("resting") == "1", "still at rest after 10 s more")
print("  engine: awake %.1f, at rest %.1f percent of a core; all of Pung %.1f -> %.1f" % (awake_cpu, rest_cpu, awake_total, rest_total))
check(rest_cpu < 1.0, "at rest the engine takes under 1 percent of a core (%.1f)" % rest_cpu)
r = series("rested", wait_rest)
if a and r:
    check(r[0] - a[0] < 2.0, "first note after a rest as on time as awake (%.1f against %.1f ms)" % (r[0], a[0]))
    tol = lambda k: max(1.5, 3 * math.hypot(a[k], r[k]))  # 1.5 dB, or three times what chance allows
    check(abs(r[3] - a[3]) < tol(5) and abs(r[4] - a[4]) < tol(6), "it sounds the same after a rest (rms %.1f against %.1f dB, peak %.1f against %.1f; within %.1f and %.1f)" % (r[3], a[3], r[4], a[4], tol(5), tol(6)))
# a state read at rest does not wake it, and is the state it had
check(wait_rest(), "at rest again")
st1 = par("state"); time.sleep(0.5)
check(par("resting") == "1", "reading its state leaves it at rest")
# a knob at rest wakes it, and holds
keys = json.loads(par("chain_params") or "[]")
cut = next((k for k in keys if "cutoff" in k.get("key", "") and k.get("type") in ("int", "float")), None)
if cut:
    k = cut["key"]; before = par(k)
    new = str(int((float(cut.get("min", 0)) + float(cut.get("max", 127))) / 2) + 7)
    setp(k, new); time.sleep(0.3)
    check(par("resting") == "0", "a knob (%s) wakes it" % k)
    check(par(k).split(".")[0] == new, "the knob holds its value (%s -> %s, reads %s)" % (before, new, par(k)))
    setp(k, before); time.sleep(0.5)
else:
    print("  (no cutoff key found in chain_params)")
check(wait_rest(), "at rest again")
# a sound change at rest wakes it, and it plays
p0 = par("preset")
try:
    setp("preset", str(int(float(p0)) + 1)); time.sleep(3)
    t = trial()
    check(t is not None, "another sound loaded at rest plays (preset %s -> %s)" % (p0, par("preset")))
    setp("preset", p0); time.sleep(3)
    trial(); time.sleep(3)  # (the first notes of a sound just loaded come a deep ring later: NATIVE-MODULES.md rule 10)
except Exception as e:
    print("  (preset change not tried: %s)" % e)
# a long rest
check(wait_rest(), "at rest again")
print("  resting %d s ..." % long_rest); time.sleep(long_rest)
check(par("resting") == "1", "still at rest after %d s" % long_rest)
t = trial()
check(t is not None and a is not None and t[0] <= a[2] + 2.0, "first note after a long rest on time (%s ms; awake: up to %.1f)" % ("%.1f" % t[0] if t else "none", a[2] if a else 0))
d = dbg()
check(int(d.get("underruns", 0)) - u0 == 0, "no underrun in the whole test (%d)" % (int(d.get("underruns", 0)) - u0))
check(late() - l0 == 0, "no late block (%d)" % (late() - l0))
rest(10000)
print("== %s: %s" % (mod, "ALL PASS" if not fails else "%d FAILED: %s" % (len(fails), "; ".join(fails))))
