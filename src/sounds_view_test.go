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

// Push's own browser: press goes down (on a sound: loads), nudge left goes
// back up, turning moves within the level; a source without banks has none
func TestBankIndexByContainedName(t *testing.T) {
	f := &factoryView{Bank: "Preset A", BankAt: -1, Banks: []bankRow{{0, "Factory (Preset A)"}, {1, "01 Pop"}}}
	if bankIndex(f) != 0 {
		t.Fatal("Mini-JV names its bank Preset A and lists it as Factory (Preset A)")
	}
}

func TestSoundBrowserHierarchy(t *testing.T) {
	initFaces()
	u, sb := testBrowser()
	sb.level, sb.source = lvSound, srcFactory
	u.sbUp()
	if sb.level != lvBank || sb.bankCur != 3 {
		t.Fatalf("up from the sounds: the banks, on the current one; got level %d bank %d", sb.level, sb.bankCur)
	}
	u.sbTurn(1)
	if sb.bankCur != 4 || sb.m.v.Factory.Bank != "03 Orchestral Expansion Card Number 3" {
		t.Fatal("turning on the banks highlights one and applies nothing")
	}
	gallery(t, "sounds-level-bank", func() *image.NRGBA { img := newFrame(); u.drawSounds(img); return img }())
	u.sbUp()
	if sb.level != lvSource {
		t.Fatal("up from the banks: the sources")
	}
	u.sbTurn(1)
	if sb.source != srcUser {
		t.Fatal("turning on the sources switches the source")
	}
	gallery(t, "sounds-level-source", func() *image.NRGBA { img := newFrame(); u.drawSounds(img); return img }())
	u.sbDown()
	if sb.level != lvSound {
		t.Fatal("User has no banks: down goes to its sounds")
	}
	// down through the bank shown applies nothing (it would play its first sound)
	sb.source, sb.level = srcFactory, lvSound
	u.sbUp()
	u.sbDown()
	if sb.m.v.Factory.Bank != "03 Orchestral Expansion Card Number 3" || sb.level != lvSound {
		t.Fatal("going down through the current bank must change nothing")
	}
	sb.source = srcUser
	u.sbTurn(1)
	if sb.cursor[srcUser] != 1 {
		t.Fatal("turning on the sounds moves the cursor")
	}
	if sb.timer != nil {
		sb.timer.Stop()
	}
	// a nudge right on a user sound: its menu, Delete asking first
	u.sbOpenMenu()
	m := sb.menu
	var labels []string
	for _, it := range m.items {
		labels = append(labels, it.label)
	}
	got := strings.Join(labels, "|")
	if !strings.Contains(got, "RENAME") || !strings.Contains(got, "DELETE") || !strings.Contains(got, "FAVOURITES") {
		t.Fatalf("a user sound's menu: %s", got)
	}
	img := newFrame()
	boxes := spy(func() { u.drawSounds(img) })
	within(t, "context menu", boxes, image.Rect(0, 0, scrW, scrH))
	gallery(t, "sounds-menu", img)
	for i, it := range m.items {
		if it.act == actDelete {
			m.cur = i
		}
	}
	u.sbMenuChoose()
	if sb.menu == nil || sb.menu.items[sb.menu.cur].act != -1 {
		t.Fatal("Delete asks first, with Keep it highlighted")
	}
	gallery(t, "sounds-menu-delete", func() *image.NRGBA { img := newFrame(); u.drawSounds(img); return img }())
	u.sbMenuChoose()
	if sb.menu != nil {
		t.Fatal("Keep it closes the menu")
	}
}

// the jog in the name editor, as Push's own text entry: turn the letter at
// the cursor, nudge to move the cursor
func TestNameEditorJog(t *testing.T) {
	u, sb := testBrowser()
	sb.ed = &nameEd{action: "saveas", r: []rune("Pad"), cur: 2}
	u.edJog(1)
	if string(sb.ed.r) != "Pae" {
		t.Fatalf("got %q", string(sb.ed.r))
	}
	u.edCursor(1)
	u.edJog(1)
	if string(sb.ed.r) != "PaeA" {
		t.Fatalf("one past the end, a turn adds a letter: %q", string(sb.ed.r))
	}
	u.edCursor(-9)
	if sb.ed.cur != 0 || sb.ed.win != 0 {
		t.Fatal("the cursor stops at the start, the window with it")
	}
}
