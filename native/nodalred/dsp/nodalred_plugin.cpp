// Nodal Red 2X for Pung: the Clavia Nord Lead 2X as gearmulator emulates it
// (n2xLib), behind the chain host's plugin API.
//
// Processes. The emulator runs in a process of its own, nodalred-engine
// (nodalred_engine.cpp), and renders into a ring in memory both share
// (emu_shm.h, emu_host.h); render_block only reads the ring. A hung or
// crashed emulator then never holds Pung: a stop kills the engine, and an
// engine that dies is started again. This plugin keeps the sound and talks
// to the engine through two queues (MIDI and dumps to it, what the synth
// sends back from it), on a thread of its own ("nodalred-run").
//
// State. Everything the device is told goes through this file, so the sound
// is kept here as the synth's own dumps (one multi, four singles) and never
// read back from the emulator.
//
// Slots. The Nord has one panel and four slots: `slot` picks the slot the
// parameters edit, among the slots that are on; slot_a..slot_d switch slots
// into the layer. Notes play every slot that is on.

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
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <sys/stat.h>
#include <time.h>

#include "dsp56kBase/logging.h"
#include "n2xLib/n2xmiditypes.h"
#include "n2xLib/n2xrom.h"
#include "n2xLib/n2xstate.h"
#include "n2xLib/n2xtypes.h"
#include "synthLib/deviceException.h"
#include "synthLib/midiTranslator.h"
#include "synthLib/midiTypes.h"

#include "emu_host.h"
#include "nodalred_live.h"

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

const int RING = eshm::RING; // stereo frames, a power of two (the engine renders: nodalred_engine.cpp)
// A new sound goes into the synth as a dump, and the emulator stalls while
// it takes one (a dropout of a few ms on every sound change). Before such a
// dump it renders this far ahead, and stays that deep for a moment, as
// OsTIrus does. Only for a sound change: a knob whose parameter only a dump
// carries must not get the longer latency.
const int AHEAD_DUMP = 1280; // 29 ms
// An engine that dies is started again, this many times a minute at most
const int RESTARTS = 3;
// A block that ends short fades out over its last frames, and the one after
// it fades in: the gap is a dip, not a click.
const uint32_t FADE = 32;

struct Instance {
    std::string dir;

    // the engine: its process and the memory shared with it, started and
    // watched by the run thread, which also does what the sound needs of it
    // (dumps at the synth's pace, the firmware's sounds read once)
    eshm::Host host;
    std::thread run;
    sem_t runWake; // a parameter changed: the run thread sends what it has to
    std::atomic<bool> quit{false};
    // One emulator on the machine at a time. Its three threads run at
    // realtime priority and take a core and a half; two of them took all four
    // logical cores of a Push and it stood still until it was switched off
    // (2026-11-18: Live's recovery had brought back a Set with two of these).
    // An instance that finds the emulator taken waits for it, silent, and
    // says so; it starts when the other is gone. The lock is the system's (a
    // record lock, emu_try_lock), so it also holds between Pung and the
    // processes that probe a module, and is gone with whoever held it.
    std::atomic<int> waiting{0};
    bool hasLock = false; // holds the one-at-a-time lock (emu_try_lock)
    std::atomic<uint32_t> underruns{0};
    bool hole = false; // render_block's: the block before ended short

