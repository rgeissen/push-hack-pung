// vivace_wtbuild.cpp: builds Vivace's wavetable library at build time
// (vivace-export wavetables <AKWF folder> <out folder>; the format:
// vivace_wavetables.h). Nothing here runs on the Push.
//
// Two sources, both free to ship:
//
//   AKWF, the Adventure Kid Waveforms (CC0 1.0, public domain; pinned in
//   native/catalog.json): ~4300 single cycles of 600 samples, in families
//   (saws, organs, voices, FM, chip, strings, ...). A family becomes tables:
//   its cycles ordered so each is the nearest to the one before (their
//   spectra, in dB), so moving through a table morphs instead of jumping;
//   near duplicates dropped; at most 16 frames a table.
//
//   Pung's own tables, computed here: the morphs a sampled cycle cannot give
//   (shapes, pulse width, sync, bit depth, folding, FM index, vowels from
//   formants, organ registrations, spectral sweeps).
//
// Every frame is band-limited to the engine's 2048-sample frame (its
// harmonics resynthesised, nothing above 1023), without DC, phase-aligned
// (its strongest low harmonic at the phase of a sine starting at 0, so two
// frames of a table do not cancel as they morph), and at a peak of 0.9.
#include "vivace_wavetables.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <functional>
#include <map>
#include <random>
#include <string>
#include <sys/stat.h>
#include <vector>

using json = nlohmann::json;
using cd = std::complex<double>;

namespace wtb {

constexpr int N = wtlib::kFrame; // samples a frame
constexpr int H = N / 2;         // harmonics 1..H-1
constexpr int kMaxFrames = 16;   // a table's keyframes
constexpr double kPi = 3.14159265358979323846;

// ---- spectra and frames ---------------------------------------------------------

typedef std::vector<cd> Spec; // H complex amplitudes: x(t) = sum Re(c_k e^{i 2pi k t})

void fft(std::vector<cd> &a, bool inverse) {
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; i++) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = 2 * kPi / double(len) * (inverse ? 1 : -1);
        const cd wl(std::cos(ang), std::sin(ang));
        for (size_t i = 0; i < n; i += len) {
            cd w(1);
            for (size_t j = 0; j < len / 2; j++) {
                const cd u = a[i + j], v = a[i + j + len / 2] * w;
                a[i + j] = u + v;
                a[i + j + len / 2] = u - v;
                w *= wl;
            }
        }
    }
}

// a cycle of any length (an AKWF file): its harmonics, directly
Spec analyse(const std::vector<float> &x) {
    const int L = int(x.size());
    const int K = std::min(H - 1, L / 2 - 1);
    Spec c(H, 0.0);
    for (int k = 1; k <= K; k++) {
        cd s = 0;
        for (int n = 0; n < L; n++) {
            const double a = -2 * kPi * k * n / L;
            s += double(x[size_t(n)]) * cd(std::cos(a), std::sin(a));
        }
        c[size_t(k)] = s * (2.0 / L);
    }
    return c;
}

// a cycle given as a function of t in [0, 1): sampled 16 times finer than a
// frame, its harmonics by FFT (what lies above the frame's Nyquist is dropped)
Spec analyse(const std::function<double(double)> &f) {
    const int M = N * 16;
    std::vector<cd> a(static_cast<size_t>(M));
    for (int n = 0; n < M; n++) a[size_t(n)] = f(double(n) / M);
    fft(a, false);
    Spec c(H, 0.0);
    for (int k = 1; k < H; k++) c[size_t(k)] = a[size_t(k)] * (2.0 / M);
    return c;
}

// the spectrum as a frame of N samples, at a peak of 0.9
std::vector<float> render(const Spec &c) {
    std::vector<cd> a(size_t(N), 0.0);
    for (int k = 1; k < H; k++) {
        a[size_t(k)] = c[size_t(k)] * 0.5;
        a[size_t(N - k)] = std::conj(c[size_t(k)]) * 0.5;
    }
    fft(a, true);
    std::vector<float> x(static_cast<size_t>(N));
    double peak = 0;
    for (int n = 0; n < N; n++) peak = std::max(peak, std::fabs(a[size_t(n)].real()));
    const double g = peak > 1e-9 ? 0.9 / peak : 0;
    for (int n = 0; n < N; n++) x[size_t(n)] = float(a[size_t(n)].real() * g);
    return x;
}

