#!/usr/bin/env bash
# hand recipe: the generated one (it runs bizar's header generators), compiled
# by zig's clang (_zigcc.sh): effects.c uses __builtin_shufflevector, which
# Ubuntu 22.04's gcc 11 has not; its own scripts/build.sh builds with zig cc
# when there is no aarch64 gcc.
set -euo pipefail
. /hand/_zigcc.sh
W=/tmp/zig-bizar; rm -rf "$W"
zig_gcc "$W"
bash /recipes/bizar.sh
rm -rf "$W"
