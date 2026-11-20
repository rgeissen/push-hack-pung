// OsTIrus for Pung: the Access Virus TI as gearmulator emulates it
// (virusLib), behind the chain host's plugin API. A Pung-native module: the
// emulation needs a Push's processor (a Move runs the older Virus B and C at
// half their clock).
//
// Threads. The emulator renders on its own thread ("ostirus") into a ring;
// render_block only reads the ring. The emulator's DSP threads are created by
// that thread and inherit its priority.
//
// Sounds. The firmware carries the factory banks: every ROM bank is a bank
// here, its names read from the firmware without loading a sound. A sound is
// loaded as the synth's own single dump into the edit buffer, and that dump
// is the device's state.
//
// Parameters. Every one is a byte of the single (512 bytes: pages A, B, 6E,
// 6F), read from the sound as loaded and sent to the synth as a parameter
// change when it is turned, so the dump is always the sound as it is. Their
// pages, ranges and value texts are gearmulator's own descriptions, laid out
// by tools/gen_params.py into ti_params.h (docs/NATIVE-MODULES.md, OsTIrus).

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <dirent.h>
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "synthLib/deviceException.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"
#include "virusLib/device.h"
#include "virusLib/deviceModel.h"
#include "virusLib/microcontroller.h"
#include "virusLib/microcontrollerTypes.h"
#include "virusLib/romfile.h"

#include "ti_params.h"
#include <unordered_map>

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
        snprintf(m, sizeof(m), "ostirus: %s", b);
        g_host->log(m);
    } else {
        fprintf(stderr, "ostirus: %s\n", b);
    }
}

