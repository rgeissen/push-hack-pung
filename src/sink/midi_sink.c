/*
 * midi_sink: the instrument behind a Schwung MIDI-effect device.
 *
 * A MIDI-effect device is a chain with the effect in midi_fx1 and this in the
 * synth position. The chain hands its MIDI FX output to the synth -- from
 * process_midi and from tick(), after every later MIDI FX -- so catching it
 * here gives exactly what the effect played, with nothing taken out.
 *
 * Schwung's "pre mode" was the first route and is the wrong one on Push: it
 * is built for Move playing the same notes natively, so it drops output on a
 * held pitch (an arpeggio over one held note is silent) and the root of a
 * chord. This sink passes every message on through midi_send_internal, which
 * the service's bridge queues as the device's MIDI out.
 *
 * Renders silence. Hidden from every list: component_type "system".
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"

static const host_api_v1_t *g_host;

typedef struct { int unused; } sink_t;

static void *create(const char *dir, const char *defaults) {
    (void)dir; (void)defaults;
    return calloc(1, sizeof(sink_t));
}
static void destroy(void *inst) { free(inst); }

static void on_midi(void *inst, const uint8_t *msg, int len, int source) {
    (void)inst; (void)source;
    if (!g_host || !g_host->midi_send_internal || len < 1) return;
    uint8_t st = msg[0];
    if (st < 0x80 || st >= 0xF0) return; /* channel messages only */
    uint8_t pkt[4] = { (uint8_t)(st >> 4), st, len > 1 ? msg[1] : 0, len > 2 ? msg[2] : 0 };
    g_host->midi_send_internal(pkt, 4);
}
static void set_param(void *inst, const char *k, const char *v) { (void)inst; (void)k; (void)v; }
static int get_param(void *inst, const char *k, char *buf, int n) {
    (void)inst; (void)k; (void)buf; (void)n;
    return -1; /* no parameters */
}
static void render(void *inst, int16_t *out, int frames) {
    (void)inst;
    memset(out, 0, sizeof(int16_t) * 2 * (size_t)frames);
}

static plugin_api_v2_t api = {
    .api_version = MOVE_PLUGIN_API_VERSION_2,
    .create_instance = create,
    .destroy_instance = destroy,
    .on_midi = on_midi,
    .set_param = set_param,
    .get_param = get_param,
    .render_block = render,
};

plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    return &api;
}
