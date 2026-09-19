import { ipcMain } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { soundLibrary, mediaLibrary } from '../app/services'
import { importLegacyData, legacyDataExists } from '../library/legacyImport'
import { summarizeAllBots, broadcastModules, reconnectEnabledModules } from '../modules/moduleRegistry'
import * as twitchAuth from '../auth/twitchAuth'
import * as windows from '../windows/windowRegistry'

interface AuthStatus {
  loggedIn: boolean
  login: string
}

function authStatus(): AuthStatus {
  return { loggedIn: Boolean(getSettings().twitch.accessToken), login: getSettings().twitch.login }
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-auth-status', () => authStatus())

  ipcMain.handle('settings:login', async () => {
    // getHud() is read here rather than captured: this handler is registered
    // before the HUD window exists.
    const result = await twitchAuth.login(windows.getHud())
    if (result) {
      getSettings().twitch = result
      await saveSettings()
      await reconnectEnabledModules()
    }
    return authStatus()
  })

  ipcMain.handle('settings:logout', async () => {
    await twitchAuth.logout(getSettings().twitch.accessToken)
    getSettings().twitch = { accessToken: '', login: '', userId: '', expiresAt: 0 }
    await saveSettings()
    await reconnectEnabledModules()
    return authStatus()
  })

  ipcMain.handle('settings:get-bots', () => summarizeAllBots())

  ipcMain.handle('settings:set-bot-order', async (_event, order: string[]) => {
    getSettings().bots.order = order
    await saveSettings()
    broadcastModules()
  })

  ipcMain.handle('settings:set-bot-hidden', async (_event, id: string, hidden: boolean) => {
    const set = new Set(getSettings().bots.hidden)
    if (hidden) set.add(id)
    else set.delete(id)
    getSettings().bots.hidden = [...set]
    await saveSettings()
    broadcastModules()
  })

  // Backs the "Import from old MultiBot" section: the section itself only
  // renders when the old .NET app's data directory exists, and each of its
  // two rows (sounds/text vs. media) drops off independently once that
  // import has actually been run, so re-running it can't duplicate entries.
  ipcMain.handle('settings:get-legacy-import-status', async () => ({
    dirExists: await legacyDataExists(),
    soundsImported: getSettings().legacyImport.soundsImported,
    mediaImported: getSettings().legacyImport.mediaImported
  }))

  ipcMain.handle('settings:import-legacy-sounds', async () => {
    const summary = await importLegacyData(soundLibrary)
    getSettings().legacyImport.soundsImported = true
    await saveSettings()
    return summary
  })

  ipcMain.handle('settings:import-legacy-media', async () => {
    const summary = await mediaLibrary.importLegacy()
    getSettings().legacyImport.mediaImported = true
    await saveSettings()
    return summary
  })
}
