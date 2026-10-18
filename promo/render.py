import sys, os
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
from PIL import Image, ImageDraw, ImageFont, features
assert features.check("raqm")
W, H = 1080, 1920
B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
CY, MG, WH, MU = (34, 211, 238), (244, 114, 182), (255, 255, 255), (170, 190, 215)

def font(path, size):
    return ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM)

def bg():
    img = Image.new("RGB", (W, H))
    px = img.load()
    top, bot = (5, 11, 30), (10, 48, 84)
    for y in range(H):
        t = y / (H - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse((-300, -200, 500, 600), fill=(34, 211, 238, 38))
    d.ellipse((600, 1300, 1500, 2200), fill=(244, 114, 182, 34))
    return img

def text(d, xy, s, path, size, fill, maxw=None, ar=True):
    f = font(path, size)
    while maxw and d.textlength(s, font=f, direction="rtl" if ar else None) > maxw and size > 24:
        size -= 2
        f = font(path, size)
    kw = dict(direction="rtl", language="ar") if ar else {}
    d.text(xy, s, font=f, fill=fill, anchor="ma", **kw)

def card(d, y, label, accent, h=150):
    d.rounded_rectangle((90, y, W - 90, y + h), radius=36, fill=(255, 255, 255, 22), outline=accent + (160,), width=3)
    d.ellipse((W - 90 - 36 - 28, y + h // 2 - 14, W - 90 - 36, y + h // 2 + 14), fill=accent)
    text(d, ((W - 90 - 36 - 50) // 2 + 60, y + h // 2 - 34), label, B, 54, WH, maxw=W - 90 - 36 - 50 - 150)

def footer(d):
    text(d, (W // 2, 1560), "ttbik.vercel.app", B, 60, CY, ar=False)

slides = []
# 1 — brand
img = bg(); d = ImageDraw.Draw(img, "RGBA")
text(d, (W // 2, 540), "شام AI", B, 270, WH)
text(d, (W // 2, 880), "SHAM AI", B, 84, CY, ar=False)
text(d, (W // 2, 1040), "أدوات مجانية • بوتات تليجرام", B, 56, WH, maxw=900)
text(d, (W // 2, 1130), "وخدمات رقمية متكاملة", B, 56, WH, maxw=900)
d.rounded_rectangle((300, 1290, 780, 1298), radius=4, fill=MG)
footer(d); slides.append(img)
# 2 — free tools
img = bg(); d = ImageDraw.Draw(img, "RGBA")
text(d, (W // 2, 260), "أدوات مجانية", B, 130, WH)
text(d, (W // 2, 440), "تعمل مباشرة من المتصفح", R, 50, MU)
items = ["بطاقة أعمال رقمية بعدّاد زيارات", "مصغّر روابط بعدّاد نقرات", "ضغط وتحويل الصور", "مولد رابط الطلب عبر واتساب", "مولد أسماء المشاريع"]
for i, s in enumerate(items):
    card(d, 560 + i * 170, s, CY if i % 2 == 0 else MG)
footer(d); slides.append(img)
# 3 — bots
img = bg(); d = ImageDraw.Draw(img, "RGBA")
text(d, (W // 2, 230), "بوتات تليجرام", B, 120, WH)
text(d, (W // 2, 400), "مفتوحة الآن للجميع", R, 50, MU)
bots = ["بوت الإعلان والربح", "بوت تحميل الوسائط", "بوت فرص العمل والمتجر", "بوت التعارف والزواج", "البوت الطبي", "بوت الاعترافات المجهولة"]
for i, s in enumerate(bots):
    card(d, 500 + i * 160, s, CY if i % 2 == 0 else MG, h=135)
footer(d); slides.append(img)
# 4 — CTA
img = bg(); d = ImageDraw.Draw(img, "RGBA")
text(d, (W // 2, 560), "جرّبها الآن", B, 190, WH)
text(d, (W // 2, 860), "كل الروابط في الوصف", B, 66, MU, maxw=900)
d.rounded_rectangle((140, 1020, W - 140, 1230), radius=60, fill=CY)
text(d, (W // 2, 1070), "ttbik.vercel.app", B, 84, (5, 11, 30), ar=False)
text(d, (W // 2, 1320), "شام AI", B, 90, MG)
slides.append(img)

for i, im in enumerate(slides, 1):
    im.save(f"{OUT}/s{i}.png")
print(len(slides), "slides")
