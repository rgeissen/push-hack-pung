package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// pushDisk: a Push's folders, in a test's own directory.
func pushDisk(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	oldA, oldM := abletonDir, moveUserLibrary
	abletonDir, moveUserLibrary = filepath.Join(dir, "Music", "Ableton"), filepath.Join(dir, "UserData", "UserLibrary")
	t.Cleanup(func() { abletonDir, moveUserLibrary = oldA, oldM })
	for _, f := range []string{
		"User Library/Samples/Drums/Kicks/Kick 2.wav", "User Library/Samples/Drums/Kicks/Kick 10.wav",
		"User Library/Samples/Drums/Kicks/kick 1.wav", "User Library/Samples/Drums/Snares/Snare.aif",
		"User Library/Samples/Drums/Notes/readme.txt", "User Library/Samples/Loop.wav",
		"User Library/Samples/.hidden/x.wav", "User Library/Samples/Drums/Kicks/Kick 2.wav.asd",
		"Live 12 Core Library/Samples/One Shots/Old.wav",
		"Live 13 Core Library/Samples/One Shots/Clap.aif", "Live 13 Core Library/Samples/Loops/Beat.wav",
		"Factory Packs/CV Tools/Samples/Tone.wav", "Sets/My Project/Samples/Recorded/Take 1.wav",
		"Sets/My Project/Ableton Project Info/x.wav", "Live Recordings/2026 Temp Project/Samples/Rec.wav",
	} {
		p := filepath.Join(abletonDir, f)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte("x"), 0o644)
	}
	ensureMoveUserLibrary()
	return dir
}

func names(es []fileEntry) string {
	var out []string
	for _, e := range es {
		n := e.Name
		if e.Dir {
			n = fmt.Sprintf("%s/(%d)", n, e.Count)
		}
		if e.Convert {
			n += "*"
		}
		out = append(out, n)
	}
	return strings.Join(out, " ")
}

var sampleSpec = fileSpecFrom(map[string]any{"root": "/data/UserData/UserLibrary/Samples", "filter": []any{".wav", ".aif", ".aiff"}, "live_preview": true})

// Move's path for the user's samples is Live's User Library on a Push, and
// a folder is listed as a hand reads it: folders with something in them
// first (and how much), then files, numbers in order, nothing hidden.
func TestUserLibraryIsLivesAndListsAsAHandReads(t *testing.T) {
	pushDisk(t)
	lib := newFileLib(t.TempDir())
	user := userSamplesDir()
	if got := names(lib.list(user, user, sampleSpec)); got != "Drums/(4) Loop.wav" {
		t.Fatalf("User Library lists %q", got)
	}
	kicks := filepath.Join(user, "Drums", "Kicks")
	if got := names(lib.list(user, kicks, sampleSpec)); got != "kick 1.wav Kick 2.wav Kick 10.wav" {
		t.Fatalf("Kicks lists %q", got)
	}
	// a folder with nothing for this parameter is not there (Notes), and a
	// wav-only module is offered the AIFF as one to convert, if it can be
	wavOnly := fileSpecFrom(map[string]any{"filter": ".wav"})
	got := names(lib.list(user, filepath.Join(user, "Drums"), wavOnly))
	if ffmpegPath() == "" && got != "Kicks/(3)" {
		t.Fatalf("Drums lists %q for a wav-only module with no converter", got)
	}
	if ffmpegPath() != "" && got != "Kicks/(3) Snares/(1)" {
		t.Fatalf("Drums lists %q for a wav-only module", got)
	}
}

