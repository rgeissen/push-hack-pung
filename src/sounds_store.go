package main

// sounds_store.go: user sounds, as Schwung's user presets, file for file, and
// Pung's library index beside them (docs/PRESETS.md).
//
// Schwung's format (src/shadow/shadow_ui_presets.mjs), which a Move must
// still read after Pung wrote it, and Pung must read after a Move wrote it:
//
//	<root>/<module-id>/<stem>.json
//	{"name":"Fat Brass","module":"obxd","version":1,"state":{...}}
//
//   - "name" first: Move takes the list's names from the file's text with a
//     regular expression, not by parsing it.
//   - "state" is the module's <prefix>:state: inline when it is JSON, else a
//     JSON string.
//   - a sound is found by its name, never by its file name.
//   - Save As never overwrites: a clashing name gets " 2", " 3" (case
//     blind), and so does a clashing file.
//
// Pung adds a "pung" object after "state" (Move ignores it, and drops it if
// it saves the sound again) and the index file ".pung" in the same folder
// (no ".json": Move does not list it).

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

const presetFormatVersion = 1

// userSound: one of a module's saved sounds.
type userSound struct {
	Name string `json:"name"`
	File string `json:"-"` // its file in the module's folder
}

// pungMeta: what Pung keeps in a sound's own file (Move ignores it).
type pungMeta struct {
	Created string    `json:"created,omitempty"`
	Tags    []string  `json:"tags,omitempty"`
	From    *soundRef `json:"from,omitempty"` // the sound it was saved from
}

type soundStore struct {
	root string // .../presets
	mu   sync.Mutex
}

var errNoSound = errors.New("no such sound")

