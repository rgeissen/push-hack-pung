# The Pung pages

Sources of the pages at <https://pung.live/>: Home (the front page, `home.src.html`), Vision, Manual, Design and Performance.

- `*.src.html`: the text of each page. `[[screen …]]` draws a Push screen inside its bezel; `{{LINK:manual}}` links to another page.
- `images.json`: the Push screens, inline.
- `pung.css`: the one stylesheet.
- `brand/`: the logo (the P with the riding dot), favicons, app icons and the link preview, made by `brand/make.py` (it says how); the build copies them to `brand/` on the site and draws the logo in every page's top bar.
- `build.py --pages OUT`: writes the site into `OUT`. `scripts/publish-site.sh` (`make publish-site`) builds it and puts it on pung.live, served by the DiskStation; set `PUNG_LIVE_HOST` (`scripts/pung-live-env.sh`).
- `build.py` with no arguments writes page bodies beside the sources, linked through `links.json`.

When a release changes what a page says, change the `.src.html`, commit, and `make publish-site`.
