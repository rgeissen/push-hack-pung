package main

// bootride.go: the logo's ride on the Push's own screen when Pung has
// started: the dot goes from the G through N and U to its place on the P, as
// on pung.live's front page. The frames are that page's own (the site's
// boot-ride.py draws them with its script), carried here as small pictures.
//
// When: as the Push starts up, after Push Hack's own "loaded" stars (they are
// push-manager's, 5 s from the moment Push3 is 8 s old; Pung cannot replace
// them and does not draw over them), and once after a new Pung was installed.
// Never when Pung restarts in the middle of a session.
//
// How: the display alone, through push-manager's display calls as a hack
// without a surface of its own has them (mode 2, frames, mode back): no
// button, light or pad is touched. push-manager lets that through only while
// neither Push Hack Home nor an app has the surface; refused, nothing is
// shown. The screen is given back whatever happens: a ride that was cut
// off (Pung killed half-way) is cleared at the next start.

import (
	"embed"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/display"
	"github.com/federico-pepe/ableton-push-hack/core/pmclient"
)

//go:embed bootride/*.png bootride/ride.json
var rideFS embed.FS

// rideMeta: bootride/ride.json: where on the 960x160 screen the pictures sit
type rideMeta struct {
	X, Y, W, H int
	FPS        int `json:"fps"`
	Frames     int `json:"frames"`
	HoldMs     int `json:"hold_ms"` // the last picture stays that long
	// Landing: the picture from which the dot is on the P and the tagline
	// stands under the logo; from then Pung writes its version in the corner
	Landing int `json:"landing"`
}

func loadRide() (rideMeta, error) {
	var m rideMeta
	raw, err := rideFS.ReadFile("bootride/ride.json")
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return m, err
	}
	if m.Frames < 1 || m.FPS < 1 || m.W < 1 || m.H < 1 || m.X < 0 || m.Y < 0 || m.X+m.W > display.VisW || m.Y+m.H > display.VisH {
		return m, fmt.Errorf("bootride/ride.json: %+v does not fit the screen", m)
	}
	return m, nil
}

// rideFrame draws picture i into dst (the whole screen, black around it)
func rideFrame(m rideMeta, i int, dst *image.NRGBA) error {
	f, err := rideFS.Open(fmt.Sprintf("bootride/f-%03d.png", i))
	if err != nil {
		return err
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		return err
	}
	if b := img.Bounds(); b.Dx() != m.W || b.Dy() != m.H {
		return fmt.Errorf("bootride: picture %d is %dx%d, not %dx%d", i, b.Dx(), b.Dy(), m.W, m.H)
	}
	draw.Draw(dst, image.Rect(m.X, m.Y, m.X+m.W, m.Y+m.H), img, img.Bounds().Min, draw.Src)
	return nil
}

// rideWords: what Pung writes itself, once the dot has landed (the owner,
// 2026-11-28): its version in the right corner, and in the left one the Push
// Hack it runs on where its ride stands in place of Push Hack's own picture
// (there Push Hack's "loaded" is not shown, and this line is its credit).
// Before the landing, and for a build without a version, nothing.
func rideWords(dst *image.NRGBA, m rideMeta, i int, version, pushHack string) {
	if i < m.Landing {
		return
	}
	grey := color.NRGBA{138, 133, 124, 255}
	if version != "" && version != "dev" {
		label(dst, display.VisW-16, display.VisH-9, "Pung "+version, grey, 1)
	}
	if pushHack != "" {
		label(dst, 16, display.VisH-9, "on Push Hack "+pushHack, grey, -1)
	}
}

// pushHackVersion: the Push Hack this Push runs (push-manager's status), ""
// where it does not say
func pushHackVersion(base string) string {
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Get(base + "/api/status")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var st struct {
		Hack string `json:"hack_version"`
	}
	if json.NewDecoder(resp.Body).Decode(&st) != nil || st.Hack == "dev" {
		return ""
	}
	return st.Hack
}

const (
	pmBase       = "http://127.0.0.1:7701"
	rideMark     = "ride-playing" // in Pung's data: a ride has the display
	rideShown    = "ride-shown"   // in Pung's data: the Pung whose ride was shown after its install
	modeLive     = 0
	modeTakeover = 2
	// Push Hack's own start-up picture is over when Push3 is this old: the
	// hook draws nothing for its first 8 s, then push-manager's stars run 5 s
	push3Settled = 13500 * time.Millisecond
	// where push-manager leaves the start-up picture to Pung (proposed to
	// Push Hack, 2026-11-28: hack.json "startup_picture"; its display status
	// then names this hack), the ride begins when the hook draws at all
	push3Grace = 8300 * time.Millisecond
	// a Pung that starts while Push3 is younger than this started with the Push
	push3Young = 45 * time.Second
)

