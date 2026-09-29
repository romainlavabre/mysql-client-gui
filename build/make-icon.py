"""Draws build/icon.png (512x512): a database cylinder on a rounded dark tile.

Run: python3 build/make-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 512
SCALE = 4  # supersampling for smooth edges
S = SIZE * SCALE

BACKGROUND = (28, 31, 38, 255)
ACCENT = (242, 181, 68, 255)
ACCENT_DARK = (196, 140, 38, 255)

image = Image.new('RGBA', (S, S), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=BACKGROUND)

left, right = int(S * 0.24), int(S * 0.76)
top, bottom = int(S * 0.2), int(S * 0.8)
ellipse_h = int(S * 0.14)

# Body, then the separating rings, then the top face.
draw.rectangle((left, top + ellipse_h // 2, right, bottom - ellipse_h // 2), fill=ACCENT)
draw.ellipse((left, bottom - ellipse_h, right, bottom), fill=ACCENT)
for fraction in (0.4, 0.6):
    y = int(top + (bottom - top) * fraction)
    draw.arc((left, y - ellipse_h // 2, right, y + ellipse_h // 2), 0, 180, fill=BACKGROUND, width=int(S * 0.018))
draw.ellipse((left, top, right, top + ellipse_h), fill=ACCENT_DARK)

image = image.resize((SIZE, SIZE), Image.LANCZOS)
image.save(Path(__file__).with_name('icon.png'))
