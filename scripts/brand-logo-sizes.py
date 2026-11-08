"""Exact-size logo files for the staff screens, made from the full-size original (public/brand/hupup-logo.png).

The admin shows the logo 128px tall (sign-in card) and 96px tall (sidebar); 80px is the older sign-in size. Each gets 1x, 2x and 3x files so phones
and Retina screens get a sharp image at their real pixel size, and the browser never has to shrink a big file a lot
(that is what made it look soft). High-quality Lanczos downscaling only; nothing is ever enlarged.
Run: python3 scripts/brand-logo-sizes.py
"""
from PIL import Image

SRC = "public/brand/hupup-logo.png"
src = Image.open(SRC).convert("RGBA")
W, H = src.size
for css_h in (80, 96, 128):
    for scale in (1, 2, 3):
        h = css_h * scale
        assert h <= H, "would enlarge the original"
        w = round(W * h / H)
        src.resize((w, h), Image.LANCZOS).save(f"public/brand/hupup-logo-h{css_h}@{scale}x.png", optimize=True)
        print(f"hupup-logo-h{css_h}@{scale}x.png {w}x{h}")
