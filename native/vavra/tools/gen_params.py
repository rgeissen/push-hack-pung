#!/usr/bin/env python3
"""Writes dsp/mq_params.h: Vavra's parameters, from gearmulator's own microQ
descriptions (waldi/microq/mqJucePlugin/parameterDescriptions_mq.json) and the
page layout below. Run when either changes:

    tools/gen_params.py <gearmulator source dir>

The layout is the design (docs/NATIVE-MODULES.md, Vavra). Its first
compartment is the microQ's own edit matrix: seven rows, each the eight
parameters the hardware's four knob pairs edit on that row, so the encoders
are the matrix row the panel lights. The other compartments go through each
section in full, eight knobs a page, the same knob doing the same job on
sibling pages (Attack is knob 1 of every envelope, Shape knob 1 of every LFO).

A parameter is named here by its name in the descriptions; its byte, bits,
range and value texts come from there. The effects are the exception: the
microQ reuses one run of bytes for whichever effect a slot holds (Chorus
Speed, Flanger Speed and Reverb Size are all byte 130), so an effect slot has
neutral knobs, "fx1_p1".., and a table per effect type says what each one is.
"""
import json, os, re, sys

# ---- the layout --------------------------------------------------------------------
# (compartment, page label, [parameter names, 8 at most])
LAYOUT = [
    # the edit matrix: the front panel (the hardware's rows, completed to eight)
    ("panel", "Oscillators", ["O1Shape", "O1Octave", "O1Semi", "O1Detune", "O2Shape", "O2Octave", "O2Semi", "O2Detune"]),
    ("panel", "Mixer", ["O1Level", "O2Level", "O3Level", "NoiseLevel", "RingModLevel", "O1Balance", "O2Balance", "FilterRouting"]),
    ("panel", "Filters", ["F1Type", "F1Cutoff", "F1Resonance", "F1EnvMod", "F2Type", "F2Cutoff", "F2Resonance", "F2EnvMod"]),
    ("panel", "Amp / FX", ["AmpVolume", "AmpVelocity", "FX1Type", "FX1Mix", "FX2Type", "FX2Mix", "GlideRate", "UnisonoDetune"]),
    ("panel", "Envelopes", ["FilterEnvAttack", "FilterEnvDecay", "FilterEnvSustain", "FilterEnvRelease",
                            "AmpEnvAttack", "AmpEnvDecay", "AmpEnvSustain", "AmpEnvRelease"]),
    ("panel", "LFOs", ["Lfo1Shape", "Lfo1Speed", "Lfo2Shape", "Lfo2Speed", "Lfo3Shape", "Lfo3Speed", "Lfo1Delay", "Lfo2Delay"]),
    ("panel", "Mod Matrix", ["Slot1SSource", "Slot1SDestination", "Slot1SAmount", "Slot2SSource", "Slot2SDestination", "Slot2SAmount",
                             "Slot1FAmount", "Slot2FAmount"]),

    ("osc", "Osc 1", ["O1Shape", "O1Octave", "O1Semi", "O1Detune", "O1PulseWidth", "O1Pwm", "O1PwmSource", "O1KeyTrack"]),
    ("osc", "Osc 1 FM", ["O1FmSource", "O1FmAmount", "O1SubFreqDiv", "O1SubVolume", "O1BendRange"]),
    ("osc", "Osc 2", ["O2Shape", "O2Octave", "O2Semi", "O2Detune", "O2PulseWidth", "O2Pwm", "O2PwmSource", "O2KeyTrack"]),
    ("osc", "Osc 2 FM", ["O2FmSource", "O2FmAmount", "O2SubFreqDiv", "O2SubVolume", "O2BendRange", "Sync"]),
    ("osc", "Osc 3", ["O3Shape", "O3Octave", "O3Semi", "O3Detune", "O3PulseWidth", "O3Pwm", "O3PwmSource", "O3KeyTrack"]),
    ("osc", "Osc 3 FM", ["O3FmSource", "O3FmAmount", "O3BendRange"]),
    ("osc", "Pitch / Voice", ["PitchModSrc", "PitchModAmount", "GlideEnable", "GlideMode", "GlideRate", "VoiceMode", "UnisonoCount",
                              "UnisonoDetune"]),

    ("mixer", "Mixer", ["O1Level", "O2Level", "O3Level", "NoiseLevel", "RingModLevel", "NoiseModeF1", "NoiseModeF2", "FilterRouting"]),
    ("mixer", "Balance", ["O1Balance", "O2Balance", "O3Balance", "NoiseBalance", "RingModBalance"]),

    ("filter", "Filter 1", ["F1Type", "F1Cutoff", "F1Resonance", "F1Drive", "F1EnvMod", "F1VelMod", "F1KeyTrack", "F1Pan"]),
    ("filter", "Filter 1 Mod", ["F1ModSource", "F1CutoffMod", "F1FmSource", "F1FmAmount", "F1PanModSource", "F1PanMod"]),
    ("filter", "Filter 2", ["F2Type", "F2Cutoff", "F2Resonance", "F2Drive", "F2EnvMod", "F2VelMod", "F2KeyTrack", "F2Pan"]),
    ("filter", "Filter 2 Mod", ["F2ModSource", "F2CutoffMod", "F2FmSource", "F2FmAmount", "F2PanModSource", "F2PanMod"]),
    ("filter", "Amp", ["AmpVolume", "AmpVelocity", "AmpModSource", "AmpModAmount"]),

    ("env", "Filter Env", ["FilterEnvAttack", "FilterEnvAttackLevel", "FilterEnvDecay", "FilterEnvSustain", "FilterEnvDecay2",
                           "FilterEnvSustain2", "FilterEnvRelease", "FilterEnvMode"]),
    ("env", "Amp Env", ["AmpEnvAttack", "AmpEnvAttackLevel", "AmpEnvDecay", "AmpEnvSustain", "AmpEnvDecay2", "AmpEnvSustain2",
                        "AmpEnvRelease", "AmpEnvMode"]),
    ("env", "Env 3", ["Env3Attack", "Env3AttackLevel", "Env3Decay", "Env3Sustain", "Env3Decay2", "Env3Sustain2", "Env3Release",
                      "Env3Mode"]),
    ("env", "Env 4", ["Env4Attack", "Env4AttackLevel", "Env4Decay", "Env4Sustain", "Env4Decay2", "Env4Sustain2", "Env4Release",
                      "Env4Mode"]),
    ("env", "Triggers", ["FilterEnvTriggerMode", "AmpEnvTriggerMode", "Env3TriggerMode", "Env4TriggerMode"]),

    ("fx", "FX 1", ["FX1Type", "FX1Mix", "fx1_p1", "fx1_p2", "fx1_p3", "fx1_p4", "fx1_p5", "fx1_p6"]),
    ("fx", "FX 1 +", ["fx1_p7", "fx1_p8", "fx1_p9", "fx1_p10", "fx1_p11", "fx1_p12", "fx1_p13", "fx1_p14"]),
    ("fx", "FX 2", ["FX2Type", "FX2Mix", "fx2_p1", "fx2_p2", "fx2_p3", "fx2_p4", "fx2_p5", "fx2_p6"]),
    ("fx", "FX 2 +", ["fx2_p7", "fx2_p8", "fx2_p9", "fx2_p10", "fx2_p11", "fx2_p12", "fx2_p13", "fx2_p14"]),

    ("lfo", "LFO 1", ["Lfo1Shape", "Lfo1Speed", "Lfo1Sync", "Lfo1Clocked", "Lfo1StartPhase", "Lfo1Delay", "Lfo1Fade", "Lfo1KeyTrack"]),
    ("lfo", "LFO 2", ["Lfo2Shape", "Lfo2Speed", "Lfo2Sync", "Lfo2Clocked", "Lfo2StartPhase", "Lfo2Delay", "Lfo2Fade", "Lfo2KeyTrack"]),
    ("lfo", "LFO 3", ["Lfo3Shape", "Lfo3Speed", "Lfo3Sync", "Lfo3Clocked", "Lfo3StartPhase", "Lfo3Delay", "Lfo3Fade", "Lfo3KeyTrack"]),

    ("matrix", "Fast 1-2", ["Slot1FSource", "Slot1FDestination", "Slot1FAmount", "Slot2FSource", "Slot2FDestination", "Slot2FAmount"]),
    ("matrix", "Fast 3-4", ["Slot3FSource", "Slot3FDestination", "Slot3FAmount", "Slot4FSource", "Slot4FDestination", "Slot4FAmount"]),
    ("matrix", "Fast 5-6", ["Slot5FSource", "Slot5FDestination", "Slot5FAmount", "Slot6FSource", "Slot6FDestination", "Slot6FAmount"]),
    ("matrix", "Fast 7-8", ["Slot7FSource", "Slot7FDestination", "Slot7FAmount", "Slot8FSource", "Slot8FDestination", "Slot8FAmount"]),
    ("matrix", "Slots 1-2", ["Slot1SSource", "Slot1SDestination", "Slot1SAmount", "Slot2SSource", "Slot2SDestination", "Slot2SAmount"]),
    ("matrix", "Slots 3-4", ["Slot3SSource", "Slot3SDestination", "Slot3SAmount", "Slot4SSource", "Slot4SDestination", "Slot4SAmount"]),
    ("matrix", "Slots 5-6", ["Slot5SSource", "Slot5SDestination", "Slot5SAmount", "Slot6SSource", "Slot6SDestination", "Slot6SAmount"]),
    ("matrix", "Slots 7-8", ["Slot7SSource", "Slot7SDestination", "Slot7SAmount", "Slot8SSource", "Slot8SDestination", "Slot8SAmount"]),
    ("matrix", "Modifiers 1-2", ["Mod1Source1", "Mod1Source2", "Mod1Operator", "Mod1Constant", "Mod2Source1", "Mod2Source2",
                                 "Mod2Operator", "Mod2Constant"]),
    ("matrix", "Modifiers 3-4", ["Mod3Source1", "Mod3Source2", "Mod3Operator", "Mod3Constant", "Mod4Source1", "Mod4Source2",
                                 "Mod4Operator", "Mod4Constant"]),

    ("arp", "Arp", ["ArpMode", "ArpPattern", "ArpClock", "ArpLength", "ArpOctaveRange", "ArpDirection", "ArpSortOrder", "ArpVeloMode"]),
    ("arp", "Arp +", ["Tempo", "ArpMaxNotes", "ArpTFactor", "ArpSameNoteOverlap", "ArpPatternReset", "ArpPatternLength"]),
]