    // the sound, under mu
    std::mutex mu;
    Multi multi;
    Single single[4];
    bool on[4] = {true, false, false, false};
    int slot = 0;
    int gain = 100; // percent
    bool singleDirty[4] = {false, false, false, false};
    bool multiDirty = false;
    std::atomic<uint64_t> held[2] = {{0}, {0}}; // keys down now, a bit a note (release_held)
    std::atomic<int64_t> lastOff{0};              // the last key let go (live_mod: the sound still sounds)
    int64_t busyUntil = 0; // a dump is on its way into the synth until then
    std::atomic<bool> soundDump{false}; // the next dump is a sound change: deep first (AHEAD_DUMP)
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

// An event to the engine (it plays what comes while it runs; the sound
// goes again as a dump when it starts).
void send(Instance *in, synthLib::SMidiEvent &ev) {
    if (!ev.sysex.empty()) {
        in->host.send(eshm::EVENT, ev.sysex.data(), ev.sysex.size());
    } else {
        const uint8_t b[3] = {ev.a, ev.b, ev.c};
        in->host.send(eshm::EVENT, b, 3);
    }
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
    in->soundDump = true; // the run thread sends it with the ring deep (AHEAD_DUMP)
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

#define EMU_LOCK_PATH "/dev/shm/pung-nodalred.lock"
#define EMU_LOCK_PATH_TMP "/tmp/pung-nodalred.lock"

// The one-at-a-time lock. A POSIX record lock, not flock: a process the host
// forks without exec (the JE-8086 module forks its emulator) inherits an
// flock with the open file and holds it as long as it lives, so after a
// restart that loaded this module first a second instance waited forever
// (2026-11-22). A record lock belongs to the process and is not inherited;
// between the instances of one process the flag decides, and the file stays
// open once (closing any descriptor of it drops the process's record locks).
// Between Pung and a probing process the file lock still holds.
static std::mutex g_emuLockMu;
static int g_emuLockFd = -1;
static bool g_emuLockHeld = false;

static bool emu_try_lock() {
    std::lock_guard<std::mutex> l(g_emuLockMu);
    if (g_emuLockHeld) return false;
    if (g_emuLockFd < 0) g_emuLockFd = open(EMU_LOCK_PATH, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (g_emuLockFd < 0) g_emuLockFd = open(EMU_LOCK_PATH_TMP, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (g_emuLockFd >= 0) {
        struct flock fl {};
        fl.l_type = F_WRLCK;
        fl.l_whence = SEEK_SET;
        if (fcntl(g_emuLockFd, F_SETLK, &fl) != 0) return false;
    }
    g_emuLockHeld = true; // (no lock file at all: run, as before)
    return true;
}

static void emu_unlock() {
    std::lock_guard<std::mutex> l(g_emuLockMu);
    if (!g_emuLockHeld) return;
    if (g_emuLockFd >= 0) {
        struct flock fl {};
        fl.l_type = F_UNLCK;
        fl.l_whence = SEEK_SET;
        fcntl(g_emuLockFd, F_SETLK, &fl);
    }
    g_emuLockHeld = false;
}

// What the engine sent: an answer to a firmware dump request (rr), or kept
// for debug_midi_out.
void take_answers(Instance *in, RomRead &rr) {
    std::vector<uint8_t> e;
    uint8_t kind;
    while (eshm::take(in->host.L->fromEngine, kind, e)) {
        if (rr.active && rr.waiting && rr.at < rr.todo.size()) {
            const auto &a = rr.todo[rr.at];
            if (e.size() == a.wantSize && e[n2x::IdxMsgType] == a.wantType && e[n2x::IdxMsgSpec] == a.spec) {
                auto &f = rr.files[size_t(a.file)];
                f.insert(f.end(), e.begin(), e.end());
                rr.got++;
                rr.waiting = false;
                rr.at++;
                continue;
            }
        }
        std::lock_guard<std::mutex> l(in->outMu);
        if (in->midiOut.size() < 2048) in->midiOut.push_back(e);
    }
}

// The firmware's sounds, asked for one at a time while the synth plays.
void rom_read_step(Instance *in, RomRead &rr) {
    if (!rr.active) return;
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

void run_main(Instance *in) {
    pthread_setname_np(pthread_self(), "nodalred-run");
    std::vector<uint8_t> rom;
    std::string romName;
    if (!find_rom(in->dir + "/roms", rom, romName)) {
        std::lock_guard<std::mutex> l(in->mu);
        snprintf(in->error, sizeof(in->error),
                 "No ROM: put a Nord Lead 2X firmware (.bin, 524,288 bytes) into the module's roms folder");
        snprintf(in->status, sizeof(in->status), "ROM missing");
        return;
    }
    while (!in->hasLock && !(in->hasLock = emu_try_lock())) {
        if (!in->waiting.exchange(1)) plog("another instance has the emulator; waiting for it");
        if (in->quit.load()) return;
        usleep(300000);
    }
    in->waiting = 0;
    if (in->quit.load()) return;
    {
        std::lock_guard<std::mutex> l(in->mu);
        in->romName = romName;
    }
    const std::string exe = in->dir + "/nodalred-engine", romPath = in->dir + "/roms/" + romName;
    auto spawn = [&]() -> bool {
        int gain;
        {
            std::lock_guard<std::mutex> l(in->mu);
            gain = in->gain;
        }
        const int err = in->host.spawn(exe, romPath, 0, gain);
        if (err) {
            std::lock_guard<std::mutex> l(in->mu);
            snprintf(in->error, sizeof(in->error), "The emulator could not be started (%s: %s)", exe.c_str(), strerror(err));
            snprintf(in->status, sizeof(in->status), "Failed");
            return false;
        }
        plog("engine started (pid %d)", int(in->host.pid.load()));
        return true;
    };
    if (!spawn()) return;
    std::vector<int64_t> deaths;
    bool up = false; // the engine running, and given the sound
    RomRead rr;
    mkdir((in->dir + "/banks").c_str(), 0755);
    eshm::Layout *L = in->host.L;
    while (!in->quit.load()) {
        char why[64];
        if (in->host.died(why, sizeof(why))) {
            up = false;
            if (in->quit.load()) break;
            if (L->phase.load() == eshm::FAILED) break; // it said why: no use starting it again
            const int64_t t = now_us();
            deaths.erase(std::remove_if(deaths.begin(), deaths.end(), [&](int64_t d) { return t - d > 60000000; }), deaths.end());
            deaths.push_back(t);
            if (int(deaths.size()) > RESTARTS) {
                plog("the engine stopped (%s), %d times in a minute: not starting it again", why, int(deaths.size()));
                std::lock_guard<std::mutex> l(in->mu);
                snprintf(in->error, sizeof(in->error), "The emulator stopped %d times in a minute (%s)", int(deaths.size()), why);
                snprintf(in->status, sizeof(in->status), "Failed");
                break;
            }
            plog("the engine stopped (%s): starting it again", why);
            rr = RomRead();
            if (!spawn()) break;
        }
        if (!up && in->host.playing()) {
            // the engine is up: the master volume, and the sound as it is by
            // now (the default, a state set while it booted, the sound before
            // an engine that died)
            up = true;
            std::lock_guard<std::mutex> l(in->mu);
            const auto knob = State::createKnobSysex(n2x::KnobType::MasterVol, 0xff);
            send_sysex(in, knob.data(), knob.size());
            in->multiDirty = true;
            flush_dumps(in, true);
            snprintf(in->status, sizeof(in->status), "Ready");
            plog("running, ROM %s", romName.c_str());
            if (!has_rom_banks(in->dir + "/banks")) rom_read_plan(rr);
        }
        if (up) {
            take_answers(in, rr);
            // a sound change waits until the ring is deep enough to ride out the dump
            const uint32_t fill = L->wr.load(std::memory_order_relaxed) - L->rd.load(std::memory_order_acquire);
            L->wantDeep = in->soundDump.load() ? 1 : 0;
            if ((!in->soundDump.load() || fill >= uint32_t(AHEAD_DUMP)) && in->mu.try_lock()) {
                if (in->soundDump.exchange(false)) {
                    L->deepUntil = now_us() + 2500000;
                    L->wantDeep = 0;
                }
                flush_dumps(in, false);
                in->mu.unlock();
            }
            rom_read_step(in, rr);
        }
        timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 2000000;
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec++;
            ts.tv_nsec -= 1000000000;
        }
        sem_timedwait(&in->runWake, &ts);
    }
}

// status and error: the waiting, the plugin's own (a missing ROM, the
// firmware's sounds being read), else the engine's while it boots or failed
void texts(Instance *in, char *st, size_t ns, char *err, size_t ne) {
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (in->waiting.load()) {
            snprintf(st, ns, "Waiting: another Nodal Red 2X is running, and one is all a Push can run");
            snprintf(err, ne, "%s", "");
            return;
        }
        const int ph = in->host.L ? int(in->host.L->phase.load()) : int(eshm::FAILED);
        if (in->error[0] || !in->host.L || ph == eshm::RUNNING || (ph == eshm::STARTING && !in->host.pid.load())) {
            snprintf(st, ns, "%s", in->status);
            snprintf(err, ne, "%s", in->error);
            return;
        }
    }
    eshm::get_text(in->host.L, st, ns, err, ne);
}

// still coming up: the module answers, but plays nothing yet
bool starting(Instance *in) {
    if (in->waiting.load() || !in->host.L) return false;
    {
        std::lock_guard<std::mutex> l(in->mu);
        if (in->error[0]) return false;
    }
    const int ph = in->host.L->phase.load();
    return ph != eshm::RUNNING && ph != eshm::FAILED;
}

// ---- the plugin API -------------------------------------------------------------

void *v2_create(const char *module_dir, const char *) {
    Instance *in = new Instance();
    in->dir = module_dir ? module_dir : ".";
    sem_init(&in->runWake, 0, 0);
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
    if (!in->host.make("pung-nodalred")) {
        snprintf(in->error, sizeof(in->error), "No memory for the emulator (%s)", strerror(errno));
        snprintf(in->status, sizeof(in->status), "Failed");
        return in;
    }
    in->run = std::thread(run_main, in);
    return in;
}

void v2_destroy(void *instance) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in) return;
    in->quit = true;
    sem_post(&in->runWake);
    if (in->run.joinable()) in->run.join(); // (it waits 2 ms at a time)
    if (in->host.end()) plog("engine stopped");
    if (in->hasLock) emu_unlock(); // the emulator is gone: the next instance may start
    in->host.free();
    sem_destroy(&in->runWake);
    delete in;
}

// A slot is about to leave the layer: let go of what it plays first. A slot
// that is off listens on no channel, so the key's own note-off would never
// reach it, and the note played on for ever. Sent before the multi that
// switches the slot off (flush_dumps waits for the synth; this does not).
void release_held(Instance *in) {
    synthLib::SMidiEvent pedal(synthLib::MidiEventSource::Host, 0xb0, 64, 0);
    send(in, pedal);
    for (int w = 0; w < 2; w++) {
        uint64_t bits = in->held[w].load();
        for (int b = 0; b < 64; b++)
            if (bits & (uint64_t(1) << b)) {
                synthLib::SMidiEvent off(synthLib::MidiEventSource::Host, 0x80, uint8_t(w * 64 + b), 0);
                send(in, off);
            }
    }
}

void v2_on_midi(void *instance, const uint8_t *msg, int len, int) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || len < 2 || !in->host.playing()) return;
    const uint8_t st = msg[0] & 0xf0;
    const uint8_t d1 = msg[1] & 0x7f, d2 = len > 2 ? (msg[2] & 0x7f) : 0;
    switch (st) {
    case 0x90: case 0x80: {
        const uint64_t bit = uint64_t(1) << (d1 & 63);
        if (st == 0x90 && d2 > 0) in->held[d1 >> 6].fetch_or(bit);
        else in->held[d1 >> 6].fetch_and(~bit), in->lastOff = now_us();
        break;
    }
    case 0xa0: case 0xd0: case 0xe0:
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

void mod_set(Instance *in, const char *val); // (below: ASSIGN's routes)

void v2_set_param(void *instance, const char *key, const char *val) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !val) return;
    if (!strcmp(key, "rest_after_ms")) { // Pung's (docs/GOVERNOR.md), not the sound's: in no state
        in->host.restAfterMs.store(std::max(0, atoi(val)), std::memory_order_relaxed);
        if (atoi(val) <= 0) in->host.wake();
        return;
    }
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
        // The panel moves among the slots that play, and no further: a sound
        // with one slot has one slot to edit. A slot that is off is passed
        // over in the direction turned (a knob goes by one step at a time);
        // slot_a..slot_d are what switch a slot in.
        const int dir = n > in->slot ? 1 : -1;
        while (n >= 0 && n <= 3 && !in->on[n]) n += dir;
        if (n < 0 || n > 3 || n == in->slot) return;
        in->slot = n;
        in->multiDirty = true;
    } else if (!strncmp(key, "slot_", 5) && key[5] >= 'a' && key[5] <= 'd' && !key[6]) {
        const int i = key[5] - 'a';
        const bool v = !strcasecmp(val, "on") || atoi(val) != 0;
        if (in->on[i] == v) return;
        if (!v) release_held(in);
        in->on[i] = v;
        if (!in->on[0] && !in->on[1] && !in->on[2] && !in->on[3]) in->on[i] = true; // never all off
        if (!in->on[in->slot]) // the panel never edits a slot that is silent
            for (int k = 0; k < 4; k++)
                if (in->on[k]) { in->slot = k; break; }
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
    } else if (!strcmp(key, "mod_set")) {
        mod_set(in, val); // a route from Pung's ASSIGN screen
    } else if (const Param *p = find_param(key)) {
        int v;
        if (parse_value(p, val, v)) apply_param(in, p, v);
    }
    sem_post(&in->runWake);
}

