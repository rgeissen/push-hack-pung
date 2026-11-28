#!/bin/sh
# Publishes the module pack (scripts/build-catalog.py) to pung.live/catalog/,
# on the DiskStation (scripts/pung-live-env.sh), signed. A Pung from 0.6.0 on
# asks for it and takes it when it is newer than the pack it came with
# (src/modpack.go); its own pack stays what it installs from when offline.
#
#   scripts/publish-catalog.sh [--prune]
#
# Order matters to a Push installing at the same moment: packages and sources
# first, then a check that every package on the server is the one the new
# catalog names (by checksum), then catalog.json and the page, each by an
# atomic rename. --prune then removes packages and sources no catalog names.
set -eu
cd "$(dirname "$0")/.."
. scripts/pung-live-env.sh
SRC=build/catalog
HOST="$LIVE_HOST"
DEST="$LIVE_DIR/catalog"
SSH="$LIVE_SSH"

[ -f "$SRC/catalog.json" ] || { echo "no $SRC/catalog.json: run scripts/build-catalog.py first" >&2; exit 1; }
# the pack is signed: a Pung takes it only with Pung's pack key (src/modpack.go).
# The private half is the owner's (scripts/packsign keygen), in no repository.
KEY="${PUNG_PACK_KEY:-$HOME/.config/pung/pack-signing.key}"
[ -f "$KEY" ] || { echo "no pack key at $KEY (PUNG_PACK_KEY): without it no Pung takes the pack" >&2; exit 1; }
PUB=$(sed -n 's/.*mustPackKey("\([^"]*\)").*/\1/p' src/modpack.go)
docker run --rm --platform linux/amd64 -v "$PWD/scripts/packsign":/w -v "$(dirname "$KEY")":/k:ro -v "$PWD/$SRC":/c -w /w push-hack-pung-builder \
  sh -c "go run . sign /k/$(basename "$KEY") /c/catalog.json && go run . verify '$PUB' /c/catalog.json" \
  || { echo "the pack is not signed with the key built into Pung: NOT published" >&2; exit 1; }
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
# the signature just before the pack it signs: a Pung that reads between the
# two finds them not matching and keeps what it has
for f in site.css site.js catalog.json.sig catalog.json index.html; do
  rsync -t -e "$SSH" "$SRC/$f" "$HOST:$DEST/.$f.new"
  $SSH "$HOST" "mv -f $DEST/.$f.new $DEST/$f"
done

if [ "${1:-}" = "--prune" ]; then
  keep=$(python3 -c 'import json,sys
c=json.load(open(sys.argv[1]))
for e in c["modules"]: print(e["asset"]); print(e["source"]["archive"])' "$SRC/catalog.json")
  printf '%s\n' "$keep" | $SSH "$HOST" "cd $DEST && sort > .keep && (ls modules/* source/* 2>/dev/null | sort | comm -23 - .keep | while read -r f; do rm -f -- \"\$f\" && echo \"pruned \$f\"; done); rm -f .keep"
fi
# pung.live's Modules page shows the same pack. The page is the site's (its
# own repository, checked out at site/): without it the pack is published and
# the page keeps the list it has until the site is published from a checkout.
if [ -f site/build.py ]; then
  python3 site/build.py --modules-data build/site-modules.json "$SRC/catalog.json"
  live_put build/site-modules.json modules/catalog.json
else
  echo "NOTE: site/ is not checked out: pung.live's Modules page still shows the pack before this one" >&2
fi
n=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["modules"]))' "$SRC/catalog.json")
echo "published $n modules"
