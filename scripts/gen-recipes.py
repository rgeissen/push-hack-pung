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


def is_elf(path):
    """A compiled program or library: built for this machine by a recipe,
    never copied from a repo (those are ARM builds, for Move)."""
    try:
        return open(path, "rb").read(4) == b"\x7fELF"
    except OSError:
        return False


def resolve(token, files, repo, prefer, want_dir=False):
    """A path as a build script writes it ($REPO_ROOT/src/dsp/x.c, "$DSP"/x.c,
    src/dsp/*.c) -> paths in the repo (relative), [] if none. An absolute path
    is the repo mounted in the script's container: for a pattern
    (/build/src/dsp/*.c) its first folders are dropped until the rest is in the
    repo. (Not for a single file: that is as often another target's, such as
    the Airwindows wrapper in schwung-airwindows' second script.)"""
    hits = _resolve(token, files, repo, prefer, want_dir)
    t = token.strip("\"'")
    while not hits and t.startswith("/") and t.count("/") > 1 and any(c in t for c in "*?["):
        t = "/" + t.split("/", 2)[2]
        hits = _resolve(t, files, repo, prefer, want_dir)
    return hits


def _resolve(token, files, repo, prefer, want_dir=False):
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


WASM = re.compile(r"\bemcc\b|\bem\+\+|wasm32|wasm64|-mexec-model")


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
    # a WebAssembly build (the browser synth beside the module: emcc, zig cc
    # -target wasm32) compiles its own host glue (web/wasm_host.c) with its own
    # defines (-DCREST_WASM) and often leaves the plugin file out: not this build
    s = "\n".join(l for l in s.splitlines() if not WASM.search(l))
    return s


PY_LINE = re.compile(r"""^\s*("?\$\{?(PYTHON3?|PY)\}?"?|python3?)\s+("?[^\s"]+\.py"?)(.*)$""")
ROOT_VARS = re.compile(r"ROOT|^REPO|^SRC$|^TOP$|^BASE$")


def generators(text, missing, files, repo, mdir):
    """The script's Python generators that write a header the sources include
    and the repo does not have (model-72's tools/gen_schwung.py writes
    src/schwung_meta.h; bizar's scripts/generate_factory_bank.py
    "$GENERATED_DIR/factory_bank.h"). One that names the header among its
    arguments, or one without arguments whose own text names it. Returns
    (command line, [(variable, value)], include folder or None) each; the
    command runs in the repo's root with the script's variables, its root
    variable ($ROOT, $REPO_ROOT) being the copy."""
    out = []
    if not missing:
        return out
    for line in text.splitlines():
        pm = PY_LINE.match(line)
        if not pm:
            continue
        args = pm.group(4).strip()
        script = resolve(pm.group(3), files, repo, mdir)
        if not script:
            continue
        names = [h for h in sorted(missing) if re.search(r"(^|[/\s\"'])%s\b" % re.escape(h), args)]
        if not names and not args:
            # a line of its own that opens the header for writing
            body = open(os.path.join(repo, script[0]), errors="replace").read()
            names = [h for h in sorted(missing)
                     if re.search(r"""^.*["'/]%s["'].*open\(|^.*open\(.*["'/]%s["'].*["']w""" % (re.escape(h), re.escape(h)), body, re.M)]
        if not names:
            continue
        # the variables it uses, the ones they use, in the script's order
        need, todo = set(), re.findall(r"\$\{?([A-Za-z_]\w*)", line)
        while todo:
            v = todo.pop()
            if v not in need:
                need.add(v)
                todo += re.findall(r"\$\{?([A-Za-z_]\w*)", VARS.get(v, ""))
        env, ok = [], True
        for v in [k for k in VARS if k in need]:
            env.append((v, '"%s"' % VARS[v].replace('"', '\\"')))
        for v in sorted(need - set(VARS)):
            if ROOT_VARS.search(v):
                env.insert(0, (v, '"$R"'))
            elif v not in ("PYTHON", "PYTHON3", "PY") and not re.search(r"\$\{%s:[-+]" % v, line + " ".join(VARS.values())):
                ok = False  # (one with a default, ${BANK:-}, is fine)
        if not ok:
            continue
        cmd = "python3 " + pm.group(3) + (" " + args if args else "")
        inc = None
        for raw in re.findall(r"[^\s]+", args):
            raw = raw.strip("\"'")
            if os.path.basename(raw) in names:
                # its folder, made first; as an include folder the copy's
                # relative path: the variables' values put in, the root
                # dropped ($GENERATED_DIR -> build/generated)
                cmd = 'mkdir -p "$(dirname "%s")"; %s' % (raw, cmd)
                a = raw
                for _ in range(4):
                    a = re.sub(r"\$\{?([A-Za-z_]\w*)\}?", lambda v_: VARS.get(v_.group(1), "$" + v_.group(1)), a)
                inc = os.path.dirname(re.sub(r"^\$\{?[A-Za-z_]\w*\}?/?", "", a).lstrip("./"))
                break
        out.append((cmd, env, inc))
    return out


