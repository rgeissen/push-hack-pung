/* rtloop.c: a device's blocks on a realtime thread of its own (rtloop.h). */
#define _GNU_SOURCE
#include "rtloop.h"

#include "bridge.h"
#include "livedevice_ipc.h"

#include <limits.h>
#include <linux/futex.h>
#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define PAR_RING 1024    /* parameter changes, either way */
#define MIDI_Q 1024      /* MIDI messages, either way */
#define AUDIO_RING 16384 /* stereo frames for the screens: 370 ms */
#define PREV_RING 8192   /* stereo frames of preview */
#define HELD 256
/* how long a block waits for the chain's lock. Live waits half a block
 * (1.45 ms at 128 frames) from its request; the lock's holder is lifted to
 * this thread's priority meanwhile (bridge.c), so a wait this long is a
 * holder in a long call. */
#define LOCK_WAIT_NS 500000
/* Host rest (rt_set_rest): an instrument whose module is built for a host
 * that stops rendering it in silence, as Schwung's own does on Move
 * (schwung_shim.c: idle after a second within 4 LSB, a look twice a second).
 * Pung waits the governor's rest time, and for no key to be down. */
#define REST_LEVEL (4.0f / 32768.0f)
#define REST_PROBE 22050 /* frames between two looks at a rested module */
#define RT_SLOTS 64

/* rt_rest_before: whether this block is rendered. busy: something was sent
 * to the module, a key is down, or it does not rest at all. A rested module
 * is looked at every REST_PROBE frames. */
int rt_rest_before(rt_rest_t *r, int busy, int frames) {
    if (busy) r->quiet = 0, r->resting = 0;
    if (!r->resting) return 1;
    r->probe += frames;
    if (r->probe < REST_PROBE) return 0;
    r->probe = 0;
    return 1;
}

/* rt_rest_after: a rendered block's peak. A block that sounds ends a rest
 * and the count of silence; rest_after frames of silence begin one (1: it
 * just did). */
int rt_rest_after(rt_rest_t *r, int busy, float pk, int frames, int rest_after) {
    if (pk > REST_LEVEL) {
        r->quiet = 0, r->resting = 0;
        return 0;
    }
    if (busy || r->resting || rest_after <= 0) return 0;
    r->quiet += frames;
    if (r->quiet < rest_after) return 0;
    r->resting = 1, r->probe = 0;
    return 1;
}

/* what Go did to a slot's module (a parameter, a sound): it wakes a rested one */
static _Atomic uint32_t rt_touched[RT_SLOTS];
void rt_touch_slot(int slot) {
    if (slot >= 0 && slot < RT_SLOTS) atomic_fetch_add_explicit(&rt_touched[slot], 1, memory_order_relaxed);
}

typedef struct {
    uint32_t idx;
    float norm;
} par_t;

struct rtloop {
    int slot, kind, in_ch;
    uint8_t *mem;
    uint32_t last; /* the block counter as rt_start read it */
    pthread_t th;
    int running;
    _Atomic int quit;
    _Atomic int out_ch, midifx;

    /* this thread's own */
    uint8_t down[16][128]; /* the key guard: keys down, as the chain heard them */
    int held_n;
    uint8_t held[HELD][3];
    int clk_playing;
    long long clk_tick;
    int keys;            /* keys down, of down[][] */
    int midi_now;        /* this block carried a message for the chain (not a clock tick) */
    rt_rest_t rest;      /* host rest (rt_set_rest) */
    uint32_t touch_seen;
    _Atomic int rest_frames; /* silence after which the module is not rendered; 0: never */
    _Atomic int resting;
    _Atomic uint32_t rests;
    int64_t last_t0;
    float out[LD_IPC_MAXF * 2], in[LD_IPC_MAXF * 2];
    uint8_t mbuf[1024];

    /* to Go */
    par_t par[PAR_RING];
    _Atomic unsigned par_w, par_r;
    uint32_t ui[MIDI_Q];
    _Atomic unsigned ui_w, ui_r;
    float aud[AUDIO_RING * 2];
    _Atomic unsigned aud_w, aud_r;
    _Atomic uint32_t meter; /* float bits */
    _Atomic uint64_t t_bpm, t_beat;
    _Atomic int t_playing;
    _Atomic uint32_t t_seq;

