#!/usr/bin/env bash
# render-check.sh <module id> <assets dir> [seconds] [key=value ...]
#
# Hears a built sound generator without Live (scripts/render-check.c): the
# x86-64 dsp.so from build/push-modules, in the modules' build image, with the
# module's firmware and sounds copied in from <assets dir> (folders as the
# module's assets name them: roms/, sounds/). Firmware never enters the
# repository: the assets dir is wherever the user keeps them.
#
#   scripts/render-check.sh vavra ~/scratch/vavra-assets 2 bank_select="Bank A" preset=5
set -euo pipefail
cd "$(dirname "$0")/.."
ID=$1; ASSETS=$(cd "$2" && pwd); shift 2
SCHWUNG=${SCHWUNG:-../schwung}
IMAGE=${IMAGE:-push-hack-pung-modules}
MOD=$(find build/push-modules/modules -maxdepth 2 -type d -name "$ID" | head -1)
[ -n "$MOD" ] || { echo "no build of $ID in build/push-modules/modules"; exit 2; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$ID"
cp -a "$MOD/." "$WORK/$ID/"
cp -a "$ASSETS/." "$WORK/$ID/"
docker run --rm --platform linux/amd64 --network none -v "$PWD/scripts:/s:ro" -v "$(cd "$SCHWUNG" && pwd)/src:/schwung:ro" \
    -v "$WORK:/w" "$IMAGE" sh -c "gcc -O1 -I/schwung -o /tmp/rc /s/render-check.c -ldl -lm && /tmp/rc /w/$ID $*"
cp "$WORK/render-check.wav" "build/push-modules/$ID-render-check.wav" 2>/dev/null && echo "kept: build/push-modules/$ID-render-check.wav"
