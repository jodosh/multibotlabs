import { moduleManager } from '../app/services'
import { getSettings } from '../app/settingsState'
import { botDescriptors } from './botDescriptors'
import * as windows from '../windows/windowRegistry'
import type { IBotModule } from './types'
import type { WindowKey } from '../windows/windowRegistry'

export interface ModuleSummary {
  id: string
  displayName: string
  status: string
  enabled: boolean
}

export interface BotSummary {
  id: string
  displayName: string
  hidden: boolean
}

// Constructs and registers every bot, then enables the ones settings say
// should be on. Both loops walk botDescriptors in order, which is what makes
// the array the single source of registration order.
export async function registerModules(): Promise<void> {
  for (const descriptor of botDescriptors) {
    moduleManager.register(descriptor.construct())
  }

  // Sequential and awaited, never Promise.all. Each start() may call
  // chatClient.acquire() on a ref-counted shared connection, and starting them
  // concurrently changes how that connection is established.
  for (const descriptor of botDescriptors) {
    await moduleManager.setEnabled(descriptor.id, getSettings().modules[descriptor.settingsKey].enabled)
  }
}

// Writes each module's live enabled flag back into settings before a save.
// The per-entry guard matters: a module that failed to register would
// otherwise throw here rather than simply being skipped.
export function syncSettingsFromModules(): void {
  for (const descriptor of botDescriptors) {
    const module = moduleManager.get(descriptor.id)
    if (module) getSettings().modules[descriptor.settingsKey].enabled = module.enabled
  }
}

// The window a HUD tile opens on right-click, or undefined for a toggle-only
// bot. Replaces an if/else chain over module ids.
export function managerWindowFor(id: string): WindowKey | undefined {
  return botDescriptors.find((descriptor) => descriptor.id === id)?.managerWindow
}

export function orderedVisibleModules(): IBotModule[] {
  const hidden = new Set(getSettings().bots.hidden)
  const order = getSettings().bots.order
  return moduleManager
    .list()
    .filter((module) => !hidden.has(module.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
}

export function summarize(modules: IBotModule[]): ModuleSummary[] {
  return modules.map((module) => ({
    id: module.id,
    displayName: module.displayName,
    status: module.status,
    enabled: module.enabled
  }))
}

export function summarizeAllBots(): BotSummary[] {
  const hidden = new Set(getSettings().bots.hidden)
  const order = getSettings().bots.order
  return moduleManager
    .list()
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((module) => ({ id: module.id, displayName: module.displayName, hidden: hidden.has(module.id) }))
}

// Pushed explicitly after the three operations that change what the HUD should
// show. ModuleManager has no change events, so a module's own status
// transitions (connecting -> running -> error) are never broadcast — a known
// gap, deliberately left as-is by the refactor that created this file.
export function broadcastModules(): void {
  windows.sendHud('hud:modules-changed', summarize(orderedVisibleModules()))
}

// New modules registered after settings.json was last saved (or the very
// first run) need to be appended to the display order; modules that no
// longer exist need to be dropped so the list doesn't grow stale forever.
export function reconcileBotOrder(): void {
  const allIds = moduleManager.list().map((module) => module.id)
  const known = new Set(getSettings().bots.order)
  const missing = allIds.filter((id) => !known.has(id))
  getSettings().bots.order = [...getSettings().bots.order.filter((id) => allIds.includes(id)), ...missing]
}

// tmi.js won't pick up new credentials on an already-open connection, so
// login/logout force a real disconnect+reconnect of anything currently
// enabled — reusing ModuleManager's existing start/stop lifecycle rather
// than adding new reset plumbing to TwitchChatClient.
export async function reconnectEnabledModules(): Promise<void> {
  const enabledIds = moduleManager
    .list()
    .filter((module) => module.enabled)
    .map((module) => module.id)

  for (const id of enabledIds) await moduleManager.setEnabled(id, false)
  for (const id of enabledIds) await moduleManager.setEnabled(id, true)
}
