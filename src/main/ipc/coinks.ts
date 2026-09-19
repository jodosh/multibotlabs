import { ipcMain } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { coinksScores } from '../app/services'
import { moduleRefs } from '../modules/moduleRefs'
import { coinksOverlayStatus } from '../overlay/overlayService'

export function registerCoinksIpc(): void {
  ipcMain.handle('coinks:get-settings', () => ({
    bitsPrice: getSettings().modules.coinks.bitsPrice,
    commandEnabled: getSettings().modules.coinks.commandEnabled,
    coinsPerGame: getSettings().modules.coinks.coinsPerGame,
    volume: getSettings().modules.coinks.volume
  }))

  ipcMain.handle(
    'coinks:set-settings',
    async (_event, patch: Partial<{ bitsPrice: number; commandEnabled: boolean; coinsPerGame: number; volume: number }>) => {
      getSettings().modules.coinks = { ...getSettings().modules.coinks, ...patch }
      await saveSettings()
    }
  )

  ipcMain.handle('coinks:get-state', () => moduleRefs.coinks?.state() ?? { currentPlayer: undefined, queue: [] })

  ipcMain.handle('coinks:enqueue', (_event, player: string) => {
    moduleRefs.coinks?.enqueue(player)
  })

  ipcMain.handle('coinks:leaderboard', () => coinksScores.leaderboard())

  ipcMain.handle('coinks:overlay-status', () => coinksOverlayStatus())
}
