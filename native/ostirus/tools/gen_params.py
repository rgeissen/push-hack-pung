#!/usr/bin/env python3
"""Writes dsp/ti_params.h: OsTIrus' parameters, from gearmulator's own Virus TI
descriptions (osTIrusJucePlugin/parameterDescriptions_TI.json) and the page
layout below. Run when either changes:

    tools/gen_params.py <gearmulator source dir>

The layout is the design (docs/NATIVE-MODULES.md, OsTIrus): one page one
thought, eight knobs, the same knob doing the same job on sibling pages.
A parameter is named here by its name in the descriptions; its page, index,
range and value texts come from there, so nothing about the synth is typed
twice.
"""
import json, os, re, sys

# (compartment, page label, [parameter names]); "soft1".."soft3" are the
# patch's Soft Knobs, whatever the patch points them at.
LAYOUT = [
    ("virus", "Virus", ["soft1", "soft2", "soft3", "Cutoff", "Filter1 Resonance", "Filter1 Env Amt", "Delay Send", "Reverb Send"]),

    ("osc", "Osc 1", ["Osc1 Mode", "Osc1 Shape", "Osc1 Wave Select", "Osc1 Pulsewidth", "Osc1 Semitone", "Osc1 Keyfollow",
                      "Osc1 Wavetable/FormantShift", "Osc1 Wavetable/Internal Detune"]),
    ("osc", "Osc 2", ["Osc2 Mode", "Osc2 Shape", "Osc2 Wave Select", "Osc2 Pulsewidth", "Osc2 Semitone", "Osc2 Detune",
                      "Osc2 Keyfollow", "Osc2 Filt Env Amt"]),
    ("osc", "Osc 3 + Sub", ["Osc3 Mode", "Osc3 Volume", "Osc3 Semitone", "Osc3 Detune", "Suboscillator Volume",
                            "Suboscillator Shape", "Noise Volume", "Noise Color"]),
    ("osc", "Mix + FM", ["Osc Balance", "Osc Mainvolume", "Osc2 FM Amount", "Osc FM Mode", "Osc2 Sync", "FM Filt Env Amt",
                         "Ringmodulator Volume", "Punch Intensity"]),

    ("filter", "Filters", ["Cutoff", "Filter1 Resonance", "Filter1 Env Amt", "Filter Balance", "Cutoff2", "Filter2 Resonance",
                           "Filter2 Env Amt", "Filter Routing"]),
    ("filter", "Filters +", ["Filter1 Mode", "Filter1 Keyfollow", "Filter1 Env Polarity", "Saturation Curve", "Filter2 Mode",
                             "Filter2 Keyfollow", "Filter2 Env Polarity", "Filter2 Cutoff Link"]),

    ("env", "Filter Env", ["Filter Env Attack", "Filter Env Decay", "Filter Env Sustain", "Filter Env Sustain Time",
                           "Filter Env Release", "Flt1 EnvAmt Velocity", "Flt2 EnvAmt Velocity", "Filter Keytrack Base"]),
    ("env", "Amp Env", ["Amp Env Attack", "Amp Env Decay", "Amp Env Sustain", "Amp Env Sustain Time", "Amp Env Release",
                        "Amp Velocity", "Patch Volume", "Panorama"]),
    ("env", "Env 3", ["Envelope 3/Attack", "Envelope 3/Decay", "Envelope 3/Sustain", "Envelope 3/Sustain Time",
                      "Envelope 3/Release"]),
    ("env", "Env 4", ["Envelope 4/Attack", "Envelope 4/Decay", "Envelope 4/Sustain", "Envelope 4/Sustain Time",
                      "Envelope 4/Release"]),

    ("lfo", "LFO 1", ["Lfo1 Rate", "Lfo1 Shape", "Lfo1 Clock", "Lfo1 Mode", "Lfo1 Symmetry", "Lfo1 Keyfollow",
                      "Lfo1 Keytrigger", "Lfo1 Env Mode"]),
    ("lfo", "LFO 1 Amounts", ["Osc1 Lfo1 Amount", "Osc2 Lfo1 Amount", "PW Lfo1 Amount", "Reso Lfo1 Amount",
                              "FiltGain Lfo1 Amount", "LFO1 Assign Dest", "LFO1 Assign Amount"]),
    ("lfo", "LFO 2", ["Lfo2 Rate", "Lfo2 Shape", "Lfo2 Clock", "Lfo2 Mode", "Lfo2 Symmetry", "Lfo2 Keyfollow",
                      "Lfo2 Keytrigger", "Lfo2 Env Mode"]),
    ("lfo", "LFO 2 Amounts", ["Shape Lfo2 Amount", "FM Lfo2 Amount", "Cutoff1 Lfo2 Amount", "Cutoff2 Lfo2 Amount",
                              "Pan Lfo2 Amount", "LFO2 Assign Dest", "LFO2 Assign Amount"]),
    ("lfo", "LFO 3", ["Lfo3 Rate", "Lfo3 Shape", "Lfo3 Clock", "Lfo3 Mode", "Lfo3 Keyfollow", "Lfo3 Destination",
                      "Osc Lfo3 Amount", "Lfo3 Fade-In Time"]),

    ("matrix", "Slot 1", ["Assign1 Source", "Assign1 Destination", "Assign1 Amount", "Assign 1 Destination 2",
                          "Assign 1 Amount 2", "Assign 1 Destination 3", "Assign 1 Amount 3"]),
    ("matrix", "Slot 2", ["Assign2 Source", "Assign2 Destination1", "Assign2 Amount1", "Assign2 Destination2",
                          "Assign2 Amount2", "Assign 2 Destination 3", "Assign 2 Amount 3"]),
    ("matrix", "Slot 3", ["Assign3 Source", "Assign3 Destination1", "Assign3 Amount1", "Assign3 Destination2",
                          "Assign3 Amount2", "Assign3 Destination3", "Assign3 Amount3"]),
    ("matrix", "Slot 4", ["Assign 4 Source", "Assign 4 Destination", "Assign 4 Amount", "Assign 4 Destination 2",
                          "Assign 4 Amount 2", "Assign 4 Destination 3", "Assign 4 Amount 3"]),
    ("matrix", "Slot 5", ["Assign 5 Source", "Assign 5 Destination", "Assign 5 Amount", "Assign 5 Destination 2",
                          "Assign 5 Amount 2", "Assign 5 Destination 3", "Assign 5 Amount 3"]),
    ("matrix", "Slot 6", ["Assign 6 Source", "Assign 6 Destination", "Assign 6 Amount", "Assign 6 Destination 2",
                          "Assign 6 Amount 2", "Assign 6 Destination 3", "Assign 6 Amount 3"]),

    ("fx", "Delay", ["Delay Type", "Delay Send", "Delay Time", "Delay Feedback", "Delay Clock", "Dly Rate / Rev Decay",
                     "Dly Depth ", "Delay Color"]),
    ("fx", "Reverb", ["Reverb Mode", "Reverb Send", "Reverb Type", "Reverb Time", "Reverb Damping", "Reverb Color",
                      "Reverb Predelay", "Reverb Feedback"]),
    ("fx", "Chorus", ["Chorus/Type", "Chorus Mix", "Chorus Rate", "Chorus Depth", "Chorus Delay", "Chorus Feedback",
                      "Chorus Lfo Shape", "Chorus/X Over"]),
    ("fx", "Phaser", ["Phaser Mode", "Phaser Mix", "Phaser Rate", "Phaser Depth", "Phaser Frequency", "Phaser Feedback",
                      "Phaser Spread"]),
    ("fx", "Distortion", ["Distortion Curve", "Distortion Intensity", "Patch Distortion/Mix", "Patch Distortion/Treble Booster",
                          "Patch Distortion/High Cut", "Character Type", "Bass Intensity", "Bass Tune"]),
    ("fx", "EQ", ["LowEQ Frequency", "LowEQ Gain", "MidEQ Frequency", "MidEQ Gain", "MidEQ Q-Factor", "HighEQ Frequency",
                  "HighEQ Gain"]),
    ("fx", "Filter Bank", ["Filter Bank/Type", "Filter Bank/Mix", "Filter Bank/Frequency", "Filter Bank/Resonance",
                           "Filter Bank/Slope", "Filter Bank/Poles", "Filter Bank/Stereo Phase"]),

    ("arp", "Arp", ["Arp Mode", "Arp Pattern Selct", "Arp Octave Range", "Arp Hold Enable", "Arp Note Length", "Arp Swing",
                    "Arp Clock", "Clock Tempo"]),

    ("voice", "Voice", ["Key Mode", "Unison Mode", "Unison Detune", "Unison Pan Spread", "Unison Lfo Phase", "Portamento Time",
                        "Transpose", "Bender Range Up"]),
    ("voice", "Velocity", ["Osc1 Shape Velocity", "Osc2 Shape Velocity", "PulseWidth Velocity", "Fm Amount Velocity",
                           "Resonance1 Velocity", "Resonance2 Velocity", "Panorama Velocity", "Bender Range Down"]),
]

