package main

// sounds_view.go: the sound browser and the name editor on the Push
// (docs/PRESETS.md, "On the Push").
//
// The browser opens on a jog press over a Pung device. What it shows is
// read off the input thread (soundLib.View: IPC, a state read) into a model
// the frames draw from; the hands never wait for a module. Browsing
// auditions, and leaving the browser any way but Load (Cancel, another
// device, Push taking the screen back) puts the sound from before it back.

import (
	"fmt"
	"image"
	"image/color"
	"strings"
	"time"
	"unicode"
)

const (
	srcFactory = iota
	srcUser
	srcFavs
	srcRecent
)

var sourceNames = [4]string{"FACTORY", "USER", "FAVOURITES", "RECENT"}

// browser actions on the lower row
const (
	actFav = iota
	actSave
	actSaveAs
	actRename
	actDelete
	actCompare
	actCancel
	actLoad
)

var actionNames = [8]string{"FAV", "SAVE", "SAVE AS", "RENAME", "DELETE", "COMPARE", "CANCEL", "LOAD"}

// auditionAfter: a sound plays once the hand rests on it this long; a spin
// plays only where it stops.
const auditionAfter = 150 * time.Millisecond

type sbState struct {
	dev     *device
	key     string // the selection it was opened for (liveKey)
	source  int
	cursor  [4]int
	m       *sbModel // the last read; nil until the first arrives
	reading bool
	again   bool // a read was asked for while one ran
	timer   *time.Timer
	compare bool
	confirm string    // DELETE pressed once on this sound: press again
	confAt  time.Time // when
	ed      *nameEd
	// rows() of a source, built once per model: a list of 4133 built for
	// every row, button and light of every frame, under the surface's lock,
	// made the hands wait (Mini-JV, 2026-11-15)
	cacheM   *sbModel
	cacheSrc int
	cache    []sbRow
}

type sbModel struct {
	v      soundsView
	fvOK   bool
	banksN int
}

type sbRow struct {
	ref  soundRef
	num  int    // shown in the number column (0: none)
	name string // "" while not known
	tag  string // a second word: FACTORY / USER, a bank
	fav  bool
}

// nameEd: a name, edited with the encoders (one letter each) and the jog.
type nameEd struct {
	action  string // "saveas" | "rename"
	of      string // rename: the sound's name
	r       []rune
	win     int // the first letter over encoder 1
	cur     int // the letter last turned (DELETE, CAPS act on it)
	suggest string
}

// the letters an encoder turns through
var nameChars = []rune(" ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.'&()+#!")

// openSounds: the jog press over a Pung device. Caller holds u.mu.
func (u *surface) openSounds() {
	if u.h.sounds == nil || !u.liveReady || !u.liveWritable {
		return
	}
	d, _ := u.pungDevice()
	if d == nil {
		u.say("SOUNDS ARE FOR PUNG DEVICES")
		return
	}
	u.sb = &sbState{dev: d, key: u.liveKey, source: srcFactory}
	u.view = "sounds"
	lib := u.h.sounds
	go func() {
		err := lib.Open(d)
		u.mu.Lock()
		if err != nil && u.sb != nil && u.sb.dev == d {
			u.say("THIS MODULE DOES NOT GIVE ITS SOUND: TRYING SOUNDS CANNOT BE UNDONE")
		}
		u.mu.Unlock()
		u.readSounds(true)
	}()
}

// closeSounds leaves the browser; keep: the sound auditioned stays, else the
// one from before comes back. Caller holds u.mu.
func (u *surface) closeSounds(keep bool) {
	sb := u.sb
	if sb == nil {
		return
	}
	if sb.timer != nil {
		sb.timer.Stop()
	}
	u.sb, u.view = nil, "chain"
	lib := u.h.sounds
	d := sb.dev
	if keep {
		var r *soundRef
		if row, ok := u.sbRow(sb); ok {
			r = &row.ref
		}
		go func() {
			lib.Keep(d, r)
			u.mu.Lock()
			if c := d.snd.current; c != nil && c.Name != "" {
				u.say("SOUND: " + strings.ToUpper(c.Name))
			}
			u.mu.Unlock()
		}()
		return
	}
	go lib.Cancel(d)
}

