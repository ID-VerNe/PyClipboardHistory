import { app, shell, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, screen, nativeImage, protocol, net, powerSaveBlocker } from 'electron'
import { join, dirname, normalize } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset' 
import db from './db'
import { classifyText } from './ai'
import crypto from 'crypto'
import fs from 'fs-extra'
import { pathToFileURL } from 'url'
import { Worker } from 'worker_threads'
import os from 'os'

// --- Performance & Memory Optimization ---
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

try {
  os.setPriority(os.constants.priority.PRIORITY_HIGH)
} catch (err) {
  console.warn('Could not set high process priority:', err)
}

app.whenReady().then(() => {
  powerSaveBlocker.start('prevent-app-suspension')
})

// --- Path Configuration ---
const getStorageRoot = () => {
  if (app.isPackaged) return dirname(app.getPath('exe'))
  return app.getAppPath()
}
const STORAGE_ROOT = getStorageRoot()
const DATA_DIR = join(STORAGE_ROOT, 'storage')
const IMAGES_DIR = join(DATA_DIR, 'images')
const THUMBS_DIR = join(IMAGES_DIR, 'thumbnails')
const SETTINGS_PATH = join(DATA_DIR, 'settings.json')

fs.ensureDirSync(THUMBS_DIR)

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let settings = { aiEnabled: false, aiApiKey: '', aiModel: 'gpt-4o-mini' }
try {
  if (fs.existsSync(SETTINGS_PATH)) settings = { ...settings, ...fs.readJsonSync(SETTINGS_PATH) }
} catch (err) {
  console.error('Failed to load settings:', err)
}

function saveSettings() { fs.writeJsonSync(SETTINGS_PATH, settings) }

let mainWindow
let tray

// --- Image Worker Initialization ---
const workerPath = join(__dirname, 'imageWorker.js')
const imageWorker = new Worker(workerPath)
imageWorker.on('error', (err) => console.error('Image Worker Error:', err))

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
      sandbox: false
    }
  })
  mainWindow.on('blur', () => mainWindow.hide())
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

function showWindow() {
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

// --- Clipboard Monitoring with Robust Error Handling ---
let lastImageInfo = { width: 0, height: 0, byteLength: 0 }
let lastTextHash = ''

function processImage(buffer, imgPath, thumbPath) {
  return new Promise((resolve, reject) => {
    const handler = (msg) => {
      if (msg.success) {
        imageWorker.off('message', handler)
        imageWorker.off('error', errorHandler)
        resolve(msg.base64)
      } else {
        imageWorker.off('message', handler)
        imageWorker.off('error', errorHandler)
        reject(new Error(msg.error))
      }
    }
    const errorHandler = (err) => {
      imageWorker.off('message', handler)
      imageWorker.off('error', errorHandler)
      reject(err)
    }
    imageWorker.on('message', handler)
    imageWorker.on('error', errorHandler)
    imageWorker.postMessage({ buffer, imgPath, thumbPath })
  })
}

async function checkClipboard() {
  try {
    const text = clipboard.readText()
    const image = clipboard.readImage()
    
    if (!image.isEmpty()) {
      const size = image.getSize()
      const bitmap = image.getBitmap()
      
      if (!bitmap || bitmap.length === 0) return // Safety check

      if (size.width === lastImageInfo.width && 
          size.height === lastImageInfo.height && 
          bitmap.length === lastImageInfo.byteLength) {
        return
      }
      lastImageInfo = { width: size.width, height: size.height, byteLength: bitmap.length }

      const bitmapHash = crypto.createHash('md5').update(bitmap).digest('hex')
      const existing = db.getByHash(bitmapHash)
      
      if (existing) {
        db.updateTimestamp(existing.id)
        if (mainWindow) mainWindow.webContents.send('history-updated')
        return
      }
      
      const buffer = image.toPNG()
      const timestamp = Date.now()
      const imgPath = join(IMAGES_DIR, `img_${timestamp}.png`)
      const thumbPath = join(THUMBS_DIR, `thumb_${timestamp}.png`)
      
      const base64 = await processImage(buffer, imgPath, thumbPath)
      db.addEntry('IMAGE', imgPath, bitmapHash, '[Image]', thumbPath, base64)
      if (mainWindow) mainWindow.webContents.send('history-updated')
      
    } else if (text) {
      const hash = crypto.createHash('md5').update(text).digest('hex')
      if (hash === lastTextHash) return
      lastTextHash = hash

      db.addEntry('TEXT', text, hash, text.substring(0, 200))
      
      if (settings.aiEnabled && settings.aiApiKey) {
        classifyText(text, settings.aiApiKey, 'OpenAI', settings.aiModel).then(tags => {
          if (tags && tags.length > 0) console.log(`Classified as: ${tags.join(', ')}`)
        }).catch(err => console.error('AI Classification Error:', err))
      }
      if (mainWindow) mainWindow.webContents.send('history-updated')
    }
  } catch (err) {
    console.error('CRITICAL: checkClipboard Error:', err)
  }
}

const imageCache = new Map()
const MAX_CACHE_SIZE = 100

app.whenReady().then(() => {
  protocol.handle('local-file', async (request) => {
    try {
      const cacheKey = request.url
      if (imageCache.has(cacheKey)) return new Response(imageCache.get(cacheKey))

      const url = new URL(request.url)
      let fullPath = decodeURIComponent(url.pathname)
      if (process.platform === 'win32' && fullPath.startsWith('/') && fullPath.charAt(2) === ':') {
        fullPath = fullPath.slice(1)
      }
      const normalizedPath = normalize(fullPath)
      const buffer = await fs.readFile(normalizedPath)
      
      if (imageCache.size >= MAX_CACHE_SIZE) {
        const firstKey = imageCache.keys().next().value
        imageCache.delete(firstKey)
      }
      imageCache.set(cacheKey, buffer)
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
    if (mainWindow.isVisible()) mainWindow.hide()
    else showWindow()
  })

  setInterval(checkClipboard, 1000)

  ipcMain.handle('get-history', (_, filter, query, limit, offset) => db.getHistory(filter, query, limit, offset))
  ipcMain.handle('toggle-favorite', (_, id) => db.toggleFavorite(id))
  ipcMain.handle('delete-entry', (_, id) => db.deleteEntry(id))
  ipcMain.handle('get-settings', () => settings)
  ipcMain.handle('save-settings', (_, newSettings) => {
    settings = { ...settings, ...newSettings }
    saveSettings()
    return settings
  })
  ipcMain.handle('paste-item', async (_, content, type) => {
    if (type === 'IMAGE') {
      const buffer = await fs.readFile(content)
      clipboard.writeImage(nativeImage.createFromBuffer(buffer))
    } else {
      clipboard.writeText(content)
    }
    mainWindow.hide()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
