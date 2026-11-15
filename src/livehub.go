package main

// livehub.go: one live session per sound (a Live device's slot, or a Pung
// slot), shared by everyone watching it: the Push view and any number of
// web pages (docs/UX-GUIDELINES.md, "Live pictures"). The session is the
// ONLY reader of the slot's live state (livestate.go: a look takes the
// level), so the Push and the page can never tell two stories about one
// sound. It ticks at 30 frames a second while someone watches and stops
// when no one does: a closed page costs nothing.
//
// A watcher says which pictures it shows (want: a key, the recognized
// group, its values); the session works out each one's live state every
// tick (livefx.go) and keeps the latest frame. The Push reads the frame as
// it draws; a web page gets each frame as JSON over Server-Sent Events,
// and a frame it cannot take in time is dropped, never queued.

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	liveTick      = 33 * time.Millisecond
	liveSpecCols  = 240             // the spectrum's resolution, whatever width draws it
	liveWantTTL   = 3 * time.Second // a picture no one has asked for this long is dropped
	livePushTTL   = time.Second     // the Push view watches while it draws
	liveHeartbeat = 15              // ticks between frames sent while nothing moves
)

type liveHub struct {
	mu   sync.Mutex
	sess map[*Slot]*liveSession
}

// liveSession returns the session for s (nil for no slot).
func (h *Host) liveSession(s *Slot) *liveSession {
	if s == nil {
		return nil
	}
	h.lives.mu.Lock()
	defer h.lives.mu.Unlock()
	if h.lives.sess == nil {
		h.lives.sess = map[*Slot]*liveSession{}
	}
	ls := h.lives.sess[s]
	if ls == nil {
		ls = &liveSession{slot: s, pics: map[string]*livePic{}, subs: map[chan []byte]bool{}}
		h.lives.sess[s] = ls
	}
	return ls
}

type livePic struct {
	g    picGroup
	vals map[string]ovValue
	at   time.Time
}

// liveOut is one frame of a session. Its maps are new every tick, so a
// reader may keep them.
type liveOut struct {
	Seq    uint64
	Active bool // the sound moves (or a picture follows Live's beat while it plays)
	Synced bool
	Info   map[string]any
	Envs   map[string]*envLive
	LFOs   map[string]*lfoLive
	Spec   []float64         // dB per column of the filter axis, liveSpecCols of them; nil: no filter shown
	Keys   map[string]string // values the module drives itself (live_keys), read this tick
}

type liveSession struct {
	slot *Slot

	mu       sync.Mutex
	fx       liveFX
	pics     map[string]*livePic
	liveKeys map[string]time.Time // "<comp>:<key>" -> last asked
	out      liveOut
	pushAt   time.Time
	subs     map[chan []byte]bool
	running  bool
	quiet    int  // ticks since the last frame sent while nothing moved
	restSent bool // the frame of the sound at rest has been sent
}

// want registers (or refreshes) a picture this watcher shows.
func (ls *liveSession) want(key string, g picGroup, vals map[string]ovValue) {
	ls.mu.Lock()
	ls.pics[key] = &livePic{g: g, vals: vals, at: time.Now()}
	ls.mu.Unlock()
}

// wantKeys: values the module drives that a watcher shows ("synth:live_voices").
func (ls *liveSession) wantKeys(keys []string) {
	if len(keys) == 0 {
		return
	}
	ls.mu.Lock()
	if ls.liveKeys == nil {
		ls.liveKeys = map[string]time.Time{}
	}
	for _, k := range keys {
		ls.liveKeys[k] = time.Now()
	}
	ls.mu.Unlock()
}

// frame: the latest frame.
func (ls *liveSession) frame() liveOut {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.out
}

// watchPush: the Push view draws this sound; keep ticking.
func (ls *liveSession) watchPush() {
	ls.mu.Lock()
	ls.pushAt = time.Now()
	ls.startLocked()
	ls.mu.Unlock()
}

// subscribe: a web page watches; frames arrive as JSON on the channel.
func (ls *liveSession) subscribe() (chan []byte, func()) {
	ch := make(chan []byte, 2)
	ls.mu.Lock()
	ls.subs[ch] = true
	ls.restSent = false
	ls.startLocked()
	ls.mu.Unlock()
	return ch, func() {
		ls.mu.Lock()
		delete(ls.subs, ch)
		ls.mu.Unlock()
	}
}

func (ls *liveSession) startLocked() {
	if ls.running {
		return
	}
	ls.running = true
	go ls.run()
}

