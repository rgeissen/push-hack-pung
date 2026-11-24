// The engine of Pung's two Waldorf modules, as gearmulator emulates them:
// Vavra (the microQ, mqLib; WALDORF_MQ) and Xenia (the Microwave II/XT,
// xtLib; WALDORF_XT), behind the chain host's plugin API. One source, kept
// identical in native/vavra and native/xenia (edit one, copy it over): the two
// synths are one family, a 68000 running Waldorf's OS beside one DSP56300.
//
// Processes. The emulator runs in a process of its own, vavra-engine or
// xenia-engine (waldorf_emu.cpp), and renders into a ring in memory both share
// (emu_shm.h, emu_host.h); render_block only reads the ring. A hung or
// crashed emulator then never holds Pung: a stop kills the engine, and an
// engine that dies is started again. This plugin keeps the sound and talks
// to the engine through two queues (MIDI and dumps to it, what the synth
// sends back from it), on a thread of its own (SYNTH_ID "-run").
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
#include "synthLib/midiToSysex.h"
#include "synthLib/midiTypes.h"

#include "emu_host.h"
#include "waldorf_family.h"

#include <unordered_map>

#if defined(WALDORF_MQ)
#include "mq_params.h" // tools/gen_params.py
namespace tbl = mq;
#define HAVE_PARAMS 1
#else
#include "xtLib/xtState.h" // a wavetable's and a wave's dumps (wave_view)
#include <map>
#include "xt_params.h" // tools/gen_params.py
namespace tbl = xtp;
#define HAVE_PARAMS 1
#endif

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

const int RING = eshm::RING; // stereo frames, a power of two (the engine renders: waldorf_emu.cpp)
// An engine that dies is started again, this many times a minute at most
const int RESTARTS = 3;
// A block that ends short fades out over its last frames, and the one after
// it fades in: the gap is a dip, not a click.
const uint32_t FADE = 32;

struct Instance {
    std::string dir;
    // the engine: its process and the memory shared with it, started and
    // watched by the run thread, which also does what the sound needs of it
    eshm::Host host;
    std::thread run;
    sem_t runWake;
    std::atomic<bool> quit{false};
    // One emulator of a kind at a time: an instance that finds it taken
    // waits, silent, and says so.
    std::atomic<int> waiting{0};
    bool hasLock = false; // holds the one-at-a-time lock (emu_try_lock)
    std::atomic<uint32_t> underruns{0};
    // notes held and the last let go: the sound sounds (live_mod)
    std::atomic<int> held{0};
    std::atomic<int64_t> lastOff{0};
    bool hole = false; // render_block's: the block before ended short

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
    bool pendingLoad = false; // a sound waits for the library to be read
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
    int64_t tableAskedAt = 0, waveAskedAt = 0; // the run thread's
    // A table the synth computes, as it computed it: read from the DSP's wave
    // memory (read_computed_waves). Under mu.
    std::vector<int8_t> computed;  // 16 positions (0, 4 .. 60), 128 samples each
    int computedFor = -1;          // the table they are of
    bool computedFailed = false;   // the wave memory was not where it should be
    // the run thread's: the wave memory when the table changed, the read
    // before, and the engine's snapshot last read (its sequence)
    std::vector<int8_t> memAtChange, memPrev;
    uint32_t memSeq = 0;
#endif
};

// An event to the engine (a sound goes as a dump: send_single).
void send(Instance *in, synthLib::SMidiEvent &ev, uint8_t kind = eshm::EVENT) {
    if (!ev.sysex.empty()) {
        in->host.send(kind, ev.sysex.data(), ev.sysex.size());
    } else {
        const uint8_t b[3] = {ev.a, ev.b, ev.c};
        in->host.send(kind, b, 3);
    }
}

