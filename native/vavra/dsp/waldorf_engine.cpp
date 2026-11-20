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

#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <sys/file.h>
#include <time.h>
#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "synthLib/deviceException.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"
#include "synthLib/romLoader.h"

#if defined(WALDORF_MQ)
#include "mqLib/device.h"
typedef mqLib::Device SynthDevice;
#define SYNTH_ID "vavra"
#define SYNTH_NAME "Vavra"
#define SYNTH_HW "microQ"
#define FIRMWARE_HINT "the microQ operating system mq_2_23.mid, or a 512 KB microQ ROM"
#elif defined(WALDORF_XT)
#include "xtLib/xtDevice.h"
typedef xt::Device SynthDevice;
#define SYNTH_ID "xenia"
#define SYNTH_NAME "Xenia"
#define SYNTH_HW "Microwave II/XT"
#define FIRMWARE_HINT "a 256 KB Microwave II/XT ROM (or its two 128 KB halves)"
#else
#error "WALDORF_MQ or WALDORF_XT"
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

const int RING = 4096;  // stereo frames, a power of two
const int BLOCK = 64;   // frames the emulator renders at a time
const int AHEAD = 320;  // frames kept ready for the host (7 ms)

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
    std::atomic<uint32_t> blockUs{0}, blockMaxUs{0};

    std::mutex mu;
    int gain = 100; // percent
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

// What goes past the headroom bends instead of breaking (Nodal Red 2X: a
// hard corner is a click on every peak).
inline float soft_limit(float v) {
    const float knee = 24576.f, room = 32767.f - knee;
    const float a = v < 0 ? -v : v;
    if (a <= knee) return v;
    const float o = knee + room * std::tanh((a - knee) / room);
    return v < 0 ? -o : o;
}

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
    {
        std::lock_guard<std::mutex> l(in->mu);
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
        while (fill < uint32_t(AHEAD) && !in->quit.load(std::memory_order_relaxed)) {
            const int64_t b0 = now_us();
            for (auto &b : buf) memset(b, 0, sizeof(b));
            in->plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
            midiOut.clear();
            in->plugin->getMidiOut(midiOut);
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
    if (!strcmp(key, "gain")) in->gain = std::max(1, std::min(200, atoi(val)));
}

int v2_get_param(void *instance, const char *key, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !buf || len <= 0) return -1;
    if (!strcmp(key, "debug_info"))
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u", in->underruns.load(), in->blockUs.load(),
                        in->blockMaxUs.exchange(0), in->wr.load() - in->rd.load());
    std::lock_guard<std::mutex> l(in->mu);
    if (!strcmp(key, "status")) return snprintf(buf, size_t(len), "%s", in->status);
    if (!strcmp(key, "gain")) return snprintf(buf, size_t(len), "%d", in->gain);
    if (!strcmp(key, "chain_params"))
        return snprintf(buf, size_t(len), "[{\"key\":\"gain\",\"name\":\"Output Gain\",\"type\":\"int\",\"min\":1,\"max\":200,\"unit\":\"%%\"}]");
    if (!strcmp(key, "ui_hierarchy"))
        return snprintf(buf, size_t(len), "{\"modes\":null,\"levels\":{\"root\":{\"label\":\"" SYNTH_NAME "\",\"children\":null,"
                                          "\"knobs\":[\"gain\"],\"params\":[\"gain\"]}}}");
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
    if (n < uint32_t(frames)) {
        memset(out + n * 2, 0, size_t(uint32_t(frames) - n) * 2 * sizeof(int16_t));
        in->underruns.fetch_add(1, std::memory_order_relaxed);
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
