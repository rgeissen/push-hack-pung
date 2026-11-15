#!/bin/sh
# The build scripts know their folders as the build container's mounts
# (scripts/build-push-modules.sh): here they are folders of the data volume.
set -e
W=/data/work
mkdir -p "$W/modsrc" "$W/recipes" "$W/push-modules/modules" "$W/push-modules/logs" "$W/deps" "$W/catalog" /data/schwung
ln -sfn "$W/modsrc" /modsrc
ln -sfn "$W/recipes" /recipes
ln -sfn /app/scripts/recipes /hand
ln -sfn /app/scripts /s
ln -sfn "$W/push-modules/modules" /out
ln -sfn "$W/push-modules/logs" /logs
ln -sfn "$W/deps" /deps
ln -sfn /data/schwung /schwung
# sources were checked out by another user (the seed came from a Mac)
git config --global --add safe.directory '*'
# the cargo crates sfz needs, fetched once (scripts/fetch-deps.sh)
[ -d "$W/deps/cargo-home" ] && export CARGO_HOME="$W/deps/cargo-home"
exec /app/pung-catalog "$@"