#if defined(WALDORF_XT)
// The sound's table as the synth plays it: the engine reads the DSP's wave
// memory (Y:0x24000, waldorf_emu.cpp, publish_wave_mem) every 100 ms into the
// shared memory. The latest snapshot: true and its 16 positions, or false (not
// published yet, or the memory was not where it should be: *valid says which).
bool read_wave_mem(Instance *in, std::vector<int8_t> &out, uint32_t *seq = nullptr, bool *valid = nullptr) {
    std::vector<uint8_t> b;
    uint32_t sq = 0;
    if (valid) *valid = false;
    if (!in->host.L || !eshm::get_blob(in->host.L, b, WAVE_SNAPSHOT, sq) || sq == 0) return false;
    if (seq) *seq = sq;
    if (!b[0]) return false;
    if (valid) *valid = true;
    out.resize(16 * 128);
    for (size_t i = 0; i < out.size(); i++) out[i] = int8_t(b[1 + i]);
    return true;
}

// The run thread's, after ask_waves: a computed table's waves, once the
// synth has written them (the same in two snapshots 100 ms apart, and not
// still the table before; that one only after 1.5 s, the new table being as it).
void read_computed_waves(Instance *in) {
    int64_t since;
    int t;
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (!in->tableAlgorithmic || in->tableHave != in->tableWanted || in->computedFor == in->tableHave || in->computedFailed) return;
        t = in->tableHave;
        since = in->tableAskedAt;
    }
    const int64_t now = now_us();
    if (now - since < 250000) return;
    std::vector<int8_t> w;
    uint32_t seq = 0;
    bool valid = false;
    read_wave_mem(in, w, &seq, &valid);
    if (seq == 0 || seq == in->memSeq) return; // no new snapshot yet
    in->memSeq = seq;
    if (!valid) {
        if (now - since > 3000000) {
            plog("no wave memory at Y:24000: table %d is named, not drawn", t);
            std::lock_guard<std::mutex> l(in->mu);
            in->computedFailed = true;
        }
        return;
    }
    if (w != in->memPrev) { // still being written
        in->memPrev = std::move(w);
        return;
    }
    if (w == in->memAtChange && now - since < 1500000) return; // the table before, still
    std::lock_guard<std::mutex> l(in->mu);
    if (in->tableHave != t) return;
    in->computed = std::move(w);
    in->computedFor = t;
}

// mu held: the run thread asks for what the screen needs of the wavetable
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
    if (in->tableAlgorithmic) { // nothing to ask: read from the DSP (read_computed_waves)
        in->tableHave = t;
        in->tableWaves.clear();
        in->computedFor = -1;
        in->computedFailed = false;
        in->memPrev.clear();
        if (!read_wave_mem(in, in->memAtChange)) in->memAtChange.clear();
        return;
    }
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex = {0xf0, 0x3e, 0x0e, 0x7f, 0x03, uint8_t(t >> 7), uint8_t(t & 0x7f), 0xf7};
    if (getenv("PUNG_SCAN_LOG")) fprintf(stderr, "asking for table %d\n", t);
    send(in, ev);
}

