import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import { pinyin as toPinyin } from 'pinyin-pro'

// CJK Unified Ideographs range. Used to decide whether a row needs pinyin columns.
const CJK_RE = /[一-鿿]/

// Toneless, space-joined pinyin options shared by the full-pinyin and initials columns.
const PINYIN_OPTS = { toneType: 'none', type: 'array', v: true, nonZh: 'consecutive' }

// Compute the two derived search columns for a content string. Returns
// { content_pinyin, content_initials }, both null when the text has no CJK
// (pinyin matching is only meaningful for Chinese text).
function derivePinyinColumns(content) {
  if (!content || typeof content !== 'string' || !CJK_RE.test(content)) {
    return { content_pinyin: null, content_initials: null }
  }
  const syllables = toPinyin(content, PINYIN_OPTS)
  const content_pinyin = syllables.join('')
  // First letters of each syllable; non-CJK runs keep their own first char via
  // nonZh:'consecutive' so mixed text (e.g. "hello你好") still produces sensible
  // initials.
  const content_initials = syllables.map(s => s.charAt(0)).join('')
  return { content_pinyin, content_initials }
}

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

// Derived pinyin search columns: full toneless pinyin (nihaoshijie) and first
// letters (nhsj). Populated only for rows whose content contains CJK — pinyin
// matching is meaningless for ASCII-only text, which the trigram index on the
// raw content column already covers.


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
// Derived pinyin search columns, added alongside the other schema alignment.
if (!colNames.includes('content_pinyin')) {
  try { db.exec('ALTER TABLE clipboard_history ADD COLUMN content_pinyin TEXT') } catch (err) { console.warn('add content_pinyin failed:', err) }
}
if (!colNames.includes('content_initials')) {
  try { db.exec('ALTER TABLE clipboard_history ADD COLUMN content_initials TEXT') } catch (err) { console.warn('add content_initials failed:', err) }
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

// --- FTS5 trigram substring index on content + preview + pinyin columns ---
// External-content FTS5 with the trigram tokenizer. trigram makes LIKE '%x%'
// substring queries index-accelerated for >=3-char patterns (and degrades
// gracefully to a scan for shorter ones, which is fine at this row count).
// We query via per-column LIKE rather than MATCH: MATCH's substring semantics
// break for CJK patterns shorter than 3 characters (e.g. "欢迎" MATCHes nothing),
// whereas LIKE returns the same rows as a plain full-table LIKE would — verified
// to match 1:1 against the non-indexed baseline.
db.exec(`
  DROP TRIGGER IF EXISTS clipboard_history_ai;
  DROP TRIGGER IF EXISTS clipboard_history_ad;
  DROP TABLE IF EXISTS clipboard_history_fts;
  CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_history_fts USING fts5(
    content, preview, content_pinyin, content_initials,
    content='clipboard_history', content_rowid=id, tokenize='trigram'
  );
  CREATE TRIGGER IF NOT EXISTS clipboard_history_ai AFTER INSERT ON clipboard_history BEGIN
    INSERT INTO clipboard_history_fts(rowid, content, preview, content_pinyin, content_initials)
    VALUES (new.id, new.content, new.preview, new.content_pinyin, new.content_initials);
  END;
  CREATE TRIGGER IF NOT EXISTS clipboard_history_ad AFTER DELETE ON clipboard_history BEGIN
    INSERT INTO clipboard_history_fts(clipboard_history_fts, rowid, content, preview, content_pinyin, content_initials)
    VALUES ('delete', old.id, old.content, old.preview, old.content_pinyin, old.content_initials);
  END;
`)
// NOTE: no AFTER UPDATE trigger. content/preview/content_pinyin/content_initials
// are immutable (only the timestamp is bumped on re-copy), so there is nothing
// to re-index. An AFTER UPDATE trigger that re-inserts into external-content
// FTS errors with SQLITE_CORRUPT_VTAB on this build anyway (see history).

// --- One-shot optimization pass (orphan cleanup, null legacy column) ---
const optimizedFlag = path.join(DATA_DIR, '.optimized_v1')
if (!fs.existsSync(optimizedFlag)) {
  try {
    console.log('Running one-shot DB optimization (orphan cleanup)...')

    // Null out the legacy preview_base64 column (no longer used) to reclaim space.
    // content/preview/content_pinyin are immutable, so no FTS re-index is needed.
    db.exec('UPDATE clipboard_history SET preview_base64 = NULL')

    // Orphan image file cleanup: delete on-disk image/thumb files with no DB row.
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

// --- Trigram FTS index population ---
// External-content FTS5 with the trigram tokenizer. The index is populated by
// dropping and recreating the fts table, then bulk-inserting all rows. This is
// the only path verified on this build (better-sqlite3 9.6.0 / SQLite 3.45.3)
// that reliably builds the full inverted index for ALL rows:
//   - 'rebuild' leaves the _idx shadow table nearly empty (content readable,
//     but MATCH/LIKE return almost nothing) — observed in production.
//   - DELETE+INSERT on a table that is already in the broken state throws
//     SQLITE_CORRUPT_VTAB; INSERT-on-top does not build the index either.
// drop+recreate sidesteps both: it discards the corrupt shadow tables and
// rebuilds the inverted index from scratch, fully populated.
function populateFtsIndex() {
  db.exec(`
    DROP TRIGGER IF EXISTS clipboard_history_ai;
    DROP TRIGGER IF EXISTS clipboard_history_ad;
    DROP TABLE IF EXISTS clipboard_history_fts;
    CREATE VIRTUAL TABLE clipboard_history_fts USING fts5(
      content, preview, content_pinyin, content_initials,
      content='clipboard_history', content_rowid=id, tokenize='trigram'
    );
    CREATE TRIGGER clipboard_history_ai AFTER INSERT ON clipboard_history BEGIN
      INSERT INTO clipboard_history_fts(rowid, content, preview, content_pinyin, content_initials)
      VALUES (new.id, new.content, new.preview, new.content_pinyin, new.content_initials);
    END;
    CREATE TRIGGER clipboard_history_ad AFTER DELETE ON clipboard_history BEGIN
      INSERT INTO clipboard_history_fts(clipboard_history_fts, rowid, content, preview, content_pinyin, content_initials)
      VALUES ('delete', old.id, old.content, old.preview, old.content_pinyin, old.content_initials);
    END;
    INSERT INTO clipboard_history_fts(rowid, content, preview, content_pinyin, content_initials)
    SELECT id, content, preview, content_pinyin, content_initials FROM clipboard_history;
  `)
}

// Health self-check: if the inverted index has far fewer entries than the base
// table, it is corrupt (the known rebuild bug, or a half-written migration).
// Returns true when the index needs rebuilding.
function isFtsIndexCorrupt() {
  const baseCount = db.prepare('SELECT COUNT(*) c FROM clipboard_history').get().c
  if (baseCount === 0) return false
  const idxCount = db.prepare('SELECT COUNT(*) c FROM clipboard_history_fts_idx').get().c
  // _idx holds one row per segment of the inverted index; a healthy table has
  // roughly baseCount rows here. Treat <50% as corrupt (covers the observed
  // failure where 1000+ rows produced only 5 _idx rows).
  return idxCount < baseCount * 0.5
}

// --- One-shot search-v2 backfill: pinyin columns + trigram index ---
// Runs once after the trigram FTS table is in place. Backfills content_pinyin /
// content_initials for TEXT rows containing CJK, then populates the FTS index.
const searchV2Flag = path.join(DATA_DIR, '.search_v2')
if (!fs.existsSync(searchV2Flag)) {
  try {
    console.log('Running one-shot search-v2 backfill (pinyin columns, trigram index)...')

    const rows = db.prepare("SELECT id, content FROM clipboard_history WHERE data_type = 'TEXT'").all()
    const upd = db.prepare('UPDATE clipboard_history SET content_pinyin = ?, content_initials = ? WHERE id = ?')
    let filled = 0
    const backfill = db.transaction(() => {
      for (const r of rows) {
        const { content_pinyin, content_initials } = derivePinyinColumns(r.content)
        if (content_pinyin) {
          upd.run(content_pinyin, content_initials, r.id)
          filled++
        }
      }
    })
    backfill()
    console.log(`Backfilled pinyin for ${filled} of ${rows.length} TEXT rows.`)

    populateFtsIndex()

    fs.writeFileSync(searchV2Flag, 'done')
    console.log('Search-v2 backfill complete.')
  } catch (err) {
    console.error('Search-v2 backfill failed:', err)
  }
}

// --- Index health check on every boot ---
// Catches a corrupt/incomplete trigram index (the rebuild bug left _idx nearly
// empty) and self-heals by drop+recreating. Cheap: two COUNT(*) queries; the
// repopulation only runs when corruption is detected.
if (isFtsIndexCorrupt()) {
  try {
    console.warn('Trigram FTS index corrupt/incomplete — rebuilding.')
    populateFtsIndex()
    console.log('FTS index rebuilt.')
  } catch (err) {
    console.error('FTS index rebuild failed:', err)
  }
}

// --- Precompiled statements (module scope, prepared once) ---
const stmtGetIdByHash = db.prepare('SELECT id FROM clipboard_history WHERE content_hash = ?')
const stmtBumpTimestamp = db.prepare('UPDATE clipboard_history SET timestamp = CURRENT_TIMESTAMP WHERE id = ?')
const stmtInsert = db.prepare(`
  INSERT INTO clipboard_history (data_type, content, preview, thumbnail_path, content_hash, content_pinyin, content_initials)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const stmtGetById = db.prepare('SELECT id, data_type, content, preview, thumbnail_path FROM clipboard_history WHERE id = ?')
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
// --- Search statements ---
// Each filter variant gets its own prepared statement. The query is a single
// substring token applied as LIKE '%token%' across the four indexed columns
// (raw content, preview, full pinyin, pinyin initials). The UNION lets each
// column's LIKE use the trigram index independently (plan shows L0..L3).
// Multi-token queries are treated as a single phrase joined with the first
// whitespace token — substring search across the whole typed string.
const SEARCH_COLUMNS = `
  SELECT rowid FROM clipboard_history_fts WHERE content LIKE ?
  UNION
  SELECT rowid FROM clipboard_history_fts WHERE preview LIKE ?
  UNION
  SELECT rowid FROM clipboard_history_fts WHERE content_pinyin LIKE ?
  UNION
  SELECT rowid FROM clipboard_history_fts WHERE content_initials LIKE ?
`

const stmtSearchAll = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE id IN (${SEARCH_COLUMNS})
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)
const stmtSearchFiltered = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE data_type = ? AND id IN (${SEARCH_COLUMNS})
  ORDER BY timestamp DESC
  LIMIT ? OFFSET ?
`)
const stmtSearchFav = db.prepare(`
  SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite
  FROM clipboard_history
  WHERE is_favorite = 1 AND id IN (${SEARCH_COLUMNS})
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

// --- Typo-tolerant fallback search (fuse.js) ---
// Layer 2: only invoked by the renderer when the SQL substring search returns
// few/no results, to catch typos (welocme->welcome, nihoa->你好) that trigram
// LIKE cannot. The index is built lazily over TEXT rows' {content, content_pinyin}
// and rebuilt when invalidated by an insert/delete. Rebuild is ~7-15ms for the
// current row count; search is ~50-80ms — acceptable as a debounced fallback,
// not as a per-keystroke path.
let fuzzyFuse = null
let fuzzyDirty = true
const stmtGetFuzzyRows = db.prepare(`
  SELECT id, content, content_pinyin FROM clipboard_history WHERE data_type = 'TEXT' ORDER BY timestamp DESC
`)

function invalidateFuzzyIndex() {
  fuzzyDirty = true
}

function ensureFuzzyIndex() {
  if (fuzzyFuse && !fuzzyDirty) return fuzzyFuse
  const Fuse = require('fuse.js').default || require('fuse.js')
  const rows = stmtGetFuzzyRows.all().map(r => ({ id: r.id, content: r.content, pinyin: r.content_pinyin || '' }))
  fuzzyFuse = new Fuse(rows, {
    keys: ['content', 'pinyin'],
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 1,
    includeScore: false,
    limit: 100
  })
  fuzzyDirty = false
  return fuzzyFuse
}

function fuzzySearch(query, limit = 50) {
  if (!query || !query.trim()) return []
  try {
    const fuse = ensureFuzzyIndex()
    const results = fuse.search(query.trim(), { limit })
    const ids = results.map(r => r.item.id)
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(`SELECT id, timestamp, data_type, content, preview, thumbnail_path, is_favorite FROM clipboard_history WHERE id IN (${placeholders}) ORDER BY timestamp DESC`).all(...ids)
    return rows
  } catch (err) {
    console.error('Fuzzy search error:', err)
    return []
  }
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
      const { content_pinyin, content_initials } = derivePinyinColumns(content)
      const info = stmtInsert.run(
        data_type, content, preview, thumbnail_path, content_hash, content_pinyin, content_initials
      )
      invalidateFuzzyIndex()
      return info.lastInsertRowid
    } catch (err) {
      console.error('DB Add Entry Error:', err)
      return null
    }
  },

  getHistory(filter, query, limit = 50, offset = 0) {
    try {
      const hasQuery = typeof query === 'string' && query.trim().length > 0
      const isFav = filter === 'Favorites'
      const isType = filter === 'TEXT' || filter === 'IMAGE' || filter === 'FILES'

      if (hasQuery) {
        // Take the typed string as a single substring (leading/trailing
        // whitespace already trimmed). Multi-word queries match the whole run.
        const token = query.trim()
        const like = `%${token}%`
        if (isFav) return stmtSearchFav.all(like, like, like, like, limit, offset)
        if (isType) return stmtSearchFiltered.all(filter, like, like, like, like, limit, offset)
        return stmtSearchAll.all(like, like, like, like, limit, offset)
      }

      if (isFav) return stmtGetHistoryFav.all(limit, offset)
      if (isType) return stmtGetHistoryFiltered.all(filter, limit, offset)
      return stmtGetHistoryBase.all(limit, offset)
    } catch (err) {
      console.error('DB Get History Error:', err)
      return []
    }
  },

  fuzzySearch(query, limit = 50) {
    return fuzzySearch(query, limit)
  },

  toggleFavorite(id) {
    try { stmtToggleFavorite.run(id) } catch (err) { console.error('DB Toggle Favorite Error:', err) }
  },

  deleteEntry(id) {
    try {
      stmtDeleteEntry.run(id)
      invalidateFuzzyIndex()
    } catch (err) { console.error('DB Delete Entry Error:', err) }
  }
}