    /* from Go */
    par_t rep[PAR_RING];
    _Atomic unsigned rep_w, rep_r;
    uint32_t gom[MIDI_Q];
    _Atomic unsigned gom_w, gom_r;
    float prev[PREV_RING * 2];
    _Atomic unsigned prev_w, prev_r;
    _Atomic int prev_stop;

    _Atomic uint64_t blocks, notes_in, notes_out, skipped, held_sent, rekeyed, preview_frames;
    _Atomic int64_t proc_max, gap_max, acq_max, render_max;
    _Atomic int64_t render_sum; /* all the time spent in the module's render */
    _Atomic uint32_t out_peak, in_peak; /* float bits */
};

/* ---- small things ------------------------------------------------------- */

static inline int64_t now_ns(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}
static inline void keep_max(_Atomic int64_t *m, int64_t v) {
    if (v > atomic_load_explicit(m, memory_order_relaxed)) atomic_store_explicit(m, v, memory_order_relaxed);
}
static inline uint32_t *u32(uint8_t *mem, int off) { return (uint32_t *)(mem + off); }
static inline float *f32(uint8_t *mem, int off) { return (float *)(mem + off); }
static inline uint32_t fbits(float f) {
    uint32_t u;
    memcpy(&u, &f, 4);
    return u;
}
static inline float bitsf(uint32_t u) {
    float f;
    memcpy(&f, &u, 4);
    return f;
}

/* shared futexes: the plugin is another process */
static void futex_wait(uint32_t *a, uint32_t v, long ns) {
    struct timespec ts = {ns / 1000000000L, ns % 1000000000L};
    syscall(SYS_futex, a, FUTEX_WAIT, v, &ts, NULL, 0);
}
static void futex_wake(uint32_t *a) { syscall(SYS_futex, a, FUTEX_WAKE, INT_MAX, NULL, NULL, 0); }

static uint32_t pack(const uint8_t *m, int len) {
    uint32_t p = (uint32_t)len & 3;
    for (int i = 0; i < len && i < 3; i++) p |= (uint32_t)m[i] << (8 * (i + 1));
    return p;
}
static int unpack(uint32_t p, uint8_t *m) {
    int len = (int)(p & 3);
    for (int i = 0; i < 3; i++) m[i] = (uint8_t)(p >> (8 * (i + 1)));
    return len;
}

/* ---- MIDI into the chain ------------------------------------------------ */

/* The key guard (keyguard.go): a note-on for a key that is already down
 * gets a note-off in front of it, so a module never counts a key twice. */
static void guard_send(rtloop *rt, const uint8_t *msg, int len) {
    if (len < 1 || msg[0] != 0xF8) rt->midi_now = 1;
    if (len >= 3 && msg[1] <= 127) {
        int ch = msg[0] & 0x0F, key = msg[1];
        switch (msg[0] & 0xF0) {
        case 0x90:
            if (msg[2] == 0) {
                rt->keys -= rt->down[ch][key];
                rt->down[ch][key] = 0;
                break;
            }
            if (rt->down[ch][key]) {
                uint8_t off[3] = {(uint8_t)(0x80 | ch), (uint8_t)key, 0};
                sb_midi_nolock(rt->slot, off, 3, 0);
                atomic_fetch_add_explicit(&rt->rekeyed, 1, memory_order_relaxed);
            } else {
                rt->keys++;
            }
            rt->down[ch][key] = 1;
            break;
        case 0x80:
            rt->keys -= rt->down[ch][key];
            rt->down[ch][key] = 0;
            break;
        case 0xB0:
            if (key == 120 || key == 123) {
                for (int k = 0; k < 128; k++) rt->keys -= rt->down[ch][k];
                memset(rt->down[ch], 0, 128);
            }
            break;
        }
    }
    sb_midi_nolock(rt->slot, msg, len, 0);
}

static void ui_push(rtloop *rt, const uint8_t *msg, int len) {
    unsigned w = atomic_load_explicit(&rt->ui_w, memory_order_relaxed);
    if (w - atomic_load_explicit(&rt->ui_r, memory_order_acquire) >= MIDI_Q) return; /* Go is behind: the screens miss it */
    rt->ui[w & (MIDI_Q - 1)] = pack(msg, len);
    atomic_store_explicit(&rt->ui_w, w + 1, memory_order_release);
}

/* a message from Live: the screens see it as it came; the chain gets it on
 * the device's channel, through the key guard */
