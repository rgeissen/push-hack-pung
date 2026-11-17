package main

// files.go: the files a module asks for (docs/SAMPLES.md).
//
// A Schwung module that plays your own material declares a parameter of type
// "filepath": a sample, a wavetable, a kit. On Move the host opens a file
// browser inside the folder the module names. On a Push that folder does not
// exist, and something better does: Live's own libraries, on the same disk.
// So a file parameter on Push is browsed across PLACES:
//
//	the module's own folder   where it differs from the sample library
//	User Library              Live's User Library/Samples: yours
//	Core Library              the samples Live ships
//	Packs                     the packs installed on the Push
//	Sets                      what your Sets recorded and froze
//	Recordings                Live Recordings
//	Favourites, Recent        across every module
//
// Move's path for the user's samples, /data/UserData/UserLibrary, is linked to
// Live's User Library, so a file there has the same path on a Move and on a
// Push, and a sound saved on one opens on the other.
//
// Only what the module can load is listed (its "filter"), and a folder with
// nothing in it for this parameter is not shown at all. An audio file in
// another format than the module reads is offered too, and converted to WAV
// the moment it is chosen (ffmpeg, into User Library/Samples/Converted).

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

func ownerOf(st os.FileInfo) (uid, gid int, ok bool) {
	if s, ok := st.Sys().(*syscall.Stat_t); ok {
		return int(s.Uid), int(s.Gid), true
	}
	return 0, 0, false
}

// Where things are on a Push. Variables, so a test has its own.
var (
	// moveUserLibrary: Move's path for the user's library; modules name it.
	moveUserLibrary = "/data/UserData/UserLibrary"
	// abletonDir: where AbletonOS keeps Live's libraries.
	abletonDir = "/data/Music/Ableton"
)

// fileSpec: what a module says about a file parameter (docs/MODULES.md,
// "filepath in module.json").
type fileSpec struct {
	Root        string   `json:"root,omitempty"`
	Start       string   `json:"start,omitempty"`
	Filter      []string `json:"filter,omitempty"` // lower case, with the dot; none: any file
	LivePreview bool     `json:"live_preview,omitempty"`
	// Hooks: parameter writes at the browser's moments: on_open, on_preview,
	// on_cancel, on_commit
	Hooks map[string][]fileHook `json:"hooks,omitempty"`
}

type fileHook struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Restore bool   `json:"restore,omitempty"`
}

func fileSpecFrom(o map[string]any) *fileSpec {
	fs := &fileSpec{Root: str(o["root"]), Start: str(o["start_path"])}
	switch f := o["filter"].(type) {
	case string:
		fs.Filter = []string{f}
	case []any:
		for _, x := range f {
			if s, ok := x.(string); ok {
				fs.Filter = append(fs.Filter, s)
			}
		}
	}
	for i, f := range fs.Filter {
		f = strings.ToLower(strings.TrimSpace(f))
		if f != "" && !strings.HasPrefix(f, ".") {
			f = "." + f
		}
		fs.Filter[i] = f
	}
	fs.LivePreview, _ = o["live_preview"].(bool)
	if hooks, ok := o["browser_hooks"].(map[string]any); ok {
		fs.Hooks = map[string][]fileHook{}
		for when, v := range hooks {
			list, _ := v.([]any)
			if one, ok := v.(map[string]any); ok {
				list = []any{one}
			}
			for _, x := range list {
				if a, ok := x.(map[string]any); ok && str(a["key"]) != "" {
					r, _ := a["restore"].(bool)
					val := str(a["value"])
					if n, ok := num(a["value"]); ok && val == "" {
						val = fmt.Sprintf("%g", n)
					}
					fs.Hooks[when] = append(fs.Hooks[when], fileHook{Key: str(a["key"]), Value: val, Restore: r})
				}
			}
		}
	}
	return fs
}

// accepts: the module loads a file of this name as it is.
func (fs *fileSpec) accepts(name string) bool {
	if len(fs.Filter) == 0 {
		return true
	}
	ext := strings.ToLower(filepath.Ext(name))
	for _, f := range fs.Filter {
		if f == ext {
			return true
		}
	}
	return false
}

