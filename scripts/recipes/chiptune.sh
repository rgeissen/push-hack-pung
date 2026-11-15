#!/usr/bin/env bash
# hand recipe: two copies of blargg's Blip_Buffer (NES and GB) in one .so. Its
# build.sh compiles the GB one hidden, partial-links it and localizes the
# hidden symbols so the two never meet; the same steps here, for x86_64.
set -euo pipefail
. /hand/_data.sh
R=/modsrc/schwung-chiptune; D=/out/sound_generators/chiptune; T=/tmp/b-chiptune
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
CX=(g++ -O3 -fPIC -std=c++14 -march=x86-64-v2 -mtune=generic -fno-gnu-unique -DNDEBUG)
for s in Nes_Apu Nes_Oscs Blip_Buffer; do
    "${CX[@]}" -I"$R/src/libs/nes_snd_emu" -c "$R/src/libs/nes_snd_emu/nes_apu/$s.cpp" -o "$T/$s.o"
done
for s in Gb_Apu Gb_Oscs Blip_Buffer Multi_Buffer gb_apu_wrapper; do
    "${CX[@]}" -fvisibility=hidden -I"$R/src/libs/gb_snd_emu" -c "$R/src/libs/gb_snd_emu/$s.cpp" -o "$T/gb_$s.o"
done
ld -r "$T"/gb_*.o -o "$T/gb.o.r" && objcopy --localize-hidden "$T/gb.o.r" "$T/gb_combined.o"
"${CX[@]}" -I"$R/src/dsp" -I"$R/src/libs/nes_snd_emu" -I"$R/src/libs/gb_snd_emu" -I/schwung/src -I/schwung/src/host \
    -c "$R/src/dsp/chiptune_plugin.cpp" -o "$T/plugin.o"
g++ -shared "$T/plugin.o" "$T/Nes_Apu.o" "$T/Nes_Oscs.o" "$T/Blip_Buffer.o" "$T/gb_combined.o" -o "$D/dsp.so" -lm
module_data src
rm -rf "$T"
