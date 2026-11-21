// The engine of Pung's two Waldorf modules, as gearmulator emulates them:
// Vavra (the microQ, mqLib; WALDORF_MQ) and Xenia (the Microwave II/XT,
// xtLib; WALDORF_XT), behind the chain host's plugin API. One source, kept
// identical in native/vavra and native/xenia (edit one, copy it over): the two
// synths are one family, a 68000 running Waldorf's OS beside one DSP56300.
//
// Threads. The emulator renders on its own thread into a ring; render_block
// only reads the ring (OsTIrus' design, docs/NATIVE-MODULES.md). The
// emulator's own threads are made by that thread and inherit its priority.
//
// Firmware. gearmulator's own loaders choose the file: the module's roms/
// folder is where they look (synthLib::RomLoader), so every form they
// accept is accepted here (the microQ: the OS update mq_2_23.mid or a
// 512 KB dump; the XT: a 256 KB dump, or its two halves).
//
// Sounds. A synth's sounds live in its flash, which an operating system
// update does not carry: the microQ boots from mq_2_23.mid with none. They
// come from sound sets, the synths' own sysex dumps as Waldorf published
// them (the microQ's factory set: mQ_factory2001.mid), in the module's
// sounds/ folder, read with gearmulator's MIDI file reader. Each set gives
// its banks; their names and categories are the sound list, and a sound's
// dump is what loading it sends to the edit buffer. Without a set, the
// synth itself is asked (a full ROM dump may carry its flash). The sound in
// the edit buffer, as a dump, is the device's state.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <strings.h>
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
#include <time.h>
#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "synthLib/deviceException.h"
#include "synthLib/midiToSysex.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"
#include "synthLib/romLoader.h"

#include <unordered_map>

#if defined(WALDORF_MQ)
#include "mqLib/device.h"
typedef mqLib::Device SynthDevice;
#define SYNTH_ID "vavra"
#define SYNTH_NAME "Vavra"
#define SYNTH_HW "microQ"
#define FIRMWARE_HINT "the microQ operating system mq_2_23.mid, or a 512 KB microQ ROM"
#include "mq_params.h" // tools/gen_params.py
namespace tbl = mq;
#define HAVE_PARAMS 1
#elif defined(WALDORF_XT)
#include "xtLib/xtDevice.h"
#include "xtLib/xtState.h"
#include <map>
typedef xt::Device SynthDevice;
#define SYNTH_ID "xenia"
#define SYNTH_NAME "Xenia"
#define SYNTH_HW "Microwave II/XT"
#define FIRMWARE_HINT "a 256 KB Microwave II/XT ROM (or its two 128 KB halves)"
#include "xt_params.h" // tools/gen_params.py
namespace tbl = xtp;
#define HAVE_PARAMS 1
#else
#error "WALDORF_MQ or WALDORF_XT"
#endif

extern "C" {
#include "host/plugin_api_v1.h"
}

