package main

// files_view.go: the file browser on the Push (docs/SAMPLES.md).
//
// It is the sound browser's sibling, and a hand that knows one knows the
// other: the upper row is where to look (the places), the list is driven by
// the jog as Push's own browser is, the lower row holds what can be done, a
// file plays where the cursor rests and becomes the device's only on Load.
//
//	USER LIB  CORE LIB  PACKS  SETS  RECORDED  FAVOURITES  RECENT
//	 DRUMS       ENCODER 1 |   Kick 808             |  [ the file's outline      ]
//	   Hats             64 | > Kick Acoustic  PLAYING|  [                         ]
//	 > Kicks            48 |   Kick Deep            |  0:01.42  44.1 kHz  16 bit  stereo
//	   Snares           31 |   Kick Vinyl      TO WAV|  412 KB   User Library / Drums / Kicks
//	 FAV   PREVIEW   CURRENT                    COMPARE   CANCEL   LOAD
//
// What the sound browser has and this has not: saving, renaming, deleting.
// A file is somebody's file; the browser chooses, it does not manage.

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// the levels the hands are on
const (
	fbPlaces = iota // the upper row: turning walks the places
	fbList          // the folder's rows
)

// the lower row
const (
	fbFav = iota
	fbPreview
	fbCurrent
	fbFree1
	fbFree2
	fbCompare
	fbCancel
	fbLoad
)

var fbActionNames = [8]string{"FAV", "PREVIEW", "CURRENT", "", "", "COMPARE", "CANCEL", "LOAD"}

type fbFrame struct {
	dir string
	cur int
}

type fbState struct {
	dev  *device
	key  string // the selection it was opened for (liveKey)
	pkey string // the parameter
	m    *paramMeta
	br   *fileBrowse
	lib  *fileLib

	places []filePlace
	totals []int // files each place holds for this parameter (-1: not counted yet)
	place  int
	root   string // the folder of the place the shown folder is under ("": the place's top)
	dir    string // the folder shown ("": the place's top)
	rows   []fileEntry
	sibs   []fileEntry // the shown folder's siblings (the folder panel)
	cur    int
	stack  []fbFrame // where the cursor was in each folder above
	level  int
	gen    int // a newer read: an older one's answer is dropped
	busy   bool
	timer  *time.Timer
	// the file under the cursor, read in the background
	af     *audioFile
	afPath string
	// the file the device held when the browser opened
	before  string
	compare bool
}

// fileParamAt: the file parameter under encoder enc on the shown page.
// Caller holds u.mu.
func (u *surface) fileParamAt(enc int) (string, *paramMeta) {
	_, cm, b := u.currentBank()
	keys := u.encKeys(b) // the page's, or a segment's (segments.go)
	if b == nil || cm == nil || enc < 0 || enc >= len(keys) || keys[enc] == "" {
		return "", nil
	}
	if m := cm.Params[keys[enc]]; m != nil && m.Type == "file" && m.File != nil {
		return keys[enc], m
	}
	return "", nil
}

// openFiles: a turn of a file parameter's encoder. Caller holds u.mu.
func (u *surface) openFiles(pkey string, m *paramMeta) {
	if u.h.files == nil || !u.liveReady {
		return
	}
	d, _ := u.pungDevice()
	if d == nil {
		u.say("FILES ARE CHOSEN ON PUNG DEVICES")
		return
	}
	lib := u.h.files
	br, err := lib.openFileBrowse(d, pkey, m)
	if err != nil {
		u.say(strings.ToUpper(err.Error()))
		return
	}
	fb := &fbState{dev: d, key: u.liveKey, pkey: pkey, m: m, br: br, lib: lib, level: fbList, before: br.before,
		places: placesFor(m.File, d.c.Name)}
	fb.totals = make([]int, len(fb.places))
	for i := range fb.totals {
		fb.totals[i] = -1
	}
	u.fb = fb
	u.view = "files"
	// where to open: at the device's file, else where the module starts,
	// else the first place that holds anything
	go func() {
		spec := m.File
		totals := make([]int, len(fb.places))
		for i, p := range fb.places {
			if p.Virtual {
				totals[i] = len(lib.virtual(p.ID, spec))
			} else {
				totals[i] = lib.total(p, spec)
			}
		}
		place, root, dir, sel := -1, "", "", ""
		at := func(path string, file bool) bool {
			if path == "" {
				return false
			}
			i, r := placeOf(fb.places, path)
			if i < 0 {
				return false
			}
			d := path
			if file {
				d = filepath.Dir(path)
			}
			if !isDir(d) {
				return false
			}
			place, root, dir = i, r, d
			if file {
				sel = path
			}
			if filepath.Clean(d) == filepath.Clean(r) && len(fb.places[i].Dirs) == 1 {
				dir = "" // the place's top
			}
			return true
		}
		_, _, _, startOK := lib.startDir(fb.places, spec)
		if !at(fb.before, true) && !(startOK && at(spec.Start, false)) {
			place = 0
			for i, n := range totals {
				if n > 0 && !fb.places[i].Virtual {
					place = i
					break
				}
			}
		}
		u.mu.Lock()
		if u.fb == fb {
			fb.totals = totals
			fb.place, fb.root, fb.dir = place, root, dir
		}
		u.mu.Unlock()
		u.fbRead(fb, sel)
	}()
}

