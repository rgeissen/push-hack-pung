package main

// sounds_device.go: a Pung device's sounds (docs/PRESETS.md): which one it
// is, auditioning others with a way back, keeping one, saving, and the HTTP
// API the web page and the Push use.
//
// Every load goes through SetOutside, so Live hears of it (its parameters,
// Push's device view) and the rest of the device is read back once the
// loads stop. A load can take seconds (a ROM swap): loads run one at a time
// off the caller, and the latest request wins.

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// soundLib: the library of every module (one per Pung).
type soundLib struct {
	h      *Host
	store  *soundStore
	quirks map[string]presetQuirk

	namesMu sync.Mutex
	named   map[string]bool // a list whose names were asked of the module (module|list|count)
	// onNames: a list's names arrived (read in the background)
	onNames func(d *device)
}

func newSoundLib(h *Host, presetsDir string, quirkDirs ...string) *soundLib {
	return &soundLib{h: h, store: &soundStore{root: presetsDir}, quirks: loadPresetQuirks(quirkDirs...)}
}

// devSounds: one device's sound, and the browser's audition.
type devSounds struct {
	mu       sync.Mutex
	current  *soundRef // the sound it is, as last kept or saved
	hash     string    // the state's hash when it became that sound ("" unknown)
	browsing bool
	snapshot string    // the state when the browser opened: what Cancel restores
	target   *soundRef // the latest audition asked for
	applied  *soundRef // the one loaded
	busy     bool
	gen      int // a new browse or a cancel: a load in flight for an older one stops
	lastErr  string
}

func (lib *soundLib) meta(d *device) *compMeta {
	m, ok := findModule(lib.h.modulesDir, d.c.module)
	if !ok {
		return nil
	}
	cm, _ := lib.h.probeMeta(m)
	return cm
}

// activeList: the factory list the device shows now (its mode's, for a
// module with modes), or none.
func (lib *soundLib) activeList(d *device, cm *compMeta) (presetList, bool) {
	lists := factoryLists(cm, lib.quirks[d.c.module])
	if len(lists) == 0 {
		return presetList{}, false
	}
	if cm == nil || cm.ModeParam == "" || len(lists) == 1 {
		return lists[0], true
	}
	mode := ""
	if v, ok := d.s.Get(d.c.component() + ":" + cm.ModeParam); ok {
		v = strings.TrimSpace(v)
		mode = v
		for i, m := range cm.Modes { // a mode answered as its index
			if fmt.Sprint(i) == v {
				mode = m
			}
		}
	}
	for _, l := range lists {
		if strings.EqualFold(l.Mode, mode) {
			return l, true
		}
	}
	return lists[0], true
}

func (lib *soundLib) getter(d *device) func(string) (string, bool) {
	prefix := d.c.component()
	return func(k string) (string, bool) { return d.s.Get(prefix + ":" + k) }
}

// factoryView: where a device's factory list is, and what is known of it.
type factoryView struct {
	Mode     string            `json:"mode,omitempty"`
	Count    int               `json:"count"` // -1: not known yet
	Index    int               `json:"index"` // -1: not known
	Name     string            `json:"name,omitempty"`
	Bank     string            `json:"bank,omitempty"`
	Banks    []bankRow         `json:"banks,omitempty"`
	BankAt   int               `json:"bank_index"` // the chooser's row, -1 none
	Names    map[string]string `json:"names,omitempty"`
	AllNamed bool              `json:"all_named,omitempty"` // every name is known up front
}

