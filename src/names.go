package main

// names.go: pages for a module that publishes no sections. Its keys are
// grouped by what their names say (amp_attack, amp_decay -> AMP;
// cutoff, filter_type -> FILTER), in the module's own order, and packed
// onto pages of 8 without splitting a group across two pages unless it is
// larger than a page. The alternative, chunks of 8 named PAGE 1..24, made a
// 185-parameter synth unusable (JE-8086, 2026-11-15).
//
// Names only group; they never reorder. chain_params order is the module's
// own, and an author who lists cutoff after the filter's type meant it.

import (
	"regexp"
	"strings"
	"unicode"
)

// synonyms: a name's first word -> the section it belongs to.
var synonyms = map[string]string{
	"filter": "FILTER", "flt": "FILTER", "vcf": "FILTER", "tvf": "FILTER", "cutoff": "FILTER",
	"cut": "FILTER", "resonance": "FILTER", "res": "FILTER", "reso": "FILTER",
	"amp": "AMP", "vca": "AMP", "tva": "AMP",
	"env": "ENVELOPE", "eg": "ENVELOPE", "envelope": "ENVELOPE", "adsr": "ENVELOPE",
	"osc": "OSC", "oscillator": "OSC", "dco": "OSC", "wave": "OSC",
	"lfo": "LFO", "mod": "MOD", "modulation": "MOD",
	"chorus": "CHORUS", "chr": "CHORUS", "delay": "DELAY", "dly": "DELAY",
	"reverb": "REVERB", "rev": "REVERB", "verb": "REVERB", "fx": "FX", "eq": "EQ",
	"arp": "ARP", "seq": "SEQ",
	"portamento": "PLAY", "porta": "PLAY", "glide": "PLAY", "bend": "PLAY", "mono": "PLAY",
	"legato": "PLAY", "poly": "PLAY", "unison": "PLAY", "voice": "PLAY",
	"sys": "SYSTEM", "system": "SYSTEM", "ctl": "CONTROL", "ctrl": "CONTROL",
	"vel": "VELOCITY", "velocity": "VELOCITY", "pitch": "PITCH", "tone": "TONE", "noise": "NOISE",
}

var letterDigit = regexp.MustCompile(`^([a-z]+)(\d+)$`)

// sectionName: the section a word names, and whether it is a known one.
// osc2 -> OSC 2, lfo1 -> LFO 1, op3 -> OP 3, patchCommon -> PATCH COMMON.
func sectionName(word string) (string, bool) {
	w := strings.ToLower(word)
	if m := letterDigit.FindStringSubmatch(w); m != nil {
		base, known := synonyms[m[1]]
		if !known {
			base = strings.ToUpper(m[1])
		}
		return base + " " + m[2], known || len(m[1]) <= 3 // op3, ch2: short stems are names too
	}
	if s, ok := synonyms[w]; ok {
		return s, true
	}
	var b strings.Builder // camelCase -> words
	for i, r := range word {
		if i > 0 && unicode.IsUpper(r) {
			b.WriteByte(' ')
		}
		b.WriteRune(unicode.ToUpper(r))
	}
	return b.String(), false
}

// planByNames: banks for keys, grouped by their names.
func planByNames(keys []string) []bank {
	// a first word most keys share says nothing (Mini-JV's "nvram_")
	first := map[string]int{}
	for _, k := range keys {
		first[strings.SplitN(k, "_", 2)[0]]++
	}
	noise := ""
	for w, n := range first {
		if len(keys) >= 8 && n*10 > len(keys)*6 {
			noise = w
		}
	}
	words := func(k string) []string {
		t := strings.Split(k, "_")
		if len(t) > 1 && t[0] == noise {
			t = t[1:]
		}
		return t
	}
	return numberRepeats(packRuns(groupRuns(keys, words, 0)))
}

