#!/usr/bin/env bash
# governor.sh <push-ip> bench [seconds] | rest <module> [trials] [long rest s] | load [seconds]
#
# The governor's checks, run on a Push (docs/GOVERNOR.md):
#   bench  the reference Set, pass or fail (scripts/governor-bench.py). Open a NEW Set on the
#          Push first: the benchmark loads six devices into the Set that is open.
#   rest   one emulator's rest, in depth (scripts/governor-rest.py): the device must be in the
#          open Set already. Cost awake and at rest, a first note's timing and sound after a
#          rest, a knob, a sound and a state read at rest, a long rest.
#   load   what everything costs now: GET /api/governor over the seconds given (default 10).
set -euo pipefail
cd "$(dirname "$0")"
HOST=${1:?push ip}; WHAT=${2:?bench | rest | load}; shift 2
SSH="ssh -o HostKeyAlias=push.local root@$HOST"
case "$WHAT" in
bench|rest)
    scp -q -o HostKeyAlias=push.local "governor-$WHAT.py" "root@$HOST:/tmp/governor-$WHAT.py"
    $SSH "python3 /tmp/governor-$WHAT.py $*; rc=\$?; rm -f /tmp/governor-$WHAT.py; exit \$rc" ;;
load)
    $SSH "wget -qO- 'http://127.0.0.1:7720/api/governor?seconds=${1:-10}'" | python3 -m json.tool ;;
*) echo "bench | rest | load"; exit 2 ;;
esac
