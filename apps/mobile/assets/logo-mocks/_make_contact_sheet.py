"""Compose a contact sheet of all 5 logo concepts at home-screen-icon size.

Renders each SVG to an iOS-style squircle (rounded-rect) icon on a dark
background, labels them, and writes contact-sheet.png next to the SVGs.
"""

from __future__ import annotations

import io
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
ICONS = [
    ("01-ticket.svg",    "1. Ticket Stub"),
    ("02-marquee.svg",   "2. Marquee Bulbs"),
    ("03-spotlight.svg", "3. Spotlight"),
    ("04-neon.svg",      "4. Neon Curve"),
    ("05-confetti.svg",  "5. Confetti Burst"),
]

ICON_SIZE = 360       # icon render resolution
CORNER_RADIUS = 80    # squircle-ish corner
PAD_X, PAD_Y = 40, 40 # outer padding around grid
LABEL_H = 56          # label strip below each icon
GAP = 32              # gap between icons

COLS = 3
ROWS = 2
SHEET_W = PAD_X * 2 + COLS * ICON_SIZE + (COLS - 1) * GAP
SHEET_H = PAD_Y * 2 + ROWS * (ICON_SIZE + LABEL_H) + (ROWS - 1) * GAP

BG = (18, 18, 22)
LABEL_BG = (24, 24, 28)
LABEL_FG = (235, 235, 235)


def render_icon(svg_path: Path) -> Image.Image:
    """Render an SVG to a rounded-rect masked PIL image."""
    png_bytes = cairosvg.svg2png(
        url=str(svg_path), output_width=ICON_SIZE, output_height=ICON_SIZE
    )
    icon = Image.open(io.BytesIO(png_bytes)).convert("RGBA")

    mask = Image.new("L", (ICON_SIZE, ICON_SIZE), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, ICON_SIZE, ICON_SIZE), radius=CORNER_RADIUS, fill=255
    )

    out = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    out.paste(icon, (0, 0), mask)
    return out


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def main() -> None:
    sheet = Image.new("RGBA", (SHEET_W, SHEET_H), BG + (255,))
    draw = ImageDraw.Draw(sheet)
    font = load_font(26)

    for idx, (svg_name, label) in enumerate(ICONS):
        row, col = divmod(idx, COLS)
        x = PAD_X + col * (ICON_SIZE + GAP)
        y = PAD_Y + row * (ICON_SIZE + LABEL_H + GAP)

        icon = render_icon(HERE / svg_name)
        sheet.alpha_composite(icon, (x, y))

        label_y = y + ICON_SIZE
        draw.rectangle(
            (x, label_y, x + ICON_SIZE, label_y + LABEL_H),
            fill=LABEL_BG,
        )
        tb = draw.textbbox((0, 0), label, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        draw.text(
            (x + (ICON_SIZE - tw) // 2, label_y + (LABEL_H - th) // 2 - tb[1]),
            label,
            font=font,
            fill=LABEL_FG,
        )

    sheet.convert("RGB").save(HERE / "contact-sheet.png", "PNG", optimize=True)
    print(f"wrote {HERE / 'contact-sheet.png'} ({SHEET_W}x{SHEET_H})")


if __name__ == "__main__":
    main()
