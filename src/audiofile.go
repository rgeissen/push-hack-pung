package main

// audiofile.go: what the file browser shows and plays of an audio file.
//
// Three things are asked of a file: what it is (length, rate, channels, bit
// depth), its outline (a waveform a hand can read at 300 pixels), and its
// sound (the preview). WAV and AIFF are read here, in every form Live's own
// libraries hold them (PCM 8 to 32 bit, float, WAVE_FORMAT_EXTENSIBLE; AIFF
// and AIFC twos, sowt, fl32): two thirds of the Core Library is one, a third
// the other, and a read is a few milliseconds where starting a program is a
// tenth of a second. Everything else (MP3, FLAC, a compressed WAV) goes
// through ffmpeg, which AbletonOS has; without ffmpeg such a file is listed
// with no outline and no preview, never refused.

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// audioInfo: an audio file, as its header says.
type audioInfo struct {
	Rate     int     `json:"rate"`
	Channels int     `json:"channels"`
	Bits     int     `json:"bits"`             // 0: not PCM (MP3)
	Float    bool    `json:"float,omitempty"`  // floating point samples
	Frames   int64   `json:"frames"`           // 0: not known
	Seconds  float64 `json:"seconds"`          // 0: not known
	Format   string  `json:"format"`           // WAV | AIFF | MP3 | FLAC | ...
	Native   bool    `json:"native,omitempty"` // read here, without ffmpeg

	// where the samples are (native only)
	dataOff int64
	dataLen int64
	big     bool // big-endian samples (AIFF, AIFC twos)
	unsign  bool // unsigned 8 bit (WAV)
}

var errNotAudio = errors.New("not an audio file this reads")

// audioExts: what counts as an audio file in a folder.
var audioExts = map[string]bool{".wav": true, ".aif": true, ".aiff": true, ".aifc": true, ".flac": true,
	".mp3": true, ".ogg": true, ".m4a": true, ".wave": true}

func isAudioExt(ext string) bool { return audioExts[strings.ToLower(ext)] }

// readAudioInfo reads a WAV or AIFF header.
func readAudioInfo(path string) (*audioInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var id [12]byte
	if _, err := io.ReadFull(f, id[:]); err != nil {
		return nil, errNotAudio
	}
	switch {
	case string(id[:4]) == "RIFF" && string(id[8:]) == "WAVE":
		return readWavInfo(f)
	case string(id[:4]) == "FORM" && (string(id[8:]) == "AIFF" || string(id[8:]) == "AIFC"):
		return readAiffInfo(f, string(id[8:]) == "AIFC")
	}
	return nil, errNotAudio
}

func readWavInfo(f *os.File) (*audioInfo, error) {
	in := &audioInfo{Format: "WAV", Native: true}
	var block int
	seen := false
	for {
		var h [8]byte
		if _, err := io.ReadFull(f, h[:]); err != nil {
			break
		}
		size := int64(binary.LittleEndian.Uint32(h[4:]))
		pos, _ := f.Seek(0, io.SeekCurrent)
		switch string(h[:4]) {
		case "fmt ":
			b := make([]byte, min(size, 40))
			if _, err := io.ReadFull(f, b); err != nil || len(b) < 16 {
				return nil, errNotAudio
			}
			tag := binary.LittleEndian.Uint16(b)
			in.Channels = int(binary.LittleEndian.Uint16(b[2:]))
			in.Rate = int(binary.LittleEndian.Uint32(b[4:]))
			block = int(binary.LittleEndian.Uint16(b[12:]))
			in.Bits = int(binary.LittleEndian.Uint16(b[14:]))
			if tag == 0xFFFE && len(b) >= 26 { // WAVE_FORMAT_EXTENSIBLE: the real tag is in the GUID
				tag = binary.LittleEndian.Uint16(b[24:])
			}
			switch tag {
			case 1:
			case 3:
				in.Float = true
			default:
				return nil, errNotAudio // compressed: ffmpeg's
			}
			seen = true
		case "data":
			in.dataOff, in.dataLen = pos, size
			if st, err := f.Stat(); err == nil && pos+size > st.Size() {
				in.dataLen = st.Size() - pos // a header written before the take ended
			}
		}
		if _, err := f.Seek(pos+size+size&1, io.SeekStart); err != nil {
			break
		}
	}
	if !seen || in.dataOff == 0 || in.Channels < 1 || in.Channels > 8 || in.Rate < 1 {
		return nil, errNotAudio
	}
	bytes := in.Bits / 8
	if in.Bits%8 != 0 || bytes < 1 || bytes > 8 || (in.Float && bytes != 4 && bytes != 8) || (!in.Float && bytes > 4) {
		return nil, errNotAudio
	}
	if block < bytes*in.Channels {
		block = bytes * in.Channels
	}
	in.unsign = bytes == 1
	in.Frames = in.dataLen / int64(block)
	in.Seconds = float64(in.Frames) / float64(in.Rate)
	return in, nil
}

