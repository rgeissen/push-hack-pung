// Pung for Push 3: runs Schwung modules (Ableton Move's module ecosystem)
// on Push 3 Standalone. One slot = one Pung signal chain = one Live track.
package main

import (
	"errors"
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
	unniceThreads() // the service starts Pung at nice 19 (lockboost_linux.go)
	setProcs()      // before any device thread starts (procs.go)
	setGC()
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
	scoutJobPath := flag.String("scout-job", "", "walk one module's sound list and exit (scout.go)")
	survey := flag.Bool("sounds-survey", false, "print how every module's sound list is named, and exit (scout.go)")
	scoutOut := flag.String("scout-out", "", "with -scout-job: write the names here")
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
	pungPort = cfg.Port
	// the port first, before anything else of Pung's starts: a Pung that is
	// still stopping holds it, and the service's restart starts this one
	// the moment it has sent the old one kill -9 (2026-11-22: the new Pung
	// found the port taken, gave up, and Pung was down until started again)
	var ln net.Listener
	if *probeModule == "" && *scoutJobPath == "" && !*survey {
		ln = listenWaiting(fmt.Sprintf(":%d", cfg.Port), 15*time.Second)
	}
	if *nslots < 0 || *nslots > 16 {
		log.Fatalf("-slots must be 0..16")
	}
	if err := os.MkdirAll(*data, 0o755); err != nil {
		log.Fatalf("data dir: %v", err)
	}

	if *probeModule == "" && *scoutJobPath == "" && !*survey {
		ensureMovePungLink(base)
		ensureMoveUserLibrary()
		go tidyUserLibrary()
		// what an earlier Pung's modules forked must not hold on (procs.go)
		leadProcessGroup()
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			killOrphans(real)
		}
	}
	if err := engineInit(filepath.Join(*modules, "chain")); err != nil {
		log.Fatalf("chain host: %v", err)
	}
	// /data/UserData/schwung is this directory: the lock files modules take
	// there stay with the module that took them (bridge.c)
	if real, err := filepath.EvalSymlinks(base); err == nil {
		cLockDir(real + "/")
	}
	h := newHost(*modules, *data, audiobus.SocketPath(audiobus.DefaultDir))
	if *probeModule == "" && *scoutJobPath == "" && !*survey {
		// from the start: a module may hang while Pung starts (watchdog.go)
		go h.watchdog(nil, func(x hung) { h.restartAfterHang(x, exe, leaveSurface.Load()) })
	}
	forkingModulesDir = *modules // engine.go: a forking module's processes are loaded realtime
	// sounds: Schwung's presets folder (Pung's own, through the link above);
	// presets.json from Pung's overrides, the data folder's winning
	h.sounds = newSoundLib(h, presetsDir(base), filepath.Join(base, "overrides"), filepath.Join(*data, "overrides"))
	h.files = newFileLib(*data)
	if *probeModule != "" {
		probeModuleMain(h, *probeModule, *probeOut)
		return
	}
	if *scoutJobPath != "" {
		scoutMain(h, *scoutJobPath, *scoutOut)
		return
	}
	if *survey {
		soundsSurvey(h)
		return
	}
	// modules from the catalog: their links in place before anything reads
	// the module tree (modmgr.go)
	h.mods = newModMgr(h)
	h.mods.linkModules()
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
	h.governorRoutes(mux)
	h.governRoutes(mux)
	h.settingsRoutes(mux)
	h.mods.routes(mux)
	h.sounds.routes(mux)
	h.fileRoutes(mux)
	h.sounds.libraryRoutes(mux)
	srv := &http.Server{Addr: fmt.Sprintf(":%d", cfg.Port), Handler: withSiteCORS(mux), ReadHeaderTimeout: 5 * time.Second} // pung.live may talk to it (sitecors.go)
	if ln == nil {
		ln = listenWaiting(srv.Addr, 15*time.Second)
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
	// pung.live looks for Pung on 7720: Push Hack Catalog gives a hack the
	// first free port from 7711, so Pung answers there too (sitecors.go)
	if cfg.Port != sitePort {
		if sl, err := net.Listen("tcp", fmt.Sprintf(":%d", sitePort)); err != nil {
			log.Printf("http: :%d is taken (%v): pung.live finds Pung at :%d only when told", sitePort, err, cfg.Port)
		} else {
			if rc, err := sl.(*net.TCPListener).SyscallConn(); err == nil {
				rc.Control(func(fd uintptr) { cCloseInChildren(int(fd)) }) //nolint:errcheck
			}
			log.Printf("http on :%d too (pung.live)", sitePort)
			go func() { _ = (&http.Server{Handler: srv.Handler, ReadHeaderTimeout: 5 * time.Second}).Serve(sl) }()
		}
	}

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
	// every parameter where its class last had it: a Set's automation stays on it (stablelayout.go)
	sclasses = stableLayouts(sclasses, knownClasses(*data))
	// a class whose layout changed keeps the one a running Live has (classlock.go)
	sclasses = classesForLive(sclasses, livedevice.ClassesPath(*vst3, "Pung"), filepath.Join(*data, "classes.live.json"),
		exists(h.mods.path(restartLiveFlag)))
	classes := coreClasses(sclasses)
	// The class file lives in the bundle (livedevice.ClassesPath): if the hack
	// is removed, Sets that use its devices still open. hack.json's
	// "live_devices" lets push-catalog remove the browser entries with it.
	// Pung.vst3: Pung's plugins in Live, Pung's browser folders. (The rename
	// from Schwung, 2026-11-15, gave the classes new UIDs: devices.go.)
	bcfg := livedevice.BundleConfig{Vendor: "Pung", URL: "https://pung.live", Socket: *socket}
	if *presets != "" {
		bcfg.Presets = livedevice.PresetFolders(*presets, "Pung", classes)
	}
	so, bcfg, _, err := livedevice.InstallBundle(*vst3, "Pung", filepath.Join(base, "livedevice.so"), bcfg)
	if err != nil {
		log.Printf("devices: plugin: %v (Live keeps the one it has)", err)
		bcfg.Classes = livedevice.ClassesPath(*vst3, "Pung")
	}
	// a removed module's class stays known to Live (modroutes.go, withRetired)
	if _, err := livedevice.WriteClasses(bcfg.Classes, so, withRetired(*data, classes)); err != nil {
		log.Printf("devices: %v", err)
	}
	if *presets != "" {
		// WritePresets removes every rack in Pung's folders that is not a
		// class's: one Live saved there is given back (sounds_racks.go)
		giveBack := keepForeignRacks(*presets, classes)
		n, err := livedevice.WritePresets(*presets, "Pung", classes)
		giveBack()
		if err != nil {
			log.Printf("devices: browser entries: %v", err)
		} else if n > 0 {
			log.Printf("devices: %d browser entries written", n)
		}
		// and their tags in Live's browser (abletontags.go); the catalog
		// first, for a module the tag table does not name
		h.mods.catalog(false)
		if n, err := writeAbletonTags(*presets, "Pung", classes, h.tagsForClass, h.dataDir); err != nil {
			log.Printf("devices: browser tags: %v", err)
		} else if n > 0 {
			log.Printf("devices: browser tags written in %d folders", n)
		}
	}
	// every user sound as a rack beside its module's (sounds_racks.go)
	if *presets != "" {
		h.sounds.racks = &soundRacks{presets: *presets, classes: sclasses}
		go h.sounds.SyncAllRacks()
	}
	h.prov = newProvider(h, sclasses)
	devs := livedevice.NewServer(livedevice.Config{Name: "pung", Socket: *socket}, h.prov, classes)
	mux.Handle("GET /api/devices", devs.Handler())
	if err := devs.Listen(); err != nil {
		log.Printf("devices: %v (Pung devices in Live stay silent)", err)
	}
	h.mods.afterStart(base) // an Apply that started this Pung: Live next

	stop := make(chan struct{})
	go runEngine(h, stop)
	lv := newLive(h)
	h.live = lv
	go lv.run(stop)
	surf := newSurface(h)
	h.surf.Store(surf)
	surf.live = lv
	lv.state().onChange = func() { surf.frameStats.byLive.Add(1); surf.dirty.Store(true) }
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
	go h.prov.keepWhileRunning(stop) // the devices' states, for a Pung that does not stop cleanly
	leave := func() {                // what a restart after a hang does with the surface (watchdog.go)
		if surf.focused.Load() {
			surf.pm.SurfaceLeave("live") //nolint:errcheck
		}
	}
	leaveSurface.Store(&leave)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	restart := false
	select {
	case <-sig:
	case <-restartCh: // Apply (modroutes.go): stop, and start again as the same process
		restart = true
	}
	log.Printf("stopping")
	h.prov.keepStates() // before anything closes: what each device is now (keptstate.go)
	// The surface goes to Live, not to whatever push-manager falls back to:
	// a Pung that stopped holding it (an update, an Apply) left Home holding
	// the buttons and a black screen, and Live's question after its restart
	// ("recover your work?") could not be answered (2026-11-15).
	if surf.focused.Load() {
		if err := surf.pm.SurfaceLeave("live"); err != nil {
			log.Printf("surface: giving it to Live: %v", err)
		}
	}
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
	killGroup() // what a module forked and did not end
	if restart {
		// the same pid (the service's pid file stays true), new classes
		log.Printf("starting again")
		if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
			log.Fatalf("starting again: %v", err)
		}
	}
}

// listenWaiting: the port, waiting up to max for a Pung that still holds it
// to be gone. Fatal after that, as before.
func listenWaiting(addr string, max time.Duration) net.Listener {
	until := time.Now().Add(max)
	for said := false; ; {
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln
		}
		if !errors.Is(err, syscall.EADDRINUSE) || time.Now().After(until) {
			log.Fatalf("http: %v", err)
		}
		if !said {
			log.Printf("http: %s is still taken (a Pung stopping?): waiting for it", addr)
			said = true
		}
		time.Sleep(250 * time.Millisecond)
	}
}
