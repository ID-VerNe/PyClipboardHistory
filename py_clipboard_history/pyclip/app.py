import logging
import json
import threading
import os
import ctypes
from datetime import datetime
from PIL import Image
from pystray import Icon as pystray_icon, Menu as pystray_menu, MenuItem as pystray_menu_item
from pynput import keyboard
from pynput.mouse import Controller as MouseController
from screeninfo import get_monitors

from . import database
from . import config
from . import ai_classifier
from .clipboard_monitor import ClipboardMonitor

class ClipboardApp:
    def __init__(self):
        self.hotkey_listener = None
        self.monitor_thread = None
        self.tray_icon = None
        self.settings = {}
        self.window = None # Reference to pywebview window
        self.is_window_visible = True # Track visibility state
        self.focus_monitor_thread = None  # 新增：失焦监听线程
        self.focus_monitor_running = False  # 新增：控制监听线程运行

        self.load_settings()
        
        self.start_monitoring()
        self.setup_tray_icon()
        self.start_hotkey_listener()

    def set_window(self, window):
        self.window = window

    def load_settings(self):
        DEFAULT_SETTINGS = {
            'minimize_on_close': True,
            'max_history_items': 200,
            'enable_ai_tagging': False,
            'ai_provider': 'OpenAI',
            'ai_model_name': 'gpt-4o',
            'ai_base_url': '',
            'ai_api_key': '',
        }
        try:
            with open(config.SETTINGS_PATH, 'r') as f:
                self.settings = json.load(f)
            for key, value in DEFAULT_SETTINGS.items():
                if key not in self.settings:
                    self.settings[key] = value
                elif isinstance(value, dict):
                    for sub_key, sub_value in value.items():
                        self.settings[key].setdefault(sub_key, sub_value)
        except (FileNotFoundError, json.JSONDecodeError):
            self.settings = DEFAULT_SETTINGS
        
        config.MAX_HISTORY_ITEMS = self.settings.get('max_history_items', 200)
        self.save_settings()

    def save_settings(self):
        with open(config.SETTINGS_PATH, 'w') as f:
            json.dump(self.settings, f, indent=4)

    def start_monitoring(self):
        self.monitor_thread = ClipboardMonitor(self.on_new_clipboard_item)
        self.monitor_thread.start()

    def on_new_clipboard_item(self, item):
        clip_data, content_hash = item['data'], item['hash']
        if not clip_data: return
        item_type = clip_data.get('type')
        new_id = None
        if item_type == 'TEXT':
            content = clip_data['data']
            new_id = database.add_entry(data_type=item_type, content=content, content_hash=content_hash)
            if new_id and self.settings.get('enable_ai_tagging'):
                threading.Thread(target=self._run_ai_classification, args=(new_id, content), daemon=True).start()
        elif item_type == 'IMAGE':
            image = clip_data['data']
            try:
                original_width, original_height = image.width, image.height
                preview = f"[Image] {original_width}x{original_height} PNG"
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S%f')
                full_size_path = config.IMAGE_STORAGE_PATH / f"img_{timestamp}.png"
                thumb_path = config.IMAGE_STORAGE_PATH / "thumbnails" / f"thumb_{timestamp}.png"
                thumb_image = image.copy()
                thumb_image.thumbnail(config.THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
                thumb_image.save(thumb_path, 'PNG')
                image.save(full_size_path, 'PNG')
                new_id = database.add_entry(data_type=item_type, content=str(full_size_path), content_hash=content_hash, preview=preview, thumbnail_path=str(thumb_path))
            except Exception as e:
                logging.error(f"Failed to save image and thumbnail.", exc_info=True)
        elif item_type == 'FILES':
            file_paths = clip_data['data']
            content = "\n".join(file_paths)
            if len(file_paths) == 1: preview = f"[File] {os.path.basename(file_paths[0])}"
            else: preview = f"[Files] {os.path.basename(file_paths[0])} (+{len(file_paths) - 1} more)"
            new_id = database.add_entry(data_type=item_type, content=content, content_hash=content_hash, preview=preview)
        
        if new_id and self.window:
            # Notify frontend to reload history
            try:
                self.window.evaluate_js('if(window.app) window.app.loadHistory();')
            except Exception as e:
                logging.error(f"Failed to update frontend: {e}")

    def _run_ai_classification(self, entry_id: int, text_content: str):
        tags = ai_classifier.classify_and_tag(text_content, self.settings)
        if tags:
            database.update_entry_tags(entry_id, tags)
            if self.window:
                try:
                    self.window.evaluate_js('if(window.app) window.app.loadHistory();')
                except Exception as e:
                    logging.error(f"Failed to update frontend after AI tagging: {e}")

    def start_hotkey_listener(self):
        try:
            show_hotkey_str = "<ctrl>+<alt>+v"
            # show_hotkey_str = "<win>+v"
            key_map = {show_hotkey_str: self.toggle_window}
            self.hotkey_listener = keyboard.GlobalHotKeys(key_map)
            self.hotkey_listener.start()
            logging.info(f"Global hotkey for show/hide started: {show_hotkey_str}")
        except Exception as e:
            logging.error(f"Failed to start global hotkey listener: {e}", exc_info=True)

    def setup_tray_icon(self):
        try:
            icon_image = Image.open(config.ICON_PATH)
        except FileNotFoundError:
            icon_image = Image.new('RGB', (64, 64), 'black')
        menu = pystray_menu(
            pystray_menu_item('Show', self.show_window, default=True),
            pystray_menu_item('Quit', self.quit_application)
        )
        self.tray_icon = pystray_icon('PyClipboardHistory', icon_image, "PyClipboardHistory", menu)
        threading.Thread(target=self.tray_icon.run, daemon=True).start()

    def hide_window(self):
        if self.window:
            self.window.hide()
            self.is_window_visible = False

    def show_window(self):
        if self.window:
            # Get DPI scale
            try:
                hdc = ctypes.windll.user32.GetDC(0)
                dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88) # LOGPIXELSX
                ctypes.windll.user32.ReleaseDC(0, hdc)
                scale = dpi / 96.0
            except:
                scale = 1.0

            # Get mouse position (physical)
            mouse = MouseController()
            mx, my = mouse.position
            
            # Get window size (logical)
            width = self.window.width or 420
            height = self.window.height or 800
            
            # Convert mouse to logical for centering calculation relative to logical window size
            # Target logical X = (Physical Mouse X / Scale) - (Logical Width / 2)
            # This assumes pywebview's move() takes logical coordinates
            
            # However, screeninfo get_monitors() usually returns physical coordinates.
            # So we should do boundary checks in physical space, then convert final to logical.
            
            physical_width = width * scale
            physical_height = height * scale
            
            # Find which monitor the mouse is on (monitors are physical)
            target_monitor = None
            monitors = get_monitors()
            for m in monitors:
                if m.x <= mx < m.x + m.width and m.y <= my < m.y + m.height:
                    target_monitor = m
                    break
            
            if not target_monitor:
                target_monitor = monitors[0] # Fallback
                
            # Calculate target physical position (center horizontally on mouse, top at mouse y)
            # The user complained it was "too far", implying the previous logic placed it far away.
            # Previous logic: new_x = mx - width/2. If mx=1000, width=420. new_x=790.
            # If passed to move(790), and system scales it by 1.5 -> 1185.
            # Mouse at 1000. Window at 1185. Gap of 185.
            
            target_physical_x = mx - (physical_width / 2)
            target_physical_y = my
            
            # Boundary checks in physical space
            # Right edge
            if target_physical_x + physical_width > target_monitor.x + target_monitor.width:
                target_physical_x = target_monitor.x + target_monitor.width - physical_width
            # Left edge
            if target_physical_x < target_monitor.x:
                target_physical_x = target_monitor.x
            # Bottom edge
            if target_physical_y + physical_height > target_monitor.y + target_monitor.height:
                target_physical_y = target_monitor.y + target_monitor.height - physical_height
            # Top edge
            if target_physical_y < target_monitor.y:
                target_physical_y = target_monitor.y
                
            # Convert to logical coordinates for pywebview
            final_logical_x = int(target_physical_x / scale)
            final_logical_y = int(target_physical_y / scale)
                
            self.window.move(final_logical_x, final_logical_y)
            self.window.show()
            self.window.restore() # Ensure it's not minimized
            self.is_window_visible = True
            # 启动失焦监听
            self.start_focus_monitor()

    def get_window_handle(self):
        """获取 pywebview 窗口的 Windows 句柄"""
        try:
            import win32gui
            # 尝试通过窗口标题查找
            def callback(hwnd, hwnds):
                if win32gui.IsWindowVisible(hwnd):
                    title = win32gui.GetWindowText(hwnd)
                    if "PyClipboardHistory" in title:  # pywebview 窗口标题
                        hwnds.append(hwnd)
                return True
            
            hwnds = []
            win32gui.EnumWindows(callback, hwnds)
            return hwnds[0] if hwnds else None
        except:
            return None

    def start_focus_monitor(self):
        """启动失焦监听线程"""
        if not self.focus_monitor_running:
            self.focus_monitor_running = True
            self.focus_monitor_thread = threading.Thread(target=self._focus_monitor_loop, daemon=True)
            self.focus_monitor_thread.start()
            logging.info("Focus monitor started")

    def stop_focus_monitor(self):
        """停止失焦监听线程"""
        self.focus_monitor_running = False
        if self.focus_monitor_thread:
            self.focus_monitor_thread.join(timeout=1.0)
            self.focus_monitor_thread = None
            logging.info("Focus monitor stopped")

    def _focus_monitor_loop(self):
        """失焦监听循环（轮询方式）"""
        import time
        try:
            import win32gui
        except ImportError:
            logging.error("pywin32 not installed, focus monitor disabled")
            return

        last_check_visible = self.is_window_visible
        window_hwnd = None

        while self.focus_monitor_running:
            try:
                if self.is_window_visible and self.window:
                    # 如果窗口可见，检查是否失去焦点
                    if window_hwnd is None:
                        window_hwnd = self.get_window_handle()
                    
                    if window_hwnd:
                        foreground_hwnd = win32gui.GetForegroundWindow()
                        if foreground_hwnd != window_hwnd:
                            # 窗口失去焦点，隐藏窗口
                            logging.info("Window lost focus, hiding...")
                            self.hide_window()
                            self.stop_focus_monitor()  # 隐藏后停止监听
                            window_hwnd = None  # 重置句柄
                else:
                    # 窗口不可见，重置句柄
                    window_hwnd = None
                
                last_check_visible = self.is_window_visible
                time.sleep(0.2)  # 每 200ms 检查一次
            except Exception as e:
                logging.error(f"Focus monitor error: {e}")
                time.sleep(1.0)  # 错误时等待更长时间

    def toggle_window(self):
        if self.window:
            if self.is_window_visible:
                self.hide_window()
            else:
                self.show_window()

    def quit_application(self):
        if self.hotkey_listener and self.hotkey_listener.is_alive():
            self.hotkey_listener.stop()
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.stop()
        self.stop_focus_monitor()  # 停止失焦监听
        if self.tray_icon:
            self.tray_icon.stop()
        if self.window:
            self.window.destroy()