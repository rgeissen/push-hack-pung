package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The values Schwung's own hashState gives (current_preset.mjs, run in node).
func TestStateHashIsSchwungs(t *testing.T) {
	for in, want := range map[string]string{
		"":                            "811c9dc5:0",
		"a":                           "e40c292c:1",
		`{"preset":12,"cutoff":0.42}`: "bf9c5ae6:27",
		"Pop Piano 3 é ♫ 😀":           "f0fbc54b:18",
	} {
		if got := stateHash(in); got != want {
			t.Errorf("stateHash(%q) = %s, Schwung says %s", in, got, want)
		}
	}
}

// A sound is written byte for byte as Move writes it, and Move's way of
// listing (a regular expression on the text) finds its name.
func TestSoundFileIsMoves(t *testing.T) {
	got := string(soundFile("Fat Brass", "obxd", `{"preset": 12, "cutoff": 0.42}`, nil))
	want := `{"name":"Fat Brass","module":"obxd","version":1,"state":{"preset":12,"cutoff":0.42}}`
	if got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
	got = string(soundFile("Lead <2> & co", "hank", "cutoff=0.4;mix=0.5", nil))
	want = `{"name":"Lead <2> & co","module":"hank","version":1,"state":"cutoff=0.4;mix=0.5"}`
	if got != want {
		t.Fatalf("a state that is not JSON is a string, and nothing is HTML-escaped:\ngot  %s\nwant %s", got, want)
	}
	if got := string(soundFile("x", "m", "", nil)); got != `{"name":"x","module":"m","version":1,"state":""}` {
		t.Fatalf("an empty state is a sound too: %s", got)
	}
	withMeta := string(soundFile("x", "m", "{}", &pungMeta{Tags: []string{"pad"}}))
	if !strings.HasPrefix(withMeta, `{"name":"x","module":"m","version":1,"state":{}`) || !strings.HasSuffix(withMeta, `,"pung":{"tags":["pad"]}}`) {
		t.Fatalf("Pung's notes come after Schwung's four keys: %s", withMeta)
	}
}

func TestUserSoundsRoundTrip(t *testing.T) {
	st := &soundStore{root: t.TempDir()}
	n, err := st.SaveAs("obxd", "Fat Brass", `{"name":"inner","cutoff":1}`, nil)
	if err != nil || n != "Fat Brass" {
		t.Fatal(n, err)
	}
	// Save As never overwrites: the name and the file both get a number
	n2, _ := st.SaveAs("obxd", "fat brass", `{"cutoff":2}`, nil)
	if n2 != "fat brass 2" {
		t.Fatalf("a clashing name (case blind) gets a number, got %q", n2)
	}
	list, _ := st.List("obxd")
	if len(list) != 2 || list[0].Name != "Fat Brass" || list[1].Name != "fat brass 2" {
		t.Fatalf("list %+v", list)
	}
	// the state comes back as the module wrote it (JSON compacted)
	s, _, err := st.Read("obxd", "Fat Brass")
	if err != nil || s != `{"name":"inner","cutoff":1}` {
		t.Fatalf("read %q %v", s, err)
	}
	// Save overwrites by name
	if err := st.Save("obxd", "Fat Brass", `{"cutoff":3}`, nil); err != nil {
		t.Fatal(err)
	}
	if s, _, _ := st.Read("obxd", "Fat Brass"); s != `{"cutoff":3}` {
		t.Fatalf("after Save: %s", s)
	}
	// rename keeps the state, moves the file
	to, err := st.Rename("obxd", "Fat Brass", "Brass Wall")
	if err != nil || to != "Brass Wall" {
		t.Fatal(to, err)
	}
	if _, err := os.Stat(filepath.Join(st.root, "obxd", "Fat Brass.json")); !os.IsNotExist(err) {
		t.Fatal("the old file stays after a rename")
	}
	if s, _, _ := st.Read("obxd", "Brass Wall"); s != `{"cutoff":3}` {
		t.Fatalf("renamed: %s", s)
	}
	if err := st.Delete("obxd", "Brass Wall"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.Read("obxd", "Brass Wall"); err != errNoSound {
		t.Fatal("deleted:", err)
	}
}

// What a Move wrote, Pung reads: a sound found by its name, whatever its
// file is called, a string state given back as the string, another module's
// sound refused, Move's track presets and Pung's index left out.
func TestReadsWhatMoveWrote(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "hank")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "Lead 2.json"), []byte(`{"name":"Lead","module":"hank","version":1,"state":"cutoff=0.4;"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "other.json"), []byte(`{"name":"Other","module":"obxd","version":1,"state":{}}`), 0o644)
	os.WriteFile(filepath.Join(dir, ".pung"), []byte(`{"version":1}`), 0o644)
	os.MkdirAll(filepath.Join(root, "track_presets"), 0o755)
	st := &soundStore{root: root}
	s, _, err := st.Read("hank", "Lead")
	if err != nil || s != "cutoff=0.4;" {
		t.Fatalf("%q %v", s, err)
	}
	if _, _, err := st.Read("hank", "Other"); err == nil {
		t.Fatal("another module's sound must be refused")
	}
	list, _ := st.List("hank")
	if len(list) != 2 {
		t.Fatalf("only the .json sounds are listed: %+v", list)
	}
	if _, err := st.List("track_presets"); err == nil {
		t.Fatal("track_presets is Move's, not a module's")
	}
}

func TestIndex(t *testing.T) {
	st := &soundStore{root: t.TempDir()}
	a := soundRef{Source: "factory", Bank: "Preset A", Index: 5, Name: "Pop Piano 3"}
	u := soundRef{Source: "user", Name: "Fat Brass"}
	st.Update("minijv", func(ix *soundIndex) {
		if !ix.toggleFavourite(a) || !ix.toggleFavourite(u) {
			t.Fatal("starring")
		}
		for i := 0; i < 40; i++ {
			ix.addRecent(soundRef{Source: "factory", Index: i})
		}
		ix.addRecent(soundRef{Source: "factory", Index: 3})
		ix.learnName("Preset A", 5, "Pop Piano 3 ")
		if ix.learnName("Preset A", 6, "Loading...") {
			t.Fatal("a status text is not a name")
		}
	})
	ix := st.Index("minijv")
	if !ix.isFavourite(soundRef{Source: "factory", Bank: "Preset A", Index: 5}) || len(ix.Favourites) != 2 {
		t.Fatalf("favourites %+v", ix.Favourites)
	}
	if len(ix.Recent) != maxRecent || ix.Recent[0].Index != 3 {
		t.Fatalf("recent: newest first, at most %d, no repeats: %+v", maxRecent, ix.Recent[:3])
	}
	if ix.nameOf("Preset A", 5) != "Pop Piano 3" || ix.nameOf("Preset A", 6) != "" {
		t.Fatal("names")
	}
	st.Update("minijv", func(ix *soundIndex) { ix.renameUser("Fat Brass", "Brass Wall") })
	if !st.Index("minijv").isFavourite(soundRef{Source: "user", Name: "Brass Wall"}) {
		t.Fatal("a renamed sound stays a favourite")
	}
	// Move does not list the index
	list, _ := st.List("minijv")
	if len(list) != 0 {
		t.Fatalf("%+v", list)
	}
}
