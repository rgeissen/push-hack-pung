// Vivace: the JUCE configuration the engine is built with (in place of the
// Projucer's generated one). Only what the synthesis engine needs, headless:
// no GUI, no audio devices, no network, no audio codecs beyond WAV/AIFF.
//
// JUCE 6 is used under the GPL v3 (juce_data_structures, juce_audio_formats,
// juce_dsp) and the ISC licence (juce_core, juce_events, juce_audio_basics);
// both texts ship in the package's licenses/ folder.
#pragma once

#ifndef JUCE_DISPLAY_SPLASH_SCREEN
#define JUCE_DISPLAY_SPLASH_SCREEN 0
#endif
#define JUCE_USE_DARK_SPLASH_SCREEN 1

#define JUCE_MODULE_AVAILABLE_juce_audio_basics 1
#define JUCE_MODULE_AVAILABLE_juce_audio_formats 1
#define JUCE_MODULE_AVAILABLE_juce_core 1
#define JUCE_MODULE_AVAILABLE_juce_data_structures 1
#define JUCE_MODULE_AVAILABLE_juce_dsp 1
#define JUCE_MODULE_AVAILABLE_juce_events 1

#define JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED 1

#define JUCE_USE_FLAC 0
#define JUCE_USE_OGGVORBIS 0
#define JUCE_USE_MP3AUDIOFORMAT 0
#define JUCE_USE_LAME_AUDIO_FORMAT 0
#define JUCE_USE_WINDOWS_MEDIA_FORMAT 0

#define JUCE_USE_CURL 0
#define JUCE_LOAD_CURL_SYMBOLS_LAZILY 0
#define JUCE_WEB_BROWSER 0
#define JUCE_CHECK_MEMORY_LEAKS 0
#define JUCE_CATCH_UNHANDLED_EXCEPTIONS 0
#define JUCE_ALLOW_STATIC_NULL_VARIABLES 0
#define JUCE_ENABLE_ALLOCATION_HOOKS 0

#define JUCE_DSP_USE_INTEL_MKL 0
#define JUCE_DSP_USE_SHARED_FFTW 0
#define JUCE_DSP_USE_STATIC_FFTW 0

#define JUCE_STANDALONE_APPLICATION 0
