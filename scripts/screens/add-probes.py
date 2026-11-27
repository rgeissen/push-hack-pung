#!/usr/bin/env python3
"""Adds to scripts/screens/probes.json the probe records it lacks, from a deployment's module-screen.json
(<data>/module-screen.json of a Pung that has the modules installed), and writes kinds.json (each module's
kind and name) from an export of GET /api/layouts of the same deployment. The card pictures of every module
are drawn from these (src/cardshots_test.go, make screens).

    add-probes.py MODULE-SCREEN.json LAYOUTS.json

A record that is there is never replaced. An emulator's record is not taken here: it must carry no values
(they would be the player's firmware's), and those modules have front panels with records of their own.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EMULATORS = {"xenia", "vavra", "ostirus", "osirus", "nodalred", "jp8000", "minijv"}
KIND = {"instrument": "sound_generator", "effect": "audio_fx", "midi": "midi_fx"}

if len(sys.argv) != 3:
    sys.exit(__doc__)
cache = json.load(open(sys.argv[1]))
layouts = json.load(open(sys.argv[2]))["layouts"]
path = os.path.join(HERE, "probes.json")
probes = json.load(open(path))
added = []
for mid, rec in sorted(cache.items()):
    if mid in probes or mid in EMULATORS or not isinstance(rec, dict):
        continue
    probe = rec.get("probe") or {}
    meta = probe.get("meta") or probe.get("Meta") or {}
    if not rec.get("ok") or not (meta.get("chain_params") or meta.get("ui_hierarchy")):
        continue
    probes[mid] = rec
    added.append(mid)
json.dump(probes, open(path, "w"), separators=(",", ":"), sort_keys=True)
kinds_path = os.path.join(HERE, "kinds.json")
kinds = json.load(open(kinds_path)) if os.path.exists(kinds_path) else {}
for x in layouts:
    kinds.setdefault(x["module"], {"Kind": KIND.get(x["kind"], "sound_generator"), "Name": x.get("name", "").removesuffix(" Track")})
json.dump(kinds, open(kinds_path, "w"), indent=0, sort_keys=True)
print(f"probes.json: + {len(added)} ({' '.join(added[:12])}{' …' if len(added) > 12 else ''}); {len(probes)} in all; kinds.json: {len(kinds)}")
