import { ipcMain, app, screen } from 'electron'
import { saveSettings } from '../app/settingsState'
import { moduleManager } from '../app/services'
import {
  summarize,
  orderedVisibleModules,
  syncSettingsFromModules,
  broadcastModules,
  managerWindowFor
} from '../modules/moduleRegistry'
import * as windows from '../windows/windowRegistry'

export function registerHudIpc(): void {
  ipcMain.handle('hud:get-modules', () => summarize(orderedVisibleModules()))

  ipcMain.handle('hud:toggle-module', async (_event, id: string) => {
    const module = moduleManager.get(id)
    if (!module) return summarize(orderedVisibleModules())

    await moduleManager.setEnabled(id, !module.enabled)
    syncSettingsFromModules()
    await saveSettings()
    broadcastModules()

    return summarize(orderedVisibleModules())
  })

  // Focus vs close — the HUD's settings button opens, its right-click toggles.
  // See the note in windowRegistry.ts; these are not duplicates.
  ipcMain.on('hud:open-settings', () => {
    windows.open('settings')
  })

  ipcMain.on('hud:toggle-settings', () => {
    windows.toggle('settings')
  })

  // Routed from the descriptor rather than an if/else chain over module ids,
  // so a bot's manager window is declared in exactly one place. A bot with no
  // manager window resolves to undefined and right-click does nothing, which
  // is what the old chain's missing else-branch did.
  ipcMain.on('hud:open-library', (_event, id: string) => {
    const key = managerWindowFor(id)
    if (key) windows.toggle(key)
  })

  ipcMain.on('hud:quit', () => {
    app.quit()
  })

  // Grows/shrinks the HUD to match its actual content (tile count, whether
  // the update button is showing) instead of leaving blank space or clipping
  // content. Keeps the right edge fixed and grows/shrinks leftward instead of
  // the default setBounds() behavior of holding x fixed and extending
  // rightward — a streamer who's dragged the HUD toward their screen's right
  // edge (common, to stay clear of capture layout) would otherwise have new
  // content pushed off-screen the moment the bar needs to grow wider than it
  // was when they positioned it.
  ipcMain.on('hud:resize', (_event, width: number) => {
    const hud = windows.getHud()
    if (!hud) return
    const bounds = hud.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const rightEdge = bounds.x + bounds.width
    const x = Math.max(rightEdge - width, workArea.x)
    hud.setBounds({ ...bounds, x, width })
  })
}
