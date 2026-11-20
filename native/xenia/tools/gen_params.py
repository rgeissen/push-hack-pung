#!/usr/bin/env python3
"""Writes dsp/xt_params.h: Xenia's parameters, from gearmulator's own Microwave
II/XT descriptions (waldi/xt/xtJucePlugin/parameterDescriptions_xt.json) and
the page layout below, and the page lists in push_ui.js. Run when either
changes:

    tools/gen_params.py <gearmulator source dir>

Vavra's generator, for the XT (docs/NATIVE-MODULES.md, Xenia). The XT's
effect knobs are bytes of their own (EffectParamA..C), named by the effect
type on the Push; there is no table of neutral knobs.
"""
import json, os, re, sys

# ---- the layout --------------------------------------------------------------------
# (compartment, page label, [parameter names, 8 at most]). Live keeps the
# first 128 parameters, page by page, and pads every page to eight: the
# pages before that line are full and repeat nothing (Vavra's lesson).
LAYOUT = [
    # the front panel: the wavetable and what a hand reaches for first
    ("panel", "Xenia", ["Wave", "W1StartW", "W2StartW", "W1EnvAmount", "F1Cutoff", "F1Resonance", "F1EnvAmount", "AmpVolume"]),

    ("osc", "Oscillators", ["O1Octave", "O1Semi", "O1Detune", "O1FmAmount", "O2Octave", "O2Semi", "O2Detune", "O2Sync"]),
    ("osc", "Osc Tracking", ["O1BendRange", "O1KeyTrack", "O2BendRange", "O2KeyTrack", "O2Link", "W2EnvAmount", "W1EnvVelAmount",
                             "W2EnvVelAmount"]),
    ("wave", "Waves", ["W1StartP", "W1Keytrack", "W1Limit", "W2StartP", "W2Keytrack", "W2Limit", "W2Link", "Accuracy"]),
    ("wave", "Mixer", ["MixW1", "MixW2", "MixRingMod", "MixNoise", "Aliasing", "TimeQuant", "Clipping", "Pan"]),

    ("filter", "Filters", ["F1Type", "F1KeyTrack", "F1EnvVelAmount", "F1Extra", "F2Type", "F2Cutoff", "F2KeyTrack", "AmpKeytrack"]),
    ("env", "Filter / Amp", ["F1EnvAttack", "F1EnvDecay", "F1EnvSustain", "F1EnvRelease", "AmpEnvAttack", "AmpEnvDecay",
                             "AmpEnvSustain", "AmpEnvRelease"]),
    ("lfo", "LFOs", ["Lfo1Rate", "Lfo1Shape", "Lfo1Delay", "Lfo1Sync", "Lfo2Rate", "Lfo2Shape", "Lfo2Delay", "Lfo2Sync"]),
    ("fx", "Effect / Glide", ["EffectType", "EffectParamA", "EffectParamB", "EffectParamC", "GlideEnabled", "GlideTime", "GlideType",
                              "GlideMode"]),
    ("voice", "Voice", ["AllocationMode", "Assignment", "Detune", "DePan", "AmpVelocity", "PanKeytrack", "ChorusEnabled", "ArpMode"]),

    ("wenv", "Wave Env Time", ["WaveEnvTime%d" % i for i in range(1, 9)]),
    ("wenv", "Wave Env Level", ["WaveEnvLevel%d" % i for i in range(1, 9)]),
    ("wenv", "Wave Env Loop", ["WaveKeyOnLoop", "WaveKeyOnLoopStart", "WaveKeyOnLoopEnd", "WaveKeyOffLoop", "WaveKeyOffLoopStart",
                               "WaveKeyOffLoopEnd", "WaveEnvTrigger"]),
    ("env", "Free Env", ["FreeEnvTime1", "FreeEnvLevel1", "FreeEnvTime2", "FreeEnvLevel2", "FreeEnvTime3", "FreeEnvLevel3",
                         "FreeEnvReleaseTime", "FreeEnvReleaseLevel"]),
    ("env", "Triggers", ["F1EnvTrigger", "AmpEnvTrigger", "FreeEnvTrigger"]),
    ("lfo", "LFO Shape", ["Lfo1Symmetry", "Lfo1Humanize", "Lfo2Symmetry", "Lfo2Humanize", "Lfo2Phase"]),
    ("voice", "Play Params", ["PlayParamA", "PlayParamB", "PlayParamC", "PlayParamD"]),

    ("matrix", "Modifiers 1-2", ["Mod1Source1", "Mod1Source2", "Mod1Type", "Mod1Parameter", "Mod2Source1", "Mod2Source2", "Mod2Type",
                                 "Mod2Parameter"]),
    ("matrix", "Modifiers 3-4", ["Mod3Source1", "Mod3Source2", "Mod3Type", "Mod3Parameter", "Mod4Source1", "Mod4Source2", "Mod4Type",
                                 "Mod4Parameter"]),
] + [
    ("matrix", "Slots %d-%d" % (a, a + 1), ["Slot%dSource" % a, "Slot%dDestination" % a, "Slot%dAmount" % a,
                                            "Slot%dSource" % (a + 1), "Slot%dDestination" % (a + 1), "Slot%dAmount" % (a + 1)])
    for a in range(1, 17, 2)
] + [
    ("matrix", "Control Delay", ["ModDelaySource", "ModDelayTime"]),
    ("arp", "Arp", ["ArpTempo", "ArpClock", "ArpRange", "ArpPattern", "ArpDirection", "ArpNoteOrder", "ArpVelocity", "ArpReset"]),
    ("arp", "Arp Pattern", ["ArpUserPatternLength"]),
    ("arp", "Steps 1-8", ["ArpUserPattern%d" % i for i in range(1, 9)]),
    ("arp", "Steps 9-16", ["ArpUserPattern%d" % i for i in range(9, 17)]),
]