// an answer of the synth's: a table, or a wave of it
void take_wave_answer(Instance *in, const std::vector<uint8_t> &bytes) {
    synthLib::SysexBuffer sx(bytes.begin(), bytes.end());
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
// one. (61-63 are the fixed triangle, square and saw, and not drawn.) A table
// the synth computes is its computed waves, read from the DSP. "" while the
// waves are still coming, "algo" for a computed table that could not be read.
std::string wave_view(const Instance *in) {
    if (in->tableHave != in->tableWanted || in->tableWanted < 0) return "";
    if (in->tableAlgorithmic) {
        if (in->computedFailed) return "algo";
        if (in->computedFor != in->tableWanted || in->computed.size() != 16 * 128) return "";
        std::string o;
        char b[3];
        for (int pos = 0; pos < 16; pos++)
            for (int i = 0; i < 128; i += 4) {
                snprintf(b, sizeof(b), "%02x", uint8_t(in->computed[size_t(pos * 128 + i)] + 128));
                o += b;
            }
        return o;
    }
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
    send(in, ev, eshm::DUMP); // the engine sends it with the ring deep (AHEAD_DUMP), and plays it in its warm-up
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
    send_single(in);
    return true;
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

// ---- the emulator ---------------------------------------------------------------

#define EMU_LOCK_PATH "/dev/shm/pung-" SYNTH_ID ".lock"
#define EMU_LOCK_PATH_TMP "/tmp/pung-" SYNTH_ID ".lock"

// The one-at-a-time lock. A POSIX record lock, not flock: a process the host
// forks without exec (the JE-8086 module forks its emulator) inherits an
// flock with the open file and holds it as long as it lives, so after a
// restart that loaded this module first a second instance waited forever
// (2026-11-22). A record lock belongs to the process and is not inherited;
// between the instances of one process the flag decides, and the file stays
// open once (closing any descriptor of it drops the process's record locks).
// Between Pung and a probing process the file lock still holds.
static std::mutex g_emuLockMu;
static int g_emuLockFd = -1;
static bool g_emuLockHeld = false;

static bool emu_try_lock() {
    std::lock_guard<std::mutex> l(g_emuLockMu);
    if (g_emuLockHeld) return false;
    if (g_emuLockFd < 0) g_emuLockFd = open(EMU_LOCK_PATH, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (g_emuLockFd < 0) g_emuLockFd = open(EMU_LOCK_PATH_TMP, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (g_emuLockFd >= 0) {
        struct flock fl {};
        fl.l_type = F_WRLCK;
        fl.l_whence = SEEK_SET;
        if (fcntl(g_emuLockFd, F_SETLK, &fl) != 0) return false;
    }
    g_emuLockHeld = true; // (no lock file at all: run, as before)
    return true;
}

static void emu_unlock() {
    std::lock_guard<std::mutex> l(g_emuLockMu);
    if (!g_emuLockHeld) return;
    if (g_emuLockFd >= 0) {
        struct flock fl {};
        fl.l_type = F_UNLCK;
        fl.l_whence = SEEK_SET;
        fcntl(g_emuLockFd, F_SETLK, &fl);
    }
    g_emuLockHeld = false;
}

void run_main(Instance *in) {
    pthread_setname_np(pthread_self(), SYNTH_ID "-run");
    while (!in->hasLock && !(in->hasLock = emu_try_lock())) {
        if (!in->waiting.exchange(1)) plog("another instance has the emulator; waiting for it");
        if (in->quit.load()) return;
        usleep(300000);
    }
    in->waiting = 0;
    if (in->quit.load()) return;
    // the sound sets: the library, without the synth (else the engine asks it)
    auto sets = read_sets(in->dir + "/sounds");
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (!sets.empty()) in->banks = std::move(sets);
    }
    eshm::Layout *L = in->host.L;
    const std::string exe = in->dir + "/" SYNTH_ID "-engine", roms = in->dir + "/roms";
    bool askLibrary = false, libraryIn = false;
    std::vector<Instance::Bank> lib;
    int got = 0;
    auto spawn = [&]() -> bool {
        int gain;
        {
            std::lock_guard<std::mutex> l(in->mu);
            gain = in->gain;
            askLibrary = in->banks.empty() && fam::BANKS > 0;
        }
        libraryIn = false;
        lib.assign(size_t(fam::BANKS), Instance::Bank());
        for (int b = 0; b < fam::BANKS; b++) {
            lib[size_t(b)].name = fam::BANK_NAME[b];
            lib[size_t(b)].sounds.resize(size_t(fam::SOUNDS));
        }
        got = 0;
        L->aux[ASK_LIBRARY] = askLibrary ? 1 : 0;
        L->aux[LIBRARY_DONE] = 0;
        L->aux[LIVE_VOICE] = -1; // nothing played yet (waldorf_emu.cpp, publish_live)
        L->aux[LIVE_AT] = 0;
#if defined(WALDORF_XT)
        in->memSeq = 0;
#endif
        const int err = in->host.spawn(exe, roms, 0, gain);
        if (err) {
            std::lock_guard<std::mutex> l(in->mu);
            snprintf(in->error, sizeof(in->error), "The emulator could not be started (%s: %s)", exe.c_str(), strerror(err));
            snprintf(in->status, sizeof(in->status), "Failed");
            return false;
        }
        plog("engine started (pid %d)", int(in->host.pid.load()));
        return true;
    };
    if (!spawn()) return;
    std::vector<int64_t> deaths;
    std::vector<uint8_t> e;
    while (!in->quit.load()) {
        char why[64];
        if (in->host.died(why, sizeof(why))) {
            if (in->quit.load()) break;
            if (L->phase.load() == eshm::FAILED) break; // it said why: no use starting it again
            const int64_t t = now_us();
            deaths.erase(std::remove_if(deaths.begin(), deaths.end(), [&](int64_t d) { return t - d > 60000000; }), deaths.end());
            deaths.push_back(t);
            if (int(deaths.size()) > RESTARTS) {
                plog("the engine stopped (%s), %d times in a minute: not starting it again", why, int(deaths.size()));
                std::lock_guard<std::mutex> l(in->mu);
                snprintf(in->error, sizeof(in->error), "The emulator stopped %d times in a minute (%s)", int(deaths.size()), why);
                snprintf(in->status, sizeof(in->status), "Failed");
                break;
            }
            plog("the engine stopped (%s): starting it again", why);
            if (!spawn()) break;
        }
        // what the synth sent: the sounds it was asked for, a wavetable's answers
        uint8_t kind;
        while (eshm::take(L->fromEngine, kind, e)) {
            int rb, rp;
            if (askLibrary && !libraryIn && single_dump(e, rb, rp)) {
                if (rb < fam::BANKS && rp < fam::SOUNDS && lib[size_t(rb)].sounds[size_t(rp)].empty()) {
                    lib[size_t(rb)].sounds[size_t(rp)].assign(e.begin() + 7, e.begin() + 7 + fam::DATA);
                    got++;
                }
                continue;
            }
#if defined(WALDORF_XT)
            take_wave_answer(in, e);
#endif
        }
        if (!libraryIn && L->aux[LIBRARY_DONE].load(std::memory_order_acquire)) {
            // the library is in: a sound a Set gave back, else the one asked
            // for, else the first, to the engine for its warm-up
            libraryIn = true;
            std::lock_guard<std::mutex> l(in->mu);
            if (askLibrary && got > 0) in->banks = std::move(lib);
            if (!in->haveSingle) load_sound(in, in->bank, in->preset);
            if (!in->haveSingle) load_sound(in, 0, 0);
            in->pendingLoad = false;
            send_single(in);
        }
#if defined(WALDORF_XT)
        if (in->host.playing()) {
            {
                std::lock_guard<std::mutex> l(in->mu);
                ask_waves(in);
            }
            read_computed_waves(in);
        }
#endif
        timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 2000000;
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec++;
            ts.tv_nsec -= 1000000000;
        }
        sem_timedwait(&in->runWake, &ts);
    }
}

// status and error: the waiting, the plugin's own (a failure to start the
// engine), else the engine's
void texts(Instance *in, char *st, size_t ns, char *err, size_t ne) {
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (in->waiting.load()) {
            snprintf(st, ns, "Waiting: another " SYNTH_NAME " is running, one at a time");
            snprintf(err, ne, "%s", "");
            return;
        }
        if (in->error[0] || !in->host.L || (!in->host.pid.load() && in->host.L->phase.load() != eshm::FAILED)) {
            snprintf(st, ns, "%s", in->status);
            snprintf(err, ne, "%s", in->error);
            return;
        }
    }
    eshm::get_text(in->host.L, st, ns, err, ne);
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
    // An option by its name first: Pung writes Live's values as the option's
    // name, and "24 dB LP" read as a number is 24, past the last option, so
    // the filter jumped to Comb- (2026-11-22). A number only where no name is.
    char *end = nullptr;
    long v = -1;
    if (p->list >= 0)
        for (int i = 0; i < tbl::kListLen[p->list]; i++)
            if (!strcasecmp(tbl::kLists[p->list][i], val)) v = i;
    if (v >= 0) {
        if (p->kind == tbl::kLabels) v += p->min - p->offset;
    } else {
        v = strtol(val, &end, 10);
        if (end == val) return; // neither a name nor a number
    }
    const int raw = raw_from(*p, int(v));
    uint8_t &b = in->single[size_t(p->byte)];
    if (p->mask) b = uint8_t((b & ~(p->mask << p->shift)) | ((raw & p->mask) << p->shift));
    else b = uint8_t(raw);
    if (in->host.playing()) send_byte(in, p->byte); // (else the dump the engine plays next carries it)
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
    if (json_field(val, "gain", s)) {
        in->gain = std::max(1, std::min(200, atoi(s.c_str())));
        if (in->host.L) in->host.L->gain = in->gain;
    }
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
        send_single(in);
    }
}

