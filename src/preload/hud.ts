import { contextBridge, ipcRenderer } from 'electron'

export interface ModuleSummary {
  id: string
  displayName: string
  status: string
  enabled: boolean
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
  }
}

contextBridge.exposeInMainWorld('hud', hudApi)

export type HudApi = typeof hudApi
