#!/usr/bin/env bash
# Fetches what some catalog modules download during their own build (their
# Dockerfiles and build scripts do it; our builds run with no network), into
# build/deps, at the versions those scripts name. Run on the host, once.
#
#   scripts/fetch-deps.sh
#
#   keydetect       fftw 3.3.10, libkeyfinder 2.2.8
#   dragonfly-hall  dragonfly-reverb 3.2.10 (with submodules)
#   dj              bungee, libxmp, minimp3 (HEAD, as dj's script takes them),
#                   fdk-aac v2.0.3 (newer has another layout: dj's script then
#                   silently builds without M4A)
#   kit-builder     dropbear 2026.94
#   sfz             its Rust crates, into build/deps/cargo-home (needs the
#                   push-hack-pung-modules image, docker/Dockerfile.modules)
#   model-72,       their Rust engines' crates (Cargo.lock), into the same
#   chimera         cargo-home
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/deps
cd build/deps
tgz() { # dir url
    [ -d "$1" ] || { curl -fsSL -o dl.tgz "$2" && tar xzf dl.tgz && rm dl.tgz; }
}
tgz fftw-3.3.10 http://www.fftw.org/fftw-3.3.10.tar.gz
tgz libkeyfinder-2.2.8 https://github.com/mixxxdj/libkeyfinder/archive/refs/tags/2.2.8.tar.gz
tgz dropbear-DROPBEAR_2026.94 https://github.com/mkj/dropbear/archive/refs/tags/DROPBEAR_2026.94.tar.gz
[ -d dragonfly-reverb ] || git clone -q --depth 1 --branch 3.2.10 --recurse-submodules --shallow-submodules \
    https://github.com/michaelwillis/dragonfly-reverb.git
[ -d bungee ] || git clone -q --depth 1 --recurse-submodules --shallow-submodules https://github.com/bungee-audio-stretch/bungee.git
[ -d libxmp ] || git clone -q --depth 1 https://github.com/libxmp/libxmp.git
[ -d minimp3 ] || git clone -q --depth 1 https://github.com/lieff/minimp3.git
[ -d fdk-aac ] || git clone -q --depth 1 --branch v2.0.3 https://github.com/mstorsjo/fdk-aac.git
cd ../..
if [ -d build/modsrc/schwung-sfz ]; then
    mkdir -p build/deps/cargo-home
    docker run --rm --platform linux/amd64 -v "$PWD/build/modsrc/schwung-sfz:/r:ro" -v "$PWD/build/deps/cargo-home:/cargo" \
        push-hack-pung-modules bash -c 'cp -a /r/src/dsp/third_party /tmp/tp && cd /tmp/tp/xsynth_shim && CARGO_HOME=/cargo cargo fetch -q'
fi
for e in schwung-model72/engine schwung-chimera/engine; do
    [ -f "build/modsrc/$e/Cargo.lock" ] || continue
    mkdir -p build/deps/cargo-home
    docker run --rm --platform linux/amd64 -v "$PWD/build/modsrc/$e:/r:ro" -v "$PWD/build/deps/cargo-home:/cargo" \
        push-hack-pung-modules bash -c 'cp -a /r /tmp/e && cd /tmp/e && CARGO_HOME=/cargo cargo fetch -q --locked'
done
for d in build/deps/*/; do [ -d "$d/.git" ] && echo "$(basename "$d") $(git -C "$d" rev-parse --short HEAD)"; done
