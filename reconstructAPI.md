
基于你的新前端设计和现有后端逻辑，定义一个清晰、高效的 API 是重构成功的关键。下面我为你设计一个 `Api` 类，它将作为 Python 后端和 JavaScript 前端之间的桥梁。

我建议在 `pyclip` 模块中创建一个新文件 `api.py` 来存放这个类，以保持代码的整洁。

---

### **策略与设计原则**

1. **职责单一**: 这个 `Api` 类只负责处理前端的请求，并将它们委托给相应的后端模块（如 `database`, `clipboard_adapter`）。它本身不包含复杂的业务逻辑。
2. **JSON 通信**: 所有函数的返回值都应该是可以被轻松序列化为 JSON 的格式（主要是字典和列表），以便 JavaScript 能直接使用。
3. **明确性**: 函数名和参数应该清晰地反映其意图。

---

### `py_clipboard_history/pyclip/api.py` (新文件)

下面是 `Api` 类的建议定义。你可以直接创建这个文件并使用以下内容作为起点。

```python
# py_clipboard_history/pyclip/api.py

import logging
from . import database
from . import clipboard_adapter
from .app import ClipboardApp # Assuming settings logic will be managed here or moved

# 注意：为了让这个API能够访问设置，我们需要一种方式来获取它们。
# 一个简单的方法是将主应用的实例或设置字典传递给Api类的构造函数。

class Api:
    def __init__(self, main_app_instance):
        """
        Initializes the API bridge.
    
        :param main_app_instance: A reference to the main application instance 
                                  to access settings and other core components.
        """
        self.app = main_app_instance

    def get_history(self, filter_type: str = "All Types", search_query: str = "") -> list[dict]:
        """
        Retrieves clipboard history based on filters and search query.
        Called by the frontend to populate the main list.

        :param filter_type: Can be "All Types", "Favorites ★", "TEXT", "IMAGE", "FILES".
        :param search_query: The text from the search box.
        :return: A list of dictionary objects, where each object represents a clipboard item.
        """
        logging.info(f"API: get_history called with filter='{filter_type}', query='{search_query}'")
        # 我们需要从数据库获取原始时间戳，让前端处理“多久以前”的逻辑
        history = database.get_history(filter_type=filter_type, search_query=search_query)
        # 确保返回的数据是前端友好的
        for item in history:
            # sqlite3.Row is dict-like, but converting to a real dict is safer for JSON
            item = dict(item) 
        return history

    def paste_item(self, item_id: int) -> dict:
        """
        Copies the content of a specific item back to the system clipboard.
        Called when a user double-clicks an item.

        :param item_id: The database ID of the item to paste.
        :return: A dictionary indicating success or failure.
        """
        logging.info(f"API: paste_item called for ID {item_id}")
        full_entry = database.get_full_entry(item_id)
        if full_entry:
            clipboard_adapter.write_to_clipboard(full_entry)
            return {"success": True}
        return {"success": False, "error": f"Item with ID {item_id} not found."}

    def toggle_favorite(self, item_id: int) -> dict:
        """
        Toggles the favorite status of an item.
        Called when the user clicks the star icon.

        :param item_id: The database ID of the item.
        :return: A dictionary indicating success.
        """
        logging.info(f"API: toggle_favorite called for ID {item_id}")
        database.toggle_favorite(item_id)
        return {"success": True}

    def delete_item(self, item_id: int) -> dict:
        """
        Deletes an item from the history.
        Called when the user clicks the delete icon.
    
        Note: This requires a new function in `database.py`.

        :param item_id: The database ID of the item.
        :return: A dictionary indicating success.
        """
        logging.info(f"API: delete_item called for ID {item_id}")
        # 你需要去 database.py 中添加 delete_entry 函数
        database.delete_entry(item_id) 
        return {"success": True}

    def get_settings(self) -> dict:
        """
        Retrieves the current application settings.
        Called when the settings page is loaded.

        :return: A dictionary containing all current settings.
        """
        logging.info("API: get_settings called")
        # 假设你的主 app 实例上有 settings 属性
        return self.app.settings

    def save_settings(self, settings_data: dict) -> dict:
        """
        Saves the updated settings.
        Called when the user clicks "Save" on the settings page.

        :param settings_data: A dictionary with the new settings.
        :return: A dictionary indicating success.
        """
        logging.info("API: save_settings called")
        # 假设你的主 app 实例上有 save_settings 方法和 settings 属性
        self.app.settings = settings_data
        self.app.save_settings() 
        # 可能还需要重新加载配置
        self.app.load_settings()
        return {"success": True}

```

### **需要做的配套修改**

1. **在 `database.py` 中添加 `delete_entry` 函数**：

   * **定位**：`py_clipboard_history/pyclip/database.py`
   * **实施步骤**：添加一个新函数 `delete_entry`。
   * **伪代码/指导**：
     1. 定义函数 `def delete_entry(entry_id: int):`。
     2. 连接到数据库。
     3. 执行 SQL 命令 `DELETE FROM clipboard_history WHERE id = ?`，并传入 `entry_id`。
     4. 提交事务并关闭连接。
     5. 添加适当的日志和错误处理。
2. **在 `main.py` 中集成 `Api` 和 `pywebview`**：

   * **定位**：`py_clipboard_history/main.py`
   * **实施步骤**：你需要重写 `main` 函数，移除 Tkinter 的启动代码，换成 `pywebview` 的。
   * **指导**：
     1. 导入 `webview` 和你的新 `Api` 类 (`from pyclip.api import Api`)。
     2. 移除 `main_app = app.ClipboardApp()` 和 `main_app.mainloop()`。
     3. 你需要一个地方来管理设置和状态，可以创建一个简化的主控类，或者直接在 `main` 函数里处理。
     4. 实例化 `Api` 类：`api = Api(main_app_instance)` (你需要将含有设置逻辑的对象传进去)。
     5. 创建 `pywebview` 窗口，并把 `api` 实例作为 `js_api` 参数传入：
        ```python
        import webview
        from pyclip.api import Api
        # ... 其他导入

        class MainController: # 一个用来管理状态和设置的简单类
            def __init__(self):
                self.settings = {}
                # ... 调用 load_settings() 等

            def load_settings(self):
                # ... 你的 load_settings 逻辑 ...

            def save_settings(self):
                # ... 你的 save_settings 逻辑 ...

        # ... 在 main() 函数中 ...
        controller = MainController()
        controller.load_settings()
        api_bridge = Api(controller)

        window = webview.create_window(
            'PyClipboardHistory',
            'frontend/index.html',  # 指向你的 HTML 文件
            js_api=api_bridge,
            width=420, # 匹配前端设计的宽度
            height=800
        )
        webview.start()
        ```

这个 API 定义为你提供了一个坚实的起点。它涵盖了你新前端设计中的所有核心交互，并且与你现有的后端模块能够很好地集成。
