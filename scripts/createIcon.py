"""Renders the TalkCRM mark (assets/logo.svg geometry) into icon.png / icon.ico.

The mark: a speech bubble carrying a voice wave — the conversations TalkCRM turns into deals.
Geometry is defined on a 64-unit grid and must stay in sync with assets/logo.svg and src/components/Logo.tsx.
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
target = root / 'assets'
S = 1024
k = S / 64
WAVE = [8, 15, 21, 13, 7]

def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))

def gradient(size, stops):
    """Diagonal (135deg) multi-stop gradient."""
    image = Image.new('RGBA', (size, size))
    pixels = image.load()
    colors = [(pos, hex_rgb(c)) for pos, c in stops]
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            for (p0, c0), (p1, c1) in zip(colors, colors[1:]):
                if t <= p1:
                    f = (t - p0) / (p1 - p0)
                    pixels[x, y] = tuple(round(c0[i] + (c1[i] - c0[i]) * f) for i in range(3)) + (255,)
                    break
    return image

def box(x, y, w, h):
    return (x * k, y * k, (x + w) * k, (y + h) * k)

def render():
    small = 256
    base = gradient(small, [(0, '#5b5cf0'), (0.52, '#7c4dff'), (1, '#15c5e6')]).resize((S, S), Image.BICUBIC)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box(0, 0, 64, 64), radius=15 * k, fill=255)
    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    icon.paste(base, (0, 0), mask)
    draw = ImageDraw.Draw(icon)
    # speech bubble with tail
    draw.rounded_rectangle(box(11, 13, 42, 30), radius=10 * k, fill='white')
    draw.polygon([(17 * k, 38 * k), (15.5 * k, 51 * k), (29 * k, 42 * k)], fill='white')
    # voice wave: five bars centred in the bubble, indigo -> cyan
    colors = ['#5b5cf0', '#6a52f5', '#7c4dff', '#4a8ff0', '#15b8d8']
    for i, h in enumerate(WAVE):
        x = 16 + i * 7
        draw.rounded_rectangle(box(x, 28 - h / 2, 4, h), radius=2 * k, fill=colors[i])
    return icon

icon = render()
icon.resize((512, 512), Image.LANCZOS).save(target / 'icon.png')
icon.save(target / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icon written')