namespace {

// ---- the family: what differs between the two synths -------------------------
// (gearmulator's parameterDescriptions_*.json, "midipackets")
namespace fam {
const uint8_t WALDORF = 0x3e, OMNI = 0x7f;
const uint8_t REQUEST_SINGLE = 0x00, SINGLE_DUMP = 0x10, SINGLE_PARAM = 0x20;
#if defined(WALDORF_MQ)
const uint8_t MODEL = 0x10;  // microQ
const int BANKS = 3, SOUNDS = 100; // A, B, C: the internal singles
const uint8_t BANK0 = 0x40;  // MidiBufferNum::SingleBankA (a dump file may say 0x00: the deprecated A)
const uint8_t EDIT = 0x20;   // MidiBufferNum::SingleEditBufferSingleMode
const int DATA = 383;        // a single's bytes, between header and checksum
const int NAME_AT = 363, NAME_LEN = 16, CAT_AT = 379, CAT_LEN = 4;
const char *const BANK_NAME[] = {"Bank A", "Bank B", "Bank C"};
const int CHECKSUM_FROM = 4;      // a dump's checksum: from the command byte (mqState::sendMulti)
const uint8_t *const BOOT = nullptr; // nothing to say after booting
const int BOOT_LEN = 0;
#else
const uint8_t MODEL = 0x0e;  // Microwave II/XT
const int BANKS = 2, SOUNDS = 128; // A and B
const uint8_t BANK0 = 0x00;  // xt::LocationH::SingleBankA
const uint8_t EDIT = 0x20;   // xt::LocationH::SingleEditBufferSingleMode
const int DATA = 256;        // a single's bytes, its name the last sixteen
const int NAME_AT = 240, NAME_LEN = 16, CAT_AT = -1, CAT_LEN = 0;
const char *const BANK_NAME[] = {"Bank A", "Bank B"};
const int CHECKSUM_FROM = 7;      // from the first byte of the sound (parameterDescriptions_xt "singledump")
// The XT boots into Multi mode, and a single sent to the single-mode edit
// buffer is only played in Single mode: a mode dump says Single
// (xtController::setPlayMode, sendModeDump)
const uint8_t BOOT_MSG[] = {0xf0, WALDORF, MODEL, OMNI, 0x17, 0x00, 0xf7};
const uint8_t *const BOOT = BOOT_MSG;
const int BOOT_LEN = sizeof(BOOT_MSG);
#endif
} // namespace fam

const host_api_v1_t *g_host = nullptr;

void plog(const char *fmt, ...) {
    char b[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof(b), fmt, ap);
    va_end(ap);
    if (g_host && g_host->log) {
        char m[560];
        snprintf(m, sizeof(m), SYNTH_ID ": %s", b);
        g_host->log(m);
    } else {
        fprintf(stderr, SYNTH_ID ": %s\n", b);
    }
}

int64_t now_us() {
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return int64_t(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

// ---- the instance ---------------------------------------------------------------

const int RING = 4096;  // stereo frames, a power of two
const int BLOCK = 64;   // frames the emulator renders at a time
const int AHEAD = 320;  // frames kept ready for the host (7 ms)
// A sound goes in as a dump, which the synth takes a moment over: the ring
// is filled this far ahead first, and stays deep a moment after (OsTIrus).
const int AHEAD_DUMP = 1280; // 29 ms
// After an underrun the ring stays that deep for a while: whenever the
// emulator catches up it builds a reserve for the next slow moment, instead
// of running again with 7 ms in hand. (OsTIrus with a chord renders about
// 1.2 times as fast as it must, and the Push shares two cores between four
// threads: a busy moment beside it, and it fell behind, 25 underruns in a
// burst while played, 2026-11-21.)
const int64_t MISS_DEEP_US = 3000000;
// A block that ends short fades out over its last frames, and the one after
// it fades in: the gap is a dip, not a click.
const uint32_t FADE = 32;

struct Instance {
    std::string dir;
    std::thread emu;
    std::atomic<bool> quit{false};
    std::atomic<int> loading{1};
    // One emulator of a kind at a time: an instance that finds it taken
    // waits, silent, and says so.
    std::atomic<int> waiting{0};
    int lockFd = -1;
    sem_t wake;
    std::unique_ptr<SynthDevice> device;
    std::unique_ptr<synthLib::Plugin> plugin;
    std::mutex plugMu; // plugin exists and may be handed MIDI

    // audio ring: the emulator writes, render_block reads
    int16_t ring[RING * 2];
    std::atomic<uint32_t> wr{0}, rd{0};
    std::atomic<uint32_t> underruns{0};
    std::atomic<int64_t> missAt{0}; // the last underrun (now_us), from render_block
    bool hole = false;              // render_block's: the block before ended short
    std::atomic<uint32_t> blockUs{0}, blockMaxUs{0};

    // the sound and the library, under mu
    std::mutex mu;
    int gain = 100; // percent
    struct Bank {
        std::string name;
        std::vector<std::vector<uint8_t>> sounds; // a dump's bytes each (empty: no sound there)
    };
    std::vector<Bank> banks; // the library
    int bank = 0, preset = 0;
    std::vector<uint8_t> single; // the sound in the edit buffer, as loaded and edited
    bool haveSingle = false;
    bool pendingLoad = false;             // a sound waits for the emulator to be up
    std::atomic<bool> dumpPending{false}; // a sound waits for the ring to be deep enough
    int64_t deepUntil = 0;                // the emulator thread's
    char status[160] = "Starting";
    char error[200] = "";
#if defined(WALDORF_XT)
    // The sound's wavetable as its real waves, for the screen (wave_view): the
    // table's 64 slots and the waves in them, asked of the synth (the XT
    // answers from its ROM, as for gearmulator's wave editor). Under mu.
    int tableWanted = -1, tableHave = -1;    // a wavetable number
    bool tableAlgorithmic = false;           // generated, not stored: nothing to ask
    std::vector<uint16_t> tableWaves;        // its 64 slots' wave ids
    std::map<uint16_t, std::vector<int8_t>> waves; // wave id -> 128 samples
    std::vector<uint16_t> wavesMissing;      // asked one at a time: the XT drops a burst
    int waveAsked = -1;                      // the wave asked for, until it comes
    int64_t tableAskedAt = 0, waveAskedAt = 0; // the emulator thread's
#endif
};

void set_status(Instance *in, const char *s) {
    std::lock_guard<std::mutex> l(in->mu);
    snprintf(in->status, sizeof(in->status), "%s", s);
}

void send(Instance *in, synthLib::SMidiEvent &ev) {
    std::lock_guard<std::mutex> l(in->plugMu);
    if (in->plugin) in->plugin->addMidiEvent(ev);
}

#if defined(WALDORF_XT)
// mu held: the emulator thread asks for what the screen needs of the wavetable
void ask_waves(Instance *in) {
    if (!in->haveSingle) return;
    if (!in->wavesMissing.empty() && (in->waveAsked < 0 || now_us() - in->waveAskedAt > 200000)) {
        const uint16_t w = in->wavesMissing.front();
        if (in->waves.count(w)) {
            in->wavesMissing.erase(in->wavesMissing.begin());
            in->waveAsked = -1;
            return;
        }
        in->waveAsked = w;
        in->waveAskedAt = now_us();
        synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
        ev.sysex = {0xf0, 0x3e, 0x0e, 0x7f, 0x02, uint8_t(w >> 7), uint8_t(w & 0x7f), 0xf7};
        send(in, ev);
    }
    const int t = in->single[25]; // "Wave": the wavetable
    in->tableWanted = t;
    if (t == in->tableHave || now_us() - in->tableAskedAt < 300000) return;
    in->tableAskedAt = now_us();
    in->tableAlgorithmic = xt::wave::isAlgorithmicTable(xt::TableId(uint16_t(t)));
    if (in->tableAlgorithmic) {
        in->tableHave = t;
        in->tableWaves.clear();
        return;
    }
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex = {0xf0, 0x3e, 0x0e, 0x7f, 0x03, uint8_t(t >> 7), uint8_t(t & 0x7f), 0xf7};
    if (getenv("PUNG_SCAN_LOG")) fprintf(stderr, "asking for table %d\n", t);
    send(in, ev);
}

// an answer of the synth's: a table, or a wave of it
void take_wave_answer(Instance *in, const synthLib::SMidiEvent &e) {
    const auto &sx = e.sysex;
    if (sx.size() < 8 || sx[1] != 0x3e || sx[2] != 0x0e) return;
    if (sx[4] == 0x13) { // a table
        xt::TableData table;
        if (!xt::State::parseTableData(table, sx)) return;
        const int id = xt::State::getTableId(sx).rawId();
        {
            std::lock_guard<std::mutex> l(in->mu);
            if (id != in->tableWanted) return;
            in->tableHave = id;
            in->tableWaves.clear();
            if (getenv("PUNG_SCAN_LOG")) {
                fprintf(stderr, "table %d:", id);
                for (const auto &w : table) fprintf(stderr, " %u", unsigned(w.rawId()));
                fprintf(stderr, "\n");
            }
            in->wavesMissing.clear();
            for (const auto &w : table) {
                in->tableWaves.push_back(w.rawId());
                if (xt::wave::isValidWaveIndex(w.rawId()) && !in->waves.count(w.rawId()))
                    in->wavesMissing.push_back(w.rawId());
            }
            std::sort(in->wavesMissing.begin(), in->wavesMissing.end());
            in->wavesMissing.erase(std::unique(in->wavesMissing.begin(), in->wavesMissing.end()), in->wavesMissing.end());
        }
    } else if (sx[4] == 0x12) { // a wave
        xt::WaveData wave;
        if (!xt::State::parseWaveData(wave, sx)) return;
        std::lock_guard<std::mutex> l(in->mu);
        const uint16_t id = xt::State::getWaveId(sx).rawId();
        in->waves[id] = std::vector<int8_t>(wave.begin(), wave.end());
        if (id == in->waveAsked) {
            in->waveAsked = -1;
            in->wavesMissing.erase(std::remove(in->wavesMissing.begin(), in->wavesMissing.end(), id), in->wavesMissing.end());
        }
    }
}

// mu held: sixteen of the table's positions (0, 4 .. 60), 32 points each, as
// two hex digits a point (0x80 the middle). A position between two key waves
// is their crossfade, as the synth plays it; after the last key wave, that
// one. (61-63 are the fixed triangle, square and saw, and not drawn.) "" while
// the waves are still coming, "algo" for a table the synth computes.
std::string wave_view(const Instance *in) {
    if (in->tableHave != in->tableWanted || in->tableWanted < 0) return "";
    if (in->tableAlgorithmic) return "algo";
    if (in->tableWaves.size() != 64 || !in->wavesMissing.empty()) return "";
    std::vector<int> keys; // the positions with a wave of their own
    for (int i = 0; i <= 60; i++) {
        const uint16_t w = in->tableWaves[size_t(i)];
        if (xt::wave::isValidWaveIndex(w) && in->waves.count(w)) keys.push_back(i);
    }
    if (keys.empty()) return "";
    auto sample = [&](int pos, int i) -> int {
        size_t k = 0;
        while (k + 1 < keys.size() && keys[k + 1] <= pos) k++;
        const auto &a = in->waves.at(in->tableWaves[size_t(keys[k])]);
        if (pos <= keys[k] || k + 1 >= keys.size()) return a[size_t(i)];
        const auto &b = in->waves.at(in->tableWaves[size_t(keys[k + 1])]);
        return a[size_t(i)] + (b[size_t(i)] - a[size_t(i)]) * (pos - keys[k]) / (keys[k + 1] - keys[k]);
    };
    std::string o;
    char b[3];
    for (int pos = 0; pos <= 60; pos += 4)
        for (int i = 0; i < 128; i += 4) {
            snprintf(b, sizeof(b), "%02x", uint8_t(sample(pos, i) + 128));
            o += b;
        }
    return o;
}
#endif

// What goes past the headroom bends instead of breaking (Nodal Red 2X: a
// hard corner is a click on every peak).
inline float soft_limit(float v) {
    const float knee = 24576.f, room = 32767.f - knee;
    const float a = v < 0 ? -v : v;
    if (a <= knee) return v;
    const float o = knee + room * std::tanh((a - knee) / room);
    return v < 0 ? -o : o;
}

// ---- sounds ----------------------------------------------------------------------

std::string text_at(const std::vector<uint8_t> &d, int at, int n) {
    std::string s;
    if (at < 0) return s;
    for (int i = 0; i < n && at + i < int(d.size()); i++) {
        const char c = char(d[size_t(at + i)]);
        s.push_back(c >= 32 && c < 127 ? c : ' ');
    }
    // the name field is padded to its 16 letters, the programmer's initials
    // last ("Rain         WMF"): one space between words
    std::string o;
    for (char c : s)
        if (c != ' ' || (!o.empty() && o.back() != ' ')) o.push_back(c);
    while (!o.empty() && o.back() == ' ') o.pop_back();
    return o;
}

std::string json_text(const std::string &s) {
    std::string o;
    for (char c : s) {
        if (c == '"' || c == '\\') o.push_back('\\');
        if (uint8_t(c) >= 32) o.push_back(c);
    }
    return o;
}

// mu held: the sound in the edit buffer, to the synth
void send_single(Instance *in) {
    if (!in->haveSingle || int(in->single.size()) != fam::DATA) return;
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex = {0xf0, fam::WALDORF, fam::MODEL, fam::OMNI, fam::SINGLE_DUMP, fam::EDIT, 0x00};
    ev.sysex.insert(ev.sysex.end(), in->single.begin(), in->single.end());
    uint8_t sum = 0;
    for (size_t i = size_t(fam::CHECKSUM_FROM); i < ev.sysex.size(); i++) sum = uint8_t(sum + ev.sysex[i]);
    ev.sysex.push_back(sum & 0x7f);
    ev.sysex.push_back(0xf7);
    send(in, ev);
}

// mu held. A sound of the library becomes the device's sound.
bool load_sound(Instance *in, int bank, int preset) {
    in->bank = std::max(0, bank);
    in->preset = std::max(0, preset);
    if (in->banks.empty()) {
        in->pendingLoad = true; // the library is not read yet: when it is
        return false;
    }
    if (bank >= int(in->banks.size()) || preset >= int(in->banks[size_t(bank)].sounds.size())) return false;
    const auto &d = in->banks[size_t(bank)].sounds[size_t(preset)];
    if (d.empty()) return false;
    in->single = d;
    in->haveSingle = true;
    if (in->loading.load()) in->pendingLoad = true;
    else in->dumpPending = true; // the emulator thread sends it, with the ring deep (AHEAD_DUMP)
    return true;
}

// A single dump: its bank letter (0 = A) and place, or false.
template <typename Bytes> // a SysexBuffer (a pmr vector) or a plain one
bool single_dump(const Bytes &s, int &bank, int &place) {
    if (fam::DATA == 0 || s.size() != size_t(fam::DATA + 9) || s[1] != fam::WALDORF || s[2] != fam::MODEL || s[4] != fam::SINGLE_DUMP)
        return false;
    bank = s[5] >= fam::BANK0 ? s[5] - fam::BANK0 : s[5];
    place = s[6];
    return bank >= 0 && bank < 26 && place < 128;
}

// The sound sets in the module's sounds/ folder: every file's single dumps,
// a bank per bank letter in it. With one set the banks are "Bank A"...;
// with several, a bank says which set it comes from.
std::vector<Instance::Bank> read_sets(const std::string &dir) {
    std::vector<std::string> files;
    if (DIR *d = opendir(dir.c_str())) {
        while (dirent *e = readdir(d)) {
            const std::string n = e->d_name;
            if (n[0] == '.' || n.size() < 5) continue;
            std::string x = n.substr(n.size() - 4);
            for (auto &c : x) c = char(tolower(c));
            if (x == ".mid" || x == ".syx") files.push_back(n);
        }
        closedir(d);
    }
    std::sort(files.begin(), files.end());
    std::vector<Instance::Bank> out;
    for (const auto &f : files) {
        synthLib::SysexBufferList msgs;
        if (!synthLib::MidiToSysex::extractSysexFromFile(msgs, dir + "/" + f)) continue;
        std::vector<Instance::Bank> mine(26);
        int n = 0;
        for (const auto &m : msgs) {
            int b, p;
            if (!single_dump(m, b, p)) continue;
            auto &snd = mine[size_t(b)].sounds;
            if (snd.size() <= size_t(p)) snd.resize(size_t(p) + 1);
            snd[size_t(p)].assign(m.begin() + 7, m.begin() + 7 + fam::DATA);
            n++;
        }
        plog("%s: %d sounds", f.c_str(), n);
        const std::string stem = f.substr(0, f.size() - 4);
        for (int b = 0; b < 26; b++) {
            if (mine[size_t(b)].sounds.empty()) continue;
            mine[size_t(b)].name = std::string(files.size() > 1 ? stem + " " : "Bank ") + char('A' + b);
            out.push_back(std::move(mine[size_t(b)]));
        }
    }
    return out;
}

// The emulator thread's, before audio: the sets, else the synth is asked for
// every sound, one at a time, and the emulator runs until each answer is in.
void read_library(Instance *in) {
    set_status(in, "Reading the sounds");
    auto sets = read_sets(in->dir + "/sounds");
    if (!sets.empty()) {
        std::lock_guard<std::mutex> l(in->mu);
        in->banks = std::move(sets);
        return;
    }
    if (fam::BANKS == 0) return;
    float buf[12][BLOCK];
    synthLib::TAudioInputs ins{};
    synthLib::TAudioOutputs outs{};
    for (size_t i = 0; i < outs.size() && i < 12; i++) outs[i] = buf[i];
    float silent[BLOCK] = {0};
    for (size_t i = 0; i < ins.size(); i++) ins[i] = silent;
    std::vector<synthLib::SMidiEvent> midiOut;
    std::vector<Instance::Bank> lib(size_t(fam::BANKS));
    for (int b = 0; b < fam::BANKS; b++) {
        lib[size_t(b)].name = fam::BANK_NAME[b];
        lib[size_t(b)].sounds.resize(size_t(fam::SOUNDS));
    }
    const int64_t t0 = now_us();
    int got = 0;
    // PUNG_SCAN_LOG: every answer and its time in the synth's own clock, and no early end
    const bool scanLog = getenv("PUNG_SCAN_LOG") != nullptr;
    for (int b = 0; b < fam::BANKS && !in->quit.load() && !(got == 0 && b > 0); b++) {
        char st[80];
        snprintf(st, sizeof(st), "Reading the sounds: %s", fam::BANK_NAME[b]);
        set_status(in, st);
        int misses = 0; // a bank with fewer sounds than places (the XT's B has 100 of 128): three gaps end it
        for (int p = 0; p < fam::SOUNDS && !in->quit.load() && !(got == 0 && p > 0); p++) { // nothing for the first: nothing there
            synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
            ev.sysex = {0xf0, fam::WALDORF, fam::MODEL, fam::OMNI, fam::REQUEST_SINGLE, uint8_t(fam::BANK0 + b), uint8_t(p), 0xf7};
            send(in, ev);
            // the first answer waits for the OS to settle, and a bank's first for the
            // synth to turn to it (the XT's B came after the A run's timeout); the
            // others come quickly
            const int limit = got == 0 || p == 0 ? 44100 * 10 / BLOCK : 44100 * 2 / BLOCK;
            bool done = false;
            for (int k = 0; k < limit && !done && !in->quit.load(); k++) {
                in->plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
                midiOut.clear();
                in->plugin->getMidiOut(midiOut);
                for (const auto &e : midiOut) {
                    const auto &s = e.sysex;
                    int rb, rp;
                    if (scanLog && s.size() > 6)
                        plog("asked %c%d, after %d ms: %d bytes, %02x %02x %02x", 'A' + b, p + 1, k * BLOCK * 1000 / 44100, int(s.size()),
                             s[4], s[5], s[6]);
                    if (!single_dump(s, rb, rp) || rb >= fam::BANKS || rp >= fam::SOUNDS) continue;
                    lib[size_t(rb)].sounds[size_t(rp)].assign(s.begin() + 7, s.begin() + 7 + fam::DATA);
                    if (rb == b && rp == p) done = true;
                }
            }
            if (done) {
                got++;
                misses = 0;
            } else if (++misses >= 3 && !scanLog) {
                plog("%s ends before sound %d", fam::BANK_NAME[b], p - 1);
                break;
            }
        }
    }
    plog("the synth gave %d sounds in %d ms", got, int((now_us() - t0) / 1000));
    if (got == 0) return; // no sound set, and none in the synth: no list
    std::lock_guard<std::mutex> l(in->mu);
    in->banks = std::move(lib);
}

// ---- the emulator ---------------------------------------------------------------

void emu_main(Instance *in) {
    pthread_setname_np(pthread_self(), SYNTH_ID);
    // Below the host's audio threads, above everything ordinary (OsTIrus).
    sched_param sp{};
    sp.sched_priority = 45;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) plog("no realtime priority for the emulator (%s)", strerror(errno));

    if (in->lockFd < 0) in->lockFd = open("/dev/shm/pung-" SYNTH_ID ".lock", O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    while (in->lockFd >= 0 && flock(in->lockFd, LOCK_EX | LOCK_NB) != 0) {
        if (!in->waiting.exchange(1)) {
            set_status(in, "Waiting: another " SYNTH_NAME " is running, one at a time");
            plog("another instance has the emulator; waiting for it");
        }
        if (in->quit.load()) return;
        usleep(300000);
    }
    in->waiting = 0;
    if (in->quit.load()) return;
    set_status(in, "Booting the " SYNTH_HW);

    synthLib::RomLoader::addSearchPath(in->dir + "/roms");
    const int64_t t0 = now_us();
    try {
        synthLib::DeviceCreateParams p;
        p.hostSamplerate = 44100.0f;
        p.customData = 0; // no voice expansion: one DSP
        in->device.reset(new SynthDevice(p));
        if (!in->device->isValid()) throw synthLib::DeviceException(synthLib::DeviceError::FirmwareMissing);
        std::unique_ptr<synthLib::Plugin> pl(new synthLib::Plugin(in->device.get(), [](synthLib::Device *d) { return d; }));
        pl->setHostSamplerate(44100.0f, 0.0f);
        pl->setBlockSize(BLOCK);
        std::lock_guard<std::mutex> l(in->plugMu);
        in->plugin = std::move(pl);
    } catch (const synthLib::DeviceException &e) {
        std::lock_guard<std::mutex> l(in->mu);
        if (e.errorCode() == synthLib::DeviceError::FirmwareMissing) {
            snprintf(in->error, sizeof(in->error), "No firmware: put %s into the module's roms folder", FIRMWARE_HINT);
            snprintf(in->status, sizeof(in->status), "Firmware missing");
        } else {
            snprintf(in->error, sizeof(in->error), "The emulator did not start: %s", e.what());
            snprintf(in->status, sizeof(in->status), "Failed");
        }
        in->device.reset();
        in->loading = 0;
        return;
    } catch (const std::exception &e) {
        std::lock_guard<std::mutex> l(in->mu);
        snprintf(in->error, sizeof(in->error), "The emulator did not start: %s", e.what());
        snprintf(in->status, sizeof(in->status), "Failed");
        in->device.reset();
        in->loading = 0;
        return;
    }
    plog("booted in %d ms", int((now_us() - t0) / 1000));
    if (fam::BOOT) {
        synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
        ev.sysex.assign(fam::BOOT, fam::BOOT + fam::BOOT_LEN);
        send(in, ev);
    }
    read_library(in);
    {
        std::lock_guard<std::mutex> l(in->mu);
        // a sound a Set gave back, else the one asked for, else the first
        if (!in->haveSingle) load_sound(in, in->bank, in->preset);
        if (!in->haveSingle) load_sound(in, 0, 0);
        in->pendingLoad = false;
        snprintf(in->status, sizeof(in->status), "Warming up the " SYNTH_HW);
    }
    // Warm-up, before the first note anyone hears (OsTIrus): the DSP
    // emulator compiles the synth's code the first time it runs it, and the
    // first chords after a start underran the ring while it did (seven in a
    // minute's playing, a block taking 22 ms, none once warm; measured
    // 2026-11-20). The sound is loaded and a chord played, unheard.
    {
        float wb[12][BLOCK];
        synthLib::TAudioInputs wi{};
        synthLib::TAudioOutputs wo{};
        float z[BLOCK] = {0};
        for (size_t i = 0; i < wo.size() && i < 12; i++) wo[i] = wb[i];
        for (size_t i = 0; i < wi.size(); i++) wi[i] = z;
        std::vector<synthLib::SMidiEvent> sink;
        auto run = [&](double seconds) {
            for (int b = 0; b < int(44100 * seconds / BLOCK) && !in->quit.load(); b++) {
                in->plugin->process(wi, wo, BLOCK, 120.0f, 0.0f, false);
                sink.clear();
                in->plugin->getMidiOut(sink);
            }
        };
        {
            std::lock_guard<std::mutex> l(in->mu);
            send_single(in);
        }
        run(0.3);
        const uint8_t notes[] = {36, 48, 55, 60, 64, 67, 72, 79};
        for (uint8_t n : notes) {
            synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, 0x90, n, 100);
            send(in, ev);
        }
        run(1.5);
        synthLib::SMidiEvent off(synthLib::MidiEventSource::Host, 0xb0, 123, 0); // all notes off
        send(in, off);
        run(1.0);
    }
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (in->haveSingle) in->dumpPending = true; // again, for the sound to start clean
        snprintf(in->status, sizeof(in->status), SYNTH_HW);
        in->loading = 0;
    }

    float buf[12][BLOCK];
    synthLib::TAudioInputs ins{};
    synthLib::TAudioOutputs outs{};
    for (size_t i = 0; i < outs.size() && i < 12; i++) outs[i] = buf[i];
    float silent[BLOCK] = {0};
    for (size_t i = 0; i < ins.size(); i++) ins[i] = silent;
    std::vector<synthLib::SMidiEvent> midiOut;

    while (!in->quit.load(std::memory_order_relaxed)) {
        uint32_t fill = in->wr.load(std::memory_order_relaxed) - in->rd.load(std::memory_order_acquire);
        if (in->dumpPending.load() && fill >= uint32_t(AHEAD_DUMP)) {
            std::lock_guard<std::mutex> l(in->mu);
            in->dumpPending = false;
            send_single(in);
            in->deepUntil = now_us() + 2500000;
        }
        const int64_t tnow = now_us(), miss = in->missAt.load(std::memory_order_relaxed);
        const bool deep = in->dumpPending.load() || tnow < in->deepUntil || (miss && tnow - miss < MISS_DEEP_US);
        const uint32_t target = deep ? uint32_t(AHEAD_DUMP) : uint32_t(AHEAD);
        while (fill < target && !in->quit.load(std::memory_order_relaxed)) {
            const int64_t b0 = now_us();
            for (auto &b : buf) memset(b, 0, sizeof(b));
            in->plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
            midiOut.clear();
            in->plugin->getMidiOut(midiOut);
#if defined(WALDORF_XT)
            for (const auto &e : midiOut)
                if (!e.sysex.empty()) {
                    if (getenv("PUNG_SCAN_LOG") && e.sysex.size() > 6)
                        fprintf(stderr, "sysex out: %zu bytes cmd %02x %02x %02x\n", e.sysex.size(), e.sysex[4], e.sysex[5], e.sysex[6]);
                    take_wave_answer(in, e);
                }
            {
                std::lock_guard<std::mutex> l(in->mu);
                ask_waves(in);
            }
#endif
            // 6 dB of headroom, and a soft limiter above 3/4 of full scale
            const float g = float(in->gain) * 0.01f * 0.5f * 32767.0f;
            const uint32_t w = in->wr.load(std::memory_order_relaxed);
            for (int i = 0; i < BLOCK; i++) {
                const uint32_t k = (w + uint32_t(i)) & (RING - 1);
                in->ring[k * 2] = int16_t(lrintf(soft_limit(buf[0][i] * g)));
                in->ring[k * 2 + 1] = int16_t(lrintf(soft_limit(buf[1][i] * g)));
            }
            in->wr.store(w + BLOCK, std::memory_order_release);
            const uint32_t us = uint32_t(now_us() - b0);
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


// ---- parameters ------------------------------------------------------------------
// Every one is bits of a byte of the single (tbl::Param: byte, mask, shift),
// read from the sound as loaded and sent to the synth as a single parameter
// change when it is turned, the whole byte, so the dump is always the sound
// as it is. An effect knob (kFx) is whatever the slot's effect type makes it.
#if HAVE_PARAMS
const tbl::Param *find_param(const char *key) {
    static std::unordered_map<std::string, int> idx;
    if (idx.empty())
        for (int i = 0; i < tbl::kNumParams; i++) idx.emplace(tbl::kParams[i].key, i);
    auto it = idx.find(key);
    return it == idx.end() ? nullptr : &tbl::kParams[it->second];
}

// mu held: the effect type a slot holds
int fx_type(const Instance *in, int fx) {
    static const tbl::Param *t1 = find_param("fx1_type"), *t2 = find_param("fx2_type");
    const tbl::Param *t = fx == 1 ? t1 : t2;
    return t && in->haveSingle ? in->single[size_t(t->byte)] : 0;
}

// mu held: what a knob is now (an effect knob: by the type; nullptr: nothing)
const tbl::Param *resolve(const Instance *in, const tbl::Param *p) {
    if (p->kind != tbl::kFx) return p;
    const int t = fx_type(in, p->fx);
    for (int i = 0; i < tbl::kNumFxTypes; i++) {
        const auto &f = tbl::kFxTable[i];
        if (f.fx == p->fx && f.type == t) return p->slot >= 1 && p->slot <= f.n ? &f.p[p->slot - 1] : nullptr;
    }
    return nullptr;
}

int raw_of(const Instance *in, const tbl::Param &p) {
    int v = in->single[size_t(p.byte)];
    if (p.mask) v = (v >> p.shift) & p.mask;
    return v;
}

// a raw value as Pung reads it: an enum's index, an octave's, a number as shown
int value_of(const tbl::Param &p, int raw) {
    if (p.rawmap >= 0) { // an enum of the named options only: where the raw value is among them
        for (int i = 0; i < tbl::kListLen[p.list]; i++)
            if (tbl::kRawMaps[p.rawmap][i] == raw) return i;
        return 0;
    }
    switch (p.kind) {
    case tbl::kEnum: return std::max(0, std::min(int(p.max), raw) - int(p.min));
    case tbl::kOctave: return p.step ? std::max(0, (raw - p.raw_min) / p.step) : 0;
    default: return raw - p.offset;
    }
}

int raw_from(const tbl::Param &p, int v) {
    if (p.rawmap >= 0) return tbl::kRawMaps[p.rawmap][std::max(0, std::min(tbl::kListLen[p.list] - 1, v))];
    switch (p.kind) {
    case tbl::kEnum: return std::max(int(p.min), std::min(int(p.max), v + p.min));
    case tbl::kOctave: return p.raw_min + std::max(0, std::min(int(p.max), v)) * p.step;
    default: return std::max(int(p.min), std::min(int(p.max), v + p.offset));
    }
}

// the text a value shows ("" for a plain number)
std::string text_of(const tbl::Param &p, int raw) {
    if (p.list < 0) return std::to_string(raw - p.offset);
    const int i = p.kind == tbl::kOctave || p.rawmap >= 0 ? value_of(p, raw) : raw - p.min;
    return i >= 0 && i < tbl::kListLen[p.list] ? tbl::kLists[p.list][i] : std::to_string(raw);
}

// mu held: a byte of the single to the synth
void send_byte(Instance *in, int idx) {
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex = {0xf0, fam::WALDORF, fam::MODEL, fam::OMNI, fam::SINGLE_PARAM, 0x00, uint8_t(idx >> 7), uint8_t(idx & 0x7f),
                uint8_t(in->single[size_t(idx)] & 0x7f), 0xf7};
    send(in, ev);
}

// mu held
void param_set(Instance *in, const tbl::Param &knob, const char *val) {
    const tbl::Param *p = resolve(in, &knob);
    if (!p) return;
    char *end = nullptr;
    long v = strtol(val, &end, 10);
    if (end == val) { // an option by its name
        if (p->list < 0) return;
        v = -1;
        for (int i = 0; i < tbl::kListLen[p->list]; i++)
            if (!strcasecmp(tbl::kLists[p->list][i], val)) v = i;
        if (v < 0) return;
        if (p->kind == tbl::kLabels) v += p->min - p->offset;
    }
    const int raw = raw_from(*p, int(v));
    uint8_t &b = in->single[size_t(p->byte)];
    if (p->mask) b = uint8_t((b & ~(p->mask << p->shift)) | ((raw & p->mask) << p->shift));
    else b = uint8_t(raw);
    if (!in->loading.load()) send_byte(in, p->byte);
}

// mu held: an effect slot's knobs as the type makes them, "|" between
std::string fx_row(const Instance *in, int fx, bool values) {
    std::string o;
    for (int slot = 1; slot <= 14; slot++) {
        char key[16];
        snprintf(key, sizeof(key), "fx%d_p%d", fx, slot);
        const tbl::Param *k = find_param(key);
        const tbl::Param *p = k ? resolve(in, k) : nullptr;
        if (slot > 1) o += "|";
        if (p) o += values ? text_of(*p, raw_of(in, *p)) : p->name;
    }
    return o;
}
#endif

// ---- state ---------------------------------------------------------------------

bool json_field(const char *json, const char *key, std::string &out) {
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\":", key);
    const char *p = strstr(json, pat);
    if (!p) return false;
    p += strlen(pat);
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
    if (fam::DATA > 0 && json_field(val, "single", hex) && hex.size() == size_t(fam::DATA) * 2) {
        std::vector<uint8_t> d(size_t(fam::DATA));
        for (size_t i = 0; i < d.size(); i++) {
            const int a = hexv(hex[i * 2]), b = hexv(hex[i * 2 + 1]);
            if (a < 0 || b < 0) return;
            d[i] = uint8_t(a * 16 + b);
        }
        in->single = std::move(d);
        in->haveSingle = true;
        if (in->loading.load()) in->pendingLoad = true;
        else in->dumpPending = true;
    }
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
        // the wheel, the pedals and the panic controllers only: every other
        // controller is a knob of the synth, and would move the sound behind
        // the parameters' back
        if (d1 != 1 && d1 != 2 && d1 != 11 && d1 != 64 && d1 != 120 && d1 != 123) return;
        break;
    default:
        return;
    }
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, st, d1, d2); // channel 1
    send(in, ev);
}

void v2_set_param(void *instance, const char *key, const char *val) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !val) return;
    std::lock_guard<std::mutex> l(in->mu);
    if (!strcmp(key, "state")) {
        set_state(in, val);
    } else if (!strcmp(key, "preset")) {
        char *end = nullptr;
        const int n = int(strtol(val, &end, 10));
        if (end != val) load_sound(in, in->bank, n);
    } else if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select") || !strcmp(key, "bank")) {
        int n = -1;
        for (size_t i = 0; i < in->banks.size(); i++)
            if (in->banks[i].name == val) n = int(i);
        if (n < 0) {
            char *end = nullptr;
            n = int(strtol(val, &end, 10));
            if (end == val) return;
        }
        if (n == in->bank && in->haveSingle) return;
        load_sound(in, n, 0); // as on the synth: a bank's first sound, so the list and the sound agree
    } else if (!strcmp(key, "gain")) {
        in->gain = std::max(1, std::min(200, atoi(val)));
#if HAVE_PARAMS
    } else if (const tbl::Param *p = find_param(key)) {
        if (in->haveSingle) param_set(in, *p, val);
#endif
    } else if (!strcmp(key, "all_notes_off")) {
        synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, 0xb0, 123, 0);
        send(in, ev);
    }
}

