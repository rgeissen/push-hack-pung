// xt_scan: research, never shipped (CMake target xenia-scan; the recipe builds
// only the plugin and the engine). Finds the words of the XT's DSP memory that
// follow a modulation, for Xenia's live_mod (Pung's livemod.go: every synth
// shows its modulation moving).
//
//   xenia-scan <roms folder> <out folder> [what]
//
// It boots the synth from the user's firmware in Single mode, makes the edit
// buffer a plain sound (no envelope on the filter, no modulation but what the
// run sets) and holds one note three ways:
//   still  no modulation: the words that change anyway (audio, counters)
//   lfo    LFO 1 (triangle) on the target: every word that changes only now,
//          its value every RECORD_EVERY blocks -> <out>/lfo.csv
//   knob   no modulation, the target at LOW and at HIGH: those words' values
//          at each -> <out>/knob.csv
// what: cutoff (default), wave (Wave 1 Startwave), reso, pitch, volume, pan.
// scripts/xt_scan.py reads the two files.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include <unistd.h>

#include "dsp56kBase/logging.h"
#include "synthLib/plugin.h"
#include "synthLib/romLoader.h"
#include "xtLib/xtDevice.h"
#include "xtLib/xtHardware.h"

namespace {

const int BLOCK = 64, RECORD_EVERY = 4; // a value every 5.8 ms
const uint8_t W = 0x3e, M = 0x0e, DEV = 0x7f;

struct Target {
    const char *name;
    int byte;      // the knob's byte in the single
    int dest;      // the mod matrix's destination number (parameterDescriptions_xt, L27)
    int low, high; // the knob, two ways
    int base;      // the knob during the lfo run
    int modByte = 193, modOn = 64 + 50, modOff = 64; // what modulates it: slot 1's amount (LFO 1), else this byte
};
const Target TARGETS[] = {
    {"cutoff", 62, 9, 20, 110, 64},
    {"reso", 63, 10, 10, 110, 40},
    {"wave", 26, 3, 5, 55, 30},
    {"pitch", 2, 0, 58, 70, 64},
    {"volume", 77, 12, 30, 120, 100},
    {"pan", 84, 13, 10, 118, 64},
    // the filter envelope (per voice): its amount instead of the LFO
    {"fenv", 62, 9, 20, 110, 40, 66, 64 + 50, 64},
};

std::unique_ptr<xt::Device> dev;
std::unique_ptr<synthLib::Plugin> plugin;
float buf[12][BLOCK], silent[BLOCK];
synthLib::TAudioInputs ins{};
synthLib::TAudioOutputs outs{};
std::vector<synthLib::SMidiEvent> sink;

void run(double seconds) {
    for (int b = 0; b < int(44100 * seconds / BLOCK); b++) {
        plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
        sink.clear();
        plugin->getMidiOut(sink);
    }
}
void block() { run(double(BLOCK) / 44100); }
void midi(uint8_t a, uint8_t b, uint8_t c) {
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, a, b, c);
    plugin->addMidiEvent(ev);
}
void sysex(std::vector<uint8_t> s) {
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex.assign(s.begin(), s.end());
    plugin->addMidiEvent(ev);
}
// a byte of the edit buffer's single (as the plugin sends a knob: waldorf_engine.cpp send_byte)
void param(int idx, int v) {
    sysex({0xf0, W, M, DEV, 0x20, 0x00, uint8_t(idx >> 7), uint8_t(idx & 0x7f), uint8_t(v & 0x7f), 0xf7});
    run(0.01);
}

