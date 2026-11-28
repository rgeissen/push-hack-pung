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
# RENDER_WATCH=<key> (that key read four times a second while the chord plays;
# RENDER_WATCH_MS another interval), RENDER_LATE=<ms> (render that long, paced, before
# the key=value arguments go in: a module that takes settings only once it has booted,
# and the JE-8086, which crashes this check without it), RENDER_SEQ=ch:note,ch:note
# (one held note after another in place of the chord, RENDER_SEQ_MS apart, the watched
# key read after each).
# key=@file sets the key to that file's contents (copied in: a state with spaces).
# A module's own executables (OsTIrus's engine) are linked for the Push's
# loader path (/lib/ld-linux-x86-64.so.2): the container gets it too.
set -euo pipefail
cd "$(dirname "$0")/.."
ID=$1; ASSETS=$(cd "$2" && pwd); shift 2
SCHWUNG=${SCHWUNG:-../schwung}
[ -f "$SCHWUNG/src/host/plugin_api_v1.h" ] || { echo "no Schwung source at $SCHWUNG (SCHWUNG=<folder>; git clone --depth 1 https://github.com/charlesvestal/schwung)" >&2; exit 2; }
IMAGE=${IMAGE:-push-hack-pung-modules}
MODULES=${RENDER_MODULES:-build/push-modules/modules} # (scripts/dev-module.sh builds into build/dev/out/modules)
MOD=$(find "$MODULES" -maxdepth 2 -type d -name "$ID" | head -1)
[ -n "$MOD" ] || { echo "no build of $ID in $MODULES"; exit 2; }
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
set -- ${ARGS[@]+"${ARGS[@]}"} # (the bash a Mac ships takes an empty list for an unset one)
docker run --rm --platform linux/amd64 --shm-size=1g --network none ${PUNG_MC68K_LOG:+-e PUNG_MC68K_LOG=1} ${RENDER_SETTLE_MS:+-e RENDER_SETTLE_MS=$RENDER_SETTLE_MS} ${RENDER_NOTES:+-e RENDER_NOTES=$RENDER_NOTES} ${RENDER_WATCH:+-e RENDER_WATCH=$RENDER_WATCH} ${RENDER_WATCH_MS:+-e RENDER_WATCH_MS=$RENDER_WATCH_MS} ${RENDER_LATE:+-e RENDER_LATE=$RENDER_LATE} ${RENDER_SEQ:+-e RENDER_SEQ=$RENDER_SEQ} ${RENDER_SEQ_MS:+-e RENDER_SEQ_MS=$RENDER_SEQ_MS} ${PUNG_SCAN_LOG:+-e PUNG_SCAN_LOG=1} -v "$PWD/scripts:/s:ro" -v "$(cd "$SCHWUNG" && pwd)/src:/schwung:ro" \
    -v "$WORK:/w" "$IMAGE" sh -c "ln -sf /lib64/ld-linux-x86-64.so.2 /lib/ld-linux-x86-64.so.2; gcc -O1 -I/schwung -o /tmp/rc /s/render-check.c -ldl -lm && /tmp/rc /w/$ID $*"
KEEP=$(dirname "$MODULES")/$ID-render-check.wav
cp "$WORK/render-check.wav" "$KEEP" 2>/dev/null && echo "kept: $KEEP"
