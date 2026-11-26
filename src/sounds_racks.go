package main

// sounds_racks.go: every user sound as a rack in Push's own browser
// (docs/PRESETS.md, phase 4): Presets/Instruments/Pung/<Module>/<Sound>.adg,
// beside the module's own rack, so a sound is found and loaded where every
// other preset is, without Pung's browser.
//
// A sound's rack is the module's rack (written by livedevice.WritePresets)
// with the device's state in it: Live keeps a VST3's state in <ProcessorState>,
// as upper-case hex, 40 bytes a line, and gives it to the plugin as it loads
// (measured on a rack Push saved, 2026-11-15). The state is what the plugin
// itself saves (devices.go, State): the chain with the module's state, and
// which sound it is.
//
// Pung owns only what it wrote: a module's sound folder lists its racks in
// .pung-racks, and only those are ever replaced or removed. A rack Live saves
// into Pung's folders (Push's Save puts it beside the rack it came from) is
// left alone, here and around WritePresets (keepForeignRacks).

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

const rackManifest = ".pung-racks"

type soundRacks struct {
	presets string // Live's User Library Presets folder
	classes []*sclass
	mu      sync.Mutex
}

func classRackPath(presets string, c *livedevice.Class) string {
	return filepath.Join(rackFolder(presets, "Pung", c), rackName(c.Name)+".adg")
}

func soundRackDir(presets string, c *livedevice.Class) string {
	return filepath.Join(rackFolder(presets, "Pung", c), rackName(c.Name))
}

// SyncRacks makes a module's sound folders hold one rack per user sound.
func (lib *soundLib) SyncRacks(module string) {
	r := lib.racks
	if r == nil || r.presets == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	list, err := lib.store.List(module)
	if err != nil {
		return
	}
	for _, c := range r.classes {
		if c.module != module || rackFolder(r.presets, "Pung", c.Class) == "" {
			continue
		}
		if err := lib.syncClassRacks(r.presets, c, list); err != nil {
			log.Printf("sounds: %s racks: %v", c.Name, err)
		}
	}
}

// SyncAllRacks: every module's, at start.
func (lib *soundLib) SyncAllRacks() {
	if lib.racks == nil {
		return
	}
	seen := map[string]bool{}
	for _, c := range lib.racks.classes {
		if !seen[c.module] {
			seen[c.module] = true
			lib.SyncRacks(c.module)
		}
	}
}

