#!/usr/bin/env python3
"""Pung's logo, every file of it, from one geometry: the P drawn as one stroke
with the cyan dot riding its bowl ("Riding dot", chosen 2026-11-26).

  make.py ARCHIVO_TTF     writes the SVGs, PNGs and favicon.ico beside this file

Needs fontTools and Pillow (the wordmark is Archivo's own outlines, SIL OFL 1.1,
at width 125 and the weight whose stems match the mark's stroke, so no file depends on a font), and Google Chrome
for the PNGs. The outputs are committed: the site build only copies them.

The still logo is the moving one at rest: the dot on the bowl's shoulder,
on its way round. Where a logo can move, the dot rides the bowl down and back
and comes to rest there again. At 24 px and below the stroke and the dot grow
(pung-mark-small.svg), so the dot survives at 16 px.
"""
import io, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# the two themes of the site (pung.css)
DARK = {"o": "#ff8a1f", "cyan": "#4fcbe6", "ink": "#eeece7", "ground": "#0e0d0c", "tile": "#161513"}
LIGHT = {"o": "#d6600a", "cyan": "#08809f", "ink": "#15171a", "ground": "#eef0f1", "tile": "#ffffff"}

# The bowl is as wide as the word's letters ask (the P of PUNG beside U, N and G):
# 39 wide of 57.5 tall, where the first drawing had 33.5.
P = "M20 57 V8 H36 C55.5 8 55.5 34 36 34 H20"   # the P, one stroke (viewBox 0 0 64 64)
RIDE = "M24 8 H36 C55.5 8 55.5 34 36 34 H24"    # the dot's way: the bowl
REST = (47.0, 12.1)                             # on the shoulder (the bowl's curve at t = 0.25)
REST_AT = 0.345
RIGHT = 54.9                                    # the bowl's right edge, stroke included
VIEW = "3.3 0 64 64"                            # the mark alone, centred in its square                                 # the same place, as a fraction of RIDE's length


def mark_parts(c, small=False, ride=False, ident="m", stroke=None):
    """the mark's SVG elements: the P with a gap around the dot (a mask, so it
    sits on any ground), and the dot. stroke: another weight (the lockup's,
    matched to the word's stems), dot and gap in proportion"""
    if stroke is None:
        stroke, dot, gap = (10, 8, 10.5) if small else (8.5, 5.5, 8.2)
    else:
        dot, gap = stroke * 5.5 / 8.5, stroke * 8.2 / 8.5
    x, y = REST
    if ride:
        # the gap travels with the dot
        hole = (f'<circle r="{gap}" fill="#000"><animateMotion dur="3s" begin="0s" fill="freeze" '
                f'keyPoints="{REST_AT};{REST_AT};1;0;{REST_AT}" keyTimes="0;0.15;0.5;0.86;1" calcMode="spline" '
                f'keySplines="0 0 1 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1" path="{RIDE}"/></circle>')
        dotel = (f'<circle r="{dot}" fill="{c["cyan"]}"><animateMotion dur="3s" begin="0s" fill="freeze" '
                 f'keyPoints="{REST_AT};{REST_AT};1;0;{REST_AT}" keyTimes="0;0.15;0.5;0.86;1" calcMode="spline" '
                 f'keySplines="0 0 1 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1" path="{RIDE}"/></circle>')
    else:
        hole = f'<circle cx="{x}" cy="{y}" r="{gap}" fill="#000"/>'
        dotel = f'<circle cx="{x}" cy="{y}" r="{dot}" fill="{c["cyan"]}"/>'
    return (f'<mask id="{ident}"><rect x="-8" y="-8" width="88" height="80" fill="#fff"/>{hole}</mask>'
            f'<path d="{P}" fill="none" stroke="{c["o"]}" stroke-width="{stroke}" stroke-linecap="round" '
            f'stroke-linejoin="round" mask="url(#{ident})"/>{dotel}')


def svg(w, h, body, view=None, label="Pung"):
    vb = view or f"0 0 {w} {h}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img" '
            f'aria-label="{label}">{body}</svg>\n')


WORD_WGHT = int(os.environ.get("PUNG_WORD_WGHT", "460"))  # the word's stems as heavy as the mark's stroke
WORD_WDTH = int(os.environ.get("PUNG_WORD_WDTH", "100"))  # its letters as wide as the P


def wordmark(ttf, text="UNG"):
    """TEXT in Archivo (width WORD_WDTH, weight WORD_WGHT) as one path, from x 0, the cap
    line at y 0; its advance, the cap height, the stem width and the P's side
    bearings (the mark stands in for the word's P), in font units"""
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    f = instantiateVariableFont(TTFont(ttf), {"wght": WORD_WGHT, "wdth": WORD_WDTH})
    gs, cmap, hmtx, glyf = f.getGlyphSet(), f.getBestCmap(), f["hmtx"], f["glyf"]
    cap = f["OS/2"].sCapHeight
    track = 0.03 * f["head"].unitsPerEm

    def bounds(ch):
        g = glyf[cmap[ord(ch)]]
        g.recalcBounds(glyf)
        return g.xMin, g.xMax

    i0, i1 = bounds("I")
    p0, p1 = bounds("P")
    padv = hmtx[cmap[ord("P")]][0]
    x, d = 0, []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, cap)))
        d.append(pen.getCommands())
        x += hmtx[g][0] + track
    return {"d": " ".join(d), "w": x - track, "cap": cap, "stem": i1 - i0, "track": track,
            "p_lsb": p0, "p_rsb": padv - p1}


