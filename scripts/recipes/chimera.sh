#!/usr/bin/env bash
# hand recipe: chimera's plugin (src/dsp/chimera_plugin.c) calls its Rust engine
# (engine/, package chimera-move, a staticlib: chm_create ...), which its
# scripts/build.sh builds with cargo first. The same here, offline (_cargo.sh),
# then its link line and packaging, for x86_64.
set -euo pipefail
. /hand/_data.sh
. /hand/_cargo.sh
R=/modsrc/schwung-chimera; D=/out/sound_generators/chimera; T=/tmp/b-chimera
rm -rf "$D" "$T"; mkdir -p "$D"
cargo_staticlib "$R/engine" chimera-move "$T"
gcc -std=gnu11 -O2 -fPIC -shared -fvisibility=hidden -march=x86-64-v2 -mtune=generic -DNDEBUG \
    "$R/src/dsp/chimera_plugin.c" "$T/target/release/libchimera_move.a" -o "$D/dsp.so" -I"$R/src/dsp" \
    -static-libgcc -pthread -ldl -lm \
    -Wl,--version-script="$R/src/dsp/exports.map" -Wl,--exclude-libs,ALL -Wl,--gc-sections
# what its build.sh packs
cp "$R"/src/{module.json,ui.js,canvas.js,help.json,settings-schema.json} "$R/LICENSE" "$D/"
cp "$R/engine/public/data/cmudict.txt.gz" "$R/engine/public/data/CMUDICT-LICENSE.txt" "$D/"
rm -rf "$T"