dsp56k::Memory &mem() { return dev->getXt().getHardware()->getDSP(0).dsp().memory(); }
struct Word {
    int area; // 0 X, 1 Y
    uint32_t a;
};
// the notes a run holds (chord: several voices at once)
std::vector<uint8_t> notes = {60};
void notesOn() {
    for (uint8_t n : notes) midi(0x90, n, 100);
}
void notesOff() {
    for (uint8_t n : notes) midi(0x80, n, 0);
}
const uint32_t SPAN = 0x40000; // the words read of each area: internal memory and the external SRAM in use
uint32_t sizeX() { return std::min(SPAN, mem().size(dsp56k::MemArea_X)); }
std::vector<uint32_t> snap() {
    dsp56k::Memory &m = mem();
    const uint32_t nx = sizeX(), ny = std::min(SPAN, m.size(dsp56k::MemArea_Y));
    std::vector<uint32_t> s(nx + ny);
    for (uint32_t i = 0; i < nx; i++) s[i] = m.get(dsp56k::MemArea_X, i) & 0xffffff;
    for (uint32_t i = 0; i < ny; i++) s[nx + i] = m.get(dsp56k::MemArea_Y, i) & 0xffffff;
    return s;
}
// the words that change while a note is held for `seconds`
std::vector<bool> changing(double seconds) {
    notesOn();
    run(0.4);
    const std::vector<uint32_t> first = snap();
    std::vector<bool> ch(first.size(), false);
    for (int b = 0; b < int(44100 * seconds / BLOCK); b += RECORD_EVERY) {
        run(double(BLOCK * RECORD_EVERY) / 44100);
        const std::vector<uint32_t> s = snap();
        for (size_t i = 0; i < s.size(); i++)
            if (s[i] != first[i]) ch[i] = true;
    }
    notesOff();
    run(1.0);
    return ch;
}

} // namespace

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "xenia-scan <roms folder> <out folder> [cutoff|reso|wave|pitch|volume|pan]\n");
        return 2;
    }
    const std::string out = argv[2], what = argc > 3 ? argv[3] : "cutoff";
    bool stagger = false; // the record pass: one note of the chord every 0.23 s
    if (argc > 4 && !strcmp(argv[4], "chord")) notes = {48, 55, 60, 64, 67};
    if (argc > 4 && !strcmp(argv[4], "stagger")) notes = {48, 55, 60, 64, 67}, stagger = true;
    if (argc > 4 && !strcmp(argv[4], "stagger12")) notes = {36, 40, 43, 48, 52, 55, 60, 64, 67, 72, 76, 79}, stagger = true;
    // watch: given words while twelve notes start one after the other (every
    // 0.23 s, each held), with given bytes of the sound set:
    //   xenia-scan <roms> <out> watch X:61,Y:ec,... [byte=value ...]  -> <out>/watch.csv
    const bool watch = what == "watch";
    const Target *T = nullptr;
    for (const Target &t : TARGETS)
        if (what == t.name) T = &t;
    if (!T && !watch && what != "dump") return 2;
    if (!T) T = &TARGETS[0];
    Logging::setLogFunc([](const std::string &) {});
    synthLib::RomLoader::addSearchPath(argv[1]);
    synthLib::DeviceCreateParams p;
    p.hostSamplerate = 44100.0f;
    p.customData = 0;
    dev.reset(new xt::Device(p));
    if (!dev->isValid()) {
        fprintf(stderr, "no firmware in %s\n", argv[1]);
        return 1;
    }
    plugin.reset(new synthLib::Plugin(dev.get(), [](synthLib::Device *d) { return d; }));
    plugin->setHostSamplerate(44100.0f, 0.0f);
    plugin->setBlockSize(BLOCK);
    for (size_t i = 0; i < outs.size() && i < 12; i++) outs[i] = buf[i];
    for (size_t i = 0; i < ins.size(); i++) ins[i] = silent;
    sysex({0xf0, W, M, DEV, 0x17, 0x00, 0xf7}); // Single mode
    run(3.0);

    // a plain sound: nothing modulates but what a run sets
    for (int s = 0; s < 16; s++) param(193 + 3 * s, 64); // every slot's amount 0
    for (int k : {28, 29, 38, 39, 66, 67}) param(k, 64);  // wave and filter envelopes, their velocity: 0
    param(64, 0);                                         // filter 1: 24 dB LP
    param(62, 64), param(63, 0);
    param(119, 0), param(120, 0), param(121, 127), param(122, 0); // amp env: on, held
    param(160, 1), param(159, 50), param(161, 0), param(162, 0); // LFO 1: triangle, about 1 Hz, no delay, free
    param(T->byte, T->base);
    param(192, 1), param(194, T->dest), param(193, 64); // slot 1: LFO 1 -> the target, amount 0 for now
    if (T->modByte != 193) // an envelope that moves while the note is held: up, then down to nothing
        param(113, 60), param(114, 75), param(115, 0), param(116, 30), param(T->modByte, T->modOff);
    run(1.0);

    // dump: X and Y 0..0x400 before and after each of five notes, started one
    // at a time and held (-> <out>/dump.csv: snapshot, note, area, address, value)
    if (what == "dump") {
        FILE *f = fopen((out + "/dump.csv").c_str(), "w");
        const uint8_t ns[] = {50, 62, 57, 69, 45};
        dsp56k::Memory &m = mem();
        auto put = [&](int k, int note) {
            for (int a = 0; a < 2; a++)
                for (uint32_t i = 0; i < 0x400; i++)
                    fprintf(f, "%d,%d,%c,%x,%u\n", k, note, a ? 'Y' : 'X', i, m.get(a ? dsp56k::MemArea_Y : dsp56k::MemArea_X, i) & 0xffffff);
        };
        put(0, -1);
        for (int k = 0; k < 5; k++) {
            midi(0x90, ns[k], 100);
            run(0.12);
            put(k + 1, ns[k]);
        }
        fclose(f);
        _exit(0);
    }
    if (watch && argc > 4) {
        std::vector<std::pair<int, uint32_t>> words;
        for (char *tok = strtok(argv[4], ","); tok; tok = strtok(nullptr, ","))
            words.push_back({tok[0] == 'Y' ? 1 : 0, uint32_t(strtoul(tok + 2, nullptr, 16))});
        for (int i = 5; i < argc; i++) {
            int b = 0, v = 0;
            if (sscanf(argv[i], "%d=%d", &b, &v) == 2) param(b, v);
        }
        run(0.5);
        notes = {36, 40, 43, 48, 52, 55, 60, 64, 67, 72, 76, 79};
        FILE *f = fopen((out + "/watch.csv").c_str(), "w");
        fprintf(f, "t,note");
        for (auto &w : words) fprintf(f, ",%c:%05x", w.first ? 'Y' : 'X', unsigned(w.second));
        fprintf(f, "\n");
        dsp56k::Memory &m = mem();
        for (int i = 0; i < 400; i++) {
            int n = -1;
            if (i % 40 == 0 && size_t(i / 40) < notes.size()) midi(0x90, notes[size_t(i / 40)], 100), n = notes[size_t(i / 40)];
            run(double(BLOCK * RECORD_EVERY) / 44100);
            fprintf(f, "%.3f,%d", i * double(BLOCK * RECORD_EVERY) / 44100, n);
            for (auto &w : words) fprintf(f, ",%u", m.get(w.first ? dsp56k::MemArea_Y : dsp56k::MemArea_X, w.second) & 0xffffff);
            fprintf(f, "\n");
        }
        fclose(f);
        _exit(0);
    }

    fprintf(stderr, "still\n");
    const std::vector<bool> still = changing(3.0);
    fprintf(stderr, "lfo: the words that change\n");
    param(T->modByte, T->modOn);
    const std::vector<bool> lfo = changing(3.0);
    std::vector<size_t> cand;
    for (size_t i = 0; i < lfo.size(); i++)
        if (lfo[i] && !still[i]) cand.push_back(i);
    const uint32_t nx = sizeX();
    fprintf(stderr, "%zu words change with the LFO only (of %zu; X has %u)\n", cand.size(), lfo.size(), nx);
    if (cand.size() > 20000) cand.resize(20000);

    // lfo: their values over 4 s
    FILE *f = fopen((out + "/lfo.csv").c_str(), "w");
    if (!stagger) notesOn();
    run(0.4);
    std::vector<std::vector<uint32_t>> series(cand.size());
    for (int b = 0, i = 0; b < int(44100 * 4.0 / BLOCK); b += RECORD_EVERY, i++) {
        if (stagger && i % 40 == 0 && size_t(i / 40) < notes.size()) midi(0x90, notes[size_t(i / 40)], 100); // every 0.23 s
        run(double(BLOCK * RECORD_EVERY) / 44100);
        const std::vector<uint32_t> s = snap();
        for (size_t c = 0; c < cand.size(); c++) series[c].push_back(s[cand[c]]);
    }
    notesOff();
    run(1.0);
    for (size_t c = 0; c < cand.size(); c++) {
        fprintf(f, "%c:%05x", cand[c] < nx ? 'X' : 'Y', unsigned(cand[c] < nx ? cand[c] : cand[c] - nx));
        for (uint32_t v : series[c]) fprintf(f, ",%u", v);
        fprintf(f, "\n");
    }
    fclose(f);

    // knob: no modulation, the target low and high
    param(T->modByte, T->modOff);
    f = fopen((out + "/knob.csv").c_str(), "w");
    std::vector<std::vector<uint32_t>> at(2);
    for (int k = 0; k < 2; k++) {
        param(T->byte, k ? T->high : T->low);
        midi(0x90, 60, 100);
        run(0.6);
        const std::vector<uint32_t> s = snap();
        for (size_t c = 0; c < cand.size(); c++) at[k].push_back(s[cand[c]]);
        midi(0x80, 60, 0);
        run(1.0);
    }
    for (size_t c = 0; c < cand.size(); c++)
        fprintf(f, "%c:%05x,%u,%u\n", cand[c] < nx ? 'X' : 'Y', unsigned(cand[c] < nx ? cand[c] : cand[c] - nx), at[0][c], at[1][c]);
    fclose(f);

    // sweep: the knob through its travel, one note: each word that followed it, at every value
    std::vector<size_t> follow;
    for (size_t c = 0; c < cand.size() && follow.size() < 64; c++)
        if (at[0][c] != at[1][c]) follow.push_back(c);
    f = fopen((out + "/sweep.csv").c_str(), "w");
    fprintf(f, "knob");
    for (size_t c : follow) fprintf(f, ",%c:%05x", cand[c] < nx ? 'X' : 'Y', unsigned(cand[c] < nx ? cand[c] : cand[c] - nx));
    fprintf(f, "\n");
    const std::vector<uint8_t> chord = notes;
    notes = {60};
    for (int k = 0; k < 128; k++) {
        param(T->byte, k);
        notesOn();
        run(0.25);
        const std::vector<uint32_t> s = snap();
        fprintf(f, "%d", k);
        for (size_t c : follow) fprintf(f, ",%u", s[cand[c]]);
        fprintf(f, "\n");
        notesOff();
        run(0.25);
    }
    fclose(f);
    notes = chord;
    fprintf(stderr, "wrote %s/lfo.csv, knob.csv, sweep.csv (%s %d / %d)\n", out.c_str(), T->name, T->low, T->high);
    _exit(0);
}
