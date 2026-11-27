package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func init() { releaseURL = "http://127.0.0.1:1/release.json" } // the tests never ask pung.live

// Pung says when pung.live names a newer release than itself, never asks
// while it is told to ask pung.live nothing, and says nothing for a release
// that is its own or older.
func TestNewestPung(t *testing.T) {
	oldURL, oldVer := releaseURL, buildVersion
	defer func() { releaseURL, buildVersion = oldURL, oldVer; newest = newestRelease{} }()
	var served atomic.Value
	served.Store(`{"version":"0.7.1","download_url":"x"}`)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Write([]byte(served.Load().(string))) //nolint:errcheck
	}))
	defer srv.Close()
	releaseURL, buildVersion = srv.URL+"/release.json", "0.6.0"
	h := &Host{dataDir: t.TempDir(), settings: loadSettings(t.TempDir())}
	wait := func() string {
		v := ""
		for i := 0; i < 100; i++ {
			if v = h.newestPung(); v != "" {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		return v
	}
	newest = newestRelease{}
	if v := wait(); v != "0.7.1" {
		t.Fatalf("0.7.1 is out and this is 0.6.0, yet newest says %q", v)
	}
	// asked once: the answer is kept for hours
	n := hits.Load()
	h.newestPung()
	h.newestPung()
	time.Sleep(60 * time.Millisecond)
	if hits.Load() != n {
		t.Errorf("asked again at once (%d times)", hits.Load())
	}
	// the release that is this Pung, and an older one: nothing to say
	for _, own := range []string{"0.7.1", "0.8.0"} {
		buildVersion = own
		if v := h.newestPung(); v != "" {
			t.Errorf("Pung %s is told %s is newer", own, v)
		}
	}
	buildVersion = "0.6.0"
	// told to ask pung.live nothing: it does not ask, and says nothing
	if _, err := h.settings.update([]byte(`{"own_pack_only":true}`)); err != nil {
		t.Fatal(err)
	}
	newest = newestRelease{}
	n = hits.Load()
	if v := h.newestPung(); v != "" {
		t.Errorf("own pack only, yet it says %q", v)
	}
	time.Sleep(80 * time.Millisecond)
	if hits.Load() != n {
		t.Error("own pack only, yet pung.live was asked")
	}
}
