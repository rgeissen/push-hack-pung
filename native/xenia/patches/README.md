# Patches to gearmulator, applied by the recipe (scripts/recipes/nodalred.sh)

- `0001-mmu-remap-atomically.patch`: `MmuArray` made a block private by unmapping it and mapping it
  again. In between the address is free, and another thread's `mmap` can take it (the second DSP's JIT,
  malloc, a thread stack), to be overwritten by the map that follows. The Nord has two DSP threads, so it
  happened: on the Push the module crashed in `~JitBlockChain` on 6 of 8 shutdowns. `MAP_FIXED` replaces a
  mapping in one step; with the patch, 12 of 12 shutdowns were clean. Found 2026-11-18. Not sent upstream.
- `0004-xt-device-getxt.patch`: `xt::Device::getXt()`, so the engine can read the DSP's wave memory
  (Y:0x24000, the sound's table as the synth plays it): the tables the XT computes (28..51, 64..95)
  cannot be asked for over MIDI. Found 2026-11-22. Not sent upstream.
