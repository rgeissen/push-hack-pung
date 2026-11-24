// vivace-export: build-time tool, linked with the same engine as dsp.so.
//
//   vivace-export params <file.json>    the engine's parameter definitions, as
//                                       its own tables have them (for
//                                       tools/gen_params.py)
//   vivace-export factory <folder>      writes Vivace's factory sounds
//                                       (vivace_factory.cpp) as preset files
//   vivace-export wavetables <AKWF folder> <folder>
//                                       builds the wavetable library
//                                       (vivace_wtbuild.cpp)
//   vivace-export render <preset> <out.raw> [seconds] [note...]
//                                       a preset played, as float stereo
//                                       (checks a sound without a host)
#include "JuceHeader.h"
#include "synth_base.h"
#include "synth_parameters.h"
#include "sound_engine.h"
#include "vivace_factory.h"

#include <cstdio>
#include <fstream>

namespace {

class Synth : public SynthBase {
  public:
    const CriticalSection &getCriticalSection() override { return cs_; }
    void pauseProcessing(bool) override {}
    json save() { return saveToJson(); }
    bool load(const json &j) { return loadFromJson(j); }
    void run(AudioSampleBuffer &b, int n) { processAudio(&b, 2, n, 0); }

  protected:
    SynthGuiInterface *getGuiInterface() override { return nullptr; }

  private:
    CriticalSection cs_;
};

int dump_params(const char *path) {
    json out = json::array();
    for (auto &it : vital::Parameters::getAllDetails()) {
        const vital::ValueDetails &d = it.second;
        json p;
        p["key"] = d.name;
        p["version"] = d.version_added;
        p["min"] = d.min;
        p["max"] = d.max;
        p["default"] = d.default_value;
        p["post_offset"] = d.post_offset;
        p["display_multiply"] = d.display_multiply;
        p["scale"] = int(d.value_scale);
        p["invert"] = d.display_invert;
        p["units"] = d.display_units;
        p["display_name"] = d.display_name;
        p["local"] = d.local_description;
        // (the view switches have three values over a two-name list: not
        // parameters of the sound, and never read past the list)
        if (d.string_lookup && d.name.find("view_") == std::string::npos) {
            json o = json::array();
            for (int i = 0; i <= int(d.max); i++) o.push_back(d.string_lookup[i]);
            p["options"] = o;
        }
        out.push_back(p);
    }
    std::ofstream f(path);
    f << out.dump(1) << "\n";
    printf("%d parameters -> %s\n", int(out.size()), path);
    return 0;
}

int write_factory(const char *dir) {
    File folder(dir);
    folder.createDirectory();
    Synth s;
    String index;
    for (int i = 0; i < vivace::factoryCount(); i++) {
        s.loadInitPreset();
        vivace::buildFactory(s, i);
        json j = s.save();
        File f = folder.getChildFile(String(vivace::factoryName(i)) + ".vital");
        f.replaceWithText(j.dump());
        printf("%2d %-20s %7d bytes\n", i, vivace::factoryName(i), int(f.getSize()));
        index += String(vivace::factoryName(i)) + ".vital\n";
    }
    folder.getChildFile("index.txt").replaceWithText(index); // the bank's order
    return 0;
}

int render(const char *preset, const char *out, double secs, std::vector<int> notes) {
    Synth s;
    s.getEngine()->setSampleRate(44100);
    if (String(preset) != "init") {
        json j = json::parse(File(preset).loadFileAsString().toStdString());
        if (!s.load(j)) {
            fprintf(stderr, "load failed\n");
            return 1;
        }
    }
    AudioSampleBuffer b(2, 128);
    FILE *f = fopen(out, "wb");
    const int blocks = int(secs * 44100 / 128);
    for (int n : notes) s.getEngine()->noteOn(n, 0.8f, 0, 0);
    double peak = 0;
    const double t0 = Time::getMillisecondCounterHiRes();
    for (int i = 0; i < blocks; i++) {
        if (i == blocks * 3 / 4)
            for (int n : notes) s.getEngine()->noteOff(n, 0.5f, 0, 0);
        s.run(b, 128);
        for (int k = 0; k < 128; k++) {
            float lr[2] = {b.getSample(0, k), b.getSample(1, k)};
            peak = std::max(peak, double(std::fabs(lr[0])));
            fwrite(lr, sizeof(float), 2, f);
        }
    }
    const double ms = Time::getMillisecondCounterHiRes() - t0;
    fclose(f);
    printf("peak %.1f dB, %.1f%% of real time\n", 20 * std::log10(std::max(peak, 1e-9)), 100.0 * ms / (secs * 1000));
    return 0;
}

} // namespace

int build_wavetables(const char *akwf, const char *out); // vivace_wtbuild.cpp

int main(int argc, char **argv) {
    if (argc >= 3 && !strcmp(argv[1], "params")) return dump_params(argv[2]);
    if (argc >= 4 && !strcmp(argv[1], "wavetables")) return build_wavetables(argv[2], argv[3]);
    if (argc >= 3 && !strcmp(argv[1], "factory")) return write_factory(argv[2]);
    if (argc >= 4 && !strcmp(argv[1], "render")) {
        std::vector<int> notes;
        for (int i = 5; i < argc; i++) notes.push_back(atoi(argv[i]));
        if (notes.empty()) notes = {48, 55, 60, 64};
        return render(argv[2], argv[3], argc > 4 ? atof(argv[4]) : 2.0, notes);
    }
    fprintf(stderr, "usage: vivace-export params <file> | factory <folder> | wavetables <AKWF folder> <folder> | render <preset|init> <out.raw> [secs] [notes]\n");
    return 2;
}
