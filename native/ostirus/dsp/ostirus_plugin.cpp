// OsTIrus for Pung: the Access Virus TI as gearmulator emulates it
// (virusLib), behind the chain host's plugin API. A Pung-native module: the
// emulation needs a Push's processor (a Move runs the older Virus B and C at
// half their clock).
//
// Processes. The emulator runs in a process of its own, ostirus-engine
// (ostirus_engine.cpp), and renders into a ring in memory both share
// (ostirus_shm.h); render_block only reads the ring. A hung or crashed
// emulator then never holds Pung: a stop kills the engine, and an engine that
// dies is started again. This plugin keeps the sound and talks to the engine
// through a queue of MIDI and sound dumps.
//
// Sounds. The firmware carries the factory banks: every ROM bank is a bank
// here, its names read from the firmware without loading a sound. A sound is
// loaded as the synth's own single dump into the edit buffer, and that dump
// is the device's state.
//
// Wavetables. The engine reads the firmware's 100 wavetables from the DSP's
// memory after boot, into the shared memory, and the screens draw the table
// an oscillator plays from them (wave_view_1, wave_view_2).
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
#include <new>
#include <string>
#include <thread>
#include <vector>

#include <dirent.h>
#include <fcntl.h>
#include <pthread.h>
#include <semaphore.h>
#include <signal.h>
#include <spawn.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "synthLib/midiTypes.h"
#include "virusLib/deviceModel.h"
#include "virusLib/microcontroller.h"
#include "virusLib/microcontrollerTypes.h"
#include "virusLib/romfile.h"

#include "ostirus_shm.h"
#include "ti_params.h"

extern char **environ;
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

const int RING = oshm::RING; // stereo frames, a power of two (the engine renders; ostirus_engine.cpp)
// An engine that dies is started again, this many times a minute at most
const int RESTARTS = 3;
// A block that ends short fades out over its last frames, and the one after
// it fades in: the gap is a dip, not a click.
const uint32_t FADE = 32;

typedef virusLib::ROMFile::TPreset Preset;

// A wavetable as the TI's firmware keeps it: each of its waves a spectrum,
// one byte a harmonic (h1 first), the harmonic's amplitude (byte/127)^2,
// its phase that of a sine, odd harmonics inverted. The DSP builds the waves
// it plays from these when a voice first needs the table, and moves through
// them by the oscillator's Index, the wave at Index i the crossfade of the
// two around i * (waves - 1) / 127. (Measured 2026-11-22: these sums are the
// waves the DSP builds, sample for sample, for 15 tables, and notes rendered
// at Index 32, 64, 96 are those crossfades.)
struct Wavetable {
    int nh = 0, nw = 0;       // harmonics a wave, waves; nw 0 for the sine (table 0, computed by the DSP)
    std::vector<uint8_t> amp; // nw * nh bytes
    std::string view;         // wave_view, made when first asked for
};

struct Instance {
    std::string dir;
    std::thread starter; // finds the firmware, takes the lock, starts and watches the engine
    std::atomic<bool> quit{false};
    // One emulator at a time, as Nodal Red 2X: its threads run at realtime
    // priority, and two of them leave a Push nothing. An instance that finds
    // the emulator taken waits for it, silent, and says so.
    std::atomic<int> waiting{0};
    bool hasLock = false; // holds the one-at-a-time lock (emu_try_lock)

    // the engine: its process, and the memory shared with it
    oshm::Layout *L = nullptr;
    int memfd = -1;
    std::atomic<pid_t> pid{0};
    std::mutex qMu;       // the queue's writer side (on_midi and set_param come from different threads)
    std::atomic<uint32_t> underruns{0};
    bool hole = false;    // render_block's: the block before ended short

    // the sound and the library, under mu
    std::mutex mu;
    int model = 0; // index into o_model
    int gain = 100; // percent
    std::unique_ptr<virusLib::ROMFile> rom; // the firmware, for its banks and names
    std::vector<std::vector<std::string>> names; // [bank][sound]
    int bank = 0, preset = 0;
    Preset single{};     // the sound in the edit buffer, as loaded
    bool haveSingle = false;
    bool pendingLoad = false; // a sound waits for the firmware to be read
    std::string romName;
    char status[160] = "Starting"; // the plugin's own (the engine's is in L)
    char error[200] = "";

