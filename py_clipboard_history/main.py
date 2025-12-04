import logging
import ctypes
import webview
import os
from logging.handlers import RotatingFileHandler
from pyclip import app, config, database
from pyclip.api import Api

# --- High DPI Awareness --- #
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except (AttributeError, OSError):
    logging.info("Not on Windows or DPI awareness not applicable.")

def setup_logging():
    """Configures rotating logging (5MB limit) for the application."""
    config.LOG_FILE_PATH.parent.mkdir(exist_ok=True)
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    if logger.hasHandlers():
        logger.handlers.clear()
    formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - [%(module)s.%(funcName)s] - %(message)s'
    )
    handler = RotatingFileHandler(
        config.LOG_FILE_PATH,
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=1,
        encoding='utf-8'
    )
    file_handler = handler
    file_handler.setFormatter(formatter)
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)

def main():
    """Main entry point for the PyClipboardHistory application."""
    setup_logging()
    logging.info("="*50)
    logging.info("Application Starting...")
    logging.info("="*50)

    try:
        config.STORAGE_DIR.mkdir(exist_ok=True)
        (config.STORAGE_DIR / "images" / "thumbnails").mkdir(parents=True, exist_ok=True)
        logging.info("Storage directories verified.")
    except OSError as e:
        logging.critical(f"Failed to create storage directories: {e}")
        return

    try:
        database.init_db()
    except Exception as e:
        logging.critical(f"FATAL: Failed to initialize database: {e}")
        return

    try:
        # Initialize the controller (backend logic)
        controller = app.ClipboardApp()
        
        # Initialize the API bridge
        api_bridge = Api(controller)

        # Create the window
        # Note: We use a relative path for the URL. pywebview resolves this relative to the entry point.
        # Ensure 'frontend/index.html' exists relative to where you run python.
        html_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'index.html'))
        
        window = webview.create_window(
            'PyClipboardHistory',
            url=f'file://{html_path}',
            js_api=api_bridge,
            width=420,
            height=800,
            resizable=True
        )
        
        # Pass the window reference to the controller so it can update the UI
        controller.set_window(window)

        # Set window icon using Windows API after window is created
        def set_window_icon():
            """Set window icon for title bar and taskbar"""
            try:
                import win32gui
                import win32con
                import win32api
                import ctypes
                from ctypes import wintypes
                
                # Find the window by title
                def find_window(title):
                    hwnd = win32gui.FindWindow(None, title)
                    return hwnd if hwnd != 0 else None
                
                # Wait for window to be created
                import time
                time.sleep(1.0)
                
                hwnd = find_window('PyClipboardHistory')
                if hwnd:
                    logging.info(f"Found window handle: {hwnd}")
                    
                    # Load icon - use .ico format for Windows
                    icon_path = str(config.ICON_PATH).replace('.png', '.ico')
                    logging.info(f"Loading icon from: {icon_path}")
                    
                    if os.path.exists(icon_path):
                        try:
                            # Load small icon (16x16) for title bar
                            hicon_small = win32gui.LoadImage(
                                0, 
                                icon_path,
                                win32con.IMAGE_ICON,
                                16, 16,
                                win32con.LR_LOADFROMFILE
                            )
                            
                            # Load large icon (32x32) for taskbar and Alt+Tab
                            hicon_large = win32gui.LoadImage(
                                0, 
                                icon_path,
                                win32con.IMAGE_ICON,
                                32, 32,
                                win32con.LR_LOADFROMFILE
                            )
                            
                            logging.info(f"Icon handles: small={hicon_small}, large={hicon_large}")
                            
                            if hicon_small:
                                win32gui.SendMessage(hwnd, win32con.WM_SETICON, win32con.ICON_SMALL, hicon_small)
                                logging.info("Small icon set")
                            
                            if hicon_large:
                                win32gui.SendMessage(hwnd, win32con.WM_SETICON, win32con.ICON_BIG, hicon_large)
                                logging.info("Large icon set")
                            
                            if hicon_small or hicon_large:
                                logging.info("Window icon set successfully")
                            else:
                                logging.warning("Failed to load icon handles")
                                
                        except Exception as e:
                            logging.warning(f"Failed to set icon: {e}", exc_info=True)
                    else:
                        logging.warning(f"Icon file not found: {icon_path}")
                else:
                    logging.warning("Could not find window handle")
            except Exception as e:
                logging.warning(f"Could not set window icon: {e}", exc_info=True)
        
        # Run icon setting in a thread to not block
        import threading
        threading.Thread(target=set_window_icon, daemon=True).start()

        # Start the webview loop
        webview.start(debug=False) # debug=True enables DevTools (F12)

    except Exception as e:
        logging.critical(f"An unexpected error occurred in the main application: {e}", exc_info=True)
    
    logging.info("="*50)
    logging.info("Application Closed.")
    logging.info("="*50)

if __name__ == "__main__":
    main()
