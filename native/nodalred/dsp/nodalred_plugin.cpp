// Nodal Red 2X for Pung: the Clavia Nord Lead 2X as gearmulator emulates it
// (n2xLib), behind the chain host's plugin API.
//
// Threads. The emulator renders on its own thread ("nodalred") into a ring;
// render_block only reads the ring. The emulator's two DSP threads and its
// 68k thread are created by that thread and inherit its priority.
//
// State. Everything the device is told goes through this file, so the sound
// is kept here as the synth's own dumps (one multi, four singles) and never
// read back from the emulator.
//
// Slots. The Nord has one panel and four slots: `slot` picks the slot the
// parameters edit, slot_a..slot_d switch slots into the layer. Notes play
// every slot that is on.

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <dirent.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <sys/stat.h>
#include <time.h>

#include "dsp56kBase/logging.h"
#include "n2xLib/n2xdevice.h"
#include "n2xLib/n2xmiditypes.h"
#include "n2xLib/n2xstate.h"
#include "n2xLib/n2xtypes.h"
#include "synthLib/deviceException.h"
#include "synthLib/midiTranslator.h"
#include "synthLib/midiTypes.h"
#include "synthLib/plugin.h"

extern "C" {
#include "host/plugin_api_v1.h"
}

// The 68k emulator writes every register access to stderr through this
// function, which would fill the host's log. Defined here, the linker takes
// this one and leaves the library's (cpu/mc68k/logging.cpp) out.
namespace mc68k {
void logToConsole(const std::string &) {}
} // namespace mc68k

