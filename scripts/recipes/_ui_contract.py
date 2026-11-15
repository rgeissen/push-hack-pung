#!/usr/bin/env python3
"""ui_contract.h for modules that compile their ui_hierarchy / chain_params
JSON into the DSP as string literals (radiogarden, webstream): what their
build.sh's emit_json does, written out here instead of running it.
    _ui_contract.py <out.h> <NAME> <file.json> [<NAME> <file.json> ...]"""
import sys
out, pairs = sys.argv[1], sys.argv[2:]
with open(out, "w") as f:
    f.write("/* Generated from the module's src/*.json -- do not edit. */\n")
    for name, path in zip(pairs[0::2], pairs[1::2]):
        f.write("static const char %s[] =\n" % name)
        for line in open(path).read().splitlines():  # one literal per line, as sed does
            f.write('  "%s\\n"\n' % line.replace("\\", "\\\\").replace('"', '\\"'))
        f.write(";\n")
