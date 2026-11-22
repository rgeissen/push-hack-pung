// Vivace for Pung: the synthesis engine of an open-source spectral warping
// wavetable synthesizer (GPLv3; its name is its author's trademark and is not
// used), headless, behind the chain host's plugin API. A Pung-native module
// (docs/NATIVE-MODULES.md, Vivace).
//
// Threads. The engine renders on its own thread ("vivace", FIFO 45) into a
// ring; render_block only reads the ring. A second thread ("vivace-io", an
// ordinary one) does everything slow: it builds the engine, reads preset
// files and the library, and loads sounds (a wavetable is computed when it
// loads: tens to hundreds of milliseconds). While it loads, the render thread
// finds the engine taken and writes silence, so the ring never runs dry and
// a sound change is a short gap, not a dropout.
//
// The host's calls (set_param, get_param, on_midi) never wait for either
// thread: Pung holds the device's lock while it calls, and its realtime
// thread gives up on a block it cannot get the lock for. A knob writes the
// engine's control directly (a float, as the synth's own plugin does from its
// host's thread); a sound, a state, or a change that needs the engine still
// (the oversampling) goes to a thread as a request; the state is assembled
// from the controls as they are and the parts of the sound that only a load
// changes (wavetables, LFO shapes, modulation routes), kept as text.
//
// Sounds. The package's factory/ folder (Vivace's own sounds, written at build
// time by vivace-export from vivace_factory.cpp) is the first bank; every
// folder in presets/ is a bank of the user's preset files (the synth's JSON
// preset format), presets/ itself one more for the files at its top.
//
// Parameters. tools/gen_params.py writes vivace_params.h from the engine's
// own parameter definitions: which knobs, on which pages, and the text of
// each knob position as the synth displays it.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <dirent.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "JuceHeader.h"
#include "line_generator.h"
#include "load_save.h"
#include "modulation_connection_processor.h"
#include "sound_engine.h"
#include "synth_base.h"
#include "synth_parameters.h"
#include "wavetable.h"
#include "wavetable_creator.h"

#include "vivace_params.h"

extern "C" {
#include "host/plugin_api_v1.h"
}

