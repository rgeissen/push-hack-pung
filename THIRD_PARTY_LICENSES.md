# Third-party licences

Pung itself is MIT licensed (`LICENSE`). It includes, links or installs the work of others, listed here
with their licences. Each licence text is in `licenses/`, copied verbatim. These notices travel with every
copy of Pung: `scripts/deploy.sh` installs them on the Push beside the binary.

| Component | Where it is in Pung | Licence | Text |
|---|---|---|---|
| **Schwung** (© 2025-2026 Charles Vestal) | the module API headers (`src/third_party/schwung`), `src/web/static/schwung-remote-api.js` (from schwung-manager, unmodified), and Schwung's chain host and built-in modules, built from Schwung's source and installed with Pung (`modules/`) | MIT | `licenses/schwung-MIT.txt` |
| **Push Hack** (© 2026 Federico Pepe) | the Go packages linked into `pung` (`core/...`) and the Live plugin `livedevice.so` (installed as `Pung.vst3`) | MIT | `licenses/push-hack-MIT.txt` |
| **VST 3 SDK** (© 2026 Steinberg Media Technologies GmbH) | compiled into `livedevice.so` | MIT | `licenses/vst3-sdk-MIT.txt` |
| **goja** (© 2016 Dmitry Panov) | `pung` (the `push_ui.js` runtime) | MIT | `licenses/goja-MIT.txt` |
| **regexp2** (Doug Clark) | `pung` (through goja) | MIT | `licenses/regexp2-MIT.txt` |
| **go-sourcemap** | `pung` (through goja) | BSD-2-Clause | `licenses/go-sourcemap-BSD-2.txt` |
| **pprof** (Google) | `pung` (through goja) | Apache-2.0 | `licenses/pprof-Apache-2.0.txt` |
| **golang.org/x/text**, **golang.org/x/image** (The Go Authors) | `pung` | BSD-3-Clause | `licenses/golang-x-text-BSD-3.txt`, `licenses/golang-x-image-BSD-3.txt` |
| **Go fonts** (Bigelow & Holmes, in golang.org/x/image) | `pung` (screen text) | BSD-3-Clause (as golang.org/x/image) | `licenses/go-fonts-README.txt` |
| **Archivo**, **IBM Plex Mono**, **Plus Jakarta Sans** (typefaces) | `pung` (its own web page: `src/web/fonts`, WOFF2), and pung.live | SIL Open Font License 1.1 | `src/web/fonts/OFL.txt`, `src/web/fonts/NOTICE.txt` (served by Pung at `/fonts/OFL.txt`) |
| **Tamzen** font | `pung` (screen text, embedded by Push Hack's `core/gfx/text`) | its own licence; the text is not in Push Hack yet (open item there) | |

## Schwung modules

The modules Pung runs are not part of Pung. Each module package (`scripts/build-push-modules.sh`) carries
its own repository's licence files, and several statically link GPL code, so each module is distributed
under its own terms. Module ROMs are never included.
