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
#include <atomic>
#include <cerrno>
#include <chrono>
#include <map>
#include <thread>
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
#include "dsp56kEmu/dsp.h"
#include "dsp56kEmu/dspthread.h"
#include "dsp56kEmu/memory.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"
#include "virusLib/device.h"
#include "virusLib/deviceModel.h"
#include "virusLib/dspMultiTI.h"
#include "virusLib/dspSingle.h"

#include "ostirus_shm.h"

namespace {

const int BLOCK = 64;        // frames the emulator renders at a time
// WAKE_DROP: blocks of the emulator's silence dropped as it wakes from a rest
// (the main loop, "waking"). Measured on a Push, 30 notes awake and 30 after a
// rest, turn about (2026-11-25), a note to its sound: none dropped 19.3 ms
// against 15.6 awake; two 16.6 against 14.9; three 13.7 against 15.2. Three:
// the first note after a rest is never the later one.
const int WAKE_DROP = 3;
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

// ---- the live cutoff (Pung's live_mod) ---------------------------------------
//
// Where the newest voice has Filter 1's cutoff now (docs/NATIVE-MODULES.md,
// OsTIrus). The DSP's program works out each voice's cutoff, knob, keytrack,
// filter envelope and LFOs in it, a voice at a time (func_000938: the part's
// record in r1, the voice's in r0), and stores it in a scratch word (Y:$46AC9)
// the next voice overwrites: read from outside it is any voice's. A
// stub of Pung's in program memory the firmware leaves free ($1F000; the
// program ends at $1BFC) runs in place of that store (P:$95D, and P:$4FFF2 for
// the analog filter models) and also writes
// each (value, voice) pair into a ring at Y:$1E000, a modulo buffer in
// internal memory the real DSP does not have. It masks interrupts while it
// borrows r7 and m7 (an interrupt routine keeps r7 as its own pointer), gives
// the SR back before the moved instruction (which sets the flags the program
// goes on with), and waits out the address unit's pipeline after loading an
// address register. Found and checked with native/ostirus/tools/ti_scan.cpp
// (hook): the value follows LFO 2 on Cutoff 1 at every rate (1 Hz at rate 60,
// 11 Hz at 110, the audio's brightness in step), the filter envelope, and the
// knob (1361 + 60 k, up to 7935: fully open from knob 110).
//
// On the TI both DSPs run the program, each its share of the voices: both are
// hooked. The patch goes in only where the store is the measured one (another
// firmware, or the TI2's or the Snow's program: no live cutoff, said once),
// from a thread of its own at ordinary priority while the engine renders (the
// DSP's thread holds its lock through each batch and while its audio waits to
// be taken), and again whenever the program has been loaded anew.
// the store, in Filter 1's two routines: the filter models of the Virus's own
// (func_000938) and the analog ones, modes 4 to 7 (func_04ffd2, in external
// program memory): the same instruction, the same registers
const uint32_t LV_SITES[2] = {0x95d, 0x4fff2};     // mac y0,x0,b  a,y:>$46ac9
const uint32_t LV_ORIG[2] = {0x5e70da, 0x046ac9};
const uint32_t LV_STUB = 0x1f000;
const uint32_t LV_JSR[2] = {0x0bf080, LV_STUB};     // jsr >$1f000
const uint32_t LV_PTR = 0x1dff2;                   // Y: the ring's write pointer (r7 saved at -2, m7 at -1, the SR at +3)
const uint32_t LV_RING = 0x1e000, LV_WORDS = 0x2000; // Y: (value, voice) pairs
const uint32_t LV_CODE[] = {
    0x057079, 0x01dff5,           // move sr,y:>$1dff5
    0x0003f8,                     // ori #$3,mr          interrupts masked
    0x000000, 0x000000, 0x000000, // nop x3
    0x6f7000, 0x01dff0,           // move r7,y:>$1dff0
    0x057067, 0x01dff1,           // move m7,y:>$1dff1
    0x6ff000, 0x01dff2,           // move y:>$1dff2,r7   the ring's pointer
    0x05f427, 0x001fff,           // move #>$1fff,m7     modulo $2000
    0x000000, 0x000000,           // nop x2              (the address unit's pipeline)
    0x5e5f00,                     // move a,y:(r7)+      the cutoff
    0x685f00,                     // move r0,y:(r7)+     the voice
    0x6f7000, 0x01dff2,           // move r7,y:>$1dff2
    0x05f067, 0x01dff1,           // move y:>$1dff1,m7
    0x6ff000, 0x01dff0,           // move y:>$1dff0,r7
    0x000000, 0x000000,           // nop x2
    0x05f079, 0x01dff5,           // move y:>$1dff5,sr
    0x000000, 0x000000,           // nop x2
    0x5e70da, 0x046ac9,           // mac y0,x0,b  a,y:>$46ac9   the instruction the jsr stands in for
    0x00000c};                    // rts
const uint32_t LV_LEN = sizeof(LV_CODE) / sizeof(LV_CODE[0]);

// A voice, by its DSP and its record (r0, X:$50 + $32 k: the TI's two DSPs run
// the same program, each its share of the voices). The program works out each
// sounding voice's cutoff a few hundred to a few thousand times a second
// (about 3000 a second shared between a DSP's voices), a silent one about 40:
// written more than 100 times a second over the last 100 ms, it sounds. It
// also works out a cutoff, always open, for a record of another kind (X:$B59)
// hundreds of times a second: not a voice, never shown.
struct LiveVoice {
    int32_t value = 0, before = 0; // now, and when the last note began
    uint8_t cnt[10] = {};          // writes in each of the last ten ticks
    int sum = 0;
    bool active = false, wasActive = false;
    int64_t since = 0;             // when it began to sound
};
inline bool lv_voice(uint32_t r0) { return r0 >= 0x50 && r0 < 0x50 + 0x32 * 128 && (r0 - 0x50) % 0x32 == 0; }

struct LiveDsp {
    const virusLib::DspSingle *dsp = nullptr;
    int state = 0;   // 0 not hooked yet, 1 hooked, -1 another program (none)
    bool want = false; // to be (re)patched
    uint32_t rd = 0; // the ring's read pointer (0: from where it is)
};

struct Live {
    std::vector<LiveDsp> dsps;
    std::thread patcher;
    std::atomic<bool> patching{false};
    int64_t checkAt = 0;
    int tick = 0;
    std::map<uint32_t, LiveVoice> voices; // by (DSP << 24) | record
    // the newest voice: the one whose cutoff moved most in the 80 ms after a
    // note began (a new voice, or one taken over), as Nodal Red's engine; a
    // note that moves none (an LFO moves them all alike) keeps the voice
    uint32_t newest = 0;
    int64_t noteAt = 0;
    bool judging = false;
};

// the TI's DSPs (its second one runs the same program), or the one there is
void lv_init(Live &lv, virusLib::Device &dev) {
    const virusLib::DspSingle *a = dev.getDspA();
    if (!a) return;
    lv.dsps.push_back({a});
    if (const auto *ti = dynamic_cast<const virusLib::DspMultiTI *>(a))
        lv.dsps.push_back({&const_cast<virusLib::DspMultiTI *>(ti)->getDSP2()});
}

// a note began (the engine's MIDI): the voices as they are, to judge against
void lv_note(Live &lv, int64_t now) {
    lv.noteAt = now;
    lv.judging = true;
    for (auto &v : lv.voices) v.second.before = v.second.value, v.second.wasActive = v.second.active;
}

uint32_t pw(const virusLib::DspSingle *d, uint32_t a) { return d->getMemory().get(dsp56k::MemArea_P, a) & 0xffffff; }
uint32_t yw(const virusLib::DspSingle *d, uint32_t a) { return d->getMemory().get(dsp56k::MemArea_Y, a) & 0xffffff; }

bool stub_in(const virusLib::DspSingle *d) {
    for (uint32_t i = 0; i < LV_LEN; i++)
        if (pw(d, LV_STUB + i) != LV_CODE[i]) return false;
    return true;
}

// the patch of one DSP, under its lock between two of its batches: true when in
bool lv_patch_one(const virusLib::DspSingle *ds) {
    dsp56k::DSP &d = ds->getDSP();
    std::mutex &mu = ds->getDSPThread()->mutex();
    const int64_t until = now_us() + 2000000;
    while (now_us() < until && !L->quit.load(std::memory_order_relaxed)) {
        if (!mu.try_lock()) { // (it lets go only between batches, briefly)
            std::this_thread::yield();
            continue;
        }
        const uint32_t pc = d.getPC().toWord();
        bool known = true, clear = pc < LV_STUB || pc >= LV_STUB + LV_LEN;
        for (uint32_t at : LV_SITES) {
            const uint32_t a = pw(ds, at), b = pw(ds, at + 1);
            known = known && ((a == LV_ORIG[0] && b == LV_ORIG[1]) || (a == LV_JSR[0] && b == LV_JSR[1]));
            clear = clear && pc != at + 1;
        }
        bool done = false;
        if (known && clear) {
            // the ring from its start (the stub is not running: the DSP is between batches)
            d.memWrite(dsp56k::MemArea_Y, LV_PTR, LV_RING);
            for (uint32_t i = 0; i < LV_WORDS; i++) d.memWrite(dsp56k::MemArea_Y, LV_RING + i, 0);
            for (uint32_t i = 0; i < LV_LEN; i++) d.memWriteP(LV_STUB + i, LV_CODE[i]);
            for (uint32_t at : LV_SITES) {
                d.memWriteP(at + 1, LV_JSR[1]);
                d.memWriteP(at, LV_JSR[0]);
            }
            done = true;
        }
        mu.unlock();
        if (done) return true;
        if (!known) return false;
        std::this_thread::sleep_for(std::chrono::microseconds(50)); // (the PC was in the way)
    }
    return false;
}

// the patcher: at ordinary priority, every DSP that wants it
void lv_patch(Live *lv) {
    sched_param sp{};
    pthread_setschedparam(pthread_self(), SCHED_OTHER, &sp);
    for (size_t i = 0; i < lv->dsps.size(); i++) {
        LiveDsp &x = lv->dsps[i];
        if (!x.want) continue;
        if (lv_patch_one(x.dsp)) plog("live cutoff: DSP %c's program hooked", char('A' + i));
        x.want = false;
    }
    lv->patching = false;
}

// every 10 ms while running: the hooks checked once a second, the rings read,
// and the newest sounding voice's cutoff published
void lv_tick(Live &lv, int64_t now) {
    if (lv.dsps.empty() || !lv.dsps[0].dsp->getDSPThread()) return;
    if (now - lv.checkAt >= 1000000 && !lv.patching) {
        lv.checkAt = now;
        if (lv.patcher.joinable()) lv.patcher.join();
        bool any = false, need = false;
        for (size_t i = 0; i < lv.dsps.size(); i++) {
            LiveDsp &x = lv.dsps[i];
            const virusLib::DspSingle *ds = x.dsp;
            if (!ds->getDSPThread()) continue;
            const uint32_t p = yw(ds, LV_PTR);
            bool ours = true, known = true;
            uint32_t a = 0, b = 0;
            for (uint32_t at : LV_SITES) {
                const uint32_t wa = pw(ds, at), wb = pw(ds, at + 1);
                const bool o = wa == LV_JSR[0] && wb == LV_JSR[1];
                ours = ours && o;
                known = known && (o || (wa == LV_ORIG[0] && wb == LV_ORIG[1]));
                if (!known && !a) a = wa, b = wb;
            }
            const bool orig = known && !ours;
            if (ours && stub_in(ds) && p >= LV_RING && p < LV_RING + LV_WORDS && !(p & 1)) {
                x.state = 1;
            } else if (orig || ours) { // not yet, the program loaded anew, the stub or its pointer overwritten
                x.state = 0, x.rd = 0, x.want = true, need = true;
                for (auto it = lv.voices.begin(); it != lv.voices.end();)
                    it = (it->first >> 24) == i ? lv.voices.erase(it) : std::next(it);
            } else if (x.state != -1) {
                x.state = -1;
                plog("live cutoff: DSP %c, not the program it was measured on (%06x %06x): none", char('A' + i), a, b);
            }
            any = any || x.state == 1;
        }
        if (need) {
            lv.patching = true;
            lv.patcher = std::thread(lv_patch, &lv);
        }
        L->liveHook.store(any ? 1 : (lv.dsps[0].state == -1 ? -1 : 0), std::memory_order_release);
    }
    std::map<uint32_t, int> n;
    for (size_t i = 0; i < lv.dsps.size(); i++) {
        LiveDsp &x = lv.dsps[i];
        if (x.state != 1) continue;
        const virusLib::DspSingle *ds = x.dsp;
        const uint32_t wr = yw(ds, LV_PTR);
        if (wr < LV_RING || wr >= LV_RING + LV_WORDS || (wr & 1)) continue;
        uint32_t dist = (wr - (x.rd ? x.rd : wr)) & (LV_WORDS - 1);
        if (!x.rd || dist > LV_WORDS - 512) dist = std::min<uint32_t>(1024, LV_WORDS - 512); // (first, or left behind: the newest)
        for (uint32_t at = LV_RING + ((wr - dist - LV_RING) & (LV_WORDS - 1)); at != wr; at = LV_RING + ((at + 2 - LV_RING) & (LV_WORDS - 1))) {
            const int32_t val = int32_t(yw(ds, at));
            const uint32_t r0 = yw(ds, LV_RING + ((at + 1 - LV_RING) & (LV_WORDS - 1)));
            if (val < 256 || val > 7936 || !lv_voice(r0)) continue;
            const uint32_t id = uint32_t(i) << 24 | r0;
            lv.voices[id].value = val;
            n[id]++;
        }
        x.rd = wr;
    }
    const int k = lv.tick++ % 10;
    const LiveVoice *last = nullptr; // the voice that began to sound last
    uint32_t lastId = 0;
    for (auto &e : lv.voices) {
        LiveVoice &v = e.second;
        const auto c = n.find(e.first);
        v.sum -= v.cnt[k];
        v.cnt[k] = uint8_t(std::min(255, c == n.end() ? 0 : c->second));
        v.sum += v.cnt[k];
        const bool act = v.sum >= 10;
        if (act && !v.active) v.since = now;
        v.active = act;
        if (act && (!last || v.since > last->since)) last = &v, lastId = e.first;
    }
    if (lv.judging && now - lv.noteAt >= 80000) {
        lv.judging = false;
        int32_t most = 8; // (a move smaller than this, under a seventh of a knob step, is no note's)
        for (auto &e : lv.voices) {
            const LiveVoice &v = e.second;
            if (!v.active) continue;
            const int32_t moved = v.wasActive ? std::abs(v.value - v.before) : 1 << 20; // a voice that began now
            if (moved > most) most = moved, lv.newest = e.first;
        }
    }
    static const bool logIt = getenv("PUNG_LIVE_LOG") != nullptr; // (the voices twice a second, for a test)
    if (logIt && lv.tick % 50 == 0) {
        std::string t;
        char b[64];
        for (auto &e : lv.voices) {
            snprintf(b, sizeof(b), " %c%x:%d/%d%s", char('A' + (e.first >> 24)), unsigned(e.first & 0xffffff), e.second.value, e.second.sum,
                     e.second.active ? "*" : "");
            t += b;
        }
        plog("live: newest %c%x;%s", char('A' + (lv.newest >> 24)), unsigned(lv.newest & 0xffffff), t.c_str());
    }
    const auto nv = lv.voices.find(lv.newest);
    const LiveVoice *pick = nv != lv.voices.end() && nv->second.active ? &nv->second : last;
    if (!pick) return; // nothing sounds
    if (pick == last) lv.newest = lastId;
    L->liveCut.store(pick->value, std::memory_order_relaxed);
    L->liveAt.store(int32_t(uint32_t(now / 1000)), std::memory_order_release);
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
    Live live;
    lv_init(live, *device);
    // While a dump waits for the ring to be deep, what the plugin sends after
    // it waits too, and follows it in order: a knob turned just after a sound
    // loads reached the synth first, and the older dump then undid it
    // (2026-11-24: preset=17 cutoff=40 sounded as cutoff=90). A newer dump
    // supersedes the knobs held for the one before (it already has them: the
    // plugin's sound is changed before a knob's byte is sent); notes stay.
    std::vector<std::vector<uint8_t>> held;
    oshm::Cold cold;
    auto play = [&](const std::vector<uint8_t> &e) {
        if (e.size() > 2 && (e[0] & 0xf0) == 0x90 && e[2] > 0) {
            cold.note_on(now_us());
            lv_note(live, now_us());
            L->noteWr.store(L->wr.load(std::memory_order_relaxed), std::memory_order_relaxed);
        }
        synthLib::SMidiEvent ev = to_event(e);
        plugin->addMidiEvent(ev);
    };
    auto drain = [&](bool playing) {
        uint8_t kind;
        while (oshm::take(L, kind, entry)) {
            if (kind == oshm::DUMP) {
                sound = entry;
                dumpPending = true;
                held.erase(std::remove_if(held.begin(), held.end(),
                                          [](const std::vector<uint8_t> &e) { return !e.empty() && e[0] == 0xf0; }),
                           held.end());
            } else if (playing) {
                if (dumpPending) held.push_back(entry);
                else play(entry);
            }
        }
    };
    auto send_sound = [&] {
        if (sound.empty()) return;
        synthLib::SMidiEvent ev = to_event(sound);
        plugin->addMidiEvent(ev);
        dumpPending = false;
        cold.sound();
        for (const auto &e : held) play(e);
        held.clear();
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
    int64_t deepUntil = 0, liveAt = 0;
    // One block from the emulator into the ring. drop: a block of silence is
    // thrown away instead (true: it was), see "waking" below.
    auto cpu_us = [] { // the whole engine's processor time, every thread of it
        timespec ts;
        clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &ts);
        return int64_t(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
    };
    auto block = [&](bool drop) -> bool {
        const int64_t t0 = now_us(), c0 = cpu_us();
        for (auto &b : buf) memset(b, 0, sizeof(b));
        plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
        midiOut.clear();
        plugin->getMidiOut(midiOut);
        const float g = float(L->gain.load(std::memory_order_relaxed)) * 0.01f * 0.5f * 32767.0f;
        if (drop) {
            float loud = 0;
            for (int i = 0; i < BLOCK; i++) loud = std::max(loud, std::max(fabsf(buf[0][i]), fabsf(buf[1][i])));
            if (loud * g < 2.5f) return true; // silence (within 2 of 32768, as the plugin's rest)
        }
        const uint32_t w = L->wr.load(std::memory_order_relaxed);
        for (int i = 0; i < BLOCK; i++) {
            const uint32_t k = (w + uint32_t(i)) & (oshm::RING - 1);
            L->ring[k * 2] = int16_t(lrintf(soft_limit(buf[0][i] * g)));
            L->ring[k * 2 + 1] = int16_t(lrintf(soft_limit(buf[1][i] * g)));
        }
        L->wr.store(w + BLOCK, std::memory_order_release);
        const uint32_t us = uint32_t(now_us() - t0);
        cold.block(us, t0);
        L->blockUs.store(us, std::memory_order_relaxed);
        if (us > L->blockMaxUs.load(std::memory_order_relaxed)) {
            L->blockMaxUs.store(us, std::memory_order_relaxed);
            L->blockMaxCpuUs.store(uint32_t(cpu_us() - c0), std::memory_order_relaxed);
        }
        return false;
    };
    bool rested = false;
    while (!L->quit.load(std::memory_order_relaxed)) {
        if (getppid() != parent) break; // (PDEATHSIG covers it; this is in case)
        drain(true);
        // Waking. At rest the emulated Virus stands with more audio rendered
        // ahead than it keeps while it is played (its own buffers fill while
        // nobody takes from them), all of it silence, and the note that ends
        // the rest sounds behind it: 3.5 ms later than a note into the synth
        // awake, with the ring equally far ahead both times (note_lead: 320
        // frames in both). So the surplus is taken out here, before the ring
        // is read again: WAKE_DROP blocks of the emulator's silence are
        // thrown away (31 wakings, no underrun).
        // A block that is not silence is kept and ends it: nothing that
        // sounds is ever dropped.
        if (rested && !L->rest.load(std::memory_order_acquire)) {
            rested = false;
            L->wakes.fetch_add(1, std::memory_order_relaxed);
            for (int i = 0; i < WAKE_DROP && !L->quit.load(std::memory_order_relaxed); i++) {
                if (!block(true)) break;
                L->dropped.fetch_add(1, std::memory_order_relaxed);
            }
            drain(true);
        }
        uint32_t fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
        if (dumpPending && fill >= uint32_t(AHEAD_DUMP)) {
            send_sound();
            deepUntil = now_us() + 2500000;
        }
        const int64_t tnow = now_us(), miss = L->missAt.load(std::memory_order_relaxed);
        const bool deep = dumpPending || tnow < deepUntil || (miss && tnow - miss < MISS_DEEP_US);
        const uint32_t target = cold.deep(tnow) ? uint32_t(oshm::AHEAD_COLD) : deep ? uint32_t(AHEAD_DUMP) : uint32_t(AHEAD);
        while (fill < target && !L->quit.load(std::memory_order_relaxed)) {
            block(false);
            fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
            drain(true); // notes arrive while the ring fills
        }
        // at rest (ostirus_plugin.cpp): the ring is full again and nobody
        // reads it; wait for an entry, and read nothing from the emulator
        // meanwhile. (A sound waiting for the ring to be deep is not at rest:
        // nothing rests within the rest time of anything sent.)
        if (!dumpPending && oshm::rest_wait(L)) {
            rested = true;
            continue;
        }
        if (const int64_t t = now_us(); t - liveAt >= 10000) {
            liveAt = t;
            lv_tick(live, t);
            const uint32_t took = uint32_t(now_us() - t);
            if (took > L->tickMaxUs.load(std::memory_order_relaxed)) L->tickMaxUs.store(took, std::memory_order_relaxed);
        }
        timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 2000000;
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec++;
            ts.tv_nsec -= 1000000000;
        }
        const int64_t w0 = now_us();
        sem_timedwait(&L->wake, &ts);
        const uint32_t waited = uint32_t(now_us() - w0);
        if (waited > L->waitMaxUs.load(std::memory_order_relaxed)) L->waitMaxUs.store(waited, std::memory_order_relaxed);
    }
    // no teardown: the process ends, and the emulator's threads with it
    _exit(0);
}
