#!/usr/bin/env python3
"""Writes a compile recipe for every catalog module, for Push 3 (x86_64).

A module repo's own scripts/build.sh is READ, never run: this takes from it
the source files it compiles, the -I/-D flags, the language standards and the
libraries, and writes a plain recipe (build/recipes/<id>.sh) that compiles
those sources with the x86_64 compiler and copies the module's data files.
A recipe can be read before it runs; a module this cannot handle gets a
hand-written one in scripts/recipes/<id>.sh, which wins.

    gen-recipes.py <catalog.json> <modsrc> <out recipes dir>

The recipes run in the builder container (scripts/build-all.sh): /modsrc is
the sources (read only), /out the module tree.
"""
import glob
import json
import os
import re
import shlex
import sys

catalog, modsrc, outdir = sys.argv[1:4]
here = os.path.dirname(os.path.abspath(__file__))
hand = os.path.join(here, "recipes")
os.makedirs(outdir, exist_ok=True)

SRC_EXT = (".c", ".cc", ".cpp", ".cxx")
NOT_DATA = SRC_EXT + (".h", ".hpp", ".hh", ".hxx", ".inc", ".ipp", ".o", ".a", ".s", ".S", ".rs",
                      ".dsp", ".cmake", ".mk", ".so", ".py", ".sh", ".toml", ".lock")
SYS_HEADERS = {"string.h", "math.h", "stdio.h", "stdlib.h", "time.h", "memory.h", "assert.h", "limits.h",
               "stdint.h", "float.h", "random.h", "signal.h", "complex.h", "locale.h", "errno.h"}
SUBDIR = {"sound_generator": "sound_generators", "audio_fx": "audio_fx", "midi_fx": "midi_fx",
          "utility": "utilities", "overtake": "overtake", "tool": "tools"}
# flags kept from a build script; everything else (ARM tuning, -g, -W...) is dropped.
# Not -fvisibility=hidden: a script applies it to SOME files (an engine, one
# module of several) and merged over all of them it hides the entry point;
# under RTLD_LOCAL it buys nothing.
KEEP_F = {"-fno-exceptions", "-fno-rtti", "-ffast-math", "-fno-finite-math-only", "-fwrapv",
          "-fpermissive", "-fno-strict-aliasing",
          "-fno-math-errno", "-funroll-loops", "-fno-gnu-unique", "-fopenmp"}


def module_json(repo, mid):
    """The module.json with this id. Some repos carry two (a root copy and
    src/): the one beside a dsp/ folder, else under src/, wins."""
    hits = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "dist")]
        if "module.json" in files:
            p = os.path.join(root, "module.json")
            try:
                if json.load(open(p)).get("id") == mid:
                    hits.append(p)
            except Exception:
                pass
    hits.sort(key=lambda p: (not os.path.isdir(os.path.join(os.path.dirname(p), "dsp")),
                             "/src/" not in p + "/", len(p)))
    return hits[0] if hits else None


def repo_files(repo):
    out = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in (".git", "dist")]
        for f in files:
            out.append(os.path.relpath(os.path.join(root, f), repo))
    return out


