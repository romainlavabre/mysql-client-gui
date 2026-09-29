// Electron entry point: window, IPC registration and services.
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } from 'electron'
import { API_METHODS, type Api, type ApiEvents } from '@shared/api'
import { SecretStore, createCipher } from './secrets'
import { WorkspaceManager } from './workspace/manager'
import { SessionManager } from './db/session'
import { HistoryStore } from './history'
import { JobRunner } from './db/io'
import { createHandlers } from './ipc/handlers'
import { schemas } from './ipc/schemas'

// Keeps the data folder name stable (~/.config/mysql-client-gui) whatever the product name.
app.setName('mysql-client-gui')
if (process.env.MYSQL_CLIENT_GUI_DATA_DIR) app.setPath('userData', process.env.MYSQL_CLIENT_GUI_DATA_DIR)

let mainWindow: BrowserWindow | null = null

function send<E extends keyof ApiEvents>(event: E, payload: ApiEvents[E]): void {
  mainWindow?.webContents.send(event, payload)
}

function secretsEncrypted(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  // On Linux without a keyring, Electron falls back to a hard-coded key.
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MySQL Client GUI',
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // Links open in the browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isTrustedSender(frameUrl: string | undefined): boolean {
  if (!frameUrl) return false
  if (frameUrl.startsWith('file://')) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  return !app.isPackaged && !!devUrl && frameUrl.startsWith(devUrl)
}

function registerIpc(api: Api): void {
  for (const domain of Object.keys(API_METHODS) as (keyof Api)[]) {
    for (const method of API_METHODS[domain]) {
      const channel = `${domain}:${String(method)}`
      const schema = (schemas[domain] as Record<string, import('zod').ZodType>)[method as string]
      const handler = (api[domain] as unknown as Record<string, (arg: unknown) => Promise<unknown>>)[method as string]
      ipcMain.handle(channel, async (event, arg: unknown) => {
        if (!isTrustedSender(event.senderFrame?.url)) throw new Error('Untrusted sender')
        const parsed = schema.safeParse(arg)
        if (!parsed.success) {
          throw new Error(`Invalid request for ${channel}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
        }
        return handler(parsed.data)
      })
    }
  }
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  const dataDir = app.getPath('userData')
  const secrets = new SecretStore(join(dataDir, 'secrets.json'), createCipher(safeStorage, join(dataDir, 'secrets.key')))
  const workspace = new WorkspaceManager(join(dataDir, 'workspaces.json'), join(dataDir, 'workspaces'), secrets, {
    status: (status) => send('workspace:status', status),
    changed: (state) => send('workspace:changed', state)
  })
  const sessions = new SessionManager(dataDir)
  const history = new HistoryStore(join(dataDir, 'history.json'))
  const jobs = new JobRunner((progress) => send('job:progress', progress))

  registerIpc(
    createHandlers({
      dataDir,
      workspace,
      sessions,
      history,
      jobs,
      window: () => mainWindow,
      secretsEncrypted
    })
  )
  createWindow()

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    // Push pending workspace changes and close database connections before leaving.
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000))
    void Promise.race([Promise.all([workspace.flush(), sessions.closeAll()]), timeout]).finally(() => app.quit())
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
