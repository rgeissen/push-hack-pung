package main

// modmgr.go: modules from Pung's catalog (scripts/build-catalog.py, published
// on the DiskStation): install, update, remove, and the files a module needs
// that no package carries (its "assets": ROMs, banks).
//
// Where a module lives. Installed modules are Pung's DATA, not part of the
// hack: <data>/modules/<subdir>/<id>, linked into the module tree the chain
// host resolves names in (<hack>/modules/<subdir>/<id>). Reinstalling Pung
// keeps them; a link a deploy replaced is put back at start (linkModules).
//
// What Live sees. A module becomes a device class when Pung starts and Live
// scans plugins when IT starts, so every change waits for "Apply": Pung
// starts again (new classes) and restarts Live (tools: restart-live.sh), which
// recovers the Set. A removed module's class stays known (classes.go,
// retired): Live's recovery replays the Set's history and crashed on a plugin
// class that had gone (2026-11-14).

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultCatalogURL = "https://<your-site>/catalog.json"
	catalogTTL        = 10 * time.Minute
)

// subdirs Pung can run: a Live device each (tools and overtake modules are Move's).
var installSubdirs = map[string]string{"sound_generator": "sound_generators", "audio_fx": "audio_fx", "midi_fx": "midi_fx"}

type catalogEntry struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Version         string   `json:"version"`
	ComponentType   string   `json:"component_type"`
	Description     string   `json:"description"`
	Author          string   `json:"author"`
	Requires        string   `json:"requires"`
	RequiresModules []string `json:"requires_modules"`
	Asset           string   `json:"asset"`
	Size            int64    `json:"size"`
	SHA256          string   `json:"sha256"`
	License         struct {
		SPDX          string `json:"spdx"`
		Noncommercial bool   `json:"noncommercial"`
		From          string `json:"from"`
	} `json:"license"`
	Source struct {
		Repo        string `json:"repo"`
		Commit      string `json:"commit"`
		Archive     string `json:"archive"`
		ArchiveSize int64  `json:"archive_size"`
	} `json:"source"`
	Assets      json.RawMessage `json:"assets,omitempty"`
	Subcategory string          `json:"subcategory,omitempty"`
	Tags        []string        `json:"tags,omitempty"`
	Released    string          `json:"released,omitempty"`
	Updated     string          `json:"updated,omitempty"`
}

type catalogDoc struct {
	CatalogVersion int             `json:"catalog_version"`
	GeneratedAt    string          `json:"generated_at"`
	BaseURL        string          `json:"base_url"`
	Modules        []catalogEntry  `json:"modules"`
	Taxonomy       json.RawMessage `json:"taxonomy,omitempty"`
}

type modJob struct {
	ID      string    `json:"id"`
	Action  string    `json:"action"` // install | update | remove
	State   string    `json:"state"`  // queued downloading verifying unpacking testing done failed
	Done    int64     `json:"done"`
	Total   int64     `json:"total"`
	Err     string    `json:"error,omitempty"`
	Started time.Time `json:"started"`
}

type modMgr struct {
	h *Host

	mu         sync.Mutex
	cat        *catalogDoc
	catURL     string
	catFetched time.Time // when the copy in cat was fetched
	catOffline bool      // the last fetch failed: cat is the cached copy
	catErr     string
	jobs       map[string]*modJob
	queue      chan string
	pending    []string // changes Live has not seen yet (persisted)
	restarting bool
}

func newModMgr(h *Host) *modMgr {
	mm := &modMgr{h: h, jobs: map[string]*modJob{}, queue: make(chan string, 64)}
	if raw, err := os.ReadFile(mm.path("catalog-cache.json")); err == nil {
		var c struct {
			Fetched time.Time  `json:"fetched"`
			URL     string     `json:"url"`
			Doc     catalogDoc `json:"doc"`
		}
		if json.Unmarshal(raw, &c) == nil {
			mm.cat, mm.catFetched, mm.catURL, mm.catOffline = &c.Doc, c.Fetched, c.URL, true
		}
	}
	if raw, err := os.ReadFile(mm.path("pending-changes.json")); err == nil {
		json.Unmarshal(raw, &mm.pending) //nolint:errcheck
	}
	go mm.worker()
	return mm
}

