/*
 * rtloop.h: a Pung device's blocks served on a thread of its own, in C.
 *
 * Live's plugin hands Pung each audio block through shared memory and waits
 * half a block for the answer (livedevice_ipc.h). Served from Go, the block's
 * goroutine was now and then taken off its processor by Go's scheduler and
 * waited for an ordinary thread to hand one back: on a busy Push up to a
 * millisecond, and Live played silence (measured 2026-11-21). This thread
 * never enters Go. What belongs on the audio path is done here: Live's MIDI
 * into the chain (the channel, the key guard, notes of skipped blocks), the
 * MIDI clock, the render, MIDI out, the file preview. What does not is
 * queued for Go (rtloop.go), which runs a moment behind: Live's parameter
 * changes, the audio and MIDI the screens and stats read; and what Go sends
 * comes back the same way (parameter reports to Live, notes from the web
 * page, the preview's audio).
 *
 * Every queue has one writer and one reader.
 */
#ifndef PUNG_RTLOOP_H
#define PUNG_RTLOOP_H

#include <stdint.h>

enum { RT_INSTRUMENT = 0, RT_EFFECT = 1, RT_MIDI = 2 };

typedef struct rtloop rtloop;

/* in_ch: the channel Live's MIDI reaches the chain on, -1: as it comes */
rtloop *rt_new(int slot, int kind, int in_ch);
/* serve the block in mem (the device's shared memory) at SCHED_FIFO
 * priority; 0: running. The block counter is read here, before it returns. */
int rt_start(rtloop *rt, void *mem, int size, unsigned version, int priority);
void rt_stop(rtloop *rt); /* returns once the thread is gone */
void rt_free(rtloop *rt);

void rt_set_out_ch(rtloop *rt, int ch);  /* the device's "MIDI Out Ch" */
void rt_set_midifx(rtloop *rt, int on); /* a MIDI effect is loaded: it gets the clock */

/* to Go */
int rt_take_params(rtloop *rt, uint32_t *idx, float *norm, int max);
int rt_take_ui_midi(rtloop *rt, uint8_t *buf, int max); /* 4 bytes each: length, then the message */
int rt_take_audio(rtloop *rt, float *buf, int max_frames); /* interleaved stereo */
float rt_take_meter(rtloop *rt); /* the loudest sample since the last call */
/* the transport Live sent last; returns a counter that moves with each block that had one */
uint32_t rt_transport(rtloop *rt, double *bpm, double *beat, int *playing);

/* from Go */
int rt_put_report(rtloop *rt, uint32_t idx, float norm); /* 0: full */
int rt_put_midi(rtloop *rt, const uint8_t *msg, int len); /* 0: full */
int rt_preview_level(rtloop *rt); /* frames of preview queued */
int rt_put_preview(rtloop *rt, const float *pcm, int frames); /* frames taken */
void rt_preview_stop(rtloop *rt); /* fade out what plays, within a block, and drop the rest */
int rt_preview_stopping(rtloop *rt);

typedef struct {
    uint64_t blocks, notes_in, notes_out, skipped, held_sent, rekeyed, preview_frames;
    int64_t proc_max_ns, gap_max_ns, acquire_max_ns, render_max_ns; /* the worst since the last read */
    float out_peak, in_peak;                                       /* about the last second */
} rt_stats_t;
void rt_stats(rtloop *rt, rt_stats_t *out);

#endif
