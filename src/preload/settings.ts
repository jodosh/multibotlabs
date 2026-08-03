import { contextBridge, ipcRenderer } from 'electron'

export interface AuthStatus {
  loggedIn: boolean
  login: string
}

export interface BotSummary {
  id: string
  displayName: string
  hidden: boolean
}

const settingsApi = {
  getAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('settings:get-auth-status'),
  login: (): Promise<AuthStatus> => ipcRenderer.invoke('settings:login'),
  logout: (): Promise<AuthStatus> => ipcRenderer.invoke('settings:logout'),

  getBots: (): Promise<BotSummary[]> => ipcRenderer.invoke('settings:get-bots'),
  setBotOrder: (order: string[]): Promise<void> => ipcRenderer.invoke('settings:set-bot-order', order),
  setBotHidden: (id: string, hidden: boolean): Promise<void> => ipcRenderer.invoke('settings:set-bot-hidden', id, hidden),

  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('settingsApi', settingsApi)

export type SettingsApi = typeof settingsApi