    // The firmware's wavetables, as the engine read them, and each one's
    // view for the screens once asked for: under tabMu.
    std::mutex tabMu;
    std::vector<Wavetable> tables; // [100] once read; empty: not read, or not found
    bool tablesRead = false;       // tried (empty tables then: this firmware's were not found)
};

// playing: the engine runs and has warmed up
inline bool playing(const Instance *in) { return in->L && in->L->phase.load(std::memory_order_acquire) == oshm::RUNNING; }

void set_status(Instance *in, const char *s) {
    std::lock_guard<std::mutex> l(in->mu);
    snprintf(in->status, sizeof(in->status), "%s", s);
}

// An event to the engine (dropped while it boots: the sound goes as a dump).
void send(Instance *in, synthLib::SMidiEvent &ev, uint8_t kind = oshm::EVENT) {
    if (!in->L) return;
    std::lock_guard<std::mutex> l(in->qMu);
    if (!ev.sysex.empty()) {
        oshm::put(in->L, kind, ev.sysex.data(), ev.sysex.size());
    } else {
        const uint8_t b[3] = {ev.a, ev.b, ev.c};
        oshm::put(in->L, kind, b, 3);
    }
}

// The firmware holds the factory banks of all three synths, the TI's first,
// then the TI2's, then the Snow's; every model plays every one of them.
// Named as gearmulator's own OsTIrus names them.
std::string bank_name(int i) {
    const int ti = int(virusLib::ROMFile::getRomBankCount(virusLib::DeviceModel::TI));
    const int ti2 = int(virusLib::ROMFile::getRomBankCount(virusLib::DeviceModel::TI2));
    char b[24];
    if (i < ti) snprintf(b, sizeof(b), "TI Rom %c", 'A' + i);
    else if (i < ti + ti2) snprintf(b, sizeof(b), "TI2 Rom %c", 'A' + (i - ti));
    else snprintf(b, sizeof(b), "Snow Rom %c", 'A' + (i - ti - ti2));
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

// ---- wavetables ---------------------------------------------------------------------

const ti::Param *find_param(const char *key);

const int TABLES = 100;   // the TI's wavetables (gearmulator's wavetablesNames)
const int VIEW_POINTS = 64; // a wave in wave_view: points a cycle

// tabMu held. The engine's wavetables, once it has read them (ostirus_engine.cpp,
// read_tables): per table 1..99 its harmonics, its waves and their bytes.
void take_tables(Instance *in) {
    if (in->tablesRead || !in->L) return;
    const int state = in->L->tables.load(std::memory_order_acquire);
    if (state == 0) return;
    std::vector<Wavetable> tabs;
    if (state == 1) {
        tabs.resize(TABLES);
        size_t at = 0;
        for (int t = 1; t < TABLES; t++) {
            const uint8_t *o = in->L->tab + at;
            Wavetable &w = tabs[size_t(t)];
            w.nh = o[0] | o[1] << 8;
            w.nw = o[2] | o[3] << 8;
            const size_t bytes = size_t(w.nh * w.nw);
            if (at + 4 + bytes > size_t(oshm::TABDATA)) {
                tabs.clear();
                break;
            }
            w.amp.assign(o + 4, o + 4 + bytes);
            at += 4 + bytes;
        }
    }
    in->tables = std::move(tabs);
    in->tablesRead = true;
}

// tabMu held. A table's waves for the screens: "<waves>:" and then each wave
// as VIEW_POINTS points of one cycle, two hex digits a point (128 + the
// value, the table's loudest point 127). The sine has one wave.
const std::string &table_view(Wavetable &w) {
    if (!w.view.empty()) return w.view;
    static float sn[VIEW_POINTS];
    if (sn[1] == 0)
        for (int i = 0; i < VIEW_POINTS; i++) sn[i] = float(std::sin(2.0 * M_PI * i / VIEW_POINTS));
    const int nw = w.nw ? w.nw : 1;
    std::vector<float> x(size_t(nw * VIEW_POINTS), 0.f);
    float peak = 0;
    for (int k = 0; k < nw; k++)
        for (int i = 0; i < VIEW_POINTS; i++) {
            float v = 0;
            if (!w.nw) v = -sn[i];
            else
                for (int h = 1; h <= w.nh; h++) {
                    const float a = float(w.amp[size_t(k * w.nh + h - 1)]) / 127.f;
                    if (a > 0) v += (h & 1 ? -a * a : a * a) * sn[(h * i) % VIEW_POINTS];
                }
            x[size_t(k * VIEW_POINTS + i)] = v;
            peak = std::max(peak, std::fabs(v));
        }
    char b[16];
    snprintf(b, sizeof(b), "%d:", nw);
    w.view = b;
    w.view.reserve(w.view.size() + x.size() * 2);
    for (float v : x) {
        const int q = 128 + int(lrintf(peak > 0 ? v / peak * 127.f : 0.f));
        snprintf(b, sizeof(b), "%02x", std::max(1, std::min(255, q)));
        w.view += b;
    }
    return w.view;
}

// wave_view_<osc>: the table oscillator 1 or 2 plays, while it plays one
// (Wavetable, Wave PWM). "" while there is nothing to draw (the oscillator
// in another model, the emulator still booting), "none" when the firmware's
// tables were not found: the screen says so and draws no wave.
std::string wave_view(Instance *in, int osc) {
    static const ti::Param *mode[2] = {find_param("osc1_mode"), find_param("osc2_mode")};
    static const ti::Param *table[2] = {find_param("osc1_wave_select"), find_param("osc2_wave_select")};
    if (osc < 1 || osc > 2 || !mode[osc - 1] || !table[osc - 1]) return "";
    int m, t;
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (!in->haveSingle) return "";
        m = in->single[size_t(mode[osc - 1]->off)];
        t = in->single[size_t(table[osc - 1]->off)];
    }
    if (m != 2 && m != 3) return ""; // Wavetable, Wave PWM
    std::lock_guard<std::mutex> l(in->tabMu);
    take_tables(in);
    if (!in->tablesRead) return "";
    if (in->tables.empty() || t >= int(in->tables.size())) return "none";
    return table_view(in->tables[size_t(t)]);
}

