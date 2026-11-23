#!/usr/bin/env bash
# hand recipe: Omega's Makefile, `make dist` (dsp.so, dr32_engine.so, module.json,
# help.json, canvas.js, cards.js), for x86_64. The generated recipe globbed every
# .c into dsp.so: the test harness (mock_host, wav) and its malloc trap
# (-DOMEGA_MALLOC_TRAP, interposing glibc's allocator) went into the shipping
# plugin, and the author's notes (.planning, Context, CLAUDE.md, .github) into
# the package. README.md carries the licence (MIT).
set -euo pipefail
R=/modsrc/schwung-omega; D=/out/sound_generators/omega; T=/tmp/b-omega
rm -rf "$D" "$T"; mkdir -p "$D" "$T"
CF=(-std=gnu11 -O3 -march=x86-64-v2 -mtune=generic -shared -fPIC -I"$R"/src
    -fno-math-errno -ffp-contract=fast -fvisibility=hidden -Wl,--no-undefined)
# DSP_SRCS: src/*.c but the DR32 engine plugin, and every model
DSP=(); for f in "$R"/src/*.c "$R"/src/models/*.c; do [ "$(basename "$f")" = dr32_engine.c ] || DSP+=("$f"); done
gcc "${CF[@]}" "${DSP[@]}" -o "$D"/dsp.so -lm
# DR32_SRCS: Omega's kick models as engines for DR32's drum rack, an object of its own
M="$R"/src/models
gcc "${CF[@]}" -Wl,-Bsymbolic "$R"/src/dr32_engine.c "$R"/src/dsp_primitives.c "$R"/src/params.c \
    "$M"/fm2.c "$M"/fm4.c "$M"/wtr.c "$M"/phy.c "$M"/hrd.c "$M"/dig.c "$M"/trs.c "$M"/ana.c \
    -o "$D"/dr32_engine.so -lm
cp "$R"/module.json "$R"/help.json "$R"/canvas.js "$R"/cards.js "$R"/README.md "$D"/
rm -rf "$T"
