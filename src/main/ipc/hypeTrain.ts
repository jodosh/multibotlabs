import { ipcMain } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { moduleRefs } from '../modules/moduleRefs'
import { hypeTrainOverlayStatus } from '../overlay/overlayService'

export function registerHypeTrainIpc(): void {
  ipcMain.handle('hype-train:get-settings', () => ({
    volume: getSettings().modules.hypeTrain.volume
  }))

  ipcMain.handle('hype-train:set-settings', async (_event, patch: Partial<{ volume: number }>) => {
    getSettings().modules.hypeTrain = { ...getSettings().modules.hypeTrain, ...patch }
    await saveSettings()
  })

  ipcMain.handle('hype-train:test', () => {
    moduleRefs.hypeTrain?.simulate()
  })

  ipcMain.handle('hype-train:get-state', () => moduleRefs.hypeTrain?.state() ?? { active: false, level: 1, archerCount: 0 })

  ipcMain.handle('hype-train:overlay-status', () => hypeTrainOverlayStatus())
}