// readSounds refreshes the model off the input thread; first: choose the
// source to start on (the one holding the device's sound).
func (u *surface) readSounds(first bool) {
	u.mu.Lock()
	sb := u.sb
	if sb == nil {
		u.mu.Unlock()
		return
	}
	if sb.reading {
		sb.again = true
		u.mu.Unlock()
		return
	}
	sb.reading = true
	d := sb.dev
	u.mu.Unlock()
	for {
		v := u.h.sounds.View(d)
		u.mu.Lock()
		if u.sb != sb {
			u.mu.Unlock()
			return
		}
		m := &sbModel{v: v, fvOK: v.Factory != nil}
		if v.Factory != nil {
			m.banksN = len(v.Factory.Banks)
		}
		sb.m = m
		if first {
			first = false
			sb.source = srcUser
			if m.fvOK {
				sb.source = srcFactory
			}
			if c := v.Current; c != nil && c.Source == "user" {
				sb.source = srcUser
			}
			// the cursor on the device's sound
			if m.fvOK && v.Factory.Index >= 0 {
				sb.cursor[srcFactory] = v.Factory.Index
			}
			if c := v.Current; c != nil && c.Source == "user" {
				for i, r := range v.User {
					if r.Name == c.Name {
						sb.cursor[srcUser] = i
					}
				}
			}
		}
		// a list that shrank (a sound deleted) keeps its cursor in it
		saved := sb.source
		for src := range sb.cursor {
			sb.source = src
			if n := len(sb.rows()); sb.cursor[src] >= n {
				sb.cursor[src] = max(0, n-1)
			}
		}
		sb.source = saved
		again := sb.again
		sb.again = false
		if !again {
			sb.reading = false
		}
		u.dirty.Store(true)
		u.mu.Unlock()
		if !again {
			return
		}
	}
}

// rows: the rows of the current source, from the cache while the model and
// the source are the same. Caller holds u.mu.
func (sb *sbState) rows() []sbRow {
	if sb.m == nil {
		return nil
	}
	if sb.cacheM == sb.m && sb.cacheSrc == sb.source && sb.cache != nil {
		return sb.cache
	}
	sb.cache, sb.cacheM, sb.cacheSrc = sb.buildRows(), sb.m, sb.source
	return sb.cache
}

func (sb *sbState) buildRows() []sbRow {
	v := sb.m.v
	var out []sbRow
	switch sb.source {
	case srcFactory:
		if f := v.Factory; f != nil {
			for i := 0; i < f.Count; i++ {
				r := sbRow{ref: soundRef{Source: "factory", Bank: f.Bank, Index: i}, num: i + 1, name: f.Names[fmt.Sprint(i)]}
				if f.Bank != "" && i == f.Index {
					r.tag = strings.ToUpper(f.Bank)
				}
				out = append(out, r)
			}
			ix := favSet(v.Favourites)
			for i := range out {
				out[i].fav = ix[refKey(out[i].ref)]
			}
		}
	case srcUser:
		for i, s := range v.User {
			out = append(out, sbRow{ref: soundRef{Source: "user", Name: s.Name}, num: i + 1, name: s.Name, fav: s.Fav})
		}
	case srcFavs, srcRecent:
		list := v.Favourites
		if sb.source == srcRecent {
			list = v.Recent
		}
		favs := favSet(v.Favourites)
		for _, r := range list {
			row := sbRow{ref: r, name: r.Name, fav: favs[refKey(r)], tag: "USER"}
			if r.Source == "factory" {
				row.num, row.tag = r.Index+1, "FACTORY"
				if r.Bank != "" {
					row.tag = strings.ToUpper(r.Bank)
				}
			}
			out = append(out, row)
		}
	}
	return out
}

func refKey(r soundRef) string {
	if r.Source == "user" {
		return "u:" + r.Name
	}
	return fmt.Sprintf("f:%s:%d", r.Bank, r.Index)
}

func favSet(list []soundRef) map[string]bool {
	m := map[string]bool{}
	for _, r := range list {
		m[refKey(r)] = true
	}
	return m
}

func (u *surface) sbRow(sb *sbState) (sbRow, bool) {
	rows := sb.rows()
	c := sb.cursor[sb.source]
	if c < 0 || c >= len(rows) {
		return sbRow{}, false
	}
	return rows[c], true
}