namespace {

const host_api_v1_t *g_host = nullptr;

void plog(const char *fmt, ...) {
    char b[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof(b), fmt, ap);
    va_end(ap);
    if (g_host && g_host->log) {
        char m[560];
        snprintf(m, sizeof(m), "nodalred: %s", b);
        g_host->log(m);
    } else {
        fprintf(stderr, "nodalred: %s\n", b);
    }
}

int64_t now_us() {
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return int64_t(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

// ---- parameters ---------------------------------------------------------------

using n2x::State;
typedef State::SingleDump Single;
typedef State::MultiDump Multi;

enum Kind {
    kCC,    // a single parameter with a controller
    kDump,  // a single parameter the synth only takes in a dump
    kBits,  // a bit field in the Sync byte (sync, ring mod: CC 35; distortion: CC 80)
    kMulti, // a performance parameter, one per slot (index + slot)
    kGlobal, // a performance parameter, one for the synth
    kNibble  // the low half of a performance byte (the output mode of slots A and B)
};

const char *o_wave1[] = {"Pulse", "Saw", "Triangle", "Sine"};
const char *o_wave2[] = {"Pulse", "Saw", "Triangle", "Noise"};
const char *o_offon[] = {"Off", "On"};
const char *o_ftype[] = {"LP 12", "LP 24", "HP 24", "BP", "Notch+LP"};
const char *o_fkbt[] = {"Off", "1/3", "2/3", "Full"};
const char *o_lfo1wave[] = {"Random", "Saw", "Triangle", "Square", "Soft Random"};
const char *o_lfo1dest[] = {"PW", "Filter", "Osc 2", "Osc 1+2", "FM"};
const char *o_lfo2dest[] = {"Arp Down", "Arp Up", "Arp Up/Down", "LFO Amp", "LFO Osc 1+2", "Arp Random", "Echo", "LFO Filter", "Off"};
const char *o_mode[] = {"Mono", "Legato", "Poly"};
const char *o_mwdest[] = {"Filter", "FM", "Osc 2", "LFO 1", "Morph"};
const char *o_medest[] = {"Osc 2", "FM", "PW", "None"};
const char *o_outmode[] = {"Unison Stereo", "Mono", "Stereo", "Slot A left, B right"};
const char *o_sync[] = {"Off", "2/1", "1/1", "1/2", "1/4", "1/8", "1/8.", "1/16"};
const char *o_slot[] = {"A", "B", "C", "D"};
const char *o_prdest[] = {"LFO 1 Amount", "LFO 2 Amount", "Filter Cutoff", "FM Amount", "Osc 2 Pitch"};

struct Param {
    const char *key;
    const char *name;
    const char *level;
    Kind kind;
    int index;  // SingleParam, or MultiParam
    int cc;     // controller, or the bit for kBits
    int min, max;
    int offset; // shown value = stored value - offset
    const char **opts;
    int nopts;
};

#define OPT(a) a, int(sizeof(a) / sizeof(a[0]))
#define NOOPT nullptr, 0

const Param g_params[] = {
    // oscillators
    {"osc1_wave", "Osc 1 Wave", "osc", kCC, n2x::O1Waveform, n2x::CCO1Waveform, 0, 3, 0, OPT(o_wave1)},
    {"osc2_wave", "Osc 2 Wave", "osc", kCC, n2x::O2Waveform, n2x::CCO2Waveform, 0, 3, 0, OPT(o_wave2)},
    {"osc2_semi", "Osc 2 Semi", "osc", kCC, n2x::O2Pitch, n2x::CCO2Pitch, -60, 60, 60, NOOPT},
    {"osc2_fine", "Osc 2 Fine", "osc", kCC, n2x::O2PitchFine, n2x::CCO2PitchFine, -64, 63, 64, NOOPT},
    {"fm", "FM Amount", "osc", kCC, n2x::FmDepth, n2x::CCFmDepth, 0, 127, 0, NOOPT},
    {"pw", "Pulse Width", "osc", kCC, n2x::PW, n2x::CCPW, 0, 127, 0, NOOPT},
    {"mix", "Osc Mix", "osc", kCC, n2x::Mix, n2x::CCMix, 0, 127, 0, NOOPT},
    {"osc2_kbt", "Osc 2 Kbd Track", "osc", kCC, n2x::O2Keytrack, n2x::CCO2Keytrack, 0, 1, 0, OPT(o_offon)},
    {"sync", "Sync", "osc", kBits, n2x::Sync, 0, 0, 1, 0, OPT(o_offon)},
    {"ringmod", "Ring Mod", "osc", kBits, n2x::Sync, 1, 0, 1, 0, OPT(o_offon)},
    // filter
    {"cutoff", "Cutoff", "filter", kCC, n2x::Cutoff, n2x::CCCutoff, 0, 127, 0, NOOPT},
    {"resonance", "Resonance", "filter", kCC, n2x::Resonance, n2x::CCResonance, 0, 127, 0, NOOPT},
    {"filter_env", "Env Amount", "filter", kCC, n2x::FilterEnvAmount, n2x::CCFilterEnvAmount, 0, 127, 0, NOOPT},
    {"filter_type", "Filter Type", "filter", kDump, n2x::FilterType, -1, 0, 4, 0, OPT(o_ftype)},
    {"filter_kbt", "Kbd Track", "filter", kCC, n2x::FilterKeytrack, n2x::CCFilterKeytrack, 0, 3, 0, OPT(o_fkbt)},
    {"filter_velo", "Velocity", "filter", kCC, n2x::FilterVelocity, n2x::CCFilterVelocity, 0, 1, 0, OPT(o_offon)},
    {"distortion", "Distortion", "filter", kBits, n2x::Sync, 4, 0, 1, 0, OPT(o_offon)},
    {"flt_attack", "Flt Attack", "filter", kCC, n2x::FilterEnvA, n2x::CCFilterEnvA, 0, 127, 0, NOOPT},
    {"flt_decay", "Flt Decay", "filter", kCC, n2x::FilterEnvD, n2x::CCFilterEnvD, 0, 127, 0, NOOPT},
    {"flt_sustain", "Flt Sustain", "filter", kCC, n2x::FilterEnvS, n2x::CCFilterEnvS, 0, 127, 0, NOOPT},
    {"flt_release", "Flt Release", "filter", kCC, n2x::FilterEnvR, n2x::CCFilterEnvR, 0, 127, 0, NOOPT},
    // amplifier
    {"amp_attack", "Amp Attack", "amp", kCC, n2x::AmpEnvA, n2x::CCAmpEnvA, 0, 127, 0, NOOPT},
    {"amp_decay", "Amp Decay", "amp", kCC, n2x::AmpEnvD, n2x::CCAmpEnvD, 0, 127, 0, NOOPT},
    {"amp_sustain", "Amp Sustain", "amp", kCC, n2x::AmpEnvS, n2x::CCAmpEnvS, 0, 127, 0, NOOPT},
    {"amp_release", "Amp Release", "amp", kCC, n2x::AmpEnvR, n2x::CCAmpEnvR, 0, 127, 0, NOOPT},
    {"amp_gain", "Gain", "amp", kCC, n2x::Gain, n2x::CCGain, 0, 127, 0, NOOPT},
    // modulation
    {"lfo1_rate", "LFO 1 Rate", "mod", kCC, n2x::Lfo1Rate, n2x::CCLfo1Rate, 0, 127, 0, NOOPT},
    {"lfo1_amount", "LFO 1 Amount", "mod", kCC, n2x::Lfo1Level, n2x::CCLfo1Level, 0, 127, 0, NOOPT},
    {"lfo1_wave", "LFO 1 Wave", "mod", kCC, n2x::Lfo1Waveform, n2x::CCLfo1Waveform, 0, 4, 0, OPT(o_lfo1wave)},
    {"lfo1_dest", "LFO 1 Dest", "mod", kCC, n2x::Lfo1Dest, n2x::CCLfo1Dest, 0, 4, 0, OPT(o_lfo1dest)},
    {"lfo1_sync", "LFO 1 Sync", "mod", kMulti, n2x::SlotALfo1Sync, -1, 0, 7, 0, OPT(o_sync)},
    {"lfo2_rate", "LFO 2 Rate", "mod", kCC, n2x::Lfo2Rate, n2x::CCLfo2Rate, 0, 127, 0, NOOPT},
    {"lfo2_amount", "LFO 2 Amt/Arp", "mod", kCC, n2x::ArpRange, n2x::CCArpRange, 0, 127, 0, NOOPT},
    {"lfo2_dest", "LFO 2 / Arp", "mod", kCC, n2x::Lfo2Dest, n2x::CCLfo2Dest, 0, 8, 0, OPT(o_lfo2dest)},
    {"lfo2_sync", "LFO 2 Sync", "mod", kMulti, n2x::SlotALfo2Sync, -1, 0, 7, 0, OPT(o_sync)},
    {"modenv_attack", "Mod Env Attack", "mod", kCC, n2x::ModEnvA, n2x::CCModEnvA, 0, 127, 0, NOOPT},
    {"modenv_decay", "Mod Env Decay", "mod", kCC, n2x::ModEnvD, n2x::CCModEnvD, 0, 127, 0, NOOPT},
    {"modenv_amount", "Mod Env Amount", "mod", kCC, n2x::ModEnvLevel, n2x::CCModEnvLevel, -64, 63, 64, NOOPT},
    {"modenv_dest", "Mod Env Dest", "mod", kCC, n2x::ModEnvDest, n2x::CCModEnvDest, 0, 3, 0, OPT(o_medest)},
    // voice
    {"voice_mode", "Voice Mode", "voice", kCC, n2x::VoiceMode, n2x::CCVoiceMode, 0, 2, 0, OPT(o_mode)},
    {"unison", "Unison", "voice", kCC, n2x::Unison, n2x::CCUnison, 0, 1, 0, OPT(o_offon)},
    {"portamento", "Portamento", "voice", kCC, n2x::Portamento, n2x::CCPortamento, 0, 127, 0, NOOPT},
    {"porta_auto", "Porta Auto", "voice", kCC, n2x::Auto, n2x::CCAuto, 0, 1, 0, OPT(o_offon)},
    {"octave", "Octave", "voice", kCC, n2x::OctaveShift, n2x::CCOctaveShift, -2, 2, 2, NOOPT},
    {"modwheel_dest", "Mod Wheel Dest", "voice", kCC, n2x::ModWheelDest, n2x::CCModWheelDest, 0, 4, 0, OPT(o_mwdest)},
    {"pressure_amount", "Pressure Amt", "voice", kMulti, n2x::SlotAChannelPressureAmount, -1, 0, 7, 0, NOOPT},
    {"pressure_dest", "Pressure Dest", "voice", kMulti, n2x::SlotAChannelPressureDest, -1, 0, 4, 0, OPT(o_prdest)},
    {"pedal_amount", "Pedal Amt", "voice", kMulti, n2x::SlotAExpressionPedalAmount, -1, 0, 7, 0, NOOPT},
    {"pedal_dest", "Pedal Dest", "voice", kMulti, n2x::SlotAExpressionPedalDest, -1, 0, 4, 0, OPT(o_prdest)},
    // morph: how far velocity or the mod wheel moves each knob
    {"morph_cutoff", "Cutoff", "morph", kDump, 28, -1, -128, 127, 0, NOOPT},
    {"morph_resonance", "Resonance", "morph", kDump, 29, -1, -128, 127, 0, NOOPT},
    {"morph_filter_env", "Flt Env Amt", "morph", kDump, 30, -1, -128, 127, 0, NOOPT},
    {"morph_mix", "Osc Mix", "morph", kDump, 27, -1, -128, 127, 0, NOOPT},
    {"morph_fm", "FM Amount", "morph", kDump, 32, -1, -128, 127, 0, NOOPT},
    {"morph_pw", "Pulse Width", "morph", kDump, 31, -1, -128, 127, 0, NOOPT},
    {"morph_osc2_semi", "Osc 2 Semi", "morph", kDump, 25, -1, -128, 127, 0, NOOPT},
    {"morph_osc2_fine", "Osc 2 Fine", "morph", kDump, 26, -1, -128, 127, 0, NOOPT},
    {"morph_flt_attack", "Flt Attack", "morph", kDump, 33, -1, -128, 127, 0, NOOPT},
    {"morph_flt_decay", "Flt Decay", "morph", kDump, 34, -1, -128, 127, 0, NOOPT},
    {"morph_flt_sustain", "Flt Sustain", "morph", kDump, 35, -1, -128, 127, 0, NOOPT},
    {"morph_flt_release", "Flt Release", "morph", kDump, 36, -1, -128, 127, 0, NOOPT},
    {"morph_amp_attack", "Amp Attack", "morph", kDump, 37, -1, -128, 127, 0, NOOPT},
    {"morph_amp_decay", "Amp Decay", "morph", kDump, 38, -1, -128, 127, 0, NOOPT},
    {"morph_amp_sustain", "Amp Sustain", "morph", kDump, 39, -1, -128, 127, 0, NOOPT},
    {"morph_amp_release", "Amp Release", "morph", kDump, 40, -1, -128, 127, 0, NOOPT},
    {"morph_portamento", "Portamento", "morph", kDump, 41, -1, -128, 127, 0, NOOPT},
    {"morph_gain", "Gain", "morph", kDump, 42, -1, -128, 127, 0, NOOPT},
    {"morph_modenv_attack", "Mod Env Att", "morph", kDump, 43, -1, -128, 127, 0, NOOPT},
    {"morph_modenv_decay", "Mod Env Dec", "morph", kDump, 44, -1, -128, 127, 0, NOOPT},
    {"morph_modenv_amount", "Mod Env Amt", "morph", kDump, 45, -1, -128, 127, 0, NOOPT},
    {"morph_lfo1_rate", "LFO 1 Rate", "morph", kDump, 46, -1, -128, 127, 0, NOOPT},
    {"morph_lfo1_amount", "LFO 1 Amount", "morph", kDump, 47, -1, -128, 127, 0, NOOPT},
    {"morph_lfo2_rate", "LFO 2 Rate", "morph", kDump, 48, -1, -128, 127, 0, NOOPT},
    {"morph_lfo2_amount", "LFO 2 Amount", "morph", kDump, 49, -1, -128, 127, 0, NOOPT},
    // the synth as a whole
    {"bend_range", "Bend Range", "global", kGlobal, n2x::BendRange, -1, 0, 8, 0, NOOPT},
    {"unison_detune", "Unison Detune", "global", kGlobal, n2x::UnisonDetune, -1, 0, 8, 0, NOOPT},
    {"master_tune", "Master Tune", "global", kGlobal, n2x::MasterTune, -1, -99, 99, 0, NOOPT},
    {"out_mode", "Output Mode", "global", kNibble, n2x::OutModeABCD, -1, 0, 3, 0, OPT(o_outmode)},
};
const int NPARAMS = int(sizeof(g_params) / sizeof(g_params[0]));

const Param *find_param(const char *key) {
    for (int i = 0; i < NPARAMS; i++)
        if (!strcmp(g_params[i].key, key)) return &g_params[i];
    return nullptr;
}

// ---- the library: dumps from the user's files ----------------------------------

struct Sound {
    std::string name;
    std::vector<uint8_t> dump; // a single or a multi dump, without a name
    bool multi = false;
};
struct Bank {
    std::string name;
    std::vector<Sound> sounds;
};

bool read_file(const std::string &path, std::vector<uint8_t> &out) {
    FILE *f = fopen(path.c_str(), "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n < 0 || n > 8 * 1024 * 1024) {
        fclose(f);
        return false;
    }
    out.resize(size_t(n));
    size_t got = n ? fread(out.data(), 1, size_t(n), f) : 0;
    fclose(f);
    return got == size_t(n);
}

std::string trim(const std::string &s) {
    size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == 0 || s[a] == '\r')) a++;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == 0 || s[b - 1] == '\r')) b--;
    return s.substr(a, b - a);
}