#define AP(...)                                                              \
    do {                                                                     \
        if (off < len) off += snprintf(buf + off, size_t(len - off), __VA_ARGS__); \
    } while (0)

// mu held: a sound's name in the library ("" when there is none)
std::string lib_name(const Instance *in, int bank, int i) {
    if (bank < 0 || bank >= int(in->banks.size()) || i < 0 || i >= int(in->banks[size_t(bank)].sounds.size())) return std::string();
    return text_at(in->banks[size_t(bank)].sounds[size_t(i)], fam::NAME_AT, fam::NAME_LEN);
}

// mu held: the sounds in the current bank
int bank_size(const Instance *in) {
    return in->bank >= 0 && in->bank < int(in->banks.size()) ? int(in->banks[size_t(in->bank)].sounds.size()) : 0;
}

int v2_get_param(void *instance, const char *key, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !buf || len <= 0) return -1;
    if (!strcmp(key, "debug_info"))
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u", in->underruns.load(), in->blockUs.load(),
                        in->blockMaxUs.exchange(0), in->wr.load() - in->rd.load());
    std::lock_guard<std::mutex> l(in->mu);
    const int nb = int(in->banks.size()), ns = bank_size(in);
    if (!strcmp(key, "status")) return snprintf(buf, size_t(len), "%s", in->status);
    if (!strcmp(key, "load_error")) return snprintf(buf, size_t(len), "%s", in->error);
    if (!strcmp(key, "gain")) return snprintf(buf, size_t(len), "%d", in->gain);
    if (!strcmp(key, "preset")) return snprintf(buf, size_t(len), "%d", in->preset);
    if (!strcmp(key, "preset_count")) return snprintf(buf, size_t(len), "%d", ns);
    if (!strcmp(key, "preset_name")) {
        // the name the sound itself carries: also right for a sound a Set gave back
        if (in->haveSingle) return snprintf(buf, size_t(len), "%s", text_at(in->single, fam::NAME_AT, fam::NAME_LEN).c_str());
        return snprintf(buf, size_t(len), "%s", lib_name(in, in->bank, in->preset).c_str());
    }