// ---- the plugin API -------------------------------------------------------------

void *v2_create(const char *module_dir, const char *) {
    Instance *in = new Instance();
    in->dir = module_dir ? module_dir : ".";
    sem_init(&in->runWake, 0, 0);
    if (!in->host.make("pung-" SYNTH_ID)) {
        snprintf(in->error, sizeof(in->error), "No memory for the emulator (%s)", strerror(errno));
        snprintf(in->status, sizeof(in->status), "Failed");
        return in;
    }
    in->run = std::thread(run_main, in);
    return in;
}

void v2_destroy(void *instance) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in) return;
    in->quit = true;
    sem_post(&in->runWake);
    if (in->run.joinable()) in->run.join(); // (it waits 2 ms at a time)
    if (in->host.end()) plog("engine stopped");
    if (in->hasLock) emu_unlock(); // the emulator is gone: the next instance may start
    in->host.free();
    sem_destroy(&in->runWake);
    delete in;
}

void v2_on_midi(void *instance, const uint8_t *msg, int len, int) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || len < 2 || !in->host.playing()) return;
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
    if (st == 0x90 && d2 > 0) in->held++;
    else if (st == 0x80 || st == 0x90 || (st == 0xb0 && (d1 == 120 || d1 == 123))) {
        if (st == 0xb0) in->held = 0;
        else if (in->held.load() > 0) in->held--;
        in->lastOff = now_us();
    }
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, st, d1, d2); // channel 1
    send(in, ev);
}

