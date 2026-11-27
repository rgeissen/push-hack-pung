package main

// pushhack.go: Push Hack, installed unchanged from its own repository, at the
// release pung.live's install.json names (one tested with Pung): Push
// Manager, Push Hack Catalog, Push Display and the PushHack Remote Script, as
// the Push Hack Installer installs them (adapted, MIT, see NOTICE). Pung uses
// it today; the step goes when Pung no longer does.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"
)

type coreHack struct {
	id, binary string // binary: as hack.json's "binary" ("" none)
	initd      string // a service script of its own, in the repository ("" the generic one)
}

var coreHacks = []coreHack{
	{id: "push-manager", binary: "push-manager"},
	{id: "push-catalog", binary: "push-catalog"},
	{id: "push-display", binary: "push_hook.so", initd: "hacks/push-display/service.initd"},
}

const pushHackRepo = "federico-pepe/ableton-push-hack"

func rawURL(ref, rel string) string {
	return "https://raw.githubusercontent.com/" + pushHackRepo + "/" + ref + "/" + rel
}

func fetch(url string, limit int64) ([]byte, error) {
	c := &http.Client{Timeout: 90 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "pung-installer")
	r, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, fmt.Errorf("%s: HTTP %d", url, r.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, limit))
	if err == nil && len(b) == 0 {
		err = fmt.Errorf("%s: empty", url)
	}
	return b, err
}

// installPushHack: the three core hacks and the Remote Script, at ref
func installPushHack(ableton, root *client, ref string, say func(string)) error {
	ud := userDataDir(ableton)
	ph := ud + "/push-hack"
	if !ableton.ok(fmt.Sprintf("mkdir -p %s %s", shellQuote(ph+"/hacks"), shellQuote(ph+"/logs"))) {
		if _, err := root.run(fmt.Sprintf("mkdir -p %s %s && chown -R ableton:users %s", shellQuote(ph+"/hacks"), shellQuote(ph+"/logs"), shellQuote(ph))); err != nil {
			return err
		}
	}
	for _, h := range coreHacks {
		say("Push Hack: " + h.id)
		dir := ph + "/hacks/" + h.id
		bin, err := fetch(rawURL(ref, "hacks/"+h.id+"/"+h.binary), 64<<20)
		if err != nil {
			return fmt.Errorf("download %s: %w", h.id, err)
		}
		hj, err := fetch(rawURL(ref, "hacks/"+h.id+"/hack.json"), 1<<20)
		if err != nil {
			return fmt.Errorf("download %s: %w", h.id, err)
		}
		var initd []byte
		if h.initd != "" {
			if initd, err = fetch(rawURL(ref, h.initd), 1<<20); err != nil {
				return fmt.Errorf("download %s: %w", h.id, err)
			}
		}
		if _, err := ableton.run("mkdir -p " + shellQuote(dir)); err != nil {
			return err
		}
		root.ok("chown ableton:users " + shellQuote(dir))
		root.ok("/etc/init.d/push-hack-" + h.id + " stop")
		// a shared library the running Push software maps is replaced as root; the rest as ableton
		cp := ableton
		if strings.HasSuffix(h.binary, ".so") {
			cp = root
		}
		if err := cp.copyBytes(bin, dir+"/"+h.binary, 0o755); err != nil {
			return err
		}
		root.ok("chmod +x " + shellQuote(dir+"/"+h.binary))
		hj, err = rewriteHackJSON(hj, ud, ph, dir)
		if err != nil {
			return fmt.Errorf("%s hack.json: %w", h.id, err)
		}
		if err := ableton.copyBytes(hj, dir+"/hack.json", 0o644); err != nil {
			return err
		}
		svc := "push-hack-" + h.id
		var script []byte
		if initd != nil {
			s := string(initd)
			for k, v := range map[string]string{"{{HACK_ID}}": h.id, "{{SVC_NAME}}": svc, "{{HACK_DIR}}": dir, "{{LOG_DIR}}": ph + "/logs", "{{PORT}}": ""} {
				s = strings.ReplaceAll(s, k, v)
			}
			script = []byte(s)
		} else {
			script = []byte(initScript(svc, h.id, dir, h.binary, ph+"/logs/"+h.id+".log"))
		}
		if err := enableService(root, svc, script); err != nil {
			return fmt.Errorf("%s: %w", h.id, err)
		}
	}
	say("Push Hack: the Remote Script")
	return installRemoteScript(ableton, ud, ref)
}

// rewriteHackJSON: ${USER_DATA} filled in, and where the hack lives
func rewriteHackJSON(raw []byte, ud, ph, dir string) ([]byte, error) {
	var f map[string]json.RawMessage
	if err := json.Unmarshal([]byte(strings.ReplaceAll(string(raw), "${USER_DATA}", ud)), &f); err != nil {
		return nil, err
	}
	f["_push_hack_dir"], _ = json.Marshal(ph)
	f["_hack_dir"], _ = json.Marshal(dir)
	return json.MarshalIndent(f, "", "  ")
}

