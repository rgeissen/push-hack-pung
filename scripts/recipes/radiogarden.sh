#!/usr/bin/env bash
# hand recipe: the generated one plus ui_contract.h, which its build.sh makes from src/*.json
set -euo pipefail
R=/modsrc/schwung-radiogarden; D=/out/sound_generators/radiogarden; T=/tmp/b-radiogarden
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
python3 /hand/_ui_contract.py "$T"/ui_contract.h RG_UI_HIERARCHY "$R"/src/ui_hierarchy.json RG_CHAIN_PARAMS "$R"/src/chain_params.json
CF=(-O3 -march=x86-64-v2 -mtune=generic -fPIC -DNDEBUG    -I"$R"/src/dsp -I/schwung/src -I/schwung/src/host -I"$T")
gcc "${CF[@]}" -std=gnu11 -c "$R"/src/dsp/radio_stream_plugin.c -o "$T"/0.o
mkdir -p "$(dirname "$D"/dsp.so)"
gcc -shared "$T"/*.o -o "$D"/dsp.so   -lm -lpthread -ldl
( cd "$R"/src && find . -path ./dsp -prune -o -type f -print | grep -Ev '\.(c|cc|cpp|cxx|h|hpp|hh|hxx|inc|ipp|o|a|s|S|rs|dsp|cmake|mk|so|py|sh|toml|lock)$|/\.git/|/(build|dist|tests?|node_modules)/' | while read -r f; do mkdir -p "$D/$(dirname "$f")"; cp "$f" "$D/$f"; done )
[ -f "$R"/LICENSE ] && cp "$R"/LICENSE "$D"/ || true
[ -f "$R"/LICENSE.md ] && cp "$R"/LICENSE.md "$D"/ || true
[ -f "$R"/LICENSE.txt ] && cp "$R"/LICENSE.txt "$D"/ || true
[ -f "$R"/THIRD_PARTY_LICENSES ] && cp "$R"/THIRD_PARTY_LICENSES "$D"/ || true
[ -f "$R"/THIRD_PARTY_LICENSES.md ] && cp "$R"/THIRD_PARTY_LICENSES.md "$D"/ || true
[ -f "$R"/NOTICE ] && cp "$R"/NOTICE "$D"/ || true
rm -rf "$T"
