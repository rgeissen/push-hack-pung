package main

// abletontags.go: Live's browser tags for Pung's devices. Live 12 files a
// browser item under its tags (Devices|Synthesizer|FM, Devices|Reverb, ...)
// from XMP files in an "Ableton Folder Info" folder beside the items, the
// way packs in the User Library carry theirs. Pung writes one beside each of
// its rack folders (livedevice.WritePresets), so its devices sit in Push's
// and Live's browser where Ableton's own devices of their kind are.
//
// The tags are ableton-tags.json's: a module's own, else its catalog
// category and traits, else its kind; every one from Live's vocabulary.

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"syscall"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

//go:embed ableton-tags.json
var abletonTagsJSON []byte

type abletonTagTable struct {
	Modules    map[string][]string `json:"modules"`
	Categories map[string][]string `json:"categories"`
	Traits     map[string][]string `json:"traits"`
	Kinds      map[string][]string `json:"kinds"`
	Vocabulary []string            `json:"vocabulary"`
}

var abletonTagsTable = func() abletonTagTable {
	var t abletonTagTable
	if err := json.Unmarshal(abletonTagsJSON, &t); err != nil {
		panic("ableton-tags.json: " + err.Error())
	}
	return t
}()

// abletonTags: a module's tags in Live's browser. kind is its component type;
// subcategory and traits are its catalog entry's (empty when it has none).
func abletonTags(id, kind, subcategory string, traits []string) []string {
	t := abletonTagsTable
	if tags, ok := t.Modules[id]; ok {
		return append([]string(nil), tags...)
	}
	var out []string
	add := func(tags []string) {
		for _, s := range tags {
			if !slices.Contains(out, s) {
				out = append(out, s)
			}
		}
	}
	add(t.Categories[subcategory])
	for _, tr := range traits {
		add(t.Traits[tr])
	}
	if len(out) == 0 {
		add(t.Kinds[kind])
	}
	return out
}

// folderInfoName is the name Live gives a folder's XMP file in the User
// Library (the same in every folder of a pack: a fixed name, not a hash).
const folderInfoName = "dc66a3fa-0fe1-5352-91cf-3ec237e9ee90.xmp"

// rackFolder and rackFile: where livedevice.WritePresets puts a class's
// rack, and its file name there (presets.go: presetFolder, safeName).
func rackFolder(presets, vendor string, c *livedevice.Class) string {
	var top string
	switch c.Kind {
	case livedevice.Instrument, livedevice.MIDI:
		top = "Instruments"
	case livedevice.Effect:
		top = "Audio Effects"
	default:
		return ""
	}
	folder := c.Folder
	if folder == "" {
		folder = vendor
	}
	return filepath.Join(presets, top, rackName(folder))
}

var rackUnsafe = regexp.MustCompile(`[^\w .()-]`)

func rackName(s string) string { return rackUnsafe.ReplaceAllString(s, "_") }

// renderFolderInfo: a folder's XMP, as Live writes one (items sorted, so the
// file only changes when the tags do).
func renderFolderInfo(items map[string][]string) []byte {
	names := make([]string, 0, len(items))
	for n := range items {
		names = append(names, n)
	}
	sort.Strings(names)
	var b bytes.Buffer
	b.WriteString(`<x:xmpmeta xmlns:ablFR="https://ns.ableton.com/xmp/fs-resources/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="adobe:ns:meta/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" x:xmptk="XMP Core 5.6.0">
   <rdf:RDF>
      <rdf:Description rdf:about="">
         <dc:format>application/vnd.ableton.folder</dc:format>
         <ablFR:resource>folder</ablFR:resource>
         <ablFR:platform>mac</ablFR:platform>
         <ablFR:items>
            <rdf:Bag>
`)
	for _, n := range names {
		fmt.Fprintf(&b, "               <rdf:li rdf:parseType=\"Resource\">\n                  <ablFR:filePath>%s</ablFR:filePath>\n                  <ablFR:keywords>\n                     <rdf:Bag>\n", html.EscapeString(n))
		for _, t := range items[n] {
			fmt.Fprintf(&b, "                        <rdf:li>%s</rdf:li>\n", html.EscapeString(t))
		}
		b.WriteString("                     </rdf:Bag>\n                  </ablFR:keywords>\n               </rdf:li>\n")
	}
	b.WriteString(`            </rdf:Bag>
         </ablFR:items>
      </rdf:Description>
   </rdf:RDF>
</x:xmpmeta>
`)
	return b.Bytes()
}

