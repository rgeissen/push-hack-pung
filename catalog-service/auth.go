package main

// auth.go: one admin. The admin page is public (admin.<your-domain>, behind
// DSM's reverse proxy, HTTPS), so:
//
//   - the account is made once, with a setup code that only the container's
//     log shows (DSM: Docker > Container > Details > Log);
//   - the password is stored as Argon2id, never as text;
//   - a session is a random 256-bit token in a Secure, HttpOnly,
//     SameSite=Strict cookie, for 12 hours;
//   - five failed logins from one address in 15 minutes lock that address out
//     for 15 minutes; every failure costs a second;
//   - a request that changes something must carry X-Pung-Admin (a header a
//     cross-site form cannot set) on top of the SameSite cookie.

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	sessionTTL   = 12 * time.Hour
	cookieName   = "pung_admin"
	maxFailures  = 5
	failureSpan  = 15 * time.Minute
	minPassword  = 12
	csrfHeader   = "X-Pung-Admin"
	argonTime    = 3
	argonMemory  = 64 * 1024 // KiB
	argonThreads = 2
)

type account struct {
	User string `json:"user"`
	Salt string `json:"salt"`
	Hash string `json:"hash"`
	// the parameters it was hashed with, so they can change later
	Time    uint32 `json:"time"`
	Memory  uint32 `json:"memory"`
	Threads uint8  `json:"threads"`
}

type session struct {
	Expires time.Time `json:"expires"`
}

type auth struct {
	dir string

	mu       sync.Mutex
	acct     *account
	sessions map[string]session
	setup    string // the setup code while no account exists
	fails    map[string][]time.Time
}

func newAuth(dir string) *auth {
	a := &auth{dir: dir, sessions: map[string]session{}, fails: map[string][]time.Time{}}
	if raw, err := os.ReadFile(filepath.Join(dir, "admin.json")); err == nil {
		var ac account
		if json.Unmarshal(raw, &ac) == nil && ac.Hash != "" {
			a.acct = &ac
		}
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "sessions.json")); err == nil {
		json.Unmarshal(raw, &a.sessions) //nolint:errcheck
	}
	if a.acct == nil {
		a.setup = randomHex(5)
	}
	return a
}

func (a *auth) announceSetup() {
	if a.setup != "" {
		log.Printf("pung-catalog: no admin yet. Open the admin page and use the setup code %s", a.setup)
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hashPassword(pass, salt string, t, m uint32, p uint8) string {
	return hex.EncodeToString(argon2.IDKey([]byte(pass), []byte(salt), t, m, p, 32))
}

func (a *auth) needsSetup() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.acct == nil
}

func (a *auth) createAccount(code, user, pass string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.acct != nil {
		return errors.New("there is an admin already")
	}
	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(code)), []byte(a.setup)) != 1 {
		return errors.New("that is not the setup code (it is in the container's log)")
	}
	if err := checkPassword(user, pass); err != nil {
		return err
	}
	ac := &account{User: strings.TrimSpace(user), Salt: randomHex(16), Time: argonTime, Memory: argonMemory, Threads: argonThreads}
	ac.Hash = hashPassword(pass, ac.Salt, ac.Time, ac.Memory, ac.Threads)
	if err := a.saveAccount(ac); err != nil {
		return err
	}
	a.acct, a.setup = ac, ""
	log.Printf("pung-catalog: admin %q created", ac.User)
	return nil
}

func checkPassword(user, pass string) error {
	if strings.TrimSpace(user) == "" {
		return errors.New("a user name, please")
	}
	if len([]rune(pass)) < minPassword {
		return errors.New("a password of at least 12 characters, please")
	}
	if strings.EqualFold(pass, user) {
		return errors.New("the password cannot be the user name")
	}
	return nil
}

