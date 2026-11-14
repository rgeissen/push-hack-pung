#!/usr/bin/env bash
# Builds catalog modules for Push 3 (x86_64, glibc 2.35) from their source.
# Runs INSIDE the builder container. Each recipe below is the compile line of
# that module's own scripts/build.sh, with the ARM flags (-march=armv8-a,
# -mtune=cortex-a72) dropped. Only the compiler runs over the module source;
# no script from a module repo is executed.
#
#   /modsrc  module repos, one folder each (read only)
#   /out     the Schwung module tree (same as build-modules.sh)
set -euo pipefail
OUT=/out
CXX=x86_64-linux-gnu-g++
CC=x86_64-linux-gnu-gcc
ARCH="-march=x86-64-v2 -mtune=generic"
NO_UNIQUE="-fno-gnu-unique"

# copy the module's data files (never its sources) into $1
copy_data() { # dest repo
    local dest=$1 repo=$2 f
    for f in module.json help.json ui.js ui_chain.js web_ui.html canvas.js cards.js; do
        [ -f "$repo/src/$f" ] && cp "$repo/src/$f" "$dest/"
    done
    [ -d "$repo/src/chain_patches" ] && cp -R "$repo/src/chain_patches" "$dest/"
    [ -d "$repo/src/presets" ] && cp -R "$repo/src/presets" "$dest/"
    [ -d "$repo/banks" ] && cp -R "$repo/banks" "$dest/"
    for f in LICENSE THIRD_PARTY_LICENSES THIRD_PARTY_LICENSES.md; do
        [ -f "$repo/$f" ] && cp "$repo/$f" "$dest/"
    done
    return 0
}

build() { # id category repo
    local id=$1 cat=$2 repo=/modsrc/$3
    [ -d "$repo" ] || { echo "-- $id: no source at $repo"; return 0; }
    local dest=$OUT/$cat/$id tmp=/tmp/b-$id
    rm -rf "$dest" "$tmp"; mkdir -p "$dest" "$tmp"
    echo "== $id"
    if "recipe_${id//-/_}" "$repo" "$dest" "$tmp" >"$tmp/log" 2>&1; then
        copy_data "$dest" "$repo"
        echo "   -> $cat/$id"
    else
        echo "   FAILED"; tail -12 "$tmp/log" | sed 's/^/   /'
        rm -rf "$dest"
    fi
}

recipe_braids() { local r=$1 d=$2 t=$3 s
    for s in braids/macro_oscillator.cc braids/analog_oscillator.cc braids/digital_oscillator.cc \
             braids/resources.cc braids/quantizer.cc stmlib/utils/random.cc braids_plugin.cpp; do
        $CXX -O3 $ARCH -fPIC -std=c++14 $NO_UNIQUE -DTEST -I"$r/src/dsp" -c "$r/src/dsp/$s" -o "$t/$(basename "${s%.*}").o"
    done
    $CXX -shared "$t"/*.o -o "$d/dsp.so" -lm
}

recipe_obxd() { local r=$1 d=$2
    $CXX -O3 $ARCH -shared -fPIC -std=c++14 $NO_UNIQUE "$r/src/dsp/obxd_plugin.cpp" -o "$d/dsp.so" -I"$r/src/dsp" -lm
}

recipe_dexed() { local r=$1 d=$2 m=$1/src/dsp/msfa
    $CXX -O3 $ARCH -shared -fPIC -std=c++14 $NO_UNIQUE \
        "$r/src/dsp/dx7_plugin.cpp" $m/dx7note.cc $m/env.cc $m/exp2.cc $m/fm_core.cc \
        $m/fm_op_kernel.cc $m/freqlut.cc $m/lfo.cc $m/pitchenv.cc $m/sin.cc $m/porta.cpp \
        -o "$d/dsp.so" -I"$r/src/dsp" -lm
}

# audio FX: the chain host loads audio_fx/<id>/<id>.so
fx_c() { local r=$1 d=$2 src=$3 id=$4
    $CC -Ofast $ARCH -shared -fPIC -fomit-frame-pointer -fno-stack-protector -DNDEBUG \
        "$r/src/dsp/$src" -o "$d/$id.so" -I"$r/src/dsp" -lm
}
recipe_hera() { local r=$1 d=$2 e=$1/src/dsp/Engine
    $CXX -O3 $ARCH -shared -fPIC -std=c++14 $NO_UNIQUE "$r/src/dsp/hera_plugin.cpp" \
        $e/HeraEnvelope.cpp $e/HeraLFO.cpp $e/HeraLFOWithEnvelope.cpp $e/HeraTables.cpp \
        $e/bbd_line.cpp $e/bbd_filter.cpp -o "$d/dsp.so" -I"$r/src/dsp" -I"$e" -lm
}

recipe_mverb() { local r=$1 d=$2
    $CXX -O3 $ARCH -shared -fPIC $NO_UNIQUE -fomit-frame-pointer -fno-stack-protector -DNDEBUG \
        "$r/src/dsp/mverb.cpp" -o "$d/mverb.so" -I"$r/src/dsp" -lm
}

recipe_ottx() { local r=$1 d=$2
    $CC -O3 $ARCH -shared -fPIC "$r/src/dsp/ottx.c" -o "$d/ottx.so" -I"$r/src/dsp" -lm
}

recipe_ducker() { local r=$1 d=$2
    $CC -Ofast -fno-finite-math-only $ARCH -shared -fPIC "$r/src/dsp/ducker.c" -o "$d/ducker.so" -I"$r/src/dsp" -lm
}

recipe_cloudseed()        { fx_c "$1" "$2" cloudseed.c cloudseed; }
recipe_tapescam()         { fx_c "$1" "$2" tapescam.c tapescam; }
recipe_psxverb()          { fx_c "$1" "$2" psxverb.c psxverb; }
recipe_tapedelay()        { fx_c "$1" "$2" spacecho.c tapedelay; }
recipe_junologue_chorus() { fx_c "$1" "$2" junologue_chorus.c junologue-chorus; }

build braids           sound_generators schwung-braids
build obxd             sound_generators schwung-obxd
build dexed            sound_generators schwung-dx7
build cloudseed        audio_fx         schwung-cloudseed
build tapedelay        audio_fx         schwung-space-delay
build junologue-chorus audio_fx         schwung-junologue-chorus
build hera             sound_generators schwung-hera
build mverb            audio_fx         schwung-mverb
build ottx             audio_fx         schwung-ottx
build ducker           audio_fx         schwung-ducker
build tapescam         audio_fx         schwung-tapescam
build psxverb          audio_fx         schwung-psxverb
echo "== done"
