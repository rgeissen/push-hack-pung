package main

// publish.go: the staging catalog becomes the public one. Packages and
// sources first, each checked against the catalog's checksum (or size, for a
// source archive) once it is in place; then the site's own files; then
// catalog.json, by an atomic rename. The catalog it replaces is kept in
// /data/history, so a publish can be undone; the files the last ten name
// stay on the site.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type pubEntry struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Asset   string `json:"asset"`
	SHA256  string `json:"sha256"`
	Source  struct {
		Archive     string `json:"archive"`
		ArchiveSize int64  `json:"archive_size"`
	} `json:"source"`
}

func readCatalog(path string) ([]pubEntry, []byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	var c struct {
		Modules []pubEntry `json:"modules"`
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, nil, err
	}
	return c.Modules, raw, nil
}

func fileSHA(p string) string {
	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	io.Copy(h, f) //nolint:errcheck
	return hex.EncodeToString(h.Sum(nil))
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	os.MkdirAll(filepath.Dir(dst), 0o755) //nolint:errcheck
	tmp := filepath.Join(filepath.Dir(dst), "."+filepath.Base(dst)+".tmp")
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	os.Chmod(tmp, 0o644) //nolint:errcheck
	return os.Rename(tmp, dst)
}

func writeAtomic(p string, raw []byte) error {
	os.MkdirAll(filepath.Dir(p), 0o755) //nolint:errcheck
	tmp := filepath.Join(filepath.Dir(p), "."+filepath.Base(p)+".tmp")
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// diff: what publishing the staging catalog changes on the site.
func (s *server) diff() map[string]any {
	live, _, _ := readCatalog(filepath.Join(s.cfg.Site, "catalog.json"))
	staged, _, err := readCatalog(s.stagingCatalog())
	if err != nil {
		return map[string]any{"added": []any{}, "updated": []any{}, "removed": []any{}}
	}
	lv := map[string]pubEntry{}
	for _, e := range live {
		lv[e.ID] = e
	}
	type ch struct {
		ID, Name, From, To string
	}
	var added, updated, removed []ch
	seen := map[string]bool{}
	for _, e := range staged {
		seen[e.ID] = true
		old, ok := lv[e.ID]
		switch {
		case !ok:
			added = append(added, ch{e.ID, e.Name, "", e.Version})
		case old.SHA256 != e.SHA256:
			updated = append(updated, ch{e.ID, e.Name, old.Version, e.Version})
		}
	}
	for _, e := range live {
		if !seen[e.ID] {
			removed = append(removed, ch{e.ID, e.Name, e.Version, ""})
		}
	}
	return map[string]any{"added": orEmpty(added), "updated": orEmpty(updated), "removed": orEmpty(removed)}
}

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func (s *server) publish() (string, error) {
	s.pubMu.Lock()
	defer s.pubMu.Unlock()
	staging := s.stagingCatalog()
	entries, raw, err := readCatalog(staging)
	if err != nil {
		return "", fmt.Errorf("no staging catalog: %v", err)
	}
	sdir := filepath.Dir(staging)
	for _, e := range entries {
		// the package: the catalog's bytes, or nothing is published
		dst := filepath.Join(s.cfg.Site, e.Asset)
		if fileSHA(dst) != e.SHA256 {
			src := filepath.Join(sdir, e.Asset)
			if err := copyFile(src, dst); err != nil {
				return "", fmt.Errorf("%s: %v", e.ID, err)
			}
			if fileSHA(dst) != e.SHA256 {
				return "", fmt.Errorf("%s: the package on the site is not the one the catalog names", e.ID)
			}
		}
		if e.Source.Archive != "" {
			dst := filepath.Join(s.cfg.Site, e.Source.Archive)
			if st, err := os.Stat(dst); err != nil || st.Size() != e.Source.ArchiveSize {
				if err := copyFile(filepath.Join(sdir, e.Source.Archive), dst); err != nil {
					return "", fmt.Errorf("%s: its source: %v", e.ID, err)
				}
			}
		}
	}
	for _, f := range []string{"index.html", "site.css", "site.js"} {
		if err := copyFile(filepath.Join(s.cfg.App, "scripts", "catalog-site", f), filepath.Join(s.cfg.Site, f)); err != nil {
			return "", err
		}
	}
	// keep what is replaced, then replace it
	livePath := filepath.Join(s.cfg.Site, "catalog.json")
	stamp := time.Now().UTC().Format("20060102-150405")
	if old, err := os.ReadFile(livePath); err == nil {
		writeAtomic(filepath.Join(s.cfg.Data, "history", stamp+".json"), old) //nolint:errcheck
	}
	if err := writeAtomic(livePath, raw); err != nil {
		return "", err
	}
	s.prune()
	return stamp, nil
}

// restore: an earlier catalog is the public one again (its files are kept).
func (s *server) restore(name string) error {
	s.pubMu.Lock()
	defer s.pubMu.Unlock()
	name = filepath.Base(name)
	p := filepath.Join(s.cfg.Data, "history", name)
	entries, raw, err := readCatalog(p)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if fileSHA(filepath.Join(s.cfg.Site, e.Asset)) != e.SHA256 {
			return fmt.Errorf("%s's package from then is no longer on the site", e.ID)
		}
	}
	livePath := filepath.Join(s.cfg.Site, "catalog.json")
	if old, err := os.ReadFile(livePath); err == nil {
		writeAtomic(filepath.Join(s.cfg.Data, "history", time.Now().UTC().Format("20060102-150405")+".json"), old) //nolint:errcheck
	}
	if err := writeAtomic(livePath, raw); err != nil {
		return err
	}
	return writeAtomic(s.stagingCatalog(), raw) // staging starts from what is live
}

type histItem struct {
	Name    string `json:"name"`
	Modules int    `json:"modules"`
	At      string `json:"at"`
}

func (s *server) history() []histItem {
	ents, _ := os.ReadDir(filepath.Join(s.cfg.Data, "history"))
	var out []histItem
	for _, e := range ents {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		mods, _, err := readCatalog(filepath.Join(s.cfg.Data, "history", e.Name()))
		if err != nil {
			continue
		}
		at := strings.TrimSuffix(e.Name(), ".json")
		if t, err := time.Parse("20060102-150405", at); err == nil {
			at = t.Format(time.RFC3339)
		}
		out = append(out, histItem{Name: e.Name(), Modules: len(mods), At: at})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

// prune: files on the site that neither the live catalog, the staging one,
// nor the last ten published name.
func (s *server) prune() {
	keep := map[string]bool{}
	add := func(p string) {
		es, _, err := readCatalog(p)
		if err != nil {
			return
		}
		for _, e := range es {
			keep[e.Asset] = true
			keep[e.Source.Archive] = true
		}
	}
	add(filepath.Join(s.cfg.Site, "catalog.json"))
	add(s.stagingCatalog())
	for i, h := range s.history() {
		if i >= 10 {
			break
		}
		add(filepath.Join(s.cfg.Data, "history", h.Name))
	}
	if len(keep) < 2 {
		return // something is wrong: delete nothing
	}
	for _, d := range []string{"modules", "source"} {
		ents, _ := os.ReadDir(filepath.Join(s.cfg.Site, d))
		for _, e := range ents {
			if rel := d + "/" + e.Name(); !keep[rel] && !strings.HasPrefix(e.Name(), ".") {
				os.Remove(filepath.Join(s.cfg.Site, rel))
			}
		}
	}
}
