// nodalred-engine: Nodal Red 2X's emulator, in a process of its own.
//
// The plugin (dsp.so, inside Pung) starts it with the shared memory
// (emu_shm.h) as file descriptor 3, after it has found the firmware and
// taken the one-at-a-time lock. The engine boots the Nord, then renders into
// the ring as long as the plugin wants it, playing what the plugin queues (MIDI
// and dumps) and handing back what the synth sends (the answers to the
// plugin's dump requests). It dies with the process that started it, and a
// stop is the plugin setting quit, or a kill: nothing it does can hold Pung.
//
// The render loop is the emulator thread the plugin had before (2026-11-18 to
// 11-23): the ring AHEAD frames ahead, AHEAD_DUMP around a sound change and
// after an underrun, the synth's two output pairs summed with 6 dB of
// headroom and a soft limiter.

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <time.h>
#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "n2xLib/n2xdevice.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"

#include "emu_shm.h"

// The 68k emulator writes every register access to stderr through this
// function: not into Pung's log (as the plugin had it).
namespace mc68k {
void logToConsole(const std::string &) {}
} // namespace mc68k

namespace {

const int BLOCK = 64;        // frames the emulator renders at a time
const int AHEAD = 320;       // frames kept ready for the host (7 ms)
const int AHEAD_DUMP = 1280; // 29 ms, around a sound change (the emulator stalls taking a dump)
const int64_t MISS_DEEP_US = 3000000;

eshm::Layout *L = nullptr;

void plog(const char *fmt, ...) {
    char b[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof(b), fmt, ap);
    va_end(ap);
    fprintf(stderr, "nodalred-engine: %s\n", b);
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

// What still goes past the headroom bends instead of breaking: straight up
// to 3/4 of full scale, then a curve that only reaches full scale at infinity.
inline float soft_limit(float v) {
    const float knee = 24576.f, room = 32767.f - knee;
    const float a = v < 0 ? -v : v;
    if (a <= knee) return v;
    const float o = knee + room * std::tanh((a - knee) / room);
    return v < 0 ? -o : o;
}

void fail(const char *status, const char *error) {
    eshm::set_text(L, status, error);
    L->phase.store(eshm::FAILED, std::memory_order_release);
    plog("%s", error);
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
    prctl(PR_SET_PDEATHSIG, SIGKILL); // with the process that started it, never without
    const pid_t parent = getppid();
    if (parent == 1) return 1;
    int fd = 3;
    for (int i = 1; i < argc; i++)
        if (!strncmp(argv[i], "--shm-fd=", 9)) fd = atoi(argv[i] + 9);
    void *m = mmap(nullptr, sizeof(eshm::Layout), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (m == MAP_FAILED) {
        plog("no shared memory (fd %d): %s", fd, strerror(errno));
        return 1;
    }
    L = static_cast<eshm::Layout *>(m);
    if (L->magic != eshm::MAGIC || L->version != eshm::VERSION) {
        plog("shared memory of another version");
        return 1;
    }
    close(fd);
    pthread_setname_np(pthread_self(), "nodalred");
    // the emulator logs every hardware register and MIDI byte it touches: not into Pung's log
    Logging::setLogFunc([](const std::string &) {});
    // Below the host's audio threads, above everything ordinary. The
    // emulator's two DSP threads and its 68k thread are made by this one and
    // inherit it.
    sched_param sp{};
    sp.sched_priority = 45;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) plog("no realtime priority (%s)", strerror(errno));

    eshm::set_text(L, "Booting the Nord Lead 2X", "");
    L->phase.store(eshm::BOOTING, std::memory_order_release);
    std::vector<uint8_t> rom;
    if (!read_file(L->romPath, rom)) {
        fail("ROM missing", "The ROM could not be read");
        return 0;
    }
    const char *slash = strrchr(L->romPath, '/');
    std::unique_ptr<n2x::Device> device;
    std::unique_ptr<synthLib::Plugin> plugin;
    try {
        synthLib::DeviceCreateParams p;
        p.romData = rom;
        p.romName = slash ? slash + 1 : L->romPath;
        p.hostSamplerate = 44100.0f;
        device.reset(new n2x::Device(p));
        plugin.reset(new synthLib::Plugin(device.get(), [](synthLib::Device *d) { return d; }));
        plugin->setHostSamplerate(44100.0f, 0.0f);
        plugin->setBlockSize(BLOCK);
    } catch (const std::exception &e) {
        char err[200];
        snprintf(err, sizeof(err), "The emulator did not start: %s", e.what());
        fail("Failed", err);
        return 0;
    }
    eshm::set_text(L, "Ready", nullptr);
    L->phase.store(eshm::RUNNING, std::memory_order_release);
    plog("running");

    std::vector<uint8_t> entry;
    auto drain = [&] {
        uint8_t kind;
        while (eshm::take(L->toEngine, kind, entry)) {
            synthLib::SMidiEvent ev = to_event(entry);
            plugin->addMidiEvent(ev);
        }
    };
    float buf[4][BLOCK];
    synthLib::TAudioInputs ins{};
    synthLib::TAudioOutputs outs{};
    for (int i = 0; i < 4; i++) outs[size_t(i)] = buf[i];
    std::vector<synthLib::SMidiEvent> midiOut;
    while (!L->quit.load(std::memory_order_relaxed)) {
        if (getppid() != parent) break; // (PDEATHSIG covers it; this is in case)
        drain();
        uint32_t fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
        const int64_t tnow = now_us(), miss = L->missAt.load(std::memory_order_relaxed);
        const bool deep = L->wantDeep.load(std::memory_order_relaxed) || tnow < L->deepUntil.load(std::memory_order_relaxed) ||
                          (miss && tnow - miss < MISS_DEEP_US);
        const uint32_t target = deep ? uint32_t(AHEAD_DUMP) : uint32_t(AHEAD);
        while (fill < target && !L->quit.load(std::memory_order_relaxed)) {
            const int64_t t0 = now_us();
            for (auto &b : buf) memset(b, 0, sizeof(b));
            plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
            midiOut.clear();
            plugin->getMidiOut(midiOut);
            for (auto &e : midiOut)
                if (e.sysex.size() >= 8) eshm::put(L->fromEngine, eshm::EVENT, e.sysex.data(), e.sysex.size());
            // 6 dB of headroom: the synth's two output pairs are summed here,
            // and a layer of slots at full level went past full scale
            // (measured 2026-11-18: 18 clipped bursts in 10 s of playing)
            const float g = float(L->gain.load(std::memory_order_relaxed)) * 0.01f * 0.5f * 32767.0f;
            const uint32_t w = L->wr.load(std::memory_order_relaxed);
            for (int i = 0; i < BLOCK; i++) {
                const float l = soft_limit((buf[0][i] + buf[2][i]) * g), r = soft_limit((buf[1][i] + buf[3][i]) * g);
                const uint32_t k = (w + uint32_t(i)) & (eshm::RING - 1);
                L->ring[k * 2] = int16_t(lrintf(l));
                L->ring[k * 2 + 1] = int16_t(lrintf(r));
            }
            L->wr.store(w + BLOCK, std::memory_order_release);
            const uint32_t us = uint32_t(now_us() - t0);
            L->blockUs.store(us, std::memory_order_relaxed);
            if (us > L->blockMaxUs.load(std::memory_order_relaxed)) L->blockMaxUs.store(us, std::memory_order_relaxed);
            fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
            drain(); // notes arrive while the ring fills
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
    _exit(0); // no teardown: the process ends, and the emulator's threads with it
}
