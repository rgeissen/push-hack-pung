package main

import (
	"fmt"
	"image"
	"strings"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// a browser over a module with everything at once: 4133 sounds, banks with
// long names, user sounds with long names, favourites and recents of both
// kinds, the current sound edited
func testBrowser() (*surface, *sbState) {
	d := &device{c: &sclass{Class: &livedevice.Class{Name: "Mini-JV With A Long Device Name"}, module: "minijv"}}
	names := map[string]string{}
	for i := 0; i < 4133; i += 3 {
		names[fmt.Sprint(i)] = fmt.Sprintf("Sound %d With A Name Far Too Long To Fit Anywhere", i)
	}
	names["5"] = "Pop Piano 3"
	var banks []bankRow
	for i := 0; i < 14; i++ {
		banks = append(banks, bankRow{Index: i, Name: fmt.Sprintf("%02d Orchestral Expansion Card Number %d", i, i)})
	}
	f := &factoryView{Mode: "patch", Count: 4133, Index: 5, Name: "Pop Piano 3", Bank: banks[3].Name, Banks: banks, BankAt: 3, Names: names}
	v := soundsView{Module: "minijv", Factory: f, HasState: true, Edited: true,
		Current: &soundRef{Source: "factory", Bank: banks[3].Name, Index: 5, Name: "Pop Piano 3"},
		User:    []userRow{{Name: "Fat Brass"}, {Name: "An Extremely Long User Sound Name That Never Ends At All", Fav: true}, {Name: "Pad"}},
		Favourites: []soundRef{{Source: "user", Name: "An Extremely Long User Sound Name That Never Ends At All"},
			{Source: "factory", Bank: banks[3].Name, Index: 5, Name: "Pop Piano 3"}},
		Recent: []soundRef{{Source: "factory", Bank: banks[13].Name, Index: 4000, Name: ""}, {Source: "user", Name: "Pad"}}}
	sb := &sbState{dev: d, m: &sbModel{v: v, fvOK: true, banksN: len(banks)}}
	u := &surface{touched: -1, peekEnc: -1, vals: map[string]string{}, view: "sounds", sb: sb}
	return u, sb
}

func TestSoundBrowserKeepsItsText(t *testing.T) {
	initFaces()
	u, sb := testBrowser()
	screen := image.Rect(0, 0, scrW, scrH)
	for src := 0; src < 4; src++ {
		sb.source = src
		n := len(sb.rows())
		for _, c := range []int{0, 1, n / 2, n - 1} {
			if c < 0 {
				c = 0
			}
			sb.cursor[src] = c
			for _, cmp := range []bool{false, true} {
				sb.compare = cmp
				img := newFrame()
				boxes := spy(func() { u.drawSounds(img) })
				what := fmt.Sprintf("%s, row %d of %d, compare %v", sourceNames[src], c, n, cmp)
				within(t, what, boxes, screen)
				apart(t, what, boxes)
				if !cmp && (c == 0 || c == n/2) {
					gallery(t, fmt.Sprintf("sounds-%s-%d", strings.ToLower(sourceNames[src]), c), img)
				}
			}
		}
	}
	// an empty source says what to do, inside the screen
	sb.m.v.User = nil
	sb.source = srcUser
	img := newFrame()
	boxes := spy(func() { u.drawSounds(img) })
	within(t, "no user sounds", boxes, screen)
	found := false
	for _, b := range boxes {
		found = found || strings.Contains(b.s, "SAVE AS")
	}
	if !found {
		t.Fatal("an empty User source says how to fill it")
	}
	gallery(t, "sounds-user-empty", img)
}

// a sound whose name was never heard shows its number, never a guess
func TestSoundBrowserUnknownNames(t *testing.T) {
	initFaces()
	u, sb := testBrowser()
	sb.source, sb.cursor[srcFactory] = srcFactory, 4 // sounds 3 to 7 shown: 6 is named, 3 and 5 are not heard yet
	boxes := spy(func() { u.drawSounds(newFrame()) })
	var got []string
	for _, b := range boxes {
		got = append(got, b.s)
	}
	all := strings.Join(got, "|")
	if strings.Count(all, "|-|") < 2 || strings.Contains(all, "#") || !strings.Contains(all, "Pop Piano 3") {
		t.Fatalf("rows: %s", all)
	}
}

func TestSoundBrowserCursor(t *testing.T) {
	u, sb := testBrowser()
	sb.source = srcUser
	u.sbMove(-1)
	if sb.cursor[srcUser] != 0 {
		t.Fatal("the cursor stays in the list")
	}
	u.sbMove(10)
	if sb.cursor[srcUser] != 2 {
		t.Fatalf("a long move stops at the end: %d", sb.cursor[srcUser])
	}
	if sb.timer != nil {
		sb.timer.Stop() // the audition is not under test here
	}
	// the actions that only make sense on a user sound
	sb.source, sb.cursor[srcFactory] = srcFactory, 5
	if u.sbActionOn(actRename) || u.sbActionOn(actDelete) || u.sbActionOn(actSave) {
		t.Fatal("rename, delete and save are for user sounds")
	}
	sb.source = srcUser
	if !u.sbActionOn(actRename) || !u.sbActionOn(actDelete) {
		t.Fatal("on a user sound, rename and delete are on")
	}
	// Save writes the device's state over the user sound it is: never while
	// another sound is auditioned
	sb.m.v.Current = &soundRef{Source: "user", Name: "Fat Brass"}
	if !u.sbActionOn(actSave) {
		t.Fatal("Save is on for the user sound the device is")
	}
	sb.dev.snd.applied = &soundRef{Source: "factory", Index: 9}
	if u.sbActionOn(actSave) {
		t.Fatal("Save must be off while another sound plays: it would overwrite Fat Brass with it")
	}
}

func TestNameEditor(t *testing.T) {
	initFaces()
	u, sb := testBrowser()
	sb.ed = &nameEd{action: "saveas"}
	u.view = "name"
	// encoder 1 starts a letter at A, encoder 2 the next
	u.edTurn(0, 1)
	u.edTurn(1, 1)
	u.edTurn(1, 1)
	if string(sb.ed.r) != "AB" {
		t.Fatalf("got %q", string(sb.ed.r))
	}
	u.edButton(22, true) // CAPS on the B
	u.edButton(20, true) // SPACE after it
	u.edTurn(3, 1)       // a letter after the space
	if string(sb.ed.r) != "Ab A" {
		t.Fatalf("got %q", string(sb.ed.r))
	}
	u.edButton(21, true) // DELETE the last turned
	if string(sb.ed.r) != "Ab " {
		t.Fatalf("got %q", string(sb.ed.r))
	}
	u.edTurn(7, 1) // far past the end: the next letter, not spaces up to encoder 8
	if string(sb.ed.r) != "Ab A" {
		t.Fatalf("got %q", string(sb.ed.r))
	}
	u.edButton(21, true)
	u.edTurn(0, -1) // turning back from A wraps to the last character
	if sb.ed.r[0] != nameChars[0] {
		t.Fatalf("A back one is %q", sb.ed.r[0])
	}
	// a long name keeps its text in place
	sb.ed = &nameEd{action: "rename", of: "An Extremely Long User Sound Name That Never Ends", r: []rune("An Extremely Long User Sound Name That Never Ends At All Really"), win: 20, cur: 22}
	img := newFrame()
	boxes := spy(func() { u.drawNameEditor(img) })
	within(t, "name editor", boxes, image.Rect(0, 0, scrW, scrH))
	apart(t, "name editor", boxes)
	gallery(t, "sounds-name-editor", img)
}
