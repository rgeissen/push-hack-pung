package main

// view_test.go: every element of the Pung view keeps its text inside itself.
// Each is drawn with the longest names, values and units a module can give,
// every text's box is recorded (textSpy), and a box that leaves its element
// or runs into another text fails. PUNG_GALLERY=<dir> also writes the
// frames, to look at.

import (
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type textBox struct {
	r image.Rectangle
	s string
}

// spy records the text boxes drawn while fn runs.
func spy(fn func()) []textBox {
	var got []textBox
	textSpy = func(r image.Rectangle, s string) { got = append(got, textBox{r, s}) }
	defer func() { textSpy = nil }()
	fn()
	return got
}

// within: every box inside r (x only: a row's height is the font's).
func within(t *testing.T, what string, boxes []textBox, r image.Rectangle) {
	t.Helper()
	for _, b := range boxes {
		if b.r.Min.X < r.Min.X || b.r.Max.X > r.Max.X || b.r.Min.Y < r.Min.Y || b.r.Max.Y > r.Max.Y {
			t.Errorf("%s: %q at %v leaves its element %v", what, b.s, b.r, r)
		}
	}
}

// apart: no two boxes overlap.
func apart(t *testing.T, what string, boxes []textBox) {
	t.Helper()
	for i := range boxes {
		for j := i + 1; j < len(boxes); j++ {
			if boxes[i].r.Overlaps(boxes[j].r) {
				t.Errorf("%s: %q %v runs into %q %v", what, boxes[i].s, boxes[i].r, boxes[j].s, boxes[j].r)
			}
		}
	}
}

func gallery(t *testing.T, name string, img *image.NRGBA) {
	dir := os.Getenv("PUNG_GALLERY")
	if dir == "" {
		return
	}
	os.MkdirAll(dir, 0o755) //nolint:errcheck
	f, err := os.Create(filepath.Join(dir, name+".png"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	png.Encode(f, img) //nolint:errcheck
}

func fptr(f float64) *float64 { return &f }

// hardCells: one parameter of each kind, at its widest.
func hardCells() ([]*paramMeta, []string) {
	many := make([]string, 40)
	for i := range many {
		many[i] = fmt.Sprintf("Waveform Number %d Extended", i+1)
	}
	return []*paramMeta{
			{Key: "a", Name: "Filter Envelope Amount To Cutoff", Type: "float", Min: -24000, Max: 24000, Unit: "semitones", Default: fptr(0)},
			{Key: "b", Name: "Pan", Type: "float", Min: -1, Max: 1, Unit: "%", Bipolar: true},
			{Key: "c", Name: "Delay Time", Type: "float", Min: 0, Max: 1, Format: "%.4f seconds", Unit: ""},
			{Key: "d", Name: "TxRx Prog Chan.", Type: "enum", Options: []string{"Off", "On", "Bank Sel + Prog Change Extended"}},
			{Key: "e", Name: "Oscillator 1 Waveform Select", Type: "enum", Options: many},
			{Key: "f", Name: "Patch Name", Type: "string"},
			{Key: "g", Name: "Voices In Use", Type: "int", Min: 0, Max: 100000, ReadOnly: true},
			{Key: "h", Name: "Fine Tune", Type: "int", Min: -12000, Max: 12000, Unit: "cents"},
		}, []string{
			"-23999.98", "-0.5", "0.123456", "Bank Sel + Prog Change Extended", "Waveform Number 37 Extended",
			"A Very Long Patch Name That Goes On", "99999", "-11999",
		}
}

func testSurface(metas []*paramMeta, vals []string) (*surface, position) {
	u := &surface{touched: -1, peekEnc: -1, vals: map[string]string{}}
	p := position{Kind: "synth", Prefix: "synth", Module: "x", Name: "An Instrument With A Long Name"}
	for i, m := range metas {
		u.vals[u.valKey(p, m.Key)] = vals[i]
	}
	return u, p
}

func colRect(c int) image.Rectangle {
	return image.Rect(c*colW+1, topH, (c+1)*colW-1, botY)
}

func TestCellsKeepTheirText(t *testing.T) {
	initFaces()
	metas, vals := hardCells()
	u, p := testSurface(metas, vals)
	for _, touched := range []int{-1, 0, 1, 2, 3, 4, 5, 6, 7} {
		for _, shift := range []bool{false, true} {
			u.touched, u.shift = touched, shift
			img := newFrame()
			for c, m := range metas {
				boxes := spy(func() { u.drawCell(img, c, p, m, m.Key, slotColor(0)) })
				what := fmt.Sprintf("cell %d (%s, touched %d, shift %v)", c, m.Type, touched, shift)
				within(t, what, boxes, colRect(c))
				apart(t, what, boxes)
			}
			if !shift {
				gallery(t, fmt.Sprintf("cells-touched%d", touched), img)
			}
		}
	}
	// a value not read yet, and an unknown parameter
	u.touched = -1
	delete(u.vals, u.valKey(p, "a"))
	boxes := spy(func() { u.drawCell(newFrame(), 0, p, metas[0], "a", slotColor(0)) })
	within(t, "unread value", boxes, colRect(0))
	boxes = spy(func() { u.drawCell(newFrame(), 1, p, nil, "an_unknown_key_with_a_long_name", slotColor(0)) })
	within(t, "unknown key", boxes, colRect(1))
}

// the value is what the hand is after: it is never cut where a smaller face
// holds it, and a cut value is still a cut, marked
func TestValuesShrinkBeforeTheyAreCut(t *testing.T) {
	initFaces()
	s, f := fitValue("Bank Sel + Prog Change", 80)
	if s != "Bank Sel + Prog Change" && f == faceValue {
		t.Fatalf("cut in the big face: %q", s)
	}
	if w := textWidth(s, f); w > 80 {
		t.Fatalf("%q is %d px in an 80 px box", s, w)
	}
	if s, f := fitValue("On", 80); s != "On" || f != faceValue {
		t.Fatalf("a short value left the value face: %q", s)
	}
	if _, f := fitValue("A Very Long Patch Name That Goes On", 100); f == nil {
		t.Fatal("a long value fell to the label face")
	}
	// numbers are never cut: shortened, or not shown
	for in, want := range map[string]string{"-24000": "-24K", "1500000": "1.5M", "12000": "12K", "-0.5": "-0.5"} {
		if got := fitNumber(in, 30, nil); got != want {
			t.Errorf("fitNumber(%q) = %q, want %q", in, got, want)
		}
	}
	if got := fitNumber("-123456789012", 20, nil); got != "" {
		t.Errorf("a number that cannot fit came back as %q", got)
	}
	if s := fitText("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 70, nil); textWidth(s, nil) > 70 || !strings.HasSuffix(s, ".") {
		t.Fatalf("cut %q", s)
	}
}

func TestUnderWidgetKeepsItsText(t *testing.T) {
	initFaces()
	metas, vals := hardCells()
	u, p := testSurface(metas, vals)
	img := newFrame()
	for c, m := range metas {
		u.touched = c
		boxes := spy(func() { u.drawUnderWidget(img, c, p, m, m.Key, slotColor(0)) })
		within(t, fmt.Sprintf("under widget %d", c), boxes, colRect(c))
	}
	gallery(t, "under-widget", img)
}

func TestHeaderLayout(t *testing.T) {
	initFaces()
	for nb := 0; nb <= 8; nb++ {
		for _, pages := range []int{0, 1, 2, 9, 37, 120} {
			for _, page := range []int{0, pages / 2, pages - 1} {
				if page < 0 {
					page = 0
				}
				hd := header{track: "MY VERY LONG TRACK NAME FOR A SET", trackCol: cFg, bank: "OSCILLATOR SECTION / WAVEFORM MODULATION",
					warn: "MODULE UI OFF", page: page, pages: pages, meter: true, peak: -6}
				img := newFrame()
				x0 := nb*colW + 4
				boxes := spy(func() { drawHeader(img, x0, hd, slotColor(1)) })
				what := fmt.Sprintf("header nb=%d page %d/%d", nb, page+1, pages)
				within(t, what, boxes, image.Rect(x0, 0, scrW, topH))
				apart(t, what, boxes)
				// the page indicator is there wherever its width is
				ind := fmt.Sprintf("%d/%d", page+1, pages)
				shown := false
				for _, b := range boxes {
					shown = shown || b.s == ind
				}
				if pages > 1 && pageIndicatorWidth(page, pages) <= scrW-8-x0 && !shown {
					t.Errorf("%s: no page indicator", what)
				}
				if pages <= 1 && shown {
					t.Errorf("%s: an indicator for one page", what)
				}
				if page == pages/2 && pages == 37 && (nb == 0 || nb == 3 || nb == 7) {
					gallery(t, fmt.Sprintf("header-nb%d", nb), img)
				}
			}
		}
	}
}

func TestPeekCardKeepsItsText(t *testing.T) {
	initFaces()
	metas, vals := hardCells()
	u, p := testSurface(metas, vals)
	for enc, m := range metas {
		img := newFrame()
		boxes := spy(func() { u.drawPeek(img, enc, p, m, m.Key, slotColor(2)) })
		start := min(enc, 5)
		card := image.Rect(start*colW+4, 24, start*colW+4+3*colW-8, 24+112)
		within(t, fmt.Sprintf("card %d", enc), boxes, card)
		apart(t, fmt.Sprintf("card %d", enc), boxes)
		if enc == 3 || enc == 0 {
			gallery(t, fmt.Sprintf("card-%d", enc), img)
		}
	}
}

func TestBottomRowsKeepTheirText(t *testing.T) {
	initFaces()
	u := &surface{touched: -1}
	long := "A Device Name Far Too Long For Its Box"
	u.positions = []position{{Kind: "midi", Name: long}, {Kind: "synth", Name: long, Bypassed: true}, {Kind: "fx", Name: long},
		{Kind: "fx", Name: long, Bypassed: true}, {Kind: "add"}, {Kind: "fx", Name: long}, {Kind: "fx", Name: "Short"}, {Kind: "add"}, {Kind: "fx", Name: long}}
	y, h := botY+3, scrH-botY-6
	for _, sel := range []int{0, 1, 4} {
		u.pos = sel
		img := newFrame()
		boxes := spy(func() { u.drawChainRow(img, y, h) })
		for _, b := range boxes {
			c := b.r.Min.X / colW
			within(t, fmt.Sprintf("chain row, position %d", c), []textBox{b}, image.Rect(c*colW+7, y, c*colW+colW-7, y+h))
		}
		apart(t, "chain row", boxes)
		gallery(t, fmt.Sprintf("chain-row-%d", sel), img)
	}
	var tracks []liveTrack
	for i := 0; i < 11; i++ {
		tracks = append(tracks, liveTrack{Name: fmt.Sprintf("%d-%s", i+1, long), Color: 0xff8800 + i})
	}
	img := newFrame()
	boxes := spy(func() { drawTrackCells(img, y, h, tracks[8:], 8, 9, len(tracks)) })
	for _, b := range boxes {
		c := b.r.Min.X / colW
		within(t, fmt.Sprintf("track %d", c), []textBox{b}, image.Rect(c*colW+7, y, c*colW+colW-7, y+h))
	}
	gallery(t, "track-row", img)
}

func TestBrowserKeepsItsText(t *testing.T) {
	initFaces()
	u := &surface{touched: -1}
	u.br = browser{mode: "swap", kind: "sound_generator", target: position{Name: "The Instrument Being Replaced Here", Module: "m3"}}
	for i := 0; i < 19; i++ {
		u.br.items = append(u.br.items, ModuleInfo{ID: fmt.Sprintf("m%d", i), Name: "WWWWWWWWWWWWWWWWWWWW Synth", Author: "An Author With A Long Name",
			Version: "1.23.456-beta.7+build"})
	}
	u.br.cursor = 3
	img := newFrame()
	boxes := spy(func() { u.drawBrowser(img) })
	var cards, top []textBox
	for _, b := range boxes {
		if b.r.Max.Y <= topH {
			top = append(top, b)
		} else if b.r.Min.Y < botY {
			cards = append(cards, b)
		}
	}
	within(t, "browser title", top, image.Rect(0, 0, scrW, topH))
	apart(t, "browser title", top)
	for _, b := range cards {
		c := b.r.Min.X / colW
		within(t, fmt.Sprintf("browser card %d", c), []textBox{b}, image.Rect(c*colW+5, 26, c*colW+colW-5, 26+108))
	}
	apart(t, "browser cards", cards)
	gallery(t, "browser", img)
}
