#!/usr/bin/env bash
# Builds every Schwung catalog module for Push 3 (x86_64, glibc 2.35) and
# packages them for provisioning (a web service, later).
#
#   scripts/build-push-modules.sh [fetch] [id ...]
#
#   fetch   clone/update the catalog repos into build/modsrc, build the module
#           image if missing, fetch the external deps (network; scripts/fetch-deps.sh)
#   id ...  only these modules (default: all)
#
# scripts/local-sources.json names module repos built from a local working
# copy instead of the catalog's clone (a fork with work not upstream yet).
#
# 1. scripts/gen-recipes.py reads each repo's build script (never runs it) and
#    writes build/recipes/<id>.sh; scripts/recipes/<id>.sh (hand-written) wins.
# 2. The recipes run in the builder image (Ubuntu 22.04) with no network:
#    sources read-only, external deps from build/deps (fetched on the host).
# 3. scripts/package-push-modules.py checks every ELF (x86_64, glibc <= 2.35)
#    and writes build/push-modules/{dist/*.tar.gz,index.json,REPORT.md}.
set -euo pipefail
cd "$(dirname "$0")/.."
CATALOG=${CATALOG:-../schwung/module-catalog.json}
SCHWUNG=${SCHWUNG:-$(cd ../schwung && pwd)}
IMAGE=${IMAGE:-push-hack-pung-modules}  # docker/Dockerfile.modules: the builder + Rust
OUT=build/push-modules

if [ "${1:-}" = fetch ]; then
    shift
    mkdir -p build/modsrc
    python3 - "$CATALOG" > build/repos.txt <<'EOF'
import json, sys
seen = set()
for m in json.load(open(sys.argv[1]))["modules"]:
    r = m.get("github_repo")
    if r and r not in seen:
        seen.add(r)
        print(r, m.get("default_branch", "main"))
EOF
    while read -r repo branch; do
        d=build/modsrc/$(basename "$repo")
        if grep -q "\"$(basename "$repo")\"" scripts/local-sources.json; then
            continue # built from a local working copy (sync-local-sources.sh)
        fi
        if [ -d "$d/.git" ]; then
            git -C "$d" fetch -q --depth 1 origin "$branch" && git -C "$d" reset -q --hard FETCH_HEAD \
                && git -C "$d" submodule update -q --init --recursive --depth 1 || echo "update failed: $repo"
        else
            git clone -q --depth 1 --recurse-submodules --shallow-submodules -b "$branch" \
                "https://github.com/$repo.git" "$d" || echo "clone failed: $repo"
        fi
    done < build/repos.txt
    docker image inspect "$IMAGE" >/dev/null 2>&1 || \
        docker build --platform linux/amd64 -q -t "$IMAGE" -f docker/Dockerfile.modules docker
    scripts/fetch-deps.sh
fi
scripts/sync-local-sources.sh # scripts/local-sources.json: forks built from their working copy
scripts/sync-native.sh        # native/catalog.json: Pung's own modules; writes build/catalog-merged.json
CATALOG=build/catalog-merged.json

rm -rf build/recipes
python3 scripts/gen-recipes.py "$CATALOG" build/modsrc build/recipes
mkdir -p "$OUT/modules" "$OUT/logs" build/deps
docker run --rm --platform linux/amd64 --network none \
    -v "$PWD/build/modsrc:/modsrc:ro" -v "$SCHWUNG:/schwung:ro" -v "$PWD/build/deps:/deps:ro" \
    -v "$PWD/build/recipes:/recipes:ro" -v "$PWD/scripts/recipes:/hand:ro" -v "$PWD/scripts:/s:ro" \
    -v "$PWD/$OUT/modules:/out" -v "$PWD/$OUT/logs:/logs" \
    "$IMAGE" bash /s/build-all.sh "$@"
docker run --rm --platform linux/amd64 --network none -v "$PWD:/w" -v "$SCHWUNG:/schwung:ro" -w /w "$IMAGE" \
    python3 scripts/package-push-modules.py build/catalog-merged.json build/modsrc "$OUT"