// Every F0..F7 message in a file: a .syx is a row of them, and in a .mid they
// sit in the track with a length in between, which never contains F0 33.
void parse_bank(const std::vector<uint8_t> &d, Bank &bank) {
    int programs = 0, perfs = 0;
    for (size_t i = 0; i + 6 < d.size(); i++) {
        if (d[i] != 0xf0 || d[i + 1] != n2x::IdClavia || d[i + 3] != n2x::IdN2X) continue;
        size_t e = i + 1;
        while (e < d.size() && d[e] != 0xf7 && d[e] < 0x80) e++;
        if (e >= d.size() || d[e] != 0xf7) continue;
        synthLib::SysexBuffer msg(d.begin() + long(i), d.begin() + long(e) + 1);
        i = e;
        const bool single = State::isSingleDump(msg);
        if (!single && !State::isMultiDump(msg)) continue;
        const uint8_t type = msg[n2x::IdxMsgType];
        if (single && type > 10) continue;                                     // a request, not a dump (banks are 1 to 10)
        if (!single && (type < n2x::MultiDumpBankEditBuffer || type >= n2x::MultiRequestBankEditBuffer)) continue;
        Sound s;
        s.multi = !single;
        s.name = trim(State::extractPatchName(msg));
        for (auto &c : s.name)
            if (c < 32 || c > 126 || c == '"' || c == '\\') c = ' ';
        { const auto bare = State::stripPatchName(msg); s.dump.assign(bare.begin(), bare.end()); }
        char nb[32];
        if (single)
            snprintf(nb, sizeof(nb), "Program %02d", ++programs);
        else
            snprintf(nb, sizeof(nb), "Performance %02d", ++perfs);
        if (s.name.empty())
            s.name = nb;
        else if (!single)
            s.name += " (Perf)";
        bank.sounds.push_back(std::move(s));
    }
}

// The Nord stores no names. "<file>.txt" beside a bank names its sounds, one
// a line, in the file's order.
void name_sounds(const std::string &path, Bank &b) {
    std::vector<uint8_t> txt;
    if (!read_file(path, txt)) return;
    size_t i = 0, at = 0;
    while (at < txt.size() && i < b.sounds.size()) {
        size_t e = at;
        while (e < txt.size() && txt[e] != '\n') e++;
        std::string name = trim(std::string(txt.begin() + long(at), txt.begin() + long(e)));
        for (auto &c : name)
            if (c == '"' || c == '\\' || (unsigned char)c < 32) c = ' ';
        if (name.size() > 40) name.resize(40);
        if (!name.empty()) b.sounds[i].name = trim(name);
        i++;
        at = e + 1;
    }
}

void scan_banks(const std::string &dir, std::vector<Bank> &banks, int depth = 0) {
    DIR *d = opendir(dir.c_str());
    if (!d) return;
    std::vector<std::string> names;
    while (dirent *e = readdir(d))
        if (e->d_name[0] != '.') names.push_back(e->d_name);
    closedir(d);
    std::sort(names.begin(), names.end());
    for (auto &n : names) {
        const std::string p = dir + "/" + n;
        struct stat st;
        if (stat(p.c_str(), &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            if (depth < 3) scan_banks(p, banks, depth + 1);
            continue;
        }
        const size_t dot = n.rfind('.');
        if (dot == std::string::npos) continue;
        std::string ext = n.substr(dot);
        for (auto &c : ext) c = char(tolower(c));
        if (ext != ".syx") continue;
        std::vector<uint8_t> data;
        if (!read_file(p, data)) continue;
        Bank b;
        b.name = n.substr(0, dot);
        for (auto &c : b.name)
            if (c == '"' || c == '\\' || c < 32) c = ' ';
        parse_bank(data, b);
        name_sounds(dir + "/" + n.substr(0, dot) + ".txt", b);
        if (!b.sounds.empty() && banks.size() < 64) banks.push_back(std::move(b));
    }
}

bool find_rom(const std::string &dir, std::vector<uint8_t> &rom, std::string &name) {
    DIR *d = opendir(dir.c_str());
    if (!d) return false;
    std::vector<std::string> names;
    while (dirent *e = readdir(d))
        if (e->d_name[0] != '.') names.push_back(e->d_name);
    closedir(d);
    std::sort(names.begin(), names.end());
    for (auto &n : names) {
        const std::string p = dir + "/" + n;
        struct stat st;
        if (stat(p.c_str(), &st) != 0 || !S_ISREG(st.st_mode) || st.st_size != n2x::g_romSize) continue;
        std::vector<uint8_t> data;
        if (!read_file(p, data)) continue;
        if (!n2x::Rom::isValidRom(data)) continue;
        rom = std::move(data);
        name = n;
        return true;
    }
    return false;
}

// ---- the instance ---------------------------------------------------------------

const int RING = 4096;      // stereo frames, a power of two
const int BLOCK = 64;       // frames the emulator renders at a time
const int AHEAD = 320;      // frames kept ready for the host (7 ms)

struct Instance {
    std::string dir;

    // the emulator, owned by its thread
    std::thread emu;
    std::atomic<bool> quit{false};
    std::atomic<int> loading{1};
    sem_t wake;
    std::unique_ptr<n2x::Device> device;
    std::unique_ptr<synthLib::Plugin> plugin;
    std::mutex plugMu; // plugin exists and may be handed MIDI

    // audio ring: the emulator writes, render_block reads
    int16_t ring[RING * 2];
    std::atomic<uint32_t> wr{0}, rd{0};
    std::atomic<uint32_t> underruns{0};
    std::atomic<uint32_t> blockUs{0}, blockMaxUs{0};

    // the sound, under mu
    std::mutex mu;
    Multi multi;
    Single single[4];
    bool on[4] = {true, false, false, false};
    int slot = 0;
    int gain = 100; // percent
    bool singleDirty[4] = {false, false, false, false};
    bool multiDirty = false;
    int64_t busyUntil = 0; // a dump is on its way into the synth until then
    std::string slotName[4]; // the sound each slot was given (the Nord keeps no names)

    // what the synth sent (dumps it was asked for), under outMu
    std::mutex outMu;
    std::vector<std::vector<uint8_t>> midiOut;

    // the library, under mu
    std::vector<Bank> banks;
    int bank = 0, preset = 0;
    std::string romName;
    char status[160] = "Starting";
    char error[200] = "";
};

uint8_t s_get(const Single &s, int sp) { return State::unpackNibbles(s, State::getOffsetInSingleDump(n2x::SingleParam(sp))); }
void s_set(Single &s, int sp, uint8_t v) { State::packNibbles(s, State::getOffsetInSingleDump(n2x::SingleParam(sp)), v); }
uint8_t m_get(const Multi &m, int mp) { return State::unpackNibbles(m, State::getOffsetInMultiDump(n2x::MultiParam(mp))); }
void m_set(Multi &m, int mp, uint8_t v) { State::packNibbles(m, State::getOffsetInMultiDump(n2x::MultiParam(mp)), v); }

void send(Instance *in, synthLib::SMidiEvent &ev) {
    std::lock_guard<std::mutex> l(in->plugMu);
    if (in->plugin) in->plugin->addMidiEvent(ev);
}
void send_sysex(Instance *in, const uint8_t *d, size_t n) {
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host);
    ev.sysex.assign(d, d + n);
    send(in, ev);
}
// A controller to one slot: past the channel translation, which sends
// channel 1 to every slot that is on.
void send_slot_cc(Instance *in, int slot, int cc, int val) {
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, uint8_t(0xb0 | slot), uint8_t(cc), uint8_t(val));
    synthLib::MidiTranslator::createPacketSkipTranslation(ev);
    send(in, ev);
}

