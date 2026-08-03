import { contextBridge, ipcRenderer } from 'electron'

const playbackApi = {
  onPlaySound: (callback: (url: string, volume: number) => void): void => {
    ipcRenderer.on('playback:play-sound', (_event, url: string, volume: number) => callback(url, volume))
  },
  onSpeak: (callback: (text: string, voiceName: string) => void): void => {
    ipcRenderer.on('playback:speak', (_event, text: string, voiceName: string) => callback(text, voiceName))
  },
  notifyEnded: (): void => ipcRenderer.send('playback:sound-ended'),
  reportError: (message: string): void => ipcRenderer.send('playback:error', message)
}

contextBridge.exposeInMainWorld('playbackApi', playbackApi)

export type PlaybackApi = typeof playbackApi
