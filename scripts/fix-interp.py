#!/usr/bin/env python3
"""Points every ELF executable under a folder at the Push's dynamic loader.

Push 3 has its loader at /lib/ld-linux-x86-64.so.2 only; executables linked
on Ubuntu name /lib64/ld-linux-x86-64.so.2 and fail to start there with "No
such file or directory" (JP-8000's DSP process, 2026-11-15). The new path is
shorter, so it is written over the old one in the PT_INTERP segment, padded
with NULs. Shared libraries have no PT_INTERP and are left alone.

    fix-interp.py <dir>      prints each file it changed
"""
import os
import struct
import sys

OLD, NEW = b"/lib64/ld-linux-x86-64.so.2", b"/lib/ld-linux-x86-64.so.2"


def fix(path):
    with open(path, "r+b") as f:
        h = f.read(64)
        if len(h) < 64 or h[:4] != b"\x7fELF" or h[4] != 2 or h[5] != 1:
            return False  # ELF64 little-endian only (x86_64)
        phoff, = struct.unpack_from("<Q", h, 32)
        phentsize, phnum = struct.unpack_from("<HH", h, 54)
        for i in range(phnum):
            f.seek(phoff + i * phentsize)
            ph = f.read(56)
            p_type, = struct.unpack_from("<I", ph, 0)
            if p_type != 3:  # PT_INTERP
                continue
            off, = struct.unpack_from("<Q", ph, 8)
            size, = struct.unpack_from("<Q", ph, 32)
            f.seek(off)
            cur = f.read(size).rstrip(b"\0")
            if cur != OLD:
                return False
            f.seek(off)
            f.write(NEW + b"\0" * (size - len(NEW)))
            return True
    return False


for root, _, files in os.walk(sys.argv[1]):
    for n in files:
        p = os.path.join(root, n)
        if not os.path.islink(p) and fix(p):
            print("interp:", os.path.relpath(p, sys.argv[1]))
