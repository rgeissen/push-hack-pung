// pungstub: Pung's devices in Live on a Mac, as placeholders (docs/PUNG-MACOS.md,
// the proof's first steps). It installs the plugin as Pung.vst3 with the classes
// of a Pung (a class file as a Push writes it: the same ids), and answers Live
// for every one of them: a device keeps the state Live hands it and gives it
// back, an instrument plays a sine for each note so that there is something to
// hear and to measure, an effect passes its input through. No module runs here.
//
//	pungstub -bin <the plugin binary> -classes <classes.json or classes-known.json>
//	         [-vst3 ~/Library/Audio/Plug-Ins/VST3] [-data "~/Library/Application Support/Pung"]
//	         [-http 127.0.0.1:7720]
package main

import (
	"encoding/json"
	"flag"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

type provider struct{}

func (provider) New(c *livedevice.Class) (livedevice.Device, error) {
	log.Printf("pungstub: Live made %q (%s, %s)", c.Name, c.Kind, c.UID)
	return &device{class: c, note: -1}, nil
}

type device struct {
	class *livedevice.Class
	mu    sync.Mutex
	state string
	// the sine an instrument plays
	note       int
	gate       bool
	phase, amp float64
}

func (d *device) Process(b *livedevice.Block) {
	if d.class.Kind == livedevice.Effect {
		copy(b.Out[0], b.In[0])
		copy(b.Out[1], b.In[1])
		return
	}
	b.Events(func(_ int, m []byte) {
		if len(m) < 3 {
			return
		}
		switch {
		case m[0]&0xF0 == 0x90 && m[2] > 0:
			d.note, d.gate = int(m[1]), true
		case m[0]&0xF0 == 0x80 || m[0]&0xF0 == 0x90:
			if int(m[1]) == d.note {
				d.gate = false
			}
		}
	})
	if d.note < 0 {
		return
	}
	step := 2 * math.Pi * 440 * math.Pow(2, float64(d.note-69)/12) / 44100
	for i := 0; i < b.Frames; i++ {
		if d.gate {
			d.amp += (0.25 - d.amp) * 0.01
		} else {
			d.amp *= 0.9995
		}
		v := float32(d.amp * math.Sin(d.phase))
		d.phase += step
		b.Out[0][i], b.Out[1][i] = v, v
	}
	if !d.gate && d.amp < 1e-5 {
		d.note, d.amp = -1, 0
	}
}

func (d *device) State() (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.state, nil
}

// SetState keeps what Live hands back (a Set opened, a rack loaded), and says
// what it holds: this is the text a Pung on a Push wrote.
func (d *device) SetState(st string) error {
	d.mu.Lock()
	d.state = st
	d.mu.Unlock()
	var doc struct {
		PungDevice int                   `json:"pung_device"`
		Sound      struct{ Name string } `json:"sound"`
		Chain      struct {
			Synth struct{ Module string } `json:"synth"`
		} `json:"chain"`
	}
	if json.Unmarshal([]byte(st), &doc) == nil && doc.PungDevice > 0 {
		log.Printf("pungstub: %q given a Pung state of %d bytes: module %q, sound %q", d.class.Name, len(st), doc.Chain.Synth.Module, doc.Sound.Name)
	} else {
		log.Printf("pungstub: %q given a state of %d bytes", d.class.Name, len(st))
	}
	return nil
}

func (d *device) Close() { log.Printf("pungstub: %q closed", d.class.Name) }

func main() {
	home, _ := os.UserHomeDir()
	bin := flag.String("bin", "", "the plugin binary (livedevice, built for macOS)")
	classFile := flag.String("classes", "", "the classes: a class file as a Pung writes it (classes.json), or its bare list (classes-known.json)")
	vst3 := flag.String("vst3", filepath.Join(home, "Library", "Audio", "Plug-Ins", "VST3"), "where the plugin goes")
	data := flag.String("data", filepath.Join(home, "Library", "Application Support", "Pung"), "Pung's folder")
	name := flag.String("name", "Pung", "the bundle's name")
	httpAddr := flag.String("http", "", "serve GET /api/devices here (host:port)")
	presets := flag.String("presets", "", "write the racks a Pung writes for Live's browser into this folder (as on a Push)")
	flag.Parse()
	if *bin == "" || *classFile == "" {
		log.Fatal("-bin and -classes are needed")
	}
	raw, err := os.ReadFile(*classFile)
	if err != nil {
		log.Fatal(err)
	}
	var cls []*livedevice.Class
	var file livedevice.ClassFile
	if json.Unmarshal(raw, &file) == nil && len(file.Classes) > 0 {
		cls = file.Classes
	} else if err := json.Unmarshal(raw, &cls); err != nil {
		log.Fatal("no classes in ", *classFile, ": ", err)
	}
	if err := os.MkdirAll(*data, 0o755); err != nil {
		log.Fatal(err)
	}
	// the class file outside the bundle: a signed bundle may not change
	cfg := livedevice.BundleConfig{Vendor: "Pung", URL: "https://pung.live", Socket: filepath.Join(*data, "devices.sock"), Classes: filepath.Join(*data, "classes.json")}
	binPath, cfg, changed, err := livedevice.InstallBundle(*vst3, *name, *bin, cfg)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := livedevice.WriteClasses(cfg.Classes, binPath, cls); err != nil {
		log.Fatal(err)
	}
	log.Printf("pungstub: %s with %d classes (changed: %v), socket %s", livedevice.BundleDir(*vst3, *name), len(cls), changed, cfg.Socket)
	if *presets != "" {
		n, err := livedevice.WritePresets(*presets, "Pung", cls)
		log.Printf("pungstub: racks in %s: %v %v", *presets, n, err)
	}
	srv := livedevice.NewServer(livedevice.Config{Name: "pung", Socket: cfg.Socket}, provider{}, cls)
	if err := srv.Listen(); err != nil {
		log.Fatal(err)
	}
	if *httpAddr != "" {
		go http.ListenAndServe(*httpAddr, srv.Handler()) //nolint:errcheck
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	srv.Close()
}
