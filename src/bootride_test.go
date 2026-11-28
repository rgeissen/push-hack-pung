package main

import (
	"encoding/json"
	"image"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/federico-pepe/ableton-push-hack/core/display"
)

// fakeDisplay: push-manager's display calls, as a hack without a surface
// has them: the mode, and frames that are taken only in takeover
type fakeDisplay struct {
	mu      sync.Mutex
	mode    int
	modes   []int // every mode set, in order
	frames  int
	refuse  bool // the surface is an app's: mode and frames answer 409
	cutAt   int  // from this frame on the surface is an app's (0: never)
	badSize int
	leftTo  string // the hack push-manager left the start-up picture to
}

func (f *fakeDisplay) serve(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/display/status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"connected": true, "mode": f.mode, "startup_picture": f.leftTo}) //nolint:errcheck
	})
	mux.HandleFunc("/api/display/mode", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var b struct{ Mode int }
		json.NewDecoder(r.Body).Decode(&b) //nolint:errcheck
		if f.refuse {
			http.Error(w, "the surface belongs to pung", http.StatusConflict)
			return
		}
		f.mode = b.Mode
		f.modes = append(f.modes, b.Mode)
		w.Write([]byte(`{}`)) //nolint:errcheck
	})
	mux.HandleFunc("/api/display/frame", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		if len(raw) != display.FrameBytes {
			f.badSize++
		}
		if f.refuse || f.mode != modeTakeover {
			http.Error(w, "the screen belongs to someone else now", http.StatusConflict)
			return
		}
		f.frames++
		if f.cutAt > 0 && f.frames >= f.cutAt {
			f.refuse = true
		}
	})
	s := httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

// Every picture of the ride is there, is the size the list says, and the
// ride moves: the first picture is not the last, and the dot ends on the P.
func TestRidePictures(t *testing.T) {
	m, err := loadRide()
	if err != nil {
		t.Fatal(err)
	}
	if d := float64(m.Frames) / float64(m.FPS); d < 2 || d > 5 {
		t.Errorf("the ride takes %.1f s: a Push starting up gets between 2 and 5", d)
	}
	first := image.NewNRGBA(image.Rect(0, 0, display.VisW, display.VisH))
	last := image.NewNRGBA(image.Rect(0, 0, display.VisW, display.VisH))
	for i := 0; i < m.Frames; i++ {
		dst := last
		if i == 0 {
			dst = first
		}
		if err := rideFrame(m, i, dst); err != nil {
			t.Fatalf("picture %d: %v", i, err)
		}
	}
	lit := func(img *image.NRGBA, r image.Rectangle) int {
		n := 0
		for y := r.Min.Y; y < r.Max.Y; y++ {
			for x := r.Min.X; x < r.Max.X; x++ {
				if c := img.NRGBAAt(x, y); int(c.R)+int(c.G)+int(c.B) > 60 {
					n++
				}
			}
		}
		return n
	}
	box := image.Rect(m.X, m.Y, m.X+m.W, m.Y+m.H)
	if n := lit(last, box); n < 2000 {
		t.Errorf("the last picture shows %d lit pixels: no logo", n)
	}
	if lit(last, image.Rect(0, 0, m.X, display.VisH))+lit(last, image.Rect(m.X+m.W, 0, display.VisW, display.VisH)) != 0 {
		t.Error("something is lit beside the pictures' place")
	}
	same := true
	for i := range first.Pix {
		if first.Pix[i] != last.Pix[i] {
			same = false
			break
		}
	}
	if same {
		t.Error("the first picture is the last: nothing moves")
	}
	// the dot is cyan (#4fcbe6); at the end it stands in the left quarter, on the P
	cyan := func(img *image.NRGBA) (sum, n int) {
		for y := box.Min.Y; y < box.Max.Y; y++ {
			for x := box.Min.X; x < box.Max.X; x++ {
				if c := img.NRGBAAt(x, y); c.B > 180 && c.G > 150 && c.R < 140 {
					sum += x - box.Min.X
					n++
				}
			}
		}
		return
	}
	if sum, n := cyan(last); n < 20 || sum/n > m.W/4 {
		t.Errorf("at the end the dot (%d cyan pixels) stands at %d of %d: not on the P", n, sum/max(1, n), m.W)
	}
}

// The ride takes the display, sends every picture and gives the display back.
func TestRidePlaysAndGivesTheDisplayBack(t *testing.T) {
	f := &fakeDisplay{}
	s := f.serve(t)
	dir := t.TempDir()
	m, _ := loadRide()
	t0 := time.Now()
	n, err := playRide(s.URL, dir, nil)
	if err != nil || n != m.Frames {
		t.Fatalf("%d pictures of %d, %v", n, m.Frames, err)
	}
	if f.frames != m.Frames || f.badSize != 0 {
		t.Errorf("the display got %d frames (%d of a wrong size)", f.frames, f.badSize)
	}
	if len(f.modes) != 2 || f.modes[0] != modeTakeover || f.modes[1] != modeLive || f.mode != modeLive {
		t.Errorf("modes set: %v, left at %d", f.modes, f.mode)
	}
	want := time.Duration(m.Frames)*time.Second/time.Duration(m.FPS) + time.Duration(m.HoldMs)*time.Millisecond
	if d := time.Since(t0); d < want-300*time.Millisecond || d > want+1500*time.Millisecond {
		t.Errorf("it took %v, the ride is %v", d, want)
	}
	if exists(filepath.Join(dir, rideMark)) {
		t.Error("the mark of a ride in progress was left")
	}
}

