// vavra-engine / xenia-engine: the emulator of Pung's Waldorf modules, in a
// process of its own (built with WALDORF_MQ or WALDORF_XT, as the plugin
// waldorf_engine.cpp is). Identical copies in native/vavra/dsp and
// native/xenia/dsp (edit one, copy, cmp).
//
// The plugin (dsp.so, inside Pung) starts it with the shared memory
// (emu_shm.h) as file descriptor 3, after it has taken the one-at-a-time
// lock. The engine boots the synth from the roms folder (gearmulator's own
// loaders choose the file), asks it for its sounds when the plugin has no
// sound set (Aux ASK_LIBRARY; each dump back through the queue, then
// LIBRARY_DONE), plays the warm-up chord with the plugin's sound, and then
// renders into the ring, playing what the plugin queues and handing back
// what the synth sends. Xenia's engine also publishes the DSP's wave memory
// (a table the synth computes) every 100 ms; both publish where the newest
// voice has its cutoff now every 10 ms (Pung's live_mod). It dies with the process that
// started it, and a stop is the plugin setting quit, or a kill.
//
// The render loop is the emulator thread the plugin had before (2026-11-20 to
// 11-23): the ring AHEAD frames ahead, AHEAD_DUMP around a sound dump and
// after an underrun, 6 dB of headroom and a soft limiter.

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <time.h>
#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "synthLib/deviceException.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"
#include "synthLib/romLoader.h"

#include "waldorf_family.h"
#if defined(WALDORF_MQ)
#include "mqLib/device.h"
#include "mqLib/microq.h"     // the DSP, for the live cutoff (patches/0003: Device::getMicroQ)
#include "mqLib/mqhardware.h"
typedef mqLib::Device SynthDevice;
#else
#include "xtLib/xtDevice.h"
#include "xtLib/xtHardware.h" // the DSP's wave memory (patches/0004: Device::getXt)
typedef xt::Device SynthDevice;
#endif

#include "emu_shm.h"

