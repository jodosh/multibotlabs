import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { soundLibrary } from '../app/services'
import { playTriggerSound } from '../audio/playbackBridge'
import type { SoundTriggerKind } from '../library/types'

// Backs the shared Library renderer, which serves Command, Emote and User
// Intros — the kind is a parameter rather than three parallel handler sets,
// matching SoundLibrary's own shape.
export function registerLibraryIpc(): void {
  ipcMain.handle('library:list-sounds', (_event, kind: SoundTriggerKind) => soundLibrary.listSounds(kind))

  ipcMain.handle('library:add-sound-from-dialog', async (event, kind: SoundTriggerKind, trigger: string, volume: number) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm', 'weba'] }]
    }
    // Tied to the Library window that opened it — an untied dialog can open
    // unfocused or behind the parent window on some Linux window managers.
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return null

    return soundLibrary.addSound(kind, trigger, result.filePaths[0], volume)
  })

  ipcMain.handle('library:update-sound', (_event, id: string, patch: { trigger?: string; volume?: number }) =>
    soundLibrary.updateSound(id, patch)
  )

  ipcMain.handle('library:remove-sound', (_event, id: string) => soundLibrary.removeSound(id))

  ipcMain.on('library:preview-sound', (_event, filePath: string, volume: number) => {
    playTriggerSound(filePath, volume)
  })

  ipcMain.handle('library:list-text-replies', () => soundLibrary.listTextReplies())

  ipcMain.handle('library:add-text-reply', (_event, command: string, reply: string) =>
    soundLibrary.addTextReply(command, reply)
  )

  ipcMain.handle('library:update-text-reply', (_event, id: string, patch: { command?: string; reply?: string }) =>
    soundLibrary.updateTextReply(id, patch)
  )

  ipcMain.handle('library:remove-text-reply', (_event, id: string) => soundLibrary.removeTextReply(id))

  ipcMain.handle('library:get-allow-user-list', () => getSettings().modules.command.allowUserList)

  ipcMain.handle('library:set-allow-user-list', async (_event, value: boolean) => {
    getSettings().modules.command.allowUserList = value
    await saveSettings()
  })

  ipcMain.handle('library:get-user-intros-enabled', () => getSettings().modules.command.userIntrosEnabled)

  ipcMain.handle('library:get-tts-command-enabled', () => getSettings().modules.textToSpeech.freeCommandEnabled)

  ipcMain.handle('library:set-user-intros-enabled', async (_event, value: boolean) => {
    getSettings().modules.command.userIntrosEnabled = value
    await saveSettings()
  })
}
