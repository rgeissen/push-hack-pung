#!/usr/bin/env python3
"""Builds Pung's public module catalog from a module build.

    build-catalog.py [--base-url URL] [--out DIR] [ids...]

Reads build/push-modules/{index.json,dist} (scripts/build-push-modules.sh),
the sources they were built from (build/modsrc), the recipes that built them
(build/recipes, scripts/recipes) and scripts/catalog-policy.json, and writes
<out> (default build/catalog), the tree published at <base-url>:

  catalog.json                    what Pung's Modules page reads
  index.html                      the same for people: every module, its
                                  licence, its source
  modules/<id>-<ver>-push-x86_64.tar.gz
                                  the module, plus <id>/LICENSES/ (its licence
                                  texts, and those of what it bundles) and
                                  <id>/PUNG-BUILD/ (how it was built: source,
                                  commit, recipe, build image)
  source/<id>-<ver>-<commit>-src.tar.gz
                                  the complete source it was built from,
                                  beside the binary (GPL-3.0 section 6(d)):
                                  the module's repository at that commit
                                  (submodules included), the recipe, the build
                                  image's Dockerfile, the Schwung headers it
                                  compiles against
  REPORT.md                       what was published, withheld, and why

Only modules whose licence is known are published (catalog-policy.json).
Never ROMs: a module's asset folders (module.json "assets", the files a user
adds) are left out of both archives, and the build fails if one slips in.
"""
import argparse
import datetime
import glob
import gzip
import hashlib
import html
import io
import json
import os
import re
import subprocess
import sys
import tarfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# where things are: this checkout's build/ by default, the catalog service's
# data folder on the DiskStation (catalog-service/)
SCHWUNG = os.environ.get("PUNG_SCHWUNG") or os.path.abspath(os.path.join(ROOT, "..", "schwung"))
WORK = os.environ.get("PUNG_WORK") or os.path.join(ROOT, "build")

ap = argparse.ArgumentParser()
ap.add_argument("--base-url", required=True, help="the public address the catalog is served from")
ap.add_argument("--out", default=os.path.join(WORK, "catalog"))
ap.add_argument("ids", nargs="*")
args = ap.parse_args()

BUILD = os.path.join(WORK, "push-modules")
# what Schwung's own catalogue says about each module: its category and tags
# (module-catalog.json, MIT), and its release history (schwung.dev's public
# release metadata, cached in build/; optional)
SCHWUNG_CAT, SCHWUNG_TAXONOMY = {}, {}
try:
    _sc = json.load(open(os.path.join(SCHWUNG, "module-catalog.json")))
    SCHWUNG_CAT = {x["id"]: x for x in _sc["modules"]}
    SCHWUNG_TAXONOMY = _sc.get("taxonomy", {})
except (OSError, ValueError, KeyError):
    pass
# Pung-native modules (native/catalog.json) carry their category and tags themselves
try:
    for _x in json.load(open(os.path.join(ROOT, "native", "catalog.json")))["modules"]:
        SCHWUNG_CAT[_x["id"]] = _x
except (OSError, ValueError, KeyError):
    pass
RELEASES = {}
_rel = os.path.join(WORK, "schwung-release-metadata.json")
try:
    if not os.path.exists(_rel) or os.path.getmtime(_rel) < datetime.datetime.now().timestamp() - 86400:
        import urllib.request
        with urllib.request.urlopen("https://schwung.dev/data/release-metadata.json", timeout=20) as r:
            open(_rel, "wb").write(r.read())
    RELEASES = json.load(open(_rel))
except Exception as e:  # noqa: BLE001 - dates are a nicety
    print(f"  (release dates unavailable: {e})")
MODSRC = os.path.join(WORK, "modsrc")
index = json.load(open(os.path.join(BUILD, "index.json")))
policy = json.load(open(os.path.join(ROOT, "scripts", "catalog-policy.json")))
out = args.out
for d in ("modules", "source"):
    os.makedirs(os.path.join(out, d), exist_ok=True)

LICENCE_FILE = re.compile(r"(?i)^(licen[sc]e|copying|notice|unlicense)([._-].*)?$")
SKIP_DIRS = {".git", "node_modules", "__pycache__"}