// The places of a sampler: yours, Live's, and the two lists; the newest Core
// Library; Packs as one list.
func TestPlacesOfASampler(t *testing.T) {
	pushDisk(t)
	lib := newFileLib(t.TempDir())
	// in Move's words, as a module writes them
	spec := fileSpecFrom(map[string]any{"root": moveUserLibrary + "/Samples", "filter": []any{".wav", ".aif"}})
	ps := placesFor(spec, "MrSample")
	var ids []string
	for _, p := range ps {
		ids = append(ids, p.ID)
	}
	if got := strings.Join(ids, " "); got != "user core packs sets recordings favourites recent" {
		t.Fatalf("places %q", got)
	}
	if got := names(lib.listPlace(ps[1], spec)); got != "Loops/(1) One Shots/(1)" || !strings.Contains(ps[1].Dirs[0], "Live 13") {
		t.Fatalf("Core Library lists %q from %s", got, ps[1].Dirs[0])
	}
	if got := names(lib.listPlace(ps[2], spec)); got != "CV Tools/(1)" {
		t.Fatalf("Packs lists %q", got)
	}
	if got := names(lib.listPlace(ps[3], spec)); got != "My Project/(1)" { // not its Ableton Project Info
		t.Fatalf("Sets lists %q", got)
	}
	if n := lib.total(ps[0], spec); n != 5 {
		t.Fatalf("User Library holds %d samples, want 5", n)
	}
	// a module with a folder of its own gets it first, under its name
	wt := fileSpecFrom(map[string]any{"root": moveUserLibrary + "/Wavetables", "filter": []any{".wav", ".wt2048"}})
	if p := placesFor(wt, "Tablor")[0]; p.ID != placeModule || p.Label != "WAVETABLES" {
		t.Fatalf("Tablor's first place is %+v", p)
	}
	bb := fileSpecFrom(map[string]any{"root": "/data/UserData/breakbeat-samples", "filter": ".wav"})
	if p := placesFor(bb, "Breakbeat")[0]; p.ID != placeModule || p.Label != "BREAKBEAT" {
		t.Fatalf("Breakbeat's first place is %+v", p)
	}
	// a wide root ("/data") is no place of its own; a preset folder is
	kit := fileSpecFrom(map[string]any{"root": filepath.Dir(filepath.Dir(moveUserLibrary)), "start_path": moveUserLibrary + "/Track Presets", "filter": []any{".ablpreset", ".json"}})
	kp := placesFor(kit, "MrDrums")
	if kp[0].ID != placeModule || kp[0].Label != "TRACK PRESET" || len(kp) != 3 {
		t.Fatalf("a kit's places are %+v", kp)
	}
}

// Favourites and recents are one list for every sampler, and say when a
// file is gone.
func TestFavouritesAndRecentsAreShared(t *testing.T) {
	pushDisk(t)
	data := t.TempDir()
	lib := newFileLib(data)
	loop := filepath.Join(userSamplesDir(), "Loop.wav")
	gone := filepath.Join(userSamplesDir(), "Gone.wav")
	if !lib.store.toggleFav("audio", loop) || !lib.store.toggleFav("audio", gone) {
		t.Fatal("not starred")
	}
	lib.store.chose("audio", gone)
	lib.store.chose("audio", loop)
	lib.store.chose("audio", gone)
	lib = newFileLib(data) // kept
	favs := lib.virtual(placeFavs, sampleSpec)
	if len(favs) != 2 || favs[0].Name != "Gone.wav" || !favs[0].Missing || favs[1].Missing {
		t.Fatalf("favourites %+v", favs)
	}
	if got := names(lib.virtual(placeRecent, sampleSpec)); got != "Gone.wav Loop.wav" {
		t.Fatalf("recent %q", got)
	}
	if lib.store.toggleFav("audio", gone) || lib.store.isFav("audio", gone) || !lib.store.isFav("audio", loop) {
		t.Fatal("unstarring")
	}
	// another kind of file has its own lists
	if n := len(lib.virtual(placeFavs, fileSpecFrom(map[string]any{"filter": ".ablpreset"}))); n != 0 {
		t.Fatalf("a kit's favourites hold %d samples", n)
	}
}

