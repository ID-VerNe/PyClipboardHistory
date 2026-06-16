
### **核心架构策略**

我们的核心策略是将项目重构为“前端-后端”分离的模式：

1. **后端 (Python)**: 负责所有核心逻辑，包括剪贴板监控、数据库操作、文件系统交互和 AI 分类。它将通过 `pywebview` 暴露一个 API 接口给前端。
2. **前端 (HTML/CSS/JS)**: 负责所有的用户界面展示和用户交互。它将通过 JavaScript 调用 Python 暴露的 API 来获取数据和触发后端操作。
3. **桥梁 (`pywebview`)**: 负责创建窗口，加载 HTML 页面，并建立 Python 和 JavaScript 之间的双向通信渠道。

### **实施步骤**

我们分阶段进行，这样思路会更清晰。

#### **第一阶段：搭建基础框架**

1. **调整项目结构**：

   * 在项目根目录下创建一个新文件夹，例如 `frontend` 或 `ui`。
   * 将你的 `clipboard_home_screen/code.html` 重命名为 `index.html` 并放入 `frontend` 文件夹。同样，将 `modern_settings_screen/code.html` 重命名为 `settings.html` 也放进去。
   * 建议为你的前端代码创建一个单独的 JavaScript 文件，例如 `frontend/app.js`，用来处理所有与后端的交互逻辑。
2. **修改主入口 (`main.py`)**：

   * 移除所有 Tkinter 相关的初始化代码（例如 `ClipboardApp` 类的实例化和 `mainloop` 调用）。
   * 引入 `webview` 库。
   * 修改 `main()` 函数，使其创建并启动一个 `pywebview` 窗口，加载你的 `frontend/index.html`。
3. **创建 Python API 类**：

   * 在 `pyclip` 模块下创建一个新文件，例如 `api.py`，或者直接在 `app.py` 中创建一个新的 `Api` 类。这个类将专门用来存放所有需要从 JavaScript 调用的 Python 函数。
   * 将 `ClipboardApp` 类中的**非 UI 逻辑**方法，迁移或封装到这个新的 `Api` 类中。例如：
     * 获取历史记录 (`get_history`)
     * 切换收藏 (`toggle_favorite`)
     * 删除条目 (`delete_entry`)
     * 获取设置 (`get_settings`)
     * 保存设置 (`save_settings`)
   * 确保这些 API 方法返回的数据格式是 JSON 友好的（例如字典或列表）。
4. **暴露 API 给前端**：

   * 在 `main.py` 中，实例化你的 `Api` 类。
   * 在创建 `pywebview` 窗口时，将这个 API 实例注入到窗口对象中。`pywebview` 会自动将其暴露给 JavaScript。

#### **第二阶段：实现主界面功能**

1. **前端 JS (`app.js`)：加载历史记录**

   * 在 `app.js` 中，编写一个函数（例如 `loadHistory()`），它在页面加载完成后被调用。
   * 在这个函数内部，通过 `window.pywebview.api.get_history()` 调用 Python 后端的 API。这是一个异步调用，所以你需要使用 `Promise` (`.then()`) 或 `async/await` 来处理返回的数据。
   * 获取到数据后，用 JavaScript 动态地在 `index.html` 的 `<main>` 区域生成列表项。你需要根据数据（类型、内容、是否收藏等）来构建每个列表项的 HTML 结构。
2. **前端 JS (`app.js`)：实现搜索和过滤**

   * 为搜索框的 `input` 事件和过滤器的 `change` 事件添加监听器。
   * 当事件触发时，获取输入值，并再次调用 `window.pywebview.api.get_history(filter, query)`，将过滤条件和搜索词作为参数传递。
   * 用返回的新数据重新渲染列表。
3. **前端 JS (`app.js`)：实现交互（收藏、删除、粘贴）**

   * 在动态生成列表项时，为收藏、删除等按钮绑定 `click` 事件监听器。
   * 在监听器的回调函数中，获取该项的 `id`，然后调用对应的 Python API，例如 `window.pywebview.api.toggle_favorite(itemId)`。
   * 调用成功后，你可以选择重新加载整个列表，或者更高效地只更新前端 UI 上那一个图标的状态。
   * 对于双击粘贴，同样绑定 `dblclick` 事件，并调用 `window.pywebview.api.paste_item(itemId)`。

#### **第三阶段：处理实时更新**

这是将项目从 Tkinter 迁移到 `pywebview` 的一个关键点。

1. **修改 `ClipboardMonitor` 的回调**：
   * 之前，`on_new_clipboard_item` 通过 `self.after(0, self.refresh_ui_list)` 来更新 Tkinter UI。
   * 现在，你需要修改 `on_new_clipboard_item` 函数。当有新项目时，它需要一种方式来通知前端。
   * 最佳实践是使用 `window.evaluate_js()`。在你的主 Python 线程中（`main.py` 或管理 `pywebview` 窗口的地方），修改回调逻辑，使其调用 `window.evaluate_js('loadHistory()')` 或一个专门用于增量更新的 JS 函数。
   * **定位**：修改 `pyclip/app.py` 中的 `on_new_clipboard_item` 方法。你需要将 `pywebview` 的 `window` 对象传递给负责处理回调的实例，以便它能调用 `evaluate_js`。

#### **第四阶段：集成设置页面和系统托盘**

1. **设置页面**：

   * 在 `index.html` 中，为设置按钮添加一个点击事件，该事件可以打开一个新的 `pywebview` 窗口来加载 `settings.html`。
   * `settings.html` 页面加载时，通过 `window.pywebview.api.get_settings()` 获取当前设置并填充表单。
   * 当用户点击保存时，收集表单数据，并通过 `window.pywebview.api.save_settings(newSettings)` 将其发送回 Python 后端。
2. **系统托盘和全局热键**：

   * 这部分逻辑基本不受前端变化的影响。`pystray` 和 `pynput` 的代码可以大部分保留。
   * 你只需要将原来控制 Tkinter 窗口显示/隐藏的 `self.show_window` 和 `self.hide_window` 方法，替换为控制 `pywebview` 窗口的 `window.show()` 和 `window.hide()` 方法即可。

### **总结与设计原理**

* **为什么这么做？** 这种前后端分离的架构模式让你的代码职责更清晰。Python 专注于处理数据和操作系统交互，而 Web 技术（HTML/CSS/JS）则发挥其在构建漂亮、响应式 UI 方面的全部优势。这使得两边的开发和维护都更加容易。
* **性能提升**：浏览器内核在渲染复杂的、动态的列表方面通常比 Tkinter 有更好的性能和硬件加速支持，这应该能解决你遇到的卡顿问题。
