import { contextBridge, ipcRenderer } from 'electron'

export interface UpdateNotification {
  current: string
  latest: string
  releaseUrl: string
  body: string
}

const updateDetailsApi = {
  get: (): Promise<UpdateNotification | undefined> => ipcRenderer.invoke('update-details:get'),
  dismiss: (version: string): void => ipcRenderer.send('updates:dismiss', version),
  openUrl: (url: string): void => ipcRenderer.send('hud:open-url', url),
  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('updateDetails', updateDetailsApi)

export type UpdateDetailsApi = typeof updateDetailsApi
