# The secure link: pung.live and a deployment, in every browser

Decided on 2026-11-27 (the owner chose it over serving the coordinator from a deployment, and over a relay
through pung.live). What is built says so; the rest is a plan with decisions the owner has to make.

## Why

pung.live is a secure page (https). A deployment answers on the home network over plain http. A browser lets a
secure page fetch plain http only where it has a permission for that: Chrome and Edge from 142, Firefox from
151, on a computer ("Local Network Access"). Safari has no such permission, and on an iPad or iPhone every
browser is Safari underneath. There, pung.live cannot talk to a deployment at all: no live panel on
Deployments, no install from Modules, no Stacks (the owner's iPad, 2026-11-27).

Secure to secure is allowed everywhere. So a deployment gets a name under a public domain and a certificate
browsers trust, and answers there over https. Plex does the same for its home servers.

## The rule: nothing for the one who installs Pung to do

The owner's word, 2026-11-27: "it must be frictionless for the one that installs Pung". So:

1. **No step after the installer.** Pung gets its name and its certificate by itself at its first start, and
   renews it by itself. Nobody sets a DNS record, a token or a port.
2. **Nothing typed.** pung.live finds the deployments on the visitor's own network: the service knows which
   deployments reported from the same home connection as the visitor's browser, and offers them by name.
3. **One confirmation, on the hardware.** The first time a browser wants to talk to a deployment, the
   deployment asks on its own screen (a Push: a lit button). That is the pairing; no password, no code to
   copy.
4. **No router setting, no browser setting.** Where a router refuses a public name for a home address (a
   Fritz!Box does by default), the link must still come about without the player opening the router: over
   the deployment's public IPv6 address where that is not refused, and failing that over a direct link
   between browser and deployment set up through pung.live (WebRTC, as local file-sharing pages use it:
   it needs no name and no certificate). That fallback is built only if testers' routers ask for it.

What the owner does once, for everybody, is not friction in this sense: the domain, the service.

**Measured on the owner's network (2026-11-27):** a public name for a home IPv4 address
(`192-168-178-55.sslip.io`) and one for the Push's own IPv6 address both resolve through the home's
resolver. This network does not stand in the way.

## How it works

1. **A name.** Each deployment has a random id and a name under a domain of Pung's:
   `<address>.<id>.<domain>`, where `<address>` is its home-network address with dashes
   (`192-168-1-42`). The name resolves, in public DNS, to that address.
2. **A certificate.** The deployment makes its own key and asks a service on pung.live for a certificate for
   `*.<id>.<domain>`. The service proves the name to a public authority (Let's Encrypt, the DNS challenge:
   it controls the domain's DNS) and hands the certificate back. **The private key never leaves the
   deployment.** The certificate is renewed the same way before it runs out.
3. **The deployment answers over https** on the port beside its plain one (7721), with the same page and
   calls, and says its name in `/api/status` ("secure").
4. **pung.live learns the name** when the visitor comes from the deployment's own page (the place switcher
   hands it over, as it hands the plain address over today), and from then on talks to
   `https://<name>:7721`.

## What is built (2026-11-27)

The two halves that do not depend on how a certificate comes to be:

- **The deployment** (`src/secure.go`): Pung serves over TLS when `<data>/tls/cert.pem` and `key.pem` are
  there (a full chain and its key), reads them again when the file changes (a renewal needs no restart),
  and names itself in `/api/status`: `"secure": {"name", "port", "until"}`. A certificate that has run out
  is not offered. `TestSecureLink`.
- **pung.live** (`site/pushlink.js`): an address under one of the secure domains (`SECURE`, today
  `d.pung.live`) is reached over https on 7721 and is accepted when a deployment's page hands it over
  (`#add=`). **Chrome still asks its local-network permission for it** (measured 2026-11-27, Chrome on the
  Mac against the live site: without the permission the fetch fails with
  `LocalNetworkAccessPermissionDenied`, with it the deployment connects): the permission goes by the
  address a name resolves to, not by http or https. So on a computer nothing changes for Chrome, Edge and
  Firefox (one "Allow", once); what the secure link adds is the browsers that have no such permission and
  refuse plain http outright: Safari, and everything on an iPad or iPhone.
- **The place switcher** (`src/web/places.js`): a deployment's page that has a certificate hands pung.live
  its secure name, not its plain address.

Not built: everything that makes a name and a certificate (below).

## The first step: prove it on the owner's iPad, by hand

Before any service is built, one certificate made by hand answers the questions that matter:

- Does Safari on the iPad let pung.live talk to `https://<name>:7721` on the home network?
- Does the home router let a public name resolve to a home-network address? **A Fritz!Box refuses that by
  default** ("DNS-Rebind-Schutz"); it needs the domain entered as an exception, and Plex's users meet the
  same. The Push also has a public IPv6 address; a name that resolves to that one is not refused, but the
  address changes with the provider's prefix.

It needs from the owner: two DNS records at Hostinger for a test name (the address record, and one text
record for the authority's challenge), or an API token for Hostinger's DNS so that Claude can set them. The
certificate is then made on the Mac (the DNS challenge, by hand), copied to the Push
(`/data/push-hack/data/pung/tls/`), and the iPad is tried.

**Done 2026-11-27, as far as the Mac goes.** The test name is `push.d.pung.live` (an A record at Hostinger to
the Push's home address, 192.168.0.134, and the challenge's text record; no AAAA record, so the test says
something about IPv4). The certificate is Let's Encrypt's, made with acme.sh in Docker in its manual DNS
mode (`--issue --dns`, the record set by the owner, then `--renew`); its key and acme.sh's account are in
`~/.config/pung/acme-test/` on the owner's Mac, good until 2027-02-25, renewed by hand the same way (a new
text record each time). On the Push Pung answers `https://push.d.pung.live:7721` with it, the certificate
checks from the Mac, and the live site (published that evening with the place switcher and the secure
names) in Chrome, opened with `#add=push.d.pung.live` and the local-network permission granted, connects
and reads catalog, status, system and settings over https. (A scratch build served from 127.0.0.1 under
pung.live's name connected without the permission: a page that is itself on this machine is not asked,
so that test says nothing about the permission.) Still to see: the same from Safari on the iPad. When the
Push's home address changes, the A record must follow by hand: that is what the service is for.

## What the service needs (after the proof)

| Piece | What | Whose |
|---|---|---|
| A domain of its own | Not under pung.live (below): about 10 euros a year | The owner registers it |
| DNS that answers for every deployment | Either the provider's API (a record per deployment and address), or a small DNS server of Pung's that reads the address out of the name and keeps nothing | The owner chooses; the second needs a server with a fixed address |
| The issuing service | Takes a deployment's request, proves the name, returns the certificate; limits how many one address may ask for | Built here; it runs on a server reachable from the internet (the DiskStation behind its reverse proxy, or a small rented one) |
| Pung's client | Makes the key and the request, fetches and renews the certificate, tells the service its address when it changes | Built here |

## Decisions for the owner

1. **The domain.** A separate one is safer than a part of pung.live: a deployment holds the key for its
   name, and a name under pung.live is "the same site" as pung.live to a browser (cookies, and what a page
   may do to its own site). That matters once pung.live has accounts. Recommended: a domain of its own.
2. **Where the service runs.** The DiskStation at home (free, but pung.live's certificates then depend on
   the home connection) or a small rented server (a few euros a month, a fixed address, and it could answer
   DNS too).
3. **How many deployments, how soon.** Let's Encrypt gives a domain 50 new certificates a week. Enough for
   testers; before a public launch the domain should go on the Public Suffix List (as plex.direct is), which
   lifts that limit per deployment and takes some weeks to be granted.

## What it costs a player's privacy

- A deployment's name is random; its certificate is public (certificate logs list every certificate), so the
  ids are public, not who owns them.
- The home-network address is part of the name the browser asks DNS for. With a DNS server that reads the
  address out of the name, nothing about a deployment is stored anywhere but on the deployment.
- Nothing a deployment plays or holds passes through pung.live: the service sees a request for a
  certificate, and where it came from.

## What stays as it is

- Plain http on the home network works as before, for the deployment's own page and for browsers that have
  the permission. The secure link is added, not swapped in.
- A deployment that is offline keeps its certificate until it runs out (90 days today, shorter in future:
  Let's Encrypt is moving to 45); without one it falls back to plain http and the browsers that allow it.
