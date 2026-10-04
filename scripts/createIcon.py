from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
target = root / 'assets'
target.mkdir(exist_ok=True)
size = 256
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((10, 10, size - 10, size - 10), radius=60, fill='#365cdd')
font_path = Path('C:/Windows/Fonts/segoeuib.ttf')
font = ImageFont.truetype(str(font_path), 174)
box = draw.textbbox((0, 0), 'T', font=font)
x = (size - (box[2] - box[0])) / 2 - box[0]
y = (size - (box[3] - box[1])) / 2 - box[1] - 4
draw.text((x, y), 'T', font=font, fill='white')
image.save(target / 'icon.png')
image.save(target / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