namespace {

const host_api_v1_t *g_host = nullptr;

void plog(const char *fmt, ...) {
    char b[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof(b), fmt, ap);
    va_end(ap);
    if (g_host && g_host->log) {
        char m[560];
        snprintf(m, sizeof(m), "vivace: %s", b);
        g_host->log(m);
    } else {
        fprintf(stderr, "vivace: %s\n", b);
    }
}

int64_t now_us() {
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return int64_t(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

bool read_text(const std::string &p, std::string &out) {
    FILE *f = fopen(p.c_str(), "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    const long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n <= 0 || n > 64 * 1024 * 1024) {
        fclose(f);
        return false;
    }
    out.resize(size_t(n));
    const bool ok = fread(&out[0], 1, size_t(n), f) == size_t(n);
    fclose(f);
    return ok;
}

std::string jesc(const std::string &s) {
    std::string o;
    for (char c : s) {
        if (c == '"' || c == '\\') o.push_back('\\');
        if (uint8_t(c) >= 32 && uint8_t(c) < 127) o.push_back(c);
        else if (uint8_t(c) >= 128) o.push_back('?'); // the screens draw ASCII
    }
    return o;
}

// ---- the engine -----------------------------------------------------------------

class Engine : public SynthBase {
  public:
    Engine() {
        engine_->setSampleRate(44100);
        midi_manager_->setSampleRate(44100);
        engine_->updateAllModulationSwitches();
    }
    const CriticalSection &getCriticalSection() override { return cs_; }
    void pauseProcessing(bool pause) override {
        if (pause) cs_.enter();
        else cs_.exit();
    }
    bool tryLock() { return cs_.tryEnter(); }
    void unlock() { cs_.exit(); }
    bool load(const json &j) { return loadFromJson(j); }
    json save() { return saveToJson(); }
    // one block, the engine held by the caller
    void block(AudioSampleBuffer &b, MidiBuffer &m, int n, double secs) {
        processModulationChanges();
        engine_->correctToTime(secs);
        processMidi(m);
        processAudio(&b, 2, n, 0);
    }
    vital::SoundEngine *eng() { return engine_.get(); }
    std::map<std::string, String> &info() { return save_info_; }
    // No message thread here: the wheel and learned controllers set the
    // engine and tell nobody (the synth's own versions post to a GUI).
    void valueChangedThroughMidi(const std::string &name, vital::mono_float value) override { controls_[name]->set(value); }
    void pitchWheelMidiChanged(vital::mono_float) override {}
    void modWheelMidiChanged(vital::mono_float) override {}

  protected:
    SynthGuiInterface *getGuiInterface() override { return nullptr; }

  private:
    CriticalSection cs_;
};

// ---- the library ------------------------------------------------------------------

struct Bank {
    std::string name, dir;
    std::vector<std::string> files, names;
};

std::string stem(const std::string &f) {
    std::string s = f;
    const size_t sl = s.rfind('/');
    if (sl != std::string::npos) s = s.substr(sl + 1);
    const size_t dot = s.rfind('.');
    if (dot != std::string::npos) s = s.substr(0, dot);
    return s;
}

bool ends_with(const std::string &s, const char *e) {
    const size_t n = strlen(e);
    return s.size() >= n && !strcasecmp(s.c_str() + s.size() - n, e);
}

// A folder's preset files, in the order its index.txt gives (the factory
// bank's), else by name.
void read_bank(Bank &b) {
    std::vector<std::string> fs;
    if (DIR *d = opendir(b.dir.c_str())) {
        while (dirent *e = readdir(d)) {
            const std::string n = e->d_name;
            if (n[0] != '.' && ends_with(n, ".vital")) fs.push_back(n);
        }
        closedir(d);
    }
    std::sort(fs.begin(), fs.end(), [](const std::string &a, const std::string &c) { return strcasecmp(a.c_str(), c.c_str()) < 0; });
    std::string idx;
    if (read_text(b.dir + "/index.txt", idx)) {
        std::vector<std::string> ord;
        size_t a = 0;
        while (a < idx.size()) {
            size_t e = idx.find('\n', a);
            if (e == std::string::npos) e = idx.size();
            std::string l = idx.substr(a, e - a);
            while (!l.empty() && (l.back() == '\r' || l.back() == ' ')) l.pop_back();
            auto it = std::find(fs.begin(), fs.end(), l);
            if (!l.empty() && it != fs.end()) {
                ord.push_back(l);
                fs.erase(it);
            }
            a = e + 1;
        }
        ord.insert(ord.end(), fs.begin(), fs.end());
        fs = ord;
    }
    for (auto &f : fs) {
        b.files.push_back(b.dir + "/" + f);
        b.names.push_back(stem(f));
    }
}

void add_tree(std::vector<Bank> &out, const std::string &dir, const std::string &name, int depth) {
    Bank b;
    b.name = name;
    b.dir = dir;
    read_bank(b);
    if (!b.files.empty()) out.push_back(b);
    if (depth > 3) return;
    std::vector<std::string> subs;
    if (DIR *d = opendir(dir.c_str())) {
        while (dirent *e = readdir(d)) {
            if (e->d_name[0] == '.') continue;
            const std::string p = dir + "/" + e->d_name;
            struct stat st;
            if (stat(p.c_str(), &st) == 0 && S_ISDIR(st.st_mode)) subs.push_back(e->d_name);
        }
        closedir(d);
    }
    std::sort(subs.begin(), subs.end(), [](const std::string &a, const std::string &c) { return strcasecmp(a.c_str(), c.c_str()) < 0; });
    for (auto &s : subs) add_tree(out, dir + "/" + s, depth == 0 ? s : name + "/" + s, depth + 1);
}

// what the library is made of now: a change in any folder's time is a rescan
std::string library_stamp(const std::string &dir) {
    std::string s;
    std::vector<std::string> todo = {dir + "/factory", dir + "/presets"};
    while (!todo.empty() && todo.size() < 400) {
        const std::string d = todo.back();
        todo.pop_back();
        struct stat st;
        if (stat(d.c_str(), &st) != 0) continue;
        s += d + ":" + std::to_string(st.st_mtime) + ";";
        if (DIR *h = opendir(d.c_str())) {
            while (dirent *e = readdir(h)) {
                if (e->d_name[0] == '.') continue;
                const std::string p = d + "/" + e->d_name;
                struct stat s2;
                if (stat(p.c_str(), &s2) == 0 && S_ISDIR(s2.st_mode)) todo.push_back(p);
            }
            closedir(h);
        }
    }
    return s;
}

// ---- the instance -------------------------------------------------------------------

const int RING = 4096;      // stereo frames, a power of two
const int BLOCK = 64;       // frames the engine renders at a time
const int AHEAD = 256;      // frames kept ready for the host (5.8 ms)
const int AHEAD_DEEP = 1024; // after a miss, for MISS_DEEP_US (23 ms)
const int64_t MISS_DEEP_US = 3000000;
const uint32_t FADE = 32;   // a short block fades out, the next one in
const int MIDIQ = 1024;     // MIDI events waiting for the render thread

struct MidiEv {
    uint8_t b[3];
    uint8_t len;
};

struct Request {
    enum Kind { kNone, kPreset, kState } kind = kNone;
    int bank = 0, preset = 0;
    std::string state;
};

struct Heavy { // what only a load changes, as the screens read it
    std::string info;      // "preset_name":..,"author":.. (the save info)
    std::string waveView;  // get_param("wave_view")
    std::string routes;    // get_param("mod_routes")
    std::string lfoShapes; // get_param("lfo_shapes")
    std::string tables;    // get_param("wavetable_names")
};

struct Instance {
    std::string dir;
    std::unique_ptr<Engine> synth;
    std::atomic<bool> ready{false};
    std::atomic<int> loading{1};     // nothing to hear: the engine is not built yet
    std::atomic<int> soundLoads{0};  // a sound going in (silence is not a miss then)
    vital::Value *ctl[vv::kNumParams][2] = {};
    std::vector<std::pair<std::string, vital::Value *>> allControls;
    std::thread render, io;
    std::atomic<bool> quit{false};
    sem_t wake;

    // ring
    int16_t ring[RING * 2];
    std::atomic<uint32_t> wr{0}, rd{0};
    std::atomic<uint32_t> underruns{0};
    std::atomic<int64_t> missAt{0};
    bool hole = false;
    std::atomic<uint32_t> blockUs{0}, blockMaxUs{0};
    std::atomic<uint32_t> loadMs{0};
    std::atomic<int> voices{0};
    std::atomic<float> gain{1.0f};
    double secs = 0; // the engine's own clock (render thread)

    // MIDI: one writer at a time (the host serialises its calls), one reader
    MidiEv mq[MIDIQ];
    std::atomic<uint32_t> mqW{0}, mqR{0};
    std::atomic<bool> oversampleCheck{false}, panic{false};

    // requests for the io thread
    std::mutex reqMu;
    std::condition_variable reqCv;
    Request req;

    // what the host reads, under infoMu (held only to copy)
    std::mutex infoMu;
    std::vector<Bank> banks;
    int bank = 0, preset = 0;
    std::string presetName = "Init", status = "Starting", error;
    std::shared_ptr<const Heavy> heavy = std::make_shared<Heavy>();
    int userPolyphony = 8;
    std::string file;            // the preset file the sound came from, in the module's folder
    std::vector<float> baseline; // the controls as that file set them (allControls' order)
};

void set_status(Instance *in, const std::string &s) {
    std::lock_guard<std::mutex> l(in->infoMu);
    in->status = s;
}

std::shared_ptr<const Heavy> heavy_of(Instance *in) {
    std::lock_guard<std::mutex> l(in->infoMu);
    return in->heavy;
}

inline float soft_limit(float v) {
    const float knee = 24576.f, room = 32767.f - knee;
    const float a = v < 0 ? -v : v;
    if (a <= knee) return v;
    const float o = knee + room * std::tanh((a - knee) / room);
    return v < 0 ? -o : o;
}

// ---- parameters: Pung's value <-> the engine's -------------------------------------

const vv::Param *find_param(const char *key, int *idx = nullptr) {
    static const std::unordered_map<std::string, int> map = [] {
        std::unordered_map<std::string, int> m;
        for (int i = 0; i < vv::kNumParams; i++) m.emplace(vv::kParams[i].key, i);
        return m;
    }();
    auto it = map.find(key);
    if (it == map.end()) return nullptr;
    if (idx) *idx = it->second;
    return &vv::kParams[it->second];
}

float to_engine(const vv::Param &p, float x) {
    x = std::max(p.pmin, std::min(p.pmax, x));
    switch (p.kind) {
    case vv::kEnum: return p.lo + std::round(x);
    case vv::kInt: return std::round(x);
    case vv::kPos: return p.lo + (p.hi - p.lo) * (x - p.pmin) / (p.pmax - p.pmin);
    default: return x;
    }
}

float from_engine(const vv::Param &p, float v) {
    switch (p.kind) {
    case vv::kEnum: return std::max(p.pmin, std::min(p.pmax, std::round(v - p.lo)));
    case vv::kInt: return std::max(p.pmin, std::min(p.pmax, std::round(v)));
    case vv::kPos: return p.hi > p.lo ? p.pmin + (p.pmax - p.pmin) * (v - p.lo) / (p.hi - p.lo) : p.pmin;
    default: return v;
    }
}

int filter_type_of(float model, float style) {
    const int m = int(std::round(model)), s = int(std::round(style));
    for (int i = 0; i < vv::kNumFilterTypes; i++)
        if (vv::kFilterTypeModel[i] == m && vv::kFilterTypeStyle[i] == s) return i;
    for (int i = 0; i < vv::kNumFilterTypes; i++)
        if (vv::kFilterTypeModel[i] == m) return i;
    return 0;
}

// Pung's value of parameter i, as text (the engine's controls read as they are)
int param_text(Instance *in, int i, char *buf, int len) {
    const vv::Param &p = vv::kParams[i];
    vital::Value *a = in->ctl[i][0];
    if (!a) return -1;
    if (p.kind == vv::kType) return snprintf(buf, size_t(len), "%d", filter_type_of(a->value(), in->ctl[i][1]->value()));
    if (!strcmp(p.key, "polyphony")) return snprintf(buf, size_t(len), "%d", in->userPolyphony);
    const float x = from_engine(p, a->value());
    if (p.kind == vv::kEnum || p.kind == vv::kInt) return snprintf(buf, size_t(len), "%d", int(x));
    return snprintf(buf, size_t(len), "%.4f", x);
}

void param_set(Instance *in, int i, const char *val) {
    const vv::Param &p = vv::kParams[i];
    vital::Value *a = in->ctl[i][0];
    if (!a) return;
    char *end = nullptr;
    float x = strtof(val, &end);
    if (end == val) { // an option by its name
        if (p.list < 0 || (p.kind != vv::kEnum && p.kind != vv::kType)) return;
        int k = -1;
        for (int j = 0; j < vv::kListLen[p.list]; j++)
            if (!strcasecmp(vv::kLists[p.list][j], val)) k = j;
        if (k < 0) return;
        x = float(k);
    }
    if (p.kind == vv::kType) {
        const int t = std::max(0, std::min(vv::kNumFilterTypes - 1, int(std::round(x))));
        a->set(vv::kFilterTypeModel[t]);
        in->ctl[i][1]->set(vv::kFilterTypeStyle[t]);
        return;
    }
    const float v = to_engine(p, x);
    if (!strcmp(p.key, "polyphony")) {
        std::lock_guard<std::mutex> l(in->infoMu);
        in->userPolyphony = int(v);
    }
    a->set(v);
    if (!strcmp(p.key, "oversampling")) in->oversampleCheck = true;
}

// ---- after a load: what the screens and the state need ----------------------------

const char *source_name(const std::string &s, std::string &tmp) {
    static const std::pair<const char *, const char *> fixed[] = {
        {"velocity", "Velocity"}, {"note", "Note"}, {"note_in_octave", "Octave Note"}, {"aftertouch", "Aftertouch"},
        {"slide", "Slide"}, {"lift", "Lift"}, {"mod_wheel", "Mod Wheel"}, {"pitch_wheel", "Pitch Wheel"},
        {"random", "Voice Random"}, {"stereo", "Stereo"}, {"pitch", "Pitch"}};
    for (auto &f : fixed)
        if (s == f.first) return f.second;
    int n = 0;
    if (sscanf(s.c_str(), "env_%d", &n) == 1) tmp = "Env " + std::to_string(n);
    else if (sscanf(s.c_str(), "lfo_%d", &n) == 1) tmp = "LFO " + std::to_string(n);
    else if (sscanf(s.c_str(), "random_%d", &n) == 1) tmp = "Random " + std::to_string(n);
    else if (sscanf(s.c_str(), "macro_control_%d", &n) == 1) tmp = "Macro " + std::to_string(n);
    else tmp = s;
    return tmp.c_str();
}

std::string dest_name(const std::string &d) {
    if (vital::Parameters::isParameter(d)) {
        int i = -1;
        if (find_param(d.c_str(), &i)) return vv::kParams[i].name;
        return vital::Parameters::getDisplayName(d);
    }
    return d;
}

// An LFO's shape, by the names Pung draws (g.lfo), when it is one of the
// synth's own starting shapes, point for point; else Custom (drawn by hand
// in the sound)
bool same_line(LineGenerator *a, LineGenerator *b) {
    if (a->getNumPoints() != b->getNumPoints() || a->smooth() != b->smooth()) return false;
    for (int i = 0; i < a->getNumPoints(); i++) {
        if (std::fabs(a->getPoint(i).first - b->getPoint(i).first) > 1e-3f) return false;
        if (std::fabs(a->getPoint(i).second - b->getPoint(i).second) > 1e-3f) return false;
        if (std::fabs(a->getPower(i) - b->getPower(i)) > 1e-3f) return false;
    }
    return true;
}

std::string lfo_shape(LineGenerator *g) {
    LineGenerator r(64);
    r.initTriangle();
    if (same_line(g, &r)) return "Triangle";
    r.initSin();
    if (same_line(g, &r)) return "Sine";
    r.initSawUp();
    if (same_line(g, &r)) return "Saw Up";
    r.initSawDown();
    if (same_line(g, &r)) return "Saw Down";
    r.initSquare();
    if (same_line(g, &r)) return "Square";
    return "Custom";
}

// The io thread, the engine held: everything only a load changes.
void refresh_heavy(Instance *in) {
    Engine &s = *in->synth;
    std::shared_ptr<Heavy> h = std::make_shared<Heavy>();
    json info = json::object();
    info["preset_name"] = s.getPresetName().toStdString();
    info["author"] = s.getAuthor().toStdString();
    info["comments"] = s.getComments().toStdString();
    info["preset_style"] = s.getStyle().toStdString();
    for (int i = 0; i < vital::kNumMacros; i++) info["macro" + std::to_string(i + 1)] = s.getMacroName(i).toStdString();
    h->info = info.dump();
    h->info = h->info.substr(1, h->info.size() - 2); // the members, for patch_info

    // the wavetables, for the screens: 17 frames across each table, 64
    // points a frame, a byte a point (hex)
    std::string w = "{\"tables\":[";
    for (int o = 0; o < vital::kNumOscillators; o++) {
        vital::Wavetable *t = s.getWavetable(o);
        const int nf = t ? t->numFrames() : 0;
        const int k = std::min(17, std::max(1, nf));
        char hdr[64];
        snprintf(hdr, sizeof(hdr), "%s{\"frames\":%d,\"k\":%d,\"w\":\"", o ? "," : "", nf, k);
        w += hdr;
        for (int f = 0; f < k && t; f++) {
            const int fi = k == 1 ? 0 : int(std::lround(double(f) * (nf - 1) / (k - 1)));
            const float *b = t->getBuffer(fi);
            for (int i = 0; i < 64; i++) {
                float v = 0;
                for (int j = 0; j < 32; j++) v += b[i * 32 + j]; // the mean of each 32nd
                v /= 32;
                const int q = std::max(0, std::min(255, int(std::lround(v * 127.0f + 128.0f))));
                char hx[3];
                snprintf(hx, sizeof(hx), "%02x", q);
                w += hx;
            }
        }
        w += "\"}";
    }
    w += "]}";
    h->waveView = w;

    std::string names = "[";
    for (int o = 0; o < vital::kNumOscillators; o++) {
        WavetableCreator *c = s.getWavetableCreator(o);
        names += std::string(o ? "," : "") + "\"" + jesc(c ? c->getName() : "") + "\"";
    }
    h->tables = names + "]";

    std::string r = "[";
    vital::ModulationConnectionBank &bank = s.getModulationBank();
    bool first = true;
    for (int i = 0; i < vital::kMaxModulationConnections; i++) {
        vital::ModulationConnection *c = bank.atIndex(i);
        if (!c || c->source_name.empty() || c->destination_name.empty()) continue;
        std::string tmp;
        char b[400];
        snprintf(b, sizeof(b), "%s{\"i\":%d,\"src\":\"%s\",\"dst\":\"%s\",\"source\":\"%s\",\"dest\":\"%s\"}", first ? "" : ",", i + 1,
                 jesc(c->source_name).c_str(), jesc(c->destination_name).c_str(), jesc(source_name(c->source_name, tmp)).c_str(),
                 jesc(dest_name(c->destination_name)).c_str());
        r += b;
        first = false;
    }
    h->routes = r + "]";

    std::string l = "[";
    for (int i = 0; i < vital::kNumLfos; i++) l += std::string(i ? "," : "") + "\"" + lfo_shape(s.getLfoSource(i)) + "\"";
    h->lfoShapes = l + "]";

    std::lock_guard<std::mutex> lk(in->infoMu);
    in->heavy = h;
}

// A loaded sound within what a Push can play (docs/NATIVE-MODULES.md, Vivace):
// the voices to the measured top, the oversampling to 2x.
void fit_sound(Instance *in) {
    vital::control_map &c = in->synth->getControls();
    const int poly = int(std::lround(c["polyphony"]->value()));
    {
        std::lock_guard<std::mutex> l(in->infoMu);
        in->userPolyphony = std::max(1, std::min(vv::kMaxVoices, poly));
    }
    c["polyphony"]->set(float(std::max(1, std::min(vv::kMaxVoices, poly))));
    if (c["oversampling"]->value() > 1.0f) c["oversampling"]->set(1.0f);
    in->synth->checkOversampling();
}

// the engine's controls as they stand: what a state's edits are measured from (io thread, engine held)
void take_baseline(Instance *in) {
    std::vector<float> b(in->allControls.size());
    for (size_t i = 0; i < b.size(); i++) b[i] = in->allControls[i].second->value();
    std::lock_guard<std::mutex> l(in->infoMu);
    in->baseline = b;
}

bool load_json(Instance *in, const json &j, std::string &err, const json *edits = nullptr) {
    in->soundLoads++;
    const int64_t t0 = now_us();
    bool ok = false;
    in->synth->pauseProcessing(true);
    try {
        ok = in->synth->load(j);
        if (!ok) err = "This preset was made with a newer version of the synth";
    } catch (const std::exception &e) {
        err = std::string("The preset could not be read: ") + e.what();
    }
    if (!ok) {
        try {
            in->synth->loadInitPreset();
        } catch (...) {
        }
    }
    fit_sound(in);
    take_baseline(in);
    if (edits && edits->is_object()) { // a state's edits, over the sound as its file has it
        vital::control_map &c = in->synth->getControls();
        for (auto it = edits->begin(); it != edits->end(); ++it) {
            auto ci = c.find(it.key());
            if (ci != c.end() && it.value().is_number()) ci->second->set(it.value().get<float>());
        }
        fit_sound(in);
        if (c.count("polyphony") && edits->count("polyphony")) {
            std::lock_guard<std::mutex> l(in->infoMu);
            in->userPolyphony = std::max(1, std::min(vv::kMaxVoices, int(std::lround((*edits)["polyphony"].get<float>()))));
        }
    }
    refresh_heavy(in);
    in->synth->pauseProcessing(false);
    in->soundLoads--;
    in->loadMs = uint32_t((now_us() - t0) / 1000);
    return ok;
}

bool read_preset(const std::string &file, json &j, std::string &err) {
    std::string text;
    if (!read_text(file, text)) {
        err = "The preset file could not be read";
        return false;
    }
    try {
        j = json::parse(text);
    } catch (const std::exception &e) {
        err = "The preset file is not a preset";
        return false;
    }
    return true;
}

// a file's place in the module's folder, as a state keeps it (the folder
// moves with an update; the place in it does not)
std::string rel_path(Instance *in, const std::string &file) {
    const std::string d = in->dir + "/";
    return file.compare(0, d.size(), d) == 0 ? file.substr(d.size()) : file;
}

void loaded(Instance *in, int bank, int preset, const std::string &name, const std::string &file, const std::string &err) {
    if (err.empty()) {
        in->synth->setPresetName(name); // the name a file has, as the synth's own browser shows it
        std::shared_ptr<Heavy> h = std::make_shared<Heavy>(*heavy_of(in));
        json info = json::parse("{" + h->info + "}");
        info["preset_name"] = name;
        h->info = info.dump();
        h->info = h->info.substr(1, h->info.size() - 2);
        std::lock_guard<std::mutex> l(in->infoMu);
        in->heavy = h;
    }
    std::lock_guard<std::mutex> l(in->infoMu);
    in->bank = bank;
    in->preset = preset;
    in->presetName = name;
    in->file = rel_path(in, file);
    in->error = err;
    if (!err.empty()) plog("%s: %s", file.c_str(), err.c_str());
}

bool load_preset(Instance *in, int bank, int preset, const json *edits = nullptr) {
    std::string file, name;
    {
        std::lock_guard<std::mutex> l(in->infoMu);
        if (bank < 0 || bank >= int(in->banks.size())) return false;
        const Bank &b = in->banks[size_t(bank)];
        if (preset < 0 || preset >= int(b.files.size())) return false;
        file = b.files[size_t(preset)];
        name = b.names[size_t(preset)];
    }
    std::string err;
    json j;
    if (read_preset(file, j, err)) load_json(in, j, err, edits);
    loaded(in, bank, preset, name, file, err);
    return err.empty();
}

// A state Pung kept (docs/NATIVE-MODULES.md, Vivace): {"v":2, file, bank,
// preset, name, gain, edits}. The chain host carries a state of at most 16 KB,
// and a sound with its wavetables is ten times that: so the state names the
// preset file the sound came from (its place in the module's folder) and
// holds every control that differs from it. A file that is gone: its bank
// and number, else the Init sound, with the edits.
void load_state(Instance *in, const std::string &text) {
    json s;
    try {
        s = json::parse(text);
    } catch (...) {
        plog("a state that is not JSON: ignored");
        return;
    }
    if (s.count("gain") && s["gain"].is_number()) in->gain = std::max(0.01f, std::min(2.0f, s["gain"].get<float>() / 100.0f));
    int bank = s.value("bank", 0), preset = s.value("preset", 0);
    const json edits = s.count("edits") ? s["edits"] : json::object();
    std::string rel = s.value("file", std::string());
    if (!rel.empty()) { // the file, wherever the library has it now
        const std::string full = rel[0] == '/' ? rel : in->dir + "/" + rel;
        int fb = -1, fp = -1;
        {
            std::lock_guard<std::mutex> l(in->infoMu);
            for (size_t b = 0; b < in->banks.size() && fb < 0; b++)
                for (size_t k = 0; k < in->banks[b].files.size(); k++)
                    if (in->banks[b].files[k] == full) {
                        fb = int(b);
                        fp = int(k);
                        break;
                    }
        }
        if (fb >= 0) {
            load_preset(in, fb, fp, &edits);
            return;
        }
        plog("the state's preset %s is gone: its bank and number, else Init", rel.c_str());
    }
    if (load_preset(in, bank, preset, &edits)) return;
    std::string err;
    in->synth->pauseProcessing(true);
    in->synth->loadInitPreset();
    in->synth->pauseProcessing(false);
    load_json(in, in->synth->save(), err, &edits);
    loaded(in, 0, 0, s.value("name", std::string("Init")), "", "");
}

void rescan(Instance *in) {
    std::vector<Bank> banks;
    {
        Bank f;
        f.name = "Factory";
        f.dir = in->dir + "/factory";
        read_bank(f);
        banks.push_back(f);
    }
    std::vector<Bank> user;
    add_tree(user, in->dir + "/presets", "Presets", 0);
    banks.insert(banks.end(), user.begin(), user.end());
    std::lock_guard<std::mutex> l(in->infoMu);
    // the sound keeps its place when the list around it changes
    std::string cur;
    if (in->bank >= 0 && in->bank < int(in->banks.size())) cur = in->banks[size_t(in->bank)].name;
    in->banks = banks;
    for (size_t i = 0; i < banks.size(); i++)
        if (banks[i].name == cur) in->bank = int(i);
}

// ---- the threads ----------------------------------------------------------------------

void render_main(Instance *in) {
    pthread_setname_np(pthread_self(), "vivace");
    // Below the host's audio threads (70) and Pung's engine (60), above
    // everything ordinary (docs/NATIVE-MODULES.md, rule 2).
    sched_param sp{};
    sp.sched_priority = 45;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) plog("no realtime priority for the engine (%s)", strerror(errno));
    FloatVectorOperations::disableDenormalisedNumberSupport();

    AudioSampleBuffer buf(2, BLOCK);
    MidiBuffer midi;
    midi.ensureSize(MIDIQ * 4);
    const double dt = double(BLOCK) / 44100.0;
    while (!in->quit.load(std::memory_order_relaxed)) {
        uint32_t fill = in->wr.load(std::memory_order_relaxed) - in->rd.load(std::memory_order_acquire);
        const int64_t tnow = now_us(), miss = in->missAt.load(std::memory_order_relaxed);
        const uint32_t target = (miss && tnow - miss < MISS_DEEP_US) ? uint32_t(AHEAD_DEEP) : uint32_t(AHEAD);
        while (fill < target && !in->quit.load(std::memory_order_relaxed)) {
            const int64_t t0 = now_us();
            bool heard = false;
            if (in->synth->tryLock()) {
                if (in->oversampleCheck.exchange(false)) in->synth->notifyOversamplingChanged();
                if (in->panic.exchange(false)) in->synth->eng()->allNotesOff(0);
                midi.clear();
                for (uint32_t r = in->mqR.load(std::memory_order_relaxed); r != in->mqW.load(std::memory_order_acquire); r++) {
                    const MidiEv &e = in->mq[r & (MIDIQ - 1)];
                    midi.addEvent(e.b, e.len, 0);
                    in->mqR.store(r + 1, std::memory_order_release);
                }
                // Live's tempo, and its beat when it plays (a synced LFO
                // or delay follows the song); else the engine's own clock
                if (g_host && g_host->get_bpm) {
                    const float bpm = g_host->get_bpm();
                    if (bpm > 20 && bpm < 999) in->synth->eng()->setBpm(bpm);
                    if (g_host->get_clock_status && g_host->get_beat_position &&
                        g_host->get_clock_status() == MOVE_CLOCK_STATUS_RUNNING && bpm > 20)
                        in->secs = g_host->get_beat_position() * 60.0 / bpm;
                }
                in->synth->block(buf, midi, BLOCK, in->secs);
                in->voices.store(in->synth->eng()->getNumActiveVoices(), std::memory_order_relaxed);
                in->synth->unlock();
                heard = true;
            }
            in->secs += dt;
            const float g = in->gain.load(std::memory_order_relaxed) * 0.5f * 32767.0f; // 6 dB of headroom
            const uint32_t w = in->wr.load(std::memory_order_relaxed);
            const float *l = buf.getReadPointer(0), *r = buf.getReadPointer(1);
            for (int i = 0; i < BLOCK; i++) {
                const uint32_t k = (w + uint32_t(i)) & (RING - 1);
                in->ring[k * 2] = heard ? int16_t(lrintf(soft_limit(l[i] * g))) : 0;
                in->ring[k * 2 + 1] = heard ? int16_t(lrintf(soft_limit(r[i] * g))) : 0;
            }
            in->wr.store(w + BLOCK, std::memory_order_release);
            const uint32_t us = uint32_t(now_us() - t0);
            in->blockUs.store(us, std::memory_order_relaxed);
            if (us > in->blockMaxUs.load(std::memory_order_relaxed)) in->blockMaxUs.store(us, std::memory_order_relaxed);
            fill = in->wr.load(std::memory_order_relaxed) - in->rd.load(std::memory_order_acquire);
        }
        timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 2000000;
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec++;
            ts.tv_nsec -= 1000000000;
        }
        sem_timedwait(&in->wake, &ts);
    }
}

void resolve_controls(Instance *in) {
    vital::control_map &c = in->synth->getControls();
    for (int i = 0; i < vv::kNumParams; i++) {
        const vv::Param &p = vv::kParams[i];
        if (p.kind == vv::kType) {
            in->ctl[i][0] = c[std::string(p.engine) + "_model"];
            in->ctl[i][1] = c[std::string(p.engine) + "_style"];
        } else {
            auto it = c.find(p.engine);
            in->ctl[i][0] = it == c.end() ? nullptr : it->second;
            if (!in->ctl[i][0]) plog("no control %s", p.engine);
        }
    }
    for (auto &kv : c) in->allControls.emplace_back(kv.first, kv.second);
}

void io_main(Instance *in) {
    pthread_setname_np(pthread_self(), "vivace-io");
    set_status(in, "Starting the engine");
    try {
        in->synth.reset(new Engine());
        in->synth->loadInitPreset();
    } catch (const std::exception &e) {
        std::lock_guard<std::mutex> l(in->infoMu);
        in->error = std::string("The engine did not start: ") + e.what();
        in->status = "Failed";
        in->loading = 0;
        return;
    }
    resolve_controls(in);
    rescan(in);
    std::string stamp = library_stamp(in->dir);
    Request first;
    {
        std::lock_guard<std::mutex> l(in->reqMu);
        first = in->req;
        in->req = Request();
    }
    set_status(in, "Reading the sound");
    if (first.kind == Request::kState) load_state(in, first.state);
    else load_preset(in, first.kind == Request::kPreset ? first.bank : 0, first.kind == Request::kPreset ? first.preset : 0);
    // the first notes find their memory touched: a chord rendered unheard
    {
        AudioSampleBuffer b(2, BLOCK);
        MidiBuffer m;
        in->synth->pauseProcessing(true);
        const uint8_t notes[] = {48, 55, 60, 64, 67, 72};
        for (uint8_t n : notes) in->synth->eng()->noteOn(n, 0.7f, 0, 0);
        for (int i = 0; i < 44100 / 4 / BLOCK; i++) in->synth->block(b, m, BLOCK, 0);
        in->synth->eng()->allSoundsOff();
        in->synth->pauseProcessing(false);
    }
    in->wr = 0;
    in->rd = 0;
    in->render = std::thread(render_main, in);
    in->ready = true;
    in->loading = 0;
    set_status(in, "Vivace");
    plog("running: %d banks", int(in->banks.size()));

    int64_t lastScan = now_us();
    while (!in->quit.load()) {
        Request r;
        {
            std::unique_lock<std::mutex> l(in->reqMu);
            in->reqCv.wait_for(l, std::chrono::milliseconds(500), [&] { return in->quit.load() || in->req.kind != Request::kNone; });
            r = std::move(in->req);
            in->req = Request();
        }
        if (in->quit.load()) break;
        if (r.kind == Request::kPreset) load_preset(in, r.bank, r.preset);
        else if (r.kind == Request::kState) load_state(in, r.state);
        if (now_us() - lastScan > 2000000) { // the library, when a folder changed
            lastScan = now_us();
            std::string s = library_stamp(in->dir);
            if (s != stamp) {
                stamp = s;
                rescan(in);
            }
        }
    }
}

void post(Instance *in, Request r) {
    {
        std::lock_guard<std::mutex> l(in->reqMu);
        in->req = std::move(r); // the latest wins: a turn through ten sounds loads the last
    }
    in->reqCv.notify_one();
}

// ---- the plugin API ---------------------------------------------------------------------

void *v2_create(const char *module_dir, const char *) {
    Instance *in = new Instance();
    in->dir = module_dir ? module_dir : ".";
    memset(in->ring, 0, sizeof(in->ring));
    sem_init(&in->wake, 0, 0);
    in->io = std::thread(io_main, in);
    return in;
}

void v2_destroy(void *instance) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in) return;
    in->quit = true;
    in->reqCv.notify_all();
    sem_post(&in->wake);
    if (in->io.joinable()) in->io.join();
    if (in->render.joinable()) in->render.join();
    in->synth.reset();
    sem_destroy(&in->wake);
    delete in;
}

