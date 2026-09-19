import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

// --- Storage Path Logic ---
// Unified across dev and packaged: ~/.pyclipboard-history
// Data survives rebuilds/reinstalls instead of living next to the exe.
export const STORAGE_ROOT = path.join(app.getPath('home'), '.pyclipboard-history')
export const DATA_DIR = path.join(STORAGE_ROOT, 'storage')
export const IMAGES_DIR = path.join(DATA_DIR, 'images')
export const THUMBS_DIR = path.join(IMAGES_DIR, 'thumbnails')
export const dbPath = path.join(DATA_DIR, 'clipboard.db')

// One-time relocation from legacy exe-relative storage to the new home location.
const relocatedFlag = path.join(DATA_DIR, '.relocated')
function relocateLegacyStorage() {
  if (fs.existsSync(relocatedFlag)) return
  fs.ensureDirSync(DATA_DIR)

  // Legacy location was dirname(exe)/storage (packaged) or appPath/storage (dev).
  const exeDir = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()
  const legacyStorage = path.join(exeDir, 'storage')

  if (fs.existsSync(path.join(legacyStorage, 'clipboard.db'))) {
    try {
      console.log('Relocating legacy storage to', STORAGE_ROOT)
      // Copy each top-level entry; the destination DATA_DIR already exists.
      for (const entry of fs.readdirSync(legacyStorage)) {
        const src = path.join(legacyStorage, entry)
        const dst = path.join(DATA_DIR, entry)
        if (fs.existsSync(dst)) {
          // merge images directories
          if (entry === 'images') {
            fs.copySync(src, dst, { overwrite: false })
          }
          continue
        }
        fs.moveSync(src, dst)
      }
      console.log('Legacy storage relocation complete.')
    } catch (err) {
      console.error('Legacy storage relocation failed:', err)
    }
  }
  fs.writeFileSync(relocatedFlag, 'done')
}
relocateLegacyStorage()

fs.ensureDirSync(DATA_DIR)
fs.ensureDirSync(THUMBS_DIR)

// --- Migration & Path Correction (one-shot, flag-guarded) ---
const migrationFlagPath = path.join(DATA_DIR, '.migrated_v2')
const legacyStorageDir = path.join(app.getAppPath(), '_legacy_python_version', 'storage')

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
        fs.copySync(oldImagesDir, IMAGES_DIR, { overwrite: false })
      }
    }

    fs.writeFileSync(migrationFlagPath, 'done')
  } catch (err) {
    console.error('Migration failed in db.js:', err)
  }
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('temp_store = MEMORY')
db.pragma('cache_size = -20000')
db.pragma('mmap_size = 67108864')

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
  CREATE INDEX IF NOT EXISTS idx_timestamp_desc ON clipboard_history(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_favorite_ts ON clipboard_history(is_favorite, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_type_ts ON clipboard_history(data_type, timestamp DESC);
`)


// --- Schema alignment: drop legacy unused columns if present ---
const columns = db.prepare("PRAGMA table_info(clipboard_history)").all()
const colNames = columns.map(c => c.name)
for (const legacy of ['rich_content', 'rich_content_type', 'tags', 'source_app']) {
  if (colNames.includes(legacy)) {
    try { db.exec(`ALTER TABLE clipboard_history DROP COLUMN ${legacy}`) } catch (err) { console.warn('drop column failed:', legacy, err) }
  }
}
// Add preview_base64 if missing (keep column for compat, but we no longer write/read it)
if (!colNames.includes('preview_base64')) {
  try { db.exec('ALTER TABLE clipboard_history ADD COLUMN preview_base64 TEXT') } catch {}
}

// Drop old low-cardinality single-column indexes if they still exist from prior versions.
db.exec(`
  DROP INDEX IF EXISTS idx_timestamp;
  DROP INDEX IF EXISTS idx_favorite;
  DROP INDEX IF EXISTS idx_data_type;
`)

const userVersion = db.pragma('user_version', { simple: true })
if (userVersion < 1) {
  db.pragma('user_version = 1')
}

// --- FTS5 full-text index on content + preview ---
// External-content FTS5: the base table clipboard_history holds the real data;
// the fts table only stores the index. To search, JOIN against the fts table and
// MATCH there, then read columns from the base table. (MATCHing the fts table
// name as a column directly only works on the fts table itself, not on the base.)
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_history_fts USING fts5(
    content, preview, content='clipboard_history', content_rowid=id
  );
  CREATE TRIGGER IF NOT EXISTS clipboard_history_ai AFTER INSERT ON clipboard_history BEGIN
    INSERT INTO clipboard_history_fts(rowid, content, preview) VALUES (new.id, new.content, new.preview);
  END;
  CREATE TRIGGER IF NOT EXISTS clipboard_history_ad AFTER DELETE ON clipboard_history BEGIN
    INSERT INTO clipboard_history_fts(clipboard_history_fts, rowid, content, preview) VALUES ('delete', old.id, old.content, old.preview);
  END;
`)
// NOTE: no AFTER UPDATE trigger. Updates to content/preview are rare (only timestamp
// bumps via a separate statement), and an AFTER UPDATE trigger that re-inserts into
// the external-content FTS table errors with SQLITE_CORRUPT_VTAB ('database disk image
// is malformed') on this build. Rebuild-on-write isn't needed since content is immutable.

// --- One-shot optimization pass (VACUUM, orphan cleanup, backfill FTS) ---
const optimizedFlag = path.join(DATA_DIR, '.optimized_v1')
if (!fs.existsSync(optimizedFlag)) {
  try {
    console.log('Running one-shot DB optimization (FTS rebuild, orphan cleanup)...')

    // 1. Rebuild the FTS index from scratch to guarantee it reflects all rows.
    // (External-content FTS doesn't auto-populate for rows that existed before
    // the fts table was created, and the rebuild is the supported way to backfill.)
    db.exec('INSERT INTO clipboard_history_fts(clipboard_history_fts) VALUES(\'rebuild\')')

    // 2. Null out the legacy preview_base64 column (no longer used) to reclaim space.
    // Do this AFTER removing the AFTER UPDATE trigger (above), so the fts table
    // isn't touched by the update — re-inserting into external-content FTS errors
    // with SQLITE_CORRUPT_VTAB on this build.
    db.exec('UPDATE clipboard_history SET preview_base64 = NULL')

    // 3. Orphan image file cleanup: delete on-disk image/thumb files with no DB row.
    const referenced = new Set()
    const rows = db.prepare("SELECT content, thumbnail_path FROM clipboard_history WHERE data_type = 'IMAGE'").all()
    for (const r of rows) {
      if (r.content) referenced.add(path.basename(r.content))
      if (r.thumbnail_path) referenced.add(path.basename(r.thumbnail_path))
    }
    let orphans = 0
    for (const dir of [IMAGES_DIR, THUMBS_DIR]) {
      if (!fs.existsSync(dir)) continue
      for (const file of fs.readdirSync(dir)) {
        if (!referenced.has(file)) {
          try { fs.removeSync(path.join(dir, file)); orphans++ } catch {}
        }
      }
    }
    if (orphans > 0) console.log(`Removed ${orphans} orphan image files.`)

    fs.writeFileSync(optimizedFlag, 'done')
    console.log('DB optimization complete.')
  } catch (err) {
    console.error('One-shot DB optimization failed:', err)
  }
}

// --- Precompiled statements (module scope, prepared once) ---
const stmtGetIdByHash = db.prepare('SELECT id FROM clipboard_history WHERE content_hash = ?')
const stmtBumpTimestamp = db.prepare('UPDATE clipboard_history SET timestamp = CURRENT_TIMESTAMP WHERE id = ?')
const stmtInsert = db.prepare(`
  INSERT INTO clipboard_history (data_type, content, preview, thumbnail_path, content_hash)
  VALUES (?, ?, ?, ?, ?)
`)
const stmtGetById = db.prepare('SELECT id, data_type, content, thumbnail_path FROM clipboard_history WHERE id = ?')
const stmtToggleFavorite = db.prepare('UPDATE clipboard_history SET is_favorite = NOT is_favorite WHERE id = ?')
const stmtDeleteEntry = db.prepare('DELETE FROM clipboard_history WHERE id = ?')

const stmtGetHistoryBase = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)
const stmtGetHistoryFiltered = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE data_type = ?
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)
const stmtGetHistoryFav = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE is_favorite = 1
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)
const stmtSearchAll = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE id IN (SELECT rowid FROM clipboard_history_fts WHERE clipboard_history_fts MATCH ?)
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)
const stmtSearchFiltered = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE data_type = ? AND id IN (SELECT rowid FROM clipboard_history_fts WHERE clipboard_history_fts MATCH ?)
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)
const stmtSearchFav = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE is_favorite = 1 AND id IN (SELECT rowid FROM clipboard_history_fts WHERE clipboard_history_fts MATCH ?)
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)