func (mm *modMgr) path(p ...string) string {
	return filepath.Join(append([]string{mm.h.dataDir}, p...)...)
}

func (mm *modMgr) managedDir(subdir, id string) string { return mm.path("modules", subdir, id) }
func (mm *modMgr) linkPath(subdir, id string) string {
	return filepath.Join(mm.h.modulesDir, subdir, id)
}

func (mm *modMgr) catalogURL() string {
	if u := mm.h.settings.get().CatalogURL; u != "" {
		return u
	}
	return defaultCatalogURL
}

// ---- the catalog ------------------------------------------------------------------

// catalog: the catalog, fetched again when older than catalogTTL (force: now).
// Offline, the last copy, marked so.
func (mm *modMgr) catalog(force bool) {
	url := mm.catalogURL()
	mm.mu.Lock()
	fresh := mm.cat != nil && !mm.catOffline && mm.catURL == url && time.Since(mm.catFetched) < catalogTTL
	mm.mu.Unlock()
	if fresh && !force {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "Pung/"+buildVersion)
	var doc catalogDoc
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			err = fmt.Errorf("the catalog answered %s", resp.Status)
		} else if err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&doc); err == nil && doc.CatalogVersion != 1 {
			err = fmt.Errorf("catalog version %d: this Pung reads version 1", doc.CatalogVersion)
		}
	}
	mm.mu.Lock()
	defer mm.mu.Unlock()
	if err != nil {
		mm.catOffline, mm.catErr = true, err.Error()
		return
	}
	if doc.BaseURL == "" {
		doc.BaseURL = strings.TrimSuffix(url, "/catalog.json")
	}
	mm.cat, mm.catURL, mm.catFetched, mm.catOffline, mm.catErr = &doc, url, time.Now(), false, ""
	raw, _ := json.Marshal(map[string]any{"fetched": mm.catFetched, "url": url, "doc": doc})
	writeFileAtomic(mm.path("catalog-cache.json"), raw)
}

func (mm *modMgr) entry(id string) (catalogEntry, bool) {
	mm.mu.Lock()
	defer mm.mu.Unlock()
	if mm.cat != nil {
		for _, e := range mm.cat.Modules {
			if e.ID == id {
				return e, true
			}
		}
	}
	return catalogEntry{}, false
}

// ---- what is installed ---------------------------------------------------------

type installed struct {
	ModuleInfo
	Subdir  string
	Managed bool // from the catalog (a link into Pung's data); else built into Pung
}

func (mm *modMgr) installed() map[string]installed {
	out := map[string]installed{}
	for _, m := range scanModules(mm.h.modulesDir) {
		sub := installSubdirs[m.Type]
		fi, err := os.Lstat(mm.linkPath(sub, filepath.Base(m.Dir)))
		managed := err == nil && fi.Mode()&os.ModeSymlink != 0
		out[m.ID] = installed{ModuleInfo: m, Subdir: sub, Managed: managed}
	}
	return out
}

// linkModules puts every installed module's link in place (at start, before
// the classes are built): a deploy may have replaced one with the module
// Pung ships. The newer version stays; the other goes to the trash, its
// assets moved to the one that stays.
func (mm *modMgr) linkModules() {
	for _, sub := range installSubdirs {
		ents, _ := os.ReadDir(mm.path("modules", sub))
		for _, e := range ents {
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			target, link := mm.managedDir(sub, e.Name()), mm.linkPath(sub, e.Name())
			fi, err := os.Lstat(link)
			switch {
			case err != nil:
			case fi.Mode()&os.ModeSymlink != 0:
				if cur, _ := os.Readlink(link); cur == target {
					continue
				}
				os.Remove(link)
			case fi.IsDir():
				if versionLess(moduleVersion(target), moduleVersion(link)) {
					log.Printf("modules: %s: Pung's own %s is newer than the installed %s; it stays", e.Name(), moduleVersion(link), moduleVersion(target))
					continue
				}
				moveAssets(link, target)
				if err := mm.toTrash(link); err != nil {
					log.Printf("modules: %s: %v", e.Name(), err)
					continue
				}
			}
			os.MkdirAll(filepath.Dir(link), 0o755) //nolint:errcheck
			if err := os.Symlink(target, link); err != nil {
				log.Printf("modules: link %s: %v", e.Name(), err)
			}
		}
	}
}