double energy(const Spec &c) {
    double e = 0;
    for (const cd &v : c) e += std::norm(v);
    return e;
}

// the whole cycle shifted so its reference harmonic (the fundamental, or the
// strongest of the first eight when the fundamental is weak) starts as a sine
void align(Spec &c) {
    int r = 1;
    double best = 0;
    for (int k = 1; k <= 8; k++)
        if (std::abs(c[size_t(k)]) > best) best = std::abs(c[size_t(k)]), r = k;
    if (std::abs(c[1]) >= 0.25 * best) r = 1;
    if (best <= 0) return;
    const double d = (std::arg(c[size_t(r)]) + kPi / 2) / r; // the shift, in radians of the fundamental
    for (int k = 1; k < H; k++) c[size_t(k)] *= std::polar(1.0, -k * d);
}

// what ordering compares: the first 64 harmonics' levels in dB below the loudest
std::vector<float> profile(const Spec &c) {
    double mx = 1e-12;
    for (int k = 1; k <= 64; k++) mx = std::max(mx, std::abs(c[size_t(k)]));
    std::vector<float> p(64);
    for (int k = 1; k <= 64; k++) p[size_t(k - 1)] = float(std::max(-60.0, 20 * std::log10(std::abs(c[size_t(k)]) / mx + 1e-9)));
    return p;
}

double distance(const std::vector<float> &a, const std::vector<float> &b) {
    double d = 0;
    for (size_t i = 0; i < a.size(); i++) d += double(a[i] - b[i]) * (a[i] - b[i]);
    return std::sqrt(d / double(a.size()));
}

double brightness(const Spec &c) {
    double e = 0, w = 0;
    for (int k = 1; k < H; k++) {
        const double p = std::norm(c[size_t(k)]);
        e += p;
        w += p * k;
    }
    return e > 0 ? w / e : 0;
}

// ---- tables ------------------------------------------------------------------------

struct Out {
    std::string name, source;
    std::vector<std::vector<float>> frames;
};

struct Cat {
    std::string name, file;
    std::vector<Out> tables;
};

// a table from spectra, as given (already in order)
Out table(const std::string &name, const std::string &source, std::vector<Spec> specs) {
    Out o;
    o.name = name;
    o.source = source;
    for (Spec &s : specs) {
        if (energy(s) < 1e-12) continue;
        align(s);
        o.frames.push_back(render(s));
    }
    return o;
}

// a table computed: frames f(p, t), p from 0 to 1 across the table
Out gen(const std::string &name, int frames, const std::function<double(double, double)> &f) {
    std::vector<Spec> s;
    for (int i = 0; i < frames; i++) {
        const double p = frames == 1 ? 0 : double(i) / (frames - 1);
        s.push_back(analyse([&](double t) { return f(p, t); }));
    }
    return table(name, "Pung", s);
}

// a table from harmonic amplitudes: a(p, k), sine phase
Out additive(const std::string &name, int frames, const std::function<double(double, int)> &a) {
    std::vector<Spec> s;
    for (int i = 0; i < frames; i++) {
        const double p = frames == 1 ? 0 : double(i) / (frames - 1);
        Spec c(H, 0.0);
        for (int k = 1; k < H; k++) c[size_t(k)] = cd(0, -a(p, k)); // -i: a sine
        s.push_back(c);
    }
    return table(name, "Pung", s);
}

// ---- AKWF ------------------------------------------------------------------------