// sbMove moves the cursor and auditions where it rests. Caller holds u.mu.
func (u *surface) sbMove(delta int) {
	sb := u.sb
	rows := sb.rows()
	if len(rows) == 0 {
		return
	}
	c := sb.cursor[sb.source] + delta
	c = max(0, min(len(rows)-1, c))
	if c == sb.cursor[sb.source] {
		return
	}
	sb.cursor[sb.source] = c
	sb.confirm = ""
	u.sbAudition()
}

func (u *surface) sbAudition() {
	sb := u.sb
	row, ok := u.sbRow(sb)
	if !ok {
		return
	}
	if sb.timer != nil {
		sb.timer.Stop()
	}
	if u.h == nil || u.h.sounds == nil {
		return
	}
	d, lib, ref := sb.dev, u.h.sounds, row.ref
	sb.timer = time.AfterFunc(auditionAfter, func() {
		lib.Try(d, ref)
		// its name comes with it (learned): read again once it is in
		go func() {
			for i := 0; i < 80; i++ {
				time.Sleep(50 * time.Millisecond)
				d.snd.mu.Lock()
				busy := d.snd.busy
				d.snd.mu.Unlock()
				if !busy {
					break
				}
			}
			u.readSounds(false)
		}()
	})
}

// sbBank steps a factory list's bank (or jumps to a category). Caller holds u.mu.
func (u *surface) sbBank(delta int) {
	sb := u.sb
	if sb.m == nil || !sb.m.fvOK || sb.source != srcFactory {
		return
	}
	f := sb.m.v.Factory
	if len(f.Banks) == 0 {
		return
	}
	at := 0
	for i, b := range f.Banks {
		if b.Name == f.Bank || b.Index == f.BankAt {
			at = i
		}
	}
	n := at + delta
	if n < 0 || n >= len(f.Banks) {
		return
	}
	row := f.Banks[n]
	sb.m.v.Factory.Bank, sb.m.v.Factory.BankAt = row.Name, row.Index // shown at once
	sb.cache = nil
	d, lib := sb.dev, u.h.sounds
	go func() {
		cm := lib.meta(d)
		pl, ok := lib.activeList(d, cm)
		if !ok || pl.BankSelect == "" {
			return
		}
		d.SetOutside(d.c.component()+":"+pl.BankSelect, fmt.Sprint(row.Index))
		time.Sleep(100 * time.Millisecond)
		u.readSounds(false)
		u.mu.Lock()
		if u.sb == sb && sb.m != nil && sb.m.fvOK && sb.m.v.Factory.Index >= 0 {
			sb.cursor[srcFactory] = sb.m.v.Factory.Index // where the bank (or category) starts
		}
		u.dirty.Store(true)
		u.mu.Unlock()
	}()
}

