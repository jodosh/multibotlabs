import { ipcMain } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { startFireworks, celebrationOverlayStatus } from '../overlay/overlayService'

export function registerCelebrationIpc(): void {
  ipcMain.handle('celebration:get-settings', () => ({
    bitsPrice: getSettings().modules.celebration.bitsPrice,
    commandEnabled: getSettings().modules.celebration.commandEnabled,
    shellCount: getSettings().modules.celebration.shellCount,
    volume: getSettings().modules.celebration.volume
  }))

  ipcMain.handle(
    'celebration:set-settings',
    async (_event, patch: Partial<{ bitsPrice: number; commandEnabled: boolean; shellCount: number; volume: number }>) => {
      getSettings().modules.celebration = { ...getSettings().modules.celebration, ...patch }
      await saveSettings()
    }
  )

  ipcMain.handle('celebration:test', () => {
    startFireworks(getSettings().modules.celebration.shellCount)
  })

  ipcMain.handle('celebration:overlay-status', () => celebrationOverlayStatus())
}
