// render-check: a sound generator heard without Live, the way the chain host
// loads it. dlopen()s a built module's dsp.so, creates an instance on the
// module's folder (its firmware and sounds beside it), waits until it says it
// runs, optionally chooses a sound, plays a chord and renders it, and says how
// loud it was. A module that boots and is silent, or crashes, fails here.
//
//   render-check <module dir> [seconds] [key=value | ?key ...]
//
// Writes <module dir>/../render-check.wav (16-bit stereo, 44.1 kHz) and exits
// 0 when the chord's peak is above -60 dB. scripts/render-check.sh runs it in
// the modules' build image, against the x86-64 dsp.so that ships.
#include <dlfcn.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "host/plugin_api_v1.h"

static void hlog(const char *m) { fprintf(stderr, "  [module] %s\n", m); }

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

static void wav(const char *path, const int16_t *pcm, int frames) {
    FILE *f = fopen(path, "wb");
    if (!f) return;
    uint32_t data = (uint32_t)frames * 4, riff = 36 + data, sr = 44100, br = 44100 * 4, fmt = 16;
    uint16_t pcmfmt = 1, ch = 2, ba = 4, bits = 16;
    fwrite("RIFF", 1, 4, f); fwrite(&riff, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f); fwrite(&fmt, 4, 1, f);
    fwrite(&pcmfmt, 2, 1, f); fwrite(&ch, 2, 1, f); fwrite(&sr, 4, 1, f); fwrite(&br, 4, 1, f);
    fwrite(&ba, 2, 1, f); fwrite(&bits, 2, 1, f); fwrite("data", 1, 4, f); fwrite(&data, 4, 1, f);
    fwrite(pcm, 4, (size_t)frames, f);
    fclose(f);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: render-check <module dir> [seconds] [key=value ...]\n");
        return 2;
    }
    const char *dir = argv[1];
    const double seconds = argc > 2 ? atof(argv[2]) : 2.0;
    char so[1024];
    snprintf(so, sizeof(so), "%s/dsp.so", dir);
    void *h = dlopen(so, RTLD_NOW | RTLD_LOCAL);
    if (!h) {
        fprintf(stderr, "FAIL: dlopen %s: %s\n", so, dlerror());
        return 1;
    }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(h, "move_plugin_init_v2");
    if (!init) {
        fprintf(stderr, "FAIL: no move_plugin_init_v2\n");
        return 1;
    }
    static host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    host.api_version = 1;
    host.sample_rate = 44100;
    host.frames_per_block = 128;
    host.log = hlog;
    plugin_api_v2_t *api = init(&host);
    void *in = api->create_instance(dir, NULL);
    if (!in) {
        fprintf(stderr, "FAIL: create_instance\n");
        return 1;
    }
    // until it runs: the status names the synth, and not a wait or a boot
    char st[256] = "";
    const double t0 = now_s();
    int16_t block[256];
    for (;;) {
        st[0] = 0;
        api->get_param(in, "status", st, sizeof(st));
        if (st[0] && !strstr(st, "Booting") && !strstr(st, "Starting") && !strstr(st, "Reading") && !strstr(st, "Warming") &&
            !strstr(st, "Waiting"))
            break;
        if (now_s() - t0 > 120) {
            fprintf(stderr, "FAIL: still \"%s\" after 120 s\n", st);
            return 1;
        }
        api->render_block(in, block, 128);
        usleep(20000);
    }
    char err[256] = "";
    if (api->get_error) api->get_error(in, err, sizeof(err));
    printf("status: %s (%.1f s)%s%s\n", st, now_s() - t0, err[0] ? ", error: " : "", err);
    if (err[0]) return 1;
    for (int i = 3; i < argc; i++) {
        char kv[512];
        snprintf(kv, sizeof(kv), "%s", argv[i]);
        if (kv[0] == '?') { // ?key: what the module answers for it now
            char val[512] = "";
            api->get_param(in, kv + 1, val, sizeof(val));
            printf("get %s = %s\n", kv + 1, val);
            continue;
        }
        char *eq = strchr(kv, '=');
        if (!eq) continue;
        *eq = 0;
        api->set_param(in, kv, eq + 1);
        printf("set %s = %s\n", kv, eq + 1);
    }
    char name[128] = "";
    api->get_param(in, "preset_name", name, sizeof(name));
    printf("sound: %s\n", name);
    // the sound settles (a dump into the synth), then a chord, held, then let go
    const int total = (int)(seconds * 44100) / 128;
    int16_t *pcm = calloc((size_t)(total + 400 + 44100 * 10 / 128) * 128 * 2, sizeof(int16_t));
    int frames = 0;
    // (RENDER_SETTLE_MS: a synth that is silent while it takes a sound in, the Microwave XT)
    const char *settle_env = getenv("RENDER_SETTLE_MS");
    const int settle_blocks = (settle_env ? atoi(settle_env) : 290) * 44100 / 128 / 1000;
    for (int b = 0; b < settle_blocks; b++) {
        api->render_block(in, pcm + frames * 2, 128);
        frames += 128;
        usleep(2900);
    }
    const int settle = frames;
    const uint8_t notes[] = {48, 55, 60, 64};
    for (int i = 0; i < 4; i++) {
        uint8_t on[3] = {0x90, notes[i], 100};
        api->on_midi(in, on, 3, 0);
    }
    int underruns = 0;
    double peak = 0, sum = 0;
    long n = 0;
    for (int b = 0; b < total; b++) {
        if (b == total * 3 / 4)
            for (int i = 0; i < 4; i++) {
                uint8_t off[3] = {0x80, notes[i], 0};
                api->on_midi(in, off, 3, 0);
            }
        // paced like the host: a block every 2.9 ms
        const double due = now_s() + 128.0 / 44100;
        api->render_block(in, pcm + frames * 2, 128);
        for (int i = 0; i < 256; i++) {
            const double s = pcm[frames * 2 + i] / 32768.0;
            peak = fabs(s) > peak ? fabs(s) : peak;
            sum += s * s;
            n++;
        }
        frames += 128;
        while (now_s() < due) usleep(200);
    }
    char dbg[256] = "";
    api->get_param(in, "debug_info", dbg, sizeof(dbg));
    const double pdb = peak > 0 ? 20 * log10(peak) : -120, rdb = sum > 0 ? 10 * log10(sum / n) : -120;
    printf("chord: peak %.1f dB, rms %.1f dB over %.1f s (%d frames settled first)\n", pdb, rdb, seconds, settle);
    printf("engine: %s\n", dbg);
    // ?key again, after: what the module took a while to find out
    for (int i = 3; i < argc; i++) {
        if (argv[i][0] != '?') continue;
        static char val[8192];
        val[0] = 0;
        api->get_param(in, argv[i] + 1, val, sizeof(val));
        printf("after %s = %s\n", argv[i] + 1, val);
    }
    char out[1100];
    snprintf(out, sizeof(out), "%s/../render-check.wav", dir);
    wav(out, pcm, frames);
    printf("wrote %s\n", out);
    (void)underruns;
    api->destroy_instance(in);
    if (pdb < -60) {
        printf("FAIL: silent\n");
        return 1;
    }
    printf("PASS\n");
    return 0;
}
