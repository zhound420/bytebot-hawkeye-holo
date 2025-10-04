#!/usr/bin/env python3
"""Create a simple test UI screenshot"""

from PIL import Image, ImageDraw, ImageFont
import sys

# Create a test screenshot with UI-like elements
img = Image.new('RGB', (800, 600), color='white')
draw = ImageDraw.Draw(img)

# Try to use a default font, fallback to basic if not available
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
    font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
except:
    font = ImageFont.load_default()
    font_small = font

# Draw header
draw.rectangle([0, 0, 800, 60], fill='#4A90E2')
draw.text((20, 20), "My Application", fill='white', font=font)

# Draw buttons
buttons = [
    (50, 100, 150, 140, "Login", '#4CAF50'),
    (180, 100, 280, 140, "Sign Up", '#2196F3'),
    (310, 100, 410, 140, "Help", '#FF9800'),
]

for x1, y1, x2, y2, text, color in buttons:
    draw.rectangle([x1, y1, x2, y2], fill=color, outline='#333', width=2)
    # Center text
    bbox = draw.textbbox((0, 0), text, font=font_small)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    text_x = x1 + (x2 - x1 - text_width) // 2
    text_y = y1 + (y2 - y1 - text_height) // 2
    draw.text((text_x, text_y), text, fill='white', font=font_small)

# Draw input fields
draw.rectangle([50, 180, 400, 220], fill='white', outline='#ccc', width=2)
draw.text((60, 190), "Username", fill='#999', font=font_small)

draw.rectangle([50, 240, 400, 280], fill='white', outline='#ccc', width=2)
draw.text((60, 250), "Password", fill='#999', font=font_small)

# Draw search icon (circle with line)
draw.ellipse([450, 100, 490, 140], outline='#666', width=3)
draw.line([482, 132, 500, 150], fill='#666', width=3)

# Draw settings icon (gear-like)
cx, cy = 550, 120
for angle in range(0, 360, 60):
    import math
    x = cx + int(15 * math.cos(math.radians(angle)))
    y = cy + int(15 * math.sin(math.radians(angle)))
    draw.ellipse([x-3, y-3, x+3, y+3], fill='#666')
draw.ellipse([cx-8, cy-8, cx+8, cy+8], fill='white', outline='#666', width=2)

# Draw menu icon (hamburger)
for i in range(3):
    y = 110 + i * 10
    draw.rectangle([650, y, 700, y+4], fill='#666')

# Save
img.save('/tmp/test_ui.png')
print("Test screenshot created: /tmp/test_ui.png")