static void deliver(rtloop *rt, const uint8_t *msg, int len) {
    ui_push(rt, msg, len);
    uint8_t m[3] = {0, 0, 0};
    memcpy(m, msg, (size_t)len);
    if (rt->in_ch >= 0 && m[0] >= 0x80 && m[0] < 0xF0) m[0] = (uint8_t)((m[0] & 0xF0) | rt->in_ch);
    guard_send(rt, m, len);
}

/* Notes of a block that could not run, for the next one that can (heldMidi
 * in devices.go): note-ons, note-offs and the controllers that end notes. */
static void held_keep(rtloop *rt, const uint8_t *msg, int len) {
    if (len < 3) return;
    int st = msg[0] & 0xF0;
    if (!(st == 0x80 || st == 0x90 || (st == 0xB0 && (msg[1] == 64 || msg[1] == 120 || msg[1] == 123)))) return;
    if (rt->held_n == HELD) {
        /* full: a note-off is never the one to go; the oldest note-on makes room */
        if (!(st == 0x80 || (st == 0x90 && msg[2] == 0))) return;
        for (int i = 0; i < rt->held_n; i++) {
            if ((rt->held[i][0] & 0xF0) == 0x90 && rt->held[i][2] > 0) {
                memmove(rt->held[i], rt->held[i + 1], (size_t)(rt->held_n - i - 1) * 3);
                rt->held_n--;
                break;
            }
        }
        if (rt->held_n == HELD) return;
    }
    memcpy(rt->held[rt->held_n++], msg, 3);
}

static int is_on(const uint8_t *m) { return (m[0] & 0xF0) == 0x90 && m[2] > 0; }
static int is_off(const uint8_t *m) { return (m[0] & 0xF0) == 0x80 || ((m[0] & 0xF0) == 0x90 && m[2] == 0); }

/* A note that began and ended while nothing ran is left out whole. */
static void held_flush(rtloop *rt) {
    if (rt->held_n == 0) return;
    uint8_t gone[HELD] = {0};
    for (int i = 0; i < rt->held_n; i++) {
        if (!is_on(rt->held[i])) continue;
        for (int j = i + 1; j < rt->held_n; j++) {
            if (!gone[j] && is_off(rt->held[j]) && (rt->held[j][0] & 0x0F) == (rt->held[i][0] & 0x0F) &&
                rt->held[j][1] == rt->held[i][1]) {
                gone[i] = gone[j] = 1;
                break;
            }
        }
    }
    uint64_t sent = 0;
    for (int i = 0; i < rt->held_n; i++) {
        if (gone[i]) continue;
        deliver(rt, rt->held[i], 3);
        sent++;
    }
    rt->held_n = 0;
    atomic_fetch_add_explicit(&rt->held_sent, sent, memory_order_relaxed);
}

/* MIDI clock for a MIDI effect, from Live's own beat (devices.go Process) */
static void midi_clock(rtloop *rt, int playing, double beat) {
    static const uint8_t start = 0xFA, tick = 0xF8, stop = 0xFC;
    long long t = (long long)floor(beat * 24);
    if (playing && !rt->clk_playing) {
        guard_send(rt, &start, 1);
        guard_send(rt, &tick, 1);
    } else if (!playing && rt->clk_playing) {
        guard_send(rt, &stop, 1);
    } else if (playing) {
        long long n = t - rt->clk_tick;
        if (n < 0 || n > 48) { /* the song position jumped: from the top again */
            guard_send(rt, &stop, 1);
            guard_send(rt, &start, 1);
            guard_send(rt, &tick, 1);
        } else {
            for (; n > 0; n--) guard_send(rt, &tick, 1);
        }
    }
    rt->clk_playing = playing;
    rt->clk_tick = t;
}

/* ---- one block ---------------------------------------------------------- */

static void peak(rtloop *rt, _Atomic uint32_t *dst, const float *l, const float *r, int n) {
    float p = 0;
    for (int i = 0; i < n; i++) {
        float a = fabsf(l[i]), b = fabsf(r[i]);
        if (a > p) p = a;
        if (b > p) p = b;
    }
    float old = bitsf(atomic_load_explicit(dst, memory_order_relaxed));
    if (atomic_load_explicit(&rt->blocks, memory_order_relaxed) % 344 == 0) old = 0;
    atomic_store_explicit(dst, fbits(p > old ? p : old), memory_order_relaxed);
}

