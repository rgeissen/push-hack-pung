package main

// system.go: GET /api/system, the device Pung runs on, at a glance: its
// name and addresses, Pung and the software around it, the processor (the
// whole Push's, Pung's share, Live's, the emulators'), memory, the disk
// modules and sounds live on, the battery, and what plays. Pung's own page
// and pung.live's Your devices read it (src/sitecors.go).
//
// Nothing runs between requests (as the governor: the counters are the
// kernel's): the processor's numbers are what was used since the last
// request, and a first request measures for a third of a second.

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var pungStarted = time.Now()

type sysMeter struct {
	mu   sync.Mutex
	prev govSample
	last map[string]any // the processor's numbers of the last window
}

var sysCPU sysMeter

// cpuNow: the processor since the last request, in percent of the whole
// machine (all cores together are 100)
func (h *Host) cpuNow() map[string]any {
	sysCPU.mu.Lock()
	defer sysCPU.mu.Unlock()
	a := sysCPU.prev
	if a.at.IsZero() || time.Since(a.at) > 30*time.Second {
		a = h.govSampleNow()
		time.Sleep(330 * time.Millisecond)
	} else if time.Since(a.at) < 400*time.Millisecond && sysCPU.last != nil {
		return sysCPU.last // asked again at once: the same window
	}
	b := h.govSampleNow()
	sysCPU.prev = b
	total := b.sysTotal - a.sysTotal
	if total <= 0 {
		return sysCPU.last
	}
	share := func(d time.Duration) float64 {
		if d < 0 {
			d = 0
		}
		return float64(int(float64(d)/float64(total)*1000+0.5)) / 10
	}
	var eng time.Duration
	for pid, c := range b.engines {
		if p, ok := a.engines[pid]; ok {
			eng += c - p
		}
	}
	out := map[string]any{
		"cores":      runtime.NumCPU(),
		"busy":       share(b.sysBusy - a.sysBusy),
		"background": share(b.sysBack - a.sysBack),
		"pung":       share(b.pung - a.pung + b.children - a.children),
		"emulators":  share(eng),
		"window_ms":  b.at.Sub(a.at).Milliseconds(),
	}
	if b.liveFound && a.liveFound {
		out["live"] = share(b.live - a.live)
	}
	if b.push3 > 0 && a.push3 > 0 {
		out["push"] = share(b.push3 - a.push3)
	}
	sysCPU.last = out
	return out
}

// meminfo: /proc/meminfo's total and available, in bytes
func meminfo() (total, avail int64) {
	if onMac {
		return macMeminfo()
	}
	raw, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(raw), "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		v, _ := strconv.ParseInt(f[1], 10, 64)
		switch f[0] {
		case "MemTotal:":
			total = v * 1024
		case "MemAvailable:":
			avail = v * 1024
		}
	}
	return total, avail
}

// battery: the first battery the kernel knows (percent, and whether it charges)
func battery() map[string]any {
	if onMac {
		return macBattery()
	}
	dirs, _ := filepath.Glob("/sys/class/power_supply/*")
	for _, d := range dirs {
		if t, _ := os.ReadFile(filepath.Join(d, "type")); strings.TrimSpace(string(t)) != "Battery" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(d, "capacity"))
		if err != nil {
			continue
		}
		pct, err := strconv.Atoi(strings.TrimSpace(string(raw)))
		if err != nil {
			continue
		}
		st, _ := os.ReadFile(filepath.Join(d, "status"))
		s := strings.TrimSpace(string(st))
		return map[string]any{"percent": pct, "status": s, "charging": s == "Charging" || s == "Full"}
	}
	return nil
}

// temperature: the warmest of the kernel's thermal zones, in degrees Celsius (0: none)
func temperature() float64 {
	zones, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	max := 0.0
	for _, z := range zones {
		raw, err := os.ReadFile(z)
		if err != nil {
			continue
		}
		if v, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64); err == nil && v/1000 > max && v/1000 < 150 {
			max = v / 1000
		}
	}
	return float64(int(max*10+0.5)) / 10
}

// osRelease: the system's name and version (/etc/os-release)
func osRelease() (name, version string) {
	if onMac {
		return macOSRelease()
	}
	raw, _ := os.ReadFile("/etc/os-release")
	for _, line := range strings.Split(string(raw), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.Trim(v, `"`)
		switch k {
		case "NAME":
			name = v
		case "VERSION_ID":
			version = v
		}
	}
	return name, version
}

// addresses: where this device answers on its networks (IPv4, not itself)
func addresses() []string {
	var out []string
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		as, _ := i.Addrs()
		for _, a := range as {
			if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil {
				out = append(out, n.IP.String())
			}
		}
	}
	return out
}

// dirSize: what a folder holds, in bytes (links not followed)
func dirSize(dir string) int64 {
	var n int64
	filepath.Walk(dir, func(_ string, fi os.FileInfo, err error) error { //nolint:errcheck
		if err == nil && fi.Mode().IsRegular() {
			n += fi.Size()
		}
		return nil
	})
	return n
}

func (h *Host) systemInfo() map[string]any {
	name, _ := os.Hostname()
	osName, osVer := osRelease()
	out := map[string]any{
		"ok": true, "kind": here.Kind, "limits": here.limits(), "name": name, "addresses": addresses(),
		"pung":   map[string]any{"version": buildVersion, "uptime_s": int(time.Since(pungStarted).Seconds())},
		"system": map[string]any{"name": osName, "version": osVer},
		"cpu":    h.cpuNow(),
	}
	if total, avail := meminfo(); total > 0 {
		out["memory"] = map[string]any{"total": total, "available": avail}
	}
	var fs syscall.Statfs_t
	if h.dataDir != "" && syscall.Statfs(h.dataDir, &fs) == nil {
		out["disk"] = map[string]any{"total": int64(fs.Blocks) * int64(fs.Bsize), "free": int64(fs.Bavail) * int64(fs.Bsize)}
	}
	if b := battery(); b != nil {
		out["battery"] = b
	}
	if t := temperature(); t > 0 {
		out["temperature"] = t
	}
	// what plays: Pung's devices in the Set, and its emulators
	var devs []map[string]any
	if h.prov != nil {
		for _, d := range h.prov.list() {
			e := map[string]any{"module": d.c.module, "name": d.c.Name}
			if l := limitsOf(d.c.module); l != nil && l.Emulator {
				e["emulator"] = true
				e["resting"] = d.resting()
			}
			devs = append(devs, e)
		}
	}
	out["devices"] = devs
	if h.mods != nil {
		inst := h.mods.installed()
		out["modules"] = map[string]any{"installed": len(inst), "bytes": dirSize(h.mods.path("modules"))}
	}
	return out
}

func (h *Host) systemRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/system", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, h.systemInfo())
	})
}
