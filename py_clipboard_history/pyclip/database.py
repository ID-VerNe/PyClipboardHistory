
import sqlite3
import logging
from . import config

def init_db():
    try:
        with sqlite3.connect(config.DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS clipboard_history (
                    id INTEGER PRIMARY KEY,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    data_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    preview TEXT,
                    rich_content TEXT,
                    rich_content_type TEXT,
                    tags TEXT,
                    is_favorite INTEGER DEFAULT 0 NOT NULL,
                    source_app TEXT,
                    thumbnail_path TEXT,
                    content_hash TEXT
                )
            """)
            # Add content_hash column if it doesn't exist for migration
            cursor.execute("PRAGMA table_info(clipboard_history)")
            columns = [info[1] for info in cursor.fetchall()]
            if 'content_hash' not in columns:
                cursor.execute("ALTER TABLE clipboard_history ADD COLUMN content_hash TEXT")
            # Create an index on the hash for faster lookups
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_content_hash ON clipboard_history(content_hash)")
            
            conn.commit()
            logging.info(f"Database initialized successfully at {config.DB_PATH}")
    except sqlite3.Error as e:
        logging.error(f"Database initialization failed: {e}")
        raise

def add_entry(data_type: str, content: str, content_hash: str, preview: str | None = None, thumbnail_path: str | None = None):
    if not content or not content.strip():
        return None

    if preview is None:
        preview = (content[:config.PREVIEW_MAX_LEN] + '...') if len(content) > config.PREVIEW_MAX_LEN else content
    
    try:
        with sqlite3.connect(config.DB_PATH) as conn:
            cursor = conn.cursor()
            
            # First, delete any existing non-favorite entry with the same hash
            cursor.execute("DELETE FROM clipboard_history WHERE content_hash = ? AND is_favorite = 0", (content_hash,))
            if cursor.rowcount > 0:
                logging.info(f"Removed {cursor.rowcount} old entry with same content hash to be replaced.")

            # Then, insert the new entry
            cursor.execute(
                "INSERT INTO clipboard_history (data_type, content, preview, thumbnail_path, content_hash) VALUES (?, ?, ?, ?, ?)",
                (data_type, content, preview.strip(), thumbnail_path, content_hash)
            )
            new_id = cursor.lastrowid
            
            # Prune old entries
            cursor.execute("""
                DELETE FROM clipboard_history
                WHERE id IN (
                    SELECT id FROM clipboard_history WHERE is_favorite = 0
                    ORDER BY timestamp ASC
                    LIMIT MAX(0, (SELECT COUNT(*) FROM clipboard_history WHERE is_favorite = 0) - ?))
            """, (config.MAX_HISTORY_ITEMS,))
            
            conn.commit()
            return new_id
    except sqlite3.Error as e:
        logging.error(f"Failed to add entry to database: {e}")
        return None

def get_history(limit: int = 50, filter_type: str | None = None, search_query: str | None = None):
    """
    Retrieves entries, with options to filter by type and search by query.
    """
    try:
        with sqlite3.connect(config.DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            params = []
            query = "SELECT id, preview, tags, data_type, content, thumbnail_path, is_favorite FROM clipboard_history"
            
            where_clauses = []
            if filter_type and filter_type != "All Types":
                if filter_type == "Favorites ★":
                    where_clauses.append("is_favorite = 1")
                else:
                    where_clauses.append("data_type = ?")
                    params.append(filter_type)
            
            if search_query:
                # Search in both preview and content for better matching
                where_clauses.append("(preview LIKE ? OR content LIKE ?)")
                params.extend([f"%{search_query}%", f"%{search_query}%"])

            if where_clauses:
                query += " WHERE " + " AND ".join(where_clauses)

            query += " ORDER BY timestamp DESC LIMIT ?"
            params.append(limit)
            
            cursor.execute(query, params)
            results = [dict(row) for row in cursor.fetchall()]
            logging.info(f"Retrieved {len(results)} entries (filter: {filter_type}, search: '{search_query}').")
            return results
            
    except sqlite3.Error as e:
        logging.error(f"Failed to get history from database: {e}")
        return []

def get_full_entry(entry_id: int):
    try:
        with sqlite3.connect(config.DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM clipboard_history WHERE id = ?", (entry_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    except sqlite3.Error as e:
        logging.error(f"Failed to get full entry for id {entry_id}: {e}")
        return None

def update_entry_tags(entry_id: int, tags: list[str]):
    if not tags: return
    tags_str = ",".join(tags)
    try:
        with sqlite3.connect(config.DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE clipboard_history SET tags = ? WHERE id = ?", (tags_str, entry_id))
            conn.commit()
    except sqlite3.Error as e:
        logging.error(f"Failed to update tags for entry id {entry_id}: {e}")

def toggle_favorite(entry_id: int):
    """Toggles the is_favorite status for a given entry_id."""
    try:
        with sqlite3.connect(config.DB_PATH) as conn:
            cursor = conn.cursor()
            # Using `is_favorite = NOT is_favorite` is a neat SQL trick.
            cursor.execute("UPDATE clipboard_history SET is_favorite = NOT is_favorite WHERE id = ?", (entry_id,))
            conn.commit()
            logging.info(f"Toggled favorite status for entry id {entry_id}.")
    except sqlite3.Error as e:
        logging.error(f"Failed to toggle favorite for entry id {entry_id}: {e}")