int64_t now_us() {
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return int64_t(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

bool read_file(const std::string &p, std::vector<uint8_t> &out) {
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
    const bool ok = fread(out.data(), 1, size_t(n), f) == size_t(n);
    fclose(f);
    return ok;
}

// The three synths one firmware holds.
const char *o_model[] = {"TI", "TI2", "Snow"};
const virusLib::DeviceModel k_model[] = {virusLib::DeviceModel::TI, virusLib::DeviceModel::TI2, virusLib::DeviceModel::Snow};

// A firmware for the wanted model: the first file of the folder the library
// takes for one. (An installer of some megabytes; nothing is known by name.)
bool find_rom(const std::string &dir, virusLib::DeviceModel model, std::vector<uint8_t> &rom, std::string &name) {
    DIR *d = opendir(dir.c_str());
    if (!d) return false;
    std::vector<std::string> names;
    while (dirent *e = readdir(d))
        if (e->d_name[0] != '.') names.push_back(e->d_name);
    closedir(d);
    std::sort(names.begin(), names.end());
    for (auto &n : names) {
        const std::string p = dir + "/" + n;
        struct stat st;
        if (stat(p.c_str(), &st) != 0 || !S_ISREG(st.st_mode) || st.st_size < 1024 * 1024) continue;
        std::vector<uint8_t> data;
        if (!read_file(p, data)) continue;
        try {
            virusLib::ROMFile r(data, n, model);
            if (!r.isValid()) continue;
        } catch (...) {
            continue;
        }
        rom = std::move(data);
        name = n;
        return true;
    }
    return false;
}

// ---- the instance ---------------------------------------------------------------

const int RING = 4096;  // stereo frames, a power of two
const int BLOCK = 64;   // frames the emulator renders at a time
const int AHEAD = 320;  // frames kept ready for the host (7 ms)

typedef virusLib::ROMFile::TPreset Preset;

struct Instance {
    std::string dir;
    std::thread emu;
    std::atomic<bool> quit{false};
    std::atomic<int> loading{1};
    // One emulator at a time, as Nodal Red 2X: its threads run at realtime
    // priority, and two of them leave a Push nothing. An instance that finds
    // the emulator taken waits for it, silent, and says so.
    std::atomic<int> waiting{0};
    int lockFd = -1;
    sem_t wake;
    std::unique_ptr<virusLib::Device> device;
    std::unique_ptr<synthLib::Plugin> plugin;
    std::mutex plugMu; // plugin exists and may be handed MIDI

    // audio ring: the emulator writes, render_block reads
    int16_t ring[RING * 2];
    std::atomic<uint32_t> wr{0}, rd{0};
    std::atomic<uint32_t> underruns{0};
    std::atomic<uint32_t> blockUs{0}, blockMaxUs{0};

    // the sound and the library, under mu
    std::mutex mu;
    int model = 0; // index into o_model
    int gain = 100; // percent
    std::unique_ptr<virusLib::ROMFile> rom; // the firmware, for its banks and names
    std::vector<std::vector<std::string>> names; // [bank][sound]
    int bank = 0, preset = 0;
    Preset single{};     // the sound in the edit buffer, as loaded
    bool haveSingle = false;
    bool pendingLoad = false; // a sound waits for the emulator to be up
    std::string romName;
    char status[160] = "Starting";
    char error[200] = "";
};

void set_status(Instance *in, const char *s) {
    std::lock_guard<std::mutex> l(in->mu);
    snprintf(in->status, sizeof(in->status), "%s", s);
}

void send(Instance *in, synthLib::SMidiEvent &ev) {
    std::lock_guard<std::mutex> l(in->plugMu);
    if (in->plugin) in->plugin->addMidiEvent(ev);
}

// What still goes past the headroom bends instead of breaking (Nodal Red 2X
// taught this: a hard corner is a click on every peak).
inline float soft_limit(float v) {
    const float knee = 24576.f, room = 32767.f - knee;
    const float a = v < 0 ? -v : v;
    if (a <= knee) return v;
    const float o = knee + room * std::tanh((a - knee) / room);
    return v < 0 ? -o : o;
}

std::string bank_name(int i) {
    char b[24];
    if (i < 26) snprintf(b, sizeof(b), "ROM %c", 'A' + i);
    else snprintf(b, sizeof(b), "ROM %d", i + 1);
    return b;
}

std::string clean_name(std::string s) {
    for (auto &c : s)
        if (c < 32 || c > 126 || c == '"' || c == '\\') c = ' ';
    while (!s.empty() && s.back() == ' ') s.pop_back();
    size_t a = 0;
    while (a < s.size() && s[a] == ' ') a++;
    return s.substr(a);
}

// mu held. The firmware's banks, by name.
void read_library(Instance *in) {
    in->names.clear();
    if (!in->rom) return;
    const uint32_t banks = in->rom->getNumSingleBanks();
    for (uint32_t b = 0; b < banks; b++) {
        std::vector<std::string> ns;
        for (int p = 0; p < 128; p++) {
            Preset s;
            if (!in->rom->getSingle(int(b), p, s)) break;
            std::string n = clean_name(virusLib::ROMFile::getSingleName(s));
            if (n.empty()) n = "-";
            ns.push_back(n);
        }
        if (ns.empty()) break;
        in->names.push_back(ns);
    }
}

// mu held. The sound in the edit buffer goes to the synth, as its own dump.
void send_single(Instance *in) {
    if (!in->haveSingle || !in->rom) return;
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex = virusLib::Microcontroller::createSingleDump(*in->rom, virusLib::BankNumber::EditBuffer, virusLib::SINGLE, in->single, virusLib::OMNI_DEVICE_ID);
    send(in, ev);
}

// mu held. A sound of the firmware becomes the device's sound.
bool load_sound(Instance *in, int bank, int preset) {
    if (!in->rom) {
        in->bank = bank;
        in->preset = preset;
        in->pendingLoad = true; // the firmware is not read yet: when it is
        return false;
    }
    if (bank < 0 || bank >= int(in->names.size())) return false;
    if (preset < 0 || preset >= int(in->names[size_t(bank)].size())) return false;
    Preset s;
    if (!in->rom->getSingle(bank, preset, s)) return false;
    in->single = s;
    in->haveSingle = true;
    in->bank = bank;
    in->preset = preset;
    if (in->loading.load()) in->pendingLoad = true;
    else send_single(in);
    return true;
}

void emu_main(Instance *in) {
    pthread_setname_np(pthread_self(), "ostirus");
    // Below the host's audio threads, above everything ordinary. The
    // emulator's own threads are made by this one and inherit it.
    sched_param sp{};
    sp.sched_priority = 45;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) plog("no realtime priority for the emulator (%s)", strerror(errno));

    int model;
    {
        std::lock_guard<std::mutex> l(in->mu);
        model = in->model;
    }
    std::vector<uint8_t> rom;
    std::string romName;
    if (!find_rom(in->dir + "/roms", k_model[model], rom, romName)) {
        std::lock_guard<std::mutex> l(in->mu);
        snprintf(in->error, sizeof(in->error),
                 "No firmware: put an Access Virus TI firmware (the installer's .bin file) into the module's roms folder");
        snprintf(in->status, sizeof(in->status), "Firmware missing");
        in->loading = 0;
        return;
    }
    in->lockFd = open("/dev/shm/pung-ostirus.lock", O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (in->lockFd < 0) in->lockFd = open("/tmp/pung-ostirus.lock", O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    while (in->lockFd >= 0 && flock(in->lockFd, LOCK_EX | LOCK_NB) != 0) {
        if (!in->waiting.exchange(1)) {
            set_status(in, "Waiting: another OsTIrus is running, and one is all a Push can run");
            plog("another instance has the emulator; waiting for it");
        }
        if (in->quit.load()) return;
        usleep(300000);
    }
    in->waiting = 0;
    if (in->quit.load()) return;
    {
        char st[80];
        snprintf(st, sizeof(st), "Booting the Virus %s", o_model[model]);
        set_status(in, st);
    }
    try {
        synthLib::DeviceCreateParams p;
        p.romData = rom;
        p.romName = romName;
        p.hostSamplerate = 44100.0f;
        p.customData = uint32_t(k_model[model]);
        in->device.reset(new virusLib::Device(p));
        if (!in->device->isValid()) throw std::runtime_error("this firmware has no such model");
        std::unique_ptr<synthLib::Plugin> pl(new synthLib::Plugin(in->device.get(), [](synthLib::Device *d) { return d; }));
        pl->setHostSamplerate(44100.0f, 0.0f);
        pl->setBlockSize(BLOCK);
        std::lock_guard<std::mutex> l(in->plugMu);
        in->plugin = std::move(pl);
    } catch (const std::exception &e) {
        std::lock_guard<std::mutex> l(in->mu);
        snprintf(in->error, sizeof(in->error), "The emulator did not start: %s", e.what());
        snprintf(in->status, sizeof(in->status), "Failed");
        in->loading = 0;
        return;
    }
    {
        std::lock_guard<std::mutex> l(in->mu);
        in->romName = romName;
        try {
            in->rom.reset(new virusLib::ROMFile(rom, romName, k_model[model]));
        } catch (...) {
            in->rom.reset();
        }
        read_library(in);
        if (in->pendingLoad && !in->haveSingle) load_sound(in, in->bank, in->preset);
        if (!in->haveSingle) load_sound(in, 0, 0);
        in->pendingLoad = false;
        snprintf(in->status, sizeof(in->status), "Virus %s", o_model[model]);
        in->loading = 0;
        send_single(in);
    }
    plog("running: Virus %s, firmware %s, %d banks", o_model[model], romName.c_str(), int(in->names.size()));

    std::vector<synthLib::SMidiEvent> midiEv;
    float buf[12][BLOCK];
    synthLib::TAudioInputs ins{};
    synthLib::TAudioOutputs outs{};
    for (size_t i = 0; i < outs.size() && i < 12; i++) outs[i] = buf[i];
    float silent[BLOCK] = {0};
    for (size_t i = 0; i < ins.size(); i++) ins[i] = silent;

    while (!in->quit.load(std::memory_order_relaxed)) {
        uint32_t fill = in->wr.load(std::memory_order_relaxed) - in->rd.load(std::memory_order_acquire);
        while (fill < uint32_t(AHEAD) && !in->quit.load(std::memory_order_relaxed)) {
            const int64_t t0 = now_us();
            for (auto &b : buf) memset(b, 0, sizeof(b));
            in->plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
            midiEv.clear();
            in->plugin->getMidiOut(midiEv);
            // 6 dB of headroom, and a soft limiter above 3/4 of full scale
            const float g = float(in->gain) * 0.01f * 0.5f * 32767.0f;
            const uint32_t w = in->wr.load(std::memory_order_relaxed);
            for (int i = 0; i < BLOCK; i++) {
                const uint32_t k = (w + uint32_t(i)) & (RING - 1);
                in->ring[k * 2] = int16_t(lrintf(soft_limit(buf[0][i] * g)));
                in->ring[k * 2 + 1] = int16_t(lrintf(soft_limit(buf[1][i] * g)));
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

void start(Instance *in) {
    in->quit = false;
    in->loading = 1;
    in->emu = std::thread(emu_main, in);
}

void stop(Instance *in) {
    in->quit = true;
    sem_post(&in->wake);
    if (in->emu.joinable()) in->emu.join();
    {
        std::lock_guard<std::mutex> l(in->plugMu);
        in->plugin.reset();
    }
    in->device.reset();
    if (in->lockFd >= 0) {
        close(in->lockFd); // the emulator is gone: the next instance may start
        in->lockFd = -1;
    }
    in->wr = 0;
    in->rd = 0;
}

// ---- parameters -------------------------------------------------------------------

const ti::Param *find_param(const char *key) {
    static std::unordered_map<std::string, int> idx;
    if (idx.empty())
        for (int i = 0; i < ti::kNumParams; i++) idx.emplace(ti::kParams[i].key, i);
    auto it = idx.find(key);
    return it == idx.end() ? nullptr : &ti::kParams[it->second];
}

// A byte of the single to the synth: a parameter change on its page.
void send_byte(Instance *in, int off) {
    if (off < 0 || off >= 512) return;
    const uint8_t v = in->single[size_t(off)] & 0x7f;
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex = {0xf0, 0x00, 0x20, 0x33, 0x01, virusLib::OMNI_DEVICE_ID, ti::kPageCode[off / 128], virusLib::SINGLE,
                uint8_t(off % 128), v, 0xf7};
    send(in, ev);
}

// mu held. The byte a Soft Knob moves (-1: it points at nothing).
int soft_target(const Instance *in, int i) {
    const int dest = in->single[size_t(ti::kSoftDestOff[i])] & 0x7f;
    return ti::kSoftTarget[dest];
}

// mu held. A parameter's value as Pung reads it: an enum's index, a number
// as it is shown.
int param_get(const Instance *in, const ti::Param &p) {
    if (p.kind == ti::kSoft) {
        const int t = soft_target(in, p.key[4] - '1');
        return t < 0 ? 0 : in->single[size_t(t)];
    }
    const int raw = in->single[size_t(p.off)];
    if (p.kind == ti::kEnum) return std::max(0, std::min(int(p.max), raw) - int(p.min));
    return raw - p.offset;
}

// mu held
void param_set(Instance *in, const ti::Param &p, const char *val) {
    char *end = nullptr;
    long v = strtol(val, &end, 10);
    if (end == val) {
        if (p.kind != ti::kEnum || p.list < 0) return;
        v = -1;
        for (int i = 0; i < ti::kListLen[p.list]; i++)
            if (!strcasecmp(ti::kLists[p.list][i], val)) v = i;
        if (v < 0) return;
    }
    if (p.kind == ti::kSoft) {
        const int t = soft_target(in, p.key[4] - '1');
        if (t < 0) return;
        in->single[size_t(t)] = uint8_t(std::max(0L, std::min(127L, v)));
        send_byte(in, t);
        return;
    }
    const long raw = p.kind == ti::kEnum ? v + p.min : v + p.offset;
    in->single[size_t(p.off)] = uint8_t(std::max(long(p.min), std::min(long(p.max), raw)));
    if (!in->loading.load()) send_byte(in, p.off);
}

std::string jesc(const char *s) {
    std::string o;
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') o.push_back('\\');
        if (uint8_t(*s) >= 32) o.push_back(*s);
    }
    return o;
}

// ---- the plugin API -------------------------------------------------------------

void *v2_create(const char *module_dir, const char *) {
    Instance *in = new Instance();
    in->dir = module_dir ? module_dir : ".";
    memset(in->ring, 0, sizeof(in->ring));
    sem_init(&in->wake, 0, 0);
    start(in);
    return in;
}

void v2_destroy(void *instance) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in) return;
    stop(in);
    sem_destroy(&in->wake);
    delete in;
}

void v2_on_midi(void *instance, const uint8_t *msg, int len, int) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || len < 2 || in->loading.load()) return;
    const uint8_t st = msg[0] & 0xf0;
    const uint8_t d1 = msg[1] & 0x7f, d2 = len > 2 ? (msg[2] & 0x7f) : 0;
    switch (st) {
    case 0x80: case 0x90: case 0xd0: case 0xe0:
        break;
    case 0xb0:
        // The wheel, the pedals and the panic controllers only: every other
        // controller is a knob of the synth, and would move the sound behind
        // the parameters' back. (Poly pressure is the Virus's page B: never.)
        if (d1 != 1 && d1 != 2 && d1 != 11 && d1 != 64 && d1 != 120 && d1 != 123) return;
        break;
    default:
        return;
    }
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, st, d1, d2); // channel 1: the single
    send(in, ev);
}

bool json_field(const char *json, const char *key, std::string &out) {
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\":", key);
    const char *p = strstr(json, pat);
    if (!p) return false;
    p += strlen(pat);
    while (*p == ' ') p++;
    out.clear();
    if (*p == '"') {
        for (p++; *p && *p != '"'; p++) out.push_back(*p);
    } else {
        for (; *p && *p != ',' && *p != '}'; p++) out.push_back(*p);
    }
    return true;
}