# value texts that are plain numbers around the middle: shown as numbers, -64..+63
OFFSET64 = {"signed", "signedMidOff", "pan", "signedNorm", "biPolarPercent"}
# value texts that are plain numbers from 0: shown as numbers
PLAIN = {"unsignedZero", None}
# a name a key has on the Push and in Live: twelve characters at most, so the
# encoder row shows it whole (a page's own screen leaves a column of 120 px)
NAMES = {'filter1_resonance': 'Reso 1', 'filter1_env_amt': 'Flt1 Env', 'reverb_send': 'Rev Send', 'delay_send': 'Dly Send', 'osc1_mode': 'Osc1 Model', 'osc1_shape': 'Osc1 Shape', 'osc1_wave_select': 'Osc1 Wave', 'osc1_pulsewidth': 'Osc1 PW', 'osc1_semitone': 'Osc1 Semi', 'osc1_keyfollow': 'Osc1 Keys', 'osc1_wavetable_formantshift': 'Formant', 'osc1_wavetable_internal_detune': 'Int Detune', 'osc2_mode': 'Osc2 Model', 'osc2_shape': 'Osc2 Shape', 'osc2_wave_select': 'Osc2 Wave', 'osc2_pulsewidth': 'Osc2 PW', 'osc2_semitone': 'Osc2 Semi', 'osc2_detune': 'Osc2 Fine', 'osc2_keyfollow': 'Osc2 Keys', 'osc2_filt_env_amt': 'Env>Pitch', 'osc3_mode': 'Osc3 Model', 'osc3_volume': 'Osc3 Vol', 'osc3_semitone': 'Osc3 Semi', 'osc3_detune': 'Osc3 Fine', 'suboscillator_volume': 'Sub Vol', 'suboscillator_shape': 'Sub Shape', 'noise_volume': 'Noise Vol', 'noise_color': 'Noise Color', 'osc_balance': 'Osc Balance', 'osc_mainvolume': 'Osc Vol', 'osc2_fm_amount': 'FM Amount', 'osc_fm_mode': 'FM Mode', 'osc2_sync': 'Sync', 'fm_filt_env_amt': 'Env>FM', 'ringmodulator_volume': 'Ring Mod', 'punch_intensity': 'Punch', 'cutoff': 'Cutoff 1', 'cutoff2': 'Cutoff 2', 'filter_balance': 'Flt Balance', 'filter2_resonance': 'Reso 2', 'filter2_env_amt': 'Flt2 Env', 'filter_routing': 'Routing', 'filter1_mode': 'Flt1 Mode', 'filter1_keyfollow': 'Flt1 Keys', 'filter1_env_polarity': 'Flt1 Polar', 'saturation_curve': 'Saturation', 'filter2_mode': 'Flt2 Mode', 'filter2_keyfollow': 'Flt2 Keys', 'filter2_env_polarity': 'Flt2 Polar', 'filter2_cutoff_link': 'Cutoff Link', 'filter_env_attack': 'FEnv Attack', 'filter_env_decay': 'FEnv Decay', 'filter_env_sustain': 'FEnv Sus', 'filter_env_sustain_time': 'FEnv Slope', 'filter_env_release': 'FEnv Rel', 'flt1_envamt_velocity': 'Vel>Flt1', 'flt2_envamt_velocity': 'Vel>Flt2', 'filter_keytrack_base': 'Key Base', 'amp_env_attack': 'AEnv Attack', 'amp_env_decay': 'AEnv Decay', 'amp_env_sustain': 'AEnv Sus', 'amp_env_sustain_time': 'AEnv Slope', 'amp_env_release': 'AEnv Rel', 'amp_velocity': 'Vel>Amp', 'patch_volume': 'Volume', 'panorama': 'Pan', 'envelope_3_attack': 'Env3 Attack', 'envelope_3_decay': 'Env3 Decay', 'envelope_3_sustain': 'Env3 Sus', 'envelope_3_sustain_time': 'Env3 Slope', 'envelope_3_release': 'Env3 Rel', 'envelope_4_attack': 'Env4 Attack', 'envelope_4_decay': 'Env4 Decay', 'envelope_4_sustain': 'Env4 Sus', 'envelope_4_sustain_time': 'Env4 Slope', 'envelope_4_release': 'Env4 Rel', 'osc1_lfo1_amount': 'L1>Osc1', 'osc2_lfo1_amount': 'L1>Osc2', 'pw_lfo1_amount': 'L1>PW', 'reso_lfo1_amount': 'L1>Reso', 'filtgain_lfo1_amount': 'L1>FltGain', 'lfo1_assign_dest': 'L1 Assign', 'lfo1_assign_amount': 'L1 Amount', 'shape_lfo2_amount': 'L2>Shape', 'fm_lfo2_amount': 'L2>FM', 'cutoff1_lfo2_amount': 'L2>Cut1', 'cutoff2_lfo2_amount': 'L2>Cut2', 'pan_lfo2_amount': 'L2>Pan', 'lfo2_assign_dest': 'L2 Assign', 'lfo2_assign_amount': 'L2 Amount', 'lfo3_destination': 'L3 Dest', 'osc_lfo3_amount': 'L3 Amount', 'lfo3_fade_in_time': 'L3 Fade In', 'delay_type': 'Dly Type', 'delay_time': 'Dly Time', 'delay_feedback': 'Dly Fdbk', 'delay_clock': 'Dly Clock', 'dly_rate_rev_decay': 'Dly Rate', 'dly_depth': 'Dly Depth', 'delay_color': 'Dly Color', 'reverb_mode': 'Rev Mode', 'reverb_type': 'Rev Type', 'reverb_time': 'Rev Time', 'reverb_damping': 'Rev Damp', 'reverb_color': 'Rev Color', 'reverb_predelay': 'Rev Predly', 'reverb_feedback': 'Rev Fdbk', 'chorus_type': 'Cho Type', 'chorus_mix': 'Cho Mix', 'chorus_rate': 'Cho Rate', 'chorus_depth': 'Cho Depth', 'chorus_delay': 'Cho Delay', 'chorus_feedback': 'Cho Fdbk', 'chorus_lfo_shape': 'Cho Shape', 'chorus_x_over': 'Cho X-Over', 'phaser_mode': 'Pha Stages', 'phaser_mix': 'Pha Mix', 'phaser_rate': 'Pha Rate', 'phaser_depth': 'Pha Depth', 'phaser_frequency': 'Pha Freq', 'phaser_feedback': 'Pha Fdbk', 'phaser_spread': 'Pha Spread', 'distortion_curve': 'Dist Type', 'distortion_intensity': 'Dist Amount', 'patch_distortion_mix': 'Dist Mix', 'patch_distortion_treble_booster': 'Treble Boost', 'patch_distortion_high_cut': 'High Cut', 'character_type': 'Character', 'bass_intensity': 'Bass Boost', 'bass_tune': 'Bass Tune', 'loweq_frequency': 'Low Freq', 'loweq_gain': 'Low Gain', 'mideq_frequency': 'Mid Freq', 'mideq_gain': 'Mid Gain', 'mideq_q_factor': 'Mid Q', 'higheq_frequency': 'High Freq', 'higheq_gain': 'High Gain', 'filter_bank_type': 'FB Type', 'filter_bank_mix': 'FB Mix', 'filter_bank_frequency': 'FB Freq', 'filter_bank_resonance': 'FB Reso', 'filter_bank_slope': 'FB Slope', 'filter_bank_poles': 'FB Poles', 'filter_bank_stereo_phase': 'FB Stereo', 'arp_mode': 'Arp Mode', 'arp_pattern_selct': 'Arp Pattern', 'arp_octave_range': 'Arp Octaves', 'arp_hold_enable': 'Arp Hold', 'arp_note_length': 'Arp Length', 'arp_swing': 'Arp Swing', 'arp_clock': 'Arp Clock', 'clock_tempo': 'Tempo', 'key_mode': 'Key Mode', 'unison_mode': 'Unison', 'unison_detune': 'Uni Detune', 'unison_pan_spread': 'Uni Spread', 'unison_lfo_phase': 'Uni LFO Ph', 'portamento_time': 'Portamento', 'transpose': 'Transpose', 'bender_range_up': 'Bend Up', 'osc1_shape_velocity': 'Vel>Shape1', 'osc2_shape_velocity': 'Vel>Shape2', 'pulsewidth_velocity': 'Vel>PW', 'fm_amount_velocity': 'Vel>FM', 'resonance1_velocity': 'Vel>Reso1', 'resonance2_velocity': 'Vel>Reso2', 'panorama_velocity': 'Vel>Pan', 'bender_range_down': 'Bend Down', 'lfo1_rate': 'L1 Rate', 'lfo1_shape': 'L1 Shape', 'lfo1_clock': 'L1 Clock', 'lfo1_mode': 'L1 Mode', 'lfo1_symmetry': 'L1 Symm', 'lfo1_keyfollow': 'L1 Keys', 'lfo1_keytrigger': 'L1 Key Trig', 'lfo1_env_mode': 'L1 Env Mode', 'lfo2_rate': 'L2 Rate', 'lfo2_shape': 'L2 Shape', 'lfo2_clock': 'L2 Clock', 'lfo2_mode': 'L2 Mode', 'lfo2_symmetry': 'L2 Symm', 'lfo2_keyfollow': 'L2 Keys', 'lfo2_keytrigger': 'L2 Key Trig', 'lfo2_env_mode': 'L2 Env Mode', 'lfo3_rate': 'L3 Rate', 'lfo3_shape': 'L3 Shape', 'lfo3_clock': 'L3 Clock', 'lfo3_mode': 'L3 Mode', 'lfo3_symmetry': 'L3 Symm', 'lfo3_keyfollow': 'L3 Keys', 'lfo3_keytrigger': 'L3 Key Trig', 'lfo3_env_mode': 'L3 Env Mode', 'assign1_source': 'M1 Source', 'assign1_destination': 'M1 Dest 1', 'assign1_amount': 'M1 Amount 1', 'assign_1_destination_2': 'M1 Dest 2', 'assign_1_amount_2': 'M1 Amount 2', 'assign_1_destination_3': 'M1 Dest 3', 'assign_1_amount_3': 'M1 Amount 3', 'assign2_source': 'M2 Source', 'assign2_destination1': 'M2 Dest 1', 'assign2_amount1': 'M2 Amount 1', 'assign2_destination2': 'M2 Dest 2', 'assign2_amount2': 'M2 Amount 2', 'assign_2_destination_3': 'M2 Dest 3', 'assign_2_amount_3': 'M2 Amount 3', 'assign3_source': 'M3 Source', 'assign3_destination1': 'M3 Dest 1', 'assign3_amount1': 'M3 Amount 1', 'assign3_destination2': 'M3 Dest 2', 'assign3_amount2': 'M3 Amount 2', 'assign3_destination3': 'M3 Dest 3', 'assign3_amount3': 'M3 Amount 3', 'assign_4_source': 'M4 Source', 'assign_4_destination': 'M4 Dest 1', 'assign_4_amount': 'M4 Amount 1', 'assign_4_destination_2': 'M4 Dest 2', 'assign_4_amount_2': 'M4 Amount 2', 'assign_4_destination_3': 'M4 Dest 3', 'assign_4_amount_3': 'M4 Amount 3', 'assign_5_source': 'M5 Source', 'assign_5_destination': 'M5 Dest 1', 'assign_5_amount': 'M5 Amount 1', 'assign_5_destination_2': 'M5 Dest 2', 'assign_5_amount_2': 'M5 Amount 2', 'assign_5_destination_3': 'M5 Dest 3', 'assign_5_amount_3': 'M5 Amount 3', 'assign_6_source': 'M6 Source', 'assign_6_destination': 'M6 Dest 1', 'assign_6_amount': 'M6 Amount 1', 'assign_6_destination_2': 'M6 Dest 2', 'assign_6_amount_2': 'M6 Amount 2', 'assign_6_destination_3': 'M6 Dest 3', 'assign_6_amount_3': 'M6 Amount 3'}

