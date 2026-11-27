// packsign: signs the module pack pung.live serves (catalog.json), so that a
// Pung takes a pack only from the holder of Pung's pack key (src/modpack.go
// has the public half; the private one stays with the owner, never in the
// repository).
//
//	packsign keygen KEYFILE        a new key: KEYFILE (private, 0600), its public half printed
//	packsign pub KEYFILE           the public half
//	packsign sign KEYFILE FILE     writes FILE.sig (Ed25519 over FILE's bytes, base64)
//	packsign verify PUB FILE       checks FILE.sig against a public key
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

func die(f string, a ...any) { fmt.Fprintf(os.Stderr, f+"\n", a...); os.Exit(1) }

func key(p string) ed25519.PrivateKey {
	raw, err := os.ReadFile(p)
	if err != nil {
		die("%v", err)
	}
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(b) != ed25519.SeedSize {
		die("%s is not a pack key", p)
	}
	return ed25519.NewKeyFromSeed(b)
}

func main() {
	a := os.Args[1:]
	switch {
	case len(a) == 2 && a[0] == "keygen":
		if _, err := os.Stat(a[1]); err == nil {
			die("%s exists: a new key would lock every Pung out of your packs", a[1])
		}
		seed := make([]byte, ed25519.SeedSize)
		if _, err := rand.Read(seed); err != nil {
			die("%v", err)
		}
		if err := os.WriteFile(a[1], []byte(base64.StdEncoding.EncodeToString(seed)+"\n"), 0o600); err != nil {
			die("%v", err)
		}
		fmt.Println(base64.StdEncoding.EncodeToString(ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)))
	case len(a) == 2 && a[0] == "pub":
		fmt.Println(base64.StdEncoding.EncodeToString(key(a[1]).Public().(ed25519.PublicKey)))
	case len(a) == 3 && a[0] == "sign":
		doc, err := os.ReadFile(a[2])
		if err != nil {
			die("%v", err)
		}
		sig := ed25519.Sign(key(a[1]), doc)
		if err := os.WriteFile(a[2]+".sig", []byte(base64.StdEncoding.EncodeToString(sig)+"\n"), 0o644); err != nil {
			die("%v", err)
		}
	case len(a) == 3 && a[0] == "verify":
		pub, err := base64.StdEncoding.DecodeString(a[1])
		doc, err2 := os.ReadFile(a[2])
		raw, err3 := os.ReadFile(a[2] + ".sig")
		if err != nil || err2 != nil || err3 != nil || len(pub) != ed25519.PublicKeySize {
			die("verify: cannot read the key, the file or its .sig")
		}
		sig, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if !ed25519.Verify(pub, doc, sig) {
			die("NOT signed by this key")
		}
		fmt.Println("signed by this key")
	default:
		die("usage: packsign keygen KEYFILE | pub KEYFILE | sign KEYFILE FILE | verify PUB FILE")
	}
}
