#!/usr/bin/env bash
# hand recipe: capicola compiles against a patched copy of its vendored lib
# (scripts/apply_patches.sh: src/dsp/lib/*.h + patches/*.patch -> build/lib).
# The same copy-and-patch here, then its compile line for x86_64.
set -euo pipefail
. /hand/_data.sh
R=/modsrc/schwung-capicola; D=/out/audio_fx/capicola; T=/tmp/b-capicola
rm -rf "$D" "$T"; mkdir -p "$D" "$T/lib"
cp "$R"/src/dsp/lib/*.h "$T/lib/"
for p in "$R"/patches/*.patch; do patch -d "$T/lib" -p1 --forward --silent < "$p"; done
g++ -std=c++17 -Ofast -shared -fPIC -march=x86-64-v2 -mtune=generic -fomit-frame-pointer -fno-stack-protector \
    -fno-gnu-unique -DNDEBUG "$R/src/dsp/capicola_plugin.cpp" "$R/src/dsp/capicola_engine.cpp" "$R/src/dsp/capicola_params.cpp" \
    -I"$T/lib" -I"$R/src/dsp" -I/schwung/src -I/schwung/src/host -o "$D/capicola.so" -lm
module_data src
rm -rf "$T"