// enableService: an init.d script, started at boot, (re)started now
func enableService(root *client, svc string, script []byte) error {
	p := "/etc/init.d/" + svc
	if err := root.copyBytes(script, p, 0o755); err != nil {
		return err
	}
	root.ok("chmod +x " + shellQuote(p))
	root.ok(fmt.Sprintf(`if command -v update-rc.d >/dev/null 2>&1; then update-rc.d %[1]s defaults >/dev/null 2>&1 || true;
		else for n in 2 3 4 5; do ln -sf /etc/init.d/%[1]s /etc/rc$n.d/S99%[1]s 2>/dev/null || true; done; fi`, svc))
	root.ok(p + " stop")
	if _, err := root.run(p + " start"); err != nil {
		return fmt.Errorf("start the service: %w", err)
	}
	return nil
}

// initScript: Push Hack Catalog's own service script (push-catalog.sh,
// write_init_script), so a hack installed here is one the catalog manages:
// stop waits for the process to exit (5 s, then SIGKILL)
func initScript(svc, id, dir, bin, log string) string {
	return fmt.Sprintf(`#!/bin/sh
### BEGIN INIT INFO
# Provides:          %[1]s
# Required-Start:    $local_fs $network
# Required-Stop:     $local_fs
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: push-hack: %[2]s (via push-catalog)
### END INIT INFO
BIN="%[3]s/%[4]s"; CFG="%[3]s/hack.json"; LOG="%[5]s"; PIDF="${PIDF:-/var/run/%[1]s.pid}"
start() { echo "starting %[1]s"; mkdir -p "$(dirname "$LOG")"
  nice -n 19 "$BIN" -config "$CFG" >>"$LOG" 2>&1 &
  echo $! >"$PIDF"; }
stop()  { echo "stopping %[1]s"; [ -f "$PIDF" ] || return 0
  p="$(cat "$PIDF")"; kill "$p" 2>/dev/null; i=0
  while kill -0 "$p" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
  kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
  rm -f "$PIDF"; }
case "$1" in start) start;; stop) stop;; restart) stop; start;;
  status) [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && echo active || echo inactive;;
  *) echo "usage: $0 {start|stop|restart|status}"; exit 1;; esac
`, svc, id, dir, bin, log)
}

// installRemoteScript: the PushHack Remote Script into Live's User Library, at ref
func installRemoteScript(ableton *client, ud, ref string) error {
	lib := ud + "/Music/Ableton/User Library"
	if !ableton.ok("test -d " + shellQuote(lib)) {
		return fmt.Errorf("Live's User Library is not on the Push yet: start Live once, then install again")
	}
	tree, err := fetch("https://api.github.com/repos/"+pushHackRepo+"/git/trees/"+ref+"?recursive=1", 8<<20)
	if err != nil {
		return fmt.Errorf("the Remote Script's files: %w", err)
	}
	var t struct {
		Tree []struct{ Path, Type string } `json:"tree"`
	}
	if err := json.Unmarshal(tree, &t); err != nil {
		return err
	}
	const src = "remote-script/PushHack/"
	var rels []string
	for _, e := range t.Tree {
		if e.Type != "blob" || !strings.HasPrefix(e.Path, src) {
			continue
		}
		rel := strings.TrimPrefix(e.Path, src)
		base := path.Base(rel)
		if strings.Contains(rel, "__pycache__/") || strings.HasSuffix(base, ".pyc") || strings.HasPrefix(base, ".") ||
			strings.Contains(rel, "..") || path.Clean(rel) != rel {
			continue
		}
		rels = append(rels, rel)
	}
	sort.Strings(rels)
	files := map[string][]byte{}
	for _, rel := range rels {
		b, err := fetch(rawURL(ref, src+rel), 4<<20)
		if err != nil {
			return err
		}
		files[rel] = b
	}
	if len(files["__init__.py"]) == 0 || len(files["PushHack.py"]) == 0 {
		return fmt.Errorf("the Remote Script at %s is incomplete", ref)
	}
	dst := lib + "/Remote Scripts/PushHack"
	if _, err := ableton.run("mkdir -p " + shellQuote(path.Dir(dst)) + " && rm -rf " + shellQuote(dst)); err != nil {
		return err
	}
	dirs := map[string]bool{}
	for _, rel := range rels {
		for d := path.Dir(rel); d != "."; d = path.Dir(d) {
			dirs[d] = true
		}
	}
	mk := []string{shellQuote(dst)}
	for d := range dirs {
		mk = append(mk, shellQuote(dst+"/"+d))
	}
	if _, err := ableton.run("mkdir -p " + strings.Join(mk, " ")); err != nil {
		return err
	}
	for _, rel := range rels {
		if err := ableton.copyBytes(files[rel], dst+"/"+rel, 0o644); err != nil {
			return err
		}
	}
	return nil
}
