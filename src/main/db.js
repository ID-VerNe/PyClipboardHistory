import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

// --- Storage Path Logic ---
const getStorageRoot = () => {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'))
  }
  return app.getAppPath()
}

const STORAGE_ROOT = getStorageRoot()
const DATA_DIR = path.join(STORAGE_ROOT, 'storage')
const dbPath = path.join(DATA_DIR, 'clipboard.db')
// Use v2 flag to force re-correction to the new root storage location
const migrationFlagPath = path.join(DATA_DIR, '.migrated_v2')

fs.ensureDirSync(DATA_DIR)

// --- Migration & Correction Logic ---
const legacyStorageDir = path.join(app.getAppPath(), '_legacy_python_version', 'storage')

// Function to correct paths in the DB - optimized to be non-blocking for startup
const correctPaths = (dbInstance) => {
  console.log('Checking if database paths need correction...')
  const imagesRoot = path.join(DATA_DIR, 'images')
  const thumbsRoot = path.join(imagesRoot, 'thumbnails')
  
  fs.ensureDirSync(thumbsRoot)

  // Use a timeout to not block the main event loop during critical startup phase
  setTimeout(() => {
    try {
      const rows = dbInstance.prepare("SELECT id, content, thumbnail_path FROM clipboard_history WHERE data_type = 'IMAGE'").all()
      const updateStmt = dbInstance.prepare("UPDATE clipboard_history SET content = ?, thumbnail_path = ? WHERE id = ?")
      
      const transaction = dbInstance.transaction((items) => {
        for (const row of items) {
          let newContent = row.content
          let newThumb = row.thumbnail_path
          
          if (newContent && typeof newContent === 'string' && !newContent.startsWith(DATA_DIR)) {
            const fileName = path.basename(newContent)
            newContent = path.join(imagesRoot, fileName)
          }
          
          if (newThumb && typeof newThumb === 'string' && !newThumb.startsWith(DATA_DIR)) {
            const fileName = path.basename(newThumb)
            newThumb = path.join(thumbsRoot, fileName)
          }
          
          if (newContent !== row.content || newThumb !== row.thumbnail_path) {
            updateStmt.run(newContent, newThumb, row.id)
          }
        }
      })
      transaction(rows)
      console.log('Database paths checked and corrected.')
    } catch (err) {
      console.error('Background path correction failed:', err)
    }
  }, 1000) 
}

if (!fs.existsSync(migrationFlagPath)) {
  try {
    const oldDbPath = path.join(legacyStorageDir, 'clipboard.db')
    const oldImagesDir = path.join(legacyStorageDir, 'images')

    const isNewDb = !fs.existsSync(dbPath) || (fs.statSync(dbPath).size < 1024 * 100)
    
    if (fs.existsSync(oldDbPath) && isNewDb) {
      console.log('Migrating legacy database from _legacy_python_version...')
      fs.copySync(oldDbPath, dbPath)
      
      if (fs.existsSync(oldImagesDir)) {
        console.log('Migrating legacy images...')
        fs.copySync(oldImagesDir, path.join(DATA_DIR, 'images'), { overwrite: false })
      }
    }

    fs.writeFileSync(migrationFlagPath, 'done')
  } catch (err) {
    console.error('Migration failed in db.js:', err)
  }
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS clipboard_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_type TEXT NOT NULL,
    content TEXT NOT NULL,
    preview TEXT,
    preview_base64 TEXT,
    is_favorite INTEGER DEFAULT 0 NOT NULL,
    thumbnail_path TEXT,
    content_hash TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_content_hash ON clipboard_history(content_hash);
  CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_history(timestamp);
  CREATE INDEX IF NOT EXISTS idx_favorite ON clipboard_history(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_data_type ON clipboard_history(data_type);
`)

// --- Migration: Add preview_base64 if missing ---
try {
  const columns = db.prepare("PRAGMA table_info(clipboard_history)").all()
  const hasPreviewBase64 = columns.some(col => col.name === 'preview_base64')
  if (!hasPreviewBase64) {
    console.log('Migrating database: Adding preview_base64 column...')
    db.exec("ALTER TABLE clipboard_history ADD COLUMN preview_base64 TEXT")
    console.log('Migration completed.')
  }
} catch (err) {
  console.error('Migration failed:', err)
}

// Run path correction in background
correctPaths(db)

export default {
  // Check if a hash already exists
  getByHash: (content_hash) => {
    if (content_hash == null) return null
    return db.prepare('SELECT * FROM clipboard_history WHERE content_hash = ?').get(content_hash)
  },

  // Get a single entry by ID (for file cleanup on delete)
  getById: (id) => {
    return db.prepare('SELECT * FROM clipboard_history WHERE id = ?').get(id)
  },

  // Update timestamp to move an item to the top
  updateTimestamp: (id) => {
    db.prepare('UPDATE clipboard_history SET timestamp = CURRENT_TIMESTAMP WHERE id = ?').run(id)
  },

  addEntry: (data_type, content, content_hash, preview, thumbnail_path, preview_base64) => {
    try {
      // 1. Check if already exists (including favorites)
      const existing = db.prepare('SELECT id FROM clipboard_history WHERE content_hash = ?').get(content_hash)
      
      if (existing) {
        // If exists, just bring it to top by updating timestamp
        db.prepare('UPDATE clipboard_history SET timestamp = CURRENT_TIMESTAMP WHERE id = ?').run(existing.id)
        return existing.id
      }

      // 2. If not exists, insert new
      const insertStmt = db.prepare(`
        INSERT INTO clipboard_history (data_type, content, preview, thumbnail_path, content_hash, preview_base64)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const info = insertStmt.run(data_type, content, preview, thumbnail_path, content_hash, preview_base64)

      return info.lastInsertRowid
    } catch (err) {
      console.error('DB Add Entry Error:', err)
      return null
    }
  },

  getHistory: (filter, query, limit = 50, offset = 0) => {
    try {
      let sql = 'SELECT * FROM clipboard_history'
      const params = []
      const whereClauses = []

      if (filter === 'Favorites') {
        whereClauses.push('is_favorite = 1')
      } else if (filter === 'TEXT' || filter === 'IMAGE') {
        whereClauses.push('data_type = ?')
        params.push(filter)
      } else if (filter && filter !== 'All') {
        whereClauses.push('data_type = ?')
        params.push(filter)
      }

      if (query) {
        whereClauses.push('(preview LIKE ? OR content LIKE ?)')
        params.push(`%${query}%`, `%${query}%`)
      }

      if (whereClauses.length > 0) {
        sql += ' WHERE ' + whereClauses.join(' AND ')
      }

      sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      params.push(limit, offset)
      
      return db.prepare(sql).all(...params)
    } catch (err) {
      console.error('DB Get History Error:', err)
      return []
    }
  },

  toggleFavorite: (id) => {
    try {
      db.prepare('UPDATE clipboard_history SET is_favorite = NOT is_favorite WHERE id = ?').run(id)
    } catch (err) {
      console.error('DB Toggle Favorite Error:', err)
    }
  },

  deleteEntry: (id) => {
    try {
      db.prepare('DELETE FROM clipboard_history WHERE id = ?').run(id)
    } catch (err) {
      console.error('DB Delete Entry Error:', err)
    }
  }
}
