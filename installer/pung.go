package main

// pung.go: Pung itself, as Push Hack Catalog installs a hack (push-catalog.sh,
// install_one), so the catalog sees it installed and can update or remove it:
// the release's package unpacked under push-hack/hacks/pung, its port kept
// (7720, the one pung.live's Modules page looks for, when free), owned by
// the hacks folder's owner, the catalog's own service script, started.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// release: a release.json, what Push Hack's store reads too
type release struct {
	Version     string `json:"version"`
	DownloadURL string `json:"download_url"`
	ReleasedAt  string `json:"released_at"`
}

// latestPung: the newest Pung, from pung.live, else from the copy on GitHub
func latestPung(m manifest) (release, error) {
	var last error
	for _, u := range []string{m.Pung.Release, m.Pung.Fallback} {
		if u == "" {
			continue
		}
		b, err := fetch(u, 1<<20)
		if err != nil {
			last = err
			continue
		}
		var r release
		if err := json.Unmarshal(b, &r); err != nil || r.Version == "" || r.DownloadURL == "" {
			last = fmt.Errorf("%s: not a release", u)
			continue
		}
		return r, nil
	}
	return release{}, last
}

// progressReader: counts what passed (the download's progress)
type progressReader struct {
	r    io.Reader
	done *atomic.Int64
}

func (p progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.done.Add(int64(n))
	return n, err
}

// installPung: rel onto the Push; done/total follow the download
func installPung(root *client, rel release, done, total *atomic.Int64, say func(string)) error {
	ud := userDataDir(root)
	hacks := ud + "/push-hack/hacks"
	dir := hacks + "/pung"
	if _, err := root.run(fmt.Sprintf("mkdir -p %s %s", shellQuote(hacks), shellQuote(ud+"/push-hack/logs"))); err != nil {
		return err
	}
	prev := 0
	if out, err := root.run(fmt.Sprintf(`python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("port",0))' %s 2>/dev/null`, shellQuote(dir+"/hack.json"))); err == nil {
		fmt.Sscan(strings.TrimSpace(out), &prev)
	}

	say(fmt.Sprintf("Downloading Pung %s", rel.Version))
	c := &http.Client{Timeout: 30 * time.Minute}
	req, _ := http.NewRequest("GET", rel.DownloadURL, nil)
	req.Header.Set("User-Agent", "pung-installer")
	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download: HTTP %d from %s", resp.StatusCode, rel.DownloadURL)
	}
	total.Store(resp.ContentLength)
	// Pung stops first: its files are replaced under it otherwise. Its data
	// (data/pung: sounds, ROMs, states) is not in the package and stays.
	root.ok("/etc/init.d/push-hack-pung stop")
	// unpacked as it arrives, into a fresh folder, then swapped in: a broken
	// download leaves the Pung that was there
	tmp := hacks + "/.pung-new"
	cmd := fmt.Sprintf("rm -rf %[1]s && mkdir -p %[1]s && tar -xzf - -C %[1]s && test -f %[1]s/pung/hack.json", shellQuote(tmp))
	if err := root.stream(cmd, progressReader{resp.Body, done}); err != nil {
		root.ok("rm -rf " + shellQuote(tmp))
		root.ok("test -x " + shellQuote(dir+"/pung") + " && /etc/init.d/push-hack-pung start")
		return fmt.Errorf("unpack on the Push: %w", err)
	}
	say("Putting Pung in place")
	// what the package carries replaces what was there; anything else in the
	// folder (a module a user added, built-in modules' state) is kept
	// A built-in module that the Modules page has since updated is a link into Pung's data (the
	// newer one, modmgr.go): copying over it would write the package's older files through the link,
	// into the module the player installed. Such a module is left as it is.
	keep := fmt.Sprintf(`cd %[2]s/pung && for d in modules/*/*; do [ -d "$d" ] && [ -L %[1]s/"$d" ] && rm -rf "$d"; done; true`, shellQuote(dir), shellQuote(tmp))
	if _, err := root.run(fmt.Sprintf("mkdir -p %[1]s && { %[3]s; } && cp -a %[2]s/pung/. %[1]s/ && rm -rf %[2]s", shellQuote(dir), shellQuote(tmp), keep)); err != nil {
		return err
	}
	port := choosePort(root, hacks, prev)
	if _, err := root.run(fmt.Sprintf(`python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["port"]=int(sys.argv[2]); json.dump(d, open(p,"w"), indent=2)' %s %d`,
		shellQuote(dir+"/hack.json"), port)); err != nil {
		return err
	}
	root.ok(fmt.Sprintf(`o=$(stat -c '%%u:%%g' %s) && chown -R "$o" %s`, shellQuote(hacks), shellQuote(dir)))
	say("Starting Pung")
	if err := enableService(root, "push-hack-pung", []byte(initScript("push-hack-pung", "pung", dir, "pung", ud+"/push-hack/logs/pung.log"))); err != nil {
		return err
	}
	// it answers when it is up
	for i := 0; i < 40; i++ {
		if root.ok(fmt.Sprintf("wget -q -T 2 -O /dev/null http://127.0.0.1:%d/api/status", port)) {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("Pung was installed but does not answer yet: see %s/push-hack/logs/pung.log on the Push", ud)
}

// choosePort: Pung's port as before; else 7720 (pung.live's Modules page
// looks there first); else the catalog's way, the first free from 7711
func choosePort(root *client, hacks string, prev int) int {
	used := map[int]bool{}
	out, _ := root.run(fmt.Sprintf(`python3 - %s <<'PY'
import json, glob, os, sys
for hj in glob.glob(os.path.join(sys.argv[1], "*", "hack.json")):
    if os.path.basename(os.path.dirname(hj)) == "pung":
        continue
    try:
        p = json.load(open(hj)).get("port")
        if isinstance(p, int): print(p)
    except Exception:
        pass
PY`, shellQuote(hacks)))
	for _, f := range strings.Fields(out) {
		var p int
		fmt.Sscan(f, &p)
		used[p] = true
	}
	if prev >= 7711 && !used[prev] {
		return prev
	}
	if !used[7720] {
		return 7720
	}
	p := 7711
	for used[p] {
		p++
	}
	return p
}

// restartLive: Live restarts once Pung is up again, and reopens the Set
// (Pung's own way: restart-live-after-start, CLAUDE.md "Ask first"); a new
// Pung's devices appear in Live only after Live started again
func restartLive(root *client) error {
	ud := userDataDir(root)
	if _, err := root.run(fmt.Sprintf("mkdir -p %[1]s && touch %[1]s/restart-live-after-start", shellQuote(ud+"/push-hack/data/pung"))); err != nil {
		return err
	}
	_, err := root.run("/etc/init.d/push-hack-pung restart")
	return err
}