// The multi as the synth is to have it: the four singles in it, and the
// slots that are on listening on channel 1, the others on none.
void compose_multi(Instance *in, Multi &out) {
    for (uint8_t i = 0; i < 4; i++) State::copySingleToMulti(in->multi, in->single[i], i);
    for (int i = 0; i < 4; i++) {
        m_set(in->multi, n2x::SlotAMidiChannel + i, in->on[i] ? 0 : 16);
        m_set(in->multi, n2x::SlotAChannelActive + i, in->on[i] ? 1 : 0);
    }
    m_set(in->multi, n2x::SelectedChannel, uint8_t(in->slot));
    m_set(in->multi, n2x::MidiProgramChange, 0);
    m_set(in->multi, n2x::MidiControl, 1);
    out = in->multi;
    out[n2x::IdxMsgType] = n2x::MultiDumpBankEditBuffer;
    out[n2x::IdxMsgSpec] = 0;
}

// How long the synth takes to receive n bytes at MIDI speed (3125 a second)
// and act on them. Measured 2026-11-18: a controller sent while a dump was
// still arriving was lost, the dump's value won.
int64_t dump_time(size_t n) { return int64_t(n) * 320 + 150000; }

// mu held. One dump at a time: the next waits until the synth has taken the
// last. That also keeps a turning knob from sending more than a few a second.
void flush_dumps(Instance *in, bool force) {
    const int64_t t = now_us();
    if (!force && t < in->busyUntil) return;
    if (in->multiDirty) {
        Multi m;
        compose_multi(in, m);
        m[n2x::g_multiDumpSize - 1] = 0xf7;
        send_sysex(in, m.data(), n2x::g_multiDumpSize);
        in->multiDirty = false;
        for (bool &d : in->singleDirty) d = false;
        in->busyUntil = t + dump_time(n2x::g_multiDumpSize);
        return;
    }
    for (int i = 0; i < 4; i++) {
        if (!in->singleDirty[i]) continue;
        Single s = in->single[i];
        s[n2x::IdxMsgType] = n2x::SingleDumpBankEditBuffer;
        s[n2x::IdxMsgSpec] = uint8_t(i);
        s[n2x::g_singleDumpSize - 1] = 0xf7;
        send_sysex(in, s.data(), n2x::g_singleDumpSize);
        in->singleDirty[i] = false;
        in->busyUntil = t + dump_time(n2x::g_singleDumpSize);
        return;
    }
}

void init_sound(Instance *in) {
    State::createDefaultMulti(in->multi);
    for (uint8_t i = 0; i < 4; i++) State::createDefaultSingle(in->single[i], i);
    in->on[0] = true;
    in->on[1] = in->on[2] = in->on[3] = false;
    in->slot = 0;
    for (auto &n : in->slotName) n = "Init Program";
    in->multiDirty = true;
}

// mu held
void load_sound(Instance *in, const Sound &s) {
    if (s.multi) {
        if (s.dump.size() < n2x::g_multiDumpSize) return;
        in->multi.fill(0);
        std::copy_n(s.dump.begin(), n2x::g_multiDumpSize, in->multi.begin());
        for (uint8_t i = 0; i < 4; i++) {
            State::createDefaultSingle(in->single[i], i);
            State::extractSingleFromMulti(in->single[i], in->multi, i);
            in->on[i] = m_get(in->multi, n2x::SlotAChannelActive + i) != 0;
        }
        if (!in->on[0] && !in->on[1] && !in->on[2] && !in->on[3]) in->on[0] = true;
        in->slot = std::min<int>(3, m_get(in->multi, n2x::SelectedChannel));
        if (!in->on[in->slot])
            for (int i = 0; i < 4; i++)
                if (in->on[i]) {
                    in->slot = i;
                    break;
                }
        for (auto &n : in->slotName) n = s.name;
        in->multiDirty = true;
    } else {
        if (s.dump.size() < n2x::g_singleDumpSize) return;
        Single &d = in->single[in->slot];
        d.fill(0);
        std::copy_n(s.dump.begin(), n2x::g_singleDumpSize, d.begin());
        d[n2x::IdxMsgType] = n2x::SingleDumpBankEditBuffer;
        d[n2x::IdxMsgSpec] = uint8_t(in->slot);
        in->slotName[in->slot] = s.name;
        in->singleDirty[in->slot] = true;
    }
}

// ---- the sounds in the firmware -------------------------------------------------
// Program banks 4 to 9 and performance banks 1 to 3 are part of the firmware.
// The synth sends any of them when asked (a dump request), so on its first
// start the module asks for them all, one at a time, and writes them into
// banks/ as ordinary bank files. That takes about two minutes of the synth's
// MIDI and happens once; the synth plays meanwhile.
//
// A request's type is the dump's plus 14 for a program, plus 10 for a
// performance. Type 20 is also "send all controllers" for slots 0 to 3, so
// the first four programs of bank 5 cannot be asked for.

struct RomRead {
    struct Ask { uint8_t type, spec, wantType; uint32_t wantSize; int file; };
    std::vector<Ask> todo;
    std::vector<std::vector<uint8_t>> files; // the dumps of each bank file, one after the other
    std::vector<std::string> names;
    size_t at = 0;
    int64_t sentAt = 0;
    bool waiting = false, active = false;
    int got = 0;
};

bool has_rom_banks(const std::string &dir) {
    DIR *d = opendir(dir.c_str());
    if (!d) return false;
    bool found = false;
    while (dirent *e = readdir(d)) {
        const size_t n = strlen(e->d_name);
        if (!strncmp(e->d_name, "ROM ", 4) && n > 4 && !strcasecmp(e->d_name + n - 4, ".syx")) found = true; // not a names file
    }
    closedir(d);
    return found;
}

void rom_read_plan(RomRead &r) {
    for (int bank = 4; bank <= 9; bank++) { // dump types 5 to 10
        char n[64];
        snprintf(n, sizeof(n), "ROM Programs %d", bank);
        r.names.push_back(n);
        r.files.emplace_back();
        for (int p = 0; p < 99; p++) {
            if (bank == 5 && p < 4) continue;
            r.todo.push_back({uint8_t(15 + bank), uint8_t(p), uint8_t(1 + bank), n2x::g_singleDumpSize, int(r.files.size()) - 1});
        }
    }
    for (int bank = 1; bank <= 3; bank++) { // dump types 32 to 34
        char n[64];
        snprintf(n, sizeof(n), "ROM Performances %d", bank);
        r.names.push_back(n);
        r.files.emplace_back();
        for (int p = 0; p < 100; p++)
            r.todo.push_back({uint8_t(41 + bank), uint8_t(p), uint8_t(31 + bank), n2x::g_multiDumpSize, int(r.files.size()) - 1});
    }
    r.active = true;
}

