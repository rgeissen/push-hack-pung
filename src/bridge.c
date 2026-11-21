/* bridge.c: see bridge.h. */
#include "bridge.h"

#include <dlfcn.h>
#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <sys/syscall.h>
#include <fcntl.h>

#include "third_party/schwung/host/plugin_api_v1.h"

/* Move's SPI mailbox layout, as modules expect it (CLAUDE.md, SPI Protocol):
 * audio out at 256, audio in at 2304, 128 stereo int16 frames each. */
#define MB_SIZE 4096
#define MB_AUDIO_OUT 256
#define MB_AUDIO_IN 2304

#define MIDI_RING 1024 /* bytes, power of two */
#define IN_FIFO 8192   /* stereo frames, power of two */

typedef struct {
    void *inst;
    /* rendered audio not yet handed out */
    int16_t carry[SB_BLOCK * 2];
    int carry_pos, carry_len;
    /* input waiting to be rendered against */
    int16_t in_fifo[IN_FIFO * 2];
    unsigned in_w, in_r;
    int has_input;              /* the caller hands in audio: inject it */
    int16_t inject[SB_BLOCK * 2];
    /* MIDI the module sent: written by the slot's owner, read by Go */
    uint8_t midi[MIDI_RING];
    _Atomic unsigned midi_w, midi_r;
    /* the longest chain render_block since sb_chain_max_ns last read it */
    _Atomic long long chain_ns_max;
} slot_t;

static char g_err[512];
static void *g_lib;
/* chain_set_inject_audio: audio mixed in front of the chain's effects. With
 * no synth loaded the chain is then an audio effect on that input. */
static void (*g_inject)(void *, int16_t *, int);
static plugin_api_v2_t *g_api;
static char g_chain_dir[1024];
static slot_t g_slots[SB_MAX_SLOTS];
/* One mailbox, filled with the CURRENT slot's input before each block. */
static uint8_t g_mailbox[MB_SIZE];
static host_api_v1_t g_host; /* static: zeroed, so the reserved tail is NULL */
static __thread int t_slot = -1;

static _Atomic float g_bpm = 120.0f;
static _Atomic int g_clock = MOVE_CLOCK_STATUS_UNAVAILABLE;
static _Atomic double g_beat = -1.0;

static void set_err(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(g_err, sizeof g_err, fmt, ap);
    va_end(ap);
}
const char *sb_error(void) { return g_err; }

static void h_log(const char *msg) { fprintf(stderr, "dsp: %s\n", msg); }

static int push_midi(int route, const uint8_t *msg, int len) {
    if (t_slot < 0 || len <= 0) return 0;
    slot_t *s = &g_slots[t_slot];
    /* modules hand us 4-byte USB-MIDI packets; keep them as packets */
    int n = len & ~3;
    unsigned w = atomic_load_explicit(&s->midi_w, memory_order_relaxed);
    unsigned r = atomic_load_explicit(&s->midi_r, memory_order_acquire);
    if ((unsigned)(MIDI_RING - (w - r)) < (unsigned)n) return 0; /* full: drop, report it */
    for (int i = 0; i < n; i++) {
        uint8_t b = msg[i];
        if ((i & 3) == 0) b = (uint8_t)((route << 4) | (b & 0x0F));
        s->midi[(w + i) & (MIDI_RING - 1)] = b;
    }
    atomic_store_explicit(&s->midi_w, w + n, memory_order_release);
    return len;
}
static int h_send_internal(const uint8_t *m, int l) { return push_midi(0, m, l); }
static int h_send_external(const uint8_t *m, int l) { return push_midi(2, m, l); }
static int h_inject(const uint8_t *m, int l) { return push_midi(3, m, l); }
static int h_clock_status(void) { return atomic_load(&g_clock); }
static float h_bpm(void) { return atomic_load(&g_bpm); }
static double h_beat(void) { return atomic_load(&g_beat); }

/* Pung's own listening sockets, closed in every child a module forks.
 * Some modules fork their engine without exec (Osirus's emulator); such a
 * child inherits every descriptor, and one that outlives Pung kept the web
 * port bound, so the next Pung could not start (2026-11-15). A fork handler
 * closes them in the child; the parent keeps its own. */
#define SB_MAX_CLOSE 8
static int g_close_fds[SB_MAX_CLOSE];
static atomic_int g_nclose;
/*
 * A forked child also lets go of Pung's lock files (*.lock under the
 * directory set with sb_lock_dir). A fork inherits every open file, and a
 * flock lives as long as any copy: Osirus's virus-boot helper, forked while
 * JE-8086's one-per-device lock was open in Pung, kept that lock for as long
 * as Osirus ran, so no JE-8086 could start again (2026-11-15). The instance
 * that took a lock keeps its own copy in Pung's process, so the lock still
 * means what its module meant. Raw syscalls only: this runs in the child of
 * a threaded process, where malloc may be locked.
 */
