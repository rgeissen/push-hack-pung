#!/usr/bin/env python3
"""Surveys the catalog module sources: what each one needs to build for Push.

Reads (never runs) each repo's files. For every catalog module prints one JSON
line: id, repo, type, where its module.json is, whether it has native DSP,
the DSP file name it declares, the source languages, and the compiler and
tool lines of its own build script (to write a recipe from).

    survey-catalog.py <catalog.json> <modsrc dir> > survey.jsonl
"""
import json
import os
import re
import sys

catalog, modsrc = sys.argv[1], sys.argv[2]
mods = json.load(open(catalog))["modules"]

COMPILE = re.compile(r"(g\+\+|gcc|clang|\$\{?CXX\}?|\$\{?CC\}?|cmake|make\b|cargo|faust|rnbo|zig|go build)", re.I)


def find_module_jsons(repo):
    out = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "dist", "build", "third_party", "libs", "external")]
        if "module.json" in files:
            out.append(os.path.join(root, "module.json"))
    return out


for m in mods:
    repo = os.path.join(modsrc, m["github_repo"].split("/")[1])
    e = {"id": m["id"], "repo": os.path.basename(repo), "type": m["component_type"], "requires": m.get("requires", "")}
    if not os.path.isdir(repo):
        e["missing"] = True
        print(json.dumps(e))
        continue
    mj = None
    for p in find_module_jsons(repo):
        try:
            j = json.load(open(p))
        except Exception:
            continue
        if j.get("id") == m["id"]:
            mj = (p, j)
            break
    if mj:
        e["module_json"] = os.path.relpath(mj[0], repo)
        e["dsp"] = mj[1].get("dsp") or ""
        caps = mj[1].get("capabilities") or {}
        e["chainable"] = bool(caps.get("chainable"))
    langs = {}
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d != ".git"]
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in (".c", ".cc", ".cpp", ".cxx", ".rs", ".dsp", ".s", ".S", ".go", ".zig"):
                langs[ext] = langs.get(ext, 0) + 1
    e["langs"] = langs
    bs = os.path.join(repo, "scripts", "build.sh")
    if os.path.isfile(bs):
        lines = [l.strip() for l in open(bs, errors="replace") if COMPILE.search(l) and not l.strip().startswith("#")]
        e["build_lines"] = lines[:40]
    for f in ("CMakeLists.txt", "Cargo.toml", "Makefile"):
        if os.path.exists(os.path.join(repo, f)):
            e.setdefault("tools", []).append(f)
    print(json.dumps(e))