void v2_on_midi(void *instance, const uint8_t *msg, int len, int) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || len < 1 || !in->ready.load()) return;
    const uint8_t st = msg[0] & 0xf0;
    if (st < 0x80 || st == 0xf0) return; // channel messages only
    const int need = (st == 0xc0 || st == 0xd0) ? 2 : 3;
    if (len < need) return;
    const uint32_t w = in->mqW.load(std::memory_order_relaxed);
    if (w - in->mqR.load(std::memory_order_acquire) >= uint32_t(MIDIQ)) return; // full: dropped
    MidiEv &e = in->mq[w & (MIDIQ - 1)];
    e.b[0] = msg[0];
    e.b[1] = msg[1] & 0x7f;
    e.b[2] = need > 2 ? (msg[2] & 0x7f) : 0;
    e.len = uint8_t(need);
    in->mqW.store(w + 1, std::memory_order_release);
    sem_post(&in->wake);
}

void v2_set_param(void *instance, const char *key, const char *val) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !val) return;
    int i = -1;
    if (find_param(key, &i)) {
        if (in->ready.load()) param_set(in, i, val);
        return;
    }
    if (!strcmp(key, "state")) {
        Request r;
        r.kind = Request::kState;
        r.state = val;
        post(in, std::move(r));
    } else if (!strcmp(key, "preset")) {
        char *end = nullptr;
        const int n = int(strtol(val, &end, 10));
        if (end == val) return;
        Request r;
        r.kind = Request::kPreset;
        {
            // the list and the name follow the choice at once; the sound
            // follows when the io thread has loaded it
            std::lock_guard<std::mutex> l(in->infoMu);
            r.bank = in->bank;
            if (in->bank >= 0 && in->bank < int(in->banks.size()) && n >= 0 && n < int(in->banks[size_t(in->bank)].names.size())) {
                in->preset = n;
                in->presetName = in->banks[size_t(in->bank)].names[size_t(n)];
            }
        }
        r.preset = n;
        post(in, std::move(r));
    } else if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select") || !strcmp(key, "bank")) {
        int n = -1;
        {
            std::lock_guard<std::mutex> l(in->infoMu);
            for (size_t b = 0; b < in->banks.size(); b++)
                if (in->banks[b].name == val) n = int(b);
        }
        if (n < 0) {
            char *end = nullptr;
            n = int(strtol(val, &end, 10));
            if (end == val) return;
        }
        Request r;
        r.kind = Request::kPreset;
        r.bank = n;
        r.preset = 0; // a bank's first sound, so the list and the sound agree
        post(in, std::move(r));
    } else if (!strcmp(key, "gain")) {
        in->gain = std::max(0.01f, std::min(2.0f, float(atof(val)) / 100.0f));
    } else if (!strcmp(key, "all_notes_off")) {
        in->panic = true;
    }
}

