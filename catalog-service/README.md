# pung-catalog: the catalog service on the DiskStation

Keeps https://<your-site> current. It reads Schwung's catalogue, builds new modules and new releases for
the Push (natively: the DiskStation is x86_64 like the Push), puts them in a staging catalog, and publishes
what the admin approves. The admin page is https://admin.<your-domain>.

## What it does

- **Check** (nightly at 03:00, or *Check now*): Schwung's `module-catalog.json` and every module's
  `release.json`. Each module is *new*, an *update*, *current*, *built* (staged, not published), *failed*,
  or *withheld* (its code names no licence, or its repository publishes no source).
- **Build** (nightly for new modules and updates, or a module's *Build*): its source at the release tag (a
  fork, if Settings names one), the recipe read from its build script, the build, the checks (ELF x86_64,
  glibc ≤ 2.35, its entry point; the Push runs the real load test at install), the package with its
  licence texts and build notes, the source archive, the staging catalog. The release's version is stamped
  into `module.json`, as the author's release does.
- **Gently**: the DiskStation runs other services, so every build step runs at the lowest CPU priority
  (`nice 19`) in the idle I/O class, with at most 2 compiles at once (`PUNG_BUILD_JOBS` in the container's
  environment changes it). A big emulator then takes longer, overnight, and nothing else notices.
- **Publish** (only by the admin): packages and sources onto the site, each checked against the catalog,
  then `catalog.json`. The catalog it replaces is kept: *Restore* puts it back.

## Install (once)

The image and its data are already on the DiskStation:

- `/volume2/docker/pung-catalog/pung-catalog-image.tar.gz`: the image
- `/volume2/docker/pung-catalog/data`: its data, seeded with today's sources, builds and catalog

**1. The image.** Portainer: *Images › Import*, the file above. (DSM: *Docker › Image › Add › Add From File*.)

**2. The container.** Portainer: *Containers › Add container*:

| Setting | Value |
|---|---|
| Name | `pung-catalog` |
| Image | `pung-catalog:latest` |
| Port | host `8780` → container `8780` (TCP) |
| Volume | `/volume2/docker/pung-catalog/data` → `/data` |
| Volume | `/volume2/web/pung` → `/site` |
| Restart policy | Unless stopped |
| Environment | `TZ=Europe/Berlin` (the nightly check runs at 03:00 local time) |

**3. The address.** DSM *Control Panel › Application Portal › Reverse Proxy › Create*:

| | Source | Destination |
|---|---|---|
| Protocol | HTTPS | HTTP |
| Hostname | `admin.<your-domain>` | `localhost` |
| Port | 443 | 8780 |

On its *Custom Header* tab add `X-Forwarded-Proto` = `$scheme` (the session cookie is then marked Secure).
The name needs a DNS record like `<your-site>`'s, and a certificate (*Control Panel › Security ›
Certificate*: add `admin.<your-domain>` to the Let's Encrypt one, or a new one).

**4. The admin.** Open https://admin.<your-domain>. It asks for a setup code: it is in the container's
log (Portainer: the container › *Logs*; it reads `use the setup code …`). Choose a user name and a password
of 12 characters or more. The code works once.

## Security

One admin. The password is stored as Argon2id. A session is a random 256-bit token in an HttpOnly,
SameSite=Strict cookie (Secure over HTTPS) for 12 hours. Five failed logins from one address in 15 minutes
lock it out for 15 minutes. Every change needs a header a cross-site form cannot send. The page sends a
strict Content-Security-Policy and is not to be framed or indexed.

## Building it

From the repository's root, on a machine with the module builder image (`push-hack-pung-modules`):

    docker build --platform linux/amd64 -t pung-catalog -f catalog-service/Dockerfile .
    docker save pung-catalog | gzip -1 | ssh -p <port> <user>@<nas> "cat > /volume2/docker/pung-catalog/pung-catalog-image.tar.gz"

Then import it again and recreate the container (the data stays in its folder).
