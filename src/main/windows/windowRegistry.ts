import type { BrowserWindow } from 'electron'
import {
  createHudWindow,
  createPlaybackWindow,
  createSettingsWindow,
  createLibraryWindow,
  createTtsSettingsWindow,
  createAtMeQueueWindow,
  createMediaWindow,
  createCelebrationWindow,
  createCoinksWindow,
  createHypeTrainWindow,
  createUpdateDetailsWindow
} from '../windowManager'

// One keyed home for every window the app opens on demand, replacing ten
// module-scope `let`s and seven near-identical toggle functions.
//
// windowManager.ts still owns how each window is *built* (size, chrome,
// position, preload). This owns which ones are currently open and the two verbs
// for getting one on screen.
//
// The HUD and the playback window are deliberately not part of this keyspace:
// their factories take no onClose, they are created once during startup, and
// they are never closed or toggled. Forcing them into the same shape would mean
// inventing lifecycle they don't have. They get plain accessors instead.

export type WindowKey =
  | 'settings'
  | 'tts-settings'
  | 'atme-queue'
  | 'media'
  | 'celebration'
  | 'coinks'
  | 'hype-train'
  | 'update-details'
  | 'library:command'
  | 'library:emote'

let hudWindow: BrowserWindow | undefined
let playbackWindow: BrowserWindow | undefined

const openWindows: Partial<Record<WindowKey, BrowserWindow>> = {}

// Every factory reads getHud() at call time, never at module load: windows are
// opened long after startup, and the parent is only used for positioning
// (positionAboveHud). Capturing it here would pin whatever the HUD was — or
// wasn't — when this module was first evaluated.
//
// The two library keys collapse what used to be a separate `libraryWindows`
// record. Command and Emote are the same renderer distinguished by a query
// param, which is exactly what a composite key expresses.
const factories: Record<WindowKey, (onClose: () => void) => BrowserWindow> = {
  settings: (onClose) => createSettingsWindow(onClose, hudWindow),
  'tts-settings': (onClose) => createTtsSettingsWindow(onClose, hudWindow),
  'atme-queue': (onClose) => createAtMeQueueWindow(onClose, hudWindow),
  media: (onClose) => createMediaWindow(onClose, hudWindow),
  celebration: (onClose) => createCelebrationWindow(onClose, hudWindow),
  coinks: (onClose) => createCoinksWindow(onClose, hudWindow),
  'hype-train': (onClose) => createHypeTrainWindow(onClose, hudWindow),
  'update-details': (onClose) => createUpdateDetailsWindow(onClose, hudWindow),
  'library:command': (onClose) => createLibraryWindow('command', onClose, hudWindow),
  'library:emote': (onClose) => createLibraryWindow('emote', onClose, hudWindow)
}

// The registry's entry is cleared by the window's own 'closed' event (each
// create*Window wires `win.on('closed', onClose)`), never eagerly when close()
// is called. That ordering is load-bearing: close() is asynchronous, so
// deleting the entry up front would let a rapid re-toggle open a second window
// while the first is still closing.
function create(key: WindowKey): BrowserWindow {
  const win = factories[key](() => {
    delete openWindows[key]
  })
  openWindows[key] = win
  return win
}

// `toggle` and `open` differ in what they do to an already-open window, and the
// difference is intentional rather than duplication waiting to be merged. The
// manager windows are toggled from the HUD tile that opened them, so a second
// right-click closes them. Update details is opened from a badge, where closing
// on a second click would be surprising — it focuses instead. Settings is
// reachable both ways: the button focuses, the shortcut toggles.
export function toggle(key: WindowKey): void {
  const existing = openWindows[key]
  if (existing) {
    existing.close()
    return
  }
  create(key)
}

export function open(key: WindowKey): void {
  const existing = openWindows[key]
  if (existing) {
    existing.focus()
    return
  }
  create(key)
}

export function get(key: WindowKey): BrowserWindow | undefined {
  return openWindows[key]
}

// Sends to a window only if it's open. The overwhelmingly common case is a
// status broadcast aimed at a manager window the user probably doesn't have
// open, so a no-op is the correct outcome, not an error.
export function send(key: WindowKey, channel: string, ...args: unknown[]): void {
  openWindows[key]?.webContents.send(channel, ...args)
}

export function createHud(): BrowserWindow {
  hudWindow = createHudWindow()
  return hudWindow
}

export function createPlayback(): BrowserWindow {
  playbackWindow = createPlaybackWindow()
  return playbackWindow
}

// Callers must call this at the point of use rather than hoisting the result:
// IPC handlers are registered before the HUD exists, so anything that captures
// the value at registration time captures `undefined` permanently.
export function getHud(): BrowserWindow | undefined {
  return hudWindow
}

export function sendHud(channel: string, ...args: unknown[]): void {
  hudWindow?.webContents.send(channel, ...args)
}

export function sendPlayback(channel: string, ...args: unknown[]): void {
  playbackWindow?.webContents.send(channel, ...args)
}