func moduleVersion(dir string) string {
	raw, _ := os.ReadFile(filepath.Join(dir, "module.json"))
	var m struct {
		Version string `json:"version"`
	}
	json.Unmarshal(raw, &m) //nolint:errcheck
	return m.Version
}

// versionLess: a < b, by numeric parts (1.10 > 1.9); a part that is not a
// number compares as text.
func versionLess(a, b string) bool {
	pa, pb := strings.FieldsFunc(a, func(r rune) bool { return r == '.' || r == '-' }), strings.FieldsFunc(b, func(r rune) bool { return r == '.' || r == '-' })
	for i := 0; i < len(pa) || i < len(pb); i++ {
		if i >= len(pa) {
			return true
		}
		if i >= len(pb) {
			return false
		}
		x, ex := strconv.Atoi(pa[i])
		y, ey := strconv.Atoi(pb[i])
		if ex == nil && ey == nil {
			if x != y {
				return x < y
			}
			continue
		}
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	return false
}

// ---- assets: the files a module needs that no package carries ----------------------

type assetFile struct {
	Filename string `json:"filename"`
	Label    string `json:"label"`
	Size     int64  `json:"size"`
	CRC32    string `json:"crc32"`
	Required bool   `json:"required"`
}

type assetSpec struct {
	Path        string      `json:"path"`
	Label       string      `json:"label"`
	Extensions  []string    `json:"extensions"`
	Description string      `json:"description"`
	Hint        string      `json:"hint"`
	Optional    bool        `json:"optional"`
	Files       []assetFile `json:"files"`
}

func assetSpecs(dir string) []assetSpec {
	raw, _ := os.ReadFile(filepath.Join(dir, "module.json"))
	var m struct {
		Assets json.RawMessage `json:"assets"`
	}
	if json.Unmarshal(raw, &m) != nil || len(m.Assets) == 0 {
		return nil
	}
	var list []assetSpec
	if json.Unmarshal(m.Assets, &list) == nil {
		return list
	}
	var one assetSpec
	if json.Unmarshal(m.Assets, &one) == nil && one.Path != "" {
		return []assetSpec{one}
	}
	return nil
}

// moveAssets: a module's asset folders from one copy to another (an update,
// a reinstall), where the other has none of its own.
func moveAssets(from, to string) {
	specs := assetSpecs(to)
	if len(specs) == 0 {
		specs = assetSpecs(from)
	}
	for _, a := range specs {
		src, dst := filepath.Join(from, a.Path), filepath.Join(to, a.Path)
		if !exists(src) {
			continue
		}
		if ents, _ := os.ReadDir(dst); len(ents) > 0 {
			// the package ships some (factory banks): the user's join them
			ents, _ := os.ReadDir(src)
			for _, e := range ents {
				if !exists(filepath.Join(dst, e.Name())) {
					os.Rename(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())) //nolint:errcheck
				}
			}
			continue
		}
		os.RemoveAll(dst)
		os.MkdirAll(filepath.Dir(dst), 0o755) //nolint:errcheck
		if err := os.Rename(src, dst); err != nil {
			log.Printf("modules: assets %s: %v", a.Path, err)
		}
	}
}

type assetState struct {
	assetSpec
	Files   []assetFileState `json:"files"`
	Others  []string         `json:"others"` // files in the folder no declaration names
	Missing int              `json:"missing"`
}

