const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Python RPC relay
  pyCall: (method, params) => ipcRenderer.invoke('py:call', method, params),

  // File dialogs (must run in main process)
  openFileDialog: () => ipcRenderer.invoke('pdf:open-dialog'),
  saveFileDialog: (defaultPath) => ipcRenderer.invoke('pdf:save-dialog', defaultPath),

  // File reading (renderer has no Node access)
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),

  // Window title
  setTitle: (title) => ipcRenderer.invoke('app:set-title', title),

  // Open URL in system browser (for MetaMask ethereum: URI etc.)
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Open URL in an in-app Electron browser window
  openBrowser: (url, title) => ipcRenderer.invoke('browser:open', url, title),

  // Generate QR code data URL (done in main process to avoid CJS/ESM issues)
  generateQR: (text) => ipcRenderer.invoke('qr:generate', text),
})