// rideIsPungs: push-manager left this start's picture to Pung (its display
// status says so; a push-manager from before that says nothing)
func rideIsPungs(base string) bool {
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Get(base + "/api/display/status")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var st struct {
		StartupPicture string `json:"startup_picture"`
	}
	return json.NewDecoder(resp.Body).Decode(&st) == nil && st.StartupPicture == "pung"
}

// rideMayBegin: Push3 is old enough for a picture to be drawn, and Push
// Hack's own is over (or was left to Pung)
func rideMayBegin(age time.Duration, running, pungs bool) bool {
	if !running {
		return false
	}
	if pungs {
		return age >= push3Grace
	}
	return age >= push3Settled
}

// playRide shows the ride once: version is Pung's, pushHack the Push Hack to
// name where the ride stands in place of its picture ("" else). It returns
// how many pictures reached the screen; an error says why it stopped or
// never began (the display is someone's, push-manager is not there): nothing
// to do about it.
func playRide(base, dataDir, version, pushHack string, stop <-chan struct{}) (int, error) {
	m, err := loadRide()
	if err != nil {
		return 0, err
	}
	pm := pmclient.New(base) // (no app: the display's old way, allowed only while no app has the surface)
	st, err := pm.DisplayStatus()
	if err != nil {
		return 0, err
	}
	if !st.Connected {
		return 0, fmt.Errorf("the display is not connected")
	}
	if st.Mode != modeLive {
		return 0, fmt.Errorf("the display is taken (mode %d)", st.Mode)
	}
	mark := filepath.Join(dataDir, rideMark)
	if dataDir != "" {
		os.WriteFile(mark, []byte(time.Now().Format(time.RFC3339)), 0o644) //nolint:errcheck
	}
	if err := pm.SetMode(modeTakeover); err != nil {
		os.Remove(mark)
		return 0, err
	}
	defer func() {
		// back to Push's own picture, unless someone took the display meanwhile
		// (then the call is refused, and that is right)
		if err := pm.SetMode(modeLive); err != nil {
			log.Printf("ride: the display was not given back by the ride: %v", err)
		}
		os.Remove(mark)
	}()
	screen := image.NewNRGBA(image.Rect(0, 0, display.VisW, display.VisH))
	draw.Draw(screen, screen.Bounds(), image.Black, image.Point{}, draw.Src)
	tick := time.Second / time.Duration(m.FPS)
	next := time.Now()
	shown := 0
	for i := 0; i < m.Frames; i++ {
		if err := rideFrame(m, i, screen); err != nil {
			return shown, err
		}
		rideWords(screen, m, i, version, pushHack)
		if err := pm.PushFrame(screen); err != nil {
			return shown, err // (the surface went to an app or to Home: its screen now)
		}
		shown++
		next = next.Add(tick)
		if !waitUntil(next, stop) {
			return shown, nil
		}
	}
	waitUntil(time.Now().Add(time.Duration(m.HoldMs)*time.Millisecond), stop)
	return shown, nil
}

func waitUntil(t time.Time, stop <-chan struct{}) bool {
	d := time.Until(t)
	if d <= 0 {
		select {
		case <-stop:
			return false
		default:
			return true
		}
	}
	select {
	case <-stop:
		return false
	case <-time.After(d):
		return true
	}
}

// rideReason: why this start shows the ride ("boot", "installed"), or "".
// shownFor: the Pung whose ride was last shown after an install (the file
// ride-shown); age, running: Push3's, as Pung starts.
func rideReason(version, shownFor string, age time.Duration, running bool) string {
	switch {
	case !running || age < push3Young:
		return "boot"
	case version != "" && version != "dev" && shownFor != version:
		return "installed"
	}
	return ""
}