type assetFileState struct {
	assetFile
	Present bool   `json:"present"`
	OK      bool   `json:"ok"`
	Problem string `json:"problem,omitempty"`
}

func assetStates(dir string) []assetState {
	var out []assetState
	for _, a := range assetSpecs(dir) {
		st := assetState{assetSpec: a}
		named := map[string]bool{}
		for _, f := range a.Files {
			fs := assetFileState{assetFile: f}
			named[f.Filename] = true
			p := filepath.Join(dir, a.Path, f.Filename)
			if fi, err := os.Stat(p); err == nil {
				fs.Present, fs.OK = true, true
				if f.Size > 0 && fi.Size() != f.Size {
					fs.OK, fs.Problem = false, fmt.Sprintf("%d bytes, %d expected", fi.Size(), f.Size)
				} else if f.CRC32 != "" {
					if c, err := fileCRC(p); err == nil && !strings.EqualFold(c, f.CRC32) {
						fs.OK, fs.Problem = false, "its checksum is not the expected one: another version?"
					}
				}
			}
			if f.Required && !fs.OK {
				st.Missing++
			}
			st.Files = append(st.Files, fs)
		}
		ents, _ := os.ReadDir(filepath.Join(dir, a.Path))
		for _, e := range ents {
			if !named[e.Name()] && !strings.HasPrefix(e.Name(), ".") {
				st.Others = append(st.Others, e.Name())
			}
		}
		out = append(out, st)
	}
	return out
}

func fileCRC(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := crc32.NewIEEE()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%08X", h.Sum32()), nil
}

// addAsset stores an uploaded file in one of a module's asset folders. A
// declared file is recognised by its size and checksum whatever it is called
// (a dump named "First_A_28.mid" is the Virus A firmware) and stored under
// the name the module looks for; one with the right name and the wrong
// checksum is refused, with what it is not.
func (mm *modMgr) addAsset(id, path, name string, body io.Reader) (string, error) {
	inst, ok := mm.installed()[id]
	if !ok {
		return "", fmt.Errorf("%s is not installed", id)
	}
	var spec *assetSpec
	for _, a := range assetSpecs(inst.Dir) {
		if a.Path == path {
			a := a
			spec = &a
		}
	}
	if spec == nil {
		return "", fmt.Errorf("%s has no asset folder %q", id, path)
	}
	name = filepath.Base(filepath.Clean("/" + name))
	if name == "/" || name == "." || strings.HasPrefix(name, ".") {
		return "", errors.New("no file name")
	}
	if len(spec.Extensions) > 0 {
		okExt := false
		for _, e := range spec.Extensions {
			if strings.EqualFold(filepath.Ext(name), e) {
				okExt = true
			}
		}
		if !okExt {
			return "", fmt.Errorf("%s takes %s files", spec.Label, strings.Join(spec.Extensions, ", "))
		}
	}
	dir := filepath.Join(inst.Dir, spec.Path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	h := crc32.NewIEEE()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(body, 64<<20+1))
	tmp.Close()
	if err != nil {
		return "", err
	}
	if n > 64<<20 {
		return "", errors.New("larger than 64 MB")
	}
	crc := fmt.Sprintf("%08X", h.Sum32())
	target := name
	for _, f := range spec.Files {
		if f.CRC32 != "" && strings.EqualFold(f.CRC32, crc) && (f.Size == 0 || f.Size == n) {
			target = f.Filename // recognised: the name the module looks for
			break
		}
		if f.Filename == name && ((f.Size > 0 && f.Size != n) || (f.CRC32 != "" && !strings.EqualFold(f.CRC32, crc))) {
			return "", fmt.Errorf("this is not %s: %d bytes, checksum %s (expected %d bytes, %s)", f.Label, n, crc, f.Size, f.CRC32)
		}
	}
	if err := os.Rename(tmp.Name(), filepath.Join(dir, target)); err != nil {
		return "", err
	}
	log.Printf("modules: %s: %s/%s added (%d bytes)", id, path, target, n)
	return target, nil
}

