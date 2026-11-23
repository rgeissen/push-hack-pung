# Shared by hand recipes: "gcc" on PATH becomes zig cc for the Push (x86_64,
# glibc 2.35), for a module whose C needs clang (its own script builds with
# zig cc). The generated recipe then runs unchanged, its sources and flags
# still read from the module's script.   zig_gcc <work dir>
zig_gcc() {
    command -v zig >/dev/null || { echo "needs zig: rebuild the push-hack-pung-modules image (docker/Dockerfile.modules)"; exit 1; }
    mkdir -p "$1/bin"
    cat > "$1/bin/gcc" <<'EOF'
#!/bin/sh
# zig's clang takes the CPU as zig names it and rejects -mtune=generic
for a do
    shift
    case $a in -march=x86-64-v2) set -- "$@" -mcpu=x86_64_v2 ;; -mtune=*) ;; *) set -- "$@" "$a" ;; esac
done
exec zig cc -target x86_64-linux-gnu.2.35 "$@"
EOF
    chmod +x "$1/bin/gcc"
    export PATH="$1/bin:$PATH" ZIG_GLOBAL_CACHE_DIR="$1/zig-cache" ZIG_LOCAL_CACHE_DIR="$1/zig-cache"
}
