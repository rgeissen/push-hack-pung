package main

// keyGuard makes a key either down or up for the synth behind it.
//
// Some synths count note-ons per key: JE-8086 (the emulated JP-8000) given
// two note-ons for one key and one note-off keeps a voice sounding for good
// (measured on the Push, 2026-11-16: reported as hanging notes). Two ons for
// one key reach a device whenever two sources hold the same pitch: a clip and
// the pads, two pads of one pitch in a scale layout, a test note beside a
// played one. So a second note-on for a held key first lets the key go, and
// the first note-off after it releases the key whatever the count was.
//
// It is used from the audio thread only (the slot's lock is held there), and
// it allocates nothing.
type keyGuard struct {
	down [16][128]bool
}

// feed passes msg on through send, with a note-off put in front of a note-on
// for a key that is already down. It reports whether it added one.
func (g *keyGuard) feed(msg []byte, send func(msg []byte)) bool {
	if len(msg) < 3 || msg[1] > 127 {
		send(msg)
		return false
	}
	ch, key := msg[0]&0x0F, msg[1]
	added := false
	switch msg[0] & 0xF0 {
	case 0x90:
		if msg[2] == 0 { // a note-on at velocity 0 is a note-off
			g.down[ch][key] = false
			break
		}
		if g.down[ch][key] {
			off := [3]byte{0x80 | ch, key, 0}
			send(off[:])
			added = true
		}
		g.down[ch][key] = true
	case 0x80:
		g.down[ch][key] = false
	case 0xB0:
		if key == 120 || key == 123 { // all sound off, all notes off
			g.down[ch] = [128]bool{}
		}
	}
	send(msg)
	return added
}