# Names for the Push's cells and Live's lists: twelve letters at most.
def auto_name(n):
    rules = [
        (r"^O([123])SubFreqDiv$", r"Sub\1 Divide"), (r"^O([123])SubVolume$", r"Sub\1 Volume"),
        (r"^O([123])PulseWidth$", r"Osc\1 PW"), (r"^O([123])PwmSource$", r"Osc\1 PWM Src"), (r"^O([123])Pwm$", r"Osc\1 PWM"),
        (r"^O([123])FmSource$", r"Osc\1 FM Src"), (r"^O([123])FmAmount$", r"Osc\1 FM"), (r"^O([123])KeyTrack$", r"Osc\1 Keys"),
        (r"^O([123])BendRange$", r"Osc\1 Bend"), (r"^O([123])(\w+)$", r"Osc\1 \2"),
        (r"^F([12])Resonance$", r"F\1 Reso"), (r"^F([12])EnvMod$", r"F\1 Env"), (r"^F([12])VelMod$", r"F\1 Velocity"),
        (r"^F([12])KeyTrack$", r"F\1 Keys"), (r"^F([12])ModSource$", r"F\1 Mod Src"), (r"^F([12])CutoffMod$", r"F\1 Mod Amt"),
        (r"^F([12])FmSource$", r"F\1 FM Src"), (r"^F([12])FmAmount$", r"F\1 FM"), (r"^F([12])PanModSource$", r"F\1 Pan Src"),
        (r"^F([12])PanMod$", r"F\1 Pan Mod"), (r"^F([12])(\w+)$", r"F\1 \2"),
        (r"^FilterEnv(\w+)$", r"FEnv \1"), (r"^AmpEnv(\w+)$", r"AEnv \1"), (r"^Env([34])(\w+)$", r"Env\1 \2"),
        (r"^Lfo([123])StartPhase$", r"L\1 Phase"), (r"^Lfo([123])KeyTrack$", r"L\1 Keys"), (r"^Lfo([123])(\w+)$", r"L\1 \2"),
        (r"^Slot([1-8])FSource$", r"Fast\1 Src"), (r"^Slot([1-8])FDestination$", r"Fast\1 Dest"), (r"^Slot([1-8])FAmount$", r"Fast\1 Amt"),
        (r"^Slot([1-8])SSource$", r"Slot\1 Src"), (r"^Slot([1-8])SDestination$", r"Slot\1 Dest"), (r"^Slot([1-8])SAmount$", r"Slot\1 Amt"),
        (r"^Mod([1-4])Source([12])$", r"Mod\1 Src \2"), (r"^Mod([1-4])Operator$", r"Mod\1 Op"), (r"^Mod([1-4])Constant$", r"Mod\1 Const"),
        (r"^Arp(\w+)$", r"Arp \1"),
    ]
    for pat, rep in rules:
        if re.match(pat, n):
            n = re.sub(pat, rep, n)
            break
    n = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", n)
    n = re.sub(r"Sustain2$", "Sus 2", re.sub(r"Decay2$", "Decay 2", n))
    return n


