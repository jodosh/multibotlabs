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

export interface LegacyImportStatus {
  dirExists: boolean
  soundsImported: boolean
  mediaImported: boolean
}

export interface LegacySoundsImportSummary {
  importedSounds: number
  importedTextReplies: number
  alreadyPresent: number
  withoutSound: number
  skipped: string[]
}

export interface LegacyMediaImportSummary {
  imported: number
  skipped: string[]
}

const settingsApi = {
  getAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('settings:get-auth-status'),
  login: (): Promise<AuthStatus> => ipcRenderer.invoke('settings:login'),
  logout: (): Promise<AuthStatus> => ipcRenderer.invoke('settings:logout'),

  getBots: (): Promise<BotSummary[]> => ipcRenderer.invoke('settings:get-bots'),
  setBotOrder: (order: string[]): Promise<void> => ipcRenderer.invoke('settings:set-bot-order', order),
  setBotHidden: (id: string, hidden: boolean): Promise<void> => ipcRenderer.invoke('settings:set-bot-hidden', id, hidden),

  getLegacyImportStatus: (): Promise<LegacyImportStatus> => ipcRenderer.invoke('settings:get-legacy-import-status'),
  importLegacySounds: (): Promise<LegacySoundsImportSummary> => ipcRenderer.invoke('settings:import-legacy-sounds'),
  importLegacyMedia: (): Promise<LegacyMediaImportSummary> => ipcRenderer.invoke('settings:import-legacy-media'),

  getUpdatesEnabled: (): Promise<boolean> => ipcRenderer.invoke('updates:get-enabled'),
  setUpdatesEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('updates:set-enabled', enabled),

  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('settingsApi', settingsApi)

export type SettingsApi = typeof settingsApi
