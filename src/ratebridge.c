/* ratebridge.c: see ratebridge.h */
#include "ratebridge.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define TAPS (RB_HALF * 2)
#define PHASES 256
#define CAP (RB_MAX_MOD + TAPS + 64) /* frames a line holds: the most one block brings, and what is kept */

/* One direction: a line of the source's frames and the place in it (in its
 * frames, with a fraction) the next output frame stands at. */
typedef struct {
    double pos, step; /* step: the source's frames to one of the output's */
    int n;            /* frames in buf */
    float table[(PHASES + 1) * TAPS];
    float buf[CAP * 2];
} line;

struct ratebridge {
    int effect;
    line out; /* the module's frames -> the host's */
    line in;  /* the host's frames -> the module's (an effect) */
};

static double window(double x) { /* Blackman-Harris over -1..1 */
    if (x <= -1 || x >= 1) return 0;
    double t = M_PI * (x + 1);
    return 0.35875 - 0.48829 * cos(t) + 0.14128 * cos(2 * t) - 0.01168 * cos(3 * t);
}

/* lead: frames of silence put in front, so that the first output needs
 * nothing from before the source's first frame (and, for an effect's input,
 * stands RB_HALF + RB_SLACK frames behind what has arrived). */
static void line_init(line *l, double step, int lead) {
    memset(l, 0, sizeof *l);
    l->step = step;
    l->n = RB_HALF - 1 + lead;
    l->pos = RB_HALF - 1;
    /* turning the rate down, the sinc is widened to the lower rate's limit */
    double c = step > 1 ? 1 / step : 1;
    for (int p = 0; p <= PHASES; p++) {
        double f = (double)p / PHASES, sum = 0;
        float *row = l->table + p * TAPS;
        for (int k = 0; k < TAPS; k++) {
            double x = (k - RB_HALF + 1) - f, s = x == 0 ? 1 : sin(M_PI * c * x) / (M_PI * c * x);
            double v = c * s * window(x / RB_HALF);
            row[k] = (float)v;
            sum += v;
        }
        for (int k = 0; k < TAPS; k++) row[k] = (float)(row[k] / sum); /* a steady level stays as it is */
    }
}

/* the source's frames still to come before `count` output frames can be made */
static int line_need(const line *l, int count) {
    if (count <= 0) return 0;
    int last = (int)floor(l->pos + (count - 1) * l->step);
    int need = last + RB_HALF + 1 - l->n;
    return need > 0 ? need : 0;
}

static void line_push(line *l, const float *src, int frames) {
    if (frames > CAP - l->n) frames = CAP - l->n; /* never by the counts above; a guard */
    if (frames <= 0) return;
    if (src) memcpy(l->buf + l->n * 2, src, sizeof(float) * 2 * (size_t)frames);
    else memset(l->buf + l->n * 2, 0, sizeof(float) * 2 * (size_t)frames);
    l->n += frames;
}

static void line_pull(line *l, float *dst, int count) {
    for (int o = 0; o < count; o++) {
        int i = (int)floor(l->pos);
        double f = l->pos - i, ph = f * PHASES;
        int p = (int)ph;
        float a = (float)(ph - p);
        const float *r0 = l->table + p * TAPS, *r1 = r0 + TAPS;
        const float *s = l->buf + (i - RB_HALF + 1) * 2;
        float L = 0, R = 0;
        if (i + RB_HALF < l->n) {
            for (int k = 0; k < TAPS; k++) {
                float w = r0[k] + (r1[k] - r0[k]) * a;
                L += s[k * 2] * w;
                R += s[k * 2 + 1] * w;
            }
        }
        dst[o * 2] = L;
        dst[o * 2 + 1] = R;
        l->pos += l->step;
    }
    /* what no later frame reads is let go */
    int drop = (int)floor(l->pos) - RB_HALF + 1;
    if (drop > l->n) drop = l->n;
    if (drop > 0) {
        memmove(l->buf, l->buf + drop * 2, sizeof(float) * 2 * (size_t)(l->n - drop));
        l->n -= drop;
        l->pos -= drop;
    }
}

ratebridge *rb_new(int host_rate, int effect) {
    if (host_rate == RB_MODULE_RATE || host_rate < RB_MODULE_RATE / 2 || host_rate > 768000) return NULL;
    ratebridge *rb = malloc(sizeof *rb);
    if (!rb) return NULL;
    rb->effect = effect != 0;
    line_init(&rb->out, (double)RB_MODULE_RATE / host_rate, 0);
    line_init(&rb->in, (double)host_rate / RB_MODULE_RATE, rb_latency(host_rate, 1));
    return rb;
}

void rb_free(ratebridge *rb) { free(rb); }

int rb_need(const ratebridge *rb, int host_frames) {
    int n = line_need(&rb->out, host_frames);
    return n > RB_MAX_MOD ? RB_MAX_MOD : n;
}

void rb_in(ratebridge *rb, const float *host_in, int host_frames, float *mod_in, int need) {
    line_push(&rb->in, host_in, host_frames);
    line_pull(&rb->in, mod_in, need);
}

void rb_out(ratebridge *rb, const float *mod_out, int need, float *host_out, int host_frames) {
    line_push(&rb->out, mod_out, need);
    line_pull(&rb->out, host_out, host_frames);
}

int rb_latency(int host_rate, int effect) {
    if (host_rate == RB_MODULE_RATE || host_rate < RB_MODULE_RATE / 2) return 0;
    /* an instrument: the module renders RB_HALF of its frames ahead of what is
     * heard, so a note sounds that much later. An effect: its input must have
     * arrived for those frames too, and for the points around each: it is held
     * back by this many of the host's frames, and that is the whole delay. */
    if (!effect) return (int)lround((double)RB_HALF * host_rate / RB_MODULE_RATE);
    return RB_HALF + RB_SLACK + (int)ceil((double)RB_HALF * host_rate / RB_MODULE_RATE);
}