// The folder's XMP is LIVE's file, not Pung's: Live keeps there what the
// user gives an item too (the collections it is in, tags of their own),
// and other items of the folder (racks the user saved beside Pung's).
// Pung writing the whole file from its own tags wiped that at every start:
// a device put in a collection was out of it after a restart (reported
// 2026-11-16). So Pung MERGES: it adds its tags to its own items, takes
// back only tags it wrote before itself (wrote, kept in Pung's data), and
// leaves every other byte of the file as Live wrote it. A file that needs
// nothing is not touched at all.

var (
	xmpItemPath  = regexp.MustCompile(`(?s)<ablFR:filePath>(.*?)</ablFR:filePath>`)
	xmpKeywords  = regexp.MustCompile(`(?s)[ \t]*<ablFR:keywords>.*?</ablFR:keywords>[ \t]*\n?`)
	xmpKeyword   = regexp.MustCompile(`(?s)<rdf:li>(.*?)</rdf:li>`)
	xmpItemsOpen = regexp.MustCompile(`(?s)<ablFR:items>\s*<rdf:Bag>[ \t]*\n?`)
	xmpItemsEnd  = regexp.MustCompile(`(?s)[ \t]*</rdf:Bag>\s*</ablFR:items>`)
	xmpLiTag     = regexp.MustCompile(`<rdf:li\b[^>]*>|</rdf:li>`)
)

// xmpItems splits the body of a folder's items bag into its items (each
// "<rdf:li ...> ... </rdf:li>", nested ones inside it) with the text
// between them. ok false: not the shape Live writes.
func xmpItems(body string) (items []string, ok bool) {
	depth, start := 0, -1
	for _, m := range xmpLiTag.FindAllStringIndex(body, -1) {
		tag := body[m[0]:m[1]]
		switch {
		case strings.HasPrefix(tag, "</"):
			depth--
			if depth < 0 {
				return nil, false
			}
			if depth == 0 {
				items = append(items, body[start:m[1]])
			}
		case strings.HasSuffix(tag, "/>"):
			if depth == 0 {
				items = append(items, tag)
			}
		default:
			if depth == 0 {
				start = m[0]
			}
			depth++
		}
	}
	return items, depth == 0
}

func xmpItemKeywords(item string) []string {
	var out []string
	if blk := xmpKeywords.FindString(item); blk != "" {
		for _, m := range xmpKeyword.FindAllStringSubmatch(blk, -1) {
			out = append(out, html.UnescapeString(strings.TrimSpace(m[1])))
		}
	}
	return out
}

func xmpKeywordBlock(tags []string) string {
	var b strings.Builder
	b.WriteString("                  <ablFR:keywords>\n                     <rdf:Bag>\n")
	for _, t := range tags {
		fmt.Fprintf(&b, "                        <rdf:li>%s</rdf:li>\n", html.EscapeString(t))
	}
	b.WriteString("                     </rdf:Bag>\n                  </ablFR:keywords>\n")
	return b.String()
}

// mergeFolderInfo: old (Live's file, or nil) with Pung's tags as they
// should be now (want: file -> tags) in place of the ones Pung wrote
// before (wrote). Everything else in old stays byte for byte. changed
// false: nothing to do. ok false: old is not a file Pung can read, and it
// is left alone.
func mergeFolderInfo(old []byte, want, wrote map[string][]string) (data []byte, changed, ok bool) {
	if len(bytes.TrimSpace(old)) == 0 {
		if len(want) == 0 {
			return nil, false, true
		}
		return renderFolderInfo(want), true, true
	}
	src := string(old)
	open, end := xmpItemsOpen.FindStringIndex(src), xmpItemsEnd.FindStringIndex(src)
	if open == nil || end == nil || end[0] < open[1] {
		return nil, false, false
	}
	body := src[open[1]:end[0]]
	items, shaped := xmpItems(body)
	if !shaped {
		return nil, false, false
	}
	seen := map[string]bool{}
	out := body
	for _, item := range items {
		m := xmpItemPath.FindStringSubmatch(item)
		if m == nil {
			continue
		}
		file := html.UnescapeString(strings.TrimSpace(m[1]))
		seen[file] = true
		have := xmpItemKeywords(item)
		// Pung's own first, as it wants them now; then the user's and
		// Live's: what is there and Pung never wrote
		next := append([]string(nil), want[file]...)
		for _, k := range have {
			if !slices.Contains(next, k) && !slices.Contains(wrote[file], k) {
				next = append(next, k)
			}
		}
		same := len(next) == len(have)
		for _, k := range next {
			same = same && slices.Contains(have, k)
		}
		if same {
			continue
		}
		var repl string
		switch blk := xmpKeywords.FindString(item); {
		case blk != "" && len(next) > 0:
			repl = strings.Replace(item, blk, xmpKeywordBlock(next), 1)
		case blk != "":
			repl = strings.Replace(item, blk, "", 1)
		default: // no keywords yet: after the file's name
			at := xmpItemPath.FindStringIndex(item)[1]
			repl = item[:at] + "\n" + strings.TrimSuffix(xmpKeywordBlock(next), "\n") + item[at:]
		}
		out = strings.Replace(out, item, repl, 1)
		changed = true
	}
	// Pung's items the file does not have yet, after the others
	var missing []string
	for file, tags := range want {
		if !seen[file] && len(tags) > 0 {
			missing = append(missing, file)
		}
	}
	sort.Strings(missing)
	for _, file := range missing {
		if out != "" && !strings.HasSuffix(out, "\n") {
			out += "\n"
		}
		out += fmt.Sprintf("               <rdf:li rdf:parseType=\"Resource\">\n                  <ablFR:filePath>%s</ablFR:filePath>\n%s               </rdf:li>\n",
			html.EscapeString(file), xmpKeywordBlock(want[file]))
		changed = true
	}
	if !changed {
		return nil, false, true
	}
	return []byte(src[:open[1]] + out + src[end[0]:]), true, true
}

