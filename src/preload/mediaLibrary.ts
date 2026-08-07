import { contextBridge, ipcRenderer } from 'electron'

export type MediaAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface MediaTriggerDto {
  id: string
  command: string
  fileName: string
  filePath: string
  element: 'image' | 'video'
  anchor: MediaAnchor
  durationSeconds: number
  volume: number
}

export interface MediaTriggerPatch {
  command?: string
  anchor?: MediaAnchor
  durationSeconds?: number
  volume?: number
}

export interface OverlayStatusDto {
  status: 'stopped' | 'running' | 'error'
  url: string
  port: number
  clients: number
  error?: string
}

const mediaLibraryApi = {
  list: (): Promise<MediaTriggerDto[]> => ipcRenderer.invoke('media:list'),
  addFromDialog: (): Promise<MediaTriggerDto[]> => ipcRenderer.invoke('media:add-from-dialog'),
  update: (id: string, patch: MediaTriggerPatch): Promise<void> => ipcRenderer.invoke('media:update', id, patch),
  remove: (id: string): Promise<void> => ipcRenderer.invoke('media:remove', id),
  test: (id: string): Promise<void> => ipcRenderer.invoke('media:test', id),

  getOverlayStatus: (): Promise<OverlayStatusDto> => ipcRenderer.invoke('media:overlay-status'),
  setPort: (port: number): Promise<OverlayStatusDto> => ipcRenderer.invoke('media:set-port', port),
  onOverlayStatusChanged: (callback: (status: OverlayStatusDto) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: OverlayStatusDto): void => callback(status)
    ipcRenderer.on('media:overlay-status-changed', listener)
    return () => ipcRenderer.removeListener('media:overlay-status-changed', listener)
  },

  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('mediaLibrary', mediaLibraryApi)

export type MediaLibraryApi = typeof mediaLibraryApi