NAMES = {
    "FilterRouting": "Routing", "NoiseLevel": "Noise", "RingModLevel": "Ring Mod", "NoiseBalance": "Noise Bal",
    "RingModBalance": "RingMod Bal", "NoiseModeF1": "Noise F1", "NoiseModeF2": "Noise F2", "O1Balance": "Osc1 Bal",
    "O2Balance": "Osc2 Bal", "O3Balance": "Osc3 Bal", "AmpVolume": "Volume", "AmpVelocity": "Amp Velocity",
    "AmpModSource": "Amp Mod Src", "AmpModAmount": "Amp Mod Amt", "FX1Type": "FX1 Type", "FX1Mix": "FX1 Mix",
    "FX2Type": "FX2 Type", "FX2Mix": "FX2 Mix", "GlideRate": "Glide", "GlideEnable": "Glide On", "GlideMode": "Glide Mode",
    "UnisonoDetune": "Uni Detune", "UnisonoCount": "Unisono", "VoiceMode": "Voice Mode", "PitchModSrc": "Pitch Src",
    "PitchModAmount": "Pitch Amt", "FilterEnvAttackLevel": "FEnv Att Lvl", "AmpEnvAttackLevel": "AEnv Att Lvl",
    "Env3AttackLevel": "Env3 Att Lvl", "Env4AttackLevel": "Env4 Att Lvl", "FilterEnvTriggerMode": "FEnv Trigger",
    "AmpEnvTriggerMode": "AEnv Trigger", "Env3TriggerMode": "Env3 Trigger", "Env4TriggerMode": "Env4 Trigger",
    "ArpOctaveRange": "Arp Octaves", "ArpSameNoteOverlap": "Arp Overlap", "ArpPatternReset": "Arp Reset",
    "ArpPatternLength": "Arp Pat Len", "ArpMaxNotes": "Arp Notes", "ArpTFactor": "Arp T-Factor", "ArpVeloMode": "Arp Velocity",
    "ArpSortOrder": "Arp Order", "ArpDirection": "Arp Dir",
}

