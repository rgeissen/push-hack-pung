#!/usr/bin/env python3
"""Writes dsp/vivace_params.h and the page list in push_ui.js: Vivace's
parameters, from the engine's own parameter definitions and the layout below.
Run when either changes:

    tools/gen_params.py [tools/engine_params.json]

engine_params.json is what the engine says of its parameters
(`vivace-export params <file>`: every parameter's range, scale, display
multiply and offset, units, option names, as its source tables have them;
docs/NATIVE-MODULES.md, Vivace). Nothing about the synth is typed twice:
a parameter is named here by its key, and its range and the texts of its
values come from there.

How a parameter reaches Pung (chain_params):
  enum   a list the engine names (filter model, LFO mode): the index; the
         engine value is min + index
  int    a whole number the engine counts (transpose, unison voices)
  pos    a continuous knob: its position, 0..128 (or -64..64 where the knob
         has a middle), the engine's value min + (max - min) * position; each
         whole position named as the engine displays it (value_lists), so
         cutoffs read in Hz and times in seconds, never as raw numbers
  raw    the engine's value itself (a wavetable's frame, 0..256)
  type   Vivace's own: a filter's model and style in one list, as the
         synth's own menu offers them

THE LIST IS FIXED ONCE RELEASED (docs/NATIVE-MODULES.md, rule 6): Live keeps
a device by the parameters it had. Live keeps the first pages only, whole
(fitLive, src/devices.go), so those are the ones a player reaches for, full
and repeating nothing. LIVE_PAGES is the 15 that fit Live's 128 entries
(with "Device On"); a Pung that gives Live more pages keeps these first.
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "engine_params.json")

MAX_VOICES = 16  # the polyphony's top: measured on a Push 3 (docs/NATIVE-MODULES.md, Vivace)

# ---- names --------------------------------------------------------------------
# (suffix, short name): a group's parameters, named as the synth's panel names
# them; the full name is the group's prefix and the short one ("Osc 1 Frame").
OSC = {
    "on": "On", "transpose": "Pitch", "tune": "Fine", "wave_frame": "Frame", "spectral_morph_amount": "Spectral",
    "distortion_amount": "Warp", "unison_voices": "Unison", "unison_detune": "Detune", "level": "Level", "pan": "Pan",
    "destination": "Output", "spectral_morph_type": "Spec Mode", "spectral_morph_spread": "Spec Spread",
    "distortion_type": "Warp Mode", "distortion_spread": "Warp Spread", "distortion_phase": "Warp Phase",
    "phase": "Phase", "random_phase": "Rand Phase", "unison_blend": "Blend", "stereo_spread": "Stereo",
    "frame_spread": "Frame Spread", "stack_style": "Stack", "detune_power": "Det Power", "detune_range": "Det Range",
    "spectral_unison": "Spec Unison", "smooth_interpolation": "Smooth", "midi_track": "Key Track",
}
SAMPLE = {"on": "On", "level": "Level", "pan": "Pan", "transpose": "Pitch", "tune": "Fine", "keytrack": "Key Track",
          "loop": "Loop", "bounce": "Bounce", "random_phase": "Rand Phase", "destination": "Output"}
FILTER = {
    "on": "On", "type": "Type", "cutoff": "Cutoff", "resonance": "Reso", "drive": "Drive", "blend": "Blend",
    "keytrack": "Key Track", "mix": "Mix", "filter_input": "Serial", "formant_x": "Formant X", "formant_y": "Formant Y",
    "formant_transpose": "Formant Tr", "formant_resonance": "Formant Res", "formant_spread": "Formant Spr",
    "blend_transpose": "Comb Offset",
}
ENV = {"delay": "Delay", "attack": "Attack", "hold": "Hold", "decay": "Decay", "sustain": "Sustain", "release": "Release",
       "attack_power": "A Curve", "decay_power": "D Curve", "release_power": "R Curve"}
LFO = {"sync": "Sync", "frequency": "Rate", "tempo": "Tempo", "sync_type": "Mode", "phase": "Phase", "fade_time": "Fade In",
       "delay_time": "Delay", "stereo": "Stereo", "smooth_mode": "Smooth Mode", "smooth_time": "Smooth",
       "keytrack_transpose": "Key Trans", "keytrack_tune": "Key Tune"}
RANDOM = {"style": "Style", "sync": "Sync", "frequency": "Rate", "tempo": "Tempo", "stereo": "Stereo", "sync_type": "Key Sync"}

GLOBAL = {
    "macro_control_1": ("Macro 1", "Macro 1"), "macro_control_2": ("Macro 2", "Macro 2"),
    "macro_control_3": ("Macro 3", "Macro 3"), "macro_control_4": ("Macro 4", "Macro 4"),
    "volume": ("Volume", "Volume"), "velocity_track": ("Velocity", "Velocity"),
    "portamento_time": ("Glide", "Glide"), "pitch_bend_range": ("Bend Range", "Bend Range"),
    "polyphony": ("Voices", "Voices"), "voice_priority": ("Priority", "Priority"), "voice_override": ("Steal", "Steal"),
    "legato": ("Legato", "Legato"), "portamento_slope": ("Glide Slope", "Slope"), "portamento_force": ("Glide Always", "Always"),
    "portamento_scale": ("Glide Scale", "Scale"), "voice_tune": ("Tune", "Tune"), "voice_transpose": ("Transpose", "Transpose"),
    "voice_amplitude": ("Voice Level", "Voice Level"), "stereo_mode": ("Stereo Mode", "Stereo Mode"),
    "stereo_routing": ("Stereo Width", "Width"), "oversampling": ("Quality", "Quality"), "mpe_enabled": ("MPE", "MPE"),
}
FX = {  # effect parameters: (name, short)
    "chorus_on": ("Chorus On", "On"), "chorus_dry_wet": ("Chorus Mix", "Mix"), "chorus_voices": ("Chorus Voices", "Voices"),
    "chorus_sync": ("Chorus Sync", "Sync"), "chorus_frequency": ("Chorus Rate", "Rate"), "chorus_tempo": ("Chorus Tempo", "Tempo"),
    "chorus_mod_depth": ("Chorus Depth", "Depth"), "chorus_feedback": ("Chorus Fdbk", "Feedback"),
    "chorus_delay_1": ("Chorus Dly 1", "Delay 1"), "chorus_delay_2": ("Chorus Dly 2", "Delay 2"),
    "chorus_cutoff": ("Chorus Cutoff", "Cutoff"), "chorus_spread": ("Chorus Spread", "Spread"),
    "delay_on": ("Delay On", "On"), "delay_dry_wet": ("Delay Mix", "Mix"), "delay_feedback": ("Delay Fdbk", "Feedback"),
    "delay_style": ("Delay Style", "Style"), "delay_sync": ("Delay Sync", "Sync"), "delay_frequency": ("Delay Time", "Time"),
    "delay_tempo": ("Delay Tempo", "Tempo"), "delay_filter_cutoff": ("Delay Cutoff", "Cutoff"),
    "delay_filter_spread": ("Delay Spread", "Spread"), "delay_aux_sync": ("Delay Sync R", "Sync R"),
    "delay_aux_frequency": ("Delay Time R", "Time R"), "delay_aux_tempo": ("Delay Tempo R", "Tempo R"),
    "reverb_on": ("Reverb On", "On"), "reverb_dry_wet": ("Reverb Mix", "Mix"), "reverb_decay_time": ("Reverb Decay", "Decay"),
    "reverb_size": ("Reverb Size", "Size"), "reverb_delay": ("Reverb Pre", "Pre Delay"),
    "reverb_pre_low_cutoff": ("Reverb Low Cut", "Low Cut"), "reverb_pre_high_cutoff": ("Reverb High Cut", "High Cut"),
    "reverb_chorus_amount": ("Reverb Chorus", "Chorus"), "reverb_chorus_frequency": ("Reverb Ch Rate", "Chorus Rate"),
    "reverb_low_shelf_cutoff": ("Reverb Low Frq", "Low Freq"), "reverb_low_shelf_gain": ("Reverb Low dB", "Low Gain"),
    "reverb_high_shelf_cutoff": ("Reverb High Frq", "High Freq"), "reverb_high_shelf_gain": ("Reverb High dB", "High Gain"),
    "distortion_on": ("Dist On", "On"), "distortion_type": ("Dist Type", "Type"), "distortion_drive": ("Dist Drive", "Drive"),
    "distortion_mix": ("Dist Mix", "Mix"), "distortion_filter_order": ("Dist Filter", "Filter"),
    "distortion_filter_cutoff": ("Dist Cutoff", "Cutoff"), "distortion_filter_resonance": ("Dist Reso", "Reso"),
    "distortion_filter_blend": ("Dist Blend", "Blend"),
    "compressor_on": ("Comp On", "On"), "compressor_enabled_bands": ("Comp Bands", "Bands"), "compressor_mix": ("Comp Mix", "Mix"),
    "compressor_attack": ("Comp Attack", "Attack"), "compressor_release": ("Comp Release", "Release"),
    "compressor_low_gain": ("Comp Low Gain", "Low Gain"), "compressor_band_gain": ("Comp Mid Gain", "Mid Gain"),
    "compressor_high_gain": ("Comp High Gain", "High Gain"),
    "compressor_low_upper_threshold": ("Comp Low Up", "Low Up"), "compressor_band_upper_threshold": ("Comp Mid Up", "Mid Up"),
    "compressor_high_upper_threshold": ("Comp High Up", "High Up"), "compressor_low_lower_threshold": ("Comp Low Dn", "Low Down"),
    "compressor_band_lower_threshold": ("Comp Mid Dn", "Mid Down"), "compressor_high_lower_threshold": ("Comp High Dn", "High Down"),
    "compressor_low_upper_ratio": ("Comp Low UpR", "Low Up R"), "compressor_band_upper_ratio": ("Comp Mid UpR", "Mid Up R"),
    "compressor_high_upper_ratio": ("Comp High UpR", "High Up R"), "compressor_low_lower_ratio": ("Comp Low DnR", "Low Dn R"),
    "compressor_band_lower_ratio": ("Comp Mid DnR", "Mid Dn R"), "compressor_high_lower_ratio": ("Comp High DnR", "High Dn R"),
    "eq_on": ("EQ On", "On"), "eq_low_cutoff": ("EQ Low Freq", "Low Freq"), "eq_low_gain": ("EQ Low Gain", "Low Gain"),
    "eq_band_cutoff": ("EQ Mid Freq", "Mid Freq"), "eq_band_gain": ("EQ Mid Gain", "Mid Gain"),
    "eq_high_cutoff": ("EQ High Freq", "High Freq"), "eq_high_gain": ("EQ High Gain", "High Gain"),
    "eq_band_resonance": ("EQ Mid Q", "Mid Q"), "eq_low_mode": ("EQ Low Mode", "Low Mode"),
    "eq_low_resonance": ("EQ Low Q", "Low Q"), "eq_band_mode": ("EQ Mid Mode", "Mid Mode"),
    "eq_high_mode": ("EQ High Mode", "High Mode"), "eq_high_resonance": ("EQ High Q", "High Q"),
    "flanger_on": ("Flanger On", "On"), "flanger_dry_wet": ("Flanger Mix", "Mix"), "flanger_feedback": ("Flanger Fdbk", "Feedback"),
    "flanger_sync": ("Flanger Sync", "Sync"), "flanger_frequency": ("Flanger Rate", "Rate"), "flanger_tempo": ("Flanger Tempo", "Tempo"),
    "flanger_center": ("Flanger Center", "Center"), "flanger_mod_depth": ("Flanger Depth", "Depth"),
    "flanger_phase_offset": ("Flanger Offset", "Flg Offset"),
    "phaser_on": ("Phaser On", "On"), "phaser_dry_wet": ("Phaser Mix", "Mix"), "phaser_feedback": ("Phaser Fdbk", "Feedback"),
    "phaser_sync": ("Phaser Sync", "Sync"), "phaser_frequency": ("Phaser Rate", "Rate"), "phaser_tempo": ("Phaser Tempo", "Tempo"),
    "phaser_center": ("Phaser Center", "Center"), "phaser_mod_depth": ("Phaser Depth", "Depth"),
    "phaser_blend": ("Phaser Blend", "Phs Blend"), "phaser_phase_offset": ("Phaser Offset", "Phs Offset"),
}


def name_of(key):
    """(name, short) of a parameter key."""
    m = re.match(r"osc_(\d)_(.+)$", key)
    if m:
        return "Osc %s %s" % (m.group(1), OSC[m.group(2)]), OSC[m.group(2)]
    m = re.match(r"sample_(.+)$", key)
    if m and m.group(1) in SAMPLE:
        return "Sample " + SAMPLE[m.group(1)], SAMPLE[m.group(1)]
    m = re.match(r"filter_(\d|fx)_(.+)$", key)
    if m:
        p = "FX Filter" if m.group(1) == "fx" else "Filter " + m.group(1)
        s = FILTER[m.group(2)]
        if m.group(2) == "filter_input":
            s = "From Flt %d" % (3 - int(m.group(1)))
        return "%s %s" % (p, s), s
    m = re.match(r"env_(\d)_(.+)$", key)
    if m:
        return "Env %s %s" % (m.group(1), ENV[m.group(2)]), ENV[m.group(2)]
    m = re.match(r"lfo_(\d)_(.+)$", key)
    if m:
        return "LFO %s %s" % (m.group(1), LFO[m.group(2)]), LFO[m.group(2)]
    m = re.match(r"random_(\d)_(.+)$", key)
    if m:
        return "Random %s %s" % (m.group(1), RANDOM[m.group(2)]), RANDOM[m.group(2)]
    m = re.match(r"modulation_(\d+)_amount$", key)
    if m:
        return "Mod %s Amount" % m.group(1), "Mod %s" % m.group(1)
    if key in GLOBAL:
        return GLOBAL[key]
    if key in FX:
        return FX[key]
    raise SystemExit("no name for " + key)


# ---- the layout -----------------------------------------------------------------
# (compartment, page label, [keys]). The first 15 pages are what Live keeps.
def osc_main(n):
    return ["osc_%d_%s" % (n, s) for s in ("transpose", "tune", "wave_frame", "spectral_morph_amount", "distortion_amount",
                                           "unison_voices", "unison_detune", "level")]


def osc_shape(n):
    return ["osc_%d_%s" % (n, s) for s in ("spectral_morph_type", "spectral_morph_spread", "distortion_type",
                                           "distortion_spread", "distortion_phase", "phase", "random_phase", "pan")]


def osc_unison(n):
    return ["osc_%d_%s" % (n, s) for s in ("unison_blend", "stereo_spread", "frame_spread", "stack_style", "detune_power",
                                           "detune_range", "spectral_unison", "smooth_interpolation")]


def flt(n):
    return ["filter_%s_%s" % (n, s) for s in ("on", "type", "cutoff", "resonance", "drive", "blend", "keytrack", "mix")]


def flt_more(n):
    keys = ["filter_%s_%s" % (n, s) for s in ("formant_x", "formant_y", "formant_transpose", "formant_resonance",
                                              "formant_spread", "blend_transpose")]
    return (["filter_%s_filter_input" % n] if n != "fx" else []) + keys


def env(n):
    return ["env_%d_%s" % (n, s) for s in ("attack", "hold", "decay", "sustain", "release", "attack_power", "decay_power",
                                           "release_power")]


def lfo(n):
    return ["lfo_%d_%s" % (n, s) for s in ("sync", "frequency", "tempo", "sync_type", "phase", "fade_time", "delay_time",
                                           "stereo")]


def lfo_more(a, b):
    return ["lfo_%d_%s" % (n, s) for n in (a, b) for s in ("smooth_mode", "smooth_time", "keytrack_transpose", "keytrack_tune")]


def rnd(n):
    return ["random_%d_%s" % (n, s) for s in ("style", "sync", "frequency", "tempo", "stereo", "sync_type")]


LAYOUT = [
    # Live's: the pages a player reaches for
    ("play", "Play", ["macro_control_1", "macro_control_2", "macro_control_3", "macro_control_4", "volume", "velocity_track",
                      "portamento_time", "pitch_bend_range"]),
    ("osc", "Osc 1", osc_main(1)),
    ("osc", "Osc 2", osc_main(2)),
    ("osc", "Osc 3", osc_main(3)),
    ("osc", "Sources", ["osc_1_on", "osc_2_on", "osc_3_on", "sample_on", "osc_1_destination", "osc_2_destination",
                        "osc_3_destination", "sample_destination"]),
    ("filter", "Filter 1", flt(1)),
    ("filter", "Filter 2", flt(2)),
    ("env", "Env 1", env(1)),
    ("env", "Env 2", env(2)),
    ("env", "Env 3", env(3)),
    ("lfo", "LFO 1", lfo(1)),
    ("lfo", "LFO 2", lfo(2)),
    ("fx", "Chorus", ["chorus_on", "chorus_dry_wet", "chorus_voices", "chorus_sync", "chorus_frequency", "chorus_tempo",
                      "chorus_mod_depth", "chorus_feedback"]),
    ("fx", "Delay", ["delay_on", "delay_dry_wet", "delay_feedback", "delay_style", "delay_sync", "delay_frequency",
                     "delay_tempo", "delay_filter_cutoff"]),
    ("fx", "Reverb", ["reverb_on", "reverb_dry_wet", "reverb_decay_time", "reverb_size", "reverb_delay",
                      "reverb_pre_low_cutoff", "reverb_pre_high_cutoff", "reverb_chorus_amount"]),
    # Pung's view reaches the rest
    ("osc", "Osc 1 Shape", osc_shape(1)),
    ("osc", "Osc 2 Shape", osc_shape(2)),
    ("osc", "Osc 3 Shape", osc_shape(3)),
    ("osc", "Osc 1 Unison", osc_unison(1)),
    ("osc", "Osc 2 Unison", osc_unison(2)),
    ("osc", "Osc 3 Unison", osc_unison(3)),
    ("osc", "Sample", ["sample_level", "sample_pan", "sample_transpose", "sample_tune", "sample_keytrack", "sample_loop",
                       "sample_bounce", "sample_random_phase"]),
    ("osc", "Key Track", ["osc_1_midi_track", "osc_2_midi_track", "osc_3_midi_track"]),
    ("filter", "Filter 1 +", flt_more(1)),
    ("filter", "Filter 2 +", flt_more(2)),
    ("fx", "FX Filter", flt("fx")),
    ("fx", "FX Filter +", flt_more("fx")),
    ("env", "Env 4", env(4)),
    ("env", "Env 5", env(5)),
    ("env", "Env 6", env(6)),
    ("env", "Env Delay", ["env_%d_delay" % n for n in range(1, 7)]),
    ("lfo", "LFO 3", lfo(3)),
    ("lfo", "LFO 4", lfo(4)),
    ("lfo", "LFO 5", lfo(5)),
    ("lfo", "LFO 6", lfo(6)),
    ("lfo", "LFO 7", lfo(7)),
    ("lfo", "LFO 8", lfo(8)),
    ("lfo", "LFO 1+2 +", lfo_more(1, 2)),
    ("lfo", "LFO 3+4 +", lfo_more(3, 4)),
    ("lfo", "LFO 5+6 +", lfo_more(5, 6)),
    ("lfo", "LFO 7+8 +", lfo_more(7, 8)),
    ("lfo", "Random 1", rnd(1)),
    ("lfo", "Random 2", rnd(2)),
    ("lfo", "Random 3", rnd(3)),
    ("lfo", "Random 4", rnd(4)),
    ("fx", "Chorus +", ["chorus_delay_1", "chorus_delay_2", "chorus_cutoff", "chorus_spread"]),
    ("fx", "Delay +", ["delay_filter_spread", "delay_aux_sync", "delay_aux_frequency", "delay_aux_tempo"]),
    ("fx", "Reverb +", ["reverb_low_shelf_cutoff", "reverb_low_shelf_gain", "reverb_high_shelf_cutoff",
                        "reverb_high_shelf_gain", "reverb_chorus_frequency"]),
    ("fx", "Distortion", ["distortion_on", "distortion_type", "distortion_drive", "distortion_mix", "distortion_filter_order",
                          "distortion_filter_cutoff", "distortion_filter_resonance", "distortion_filter_blend"]),
    ("fx", "Compressor", ["compressor_on", "compressor_enabled_bands", "compressor_mix", "compressor_attack",
                          "compressor_release", "compressor_low_gain", "compressor_band_gain", "compressor_high_gain"]),
    ("fx", "Comp Levels", ["compressor_low_upper_threshold", "compressor_band_upper_threshold",
                           "compressor_high_upper_threshold", "compressor_low_lower_threshold",
                           "compressor_band_lower_threshold", "compressor_high_lower_threshold"]),
    ("fx", "Comp Ratios", ["compressor_low_upper_ratio", "compressor_band_upper_ratio", "compressor_high_upper_ratio",
                           "compressor_low_lower_ratio", "compressor_band_lower_ratio", "compressor_high_lower_ratio"]),
    ("fx", "EQ", ["eq_on", "eq_low_cutoff", "eq_low_gain", "eq_band_cutoff", "eq_band_gain", "eq_high_cutoff", "eq_high_gain",
                  "eq_band_resonance"]),
    ("fx", "EQ +", ["eq_low_mode", "eq_low_resonance", "eq_band_mode", "eq_high_mode", "eq_high_resonance"]),
    ("fx", "Flanger", ["flanger_on", "flanger_dry_wet", "flanger_feedback", "flanger_sync", "flanger_frequency",
                       "flanger_tempo", "flanger_center", "flanger_mod_depth"]),
    ("fx", "Phaser", ["phaser_on", "phaser_dry_wet", "phaser_feedback", "phaser_sync", "phaser_frequency", "phaser_tempo",
                      "phaser_center", "phaser_mod_depth"]),
    ("fx", "Mod FX +", ["phaser_blend", "phaser_phase_offset", "flanger_phase_offset"]),
    ("matrix", "Matrix 1-8", ["modulation_%d_amount" % n for n in range(1, 9)]),
    ("matrix", "Matrix 9-16", ["modulation_%d_amount" % n for n in range(9, 17)]),
    ("voice", "Voice", ["polyphony", "voice_priority", "voice_override", "legato", "portamento_slope", "portamento_force",
                        "portamento_scale", "voice_tune"]),
    ("voice", "Voice +", ["voice_transpose", "voice_amplitude", "stereo_mode", "stereo_routing", "oversampling",
                          "mpe_enabled"]),
]
LIVE_PAGES = 15

# ---- the texts ------------------------------------------------------------------
DEST = ["Filter 1", "Filter 2", "Filter 1+2", "Effects", "Direct Out", "Chorus", "Compressor", "Delay", "Distortion",
        "EQ", "FX Filter", "Flanger", "Phaser", "Reverb"]
FILTER_STYLES = [  # (model, its styles), as the synth's own filter menu offers them
    ("Analog", ["12dB", "24dB", "Notch Blend", "Notch Spread", "B/P/N"]),
    ("Dirty", ["12dB", "24dB", "Notch Blend", "Notch Spread", "B/P/N"]),
    ("Ladder", ["12dB", "24dB", "Notch Blend", "Notch Spread", "B/P/N"]),
    ("Digital", ["12dB", "24dB", "Notch Blend", "Notch Spread", "B/P/N"]),
    ("Diode", ["Low Shelf", "Low Cut"]),
    ("Formant", ["AOIE", "AIUO"]),
    ("Comb", ["Low High Comb", "Low High Flange+", "Low High Flange-", "Band Spread Comb", "Band Spread Flange+",
              "Band Spread Flange-"]),
    ("Phaser", ["Positive", "Negative"]),
]
FILTER_TYPES = [(mi, si, "%s %s" % (m, s)) for mi, (m, ss) in enumerate(FILTER_STYLES) for si, s in enumerate(ss)]


def hz(f):
    if f < 1:
        return "%.3f Hz" % f
    if f < 10:
        return "%.2f Hz" % f
    if f < 100:
        return "%.1f Hz" % f
    return "%.0f Hz" % f if f < 1000 else ("%.2f kHz" % (f / 1000) if f < 10000 else "%.1f kHz" % (f / 1000))


def secs(s):
    if s < 0.001:
        return "%.2f ms" % (s * 1000)
    if s < 0.01:
        return "%.1f ms" % (s * 1000)
    if s < 1:
        return "%.0f ms" % (s * 1000)
    if s < 10:
        return "%.2f s" % s
    return "%.1f s" % s


def adjusted(d, v):
    sc = d["scale"]  # 0 indexed, 1 linear, 2 quadratic, 3 cubic, 4 quartic, 5 square root, 6 exponential
    a = v
    if sc == 2:
        a = v * v
    elif sc == 3:
        a = v * v * v
    elif sc == 4:
        a = v ** 4
    elif sc == 5:
        a = math.sqrt(max(v, 0))
    elif sc == 6:
        a = 2.0 ** v
    a += d["post_offset"]
    if d["invert"]:
        a = 1.0 / a if a else float("inf")
    return a * d["display_multiply"]


def text(key, d, v, bipolar):
    """The engine's value v of parameter d, as the synth displays it."""
    u = d["units"].strip()
    if (key.endswith("cutoff") or key.endswith("center")) and d["max"] >= 100:
        return hz(440.0 * 2 ** ((v - 69) / 12.0))  # a frequency: the synth shows it in Hz
    a = adjusted(d, v)
    sign = "+" if bipolar and a > 0.0005 else ""
    if u == "secs":
        return secs(a)
    if u == "ms":
        return secs(a / 1000.0)
    if u == "dB":
        return "%s%.1f dB" % ("+" if a > 0.05 and d["min"] < 0 else "", a)
    if u == "cents":
        return "%s%.0f ct" % (sign, a)
    if u == "Hz":
        return hz(a)
    if key.endswith("_tune"):  # a voice's fine tuning, -1..1 of a semitone
        return "%s%.0f ct" % (sign, a * (100 if d["display_multiply"] == 1 else 1))
    if u == "semitones" or key.endswith("detune_range") or key.endswith("formant_transpose"):
        return "%s%.1f st" % (sign, a)
    if (key.endswith("phase") or key.endswith("phase_offset")) and u != "%":
        return "%.0f deg" % (a * 360 if d["display_multiply"] == 1 else a)
    if u == "%" or (u == "" and d["display_multiply"] == 100):
        return "%s%.0f%%" % (sign, a)
    if u == "" and d["display_multiply"] == 1 and -1 <= d["min"] and d["max"] <= 1:
        return "%s%.0f%%" % (sign, a * 100)  # a share: shown as one
    if d["max"] - d["min"] >= 50:
        return "%s%.0f" % (sign, a)
    if abs(a) >= 10:
        return "%s%.1f" % (sign, a)
    return "%s%.2f" % (sign, a)


