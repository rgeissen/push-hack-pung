package main

// modpack.go: where the modules come from. A Pung release carries a module
// pack (catalog/ beside the binary: every module, installed from the Push's
// own disk), and pung.live serves the current pack. Online, Pung takes the
// newer of the two; a module whose package came with Pung is still installed
// from the disk, and only what is new since this release is downloaded.
// Offline, or with pung.live down, Pung goes on with the pack it carries.
//
// A served pack is code for the Push from the internet, so it is taken only
// when signed with Pung's pack key (scripts/packsign; the private half is
// the owner's and is in no repository): a pack that is not, a changed one or
// an older one leaves Pung with what it has. A package is checked against
// the pack's checksum before it is unpacked, as before.
//
// A module may ask for a newer Pung (min_pung): an older Pung offers the
// version its own pack has, or none.

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// packURL: the pack pung.live serves (a var for the tests)
var packURL = "https://pung.live/catalog/catalog.json"

// PUNG_PACK_URL: another address for the pack (a staging copy before a
// launch). It must be signed with the same key: the address is no secret.
func init() {
	if v := os.Getenv("PUNG_PACK_URL"); v != "" {
		packURL = v
	}
}

// packKey: the public half of Pung's pack key (a var for the tests)
var packKey = mustPackKey("LM3sFLTEKYdrVh9O0auJkXvcaMSYFkI+OEHfE7h2oJk=")

func mustPackKey(b64 string) ed25519.PublicKey {
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || len(b) != ed25519.PublicKeySize {
		panic("modpack: the pack key is not a key")
	}
	return ed25519.PublicKey(b)
}

// verifyPack: doc is signed with Pung's pack key (sig: base64, as packsign writes it)
func verifyPack(doc, sig []byte) error {
	s, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || len(s) != ed25519.SignatureSize {
		return errors.New("its signature is not one")
	}
	if !ed25519.Verify(packKey, doc, s) {
		return errors.New("it is not signed with Pung's key")
	}
	return nil
}

func readURL(ctx context.Context, url string, limit int64) ([]byte, error) {
	body, err := openURL(ctx, url)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	return io.ReadAll(io.LimitReader(body, limit))
}

func parsePack(raw []byte) (*catalogDoc, error) {
	var doc catalogDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	if doc.CatalogVersion != 1 {
		return nil, fmt.Errorf("catalog version %d: this Pung reads version 1", doc.CatalogVersion)
	}
	return &doc, nil
}

// packNewer: a was made after b (their generated_at; one that says nothing is the older)
func packNewer(a, b string) bool {
	ta, ea := time.Parse(time.RFC3339, a)
	tb, eb := time.Parse(time.RFC3339, b)
	if ea != nil {
		return false
	}
	return eb != nil || ta.After(tb)
}

// pungTooOld: the module asks for a newer Pung than this one
func pungTooOld(e catalogEntry) bool {
	return e.MinPung != "" && buildVersion != "dev" && versionLess(buildVersion, e.MinPung)
}

// servedPack: pung.live's pack, checked; raw and its signature are kept for
// a start without the internet
func (mm *modMgr) servedPack() (*catalogDoc, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	raw, err := readURL(ctx, packURL, 8<<20)
	var sig []byte
	if err == nil {
		sig, err = readURL(ctx, packURL+".sig", 1<<10)
	}
	if err == nil {
		err = verifyPack(raw, sig)
	}
	if err != nil {
		// the last one that was read and checked (checked again: the file is on a disk)
		craw, e1 := os.ReadFile(mm.path("pack.json"))
		csig, e2 := os.ReadFile(mm.path("pack.json.sig"))
		if e1 == nil && e2 == nil && verifyPack(craw, csig) == nil {
			if doc, perr := parsePack(craw); perr == nil {
				doc.BaseURL = strings.TrimSuffix(packURL, "/catalog.json")
				return doc, fmt.Errorf("pung.live: %v (the pack as last read)", err)
			}
		}
		return nil, fmt.Errorf("pung.live: %v", err)
	}
	doc, err := parsePack(raw)
	if err != nil {
		return nil, fmt.Errorf("pung.live: %v", err)
	}
	if doc.BaseURL == "" {
		doc.BaseURL = strings.TrimSuffix(packURL, "/catalog.json")
	}
	writeFileAtomic(mm.path("pack.json"), raw)
	writeFileAtomic(mm.path("pack.json.sig"), sig)
	return doc, nil
}

// catalogPack: the newer of Pung's own pack and pung.live's
func (mm *modMgr) catalogPack(force bool) {
	mm.mu.Lock()
	fresh := mm.cat != nil && !mm.catOffline && mm.catSource != "" && time.Since(mm.catFetched) < catalogTTL
	mm.mu.Unlock()
	if fresh && !force {
		return
	}
	// Pung's own
	var own *catalogDoc
	ownErr := ""
	local := map[string]string{} // a package on this Push's disk, by its checksum
	ownByID := map[string]catalogEntry{}
	if u := bundledCatalog(); u != "" {
		p := strings.TrimPrefix(u, "file://")
		raw, err := os.ReadFile(p)
		if err == nil {
			own, err = parsePack(raw)
		}
		if err != nil {
			ownErr = fmt.Sprintf("the pack that came with Pung: %v", err)
		} else {
			if own.BaseURL == "" {
				own.BaseURL = "file://" + filepath.Dir(p)
			}
			for _, e := range own.Modules {
				ownByID[e.ID] = e
				if e.SHA256 != "" {
					local[e.SHA256] = strings.TrimSuffix(own.BaseURL, "/") + "/" + e.Asset
				}
			}
		}
	}
	// pung.live's
	var served *catalogDoc
	servedErr := ""
	if !mm.h.settings.get().OwnPackOnly {
		var err error
		if served, err = mm.servedPack(); err != nil {
			servedErr = err.Error()
		}
	}
	doc, source, url := own, "pung", bundledCatalog()
	if served != nil && (own == nil || packNewer(served.GeneratedAt, own.GeneratedAt)) {
		doc, source, url = served, "pung.live", packURL
		// a module that asks for a newer Pung: the version this Pung came with, if it had one
		for i, e := range doc.Modules {
			if o, ok := ownByID[e.ID]; ok && pungTooOld(e) && !pungTooOld(o) {
				doc.Modules[i] = o
			}
		}
	}
	mm.mu.Lock()
	defer mm.mu.Unlock()
	if doc == nil {
		mm.catOffline = true
		mm.catErr = strings.TrimSpace(ownErr + " " + servedErr)
		if mm.catErr == "" {
			mm.catErr = "no module pack: Pung's release carries one (catalog/ beside the binary)"
		}
		return
	}
	mm.cat, mm.catURL, mm.catFetched, mm.catOffline, mm.catErr = doc, url, time.Now(), false, ""
	mm.local, mm.catSource, mm.packErr = local, source, servedErr
	raw, _ := json.Marshal(map[string]any{"fetched": mm.catFetched, "url": url, "doc": doc})
	writeFileAtomic(mm.path("catalog-cache.json"), raw)
}
