#!/usr/bin/env bash
# hand recipe: the generated one, with bungee built as its build.sh builds it (_bungee.sh):
# its defines carry quotes and parentheses that the generator cannot keep
set -euo pipefail
. /hand/_data.sh
. /hand/_bungee.sh
R=/modsrc/schwung-performance-fx; D=/out/overtake/performance-fx; T=/tmp/b-performance-fx
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
CF=(-Ofast -march=x86-64-v2 -mtune=generic -fPIC -DNDEBUG -fno-gnu-unique -ffast-math -fno-finite-math-only -fwrapv -DBUNGEE_SELF_TEST=0 -Deigen_assert=BUNGEE_ASSERT1 -DEIGEN_DONT_PARALLELIZE=1  -DNDEBUG  -I"$R"/src/dsp/bungee/submodules/eigen -I"$R"/src/dsp/bungee/submodules -I"$R"/src/dsp/bungee -I"$R"/src/dsp -I"$R"/src/dsp/bungee/submodules/pffft -I/schwung/src -I/schwung/src/host)
g++ "${CF[@]}" -std=c++20 -fno-gnu-unique -c "$R"/src/dsp/pfx_bungee.cpp -o "$T"/15.o
gcc "${CF[@]}" -std=gnu11 -c "$R"/src/dsp/perf_fx_plugin.c -o "$T"/16.o
gcc "${CF[@]}" -std=gnu11 -c "$R"/src/dsp/perf_fx_dsp.c -o "$T"/17.o
mkdir -p "$(dirname "$D"/dsp.so)"
build_bungee "$R"/src/dsp/bungee "$T"/libbungee.a
g++ -shared "$T"/*.o "$T"/libbungee.a -o "$D"/dsp.so -fno-gnu-unique -ffast-math -fno-finite-math-only -fwrapv  -lm -lpthread -ldl
( cd "$R"/src && find . -path ./dsp -prune -o -type f -print | grep -Ev '\.(c|cc|cpp|cxx|h|hpp|hh|hxx|inc|ipp|o|a|s|S|rs|dsp|cmake|mk|so|py|sh|toml|lock)$|/\.git/|/(build|dist|tests?|node_modules)/' | while read -r f; do mkdir -p "$D/$(dirname "$f")"; cp "$f" "$D/$f"; done )
[ -f "$R"/LICENSE ] && cp "$R"/LICENSE "$D"/ || true
[ -f "$R"/LICENSE.md ] && cp "$R"/LICENSE.md "$D"/ || true
[ -f "$R"/LICENSE.txt ] && cp "$R"/LICENSE.txt "$D"/ || true
[ -f "$R"/THIRD_PARTY_LICENSES ] && cp "$R"/THIRD_PARTY_LICENSES "$D"/ || true
[ -f "$R"/THIRD_PARTY_LICENSES.md ] && cp "$R"/THIRD_PARTY_LICENSES.md "$D"/ || true
[ -f "$R"/NOTICE ] && cp "$R"/NOTICE "$D"/ || true
rm -rf "$T"
