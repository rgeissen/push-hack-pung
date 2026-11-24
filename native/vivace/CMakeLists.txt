# Vivace: a Pung-native module (docs/NATIVE-MODULES.md): the synthesis engine
# of an open-source spectral warping wavetable synthesizer (GPLv3), headless,
# behind Pung's plugin API.
# ENGINE_SOURCE: the synth's source tree (its src/ and third_party/ folders).
cmake_minimum_required(VERSION 3.15)
project(vivace CXX C)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()
if(NOT ENGINE_SOURCE)
    message(FATAL_ERROR "ENGINE_SOURCE is not set")
endif()
if(NOT SCHWUNG_SRC)
    message(FATAL_ERROR "SCHWUNG_SRC is not set (Schwung's src folder, for host/plugin_api_v1.h)")
endif()
find_package(Threads REQUIRED)
set(S ${ENGINE_SOURCE}/src)

# The engine as its own build does it (-Ofast: fast math, vectorised); keep
# dsp.so unloadable (no STB_GNU_UNIQUE symbols from inline statics).
add_compile_options(-O3 -ffast-math -ftree-vectorize -funroll-loops -fvisibility=hidden
                    $<$<COMPILE_LANGUAGE:CXX>:-fno-gnu-unique> -Wno-deprecated-declarations)
add_compile_definitions(LINUX=1 NDEBUG=1 HEADLESS=1 NO_AUTH=1 JUCE_HEADLESS=1
    JucePlugin_Build_VST=0 JucePlugin_Build_VST3=0 JucePlugin_Build_AU=0 JucePlugin_Build_AUv3=0
    JucePlugin_Build_RTAS=0 JucePlugin_Build_AAX=0 JucePlugin_Build_Standalone=0 JucePlugin_Build_Unity=0)

add_library(vivace-engine STATIC
    ${S}/unity_build/common.cpp
    ${S}/unity_build/synthesis.cpp
    dsp/JuceLibraryCode/include_juce_core.cpp
    dsp/JuceLibraryCode/include_juce_events.cpp
    dsp/JuceLibraryCode/include_juce_data_structures.cpp
    dsp/JuceLibraryCode/include_juce_audio_basics.cpp
    dsp/JuceLibraryCode/include_juce_audio_formats.cpp
    dsp/JuceLibraryCode/include_juce_dsp.cpp
    dsp/vivace_factory.cpp)
target_include_directories(vivace-engine PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/dsp
    ${CMAKE_CURRENT_SOURCE_DIR}/dsp/JuceLibraryCode
    ${ENGINE_SOURCE}/third_party/JUCE/modules
    ${ENGINE_SOURCE}/third_party
    ${S}/common ${S}/common/wavetable
    ${S}/synthesis/synth_engine ${S}/synthesis/effects ${S}/synthesis/filters ${S}/synthesis/framework
    ${S}/synthesis/lookups ${S}/synthesis/modulators ${S}/synthesis/modules ${S}/synthesis/producers
    ${S}/synthesis/utilities
    ${S}/interface/look_and_feel)
target_link_libraries(vivace-engine PUBLIC Threads::Threads rt dl)

add_library(vivace-dsp SHARED dsp/vivace_plugin.cpp dsp/vivace_wavetables.cpp)
set_target_properties(vivace-dsp PROPERTIES PREFIX "" OUTPUT_NAME "dsp" SUFFIX ".so")
target_include_directories(vivace-dsp PRIVATE ${SCHWUNG_SRC} ${SCHWUNG_SRC}/host)
target_link_libraries(vivace-dsp PRIVATE vivace-engine)
target_link_options(vivace-dsp PRIVATE -Wl,--exclude-libs,ALL -static-libstdc++ -static-libgcc)

# Writes the factory sounds (dsp/vivace_factory.cpp) as preset files, at build
# time: the package's factory/ folder.
add_executable(vivace-export dsp/vivace_export.cpp dsp/vivace_wavetables.cpp dsp/vivace_wtbuild.cpp)
target_link_libraries(vivace-export PRIVATE vivace-engine)
target_link_options(vivace-export PRIVATE -static-libstdc++ -static-libgcc)
