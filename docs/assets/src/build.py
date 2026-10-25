#!/usr/bin/env python3
"""Generate the README artwork (light + dark) into docs/assets/.

    pip install fonttools brotli
    python3 docs/assets/src/build.py

Fonts are subset and embedded so every SVG renders identically on GitHub,
whatever fonts the viewer has installed.
"""
import base64
import io
import math
import re
from collections import defaultdict
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

SRC = Path(__file__).resolve().parent
OUT = SRC.parent
FONTS = SRC / "fonts"

FACES = {
    ("ui", 400): "Inter-Regular.ttf",
    ("ui", 500): "Inter-Medium.ttf",
    ("ui", 600): "Inter-SemiBold.ttf",
    ("ui", 700): "Inter-Bold.ttf",
    ("display", 100): "InterDisplay-Thin.ttf",
    ("display", 500): "InterDisplay-Medium.ttf",
    ("display", 600): "InterDisplay-SemiBold.ttf",
    ("display", 700): "InterDisplay-Bold.ttf",
    ("mono", 400): "JetBrainsMono-Regular.ttf",
    ("mono", 500): "JetBrainsMono-Medium.ttf",
}

THEMES = {
    "light": dict(
        window="#ffffff", bar="#f6f6f8", sidebar="#f0f0f3", canvas="#ebebef",
        sep="rgba(0,0,0,0.10)", label="#1d1d1f", label2="#6e6e73", label3="#a1a1a6",
        accent="#007aff", success="#34c759", select="rgba(0,122,255,0.12)",
        hover="rgba(0,0,0,0.05)", rim="none", line="rgba(0,122,255,0.06)",
        shadow=0.20, titanium=("#e4e2de", "#b9b6b0"), card="#ffffff",
        syn=dict(kw="#ad3da4", type="#0b4f79", other="#703daa", str="#c41a16",
                 num="#1c00cf", com="#5d6c79", attr="#815f03", member="#326d74",
                 decl="#0f68a0", plain="#1d1d1f"),
    ),
    "dark": dict(
        window="#1e1e20", bar="#2a2a2d", sidebar="#252528", canvas="#141416",
        sep="rgba(255,255,255,0.08)", label="#f5f5f7", label2="#a1a1a6", label3="#6e6e73",
        accent="#0a84ff", success="#30d158", select="rgba(10,132,255,0.24)",
        hover="rgba(255,255,255,0.06)", rim="rgba(255,255,255,0.12)", line="rgba(10,132,255,0.10)",
        shadow=0.55, titanium=("#4a4a4d", "#2b2b2d"), card="#1c1c1e",
        syn=dict(kw="#fc5fa3", type="#5dd8ff", other="#d0a8ff", str="#fc6a5d",
                 num="#d0bf69", com="#6c7986", attr="#fd8f3f", member="#67b7a4",
                 decl="#41a1c0", plain="#dfdfe0"),
    ),
}

_metrics = {}


def advance(face, weight):
    if (face, weight) not in _metrics:
        f = TTFont(FONTS / FACES[(face, weight)])
        _metrics[(face, weight)] = (f.getBestCmap(), f["hmtx"].metrics, f["head"].unitsPerEm)
    return _metrics[(face, weight)]


def text_width(s, face="ui", weight=400, size=13, ls=0.0):
    cmap, hmtx, upm = advance(face, weight)
    units = sum(hmtx[cmap.get(ord(c), ".notdef")][0] for c in s)
    return units / upm * size + ls * size * len(s)


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Doc:
    def __init__(self, w, h, theme):
        self.w, self.h = w, h
        self.t = THEMES[theme] if theme else None
        self.defs, self.body = [], []
        self.chars = defaultdict(set)
        self._n = 0

    def uid(self, p):
        self._n += 1
        return f"{p}{self._n}"

    def add(self, s):
        self.body.append(s)

    def text(self, x, y, s, face="ui", weight=400, size=13, fill=None, anchor="start",
             ls=0.0, opacity=None, attrs=""):
        self.chars[(face, weight)].update(s)
        fill = fill or self.t["label"]
        extra = f' letter-spacing="{ls}em"' if ls else ""
        if opacity is not None:
            extra += f' fill-opacity="{opacity}"'
        if anchor != "start":
            extra += f' text-anchor="{anchor}"'
        self.add(f'<text x="{x:.2f}" y="{y:.2f}" class="{face}" font-weight="{weight}" '
                 f'font-size="{size}" fill="{fill}"{extra}{attrs}>{esc(s)}</text>')

    def shadow(self, layers):
        fid = self.uid("sh")
        drops = "".join(
            f'<feDropShadow dx="0" dy="{dy}" stdDeviation="{blur}" flood-color="#000" flood-opacity="{op}"/>'
            for dy, blur, op in layers)
        self.defs.append(f'<filter id="{fid}" x="-20%" y="-20%" width="140%" height="150%">{drops}</filter>')
        return fid

    def lingrad(self, stops, x1=0, y1=0, x2=0, y2=1):
        gid = self.uid("g")
        st = "".join(f'<stop offset="{o}" stop-color="{c}"{"" if a == 1 else f" stop-opacity={chr(34)}{a}{chr(34)}"}/>'
                     for o, c, a in stops)
        self.defs.append(f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{st}</linearGradient>')
        return gid

    def clip(self, inner):
        cid = self.uid("c")
        self.defs.append(f'<clipPath id="{cid}">{inner}</clipPath>')
        return cid

    def fontface_css(self):
        css = []
        for (face, weight), chars in sorted(self.chars.items()):
            opts = subset.Options()
            opts.flavor = "woff2"
            opts.layout_features = ["kern", "liga", "calt"]
            font = TTFont(FONTS / FACES[(face, weight)])
            sub = subset.Subsetter(opts)
            sub.populate(text="".join(chars) + " ")
            sub.subset(font)
            buf = io.BytesIO()
            font.save(buf)
            b64 = base64.b64encode(buf.getvalue()).decode()
            css.append(f"@font-face{{font-family:vx-{face};font-weight:{weight};"
                       f"src:url(data:font/woff2;base64,{b64}) format('woff2')}}")
        stacks = {"ui": "-apple-system,'Segoe UI',sans-serif", "display": "-apple-system,'Segoe UI',sans-serif",
                  "mono": "ui-monospace,Menlo,monospace"}
        css += [f".{f}{{font-family:vx-{f},{stacks[f]}}}" for f in stacks]
        return "".join(css)

    def svg(self, title):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
                f'width="{self.w}" height="{self.h}" role="img" aria-label="{esc(title)}">'
                f"<title>{esc(title)}</title><style>{self.fontface_css()}</style>"
                f'<defs>{"".join(self.defs)}</defs>{"".join(self.body)}</svg>')