#define AP(...)                                                                    \
    do {                                                                           \
        if (off < len) off += snprintf(buf + off, size_t(len - off), __VA_ARGS__); \
    } while (0)

int chain_params(char *buf, int len) {
    int off = 0;
    AP("[{\"key\":\"preset\",\"name\":\"Sound\",\"type\":\"int\",\"min\":0,\"max\":1023}");
    AP(",{\"key\":\"gain\",\"name\":\"Output Gain\",\"type\":\"int\",\"min\":1,\"max\":200,\"unit\":\"%%\"}");
    for (int i = 0; i < vv::kNumParams; i++) {
        const vv::Param &p = vv::kParams[i];
        AP(",{\"key\":\"%s\",\"name\":\"%s\",\"short\":\"%s\"", p.key, jesc(p.name).c_str(), jesc(p.short_).c_str());
        switch (p.kind) {
        case vv::kEnum:
        case vv::kType:
            AP(",\"type\":\"enum\",\"options\":[");
            for (int j = 0; j < vv::kListLen[p.list]; j++) AP("%s\"%s\"", j ? "," : "", jesc(vv::kLists[p.list][j]).c_str());
            AP("]}");
            break;
        case vv::kInt:
            AP(",\"type\":\"int\",\"min\":%d,\"max\":%d", int(p.pmin), int(p.pmax));
            if (p.unit[0]) AP(",\"unit\":\"%s\"", p.unit);
            if (p.list >= 0) AP(",\"value_labels\":\"L%d\"", p.list);
            AP("}");
            break;
        case vv::kPos:
            AP(",\"type\":\"float\",\"min\":%g,\"max\":%g,\"value_labels\":\"L%d\"}", p.pmin, p.pmax, p.list);
            break;
        default:
            AP(",\"type\":\"float\",\"min\":%g,\"max\":%g,\"display_format\":\"%%.0f\"}", p.pmin, p.pmax);
        }
    }
    AP("]");
    return off < len ? off : -1;
}