bool read_wav(const std::string &path, std::vector<float> &out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::vector<char> d((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    if (d.size() < 44 || std::memcmp(d.data(), "RIFF", 4) || std::memcmp(d.data() + 8, "WAVE", 4)) return false;
    size_t p = 12;
    int channels = 0, bits = 0;
    while (p + 8 <= d.size()) {
        const uint32_t sz = uint32_t(uint8_t(d[p + 4])) | uint32_t(uint8_t(d[p + 5])) << 8 | uint32_t(uint8_t(d[p + 6])) << 16 |
                            uint32_t(uint8_t(d[p + 7])) << 24;
        if (!std::memcmp(d.data() + p, "fmt ", 4) && p + 24 <= d.size()) {
            channels = uint8_t(d[p + 10]) | uint8_t(d[p + 11]) << 8;
            bits = uint8_t(d[p + 22]) | uint8_t(d[p + 23]) << 8;
        } else if (!std::memcmp(d.data() + p, "data", 4)) {
            if (bits != 16 || channels < 1) return false;
            const size_t n = std::min<size_t>(sz, d.size() - p - 8) / size_t(2 * channels);
            out.resize(n);
            for (size_t i = 0; i < n; i++) {
                double s = 0;
                for (int ch = 0; ch < channels; ch++) {
                    const size_t q = p + 8 + (i * size_t(channels) + size_t(ch)) * 2;
                    s += int16_t(uint16_t(uint8_t(d[q])) | uint16_t(uint8_t(d[q + 1])) << 8) / 32768.0;
                }
                out[i] = float(s / channels);
            }
            return n >= 16;
        }
        p += 8 + sz + (sz & 1);
    }
    return false;
}

std::vector<std::string> wavs(const std::string &dir) {
    std::vector<std::string> out;
    if (DIR *d = opendir(dir.c_str())) {
        while (dirent *e = readdir(d)) {
            const std::string n = e->d_name;
            if (n.size() > 4 && n.compare(n.size() - 4, 4, ".wav") == 0) out.push_back(dir + "/" + n);
        }
        closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

// A family's cycles as tables: near duplicates dropped, the rest in a path
// where each is the nearest to the one before (from the darkest), cut into
// at most maxTables runs of at most kMaxFrames frames.
std::vector<Out> family(const std::string &dir, const std::string &name, int maxTables) {
    std::vector<Spec> specs;
    std::vector<std::vector<float>> prof;
    for (const std::string &f : wavs(dir)) {
        std::vector<float> x;
        if (!read_wav(f, x)) continue;
        Spec c = analyse(x);
        if (energy(c) < 1e-6) continue; // silent
        std::vector<float> p = profile(c);
        bool dup = false;
        for (const auto &q : prof)
            if (distance(p, q) < 1.5) {
                dup = true;
                break;
            }
        if (dup) continue;
        specs.push_back(c);
        prof.push_back(p);
    }
    std::vector<Out> out;
    if (specs.empty()) return out;
    // the path
    std::vector<int> path;
    std::vector<bool> used(specs.size(), false);
    int cur = 0;
    for (size_t i = 1; i < specs.size(); i++)
        if (brightness(specs[i]) < brightness(specs[size_t(cur)])) cur = int(i);
    for (size_t n = 0; n < specs.size(); n++) {
        path.push_back(cur);
        used[size_t(cur)] = true;
        int next = -1;
        double best = 1e30;
        for (size_t i = 0; i < specs.size(); i++) {
            if (used[i]) continue;
            const double d = distance(prof[size_t(cur)], prof[i]);
            if (d < best) best = d, next = int(i);
        }
        if (next < 0) break;
        cur = next;
    }
    // runs
    const int total = int(path.size());
    const int tables = std::max(1, std::min(maxTables, (total + kMaxFrames - 1) / kMaxFrames));
    for (int t = 0; t < tables; t++) {
        const int a = total * t / tables, b = total * (t + 1) / tables; // [a, b)
        const int n = b - a;
        const int take = std::min(kMaxFrames, n);
        std::vector<Spec> s;
        for (int i = 0; i < take; i++) {
            const int j = take == 1 ? a : a + int(std::lround(double(i) * (n - 1) / (take - 1)));
            s.push_back(specs[size_t(path[size_t(j)])]);
        }
        char nm[96];
        if (tables == 1) snprintf(nm, sizeof(nm), "%s", name.c_str());
        else snprintf(nm, sizeof(nm), "%s %d", name.c_str(), t + 1);
        out.push_back(table(nm, "AKWF", s));
    }
    return out;
}

// ---- Pung's own tables --------------------------------------------------------------

double saw(double t) { return 2 * (t - std::floor(t)) - 1; }
double square(double t) { return t - std::floor(t) < 0.5 ? 1 : -1; }
double tri(double t) {
    const double u = t - std::floor(t);
    return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4;
}
double sine(double t) { return std::sin(2 * kPi * t); }
double lerp(double a, double b, double x) { return a + (b - a) * x; }

// a shape among sine, triangle, saw, square, p in [0, 1]
double shapes(double p, double t) {
    const double s = p * 3;
    const int i = std::min(2, int(s));
    const double x = s - i;
    double (*w[4])(double) = {sine, tri, saw, square};
    return lerp(w[i](t), w[i + 1](t), x);
}

// a vowel's spectral envelope: three formants (Hz) over a voice at f0
double formants(double hz, const double F[3], const double B[3]) {
    double a = 0;
    const double g[3] = {1.0, 0.6, 0.25};
    for (int i = 0; i < 3; i++) a += g[i] / (1 + std::pow((hz - F[i]) / B[i], 2));
    return a;
}

Out vowels(const std::string &name, double f0, const std::vector<std::array<double, 3>> &seq) {
    const int frames = kMaxFrames;
    const double B[3] = {80, 100, 140};
    return additive(name, frames, [&](double p, int k) {
        const double s = p * double(seq.size() - 1);
        const int i = std::min(int(seq.size()) - 2, int(s));
        const double x = s - i;
        double F[3];
        for (int j = 0; j < 3; j++) F[j] = lerp(seq[size_t(i)][size_t(j)], seq[size_t(i + 1)][size_t(j)], x);
        const double hz = k * f0;
        if (hz > 6000) return 0.0;
        return formants(hz, F, B) / std::pow(double(k), 0.6);
    });
}

std::vector<Cat> pung_tables() {
    std::vector<Cat> c;
    auto add = [&](const std::string &cat, Out o) {
        for (Cat &x : c)
            if (x.name == cat) {
                x.tables.push_back(o);
                return;
            }
        Cat n;
        n.name = cat;
        n.tables.push_back(o);
        c.push_back(n);
    };
    const int F = kMaxFrames;
    // Basic
    add("Basic", gen("Classic Morph", F, shapes));
    add("Basic", gen("Sine to Saw", F, [](double p, double t) { return lerp(sine(t), saw(t), p); }));
    add("Basic", gen("Triangle to Square", F, [](double p, double t) { return lerp(tri(t), square(t), p); }));
    add("Basic", gen("Saw to Square", F, [](double p, double t) { return lerp(saw(t), square(t), p); }));
    // Analog
    add("Analog", gen("Pulse Width", F, [](double p, double t) { return (t - std::floor(t)) < lerp(0.5, 0.03, p) ? 1.0 : -1.0; }));
    add("Analog", gen("Hard Sync Saw", F, [](double p, double t) { return saw(t * lerp(1, 7, p)); }));
    add("Analog", gen("Hard Sync Square", F, [](double p, double t) { return square(t * lerp(1, 6, p)); }));
    add("Analog", gen("Ramp Skew", F, [](double p, double t) {
        const double k = lerp(0.5, 0.02, p), u = t - std::floor(t);
        return u < k ? -1 + 2 * u / k : 1 - 2 * (u - k) / (1 - k);
    }));
    add("Analog", gen("Saturated Sine", F, [](double p, double t) { return std::tanh(sine(t) * lerp(1, 12, p * p)); }));
    // Digital
    add("Digital", gen("Bit Crush", F, [](double p, double t) {
        const double steps = std::pow(2.0, lerp(7, 1, p));
        return std::round(sine(t) * steps) / steps;
    }));
    add("Digital", gen("Sample and Hold", F, [](double p, double t) {
        const double n = std::round(lerp(48, 3, p));
        return saw(std::floor(t * n) / n);
    }));
    add("Digital", gen("Stairs", F, [](double p, double t) {
        const double n = std::round(lerp(2, 16, p));
        return std::floor((t - std::floor(t)) * n) / (n - 1) * 2 - 1;
    }));
    // Drive and Fold
    add("Drive & Fold", gen("Fold Sine", F, [](double p, double t) { return std::sin(kPi / 2 * sine(t) * lerp(1, 9, p)); }));
    add("Drive & Fold", gen("Fold Triangle", F, [](double p, double t) { return std::sin(kPi / 2 * tri(t) * lerp(1, 9, p)); }));
    add("Drive & Fold", gen("Drive Saw", F, [](double p, double t) { return std::tanh(saw(t) * lerp(1, 10, p)); }));
    add("Drive & Fold", gen("Clip Sine", F, [](double p, double t) {
        const double g = lerp(1, 8, p);
        return std::max(-1.0, std::min(1.0, sine(t) * g));
    }));
    add("Drive & Fold", gen("Asymmetric Drive", F, [](double p, double t) {
        const double x = sine(t) * lerp(1, 6, p);
        return x > 0 ? std::tanh(x) : std::tanh(x * 0.3);
    }));
    // FM: a carrier c and a modulator m (whole ratios: one cycle), the index rising
    auto fm = [&](int car, int mod) {
        char n[32];
        snprintf(n, sizeof(n), "FM %d:%d", car, mod);
        return gen(n, F, [=](double p, double t) { return std::sin(2 * kPi * car * t + lerp(0, 6, p) * std::sin(2 * kPi * mod * t)); });
    };
    for (auto r : std::vector<std::pair<int, int>>{{1, 1}, {1, 2}, {1, 3}, {2, 1}, {3, 2}, {1, 4}, {2, 5}, {1, 7}}) add("FM", fm(r.first, r.second));
    add("FM", gen("Feedback FM", F, [](double p, double t) {
        // one oscillator modulating itself, settled by iterating
        const double b = lerp(0, 1.6, p);
        double y = 0;
        for (int i = 0; i < 24; i++) y = std::sin(2 * kPi * t + b * y);
        return y;
    }));
    // Vocal: Peterson and Barney's formants
    const std::vector<std::array<double, 3>> male = {{730, 1090, 2440}, {530, 1840, 2480}, {270, 2290, 3010}, {570, 840, 2410}, {300, 870, 2240}};
    const std::vector<std::array<double, 3>> female = {{850, 1220, 2810}, {610, 2330, 2990}, {310, 2790, 3310}, {590, 920, 2710}, {370, 950, 2670}};
    add("Vocal", vowels("Vowels Low", 110, male));
    add("Vocal", vowels("Vowels High", 220, female));
    add("Vocal", vowels("Ah to Oo", 130, {{730, 1090, 2440}, {570, 840, 2410}, {300, 870, 2240}}));
    add("Vocal", vowels("Ee to Ah", 165, {{270, 2290, 3010}, {530, 1840, 2480}, {730, 1090, 2440}}));
    add("Vocal", additive("Formant Sweep", F, [](double p, int k) {
        const double hz = k * 110.0, f = lerp(250, 3200, p);
        return (1 / (1 + std::pow((hz - f) / 160, 2)) + 0.05) / std::sqrt(double(k));
    }));
    // Harmonic & Organ
    add("Harmonic & Organ", additive("Harmonic Series", F, [](double p, int k) {
        const double top = std::pow(2.0, lerp(0, 6, p));
        return k <= top ? 1.0 / k : 0;
    }));
    add("Harmonic & Organ", additive("Odd to Even", F, [](double p, int k) { return (k == 1 ? 1.0 : k % 2 ? 1 - p : p) / k; }));
    add("Harmonic & Organ", additive("Spectral Tilt", F, [](double p, int k) { return std::pow(double(k), -lerp(2.0, 0.4, p)); }));
    add("Harmonic & Organ", additive("Single Partials", F, [](double p, int k) {
        const double c = lerp(1, 24, p);
        return std::exp(-std::pow((k - c) / 1.2, 2)) + (k == 1 ? 0.15 : 0);
    }));
    {
        // drawbar registrations: 16' 5 1/3' 8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1' as harmonics 1 3 2 4 6 8 10 12 16
        const int H9[9] = {1, 3, 2, 4, 6, 8, 10, 12, 16};
        const char *reg[] = {"800000000", "808000000", "888000000", "868000000", "888800000", "888000888", "848000008",
                             "880000008", "888888888", "883000000", "806000000", "888600000", "800008888", "888880000", "808808008", "877600000"};
        std::vector<Spec> s;
        for (const char *r : reg) {
            Spec c(H, 0.0);
            for (int i = 0; i < 9; i++) {
                const int lvl = r[i] - '0';
                if (lvl) c[size_t(H9[i])] += cd(0, -std::pow(10.0, (lvl - 8) * 3.0 / 20.0)); // a drawbar step: 3 dB
            }
            s.push_back(c);
        }
        add("Harmonic & Organ", table("Drawbars", "Pung", s));
    }
    // Spectral
    add("Spectral", additive("Comb Sweep", F, [](double p, int k) { return std::fabs(std::cos(kPi * k * lerp(0.03, 0.5, p))) / k; }));
    add("Spectral", additive("Bright Combs", F, [](double p, int k) { return std::fabs(std::sin(kPi * k * lerp(0.02, 0.24, p))) / std::sqrt(double(k)); }));
    for (int seed = 1; seed <= 4; seed++) {
        std::mt19937 rng(uint32_t(seed * 7919));
        std::uniform_real_distribution<double> u(0, 1);
        std::vector<std::vector<double>> keys(4, std::vector<double>(64));
        for (auto &kk : keys)
            for (int k = 0; k < 64; k++) kk[size_t(k)] = std::pow(u(rng), 2) / std::pow(double(k + 1), 0.8);
        char n[32];
        snprintf(n, sizeof(n), "Random Spectra %d", seed);
        add("Spectral", additive(n, F, [&keys](double p, int k) {
            if (k > 64) return 0.0;
            const double s = p * 3;
            const int i = std::min(2, int(s));
            return lerp(keys[size_t(i)][size_t(k - 1)], keys[size_t(i + 1)][size_t(k - 1)], s - i);
        }));
    }
    // Texture: noise of one cycle (random phases), from dark to bright
    {
        std::mt19937 rng(424242);
        std::uniform_real_distribution<double> u(0, 2 * kPi);
        std::vector<double> ph(H);
        for (auto &x : ph) x = u(rng);
        std::vector<Spec> s;
        for (int i = 0; i < F; i++) {
            const double cut = std::pow(2.0, lerp(3, 9, double(i) / (F - 1)));
            Spec c(H, 0.0);
            for (int k = 1; k < H; k++) c[size_t(k)] = std::polar(1 / (1 + std::pow(k / cut, 4)) / std::sqrt(double(k)), ph[size_t(k)]);
            s.push_back(c);
        }
        add("Texture", table("Noise Cycle", "Pung", s));
    }
    return c;
}

// ---- the library ----------------------------------------------------------------------

struct Family {
    const char *dir, *name, *category;
    int maxTables;
};

// AKWF's families, by category (the numbered collections: Collection)
const Family kFamilies[] = {
    {"AKWF_bw_sin", "Sine", "Basic", 1},
    {"AKWF_bw_tri", "Triangle", "Basic", 2},
    {"AKWF_bw_saw", "Saw", "Basic", 3},
    {"AKWF_bw_squ", "Square", "Basic", 4},
    {"AKWF_bw_perfectwaves", "Perfect Waves", "Basic", 1},
    {"AKWF_bw_sawrounded", "Rounded Saw", "Analog", 3},
    {"AKWF_bw_squrounded", "Rounded Square", "Analog", 3},
    {"AKWF_bw_sawbright", "Bright Saw", "Analog", 1},
    {"AKWF_bw_sawgap", "Gap Saw", "Analog", 3},
    {"AKWF_bw_blended", "Blended", "Analog", 4},
    {"AKWF_c604", "C604", "Analog", 2},
    {"AKWF_raw", "Raw", "Analog", 2},
    {"AKWF_bitreduced", "Bit Reduced", "Digital", 4},
    {"AKWF_linear", "Linear", "Digital", 4},
    {"AKWF_symetric", "Symmetric", "Digital", 1},
    {"AKWF_hdrawn", "Hand Drawn", "Digital", 3},
    {"AKWF_distorted", "Distorted", "Drive & Fold", 3},
    {"AKWF_fmsynth", "FM Synth", "FM", 6},
    {"AKWF_hvoice", "Human Voice", "Vocal", 6},
    {"AKWF_sinharm", "Sine Harmonics", "Harmonic & Organ", 1},
    {"AKWF_overtone", "Overtones", "Harmonic & Organ", 3},
    {"AKWF_eorgan", "Electric Organ", "Harmonic & Organ", 6},
    {"AKWF_epiano", "Electric Piano", "Keys & Plucks", 4},
    {"AKWF_piano", "Piano", "Keys & Plucks", 2},
    {"AKWF_clavinet", "Clavinet", "Keys & Plucks", 2},
    {"AKWF_aguitar", "Acoustic Guitar", "Keys & Plucks", 2},
    {"AKWF_eguitar", "Electric Guitar", "Keys & Plucks", 2},
    {"AKWF_pluckalgo", "Pluck", "Keys & Plucks", 1},
    {"AKWF_stringbox", "String Box", "Keys & Plucks", 1},
    {"AKWF_cello", "Cello", "Strings & Winds", 2},
    {"AKWF_violin", "Violin", "Strings & Winds", 1},
    {"AKWF_flute", "Flute", "Strings & Winds", 2},
    {"AKWF_oboe", "Oboe", "Strings & Winds", 1},
    {"AKWF_clarinett", "Clarinet", "Strings & Winds", 2},
    {"AKWF_altosax", "Alto Sax", "Strings & Winds", 2},
    {"AKWF_theremin", "Theremin", "Strings & Winds", 2},
    {"AKWF_dbass", "Double Bass", "Bass", 4},
    {"AKWF_ebass", "Electric Bass", "Bass", 4},
    {"AKWF_oscchip", "Chip", "Chip & Game", 6},
    {"AKWF_vgame", "Video Game", "Chip & Game", 6},
    {"AKWF_vgamebasic", "Game Basics", "Chip & Game", 4},
    {"AKWF_granular", "Granular", "Texture", 3},
    {"AKWF_snippets", "Snippets", "Texture", 3},
    {"AKWF_birds", "Birds", "Texture", 1},
    {"AKWF_stereo", "Stereo", "Texture", 6},
};

const char *kOrder[] = {"Basic", "Analog", "Digital", "Drive & Fold", "FM", "Vocal", "Harmonic & Organ", "Keys & Plucks",
                        "Strings & Winds", "Bass", "Chip & Game", "Spectral", "Texture", "Collection"};

std::string slug(const std::string &s) {
    std::string o;
    for (char ch : s) {
        if (std::isalnum(uint8_t(ch))) o += char(std::tolower(uint8_t(ch)));
        else if (!o.empty() && o.back() != '-') o += '-';
    }
    while (!o.empty() && o.back() == '-') o.pop_back();
    return o;
}

int build(const std::string &akwf, const std::string &out) {
    std::map<std::string, Cat> cats;
    for (const char *n : kOrder) {
        cats[n].name = n;
        cats[n].file = slug(n) + ".bin";
    }
    // Pung's own first in each category, then AKWF's
    for (Cat &c : pung_tables())
        for (Out &o : c.tables) cats[c.name].tables.push_back(o);
    for (const Family &f : kFamilies) {
        const std::vector<Out> t = family(akwf + "/" + f.dir, f.name, f.maxTables);
        if (t.empty()) fprintf(stderr, "wavetables: %s: nothing read\n", f.dir);
        for (const Out &o : t) cats[f.category].tables.push_back(o);
    }
    for (int i = 1; i <= 20; i++) { // the numbered collections, one table each
        char d[32], n[32];
        snprintf(d, sizeof(d), "AKWF_%04d", i);
        snprintf(n, sizeof(n), "Collection %02d", i);
        for (const Out &o : family(akwf + "/" + d, n, 1)) cats["Collection"].tables.push_back(o);
    }
    mkdir(out.c_str(), 0755);
    json idx = {{"version", 1}, {"frame", wtlib::kFrame}};
    json jc = json::array();
    int ntables = 0;
    long nframes = 0;
    for (const char *n : kOrder) {
        Cat &c = cats[n];
        if (c.tables.empty()) continue;
        std::ofstream f(out + "/" + c.file, std::ios::binary);
        json jt = json::array();
        int64_t at = 0;
        for (const Out &o : c.tables) {
            if (o.frames.empty()) continue;
            for (const auto &fr : o.frames)
                for (float v : fr) {
                    const int16_t s = int16_t(std::lround(std::max(-1.0f, std::min(1.0f, v)) * 32767.0f));
                    const char b[2] = {char(s & 0xff), char((s >> 8) & 0xff)};
                    f.write(b, 2);
                }
            jt.push_back({{"name", o.name}, {"frames", int(o.frames.size())}, {"at", at}, {"source", o.source}});
            at += int64_t(o.frames.size());
            ntables++;
            nframes += long(o.frames.size());
        }
        jc.push_back({{"name", c.name}, {"file", c.file}, {"tables", jt}});
    }
    idx["categories"] = jc;
    std::ofstream(out + "/index.json") << idx.dump(1) << "\n";
    printf("wavetables: %d tables, %ld frames, in %d categories -> %s\n", ntables, nframes, int(jc.size()), out.c_str());
    return ntables > 0 ? 0 : 1;
}

} // namespace wtb

int build_wavetables(const char *akwf, const char *out) { return wtb::build(akwf, out); }