#if defined(WALDORF_XT)
    if (!strcmp(key, "wave_view")) return snprintf(buf, size_t(len), "%s", wave_view(in).c_str());
#endif
    if (!strcmp(key, "category"))
        return snprintf(buf, size_t(len), "%s", in->haveSingle ? text_at(in->single, fam::CAT_AT, fam::CAT_LEN).c_str() : "");
    if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select") || !strcmp(key, "bank")) return snprintf(buf, size_t(len), "%d", in->bank);
    if (!strcmp(key, "bank_count")) return snprintf(buf, size_t(len), "%d", nb);
    if (!strcmp(key, "bank_name")) return snprintf(buf, size_t(len), "%s", in->bank < nb ? json_text(in->banks[size_t(in->bank)].name).c_str() : "");
    if (!strcmp(key, "bank_list")) {
        int off = 0;
        AP("[");
        for (int i = 0; i < nb; i++) AP("%s\"%s\"", i ? "," : "", json_text(in->banks[size_t(i)].name).c_str());
        AP("]");
        return off < len ? off : -1;
    }
    if (!strcmp(key, "preset_names")) {
        int off = 0;
        AP("[");
        for (int i = 0; i < ns; i++) AP("%s\"%s\"", i ? "," : "", json_text(lib_name(in, in->bank, i)).c_str());
        AP("]");
        return off < len ? off : -1;
    }
    if (!strncmp(key, "preset_name_", 12)) {
        const int i = atoi(key + 12);
        return snprintf(buf, size_t(len), "%s", lib_name(in, in->bank, i).c_str());
    }
