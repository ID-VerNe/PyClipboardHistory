
from PIL import Image, ImageDraw
import os

# Define the assets directory relative to the script location
assets_dir = 'py_clipboard_history/assets'
os.makedirs(assets_dir, exist_ok=True)

# --- Common settings ---
size = (48, 48)
transparent = (255, 255, 255, 0)
icon_bg_color = (250, 250, 250)
outline_color = (120, 120, 120)

# --- Generate text_icon.png ---
try:
    text_icon_path = os.path.join(assets_dir, 'text_icon.png')
    text_icon = Image.new('RGBA', size, transparent)
    draw = ImageDraw.Draw(text_icon)
    draw.rounded_rectangle((9, 5, 39, 43), radius=3, fill=icon_bg_color, outline=outline_color, width=2)
    for y in range(15, 38, 6):
        draw.line((16, y, 32, y), fill=outline_color, width=2)
    text_icon.save(text_icon_path)
    print(f"Generated {text_icon_path}")
except Exception as e:
    print(f"Error generating text_icon.png: {e}")

# --- Generate file_icon.png ---
try:
    file_icon_path = os.path.join(assets_dir, 'file_icon.png')
    file_icon = Image.new('RGBA', size, transparent)
    draw = ImageDraw.Draw(file_icon)
    folder_color = (255, 220, 130)
    draw.rounded_rectangle((6, 12, 42, 42), radius=4, fill=folder_color, outline=outline_color, width=2)
    draw.polygon([(10, 12), (10, 8), (24, 8), (26, 12)], fill=folder_color, outline=outline_color, width=2)
    draw.rounded_rectangle((6, 18, 42, 42), radius=4, fill=folder_color, outline=outline_color, width=2)
    file_icon.save(file_icon_path)
    print(f"Generated {file_icon_path}")
except Exception as e:
    print(f"Error generating file_icon.png: {e}")