// audio: the parameter holds a sound (its filter names an audio format, or
// it names none and is called a sample).
func (fs *fileSpec) audio() bool {
	for _, f := range fs.Filter {
		if isAudioExt(f) {
			return true
		}
	}
	return false
}

// convertible: an audio file the module does not read as it is, but would as
// a WAV: offered, and converted when chosen.
func (fs *fileSpec) convertible(name string) bool {
	if fs.accepts(name) || !isAudioExt(filepath.Ext(name)) || ffmpegPath() == "" {
		return false
	}
	for _, f := range fs.Filter {
		if f == ".wav" {
			return true
		}
	}
	return false
}

// kind: what favourites and recents are shared by: every sampler's samples
// are one list, wavetables another.
func (fs *fileSpec) kind() string {
	if fs.audio() {
		for _, f := range fs.Filter {
			if strings.HasPrefix(f, ".wt") {
				return "wavetable"
			}
		}
		return "audio"
	}
	if len(fs.Filter) == 0 {
		return "any"
	}
	return strings.TrimPrefix(fs.Filter[0], ".")
}

// ---- places -------------------------------------------------------------------

// filePlace: somewhere files are, as the browser's upper row names it.
type filePlace struct {
	ID    string   `json:"id"`
	Label string   `json:"label"` // the upper row: short capitals
	Name  string   `json:"name"`  // in a sentence
	Dirs  []string `json:"dirs"`  // one folder, or several shown as one (Packs)
	// Virtual: a list of files, not a folder (Favourites, Recent)
	Virtual bool `json:"virtual,omitempty"`
	// Writable: uploads and new folders may go here
	Writable bool `json:"writable,omitempty"`
}

const (
	placeModule  = "module"
	placeUser    = "user"
	placeCore    = "core"
	placePacks   = "packs"
	placeSets    = "sets"
	placeRecs    = "recordings"
	placeFavs    = "favourites"
	placeRecent  = "recent"
	maxUpperRow  = 8
	convertedDir = "Converted" // under User Library/Samples
)

// userSamplesDir: the user's samples, in Move's words (linked into Live's
// User Library on a Push).
func userSamplesDir() string { return filepath.Join(moveUserLibrary, "Samples") }

// coreLibraryDir: the newest "Live N Core Library" on the Push.
func coreLibraryDir() string {
	hits, _ := filepath.Glob(filepath.Join(abletonDir, "Live * Core Library"))
	best, bestN := "", -1
	for _, h := range hits {
		var n int
		fmt.Sscanf(filepath.Base(h), "Live %d", &n) //nolint:errcheck
		if n > bestN {
			best, bestN = h, n
		}
	}
	return best
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// pathWithin: p is dir or below it.
func pathWithin(p, dir string) bool {
	p, dir = filepath.Clean(p), filepath.Clean(dir)
	return p == dir || strings.HasPrefix(p, strings.TrimSuffix(dir, "/")+"/")
}

// placesFor: the places a file parameter is browsed in, in the upper row's
// order. module: the device's module name, for its own folder's label.
func placesFor(fs *fileSpec, module string) []filePlace {
	var out []filePlace
	user := userSamplesDir()
	audio := fs.audio()
	// the module's own folder: where it is not simply the sample library
	root := filepath.Clean(fs.Root)
	if fs.Root == "" {
		root = ""
	}
	own := root
	if own != "" && (pathWithin(user, own) || (audio && pathWithin(own, user))) {
		own = "" // "/data", or the sample library itself: the places below cover it
	}
	if own == "" && fs.Start != "" && !audio && !pathWithin(fs.Start, user) {
		own = filepath.Clean(fs.Start) // a wide root with a start of its own (a preset folder)
	}
	if own != "" {
		label := strings.ToUpper(module)
		if pathWithin(own, moveUserLibrary) && own != moveUserLibrary {
			label = strings.ToUpper(filepath.Base(own)) // User Library/Wavetables
		}
		out = append(out, filePlace{ID: placeModule, Label: fitPlaceLabel(label), Name: filepath.Base(own), Dirs: []string{own}, Writable: true})
	}
	if audio || own == "" {
		out = append(out, filePlace{ID: placeUser, Label: "USER LIB", Name: "User Library", Dirs: []string{user}, Writable: true})
	}
	if audio {
		if core := coreLibraryDir(); core != "" {
			out = append(out, filePlace{ID: placeCore, Label: "CORE LIB", Name: "Core Library", Dirs: []string{filepath.Join(core, "Samples")}})
		}
		out = append(out,
			filePlace{ID: placePacks, Label: "PACKS", Name: "Packs", Dirs: []string{filepath.Join(abletonDir, "Factory Packs"), filepath.Join(moveUserLibrary, "Packs")}},
			filePlace{ID: placeSets, Label: "SETS", Name: "Sets", Dirs: []string{filepath.Join(abletonDir, "Sets")}},
			filePlace{ID: placeRecs, Label: "RECORDED", Name: "Recordings", Dirs: []string{filepath.Join(abletonDir, "Live Recordings")}},
		)
	}
	out = append(out,
		filePlace{ID: placeFavs, Label: "FAVOURITES", Name: "Favourites", Virtual: true},
		filePlace{ID: placeRecent, Label: "RECENT", Name: "Recent", Virtual: true})
	if len(out) > maxUpperRow {
		out = out[:maxUpperRow]
	}
	return out
}

func fitPlaceLabel(s string) string {
	s = strings.NewReplacer("-", " ", "_", " ").Replace(s)
	if len(s) > 12 {
		s = strings.TrimSpace(s[:12])
	}
	return s
}

// placeOf: the place a path is in (the first that holds it), and the folder
// of that place it is under.
func placeOf(places []filePlace, path string) (int, string) {
	for i, p := range places {
		for _, d := range p.Dirs {
			if pathWithin(path, d) {
				return i, d
			}
		}
	}
	return -1, ""
}

// ---- listing -------------------------------------------------------------------

// fileEntry: a row of a folder.
type fileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Dir     bool   `json:"dir,omitempty"`
	Count   int    `json:"count,omitempty"`   // a folder: the files below it this parameter can use
	Size    int64  `json:"size,omitempty"`    // a file
	Convert bool   `json:"convert,omitempty"` // chosen, it is converted to WAV first
	Missing bool   `json:"missing,omitempty"` // a favourite whose file is gone
}

