#!/usr/bin/env python3
"""Packages the modules built for Push 3 for a web service to hand out.

For every module the build left in <tree> (scripts/build-all.sh):
  - checks each ELF file in it is x86_64 and needs no glibc newer than 2.35
    (AbletonOS on Push 3), and that its DSP loads as the chain host loads it
    (dlopen RTLD_NOW, every symbol resolved) and exports an entry point
    (scripts/loadtest.c);
  - writes dist/<id>-push-x86_64.tar.gz, holding "<id>/..." (a Move module
    tarball's shape, so the same installer code can extract it);
and writes:
  - index.json: a catalog for Push. Per module: id, name, version, type, the
    install subfolder, the tarball, its size and sha256, the source repo and
    commit it was built from, and what the module needs that is not in it.
  - REPORT.md: built / failed / not built, with the reason.

    package-push-modules.py <catalog.json> <modsrc> <out dir>   (out holds modules/ and logs/)
"""
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile

catalog, modsrc, out = sys.argv[1:4]
# a module built from a local fork (local-sources.json) names that fork as its
# source: the commit it was built from exists there, not upstream
_ls = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local-sources.json")
FORKS = {k: v["github_repo"] for k, v in (json.load(open(_ls)).items() if os.path.exists(_ls) else []) if v.get("github_repo")}
tree, logs, dist = os.path.join(out, "modules"), os.path.join(out, "logs"), os.path.join(out, "dist")
os.makedirs(dist, exist_ok=True)
cat = {m["id"]: m for m in json.load(open(catalog))["modules"]}
recipes = {r["id"]: r for r in json.load(open(os.environ.get("PUNG_RECIPES_INDEX") or os.path.join(os.path.dirname(__file__), "..", "build", "recipes", "index.json")))}
status = {}
for line in open(os.path.join(logs, "status.tsv")):
    p = line.rstrip("\n").split("\t")
    if len(p) >= 2:
        status[p[0]] = p[1]
SUBDIR = {"sound_generator": "sound_generators", "audio_fx": "audio_fx", "midi_fx": "midi_fx",
          "utility": "utilities", "overtake": "overtake", "tool": "tools"}
NOT_FOR_PUSH = json.load(open(os.path.join(os.path.dirname(__file__), "recipes", "not-for-push.json")))


def elf_check(path):
    """None if fine, else why not."""
    with open(path, "rb") as f:
        h = f.read(20)
    if h[:4] != b"\x7fELF":
        return None
    if int.from_bytes(h[18:20], "little") != 0x3E:
        return "not x86_64"
    if b"/lib64/ld-linux-x86-64.so.2" in open(path, "rb").read(4096):
        return "its loader is /lib64/ld-linux-x86-64.so.2; Push 3 has /lib/ only (scripts/fix-interp.py)"
    try:
        syms = subprocess.run(["objdump", "-T", path], capture_output=True, text=True).stdout
    except FileNotFoundError:
        return None
    vers = [tuple(map(int, v.split("."))) for v in re.findall(r"GLIBC_(\d+\.\d+(?:\.\d+)?)", syms)]
    if vers and max(vers) > (2, 35):
        return "needs glibc %s" % ".".join(map(str, max(vers)))
    return None


