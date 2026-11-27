#!/usr/bin/env python3
"""Builds the four Pung pages: shared head and style, the Push figures, images inline, links between them.

  build.py                 the page bodies beside this file (published as claude.ai artifacts)
  build.py --pages OUT     whole documents into OUT, linked to each other, for pung.live (scripts/publish-site.sh)
"""
import html, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = json.load(open(os.path.join(HERE, "images.json")))
CSS = open(os.path.join(HERE, "pung.css")).read() + open(os.path.join(HERE, "footer.css")).read()
LINKS = json.load(open(os.path.join(HERE, "links.json")))
ROOT = os.path.dirname(HERE)
# the launch (install.json, "launched"): until then the site says only what is
# released: no Pung Installer, no "Connect your Push", the manual and the
# version of the last release (release.json)
LAUNCHED = bool(json.load(open(os.path.join(HERE, "install.json"))).get("launched"))
INSTALLER = LAUNCHED
RELEASED = json.load(open(os.path.join(ROOT, "release.json")))["version"]
OUT = None  # set by --pages: whole documents, relative links
SITE = {"home": "./", "vision": "vision.html", "modules": "modules/", "stacks": "stacks.html", "deployments": "deployments.html", "devices": "devices.html", "push": "push.html", "install": "install.html", "manual": "manual.html", "design": "design.html",
        "performance": "performance.html", "legal": "legal.html", "privacy": "privacy.html"}
DESC = {
    "legal": "Legal notice (Impressum) of pung.live.",
    "privacy": "Privacy on pung.live: what the site and Pung do with data, and what they do not.",
    "stacks": "Stacks: the modules you play, in their order, each with its state and Pung's modulation over them. Take one from a Pung that runs on your Push, keep it, send it to another.",
    "deployments": "Deployments of Pung: install Pung on an Ableton Push 3 Standalone, connect it to pung.live, and see its processor, memory, storage and settings.",
    "devices": "Deployments of Pung.",
    "push": "Deployments of Pung.",
    "install": "Install Pung on Ableton Push 3 Standalone: the Pung Installer for macOS, Windows and Linux, or through Push Hack's catalog.",
    "home": "Pung brings music modules (instruments, audio effects and MIDI generators) to every device musicians play: today 131 of them on Ableton Push 3 Standalone, each a device in Live with a screen made for it.",
    "vision": "Pung brings music modules (instruments, audio effects and MIDI generators) to every device musicians play, native on each: today 131 of them as devices in Live on Ableton Push 3 Standalone; next the desktop, more hardware, phones and tablets.",
    "manual": "The Pung manual: installing Pung on a Push 3 Standalone, the Pung view and its controls, sounds, modules.",
    "design": "The design principles of the Pung view on Push 3: screens, controls, envelopes, colours.",
    "performance": "How Pung spends a Push 3's processor and battery: emulators that rest in silence, measured costs, a view that draws only what changed.",
}
FILES = {"home": "index.html", "stacks": "stacks.html", "vision": "vision.html", "install": "install.html", "push": "push.html", "deployments": "deployments.html", "devices": "devices.html", "manual": "manual.html", "design": "design.html", "performance": "performance.html", "legal": "legal.html", "privacy": "privacy.html"}

PAGES = [("home", None), ("stacks", "Stacks"), ("deployments", "Deployments"), ("devices", None), ("push", None), ("vision", "Vision"), ("install", None), ("manual", "Manual"), ("design", "Design"),
         ("performance", "Performance"), ("legal", None), ("privacy", None)]
# in front: the hero page (the logo), the modules, your Push; everything else is in the footer
NAV = [("modules", "Modules"), ("deployments", "Deployments")]
if LAUNCHED:  # stacks need a deployment to talk to: in front once the site connects to one
    NAV.insert(1, ("stacks", "Stacks"))
BACKGROUND = [("vision", "Vision"), ("manual", "Manual"), ("design", "Design"), ("performance", "Performance")]
# the fonts, served from pung.live itself: no visitor's address goes to a font service (site/fonts)
FACES = open(os.path.join(HERE, "fonts", "faces.css")).read()


