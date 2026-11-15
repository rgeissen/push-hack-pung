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
//      g.line(x1,y1,x2,y2,width,c), g.arc(cx,cy,r,from,sweep,width,c),
//      g.poly(points,width,c) and g.area(points,baseY,c) (a curve, the area
//      under it: one call for many points),
//      (radians, 0 = 3 o'clock, clockwise), g.dot(x,y,r,c),
//      g.text(x,y,s,c[,align -1|0|1]), g.value(x,y,s,c[,align]) (the value face)
//      Colors: "#rrggbb", a Push palette name, or "slot" "fg" "dim" "faint"
//      "line" "mod" "warn".
//   v  one entry per key: {value, frac, display, unit, name, known}, plus
//      v.$touched: the key under a finger, or "".
//   t  seconds, for motion.
//
// Where it comes from, first found wins: the module's own push_ui.js, then
// <data>/overrides/<id>/push_ui.js (the user's), then
// <hack>/overrides/<id>/push_ui.js (shipped with Pung).
//
// A script that throws, or draws over 8 ms three frames in a row (or 40 ms once), is switched off
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
	ovTop        = 26
	ovHeight     = 86
	ovBudget     = 8 * time.Millisecond  // a frame's draw, held over time (ovOverruns)
	ovHardBudget = 40 * time.Millisecond // a draw is stopped here, once is enough
	ovOverruns   = 3
)

type ovWidget struct {
	keys []string
	draw goja.Callable
}

// ovCompartment is one of a module's compartments (DESIGN-v2, "Design
// principles"): one screen on the Push, one section of the web page. Its
// keys are on the encoders, 8 to a page; screen, when set, draws the whole
// screen (a custom screen) over the encoders' names and values.
type ovCompartment struct {
	id, label string
	keys      []string // all of them, in order (what a screen gets)
	pages     []ovPage // the encoder pages; from keys, 8 at a time, when none are given
	screen    goja.Callable
	// takeover: the screen draws all of the panel (960 x 160), Pung none of
	// its own elements; only its notices and errors (UX-GUIDELINES.md, 5)
	takeover bool
	// extraKeys: values the screen shows that no encoder edits (a patch
	// name, a mode); read with the compartment's keys
	extraKeys []string
}

// screenKeys: every key a compartment's screen is given.
func (c *ovCompartment) screenKeys() []string {
	return append(append([]string{}, c.keys...), c.extraKeys...)
}

// ovPage: one encoder page of a compartment (a card of its web section).
type ovPage struct {
	label string
	keys  []string
}

