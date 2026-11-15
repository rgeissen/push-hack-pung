#!/usr/bin/env bash
# hand recipe: the generated one, with bungee built as its build.sh builds it (_bungee.sh):
# its defines carry quotes and parentheses that the generator cannot keep
set -euo pipefail
. /hand/_data.sh
. /hand/_bungee.sh
R=/modsrc/move-anything-slicer; D=/out/sound_generators/slicer; T=/tmp/b-slicer
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
CF=(-O3 -march=x86-64-v2 -mtune=generic -fPIC -DNDEBUG -ffast-math -fno-finite-math-only -fno-exceptions -fwrapv -DBUNGEE_SELF_TEST=0 -Deigen_assert=BUNGEE_ASSERT1 -DEIGEN_DONT_PARALLELIZE=1   -I"$R"/src/bungee/submodules/eigen -I"$R"/src/bungee/submodules -I"$R"/src/bungee -I"$R"/src -I"$R"/src/bungee/submodules/pffft -I"$R"/src/dsp -I/schwung/src -I/schwung/src/host)
g++ "${CF[@]}" -std=c++20 -fno-gnu-unique -c "$R"/src/dsp/dsp.cpp -o "$T"/15.o
mkdir -p "$(dirname "$D"/dsp.so)"
build_bungee "$R"/src/bungee "$T"/libbungee.a
g++ -shared "$T"/*.o "$T"/libbungee.a -o "$D"/dsp.so -ffast-math -fno-finite-math-only -fno-exceptions -fwrapv  -lm -lpthread -ldl
( cd "$R"/src && find . -path ./dsp -prune -o -type f -print | grep -Ev '\.(c|cc|cpp|cxx|h|hpp|hh|hxx|inc|ipp|o|a|s|S|rs|dsp|cmake|mk|so|py|sh|toml|lock)$|/\.git/|/(build|dist|tests?|node_modules)/' | while read -r f; do mkdir -p "$D/$(dirname "$f")"; cp "$f" "$D/$f"; done )
[ -f "$R"/LICENSE ] && cp "$R"/LICENSE "$D"/ || true
[ -f "$R"/LICENSE.md ] && cp "$R"/LICENSE.md "$D"/ || true
[ -f "$R"/LICENSE.txt ] && cp "$R"/LICENSE.txt "$D"/ || true
[ -f "$R"/THIRD_PARTY_LICENSES ] && cp "$R"/THIRD_PARTY_LICENSES "$D"/ || true
[ -f "$R"/THIRD_PARTY_LICENSES.md ] && cp "$R"/THIRD_PARTY_LICENSES.md "$D"/ || true
[ -f "$R"/NOTICE ] && cp "$R"/NOTICE "$D"/ || true
mkdir -p "$D"/.; cp -R "$R"/module.json "$D"/. 2>/dev/null || true
mkdir -p "$D"/.; cp -R "$R"/ui_chain.js "$D"/. 2>/dev/null || true
mkdir -p "$D"/.; cp -R "$R"/help.json "$D"/. 2>/dev/null || true
rm -rf "$T"