int value_lists(char *buf, int len) {
    std::vector<bool> used(sizeof(vv::kListLen) / sizeof(vv::kListLen[0]));
    for (int i = 0; i < vv::kNumParams; i++)
        if ((vv::kParams[i].kind == vv::kPos || vv::kParams[i].kind == vv::kInt) && vv::kParams[i].list >= 0)
            used[size_t(vv::kParams[i].list)] = true;
    int off = 0;
    AP("{");
    bool first = true;
    for (size_t l = 0; l < used.size(); l++) {
        if (!used[l]) continue;
        AP("%s\"L%d\":[", first ? "" : ",", int(l));
        first = false;
        for (int j = 0; j < vv::kListLen[l]; j++) AP("%s\"%s\"", j ? "," : "", jesc(vv::kLists[l][j]).c_str());
        AP("]");
    }
    AP("}");
    return off < len ? off : -1;
}

int ui_hierarchy(char *buf, int len) {
    int off = 0;
    auto knobs = [&](const vv::Page &pg) {
        AP("[");
        bool f = true;
        for (const char *k : pg.keys)
            if (k) {
                AP("%s\"%s\"", f ? "" : ",", k);
                f = false;
            }
        AP("]");
    };
    AP("{\"modes\":null,\"levels\":{\"root\":{\"list_param\":\"preset\",\"count_param\":\"preset_count\","
       "\"name_param\":\"preset_name\",\"children\":null,\"knobs\":");
    knobs(vv::kPages[0]);
    AP(",\"params\":[{\"level\":\"banks\",\"label\":\"Bank\"}");
    for (int i = 1; i < vv::kNumPages; i++) AP(",{\"level\":\"p%d\",\"label\":\"%s\"}", i, vv::kPages[i].label);
    AP(",{\"level\":\"out\",\"label\":\"Output\"}]}");
    AP(",\"banks\":{\"label\":\"Bank\",\"items_param\":\"bank_list\",\"select_param\":\"bank_select\","
       "\"navigate_to\":\"root\",\"children\":null,\"knobs\":[],\"params\":[]}");
    for (int i = 1; i < vv::kNumPages; i++) {
        AP(",\"p%d\":{\"label\":\"%s\",\"children\":null,\"knobs\":", i, vv::kPages[i].label);
        knobs(vv::kPages[i]);
        AP(",\"params\":[");
        bool f = true;
        for (const char *k : vv::kPages[i].keys)
            if (const vv::Param *p = k ? find_param(k) : nullptr) {
                AP("%s{\"key\":\"%s\",\"label\":\"%s\"}", f ? "" : ",", k, jesc(p->name).c_str());
                f = false;
            }
        AP("]}");
    }
    AP(",\"out\":{\"label\":\"Output\",\"children\":null,\"knobs\":[\"gain\"],"
       "\"params\":[{\"key\":\"gain\",\"label\":\"Output Gain\"}]}}}");
    return off < len ? off : -1;
}

