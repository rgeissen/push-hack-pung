package main

// newest.go: is this the newest Pung? pung.live names the newest release
// (release.json, the file a release publishes). Pung reads it now and then
// and says so in /api/status ("newest"); its own page and pung.live's show
// a note with the way to the Pung Installer, which updates Pung. Pung does
// not update itself.
//
// Never asked while "only the modules that came with this Pung" is on
// (settings.go, own_pack_only: Pung asks pung.live nothing then), and never
// on the path of a request: the answer is what was last read.

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"time"
)

// releaseURL: where the newest release is named (a var for the tests);
// PUNG_RELEASE_URL: another address (a staging copy before a release)
var releaseURL = "https://pung.live/release.json"

func init() {
	if v := os.Getenv("PUNG_RELEASE_URL"); v != "" {
		releaseURL = v
	}
}

type newestRelease struct {
	mu      sync.Mutex
	version string    // the newest release's version, "" while unknown
	asked   time.Time // when it was last asked
	asking  bool
}

var newest newestRelease

// newestPung: the newest release's version if it is newer than this Pung,
// else "". Asks pung.live in the background, at most every six hours (ten
// minutes after it did not answer).
func (h *Host) newestPung() string {
	n := &newest
	n.mu.Lock()
	defer n.mu.Unlock()
	every := 6 * time.Hour
	if n.version == "" {
		every = 10 * time.Minute
	}
	own := h.settings != nil && h.settings.get().OwnPackOnly
	if !own && !n.asking && time.Since(n.asked) > every {
		n.asking, n.asked = true, time.Now()
		go func() {
			v := readNewest()
			n.mu.Lock()
			if v != "" {
				n.version = v
			}
			n.asking = false
			n.mu.Unlock()
		}()
	}
	if own || n.version == "" || buildVersion == "dev" || !versionLess(buildVersion, n.version) {
		return ""
	}
	return n.version
}

func readNewest() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	raw, err := readURL(ctx, releaseURL, 1<<16)
	if err != nil {
		return ""
	}
	var r struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(raw, &r) != nil {
		return ""
	}
	return r.Version
}
