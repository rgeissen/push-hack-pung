package main

// segments.go: segment mode. A front panel shows the whole instrument (the
// overview); its sections are segments, declared by the screen file
// (push.compartment's segments: [{id, label, rect, keys}]). In the open
// device:
//
//   upper button 7   SEGMENTS: select mode. The lower buttons name the
//                    segments, and Pung marks each one's place on the panel.
//                    Pressed again (or upper button 1, a jog nudge left):
//                    back to the overview
//   a lower button   segment mode: the encoders play that segment's keys
//                    (the panel's own encoder row relabels itself from
//                    v.$knobs); the lower buttons keep naming the segments,
//                    the active one lit, so another is one press away
//   upper button 7   EXIT: back to the overview's encoders and page tabs
//   jog wheel        in segment mode (choosing or in one): the next or
//                    previous segment; it stops at the ends. Elsewhere it
//                    steps pages, and Shift + it walks the segments from the
//                    overview straight away (right: the first, left: the last)
//   jog nudge right  from the overview the first segment, in one the next,
//                    after the last the first again (left is the way out, so
//                    right alone reaches every one). A panel with segments
//                    takes the nudge from a compartment's wheel level
//   jog nudge left   choosing or in a segment: back to the overview
//
// Leaving the device, a page of another compartment and another device
// leave the mode too. Everything Pung draws for it is a few rectangles and
// labels of its own, outside the module's budget.

import (
	"fmt"
	"image"
	"image/color"
	"strings"
	"time"
)

// segmentsButton: the open device's upper button 7 (upper 1 is the way
// back, upper 8 SOUNDS).
const segmentsButton = 6

// segRowY: where Pung's row of segment names begins: the bottom 18 pixels,
// the strip g.knobs leaves its tabs (a panel's encoder row in its tighter
// form ends above it)
const segRowY = scrH - 18

// segment mode's states (surface.segMode)
const (
	segSelect  = "select"
	segSegment = "segment"
)

// segPanel: the shown front panel, when it declares segments and draws.
// Caller holds u.mu.
func (u *surface) segPanel() *ovCompartment {
	if !u.open || !u.liveActive() || u.ov == nil {
		return nil
	}
	p, cm, b := u.currentBank()
	if cm == nil || b == nil {
		return nil
	}
	c := u.takeoverComp(p, b)
	if c == nil || len(c.segments) == 0 {
		return nil
	}
	if set := u.ov.get(u.h.modulesDir, p.Module); set == nil || set.failed != "" || set.off {
		return nil // no panel drawn: Pung's default view, no segments
	}
	return c
}

// segSync: the panel segment mode is on, and the active segment (nil in
// select mode); a mode whose panel is no longer shown is left (another
// page's compartment, the device closed, the screen switched off).
// Caller holds u.mu.
func (u *surface) segSync() (*ovCompartment, *ovSegment) {
	if u.segMode == "" {
		return nil, nil
	}
	c := u.segPanel()
	if c == nil || c.id != u.segComp {
		u.leaveSegments()
		return nil, nil
	}
	if u.segMode != segSegment {
		return c, nil
	}
	s := c.segment(u.segID)
	if s == nil {
		u.leaveSegments()
		return nil, nil
	}
	return c, s
}

// leaveSegments: back to the overview.
func (u *surface) leaveSegments() {
	if u.segMode != "" {
		u.peekUntil = time.Time{} // a card belonged to the segment's knobs
	}
	u.segMode, u.segID, u.segComp = "", "", ""
	u.asg.on = false
}

// encKeys: the keys the encoders play now: the shown page's, or in segment
// mode the segment's. Caller holds u.mu.
func (u *surface) encKeys(b *bank) []string {
	if _, s := u.segSync(); s != nil {
		return s.keys
	}
	if b == nil {
		return nil
	}
	return b.Keys
}

// segmentsPress: upper button 7 in the open device. false: the shown
// screen has no segments (the button does nothing).
func (u *surface) segmentsPress() bool {
	c := u.segPanel()
	if c == nil {
		return false
	}
	u.segSync()
	if u.segMode == "" {
		u.segMode, u.segComp, u.segID = segSelect, c.id, ""
	} else {
		u.leaveSegments() // select: cancel; segment: EXIT
	}
	u.showRows()
	return true
}

// segmentPick: lower button i while the lower row is the segments'. false:
// it is the pages' (no segment mode).
func (u *surface) segmentPick(i int) bool {
	c, _ := u.segSync()
	if c == nil {
		return false
	}
	if i >= 0 && i < len(c.segments) {
		u.segMode, u.segID = segSegment, c.segments[i].id
		u.peekUntil = time.Time{}
		u.showRows() // EXIT stands over upper button 7 for a moment, then a slim bar
	}
	return true // no segment there: nothing, and never a page turn
}