// The state: the preset file the sound came from and every control that
// differs from it (load_state: at most 16 KB, the chain host's limit).
int state_text(Instance *in, char *buf, int len) {
    std::vector<float> base;
    int bank, preset, poly;
    std::string file, name;
    {
        std::lock_guard<std::mutex> l(in->infoMu);
        base = in->baseline;
        bank = in->bank;
        preset = in->preset;
        poly = in->userPolyphony;
        file = in->file;
        name = in->presetName;
    }
    int off = 0;
    AP("{\"v\":2,\"file\":\"%s\",\"bank\":%d,\"preset\":%d,\"name\":\"%s\",\"gain\":%d,\"edits\":{", jesc(file).c_str(), bank, preset,
       jesc(name).c_str(), int(std::lround(in->gain.load() * 100)));
    bool first = true;
    for (size_t i = 0; i < in->allControls.size() && off < 15000; i++) {
        const auto &c = in->allControls[i];
        const float v = c.first == "polyphony" ? float(poly) : c.second->value();
        if (i < base.size() && std::fabs(v - base[i]) <= 1e-6f * std::max(1.0f, std::fabs(v))) continue;
        AP("%s\"%s\":%.7g", first ? "" : ",", c.first.c_str(), double(v));
        first = false;
    }
    AP("}}");
    return off < len ? off : -1;
}

