package main

// sounds_library.go: every module's sounds at once (docs/PRESETS.md, the
// Library page): the user sounds and favourites of each, renamed, deleted
// and starred without a device, and the whole library exported or imported
// in the layout a Move keeps (presets/<module-id>/<name>.json).

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
	"sort"
	"strings"
)

type libModule struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Type       string     `json:"type,omitempty"`
	Installed  bool       `json:"installed"`
	User       []userRow  `json:"user"`
	Favourites []soundRef `json:"favourites"`
	Named      int        `json:"named"`   // factory names Pung knows
	Devices    []int      `json:"devices"` // the Pung devices in Live running it
}

// Library: every module with sounds of its own here, and every installed
// module (so an import has somewhere to go), by name.
func (lib *soundLib) Library() []libModule {
	byID := map[string]*libModule{}
	if lib.h != nil {
		for _, m := range scanModules(lib.h.modulesDir) {
			byID[m.ID] = &libModule{ID: m.ID, Name: m.Name, Type: m.Type, Installed: true}
		}
	}
	if ents, err := os.ReadDir(lib.store.root); err == nil {
		for _, e := range ents {
			if e.IsDir() && !notModule(e.Name()) && byID[e.Name()] == nil {
				byID[e.Name()] = &libModule{ID: e.Name(), Name: e.Name()}
			}
		}
	}
	if lib.h != nil && lib.h.prov != nil {
		for _, d := range lib.h.prov.list() {
			if m := byID[d.c.module]; m != nil {
				m.Devices = append(m.Devices, d.s.Index)
			}
		}
	}
	var out []libModule
	for _, m := range byID {
		ix := lib.store.Index(m.ID)
		list, _ := lib.store.List(m.ID)
		m.User = []userRow{}
		for _, s := range list {
			m.User = append(m.User, userRow{Name: s.Name, Fav: ix.isFavourite(soundRef{Source: "user", Name: s.Name}), Tags: ix.Tags["user:"+s.Name]})
		}
		m.Favourites = ix.Favourites
		if m.Favourites == nil {
			m.Favourites = []soundRef{}
		}
		for _, n := range ix.Names {
			m.Named += len(n)
		}
		if m.Devices == nil {
			m.Devices = []int{}
		}
		out = append(out, *m)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

// renameAll gives a user sound another name, for the index and for every
// device that is that sound.
func (lib *soundLib) renameAll(module, name, to string) (string, error) {
	got, err := lib.store.Rename(module, name, to)
	if err != nil {
		return "", err
	}
	lib.store.Update(module, func(ix *soundIndex) { ix.renameUser(name, got) }) //nolint:errcheck
	lib.eachDevice(module, func(d *device) {
		if c := d.snd.current; c != nil && c.Source == "user" && c.Name == name {
			c.Name = got
		}
	})
	return got, nil
}

func (lib *soundLib) deleteAll(module, name string) error {
	if err := lib.store.Delete(module, name); err != nil {
		return err
	}
	lib.store.Update(module, func(ix *soundIndex) { ix.forgetUser(name) }) //nolint:errcheck
	lib.eachDevice(module, func(d *device) {
		if c := d.snd.current; c != nil && c.Source == "user" && c.Name == name {
			d.snd.current, d.snd.hash = nil, ""
		}
	})
	return nil
}

// eachDevice runs f, under the device's sound lock, for every device of module.
func (lib *soundLib) eachDevice(module string, f func(d *device)) {
	if lib.h == nil || lib.h.prov == nil {
		return
	}
	for _, d := range lib.h.prov.list() {
		if d.c.module == module {
			d.snd.mu.Lock()
			f(d)
			d.snd.mu.Unlock()
		}
	}
}

// ExportAll: every module's user sounds in one zip, as presets/<module>/,
// the folders a Move keeps.
func (lib *soundLib) ExportAll() ([]byte, int, error) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	n := 0
	ents, err := os.ReadDir(lib.store.root)
	if err != nil && !os.IsNotExist(err) {
		return nil, 0, err
	}
	for _, e := range ents {
		if !e.IsDir() || notModule(e.Name()) {
			continue
		}
		list, _ := lib.store.List(e.Name())
		for _, s := range list {
			raw, err := os.ReadFile(filepath.Join(lib.store.root, e.Name(), s.File))
			if err != nil {
				continue
			}
			w, err := z.Create("presets/" + e.Name() + "/" + s.File)
			if err != nil {
				return nil, 0, err
			}
			w.Write(raw) //nolint:errcheck
			n++
		}
	}
	if err := z.Close(); err != nil {
		return nil, 0, err
	}
	return b.Bytes(), n, nil
}

// ImportAll adds every preset file of a zip (an ExportAll, a module's
// export, a Move's presets folder) to the module its file names, or the
// folder it sits in; a file that names neither is left out.
func (lib *soundLib) ImportAll(data []byte) (added map[string][]string, skipped []string, err error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, errors.New("not a zip of preset files")
	}
	added = map[string][]string{}
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
		var doc struct {
			Module string `json:"module"`
		}
		json.Unmarshal(raw, &doc) //nolint:errcheck // Import says what is wrong with it
		module := doc.Module
		if module == "" {
			module = filepath.Base(filepath.Dir(f.Name))
		}
		if notModule(module) || module == "." {
			skipped = append(skipped, f.Name+": names no module")
			continue
		}
		got, sk, _ := lib.Import(module, raw)
		added[module] = append(added[module], got...)
		skipped = append(skipped, sk...)
	}
	return added, skipped, nil
}

