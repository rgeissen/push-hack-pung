#!/usr/bin/env bash
# hand recipe: keydetect statically links libkeyfinder 2.2.8 and FFTW 3.3.10
# (double), which its Dockerfile downloads; here they come from /deps (fetched
# on the host, pinned to the same versions). Same link as its build.sh.
set -euo pipefail
. /hand/_data.sh
R=/modsrc/schwung-keydetect; D=/out/audio_fx/keydetect; T=/tmp/b-keydetect
rm -rf "$D" "$T"; mkdir -p "$D" "$T/prefix"
ARCH="-march=x86-64-v2 -mtune=generic"
cp -a /deps/fftw-3.3.10 "$T/fftw" && ( cd "$T/fftw" && CFLAGS="-O3 $ARCH" ./configure --prefix="$T/prefix" \
    --enable-static --disable-shared --disable-fortran --with-pic >/dev/null && make -j"${BUILD_JOBS:-4}" >/dev/null && make install >/dev/null )
cp -a /deps/libkeyfinder-2.2.8 "$T/lkf" && cmake -S "$T/lkf" -B "$T/lkf/build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$T/prefix" -DCMAKE_PREFIX_PATH="$T/prefix" -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_CXX_FLAGS="$ARCH" >/dev/null && cmake --build "$T/lkf/build" -j"${BUILD_JOBS:-4}" >/dev/null \
    && cmake --install "$T/lkf/build" >/dev/null
g++ -Ofast -fPIC -c $ARCH -std=c++11 -DNDEBUG -fno-gnu-unique -I"$T/prefix/include" "$R/src/dsp/keyfinder_wrapper.cpp" -o "$T/w.o"
gcc -Ofast -fPIC -c $ARCH -fomit-frame-pointer -fno-stack-protector -DNDEBUG -I"$R/src/dsp" -I/schwung/src -I/schwung/src/host \
    "$R/src/dsp/keydetect.c" -o "$T/k.o"
g++ -shared $ARCH -Wl,--exclude-libs,ALL "$T/k.o" "$T/w.o" -L"$T/prefix/lib" -L"$T/prefix/lib64" -lkeyfinder -lfftw3 \
    -lm -lpthread -static-libstdc++ -static-libgcc -o "$D/keydetect.so"
module_data src
rm -rf "$T"
