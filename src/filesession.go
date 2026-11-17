package main

// filesession.go: browsing a device's file parameter (docs/SAMPLES.md).
//
// The rules are the sound browser's (docs/PRESETS.md): hearing is not
// choosing. While the cursor rests on a file,
//
//   - it is HEARD: Pung plays the file itself through the device's output
//     (the preview: Push's own browser does the same), and
//   - where the module asks for it ("live_preview"), it is IN THE
//     INSTRUMENT: the parameter is set to it, so the pads play it with the
//     device's own settings.
//
// Load keeps the file. Every other way out puts back the file from before,
// and the parameters the module asked to be put back (its browser_hooks).

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// previewSeconds: how much of a file the preview plays. Long enough for a
// loop, short enough that a decode never makes the hands wait.
const previewSeconds = 30

// previewVoice: a file playing through a device's output. The realtime
// thread alone moves pos; everyone else may only ask it to stop.
type previewVoice struct {
	pcm  []float32 // interleaved stereo at the module's rate
	pos  int       // frames played
	stop atomic.Bool
}

// mixPreview adds the device's preview to a block (the realtime thread).
// A short fade at both ends: a file cut anywhere would click.
func (d *device) mixPreview(l, r []float32, n int) {
	v := d.preview.Load()
	if v == nil {
		return
	}
	const fade = 96
	total := len(v.pcm) / 2
	stopping := v.stop.Load()
	for i := 0; i < n; i++ {
		if v.pos >= total {
			break
		}
		g := float32(1)
		if v.pos < fade {
			g = float32(v.pos) / fade
		}
		if left := total - v.pos; left < fade {
			g *= float32(left) / fade
		}
		if stopping {
			g *= 1 - float32(i)/float32(n) // out within this block
		}
		l[i] += v.pcm[2*v.pos] * g
		r[i] += v.pcm[2*v.pos+1] * g
		v.pos++
	}
	d.previewFrames.Add(uint64(n))
	if stopping || v.pos >= total {
		d.preview.CompareAndSwap(v, nil)
	}
}

// stopPreview fades out whatever plays.
func (d *device) stopPreview() {
	if v := d.preview.Load(); v != nil {
		v.stop.Store(true)
	}
}

// playPreview plays a file through the device's output, replacing what
// plays. It decodes here: call it off the input thread.
func (d *device) playPreview(path string) error {
	pcm, err := decodePreview(path, moduleRate, previewSeconds)
	if err != nil || len(pcm) < 2 {
		d.stopPreview()
		if err == nil {
			err = errNotAudio
		}
		return err
	}
	if old := d.preview.Load(); old != nil {
		old.stop.Store(true)
		// let it fade for a block before the new one starts: two voices
		// never sum
		for i := 0; i < 20 && d.preview.Load() == old; i++ {
			time.Sleep(2 * time.Millisecond)
		}
	}
	d.preview.Store(&previewVoice{pcm: pcm})
	return nil
}

// previewing: a preview is sounding.
func (d *device) previewing() bool { return d.preview.Load() != nil }

// fileBrowse: one file parameter of one device, being browsed.
type fileBrowse struct {
	lib *fileLib
	d   *device
	key string // the parameter, without the component
	m   *paramMeta

	mu       sync.Mutex
	before   string      // the file when the browser opened
	applied  string      // the file the parameter holds now
	restores [][2]string // hook writes to put back: key, value from before
	gen      int         // a newer audition, a cancel: an older one in flight stops
	Preview  bool        // the preview plays (the user's switch)
	done     bool
}

func (fb *fileBrowse) full(k string) string {
	if strings.Contains(k, ":") {
		return k // already says its component
	}
	return fb.d.c.component() + ":" + k
}

func (fb *fileBrowse) get(k string) string {
	v, _ := fb.d.s.Get(fb.full(k))
	return v
}

// openFileBrowse starts browsing the device's parameter key.
func (lib *fileLib) openFileBrowse(d *device, key string, m *paramMeta) (*fileBrowse, error) {
	if m == nil || m.File == nil {
		return nil, errors.New("not a file parameter")
	}
	fb := &fileBrowse{lib: lib, d: d, key: key, m: m, Preview: lib.previewOn()}
	fb.before = strings.TrimSpace(fb.get(key))
	fb.applied = fb.before
	fb.hooks("on_open", fb.before)
	return fb, nil
}

