#!/usr/bin/env bash
# hand recipe: NAM links NeuralAudio + RTNeural (static, built with their own
# CMake from deps/NeuralAudio, a submodule) into nam.so. Same options and
# defines as its build.sh, for x86_64; from a writable copy of the deps.
set -euo pipefail
. /hand/_data.sh
R=/modsrc/schwung-nam; D=/out/audio_fx/nam; T=/tmp/b-nam
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
A="-march=x86-64-v2 -mtune=generic"
cp -a "$R/deps/NeuralAudio" "$T/na"
cmake -S "$T/na" -B "$T/build" -G Ninja -DCMAKE_CXX_STANDARD=20 -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-Ofast $A -DNDEBUG -fno-gnu-unique" -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DBUILD_UTILS=OFF -DBUILD_NAMCORE=OFF -DBUILD_STATIC_RTNEURAL=OFF -DWAVENET_FRAMES=128 -DBUFFER_PADDING=8
cmake --build "$T/build" -j4
NA_LIB=$(find "$T/build" -name libNeuralAudio.a | head -1); RT_LIB=$(find "$T/build" -name libRTNeural.a | head -1)
gcc -O2 -fPIC $A -c "$R/src/dsp/pffft/pffft.c" -o "$T/pffft.o"
N=$R/deps/NeuralAudio
g++ -Ofast -shared -fPIC -std=c++20 $A -fomit-frame-pointer -fno-stack-protector -fno-gnu-unique -Wl,--exclude-libs,ALL \
    -DNDEBUG -DNAM_SAMPLE_FLOAT -DDSP_SAMPLE_FLOAT -DLSTM_MATH=FastMath -DWAVENET_MATH=FastMath \
    -DWAVENET_MAX_NUM_FRAMES=128 -DLAYER_ARRAY_BUFFER_PADDING=8 \
    "$R/src/dsp/nam_plugin.cpp" "$T/pffft.o" -o "$D/nam.so" \
    -I"$R/src/dsp" -I"$N" -I"$N/NeuralAudio" -I"$N/deps/RTNeural/modules/Eigen" -I"$N/deps/RTNeural/modules/json" \
    -I"$N/deps/RTNeural/modules/json/single_include" -I"$N/deps/RTNeural" -I"$N/deps/math_approx/include" \
    -I"$N/deps/RTNeural-NAM/wavenet" -I"$N/deps/NeuralAmpModelerCore" -I/schwung/src -I/schwung/src/host \
    "$NA_LIB" "$RT_LIB" -lm -lpthread
module_data src
cp "$N/LICENSE" "$D/LICENSE.NeuralAudio"
rm -rf "$T"