def spdx_of_text(t):
    """A licence's SPDX id from its text, as far as the text says it."""
    u = t.upper()
    if "AFFERO GENERAL PUBLIC LICENSE" in u:
        return "AGPL-3.0"
    if "LESSER GENERAL PUBLIC LICENSE" in u or "LIBRARY GENERAL PUBLIC" in u:
        return "LGPL-2.1" if "VERSION 2.1" in u else "LGPL-3.0" if "VERSION 3" in u else "LGPL"
    if "GNU GENERAL PUBLIC LICENSE" in u:
        return "GPL-3.0" if "VERSION 3" in u else "GPL-2.0" if "VERSION 2" in u else "GPL"
    if "ATTRIBUTION-NONCOMMERCIAL-SHAREALIKE" in u:
        return "CC-BY-NC-SA-4.0"
    if "PERMISSION IS HEREBY GRANTED, FREE OF CHARGE" in u:
        return "MIT"
    if "APACHE LICENSE" in u:
        return "Apache-2.0"
    if "MOZILLA PUBLIC LICENSE" in u:
        return "MPL-2.0"
    if "REDISTRIBUTIONS MAY NOT BE SOLD" in u:
        return "LicenseRef-MAME-noncommercial"
    if "REDISTRIBUTION AND USE IN SOURCE AND BINARY" in u:
        return "BSD"
    if "UNLICENSE" in u or "PUBLIC DOMAIN" in u:
        return "Unlicense"
    return None


def noncommercial(spdx, text):
    """A licence that forbids commercial use. Not the GPL: its text says
    "noncommercially" (section 6c, about how source may be offered)."""
    return bool(re.search(r"(?i)non-?commercial|(^|-)NC(-|$)", spdx or "")) or \
        bool(re.search(r"NonCommercial|may not be sold|used in a commercial product", text))


def module_json(src):
    for p in (os.path.join(src, "src", "module.json"), os.path.join(src, "module.json")):
        if os.path.exists(p):
            try:
                return json.load(open(p))
            except ValueError:
                pass
    return {}


def licence_of(mid, src):
    """(spdx, noncommercial, how it is known, [licence files: (path in repo, abs)])"""
    files = []
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if LICENCE_FILE.match(f):
                p = os.path.join(dirpath, f)
                files.append((os.path.relpath(p, src), p))
    files.sort(key=lambda x: (x[0].count("/"), x[0]))
    root = [f for f in files if "/" not in f[0]]
    text = "".join(open(p, errors="ignore").read(20000) for _, p in root)
    over = policy["licence"].get(mid)
    if over:
        return over["spdx"], noncommercial(over["spdx"], text), "policy: " + over["note"], files
    declared = module_json(src).get("license", "")
    if declared:
        return declared, noncommercial(declared, text), "module.json", files
    if root:
        sp = spdx_of_text(text)
        if sp:
            return sp, noncommercial(sp, text), "licence file", files
    for p in glob.glob(os.path.join(src, "README*")):
        t = open(p, errors="ignore").read()
        m = re.search(r"(?im)^#+\s*licen[sc]e\s*\n+\s*(?:this project is licen[sc]ed under (?:the )?)?([A-Za-z0-9.+-]+)", t)
        if m and re.match(r"(?i)(mit|gpl|lgpl|bsd|apache|mpl)", m.group(1)):
            return m.group(1).rstrip("."), False, "README", files
    return None, False, "", files


def asset_dirs(mid, moddir_json):
    """The asset folders that hold FIRMWARE (ROMs): never published. An asset
    folder declares its files with sizes and checksums when it is firmware
    (Osirus, JE-8086, JV-880); one that does not is a place for the user's
    own banks, and may well ship the factory ones (OB-Xd's presets), which
    stay. A folder named roms is firmware whatever it declares."""
    a = moddir_json.get("assets")
    paths = []
    for x in (a if isinstance(a, list) else [a] if isinstance(a, dict) else []):
        firmware = any(f.get("size") or f.get("crc32") for f in (x.get("files") or []))
        if x.get("path") and (firmware or re.search(r"(?i)(^|/)roms?$", x["path"].strip("/"))):
            paths.append(x["path"].strip("/"))
            for f in x.get("folders", []) or []:
                if f.get("path"):
                    paths.append(os.path.join(x.get("path", ""), f["path"]).strip("/"))
    return paths


