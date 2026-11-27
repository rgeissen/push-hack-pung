#!/usr/bin/env python3
"""The registry of the Set contract (docs/SET-CONTRACT.md): for every module, as each kind of device it can be,
its own parameters by key in a fixed order. A parameter's place in that list is its number for good: its
position in the device and its id, on every Pung, in every host.

    registry.py seed OUT FRESH.json FIRMWARE.json   write a first registry from two exports of GET /api/layouts:
                                                    FRESH from an installation of the whole pack and nothing else
                                                    (every module but the emulators); FIRMWARE from one that has
                                                    the emulators' firmware (they say all their parameters only then)
    registry.py add REGISTRY EXPORT.json [id ...]   append what an export has and the registry lacks (new modules,
                                                    new parameters of known ones; only the ids named, if any)
    registry.py check OLD NEW                       NEW keeps every entry of OLD where it was (append-only):
                                                    what the catalog build asks before a pack goes out

The registry holds names of controls, never anything of a firmware.
"""
import json
import sys

CONTRACT = 1
# the modules that emulate hardware: their lists come from the installation that has their firmware
EMULATORS = ["jp8000", "minijv", "osirus", "nodalred", "ostirus", "vavra", "xenia"]


def layouts(path):
    return {(x["module"], x["kind"]): x for x in json.load(open(path))["layouts"]}


def write(path, reg):
    reg["modules"] = {k: reg["modules"][k] for k in sorted(reg["modules"])}
    with open(path, "w") as f:
        json.dump(reg, f, indent=1, sort_keys=False)
        f.write("\n")


def check(old, new):
    """every problem that makes NEW not an append of OLD"""
    bad = []
    if old.get("contract") != new.get("contract"):
        bad.append("the contract's number changed")
    o, n = old.get("midi_fx", []), new.get("midi_fx", [])
    if n[:len(o)] != o:
        bad.append("the MIDI generators' order in the selector changed (it may only grow at its end)")
    for mod, kinds in old.get("modules", {}).items():
        for kind, keys in kinds.items():
            now = new.get("modules", {}).get(mod, {}).get(kind)
            if now is None:
                bad.append(f"{mod} as {kind} is gone (a module that leaves the pack keeps its entry)")
            elif now[:len(keys)] != keys:
                at = next((i for i, k in enumerate(keys) if i >= len(now) or now[i] != k), len(keys))
                bad.append(f"{mod} as {kind}: entry {at} was {keys[at]!r} and is {now[at]!r}" if at < len(now)
                           else f"{mod} as {kind}: it lost entries from {at} on")
    return bad


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "seed" and len(sys.argv) == 5:
        out, fresh, firm = sys.argv[2], layouts(sys.argv[3]), layouts(sys.argv[4])
        reg = {"contract": CONTRACT,
               "about": "docs/SET-CONTRACT.md. Append-only: scripts/registry.py check. A parameter's place here is its number for good.",
               "midi_fx": [], "modules": {}}
        for (mod, kind), x in sorted(fresh.items()):
            src = firm.get((mod, kind)) if mod in EMULATORS else x
            if src is None:
                sys.exit(f"{mod}: an emulator, and the installation with firmware has no device of it")
            reg["modules"].setdefault(mod, {})[kind] = src["keys"]
        reg["midi_fx"] = sorted(m for m, k in reg["modules"].items() if "midi" in k)
        write(out, reg)
        n = sum(len(v) for v in reg["modules"].values())
        print(f"{out}: {len(reg['modules'])} modules as {n} devices, {len(reg['midi_fx'])} MIDI generators in the selector")
    elif cmd == "add" and len(sys.argv) >= 4:
        path, exp, only = sys.argv[2], layouts(sys.argv[3]), set(sys.argv[4:])
        reg = json.load(open(path))
        before = json.loads(json.dumps(reg))
        for (mod, kind), x in sorted(exp.items()):
            if only and mod not in only:
                continue
            have = reg["modules"].setdefault(mod, {}).setdefault(kind, [])
            new = [k for k in x["keys"] if k not in have]
            if new:
                have.extend(new)
                print(f"{mod} as {kind}: + {len(new)} ({', '.join(new[:6])}{'…' if len(new) > 6 else ''})")
            if kind == "midi" and mod not in reg["midi_fx"]:
                reg["midi_fx"].append(mod)
                print(f"{mod}: the selector's step {len(reg['midi_fx'])}")
        bad = check(before, reg)
        if bad:
            sys.exit("not an append:\n  " + "\n  ".join(bad))
        write(path, reg)
    elif cmd == "check" and len(sys.argv) == 4:
        bad = check(json.load(open(sys.argv[2])), json.load(open(sys.argv[3])))
        if bad:
            sys.exit("the registry may only grow at its ends:\n  " + "\n  ".join(bad))
        print("append-only: ok")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
