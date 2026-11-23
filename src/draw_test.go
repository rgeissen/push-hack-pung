package main

import (
	"image/color"
	"strings"
	"testing"
	"time"

	"golang.org/x/image/font"
)

// "±" (Tamzen has none) takes one 7 px cell in the label face and is drawn
// there; the value faces read it as "+-".
func TestPlusMinusLabel(t *testing.T) {
	initFaces()
	if w, want := textWidth("±3 ST", nil), textWidth("+3 ST", nil); w != want {
		t.Fatalf("± is %d px wide, want one cell (%d for +3 ST)", w, want)
	}
	if fitLabel("±3 ST", 200) != "\x7f3 ST" {
		t.Fatalf("fitLabel lost the ±: %q", fitLabel("±3 ST", 200))
	}
	img := newFrame()
	label(img, 10, 30, fitLabel("±", 50), color.NRGBA{255, 255, 255, 255}, -1)
	lit := 0
	for y := 18; y < 32; y++ {
		for x := 10; x < 17; x++ {
			if img.NRGBAAt(x, y).R > 128 {
				lit++
			}
		}
	}
	if lit < 12 {
		t.Fatalf("± drew %d pixels", lit)
	}
	if unPM(asciiOnly("±2 ST")) != "+-2 ST" {
		t.Fatalf("out of Pung: %q", unPM(asciiOnly("±2 ST")))
	}
}

// fitText cuts where the letter-by-letter search cut, and a value of
// thousands of letters (TinyHouse's wavetable list) is fitted at once.
func TestFitTextCutsAsBeforeAndFast(t *testing.T) {
	initFaces()
	slow := func(s string, w int, face font.Face) string {
		s = asciiOnly(s)
		if textWidth(s, face) <= w {
			return s
		}
		for n := len(s) - 1; n > 0; n-- {
			if c := strings.TrimRight(s[:n], " ") + "."; textWidth(c, face) <= w {
				return c
			}
		}
		return ""
	}
	texts := []string{"", "A", "CUTOFF 3.78 KHZ", "Saw Harmonics And More", "W W W W W", "iiiiiiiiiiiiiiiiiiii", "THE BUS INTO THE LADDER, BEATING"}
	for _, face := range []font.Face{nil, faceValue, faceSmall} {
		for _, s := range texts {
			for w := 0; w < 260; w += 7 {
				if got, want := fitText(s, w, face), slow(s, w, face); got != want {
					t.Fatalf("fitText(%q, %d) = %q, want %q", s, w, got, want)
				}
			}
		}
	}
	long := strings.Repeat("Basic Shapes, ", 1500)
	start := time.Now()
	for i := 0; i < 50; i++ {
		fitValue(long, 110)
	}
	if d := time.Since(start) / 50; d > 2*time.Millisecond {
		t.Fatalf("a %d-letter value takes %v to fit", len(long), d)
	}
}