#define AP(...) do { if (off < len) off += snprintf(buf + off, size_t(len - off), __VA_ARGS__); } while (0)

// ---- the Nord's modulation, for Pung's ASSIGN screen (src/assign.go) ------------
// Fixed routes, each source with one destination of its own list and an
// amount (the edited slot's): LFO 1 to the pulse width, the filter, osc 2's
// pitch, both oscillators' pitch or FM; LFO 2 to the amplifier, both
// oscillators' pitch or the filter; the mod envelope to osc 2's pitch, FM or
// the pulse width. A route to another destination moves the source there
// (the Nord drives one at a time); amount 0 removes it. Both oscillators'
// pitch has no knob of its own: "pitch", by its name.
struct NordSource {
    const char *id, *name, *dest, *amount; // the source's destination and amount parameters
    int ndest;
    const char *knob[5]; // destination option -> knob ("": no knob of its own)
    int optOf[5];        // ... and the option's value
    bool bipolar;        // the amount goes both ways (the mod envelope's)
};
const NordSource kNordSources[] = {
    {"lfo1", "LFO 1", "lfo1_dest", "lfo1_amount", 5, {"pw", "cutoff", "osc2_semi", "pitch", "fm"}, {0, 1, 2, 3, 4}, false},
    {"lfo2", "LFO 2", "lfo2_dest", "lfo2_amount", 3, {"amp_gain", "pitch", "cutoff"}, {3, 4, 7}, false},
    {"modenv", "Mod Env", "modenv_dest", "modenv_amount", 3, {"osc2_semi", "fm", "pw"}, {0, 1, 2}, true},
};