static void block(rtloop *rt) {
    uint8_t *mem = rt->mem;
    int64_t t0 = now_ns();
    if (rt->last_t0) keep_max(&rt->gap_max, t0 - rt->last_t0);
    rt->last_t0 = t0;
    rt->midi_now = 0;

    int frames = (int)*u32(mem, LD_OFF_FRAMES);
    if (frames < 0 || frames > LD_IPC_MAXF) frames = 0;
    uint32_t flags = *u32(mem, LD_OFF_FLAGS);
    int tvalid = (flags & 2) != 0, playing = (flags & 1) != 0;
    double bpm, beat;
    memcpy(&bpm, mem + LD_OFF_BPM, 8);
    memcpy(&beat, mem + LD_OFF_BEAT, 8);
    float *outL = f32(mem, LD_OFF_OUT_L), *outR = f32(mem, LD_OFF_OUT_R);
    memset(outL, 0, sizeof(float) * (size_t)frames);
    memset(outR, 0, sizeof(float) * (size_t)frames);
    int n_out = 0, n_outpar = 0;

    if (tvalid) {
        uint64_t b;
        memcpy(&b, &bpm, 8);
        atomic_store_explicit(&rt->t_bpm, b, memory_order_relaxed);
        memcpy(&b, &beat, 8);
        atomic_store_explicit(&rt->t_beat, b, memory_order_relaxed);
        atomic_store_explicit(&rt->t_playing, playing, memory_order_relaxed);
        atomic_fetch_add_explicit(&rt->t_seq, 1, memory_order_release);
        sb_set_tempo((float)bpm);
        sb_set_clock(playing ? 2 : 1, playing ? beat : -1);
    }

    /* Live's parameter changes go to Go whatever happens to the block */
    int npar = (int)*u32(mem, LD_OFF_NPAR);
    if (npar > LD_IPC_MAXPAR) npar = LD_IPC_MAXPAR;
    for (int i = 0; i < npar; i++) {
        unsigned w = atomic_load_explicit(&rt->par_w, memory_order_relaxed);
        if (w - atomic_load_explicit(&rt->par_r, memory_order_acquire) >= PAR_RING) break;
        rt->par[w & (PAR_RING - 1)].idx = *u32(mem, LD_OFF_PARAMS + i * 8);
        rt->par[w & (PAR_RING - 1)].norm = *f32(mem, LD_OFF_PARAMS + i * 8 + 4);
        atomic_store_explicit(&rt->par_w, w + 1, memory_order_release);
    }

    int nev = (int)*u32(mem, LD_OFF_NEV);
    if (nev > LD_IPC_MAXEV) nev = LD_IPC_MAXEV;

    /* changes made in Pung, told to Live: they need no chain, so a block
     * that cannot render carries them too (a module loading for seconds) */
    while (n_outpar < LD_IPC_MAXPAR) {
        unsigned r = atomic_load_explicit(&rt->rep_r, memory_order_relaxed);
        if (r == atomic_load_explicit(&rt->rep_w, memory_order_acquire)) break;
        par_t p = rt->rep[r & (PAR_RING - 1)];
        atomic_store_explicit(&rt->rep_r, r + 1, memory_order_release);
        *u32(mem, LD_OFF_OPARAMS + n_outpar * 8) = p.idx;
        *f32(mem, LD_OFF_OPARAMS + n_outpar * 8 + 4) = p.norm < 0 ? 0 : p.norm > 1 ? 1 : p.norm;
        n_outpar++;
    }

    struct timespec dl;
    clock_gettime(CLOCK_REALTIME, &dl);
    dl.tv_nsec += LOCK_WAIT_NS;
    if (dl.tv_nsec >= 1000000000L) {
        dl.tv_sec++;
        dl.tv_nsec -= 1000000000L;
    }
    int64_t ta = now_ns();
    int got = sb_slot_lock_until(rt->slot, &dl) == 0;
    keep_max(&rt->acq_max, now_ns() - ta);
    if (!got) {
        /* a module is loading, or the chain is held: silence, never a long
         * wait; the block's notes wait for the next one */
        atomic_fetch_add_explicit(&rt->skipped, 1, memory_order_relaxed);
        for (int i = 0; i < nev; i++) {
            uint8_t *e = mem + LD_OFF_EVENTS + i * 8;
            int len = e[4];
            if (len < 1 || len > 3) continue;
            if (len == 3 && is_on(e + 5)) atomic_fetch_add_explicit(&rt->notes_in, 1, memory_order_relaxed);
            held_keep(rt, e + 5, len);
        }
        goto finish;
    }

    /* notes from the web page and tests (POST /api/devices/{n}/note) */
    for (;;) {
        unsigned r = atomic_load_explicit(&rt->gom_r, memory_order_relaxed);
        if (r == atomic_load_explicit(&rt->gom_w, memory_order_acquire)) break;
        uint8_t m[3];
        int len = unpack(rt->gom[r & (MIDI_Q - 1)], m);
        atomic_store_explicit(&rt->gom_r, r + 1, memory_order_release);
        if (len < 1) continue;
        ui_push(rt, m, len);
        guard_send(rt, m, len);
    }
    held_flush(rt);
    if (tvalid && (rt->kind == RT_MIDI || atomic_load_explicit(&rt->midifx, memory_order_relaxed)))
        midi_clock(rt, playing, beat);
    for (int i = 0; i < nev; i++) {
        uint8_t *e = mem + LD_OFF_EVENTS + i * 8;
        int len = e[4];
        if (len < 1 || len > 3) continue;
        if (len == 3 && is_on(e + 5)) atomic_fetch_add_explicit(&rt->notes_in, 1, memory_order_relaxed);
        deliver(rt, e + 5, len);
    }

    if (frames > 0) {
        const float *input = NULL;
        if (rt->kind == RT_EFFECT) {
            const float *inL = f32(mem, LD_OFF_IN_L), *inR = f32(mem, LD_OFF_IN_R);
            for (int i = 0; i < frames; i++) {
                rt->in[i * 2] = inL[i];
                rt->in[i * 2 + 1] = inR[i];
            }
            input = rt->in;
            peak(rt, &rt->in_peak, inL, inR, frames);
        }
        /* host rest: a rested module is not rendered, and looked at twice
         * a second; a message, a key down or anything Go did to it wakes it
         * in this block, before its render */
        int rest_after = rt->kind == RT_INSTRUMENT ? atomic_load_explicit(&rt->rest_frames, memory_order_relaxed) : 0;
        uint32_t touch = atomic_load_explicit(&rt_touched[rt->slot & (RT_SLOTS - 1)], memory_order_relaxed);
        /* (a MIDI effect in front of the synth may play by itself, on the
         * clock or not, and only a render runs it: such a device never rests) */
        int busy = rt->midi_now || rt->keys > 0 || touch != rt->touch_seen || rest_after <= 0 ||
                   atomic_load_explicit(&rt->midifx, memory_order_relaxed);
        rt->touch_seen = touch;
        float pk = 0;
        if (rt_rest_before(&rt->rest, busy, frames)) {
            int64_t tr = now_ns();
            pk = sb_render_nolock(rt->slot, rt->out, input, frames);
            int64_t dr = now_ns() - tr;
            keep_max(&rt->render_max, dr);
            atomic_fetch_add_explicit(&rt->render_sum, dr, memory_order_relaxed);
            if (rt_rest_after(&rt->rest, busy, pk, frames, rest_after))
                atomic_fetch_add_explicit(&rt->rests, 1, memory_order_relaxed);
        } else {
            memset(rt->out, 0, sizeof(float) * 2 * (size_t)frames);
        }
        if (rt->rest.resting != atomic_load_explicit(&rt->resting, memory_order_relaxed))
            atomic_store_explicit(&rt->resting, rt->rest.resting, memory_order_relaxed);
        if (pk > bitsf(atomic_load_explicit(&rt->meter, memory_order_relaxed)))
            atomic_store_explicit(&rt->meter, fbits(pk), memory_order_relaxed);
        /* the screens' copy (feedAudio, the capture) */
        unsigned w = atomic_load_explicit(&rt->aud_w, memory_order_relaxed);
        if (AUDIO_RING - (w - atomic_load_explicit(&rt->aud_r, memory_order_acquire)) >= (unsigned)frames) {
            for (int i = 0; i < frames; i++) {
                unsigned k = (w + (unsigned)i) & (AUDIO_RING - 1);
                rt->aud[k * 2] = rt->out[i * 2];
                rt->aud[k * 2 + 1] = rt->out[i * 2 + 1];
            }
            atomic_store_explicit(&rt->aud_w, w + (unsigned)frames, memory_order_release);
        }
        for (int i = 0; i < frames; i++) {
            outL[i] = rt->out[i * 2];
            outR[i] = rt->out[i * 2 + 1];
        }
        /* the file preview (filesession.go): its fades are Go's, a stop's is here */
        unsigned pr = atomic_load_explicit(&rt->prev_r, memory_order_relaxed);
        unsigned pw = atomic_load_explicit(&rt->prev_w, memory_order_acquire);
        int stopping = atomic_load_explicit(&rt->prev_stop, memory_order_acquire);
        int np = (int)(pw - pr) < frames ? (int)(pw - pr) : frames;
        for (int i = 0; i < np; i++) {
            float g = stopping ? 1.0f - (float)i / (float)frames : 1.0f;
            unsigned k = (pr + (unsigned)i) & (PREV_RING - 1);
            outL[i] += rt->prev[k * 2] * g;
            outR[i] += rt->prev[k * 2 + 1] * g;
        }
        if (np > 0) atomic_fetch_add_explicit(&rt->preview_frames, (uint64_t)np, memory_order_relaxed);
        if (stopping) {
            atomic_store_explicit(&rt->prev_r, pw, memory_order_release);
            atomic_store_explicit(&rt->prev_stop, 0, memory_order_release);
        } else {
            atomic_store_explicit(&rt->prev_r, pr + (unsigned)np, memory_order_release);
        }
    }

    /* what the chain sent: a MIDI device's output, on its channel */
    for (;;) {
        int n = sb_take_midi_out(rt->slot, rt->mbuf, (int)sizeof rt->mbuf);
        if (n <= 0) break;
        if (rt->kind != RT_MIDI) continue; /* what a synth sends has nowhere to go */
        int ch = atomic_load_explicit(&rt->out_ch, memory_order_relaxed) & 15;
        for (int i = 0; i + 3 < n; i += 4) {
            const uint8_t *p = rt->mbuf + i;
            int len = 0;
            switch (p[0] & 0x0F) { /* the USB-MIDI packet's CIN */
            case 0x8: case 0x9: case 0xA: case 0xB: case 0xE: len = 3; break;
            case 0xC: case 0xD: len = 2; break;
            case 0xF: len = 1; break;
            }
            if (len == 0 || p[1] < 0x80 || p[1] >= 0xF0 || n_out >= LD_IPC_MAXEV) continue;
            uint8_t *e = mem + LD_OFF_OEVENTS + n_out * 8;
            *u32(e, 0) = 0;
            e[4] = (uint8_t)len;
            e[5] = (uint8_t)((p[1] & 0xF0) | ch);
            e[6] = len > 1 ? p[2] : 0;
            e[7] = len > 2 ? p[3] : 0;
            if (len == 3 && is_on(e + 5)) atomic_fetch_add_explicit(&rt->notes_out, 1, memory_order_relaxed);
            n_out++;
        }
    }
    sb_slot_unlock(rt->slot);

finish:
    *u32(mem, LD_OFF_ONEV) = (uint32_t)n_out;
    *u32(mem, LD_OFF_ONPAR) = (uint32_t)n_outpar;
    atomic_fetch_add_explicit(&rt->blocks, 1, memory_order_relaxed);
    peak(rt, &rt->out_peak, outL, outR, frames);
    keep_max(&rt->proc_max, now_ns() - t0);
}

