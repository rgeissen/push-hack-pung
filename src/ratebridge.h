/*
 * ratebridge.h: a device at the host's sample rate.
 *
 * A module renders at 44100 Hz, always (its filters, its envelopes, the chain
 * host itself). Live on a Push runs at that rate; a host on a computer runs at
 * any. Between the two stands this: for each block of the host's it says how
 * many of the module's frames to render, and turns them into the host's, band
 * limited (a windowed sinc, 32 points). An effect's input goes the other way
 * first. Nothing here allocates or waits once it is made.
 *
 * What it costs in time is fixed by the rate and the kind alone, so the
 * plugin can tell the host without asking (rb_latency; the same numbers are
 * in the plugin's source):
 *   an instrument: RB_HALF of the module's frames, in the host's frames (rounded)
 *   an effect: that (rounded up), and RB_HALF + RB_SLACK of the host's frames
 */
#ifndef PUNG_RATEBRIDGE_H
#define PUNG_RATEBRIDGE_H

#define RB_MODULE_RATE 44100
#define RB_HALF 16  /* points each side of the one being made */
#define RB_SLACK 8  /* an effect's input: frames kept in hand, the count needed varies by one or two a block */
#define RB_MAX_HOST 4096                 /* frames in one block of the host's (livedevice_ipc.h, LD_IPC_MAXF) */
#define RB_MAX_MOD (RB_MAX_HOST * 2 + 64) /* the module's frames one such block may need (down to 22050 Hz) */

typedef struct ratebridge ratebridge;

/* NULL: the host runs at the module's rate (nothing to do), or at one this
 * does not serve (below 22050 Hz). Made off the audio thread. */
ratebridge *rb_new(int host_rate, int effect);
void rb_free(ratebridge *rb);
/* how many of the module's frames this block of the host's needs (at most RB_MAX_MOD) */
int rb_need(const ratebridge *rb, int host_frames);
/* an effect: the host's input (interleaved stereo) as `need` frames for the module */
void rb_in(ratebridge *rb, const float *host_in, int host_frames, float *mod_in, int need);
/* the module's `need` frames in, the host's block out */
void rb_out(ratebridge *rb, const float *mod_out, int need, float *host_out, int host_frames);
/* the delay through it, in the host's frames; 0 at the module's rate */
int rb_latency(int host_rate, int effect);

#endif
