package main

// files_web.go: the file browser's doors for the web page (docs/SAMPLES.md,
// "On the web page"). The page shows the same places, lists and outlines the
// Push does, auditions through the same device, and adds what a Push has no
// hands for: search, and bringing files onto the Push (upload into the
// User Library or the module's own folder).
//
// Only files under Live's libraries and the folders modules name are ever
// read or written here; Pung's own folder (ROMs, modules) is not among them.

import (
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

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

// webBrowse: the page's browse of one device's file parameter. A page that
// goes away without Cancel is cancelled for it after a while.
type webBrowse struct {
	br    *fileBrowse
	timer *time.Timer
}

var (
	webBrowseMu sync.Mutex
	webBrowses  = map[string]*webBrowse{}
)

const webBrowseIdle = 5 * time.Minute

// fileRoots: where the browser may read: Live's libraries, and Move's user
// folder (modules keep folders of their own beside the library there).
func fileRoots() []string {
	return []string{abletonDir, moveUserLibrary, filepath.Dir(moveUserLibrary)}
}

// safeFilePath: a path the browser may touch: absolute, clean, under a root,
// and not Pung's own folder, whichever way its links point.
func safeFilePath(p string) (string, error) {
	if p == "" || !filepath.IsAbs(p) || strings.Contains(p, "\x00") {
		return "", errors.New("not a path")
	}
	p = filepath.Clean(p)
	real := p
	if r, err := filepath.EvalSymlinks(p); err == nil {
		real = r
	} else if r, err := filepath.EvalSymlinks(filepath.Dir(p)); err == nil {
		real = filepath.Join(r, filepath.Base(p)) // a file not there yet (an upload)
	}
	pung, _ := filepath.EvalSymlinks(moveSchwungDir)
	for _, c := range []string{p, real} {
		if pathWithin(c, moveSchwungDir) || (pung != "" && pathWithin(c, pung)) {
			return "", errors.New("not a folder for files")
		}
	}
	for _, root := range fileRoots() {
		rr := root
		if r, err := filepath.EvalSymlinks(root); err == nil {
			rr = r
		}
		if pathWithin(p, root) || pathWithin(real, rr) {
			return p, nil
		}
	}
	return "", errors.New("outside the libraries")
}

// fileParamOf: the device's file parameter named key ("synth:sample_path" or
// "sample_path").
func (h *Host) fileParamOf(d *device, key string) (string, *paramMeta, error) {
	if i := strings.Index(key, ":"); i >= 0 {
		key = key[i+1:]
	}
	if h.sounds == nil {
		return "", nil, errors.New("no library")
	}
	cm := h.sounds.meta(d)
	if cm == nil {
		return "", nil, errors.New("the module's parameters are not known yet")
	}
	m := cm.Params[key]
	if m == nil || m.Type != "file" || m.File == nil {
		return "", nil, fmt.Errorf("%s is not a file parameter", key)
	}
	return key, m, nil
}

func (lib *fileLib) webSession(d *device, key string, m *paramMeta, open bool) (*fileBrowse, error) {
	id := fmt.Sprintf("%p|%s", d, key)
	webBrowseMu.Lock()
	defer webBrowseMu.Unlock()
	if wb := webBrowses[id]; wb != nil {
		wb.br.mu.Lock()
		done := wb.br.done
		wb.br.mu.Unlock()
		if !done {
			wb.timer.Reset(webBrowseIdle)
			return wb.br, nil
		}
		delete(webBrowses, id)
	}
	if !open {
		return nil, errors.New("the browser is not open")
	}
	// one browse per device: another parameter's is put back first
	for k, wb := range webBrowses {
		if wb.br.d == d {
			wb.timer.Stop()
			go wb.br.cancel()
			delete(webBrowses, k)
		}
	}
	br, err := lib.openFileBrowse(d, key, m)
	if err != nil {
		return nil, err
	}
	wb := &webBrowse{br: br}
	wb.timer = time.AfterFunc(webBrowseIdle, func() {
		br.cancel()
		webBrowseMu.Lock()
		if webBrowses[id] == wb {
			delete(webBrowses, id)
		}
		webBrowseMu.Unlock()
	})
	webBrowses[id] = wb
	return br, nil
}

// fileView: a file parameter as the page shows it before anything is listed.
type fileView struct {
	Key         string         `json:"key"`
	Name        string         `json:"name"`
	Value       string         `json:"value"`
	Shown       string         `json:"shown"` // the value's name
	Filter      []string       `json:"filter"`
	Audio       bool           `json:"audio"`
	Kind        string         `json:"kind"`
	LivePreview bool           `json:"live_preview"`
	Preview     bool           `json:"preview"`
	Places      []filePlaceRow `json:"places"`
	// At: where the browser opens: the place, and the folders below it
	At struct {
		Place string `json:"place"`
		Dir   string `json:"dir"`
	} `json:"at"`
}

type filePlaceRow struct {
	filePlace
	Count int `json:"count"`
}

func (h *Host) fileView(d *device, key string, m *paramMeta) fileView {
	lib := h.files
	v, _ := d.s.Get(d.c.component() + ":" + key)
	v = strings.TrimSpace(v)
	fv := fileView{Key: key, Name: m.Name, Value: v, Filter: m.File.Filter, Audio: m.File.audio(), Kind: m.File.kind(),
		LivePreview: m.File.LivePreview, Preview: lib.previewOn()}
	if v != "" {
		fv.Shown = displayName(filepath.Base(v))
	}
	places := placesFor(m.File, d.c.Name)
	first := ""
	for _, p := range places {
		n := 0
		if p.Virtual {
			n = len(lib.virtual(p.ID, m.File))
		} else {
			n = lib.total(p, m.File)
			if n > 0 && first == "" {
				first = p.ID
			}
		}
		fv.Places = append(fv.Places, filePlaceRow{p, n})
	}
	// at the device's file, else where the module starts, else the first
	// place that holds anything
	if v != "" {
		if i, _ := placeOf(places, v); i >= 0 && isDir(filepath.Dir(v)) {
			fv.At.Place, fv.At.Dir = places[i].ID, filepath.Dir(v)
		}
	}
	if fv.At.Place == "" {
		if i, _, dir, ok := lib.startDir(places, m.File); ok {
			fv.At.Place, fv.At.Dir = places[i].ID, dir
		}
	}
	if fv.At.Place == "" {
		fv.At.Place = first
		if first == "" && len(places) > 0 {
			fv.At.Place = places[0].ID
		}
	}
	return fv
}

func (h *Host) fileRoutes(mux *http.ServeMux) {
	lib := h.files
	type req struct {
		Key  string `json:"key"`
		Path string `json:"path"`
		On   bool   `json:"on"`
		Kind string `json:"kind"`
		Name string `json:"name"`
		Dir  string `json:"dir"`
	}
	param := func(w http.ResponseWriter, r *http.Request, key string) (*device, string, *paramMeta, bool) {
		d, ok := h.deviceFromPath(w, r)
		if !ok {
			return nil, "", nil, false
		}
		k, m, err := h.fileParamOf(d, key)
		if err != nil {
			fail(w, 400, "%v", err)
			return nil, "", nil, false
		}
		return d, k, m, true
	}
	body := func(w http.ResponseWriter, r *http.Request) (req, bool) {
		var b req
		if decodeJSON(r, &b) != nil {
			fail(w, 400, "body must be JSON")
			return b, false
		}
		return b, true
	}
	// the parameter: its places, and where to open
	mux.HandleFunc("GET /api/devices/{n}/files", func(w http.ResponseWriter, r *http.Request) {
		if d, k, m, ok := param(w, r, r.URL.Query().Get("key")); ok {
			writeJSON(w, 200, map[string]any{"ok": true, "file": h.fileView(d, k, m)})
		}
	})
	// a folder's rows (dir "": the place's top), with the folders it is under
	mux.HandleFunc("GET /api/devices/{n}/files/list", func(w http.ResponseWriter, r *http.Request) {
		d, _, m, ok := param(w, r, r.URL.Query().Get("key"))
		if !ok {
			return
		}
		places := placesFor(m.File, d.c.Name)
		var p *filePlace
		for i := range places {
			if places[i].ID == r.URL.Query().Get("place") {
				p = &places[i]
			}
		}
		if p == nil {
			fail(w, 400, "no such place")
			return
		}
		dir := r.URL.Query().Get("dir")
		var rows []fileEntry
		var crumbs []map[string]string
		switch {
		case p.Virtual:
			rows = lib.virtual(p.ID, m.File)
		case dir == "":
			rows = lib.listPlace(*p, m.File)
		default:
			i, root := placeOf([]filePlace{*p}, dir)
			if i < 0 || !isDir(dir) {
				fail(w, 400, "that folder is not in %s", p.Name)
				return
			}
			rows = lib.list(root, dir, m.File)
			if rel, err := filepath.Rel(root, dir); err == nil && rel != "." {
				at := root
				for _, part := range strings.Split(rel, string(filepath.Separator)) {
					at = filepath.Join(at, part)
					crumbs = append(crumbs, map[string]string{"name": part, "dir": at})
				}
			}
		}
		kind := m.File.kind()
		type row struct {
			fileEntry
			Shown string `json:"shown"`
			Fav   bool   `json:"fav,omitempty"`
		}
		out := make([]row, 0, len(rows))
		for _, e := range rows {
			x := row{fileEntry: e, Shown: e.Name}
			if !e.Dir {
				x.Shown, x.Fav = displayName(e.Name), lib.store.isFav(kind, e.Path)
			}
			out = append(out, x)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "rows": out, "crumbs": crumbs, "place": p.ID, "dir": dir, "writable": p.Writable && !p.Virtual})
	})
	// search a place: every usable file below it whose name has the words
	mux.HandleFunc("GET /api/devices/{n}/files/search", func(w http.ResponseWriter, r *http.Request) {
		d, _, m, ok := param(w, r, r.URL.Query().Get("key"))
		if !ok {
			return
		}
		words := strings.Fields(strings.ToLower(r.URL.Query().Get("q")))
		places := placesFor(m.File, d.c.Name)
		kind := m.File.kind()
		type hit struct {
			fileEntry
			Shown string `json:"shown"`
			Fav   bool   `json:"fav,omitempty"`
			Where string `json:"where"`
		}
		out := []hit{}
		for _, p := range places {
			if p.Virtual || (r.URL.Query().Get("place") != "" && p.ID != r.URL.Query().Get("place")) {
				continue
			}
			for _, root := range p.Dirs {
				filepath.WalkDir(root, func(path string, e os.DirEntry, err error) error { //nolint:errcheck
					if err != nil || len(out) >= 500 {
						return filepath.SkipDir
					}
					name := e.Name()
					if e.IsDir() {
						if path != root && skipDir(name) {
							return filepath.SkipDir
						}
						return nil
					}
					if strings.HasPrefix(name, ".") || !usable(m.File, name) {
						return nil
					}
					low := strings.ToLower(path[len(root):])
					for _, wd := range words {
						if !strings.Contains(low, wd) {
							return nil
						}
					}
					rel, _ := filepath.Rel(root, filepath.Dir(path))
					where := p.Name
					if rel != "." {
						where += " / " + strings.ReplaceAll(rel, "/", " / ")
					}
					out = append(out, hit{fileEntry: fileEntry{Name: name, Path: path, Convert: !m.File.accepts(name)},
						Shown: displayName(name), Fav: lib.store.isFav(kind, path), Where: where})
					return nil
				})
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "rows": out, "more": len(out) >= 500})
	})
	// a file's facts and outline
	mux.HandleFunc("GET /api/files/info", func(w http.ResponseWriter, r *http.Request) {
		p, err := safeFilePath(r.URL.Query().Get("path"))
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			fail(w, 404, "no such file")
			return
		}
		af := audioFiles.get(p)
		var facts []string
		if af.Info != nil {
			facts = af.Info.describe()
		}
		writeJSON(w, 200, map[string]any{"ok": true, "name": filepath.Base(p), "shown": displayName(filepath.Base(p)), "size": st.Size(),
			"size_text": sizeText(st.Size()), "info": af.Info, "peaks": af.Peaks, "facts": facts})
	})
	// the file itself, to hear it in the browser the page runs in
	mux.HandleFunc("GET /api/files/audio", func(w http.ResponseWriter, r *http.Request) {
		p, err := safeFilePath(r.URL.Query().Get("path"))
		if err != nil || !isAudioExt(filepath.Ext(p)) {
			fail(w, 400, "not an audio file of the libraries")
			return
		}
		http.ServeFile(w, r, p)
	})
	mux.HandleFunc("POST /api/devices/{n}/files/open", func(w http.ResponseWriter, r *http.Request) {
		b, ok := body(w, r)
		if !ok {
			return
		}
		if d, k, m, ok := param(w, r, b.Key); ok {
			if _, err := lib.webSession(d, k, m, true); err != nil {
				fail(w, 400, "%v", err)
				return
			}
			writeJSON(w, 200, map[string]any{"ok": true, "file": h.fileView(d, k, m)})
		}
	})
	mux.HandleFunc("POST /api/devices/{n}/files/audition", func(w http.ResponseWriter, r *http.Request) {
		b, ok := body(w, r)
		if !ok {
			return
		}
		d, k, m, ok := param(w, r, b.Key)
		if !ok {
			return
		}
		br, err := lib.webSession(d, k, m, true)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		if b.Path == "" {
			br.rest()
			writeJSON(w, 200, map[string]any{"ok": true})
			return
		}
		p, err := safeFilePath(b.Path)
		if err != nil || !usable(m.File, p) {
			fail(w, 400, "not a file for this parameter")
			return
		}
		br.audition(p)
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/devices/{n}/files/load", func(w http.ResponseWriter, r *http.Request) {
		b, ok := body(w, r)
		if !ok {
			return
		}
		d, k, m, ok := param(w, r, b.Key)
		if !ok {
			return
		}
		p, err := safeFilePath(b.Path)
		if err != nil || !usable(m.File, p) {
			fail(w, 400, "not a file for this parameter")
			return
		}
		br, err := lib.webSession(d, k, m, true)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		final, err := br.commit(p)
		if err != nil {
			br.cancel()
			fail(w, 400, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "value": final, "file": h.fileView(d, k, m)})
	})
	mux.HandleFunc("POST /api/devices/{n}/files/cancel", func(w http.ResponseWriter, r *http.Request) {
		b, ok := body(w, r)
		if !ok {
			return
		}
		if d, k, m, ok := param(w, r, b.Key); ok {
			if br, err := lib.webSession(d, k, m, false); err == nil {
				br.cancel()
			}
			writeJSON(w, 200, map[string]any{"ok": true, "file": h.fileView(d, k, m)})
		}
	})
	mux.HandleFunc("POST /api/files/fav", func(w http.ResponseWriter, r *http.Request) {
		b, ok := body(w, r)
		if !ok {
			return
		}
		p, err := safeFilePath(b.Path)
		if err != nil || b.Kind == "" {
			fail(w, 400, "body must be {\"kind\":...,\"path\":...}")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "fav": lib.store.toggleFav(b.Kind, p)})
	})
	mux.HandleFunc("POST /api/files/preview", func(w http.ResponseWriter, r *http.Request) {
		b, ok := body(w, r)
		if !ok {
			return
		}
		lib.setPreview(b.On)
		webBrowseMu.Lock()
		for _, wb := range webBrowses {
			wb.br.mu.Lock()
			wb.br.Preview = b.On
			wb.br.mu.Unlock()
			if !b.On {
				wb.br.d.stopPreview()
			}
		}
		webBrowseMu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true, "preview": b.On})
	})
	// a new folder in the user's library or the module's own
	mux.HandleFunc("POST /api/devices/{n}/files/mkdir", func(w http.ResponseWriter, r *http.Request) {
		b, ok := body(w, r)
		if !ok {
			return
		}
		d, _, m, ok := param(w, r, b.Key)
		if !ok {
			return
		}
		dir, err := writableDir(placesFor(m.File, d.c.Name), b.Dir)
		name := cleanFileName(b.Name)
		if err != nil || name == "" {
			fail(w, 400, "a folder needs a name, and a place files may go")
			return
		}
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(p, 0o755); err != nil {
			fail(w, 500, "%v", err)
			return
		}
		ownedByLive(p)
		writeJSON(w, 200, map[string]any{"ok": true, "dir": p})
	})
	// a file from the computer: PUT its bytes; dir: where (a folder of a
	// writable place; "": the first writable place's top)
	mux.HandleFunc("PUT /api/devices/{n}/files/upload", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		d, _, m, ok := param(w, r, q.Get("key"))
		if !ok {
			return
		}
		name := cleanFileName(q.Get("name"))
		if name == "" || !usable(m.File, name) {
			fail(w, 400, "this device does not load %s", filepath.Base(q.Get("name")))
			return
		}
		dir, err := writableDir(placesFor(m.File, d.c.Name), q.Get("dir"))
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			fail(w, 500, "%v", err)
			return
		}
		dst := filepath.Join(dir, name)
		if _, err := os.Stat(dst); err == nil && q.Get("replace") != "1" {
			fail(w, 409, "%s is already there", name)
			return
		}
		tmp := dst + ".part"
		f, err := os.Create(tmp)
		if err != nil {
			fail(w, 500, "%v", err)
			return
		}
		n, err := io.Copy(f, http.MaxBytesReader(w, r.Body, 2<<30))
		f.Close()
		if err != nil || n == 0 {
			os.Remove(tmp)
			fail(w, 400, "the file did not arrive whole")
			return
		}
		if err := os.Rename(tmp, dst); err != nil {
			os.Remove(tmp)
			fail(w, 500, "%v", err)
			return
		}
		ownedByLive(dir, dst)
		lib.forget()
		writeJSON(w, 200, map[string]any{"ok": true, "path": dst, "size": n})
	})
}

// writableDir: dir if files may be put there (a folder of a writable place),
// or the first writable place's top for "".
func writableDir(places []filePlace, dir string) (string, error) {
	for _, p := range places {
		if !p.Writable || p.Virtual || len(p.Dirs) == 0 {
			continue
		}
		if dir == "" {
			return p.Dirs[0], nil
		}
		if c, err := safeFilePath(dir); err == nil && pathWithin(c, p.Dirs[0]) {
			return c, nil
		}
	}
	return "", errors.New("files cannot be put there: the User Library can take them")
}

// cleanFileName: a name with no way out of its folder.
func cleanFileName(s string) string {
	s = strings.TrimSpace(filepath.Base(strings.ReplaceAll(s, "\\", "/")))
	if s == "." || s == ".." || s == "/" || strings.HasPrefix(s, ".") || strings.ContainsAny(s, "\x00/") {
		return ""
	}
	return s
}
