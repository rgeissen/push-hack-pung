package main

// builder.go: builds one module at a time, with Pung's pipeline, into the
// staging catalog. Each job: Schwung's repository up to date (the headers
// modules compile against), the module's source at its release, the recipes
// read from the build scripts, the build (natively, this is x86_64), the
// package (ELF and entry checks, no dlopen: see package-push-modules.py),
// and the catalog entry with its licence and source (build-catalog.py).

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type buildResult struct {
	OK      bool      `json:"ok"`
	Why     string    `json:"why,omitempty"`
	At      time.Time `json:"at"`
	Version string    `json:"version,omitempty"`
	Seconds int       `json:"seconds"`
}

type job struct {
	ID      string    `json:"id"`
	Step    string    `json:"step"`
	Queued  time.Time `json:"queued"`
	Started time.Time `json:"started,omitempty"`
	Reason  string    `json:"reason"` // admin | nightly
}

type builder struct {
	s *server

	mu      sync.Mutex
	queue   []*job
	current *job
	res     map[string]buildResult
	wake    chan struct{}
}

func newBuilder(s *server) *builder {
	b := &builder{s: s, res: map[string]buildResult{}, wake: make(chan struct{}, 1)}
	if raw, err := os.ReadFile(b.path("results.json")); err == nil {
		json.Unmarshal(raw, &b.res) //nolint:errcheck
	}
	return b
}

func (b *builder) path(p ...string) string {
	return filepath.Join(append([]string{b.s.cfg.Data, "work"}, p...)...)
}

func (b *builder) results() map[string]buildResult {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := map[string]buildResult{}
	for k, v := range b.res {
		out[k] = v
	}
	return out
}

func (b *builder) enqueue(id, reason string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.current != nil && b.current.ID == id {
		return false
	}
	for _, j := range b.queue {
		if j.ID == id {
			return false
		}
	}
	b.queue = append(b.queue, &job{ID: id, Step: "queued", Queued: time.Now(), Reason: reason})
	select {
	case b.wake <- struct{}{}:
	default:
	}
	return true
}

func (b *builder) cancel(id string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	for i, j := range b.queue {
		if j.ID == id {
			b.queue = append(b.queue[:i], b.queue[i+1:]...)
			return true
		}
	}
	return false
}

func (b *builder) state() map[string]any {
	b.mu.Lock()
	defer b.mu.Unlock()
	q := make([]job, 0, len(b.queue))
	for _, j := range b.queue {
		q = append(q, *j)
	}
	var cur any
	if b.current != nil {
		c := *b.current
		cur = c
	}
	return map[string]any{"current": cur, "queue": q}
}

func (b *builder) setStep(step string) {
	b.mu.Lock()
	if b.current != nil {
		b.current.Step = step
	}
	b.mu.Unlock()
}

func (b *builder) run() {
	for {
		b.mu.Lock()
		if len(b.queue) == 0 {
			b.mu.Unlock()
			<-b.wake
			continue
		}
		j := b.queue[0]
		b.queue = b.queue[1:]
		j.Started = time.Now()
		b.current = j
		b.mu.Unlock()

		res := b.build(j.ID)
		res.At, res.Seconds = time.Now(), int(time.Since(j.Started).Seconds())
		b.mu.Lock()
		b.res[j.ID] = res
		b.current = nil
		raw, _ := json.MarshalIndent(b.res, "", " ")
		b.mu.Unlock()
		writeAtomic(b.path("results.json"), raw)
		log.Printf("pung-catalog: %s: ok=%v %s (%ds)", j.ID, res.OK, res.Why, res.Seconds)
	}
}

// joblog: a job's own log (every step's output), beside the build's.
func (b *builder) joblog(id string) (io.WriteCloser, error) {
	os.MkdirAll(b.path("jobs"), 0o755) //nolint:errcheck
	return os.Create(b.path("jobs", id+".log"))
}

