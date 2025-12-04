import logging
from . import database
from . import clipboard_adapter

class Api:
    def __init__(self, main_app_instance):
        """
        Initializes the API bridge.

        :param main_app_instance: A reference to the main application instance 
                                  to access settings and other core components.
        """
        self._app = main_app_instance

    def get_history(self, filter_type: str = "All Types", search_query: str = "") -> list[dict]:
        """
        Retrieves clipboard history based on filters and search query.
        Called by the frontend to populate the main list.

        :param filter_type: Can be "All Types", "Favorites ★", "TEXT", "IMAGE", "FILES".
        :param search_query: The text from the search box.
        :return: A list of dictionary objects, where each object represents a clipboard item.
        """
        logging.info(f"API: get_history called with filter='{filter_type}', query='{search_query}'")
        try:
            history = database.get_history(filter_type=filter_type, search_query=search_query)
            # Ensure data is JSON serializable
            result = []
            for item in history:
                result.append(dict(item))
            return result
        except Exception as e:
            logging.error(f"API Error in get_history: {e}")
            return []

    def paste_item(self, item_id: int) -> dict:
        """
        Copies the content of a specific item back to the system clipboard.
        Called when a user double-clicks an item.

        :param item_id: The database ID of the item to paste.
        :return: A dictionary indicating success or failure.
        """
        logging.info(f"API: paste_item called for ID {item_id}")
        try:
            full_entry = database.get_full_entry(item_id)
            if full_entry:
                clipboard_adapter.write_to_clipboard(full_entry)
                return {"success": True}
            return {"success": False, "error": f"Item with ID {item_id} not found."}
        except Exception as e:
            logging.error(f"API Error in paste_item: {e}")
            return {"success": False, "error": str(e)}

    def toggle_favorite(self, item_id: int) -> dict:
        """
        Toggles the favorite status of an item.
        Called when the user clicks the star icon.

        :param item_id: The database ID of the item.
        :return: A dictionary indicating success.
        """
        logging.info(f"API: toggle_favorite called for ID {item_id}")
        try:
            database.toggle_favorite(item_id)
            return {"success": True}
        except Exception as e:
            logging.error(f"API Error in toggle_favorite: {e}")
            return {"success": False, "error": str(e)}

    def delete_item(self, item_id: int) -> dict:
        """
        Deletes an item from the history.
        Called when the user clicks the delete icon.

        :param item_id: The database ID of the item.
        :return: A dictionary indicating success.
        """
        logging.info(f"API: delete_item called for ID {item_id}")
        try:
            database.delete_entry(item_id) 
            return {"success": True}
        except Exception as e:
            logging.error(f"API Error in delete_item: {e}")
            return {"success": False, "error": str(e)}

    def get_settings(self) -> dict:
        """
        Retrieves the current application settings.
        Called when the settings page is loaded.

        :return: A dictionary containing all current settings.
        """
        logging.info("API: get_settings called")
        try:
            return self._app.settings
        except Exception as e:
            logging.error(f"API Error in get_settings: {e}")
            return {}

    def save_settings(self, settings_data: dict) -> dict:
        """
        Saves the updated settings.
        Called when the user clicks "Save" on the settings page.

        :param settings_data: A dictionary with the new settings.
        :return: A dictionary indicating success.
        """
        logging.info("API: save_settings called")
        try:
            self._app.settings = settings_data
            self._app.save_settings() 
            # Reload settings if necessary
            # self._app.load_settings()
            return {"success": True}
        except Exception as e:
            logging.error(f"API Error in save_settings: {e}")
            return {"success": False, "error": str(e)}
