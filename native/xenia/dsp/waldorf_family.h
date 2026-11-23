// waldorf_family.h: what differs between Pung's two Waldorf synths, for the
// plugin (waldorf_engine.cpp) and the engine (waldorf_emu.cpp) alike: Vavra
// (the microQ; WALDORF_MQ) and Xenia (the Microwave II/XT; WALDORF_XT).
// Identical copies in native/vavra/dsp and native/xenia/dsp (edit one, copy,
// cmp). From gearmulator's parameterDescriptions_*.json, "midipackets".
#pragma once

#include <cstddef>
#include <cstdint>

#if defined(WALDORF_MQ)
#define SYNTH_ID "vavra"
#define SYNTH_NAME "Vavra"
#define SYNTH_HW "microQ"
#define FIRMWARE_HINT "the microQ operating system mq_2_23.mid, or a 512 KB microQ ROM"
#elif defined(WALDORF_XT)
#define SYNTH_ID "xenia"
#define SYNTH_NAME "Xenia"
#define SYNTH_HW "Microwave II/XT"
#define FIRMWARE_HINT "a 256 KB Microwave II/XT ROM (or its two 128 KB halves)"
#else
#error "WALDORF_MQ or WALDORF_XT"
#endif

namespace fam {
const uint8_t WALDORF = 0x3e, OMNI = 0x7f;
const uint8_t REQUEST_SINGLE = 0x00, SINGLE_DUMP = 0x10, SINGLE_PARAM = 0x20;
#if defined(WALDORF_MQ)
const uint8_t MODEL = 0x10;  // microQ
const int BANKS = 3, SOUNDS = 100; // A, B, C: the internal singles
const uint8_t BANK0 = 0x40;  // MidiBufferNum::SingleBankA (a dump file may say 0x00: the deprecated A)
const uint8_t EDIT = 0x20;   // MidiBufferNum::SingleEditBufferSingleMode
const int DATA = 383;        // a single's bytes, between header and checksum
const int NAME_AT = 363, NAME_LEN = 16, CAT_AT = 379, CAT_LEN = 4;
const char *const BANK_NAME[] = {"Bank A", "Bank B", "Bank C"};
const int CHECKSUM_FROM = 4;      // a dump's checksum: from the command byte (mqState::sendMulti)
const uint8_t *const BOOT = nullptr; // nothing to say after booting
const int BOOT_LEN = 0;
#else
const uint8_t MODEL = 0x0e;  // Microwave II/XT
const int BANKS = 2, SOUNDS = 128; // A and B
const uint8_t BANK0 = 0x00;  // xt::LocationH::SingleBankA
const uint8_t EDIT = 0x20;   // xt::LocationH::SingleEditBufferSingleMode
const int DATA = 256;        // a single's bytes, its name the last sixteen
const int NAME_AT = 240, NAME_LEN = 16, CAT_AT = -1, CAT_LEN = 0;
const char *const BANK_NAME[] = {"Bank A", "Bank B"};
const int CHECKSUM_FROM = 7;      // from the first byte of the sound (parameterDescriptions_xt "singledump")
// The XT boots into Multi mode, and a single sent to the single-mode edit
// buffer is only played in Single mode: a mode dump says Single
// (xtController::setPlayMode, sendModeDump)
const uint8_t BOOT_MSG[] = {0xf0, WALDORF, MODEL, OMNI, 0x17, 0x00, 0xf7};
const uint8_t *const BOOT = BOOT_MSG;
const int BOOT_LEN = sizeof(BOOT_MSG);
#endif
} // namespace fam

// A single dump: its bank letter (0 = A) and place, or false.
template <typename Bytes> // a SysexBuffer (a pmr vector) or a plain one
bool single_dump(const Bytes &s, int &bank, int &place) {
    if (fam::DATA == 0 || s.size() != size_t(fam::DATA + 9) || s[1] != fam::WALDORF || s[2] != fam::MODEL || s[4] != fam::SINGLE_DUMP)
        return false;
    bank = s[5] >= fam::BANK0 ? s[5] - fam::BANK0 : s[5];
    place = s[6];
    return bank >= 0 && bank < 26 && place < 128;
}

#if defined(WALDORF_XT)
// The XT's wave memory (waldorf_emu.cpp publishes it, waldorf_engine.cpp reads
// a computed table from it): one byte says whether it was there, then 16
// positions (0, 4 .. 60) of 128 samples.
const size_t WAVE_SNAPSHOT = 1 + 16 * 128;
#endif

// The engine's signals (eshm::Layout::aux)
enum Aux { ASK_LIBRARY = 0, LIBRARY_DONE = 1 };
