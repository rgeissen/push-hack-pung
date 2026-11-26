#!/usr/bin/env python3
"""Builds the four Pung pages: shared head and style, the Push figures, images inline, links between them.

  build.py                 the page bodies beside this file (published as claude.ai artifacts)
  build.py --pages OUT     whole documents into OUT, linked to each other, for GitHub Pages
"""
import html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = json.load(open(os.path.join(HERE, "images.json")))
CSS = open(os.path.join(HERE, "pung.css")).read()
LINKS = json.load(open(os.path.join(HERE, "links.json")))
OUT = None  # set by --pages: whole documents, relative links
SITE = {"vision": "./", "manual": "manual.html", "design": "design.html", "performance": "performance.html"}
DESC = {
    "vision": "Pung runs Schwung modules on Ableton Push 3 Standalone, as devices in Live: what it is and how it works.",
    "manual": "The Pung manual: installing Pung on a Push 3 Standalone, the Pung view and its controls, sounds, modules.",
    "design": "The design principles of the Pung view on Push 3: screens, controls, envelopes, colours.",
    "performance": "How Pung spends a Push 3's processor and battery: emulators that rest in silence, measured costs, a view that draws only what changed.",
}
FILES = {"vision": "index.html", "manual": "manual.html", "design": "design.html", "performance": "performance.html"}

PAGES = [("vision", "Vision"), ("manual", "Manual"), ("design", "Design"), ("performance", "Performance")]
FONTS = ("https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900"
         "&family=IBM+Plex+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap")


def head(title):
    return f"""<title>{html.escape(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<style>
{CSS}
</style>
"""


def topbar(current):
    links = []
    for key, label in PAGES:
        cur = ' aria-current="page"' if key == current else ""
        links.append(f'<a href="{LINKS[key]}"{cur}>{label}</a>')
    links.append('<a href="https://github.com/rgeissen/push-hack-pung">GitHub</a>')
    return f"""<header class="band topbar"><div class="wrap">
<a class="mark" href="{LINKS['vision']}"><i></i><b>PUNG</b></a>
<nav aria-label="Pung pages">{''.join(links)}</nav>
</div></header>"""


def footer():
    return """<footer class="band"><div class="wrap">
<div class="links">
<a href="https://github.com/rgeissen/push-hack-pung">Pung on GitHub</a>
<a href="https://github.com/rgeissen/push-hack-pung/releases/latest">Latest release</a>
<a href="https://github.com/charlesvestal/schwung">Schwung</a>
<a href="https://github.com/federico-pepe/ableton-push-hack">Push Hack</a>
</div>
<p>Pung is a hack for Push Hack. It runs Schwung modules; Schwung and its modules are the work of Charles Vestal and the module authors, and every module keeps its own licence. Pung is not made, approved or supported by Ableton. Ableton, Push, Move and Live are trademarks of Ableton AG.</p>
<p>Every Push screen on these pages is Pung's own drawing, captured from a Push 3 or rendered by the same code.</p>
</div></footer>"""


def row(kind, n, lit=(), sel=None, hot=None):
    spans = []
    for i in range(n):
        cls = []
        if kind == "btns" and i in lit:
            cls.append("lit")
        if kind == "btns" and i == sel:
            cls.append("sel")
        inner = "<span></span>"
        if kind == "enc":
            c = ' class="enc hot"' if i == hot else ' class="enc"'
            spans.append(f"<div{c}>{inner}</div>")
        else:
            c = f' class="{" ".join(cls)}"' if cls else ""
            spans.append(f"<span{c}></span>")
    return f'<div class="row {"btns" if kind == "btns" else ""}">{"".join(spans)}</div>'


def rng(s):
    out = set()
    for part in filter(None, (s or "").split(",")):
        if "-" in part:
            a, b = part.split("-")
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return out


SCREEN = re.compile(r'\[\[screen (.*?)\]\](.*?)\[\[/screen\]\]', re.S)
ATTR = re.compile(r'(\w+)="(.*?)"')


def screen(m):
    a = dict(ATTR.findall(m.group(1)))
    body = m.group(2).strip()
    hot = int(a["hot"]) if "hot" in a else None
    up_sel = int(a["upsel"]) if "upsel" in a else None
    lo_sel = int(a["losel"]) if "losel" in a else None
    pins = ""
    for p in filter(None, a.get("pins", "").split(";")):
        num, x, y = p.split(",")
        pins += f'<span class="pin" style="left:{x}%;top:{y}%">{num}</span>'
    img = f'<img src="{IMG[a["img"]]}" alt="{html.escape(a["alt"])}" width="1920" height="320" loading="lazy" decoding="async">'
    if pins:
        img = f'<div class="anno">{img}{pins}</div>'
    return f"""<figure>
<div class="push">
{row("enc", 8, hot=hot)}
{row("btns", 8, lit=rng(a.get("up")), sel=up_sel)}
{img}
{row("btns", 8, lit=rng(a.get("lo")), sel=lo_sel)}
</div>
<figcaption><b>{a["title"]}</b><span>{body}</span></figcaption>
</figure>"""


def build(name):
    src = open(os.path.join(HERE, name + ".src.html")).read()
    title = re.search(r"<!--title:(.*?)-->", src).group(1).strip()
    src = re.sub(r"<!--title:.*?-->\n?", "", src)
    src = SCREEN.sub(screen, src)
    src = src.replace("{{TOPBAR}}", topbar(name)).replace("{{FOOTER}}", footer())
    for key, _ in PAGES:
        src = src.replace("{{LINK:%s}}" % key, LINKS[key])
    left = re.findall(r"\{\{[^}]*\}\}|\[\[[^\]]*\]\]", src)
    if left:
        sys.exit(f"{name}: unresolved {left[:3]}")
    out = head(title) + src
    path = os.path.join(HERE, name + ".html")
    if OUT:
        desc = DESC[name]
        out = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{html.escape(desc[:200])}">
{head(title)}<style>body {{ margin: 0; }}</style>
</head>
<body>
{src}
</body>
</html>
"""
        path = os.path.join(OUT, FILES[name])
    open(path, "w").write(out)
    print(name, len(out) // 1024, "KB")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--pages"]:
        OUT = args[1]
        os.makedirs(OUT, exist_ok=True)
        LINKS = SITE
        open(os.path.join(OUT, ".nojekyll"), "w").close()
        args = args[2:]
    for n in args or [p for p, _ in PAGES]:
        build(n)