func (lib *soundLib) libraryRoutes(mux *http.ServeMux) {
	body := func(r *http.Request, v any) error { return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v) }
	ok := func(w http.ResponseWriter, err error) {
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "modules": lib.Library()})
	}
	mux.HandleFunc("GET /api/library", func(w http.ResponseWriter, r *http.Request) { ok(w, nil) })
	mux.HandleFunc("POST /api/library/{module}/rename", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Name, To string }
		if body(r, &b) != nil || b.Name == "" || strings.TrimSpace(b.To) == "" {
			fail(w, 400, `body must be {"name":...,"to":...}`)
			return
		}
		_, err := lib.renameAll(r.PathValue("module"), b.Name, b.To)
		ok(w, err)
	})
	mux.HandleFunc("POST /api/library/{module}/delete", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Name string }
		if body(r, &b) != nil || b.Name == "" {
			fail(w, 400, `body must be {"name":...}`)
			return
		}
		ok(w, lib.deleteAll(r.PathValue("module"), b.Name))
	})
	mux.HandleFunc("POST /api/library/{module}/fav", func(w http.ResponseWriter, r *http.Request) {
		var ref soundRef
		if body(r, &ref) != nil || ref.Source == "" {
			fail(w, 400, "body must be a sound")
			return
		}
		ok(w, lib.store.Update(r.PathValue("module"), func(ix *soundIndex) { ix.toggleFavourite(ref) }))
	})
	mux.HandleFunc("GET /api/library/export", func(w http.ResponseWriter, r *http.Request) {
		data, n, err := lib.ExportAll()
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		if n == 0 {
			fail(w, 404, "no sounds of yours yet")
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="pung-sounds.zip"`)
		w.Write(data) //nolint:errcheck
	})
	mux.HandleFunc("POST /api/library/import", func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, 128<<20))
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		added, skipped, err := lib.ImportAll(data)
		if err != nil {
			fail(w, 400, "%v", err)
			return
		}
		n := 0
		for _, a := range added {
			n += len(a)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "added": added, "count": n, "skipped": skipped,
			"message": fmt.Sprintf("%d sound%s added", n, map[bool]string{true: "", false: "s"}[n == 1])})
	})
}