func (lib *soundLib) factory(d *device) (*factoryView, presetList, bool) {
	cm := lib.meta(d)
	pl, ok := lib.activeList(d, cm)
	if !ok {
		return nil, pl, false
	}
	get := lib.getter(d)
	fv := &factoryView{Mode: pl.Mode, Count: -1, Index: -1, BankAt: -1}
	if n, ok := pl.count(get); ok {
		fv.Count = n
	}
	if v, ok := get(pl.List); ok {
		if i, ok := pl.currentIndex(v); ok {
			fv.Index = i
		}
	}
	if pl.Name != "" {
		if v, ok := get(pl.Name); ok && !isSentinelName(v) {
			fv.Name = strings.TrimSpace(v)
		}
	}
	if pl.BankItems != "" {
		if raw, ok := get(pl.BankItems); ok {
			fv.Banks = parseBankRows(raw)
		}
		if v, ok := get(pl.BankSelect); ok && !pl.Jump {
			if i, ok := (presetList{}).currentIndex(v); ok {
				fv.BankAt = i
				for _, r := range fv.Banks {
					if r.Index == i {
						fv.Bank = r.Name
					}
				}
			}
		}
	}
	bn := pl.BankName
	if bn == "" {
		bn = "bank_name" // Schwung's "unified" bank keys (sf2, dexed, obxd, minijv, ...)
	}
	if v, ok := get(bn); ok && fv.Bank == "" && !isSentinelName(v) {
		fv.Bank = strings.TrimSpace(v)
	}
	// names: what the module can say, else what Pung has heard
	if len(pl.Options) > 0 {
		fv.AllNamed = true
		fv.Names = map[string]string{}
		for i, o := range pl.Options {
			fv.Names[fmt.Sprint(i)] = o
		}
	} else {
		key := lib.listBank(pl, fv)
		ix := lib.store.Index(d.c.module)
		if fv.Count > 0 && len(ix.Names[namesKey(key)]) < fv.Count && lib.fillNames(d, pl, fv, key) {
			ix = lib.store.Index(d.c.module)
		}
		fv.Names = ix.Names[namesKey(key)]
		fv.AllNamed = fv.Count > 0 && len(fv.Names) >= fv.Count
		if fv.Index >= 0 && fv.Name != "" {
			lib.learn(d.c.module, key, fv.Index, fv.Name)
		}
	}
	return fv, pl, true
}

// fillNames asks the module for a list's names without playing a sound,
// once per list (and length): a bulk read now (true: they are in the
// index), else one read per sound in the background (onNames when done). A
// module's answer is used only where it names the current sound as the
// module itself does: a key it does not mean as a name is never trusted.
func (lib *soundLib) fillNames(d *device, pl presetList, fv *factoryView, key string) bool {
	tag := fmt.Sprintf("%s|%s|%d", d.c.module, key, fv.Count)
	lib.namesMu.Lock()
	if lib.named == nil {
		lib.named = map[string]bool{}
	}
	done := lib.named[tag]
	lib.namesMu.Unlock()
	if done {
		return false
	}
	// marked once the names are in, or on their way: a module still loading
	// answers nothing, and is asked again next time
	mark := func() {
		lib.namesMu.Lock()
		lib.named[tag] = true
		lib.namesMu.Unlock()
	}
	get := lib.getter(d)
	agrees := func(name string) bool {
		return fv.Index < 0 || fv.Name == "" || strings.TrimSpace(name) == fv.Name
	}
	if pl.Bulk != "" {
		if raw, ok := get(pl.Bulk); ok {
			var names []string
			if json.Unmarshal([]byte(raw), &names) == nil && len(names) == fv.Count &&
				(fv.Index < 0 || fv.Index >= len(names) || agrees(names[fv.Index])) {
				lib.storeNames(d.c.module, key, 0, names)
				mark()
				return true
			}
		}
	}
	if pl.NameAt == "" || fv.Index < 0 || fv.Name == "" {
		return false
	}
	if n, ok := pl.nameAt(fv.Index, get); !ok || !agrees(n) {
		return false
	}
	mark()
	go func() {
		const chunk = 256
		for first := 0; first < fv.Count; first += chunk {
			var names []string
			for i := first; i < min(first+chunk, fv.Count); i++ {
				n, _ := pl.nameAt(i, get)
				names = append(names, n)
			}
			lib.storeNames(d.c.module, key, first, names)
		}
		if lib.onNames != nil {
			lib.onNames(d)
		}
	}()
	return false
}