#if HAVE_PARAMS
    if (const tbl::Param *k = find_param(key)) {
        const tbl::Param *p = in->haveSingle ? resolve(in, k) : nullptr;
        if (!in->haveSingle) return -1;
        return snprintf(buf, size_t(len), "%d", p ? value_of(*p, raw_of(in, *p)) : 0);
    }
    if (!strcmp(key, "fx1_labels") || !strcmp(key, "fx2_labels") || !strcmp(key, "fx1_values") || !strcmp(key, "fx2_values"))
        return snprintf(buf, size_t(len), "%s", in->haveSingle ? fx_row(in, key[2] - '0', key[4] == 'v').c_str() : "");
#endif
    if (!strcmp(key, "chain_params")) {
        int off = 0;
        AP("[{\"key\":\"preset\",\"name\":\"Sound\",\"type\":\"int\",\"min\":0,\"max\":127}");
        AP(",{\"key\":\"gain\",\"name\":\"Output Gain\",\"type\":\"int\",\"min\":1,\"max\":200,\"unit\":\"%%\"}");
#if HAVE_PARAMS
        for (int i = 0; i < tbl::kNumParams; i++) {
            const tbl::Param &p = tbl::kParams[i];
            AP(",{\"key\":\"%s\",\"name\":\"%s\"", p.key, json_text(p.name).c_str());
            if (p.short_[0]) AP(",\"short\":\"%s\"", json_text(p.short_).c_str());
            if (p.kind == tbl::kEnum && p.list >= 0) {
                AP(",\"type\":\"enum\",\"options\":[");
                for (int j = 0; j < tbl::kListLen[p.list]; j++) AP("%s\"%s\"", j ? "," : "", json_text(tbl::kLists[p.list][j]).c_str());
                AP("]}");
            } else if (p.kind == tbl::kFx) {
                AP(",\"type\":\"int\",\"min\":0,\"max\":127}");
            } else if (p.kind == tbl::kOctave) {
                AP(",\"type\":\"int\",\"min\":0,\"max\":%d,\"value_labels\":\"L%d\"}", p.max, p.list);
            } else {
                AP(",\"type\":\"int\",\"min\":%d,\"max\":%d", p.min - p.offset, p.max - p.offset);
                if (p.kind == tbl::kLabels && p.list >= 0) AP(",\"value_labels\":\"L%d\"", p.list);
                AP("}");
            }
        }
#endif
        AP("]");
        return off < len ? off : -1;
    }