# ---------------------------------------------------------------- glyphs

def stroke_path(d, color, w=1.6, extra=""):
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" '
            f'stroke-linecap="round" stroke-linejoin="round"{extra}/>')


def glyph(name, x, y, s, color, w=1.6):
    """Line glyphs on a 24-unit grid, drawn in-house (design-system rule 4)."""
    paths = {
        "files": "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5",
        "search": "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20",
        "branch": "M7 3.5v17M19.5 7.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M17 10c0 4.5-4 5.5-10 6.5",
        "debug": "M8 5l11 7-11 7z",
        "phone": "M8.5 2.5h7a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19V5a2.5 2.5 0 0 1 2.5-2.5zM10.5 4.9h3",
        "tablet": "M6 2.5h12a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 19V5A2.5 2.5 0 0 1 6 2.5z",
        "chev_d": "M7 10l5 5 5-5",
        "chev_r": "M10 7l5 5-5 5",
        "sidebar": "M4 5h16v14H4zM9.5 5v14",
        "panel": "M4 5h16v14H4zM4 14.5h16",
        "split": "M4 5h16v14H4zM14.5 5v14",
        "laptop": "M5 6.5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 6.5V15H5zM2.5 18.5h19",
        "mac": "M4 9.5h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 9.5l1.2-2.6A1.5 1.5 0 0 1 6.6 6h10.8a1.5 1.5 0 0 1 1.4.9L20 9.5M8 14h1",
        "plug": "M9 3v4M15 3v4M7 7h10v3a5 5 0 0 1-10 0zM12 15v6",
        "wave": "M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0M12 12h.01",
        "remote": "M4 9l4 3-4 3M20 9l-4 3 4 3",
        "doc": "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
        "folder": "M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
        "check": "M5 12.5l4.5 4.5L19 7.5",
        "stop": "M7 7h10v10H7z",
        "play": "M8 5.5v13l10.5-6.5z",
        "rotate": "M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4",
        "key": "M15 3.5a5.5 5.5 0 1 1-5.2 7.3L3.5 17.1V20.5H7V18h2.5v-2.5H12l1.6-1.6A5.5 5.5 0 0 1 15 3.5zM16.5 7.5h.01",
    }
    k = s / 24
    return (f'<g transform="translate({x:.2f},{y:.2f}) scale({k:.4f})">'
            f'{stroke_path(paths[name], color, w / k)}</g>')


def app_icon(d, x, y, size, shadow=True):
    """The Slipway icon: a superellipse tile, a device between two code chevrons."""
    n, pts = 5.0, []
    for i in range(240):
        a = 2 * math.pi * i / 240
        c, s_ = math.cos(a), math.sin(a)
        px = math.copysign(abs(c) ** (2 / n), c)
        py = math.copysign(abs(s_) ** (2 / n), s_)
        pts.append(f"{x + size / 2 + px * size / 2:.2f},{y + size / 2 + py * size / 2:.2f}")
    tile = "M" + " L".join(pts) + "Z"
    body = d.lingrad([(0, "#3d9bff", 1), (1, "#0058e6", 1)])
    sheen = d.lingrad([(0, "#ffffff", 0.32), (0.5, "#ffffff", 0)])
    filt = f' filter="url(#{d.shadow([(size * 0.02, size * 0.03, 0.18), (size * 0.05, size * 0.06, 0.14)])})"' if shadow else ""
    u = size / 100
    cx, cy = x + size / 2, y + size / 2
    pw, ph = 26 * u, 46 * u
    px0, py0 = cx - pw / 2, cy - ph / 2
    out = [f'<path d="{tile}" fill="url(#{body})"{filt}/>', f'<path d="{tile}" fill="url(#{sheen})"/>']
    out.append(f'<rect x="{px0:.2f}" y="{py0:.2f}" width="{pw:.2f}" height="{ph:.2f}" rx="{5.5 * u:.2f}" '
               f'fill="none" stroke="#fff" stroke-width="{3.6 * u:.2f}"/>')
    out.append(f'<rect x="{cx - 4.5 * u:.2f}" y="{py0 + 4.2 * u:.2f}" width="{9 * u:.2f}" height="{3 * u:.2f}" '
               f'rx="{1.5 * u:.2f}" fill="#fff"/>')
    for sgn in (-1, 1):
        bx = cx + sgn * 27 * u
        d_ = f"M{bx - sgn * 7 * u:.2f},{cy - 11 * u:.2f} L{bx + sgn * 2 * u:.2f},{cy:.2f} L{bx - sgn * 7 * u:.2f},{cy + 11 * u:.2f}"
        out.append(f'<path d="{d_}" fill="none" stroke="#fff" stroke-width="{4.2 * u:.2f}" '
                   f'stroke-linecap="round" stroke-linejoin="round"/>')
    return "".join(out)


# ---------------------------------------------------------------- the demo app

HOURS = [("Now", "sun", 21), ("14", "sun", 22), ("15", "sun", 23), ("16", "cloudsun", 24),
         ("17", "cloudsun", 23), ("18", "sun", 22), ("19", "moon", 20), ("20", "moon", 19),
         ("21", "moon", 18), ("22", "cloud", 17), ("23", "moon", 17), ("00", "moon", 16)]
DAYS = [("Today", "sun", 15, 24), ("Fri", "cloudsun", 16, 23), ("Sat", "cloud", 15, 20),
        ("Sun", "cloudsun", 14, 21), ("Mon", "sun", 15, 25), ("Tue", "sun", 16, 25),
        ("Wed", "cloudsun", 15, 22)]