#if HAVE_PARAMS
// ---- the modulation matrix, for Pung's ASSIGN screen (src/assign.go) -----------
// Sixteen slots in the sound's bytes, each a source, a destination and an
// amount (64: none). A route on the screen is a slot: its source one of the
// synth's (ids "s<n>", n the source's number), its destination the knob the
// matrix destination moves; destinations with no knob of their own (the
// pitches: octave, semitone and detune together) stay off the screen.
struct ModFamily {
    int srcAt, amtAt, dstAt, srcList; // a slot's bytes (slot 1's; 3 a slot), the sources' list
    const char *const *dest;          // matrix destination -> knob ("": none)
    int ndest;
};
#if defined(WALDORF_XT)
const char *const kModDest[] = {"", "", "", "w1_start_w", "w2_start_w", "mix_w1", "mix_w2", "mix_ring_mod", "mix_noise", "f1_cutoff",
                                "f1_resonance", "f2_cutoff", "amp_volume", "pan", "f1_env_attack", "f1_env_decay", "f1_env_sustain",
                                "f1_env_release", "amp_env_attack", "amp_env_decay", "amp_env_sustain", "amp_env_release", "", "", "", "",
                                "lfo1_rate", "", "lfo2_rate", "", "", "", "", "", "o1_fm_amount", "f1_extra"};