def lockup(c, m, ident, ride=False):
    """the logo: the mark is the word's P, as tall as the caps (its round foot
    on the baseline), then UNG at the P's own spacing"""
    cap = m["cap"]
    s = cap / 57.5                        # the P runs y 3.75..61.25 of the mark's 64, stroke included
    mx, my = -15.75 * s, -3.75 * s        # the stem's left edge at 0, its top at the cap line
    ux = (RIGHT - 15.75) * s + m["p_rsb"] + m["track"]
    body = (f'<g transform="translate({mx:.1f} {my:.1f}) scale({s:.4f})">{mark_parts(c, ident=ident, ride=ride)}</g>'
            f'<path transform="translate({ux:.1f} 0)" d="{m["d"]}" fill="{c["ink"]}"/>')
    pad = cap * 0.04
    top = -pad
    w, h = ux + m["w"] + 2 * pad, cap + 2 * pad
    return svg(round(w / 10), round(h / 10), body, view=f"{-pad:.1f} {top:.1f} {w:.1f} {h:.1f}", label="Pung")


def chrome_png(html, w, h, out):
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, "x.html")
        open(p, "w").write(html)
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--default-background-color=00000000", f"--window-size={w},{h}",
                        f"--screenshot={out}", "file://" + p], check=True, capture_output=True)


def page(inner, w, h, bg="transparent"):
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;width:{w}px;'
            f'height:{h}px;background:{bg};overflow:hidden}}</style></head><body>{inner}</body></html>')


def main(ttf):
    from PIL import Image
    w = lambda name, s: open(os.path.join(HERE, name), "w").write(s)
    # the mark, still: for dark grounds and for light ones; small for favicons
    w("pung-mark.svg", svg(64, 64, mark_parts(DARK, ident="pm"), view=VIEW))
    w("pung-mark-light.svg", svg(64, 64, mark_parts(LIGHT, ident="pl"), view=VIEW))
    w("pung-mark-small.svg", svg(64, 64, mark_parts(DARK, small=True, ident="ps"), view=VIEW))
    # the mark that rides once, then rests (the site's hero, a README)
    w("pung-mark-ride.svg", svg(64, 64, mark_parts(DARK, ride=True, ident="pr"), view=VIEW))
    # the favicon: the small mark, in the browser's own theme
    fav = (f'<style>.o{{stroke:{DARK["o"]}}}.c{{fill:{DARK["cyan"]}}}@media (prefers-color-scheme: light)'
           f'{{.o{{stroke:{LIGHT["o"]}}}.c{{fill:{LIGHT["cyan"]}}}}}</style>'
           + mark_parts(DARK, small=True, ident="f").replace('stroke="' + DARK["o"] + '"', 'class="o"')
           .replace('fill="' + DARK["cyan"] + '"', 'class="c"'))
    w("favicon.svg", svg(64, 64, fav, view=VIEW))
    # the logo: mark and word
    m = wordmark(ttf)
    w("pung-logo.svg", lockup(DARK, m, "ld"))
    w("pung-logo-light.svg", lockup(LIGHT, m, "ll"))
    w("pung-logo-ride.svg", lockup(DARK, m, "lr", ride=True))   # the site's top bar: rides once as a page opens

    # PNGs: favicon sizes (transparent), app icons (the mark on Pung's dark tile)
    small = open(os.path.join(HERE, "pung-mark-small.svg")).read()
    mark = open(os.path.join(HERE, "pung-mark.svg")).read()
    icons = []
    with tempfile.TemporaryDirectory() as t:
        for n in (16, 32, 48):
            p = os.path.join(t, f"f{n}.png")
            chrome_png(page(small.replace('width="64" height="64"', f'width="{n}" height="{n}"'), n, n), n, n, p)
            icons.append(Image.open(p).convert("RGBA"))
        icons[-1].save(os.path.join(HERE, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)],
                       append_images=icons[:-1])
    for n, name in ((180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")):
        m = round(n * 0.7)
        inner = (f'<div style="width:{n}px;height:{n}px;background:{DARK["tile"]};display:flex;'
                 f'align-items:center;justify-content:center">'
                 + mark.replace('width="64" height="64"', f'width="{m}" height="{m}"') + "</div>")
        chrome_png(page(inner, n, n, DARK["tile"]), n, n, os.path.join(HERE, name))
    # the link preview (1200 x 630)
    logo = open(os.path.join(HERE, "pung-logo.svg")).read()
    # the logo and its tagline as on the front page: one mark, the tagline in spaced capitals as wide as the logo
    og = (f'<style>@font-face{{font-family:A;src:url("file://{os.path.abspath(ttf)}")}}</style>'
          f'<div style="width:1200px;height:630px;box-sizing:border-box;padding:76px 104px 70px;background:{DARK["ground"]};'
          f'display:flex;flex-direction:column;justify-content:space-between;font-family:A,Helvetica,Arial,sans-serif;'
          f'font-stretch:112%"><div>'
          + logo.replace("<svg ", '<svg style="display:block;width:992px;height:auto;margin-left:-13px" ', 1)
          + f'<div style="color:#a39e94;font-size:32.2px;font-weight:560;line-height:1;letter-spacing:.34em;text-transform:uppercase;'
          f'white-space:nowrap;margin-top:22px">The open instrument platform</div></div>'
          f'<div style="color:{DARK["ink"]};font-size:46px;font-weight:800;line-height:1.08;letter-spacing:-0.012em">'
          f'Open music modules,<br>at home on every device.</div></div>')
    chrome_png(page(og, 1200, 630, DARK["ground"]), 1200, 630, os.path.join(HERE, "og-image.png"))
    for f in sorted(os.listdir(HERE)):
        if f != "make.py":
            print(f, os.path.getsize(os.path.join(HERE, f)))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
