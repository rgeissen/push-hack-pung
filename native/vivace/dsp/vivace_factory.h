// Vivace's factory sounds: built in code on the engine (vivace_factory.cpp),
// written as preset files at build time (vivace-export factory).
#pragma once
class SynthBase;
namespace vivace {
int factoryCount();
const char *factoryName(int i);
void buildFactory(SynthBase &s, int i); // on a synth just set to its init sound
} // namespace vivace
