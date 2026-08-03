import { contextBridge, ipcRenderer } from 'electron'

export interface CoinksSettingsDto {
  bitsPrice: number
  commandEnabled: boolean
  coinsPerGame: number
  volume: number
}

export interface CoinksStateDto {
  currentPlayer: string | undefined
  queue: string[]
}

export interface CoinksOverlayStatusDto {
  status: 'stopped' | 'running' | 'error'
  url: string
  clients: number
  error?: string
}

export interface CoinksScoreDto {
  player: string
  score: number
  at: string
}

const coinksApi = {
  getSettings: (): Promise<CoinksSettingsDto> => ipcRenderer.invoke('coinks:get-settings'),
  setSettings: (patch: Partial<CoinksSettingsDto>): Promise<void> => ipcRenderer.invoke('coinks:set-settings', patch),

  getState: (): Promise<CoinksStateDto> => ipcRenderer.invoke('coinks:get-state'),
  enqueue: (player: string): Promise<void> => ipcRenderer.invoke('coinks:enqueue', player),
  onStateChanged: (callback: (state: CoinksStateDto) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CoinksStateDto): void => callback(state)
    ipcRenderer.on('coinks:state-changed', listener)
    return () => ipcRenderer.removeListener('coinks:state-changed', listener)
  },

  leaderboard: (): Promise<CoinksScoreDto[]> => ipcRenderer.invoke('coinks:leaderboard'),

  getOverlayStatus: (): Promise<CoinksOverlayStatusDto> => ipcRenderer.invoke('coinks:overlay-status'),
  onOverlayStatusChanged: (callback: (status: CoinksOverlayStatusDto) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: CoinksOverlayStatusDto): void => callback(status)
    ipcRenderer.on('coinks:overlay-status-changed', listener)
    return () => ipcRenderer.removeListener('coinks:overlay-status-changed', listener)
  },

  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('coinks', coinksApi)

export type CoinksApi = typeof coinksApi
