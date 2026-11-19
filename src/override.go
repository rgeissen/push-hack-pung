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
	"hash/fnv"
	"image"
	"image/color"
	"image/draw"
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dop251/goja"
	"github.com/federico-pepe/ableton-push-hack/core/push3"
)

const (
	ovTop    = 26
	ovHeight = 86
	ovBudget = 8 * time.Millisecond // a frame's draw, held over time (ovOverruns)
	// a takeover draws what Pung's own elements would have drawn as well
	ovTakeoverBudget = 14 * time.Millisecond
	ovHardBudget     = 40 * time.Millisecond  // a draw that used this much processor time is stopped, once is enough
	ovStuck          = 400 * time.Millisecond // the wall's clock: when a draw is looked at for being stuck
	ovOverruns       = 3
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
	// liveKeys: values the module drives itself (a voice's level, an LFO's
	// phase), read every frame while the screen is shown (livefx.go)
	liveKeys []string
	// wheel: what the compartment's page is about, as a key that can be walked
	// (Stacks: the chord the knobs edit). The jog wheel walks it one level
	// inside the open device (a nudge right goes in, left comes back, as
	// Push's own levels)
	wheel string
	// wheelPress: the key a press of the jog wheel sets to "on" while it
	// walks the wheel key (Stacks: hear the chord)
	wheelPress string
}

// pageScreen: the band screen for a compartment's page: the page's own,
// else the compartment's; with the keys it is given.
func (c *ovCompartment) pageScreen(page int) (goja.Callable, []string) {
	if c == nil {
		return nil, nil
	}
	if page >= 0 && page < len(c.pages) && c.pages[page].screen != nil {
		return c.pages[page].screen, append(append(append([]string{}, c.pages[page].keys...), c.extraKeys...), c.liveKeys...)
	}
	return c.screen, c.screenKeys()
}

// screenKeys: every key a compartment's screen is given.
func (c *ovCompartment) screenKeys() []string {
	return append(append(append([]string{}, c.keys...), c.extraKeys...), c.liveKeys...)
}

// ovPage: one encoder page of a compartment (a card of its web section).
type ovPage struct {
	label  string
	keys   []string
	screen goja.Callable // this page's own band screen (else the compartment's, else the default view)
}

type overrideSet struct {
	module       string
	source       string // the file it came from
	vm           *goja.Runtime
	widgets      []*ovWidget
	compartments []*ovCompartment // in the order declared
	failed       string           // why it is off; "" while it works
	overruns     int              // frames in a row over ovBudget
	// slowAt, slowN: it was switched off for being slow, when, and how often.
	// Slow is not broken: the clock is the wall's, and on a Push busy with an
	// emulator one draw was stopped at 40 ms that takes 3 (Nodal Red's Slots
	// screen, 2026-11-18). The screens were gone until Pung started again. A
	// slow script is tried again, after 3 s, then 6, 12, up to a minute.
	slowAt time.Time
	slowN  int
	// kept: each screen's last picture and what it was drawn from (render)
	kept map[string]*keptFrame
	// layers: what a screen drew once and keeps (g.layer), by size, colour and key
	layers     map[string]*image.NRGBA
	lastDrawUS int64         // the last Push draw, in microseconds (/api/surface/state)
	off        bool          // the user chose the native UI
	envTimes   goja.Callable // push.envelopeTimes: the module's engine's stage times (nil: from the knobs)
	mu         sync.Mutex    // the VM is one goroutine's at a time: the Push's draw, a web page's
}

// slowWait: how long a script switched off for being slow stays off.
func (s *overrideSet) slowWait() time.Duration {
	n := s.slowN
	if n < 1 {
		n = 1
	}
	if n > 5 {
		n = 5
	}
	return 3 * time.Second << (n - 1)
}

// retrySlow puts a script that was only slow back to work once its wait is over.
func (s *overrideSet) retrySlow() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failed != "" && !s.slowAt.IsZero() && strings.Contains(s.failed, "draw took") && time.Since(s.slowAt) > s.slowWait() {
		s.failed, s.overruns = "", 0
		log.Printf("override %s: trying the screen again", s.source)
	}
}