# the name on the label row under a picture, where the page's title says the section (OsTIrus)
PREFIX = re.compile(r"^(Osc[123]|Sub[12]|F[12]|FEnv|AEnv|Env[34]|L[123]|Fast[1-8]|Slot[1-8]|Mod[1-4]|Arp) ")
WORDS = {"Src": "Source", "Amt": "Amount", "Reso": "Resonance", "Sus": "Sustain"}
OWN_SHORT = {"Osc1 Bal": "Osc 1", "Osc2 Bal": "Osc 2", "Osc3 Bal": "Osc 3", "Noise Bal": "Noise", "RingMod Bal": "Ring Mod",
             "FEnv Att Lvl": "Att Level", "AEnv Att Lvl": "Att Level", "Env3 Att Lvl": "Att Level", "Env4 Att Lvl": "Att Level",
             "Amp Mod Src": "Mod Source", "Amp Mod Amt": "Mod Amount", "Amp Velocity": "Velocity",
             "FEnv Trigger": "Filter Env", "AEnv Trigger": "Amp Env", "Env3 Trigger": "Env 3", "Env4 Trigger": "Env 4"}


def short_of(name):
    if name in OWN_SHORT:
        return OWN_SHORT[name]
    t = PREFIX.sub("", name)
    if t == name:
        return ""
    t = " ".join(WORDS.get(w, w) for w in t.split(" "))
    return t if len(t) <= 12 else ""


