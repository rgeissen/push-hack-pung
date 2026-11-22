// Vivace's factory sounds, made here in code on the engine and written as
// preset files at build time (vivace-export factory <folder>): the package's
// factory/ bank. Their wavetables are drawn here too (additive spectra and
// shapes, computed), so nothing in them comes from anywhere else.
//
// Copyright (C) 2026 Pung contributors. These sounds are part of Vivace and
// licensed, like the engine they are made for, under the GNU General Public
// License version 3 or later.
//
// Values are the engine's own (its parameter tables): a cutoff in semitones
// (60 is middle C), an envelope time t as t^4 seconds, an LFO rate r as 2^r
// Hz, a level l as l^2, a modulation amount as a share of the destination's
// whole range.
#include "vivace_factory.h"

#include <cmath>
#include <functional>
#include <string>

#include "JuceHeader.h"
#include "line_generator.h"
#include "synth_base.h"
#include "wave_source.h"
#include "wavetable_creator.h"
#include "wavetable_group.h"

namespace vivace {
namespace {

const float kPi = 3.14159265358979f;
const int N = vital::WaveFrame::kWaveformSize;

typedef std::function<void(float *wave, float morph)> Draw;

// A wavetable of `keys` key frames spread over the table's 257 positions,
// each drawn by `draw` at its share of the way (0..1); the engine morphs
// between them in the spectrum (`spectral`) or in time.
void table(SynthBase &s, int osc, const char *name, int keys, bool spectral, Draw draw) {
    WavetableCreator *c = s.getWavetableCreator(osc);
    c->clear();
    WavetableGroup *g = new WavetableGroup();
    WaveSource *src = new WaveSource();
    src->setInterpolationMode(spectral ? WaveSource::kFrequency : WaveSource::kTime);
    for (int k = 0; k < keys; k++) {
        const int pos = keys == 1 ? 0 : int(std::lround(k * 256.0 / (keys - 1)));
        src->insertNewKeyframe(pos);
        vital::WaveFrame *f = src->getWaveFrame(k);
        draw(f->time_domain, keys == 1 ? 0.0f : float(k) / float(keys - 1));
        f->toFrequencyDomain();
    }
    g->addComponent(src);
    c->addGroup(g);
    c->setName(name);
    c->render();
}

// A sum of harmonics: amp(h, morph), sine phase.
void additive(float *w, float morph, int harmonics, const std::function<float(int, float)> &amp) {
    for (int i = 0; i < N; i++) w[i] = 0;
    for (int h = 1; h <= harmonics; h++) {
        const float a = amp(h, morph);
        if (a == 0) continue;
        for (int i = 0; i < N; i++) w[i] += a * std::sin(2 * kPi * h * i / N);
    }
}

void set(SynthBase &s, const char *k, float v) { s.getControls()[k]->set(v); }

void mod(SynthBase &s, const char *src, const char *dst, float amount, bool bipolar = false) {
    s.connectModulation(src, dst);
    const int i = s.getConnectionIndex(src, dst);
    if (i < 0) return;
    const std::string p = "modulation_" + std::to_string(i + 1) + "_";
    set(s, (p + "amount").c_str(), amount);
    if (bipolar) set(s, (p + "bipolar").c_str(), 1);
}

float secs(float t) { return std::pow(t, 0.25f); }   // an envelope time
float rate(float hz) { return std::log2(hz); }       // an LFO rate in Hz
float level(float l) { return std::sqrt(l); }        // an oscillator level

void env(SynthBase &s, int n, float a, float d, float su, float r) {
    const std::string p = "env_" + std::to_string(n) + "_";
    set(s, (p + "attack").c_str(), secs(a));
    set(s, (p + "decay").c_str(), secs(d));
    set(s, (p + "sustain").c_str(), su);
    set(s, (p + "release").c_str(), secs(r));
}

void filter(SynthBase &s, int n, int model, int style, float cutoff, float reso, float drive = 0, float blend = 0) {
    const std::string p = "filter_" + std::to_string(n) + "_";
    set(s, (p + "on").c_str(), 1);
    set(s, (p + "model").c_str(), float(model));
    set(s, (p + "style").c_str(), float(style));
    set(s, (p + "cutoff").c_str(), cutoff);
    set(s, (p + "resonance").c_str(), reso);
    set(s, (p + "drive").c_str(), drive);
    set(s, (p + "blend").c_str(), blend);
}

void reverb(SynthBase &s, float mix, float decaySecs, float size) {
    set(s, "reverb_on", 1);
    set(s, "reverb_dry_wet", mix);
    set(s, "reverb_decay_time", std::log2(decaySecs));
    set(s, "reverb_size", size);
}

// ---- the wavetables ---------------------------------------------------------------

Draw harmonicSweep() { // a sine growing into a bright, soft-cornered saw
    return [](float *w, float m) {
        additive(w, m, 96, [](int h, float m) { return (1.0f / h) * std::exp(-float(h - 1) / (0.4f + 40.0f * m * m)); });
    };
}

Draw pulseWidth() { // a square narrowing to a thin pulse
    return [](float *w, float m) {
        const float width = 0.5f - 0.46f * m;
        for (int i = 0; i < N; i++) w[i] = (float(i) / N < width) ? 1.0f : -1.0f;
    };
}

Draw vowels() { // a voice singing a, e, i, o, u: the harmonics of 130 Hz under two formants each
    return [](float *w, float m) {
        static const float f[5][3] = {{800, 1150, 2800}, {400, 2000, 2550}, {300, 2300, 3000}, {450, 800, 2830}, {325, 700, 2530}};
        const float x = m * 4;
        const int a = std::min(3, int(x));
        const float t = x - a;
        float fm[3];
        for (int k = 0; k < 3; k++) fm[k] = f[a][k] + (f[a + 1][k] - f[a][k]) * t;
        additive(w, m, 48, [&](int h, float) {
            const float hz = 130.0f * h;
            float e = 0;
            for (int k = 0; k < 3; k++) {
                const float bw = 80.0f + 0.08f * fm[k];
                e += (k == 2 ? 0.25f : 1.0f) * std::exp(-0.5f * ((hz - fm[k]) / bw) * ((hz - fm[k]) / bw));
            }
            return (0.08f + e) / std::sqrt(float(h));
        });
    };
}

Draw syncSweep() { // a sine re-started faster and faster in each cycle, its edge softened
    return [](float *w, float m) {
        const float ratio = 1.0f + 7.0f * m;
        for (int i = 0; i < N; i++) {
            const float t = float(i) / N;
            const float win = std::sin(kPi * t);
            w[i] = std::sin(2 * kPi * ratio * t) * (0.35f + 0.65f * win);
        }
    };
}

Draw folds() { // a sine driven into a wavefolder, harder each frame
    return [](float *w, float m) {
        const float g = 1.0f + 7.0f * m;
        for (int i = 0; i < N; i++) w[i] = std::sin(0.5f * kPi * g * std::sin(2 * kPi * float(i) / N));
    };
}

Draw organ() { // drawbars: a mellow stop opening into a full one
    return [](float *w, float m) {
        additive(w, m, 16, [](int h, float m) {
            switch (h) {
            case 1: return 1.0f;
            case 2: return 0.8f;
            case 3: return 0.5f + 0.3f * m;
            case 4: return 0.25f + 0.45f * m;
            case 6: return 0.5f * m;
            case 8: return 0.45f * m;
            case 10: return 0.2f * m;
            case 12: return 0.25f * m;
            case 16: return 0.15f * m;
            }
            return 0.0f;
        });
    };
}

Draw sawSquare() { // a saw turning into a square: its even harmonics fading
    return [](float *w, float m) {
        additive(w, m, 128, [](int h, float m) { return (h % 2 ? 1.0f : 1.0f - m) / h; });
    };
}

Draw glassBell() { // odd partials far out, the upper ones growing: glass
    return [](float *w, float m) {
        additive(w, m, 64, [](int h, float m) {
            static const int part[] = {1, 3, 7, 12, 19, 27, 38, 52};
            for (int k = 0; k < 8; k++)
                if (h == part[k]) return std::pow(0.6f + 0.3f * m, float(k));
            return 0.0f;
        });
    };
}

Draw sine() {
    return [](float *w, float) {
        for (int i = 0; i < N; i++) w[i] = std::sin(2 * kPi * float(i) / N);
    };
}

// ---- the sounds ------------------------------------------------------------------------

struct Sound {
    const char *name, *style;
    void (*build)(SynthBase &);
};

void init(SynthBase &) {}

void glassPad(SynthBase &s) {
    table(s, 0, "Harmonic Sweep", 5, true, harmonicSweep());
    table(s, 1, "Glass", 3, true, glassBell());
    set(s, "osc_1_unison_voices", 5);
    set(s, "osc_1_unison_detune", 4.0f);
    set(s, "osc_1_wave_frame", 70);
    set(s, "osc_2_on", 1);
    set(s, "osc_2_transpose", 12);
    set(s, "osc_2_level", level(0.25f));
    set(s, "osc_2_destination", 0);
    filter(s, 1, 0, 0, 92, 0.2f);
    env(s, 1, 0.9f, 1.5f, 0.85f, 3.0f);
    s.getLfoSource(0)->initSin();
    set(s, "lfo_1_sync", 0);
    set(s, "lfo_1_frequency", rate(0.12f));
    mod(s, "lfo_1", "osc_1_wave_frame", 0.35f);
    mod(s, "lfo_1", "osc_2_wave_frame", 0.5f);
    mod(s, "macro_control_1", "filter_1_cutoff", 0.25f);
    mod(s, "macro_control_2", "osc_1_wave_frame", 0.5f);
    set(s, "chorus_on", 1);
    set(s, "chorus_dry_wet", 0.35f);
    reverb(s, 0.35f, 4.0f, 0.75f);
    s.setMacroName(0, "BRIGHT");
    s.setMacroName(1, "MOTION");
}

void lead(SynthBase &s) {
    table(s, 0, "Saw to Square", 3, true, sawSquare());
    set(s, "osc_1_unison_voices", 3);
    set(s, "osc_1_unison_detune", 2.5f);
    set(s, "osc_1_distortion_type", 1); // sync
    set(s, "osc_1_distortion_amount", 0.15f);
    mod(s, "env_2", "osc_1_distortion_amount", 0.45f);
    env(s, 2, 0.002f, 0.5f, 0.2f, 0.3f);
    set(s, "osc_1_level", 1.0f);
    filter(s, 1, 2, 1, 106, 0.3f, 6);
    mod(s, "velocity", "filter_1_cutoff", 0.15f);
    env(s, 1, 0.003f, 1.0f, 0.9f, 0.25f);
    set(s, "portamento_time", std::log2(0.06f));
    set(s, "polyphony", 1);
    set(s, "legato", 1);
    s.getLfoSource(0)->initSin();
    set(s, "lfo_1_sync", 1);
    set(s, "lfo_1_tempo", 10); // 1/16
    set(s, "lfo_1_fade_time", 1.0f);
    mod(s, "lfo_1", "osc_1_tune", 0.08f, true);
    mod(s, "macro_control_1", "osc_1_distortion_amount", 0.5f);
    set(s, "delay_on", 1);
    set(s, "delay_dry_wet", 0.25f);
    set(s, "delay_sync", 2); // dotted
    set(s, "delay_tempo", 9); // 1/8
    reverb(s, 0.18f, 2.0f, 0.5f);
    s.setMacroName(0, "SYNC");
}

void subBass(SynthBase &s) {
    table(s, 0, "Sine", 1, false, sine());
    table(s, 1, "Saw to Square", 3, true, sawSquare());
    set(s, "osc_1_transpose", -12);
    set(s, "osc_1_level", level(0.7f));
    set(s, "osc_2_on", 1);
    set(s, "osc_2_transpose", -12);
    set(s, "osc_2_destination", 0);
    set(s, "osc_2_level", level(0.45f));
    filter(s, 1, 3, 1, 52, 0.25f, 3);
    env(s, 2, 0.0f, 0.25f, 0.0f, 0.2f);
    mod(s, "env_2", "filter_1_cutoff", 0.3f);
    env(s, 1, 0.0f, 0.6f, 0.85f, 0.08f);
    set(s, "polyphony", 1);
    set(s, "legato", 1);
    set(s, "portamento_time", std::log2(0.03f));
    mod(s, "macro_control_1", "filter_1_cutoff", 0.3f);
    mod(s, "macro_control_2", "osc_2_wave_frame", 1.0f);
    s.setMacroName(0, "CUTOFF");
    s.setMacroName(1, "SQUARE");
}

void pulseKeys(SynthBase &s) {
    table(s, 0, "Pulse Width", 5, false, pulseWidth());
    set(s, "osc_1_wave_frame", 30);
    set(s, "osc_1_unison_voices", 2);
    set(s, "osc_1_unison_detune", 2.0f);
    s.getLfoSource(0)->initTriangle();
    set(s, "lfo_1_sync", 0);
    set(s, "lfo_1_frequency", rate(0.7f));
    mod(s, "lfo_1", "osc_1_wave_frame", 0.3f);
    filter(s, 1, 0, 1, 70, 0.15f);
    env(s, 2, 0.001f, 0.8f, 0.25f, 0.6f);
    mod(s, "env_2", "filter_1_cutoff", 0.32f);
    mod(s, "velocity", "filter_1_cutoff", 0.12f);
    env(s, 1, 0.002f, 1.6f, 0.4f, 0.5f);
    set(s, "chorus_on", 1);
    set(s, "chorus_dry_wet", 0.45f);
    reverb(s, 0.2f, 1.6f, 0.45f);
    mod(s, "macro_control_1", "filter_1_cutoff", 0.25f);
    s.setMacroName(0, "TONE");
}

void choir(SynthBase &s) {
    table(s, 0, "Vowels", 5, true, vowels());
    set(s, "osc_1_unison_voices", 6);
    set(s, "osc_1_unison_detune", 3.2f);
    set(s, "osc_1_stereo_spread", 1.0f);
    s.getLfoSource(0)->initSin();
    set(s, "lfo_1_sync", 0);
    set(s, "lfo_1_frequency", rate(0.08f));
    mod(s, "lfo_1", "osc_1_wave_frame", 1.0f);
    mod(s, "macro_control_1", "osc_1_wave_frame", 0.5f);
    env(s, 1, 0.6f, 1.0f, 1.0f, 2.2f);
    filter(s, 1, 0, 0, 110, 0.0f);
    reverb(s, 0.45f, 5.5f, 0.85f);
    s.setMacroName(0, "VOWEL");
}

void pluck(SynthBase &s) {
    table(s, 0, "Harmonic Sweep", 5, true, harmonicSweep());
    set(s, "osc_1_wave_frame", 256);
    set(s, "osc_2_on", 1);
    table(s, 1, "Pulse Width", 5, false, pulseWidth());
    set(s, "osc_2_transpose", 12);
    set(s, "osc_2_level", level(0.3f));
    set(s, "osc_2_destination", 0);
    filter(s, 1, 0, 1, 58, 0.35f);
    env(s, 2, 0.0f, 0.22f, 0.0f, 0.22f);
    mod(s, "env_2", "filter_1_cutoff", 0.42f);
    env(s, 1, 0.0f, 0.9f, 0.0f, 0.5f);
    set(s, "delay_on", 1);
    set(s, "delay_dry_wet", 0.3f);
    set(s, "delay_style", 2); // ping pong
    set(s, "delay_sync", 1);
    set(s, "delay_tempo", 9);
    set(s, "delay_feedback", 0.45f);
    reverb(s, 0.22f, 2.5f, 0.6f);
    mod(s, "macro_control_1", "env_2_decay", 0.3f);
    s.setMacroName(0, "DECAY");
}

void wobble(SynthBase &s) {
    table(s, 0, "Sync Sweep", 5, false, syncSweep());
    set(s, "osc_1_transpose", -12);
    set(s, "osc_1_unison_voices", 2);
    set(s, "osc_1_unison_detune", 1.5f);
    s.getLfoSource(0)->initSin();
    set(s, "lfo_1_sync", 1);
    set(s, "lfo_1_tempo", 9); // 1/8
    set(s, "lfo_1_sync_type", 1);
    mod(s, "lfo_1", "osc_1_wave_frame", 0.7f);
    mod(s, "lfo_1", "filter_1_cutoff", 0.25f);
    filter(s, 1, 1, 1, 60, 0.45f, 8);
    env(s, 1, 0.0f, 1.0f, 1.0f, 0.1f);
    set(s, "polyphony", 1);
    set(s, "legato", 1);
    set(s, "distortion_on", 1);
    set(s, "distortion_type", 0);
    set(s, "distortion_drive", 8);
    set(s, "distortion_mix", 0.6f);
    mod(s, "macro_control_1", "filter_1_resonance", 0.4f);
    s.setMacroName(0, "SNARL");
}

void bells(SynthBase &s) {
    table(s, 0, "Glass", 3, true, glassBell());
    set(s, "osc_1_spectral_morph_type", 4); // inharmonic stretch
    set(s, "osc_1_spectral_morph_amount", 0.35f);
    mod(s, "env_2", "osc_1_spectral_morph_amount", 0.25f);
    env(s, 2, 0.0f, 1.8f, 0.0f, 1.8f);
    env(s, 1, 0.0f, 4.0f, 0.0f, 3.5f);
    set(s, "osc_2_on", 1);
    table(s, 1, "Sine", 1, false, sine());
    set(s, "osc_2_transpose", 24);
    set(s, "osc_2_level", level(0.2f));
    set(s, "osc_2_destination", 3);
    reverb(s, 0.4f, 6.0f, 0.8f);
    set(s, "chorus_on", 1);
    set(s, "chorus_dry_wet", 0.25f);
    mod(s, "macro_control_1", "osc_1_spectral_morph_amount", 0.5f);
    mod(s, "velocity", "osc_1_wave_frame", 0.6f);
    s.setMacroName(0, "STRETCH");
}

void superSaw(SynthBase &s) {
    table(s, 0, "Saw to Square", 3, true, sawSquare());
    set(s, "osc_1_unison_voices", 7);
    set(s, "osc_1_unison_detune", 4.4f);
    set(s, "osc_1_unison_blend", 0.7f);
    set(s, "osc_1_stereo_spread", 1.0f);
    set(s, "osc_2_on", 1);
    table(s, 1, "Saw to Square", 3, true, sawSquare());
    set(s, "osc_2_transpose", -12);
    set(s, "osc_2_level", level(0.35f));
    set(s, "osc_2_destination", 0);
    filter(s, 1, 0, 0, 104, 0.1f);
    env(s, 1, 0.01f, 1.0f, 1.0f, 0.45f);
    set(s, "chorus_on", 1);
    set(s, "chorus_dry_wet", 0.25f);
    reverb(s, 0.25f, 2.8f, 0.6f);
    mod(s, "macro_control_1", "osc_1_unison_detune", 0.3f);
    mod(s, "macro_control_2", "filter_1_cutoff", -0.3f);
    s.setMacroName(0, "DETUNE");
    s.setMacroName(1, "DARKER");
}

void foldDrone(SynthBase &s) {
    table(s, 0, "Wave Folder", 5, false, folds());
    set(s, "osc_1_unison_voices", 3);
    set(s, "osc_1_unison_detune", 1.8f);
    set(s, "random_1_style", 0); // perlin
    set(s, "random_1_frequency", rate(0.3f));
    mod(s, "random_1", "osc_1_wave_frame", 0.6f);
    set(s, "lfo_2_sync", 0);
    set(s, "lfo_2_frequency", rate(0.05f));
    filter(s, 1, 6, 0, 76, 0.4f); // comb
    mod(s, "lfo_2", "filter_1_cutoff", 0.15f);
    env(s, 1, 1.5f, 1.0f, 1.0f, 4.0f);
    reverb(s, 0.5f, 7.0f, 0.9f);
    mod(s, "macro_control_1", "osc_1_wave_frame", 0.5f);
    s.setMacroName(0, "FOLD");
}

void organSound(SynthBase &s) {
    table(s, 0, "Drawbars", 2, true, organ());
    set(s, "osc_1_wave_frame", 0);
    mod(s, "mod_wheel", "osc_1_wave_frame", 1.0f);
    mod(s, "macro_control_1", "osc_1_wave_frame", 1.0f);
    env(s, 1, 0.004f, 1.0f, 1.0f, 0.06f);
    set(s, "chorus_on", 1);
    set(s, "chorus_dry_wet", 0.5f);
    set(s, "chorus_voices", 2);
    set(s, "chorus_frequency", std::log2(1.0f / 6.0f));
    reverb(s, 0.18f, 1.8f, 0.45f);
    s.setMacroName(0, "DRAWBARS");
}

const Sound kSounds[] = {
    {"Init", "Template", init},
    {"Glass Pad", "Pad", glassPad},
    {"Sync Lead", "Lead", lead},
    {"Deep Sub", "Bass", subBass},
    {"Pulse Keys", "Keys", pulseKeys},
    {"Vowel Choir", "Pad", choir},
    {"Bright Pluck", "Keys", pluck},
    {"Sync Wobble", "Bass", wobble},
    {"Stretched Bells", "Keys", bells},
    {"Wide Saws", "Lead", superSaw},
    {"Folded Drone", "Experiment", foldDrone},
    {"Drawbar Organ", "Keys", organSound},
};

} // namespace

int factoryCount() { return int(sizeof(kSounds) / sizeof(kSounds[0])); }
const char *factoryName(int i) { return kSounds[i].name; }

void buildFactory(SynthBase &s, int i) {
    kSounds[i].build(s);
    s.setPresetName(kSounds[i].name);
    s.setAuthor("Vivace (Pung)");
    s.setStyle(kSounds[i].style);
    s.setComments("A Vivace factory sound. GPL-3.0-or-later.");
}

} // namespace vivace
