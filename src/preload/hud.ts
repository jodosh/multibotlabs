import { contextBridge, ipcRenderer } from 'electron'

export interface ModuleSummary {
  id: string
  displayName: string
  status: string
  enabled: boolean
  // Whether right-clicking this tile opens a manager window. Derived in the
  // main process from botDescriptors, rather than duplicated as a list of ids
  // in the renderer — a stale copy there shows up as right-click silently
  // doing nothing.
  hasManagerWindow: boolean
}

const hudApi = {
  getModules: (): Promise<ModuleSummary[]> => ipcRenderer.invoke('hud:get-modules'),
  toggleModule: (id: string): Promise<ModuleSummary[]> => ipcRenderer.invoke('hud:toggle-module', id),
  openSettings: (): void => ipcRenderer.send('hud:open-settings'),
  toggleSettings: (): void => ipcRenderer.send('hud:toggle-settings'),
  openLibrary: (id: string): void => ipcRenderer.send('hud:open-library', id),
  quit: (): void => ipcRenderer.send('hud:quit'),
  resizeWindow: (width: number): void => ipcRenderer.send('hud:resize', width),
  onModulesChanged: (callback: (modules: ModuleSummary[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, modules: ModuleSummary[]): void => callback(modules)
    ipcRenderer.on('hud:modules-changed', listener)
    return () => ipcRenderer.removeListener('hud:modules-changed', listener)
  },
  openUpdateDetails: (): void => ipcRenderer.send('hud:open-update-details'),
  onUpdateAvailable: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('updates:available', listener)
    return () => ipcRenderer.removeListener('updates:available', listener)
  },
  onUpdateDismissed: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('updates:dismissed', listener)
    return () => ipcRenderer.removeListener('updates:dismissed', listener)
  }
}

contextBridge.exposeInMainWorld('hud', hudApi)

export type HudApi = typeof hudApi