type overrides struct {
	mu   sync.Mutex // the Push's view and the web page both ask
	dirs []string   // overlay roots, after the module's own dir
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
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if s, ok := o.sets[id]; ok {
		if s != nil {
			s.retrySlow()
		}
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
				if sv := o.Get("screen"); sv != nil && !goja.IsUndefined(sv) {
					fn, ok := goja.AssertFunction(sv)
					if !ok {
						panic(vm.NewTypeError("push.compartment: a page's screen must be a function"))
					}
					pg.screen = fn
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
		if kv := spec.Get("live_keys"); kv != nil && !goja.IsUndefined(kv) && !goja.IsNull(kv) {
			vm.ExportTo(kv, &c.liveKeys) //nolint:errcheck
		}
		if v := spec.Get("wheel"); v != nil && !goja.IsUndefined(v) && !goja.IsNull(v) {
			c.wheel = v.String()
		}
		if v := spec.Get("wheel_press"); v != nil && !goja.IsUndefined(v) && !goja.IsNull(v) {
			c.wheelPress = v.String()
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
	// push.envelopeTimes(fn): what the module's engine makes of its stage
	// knobs, in seconds. fn(env) gets {stages: [{role, label, key, raw,
	// level_key, level, plateau}], rates, value(key)} for one envelope Pung has
	// recognized and returns each segment's seconds (null: Pung's own
	// estimate). It runs when the envelope is drawn or watched, never on
	// the live clock's tick.
	push.Set("envelopeTimes", func(call goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(call.Argument(0))
		if !ok {
			panic(vm.NewTypeError("push.envelopeTimes needs a function"))
		}
		set.envTimes = fn
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
	offline   bool           // for the web page: its time does not count against the Push's budget
	info      map[string]any // more for v: $page, $pages, $knobs... (takeover)
	live      *liveSession   // the sound's live session: g.envelope draws it moving (nil: still)
	liveOut   liveOut        // ... its latest frame
	liveKey   string         // names this placement's pictures across frames
	fx        bool           // the module is an audio effect: its envelopes follow audio, not notes
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
	Type                       string  // the parameter's (float, int, enum, ...)
	Min, Max                   float64 // its range, as the module states it
	Known                      bool    // a value has been read (else Frac is 0 and means nothing)
}

// render draws one widget into its own image (so it cannot draw outside its
// frame) and copies that into the screen. false: it failed and is now off.
func (s *overrideSet) render(dst *image.NRGBA, p placement, vals map[string]ovValue, touched string, sc color.NRGBA) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, h := p.span*colW-8, ovHeight
	if p.full {
		w, h = scrW, scrH
	}
	// A screen is a function of its values: while they are the same, so is
	// the picture, and the script does not run. A frame in which nothing
	// changed costs a copy, less than Pung's own page costs to draw; only a
	// picture that moves by itself (it read the time, or shows a sounding
	// envelope) is drawn every frame. UX-GUIDELINES.md, "A custom screen
	// costs no more than Pung's own".
	slot := fmt.Sprintf("%v|%d|%d|%t", p.w.keys, p.col, p.span, p.full)
	sig := frameSig(w, h, sc, p, vals, touched)
	if k := s.kept[slot]; k != nil && k.sig == sig && !k.moving && s.failed == "" {
		putFrame(dst, k.img, p, w, h)
		return true
	}
	moving := false
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	vm := s.vm
	g := vm.NewObject()
	g.Set("w", w)
	g.Set("h", h)
	col := func(v goja.Value) color.NRGBA { return ovColor(v.String(), sc) }
	// g.layer(key, fn): the part of a screen that does not change. fn draws
	// it once; from then on the kept picture is copied in, which costs
	// nothing next to drawing it (a panel's ground, its frames and legends:
	// Nodal Red's took 26 to 43 ms a frame on a Push busy with its emulator).
	// It replaces what the frame holds so far, so it comes first. A new key
	// (a page, a mode) draws again; a handful are kept.
	g.Set("layer", func(call goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			panic(vm.NewTypeError("g.layer(key, fn): fn must be a function"))
		}
		key := fmt.Sprintf("%dx%d|%v|%s", w, h, sc, call.Argument(0).String())
		layer := s.layers[key]
		if layer == nil {
			keep := img
			img = image.NewNRGBA(keep.Bounds())
			_, err := fn(goja.Undefined())
			layer, img = img, keep
			if err != nil {
				panic(err)
			}
			if s.layers == nil || len(s.layers) >= 12 {
				s.layers = map[string]*image.NRGBA{}
			}
			s.layers[key] = layer
		}
		copy(img.Pix, layer.Pix)
		return goja.Undefined()
	})
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
	// Pung's envelope (envmodel.go, visuals.go): the one picture every
	// envelope gets, on the default view, a module's screen and the web
	// page. g.envelope(x, y, w, h, {keys: [...], labels}) finds the envelope
	// among the keys by Pung's own rules; or name the stages: {attack,
	// decay, hold, sustain, slope, release, delay} or {time1.., rate1..,
	// level1..}, each a KEY (its value and touch read for you) or a number
	// 0..1. It runs live (every note a dot on its clock) wherever the sound
	// is watched. Returns whether it drew one.
	g.Set("envelope", func(call goja.FunctionCall) goja.Value {
		x, y := call.Argument(0).ToFloat(), call.Argument(1).ToFloat()
		ww, hh := call.Argument(2).ToFloat(), call.Argument(3).ToFloat()
		o, _ := call.Argument(4).Export().(map[string]any)
		keys, vv, labels := envSpecKeys(o, vals)
		if len(keys) == 0 {
			return vm.ToValue(false)
		}
		if t, ok := o["touched"].(string); ok && t != "" {
			touched = t
		}
		e := envShapeOf(keys, vv, touched)
		e.Labels = labels
		real := true // every stage a key: the envelope can be watched
		for _, k := range keys {
			if strings.HasPrefix(k, "#") {
				real = false
			}
		}
		if p.live != nil && e.Known && real {
			ks := envKeysSorted(keys)
			key := p.liveKey + "/env/" + ks[0]
			p.live.want(key, picGroup{kind: "env", keys: keys, fx: p.fx, secs: s.envSecsLocked(keys, vv, nil)}, vv)
			e.Live = p.liveOut.Envs[key]
			if e.Live != nil && (len(e.Live.Voices) > 0 || e.Live.Retrig > 0) {
				moving = true // notes on the envelope: the next frame differs
			}
		}
		drawEnvelope(img, image.Rect(int(x), int(y), int(x+ww), int(y+hh)), e, sc)
		return vm.ToValue(true)
	})
	// Pung's filter, LFO and mix (visuals_shapes.go), as the default view
	// and the web page draw them. A part is a KEY (value and touch read for
	// you) or a number 0..1; a filter's type and an LFO's shape may also be
	// a name ("LP 24 dB", "Saw Up").
	part := func(o map[string]any, role string, touch *string) (ovValue, bool) {
		switch v := o[role].(type) {
		case string:
			if ov, ok := vals[v]; ok {
				if v == touched {
					*touch = role
				}
				return ov, true
			}
			if role == "type" || role == "shape" {
				return ovValue{Display: v, Known: true}, true // a name
			}
			return ovValue{}, true // a key this screen was not given: unknown
		case int64:
			return ovValue{Frac: float64(v), Known: true}, true
		case float64:
			return ovValue{Frac: v, Known: true}, true
		}
		return ovValue{}, false
	}
	rectOf := func(call goja.FunctionCall) image.Rectangle {
		x, y := call.Argument(0).ToFloat(), call.Argument(1).ToFloat()
		return image.Rect(int(x), int(y), int(x+call.Argument(2).ToFloat()), int(y+call.Argument(3).ToFloat()))
	}
	g.Set("filter", func(call goja.FunctionCall) goja.Value {
		f := filterShape{Known: true, Kind: "lp", Poles: 2}
		if o, ok := call.Argument(4).Export().(map[string]any); ok {
			if v, ok := part(o, "cutoff", &f.Touched); ok {
				f.Cutoff, f.Known = v.Frac, f.Known && v.Known
			}
			if v, ok := part(o, "resonance", &f.Touched); ok {
				f.Res, f.HasRes, f.Known = v.Frac, true, f.Known && v.Known
			}
			if v, ok := part(o, "type", &f.Touched); ok {
				f.TypeName = v.Display
				if f.TypeName == "" {
					f.TypeName = v.Value
				}
				f.Kind, f.Poles = filterKind(f.TypeName)
				f.Known = f.Known && v.Known
			}
		}
		drawFilter(img, rectOf(call), f, sc)
		return goja.Undefined()
	})
	g.Set("lfo", func(call goja.FunctionCall) goja.Value {
		l := lfoShape{Known: true}
		if o, ok := call.Argument(4).Export().(map[string]any); ok {
			if v, ok := part(o, "shape", &l.Touched); ok {
				l.WaveName = v.Display
				if l.WaveName == "" {
					l.WaveName = v.Value
				}
				l.Wave, l.Known = lfoWave(l.WaveName), l.Known && v.Known
			}
			if v, ok := part(o, "rate", &l.Touched); ok {
				l.Rate, l.Known = v.Frac, l.Known && v.Known
			}
		}
		drawLFO(img, rectOf(call), l, sc)
		return goja.Undefined()
	})
	g.Set("mix", func(call goja.FunctionCall) goja.Value {
		m := mixShape{Known: true, Touched: -1}
		if list, ok := call.Argument(4).Export().([]any); ok {
			for i, it := range list {
				t := ""
				v, _ := part(map[string]any{"x": it}, "x", &t)
				if t != "" {
					m.Touched = i
				}
				m.Levels, m.Known = append(m.Levels, v.Frac), m.Known && v.Known
			}
		}
		drawMix(img, rectOf(call), m, sc)
		return goja.Undefined()
	})
	// g.text / g.value (x, y, s, colour, align[, maxWidth]): with a width,
	// the text is fitted to it as Pung fits its own (draw.go): a label cut,
	// a value in a smaller face before it is cut, a number never cut
	g.Set("text", func(call goja.FunctionCall) goja.Value {
		s := call.Argument(2).String()
		if mw := int(call.Argument(5).ToInteger()); mw > 0 {
			s = fitLabel(s, mw)
		}
		label(img, int(call.Argument(0).ToFloat()), int(call.Argument(1).ToFloat()), s,
			col(call.Argument(3)), int(call.Argument(4).ToInteger()))
		return goja.Undefined()
	})
	g.Set("value", func(call goja.FunctionCall) goja.Value {
		s, f := call.Argument(2).String(), faceValue
		if mw := int(call.Argument(5).ToInteger()); mw > 0 {
			s, f = fitValue(s, mw)
		}
		styled(img, int(call.Argument(0).ToFloat()), int(call.Argument(1).ToFloat()), s,
			col(call.Argument(3)), f, int(call.Argument(4).ToInteger()))
		return goja.Undefined()
	})
	// g.measure(s[, "value"]): its width in pixels, to lay out by
	g.Set("measure", func(s string, kind goja.Value) int {
		if kind != nil && kind.String() == "value" {
			return textWidth(s, faceValue)
		}
		return textWidth(s, nil)
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
	//
	// What is measured is the script's own processor time, on its thread,
	// not the wall's clock: Pung draws at the lowest priority beside
	// emulators at realtime priority, and a 3 ms draw that the system set
	// aside for 40 ms was taken for a slow script and switched off (Nodal
	// Red's screens, 2026-11-18). The wall's clock only stops a script that
	// never returns, and by then it has to have used its time too.
	runtime.LockOSThread()
	cpu0 := threadCPU()
	start := time.Now()
	timer := time.AfterFunc(ovStuck, func() { vm.Interrupt("draw took longer than 40 ms") })
	// the time is handed over as an object that says when it is read: a
	// screen that never looks at it does not move by itself
	clock := vm.NewObject()
	clock.Set("valueOf", func() float64 { moving = true; return t })             //nolint:errcheck
	clock.Set("toString", func() string { moving = true; return fmt.Sprint(t) }) //nolint:errcheck
	_, err := p.w.draw(goja.Undefined(), g, v, clock)
	timer.Stop()
	vm.ClearInterrupt()
	used := threadCPU() - cpu0
	runtime.UnlockOSThread()
	if err != nil && strings.Contains(err.Error(), "draw took longer") && used < ovHardBudget {
		// stopped by the wall's clock without having used its time: the
		// system kept it waiting. Not the script's doing: this frame keeps
		// the last picture, and nothing is counted against it
		if k := s.kept[slot]; k != nil {
			putFrame(dst, k.img, p, w, h)
		}
		return true
	}
	if !p.offline {
		s.lastDrawUS = used.Microseconds()
	}
	budget := ovBudget
	if p.full {
		budget = ovTakeoverBudget
	}
	_ = start
	if took := used; p.offline && err == nil {
		// a web render runs beside the Push's, on a busy device: it is
		// stopped at ovHardBudget like any draw, but never switches the
		// Push's picture off for being slow
	} else if err == nil && took > budget {
		if s.overruns++; s.overruns >= ovOverruns {
			err = fmt.Errorf("draw took %v, %d frames in a row over %v", took.Round(time.Millisecond), s.overruns, budget)
		}
	} else if err == nil {
		s.overruns = 0
	}
	if err != nil {
		s.failed = firstLine(err.Error())
		if strings.Contains(s.failed, "draw took") { // too slow, by either limit
			s.slowAt, s.slowN = time.Now(), s.slowN+1
			log.Printf("override %s: %s; the native page is back, the screen is tried again in %v", s.source, s.failed, s.slowWait())
		} else {
			log.Printf("override %s: %s; the native page is back for this session", s.source, s.failed)
		}
		return false
	}
	if s.slowN > 0 && time.Since(s.slowAt) > 2*time.Minute {
		s.slowN = 0 // it has drawn in time for two minutes: the next slow frame starts from 3 s again
	}
	if s.kept == nil || len(s.kept) >= 8 {
		s.kept = map[string]*keptFrame{}
	}
	if moving && !p.offline {
		ovMovedAt.Store(time.Now().UnixNano()) // the Push's next frame is another picture (surface.frames)
	}
	s.kept[slot] = &keptFrame{sig: sig, img: img, moving: moving}
	putFrame(dst, img, p, w, h)
	return true
}

// keptFrame: a screen's last picture, what it was drawn from, and whether it
// moves by itself.
type keptFrame struct {
	sig    uint64
	img    *image.NRGBA
	moving bool
}

// ovMovedAt: when a screen on the Push last drew a picture that moves by
// itself (it read the time). The frame loop draws the next tick then, whatever
// the sound does: Stacks' playhead ran at 13 frames a second, because only a
// sounding device counted as moving and a MIDI device makes no sound.
var ovMovedAt atomic.Int64

// frameSig: everything a screen's picture depends on.
func frameSig(w, h int, sc color.NRGBA, p placement, vals map[string]ovValue, touched string) uint64 {
	hh := fnv.New64a()
	fmt.Fprint(hh, w, h, sc, p.full, p.offline, touched, "|")
	for _, k := range p.w.keys {
		e := vals[k]
		fmt.Fprint(hh, k, "=", e.Value, "\x00", e.Display, "\x00", e.Frac, e.Known, e.Name, ";")
	}
	fmt.Fprint(hh, p.info, p.liveOut.Keys) // fmt prints a map in key order
	// a sounding envelope moves: every tick of the live session is a new picture
	for _, e := range p.liveOut.Envs {
		if e != nil && (len(e.Voices) > 0 || e.Retrig > 0) {
			fmt.Fprint(hh, "live", p.liveOut.Seq)
			break
		}
	}
	return hh.Sum64()
}

// putFrame copies a screen's picture into the frame, at its place.
func putFrame(dst, img *image.NRGBA, p placement, w, h int) {
	x, y := p.col*colW+4, ovTop
	if p.full {
		x, y = 0, 0
	}
	if p.full && dst.Bounds() == img.Bounds() && len(dst.Pix) == len(img.Pix) {
		copy(dst.Pix, img.Pix) // a takeover is the whole screen: no blending, pixel by pixel
		return
	}
	draw.Draw(dst, image.Rect(x, y, x+w, y+h), img, image.Point{}, draw.Over)
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
	// which form: goja exports [[x,y], ...] into a []float64 without an
	// error (as NaNs), so the first element decides, not ExportTo
	pairsForm := false
	if o, ok := v.(*goja.Object); ok {
		if first := o.Get("0"); first != nil {
			_, pairsForm = first.(*goja.Object)
		}
	}
	var flat []float64
	if !pairsForm && vm.ExportTo(v, &flat) == nil && len(flat) >= 2 {
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

// envSpecKeys: the envelope a g.envelope spec names: {keys: [...]} found
// by Pung's rules, or its stages named one by one (a number for a stage is
// a value of its own, under a key "#role").
func envSpecKeys(o map[string]any, vals map[string]ovValue) (map[string]string, map[string]ovValue, bool) {
	labels, _ := o["labels"].(bool)
	if list, ok := o["keys"].([]any); ok {
		var ks []string
		for _, k := range list {
			if s, ok := k.(string); ok {
				ks = append(ks, s)
			}
		}
		if gs := envelopeGroups(ks); len(gs) > 0 {
			return gs[0].keys, vals, labels
		}
		return nil, vals, labels
	}
	keys := map[string]string{}
	vv := vals
	copied := false
	for role, x := range o {
		if role == "labels" || role == "touched" || role == "keys" {
			continue
		}
		if _, ok := envWordRole[role]; !ok && role != "slope" && !envNumberedRole(role) {
			continue
		}
		switch v := x.(type) {
		case string:
			keys[role] = v
		case int64, float64:
			if !copied {
				vv = make(map[string]ovValue, len(vals)+4)
				for k, x := range vals {
					vv[k] = x
				}
				copied = true
			}
			f := 0.0
			if n, ok := v.(int64); ok {
				f = float64(n)
			} else {
				f = v.(float64)
			}
			keys[role] = "#" + role
			vv["#"+role] = ovValue{Frac: f, Known: true}
		}
	}
	if _, a := keys["attack"]; !a && len(keys) > 0 {
		if n, _ := envStageCount(keys); n == 0 {
			return nil, vals, labels
		}
	}
	return keys, vv, labels
}

// envSecs: each segment's seconds as the module's engine makes them
// (push.envelopeTimes), for an envelope of these keys; nil: the module
// says nothing.
// read, when given, answers for a knob that is not among vals (env.value:
// Dexed's attack depends on its operator's output level).
func (s *overrideSet) envSecs(keys map[string]string, vals map[string]ovValue, read func(string) (ovValue, bool)) []float64 {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.envSecsLocked(keys, vals, read)
}

func (s *overrideSet) envSecsLocked(keys map[string]string, vals map[string]ovValue, read func(string) (ovValue, bool)) []float64 {
	if s == nil || s.envTimes == nil || s.failed != "" || s.off {
		return nil
	}
	e := envShapeOf(keys, vals, "")
	if !e.Known {
		return nil
	}
	vm := s.vm
	raw := func(k string) goja.Value {
		v, ok := vals[k]
		if (!ok || !v.Known) && read != nil && k != "" {
			v, ok = read(k)
		}
		if ok && v.Known {
			if f, err := strconv.ParseFloat(strings.TrimSpace(v.Value), 64); err == nil {
				return vm.ToValue(f)
			}
		}
		return goja.Null()
	}
	stages := vm.NewArray()
	for i, sg := range e.Segs {
		o := vm.NewObject()
		o.Set("role", sg.Role)
		o.Set("label", sg.Label)
		o.Set("plateau", sg.Plateau)
		o.Set("key", sg.TimeKey)
		o.Set("raw", raw(sg.TimeKey))
		lk := ""
		if len(sg.Keys) > 1 {
			lk = sg.Keys[1]
		}
		o.Set("level_key", lk)
		o.Set("level", raw(lk))
		stages.Set(strconv.Itoa(i), o)
	}
	env := vm.NewObject()
	env.Set("stages", stages)
	env.Set("rates", e.Rates)
	env.Set("value", func(k string) goja.Value { return raw(k) }) // any knob's raw value (null: unread)
	timer := time.AfterFunc(ovHardBudget, func() { vm.Interrupt("envelopeTimes took longer than 40 ms") })
	res, err := s.envTimes(goja.Undefined(), env)
	timer.Stop()
	vm.ClearInterrupt()
	if err != nil {
		log.Printf("override %s: envelopeTimes: %s (Pung's own times)", s.source, firstLine(err.Error()))
		s.envTimes = nil
		return nil
	}
	var out []float64
	if arr, ok := res.Export().([]any); ok {
		out = make([]float64, len(e.Segs))
		for i := range out {
			out[i] = -1
			if i < len(arr) {
				switch n := arr[i].(type) {
				case int64:
					out[i] = float64(n)
				case float64:
					out[i] = n
				}
			}
		}
	}
	return out
}
