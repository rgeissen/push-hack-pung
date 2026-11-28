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
| What devices cost (processor, energy), `GET /api/governor` | `docs/GOVERNOR.md` |
| Where Pung goes: the Pung stack, Set compatibility, hosts, the phases, what is sold | `docs/PUNG-STACK.md` |
| One parameter order for every Pung (the groundwork's first piece; a design, not built) | `docs/SET-CONTRACT.md` |
| Pung in Live on macOS: Sets that cross between a Push and a Mac, the same experience there; a design and its proof | `docs/PUNG-MACOS.md` |
| Patches (what one Pung device holds, moved between deployments; built as "Stacks" on 2026-11-27) | `docs/STACKS.md` |
| pung.live and a deployment over https (so it works in Safari and on an iPad): half built, a plan for the rest | `docs/SECURE-LINK.md` |
| Architecture and history | `docs/DESIGN-v2.md`, `docs/DESIGN.md` |
| The public pages (manual, vision, design) | `site/README.md` |

## Layout

- `src/` Pung (Go, cgo bridge to Schwung's chain host). Tests beside the code (`*_test.go`).
- `native/<id>/` Pung-native modules: `module.json`, `push_ui.js`, `dsp/`, `tools/gen_params.py`,
  `patches/` (applied to gearmulator at build), listed in `native/catalog.json`, built by
  `scripts/recipes/<id>.sh`. Today: `nodalred` (Nord Lead 2X), `ostirus` (Virus TI), `vavra` (microQ),
  `xenia` (Microwave II/XT), and `vivace`, a port of an open-source wavetable synth (GPLv3; its licence
  forbids its name on a build: it appears only in `licenses/NOTICE.txt`).
- `overrides/<id>/push_ui.js` screens Pung ships for Schwung modules.
- `scripts/` builds, catalog, release, render-check. `site/` the public pages (pung.live).
- `installer/` the Pung Installer (its own Go module, pure Go, no cgo): a local page in the browser; SSH to the
  Push (key at `push.local/ssh`, Shift+Select+Preferences), Push Hack at the ref in `site/install.json` where
  missing, then Pung as Push Hack Catalog installs it (port 7720 kept or chosen). `scripts/build-installer.sh` ->
  `build/installer/` (macOS app, Windows, Linux), published as pung.live/download/ by `make publish-site`.
  Phase 1 of leaving Push Hack (2026-11-27): Pung's dependencies on it are core/livedevice, alsaseq, audiobus, gfx,
  hackcfg, pmclient, push-manager's surface API (:7701) and the PushHack Remote Script (:7704).
  Test it against a fake Push: an ubuntu container with sshd, /data, /etc/init.d/push3 (a stub). Running a new
  binary on the owner's Mac meets the LuLu firewall (it blocks until allowed).
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
  **As the Push draws them**: `PUNG_GALLERY=<dir> PUNG_GALLERY_CACHE=<module-screen.json from the Push>
  [PUNG_GALLERY_VALUES=<dir of <id>.json>] [PUNG_GALLERY_ONLY=a,b] go test -run 'TestGallery$' .`: every
  page with the module's real metadata and values, Pung's whole frame, and each segment mode. A module
  is drawn only once the cache holds its probe (copy `/data/push-hack/data/pung/module-screen.json` after
  the module has been loaded on the Push).
- `TestNativeScreensMove` plays a note through the native instruments' pages and fails on a still
  envelope, filter or LFO. Add a case for every new instrument page that draws one.
- **Hear a module without Live**: `scripts/render-check.sh <id> <assets dir> [secs] [key=val | '?key']`
  loads the shipping `dsp.so` as the chain host does, plays a chord and reports peak/RMS; `?key` reads a
  value before and after the chord. Env: `RENDER_SETTLE_MS` (a synth silent while it takes a sound in),
  `PUNG_SCAN_LOG`, `PUNG_MC68K_LOG`, `RENDER_WATCH=<key>` (read while the chord plays), `RENDER_LATE=<ms>`
  (rendered, paced, before the settings go in). **JE-8086 (`jp8000`) needs `RENDER_LATE=9000`**: without it
  the check itself crashes right after the boot, the old build as the new (2026-11-27). The args go through `sh -c $*`: a value with a space breaks (use a
  bank's number, not "Bank B"); in zsh quote `'?key'`.
- Docker `go build` under amd64 emulation occasionally crashes at random: retry.
- **core is upstream's** (`federico-pepe/ableton-push-hack`), at a commit on its `main`
  (`livedevice.Looper`, which `rtloop.go` needs, is merged there but in no core tag yet): move to
  `core/v0.6.1` or later once tagged (`go get .../core@core/v0.6.1`). To change core: clone it next to
  Pung, add a `replace` to `../../ableton-push-hack/core`, mount it at `/ableton-push-hack` in Docker,
  and send the change upstream; Pung never ships against a replace (the fork, 0.4.0-0.4.5, lacked
  upstream's rack-manifest fix). `src/livedevice_ipc.h` is core's header, byte for byte
  (`TestIPCHeaderIsCores`).

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
- **While Pung's view owns the surface, push-manager's hook (push-display `push_hook.c`) passes Live only
  the pads, their pressure and pitch bend (Pads), and a controller only when the session names it**
  (`liveButtons`). The touch strip in its mod wheel mode (Select + tap) sends CC 1: without it in
  `liveButtons` the strip's mod wheel never reached a device, Pung's Wheel source included (found
  2026-11-24 with a logging build of core's plugin: Live sends the mapped mod wheel as soon as the hook
  lets CC 1 through). The strip's touch note (12) is still held back; Live does not need it.
- Known, not Pung's: after a hack hands the surface back, Delete's light stays dark though the button
  works (2026-11-23). push-manager clears every light and has Push3 redraw with a Shift tap and a
  pad-mode toggle, which does not redraw Delete; push-manager cannot see Push3's lights to restore them.
  Tracks are deleted from Session or Mix (Delete + track), as in Push's own device view.
- **Play a module once in Live without touching the Set's music**: `scripts/push-playtest.py` (run on the
  Push) loads its rack onto an empty MIDI track through the Remote Script, plays a chord through Pung, reads
  Live's meter (`meters get`: each track's left and right) and `live_mod`, and deletes the device again
  (`device delete {"track","device"}`; Live names the track after what is on it and back). `track select`
  takes `"track"`, not `"ref"`: with the wrong name it answers `bad_track` and a `browser load` after it goes
  onto whatever track is selected (it replaced the owner's Dexed with a rack of the same state, 2026-11-27).
- **Always give the surface back: `POST :7701/api/surface/leave {"app":"pung","to":"live"}`.** An empty
  body answers 409 and leaves the Push with Pung; then Live's "recover your work?" question can be
  stranded after a Live restart.
- A device without Live: open `/data/push-hack/data/pung/devices.sock`, send `{"op":"create","uid":...}`
  (UIDs in `classes-known.json`). It answers every API call but has **no audio path**: an emulator that
  runs ahead of a ring stops when the ring is full, so anything that needs the engine to run (sound loads,
  sysex answers) needs a real device in Live.
- `late` in `/api/devices` counts blocks Live's plugin gave up waiting for (a dropout). Late blocks on all
  devices at the same moments are the system's, not one module's.
- Pung's service script is push-catalog's: its restart sends `kill -9` after 5 s and starts the new Pung at
  once. Pung therefore takes its port first and waits up to 15 s for it (`listenWaiting`); before that a
  hung Pung left the new one without its port and Pung down (2026-11-22). The devices' states are filed
  while Pung runs (`kept-states.json`, 2 s after a device goes quiet), so a Pung that hangs or crashes
  gives the next start every sound but the last seconds' (killed with `kill -9` on the Push, 2026-11-23).
- **Watchdog** (`watchdog.go`): a call into a module that runs past its limit (module load or destroy
  90 s, a parameter 30 s, a block or MIDI 5 s) restarts Pung as the same process (the hang in the log,
  `hangs.json`; the surface given back; states from `kept-states.json`). A module that hangs twice in
  15 minutes is refused until then. Nothing else restarts a Pung that died: the service has no
  supervisor. Tested 2026-11-23 with a module whose `set_param` never returns.
- **Never deploy while a build is still running** (`scripts/deploy.sh` beside a `make build` in the
  background): rsync warned "file truncated while reading" on `livedevice.so`, the plugin Live loads, on
  2026-11-27. That time nothing was replaced; check the Push's `livedevice.so` and `Pung.so` against the
  local file by checksum after any deploy that warned.
- Deploy Pung: `make deploy HOST=<push-ip>` (restarts Pung, not Live). Deploy one module: scp to
  `<file>.new`, then `mv` (never overwrite a loaded `.so` in place), then restart Pung. **Pung keeps a
  module's `push_ui.js` loaded: a new one needs a Pung restart.**
- Never write to `/boot`, `/opt` or kernel parameters; `/etc` only for Pung's init.d and udev items.

## Pung on macOS (branch `macos`, a proof: `docs/PUNG-MACOS.md`)

- `macos/build.sh` builds the plugin, Steinberg's validator, a host test and Pung for this Mac into
  `build/macos/`; `macos/build-modules.sh` the chain host and the first modules. Go, CMake and the VST3 SDK
  are fetched into `build/tools` and `build/deps`; nothing is installed on the machine.
- **A new program on this Mac cannot reach the network** (LuLu asks, and nobody answers at night): the Go
  toolchain takes its modules from the project's Docker volume (`build/tools/goproxy`), and `git` and `curl`
  fetch the rest.
- **A plugin bundle is signed as it stands**: Live refuses one whose Info.plist differs from the one its
  binary's signature names. The install step signs again after writing; the class file stands beside the
  bundle, never in it.
- Live on the Mac is asked to quit with `osascript -e 'tell application "Ableton Live 13 Beta" to quit'`.
  With unsaved changes it asks about saving and stays: never answer that for the owner. With the owner's
  word that the Set may go (given 2026-11-28 for a test Set): end Live's process and move `BaseFiles`, `Undo`,
  `Undo.lock`, `CrashRecoveryInfo.cfg` and `CrashDetection.cfg` out of its preference folder into its
  `Crash` folder, or it asks to recover at the next start (a key press cannot be sent: no assistive access). A restart of Live
  may update it (13.0b27 became 13.0b28 that way, 2026-11-28); its logs are per version
  (`~/Library/Preferences/Ableton/Live <ver>/Log.txt`, `PluginScanner.txt`).
- The shared realtime loop (`src/rtloop.c`, `src/bridge.c`, `src/ratebridge.c`) is the Push's too: after a
  change there, `make build` and `make test`.
- Sound on this Mac at night: mute the output first (`osascript -e 'set volume output muted true'`), put
  it back after.

## Ask first

- **Apply** (`POST :7720/api/catalog/apply`) restarts Pung and **Live**: only on the user's word. It keeps
  the unsaved edits of Pung devices (`armForLiveRestart`, since 2026-11-23; before, an Apply undid them).
  The same restart without the catalog: write `<data>/restart-live-after-start`, restart Pung's service.
- **Opening a Set file with no one at the Push** (a test): Live's recovery loads
  `BaseFiles/<name>.als` when the session holds a change (a track added through the Remote Script; a
  tempo change is not enough) and the base's MD5 matches the 16 bytes stored in `CrashRecoveryInfo.cfg`
  (offset 1214 on 13.0b25). Freeze Live, put the Set's file in under the base's name, write its MD5
  there, run `restart-live.sh`: it answers the recovery question. Live 13 on the Push ignores a user
  default template, and its browser cannot load a Set.
- **A test that restarts Live runs in a throwaway Set**, never the user's working one: Live recovers the
  Set by replaying its history, and a plugin that changed under it can crash that replay. 2026-11-23: a
  test class's parameter given an id of 935340406, with automation on the device, crashed the recovery
  (`ASSERT ... flip/src/Float.cpp:114`) and Live opened an empty Set; the Set was restored from
  `Crash/<time>_*` (backed up first) after the class was put back. Keep parameter ids small.
- Never create **audio** tracks through the Remote Script (it crashed Live once and lost its settings);
  MIDI tracks are fine. Say what test tracks you left in the user's Set.
- Commit and push only when asked; **publish a release only on "Publish"**.
- Firmware, ROMs and factory banks belong to the user: on their Push or in a scratch folder, never in the
  repository, a package or a public page. Do not point anyone to ROM downloads.
- Do not load emulators into the user's Set beyond what a test needs. With two emulators running, loading
  a third (OsTIrus in place of a test Xenia, 2026-11-21) left the Push unreachable on the network.
  Pung now refuses a third (`emulatorRefused`, `limits.go`; a kind that runs one at a time counts
  once): the device waits, silent, and starts when one is removed (Live's plugin asks every second).
  **That count is the Push's, not Pung's** (the owner, 2026-11-28: each deployment carries its own limits;
  `src/deployment.go`): a Mac has none, and the governor's room check uses costs measured on a Push only on
  a Push. A new kind of deployment gets its limits there, measured, not copied.

## When the Push froze: getting an unsaved Set back

After a hard freeze Live may open its empty default Set instead of asking to recover ("Detected a prior
crash ... no EventRecording available"): the freeze cut off the recovery history it was writing. Each
start after a crash moves the recovery data aside into `/data/.config/Ableton/Live <ver>/Crash/<time>_`
`{BaseFiles,Undo,CrashRecoveryInfo.cfg}`; an earlier one (from the last Live restart) usually holds the
Set as it was then (its `Undo/0.band` is megabytes, a cut-off one is under a kilobyte). To restore it,
with the user's go: `kill -STOP` Live (so it writes nothing more), back up the live `BaseFiles`, `Undo`,
`CrashRecoveryInfo.cfg` and `CrashDetection.cfg`, copy the chosen `<time>_*` contents in their place
(owner `ableton:users`), `kill -9` Live; the launcher starts it again, it asks "Would you like to recover
your work?", and the same CC 27 that `restart-live.sh` sends answers Yes. Done 2026-11-21: the Set came
back as of the previous restart. Then ask the user to save the Set.

## Release

0. **The chain host must be in `build/modules/chain/dsp.so`** (`make modules`; `build/patches` too). Pung does
   not start without it, `make release` does not build it, and `build/` is not kept: 0.4.3 to 0.5.0 shipped
   without it, so a fresh install did not start (found 2026-11-26; `release.sh` and `release-check.py` now
   refuse). `make modules` needs a Schwung checkout that has `chain_bus.c` (upstream's `worktree-vst`, 97a30523;
   the local `../schwung` main has not). The known-good files are those of 0.4.2's package, byte for byte what
   runs on the owner's Push (chain host md5 8574dd39…). Prove a package on a stand-in Push before publishing:
   an amd64 ubuntu container with sshd and `/lib/ld-linux-x86-64.so.2 -> /lib64/...` starts Pung.
1. Bump `VERSION`, `hack.json` `version`, and the manual's eyebrow (`site/manual.src.html`).
2. **Build changed modules from the committed tree.** A package records the commit of the last change to
   `native/<id>` at BUILD time; built before the commit, the catalog links a source archive that lacks
   what ships (0.4.2 had to be republished for this). Check `source.commit` in `build/catalog/catalog.json`.
   The module build notes the commit it built from (`build/push-modules/logs/<id>.commit`), and packaging
   refuses a module whose source has moved on since: Vial once went out as built before its change, under
   the commit after it (2026-11-27; a fork added to `local-sources.json` after the module was last built).
3. A module whose package changed needs a new version, or a new revision with its reason in
   `scripts/module-revisions.json` (Pung's own modules may bump `module.json` instead). The built copy of
   `module.json` is what counts: rebuild after bumping.
4. **The module list is Schwung's catalog as of the release** (since 0.4.5; 0.4.3 and 0.4.4 kept 0.4.2's):
   fetch it from upstream (`charlesvestal/schwung`, `module-catalog.json`; the local `../schwung` is the
   owner's older fork) into `build/schwung-upstream/module-catalog.json`, build with
   `CATALOG=<it> scripts/build-push-modules.sh [fetch] <id...>` and the catalog with `PUNG_SCHWUNG=<its dir>`.
   The catalog withholds what has no licence (or one that forbids shipping: PolyForm Strict) and what only
   acts on Move's own UI (`scripts/catalog-policy.json`). Every new module needs its Ableton tags
   (`src/ableton-tags.json`) and is played once as a device in Live on the Push before a release. Compare
   the module count with the last release's (`pung/catalog/catalog.json` inside `dist/pung.tar.gz`).
   **A package carries the version its author released** (`released`, `stamped` in
   `package-push-modules.py`, since 2026-11-27): an author's release writes the number from the
   repository's `release.json` into the packed `module.json`, and the source often still has the one
   before. Four modules of the 0.6.0 pack were current in code and one or more releases behind in name
   (Shimmerwash said 0.3.0 for 1.0.1). A fork build's fourth number is kept behind it (0.0.4.1). A fork that
   is really behind is brought up with `git rebase origin/main` in its working copy (its one commit; the
   conflicts are the version files) and gets `<upstream>.1`.
   **`scripts/schwung-updates.py` says what Schwung has that the pack lacks** (newer releases, new modules,
   which are built from a fork of Pung's that must be brought up first): run it before a release; it changes
   nothing. On 2026-11-27 it found six newer upstream, four of them forks. `catalog-service/` (the service
   of 2026-11-21 that would check nightly, build on the DiskStation and publish) was never started and
   knows nothing of what a pack needs since: the signature, the registry, tags, pictures, the forks.
   `python3 scripts/build-catalog.py --base-url ""`. Its guard compares with the LOCAL `build/catalog`;
   an unpublished run of your own can trip it. Override (`PUNG_ALLOW_UNREVISED=1`) only after checking
   the published catalog (inside `pung.tar.gz` of the latest release) does not hold that version and
   revision, then rerun without the override: it must pass.
5. Commit, push `main` (and any module fork the catalog links: JE-8086's `remote-ui` was not, for
   0.4.5), then **`make publish`** (`make release` packages without publishing). It runs
   `scripts/release-check.py` (a clean tree; one version in VERSION, hack.json and the manual; the
   catalog built after its inputs and naming each own module's last commit; every source commit on
   GitHub or its archive on `sources`; HEAD on origin/main), then build, screens, test, vet,
   test-visuals and the site in that order, checks again (the binary and the pictures newer than their
   inputs, the tree still clean), and `scripts/release.sh --publish`.
6. `release.sh --publish` puts the sources on pung.live first (`sources/`, never replacing one), then
   `releases/v<version>/pung.tar.gz` (checked by its checksum and through https), then `release.json`
   there and on `main` (Push Hack's store reads it from GitHub), and the tag. Verify: download
   `pung.tar.gz` from pung.live, check `hack.json`, the catalog's versions and commits, and that every
   `source.archive` answers. Releases up to 0.5.0 and their sources stay on GitHub's releases.
7. The pages: `make publish-site` (not on a push any more). It also writes `modules/`: Pung's own Modules page
   (`src/web/modules.js` with `<body data-public>`) from the release's catalog and `build/screens`. Connected
   to a visitor's Push (Local Network Access: the browser asks; Chrome/Edge 142+, Firefox 151+) the site reads
   how it stands (Deployments) and installs what a stack needs (Stacks); the Modules page itself asks
   nothing. Pung lets only https://pung.live read those few calls (`src/sitecors.go`).
   Never send `targetAddressSpace: "local"` for a `.local` name or an IP literal: push.local also resolves to
   a global IPv6 address, which Chrome counts as public, and the request fails (Chrome 158, 2026-11-26).
   Test it with Chrome over CDP: `Browser.grantPermissions` with localNetwork in ONE call (it rejects the rest). `site/images.json` is one compact JSON line:
   keep it that way (`separators=(',',':')`).

**Rehearse a release without publishing** (done 2026-11-27, before 0.6.0; it found five things the checks
alone did not): a stand-in for the DiskStation (a container with sshd, rsync, `/volume2/web/pung` and
`python3 -m http.server` on it, its ports published), the scripts pointed at it with `PUNG_LIVE_HOST=root@127.0.0.1`,
`PUNG_LIVE_URL=http://<this Mac's address>:<port>` (an address a container reaches too) and
`PUNG_LIVE_PORT="<port> -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i <key>"` (the port is
put into the ssh command unquoted; `release-check.py` cannot take it so). `release.sh --publish` commits, tags
and pushes: run it in a clone whose `origin` is a bare folder, `build` linked in and `pung`, `livedevice.so`,
`restart-live.sh` copied. Then `publish-catalog.sh`, the Pung Installer (its Linux build in a container,
`PUNG_INSTALL_JSON` naming a staged `install.json`) against a stand-in Push (the key for `root` and for
`ableton`: Push Hack is installed as `ableton`), and Pung there with `PUNG_PACK_URL`: the same pack (kept its
own), a newer one (taken), one changed after signing (refused).

**pung.live** is the owner's DiskStation (DS412+, DSM 6.2, Web Station): one virtual host on
`/volume2/web/pung` (pages at the root, `brand/`, `modules/`, `releases/`, `sources/`, `release.json`),
Let's Encrypt for pung.live and www.pung.live, DNS at Hostinger (A record to the home's address; it
changes rarely: when it does, pung.live is down until the record is changed). Scripts take the server
from `PUNG_LIVE_HOST` (`scripts/pung-live-env.sh`) and touch nothing outside that folder: the share
serves other sites.

## The site (pung.live)

Three sections in front, everything else in the footer (the owner's word, 2026-11-27): the hero page
(`home.src.html`: the value, and a Push screen that plays: `site/hero.js` feeds a made-up sound to Pung's own
pictures, `src/web/visuals.js`, so the page draws what the Push draws), **Modules** (`site/modules.html` with
`src/web/modules.js` in its public mode) and **Deployments** (the page; `deployments.src.html`, `site/deployments.js`; `devices.html` goes on to it: install,
and a panel for every connected deployment: processor with its last minute, memory, storage, battery, what plays,
Pung against the newest, its modules, Pung's two switches). Vision, Manual, Design and Performance are built as
before and linked in the footer.

- **A Pung that is not the newest says so, and names the Pung Installer** (the owner's word, 2026-11-27; Pung
  does not update itself). The site names the newest release (`release.json`); `pushlink.js` (`behind`) marks
  the chip on every page and its dialog, Deployments puts a notice first in the panel, each with the way to
  `deployments.html#installer`. Pung reads the same file now and then (`src/newest.go`, `PUNG_RELEASE_URL` for
  a staging copy; never with `own_pack_only`) and answers `"newest"` in `/api/status`; its own page shows it
  beside the version. Preview it: a scratch build of the site with a later version in its `release.json`.
- **The foot of every page** (`site/footer.css`, `footer()` in `build.py`; the Modules page has it too, with
  its own stylesheet's colours): the logo and the line, four columns (the sections in front, the pages to
  read, the projects Pung stands on, legal), the fine print set apart. **Legal notice and Privacy**
  (`legal.src.html`, `privacy.src.html`) take the owner's details from `site/legal.json`; an empty field
  shows as "to be added" on the page. The privacy page states what the site does: change it when the site
  starts to do anything else (a cookie, a counter, a file from another host, an account).
- **The typefaces are Pung's own** (`src/web/fonts/`: Archivo, IBM Plex Mono, Plus Jakarta Sans as WOFF2, Latin and
  Latin Extended, each under the OFL; about 300 KB). They are built into Pung, which serves them to its own
  page (`/fonts/faces.css`, linked from `index.html`), and `site/build.py` (`faces()`) puts the same rules
  into every page of pung.live and copies the files there: one set, moved from `site/fonts/` on 2026-11-27.
  No page asks another host for anything (a visitor's address sent to a font service is a legal risk for a
  site run from Germany). Keep it so: no script, style, font or picture from another host.
- **Stacks** (`stacks.src.html`, `site/stacks.js`; a fourth entry in the menu, between Modules and Deployments,
  once the site is launched): since 2026-11-27 a stack on that page is a Set's (`docs/PUNG-STACK.md`, Phase 1).
  The visitor's stacks are kept in their browser (IndexedDB `pung`/`stacks`, a file `.pungstack` to carry
  one). **Take**: the stack of the Set open on a connected deployment (`GET /api/stack`, `src/setstack.go`).
  **Check a deployment**: `POST /api/stack/check` says how each module the stack names stands there (ready,
  install, update, restart, firmware, pung, unknown); the page installs what is missing through that
  deployment's own pack (`POST /api/catalog/{id}/install`) and restarts Live there only after the visitor
  has confirmed (`/api/catalog/apply`). The Set itself moves as Ableton moves it: Pung never reads a Set
  file. What ONE device holds is a **patch** (`pung_stack` 1, `src/stacks.go`: `GET /api/stacks`,
  `GET /api/stacks/playing/{n}`, `POST /api/stacks`, `POST /api/stacks/remove`), on the same page under
  "Your patches"; a patch a Push takes is a rack in Push's browser, in "Pung Stacks". Try the page without
  a Push: the scratch `fix/mock.py` (the Push's catalog, a Set of seven devices, a check that moves on as
  the page installs and restarts). `pung.css` gives every `article` a 64-pixel gap: a card that is an
  article sets its own.
- **Several deployments, several kinds** (the owner's word, 2026-11-27: the Push is the first hardware Pung
  runs on, more kinds will follow, and a visitor may own more than one of a kind). `site/pushlink.js` + `pushlink.css` hold the
  list for every page (in the visitor's browser: `pung.devices`, the one modules install on in `pung.device`;
  classes `pl-`, colours from whichever stylesheet the page has). A kind is an entry in its `KINDS` (label,
  default address, port, hint) and a `"kind"` in what it answers; nothing else on the site names the
  Push where it means "a deployment". A second one of a kind is added by its IP address (both answer to
  push.local).
- **One home for each thing** (the owner's word, 2026-11-27: an easy way between what the Push serves and what
  pung.live serves, and nothing shown twice unless it must be). On the Push's own page: playing and editing
  the devices in the Set, sounds, samples, ROMs, installing, updating and removing a module. On pung.live:
  the deployment at a glance, Pung's version and updates, the installer, the manual, every module with its
  pictures. On both, on purpose: Pung's switches (offline on the Push, and in its panel on pung.live).
  **pung.live holds nothing about one Pung install outside its Deployments section** (the owner's word,
  2026-11-27, of a deployment's box, counts and "Update all" in the Modules page's head). So pung.live's
  Modules page is the catalog alone (`modules.js` in its public mode asks no deployment anything): it has
  no install button at all, on a card or in a module's sheet (the owner, the same day): a module is
  installed on a deployment's own page, one press away in the place switcher. What a deployment has
  installed, its updates and the restart of Live are on its own page and counted in its panel on
  Deployments. The Stacks page still talks to a deployment when the visitor takes or checks a stack. That dashboard is never rebuilt on the Push's page. **Stacks are
  managed on pung.live** (the owner's word): a deployment plays one and hands its state over, and its own page
  grows no stack library (`docs/STACKS.md`).
  **The hand-off**: the Push's page links to pung.live with `#add=<its own address>` (`siteLinks`, `app.js`;
  shown only while the browser reaches pung.live), and `pushlink.js` (`arrived`) connects that deployment without
  the address typed again (a home-network name or address only); pung.live links back to the place on
  Pung's own page there (its start for devices and sounds, `#setup`, `#modules/<id>`).
- **`GET /api/system`** (`src/system.go`): the deployment at a glance for that page and Pung's own. The processor's
  numbers are what was used since the last request (nothing runs between requests), in percent of the whole
  machine. On the owner's Push: AbletonOS 4.2, no battery in `/sys/class/power_supply` while on power.

- **The hero's logo** (`{{BIGLOGO}}`, `biglogo()` in `build.py`, `site/ride.js` put into the page right after
  it; the owner's word, 2026-11-27): the logo as wide as the page, and its dot rides from the G through N
  and U to its place on the P (a ball on a track: slower the higher it is; one mask over all four letters,
  so the gap travels with it). Once as the page opens, again on a press, never where motion is turned down
  or without the script (the logo then stands as drawn). The bar keeps its small logo, still, on that page
  too: hiding it while the large one was in view read as a logo gone missing (the owner, 2026-11-27). The small logo's offset is 0.8 px at 22 px high (27.4 of the drawing's 740.9 units).
- **The tagline is "Open · Instrument · Platform"** (the owner's word, 2026-11-27; before that day's end it
  had been "The open instrument platform"). On the front page it stands under the logo on one line as wide
  as the logo, in spaced capitals with the dots in the logo's cyan (`.lockup.stacked`, `.tag`; sized in the
  stylesheet alone), and the lockup is at most 520 px wide: the page's signature, not a banner. The slogan
  "Open music modules, at home on every device." is a small line under it (`h1.slogan`), by the owner's
  word. Tried and turned down the same day: the tagline as the headline; the logo across the whole column
  ("too dominant"); the slogan as the largest thing on the page. The tagline beside the logo in three
  lines is built (`.tagside`) and not used. It is the footer's line and the link preview's too. Pung is
  spoken of as the platform (host, interface in two levels, modulation, governor, deployment), never as a
  collection of modules, and not as a Push add-on: the Push is where it is today (the "Today" line).
- **The hero uses the page's width on three lines** (the owner, 2026-11-27, of a narrow column down the left:
  "not satisfied how the screen estate is used and how everything is aligned"): the lockup on the left (5 of
  12), centred on the height of what stands beside it (as the eye sees it: the room above its letters is
  the dot's and does not count; measured equal above and below at 820, 1180 and 1440), a light rule in the
  middle of the gutter, what Pung is on the right (7 of 12), and a bar across both with today's status on
  the left and the two buttons on the right edge. One column from 760 px down. Every block ends on the left edge, the gutter or
  the right edge: nothing with an edge of its own.
- **Replacing a block of `pung.css` by its first and last line took the buttons' styles with it** (2026-11-27,
  caught in a picture before anything was published). After such an edit, read what the diff removes.
- **The twist on the P** (the owner's idea, 2026-11-27): once landed the dot goes down the bowl and back up
  to where it rests, as a hand turns an encoder and lets it come back. Only that: the owner turned down a
  version that went both ways and dimmed the P's stroke beyond the dot. Built in `ride.js`, played where
  the logo carries `data-twist` (`biglogo()`); approved from a mockup and on the site since 2026-11-27.
  Show a change to the logo's motion as a mockup first (an Artifact page with the real script).
- **The front page is in sections** (the owner's word, 2026-11-27: "it's all over with no clear separation"):
  each a band across the page with its own ground, the same room above and below and the same head (a word
  in orange, a heading, one sentence): the hero; the stage (`.stage`: the Push's screen, dark in both themes
  as the hardware is); the interface; the platform (on the surface colour); the way in (a panel). A new
  block on that page is a `section.band.sect` with a `.sec-head`, never loose content between two others.
  `scratch mockup/from-site.py` turns a built `index.html` into one file for an Artifact mockup.
- **Scrolling the front page settles on a section's start** (the owner, 2026-11-27): `scroll-snap-type: y
  mandatory` on that page alone (`html:has(main.front)`), each section a start, the foot the page's end (or
  it could not be reached), the bar's real height as the room above (`ride.js`; two rows on a phone). A
  section taller than the screen scrolls freely inside. A new section there needs nothing more; a new
  block that is not a `.sect` would be skipped over. **And one section has the screen to itself** ("no
  overlap between the sections"): each is at least the screen under the bar tall, its content in the
  middle; the last leaves the foot its room so the two fill the last screen together (`--bar`, `--foot`
  from `ride.js`). Measured at 1180x700 (a tablet held wide, Safari's bars taken off): every section fits.
  A section that grows must still fit there, or it is cut where the page settles.
- **The light and dark switch** (the owner's word, 2026-11-27; `site/theme.css`, `THEME_HEAD` and
  `theme_button()` in `build.py`): a round button at the right end of every page's bar. A page follows the
  visitor's system until it is pressed; then the choice, kept in their browser (`pung.theme`) and put on
  `<html data-theme>` in the head before anything is painted. Every colour that differs between the themes
  must therefore be written three ways, as `pung.css` and `modules.html` do: for the system's light setting
  unless dark was chosen (`@media … :root:not([data-theme="dark"])`), and for a chosen light
  (`:root[data-theme="light"]`). A `<picture>` or an image that follows `prefers-color-scheme` cannot follow
  the switch: logos are drawn in the page in its own colours (`themed()`). The privacy page says the choice
  is stored.
- **Pung's own page on the Push has the same switch and the same look** (2026-11-27; `src/web/app.css`,
  `index.html`, `app.js`): light and dark with the switch beside the version in the rail, the choice kept in
  that browser (`pung.theme`), and pung.live's orange in place of the amber it began with. The light colours
  are in `app.css` itself now, so the public Modules page (which loads that stylesheet) adds only its bar's
  ground. The Push's screens, and every picture of one, stay dark in both. A colour in `app.css` that sits
  on the page's ground or text is `var(--ink)` / `var(--fg)` / `var(--panel)`, never `#000` or a fixed grey:
  the selected row of the sound browser was unreadable in light for that. The switch is a child of the rail,
  not of the brand: beside the version where the rail stands at the left, at the bar's right end where the
  rail lies across the top (up to 1200 px: a tablet), with the sections between logo and switch (they
  scroll when a phone is too narrow for all four). Under the logo, as it first was, it made the bar twice
  as tall on an iPad. Look at it without a Push: the
  scratch `layout/web-standin.sh` (the new build, three devices made without Live, port 7734).
- **Pung's own page has pung.live's bar, at every width** (the owner, 2026-11-27: one styleguide for both, and
  "I much prefer the header row of pung.live"): `header.bar` in `index.html`, the rules in `app.css` copied
  from the site's bar (logo 22 px, the sections in small capitals with a line under the one shown, the place
  switcher, the theme switch; content as wide as the page's). The rail at the left is gone, and what the
  notes above say about a rail no longer holds; its status lines and the Manual link are a foot under the
  page (`footer.foot`). One row always: below 860 px the sections scroll sideways between logo and switches.
  `--barh` (57 px) is the bar's height for what sticks under it (the compartments' tabs, the Modules banner).
  A change to pung.live's bar is made in both places.
- **The place switcher** (`src/web/places.js`; the owner's word, 2026-11-27: one consistent way between the
  coordinator, pung.live, and a child, a deployment's own page, and back, with many children): one control
  that names where you are (pung.live, or the deployment with its state) and opens the list of pung.live and
  every deployment; a press switches in the same tab, to where the visitor last was there (the owner,
  2026-11-27: "remember the page and come back to it"): a deployment's page keeps its last section in its
  browser (`pung.view`, `modules.js`) and opens it when a switch arrives (`?places=`), and pung.live's page
  travels with the switch (`from` in that list) and is gone back to; without one, Deployments. Its
  seat: the right end of the bar beside the theme switch, on pung.live (`places()` in `build.py`, once
  launched) and on a deployment's page; under the logo where the rail stands at the left. One file for both:
  Pung has it built in, the site's build copies it; it brings its own styles in the page's colours.
  pung.live knows the deployments (the browser's `pung.devices`); a deployment's page knows itself and
  pung.live, and its siblings once pung.live has handed them over: switching carries the list
  (`?places=<base64 JSON>`), the page keeps it (`pung.places`) and takes from it only names and home-network
  addresses. Back goes through the old hand-off (`#add=<address>`, `pushlink.js` `arrived`). The rail's
  links to pung.live are gone but the Manual's. Try it without a Push: `layout/web-standin.sh` and a scratch
  build of the launched site, with `pung.devices` put into the browser's storage.
- **On an iPad pung.live cannot talk to a deployment** (the owner's, 2026-11-27): a secure page may fetch
  plain http on the home network only with the browser's permission (Chrome, Edge, Firefox on a computer);
  Safari has none, and every iPad browser is Safari. The way round is the secure link
  (`docs/SECURE-LINK.md`, the owner's choice): a deployment with a name under a public domain and a
  certificate answers over https on 7721 (`src/secure.go`: cert and key in `<data>/tls/`, `"secure"` in
  `/api/status`); `pushlink.js` and `places.js` reach a name under `SECURE` that way. pung.live learns
  that name from the deployment's own page: handed over by the place switcher, or fetched by a round trip
  when Connect is refused (`handOver`, `?back=`). Chrome asks its local-network permission for a secure
  name too; a page served from this Mac is never asked, so test that against the live site. What makes names and
  certificates (a domain, DNS, an issuing service) is not built: first one certificate by hand, to see
  that the iPad and the home router (a Fritz!Box refuses public names for home addresses) go along.
- **Safari's engine is on this Mac for tests** (Playwright's WebKit, in the scratch venv; 2026-11-27): it
  renders as an iPad or iPhone does, but LuLu lets it reach only this Mac, so build the site into a scratch
  folder and serve it from 127.0.0.1. It does not widen its layout for content that sticks out as iOS
  does: look for elements beyond the screen's edges instead of trusting `scrollWidth`.
- **The Vision page says the same as the front page** (aligned 2026-11-27): Pung as an open platform for
  instruments, the slogan as its headline, the two interface levels by their names, the Pung stack and a
  Set's stack with the Set contract's five promises in one sentence, and where Pung goes (Push today, Live
  on the desktop next, other music programs and hardware later). In its running text hardware is
  "hardware" or "wherever Pung runs"; "device" is Live's. Nothing there about what will be sold.
- **The hero's views** (`site/hero.js`): PUNG CUSTOM, the front panels of Pung's five own instruments as loops
  (`site/hero/<id>.mp4` + `.png`), and PUNG DEFAULT, the live-drawn page; they take turns until a tab is pressed.
  `scripts/hero-loops.sh` records the loops from Pung's own renderer (`src/heroframes_test.go`: a chord, the
  spectrum of a sound fed in, an LFO of the test's own on the cutoff and the keys in `heroMoves`), no Push needed.
  The emulators play sounds of Pung's own, made up for the picture (`scripts/screens/hero-values/<id>.json`:
  names like "Pung Aurora", Xenia's wavetable a user table computed there), never a sound of the player's
  firmware; Vivace one of its own factory sounds (read from a device without Live: its tables come from the
  engine, and a panel without them says READING THE TABLE). Rerun it when a native panel changes.
- **`site/install.json` "launched"** gates what is not released: the installer downloads, "Connect your Push",
  the unreleased manual (until then the manual is the one of the last release, from git). Preview the launched
  site against a real Push without publishing: build with it true into a scratch folder, serve it over https on
  127.0.0.1:8443 with any certificate, and run Chrome with
  `--host-resolver-rules="MAP pung.live:443 127.0.0.1:8443" --ignore-certificate-errors` (the origin must be
  https://pung.live for Pung to answer: `src/sitecors.go`).
- **The server sends nothing about caching** (nginx on the DiskStation; its configuration is outside the
  folder Pung may touch), so a browser keeps a file for a while by its own guess. `site/build.py` (`stamp`)
  therefore names every page's scripts and stylesheets by their content (`modules.js?v=…`), the pages ask for
  their data afresh (`cache: "no-cache"`: `catalog.json`, `screens/index.json`) and name each module picture
  by the index it came with. Before, a visitor had the new page with the old script after a publish (the
  owner saw no default pictures, 2026-11-27). A page's own HTML can still be an older copy until a reload.
- pung.live may change `touch_card` and `own_pack_only` only (`siteSettings`): never `catalog_url`, which
  names an unsigned catalog.

## Words

- **Module**: one instrument, audio effect or MIDI generator.
- **The Pung stack** (the owner's ambition, 2026-11-27): the modules, the host, how they appear in a DAW and
  how they get onto a machine; what the Reason Rack is to Reason's devices. **A stack**: what one Live Set
  uses of it: all its Pung devices with their modules, versions and states, and what they need; the MIDI and
  automation against them travel in the Set (`docs/PUNG-STACK.md`). **A patch**: what one Pung device holds;
  the page and the calls built on 2026-11-27 under the name "Stacks" are patches (`docs/STACKS.md`).
  **A host** is the program Pung's modules appear in (Live today, other DAWs later) and **a project** what it
  saves (in Live, a Set): a stack is one per project, and nothing in the stack's own design may be Live's
  alone (the owner's word). Never
  "rack" for any of it: on a Push a rack is Ableton's, and Pung writes one per module ("Live rack"). Lower
  case, so it is not **Stacks**, the owner's chord tool.
- **Schwung is a format Pung plays, and a credit; never a category** (the owner's word, 2026-11-27: from the
  outside Pung must not look dependent on it). No page sorts, filters or badges modules by Schwung; only
  "Pung native" is marked (`native()` in `modules.js`, the device's badge in `app.js`). A module's sheet
  credits its author, port and source, and says "Also runs on Ableton Move, as a Schwung module". The prose
  says "open modules in the Schwung module format, which began on Ableton Move". The credit stays where it
  is owed: the foot ("Open source", the fine print), the Vision's "stands on two open projects", every
  licence notice and source link (most modules are GPL). The dependence that is real (Schwung's chain host
  inside Pung, the module list from its catalogue) is not changed by this.
- **Deployment** (the owner's word, 2026-11-27, in place of "device"): a Pung that runs somewhere, a Push 3
  today (`site/pushlink.js` `KINDS`); what Pung runs on is "hardware" or its kind. **Device** is Live's word
  and only that: what a module becomes on a track ("a device in Live", "Pung device"). The site's code and
  the browser's keys still say device (`PungPush.devices`, `pung.devices`); the pages, the manual and the docs
  never do for a deployment. Left as they were, for the owner to decide: the front page's headline ("at home
  on every device") and the Vision's "every device musicians play".

## The module pack

A release carries its pack (`catalog/` beside the binary: every module, installed from the Push's disk), and
pung.live serves the current one (`scripts/publish-catalog.sh` -> `pung.live/catalog/`, signed). Pung from 0.6.0
on takes the newer of the two (`src/modpack.go`); a package whose checksum its own pack has is read from the
disk; offline it goes on with its own. `own_pack_only` in the settings never asks.

- **The pack key.** A served pack is taken only when signed with Pung's pack key: the public half is in
  `modpack.go`, the private one is the owner's (`~/.config/pung/pack-signing.key`, `scripts/packsign`), in no
  repository and no backup of this one. **Never make a new key**: every Pung in the world would refuse the
  packs from then on, until it is updated by a release. Losing it means the same.
- **`min_pung`** (a module's `module.json`, or `scripts/catalog-policy.json`): the pack reaches older Pungs too.
  A module that uses something a Pung release added (a `g.*` call, a `live_mod` key Pung must know) names that
  release, or older Pungs install a module they cannot draw. Such a Pung keeps the version its own pack has.
- A package Pung's own pack has by its checksum is read from the disk; if it is not there (or not whole) it
  is fetched from the pack's address (`assetSources`; before 2026-11-27 the install failed).
- A staging copy: `PUNG_PACK_URL` in Pung's environment (still must be signed). Tests never ask pung.live
  (`modpack_test.go` points `packURL` at nothing).
- Publishing a pack also rewrites `pung.live/modules/catalog.json`: the site's Modules page and a Push read
  the same pack.

## Native instruments (gearmulator)

- Engine pattern (Nodal Red first, then the others): the emulator on its own thread at FIFO 45 rendering
  into a ring; `render_block` only reads the ring; one instance at a time through
  `/dev/shm/pung-<id>.lock` (a second device says "Waiting"); a warm-up chord after boot so the first
  played notes do not underrun; the ring deep while a sound dump goes in; 6 dB headroom and a soft limiter.
- **Vavra and Xenia share `waldorf_engine.cpp`** (identical copies in `native/vavra/dsp` and
  `native/xenia/dsp`, selected by `WALDORF_MQ`/`WALDORF_XT`): edit one, copy, `cmp`.
- **Emulators run in processes of their own** (`<id>-engine`, NATIVE-MODULES.md rule 1): OsTIrus
  (`ostirus_shm.h`), Nodal Red, Vavra and Xenia (`emu_shm.h`, `emu_host.h`; the Waldorfs also
  `waldorf_emu.cpp`, `waldorf_family.h`: identical copies in each module that uses them; edit one, copy,
  `cmp`). A module's executables ship in its package (the recipe copies them).
- Parameters are generated: `tools/gen_params.py` writes `dsp/<x>_params.h` and the page lists between
  `// <pages>` markers in `push_ui.js` from gearmulator's `parameterDescriptions_*.json` and the LAYOUT at
  its top. Early pages must be full and repeat nothing: Live pads every page to 8 and keeps a limited list.
  `rawmap`: an enum whose options are not its raw values in order (XT effect types 0..7, 32..34).
- **The Set contract** (`docs/SET-CONTRACT.md`; built behind a switch, not on by default): a parameter of a
  module has one number for good, on every Pung and in every host: its place in `src/registry.json`. **The
  registry only ever grows at its ends** (`scripts/registry.py add` from an export of `GET /api/layouts` on a
  deployment that has the module, and for an emulator its firmware; `check`; the catalog build refuses
  anything else and a published module without an entry). A new module, or a module's new parameter, needs
  its entry before the release. `contract.go` lays a device out by it (an instrument: 192 entries of its
  own, the selector at 192 with 64 fixed steps, 63 general slots for the selected MIDI generator) under an
  identity of its own (`pung-set-1`); the devices from before stay for their Sets ("… (old)").
  `PUNG_SET_CONTRACT=1` or a file `set-contract` in Pung's data turns it on.
- **A parameter keeps its place in its class** (`stablelayout.go`): Live saves automation and mappings
  by position, so a class keeps the layout in `classes-known.json`; a new parameter goes after all the
  others (on an instrument beyond the 128 Live shows), one that is gone leaves a placeholder; in a full
  class (256) a new one takes a placeholder's slot (Vivace's tables). Never
  reorder a class's list by hand. Parameter ids of their own crash Live 13.0b25 when a parameter moves
  (NATIVE-MODULES.md rule 6); the attempt is on branch `wip/param-ids`.
- **Install a module's ROM before the Apply that brings it into Live.** Without firmware the module
  publishes no parameters and Live registers Pung's own instead. A device inserted before an Apply keeps
  its old list length even with new names: count parameters on a freshly inserted device.
- **Vavra's live cutoff patches the microQ DSP's program in memory** (`waldorf_emu.cpp`, `MQ_*`): a `jsr` to a
  stub at `P:$1400` after the matrix keeps each voice's Filter 1 cutoff at `Y:$7F000`. It goes in only where
  the two words are the measured ones, from a thread that `try_lock`s the DSP's mutex (a blocking lock
  deadlocks); a firmware other than the measured one gets no live cutoff and one log line. OsTIrus does the
  same on both DSPs (stores at P:$95D and P:$4FFF2 into a ring at Y:$1E000; its stub masks interrupts while
  it borrows r7/m7). A Virus sound's LFO in envelope mode (one-shot) looks like a reading that stops.
- gearmulator fixes live in `native/<id>/patches/`: XT bank B read bank A (`_loc + 128`), the 68000 core
  printed every LCD update to stderr (quiet unless `PUNG_MC68K_LOG`).
- Waldorf sysex: microQ `F0 3E 10 ..` (single 392 bytes), XT `F0 3E 0E ..` (single 265 bytes, boots in
  Multi mode: send a Single-mode dump after boot). XT wavetables: request a table `F0 3E 0E 7F 03 hh ll
  F7` (answer cmd 0x13, 64 wave ids, 65535 = interpolated slot) and its waves `02` (answer 0x12, 128
  samples) **one at a time** (the XT drops a burst); parse with `xt::State`. Tables 28..51 and 64..95 are
  computed by the synth and cannot be asked for: read from DSP Y:0x24000 instead (NATIVE-MODULES.md,
  Xenia); slots 61..63 are fixed triangle/square/saw. The microQ (Vavra) has no wavetables: its Alt 1/2
  waves are neither in its ROM nor in DSP memory, so they are named, not drawn. OsTIrus reads the TI's
  tables from DSP memory after boot.

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
  a number that means nothing. A module that answers bare numbers (0..1, a log2 of seconds) reads in its
  units everywhere through `push.display(fn(key, raw))` in its screen file. A long name cut in the row
  under a band screen ("KICK PI.") gets a short one from `push.short(fn(key, name))`; keys that turn
  nothing (a dead switch, an engine never offered) get no leftover page with `push.unused([keys])`.
- **A new front panel needs its card pictures' inputs** (`TestCardShotInputs`): its probe record from the
  Push's `module-screen.json` into `scripts/screens/probes.json`, and a sound of its own as
  `scripts/screens/values/<id>.json`. Never an emulator's values or initial state: they are the player's
  firmware and factory sounds (its panel is drawn at rest, `neutralValues`).
- **Every module has pictures on the Modules page** (2026-11-27): one without a front panel gets the first
  four of the pages Pung draws for it (`index.json` `"default"`; "Custom interface" still means a panel of its
  own). A new module needs its probe record and kind: `scripts/screens/add-probes.py <module-screen.json>
  <export of /api/layouts>` from a deployment that has it (a stand-in with the pack installed will do; the
  Multisampler's probe crashes there without samples, its record is the Push's). It never replaces a record
  and never takes an emulator's.
- **`push.theme`**: every instrument's screen file declares its look for Pung's default pages (ground,
  ink, knob style; `src/theme.go`), so a page turn never drops into Pung's grey.
- **Segments** (`segments: [{id, label, rect, keys}]` on a front panel, `src/segments.go`): Pung draws
  the bar over the active one, the same on every panel; a panel adds at most one touch of its own
  (`draws_segments`) and never dims, frames or underlines. A section that moves with a value says where
  it is while drawing (`g.segment`). Leave the 3 pixels above a segment's rect free of text.
- **Pung's own modulation** (`pungmod.go`): LFO A/B, Wheel, Pressure on any numeric control, for the whole
  sound, magenta. Slot.Get answers a modulated control's own setting (the root) and reads a `:state` with
  the roots in place (`sb_get_param_around`, one hold of the chain's lock); never read a modulated value
  through Slot.Get to save it. Kept in the device's state (`pung_mod`), not the sound. Levels only
  (`pmodLevel`: no switch, mode or count of 8 settings or fewer, nothing named a preset, an action or MIDI
  routing); `TestPungModAudit` with `PUNG_GALLERY_CACHE` walks every panel as LFO A sees it: rerun it when
  a screen file changes.
- **ASSIGN offers each segment its top modulation destinations** (UX-GUIDELINES.md, "The destinations
  that matter"): a segment whose knobs are switches gets an `assign` list, a destination with no knob (a
  synth's pitch) a name in the module's `mod_map` (`names`), what no section has the panel's
  `assign_pages`. Rerun the audit when a panel or a mod table changes (segment keys against `mod_map`).
- Verify on the Push with real values: walk every page (`Page Right` and capture each frame), play a note
  through the pages that should move, and give the surface back.

## Facts measured on a Push 3

- **Live 13.0b25 shows a plugin's first 127 parameters beside "Device On"** (measured again 2026-11-27 on a
  contract Dexed of 256 entries: Live logs "parameter count is 260", the Remote Script gets 128). Whatever
  sits at position 127 or beyond is not Live's: not automated, not mapped, not on Push's own device view.
  The Set contract's first layout put the MIDI FX selector at 192 and lost it for all 67 instruments (42
  have it within reach before the contract): `docs/SET-CONTRACT.md`, "What the Push said". **The contract
  stays off until its layout keeps the selector and slots below 127.**
- **What the Remote Script deletes is not in Live's recovery history**: after a Live restart a device a test
  loaded and deleted is back. And **a recovery that meets a device whose class is gone crashes Live**, which
  then asks "While recovering your work, Live crashed again …": No is the lower button 7 (CC 26 to Push3's
  input port, as `restart-live.sh` sends 27 for Yes), and Live opens a fresh Set. After a test that changes
  the classes, clear the test tracks BEFORE switching back, and expect that question.
- **Live 13 (13.0b25, on the Push since 2026-11-19) showed a plugin's parameters only up to 64** on
  2026-11-22: a class with 65 or more visible ones got "Device On" alone through the Remote Script (test
  classes of 60, 64, 65, 128, 129; the four hidden ones an instrument adds do not count), and so did
  Plaits (97) and every other Pung instrument; again after a reboot (a fresh Plaits: Live's log says
  "parameter count is 101", the Remote Script sees "Device On" alone). **Not explained**: on 2026-11-21,
  on the same Live 13.0b25, a fresh Xenia showed 119 of its parameters (below). Pung's view plays
  every parameter regardless. Live 12.4 showed up to 128. Live rescans the plugin only when the bundle
  changes (Pung touches `Pung.so`): a hand-edited `classes.json` needs that and a Live restart.
- A class holds up to 256 entries (`livedevice.MaxParams`, placeholders included); one that has more is
  cut to whole pages (`fitLive`, `src/devices.go`): the module's first pages while they fit, then its MIDI
  FX pages. What Live then shows of it is Live's choice (above): on 2026-11-21 Xenia showed 128 entries
  with "Device On" and page padding (119 its own), Vavra 97. Everything else is edited in Pung's view.
- Realtime device threads (FIFO 70) needed `GOMAXPROCS` well above the core count and a nice -15 boost
  while calling into a module (`gomaxprocs.go`, `lockboost_linux.go`), or emulators dropped blocks for
  everyone.
- **A device's blocks run on a C thread of its own** (`rtloop.c`, `pung-rt`, FIFO 70), not in Go. Go's
  scheduler preempts even a realtime goroutine (sysmon, every 10 ms it has not passed the scheduler) and
  it ran again only when an ordinary thread handed back a processor: up to 1-2 ms, past Live's half
  block. Played OsTIrus, 2026-11-21: 5 late blocks in 2 min (Go, nice 19), 2 (Go, nice 0), 0 in 3 min
  (C thread); the slowest block 2.3 ms against 0.12 ms. What is not audio runs in Go 2 ms later (the
  pump: Live's parameter changes, reports, the screens' audio and MIDI). `PUNG_GO_LOOP=1` in Pung's
  environment serves blocks from Go again. The slot's lock is a priority-inheriting pthread mutex.
- Pung sets GOGC 800 and a 1 GiB memory limit (`setGC`): it keeps about 9 MB live and allocates 20-40
  MB/s (the view), and at Go's default collected twice a second, each a stop of up to 1-2.5 ms. It
  lowers its threads from the service's nice 19 to 0 (`unniceThreads`).
- **Never let four emulators boot at once.** The probes after a release that changed all four ran in
  parallel, starved one another ("RT throttling activated" in dmesg) and all four were left out of
  Live; Pung's own modules are now probed one at a time (`probeAlone`), and a probe that only ran out
  of time is tried again at the next start.
- **The governor** (`governor.go` measures, `govrest.go` decides; `docs/GOVERNOR.md`): Pung's emulators
  rest 10 s after their sound has died (NATIVE-MODULES.md rule 9), Schwung's two (JE-8086, Osirus) are
  not rendered then (`rt_set_rest` in `rtloop.c`, as Schwung's host does on Move; no other module: a
  sequencer would start late), an engine keeps its ring deep until the first notes of a new sound are
  through (rule 10: the emulator compiles code on first use), an emulator starts only while half a
  core stays free with every emulator playing (`govRoom`; costs in `limits.go`), Pung's own LFOs leave a
  silent emulator alone (`pmodUnheard`), a device's pump looks 100 times a second instead of 500 once
  nothing has happened for a second, and the view reads and draws only when there is something to show
  (2 frames a second at rest, 30 while it moves, at once on a turn). `GET /api/governor?seconds=N` says
  what everything costs; `POST /api/governor/rest {"ms":0}` lets nothing rest (a test, a doubt);
  `scripts/governor.sh <push-ip> bench` is the pass/fail benchmark (in a NEW Set), `... rest <module>`
  one emulator's rest in depth. `frame_why` in `/api/surface/state` counts why frames were drawn.
- The Push sends Active Sensing four times a second, and pressure and pitch bend while pads are played:
  the view takes only notes and controllers for input (`isControl`), or each one redraws it (it did until
  2026-11-25). Live's indexer ("Ableton Index", nice 10) can take a whole core for hours: the governor
  counts low-priority work as background, not busy.
- Counters for a drop: `late` in `/api/devices` (Live gave up on Pung), `proc_max_us`/`gap_max_us`/
  `acquire_max_us`/`render_max_us` there (Pung's block), `skipped_blocks` in `/api/pung-devices`, and
  the module's `debug_info` (`underruns`, `block_max_us`: the emulator). `/api/debug/gc`, and
  `/api/debug/trace?seconds=N` for `go tool trace`.
- The Push's own device view is the model for Pung's (jog wheel goes into a device, volume and tempo
  encoders stay Live's, Add and Swap stay Push's: Swap is Hot-Swap and can replace the device itself).