def head(title):
    return f"""<title>{html.escape(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
{FACES.replace("{BASE}", "" if OUT else "https://pung.live/")}
{CSS}
</style>
"""


def themed(svg):
    """a logo file in the page's own colours (pung.css): its dark-theme colours
    become the theme's variables, so the light theme has its own"""
    svg = re.sub(r'<svg [^>]*viewBox="([^"]+)"[^>]*>', r'<svg viewBox="\1" aria-hidden="true" focusable="false">', svg)
    for hexv, var in (("#ff8a1f", "--pung"), ("#4fcbe6", "--cyan"), ("#eeece7", "--ink")):
        svg = svg.replace(f'stroke="{hexv}"', f'style="stroke:var({var})"').replace(f'fill="{hexv}"', f'style="fill:var({var})"')
    return svg.strip()


def logo():
    """the logo: the P's dot rides once as the page opens and rests (still
    where motion is turned down)"""
    ride = themed(open(os.path.join(HERE, "brand", "pung-logo-ride.svg")).read()).replace('id="lr"', 'id="tbr"').replace("url(#lr)", "url(#tbr)")
    still = themed(open(os.path.join(HERE, "brand", "pung-logo.svg")).read()).replace('id="ld"', 'id="tbs"').replace("url(#ld)", "url(#tbs)")
    return f'<span class="logo ride">{ride}</span><span class="logo still">{still}</span>'


def topbar(current):
    links = []
    for key, label in NAV:
        cur = ' aria-current="page"' if key == current else ""
        links.append(f'<a href="{LINKS[key]}"{cur}>{label}</a>')
    return f"""<header class="band topbar"><div class="wrap">
<a class="mark" href="{LINKS['home']}" aria-label="Pung, home">{logo()}</a>
<nav aria-label="Pung">{''.join(links)}</nav>
</div></header>"""


LEGAL = json.load(open(os.path.join(HERE, "legal.json")))
FOOT = [("legal", "Legal notice"), ("privacy", "Privacy")]
OPEN = [("Pung on GitHub", "https://github.com/rgeissen/push-hack-pung"), ("Schwung", "https://github.com/charlesvestal/schwung"),
        ("Push Hack", "https://github.com/federico-pepe/ableton-push-hack"), ("gearmulator", "https://github.com/dsp56300/gearmulator")]


def footer(current="", up="", img=False):
    """the foot of every page (footer.css): who it is, where everything is (the three sections in
    front, the pages in the background, the projects Pung stands on, the legal pages), and what
    must be said. up: where the site's root is from the page (the Modules page: "../")."""
    def href(key):
        u = LINKS[key]
        if u.startswith("http"):
            return u
        return (up or "./") if u == "./" else up + u

    def links(items):
        return "".join(f'<a href="{href(k)}"' + (' aria-current="page"' if k == current else "") + f'>{label}</a>' for k, label in items)
    mark = (f'<img src="{up}brand/pung-logo.svg" alt="Pung" width="122" height="28">' if img else
            themed(open(os.path.join(HERE, "brand", "pung-logo.svg")).read()).replace('id="ld"', 'id="sfl"').replace("url(#ld)", "url(#sfl)"))
    version = json.load(open(os.path.join(ROOT, "hack.json")))["version"] if LAUNCHED else RELEASED
    return f"""<footer class="sf">
<div class="sf-in">
<div class="sf-top">
<div class="sf-brand">
<a class="sf-logo" href="{href('home')}" aria-label="Pung, home">{mark}</a>
<p class="sf-tag">Open music modules, at home on every device.</p>
<a class="sf-get" href="{href('deployments')}#install">Get Pung on your Push →</a>
</div>
<nav class="sf-col" aria-label="Pung"><p class="sf-k">Pung</p>{links(NAV)}</nav>
<nav class="sf-col" aria-label="Read"><p class="sf-k">Read</p>{links(BACKGROUND)}</nav>
<nav class="sf-col" aria-label="Open source"><p class="sf-k">Open source</p>{"".join(f'<a href="{u}">{n}<i aria-hidden="true">↗</i></a>' for n, u in OPEN)}</nav>
<nav class="sf-col" aria-label="Legal"><p class="sf-k">Legal</p>{links(FOOT)}</nav>
</div>
<div class="sf-fine">
<p>Pung is a hack for Push Hack. It runs Schwung modules and modules of its own. Schwung and its modules are the work of Charles Vestal and the module authors; Pung's emulators are built on gearmulator. Every module keeps its own licence.</p>
<p>Pung is not made, approved or supported by Ableton. Ableton, Push, Move and Live are trademarks of Ableton AG.</p>
<p>Every Push screen on these pages is Pung's own drawing, captured from a Push 3 or rendered by the same code.</p>
</div>
<div class="sf-base"><span>Pung {version} · open source, MIT licence</span><span>pung.live</span></div>
</div>
</footer>"""


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


