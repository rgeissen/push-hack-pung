#!/bin/sh
# A module tree for Pung on macOS (docs/PUNG-MACOS.md): Schwung's chain host,
# its built-in modules, Pung's MIDI sink, and the first modules built from
# their sources for the Mac. The tree has the Push's layout and names (a
# Mach-O library may be called dsp.so: dlopen does not mind), as Schwung's own
# desktop build does it (its branch worktree-vst, desktop/build.sh).
#
#   macos/build-modules.sh        -> build/macos/dist/modules/
#
# Schwung's source is fetched into build/deps/schwung-vst (its branch
# worktree-vst, which has the chain host Pung ships). Module sources are the
# ones the Push builds use (build/modsrc/<repo>).
set -eu
cd "$(dirname "$0")/.."
ROOT=$PWD
S=$ROOT/build/deps/schwung-vst
OUT=$ROOT/build/macos/dist/modules
if [ ! -d "$S/src/modules/chain" ]; then
  mkdir -p "$S" && git -C "$S" init -q && git -C "$S" remote add origin https://github.com/charlesvestal/schwung.git
  git -C "$S" fetch -q --depth 1 origin worktree-vst && git -C "$S" checkout -q FETCH_HEAD
fi
SH="-dynamiclib -arch arm64 -mmacosx-version-min=14.4"
mkdir -p "$OUT/chain" "$OUT/audio_fx/freeverb" "$OUT/midi_fx/arp" "$OUT/midi_fx/chord" "$OUT/sound_generators/linein" "$OUT/sound_generators/midi-sink"

echo "== chain host ($(git -C "$S" log --oneline -1 | cut -c1-7))"
cc -g -O3 $SH "$S"/src/modules/chain/dsp/chain_host.c "$S"/src/modules/chain/dsp/chain_json.c \
   "$S"/src/modules/chain/dsp/chain_params.c "$S"/src/modules/chain/dsp/chain_mod.c "$S"/src/modules/chain/dsp/chain_midi.c \
   "$S"/src/modules/chain/dsp/chain_patch.c "$S"/src/modules/chain/dsp/chain_reorder.c "$S"/src/modules/chain/dsp/chain_bus.c \
   "$S"/src/host/unified_log.c -o "$OUT/chain/dsp.so" -I"$S/src" -lm -lpthread
cp "$S/src/modules/chain/module.json" "$OUT/chain/"

echo "== built-in modules"
cc -g -O3 $SH "$S/src/modules/audio_fx/freeverb/freeverb.c" -o "$OUT/audio_fx/freeverb/freeverb.so" -I"$S/src" -lm
cc -g -O3 $SH "$S/src/modules/midi_fx/arp/dsp/arp.c" -o "$OUT/midi_fx/arp/dsp.so" -I"$S/src"
cc -g -O3 $SH "$S/src/modules/midi_fx/chord/dsp/chord.c" -o "$OUT/midi_fx/chord/dsp.so" -I"$S/src"
cc -g -O3 $SH "$S/src/modules/sound_generators/linein/linein.c" -o "$OUT/sound_generators/linein/dsp.so" -I"$S/src" -lm
for m in audio_fx/freeverb midi_fx/arp midi_fx/chord sound_generators/linein; do
  for f in module.json help.json ui_chain.js web_ui.html; do
    [ -f "$S/src/modules/$m/$f" ] && cp "$S/src/modules/$m/$f" "$OUT/$m/"
  done
done
echo "== midi-sink"
cc -g -O2 $SH src/sink/midi_sink.c -o "$OUT/sound_generators/midi-sink/dsp.so" -I"$S/src"
cp src/sink/module.json "$OUT/sound_generators/midi-sink/"

# Braids: pure C++, the first module Schwung's own desktop build takes
B=$ROOT/build/modsrc/schwung-braids
if [ -d "$B/src/dsp" ]; then
  echo "== braids ($(git -C "$B" log --oneline -1 2>/dev/null | cut -c1-7))"
  mkdir -p "$OUT/sound_generators/braids" "$ROOT/build/macos/obj/braids"
  for src in braids/macro_oscillator.cc braids/analog_oscillator.cc braids/digital_oscillator.cc braids/resources.cc \
             braids/quantizer.cc stmlib/utils/random.cc braids_plugin.cpp; do
    c++ -O3 -fPIC -std=c++14 -arch arm64 -mmacosx-version-min=14.4 -DTEST -I"$B/src/dsp" -I"$B/src" -c "$B/src/dsp/$src" \
        -o "$ROOT/build/macos/obj/braids/$(basename "${src%.*}").o"
  done
  c++ $SH -o "$OUT/sound_generators/braids/dsp.so" "$ROOT"/build/macos/obj/braids/*.o -lm
  for f in module.json help.json ui_chain.js web_ui.html; do [ -f "$B/src/$f" ] && cp "$B/src/$f" "$OUT/sound_generators/braids/"; done
fi
find "$OUT" -name "*.so" | sed "s|$ROOT/||" | sort