# short labels for the encoder row, where a description's name is too long
SHORT = {
    "Filter1 Resonance": "Filter1 Reso", "Filter2 Resonance": "Filter2 Reso",
    "Cutoff": "Cutoff", "Cutoff2": "Cutoff 2", "Osc Mainvolume": "Osc Vol", "Suboscillator Volume": "Sub Vol",
    "Suboscillator Shape": "Sub Shape", "Ringmodulator Volume": "Ring Mod", "Punch Intensity": "Punch",
    "Osc2 Filt Env Amt": "Env>Pitch", "FM Filt Env Amt": "Env>FM", "Osc2 FM Amount": "FM Amount", "Osc FM Mode": "FM Mode",
    "Dly Rate / Rev Decay": "Dly Rate", "Dly Depth ": "Dly Depth", "Arp Pattern Selct": "Arp Pattern",
    "Patch Distortion/Treble Booster": "Treble Boost", "Patch Distortion/High Cut": "High Cut", "Patch Distortion/Mix": "Dist Mix",
    "Filter Keytrack Base": "Key Base", "Flt1 EnvAmt Velocity": "Vel>Env 1", "Flt2 EnvAmt Velocity": "Vel>Env 2",
    "Osc1 Wavetable/FormantShift": "Formant", "Osc1 Wavetable/Internal Detune": "Int Detune",
    "Filter Bank/Stereo Phase": "FB Stereo Phase", "Filter Bank/Type": "FB Type", "Filter Bank/Mix": "FB Mix",
    "Filter Bank/Frequency": "FB Frequency", "Filter Bank/Resonance": "FB Resonance", "Filter Bank/Slope": "FB Slope",
    "Filter Bank/Poles": "FB Poles", "Chorus/Type": "Chorus Type", "Chorus/X Over": "Chorus X-Over",
    "Envelope 3/Attack": "Env3 Attack", "Envelope 3/Decay": "Env3 Decay", "Envelope 3/Sustain": "Env3 Sustain",
    "Envelope 3/Sustain Time": "Env3 Sus Time", "Envelope 3/Release": "Env3 Release",
    "Envelope 4/Attack": "Env4 Attack", "Envelope 4/Decay": "Env4 Decay", "Envelope 4/Sustain": "Env4 Sustain",
    "Envelope 4/Sustain Time": "Env4 Sus Time", "Envelope 4/Release": "Env4 Release",
    "Filter Env Sustain Time": "FiltEnv Sus Time", "Amp Env Sustain Time": "AmpEnv Sus Time",
    "Assign 1 Destination 2": "Slot1 Dest 2", "Assign 1 Amount 2": "Slot1 Amount 2", "Assign 1 Destination 3": "Slot1 Dest 3",
    "Assign 1 Amount 3": "Slot1 Amount 3", "Assign1 Destination": "Slot1 Dest 1", "Assign1 Amount": "Slot1 Amount 1",
    "Assign1 Source": "Slot1 Source",
    "Assign2 Source": "Slot2 Source",
    "Assign2 Destination1": "Slot2 Dest 1",
    "Assign2 Amount1": "Slot2 Amount 1",
    "Assign2 Destination2": "Slot2 Dest 2",
    "Assign2 Amount2": "Slot2 Amount 2",
    "Assign3 Source": "Slot3 Source",
    "Assign3 Destination1": "Slot3 Dest 1",
    "Assign3 Amount1": "Slot3 Amount 1",
    "Assign3 Destination2": "Slot3 Dest 2",
    "Assign3 Amount2": "Slot3 Amount 2",
    "Assign 2 Destination 3": "Slot2 Dest 3",
    "Assign 2 Amount 3": "Slot2 Amount 3",
    "Assign3 Destination3": "Slot3 Dest 3",
    "Assign3 Amount3": "Slot3 Amount 3",
    "Assign 4 Source": "Slot4 Source",
    "Assign 4 Destination": "Slot4 Dest 1",
    "Assign 4 Amount": "Slot4 Amount 1",
    "Assign 4 Destination 2": "Slot4 Dest 2",
    "Assign 4 Amount 2": "Slot4 Amount 2",
    "Assign 4 Destination 3": "Slot4 Dest 3",
    "Assign 4 Amount 3": "Slot4 Amount 3",
    "Assign 5 Source": "Slot5 Source",
    "Assign 5 Destination": "Slot5 Dest 1",
    "Assign 5 Amount": "Slot5 Amount 1",
    "Assign 5 Destination 2": "Slot5 Dest 2",
    "Assign 5 Amount 2": "Slot5 Amount 2",
    "Assign 5 Destination 3": "Slot5 Dest 3",
    "Assign 5 Amount 3": "Slot5 Amount 3",
    "Assign 6 Source": "Slot6 Source",
    "Assign 6 Destination": "Slot6 Dest 1",
    "Assign 6 Amount": "Slot6 Amount 1",
    "Assign 6 Destination 2": "Slot6 Dest 2",
    "Assign 6 Amount 2": "Slot6 Amount 2",
    "Assign 6 Destination 3": "Slot6 Dest 3",
    "Assign 6 Amount 3": "Slot6 Amount 3",
}


