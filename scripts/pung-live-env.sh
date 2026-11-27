# Sourced by the scripts that publish to pung.live (publish-site.sh,
# publish-catalog.sh, release.sh): where the site lives and how to reach it.
#
# pung.live is served by Web Station on the owner's DiskStation, from one
# folder: the pages at its root, catalog/, releases/v<version>/pung.tar.gz,
# release.json (the latest; also committed to main, where Push Hack's store
# reads it), sources/ (every module's complete source, GPL-3.0 section 6(d)).
#
# Only that folder is ever touched: the share serves other sites.
#
#   PUNG_LIVE_HOST  the server, user@host or an ~/.ssh/config alias (required;
#                   PUNG_CATALOG_HOST is read too, its earlier name)
#   PUNG_LIVE_PORT  its SSH port, when ~/.ssh/config does not give it
#   PUNG_LIVE_URL   the public address (https://pung.live)
LIVE_HOST="${PUNG_LIVE_HOST:-${PUNG_CATALOG_HOST:-}}"
[ -n "$LIVE_HOST" ] || { echo "set PUNG_LIVE_HOST (user@host of the DiskStation, or its ~/.ssh/config alias)" >&2; exit 1; }
LIVE_PORT="${PUNG_LIVE_PORT:-${PUNG_CATALOG_PORT:-}}"
LIVE_URL="${PUNG_LIVE_URL:-https://pung.live}"
LIVE_DIR=/volume2/web/pung
LIVE_SSH="ssh -o BatchMode=yes${LIVE_PORT:+ -p $LIVE_PORT}"

# live_put SRC DEST: one file, in place by an atomic rename (a reader never
# sees half of it), DEST relative to LIVE_DIR
live_put() {
  $LIVE_SSH "$LIVE_HOST" "mkdir -p '$LIVE_DIR/$(dirname "$2")'"
  rsync -t -e "$LIVE_SSH" "$1" "$LIVE_HOST:$LIVE_DIR/$(dirname "$2")/.$(basename "$2").new"
  # no chmod: the DiskStation's ACL gives the file its permissions (a chmod replaces them)
  $LIVE_SSH "$LIVE_HOST" "mv -f '$LIVE_DIR/$(dirname "$2")/.$(basename "$2").new' '$LIVE_DIR/$2'"
}

# live_check URL SIZE: the public address serves SIZE bytes (what a Push
# will download is there before anything names it)
live_check() {
  got=$(curl -sfIL -m 30 "$1" | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n}')
  [ "$got" = "$2" ] || { echo "$1 does not serve the file ($got bytes, want $2): is pung.live pointed at the DiskStation?" >&2; return 1; }
}
