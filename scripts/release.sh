#!/bin/sh
# Packages Pung as push-catalog installs a hack (dist/pung.tar.gz, one top
# entry pung/), with the module catalog INSIDE it: catalog/catalog.json and
# every package it lists. The Modules page then installs from the Push's
# own disk (modmgr.go, bundledCatalog), and no module is downloaded from
# anywhere. The modules' sources (GPL-3.0 6(d): available to whoever gets
# a binary) go to this repository's "sources" release on GitHub, and the
# bundled catalog links each module's source there.
#
#   scripts/release.sh             build dist/pung.tar.gz and dist/release.json
#   scripts/release.sh --publish   and publish: the sources (only the ones
#                                  not there yet), the v<version> release,
#                                  release.json committed and pushed
#
# The catalog is CATALOG_DIR (default build/catalog: what build-catalog.py
# made and publish-catalog.sh published). make build first.
set -eu
cd "$(dirname "$0")/.."
PUBLISH=0
[ "${1:-}" = "--publish" ] && PUBLISH=1

CATALOG_DIR="${CATALOG_DIR:-build/catalog}"
REPO="${PUNG_REPO:-rgeissen/push-hack-pung}"
GH="${GH:-gh}"
VERSION=$(python3 -c 'import json; print(json.load(open("hack.json"))["version"])')
SOURCES_URL="https://github.com/$REPO/releases/download/sources"

for f in pung livedevice.so restart-live.sh "$CATALOG_DIR/catalog.json"; do
  [ -e "$f" ] || { echo "missing $f (make build; the catalog: build-catalog.py)" >&2; exit 1; }
done

rm -rf dist && mkdir -p dist/pung/catalog/modules
cp pung livedevice.so restart-live.sh hack.json LICENSE THIRD_PARTY_LICENSES.md dist/pung/
cp -R licenses overrides dist/pung/
[ -d build/modules ] && cp -R build/modules dist/pung/
[ -d build/patches ] && cp -R build/patches dist/pung/

# the catalog, for this Push's disk: packages beside it, sources on GitHub
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
SIZE=$(wc -c < dist/pung.tar.gz | tr -d ' ')
[ "$SIZE" -gt 1000000 ] || { echo "dist/pung.tar.gz is $SIZE bytes: packaging failed" >&2; exit 1; }
echo "dist/pung.tar.gz: $((SIZE / 1048576)) MB, Pung $VERSION"

cat > dist/release.json <<EOF
{
  "version": "$VERSION",
  "download_url": "https://github.com/$REPO/releases/download/v$VERSION/pung.tar.gz",
  "released_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

[ $PUBLISH = 1 ] || { echo "not published (--publish)"; exit 0; }

# the sources first: a catalog never links a source that is not there
$GH release view sources --repo "$REPO" >/dev/null 2>&1 || \
  $GH release create sources --repo "$REPO" --title "Module sources" \
    --notes "The complete source of every module build Pung ships, as the catalog names it (source.archive). Kept for GPL-3.0 section 6(d)." >/dev/null
HAVE=$($GH release view sources --repo "$REPO" --json assets --jq '.assets[].name')
python3 -c 'import json,sys; [print(m["source"]["archive"]) for m in json.load(open(sys.argv[1]))["modules"] if (m.get("source") or {}).get("archive")]' \
  "$CATALOG_DIR/catalog.json" | while read -r a; do
  n=$(basename "$a")
  if ! printf '%s\n' "$HAVE" | grep -qx "$n"; then
    echo "source: $n"
    $GH release upload sources "$CATALOG_DIR/$a" --repo "$REPO"
  fi
done

if $GH release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  $GH release upload "v$VERSION" dist/pung.tar.gz --repo "$REPO" --clobber
else
  $GH release create "v$VERSION" dist/pung.tar.gz --repo "$REPO" --title "Pung $VERSION" \
    --notes "Pung $VERSION, with the module catalog inside: the Modules page installs from the Push's own disk. Module sources: the \"sources\" release."
fi
cp dist/release.json release.json
git add release.json
git commit -q -m "release: Pung $VERSION" release.json
git push -q
echo "published: v$VERSION"