// hooks runs the module's parameter writes for a moment of the browser.
func (fb *fileBrowse) hooks(when, path string) {
	for _, h := range fb.m.File.Hooks[when] {
		val := strings.NewReplacer("$selected_path", path, "$selected_filename", filepath.Base(path),
			"$path", path, "$filename", filepath.Base(path)).Replace(h.Value)
		if h.Restore {
			known := false
			for _, r := range fb.restores {
				known = known || r[0] == h.Key
			}
			if !known {
				fb.restores = append(fb.restores, [2]string{h.Key, fb.get(h.Key)})
			}
		}
		fb.d.s.Set(fb.full(h.Key), val)
	}
}

func (fb *fileBrowse) putBack() {
	for i := len(fb.restores) - 1; i >= 0; i-- {
		fb.d.s.Set(fb.full(fb.restores[i][0]), fb.restores[i][1])
	}
	fb.restores = nil
}

// audition: the cursor rests on a file. It is played, and put into the
// instrument where the module previews live. A file that would have to be
// converted first is only played: nothing is written for a look.
func (fb *fileBrowse) audition(path string) {
	fb.mu.Lock()
	if fb.done {
		fb.mu.Unlock()
		return
	}
	fb.gen++
	gen := fb.gen
	play := fb.Preview
	fb.mu.Unlock()
	spec := fb.m.File
	if play && isAudioExt(filepath.Ext(path)) {
		fb.d.playPreview(path) //nolint:errcheck // a file that does not play is still listed
	} else {
		fb.d.stopPreview()
	}
	if !spec.LivePreview || !spec.accepts(path) {
		return
	}
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if fb.done || gen != fb.gen || fb.applied == path {
		return
	}
	fb.d.s.Set(fb.full(fb.key), path)
	fb.applied = path
	fb.hooks("on_preview", path)
}

// rest: the cursor is on something that is no file (a folder): silence.
func (fb *fileBrowse) rest() {
	fb.mu.Lock()
	fb.gen++
	fb.mu.Unlock()
	fb.d.stopPreview()
}

// commit: Load. The file becomes the device's; one the module cannot read
// as it is, is converted first.
func (fb *fileBrowse) commit(path string) (string, error) {
	final, err := fb.lib.resolve(path, fb.m.File)
	if err != nil {
		return "", err
	}
	final = portablePath(final)
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if fb.done {
		return "", errors.New("the browser is closed")
	}
	fb.gen++
	fb.done = true
	fb.d.stopPreview()
	// through SetOutside: Live hears of what else it moved (a sampler sets
	// its end marker to the new file's length)
	fb.d.SetOutside(fb.full(fb.key), final)
	fb.applied = final
	fb.hooks("on_commit", final)
	fb.putBack()
	fb.lib.store.chose(fb.m.File.kind(), final)
	return final, nil
}

// cancel: every way out but Load. The file from before is back.
func (fb *fileBrowse) cancel() {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if fb.done {
		return
	}
	fb.gen++
	fb.done = true
	fb.d.stopPreview()
	if fb.applied != fb.before {
		fb.d.SetOutside(fb.full(fb.key), fb.before)
		fb.applied = fb.before
	}
	fb.hooks("on_cancel", fb.before)
	fb.putBack()
}

// compare: held, the file from before is in the instrument; let go, the
// auditioned one again.
func (fb *fileBrowse) compare(before bool, cursor string) {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if fb.done || !fb.m.File.LivePreview {
		return
	}
	want := cursor
	if before || !fb.m.File.accepts(cursor) {
		want = fb.before
	}
	if want != fb.applied {
		fb.d.s.Set(fb.full(fb.key), want)
		fb.applied = want
	}
}

// ---- the preview switch: one for every browser, kept ---------------------------------

func (lib *fileLib) previewOn() bool {
	lib.store.mu.Lock()
	defer lib.store.mu.Unlock()
	return !lib.store.PreviewOff
}

func (lib *fileLib) setPreview(on bool) {
	lib.store.mu.Lock()
	lib.store.PreviewOff = !on
	lib.store.save()
	lib.store.mu.Unlock()
}