func (b *builder) build(id string) buildResult {
	jl, err := b.joblog(id)
	if err != nil {
		return buildResult{Why: err.Error()}
	}
	defer jl.Close()
	say := func(f string, a ...any) { fmt.Fprintf(jl, "== "+f+"\n", a...) }
	run := func(step string, timeout time.Duration, env []string, name string, args ...string) error {
		b.setStep(step)
		say("%s: %s %s", step, name, strings.Join(args, " "))
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		cmd := b.gentle(ctx, env, name, args...)
		cmd.Stdout, cmd.Stderr = jl, jl
		return cmd.Run()
	}

	m, ok := b.s.up.module(id)
	if !ok {
		return buildResult{Why: "not in Schwung's catalogue (check upstream first)"}
	}
	if !pungKinds[m.ComponentType] {
		return buildResult{Why: "a Move " + m.ComponentType + ": Pung runs instruments and effects"}
	}
	schwung := filepath.Join(b.s.cfg.Data, "schwung")

	// 1. Schwung: its catalogue and the host headers modules compile against
	if err := gitSync(schwung, b.s.cfg.SchwungRepo, "main", "", jl, run); err != nil {
		return buildResult{Why: "Schwung's repository: " + err.Error()}
	}

	// 2. the module's source, at its release tag if it has one
	repo, branch := b.s.sourceOf(m)
	src := b.path("modsrc", filepath.Base(repo))
	b.s.up.mu.Lock()
	ver := b.s.up.vers[id]
	b.s.up.mu.Unlock()
	tag := ""
	if ver != "" {
		tag = remoteTag("https://github.com/"+repo+".git", "v"+ver)
	}
	if err := gitSync(src, "https://github.com/"+repo+".git", branch, tag, jl, run); err != nil {
		return buildResult{Why: "fetching " + repo + ": " + err.Error()}
	}
	say("source: %s %s", repo, firstNonEmpty(tag, branch))

	// 3. recipes: read from each module's build script, never run
	if err := run("recipes", 5*time.Minute, nil, "python3", filepath.Join(b.s.cfg.App, "scripts", "gen-recipes.py"),
		filepath.Join(schwung, "module-catalog.json"), b.path("modsrc"), b.path("recipes")); err != nil {
		return buildResult{Why: "writing the recipe: " + err.Error()}
	}

	// a repository that publishes releases and no source cannot be built
	// from source: held back, not failed (it would fail every night)
	if why := recipeSkip(b.path("recipes", "index.json"), id); why != "" {
		b.s.setWithheld(id, why)
		return buildResult{Why: "withheld: " + why}
	}

	// 4. build (a big emulator takes hours on this CPU)
	if err := run("building", 8*time.Hour, []string{"JOBS=1", "RECIPE_TIMEOUT=25200"}, "bash",
		filepath.Join(b.s.cfg.App, "scripts", "build-all.sh"), id); err != nil {
		say("build-all: %v", err)
	}
	if !b.builtOK(id) {
		return buildResult{Why: "the build failed: " + lastErrorLine(b.path("push-modules", "logs", id+".log"))}
	}
	// the release's version, as the author's own release stamps it into the
	// tarball it publishes: a module.json in the source can lag behind
	// (Tape Echo 2 v1.4.5 says 1.4.3), and a Push would then offer the
	// same update forever
	if ver != "" {
		if old, err := stampVersion(b.path("push-modules", "modules"), id, ver); err != nil {
			say("version: %v", err)
		} else if old != ver {
			say("version: module.json said %s, the release is %s: stamped", old, ver)
		}
	}

	// 5. package and check
	if err := run("packaging", 30*time.Minute, []string{"PUNG_LOADTEST=static", "PUNG_RECIPES_INDEX=" + b.path("recipes", "index.json")},
		"python3", filepath.Join(b.s.cfg.App, "scripts", "package-push-modules.py"),
		filepath.Join(schwung, "module-catalog.json"), b.path("modsrc"), b.path("push-modules")); err != nil {
		return buildResult{Why: "packaging: " + err.Error()}
	}
	idx := catalogEntries(b.path("push-modules", "index.json"))
	if _, ok := idx[id]; !ok {
		return buildResult{Why: "its package did not pass the checks: " + reportLine(b.path("push-modules", "REPORT.md"), id)}
	}

	// 6. into the staging catalog, with its licence and source
	b.s.seedStaging()
	out := &bytes.Buffer{}
	b.setStep("staging")
	cmd := b.gentle(context.Background(), []string{"PUNG_WORK=" + b.path(), "PUNG_SCHWUNG=" + schwung},
		"python3", filepath.Join(b.s.cfg.App, "scripts", "build-catalog.py"),
		"--out", filepath.Dir(b.s.stagingCatalog()), "--base-url", b.s.cfg.BaseURL, id)
	cmd.Stdout, cmd.Stderr = io.MultiWriter(jl, out), io.MultiWriter(jl, out)
	if err := cmd.Run(); err != nil {
		return buildResult{Why: "staging: " + err.Error()}
	}
	if m := regexp.MustCompile(`withheld ` + regexp.QuoteMeta(id) + `: (.*)`).FindStringSubmatch(out.String()); m != nil {
		b.s.setWithheld(id, m[1])
		return buildResult{Why: "withheld: " + m[1]}
	}
	b.s.setWithheld(id, "")
	staged := catalogEntries(b.s.stagingCatalog())
	return buildResult{OK: true, Version: staged[id][0]}
}