int hexv(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }

// mu held
void set_state(Instance *in, const char *val) {
    std::string s;
    if (json_field(val, "gain", s)) in->gain = std::max(1, std::min(200, atoi(s.c_str())));
    if (json_field(val, "bank", s)) in->bank = std::max(0, atoi(s.c_str()));
    if (json_field(val, "preset", s)) in->preset = std::max(0, atoi(s.c_str()));
    std::string hex;
    if (json_field(val, "single", hex) && hex.size() >= in->single.size() * 2) {
        for (size_t i = 0; i < in->single.size(); i++) {
            const int a = hexv(hex[i * 2]), b = hexv(hex[i * 2 + 1]);
            if (a < 0 || b < 0) return;
            in->single[i] = uint8_t(a * 16 + b);
        }
        in->haveSingle = true;
        if (in->loading.load()) in->pendingLoad = true;
        else send_single(in);
    }
}

void v2_set_param(void *instance, const char *key, const char *val) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !val) return;
    if (!strcmp(key, "model")) {
        int m = -1;
        for (int i = 0; i < 3; i++)
            if (!strcasecmp(o_model[i], val)) m = i;
        if (m < 0) m = atoi(val);
        {
            std::lock_guard<std::mutex> l(in->mu);
            if (m < 0 || m > 2 || m == in->model) return;
            in->model = m;
            in->haveSingle = false; // another synth, another library: its first sound
            in->bank = in->preset = 0;
            in->rom.reset();
            in->names.clear();
            in->error[0] = 0;
        }
        stop(in); // the emulator starts again as the other model
        start(in);
        return;
    }
    std::lock_guard<std::mutex> l(in->mu);
    if (!strcmp(key, "state")) {
        std::string s;
        if (json_field(val, "model", s)) {
            const int m = std::max(0, std::min(2, atoi(s.c_str())));
            if (m != in->model) { // (set before the emulator is up in a restore: the thread reads it at its start)
                in->model = m;
            }
        }
        set_state(in, val);
    } else if (!strcmp(key, "preset")) {
        char *end = nullptr;
        const int n = int(strtol(val, &end, 10));
        if (end == val) return;
        load_sound(in, in->bank, n);
    } else if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select") || !strcmp(key, "bank")) {
        int n = -1;
        for (size_t i = 0; i < in->names.size(); i++)
            if (bank_name(int(i)) == val) n = int(i);
        if (n < 0) {
            char *end = nullptr;
            n = int(strtol(val, &end, 10));
            if (end == val) return;
        }
        if (n == in->bank && in->haveSingle) return;
        load_sound(in, n, 0); // as on the synth: a bank's first sound, so the list and the sound agree
    } else if (const ti::Param *p = find_param(key)) {
        if (in->haveSingle) param_set(in, *p, val);
    } else if (!strcmp(key, "gain")) {
        in->gain = std::max(1, std::min(200, atoi(val)));
    } else if (!strcmp(key, "all_notes_off")) {
        synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, 0xb0, 123, 0);
        send(in, ev);
    }
}