// notModule: folders in the presets root that are not a module's.
func notModule(id string) bool {
	return id == "" || id == "track_presets" || strings.HasPrefix(id, ".") || strings.ContainsAny(id, `/\`)
}

func (st *soundStore) dir(module string) (string, error) {
	if notModule(module) {
		return "", fmt.Errorf("no sounds for %q", module)
	}
	return filepath.Join(st.root, module), nil
}

var nameInFile = regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`)

// List: the module's sounds, by name (case blind), as Move lists them.
func (st *soundStore) List(module string) ([]userSound, error) {
	dir, err := st.dir(module)
	if err != nil {
		return nil, err
	}
	ents, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []userSound
	for _, e := range ents {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".json") || strings.HasPrefix(n, ".") {
			continue
		}
		name := strings.TrimSuffix(n, ".json")
		if raw, err := os.ReadFile(filepath.Join(dir, n)); err == nil {
			if m := nameInFile.FindSubmatch(raw); m != nil {
				name = string(m[1])
			}
		}
		out = append(out, userSound{Name: name, File: n})
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

func (st *soundStore) find(module, name string) (userSound, string, error) {
	list, err := st.List(module)
	if err != nil {
		return userSound{}, "", err
	}
	dir, _ := st.dir(module)
	for _, s := range list {
		if s.Name == name {
			return s, filepath.Join(dir, s.File), nil
		}
	}
	return userSound{}, "", errNoSound
}

// Read: a sound's state, as the module is given it (<prefix>:state), and
// Pung's notes on it.
func (st *soundStore) Read(module, name string) (string, *pungMeta, error) {
	_, path, err := st.find(module, name)
	if err != nil {
		return "", nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", nil, err
	}
	var doc struct {
		Module string          `json:"module"`
		State  json.RawMessage `json:"state"`
		Pung   *pungMeta       `json:"pung"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", nil, fmt.Errorf("%s: %v", filepath.Base(path), err)
	}
	if doc.Module != "" && doc.Module != module {
		return "", nil, fmt.Errorf("%q is a sound for %s", name, doc.Module)
	}
	return stateFromFile(doc.State), doc.Pung, nil
}

// stateFromFile: a JSON string is its text; anything else is the JSON itself.
func stateFromFile(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return string(raw)
}

// SaveAs writes a new sound and returns the name it got (never overwrites).
func (st *soundStore) SaveAs(module, name, state string, meta *pungMeta) (string, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	dir, err := st.dir(module)
	if err != nil {
		return "", err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Preset"
	}
	list, err := st.List(module)
	if err != nil {
		return "", err
	}
	name = uniqueName(name, list)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := uniquePath(dir, fileStem(name))
	return name, writeSound(path, name, module, state, meta)
}

// Save overwrites the sound called name (it must exist).
func (st *soundStore) Save(module, name, state string, meta *pungMeta) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	_, path, err := st.find(module, name)
	if err != nil {
		return err
	}
	return writeSound(path, name, module, state, meta)
}

func (st *soundStore) Delete(module, name string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	_, path, err := st.find(module, name)
	if err != nil {
		return err
	}
	return os.Remove(path)
}

// Rename gives a sound another name (and file); returns the name it got.
func (st *soundStore) Rename(module, name, to string) (string, error) {
	state, meta, err := st.Read(module, name)
	if err != nil {
		return "", err
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	_, old, err := st.find(module, name)
	if err != nil {
		return "", err
	}
	to = strings.TrimSpace(to)
	if to == "" || to == name {
		return name, nil
	}
	list, _ := st.List(module)
	var others []userSound
	for _, s := range list {
		if s.Name != name {
			others = append(others, s)
		}
	}
	to = uniqueName(to, others)
	dir, _ := st.dir(module)
	path := filepath.Join(dir, fileStem(to)+".json")
	if path != old {
		if _, err := os.Stat(path); err == nil {
			path = uniquePath(dir, fileStem(to)) // another sound's file has that stem
		}
	}
	if err := writeSound(path, to, module, state, meta); err != nil {
		return "", err
	}
	if path != old {
		os.Remove(old)
	}
	return to, nil
}

// fileStem: Schwung's safeFileStem.
func fileStem(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r == '/' || r == '\\' || r < 0x20 {
			continue
		}
		b.WriteRune(r)
	}
	if s := strings.TrimSpace(b.String()); s != "" {
		return s
	}
	return "Preset"
}

// uniqueName: name, else "name 2", "name 3", ... (Schwung compares names
// case blind).
func uniqueName(name string, list []userSound) string {
	taken := map[string]bool{}
	for _, s := range list {
		taken[strings.ToLower(s.Name)] = true
	}
	if !taken[strings.ToLower(name)] {
		return name
	}
	for i := 2; ; i++ {
		n := name + " " + strconv.Itoa(i)
		if !taken[strings.ToLower(n)] {
			return n
		}
	}
}

func uniquePath(dir, stem string) string {
	p := filepath.Join(dir, stem+".json")
	for i := 2; ; i++ {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return p
		}
		p = filepath.Join(dir, stem+" "+strconv.Itoa(i)+".json")
	}
}

// encodeJSON: JSON as JavaScript writes it (no HTML escapes, no newline).
func encodeJSON(v any) []byte {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	e.Encode(v) //nolint:errcheck // strings and plain structs
	return bytes.TrimRight(b.Bytes(), "\n")
}

// soundFile renders a sound in Schwung's key order: name, module, version,
// state, then Pung's notes.
func soundFile(name, module, state string, meta *pungMeta) []byte {
	var b bytes.Buffer
	b.WriteString(`{"name":`)
	b.Write(encodeJSON(name))
	b.WriteString(`,"module":`)
	b.Write(encodeJSON(module))
	b.WriteString(`,"version":` + strconv.Itoa(presetFormatVersion) + `,"state":`)
	var c bytes.Buffer
	if t := strings.TrimSpace(state); t != "" && json.Valid([]byte(t)) && json.Compact(&c, []byte(t)) == nil {
		b.Write(c.Bytes()) // JSON: inline, as JSON.stringify(JSON.parse(state))
	} else {
		b.Write(encodeJSON(state))
	}
	if meta != nil {
		b.WriteString(`,"pung":`)
		b.Write(encodeJSON(meta))
	}
	b.WriteString("}")
	return b.Bytes()
}

func writeSound(path, name, module, state string, meta *pungMeta) error {
	tmp := filepath.Join(filepath.Dir(path), ".tmp-"+strconv.FormatInt(time.Now().UnixNano(), 36))
	if err := os.WriteFile(tmp, soundFile(name, module, state, meta), 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// stateHash: Schwung's hashState (current_preset.mjs), FNV-1a style over the
// state's UTF-16 code units, with the length: "811c9dc5:0" for "". A sound
// whose state no longer hashes to what it was loaded as is edited.
func stateHash(s string) string {
	u := utf16.Encode([]rune(s))
	h := uint32(0x811c9dc5)
	for _, c := range u {
		h ^= uint32(c)
		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
	}
	return strconv.FormatUint(uint64(h), 16) + ":" + strconv.Itoa(len(u))
}

// ---- the library index ----------------------------------------------------

// soundRef names one sound: a factory one by its place (and the name it was
// last heard as), a user one by its name.
type soundRef struct {
	Source string `json:"source"` // factory | user
	Bank   string `json:"bank,omitempty"`
	Index  int    `json:"index"`
	Name   string `json:"name,omitempty"`
}

func (r soundRef) same(o soundRef) bool {
	if r.Source != o.Source {
		return false
	}
	if r.Source == "user" {
		return r.Name == o.Name
	}
	return r.Bank == o.Bank && r.Index == o.Index
}

const maxRecent = 32

// soundIndex: ".pung" in a module's folder.
type soundIndex struct {
	Version    int                          `json:"version"`
	Favourites []soundRef                   `json:"favourites"`
	Recent     []soundRef                   `json:"recent"`
	Tags       map[string][]string          `json:"tags,omitempty"`  // "user:<name>" -> tags
	Names      map[string]map[string]string `json:"names,omitempty"` // "factory/<bank>" -> index -> name
}

func (st *soundStore) indexPath(module string) (string, error) {
	dir, err := st.dir(module)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, ".pung"), nil
}

// Index: the module's index (empty if it has none yet).
func (st *soundStore) Index(module string) *soundIndex {
	ix := &soundIndex{Version: 1}
	if p, err := st.indexPath(module); err == nil {
		if raw, err := os.ReadFile(p); err == nil {
			json.Unmarshal(raw, ix) //nolint:errcheck // a damaged index starts again
		}
	}
	if ix.Tags == nil {
		ix.Tags = map[string][]string{}
	}
	if ix.Names == nil {
		ix.Names = map[string]map[string]string{}
	}
	return ix
}

// Update changes the module's index under the store's lock and saves it.
func (st *soundStore) Update(module string, f func(ix *soundIndex)) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	ix := st.Index(module)
	f(ix)
	p, err := st.indexPath(module)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, encodeJSON(ix), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (ix *soundIndex) isFavourite(r soundRef) bool {
	for _, f := range ix.Favourites {
		if f.same(r) {
			return true
		}
	}
	return false
}

// toggleFavourite stars or unstars r; reports whether it is now a favourite.
func (ix *soundIndex) toggleFavourite(r soundRef) bool {
	for i, f := range ix.Favourites {
		if f.same(r) {
			ix.Favourites = append(ix.Favourites[:i], ix.Favourites[i+1:]...)
			return false
		}
	}
	ix.Favourites = append(ix.Favourites, r)
	return true
}

func (ix *soundIndex) addRecent(r soundRef) {
	out := []soundRef{r}
	for _, x := range ix.Recent {
		if !x.same(r) && len(out) < maxRecent {
			out = append(out, x)
		}
	}
	ix.Recent = out
}

func namesKey(bank string) string { return "factory/" + bank }

// learnName records a factory sound's name as it was heard.
func (ix *soundIndex) learnName(bank string, index int, name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || isSentinelName(name) {
		return false
	}
	k := namesKey(bank)
	if ix.Names[k] == nil {
		ix.Names[k] = map[string]string{}
	}
	i := strconv.Itoa(index)
	if ix.Names[k][i] == name {
		return false
	}
	ix.Names[k][i] = name
	return true
}

func (ix *soundIndex) nameOf(bank string, index int) string {
	return ix.Names[namesKey(bank)][strconv.Itoa(index)]
}

// isSentinelName: what modules answer in place of a name (the survey,
// docs/PRESETS.md): never learned as one.
func isSentinelName(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "loading...", "loading", "---", "edited", "(no files)", "no presets", "-1":
		return true
	}
	return strings.HasSuffix(s, " (no ROM)")
}

// rename the index's references to a renamed user sound.
func (ix *soundIndex) renameUser(from, to string) {
	for i := range ix.Favourites {
		if ix.Favourites[i].Source == "user" && ix.Favourites[i].Name == from {
			ix.Favourites[i].Name = to
		}
	}
	for i := range ix.Recent {
		if ix.Recent[i].Source == "user" && ix.Recent[i].Name == from {
			ix.Recent[i].Name = to
		}
	}
	if t, ok := ix.Tags["user:"+from]; ok {
		delete(ix.Tags, "user:"+from)
		ix.Tags["user:"+to] = t
	}
}

// forgetUser drops a deleted user sound from the index.
func (ix *soundIndex) forgetUser(name string) {
	keep := func(list []soundRef) []soundRef {
		var out []soundRef
		for _, r := range list {
			if !(r.Source == "user" && r.Name == name) {
				out = append(out, r)
			}
		}
		return out
	}
	ix.Favourites, ix.Recent = keep(ix.Favourites), keep(ix.Recent)
	delete(ix.Tags, "user:"+name)
}
