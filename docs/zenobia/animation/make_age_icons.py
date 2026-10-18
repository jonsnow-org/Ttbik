"""Pre-renders the animated coin icon with an age badge ("new", 1d..30d, 1m..11m, 1y..10y) from public/zenobia/znbt-coin.webp.
The icon endpoint /api/zenobia/znbt/icon serves the file that matches the coin's age. Run from the repository root."""
from PIL import Image, ImageDraw, ImageFont
import os
SRC = 'public/zenobia/znbt-coin.webp'
OUT = 'public/zenobia/znbt/age/'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
labels = ['new'] + [f'{d}d' for d in range(1, 30)] + [f'{m}m' for m in range(1, 12)] + [f'{y}y' for y in range(1, 11)]
src = Image.open(SRC)
frames = []
for i in range(0, src.n_frames, 2):  # every other frame keeps the files small
    src.seek(i)
    frames.append(src.convert('RGBA').resize((224, 224), Image.LANCZOS))
def badge(label):
    out = []
    r = 40
    cx, cy = 224 - r - 6, 224 - r - 6
    size = 44 if len(label) <= 2 else 28 if len(label) == 3 else 26
    font = ImageFont.truetype(FONT, size)
    for f in frames:
        im = f.copy()
        # draw on a 3x layer for smooth edges
        S = 3
        layer = Image.new('RGBA', (224 * S, 224 * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=(16, 12, 40, 235), outline=(226, 171, 59, 255), width=5 * S)
        bigfont = ImageFont.truetype(FONT, size * S)
        d.text((cx * S, cy * S), label, font=bigfont, fill=(255, 240, 184, 255), anchor='mm')
        layer = layer.resize((224, 224), Image.LANCZOS)
        im.alpha_composite(layer)
        out.append(im.convert('RGB'))
    return out
os.makedirs(OUT, exist_ok=True)
for label in labels:
    fr = badge(label)
    fr[0].save(OUT + label + '.webp', save_all=True, append_images=fr[1:], duration=200, loop=0, quality=50, method=6)
print(len(labels), 'icons', sum(os.path.getsize(OUT + f) for f in os.listdir(OUT)) // 1024, 'KB')
