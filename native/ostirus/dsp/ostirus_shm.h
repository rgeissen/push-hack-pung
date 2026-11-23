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

namespace oshm {

const uint32_t MAGIC = 0x4f535449; // "OSTI"
const uint32_t VERSION = 1;

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
    std::atomic<uint32_t> qw, qr; // the queue: [u16 length][u8 kind][bytes], wrapping
    uint8_t q[QUEUE];
    sem_t wake; // posted by render_block (the ring was read) and with every entry

    // the engine's
    std::atomic<int32_t> phase;
    std::atomic<uint32_t> textSeq; // odd while status and error are being written
    char status[160];
    char error[200];
    std::atomic<uint32_t> blockUs, blockMaxUs;
    std::atomic<int32_t> tables; // 0 not read yet, 1 read (tab), 2 none found in this firmware
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

} // namespace oshm
