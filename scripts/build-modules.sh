#!/usr/bin/env bash
# Builds Schwung's chain host, its built-in modules and catalog modules for
# Push 3 (x86_64, glibc 2.35). Runs INSIDE the builder container
# (docker/Dockerfile); `make modules` starts it.
#
#   /pung  Schwung source (read only)
#   /modsrc   catalog module repos, one folder each (optional)
#   /out      result: a Schwung module tree (chain/, sound_generators/, ...)
#
# Every catalog module repo has scripts/build.sh. It skips its own Docker
# step inside a container (/.dockerenv) and compiles with ${CROSS_PREFIX}gcc,
# so CROSS_PREFIX=x86_64-linux-gnu- builds it for the Push unchanged.
set -euo pipefail

S=/schwung/src
OUT=/out
CC=x86_64-linux-gnu-gcc
mkdir -p "$OUT"

echo "== chain host"
mkdir -p "$OUT/chain"
$CC -g -O3 -shared -fPIC \
    $S/modules/chain/dsp/chain_host.c $S/modules/chain/dsp/chain_json.c \
    $S/modules/chain/dsp/chain_params.c $S/modules/chain/dsp/chain_mod.c \
    $S/modules/chain/dsp/chain_midi.c $S/modules/chain/dsp/chain_patch.c \
    $S/modules/chain/dsp/chain_reorder.c $S/modules/chain/dsp/chain_bus.c \
    $S/host/unified_log.c \
    -o "$OUT/chain/dsp.so" -I$S -lm -ldl -lpthread
cp $S/modules/chain/module.json "$OUT/chain/"
[ -f $S/modules/chain/help.json ] && cp $S/modules/chain/help.json "$OUT/chain/"

echo "== built-in modules"
mkdir -p "$OUT/audio_fx/freeverb" "$OUT/midi_fx/arp" "$OUT/midi_fx/chord" "$OUT/sound_generators/linein"
$CC -g -O3 -shared -fPIC $S/modules/audio_fx/freeverb/freeverb.c -o "$OUT/audio_fx/freeverb/freeverb.so" -I$S -lm
$CC -g -O3 -shared -fPIC $S/modules/midi_fx/arp/dsp/arp.c -o "$OUT/midi_fx/arp/dsp.so" -I$S
$CC -g -O3 -shared -fPIC $S/modules/midi_fx/chord/dsp/chord.c -o "$OUT/midi_fx/chord/dsp.so" -I$S
$CC -g -O3 -shared -fPIC $S/modules/sound_generators/linein/linein.c -o "$OUT/sound_generators/linein/dsp.so" -I$S -lm
for m in audio_fx/freeverb midi_fx/arp midi_fx/chord sound_generators/linein; do
    for f in module.json help.json ui_chain.js web_ui.html; do
        [ -f "$S/modules/$m/$f" ] && cp "$S/modules/$m/$f" "$OUT/$m/"
    done
done

echo "== midi-sink (the instrument behind a MIDI-effect device)"
mkdir -p "$OUT/sound_generators/midi-sink"
$CC -g -O2 -shared -fPIC /w/src/sink/midi_sink.c -o "$OUT/sound_generators/midi-sink/dsp.so" -I$S
cp /w/src/sink/module.json "$OUT/sound_generators/midi-sink/"

# category folder for a component_type, as Schwung's installer files them
category() {
    case "$1" in
        sound_generator) echo sound_generators ;;
        audio_fx) echo audio_fx ;;
        midi_fx) echo midi_fx ;;
        overtake) echo overtake ;;
        *) echo tools ;;
    esac
}

if [ -d /modsrc ]; then
    for repo in /modsrc/*/; do
        repo=${repo%/}
        [ -x "$repo/scripts/build.sh" ] || continue
        echo "== $(basename "$repo")"
        rm -rf "$repo/build" "$repo/dist"
        if ! (cd "$repo" && CROSS_PREFIX=x86_64-linux-gnu- ./scripts/build.sh >/tmp/build.log 2>&1); then
            echo "   FAILED, last lines:"; tail -15 /tmp/build.log | sed 's/^/   /'
            continue
        fi
        for d in "$repo"/dist/*/; do
            d=${d%/}
            [ -f "$d/module.json" ] || continue
            id=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$d/module.json")
            ct=$(python3 -c "import json,sys;m=json.load(open(sys.argv[1]));print(m.get('component_type') or m.get('capabilities',{}).get('component_type',''))" "$d/module.json")
            dest="$OUT/$(category "$ct")/$id"
            rm -rf "$dest"; mkdir -p "$dest"; cp -R "$d"/. "$dest"/
            arch=$(file -b "$dest"/*.so 2>/dev/null | head -1 | cut -c1-60)
            echo "   -> $(category "$ct")/$id  [$arch]"
        done
    done
fi
echo "== done"
