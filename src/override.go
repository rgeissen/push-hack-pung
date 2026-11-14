package main

// override.go: a module's own picture on the Push screen.
//
// A module (or an overlay for it) ships push_ui.js. It registers WIDGETS:
//
//   push.widget({
//     keys: ["attack", "decay", "sustain", "release"],
//     draw: function (g, v, t) { ... }
//   });
//
// When a bank shows those keys side by side, the widget gets the area above
// their columns (w = 120 px per key, h = 86 px); the native layer still draws
// each key's name and value under it and still owns every encoder, so a
// widget can make a page look different but cannot make it behave
// differently. Input stays native by design (Schwung's input ownership bugs
// came from modules taking input).
//
//   g  drawing, in the widget's own frame (0,0 = its top left; nothing it
//      draws can leave the frame): g.w, g.h, g.fill(x,y,w,h,c),
//      g.line(x1,y1,x2,y2,width,c), g.arc(cx,cy,r,from,sweep,width,c)
//      (radians, 0 = 3 o'clock, clockwise), g.dot(x,y,r,c),
//      g.text(x,y,s,c[,align -1|0|1]), g.value(x,y,s,c[,align]) (the value face)
//      Colors: "#rrggbb", a Push palette name, or "slot" "fg" "dim" "faint"
//      "line" "mod" "warn".
//   v  one entry per key: {value, frac, display, unit, name}, plus
//      v.$touched: the key under a finger, or "".
//   t  seconds, for motion.
//
// Where it comes from, first found wins: the module's own push_ui.js, then
// <data>/overrides/<id>/push_ui.js (the user's), then
// <hack>/overrides/<id>/push_ui.js (shipped with Schwung).
//
// A script that throws, or a draw that takes more than 8 ms, is switched off
// for the session and the native page comes back with a mark saying so.

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"log"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/federico-pepe/ableton-push-hack/core/push3"
)

const (
	ovTop    = 26
	ovHeight = 86
	ovBudget = 8 * time.Millisecond
)

type ovWidget struct {
	keys []string
	draw goja.Callable
}

type overrideSet struct {
	module  string
	source  string // the file it came from
	vm      *goja.Runtime
	widgets []*ovWidget
	failed  string // why it is off; "" while it works
	off     bool   // the user chose the native UI
}

type overrides struct {
	dirs []string // overlay roots, after the module's own dir
	sets map[string]*overrideSet
}

func newOverrides(dirs ...string) *overrides {
	return &overrides{dirs: dirs, sets: map[string]*overrideSet{}}
}

func (o *overrides) find(m ModuleInfo) string {
	cands := []string{filepath.Join(m.Dir, "push_ui.js")}
	for _, d := range o.dirs {
		cands = append(cands, filepath.Join(d, m.ID, "push_ui.js"))
	}
	for _, c := range cands {
		if exists(c) {
			return c
		}
	}
	return ""
}