def commit(repo):
    try:
        return subprocess.run(["git", "-c", "safe.directory=*", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    except Exception:
        return ""


# PUNG_LOADTEST=static: check the entry point without running the module.
# A build host whose CPU cannot run what it builds (the DiskStation's Atom has
# no SSE4.2; the Push builds target x86-64-v2) would see dlopen's constructors
# crash for no fault of the module. The Push runs the real test at install.
STATIC = os.environ.get("PUNG_LOADTEST") == "static"
ENTRIES = ("move_plugin_init_v2", "move_plugin_init_v1", "move_audio_fx_init_v2", "move_audio_fx_init_v1", "move_midi_fx_init")
LOADTEST = "/tmp/pung-loadtest"
if not STATIC:
    subprocess.run(["gcc", "-O1", os.path.join(os.path.dirname(os.path.abspath(__file__)), "loadtest.c"), "-o", LOADTEST, "-ldl"], check=True)


def static_entry(path):
    out = subprocess.run(["nm", "-D", "--defined-only", path], capture_output=True, text=True).stdout
    names = {l.split()[-1] for l in out.splitlines() if l.strip()}
    found = [e for e in ENTRIES if e in names]
    return "OK " + found[0] if found else "no entry point (%s)" % ", ".join(ENTRIES)
built, failed, skipped = [], [], []
entries = []
for mid, m in sorted(cat.items()):
    r = recipes.get(mid, {})
    if mid in NOT_FOR_PUSH:
        skipped.append((mid, NOT_FOR_PUSH[mid]))
        continue
    if r.get("status") == "skip":
        skipped.append((mid, r.get("why", "")))
        continue
    if status.get(mid) != "ok":
        log = os.path.join(logs, mid + ".log")
        why = "not run"
        if os.path.exists(log):
            errs = [l.strip() for l in open(log, errors="replace") if re.search(r"error|Error|No such file|not found", l)]
            why = (errs[0] if errs else "see log")[:200]
        failed.append((mid, why))
        continue
    sub = r.get("subdir") or SUBDIR.get(m["component_type"], "other")
    d = os.path.join(tree, sub, mid)
    bad = []
    for root, _, files in os.walk(d):
        for f in files:
            e = elf_check(os.path.join(root, f))
            if e:
                bad.append("%s: %s" % (os.path.relpath(os.path.join(root, f), d), e))
    # loads as the chain host loads it: RTLD_NOW, and exports an entry point
    mjp = os.path.join(d, "module.json")
    dsp = (json.load(open(mjp)).get("dsp") if os.path.exists(mjp) else "") or ""
    if not dsp and os.path.exists(os.path.join(d, "dsp.so")):
        dsp = "dsp.so"
    if dsp and not bad:
        if not os.path.exists(os.path.join(d, dsp)):
            bad.append("%s missing" % dsp)
        else:
            if STATIC:
                line = static_entry(os.path.join(d, dsp))
            else:
                r_ = subprocess.run([LOADTEST, os.path.join(d, dsp)], capture_output=True, text=True, timeout=30)
                line = (r_.stdout.strip().splitlines() or ["CRASH (signal %d)" % -r_.returncode])[-1]
            if not line.startswith("OK"):
                bad.append("load test: " + line.replace(d + "/", ""))
    if bad:
        failed.append((mid, "; ".join(bad)))
        continue
    # A module that is one thing on Move and another on the Push says so in
    # its module.json ("pung": {"component_type": "midi_fx"}): Stacks is a
    # tool there and a MIDI effect here. The packed module.json is the one
    # Pung reads, so it carries Pung's filing; the repository's stays Move's.
    if os.path.exists(mjp):
        pj = json.load(open(mjp))
        want = (pj.get("pung") or {}).get("component_type")
        if want and pj.get("component_type") != want:
            pj["component_type"] = want
            caps = pj.setdefault("capabilities", {})
            caps["component_type"], caps["chainable"] = want, True
            for k in ("tool_config", "ui"):
                pj.pop(k, None)
            json.dump(pj, open(mjp, "w"), indent=1)
    asset = "%s-push-x86_64.tar.gz" % mid
    tp = os.path.join(dist, asset)
    with tarfile.open(tp, "w:gz") as t:
        t.add(d, arcname=mid)
    data = open(tp, "rb").read()
    mj = {}
    if os.path.exists(os.path.join(d, "module.json")):
        mj = json.load(open(os.path.join(d, "module.json")))
    repo = os.path.join(modsrc, r.get("repo") or m["github_repo"].split("/")[1])
    entries.append({
        "id": mid, "name": mj.get("name") or m.get("name"), "version": mj.get("version", ""),
        "component_type": m["component_type"], "install_subdir": sub,
        "description": m.get("description", ""), "author": m.get("author", ""),
        "asset": asset, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
        # a Pung-native module is built from this repository (native/<id>)
        "source": ({"github_repo": m["github_repo"], "commit": commit("."), "modsrc": m["modsrc"], "native": True}
                   if m.get("native") else
                   {"github_repo": FORKS.get(m["github_repo"].split("/")[1], m["github_repo"]), "commit": commit(repo)}),
        "requires": m.get("requires", ""), "requires_modules": m.get("requires_modules", []),
    })
    built.append(mid)

now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
json.dump({"catalog_version": 2, "platform": "push3-x86_64", "glibc_max": "2.35", "built_at": now,
           "modules": entries}, open(os.path.join(out, "index.json"), "w"), indent=1)

with open(os.path.join(out, "REPORT.md"), "w") as f:
    f.write("# Schwung modules built for Push 3\n\n%s, from the catalog's %d modules: **%d built**, %d failed, %d not built.\n\n"
            % (now, len(cat), len(built), len(failed), len(skipped)))
    f.write("Built from each repo's source with the recipe in build/recipes (generated from its build script, never "
            "running it) or scripts/recipes (hand-written), in Ubuntu 22.04 (glibc 2.35, as on Push 3), no network.\n\n")
    f.write("## Failed\n\n| Module | First error |\n|---|---|\n")
    for mid, why in failed:
        f.write("| %s | `%s` |\n" % (mid, why.replace("|", "\\|").replace("`", "'")))
    f.write("\n## Not built\n\n| Module | Why |\n|---|---|\n")
    for mid, why in skipped:
        f.write("| %s | %s |\n" % (mid, why))
    f.write("\n## Built\n\n%s\n" % ", ".join(built))
print("%d built, %d failed, %d not built -> %s" % (len(built), len(failed), len(skipped), out))