def weather_glyph(d, kind, cx, cy, r):
    """Multicolour weather symbols in the style of SF Symbols' palette variants."""
    sun, out = "#ffd60a", []
    if kind in ("sun", "cloudsun"):
        sx, sy = (cx, cy) if kind == "sun" else (cx + r * 0.32, cy - r * 0.3)
        sr = r * (0.42 if kind == "sun" else 0.32)
        out.append(f'<circle cx="{sx:.2f}" cy="{sy:.2f}" r="{sr:.2f}" fill="{sun}"/>')
        for i in range(8):
            a = i * math.pi / 4
            x1, y1 = sx + math.cos(a) * sr * 1.45, sy + math.sin(a) * sr * 1.45
            x2, y2 = sx + math.cos(a) * sr * 1.9, sy + math.sin(a) * sr * 1.9
            out.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{sun}" '
                       f'stroke-width="{r * 0.13:.2f}" stroke-linecap="round"/>')
    if kind == "moon":
        mid = d.uid("m")
        d.defs.append(f'<mask id="{mid}"><rect x="{cx - r}" y="{cy - r}" width="{2 * r}" height="{2 * r}" fill="#fff"/>'
                      f'<circle cx="{cx + r * 0.32:.2f}" cy="{cy - r * 0.22:.2f}" r="{r * 0.5:.2f}" fill="#000"/></mask>')
        out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r * 0.58:.2f}" fill="#fff" mask="url(#{mid})"/>')
    if kind in ("cloud", "cloudsun"):
        ox, oy = (cx, cy) if kind == "cloud" else (cx - r * 0.12, cy + r * 0.18)
        k = r * (0.95 if kind == "cloud" else 0.8)
        out.append(f'<g fill="#fff"><circle cx="{ox - k * 0.35:.2f}" cy="{oy + k * 0.05:.2f}" r="{k * 0.36:.2f}"/>'
                   f'<circle cx="{ox + k * 0.12:.2f}" cy="{oy - k * 0.12:.2f}" r="{k * 0.46:.2f}"/>'
                   f'<rect x="{ox - k * 0.7:.2f}" y="{oy + k * 0.02:.2f}" width="{k * 1.35:.2f}" height="{k * 0.4:.2f}" rx="{k * 0.2:.2f}"/>'
                   f'<circle cx="{ox + k * 0.5:.2f}" cy="{oy + k * 0.15:.2f}" r="{k * 0.27:.2f}"/></g>')
    return "".join(out)


def status_bar(d, w, y, island, left_cx, right_cx):
    d.text(left_cx, y, "9:41", weight=600, size=17, fill="#fff", anchor="middle")
    x = right_cx - 36
    for i in range(4):
        h = 4 + i * 2.6
        d.add(f'<rect x="{x + i * 4.6:.2f}" y="{y - h:.2f}" width="3" height="{h:.2f}" rx="0.9" fill="#fff"/>')
    x += 24
    for i, rr in enumerate((9.5, 6.2, 2.9)):
        if i < 2:
            d.add(f'<path d="M{x + 7 - rr * 0.78:.2f},{y - 4 - rr * 0.62:.2f} A{rr},{rr} 0 0 1 {x + 7 + rr * 0.78:.2f},{y - 4 - rr * 0.62:.2f}" '
                  f'fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>')
        else:
            d.add(f'<circle cx="{x + 7:.2f}" cy="{y - 2.6:.2f}" r="1.9" fill="#fff"/>')
    x += 21
    d.add(f'<rect x="{x:.2f}" y="{y - 11.5:.2f}" width="25" height="12" rx="3.6" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="1"/>'
          f'<rect x="{x + 2:.2f}" y="{y - 9.5:.2f}" width="18" height="8" rx="2" fill="#fff"/>'
          f'<path d="M{x + 26.5:.2f},{y - 7.5:.2f}v4" stroke="#fff" stroke-opacity="0.4" stroke-width="1.6" stroke-linecap="round"/>')


