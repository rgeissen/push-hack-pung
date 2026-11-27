#!/bin/sh
# Publishes the pages (site/build.py --pages: home, vision, manual, design, performance) to pung.live, on the
# DiskStation (scripts/pung-live-env.sh): the pages and brand/ (the logo,
# favicons, the link preview). Nothing else in the folder is touched.
#
#   scripts/publish-site.sh
set -eu
cd "$(dirname "$0")/.."
. scripts/pung-live-env.sh
OUT=build/site
rm -rf "$OUT"
python3 site/build.py --pages "$OUT"
# rsync writes each file beside its place and renames it in: a reader never
# sees half a page. No --delete: catalog/, releases/ and sources/ stay.
$LIVE_SSH "$LIVE_HOST" "mkdir -p $LIVE_DIR/brand"
# Never -p (or -a): the folder's permissions are the DiskStation's ACL, which
# a chmod from rsync replaces with plain modes, and the folder is then no
# longer writable (2026-11-26). -O: no times on folders (the top one is admin's).
rsync -rtO --checksum -e "$LIVE_SSH" "$OUT/" "$LIVE_HOST:$LIVE_DIR/"
echo "published: $(cd "$OUT" && find . -type f | sed 's|^\./||' | sort | tr '\n' ' ')"
live_check "$LIVE_URL/" "$(wc -c < "$OUT/index.html" | tr -d ' ')" && echo "$LIVE_URL serves the new pages"
