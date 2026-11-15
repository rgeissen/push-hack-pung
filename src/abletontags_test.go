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
	presets := t.TempDir()
	classes := []*livedevice.Class{
		{Name: "Dexed", Kind: livedevice.Instrument, Ref: "dexed"},
		{Name: "PSX Verb", Kind: livedevice.Effect, Ref: "psxverb"},
		{Name: "Arpeggiator Track", Kind: livedevice.MIDI, Ref: "arp", Folder: "Pung MIDI Effects"},
	}
	tagsOf := func(c *livedevice.Class) []string { return abletonTags(c.Ref, "", "", nil) }
	n, err := writeAbletonTags(presets, "Pung", classes, tagsOf)
	if err != nil || n != 3 {
		t.Fatalf("wrote %d files: %v", n, err)
	}
	raw, err := os.ReadFile(filepath.Join(presets, "Instruments", "Pung", "Ableton Folder Info", folderInfoName))
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
	if n, _ := writeAbletonTags(presets, "Pung", classes, tagsOf); n != 0 {
		t.Errorf("unchanged tags rewrote %d files", n)
	}
	// a folder whose racks lost their tags loses its file
	none := func(*livedevice.Class) []string { return nil }
	if n, _ := writeAbletonTags(presets, "Pung", classes, none); n != 3 {
		t.Errorf("removed %d files, want 3", n)
	}
}