static void *rt_main(void *arg) {
    rtloop *rt = arg;
    pthread_setname_np(pthread_self(), "pung-rt");
    uint32_t *req = u32(rt->mem, LD_OFF_REQ), *done = u32(rt->mem, LD_OFF_DONE);
    uint32_t *alive = u32(rt->mem, LD_OFF_ALIVE);
    uint32_t last = rt->last;
    while (!atomic_load_explicit(&rt->quit, memory_order_relaxed)) {
        uint32_t r = __atomic_load_n(req, __ATOMIC_ACQUIRE);
        if (r == last) {
            futex_wait(req, r, 200000000L);
            __atomic_add_fetch(alive, 1, __ATOMIC_RELAXED); /* the plugin's sign that we are here */
            continue;
        }
        last = r;
        block(rt);
        __atomic_store_n(done, r, __ATOMIC_RELEASE);
        futex_wake(done);
    }
    return NULL;
}

/* ---- the Go side's calls ----------------------------------------------- */

rtloop *rt_new(int slot, int kind, int in_ch) {
    rtloop *rt = malloc(sizeof *rt);
    if (!rt) return NULL;
    memset(rt, 0, sizeof *rt); /* every page touched now, not on the realtime thread */
    rt->slot = slot;
    rt->kind = kind;
    rt->in_ch = in_ch >= 0 && in_ch < 16 ? in_ch : -1;
    return rt;
}