// sbAction: a lower-row button. Caller holds u.mu.
func (u *surface) sbAction(a int, press bool) {
	sb := u.sb
	if a == actCompare {
		if sb.compare != press {
			sb.compare = press
			d, lib := sb.dev, u.h.sounds
			go lib.Compare(d, press)
		}
		return
	}
	if !press {
		return
	}
	row, hasRow := u.sbRow(sb)
	d, lib := sb.dev, u.h.sounds
	switch a {
	case actFav:
		if !hasRow {
			return
		}
		go func() {
			lib.store.Update(d.c.module, func(ix *soundIndex) { ix.toggleFavourite(row.ref) }) //nolint:errcheck
			u.readSounds(false)
		}()
	case actSave:
		if !u.sbActionOn(actSave) {
			if c := sb.current(); c != nil && c.Source == "user" {
				u.say("ANOTHER SOUND IS PLAYING: SAVE AS KEEPS IT, OR CANCEL")
			} else {
				u.say("SAVE KEEPS CHANGES TO ONE OF YOUR SOUNDS: USE SAVE AS")
			}
			return
		}
		go func() {
			err := lib.Save(d)
			u.mu.Lock()
			if err != nil {
				u.say(strings.ToUpper(err.Error()))
			} else {
				u.say("SAVED")
			}
			u.mu.Unlock()
			u.readSounds(false)
		}()
	case actSaveAs:
		if sb.m != nil && !sb.m.v.HasState {
			u.say("THIS MODULE CANNOT SAVE ITS SOUND")
			return
		}
		name := lib.suggestName(d, sb.current())
		sb.ed = &nameEd{action: "saveas", r: []rune(name), suggest: name}
		sb.ed.cur = max(0, len(sb.ed.r)-1)
		sb.ed.win = max(0, len(sb.ed.r)-7)
		u.view = "name"
	case actRename:
		if !hasRow || row.ref.Source != "user" {
			u.say("RENAME IS FOR YOUR OWN SOUNDS")
			return
		}
		sb.ed = &nameEd{action: "rename", of: row.ref.Name, r: []rune(row.ref.Name), suggest: row.ref.Name}
		sb.ed.cur = max(0, len(sb.ed.r)-1)
		sb.ed.win = max(0, len(sb.ed.r)-7)
		u.view = "name"
	case actDelete:
		if !hasRow || row.ref.Source != "user" {
			u.say("DELETE IS FOR YOUR OWN SOUNDS")
			return
		}
		if sb.confirm != row.ref.Name || time.Since(sb.confAt) > 3*time.Second {
			sb.confirm, sb.confAt = row.ref.Name, time.Now()
			u.say("PRESS DELETE AGAIN TO DELETE " + strings.ToUpper(row.ref.Name))
			return
		}
		sb.confirm = ""
		go func() {
			err := lib.Delete(d, row.ref.Name)
			u.mu.Lock()
			if err != nil {
				u.say(strings.ToUpper(err.Error()))
			} else {
				u.say("DELETED " + strings.ToUpper(row.ref.Name))
			}
			u.mu.Unlock()
			u.readSounds(false)
		}()
	case actCancel:
		u.closeSounds(false)
	case actLoad:
		u.closeSounds(true)
	}
}

func (sb *sbState) current() *soundRef {
	if sb.m == nil {
		return nil
	}
	return sb.m.v.Current
}

// sbButton: the browser's buttons. Returns false for one it does not take.
// Caller holds u.mu.
func (u *surface) sbButton(n byte, press bool) bool {
	sb := u.sb
	switch {
	case n >= 20 && n < 28: // the lower row
		u.sbAction(int(n-20), press)
		return true
	}
	if !press {
		return n >= 102 && n < 110 || n == 62 || n == 63 || n == 93 || n == 94 || n == 95 || n == 44 || n == 45
	}
	switch {
	case n >= 102 && n < 106: // the upper row: the sources
		sb.source, sb.confirm = int(n-102), "" // a source is looked at, not played: the cursor plays
	case n >= 106 && n < 110:
	case n == 94: // jog press: keep it
		u.closeSounds(true)
	case n == 93 || n == 44: // jog click left, D-pad left: the source before
		if sb.source > 0 {
			sb.source--
		}
	case n == 95 || n == 45:
		if sb.source < 3 {
			sb.source++
		}
	case n == 62 || n == 63: // Page: the bank, else a page of the list
		d := map[bool]int{true: -1, false: 1}[n == 62]
		if sb.source == srcFactory && sb.m != nil && sb.m.banksN > 0 {
			u.sbBank(d)
		} else {
			u.sbMove(d * 5)
		}
	default:
		return false
	}
	return true
}

// ---- the name editor ------------------------------------------------------

// edTurn: encoder i turns the letter over it. Caller holds u.mu.
func (u *surface) edTurn(enc, delta int) {
	ed := u.sb.ed
	at := min(ed.win+enc, len(ed.r)) // past the end: the next letter, never a gap of spaces
	if at == len(ed.r) {
		ed.r = append(ed.r, 'A'-1) // a new letter starts before A
		if delta < 0 {
			ed.r[at] = 'A' + 1
		}
	}
	i := indexRune(nameChars, ed.r[at])
	if i < 0 {
		i = 0
	}
	i = (i + sign(delta) + len(nameChars)) % len(nameChars)
	ed.r[at], ed.cur = nameChars[i], at
}

func indexRune(rs []rune, r rune) int {
	for i, x := range rs {
		if x == r {
			return i
		}
	}
	return -1
}

