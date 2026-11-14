// Schwung for Push 3: runs Schwung modules (Ableton Move's module ecosystem)
// on Push 3 Standalone. One slot = one Schwung signal chain = one Live track.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/alsaseq"
	"github.com/federico-pepe/ableton-push-hack/core/audiobus"
	"github.com/federico-pepe/ableton-push-hack/core/hackcfg"
)

var buildVersion = "dev"

func main() {
	exe, _ := os.Executable()
	base := filepath.Dir(exe)
	modules := flag.String("modules", filepath.Join(base, "modules"), "Schwung module tree")
	data := flag.String("data", "/data/push-hack/data/schwung", "slot state")
	nslots := flag.Int("slots", 0, "version 1 tracks to open at start (0: Schwung devices in Live only)")
	vst3 := flag.String("vst3", "/data/.vst3/Schwung.vst3", "the Schwung.vst3 bundle Live scans")
	showVersion := flag.Bool("version", false, "print the version and exit")
	config := flag.String("config", "", "hack.json (push-catalog's service passes it)")
	bootRequests := flag.Bool("boot-requests", false, "apply pending Live preference changes, then exit (run at boot, before Live)")
	writeClassesTo := flag.String("write-classes", "", "write the device classes to this file and exit (tests, packaging)")
	socket := flag.String("socket", C_SB_IPC_SOCKET, "the device control socket")
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

	if err := engineInit(filepath.Join(*modules, "chain")); err != nil {
		log.Fatalf("chain host: %v", err)
	}
	h := newHost(*modules, *data, audiobus.SocketPath(audiobus.DefaultDir))
	if *writeClassesTo != "" {
		classes := h.buildClasses()
		doc, _ := json.MarshalIndent(map[string]any{"version": 1, "classes": classes}, "", " ")
		if err := os.WriteFile(*writeClassesTo, doc, 0o644); err != nil {
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
	go func() {
		log.Printf("http on :%d", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
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

	// DESIGN-v2: every Schwung device in Live is a chain instance here
	classes := h.buildClasses()
	if err := writeClasses(filepath.Join(base, "vst3-classes.json"), *vst3, classes); err != nil {
		log.Printf("devices: %v", err)
	}
	devs := newDevices(h, classes)
	devs.handle(mux)
	if err := devs.serve(*socket); err != nil {
		log.Printf("devices: %v (Schwung devices in Live stay silent)", err)
	}

	stop := make(chan struct{})
	go runEngine(h, stop)
	lv := newLive(h)
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
	srv.Close()
}
