// vivace_wavetables.h: Vivace's wavetable library (docs/NATIVE-MODULES.md,
// Vivace), shared by the plugin (which loads a table into an oscillator) and
// vivace-export (which builds the library: vivace_wtbuild.cpp).
//
// The library is a folder in the package, wavetables/:
//
//   index.json   {"version":1,"frame":2048,"categories":[{"name":"Basic",
//                 "file":"basic.bin","tables":[{"name":"Classic Morph",
//                 "frames":16,"at":0,"source":"Pung"}, ...]}, ...]}
//   <file>.bin   each category's frames, one after the other: 2048 signed
//                16-bit samples a frame, little-endian; a table's frames
//                start at frame "at" of its category's file.
//
// A table's frames are keyframes spread evenly over the oscillator's 257
// positions, the engine morphing between them in the frequency domain (no
// phase cancelling between two frames).
#pragma once

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "json/json.h"

class WavetableCreator;

namespace wtlib {

constexpr int kFrame = 2048;

struct Table {
    std::string name, source;
    int frames = 0;
    int64_t at = 0; // first frame in the category's file
};

struct Category {
    std::string name, file;
    std::vector<Table> tables;
};

struct Library {
    std::string dir; // the wavetables/ folder
    std::vector<Category> categories;

    // reads dir/index.json; false: no library there
    bool load(const std::string &folder);
    // a table's frames, frames * kFrame floats in -1..1; false: not there
    bool read(int category, int table, std::vector<float> &out) const;
    // what the screens list: {"categories":[{"name":..,"tables":[names]},..]}
    std::string names() const;
    const Table *table(int category, int table) const;
};

// The oscillator's table, from frames (frames * kFrame floats): keyframes
// spread over its positions, morphed in the frequency domain. Renders it.
void apply(WavetableCreator *creator, const std::string &name, const std::vector<float> &frames, int count);

} // namespace wtlib
