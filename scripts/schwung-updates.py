#!/usr/bin/env python3
"""What Schwung has that Pung's module pack does not: the check before a release, and any day between.

    scripts/schwung-updates.py [CATALOG.json]        (default: build/catalog/catalog.json)

Reads Schwung's module list (charlesvestal/schwung, module-catalog.json) and every module's own
release.json on GitHub, and compares them with a catalog of Pung's:

  newer upstream   a module whose author has released a newer version than the pack carries. One Pung
                   builds from a fork (scripts/local-sources.json) says so: the fork is to be brought up
                   to that release first.
  new upstream     a module Schwung lists and the pack does not, with the reason where Pung leaves it out
                   on purpose (scripts/catalog-policy.json); without one it is new, or was left out by
                   the catalog build (no licence named, or it did not build).
  gone upstream    a module of the pack Schwung no longer lists.

It changes nothing and builds nothing; it asks GitHub for public files only. Exit status 0 when the pack is
level with Schwung, 1 when something is newer or new without a reason (so a release can ask it).
"""
import concurrent.futures as cf
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHWUNG = "https://raw.githubusercontent.com/charlesvestal/schwung/main/module-catalog.json"
KINDS = ("sound_generator", "audio_fx", "midi_fx")


def get(url):
    try:
        rq = urllib.request.Request(url, headers={"User-Agent": "pung-catalog-check"})
        return urllib.request.urlopen(rq, timeout=25).read()
    except Exception:
        return None


def key(v):
    return [int(x) if x.isdigit() else 0 for x in re.split(r"[.\-+]", v or "0")]


def released(m):
    """the version a module's repository says it has released"""
    raw = get(f"https://raw.githubusercontent.com/{m['github_repo']}/{m.get('default_branch') or 'main'}/release.json")
    try:
        r = json.loads(raw)
    except Exception:
        return m["id"], None
    own = (r.get("modules") or {}).get(m["id"]) or {}   # a repository of several modules
    return m["id"], (own.get("version") or r.get("version") or "").lstrip("v") or None


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "catalog", "catalog.json")
    ours = {m["id"]: m for m in json.load(open(path))["modules"]}
    raw = get(SCHWUNG)
    if not raw:
        sys.exit("Schwung's module list did not answer (GitHub): nothing compared")
    theirs = [m for m in json.loads(raw)["modules"] if m.get("component_type") in KINDS]
    policy = json.load(open(os.path.join(ROOT, "scripts", "catalog-policy.json")))
    withheld = policy.get("withhold") or {}
    with cf.ThreadPoolExecutor(12) as ex:
        vers = dict(ex.map(released, theirs))

    newer, new, unread = [], [], []
    for m in theirs:
        o, v = ours.get(m["id"]), vers.get(m["id"])
        if not o:
            new.append((m["id"], m.get("name", ""), withheld.get(m["id"], "")))
            continue
        if v is None:
            unread.append(m["id"])
            continue
        # Pung's own builds of a fork carry a fourth number (0.9.13.1 of 0.9.13): the author's three decide
        if key(v)[:3] > key(o["version"])[:3] or (key(v)[:3] == key(o["version"])[:3] and len(key(v)) > 3 and key(v) > key(o["version"])):
            fork = "rgeissen/" in ((o.get("source") or {}).get("repo") or "")
            newer.append((m["id"], o["version"], v, fork))
    listed = {m["id"] for m in theirs}
    gone = sorted(i for i, o in ours.items() if o.get("origin") == "schwung" and i not in listed)

    print(f"Schwung lists {len(theirs)} instruments, effects and MIDI generators; the pack ({os.path.relpath(path, ROOT)}) "
          f"has {sum(1 for o in ours.values() if o.get('origin') == 'schwung')} of Schwung's and {sum(1 for o in ours.values() if o.get('origin') != 'schwung')} of Pung's own.")
    print(f"\nNewer upstream: {len(newer)}")
    for i, mine, theirs_v, fork in sorted(newer):
        print(f"  {i:<22} {mine:>10}  ->  {theirs_v:<10}{'  built from Pung’s fork: bring the fork up first' if fork else ''}")
    held = [x for x in new if x[2]]
    open_ = [x for x in new if not x[2]]
    print(f"\nListed by Schwung, not in the pack: {len(new)}")
    for i, name, _ in sorted(open_):
        print(f"  {i:<22} new, or left out by the catalog build (no licence named, or it did not build)")
    for i, name, why in sorted(held):
        print(f"  {i:<22} withheld: {why[:88]}")
    if gone:
        print(f"\nIn the pack, no longer listed by Schwung: {', '.join(gone)}")
    if unread:
        print(f"\nNo release.json read for: {', '.join(sorted(unread))}")
    return 1 if newer or open_ else 0


if __name__ == "__main__":
    sys.exit(main())
