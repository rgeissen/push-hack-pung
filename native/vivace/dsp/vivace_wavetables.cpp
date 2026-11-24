// vivace_wavetables.cpp: the wavetable library's reader, and a table into an
// oscillator (vivace_wavetables.h).
#include "vivace_wavetables.h"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>

#include "synth_constants.h"
#include "wave_source.h"
#include "wavetable_creator.h"
#include "wavetable_group.h"

using json = nlohmann::json;

namespace wtlib {

bool Library::load(const std::string &folder) {
    categories.clear();
    dir = folder;
    std::ifstream f(folder + "/index.json");
    if (!f) return false;
    std::stringstream ss;
    ss << f.rdbuf();
    json j;
    try {
        j = json::parse(ss.str());
    } catch (...) {
        return false;
    }
    if (!j.is_object() || j.value("frame", 0) != kFrame || !j.count("categories")) return false;
    for (const json &c : j["categories"]) {
        Category cat;
        cat.name = c.value("name", std::string());
        cat.file = c.value("file", std::string());
        if (cat.name.empty() || cat.file.empty() || !c.count("tables")) continue;
        for (const json &t : c["tables"]) {
            Table tb;
            tb.name = t.value("name", std::string());
            tb.source = t.value("source", std::string());
            tb.frames = t.value("frames", 0);
            tb.at = t.value("at", int64_t(0));
            if (!tb.name.empty() && tb.frames > 0) cat.tables.push_back(tb);
        }
        if (!cat.tables.empty()) categories.push_back(cat);
    }
    return !categories.empty();
}

const Table *Library::table(int category, int table) const {
    if (category < 0 || category >= int(categories.size())) return nullptr;
    const Category &c = categories[size_t(category)];
    if (table < 0 || table >= int(c.tables.size())) return nullptr;
    return &c.tables[size_t(table)];
}

bool Library::read(int category, int table, std::vector<float> &out) const {
    const Table *t = this->table(category, table);
    if (!t) return false;
    std::ifstream f(dir + "/" + categories[size_t(category)].file, std::ios::binary);
    if (!f) return false;
    std::vector<int16_t> raw(size_t(t->frames) * kFrame);
    f.seekg(std::streamoff(t->at * kFrame * 2));
    if (!f.read(reinterpret_cast<char *>(raw.data()), std::streamsize(raw.size() * 2))) return false;
    out.resize(raw.size());
    for (size_t i = 0; i < raw.size(); i++) out[i] = float(raw[i]) / 32767.0f; // (the files are little-endian, as the Push is)
    return true;
}

std::string Library::names() const {
    json j = json::object(), cs = json::array();
    for (const Category &c : categories) {
        json t = json::array();
        for (const Table &tb : c.tables) t.push_back(tb.name);
        cs.push_back({{"name", c.name}, {"tables", t}});
    }
    j["categories"] = cs;
    return j.dump();
}

void apply(WavetableCreator *creator, const std::string &name, const std::vector<float> &frames, int count) {
    if (!creator || count <= 0 || frames.size() < size_t(count) * kFrame) return;
    creator->clear();
    WavetableGroup *group = new WavetableGroup();
    WaveSource *source = new WaveSource();
    source->setInterpolationStyle(WavetableComponent::kLinear);
    source->setInterpolationMode(WaveSource::kFrequency);
    std::vector<float> buf(vital::WaveFrame::kWaveformSize);
    const int last = vital::kNumOscillatorWaveFrames - 1;
    for (int i = 0; i < count; i++) {
        const int pos = count == 1 ? 0 : int(std::lround(double(i) * last / (count - 1)));
        WaveSourceKeyframe *k = static_cast<WaveSourceKeyframe *>(source->insertNewKeyframe(pos));
        std::copy(frames.begin() + std::ptrdiff_t(i) * kFrame, frames.begin() + std::ptrdiff_t(i + 1) * kFrame, buf.begin());
        k->wave_frame()->loadTimeDomain(buf.data());
    }
    group->addComponent(source);
    creator->addGroup(group);
    creator->setName(name);
    creator->setAuthor("Pung");
    creator->render();
}

} // namespace wtlib
