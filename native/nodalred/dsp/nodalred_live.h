// nodalred_live.h: where the sound has its controls now, from the engine to
// the plugin (Pung's live_mod: every synth shows its modulation moving;
// docs/NATIVE-MODULES.md, Nodal Red). In the shared memory's aux words.
#pragma once
#include <cstdint>

namespace n2live {
const int VOICE = 2; // the voice the newest note took (0..19, -1: none yet)
const int CUT = 3;   // its filter cutoff word, with all that moves it
const int AT = 6;    // when (ms, CLOCK_MONOTONIC, read with wrap)

// The cutoff word at knob 0 (Y:0x12 + 22 k): a semitone a knob step over the
// whole travel, measured with native/nodalred/tools/n2x_scan.cpp (2026-11-24)
const double CUT0 = 5152.0;
} // namespace n2live
