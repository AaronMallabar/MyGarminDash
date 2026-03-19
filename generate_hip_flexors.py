from PIL import Image, ImageDraw

width, height = 860, 753
img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

highlight_color = (0, 189, 248, 255) 

# FRONT VIEW (Left side of the 860x753 canvas)
# Central axis is roughly x=215
# Hip area is roughly around y=360 to y=390
# Pushing them outward to the hips.

# Viewer's right (Figure's left hip)
draw.polygon([
    (235, 375), (265, 370), (265, 382), (235, 387)
], fill=highlight_color)

# Viewer's left (Figure's right hip)
draw.polygon([
    (195, 375), (165, 370), (165, 382), (195, 387)
], fill=highlight_color)

img.save(r'c:\Users\Aaron Mallabar\Documents\Git_Personal\MyGarminDash\static\images\muscle_map\highlights\hipflexors.png')
print("Wider hip flexor generated.")