#define AP(...)                                                              \
    do {                                                                     \
        if (off < len) off += snprintf(buf + off, size_t(len - off), __VA_ARGS__); \
    } while (0)

int v2_get_param(void *instance, const char *key, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !buf || len <= 0) return -1;
    if (!strcmp(key, "debug_info"))
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u", in->underruns.load(), in->blockUs.load(),
                        in->blockMaxUs.exchange(0), in->wr.load() - in->rd.load());
    std::lock_guard<std::mutex> l(in->mu);
    const int nb = int(in->names.size());
    const std::vector<std::string> empty;
    const auto &b = in->bank >= 0 && in->bank < nb ? in->names[size_t(in->bank)] : empty;
    if (!strcmp(key, "status")) return snprintf(buf, size_t(len), "%s", in->status);
    if (!strcmp(key, "load_error")) return snprintf(buf, size_t(len), "%s", in->error);
    if (!strcmp(key, "rom_name")) return snprintf(buf, size_t(len), "%s", in->romName.c_str());
    if (!strcmp(key, "model")) return snprintf(buf, size_t(len), "%s", o_model[in->model]);
    if (!strcmp(key, "gain")) return snprintf(buf, size_t(len), "%d", in->gain);
    if (!strcmp(key, "preset")) return snprintf(buf, size_t(len), "%d", in->preset);
    if (!strcmp(key, "preset_count")) return snprintf(buf, size_t(len), "%d", int(b.size()));
    if (!strcmp(key, "preset_name")) {
        // the name the sound itself carries: also right for a sound a Set gave back
        if (in->haveSingle) return snprintf(buf, size_t(len), "%s", clean_name(virusLib::ROMFile::getSingleName(in->single)).c_str());
        return snprintf(buf, size_t(len), "%s", in->preset < int(b.size()) ? b[size_t(in->preset)].c_str() : "");
    }
    if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select") || !strcmp(key, "bank")) return snprintf(buf, size_t(len), "%d", in->bank);
    if (!strcmp(key, "bank_count")) return snprintf(buf, size_t(len), "%d", nb);
    if (!strcmp(key, "bank_name")) return snprintf(buf, size_t(len), "%s", nb ? bank_name(in->bank).c_str() : "");
    if (!strcmp(key, "bank_list")) {
        int off = 0;
        AP("[");
        for (int i = 0; i < nb; i++) AP("%s\"%s\"", i ? "," : "", bank_name(i).c_str());
        AP("]");
        return off < len ? off : -1;
    }
    if (!strcmp(key, "preset_names")) {
        int off = 0;
        AP("[");
        for (size_t i = 0; i < b.size(); i++) AP("%s\"%s\"", i ? "," : "", b[i].c_str());
        AP("]");
        return off < len ? off : -1;
    }
    if (!strncmp(key, "preset_name_", 12)) {
        const int i = atoi(key + 12);
        return snprintf(buf, size_t(len), "%s", i >= 0 && i < int(b.size()) ? b[size_t(i)].c_str() : "");
    }
    if (!strcmp(key, "chain_params")) {
        int off = 0;
        AP("[{\"key\":\"preset\",\"name\":\"Sound\",\"type\":\"int\",\"min\":0,\"max\":127}");
        AP(",{\"key\":\"model\",\"name\":\"Model\",\"type\":\"enum\",\"options\":[\"TI\",\"TI2\",\"Snow\"]}");
        AP(",{\"key\":\"gain\",\"name\":\"Output Gain\",\"type\":\"int\",\"min\":1,\"max\":200,\"unit\":\"%%\"}");
        for (int i = 0; i < ti::kNumParams; i++) {
            const ti::Param &p = ti::kParams[i];
            AP(",{\"key\":\"%s\",\"name\":\"%s\"", p.key, jesc(p.name).c_str());
            if (p.kind == ti::kEnum && p.list >= 0) {
                AP(",\"type\":\"enum\",\"options\":[");
                for (int j = 0; j < ti::kListLen[p.list]; j++) AP("%s\"%s\"", j ? "," : "", jesc(ti::kLists[p.list][j]).c_str());
                AP("]}");
            } else {
                AP(",\"type\":\"int\",\"min\":%d,\"max\":%d", p.min - p.offset, p.max - p.offset);
                if (p.kind == ti::kLabels && p.list >= 0) AP(",\"value_labels\":\"L%d\"", p.list);
                AP("}");
            }
        }
        AP("]");
        return off < len ? off : -1;
    }
    // the value texts the numbers name (chain_params "value_labels": "L<n>")
    if (!strcmp(key, "value_lists")) {
        bool used[sizeof(ti::kListLen) / sizeof(ti::kListLen[0])] = {};
        for (int i = 0; i < ti::kNumParams; i++)
            if (ti::kParams[i].kind == ti::kLabels && ti::kParams[i].list >= 0) used[ti::kParams[i].list] = true;
        int off = 0;
        AP("{");
        bool first = true;
        for (size_t l = 0; l < sizeof(used); l++) {
            if (!used[l]) continue;
            AP("%s\"L%d\":[", first ? "" : ",", int(l));
            first = false;
            for (int j = 0; j < ti::kListLen[l]; j++) AP("%s\"%s\"", j ? "," : "", jesc(ti::kLists[l][j]).c_str());
            AP("]");
        }
        AP("}");
        return off < len ? off : -1;
    }
    if (const ti::Param *p = find_param(key)) return in->haveSingle ? snprintf(buf, size_t(len), "%d", param_get(in, *p)) : -1;
    if (!strncmp(key, "soft", 4) && key[4] >= '1' && key[4] <= '3' && !strcmp(key + 5, "_name")) {
        if (!in->haveSingle) return snprintf(buf, size_t(len), "Soft Knob %c", key[4]);
        const int i = key[4] - '1';
        const int n = in->single[size_t(ti::kSoftNameOff[i])] & 0x7f;
        if (soft_target(in, i) < 0) return snprintf(buf, size_t(len), "-");
        return snprintf(buf, size_t(len), "%s", n < ti::kNumSoftNames ? ti::kSoftName[n] : "");
    }
    if (!strcmp(key, "category")) {
        if (!in->haveSingle) return snprintf(buf, size_t(len), "");
        const int c1 = in->single[size_t(ti::kCat1Off)], c2 = in->single[size_t(ti::kCat2Off)];
        const char *a = c1 < ti::kNumCategories ? ti::kCategory[c1] : "", *b = c2 < ti::kNumCategories ? ti::kCategory[c2] : "";
        if (c2 && c2 != c1 && strcmp(b, "--")) return snprintf(buf, size_t(len), "%s / %s", a, b);
        return snprintf(buf, size_t(len), "%s", a);
    }
    if (!strcmp(key, "ui_hierarchy")) {
        // the root is the sound list, its knobs the first page; every page a
        // level of eight knobs, in the layout's order (ti_params.h kPages)
        int off = 0;
        auto knobs = [&](const ti::Page &pg) {
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
        knobs(ti::kPages[0]);
        AP(",\"params\":[{\"level\":\"banks\",\"label\":\"Bank\"}");
        for (int i = 1; i < ti::kNumPages; i++) AP(",{\"level\":\"p%d\",\"label\":\"%s\"}", i, ti::kPages[i].label);
        AP(",{\"level\":\"synth\",\"label\":\"Synth\"}]}");
        AP(",\"banks\":{\"label\":\"Bank\",\"items_param\":\"bank_list\",\"select_param\":\"bank_select\","
           "\"navigate_to\":\"root\",\"children\":null,\"knobs\":[],\"params\":[]}");
        for (int i = 1; i < ti::kNumPages; i++) {
            AP(",\"p%d\":{\"label\":\"%s\",\"children\":null,\"knobs\":", i, ti::kPages[i].label);
            knobs(ti::kPages[i]);
            AP(",\"params\":[");
            bool f = true;
            for (const char *k : ti::kPages[i].keys)
                if (const ti::Param *p = k ? find_param(k) : nullptr) {
                    AP("%s{\"key\":\"%s\",\"label\":\"%s\"}", f ? "" : ",", k, jesc(p->name).c_str());
                    f = false;
                }
            AP("]}");
        }
        AP(",\"synth\":{\"label\":\"Synth\",\"children\":null,\"knobs\":[\"model\",\"gain\"],"
           "\"params\":[{\"key\":\"model\",\"label\":\"Model\"},{\"key\":\"gain\",\"label\":\"Output Gain\"}]}}}");
        return off < len ? off : -1;
    }
    if (!strcmp(key, "state")) {
        int off = 0;
        AP("{\"v\":1,\"model\":%d,\"gain\":%d,\"bank\":%d,\"preset\":%d", in->model, in->gain, in->bank, in->preset);
        if (in->haveSingle) {
            AP(",\"single\":\"");
            for (uint8_t c : in->single) AP("%02x", c);
            AP("\"");
        }
        AP("}");
        return off < len ? off : -1;
    }
    return -1;
}

int v2_get_error(void *instance, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !buf || len <= 0) return 0;
    std::lock_guard<std::mutex> l(in->mu);
    if (!in->error[0]) {
        buf[0] = 0;
        return 0;
    }
    return snprintf(buf, size_t(len), "%s", in->error);
}

void v2_render(void *instance, int16_t *out, int frames) {
    Instance *in = static_cast<Instance *>(instance);
    if (!out || frames <= 0) return;
    if (!in || in->loading.load(std::memory_order_relaxed)) {
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
    if (n < uint32_t(frames)) {
        memset(out + n * 2, 0, size_t(uint32_t(frames) - n) * 2 * sizeof(int16_t));
        if (!in->error[0]) in->underruns.fetch_add(1, std::memory_order_relaxed);
    }
    in->rd.store(r + n, std::memory_order_release);
    sem_post(&in->wake);
}

plugin_api_v2_t g_api;

} // namespace

extern "C" __attribute__((visibility("default"))) plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    // the emulator logs every hardware register it touches: not into the host's log
    Logging::setLogFunc([](const std::string &) {});
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
