package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestKeptStatesComeBackOnceForTheSameLive(t *testing.T) {
	dir, now := t.TempDir(), time.Now()
	held, cur := `{"chain":"saved"}`, `{"chain":"edited"}`
	write := func() {
		if err := writeKeptStates(dir, "920@4711", []keptEntry{{Key: stateKey(held), Module: "minijv", State: cur}}); err != nil {
			t.Fatal(err)
		}
	}

	write()
	k := loadKeptStates(dir, "920@4711", now)
	if _, err := os.Stat(filepath.Join(dir, keptStatesFile)); err == nil {
		t.Error("the file stays: a later start would meet an old state")
	}
	if _, ok := k.take(held, "obxd", now); ok {
		t.Error("a state crossed modules")
	}
	if _, ok := k.take(`{"chain":"other"}`, "minijv", now); ok {
		t.Error("a device whose plugin holds another state got this one")
	}
	if st, ok := k.take(held, "minijv", now); !ok || st != cur {
		t.Errorf("the device's state from before the restart: %q %v", st, ok)
	}
	if _, ok := k.take(held, "minijv", now); ok {
		t.Error("one kept state, given twice")
	}

	write() // Live restarted in between: the Set's state is the truth
	if _, ok := loadKeptStates(dir, "1500@9000", now).take(held, "minijv", now); ok {
		t.Error("a kept state survived a restart of Live")
	}
	write() // Live not running
	if _, ok := loadKeptStates(dir, "", now).take(held, "minijv", now); ok {
		t.Error("a kept state given with no Live known")
	}
	write() // the Set loaded again later in the same Live
	k = loadKeptStates(dir, "920@4711", now)
	if _, ok := k.take(held, "minijv", now.Add(keptWindow+time.Second)); ok {
		t.Error("a kept state given long after the start")
	}

	// two devices of one module that Live holds the same state for: one each
	if err := writeKeptStates(dir, "1@1", []keptEntry{{stateKey(held), "minijv", "a"}, {stateKey(held), "minijv", "b"}}); err != nil {
		t.Fatal(err)
	}
	k = loadKeptStates(dir, "1@1", now)
	a, _ := k.take(held, "minijv", now)
	b, _ := k.take(held, "minijv", now)
	if a != "a" || b != "b" {
		t.Errorf("twins: %q %q", a, b)
	}

	// nothing to keep removes what was there
	write()
	writeKeptStates(dir, "920@4711", nil) //nolint:errcheck
	if _, err := os.Stat(filepath.Join(dir, keptStatesFile)); err == nil {
		t.Error("an empty keep left the old file")
	}
}