// fileIndex: how many usable files are below each folder of a tree, counted
// once per place and filter: what lets a folder with nothing in it stay out
// of the list, and lets a folder say "48" beside its name.
type fileIndex struct {
	at     time.Time
	counts map[string]int
}

type fileLib struct {
	dataDir string
	mu      sync.Mutex
	index   map[string]*fileIndex // root + filter -> counts
	store   *fileStore
}

// indexFor: the counts are kept this long; a folder is walked again after an
// upload (forget) or once they are old.
const fileIndexAge = 60 * time.Second

func newFileLib(dataDir string) *fileLib {
	return &fileLib{dataDir: dataDir, index: map[string]*fileIndex{}, store: loadFileStore(dataDir)}
}

func usable(fs *fileSpec, name string) bool { return fs.accepts(name) || fs.convertible(name) }

// skipDir: folders that hold nothing a hand should browse.
func skipDir(name string) bool {
	return strings.HasPrefix(name, ".") || name == "Ableton Project Info" || name == "Ableton Folder Info" || name == "Backup"
}

func (lib *fileLib) counts(root string, fs *fileSpec) map[string]int {
	key := root + "\x00" + strings.Join(fs.Filter, ",")
	lib.mu.Lock()
	ix := lib.index[key]
	lib.mu.Unlock()
	if ix != nil && time.Since(ix.at) < fileIndexAge {
		return ix.counts
	}
	c := map[string]int{}
	var walk func(dir string, depth int) int
	walk = func(dir string, depth int) int {
		if depth > 12 {
			return 0
		}
		ents, err := os.ReadDir(dir)
		if err != nil {
			return 0
		}
		n := 0
		for _, e := range ents {
			name := e.Name()
			p := filepath.Join(dir, name)
			isD := e.IsDir()
			if e.Type()&os.ModeSymlink != 0 {
				isD = isDir(p)
			}
			if isD {
				if !skipDir(name) {
					n += walk(p, depth+1)
				}
			} else if !strings.HasPrefix(name, ".") && usable(fs, name) {
				n++
			}
		}
		c[dir] = n
		return n
	}
	walk(root, 0)
	lib.mu.Lock()
	lib.index[key] = &fileIndex{at: time.Now(), counts: c}
	lib.mu.Unlock()
	return c
}