// edButton: the editor's buttons. Caller holds u.mu.
func (u *surface) edButton(n byte, press bool) bool {
	if !press {
		return true
	}
	ed := u.sb.ed
	switch n {
	case 20: // SPACE after the letter last turned
		at := min(ed.cur+1, len(ed.r))
		ed.r = append(ed.r[:at], append([]rune{' '}, ed.r[at:]...)...)
		ed.cur = at
		if ed.cur >= ed.win+8 {
			ed.win = ed.cur - 7
		}
	case 21: // DELETE the letter last turned
		if len(ed.r) > 0 {
			at := min(ed.cur, len(ed.r)-1)
			ed.r = append(ed.r[:at], ed.r[at+1:]...)
			ed.cur = max(0, at-1)
			ed.win = min(ed.win, max(0, len(ed.r)-7))
		}
	case 22: // CAPS: the letter's other case
		if ed.cur < len(ed.r) {
			c := ed.r[ed.cur]
			if unicode.IsUpper(c) {
				ed.r[ed.cur] = unicode.ToLower(c)
			} else {
				ed.r[ed.cur] = unicode.ToUpper(c)
			}
		}
	case 23: // CLEAR
		ed.r, ed.win, ed.cur = nil, 0, 0
	case 24: // the suggested name back
		ed.r = []rune(ed.suggest)
		ed.cur, ed.win = max(0, len(ed.r)-1), max(0, len(ed.r)-7)
	case 26: // CANCEL: back to the browser
		u.sb.ed, u.view = nil, "sounds"
	case 27, 94: // DONE, jog press
		u.edDone()
	case 93, 44:
		ed.win = max(0, ed.win-1)
	case 95, 45:
		ed.win = min(len(ed.r), ed.win+1)
	default:
		return n >= 20 && n < 28
	}
	return true
}

func (u *surface) edDone() {
	sb := u.sb
	ed := sb.ed
	name := strings.TrimSpace(string(ed.r))
	if name == "" {
		u.say("A SOUND NEEDS A NAME")
		return
	}
	sb.ed, u.view = nil, "sounds"
	d, lib := sb.dev, u.h.sounds
	go func() {
		var got string
		var err error
		if ed.action == "rename" {
			got, err = lib.Rename(d, ed.of, name)
		} else {
			got, err = lib.SaveAs(d, name)
		}
		u.readSounds(false)
		u.mu.Lock()
		defer u.mu.Unlock()
		if err != nil {
			u.say(strings.ToUpper(err.Error()))
			return
		}
		if ed.action == "rename" {
			u.say("RENAMED " + strings.ToUpper(got))
		} else {
			u.say("SAVED AS " + strings.ToUpper(got))
		}
		if u.sb == sb && sb.m != nil { // the cursor on it, in User
			sb.source = srcUser
			for i, r := range sb.m.v.User {
				if r.Name == got {
					sb.cursor[srcUser] = i
				}
			}
		}
	}()
}

// ---- drawing --------------------------------------------------------------

const (
	sbRowH    = 21
	sbRows    = 5
	sbListTop = 27
	sbNumW    = 64
)

