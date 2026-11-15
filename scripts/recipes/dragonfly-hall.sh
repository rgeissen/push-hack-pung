#!/usr/bin/env bash
# hand recipe: dragonfly-hall's Dockerfile clones dragonfly-reverb 3.2.10 and
# links the hall plugin's DSP objects into the module. Here the same sources
# (the plugin's FILES_DSP minus DPF's Plugin.cpp, as its Dockerfile links)
# come from /deps/dragonfly-reverb and are compiled directly.
set -euo pipefail
. /hand/_data.sh
R=/modsrc/move-anything-dragonfly-hall; D=/out/audio_fx/dragonfly-hall; T=/tmp/b-dragonfly-hall
DF=/deps/dragonfly-reverb; P=$DF/plugins/dragonfly-hall-reverb
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
ARCH="-march=x86-64-v2 -mtune=generic"
INC=(-I"$P" -I"$DF/common" -I"$DF/dpf/distrho" -I/schwung/src -I/schwung/src/host)
n=0
for s in "$R/src/dsp/hall_plugin.cpp" "$P/DSP.cpp" "$DF"/common/freeverb/{allpass,biquad,comb,delay,delayline,earlyref,efilter,nrev,nrevb,progenitor,progenitor2,revbase,slot,strev,utils,zrev,zrev2}.cpp; do
    g++ -O2 $ARCH -fPIC -std=c++14 -w -fno-gnu-unique -DNDEBUG -DLIBFV3_FLOAT "${INC[@]}" -c "$s" -o "$T/$n.o"; n=$((n+1))
done
for s in "$DF"/common/kiss_fft/kiss_fft.c "$DF"/common/kiss_fft/kiss_fftr.c; do
    gcc -O2 $ARCH -fPIC -w "${INC[@]}" -c "$s" -o "$T/$n.o"; n=$((n+1))
done
g++ -shared -fPIC "$T"/*.o -lm -o "$D/dragonfly-hall.so"
module_data src
cp "$DF/LICENSE" "$D/LICENSE.dragonfly-reverb"
rm -rf "$T"
