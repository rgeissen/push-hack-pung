// ostirus_shm.h: what the plugin (dsp.so, inside Pung) and the engine
// (ostirus-engine, a process of its own) share.
//
// The emulator runs in the engine: a hung or crashed emulator then never
// holds Pung (it hung Pung while booting or destroying an instance, four times
// in a week, 2026-11). The plugin keeps the sound (the single, the firmware's
// names, the state) and sends the engine MIDI and sound dumps through a queue;
// the engine renders into the ring render_block reads, as the emulator thread
// did in the plugin before. One memory file, made by the plugin
// (memfd_create) and handed to the engine as its file descriptor 3.
#pragma once

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <semaphore.h>
#include <time.h>

namespace oshm {

const uint32_t MAGIC = 0x4f535449; // "OSTI"
const uint32_t VERSION = 4; // 2: the live cutoff (liveCut, liveAt, liveHook); 3: rest; 4: what a slow block was

const int RING = 4096;  // stereo frames, a power of two
const int QUEUE = 1 << 16; // bytes of MIDI and dumps waiting for the engine
const int TABDATA = 4 << 20; // the firmware's wavetables as read (Layout::tab)
const int TABLES = 100;

enum Phase : int32_t {
    STARTING = 0, // the engine not up yet
    BOOTING,      // the emulator booting
    WARMING,      // the warm-up chord
    RUNNING,      // playing
    FAILED,       // it did not start (error says why)
};

// A queue entry: kind, then the bytes. An event is one MIDI message (a sysex
// with its F0 and F7); a dump is the sound, sent when the ring is deep enough
// (AHEAD_DUMP) and kept by the engine to send again after a warm-up.
enum Kind : uint8_t { EVENT = 0, DUMP = 1 };

struct Layout {
    uint32_t magic, version;

    // set by the plugin before the engine starts
    int32_t model;       // 0 TI, 1 TI2, 2 Snow
    char romPath[1024];  // the firmware file

    // the plugin's
    std::atomic<int32_t> quit;
    std::atomic<int32_t> gain;    // percent
    std::atomic<int64_t> missAt;  // the last underrun (CLOCK_MONOTONIC us), from render_block
    // 1: nobody hears the synth and render_block reads no ring
    // (ostirus_plugin.cpp, "Rest"); the engine waits for an entry (rest_wait)
    std::atomic<int32_t> rest;
    // the newest note-on: where the ring's reader was when the plugin got it
    // (noteRd), and its writer when the engine gave it to the synth (noteWr):
    // the frames of ring the note sounds behind (debug_info: note_lead)
    std::atomic<uint32_t> noteRd, noteWr;
    std::atomic<uint32_t> wakes, dropped; // rests ended, and blocks of silence dropped as they did (debug_info)
    std::atomic<uint32_t> qw, qr; // the queue: [u16 length][u8 kind][bytes], wrapping
    uint8_t q[QUEUE];
    sem_t wake; // posted by render_block (the ring was read) and with every entry

    // the engine's
    std::atomic<int32_t> phase;
    std::atomic<uint32_t> textSeq; // odd while status and error are being written
    char status[160];
    char error[200];
    std::atomic<uint32_t> blockUs, blockMaxUs;
    // what stood behind the slowest moments since debug_info was read last:
    // the processor time the whole engine took during the slowest block (far
    // above the block's own time: the emulator worked, as when it compiles
    // code it runs for the first time; far below: it waited for a processor),
    // the longest reading of the live cutoff between two blocks, and the
    // longest the engine's thread slept past the 2 ms it asked for
    std::atomic<uint32_t> blockMaxCpuUs, tickMaxUs, waitMaxUs;
    std::atomic<int32_t> tables; // 0 not read yet, 1 read (tab), 2 none found in this firmware
    // Where the newest voice has Filter 1's cutoff now (Pung's live_mod): the
    // value the DSP's program works out for it, LFOs, envelope and keytrack in
    // it (256 + 7680 c, c 0..1; the knob k alone is 1361 + 60 k), from a hook
    // in the program (ostirus_engine.cpp, live cutoff). liveAt: when it was
    // published (CLOCK_MONOTONIC ms, read with wrap); liveHook: 0 not yet, 1 in,
    // -1 a program it was not measured on (no live cutoff).
    std::atomic<int32_t> liveCut, liveAt, liveHook;
    // per table 1..99: u16 harmonics, u16 waves, then harmonics*waves bytes
    // (table 0 is the sine, computed by the DSP: not here)
    uint8_t tab[TABDATA];

