package main

import "testing"

// A setting survives a restart; a document naming one field leaves the rest.
func TestSettingsPersist(t *testing.T) {
	dir := t.TempDir()
	st := loadSettings(dir)
	if st.get().TouchCard {
		t.Fatal("the detail card defaults to on")
	}
	if _, err := st.update([]byte(`{"touch_card": true}`)); err != nil {
		t.Fatal(err)
	}
	if !loadSettings(dir).get().TouchCard {
		t.Fatal("not saved")
	}
	if _, err := st.update([]byte(`{}`)); err != nil || !st.get().TouchCard {
		t.Fatalf("an empty document changed it (%v)", err)
	}
	if _, err := st.update([]byte(`{"touch_card": "yes"}`)); err == nil {
		t.Fatal("a wrong type was taken")
	}
}