const ModFamily kMod = {192, 193, 194, 25, kModDest, int(sizeof(kModDest) / sizeof(kModDest[0]))};
#else
const char *const kModDest[] = {"", "", "o1_fm_amount", "o1_pulse_width", "", "o2_fm_amount", "o2_pulse_width", "", "o3_fm_amount",
                                "o3_pulse_width", "o1_level", "o1_balance", "o2_level", "o2_balance", "o3_level", "o3_balance",
                                "ring_mod_level", "ring_mod_balance", "noise_level", "noise_balance", "f1_cutoff", "f1_resonance",
                                "f1_fm_amount", "f1_drive", "f1_pan", "f2_cutoff", "f2_resonance", "f2_fm_amount", "f2_drive", "f2_pan",
                                "amp_volume", "lfo1_speed", "lfo2_speed", "lfo3_speed", "filter_env_attack", "filter_env_decay",
                                "filter_env_sustain", "filter_env_release", "amp_env_attack", "amp_env_decay", "amp_env_sustain",
                                "amp_env_release", "env3_attack", "env3_decay", "env3_sustain", "env3_release", "env4_attack", "env4_decay",
                                "env4_sustain", "env4_release", "slot1_famount", "slot2_famount", "slot1_samount", "slot2_samount",
                                "o1_sub_freq_div", "o1_sub_volume", "o2_sub_freq_div", "o2_sub_volume"};
const ModFamily kMod = {285, 287, 286, 8, kModDest, int(sizeof(kModDest) / sizeof(kModDest[0]))};
#endif
const int kModSlots = 16;

// mu held: the modulation map (get_param("mod_map"))
int mod_map(Instance *in, char *buf, int len) {
    int off = 0;
    auto ap = [&](const char *fmt, ...) {
        if (off >= len) return;
        va_list a;
        va_start(a, fmt);
        off += vsnprintf(buf + off, size_t(len - off), fmt, a);
        va_end(a);
    };
    ap("{\"sources\":[");
    for (int i = 1; i < tbl::kListLen[kMod.srcList]; i++) ap("%s{\"id\":\"s%d\",\"name\":\"%s\"}", i > 1 ? "," : "", i, tbl::kLists[kMod.srcList][i]);
    ap("],\"dests\":[");
    bool first = true;
    for (int d = 0; d < kMod.ndest; d++)
        if (kMod.dest[d][0] && find_param(kMod.dest[d])) {
            ap("%s\"%s\"", first ? "" : ",", kMod.dest[d]);
            first = false;
        }
    ap("],\"routes\":[");
    first = true;
    for (int k = 0; in->haveSingle && k < kModSlots; k++) {
        const int src = in->single[size_t(kMod.srcAt + 3 * k)], dst = in->single[size_t(kMod.dstAt + 3 * k)], amt = in->single[size_t(kMod.amtAt + 3 * k)];
        if (src <= 0 || amt == 64 || dst >= kMod.ndest || !kMod.dest[dst][0]) continue;
        ap("%s{\"src\":\"s%d\",\"dst\":\"%s\",\"amount\":%.4f}", first ? "" : ",", src, kMod.dest[dst], (amt - 64) / 64.0);
        first = false;
    }
    ap("]}");
    return off; // past len: Pung asks again with room for it all
}

