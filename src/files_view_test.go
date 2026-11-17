package main

import (
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// testFiles: a browser over a Push's disk with real (small) audio files, on
// a sampler that previews live.
func testFiles(t *testing.T) (*surface, *fbState) {
	t.Helper()
	initFaces()
	pushDisk(t)
	user := userSamplesDir()
	tone := testTone(22050)
	for _, f := range []string{"Drums/Kicks/Kick 2.wav", "Drums/Kicks/Kick 10.wav", "Drums/Kicks/kick 1.wav", "Loop.wav"} {
		writeWav(t, filepath.Join(user, f), tone, 44100, 2, 16, false, false)
	}
	for i := 3; i < 40; i++ {
		writeWav(t, filepath.Join(user, "Drums", "Kicks", fmt.Sprintf("Kick %d With A Name Far Too Long To Fit Anywhere At All.wav", i)), tone[:2000], 44100, 1, 24, false, false)
	}
	for _, d := range []string{"Hats", "Percussion And Other Things With Long Names", "Toms", "Cymbals"} {
		writeWav(t, filepath.Join(user, "Drums", d, "One.wav"), tone[:2000], 48000, 1, 16, false, false)
	}
	writeAiff(t, filepath.Join(user, "Drums", "Snares", "Snare.aif"), tone, 44100, 2, "")
	lib := newFileLib(t.TempDir())
	m := metaFromObj(map[string]any{"key": "sample_path", "name": "Sample", "type": "filepath",
		"root": moveUserLibrary + "/Samples", "filter": []any{".wav", ".aif", ".aiff"}, "live_preview": true})
	d := &device{c: &sclass{Class: &livedevice.Class{Name: "MrSample"}, module: "mrsample"}, s: &Slot{}}
	before := filepath.Join(user, "Drums", "Kicks", "Kick 2.wav")
	br := &fileBrowse{lib: lib, d: d, key: "sample_path", m: m, before: before, applied: before, Preview: true}
	fb := &fbState{dev: d, pkey: "sample_path", m: m, br: br, lib: lib, level: fbList, before: before, places: placesFor(m.File, "MrSample")}
	fb.totals = make([]int, len(fb.places))
	for i, p := range fb.places {
		if !p.Virtual {
			fb.totals[i] = lib.total(p, m.File)
		}
	}
	u := &surface{touched: -1, peekEnc: -1, vals: map[string]string{}, view: "files", fb: fb}
	return u, fb
}

// show: the folder as fbRead would list it, without the goroutines.
func (fb *fbState) show(t *testing.T, place int, dir, sel string) {
	t.Helper()
	p := fb.places[place]
	fb.place, fb.dir, fb.root, fb.cur, fb.sibs = place, dir, "", 0, nil
	switch {
	case p.Virtual:
		fb.rows = fb.lib.virtual(p.ID, fb.m.File)
	case dir == "":
		fb.rows = fb.lib.listPlace(p, fb.m.File)
	default:
		_, fb.root = placeOf(fb.places[place:place+1], dir)
		fb.rows = fb.lib.list(fb.root, dir, fb.m.File)
		for _, e := range fb.lib.list(fb.root, filepath.Dir(dir), fb.m.File) {
			if e.Dir {
				fb.sibs = append(fb.sibs, e)
			}
		}
	}
	for i, r := range fb.rows {
		if r.Path == sel {
			fb.cur = i
		}
	}
	if r, ok := fb.row(); ok && !r.Dir {
		fb.af, fb.afPath = audioFiles.get(r.Path), r.Path
	} else {
		fb.af, fb.afPath = nil, ""
	}
}

// Every screen of the file browser keeps its text on the panel and apart:
// a place's top, a deep folder with long names, the two lists, an empty
// place.
func TestFileBrowserKeepsItsText(t *testing.T) {
	u, fb := testFiles(t)
	screen := image.Rect(0, 0, scrW, scrH)
	user := userSamplesDir()
	kicks := filepath.Join(user, "Drums", "Kicks")
	check := func(name string) {
		t.Helper()
		img := newFrame()
		boxes := spy(func() { u.drawFiles(img) })
		within(t, name, boxes, screen)
		apart(t, name, boxes)
		gallery(t, "files-"+name, img)
	}
	fb.show(t, 0, "", "")
	check("user-top")
	fb.show(t, 0, filepath.Join(user, "Drums"), "")
	check("drums")
	fb.show(t, 0, kicks, fb.before)
	check("kicks-current")
	for _, c := range []int{0, 5, len(fb.rows) - 1} {
		fb.show(t, 0, kicks, fb.rows[c].Path)
		check(fmt.Sprintf("kicks-%d", c))
	}
	fb.compare = true
	check("kicks-compare")
	fb.compare = false
	fb.level = fbPlaces
	check("hands-on-places")
	fb.level = fbList
	fb.show(t, 1, "", "") // Core Library
	check("core-top")
	fb.lib.store.toggleFav("audio", fb.before)
	fb.lib.store.toggleFav("audio", filepath.Join(user, "Deleted Since.wav"))
	fb.lib.store.chose("audio", filepath.Join(user, "Loop.wav"))
	fb.show(t, len(fb.places)-2, "", "")
	check("favourites")
	fb.show(t, len(fb.places)-1, "", "")
	check("recent")
	// an empty place says what would fill it
	os.RemoveAll(filepath.Join(abletonDir, "Live Recordings"))
	fb.lib.forget()
	for i, p := range fb.places {
		if p.ID == placeRecs {
			fb.totals[i] = 0
			fb.show(t, i, "", "")
		}
	}
	img := newFrame()
	boxes := spy(func() { u.drawFiles(img) })
	within(t, "empty", boxes, screen)
	found := false
	for _, b := range boxes {
		found = found || strings.Contains(b.s, "NO SAMPLES HERE")
	}
	if !found {
		t.Fatal("an empty place does not say so")
	}
	gallery(t, "files-empty", img)
}

// The jog works as Push's own browser: press goes into a folder, a nudge
// left comes back to the row it left, and from a place's top to the places,
// and from there out. A folder never plays; nothing is chosen on the way.
func TestFileBrowserWalksFolders(t *testing.T) {
	u, fb := testFiles(t)
	user := userSamplesDir()
	fb.show(t, 0, "", "")
	if fb.rows[0].Name != "Drums" || !fb.rows[0].Dir {
		t.Fatalf("the top's first row is %+v", fb.rows[0])
	}
	if u.fbActionOn(fbLoad) || u.fbActionOn(fbFav) {
		t.Fatal("a folder offers Load or Fav")
	}
	// into Drums (what fbEnter asks to be read)
	fb.stack = append(fb.stack, fbFrame{"", 0})
	fb.show(t, 0, filepath.Join(user, "Drums"), "")
	if got := fb.crumbs(); len(got) != 1 || got[0] != "Drums" {
		t.Fatalf("crumbs %q", got)
	}
	fb.show(t, 0, filepath.Join(user, "Drums", "Kicks"), "")
	if got := strings.Join(fb.crumbs(), "/"); got != "Drums/Kicks" {
		t.Fatalf("crumbs %q", got)
	}
	if len(fb.sibs) != 6 || fb.sibs[0].Name != "Cymbals" {
		t.Fatalf("Kicks has %d folders beside it, the first %q", len(fb.sibs), fb.sibs[0].Name)
	}
	if !u.fbActionOn(fbLoad) || !u.fbActionOn(fbFav) || !u.fbActionOn(fbCompare) || !u.fbActionOn(fbCurrent) {
		t.Fatal("a file does not offer Load, Fav, Compare and Current")
	}
	if got := fitFromLeft("USER LIBRARY / DRUMS / KICKS", 150); got != ".. / DRUMS / KICKS" {
		t.Fatalf("a path cut to %q", got)
	}
	if sizeText(412<<10) != "412 KB" || sizeText(3<<20+1<<19) != "3.5 MB" {
		t.Fatalf("sizes %q %q", sizeText(412<<10), sizeText(3<<20+1<<19))
	}
}

// A file parameter on a device's page is its outline and its name, with the
// page's start and end drawn into it; with no file it says so.
func TestFileCellOnAPage(t *testing.T) {
	u, fb := testFiles(t)
	u.view, u.fb = "chain", nil
	cm := &compMeta{Params: map[string]*paramMeta{
		"sample_path": fb.m,
		"start":       metaFromObj(map[string]any{"key": "start", "name": "Start", "type": "wav_position", "mode": "start", "filepath_param": "sample_path"}),
		"end":         metaFromObj(map[string]any{"key": "end", "name": "End", "type": "wav_position", "mode": "end", "filepath_param": "sample_path"}),
	}}
	keys := []string{"sample_path", "start", "end"}
	var p position
	u.vals[u.valKey(p, "start")], u.vals[u.valKey(p, "end")] = "0.25", "0.8"
	audioFiles.get(fb.before) // read, as a frame after the first would find it
	screen := image.Rect(0, 0, scrW, scrH)
	for i, v := range []string{fb.before, "", filepath.Join(userSamplesDir(), "Drums", "Kicks", "Kick 7 With A Name Far Too Long To Fit Anywhere At All.wav")} {
		u.vals[u.valKey(p, "sample_path")] = v
		for _, touched := range []int{-1, 0} {
			u.touched = touched
			img := newFrame()
			boxes := spy(func() { u.drawFileCell(img, 0, p, cm, fb.m, "sample_path", slotColor(0), keys) })
			what := fmt.Sprintf("file cell %d touched %d", i, touched)
			within(t, what, boxes, screen)
			within(t, what, boxes, image.Rect(0, 0, colW, scrH)) // inside its own column
			apart(t, what, boxes)
			gallery(t, fmt.Sprintf("filecell-%d-%d", i, touched+1), img)
			said := ""
			for _, b := range boxes {
				said += b.s + "|"
			}
			if i == 1 && !strings.Contains(said, "NO FILE") {
				t.Fatalf("no file: %s", said)
			}
			if i == 0 && !strings.Contains(said, "Kick 2") {
				t.Fatalf("the file's name: %s", said)
			}
			if (touched == 0 || i == 1) && !strings.Contains(said, "TURN TO BROWSE") {
				t.Fatalf("touched: %s", said)
			}
		}
	}
}

// wait until the browser has read what was asked of it.
func fbSettle(t *testing.T, u *surface, ok func(fb *fbState) bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		u.mu.Lock()
		fb := u.fb
		done := fb == nil || (!fb.busy && ok(fb))
		u.mu.Unlock()
		if done {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the browser did not get there")
}

// The hands, through the real handlers: press into folders, nudge left back
// onto the row that was left, encoder 1 to the folder beside, up to the
// places, and out, which is Cancel.
func TestFileBrowserHands(t *testing.T) {
	u, fb := testFiles(t)
	fb.m.File.LivePreview, fb.br.Preview = false, false // no instrument and no audio in a test
	user := userSamplesDir()
	do := func(f func()) {
		u.mu.Lock()
		f()
		u.mu.Unlock()
	}
	u.fbRead(fb, "") // as opening does
	fbSettle(t, u, func(fb *fbState) bool { return len(fb.rows) == 2 })
	do(func() { u.fbButton(94, true) }) // jog press on Drums
	fbSettle(t, u, func(fb *fbState) bool { return fb.dir == filepath.Join(user, "Drums") && len(fb.rows) > 0 })
	do(func() { u.fbTurn(2) }) // Cymbals, Hats, Kicks
	if r, _ := fb.row(); r.Name != "Hats" {
		t.Fatalf("one step lands on %q", r.Name)
	}
	do(func() { u.fbTurn(1) })
	do(func() { u.fbButton(95, true) }) // nudge right: into Kicks
	fbSettle(t, u, func(fb *fbState) bool { return fb.dir == filepath.Join(user, "Drums", "Kicks") && len(fb.rows) == 40 })
	if len(fb.sibs) != 6 {
		t.Fatalf("%d folders beside Kicks", len(fb.sibs))
	}
	do(func() { u.shift = true; u.fbTurn(1); u.shift = false })
	if fb.cur != 10 {
		t.Fatalf("Shift moves ten: at %d", fb.cur)
	}
	do(func() { u.fbButton(63, true) }) // Page >
	if fb.cur != 15 {
		t.Fatalf("a page is five rows: at %d", fb.cur)
	}
	do(func() { u.fbSibling(1) }) // encoder 1: the folder beside Kicks
	fbSettle(t, u, func(fb *fbState) bool {
		return strings.HasSuffix(fb.dir, "Percussion And Other Things With Long Names")
	})
	do(func() { u.fbSibling(-1) })
	fbSettle(t, u, func(fb *fbState) bool { return strings.HasSuffix(fb.dir, "Kicks") })
	do(func() { u.fbButton(93, true) }) // nudge left: up, on the row left
	fbSettle(t, u, func(fb *fbState) bool { return fb.dir == filepath.Join(user, "Drums") && len(fb.rows) > 0 })
	if r, _ := fb.row(); r.Name != "Kicks" {
		t.Fatalf("back in Drums on %q, not on Kicks", r.Name)
	}
	do(func() { u.fbButton(93, true) })
	fbSettle(t, u, func(fb *fbState) bool { return fb.dir == "" && len(fb.rows) == 2 })
	if r, _ := fb.row(); r.Name != "Drums" {
		t.Fatalf("back at the top on %q", r.Name)
	}
	do(func() { u.fbButton(93, true) }) // from a place's top: the hands on the places
	if fb.level != fbPlaces {
		t.Fatal("the hands are not on the places")
	}
	do(func() { u.fbTurn(1) }) // the next place
	fbSettle(t, u, func(fb *fbState) bool { return fb.place == 1 && len(fb.rows) == 2 })
	do(func() { u.fbButton(102, true) }) // an upper button: straight to a place, hands in its list
	fbSettle(t, u, func(fb *fbState) bool { return fb.place == 0 && fb.level == fbList && len(fb.rows) == 2 })
	do(func() { u.fbAction(fbCurrent, true) }) // to the device's own file
	fbSettle(t, u, func(fb *fbState) bool { r, ok := fb.row(); return ok && r.Path == fb.before })
	do(func() { u.fbAction(fbFav, true) })
	if !fb.lib.store.isFav("audio", fb.before) {
		t.Fatal("Fav did not star the file")
	}
	do(func() { u.fbButton(93, true); u.fbButton(93, true) })
	fbSettle(t, u, func(fb *fbState) bool { return fb.dir == "" })
	do(func() { u.fbButton(93, true); u.fbButton(93, true) }) // to the places, and out
	if u.fb != nil || u.view != "chain" {
		t.Fatalf("still in the browser: view %q", u.view)
	}
}