# [[livescreen img="…" title="…" alt="…"]]caption[[/livescreen]]: the Push,
# its screen playing (hero.js, with Pung's own pictures: src/web/visuals.js);
# the still picture stands in until the script runs, and where there is none
LIVESCREEN = re.compile(r'\[\[livescreen (.*?)\]\](.*?)\[\[/livescreen\]\]', re.S)


def livescreen(m):
    a = dict(ATTR.findall(m.group(1)))
    still = f'<img src="{a["src"] if "src" in a else IMG[a["img"]]}" alt="{html.escape(a["alt"])}" width="960" height="160" decoding="async">'
    return f"""<figure class="livefig">
<div class="push">
{row("enc", 8)}
{row("btns", 8, lit={0}, sel=0)}
<div class="livescreen" id="livescreen" role="img" aria-label="{html.escape(a["alt"])}">{still}</div>
{row("btns", 8, lit={0, 1, 2, 3}, sel=0)}
</div>
<figcaption><b>{a["title"]}</b><span>{m.group(2).strip()}</span></figcaption>
</figure>"""


def figure_css():
    """the pictures' own styles, from Pung's web page (src/web/app.css): one source"""
    css = open(os.path.join(ROOT, "src", "web", "app.css")).read()
    return "\n".join(l for l in css.splitlines() if l.startswith((".env", "svg .mod")))