func TestNaturalOrderAndNames(t *testing.T) {
	in := []string{"Kick 10", "kick 2", "Kick 1", "Snare", "kick"}
	for i := 0; i < len(in); i++ {
		for j := i + 1; j < len(in); j++ {
			if naturalLess(in[j], in[i]) {
				in[i], in[j] = in[j], in[i]
			}
		}
	}
	if got := strings.Join(in, "|"); got != "kick|Kick 1|kick 2|Kick 10|Snare" {
		t.Fatalf("order %q", got)
	}
	if displayName("Kick 808.wav") != "Kick 808" || displayName("Basic.wt2048") != "Basic" || displayName("Kit.json") != "Kit.json" {
		t.Fatal("display names")
	}
	if portablePath(filepath.Join(abletonDir, "User Library", "Samples", "a.wav")) != filepath.Join(moveUserLibrary, "Samples", "a.wav") {
		t.Fatal("a User Library path is not given in Move's words")
	}
}

// A file parameter is read from the module's own words, and is never a knob.
func TestFileParamMeta(t *testing.T) {
	m := metaFromObj(map[string]any{"key": "sample_path", "name": "Sample", "type": "filepath", "root": "/data/UserData/UserLibrary/Samples",
		"filter": []any{".WAV", "aif"}, "live_preview": true,
		"browser_hooks": map[string]any{"on_open": []any{map[string]any{"key": "ui_auto_select_pad", "value": "off", "restore": true}}}})
	if m.Type != "file" || m.File == nil || !m.File.LivePreview || strings.Join(m.File.Filter, ",") != ".wav,.aif" {
		t.Fatalf("meta %+v, file %+v", m, m.File)
	}
	if h := m.File.Hooks["on_open"]; len(h) != 1 || h[0].Key != "ui_auto_select_pad" || h[0].Value != "off" || !h[0].Restore {
		t.Fatalf("hooks %+v", m.File.Hooks)
	}
	if v, _ := m.display("/data/UserData/UserLibrary/Samples/Drums/Kick 808.wav", true); v != "Kick 808" {
		t.Fatalf("shown as %q", v)
	}
	if v, _ := m.display("", true); v != "NONE" {
		t.Fatalf("no file shown as %q", v)
	}
	if _, ok := m.step("/a.wav", 1, false); ok {
		t.Fatal("a turn changed a file")
	}
	pos := metaFromObj(map[string]any{"key": "start", "name": "Start", "type": "wav_position", "mode": "trim_front", "filepath_param": "sample_path"})
	if pos.Type != "float" || pos.Pos == nil || pos.Pos.Of != "sample_path" || pos.Pos.Mode != "start" || pos.Max != 1 || pos.ReadOnly {
		t.Fatalf("a position is %+v / %+v", pos, pos.Pos)
	}
	if v, u := pos.display("0.25", true); v != "25" || u != "%" {
		t.Fatalf("a quarter shown as %q %q", v, u)
	}
}

// The web doors read and write only the libraries: never Pung's own folder
// (ROMs, modules), never a path that climbs out.
func TestWebFilePathsStayInTheLibraries(t *testing.T) {
	dir := pushDisk(t)
	old := moveSchwungDir
	t.Cleanup(func() { moveSchwungDir = old })
	moveSchwungDir = filepath.Join(dir, "UserData", "schwung")
	os.MkdirAll(filepath.Join(moveSchwungDir, "modules"), 0o755)
	os.WriteFile(filepath.Join(moveSchwungDir, "rom.bin"), []byte("x"), 0o644)
	// a link out of the library does not make its target a library
	os.Symlink(moveSchwungDir, filepath.Join(abletonDir, "User Library", "Samples", "sneaky"))
	good := []string{filepath.Join(userSamplesDir(), "Loop.wav"), filepath.Join(abletonDir, "Live 13 Core Library", "Samples", "Loops", "Beat.wav"),
		filepath.Join(userSamplesDir(), "New Folder", "not there yet.wav")}
	for _, p := range good {
		if _, err := safeFilePath(p); err != nil {
			t.Errorf("%s refused: %v", p, err)
		}
	}
	bad := []string{"", "relative.wav", "/etc/passwd", filepath.Join(moveSchwungDir, "rom.bin"),
		filepath.Join(userSamplesDir(), "..", "..", "..", "..", "etc", "passwd"), filepath.Join(userSamplesDir(), "sneaky", "rom.bin")}
	for _, p := range bad {
		if c, err := safeFilePath(p); err == nil {
			t.Errorf("%q allowed as %q", p, c)
		}
	}
	places := placesFor(fileSpecFrom(map[string]any{"root": moveUserLibrary + "/Samples", "filter": []any{".wav", ".aif"}}), "MrSample")
	if d, err := writableDir(places, ""); err != nil || d != userSamplesDir() {
		t.Fatalf("an upload with no folder goes to %q (%v)", d, err)
	}
	if _, err := writableDir(places, filepath.Join(abletonDir, "Live 13 Core Library", "Samples")); err == nil {
		t.Fatal("an upload into the Core Library was allowed")
	}
	for in, want := range map[string]string{"Kick.wav": "Kick.wav", "../../x.wav": "x.wav", ".hidden": "", "a\\b\\c.wav": "c.wav", "..": ""} {
		if got := cleanFileName(in); got != want {
			t.Errorf("name %q cleaned to %q, want %q", in, got, want)
		}
	}
}