void set_status(Instance *in, const char *s) {
    std::lock_guard<std::mutex> l(in->mu);
    snprintf(in->status, sizeof(in->status), "%s", s);
}

void emu_main(Instance *in) {
    pthread_setname_np(pthread_self(), "nodalred");
    // Below the host's audio threads, above everything ordinary. The
    // emulator's own threads are made by this one and inherit it.
    sched_param sp{};
    sp.sched_priority = 45;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0) plog("no realtime priority for the emulator (%s)", strerror(errno));

    std::vector<uint8_t> rom;
    std::string romName;
    if (!find_rom(in->dir + "/roms", rom, romName)) {
        std::lock_guard<std::mutex> l(in->mu);
        snprintf(in->error, sizeof(in->error),
                 "No ROM: put a Nord Lead 2X firmware (.bin, 524,288 bytes) into the module's roms folder");
        snprintf(in->status, sizeof(in->status), "ROM missing");
        in->loading = 0;
        return;
    }
    set_status(in, "Booting the Nord Lead 2X");
    try {
        synthLib::DeviceCreateParams p;
        p.romData = rom;
        p.romName = romName;
        p.hostSamplerate = 44100.0f;
        in->device.reset(new n2x::Device(p));
        std::unique_ptr<synthLib::Plugin> pl(new synthLib::Plugin(in->device.get(), [](synthLib::Device *d) { return d; }));
        pl->setHostSamplerate(44100.0f, 0.0f);
        pl->setBlockSize(BLOCK);
        std::lock_guard<std::mutex> l(in->plugMu);
        in->plugin = std::move(pl);
    } catch (const std::exception &e) {
        std::lock_guard<std::mutex> l(in->mu);
        snprintf(in->error, sizeof(in->error), "The emulator did not start: %s", e.what());
        snprintf(in->status, sizeof(in->status), "Failed");
        in->loading = 0;
        return;
    }
    {
        std::lock_guard<std::mutex> l(in->mu);
        in->romName = romName;
        const auto knob = State::createKnobSysex(n2x::KnobType::MasterVol, 0xff);
        send_sysex(in, knob.data(), knob.size());
        in->multiDirty = true; // the sound as it is by now: the default, or a state set while booting
        flush_dumps(in, true);
        snprintf(in->status, sizeof(in->status), "Ready");
    }
    in->loading = 0;
    plog("running, ROM %s", romName.c_str());

    std::vector<synthLib::SMidiEvent> midiEv;
    RomRead rr;
    mkdir((in->dir + "/banks").c_str(), 0755);
    if (!has_rom_banks(in->dir + "/banks")) rom_read_plan(rr);
    float buf[4][BLOCK];
    synthLib::TAudioInputs ins{};
    synthLib::TAudioOutputs outs{};
    for (int i = 0; i < 4; i++) outs[size_t(i)] = buf[i];

    while (!in->quit.load(std::memory_order_relaxed)) {
        uint32_t fill = in->wr.load(std::memory_order_relaxed) - in->rd.load(std::memory_order_acquire);
        while (fill < uint32_t(AHEAD) && !in->quit.load(std::memory_order_relaxed)) {
            const int64_t t0 = now_us();
            for (auto &b : buf) memset(b, 0, sizeof(b));
            in->plugin->process(ins, outs, BLOCK, 120.0f, 0.0f, false);
            midiEv.clear();
            in->plugin->getMidiOut(midiEv);
            for (auto &e : midiEv) {
                if (e.sysex.size() < 8) continue;
                if (rr.active && rr.waiting) {
                    const auto &a = rr.todo[rr.at];
                    if (e.sysex.size() == a.wantSize && e.sysex[n2x::IdxMsgType] == a.wantType && e.sysex[n2x::IdxMsgSpec] == a.spec) {
                        auto &f = rr.files[size_t(a.file)];
                        f.insert(f.end(), e.sysex.begin(), e.sysex.end());
                        rr.got++;
                        rr.waiting = false;
                        rr.at++;
                        continue;
                    }
                }
                std::lock_guard<std::mutex> l(in->outMu);
                if (in->midiOut.size() < 2048) in->midiOut.emplace_back(e.sysex.begin(), e.sysex.end());
            }
            float g;
            {
                // not worth a lock: an int read
                g = float(in->gain) * 0.01f * 32767.0f;
            }
            uint32_t w = in->wr.load(std::memory_order_relaxed);
            for (int i = 0; i < BLOCK; i++) {
                float l = (buf[0][i] + buf[2][i]) * g, r = (buf[1][i] + buf[3][i]) * g;
                l = l > 32767.f ? 32767.f : (l < -32768.f ? -32768.f : l);
                r = r > 32767.f ? 32767.f : (r < -32768.f ? -32768.f : r);
                const uint32_t k = (w + uint32_t(i)) & (RING - 1);
                in->ring[k * 2] = int16_t(lrintf(l));
                in->ring[k * 2 + 1] = int16_t(lrintf(r));
            }
            in->wr.store(w + BLOCK, std::memory_order_release);
            const uint32_t us = uint32_t(now_us() - t0);
            in->blockUs.store(us, std::memory_order_relaxed);
            if (us > in->blockMaxUs.load(std::memory_order_relaxed)) in->blockMaxUs.store(us, std::memory_order_relaxed);
            fill = in->wr.load(std::memory_order_relaxed) - in->rd.load(std::memory_order_acquire);
        }
        if (in->mu.try_lock()) {
            flush_dumps(in, false);
            in->mu.unlock();
        }
        if (rr.active) {
            const int64_t t = now_us();
            if (rr.waiting && t - rr.sentAt > 1500000) { // no answer: on to the next
                rr.waiting = false;
                rr.at++;
            }
            if (!rr.waiting && rr.at < rr.todo.size()) {
                const auto &a = rr.todo[rr.at];
                const uint8_t req[] = {0xf0, n2x::IdClavia, n2x::DefaultDeviceId, n2x::IdN2X, a.type, a.spec, 0xf7};
                send_sysex(in, req, sizeof(req));
                rr.waiting = true;
                rr.sentAt = t;
                if (rr.at % 16 == 0) {
                    char st[96];
                    snprintf(st, sizeof(st), "Reading the firmware's sounds: %d of %d", int(rr.at), int(rr.todo.size()));
                    set_status(in, st);
                }
            } else if (!rr.waiting) {
                rr.active = false;
                std::vector<Bank> found;
                for (size_t i = 0; i < rr.files.size(); i++) {
                    if (rr.files[i].empty()) continue;
                    const std::string path = in->dir + "/banks/" + rr.names[i] + ".syx";
                    if (FILE *f = fopen((path + ".part").c_str(), "wb")) {
                        const bool ok = fwrite(rr.files[i].data(), 1, rr.files[i].size(), f) == rr.files[i].size();
                        fclose(f);
                        if (ok) rename((path + ".part").c_str(), path.c_str());
                    }
                    Bank b;
                    b.name = rr.names[i];
                    parse_bank(rr.files[i], b);
                    name_sounds(in->dir + "/banks/" + rr.names[i] + ".txt", b);
                    if (!b.sounds.empty()) found.push_back(std::move(b));
                }
                plog("read %d of %d sounds from the firmware", rr.got, int(rr.todo.size()));
                std::lock_guard<std::mutex> l(in->mu);
                for (auto &b : found)
                    if (in->banks.size() < 64) in->banks.push_back(std::move(b));
                snprintf(in->status, sizeof(in->status), "Ready");
                rr = RomRead();
            }
        }
        timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 2000000;
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec++;
            ts.tv_nsec -= 1000000000;
        }
        sem_timedwait(&in->wake, &ts);
    }
}