// A display that is someone's is left alone: nothing is set, nothing sent.
func TestRideLeavesATakenDisplayAlone(t *testing.T) {
	taken := &fakeDisplay{mode: modeTakeover}
	if n, err := playRide(taken.serve(t).URL, t.TempDir(), nil); err == nil || n != 0 || len(taken.modes) != 0 || taken.frames != 0 {
		t.Errorf("a display in takeover: %d pictures, %v, modes %v", n, err, taken.modes)
	}
	apps := &fakeDisplay{refuse: true}
	dir := t.TempDir()
	if n, err := playRide(apps.serve(t).URL, dir, nil); err == nil || n != 0 || apps.frames != 0 {
		t.Errorf("a surface that is an app's: %d pictures, %v", n, err)
	}
	if exists(filepath.Join(dir, rideMark)) {
		t.Error("the mark was left though no ride began")
	}
}

// An app that takes the surface in the middle ends the ride at once, and its
// screen is not set back.
func TestRideStopsWhenTheSurfaceIsTaken(t *testing.T) {
	f := &fakeDisplay{cutAt: 10}
	n, err := playRide(f.serve(t).URL, t.TempDir(), nil)
	if err == nil || n != 10 {
		t.Fatalf("%d pictures, %v", n, err)
	}
	if f.mode != modeTakeover || len(f.modes) != 1 {
		t.Errorf("the app's screen was set by the ride: modes %v, now %d", f.modes, f.mode)
	}
}

// Pung stopping ends the ride and gives the display back.
func TestRideStopsWithPung(t *testing.T) {
	f := &fakeDisplay{}
	stop := make(chan struct{})
	time.AfterFunc(300*time.Millisecond, func() { close(stop) })
	m, _ := loadRide()
	n, err := playRide(f.serve(t).URL, t.TempDir(), stop)
	if err != nil || n == 0 || n >= m.Frames {
		t.Fatalf("%d pictures of %d, %v", n, m.Frames, err)
	}
	if f.mode != modeLive {
		t.Errorf("the display was left in mode %d", f.mode)
	}
}

// When: as the Push starts, and once for a new Pung; never else.
func TestRideReason(t *testing.T) {
	for _, c := range []struct {
		version, shown string
		age            time.Duration
		running        bool
		want           string
	}{
		{"0.6.1", "0.6.1", 0, false, "boot"},                 // Pung is up before Push3: the Push is starting
		{"0.6.1", "0.6.1", 20 * time.Second, true, "boot"},   // Push3 is young
		{"0.6.1", "0.6.1", 3 * time.Hour, true, ""},          // a restart in the middle of a session
		{"0.6.1", "0.6.0", 3 * time.Hour, true, "installed"}, // a new Pung's first start
		{"0.6.1", "", 3 * time.Hour, true, "installed"},      // the first Pung with a ride
		{"dev", "", 3 * time.Hour, true, ""},                 // a build of one's own, restarted: not each time
		{"dev", "", 5 * time.Second, true, "boot"},
	} {
		if got := rideReason(c.version, c.shown, c.age, c.running); got != c.want {
			t.Errorf("Pung %s, shown for %q, Push3 %v (running %v): %q, want %q", c.version, c.shown, c.age, c.running, got, c.want)
		}
	}
}

// As a Push starts the ride waits for Push Hack's own picture to be over; where
// push-manager says it left the picture to Pung, only for the hook to draw at all.
func TestRideWaitsForPushHacksPicture(t *testing.T) {
	for _, c := range []struct {
		age            time.Duration
		running, pungs bool
		want           bool
	}{
		{0, false, false, false},
		{5 * time.Second, true, false, false},
		{9 * time.Second, true, false, false}, // push-manager's stars are on
		{14 * time.Second, true, false, true},
		{5 * time.Second, true, true, false}, // the hook draws nothing yet
		{9 * time.Second, true, true, true},
	} {
		if got := rideMayBegin(c.age, c.running, c.pungs); got != c.want {
			t.Errorf("Push3 %v (running %v), left to Pung %v: %v, want %v", c.age, c.running, c.pungs, got, c.want)
		}
	}
	mine := &fakeDisplay{leftTo: "pung"}
	if !rideIsPungs(mine.serve(t).URL) {
		t.Error("push-manager left the picture to pung, and Pung did not see it")
	}
	for _, other := range []string{"", "another"} {
		f := &fakeDisplay{leftTo: other}
		if rideIsPungs(f.serve(t).URL) {
			t.Errorf("the picture is %q's, not Pung's", other)
		}
	}
}
