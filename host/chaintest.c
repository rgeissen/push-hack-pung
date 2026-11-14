/*
 * chaintest: proves Schwung's chain host runs on Push 3. Loads chain/dsp.so
 * from a module tree, builds a chain from the command line, plays notes and
 * prints the output level. No audio device, no Live: just the DSP.
 *
 *   chaintest <modules-dir> <synth> [fx ...]
 */
#include <dlfcn.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "host/plugin_api_v1.h"

static void plog(const char *m) { fprintf(stderr, "[dsp] %s\n", m); }
static int send_int(const uint8_t *m, int l) { (void)m; return l; }
static int send_ext(const uint8_t *m, int l) { (void)m; return l; }
static float bpm(void) { return 120.0f; }
static int clock_status(void) { return 0; }
static uint8_t mailbox[4096];

static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s <modules-dir> <synth> [fx...]\n", argv[0]); return 2; }
    char path[1024], chain_dir[1024];
    snprintf(chain_dir, sizeof chain_dir, "%s/chain", argv[1]);
    snprintf(path, sizeof path, "%s/dsp.so", chain_dir);
    void *h = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!h) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 1; }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(h, MOVE_PLUGIN_INIT_V2_SYMBOL);
    if (!init) { fprintf(stderr, "no %s\n", MOVE_PLUGIN_INIT_V2_SYMBOL); return 1; }

    static host_api_v1_t host; /* zeroed: the reserved tail must be NULL */
    host.api_version = MOVE_PLUGIN_API_VERSION;
    host.sample_rate = MOVE_SAMPLE_RATE;
    host.frames_per_block = MOVE_FRAMES_PER_BLOCK;
    host.mapped_memory = mailbox;
    host.audio_out_offset = 256;
    host.audio_in_offset = 2304;
    host.log = plog;
    host.midi_send_internal = send_int;
    host.midi_send_external = send_ext;
    host.get_clock_status = clock_status;
    host.get_bpm = bpm;

    plugin_api_v2_t *api = init(&host);
    if (!api) { fprintf(stderr, "init returned NULL\n"); return 1; }
    void *inst = api->create_instance(chain_dir, NULL);
    if (!inst) { fprintf(stderr, "create_instance failed\n"); return 1; }

    double t0 = now();
    api->set_param(inst, "synth:module", argv[2]);
    for (int i = 3; i < argc; i++) {
        char k[32]; snprintf(k, sizeof k, "fx%d:module", i - 2);
        api->set_param(inst, k, argv[i]);
    }
    printf("load: %.1f ms\n", (now() - t0) * 1000);

    char buf[65536];
    const char *keys[] = {"synth_module", "fx1_module", "fx2_module", "synth_error"};
    for (int i = 0; i < 4; i++) {
        int n = api->get_param(inst, keys[i], buf, sizeof buf);
        printf("%-13s = %s\n", keys[i], n > 0 ? buf : "(none)");
    }
    int n = api->get_param(inst, "synth:chain_params", buf, sizeof buf);
    printf("synth:chain_params: %d bytes\n", n);
    n = api->get_param(inst, "synth:ui_hierarchy", buf, sizeof buf);
    printf("synth:ui_hierarchy: %d bytes\n", n);

    int16_t out[MOVE_FRAMES_PER_BLOCK * 2];
    const int blocks = 2000; /* ~5.8 s */
    double worst = 0, total = 0, peak = 0, rms = 0, worstWarm = 0; long samples = 0; int over = 0, worstAt = -1;
    int notes[] = {48, 55, 60, 63, 67};
    for (int b = 0; b < blocks; b++) {
        if (b % 100 == 0) { uint8_t on[3] = {0x90, (uint8_t)notes[(b / 100) % 5], 100}; api->on_midi(inst, on, 3, MOVE_MIDI_SOURCE_INTERNAL); }
        if (b % 100 == 60) { uint8_t off[3] = {0x80, (uint8_t)notes[(b / 100) % 5], 0}; api->on_midi(inst, off, 3, MOVE_MIDI_SOURCE_INTERNAL); }
        double s = now();
        api->render_block(inst, out, MOVE_FRAMES_PER_BLOCK);
        double d = now() - s; total += d; if (d > worst) { worst = d; worstAt = b; }
        if (b >= 50 && d > worstWarm) worstWarm = d;
        if (d > 0.0029) over++;
        for (int i = 0; i < MOVE_FRAMES_PER_BLOCK * 2; i++) {
            double v = out[i] / 32768.0; if (fabs(v) > peak) peak = fabs(v); rms += v * v; samples++;
        }
    }
    printf("render: %d blocks, avg %.1f us, worst %.1f us at block %d, worst after warm-up %.1f us, late blocks %d (budget 2902 us)\n",
           blocks, total / blocks * 1e6, worst * 1e6, worstAt, worstWarm * 1e6, over);
    printf("output: peak %.3f (%.1f dBFS), rms %.1f dBFS\n", peak, 20 * log10(peak + 1e-9), 10 * log10(rms / samples + 1e-12));
    api->destroy_instance(inst);
    return peak > 0.001 ? 0 : 3;
}