// ---- the plugin API -------------------------------------------------------------

void *v2_create(const char *module_dir, const char *) {
    Instance *in = new Instance();
    in->dir = module_dir ? module_dir : ".";
    memset(in->ring, 0, sizeof(in->ring));
    sem_init(&in->wake, 0, 0);
    init_sound(in);
    Bank builtin;
    builtin.name = "Built-in";
    Sound init;
    init.name = "Init Program";
    Single s;
    State::createDefaultSingle(s, 0);
    init.dump.assign(s.begin(), s.begin() + n2x::g_singleDumpSize);
    builtin.sounds.push_back(init);
    in->banks.push_back(builtin);
    scan_banks(in->dir + "/banks", in->banks);
    in->emu = std::thread(emu_main, in);
    return in;
}

void v2_destroy(void *instance) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in) return;
    in->quit = true;
    sem_post(&in->wake);
    if (in->emu.joinable()) in->emu.join();
    {
        std::lock_guard<std::mutex> l(in->plugMu);
        in->plugin.reset();
    }
    in->device.reset();
    sem_destroy(&in->wake);
    delete in;
}

void v2_on_midi(void *instance, const uint8_t *msg, int len, int) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || len < 2 || in->loading.load()) return;
    const uint8_t st = msg[0] & 0xf0;
    const uint8_t d1 = msg[1] & 0x7f, d2 = len > 2 ? (msg[2] & 0x7f) : 0;
    switch (st) {
    case 0x80: case 0x90: case 0xa0: case 0xd0: case 0xe0:
        break;
    case 0xb0:
        // The wheel, the pedals and the panic controllers only: every other
        // controller is a knob of the synth, and would move the sound behind
        // the parameters' back.
        if (d1 != 1 && d1 != 11 && d1 != 64 && d1 != 120 && d1 != 123) return;
        break;
    default:
        return;
    }
    synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, st, d1, d2); // channel 1: every slot that is on
    send(in, ev);
}

int shown(const Instance *in, const Param *p) {
    int raw = 0;
    switch (p->kind) {
    case kCC: case kDump:
        raw = s_get(in->single[in->slot], p->index);
        if (p->min < 0 && p->offset == 0) raw = int8_t(uint8_t(raw));
        break;
    case kBits:
        raw = (s_get(in->single[in->slot], p->index) >> p->cc) & 1;
        break;
    case kMulti:
        raw = m_get(in->multi, p->index + in->slot);
        break;
    case kGlobal:
        raw = m_get(in->multi, p->index);
        if (p->min < 0) raw = int8_t(uint8_t(raw));
        break;
    case kNibble:
        raw = m_get(in->multi, p->index) & 0x0f;
        break;
    }
    int v = raw - p->offset;
    return v < p->min ? p->min : (v > p->max ? p->max : v);
}

// A value as the host writes it: a number, or an option's name.
bool parse_value(const Param *p, const char *val, int &out) {
    if (p->opts)
        for (int i = 0; i < p->nopts; i++)
            if (!strcasecmp(p->opts[i], val)) {
                out = i + p->min;
                return true;
            }
    char *end = nullptr;
    const double d = strtod(val, &end);
    if (end == val) return false;
    int v = int(lrint(d));
    out = v < p->min ? p->min : (v > p->max ? p->max : v);
    return true;
}

// A controller would be lost, or undone: a dump is still arriving, or one
// for this slot is waiting to be sent. The change then goes out as a dump.
bool dump_pending(const Instance *in, int slot) {
    return in->multiDirty || in->singleDirty[slot] || now_us() < in->busyUntil;
}

void apply_param(Instance *in, const Param *p, int v) {
    const int s = in->slot;
    switch (p->kind) {
    case kCC: {
        const uint8_t raw = uint8_t(v + p->offset);
        if (s_get(in->single[s], p->index) == raw) return;
        s_set(in->single[s], p->index, raw);
        if (dump_pending(in, s))
            in->singleDirty[s] = true;
        else
            send_slot_cc(in, s, p->cc, raw);
        break;
    }
    case kDump: {
        const uint8_t raw = uint8_t(v + p->offset);
        if (s_get(in->single[s], p->index) == raw) return;
        s_set(in->single[s], p->index, raw);
        in->singleDirty[s] = true;
        break;
    }
    case kBits: {
        uint8_t b = s_get(in->single[s], p->index);
        const uint8_t nb = uint8_t((b & ~(1 << p->cc)) | ((v ? 1 : 0) << p->cc));
        if (nb == b) return;
        s_set(in->single[s], p->index, nb);
        if (dump_pending(in, s))
            in->singleDirty[s] = true;
        else if (p->cc == 4)
            send_slot_cc(in, s, n2x::CCDistortion, v ? 1 : 0);
        else
            send_slot_cc(in, s, n2x::CCSync, nb & 3);
        break;
    }
    case kMulti:
        if (m_get(in->multi, p->index + s) == uint8_t(v)) return;
        m_set(in->multi, p->index + s, uint8_t(v));
        in->multiDirty = true;
        break;
    case kGlobal:
        if (m_get(in->multi, p->index) == uint8_t(v)) return;
        m_set(in->multi, p->index, uint8_t(v));
        in->multiDirty = true;
        break;
    case kNibble: {
        const uint8_t old = m_get(in->multi, p->index);
        if ((old & 0x0f) == v) return;
        m_set(in->multi, p->index, uint8_t((old & 0xf0) | v));
        in->multiDirty = true;
        break;
    }
    }
}

int hexval(char c) { return c >= '0' && c <= '9' ? c - '0' : (c >= 'a' && c <= 'f' ? c - 'a' + 10 : (c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1)); }

// The value of "key" in a flat JSON object: a number, or a string's content.
bool json_field(const char *json, const char *key, std::string &out) {
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return false;
    p += strlen(pat);
    while (*p == ' ' || *p == ':') p++;
    out.clear();
    if (*p == '"') {
        for (p++; *p && *p != '"'; p++) {
            if (*p == '\\' && p[1]) p++;
            out += *p;
        }
        return true;
    }
    while (*p && *p != ',' && *p != '}' && *p != ' ') out += *p++;
    return !out.empty();
}

void set_state(Instance *in, const char *val) {
    std::string hex, s;
    if (!json_field(val, "multi", hex) || hex.size() < size_t(n2x::g_multiDumpSize) * 2) return;
    Sound snd;
    snd.multi = true;
    for (size_t i = 0; i + 1 < hex.size() && snd.dump.size() < n2x::g_multiDumpSize; i += 2) {
        const int a = hexval(hex[i]), b = hexval(hex[i + 1]);
        if (a < 0 || b < 0) return;
        snd.dump.push_back(uint8_t(a << 4 | b));
    }
    load_sound(in, snd);
    for (int i = 0; i < 4; i++) {
        char k[8];
        snprintf(k, sizeof(k), "name%d", i);
        in->slotName[i] = json_field(val, k, s) ? s : std::string();
    }
    if (json_field(val, "slot", s)) in->slot = std::max(0, std::min(3, atoi(s.c_str())));
    if (json_field(val, "gain", s)) in->gain = std::max(1, std::min(200, atoi(s.c_str())));
    if (json_field(val, "preset", s)) in->preset = std::max(0, atoi(s.c_str()));
    if (json_field(val, "bank", s)) {
        for (size_t i = 0; i < in->banks.size(); i++)
            if (in->banks[i].name == s) in->bank = int(i);
    }
    if (in->preset >= int(in->banks[size_t(in->bank)].sounds.size())) in->preset = 0;
    in->multiDirty = true;
}

