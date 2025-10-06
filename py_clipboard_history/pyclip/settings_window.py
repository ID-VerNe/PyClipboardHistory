import tkinter as tk
from tkinter import ttk

class ColorPickerEntry(ttk.Frame):
    """A widget for displaying and picking a color."""
    def __init__(self, master, text, color_var):
        super().__init__(master)
        self.color_var = color_var
        ttk.Label(self, text=text).pack(side=tk.LEFT)
        self.entry = ttk.Entry(self, textvariable=self.color_var, width=12)
        self.entry.pack(side=tk.LEFT, padx=5)
        self.color_swatch = tk.Label(self, text="      ", bg=self.color_var.get(), relief="sunken")
        self.color_swatch.pack(side=tk.LEFT)
        self.color_var.trace_add("write", self._update_swatch)

    def _update_swatch(self, *args):
        try:
            self.color_swatch.config(bg=self.color_var.get())
        except tk.TclError:
            pass # Ignore invalid color names during typing

class SettingsWindow(tk.Toplevel):
    def __init__(self, master, current_settings: dict):
        super().__init__(master)
        self.transient(master)
        self.title("Settings")
        self.geometry("500x400")
        self.resizable(False, False)
        self.grab_set()

        self.new_settings = current_settings.copy()
        self._create_variables()
        self._load_settings_to_vars()

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        self.general_tab = ttk.Frame(self.notebook, padding=20)
        self.appearance_tab = ttk.Frame(self.notebook, padding=20)
        self.ai_tab = ttk.Frame(self.notebook, padding=20)

        self.notebook.add(self.general_tab, text='General')
        self.notebook.add(self.appearance_tab, text='Appearance')
        self.notebook.add(self.ai_tab, text='AI Tagging')

        self.setup_general_tab()
        self.setup_appearance_tab()
        self.setup_ai_tab()
        self.setup_action_buttons()

        self.protocol("WM_DELETE_WINDOW", self.cancel)
        self.wait_window(self)

    def _create_variables(self):
        self.vars = {
            'minimize_on_close': tk.BooleanVar(),
            'max_history_items': tk.IntVar(),
            'enable_ai_tagging': tk.BooleanVar(),
            'ai_provider': tk.StringVar(),
            'ai_model_name': tk.StringVar(),
            'ai_base_url': tk.StringVar(),
            'ai_api_key': tk.StringVar(),
            'colors': {
                'normal_bg': tk.StringVar(),
                'fav_bg': tk.StringVar(),
                'selected_bg': tk.StringVar(),
                'highlight_bg': tk.StringVar(),
            }
        }

    def _load_settings_to_vars(self):
        # General
        self.vars['minimize_on_close'].set(self.new_settings.get('minimize_on_close', True))
        self.vars['max_history_items'].set(self.new_settings.get('max_history_items', 200))
        # AI
        self.vars['enable_ai_tagging'].set(self.new_settings.get('enable_ai_tagging', False))
        self.vars['ai_provider'].set(self.new_settings.get('ai_provider', 'OpenAI'))
        self.vars['ai_model_name'].set(self.new_settings.get('ai_model_name', 'gpt-4o'))
        self.vars['ai_base_url'].set(self.new_settings.get('ai_base_url', ''))
        self.vars['ai_api_key'].set(self.new_settings.get('ai_api_key', ''))
        # Colors
        default_colors = self.new_settings.get('colors', {})
        self.vars['colors']['normal_bg'].set(default_colors.get('normal_bg', '#FFFFFF'))
        self.vars['colors']['fav_bg'].set(default_colors.get('fav_bg', '#FFF9E6'))
        self.vars['colors']['selected_bg'].set(default_colors.get('selected_bg', '#CCE8FF'))
        self.vars['colors']['highlight_bg'].set(default_colors.get('highlight_bg', 'lightblue'))

    def setup_general_tab(self):
        ttk.Checkbutton(self.general_tab, text="Closing window minimizes to system tray", variable=self.vars['minimize_on_close']).pack(anchor=tk.W)
        ttk.Label(self.general_tab, text="Max History Items:").pack(anchor=tk.W, pady=(10,0))
        ttk.Spinbox(self.general_tab, from_=50, to=1000, increment=50, textvariable=self.vars['max_history_items'], width=10).pack(anchor=tk.W)

    def setup_appearance_tab(self):
        self.appearance_tab.columnconfigure(1, weight=1)
        ColorPickerEntry(self.appearance_tab, "Normal BG:", self.vars['colors']['normal_bg']).grid(row=0, column=0, pady=4, sticky="w")
        ColorPickerEntry(self.appearance_tab, "Favorite BG:", self.vars['colors']['fav_bg']).grid(row=1, column=0, pady=4, sticky="w")
        ColorPickerEntry(self.appearance_tab, "Selected BG:", self.vars['colors']['selected_bg']).grid(row=2, column=0, pady=4, sticky="w")
        ColorPickerEntry(self.appearance_tab, "Highlight BG:", self.vars['colors']['highlight_bg']).grid(row=3, column=0, pady=4, sticky="w")

    def setup_ai_tab(self):
        self.ai_tab.columnconfigure(1, weight=1)
        ttk.Checkbutton(self.ai_tab, text="Enable automatic AI tagging for text", variable=self.vars['enable_ai_tagging']).grid(row=0, columnspan=2, sticky=tk.W, pady=(0,10))
        ttk.Label(self.ai_tab, text="Provider:").grid(row=1, column=0, sticky=tk.W, pady=2)
        ttk.Combobox(self.ai_tab, textvariable=self.vars['ai_provider'], values=["OpenAI", "Gemini"], state="readonly").grid(row=1, column=1, sticky=tk.EW, pady=2)
        ttk.Label(self.ai_tab, text="Model:").grid(row=2, column=0, sticky=tk.W, pady=2)
        ttk.Entry(self.ai_tab, textvariable=self.vars['ai_model_name']).grid(row=2, column=1, sticky=tk.EW, pady=2)
        ttk.Label(self.ai_tab, text="Base URL (Optional):").grid(row=3, column=0, sticky=tk.W, pady=2)
        ttk.Entry(self.ai_tab, textvariable=self.vars['ai_base_url']).grid(row=3, column=1, sticky=tk.EW, pady=2)
        ttk.Label(self.ai_tab, text="API Key:").grid(row=4, column=0, sticky=tk.W, pady=2)
        ttk.Entry(self.ai_tab, textvariable=self.vars['ai_api_key'], show="*").grid(row=4, column=1, sticky=tk.EW, pady=2)

    def setup_action_buttons(self):
        button_frame = ttk.Frame(self)
        button_frame.pack(fill=tk.X, padx=10, pady=(0, 10))
        ttk.Button(button_frame, text="Save", command=self.save_and_close).pack(side=tk.RIGHT)
        ttk.Button(button_frame, text="Cancel", command=self.cancel).pack(side=tk.RIGHT, padx=10)

    def save_and_close(self):
        for key, var in self.vars.items():
            if isinstance(var, dict):
                self.new_settings[key] = {k: v.get() for k, v in var.items()}
            else:
                self.new_settings[key] = var.get()
        self.destroy()

    def cancel(self):
        self.new_settings = None
        self.destroy()