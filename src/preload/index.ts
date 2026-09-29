// Exposes the typed IPC bridge to the renderer as `window.bridge`.
import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type Api, type ApiEvents, type Bridge } from '../shared/api'

const api = Object.fromEntries(
  Object.entries(API_METHODS).map(([domain, methods]) => [
    domain,
    Object.fromEntries(
      (methods as string[]).map((method) => [method, (arg?: unknown) => ipcRenderer.invoke(`${domain}:${method}`, arg)])
    )
  ])
) as unknown as Api

const EVENTS: (keyof ApiEvents)[] = ['workspace:status', 'workspace:changed', 'job:progress']

const bridge: Bridge = {
  api,
  on(event, listener) {
    if (!EVENTS.includes(event)) throw new Error(`Unknown event ${event}`)
    const wrapped = (_: Electron.IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  }
}

contextBridge.exposeInMainWorld('bridge', bridge)
