const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')

// Graceful fallback for environments without GPU acceleration
app.commandLine.appendSwitch('disable-gpu-sandbox')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let win = null
let pyProc = null
let pendingRpc = new Map()
let rpcIdCounter = 0
let lineBuffer = ''

function appRoot() {
  // Packaged: python/ is shipped under process.resourcesPath (see electron-builder extraResources)
  if (app.isPackaged) return process.resourcesPath
  return __dirname
}

// ─── Python subprocess ───────────────────────────────────────────────────────

function startPython() {
  const root = appRoot()
  const pythonBin = path.join(root, 'python', 'venv', 'bin', 'python3')
  const serverScript = path.join(root, 'python', 'pdf_server.py')

  pyProc = spawn(pythonBin, [serverScript], {
    stdio: ['pipe', 'pipe', 'inherit'], // inherit stderr → terminal
    cwd: root,
  })

  pyProc.stdout.on('data', (chunk) => {
    lineBuffer += chunk.toString()
    let nl
    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, nl).trim()
      lineBuffer = lineBuffer.slice(nl + 1)
      if (!line) continue
      try {
        const resp = JSON.parse(line)
        const pending = pendingRpc.get(resp.id)
        if (pending) {
          pendingRpc.delete(resp.id)
          if (resp.error) pending.reject(new Error(resp.error.message))
          else pending.resolve(resp.result)
        }
      } catch (e) {
        console.error('Failed to parse Python response:', line, e)
      }
    }
  })

  pyProc.on('exit', (code) => {
    console.error(`Python process exited with code ${code}`)
    // Reject all pending promises
    for (const [id, p] of pendingRpc) {
      p.reject(new Error('Python process exited unexpectedly'))
    }
    pendingRpc.clear()
    if (win) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Backend Error',
        message: `PDF server exited (code ${code}). Please restart the application.`,
      })
    }
  })
}

function callPython(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++rpcIdCounter
    pendingRpc.set(id, { resolve, reject })
    const msg = JSON.stringify({ id, method, params }) + '\n'
    pyProc.stdin.write(msg)
  })
}

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    title: 'PDF Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Ctrl+Shift+I toggles DevTools
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      win.webContents.toggleDevTools()
    }
  })

  win.on('closed', () => {
    win = null
    if (pyProc) {
      pyProc.stdin.end()
      pyProc.kill()
    }
  })
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('py:call', (_event, method, params) => {
  return callPython(method, params)
})

ipcMain.handle('pdf:open-dialog', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open PDF',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('pdf:save-dialog', async (_event, defaultPath) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Save PDF',
    defaultPath: defaultPath || undefined,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
})

ipcMain.handle('file:read', (_event, filePath) => {
  // Returns Buffer (serialized as Uint8Array in renderer)
  return fs.readFileSync(filePath)
})

ipcMain.handle('app:set-title', (_event, title) => {
  if (win) win.setTitle(title)
})

ipcMain.handle('shell:open-external', (_event, url) => {
  shell.openExternal(url)
})

ipcMain.handle('browser:open', (_event, url, title) => {
  const browserWin = new BrowserWindow({
    width: 1000,
    height: 700,
    title: title || url,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  browserWin.loadURL(url)
  // Show a basic navigation bar via the title
  browserWin.webContents.on('did-navigate', (_, navUrl) => {
    browserWin.setTitle(navUrl)
  })
})

const QRCode = require('qrcode')
ipcMain.handle('qr:generate', async (_event, text) => {
  return QRCode.toDataURL(text, { width: 160, margin: 1, color: { dark: '#000', light: '#fff' } })
})

// ─── Application menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('menu:open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => win.webContents.send('menu:save-as') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => win.webContents.send('menu:undo') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => win.webContents.send('menu:zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => win.webContents.send('menu:zoom-out') },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => win.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'Keyboard Shortcuts',
              message: 'Stellar PDF — Keyboard Shortcuts',
              detail: [
                'FILE',
                '  Ctrl+O          Open PDF',
                '  Ctrl+S          Save',
                '  Ctrl+Shift+S    Save As',
                '',
                'EDIT',
                '  Ctrl+Z          Undo last change',
                '',
                'NAVIGATION',
                '  ← / →           Previous / Next page',
                '  Ctrl+= / Ctrl+-  Zoom in / out',
                '',
                'TOOLS',
                '  Select tool     Pan and scroll',
                '  Fill tool       Fill AcroForm fields',
                '  Redact tool     Draw redaction boxes, then Apply',
                '  Text tool       Click to insert text (snaps to baseline)',
                '',
                'DEV',
                '  Ctrl+Shift+I    Toggle DevTools',
              ].join('\n'),
              buttons: ['OK'],
            })
          },
        },
        {
          label: 'About Stellar PDF',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About Stellar PDF',
              message: 'Stellar PDF',
              detail: `Version ${app.getVersion()}\n\nA beautiful open-source PDF editor for Linux.\nFill forms, redact content, insert text.\n\nhttps://github.com/BeeGrech/stellarPdf`,
              buttons: ['OK'],
            })
          },
        },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: () => shell.openExternal('https://github.com/BeeGrech/stellarPdf'),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/BeeGrech/stellarPdf/issues'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  startPython()
  buildMenu()
  createWindow()
})

app.on('window-all-closed', () => {
  if (pyProc) {
    pyProc.stdin.end()
    pyProc.kill()
  }
  app.quit()
})