func (mm *modMgr) removeAsset(id, path, name string) error {
	inst, ok := mm.installed()[id]
	if !ok {
		return fmt.Errorf("%s is not installed", id)
	}
	for _, a := range assetSpecs(inst.Dir) {
		if a.Path == path {
			name = filepath.Base(filepath.Clean("/" + name))
			return os.Remove(filepath.Join(inst.Dir, a.Path, name))
		}
	}
	return fmt.Errorf("%s has no asset folder %q", id, path)
}

// reloadDevices: Pung's devices of a module load it again (its ROMs arrived).
func (mm *modMgr) reloadDevices(id string) int {
	if mm.h.prov == nil {
		return 0
	}
	n := 0
	for _, d := range mm.h.prov.list() {
		if d.c.module == id {
			go d.reload()
			n++
		}
	}
	return n
}

// ---- jobs ----------------------------------------------------------------------------

func (mm *modMgr) jobList() []*modJob {
	mm.mu.Lock()
	defer mm.mu.Unlock()
	var out []*modJob
	for _, j := range mm.jobs {
		c := *j
		out = append(out, &c)
	}
	sort.Slice(out, func(i, k int) bool { return out[i].Started.Before(out[k].Started) })
	return out
}

func (mm *modMgr) setJob(id string, f func(j *modJob)) {
	mm.mu.Lock()
	defer mm.mu.Unlock()
	if j := mm.jobs[id]; j != nil {
		f(j)
	}
}

// enqueue: an install or update, after the modules it needs.
func (mm *modMgr) enqueue(id string) error {
	e, ok := mm.entry(id)
	if !ok {
		return fmt.Errorf("%s is not in the catalog", id)
	}
	if _, ok := installSubdirs[e.ComponentType]; !ok {
		return fmt.Errorf("%s is a %s: Pung runs instruments and effects", e.Name, e.ComponentType)
	}
	inst := mm.installed()
	for _, dep := range e.RequiresModules {
		if _, have := inst[dep]; !have {
			if err := mm.enqueue(dep); err != nil {
				return fmt.Errorf("it needs %s: %v", dep, err)
			}
		}
	}
	mm.mu.Lock()
	defer mm.mu.Unlock()
	if mm.restarting {
		return errors.New("Pung is restarting")
	}
	if j := mm.jobs[id]; j != nil && j.State != "done" && j.State != "failed" {
		return nil // on its way already
	}
	action := "install"
	if _, have := inst[id]; have {
		action = "update"
	}
	mm.jobs[id] = &modJob{ID: id, Action: action, State: "queued", Total: e.Size, Started: time.Now()}
	mm.queue <- id
	return nil
}

// worker runs the jobs one at a time: each ends in a crash probe, and two
// modules loading at once is the race the chain host was not written for.
func (mm *modMgr) worker() {
	for id := range mm.queue {
		err := mm.install(id)
		mm.setJob(id, func(j *modJob) {
			if err != nil {
				j.State, j.Err = "failed", err.Error()
			} else {
				j.State = "done"
			}
		})
		if err != nil {
			log.Printf("modules: %s: %v", id, err)
		}
	}
}

