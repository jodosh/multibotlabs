import { contextBridge, ipcRenderer } from 'electron'

export interface CelebrationSettingsDto {
  bitsPrice: number
  commandEnabled: boolean
  shellCount: number
  volume: number
}

export interface FireworksOverlayStatusDto {
  status: 'stopped' | 'running' | 'error'
  url: string
  clients: number
  error?: string
}

const celebrationApi = {
  getSettings: (): Promise<CelebrationSettingsDto> => ipcRenderer.invoke('celebration:get-settings'),
  setSettings: (patch: Partial<CelebrationSettingsDto>): Promise<void> =>
    ipcRenderer.invoke('celebration:set-settings', patch),
  test: (): Promise<void> => ipcRenderer.invoke('celebration:test'),

  getOverlayStatus: (): Promise<FireworksOverlayStatusDto> => ipcRenderer.invoke('celebration:overlay-status'),
  onOverlayStatusChanged: (callback: (status: FireworksOverlayStatusDto) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: FireworksOverlayStatusDto): void => callback(status)
    ipcRenderer.on('celebration:overlay-status-changed', listener)
    return () => ipcRenderer.removeListener('celebration:overlay-status-changed', listener)
  },

  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('celebration', celebrationApi)

export type CelebrationApi = typeof celebrationApi
