package main

// abletontags_test.go: every tag is one of Live's, every module in the
// catalog has its own, and the files are what Live reads.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

func TestAbletonTagsAreLives(t *testing.T) {
	t.Parallel()
	vocab := map[string]bool{}
	for _, v := range abletonTagsTable.Vocabulary {
		vocab[v] = true
	}
	check := func(where string, tags []string) {
		for _, tag := range tags {
			if !vocab[tag] {
				t.Errorf("%s: %q is not a tag Live uses", where, tag)
			}
		}
	}
	for id, tags := range abletonTagsTable.Modules {
		check("module "+id, tags)
		if len(tags) == 0 {
			t.Errorf("module %s: no tags", id)
		}
		if len(tags) > 4 {
			t.Errorf("module %s: %d tags (Ableton gives its own devices one to four)", id, len(tags))
		}
	}
	for k, tags := range abletonTagsTable.Categories {
		check("category "+k, tags)
	}
	for k, tags := range abletonTagsTable.Traits {
		check("trait "+k, tags)
	}
	for k, tags := range abletonTagsTable.Kinds {
		check("kind "+k, tags)
	}
}

// Every module of the catalog Pung ships is tagged by hand, not by a rule.
func TestEveryCatalogModuleIsTagged(t *testing.T) {
	raw, err := os.ReadFile("../build/catalog/catalog.json")
	if err != nil {
		t.Skip("no build/catalog/catalog.json here")
	}
	var doc catalogDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, m := range doc.Modules {
		if _, ok := abletonTagsTable.Modules[m.ID]; !ok {
			t.Errorf("%s (%s, %s) has no tags of its own in ableton-tags.json", m.ID, m.ComponentType, m.Subcategory)
		}
		if _, ok := abletonTagsTable.Categories[m.Subcategory]; m.Subcategory != "" && !ok {
			t.Errorf("category %s (of %s) has no rule", m.Subcategory, m.ID)
		}
	}
}

func TestAbletonTagRules(t *testing.T) {
	if got := strings.Join(abletonTags("dexed", "sound_generator", "fm", nil), ","); got != "Devices|Synthesizer|FM,Devices|Vintage Emulation" {
		t.Errorf("dexed: %s", got)
	}
	// a module the table does not name: its category, then its traits
	if got := strings.Join(abletonTags("newverb", "audio_fx", "reverb", []string{"lo-fi", "vintage-emulation"}), ","); got != "Devices|Reverb,Character|Lofi & Vinyl,Devices|Vintage Emulation" {
		t.Errorf("a new reverb: %s", got)
	}
	// no catalog entry at all: its kind
	if got := strings.Join(abletonTags("mystery", "sound_generator", "", nil), ","); got != "Devices|Synthesizer" {
		t.Errorf("an unknown synth: %s", got)
	}
}

func TestWriteAbletonTags(t *testing.T) {
	presets, state := t.TempDir(), t.TempDir()
	classes := []*livedevice.Class{
		{Name: "Dexed", Kind: livedevice.Instrument, Ref: "dexed"},
		{Name: "PSX Verb", Kind: livedevice.Effect, Ref: "psxverb"},
		{Name: "Arpeggiator Track", Kind: livedevice.MIDI, Ref: "arp", Folder: "Pung MIDI Effects"},
	}
	tagsOf := func(c *livedevice.Class) []string { return abletonTags(c.Ref, "", "", nil) }
	n, err := writeAbletonTags(presets, "Pung", classes, tagsOf, state)
	if err != nil || n != 3 {
		t.Fatalf("wrote %d files: %v", n, err)
	}
	path := filepath.Join(presets, "Instruments", "Pung", "Ableton Folder Info", folderInfoName)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, want := range []string{"<dc:format>application/vnd.ableton.folder</dc:format>", "<ablFR:filePath>Dexed.adg</ablFR:filePath>",
		"<rdf:li>Devices|Synthesizer|FM</rdf:li>"} {
		if !strings.Contains(s, want) {
			t.Errorf("Instruments/Pung's file has no %s", want)
		}
	}
	raw, _ = os.ReadFile(filepath.Join(presets, "Audio Effects", "Pung", "Ableton Folder Info", folderInfoName))
	if !strings.Contains(string(raw), "<rdf:li>Character|Lofi &amp; Vinyl</rdf:li>") {
		t.Error("an & is not escaped as Live writes it")
	}
	if n, _ := writeAbletonTags(presets, "Pung", classes, tagsOf, state); n != 0 {
		t.Errorf("unchanged tags rewrote %d files", n)
	}
}