def git_files(src):
    """The files of a checkout as git knows them (tracked and new, not ignored),
    submodules included; None when src is not a git checkout."""
    if not os.path.exists(os.path.join(src, ".git")):
        return None  # a folder inside another checkout (a native module in build/): git would answer for that one
    try:
        top = subprocess.run(["git", "-C", src, "ls-files", "-co", "--exclude-standard", "-z"],
                             check=True, capture_output=True).stdout.split(b"\0")
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    files = [f.decode() for f in top if f]
    sub = subprocess.run(["git", "-C", src, "submodule", "foreach", "--recursive", "--quiet",
                          'git ls-files -co --exclude-standard | sed "s|^|$displaypath/|"'],
                         capture_output=True, text=True).stdout.splitlines()
    files += [f for f in sub if f]
    return [f for f in files if os.path.isfile(os.path.join(src, f))]


def walk_files(src):
    out = []
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS | {"build", "dist"}]
        for f in filenames:
            out.append(os.path.relpath(os.path.join(dirpath, f), src))
    return out


def is_asset(path, assets):
    p = path.replace("\\", "/")
    for a in assets:
        if p == a or p.startswith(a + "/") or ("/" + a + "/") in ("/" + p):
            return True
    return bool(re.search(r"(?i)(^|/)roms?/", p))


# Archives are reproducible: the same build gives the same bytes, so a
# package's checksum names its content. (They carried the build's time, and a
# rebuild published a catalog whose checksums the files on the server did not
# have: every install would have failed its check, 2026-11-15.)
EPOCH = int(os.environ.get("SOURCE_DATE_EPOCH", "1704067200"))


def add_bytes(tf, name, data, mode=0o644):
    ti = tarfile.TarInfo(name)
    ti.size, ti.mode, ti.mtime = len(data), mode, EPOCH
    tf.addfile(ti, io.BytesIO(data))


class reproducible:
    """tarfile.open(path, "w:gz") with no time in the gzip header, and every
    added file's time, owner and group fixed."""
    def __init__(self, path, level):
        self.f = open(path, "wb")
        self.gz = gzip.GzipFile(filename="", mode="wb", fileobj=self.f, compresslevel=level, mtime=0)
        self.tf = tarfile.open(fileobj=self.gz, mode="w", format=tarfile.GNU_FORMAT)

    def __enter__(self):
        tf = self.tf
        orig_add, orig_addfile = tf.add, tf.addfile

        def fix(ti):
            ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = EPOCH, 0, 0, "", ""
            return ti

        tf.add = lambda name, arcname=None, recursive=True: orig_add(name, arcname, recursive=recursive, filter=fix)
        tf.addfile = lambda ti, fileobj=None: orig_addfile(fix(ti), fileobj)
        return tf

    def __exit__(self, *a):
        self.tf.close()
        self.gz.close()
        self.f.close()


def recipe_files(mid):
    """The build's own steps for this module: the recipe and its helpers."""
    out = []
    for p in (os.path.join(WORK, "recipes", mid + ".sh"), os.path.join(ROOT, "scripts", "recipes", mid + ".sh")):
        if os.path.exists(p):
            out.append(p)
    hand = os.path.join(ROOT, "scripts", "recipes", mid + ".sh")
    if os.path.exists(hand):
        for helper in re.findall(r"_[a-z0-9_]+\.(?:sh|py)", open(hand).read()):
            hp = os.path.join(ROOT, "scripts", "recipes", helper)
            if os.path.exists(hp):
                out.append(hp)
    return out


