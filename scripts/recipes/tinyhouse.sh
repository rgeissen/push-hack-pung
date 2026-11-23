#!/usr/bin/env bash
# hand recipe: TinyHouse is a CMake project in a folder of its repo
# (schwung-tablor/, built by its scripts/docker-build.sh), which the generator,
# reading the repo's root, does not see: it compiled src/dsp alone and left out
# src/ported (AudioFilter, the wavetables). Its CMake target "tablor" (dsp.so)
# for this machine, and what docker-build.sh and package.sh pack (the
# converter, Python with numpy for the Move, stays out: Pung does not run it).
set -euo pipefail
R=/modsrc/TinyHouse; P=$R/schwung-tablor; D=/out/sound_generators/tinyhouse; T=/tmp/b-tinyhouse
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
cp -a "$P" "$T/src"
cmake -S "$T/src" -B "$T/build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-march=x86-64-v2 -mtune=generic" -DCMAKE_POSITION_INDEPENDENT_CODE=ON
cmake --build "$T/build" --target tablor -j"${BUILD_JOBS:-4}"
cp "$T/build/dsp.so" "$D/dsp.so"
cp "$P"/src/{module.json,ui_pages.json,help.json,web_ui.html} "$P"/src/ui/{canvas.js,cards.js} "$D/"
mkdir -p "$D/wavetables" "$D/presets"
[ -d "$P/src/wavetables" ] && cp -r "$P/src/wavetables/." "$D/wavetables/" || true
cp "$R/LICENSE" "$D/LICENSE"; cp "$P/LICENSE" "$D/LICENSE-engine"; cp "$R/LICENSE-GPL-3.0" "$R/THIRD-PARTY.md" "$D/"
rm -rf "$T"
