#!/bin/sh
# Deploys Pung to a Push by hand, the way push-catalog installs a hack:
# files under /data/push-hack/hacks/pung, and an init.d service generated
# from push-catalog's own template (plain nice-backgrounded, boot autostart).
#   scripts/deploy.sh [host]
set -eu
HOST="${1:-push.local}"
SSH="ssh -o BatchMode=yes -o HostKeyAlias=push.local"
DIR=/data/push-hack/hacks/pung
cd "$(dirname "$0")/.."

$SSH "root@$HOST" "mkdir -p $DIR /data/push-hack/logs /data/push-hack/data/pung"
rsync -a -e "$SSH" build/modules build/patches overrides "root@$HOST:$DIR/"
# the licences travel with every copy (THIRD_PARTY_LICENSES.md)
rsync -a -e "$SSH" LICENSE THIRD_PARTY_LICENSES.md licenses "root@$HOST:$DIR/"
# the module catalog Pung ships (scripts/release.sh): the Modules page
# installs from it, from this Push's own disk
if [ -f dist/pung/catalog/catalog.json ]; then
  rsync -a --delete -e "$SSH" dist/pung/catalog "root@$HOST:$DIR/"
fi
# the pictures of each module's own interface, for the Modules page (make screens)
if [ -f build/screens/index.json ]; then
  rsync -a --delete -e "$SSH" build/screens/ "root@$HOST:$DIR/screens/"
fi
# the binary is swapped by rename, so a running copy keeps its file
rsync -a -e "$SSH" pung "root@$HOST:$DIR/pung.new"

# the Live plugin (push-hack's core/livedevice): the service installs it as
# /data/.vst3/Pung.vst3 and writes the browser entries itself, at every start
rsync -a -e "$SSH" livedevice.so "root@$HOST:$DIR/livedevice.so"
# Apply on the Modules page restarts Live with it (modroutes.go)
rsync -a -e "$SSH" restart-live.sh "root@$HOST:$DIR/restart-live.sh"

# hack.json: keep the port push-catalog assigned, if it did
PORT=$($SSH "root@$HOST" "grep -o '\"port\": *[0-9]*' $DIR/hack.json 2>/dev/null | grep -o '[0-9]*$'" || true)
rsync -a -e "$SSH" hack.json "root@$HOST:$DIR/hack.json"
if [ -n "$PORT" ]; then
  $SSH "root@$HOST" "sed -i 's/\"port\": *[0-9]*/\"port\": $PORT/' $DIR/hack.json"
fi

$SSH "root@$HOST" sh -s <<'REMOTE'
set -e
DIR=/data/push-hack/hacks/pung
SVC=push-hack-pung
cat > /etc/init.d/$SVC <<'INIT'
#!/bin/sh
### BEGIN INIT INFO
# Provides:          push-hack-pung
# Required-Start:    $local_fs $network
# Required-Stop:     $local_fs
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: push-hack: pung (via push-catalog)
### END INIT INFO
BIN="/data/push-hack/hacks/pung/pung"; CFG="/data/push-hack/hacks/pung/hack.json"; LOG="/data/push-hack/logs/pung.log"; PIDF="${PIDF:-/var/run/push-hack-pung.pid}"
start() { echo "starting push-hack-pung"; mkdir -p "$(dirname "$LOG")"
  # Live preference changes waiting for a moment when Live is not running
  # (this service starts at S20, Push3 at S21). Synchronous on purpose.
  "$BIN" -boot-requests >>"$LOG" 2>&1
  nice -n 19 "$BIN" -config "$CFG" >>"$LOG" 2>&1 &
  echo $! >"$PIDF"; }
stop()  { echo "stopping push-hack-pung"; [ -f "$PIDF" ] || return 0
  p="$(cat "$PIDF")"; kill "$p" 2>/dev/null; i=0
  while kill -0 "$p" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
  kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
  rm -f "$PIDF"; }
case "$1" in start) start;; stop) stop;; restart) stop; start;;
  status) [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && echo active || echo inactive;;
  *) echo "usage: $0 {start|stop|restart|status}"; exit 1;; esac
INIT
chmod 755 /etc/init.d/$SVC
command -v update-rc.d >/dev/null 2>&1 && update-rc.d $SVC defaults >/dev/null 2>&1 || true
/etc/init.d/$SVC stop >/dev/null 2>&1 || true
pkill -x pung 2>/dev/null || true
mv -f $DIR/pung.new $DIR/pung
/etc/init.d/$SVC start
sleep 2
/etc/init.d/$SVC status
REMOTE
