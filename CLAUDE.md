# CLAUDE.md

Working memory for agents (and people) on Pung: what the code does not say by itself, the commands that
work, and the mistakes that were made once and must not be made again. The subsystem documents hold the
detail; this file says when to read them.

Pung runs Schwung modules, and Pung-native ones, as Ableton Live devices on an **Ableton Push 3
Standalone**, with its own Push view (`src/`, Go), a web page, a module catalog that ships inside each
release, and native instruments built from gearmulator (`native/`).

## Read before touching

| Area | Read |
|---|---|
| Push view behaviour, pictures, motion, budgets | `docs/UX-GUIDELINES.md` |
| A module's `push_ui.js` (widgets, compartments, front panels, `g.*`) | `docs/overrides.md` |
| Native modules (emulators): rules, measurements, each instrument's quirks | `docs/NATIVE-MODULES.md` |
| Module builds for the Push | `docs/push-module-builds.md` |
| Architecture and history | `docs/DESIGN-v2.md`, `docs/DESIGN.md` |
| The public pages (manual, vision, design) | `site/README.md` |

## Layout

- `src/` Pung (Go, cgo bridge to Schwung's chain host). Tests beside the code (`*_test.go`).
- `native/<id>/` Pung-native modules: `module.json`, `push_ui.js`, `dsp/`, `tools/gen_params.py`,
  `patches/` (applied to gearmulator at build), listed in `native/catalog.json`, built by
  `scripts/recipes/<id>.sh`. Today: `nodalred` (Nord Lead 2X), `ostirus` (Virus TI), `vavra` (microQ),
  `xenia` (Microwave II/XT).
- `overrides/<id>/push_ui.js` screens Pung ships for Schwung modules.
- `scripts/` builds, catalog, release, render-check. `site/` the public pages (GitHub Pages).
- `build/`, `dist/` are outputs, never committed. Packages and firmware never go into git.

## Build and test

Everything builds in Docker (`push-hack-pung-builder`, linux/amd64; the Push 3 is x86_64, glibc 2.35).

```sh
make build                      # pung, livedevice.so
make test                       # go test ./... with cgo (the suite CI-equivalent)
make vet
make test-visuals               # web/visuals.js against the Go pictures, every fleet page
scripts/build-push-modules.sh <id...>          # modules -> build/push-modules/modules/<type>/<id>/
python3 scripts/build-catalog.py --base-url "" # the catalog -> build/catalog
```

- gofmt/vet/tests inside the image:
  `docker run --rm --platform linux/amd64 -v "$PWD":/w -v push-hack-pung-gomod:/root/go/pkg/mod -w /w/src push-hack-pung-builder sh -c 'gofmt -l .; go vet ./...; go test ./...'`
- **Run the test suite AFTER `build-catalog.py`.** `TestEveryCatalogModuleIsTagged` reads `build/catalog`;
  0.4.0 shipped OsTIrus untagged because the suite ran first.
- Screens offline: `PUNG_SHOTS=<dir> go test -run TestShippedOverlaysDraw .` writes every shipped screen
  as PNG (fake values: numbers where enum names belong, so filters and LFOs may draw empty there).
- `TestNativeScreensMove` plays a note through the native instruments' pages and fails on a still
  envelope, filter or LFO. Add a case for every new instrument page that draws one.
- **Hear a module without Live**: `scripts/render-check.sh <id> <assets dir> [secs] [key=val | '?key']`
  loads the shipping `dsp.so` as the chain host does, plays a chord and reports peak/RMS; `?key` reads a
  value before and after the chord. Env: `RENDER_SETTLE_MS` (a synth silent while it takes a sound in),
  `PUNG_SCAN_LOG`, `PUNG_MC68K_LOG`. The args go through `sh -c $*`: a value with a space breaks (use a
  bank's number, not "Bank B"); in zsh quote `'?key'`.
- Docker `go build` under amd64 emulation occasionally crashes at random: retry.

## The device

Access is `ssh -o HostKeyAlias=push.local root@<push-ip>` (`push.local` resolves IPv6 only; the host key
is filed under that alias). The Push has no curl: use `wget` on it.

- Pung: service `/etc/init.d/push-hack-pung`, HTTP on :7720, data in `/data/push-hack/data/pung/`,
  log `/data/push-hack/logs/pung.log`. push-manager (surface, display) on :7701. Remote Script (Live) on
  127.0.0.1:7704, JSON lines `{"id","ns","cmd",...args at top level}` (`track list/select/create`,
  `browser load {"name":"X.adg"}`, `device params/set_param {"track","path":[0,0,0],"index","norm"}`).
- `GET /api/devices` lists devices; `/api/devices/{n}/param?key=synth:K` (GET, POST `{"key","value"}`),
  `/api/devices/{n}/note {"note","velocity"}`. **`{n}` is not the position in that list, and numbers move
  after every Pung restart**: identify a device by what it answers (its `preset_name`).
- Surface: `POST :7701/api/surface/open {"id":"pung"}`; buttons `POST :7720/api/surface/press
  {"msg":[176,cc,127]}` then `[176,cc,0]` (Page Left/Right 62/63, upper row 102-109, lower 20-27,
  encoders 71-78); the screen `GET :7701/api/display/mirror/frame` (1920x320 PNG).
  `GET :7720/api/devices/{n}/compartments/{id}/screen.png?page=N` renders a band screen from real values
  (not front panels).
- **Always give the surface back: `POST :7701/api/surface/leave {"app":"pung","to":"live"}`.** An empty
  body answers 409 and leaves the Push with Pung; then Live's "recover your work?" question can be
  stranded after a Live restart.
- A device without Live: open `/data/push-hack/data/pung/devices.sock`, send `{"op":"create","uid":...}`
  (UIDs in `classes-known.json`). It answers every API call but has **no audio path**: an emulator that
  runs ahead of a ring stops when the ring is full, so anything that needs the engine to run (sound loads,
  sysex answers) needs a real device in Live.
- `late` in `/api/devices` counts blocks Live's plugin gave up waiting for (a dropout). Late blocks on all
  devices at the same moments are the system's, not one module's.
- Deploy Pung: `make deploy HOST=<push-ip>` (restarts Pung, not Live). Deploy one module: scp to
  `<file>.new`, then `mv` (never overwrite a loaded `.so` in place), then restart Pung. **Pung keeps a
  module's `push_ui.js` loaded: a new one needs a Pung restart.**
- Never write to `/boot`, `/opt` or kernel parameters; `/etc` only for Pung's init.d and udev items.

## Ask first

- **Apply** (`POST :7720/api/catalog/apply`) restarts Pung and **Live**: only on the user's word.
- Never create **audio** tracks through the Remote Script (it crashed Live once and lost its settings);
  MIDI tracks are fine. Say what test tracks you left in the user's Set.
- Commit and push only when asked; **publish a release only on "Publish"**.
- Firmware, ROMs and factory banks belong to the user: on their Push or in a scratch folder, never in the
  repository, a package or a public page. Do not point anyone to ROM downloads.
- Do not load emulators into the user's Set beyond what a test needs. With two emulators running, loading
  a third (OsTIrus in place of a test Xenia, 2026-11-21) left the Push unreachable on the network.

## Release

1. Bump `VERSION`, `hack.json` `version`, and the manual's eyebrow (`site/manual.src.html`).
2. **Build changed modules from the committed tree.** A package records the commit of the last change to
   `native/<id>` at BUILD time; built before the commit, the catalog links a source archive that lacks
   what ships (0.4.2 had to be republished for this). Check `source.commit` in `build/catalog/catalog.json`.
3. A module whose package changed needs a new version, or a new revision with its reason in
   `scripts/module-revisions.json` (Pung's own modules may bump `module.json` instead). The built copy of
   `module.json` is what counts: rebuild after bumping.
4. `python3 scripts/build-catalog.py --base-url ""`. Its guard compares with the LOCAL `build/catalog`;
   an unpublished run of your own can trip it. Override (`PUNG_ALLOW_UNREVISED=1`) only after checking
   the published catalog (inside `pung.tar.gz` of the latest release) does not hold that version and
   revision, then rerun without the override: it must pass.
5. `make build`, `make test`, `make vet`, `make test-visuals`, `python3 site/build.py`.
6. `GH=<gh> scripts/release.sh --publish` (sources first, then `v<version>`; rerunning replaces
   `pung.tar.gz` on an existing release and uploads missing sources). Verify: download `pung.tar.gz`,
   check `hack.json`, the catalog's versions and commits, and that every `source.archive` is on the
   `sources` release.
7. Site pages publish themselves on a push to `main` that touches `site/` (`.github/workflows/pages.yml`).
   `site/images.json` is one compact JSON line: keep it that way (`separators=(',',':')`).

## Native instruments (gearmulator)

- Engine pattern (Nodal Red first, then the others): the emulator on its own thread at FIFO 45 rendering
  into a ring; `render_block` only reads the ring; one instance at a time through
  `/dev/shm/pung-<id>.lock` (a second device says "Waiting"); a warm-up chord after boot so the first
  played notes do not underrun; the ring deep while a sound dump goes in; 6 dB headroom and a soft limiter.
- **Vavra and Xenia share `waldorf_engine.cpp`** (identical copies in `native/vavra/dsp` and
  `native/xenia/dsp`, selected by `WALDORF_MQ`/`WALDORF_XT`): edit one, copy, `cmp`.
- Parameters are generated: `tools/gen_params.py` writes `dsp/<x>_params.h` and the page lists between
  `// <pages>` markers in `push_ui.js` from gearmulator's `parameterDescriptions_*.json` and the LAYOUT at
  its top. Early pages must be full and repeat nothing: Live pads every page to 8 and keeps a limited list.
  `rawmap`: an enum whose options are not its raw values in order (XT effect types 0..7, 32..34).
- **The parameter list is fixed once released**: changing `chain_params` makes the device vanish from an
  open Set at Live's next start.
- **Install a module's ROM before the Apply that brings it into Live.** Without firmware the module
  publishes no parameters and Live registers Pung's own instead. A device inserted before an Apply keeps
  its old list length even with new names: count parameters on a freshly inserted device.
- gearmulator fixes live in `native/<id>/patches/`: XT bank B read bank A (`_loc + 128`), the 68000 core
  printed every LCD update to stderr (quiet unless `PUNG_MC68K_LOG`).
- Waldorf sysex: microQ `F0 3E 10 ..` (single 392 bytes), XT `F0 3E 0E ..` (single 265 bytes, boots in
  Multi mode: send a Single-mode dump after boot). XT wavetables: request a table `F0 3E 0E 7F 03 hh ll
  F7` (answer cmd 0x13, 64 wave ids, 65535 = interpolated slot) and its waves `02` (answer 0x12, 128
  samples) **one at a time** (the XT drops a burst); parse with `xt::State`. Tables 28..51 and 64..95 are
  computed by the synth and cannot be asked for; slots 61..63 are fixed triangle/square/saw.

## Writing screens (`push_ui.js`)

- **Envelopes, filters and LFOs through `g.envelope`, `g.filter`, `g.lfo`**, never a hand-drawn curve:
  only Pung's pictures move with the sound (note dots, the spectrum, an LFO playhead or restart flash).
  `color` keeps an instrument's palette; `still: true` for an envelope that does not run as a held note
  would. A screen that draws its own curve is still (Vavra and Xenia shipped that way once).
- **`g.layer(key, fn)` replaces the whole frame drawn so far**: one layer per frame, drawn first, with
  everything it depends on in its key. A second layer wipes the first.
- A screen gets only its page's keys plus `extra_keys` (a compartment screen: all its pages' keys). A
  picture that reads a key from another page needs it in `extra_keys`, or it silently draws a default.
- A front panel draws everything, including the knob row; with pages it can name the lower buttons
  (`draws_tabs`, `v.$tabs`, `v.$tab`).
- Budget: 8 ms a band screen, 14 ms a front panel. Thousands of `g.fill` calls (a dot-matrix display)
  only inside a cached layer.
- A value Pung cannot name (a raw value outside the declared range) should be left out, not shown as
  a number that means nothing.
- Verify on the Push with real values: walk every page (`Page Right` and capture each frame), play a note
  through the pages that should move, and give the surface back.

## Facts measured on a Push 3

- Live keeps a limited list of a Pung device's parameters, whole pages only (`fitLive`, `src/devices.go`):
  Vavra and Xenia get 128 entries in Live including "Device On" and page padding (97 and 119 of them
  the module's own). OsTIrus's count is not measured yet (the manual's "128 of 234" predates counting
  only named entries). Everything else is edited in Pung's view.
- Realtime device threads (FIFO 70) needed `GOMAXPROCS` well above the core count and a nice -15 boost
  while calling into a module (`gomaxprocs.go`, `lockboost_linux.go`), or emulators dropped blocks for
  everyone.
- The Push's own device view is the model for Pung's (jog wheel goes into a device, volume and tempo
  encoders stay Live's, Add and Swap stay Push's: Swap is Hot-Swap and can replace the device itself).
