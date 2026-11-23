#!/usr/bin/env bash
# hand recipe: the generated one, compiled by zig's clang (_zigcc.sh). quark's
# rom_gen.c takes its sample ROM in with C23 #embed, which Ubuntu 22.04's gcc 11
# has not; its own scripts/build.sh builds with zig cc too.
set -euo pipefail
. /hand/_zigcc.sh
W=/tmp/zig-quark; rm -rf "$W"
zig_gcc "$W"
bash /recipes/quark.sh
rm -rf "$W"