// segActive: segment mode is on (choosing or in a segment) on the shown
// panel. Caller holds u.mu.
func (u *surface) segActive() bool {
	c, _ := u.segSync()
	return c != nil
}

// segStep: the jog wheel in segment mode, or Shift + it: the next (d > 0) or previous segment of
// the shown panel; from the overview or select mode the first (or last).
// false: the panel has no segments (the wheel steps pages as always).
func (u *surface) segStep(d int) bool {
	c := u.segPanel()
	if c == nil || d == 0 {
		return false
	}
	u.segSync()
	i := -1
	if u.segComp == c.id {
		i = u.segCur(c)
	}
	switch {
	case i < 0 && d > 0:
		i = 0
	case i < 0:
		i = len(c.segments) - 1
	default:
		i = max(0, min(len(c.segments)-1, i+d))
	}
	u.segMode, u.segComp, u.segID = segSegment, c.id, c.segments[i].id
	u.peekUntil = time.Time{}
	u.showRows()
	return true
}

// segNext: a jog nudge right: the first segment (from the overview or while
// choosing), then the next, round to the first after the last. false: the
// panel has no segments.
func (u *surface) segNext() bool {
	c := u.segPanel()
	if c == nil {
		return false
	}
	u.segSync()
	i := -1
	if u.segComp == c.id {
		i = u.segCur(c)
	}
	i = (i + 1) % len(c.segments)
	u.segMode, u.segComp, u.segID = segSegment, c.id, c.segments[i].id
	u.peekUntil = time.Time{}
	u.showRows()
	return true
}

// segCur: the active segment's lower button (-1 in select mode or none).
func (u *surface) segCur(c *ovCompartment) int {
	if u.segMode != segSegment {
		return -1
	}
	for i, s := range c.segments {
		if s.id == u.segID {
			return i
		}
	}
	return -1
}

// segList: v.$segments, the compartment's segments for its screen:
// [{id, label, rect: [x, y, w, h], keys}]. Fresh each frame (a script may
// write into what it is given).
func segList(c *ovCompartment) []any {
	out := []any{}
	if c == nil {
		return out
	}
	for _, s := range c.segments {
		keys := make([]any, len(s.keys))
		for i, k := range s.keys {
			keys[i] = k
		}
		out = append(out, map[string]any{"id": s.id, "label": s.label, "keys": keys,
			"rect": []any{s.rect[0], s.rect[1], s.rect[2], s.rect[3]}})
	}
	return out
}

// applySegInfo: what the shown panel is told of segment mode, over
// takeoverInfo's overview: $segmode, $segment, and in a segment its keys as
// $knobs; while the lower row is the segments', $tabs are their names and
// $tab the active one. Caller holds u.mu.
func (u *surface) applySegInfo(info map[string]any, comp *ovCompartment) {
	c, s := u.segSync()
	if c == nil || c != comp {
		return
	}
	info["$segmode"] = u.segMode
	tabs := make([]string, 8)
	for i, sg := range c.segments {
		tabs[i] = sg.label
	}
	info["$tabs"], info["$tab"] = tabs, u.segCur(c)
	if s != nil {
		info["$segment"] = s.id
		knobs := make([]string, 8)
		copy(knobs, s.keys)
		info["$knobs"] = knobs
	}
}

// ---- drawing ------------------------------------------------------------------

// drawSegments: over the shown panel, while the mode is on. Select mode:
// every segment's place, outlined and numbered as its lower button; segment
// mode: the active one outlined (unless the panel highlights it itself,
// draws_segments). Then the segments' names over the lower buttons, the
// active one filled, and SEGMENTS or EXIT over upper button 7.
func (u *surface) drawSegments(img *image.NRGBA, c *ovCompartment, sc color.NRGBA) {
	if c == nil || u.segMode == "" {
		return
	}
	cur := u.segCur(c)
	switch u.segMode {
	case segSelect:
		for i, s := range c.segments {
			markSegment(img, u.segRect(s), 1, sc)
			segTag(img, u.segRect(s), fmt.Sprintf("%d %s", i+1, strings.ToUpper(s.label)), sc)
		}
	case segSegment:
		if cur >= 0 {
			segBar(img, u.segRect(c.segments[cur]), sc)
		}
	}
	rect(img, 0, segRowY, scrW, scrH-segRowY, cBlack)
	drawSegmentRow(img, segRowY+1, 15, c.segments, cur, sc)
	// in a segment no EXIT over the panel, not even with Pung's rows (the
	// jog turned, a page turn): the segment's name filled below and upper
	// 7's white light say the mode, and nudge left leaves it
	if u.segMode == segSegment {
		return
	}
	drawSegmentsButton(img, u.segMode, sc)
}