func (lib *soundLib) syncClassRacks(presets string, c *sclass, list []userSound) error {
	dir := soundRackDir(presets, c.Class)
	written := readManifest(dir)
	want := map[string]bool{}
	if len(list) > 0 {
		tmpl, err := readGzip(classRackPath(presets, c.Class))
		if err != nil {
			return err // the module's own rack is not there yet: next time
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		chownLike(dir, presets)
		for _, s := range list {
			state, _, err := lib.store.Read(c.module, s.Name)
			if err != nil {
				continue
			}
			file := rackName(s.Name) + ".adg"
			path := filepath.Join(dir, file)
			if !written[file] {
				if _, err := os.Stat(path); err == nil {
					continue // a rack of someone else's with this name: never ours to replace
				}
			}
			data, err := soundRack(tmpl, c, s.Name, state)
			if err != nil {
				return err
			}
			want[file] = true
			if old, err := os.ReadFile(path); err == nil && bytes.Equal(old, data) {
				continue
			}
			if err := writeRackAtomic(path, data); err != nil {
				return err
			}
			chownLike(path, presets)
		}
	}
	for file := range written {
		if !want[file] {
			os.Remove(filepath.Join(dir, file))
		}
	}
	if len(want) == 0 {
		os.Remove(filepath.Join(dir, rackManifest))
		os.Remove(dir) // only if empty: someone else's racks keep it
		return nil
	}
	return writeManifest(dir, want, presets)
}

// soundRack: the module's rack with the device state of this sound in it.
func soundRack(tmpl []byte, c *sclass, name, state string) ([]byte, error) {
	doc := map[string]any{"pung_device": 1, "midi_fx": 0, "out_ch": 0, "chain": soundChain(c, state),
		"sound": soundRef{Source: "user", Name: name}}
	js, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	blob := make([]byte, 4+len(js))
	binary.LittleEndian.PutUint32(blob, uint32(len(js)))
	copy(blob[4:], js)
	x := string(tmpl)
	at := strings.Index(x, "<ProcessorState />")
	if at < 0 {
		return nil, errNoProcessorState
	}
	ls := strings.LastIndex(x[:at], "\n") + 1
	indent := x[ls:at]
	var b strings.Builder
	b.WriteString("<ProcessorState>\n")
	h := strings.ToUpper(hex.EncodeToString(blob))
	for i := 0; i < len(h); i += 80 {
		b.WriteString(indent + "\t" + h[i:min(i+80, len(h))] + "\n")
	}
	b.WriteString(indent + "</ProcessorState>")
	x = x[:at] + b.String() + x[at+len("<ProcessorState />"):]
	// the plugin preset's name, just after: the sound's
	if n := strings.Index(x[at:], "<Name Value=\""); n >= 0 {
		s := at + n + len("<Name Value=\"")
		if e := strings.Index(x[s:], "\""); e >= 0 {
			x = x[:s] + xmlAttr(name) + x[s+e:]
		}
	}
	return gzipStable([]byte(x))
}

// soundChain: the chain document of a device of class c with this state.
func soundChain(c *sclass, state string) map[string]any {
	var st any
	if state != "" {
		var parsed any
		if json.Unmarshal([]byte(state), &parsed) == nil {
			st = parsed
		} else {
			st = state
		}
	}
	p := map[string]any{"custom_name": c.Name, "input": "both", "audio_fx": []any{}}
	cfg := map[string]any{}
	if st != nil {
		cfg["state"] = st
	}
	switch c.Kind {
	case livedevice.Effect:
		p["audio_fx"] = []any{map[string]any{"type": c.module, "params": cfg, "bypassed": 0}}
	case livedevice.MIDI:
		p["midi_fx"] = []any{map[string]any{"type": c.module, "params": cfg, "bypassed": 0}}
	default:
		p["synth"] = map[string]any{"module": c.module, "config": cfg, "bypassed": 0}
	}
	return p
}

type rackErr string

func (e rackErr) Error() string { return string(e) }

const errNoProcessorState = rackErr("the module's rack has no <ProcessorState />")

func xmlAttr(s string) string {
	return strings.NewReplacer("&", "&amp;", `"`, "&quot;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func readGzip(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	return io.ReadAll(z)
}

// gzipStable: no name, no time, so the same rack gives the same bytes.
func gzipStable(data []byte) ([]byte, error) {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	if _, err := w.Write(data); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func writeRackAtomic(path string, data []byte) error {
	tmp := filepath.Join(filepath.Dir(path), ".tmp-"+filepath.Base(path))
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// chownLike gives path the owner of ref (Live runs as ableton, Pung as root).
func chownLike(path, ref string) {
	if fi, err := os.Stat(ref); err == nil {
		if st, ok := fi.Sys().(*syscall.Stat_t); ok {
			os.Chown(path, int(st.Uid), int(st.Gid))
		}
	}
}

func readManifest(dir string) map[string]bool {
	out := map[string]bool{}
	raw, err := os.ReadFile(filepath.Join(dir, rackManifest))
	if err != nil {
		return out
	}
	var files []string
	json.Unmarshal(raw, &files) //nolint:errcheck // a damaged list owns nothing
	for _, f := range files {
		if f != "" && !strings.ContainsAny(f, `/\`) {
			out[f] = true
		}
	}
	return out
}

func writeManifest(dir string, files map[string]bool, ref string) error {
	var list []string
	for f := range files {
		list = append(list, f)
	}
	sort.Strings(list) // (the same racks give the same file)
	raw, _ := json.Marshal(list)
	path := filepath.Join(dir, rackManifest)
	if had, err := os.ReadFile(path); err == nil && bytes.Equal(had, raw) {
		return nil // as it is: a file written again in Live's library is one more for its indexer
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return err
	}
	chownLike(path, ref)
	return nil
}

// keepForeignRacks reads the racks in Pung's class folders that are not a
// class's (Push's Save puts a device preset beside the rack it came from),
// and gives them back after livedevice.WritePresets, which removes every
// .adg there that is not a class's own (core v0.6.0, presets.go).
func keepForeignRacks(presets string, classes []*livedevice.Class) func() {
	own := map[string]bool{}
	dirs := map[string]bool{}
	for _, c := range classes {
		dir := rackFolder(presets, "Pung", c)
		if dir == "" {
			continue
		}
		dirs[dir] = true
		own[filepath.Join(dir, rackName(c.Name)+".adg")] = true
	}
	type kept struct {
		path string
		data []byte
		mode os.FileMode
		uid  int
		gid  int
	}
	var keep []kept
	for dir := range dirs {
		ents, _ := os.ReadDir(dir)
		for _, e := range ents {
			p := filepath.Join(dir, e.Name())
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".adg") || own[p] {
				continue
			}
			data, err := os.ReadFile(p)
			fi, serr := os.Stat(p)
			if err != nil || serr != nil {
				continue
			}
			k := kept{path: p, data: data, mode: fi.Mode().Perm(), uid: -1, gid: -1}
			if st, ok := fi.Sys().(*syscall.Stat_t); ok {
				k.uid, k.gid = int(st.Uid), int(st.Gid)
			}
			keep = append(keep, k)
		}
	}
	return func() {
		for _, k := range keep {
			if _, err := os.Stat(k.path); err == nil {
				continue // still there
			}
			if err := os.WriteFile(k.path, k.data, k.mode); err != nil {
				log.Printf("sounds: could not give back %s: %v", k.path, err)
				continue
			}
			if k.uid >= 0 {
				os.Chown(k.path, k.uid, k.gid)
			}
			log.Printf("sounds: kept %s (a rack Live saved in Pung's folder)", filepath.Base(k.path))
		}
	}
}