// The folder's file is Live's: what the user gave an item there (a
// collection, a tag of their own), an item Pung does not know, and Live's
// own way of writing it all survive Pung's start, byte for byte.
func TestAbletonTagsKeepWhatLiveWrote(t *testing.T) {
	presets, state := t.TempDir(), t.TempDir()
	classes := []*livedevice.Class{
		{Name: "Dexed", Kind: livedevice.Instrument, Ref: "dexed"},
		{Name: "Braids", Kind: livedevice.Instrument, Ref: "braids"},
	}
	tags := map[string][]string{"dexed": {"Devices|Synthesizer|FM", "Devices|Vintage Emulation"}, "braids": {"Devices|Synthesizer"}}
	tagsOf := func(c *livedevice.Class) []string { return tags[c.Ref] }
	if n, err := writeAbletonTags(presets, "Pung", classes, tagsOf, state); n != 1 || err != nil {
		t.Fatalf("first write: %d %v", n, err)
	}
	path := filepath.Join(presets, "Instruments", "Pung", "Ableton Folder Info", folderInfoName)
	// Live rewrites the file its own way: Dexed in a collection (as a
	// keyword and as an element Pung knows nothing of), a rack of the
	// user's beside Pung's, other spacing
	live := `<x:xmpmeta xmlns:ablFR="https://ns.ableton.com/xmp/fs-resources/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="adobe:ns:meta/">
 <rdf:RDF>
  <rdf:Description rdf:about="">
   <ablFR:resource>folder</ablFR:resource>
   <ablFR:items>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <ablFR:filePath>My Own Rack.adg</ablFR:filePath>
      <ablFR:colors><rdf:Bag><rdf:li>3</rdf:li></rdf:Bag></ablFR:colors>
     </rdf:li>
     <rdf:li rdf:parseType="Resource">
      <ablFR:filePath>Dexed.adg</ablFR:filePath>
      <ablFR:colors><rdf:Bag><rdf:li>1</rdf:li></rdf:Bag></ablFR:colors>
      <ablFR:keywords>
       <rdf:Bag>
        <rdf:li>Devices|Vintage Emulation</rdf:li>
        <rdf:li>Devices|Synthesizer|FM</rdf:li>
        <rdf:li>Collections|Favourites &amp; Co</rdf:li>
       </rdf:Bag>
      </ablFR:keywords>
     </rdf:li>
     <rdf:li rdf:parseType="Resource">
      <ablFR:filePath>Braids.adg</ablFR:filePath>
      <ablFR:keywords>
       <rdf:Bag>
        <rdf:li>Devices|Synthesizer</rdf:li>
       </rdf:Bag>
      </ablFR:keywords>
     </rdf:li>
    </rdf:Bag>
   </ablFR:items>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
	os.WriteFile(path, []byte(live), 0o644)
	// a restart with nothing of Pung's to change: the file is not touched
	if n, _ := writeAbletonTags(presets, "Pung", classes, tagsOf, state); n != 0 {
		t.Fatalf("Pung rewrote Live's file with nothing to change (%d)", n)
	}
	if raw, _ := os.ReadFile(path); string(raw) != live {
		t.Fatal("Live's file changed")
	}
	// Pung's own tags change (a module's category): its old tag goes, its
	// new one comes, and everything of Live's and the user's stays
	tags["dexed"] = []string{"Devices|Synthesizer|FM", "Devices|Synthesizer|Digital"}
	classes = append(classes, &livedevice.Class{Name: "Hera", Kind: livedevice.Instrument, Ref: "hera"})
	tags["hera"] = []string{"Devices|Vintage Emulation"}
	if n, err := writeAbletonTags(presets, "Pung", classes, tagsOf, state); n != 1 || err != nil {
		t.Fatalf("changed tags: %d %v", n, err)
	}
	raw, _ := os.ReadFile(path)
	got := string(raw)
	for _, keep := range []string{
		"<ablFR:filePath>My Own Rack.adg</ablFR:filePath>\n      <ablFR:colors><rdf:Bag><rdf:li>3</rdf:li></rdf:Bag></ablFR:colors>",
		"<ablFR:colors><rdf:Bag><rdf:li>1</rdf:li></rdf:Bag></ablFR:colors>",
		"<rdf:li>Collections|Favourites &amp; Co</rdf:li>",
		"<rdf:li>Devices|Synthesizer|Digital</rdf:li>",
		"<ablFR:filePath>Hera.adg</ablFR:filePath>",
		"<ablFR:resource>folder</ablFR:resource>",
	} {
		if !strings.Contains(got, keep) {
			t.Errorf("after the merge the file has no %s\n%s", keep, got)
		}
	}
	if strings.Count(got, "Devices|Vintage Emulation") != 1 { // Hera's now; Dexed's is taken back
		t.Errorf("Pung's old tag on Dexed was not taken back (or Hera's is missing):\n%s", got)
	}
	if strings.Count(got, "<ablFR:filePath>") != 4 || strings.Count(got, "<ablFR:items>") != 1 {
		t.Errorf("items lost or doubled:\n%s", got)
	}
	// and it is stable
	if n, _ := writeAbletonTags(presets, "Pung", classes, tagsOf, state); n != 0 {
		t.Errorf("a second start rewrote the file again (%d)", n)
	}
	// a file Pung cannot read is left alone
	os.WriteFile(path, []byte("<x:xmpmeta>something else</x:xmpmeta>"), 0o644)
	if n, _ := writeAbletonTags(presets, "Pung", classes, tagsOf, state); n != 0 {
		t.Error("Pung wrote over a file it could not read")
	}
	if raw, _ := os.ReadFile(path); string(raw) != "<x:xmpmeta>something else</x:xmpmeta>" {
		t.Error("the unreadable file changed")
	}
}
