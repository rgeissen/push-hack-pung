#!/usr/bin/env bash
# hand recipe: Vivace, a Pung-native module (native/vivace, synced to
# /modsrc/pung-vivace with the synth's GPLv3 source in libs/engine). Its own
# CMake, for x86_64 with AVX2 (the Push 3's i3-1115G4; the module is built for
# nothing else). The factory sounds are written by the engine itself at build
# time (vivace-export, dsp/vivace_factory.cpp): no preset comes from anywhere.
set -euo pipefail
R=/modsrc/pung-vivace; D=/out/sound_generators/vivace; T=/tmp/b-vivace
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
A="-march=x86-64-v3 -mtune=generic"
E=$R/libs/engine
if ls "$R"/patches/*.patch >/dev/null 2>&1; then
    mkdir -p "$T/e"; cp -a "$E/src" "$E/third_party" "$T/e/"
    for p in "$R"/patches/*.patch; do patch -d "$T/e" -p1 < "$p"; done
    E=$T/e
fi
cmake -S "$R" -B "$T/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DENGINE_SOURCE="$E" \
    -DSCHWUNG_SRC=/schwung/src -DCMAKE_C_FLAGS="$A" -DCMAKE_CXX_FLAGS="$A"
cmake --build "$T/build" --target vivace-dsp vivace-export -j"${BUILD_JOBS:-4}"
cp "$T/build/dsp.so" "$D/dsp.so"
cp "$R/module.json" "$D/module.json"
for f in push_ui.js help.json; do [ -f "$R/$f" ] && cp "$R/$f" "$D/$f"; done
"$T/build/vivace-export" factory "$D/factory"
cp "$R/libs/engine/LICENSE" "$D/LICENSE"
mkdir -p "$D/licenses"
cp "$R/licenses/"* "$D/licenses/"
cp "$R/libs/engine/third_party/concurrentqueue/LICENSE.md" "$D/licenses/concurrentqueue-BSD.txt"
sed -n '/Licensed under the MIT License/,/SOFTWARE\./p' "$R/libs/engine/third_party/json/json.h" > "$D/licenses/nlohmann-json-MIT.txt"
rm -rf "$T"