static char g_lock_dir[512];
struct sb_dirent64 { unsigned long long d_ino; long long d_off; unsigned short d_reclen; unsigned char d_type; char d_name[]; };
static void sb_close_inherited_locks(void) {
    size_t plen = strlen(g_lock_dir);
    if (!plen) return;
    int dfd = (int)syscall(SYS_open, "/proc/self/fd", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd < 0) return;
    char buf[2048], link[600], path[64];
    for (;;) {
        long n = syscall(SYS_getdents64, dfd, buf, sizeof buf);
        if (n <= 0) break;
        for (long off = 0; off < n;) {
            struct sb_dirent64 *e = (struct sb_dirent64 *)(buf + off);
            off += e->d_reclen;
            int fd = 0, ok = e->d_name[0] != 0;
            for (const char *c = e->d_name; *c; c++) {
                if (*c < '0' || *c > '9') { ok = 0; break; }
                fd = fd * 10 + (*c - '0');
            }
            if (!ok || fd == dfd || fd <= 2) continue;
            int pl = 0;
            const char *pre = "/proc/self/fd/";
            while (pre[pl]) { path[pl] = pre[pl]; pl++; }
            for (const char *c = e->d_name; *c && pl < 60; c++) path[pl++] = *c;
            path[pl] = 0;
            long ll = syscall(SYS_readlink, path, link, sizeof link - 1);
            if (ll <= 5) continue;
            link[ll] = 0;
            if ((size_t)ll <= plen || memcmp(link, g_lock_dir, plen) != 0 || memcmp(link + ll - 5, ".lock", 5) != 0)
                continue;
            int nested = 0; /* only the directory itself: a module's own folder is its business */
            for (long k = (long)plen; k < ll; k++) if (link[k] == '/') { nested = 1; break; }
            if (!nested) close(fd);
        }
    }
    close(dfd);
}
void sb_lock_dir(const char *dir) { snprintf(g_lock_dir, sizeof g_lock_dir, "%s", dir); }

static void sb_atfork_child(void) {
    int n = atomic_load(&g_nclose);
    for (int i = 0; i < n && i < SB_MAX_CLOSE; i++) close(g_close_fds[i]);
    sb_close_inherited_locks();
}
void sb_close_in_children(int fd) {
    int i = atomic_fetch_add(&g_nclose, 1);
    if (i < SB_MAX_CLOSE) g_close_fds[i] = fd;
}

int sb_init(const char *chain_dir) {
    static int forkhook;
    if (!forkhook) { pthread_atfork(NULL, NULL, sb_atfork_child); forkhook = 1; }
    char path[1200];
    snprintf(g_chain_dir, sizeof g_chain_dir, "%s", chain_dir);
    snprintf(path, sizeof path, "%s/dsp.so", chain_dir);
    g_lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!g_lib) { set_err("dlopen %s: %s", path, dlerror()); return -1; }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(g_lib, MOVE_PLUGIN_INIT_V2_SYMBOL);
    if (!init) { set_err("%s missing in %s", MOVE_PLUGIN_INIT_V2_SYMBOL, path); return -1; }

    g_host.api_version = MOVE_PLUGIN_API_VERSION;
    g_host.sample_rate = MOVE_SAMPLE_RATE;
    g_host.frames_per_block = MOVE_FRAMES_PER_BLOCK;
    g_host.mapped_memory = g_mailbox;
    g_host.audio_out_offset = MB_AUDIO_OUT;
    g_host.audio_in_offset = MB_AUDIO_IN;
    g_host.log = h_log;
    g_host.midi_send_internal = h_send_internal;
    g_host.midi_send_external = h_send_external;
    g_host.get_clock_status = h_clock_status;
    g_host.get_bpm = h_bpm;
    g_host.get_beat_position = h_beat;
    /* "inject to Move" is a MIDI effect's output in pre mode: on Push it
     * becomes a Pung MIDI-effect device's MIDI out. slot_recv_channel
     * stays NULL; modules guard every host call. */
    g_host.midi_inject_to_move = h_inject;
    g_api = init(&g_host);
    if (!g_api) { set_err("move_plugin_init_v2 returned NULL"); return -1; }
    g_inject = (void (*)(void *, int16_t *, int))dlsym(g_lib, "chain_set_inject_audio");
    return 0;
}

static int valid(int slot) { return g_api && slot >= 0 && slot < SB_MAX_SLOTS; }
int sb_slot_alive(int slot) { return valid(slot) && g_slots[slot].inst != NULL; }

