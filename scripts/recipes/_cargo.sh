# Shared by hand recipes: a module's Rust staticlib, built offline with the
# nightly in docker/Dockerfile.modules from the crates scripts/fetch-deps.sh
# put into /deps/cargo-home (its Cargo.lock's versions, --locked).
#   cargo_staticlib <workspace dir> <package> <work dir>  -> <work dir>/target/release/lib<package>.a
cargo_staticlib() {
    command -v cargo >/dev/null || { echo "needs the Rust builder image (push-hack-pung-modules)"; exit 1; }
    rm -rf "$3"; mkdir -p "$3"
    cp -a /deps/cargo-home "$3/cargo"; cp -a "$1" "$3/ws"
    ( cd "$3/ws" && CARGO_HOME="$3/cargo" CARGO_TARGET_DIR="$3/target" RUSTFLAGS="-C target-cpu=x86-64-v2" \
        cargo build --release --offline --locked -p "$2" )
}
