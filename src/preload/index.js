import { contextBridge, ipcRenderer } from 'electron'
import { exposeElectronAPI } from '@electron-toolkit/preload'

const api = {
  getHistory: (filter, query, limit, offset) => ipcRenderer.invoke('get-history', filter, query, limit, offset),
  toggleFavorite: (id) => ipcRenderer.invoke('toggle-favorite', id),
  deleteEntry: (id) => ipcRenderer.invoke('delete-entry', id),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  pasteItem: (content, type) => {
    if (type !== 'IMAGE' && type !== 'TEXT') {
      console.warn('Invalid paste type:', type)
      return Promise.reject(new Error('Invalid paste type'))
    }
    return ipcRenderer.invoke('paste-item', content, type)
  },
  onHistoryUpdated: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('history-updated', listener)
    return () => ipcRenderer.removeListener('history-updated', listener)
  },
  onWindowShown: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('window-shown', listener)
    return () => ipcRenderer.removeListener('window-shown', listener)
  }
}

if (process.contextIsolated) {
  try {
    exposeElectronAPI()
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