func (lib *soundLib) storeNames(module, key string, first int, names []string) {
	lib.store.Update(module, func(ix *soundIndex) { //nolint:errcheck
		for i, n := range names {
			ix.learnName(key, first+i, n)
		}
	})
}

// listBank: the bank a list's names are kept under. A bank chooser's bank
// changes the list; a bank that is only a name for part of one list (Mini-JV:
// one list of 4,133 across Preset A, B, ...) does not, and is not part of it.
func (lib *soundLib) listBank(pl presetList, fv *factoryView) string {
	key := pl.Mode
	if pl.BankItems != "" && !pl.Jump {
		key += "|" + fv.Bank
	}
	return key
}

func (lib *soundLib) learn(module, bank string, index int, name string) {
	ix := lib.store.Index(module)
	if ix.nameOf(bank, index) == strings.TrimSpace(name) || isSentinelName(name) {
		return
	}
	lib.store.Update(module, func(ix *soundIndex) { ix.learnName(bank, index, name) }) //nolint:errcheck
}

// state reads the device's state, refusing a read that did not answer.
func (lib *soundLib) state(d *device) (string, error) {
	v, ok := d.s.Get(d.c.component() + ":state")
	if !ok {
		return "", errors.New("the module did not give its state")
	}
	return v, nil
}

// Open starts browsing: what the device is now is what Cancel restores.
func (lib *soundLib) Open(d *device) error {
	st, err := lib.state(d)
	if err != nil {
		return err
	}
	d.snd.mu.Lock()
	defer d.snd.mu.Unlock()
	d.snd.browsing, d.snd.snapshot, d.snd.target, d.snd.applied = true, st, nil, nil
	d.snd.gen++
	return nil
}

// Try auditions a sound: it is loaded once the loads before it are done,
// and only the latest asked for is.
func (lib *soundLib) Try(d *device, r soundRef) {
	d.snd.mu.Lock()
	defer d.snd.mu.Unlock()
	rr := r
	d.snd.target = &rr
	if !d.snd.busy {
		d.snd.busy = true
		go lib.loadLoop(d, d.snd.gen)
	}
}

func (lib *soundLib) loadLoop(d *device, gen int) {
	for {
		d.snd.mu.Lock()
		t := d.snd.target
		if d.snd.gen != gen || t == nil || (d.snd.applied != nil && t.same(*d.snd.applied) && t.Bank == d.snd.applied.Bank) {
			d.snd.busy = false
			d.snd.mu.Unlock()
			return
		}
		d.snd.mu.Unlock()
		err := lib.load(d, *t)
		d.snd.mu.Lock()
		if d.snd.gen == gen {
			d.snd.applied = t
			d.snd.lastErr = ""
			if err != nil {
				d.snd.lastErr = err.Error()
			}
		}
		d.snd.mu.Unlock()
	}
}

// load puts a sound into the device (blocking: the module may take its time).
func (lib *soundLib) load(d *device, r soundRef) error {
	prefix := d.c.component()
	switch r.Source {
	case "user":
		st, _, err := lib.store.Read(d.c.module, r.Name)
		if err != nil {
			return err
		}
		d.SetOutside(prefix+":state", st)
		return nil
	case "factory":
		cm := lib.meta(d)
		pl, ok := lib.activeList(d, cm)
		if !ok {
			return errors.New("this module has no factory sounds")
		}
		if pl.BankItems != "" && !pl.Jump && r.Bank != "" {
			fv, _, _ := lib.factory(d)
			if fv != nil && fv.Bank != r.Bank {
				for _, row := range fv.Banks {
					if row.Name == r.Bank {
						d.SetOutside(prefix+":"+pl.BankSelect, fmt.Sprint(row.Index))
					}
				}
			}
		}
		d.SetOutside(prefix+":"+pl.List, pl.value(r.Index))
		if pl.Name != "" {
			if v, ok := d.s.Get(prefix + ":" + pl.Name); ok && !isSentinelName(v) {
				fv := &factoryView{Bank: r.Bank}
				lib.learn(d.c.module, lib.listBank(pl, fv), r.Index, v)
			}
		}
		return nil
	}
	return fmt.Errorf("no source %q", r.Source)
}