func (ls *liveSession) run() {
	t := time.NewTicker(liveTick)
	defer t.Stop()
	for range t.C {
		ls.mu.Lock()
		if len(ls.subs) == 0 && time.Since(ls.pushAt) > livePushTTL {
			ls.running = false
			ls.mu.Unlock()
			return
		}
		ls.tickLocked()
		ls.mu.Unlock()
	}
}

// tick advances the session one frame (tests call it directly).
func (ls *liveSession) tick() {
	ls.mu.Lock()
	ls.tickLocked()
	ls.mu.Unlock()
}

func (ls *liveSession) tickLocked() {
	f := &ls.fx
	f.look(ls.slot)
	now := time.Now()
	out := liveOut{Seq: ls.out.Seq + 1, Envs: map[string]*envLive{}, LFOs: map[string]*lfoLive{}}
	filter := false
	for key, p := range ls.pics {
		if now.Sub(p.at) > liveWantTTL {
			delete(ls.pics, key)
			continue
		}
		switch p.g.kind {
		case "env":
			e := envShapeOf(envGroup{keys: p.g.keys, start: p.g.start, end: p.g.end}, p.vals, "")
			out.Envs[key] = f.envelope(key, p.g, e, p.vals)
		case "lfo":
			out.LFOs[key] = f.lfo(key, p.g, p.vals)
		case "filter":
			filter = true
		}
	}
	if filter {
		f.spec.update(ls.slot, f.frame)
		if cols := f.spec.columns(liveSpecCols); cols != nil {
			out.Spec = append([]float64(nil), cols...)
		}
	}
	if len(ls.liveKeys) > 0 {
		out.Keys = map[string]string{}
		for k, at := range ls.liveKeys {
			if now.Sub(at) > liveWantTTL {
				delete(ls.liveKeys, k)
				continue
			}
			if v, ok := ls.slot.Get(k); ok {
				out.Keys[k] = v
			}
		}
	}
	out.Synced = f.synced
	out.Active = f.active() || (f.playing && f.synced)
	out.Info = fxInfo(f)
	ls.out = out
	if len(ls.subs) == 0 {
		return
	}
	// a page gets every frame while the sound moves, one more as it comes to
	// rest, and then one now and then (a page that joined late is not stale)
	if out.Active {
		ls.restSent = false
	} else {
		ls.quiet++
		if ls.restSent && ls.quiet < liveHeartbeat {
			return
		}
		ls.restSent = true
	}
	ls.quiet = 0
	data := webFrame(out)
	for ch := range ls.subs {
		select {
		case ch <- data:
		default: // the page is behind: this frame is dropped, the next one is current
		}
	}
}

// fxInfo: what a module's screen or a page is told of the sound (v.$live).
func fxInfo(f *liveFX) map[string]any {
	if f.slot == nil {
		return map[string]any{"known": false}
	}
	voices := []any{}
	for _, v := range f.snap.Voices {
		age := (f.snap.Now - v.On).Seconds()
		rel := -1.0
		if v.Off > 0 {
			rel = (f.snap.Now - v.Off).Seconds()
		}
		voices = append(voices, map[string]any{"note": v.Note, "vel": v.Vel, "held": v.Off == 0, "age": age, "released": rel})
	}
	since := func(t time.Duration) float64 {
		if t == 0 {
			return -1
		}
		return (f.snap.Now - t).Seconds()
	}
	level := 0.0
	if f.ref > 0 {
		level = math.Min(1, f.lvl/f.ref)
	}
	return map[string]any{"known": true, "level": level, "db": dbOf(f.lvl), "held": f.snap.Held, "notes": f.snap.Notes,
		"since_on": since(f.snap.LastOn), "since_off": since(f.snap.LastOff), "voices": voices,
		"playing": f.playing, "beat": f.beat, "bpm": f.bpm, "t": f.snap.Now.Seconds()}
}