// tagsWrittenFile: what Pung wrote into each folder's file, so it can take
// its own tags back later and nobody else's (Pung's data, not Live's folder).
const tagsWrittenFile = "browser-tags.json"

// writeAbletonTags puts Pung's tags into the tag file of every folder its
// racks are in (tagsOf: a class's tags, by its module), merged into what
// Live keeps there (mergeFolderInfo). stateDir holds what Pung wrote
// ("": nothing is remembered, so tags are only ever added). Files and
// folders get the owner of presets, as the racks do (Live runs as
// ableton). Returns how many files changed.
func writeAbletonTags(presets, vendor string, classes []*livedevice.Class, tagsOf func(c *livedevice.Class) []string, stateDir string) (int, error) {
	folders := map[string]map[string][]string{}
	for _, c := range classes {
		dir := rackFolder(presets, vendor, c)
		if dir == "" {
			continue
		}
		if folders[dir] == nil {
			folders[dir] = map[string][]string{}
		}
		if tags := tagsOf(c); len(tags) > 0 {
			folders[dir][rackName(c.Name)+".adg"] = tags
		}
	}
	wrote := map[string]map[string][]string{} // folder -> file -> tags
	statePath := ""
	if stateDir != "" {
		statePath = filepath.Join(stateDir, tagsWrittenFile)
		if raw, err := os.ReadFile(statePath); err == nil {
			json.Unmarshal(raw, &wrote) //nolint:errcheck
		}
	}
	uid, gid := -1, -1
	if st, err := os.Stat(presets); err == nil {
		if s, ok := st.Sys().(*syscall.Stat_t); ok {
			uid, gid = int(s.Uid), int(s.Gid)
		}
	}
	changed := 0
	var firstErr error
	for dir, items := range folders {
		infoDir := filepath.Join(dir, "Ableton Folder Info")
		path := filepath.Join(infoDir, folderInfoName)
		old, _ := os.ReadFile(path)
		data, differs, ok := mergeFolderInfo(old, items, wrote[dir])
		if !ok {
			log.Printf("devices: browser tags: %s is not a file Pung can read; left as it is", path)
			continue
		}
		wrote[dir] = items
		if !differs {
			continue
		}
		if err := os.MkdirAll(infoDir, 0o755); err != nil {
			firstErr = err
			break
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			firstErr = err
			break
		}
		if err := os.Rename(tmp, path); err != nil {
			firstErr = err
			break
		}
		if uid >= 0 {
			os.Chown(infoDir, uid, gid) //nolint:errcheck
			os.Chown(path, uid, gid)    //nolint:errcheck
		}
		changed++
	}
	if statePath != "" {
		if raw, err := json.MarshalIndent(wrote, "", " "); err == nil {
			os.WriteFile(statePath, raw, 0o644) //nolint:errcheck
		}
	}
	return changed, firstErr
}

// tagsForClass: a class's tags, from its module (Ref), its kind and its
// catalog entry when the catalog knows it.
func (h *Host) tagsForClass(c *livedevice.Class) []string {
	kind := map[string]string{livedevice.Instrument: "sound_generator", livedevice.Effect: "audio_fx", livedevice.MIDI: "midi_fx"}[c.Kind]
	sub, traits := "", []string(nil)
	if h.mods != nil {
		if e, ok := h.mods.entry(c.Ref); ok {
			sub, traits = e.Subcategory, e.Tags
			kind = strings.TrimSpace(e.ComponentType)
		}
	}
	return abletonTags(c.Ref, kind, sub, traits)
}
