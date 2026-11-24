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
#
# Env: RENDER_SETTLE_MS (a synth silent while it takes a sound in),
# RENDER_NOTES=36,38,42 (other notes than the chord: a drum machine's pads),
# RENDER_WATCH=<key> (that key read four times a second while the chord plays).
# key=@file sets the key to that file's contents (copied in: a state with spaces).
# A module's own executables (OsTIrus's engine) are linked for the Push's
# loader path (/lib/ld-linux-x86-64.so.2): the container gets it too.
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
ARGS=()
for a in "$@"; do # key=@file: the file goes along, at /w/<name>
    if [[ "$a" == *=@* ]]; then f=${a#*=@}; cp "$f" "$WORK/$(basename "$f")"; a="${a%%=@*}=@/w/$(basename "$f")"; fi
    ARGS+=("$a")
done
set -- "${ARGS[@]}"
docker run --rm --platform linux/amd64 --shm-size=1g --network none ${PUNG_MC68K_LOG:+-e PUNG_MC68K_LOG=1} ${RENDER_SETTLE_MS:+-e RENDER_SETTLE_MS=$RENDER_SETTLE_MS} ${RENDER_NOTES:+-e RENDER_NOTES=$RENDER_NOTES} ${RENDER_WATCH:+-e RENDER_WATCH=$RENDER_WATCH} ${PUNG_SCAN_LOG:+-e PUNG_SCAN_LOG=1} -v "$PWD/scripts:/s:ro" -v "$(cd "$SCHWUNG" && pwd)/src:/schwung:ro" \
    -v "$WORK:/w" "$IMAGE" sh -c "ln -sf /lib64/ld-linux-x86-64.so.2 /lib/ld-linux-x86-64.so.2; gcc -O1 -I/schwung -o /tmp/rc /s/render-check.c -ldl -lm && /tmp/rc /w/$ID $*"
cp "$WORK/render-check.wav" "build/push-modules/$ID-render-check.wav" 2>/dev/null && echo "kept: build/push-modules/$ID-render-check.wav"