func (mm *modMgr) install(id string) error {
	e, ok := mm.entry(id)
	if !ok {
		return errors.New("not in the catalog any more")
	}
	sub := installSubdirs[e.ComponentType]
	mm.mu.Lock()
	base := mm.cat.BaseURL
	mm.mu.Unlock()

	// download, checking size and checksum
	mm.setJob(id, func(j *modJob) { j.State = "downloading" })
	os.MkdirAll(mm.path(".downloads"), 0o755) //nolint:errcheck
	pkg := mm.path(".downloads", filepath.Base(e.Asset))
	if err := mm.download(id, strings.TrimSuffix(base, "/")+"/"+e.Asset, pkg, e.Size); err != nil {
		return err
	}
	defer os.Remove(pkg)
	mm.setJob(id, func(j *modJob) { j.State = "verifying" })
	if sum, err := fileSHA256(pkg); err != nil || sum != e.SHA256 {
		return fmt.Errorf("the download is damaged (checksum %s, the catalog says %s)", sum, e.SHA256)
	}

	// unpack beside, check it is what it says
	mm.setJob(id, func(j *modJob) { j.State = "unpacking" })
	stage := mm.path(".staging", fmt.Sprintf("%s-%d", id, time.Now().UnixNano()))
	defer os.RemoveAll(stage)
	if err := untar(pkg, stage, id); err != nil {
		return fmt.Errorf("unpacking: %v", err)
	}
	newDir := filepath.Join(stage, id)
	raw, err := os.ReadFile(filepath.Join(newDir, "module.json"))
	var mj struct {
		ID string `json:"id"`
	}
	if err != nil || json.Unmarshal(raw, &mj) != nil || mj.ID != id {
		return fmt.Errorf("the package holds no module %q", id)
	}

	// carry the user's files over, put it in place, link it
	final, link := mm.managedDir(sub, id), mm.linkPath(sub, id)
	prev := ""
	if old, ok := mm.installed()[id]; ok {
		moveAssets(old.Dir, newDir)
		prev = old.Dir
	} else if kept := mm.path("kept-assets", id); exists(kept) {
		moveAssets(kept, newDir)
		os.RemoveAll(kept)
	}
	var backup string // the copy this one replaces, until the probe says yes
	if exists(final) {
		backup = final + ".previous"
		os.RemoveAll(backup)
		if err := os.Rename(final, backup); err != nil {
			return err
		}
	}
	os.MkdirAll(filepath.Dir(final), 0o755) //nolint:errcheck
	if err := os.Rename(newDir, final); err != nil {
		return err
	}
	var bundled string // Pung's own copy, set aside for the link
	if fi, err := os.Lstat(link); err == nil {
		if fi.Mode()&os.ModeSymlink != 0 {
			os.Remove(link)
		} else {
			bundled = link + ".bundled"
			os.RemoveAll(bundled)
			if err := os.Rename(link, bundled); err != nil {
				return err
			}
		}
	}
	os.MkdirAll(filepath.Dir(link), 0o755) //nolint:errcheck
	if err := os.Symlink(final, link); err != nil {
		return err
	}
	rollback := func() {
		os.Remove(link)
		os.RemoveAll(final)
		if backup != "" {
			moveAssets(final, backup)
			os.Rename(backup, final) //nolint:errcheck
			os.Symlink(final, link)  //nolint:errcheck
		}
		if bundled != "" {
			os.Remove(link)
			os.Rename(bundled, link) //nolint:errcheck
		}
	}

	// the crash probe, as at start: a module that crashes it is not installed
	mm.setJob(id, func(j *modJob) { j.State = "testing" })
	exe, _ := os.Executable()
	m, ok := findModule(mm.h.modulesDir, id)
	if !ok {
		rollback()
		return errors.New("installed, but Pung does not find it")
	}
	v := runProbeChild(exe, mm.h.modulesDir, m)
	if !v.OK {
		rollback()
		return fmt.Errorf("it failed Pung's test: %s", v.Why)
	}
	screenMu.Lock()
	screenResults[id] = v
	screenMu.Unlock()
	mm.h.forgetProbe(id)
	if backup != "" {
		mm.toTrash(backup) //nolint:errcheck
	}
	if bundled != "" {
		mm.toTrash(bundled) //nolint:errcheck
	}
	_ = prev
	action := "installed"
	if prev != "" {
		action = "updated to " + e.Version
	}
	mm.addPending(fmt.Sprintf("%s %s", e.Name, action))
	log.Printf("modules: %s %s %s", id, action, e.Version)
	return nil
}

