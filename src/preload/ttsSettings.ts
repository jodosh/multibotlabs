import { contextBridge, ipcRenderer } from 'electron'

export interface TtsSettingsDto {
  enabled: boolean
  minimumBits: number
  voiceName: string
}

const ttsSettingsApi = {
  get: (): Promise<TtsSettingsDto> => ipcRenderer.invoke('tts-settings:get'),
  set: (patch: Partial<TtsSettingsDto>): Promise<void> => ipcRenderer.invoke('tts-settings:set', patch),
  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('ttsSettings', ttsSettingsApi)

export type TtsSettingsApi = typeof ttsSettingsApi