def load(gm):
    s = open(os.path.join(gm, "axel/osTIrusJucePlugin/parameterDescriptions_TI.json")).read()
    ps = []
    for m in re.finditer(r'\{\s*"page"\s*:\s*\d+[^{}]*\}', s):
        ps.append(json.loads(re.sub(r",\s*\}", "}", m.group(0))))
    i = s.index('"valuelists"')
    k = s.index("{", i)
    depth, e, ins, q = 0, k, False, None
    while True:
        c = s[e]
        if ins:
            if c == "\\":
                e += 1
            elif c == q:
                ins = False
        elif c in "\"'":
            ins, q = True, c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        e += 1
    t = s[k:e + 1].replace("'\"'", '"\\""')
    t = re.sub(r"'([^'\\]|\\.)'", lambda m: json.dumps(m.group(0)[1:-1]), t)
    out, j, ins = [], 0, False
    while j < len(t):
        c = t[j]
        if ins:
            out.append(c)
            if c == "\\":
                out.append(t[j + 1])
                j += 1
            elif c == '"':
                ins = False
        elif c == '"':
            ins = True
            out.append(c)
        elif t.startswith("//", j):
            while j < len(t) and t[j] != "\n":
                j += 1
            continue
        else:
            out.append(c)
        j += 1
    vl = json.loads(re.sub(r",(\s*[\]}])", r"\1", "".join(out)))
    return ps, vl


