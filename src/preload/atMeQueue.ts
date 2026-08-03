import { contextBridge, ipcRenderer } from 'electron'

export type AtMeReason = 'mention' | 'highlight'

export interface AtMeQueueItemDto {
  id: string
  username: string
  text: string
  reasons: AtMeReason[]
  timestamp: number
}

export interface AtMeSettingsDto {
  matchMentions: boolean
  matchHighlights: boolean
  togglesCollapsed: boolean
}

const atMeQueueApi = {
  getSettings: (): Promise<AtMeSettingsDto> => ipcRenderer.invoke('atme:get-settings'),
  setSettings: (patch: Partial<AtMeSettingsDto>): Promise<void> => ipcRenderer.invoke('atme:set-settings', patch),
  list: (): Promise<AtMeQueueItemDto[]> => ipcRenderer.invoke('atme:list-queue'),
  dismiss: (id: string): Promise<void> => ipcRenderer.invoke('atme:dismiss', id),
  onChanged: (callback: (queue: AtMeQueueItemDto[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, queue: AtMeQueueItemDto[]): void => callback(queue)
    ipcRenderer.on('atme:queue-changed', listener)
    return () => ipcRenderer.removeListener('atme:queue-changed', listener)
  },
  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('atMeQueue', atMeQueueApi)

export type AtMeQueueApi = typeof atMeQueueApi