def resolve(token, files, repo, prefer, want_dir=False):
    """A path as a build script writes it ($REPO_ROOT/src/dsp/x.c, "$DSP"/x.c,
    src/dsp/*.c) -> paths in the repo (relative), [] if none."""
    t = token.strip("\"'")
    for _ in range(4):  # the script's own assignments (BUNGEE_DIR=src/dsp/bungee)
        t2 = re.sub(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}?", lambda m_: VARS.get(m_.group(1), m_.group(0)), t)
        if t2 == t:
            break
        t = t2
    t = re.sub(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/?", "", t)   # drop variables
    t = t.lstrip("./")
    if not t:
        return []
    if any(c in t for c in "*?["):
        hits = sorted(os.path.relpath(p, repo) for p in glob.glob(os.path.join(repo, t), recursive=True))
        if not hits:  # the glob relative to the module dir
            hits = sorted(os.path.relpath(p, repo) for p in glob.glob(os.path.join(repo, prefer, t)))
        return hits
    if want_dir:
        t = t.rstrip("/")
        for base in ("", prefer, "src"):
            p = os.path.normpath(os.path.join(base, t))
            if os.path.isdir(os.path.join(repo, p)):
                return [p]
        # a folder behind a variable ("$FLUID/include"): by its path's end
        dirs = sorted({os.path.dirname(f) for f in files})
        hits = [d for d in dirs if d == t or d.endswith("/" + t)]
        near = [d for d in hits if d.startswith(prefer)]
        return (near or hits)[:2]
    if t in files:
        return [t]
    cands = [f for f in files if f == t or f.endswith("/" + t)]
    if len(cands) > 1:
        near = [f for f in cands if f.startswith(prefer)]
        cands = near or cands
    return cands[:1]


VARS = {}


def script_vars(text):
    """Plain assignments in a build script: NAME=value, value without a
    command substitution. ${NAME:-default} with no assignment takes the default."""
    v = {}
    for line in text.splitlines():
        m_ = re.match(r"^\s*(?:export\s+|local\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=(\"([^\"]*)\"|'([^']*)'|([^\s;]*))\s*(?:#.*)?$", line)
        if m_ and "$(" not in m_.group(2) and "`" not in m_.group(2):
            val = next(g for g in (m_.group(3), m_.group(4), m_.group(5)) if g is not None)
            if not re.search(r"\s", val.strip()) and val:
                v.setdefault(m_.group(1), val)
    for m_ in re.finditer(r"\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}$]+)\}", text):
        v.setdefault(m_.group(1), m_.group(2))
    return v


def script_text(repo, mdir):
    texts = []
    paths = [os.path.join(repo, "scripts", "build.sh")] + sorted(glob.glob(os.path.join(repo, "scripts", "*build*.sh"))) + \
        sorted(glob.glob(os.path.join(repo, "*.sh"))) + \
        [os.path.join(repo, "Makefile"), os.path.join(repo, mdir, "Makefile")]
    for p in dict.fromkeys(paths):
        if os.path.isfile(p) and not os.path.basename(p).startswith(("install", "release", "deploy")):
            texts.append(open(p, errors="replace").read())
    s = "\n".join(texts)
    s = re.sub(r"\\\n", " ", s)                        # continued lines
    s = "\n".join(l for l in s.splitlines() if not l.lstrip().startswith("#"))
    return s


def gen(m):
    mid = m["id"]
    repo_name = m["github_repo"].split("/")[1]
    repo = os.path.join(modsrc, repo_name)
    mj = module_json(repo, mid)
    if not mj:
        # a release-only repo (release.json, no source): the source may sit
        # in a sibling repo of the same author (schwung-work holds work-in)
        for other in sorted(os.listdir(modsrc)):
            o = os.path.join(modsrc, other)
            if o != repo and os.path.isdir(o) and os.path.exists(os.path.join(o, ".git")):
                mj = module_json(o, mid)
                if mj:
                    repo, repo_name = o, other
                    break
    if not mj:
        return {"id": mid, "status": "skip", "why": "no source published (release-only repo)"}
    mjrel = os.path.relpath(mj, repo)
    mdir = os.path.dirname(mjrel)
    j = json.load(open(mj))
    sub = SUBDIR.get(j.get("component_type") or m["component_type"], "other")
    files = repo_files(repo)
    text = script_text(repo, mdir)
    VARS.clear()
    VARS.update(script_vars(text))

    srcs, incs, defs, libs, flags, forced = [], [], [], [], [], []
    prev_was_include = [False]
    cstd = cxxstd = None
    opt = "-O3"
    # for f in resample resamplesubs filterkit; do ... src/${f}.c : expand
    loops = {}
    for m_ in re.finditer(r"\bfor\s+([A-Za-z_]\w*)\s+in\s+([^;\n$`]+?)\s*;?\s*(?:do\b|\n)", text):
        words = m_.group(2).split()
        if words and all(re.fullmatch(r"[\w./+-]+", w) for w in words):
            loops[m_.group(1)] = words
    toks = []
    for line in text.splitlines():
        cc_line = bool(re.search(r"gcc|g\+\+|clang|\$\{?CC\b|\$\{?CXX\b|LDFLAGS|LDLIBS|LIBS\b", line))
        for t in re.findall(r"[^\s;|&()]+", line):
            lv = [v for v in loops if re.search(r"\$\{?%s\b\}?" % v, t)]
            if lv:
                toks += [(re.sub(r"\$\{?%s\b\}?" % lv[0], w, t), cc_line) for w in loops[lv[0]]]
            else:
                toks.append((t, cc_line))
    for tok, cc_line in toks:
        tok = re.sub(r"^[A-Za-z_][A-Za-z0-9_]*\+?=", "", tok)  # FLAGS="-Isrc ... : the flags in it
        raw = tok
        tok = tok.strip("\"'")
        if tok.startswith("-D") and "=" in tok and (raw.count('"') % 2 or raw.count("'") % 2):
            continue  # half of a quoted define (-DNAME="a b"): not safe to keep
        if prev_was_include[0]:
            prev_was_include[0] = False
            if re.fullmatch(r"[\w./]+\.h(pp)?", tok) and ("-include", tok) not in forced:
                forced.append(("-include", tok))
            continue
        if tok == "-include":
            prev_was_include[0] = True
            continue
        if re.search(r"\.(c|cc|cpp|cxx)$", tok) and not tok.startswith("-"):
            for f in resolve(tok, files, repo, mdir):
                if f.endswith(SRC_EXT) and f not in srcs:
                    srcs.append(f)
        elif tok.startswith("-I") and len(tok) > 2:
            for d in resolve(tok[2:], files, repo, mdir, want_dir=True):
                if d not in incs:
                    incs.append(d)
        elif tok.startswith("-D") and "$" not in tok and len(tok) > 2:
            if tok not in defs:
                defs.append(tok)
        elif tok.startswith("-std="):
            if "++" in tok:
                cxxstd = tok
            else:
                cstd = tok
        elif re.fullmatch(r"-l[A-Za-z0-9_+.-]{2,}", tok) and cc_line:
            if tok not in libs and tok not in ("-lm", "-lpthread", "-ldl"):
                libs.append(tok)
        elif tok in KEEP_F and tok not in flags:
            flags.append(tok)
        elif tok in ("-Ofast", "-O2", "-O3"):
            opt = tok if tok == "-Ofast" or opt != "-Ofast" else opt
        elif tok in ("-static-libstdc++", "-static-libgcc") and tok not in flags:
            flags.append(tok)
    native = [f for f in files if f.endswith(SRC_EXT)]
    dsp_name = j.get("dsp") or ("dsp.so" if native else "")
    if not srcs and native and dsp_name:
        # no list in the script: everything under the module's dsp folder
        base = os.path.join(mdir, "dsp")
        srcs = [f for f in native if f.startswith(base + "/")]
        if not srcs:  # sources beside module.json (src/dsp.c)
            srcs = [f for f in native if os.path.dirname(f) == mdir]
    if dsp_name and not srcs:
        return {"id": mid, "status": "skip", "why": "native, but no sources found (needs a hand recipe)"}
    # The command that writes this module's .so names its own sources: a repo
    # building several modules, tests or tools lists them all.
    own = []
    for line in text.splitlines():
        for o in re.findall(r"-o\s+(\S+)", line):
            o = o.strip("\"'")
            if dsp_name and os.path.basename(o) == os.path.basename(dsp_name):
                ss = []
                for t in re.findall(r"[^\s;|&()]+", line):
                    t = t.strip("\"'")
                    if re.search(r"\.(c|cc|cpp|cxx)$", t) and not t.startswith("-"):
                        ss += [f for f in resolve(t, files, repo, mdir) if f not in ss]
                if ss:
                    score = 2 if re.search(r"(^|/)%s/" % re.escape(mid), o) else 1
                    own.append((score, ss))
    # Only a script that writes .so files for SEVERAL modules needs narrowing;
    # in a one-module script the final link names the plugin file and the
    # libraries compiled in earlier steps come in as .o/.a, so it is not the list.
    so_outs = {o.strip("\"'") for o in re.findall(r"-o\s+(\S+\.so)\b", text)}
    if len({os.path.dirname(o) for o in so_outs}) <= 1:
        own = []
    if own:
        top = max(sc for sc, _ in own)
        mine = [ss for sc, ss in own if sc == top]
        if top == 2 or len(mine) == 1:
            srcs = mine[0]
    else:
        # a test, a benchmark or a tool: a main() is never part of a module
        srcs = [f for f in srcs if not re.search(r"^\s*int\s+main\s*\(", open(os.path.join(repo, f), errors="replace").read(), re.M)]
    # every folder an #include needs (a vendored library's "clouds/dsp/frame.h")
    SYS = SYS_HEADERS
    by_tail = {}
    for f in files:
        if f.endswith((".h", ".hpp", ".hh", ".hxx", ".inc", ".ipp", ".tcc")) or "." not in os.path.basename(f):
            by_tail.setdefault(os.path.basename(f), []).append(f)
    seen, queue = set(), list(srcs)
    while queue and len(seen) < 6000:
        f = queue.pop()
        if f in seen:
            continue
        seen.add(f)
        try:
            body = open(os.path.join(repo, f), errors="replace").read()
        except OSError:
            continue
        for quote, inc in re.findall(r'^\s*#\s*include\s*([<"])([^>"]+)[>"]', body, re.M):
            if quote == "<" and "/" not in inc:
                continue  # a system header
            here_ = os.path.normpath(os.path.join(os.path.dirname(f), inc))
            if here_ in seen or os.path.isfile(os.path.join(repo, here_)):
                queue.append(here_)
                continue
            hit = None
            for i in incs:
                c = os.path.normpath(os.path.join(i, inc))
                if os.path.isfile(os.path.join(repo, c)):
                    hit = c
                    break
            if not hit:
                cands = [c for c in by_tail.get(os.path.basename(inc), []) if c == inc or c.endswith("/" + inc)]
                if cands:
                    hit = sorted(cands, key=len)[0]
                    d = hit[: len(hit) - len(inc)].rstrip("/")
                    names = {os.path.basename(x) for x in files if os.path.dirname(x) == d}
                    if d not in incs and not (names & SYS):
                        incs.append(d)
            if hit:
                queue.append(hit)
    # the headers' folders next to the sources, and the module dir
    for f in srcs:
        d = os.path.dirname(f)
        names = {os.path.basename(x) for x in files if os.path.dirname(x) == d}
        if d not in incs and not (names & SYS_HEADERS):  # a folder with its own string.h shadows libc's
            incs.append(d)
    defs = [d for d in defs if not re.search(r"ARM|NEON|AARCH64|__aarch64", d, re.I)]

    q = shlex.quote
    L = ["#!/usr/bin/env bash",
         "# generated by scripts/gen-recipes.py from %s/scripts/build.sh (read, not run)" % repo_name,
         "set -euo pipefail",
         "R=/modsrc/%s; D=/out/%s/%s; T=/tmp/b-%s" % (q(repo_name), sub, q(mid), q(mid)),
         'rm -rf "$D" "$T"; mkdir -p "$D" "$T"',
         ]
    targets = re.findall(r"--target\s+([^\n]+)", text)
    cmake = dsp_name and os.path.isfile(os.path.join(repo, "CMakeLists.txt")) and re.search(r"\bcmake\b", text)
    if cmake:
        # its own CMake project, configured for this machine (no ARM toolchain file)
        tg = []
        for t in targets:
            for w in t.split():
                w = w.strip("\"'")
                if w.startswith("-") or w.startswith("2>"):
                    break
                tg.append("all" if "$" in w else w)
        tg = list(dict.fromkeys(tg)) or ["all"]
        # from a writable copy: projects write into their tree (configure_file, symlinks)
        L.append('cp -a "$R" "$T"/src')
        L.append('cmake -S "$T"/src -B "$T"/build -G Ninja -DCMAKE_BUILD_TYPE=Release '
                 '-DCMAKE_C_FLAGS="-march=x86-64-v2 -mtune=generic -I/schwung/src -I/schwung/src/host" '
                 '-DCMAKE_CXX_FLAGS="-march=x86-64-v2 -mtune=generic -fno-gnu-unique -I/schwung/src -I/schwung/src/host" '
                 '-DCMAKE_POSITION_INDEPENDENT_CODE=ON')
        L.append('cmake --build "$T"/build --target %s -j4' % " ".join(q(t) for t in tg))
        L.append('mkdir -p "$(dirname "$D"/%s)"' % q(dsp_name))
        L.append('so=$(find "$T"/build -name %s -type f | head -1); [ -n "$so" ] || so=$(find "$T"/build -maxdepth 2 -name "*.so" -type f | head -1)'
                 % q(os.path.basename(dsp_name)))
        L.append('cp "$so" "$D"/%s' % q(dsp_name))
        # helper programs the module ships beside its .so (a DSP process, ...)
        for t in tg:
            if t != "all":
                L.append('h=$(find "$T"/build -maxdepth 2 -name %s -type f -perm -u+x | head -1); [ -z "$h" ] || cp "$h" "$D"/' % q(t))
    elif dsp_name:
        inc = " ".join('-I"$R"/%s' % q(i) if i else '-I"$R"' for i in incs)
        # Schwung's host headers (plugin_api_v1.h, host/midi_fx_api_v1.h), the
        # same the Push's chain host is built from; the module's own copies first
        inc += " -I/schwung/src -I/schwung/src/host"
        fi = " ".join("-include %s" % q(h) for _, h in forced)
        common = "%s -march=x86-64-v2 -mtune=generic -fPIC -DNDEBUG %s %s %s %s" % (opt, " ".join(flags), " ".join(q(d) for d in defs), fi, inc)
        L.append("CF=(%s)" % common)
        for i, f in enumerate(srcs):
            if f.endswith(".c"):
                L.append('gcc "${CF[@]}" %s -c "$R"/%s -o "$T"/%d.o' % (cstd or "-std=gnu11", q(f), i))
            else:
                L.append('g++ "${CF[@]}" %s -fno-gnu-unique -c "$R"/%s -o "$T"/%d.o' % (cxxstd or "-std=gnu++17", q(f), i))
        linker = "g++" if any(not f.endswith(".c") for f in srcs) else "gcc"
        L.append('mkdir -p "$(dirname "$D"/%s)"' % q(dsp_name))
        L.append('%s -shared "$T"/*.o -o "$D"/%s %s %s -lm -lpthread -ldl' % (linker, q(dsp_name), " ".join(flags), " ".join(libs)))
    # data: the module dir, minus sources and build files
    L.append('( cd "$R"/%s && find . -path ./dsp -prune -o -type f -print | grep -Ev %s | '
             'while read -r f; do mkdir -p "$D/$(dirname "$f")"; cp "$f" "$D/$f"; done )'
             % (q(mdir or "."), q(r"\.(" + "|".join(e.lstrip(".") for e in NOT_DATA) + r")$|/\.git/|/(build|dist|tests?|node_modules)/")))
    for f in ("LICENSE", "LICENSE.md", "LICENSE.txt", "THIRD_PARTY_LICENSES", "THIRD_PARTY_LICENSES.md", "NOTICE"):
        L.append('[ -f "$R"/%s ] && cp "$R"/%s "$D"/ || true' % (f, f))
    # what the script copies into the module's folder besides the build output:
    # banks, presets, and renamed files (src/ui_overtake.js -> <id>/ui.js)
    idre = re.compile(r"(^|/)%s(/|$)" % re.escape(mid))
    for line in text.splitlines():
        if not re.search(r"(^|\s)cp\s", line):
            continue
        try:
            toks = shlex.split(line[line.index("cp"):], posix=True)
        except ValueError:
            toks = line[line.index("cp"):].split()
        args = [t for t in toks[1:] if not t.startswith("-")]
        if len(args) < 2 or any(c in args[-1] for c in ";&|"):
            continue
        dest = re.sub(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/?", "", args[-1]).rstrip("/")
        m_ = idre.search(dest)
        if m_:
            rest = dest[m_.end():].lstrip("/")
        elif "dist" in line:
            rest = ""
        else:
            continue
        for a_ in args[:-1]:
            ps = resolve(a_, files, repo, mdir, want_dir=True) or resolve(a_, files, repo, mdir)
            for p_ in ps:
                if p_.endswith((".so", ".o", ".a")) or p_.startswith(mdir + "/dsp/"):
                    continue
                if rest and len(args) == 2 and os.path.isfile(os.path.join(repo, p_)) and not args[-1].endswith("/") \
                        and not os.path.isdir(os.path.join(repo, mdir, rest)):
                    L.append('mkdir -p "$(dirname "$D"/%s)"; cp "$R"/%s "$D"/%s' % (q(rest), q(p_), q(rest)))
                elif rest and len(args) == 2 and os.path.isdir(os.path.join(repo, p_)) and not args[-1].endswith("/"):
                    # cp -R src/remote/assets <id>/assets: the folder BECOMES
                    # assets; copied as "into", it nested (assets/assets) when
                    # the folder already existed, as cp -R does
                    L.append('mkdir -p "$D"/%s; cp -R "$R"/%s/. "$D"/%s/' % (q(rest), q(p_), q(rest)))
                else:
                    L.append('mkdir -p "$D"/%s; cp -R "$R"/%s "$D"/%s 2>/dev/null || true' % (q(rest or "."), q(p_), q(rest or ".")))
    L.append('rm -rf "$T"')
    open(os.path.join(outdir, mid + ".sh"), "w").write("\n".join(L) + "\n")
    return {"id": mid, "status": "recipe", "native": bool(dsp_name), "cmake": bool(cmake), "sources": len(srcs), "subdir": sub,
            "repo": repo_name, "dsp": dsp_name}


rows = []
for m in json.load(open(catalog))["modules"]:
    try:
        r = gen(m)  # written even when a hand recipe wins: a hand recipe may build on it
    except Exception as e:
        r = {"id": m["id"], "status": "skip", "why": "generator: %s" % e}
    if os.path.isfile(os.path.join(hand, m["id"] + ".sh")):
        r["status"] = "hand"
    rows.append(r)
json.dump(rows, open(os.path.join(outdir, "index.json"), "w"), indent=1)
for r in rows:
    if r["status"] == "skip":
        print("skip %-20s %s" % (r["id"], r["why"]))
print("%d recipes, %d hand, %d skipped" % (sum(r["status"] == "recipe" for r in rows),
                                           sum(r["status"] == "hand" for r in rows),
                                           sum(r["status"] == "skip" for r in rows)))
