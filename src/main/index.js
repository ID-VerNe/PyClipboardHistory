import { app, shell, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, screen, nativeImage, protocol } from 'electron'
import { join, normalize, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import db, { closeDb, DATA_DIR, IMAGES_DIR, THUMBS_DIR } from './db'
import crypto from 'crypto'
import fs from 'fs-extra'
import { Worker } from 'worker_threads'

let nextRequestId = 0

// Single instance lock — avoid multiple pollers / workers / SQLite writers.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) showWindow()
})

// local-file protocol must be registered before ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow
let tray
let imageWorker = null
let clipboardInterval

// --- Image worker: shared message handler, O(1) dispatch by request id ---
const pendingRequests = new Map()

function getImageWorker() {
  if (imageWorker) return imageWorker
  const workerPath = join(__dirname, 'imageWorker.js')
  imageWorker = new Worker(workerPath)
  imageWorker.on('message', (msg) => {
    const req = pendingRequests.get(msg.id)
    if (!req) return
    pendingRequests.delete(msg.id)
    clearTimeout(req.timeout)
    if (msg.success) req.resolve({ hash: msg.hash, imgPath: msg.imgPath, thumbPath: msg.thumbPath })
    else req.reject(new Error(msg.error))
  })
  imageWorker.on('error', (err) => {
    console.error('Image Worker Error:', err)
    // Reject all pending with the same error.
    for (const req of pendingRequests.values()) {
      clearTimeout(req.timeout)
      req.reject(err)
    }
    pendingRequests.clear()
  })
  return imageWorker
}

function processImage(bitmap, width, height, imgPath, thumbPath) {
  const worker = getImageWorker()
  const requestId = nextRequestId++
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Image worker timeout'))
    }, 30000)
    pendingRequests.set(requestId, { resolve, reject, timeout })
    // Transfer the underlying ArrayBuffer to avoid a structured-clone copy.
    worker.postMessage({ id: requestId, bitmap, width, height, imgPath, thumbPath }, [bitmap.buffer])
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('blur', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide() })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function notifyHistoryUpdated(entry) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.webContents.send('history-updated', entry)
  }
}

function showWindow() {
  if (!mainWindow) return
  const { x, y } = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint({ x, y })
  let winX = x - 210
  let winY = y
  if (winX < display.bounds.x) winX = display.bounds.x
  if (winX + 420 > display.bounds.x + display.bounds.width) winX = display.bounds.x + display.bounds.width - 420
  if (winY + 800 > display.bounds.y + display.bounds.height) winY = display.bounds.y + display.bounds.height - 800
  mainWindow.setPosition(Math.floor(winX), Math.floor(winY))
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('window-shown')
}

function createTray() {
  const trayIconPath = join(app.getAppPath(), 'resources', 'icon.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setToolTip('Clipboard History')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => showWindow())
}

// --- Clipboard Monitoring ---
let lastImageInfo = { width: 0, height: 0, byteLength: 0 }
let lastTextHash = ''

async function checkClipboard() {
  try {
    const formats = clipboard.availableFormats()
    const hasImage = formats.includes('image/png') || formats.includes('image/bmp') || formats.includes('image/jpeg')

    if (hasImage) {
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const size = image.getSize()

        // Cheap fast-path: if dimensions match the last image, skip the heavy bitmap entirely.
        if (size.width === lastImageInfo.width && size.height === lastImageInfo.height) {
          return
        }

        const bitmap = image.getBitmap()
        if (!bitmap || bitmap.length === 0) return

        if (bitmap.length === lastImageInfo.byteLength &&
            size.width === lastImageInfo.width &&
            size.height === lastImageInfo.height) {
          return
        }
        lastImageInfo = { width: size.width, height: size.height, byteLength: bitmap.length }

        const timestamp = Date.now()
        const imgPath = join(IMAGES_DIR, `img_${timestamp}.png`)
        const thumbPath = join(THUMBS_DIR, `thumb_${timestamp}.webp`)

        // PNG encode + hash + thumbnails happen in the worker; main thread stays free.
        const result = await processImage(bitmap, size.width, size.height, imgPath, thumbPath)
        const existing = db.getByHash(result.hash)
        if (existing) {
          db.updateTimestamp(existing.id)
          // Remove the just-written files — this content already has its own on disk.
          try { await fs.remove(result.imgPath) } catch {}
          try { await fs.remove(result.thumbPath) } catch {}
          const entry = db.getById(existing.id)
          notifyHistoryUpdated(entry)
          return
        }

        const newId = db.addEntry('IMAGE', result.imgPath, result.hash, '[Image]', result.thumbPath)
        const entry = db.getById(newId)
        notifyHistoryUpdated(entry)
        return
      }
    }

    const text = clipboard.readText()
    if (text) {
      const hash = crypto.createHash('md5').update(text).digest('hex')
      if (hash === lastTextHash) return
      lastTextHash = hash

      const existing = db.getByHash(hash)
      if (existing) {
        db.updateTimestamp(existing.id)
        const entry = db.getById(existing.id)
        notifyHistoryUpdated(entry)
        return
      }

      const newId = db.addEntry('TEXT', text, hash, text.substring(0, 200))
      const entry = db.getById(newId)
      notifyHistoryUpdated(entry)
    }
  } catch (err) {
    console.error('CRITICAL: checkClipboard Error:', err)
  }
}