int v2_get_param(void *instance, const char *key, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !buf || len <= 0) return -1;
    int i = -1;
    if (find_param(key, &i)) return in->ready.load() ? param_text(in, i, buf, len) : -1;
    if (!strcmp(key, "debug_info"))
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u voices=%d load_ms=%u", in->underruns.load(),
                        in->blockUs.load(), in->blockMaxUs.exchange(0), in->wr.load() - in->rd.load(), in->voices.load(),
                        in->loadMs.load());
    if (!strcmp(key, "live_voices")) return snprintf(buf, size_t(len), "%d", in->voices.load());
    if (!strcmp(key, "chain_params")) return chain_params(buf, len);
    if (!strcmp(key, "value_lists")) return value_lists(buf, len);
    if (!strcmp(key, "ui_hierarchy")) return ui_hierarchy(buf, len);
    if (!strcmp(key, "gain")) return snprintf(buf, size_t(len), "%d", int(std::lround(in->gain.load() * 100)));
    if (!strcmp(key, "state")) return in->ready.load() ? state_text(in, buf, len) : -1;
    if (!strcmp(key, "wave_view")) return snprintf(buf, size_t(len), "%s", heavy_of(in)->waveView.c_str());
    if (!strcmp(key, "mod_routes")) return snprintf(buf, size_t(len), "%s", heavy_of(in)->routes.c_str());
    if (!strcmp(key, "lfo_shapes")) return snprintf(buf, size_t(len), "%s", heavy_of(in)->lfoShapes.c_str());
    if (!strcmp(key, "wavetable_names")) return snprintf(buf, size_t(len), "%s", heavy_of(in)->tables.c_str());
    std::lock_guard<std::mutex> l(in->infoMu);
    const int nb = int(in->banks.size());
    static const Bank none;
    const Bank &b = in->bank >= 0 && in->bank < nb ? in->banks[size_t(in->bank)] : none;
    if (!strcmp(key, "status")) return snprintf(buf, size_t(len), "%s", in->status.c_str());
    if (!strcmp(key, "load_error")) return snprintf(buf, size_t(len), "%s", in->error.c_str());
    if (!strcmp(key, "is_loading")) return snprintf(buf, size_t(len), "%d", in->loading.load() || in->soundLoads.load() ? 1 : 0);
    if (!strcmp(key, "preset")) return snprintf(buf, size_t(len), "%d", in->preset);
    if (!strcmp(key, "preset_count")) return snprintf(buf, size_t(len), "%d", int(b.names.size()));
    if (!strcmp(key, "preset_name")) return snprintf(buf, size_t(len), "%s", jesc(in->presetName).c_str());
    if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select") || !strcmp(key, "bank")) return snprintf(buf, size_t(len), "%d", in->bank);
    if (!strcmp(key, "bank_count")) return snprintf(buf, size_t(len), "%d", nb);
    if (!strcmp(key, "bank_name")) return snprintf(buf, size_t(len), "%s", jesc(b.name).c_str());
    if (!strcmp(key, "bank_list")) {
        int off = 0;
        AP("[");
        for (int k = 0; k < nb; k++) AP("%s\"%s\"", k ? "," : "", jesc(in->banks[size_t(k)].name).c_str());
        AP("]");
        return off < len ? off : -1;
    }
    if (!strcmp(key, "preset_names")) {
        int off = 0;
        AP("[");
        for (size_t k = 0; k < b.names.size(); k++) AP("%s\"%s\"", k ? "," : "", jesc(b.names[k]).c_str());
        AP("]");
        return off < len ? off : -1;
    }
    if (!strncmp(key, "preset_name_", 12)) {
        const int k = atoi(key + 12);
        return snprintf(buf, size_t(len), "%s", k >= 0 && k < int(b.names.size()) ? jesc(b.names[size_t(k)]).c_str() : "");
    }
    if (!strcmp(key, "macro_names") || !strcmp(key, "patch_info")) {
        // {"preset_name":..,"author":..,"preset_style":..,"macro1":..}: the save info as the sound has it
        return snprintf(buf, size_t(len), "{%s}", in->heavy->info.c_str());
    }
    return -1;
}