func (u *surface) drawSounds(img *image.NRGBA) {
	sb := u.sb
	sc := slotColor(u.slot)
	rect(img, 0, 0, scrW, 2, sc)
	// the sources over the upper row
	for i, s := range sourceNames {
		x := i * colW
		if i == sb.source {
			rect(img, x+8, 5, colW-16, 15, sc)
			label(img, x+colW/2, 17, s, cBlack, 0)
		} else {
			label(img, x+colW/2, 17, s, cDim, 0)
		}
	}
	rows := sb.rows()
	cur := sb.cursor[sb.source]
	// the header's right: the device, the bank, where in the list
	hx := 4*colW + 8
	xr := scrW - 8
	if len(rows) > 0 {
		pos := fmt.Sprintf("%d / %d", min(cur+1, len(rows)), len(rows))
		label(img, xr, hdBase, pos, cDim, 1)
		xr -= textWidth(pos, nil) + hdGap
	}
	crumb := strings.ToUpper(sb.dev.c.Name)
	if sb.m != nil && sb.source == srcFactory && sb.m.fvOK {
		if f := sb.m.v.Factory; f.Bank != "" {
			crumb += "  /  " + strings.ToUpper(f.Bank)
		} else if f.Mode != "" {
			crumb += "  /  " + strings.ToUpper(f.Mode)
		}
	}
	if xr-hx > 3*7 {
		label(img, xr, hdBase, fitLabel(crumb, xr-hx), cFg, 1)
	}

	// the band: the bank panel (encoder 1) and the list
	listX := 0
	if sb.m != nil && sb.source == srcFactory && sb.m.banksN > 0 {
		u.drawBankPanel(img, sc)
		listX = 2 * colW
		rect(img, listX, 30, 1, 102, cFaint)
	}
	switch {
	case sb.m == nil:
		label(img, (listX+scrW)/2, 84, "READING THE SOUNDS", cDim, 0)
	case len(rows) == 0:
		label(img, (listX+scrW)/2, 84, fitLabel(emptyText(sb), scrW-listX-24), cDim, 0)
	default:
		u.drawSoundList(img, rows, cur, listX, sc)
	}
	// the actions over the lower row
	for i, a := range actionNames {
		x, w := i*colW+7, colW-14
		on := u.sbActionOn(i)
		switch {
		case i == actCompare && sb.compare:
			rect(img, x, botY+3, w, scrH-botY-6, sc)
			label(img, x+w/2, botY+17, "BEFORE", cBlack, 0)
		case i == actCancel:
			frameRect(img, x, botY+3, w, scrH-botY-6, cWarn)
			label(img, x+w/2, botY+17, a, cWarn, 0)
		case i == actLoad && on:
			rect(img, x, botY+3, w, scrH-botY-6, mixColor(sc, 0.35))
			frameRect(img, x, botY+3, w, scrH-botY-6, sc)
			label(img, x+w/2, botY+17, a, cFg, 0)
		case on:
			frameRect(img, x, botY+3, w, scrH-botY-6, cLine)
			label(img, x+w/2, botY+17, a, cFg, 0)
		default:
			label(img, x+w/2, botY+17, a, cFaint, 0)
		}
	}
}

// sbActionOn: whether a lower-row button does something now.
func (u *surface) sbActionOn(a int) bool {
	sb := u.sb
	row, ok := u.sbRow(sb)
	switch a {
	case actFav, actLoad:
		return ok
	case actSave:
		// one of your sounds, and that is what plays: while another is
		// auditioned, Save would write the audition over it
		c := sb.current()
		if c == nil || c.Source != "user" || sb.dev == nil {
			return false
		}
		sb.dev.snd.mu.Lock()
		a := sb.dev.snd.applied
		sb.dev.snd.mu.Unlock()
		return a == nil || a.same(*c)
	case actSaveAs:
		return sb.m != nil && sb.m.v.HasState
	case actRename, actDelete:
		return ok && row.ref.Source == "user"
	}
	return true
}

func emptyText(sb *sbState) string {
	switch sb.source {
	case srcFactory:
		if sb.m.fvOK && sb.m.v.Factory.Count < 0 {
			return "THE MODULE IS STILL LOADING ITS SOUNDS"
		}
		return "THIS MODULE HAS NO SOUNDS OF ITS OWN: SAVE AS KEEPS YOURS"
	case srcUser:
		if !sb.m.v.HasState {
			return "THIS MODULE CANNOT SAVE ITS SOUND"
		}
		return "NO SOUNDS OF YOURS YET: SAVE AS KEEPS THIS ONE"
	case srcFavs:
		return "NO FAVOURITES YET: FAV STARS THE HIGHLIGHTED SOUND"
	}
	return "NOTHING CHOSEN YET"
}