func readAiffInfo(f *os.File, aifc bool) (*audioInfo, error) {
	in := &audioInfo{Format: "AIFF", Native: true, big: true}
	seen := false
	for {
		var h [8]byte
		if _, err := io.ReadFull(f, h[:]); err != nil {
			break
		}
		size := int64(binary.BigEndian.Uint32(h[4:]))
		pos, _ := f.Seek(0, io.SeekCurrent)
		switch string(h[:4]) {
		case "COMM":
			b := make([]byte, min(size, 26))
			if _, err := io.ReadFull(f, b); err != nil || len(b) < 18 {
				return nil, errNotAudio
			}
			in.Channels = int(binary.BigEndian.Uint16(b))
			in.Frames = int64(binary.BigEndian.Uint32(b[2:]))
			in.Bits = int(binary.BigEndian.Uint16(b[6:]))
			in.Rate = int(math.Round(extended80(b[8:18])))
			if aifc && len(b) >= 22 {
				switch string(b[18:22]) {
				case "NONE", "twos":
				case "sowt":
					in.big = false
				case "fl32", "FL32":
					in.Float = true
				case "fl64", "FL64":
					in.Float = true
				default:
					return nil, errNotAudio
				}
			}
			seen = true
		case "SSND":
			var off [8]byte
			if _, err := io.ReadFull(f, off[:]); err != nil {
				return nil, errNotAudio
			}
			skip := int64(binary.BigEndian.Uint32(off[:4]))
			in.dataOff, in.dataLen = pos+8+skip, size-8-skip
		}
		if _, err := f.Seek(pos+size+size&1, io.SeekStart); err != nil {
			break
		}
	}
	if !seen || in.dataOff == 0 || in.Channels < 1 || in.Channels > 8 || in.Rate < 1 {
		return nil, errNotAudio
	}
	in.Bits = (in.Bits + 7) / 8 * 8
	bytes := in.Bits / 8
	if bytes < 1 || bytes > 8 || (in.Float && bytes != 4 && bytes != 8) || (!in.Float && bytes > 4) {
		return nil, errNotAudio
	}
	if n := in.dataLen / int64(bytes*in.Channels); n < in.Frames || in.Frames == 0 {
		in.Frames = n
	}
	in.Seconds = float64(in.Frames) / float64(in.Rate)
	return in, nil
}

// extended80: an 80-bit IEEE 754 extended float (AIFF's sample rate).
func extended80(b []byte) float64 {
	exp := int(binary.BigEndian.Uint16(b)&0x7FFF) - 16383
	man := binary.BigEndian.Uint64(b[2:])
	if man == 0 {
		return 0
	}
	return float64(man) * math.Pow(2, float64(exp-63))
}