// mu held: the modulation map (get_param("mod_map")): each source with the
// knobs it can reach
int mod_map(Instance *in, char *buf, int len) {
    int off = 0;
    AP("{\"sources\":[");
    for (size_t i = 0; i < 3; i++) {
        const NordSource &n = kNordSources[i];
        AP("%s{\"id\":\"%s\",\"name\":\"%s\",\"dests\":[", i ? "," : "", n.id, n.name);
        for (int d = 0; d < n.ndest; d++) AP("%s\"%s\"", d ? "," : "", n.knob[d]);
        AP("]}");
    }
    AP("],\"dests\":[\"pitch\",\"pw\",\"cutoff\",\"osc2_semi\",\"fm\",\"amp_gain\"],\"names\":{\"pitch\":\"Pitch\"},\"routes\":[");
    bool first = true;
    for (const NordSource &n : kNordSources) {
        const Param *pd = find_param(n.dest), *pa = find_param(n.amount);
        if (!pd || !pa) continue;
        const int d = shown(in, pd), a = shown(in, pa);
        for (int k = 0; k < n.ndest; k++)
            if (n.optOf[k] == d && a != 0) {
                const double amt = n.bipolar ? a / 64.0 : a / 127.0;
                AP("%s{\"src\":\"%s\",\"dst\":\"%s\",\"amount\":%.4f}", first ? "" : ",", n.id, n.knob[k], amt);
                first = false;
            }
    }
    AP("]}");
    return off;
}

