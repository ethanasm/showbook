"""Build the final Showbook brand assets from the polished ticket SVG.

Produces:
  apps/mobile/assets/icon.png          1024×1024  master with #0C0C0C bg
  apps/mobile/assets/adaptive-icon.png 1024×1024  foreground only (transparent)
  apps/mobile/assets/favicon.png       48×48      downscaled master
  apps/mobile/assets/splash.png        1284×2778  ticket + wordmark centered
  apps/web/public/showbook-mark.svg    inline SVG for web UI (no bg, no shadow)
  apps/web/app/icon.svg                32×32 favicon-style SVG for next/icon

Run from anywhere: `python3 _build_assets.py`.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import cairosvg
from PIL import Image

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent.parent.parent  # apps/mobile/assets/logo-mocks → repo
MOBILE_ASSETS = REPO_ROOT / "apps" / "mobile" / "assets"
WEB_PUBLIC = REPO_ROOT / "apps" / "web" / "public"
WEB_APP = REPO_ROOT / "apps" / "web" / "app"

MASTER_SVG = HERE / "01-ticket.svg"


def read_master() -> str:
    return MASTER_SVG.read_text(encoding="utf-8")


def render_png(svg_xml: str, width: int, height: int) -> bytes:
    return cairosvg.svg2png(
        bytestring=svg_xml.encode("utf-8"),
        output_width=width,
        output_height=height,
    )


def strip_background(svg_xml: str) -> str:
    """Remove the opaque background rect so the ticket renders on transparency."""
    return re.sub(
        r'<rect id="bg"[^/]*/>',
        "",
        svg_xml,
        count=1,
    )


def make_icon(svg_xml: str) -> None:
    out = MOBILE_ASSETS / "icon.png"
    out.write_bytes(render_png(svg_xml, 1024, 1024))
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def make_adaptive_icon(svg_xml: str) -> None:
    """Foreground-only with transparent background. Android composites this
    over the `backgroundColor` declared in app.config.ts, so dropping the bg
    rect from the master is all we need."""
    fg = strip_background(svg_xml)
    out = MOBILE_ASSETS / "adaptive-icon.png"
    out.write_bytes(render_png(fg, 1024, 1024))
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def make_favicon(svg_xml: str) -> None:
    """48×48 PNG. The master's filter blur is too coarse at this size, so we
    render at 256×256 and downscale with Lanczos for a sharper small icon."""
    large = render_png(svg_xml, 256, 256)
    img = Image.open(io.BytesIO(large)).resize((48, 48), Image.LANCZOS)
    out = MOBILE_ASSETS / "favicon.png"
    img.save(out, "PNG", optimize=True)
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def make_splash(svg_xml: str) -> None:
    """Centered brand-mark splash (1080×1180).

    expo-splash-screen (SDK 50+) renders the `image` as a *centered logo* sized
    by `imageWidth` (see app.config.ts) — NOT a full-bleed background. A
    full-screen composition with the mark floating in the middle therefore gets
    scaled down into the centered splash slot and the logo + wordmark come out
    unreadably small. So the asset is framed *tight*: the ticket, wordmark, and
    tagline fill the canvas with only a small margin, and `backgroundColor` in
    app.config.ts paints the rest of the screen the same #0C0C0C — seamless.
    Keep this composition compact; don't reintroduce large empty margins."""
    W, H = 1080, 1180
    # Ticket up top, large. Wordmark + tagline tucked beneath it. Values chosen
    # so the content block sits roughly centered with a tight, even margin.
    ticket_size = 660
    ticket_x = (W - ticket_size) // 2
    ticket_y = 70
    wordmark_baseline = ticket_y + ticket_size + 235
    tagline_baseline = wordmark_baseline + 100
    splash_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  <rect width="{W}" height="{H}" fill="#0C0C0C"/>
  <g transform="translate({ticket_x} {ticket_y})">
    <svg width="{ticket_size}" height="{ticket_size}" viewBox="0 0 1024 1024">
      {strip_background(svg_xml).split('<svg', 1)[1].split('>', 1)[1].rsplit('</svg>', 1)[0]}
    </svg>
  </g>
  <text x="{W // 2}" y="{wordmark_baseline}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"
        font-weight="700" font-size="184" fill="#EDEDED" text-anchor="middle"
        letter-spacing="-5">showbook</text>
  <text x="{W // 2}" y="{tagline_baseline}" font-family="DejaVu Sans Mono, Liberation Mono, monospace"
        font-weight="500" font-size="42" fill="#7A7A7A" text-anchor="middle"
        letter-spacing="9">YOUR SHOWS, IN ORDER</text>
</svg>"""
    out = MOBILE_ASSETS / "splash.png"
    out.write_bytes(render_png(splash_svg, W, H))
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def make_inline_mark_svg(svg_xml: str) -> None:
    """Simplified mark for in-UI use — same silhouette, solid gold (no
    gradient/shadow/highlight). Renders crisply at 16-48 px. The S retains the
    DejaVu Sans bold path used at icon size, kept as <text> here since web
    browsers fall back to a similar geometric sans cleanly.

    Outputs two files:
      apps/web/public/showbook-mark.svg — 64×64 for <img> usage
      apps/web/app/icon.svg              — 32×32 for Next.js favicon convention
    """
    simplified = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Showbook">
  <title>Showbook</title>
  <g transform="rotate(-6 32 32)">
    <path fill="#FFD166" fill-rule="evenodd" d="
      M 14.5 18
      H 49.5
      A 3.5 3.5 0 0 1 53 21.5
      V 30
      A 3.75 3.75 0 0 0 49.25 33.75
      A 3.75 3.75 0 0 0 53 37.5
      V 42.5
      A 3.5 3.5 0 0 1 49.5 46
      H 14.5
      A 3.5 3.5 0 0 1 11 42.5
      V 37.5
      A 3.75 3.75 0 0 0 14.75 33.75
      A 3.75 3.75 0 0 0 11 30
      V 21.5
      A 3.5 3.5 0 0 1 14.5 18
      Z"/>
    <text x="32" y="41.5" font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif"
          font-weight="900" font-size="26" fill="#0C0C0C" text-anchor="middle"
          letter-spacing="-1">S</text>
  </g>
</svg>"""
    (WEB_PUBLIC / "showbook-mark.svg").write_text(simplified, encoding="utf-8")
    print(f"  wrote {(WEB_PUBLIC / 'showbook-mark.svg').relative_to(REPO_ROOT)}")

    # Next.js icon.svg convention: 32×32, served as /icon. The existing file
    # had its own design; replace with the new mark.
    next_icon = simplified.replace(
        'viewBox="0 0 64 64" width="64" height="64"',
        'viewBox="0 0 64 64" width="32" height="32"',
    )
    (WEB_APP / "icon.svg").write_text(next_icon, encoding="utf-8")
    print(f"  wrote {(WEB_APP / 'icon.svg').relative_to(REPO_ROOT)}")


def main() -> None:
    svg_xml = read_master()
    print("Building Showbook brand assets…")
    make_icon(svg_xml)
    make_adaptive_icon(svg_xml)
    make_favicon(svg_xml)
    make_splash(svg_xml)
    make_inline_mark_svg(svg_xml)
    print("done.")


if __name__ == "__main__":
    main()
