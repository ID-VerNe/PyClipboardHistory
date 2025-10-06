import threading
import time
import logging
import hashlib

from . import clipboard_adapter
from . import config

class ClipboardMonitor(threading.Thread):
    """A thread that monitors the clipboard for changes at regular intervals."""
    def __init__(self, root_tk_object, on_new_item_callback):
        super().__init__(daemon=True)
        self.root_tk_object = root_tk_object
        self.on_new_item_callback = on_new_item_callback
        self._stop_event = threading.Event()
        self._last_hash = None

    def run(self):
        """The main loop for the monitoring thread."""
        logging.info("Clipboard monitor thread started.")
        while not self._stop_event.is_set():
            try:
                clip_data = clipboard_adapter.read_clipboard()

                if clip_data:
                    data_to_hash = b''
                    item_type = clip_data.get('type')

                    if item_type == 'TEXT':
                        data_to_hash = clip_data.get('data', '').encode('utf-8', errors='ignore')
                    elif item_type == 'IMAGE':
                        # For images, hash their raw byte content
                        data_to_hash = clip_data.get('data').tobytes()
                    elif item_type == 'FILES':
                        data_to_hash = "\n".join(clip_data.get('data', [])).encode('utf-8', errors='ignore')

                    if not data_to_hash:
                        continue

                    current_hash = hashlib.md5(data_to_hash).hexdigest()
                    
                    if current_hash != self._last_hash:
                        self._last_hash = current_hash
                        logging.info(f"New clipboard content detected (type: {item_type}, hash: {current_hash[:8]}...).")
                        # Pass both the data and its hash to the main thread
                        self.root_tk_object.after(0, self.on_new_item_callback, {'data': clip_data, 'hash': current_hash})
                
                self._stop_event.wait(config.POLLING_INTERVAL_SECONDS)

            except Exception as e:
                logging.error(f"Error in clipboard monitor loop: {e}", exc_info=True)
                time.sleep(5)

        logging.info("Clipboard monitor thread has been stopped.")

    def stop(self):
        """Signals the monitoring thread to stop its loop and exit."""
        logging.info("Signaling clipboard monitor thread to stop.")
        self._stop_event.set()