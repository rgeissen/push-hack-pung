package main

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

func TestVersionLess(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"0.3.3", "0.3.4", true}, {"0.9", "0.10", true}, {"1.0.0", "1.0", false},
		{"1.0", "1.0.1", true}, {"2.0", "1.9.9", false}, {"0.5.3", "0.5.3", false},
	} {
		if got := versionLess(c.a, c.b); got != c.want {
			t.Errorf("%s < %s: %v", c.a, c.b, got)
		}
	}
}

func tarGz(t *testing.T, path string, files map[string]string) {
	f, _ := os.Create(path)
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	f.Close()
}

// A package unpacks only inside its own folder.
func TestUntarStaysInside(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "good.tar.gz")
	tarGz(t, good, map[string]string{"x/module.json": `{"id":"x"}`, "x/dsp.so": "elf"})
	if err := untar(good, filepath.Join(dir, "out"), "x"); err != nil || !exists(filepath.Join(dir, "out", "x", "dsp.so")) {
		t.Fatalf("a good package: %v", err)
	}
	for _, name := range []string{"../evil", "x/../../evil", "/etc/evil", "y/module.json"} {
		bad := filepath.Join(dir, "bad.tar.gz")
		tarGz(t, bad, map[string]string{name: "no"})
		if err := untar(bad, filepath.Join(dir, "out2"), "x"); err == nil {
			t.Errorf("%q was unpacked", name)
		}
	}
	if exists(filepath.Join(dir, "evil")) {
		t.Fatal("a file climbed out")
	}
}