int rt_start(rtloop *rt, void *mem, int size, unsigned version, int priority) {
    if (!rt || !mem || version != LD_IPC_VERSION || size < (int)LD_IPC_SIZE) return -1;
    rt->mem = mem;
    rt->last = __atomic_load_n(u32(rt->mem, LD_OFF_REQ), __ATOMIC_ACQUIRE);
    pthread_attr_t a;
    pthread_attr_init(&a);
    pthread_attr_setinheritsched(&a, PTHREAD_EXPLICIT_SCHED);
    pthread_attr_setschedpolicy(&a, SCHED_FIFO);
    struct sched_param sp = {.sched_priority = priority};
    pthread_attr_setschedparam(&a, &sp);
    int err = pthread_create(&rt->th, &a, rt_main, rt);
    pthread_attr_destroy(&a);
    if (err != 0) /* no realtime allowed here (a test): an ordinary thread still serves */
        err = pthread_create(&rt->th, NULL, rt_main, rt);
    if (err != 0) return -1;
    rt->running = 1;
    return 0;
}

void rt_stop(rtloop *rt) {
    if (!rt || !rt->running) return;
    atomic_store(&rt->quit, 1);
    futex_wake(u32(rt->mem, LD_OFF_REQ));
    pthread_join(rt->th, NULL);
    rt->running = 0;
}