/* Each chain is called by one thread at a time: its lock, held for every call
 * into it. A priority-inheriting mutex: when a device's realtime thread
 * (rtloop.c) waits for it, the kernel lifts whoever holds it to the waiter's
 * priority until it lets go, so an ordinary thread in the middle of a
 * get_param is not left behind by an emulator's threads (it was, at nice 19,
 * and Live played silence: lockboost_linux.go). Kept apart from g_slots,
 * which sb_slot_create clears. busy: a long call (a module loading) holds
 * it; the realtime thread does not wait then. */
static pthread_mutex_t g_lock[SB_MAX_SLOTS];
static _Atomic int g_busy[SB_MAX_SLOTS];
static pthread_once_t g_lock_once = PTHREAD_ONCE_INIT;
static void lock_init(void) {
    pthread_mutexattr_t a;
    pthread_mutexattr_init(&a);
    pthread_mutexattr_setprotocol(&a, PTHREAD_PRIO_INHERIT);
    for (int i = 0; i < SB_MAX_SLOTS; i++) pthread_mutex_init(&g_lock[i], &a);
    pthread_mutexattr_destroy(&a);
}
static void slot_lock(int slot) {
    pthread_once(&g_lock_once, lock_init);
    pthread_mutex_lock(&g_lock[slot]);
}
static void slot_unlock(int slot) { pthread_mutex_unlock(&g_lock[slot]); }

int sb_slot_lock_until(int slot, const struct timespec *abs_realtime) {
    if (!valid(slot) || atomic_load_explicit(&g_busy[slot], memory_order_relaxed)) return -1;
    pthread_once(&g_lock_once, lock_init);
    return pthread_mutex_timedlock(&g_lock[slot], abs_realtime) == 0 ? 0 : -1;
}
void sb_slot_unlock(int slot) { if (valid(slot)) slot_unlock(slot); }
void sb_slot_busy(int slot, int on) { if (valid(slot)) atomic_store(&g_busy[slot], on); }

int sb_slot_create(int slot) {
    if (!valid(slot)) { set_err("bad slot %d", slot); return -1; }
    if (g_slots[slot].inst) return 0;
    slot_lock(slot);
    memset(&g_slots[slot], 0, sizeof g_slots[slot]);
    t_slot = slot;
    g_slots[slot].inst = g_api->create_instance(g_chain_dir, NULL);
    t_slot = -1;
    void *inst = g_slots[slot].inst;
    slot_unlock(slot);
    if (!inst) { set_err("create_instance failed for slot %d", slot); return -1; }
    return 0;
}

void sb_slot_destroy(int slot) {
    if (!sb_slot_alive(slot)) return;
    slot_lock(slot);
    t_slot = slot;
    g_api->destroy_instance(g_slots[slot].inst);
    t_slot = -1;
    g_slots[slot].inst = NULL;
    slot_unlock(slot);
}

void sb_set_param(int slot, const char *key, const char *val) {
    if (!sb_slot_alive(slot)) return;
    slot_lock(slot);
    t_slot = slot;
    g_api->set_param(g_slots[slot].inst, key, val);
    t_slot = -1;
    slot_unlock(slot);
}

int sb_get_param(int slot, const char *key, char *buf, int buf_len) {
    if (!sb_slot_alive(slot) || buf_len <= 0) return -1;
    buf[0] = 0;
    slot_lock(slot);
    t_slot = slot;
    int n = g_api->get_param(g_slots[slot].inst, key, buf, buf_len);
    t_slot = -1;
    slot_unlock(slot);
    if (n >= buf_len) n = buf_len - 1;
    if (n >= 0) buf[n] = 0;
    return n;
}

void sb_midi_nolock(int slot, const uint8_t *msg, int len, int source) {
    if (!sb_slot_alive(slot)) return;
    t_slot = slot;
    g_api->on_midi(g_slots[slot].inst, msg, len, source);
    t_slot = -1;
}

void sb_midi(int slot, const uint8_t *msg, int len, int source) {
    if (!sb_slot_alive(slot)) return;
    slot_lock(slot);
    sb_midi_nolock(slot, msg, len, source);
    slot_unlock(slot);
}

static inline int16_t to_i16(float v) {
    v *= 32767.0f;
    if (v > 32767.0f) v = 32767.0f;
    if (v < -32768.0f) v = -32768.0f;
    return (int16_t)lrintf(v);
}

float sb_render(int slot, float *out, const float *in, int frames) {
    if (!sb_slot_alive(slot)) {
        memset(out, 0, sizeof(float) * 2 * frames);
        return 0;
    }
    slot_lock(slot);
    float peak = sb_render_nolock(slot, out, in, frames);
    slot_unlock(slot);
    return peak;
}

