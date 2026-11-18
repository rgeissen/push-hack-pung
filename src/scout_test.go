package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// fakeSynth: a module that names only the sound it has loaded. lag: reads
// after a choice that still answer the sound before's name.
type fakeSynth struct {
	banks map[string][]string
	bank  string
	at    int
	lag   int
	stale int
	old   string
	sets  []string
}

func (f *fakeSynth) chain() scoutChain {
	return scoutChain{
		set: func(k, v string) {
			f.sets = append(f.sets, k+"="+v)
			switch k {
			case "preset":
				f.old = f.banks[f.bank][f.at]
				f.at, _ = strconv.Atoi(v)
				f.stale = f.lag
			case "bank_index":
				i, _ := strconv.Atoi(v)
				f.bank = fmt.Sprintf("Bank %c", 'A'+i)
				f.at = 0
			}
		},
		get: func(k string) (string, bool) {
			switch k {
			case "preset":
				return strconv.Itoa(f.at), true
			case "preset_count":
				return strconv.Itoa(len(f.banks[f.bank])), true
			case "bank_name":
				return f.bank, true
			case "preset_name":
				if f.stale > 0 {
					f.stale--
					return f.old, true
				}
				return f.banks[f.bank][f.at], true
			}
			return "", false
		},
		pause: func(time.Duration) {},
	}
}

var scoutList = presetList{List: "preset", Count: "preset_count", Name: "preset_name"}

func TestWalkNamesReadsEveryName(t *testing.T) {
	f := &fakeSynth{banks: map[string][]string{"Bank A": {"Strings 1 ", "Strings 2", "Organ", "Organ", "Brass"}}, bank: "Bank A"}
	names, err := walkNames(f.chain(), scoutJob{List: scoutList, Count: 5, Bank: "Bank A", BankKey: "bank_name"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Strings 1", "Strings 2", "Organ", "Organ", "Brass"}
	if fmt.Sprint(names) != fmt.Sprint(want) {
		t.Fatalf("names %q, want %q", names, want)
	}
}

// A module that applies a choice in its own time answers the sound before's
// name for a few reads: the walk must not write that down.
func TestWalkNamesWaitsForASlowModule(t *testing.T) {
	f := &fakeSynth{banks: map[string][]string{"Bank A": {"One", "Two", "Three"}}, bank: "Bank A", lag: 3}
	names, err := walkNames(f.chain(), scoutJob{List: scoutList, Count: 3, BankKey: "bank_name"})
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(names) != "[One Two Three]" {
		t.Fatalf("names %q", names)
	}
}

// The device's bank is chosen before the walk; a hidden instance that cannot
// reach it names nothing (its names would be another bank's).
func TestWalkNamesChoosesTheBank(t *testing.T) {
	banks := map[string][]string{"Bank A": {"A1", "A2"}, "Bank B": {"B1", "B2"}}
	f := &fakeSynth{banks: banks, bank: "Bank A"}
	names, err := walkNames(f.chain(), scoutJob{List: scoutList, Count: 2, Bank: "Bank B", BankKey: "bank_name", Set: [][2]string{{"bank_index", "1"}}})
	if err != nil || fmt.Sprint(names) != "[B1 B2]" {
		t.Fatalf("names %q, err %v", names, err)
	}
	f = &fakeSynth{banks: banks, bank: "Bank A"}
	if names, err := walkNames(f.chain(), scoutJob{List: scoutList, Count: 2, Bank: "Bank B", BankKey: "bank_name"}); err == nil {
		t.Fatalf("walked the wrong bank: %q", names)
	}
	f = &fakeSynth{banks: banks, bank: "Bank A"}
	if names, err := walkNames(f.chain(), scoutJob{List: scoutList, Count: 7, BankKey: "bank_name"}); err == nil {
		t.Fatalf("walked a list of another length: %q", names)
	}
}

// A plain bank parameter (Osirus: bank_index beside the list) changes the
// list, so its names are kept per bank; a filter bank is not one.
func TestBankParamsAndTheirNamesKey(t *testing.T) {
	cm := &compMeta{Params: map[string]*paramMeta{
		"preset":      {Key: "preset", Type: "int"},
		"bank_index":  {Key: "bank_index", Type: "int"},
		"filterbank":  {Key: "filterbank", Type: "int"},
		"bank_volume": {Key: "bank_volume", Type: "float"},
	}, Order: []string{"preset", "bank_index", "filterbank", "bank_volume"}}
	if got := bankParams(cm, "preset"); fmt.Sprint(got) != "[bank_index]" {
		t.Fatalf("bank params %q", got)
	}
	lib := &soundLib{}
	pl := presetList{List: "preset", BankKeys: []string{"bank_index"}}
	a := lib.listBank(pl, &factoryView{Bank: "Bank A"})
	b := lib.listBank(pl, &factoryView{Bank: "Bank B"})
	if a == b {
		t.Fatalf("two banks share the names key %q", a)
	}
	if one := lib.listBank(presetList{List: "preset"}, &factoryView{Bank: "Bank A"}); one != lib.listBank(presetList{List: "preset"}, &factoryView{Bank: "Bank B"}) {
		t.Fatal("a list with no bank parameter keyed by its bank's name")
	}
}

// A catalog module is a link to its folder: its key must follow the link, or
// an update is never probed again.
func TestScreenKeyFollowsALinkedModule(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real")
	os.MkdirAll(real, 0o755)                                          //nolint:errcheck
	os.WriteFile(filepath.Join(real, "dsp.so"), []byte("one"), 0o644) //nolint:errcheck
	link := filepath.Join(dir, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skip(err)
	}
	a := screenKey(ModuleInfo{ID: "x", Dir: link})
	os.WriteFile(filepath.Join(real, "dsp.so"), []byte("another build"), 0o644) //nolint:errcheck
	if b := screenKey(ModuleInfo{ID: "x", Dir: link}); a == b {
		t.Fatal("the key of a linked module did not change with its files")
	}
	if screenKey(ModuleInfo{ID: "x", Dir: link}) != screenKey(ModuleInfo{ID: "x", Dir: real}) {
		t.Fatal("a module's key differs by how its folder is reached")
	}
}

// The module tree is asked for many times a frame: it is read once while
// nothing changes, and again when a module is added.
func TestScanModulesIsKept(t *testing.T) {
	root := t.TempDir()
	add := func(id string) {
		d := filepath.Join(root, "sound_generators", id)
		os.MkdirAll(d, 0o755)                                                                           //nolint:errcheck
		os.WriteFile(filepath.Join(d, "module.json"), []byte(`{"id":"`+id+`","name":"`+id+`"}`), 0o644) //nolint:errcheck
	}
	add("one")
	if n := len(scanModules(root)); n != 1 {
		t.Fatalf("%d modules, want 1", n)
	}
	a := scanModules(root)
	a[0].ID = "changed by the caller"
	if scanModules(root)[0].ID != "one" {
		t.Fatal("a caller could change the kept list")
	}
	time.Sleep(5 * time.Millisecond) // a folder's time has to move
	add("two")
	if n := len(scanModules(root)); n != 2 {
		t.Fatalf("%d modules after one was added, want 2", n)
	}
}
