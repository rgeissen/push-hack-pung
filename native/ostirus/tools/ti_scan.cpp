// ti_scan: research, never shipped (CMake target ostirus-scan; the recipe builds
// only the plugin and the engine). Finds the words of the Virus TI's DSP
// memory that follow a modulation, for OsTIrus's live_mod (Pung's livemod.go:
// every synth shows its modulation moving). native/xenia/tools/xt_scan.cpp's
// method, on the Virus.
//
//   ostirus-scan <firmware file> <out folder> [what] [chord|stagger|stagger12]
//
// It boots the Virus TI from the user's firmware, makes the edit
// buffer a plain sound (no envelope on the filter, no modulation but what the
// run sets) and holds one note three ways:
//   still  no modulation: the words that change anyway (audio, counters)
//   lfo    LFO 1 (triangle) on the target: every word that changes only now,
//          its value every RECORD_EVERY blocks -> <out>/lfo.csv
//   knob   no modulation, the target at LOW and at HIGH: those words' values
//          at each -> <out>/knob.csv
// what: cutoff (default), wave (Wave 1 Startwave), reso, pitch, volume, pan.
// The files are read as xt_scan.cpp's are.

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
#include "dsp56kEmu/memory.h"
#include "virusLib/device.h"
#include "virusLib/deviceModel.h"
#include "virusLib/dspSingle.h"

namespace {

const int BLOCK = 64, RECORD_EVERY = 4; // a value every 5.8 ms
const uint8_t PAGE[4] = {0x70, 0x71, 0x6e, 0x6f}; // the single's pages (ti_params.h kPageCode)

struct Target {
    const char *name;
    int byte;      // the knob's byte in the single
    int dest;      // the mod matrix's destination number (parameterDescriptions_xt, L27)
    int low, high; // the knob, two ways
    int base;      // the knob during the lfo run
    int modByte = 193, modOn = 64 + 50, modOff = 64; // what modulates it: slot 1's amount (LFO 1), else this byte
};
// dest: unused here (the Virus's LFO 2 has an amount to Cutoff 1 of its own;
// the shape goes through LFO 1's assign)
const Target TARGETS[] = {
    {"cutoff", 40, 0, 20, 110, 64, 88, 64 + 50, 64},     // LFO 2 -> Cutoff 1 (cutoff1_lfo2_amount)
    {"fenv", 40, 0, 20, 110, 40, 44, 100, 0},             // the filter envelope's amount (filter1_env_amt)
    {"shape", 17, 0, 10, 110, 64, 208, 64 + 50, 64},     // Osc 1 Shape/Index, by LFO 1's assign (amount 208)
};

std::unique_ptr<virusLib::Device> dev;
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
// a byte of the single on its page (as the plugin sends a knob: ostirus_plugin.cpp send_byte)
void param(int idx, int v) {
    sysex({0xf0, 0x00, 0x20, 0x33, 0x01, 0x10 /* OMNI_DEVICE_ID */, PAGE[idx / 128], 0x40 /* SINGLE */, uint8_t(idx % 128),
           uint8_t(v & 0x7f), 0xf7});
    run(0.01);
}

const dsp56k::Memory &mem() { return dev->getDspA()->getMemory(); }
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
// the words read of each area (env SCAN_SPAN, hex): the Virus maps only part
// of its address space, and a read past it is a bus error
const uint32_t SPAN = getenv("SCAN_SPAN") ? uint32_t(strtoul(getenv("SCAN_SPAN"), nullptr, 16)) : 0x4000;
uint32_t sizeX() { return std::min(SPAN, mem().size(dsp56k::MemArea_X)); }
std::vector<uint32_t> snap() {
    const dsp56k::Memory &m = mem();
    const uint32_t nx = sizeX(), ny = std::min(SPAN, m.size(dsp56k::MemArea_Y));
    std::vector<uint32_t> s(nx + ny);
    for (uint32_t i = 0; i < nx; i++) s[i] = m.get(dsp56k::MemArea_X, i) & 0xffffff;
    for (uint32_t i = 0; i < ny; i++) s[nx + i] = m.get(dsp56k::MemArea_Y, i) & 0xffffff;
    return s;
}
// the words that change while a note is held for `seconds`
std::vector<bool> changing(double seconds) {
    notesOn();
    fprintf(stderr, " notes on\n");
    run(0.4);
    fprintf(stderr, " ran 0.4 s\n");
    const std::vector<uint32_t> first = snap();
    fprintf(stderr, " snapshot\n");
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
        fprintf(stderr, "ostirus-scan <firmware file> <out folder> [cutoff|fenv|shape] [chord|stagger|stagger12]\n");
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
    std::vector<uint8_t> rom;
    {
        FILE *rf = fopen(argv[1], "rb");
        if (!rf) return 1;
        uint8_t b[65536];
        size_t n;
        while ((n = fread(b, 1, sizeof(b), rf)) > 0) rom.insert(rom.end(), b, b + n);
        fclose(rf);
    }
    synthLib::DeviceCreateParams p;
    p.romData = rom;
    p.romName = strrchr(argv[1], '/') ? strrchr(argv[1], '/') + 1 : argv[1];
    p.hostSamplerate = 44100.0f;
    p.customData = uint32_t(virusLib::DeviceModel::TI);
    dev.reset(new virusLib::Device(p));
    if (!dev->isValid()) {
        fprintf(stderr, "no Virus TI in %s\n", argv[1]);
        return 1;
    }
    plugin.reset(new synthLib::Plugin(dev.get(), [](synthLib::Device *d) { return d; }));
    plugin->setHostSamplerate(44100.0f, 0.0f);
    plugin->setBlockSize(BLOCK);
    for (size_t i = 0; i < outs.size() && i < 12; i++) outs[i] = buf[i];
    for (size_t i = 0; i < ins.size(); i++) ins[i] = silent;
    fprintf(stderr, "booted\n");
    run(4.0);
    fprintf(stderr, "ran 4 s\n");

    // a plain sound: nothing modulates but what a run sets
    for (int k : {74, 75, 76, 77, 78, 86, 87, 88, 89, 90, 208}) param(k, 64); // the LFOs' amounts: 0
    param(44, 0), param(45, 0);                        // the filter envelope: no amount
    param(40, 64), param(42, 0), param(51, 0);         // cutoff, resonance, filter 1 a low pass
    param(59, 0), param(60, 0), param(61, 127), param(63, 0); // amp env: on, held
    param(67, 50), param(68, 1), param(79, 50), param(80, 1); // LFO 1 and 2: triangle, about 1 Hz
    param(146, 0), param(147, 0);                      // free, not clocked
    param(207, 6);                                     // LFO 1's assign: Osc 1 Shape/Index
    param(T->byte, T->base);
    if (T->modByte == 44) // an envelope that moves while the note is held: up, then down to nothing
        param(54, 60), param(55, 75), param(56, 0), param(58, 30);
    param(T->modByte, T->modOff);
    run(1.0);

    // dump: X and Y 0..0x400 before and after each of five notes, started one
    // at a time and held (-> <out>/dump.csv: snapshot, note, area, address, value)
    if (what == "dump") {
        FILE *f = fopen((out + "/dump.csv").c_str(), "w");
        const uint8_t ns[] = {50, 62, 57, 69, 45};
        const dsp56k::Memory &m = mem();
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
        const dsp56k::Memory &m = mem();
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

    fprintf(stderr, "X %x, Y %x words; reading %x of each\n", unsigned(mem().size(dsp56k::MemArea_X)), unsigned(mem().size(dsp56k::MemArea_Y)), unsigned(SPAN));
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