// gentle: a build step as the DiskStation's last priority. It shares the box
// with Home Assistant and the rest, and a build is never in a hurry: the
// lowest CPU priority, the idle I/O class, and at most BuildJobs compiles at
// once (the recipes read BUILD_JOBS; make and CMake read their own
// variables). Unthrottled, the Osirus build held the load average near 15 on
// four threads.
func (b *builder) gentle(ctx context.Context, env []string, name string, args ...string) *exec.Cmd {
	jobs := strconv.Itoa(b.s.cfg.BuildJobs)
	env = append([]string{"BUILD_JOBS=" + jobs, "MAKEFLAGS=-j" + jobs, "CMAKE_BUILD_PARALLEL_LEVEL=" + jobs}, env...)
	argv := append([]string{name}, args...)
	if p, err := exec.LookPath("ionice"); err == nil {
		argv = append([]string{p, "-c3"}, argv...)
	}
	if p, err := exec.LookPath("nice"); err == nil {
		argv = append([]string{p, "-n", "19"}, argv...)
	}
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(), env...)
	return cmd
}

func (b *builder) builtOK(id string) bool {
	raw, _ := os.ReadFile(b.path("push-modules", "logs", "status.tsv"))
	for _, l := range strings.Split(string(raw), "\n") {
		f := strings.Split(l, "\t")
		if len(f) >= 2 && f[0] == id {
			return f[1] == "ok"
		}
	}
	return false
}

// gitSync: dir holds url at tag (else branch's head), submodules included.
func gitSync(dir, url, branch, tag string, jl io.Writer, run func(string, time.Duration, []string, string, ...string) error) error {
	ref := firstNonEmpty(tag, branch)
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		os.RemoveAll(dir)
		args := []string{"clone", "-q", "--depth", "1", "--recurse-submodules", "--shallow-submodules", "-b", ref, url, dir}
		return run("fetching", 30*time.Minute, nil, "git", args...)
	}
	steps := [][]string{
		{"-C", dir, "remote", "set-url", "origin", url},
		{"-C", dir, "fetch", "-q", "--depth", "1", "origin", ref},
		{"-C", dir, "reset", "-q", "--hard", "FETCH_HEAD"},
		{"-C", dir, "clean", "-q", "-fdx", "-e", "build", "-e", "dist"},
		{"-C", dir, "submodule", "update", "-q", "--init", "--recursive", "--depth", "1"},
	}
	for _, s := range steps {
		if err := run("fetching", 30*time.Minute, nil, "git", s...); err != nil {
			return err
		}
	}
	return nil
}

// remoteTag: tag if the repository has it.
func remoteTag(url, tag string) string {
	out, err := exec.Command("git", "ls-remote", "--tags", url, "refs/tags/"+tag).Output()
	if err == nil && strings.Contains(string(out), "refs/tags/"+tag) {
		return tag
	}
	return ""
}

func firstNonEmpty(a ...string) string {
	for _, s := range a {
		if s != "" {
			return s
		}
	}
	return ""
}

func lastErrorLine(path string) string {
	raw, _ := os.ReadFile(path)
	lines := strings.Split(string(raw), "\n")
	re := regexp.MustCompile(`(?i)error|no such file|not found|undefined reference`)
	for i := len(lines) - 1; i >= 0; i-- {
		if re.MatchString(lines[i]) {
			return truncate(strings.TrimSpace(lines[i]), 240)
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.TrimSpace(lines[i]) != "" {
			return truncate(strings.TrimSpace(lines[i]), 240)
		}
	}
	return "see its log"
}

func reportLine(path, id string) string {
	raw, _ := os.ReadFile(path)
	for _, l := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(l, "| "+id+" |") {
			return truncate(strings.Trim(strings.TrimPrefix(l, "| "+id+" |"), " |`"), 240)
		}
	}
	return "see its log"
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// logTail: the last n bytes of a job's log, or of its build log.
func (b *builder) logTail(id string, which string, n int64) string {
	p := b.path("jobs", id+".log")
	if which == "build" {
		p = b.path("push-modules", "logs", id+".log")
	}
	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()
	st, _ := f.Stat()
	if st.Size() > n {
		f.Seek(st.Size()-n, io.SeekStart) //nolint:errcheck
	}
	raw, _ := io.ReadAll(f)
	return string(raw)
}

// stampVersion sets the version in a built module's module.json; the one it had.
func stampVersion(tree, id, ver string) (string, error) {
	matches, _ := filepath.Glob(filepath.Join(tree, "*", id, "module.json"))
	if len(matches) == 0 {
		return "", fmt.Errorf("no module.json for %s", id)
	}
	raw, err := os.ReadFile(matches[0])
	if err != nil {
		return "", err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", err
	}
	old, _ := m["version"].(string)
	if old == ver {
		return old, nil
	}
	m["version"] = ver
	out, _ := json.MarshalIndent(m, "", "  ")
	return old, os.WriteFile(matches[0], append(out, '\n'), 0o644)
}

// recipeSkip: why gen-recipes.py wrote no recipe for a module, if it did not.
func recipeSkip(index, id string) string {
	raw, err := os.ReadFile(index)
	if err != nil {
		return ""
	}
	var list []struct {
		ID, Status, Why string
	}
	json.Unmarshal(raw, &list) //nolint:errcheck
	for _, r := range list {
		if r.ID == id && r.Status == "skip" {
			return firstNonEmpty(r.Why, "no recipe")
		}
	}
	return ""
}
