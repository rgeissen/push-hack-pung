#!/bin/sh
# Packages Pung as push-catalog installs a hack (dist/pung.tar.gz, one top
# entry pung/), with the module catalog INSIDE it: catalog/catalog.json and
# every package it lists. The Modules page then installs from the Push's
# own disk (modmgr.go, bundledCatalog), and no module is downloaded from
# anywhere. The modules' sources (GPL-3.0 6(d): available to whoever gets
# a binary) go to pung.live/sources/ on the DiskStation (pung-live-env.sh),
# and the bundled catalog links each module's source there.
#
#   scripts/release.sh             build dist/pung.tar.gz and dist/release.json
#   scripts/release.sh --publish   and publish to pung.live: the sources (only
#                                  the ones not there yet), the package at
#                                  releases/v<version>/, release.json beside
#                                  them and committed to main (Push Hack's
#                                  store reads it there), the tag v<version>
#
# Releases up to 0.5.0 are on GitHub (their sources on its "sources"
# release): they stay there, the packages that link them are installed.
#
# The catalog is CATALOG_DIR (default build/catalog: what build-catalog.py
# made and publish-catalog.sh published). make build first.
set -eu
cd "$(dirname "$0")/.."
PUBLISH=0
[ "${1:-}" = "--publish" ] && PUBLISH=1

CATALOG_DIR="${CATALOG_DIR:-build/catalog}"
VERSION=$(python3 -c 'import json; print(json.load(open("hack.json"))["version"])')
SITE_URL="${PUNG_LIVE_URL:-https://pung.live}"
SOURCES_URL="$SITE_URL/sources"

for f in pung livedevice.so restart-live.sh "$CATALOG_DIR/catalog.json" build/screens/index.json; do
  [ -e "$f" ] || { echo "missing $f (make build; make screens; the catalog: build-catalog.py)" >&2; exit 1; }
done

rm -rf dist && mkdir -p dist/pung/catalog/modules
cp pung livedevice.so restart-live.sh hack.json LICENSE THIRD_PARTY_LICENSES.md dist/pung/
cp -R licenses overrides dist/pung/
cp -R build/screens dist/pung/screens # the Modules page's pictures of each module's own interface
# Schwung's chain host and its built-in modules (make modules), and its
# patches: Pung does not start without the chain host. Releases 0.4.3 to
# 0.5.0 went out without them (build/ had been cleaned, and this step
# skipped what was not there); a fresh install of those does not start.
[ -f build/modules/chain/dsp.so ] || { echo "missing build/modules/chain/dsp.so: the chain host (make modules). Pung does not start without it." >&2; exit 1; }
[ -d build/patches ] || { echo "missing build/patches (make modules)" >&2; exit 1; }
cp -R build/modules build/patches dist/pung/

# the catalog, for this Push's disk: packages beside it, sources on pung.live
python3 - "$CATALOG_DIR" dist/pung/catalog "$SOURCES_URL" <<'PY'
import hashlib, json, os, shutil, sys
src, out, sources = sys.argv[1:4]
doc = json.load(open(os.path.join(src, "catalog.json")))
doc["base_url"] = ""  # the packages are beside it (modmgr.go)
for m in doc["modules"]:
    p = os.path.join(src, m["asset"])
    data = open(p, "rb").read()
    if len(data) != m["size"] or hashlib.sha256(data).hexdigest() != m["sha256"]:
        sys.exit("%s does not match the catalog" % m["asset"])
    shutil.copy2(p, os.path.join(out, "modules", os.path.basename(m["asset"])))
    m["asset"] = "modules/" + os.path.basename(m["asset"])
    s = m.get("source") or {}
    if s.get("archive"):
        if not os.path.exists(os.path.join(src, s["archive"])):
            sys.exit("%s: its source %s is missing" % (m["id"], s["archive"]))
        s["archive"] = sources + "/" + os.path.basename(s["archive"])
json.dump(doc, open(os.path.join(out, "catalog.json"), "w"), indent=1)
print("catalog: %d modules" % len(doc["modules"]))
PY