def forecast_screen(d, w, h, kind):
    """The Forecast app's ContentView, laid out in points for a w×h screen."""
    sky = d.lingrad([(0, "#4f9cf6", 1), (1, "#1f63d6", 1)])
    d.add(f'<rect width="{w}" height="{h}" fill="url(#{sky})"/>')
    if kind == "ipad":
        safe, pad = 24, 40
        d.text(28, 18, "9:41  Thu 22 Oct", weight=600, size=13, fill="#fff")
    elif kind == "notch":
        safe, pad = 47, 16
        status_bar(d, w, 33, False, 52, w - 54)
    else:
        safe, pad = 62, 16
        status_bar(d, w, 36, True, 64, w - 62)
    cx = w / 2
    y = safe + 48 + 34 + (40 if kind == "ipad" else 0)
    d.text(cx, y, "Lisbon", face="display", weight=500, size=34, fill="#fff", anchor="middle")
    y += 96
    d.text(cx + 14, y, "21°", face="display", weight=100, size=96, fill="#fff", anchor="middle")
    y += 32
    d.text(cx, y, "Mostly Sunny", weight=500, size=20, fill="#fff", opacity=0.65, anchor="middle")
    y += 27
    d.text(cx, y, "H:24°  L:15°", weight=500, size=20, fill="#fff", anchor="middle")

    cw = w - 2 * pad
    y += 30
    ch = 122
    d.add(f'<rect x="{pad}" y="{y:.2f}" width="{cw}" height="{ch}" rx="16" fill="#fff" fill-opacity="0.16"/>')
    d.text(pad + 16, y + 24, "HOURLY FORECAST", weight=600, size=12, fill="#fff", opacity=0.62, ls=0.02)
    d.add(f'<line x1="{pad + 16}" x2="{pad + cw - 16}" y1="{y + 36:.2f}" y2="{y + 36:.2f}" stroke="#fff" stroke-opacity="0.22"/>')
    cols = max(5, min(len(HOURS), int((cw - 16) // 58)))
    step = (cw - 16) / cols
    for i, (hr, kind_, t) in enumerate(HOURS[:cols]):
        hx = pad + 8 + step * (i + 0.5)
        d.text(hx, y + 60, hr, weight=600, size=15, fill="#fff", anchor="middle")
        d.add(weather_glyph(d, kind_, hx, y + 80, 13))
        d.text(hx + 3, y + 111, f"{t}°", weight=600, size=19, fill="#fff", anchor="middle")
    y += ch + 12

    room = h - 34 - y - 36 - 8
    rows = max(3, min(len(DAYS), int(room // 44)))
    dh = 36 + rows * 44 + 4
    d.add(f'<rect x="{pad}" y="{y:.2f}" width="{cw}" height="{dh}" rx="16" fill="#fff" fill-opacity="0.16"/>')
    d.text(pad + 16, y + 24, f"{rows}-DAY FORECAST", weight=600, size=12, fill="#fff", opacity=0.62, ls=0.02)
    lo_all, hi_all = 14, 25
    bar = d.lingrad([(0, "#8fd8ff", 1), (0.55, "#ffe14d", 1), (1, "#ff9f0a", 1)], x2=1, y2=0)
    for i, (day, kind_, lo, hi) in enumerate(DAYS[:rows]):
        ry = y + 36 + i * 44
        d.add(f'<line x1="{pad + 16}" x2="{pad + cw - 16}" y1="{ry:.2f}" y2="{ry:.2f}" stroke="#fff" stroke-opacity="0.22"/>')
        my = ry + 22
        d.text(pad + 16, my + 7, day, weight=600, size=19, fill="#fff")
        d.add(weather_glyph(d, kind_, pad + 108, my, 13))
        tx0, tx1 = pad + 176, pad + cw - 60
        d.text(tx0 - 10, my + 7, f"{lo}°", weight=600, size=19, fill="#fff", opacity=0.6, anchor="end")
        d.text(pad + cw - 16, my + 7, f"{hi}°", weight=600, size=19, fill="#fff", anchor="end")
        d.add(f'<rect x="{tx0:.2f}" y="{my - 2.5:.2f}" width="{tx1 - tx0:.2f}" height="5" rx="2.5" fill="#000" fill-opacity="0.18"/>')
        f0 = tx0 + (tx1 - tx0) * (lo - lo_all) / (hi_all - lo_all)
        f1 = tx0 + (tx1 - tx0) * (hi - lo_all) / (hi_all - lo_all)
        d.add(f'<rect x="{f0:.2f}" y="{my - 2.5:.2f}" width="{f1 - f0:.2f}" height="5" rx="2.5" fill="url(#{bar})"/>')
    d.add(f'<rect x="{cx - 67}" y="{h - 13}" width="134" height="5" rx="2.5" fill="#fff"/>')


DEVICES = {
    "iPhone 17 Pro": dict(w=402, h=874, r=62, kind="island", size="6.3″"),
    "iPhone 17 Pro Max": dict(w=440, h=956, r=62, kind="island", size="6.9″"),
    "iPhone 16e": dict(w=390, h=844, r=47, kind="notch", size="6.1″"),
    "iPad Air 11″": dict(w=820, h=1180, r=18, kind="ipad", size="11″"),
}


def device(d, name, x, y, scale):
    """Draws a device at (x, y) top-left of its outer frame. Returns outer (w, h)."""
    t, spec = d.t, DEVICES[name]
    w, h, r, kind = spec["w"], spec["h"], spec["r"], spec["kind"]
    bez, frm = (22, 5) if kind == "ipad" else (7, 4)
    ow, oh = w + 2 * (bez + frm), h + 2 * (bez + frm)
    tit = d.lingrad([(0, t["titanium"][0], 1), (1, t["titanium"][1], 1)], x2=1, y2=1)
    shadow = d.shadow([(18, 22, 0.16 if t["shadow"] < 0.5 else 0.5), (3, 4, 0.10)])
    g = [f'<g transform="translate({x:.2f},{y:.2f}) scale({scale})">']
    d.add("".join(g))
    if kind == "ipad":
        btns = [("top", ow - 150, 70)]
    else:
        btns = [("l", 150, 34), ("l", 215, 64), ("l", 295, 64), ("r", 250, 100)]
        if kind == "island":
            btns.append(("r", 520, 64))
    for side, at, ln in btns:
        if side == "top":
            d.add(f'<rect x="{at}" y="-3" width="{ln}" height="6" rx="2" fill="url(#{tit})"/>')
        else:
            bx = -2.8 if side == "l" else ow - 3.2
            d.add(f'<rect x="{bx}" y="{at}" width="6" height="{ln}" rx="2" fill="url(#{tit})"/>')
    orr = r + bez + frm
    d.add(f'<rect width="{ow}" height="{oh}" rx="{orr}" fill="url(#{tit})" filter="url(#{shadow})"/>')
    d.add(f'<rect x="1" y="1" width="{ow - 2}" height="{oh - 2}" rx="{orr - 1}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="1"/>')
    d.add(f'<rect x="{frm}" y="{frm}" width="{ow - 2 * frm}" height="{oh - 2 * frm}" rx="{r + bez}" fill="#050505"/>')
    cid = d.clip(f'<rect width="{w}" height="{h}" rx="{r}"/>')
    d.add(f'<g transform="translate({frm + bez},{frm + bez})"><g clip-path="url(#{cid})">')
    forecast_screen(d, w, h, kind)
    if kind == "island":
        d.add(f'<rect x="{w / 2 - 63}" y="11" width="126" height="37" rx="18.5" fill="#000"/>')
    elif kind == "notch":
        nw, nh = 162, 32
        nx = w / 2 - nw / 2
        d.add(f'<path d="M{nx - 6},0 Q{nx},0 {nx},6 V{nh - 18} Q{nx},{nh} {nx + 18},{nh} H{nx + nw - 18} '
              f'Q{nx + nw},{nh} {nx + nw},{nh - 18} V6 Q{nx + nw},0 {nx + nw + 6},0 Z" fill="#000"/>')
    d.add("</g></g>")
    if kind == "ipad":
        d.add(f'<circle cx="{ow - frm - bez / 2}" cy="{oh / 2}" r="2.6" fill="#1c1c22"/>')
    d.add("</g>")
    return ow * scale, oh * scale


# ---------------------------------------------------------------- swift highlighting

CODE = '''import SwiftUI

struct ContentView: View {
    let city = "Lisbon"
    @State private var forecast = Forecast.today

    var body: some View {
        ScrollView {
            VStack(spacing: 4) {
                Text(city)
                    .font(.largeTitle.weight(.medium))
                Text("\\(forecast.now)°")
                    .font(.system(size: 96, weight: .thin))
                Text(forecast.summary)
                    .foregroundStyle(.secondary)
                Text("H:\\(forecast.high)°  L:\\(forecast.low)°")
            }
            .padding(.top, 48)

            HourlyStrip(hours: forecast.hourly)
            DailyList(days: forecast.daily)
        }
        .padding(.horizontal)
        .background(.blue.gradient)
        .foregroundStyle(.white)
    }
}

#Preview {
    ContentView()
}'''

KEYWORDS = {"import", "struct", "let", "var", "private", "some", "func", "return", "static"}
PROJECT_TYPES = {"ContentView", "Forecast", "HourlyStrip", "DailyList"}
TOKEN = re.compile(r'(?P<str>"(?:[^"\\]|\\.)*")|(?P<attr>[@#]\w+)|(?P<num>\b\d+\b)|(?P<word>[A-Za-z_]\w*)|(?P<ws>\s+)|(?P<p>.)')


def highlight(line):
    """Yields (text, colour key, weight) runs following Xcode's Default theme."""
    prev_word, prev_sig = None, None
    for m in TOKEN.finditer(line):
        kind, tok = m.lastgroup, m.group()
        if kind == "str":
            pos = 0
            for im in re.finditer(r"\\\((.*?)\)", tok):
                yield tok[pos:im.start() + 2], "str", 400
                yield from highlight(im.group(1))
                pos = im.end() - 1
            yield tok[pos:], "str", 400
        elif kind == "attr":
            yield tok, "kw" if tok.startswith("#") else "attr", 500
        elif kind == "num":
            yield tok, "num", 400
        elif kind == "word":
            if tok in KEYWORDS:
                yield tok, "kw", 500
            elif prev_sig == ".":
                yield tok, "member", 400
            elif prev_word in ("struct", "let", "var"):
                yield tok, "decl", 400
            elif tok[0].isupper():
                yield tok, "type" if tok in PROJECT_TYPES else "other", 400
            else:
                yield tok, "plain", 400
            prev_word = tok
        else:
            yield tok, "plain", 400
        if kind != "ws":
            prev_sig = tok


# ---------------------------------------------------------------- hero

def hero(theme):
    W, H = 1600, 1040
    d = Doc(W, H, theme)
    t = d.t
    X, Y, WW, WH = 50, 46, 1500, 900
    win = d.shadow([(28, 42, t["shadow"] * 0.9), (4, 8, t["shadow"] * 0.5)])
    d.add(f'<rect x="{X}" y="{Y}" width="{WW}" height="{WH}" rx="14" fill="{t["window"]}" filter="url(#{win})"/>')
    cid = d.clip(f'<rect x="{X}" y="{Y}" width="{WW}" height="{WH}" rx="14"/>')
    d.add(f'<g clip-path="url(#{cid})"><g transform="translate({X},{Y})">')

    TB, SB, AB, SW, PW, PANEL = 52, 26, 48, 256, 470, 132
    ex0, ex1 = AB + SW, WW - PW

    # title bar
    d.add(f'<rect width="{WW}" height="{TB}" fill="{t["bar"]}"/>')
    d.add(f'<line x1="0" x2="{WW}" y1="{TB - 0.5}" y2="{TB - 0.5}" stroke="{t["sep"]}"/>')
    for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        d.add(f'<circle cx="{22 + i * 20}" cy="{TB / 2}" r="6" fill="{c}"/>'
              f'<circle cx="{22 + i * 20}" cy="{TB / 2}" r="5.75" fill="none" stroke="#000" stroke-opacity="0.12" stroke-width="0.5"/>')
    d.add(glyph("play", 104, TB / 2 - 10, 20, t["label2"], 1.7))
    d.add(glyph("stop", 136, TB / 2 - 9, 18, t["label3"], 1.6))
    sx = 176
    label = "Forecast"
    dev = "iPhone 17 Pro"
    pw_ = 34 + text_width(label, weight=500, size=12.5) + 30 + text_width(dev, weight=500, size=12.5) + 16
    d.add(f'<rect x="{sx}" y="{TB / 2 - 14}" width="{pw_:.2f}" height="28" rx="7" fill="{t["hover"]}"/>')
    d.add(app_icon(d, sx + 8, TB / 2 - 8, 16, shadow=False))
    d.text(sx + 30, TB / 2 + 4.5, label, weight=500, size=12.5)
    gx = sx + 30 + text_width(label, weight=500, size=12.5) + 6
    d.add(glyph("chev_r", gx, TB / 2 - 7, 14, t["label3"], 1.6))
    d.add(glyph("phone", gx + 15, TB / 2 - 7.5, 15, t["label2"], 1.5))
    d.text(gx + 33, TB / 2 + 4.5, dev, weight=500, size=12.5)

    aw, acx = 430, WW / 2 + 40
    d.add(f'<rect x="{acx - aw / 2}" y="{TB / 2 - 14}" width="{aw}" height="28" rx="7" fill="{t["window"]}" '
          f'stroke="{t["sep"]}"/>')
    d.add(f'<circle cx="{acx - aw / 2 + 18}" cy="{TB / 2}" r="7" fill="{t["success"]}"/>')
    d.add(glyph("check", acx - aw / 2 + 12.5, TB / 2 - 5.5, 11, "#fff", 2.0))
    d.text(acx - aw / 2 + 33, TB / 2 + 4.5, "Running Forecast on iPhone 17 Pro", weight=500, size=12.5)
    d.text(acx + aw / 2 - 14, TB / 2 + 4.5, "2.4 s", size=12, fill=t["label2"], anchor="end")
    for i, gname in enumerate(("sidebar", "panel", "split")):
        d.add(glyph(gname, WW - 104 + i * 30, TB / 2 - 9, 18, t["label2"], 1.4))

    # activity bar + sidebar
    d.add(f'<rect x="0" y="{TB}" width="{AB + SW}" height="{WH - TB - SB}" fill="{t["sidebar"]}"/>')
    d.add(f'<line x1="{AB + SW - 0.5}" x2="{AB + SW - 0.5}" y1="{TB}" y2="{WH - SB}" stroke="{t["sep"]}"/>')
    for i, gname in enumerate(("files", "search", "branch", "debug")):
        d.add(glyph(gname, 12, TB + 16 + i * 46, 24, t["label3"], 1.5))
    ay = TB + 16 + 4 * 46
    d.add(f'<rect x="0" y="{ay - 8}" width="2.5" height="40" rx="1" fill="{t["accent"]}"/>')
    d.add(glyph("phone", 12, ay, 24, t["label"], 1.5))

    sx0 = AB + 14
    d.text(sx0, TB + 30, "EXPLORER", weight=600, size=11, fill=t["label2"], ls=0.06)
    rows = [(0, "chev_d", "FORECAST", 1), (1, "chev_d", "Sources", 0), (2, None, "ForecastApp.swift", 0),
            (2, None, "ContentView.swift", 2), (2, None, "HourlyStrip.swift", 0), (2, None, "DailyList.swift", 0),
            (2, None, "Forecast.swift", 0), (1, "chev_r", "Resources", 0), (1, None, "Package.swift", 0),
            (1, None, "xtool.yml", 0)]
    ry = TB + 48
    for depth, chev, name, state in rows:
        if state == 2:
            d.add(f'<rect x="{AB + 6}" y="{ry}" width="{SW - 12}" height="24" rx="6" fill="{t["select"]}"/>')
        ix = sx0 + depth * 14
        if chev:
            d.add(glyph(chev, ix - 2, ry + 5, 14, t["label2"], 1.6))
        if state == 1:
            d.text(ix + 16, ry + 16.5, name, weight=700, size=11, ls=0.04)
        else:
            if chev:
                d.add(glyph("folder", ix + 14, ry + 4, 16, t["accent"], 1.4))
            elif name.endswith(".swift"):
                d.add(glyph("doc", ix + 14, ry + 4, 16, "#f05138", 1.4))
            else:
                d.add(glyph("doc", ix + 14, ry + 4, 16, t["label3"], 1.4))
            d.text(ix + 36, ry + 16.5, name, weight=500 if state == 2 else 400, size=13)
        ry += 24

    ry += 22
    d.add(f'<line x1="{AB}" x2="{AB + SW}" y1="{ry - 10}" y2="{ry - 10}" stroke="{t["sep"]}"/>')
    d.text(sx0, ry + 12, "DEVICES", weight=600, size=11, fill=t["label2"], ls=0.06)
    ry += 26
    devs = [("phone", "iPhone 15 Pro", "USB · this computer", t["success"], False),
            ("phone", "iPhone 17 Pro", "Simulator · mac-mini", t["accent"], True),
            ("tablet", "iPad Air 11″", "Simulator · mac-mini", None, False),
            ("phone", "iPhone 16e", "Simulator · mac-mini", None, False)]
    for gname, name, sub, dot, sel in devs:
        if sel:
            d.add(f'<rect x="{AB + 6}" y="{ry - 2}" width="{SW - 12}" height="44" rx="7" fill="{t["select"]}"/>')
        d.add(glyph(gname, sx0 - 2, ry + 6, 26, t["label"] if sel else t["label2"], 1.5))
        d.text(sx0 + 32, ry + 17, name, weight=500, size=13)
        d.text(sx0 + 32, ry + 33, sub, size=11.5, fill=t["label2"])
        if dot:
            d.add(f'<circle cx="{AB + SW - 24}" cy="{ry + 20}" r="4" fill="{dot}"/>')
        ry += 48

    # editor tabs
    d.add(f'<rect x="{ex0}" y="{TB}" width="{ex1 - ex0}" height="38" fill="{t["bar"]}"/>')
    d.add(f'<line x1="{ex0}" x2="{ex1}" y1="{TB + 37.5}" y2="{TB + 37.5}" stroke="{t["sep"]}"/>')
    tx = ex0
    for i, name in enumerate(("ContentView.swift", "HourlyStrip.swift")):
        tw = 44 + text_width(name, size=12.5) + 30
        if i == 0:
            d.add(f'<rect x="{tx}" y="{TB}" width="{tw:.2f}" height="38" fill="{t["window"]}"/>'
                  f'<rect x="{tx}" y="{TB}" width="{tw:.2f}" height="2" fill="{t["accent"]}"/>')
        d.add(f'<line x1="{tx + tw - 0.5:.2f}" x2="{tx + tw - 0.5:.2f}" y1="{TB}" y2="{TB + 38}" stroke="{t["sep"]}"/>')
        d.add(glyph("doc", tx + 14, TB + 11, 16, "#f05138", 1.4))
        d.text(tx + 36, TB + 23.5, name, weight=500 if i == 0 else 400, size=12.5,
               fill=t["label"] if i == 0 else t["label2"])
        tx += tw
    by = TB + 38
    crumbs = ["Forecast", "Sources", "ContentView.swift", "body"]
    cx_ = ex0 + 18
    for i, c in enumerate(crumbs):
        d.text(cx_, by + 18, c, size=12, fill=t["label2"])
        cx_ += text_width(c, size=12) + 4
        if i < len(crumbs) - 1:
            d.add(glyph("chev_r", cx_, by + 7.5, 13, t["label3"], 1.5))
            cx_ += 17

    # code
    LH, FS = 20, 13
    adv = text_width("M", "mono", 400, FS)
    top = by + 42
    cur = 12
    gut = ex0 + 52
    d.add(f'<rect x="{ex0}" y="{top + (cur - 1) * LH - 14.5}" width="{ex1 - ex0}" height="{LH}" fill="{t["line"]}"/>')
    for n, line in enumerate(CODE.split("\n"), 1):
        yy = top + (n - 1) * LH
        d.text(gut - 16, yy, str(n), "mono", 400, 12, fill=t["label2"] if n == cur else t["label3"], anchor="end")
        col = 0
        runs = []
        for txt, key, wt in highlight(line):
            # SVG collapses runs of spaces, so every word gets its own column-exact x.
            for m in re.finditer(r"\S+", txt):
                d.chars[("mono", wt)].update(m.group())
                runs.append(f'<tspan x="{gut + (col + m.start()) * adv:.2f}" fill="{t["syn"][key]}" '
                            f'font-weight="{wt}">{esc(m.group())}</tspan>')
            col += len(txt)
        if runs:
            d.add(f'<text y="{yy}" class="mono" font-size="{FS}">{"".join(runs)}</text>')
    caret_x = gut + len(CODE.split("\n")[cur - 1]) * adv + 1
    d.add(f'<rect x="{caret_x:.2f}" y="{top + (cur - 1) * LH - 13}" width="1.6" height="17" fill="{t["accent"]}"/>')

    # output panel
    py = WH - SB - PANEL
    d.add(f'<rect x="{ex0}" y="{py}" width="{ex1 - ex0}" height="{PANEL}" fill="{t["window"]}"/>')
    d.add(f'<line x1="{ex0}" x2="{ex1}" y1="{py + 0.5}" y2="{py + 0.5}" stroke="{t["sep"]}"/>')
    tx = ex0 + 18
    for i, name in enumerate(("PROBLEMS", "OUTPUT", "TERMINAL", "DEVICE LOG")):
        d.text(tx, py + 22, name, weight=600 if i == 1 else 500, size=11, fill=t["label"] if i == 1 else t["label3"], ls=0.05)
        tw = text_width(name, weight=500, size=11, ls=0.05)
        if i == 1:
            d.add(f'<rect x="{tx}" y="{py + 29}" width="{tw:.2f}" height="1.6" fill="{t["accent"]}"/>')
        tx += tw + 26
    log = [("09:41:01", "Synced 5 files to mac-mini.local", None),
           ("09:41:02", "Building Forecast for iPhone 17 Pro Simulator", None),
           ("09:41:03", "Compiled 5 Swift files · 0 warnings", None),
           ("09:41:04", "Installed on iPhone 17 Pro", None),
           ("09:41:04", "Launched Forecast in 2.4 s", "ok")]
    for i, (ts, msg, st) in enumerate(log):
        ly = py + 50 + i * 17.5
        d.text(ex0 + 18, ly, ts, "mono", 400, 12, fill=t["label3"])
        if st:
            d.add(glyph("check", ex0 + 92, ly - 11, 13, t["success"], 1.8))
            d.text(ex0 + 110, ly, msg, "mono", 500, 12, fill=t["success"])
        else:
            d.text(ex0 + 92, ly, msg, "mono", 400, 12, fill=t["label2"])

    # preview pane
    d.add(f'<rect x="{ex1}" y="{TB}" width="{PW}" height="{WH - TB - SB}" fill="{t["canvas"]}"/>')
    d.add(f'<line x1="{ex1 + 0.5}" x2="{ex1 + 0.5}" y1="{TB}" y2="{WH - SB}" stroke="{t["sep"]}"/>')
    d.add(f'<rect x="{ex1}" y="{TB}" width="{PW}" height="44" fill="{t["bar"]}"/>')
    d.add(f'<line x1="{ex1}" x2="{WW}" y1="{TB + 43.5}" y2="{TB + 43.5}" stroke="{t["sep"]}"/>')
    sgx, sgy = ex1 + 16, TB + 9
    d.add(f'<rect x="{sgx}" y="{sgy}" width="132" height="26" rx="7" fill="{t["hover"]}"/>')
    d.add(f'<rect x="{sgx + 2}" y="{sgy + 2}" width="64" height="22" rx="5.5" fill="{t["window"]}" '
          f'stroke="{t["sep"]}" stroke-width="0.5"/>')
    d.text(sgx + 34, sgy + 17.5, "Live", weight=600, size=12, anchor="middle")
    d.text(sgx + 99, sgy + 17.5, "Gallery", weight=500, size=12, fill=t["label2"], anchor="middle")
    d.add(f'<circle cx="{WW - 150}" cy="{TB + 22}" r="3.5" fill="#ff453a"/>')
    d.text(WW - 141, TB + 26, "LIVE", weight=700, size=10.5, fill=t["label2"], ls=0.08)
    d.add(glyph("rotate", WW - 96, TB + 13, 18, t["label2"], 1.5))
    d.add(glyph("phone", WW - 62, TB + 12, 20, t["label2"], 1.5))
    d.add(glyph("chev_d", WW - 42, TB + 15, 14, t["label3"], 1.6))

    s = 0.775
    ow = (402 + 22) * s
    oh = (874 + 22) * s
    canvas_top, canvas_h = TB + 44, WH - SB - TB - 44
    device(d, "iPhone 17 Pro", ex1 + PW / 2 - ow / 2, canvas_top + (canvas_h - oh) / 2 - 10, s)
    pill = "mac-mini.local · 60 fps · 38 ms"
    pw2 = text_width(pill, size=11.5) + 24
    py2 = WH - SB - 32
    d.add(f'<rect x="{ex1 + PW / 2 - pw2 / 2:.2f}" y="{py2}" width="{pw2:.2f}" height="22" rx="11" fill="{t["window"]}" '
          f'stroke="{t["sep"]}"/>')
    d.text(ex1 + PW / 2, py2 + 15, pill, size=11.5, fill=t["label2"], anchor="middle")

    # status bar
    sy = WH - SB
    d.add(f'<rect x="0" y="{sy}" width="{WW}" height="{SB}" fill="{t["bar"]}"/>')
    d.add(f'<line x1="0" x2="{WW}" y1="{sy + 0.5}" y2="{sy + 0.5}" stroke="{t["sep"]}"/>')
    rlabel = "mac-mini.local"
    rw = text_width(rlabel, weight=500, size=11.5) + 40
    d.add(f'<rect x="0" y="{sy}" width="{rw:.2f}" height="{SB}" fill="{t["accent"]}"/>')
    d.add(glyph("remote", 9, sy + 5, 16, "#fff", 1.7))
    d.text(30, sy + 17.5, rlabel, weight=500, size=11.5, fill="#fff")
    d.add(glyph("branch", rw + 12, sy + 5, 16, t["label2"], 1.5))
    d.text(rw + 32, sy + 17.5, "main", size=11.5, fill=t["label2"])
    d.text(rw + 80, sy + 17.5, "0 errors · 0 warnings", size=11.5, fill=t["label2"])
    right = ["Ln 12, Col 37", "Spaces: 4", "Swift", "iPhone 17 Pro"]
    rx_ = WW - 16
    for item in reversed(right):
        d.text(rx_, sy + 17.5, item, size=11.5, fill=t["label2"], anchor="end")
        rx_ -= text_width(item, size=11.5) + 22

    d.add("</g></g>")
    if t["rim"] != "none":
        d.add(f'<rect x="{X + 0.5}" y="{Y + 0.5}" width="{WW - 1}" height="{WH - 1}" rx="13.5" fill="none" stroke="{t["rim"]}"/>')
    else:
        d.add(f'<rect x="{X + 0.5}" y="{Y + 0.5}" width="{WW - 1}" height="{WH - 1}" rx="13.5" fill="none" stroke="#000" stroke-opacity="0.12"/>')
    return d.svg("Slipway in VS Code: Swift source, build output and a live iPhone 17 Pro preview")


# ---------------------------------------------------------------- device gallery

def gallery(theme):
    W, H = 1600, 820
    d = Doc(W, H, theme)
    t = d.t
    order = ["iPad Air 11″", "iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 16e"]
    s = 0.5
    sizes = []
    for n in order:
        spec = DEVICES[n]
        bez, frm = (22, 5) if spec["kind"] == "ipad" else (7, 4)
        sizes.append(((spec["w"] + 2 * (bez + frm)) * s, (spec["h"] + 2 * (bez + frm)) * s))
    gap = 76
    total = sum(w for w, _ in sizes) + gap * (len(order) - 1)
    x = (W - total) / 2
    base = 650
    for n, (w, h) in zip(order, sizes):
        floor_ = d.uid("f")
        d.defs.append(f'<radialGradient id="{floor_}"><stop offset="0" stop-color="#000" stop-opacity="{0.22 if theme == "light" else 0.6}"/>'
                      f'<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>')
        d.add(f'<ellipse cx="{x + w / 2:.2f}" cy="{base + 6}" rx="{w * 0.48:.2f}" ry="10" fill="url(#{floor_})"/>')
        device(d, n, x, base - h, s)
        spec = DEVICES[n]
        d.text(x + w / 2, base + 52, n, weight=600, size=17, anchor="middle")
        d.text(x + w / 2, base + 76, f'{spec["size"]} · {spec["w"]} × {spec["h"]} pt', size=14,
               fill=t["label2"], anchor="middle")
        x += w + gap
    return d.svg("The Forecast app rendered on iPad Air 11-inch, iPhone 17 Pro Max, iPhone 17 Pro and iPhone 16e")


# ---------------------------------------------------------------- how it works

def flow(theme):
    W, H = 1600, 530
    d = Doc(W, H, theme)
    t = d.t
    card_sh = d.shadow([(10, 18, t["shadow"] * 0.45), (1, 2, t["shadow"] * 0.35)])

    def card(x, y, w, icon, title, sub, rows, tag, tag_ok):
        h = 96 + 44 * len(rows)
        d.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{t["card"]}" filter="url(#{card_sh})"/>')
        d.add(f'<rect x="{x + 0.5}" y="{y + 0.5}" width="{w - 1}" height="{h - 1}" rx="17.5" fill="none" '
              f'stroke="{t["rim"] if t["rim"] != "none" else "rgba(0,0,0,0.08)"}"/>')
        d.add(f'<rect x="{x + 24}" y="{y + 24}" width="52" height="52" rx="12" fill="{t["select"]}"/>')
        d.add(glyph(icon, x + 34, y + 34, 32, t["accent"], 1.7))
        d.text(x + 92, y + 46, title, face="display", weight=600, size=21, ls=-0.01)
        d.text(x + 92, y + 70, sub, size=14, fill=t["label2"])
        tw = text_width(tag, weight=600, size=12) + 22
        col = t["success"] if tag_ok else t["label2"]
        d.add(f'<rect x="{x + w - 24 - tw:.2f}" y="{y + 28}" width="{tw:.2f}" height="24" rx="12" fill="{col}" fill-opacity="0.14"/>')
        d.text(x + w - 24 - tw / 2, y + 44.5, tag, weight=600, size=12, fill=col, anchor="middle")
        ry = y + 124
        for g_, r_ in rows:
            d.add(f'<line x1="{x + 24}" x2="{x + w - 24}" y1="{ry - 28}" y2="{ry - 28}" stroke="{t["sep"]}"/>')
            d.add(glyph(g_, x + 26, ry - 14, 20, t["label2"], 1.5))
            d.text(x + 58, ry + 1, r_, size=15)
            ry += 44

    cw = 520
    ax, ay = 70, 129
    bx, by = 1010, 40
    cx, cy = 1010, 300
    card(ax, ay, cw, "laptop", "Your computer", "Windows with WSL, or Linux",
         [("files", "VS Code with Slipway"), ("folder", "iOS SDK from your own Xcode download"),
          ("check", "xtool builds and signs"), ("phone", "go-ios launches and reads logs")],
         "No Mac", True)
    card(bx, by, cw, "phone", "Your iPhone", "Connected with a USB cable",
         [("play", "Install and launch"), ("panel", "Live device log"), ("doc", "Crash reports")],
         "USB", False)
    card(cx, cy, cw, "key", "Apple", "Your Apple ID; a free one works",
         [("key", "Sign in through xtool"), ("rotate", "7-day signing, refreshed in one click")],
         "Sign-in", False)

    def lane(y, label, back=False):
        x1, x2 = ax + cw + 14, bx - 14
        color = t["label3"] if back else t["accent"]
        dash = ' stroke-dasharray="1 7"' if back else ""
        d.add(f'<line x1="{x1}" x2="{x2}" y1="{y}" y2="{y}" stroke="{color}" stroke-width="2.4" stroke-linecap="round"{dash}/>')
        hx, k = (x1, 1) if back else (x2, -1)
        d.add(f'<path d="M{hx + k * 11},{y - 7} L{hx},{y} L{hx + k * 11},{y + 7}" fill="none" stroke="{color}" '
              f'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>')
        lw = text_width(label, weight=500, size=13) + 28
        mx = (x1 + x2) / 2
        d.add(f'<rect x="{mx - lw / 2:.2f}" y="{y - 15}" width="{lw:.2f}" height="30" rx="15" fill="{t["card"]}" '
              f'stroke="{t["sep"]}"/>')
        d.text(mx, y + 4.5, label, weight=500, size=13, fill=t["label2"], anchor="middle")

    lane(154, "Install, launch, logs")
    lane(372, "Sign and refresh")
    return d.svg("How Slipway works: your computer builds with the iOS SDK from your Xcode download, xtool signs with your Apple ID, and the app installs and launches on your iPhone over USB")


# ---------------------------------------------------------------- header

def header(theme):
    W, H = 1200, 350
    d = Doc(W, H, theme)
    t = d.t
    d.add(app_icon(d, W / 2 - 72, 34, 144))
    d.text(W / 2, 262, "Slipway", face="display", weight=700, size=72, anchor="middle", ls=-0.03)
    d.text(W / 2, 318, "iPhone apps from VS Code, on Windows and Linux.", face="display", weight=500,
           size=27, fill=t["label2"], anchor="middle", ls=-0.01)
    return d.svg("Slipway: iPhone apps from VS Code, on Windows and Linux")


def logo():
    d = Doc(256, 256, None)
    d.add(app_icon(d, 24, 18, 208))
    return d.svg("Slipway icon")


if __name__ == "__main__":
    (OUT / "logo.svg").write_text(logo())
    for theme in THEMES:
        for name, fn in (("header", header), ("hero", hero), ("devices", gallery), ("flow", flow)):
            (OUT / f"{name}-{theme}.svg").write_text(fn(theme))
    for p in sorted(OUT.glob("*.svg")):
        print(f"{p.name:24} {p.stat().st_size / 1024:7.1f} KB")
