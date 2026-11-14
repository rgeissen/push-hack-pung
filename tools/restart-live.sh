#!/bin/sh
# restart-live.sh: restart Live on the Push 3 with no one at the Push. Runs ON
# the Push, as root. For a test that needs Live to start again (Live scans
# plugins only at start).
#
#   1. SIGTERM: Live saves its preferences (it does not quit: Push's own quit
#      asks "save changes?" on the Push screen, which needs a hand).
#   2. kill -9: the launcher (push3-launcher) sees Live gone and starts Live
#      and Push3 again within a second or two.
#   3. Live finds its crash marker (CrashDetection.cfg = "Running") and asks
#      "Would you like to recover your work?". This answers YES, by sending
#      the press of the display button under "Yes" (the 8th lower button,
#      CC 27) to Push3's MIDI input, the port the hardware feeds. It presses
#      only when Live's log shows that exact question after this restart.
#   4. Waits for the PushHack Remote Script (127.0.0.1:7704).
#
# Measured 2026-11-14 on Live 13.0b25: Live back in 2 s, the question in
# about 2 s more, the Set recovered with every track and device.
set -u
PREFS_DIR="/data/.config/Ableton/Live 13.0b25"
LOG="$PREFS_DIR/Log.txt"
MID=/data/push-hack/data/schwung/press-recover-yes.mid
QUESTION="Would you like to recover your work?"

say() { echo "restart-live: $*"; }

remote_up() {
  python3 -c "import socket,sys
try: socket.create_connection(('127.0.0.1',7704),timeout=2)
except Exception: sys.exit(1)"
}

old=$(pgrep -f '^/opt/push3/Live' | head -1)
[ -n "$old" ] || { say "Live is not running"; exit 1; }
lines=$(wc -l < "$LOG")

kill -TERM "$old"
sleep 6 # SavePrefs takes well under a second; give it room
kill -9 "$old" 2>/dev/null

new=""
for _ in $(seq 1 30); do
  sleep 1
  new=$(pgrep -f '^/opt/push3/Live' | head -1)
  [ -n "$new" ] && [ "$new" != "$old" ] && break
  new=""
done
[ -n "$new" ] || { say "the launcher did not start Live again within 30 s"; exit 1; }
say "Live started again (pid $new)"

asked=0
for _ in $(seq 1 60); do
  if tail -n +"$((lines + 1))" "$LOG" | grep -q "Message Box: .*$QUESTION"; then asked=1; break; fi
  if remote_up; then break; fi # no question: nothing to answer
  sleep 1
done

if [ "$asked" = 1 ]; then
  sleep 1 # the box is drawn just after it is logged
  # Push3's input: the RtMidi client the hardware's Live Port feeds
  port=$(aconnect -l | awk '/^client [0-9]+: .RtMidi Input Client/ {c=$2; sub(":","",c)} /Ableton Internal Input/ && c!="" {print c":0"; exit}')
  [ -n "$port" ] || { say "no Push3 input port found; answer the question on the Push"; exit 1; }
  python3 -c "
import struct
t = bytes([0x00,0xB0,27,127, 0x10,0xB0,27,0, 0x00,0xFF,0x2F,0x00])
open('$MID','wb').write(b'MThd'+struct.pack('>IHHH',6,0,1,96)+b'MTrk'+struct.pack('>I',len(t))+t)"
  aplaymidi -p "$port" "$MID" && say "answered Yes to the recovery question (port $port)"
fi

for _ in $(seq 1 60); do
  if remote_up; then say "Live is ready (Remote Script up)"; exit 0; fi
  sleep 1
done
say "the Remote Script did not come up within 60 s"
exit 1