def build_notes(m, spdx, how):
    s = m["source"]
    return f"""# How this package was built

Module:   {m['name']} ({m['id']}) {m['version']}
Source:   https://github.com/{s.get('github_repo', '')} at {s.get('commit', '')}
          (the complete source is published beside this package: {m['_source_url']})
Licence:  {spdx} ({how})

Built for Ableton Push 3 Standalone (x86_64, glibc 2.35) by Pung's module
build (scripts/build-push-modules.sh), in the Docker image whose Dockerfile is
in this folder (Dockerfile.modules), compiling against the Schwung host headers
(also in the source archive, pung-build/schwung-headers). The recipe that ran
is recipe-*.sh in this folder: it was read from the module's own build script,
not changed in substance. After linking, the program interpreter of each ELF
file was set to /lib/ld-linux-x86-64.so.2 (AbletonOS has no /lib64), by
scripts/fix-interp.py; the code itself is unchanged.
"""


def pkg_build_dir(tf, prefix, m, spdx, how):
    add_bytes(tf, prefix + "BUILD.md", build_notes(m, spdx, how).encode())
    add_bytes(tf, prefix + "SOURCE.json", json.dumps({"repo": m["source"].get("github_repo"),
                                                       "commit": m["source"].get("commit"),
                                                       "source": m["_source_url"]}, indent=2).encode())
    for p in recipe_files(m["id"]):
        tag = "recipe-" if os.path.basename(p) == m["id"] + ".sh" else "recipe-helper-"
        tf.add(p, prefix + tag + os.path.basename(p))
    df = os.path.join(ROOT, "docker", "Dockerfile.modules")
    if os.path.exists(df):
        tf.add(df, prefix + "Dockerfile.modules")
    fi = os.path.join(ROOT, "scripts", "fix-interp.py")
    if os.path.exists(fi):
        tf.add(fi, prefix + "fix-interp.py")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def safe(s):
    return re.sub(r"[^A-Za-z0-9._-]", "_", s)


published, withheld, problems = [], [], []

# Pung's packaging revisions (scripts/module-revisions.json): a module's own
# version says what its author released; the revision says Pung packed that
# release again. A device shows the same version with a higher revision as
# an update (modmgr.go), so a package may only change when one of them does.
REVS = {k: v for k, v in json.load(open(os.path.join(ROOT, "scripts", "module-revisions.json"))).items() if not k.startswith("_")}
OLD_CAT = {}
if os.path.exists(os.path.join(args.out, "catalog.json")):
    OLD_CAT = {e["id"]: e for e in json.load(open(os.path.join(args.out, "catalog.json")))["modules"]}
unrevised = []


def content_id(tar_path, commit=None):
    """What a package holds, for comparing two builds of one version: every
    file's name, the bytes of every file that is not a compiled program (a
    rebuild's binary may differ bit for bit and be the same program), and the
    source commit. The folders this script adds are left out."""
    h = hashlib.sha256()
    with tarfile.open(tar_path, "r:gz") as tf:
        for ti in sorted(tf.getmembers(), key=lambda t: t.name):
            rel = ti.name.split("/", 1)[1] if "/" in ti.name else ""
            if rel.startswith("PUNG-BUILD/") and rel.endswith("SOURCE.json") and commit is None:
                commit = json.load(tf.extractfile(ti)).get("commit")
            if not ti.isfile() or rel.startswith(("LICENSES/", "PUNG-BUILD/")):
                continue
            data = tf.extractfile(ti).read()
            h.update(ti.name.encode() + b"\0")
            if data[:4] != b"\x7fELF":
                h.update(hashlib.sha256(data).digest())
    h.update(("commit:" + (commit or "")).encode())
    return h.hexdigest()
