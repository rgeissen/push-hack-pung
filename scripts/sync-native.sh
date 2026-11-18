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
python3 - <<'PY' | while IFS=$'\t' read -r id dst dep local repo commit; do
import json
for m in json.load(open("native/catalog.json"))["modules"]:
    print("\t".join([m["id"], m["modsrc"], "", "", "", ""]))
    for dep, d in m.get("deps", {}).items():
        print("\t".join([m["id"], m["modsrc"], dep, d.get("local", ""), d["repo"], d["commit"]]))
PY
    if [ -z "$dep" ]; then
        mkdir -p "build/modsrc/$dst"
        rsync -a --delete --exclude libs/ "native/$id/" "build/modsrc/$dst/"
        cp LICENSE "build/modsrc/$dst/LICENSE.pung" 2>/dev/null || true
        echo "native: $id -> build/modsrc/$dst"
        continue
    fi
    t="build/modsrc/$dst/$dep"
    if [ -f "$t.COMMIT" ] && [ "$(cat "$t.COMMIT")" = "$commit" ] && [ -d "$t" ]; then
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
    echo "$commit" > "$t.COMMIT"
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
json.dump(c, open("build/catalog-merged.json", "w"), indent=1)
print("catalog: %d modules, %d native" % (len(c["modules"]), len(n)))
PY
