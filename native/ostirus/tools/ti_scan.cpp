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
// what: cutoff (default), fenv, shape. The files are read as xt_scan.cpp's are.
//   range [byte=value ...]  every word's span with the modulation off and on
//                           (SCAN_MODON=byte=value), those that grow recorded
//                           with the audio -> lfo.csv, audio.f32
//   watch <words> [byte=value ...]  given words while notes start
//                           (SCAN_NOTES=60,64 SCAN_EVERY=40) -> watch.csv, audio.f32
//   pdis [byte=value ...]   the program memory disassembled while a note is held
//                           (SCAN_PSPAN, hex: the words read; -> p.asm, p.bin)
//   hook [byte=value ...]   each value Filter 1's routines store (P:$95D, P:$4FFF2),
//                           with the part's, the voice's and r4's records, logged by
//                           a stub as ostirus_engine.cpp's (-> hook.csv: t, voice (r1),
//                           value, r0, r4; audio.f32). SCAN_NOTES, SCAN_EVERY as
//                           watch's, SCAN_OFF_AT (block) the notes let go, SCAN_BLOCKS
// SCAN_DSP=B reads the TI's second DSP; SCAN_SPAN (hex) the words read of each area;
// SCAN_BOOTSOUND keeps the sound the Virus boots with instead of the plain one.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <climits>
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
#include "dsp56kEmu/disasm.h"
#include "dsp56kEmu/opcodes.h"
#include "dsp56kEmu/assembler.h"
#include "dsp56kEmu/dsp.h"
#include "dsp56kEmu/dspthread.h"
#include <thread>
#include <atomic>
#include <chrono>
#include "virusLib/device.h"
#include "virusLib/deviceModel.h"
#include "virusLib/dspSingle.h"
#include "virusLib/dspMultiTI.h"

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

