#!/usr/bin/env python3
"""On-device test: the Pung view in place of Push's device view.

Push Hack Home (push-manager, devview.go) shows an app's view instead of
Push's device view while one of the app's Live devices is selected. This runs
it through the real Push, Live and push-manager, with Braids on track
1. Runs ON the Push, as root.

Button presses are simulated where they really arrive:
  - push-manager reads the hardware: a press is sent to its input port;
  - Push3 gets it too while Live has the buttons: also sent to Push3's input.

Needs: the Pung device view switched on (Home's DEVICE, or the Display
page), Braids on track 1, a Chord Track on track 2, track 3 without Pung
devices (vst3_devices_test.py leaves it so).

    python3 device_view_test.py
"""
import json
import socket
import struct
import subprocess
import sys
import time
import urllib.request

results = []


def live(ns, cmd, **args):
    s = socket.create_connection(("127.0.0.1", 7704), timeout=8)
    f = s.makefile("rw")
    f.write(json.dumps(dict(id=1, ns=ns, cmd=cmd, **args)) + "\n")
    f.flush()
    r = json.loads(f.readline())
    s.close()
    return r


def surface():
    with urllib.request.urlopen("http://127.0.0.1:7701/api/surface", timeout=5) as r:
        return json.loads(r.read())


def port(name):
    client = None
    for line in subprocess.run(["aconnect", "-l"], capture_output=True, text=True).stdout.splitlines():
        if line.startswith("client "):
            client = line.split()[1].rstrip(":")
        elif name in line and client:
            return client + ":" + line.split()[0]
    sys.exit("no port " + name)


PM = port("Push Manager In")      # push-manager's hardware input
PUSH3 = port("Ableton Internal Input")  # Push3's input
MID = "/data/push-hack/data/pung/test/press.mid"


def pung_press(*msg):
    req = urllib.request.Request("http://127.0.0.1:7720/api/surface/press", data=json.dumps({"msg": list(msg)}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except urllib.error.HTTPError as e:
        if e.code != 409:  # 409: Pung no longer owns the surface (push-manager took this press)
            raise


def press(cc):
    """A real button reaches every reader of Push's hardware at once:
    push-manager (sent to its input port), Push3 while Live has the buttons
    (its input port), Pung's view while it owns the surface (its own
    subscription; here its test door). push-manager reads it first, Push3
    answers with its lights later. So: push-manager, then the others."""
    ev = bytes([0x00, 0xB0, cc, 127, 0x10, 0xB0, cc, 0, 0x00, 0xFF, 0x2F, 0x00])
    open(MID, "wb").write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, 96) + b"MTrk" + struct.pack(">I", len(ev)) + ev)
    d = surface()
    subprocess.run(["aplaymidi", "-p", PM, MID])
    if d["owner"] == "outside":
        subprocess.run(["aplaymidi", "-p", PUSH3, MID])
    elif d["owner"] == "app" and d["app"] == "pung":
        pung_press(0xB0, cc, 127)
        pung_press(0xB0, cc, 0)


def check(label, owner, push=None, app="pung", selected=None):
    d = surface()
    v = d["device_view"]
    ok = (d["owner"] == owner and (owner != "app" or d["app"] == app) and (push is None or v["push_view"] == push)
          and (selected is None or v["selected"] in (selected if isinstance(selected, tuple) else (selected,))))
    results.append(ok)
    print("%s %-44s %s %s auto=%s hold=%r push=%s selected=%r" % (
        "PASS" if ok else "FAIL", label, d["owner"], d["app"], v["auto"], v["hold"], v["push_view"], v["selected"]),
        flush=True)


DEVICE, MIXER, HELP = 110, 112, 81
LEFT, RIGHT, LOWER1, ADD, SETTINGS, SESSION, NOTE = 44, 45, 20, 32, 30, 51, 50
# Live's selected device: the rack, named by its browser entry. Track 1 holds
# Braids and Freeverb, and Live remembers which was selected.
BRAIDS = ("Braids", "Freeverb")
CHORD = ("Chord Track",)

entries = {e["ID"]: e for e in surface()["entries"]}
sw = entries.get("pung", {})
if not (sw.get("HasDeviceView") and sw.get("DeviceView")):
    sys.exit("the Pung device view is off (Home: DEVICE, or the Display page)")

live("track", "select", track=0)
press(MIXER); time.sleep(1.5)
check("Mixer: Push shows its mixer", "outside", "other")
press(DEVICE); time.sleep(2)
check("Device View: the Pung view opens", "app", "device")
press(HELP); time.sleep(3)
check("Help: Push's own device view", "outside", "device")
time.sleep(3)
check("...and it stays (held)", "outside")
press(DEVICE); time.sleep(2)
check("Device View: the Pung view is back", "app")
press(DEVICE); time.sleep(2.5)
check("Device View in it: Push's device view", "outside", "device")
press(DEVICE); time.sleep(2)
check("Device View: the Pung view again", "app")
press(MIXER); time.sleep(3)
check("Mixer in it: Push's mixer", "outside", "other")
press(DEVICE); time.sleep(2)
check("Device View: the Pung view", "app", "device")
live("track", "select", track=2); time.sleep(1.5)
check("a track without Pung: Push's view", "outside")
live("track", "select", track=1); time.sleep(2)
check("Chord Track: the Pung view", "app")
live("track", "select", track=0); time.sleep(1.5)
check("Braids: still the Pung view", "app")

# other buttons, in the Pung view (on Braids, track 1)
press(RIGHT); time.sleep(2)
check("right arrow: track 2, still Pung", "app", selected=CHORD)
press(RIGHT); time.sleep(2)
check("right arrow: track 3 (no Pung): Push", "outside", "device", selected="")
live("track", "select", track=0); time.sleep(2)
check("back on Braids: Pung", "app", selected=BRAIDS)
press(LOWER1 + 1); time.sleep(2)
check("lower button 2: track 2, Pung", "app", selected=CHORD)
press(LOWER1 + 2); time.sleep(2)
check("lower button 3: track 3, Push", "outside", "device", selected="")
live("track", "select", track=0); time.sleep(2)
press(LEFT); time.sleep(1.5)
check("left arrow on the first track: stays", "app", selected=BRAIDS)
press(SESSION); time.sleep(1.5)
check("Session (pad mode): stays Pung", "app")
press(NOTE); time.sleep(1)  # back to Note: Session left behind makes the pads launch clips
press(ADD); time.sleep(2)
check("Add: Push's own browser", "outside")
press(DEVICE); time.sleep(2.5)
check("Device View: the Pung view again", "app", "device")
press(SETTINGS); time.sleep(2)
check("Settings: Push's settings", "outside")
press(SETTINGS); time.sleep(1.5)
press(DEVICE); time.sleep(2.5)
check("Settings closed, Device View: Pung", "app", "device")

# Pung restarting while it stands in (an update, a crash): nothing else
# changes, and the view must come back by itself
subprocess.run(["/etc/init.d/push-hack-pung", "restart"], capture_output=True)
for _ in range(20):
    time.sleep(0.5)
    d = surface()
    if d["owner"] == "app" and d["device_view"]["auto"]:
        break
check("Pung restarted: its view is back by itself", "app", "device")

print("\n%d/%d passed" % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
