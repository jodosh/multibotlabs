import { SettingsStore, type AppSettings } from '../settings/settingsStore'

// The single owner of the live AppSettings object.
//
// This is the load-bearing invariant of the whole main process, and the one
// most likely to be broken by a well-meaning future change:
//
//   The settings object has ONE owner (this module), ONE assignment
//   (inside loadSettings), and is reached ONLY through getSettings()
//   called at the point of use.
//
// Why it matters: every bot module receives its config as a closure that reads
// settings lazily — `() => getSettings().twitch.login` — and the IPC handlers
// are registered before the settings have even been loaded. Nothing may capture
// the object, only the way to reach it. Mutating it in place is correct and
// intended; replacing it, copying it, or caching a reference to it is not.
//
// Two greps verify this holds:
//   grep -rn "= getSettings()$" src/main        zero hits (no stored reference)
//   grep -rn '\.\.\.getSettings()[^.]' src/main zero hits (no root-object copy)
//
// The second one's `[^.]` is load-bearing: a bare `\.\.\.getSettings()` also
// matches the legitimate sub-object spreads below, so it reports false
// positives and trains you to ignore it.
//
// Spreading a *sub-object* is fine and appears throughout:
//   getSettings().modules.atMe = { ...getSettings().modules.atMe, ...patch }
// That reassigns a property of the live root, which is exactly what the
// modules' `() => getSettings().modules.atMe` closures re-read.
//
// getSettings() is a function rather than an exported `let` on purpose: a
// function survives destructuring (`const { getSettings } = ...` still works),
// whereas a destructured value would snapshot `undefined` forever. With no
// linter in this project, nothing else would catch that.

const store = new SettingsStore()

let current: AppSettings

// Merges saved data over defaults field by field, so old or partial settings
// files upgrade gracefully. Must be the first thing whenReady does — everything
// downstream assumes settings exist.
export async function loadSettings(): Promise<void> {
  current = await store.load()
}

// No null check and no `?? defaultSettings` fallback, deliberately: a fallback
// would silently mask an ordering regression (something reaching for settings
// before load) by handing back defaults instead of failing loudly.
export function getSettings(): AppSettings {
  return current
}

// Always saves the live object — there is no call site that saves anything
// else, so taking a parameter would only create the opportunity to persist a
// stale copy.
export async function saveSettings(): Promise<void> {
  await store.save(current)
}
