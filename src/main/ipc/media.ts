import { ipcMain, dialog, BrowserWindow } from 'electron'
import { basename, extname } from 'node:path'
import { getSettings, saveSettings } from '../app/settingsState'
import { mediaLibrary } from '../app/services'
import { SUPPORTED_MEDIA_EXTENSIONS, type MediaTrigger } from '../library/mediaLibrary'
import { overlayServer, overlayStatus, playMedia } from '../overlay/overlayService'

export function registerMediaIpc(): void {
  ipcMain.handle('media:list', () => mediaLibrary.list())

  ipcMain.handle('media:add-from-dialog', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: SUPPORTED_MEDIA_EXTENSIONS }]
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return []

    // Command defaults to the filename without extension, matching how the old
    // app seeded it on drag-and-drop.
    const added: MediaTrigger[] = []
    for (const filePath of result.filePaths) {
      added.push(await mediaLibrary.add(basename(filePath, extname(filePath)), filePath))
    }
    return added
  })

  ipcMain.handle('media:update', (_event, id: string, patch: Partial<MediaTrigger>) => mediaLibrary.update(id, patch))

  ipcMain.handle('media:remove', (_event, id: string) => mediaLibrary.remove(id))

  ipcMain.handle('media:test', (_event, id: string) => {
    const entry = mediaLibrary.get(id)
    if (entry) playMedia(entry)
  })

  ipcMain.handle('media:overlay-status', () => overlayStatus())

  // Was registered far from the rest of media:, between the hype-train and
  // updates handlers, purely by accident of when it was added. Moved here with
  // its siblings; ipcMain keys by channel name, so position never mattered.
  ipcMain.handle('media:set-port', async (_event, port: number) => {
    if (Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== overlayServer.port) {
      getSettings().modules.mediaGif.overlayPort = port
      await saveSettings()
      await overlayServer.start(port)
    }
    return overlayStatus()
  })
}
