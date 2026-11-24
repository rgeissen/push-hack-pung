#!/usr/bin/env bash
# Pung-native modules (native/catalog.json): syncs native/<id>/ into
# build/modsrc/<modsrc>/, and each of its deps beside it, so a native module is
# built and archived from one folder like every other module. A dep comes from
# its local working copy when that is at the pinned commit, else from a clone.
# Writes build/catalog-merged.json: Schwung's catalog plus the native entries.
set -euo pipefail
cd "$(dirname "$0")/.."
CATALOG=${CATALOG:-../schwung/module-catalog.json}
mkdir -p build/modsrc
python3 - <<'PY' | while IFS=$'\t' read -r id dst dep local repo commit paths; do
import json
for m in json.load(open("native/catalog.json"))["modules"]:
    print("\t".join([m["id"], m["modsrc"], "", "", "", "", ""]))
    for dep, d in m.get("deps", {}).items():
        # "paths": only these of the dep's tree (AKWF: 17 MB of a 1.1 GB checkout)
        print("\t".join([m["id"], m["modsrc"], dep, d.get("local", ""), d["repo"], d["commit"], ",".join(d.get("paths", []))]))
PY
    if [ -z "$dep" ]; then
        mkdir -p "build/modsrc/$dst"
        rsync -a --delete --exclude libs/ "native/$id/" "build/modsrc/$dst/"
        cp LICENSE "build/modsrc/$dst/LICENSE.pung" 2>/dev/null || true
        echo "native: $id -> build/modsrc/$dst"
        continue
    fi
    t="build/modsrc/$dst/$dep"
    # what the copy was made from: the commit, and the paths kept (a change of
    # either makes it again)
    stamp="$commit"
    [ -n "$paths" ] && stamp="$commit $paths"
    if [ -f "$t.COMMIT" ] && [ "$(cat "$t.COMMIT")" = "$stamp" ] && [ -d "$t" ]; then
        continue
    fi
    if [ -n "$local" ] && [ -d "$local" ] && [ "$(git -C "$local" rev-parse HEAD 2>/dev/null)" = "$commit" ]; then
        mkdir -p "$t"
        rsync -a --delete --exclude .git --exclude build/ "$local/" "$t/"
        echo "native dep: $dep <- $local ($commit)"
    else
        rm -rf "$t"
        git clone -q "$repo" "$t"
        git -C "$t" checkout -q "$commit"
        git -C "$t" submodule update -q --init --recursive
        find "$t" -name .git -prune -exec rm -rf {} +
        echo "native dep: $dep <- $repo ($commit)"
    fi
    if [ -n "$paths" ]; then # only the paths the module uses: the rest never enters its build or source archive
        k="$t.keep"; rm -rf "$k"; mkdir -p "$k"
        IFS=, read -r -a want <<< "$paths"
        for p in "${want[@]}"; do
            if [ ! -e "$t/$p" ]; then
                echo "native dep: $dep has no $p at $commit (native/catalog.json paths)" >&2
                exit 1
            fi
            mv "$t/$p" "$k/"
        done
        rm -rf "$t"; mv "$k" "$t"
        echo "native dep: $dep kept $paths"
    fi
    echo "$stamp" > "$t.COMMIT"
done
python3 - "$CATALOG" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
n = json.load(open("native/catalog.json"))["modules"]
ids = {m["id"] for m in c["modules"]}
for m in n:
    if m["id"] in ids:
        sys.exit("native module %s: Schwung's catalog has that id" % m["id"])
c["modules"] += n
# Schwung modules Schwung's catalog does not list yet (scripts/extra-catalog.json)
x = json.load(open("scripts/extra-catalog.json"))["modules"]
for m in x:
    if m["id"] in ids or any(m["id"] == k["id"] for k in n):
        sys.exit("extra module %s: the catalog has that id (drop it from extra-catalog.json)" % m["id"])
c["modules"] += x
json.dump(c, open("build/catalog-merged.json", "w"), indent=1)
print("catalog: %d modules, %d native" % (len(c["modules"]), len(n)))
PY
