# The Pung pages

Sources of the three pages at <https://rgeissen.github.io/push-hack-pung/>: Vision (the front page), Manual and Design.

- `*.src.html`: the text of each page. `[[screen …]]` draws a Push screen inside its bezel; `{{LINK:manual}}` links to another page.
- `images.json`: the Push screens, inline.
- `pung.css`: the one stylesheet.
- `build.py --pages OUT`: writes the site into `OUT`. The workflow in `.github/workflows/pages.yml` runs it on every push to `main` that touches this folder.
- `build.py` with no arguments writes page bodies beside the sources, linked through `links.json`.

When a release changes what a page says, change the `.src.html` and push.
