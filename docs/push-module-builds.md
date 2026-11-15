# Building the Schwung catalog for Push 3

Every module in Schwung's catalog (`../schwung/module-catalog.json`) is built
from its own source for Push 3: x86_64 and glibc 2.35, the same as AbletonOS.
The output is packaged for provisioning, so a web service can hand modules out
later. Nothing here touches a Push.

```bash
scripts/build-push-modules.sh fetch     # first time: clone the catalog repos, image, deps
scripts/build-push-modules.sh           # rebuild everything from build/modsrc
scripts/build-push-modules.sh obxd sfz  # only these modules
```

Output, in `build/push-modules/`:

| File | What it is |
|---|---|
| `dist/<id>-push-x86_64.tar.gz` | one module, `<id>/...` inside: a Move module tarball's shape |
| `index.json` | the Push catalog: id, name, version, type, install subfolder, tarball, size, sha256, source repo and commit, `requires` |
| `REPORT.md` | built, failed and not built, with the reason |
| `modules/<subdir>/<id>/` | the installed tree |
| `logs/<id>.log`, `logs/status.tsv` | each module's build log |

## How a module is built

A module repo's own `scripts/build.sh` is **read, never run**. Those scripts
cross-compile for ARM in Docker, download things and push to devices. Running
third-party scripts was ruled out from the start.

1. `scripts/gen-recipes.py` reads each repo's build scripts (`scripts/build.sh`,
   `scripts/*build*.sh`, root `*.sh`, Makefiles) and writes
   `build/recipes/<id>.sh`, a plain compile recipe anyone can read.
   - **Sources:** the files the script compiles. In a repo with several modules,
     only those of the command that writes this module's `.so`. Files with a
     `main()` (tests, tools) are left out.
   - **Paths:** the script's own variable assignments are substituted, so
     `$BUNGEE_DIR/src/*.cpp` resolves. Simple `for` loops are expanded.
   - **Flags:** `-I`, `-D`, `-std`, `-include` and `-l` are kept; ARM tuning is
     dropped.
   - **Include folders:** found by following the sources' `#include`s. A folder
     with its own `string.h` (or another libc name) is never added: it would
     shadow the system header.
   - **Data:** the module folder minus sources, plus what the script copies into
     the module's folder, renames included (`src/ui_overtake.js` -> `ui.js`).
   - **CMake projects:** configured for this machine with no ARM toolchain
     file, built from a writable copy, with the targets the script names.
   - **Host headers:** Schwung's `src` and `src/host` (`plugin_api_v1.h`, ...)
     come last, so a module's own copy wins.
2. `scripts/recipes/<id>.sh` is a hand-written recipe and wins over the
   generated one. There are 13. Each says in its header why it exists:
   - libraries a module downloads at build time (keydetect, dragonfly-hall, dj);
   - headers its script generates (radiogarden, webstream);
   - patches it applies (capicola);
   - two copies of one library in one `.so` (chiptune);
   - bungee's defines (stretch, slicer, performance-fx);
   - NeuralAudio's CMake (nam);
   - a Rust part (sfz);
   - ARM helper programs rebuilt for x86_64 (kit-builder).
3. `scripts/build-all.sh` runs the recipes in the `push-hack-pung-modules`
   image (`docker/Dockerfile.modules`: the Ubuntu 22.04 builder plus a pinned
   Rust nightly), with **no network**. Sources are read-only, and external
   dependencies come from `build/deps` (`scripts/fetch-deps.sh`, pinned
   versions). Each module has 30 minutes.
4. `scripts/package-push-modules.py` refuses any module where:
   - an ELF file is not x86_64;
   - an ELF file needs a glibc newer than 2.35;
   - the DSP does not load the way the chain host loads it (`dlopen` with
     `RTLD_NOW`, every symbol resolved) with a Pung entry point exported
     (`scripts/loadtest.c`). This check caught 15 modules that compiled but
     were missing a library.

`scripts/recipes/not-for-push.json` lists the modules that cannot be built for
the Push, and why.

## Known limits

- **Compiled and loaded is not tested.** No module has run on a Push from this
  pipeline yet.
- **41 repos hard-code Move's paths** in their DSP code
  (`/data/UserData/schwung/...`, `/data/UserData/UserLibrary/Samples`). They
  need a path decision on the Push before they work there.
- **ROMs and assets** are never included (`requires` in `index.json`). JV-880,
  Osirus, JP-8000 and rrverb10 need ROMs; sf2, sfz and nam need user files.
- **Licences:** each package carries the repo's licence files. Several modules
  statically link GPL code, and dj links fdk-aac, whose licence restricts
  redistribution. Review this before serving the packages publicly.
