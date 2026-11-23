#!/usr/bin/env bash
# hand recipe: model-72 links its Rust engine (engine/, package ca72-mpc, a
# staticlib) that its scripts/rust.sh builds with cargo. Built here the same
# way, offline (_cargo.sh); then the generated recipe (it runs
# tools/gen_schwung.py for src/schwung_meta.h and links -lca72_mpc) finds the
# library through LIBRARY_PATH.
set -euo pipefail
. /hand/_cargo.sh
W=/tmp/rust-model-72
cargo_staticlib /modsrc/schwung-model72/engine ca72-mpc "$W"
LIBRARY_PATH="$W/target/release" bash /recipes/model-72.sh
rm -rf "$W"
