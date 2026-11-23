#!/usr/bin/env bash
# hand recipe: frodhes builds for Move from its Makefile's move-native target
# (build.sh is its FM-1 firmware build): engine.so is move/move_plugin.c (the
# firmware in one unit, with its coroutine), dsp.so the loader that gives each
# slot its own copy of engine.so. The generator read the whole Makefile and
# mixed the firmware's, the tests' and the host builds' files and defines.
# move/coro/coro_aarch64.S is the coroutine's switch for aarch64 only; on any
# other CPU coro.h switches with ucontext (swapcontext), which needs no file.
# module.json's version is its release's (the Makefile's MOVE_VER), as there.
set -euo pipefail
R=/modsrc/frodhes; D=/out/sound_generators/frodhes
rm -rf "$D"; mkdir -p "$D"
VER=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$R/release.json")
A="-march=x86-64-v2 -mtune=generic"
gcc -O2 -fPIC -ffp-contract=off -std=gnu11 $A -fvisibility=hidden -DAPP_VER="\"$VER\"" -DAPP_GIT='""' \
    -DFR_VOICES=16u -DFR_HQ=1 -DFR_BYP_KEEP_CMP=1 -DFR_REV_HQ=1 \
    -I"$R/move/compat" -I"$R/firmware/src" -I"$R/firmware/gen" \
    -shared -Wl,-z,defs -o "$D/engine.so" "$R/move/move_plugin.c" -lm
gcc -O2 -fPIC -std=gnu11 $A -fvisibility=hidden -I"$R/move" \
    -shared -Wl,-z,defs -o "$D/dsp.so" "$R/move/move_loader.c" -ldl -lpthread
sed 's/"version": "0.0.0-dev"/"version": "'"$VER"'"/' "$R/move/module/module.json" > "$D/module.json"
for f in help.json screen.js canvas.js ui_chain.js; do [ -f "$R/move/module/$f" ] && cp "$R/move/module/$f" "$D/"; done
cp "$R/LICENSE" "$D/LICENSE"
