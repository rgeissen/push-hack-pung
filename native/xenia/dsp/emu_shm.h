// emu_shm.h: what a native module's plugin (dsp.so, inside Pung) and its
// engine (the emulator, a process of its own) share. Identical copies in
// native/nodalred/dsp, native/vavra/dsp and native/xenia/dsp (edit one, copy,
// cmp), as waldorf_engine.cpp is shared.
//
// The emulator runs in the engine: a hung or crashed emulator then never
// holds Pung (emulators hung Pung while booting or shutting down, four times
// in a week, 2026-11). The plugin keeps the sound and talks to the engine
// through two queues: MIDI and dumps to it, what the synth sends back from
// it. The engine renders into the ring render_block reads. One memory file,
// made by the plugin (memfd_create) and handed to the engine as its file
// descriptor 3. (OsTIrus, the first, has its own: ostirus_shm.h.)
#pragma once

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <semaphore.h>

namespace eshm {

const uint32_t MAGIC = 0x454d5531; // "EMU1"
const uint32_t VERSION = 2;

const int RING = 4096;      // stereo frames, a power of two
const int QUEUE = 1 << 16;  // bytes a queue holds
const int BLOB = 1 << 20;   // what an engine reads from its emulator for the screens

enum Phase : int32_t {
    STARTING = 0, // the engine not up yet
    BOOTING,      // the emulator booting
    WARMING,      // warming up (an engine that plays a chord unheard first)
    RUNNING,      // playing
    FAILED,       // it did not start (error says why)
};

// A queue entry: [u16 length][u8 kind][bytes], wrapping. An event is one MIDI
// message (a sysex with its F0 and F7, or three bytes).
enum Kind : uint8_t { EVENT = 0, DUMP = 1 };

struct Queue {
    std::atomic<uint32_t> w, r;
    uint8_t b[QUEUE];
};

struct Layout {
    uint32_t magic, version;

    // set by the plugin before the engine starts
    int32_t model;      // which synth, for an engine that is several
    char romPath[1024]; // the firmware file

    // the plugin's
    std::atomic<int32_t> quit;
    std::atomic<int32_t> gain;      // percent
    std::atomic<int32_t> wantDeep;  // a sound change waits: render AHEAD_DUMP ahead
    std::atomic<int64_t> deepUntil; // and stay that deep until then (CLOCK_MONOTONIC us)
    std::atomic<int64_t> missAt;    // the last underrun (us), from render_block
    Queue toEngine;
    sem_t wake; // posted by render_block (the ring was read) and with every entry

    // the engine's
    std::atomic<int32_t> phase;
    std::atomic<uint32_t> textSeq; // odd while status and error are being written
    char status[160];
    char error[200];
    std::atomic<uint32_t> blockUs, blockMaxUs;
    Queue fromEngine; // what the synth sent (sysex): answers to the plugin's requests
    std::atomic<uint32_t> blobSeq; // odd while blob is being written (put_blob, get_blob)
    uint8_t blob[BLOB];

    // a module's own signals, both ways (what each means: the module's engine says)
    std::atomic<int32_t> aux[8];

    // the audio: the engine writes, render_block reads
    std::atomic<uint32_t> wr, rd;
    int16_t ring[RING * 2];
};

// A queue's writer: one at a time (the plugin's under a lock of its own).
// false: full, the entry is dropped.
inline bool put(Queue &q, uint8_t kind, const uint8_t *b, size_t n) {
    if (n == 0 || n > 0xffff) return false;
    const uint32_t w = q.w.load(std::memory_order_relaxed), r = q.r.load(std::memory_order_acquire);
    if (QUEUE - (w - r) < n + 3) return false;
    const uint8_t hdr[3] = {uint8_t(n & 0xff), uint8_t(n >> 8), kind};
    for (size_t i = 0; i < 3; i++) q.b[(w + i) & (QUEUE - 1)] = hdr[i];
    for (size_t i = 0; i < n; i++) q.b[(w + 3 + i) & (QUEUE - 1)] = b[i];
    q.w.store(w + uint32_t(n + 3), std::memory_order_release);
    return true;
}

// A queue's reader: the next entry, or false.
template <class Vec> inline bool take(Queue &q, uint8_t &kind, Vec &out) {
    const uint32_t r = q.r.load(std::memory_order_relaxed), w = q.w.load(std::memory_order_acquire);
    if (w == r) return false;
    const size_t n = size_t(q.b[r & (QUEUE - 1)]) | size_t(q.b[(r + 1) & (QUEUE - 1)]) << 8;
    kind = q.b[(r + 2) & (QUEUE - 1)];
    out.resize(n);
    for (size_t i = 0; i < n; i++) out[i] = q.b[(r + 3 + i) & (QUEUE - 1)];
    q.r.store(r + uint32_t(n + 3), std::memory_order_release);
    return true;
}

inline void clear(Queue &q) {
    q.w.store(0, std::memory_order_relaxed);
    q.r.store(0, std::memory_order_relaxed);
}

// The blob, written by the engine, read by the plugin whole: its bytes and
// the sequence they were written under (seq even), or false while written.
inline void put_blob(Layout *l, const uint8_t *b, size_t n) {
    if (n > size_t(BLOB)) n = BLOB;
    l->blobSeq.fetch_add(1, std::memory_order_acq_rel);
    memcpy(l->blob, b, n);
    l->blobSeq.fetch_add(1, std::memory_order_acq_rel);
}

template <class Vec> inline bool get_blob(const Layout *l, Vec &out, size_t n, uint32_t &seq) {
    const uint32_t a = l->blobSeq.load(std::memory_order_acquire);
    if (a & 1) return false;
    out.assign(l->blob, l->blob + (n > size_t(BLOB) ? size_t(BLOB) : n));
    if (l->blobSeq.load(std::memory_order_acquire) != a) return false;
    seq = a;
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

} // namespace eshm
