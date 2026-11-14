#!/usr/bin/env python3
"""Push browser entries for every Schwung device (DESIGN-v2).

Push's browser does not list plugins, but it lists racks saved in the User
Library. For each class in vst3-classes.json this writes one rack (.adg) that
holds the Schwung plugin, with a parameter map in the module's own bank order,
so Push's device view and encoders show the module's banks.

  - instruments and MIDI-effect devices: an Instrument Rack, from Push Hack's
    known-good template (scripts/VST/templates/vst3-instrument.adg.xml);
  - MIDI effects ("midifx"): a MIDI Effect Rack, same template; Live's own
    MIDI Effect Racks differ from an Instrument Rack only in the group and
    branch types and the branch mixer (MidiBranchMixerDevice, kept verbatim
    from a Core Library rack in tools/templates/midi-branch-mixer.xml). The
    plugin's DeviceType for a MIDI effect is SCHWUNG_MIDIFX_DEVICETYPE
    (default 0), to be confirmed against the Live that hosts it;
  - audio effects: an Audio Effect Rack, made from the same template with
    exactly the differences Live's own Audio Effect Racks show (2026-11-14,
    compared with a Core Library rack): the group and branch types, no MIDI
    chain filter, range type or zone display on the rack, no key, velocity or
    zone ranges on the branch, and DeviceType 2 for the plugin.

  make-presets.py <vst3-classes.json> <push-hack checkout> <out dir>
"""
import importlib.util
import json
import os
import re
import sys


def load_generator(push_hack):
    path = os.path.join(push_hack, "scripts", "VST", "make-vst3-preset.py")
    spec = importlib.util.spec_from_file_location("mkvst3", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def as_effect(xml):
    xml = xml.replace("InstrumentGroupDevice", "AudioEffectGroupDevice")
    xml = xml.replace("InstrumentBranchPreset", "AudioEffectBranchPreset")
    for el in ("ChainSelectorFilterMidiCtrl", "RangeTypeIndex", "ShowsZonesInsteadOfNoteNames"):
        xml = re.sub(r"[ \t]*<%s Value=\"[^\"]*\" />\n" % el, "", xml)
    xml = re.sub(r"[ \t]*<ZoneSettings>.*?</ZoneSettings>\n", "", xml, flags=re.S)
    xml = xml.replace('<DeviceType Value="1" />', '<DeviceType Value="2" />')
    xml = xml.replace('<MpeEnabled Value="1" />', '<MpeEnabled Value="0" />')
    return xml


HERE = os.path.dirname(os.path.abspath(__file__))


def as_midi_effect(xml):
    xml = xml.replace("InstrumentGroupDevice", "MidiEffectGroupDevice")
    xml = xml.replace("InstrumentBranchPreset", "MidiEffectBranchPreset")
    mixer = open(os.path.join(HERE, "templates", "midi-branch-mixer.xml")).read()
    xml, n = re.subn(r"[ \t]*<MixerPreset>.*?</MixerPreset>\n", lambda m: mixer, xml, count=1, flags=re.S)
    assert n == 1, "no branch mixer in the template"
    dt = os.environ.get("SCHWUNG_MIDIFX_DEVICETYPE", "0")
    xml = xml.replace('<DeviceType Value="1" />', '<DeviceType Value="%s" />' % dt)
    xml = xml.replace('<MpeEnabled Value="1" />', '<MpeEnabled Value="0" />')
    return xml


def main():
    classes_path, push_hack, out = sys.argv[1:4]
    gen = load_generator(push_hack)
    doc = json.load(open(classes_path))
    folders = {"instrument": "Instruments/Schwung", "midi": "Instruments/Schwung MIDI Effects",
               "effect": "Audio Effects/Schwung", "midifx": "MIDI Effects/Schwung"}
    written = 0
    for c in doc["classes"]:
        # each parameter ONCE: a bank may repeat one (the MIDI FX selector heads
        # every MIDI-effect bank), and Live keeps a separate value per listed
        # entry, so a second copy shows a stale value (measured 2026-11-14)
        order, seen = [], set()
        for bank in c.get("banks", []):
            for i in bank:
                if i not in seen:
                    seen.add(i)
                    order.append(i)
        params = [(i, "Enum" if c["params"][i]["type"] == "enum" else "Float") for i in order][:128]
        uid = c["uid"]
        xml = gen.render(c["name"], uid, params)
        if c["kind"] == "effect":
            xml = as_effect(xml)
        elif c["kind"] == "midifx":
            xml = as_midi_effect(xml)
        folder = os.path.join(out, folders[c["kind"]])
        os.makedirs(folder, exist_ok=True)
        import gzip
        fname = re.sub(r"[^\w .()-]", "_", c["name"]) + ".adg"
        with gzip.open(os.path.join(folder, fname), "wb") as g:
            g.write(xml.encode("utf-8"))
        written += 1
        print("%-10s %s" % (c["kind"], os.path.join(folders[c["kind"]], fname)))
    print("%d browser entries" % written)


if __name__ == "__main__":
    main()