// numberRepeats: pages that share a name say which of them they are,
// FILTER 1/2 and FILTER 2/2.
func numberRepeats(banks []bank) []bank {
	count := map[string]int{}
	for _, b := range banks {
		count[b.Name]++
	}
	seen := map[string]int{}
	for i, b := range banks {
		if n := count[b.Name]; n > 1 && b.Name != "" {
			seen[b.Name]++
			banks[i].Name = b.Name + " " + itoa(seen[b.Name]) + "/" + itoa(n)
		}
	}
	return banks
}

func isNumber(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

type run struct {
	name  string // "" for keys that name no section
	known bool   // the name is a known section (not just a word)
	keys  []string
	pages []bank // a run larger than a page, already cut into named pages
}

// groupRuns: adjacent keys of one section, in order. A run larger than a
// page is planned again on the words after its first, and its pages named
// "SECTION : SUBSECTION".
func groupRuns(keys []string, words func(string) []string, depth int) []run {
	var runs []run
	for _, k := range keys {
		t := words(k)
		name, known := "", false
		if len(t) > 0 {
			name, known = sectionName(t[0])
		}
		if len(t) < 2 && !known {
			name = "" // one unknown word: a key of its own, not a section
		}
		if n := len(runs); n > 0 && runs[n-1].name == name && name != "" {
			runs[n-1].keys = append(runs[n-1].keys, k)
			continue
		}
		runs = append(runs, run{name: name, known: known, keys: []string{k}})
	}
	// an unknown word on one key is not a section either (buffer_ms)
	for i := range runs {
		if len(runs[i].keys) == 1 && !runs[i].known {
			runs[i].name = ""
		}
	}
	// a run larger than a page: its own pages, by the next word
	for i := range runs {
		r := &runs[i]
		if r.name == "" || len(r.keys) <= 8 {
			continue
		}
		var sub []bank
		if depth < 1 { // one level: CONTROL: FILTER, never CONTROL: FILTER: ENVELOPE
			rest := func(k string) []string {
				t := words(k)
				if len(t) > 1 {
					return t[1:]
				}
				return t
			}
			sub = packRuns(groupRuns(r.keys, rest, depth+1))
		}
		named := 0
		for _, b := range sub {
			if b.Name != "" {
				named++
			}
		}
		if len(sub) == 0 || named*2 < len(sub) { // no deeper level, or the next word does not group them: plain pages
			sub = nil
			for j := 0; j < len(r.keys); j += 8 {
				sub = append(sub, bank{Keys: r.keys[j:min(j+8, len(r.keys))]})
			}
		}
		for j := range sub {
			switch {
			case sub[j].Name != "" && isNumber(sub[j].Name):
				sub[j].Name = r.name + " " + sub[j].Name // TONE 0, not TONE: 0
			case sub[j].Name != "":
				sub[j].Name = r.name + ": " + sub[j].Name
			default:
				sub[j].Name = r.name
			}
		}
		r.pages = sub
	}
	return runs
}

// packRuns: runs onto pages of 8. A section stays on one page when it
// fits; small sections and loose keys share a page.
func packRuns(runs []run) []bank {
	var out []bank
	var cur bank
	var names []string
	flush := func() {
		if len(cur.Keys) == 0 {
			return
		}
		switch {
		case len(names) == 0:
			cur.Name = ""
		case len(names) <= 2:
			cur.Name = strings.Join(names, " / ")
		default:
			cur.Name = names[0] + " / " + names[1] + " +"
		}
		out = append(out, cur)
		cur, names = bank{}, nil
	}
	for _, r := range runs {
		if r.pages != nil {
			flush()
			out = append(out, r.pages...)
			continue
		}
		if len(cur.Keys)+len(r.keys) > 8 {
			flush()
		}
		cur.Keys = append(cur.Keys, r.keys...)
		if r.name != "" && !contains(names, r.name) {
			names = append(names, r.name)
		}
	}
	flush()
	return out
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}
