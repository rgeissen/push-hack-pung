#!/bin/sh
# Publishes the module catalog (scripts/build-catalog.py) to the DiskStation's
# web share, where it is public (a virtual host on
# /volume2/web/pung)
#
#   scripts/publish-catalog.sh [--prune]
#
# Order matters to a Push installing at the same moment: packages and sources
# first, then a check that every package on the server is the one the new
# catalog names (by checksum), then catalog.json and the page, each by an
# atomic rename. --prune then removes packages and sources no catalog names.
#
# Only /volume2/web/pung is ever touched: the share serves other sites.
set -eu
cd "$(dirname "$0")/.."
SRC=build/catalog
# the server and its SSH port: yours, from the environment
HOST="${PUNG_CATALOG_HOST:?set PUNG_CATALOG_HOST (user@host of the server)}"
PORT="${PUNG_CATALOG_PORT:-22}"
DEST=/volume2/web/pung
SSH="ssh -o BatchMode=yes -p $PORT"

[ -f "$SRC/catalog.json" ] || { echo "no $SRC/catalog.json: run scripts/build-catalog.py first" >&2; exit 1; }
# never ROMs: the build checks, and so does the last step before the internet
if find "$SRC/modules" -name '*.tar.gz' -print0 | xargs -0 -n1 tar tzf | grep -Ei '(^|/)roms?/.+'; then
  echo "a package holds a ROM folder: not published" >&2; exit 1
fi

$SSH "$HOST" "mkdir -p $DEST/modules $DEST/source"
# by content: a file of the same name with other bytes is replaced (the
# catalog's checksum must be the file's); the archives are reproducible, so
# an unchanged module is not sent again
rsync -rt --checksum -e "$SSH" "$SRC/modules/" "$HOST:$DEST/modules/"
rsync -rt --checksum -e "$SSH" "$SRC/source/" "$HOST:$DEST/source/"
# the server's packages are the catalog's, byte for byte, or nothing is published
python3 -c 'import json,sys
for e in json.load(open(sys.argv[1]))["modules"]: print(e["sha256"] + "  " + e["asset"])' "$SRC/catalog.json" \
  | $SSH "$HOST" "cd $DEST && sha256sum -c --quiet -" || { echo "the server's packages do not match the catalog: catalog.json NOT published" >&2; exit 1; }
for f in site.css site.js catalog.json index.html; do
  rsync -t -e "$SSH" "$SRC/$f" "$HOST:$DEST/.$f.new"
  $SSH "$HOST" "mv -f $DEST/.$f.new $DEST/$f"
done

if [ "${1:-}" = "--prune" ]; then
  keep=$(python3 -c 'import json,sys
c=json.load(open(sys.argv[1]))
for e in c["modules"]: print(e["asset"]); print(e["source"]["archive"])' "$SRC/catalog.json")
  printf '%s\n' "$keep" | $SSH "$HOST" "cd $DEST && sort > .keep && (ls modules/* source/* 2>/dev/null | sort | comm -23 - .keep | while read -r f; do rm -f -- \"\$f\" && echo \"pruned \$f\"; done); rm -f .keep"
fi
n=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["modules"]))' "$SRC/catalog.json")
echo "published $n modules"