// sample reads one sample of the file's own form as -1..1.
func (in *audioInfo) sample(b []byte) float32 {
	switch n := len(b); {
	case in.Float && n == 4:
		var u uint32
		if in.big {
			u = binary.BigEndian.Uint32(b)
		} else {
			u = binary.LittleEndian.Uint32(b)
		}
		return math.Float32frombits(u)
	case in.Float:
		var u uint64
		if in.big {
			u = binary.BigEndian.Uint64(b)
		} else {
			u = binary.LittleEndian.Uint64(b)
		}
		return float32(math.Float64frombits(u))
	case n == 1 && in.unsign:
		return (float32(b[0]) - 128) / 128
	case n == 1:
		return float32(int8(b[0])) / 128
	default:
		var v int32
		if in.big {
			for i := 0; i < n; i++ {
				v = v<<8 | int32(b[i])
			}
		} else {
			for i := n - 1; i >= 0; i-- {
				v = v<<8 | int32(b[i])
			}
		}
		shift := uint(32 - 8*n)
		v = v << shift >> shift // sign
		return float32(v) / float32(int64(1)<<uint(8*n-1))
	}
}

// frames reads the file's frames from first, up to count of them, and gives
// each to fn as left and right (a mono file: the same twice; more than two
// channels: the first two). It reads in pieces: a long file never sits in
// memory whole.
func (in *audioInfo) frames(path string, first, count int64, fn func(l, r float32)) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	bps := in.Bits / 8
	fb := bps * in.Channels
	if first < 0 {
		first = 0
	}
	if count <= 0 || first+count > in.Frames {
		count = in.Frames - first
	}
	if count <= 0 {
		return nil
	}
	if _, err := f.Seek(in.dataOff+first*int64(fb), io.SeekStart); err != nil {
		return err
	}
	buf := make([]byte, fb*4096)
	for count > 0 {
		want := int(min(int64(len(buf)/fb), count)) * fb
		n, err := io.ReadFull(f, buf[:want])
		n -= n % fb
		for o := 0; o < n; o += fb {
			l := in.sample(buf[o : o+bps])
			r := l
			if in.Channels > 1 {
				r = in.sample(buf[o+bps : o+2*bps])
			}
			fn(l, r)
		}
		count -= int64(n / fb)
		if err != nil || n == 0 {
			break
		}
	}
	return nil
}

// ---- the outline ---------------------------------------------------------------

// wavePeaks: a file's outline, n columns of its lowest and highest sample.
type wavePeaks struct {
	Min []float32 `json:"min"`
	Max []float32 `json:"max"`
}

// peaksOf computes the outline. A long file is sampled, not read whole: each
// column looks at up to 512 frames spread over its span, which finds a
// drum hit's peak and reads a ten-minute recording in a blink.
func (in *audioInfo) peaksOf(path string, n int) (*wavePeaks, error) {
	p := &wavePeaks{Min: make([]float32, n), Max: make([]float32, n)}
	if in.Frames <= 0 || n <= 0 {
		return p, nil
	}
	per := float64(in.Frames) / float64(n)
	if per <= 512 { // short: every frame counts
		i := int64(0)
		err := in.frames(path, 0, 0, func(l, r float32) {
			c := int(float64(i) / per)
			if c >= n {
				c = n - 1
			}
			lo, hi := min(l, r), max(l, r)
			if lo < p.Min[c] {
				p.Min[c] = lo
			}
			if hi > p.Max[c] {
				p.Max[c] = hi
			}
			i++
		})
		return p, err
	}
	for c := 0; c < n; c++ {
		at := int64(float64(c) * per)
		if err := in.frames(path, at, 512, func(l, r float32) {
			lo, hi := min(l, r), max(l, r)
			if lo < p.Min[c] {
				p.Min[c] = lo
			}
			if hi > p.Max[c] {
				p.Max[c] = hi
			}
		}); err != nil {
			return p, err
		}
	}
	return p, nil
}

// ---- ffmpeg, for what is not read here ------------------------------------------------

