package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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

// pung.live changes switches, never where Pung reads its modules from
func TestSiteSettings(t *testing.T) {
	h := &Host{settings: loadSettings(t.TempDir())}
	mux := http.NewServeMux()
	h.settingsRoutes(mux)
	post := func(origin, body string) int {
		r := httptest.NewRequest("POST", "/api/settings", strings.NewReader(body))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w.Code
	}
	if c := post("https://pung.live", `{"own_pack_only": true}`); c != 200 || !h.settings.get().OwnPackOnly {
		t.Errorf("a switch from pung.live: %d", c)
	}
	if c := post("https://pung.live", `{"catalog_url": "https://example.org/c.json"}`); c != 403 || h.settings.get().CatalogURL != "" {
		t.Errorf("the catalog address from pung.live: %d %q", c, h.settings.get().CatalogURL)
	}
	if c := post("", `{"catalog_url": "https://example.org/c.json"}`); c != 200 {
		t.Errorf("the catalog address from Pung's own page: %d", c)
	}
}