export function closeDb() {
  try { db.close() } catch { /* already closed */ }
}

// Fold WAL frames back into the db without blocking writers. Called on a timer
// from main to bound WAL growth (the 1s clipboard poll writes continuously).
export function checkpoint() {
  try { db.pragma('wal_checkpoint(PASSIVE)') } catch { /* ignore */ }
}

export default {
  getByHash(content_hash) {
    if (content_hash == null) return null
    return stmtGetIdByHash.get(content_hash)
  },

  getById(id) {
    return stmtGetById.get(id)
  },

  updateTimestamp(id) {
    stmtBumpTimestamp.run(id)
  },

  addEntry(data_type, content, content_hash, preview, thumbnail_path) {
    try {
      const existing = stmtGetIdByHash.get(content_hash)
      if (existing) {
        stmtBumpTimestamp.run(existing.id)
        return existing.id
      }
      const info = stmtInsert.run(data_type, content, preview, thumbnail_path, content_hash)
      return info.lastInsertRowid
    } catch (err) {
      console.error('DB Add Entry Error:', err)
      return null
    }
  },

  getHistory(filter, query, limit = 50, offset = 0) {
    try {
      // FTS5 MATCH query — sanitize: wrap terms, strip operators that break it.
      const hasQuery = typeof query === 'string' && query.trim().length > 0
      const isFav = filter === 'Favorites'
      const isType = filter === 'TEXT' || filter === 'IMAGE' || filter === 'FILES'

      if (hasQuery) {
        // Build a safe MATCH expression: "term1" "term2" ... (phrase per token)
        const tokens = query.trim().split(/\s+/).filter(Boolean)
        const matchExpr = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' ')
        if (isFav) return stmtSearchFav.all(matchExpr, limit, offset)
        if (isType) return stmtSearchFiltered.all(filter, matchExpr, limit, offset)
        return stmtSearchAll.all(matchExpr, limit, offset)
      }

      if (isFav) return stmtGetHistoryFav.all(limit, offset)
      if (isType) return stmtGetHistoryFiltered.all(filter, limit, offset)
      return stmtGetHistoryBase.all(limit, offset)
    } catch (err) {
      console.error('DB Get History Error:', err)
      return []
    }
  },

  toggleFavorite(id) {
    try { stmtToggleFavorite.run(id) } catch (err) { console.error('DB Toggle Favorite Error:', err) }
  },

  deleteEntry(id) {
    try { stmtDeleteEntry.run(id) } catch (err) { console.error('DB Delete Entry Error:', err) }
  }
}