// webFrame: a frame as the page reads it, compact (it arrives 30 times a second).
func webFrame(o liveOut) []byte {
	r3 := func(x float64) float64 { return math.Round(x*1000) / 1000 }
	envs := map[string]any{}
	for k, e := range o.Envs {
		m := map[string]any{"m": e.Mode, "h": e.Held, "r": e.Ringing}
		if e.Stage != "" {
			m["s"], m["p"] = e.Stage, r3(e.Progress)
		}
		if e.Retrig > 0 {
			m["rt"] = r3(e.Retrig)
		}
		if len(e.Trail) > 0 {
			tr := make([][2]any, len(e.Trail))
			for i, p := range e.Trail {
				tr[i] = [2]any{p.Stage, r3(p.Progress)}
			}
			m["tr"] = tr
		}
		if len(e.Voices) > 0 {
			vs := make([][3]any, len(e.Voices))
			for i, p := range e.Voices {
				vs[i] = [3]any{p.Stage, r3(p.Progress), r3(p.Vel)}
			}
			m["v"] = vs
		}
		envs[k] = m
	}
	lfos := map[string]any{}
	for k, l := range o.LFOs {
		m := map[string]any{"ph": r3(l.Phase)}
		if l.Restart > 0 {
			m["rs"] = r3(l.Restart)
		}
		if l.Synced {
			m["sy"] = true
		}
		if len(l.Trail) > 0 {
			tr := make([]float64, len(l.Trail))
			for i, p := range l.Trail {
				tr[i] = r3(p)
			}
			m["tr"] = tr
		}
		lfos[k] = m
	}
	doc := map[string]any{"seq": o.Seq, "active": o.Active, "info": o.Info, "envs": envs, "lfos": lfos}
	if o.Spec != nil {
		sp := make([]int, len(o.Spec))
		for i, db := range o.Spec {
			sp[i] = int(math.Round(math.Max(-120, db)))
		}
		doc["spec"] = sp
	}
	if o.Keys != nil {
		doc["keys"] = o.Keys
	}
	raw, _ := json.Marshal(doc)
	return raw
}

// serveLive streams a session's frames to a web page: GET .../live?comp=synth
// &pics=<json {key: {kind, keys:{role: key}}}>&keys=<comma-separated keys>.
// The pictures' values are read here every half second, from the slot.
func (h *Host) serveLive(w http.ResponseWriter, r *http.Request, s *Slot) {
	comp := r.URL.Query().Get("comp")
	if comp == "" {
		comp = "synth"
	}
	var spec map[string]struct {
		Kind string            `json:"kind"`
		Keys map[string]string `json:"keys"`
	}
	if p := r.URL.Query().Get("pics"); p != "" {
		if err := json.Unmarshal([]byte(p), &spec); err != nil {
			fail(w, 400, "pics: %v", err)
			return
		}
	}
	var live []string
	for _, k := range strings.Split(r.URL.Query().Get("keys"), ",") {
		if k = strings.TrimSpace(k); k != "" && !strings.ContainsAny(k, ":/") {
			live = append(live, comp+":"+k)
		}
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "streaming not supported")
		return
	}
	ls := h.liveSession(s)
	cm := buildMeta("", func(k string) (string, bool) { return s.Meta(comp, k) })
	pics := map[string]picGroup{}
	need := map[string]bool{}
	for key, p := range spec {
		switch p.Kind {
		case "env", "filter", "lfo", "mix":
		default:
			continue
		}
		g := picGroup{kind: p.Kind, keys: p.Keys}
		if p.Kind == "lfo" { // how it runs: from the page's own keys, as the Push finds them
			g = withLFOExtras(g, cm)
		}
		pics[key] = g
		for _, k := range g.keys {
			need[k] = true
		}
	}
	keys := make([]string, 0, len(need))
	for k := range need {
		keys = append(keys, k)
	}
	refresh := func() {
		vals := ovValuesOf(cm, keys, func(k string) (string, bool) { return s.Get(comp + ":" + k) })
		for key, g := range pics {
			ls.want(key, g, vals)
		}
		ls.wantKeys(live)
	}
	refresh()
	ch, done := ls.subscribe()
	defer done()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)
	flusher.Flush()
	vt := time.NewTicker(500 * time.Millisecond)
	defer vt.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-vt.C:
			refresh()
		case data := <-ch:
			w.Write([]byte("data: ")) //nolint:errcheck
			w.Write(data)             //nolint:errcheck
			w.Write([]byte("\n\n"))   //nolint:errcheck
			flusher.Flush()
		}
	}
}

// withLFOExtras: an LFO group as the page sends it (shape, rate) with the
// keys that say how it runs (sync, trigger, division), found among the
// module's parameters by the same rules the Push uses on its page.
func withLFOExtras(g picGroup, cm *compMeta) picGroup {
	if cm == nil || g.keys["shape"] == "" {
		return g
	}
	all := make([]string, 0, len(cm.Params))
	for k := range cm.Params {
		all = append(all, k)
	}
	for _, lg := range lfoGroupsLoose(all, g.keys["shape"]) {
		for role, k := range lg {
			if _, ok := g.keys[role]; !ok {
				g.keys[role] = k
			}
		}
	}
	return g
}
