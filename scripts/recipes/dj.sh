#!/usr/bin/env bash
# hand recipe: dj's build.sh clones bungee (time-stretch), libxmp, minimp3 and
# fdk-aac at build time. Here they come from /deps (fetched on the host) and go
# through the same steps: bungee + pffft static, libxmp-lite (MOD/XM/IT/S3M),
# minimp3 headers, fdk-aac's decoder, then one link. As in build.sh, a library
# file that does not compile is left out rather than failing the module.
set -euo pipefail
. /hand/_data.sh
R=/modsrc/move-anything-dj; D=/out/tools/dj; T=/tmp/b-dj
B=/deps/bungee; X=/deps/libxmp; M=/deps/minimp3; F=/deps/fdk-aac
rm -rf "$D" "$T"; mkdir -p "$D" "$T"/{bungee,xmp,aac}
A="-march=x86-64-v2 -mtune=generic"
gcc -O3 $A -fPIC -ffast-math -fno-finite-math-only -fno-exceptions -c "$B/submodules/pffft/pffft.c" -o "$T/bungee/pffft.o"
gcc -O3 $A -fPIC -ffast-math -fno-finite-math-only -fno-exceptions -c "$B/submodules/pffft/fftpack.c" -o "$T/bungee/fftpack.o"
for s in "$B"/src/*.cpp; do
    g++ -O3 $A -fPIC -std=c++20 -fwrapv -fno-gnu-unique -I"$B/submodules/eigen" -I"$B/submodules" -I"$B/submodules/pffft" -I"$B" \
        '-DBUNGEE_VISIBILITY=__attribute__((visibility("default")))' -DBUNGEE_SELF_TEST=0 -Deigen_assert=BUNGEE_ASSERT1 \
        -DEIGEN_DONT_PARALLELIZE=1 '-DBUNGEE_VERSION="0.0.0"' -c "$s" -o "$T/bungee/$(basename "$s" .cpp).o"
done
ar rcs "$T/libbungee.a" "$T"/bungee/*.o
for s in control dataio effects filter flow format hio lfo load load_helpers memio misc mix_all mix_paula mixer period \
         player read_event scan smix virtual filetype rng md5 miniz_tinfl extras hmn_extras med_extras far_extras \
         loaders/common loaders/mod_load loaders/xm_load loaders/s3m_load loaders/it_load loaders/itsex loaders/sample; do
    [ -f "$X/src/$s.c" ] || continue
    gcc -O2 $A -fPIC -I"$X/include" -I"$X/src" -DLIBXMP_CORE_PLAYER -c "$X/src/$s.c" -o "$T/xmp/$(echo "$s" | tr / _).o" 2>/dev/null || true
done
ar rcs "$T/libxmp-lite.a" "$T"/xmp/*.o
AINC=""; for d in libAACdec libFDK libSYS libMpegTPDec libSBRdec libPCMutils libDRCdec libArithCoding libSACdec libSACenc; do AINC="$AINC -I$F/$d/include"; done
for d in libFDK libSYS libMpegTPDec libAACdec libSBRdec libPCMutils libDRCdec libArithCoding libSACdec; do
    for s in "$F/$d/src"/*.cpp; do
        [ -f "$s" ] || continue
        g++ -O2 $A -fPIC -std=c++11 -fno-gnu-unique $AINC -c "$s" -o "$T/aac/$(basename "$s" .cpp).o" 2>/dev/null || true
    done
done
ar rcs "$T/libfdk-aac.a" "$T"/aac/*.o
g++ -O3 $A -shared -fPIC -std=c++20 -fno-gnu-unique -I"$B" -I/schwung/src -I/schwung/src/host \
    -DHAS_LIBXMP -I"$X/include" -DHAS_MP3 -I"$M" -DHAS_FLAC -I"$R/src/dsp" \
    -DHAS_M4A -I"$F/libAACdec/include" -I"$F/libSYS/include" -I"$F/libFDK/include" \
    "$R/src/dsp/dj_plugin.cpp" -o "$D/dsp.so" "$T/libbungee.a" "$T/libxmp-lite.a" "$T/libfdk-aac.a" -lm -lpthread
module_data src
for l in bungee libxmp minimp3 fdk-aac; do f=$(ls /deps/$l/LICENSE* /deps/$l/COPYING* /deps/$l/NOTICE 2>/dev/null | head -1 || true); [ -z "$f" ] || cp "$f" "$D/LICENSE.$l"; done
rm -rf "$T"