// get loads (once) the overrides for a module. nil: the module has none.
func (o *overrides) get(modulesDir, id string) *overrideSet {
	if s, ok := o.sets[id]; ok {
		return s
	}
	o.sets[id] = nil
	m, ok := findModule(modulesDir, id)
	if !ok {
		return nil
	}
	path := o.find(m)
	if path == "" {
		return nil
	}
	set := &overrideSet{module: id, source: path}
	o.sets[id] = set
	src, err := os.ReadFile(path)
	if err != nil {
		set.failed = err.Error()
		return set
	}
	vm := goja.New()
	set.vm = vm
	push := vm.NewObject()
	push.Set("widget", func(call goja.FunctionCall) goja.Value {
		spec := call.Argument(0).ToObject(vm)
		var keys []string
		vm.ExportTo(spec.Get("keys"), &keys)
		fn, ok := goja.AssertFunction(spec.Get("draw"))
		if !ok || len(keys) == 0 || len(keys) > 8 {
			panic(vm.NewTypeError("push.widget needs keys (1..8) and a draw function"))
		}
		set.widgets = append(set.widgets, &ovWidget{keys: keys, draw: fn})
		return goja.Undefined()
	})
	vm.Set("push", push)
	timer := time.AfterFunc(200*time.Millisecond, func() { vm.Interrupt("push_ui.js took too long to load") })
	_, err = vm.RunScript(path, string(src))
	timer.Stop()
	if err != nil {
		set.failed = "load: " + firstLine(err.Error())
		log.Printf("override %s: %s (the native page stays)", path, set.failed)
		return set
	}
	log.Printf("override %s: %d widget(s)", path, len(set.widgets))
	return set
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// placement: where a widget sits in a bank, as columns [col, col+span).
type placement struct {
	w         *ovWidget
	col, span int
}

// place finds the widgets whose keys a bank shows side by side, in order.
func (s *overrideSet) place(keys []string) []placement {
	if s == nil || s.failed != "" || s.off {
		return nil
	}
	var out []placement
	used := make([]bool, len(keys))
	for _, w := range s.widgets {
		for c := 0; c+len(w.keys) <= len(keys); c++ {
			match := true
			for i, k := range w.keys {
				if keys[c+i] != k || used[c+i] {
					match = false
					break
				}
			}
			if match {
				for i := range w.keys {
					used[c+i] = true
				}
				out = append(out, placement{w: w, col: c, span: len(w.keys)})
				break
			}
		}
	}
	return out
}

type ovValue struct {
	Value, Display, Unit, Name string
	Frac                       float64
}

// render draws one widget into its own image (so it cannot draw outside its
// frame) and copies that into the screen. false: it failed and is now off.
func (s *overrideSet) render(dst *image.NRGBA, p placement, vals map[string]ovValue, touched string, sc color.NRGBA) bool {
	w, h := p.span*colW-8, ovHeight
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	vm := s.vm
	g := vm.NewObject()
	g.Set("w", w)
	g.Set("h", h)
	col := func(v goja.Value) color.NRGBA { return ovColor(v.String(), sc) }
	g.Set("fill", func(x, y, ww, hh float64, c goja.Value) { rect(img, int(x), int(y), int(ww), int(hh), col(c)) })
	g.Set("line", func(x1, y1, x2, y2, width float64, c goja.Value) { aaLine(img, x1, y1, x2, y2, width, col(c)) })
	g.Set("arc", func(cx, cy, r, from, sweep, width float64, c goja.Value) { arc(img, cx, cy, r, from, sweep, width, col(c)) })
	g.Set("dot", func(x, y, r float64, c goja.Value) { disc(img, x, y, r, col(c)) })
	g.Set("text", func(call goja.FunctionCall) goja.Value {
		label(img, int(call.Argument(0).ToFloat()), int(call.Argument(1).ToFloat()), call.Argument(2).String(),
			col(call.Argument(3)), int(call.Argument(4).ToInteger()))
		return goja.Undefined()
	})
	g.Set("value", func(call goja.FunctionCall) goja.Value {
		styled(img, int(call.Argument(0).ToFloat()), int(call.Argument(1).ToFloat()), call.Argument(2).String(),
			col(call.Argument(3)), faceValue, int(call.Argument(4).ToInteger()))
		return goja.Undefined()
	})
	v := vm.NewObject()
	for _, k := range p.w.keys {
		e := vals[k]
		o := vm.NewObject()
		o.Set("value", e.Value)
		o.Set("frac", e.Frac)
		o.Set("display", e.Display)
		o.Set("unit", e.Unit)
		o.Set("name", e.Name)
		v.Set(k, o)
	}
	v.Set("$touched", touched)
	t := float64(time.Now().UnixNano()%1e12) / 1e9

	start := time.Now()
	timer := time.AfterFunc(ovBudget, func() { vm.Interrupt("draw took longer than 8 ms") })
	_, err := p.w.draw(goja.Undefined(), g, v, vm.ToValue(t))
	timer.Stop()
	vm.ClearInterrupt()
	if err == nil && time.Since(start) > ovBudget {
		err = fmt.Errorf("draw took %v", time.Since(start).Round(time.Millisecond))
	}
	if err != nil {
		s.failed = firstLine(err.Error())
		log.Printf("override %s: %s; the native page is back for this session", s.source, s.failed)
		return false
	}
	x := p.col*colW + 4
	draw.Draw(dst, image.Rect(x, ovTop, x+w, ovTop+h), img, image.Point{}, draw.Over)
	return true
}

func ovColor(s string, slot color.NRGBA) color.NRGBA {
	switch s {
	case "slot", "":
		return slot
	case "fg":
		return cFg
	case "dim":
		return cDim
	case "faint":
		return cFaint
	case "line":
		return cLine
	case "mod":
		return cMod
	case "warn":
		return cWarn
	case "black":
		return cBlack
	}
	if strings.HasPrefix(s, "#") && len(s) == 7 {
		if n, err := strconv.ParseUint(s[1:], 16, 32); err == nil {
			return color.NRGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
		}
	}
	if i, ok := push3.ColorByName(s); ok {
		return push3.ColorForIndex(i).RGB
	}
	return cFg
}

// aaLine: an anti-aliased line of a given width.
func aaLine(img *image.NRGBA, x1, y1, x2, y2, width float64, c color.NRGBA) {
	minX, maxX := math.Min(x1, x2)-width-1, math.Max(x1, x2)+width+1
	minY, maxY := math.Min(y1, y2)-width-1, math.Max(y1, y2)+width+1
	dx, dy := x2-x1, y2-y1
	l2 := dx*dx + dy*dy
	for y := int(minY); y <= int(maxY); y++ {
		for x := int(minX); x <= int(maxX); x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			t := 0.0
			if l2 > 0 {
				t = math.Max(0, math.Min(1, ((px-x1)*dx+(py-y1)*dy)/l2))
			}
			d := math.Hypot(px-(x1+t*dx), py-(y1+t*dy))
			blend(img, x, y, c, width/2+0.5-d)
		}
	}
}
