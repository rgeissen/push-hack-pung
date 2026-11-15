#!/usr/bin/env python3
"""On-device test: Push's pads stay Live's while the Pung view is up.

The Pung view owns the screen, encoders and display rows; the pads, the
touch strip and the playing buttons go on to Live (push-manager midipass,
push_hook.c). Runs ON the Push, as root, with Braids on track 1 and
the Pung device view switched on.

    python3 pads_test.py
"""
import json
import socket
import struct
import subprocess
import sys
import time
import urllib.request

results = []
MID = "/data/push-hack/data/pung/test/pads.mid"


def live(ns, cmd, **args):
    s = socket.create_connection(("127.0.0.1", 7704), timeout=8)
    f = s.makefile("rw")
    f.write(json.dumps(dict(id=1, ns=ns, cmd=cmd, **args)) + "\n")
    f.flush()
    r = json.loads(f.readline())
    s.close()
    return r


def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read())


def surface():
    return get("http://127.0.0.1:7701/api/surface")


def braids():
    for d in get("http://127.0.0.1:7720/api/devices")["devices"]:
        if d.get("module") == "braids" and d["kind"] == "instrument":
            return d
    return None


def port(name):
    client = None
    for line in subprocess.run(["aconnect", "-l"], capture_output=True, text=True).stdout.splitlines():
        if line.startswith("client "):
            client = line.split()[1].rstrip(":")
        elif name in line and client:
            return client + ":" + line.split()[0]
    sys.exit("no port " + name)


PM, PUSH3, PUSH3_OUT = port("Push Manager In"), port("Ableton Internal Input"), port("Ableton Internal Output")


def play(dst, events):
    """events: (delta ticks, bytes...) at 96 ticks a beat, 120 BPM: 5.2 ms a tick."""
    trk = b""
    for delta, *msg in events:
        trk += bytes([delta]) + bytes(msg)
    trk += b"\x00\xff\x2f\x00"
    open(MID, "wb").write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, 96) + b"MTrk" + struct.pack(">I", len(trk)) + trk)
    subprocess.run(["aplaymidi", "-p", dst, MID])


def cc(dst, n):
    play(dst, [(0, 0xB0, n, 127), (16, 0xB0, n, 0)])


def check(ok, what):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + what, flush=True)


# the Pung view standing in on Braids
live("track", "select", track=0)
live("device", "select", track=0, path=[0, 0, 0])
time.sleep(1)
if surface()["owner"] != "app":
    cc(PM, 112); cc(PUSH3, 112); time.sleep(1.2)
    cc(PM, 110); cc(PUSH3, 110); time.sleep(2.5)
cc(PUSH3, 50)  # Note mode: in Session mode a pad launches a clip, it plays no note
time.sleep(0.5)
d = surface()
check(d["owner"] == "app" and d["app"] == "pung", "the Pung view stands in (%s %s)" % (d["owner"], d["app"]))
mp = open("/data/push-hack/hacks/push-display/midipass", "rb").read()
check(len(mp) >= 16 and mp[4] == 1, "push-manager leaves the pads to Live (midipass pads=%d)" % (mp[4] if len(mp) > 4 else -1))

# a pad from the hardware: Push3 gets it through the intercept, Live plays it
b0 = braids()
peak = 0.0
import threading
t = threading.Thread(target=play, args=(PUSH3, [(0, 0x90, 68, 110), (120, 0x80, 68, 0)]))  # held about 0.6 s (a delta over 127 needs two bytes)
t.start()
for _ in range(10):  # the meter while the pad is held
    m = live("meters", "get")["data"]["tracks"][0]
    peak = max(peak, max(m))
    time.sleep(0.08)
t.join()
b1 = braids()
heard = b1["notes_in"] - b0["notes_in"] if b0 and b1 and b0["id"] == b1["id"] else -1
check(heard >= 1, "a pad reaches Live and plays Braids (%d notes heard)" % heard)
check(peak > 0.01, "and it sounds (meter %.3f)" % peak)

# the same pad seen by Pung (it reads the hardware too) plays nothing there
b0 = braids()
for msg in ([0x90, 68, 110], [0x80, 68, 0]):
    req = urllib.request.Request("http://127.0.0.1:7720/api/surface/press", data=json.dumps({"msg": msg}).encode(),
                                 headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=5).read()
time.sleep(0.8)
b1 = braids()
check(b1["notes_in"] == b0["notes_in"], "Pung does not play the pad a second time (%d new)" % (b1["notes_in"] - b0["notes_in"]))

# a pad-mode button goes to Live, and Live lights the pads
dump = subprocess.Popen(["timeout", "4", "aseqdump", "-p", PUSH3_OUT], stdout=subprocess.PIPE, text=True)
time.sleep(0.5)
cc(PUSH3, 51)  # Session
out = dump.communicate()[0]
pad_lights = sum(1 for l in out.splitlines() if "Note on" in l or "Note off" in l)
check(pad_lights >= 32, "Session: Live repaints the pads (%d pad light messages; held back: 0)" % pad_lights)
cc(PUSH3, 50)  # back to Note
time.sleep(1)

# an encoder stays Pung's: Live does not get it
before = [p["v"] for p in live("device", "params", track=0, path=[0, 0, 0])["data"]["params"]]
play(PUSH3, [(0, 0xB0, 71, 5), (4, 0xB0, 71, 5), (4, 0xB0, 71, 5)])
time.sleep(0.8)
after = [p["v"] for p in live("device", "params", track=0, path=[0, 0, 0])["data"]["params"]]
check(before == after, "an encoder turned at Push3 is held back (Pung's)")

d = surface()
check(d["owner"] == "app", "still the Pung view (%s)" % d["owner"])
print("\n%d/%d passed" % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