// mu held. The sound in the edit buffer goes to the synth, as its own dump.
void send_single(Instance *in) {
    if (!in->haveSingle || !in->rom) return;
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex = virusLib::Microcontroller::createSingleDump(*in->rom, virusLib::BankNumber::EditBuffer, virusLib::SINGLE, in->single, virusLib::OMNI_DEVICE_ID);
    send(in, ev, oshm::DUMP); // the engine sends it when the ring is deep enough, and again after a warm-up
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
    send_single(in);
    return true;
}

#define EMU_LOCK_PATH "/dev/shm/pung-ostirus.lock"
#define EMU_LOCK_PATH_TMP "/tmp/pung-ostirus.lock"

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

// A memory file for the engine, made once an instance: the engine's process
// may come and go (a model switch, an engine that died), the memory stays.
bool make_memory(Instance *in) {
    in->memfd = memfd_create("pung-ostirus", MFD_CLOEXEC);
    if (in->memfd < 0 || ftruncate(in->memfd, sizeof(oshm::Layout)) != 0) return false;
    void *m = mmap(nullptr, sizeof(oshm::Layout), PROT_READ | PROT_WRITE, MAP_SHARED, in->memfd, 0);
    if (m == MAP_FAILED) return false;
    in->L = new (m) oshm::Layout(); // (zeroed by ftruncate; the atomics constructed)
    in->L->magic = oshm::MAGIC;
    in->L->version = oshm::VERSION;
    sem_init(&in->L->wake, 1, 0);
    return true;
}