// forget drops the counts (a file was added).
func (lib *fileLib) forget() {
	lib.mu.Lock()
	lib.index = map[string]*fileIndex{}
	lib.mu.Unlock()
	go tidyUserLibrary()
}

// startDir: where a browser opens when the device has no file yet: the
// folder the module names, if it holds anything for the parameter.
func (lib *fileLib) startDir(places []filePlace, fs *fileSpec) (place int, root, dir string, ok bool) {
	if fs.Start == "" || !isDir(fs.Start) {
		return 0, "", "", false
	}
	i, r := placeOf(places, fs.Start)
	if i < 0 || lib.counts(r, fs)[filepath.Clean(fs.Start)] == 0 {
		return 0, "", "", false
	}
	return i, r, filepath.Clean(fs.Start), true
}

// list: a folder's rows: its folders that hold something for this parameter
// (with how much), then its usable files, each by name as a hand sorts them.
// root: the place's folder dir is under.
func (lib *fileLib) list(root, dir string, fs *fileSpec) []fileEntry {
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	counts := lib.counts(root, fs)
	var dirs, files []fileEntry
	for _, e := range ents {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		p := filepath.Join(dir, name)
		isD := e.IsDir()
		if e.Type()&os.ModeSymlink != 0 {
			isD = isDir(p)
		}
		if isD {
			if n := counts[p]; n > 0 && !skipDir(name) {
				dirs = append(dirs, fileEntry{Name: name, Path: p, Dir: true, Count: n})
			}
			continue
		}
		if !usable(fs, name) {
			continue
		}
		fe := fileEntry{Name: name, Path: p, Convert: !fs.accepts(name)}
		if in, err := e.Info(); err == nil {
			fe.Size = in.Size()
		}
		files = append(files, fe)
	}
	sort.Slice(dirs, func(i, j int) bool { return naturalLess(dirs[i].Name, dirs[j].Name) })
	sort.Slice(files, func(i, j int) bool { return naturalLess(files[i].Name, files[j].Name) })
	return append(dirs, files...)
}

// listPlace: a place's top rows. A place of several folders (Packs) shows
// what is in all of them as one list.
func (lib *fileLib) listPlace(p filePlace, fs *fileSpec) []fileEntry {
	var out []fileEntry
	for _, d := range p.Dirs {
		out = append(out, lib.list(d, d, fs)...)
	}
	if len(p.Dirs) > 1 {
		sort.SliceStable(out, func(i, j int) bool {
			if out[i].Dir != out[j].Dir {
				return out[i].Dir
			}
			return naturalLess(out[i].Name, out[j].Name)
		})
	}
	return out
}

// total: how many files a place holds for this parameter.
func (lib *fileLib) total(p filePlace, fs *fileSpec) int {
	n := 0
	for _, d := range p.Dirs {
		n += lib.counts(d, fs)[d]
	}
	return n
}

