// Pung for Push 3: runs Schwung modules (Ableton Move's module ecosystem)
// on Push 3 Standalone. One slot = one Pung signal chain = one Live track.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/alsaseq"
	"github.com/federico-pepe/ableton-push-hack/core/audiobus"
	"github.com/federico-pepe/ableton-push-hack/core/hackcfg"
	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

var buildVersion = "dev"

func main() {
	exe, _ := os.Executable()
	base := filepath.Dir(exe)
	modules := flag.String("modules", filepath.Join(base, "modules"), "Schwung module tree")
	data := flag.String("data", "/data/push-hack/data/pung", "slot state")
	nslots := flag.Int("slots", 0, "version 1 tracks to open at start (0: Pung devices in Live only)")
	vst3 := flag.String("vst3-dir", livedevice.VST3Dir, "where Live looks for VST3 plugins: Pung.vst3 goes here")
	presets := flag.String("presets", livedevice.UserPresets, "Live's User Library presets: the browser entries go here (empty: none)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	config := flag.String("config", "", "hack.json (push-catalog's service passes it)")
	bootRequests := flag.Bool("boot-requests", false, "apply pending Live preference changes, then exit (run at boot, before Live)")
	writeClassesTo := flag.String("write-classes", "", "write the device classes to this file and exit (tests, packaging)")
	probeModule := flag.String("probe-module", "", "probe this one module and exit (the start's crash screen, screen.go)")
	probeOut := flag.String("probe-out", "", "with -probe-module: write its metadata here")
	socket := flag.String("socket", "/data/push-hack/data/pung/devices.sock", "the device control socket")
	flag.Parse()
	if *showVersion {
		fmt.Println(buildVersion)
		return
	}
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	if *bootRequests {
		applyBootRequests()
		return
	}

	cfgPath := *config
	if cfgPath == "" {
		cfgPath = filepath.Join(base, "hack.json")
	}
	cfg, err := hackcfg.Load(cfgPath, 7720)
	if err != nil {
		log.Printf("hack.json: %v (port %d)", err, cfg.Port)
	}
	if *nslots < 0 || *nslots > 16 {
		log.Fatalf("-slots must be 0..16")
	}
	if err := os.MkdirAll(*data, 0o755); err != nil {
		log.Fatalf("data dir: %v", err)
	}

	if *probeModule == "" {
		ensureMovePungLink(base)
	}
	if err := engineInit(filepath.Join(*modules, "chain")); err != nil {
		log.Fatalf("chain host: %v", err)
	}
	h := newHost(*modules, *data, audiobus.SocketPath(audiobus.DefaultDir))
	if *probeModule != "" {
		probeModuleMain(h, *probeModule, *probeOut)
		return
	}
	if *writeClassesTo != "" {
		classes := coreClasses(h.buildClasses())
		if _, err := livedevice.WriteClasses(*writeClassesTo, "", classes); err != nil {
			log.Fatal(err)
		}
		log.Printf("%d classes written to %s", len(classes), *writeClassesTo)
		return
	}

	// the HTTP API comes up at once; ALSA waits for the USB-A port to settle
	mux := http.NewServeMux()
	h.routes(mux)
	h.webRoutes(mux)
	srv := &http.Server{Addr: fmt.Sprintf(":%d", cfg.Port), Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		log.Fatalf("http: %v", err)
	}
	// a module's forked child must not keep this port (bridge.c)
	if rc, err := ln.(*net.TCPListener).SyscallConn(); err == nil {
		rc.Control(func(fd uintptr) { cCloseInChildren(int(fd)) }) //nolint:errcheck
	}
	go func() {
		log.Printf("http on :%d", cfg.Port)
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	alsaseq.WaitForBootSettle()
	if err := h.openPort(); err != nil {
		log.Printf("midi: %v (slots play, but Live cannot reach them)", err)
	}
	for i := 0; i < *nslots; i++ {
		s, err := h.openSlot(i)
		if err != nil {
			log.Printf("slot %d: %v", i+1, err)
			continue
		}
		if err := h.restore(s); err != nil {
			log.Printf("%s: restore: %v", s.Name, err)
		}
		s.dirty.Store(false)
	}

	// DESIGN-v2: every Pung device in Live is a chain instance here, on
	// push-hack's Live device layer (core/livedevice)
	sclasses := h.buildClasses()
	classes := coreClasses(sclasses)
	// The class file lives in the bundle (livedevice.ClassesPath): if the hack
	// is removed, Sets that use its devices still open. hack.json's
	// "live_devices" lets push-catalog remove the browser entries with it.
	// Pung.vst3: Pung's plugins in Live, Pung's browser folders. (The rename
	// from Schwung, 2026-11-15, gave the classes new UIDs: devices.go.)
	bcfg := livedevice.BundleConfig{Vendor: "Pung", URL: "https://github.com/federico-pepe/ableton-push-hack", Socket: *socket}
	if *presets != "" {
		bcfg.Presets = livedevice.PresetFolders(*presets, "Pung", classes)
	}
	so, bcfg, _, err := livedevice.InstallBundle(*vst3, "Pung", filepath.Join(base, "livedevice.so"), bcfg)
	if err != nil {
		log.Printf("devices: plugin: %v (Live keeps the one it has)", err)
		bcfg.Classes = livedevice.ClassesPath(*vst3, "Pung")
	}
	if _, err := livedevice.WriteClasses(bcfg.Classes, so, classes); err != nil {
		log.Printf("devices: %v", err)
	}
	if *presets != "" {
		if n, err := livedevice.WritePresets(*presets, "Pung", classes); err != nil {
			log.Printf("devices: browser entries: %v", err)
		} else if n > 0 {
			log.Printf("devices: %d browser entries written", n)
		}
	}
	h.prov = newProvider(h, sclasses)
	devs := livedevice.NewServer(livedevice.Config{Name: "pung", Socket: *socket}, h.prov, classes)
	mux.Handle("GET /api/devices", devs.Handler())
	if err := devs.Listen(); err != nil {
		log.Printf("devices: %v (Pung devices in Live stay silent)", err)
	}

	stop := make(chan struct{})
	go runEngine(h, stop)
	lv := newLive(h)
	h.live = lv
	go lv.run(stop)
	surf := newSurface(h)
	surf.live = lv
	lv.onSelect = surf.followLive
	lv.state().onChange = func() { surf.dirty.Store(true) }
	go surf.run(stop)
	surf.routes(mux)
	mux.HandleFunc("GET /api/live", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "live": lv.status()})
	})
	mux.HandleFunc("POST /api/slots/{n}/tracks", func(w http.ResponseWriter, r *http.Request) {
		s, ok := h.slotFromPath(w, r)
		if !ok {
			return
		}
		res, err := ensureTracks(s.Index)
		if err != nil {
			writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error(), "result": res})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "result": res})
	})
	go h.transport.watch()
	saved := make(chan struct{})
	go func() { h.autosave(stop); close(saved) }()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	log.Printf("stopping")
	close(stop)
	select {
	case <-saved:
	case <-time.After(3 * time.Second):
	}
	devs.Close()
	// every chain unloaded, so the processes modules started end with it (a
	// version 1 slot, or one opened through the API, was left running)
	for i := 0; i < maxSlots; i++ {
		if h.slot(i) != nil {
			h.closeSlot(i)
		}
	}
	srv.Close()
}
