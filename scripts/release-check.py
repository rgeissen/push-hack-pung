#!/usr/bin/env python3
"""What a release needs before it is packaged (make release, make publish).

Each rule here was once a step someone had to remember (CLAUDE.md, Release):

  - the tree is clean: what ships is what is committed;
  - VERSION, hack.json and the manual's eyebrow name the same version;
  - the catalog was built after the last change to what goes into it, and
    each of Pung's own modules names the commit of its last change
    (0.4.2 was republished for a source archive that lacked what shipped);
  - every source commit the catalog links is on GitHub, unless its archive
    is on pung.live/sources already (0.4.5: JE-8086's fork was not pushed);
  - the chain host is there (build/modules/chain/dsp.so): 0.4.3 to 0.5.0
    shipped without it, and a fresh install of those does not start;
  - pung, livedevice.so and the Modules page's pictures were built after
    the last change to what they are made of;
  - with --publish: HEAD is on origin/main (the release is made from it), and
    pung.live answers from the DiskStation (where release.sh puts it).

  scripts/release-check.py [--publish] [--after-build]

--after-build adds the checks of what make release builds (the binary, the
pictures, a tree still clean once the site is built).
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO = os.environ.get("PUNG_REPO", "rgeissen/push-hack-pung")
PUBLISH = "--publish" in sys.argv
AFTER = "--after-build" in sys.argv
problems = []


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def last_change(*paths):
    """unix time of the last commit touching paths (0: none)"""
    out = git("log", "-1", "--format=%ct", "--", *paths)
    return int(out) if out else 0


def mtime(rel):
    p = os.path.join(ROOT, rel)
    return os.path.getmtime(p) if os.path.exists(p) else None


def built_after(rel, *paths):
    t = mtime(rel)
    if t is None:
        problems.append(f"{rel} is missing")
    elif t < last_change(*paths):
        problems.append(f"{rel} is older than the last commit to {', '.join(paths)}: build it again")


def gh(*args):
    r = subprocess.run(["gh", *args], cwd=ROOT, capture_output=True, text=True)
    return r.returncode, r.stdout


# the tree
dirty = git("status", "--porcelain")
if dirty:
    problems.append("the tree is not clean (commit first: what ships is what is committed):\n    "
                    + dirty.replace("\n", "\n    "))

# the version, three places
version = open(os.path.join(ROOT, "VERSION")).read().strip()
hack = json.load(open(os.path.join(ROOT, "hack.json")))["version"]
m = re.search(r'class="eyebrow">Pung ([0-9.]+) ', open(os.path.join(ROOT, "site/manual.src.html")).read())
manual = m.group(1) if m else None
if not (version == hack == manual):
    problems.append(f"versions differ: VERSION {version}, hack.json {hack}, the manual's eyebrow {manual}")

# the catalog
cat_path = os.path.join(ROOT, "build/catalog/catalog.json")
mods = []
if not os.path.exists(cat_path):
    problems.append("build/catalog/catalog.json is missing (python3 scripts/build-catalog.py --base-url \"\")")
else:
    built_after("build/catalog/catalog.json", "native", "scripts/recipes", "scripts/catalog-policy.json",
                "scripts/module-revisions.json")
    mods = json.load(open(cat_path))["modules"]
    own = f"https://github.com/{REPO}"
    for mod in mods:
        s = mod.get("source") or {}
        if s.get("repo", "").rstrip("/").removesuffix(".git") == own and os.path.isdir(os.path.join(ROOT, "native", mod["id"])):
            want = git("log", "-1", "--format=%H", "--", f"native/{mod['id']}")
            if s.get("commit") != want:
                problems.append(f"{mod['id']}: the catalog names commit {str(s.get('commit'))[:12]}, its last change is "
                                f"{want[:12]}: build it again from the committed tree")

    # every source on GitHub (a commit there, or its archive already on pung.live)
    host = os.environ.get("PUNG_LIVE_HOST") or os.environ.get("PUNG_CATALOG_HOST")
    port = os.environ.get("PUNG_LIVE_PORT") or os.environ.get("PUNG_CATALOG_PORT")
    if not host:
        problems.append("PUNG_LIVE_HOST is not set (the DiskStation that serves pung.live: scripts/pung-live-env.sh)")
    else:
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", *(["-p", port] if port else []), host,
                            "mkdir -p /volume2/web/pung/sources && ls /volume2/web/pung/sources"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            problems.append(f"pung.live's sources cannot be listed on {host}: {r.stderr.strip()[:200]}")
        have = set(r.stdout.split())
        checked = {}
        for mod in mods:
            s = mod.get("source") or {}
            if not s.get("archive") or os.path.basename(s["archive"]) in have:
                continue
            repo = s.get("repo", "").replace("https://github.com/", "").rstrip("/").removesuffix(".git")
            key = (repo, s.get("commit"))
            if key not in checked:
                checked[key] = gh("api", f"repos/{repo}/commits/{s.get('commit')}", "--jq", ".sha")[0] == 0
            if not checked[key]:
                problems.append(f"{mod['id']}: commit {str(s.get('commit'))[:12]} is not on github.com/{repo} "
                                "(a fork not pushed?) and its archive is not on the sources release yet")
    print(f"catalog: {len(mods)} modules")

# the chain host: Pung does not start without it, and nothing in make release
# builds it (make modules, from a Schwung that has chain_bus.c). 0.4.3 to 0.5.0
# shipped without it.
if not os.path.exists(os.path.join(ROOT, "build", "modules", "chain", "dsp.so")):
    problems.append("build/modules/chain/dsp.so is missing: the chain host (make modules); Pung does not start without it")

# what make release builds
if AFTER:
    built_after("pung", "src")
    built_after("livedevice.so", "src/go.mod", "src/go.sum")
    built_after("build/screens/index.json", "src", "overrides", "native", "scripts/screens")

# where the release is made from
if PUBLISH:
    subprocess.run(["git", "fetch", "-q", "origin"], cwd=ROOT)
    if subprocess.run(["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"], cwd=ROOT).returncode != 0:
        problems.append("HEAD is not on origin/main: push first (the release and its tag are made from GitHub's main)")
    site = os.environ.get("PUNG_LIVE_URL", "https://pung.live")
    try:
        import urllib.request
        with urllib.request.urlopen(urllib.request.Request(site + "/", method="HEAD"), timeout=20) as r:
            if r.status != 200:
                problems.append(f"{site} answers {r.status}")
    except Exception as e:
        problems.append(f"{site} cannot be reached ({e}): DNS, Web Station's virtual host, its certificate?")

if problems:
    print("not ready for a release:", file=sys.stderr)
    for p in problems:
        print("  - " + p, file=sys.stderr)
    sys.exit(1)
print(f"ready: Pung {version}" + (" (publish)" if PUBLISH else ""))
