from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "img" / "logo.png"
OUT = ROOT / "img" / "app-icon.png"
ICON_SRC = ROOT / "src-tauri" / "icons" / "source-verba-icon.png"

CANVAS = 1024
CIRCLE_MARGIN = 56
MARK_TARGET_W = 570

src = Image.open(SRC).convert("RGBA")
px = src.load()

# Turn the white/off-white square logo background transparent, preserving antialiasing.
alpha = Image.new("L", src.size, 0)
a = alpha.load()
for y in range(src.height):
    for x in range(src.width):
        r, g, b, _ = px[x, y]
        # Distance from white: colored mark becomes opaque, white background transparent.
        dist = max(255 - r, 255 - g, 255 - b)
        if dist <= 10:
            val = 0
        elif dist >= 45:
            val = 255
        else:
            val = int((dist - 10) / 35 * 255)
        a[x, y] = val
src.putalpha(alpha)

bbox = src.getbbox()
if not bbox:
    raise SystemExit("No visible logo pixels found")
mark = src.crop(bbox)
ratio = MARK_TARGET_W / mark.width
mark = mark.resize((MARK_TARGET_W, round(mark.height * ratio)), Image.Resampling.LANCZOS)

canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

# Modern app-icon badge: flat white circular base, no shadow.
box = [CIRCLE_MARGIN, CIRCLE_MARGIN, CANVAS - CIRCLE_MARGIN, CANVAS - CIRCLE_MARGIN]
badge = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
d = ImageDraw.Draw(badge)
d.ellipse(box, fill=(255, 255, 255, 255))
# very light blue-green rim to keep the white icon visible on white backgrounds
d.ellipse(box, outline=(210, 235, 232, 255), width=8)
canvas.alpha_composite(badge)

x = (CANVAS - mark.width) // 2
# The mark's horizontal arms make it feel bottom-heavy when geometrically centered.
# Nudge it upward so the final app icon is optically centered in Finder/Dock.
y = (CANVAS - mark.height) // 2 - 10
canvas.alpha_composite(mark, (x, y))

OUT.parent.mkdir(parents=True, exist_ok=True)
ICON_SRC.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUT)
canvas.save(ICON_SRC)
print(OUT)
print(ICON_SRC)