func assetModule(t *testing.T, root string) string {
	dir := filepath.Join(root, "sound_generators", "jv")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{"id":"jv","name":"JV","assets":{"path":"roms","label":"ROMs","extensions":[".bin"],
	 "files":[{"filename":"cpu.bin","label":"CPU ROM","size":5,"crc32":"3610A686","required":true},
	          {"filename":"wave.bin","label":"Wave ROM","required":true}]}}`), 0o644)
	os.WriteFile(filepath.Join(dir, "dsp.so"), []byte("elf"), 0o644)
	return dir
}

// A ROM is known by its checksum whatever it is called; one with the right
// name and the wrong contents is refused, saying what it is not.
func TestAddAsset(t *testing.T) {
	root, data := t.TempDir(), t.TempDir()
	h := &Host{modulesDir: root, dataDir: data, settings: loadSettings(data)}
	mm := &modMgr{h: h, jobs: map[string]*modJob{}}
	dir := assetModule(t, root)
	// "hello" has CRC32 3610A686
	stored, err := mm.addAsset("jv", "roms", "my-dump.bin", strings.NewReader("hello"))
	if err != nil || stored != "cpu.bin" || !exists(filepath.Join(dir, "roms", "cpu.bin")) {
		t.Fatalf("recognised by checksum: stored %q, %v", stored, err)
	}
	if _, err := mm.addAsset("jv", "roms", "cpu.bin", strings.NewReader("HELLO")); err == nil || !strings.Contains(err.Error(), "CPU ROM") {
		t.Fatalf("a wrong CPU ROM: %v", err)
	}
	if _, err := mm.addAsset("jv", "roms", "notes.txt", strings.NewReader("x")); err == nil {
		t.Fatal("a .txt in a .bin folder")
	}
	if _, err := mm.addAsset("jv", "roms", "../../escape.bin", strings.NewReader("x")); err != nil || exists(filepath.Join(root, "escape.bin")) {
		t.Fatalf("a name with a path: %v", err)
	}
	st := assetStates(dir)
	if len(st) != 1 || st[0].Missing != 1 || !st[0].Files[0].OK || st[0].Files[1].Present {
		t.Fatalf("states: %+v", st)
	}
}

// An update keeps the user's ROMs; a package's own factory banks stay too.
func TestMoveAssets(t *testing.T) {
	old, nw := t.TempDir(), t.TempDir()
	spec := `{"id":"m","assets":[{"path":"roms"},{"path":"banks"}]}`
	for _, d := range []string{old, nw} {
		os.WriteFile(filepath.Join(d, "module.json"), []byte(spec), 0o644)
	}
	os.MkdirAll(filepath.Join(old, "roms"), 0o755)
	os.WriteFile(filepath.Join(old, "roms", "a.bin"), []byte("rom"), 0o644)
	os.MkdirAll(filepath.Join(old, "banks"), 0o755)
	os.WriteFile(filepath.Join(old, "banks", "mine.syx"), []byte("u"), 0o644)
	os.MkdirAll(filepath.Join(nw, "banks"), 0o755)
	os.WriteFile(filepath.Join(nw, "banks", "factory.syx"), []byte("f"), 0o644)
	moveAssets(old, nw)
	for _, p := range []string{"roms/a.bin", "banks/mine.syx", "banks/factory.syx"} {
		if !exists(filepath.Join(nw, p)) {
			t.Errorf("%s is gone", p)
		}
	}
}

// A removed module's class stays in the class file.
func TestWithRetired(t *testing.T) {
	data := t.TempDir()
	mk := func(uid, name string) *livedevice.Class {
		return &livedevice.Class{UID: uid, Name: name, Kind: "instrument", Params: []livedevice.Param{}, Banks: [][]int{}}
	}
	a, b := mk(strings.Repeat("A", 32), "A"), mk(strings.Repeat("B", 32), "B")
	if a.Check() != nil {
		t.Skipf("class check: %v", a.Check())
	}
	if got := withRetired(data, []*livedevice.Class{a, b}); len(got) != 2 {
		t.Fatalf("first: %d", len(got))
	}
	got := withRetired(data, []*livedevice.Class{a}) // B removed
	if len(got) != 2 || got[1].UID != b.UID {
		t.Fatalf("B is not retired: %+v", got)
	}
}

// A catalog that came with Pung is the default, and its packages are read
// from the Push's own disk: no download from anywhere.
func TestBundledCatalog(t *testing.T) {
	dir := t.TempDir()
	pkg := []byte("a package")
	sum := sha256.Sum256(pkg)
	os.MkdirAll(filepath.Join(dir, "modules"), 0o755)                   //nolint:errcheck
	os.WriteFile(filepath.Join(dir, "modules", "x.tar.gz"), pkg, 0o644) //nolint:errcheck
	doc := map[string]any{"catalog_version": 1, "base_url": "", "modules": []map[string]any{
		{"id": "x", "asset": "modules/x.tar.gz", "size": len(pkg), "sha256": hex.EncodeToString(sum[:])}}}
	raw, _ := json.Marshal(doc)
	os.WriteFile(filepath.Join(dir, "catalog.json"), raw, 0o644) //nolint:errcheck

	old := bundledCatalog
	bundledCatalog = func() string { return "file://" + filepath.Join(dir, "catalog.json") }
	defer func() { bundledCatalog = old }()

	h := &Host{dataDir: t.TempDir(), settings: loadSettings(t.TempDir())}
	mm := &modMgr{h: h}
	if u := mm.catalogURL(); !strings.HasPrefix(u, "file://") {
		t.Fatalf("the bundled catalog is not the default: %s", u)
	}
	mm.catalog(true)
	if mm.catOffline || mm.cat == nil {
		t.Fatalf("the bundled catalog did not load: %s", mm.catErr)
	}
	if mm.cat.BaseURL != "file://"+dir {
		t.Fatalf("its packages are looked for at %s", mm.cat.BaseURL)
	}
	e, _ := mm.entry("x")
	dst := filepath.Join(t.TempDir(), "x.tar.gz")
	if err := mm.download("x", mm.cat.BaseURL+"/"+e.Asset, dst, e.Size); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(dst); string(got) != string(pkg) {
		t.Fatalf("read %q", got)
	}
	// a setting still wins (the published catalog, for instance)
	if _, err := h.settings.update([]byte(`{"catalog_url":"https://example.org/catalog.json"}`)); err != nil {
		t.Fatal(err)
	}
	if u := mm.catalogURL(); u != "https://example.org/catalog.json" {
		t.Fatalf("the setting lost to the bundle: %s", u)
	}
}

// Installed and removed again before an Apply: nothing for Live to see.
func TestPendingCancels(t *testing.T) {
	mm := &modMgr{h: &Host{dataDir: t.TempDir()}}
	mm.addPending("Filter updated")
	mm.addPending("GATE installed")
	mm.addPending("GATE removed")
	mm.addPending("OB-Xd removed")
	if got := strings.Join(mm.pending, ", "); got != "Filter updated, OB-Xd removed" {
		t.Fatalf("pending: %s", got)
	}
}

// The same version packed again by Pung (a higher revision) is an update; an
// older catalog, or the same package, is not.
func TestUpdateForCountsPungsRevision(t *testing.T) {
	entry := func(v string, rev int) catalogEntry { return catalogEntry{Version: v, Rev: rev} }
	cases := []struct {
		inst    string
		instRev int
		e       catalogEntry
		want    bool
	}{
		{"1.0.0", 1, entry("1.0.1", 0), true},  // a newer version
		{"1.0.0", 1, entry("1.0.0", 0), false}, // the same, a catalog with no revisions
		{"1.0.0", 1, entry("1.0.0", 1), false},
		{"1.0.0", 1, entry("1.0.0", 2), true}, // packed again
		{"1.0.0", 2, entry("1.0.0", 2), false},
		{"1.0.1", 1, entry("1.0.0", 5), false}, // never back to an older version
		{"1.0.0", 3, entry("1.0.1", 1), true},  // a new version starts over
	}
	for _, c := range cases {
		if got := updateFor(c.inst, c.instRev, c.e); got != c.want {
			t.Errorf("installed %s r%d, catalog %s r%d: update %v, want %v", c.inst, c.instRev, c.e.Version, c.e.Rev, got, c.want)
		}
	}
	dir := t.TempDir()
	if moduleRev(dir) != 1 {
		t.Fatal("a module that names no revision is revision 1")
	}
	os.MkdirAll(filepath.Join(dir, "PUNG-BUILD"), 0o755)
	os.WriteFile(filepath.Join(dir, "PUNG-BUILD", "REV"), []byte("3\n"), 0o644)
	if moduleRev(dir) != 3 {
		t.Fatalf("revision %d, want 3", moduleRev(dir))
	}
}