func (mm *modMgr) download(id, url, dst string, size int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "Pung/"+buildVersion)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("download: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download: %s", resp.Status)
	}
	f, err := os.Create(dst + ".part")
	if err != nil {
		return err
	}
	pr := &progressReader{r: io.LimitReader(resp.Body, size+1), f: func(n int64) { mm.setJob(id, func(j *modJob) { j.Done = n }) }}
	_, err = io.Copy(f, pr)
	f.Close()
	if err != nil {
		os.Remove(dst + ".part")
		return fmt.Errorf("download: %v", err)
	}
	return os.Rename(dst+".part", dst)
}

type progressReader struct {
	r    io.Reader
	n    int64
	last time.Time
	f    func(int64)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.n += int64(n)
	if time.Since(p.last) > 100*time.Millisecond || err != nil {
		p.last = time.Now()
		p.f(p.n)
	}
	return n, err
}

func fileSHA256(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// untar unpacks a module package into dst: only regular files and folders,
// only inside "<id>/", nothing that climbs out.
func untar(pkg, dst, id string) error {
	f, err := os.Open(pkg)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		hd, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(hd.Name)
		if filepath.IsAbs(name) || strings.HasPrefix(name, "..") || (name != id && !strings.HasPrefix(name, id+string(filepath.Separator))) {
			return fmt.Errorf("%q is outside the module", hd.Name)
		}
		p := filepath.Join(dst, name)
		switch hd.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(p, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(p), 0o755) //nolint:errcheck
			mode := os.FileMode(0o644)
			if hd.Mode&0o111 != 0 {
				mode = 0o755
			}
			out, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			_, err = io.Copy(out, io.LimitReader(tr, 512<<20))
			out.Close()
			if err != nil {
				return err
			}
		default:
			// links and devices: a module package has none
		}
	}
}

// remove: a module from the catalog, unless something needs it. Its assets
// are kept for a reinstall; its Live class stays known (retired).
func (mm *modMgr) remove(id string) error {
	inst, ok := mm.installed()[id]
	if !ok {
		return fmt.Errorf("%s is not installed", id)
	}
	if !inst.Managed {
		return fmt.Errorf("%s is built into Pung", inst.Name)
	}
	if mm.h.prov != nil {
		n := 0
		for _, d := range mm.h.prov.list() {
			if d.c.module == id {
				n++
			}
		}
		if n > 0 {
			return fmt.Errorf("%d device%s in your Live Set use%s %s: delete %s in Live first", n, plural(n), map[bool]string{true: "", false: "s"}[n != 1], inst.Name, map[bool]string{true: "them", false: "it"}[n != 1])
		}
	}
	mm.mu.Lock()
	var needers []string
	if mm.cat != nil {
		have := mm.installedLocked()
		for _, e := range mm.cat.Modules {
			for _, r := range e.RequiresModules {
				if r == id && have[e.ID] {
					needers = append(needers, e.Name)
				}
			}
		}
	}
	mm.mu.Unlock()
	if len(needers) > 0 {
		return fmt.Errorf("%s needs it", strings.Join(needers, ", "))
	}
	final := mm.managedDir(inst.Subdir, id)
	kept := mm.path("kept-assets", id)
	os.MkdirAll(kept, 0o755) //nolint:errcheck
	moveAssets(final, kept)
	if err := os.Remove(mm.linkPath(inst.Subdir, id)); err != nil {
		return err
	}
	if err := mm.toTrash(final); err != nil {
		return err
	}
	mm.h.forgetProbe(id)
	mm.addPending(inst.Name + " removed")
	log.Printf("modules: %s removed", id)
	return nil
}