mods = [m for m in index["modules"] if not args.ids or m["id"] in args.ids]
for m in mods:
    mid = m["id"]
    repo = m["source"].get("github_repo", "")
    src = os.path.join(MODSRC, m["source"].get("modsrc") or repo.split("/")[-1]) if repo else ""
    if not src or not os.path.isdir(src):
        withheld.append((mid, "its source is not here (build/modsrc)"))
        continue
    spdx, nc, how, lic_files = licence_of(mid, src)
    if m["component_type"] not in ("sound_generator", "audio_fx", "midi_fx"):
        withheld.append((mid, f"a Move {m['component_type']}: Pung runs instruments and effects"))
        continue
    if mid in policy.get("withhold", {}):
        withheld.append((mid, policy["withhold"][mid]))
        continue
    if not spdx and mid not in policy.get("publish", {}):
        withheld.append((mid, "no licence: the code names none (catalog-policy.json \"publish\" to override)"))
        continue
    if not spdx:
        spdx, how = "LicenseRef-permission", "policy: " + policy["publish"][mid]
    commit = (m["source"].get("commit") or "local")[:12]
    ver = safe(m["version"])
    rev = int(REVS.get(mid, {}).get("rev", 1))
    asset_name = f"{mid}-{ver}-push-x86_64.tar.gz" if rev == 1 else f"{mid}-{ver}-r{rev}-push-x86_64.tar.gz"
    src_name = f"{mid}-{ver}-{commit}-src.tar.gz"
    m["_source_url"] = f"source/{src_name}"
    mj = module_json(src)
    assets = asset_dirs(mid, mj)

    # the source archive, once per module version and commit
    src_path = os.path.join(out, "source", src_name)
    if not os.path.exists(src_path):
        files = git_files(src)
        if files is None:
            files = walk_files(src)
        tmp = src_path + ".tmp"
        with reproducible(tmp, 6) as tf:
            base = f"{mid}-{ver}-src/"
            for f in sorted(set(files)):
                if is_asset(f, assets) or os.path.islink(os.path.join(src, f)):
                    continue
                tf.add(os.path.join(src, f), base + f, recursive=False)
            pkg_build_dir(tf, base + "pung-build/", m, spdx, how)
            for hdir in ("src", "src/host"):
                for h in sorted(glob.glob(os.path.join(SCHWUNG, hdir, "*.h"))):
                    tf.add(h, base + "pung-build/schwung-headers/" + hdir + "/" + os.path.basename(h))
        os.replace(tmp, src_path)

    # the package: the build's tarball, plus licences and build notes
    orig = os.path.join(BUILD, "dist", m["asset"])
    pkg_path = os.path.join(out, "modules", asset_name)
    tmp = pkg_path + ".tmp"
    with tarfile.open(orig, "r:gz") as tin, reproducible(tmp, 9) as tout:
        names = []
        for ti in tin.getmembers():
            rel = ti.name.split("/", 1)[1] if "/" in ti.name else ""
            if rel and is_asset(rel, assets) and not ti.isdir():
                problems.append(f"{mid}: {ti.name} is firmware: left out")
                continue
            names.append(ti.name)
            tout.addfile(ti, tin.extractfile(ti) if ti.isfile() else None)
        for rel, p in lic_files:
            name = rel.replace("/", "__") if "/" in rel else rel
            tout.add(p, f"{mid}/LICENSES/{name}")
        if not lic_files:
            add_bytes(tout, f"{mid}/LICENSES/LICENSE-{safe(spdx)}.txt",
                      f"{m['name']} is distributed under {spdx} ({how}).\n".encode())
        pkg_build_dir(tout, f"{mid}/PUNG-BUILD/", m, spdx, how)
        manifest = "\n".join(sorted(n for n in names if not n.endswith("/"))) + "\n"
        add_bytes(tout, f"{mid}/PUNG-BUILD/MANIFEST", manifest.encode())
        add_bytes(tout, f"{mid}/PUNG-BUILD/REV", f"{rev}\n".encode())
    # the same version and revision as the catalog that is there: then the
    # same contents, or devices that have it would never be offered the change
    content = content_id(orig, m["source"].get("commit") or "")
    was = OLD_CAT.get(mid)
    if was and was.get("version") == m["version"] and int(was.get("pung_rev", 1)) == rev:
        before = was.get("content")
        old_pkg = os.path.join(out, was.get("asset", ""))
        if not before and os.path.isfile(old_pkg) and os.path.abspath(old_pkg) != os.path.abspath(pkg_path):
            before = content_id(old_pkg)
        elif not before and os.path.isfile(pkg_path):
            before = content_id(pkg_path)
        if before and before != content:
            unrevised.append(mid)
    os.replace(tmp, pkg_path)

    entry = {k: m[k] for k in ("id", "name", "version", "component_type", "install_subdir", "description", "author", "requires", "requires_modules")}
    # a module written for the Push (native/), or one built from a Schwung module
    entry["origin"] = "pung" if m["source"].get("native") else "schwung"
    # a takeover module: its surface on Push is a Push Hack app (module.json "pung": {"surface_app"})
    if (mj.get("pung") or {}).get("surface_app"):
        entry["surface_app"] = mj["pung"]["surface_app"]
    sc = SCHWUNG_CAT.get(mid, {})
    rel = RELEASES.get(mid, {})
    try:
        built = subprocess.run(["git", "-C", src, "log", "-1", "--format=%cs", m["source"].get("commit") or "HEAD"],
                               capture_output=True, text=True).stdout.strip()
    except OSError:
        built = ""
    entry.update({
        "subcategory": sc.get("subcategory", ""),
        "tags": sc.get("tags", []),
        "released": rel.get("first_release", ""),
        "updated": rel.get("last_updated", "") or built,
        "source_date": built,
    })
    entry.update({
        "pung_rev": rev, "content": content,
        "asset": "modules/" + asset_name, "size": os.path.getsize(pkg_path), "sha256": sha256(pkg_path),
        "license": {"spdx": spdx, "noncommercial": nc, "from": how},
        "source": {"repo": "https://github.com/" + repo if repo else "", "commit": m["source"].get("commit", ""),
                   "archive": "source/" + src_name, "archive_size": os.path.getsize(src_path)},
        "assets": mj.get("assets") or None,
    })
    published.append(entry)
    print(f"  {mid:20} {spdx:28} {entry['size'] // 1024:6} KB  source {entry['source']['archive_size'] // (1 << 20)} MB", flush=True)

