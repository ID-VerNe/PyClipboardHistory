
import logging
import ctypes
from logging.handlers import RotatingFileHandler
from pyclip import app, config, database

# --- High DPI Awareness --- #
# This must be done before any tkinter window is created.
try:
    # This call makes the application DPI-aware on Windows.
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except (AttributeError, OSError):
    # This will fail on non-Windows systems, which is expected.
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
    file_handler = RotatingFileHandler(
        config.LOG_FILE_PATH,
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=1,
        encoding='utf-8'
    )
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
        main_app = app.ClipboardApp()
        main_app.mainloop()
    except Exception as e:
        logging.critical(f"An unexpected error occurred in the main application: {e}", exc_info=True)
    
    logging.info("="*50)
    logging.info("Application Closed.")
    logging.info("="*50)

if __name__ == "__main__":
    main()