def texts(vl, name, lo, hi):
    v = vl.get(name)
    if v is None:
        return None
    if isinstance(v, dict):
        return [str(v.get(str(i), "-")).strip() or "-" for i in range(lo, hi + 1)]
    return [(str(v[i]).strip() if i < len(v) else str(i)) or "-" for i in range(lo, hi + 1)]


def k_of(name):
    return key_of(name)


def key_of(name):
    k = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return k[:40]


def c_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    gm = sys.argv[1]
    ps, vl = load(gm)
    by = {}
    for p in ps:
        by.setdefault(p["name"], p)
    pages = {"A": 0x70, "B": 0x71, "6E": 0x6E, "6F": 0x6F}
    order = {0x70: 0, 0x71: 1, 0x6E: 2, 0x6F: 3}
    params, keys, lists, rows = [], {}, {}, []
    for comp, label, names in LAYOUT:
        row = []
        for n in names:
            if n.startswith("soft"):
                row.append(n)
                if n not in keys:
                    keys[n] = len(params)
                    params.append({"key": n, "name": "Soft Knob " + n[-1], "kind": "soft"})
                continue
            p = by.get(n)
            if p is None:
                sys.exit("not in the descriptions: %r" % n)
            k = key_of(n)
            row.append(k)
            if k in keys:
                continue
            lo, hi, tt = int(p["min"]), int(p["max"]), p.get("toText")
            e = {"key": k, "name": NAMES.get(k_of(n), SHORT.get(n, n).strip()[:28]), "page": p["page"],
                 "index": p["index"], "min": lo, "max": hi, "kind": "int", "offset": 0, "list": None}
            # a list to choose from is an enum while it is short; a long one
            # (a send level in dB, 124 destinations) is turned through as a
            # number that shows its text: an enum steps one option a gesture
            if p.get("isBool") or (p["isDiscrete"] and tt not in PLAIN and tt not in OFFSET64 and hi - lo < 32):
                e["kind"] = "enum"
                e["list"] = texts(vl, tt, lo, hi) if tt else (["Off", "On"] if hi - lo == 1 else [str(i) for i in range(lo, hi + 1)])
            elif tt in OFFSET64:
                e["offset"] = 64
            elif tt not in PLAIN:
                e["kind"] = "labels"
                e["list"] = texts(vl, tt, lo, hi)
            if e["list"] is not None:
                lk = json.dumps(e["list"])
                lists.setdefault(lk, len(lists))
                e["list_id"] = lists[lk]
            keys[k] = len(params)
            params.append(e)
        rows.append((comp, label, row))
    # the Soft Knobs' targets: what each destination value points at
    soft = []
    for i, n in enumerate(vl["softknobTargets"]):
        p = by.get(n) if n else None
        soft.append((order[p["page"]] * 128 + p["index"]) if p and p["page"] in order else -1)
    names = [str(x) for x in vl["softknobName"]]
    out = ["// Generated by tools/gen_params.py from gearmulator's parameterDescriptions_TI.json. Do not edit.",
           "#pragma once", "#include <cstdint>", "", "namespace ti {", ""]
    out.append("enum Kind { kInt, kEnum, kLabels, kSoft };")
    out.append("struct Param { const char *key, *name; int16_t off; int16_t min, max, offset; uint8_t kind; int16_t list; };")
    out.append("// off: the byte in the 512-byte single (page A 0, B 128, 6E 256, 6F 384, plus the index)")
    out.append("")
    for lk, li in sorted(lists.items(), key=lambda x: x[1]):
        L = json.loads(lk)
        out.append("static const char *const L%d[] = {%s};" % (li, ", ".join(c_str(x) for x in L)))
    out.append("static const char *const *const kLists[] = {%s};" % ", ".join("L%d" % i for i in range(len(lists))))
    out.append("static const int kListLen[] = {%s};" % ", ".join(str(len(json.loads(lk))) for lk, _ in sorted(lists.items(), key=lambda x: x[1])))
    out.append("")
    out.append("static const Param kParams[] = {")
    for e in params:
        if e["kind"] == "soft":
            out.append("    {%s, %s, -1, 0, 127, 0, kSoft, -1}," % (c_str(e["key"]), c_str(e["name"])))
            continue
        off = order[e["page"]] * 128 + e["index"]
        kind = {"int": "kInt", "enum": "kEnum", "labels": "kLabels"}[e["kind"]]
        out.append("    {%s, %s, %d, %d, %d, %d, %s, %d}," % (c_str(e["key"]), c_str(e["name"]), off, e["min"], e["max"], e["offset"], kind,
                                                           e.get("list_id", -1)))
    out.append("};")
    out.append("static const int kNumParams = %d;" % len(params))
    out.append("")
    out.append("// the pages: compartment, label, eight keys at most")
    out.append("struct Page { const char *comp, *label; const char *keys[8]; };")
    out.append("static const Page kPages[] = {")
    for comp, label, row in rows:
        out.append("    {%s, %s, {%s}}," % (c_str(comp), c_str(label), ", ".join(c_str(k) for k in row)))
    out.append("};")
    out.append("static const int kNumPages = %d;" % len(rows))
    out.append("")
    out.append("// a Soft Knob's destination value -> the byte of the single it moves (-1 none)")
    out.append("static const int16_t kSoftTarget[128] = {%s};" % ", ".join(str(x) for x in soft))
    out.append("// a Soft Knob's name value -> its name")
    out.append("static const char *const kSoftName[] = {%s};" % ", ".join(c_str(x) for x in names))
    out.append("static const int kNumSoftNames = %d;" % len(names))
    out.append("// the bytes the Soft Knobs are set up by: destinations (1, 2, 3) and names (1, 2, 3)")
    out.append("static const int kSoftDestOff[3] = {%d, %d, %d};" % (1 * 128 + 62, 1 * 128 + 63, 2 * 128 + 28))
    out.append("static const int kSoftNameOff[3] = {%d, %d, %d};" % (1 * 128 + 51, 1 * 128 + 52, 1 * 128 + 53))
    out.append("// patch name (B 112..121) and category (B 123, 124)")
    out.append("static const int kNameOff = %d, kCat1Off = %d, kCat2Off = %d;" % (1 * 128 + 112, 1 * 128 + 123, 1 * 128 + 124))
    out.append("static const char *const kCategory[] = {%s};" % ", ".join(c_str(str(x)) for x in vl["category"]))
    out.append("static const int kNumCategories = %d;" % len(vl["category"]))
    out.append("// the page a byte of the single is sent on")
    out.append("static const uint8_t kPageCode[4] = {0x70, 0x71, 0x6e, 0x6f};")
    out.append("")
    out.append("} // namespace ti")
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, "..", "dsp", "ti_params.h"), "w").write("\n".join(out) + "\n")
    print("%d parameters on %d pages, %d value lists" % (len(params), len(rows), len(lists)))


main()
