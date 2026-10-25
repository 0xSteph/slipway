"""Renders the PNG artwork: the social preview card and framed screenshots.

The SVGs come from build.py. These need real screenshots and PNG output (GitHub's social
preview and the Marketplace accept no SVG), so they're laid out in HTML with the vendored
fonts and rendered by headless Chromium:

    CHROME=/path/to/chrome-headless-shell python3 docs/assets/src/render_png.py
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

SRC = Path(__file__).resolve().parent
ASSETS = SRC.parent
SHOTS = ASSETS / "screenshots"
FONTS = SRC / "fonts"
ICON = ASSETS.parent.parent / "media" / "icon.png"

FONT_CSS = "\n".join(
    f"@font-face{{font-family:{family};font-weight:{weight};src:url('{(FONTS / file).as_uri()}')}}"
    for family, weight, file in [
        ("Inter", 400, "Inter-Regular.ttf"),
        ("Inter", 500, "Inter-Medium.ttf"),
        ("Inter", 600, "Inter-SemiBold.ttf"),
        ("InterDisplay", 500, "InterDisplay-Medium.ttf"),
        ("InterDisplay", 700, "InterDisplay-Bold.ttf"),
    ]
)


def render(html: str, out: Path, width: int, height: int, transparent: bool = False) -> None:
    chrome = os.environ.get("CHROME")
    if not chrome:
        sys.exit("Set CHROME to a Chromium or chrome-headless-shell binary.")
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "page.html"
        page.write_text(html)
        args = [
            chrome, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
            "--allow-file-access-from-files", f"--window-size={width},{height}",
            f"--screenshot={out}", page.as_uri(),
        ]
        if transparent:
            args.insert(1, "--default-background-color=00000000")
        subprocess.run(args, check=True, capture_output=True)
    print(f"{out.relative_to(ASSETS)}  {out.stat().st_size / 1024:.0f} KB")


def social() -> None:
    """GitHub social preview, 1280×640. Upload in the repository's Settings → Social preview."""
    shot = (SHOTS / "doctor-build-dark.png").as_uri()
    html = f"""<!doctype html><html><head><style>{FONT_CSS}
    body{{margin:0;width:1280px;height:640px;overflow:hidden;font-family:Inter;color:#f5f5f7;
      background:radial-gradient(900px 520px at 78% 30%,rgba(10,132,255,.32),transparent 70%),
                 linear-gradient(160deg,#05070d 0%,#0b1426 100%)}}
    .copy{{position:absolute;left:80px;top:92px;width:560px}}
    .icon{{width:112px;height:112px;display:block;margin-left:-8px}}
    h1{{font-family:InterDisplay;font-weight:700;font-size:92px;letter-spacing:-.03em;margin:22px 0 18px}}
    p{{font-family:InterDisplay;font-weight:500;font-size:40px;line-height:1.18;letter-spacing:-.015em;margin:0;color:#d6d6dc}}
    p b{{color:#0a84ff;font-weight:500}}
    .meta{{position:absolute;left:80px;bottom:64px;font-size:21px;font-weight:500;color:#a1a1a6;letter-spacing:.01em}}
    .shot{{position:absolute;left:668px;top:110px;width:860px;border-radius:16px;
      box-shadow:0 30px 80px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.12)}}
    </style></head><body>
    <div class="copy"><img class="icon" src="{ICON.as_uri()}">
      <h1>Slipway</h1>
      <p>Build iPhone apps on Windows and Linux.<br><b>No Mac required.</b></p></div>
    <div class="meta">VS Code extension · SwiftUI · Open source</div>
    <img class="shot" src="{shot}">
    </body></html>"""
    render(html, ASSETS / "social-preview.png", 1280, 640)


def framed(name: str, theme: str) -> None:
    """A screenshot with rounded corners, a rim and a soft shadow on a transparent background."""
    src = SHOTS / f"{name}-{theme}.png"
    rim = "rgba(255,255,255,.12)" if theme == "dark" else "rgba(0,0,0,.10)"
    pad, w, h = 96, 2880, 1800
    html = f"""<!doctype html><html><head><style>
    body{{margin:0;padding:{pad}px;background:transparent}}
    img{{display:block;width:{w}px;height:{h}px;border-radius:28px;
      box-shadow:0 36px 96px rgba(0,0,0,.28),0 4px 14px rgba(0,0,0,.18),0 0 0 2px {rim}}}
    </style></head><body><img src="{src.as_uri()}"></body></html>"""
    render(html, SHOTS / f"{name}-{theme}-framed.png", w + 2 * pad, h + 2 * pad, transparent=True)


if __name__ == "__main__":
    social()
    for shot in ("doctor-build", "problems"):
        for theme in ("light", "dark"):
            framed(shot, theme)
