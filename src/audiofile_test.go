package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// testTone: one second of a ramp from silence to full scale, so an outline
// has a shape to check: quiet at the start, loud at the end.
func testTone(frames int) []float32 {
	out := make([]float32, frames)
	for i := range out {
		out[i] = float32(math.Sin(float64(i)*0.3)) * float32(i) / float32(frames)
	}
	return out
}

// writeWav writes mono or stereo PCM (bits 8, 16, 24, 32) or float (bits 32
// with float true), as WAVE_FORMAT_EXTENSIBLE if ext.
func writeWav(t *testing.T, path string, s []float32, rate, ch, bits int, float, ext bool) {
	t.Helper()
	var data bytes.Buffer
	for _, v := range s {
		for c := 0; c < ch; c++ {
			switch {
			case float:
				binary.Write(&data, binary.LittleEndian, v)
			case bits == 8:
				data.WriteByte(byte(int(v*127) + 128))
			default:
				x := int32(v * float32(int64(1)<<uint(bits-1)-1))
				for b := 0; b < bits/8; b++ {
					data.WriteByte(byte(x >> uint(8*b)))
				}
			}
		}
	}
	var f bytes.Buffer
	fmtLen := 16
	if ext {
		fmtLen = 40
	}
	f.WriteString("RIFF")
	binary.Write(&f, binary.LittleEndian, uint32(4+8+fmtLen+8+data.Len()))
	f.WriteString("WAVEfmt ")
	binary.Write(&f, binary.LittleEndian, uint32(fmtLen))
	tag := uint16(1)
	if float {
		tag = 3
	}
	real := tag
	if ext {
		tag = 0xFFFE
	}
	binary.Write(&f, binary.LittleEndian, tag)
	binary.Write(&f, binary.LittleEndian, uint16(ch))
	binary.Write(&f, binary.LittleEndian, uint32(rate))
	binary.Write(&f, binary.LittleEndian, uint32(rate*ch*bits/8))
	binary.Write(&f, binary.LittleEndian, uint16(ch*bits/8))
	binary.Write(&f, binary.LittleEndian, uint16(bits))
	if ext {
		binary.Write(&f, binary.LittleEndian, uint16(22))
		binary.Write(&f, binary.LittleEndian, uint16(bits))
		binary.Write(&f, binary.LittleEndian, uint32(3))
		binary.Write(&f, binary.LittleEndian, real)
		f.Write(make([]byte, 14))
	}
	f.WriteString("data")
	binary.Write(&f, binary.LittleEndian, uint32(data.Len()))
	f.Write(data.Bytes())
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, f.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeAiff writes 16 bit AIFF, or AIFC with the compression named.
func writeAiff(t *testing.T, path string, s []float32, rate, ch int, aifc string) {
	t.Helper()
	var data bytes.Buffer
	for _, v := range s {
		for c := 0; c < ch; c++ {
			x := int16(v * 32767)
			if aifc == "sowt" {
				binary.Write(&data, binary.LittleEndian, x)
			} else {
				binary.Write(&data, binary.BigEndian, x)
			}
		}
	}
	var comm bytes.Buffer
	binary.Write(&comm, binary.BigEndian, uint16(ch))
	binary.Write(&comm, binary.BigEndian, uint32(len(s)))
	binary.Write(&comm, binary.BigEndian, uint16(16))
	// the rate as an 80 bit extended float
	exp := 16383 + 63
	man := uint64(rate)
	for man&(1<<63) == 0 {
		man <<= 1
		exp--
	}
	binary.Write(&comm, binary.BigEndian, uint16(exp))
	binary.Write(&comm, binary.BigEndian, man)
	form := "AIFF"
	if aifc != "" {
		form = "AIFC"
		comm.WriteString(aifc)
		comm.Write([]byte{0, 0})
	}
	var f bytes.Buffer
	f.WriteString("FORM")
	binary.Write(&f, binary.BigEndian, uint32(4+8+comm.Len()+8+8+data.Len()))
	f.WriteString(form + "COMM")
	binary.Write(&f, binary.BigEndian, uint32(comm.Len()))
	f.Write(comm.Bytes())
	f.WriteString("SSND")
	binary.Write(&f, binary.BigEndian, uint32(8+data.Len()))
	f.Write(make([]byte, 8))
	f.Write(data.Bytes())
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, f.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Every form Live's libraries hold a sample in is read: its facts, its
// outline (quiet where the file is quiet, loud where it is loud) and its
// sound.
func TestAudioFileReadsEveryForm(t *testing.T) {
	dir := t.TempDir()
	tone := testTone(44100)
	cases := []struct {
		name string
		make func(p string)
		bits int
		ch   int
	}{
		{"pcm16-stereo.wav", func(p string) { writeWav(t, p, tone, 44100, 2, 16, false, false) }, 16, 2},
		{"pcm24-mono.wav", func(p string) { writeWav(t, p, tone, 44100, 1, 24, false, false) }, 24, 1},
		{"pcm8-mono.wav", func(p string) { writeWav(t, p, tone, 44100, 1, 8, false, false) }, 8, 1},
		{"pcm32-stereo.wav", func(p string) { writeWav(t, p, tone, 44100, 2, 32, false, false) }, 32, 2},
		{"float32.wav", func(p string) { writeWav(t, p, tone, 44100, 2, 32, true, false) }, 32, 2},
		{"extensible24.wav", func(p string) { writeWav(t, p, tone, 44100, 2, 24, false, true) }, 24, 2},
		{"plain.aif", func(p string) { writeAiff(t, p, tone, 44100, 2, "") }, 16, 2},
		{"twos.aifc", func(p string) { writeAiff(t, p, tone, 44100, 1, "twos") }, 16, 1},
		{"sowt.aif", func(p string) { writeAiff(t, p, tone, 44100, 2, "sowt") }, 16, 2},
	}
	for _, c := range cases {
		p := filepath.Join(dir, c.name)
		c.make(p)
		in, err := readAudioInfo(p)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if in.Rate != 44100 || in.Channels != c.ch || in.Bits != c.bits || in.Frames != 44100 || math.Abs(in.Seconds-1) > 1e-6 {
			t.Errorf("%s: read as %d Hz, %d ch, %d bit, %d frames", c.name, in.Rate, in.Channels, in.Bits, in.Frames)
		}
		pk, err := in.peaksOf(p, 100)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if pk.Max[2] > 0.06 || pk.Max[97] < 0.9 || pk.Min[97] > -0.9 || pk.Max[50] < 0.4 || pk.Max[50] > 0.6 {
			t.Errorf("%s: the outline is not the ramp: start %.2f, middle %.2f, end %.2f / %.2f", c.name, pk.Max[2], pk.Max[50], pk.Max[97], pk.Min[97])
		}
		pcm, err := decodePreview(p, 44100, 0.5)
		if err != nil || len(pcm) != 44100 { // half a second, stereo
			t.Errorf("%s: preview of %d samples, err %v", c.name, len(pcm), err)
			continue
		}
		if d := math.Abs(float64(pcm[2*20000] - tone[20000])); d > 0.02 {
			t.Errorf("%s: sample 20000 is %.3f, the tone has %.3f", c.name, pcm[2*20000], tone[20000])
		}
	}
}

// A file at another rate plays at the device's rate, at its own pitch and
// length.
func TestPreviewResamples(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.wav")
	writeWav(t, p, testTone(22050), 22050, 1, 16, false, false) // one second at 22.05 kHz
	pcm, err := decodePreview(p, 44100, 5)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(pcm) / 2; n < 44000 || n > 44200 {
		t.Fatalf("one second at 22.05 kHz became %d frames at 44.1 kHz", n)
	}
}

// A long file's outline is sampled, and still finds where it is loud.
func TestPeaksOfALongFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "long.wav")
	writeWav(t, p, testTone(44100*20), 44100, 1, 16, false, false)
	in, err := readAudioInfo(p)
	if err != nil {
		t.Fatal(err)
	}
	pk, _ := in.peaksOf(p, 100)
	if pk.Max[1] > 0.05 || pk.Max[98] < 0.9 {
		t.Fatalf("outline start %.2f end %.2f", pk.Max[1], pk.Max[98])
	}
}

// What is no audio file is not one, and says so without failing.
func TestAudioFileOfSomethingElse(t *testing.T) {
	p := filepath.Join(t.TempDir(), "notes.txt")
	os.WriteFile(p, []byte("not a sound"), 0o644)
	if _, err := readAudioInfo(p); err == nil {
		t.Fatal("a text file read as audio")
	}
	if af := audioFiles.get(p); af.Info != nil || af.Peaks != nil {
		t.Fatal("a text file has an outline")
	}
	if got := clockTime(1.42); got != "0:01.42" {
		t.Fatalf("1.42 s shown as %q", got)
	}
	if got := clockTime(75); got != "1:15" {
		t.Fatalf("75 s shown as %q", got)
	}
}