// The preview fades in, plays the file once at its own level, fades out at
// its end, and stops within a block when asked: never a click, never two
// voices.
func TestPreviewVoiceMixes(t *testing.T) {
	d := &device{}
	pcm := make([]float32, 2*1000)
	for i := range pcm {
		pcm[i] = 0.5
	}
	d.preview.Store(&previewVoice{pcm: pcm})
	l, r := make([]float32, 256), make([]float32, 256)
	for i := range l {
		l[i], r[i] = 0.1, 0.1 // the module's own sound stays
	}
	d.mixPreview(l, r, 256)
	if l[0] != 0.1 || l[10] <= 0.1 || l[10] >= 0.6 || l[200] != 0.6 {
		t.Fatalf("fade in: %v %v %v", l[0], l[10], l[200])
	}
	for i := 0; i < 3; i++ { // to the file's end
		l, r = make([]float32, 256), make([]float32, 256)
		d.mixPreview(l, r, 256)
	}
	if d.previewing() || l[255] != 0 {
		t.Fatalf("still playing after the file's end: %v", l[255])
	}
	d.preview.Store(&previewVoice{pcm: pcm})
	d.mixPreview(make([]float32, 64), make([]float32, 64), 64)
	d.stopPreview()
	l, r = make([]float32, 64), make([]float32, 64)
	d.mixPreview(l, r, 64)
	if d.previewing() || l[63] > 0.02 || l[0] < 0.3 {
		t.Fatalf("stop: starts at %v, ends at %v", l[0], l[63])
	}
}

// A module lists its sample among a level's parameters, not its knobs. The
// sample is first on that level's page, the knobs follow, and what does not
// fit goes on to the next page.
func TestAFileIsFirstOnItsOwnPage(t *testing.T) {
	get := func(k string) (string, bool) {
		switch k {
		case "chain_params":
			return `[{"key":"sample_path","name":"Sample","type":"filepath","filter":[".wav"]},
				{"key":"sample_start","name":"Start","type":"wav_position","filepath_param":"sample_path","mode":"start"},
				{"key":"loop","name":"Loop","type":"enum","options":["off","on"]},
				{"key":"gain","name":"Gain","type":"float","min":0,"max":1},
				{"key":"kit","name":"Load Kit","type":"filepath","filter":[".json"]}]`, true
		case "ui_hierarchy":
			return `{"levels":{"root":{"name":"S","knobs":["gain"],"params":[{"label":"Sample","level":"sample"},"kit"]},
				"sample":{"name":"Sample","knobs":["sample_start","loop"],"params":["sample_path","sample_start","loop"]}}}`, true
		}
		return "", false
	}
	cm := buildMeta("s", get)
	var got []string
	for _, b := range cm.Banks {
		got = append(got, b.Name+": "+strings.Join(b.Keys, " "))
	}
	if want := "MAIN: kit gain | SAMPLE: sample_path sample_start loop"; strings.Join(got, " | ") != want {
		t.Fatalf("pages %q, want %q", strings.Join(got, " | "), want)
	}
}