def build(name):
    src = open(os.path.join(HERE, name + ".src.html")).read()
    if name == "manual" and not LAUNCHED and OUT:
        # the manual of the release people have, in today's frame
        import subprocess
        git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        at = git("log", "-1", "--format=%H", "--", "release.json").strip()  # the commit that released it
        src = git("show", at + ":site/manual.src.html")
    title = re.search(r"<!--title:(.*?)-->", src).group(1).strip()
    src = re.sub(r"<!--title:.*?-->\n?", "", src)
    live = bool(LIVESCREEN.search(src))
    src = LIVESCREEN.sub(livescreen, src)
    src = SCREEN.sub(screen, src)
    # <!--if:installer-->…<!--endif-->: only once the Pung Installer is offered
    # (install.json, installer.available); <!--if:!installer--> until then
    for flag, on in (("installer", INSTALLER), ("!installer", not INSTALLER), ("launched", LAUNCHED), ("!launched", not LAUNCHED)):
        src = re.sub(r"<!--if:%s-->(.*?)<!--endif-->" % re.escape(flag), (lambda m: m.group(1)) if on else "", src, flags=re.S)
    src = src.replace("{{TOPBAR}}", topbar(name)).replace("{{FOOTER}}", footer(name))
    for k, v in LEGAL.items():  # the legal pages name the person who answers for the site (legal.json)
        src = src.replace("{{LEGAL:%s}}" % k, html.escape(v) if v else '<mark>to be added</mark>')
    for key in LINKS:
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
<link rel="icon" href="brand/favicon.ico" sizes="48x48">
<link rel="icon" href="brand/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="brand/apple-touch-icon.png">
<meta name="theme-color" content="#0e0d0c">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Pung">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc[:200])}">
<meta property="og:url" content="https://pung.live/{'' if FILES[name] == 'index.html' else FILES[name]}">
<meta property="og:image" content="https://pung.live/brand/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
{head(title)}<style>body {{ margin: 0; }}</style>
{"<style>" + figure_css() + "</style>" if live else ""}
{'<link rel="stylesheet" href="pushlink.css">' if name in ("deployments", "stacks") else ""}
</head>
<body{' data-connect="1"' if LAUNCHED else ""}>
{src}
{'<script src="visuals.js"></script><script src="hero.js"></script>' if live else ""}
{'<script src="pushlink.js"></script><script src="deployments.js"></script>' if name == "deployments" else ""}
{'<script src="pushlink.js"></script><script src="stacks.js"></script>' if name == "stacks" and LAUNCHED else ""}
</body>
</html>
"""
        path = os.path.join(OUT, FILES[name])
    open(path, "w").write(out)
    print(name, len(out) // 1024, "KB")


INSTALLABLE = ("sound_generator", "audio_fx", "midi_fx")  # modmgr.go, installSubdirs


def module_limits():
    """limits.go's moduleLimits, as Pung's catalog API answers them"""
    src = open(os.path.join(ROOT, "src", "limits.go")).read()
    table = src[src.index("var moduleLimits"):]
    table = table[:table.index("\n}")]
    keys = {"One": "one", "Emulator": "emulator", "Rests": "rests", "HostRests": "host_rests", "Cost": "cost"}
    out = {}
    for mid, body in re.findall(r'"([\w-]+)":\s*\{([^}]*)\}', table):
        d = {}
        for k, v in re.findall(r"(\w+):\s*(\"[^\"]*\"|true|false|[\d.]+)", body):
            d[keys[k]] = v.strip('"') if v.startswith('"') else (v == "true" if v in ("true", "false") else float(v))
        out[mid] = d
    return out


GITHUB_SOURCES = "https://github.com/rgeissen/push-hack-pung/releases/download/sources"
PACK_SOURCES = "https://pung.live/catalog/source"  # beside the pack pung.live serves (publish-catalog.sh)


def modules_data(cat, sources):
    """a catalog as Pung's own API answers it (src/modmgr.go, view): what the
    Modules page reads. sources: where a catalog built here has its sources"""
    doc = json.load(open(cat))
    limits = module_limits()
    rows = []
    for e in doc["modules"]:
        if e.get("component_type") not in INSTALLABLE:
            continue
        r = {k: v for k, v in e.items() if k not in ("asset", "sha256")}
        src = dict(r.get("source") or {})
        if src.get("archive") and not re.match(r"https?://", src["archive"]):
            src["archive"] = sources + "/" + os.path.basename(src["archive"])
        r["source"] = src
        r.update({"supported": True, "in_catalog": True, "status": "available", "installed": "", "managed": False})
        if e["id"] in limits:
            r["limits"] = limits[e["id"]]
        rows.append(r)
    rows.sort(key=lambda r: r["name"].lower())
    pung = json.load(open(os.path.join(ROOT, "hack.json")))["version"] if LAUNCHED else RELEASED
    return {"ok": True, "apply": None, "pending": [], "restarting": False, "modules": rows,
            "catalog": {"generated_at": doc.get("generated_at", ""), "taxonomy": doc.get("taxonomy", {}), "base_url": "", "pung": pung}}


def modules_page(out):
    """pung.live/modules/: Pung's own Modules page (src/web/modules.js in its
    public mode, site/modules.html), the release's catalog as Pung's API
    answers it, and the pictures of each module's screens (make screens).
    Once pung.live serves a pack, publish-catalog.sh replaces its catalog.json
    with that pack's (--modules-data): the page and a Push read the same."""
    cat = next((p for p in (os.path.join(ROOT, "dist", "pung", "catalog", "catalog.json"),
                            os.path.join(ROOT, "build", "catalog", "catalog.json")) if os.path.exists(p)), None)
    screens = os.path.join(ROOT, "build", "screens")
    if not cat or not os.path.exists(os.path.join(screens, "index.json")):
        sys.exit("the Modules page needs the catalog (build-catalog.py, or make release) and the screens (make screens)")
    data = modules_data(cat, GITHUB_SOURCES)
    rows = data["modules"]
    d = os.path.join(out, "modules")
    if os.path.exists(d):
        shutil.rmtree(d)
    shutil.copytree(screens, os.path.join(d, "screens"))
    json.dump(data, open(os.path.join(d, "catalog.json"), "w"), separators=(",", ":"))
    page = open(os.path.join(HERE, "modules.html")).read()
    for flag, on in (("launched", LAUNCHED), ("!launched", not LAUNCHED)):
        page = re.sub(r"<!--if:%s-->(.*?)<!--endif-->" % re.escape(flag), (lambda m: m.group(1)) if on else "", page, flags=re.S)
    if LAUNCHED:
        page = page.replace('<body data-public="1"', '<body data-public="1" data-connect="1"')
    page = page.replace("<!--FOOTER-->", footer("modules", up="../", img=True))
    open(os.path.join(d, "index.html"), "w").write(page)
    for f in ("app.css", "modules.js"):
        shutil.copy2(os.path.join(ROOT, "src", "web", f), os.path.join(d, f))
    print("modules", len(rows), "modules,", len(json.load(open(os.path.join(screens, "index.json")))), "with screens")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--modules-data"]:  # OUT CATALOG: the Modules page's data for a pack pung.live serves
        json.dump(modules_data(args[2], PACK_SOURCES), open(args[1], "w"), separators=(",", ":"))
        sys.exit(0)
    if args[:1] == ["--pages"]:
        OUT = args[1]
        os.makedirs(OUT, exist_ok=True)
        LINKS = SITE
        brand = os.path.join(OUT, "brand")
        os.makedirs(brand, exist_ok=True)
        for f in os.listdir(os.path.join(HERE, "brand")):
            if not f.endswith(".py") and not f.startswith((".", "_")):
                shutil.copy2(os.path.join(HERE, "brand", f), os.path.join(brand, f))
        args = args[2:]
    for n in args or [p for p, _ in PAGES]:
        build(n)
    if OUT and not args:
        # the front page's playing screen
        shutil.copy2(os.path.join(ROOT, "src", "web", "visuals.js"), os.path.join(OUT, "visuals.js"))
        for f in ("hero.js", "pushlink.js", "pushlink.css", "footer.css", "deployments.js", "stacks.js"):
            shutil.copy2(os.path.join(HERE, f), os.path.join(OUT, f))
        # a script that does not parse leaves its page standing still, without a word (Your devices was
        # published so, 2026-11-27): no page is built with one
        node = shutil.which("node")
        for f in ("hero.js", "pushlink.js", "deployments.js", "stacks.js", os.path.join(ROOT, "src", "web", "visuals.js"), os.path.join(ROOT, "src", "web", "modules.js")):
            path = f if os.path.isabs(f) else os.path.join(HERE, f)
            if node and subprocess.run([node, "--check", path], capture_output=True).returncode != 0:
                sys.exit(f"{os.path.basename(path)} does not parse (node --check): nothing is built from it")
        if not node:
            print("node is not here: the pages' scripts were not checked for syntax")
        shutil.copytree(os.path.join(HERE, "fonts"), os.path.join(OUT, "fonts"), dirs_exist_ok=True)
        # the front page's loops: Pung's own instruments' panels (scripts/hero-loops.sh)
        shutil.copytree(os.path.join(HERE, "hero"), os.path.join(OUT, "hero"), dirs_exist_ok=True)
        # the newest release, where the site and the Pung Installer read it
        shutil.copy2(os.path.join(ROOT, "release.json"), os.path.join(OUT, "release.json"))
        modules_page(OUT)
        # what the Pung Installer installs (installer/manifest.go), and the installer itself
        shutil.copy2(os.path.join(HERE, "install.json"), os.path.join(OUT, "install.json"))
        inst = os.path.join(ROOT, "build", "installer")
        if not INSTALLER:
            print("download: held back until the launch (install.json, launched)")
        elif os.path.isdir(inst):
            dl = os.path.join(OUT, "download")
            os.makedirs(dl, exist_ok=True)
            for f in os.listdir(inst):
                if f.startswith("Pung-Installer-"):
                    shutil.copy2(os.path.join(inst, f), os.path.join(dl, f))
            print("download", sorted(os.listdir(dl)))
        else:
            print("download: none (scripts/build-installer.sh)")