type overrideSet struct {
	module       string
	source       string // the file it came from
	vm           *goja.Runtime
	widgets      []*ovWidget
	compartments []*ovCompartment // in the order declared
	failed       string           // why it is off; "" while it works
	overruns     int              // frames in a row over ovBudget
	off          bool             // the user chose the native UI
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
	push.Set("compartment", func(call goja.FunctionCall) goja.Value {
		spec := call.Argument(0).ToObject(vm)
		c := &ovCompartment{id: spec.Get("id").String(), label: spec.Get("label").String()}
		if kv := spec.Get("keys"); kv != nil && !goja.IsUndefined(kv) && !goja.IsNull(kv) {
			vm.ExportTo(kv, &c.keys) //nolint:errcheck
		}
		// pages: [{label, keys}] — the encoder pages, e.g. the cards of the
		// module's web section; their keys are the compartment's keys
		if pv := spec.Get("pages"); pv != nil && !goja.IsUndefined(pv) && !goja.IsNull(pv) {
			// read field by field: ExportTo maps Go field names, not JS ones
			arr := pv.ToObject(vm)
			c.keys = nil
			for i := 0; i < int(arr.Get("length").ToInteger()); i++ {
				o := arr.Get(fmt.Sprint(i)).ToObject(vm)
				pg := ovPage{}
				if l := o.Get("label"); l != nil && !goja.IsUndefined(l) {
					pg.label = l.String()
				}
				if kv := o.Get("keys"); kv != nil && !goja.IsUndefined(kv) {
					vm.ExportTo(kv, &pg.keys) //nolint:errcheck
				}
				c.pages = append(c.pages, pg)
				c.keys = append(c.keys, pg.keys...)
			}
		}
		if v := spec.Get("screen"); v != nil && !goja.IsUndefined(v) {
			fn, ok := goja.AssertFunction(v)
			if !ok {
				panic(vm.NewTypeError("push.compartment: screen must be a function"))
			}
			c.screen = fn
		}
		if kv := spec.Get("extra_keys"); kv != nil && !goja.IsUndefined(kv) && !goja.IsNull(kv) {
			vm.ExportTo(kv, &c.extraKeys) //nolint:errcheck
		}
		if v := spec.Get("takeover"); v != nil && !goja.IsUndefined(v) {
			c.takeover = v.ToBoolean()
		}
		if c.takeover && c.screen == nil {
			panic(vm.NewTypeError("push.compartment: takeover needs a screen"))
		}
		if c.id == "" || c.id == "undefined" || len(c.keys) == 0 {
			panic(vm.NewTypeError("push.compartment needs an id and keys"))
		}
		if c.label == "" || c.label == "undefined" {
			c.label = c.id
		}
		set.compartments = append(set.compartments, c)
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
	log.Printf("override %s: %d widget(s), %d compartment(s)", path, len(set.widgets), len(set.compartments))
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
	full      bool           // a takeover: the whole panel, from 0,0
	info      map[string]any // more for v: $page, $pages, $knobs... (takeover)
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
	Known                      bool // a value has been read (else Frac is 0 and means nothing)
}

// render draws one widget into its own image (so it cannot draw outside its
// frame) and copies that into the screen. false: it failed and is now off.
func (s *overrideSet) render(dst *image.NRGBA, p placement, vals map[string]ovValue, touched string, sc color.NRGBA) bool {
	w, h := p.span*colW-8, ovHeight
	if p.full {
		w, h = scrW, scrH
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	vm := s.vm
	g := vm.NewObject()
	g.Set("w", w)
	g.Set("h", h)
	col := func(v goja.Value) color.NRGBA { return ovColor(v.String(), sc) }
	g.Set("fill", func(x, y, ww, hh float64, c goja.Value) { rect(img, int(x), int(y), int(ww), int(hh), col(c)) })
	g.Set("line", func(x1, y1, x2, y2, width float64, c goja.Value) { aaLine(img, x1, y1, x2, y2, width, col(c)) })
	g.Set("arc", func(cx, cy, r, from, sweep, width float64, c goja.Value) {
		arc(img, cx, cy, r, from, sweep, width, col(c))
	})
	g.Set("dot", func(x, y, r float64, c goja.Value) { disc(img, x, y, r, col(c)) })
	// a curve in one call: pts is [[x,y], ...] or [x0,y0,x1,y1,...]; hundreds
	// of g.line calls from JS cost more than the 8 ms a draw has
	g.Set("poly", func(call goja.FunctionCall) goja.Value {
		pts := ovPoints(vm, call.Argument(0))
		w, c := call.Argument(1).ToFloat(), col(call.Argument(2))
		for i := 1; i < len(pts); i++ {
			aaLine(img, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1], w, c)
		}
		return goja.Undefined()
	})
	// the area between a curve and a base line, filled (pts as for poly)
	g.Set("area", func(call goja.FunctionCall) goja.Value {
		pts := ovPoints(vm, call.Argument(0))
		base, c := call.Argument(1).ToFloat(), col(call.Argument(2))
		for i := 1; i < len(pts); i++ {
			x0, y0, x1, y1 := pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]
			for x := int(x0); x < int(x1); x++ {
				y := y0 + (y1-y0)*(float64(x)-x0)/math.Max(1, x1-x0)
				top, bot := int(math.Min(y, base)), int(math.Max(y, base))
				rect(img, x, top, 1, bot-top, c)
			}
		}
		return goja.Undefined()
	})
	// Pung's envelope (visuals.go), the one the default view and the web
	// page draw: g.envelope(x, y, w, h, {attack, decay, hold, sustain,
	// slope, release, labels}). A stage is a KEY (its value and its touch
	// are read for you) or a number 0..1; a stage left out is not drawn.
	g.Set("envelope", func(call goja.FunctionCall) goja.Value {
		x, y := call.Argument(0).ToFloat(), call.Argument(1).ToFloat()
		ww, hh := call.Argument(2).ToFloat(), call.Argument(3).ToFloat()
		e := envShape{Known: true}
		if o, ok := call.Argument(4).Export().(map[string]any); ok {
			stage := func(role string) (float64, bool) {
				switch v := o[role].(type) {
				case string:
					ov, ok := vals[v]
					if !ok || !ov.Known {
						e.Known = false
					}
					if v == touched {
						e.Touched = role
					}
					return ov.Frac, true
				case int64:
					return float64(v), true
				case float64:
					return v, true
				}
				return 0, false
			}
			e.A, _ = stage("attack")
			e.D, e.HasD = stage("decay")
			e.H, e.HasH = stage("hold")
			e.S, e.HasS = stage("sustain")
			e.Slope, e.HasSlope = stage("slope")
			e.R, e.HasR = stage("release")
			e.Labels, _ = o["labels"].(bool)
			if t, ok := o["touched"].(string); ok && t != "" {
				e.Touched = t
			}
		}
		drawEnvelope(img, image.Rect(int(x), int(y), int(x+ww), int(y+hh)), e, sc)
		return goja.Undefined()
	})
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
		o.Set("known", e.Known)
		v.Set(k, o)
	}
	v.Set("$touched", touched)
	for k, x := range p.info {
		v.Set(k, x)
	}
	t := float64(time.Now().UnixNano()%1e12) / 1e9

	// The budget is 8 ms a frame, kept over time: one slow frame (curves
	// computed the first time, a cache filled) is allowed, three in a row
	// switch the picture off. A draw is stopped outright at ovHardBudget.
	start := time.Now()
	timer := time.AfterFunc(ovHardBudget, func() { vm.Interrupt("draw took longer than 40 ms") })
	_, err := p.w.draw(goja.Undefined(), g, v, vm.ToValue(t))
	timer.Stop()
	vm.ClearInterrupt()
	if took := time.Since(start); err == nil && took > ovBudget {
		if s.overruns++; s.overruns >= ovOverruns {
			err = fmt.Errorf("draw took %v, %d frames in a row over 8 ms", took.Round(time.Millisecond), s.overruns)
		}
	} else if err == nil {
		s.overruns = 0
	}
	if err != nil {
		s.failed = firstLine(err.Error())
		log.Printf("override %s: %s; the native page is back for this session", s.source, s.failed)
		return false
	}
	x, y := p.col*colW+4, ovTop
	if p.full {
		x, y = 0, 0
	}
	draw.Draw(dst, image.Rect(x, y, x+w, y+h), img, image.Point{}, draw.Over)
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

// compartment: the declared compartment with this id, or nil.
func (s *overrideSet) compartment(id string) *ovCompartment {
	if s == nil || id == "" {
		return nil
	}
	for _, c := range s.compartments {
		if c.id == id {
			return c
		}
	}
	return nil
}

// ovPoints reads a module's points: [[x,y], ...] or a flat [x0,y0,x1,y1,...].
func ovPoints(vm *goja.Runtime, v goja.Value) [][2]float64 {
	var flat []float64
	if vm.ExportTo(v, &flat) == nil && len(flat) >= 2 {
		out := make([][2]float64, 0, len(flat)/2)
		for i := 0; i+1 < len(flat); i += 2 {
			out = append(out, [2]float64{flat[i], flat[i+1]})
		}
		return out
	}
	var pairs [][]float64
	vm.ExportTo(v, &pairs) //nolint:errcheck
	out := make([][2]float64, 0, len(pairs))
	for _, p := range pairs {
		if len(p) >= 2 {
			out = append(out, [2]float64{p[0], p[1]})
		}
	}
	return out
}