namespace {

const int BLOCK = 64;        // frames the emulator renders at a time
const int AHEAD = 320;       // frames kept ready for the host (7 ms)
const int AHEAD_DUMP = 1280; // 29 ms, around a sound dump
const int64_t MISS_DEEP_US = 3000000;

eshm::Layout *L = nullptr;

void plog(const char *fmt, ...) {
    char b[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof(b), fmt, ap);
    va_end(ap);
    fprintf(stderr, SYNTH_ID "-engine: %s\n", b);
}

int64_t now_us() {
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return int64_t(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

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

// What the synth sent, to the plugin. A full queue is waited for a while (the
// sound list is hundreds of dumps; the plugin reads them every 2 ms).
void hand_back(const synthLib::SysexBuffer &s) {
    for (int i = 0; i < 2000 && !L->quit.load(std::memory_order_relaxed); i++) {
        if (eshm::put(L->fromEngine, eshm::EVENT, s.data(), s.size())) return;
        usleep(1000);
    }
}

#if defined(WALDORF_XT)
// The sound's table as the synth plays it. The 68000 writes all 64 slots of
// the table into the DSP's external memory, from Y:0x24000 in Single mode, 256
// words a slot: 128 samples, then the halved copies down to one. A sample is
// bits 16..23 of its word, the cycle begun three samples early. Slot 61 is the
// fixed triangle in every table: if it is not there, this is not the wave
// memory. (Measured 2026-11-22; docs/NATIVE-MODULES.md, Xenia.)
const uint32_t WAVE_MEM = 0x24000, WAVE_SLOT = 256, WAVE_LEAD = 3;
void publish_wave_mem(SynthDevice &dev) {
    auto &mem = dev.getXt().getHardware()->getDSP(0).dsp().memory();
    auto at = [&](int slot, int i) { return mem.get(dsp56k::MemArea_Y, WAVE_MEM + uint32_t(slot) * WAVE_SLOT + uint32_t(i + WAVE_LEAD) % 128); };
    uint8_t out[WAVE_SNAPSHOT];
    out[0] = 1;
    for (int i = 0; i < 128 && out[0]; i++) {
        const int j = i & 63, tri = 2 + 3 * (j < 32 ? j : 63 - j);
        const uint32_t v = at(61, i);
        if ((v & 0xffff) || int8_t(v >> 16) != (i < 64 ? tri : -tri)) out[0] = 0;
    }
    for (int p = 0; p < 16 && out[0]; p++)
        for (int i = 0; i < 128; i++) {
            const uint32_t v = at(p * 4, i);
            if (v & 0xffff) {
                out[0] = 0;
                break;
            }
            out[1 + p * 128 + i] = uint8_t(int8_t(v >> 16));
        }
    eshm::put_blob(L, out, sizeof(out));
}

// Where the sound has its controls now, for Pung's live_mod (every synth
// shows its modulation moving; docs/NATIVE-MODULES.md, Xenia). Found in the
// DSP's memory with native/xenia/tools/xt_scan.cpp (2026-11-24), in Single
// mode on one DSP: five voices, the k-th note taking voice k-1, and a voice
// holding
//   Y:0x60 + 28 v   its oscillator's phase increment (the pitch: x2 an octave)
//   Y:0xEC + 14 v   its filter's cutoff with everything that moves it (LFO,
//                   envelope, keytrack): a semitone a knob step to about 90,
//                   the plugin's table (xt_cutoff) reads it back as the knob
//   X:0x61 + 28 v   Wave 1: Y:0x24000 + 256 * the wave it plays (the wave memory)
//   X:0x68 + 28 v   Wave 2, the same
// The voice a note took is the one whose pitch moved most in the 80 ms after
// it (a note struck again on its own voice moves nothing: the voice stays).
const int XT_VOICES = 5;
uint32_t notePitch[XT_VOICES];
int64_t noteOnAt = 0;
int liveVoice = -1;
uint32_t xt_word(SynthDevice &dev, bool y, uint32_t a) {
    auto &mem = dev.getXt().getHardware()->getDSP(0).dsp().memory();
    return mem.get(y ? dsp56k::MemArea_Y : dsp56k::MemArea_X, a) & 0xffffff;
}
void note_started(SynthDevice &dev, int64_t now) {
    for (int v = 0; v < XT_VOICES; v++) notePitch[v] = xt_word(dev, true, 0x60 + 28u * uint32_t(v));
    noteOnAt = now;
}
void publish_live(SynthDevice &dev, int64_t now) {
    if (noteOnAt) {
        double best = 0.004; // more than vibrato moves in a moment (a fifth of a semitone is 0.012)
        int bv = -1;
        for (int v = 0; v < XT_VOICES; v++) {
            const uint32_t p = xt_word(dev, true, 0x60 + 28u * uint32_t(v));
            const double r = std::fabs(std::log((double(p) + 1) / (double(notePitch[v]) + 1)));
            if (r > best) best = r, bv = v;
        }
        if (bv >= 0) liveVoice = bv, noteOnAt = 0;
        else if (now - noteOnAt > 80000) noteOnAt = 0;
    }
    if (liveVoice < 0) return;
    const uint32_t v = uint32_t(liveVoice);
    L->aux[LIVE_CUT].store(int32_t(xt_word(dev, true, 0xEC + 14 * v)), std::memory_order_relaxed);
    L->aux[LIVE_W1].store(int32_t(xt_word(dev, false, 0x61 + 28 * v)), std::memory_order_relaxed);
    L->aux[LIVE_W2].store(int32_t(xt_word(dev, false, 0x68 + 28 * v)), std::memory_order_relaxed);
    L->aux[LIVE_VOICE].store(liveVoice, std::memory_order_relaxed);
    L->aux[LIVE_AT].store(int32_t(uint32_t(now / 1000)), std::memory_order_release); // (ms; read with wrap)
}
#elif defined(WALDORF_MQ)
// Where the sound has its cutoff now, for Pung's live_mod (docs/NATIVE-MODULES.md,
// Vavra). The microQ keeps no voice's modulated values in memory: its DSP
// rebuilds a voice's parameters at Y:$20..$3F, adds the modulation matrix into
// them and plays the voice from there (Filter 1's cutoff at Y:$34), one voice
// after the other, newest first (the voice list at X:$2F2, the place being
// played at X:$13). A stub of Pung's in the program memory the firmware leaves
// free ($1400 on) runs right after the matrix, in place of the two
// instructions it moves there, and keeps each voice's cutoff at Y:$7F000 + its
// place in the list: internal memory the real DSP does not have, so nothing of
// the firmware's is there. Y:$7F000 is the newest voice's: (knob - 64) * 2^17,
// LFOs, envelopes and the matrix in it. Found and checked with
// native/vavra/tools/mq_scan.cpp (hook). The patch goes in only where the two
// instructions are the ones measured (another firmware: no live cutoff), and
// again whenever the 68000 has loaded the DSP's program anew.
const uint32_t MQ_AT = 0x3e1, MQ_LIST = 0x2f2, MQ_SLOTS = 0x7f000;
const uint32_t MQ_ORIG[2] = {0x5ea600, 0x4ea000}; // move y:$26,a / move y:$20,y0
const uint32_t MQ_JSR[2] = {0x0bf080, 0x001400};  // jsr >$1400
const uint32_t MQ_STUB[] = {
    0x679300,           // move x:$13,r7         the voice's place in the list (one past it)
    0x5fb400,           // move y:$34,b          its Filter 1 cutoff, modulated
    0x0b778f, 0x07ed0d, // move b,y:(r7+$7ed0d)  to Y:$7F000 + the place
    0x5ea600, 0x4ea000, // the two instructions the jsr took the place of
    0x00000c};          // rts
// (b and r7 are free there: the program sets both again right after)
std::atomic<int> mqHook{0}; // 0 not yet, 1 in, -1 another program (nothing to read)
std::atomic<bool> mqPatching{false};
std::thread mqPatcher;
int64_t mqCheckAt = 0;
mqLib::MqDsp &mq_dsp(SynthDevice &dev) { return dev.getMicroQ().getHardware()->getDSP(0); }
uint32_t mq_word(SynthDevice &dev, dsp56k::EMemArea a, uint32_t at) { return mq_dsp(dev).dsp().memory().get(a, at) & 0xffffff; }
// The DSP's thread holds its lock through each batch of instructions (and while
// it waits for the audio to be taken): the patch goes in from a thread of its
// own, between two batches, while the engine goes on rendering. At ordinary
// priority, never above the DSP's; given up after 2 s (and tried again later).
void mq_patch(SynthDevice *dev) {
    sched_param sp{};
    pthread_setschedparam(pthread_self(), SCHED_OTHER, &sp);
    auto &md = mq_dsp(*dev);
    auto &d = md.dsp();
    auto &mu = md.thread().mutex();
    const int64_t until = now_us() + 2000000;
    while (now_us() < until && !L->quit.load(std::memory_order_relaxed)) {
        if (!mu.try_lock()) {
            std::this_thread::sleep_for(std::chrono::microseconds(50)); // (no core spun while the DSP renders)
            continue;
        }
        const bool orig = mq_word(*dev, dsp56k::MemArea_P, MQ_AT) == MQ_ORIG[0] && mq_word(*dev, dsp56k::MemArea_P, MQ_AT + 1) == MQ_ORIG[1];
        if (orig && d.getPC().toWord() != MQ_AT + 1) { // (never between the two words)
            for (uint32_t i = 0; i < sizeof(MQ_STUB) / sizeof(MQ_STUB[0]); i++) d.memWriteP(MQ_JSR[1] + i, MQ_STUB[i]);
            d.memWriteP(MQ_AT + 1, MQ_JSR[1]);
            d.memWriteP(MQ_AT, MQ_JSR[0]);
            mu.unlock();
            mqHook = 1;
            plog("live cutoff: the DSP's program hooked");
            break;
        }
        mu.unlock();
        if (!orig) break;
        std::this_thread::sleep_for(std::chrono::microseconds(50));
    }
    mqPatching = false;
}
void publish_live(SynthDevice &dev, int64_t now) {
    if (now - mqCheckAt >= 1000000 && !mqPatching) { // once a second: the hook still in (a new program?)
        mqCheckAt = now;
        if (mqPatcher.joinable()) mqPatcher.join();
        const uint32_t a = mq_word(dev, dsp56k::MemArea_P, MQ_AT), b = mq_word(dev, dsp56k::MemArea_P, MQ_AT + 1);
        bool stub = true;
        for (uint32_t i = 0; i < sizeof(MQ_STUB) / sizeof(MQ_STUB[0]); i++)
            if (mq_word(dev, dsp56k::MemArea_P, MQ_JSR[1] + i) != MQ_STUB[i]) stub = false;
        if (a == MQ_JSR[0] && b == MQ_JSR[1] && stub) {
            mqHook = 1;
        } else if (a == MQ_ORIG[0] && b == MQ_ORIG[1]) {
            mqHook = 0;
            mqPatching = true;
            mqPatcher = std::thread(mq_patch, &dev);
        } else if (mqHook.exchange(-1) != -1) {
            plog("live cutoff: not the program it was measured on (P:%x %06x %06x): none", MQ_AT, a, b);
        }
    }
    if (mqHook.load() != 1 || !mq_word(dev, dsp56k::MemArea_X, MQ_LIST)) return; // not hooked, or no voice sounds
    L->aux[LIVE_CUT].store(int32_t(mq_word(dev, dsp56k::MemArea_Y, MQ_SLOTS)), std::memory_order_relaxed);
    L->aux[LIVE_VOICE].store(0, std::memory_order_relaxed);
    L->aux[LIVE_AT].store(int32_t(uint32_t(now / 1000)), std::memory_order_release); // (ms; read with wrap)
}
#endif

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
    pthread_setname_np(pthread_self(), SYNTH_ID);
    // the emulator logs every hardware register it touches: not into Pung's log
    Logging::setLogFunc([](const std::string &) {});
    // Below the host's audio threads, above everything ordinary (OsTIrus).
    sched_param sp{};
    sp.sched_priority = 45;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) plog("no realtime priority (%s)", strerror(errno));

    eshm::set_text(L, "Booting the " SYNTH_HW, "");
    L->phase.store(eshm::BOOTING, std::memory_order_release);
    synthLib::RomLoader::addSearchPath(L->romPath); // the module's roms folder
    const int64_t t0 = now_us();
    std::unique_ptr<SynthDevice> device;
    std::unique_ptr<synthLib::Plugin> plugin;
    try {
        synthLib::DeviceCreateParams p;
        p.hostSamplerate = 44100.0f;
        p.customData = 0; // no voice expansion: one DSP
        device.reset(new SynthDevice(p));
        if (!device->isValid()) throw synthLib::DeviceException(synthLib::DeviceError::FirmwareMissing);
        plugin.reset(new synthLib::Plugin(device.get(), [](synthLib::Device *d) { return d; }));
        plugin->setHostSamplerate(44100.0f, 0.0f);
        plugin->setBlockSize(BLOCK);
    } catch (const synthLib::DeviceException &e) {
        char err[200];
        if (e.errorCode() == synthLib::DeviceError::FirmwareMissing) {
            snprintf(err, sizeof(err), "No firmware: put %s into the module's roms folder", FIRMWARE_HINT);
            fail("Firmware missing", err);
        } else {
            snprintf(err, sizeof(err), "The emulator did not start: %s", e.what());
            fail("Failed", err);
        }
        return 0;
    } catch (const std::exception &e) {
        char err[200];
        snprintf(err, sizeof(err), "The emulator did not start: %s", e.what());
        fail("Failed", err);
        return 0;
    }
    plog("booted in %d ms", int((now_us() - t0) / 1000));
    if (fam::BOOT) {
        synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
        ev.sysex.assign(fam::BOOT, fam::BOOT + fam::BOOT_LEN);
        plugin->addMidiEvent(ev);
    }

    float buf[12][BLOCK];
    synthLib::TAudioInputs ins{};
    synthLib::TAudioOutputs outs{};
    for (size_t i = 0; i < outs.size() && i < 12; i++) outs[i] = buf[i];
    float silent[BLOCK] = {0};
    for (size_t i = 0; i < ins.size(); i++) ins[i] = silent;
    std::vector<synthLib::SMidiEvent> midiOut;

    // The sound list, when the plugin has no sound set: the synth is asked for
    // every sound, one at a time, and the emulator runs until each answer is
    // in; each dump goes back to the plugin.
    if (L->aux[ASK_LIBRARY].load() && fam::BANKS > 0) {
        eshm::set_text(L, "Reading the sounds", nullptr);
        int got = 0;
        const bool scanLog = getenv("PUNG_SCAN_LOG") != nullptr;
        for (int b = 0; b < fam::BANKS && !L->quit.load() && !(got == 0 && b > 0); b++) {
            char st[80];
            snprintf(st, sizeof(st), "Reading the sounds: %s", fam::BANK_NAME[b]);
            eshm::set_text(L, st, nullptr);
            int misses = 0; // a bank with fewer sounds than places (the XT's B has 100 of 128): three gaps end it
            for (int p = 0; p < fam::SOUNDS && !L->quit.load() && !(got == 0 && p > 0); p++) {
                synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
                ev.sysex = {0xf0, fam::WALDORF, fam::MODEL, fam::OMNI, fam::REQUEST_SINGLE, uint8_t(fam::BANK0 + b), uint8_t(p), 0xf7};
                plugin->addMidiEvent(ev);
                // the first answer waits for the OS to settle, and a bank's first for the
                // synth to turn to it; the others come quickly
                const int limit = got == 0 || p == 0 ? 44100 * 10 / BLOCK : 44100 * 2 / BLOCK;
                bool done = false;
                for (int k = 0; k < limit && !done && !L->quit.load(); k++) {
                    plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
                    midiOut.clear();
                    plugin->getMidiOut(midiOut);
                    for (const auto &e : midiOut) {
                        const auto &s = e.sysex;
                        int rb, rp;
                        if (scanLog && s.size() > 6)
                            plog("asked %c%d, after %d ms: %d bytes, %02x %02x %02x", 'A' + b, p + 1, k * BLOCK * 1000 / 44100, int(s.size()),
                                 s[4], s[5], s[6]);
                        if (!single_dump(s, rb, rp) || rb >= fam::BANKS || rp >= fam::SOUNDS) continue;
                        hand_back(s);
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
        plog("the synth gave %d sounds", got);
    }
    L->aux[LIBRARY_DONE].store(1, std::memory_order_release);

    // the sound: the plugin's last dump, sent at the warm-up's start and again
    // once the engine plays
    std::vector<uint8_t> sound, entry;
    bool dumpPending = false;
    eshm::Cold cold;
    auto drain = [&](bool playing) {
        uint8_t kind;
        while (eshm::take(L->toEngine, kind, entry)) {
            if (kind == eshm::DUMP) {
                sound = entry;
                dumpPending = true;
            } else if (playing) {
                synthLib::SMidiEvent ev = to_event(entry);
                if (entry.size() >= 3 && (entry[0] & 0xf0) == 0x90 && entry[2] > 0) cold.note_on(now_us());
#if defined(WALDORF_XT)
                if (entry.size() >= 3 && (entry[0] & 0xf0) == 0x90 && entry[2] > 0) note_started(*device, now_us());
#endif
                plugin->addMidiEvent(ev);
            }
        }
    };
    auto send_sound = [&] {
        if (sound.empty()) return;
        synthLib::SMidiEvent ev = to_event(sound);
        plugin->addMidiEvent(ev);
        dumpPending = false;
        cold.sound();
    };

    // Warm-up, before the first note anyone hears (OsTIrus): the DSP emulator
    // compiles the synth's code the first time it runs it, and the first
    // chords after a start underran the ring while it did (seven in a minute's
    // playing, measured 2026-11-20). The sound is loaded and a chord played,
    // unheard.
    eshm::set_text(L, "Warming up the " SYNTH_HW, nullptr);
    L->phase.store(eshm::WARMING, std::memory_order_release);
    {
        float wb[12][BLOCK];
        synthLib::TAudioInputs wi{};
        synthLib::TAudioOutputs wo{};
        float z[BLOCK] = {0};
        for (size_t i = 0; i < wo.size() && i < 12; i++) wo[i] = wb[i];
        for (size_t i = 0; i < wi.size(); i++) wi[i] = z;
        std::vector<synthLib::SMidiEvent> sink;
        auto run = [&](double seconds) {
            for (int b = 0; b < int(44100 * seconds / BLOCK) && !L->quit.load(); b++) {
                plugin->process(wi, wo, BLOCK, 120.0f, 0.0f, false);
                sink.clear();
                plugin->getMidiOut(sink);
            }
        };
        // the plugin sends its sound once the sound list is in
        for (int i = 0; i < 300 && sound.empty() && !L->quit.load(); i++) {
            drain(false);
            if (sound.empty()) usleep(10000);
        }
        send_sound();
        run(0.3);
        const uint8_t notes[] = {36, 48, 55, 60, 64, 67, 72, 79};
        for (uint8_t n : notes) {
            synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, 0x90, n, 100);
            plugin->addMidiEvent(ev);
        }
        run(1.5);
        synthLib::SMidiEvent off(synthLib::MidiEventSource::Host, 0xb0, 123, 0); // all notes off
        plugin->addMidiEvent(off);
        run(1.0);
    }
    drain(false); // what came during the warm-up: the newest sound only
    dumpPending = !sound.empty(); // again, for the sound to start clean
    eshm::set_text(L, SYNTH_HW, nullptr);
    L->phase.store(eshm::RUNNING, std::memory_order_release);
    plog("running");

    int64_t deepUntil = 0, memAt = 0, liveAt = 0;
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
        const uint32_t target = cold.deep(tnow) ? uint32_t(eshm::AHEAD_COLD) : deep ? uint32_t(AHEAD_DUMP) : uint32_t(AHEAD);
        while (fill < target && !L->quit.load(std::memory_order_relaxed)) {
            const int64_t b0 = now_us();
            for (auto &b : buf) memset(b, 0, sizeof(b));
            plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
            midiOut.clear();
            plugin->getMidiOut(midiOut);
            for (const auto &e : midiOut)
                if (e.sysex.size() > 6) {
                    if (getenv("PUNG_SCAN_LOG"))
                        fprintf(stderr, "sysex out: %zu bytes cmd %02x %02x %02x\n", e.sysex.size(), e.sysex[4], e.sysex[5], e.sysex[6]);
                    eshm::put(L->fromEngine, eshm::EVENT, e.sysex.data(), e.sysex.size());
                }
            const float g = float(L->gain.load(std::memory_order_relaxed)) * 0.01f * 0.5f * 32767.0f;
            const uint32_t w = L->wr.load(std::memory_order_relaxed);
            for (int i = 0; i < BLOCK; i++) {
                const uint32_t k = (w + uint32_t(i)) & (eshm::RING - 1);
                L->ring[k * 2] = int16_t(lrintf(soft_limit(buf[0][i] * g)));
                L->ring[k * 2 + 1] = int16_t(lrintf(soft_limit(buf[1][i] * g)));
            }
            L->wr.store(w + BLOCK, std::memory_order_release);
            const uint32_t us = uint32_t(now_us() - b0);
            cold.block(us, b0);
            L->blockUs.store(us, std::memory_order_relaxed);
            if (us > L->blockMaxUs.load(std::memory_order_relaxed)) L->blockMaxUs.store(us, std::memory_order_relaxed);
            fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
            drain(true); // notes arrive while the ring fills
        }
        // at rest (emu_host.h): the ring is full again and nobody reads it;
        // wait for an entry, and read nothing from the emulator meanwhile
        if (eshm::rest_wait(L)) continue;
#if defined(WALDORF_XT)
        if (now_us() - memAt >= 100000) {
            memAt = now_us();
            publish_wave_mem(*device);
        }
#endif
        if (now_us() - liveAt >= 10000) {
            liveAt = now_us();
            publish_live(*device, liveAt);
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
    (void)memAt;
    (void)liveAt;
    _exit(0); // no teardown: the process ends, and the emulator's threads with it
}