// closeFiles leaves the browser; keep: the file under the cursor becomes the
// device's, else the one from before is back. Caller holds u.mu.
func (u *surface) closeFiles(keep bool) {
	fb := u.fb
	if fb == nil {
		return
	}
	if fb.timer != nil {
		fb.timer.Stop()
	}
	u.fb = nil
	if u.view == "files" {
		u.view = "chain"
	}
	row, ok := fb.row()
	if keep && ok && !row.Dir && !row.Missing {
		br, path := fb.br, row.Path
		convert := row.Convert
		if convert {
			u.say("CONVERTING TO WAV")
		}
		go func() {
			if _, err := br.commit(path); err != nil {
				br.cancel()
				u.mu.Lock()
				u.say(strings.ToUpper(err.Error()))
				u.mu.Unlock()
			}
			u.dirty.Store(true)
		}()
		return
	}
	go fb.br.cancel()
}

func (fb *fbState) row() (fileEntry, bool) {
	if fb.cur < 0 || fb.cur >= len(fb.rows) {
		return fileEntry{}, false
	}
	return fb.rows[fb.cur], true
}

// fbRead lists the shown folder (off the input thread) and puts the cursor
// on sel, if it is there.
func (u *surface) fbRead(fb *fbState, sel string) {
	u.mu.Lock()
	if u.fb != fb {
		u.mu.Unlock()
		return
	}
	fb.gen++
	gen := fb.gen
	fb.busy = true
	p := fb.places[fb.place]
	root, dir, spec, lib := fb.root, fb.dir, fb.m.File, fb.lib
	u.mu.Unlock()
	u.dirty.Store(true)

	var rows, sibs []fileEntry
	switch {
	case p.Virtual:
		rows = lib.virtual(p.ID, spec)
	case dir == "":
		rows = lib.listPlace(p, spec)
	default:
		rows = lib.list(root, dir, spec)
		parent := filepath.Dir(dir)
		if filepath.Clean(dir) == filepath.Clean(root) {
			sibs = nil // one of several folders of a place: its siblings are the place's top
		} else if filepath.Clean(parent) == filepath.Clean(root) && len(p.Dirs) > 1 {
			sibs = lib.listPlace(p, spec)
		} else {
			sibs = lib.list(root, parent, spec)
		}
		dirsOnly := sibs[:0:0]
		for _, e := range sibs {
			if e.Dir {
				dirsOnly = append(dirsOnly, e)
			}
		}
		sibs = dirsOnly
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.fb != fb || fb.gen != gen {
		return
	}
	fb.rows, fb.sibs, fb.busy = rows, sibs, false
	if sel != "" {
		for i, r := range rows {
			if r.Path == sel {
				fb.cur = i
			}
		}
	}
	fb.cur = max(0, min(len(rows)-1, fb.cur))
	u.fbRest(false)
	u.dirty.Store(true)
}

// fbRest: the cursor came to rest somewhere: after a moment the file there
// is read, and (play) heard. Caller holds u.mu.
func (u *surface) fbRest(play bool) {
	fb := u.fb
	if fb.timer != nil {
		fb.timer.Stop()
	}
	row, ok := fb.row()
	if !ok || row.Dir || row.Missing {
		fb.af, fb.afPath = nil, ""
		go fb.br.rest()
		return
	}
	if fb.afPath != row.Path {
		fb.af, fb.afPath = nil, row.Path
	}
	br, path := fb.br, row.Path
	fb.timer = time.AfterFunc(auditionAfter, func() {
		if play {
			go br.audition(path)
		}
		af := audioFiles.get(path)
		u.mu.Lock()
		if u.fb == fb && fb.afPath == path {
			fb.af = af
		}
		u.mu.Unlock()
		u.dirty.Store(true)
	})
}

// fbMove moves the cursor in the list. Caller holds u.mu.
func (u *surface) fbMove(delta int) {
	fb := u.fb
	if len(fb.rows) == 0 {
		return
	}
	c := max(0, min(len(fb.rows)-1, fb.cur+delta))
	if c == fb.cur {
		return
	}
	fb.cur = c
	u.fbRest(true)
}

// fbTurn: the jog, on the level the hands are on. Caller holds u.mu.
func (u *surface) fbTurn(delta int) {
	fb := u.fb
	if fb.level == fbPlaces {
		u.fbPlace(max(0, min(len(fb.places)-1, fb.place+sign(delta))), false)
		return
	}
	step := sign(delta)
	if u.shift {
		step *= 10
	}
	u.fbMove(step)
}

// fbPlace shows a place's top. down: the hands go to its list. Caller holds u.mu.
func (u *surface) fbPlace(i int, down bool) {
	fb := u.fb
	if i < 0 || i >= len(fb.places) {
		return
	}
	if down {
		fb.level = fbList
	}
	if i == fb.place && fb.dir == "" && !fb.busy {
		return
	}
	fb.place, fb.root, fb.dir, fb.cur, fb.stack = i, "", "", 0, nil
	fb.rows, fb.sibs = nil, nil
	go u.fbRead(fb, "")
}

// fbEnter goes into the folder under the cursor. Caller holds u.mu.
func (u *surface) fbEnter() {
	fb := u.fb
	row, ok := fb.row()
	if !ok || !row.Dir {
		return
	}
	fb.stack = append(fb.stack, fbFrame{fb.dir, fb.cur})
	if fb.dir == "" { // from a place's top: which of its folders this is under
		_, fb.root = placeOf(fb.places[fb.place:fb.place+1], row.Path)
	}
	fb.dir, fb.cur = row.Path, 0
	fb.rows = nil
	go u.fbRead(fb, "")
}

// fbUp goes up a folder; at a place's top the hands go to the places; from
// there, out. Caller holds u.mu.
func (u *surface) fbUp() {
	fb := u.fb
	switch {
	case fb.level == fbPlaces:
		u.closeFiles(false)
	case fb.dir == "":
		fb.level = fbPlaces
	default:
		from := fb.dir
		parent := filepath.Dir(fb.dir)
		if n := len(fb.stack); n > 0 {
			fb.dir, fb.cur = fb.stack[n-1].dir, fb.stack[n-1].cur
			fb.stack = fb.stack[:n-1]
		} else if filepath.Clean(parent) == filepath.Clean(fb.root) || filepath.Clean(fb.dir) == filepath.Clean(fb.root) {
			fb.dir = ""
		} else {
			fb.dir = parent
		}
		fb.rows = nil
		go u.fbRead(fb, from)
	}
}

// fbSibling steps to the folder beside the shown one (encoder 1). Caller holds u.mu.
func (u *surface) fbSibling(delta int) {
	fb := u.fb
	if fb.dir == "" || len(fb.sibs) < 2 {
		return
	}
	at := -1
	for i, e := range fb.sibs {
		if e.Path == fb.dir {
			at = i
		}
	}
	to := max(0, min(len(fb.sibs)-1, at+delta))
	if at < 0 || to == at {
		return
	}
	fb.dir, fb.cur = fb.sibs[to].Path, 0
	fb.rows = nil
	go u.fbRead(fb, "")
}

// fbActionOn: the lower button offers something now.
func (u *surface) fbActionOn(a int) bool {
	fb := u.fb
	row, ok := fb.row()
	file := ok && !row.Dir && !row.Missing
	switch a {
	case fbFav:
		return ok && !row.Dir
	case fbPreview:
		return fb.m.File.audio()
	case fbCurrent:
		return fb.before != ""
	case fbCompare:
		return fb.m.File.LivePreview && fb.before != ""
	case fbCancel:
		return true
	case fbLoad:
		return file
	}
	return false
}

// fbAction: a lower button. Caller holds u.mu.
func (u *surface) fbAction(a int, press bool) {
	fb := u.fb
	if a == fbCompare {
		if !u.fbActionOn(a) {
			if press && fb.before == "" {
				u.say("THE DEVICE HAD NO FILE BEFORE")
			} else if press {
				u.say("THIS MODULE HEARS A FILE ONLY ONCE IT IS LOADED")
			}
			return
		}
		fb.compare = press
		row, _ := fb.row()
		go fb.br.compare(press, row.Path)
		return
	}
	if !press {
		return
	}
	row, _ := fb.row()
	switch a {
	case fbFav:
		if !u.fbActionOn(a) {
			u.say("A FILE CAN BE A FAVOURITE, A FOLDER CANNOT")
			return
		}
		if fb.lib.store.toggleFav(fb.m.File.kind(), row.Path) {
			u.say("A FAVOURITE NOW")
		} else {
			u.say("NO LONGER A FAVOURITE")
		}
		if fb.places[fb.place].ID == placeFavs {
			go u.fbRead(fb, "")
		}
	case fbPreview:
		if !u.fbActionOn(a) {
			u.say("NOTHING HERE PLAYS")
			return
		}
		fb.br.mu.Lock()
		fb.br.Preview = !fb.br.Preview
		on := fb.br.Preview
		fb.br.mu.Unlock()
		fb.lib.setPreview(on)
		if on {
			u.fbRest(true)
		} else {
			fb.dev.stopPreview()
		}
	case fbCurrent:
		if !u.fbActionOn(a) {
			u.say("THE DEVICE HAS NO FILE YET")
			return
		}
		i, root := placeOf(fb.places, fb.before)
		if i < 0 || !isDir(filepath.Dir(fb.before)) {
			u.say("ITS FILE IS NOT IN ANY OF THESE PLACES")
			return
		}
		fb.place, fb.root, fb.dir, fb.stack, fb.level = i, root, filepath.Dir(fb.before), nil, fbList
		if filepath.Clean(fb.dir) == filepath.Clean(root) && len(fb.places[i].Dirs) == 1 {
			fb.dir = ""
		}
		fb.rows = nil
		go u.fbRead(fb, fb.before)
	case fbCancel:
		u.closeFiles(false)
	case fbLoad:
		if !u.fbActionOn(a) {
			u.say("TURN TO A FILE FIRST")
			return
		}
		u.closeFiles(true)
	}
}

// fbButton: the browser's buttons. False for one it does not take. Caller holds u.mu.
func (u *surface) fbButton(n byte, press bool) bool {
	fb := u.fb
	if n >= 20 && n < 28 {
		u.fbAction(int(n-20), press)
		return true
	}
	if !press {
		return n >= 102 && n < 110 || n == 62 || n == 63 || n == 93 || n == 94 || n == 95 || n == 44 || n == 45 || n == 91
	}
	switch {
	case n >= 102 && n < 110: // the upper row: straight to a place
		u.fbPlace(int(n-102), true)
	case n == 94 || n == 91: // jog press, D-pad centre: into a folder; on a file, load it
		row, ok := fb.row()
		switch {
		case fb.level == fbPlaces:
			fb.level = fbList
		case ok && row.Dir:
			u.fbEnter()
		case ok && row.Missing:
			u.say("THIS FILE IS NO LONGER THERE")
		case ok:
			u.closeFiles(true)
		}
	case n == 93 || n == 44: // jog nudged left, D-pad left: up
		u.fbUp()
	case n == 95 || n == 45: // jog nudged right: into a folder
		if fb.level == fbPlaces {
			fb.level = fbList
		} else {
			u.fbEnter()
		}
	case n == 62 || n == 63: // Page: a screen of the list
		u.fbMove(map[bool]int{true: -sbRows, false: sbRows}[n == 62])
	default:
		return false
	}
	return true
}

// ---- drawing ----------------------------------------------------------------------

const (
	fbListX = 2 * colW // the list starts after the folder panel
	fbInfoX = 610      // the file's outline and facts
)

func (u *surface) drawFiles(img *image.NRGBA) {
	fb := u.fb
	sc := slotColor(u.slot)
	rect(img, 0, 0, scrW, 2, sc)
	// the places over the upper row
	for i, p := range fb.places {
		x := i * colW
		empty := fb.totals[i] == 0
		switch {
		case i == fb.place && fb.level == fbPlaces: // the hands are here
			rect(img, x+6, 5, colW-12, 15, sc)
			label(img, x+colW/2, 17, fitLabel(p.Label, colW-16), cBlack, 0)
		case i == fb.place:
			rect(img, x+6, 5, colW-12, 15, mixColor(sc, 0.28))
			label(img, x+colW/2, 17, fitLabel(p.Label, colW-16), cFg, 0)
		case empty:
			label(img, x+colW/2, 17, fitLabel(p.Label, colW-16), cFaint, 0)
		default:
			label(img, x+colW/2, 17, fitLabel(p.Label, colW-16), cDim, 0)
		}
	}
	u.drawFolderPanel(img, sc)
	rect(img, fbListX, 30, 1, 102, cFaint)
	rect(img, fbInfoX-8, 30, 1, 102, cFaint)
	switch {
	case fb.busy && len(fb.rows) == 0:
		label(img, (fbListX+fbInfoX)/2, 84, "READING", cDim, 0)
	case len(fb.rows) == 0:
		for i, line := range fb.emptyText() {
			label(img, (fbListX+fbInfoX)/2, 76+i*16, fitLabel(line, fbInfoX-fbListX-24), cDim, 0)
		}
	default:
		u.drawFileList(img, sc)
	}
	u.drawFileInfo(img, sc)
	// between the actions, where no button is: whose file this is, and where
	// in the list the cursor stands
	cap := strings.ToUpper(fb.dev.c.Name) + "  /  " + strings.ToUpper(fb.m.Name)
	cx0, cx1 := fbFree1*colW+8, (fbFree2+1)*colW-8
	if n := len(fb.rows); n > 0 {
		pos := fmt.Sprintf("%d / %d", fb.cur+1, n)
		label(img, cx1, botY+17, pos, cDim, 1)
		cx1 -= textWidth(pos, nil) + hdGap
	}
	if cx1-cx0 > 3*7 {
		label(img, cx0, botY+17, fitLabel(cap, cx1-cx0), cFg, -1)
	}
	// the actions over the lower row
	for i, a := range fbActionNames {
		if a == "" {
			continue
		}
		x, w := i*colW+7, colW-14
		on := u.fbActionOn(i)
		switch {
		case i == fbCompare && fb.compare:
			rect(img, x, botY+3, w, scrH-botY-6, sc)
			label(img, x+w/2, botY+17, "BEFORE", cBlack, 0)
		case i == fbPreview && on:
			fb.br.mu.Lock()
			playing := fb.br.Preview
			fb.br.mu.Unlock()
			if playing {
				rect(img, x, botY+3, w, scrH-botY-6, mixColor(sc, 0.35))
				frameRect(img, x, botY+3, w, scrH-botY-6, sc)
				label(img, x+w/2, botY+17, "PREVIEW ON", cFg, 0)
			} else {
				frameRect(img, x, botY+3, w, scrH-botY-6, cLine)
				label(img, x+w/2, botY+17, "PREVIEW OFF", cDim, 0)
			}
		case i == fbCancel:
			frameRect(img, x, botY+3, w, scrH-botY-6, cWarn)
			label(img, x+w/2, botY+17, a, cWarn, 0)
		case i == fbLoad && on:
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

// emptyText: why a list is empty, and what would fill it.
func (fb *fbState) emptyText() []string {
	p := fb.places[fb.place]
	what := "FILES"
	if fb.m.File.audio() {
		what = "SAMPLES"
	}
	switch p.ID {
	case placeFavs:
		return []string{"NO FAVOURITES YET", "FAV ON A FILE ADDS IT"}
	case placeRecent:
		return []string{"NOTHING CHOSEN YET"}
	case placeUser, placeModule:
		return []string{"NO " + what + " HERE YET", "ADD THEM ON PUNG'S WEB PAGE, OR IN LIVE"}
	}
	return []string{"NO " + what + " HERE FOR THIS DEVICE"}
}

// crumbs: the shown folder's path below its place, as names.
func (fb *fbState) crumbs() []string {
	if fb.dir == "" {
		return nil
	}
	rel, err := filepath.Rel(fb.root, fb.dir)
	if err != nil || rel == "." {
		return []string{filepath.Base(fb.dir)}
	}
	return strings.Split(rel, string(filepath.Separator))
}

// drawFolderPanel: over encoders 1 and 2, the folder shown among its
// siblings (encoder 1 steps them), under the folder they are all in.
func (u *surface) drawFolderPanel(img *image.NRGBA, sc color.NRGBA) {
	fb := u.fb
	p := fb.places[fb.place]
	w := fbListX - 16
	head := strings.ToUpper(p.Name)
	if c := fb.crumbs(); len(c) > 1 {
		head = strings.ToUpper(c[len(c)-2])
	}
	if fb.dir == "" || len(fb.sibs) == 0 {
		// a place's top (or a list with no folders): what it is, how much it holds
		label(img, 8, 44, fitLabel(head, w), cDim, -1)
		if n := fb.totals[fb.place]; n >= 0 {
			styled(img, 8, 74, fmt.Sprint(n), cFg, faceName, -1)
			what := "FILES"
			if fb.m.File.audio() {
				what = "SAMPLES"
			}
			if n == 1 {
				what = strings.TrimSuffix(what, "S")
			}
			label(img, 8, 92, what, cDim, -1)
		}
		if fb.dir != "" {
			label(img, 8, 124, fitLabel(strings.ToUpper(filepath.Base(fb.dir)), w), cFg, -1)
		}
		return
	}
	label(img, 8, 44, fitLabel(head, w-70), cDim, -1)
	label(img, fbListX-10, 44, "ENCODER 1", cFaint, 1)
	at := 0
	for i, e := range fb.sibs {
		if e.Path == fb.dir {
			at = i
		}
	}
	const rows = 4
	first := max(0, min(at-1, len(fb.sibs)-rows))
	for i := 0; i < rows && first+i < len(fb.sibs); i++ {
		e := fb.sibs[first+i]
		y := 50 + i*sbRowH
		on := first+i == at
		if on {
			rect(img, 6, y, fbListX-14, sbRowH-2, mixColor(sc, 0.28))
			rect(img, 6, y, 3, sbRowH-2, sc)
		}
		col := cDim
		if on {
			col = cFg
		}
		n := fmt.Sprint(e.Count)
		label(img, fbListX-14, y+14, n, cDim, 1)
		label(img, 16, y+14, fitLabel(strings.ToUpper(e.Name), fbListX-14-16-textWidth(n, nil)-12), col, -1)
	}
}

// drawFileList: the shown folder's rows.
func (u *surface) drawFileList(img *image.NRGBA, sc color.NRGBA) {
	fb := u.fb
	rows, cur := fb.rows, fb.cur
	first := max(0, min(cur-sbRows/2, len(rows)-sbRows))
	x, w := fbListX+8, fbInfoX-8-fbListX-8-12
	kind := fb.m.File.kind()
	applied := ""
	fb.br.mu.Lock()
	if fb.br.applied != fb.before {
		applied = fb.br.applied
	}
	fb.br.mu.Unlock()
	for i := 0; i < sbRows && first+i < len(rows); i++ {
		r := rows[first+i]
		y := sbListTop + i*sbRowH
		on := first+i == cur
		if on {
			rect(img, x, y, w, sbRowH-2, mixColor(sc, 0.28))
			if fb.level == fbList {
				frameRect(img, x, y, w, sbRowH-2, sc) // the hands are here
			}
		}
		base := y + 15
		rx := x + w - 8
		if r.Dir {
			// a folder: its name as a file's, then what it holds and the way in
			n := fmt.Sprint(r.Count)
			label(img, rx, base, n+"  >", cDim, 1)
			rx -= textWidth(n+"  >", nil) + 12
			styled(img, x+10, base, fitText(r.Name, rx-(x+10)-6, faceName), cFg, faceName, -1)
			continue
		}
		if fb.lib.store.isFav(kind, r.Path) {
			label(img, rx, base, "*", sc, 1)
		}
		rx -= 16
		state := ""
		switch {
		case r.Missing:
			state = "GONE"
		case fb.compare && r.Path == fb.before:
			state = "PLAYING"
		case !fb.compare && on && (applied == r.Path || fb.dev.previewing()):
			state = "PLAYING"
		case r.Path == fb.before:
			state = "CURRENT"
		case r.Convert:
			state = "TO WAV"
		}
		if state != "" {
			c := sc
			if state == "TO WAV" || state == "GONE" {
				c = cDim
			}
			label(img, rx, base, state, c, 1)
			rx -= textWidth(state, nil) + 12
		}
		col := cFg
		if r.Missing {
			col = cFaint
		}
		styled(img, x+10, base, fitText(displayName(r.Name), rx-(x+10)-6, faceName), col, faceName, -1)
	}
	if len(rows) > sbRows {
		top, h := sbListTop, sbRows*sbRowH-2
		rect(img, fbInfoX-14, top, 2, h, cFaint)
		bh := max(6, h*sbRows/len(rows))
		by := top + (h-bh)*first/max(1, len(rows)-sbRows)
		rect(img, fbInfoX-14, by, 2, bh, cDim)
	}
}

// drawFileInfo: the file under the cursor: its outline, its facts, where it
// is. For a folder: what it holds.
func (u *surface) drawFileInfo(img *image.NRGBA, sc color.NRGBA) {
	fb := u.fb
	x, w := fbInfoX, scrW-fbInfoX-8
	row, ok := fb.row()
	if !ok {
		return
	}
	where := strings.ToUpper(fb.places[fb.place].Name)
	if !fb.places[fb.place].Virtual {
		for _, c := range fb.crumbs() {
			where += " / " + strings.ToUpper(c)
		}
	} else if i, root := placeOf(fb.places, row.Path); i >= 0 {
		where = strings.ToUpper(fb.places[i].Name)
		if rel, err := filepath.Rel(root, filepath.Dir(row.Path)); err == nil && rel != "." {
			where += " / " + strings.ToUpper(strings.ReplaceAll(rel, "/", " / "))
		}
	}
	if row.Dir {
		styled(img, x, 62, fitText(row.Name, w, faceName), cFg, faceName, -1)
		what := "FILES"
		if fb.m.File.audio() {
			what = "SAMPLES"
		}
		if row.Count == 1 {
			what = strings.TrimSuffix(what, "S")
		}
		label(img, x, 84, fmt.Sprintf("%d %s", row.Count, what), cDim, -1)
		label(img, x, 126, fitFromLeft(where, w), cDim, -1)
		return
	}
	// the outline
	const top, h = 30, 62
	frameRect(img, x, top, w, h, cFaint)
	mid := top + h/2
	switch {
	case row.Missing:
		label(img, x+w/2, mid+4, "THIS FILE IS NO LONGER THERE", cDim, 0)
	case fb.af == nil || fb.afPath != row.Path:
		rect(img, x+1, mid, w-2, 1, cFaint)
	case fb.af.Peaks == nil:
		rect(img, x+1, mid, w-2, 1, cFaint)
		if !isAudioExt(filepath.Ext(row.Name)) {
			label(img, x+w/2, mid-8, strings.ToUpper(strings.TrimPrefix(filepath.Ext(row.Name), ".")), cDim, 0)
		}
	default:
		drawPeaks(img, image.Rect(x+2, top+2, x+w-2, top+h-2), fb.af.Peaks, sc, cFg)
	}
	// its facts, then where it is
	var facts []string
	if fb.af != nil && fb.afPath == row.Path && fb.af.Info != nil {
		facts = fb.af.Info.describe()
	}
	if row.Size > 0 {
		facts = append(facts, sizeText(row.Size))
	}
	fx := x
	for i, f := range facts {
		f = strings.ToUpper(f)
		tw := textWidth(f, nil)
		if fx+tw > x+w {
			break
		}
		col := cDim
		if i == 0 {
			col = cFg // how long it is: what a hand asks first
		}
		label(img, fx, 108, f, col, -1)
		fx += tw + 14
	}
	label(img, x, 126, fitFromLeft(where, w), cDim, -1)
}

// drawPeaks draws a file's outline into r: a filled shape around the centre
// line, lit in the slot colour, its edge in fg. A silent file is its centre
// line.
func drawPeaks(img *image.NRGBA, r image.Rectangle, p *wavePeaks, fill, edge color.NRGBA) {
	n := len(p.Max)
	if n == 0 || r.Dx() <= 0 {
		return
	}
	// a quiet file fills its box too: the outline shows the shape, the facts
	// beside it are not its level
	peak := float32(0)
	for i := range p.Max {
		peak = max(peak, p.Max[i], -p.Min[i])
	}
	mid := (r.Min.Y + r.Max.Y) / 2
	half := float32(r.Dy()) / 2
	body := mixColor(fill, 0.55)
	rect(img, r.Min.X, mid, r.Dx(), 1, mixColor(fill, 0.28))
	if peak < 1e-4 {
		return
	}
	gain := half / max(peak, 0.05)
	for x := 0; x < r.Dx(); x++ {
		a := x * n / r.Dx()
		b := max(a+1, (x+1)*n/r.Dx())
		lo, hi := float32(0), float32(0)
		for i := a; i < b && i < n; i++ {
			lo, hi = min(lo, p.Min[i]), max(hi, p.Max[i])
		}
		y0 := mid - int(hi*gain)
		y1 := mid - int(lo*gain)
		y0, y1 = max(r.Min.Y, y0), min(r.Max.Y-1, y1)
		if y1 <= y0 {
			continue
		}
		rect(img, r.Min.X+x, y0, 1, y1-y0+1, body)
		rect(img, r.Min.X+x, y0, 1, 1, edge)
		rect(img, r.Min.X+x, y1, 1, 1, edge)
	}
}

// fitFromLeft: a path cut at its start, where a path's end says more:
// "USER LIBRARY / DRUMS / KICKS" -> ".. / DRUMS / KICKS".
func fitFromLeft(s string, w int) string {
	if textWidth(s, nil) <= w {
		return s
	}
	parts := strings.Split(s, " / ")
	for len(parts) > 1 {
		parts = parts[1:]
		if t := ".. / " + strings.Join(parts, " / "); textWidth(t, nil) <= w {
			return t
		}
	}
	return fitLabel(parts[0], w)
}

func sizeText(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 10<<20:
		return fmt.Sprintf("%.0f MB", float64(n)/(1<<20))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%d KB", n>>10)
	}
	return fmt.Sprintf("%d B", n)
}

// paintFileLEDs: the browser's lights. Caller holds u.mu.
func (u *surface) paintFileLEDs() {
	fb := u.fb
	sc := pIdx(slotLED[u.slot%len(slotLED)])
	white, red := pIdx("white"), pIdx("red")
	dimw := ledOption(0)
	if u.liveActive() {
		_, col := u.live.state().trackHeader()
		dimw = ledOption(col)
	}
	for i := 0; i < 8; i++ {
		v := uint8(0)
		if i < len(fb.places) {
			v = dimw
			if i == fb.place {
				v = ledChosen
			}
		}
		u.led(false, 102+uint8(i), v)
	}
	for i := 0; i < 8; i++ {
		v := uint8(0)
		switch {
		case fbActionNames[i] == "":
		case i == fbCancel:
			v = red
		case i == fbLoad && u.fbActionOn(i):
			v = sc
		case u.fbActionOn(i):
			v = white
		}
		u.led(false, 20+uint8(i), v)
	}
	more := uint8(0)
	if len(fb.rows) > sbRows {
		more = 63
	}
	u.led(false, 62, more)
	u.led(false, 63, more)
	u.led(false, 44, 63) // back is always somewhere: up, to the places, out
	row, ok := fb.row()
	u.led(false, 45, map[bool]uint8{true: 63, false: 0}[fb.level == fbPlaces || (ok && row.Dir)])
}

// drawFileCell: a file parameter on a device's page. Not a knob: the file's
// outline, with the positions other parameters of the page mark in it
// (a sampler's start and end), and its name. Turning its encoder opens the
// browser.
func (u *surface) drawFileCell(img *image.NRGBA, col int, p position, cm *compMeta, m *paramMeta, key string, sc color.NRGBA, keys []string) {
	cx := col*colW + colW/2
	v, ok := u.vals[u.valKey(p, key)]
	touched := u.touched == col
	nameCol := cDim
	if touched {
		nameCol = cFg
		rect(img, cx-16, 43, 32, 2, sc)
	}
	label(img, cx, 38, fitLabel(strings.ToUpper(m.Name), colW-10), nameCol, 0)
	box := image.Rect(cx-52, 50, cx+52, 100)
	frame := cLine
	if touched {
		frame = sc
	}
	frameRect(img, box.Min.X, box.Min.Y, box.Dx(), box.Dy(), frame)
	path := strings.TrimSpace(v)
	val, _ := m.display(v, ok)
	switch {
	case !ok:
	case path == "":
		label(img, cx, 79, "NO FILE", cDim, 0)
	default:
		af := audioFiles.peek(path, func() { u.dirty.Store(true) })
		inner := box.Inset(2)
		if af != nil && af.Peaks != nil {
			drawPeaks(img, inner, af.Peaks, sc, cFg)
			// the page's positions in this file: what is cut away is dimmed,
			// a play position is a line
			for _, k := range keys {
				pm := cm.Params[k]
				if pm == nil || pm.Pos == nil || pm.Pos.Of != key {
					continue
				}
				pv, has := u.vals[u.valKey(p, k)]
				if !has {
					continue
				}
				f := pm.frac(pv)
				if pm.Unit != "%" && af.Info != nil && af.Info.Seconds > 0 { // ms or seconds: of the file's length
					if x, err := strconv.ParseFloat(strings.TrimSpace(pv), 64); err == nil {
						if pm.Unit == "ms" {
							x /= 1000
						}
						f = x / af.Info.Seconds
					}
				}
				f = math.Max(0, math.Min(1, f))
				x := inner.Min.X + int(f*float64(inner.Dx()-1))
				switch pm.Pos.Mode {
				case "start":
					shade(img, image.Rect(inner.Min.X, inner.Min.Y, x, inner.Max.Y))
				case "end":
					shade(img, image.Rect(x+1, inner.Min.Y, inner.Max.X, inner.Max.Y))
				}
				rect(img, x, inner.Min.Y, 1, inner.Dy(), cFg)
			}
		} else if af != nil && !isAudioExt(filepath.Ext(path)) {
			label(img, cx, 79, strings.ToUpper(strings.TrimPrefix(filepath.Ext(path), ".")), cDim, 0)
		} else {
			rect(img, inner.Min.X, (inner.Min.Y+inner.Max.Y)/2, inner.Dx(), 1, cFaint)
		}
	}
	if path == "" && ok {
		// no file yet: what to do is the cell's whole message
		label(img, cx, 124, "TURN TO BROWSE", map[bool]color.NRGBA{true: sc, false: cDim}[touched], 0)
		return
	}
	if touched {
		label(img, cx, 111, "TURN TO BROWSE", sc, 0)
	}
	nv, nf := fitValue(val, colW-10)
	styled(img, cx, 127, nv, cFg, nf, 0)
}

// shade dims what a rectangle holds: a part of a sample that does not play.
func shade(img *image.NRGBA, r image.Rectangle) {
	r = r.Intersect(img.Bounds())
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			c := img.NRGBAAt(x, y)
			img.SetNRGBA(x, y, color.NRGBA{c.R / 3, c.G / 3, c.B / 3, 255})
		}
	}
}