func (mm *modMgr) installedLocked() map[string]bool {
	out := map[string]bool{}
	for _, m := range scanModules(mm.h.modulesDir) {
		out[m.ID] = true
	}
	return out
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func (mm *modMgr) toTrash(p string) error {
	t := mm.path(".trash", fmt.Sprintf("%s-%d", filepath.Base(p), time.Now().UnixNano()))
	os.MkdirAll(filepath.Dir(t), 0o755) //nolint:errcheck
	if err := os.Rename(p, t); err != nil {
		return err
	}
	go os.RemoveAll(t) //nolint:errcheck
	return nil
}

func (mm *modMgr) addPending(s string) {
	mm.mu.Lock()
	mm.pending = append(mm.pending, s)
	raw, _ := json.Marshal(mm.pending)
	mm.mu.Unlock()
	writeFileAtomic(mm.path("pending-changes.json"), raw)
}

func writeFileAtomic(p string, raw []byte) {
	os.MkdirAll(filepath.Dir(p), 0o755) //nolint:errcheck
	if err := os.WriteFile(p+".tmp", raw, 0o644); err == nil {
		os.Rename(p+".tmp", p) //nolint:errcheck
	}
}

// ---- the view the web page draws ------------------------------------------------------

type moduleRow struct {
	catalogEntry
	InCatalog   bool         `json:"in_catalog"`
	Supported   bool         `json:"supported"`
	Installed   string       `json:"installed,omitempty"` // its version
	Managed     bool         `json:"managed"`
	Status      string       `json:"status"` // available | installed | update | builtin
	InUse       int          `json:"in_use"`
	AssetsReady bool         `json:"assets_ready"`
	AssetsNeed  int          `json:"assets_missing"`
	Job         *modJob      `json:"job,omitempty"`
	AssetState  []assetState `json:"asset_state,omitempty"`
}

func (mm *modMgr) view() map[string]any {
	inst := mm.installed()
	inUse := map[string]int{}
	if mm.h.prov != nil {
		for _, d := range mm.h.prov.list() {
			inUse[d.c.module]++
		}
	}
	mm.mu.Lock()
	jobs := map[string]*modJob{}
	for id, j := range mm.jobs {
		c := *j
		jobs[id] = &c
	}
	var cat catalogDoc
	if mm.cat != nil {
		cat = *mm.cat
	}
	meta := map[string]any{"url": mm.catalogURL(), "generated_at": cat.GeneratedAt, "base_url": cat.BaseURL, "taxonomy": cat.Taxonomy,
		"offline": mm.catOffline, "error": mm.catErr, "have": mm.cat != nil}
	if !mm.catFetched.IsZero() {
		meta["fetched_at"] = mm.catFetched
	}
	pending := append([]string(nil), mm.pending...)
	restarting := mm.restarting
	mm.mu.Unlock()

	var rows []moduleRow
	seen := map[string]bool{}
	for _, e := range cat.Modules {
		_, sup := installSubdirs[e.ComponentType]
		r := moduleRow{catalogEntry: e, InCatalog: true, Supported: sup, Status: "available", InUse: inUse[e.ID], Job: jobs[e.ID]}
		if i, ok := inst[e.ID]; ok {
			r.Installed, r.Managed, r.Status = i.Version, i.Managed, "installed"
			if versionLess(i.Version, e.Version) {
				r.Status = "update"
			}
			r.AssetState = assetStates(i.Dir)
		}
		rows = append(rows, r)
		seen[e.ID] = true
	}
	for id, i := range inst { // installed, and not (or no longer) in the catalog
		if seen[id] {
			continue
		}
		r := moduleRow{Supported: true, Installed: i.Version, Managed: i.Managed, Status: "builtin", InUse: inUse[id], AssetState: assetStates(i.Dir)}
		if i.Managed {
			r.Status = "installed"
		}
		r.ID, r.Name, r.Version, r.Description, r.Author = id, i.Name, i.Version, i.Description, i.Author
		r.ComponentType = i.Type
		rows = append(rows, r)
	}
	for i := range rows {
		r := &rows[i]
		r.AssetsReady = true
		for _, a := range r.AssetState {
			r.AssetsNeed += a.Missing
		}
		r.AssetsReady = r.AssetsNeed == 0
	}
	sort.Slice(rows, func(a, b int) bool { return strings.ToLower(rows[a].Name) < strings.ToLower(rows[b].Name) })
	return map[string]any{"ok": true, "catalog": meta, "modules": rows, "pending": pending, "restarting": restarting}
}