// mu held: a route from the ASSIGN screen (set_param("mod_set")): the slot
// that has it changed, a free slot (source Off) taken for a new one, a slot
// freed at 0. Each byte goes to the synth as a knob's does.
void mod_set(Instance *in, const char *val) {
    if (!in->haveSingle) return;
    const std::string v(val);
    auto str = [&](const char *k) {
        const std::string pat = std::string("\"") + k + "\":\"";
        const size_t p = v.find(pat);
        if (p == std::string::npos) return std::string();
        const size_t e = v.find('"', p + pat.size());
        return v.substr(p + pat.size(), e == std::string::npos ? std::string::npos : e - p - pat.size());
    };
    const std::string src = str("src"), dst = str("dst");
    const size_t ap = v.find("\"amount\":");
    const double a = ap == std::string::npos ? 0 : atof(v.c_str() + ap + 9);
    const int si = src.size() > 1 && src[0] == 's' ? atoi(src.c_str() + 1) : -1;
    int di = -1;
    for (int d = 0; d < kMod.ndest; d++)
        if (kMod.dest[d][0] && dst == kMod.dest[d]) di = d;
    if (si < 1 || si >= tbl::kListLen[kMod.srcList] || di < 0) return;
    // the byte the depth makes: one that rounds to 64 is no route at all
    const int amt = int(std::max(0L, std::min(127L, std::lround(64 + a * 64))));
    int slot = -1, freeSlot = -1;
    for (int k = 0; k < kModSlots; k++) {
        const int s_ = in->single[size_t(kMod.srcAt + 3 * k)], d_ = in->single[size_t(kMod.dstAt + 3 * k)];
        const int a_ = in->single[size_t(kMod.amtAt + 3 * k)];
        if (s_ == si && d_ == di && slot < 0) slot = k;
        if ((s_ == 0 || a_ == 64) && freeSlot < 0 && !(s_ == si && d_ == di)) freeSlot = k; // free: no source, or driving nothing
    }
    auto put = [&](int at, int b) {
        in->single[size_t(at)] = uint8_t(b);
        send_byte(in, at);
    };
    if (amt == 64) {
        if (slot >= 0) put(kMod.srcAt + 3 * slot, 0), put(kMod.amtAt + 3 * slot, 64);
        return;
    }
    if (slot < 0) {
        if (freeSlot < 0) {
            plog("no free modulation slot for %s", dst.c_str());
            return;
        }
        slot = freeSlot;
        put(kMod.dstAt + 3 * slot, di);
        put(kMod.srcAt + 3 * slot, si);
    }
    put(kMod.amtAt + 3 * slot, amt);
}
#endif

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
        if (in->host.L) in->host.L->gain = in->gain;
#if HAVE_PARAMS
    } else if (!strcmp(key, "mod_set")) {
        mod_set(in, val); // a route from Pung's ASSIGN screen
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

#if defined(WALDORF_XT)
// The filter cutoff word of a voice (Y:0xEC + 14 v, waldorf_emu.cpp) at each
// position of the cutoff knob, one note, nothing modulating: measured with
// native/xenia/tools/xt_scan.cpp (2026-11-24). A semitone a step to about 90,
// closer together above. xt_cutoff reads a word back as the knob would stand.
const uint32_t XT_CUT[128] = {
    14440, 15298, 16208, 17172, 18193, 19275, 20421, 21636,
    22922, 24285, 25729, 27259, 28880, 30597, 32417, 34345,
    36387, 38550, 40843, 43272, 45844, 48571, 51459, 54519,
    57761, 61195, 64834, 68690, 72774, 77102, 81687, 86544,
    91690, 97142, 102918, 109038, 115522, 122391, 129668, 137379,
    145548, 154203, 163372, 173086, 183378, 194281, 205833, 218072,
    231039, 244777, 259330, 274750, 291086, 308393, 326729, 346155,
    366735, 388538, 411637, 436109, 462036, 489502, 518600, 549427,
    582085, 616683, 653334, 692163, 733295, 776869, 823027, 871924,
    923721, 978588, 1036706, 1098265, 1163469, 1232532, 1305678, 1383146,
    1465188, 1552071, 1644073, 1741492, 1844638, 1953842, 2069447, 2191817,
    2321335, 2458400, 2603432, 2756870, 2919174, 3090821, 3272310, 3464157,
    3666896, 3881076, 4107265, 4346040, 4597984, 4863690, 5143748, 5438739,
    5749230, 6075763, 6418840, 6778911, 7156357, 7551462, 7964395, 8395174,
    8843632, 9309373, 9791720, 10289661, 10801770, 11326139, 11860281, 12401019,
    12944381, 13485456, 14018253, 14535533, 15028647, 15487347, 15899609, 16231633,};
double xt_cutoff(uint32_t w) {
    if (w <= XT_CUT[0]) return 12.0 * std::log2(double(std::max<uint32_t>(w, 1)) / XT_CUT[0]);
    if (w >= XT_CUT[127]) return 127.0;
    int k = 0;
    while (k < 126 && XT_CUT[k + 1] <= w) k++;
    return k + std::log(double(w) / XT_CUT[k]) / std::log(double(XT_CUT[k + 1]) / XT_CUT[k]);
}
// Where the sound has the cutoff and the two waves now, while it sounds (a
// note held, or let go in the last 3 s): {} at rest. Lock-free (Pung asks
// every frame).
int live_mod(Instance *in, char *buf, int len) {
    eshm::Layout *L = in->host.L;
    const int64_t now = now_us();
    const bool sounding = in->held.load() > 0 || now - in->lastOff.load() < 3000000;
    if (!L || !sounding || L->aux[LIVE_VOICE].load() < 0 || int32_t(uint32_t(now / 1000) - uint32_t(L->aux[LIVE_AT].load(std::memory_order_acquire))) > 500)
        return snprintf(buf, size_t(len), "{}");
    auto wave = [](int32_t p) { return std::max(0.0, std::min(63.0, (double(p) - 0x24000) / 256.0)); };
    return snprintf(buf, size_t(len), "{\"f1_cutoff\":%.2f,\"w1_start_w\":%.2f,\"w2_start_w\":%.2f}",
                    std::max(0.0, xt_cutoff(uint32_t(L->aux[LIVE_CUT].load()))), wave(L->aux[LIVE_W1].load()), wave(L->aux[LIVE_W2].load()));
}
#endif

int v2_get_param(void *instance, const char *key, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !buf || len <= 0) return -1;
    if (!strcmp(key, "debug_info")) {
        eshm::Layout *L = in->host.L;
        if (!L) return snprintf(buf, size_t(len), "underruns=%u", in->underruns.load());
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u engine_pid=%d", in->underruns.load(),
                        L->blockUs.load(), L->blockMaxUs.exchange(0), L->wr.load() - L->rd.load(), int(in->host.pid.load()));
    }