# Names for the Push's cells and Live's lists: twelve letters at most.
def auto_name(n):
    rules = [
        (r"^O([12])BendRange$", r"Osc\1 Bend"), (r"^O([12])KeyTrack$", r"Osc\1 Keys"), (r"^O([12])FmAmount$", r"Osc\1 FM"),
        (r"^O([12])(\w+)$", r"Osc\1 \2"),
        (r"^W([12])StartW$", r"W\1 Start"), (r"^W([12])StartP$", r"W\1 Phase"), (r"^W([12])EnvAmount$", r"W\1 Env"),
        (r"^W([12])EnvVelAmount$", r"W\1 Env Vel"), (r"^W([12])Keytrack$", r"W\1 Keys"), (r"^W([12])(\w+)$", r"W\1 \2"),
        (r"^Mix(W[12])$", r"Mix \1"), (r"^MixRingMod$", "Mix Ring"), (r"^MixNoise$", "Mix Noise"),
        (r"^F([12])Resonance$", r"F\1 Reso"), (r"^F([12])KeyTrack$", r"F\1 Keys"), (r"^F([12])EnvAmount$", r"F\1 Env"),
        (r"^F([12])EnvVelAmount$", r"F\1 Env Vel"), (r"^F1Env(\w+)$", r"FEnv \1"), (r"^F([12])(\w+)$", r"F\1 \2"),
        (r"^AmpEnv(\w+)$", r"AEnv \1"), (r"^Amp(\w+)$", r"Amp \1"),
        (r"^WaveEnvTime(\d)$", r"WEnv Time \1"), (r"^WaveEnvLevel(\d)$", r"WEnv Lvl \1"),
        (r"^FreeEnvTime(\d)$", r"Free Time \1"), (r"^FreeEnvLevel(\d)$", r"Free Lvl \1"),
        (r"^FreeEnvReleaseTime$", "Free Rel T"), (r"^FreeEnvReleaseLevel$", "Free Rel L"), (r"^FreeEnvTrigger$", "Free Trig"),
        (r"^WaveKeyOnLoop$", "On Loop"), (r"^WaveKeyOnLoopStart$", "On Loop Beg"), (r"^WaveKeyOnLoopEnd$", "On Loop End"),
        (r"^WaveKeyOffLoop$", "Off Loop"), (r"^WaveKeyOffLoopStart$", "Off Loop Beg"), (r"^WaveKeyOffLoopEnd$", "Off Loop End"),
        (r"^WaveEnvTrigger$", "WEnv Trig"),
        (r"^Lfo([12])(\w+)$", r"L\1 \2"),
        (r"^Slot(\d+)Source$", r"Slot\1 Src"), (r"^Slot(\d+)Destination$", r"Slot\1 Dest"), (r"^Slot(\d+)Amount$", r"Slot\1 Amt"),
        (r"^Mod([1-4])Source([12])$", r"Mod\1 Src \2"), (r"^Mod([1-4])Type$", r"Mod\1 Op"), (r"^Mod([1-4])Parameter$", r"Mod\1 Param"),
        (r"^ArpUserPattern(\d+)$", r"Step \1"), (r"^Arp(\w+)$", r"Arp \1"),
        (r"^PlayParam([A-D])$", r"Play \1"), (r"^EffectParam([A-C])$", r"FX \1"), (r"^Glide(\w+)$", r"Glide \1"),
    ]
    for pat, rep_ in rules:
        if re.match(pat, n):
            n = re.sub(pat, rep_, n)
            break
    if re.match(r"^(Step|WEnv|Free) ", n):
        return n
    n = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", n)
    return n