float sb_render_nolock(int slot, float *out, const float *in, int frames) {
    float peak = 0;
    if (!sb_slot_alive(slot)) {
        memset(out, 0, sizeof(float) * 2 * frames);
        return 0;
    }
    slot_t *s = &g_slots[slot];
    s->has_input = in != NULL;
    if (in) {
        for (int i = 0; i < frames; i++) {
            unsigned w = s->in_w & (IN_FIFO - 1);
            s->in_fifo[w * 2] = to_i16(in[i * 2]);
            s->in_fifo[w * 2 + 1] = to_i16(in[i * 2 + 1]);
            s->in_w++;
            if (s->in_w - s->in_r > IN_FIFO) s->in_r = s->in_w - IN_FIFO;
        }
    }
    int done = 0;
    while (done < frames) {
        if (s->carry_pos >= s->carry_len) {
            int16_t *mb_in = (int16_t *)(g_mailbox + MB_AUDIO_IN);
            for (int i = 0; i < SB_BLOCK; i++) {
                if (s->in_w != s->in_r) {
                    unsigned r = s->in_r & (IN_FIFO - 1);
                    mb_in[i * 2] = s->in_fifo[r * 2];
                    mb_in[i * 2 + 1] = s->in_fifo[r * 2 + 1];
                    s->in_r++;
                } else {
                    mb_in[i * 2] = mb_in[i * 2 + 1] = 0;
                }
            }
            if (s->has_input && g_inject) {
                memcpy(s->inject, mb_in, sizeof s->inject);
                g_inject(s->inst, s->inject, SB_BLOCK);
            }
            t_slot = slot;
            struct timespec c0, c1;
            clock_gettime(CLOCK_MONOTONIC, &c0);
            g_api->render_block(s->inst, s->carry, SB_BLOCK);
            clock_gettime(CLOCK_MONOTONIC, &c1);
            long long ns = (c1.tv_sec - c0.tv_sec) * 1000000000LL + (c1.tv_nsec - c0.tv_nsec);
            if (ns > atomic_load_explicit(&s->chain_ns_max, memory_order_relaxed))
                atomic_store_explicit(&s->chain_ns_max, ns, memory_order_relaxed);
            t_slot = -1;
            s->carry_pos = 0;
            s->carry_len = SB_BLOCK;
        }
        while (done < frames && s->carry_pos < s->carry_len) {
            float l = s->carry[s->carry_pos * 2] / 32768.0f;
            float r = s->carry[s->carry_pos * 2 + 1] / 32768.0f;
            out[done * 2] = l;
            out[done * 2 + 1] = r;
            float a = fabsf(l) > fabsf(r) ? fabsf(l) : fabsf(r);
            if (a > peak) peak = a;
            s->carry_pos++;
            done++;
        }
    }
    return peak;
}

long long sb_chain_max_ns(int slot) {
    if (!valid(slot)) return 0;
    return atomic_exchange(&g_slots[slot].chain_ns_max, 0);
}

void sb_warm(int slot, int blocks) {
    if (!sb_slot_alive(slot)) return;
    int16_t scratch[SB_BLOCK * 2];
    /* the mailbox input stays silent for warm-up blocks */
    slot_lock(slot);
    memset(g_mailbox + MB_AUDIO_IN, 0, SB_BLOCK * 4);
    for (int i = 0; i < blocks; i++) {
        t_slot = slot;
        g_api->render_block(g_slots[slot].inst, scratch, SB_BLOCK);
        t_slot = -1;
    }
    slot_unlock(slot);
}

void sb_set_tempo(float bpm) { if (bpm > 20 && bpm < 999) atomic_store(&g_bpm, bpm); }
void sb_set_clock(int status, double beat) {
    atomic_store(&g_clock, status);
    atomic_store(&g_beat, beat);
}

int sb_take_midi_out(int slot, uint8_t *buf, int max) {
    if (!valid(slot)) return 0;
    slot_t *s = &g_slots[slot];
    unsigned r = atomic_load_explicit(&s->midi_r, memory_order_relaxed);
    unsigned w = atomic_load_explicit(&s->midi_w, memory_order_acquire);
    int n = (int)(w - r);
    if (n > max) n = max & ~3;
    for (int i = 0; i < n; i++) buf[i] = s->midi[(r + i) & (MIDI_RING - 1)];
    atomic_store_explicit(&s->midi_r, r + n, memory_order_release);
    return n;
}

/* back to ordinary scheduling, after a load at sb_set_realtime */
int sb_set_timeshare(void) {
    struct sched_param sp = {.sched_priority = 0};
    return pthread_setschedparam(pthread_self(), SCHED_OTHER, &sp);
}

int sb_set_realtime(int priority) {
    struct sched_param sp = {.sched_priority = priority};
    return pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
}
