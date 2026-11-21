/*
 * bridge.h: the C side of the Pung host for Push 3.
 *
 * One dlopen of Schwung's chain host (chain/dsp.so) serves every slot: each
 * slot is one chain instance. The Go side guarantees that only one thread at
 * a time calls into a given slot (a per-slot lock the render loop only ever
 * TRIES); the bridge itself holds no locks.
 *
 * Schwung's host_api_v1_t is process-global, but some of its callbacks need
 * to know which slot is calling (MIDI a module sends out, the audio input in
 * the mailbox). The bridge sets a thread-local "current slot" around every
 * call into an instance.
 */
#ifndef SB_BRIDGE_H
#define SB_BRIDGE_H

#include <stdint.h>

#define SB_MAX_SLOTS 64 /* chain instances: one per Pung device in Live */
#define SB_BLOCK 128 /* Schwung's block: MOVE_FRAMES_PER_BLOCK */

/* Loads chain/dsp.so from chain_dir. 0 on success, else see sb_error(). */
int sb_init(const char *chain_dir);
/* fd: closed in any child process a module forks (Pung's listeners) */
void sb_close_in_children(int fd);
void sb_lock_dir(const char *dir); /* a forked child closes *.lock files under dir */
const char *sb_error(void);

int sb_slot_create(int slot);  /* 0 on success */
void sb_slot_destroy(int slot);
int sb_slot_alive(int slot);

void sb_set_param(int slot, const char *key, const char *val);
/* Bytes written (excluding NUL), or <0 when the key produced nothing. */
int sb_get_param(int slot, const char *key, char *buf, int buf_len);
void sb_midi(int slot, const uint8_t *msg, int len, int source);

/* Renders `frames` stereo frames as interleaved float L,R. `in` is the
 * slot's stereo input for the same frames (interleaved float) or NULL.
 * Internally renders 128-frame blocks and carries the remainder, so any
 * period works. Returns the peak of the rendered audio (0..1+). */
float sb_render(int slot, float *out, const float *in, int frames);

/* Renders `blocks` blocks into nothing. Called on the CONTROL thread right
 * after a module load, while the engine skips the slot: some modules do
 * their one-time setup in the first render_block (Hera: 8 ms), which on the
 * render thread would make every slot late. */
void sb_warm(int slot, int blocks);
long long sb_chain_max_ns(int slot);

/* For a device's own realtime thread (rtloop.c): the slot's lock, taken with
 * a deadline (0: held; -1: not, or the slot is busy loading), and the calls
 * it makes while holding it. */
#include <time.h>
int sb_slot_lock_until(int slot, const struct timespec *abs_realtime);
void sb_slot_unlock(int slot);
void sb_slot_busy(int slot, int on);
float sb_render_nolock(int slot, float *out, const float *in, int frames);
void sb_midi_nolock(int slot, const uint8_t *msg, int len, int source);

/* Transport, for the clock callbacks every module can call. */
void sb_set_tempo(float bpm);
void sb_set_clock(int status, double beat);

/* MIDI a module sent (midi_send_internal / _external / midi_inject_to_move),
 * as 4-byte USB-MIDI packets. Returns the number of BYTES copied (a multiple
 * of 4). Byte 0 of each packet carries the route in its high nibble:
 * 0 internal, 2 external, 3 inject (a MIDI effect's output in "pre" mode,
 * which a Pung MIDI-effect device sends on to Live). */
int sb_take_midi_out(int slot, uint8_t *buf, int max);

/* SCHED_FIFO for the calling thread. 0 on success. */
int sb_set_realtime(int priority);
int sb_set_timeshare(void);

#endif