// mu held: a route from the ASSIGN screen (set_param("mod_set"))
void mod_set(Instance *in, const char *val) {
    const std::string v(val);
    auto str = [&](const char *k) {
        const std::string pat = std::string("\"") + k + "\":\"";
        const size_t p = v.find(pat);
        if (p == std::string::npos) return std::string();
        const size_t e = v.find('"', p + pat.size());
        return v.substr(p + pat.size(), e == std::string::npos ? std::string::npos : e - p - pat.size());
    };
    const std::string sid = str("src"), dst = str("dst");
    const size_t ap = v.find("\"amount\":");
    const double a = ap == std::string::npos ? 0 : atof(v.c_str() + ap + 9);
    for (const NordSource &n : kNordSources) {
        if (sid != n.id) continue;
        const Param *pd = find_param(n.dest), *pa = find_param(n.amount);
        if (!pd || !pa) return;
        for (int k = 0; k < n.ndest; k++) {
            if (dst != n.knob[k]) continue;
            const int amt = n.bipolar ? int(std::lround(std::max(-1.0, std::min(1.0, a)) * 64))
                                      : int(std::lround(std::max(0.0, std::min(1.0, a)) * 127));
            if (amt == 0) { // removed: only if it is this route (another destination keeps its amount)
                if (shown(in, pd) == n.optOf[k]) apply_param(in, pa, 0);
                return;
            }
            if (shown(in, pd) != n.optOf[k]) apply_param(in, pd, n.optOf[k]); // the source moves here
            apply_param(in, pa, std::max(pa->min, std::min(pa->max, amt)));
            return;
        }
    }
}

