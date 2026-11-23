#!/usr/bin/env bash
# hand recipe: Xenia, a Pung-native module (native/xenia, synced to
# /modsrc/pung-xenia with gearmulator in libs/). Its own CMake, for x86_64,
# from a writable copy: gearmulator's CMake writes a header into its tree.
set -euo pipefail
R=/modsrc/pung-xenia; D=/out/sound_generators/xenia; T=/tmp/b-xenia
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
A="-march=x86-64-v2 -mtune=generic"
mkdir -p "$T/g"; cp -a "$R/libs/gearmulator/source" "$T/g/source"
for p in "$R"/patches/*.patch; do patch -d "$T/g" -p1 < "$p"; done
cmake -S "$R" -B "$T/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DGEARMULATOR_SOURCE="$T/g/source" \
    -DSCHWUNG_SRC=/schwung/src -DCMAKE_C_FLAGS="$A" -DCMAKE_CXX_FLAGS="$A"
cmake --build "$T/build" --target xenia-dsp xenia-engine -j"${BUILD_JOBS:-4}"
cp "$T/build/dsp.so" "$D/dsp.so"
cp "$T/build/xenia-engine" "$D/xenia-engine" # the emulator's own process (dsp/waldorf_emu.cpp)
cp "$R/module.json" "$D/module.json"
for f in push_ui.js help.json; do [ -f "$R/$f" ] && cp "$R/$f" "$D/$f"; done
G=$R/libs/gearmulator
cp "$G/LICENSE.md" "$D/LICENSE"
mkdir -p "$D/licenses"
cp "$G/source/3rdparty/libresample/LICENSE-BSD.txt" "$D/licenses/libresample-BSD-3-Clause.txt"
cp "$G/source/cpu/dsp56300/source/asmjit/LICENSE.md" "$D/licenses/asmjit-Zlib.txt"
rm -rf "$T"