NAMES = {
    "Wave": "Wavetable", "EffectType": "FX Type", "ChorusEnabled": "Chorus", "AllocationMode": "Allocation",
    "Assignment": "Assignment", "DePan": "De-Pan", "TimeQuant": "Quantize", "Accuracy": "Accuracy", "ModDelaySource": "CtlDelay Src",
    "ModDelayTime": "Ctl Delay", "ArpUserPatternLength": "Pattern Len", "ArpNoteOrder": "Arp Order", "ArpVelocity": "Arp Velocity",
    "ArpDirection": "Arp Dir", "AmpKeytrack": "Amp Keys", "PanKeytrack": "Pan Keys", "F1EnvTrigger": "FEnv Trig",
    "AmpEnvTrigger": "AEnv Trig", "GlideEnabled": "Glide", "GlideTime": "Glide Time", "O2Link": "Osc2 Link", "W2Link": "W2 Link",
}

# the name on the label row under a picture, where the page's title says the section (OsTIrus)
PREFIX = re.compile(r"^(Osc[12]|W[12]|F[12]|FEnv|AEnv|L[12]|Slot\d+|Mod[1-4]|Arp|Glide|Mix|Free|WEnv) ")
WORDS = {"Src": "Source", "Amt": "Amount", "Reso": "Resonance", "Lvl": "Level"}
OWN_SHORT = {"Amp Keys": "Keys", "Pan Keys": "Pan Keys", "FEnv Trig": "Filter Env", "AEnv Trig": "Amp Env", "Free Trig": "Free Env",
             "WEnv Trig": "Trigger", "CtlDelay Src": "Source", "Ctl Delay": "Time", "W1 Env Vel": "W1 Vel", "W2 Env Vel": "W2 Vel"}


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
FX_PREFIX = {}  # the XT has no neutral effect knobs
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
    d = load_json(os.path.join(gm, "waldi/xt/xtJucePlugin/parameterDescriptions_xt.json"))
    defaults = d["parameterdescriptiondefaults"]
    descs = [dict(defaults, **p) for p in d["parameterdescriptions"]]
    by = {p["name"]: p for p in descs if p["page"] == 0}
    vl = d["valuelists"]
    bits = {}
    for e in d["midipackets"]["singledump"]:
        if e.get("type") == "param" and "mask" in e:
            bits[e["name"]] = (int(str(e["mask"]), 0), int(str(e.get("shift", 0)), 0))

    lists = {}
    rawmaps = []

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
        if False:  # (the microQ's Normal/Single button)
            # an on/off button on gearmulator's panel whose "on" is the
            # range's top (2): Normal or Single, stored as 0 or 2
            e.update(kind="octave", min=0, max=1, raw_min=0, step=2, list=list_id(["Normal", "Single"]))
            return e
        # a list with blank names (the XT's effect types 8..31, the microQ's fourth glide mode):
        # an enum of the named ones only, each writing its own raw value
        raw_list = vl.get(tt) if isinstance(vl.get(tt), list) else None
        if p["isDiscrete"] and raw_list and any(i < len(raw_list) and not str(raw_list[i]).strip() for i in range(lo, hi + 1)):
            named = [(i, str(raw_list[i]).strip()) for i in range(lo, hi + 1) if i < len(raw_list) and str(raw_list[i]).strip()]
            e["kind"] = "enum"
            e["list"] = list_id([x for _, x in named])
            rawmaps.append([r for r, _ in named])
            e["rawmap"] = len(rawmaps) - 1
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

    out = ["// Generated by tools/gen_params.py from gearmulator's parameterDescriptions_xt.json. Do not edit.",
           "#pragma once", "#include <cstdint>", "", "namespace xtp {", ""]
    out.append("enum Kind { kInt, kEnum, kLabels, kOctave, kFx };")
    out.append("// byte: the byte of the single; mask/shift: the bits of it (mask 0: all of it). octave: the value is")
    out.append("// raw_min + index * step. fx/slot: a neutral effect knob (kFx), resolved by the effect type (kFxTable).")
    out.append("// rawmap: an enum whose options are not its raw values in order (the XT's effect types: 0..7 and 32..34):")
    out.append("// option i is kRawMaps[rawmap][i]; -1: the raw value is min + i")
    out.append("struct Param { const char *key, *name, *short_; int16_t byte; uint8_t mask, shift; int16_t min, max, offset; uint8_t kind;")
    out.append("               int16_t list; int16_t raw_min, step; uint8_t fx, slot; int16_t rawmap; };")
    out.append("")
    for lk, li in sorted(lists.items(), key=lambda x: x[1]):
        L = json.loads(lk)
        out.append("static const char *const L%d[] = {%s};" % (li, ", ".join(c_str(x) for x in L)))
    out.append("static const char *const *const kLists[] = {%s};" % ", ".join("L%d" % i for i in range(len(lists))))
    out.append("static const int16_t kRawMaps[][64] = {%s};" % (", ".join("{%s}" % ", ".join(str(x) for x in m) for m in rawmaps) or "{0}"))
    out.append("static const int kListLen[] = {%s};" %
               ", ".join(str(len(json.loads(lk))) for lk, _ in sorted(lists.items(), key=lambda x: x[1])))
    out.append("")

    def prow(e):
        kind = {"int": "kInt", "enum": "kEnum", "labels": "kLabels", "octave": "kOctave", "fx": "kFx"}[e["kind"]]
        return "{%s, %s, %s, %d, %d, %d, %d, %d, %d, %s, %d, %d, %d, %d, %d, %d}" % (
            c_str(e["key"]), c_str(e["name"]), c_str(short_of(e["name"])), e["byte"], e["mask"], e["shift"], e["min"], e["max"],
            e["offset"], kind, e["list"], e.get("raw_min", 0), e.get("step", 0), e.get("fx", 0), e.get("slot", 0), e.get("rawmap", -1))

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
    if not fx:
        out.append("    {0, 0, \"\", 0, {}},")
    for (f, t), (tname, ents) in sorted(fx.items()):
        cells = ", ".join(prow(e) for e in ents)
        out.append("    {%d, %d, %s, %d, {%s}}," % (f, t, c_str(tname), len(ents), cells))
    out.append("};")
    out.append("static const int kNumFxTypes = %d;" % len(fx))
    out.append("")
    out.append("} // namespace xtp")
    open(os.path.join(os.path.dirname(__file__), "..", "dsp", "xt_params.h"), "w").write("\n".join(out) + "\n")
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
