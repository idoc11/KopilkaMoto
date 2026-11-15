"""Вырезает мотоцикл со студийного белого фона: прозрачный фон, чистая мягкая тень, без белой каймы.

Запуск: python3 scripts/cutout.py <исходник> images/dream-bike.webp
Нужны Pillow и numpy. Рассчитано на фото сбоку на белом фоне с тенью на полу.
"""

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = rgb.shape
mn, mx = rgb.min(2), rgb.max(2)
lowsat = (mx - mn) < 18

# 1. Фон: почти белые серые пиксели, связанные с краем, и крупные замкнутые белые области (между спицами).
cand = lowsat & (mn >= 236)
pad = np.pad(cand, 1, constant_values=True)
lab = Image.fromarray((pad * 255).astype(np.uint8))
ImageDraw.floodfill(lab, (0, 0), 128)
bg = (np.asarray(lab) == 128)[1:-1, 1:-1]
rest = cand & ~bg
seen = np.zeros_like(rest)
for y0, x0 in np.argwhere(rest):
    if seen[y0, x0]:
        continue
    stack, comp = [(y0, x0)], []
    seen[y0, x0] = True
    while stack:
        y, x = stack.pop()
        comp.append((y, x))
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < H and 0 <= nx < W and rest[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    if len(comp) > 120:  # мелкие блики на корпусе оставляем
        ys, xs = zip(*comp)
        bg[list(ys), list(xs)] = True

alpha = np.where(bg, 0.0, 1.0)

# 2. Кайма: светлые пиксели у границы фона — частично прозрачные.
ring = np.zeros_like(bg)
for dy in range(-2, 3):
    for dx in range(-2, 3):
        ring |= np.roll(np.roll(bg, dy, 0), dx, 1)
ring &= ~bg & lowsat & (mn >= 150)
alpha = np.where(ring, np.clip((255 - mn) / (255 - 150), 0.05, 1), alpha)

# 3. Низ: ниже днища между колёсами — только шины и пол. Пол (светлое) убираем, шины оставляем,
#    студийную полосу тени под шинами убираем целиком — вместо неё рисуем свою.
obj = (~bg) & ((mn < 200) | ~lowsat)
mid = slice(int(W * 0.38), int(W * 0.68))
mid_obj = obj[:, mid].sum(1)
zone_start = next(y for y in range(int(H * 0.6), H) if mid_obj[y] == 0)
shadow_start = next((y for y in range(zone_start, H) if mid_obj[y] > 0), H)
floor = np.zeros_like(bg)
floor[zone_start:shadow_start] = True
tyre_alpha = np.clip((175 - mn) / 55, 0, 1)
# Шина сужается книзу: в каждой строке оставляем только участки, продолжающие шину из строки выше.
# Хвосты студийной тени лежат в стороне от шины и отбрасываются.
keep = np.zeros_like(bg)
keep[zone_start - 1] = tyre_alpha[zone_start - 1] > 0.3
for y in range(zone_start, shadow_start):
    row = tyre_alpha[y] > 0.05
    xs = np.flatnonzero(np.diff(np.concatenate(([0], row.astype(np.int8), [0]))))
    for x0, x1 in zip(xs[::2], xs[1::2]):
        if keep[y - 1, max(0, x0 - 1) : x1 + 1].any():
            keep[y, x0:x1] = True
alpha = np.where(floor & lowsat, np.where(keep, np.minimum(alpha, tyre_alpha), 0), alpha)
alpha[shadow_start - 1 :] = 0

# Края шин: убираем белую подмесь в полупрозрачных пикселях.
out = rgb.copy()
soft = (ring | floor) & (alpha > 0) & (alpha < 1)
a3 = np.maximum(alpha, 1e-3)[..., None]
out = np.where(soft[..., None], np.clip((rgb - 255 * (1 - a3)) / a3, 0, 255), out)

# 4. Своя тень: овалы под пятнами контакта шин и лёгкая общая тень между ними.
probe = shadow_start - 4
dark = np.where(mn[probe] < 110)[0]
cx = W // 2
left, right = dark[dark < cx], dark[dark >= cx]
shadow = Image.new('L', (W, H), 0)
draw = ImageDraw.Draw(shadow)
ground = shadow_start - 2
centers = []
for side in (left, right):
    if len(side):
        c, half = (side.min() + side.max()) / 2, max(14, (side.max() - side.min()) / 2)
        centers.append(c)
        draw.ellipse((c - half * 2.2, ground - 6, c + half * 2.2, ground + 6), fill=150)
if len(centers) == 2:
    draw.ellipse((centers[0] - 40, ground - 4, centers[1] + 40, ground + 5), fill=70)
shadow = np.asarray(shadow.filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255

a_out = alpha + shadow * (1 - alpha)
rgb_out = out * (alpha / np.maximum(a_out, 1e-3))[..., None]  # тень чёрная

rgba = np.dstack([rgb_out, a_out * 255]).clip(0, 255).astype(np.uint8)
img = Image.fromarray(rgba, 'RGBA')
box = Image.fromarray((a_out > 0.03).astype(np.uint8) * 255).getbbox()
img = img.crop((max(0, box[0] - 4), max(0, box[1] - 4), min(W, box[2] + 4), min(H, box[3] + 4)))
img = img.resize((800, round(img.height * 800 / img.width)), Image.LANCZOS)
img.save(dst, 'WEBP', quality=84, method=6)
print('saved', dst, img.size, 'zone', zone_start, shadow_start)
