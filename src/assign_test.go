package main

import (
	"fmt"
	"strings"
	"testing"
)

// The module's modulation map: what a route may reach, a route's depth, a
// change the screen makes before the module answers.
func TestModMap(t *testing.T) {
	m := parseModMap(`{"sources":[{"id":"lfo_1","name":"LFO 1"},{"id":"env_2","name":"Env 2"}],
	  "dests":["cut","res"],"routes":[{"src":"lfo_1","dst":"cut","amount":0.5}]}`)
	if m == nil || !m.can("cut") || m.can("type") || m.amount("lfo_1", "cut") != 0.5 || m.amount("env_2", "cut") != 0 {
		t.Fatalf("got %+v", m)
	}
	m.set("env_2", "cut", -0.25)
	m.set("lfo_1", "cut", 0)
	if m.amount("env_2", "cut") != -0.25 || m.amount("lfo_1", "cut") != 0 || len(m.Routes) != 1 {
		t.Fatalf("after set: %+v", m.Routes)
	}
	if m.sourceName("env_2") != "Env 2" || m.sourceName("x") != "x" {
		t.Fatal("names")
	}
	// no dests: every knob
	if a := parseModMap(`{"sources":[{"id":"a","name":"A"}]}`); a == nil || !a.can("anything") {
		t.Fatal("a map without dests reaches every knob")
	}
	// no sources: no map (the nudge keeps its old meaning)
	if parseModMap(`{"sources":[]}`) != nil || parseModMap(`nonsense`) != nil {
		t.Fatal("an empty or broken map is none")
	}
}

// More than eight sources: seven to a page, the eighth button turns it, and
// the pages come round.
func TestAssignSourcePages(t *testing.T) {
	var src []string
	for i := 1; i <= 16; i++ {
		src = append(src, fmt.Sprintf(`{"id":"s%d","name":"S%d"}`, i, i))
	}
	u := &surface{}
	u.asg.m = parseModMap(`{"sources":[` + strings.Join(src, ",") + `]}`)
	ids, more := u.assignSlots()
	if !more || len(ids) != 7 || ids[0] != "s1" {
		t.Fatalf("page 1: %v %v", ids, more)
	}
	u.assignBottom(7)
	if ids, _ = u.assignSlots(); ids[0] != "s8" {
		t.Fatalf("page 2: %v", ids)
	}
	u.assignBottom(2)
	if u.asg.src != "s10" {
		t.Fatalf("chosen: %s", u.asg.src)
	}
	u.assignBottom(7)
	u.assignBottom(7) // past the last page: the first again
	if ids, _ = u.assignSlots(); ids[0] != "s1" {
		t.Fatalf("round: %v", ids)
	}
	// eight or fewer: no page turn, all eight buttons sources
	u.asg = assignState{m: parseModMap(`{"sources":[` + strings.Join(src[:8], ",") + `]}`)}
	if ids, more = u.assignSlots(); more || len(ids) != 8 {
		t.Fatalf("eight: %v %v", ids, more)
	}
}

// A route found by its source and destination, with its polarity (the flip
// itself, assignFlip, is checked on the Push: it needs a segment shown).
func TestModRoute(t *testing.T) {
	yes, no := true, false
	u := &surface{touched: -1}
	u.asg.m = parseModMap(`{"sources":[{"id":"lfo_1","name":"LFO 1"}]}`)
	u.asg.m.Routes = []modRoute{{Src: "lfo_1", Dst: "a", Amount: 0.2, Bipolar: &yes}, {Src: "lfo_1", Dst: "b", Amount: 0.3, Bipolar: &yes},
		{Src: "lfo_1", Dst: "z", Amount: 0.3, Bipolar: &no}}
	if r := u.asg.m.route("lfo_1", "b"); r == nil || !*r.Bipolar {
		t.Fatal("route b")
	}
	if r := u.asg.m.route("lfo_1", "z"); r == nil || *r.Bipolar || u.asg.m.route("env_2", "a") != nil {
		t.Fatal("route z, or a route that is not there")
	}
}

// MORE: what a route may reach, by the module's pages, eight to a page, a
// control once, switches and what the map cannot reach left out. ROUTES:
// the chosen source's routes, or every source's.
func TestAssignMoreAndRoutes(t *testing.T) {
	cm := &compMeta{Params: map[string]*paramMeta{}}
	var many []string
	for i := 0; i < 10; i++ {
		k := fmt.Sprintf("lfo_%d", i)
		many = append(many, k)
		cm.Params[k] = &paramMeta{Key: k, Name: k, Type: "float", Max: 1}
	}
	for _, k := range []string{"cut", "res"} {
		cm.Params[k] = &paramMeta{Key: k, Name: k, Type: "float", Max: 1}
	}
	cm.Params["mode"] = &paramMeta{Key: "mode", Type: "enum", Options: []string{"a", "b"}}
	cm.Banks = []bank{{Name: "Filter", Keys: []string{"cut", "res", "mode", "fixed"}}, {Name: "LFOs", Keys: many}, {Name: "Again", Keys: []string{"cut"}}}
	cm.Params["fixed"] = &paramMeta{Key: "fixed", Type: "float", Max: 1}
	m := parseModMap(`{"sources":[{"id":"lfo_1","name":"LFO 1"},{"id":"env_2","name":"Env 2"}],
	  "dests":["cut","res","lfo_0","lfo_1","lfo_2","lfo_3","lfo_4","lfo_5","lfo_6","lfo_7","lfo_8","lfo_9"],
	  "routes":[{"src":"lfo_1","dst":"cut","amount":0.2},{"src":"env_2","dst":"res","amount":0.3}]}`)
	u := &surface{touched: -1}
	pages := u.morePages(cm, m)
	if len(pages) != 3 || pages[0].name != "Filter" || strings.Join(pages[0].keys, ",") != "cut,res" ||
		pages[1].name != "LFOs" || len(pages[1].keys) != 8 || pages[2].name != "LFOs 2" || len(pages[2].keys) != 2 {
		t.Fatalf("pages: %+v", pages)
	}
	u.asg.src = "lfo_1"
	if rs := u.routesOf(m); len(rs) != 1 || rs[0].Dst != "cut" {
		t.Fatalf("lfo_1's routes: %+v", rs)
	}
	u.asg.all = true
	if rs := u.routesOf(m); len(rs) != 2 {
		t.Fatalf("every route: %+v", rs)
	}
}

// A source with a list of its own reaches only those controls (the Nord's
// fixed routes); one without reaches the map's.
func TestModMapSourceDests(t *testing.T) {
	m := parseModMap(`{"sources":[{"id":"lfo2","name":"LFO 2","dests":["cutoff"]},{"id":"lfo1","name":"LFO 1"}],"dests":["cutoff","pw"]}`)
	if !m.canFrom("lfo2", "cutoff") || m.canFrom("lfo2", "pw") || !m.canFrom("lfo1", "pw") || m.canFrom("lfo1", "res") {
		t.Fatal("per-source destinations")
	}
}
