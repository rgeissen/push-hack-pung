package main

// live.go: Pung's link to Live through the PushHack Remote Script
// (127.0.0.1:7704, JSON lines; push-hack docs/pushhack-remote-script.md).
//
//   - tempo and transport: Live's MIDI clock on the "Pung" port is the
//     precise source (Sync on); without it, Live's tempo and beat from the
//     script keep synced modules near the grid instead of at 120 BPM.
//   - selection: a Live track whose MIDI output is port "Pung", channel N
//     IS slot N's track. Selecting it selects slot N on the Push.
//   - tracks: on request (never on its own), make or find slot N's tracks.
//
// Every call runs on Live's engine thread: topics, never a polling loop.

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const liveAddr = "127.0.0.1:7704"

type live struct {
	h         *Host
	connected atomic.Bool
	tempo     atomic.Uint64 // float64 bits
	playing   atomic.Bool
	onSelect  func(slot int) // set by the surface: follow Live's selection

	once sync.Once
	ls   *liveState

	mu       sync.Mutex
	lastSel  int
	selSlot  int // slot of Live's selected track, -1 none
	lastErr  string
	script   string
}

func newLive(h *Host) *live { return &live{h: h, lastSel: -2, selSlot: -1} }

// call is one request on its own connection.
func liveCall(ns, cmd string, args map[string]any) (json.RawMessage, error) {
	c, err := net.DialTimeout("tcp", liveAddr, 2*time.Second)
	if err != nil {
		return nil, errNoScript
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(6 * time.Second))
	req := map[string]any{"id": 1, "ns": ns, "cmd": cmd}
	for k, v := range args {
		req[k] = v
	}
	b, _ := json.Marshal(req)
	if _, err := c.Write(append(b, '\n')); err != nil {
		return nil, err
	}
	line, err := bufio.NewReader(c).ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	var resp struct {
		OK    bool            `json:"ok"`
		Error string          `json:"error"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, err
	}
	if !resp.OK {
		return resp.Data, &scriptError{Code: resp.Error, Data: resp.Data}
	}
	return resp.Data, nil
}

var errNoScript = errors.New("the PushHack Remote Script does not answer: select PushHack in a control-surface slot in Live's settings")

type scriptError struct {
	Code string
	Data json.RawMessage
}

func (e *scriptError) Error() string {
	var d struct {
		Side, What, Want string
		Options          []string
	}
	if json.Unmarshal(e.Data, &d) == nil && len(d.Options) > 0 {
		return fmt.Sprintf("%s: Live has no %s %q here; it offers: %s", e.Code, d.What, d.Want, strings.Join(d.Options, ", "))
	}
	return e.Code
}

// run keeps a subscription open and follows the topics.
func (l *live) run(done <-chan struct{}) {
	for {
		err := l.session(done)
		l.connected.Store(false)
		select {
		case <-done:
			return
		case <-time.After(5 * time.Second):
		}
		l.mu.Lock()
		if err != nil && err.Error() != l.lastErr {
			log.Printf("live: %v", err)
			l.lastErr = err.Error()
		}
		l.mu.Unlock()
	}
}

func (l *live) session(done <-chan struct{}) error {
	c, err := net.DialTimeout("tcp", liveAddr, 2*time.Second)
	if err != nil {
		return errNoScript
	}
	defer c.Close()
	go func() { <-done; c.Close() }()
	w := bufio.NewWriter(c)
	send := func(m map[string]any) error {
		b, _ := json.Marshal(m)
		w.Write(append(b, '\n'))
		return w.Flush()
	}
	if err := send(map[string]any{"id": 1, "cmd": "hello"}); err != nil {
		return err
	}
	if err := send(map[string]any{"id": 2, "cmd": "subscribe", "topics": []string{"tempo", "transport", "selection", "device", "scale", "tracks"}}); err != nil {
		return err
	}
	l.connected.Store(true)
	l.mu.Lock()
	l.lastErr = ""
	l.mu.Unlock()
	log.Printf("live: connected to the PushHack Remote Script")
	r := bufio.NewReaderSize(c, 1<<20)
	for {
		line, err := r.ReadBytes('\n')
		if err != nil {
			return fmt.Errorf("Remote Script connection closed: %w", err)
		}
		var ev struct {
			ID    int             `json:"id"`
			T     string          `json:"t"`
			Topic string          `json:"topic"`
			Data  json.RawMessage `json:"data"`
		}
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		if ev.ID == 1 {
			var hello struct {
				ScriptVersion string `json:"script_version"`
			}
			var resp struct {
				Data json.RawMessage `json:"data"`
			}
			json.Unmarshal(line, &resp)
			json.Unmarshal(resp.Data, &hello)
			l.mu.Lock()
			l.script = hello.ScriptVersion
			l.mu.Unlock()
		}
		if ev.T != "event" {
			continue
		}
		switch ev.Topic {
		case "tempo":
			var d struct{ Tempo float64 }
			if json.Unmarshal(ev.Data, &d) == nil && d.Tempo > 0 {
				l.tempo.Store(floatBits(d.Tempo))
				if !l.h.clockSeen() {
					setTempo(d.Tempo)
				}
			}
		case "transport":
			var d struct {
				Playing bool
				Tempo   float64
				Beat    float64
			}
			if json.Unmarshal(ev.Data, &d) == nil {
				l.playing.Store(d.Playing)
				if !l.h.clockSeen() {
					// the MIDI clock is better; this keeps synced modules near
					// the grid when the port's Sync is off
					if d.Playing {
						setClock(2, d.Beat)
					} else {
						setClock(1, -1)
					}
				}
			}
		case "device":
			l.state().setDevice(ev.Data)
		case "scale":
			l.state().setScale(ev.Data)
		case "tracks":
			l.state().setTracks(ev.Data)
		case "selection":
			var d struct {
				Track any `json:"track"`
			}
			if json.Unmarshal(ev.Data, &d) == nil {
				go l.followSelection(trackIndex(d.Track))
			}
		}
	}
}

func trackIndex(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case map[string]any:
		if i, ok := t["index"].(float64); ok {
			return int(i)
		}
	}
	return -1
}

var chanRe = regexp.MustCompile(`(\d+)`)

// followSelection asks Live where the selected track sends its MIDI.
func (l *live) followSelection(track int) {
	l.mu.Lock()
	if track == l.lastSel {
		l.mu.Unlock()
		return
	}
	l.lastSel = track
	l.mu.Unlock()
	slot := -1
	if track >= 0 {
		if data, err := liveCall("track", "routing", map[string]any{"track": track}); err == nil {
			slot = slotOfRouting(data)
		}
	}
	l.mu.Lock()
	l.selSlot = slot
	cb := l.onSelect
	l.mu.Unlock()
	if slot >= 0 && cb != nil {
		cb(slot)
	}
}

// slotOfRouting: output port "Pung", channel "Ch. N" is slot N.
func slotOfRouting(data json.RawMessage) int {
	var r map[string]any
	if json.Unmarshal(data, &r) != nil {
		return -1
	}
	find := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := r[k].(string); ok {
				return v
			}
			if m, ok := r[k].(map[string]any); ok {
				for _, kk := range []string{"name", "display_name", "current"} {
					if v, ok := m[kk].(string); ok {
						return v
					}
				}
			}
		}
		return ""
	}
	outType := find("output_type", "output_routing_type")
	if out, ok := r["output"].(map[string]any); ok && outType == "" {
		outType, _ = out["type"].(string)
		if ch, ok := out["channel"].(string); ok {
			r["output_channel"] = ch
		}
	}
	if !strings.HasPrefix(strings.ToLower(outType), "pung") {
		return -1
	}
	ch := find("output_channel", "output_routing_channel")
	m := chanRe.FindString(ch)
	n, err := strconv.Atoi(m)
	if err != nil || n < 1 || n > maxSlots {
		return -1
	}
	return n - 1
}

// ensureTracks makes or finds Pung track i's MIDI track in the Set: a
// MIDI track that sends to port Pung on channel i+1.
//
// It does NOT make the audio return. On 2026-11-14, Live 13.0b25 on the Push
// crashed (SIGSEGV, "snd_pcm_wait error") within a second of the Remote
// Script creating an audio track for it, with Link Audio on. The settings
// the user had just made were lost with it (Live saves them only on a clean
// quit). Until it is known whether the crash is the audio track or its
// PushHack input, the user makes the audio return by hand.
func ensureTracks(i int) (map[string]any, error) {
	name := fmt.Sprintf("Pung %d", i+1)
	args := map[string]any{
		"kind": "midi", "name": name,
		"output_type": "Pung", "output_channel": []string{fmt.Sprintf("Ch. %d", i+1)},
	}
	midi, err := liveCall("track", "ensure", args)
	var se *scriptError
	if errors.As(err, &se) && se.Code == "bad_routing" {
		// a track Live just made offers its routing a moment later
		time.Sleep(500 * time.Millisecond)
		midi, err = liveCall("track", "ensure", args)
	}
	if err != nil {
		return nil, fmt.Errorf("MIDI track: %w", err)
	}
	return map[string]any{"midi": json.RawMessage(midi),
		"audio": fmt.Sprintf("make an audio track by hand: input PushHack, channel %s, Monitor In", name)}, nil
}

func (l *live) status() map[string]any {
	l.mu.Lock()
	defer l.mu.Unlock()
	return map[string]any{"connected": l.connected.Load(), "script": l.script, "selected_slot": l.selSlot + 1,
		"tempo": floatFromBits(l.tempo.Load()), "playing": l.playing.Load()}
}