#if defined(WALDORF_XT)
    if (!strcmp(key, "live_mod")) return live_mod(in, buf, len);
#endif
    if (!strcmp(key, "status") || !strcmp(key, "load_error")) {
        char st[160], err[200];
        texts(in, st, sizeof(st), err, sizeof(err));
        return snprintf(buf, size_t(len), "%s", !strcmp(key, "status") ? st : err);
    }
    std::lock_guard<std::mutex> l(in->mu);
#if HAVE_PARAMS
    if (!strcmp(key, "mod_map")) return mod_map(in, buf, len);
#endif
    const int nb = int(in->banks.size()), ns = bank_size(in);
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
    char st[160], err[200];
    texts(in, st, sizeof(st), err, sizeof(err));
    if (!err[0]) {
        buf[0] = 0;
        return 0;
    }
    return snprintf(buf, size_t(len), "%s", err);
}

void v2_render(void *instance, int16_t *out, int frames) {
    Instance *in = static_cast<Instance *>(instance);
    if (!out || frames <= 0) return;
    if (!in || !in->host.playing()) {
        memset(out, 0, size_t(frames) * 2 * sizeof(int16_t));
        return;
    }
    eshm::Layout *L = in->host.L;
    const uint32_t r = L->rd.load(std::memory_order_relaxed);
    const uint32_t have = L->wr.load(std::memory_order_acquire) - r;
    const uint32_t n = std::min<uint32_t>(have, uint32_t(frames));
    for (uint32_t i = 0; i < n; i++) {
        const uint32_t k = (r + i) & (RING - 1);
        out[i * 2] = L->ring[k * 2];
        out[i * 2 + 1] = L->ring[k * 2 + 1];
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
        L->missAt.store(now_us(), std::memory_order_relaxed);
    }
    L->rd.store(r + n, std::memory_order_release);
    sem_post(&L->wake);
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