var ffmpegPath = sync.OnceValue(func() string {
	for _, n := range []string{"ffmpeg", "/usr/bin/ffmpeg"} {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
})

// ffmpegPCM decodes a file to interleaved stereo float at rate, at most
// seconds of it (0: all), and gives it in pieces to fn.
func ffmpegPCM(path string, rate int, seconds float64, fn func(l, r float32)) error {
	ff := ffmpegPath()
	if ff == "" {
		return errNotAudio
	}
	args := []string{"-v", "error", "-nostdin", "-i", path, "-vn", "-f", "f32le", "-ac", "2", "-ar", fmt.Sprint(rate)}
	if seconds > 0 {
		args = append(args, "-t", fmt.Sprintf("%.3f", seconds))
	}
	cmd := exec.Command(ff, append(args, "-")...)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	kill := time.AfterFunc(20*time.Second, func() { cmd.Process.Kill() }) //nolint:errcheck
	defer kill.Stop()
	buf := make([]byte, 8*4096)
	got := false
	for {
		n, err := io.ReadFull(out, buf)
		n -= n % 8
		for o := 0; o < n; o += 8 {
			fn(math.Float32frombits(binary.LittleEndian.Uint32(buf[o:])), math.Float32frombits(binary.LittleEndian.Uint32(buf[o+4:])))
			got = true
		}
		if err != nil {
			break
		}
	}
	if err := cmd.Wait(); err != nil && !got {
		return errNotAudio
	}
	return nil
}

// ---- one door ------------------------------------------------------------------

// audioFile: a file's facts and outline, as the browser asks for them.
type audioFile struct {
	Info  *audioInfo `json:"info,omitempty"`
	Peaks *wavePeaks `json:"peaks,omitempty"`
}

// peakColumns: the outline's width. The Push draws it at up to 340 pixels,
// the web page stretches it.
const peakColumns = 340

type audioCacheKey struct {
	path string
	mod  int64
	size int64
}

// audioCache: outlines already drawn. A folder is walked up and down many
// times; a file read once is not read again while it is the same file.
type audioCache struct {
	mu      sync.Mutex
	m       map[audioCacheKey]*audioFile
	order   []audioCacheKey
	reading map[audioCacheKey]bool
}

var audioFiles = &audioCache{m: map[audioCacheKey]*audioFile{}}

const audioCacheMax = 512

// get reads a file's facts and outline (cached). A file that is no audio, or
// that nothing here can read, gives an audioFile with neither.
func (c *audioCache) get(path string) *audioFile {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return &audioFile{}
	}
	k := audioCacheKey{path, st.ModTime().UnixNano(), st.Size()}
	c.mu.Lock()
	if af := c.m[k]; af != nil {
		c.mu.Unlock()
		return af
	}
	c.mu.Unlock()
	af := loadAudioFile(path)
	c.mu.Lock()
	if _, ok := c.m[k]; !ok {
		c.order = append(c.order, k)
		if len(c.order) > audioCacheMax {
			delete(c.m, c.order[0])
			c.order = c.order[1:]
		}
	}
	c.m[k] = af
	c.mu.Unlock()
	return af
}

// peek gives what is known of a file now, never waiting: nil while it is
// being read, and then ready is called (a frame is drawn again).
func (c *audioCache) peek(path string, ready func()) *audioFile {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return &audioFile{}
	}
	k := audioCacheKey{path, st.ModTime().UnixNano(), st.Size()}
	c.mu.Lock()
	defer c.mu.Unlock()
	if af := c.m[k]; af != nil {
		return af
	}
	if c.reading == nil {
		c.reading = map[audioCacheKey]bool{}
	}
	if !c.reading[k] {
		c.reading[k] = true
		go func() {
			c.get(path)
			c.mu.Lock()
			delete(c.reading, k)
			c.mu.Unlock()
			if ready != nil {
				ready()
			}
		}()
	}
	return nil
}