void v2_set_param(void *instance, const char *key, const char *val) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !val) return;
    std::lock_guard<std::mutex> l(in->mu);
    if (!strcmp(key, "state")) {
        set_state(in, val);
    } else if (!strcmp(key, "preset")) {
        const Bank &b = in->banks[size_t(in->bank)];
        const int n = atoi(val);
        if (n < 0 || n >= int(b.sounds.size())) return;
        in->preset = n;
        load_sound(in, b.sounds[size_t(n)]);
    } else if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select")) {
        int n = -1;
        for (size_t i = 0; i < in->banks.size(); i++)
            if (in->banks[i].name == val) n = int(i);
        if (n < 0) {
            char *end = nullptr;
            n = int(strtol(val, &end, 10));
            if (end == val) return;
        }
        if (n < 0 || n >= int(in->banks.size()) || n == in->bank) return;
        in->bank = n;
        in->preset = 0; // as on the synth: a bank's first sound, so the list and the sound agree
        load_sound(in, in->banks[size_t(n)].sounds[0]);
    } else if (!strcmp(key, "slot")) {
        int n = -1;
        for (int i = 0; i < 4; i++)
            if (!strcasecmp(o_slot[i], val)) n = i;
        if (n < 0) n = atoi(val);
        if (n < 0 || n > 3 || n == in->slot) return;
        in->slot = n;
        if (!in->on[n]) in->on[n] = true; // the slot being edited is heard
        in->multiDirty = true;
    } else if (!strncmp(key, "slot_", 5) && key[5] >= 'a' && key[5] <= 'd' && !key[6]) {
        const int i = key[5] - 'a';
        const bool v = !strcasecmp(val, "on") || atoi(val) != 0;
        if (in->on[i] == v) return;
        in->on[i] = v;
        if (!in->on[0] && !in->on[1] && !in->on[2] && !in->on[3]) in->on[i] = true; // never all off
        in->multiDirty = true;
    } else if (!strcmp(key, "gain")) {
        in->gain = std::max(1, std::min(200, atoi(val)));
    } else if (!strcmp(key, "debug_midi_send")) { // hex: one message, straight to the synth
        std::vector<uint8_t> m;
        for (const char *c = val; c[0] && c[1]; c += 2) {
            if (*c == ' ') { c--; continue; }
            const int a = hexval(c[0]), b = hexval(c[1]);
            if (a < 0 || b < 0) return;
            m.push_back(uint8_t(a << 4 | b));
        }
        if (m.size() >= 2 && m[0] == 0xf0) {
            send_sysex(in, m.data(), m.size());
        } else if (m.size() >= 2) {
            synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, m[0], m[1], m.size() > 2 ? m[2] : 0);
            synthLib::MidiTranslator::createPacketSkipTranslation(ev);
            send(in, ev);
        }
    } else if (!strcmp(key, "all_notes_off")) {
        synthLib::SMidiEvent ev(synthLib::MidiEventSource::Host, 0xb0, 123, 0);
        send(in, ev);
    } else if (const Param *p = find_param(key)) {
        int v;
        if (parse_value(p, val, v)) apply_param(in, p, v);
    }
    sem_post(&in->wake);
}

#define AP(...) do { if (off < len) off += snprintf(buf + off, size_t(len - off), __VA_ARGS__); } while (0)

int build_chain_params(Instance *in, char *buf, int len) {
    int off = 0;
    AP("[{\"key\":\"preset\",\"name\":\"Sound\",\"type\":\"int\",\"min\":0,\"max\":%d},",
       std::max(0, int(in->banks[size_t(in->bank)].sounds.size()) - 1));
    AP("{\"key\":\"slot\",\"name\":\"Edit Slot\",\"type\":\"enum\",\"selector\":true,\"options\":[\"A\",\"B\",\"C\",\"D\"]}");
    for (int i = 0; i < 4; i++)
        AP(",{\"key\":\"slot_%c\",\"name\":\"Slot %c\",\"type\":\"enum\",\"options\":[\"Off\",\"On\"]}", 'a' + i, 'A' + i);
    AP(",{\"key\":\"gain\",\"name\":\"Output Gain\",\"type\":\"int\",\"min\":1,\"max\":200,\"unit\":\"%%\"}");
    for (int i = 0; i < NPARAMS; i++) {
        const Param &p = g_params[i];
        if (p.opts) {
            AP(",{\"key\":\"%s\",\"name\":\"%s\",\"type\":\"enum\",\"options\":[", p.key, p.name);
            const int n = std::min(p.nopts, p.max - p.min + 1);
            for (int j = 0; j < n; j++) AP("%s\"%s\"", j ? "," : "", p.opts[j]);
            AP("]}");
        } else {
            AP(",{\"key\":\"%s\",\"name\":\"%s\",\"type\":\"int\",\"min\":%d,\"max\":%d}", p.key, p.name, p.min, p.max);
        }
    }
    AP("]");
    return off < len ? off : -1;
}

int build_hierarchy(char *buf, int len) {
    static const struct { const char *id, *label, *knobs; } levels[] = {
        {"osc", "Oscillators", "\"osc1_wave\",\"osc2_wave\",\"osc2_semi\",\"osc2_fine\",\"mix\",\"fm\",\"pw\",\"sync\""},
        {"filter", "Filter", "\"cutoff\",\"resonance\",\"filter_env\",\"filter_type\",\"flt_attack\",\"flt_decay\",\"flt_sustain\",\"flt_release\""},
        {"amp", "Amplifier", "\"amp_attack\",\"amp_decay\",\"amp_sustain\",\"amp_release\",\"amp_gain\""},
        {"mod", "Modulation", "\"lfo1_rate\",\"lfo1_amount\",\"lfo1_wave\",\"lfo1_dest\",\"lfo2_rate\",\"lfo2_amount\",\"lfo2_dest\",\"modenv_amount\""},
        {"voice", "Voice", "\"voice_mode\",\"unison\",\"portamento\",\"porta_auto\",\"octave\",\"modwheel_dest\",\"pressure_amount\",\"pedal_amount\""},
        {"morph", "Morph", "\"morph_cutoff\",\"morph_resonance\",\"morph_filter_env\",\"morph_mix\",\"morph_fm\",\"morph_pw\",\"morph_lfo1_amount\",\"morph_gain\""},
        {"global", "Synth", "\"bend_range\",\"unison_detune\",\"master_tune\",\"out_mode\",\"gain\""},
    };
    int off = 0;
    AP("{\"modes\":null,\"levels\":{\"root\":{\"list_param\":\"preset\",\"count_param\":\"preset_count\","
       "\"name_param\":\"preset_name\",\"children\":null,"
       "\"knobs\":[\"cutoff\",\"resonance\",\"filter_env\",\"mix\",\"amp_attack\",\"amp_release\",\"lfo1_amount\",\"slot\"],"
       "\"params\":[{\"level\":\"banks\",\"label\":\"Bank\"},{\"key\":\"slot\",\"label\":\"Edit Slot\"},"
       "{\"key\":\"slot_a\",\"label\":\"Slot A\"},{\"key\":\"slot_b\",\"label\":\"Slot B\"},"
       "{\"key\":\"slot_c\",\"label\":\"Slot C\"},{\"key\":\"slot_d\",\"label\":\"Slot D\"}");
    for (auto &lv : levels) AP(",{\"level\":\"%s\",\"label\":\"%s\"}", lv.id, lv.label);
    AP("]}");
    // the bank chooser: a row per bank file, picking one returns to the list
    AP(",\"banks\":{\"label\":\"Bank\",\"items_param\":\"bank_list\",\"select_param\":\"bank_select\","
       "\"navigate_to\":\"root\",\"children\":null,\"knobs\":[],\"params\":[]}");
    for (auto &lv : levels) {
        AP(",\"%s\":{\"label\":\"%s\",\"children\":null,\"knobs\":[%s],\"params\":[", lv.id, lv.label, lv.knobs);
        bool first = true;
        for (int i = 0; i < NPARAMS; i++) {
            if (strcmp(g_params[i].level, lv.id)) continue;
            AP("%s{\"key\":\"%s\",\"label\":\"%s\"}", first ? "" : ",", g_params[i].key, g_params[i].name);
            first = false;
        }
        if (!strcmp(lv.id, "global")) AP(",{\"key\":\"gain\",\"label\":\"Output Gain\"}");
        AP("]}");
    }
    AP("}}");
    return off < len ? off : -1;
}

