package main

// upstream.go: what Schwung offers, against what is published and staged.
// Schwung's catalogue lists the modules; each module's release.json (on its
// default branch) says its current version. A source override builds a
// module from another repository (rgeissen/schwung-je8086: JE-8086 with its
// front panel, not upstream yet).

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type schwungModule struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Author          string   `json:"author"`
	Description     string   `json:"description"`
	ComponentType   string   `json:"component_type"`
	Subcategory     string   `json:"subcategory"`
	GithubRepo      string   `json:"github_repo"`
	DefaultBranch   string   `json:"default_branch"`
	Requires        string   `json:"requires"`
	RequiresModules []string `json:"requires_modules"`
}

type override struct {
	Repo   string `json:"repo"`   // owner/name on GitHub
	Branch string `json:"branch"` // built at its head
	Why    string `json:"why"`
}

// upstreamRow: one module as the admin page shows it.
type upstreamRow struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Author    string `json:"author"`
	Repo      string `json:"repo"`
	Branch    string `json:"branch"`
	Override  bool   `json:"override"`
	Schwung   string `json:"schwung"` // the version upstream has
	Staged    string `json:"staged"`  // in the staging catalog
	Live      string `json:"live"`    // on the site
	Status    string `json:"status"`  // new update current staged withheld failed not-for-pung unknown
	Why       string `json:"why,omitempty"`
	Licence   string `json:"licence,omitempty"`
	BuiltAt   string `json:"built_at,omitempty"`
	LastError string `json:"last_error,omitempty"`
}

var pungKinds = map[string]bool{"sound_generator": true, "audio_fx": true, "midi_fx": true}

type upstream struct {
	s *server

	mu      sync.Mutex
	mods    []schwungModule
	raw     []byte // Schwung's catalogue as fetched (build-catalog.py reads it)
	vers    map[string]string
	checked time.Time
	err     string
}

func httpGet(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "pung-catalog")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s: %s", url, resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

// check reads Schwung's catalogue and every module's release.json.
func (u *upstream) check() error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	raw, err := httpGet(ctx, u.s.cfg.SchwungCatalog, 16<<20)
	if err != nil {
		u.fail(err)
		return err
	}
	var cat struct {
		Modules []schwungModule `json:"modules"`
	}
	if err := json.Unmarshal(raw, &cat); err != nil {
		u.fail(err)
		return err
	}
	vers := map[string]string{}
	var vmu sync.Mutex
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for _, m := range cat.Modules {
		if !pungKinds[m.ComponentType] {
			continue
		}
		repo, branch := u.s.sourceOf(m)
		wg.Add(1)
		go func(id, repo, branch string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			url := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/release.json", repo, branch)
			b, err := httpGet(ctx, url, 1<<20)
			if err != nil {
				return
			}
			var rel struct {
				Version string `json:"version"`
				Modules map[string]struct {
					Version string `json:"version"`
				} `json:"modules"`
			}
			if json.Unmarshal(b, &rel) != nil {
				return
			}
			v := rel.Version
			if mv, ok := rel.Modules[id]; ok && mv.Version != "" { // a repository of several modules
				v = mv.Version
			}
			vmu.Lock()
			vers[id] = strings.TrimPrefix(v, "v")
			vmu.Unlock()
		}(m.ID, repo, branch)
	}
	wg.Wait()
	u.mu.Lock()
	u.mods, u.raw, u.vers, u.checked, u.err = cat.Modules, raw, vers, time.Now(), ""
	u.mu.Unlock()
	os.WriteFile(filepath.Join(u.s.cfg.Data, "work", "schwung-module-catalog.json"), raw, 0o644) //nolint:errcheck
	return nil
}

func (u *upstream) fail(err error) {
	u.mu.Lock()
	u.err = err.Error()
	u.mu.Unlock()
}

// catalogEntries reads a catalog.json: id -> (version, licence).
func catalogEntries(path string) map[string][2]string {
	out := map[string][2]string{}
	raw, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	var c struct {
		Modules []struct {
			ID      string `json:"id"`
			Version string `json:"version"`
			License struct {
				SPDX string `json:"spdx"`
			} `json:"license"`
		} `json:"modules"`
	}
	json.Unmarshal(raw, &c) //nolint:errcheck
	for _, m := range c.Modules {
		out[m.ID] = [2]string{strings.TrimPrefix(m.Version, "v"), m.License.SPDX}
	}
	return out
}

// rows: every Schwung module Pung can run, with where it stands.
func (u *upstream) rows() []upstreamRow {
	u.mu.Lock()
	mods := append([]schwungModule(nil), u.mods...)
	vers := u.vers
	u.mu.Unlock()
	live := catalogEntries(filepath.Join(u.s.cfg.Site, "catalog.json"))
	staged := catalogEntries(u.s.stagingCatalog())
	withheld := u.s.withheld()
	results := u.s.builder.results()
	var out []upstreamRow
	for _, m := range mods {
		if !pungKinds[m.ComponentType] {
			continue
		}
		repo, branch := u.s.sourceOf(m)
		r := upstreamRow{ID: m.ID, Name: m.Name, Kind: m.ComponentType, Author: m.Author, Repo: repo, Branch: branch,
			Override: repo != m.GithubRepo, Schwung: vers[m.ID], Live: live[m.ID][0], Staged: staged[m.ID][0]}
		r.Licence = staged[m.ID][1]
		if r.Licence == "" {
			r.Licence = live[m.ID][1]
		}
		if res, ok := results[m.ID]; ok {
			r.BuiltAt = res.At.Format(time.RFC3339)
			if !res.OK {
				r.LastError = res.Why
			}
		}
		switch {
		case withheld[m.ID] != "" && r.Live == "":
			r.Status, r.Why = "withheld", withheld[m.ID]
		case r.LastError != "" && (r.Staged == "" || versionLess(r.Staged, r.Schwung)):
			r.Status, r.Why = "failed", r.LastError
		case r.Live == "" && r.Staged == "":
			r.Status = "new"
		case r.Schwung != "" && versionLess(maxVer(r.Live, r.Staged), r.Schwung):
			r.Status = "update"
		case r.Staged != "" && r.Staged != r.Live:
			r.Status = "staged"
		case r.Schwung == "":
			r.Status = "unknown"
			r.Why = "no release.json on " + branch
		default:
			r.Status = "current"
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func maxVer(a, b string) string {
	if versionLess(a, b) {
		return b
	}
	return a
}

// versionLess: a < b by numeric parts (1.10 > 1.9).
func versionLess(a, b string) bool {
	sp := func(s string) []string {
		return strings.FieldsFunc(strings.TrimPrefix(s, "v"), func(r rune) bool { return r == '.' || r == '-' })
	}
	pa, pb := sp(a), sp(b)
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

func (u *upstream) module(id string) (schwungModule, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	for _, m := range u.mods {
		if m.ID == id {
			return m, true
		}
	}
	return schwungModule{}, false
}

func (u *upstream) status() map[string]any {
	u.mu.Lock()
	defer u.mu.Unlock()
	m := map[string]any{"error": u.err, "modules": len(u.mods)}
	if !u.checked.IsZero() {
		m["checked"] = u.checked
	}
	return m
}