void rt_free(rtloop *rt) {
    if (!rt) return;
    rt_stop(rt);
    free(rt);
}

void rt_set_out_ch(rtloop *rt, int ch) { atomic_store_explicit(&rt->out_ch, ch, memory_order_relaxed); }
void rt_set_midifx(rtloop *rt, int on) { atomic_store_explicit(&rt->midifx, on != 0, memory_order_relaxed); }
void rt_set_rest(rtloop *rt, int frames) { atomic_store_explicit(&rt->rest_frames, frames < 0 ? 0 : frames, memory_order_relaxed); }
int rt_resting(rtloop *rt, uint32_t *rests) {
    if (rests) *rests = atomic_load_explicit(&rt->rests, memory_order_relaxed);
    return atomic_load_explicit(&rt->resting, memory_order_relaxed);
}

int rt_take_params(rtloop *rt, uint32_t *idx, float *norm, int max) {
    int n = 0;
    while (n < max) {
        unsigned r = atomic_load_explicit(&rt->par_r, memory_order_relaxed);
        if (r == atomic_load_explicit(&rt->par_w, memory_order_acquire)) break;
        idx[n] = rt->par[r & (PAR_RING - 1)].idx;
        norm[n] = rt->par[r & (PAR_RING - 1)].norm;
        atomic_store_explicit(&rt->par_r, r + 1, memory_order_release);
        n++;
    }
    return n;
}

int rt_take_ui_midi(rtloop *rt, uint8_t *buf, int max) {
    int n = 0;
    while (n < max) {
        unsigned r = atomic_load_explicit(&rt->ui_r, memory_order_relaxed);
        if (r == atomic_load_explicit(&rt->ui_w, memory_order_acquire)) break;
        uint8_t m[3];
        int len = unpack(rt->ui[r & (MIDI_Q - 1)], m);
        atomic_store_explicit(&rt->ui_r, r + 1, memory_order_release);
        buf[n * 4] = (uint8_t)len;
        memcpy(buf + n * 4 + 1, m, 3);
        n++;
    }
    return n;
}

int rt_take_audio(rtloop *rt, float *buf, int max_frames) {
    unsigned r = atomic_load_explicit(&rt->aud_r, memory_order_relaxed);
    unsigned w = atomic_load_explicit(&rt->aud_w, memory_order_acquire);
    int n = (int)(w - r) < max_frames ? (int)(w - r) : max_frames;
    for (int i = 0; i < n; i++) {
        unsigned k = (r + (unsigned)i) & (AUDIO_RING - 1);
        buf[i * 2] = rt->aud[k * 2];
        buf[i * 2 + 1] = rt->aud[k * 2 + 1];
    }
    atomic_store_explicit(&rt->aud_r, r + (unsigned)n, memory_order_release);
    return n;
}

float rt_take_meter(rtloop *rt) { return bitsf(atomic_exchange_explicit(&rt->meter, 0, memory_order_relaxed)); }