// drawSoundList: five rows, the cursor in the middle one where it can be.
func (u *surface) drawSoundList(img *image.NRGBA, rows []sbRow, cur, x0 int, sc color.NRGBA) {
	sb := u.sb
	first := max(0, min(cur-sbRows/2, len(rows)-sbRows))
	var applied *soundRef
	if sb.m != nil {
		d := sb.dev
		d.snd.mu.Lock()
		if d.snd.applied != nil {
			a := *d.snd.applied
			applied = &a
		}
		d.snd.mu.Unlock()
	}
	cr := sb.current()
	x, w := x0+8, scrW-x0-8-14
	for i := 0; i < sbRows && first+i < len(rows); i++ {
		r := rows[first+i]
		y := sbListTop + i*sbRowH
		on := first+i == cur
		if on {
			rect(img, x, y, w, sbRowH-2, mixColor(sc, 0.28))
			frameRect(img, x, y, w, sbRowH-2, sc)
		}
		base := y + 15
		if r.num > 0 {
			label(img, x+sbNumW-12, base, fmt.Sprint(r.num), cDim, 1)
		}
		// the right side: a star, PLAYING or CURRENT, the tag
		rx := x + w - 8
		if r.fav {
			label(img, rx, base, "*", sc, 1)
		}
		rx -= 18
		state := ""
		switch {
		case applied != nil && applied.same(r.ref) && !sb.compare: // held: the sound from before plays
			state = "PLAYING"
		case cr != nil && cr.same(r.ref):
			state = "CURRENT"
			if sb.m.v.Edited {
				state = "EDITED"
			}
		}
		if state != "" {
			label(img, rx, base, state, sc, 1)
			rx -= textWidth(state, nil) + 14
		}
		if r.tag != "" && rx-(x+sbNumW+120) > 40 {
			t := fitLabel(r.tag, min(180, rx-(x+sbNumW+120)))
			label(img, rx, base, t, cDim, 1)
			rx -= textWidth(t, nil) + 14
		}
		name := r.name
		col := cFg
		if name == "" {
			name, col = "-", cFaint // not heard yet: the number says which, and no name is guessed
		}
		styled(img, x+sbNumW, base, fitText(name, rx-(x+sbNumW)-8, faceName), col, faceName, -1)
	}
	// a scroll bar: where in the list
	if len(rows) > sbRows {
		top, h := sbListTop, sbRows*sbRowH-2
		rect(img, scrW-6, top, 2, h, cFaint)
		bh := max(6, h*sbRows/len(rows))
		by := top + (h-bh)*first/max(1, len(rows)-sbRows)
		rect(img, scrW-6, by, 2, bh, cDim)
	}
}

// drawBankPanel: the banks over encoders 1 and 2, the current one lit.
func (u *surface) drawBankPanel(img *image.NRGBA, sc color.NRGBA) {
	f := u.sb.m.v.Factory
	at := -1
	for i, b := range f.Banks {
		if b.Name == f.Bank || (at < 0 && b.Index == f.BankAt) {
			at = i
		}
	}
	label(img, 12, 40, "BANK", cDim, -1)
	label(img, 2*colW-12, 40, "ENCODER 1", cFaint, 1)
	first := max(0, min(at-1, len(f.Banks)-4))
	for i := 0; i < 4 && first+i < len(f.Banks); i++ {
		y := 48 + i*21
		b := f.Banks[first+i]
		if first+i == at {
			rect(img, 8, y, 2*colW-16, 19, mixColor(sc, 0.28))
			rect(img, 8, y, 3, 19, sc)
		}
		col := cDim
		if first+i == at {
			col = cFg
		}
		label(img, 18, y+14, fitLabel(strings.ToUpper(b.Name), 2*colW-36), col, -1)
	}
}

func (u *surface) drawNameEditor(img *image.NRGBA) {
	sb := u.sb
	ed := sb.ed
	sc := slotColor(u.slot)
	rect(img, 0, 0, scrW, 2, sc)
	title := "SAVE AS"
	if ed.action == "rename" {
		title = "RENAME " + strings.ToUpper(ed.of)
	}
	label(img, 12, hdBase, fitLabel(title+" - ONE LETTER PER ENCODER, THE JOG MOVES ALONG", scrW-24), cFg, -1)
	// the whole name, the eight letters under the hands framed
	name := string(ed.r)
	label(img, 12, 44, fitLabel("NAME", 60), cDim, -1)
	shown := fitText(name, scrW-90, faceName)
	styled(img, 70, 46, shown, cFg, faceName, -1)
	// under the name: the letters the encoders hold now
	if shown == name {
		rs := []rune(name)
		a, b := min(ed.win, len(rs)), min(ed.win+8, len(rs))
		x0 := 70 + textWidth(string(rs[:a]), faceName)
		w := textWidth(string(rs[a:b]), faceName)
		if w > 0 {
			rect(img, x0, 50, w, 2, sc)
		}
	}
	for i := 0; i < 8; i++ {
		at := ed.win + i
		x := i * colW
		c := ' '
		if at < len(ed.r) {
			c = ed.r[at]
		}
		on := at == ed.cur
		bx, by, bw, bh := x+30, 58, colW-60, 56
		if on {
			rect(img, bx, by, bw, bh, mixColor(sc, 0.28))
			frameRect(img, bx, by, bw, bh, sc)
		} else {
			frameRect(img, bx, by, bw, bh, cFaint)
		}
		s := string(c)
		if c == ' ' {
			s = "_"
		}
		col := cFg
		if at >= len(ed.r) {
			s, col = "+", cFaint // past the end: turning adds a letter
		}
		styled(img, x+colW/2, by+40, s, col, faceBig, 0)
		label(img, x+colW/2, 128, fmt.Sprint(at+1), cFaint, 0)
	}
	for i, a := range []string{"SPACE", "DELETE", "CAPS", "CLEAR", "SUGGEST", "", "CANCEL", "DONE"} {
		if a == "" {
			continue
		}
		x, w := i*colW+7, colW-14
		switch a {
		case "CANCEL":
			frameRect(img, x, botY+3, w, scrH-botY-6, cWarn)
			label(img, x+w/2, botY+17, a, cWarn, 0)
		case "DONE":
			rect(img, x, botY+3, w, scrH-botY-6, mixColor(sc, 0.35))
			frameRect(img, x, botY+3, w, scrH-botY-6, sc)
			label(img, x+w/2, botY+17, a, cFg, 0)
		default:
			frameRect(img, x, botY+3, w, scrH-botY-6, cLine)
			label(img, x+w/2, botY+17, a, cFg, 0)
		}
	}
}