// the DSP read (env SCAN_DSP=B: the TI's second DSP, DspMultiTI's)
const dsp56k::Memory &mem() {
    const virusLib::DspSingle *a = dev->getDspA();
    if (getenv("SCAN_DSP") && getenv("SCAN_DSP")[0] == 'B')
        return const_cast<virusLib::DspMultiTI *>(static_cast<const virusLib::DspMultiTI *>(a))->getDSP2().getMemory();
    return a->getMemory();
}
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
    if (!T && !watch && what != "dump" && what != "range" && what != "pdis" && what != "hook") return 2;
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

    // a plain sound: nothing modulates but what a run sets (SCAN_BOOTSOUND: the sound the Virus boots with)
    if (!getenv("SCAN_BOOTSOUND")) {
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
    }
    run(1.0);

    // hook: each value the program writes to Filter 1's cutoff word (P:$95D,
    // move a,y:>$46ac9, the voice's record in r1), logged by a stub in free
    // program memory into a ring at Y:$1F800 (-> <out>/hook.csv: t, voice
    // record, value; audio.f32), notes as watch's (SCAN_NOTES, SCAN_EVERY)
    if (what == "hook") {
        for (int i = 4; i < argc; i++) {
            int b = 0, v = 0;
            if (sscanf(argv[i], "%d=%d", &b, &v) == 2) param(b, v);
        }
        run(0.5);
        const virusLib::DspSingle *ds = dev->getDspA();
        dsp56k::DSP &d = ds->getDSP();
        auto &mu = ds->getDSPThread()->mutex();
        static dsp56k::Assembler as;
        // interrupts masked while r7 and m7 are borrowed (an interrupt routine
        // keeps r7 as its own pointer); the SR as it was put back just before
        // the moved instruction, which sets the flags the program goes on with
        const char *stub[] = {"move sr,y:>$1dff5", "ori #$03,mr", "nop", "nop", "nop",
                              "move r7,y:>$1dff0", "move m7,y:>$1dff1", "move y:>$1dff2,r7", "move #>$1fff,m7", "nop", "nop",
                              "move a,y:(r7)+", "move r1,y:(r7)+", "move r0,y:(r7)+", "move r4,y:(r7)+", "move r7,y:>$1dff2", "move y:>$1dff1,m7", "move y:>$1dff0,r7",
                              "nop", "nop", "move y:>$1dff5,sr", "nop", "nop"};
        std::vector<uint32_t> code;
        for (const char *line : stub) {
            const dsp56k::AssembleResult r = as.assemble(line);
            if (!r.success()) { fprintf(stderr, "assemble failed: %s (%d)\n", line, int(r.error)); _exit(3); }
            for (uint32_t k = 0; k < r.wordCount; k++) code.push_back(r.word[k] & 0xffffff);
        }
        code.push_back(0x5e70da), code.push_back(0x046ac9); // the instruction the jsr takes the place of
        code.push_back(0x00000c);                            // rts
        struct { uint32_t word[2]; } j = {{0x0bf080, 0x01f000}}; // jsr >$1f000 (as the program's own long jsrs)
        {
            static dsp56k::Opcodes ops2;
            dsp56k::Disassembler dis(ops2);
            std::string t;
            dis.disassembleMemoryBlock(t, code, 0x1f000, false, true, true);
            fprintf(stderr, "stub:\n%s", t.c_str());
            fprintf(stderr, "words:");
            for (uint32_t w : code) fprintf(stderr, " 0x%06x,", w);
            fprintf(stderr, "\n");
        }
        // the patch goes in from a thread of its own while this one renders:
        // the DSP's thread holds its lock until its audio is taken
        std::atomic<int> done{0};
        std::thread patcher([&] {
            const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(20);
            while (!done && std::chrono::steady_clock::now() < until) {
                if (!mu.try_lock()) { std::this_thread::yield(); continue; } // (the DSP's thread lets go only between batches, briefly)
                const dsp56k::Memory &m = ds->getMemory();
                const uint32_t sites[2] = {0x95d, 0x4fff2}; // Filter 1's two routines (the analog models' in external memory)
                bool orig = true;
                for (uint32_t at : sites) orig = orig && (m.get(dsp56k::MemArea_P, at) & 0xffffff) == 0x5e70da && (m.get(dsp56k::MemArea_P, at + 1) & 0xffffff) == 0x046ac9;
                if (orig && d.getPC().toWord() != 0x95e && d.getPC().toWord() != 0x4fff3) {
                    d.memWrite(dsp56k::MemArea_Y, 0x1dff2, 0x1e000);
                    for (uint32_t a = 0x1e000; a < 0x20000; a++) d.memWrite(dsp56k::MemArea_Y, a, 0);
                    for (size_t k = 0; k < code.size(); k++) d.memWriteP(0x1f000 + uint32_t(k), code[k]);
                    for (uint32_t at : sites) d.memWriteP(at + 1, j.word[1]), d.memWriteP(at, j.word[0]);
                    done = 1;
                }
                mu.unlock();
                if (!orig) { done = -1; break; }
            }
        });
        for (int i = 0; i < 40000 && !done; i++) block();
        patcher.join();
        fprintf(stderr, "hooked: %d\n", int(done));
        if (done != 1) _exit(4);
        notes = {60};
        if (const char *e = getenv("SCAN_NOTES")) {
            notes.clear();
            for (const char *q = e; *q; q++)
                if (q == e || q[-1] == ',') notes.push_back(uint8_t(atoi(q)));
        }
        const int every = getenv("SCAN_EVERY") ? atoi(getenv("SCAN_EVERY")) : 1000;
        FILE *fa = fopen((out + "/audio.f32").c_str(), "wb");
        FILE *f = fopen((out + "/hook.csv").c_str(), "w");
        fprintf(f, "t,voice,value,r0,r4\n");
        const dsp56k::Memory &m = ds->getMemory();
        uint32_t rd = 0x1e000;
        for (int i = 0; i < (getenv("SCAN_BLOCKS") ? atoi(getenv("SCAN_BLOCKS")) : 700); i++) {
            if (i % every == 0 && size_t(i / every) < notes.size()) midi(0x90, notes[size_t(i / every)], 100);
            if (getenv("SCAN_OFF_AT") && i == atoi(getenv("SCAN_OFF_AT")))
                for (uint8_t nn : notes) midi(0x80, nn, 0);
            block();
            fwrite(buf[0], sizeof(float), BLOCK, fa);
            const uint32_t wr = m.get(dsp56k::MemArea_Y, 0x1dff2) & 0xffffff;
            if (wr < 0x1e000 || wr > 0x1ffff || (wr & 3)) continue; // (not a pointer into the ring: skip)
            int guard = 0;
            while (rd != wr && guard++ < 4096) {
                const uint32_t v = m.get(dsp56k::MemArea_Y, rd) & 0xffffff, r1 = m.get(dsp56k::MemArea_Y, 0x1e000 | ((rd + 1) & 0x1fff)) & 0xffffff;
                const uint32_t r0 = m.get(dsp56k::MemArea_Y, 0x1e000 | ((rd + 2) & 0x1fff)) & 0xffffff, r4 = m.get(dsp56k::MemArea_Y, 0x1e000 | ((rd + 3) & 0x1fff)) & 0xffffff;
                fprintf(f, "%.4f,%x,%u,%x,%x\n", i * double(BLOCK) / 44100, r1, v, r0, r4);
                rd = 0x1e000 | ((rd + 4) & 0x1fff);
            }
        }
        fclose(f);
        fclose(fa);
        _exit(0);
    }

    // pdis: the DSP's program memory, disassembled while a note is held
    // (-> <out>/p.asm, <out>/p.bin: the words, 24 bits in 32), for finding
    // the code that works out the cutoff (SCAN_DSP=B: the second DSP)
    if (what == "pdis") {
        for (int i = 4; i < argc; i++) {
            int b = 0, v = 0;
            if (sscanf(argv[i], "%d=%d", &b, &v) == 2) param(b, v);
        }
        notesOn();
        run(0.5);
        const dsp56k::Memory &m = mem();
        const uint32_t n = std::min<uint32_t>(m.size(dsp56k::MemArea_P), getenv("SCAN_PSPAN") ? uint32_t(strtoul(getenv("SCAN_PSPAN"), nullptr, 16)) : 0x40000);
        std::vector<uint32_t> w(n);
        for (uint32_t i = 0; i < n; i++) w[i] = m.get(dsp56k::MemArea_P, i) & 0xffffff;
        FILE *fb = fopen((out + "/p.bin").c_str(), "wb");
        fwrite(w.data(), 4, w.size(), fb);
        fclose(fb);
        uint32_t last = 0;
        for (uint32_t i = 0; i < n; i++)
            if (w[i]) last = i;
        w.resize(last + 2);
        static dsp56k::Opcodes ops;
        dsp56k::Disassembler d(ops);
        std::string text;
        d.disassembleMemoryBlock(text, w, 0, true, true, true);
        FILE *f = fopen((out + "/p.asm").c_str(), "w");
        fputs(text.c_str(), f);
        fclose(f);
        fprintf(stderr, "P: %x words, last used %x\n", unsigned(m.size(dsp56k::MemArea_P)), unsigned(last));
        _exit(0);
    }

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
        if (const char *e = getenv("SCAN_NOTES")) { // the notes (comma list), one every SCAN_EVERY records (40)
            notes.clear();
            for (const char *q = e; *q; q++)
                if (q == e || q[-1] == ',') notes.push_back(uint8_t(atoi(q)));
        }
        const int every = getenv("SCAN_EVERY") ? atoi(getenv("SCAN_EVERY")) : 40;
        FILE *fa = fopen((out + "/audio.f32").c_str(), "wb");
        FILE *f = fopen((out + "/watch.csv").c_str(), "w");
        fprintf(f, "t,note");
        for (auto &w : words) fprintf(f, ",%c:%05x", w.first ? 'Y' : 'X', unsigned(w.second));
        fprintf(f, "\n");
        const dsp56k::Memory &m = mem();
        for (int i = 0; i < 400; i++) {
            int n = -1;
            if (i % every == 0 && size_t(i / every) < notes.size()) midi(0x90, notes[size_t(i / every)], 100), n = notes[size_t(i / every)];
            for (int k = 0; k < RECORD_EVERY; k++) {
                block();
                fwrite(buf[0], sizeof(float), BLOCK, fa);
            }
            fprintf(f, "%.3f,%d", i * double(BLOCK * RECORD_EVERY) / 44100, n);
            for (auto &w : words) fprintf(f, ",%u", m.get(w.first ? dsp56k::MemArea_Y : dsp56k::MemArea_X, w.second) & 0xffffff);
            fprintf(f, "\n");
        }
        fclose(f);
        fclose(fa);
        _exit(0);
    }

    // range: every word's span while the chord is held with the modulation
    // off and on; the words whose span grows with it (not only those still
    // without it: a word may jitter anyway), recorded over 4 s with the
    // audio (-> <out>/lfo.csv, <out>/audio.f32: the left output, 44.1 kHz)
    if (what == "range" || getenv("SCAN_RANGE")) {
        for (int i = 4; i < argc; i++) { // byte=value: the sound's bytes for both passes (the modulation's last)
            int b = 0, v = 0;
            if (sscanf(argv[i], "%d=%d", &b, &v) == 2) param(b, v);
        }
        run(0.5);
        auto span = [&](std::vector<int32_t> &lo, std::vector<int32_t> &hi) {
            notesOn();
            run(0.4);
            std::vector<uint32_t> s = snap();
            lo.assign(s.size(), INT32_MAX), hi.assign(s.size(), INT32_MIN);
            for (int b = 0; b < int(44100 * 3.0 / BLOCK); b += RECORD_EVERY) {
                run(double(BLOCK * RECORD_EVERY) / 44100);
                s = snap();
                for (size_t i = 0; i < s.size(); i++) {
                    int32_t v = int32_t(s[i] << 8) >> 8;
                    lo[i] = std::min(lo[i], v), hi[i] = std::max(hi[i], v);
                }
            }
            notesOff();
            run(1.0);
        };
        std::vector<int32_t> lo0, hi0, lo1, hi1;
        span(lo0, hi0);
        const char *on = getenv("SCAN_MODON"); // the modulation's byte=value (default: the target's)
        int mb = T->modByte, mv = T->modOn;
        if (on) sscanf(on, "%d=%d", &mb, &mv);
        param(mb, mv);
        span(lo1, hi1);
        std::vector<size_t> cand;
        for (size_t i = 0; i < lo0.size(); i++) {
            int64_t r0 = int64_t(hi0[i]) - lo0[i], r1 = int64_t(hi1[i]) - lo1[i];
            if (r1 > 64 && r1 > 4 * r0) cand.push_back(i);
        }
        const uint32_t nx = sizeX();
        fprintf(stderr, "%zu words span more with the modulation\n", cand.size());
        if (cand.size() > 20000) cand.resize(20000);
        FILE *fa = fopen((out + "/audio.f32").c_str(), "wb");
        notesOn();
        run(0.4);
        std::vector<std::vector<uint32_t>> series(cand.size());
        for (int b = 0; b < int(44100 * 4.0 / BLOCK); b += RECORD_EVERY) {
            for (int k = 0; k < RECORD_EVERY; k++) {
                block();
                fwrite(buf[0], sizeof(float), BLOCK, fa);
            }
            const std::vector<uint32_t> sn = snap();
            for (size_t c = 0; c < cand.size(); c++) series[c].push_back(sn[cand[c]]);
        }
        fclose(fa);
        notesOff();
        FILE *f = fopen((out + "/lfo.csv").c_str(), "w");
        for (size_t c = 0; c < cand.size(); c++) {
            fprintf(f, "%c:%05x", cand[c] < nx ? 'X' : 'Y', unsigned(cand[c] < nx ? cand[c] : cand[c] - nx));
            for (uint32_t v : series[c]) fprintf(f, ",%u", v);
            fprintf(f, "\n");
        }
        fclose(f);
        f = fopen((out + "/knob.csv").c_str(), "w"); // (an.py reads it: none here)
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