uint32_t rt_transport(rtloop *rt, double *bpm, double *beat, int *playing) {
    uint32_t seq = atomic_load_explicit(&rt->t_seq, memory_order_acquire);
    uint64_t b = atomic_load_explicit(&rt->t_bpm, memory_order_relaxed);
    memcpy(bpm, &b, 8);
    b = atomic_load_explicit(&rt->t_beat, memory_order_relaxed);
    memcpy(beat, &b, 8);
    *playing = atomic_load_explicit(&rt->t_playing, memory_order_relaxed);
    return seq;
}

int rt_put_report(rtloop *rt, uint32_t idx, float norm) {
    unsigned w = atomic_load_explicit(&rt->rep_w, memory_order_relaxed);
    if (w - atomic_load_explicit(&rt->rep_r, memory_order_acquire) >= PAR_RING) return 0;
    rt->rep[w & (PAR_RING - 1)].idx = idx;
    rt->rep[w & (PAR_RING - 1)].norm = norm;
    atomic_store_explicit(&rt->rep_w, w + 1, memory_order_release);
    return 1;
}

int rt_put_midi(rtloop *rt, const uint8_t *msg, int len) {
    if (len < 1 || len > 3) return 1;
    unsigned w = atomic_load_explicit(&rt->gom_w, memory_order_relaxed);
    if (w - atomic_load_explicit(&rt->gom_r, memory_order_acquire) >= MIDI_Q) return 0;
    rt->gom[w & (MIDI_Q - 1)] = pack(msg, len);
    atomic_store_explicit(&rt->gom_w, w + 1, memory_order_release);
    return 1;
}

int rt_preview_level(rtloop *rt) {
    return (int)(atomic_load_explicit(&rt->prev_w, memory_order_relaxed) - atomic_load_explicit(&rt->prev_r, memory_order_acquire));
}

int rt_put_preview(rtloop *rt, const float *pcm, int frames) {
    unsigned w = atomic_load_explicit(&rt->prev_w, memory_order_relaxed);
    int space = PREV_RING - (int)(w - atomic_load_explicit(&rt->prev_r, memory_order_acquire));
    int n = frames < space ? frames : space;
    for (int i = 0; i < n; i++) {
        unsigned k = (w + (unsigned)i) & (PREV_RING - 1);
        rt->prev[k * 2] = pcm[i * 2];
        rt->prev[k * 2 + 1] = pcm[i * 2 + 1];
    }
    atomic_store_explicit(&rt->prev_w, w + (unsigned)n, memory_order_release);
    return n;
}

void rt_preview_stop(rtloop *rt) { atomic_store_explicit(&rt->prev_stop, 1, memory_order_release); }
int rt_preview_stopping(rtloop *rt) { return atomic_load_explicit(&rt->prev_stop, memory_order_acquire); }

/* rt_usage: what the thread has cost since it started. Its processor time is
 * read from the thread's own clock by the caller's thread: nothing is added
 * to a block for it. */
void rt_usage(rtloop *rt, rt_usage_t *o) {
    o->cpu_ns = 0;
    clockid_t c;
    struct timespec ts;
    if (rt->running && pthread_getcpuclockid(rt->th, &c) == 0 && clock_gettime(c, &ts) == 0)
        o->cpu_ns = (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
    o->render_ns = atomic_load(&rt->render_sum);
    o->blocks = atomic_load(&rt->blocks);
    o->out_peak = bitsf(atomic_load(&rt->out_peak));
}

void rt_stats(rtloop *rt, rt_stats_t *o) {
    o->blocks = atomic_load(&rt->blocks);
    o->notes_in = atomic_load(&rt->notes_in);
    o->notes_out = atomic_load(&rt->notes_out);
    o->skipped = atomic_load(&rt->skipped);
    o->held_sent = atomic_load(&rt->held_sent);
    o->rekeyed = atomic_load(&rt->rekeyed);
    o->preview_frames = atomic_load(&rt->preview_frames);
    o->proc_max_ns = atomic_exchange(&rt->proc_max, 0);
    o->gap_max_ns = atomic_exchange(&rt->gap_max, 0);
    o->acquire_max_ns = atomic_exchange(&rt->acq_max, 0);
    o->render_max_ns = atomic_exchange(&rt->render_max, 0);
    o->out_peak = bitsf(atomic_load(&rt->out_peak));
    o->in_peak = bitsf(atomic_load(&rt->in_peak));
}