def main():
    det = {p["key"]: p for p in json.load(open(SRC))}
    lists, list_idx = [], {}

    def list_of(items):
        t = tuple(items)
        if t not in list_idx:
            list_idx[t] = len(lists)
            lists.append(list(t))
        return list_idx[t]

    params, seen = [], set()
    for comp, label, keys in LAYOUT:
        assert len(keys) <= 8, label
        for k in keys:
            if k in seen:
                raise SystemExit("%s twice (%s)" % (k, label))
            seen.add(k)
            name, short = name_of(k)
            if k.endswith("_type") and k.startswith("filter_"):
                pre = k[:-5]
                params.append(dict(key=k, engine=pre, name=name, short=short, kind="type", lo=0, hi=0,
                                   pmin=0, pmax=len(FILTER_TYPES) - 1, list=list_of(t[2] for t in FILTER_TYPES), unit=""))
                continue
            d = det[k]
            lo, hi = d["min"], d["max"]
            p = dict(key=k, engine=k, name=name, short=short, lo=lo, hi=hi, unit="")
            if d["scale"] == 0 and (d.get("options") or k.endswith("destination")):
                opts = d.get("options") or []
                if k.endswith("destination"):
                    opts = DEST
                if re.match(r"osc_\d_distortion_type$", k):
                    n = int(k[4])
                    others = [o for o in (1, 2, 3) if o != n]
                    opts = list(opts)
                    opts[7], opts[8] = "FM <- Osc %d" % others[0], "FM <- Osc %d" % others[1]
                    opts[10], opts[11] = "RM <- Osc %d" % others[0], "RM <- Osc %d" % others[1]
                if k == "stereo_mode":
                    opts = ["Spread", "Rotate"]
                opts = list(opts)[int(lo):int(hi) + 1]
                p.update(kind="enum", pmin=0, pmax=len(opts) - 1, list=list_of(opts))
            elif d["scale"] == 0:
                if k == "polyphony":
                    hi = p["hi"] = MAX_VOICES
                p.update(kind="int", pmin=int(lo), pmax=int(hi), list=-1)
                if d["display_multiply"] != 1:
                    p["list"] = list_of(str(int(round(v * d["display_multiply"]))) for v in range(int(lo), int(hi) + 1))
                elif d["units"].strip() in ("voices", "v"):
                    p["unit"] = "v"
            elif k.endswith("wave_frame"):
                p.update(kind="raw", pmin=lo, pmax=hi, list=-1)
            else:
                bip = lo < 0 and abs(lo + hi) < 1e-6
                pmin, pmax = (-64, 64) if bip else (0, 128)
                labs = []
                for i in range(pmin, pmax + 1):
                    v = lo + (hi - lo) * (i - pmin) / float(pmax - pmin)
                    labs.append(text(k, d, v, bip))
                p.update(kind="pos", pmin=pmin, pmax=pmax, list=list_of(labs))
            params.append(p)

    # ---- dsp/vivace_params.h
    def cs(s):
        return '"%s"' % s.replace("\\", "\\\\").replace('"', '\\"')

    def cf(x):
        t = "%.9g" % x
        if "." not in t and "e" not in t:
            t += ".0"
        return t + "f"

    kinds = {"enum": "kEnum", "int": "kInt", "pos": "kPos", "raw": "kRaw", "type": "kType"}
    o = ["// Generated by tools/gen_params.py from tools/engine_params.json (the engine's own parameter",
         "// definitions) and the layout in gen_params.py. Do not edit.", "#pragma once", "#include <cstdint>", "",
         "namespace vv {", "",
         "enum Kind { kEnum, kInt, kPos, kRaw, kType };",
         "// key: Pung's; engine: the engine's control (a type: the filter's prefix). lo, hi: the engine's range;",
         "// pmin, pmax: Pung's. list: the options (enum, type) or each position's text (pos, some ints), -1 none.",
         "struct Param { const char *key, *engine, *name, *short_; uint8_t kind; float lo, hi, pmin, pmax; int16_t list; const char *unit; };",
         "struct Page { const char *comp, *label; const char *keys[8]; };", ""]
    for i, l in enumerate(lists):
        o.append("static const char *const L%d[] = {%s};" % (i, ", ".join(cs(x) for x in l)))
    o.append("static const char *const *const kLists[] = {%s};" % ", ".join("L%d" % i for i in range(len(lists))))
    o.append("static const int kListLen[] = {%s};" % ", ".join(str(len(l)) for l in lists))
    o.append("")
    o.append("static const Param kParams[] = {")
    for p in params:
        o.append("    {%s, %s, %s, %s, %s, %s, %s, %s, %s, %d, %s}," % (
            cs(p["key"]), cs(p["engine"]), cs(p["name"]), cs(p["short"]), kinds[p["kind"]], cf(p["lo"]), cf(p["hi"]),
            cf(p["pmin"]), cf(p["pmax"]), p["list"], cs(p["unit"])))
    o.append("};")
    o.append("static const int kNumParams = %d;" % len(params))
    o.append("")
    o.append("// the filter types (kType): each one's model and style")
    o.append("static const uint8_t kFilterTypeModel[] = {%s};" % ", ".join(str(t[0]) for t in FILTER_TYPES))
    o.append("static const uint8_t kFilterTypeStyle[] = {%s};" % ", ".join(str(t[1]) for t in FILTER_TYPES))
    o.append("static const int kNumFilterTypes = %d;" % len(FILTER_TYPES))
    o.append("")
    o.append("static const Page kPages[] = {")
    for comp, label, keys in LAYOUT:
        ks = [cs(k) for k in keys] + ["nullptr"] * (8 - len(keys))
        o.append("    {%s, %s, {%s}}," % (cs(comp), cs(label), ", ".join(ks)))
    o.append("};")
    o.append("static const int kNumPages = %d;" % len(LAYOUT))
    o.append("static const int kLivePages = %d; // the pages Live keeps (fitLive)" % LIVE_PAGES)
    o.append("static const int kMaxVoices = %d;" % MAX_VOICES)
    o.append("")
    o.append("} // namespace vv")
    open(os.path.join(ROOT, "dsp", "vivace_params.h"), "w").write("\n".join(o) + "\n")

    # ---- push_ui.js: the pages, between the markers
    ui = os.path.join(ROOT, "push_ui.js")
    if os.path.exists(ui):
        s = open(ui).read()
        a, b = s.find("// <pages>"), s.find("// </pages>")
        if a >= 0 and b > a:
            js = ["// <pages> (tools/gen_params.py writes this list: do not edit)", "var PAGES = ["]
            for comp, label, keys in LAYOUT:
                js.append("  {c: %s, label: %s, keys: [%s]}," % (json.dumps(comp), json.dumps(label),
                                                                 ", ".join(json.dumps(k) for k in keys)))
            js.append("];")
            s = s[:a] + "\n".join(js) + "\n" + s[b:]
            open(ui, "w").write(s)
    n_live = sum(len(k) for _, _, k in LAYOUT[:LIVE_PAGES])
    print("%d parameters on %d pages (%d on the %d pages Live keeps), %d value lists" % (
        len(params), len(LAYOUT), n_live, LIVE_PAGES, len(lists)))


main()