int v2_get_param(void *instance, const char *key, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !buf || len < 2) return -1;
    if (!strcmp(key, "is_loading")) return snprintf(buf, size_t(len), "%d", in->loading.load() ? 1 : 0);
    if (!strcmp(key, "name")) return snprintf(buf, size_t(len), "Nodal Red 2X");
    if (!strcmp(key, "ui_hierarchy")) return build_hierarchy(buf, len);
    if (!strcmp(key, "debug_info"))
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u", in->underruns.load(), in->blockUs.load(),
                        in->blockMaxUs.exchange(0), in->wr.load() - in->rd.load());
    if (!strcmp(key, "debug_midi_out")) { // what the synth sent since the last read: count, sizes, the first bytes of each
        std::lock_guard<std::mutex> l(in->outMu);
        int off = 0;
        AP("%d:", int(in->midiOut.size()));
        for (auto &m : in->midiOut) {
            AP(" [%d]", int(m.size()));
            for (size_t i = 0; i < m.size() && i < 12; i++) AP("%02x", m[i]);
        }
        in->midiOut.clear();
        return off < len ? off : -1;
    }
    std::lock_guard<std::mutex> l(in->mu);
    const Bank &b = in->banks[size_t(in->bank)];
    if (!strcmp(key, "loading_status")) return snprintf(buf, size_t(len), "%s", in->status);
    if (!strcmp(key, "load_error")) return snprintf(buf, size_t(len), "%s", in->error);
    if (!strcmp(key, "rom_name")) return snprintf(buf, size_t(len), "%s", in->romName.c_str());
    if (!strcmp(key, "chain_params")) return build_chain_params(in, buf, len);
    if (!strcmp(key, "preset")) return snprintf(buf, size_t(len), "%d", in->preset);
    if (!strcmp(key, "preset_count")) return snprintf(buf, size_t(len), "%d", int(b.sounds.size()));
    if (!strcmp(key, "preset_name"))
        return snprintf(buf, size_t(len), "%s", in->preset < int(b.sounds.size()) ? b.sounds[size_t(in->preset)].name.c_str() : "");
    if (!strcmp(key, "bank_index") || !strcmp(key, "bank_select")) return snprintf(buf, size_t(len), "%d", in->bank);
    if (!strcmp(key, "bank_list")) {
        int off = 0;
        AP("[");
        for (size_t i = 0; i < in->banks.size(); i++) AP("%s\"%s\"", i ? "," : "", in->banks[i].name.c_str());
        AP("]");
        return off < len ? off : -1;
    }
    // every name of the bank at once, and any one of them: SOUNDS shows a
    // bank's names without loading its sounds
    if (!strcmp(key, "preset_names")) {
        int off = 0;
        AP("[");
        for (size_t i = 0; i < b.sounds.size(); i++) AP("%s\"%s\"", i ? "," : "", b.sounds[i].name.c_str());
        AP("]");
        return off < len ? off : -1;
    }
    if (!strncmp(key, "preset_name_", 12)) {
        const int i = atoi(key + 12);
        return snprintf(buf, size_t(len), "%s", i >= 0 && i < int(b.sounds.size()) ? b.sounds[size_t(i)].name.c_str() : "");
    }
    if (!strcmp(key, "bank_count")) return snprintf(buf, size_t(len), "%d", int(in->banks.size()));
    if (!strcmp(key, "bank_name")) return snprintf(buf, size_t(len), "%s", b.name.c_str());
    if (!strcmp(key, "slot")) return snprintf(buf, size_t(len), "%d", in->slot);
    if (!strncmp(key, "slot_", 5) && key[5] >= 'a' && key[5] <= 'd' && !key[6])
        return snprintf(buf, size_t(len), "%d", in->on[key[5] - 'a'] ? 1 : 0);
    if (!strcmp(key, "gain")) return snprintf(buf, size_t(len), "%d", in->gain);
    // the four slots at a glance, for a screen: on, edited, osc 1, osc 2,
    // cutoff, resonance, filter type, mix, voice mode, unison, name
    if (!strcmp(key, "slots_info")) {
        int off = 0;
        for (int i = 0; i < 4; i++) {
            const Single &sg = in->single[i];
            std::string nm = in->slotName[i];
            for (auto &c : nm)
                if (c == ';' || c == '"' || c == '\\') c = ' ';
            AP("%s%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%s", i ? ";" : "", in->on[i] ? 1 : 0, in->slot == i ? 1 : 0, s_get(sg, n2x::O1Waveform) & 3,
               s_get(sg, n2x::O2Waveform) & 3, s_get(sg, n2x::Cutoff), s_get(sg, n2x::Resonance), std::min<int>(4, s_get(sg, n2x::FilterType)),
               s_get(sg, n2x::Mix), std::min<int>(2, s_get(sg, n2x::VoiceMode)), s_get(sg, n2x::Unison) ? 1 : 0, nm.c_str());
        }
        return off < len ? off : -1;
    }
    if (!strcmp(key, "state")) {
        Multi m;
        compose_multi(in, m);
        int off = 0;
        AP("{\"v\":1,\"slot\":%d,\"gain\":%d,\"bank\":\"%s\",\"preset\":%d,", in->slot, in->gain, b.name.c_str(), in->preset);
        for (int i = 0; i < 4; i++) AP("\"name%d\":\"%s\",", i, in->slotName[i].c_str());
        AP("\"multi\":\"");
        for (uint32_t i = 0; i < n2x::g_multiDumpSize && off < len - 4; i++) AP("%02x", i == n2x::g_multiDumpSize - 1 ? 0xf7 : m[i]);
        AP("\"}");
        return off < len ? off : -1;
    }
    if (const Param *p = find_param(key)) return snprintf(buf, size_t(len), "%d", shown(in, p));
    return -1;
}

int v2_get_error(void *instance, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !buf || len < 1) return 0;
    std::lock_guard<std::mutex> l(in->mu);
    if (!in->error[0]) return 0;
    return snprintf(buf, size_t(len), "%s", in->error);
}

void v2_render(void *instance, int16_t *out, int frames) {
    Instance *in = static_cast<Instance *>(instance);
    if (!out || frames <= 0) return;
    if (!in || in->loading.load(std::memory_order_relaxed)) {
        memset(out, 0, size_t(frames) * 2 * sizeof(int16_t));
        return;
    }
    const uint32_t r = in->rd.load(std::memory_order_relaxed);
    const uint32_t have = in->wr.load(std::memory_order_acquire) - r;
    const uint32_t n = std::min<uint32_t>(have, uint32_t(frames));
    for (uint32_t i = 0; i < n; i++) {
        const uint32_t k = (r + i) & (RING - 1);
        out[i * 2] = in->ring[k * 2];
        out[i * 2 + 1] = in->ring[k * 2 + 1];
    }
    if (n < uint32_t(frames)) {
        memset(out + n * 2, 0, size_t(uint32_t(frames) - n) * 2 * sizeof(int16_t));
        if (!in->error[0]) in->underruns.fetch_add(1, std::memory_order_relaxed);
    }
    in->rd.store(r + n, std::memory_order_release);
    sem_post(&in->wake);
}

plugin_api_v2_t g_api;

} // namespace

extern "C" __attribute__((visibility("default"))) plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    // the emulator logs every hardware register it touches: not into the host's log
    Logging::setLogFunc([](const std::string &) {});
    memset(&g_api, 0, sizeof(g_api));
    g_api.api_version = 2;
    g_api.create_instance = v2_create;
    g_api.destroy_instance = v2_destroy;
    g_api.on_midi = v2_on_midi;
    g_api.set_param = v2_set_param;
    g_api.get_param = v2_get_param;
    g_api.get_error = v2_get_error;
    g_api.render_block = v2_render;
    return &g_api;
}
