#!/bin/sh
# Pung's device layer for macOS (docs/PUNG-MACOS.md, the proof): the plugin
# Live loads (core's livedevice, with its macOS port: macos/patches), Steinberg's
# validator, and pungstub, a placeholder service that answers Live for every
# class of a Pung. Apple's command line tools are enough; Go, CMake and the VST3
# SDK are fetched into build/ (nothing is installed on the machine).
#
#   macos/build.sh                 build everything into build/macos/
#   macos/build.sh validate <classes.json>   and run the validator over a class file's classes
#
# The core source is taken from a clone of ableton-push-hack beside this
# repository, at the commit src/go.mod names.
set -eu
cd "$(dirname "$0")/.."
ROOT=$PWD
CORE_REPO=${CORE_REPO:-$ROOT/../ableton-push-hack}
COMMIT=$(sed -n 's/.*ableton-push-hack\/core v[^ ]*-\([0-9a-f]\{12\}\)$/\1/p' src/go.mod)
[ -n "$COMMIT" ] || { echo "src/go.mod does not name a core commit" >&2; exit 1; }
SDK_TAG=v3.8.1_build_84   # the VST3 SDK (MIT), the one core's Linux plugin is built with
GO_VERSION=1.25.4
CMAKE_VERSION=3.31.9
T=build/tools; D=build/deps; M=build/macos
mkdir -p $T $D $M

[ -x $T/go/bin/go ] || { echo "== Go $GO_VERSION"; curl -sL "https://go.dev/dl/go$GO_VERSION.darwin-arm64.tar.gz" | tar -xz -C $T; }
[ -d $T/cmake.app ] || { echo "== CMake $CMAKE_VERSION"
  curl -sL "https://github.com/Kitware/CMake/releases/download/v$CMAKE_VERSION/cmake-$CMAKE_VERSION-macos-universal.tar.gz" | tar -xz -C $T
  mv "$T/cmake-$CMAKE_VERSION-macos-universal/CMake.app" $T/cmake.app; rm -rf "$T/cmake-$CMAKE_VERSION-macos-universal"; }
[ -d $D/vst3sdk/pluginterfaces ] || { echo "== the VST3 SDK $SDK_TAG"
  git clone --quiet --depth 1 --branch "$SDK_TAG" --recursive --shallow-submodules https://github.com/steinbergmedia/vst3sdk.git $D/vst3sdk; }
GO=$ROOT/$T/go/bin/go; CMAKE=$ROOT/$T/cmake.app/Contents/bin/cmake

echo "== core at $COMMIT, with its macOS port"
rm -rf $M/core
git -C "$CORE_REPO" archive "$COMMIT" core | tar -x -C $M
(cd $M && patch -s -p1 < "$ROOT/macos/patches/core-darwin.patch")

echo "== the plugin"
V=$ROOT/$M/core/livedevice/vst3
mkdir -p "$V/.macbuild/src"
cp "$V/CMakeLists.mac.txt" "$V/.macbuild/src/CMakeLists.txt"
ln -sfn "$V/source" "$V/.macbuild/src/source"
ln -sfn "$V/test" "$V/.macbuild/src/test"
# (the SDK's build asks for Xcode's version; Apple's command line tools build it as well)
XCODE_VERSION=16.0 "$CMAKE" -S "$V/.macbuild/src" -B "$V/.macbuild/out" -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=Release \
  -DXCODE_VERSION=16.0 -DVST3SDK="$ROOT/$D/vst3sdk" > "$V/.macbuild/configure.log" 2>&1 || { tail -20 "$V/.macbuild/configure.log"; exit 1; }
XCODE_VERSION=16.0 "$CMAKE" --build "$V/.macbuild/out" --target livedevice validator playtest viewtest -j 8 > "$V/.macbuild/build.log" 2>&1 \
  || { grep -E "error" -A3 "$V/.macbuild/build.log" | head -40; exit 1; }
cp "$V/.macbuild/out/VST3/Release/livedevice.vst3/Contents/MacOS/livedevice" $M/livedevice
cp "$V/.macbuild/out/bin/Release/validator" $M/validator
echo "   $M/livedevice ($(file -b $M/livedevice | cut -d, -f1))"

echo "== pungstub"
(cd macos && GOFLAGS=-mod=mod "$GO" build -o "$ROOT/$M/pungstub" ./cmd/pungstub)

# Pung itself, for this Mac: the same source as on the Push (src/), against the
# ported device layer. Go's modules come from the project's Docker volume where
# this machine keeps new programs off the network (a firewall that asks).
echo "== pung"
if [ ! -d $T/goproxy/cache ] && [ ! -d $T/goproxy/github.com ]; then
  mkdir -p $T/goproxy
  docker run --rm -v push-hack-pung-gomod:/m:ro -v "$ROOT/$T/goproxy":/out alpine sh -c 'cp -a /m/cache/download/. /out/' 2>/dev/null || true
fi
cp src/go.mod $M/pung.go.mod; cp src/go.sum $M/pung.go.sum
echo 'replace github.com/federico-pepe/ableton-push-hack/core => ../build/macos/core' >> $M/pung.go.mod
DIST=$M/dist; mkdir -p $DIST
(cd src && GOPROXY="file://$ROOT/$T/goproxy" GOSUMDB=off GOFLAGS=-mod=mod CGO_ENABLED=1 "$GO" build -modfile="$ROOT/$M/pung.go.mod" \
   -ldflags "-X main.buildVersion=$(cat "$ROOT/VERSION")" -o "$ROOT/$DIST/pung" . 2>&1 | grep -v "deprecated\|note:\|^#" || true)
[ -x $DIST/pung ] || { echo "pung did not build" >&2; exit 1; }
cp $M/livedevice $DIST/livedevice.so      # (the name Pung looks for beside itself; a Mach-O bundle here)
python3 -c "import json;d=json.load(open('hack.json'));d['port']=7733;json.dump(d,open('$DIST/hack.json','w'),indent=1)"
ln -sfn "$ROOT/overrides" $DIST/overrides
cp "$V/.macbuild/out/bin/Release/playtest" $M/playtest 2>/dev/null || true
cp "$V/.macbuild/out/bin/Release/viewtest" $M/viewtest 2>/dev/null || true
echo "   $DIST/pung ($(file -b $DIST/pung | cut -d, -f1)); its modules: macos/build-modules.sh"

if [ "${1:-}" = validate ]; then
  CLASSES=${2:?a class file}
  R=$(mktemp -d)
  "$M/pungstub" -bin $M/livedevice -classes "$CLASSES" -vst3 "$R/vst3" -data "$R/data" > "$R/stub.log" 2>&1 &
  PID=$!
  for i in $(seq 1 50); do [ -S "$R/data/devices.sock" ] && break; sleep 0.1; done
  "$M/validator" "$R/vst3/Pung.vst3" > "$R/validator.log" 2>&1 || true
  kill $PID
  grep -E "^Result" "$R/validator.log" || tail -5 "$R/validator.log"
  grep -q "0 tests failed" "$R/validator.log"
  rm -rf "$R"
fi
