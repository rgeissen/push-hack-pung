#!/usr/bin/env bash
# Syncs the module repos in scripts/local-sources.json into build/modsrc, in
# place of the catalog's clones: a fork with work not upstream yet is built
# from its working copy, on every run, so local edits are built too. Its .git
# comes along, so the package index names the commit it was built from.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -c '
import json
for repo, e in json.load(open("scripts/local-sources.json")).items():
    print(repo + "\t" + e["path"])
' | while IFS=$'\t' read -r repo src; do
    if [ ! -d "$src" ]; then
        echo "local source $src for $repo is missing" >&2
        exit 1
    fi
    mkdir -p "build/modsrc/$repo"
    rsync -a --delete --exclude build/ --exclude dist/ "$src/" "build/modsrc/$repo/"
    echo "local source: $repo <- $src ($(git -C "$src" rev-parse --abbrev-ref HEAD) $(git -C "$src" rev-parse --short HEAD))"
done
