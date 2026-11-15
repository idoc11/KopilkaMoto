"""Вырезает мотоцикл с белого фона: прозрачный фон, мягкая тень, без белой каймы.
Запуск: python3 scripts/cutout.py <исходник> images/dream-bike.webp
"""
import sys
import numpy as np
from PIL import Image, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = rgb.shape
mn, mx = rgb.min(2), rgb.max(2)
lowsat = (mx - mn) < 18

# 1. Кандидаты в фон: почти белые серые пиксели. Фон — области, касающиеся края, или крупнее 120 px.
cand = lowsat & (mn >= 236)
# Внешний фон — одна заливка от рамки (добавляем белую рамку в 1 px, чтобы заливка обошла весь край).
pad = np.pad(cand, 1, constant_values=True)
lab = Image.fromarray((pad * 255).astype(np.uint8))
ImageDraw.floodfill(lab, (0, 0), 128)
bg = (np.asarray(lab) == 128)[1:-1, 1:-1]
# Замкнутые белые области (между спицами и т.п.): BFS только по оставшимся кандидатам.
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

# 2. Кайма: светлые пиксели у границы фона — частично прозрачные, белый из цвета убираем.
ring = np.zeros_like(bg)
for dy in range(-2, 3):
    for dx in range(-2, 3):
        ring |= np.roll(np.roll(bg, dy, 0), dx, 1)
ring &= ~bg & lowsat & (mn >= 150)
a_edge = np.clip((255 - mn) / (255 - 150), 0.05, 1)
alpha = np.where(ring, a_edge, alpha)

# 3. Тень под колёсами: серое ниже линии колёс — полупрозрачный чёрный.
ys = np.argwhere(~bg)[:, 0]
bottom = ys.max()
shadow = np.zeros_like(bg)
shadow[bottom - 26 :, :] = True
shadow &= ~bg & lowsat & (mn >= 110)
alpha = np.where(shadow, np.clip((255 - mn) / 255 * 1.3, 0, 0.55), alpha)

out = rgb.copy()
a3 = np.maximum(alpha, 1e-3)[..., None]
unmixed = np.clip((rgb - 255 * (1 - a3)) / a3, 0, 255)
out = np.where((ring | shadow)[..., None], unmixed, out)
out = np.where(shadow[..., None], 0, out)

rgba = np.dstack([out, alpha * 255]).astype(np.uint8)
img = Image.fromarray(rgba, 'RGBA')
box = Image.fromarray((alpha > 0.03).astype(np.uint8) * 255).getbbox()
img = img.crop((max(0, box[0] - 4), max(0, box[1] - 4), min(W, box[2] + 4), min(H, box[3] + 4)))
img = img.resize((800, round(img.height * 800 / img.width)), Image.LANCZOS)
img.save(dst, 'WEBP', quality=84, method=6)
print('saved', dst, img.size)
