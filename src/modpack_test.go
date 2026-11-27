package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// no test ever asks the real pung.live for a pack
func init() { packURL = "http://127.0.0.1:1/catalog.json" }

type packMod struct {
	id, version, pkg, minPung string
}

func packDoc(at string, mods ...packMod) []byte {
	var ms []map[string]any
	for _, m := range mods {
		sum := sha256.Sum256([]byte(m.pkg))
		e := map[string]any{"id": m.id, "version": m.version, "component_type": "sound_generator",
			"asset": "modules/" + m.id + "-" + m.version + ".tar.gz", "size": len(m.pkg), "sha256": hex.EncodeToString(sum[:])}
		if m.minPung != "" {
			e["min_pung"] = m.minPung
		}
		ms = append(ms, e)
	}
	raw, _ := json.Marshal(map[string]any{"catalog_version": 1, "generated_at": at, "modules": ms})
	return raw
}

// The pack pung.live serves is taken when it is signed and newer; a package
// that came with Pung is read from the disk; a module that asks for a newer
// Pung stays at the version Pung came with; anything else leaves Pung's own.
func TestModulePack(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	oldKey, oldURL, oldCat, oldVer := packKey, packURL, bundledCatalog, buildVersion
	defer func() { packKey, packURL, bundledCatalog, buildVersion = oldKey, oldURL, oldCat, oldVer }()
	packKey, buildVersion = pub, "0.6.0"

	// Pung's own pack: x 1.0 and z 1.0, on the disk
	own := t.TempDir()
	os.MkdirAll(filepath.Join(own, "modules"), 0o755) //nolint:errcheck
	os.WriteFile(filepath.Join(own, "catalog.json"), packDoc("2026-11-01T00:00:00+00:00",
		packMod{"x", "1.0", "x one", ""}, packMod{"z", "1.0", "z one", ""}), 0o644) //nolint:errcheck
	bundledCatalog = func() string { return "file://" + filepath.Join(own, "catalog.json") }

	// pung.live's: x 1.0 (the same package), y 1.0 (new), z 2.0 (for a newer Pung)
	served := packDoc("2026-11-20T00:00:00+00:00",
		packMod{"x", "1.0", "x one", ""}, packMod{"y", "1.0", "y one", ""}, packMod{"z", "2.0", "z two", "9.0.0"})
	sig := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, served)))
	var doc, sign atomic.Value
	doc.Store(served)
	sign.Store(sig)
	var hits atomic.Int32
	down := atomic.Bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if down.Load() {
			http.Error(w, "down", 503)
			return
		}
		switch r.URL.Path {
		case "/catalog/catalog.json":
			w.Write(doc.Load().([]byte)) //nolint:errcheck
		case "/catalog/catalog.json.sig":
			w.Write(sign.Load().([]byte)) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	packURL = srv.URL + "/catalog/catalog.json"

	fresh := func() *modMgr {
		return &modMgr{h: &Host{dataDir: t.TempDir(), settings: loadSettings(t.TempDir())}}
	}
	ver := func(mm *modMgr, id string) string { e, _ := mm.entry(id); return e.Version }

	mm := fresh()
	mm.catalog(true)
	if mm.catSource != "pung.live" || mm.packErr != "" {
		t.Fatalf("the newer signed pack was not taken: %q %q %q", mm.catSource, mm.packErr, mm.catErr)
	}
	ex, _ := mm.entry("x")
	if src := mm.assetSource(ex); !strings.HasPrefix(src, "file://"+own) {
		t.Errorf("x came with Pung, yet it is read from %s", src)
	}
	// and from pung.live if it is not on the disk as it should be
	if all := mm.assetSources(ex); len(all) != 2 || all[1] != srv.URL+"/catalog/"+ex.Asset {
		t.Errorf("x has no second place to come from: %v", all)
	}
	ey, _ := mm.entry("y")
	if src := mm.assetSource(ey); src != srv.URL+"/catalog/"+ey.Asset {
		t.Errorf("y is new, and is read from %s", src)
	}
	if v := ver(mm, "z"); v != "1.0" {
		t.Errorf("z 2.0 asks for Pung 9.0.0; this Pung offers %s", v)
	}
	// its rows: nothing this Pung cannot run is offered
	for _, r := range mm.view()["modules"].([]moduleRow) {
		if r.NeedsPung != "" || r.Status == "needs-pung" {
			t.Errorf("%s: offered as needing Pung %s", r.ID, r.NeedsPung)
		}
	}

	// pung.live down: the pack as last read and checked
	down.Store(true)
	mm.catalog(true)
	if mm.catSource != "pung.live" || mm.packErr == "" || ver(mm, "y") != "1.0" {
		t.Errorf("down: %q %q", mm.catSource, mm.packErr)
	}
	// a Pung that never read one: its own
	off := fresh()
	off.catalog(true)
	if off.catSource != "pung" || off.cat == nil || off.catOffline || ver(off, "y") != "" {
		t.Errorf("never read, down: %q offline=%v", off.catSource, off.catOffline)
	}
	down.Store(false)

	// a pack somebody changed: not taken
	bad := append([]byte(nil), served...)
	bad[len(bad)-3] ^= 1
	doc.Store(bad)
	tam := fresh()
	tam.catalog(true)
	if tam.catSource != "pung" || tam.packErr == "" {
		t.Errorf("a changed pack was taken: %q %q", tam.catSource, tam.packErr)
	}
	// signed with another key: not taken
	_, other, _ := ed25519.GenerateKey(nil)
	doc.Store(served)
	sign.Store([]byte(base64.StdEncoding.EncodeToString(ed25519.Sign(other, served))))
	if m := fresh(); func() bool { m.catalog(true); return m.catSource != "pung" }() {
		t.Errorf("a pack signed with another key was taken")
	}
	// an older pack, signed: Pung's own is the newer
	older := packDoc("2026-10-01T00:00:00+00:00", packMod{"y", "1.0", "y one", ""})
	doc.Store(older)
	sign.Store([]byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, older))))
	if m := fresh(); func() bool { m.catalog(true); return m.catSource != "pung" }() {
		t.Errorf("an older pack won over Pung's own")
	}

	// only Pung's own modules: pung.live is not asked
	only := fresh()
	if _, err := only.h.settings.update([]byte(`{"own_pack_only": true}`)); err != nil {
		t.Fatal(err)
	}
	before := hits.Load()
	only.catalog(true)
	if only.catSource != "pung" || hits.Load() != before {
		t.Errorf("own pack only: %q, %d requests", only.catSource, hits.Load()-before)
	}

	// a module only pung.live has, for a newer Pung: shown as needing it, not installable
	newer := packDoc("2026-11-25T00:00:00+00:00", packMod{"w", "1.0", "w one", "9.0.0"})
	doc.Store(newer)
	sign.Store([]byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, newer))))
	nm := fresh()
	nm.catalog(true)
	rows := nm.view()["modules"].([]moduleRow)
	if len(rows) != 1 || rows[0].Status != "needs-pung" || rows[0].NeedsPung != "9.0.0" {
		t.Errorf("w: %+v", rows)
	}
	if err := nm.install("w"); err == nil || !strings.Contains(err.Error(), "9.0.0") {
		t.Errorf("w installed on a Pung too old for it: %v", err)
	}
}
