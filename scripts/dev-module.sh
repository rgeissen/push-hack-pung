#!/usr/bin/env bash
# Builds ONE module for Push 3 from a working copy of its repository, for the
# person who is writing or porting it: no catalog, no other module, nothing of
# Pung's own release build (build/push-modules) is touched.
#
#   scripts/dev-module.sh <the module's working copy> [id]
#
# The same steps as every module of the pack (docs/push-module-builds.md): its
# build script is read, never run; a plain recipe is written
# (build/dev/recipes/<id>.sh; scripts/recipes/<id>.sh, hand-written, wins); it
# is compiled in the builder with no network; and the result is checked as
# packaging checks every module (x86_64, glibc 2.35, loads as Pung's host
# loads it). Out: build/dev/out/modules/<type>/<id>/ and build/dev/out/dist/.
#
# Needs Docker, and Schwung's source for the host headers: SCHWUNG=<its
# folder> (default ../schwung, beside this repository: git clone --depth 1
# https://github.com/charlesvestal/schwung).
# [id]: which module, when the working copy holds several.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: scripts/dev-module.sh <the module's working copy> [id]" >&2; exit 2; }
SRC=$(cd "$1" && pwd)
WANT=${2:-}
cd "$(dirname "$0")/.."
SCHWUNG=${SCHWUNG:-../schwung}
[ -f "$SCHWUNG/src/host/plugin_api_v1.h" ] || { echo "no Schwung source at $SCHWUNG (SCHWUNG=<folder>; git clone --depth 1 https://github.com/charlesvestal/schwung)" >&2; exit 2; }
SCHWUNG=$(cd "$SCHWUNG" && pwd)
IMAGE=${IMAGE:-push-hack-pung-modules}
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
    echo "building the module builder image (once; it takes a while)"
    docker build --platform linux/amd64 -q -t "$IMAGE" -f docker/Dockerfile.modules docker
}
DEV=build/dev
NAME=$(basename "$SRC")
mkdir -p "$DEV/modsrc" "$DEV/out/modules" "$DEV/out/logs" build/deps
rsync -a --delete --exclude build/ --exclude dist/ --exclude node_modules/ "$SRC/" "$DEV/modsrc/$NAME/"

# a catalog of one: the module as its own module.json describes it
# (not inside $(...): the bash a Mac ships cannot read a here-document there)
python3 - "$DEV/modsrc/$NAME" "$NAME" "$WANT" "$DEV/catalog.json" > "$DEV/id.txt" <<'PY'
import json, os, sys
root, name, want, out = sys.argv[1:5]
found = []
for d, dirs, files in os.walk(root):
    dirs[:] = [x for x in dirs if x not in (".git", "node_modules", "build", "dist", "libs", "third_party")]
    if "module.json" in files:
        try:
            j = json.load(open(os.path.join(d, "module.json")))
        except Exception as e:
            sys.exit("%s: %s" % (os.path.join(d, "module.json"), e))
        if j.get("id"):
            found.append(j)
if want:
    found = [j for j in found if j["id"] == want]
if len(found) != 1:
    sys.exit("found %d module.json with an id%s in %s: %s" % (len(found), " " + want if want else "", root,
             ", ".join(j["id"] for j in found) or "none (give the id as the second argument, or check the file)"))
j = found[0]
kind = (j.get("capabilities") or {}).get("component_type") or j.get("component_type") or ""
if kind not in ("sound_generator", "audio_fx", "midi_fx"):
    sys.exit("%s: module.json says component_type %r; Pung plays sound_generator, audio_fx and midi_fx" % (j["id"], kind))
json.dump({"modules": [{"id": j["id"], "name": j.get("name", j["id"]), "component_type": kind,
                        "description": j.get("description", ""), "author": j.get("author", ""),
                        "github_repo": "local/" + name, "default_branch": "main"}]}, open(out, "w"), indent=1)
print(j["id"])
PY
ID=$(cat "$DEV/id.txt")
echo "== $ID, from $SRC"
rm -rf "$DEV/recipes" "$DEV/out/modules"/*/"$ID" "$DEV/out/logs/$ID.log"
python3 scripts/gen-recipes.py "$DEV/catalog.json" "$DEV/modsrc" "$DEV/recipes" > "$DEV/recipes.log" 2>&1 || { cat "$DEV/recipes.log"; exit 1; }
if [ -f "scripts/recipes/$ID.sh" ]; then
    echo "recipe: scripts/recipes/$ID.sh (hand-written)"
elif [ -f "$DEV/recipes/$ID.sh" ]; then
    echo "recipe: $DEV/recipes/$ID.sh (read from the module's build script)"
else
    cat "$DEV/recipes.log"
    echo "no recipe could be read from the module's build script: write scripts/recipes/$ID.sh (docs/push-module-builds.md)" >&2
    exit 1
fi
docker run --rm --platform linux/amd64 --network none \
    -v "$PWD/$DEV/modsrc:/modsrc:ro" -v "$SCHWUNG:/schwung:ro" -v "$PWD/build/deps:/deps:ro" \
    -v "$PWD/$DEV/recipes:/recipes:ro" -v "$PWD/scripts/recipes:/hand:ro" -v "$PWD/scripts:/s:ro" \
    -v "$PWD/$DEV/out/modules:/out" -v "$PWD/$DEV/out/logs:/logs" \
    "$IMAGE" bash /s/build-all.sh "$ID" > "$DEV/build.log" 2>&1 || true
if ! grep -q "^$ID	ok	" "$DEV/out/logs/status.tsv"; then
    echo "the build failed; the end of $DEV/out/logs/$ID.log:" >&2
    tail -25 "$DEV/out/logs/$ID.log" >&2
    exit 1
fi
echo "compiled ($(grep "^$ID	" "$DEV/out/logs/status.tsv" | cut -f3) s)"
rm -f "$DEV/out/dist/$ID-push-x86_64.tar.gz"
docker run --rm --platform linux/amd64 --network none -v "$PWD:/w" -v "$SCHWUNG:/schwung:ro" -w /w \
    -e PUNG_RECIPES_INDEX="$DEV/recipes/index.json" "$IMAGE" \
    python3 scripts/package-push-modules.py "$DEV/catalog.json" "$DEV/modsrc" "$DEV/out" > "$DEV/package.log" 2>&1 || true
if [ ! -f "$DEV/out/dist/$ID-push-x86_64.tar.gz" ]; then
    echo "compiled, but refused by the checks every module of the pack passes (x86_64, glibc 2.35 or older," >&2
    echo "loads as Pung's host loads it with its entry point exported):" >&2
    sed -n '/^## /,$p' "$DEV/out/REPORT.md" 2>/dev/null | grep -v '^$' | head -12 >&2
    cat "$DEV/package.log" >&2
    exit 1
fi
MOD=$(find "$DEV/out/modules" -maxdepth 2 -type d -name "$ID" | head -1)
echo "checked: every binary is x86_64, needs glibc 2.35 or older, and loads as Pung's host loads it"
echo "built:   $MOD"
echo "package: $DEV/out/dist/$ID-push-x86_64.tar.gz"
git -C "$SRC" rev-parse HEAD >/dev/null 2>&1 || echo "note: the working copy is not a git repository, so the package names no commit (Pung's module pack needs one)"
echo "hear it (an instrument): RENDER_MODULES=$DEV/out/modules scripts/render-check.sh $ID <a folder with what the module asks its player for; an empty one if nothing> 2"
