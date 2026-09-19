import { ipcMain } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { getPendingUpdate, clearPendingUpdate } from '../updates/updateService'
import * as windows from '../windows/windowRegistry'

export function registerUpdatesIpc(): void {
  ipcMain.on('updates:dismiss', async (_event, version: string) => {
    getSettings().updates.dismissedVersion = version
    await saveSettings()
    // The badge only disappears once dismissal is confirmed here, rather than
    // optimistically in the renderer, so a HUD restart before this save
    // lands can't leave the badge permanently hidden for an update that was
    // never actually recorded as dismissed.
    clearPendingUpdate(version)
    windows.sendHud('updates:dismissed')
  })

  ipcMain.handle('updates:get-enabled', () => getSettings().updates.enabled)

  ipcMain.handle('updates:set-enabled', async (_event, enabled: boolean) => {
    getSettings().updates.enabled = enabled
    await saveSettings()
  })

  // Opened from the HUD badge, so it focuses an already-open window rather
  // than toggling it closed.
  ipcMain.on('hud:open-update-details', () => {
    windows.open('update-details')
  })

  ipcMain.handle('update-details:get', () => getPendingUpdate())
}
