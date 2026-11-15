package main

import (
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

func rackClass(t *testing.T) (*sclass, string) {
	t.Helper()
	presets := filepath.Join(t.TempDir(), "Presets")
	sc := testSClass("0123456789abcdef0123456789abcdef", "synth:cutoff", "synth:reso")
	sc.Name, sc.module, sc.Kind = "Mini-JV", "minijv", livedevice.Instrument
	sc.Folder = "Pung"
	if _, err := livedevice.WritePresets(presets, "Pung", []*livedevice.Class{sc.Class}); err != nil {
		t.Fatal(err)
	}
	return sc, presets
}

// A sound's rack is the module's rack with the device state in
// <ProcessorState>, as Live writes it: upper-case hex, 40 bytes a line, a
// little-endian length first (measured on a rack Push saved).
func TestSoundRackCarriesTheState(t *testing.T) {
	sc, presets := rackClass(t)
	tmpl, err := readGzip(classRackPath(presets, sc.Class))
	if err != nil {
		t.Fatal(err)
	}
	data, err := soundRack(tmpl, sc, `Fat "Brass" & co`, `{"preset":5,"cutoff":20}`)
	if err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(t.TempDir(), "x.adg")
	os.WriteFile(f, data, 0o644)
	x, err := readGzip(f)
	if err != nil {
		t.Fatal("not gzip:", err)
	}
	m := regexp.MustCompile(`(?s)<ProcessorState>\n(.*?)\n\s*</ProcessorState>`).FindSubmatch(x)
	if m == nil {
		t.Fatal("no state in the rack")
	}
	lines := strings.Split(string(m[1]), "\n")
	for i, l := range lines {
		l = strings.TrimSpace(l)
		if l != strings.ToUpper(l) || (i < len(lines)-1 && len(l) != 80) {
			t.Fatalf("line %d is not Live's form: %q", i, l)
		}
	}
	blob, err := hex.DecodeString(strings.Join(strings.Fields(string(m[1])), ""))
	if err != nil {
		t.Fatal(err)
	}
	n := binary.LittleEndian.Uint32(blob)
	var doc struct {
		Chain struct {
			Synth struct {
				Module string `json:"module"`
				Config struct {
					State map[string]any `json:"state"`
				} `json:"config"`
			} `json:"synth"`
		} `json:"chain"`
		Sound soundRef `json:"sound"`
	}
	if int(n) != len(blob)-4 || json.Unmarshal(blob[4:], &doc) != nil {
		t.Fatalf("length %d of %d, or not the device's state", n, len(blob)-4)
	}
	if doc.Chain.Synth.Module != "minijv" || doc.Chain.Synth.Config.State["preset"] != float64(5) || doc.Sound.Name != `Fat "Brass" & co` {
		t.Fatalf("%+v", doc)
	}
	if !strings.Contains(string(x), `<Name Value="Fat &quot;Brass&quot; &amp; co" />`) {
		t.Fatal("the plugin preset is named after the sound")
	}
}

// Pung writes, replaces and removes only the racks it wrote: one Live saved
// into the sound folder, or one with a sound's name that is not Pung's,
// stays as it is.
func TestSoundRacksOwnOnlyTheirs(t *testing.T) {
	sc, presets := rackClass(t)
	lib := &soundLib{store: &soundStore{root: t.TempDir()}, racks: &soundRacks{presets: presets, classes: []*sclass{sc}}}
	lib.store.SaveAs("minijv", "Pad", `{"preset":1}`, nil)
	lib.store.SaveAs("minijv", "Lead", `{"preset":2}`, nil)
	dir := soundRackDir(presets, sc.Class)
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "Lead.adg"), []byte("Live's own"), 0o644) // not Pung's
	os.WriteFile(filepath.Join(dir, "Mine.adg"), []byte("Live's own"), 0o644) // not Pung's
	lib.SyncRacks("minijv")
	if _, err := os.Stat(filepath.Join(dir, "Pad.adg")); err != nil {
		t.Fatal("Pad has its rack")
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "Lead.adg")); string(b) != "Live's own" {
		t.Fatal("a rack Pung did not write is never replaced")
	}
	lib.store.Rename("minijv", "Pad", "Warm Pad")
	lib.SyncRacks("minijv")
	if _, err := os.Stat(filepath.Join(dir, "Pad.adg")); !os.IsNotExist(err) {
		t.Fatal("a renamed sound's old rack goes")
	}
	if _, err := os.Stat(filepath.Join(dir, "Warm Pad.adg")); err != nil {
		t.Fatal("and its new one comes")
	}
	lib.store.Delete("minijv", "Warm Pad")
	lib.store.Delete("minijv", "Lead")
	lib.SyncRacks("minijv")
	if _, err := os.Stat(filepath.Join(dir, "Warm Pad.adg")); !os.IsNotExist(err) {
		t.Fatal("a deleted sound's rack goes")
	}
	for _, f := range []string{"Lead.adg", "Mine.adg"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Fatalf("%s is not Pung's: it stays", f)
		}
	}
}

// livedevice.WritePresets removes every rack in Pung's class folders that is
// not a class's; one Live saved there (Push's Save) is given back.
func TestForeignRacksSurviveWritePresets(t *testing.T) {
	sc, presets := rackClass(t)
	dir := rackFolder(presets, "Pung", sc.Class)
	saved := filepath.Join(dir, "Mini-JV-1.adg")
	os.WriteFile(saved, []byte("a rack Live saved"), 0o644)
	giveBack := keepForeignRacks(presets, []*livedevice.Class{sc.Class})
	livedevice.WritePresets(presets, "Pung", []*livedevice.Class{sc.Class})
	if _, err := os.Stat(saved); !os.IsNotExist(err) {
		t.Skip("WritePresets keeps foreign racks now: the guard is no longer needed")
	}
	giveBack()
	if b, _ := os.ReadFile(saved); string(b) != "a rack Live saved" {
		t.Fatal("a rack Live saved in Pung's folder must come back")
	}
}