// segRect: where a segment sits on the panel this frame: where the panel's
// screen put it (g.segment, override.go), else its declared rect.
func (u *surface) segRect(s *ovSegment) [4]int {
	if r, ok := u.segAt[s.id]; ok {
		return r
	}
	return s.rect
}

// markSegment: an outline of width w around r, in the slot's colour between
// two black lines, so it reads over any panel.
func markSegment(img *image.NRGBA, r [4]int, w int, sc color.NRGBA) {
	x, y, ww, hh := r[0], r[1], r[2], r[3]
	if ww <= 0 || hh <= 0 {
		return
	}
	box(img, x-1, y-1, ww+2, hh+2, 1, cBlack)
	box(img, x, y, ww, hh, w, sc)
	box(img, x+w, y+w, ww-2*w, hh-2*w, 1, cBlack)
}

// segBar: the active segment, on every panel alike: a bar in the slot's
// colour just above its top edge, outside it, so it strikes through none of
// the segment's own heading (on the panel's top row, where there is no room
// above, along the edge inside). Nothing of the panel is dimmed or framed:
// the rest stays in view. The same colour as the active segment's name
// below, so the two read as one. A panel may light its own heading of the
// segment too (draws_segments), in its idiom.
func segBar(img *image.NRGBA, r [4]int, sc color.NRGBA) {
	x, w := max(0, r[0]), min(r[2], scrW-max(0, r[0]))
	if w <= 0 || r[3] <= 0 {
		return
	}
	y := r[1] - segBarH
	if y < 1 {
		// the panel's top row: inside, along its top edge (nothing under
		// it: a black line there clips the letters of a heading)
		y = max(0, r[1])
	} else {
		rect(img, x, y-1, w, 1, cBlack) // a black edge: it reads on any ground (Xenia's orange)
	}
	rect(img, x, y, w, segBarH, sc)
}

// segBarH: the active segment's bar
const segBarH = 3

// box: a rectangle's outline, w pixels wide (rect: straight into the pixels).
func box(img *image.NRGBA, x, y, ww, hh, w int, c color.NRGBA) {
	if ww <= 0 || hh <= 0 {
		return
	}
	rect(img, x, y, ww, w, c)
	rect(img, x, y+hh-w, ww, w, c)
	rect(img, x, y, w, hh, c)
	rect(img, x+ww-w, y, w, hh, c)
}

// segTag: a segment's number and name across its top edge, black on the
// slot's colour, the whole width of the segment: a panel's own heading
// there would otherwise read on after the tag ("1 BD SD DRUM").
func segTag(img *image.NRGBA, r [4]int, s string, sc color.NRGBA) {
	x, y := max(0, r[0]), max(0, r[1])
	room := min(r[2]-2, scrW-x) - 8
	if room < 7 {
		room = 7 // at least its number
	}
	s = fitLabel(s, room)
	w := max(textWidth(s, nil)+8, min(r[2], scrW-x))
	rect(img, x, y, w, 14, sc)
	label(img, x+4, y+11, s, cBlack, -1)
}

// drawSegmentRow: the segments' names over the lower buttons (drawPageRow's
// look), the active one filled.
func drawSegmentRow(img *image.NRGBA, y, h int, segs []*ovSegment, cur int, sc color.NRGBA) {
	for j, s := range segs {
		if j >= 8 {
			break
		}
		x, w := j*colW+7, colW-14
		name := fitLabel(strings.ToUpper(s.label), w-12)
		if j == cur {
			rect(img, x, y, w, h, sc)
			label(img, x+8, y+h-3, name, cBlack, -1)
		} else {
			label(img, x+8, y+h-3, name, sc, -1)
		}
	}
}

// drawSegmentsButton: over upper button 7: SEGMENTS where the panel has
// segments (as SOUNDS over 8), filled while the mode is on: SEGMENTS while
// choosing, EXIT in a segment. Filled, it is drawn over the panel itself.
func drawSegmentsButton(img *image.NRGBA, mode string, sc color.NRGBA) {
	x := segmentsButton * colW
	if mode == "" {
		label(img, x+colW/2, 17, "SEGMENTS", sc, 0)
		return
	}
	t := "SEGMENTS"
	if mode == segSegment {
		t = "EXIT"
	}
	rect(img, x+7, 4, colW-14, 17, cBlack)
	rect(img, x+8, 5, colW-16, 15, sc)
	label(img, x+colW/2, 17, t, cBlack, 0)
}