// push3Age: how long the Push's own program has run (the youngest process
// named Push3), from /proc as push-manager reads it for its own picture
func push3Age() (time.Duration, bool) {
	up, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, false
	}
	secs, err := strconv.ParseFloat(strings.Fields(string(up))[0], 64)
	if err != nil {
		return 0, false
	}
	dirs, _ := os.ReadDir("/proc")
	best, found := time.Duration(0), false
	for _, d := range dirs {
		if _, err := strconv.Atoi(d.Name()); err != nil {
			continue
		}
		comm, err := os.ReadFile("/proc/" + d.Name() + "/comm")
		if err != nil || strings.TrimSpace(string(comm)) != "Push3" {
			continue
		}
		stat, err := os.ReadFile("/proc/" + d.Name() + "/stat")
		if err != nil {
			continue
		}
		s := string(stat)
		i := strings.LastIndex(s, ")") // (the name can hold spaces and brackets: count from its end)
		if i < 0 {
			continue
		}
		f := strings.Fields(s[i+1:])
		if len(f) < 20 {
			continue
		}
		ticks, err := strconv.ParseUint(f[19], 10, 64) // field 22: its start, in 1/100 s since the system's
		if err != nil {
			continue
		}
		age := time.Duration((secs - float64(ticks)/100) * float64(time.Second))
		if !found || age < best {
			best, found = age, true
		}
	}
	return best, found
}

// startRide: called once as Pung starts (a goroutine). Clears a ride that was
// cut off, then shows the ride where this start is the Push's own or a new
// Pung's first.
func startRide(dataDir, version string, stop <-chan struct{}) {
	if onMac {
		return
	}
	pm := pmclient.New(pmBase)
	if mark := filepath.Join(dataDir, rideMark); exists(mark) {
		if st, err := pm.DisplayStatus(); err == nil && st.Mode == modeTakeover {
			if err := pm.SetMode(modeLive); err == nil { // (refused where the display is an app's by now: then it is not the ride's)
				log.Printf("ride: an earlier one was cut off; the display given back")
			}
		}
		os.Remove(mark)
	}
	shownFor, _ := os.ReadFile(filepath.Join(dataDir, rideShown))
	age, running := push3Age()
	why := rideReason(version, strings.TrimSpace(string(shownFor)), age, running)
	if why == "" {
		return
	}
	// wait for Push3 (a Push starting up: Pung may be there first), and for
	// Push Hack's own picture to be over. From then the display has 20 s to
	// be free: a ride that turned up minutes later, when a player closes
	// what they had open, would only startle. (Not shown after an install,
	// it is tried again at the next start.)
	deadline := time.Now().Add(3 * time.Minute)
	var settled time.Time
	for {
		age, running = push3Age()
		if rideMayBegin(age, running, running && age >= push3Grace && rideIsPungs(pmBase)) {
			if settled.IsZero() {
				settled = time.Now()
			}
			if st, err := pm.DisplayStatus(); err == nil && st.Connected && st.Mode == modeLive {
				break
			}
		}
		if time.Now().After(deadline) || (!settled.IsZero() && time.Since(settled) > 20*time.Second) {
			log.Printf("ride: not shown (%s): the display did not come free", why)
			return
		}
		if !waitUntil(time.Now().Add(250*time.Millisecond), stop) {
			return
		}
	}
	credit := ""
	if rideIsPungs(pmBase) {
		credit = pushHackVersion(pmBase)
	}
	n, err := playRide(pmBase, dataDir, version, credit, stop)
	if err != nil && n == 0 {
		log.Printf("ride: not shown (%s): %v", why, err)
		return
	}
	log.Printf("ride: shown (%s), %d pictures", why, n)
	if version != "" && version != "dev" {
		os.WriteFile(filepath.Join(dataDir, rideShown), []byte(version+"\n"), 0o644) //nolint:errcheck
	}
}

// POST /api/debug/ride: show it now (a look at it without a restart)
// (?credit=1: with the Push Hack line, as where the ride replaces its picture)
func registerRide(mux *http.ServeMux, dataDir, version string) {
	mux.HandleFunc("POST /api/debug/ride", func(w http.ResponseWriter, r *http.Request) {
		credit := ""
		if r.URL.Query().Get("credit") != "" || rideIsPungs(pmBase) {
			credit = pushHackVersion(pmBase)
		}
		n, err := playRide(pmBase, dataDir, version, credit, r.Context().Done())
		out := map[string]any{"ok": err == nil, "shown": n}
		if err != nil {
			out["error"] = err.Error()
		}
		writeJSON(w, 200, out)
	})
}
