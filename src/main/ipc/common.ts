import { ipcMain, shell, BrowserWindow } from 'electron'
import { playbackQueue } from '../app/services'

// The handlers that belong to no one feature: window chrome, the playback
// window's callbacks, and opening an external link. Each of these namespaces
// has only one or two handlers, so giving them files of their own would mean
// four files that are mostly import statements.
export function registerCommonIpc(): void {
  ipcMain.on('playback:sound-ended', () => {
    playbackQueue.release()
  })

  // Surfaces otherwise-silent playback failures (e.g. a blocked audio.play())
  // to this process's console, since the playback window is never shown and
  // has no visible devtools to check.
  ipcMain.on('playback:error', (_event, message: string) => {
    console.error('[playback]', message)
  })

  // Shared by the Settings and Library windows' custom titlebars, since
  // they're frameless and have no OS-provided close button.
  //
  // Resolved from the sender rather than the window registry on purpose: it
  // works for any frameless window without the registry needing to know which
  // ones have a titlebar.
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.on('hud:open-url', (_event, url: string) => {
    void shell.openExternal(url)
  })
}