// paintSoundLEDs: the browser's and the editor's buttons. Caller holds u.mu.
func (u *surface) paintSoundLEDs() {
	sc := pIdx(slotLED[u.slot%len(slotLED)])
	white, dimw, red := pIdx("white"), pIdx("dgray"), pIdx("red")
	sb := u.sb
	for i := 0; i < 8; i++ {
		v := uint8(0)
		if u.view == "sounds" && i < 4 {
			v = dimw
			if i == sb.source {
				v = sc
			}
		}
		u.led(false, 102+uint8(i), v)
	}
	for i := 0; i < 8; i++ {
		v := uint8(0)
		if u.view == "name" {
			switch {
			case i == 6:
				v = red
			case i == 7:
				v = sc
			case i < 5:
				v = white
			}
		} else {
			switch {
			case i == actCancel:
				v = red
			case i == actLoad && u.sbActionOn(i):
				v = sc
			case u.sbActionOn(i):
				v = white
			default:
				v = 0
			}
		}
		u.led(false, 20+uint8(i), v)
	}
	banks := u.view == "sounds" && sb.source == srcFactory && sb.m != nil && sb.m.banksN > 0
	u.led(false, 62, map[bool]uint8{true: 63, false: 0}[banks || u.view == "sounds"])
	u.led(false, 63, map[bool]uint8{true: 63, false: 0}[banks || u.view == "sounds"])
	u.led(false, 44, map[bool]uint8{true: 63, false: 0}[u.view == "sounds" && sb.source > 0])
	u.led(false, 45, map[bool]uint8{true: 63, false: 0}[u.view == "sounds" && sb.source < 3])
}

// soundTitle: the selected Pung device's sound for the header ("" none),
// "* " first when its state is no longer that sound. Whether it is edited
// is read off the frame (a state read is IPC), every 2 s. Caller holds u.mu.
func (u *surface) soundTitle() string {
	if u.h == nil || u.h.sounds == nil {
		return ""
	}
	d, _ := u.pungDevice()
	if d == nil {
		return ""
	}
	d.snd.mu.Lock()
	cur := d.snd.current
	d.snd.mu.Unlock()
	if cur == nil || cur.Name == "" {
		return ""
	}
	if !u.editedBusy && time.Since(u.editedAt) > 2*time.Second {
		u.editedBusy, u.editedAt = true, time.Now()
		lib := u.h.sounds
		go func() {
			e := lib.Edited(d)
			u.mu.Lock()
			if e != u.soundEdited {
				u.dirty.Store(true)
			}
			u.soundEdited, u.editedBusy = e, false
			u.mu.Unlock()
		}()
	}
	t := strings.ToUpper(cur.Name)
	if u.soundEdited {
		t = "* " + t
	}
	return t
}

// soundRect: the list's area, for tests.
func soundListRect(x0 int) image.Rectangle {
	return image.Rect(x0, sbListTop, scrW, sbListTop+sbRows*sbRowH)
}