if unrevised:
    print("\nThese packages changed (their files or their source commit) with the same version and\n"
          "revision as the catalog that is there. A device that has one would never be offered the\n"
          "change. Give each the next revision, and why, in scripts/module-revisions.json:\n  "
          + " ".join(sorted(unrevised)), file=sys.stderr)
    if not os.environ.get("PUNG_ALLOW_UNREVISED"):
        sys.exit(2)

# a partial build (ids given) merges into the catalog that is there
cat_path = os.path.join(out, "catalog.json")
if args.ids and os.path.exists(cat_path):
    old = {e["id"]: e for e in json.load(open(cat_path))["modules"]}
    for e in published:
        old[e["id"]] = e
    published = sorted(old.values(), key=lambda e: e["id"])
catalog = {
    "catalog_version": 1,
    "name": "Pung modules",
    "platform": index.get("platform", "push3-x86_64"),
    "glibc_max": index.get("glibc_max", "2.35"),
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "base_url": args.base_url,
    "modules": sorted(published, key=lambda e: e["id"]),
    # Schwung's categories, so the site and the Push name them as Schwung does
    "taxonomy": SCHWUNG_TAXONOMY,
}
json.dump(catalog, open(cat_path + ".tmp", "w"), indent=1)
os.replace(cat_path + ".tmp", cat_path)

# the page for people: the site reads catalog.json (scripts/catalog-site)
import shutil
for f in ("index.html", "site.css", "site.js"):
    shutil.copy(os.path.join(ROOT, "scripts", "catalog-site", f), os.path.join(out, f))

with open(os.path.join(out, "REPORT.md"), "w") as r:
    r.write(f"# Pung module catalog\n\nGenerated {catalog['generated_at']}: {len(catalog['modules'])} published, {len(withheld)} withheld.\n\n")
    r.write("## Withheld\n\n" + "".join(f"- **{i}**: {why}\n" for i, why in sorted(withheld)) + "\n")
    if problems:
        r.write("## Left out of packages\n\n" + "".join(f"- {p}\n" for p in problems) + "\n")
print(f"{len(catalog['modules'])} published, {len(withheld)} withheld (REPORT.md)")
for i, why in sorted(withheld):
    print(f"  withheld {i}: {why}")
for p in problems:
    print("  " + p)