// --- local-file protocol with byte-bounded LRU cache ---
const imageCache = new Map()
const MAX_CACHE_BYTES = 50 * 1024 * 1024
let cacheBytes = 0

app.whenReady().then(() => {
  protocol.handle('local-file', async (request) => {
    try {
      const cacheKey = request.url
      if (imageCache.has(cacheKey)) {
        const buf = imageCache.get(cacheKey)
        // Move to end (most-recent).
        imageCache.delete(cacheKey)
        imageCache.set(cacheKey, buf)
        return new Response(buf)
      }

      const url = new URL(request.url)
      let fullPath = decodeURIComponent(url.pathname)
      if (process.platform === 'win32' && fullPath.startsWith('/') && fullPath.charAt(2) === ':') {
        fullPath = fullPath.slice(1)
      }
      const normalizedPath = normalize(fullPath)
      const resolvedPath = resolve(normalizedPath)
      const resolvedImagesDir = resolve(IMAGES_DIR)
      if (!resolvedPath.startsWith(resolvedImagesDir)) {
        console.error('Blocked local-file access outside images dir:', normalizedPath)
        return new Response('Forbidden', { status: 403 })
      }
      const buffer = await fs.readFile(resolvedPath)

      // Evict by bytes (FIFO) until we can fit this entry.
      while (cacheBytes + buffer.length > MAX_CACHE_BYTES && imageCache.size > 0) {
        const firstKey = imageCache.keys().next().value
        const old = imageCache.get(firstKey)
        imageCache.delete(firstKey)
        cacheBytes -= old.length
      }
      imageCache.set(cacheKey, buffer)
      cacheBytes += buffer.length
      return new Response(buffer)
    } catch (err) {
      return new Response('Error', { status: 500 })
    }
  })

  electronApp.setAppUserModelId('com.gemini.clipboard')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  createWindow()
  createTray()

  globalShortcut.register('CommandOrControl+Alt+V', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) mainWindow.hide()
    else showWindow()
  })

  clipboardInterval = setInterval(checkClipboard, 1000)

  ipcMain.handle('get-history', (_, filter, query, limit, offset) => db.getHistory(filter, query, limit, offset))
  ipcMain.handle('toggle-favorite', (_, id) => db.toggleFavorite(id))
  ipcMain.handle('delete-entry', async (_, id) => {
    const entry = db.getById(id)
    if (entry && entry.data_type === 'IMAGE') {
      if (entry.content) { try { await fs.remove(entry.content) } catch {} }
      if (entry.thumbnail_path) { try { await fs.remove(entry.thumbnail_path) } catch {} }
    }
    db.deleteEntry(id)
  })
  ipcMain.handle('paste-item', async (_, content, type) => {
    if (type === 'IMAGE') {
      const resolvedPath = resolve(content)
      const resolvedImagesDir = resolve(IMAGES_DIR)
      if (!resolvedPath.startsWith(resolvedImagesDir)) {
        console.error('Blocked path traversal attempt:', content)
        return
      }
      const buffer = await fs.readFile(resolvedPath)
      clipboard.writeImage(nativeImage.createFromBuffer(buffer))
    } else {
      clipboard.writeText(content)
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Async cleanup: clear interval, unregister shortcuts, close DB, destroy tray, terminate worker.
app.on('will-quit', (event) => {
  event.preventDefault()
  clearInterval(clipboardInterval)
  globalShortcut.unregisterAll()
  closeDb()
  tray?.destroy()
  const finalize = () => app.exit(0)
  if (imageWorker) {
    imageWorker.terminate().then(finalize).catch(finalize)
  } else {
    finalize()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