// Keep ends browsing on the sound auditioned (or loads r and keeps it).
func (lib *soundLib) Keep(d *device, r *soundRef) error {
	if r != nil {
		lib.Try(d, *r)
	}
	// the last audition must be in before its state is the sound's
	for i := 0; i < 200; i++ {
		d.snd.mu.Lock()
		busy := d.snd.busy
		d.snd.mu.Unlock()
		if !busy {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	d.snd.mu.Lock()
	kept := d.snd.applied
	if kept == nil {
		kept = d.snd.target
	}
	d.snd.browsing, d.snd.snapshot = false, ""
	d.snd.gen++
	d.snd.mu.Unlock()
	if kept == nil {
		return nil
	}
	k := *kept
	if k.Source == "factory" {
		if fv, _, ok := lib.factory(d); ok && fv.Name != "" {
			k.Name = fv.Name
		}
	}
	lib.becomes(d, k)
	lib.store.Update(d.c.module, func(ix *soundIndex) { ix.addRecent(k) }) //nolint:errcheck
	return nil
}

// becomes: the device is this sound now (its hash, for "edited").
func (lib *soundLib) becomes(d *device, r soundRef) {
	h := ""
	if st, err := lib.state(d); err == nil {
		h = stateHash(st)
	}
	d.snd.mu.Lock()
	d.snd.current, d.snd.hash = &r, h
	d.snd.mu.Unlock()
}

// Cancel ends browsing and puts back the sound from before it.
func (lib *soundLib) Cancel(d *device) {
	d.snd.mu.Lock()
	snap, was := d.snd.snapshot, d.snd.browsing
	d.snd.browsing, d.snd.snapshot, d.snd.target, d.snd.applied = false, "", nil, nil
	d.snd.gen++
	d.snd.mu.Unlock()
	if was && snap != "" {
		d.SetOutside(d.c.component()+":state", snap)
	}
}

// SaveAs keeps the device's sound as a new user sound.
func (lib *soundLib) SaveAs(d *device, name string) (string, error) {
	st, err := lib.state(d)
	if err != nil {
		return "", err
	}
	d.snd.mu.Lock()
	from := d.snd.current
	d.snd.mu.Unlock()
	if strings.TrimSpace(name) == "" {
		name = lib.suggestName(d, from)
	}
	meta := &pungMeta{Created: time.Now().UTC().Format(time.RFC3339)}
	if from != nil {
		f := *from
		meta.From = &f
	}
	got, err := lib.store.SaveAs(d.c.module, name, st, meta)
	if err != nil {
		return "", err
	}
	r := soundRef{Source: "user", Name: got}
	lib.becomes(d, r)
	lib.store.Update(d.c.module, func(ix *soundIndex) { ix.addRecent(r) }) //nolint:errcheck
	return got, nil
}

// suggestName: what Save As proposes: the sound it came from, else the
// module and the date. (The store adds " 2" where that is taken.)
func (lib *soundLib) suggestName(d *device, from *soundRef) string {
	if from != nil && from.Name != "" {
		return from.Name
	}
	return d.c.Name + " " + time.Now().Format("2006-01-02")
}

// Save overwrites the user sound the device is (only a user sound).
func (lib *soundLib) Save(d *device) error {
	d.snd.mu.Lock()
	cur := d.snd.current
	d.snd.mu.Unlock()
	if cur == nil || cur.Source != "user" {
		return errors.New("only a user sound can be saved over; use Save As")
	}
	st, err := lib.state(d)
	if err != nil {
		return err
	}
	_, meta, _ := lib.store.Read(d.c.module, cur.Name)
	if err := lib.store.Save(d.c.module, cur.Name, st, meta); err != nil {
		return err
	}
	lib.becomes(d, *cur)
	return nil
}

// Edited: the device's state is no longer the sound it became.
func (lib *soundLib) Edited(d *device) bool {
	d.snd.mu.Lock()
	h, cur := d.snd.hash, d.snd.current
	d.snd.mu.Unlock()
	if cur == nil || h == "" {
		return false
	}
	st, err := lib.state(d)
	return err == nil && stateHash(st) != h
}

// Rename gives a user sound another name; the index and the device follow.
func (lib *soundLib) Rename(d *device, name, to string) (string, error) {
	got, err := lib.store.Rename(d.c.module, name, to)
	if err != nil {
		return "", err
	}
	lib.store.Update(d.c.module, func(ix *soundIndex) { ix.renameUser(name, got) }) //nolint:errcheck
	d.snd.mu.Lock()
	if c := d.snd.current; c != nil && c.Source == "user" && c.Name == name {
		c.Name = got
	}
	d.snd.mu.Unlock()
	return got, nil
}

// Delete removes a user sound; as on Move, it is no longer the device's.
func (lib *soundLib) Delete(d *device, name string) error {
	if err := lib.store.Delete(d.c.module, name); err != nil {
		return err
	}
	lib.store.Update(d.c.module, func(ix *soundIndex) { ix.forgetUser(name) }) //nolint:errcheck
	d.snd.mu.Lock()
	if c := d.snd.current; c != nil && c.Source == "user" && c.Name == name {
		d.snd.current, d.snd.hash = nil, ""
	}
	d.snd.mu.Unlock()
	return nil
}

// Settled: a sound chosen outside the browser (the jog wheel's quick step)
// is the device's sound now, once its loads stopped.
func (lib *soundLib) Settled(d *device, r soundRef) {
	lib.becomes(d, r)
	lib.store.Update(d.c.module, func(ix *soundIndex) { ix.addRecent(r) }) //nolint:errcheck
}

// Compare loads the sound from before the browser (a) or the auditioned one
// again (b).
func (lib *soundLib) Compare(d *device, before bool) {
	d.snd.mu.Lock()
	snap, target := d.snd.snapshot, d.snd.target
	if !before {
		d.snd.applied = nil // the audition is loaded again, though it was the last one
	}
	d.snd.mu.Unlock()
	if before {
		if snap != "" {
			d.SetOutside(d.c.component()+":state", snap)
		}
		return
	}
	if target != nil {
		lib.Try(d, *target)
	}
}

// SetBank picks a factory list's bank (a row of its bank chooser).
func (lib *soundLib) SetBank(d *device, index int) error {
	pl, ok := lib.activeList(d, lib.meta(d))
	if !ok || pl.BankSelect == "" {
		return errors.New("this module's sounds have no banks")
	}
	d.SetOutside(d.c.component()+":"+pl.BankSelect, fmt.Sprint(index))
	return nil
}

// Export: a module's user sounds as a zip of Schwung's preset files, the
// folder Move keeps (and so importable on a Move as it is).
func (lib *soundLib) Export(module string) ([]byte, int, error) {
	list, err := lib.store.List(module)
	if err != nil {
		return nil, 0, err
	}
	dir, _ := lib.store.dir(module)
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for _, s := range list {
		raw, err := os.ReadFile(filepath.Join(dir, s.File))
		if err != nil {
			continue
		}
		w, err := z.Create(module + "/" + s.File)
		if err != nil {
			return nil, 0, err
		}
		w.Write(raw) //nolint:errcheck // a bytes.Buffer
	}
	if err := z.Close(); err != nil {
		return nil, 0, err
	}
	return b.Bytes(), len(list), nil
}

// Import adds sounds from Schwung preset files: one .json, or a zip of them
// (an export, or a Move's presets folder). A sound for another module is
// left out, and a name already taken gets a number: nothing is overwritten.
func (lib *soundLib) Import(module string, data []byte) (added []string, skipped []string, err error) {
	one := func(name string, raw []byte) {
		var doc struct {
			Name   string          `json:"name"`
			Module string          `json:"module"`
			State  json.RawMessage `json:"state"`
			Pung   *pungMeta       `json:"pung"`
		}
		if json.Unmarshal(raw, &doc) != nil || doc.State == nil {
			skipped = append(skipped, name+": not a preset file")
			return
		}
		if doc.Module != "" && doc.Module != module {
			skipped = append(skipped, name+": a sound for "+doc.Module)
			return
		}
		n := doc.Name
		if n == "" {
			n = strings.TrimSuffix(filepath.Base(name), ".json")
		}
		got, err := lib.store.SaveAs(module, n, stateFromFile(doc.State), doc.Pung)
		if err != nil {
			skipped = append(skipped, name+": "+err.Error())
			return
		}
		added = append(added, got)
	}
	if zr, zerr := zip.NewReader(bytes.NewReader(data), int64(len(data))); zerr == nil {
		for _, f := range zr.File {
			base := filepath.Base(f.Name)
			if f.FileInfo().IsDir() || !strings.HasSuffix(base, ".json") || strings.HasPrefix(base, ".") || f.UncompressedSize64 > 16<<20 {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				continue
			}
			raw, _ := io.ReadAll(io.LimitReader(rc, 16<<20))
			rc.Close()
			one(f.Name, raw)
		}
		return added, skipped, nil
	}
	if !json.Valid(data) {
		return nil, nil, errors.New("not a preset file or a zip of them")
	}
	one("preset.json", data)
	return added, skipped, nil
}

// ---- the web API ------------------------------------------------------------

type soundsView struct {
	Module     string       `json:"module"`
	Current    *soundRef    `json:"current"`
	Edited     bool         `json:"edited"`
	Browsing   bool         `json:"browsing"`
	Applied    *soundRef    `json:"applied,omitempty"` // the sound auditioned, while browsing
	Loading    bool         `json:"loading"`
	Error      string       `json:"error,omitempty"`
	HasState   bool         `json:"has_state"` // user sounds are possible
	Factory    *factoryView `json:"factory,omitempty"`
	User       []userRow    `json:"user"`
	Favourites []soundRef   `json:"favourites"`
	Recent     []soundRef   `json:"recent"`
}

type userRow struct {
	Name string   `json:"name"`
	Fav  bool     `json:"fav,omitempty"`
	Tags []string `json:"tags,omitempty"`
}

func (lib *soundLib) View(d *device) soundsView {
	v := soundsView{Module: d.c.module, User: []userRow{}}
	v.Factory, _, _ = lib.factory(d)
	_, err := lib.state(d)
	v.HasState = err == nil
	ix := lib.store.Index(d.c.module)
	if list, err := lib.store.List(d.c.module); err == nil {
		for _, s := range list {
			v.User = append(v.User, userRow{Name: s.Name, Fav: ix.isFavourite(soundRef{Source: "user", Name: s.Name}),
				Tags: ix.Tags["user:"+s.Name]})
		}
	}
	v.Favourites, v.Recent = ix.Favourites, ix.Recent
	if v.Favourites == nil {
		v.Favourites = []soundRef{}
	}
	if v.Recent == nil {
		v.Recent = []soundRef{}
	}
	v.Edited = lib.Edited(d)
	d.snd.mu.Lock()
	v.Current, v.Browsing, v.Loading, v.Error = d.snd.current, d.snd.browsing, d.snd.busy, d.snd.lastErr
	if d.snd.browsing {
		v.Applied = d.snd.applied
	}
	d.snd.mu.Unlock()
	return v
}

func (lib *soundLib) routes(mux *http.ServeMux) {
	h := lib.h
	body := func(r *http.Request, v any) error {
		return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
	}
	dev := func(w http.ResponseWriter, r *http.Request) (*device, bool) { return h.deviceFromPath(w, r) }
	done := func(w http.ResponseWriter, d *device, err error) {
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "sounds": lib.View(d)})
	}
	mux.HandleFunc("GET /api/devices/{n}/sounds", func(w http.ResponseWriter, r *http.Request) {
		if d, ok := dev(w, r); ok {
			done(w, d, nil)
		}
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/browse", func(w http.ResponseWriter, r *http.Request) {
		if d, ok := dev(w, r); ok {
			done(w, d, lib.Open(d))
		}
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/try", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var ref soundRef
		if body(r, &ref) != nil || (ref.Source != "factory" && ref.Source != "user") {
			fail(w, 400, `body must be a sound: {"source":"factory","index":5} or {"source":"user","name":"..."}`)
			return
		}
		d.snd.mu.Lock()
		browsing := d.snd.browsing
		d.snd.mu.Unlock()
		if !browsing {
			if err := lib.Open(d); err != nil {
				done(w, d, err)
				return
			}
		}
		lib.Try(d, ref)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/keep", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var ref *soundRef
		var b soundRef
		if body(r, &b) == nil && b.Source != "" {
			ref = &b
		}
		done(w, d, lib.Keep(d, ref))
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/cancel", func(w http.ResponseWriter, r *http.Request) {
		if d, ok := dev(w, r); ok {
			lib.Cancel(d)
			done(w, d, nil)
		}
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/save", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var b struct {
			Name string `json:"name"`
			As   bool   `json:"as"`
		}
		body(r, &b) //nolint:errcheck // an empty body: Save, or Save As with the suggested name
		if b.As || b.Name != "" {
			_, err := lib.SaveAs(d, b.Name)
			done(w, d, err)
			return
		}
		done(w, d, lib.Save(d))
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/fav", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var ref soundRef
		if body(r, &ref) != nil || ref.Source == "" {
			fail(w, 400, "body must be a sound")
			return
		}
		done(w, d, lib.store.Update(d.c.module, func(ix *soundIndex) { ix.toggleFavourite(ref) }))
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/rename", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var b struct{ Name, To string }
		if body(r, &b) != nil || b.Name == "" || strings.TrimSpace(b.To) == "" {
			fail(w, 400, `body must be {"name":...,"to":...}`)
			return
		}
		_, err := lib.Rename(d, b.Name, b.To)
		done(w, d, err)
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/bank", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var b struct {
			Index int `json:"index"`
		}
		if body(r, &b) != nil {
			fail(w, 400, `body must be {"index":...}`)
			return
		}
		done(w, d, lib.SetBank(d, b.Index))
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/compare", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var b struct {
			Before bool `json:"before"`
		}
		body(r, &b) //nolint:errcheck
		lib.Compare(d, b.Before)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	// a module's user sounds as a zip, and sounds added from one (or a .json)
	mux.HandleFunc("GET /api/sounds/{module}/export", func(w http.ResponseWriter, r *http.Request) {
		m := r.PathValue("module")
		data, n, err := lib.Export(m)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		if n == 0 {
			fail(w, 404, "no sounds of yours for %s yet", m)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-sounds.zip"`, m))
		w.Write(data) //nolint:errcheck
	})
	mux.HandleFunc("POST /api/sounds/{module}/import", func(w http.ResponseWriter, r *http.Request) {
		m := r.PathValue("module")
		data, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		added, skipped, err := lib.Import(m, data)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		if added == nil {
			added = []string{}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "added": added, "skipped": skipped})
	})
	mux.HandleFunc("POST /api/devices/{n}/sounds/delete", func(w http.ResponseWriter, r *http.Request) {
		d, ok := dev(w, r)
		if !ok {
			return
		}
		var b struct{ Name string }
		if body(r, &b) != nil || b.Name == "" {
			fail(w, 400, `body must be {"name":...}`)
			return
		}
		err := lib.Delete(d, b.Name)
		done(w, d, err)
	})
}

// presetsDir: Schwung's presets folder, which is Pung's own on the Push
// (userdata.go links /data/UserData/schwung to it).
func presetsDir(pungDir string) string { return filepath.Join(pungDir, "presets") }