func loadAudioFile(path string) *audioFile {
	af := &audioFile{}
	if in, err := readAudioInfo(path); err == nil {
		af.Info = in
		if p, err := in.peaksOf(path, peakColumns); err == nil {
			af.Peaks = p
		}
		return af
	}
	if !isAudioExt(filepath.Ext(path)) {
		return af
	}
	// through ffmpeg: a coarse decode is enough for an outline
	const rate = 8000
	var mins, maxs []float32
	lo, hi := float32(0), float32(0)
	n, total := 0, int64(0)
	if err := ffmpegPCM(path, rate, 600, func(l, r float32) {
		lo, hi = min(lo, l, r), max(hi, l, r)
		if n++; n == 40 { // 200 columns a second
			mins, maxs = append(mins, lo), append(maxs, hi)
			lo, hi, n = 0, 0, 0
		}
		total++
	}); err != nil || total == 0 {
		return af
	}
	af.Info = &audioInfo{Rate: 0, Channels: 0, Frames: 0, Seconds: float64(total) / rate,
		Format: strings.ToUpper(strings.TrimPrefix(filepath.Ext(path), "."))}
	p := &wavePeaks{Min: make([]float32, peakColumns), Max: make([]float32, peakColumns)}
	for c := 0; c < peakColumns && len(mins) > 0; c++ {
		a := c * len(mins) / peakColumns
		b := max(a+1, (c+1)*len(mins)/peakColumns)
		for i := a; i < b && i < len(mins); i++ {
			p.Min[c], p.Max[c] = min(p.Min[c], mins[i]), max(p.Max[c], maxs[i])
		}
	}
	af.Peaks = p
	return af
}

// decodePreview: the file as interleaved stereo float at rate, at most
// seconds of it: what the preview plays.
func decodePreview(path string, rate int, seconds float64) ([]float32, error) {
	limit := int(seconds * float64(rate))
	in, err := readAudioInfo(path)
	if err != nil {
		if !isAudioExt(filepath.Ext(path)) {
			return nil, errNotAudio
		}
		var out []float32
		err := ffmpegPCM(path, rate, seconds, func(l, r float32) { out = append(out, l, r) })
		return out, err
	}
	want := int64(seconds * float64(in.Rate))
	src := make([]float32, 0, 2*min(want, in.Frames))
	if err := in.frames(path, 0, want, func(l, r float32) { src = append(src, l, r) }); err != nil {
		return nil, err
	}
	if in.Rate == rate {
		return src, nil
	}
	// another rate: linear between neighbours, which is right for a preview
	n := len(src) / 2
	outN := min(limit, int(float64(n)*float64(rate)/float64(in.Rate)))
	out := make([]float32, 0, 2*outN)
	step := float64(in.Rate) / float64(rate)
	for i := 0; i < outN; i++ {
		x := float64(i) * step
		a := int(x)
		if a >= n-1 {
			out = append(out, src[2*(n-1)], src[2*(n-1)+1])
			continue
		}
		t := float32(x - float64(a))
		out = append(out, src[2*a]+(src[2*a+2]-src[2*a])*t, src[2*a+1]+(src[2*a+3]-src[2*a+1])*t)
	}
	return out, nil
}

// describe: an audio file's facts in a line, for a screen: "0:01.42  44.1 kHz  16 bit  stereo".
func (in *audioInfo) describe() []string {
	var out []string
	if in.Seconds > 0 {
		out = append(out, clockTime(in.Seconds))
	}
	if in.Rate > 0 {
		khz := float64(in.Rate) / 1000
		if khz == math.Trunc(khz) {
			out = append(out, fmt.Sprintf("%.0f kHz", khz))
		} else {
			out = append(out, fmt.Sprintf("%.1f kHz", khz))
		}
	}
	if in.Bits > 0 {
		if in.Float {
			out = append(out, fmt.Sprintf("%d bit float", in.Bits))
		} else {
			out = append(out, fmt.Sprintf("%d bit", in.Bits))
		}
	}
	switch in.Channels {
	case 0:
	case 1:
		out = append(out, "mono")
	case 2:
		out = append(out, "stereo")
	default:
		out = append(out, fmt.Sprintf("%d ch", in.Channels))
	}
	return out
}

// clockTime: 1.42 -> "0:01.42", 75 -> "1:15", an hour and more "1:02:03".
func clockTime(s float64) string {
	switch {
	case s < 10:
		return fmt.Sprintf("0:%05.2f", s)
	case s < 60:
		return fmt.Sprintf("0:%04.1f", s)
	case s < 3600:
		return fmt.Sprintf("%d:%02d", int(s)/60, int(s)%60)
	}
	return fmt.Sprintf("%d:%02d:%02d", int(s)/3600, int(s)/60%60, int(s)%60)
}
