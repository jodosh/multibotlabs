import { contextBridge, ipcRenderer } from 'electron'

export interface HypeTrainSettingsDto {
  volume: number
}

export interface HypeTrainStateDto {
  active: boolean
  level: number
  archerCount: number
}

export interface HypeTrainOverlayStatusDto {
  status: 'stopped' | 'running' | 'error'
  url: string
  clients: number
  error?: string
}

const hypeTrainApi = {
  getSettings: (): Promise<HypeTrainSettingsDto> => ipcRenderer.invoke('hype-train:get-settings'),
  setSettings: (patch: Partial<HypeTrainSettingsDto>): Promise<void> => ipcRenderer.invoke('hype-train:set-settings', patch),
  test: (): Promise<void> => ipcRenderer.invoke('hype-train:test'),

  getState: (): Promise<HypeTrainStateDto> => ipcRenderer.invoke('hype-train:get-state'),
  onStateChanged: (callback: (state: HypeTrainStateDto) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: HypeTrainStateDto): void => callback(state)
    ipcRenderer.on('hype-train:state-changed', listener)
    return () => ipcRenderer.removeListener('hype-train:state-changed', listener)
  },

  getOverlayStatus: (): Promise<HypeTrainOverlayStatusDto> => ipcRenderer.invoke('hype-train:overlay-status'),
  onOverlayStatusChanged: (callback: (status: HypeTrainOverlayStatusDto) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: HypeTrainOverlayStatusDto): void => callback(status)
    ipcRenderer.on('hype-train:overlay-status-changed', listener)
    return () => ipcRenderer.removeListener('hype-train:overlay-status-changed', listener)
  },

  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('hypeTrain', hypeTrainApi)

export type HypeTrainApi = typeof hypeTrainApi
