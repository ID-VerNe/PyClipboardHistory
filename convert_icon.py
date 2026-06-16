from PIL import Image
import os

# 读取 PNG 图标
png_path = r"c:\Users\VerNe\Downloads\Documents\PyClipboardHistory\py_clipboard_history\assets\icon.png"
ico_path = r"c:\Users\VerNe\Downloads\Documents\PyClipboardHistory\py_clipboard_history\assets\icon.ico"

# 打开 PNG 图像
img = Image.open(png_path)

# 转换为 ICO 格式（支持多种尺寸）
img.save(ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

print(f"已将 {png_path} 转换为 {ico_path}")
