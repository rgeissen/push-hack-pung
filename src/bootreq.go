package main

// bootreq.go: changes to Live's Preferences.cfg that must happen while Live
// is NOT running.
//
// Live reads its preferences once at start and writes them back when it
// quits, so a change made while Live runs is either ignored or overwritten.
// push-manager's VST3 switch solves that by killing Push3 (init.d push3
// stop), which loses the Set and any unsaved preference. Here a change is
// recorded as a request file, the Push restarts the way its own updater does
// (reboot.sh: SIGTERM, Live saves and quits), and the change is applied at
// boot by this service, which starts at S20, before Push3 at S21.
//
// The flag logic is push-manager's (hacks/push-manager/src/vst3scan): the
// last "\x0fVst3Preferences" marker, then 04 00 00 00, then the flag byte.

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"syscall"
	"time"
)

const (
	requestDir    = "/data/push-hack/data/schwung/requests"
	liveConfigDir = "/data/.config/Ableton"
	backupDir     = "/data/push-hack/backup"
)

var (
	vst3Marker = []byte("\x0fVst3Preferences")
	vst3Count  = []byte{4, 0, 0, 0}
	liveDirRe  = regexp.MustCompile(`^Live (\d+)\.(\d+)(?:\.(\d+))?(?:b(\d+))?$`)
)

// vst3Flag finds the scan flag; the same checks as push-manager's.
func vst3Flag(d []byte) (off int, on bool, err error) {
	i := bytes.LastIndex(d, vst3Marker)
	if i < 0 {
		return 0, false, errors.New("no Vst3Preferences in Preferences.cfg")
	}
	off = i + len(vst3Marker) + len(vst3Count)
	if off >= len(d) || !bytes.Equal(d[off-len(vst3Count):off], vst3Count) || d[off] > 1 {
		return 0, false, errors.New("unexpected Preferences.cfg layout")
	}
	return off, d[off] == 1, nil
}

// livePrefs: Preferences.cfg of the highest Live version (a release sorts
// above its betas), as push-manager picks it.
func livePrefs() (string, error) {
	ents, err := os.ReadDir(liveConfigDir)
	if err != nil {
		return "", err
	}
	best, bestV := "", [4]int{-1}
	for _, e := range ents {
		m := liveDirRe.FindStringSubmatch(e.Name())
		if m == nil || !e.IsDir() {
			continue
		}
		var v [4]int
		for i := 0; i < 4; i++ {
			v[i], _ = strconv.Atoi(m[i+1])
		}
		if m[4] == "" {
			v[3] = 1 << 30
		}
		p := filepath.Join(liveConfigDir, e.Name(), "Preferences.cfg")
		if _, err := os.Stat(p); err != nil {
			continue
		}
		less := false
		for i := range v {
			if v[i] != bestV[i] {
				less = bestV[i] < v[i]
				break
			}
		}
		if less {
			best, bestV = p, v
		}
	}
	if best == "" {
		return "", errors.New("no Live Preferences.cfg")
	}
	return best, nil
}

// applyBootRequests runs before Live starts. Every request is removed once it
// is applied, or once it fails, so a broken request cannot repeat every boot.
func applyBootRequests() {
	req := filepath.Join(requestDir, "vst3-scan-on")
	if _, err := os.Stat(req); err != nil {
		return
	}
	defer os.Remove(req)
	if err := setVst3Scan(true); err != nil {
		log.Printf("boot request vst3-scan-on: %v (Preferences.cfg unchanged)", err)
		return
	}
}

func setVst3Scan(want bool) error {
	path, err := livePrefs()
	if err != nil {
		return err
	}
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	d, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	off, on, err := vst3Flag(d)
	if err != nil {
		return err
	}
	if on == want {
		log.Printf("boot request: VST3 scanning is already %v in %s", want, path)
		return nil
	}
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return err
	}
	bak := filepath.Join(backupDir, "Preferences.cfg.schwung-"+time.Now().Format("20060102-150405"))
	if err := os.WriteFile(bak, d, 0o644); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	out := append([]byte(nil), d...)
	if want {
		out[off] = 1
	} else {
		out[off] = 0
	}
	tmp := path + ".schwung-tmp"
	if err := os.WriteFile(tmp, out, st.Mode().Perm()); err != nil {
		return err
	}
	if s, ok := st.Sys().(*syscall.Stat_t); ok {
		os.Chown(tmp, int(s.Uid), int(s.Gid))
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	if back, err := os.ReadFile(path); err != nil || !bytes.Equal(back, out) {
		os.WriteFile(path, d, st.Mode().Perm()) // put the old content back
		return errors.New("the written file did not read back the same; restored")
	}
	log.Printf("boot request: VST3 scanning is now %v in %s (backup %s)", want, path, bak)
	return nil
}