// naturalLess: names as a person sorts them: case aside, "Kick 2" before
// "Kick 10".
func naturalLess(a, b string) bool {
	la, lb := strings.ToLower(a), strings.ToLower(b)
	i, j := 0, 0
	for i < len(la) && j < len(lb) {
		ca, cb := la[i], lb[j]
		if isDigit(ca) && isDigit(cb) {
			si, sj := i, j
			for i < len(la) && isDigit(la[i]) {
				i++
			}
			for j < len(lb) && isDigit(lb[j]) {
				j++
			}
			na, nb := strings.TrimLeft(la[si:i], "0"), strings.TrimLeft(lb[sj:j], "0")
			if len(na) != len(nb) {
				return len(na) < len(nb)
			}
			if na != nb {
				return na < nb
			}
			continue
		}
		if ca != cb {
			return ca < cb
		}
		i++
		j++
	}
	if len(la)-i != len(lb)-j {
		return len(la)-i < len(lb)-j
	}
	return a < b
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// displayName: a file's name on a screen: without the extension the filter
// already implies.
func displayName(name string) string {
	ext := filepath.Ext(name)
	if isAudioExt(ext) || strings.HasPrefix(strings.ToLower(ext), ".wt") {
		return strings.TrimSuffix(name, ext)
	}
	return name
}

// ---- favourites and recents ---------------------------------------------------------

// fileStore: the files starred and the files last chosen, per kind of file,
// shared by every module (data/files.json).
type fileStore struct {
	mu         sync.Mutex
	path       string
	Favourites map[string][]string `json:"favourites"`
	Recent     map[string][]string `json:"recent"`
	// PreviewOff: the browser's preview is switched off (Push's Preview)
	PreviewOff bool `json:"preview_off,omitempty"`
	// Converted: a WAV Pung made, and the file it was made from: made once
	Converted map[string]string `json:"converted,omitempty"`
}

const recentFilesMax = 64

func loadFileStore(dataDir string) *fileStore {
	st := &fileStore{path: filepath.Join(dataDir, "files.json"), Favourites: map[string][]string{}, Recent: map[string][]string{}}
	if raw, err := os.ReadFile(st.path); err == nil {
		json.Unmarshal(raw, st) //nolint:errcheck // a damaged file starts again
	}
	if st.Favourites == nil {
		st.Favourites = map[string][]string{}
	}
	if st.Recent == nil {
		st.Recent = map[string][]string{}
	}
	return st
}

func (st *fileStore) save() {
	raw, _ := json.MarshalIndent(st, "", " ")
	tmp := st.path + ".tmp"
	if os.WriteFile(tmp, raw, 0o644) == nil {
		os.Rename(tmp, st.path) //nolint:errcheck
	}
}

func (st *fileStore) isFav(kind, path string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, p := range st.Favourites[kind] {
		if p == path {
			return true
		}
	}
	return false
}

// toggleFav stars or unstars a file; it says which it is now.
func (st *fileStore) toggleFav(kind, path string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	for i, p := range st.Favourites[kind] {
		if p == path {
			st.Favourites[kind] = append(st.Favourites[kind][:i:i], st.Favourites[kind][i+1:]...)
			st.save()
			return false
		}
	}
	st.Favourites[kind] = append(st.Favourites[kind], path)
	st.save()
	return true
}

func (st *fileStore) chose(kind, path string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	list := []string{path}
	for _, p := range st.Recent[kind] {
		if p != path && len(list) < recentFilesMax {
			list = append(list, p)
		}
	}
	st.Recent[kind] = list
	st.save()
}

// virtual: Favourites' or Recent's rows: the files, missing ones marked.
func (lib *fileLib) virtual(id string, fs *fileSpec) []fileEntry {
	st := lib.store
	st.mu.Lock()
	var src []string
	if id == placeFavs {
		src = append(src, st.Favourites[fs.kind()]...)
	} else {
		src = append(src, st.Recent[fs.kind()]...)
	}
	st.mu.Unlock()
	var out []fileEntry
	for _, p := range src {
		if !usable(fs, p) {
			continue
		}
		fe := fileEntry{Name: filepath.Base(p), Path: p, Convert: !fs.accepts(p)}
		if in, err := os.Stat(p); err != nil {
			fe.Missing = true
		} else {
			fe.Size = in.Size()
		}
		out = append(out, fe)
	}
	if id == placeFavs {
		sort.SliceStable(out, func(i, j int) bool { return naturalLess(out[i].Name, out[j].Name) })
	}
	return out
}

// ---- choosing ------------------------------------------------------------------

// resolve: the path to give the module for a chosen file: the file itself,
// or, for one the module cannot read as it is, its WAV in User Library/
// Samples/Converted (made once, kept: a Set that names it finds it again).
func (lib *fileLib) resolve(path string, fs *fileSpec) (string, error) {
	if fs.accepts(path) {
		return path, nil
	}
	if !fs.convertible(path) {
		return "", fmt.Errorf("this module does not load %s files", strings.TrimPrefix(filepath.Ext(path), "."))
	}
	src, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	dir := filepath.Join(userSamplesDir(), convertedDir)
	// a file of the same name from elsewhere gets its own
	out := filepath.Join(dir, base+".wav")
	for i := 2; ; i++ {
		st, err := os.Stat(out)
		if err != nil {
			break
		}
		if !st.ModTime().Before(src.ModTime()) && lib.store.convertedFrom(out) == path {
			return out, nil // made before, from this very file
		}
		out = filepath.Join(dir, fmt.Sprintf("%s %d.wav", base, i))
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tmp := out + ".part"
	// 16 bit: what every module's reader takes; the file's own rate and channels
	cmd := exec.Command(ffmpegPath(), "-v", "error", "-nostdin", "-y", "-i", path, "-vn", "-c:a", "pcm_s16le", "-f", "wav", tmp)
	if msg, err := cmd.CombinedOutput(); err != nil {
		os.Remove(tmp)
		return "", fmt.Errorf("converting %s: %v %s", filepath.Base(path), err, lastLine(msg))
	}
	if err := os.Rename(tmp, out); err != nil {
		return "", err
	}
	lib.store.mu.Lock()
	if lib.store.Converted == nil {
		lib.store.Converted = map[string]string{}
	}
	lib.store.Converted[out] = path
	lib.store.save()
	lib.store.mu.Unlock()
	ownedByLive(dir, out)
	lib.forget()
	return out, nil
}

// convertedFrom: the file a converted WAV was made from.
func (st *fileStore) convertedFrom(wav string) string {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.Converted[wav]
}

// tidyUserLibrary: what modules write into the user's library belongs to
// Live's user, as everything there does. Modules run inside Pung (root) and
// keep folders of their own there (Tablor copies its wavetables into
// User Library/Wavetables on first use).
func tidyUserLibrary() {
	st, err := os.Stat(abletonDir)
	if err != nil {
		return
	}
	uid, gid, ok := ownerOf(st)
	if !ok || uid == 0 {
		return
	}
	root, err := filepath.EvalSymlinks(moveUserLibrary)
	if err != nil || !pathWithin(root, abletonDir) {
		return // not Live's library: nobody's to change
	}
	filepath.WalkDir(root, func(p string, e os.DirEntry, err error) error { //nolint:errcheck
		if err != nil {
			return nil
		}
		if in, err := e.Info(); err == nil {
			if u, _, ok := ownerOf(in); ok && u == 0 {
				os.Lchown(p, uid, gid) //nolint:errcheck
			}
		}
		return nil
	})
}

// ownedByLive: what Pung writes into Live's library belongs to Live's user,
// as everything there does (Pung runs as root; Live as ableton).
func ownedByLive(paths ...string) {
	st, err := os.Stat(abletonDir)
	if err != nil {
		return
	}
	uid, gid, ok := ownerOf(st)
	if !ok {
		return
	}
	for _, p := range paths {
		os.Lchown(p, uid, gid) //nolint:errcheck
	}
}

// ---- the user's library, where modules look -----------------------------------------

// ensureMoveUserLibrary links Move's /data/UserData/UserLibrary to Live's
// User Library, so the samples a module asks for by Move's path are the
// user's samples on this Push. It never replaces a folder that is there,
// only a link whose target is gone.
func ensureMoveUserLibrary() {
	target := filepath.Join(abletonDir, "User Library")
	if !isDir(target) {
		return // no Live library here (not a Push): nothing to link to
	}
	if fi, err := os.Lstat(moveUserLibrary); err == nil {
		if fi.Mode()&os.ModeSymlink == 0 {
			return // a real folder: the user's, left as it is
		}
		if t, _ := os.Readlink(moveUserLibrary); t == target {
			return
		}
		if _, err := os.Stat(moveUserLibrary); err == nil {
			return // a link somewhere that exists: left as it is
		}
		os.Remove(moveUserLibrary)
	}
	if err := os.MkdirAll(filepath.Dir(moveUserLibrary), 0o755); err != nil {
		log.Printf("userdata: %v", err)
		return
	}
	if err := os.Symlink(target, moveUserLibrary); err != nil {
		log.Printf("userdata: %v", err)
		return
	}
	log.Printf("userdata: %s -> %s (the user's samples, where Schwung modules look)", moveUserLibrary, target)
}

// portablePath: a path under Live's User Library in Move's words, so a sound
// that names it opens on a Move too.
func portablePath(p string) string {
	real := filepath.Join(abletonDir, "User Library")
	if pathWithin(p, real) {
		return filepath.Join(moveUserLibrary, strings.TrimPrefix(filepath.Clean(p), real))
	}
	return p
}
