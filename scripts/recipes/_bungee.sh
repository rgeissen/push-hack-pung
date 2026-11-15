# Shared by hand recipes: bungee (time-stretch) as its users' build scripts
# build it: pffft + fftpack (C) and bungee's src/*.cpp (C++20) with bungee's
# own defines, into one static archive.   build_bungee <bungee dir> <out.a>
build_bungee() {
    local B=$1 out=$2 o; o=$(mktemp -d)
    local A="-march=x86-64-v2 -mtune=generic"
    gcc -O3 $A -fPIC -ffast-math -fno-finite-math-only -fno-exceptions -c "$B/submodules/pffft/pffft.c" -o "$o/pffft.o"
    gcc -O3 $A -fPIC -ffast-math -fno-finite-math-only -fno-exceptions -c "$B/submodules/pffft/fftpack.c" -o "$o/fftpack.o"
    for s in "$B"/src/*.cpp; do
        g++ -O3 $A -fPIC -std=c++20 -fwrapv -fno-gnu-unique -I"$B/submodules/eigen" -I"$B/submodules" \
            -I"$B/submodules/pffft" -I"$B" \
            '-DBUNGEE_VISIBILITY=__attribute__((visibility("default")))' -DBUNGEE_SELF_TEST=0 \
            -Deigen_assert=BUNGEE_ASSERT1 -DEIGEN_DONT_PARALLELIZE=1 '-DBUNGEE_VERSION="0.0.0"' \
            -c "$s" -o "$o/$(basename "$s" .cpp).o"
    done
    ar rcs "$out" "$o"/*.o
    rm -rf "$o"
}
