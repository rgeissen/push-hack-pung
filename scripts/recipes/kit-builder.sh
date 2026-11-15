#!/usr/bin/env bash
# hand recipe: the generated one, plus dropbear 2026.94's dbclient, scp and
# dropbearkey built for x86_64 (its scripts/build_dropbear.sh builds them for
# ARM64 musl and the repo carries those binaries). They go where the module's
# JS looks for them (vendor/dropbear-aarch64/, a name it hard-codes), and the
# ARM ones do not ship. Used only by "Send to Force".
set -euo pipefail
G=/recipes/kit-builder.sh
bash "$G"
D=/out/overtake/kit-builder; T=/tmp/b-kit-builder-db
rm -rf "$T"; cp -a /deps/dropbear-DROPBEAR_2026.94 "$T"
( cd "$T" && CFLAGS="-O2 -march=x86-64-v2" ./configure --disable-zlib --disable-utmp --disable-wtmp --disable-lastlog \
    --disable-syslog --disable-loginfunc --disable-pututline --disable-pututxline >/dev/null && make -j"${BUILD_JOBS:-4}" dbclient scp dropbearkey >/dev/null )
rm -rf "$D/vendor/dropbear-aarch64"; mkdir -p "$D/vendor/dropbear-aarch64"
cp "$T/dbclient" "$T/scp" "$T/dropbearkey" "$D/vendor/dropbear-aarch64/"
cp "$T/LICENSE" "$D/vendor/dropbear-aarch64/LICENSE.dropbear"
rm -rf "$T"