int build_chain_params(Instance *in, char *buf, int len) {
    int off = 0;
    // 0 to 99 always: the list is read once, when the module is probed with
    // its one built-in sound, and a range of 0 to 0 made the knob read-only
    AP("[{\"key\":\"preset\",\"name\":\"Sound\",\"type\":\"int\",\"min\":0,\"max\":99},");
    AP("{\"key\":\"slot\",\"name\":\"Edit Slot\",\"type\":\"enum\",\"selector\":true,\"available_param\":\"slot_available\",\"options\":[\"A\",\"B\",\"C\",\"D\"]}");
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

// Where the sound has the cutoff now (the newest voice's, from the DSPs:
// nodalred_engine.cpp publish_live), in the knob's units, while it sounds (a
// key held, or let go less than 3 s ago); {} at rest. Lock-free: Pung asks
// every frame.
int live_mod(Instance *in, char *buf, int len) {
    eshm::Layout *L = in->host.L;
    const int64_t now = now_us();
    const bool sounding = in->held[0].load() || in->held[1].load() || now - in->lastOff.load() < 3000000;
    if (!L || !sounding || L->aux[n2live::VOICE].load() < 0 ||
        int32_t(uint32_t(now / 1000) - uint32_t(L->aux[n2live::AT].load(std::memory_order_acquire))) > 500)
        return snprintf(buf, size_t(len), "{}");
    const double w = double(uint32_t(L->aux[n2live::CUT].load()) & 0xffffff);
    const double k = std::max(0.0, std::min(127.0, 12.0 * std::log2(std::max(w, 1.0) / n2live::CUT0)));
    return snprintf(buf, size_t(len), "{\"cutoff\":%.2f}", k);
}

int v2_get_param(void *instance, const char *key, char *buf, int len) {
    Instance *in = static_cast<Instance *>(instance);
    if (!in || !key || !buf || len < 2) return -1;
    if (!strcmp(key, "live_mod")) return live_mod(in, buf, len);
    // waiting for the emulator is not loading: the module answers, it is only silent
    if (!strcmp(key, "is_loading")) return snprintf(buf, size_t(len), "%d", starting(in) ? 1 : 0);
    if (!strcmp(key, "name")) return snprintf(buf, size_t(len), "Nodal Red 2X");
    if (!strcmp(key, "ui_hierarchy")) return build_hierarchy(buf, len);
    if (!strcmp(key, "rest_after_ms")) return snprintf(buf, size_t(len), "%d", in->host.restAfterMs.load());
    if (!strcmp(key, "resting")) return snprintf(buf, size_t(len), "%d", int(in->host.resting()));
    if (!strcmp(key, "debug_info")) {
        eshm::Layout *L = in->host.L;
        if (!L) return snprintf(buf, size_t(len), "underruns=%u", in->underruns.load());
        return snprintf(buf, size_t(len), "underruns=%u block_us=%u block_max_us=%u fill=%u engine_pid=%d resting=%d rests=%u rest_after_ms=%d",
                        in->underruns.load(), L->blockUs.load(), L->blockMaxUs.exchange(0), L->wr.load() - L->rd.load(),
                        int(in->host.pid.load()), int(in->host.resting()), in->host.rests.load(), in->host.restAfterMs.load());
    }
    if (!strcmp(key, "loading_status") || !strcmp(key, "load_error")) {
        char st[160], err[200];
        texts(in, st, sizeof(st), err, sizeof(err));
        return snprintf(buf, size_t(len), "%s", !strcmp(key, "loading_status") ? st : err);
    }
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
    if (!strcmp(key, "slot_available")) // which slots the panel can go to: the ones that are on
        return snprintf(buf, size_t(len), "%d%d%d%d", in->on[0] ? 1 : 0, in->on[1] ? 1 : 0, in->on[2] ? 1 : 0, in->on[3] ? 1 : 0);
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
    if (!strcmp(key, "mod_map")) return mod_map(in, buf, len);
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
    if (!in || !in->host.playing()) {
        memset(out, 0, size_t(frames) * 2 * sizeof(int16_t));
        return;
    }
    eshm::Layout *L = in->host.L;
    if (in->host.resting()) { // at rest (emu_host.h): silence, the ring kept as it is
        memset(out, 0, size_t(frames) * 2 * sizeof(int16_t));
        return;
    }
    const uint32_t r = L->rd.load(std::memory_order_relaxed);
    const uint32_t have = L->wr.load(std::memory_order_acquire) - r;
    const uint32_t n = std::min<uint32_t>(have, uint32_t(frames));
    int loud = 0;
    for (uint32_t i = 0; i < n; i++) {
        const uint32_t k = (r + i) & (RING - 1);
        out[i * 2] = L->ring[k * 2];
        out[i * 2 + 1] = L->ring[k * 2 + 1];
        loud = std::max(loud, std::max(abs(int(out[i * 2])), abs(int(out[i * 2 + 1]))));
    }
    in->host.heard(loud, n == uint32_t(frames), frames, in->held[0].load(std::memory_order_relaxed) || in->held[1].load(std::memory_order_relaxed));
    if (in->hole && n > 0) { // the block before ended short: back in with a fade
        const uint32_t f = std::min<uint32_t>(n, FADE);
        for (uint32_t i = 0; i < f; i++) {
            out[i * 2] = int16_t(int32_t(out[i * 2]) * int32_t(i) / int32_t(f));
            out[i * 2 + 1] = int16_t(int32_t(out[i * 2 + 1]) * int32_t(i) / int32_t(f));
        }
        in->hole = false;
    }
    if (n < uint32_t(frames)) {
        const uint32_t f = std::min<uint32_t>(n, FADE);
        for (uint32_t i = 0; i < f; i++) { // out with a fade, not a cut
            const uint32_t k = n - f + i;
            out[k * 2] = int16_t(int32_t(out[k * 2]) * int32_t(f - 1 - i) / int32_t(f));
            out[k * 2 + 1] = int16_t(int32_t(out[k * 2 + 1]) * int32_t(f - 1 - i) / int32_t(f));
        }
        memset(out + n * 2, 0, size_t(uint32_t(frames) - n) * 2 * sizeof(int16_t));
        in->hole = true;
        in->underruns.fetch_add(1, std::memory_order_relaxed);
        L->missAt.store(now_us(), std::memory_order_relaxed);
    }
    L->rd.store(r + n, std::memory_order_release);
    sem_post(&L->wake);
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