# value texts that are plain numbers: shown as numbers, with an offset
PLAIN = {"unsignedZero": 0}
OFFSET = {"signed": 64, "unsignedOne": -1}

# the effect types and the parameters each one has, in the descriptions' order
FX_PREFIX = {
    1: [("Chorus", "Fx1Chorus"), ("Flanger", "Fx1Flanger"), ("Phaser", "Fx1Phaser"), ("Overdrive", "Fx1Overdrive"),
        ("Five FX", "FiveFX1"), ("Vocoder", "Fx1Vocoder")],
    2: [("Chorus", "Fx2Chorus"), ("Flanger", "Fx2Flanger"), ("Phaser", "Fx2Phaser"), ("Overdrive", "Fx2Overdrive"),
        ("Five FX", "FiveFX2"), ("Vocoder", "Fx2Vocoder"), ("Delay", "Fx2Delay"), ("Reverb", "Fx2Reverb"),
        ("5.1 Delay", "Fx251Delay"), ("5.1 Delay Clocked", "Fx251ClockDelay")],
}
FX_SLOTS = 14


def load_json(path):
    """gearmulator's descriptions: JSON with comments, single quotes and trailing commas"""
    s = open(path).read()
    out, i, ins, q = [], 0, False, None
    while i < len(s):
        c = s[i]
        if ins:
            out.append(c)
            if c == "\\":
                out.append(s[i + 1])
                i += 2
                continue
            if c == q:
                ins = False
                out[-1] = '"'
        elif c in "\"'":
            ins, q = True, c
            out.append('"')
        elif s.startswith("//", i):
            j = s.find("\n", i)
            i = j if j >= 0 else len(s)
            continue
        elif s.startswith("/*", i):
            i = s.find("*/", i) + 2
            continue
        else:
            out.append(c)
        i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def key_of(n):
    return re.sub(r"[^a-z0-9]+", "_", re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", n).lower()).strip("_")


def c_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    gm = sys.argv[1]
    d = load_json(os.path.join(gm, "waldi/microq/mqJucePlugin/parameterDescriptions_mq.json"))
    defaults = d["parameterdescriptiondefaults"]
    descs = [dict(defaults, **p) for p in d["parameterdescriptions"]]
    by = {p["name"]: p for p in descs if p["page"] < 100}
    vl = d["valuelists"]
    bits = {}
    for e in d["midipackets"]["singledump"]:
        if e.get("type") == "param" and "mask" in e:
            bits[e["name"]] = (int(str(e["mask"]), 0), int(str(e.get("shift", 0)), 0))

    lists = {}

    def list_id(texts):
        k = json.dumps(texts)
        lists.setdefault(k, len(lists))
        return lists[k]

    def texts(tt, lo, hi):
        v = vl.get(tt)
        if v is None:
            return None
        if isinstance(v, dict):
            return [str(v.get(str(i), str(i))).strip() or str(i) for i in range(lo, hi + 1)]
        return [(str(v[i]).strip() if i < len(v) else str(i)) or str(i) for i in range(lo, hi + 1)]

    def entry(n, name=None, key=None):
        p = by.get(n)
        if p is None:
            sys.exit("not in the descriptions: %r" % n)
        lo, hi, tt = int(p["min"]), int(p["max"]), p.get("toText", "unsignedZero")
        mask, shift = bits.get(n, (0, 0))
        nm = name or NAMES.get(n) or auto_name(n)
        if len(nm) > 12:
            sys.exit("name too long: %r for %s" % (nm, n))
        e = {"key": key or key_of(n), "name": nm, "byte": int(p["index"]), "mask": mask, "shift": shift,
             "min": lo, "max": hi, "kind": "int", "offset": 0, "list": -1}
        step = int(p.get("step", 0) or 0)
        if n.endswith("TriggerMode"):
            # an on/off button on gearmulator's panel whose "on" is the
            # range's top (2): Normal or Single, stored as 0 or 2
            e.update(kind="octave", min=0, max=1, raw_min=0, step=2, list=list_id(["Normal", "Single"]))
            return e
        if p.get("isBool") or (p["isDiscrete"] and hi - lo < 32 and tt not in PLAIN and tt not in OFFSET):
            e["kind"] = "enum"
            t = texts(tt, lo, hi) if tt not in PLAIN else None
            if t is None or tt in PLAIN:
                t = ["Off", "On"] if hi - lo == 1 else [str(i) for i in range(lo, hi + 1)]
            e["list"] = list_id(t)
        elif tt in OFFSET:
            e["offset"] = OFFSET[tt]
        elif tt not in PLAIN:
            t = texts(tt, lo, hi)
            if tt == "octaves" and step:
                # an octave is every 12th value: the values between have no name
                t = [x for i, x in enumerate(t) if (i % step) == 0]
                e["kind"], e["min"], e["step"] = "octave", 0, step
                e["max"] = len(t) - 1
                e["raw_min"] = lo
            e["kind"] = "labels" if e["kind"] == "int" else e["kind"]
            e["list"] = list_id(t)
        return e

    params, keys, pages = [], {}, []
    for comp, label, names in LAYOUT:
        row = []
        for n in names:
            m = re.match(r"^fx([12])_p(\d+)$", n)
            if m:
                fx, slot = int(m.group(1)), int(m.group(2))
                k = n
                if k not in keys:
                    keys[k] = len(params)
                    params.append({"key": k, "name": "FX%d Param %d" % (fx, slot) if slot < 10 else "FX%d Par %d" % (fx, slot),
                                   "byte": -1, "mask": 0, "shift": 0, "min": 0, "max": 127, "kind": "fx", "offset": 0,
                                   "list": -1, "fx": fx, "slot": slot})
                row.append(k)
                continue
            e = entry(n)
            row.append(e["key"])
            if e["key"] in keys:
                continue
            keys[e["key"]] = len(params)
            params.append(e)
        if len(row) > 8:
            sys.exit("page %s has %d knobs" % (label, len(row)))
        pages.append((comp, label, row))

    # the effects: per slot and type, the parameter each neutral knob is
    fx = {}
    for slot_fx, types in FX_PREFIX.items():
        for ti, (tname, prefix) in enumerate(types):
            ps = [p for p in descs if p["page"] < 100 and p["name"].startswith(prefix) and
                  not (prefix == "Fx251Delay" and p["name"].startswith("Fx251ClockDelay"))]
            ents = []
            for p in ps[:FX_SLOTS]:
                label = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", p["name"][len(prefix):]).strip() or tname
                label = {"Feedback": "Feedback", "Post Gain": "Post Gain"}.get(label, label)
                e = entry(p["name"], name=label[:12], key="_fx")
                ents.append(e)
            fx[(slot_fx, ti + 1)] = (tname, ents)

    out = ["// Generated by tools/gen_params.py from gearmulator's parameterDescriptions_mq.json. Do not edit.",
           "#pragma once", "#include <cstdint>", "", "namespace mq {", ""]
    out.append("enum Kind { kInt, kEnum, kLabels, kOctave, kFx };")
    out.append("// byte: the byte of the single; mask/shift: the bits of it (mask 0: all of it). octave: the value is")
    out.append("// raw_min + index * step. fx/slot: a neutral effect knob (kFx), resolved by the effect type (kFxTable).")
    out.append("struct Param { const char *key, *name, *short_; int16_t byte; uint8_t mask, shift; int16_t min, max, offset; uint8_t kind;")
    out.append("               int16_t list; int16_t raw_min, step; uint8_t fx, slot; };")
    out.append("")
    for lk, li in sorted(lists.items(), key=lambda x: x[1]):
        L = json.loads(lk)
        out.append("static const char *const L%d[] = {%s};" % (li, ", ".join(c_str(x) for x in L)))
    out.append("static const char *const *const kLists[] = {%s};" % ", ".join("L%d" % i for i in range(len(lists))))
    out.append("static const int kListLen[] = {%s};" %
               ", ".join(str(len(json.loads(lk))) for lk, _ in sorted(lists.items(), key=lambda x: x[1])))
    out.append("")

    def prow(e):
        kind = {"int": "kInt", "enum": "kEnum", "labels": "kLabels", "octave": "kOctave", "fx": "kFx"}[e["kind"]]
        return "{%s, %s, %s, %d, %d, %d, %d, %d, %d, %s, %d, %d, %d, %d, %d}" % (
            c_str(e["key"]), c_str(e["name"]), c_str(short_of(e["name"])), e["byte"], e["mask"], e["shift"], e["min"], e["max"],
            e["offset"], kind, e["list"], e.get("raw_min", 0), e.get("step", 0), e.get("fx", 0), e.get("slot", 0))

    out.append("static const Param kParams[] = {")
    for e in params:
        out.append("    " + prow(e) + ",")
    out.append("};")
    out.append("static const int kNumParams = %d;" % len(params))
    out.append("")
    out.append("// the pages: compartment, label, eight keys at most")
    out.append("struct Page { const char *comp, *label; const char *keys[8]; };")
    out.append("static const Page kPages[] = {")
    for comp, label, row in pages:
        out.append("    {%s, %s, {%s}}," % (c_str(comp), c_str(label), ", ".join(c_str(k) for k in row)))
    out.append("};")
    out.append("static const int kNumPages = %d;" % len(pages))
    out.append("")
    out.append("// the effects: for slot fx (1, 2) and type t (FX1Type/FX2Type's value), its name and what its knobs are")
    out.append("struct FxType { uint8_t fx, type; const char *name; int n; Param p[%d]; };" % FX_SLOTS)
    out.append("static const FxType kFxTable[] = {")
    for (f, t), (tname, ents) in sorted(fx.items()):
        cells = ", ".join(prow(e) for e in ents)
        out.append("    {%d, %d, %s, %d, {%s}}," % (f, t, c_str(tname), len(ents), cells))
    out.append("};")
    out.append("static const int kNumFxTypes = %d;" % len(fx))
    out.append("")
    out.append("} // namespace mq")
    open(os.path.join(os.path.dirname(__file__), "..", "dsp", "mq_params.h"), "w").write("\n".join(out) + "\n")
    # the pages for push_ui.js, between its markers: the screens and the engine name the same keys
    ui = os.path.join(os.path.dirname(__file__), "..", "push_ui.js")
    if os.path.exists(ui):
        js = ["// <pages> written by tools/gen_params.py from its LAYOUT: do not edit here", "var PAGES = {"]
        comps = []
        for comp, label, row in pages:
            if comp not in comps:
                comps.append(comp)
        for c in comps:
            rows = ["{ label: %s, keys: [%s] }" % (json.dumps(l), ", ".join(json.dumps(k) for k in r)) for cc, l, r in pages if cc == c]
            js.append("  %s: [\n    %s\n  ]," % (c, ",\n    ".join(rows)))
        js.append("};")
        js.append("// </pages>")
        src = open(ui).read()
        a, b = src.find("// <pages>"), src.find("// </pages>")
        if a < 0 or b < 0:
            sys.exit("push_ui.js has no <pages> markers")
        open(ui, "w").write(src[:a] + "\n".join(js) + src[b + len("// </pages>"):])
    print("%d parameters on %d pages, %d value lists, %d effect types" % (len(params), len(pages), len(lists), len(fx)))


main()
