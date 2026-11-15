#!/usr/bin/env bash
# hand recipe: sfz (Multisampler) links the xsynth shim, a Rust staticlib
# built with the nightly it pins (2026-05-18, in docker/Dockerfile.modules),
# offline from the crates fetched into /deps/cargo-home. Then its two C files
# and its link line, for x86_64.
set -euo pipefail
. /hand/_data.sh
R=/modsrc/schwung-sfz; D=/out/sound_generators/sfz; T=/tmp/b-sfz
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
command -v cargo >/dev/null || { echo "sfz needs the Rust builder image (push-hack-pung-modules)"; exit 1; }
cp -a /deps/cargo-home "$T/cargo"; cp -a "$R/src/dsp/third_party" "$T/tp"
( cd "$T/tp/xsynth_shim" && CARGO_HOME="$T/cargo" RUSTFLAGS="-C target-cpu=x86-64-v2" cargo build --release --offline )
A="-march=x86-64-v2 -mtune=generic"
for s in xsynth_plugin dspreset_to_xsynth_sfz; do
    gcc -O3 -fPIC $A -DNDEBUG -I"$R/src/dsp" -I/schwung/src -I/schwung/src/host -c "$R/src/dsp/$s.c" -o "$T/$s.o"
done
gcc -O3 -shared -fPIC $A "$T/xsynth_plugin.o" "$T/dspreset_to_xsynth_sfz.o" \
    "$T/tp/xsynth_shim/target/release/libxsynth_shim.a" -o "$D/dsp.so" -lm -lpthread -ldl -lrt
module_data src
mkdir -p "$D/instruments"
rm -rf "$T"
