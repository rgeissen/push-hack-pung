// pung-catalog: the service behind https://<your-site>. It runs on the
// DiskStation, in Docker, beside the web share it publishes to.
//
// It watches Schwung's catalogue for new modules and new releases, builds
// them for the Push (natively: the DiskStation is x86_64 like the Push) into
// a staging catalog, and publishes what an admin approved. The pipeline is
// Pung's own (scripts/): gen-recipes.py, build-all.sh,
// package-push-modules.py, build-catalog.py.
//
// Folders (the container's mounts):
//
//	/site   the web share's pung folder (/volume2/web/pung): what is public
//	/data   everything else: sources, builds, staging, history, the admin
//	/app    this program and Pung's scripts (in the image)
package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // TZ works in a container with no zone files: the nightly check is at 03:00 local
)

//go:embed web
var webFS embed.FS

type config struct {
	Site, Data, App string
	Listen          string
	SchwungCatalog  string // Schwung's module-catalog.json
	SchwungRepo     string // its repository: the host headers modules compile against
	BaseURL         string // where /site is served
	BuildJobs       int    // compiles at once in a build (the DiskStation is shared)
}

func main() {
	var c config
	flag.StringVar(&c.Site, "site", envOr("PUNG_SITE", "/site"), "the published folder")
	flag.StringVar(&c.Data, "data", envOr("PUNG_DATA", "/data"), "working data")
	flag.StringVar(&c.App, "app", envOr("PUNG_APP", "/app"), "this program's folder (scripts/)")
	flag.StringVar(&c.Listen, "listen", envOr("PUNG_LISTEN", ":8780"), "admin address")
	flag.StringVar(&c.SchwungCatalog, "schwung-catalog", envOr("PUNG_SCHWUNG_CATALOG",
		"https://raw.githubusercontent.com/charlesvestal/schwung/main/module-catalog.json"), "Schwung's catalogue")
	flag.StringVar(&c.SchwungRepo, "schwung-repo", envOr("PUNG_SCHWUNG_REPO", "https://github.com/charlesvestal/schwung.git"), "Schwung's repository")
	flag.StringVar(&c.BaseURL, "base-url", envOr("PUNG_BASE_URL", "https://<your-site>"), "the public address of the site")
	flag.IntVar(&c.BuildJobs, "build-jobs", envInt("PUNG_BUILD_JOBS", 2), "compiles at once in a build")
	flag.Parse()
	if c.BuildJobs < 1 {
		c.BuildJobs = 1
	}
	log.SetFlags(log.LstdFlags)
	for _, d := range []string{c.Data, filepath.Join(c.Data, "work"), filepath.Join(c.Data, "history")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			log.Fatalf("%s: %v", d, err)
		}
	}

	s := newServer(c)
	s.auth.announceSetup()
	go s.builder.run()
	go s.scheduler()

	mux := http.NewServeMux()
	s.routes(mux)
	sub, _ := fs.Sub(webFS, "web")
	mux.Handle("GET /", http.FileServer(http.FS(sub)))
	srv := &http.Server{Addr: c.Listen, Handler: s.guard(mux), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("pung-catalog: admin on %s, site %s, data %s", c.Listen, c.Site, c.Data)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx) //nolint:errcheck
}

func envInt(k string, d int) int {
	if n, err := strconv.Atoi(os.Getenv(k)); err == nil {
		return n
	}
	return d
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
