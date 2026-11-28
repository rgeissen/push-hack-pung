# Pung for macOS: the proof

`docs/PUNG-MACOS.md` is the design. This folder holds what its proof is built from:

- `build.sh`: builds the plugin for macOS, Steinberg's validator and `pungstub` into `build/macos/`.
- `patches/core-darwin.patch`: the macOS port of Push Hack's device layer (`core/livedevice`, MIT), against
  the commit `src/go.mod` names. To change it: edit `build/macos/core`, then make the patch again
  (`diff -ruN` against a fresh export of that commit, without `.macbuild`).
- `cmd/pungstub`: a placeholder service. It installs `Pung.vst3` with the classes of a Pung and answers Live
  for each of them; no module runs in it.

```sh
macos/build.sh validate <classes.json of a Pung>      # build, and Steinberg's validator over every class
build/macos/pungstub -bin build/macos/livedevice -classes <classes.json> -http 127.0.0.1:7792
```

The second line installs into `~/Library/Audio/Plug-Ins/VST3` and `~/Library/Application Support/Pung`;
Live lists the devices at its next start. `-vst3` and `-data` name other folders for a test.