def gen(m):
    mid = m["id"]
    if m.get("native"):
        # a Pung-native module (native/catalog.json): built by its hand recipe
        return {"id": mid, "status": "skip", "repo": m["modsrc"],
                "why": "a Pung-native module without scripts/recipes/%s.sh" % mid}
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
    # what Pung files it as: the module's own word for Pung, else its type
    sub = SUBDIR.get((j.get("pung") or {}).get("component_type") or j.get("component_type") or m["component_type"], "other")
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
    seen, queue, missing = set(), list(srcs), set()
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
            elif quote == '"':
                missing.add(os.path.basename(inc))
    gens = generators(text, missing, files, repo, mdir)
    for _, _, d in gens:
        if d is not None and d not in incs:
            incs.append(d)
    # the headers' folders next to the sources, and the module dir
    for f in srcs:
        d = os.path.dirname(f)
        names = {os.path.basename(x) for x in files if os.path.dirname(x) == d}
        if d not in incs and not (names & SYS_HEADERS):  # a folder with its own string.h shadows libc's
            incs.append(d)
    # ARM tuning, and a profiling build's switch (-DCREST_PROFILE, set by the
    # script's --profile option: "not for release")
    defs = [d for d in defs if not re.search(r"ARM|NEON|AARCH64|__aarch64", d, re.I)
            and not re.match(r"-D\w*PROFIL(E|ING)(=|$)", d)]

    q = shlex.quote
    L = ["#!/usr/bin/env bash",
         "# generated by scripts/gen-recipes.py from %s/scripts/build.sh (read, not run)" % repo_name,
         "set -euo pipefail",
         "R=/modsrc/%s; D=/out/%s/%s; T=/tmp/b-%s" % (q(repo_name), sub, q(mid), q(mid)),
         'rm -rf "$D" "$T"; mkdir -p "$D" "$T"',
         ]
    if gens:
        # headers the script generates before it compiles (schwung_meta.h,
        # factory_bank.h): its own generator, run on a writable copy, offline
        L.append('cp -a "$R" "$T"/gen; R="$T"/gen')
        for line, env, _ in gens:
            L.append('( cd "$R"; %s%s )' % ("".join("%s=%s; " % (k, v) for k, v in env), line))
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
        L.append('cmake --build "$T"/build --target %s -j"${BUILD_JOBS:-4}"' % " ".join(q(t) for t in tg))
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
    # a repository that builds several modules copies each one's files into its own folder (Maze: maze_seq,
    # maze_seq_lite, maze-voice). Those of the others are not this module's: taken along, the last
    # module.json won, and Maze Seq Lite went out with Maze Voice's (it could not be installed, 0.5.0).
    others = [o for o in SIBLINGS.get(m["github_repo"], []) if o != mid]
    otherre = re.compile(r"(^|/)(%s)(/|$)" % "|".join(re.escape(o) for o in others)) if others else None
    loops = {}  # a for loop's variable -> what it runs over (for f in banks/*.syx)
    for line in text.splitlines():
        for lm in re.finditer(r"\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;]+?)\s*(?:;|$)", line):
            loops[lm.group(1)] = lm.group(2).split()
        # cat <file> > dist/<id>/<to>: these scripts' other way to copy (it
        # keeps the target's mode). Dexed's banks, Airwindows' plugins and
        # most licence texts are packed so, many of them in a loop
        cm_ = re.search(r"(?:^|&&|;|\bdo)\s*cat\s+(\"[^\"]+\"|\S+)\s*>\s*(.+?)\s*(?:;\s*done\s*)?$", line)
        if cm_:
            # the target ends where the command does (cat a > "b" || true)
            to_ = re.split(r"\s+(?:\|\||&&)\s+|\s*;\s*", cm_.group(2))[0]
            src_, to_ = cm_.group(1).strip("\"'"), to_.strip().strip("\"'")
            for _ in range(4):
                to_ = re.sub(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?", lambda v_: VARS.get(v_.group(1), v_.group(0)), to_)
            hit = re.search(r"(^|/)dist/%s/(.+)$" % re.escape(mid), to_)
            var = re.fullmatch(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?", src_)
            if hit and var and var.group(1) in loops and re.search(r"/\$\(basename [^)]*\)$", hit.group(2)):
                # a loop over files, each to the folder under its own name
                folder = re.sub(r"/\$\(basename [^)]*\)$", "", hit.group(2))
                for g_ in loops[var.group(1)]:
                    got = [p_ for p_ in resolve(g_, files, repo, mdir) if os.path.isfile(os.path.join(repo, p_))
                           and not p_.endswith(NOT_DATA) and not is_elf(os.path.join(repo, p_))]
                    if got:
                        L.append('mkdir -p "$D"/%s' % q(folder))
                    for p_ in got:
                        L.append('cp "$R"/%s "$D"/%s/' % (q(p_), q(folder)))
            elif hit and not var and "$" not in hit.group(2):
                for p_ in resolve(src_, files, repo, mdir)[:1]:
                    if os.path.isfile(os.path.join(repo, p_)) and not p_.endswith(NOT_DATA) and not p_.startswith(mdir + "/dsp/") \
                            and not is_elf(os.path.join(repo, p_)):
                        L.append('mkdir -p "$(dirname "$D"/%s)"; cp "$R"/%s "$D"/%s' % (q(hit.group(2)), q(p_), q(hit.group(2))))
            continue
        # what the script removes from the module's folder, in the script's
        # own order: before a copy it clears a stale folder (JE-8086's
        # assets), after one it drops part of what was copied (Surge: the
        # patch categories that need parts this build has not)
        rm_ = re.match(r"\s*rm\s+-[rf]+\s+(\S+)\s*(#.*)?$", line)
        if rm_:
            gone = re.sub(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/?", "", rm_.group(1).strip("\"'")).rstrip("/")
            hit = re.search(r"(^|/)dist/%s/(.+)$" % re.escape(mid), gone)
            if hit and ".." not in hit.group(2):
                L.append('rm -rf "$D"/%s' % q(hit.group(2)))
            continue
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
        elif otherre and otherre.search(dest):
            continue  # into another module's folder
        elif "dist" in line:
            rest = ""
        else:
            continue
        for a_ in args[:-1]:
            ps = resolve(a_, files, repo, mdir, want_dir=True) or resolve(a_, files, repo, mdir)
            for p_ in ps:
                if p_.endswith((".so", ".o", ".a")):
                    continue
                # under dsp/ the sources are not data; what the script copies
                # out of it by name is (Surge's factory patches and wavetables
                # live in its engine's tree: left out, the synth had no sounds)
                if p_.startswith(mdir + "/dsp/") and (p_.endswith(NOT_DATA) or p_.rstrip("/") == mdir + "/dsp"):
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
SIBLINGS = {}  # the modules each repository builds
for m in json.load(open(catalog))["modules"]:
    SIBLINGS.setdefault(m["github_repo"], []).append(m["id"])
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
