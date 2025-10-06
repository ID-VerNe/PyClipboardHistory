# PyClipboardHistory

A feature-rich, AI-powered clipboard history manager for Windows, built with Python and Tkinter.

This tool enhances your productivity by providing a searchable, filterable, and previewable history of everything you copy. It supports text, images, and file paths, and leverages AI for automatic tagging of text content.

![App Screenshot](https://wechat.likesyou.org/2025-10-06_232639.jpg)  <!-- It is recommended to replace this with a real screenshot URL -->

## ✨ Core Features

- **Multi-Format History**: Automatically captures text, images, and copied file paths.
- **Instant Search & Filter**: A real-time search box and category filters (All, Favorites, Text, Image, Files) help you find entries instantly.
- **Keyword Highlighting**: Search terms are highlighted in the results for quick identification.
- **Hover-to-Preview**: Simply hover over an entry to see its full content—text or image—in a smart-positioned popup.
- **AI Auto-Tagging**: Automatically classifies and adds relevant tags to copied text snippets (configurable, supports OpenAI/Gemini).
- **Favorites**: Mark important entries as favorites (⭐) for easy access.
- **Global Hotkey**: Summon or hide the application window from anywhere with a global hotkey (`Ctrl+Alt+V`).
- **Modern UX**: Features like auto-hide on focus loss and intelligent window positioning provide a smooth, modern user experience.
- **Highly Configurable**: Customize AI providers, models, and UI colors through a user-friendly settings menu.
- **System Tray Integration**: Minimizes to the system tray for unobtrusive background operation.

## 🛠️ Tech Stack

- **GUI**: Python's built-in `tkinter` library, with `ttk` for modern widgets.
- **Clipboard Monitoring**: A custom polling mechanism using `pyperclip` (or a similar clipboard library).
- **Global Hotkeys**: `pynput`
- **Image Handling**: `Pillow` (PIL Fork)
- **System Tray Icon**: `pystray`
- **Multi-Monitor Support**: `screeninfo`
- **AI Integration**: `openai`, `google-generativeai`

## 🚀 Getting Started

### Prerequisites

- Python 3.10+ (or the version used in your `.venv`)

### Installation & Usage

1.  **Clone the repository or download the source code.**

2.  **Set up the virtual environment:**
    ```bash
    # Create a virtual environment
    python -m venv .venv
    
    # Activate it
    # On Windows
    .venv\Scripts\activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt 
    # Note: You may need to create a requirements.txt file first by running:
    # pip freeze > requirements.txt
    ```

4.  **Run the application:**

    Simply double-click the `start_app.bat` file in the project root. 
    
    This script will request administrator privileges (required for the global hotkey to work everywhere) and launch the application in the background. You will see its icon appear in the system tray.

## ⚙️ Configuration

- To open the settings menu, right-click the system tray icon and select "Settings", or click the "Settings" button in the main application window.
- **AI Tagging**: To use AI features, you must enable it in the settings and provide your own API key for either OpenAI or Gemini.
- **Appearance**: All UI colors, including the search highlight color, can be customized in the "Appearance" tab.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---
*Crafted by VerNe, 2025-10-06*
