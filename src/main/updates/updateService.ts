import { app } from 'electron'
import { UpdateChecker } from './updateChecker'
import { getSettings, saveSettings } from '../app/settingsState'
import * as windows from '../windows/windowRegistry'

export interface PendingUpdate {
  current: string
  latest: string
  releaseUrl: string
  body: string
}

// The update this session found and hasn't had dismissed. Lives here rather
// than in the IPC layer because both the startup check and the dismiss handler
// mutate it, and the update-details window reads it.
let pendingUpdate: PendingUpdate | undefined

export function getPendingUpdate(): PendingUpdate | undefined {
  return pendingUpdate
}

// Only clears when the dismissed version is the one actually pending: a
// dismissal racing a newly-found different version must not silently discard
// the newer one.
export function clearPendingUpdate(version: string): void {
  if (pendingUpdate?.latest === version) {
    pendingUpdate = undefined
  }
}

export async function checkForUpdatesOnStartup(): Promise<void> {
  if (!getSettings().updates.enabled) {
    return
  }

  const lastCheck = getSettings().updates.lastCheckTime ?? 0
  const hoursSinceLastCheck = (Date.now() - lastCheck) / (1000 * 60 * 60)
  if (hoursSinceLastCheck < 12) {
    return
  }

  // A local rather than module state: it does one HTTPS fetch and is never
  // consulted again. It was a module-scope `let` in index.ts that nothing else
  // ever read.
  const updateChecker = new UpdateChecker(app.getVersion())
  const result = await updateChecker.checkForUpdates()

  if (result.updateAvailable && result.latest && result.latest.version !== getSettings().updates.dismissedVersion) {
    pendingUpdate = {
      current: result.current,
      latest: result.latest.version,
      releaseUrl: result.latest.releaseUrl,
      body: result.latest.body
    }
    windows.sendHud('updates:available')
  }

  getSettings().updates.lastCheckTime = Date.now()
  await saveSettings()
}
