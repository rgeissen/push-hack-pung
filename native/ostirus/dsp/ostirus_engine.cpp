// ostirus-engine: OsTIrus's emulator, in a process of its own.
//
// The plugin (dsp.so, inside Pung) starts it with the shared memory
// (ostirus_shm.h) as file descriptor 3, after it has found the firmware and
// taken the one-at-a-time lock. The engine boots the Virus, reads the
// firmware's wavetables from the DSP's memory, plays the warm-up chord, and
// then renders into the ring as long as the plugin wants it. It dies with
// the process that started it (PR_SET_PDEATHSIG), and a stop is the plugin
// setting quit, or a kill: nothing the engine does can hold Pung.
//
// The render loop is the emulator thread the plugin had before (2026-11-20 to
// 11-23): the ring AHEAD frames ahead, AHEAD_DUMP before and after a sound
// dump and after an underrun, 6 dB of headroom and a soft limiter.

#include <algorithm>
#include <cerrno>
#include <cstdarg>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "dsp56kEmu/memory.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"
#include "virusLib/device.h"
#include "virusLib/deviceModel.h"
#include "virusLib/dspSingle.h"

#include "ostirus_shm.h"

namespace {

const int BLOCK = 64;        // frames the emulator renders at a time
const int AHEAD = 320;       // frames kept ready for the host (7 ms)
const int AHEAD_DUMP = 1280; // 29 ms, around a sound dump (the emulator stalls taking one)
const int64_t MISS_DEEP_US = 3000000;

const char *o_model[] = {"TI", "TI2", "Snow"};
const virusLib::DeviceModel k_model[] = {virusLib::DeviceModel::TI, virusLib::DeviceModel::TI2, virusLib::DeviceModel::Snow};

oshm::Layout *L = nullptr;

void plog(const char *fmt, ...) {
    char b[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof(b), fmt, ap);
    va_end(ap);
    fprintf(stderr, "ostirus-engine: %s\n", b);
}

int64_t now_us() {
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return int64_t(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

bool read_file(const char *p, std::vector<uint8_t> &out) {
    FILE *f = fopen(p, "rb");
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

inline float soft_limit(float v) {
    const float knee = 24576.f, room = 32767.f - knee;
    const float a = v < 0 ? -v : v;
    if (a <= knee) return v;
    const float o = knee + room * std::tanh((a - knee) / room);
    return v < 0 ? -o : o;
}

void fail(const char *status, const char *error) {
    oshm::set_text(L, status, error);
    L->phase.store(oshm::FAILED, std::memory_order_release);
    plog("%s", error);
}

// The firmware's wavetables from the DSP's memory, into the shared memory:
// a directory of 100 entries (two words each), table 0 the sine (computed),
// table 1 right after the directory, each table then the one before plus its
// size: a header (log2 of harmonics a wave, waves, a flag, a gain) and the
// bytes, three a word, high byte first. Found by that shape, not by an
// address: a firmware without it leaves the tables empty, and the screens
// say so instead of drawing a wave.
void read_tables(virusLib::Device &dev) {
    const virusLib::DspSingle *dsp = dev.getDspA();
    size_t at_tab = 0;
    bool found = false;
    if (dsp) {
        const dsp56k::Memory &m = dsp->getMemory();
        const dsp56k::TWord n = m.size(dsp56k::MemArea_X);
        auto at = [&](dsp56k::TWord a) -> uint32_t { return a < n ? (m.get(dsp56k::MemArea_X, a) & 0xffffff) : 0xffffffffu; };
        auto size = [&](dsp56k::TWord p, int &nh, int &nw) -> uint32_t {
            const uint32_t lg = at(p), w = at(p + 1);
            if (lg < 3 || lg > 9 || w < 1 || w > 127) return 0;
            nh = 1 << lg;
            nw = int(w);
            return 4 + (uint32_t(nh * nw) + 2) / 3;
        };
        const int T = oshm::TABLES;
        for (dsp56k::TWord d = 0; d + 2 * T < n && !found; d++) {
            if (at(d) != 0 || at(d + 2) != d + 2 * T) continue;
            bool ok = true;
            for (int t = 1; t < T && ok; t++) {
                int nh, nw;
                const dsp56k::TWord p = at(d + 2 * dsp56k::TWord(t));
                const uint32_t sz = size(p, nh, nw);
                ok = sz && p + sz <= n && (t == T - 1 || at(d + 2 * dsp56k::TWord(t + 1)) == p + sz);
            }
            if (!ok) continue;
            found = true;
            for (int t = 1; t < T && found; t++) {
                int nh = 0, nw = 0;
                const dsp56k::TWord p = at(d + 2 * dsp56k::TWord(t));
                size(p, nh, nw);
                const size_t bytes = size_t(nh * nw);
                if (at_tab + 4 + bytes > size_t(oshm::TABDATA)) {
                    found = false; // (never: the TI's tables take well under a megabyte)
                    break;
                }
                uint8_t *o = L->tab + at_tab;
                o[0] = uint8_t(nh & 0xff), o[1] = uint8_t(nh >> 8), o[2] = uint8_t(nw & 0xff), o[3] = uint8_t(nw >> 8);
                for (size_t i = 0; i < bytes; i++) o[4 + i] = uint8_t(at(p + 4 + dsp56k::TWord(i / 3)) >> (16 - 8 * (i % 3)));
                at_tab += 4 + bytes;
            }
        }
    }
    plog("%s", found ? "wavetables read from the firmware" : "no wavetables found in the DSP's memory");
    L->tables.store(found ? 1 : 2, std::memory_order_release);
}

synthLib::SMidiEvent to_event(const std::vector<uint8_t> &b) {
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    if (!b.empty() && b[0] == 0xf0) {
        ev.sysex.assign(b.begin(), b.end());
    } else {
        ev.a = b.size() > 0 ? b[0] : 0;
        ev.b = b.size() > 1 ? b[1] : 0;
        ev.c = b.size() > 2 ? b[2] : 0;
    }
    return ev;
}

} // namespace

int main(int argc, char **argv) {
    // with the process that started it, never without
    prctl(PR_SET_PDEATHSIG, SIGKILL);
    const pid_t parent = getppid();
    if (parent == 1) return 1;
    int fd = 3;
    for (int i = 1; i < argc; i++)
        if (!strncmp(argv[i], "--shm-fd=", 9)) fd = atoi(argv[i] + 9);
    void *m = mmap(nullptr, sizeof(oshm::Layout), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (m == MAP_FAILED) {
        plog("no shared memory (fd %d): %s", fd, strerror(errno));
        return 1;
    }
    L = static_cast<oshm::Layout *>(m);
    if (L->magic != oshm::MAGIC || L->version != oshm::VERSION) {
        plog("shared memory of another version");
        return 1;
    }
    close(fd);
    pthread_setname_np(pthread_self(), "ostirus");
    // the emulator logs every hardware register it touches: not into Pung's log
    Logging::setLogFunc([](const std::string &) {});
    // Below the host's audio threads, above everything ordinary. The
    // emulator's own threads are made by this one and inherit it.
    sched_param sp{};
    sp.sched_priority = 45;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) plog("no realtime priority (%s)", strerror(errno));

    const int model = std::max(0, std::min(2, int(L->model)));
    char st[96];
    snprintf(st, sizeof(st), "Booting the Virus %s", o_model[model]);
    oshm::set_text(L, st, "");
    L->phase.store(oshm::BOOTING, std::memory_order_release);

    std::vector<uint8_t> rom;
    if (!read_file(L->romPath, rom)) {
        fail("Firmware missing", "The firmware could not be read");
        return 0;
    }
    const char *slash = strrchr(L->romPath, '/');
    std::unique_ptr<virusLib::Device> device;
    std::unique_ptr<synthLib::Plugin> plugin;
    try {
        synthLib::DeviceCreateParams p;
        p.romData = rom;
        p.romName = slash ? slash + 1 : L->romPath;
        p.hostSamplerate = 44100.0f;
        p.customData = uint32_t(k_model[model]);
        device.reset(new virusLib::Device(p));
        if (!device->isValid()) throw std::runtime_error("this firmware has no such model");
        plugin.reset(new synthLib::Plugin(device.get(), [](synthLib::Device *d) { return d; }));
        plugin->setHostSamplerate(44100.0f, 0.0f);
        plugin->setBlockSize(BLOCK);
        read_tables(*device);
    } catch (const std::exception &e) {
        char err[200];
        snprintf(err, sizeof(err), "The emulator did not start: %s", e.what());
        fail("Failed", err);
        return 0;
    }

    // the sound: the plugin's last dump, sent at the warm-up's start and again
    // when the engine plays (the sound first: the code a sound runs is the
    // code the DSP compiles during the warm-up)
    std::vector<uint8_t> sound, entry;
    bool dumpPending = false;
    auto drain = [&](bool playing) {
        uint8_t kind;
        while (oshm::take(L, kind, entry)) {
            if (kind == oshm::DUMP) {
                sound = entry;
                dumpPending = true;
            } else if (playing) {
                synthLib::SMidiEvent ev = to_event(entry);
                plugin->addMidiEvent(ev);
            }
        }
    };
    auto send_sound = [&] {
        if (sound.empty()) return;
        synthLib::SMidiEvent ev = to_event(sound);
        plugin->addMidiEvent(ev);
        dumpPending = false;
    };

    snprintf(st, sizeof(st), "Warming up the Virus %s", o_model[model]);
    oshm::set_text(L, st, nullptr);
    L->phase.store(oshm::WARMING, std::memory_order_release);
    // Warm-up, before the first note anyone hears: the DSP emulator compiles
    // the synth's code as it first runs it, and the first chords after a
    // start dropped out about fifty times while it did (2026-11-20).
    {
        float wb[12][BLOCK];
        synthLib::TAudioInputs wi{};
        synthLib::TAudioOutputs wo{};
        float z[BLOCK] = {0};
        for (size_t i = 0; i < wo.size() && i < 12; i++) wo[i] = wb[i];
        for (size_t i = 0; i < wi.size(); i++) wi[i] = z;
        std::vector<synthLib::SMidiEvent> sink;
        auto run = [&](int blocks) {
            for (int b = 0; b < blocks && !L->quit.load(std::memory_order_relaxed); b++) {
                plugin->process(wi, wo, BLOCK, 120.0f, 0.0f, false);
                sink.clear();
                plugin->getMidiOut(sink);
            }
        };
        // the plugin sends the sound right after starting the engine
        for (int i = 0; i < 100 && sound.empty() && !L->quit.load(); i++) {
            drain(false);
            if (sound.empty()) usleep(10000);
        }
        send_sound();
        run(44100 / 2 / BLOCK);
        const uint8_t notes[] = {36, 48, 55, 60, 64, 67, 72, 79};
        for (uint8_t n : notes) {
            synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, 0x90, n, 100);
            plugin->addMidiEvent(ev);
        }
        run(44100 * 3 / 2 / BLOCK);
        synthLib::SMidiEvent off(synthLib::MidiEventSource::Host, 0xb0, 123, 0);
        plugin->addMidiEvent(off);
        run(44100 / BLOCK);
    }
    drain(false); // what came during the warm-up: the newest sound only
    send_sound();
    snprintf(st, sizeof(st), "Virus %s", o_model[model]);
    oshm::set_text(L, st, nullptr);
    L->phase.store(oshm::RUNNING, std::memory_order_release);
    plog("running: Virus %s", o_model[model]);

    float buf[12][BLOCK];
    synthLib::TAudioInputs ins{};
    synthLib::TAudioOutputs outs{};
    for (size_t i = 0; i < outs.size() && i < 12; i++) outs[i] = buf[i];
    float silent[BLOCK] = {0};
    for (size_t i = 0; i < ins.size(); i++) ins[i] = silent;
    std::vector<synthLib::SMidiEvent> midiOut;
    int64_t deepUntil = 0;
    while (!L->quit.load(std::memory_order_relaxed)) {
        if (getppid() != parent) break; // (PDEATHSIG covers it; this is in case)
        drain(true);
        uint32_t fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
        if (dumpPending && fill >= uint32_t(AHEAD_DUMP)) {
            send_sound();
            deepUntil = now_us() + 2500000;
        }
        const int64_t tnow = now_us(), miss = L->missAt.load(std::memory_order_relaxed);
        const bool deep = dumpPending || tnow < deepUntil || (miss && tnow - miss < MISS_DEEP_US);
        const uint32_t target = deep ? uint32_t(AHEAD_DUMP) : uint32_t(AHEAD);
        while (fill < target && !L->quit.load(std::memory_order_relaxed)) {
            const int64_t t0 = now_us();
            for (auto &b : buf) memset(b, 0, sizeof(b));
            plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
            midiOut.clear();
            plugin->getMidiOut(midiOut);
            const float g = float(L->gain.load(std::memory_order_relaxed)) * 0.01f * 0.5f * 32767.0f;
            const uint32_t w = L->wr.load(std::memory_order_relaxed);
            for (int i = 0; i < BLOCK; i++) {
                const uint32_t k = (w + uint32_t(i)) & (oshm::RING - 1);
                L->ring[k * 2] = int16_t(lrintf(soft_limit(buf[0][i] * g)));
                L->ring[k * 2 + 1] = int16_t(lrintf(soft_limit(buf[1][i] * g)));
            }
            L->wr.store(w + BLOCK, std::memory_order_release);
            const uint32_t us = uint32_t(now_us() - t0);
            L->blockUs.store(us, std::memory_order_relaxed);
            if (us > L->blockMaxUs.load(std::memory_order_relaxed)) L->blockMaxUs.store(us, std::memory_order_relaxed);
            fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
            drain(true); // notes arrive while the ring fills
        }
        timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 2000000;
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec++;
            ts.tv_nsec -= 1000000000;
        }
        sem_timedwait(&L->wake, &ts);
    }
    // no teardown: the process ends, and the emulator's threads with it
    _exit(0);
}