// The engine started for the model, with the firmware at romPath.
bool spawn(Instance *in, const std::string &romPath) {
    oshm::Layout *L = in->L;
    {
        std::lock_guard<std::mutex> q(in->qMu);
        L->qw = 0;
        L->qr = 0;
    }
    L->quit = 0;
    L->phase = oshm::STARTING;
    L->wr = 0;
    L->rd = 0;
    L->missAt = 0;
    L->tables = 0;
    L->blockMaxUs = 0;
    oshm::set_text(L, "Starting", "");
    {
        std::lock_guard<std::mutex> l(in->mu);
        L->model = in->model;
        L->gain = in->gain;
        snprintf(L->romPath, sizeof(L->romPath), "%s", romPath.c_str());
    }
    {
        std::lock_guard<std::mutex> l(in->tabMu);
        in->tables.clear();
        in->tablesRead = false;
    }
    const std::string exe = in->dir + "/ostirus-engine";
    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    posix_spawn_file_actions_adddup2(&fa, in->memfd, 3); // (dup2 leaves the copy open across exec)
    char a0[] = "ostirus-engine", a1[] = "--shm-fd=3";
    char *argv[] = {a0, a1, nullptr};
    pid_t pid = 0;
    const int err = posix_spawn(&pid, exe.c_str(), &fa, nullptr, argv, environ);
    posix_spawn_file_actions_destroy(&fa);
    if (err != 0) {
        std::lock_guard<std::mutex> l(in->mu);
        snprintf(in->error, sizeof(in->error), "The emulator could not be started (%s: %s)", exe.c_str(), strerror(err));
        snprintf(in->status, sizeof(in->status), "Failed");
        return false;
    }
    in->pid = pid;
    {
        std::lock_guard<std::mutex> l(in->mu);
        send_single(in); // the sound first: the engine plays it in its warm-up
    }
    plog("engine started (pid %d)", int(pid));
    return true;
}

// The engine ended: asked first, then killed. Never waits long.
void end_engine(Instance *in) {
    const pid_t pid = in->pid.exchange(0);
    if (!pid) return;
    if (in->L) {
        in->L->quit = 1;
        sem_post(&in->L->wake);
    }
    for (int i = 0; i < 100; i++) { // up to 1 s
        if (waitpid(pid, nullptr, WNOHANG) == pid) return;
        usleep(10000);
    }
    kill(pid, SIGKILL);
    waitpid(pid, nullptr, 0); // (a killed process is gone at once)
    plog("engine killed (pid %d): it did not stop when asked", int(pid));
}

void start_main(Instance *in) {
    pthread_setname_np(pthread_self(), "ostirus-start");
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
        return;
    }
    // (a model switch keeps the lock it had: a waiting OsTIrus must not take
    // the emulator in the moment between the two models)
    while (!in->hasLock && !(in->hasLock = emu_try_lock())) {
        if (!in->waiting.exchange(1)) plog("another instance has the emulator; waiting for it");
        if (in->quit.load()) return;
        usleep(300000);
    }
    in->waiting = 0;
    if (in->quit.load()) return;
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
    }
    const std::string romPath = in->dir + "/roms/" + romName;
    if (!spawn(in, romPath)) return;
    // watching it: an engine that dies is started again, RESTARTS times a minute at most
    std::vector<int64_t> deaths;
    while (!in->quit.load()) {
        usleep(100000);
        const pid_t pid = in->pid.load();
        int wst = 0;
        if (!pid || waitpid(pid, &wst, WNOHANG) != pid) continue;
        in->pid = 0;
        if (in->quit.load()) break;
        const int64_t t = now_us();
        deaths.erase(std::remove_if(deaths.begin(), deaths.end(), [&](int64_t d) { return t - d > 60000000; }), deaths.end());
        deaths.push_back(t);
        char why[64];
        if (WIFSIGNALED(wst)) snprintf(why, sizeof(why), "signal %d", WTERMSIG(wst));
        else snprintf(why, sizeof(why), "exit %d", WEXITSTATUS(wst));
        if (in->L->phase.load() == oshm::FAILED) break; // it said why (in L): no use starting it again
        if (int(deaths.size()) > RESTARTS) {
            plog("the engine stopped (%s), %d times in a minute: not starting it again", why, int(deaths.size()));
            std::lock_guard<std::mutex> l(in->mu);
            snprintf(in->error, sizeof(in->error), "The emulator stopped %d times in a minute (%s)", int(deaths.size()), why);
            snprintf(in->status, sizeof(in->status), "Failed");
            in->L->phase = oshm::FAILED;
            break;
        }
        plog("the engine stopped (%s): starting it again", why);
        if (!spawn(in, romPath)) break;
    }
}

void start(Instance *in) {
    in->quit = false;
    {
        std::lock_guard<std::mutex> l(in->mu);
        in->error[0] = 0;
        snprintf(in->status, sizeof(in->status), "Starting");
    }
    if (in->L) in->L->phase = oshm::STARTING;
    in->starter = std::thread(start_main, in);
}

