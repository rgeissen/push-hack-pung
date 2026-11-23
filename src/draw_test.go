package main

import (
	"image/color"
	"testing"
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