# reproducible: sorted, fixed times, no owner, gzip without a timestamp (in
# Python: macOS's tar has none of GNU tar's options for it)
python3 - <<'PY'
import gzip, os, tarfile
def norm(ti):
    ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = 1767225600, 0, 0, "", ""
    return ti
with open("dist/pung.tar.gz", "wb") as raw:
    with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=9, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar:
            for root, dirs, files in os.walk("dist/pung"):
                dirs.sort()
                rel = os.path.relpath(root, "dist")
                tar.add(root, arcname=rel, recursive=False, filter=norm)
                for f in sorted(files):
                    tar.add(os.path.join(root, f), arcname=os.path.join(rel, f), recursive=False, filter=norm)
PY
# what a Push needs to start Pung is in the package itself
for need in pung/pung pung/hack.json pung/livedevice.so pung/modules/chain/dsp.so pung/catalog/catalog.json; do
  tar tzf dist/pung.tar.gz "$need" >/dev/null 2>&1 || { echo "dist/pung.tar.gz has no $need: not a package a Push can run" >&2; exit 1; }
done
SIZE=$(wc -c < dist/pung.tar.gz | tr -d ' ')
[ "$SIZE" -gt 1000000 ] || { echo "dist/pung.tar.gz is $SIZE bytes: packaging failed" >&2; exit 1; }
echo "dist/pung.tar.gz: $((SIZE / 1048576)) MB, Pung $VERSION"

cat > dist/release.json <<EOF
{
  "version": "$VERSION",
  "download_url": "$SITE_URL/releases/v$VERSION/pung.tar.gz",
  "released_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

[ $PUBLISH = 1 ] || { echo "not published (--publish)"; exit 0; }

. scripts/pung-live-env.sh
[ "$LIVE_URL" = "$SITE_URL" ] || { echo "PUNG_LIVE_URL changed under the package" >&2; exit 1; }

# the sources first: a catalog never links a source that is not there. By
# content: a source of the same name is never replaced by other bytes
# (an installed package links it).
python3 -c 'import json,sys; [print(m["source"]["archive"]) for m in json.load(open(sys.argv[1]))["modules"] if (m.get("source") or {}).get("archive")]' \
  "$CATALOG_DIR/catalog.json" | sort -u > dist/sources.txt
$LIVE_SSH "$LIVE_HOST" "mkdir -p $LIVE_DIR/sources"
rsync -t --ignore-existing --files-from=dist/sources.txt --no-relative -e "$LIVE_SSH" "$CATALOG_DIR/" "$LIVE_HOST:$LIVE_DIR/sources/"
python3 -c 'import hashlib,os,sys
for a in open(sys.argv[1]).read().split():
    print(hashlib.sha256(open(os.path.join(sys.argv[2], a), "rb").read()).hexdigest() + "  " + os.path.basename(a))' \
  dist/sources.txt "$CATALOG_DIR" | $LIVE_SSH "$LIVE_HOST" "cd $LIVE_DIR/sources && sha256sum -c --quiet -" || {
  echo "a source on the server is not the catalog's (same name, other bytes): nothing published" >&2; exit 1; }
echo "sources: $(wc -l < dist/sources.txt | tr -d ' ')"

# the package, checked where a Push will fetch it, before anything names it
live_put dist/pung.tar.gz "releases/v$VERSION/pung.tar.gz"
echo "$(shasum -a 256 dist/pung.tar.gz | cut -d' ' -f1)  pung.tar.gz" | $LIVE_SSH "$LIVE_HOST" "cd $LIVE_DIR/releases/v$VERSION && sha256sum -c --quiet -"
live_check "$SITE_URL/releases/v$VERSION/pung.tar.gz" "$SIZE"
for a in $(head -3 dist/sources.txt); do live_check "$SOURCES_URL/$(basename "$a")" "$(wc -c < "$CATALOG_DIR/$a" | tr -d ' ')"; done

# then what names it: pung.live's release.json, and main's (the store's)
live_put dist/release.json release.json
cp dist/release.json release.json
git add release.json
git commit -q -m "release: Pung $VERSION" release.json
git tag -a "v$VERSION" -m "Pung $VERSION"
git push -q origin HEAD "v$VERSION"
echo "published: v$VERSION at $SITE_URL/releases/v$VERSION/pung.tar.gz"