    // the audio: the engine writes, render_block reads
    std::atomic<uint32_t> wr, rd;
    int16_t ring[RING * 2];
};

// The queue's writer (the plugin, under its own lock: on_midi and set_param
// come from different threads). false: full, the entry is dropped.
inline bool put(Layout *l, uint8_t kind, const uint8_t *b, size_t n) {
    if (n == 0 || n > 0xffff) return false;
    const uint32_t w = l->qw.load(std::memory_order_relaxed), r = l->qr.load(std::memory_order_acquire);
    if (QUEUE - (w - r) < n + 3) return false;
    const uint8_t hdr[3] = {uint8_t(n & 0xff), uint8_t(n >> 8), kind};
    for (size_t i = 0; i < 3; i++) l->q[(w + i) & (QUEUE - 1)] = hdr[i];
    for (size_t i = 0; i < n; i++) l->q[(w + 3 + i) & (QUEUE - 1)] = b[i];
    l->qw.store(w + uint32_t(n + 3), std::memory_order_release);
    sem_post(&l->wake);
    return true;
}

// The queue's reader (the engine): the next entry, or false.
template <class Vec> inline bool take(Layout *l, uint8_t &kind, Vec &out) {
    const uint32_t r = l->qr.load(std::memory_order_relaxed), w = l->qw.load(std::memory_order_acquire);
    if (w == r) return false;
    const size_t n = size_t(l->q[r & (QUEUE - 1)]) | size_t(l->q[(r + 1) & (QUEUE - 1)]) << 8;
    kind = l->q[(r + 2) & (QUEUE - 1)];
    out.resize(n);
    for (size_t i = 0; i < n; i++) out[i] = l->q[(r + 3 + i) & (QUEUE - 1)];
    l->qr.store(r + uint32_t(n + 3), std::memory_order_release);
    return true;
}

// The engine's part of a rest (ostirus_plugin.cpp, "Rest"), called once its
// ring is full: true when the synth rests, after waiting for an entry (posted
// with the wake semaphore) or a second, whichever is first; the engine then
// goes round its loop again and reads nothing from the emulator. false: awake.
inline bool rest_wait(Layout *l) {
    if (!l->rest.load(std::memory_order_acquire) || l->qw.load(std::memory_order_acquire) != l->qr.load(std::memory_order_acquire))
        return false;
    timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_sec += 1; // (the engine looks for its parent each time round)
    sem_timedwait(&l->wake, &ts);
    return true;
}

// status and error, written by the engine, read by the plugin whole
inline void set_text(Layout *l, const char *status, const char *error) {
    l->textSeq.fetch_add(1, std::memory_order_acq_rel);
    if (status) snprintf(l->status, sizeof(l->status), "%s", status);
    if (error) snprintf(l->error, sizeof(l->error), "%s", error);
    l->textSeq.fetch_add(1, std::memory_order_acq_rel);
}

inline void get_text(const Layout *l, char *status, size_t ns, char *error, size_t ne) {
    for (int tries = 0; tries < 100; tries++) {
        const uint32_t a = l->textSeq.load(std::memory_order_acquire);
        if (a & 1) continue;
        snprintf(status, ns, "%s", l->status);
        snprintf(error, ne, "%s", l->error);
        if (l->textSeq.load(std::memory_order_acquire) == a) return;
    }
}

// Cold: an engine that has not yet played the sound it holds. The emulator
// compiles the synth's code the first time it runs it, and the first notes of
// a sound it had not played underran the ring while it did: a freshly started
// Vavra ten and six times on the first chord of a new sound with the ring
// AHEAD deep; OsTIrus once, two seconds after its start, and not again in
// twenty minutes of playing, its slowest block then all work and no waiting
// (measured 2026-11-25). So the ring stays deep from a start or a new sound
// until the first notes are through: a second and a half after the first of
// them with no slow block, eight seconds at most. AHEAD_DUMP was not always
// enough (a fresh Vavra: two underruns on one first chord in four, single
// blocks of up to 33 ms), so a cold ring is AHEAD_COLD deep: ten cold starts,
// no underrun. Those first notes sound that much later (36 ms); every note
// after them as always.
//
// Not every synth needs it: a fresh Xenia's and Nodal Red's first chords of
// three new sounds each had no slow block at all (0.4 and 1.9 ms at most).
// So an engine finds out: when the first notes of its first three sounds go
// by with no slow block it is never cold again; one slow block among first
// notes, and it is cold with every new sound for as long as it runs.
const int AHEAD_COLD = 1920; // 44 ms
struct Cold {
    bool cold = true;
    bool needed = false, off = false; // a slow block among first notes; three sounds' first notes without one
    bool hit = false;
    int calm = 0;
    int64_t note = 0, slow = 0;
    void sound() { // a new sound (or the start): nothing of it is compiled yet
        if (off) return;
        cold = true;
        hit = false;
        note = 0;
    }
    void note_on(int64_t now) {
        if (cold && !note) note = now;
    }
    void block(uint32_t us, int64_t now) {
        if (us <= 3000) return;
        slow = now;
        if (cold && note) hit = true;
    }
    bool deep(int64_t now) { // the ring is to be deep
        if (cold && note && ((now - note > 1500000 && now - slow > 1500000) || now - note > 8000000)) {
            cold = false;
            if (hit) needed = true;
            else if (!needed && ++calm >= 3) off = true;
        }
        return cold;
    }
};

} // namespace oshm
