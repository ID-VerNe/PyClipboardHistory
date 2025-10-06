import tkinter as tk
from tkinter import ttk
import logging
import json
import threading
import os
from datetime import datetime
from PIL import Image, ImageTk
from pystray import Icon as pystray_icon, Menu as pystray_menu, MenuItem as pystray_menu_item
from pynput import keyboard
from screeninfo import get_monitors

from . import database
from . import clipboard_adapter
from . import config
from . import ai_classifier
from .clipboard_monitor import ClipboardMonitor
from .settings_window import SettingsWindow

class ToolTip:
    """Create a tooltip for a given widget."""
    def __init__(self, widget):
        self.widget = widget
        self.tip_window = None
        self.id = None
        self.x = self.y = 0
        self._after_id = None
        self._image_cache = None # To hold reference to the image

    def showtip(self, content):
        "Display content (text or image) in a tooltip window."
        if self.tip_window or not content:
            return

        self.tip_window = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.attributes("-topmost", True)

        # Check if content is a valid image path
        is_image = os.path.exists(content) and content.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp'))

        if is_image:
            try:
                img = Image.open(content)
                img.thumbnail((400, 400), Image.Resampling.LANCZOS)
                self._image_cache = ImageTk.PhotoImage(img)
                label = tk.Label(tw, image=self._image_cache, relief=tk.SOLID, borderwidth=1)
                label.pack()
            except Exception as e:
                logging.error(f"Tooltip failed to load image: {e}")
                # Fallback to showing path if image fails to load
                label = tk.Label(tw, text=content, justify=tk.LEFT, background="#FFFFE0", relief=tk.SOLID, borderwidth=1, wraplength=400, font=("Segoe UI", 9, "normal"))
                label.pack(ipadx=4, ipady=2)
        else:
            MAX_TOOLTIP_CHARS = 500
            display_text = content
            if len(content) > MAX_TOOLTIP_CHARS:
                display_text = content[:MAX_TOOLTIP_CHARS] + "\n\n[... Content truncated ...]"
            
            label = tk.Label(tw, text=display_text, justify=tk.LEFT, background="#FFFFE0", relief=tk.SOLID, borderwidth=1, wraplength=400, font=("Segoe UI", 9, "normal"))
            label.pack(ipadx=4, ipady=2)

        tw.update_idletasks() # Update to get correct window size

        # --- Intelligent Positioning Logic ---
        mouse_x, mouse_y = self.widget.winfo_pointerxy()
        tip_width = tw.winfo_width()
        tip_height = tw.winfo_height()
        
        current_monitor = None
        for m in get_monitors():
            if m.x <= mouse_x < m.x + m.width and m.y <= mouse_y < m.y + m.height:
                current_monitor = m
                break
        if not current_monitor:
            current_monitor = get_monitors()[0]

        safe_x_start = current_monitor.x + 10
        safe_y_start = current_monitor.y + 10
        safe_x_end = current_monitor.x + current_monitor.width - 10
        safe_y_end = current_monitor.y + current_monitor.height - 10

        ideal_x = mouse_x + 20
        ideal_y = mouse_y + 10

        final_x, final_y = ideal_x, ideal_y

        if final_x + tip_width > safe_x_end:
            final_x = mouse_x - tip_width - 20
        if final_x < safe_x_start:
            final_x = safe_x_start

        if final_y + tip_height > safe_y_end:
            final_y = mouse_y - tip_height - 10
        if final_y < safe_y_start:
            final_y = safe_y_start

        tw.wm_geometry(f"+{final_x}+{final_y}")

    def hidetip(self):
        if self._after_id:
            self.widget.after_cancel(self._after_id)
            self._after_id = None
        if self.tip_window:
            self.tip_window.destroy()
            self.tip_window = None
        self._image_cache = None # Clear image reference

    def schedule_show(self, text):
        self.hidetip()
        self._after_id = self.widget.after(500, lambda: self.showtip(text))

class ClipboardApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.is_mouse_over = False
        self.hotkey_listener = None
        self.monitor_thread = None
        self.tray_icon = None
        self.settings = {}
        self._thumbnail_cache = {}
        self._icon_cache = {}
        self.selected_item_id = None
        self.row_widgets = {}
        self._search_after_id = None
        self._tooltip = ToolTip(self) # Create a single tooltip instance

        self.load_settings()
        self.title("PyClipboardHistory")
        try:
            icon_photo = ImageTk.PhotoImage(Image.open(config.ICON_PATH))
            self.iconphoto(True, icon_photo)
        except Exception as e:
            logging.warning(f"Failed to load application icon: {e}")
        self.geometry("600x700")
        self.configure(bg="#f0f0f0")

        self.style = ttk.Style(self)
        try:
            self.style.theme_use('vista')
        except tk.TclError:
            self.style.theme_use('default')

        self.filter_var = tk.StringVar(value="All Types")
        self.search_var = tk.StringVar()

        self.setup_widgets()
        self.bind_events()
        self.load_default_icons()
        self.refresh_ui_list()
        self.start_monitoring()
        self.setup_tray_icon()
        self.start_hotkey_listener()
        self.after(250, self.check_focus_loop)

        self.protocol("WM_DELETE_WINDOW", self.on_close_button_press)

    def load_settings(self):
        DEFAULT_SETTINGS = {
            'minimize_on_close': True,
            'max_history_items': 200,
            'enable_ai_tagging': False,
            'ai_provider': 'OpenAI',
            'ai_model_name': 'gpt-4o',
            'ai_base_url': '',
            'ai_api_key': '',
            'colors': {
                'normal_bg': '#FFFFFF',
                'fav_bg': '#FFF9E6',
                'selected_bg': '#CCE8FF',
                'highlight_bg': 'lightblue',
            }
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
        
        self.colors = self.settings.get('colors', DEFAULT_SETTINGS['colors'])
        config.MAX_HISTORY_ITEMS = self.settings.get('max_history_items', 200)
        self.save_settings()

    def setup_widgets(self):
        main_frame = tk.Frame(self, bg=self.colors.get('border', '#f0f0f0'))
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(10,0))
        main_frame.rowconfigure(1, weight=1)
        main_frame.columnconfigure(0, weight=1)

        control_frame = tk.Frame(main_frame, bg=self.colors.get('border', '#f0f0f0'))
        control_frame.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 10))
        control_frame.columnconfigure(1, weight=1)

        filter_options = ["All Types", "Favorites ★", "TEXT", "IMAGE", "FILES"]
        self.filter_combo = ttk.Combobox(control_frame, textvariable=self.filter_var, values=filter_options, state="readonly", width=15)
        self.filter_combo.grid(row=0, column=0, sticky="w")

        self.search_var = tk.StringVar()
        search_box = ttk.Entry(control_frame, textvariable=self.search_var, width=40)
        search_box.grid(row=0, column=1, sticky="ew", padx=5)
        search_box.bind("<KeyRelease>", self.on_search_changed)

        clear_button = ttk.Button(control_frame, text="X", width=2, command=self.clear_search)
        clear_button.grid(row=0, column=2, sticky="e")

        settings_button = ttk.Button(control_frame, text="Settings", command=self.open_settings_window)
        settings_button.grid(row=0, column=3, sticky="e", padx=(0, 5))
        
        self.canvas = tk.Canvas(main_frame, highlightthickness=0, bg=self.colors.get('border', '#f0f0f0'))
        self.scrollbar = ttk.Scrollbar(main_frame, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.canvas.grid(row=1, column=0, sticky="nsew")
        self.scrollbar.grid(row=1, column=1, sticky="ns")
        self.list_frame = tk.Frame(self.canvas, bg=self.colors.get('border', '#f0f0f0'))
        self.canvas.create_window((0, 0), window=self.list_frame, anchor="nw")

    def clear_search(self):
        self.search_var.set("")
        self.refresh_ui_list()

    def bind_events(self):
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)
        self.list_frame.bind("<Configure>", self._on_frame_configure)
        self.filter_combo.bind("<<ComboboxSelected>>", self.on_filter_changed)
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.bind("<Control-s>", self.toggle_selected_favorite)
        self.bind("<Enter>", lambda e: setattr(self, 'is_mouse_over', True))
        self.bind("<Leave>", lambda e: setattr(self, 'is_mouse_over', False))

    def check_focus_loop(self):
        if not self.is_mouse_over and self.focus_get() is None:
            self.hide_window()
        self.after(250, self.check_focus_loop)

    def on_search_changed(self, event=None):
        if self._search_after_id:
            self.after_cancel(self._search_after_id)
        self._search_after_id = self.after(300, self.refresh_ui_list)

    def refresh_ui_list(self):
        for widget in self.list_frame.winfo_children():
            widget.destroy()
        self._thumbnail_cache.clear()
        self.row_widgets.clear()
        filter_type = self.filter_var.get()
        search_query = self.search_var.get()
        history_entries = database.get_history(filter_type=filter_type, search_query=search_query)
        
        for entry in history_entries:
            is_fav = entry['is_favorite']
            bg_color = self.colors['fav_bg'] if is_fav else self.colors['normal_bg']
            
            row_frame = tk.Frame(self.list_frame, bg=bg_color)
            row_frame.pack(fill="x", expand=True, pady=(0, 2))
            self.row_widgets[entry['id']] = {"frame": row_frame, "is_favorite": is_fav}
            row_frame.columnconfigure(1, weight=1)

            img_label = tk.Label(row_frame, bg=bg_color)
            img_label.grid(row=0, column=0, padx=5, pady=5, sticky="ns")

            photo = self._icon_cache.get(entry['data_type'])
            if entry['data_type'] == 'IMAGE' and entry['thumbnail_path']:
                try:
                    photo = ImageTk.PhotoImage(Image.open(entry['thumbnail_path']))
                    self._thumbnail_cache[entry['id']] = photo
                except FileNotFoundError:
                    photo = self._icon_cache.get('FILES') 
            img_label.config(image=photo)

            fav_char = "⭐ " if is_fav else ""
            text_content = f"{fav_char}{entry['preview']}\n"
            if entry['tags']:
                text_content += f"{entry['tags']}"

            text_widget = tk.Text(row_frame, wrap=tk.WORD, bg=bg_color, borderwidth=0, highlightthickness=0, height=3, font=("Segoe UI", 9))
            text_widget.insert("1.0", text_content)
            text_widget.grid(row=0, column=1, padx=10, pady=5, sticky="nsew")

            if search_query:
                highlight_color = self.colors.get('highlight_bg', 'lightblue')
                text_widget.tag_configure("highlight", background=highlight_color, foreground="black")
                start_pos = "1.0"
                while True:
                    start_pos = text_widget.search(search_query, start_pos, stopindex=tk.END, nocase=True)
                    if not start_pos: break
                    end_pos = f"{start_pos}+{len(search_query)}c"
                    text_widget.tag_add("highlight", start_pos, end_pos)
                    start_pos = end_pos

            text_widget.config(state=tk.DISABLED)

            # Bind tooltip events to the entire row
            def on_enter(event, content=entry['content']):
                self._tooltip.schedule_show(content)
            
            def on_leave(event):
                self._tooltip.hidetip()

            for widget in [row_frame, img_label, text_widget]:
                widget.bind("<Enter>", on_enter)
                widget.bind("<Leave>", on_leave)
                widget.bind("<Double-1>", lambda e, eid=entry['id']: self.on_paste_selection(eid))
                widget.bind("<Button-1>", lambda e, eid=entry['id']: self.on_item_select(eid))

    def on_item_select(self, entry_id):
        self.selected_item_id = entry_id
        for eid, widgets in self.row_widgets.items():
            is_fav = widgets['is_favorite']
            bg_color = self.colors['normal_bg']
            if eid == entry_id:
                bg_color = self.colors['selected_bg']
            elif is_fav:
                bg_color = self.colors['fav_bg']
            widgets["frame"].config(bg=bg_color)
            for child in widgets["frame"].winfo_children():
                child.config(bg=bg_color)

    def open_settings_window(self):
        self.show_window()
        settings_win = SettingsWindow(self, self.settings)
        if settings_win.new_settings is not None:
            self.settings = settings_win.new_settings
            self.save_settings()
            self.load_settings()
            self.refresh_ui_list()

    def load_default_icons(self):
        for icon_type, path in [('TEXT', config.TEXT_ICON_PATH), ('FILES', config.FILE_ICON_PATH)]:
            try:
                img = Image.open(path).resize(config.THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
                self._icon_cache[icon_type] = ImageTk.PhotoImage(img)
            except FileNotFoundError:
                color = '#80aaff' if icon_type == 'TEXT' else '#90ee90'
                self._icon_cache[icon_type] = ImageTk.PhotoImage(Image.new('RGB', config.THUMBNAIL_SIZE, color))

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

    def on_close_button_press(self):
        if self.settings.get('minimize_on_close', True):
            self.hide_window()
        else:
            self.quit_application()

    def setup_tray_icon(self):
        try:
            icon_image = Image.open(config.ICON_PATH)
        except FileNotFoundError:
            icon_image = Image.new('RGB', (64, 64), 'black')
        menu = pystray_menu(
            pystray_menu_item('Show', self.show_window, default=True),
            pystray_menu_item('Settings', self.open_settings_window),
            pystray_menu.SEPARATOR,
            pystray_menu_item('Quit', self.quit_application)
        )
        self.tray_icon = pystray_icon('PyClipboardHistory', icon_image, "PyClipboardHistory", menu)
        threading.Thread(target=self.tray_icon.run, daemon=True).start()

    def hide_window(self):
        self.withdraw()

    def show_window(self):
        self.deiconify()
        self.lift()
        self.attributes("-topmost", True)
        BORDER_MARGIN = 20
        mouse_x, mouse_y = self.winfo_pointerxy()
        window_width = self.winfo_width()
        window_height = self.winfo_height()
        current_monitor = None
        for m in get_monitors():
            if m.x <= mouse_x < m.x + m.width and m.y <= mouse_y < m.y + m.height:
                current_monitor = m
                break
        if not current_monitor:
            current_monitor = get_monitors()[0]
        safe_x_start = current_monitor.x + BORDER_MARGIN
        safe_y_start = current_monitor.y + BORDER_MARGIN
        safe_x_end = current_monitor.x + current_monitor.width - BORDER_MARGIN
        safe_y_end = current_monitor.y + current_monitor.height - BORDER_MARGIN
        ideal_x = mouse_x + 10
        ideal_y = mouse_y + 10
        final_x = ideal_x
        final_y = ideal_y
        if final_x + window_width > safe_x_end:
            final_x = mouse_x - window_width - 10
        if final_x < safe_x_start:
            final_x = safe_x_start
        if final_y + window_height > safe_y_end:
            final_y = mouse_y - window_height - 10
        if final_y < safe_y_start:
            final_y = safe_y_start
        self.geometry(f"{window_width}x{window_height}+{final_x}+{final_y}")
        self.after_idle(self.attributes, "-topmost", False)

    def quit_application(self):
        if self.hotkey_listener and self.hotkey_listener.is_alive():
            self.hotkey_listener.stop()
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.stop()
        if self.tray_icon:
            self.tray_icon.stop()
        self.destroy()

    def save_settings(self):
        with open(config.SETTINGS_PATH, 'w') as f:
            json.dump(self.settings, f, indent=4)

    def _on_canvas_configure(self, event):
        canvas_width = event.width
        self.canvas.itemconfig(self.canvas.create_window((0, 0), window=self.list_frame, anchor="nw"), width=canvas_width)

    def _on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1*(event.delta/120)), "units")

    def _on_frame_configure(self, event=None):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def on_filter_changed(self, event=None):
        self.refresh_ui_list()

    def start_monitoring(self):
        self.monitor_thread = ClipboardMonitor(self, self.on_new_clipboard_item)
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
        if new_id:
            self.after(0, self.refresh_ui_list)

    def _run_ai_classification(self, entry_id: int, text_content: str):
        tags = ai_classifier.classify_and_tag(text_content, self.settings)
        if tags:
            database.update_entry_tags(entry_id, tags)
            self.after(0, self.refresh_ui_list)

    def toggle_selected_favorite(self, event=None):
        if self.selected_item_id:
            database.toggle_favorite(self.selected_item_id)
            self.refresh_ui_list()

    def on_paste_selection(self, entry_id):
        full_entry = database.get_full_entry(entry_id)
        if full_entry:
            clipboard_adapter.write_to_clipboard(full_entry)
            self.title("PyClipboardHistory - Pasted!")
            self.after(1000, lambda: self.title("PyClipboardHistory"))

    def toggle_window(self):
        self.after(0, self._toggle_window_threadsafe)
    
    def _toggle_window_threadsafe(self):
        if self.state() == 'withdrawn':
            self.show_window()
        else:
            self.hide_window()