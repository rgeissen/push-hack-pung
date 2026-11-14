/*
 * schwung_ipc.h: the shared memory between a Schwung device in Live
 * (Schwung.vst3, the proxy) and its chain in the Schwung service (DESIGN-v2).
 *
 * One file per device: /dev/shm/schwung-dev-<id>, mode 0666 (Live runs as
 * ableton, the service as root). Fixed offsets, so the Go side (devices.go)
 * and the C++ side (vst3/source/proxy.cpp) read the same bytes without a
 * shared struct definition. Bump SB_IPC_VERSION on any change.
 *
 * One block:
 *   proxy:   writes frames, transport, events, params, input; req++; wakes req
 *   service: renders; writes output; done = req; wakes done
 *   proxy:   waits on done for at most half a block, else outputs silence
 */
#ifndef SCHWUNG_IPC_H
#define SCHWUNG_IPC_H

#define SB_IPC_MAGIC 0x53434857u /* "SCHW" */
#define SB_IPC_VERSION 2u /* 2: events out, for MIDI-effect devices */
#define SB_IPC_MAXF 4096         /* frames per block, at most */
#define SB_IPC_MAXEV 256
#define SB_IPC_MAXPAR 256

#define SB_OFF_MAGIC 0
#define SB_OFF_VERSION 4
#define SB_OFF_REQ 8      /* u32, futex: the proxy's block counter */
#define SB_OFF_DONE 12    /* u32, futex: the last block the service finished */
#define SB_OFF_FRAMES 16  /* u32 */
#define SB_OFF_FLAGS 20   /* u32: bit0 playing, bit1 transport valid */
#define SB_OFF_BPM 24     /* f64 */
#define SB_OFF_BEAT 32    /* f64: quarter notes since song start */
#define SB_OFF_NEV 40     /* u32 */
#define SB_OFF_NPAR 44    /* u32 */
#define SB_OFF_LATE 48    /* u32: blocks the proxy gave up waiting for */
#define SB_OFF_ALIVE 52   /* u32: the service's heartbeat, a counter */
#define SB_OFF_EVENTS 64  /* SB_IPC_MAXEV x { u32 offset; u8 len; u8 b[3]; } */
#define SB_OFF_PARAMS (SB_OFF_EVENTS + SB_IPC_MAXEV * 8) /* x { u32 index; f32 norm; } */
#define SB_OFF_IN_L (SB_OFF_PARAMS + SB_IPC_MAXPAR * 8)  /* f32[SB_IPC_MAXF] */
#define SB_OFF_IN_R (SB_OFF_IN_L + SB_IPC_MAXF * 4)
#define SB_OFF_OUT_L (SB_OFF_IN_R + SB_IPC_MAXF * 4)
#define SB_OFF_OUT_R (SB_OFF_OUT_L + SB_IPC_MAXF * 4)
#define SB_OFF_ONEV (SB_OFF_OUT_R + SB_IPC_MAXF * 4) /* u32: events the service sends back */
#define SB_OFF_OEVENTS (SB_OFF_ONEV + 64)             /* SB_IPC_MAXEV x { u32 offset; u8 len; u8 b[3]; } */
#define SB_IPC_SIZE (SB_OFF_OEVENTS + SB_IPC_MAXEV * 8)

/* the service's control socket: JSON lines (create, destroy, state) */
#define SB_IPC_SOCKET "/data/push-hack/data/schwung/devices.sock"
/* the device classes, written by the service, read by Schwung.vst3 */
#define SB_IPC_CLASSES "/data/push-hack/hacks/schwung/vst3-classes.json"

#endif