void stop(Instance *in, bool keepLock = false) {
    in->quit = true;
    if (in->starter.joinable()) in->starter.join(); // (it waits 0.1 s at a time, or reads a firmware)
    end_engine(in);
    if (in->hasLock && !keepLock) {
        emu_unlock(); // the emulator is gone: the next instance may start
        in->hasLock = false;
    }
}

// status and error: the plugin's own while the engine is not up, else the engine's
void texts(Instance *in, char *st, size_t ns, char *err, size_t ne) {
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (in->waiting.load()) {
            snprintf(st, ns, "Waiting: another OsTIrus is running, and one is all a Push can run");
            snprintf(err, ne, "%s", "");
            return;
        }
        if (in->error[0] || !in->L || !in->pid.load()) {
            snprintf(st, ns, "%s", in->status);
            snprintf(err, ne, "%s", in->error);
            if (!in->L || in->error[0]) return;
            if (in->L->phase.load() != oshm::FAILED) return;
        }
    }
    oshm::get_text(in->L, st, ns, err, ne);
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
    // An option by its name first (Pung writes Live's values as the option's
    // name; a name that starts with a digit read as a number was another
    // value, 2026-11-22 on Vavra). A number only where no name is.
    char *end = nullptr;
    long v = -1;
    if (p.kind == ti::kEnum && p.list >= 0)
        for (int i = 0; i < ti::kListLen[p.list]; i++)
            if (!strcasecmp(ti::kLists[p.list][i], val)) v = i;
    if (v < 0) {
        v = strtol(val, &end, 10);
        if (end == val) return; // neither a name nor a number
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
    if (playing(in)) send_byte(in, p.off); // (else the dump the engine plays next carries it)
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
    if (!make_memory(in)) {
        snprintf(in->error, sizeof(in->error), "No memory for the emulator (%s)", strerror(errno));
        snprintf(in->status, sizeof(in->status), "Failed");
        return in;
    }
    start(in);
    return in;
}

void v2_destroy(void *instance) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in) return;
    stop(in);
    if (in->L) {
        sem_destroy(&in->L->wake);
        munmap(in->L, sizeof(oshm::Layout));
    }
    if (in->memfd >= 0) close(in->memfd);
    delete in;
}

void v2_on_midi(void *instance, const uint8_t *msg, int len, int) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || len < 2 || !playing(in)) return;
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
    if (json_field(val, "gain", s)) {
        in->gain = std::max(1, std::min(200, atoi(s.c_str())));
        if (in->L) in->L->gain = in->gain;
    }
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
        if (in->rom) send_single(in);
        else in->pendingLoad = true; // (the firmware not read yet: the start sends it)
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
            // the sound stays, edits and all: every model reads the same
            // firmware's banks, and the sound is what a player switches the
            // model to hear on another Virus (the boot sends it again)
            in->rom.reset();
            in->names.clear();
            in->error[0] = 0;
        }
        stop(in, true); // the engine starts again as the other model, still this instance's
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
        if (in->L) in->L->gain = in->gain;
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
    if (!strcmp(key, "debug_info")) {
        if (!in->L) return snprintf(buf, size_t(len), "underruns=%u", in->underruns.load());
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u engine_pid=%d", in->underruns.load(),
                        in->L->blockUs.load(), in->L->blockMaxUs.exchange(0), in->L->wr.load() - in->L->rd.load(), int(in->pid.load()));
    }
    if (!strcmp(key, "status") || !strcmp(key, "load_error")) {
        char st[160], err[200];
        texts(in, st, sizeof(st), err, sizeof(err));
        return snprintf(buf, size_t(len), "%s", !strcmp(key, "status") ? st : err);
    }
    if (!strncmp(key, "wave_view_", 10)) return snprintf(buf, size_t(len), "%s", wave_view(in, atoi(key + 10)).c_str());
    std::lock_guard<std::mutex> l(in->mu);
    const int nb = int(in->names.size());
    const std::vector<std::string> empty;
    const auto &b = in->bank >= 0 && in->bank < nb ? in->names[size_t(in->bank)] : empty;
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
            if (p.short_[0]) AP(",\"short\":\"%s\"", jesc(p.short_).c_str());
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
    if (!in || !playing(in)) {
        memset(out, 0, size_t(frames) * 2 * sizeof(int16_t));
        return;
    }
    oshm::Layout *L = in->L;
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