#if HAVE_PARAMS
    // the value texts the numbers name (chain_params "value_labels": "L<n>")
    if (!strcmp(key, "value_lists")) {
        std::vector<bool> used(sizeof(tbl::kListLen) / sizeof(tbl::kListLen[0]));
        for (int i = 0; i < tbl::kNumParams; i++)
            if ((tbl::kParams[i].kind == tbl::kLabels || tbl::kParams[i].kind == tbl::kOctave) && tbl::kParams[i].list >= 0)
                used[size_t(tbl::kParams[i].list)] = true;
        int off = 0;
        AP("{");
        bool first = true;
        for (size_t l = 0; l < used.size(); l++) {
            if (!used[l]) continue;
            AP("%s\"L%d\":[", first ? "" : ",", int(l));
            first = false;
            for (int j = 0; j < tbl::kListLen[l]; j++) AP("%s\"%s\"", j ? "," : "", json_text(tbl::kLists[l][j]).c_str());
            AP("]");
        }
        AP("}");
        return off < len ? off : -1;
    }
#endif
    if (!strcmp(key, "ui_hierarchy")) {
        // the root is the sound list, its knobs the first page; every page a
        // level of eight knobs, in the layout's order (kPages)
        int off = 0;
#if HAVE_PARAMS
        auto knobs = [&](const tbl::Page &pg) {
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
        knobs(tbl::kPages[0]);
        AP(",\"params\":[{\"level\":\"banks\",\"label\":\"Bank\"}");
        for (int i = 1; i < tbl::kNumPages; i++) AP(",{\"level\":\"p%d\",\"label\":\"%s\"}", i, tbl::kPages[i].label);
        AP(",{\"level\":\"synth\",\"label\":\"Synth\"}]}");
        AP(",\"banks\":{\"label\":\"Bank\",\"items_param\":\"bank_list\",\"select_param\":\"bank_select\","
           "\"navigate_to\":\"root\",\"children\":null,\"knobs\":[],\"params\":[]}");
        for (int i = 1; i < tbl::kNumPages; i++) {
            AP(",\"p%d\":{\"label\":\"%s\",\"children\":null,\"knobs\":", i, tbl::kPages[i].label);
            knobs(tbl::kPages[i]);
            AP(",\"params\":[");
            bool f = true;
            for (const char *k : tbl::kPages[i].keys)
                if (const tbl::Param *p = k ? find_param(k) : nullptr) {
                    AP("%s{\"key\":\"%s\",\"label\":\"%s\"}", f ? "" : ",", k, json_text(p->name).c_str());
                    f = false;
                }
            AP("]}");
        }
        AP(",\"synth\":{\"label\":\"Synth\",\"children\":null,\"knobs\":[\"gain\"],"
           "\"params\":[{\"key\":\"gain\",\"label\":\"Output Gain\"}]}}}");
#else
        AP("{\"modes\":null,\"levels\":{\"root\":{\"list_param\":\"preset\",\"count_param\":\"preset_count\","
           "\"name_param\":\"preset_name\",\"children\":null,\"knobs\":[\"gain\"],"
           "\"params\":[{\"level\":\"banks\",\"label\":\"Bank\"},{\"level\":\"synth\",\"label\":\"Synth\"}]},");
        AP("\"banks\":{\"label\":\"Bank\",\"items_param\":\"bank_list\",\"select_param\":\"bank_select\","
           "\"navigate_to\":\"root\",\"children\":null,\"knobs\":[],\"params\":[]},");
        AP("\"synth\":{\"label\":\"Synth\",\"children\":null,\"knobs\":[\"gain\"],"
           "\"params\":[{\"key\":\"gain\",\"label\":\"Output Gain\"}]}}}");
#endif
        return off < len ? off : -1;
    }
    if (!strcmp(key, "state")) {
        int off = 0;
        AP("{\"v\":1,\"gain\":%d,\"bank\":%d,\"preset\":%d", in->gain, in->bank, in->preset);
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
    if (!in || in->loading.load(std::memory_order_relaxed) || !in->device) {
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