int v2_get_error(void *instance, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !buf || len <= 0) return 0;
    std::lock_guard<std::mutex> l(in->infoMu);
    // a preset that did not load is said in load_error; only an engine that
    // did not start is the module's error
    if (in->status != "Failed") {
        buf[0] = 0;
        return 0;
    }
    return snprintf(buf, size_t(len), "%s", in->error.c_str());
}

void v2_render(void *instance, int16_t *out, int frames) {
    Instance *in = static_cast<Instance *>(instance);
    if (!out || frames <= 0) return;
    if (!in || !in->ready.load(std::memory_order_relaxed)) {
        memset(out, 0, size_t(frames) * 2 * sizeof(int16_t));
        return;
    }
    const uint32_t r = in->rd.load(std::memory_order_relaxed);
    const uint32_t have = in->wr.load(std::memory_order_acquire) - r;
    const uint32_t n = std::min<uint32_t>(have, uint32_t(frames));
    for (uint32_t i = 0; i < n; i++) {
        const uint32_t k = (r + i) & (RING - 1);
        out[i * 2] = in->ring[k * 2];
        out[i * 2 + 1] = in->ring[k * 2 + 1];
    }
    if (in->hole && n > 0) { // the block before ended short: back in with a fade
        const uint32_t f = std::min<uint32_t>(n, FADE);
        for (uint32_t i = 0; i < f; i++) {
            out[i * 2] = int16_t(int32_t(out[i * 2]) * int32_t(i) / int32_t(f));
            out[i * 2 + 1] = int16_t(int32_t(out[i * 2 + 1]) * int32_t(i) / int32_t(f));
        }
        in->hole = false;
    }
    if (n < uint32_t(frames)) {
        const uint32_t f = std::min<uint32_t>(n, FADE);
        for (uint32_t i = 0; i < f; i++) { // out with a fade, not a cut
            const uint32_t k = n - f + i;
            out[k * 2] = int16_t(int32_t(out[k * 2]) * int32_t(f - 1 - i) / int32_t(f));
            out[k * 2 + 1] = int16_t(int32_t(out[k * 2 + 1]) * int32_t(f - 1 - i) / int32_t(f));
        }
        memset(out + n * 2, 0, size_t(uint32_t(frames) - n) * 2 * sizeof(int16_t));
        in->hole = true;
        in->underruns.fetch_add(1, std::memory_order_relaxed);
        in->missAt.store(now_us(), std::memory_order_relaxed);
    }
    in->rd.store(r + n, std::memory_order_release);
    sem_post(&in->wake);
}

plugin_api_v2_t g_api;

} // namespace

extern "C" __attribute__((visibility("default"))) plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    memset(&g_api, 0, sizeof(g_api));
    g_api.api_version = 2;
    g_api.create_instance = v2_create;
    g_api.destroy_instance = v2_destroy;
    g_api.on_midi = v2_on_midi;
    g_api.set_param = v2_set_param;
    g_api.get_param = v2_get_param;
    g_api.get_error = v2_get_error;
    g_api.render_block = v2_render;
    return &g_api;
}
