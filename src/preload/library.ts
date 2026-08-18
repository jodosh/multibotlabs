import { contextBridge, ipcRenderer } from 'electron'

export type SoundTriggerKind = 'command' | 'emote' | 'user-intro'

export interface SoundTriggerDto {
  id: string
  kind: SoundTriggerKind
  trigger: string
  fileName: string
  filePath: string
  volume: number
}

export interface TextReplyDto {
  id: string
  command: string
  reply: string
}

const libraryApi = {
  listSounds: (kind: SoundTriggerKind): Promise<SoundTriggerDto[]> => ipcRenderer.invoke('library:list-sounds', kind),
  addSoundFromDialog: (kind: SoundTriggerKind, trigger: string, volume: number): Promise<SoundTriggerDto | null> =>
    ipcRenderer.invoke('library:add-sound-from-dialog', kind, trigger, volume),
  updateSound: (id: string, patch: Partial<Pick<SoundTriggerDto, 'trigger' | 'volume'>>): Promise<void> =>
    ipcRenderer.invoke('library:update-sound', id, patch),
  removeSound: (id: string): Promise<void> => ipcRenderer.invoke('library:remove-sound', id),
  previewSound: (filePath: string, volume: number): void => ipcRenderer.send('library:preview-sound', filePath, volume),

  listTextReplies: (): Promise<TextReplyDto[]> => ipcRenderer.invoke('library:list-text-replies'),
  addTextReply: (command: string, reply: string): Promise<TextReplyDto> =>
    ipcRenderer.invoke('library:add-text-reply', command, reply),
  updateTextReply: (id: string, patch: Partial<Pick<TextReplyDto, 'command' | 'reply'>>): Promise<void> =>
    ipcRenderer.invoke('library:update-text-reply', id, patch),
  removeTextReply: (id: string): Promise<void> => ipcRenderer.invoke('library:remove-text-reply', id),

  getAllowUserList: (): Promise<boolean> => ipcRenderer.invoke('library:get-allow-user-list'),
  setAllowUserList: (value: boolean): Promise<void> => ipcRenderer.invoke('library:set-allow-user-list', value),

  getUserIntrosEnabled: (): Promise<boolean> => ipcRenderer.invoke('library:get-user-intros-enabled'),
  // Read-only here: the toggle itself lives in the TTS settings window, this
  // window only needs it to flag entries the !tts reservation shadows.
  getTtsCommandEnabled: (): Promise<boolean> => ipcRenderer.invoke('library:get-tts-command-enabled'),
  setUserIntrosEnabled: (value: boolean): Promise<void> => ipcRenderer.invoke('library:set-user-intros-enabled', value),

  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('library', libraryApi)

export type LibraryApi = typeof libraryApi
