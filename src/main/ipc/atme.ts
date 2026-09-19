import { ipcMain } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { moduleRefs } from '../modules/moduleRefs'
import type { AtMeQueueItem } from '../modules/atMeModule'

export function registerAtMeIpc(): void {
  ipcMain.handle('atme:get-settings', () => ({
    matchMentions: getSettings().modules.atMe.matchMentions,
    matchHighlights: getSettings().modules.atMe.matchHighlights,
    togglesCollapsed: getSettings().modules.atMe.togglesCollapsed
  }))

  ipcMain.handle(
    'atme:set-settings',
    async (_event, patch: Partial<{ matchMentions: boolean; matchHighlights: boolean; togglesCollapsed: boolean }>) => {
      getSettings().modules.atMe = { ...getSettings().modules.atMe, ...patch }
      await saveSettings()
    }
  )

  // The queue lives in the module, in memory only — it is deliberately not
  // persisted, since a queue of stale @-mentions from a previous stream is
  // noise. An empty array is the correct answer before the module exists.
  ipcMain.handle('atme:list-queue', (): AtMeQueueItem[] => moduleRefs.atMe?.listQueue() ?? [])

  ipcMain.handle('atme:dismiss', (_event, id: string) => {
    moduleRefs.atMe?.dismiss(id)
  })
}
