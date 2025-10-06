import win32clipboard
import logging
from PIL import Image
import io

# Add new supported formats
CF_UNICODETEXT = 13
CF_DIB = 8 # Device-Independent Bitmap
CF_HDROP = 15 # File Drop Handle

def _image_to_dib(image: Image.Image):
    """Converts a Pillow Image object to a DIB (bytes)."""
    # When saving as BMP, Pillow writes a file header. We need to strip it.
    # The DIB format is essentially a BMP file without the initial 14-byte BITMAPFILEHEADER.
    with io.BytesIO() as buffer:
        image.save(buffer, "BMP")
        # The DIB starts after the 14-byte file header
        return buffer.getvalue()[14:]

def read_clipboard():
    """
    Reads the clipboard, prioritizing Image > Files > Text.
    """
    try:
        win32clipboard.OpenClipboard()
        
        # Priority 1: Image (DIB)
        if win32clipboard.IsClipboardFormatAvailable(CF_DIB):
            dib_data = win32clipboard.GetClipboardData(CF_DIB)
            try:
                file_header = b'BM' + (len(dib_data) + 14).to_bytes(4, 'little') + b'\x00\x00\x00\x00' + (14 + 40).to_bytes(4, 'little')
                bmp_data = file_header + dib_data
                image = Image.open(io.BytesIO(bmp_data))
                logging.info("Read IMAGE from clipboard.")
                return {'type': 'IMAGE', 'data': image}
            except Exception as e:
                logging.error(f"Failed to parse DIB data from clipboard: {e}")

        # Priority 2: Files (HDROP)
        if win32clipboard.IsClipboardFormatAvailable(CF_HDROP):
            file_paths = win32clipboard.GetClipboardData(CF_HDROP)
            if file_paths:
                logging.info(f"Read FILES from clipboard: {file_paths}")
                return {'type': 'FILES', 'data': list(file_paths)}

        # Priority 3: Text
        if win32clipboard.IsClipboardFormatAvailable(CF_UNICODETEXT):
            text_data = win32clipboard.GetClipboardData(CF_UNICODETEXT)
            if text_data:
                logging.info("Read TEXT from clipboard.")
                return {'type': 'TEXT', 'data': text_data}
        
        logging.info("No supported format found on clipboard.")
        return None

    except Exception as e:
        logging.error(f"Could not open or read clipboard: {e}")
        return None
    finally:
        try:
            win32clipboard.CloseClipboard()
        except Exception as e:
            logging.error(f"Error closing clipboard: {e}")

def write_to_clipboard(clip_data):
    """
    Writes data back to the clipboard. Supports TEXT, IMAGE, and FILES (as text).
    """
    if not clip_data or 'data_type' not in clip_data or 'content' not in clip_data:
        logging.warning(f"write_to_clipboard called with invalid data: {clip_data}")
        return

    try:
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        
        data_type = clip_data['data_type']
        content = clip_data['content']

        if data_type == 'TEXT':
            win32clipboard.SetClipboardData(CF_UNICODETEXT, content)
            logging.info("Wrote TEXT to clipboard.")

        elif data_type == 'IMAGE':
            try:
                with Image.open(content) as image:
                    dib_data = _image_to_dib(image)
                    win32clipboard.SetClipboardData(CF_DIB, dib_data)
                    # Also write the path as text for fallback
                    win32clipboard.SetClipboardData(CF_UNICODETEXT, content)
                    logging.info(f"Wrote IMAGE to clipboard from path: {content}")
            except FileNotFoundError:
                logging.error(f"Image file not found for pasting: {content}")
                win32clipboard.SetClipboardData(CF_UNICODETEXT, f"[Image not found]: {content}")
            except Exception as e:
                logging.error(f"Failed to write image to clipboard: {e}")
        
        elif data_type == 'FILES':
            # For simplicity, write the file paths as a newline-separated text string.
            # Writing actual CF_HDROP is much more complex.
            win32clipboard.SetClipboardData(CF_UNICODETEXT, content)
            logging.info("Wrote FILES to clipboard as plain text.")

    except Exception as e:
        logging.error(f"Could not open or write to clipboard: {e}")