func (a *auth) saveAccount(ac *account) error {
	raw, _ := json.MarshalIndent(ac, "", " ")
	tmp := filepath.Join(a.dir, "admin.json.tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(a.dir, "admin.json"))
}

func (a *auth) changePassword(old, pass string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.acct == nil || !a.matches(a.acct.User, old) {
		return errors.New("the current password is not right")
	}
	if err := checkPassword(a.acct.User, pass); err != nil {
		return err
	}
	ac := *a.acct
	ac.Salt = randomHex(16)
	ac.Time, ac.Memory, ac.Threads = argonTime, argonMemory, argonThreads
	ac.Hash = hashPassword(pass, ac.Salt, ac.Time, ac.Memory, ac.Threads)
	if err := a.saveAccount(&ac); err != nil {
		return err
	}
	a.acct = &ac
	a.sessions = map[string]session{} // everyone signs in again
	a.saveSessions()
	return nil
}

// matches: under a.mu.
func (a *auth) matches(user, pass string) bool {
	ac := a.acct
	if ac == nil {
		return false
	}
	h := hashPassword(pass, ac.Salt, ac.Time, ac.Memory, ac.Threads)
	okUser := subtle.ConstantTimeCompare([]byte(strings.TrimSpace(user)), []byte(ac.User)) == 1
	okPass := subtle.ConstantTimeCompare([]byte(h), []byte(ac.Hash)) == 1
	return okUser && okPass
}

// login: a session token, or why not.
func (a *auth) login(ip, user, pass string) (string, error) {
	a.mu.Lock()
	recent := a.recentFailures(ip)
	if recent >= maxFailures {
		a.mu.Unlock()
		return "", errors.New("too many failed attempts: try again in 15 minutes")
	}
	ok := a.matches(user, pass)
	if !ok {
		a.fails[ip] = append(a.fails[ip], time.Now())
		a.mu.Unlock()
		time.Sleep(time.Second)
		log.Printf("pung-catalog: failed login from %s", ip)
		return "", errors.New("that user name and password do not match")
	}
	delete(a.fails, ip)
	tok := randomHex(32)
	a.sessions[tok] = session{Expires: time.Now().Add(sessionTTL)}
	a.saveSessions()
	a.mu.Unlock()
	log.Printf("pung-catalog: admin signed in from %s", ip)
	return tok, nil
}

func (a *auth) recentFailures(ip string) int {
	var keep []time.Time
	for _, t := range a.fails[ip] {
		if time.Since(t) < failureSpan {
			keep = append(keep, t)
		}
	}
	a.fails[ip] = keep
	return len(keep)
}

func (a *auth) logout(tok string) {
	a.mu.Lock()
	delete(a.sessions, tok)
	a.saveSessions()
	a.mu.Unlock()
}

func (a *auth) valid(tok string) bool {
	if tok == "" {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[tok]
	if !ok {
		return false
	}
	if time.Now().After(s.Expires) {
		delete(a.sessions, tok)
		a.saveSessions()
		return false
	}
	return true
}

// saveSessions: under a.mu.
func (a *auth) saveSessions() {
	for k, s := range a.sessions {
		if time.Now().After(s.Expires) {
			delete(a.sessions, k)
		}
	}
	raw, _ := json.Marshal(a.sessions)
	tmp := filepath.Join(a.dir, "sessions.json.tmp")
	if os.WriteFile(tmp, raw, 0o600) == nil {
		os.Rename(tmp, filepath.Join(a.dir, "sessions.json")) //nolint:errcheck
	}
}

// isHTTPS: the request reached us over HTTPS (directly, or through the
// reverse proxy). The cookie is Secure then; on the home network, straight
// to the container's port over HTTP, a Secure cookie would never come back.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func setSession(w http.ResponseWriter, r *http.Request, tok string) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: tok, Path: "/", HttpOnly: true, Secure: isHTTPS(r),
		SameSite: http.SameSiteStrictMode, MaxAge: int(sessionTTL.Seconds())})
}

func clearSession(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, Secure: isHTTPS(r),
		SameSite: http.SameSiteStrictMode, MaxAge: -1})
}

func sessionOf(r *http.Request) string {
	if c, err := r.Cookie(cookieName); err == nil {
		return c.Value
	}
	return ""
}

// clientIP: the address that asked. Behind DSM's reverse proxy the request
// comes from a private address and X-Forwarded-For names the client; the
// header is believed only then.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsPrivate() || ip.IsLoopback()) {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			parts := strings.Split(fwd, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
		if real := r.Header.Get("X-Real-IP"); real != "" {
			return strings.TrimSpace(real)
		}
	}
	return host
}

// timeNow: the clock (tests set failures in the past or present).
var timeNow = time.Now
