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

// writeAbletonTags writes the tag file of every folder Pung's racks are in
// (tagsOf: a class's tags, by its module). A folder with no tagged rack
// loses its file. Files and folders get the owner of presets, as the racks
// do (Live runs as ableton). Returns how many files changed.
func writeAbletonTags(presets, vendor string, classes []*livedevice.Class, tagsOf func(c *livedevice.Class) []string) (int, error) {
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
	uid, gid := -1, -1
	if st, err := os.Stat(presets); err == nil {
		if s, ok := st.Sys().(*syscall.Stat_t); ok {
			uid, gid = int(s.Uid), int(s.Gid)
		}
	}
	changed := 0
	for dir, items := range folders {
		infoDir := filepath.Join(dir, "Ableton Folder Info")
		path := filepath.Join(infoDir, folderInfoName)
		if len(items) == 0 {
			if os.Remove(path) == nil {
				changed++
			}
			continue
		}
		data := renderFolderInfo(items)
		if old, err := os.ReadFile(path); err == nil && bytes.Equal(old, data) {
			continue
		}
		if err := os.MkdirAll(infoDir, 0o755); err != nil {
			return changed, err
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			return changed, err
		}
		if err := os.Rename(tmp, path); err != nil {
			return changed, err
		}
		if uid >= 0 {
			os.Chown(infoDir, uid, gid) //nolint:errcheck
			os.Chown(path, uid, gid)    //nolint:errcheck
		}
		changed++
	}
	return changed, nil
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
