import { contextBridge, ipcRenderer } from 'electron'

export interface TtsSettingsDto {
  enabled: boolean
  minimumBits: number
  voiceName: string
  freeCommandEnabled: boolean
}

// Counts of Command-bot entries named "!tts", which the free TTS command
// takes precedence over while it's on.
export interface TtsCommandConflicts {
  sounds: number
  textReplies: number
}

const ttsSettingsApi = {
  get: (): Promise<TtsSettingsDto> => ipcRenderer.invoke('tts-settings:get'),
  set: (patch: Partial<TtsSettingsDto>): Promise<void> => ipcRenderer.invoke('tts-settings:set', patch),
  getCommandConflicts: (): Promise<TtsCommandConflicts> => ipcRenderer.invoke('tts-settings:command-conflicts'),
  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('ttsSettings', ttsSettingsApi)

export type TtsSettingsApi = typeof ttsSettingsApi
