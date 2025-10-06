
import sys
import os
from pathlib import Path

# This logic determines if the app is running in a bundled PyInstaller exe
def get_base_path():
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return Path(sys.executable).parent
    else:
        return Path(__file__).parent.parent.parent

# --- Core Paths ---
BASE_DIR = get_base_path()
STORAGE_DIR = BASE_DIR / "storage"
DB_PATH = STORAGE_DIR / "clipboard.db"
SETTINGS_PATH = STORAGE_DIR / "settings.json"
LOG_FILE_PATH = STORAGE_DIR / "app.log"

# --- Asset Paths ---
def get_asset_path():
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / "assets"
    else:
        return Path(__file__).parent.parent / "assets"

ASSETS_DIR = get_asset_path()
ICON_PATH = ASSETS_DIR / "icon.png"
TEXT_ICON_PATH = ASSETS_DIR / "text_icon.png"
FILE_ICON_PATH = ASSETS_DIR / "file_icon.png"

# --- Image Storage ---
IMAGE_STORAGE_PATH = STORAGE_DIR / "images"

# --- Constants ---
MAX_HISTORY_ITEMS = 200 # Default, will be overridden by settings
THUMBNAIL_SIZE = (48, 48)
PREVIEW_MAX_LEN = 120
POLLING_INTERVAL_SECONDS = 1
