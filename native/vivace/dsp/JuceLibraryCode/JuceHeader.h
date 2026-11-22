// Vivace: the header the engine's sources include for JUCE (in place of the
// Projucer's generated one).
#pragma once

#include "AppConfig.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <juce_data_structures/juce_data_structures.h>
#include <juce_dsp/juce_dsp.h>
#include <juce_events/juce_events.h>

#if ! DONT_SET_USING_JUCE_NAMESPACE
using namespace juce;
#endif

// The engine writes this into every state it saves ("synth_version") and
// refuses a preset from a newer feature version: the last released version
// of the synth this source comes from, so its users' presets load and what
// Vivace saves loads there too. The names are Vivace's: the source's own
// name is its author's trademark (its README) and is never used.
namespace ProjectInfo {
const char *const projectName = "Vivace";
const char *const companyName = "Pung";
const char *const versionString = "1.5.5";
const int versionNumber = 0x010505;
} // namespace ProjectInfo
