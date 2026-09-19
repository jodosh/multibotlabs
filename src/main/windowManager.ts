import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const GAP_ABOVE_HUD = 12

// Mirrors index.ts's resourcesRoot() — resources/ sits next to the app root
// in dev but gets relocated under process.resourcesPath once packaged. Must
// stay a function, not a top-level constant: `app` isn't populated yet at
// module-evaluation time, only once these are called during window creation.
function appIcon(): string {
  return join(app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources'), 'icon.png')
}

// Opens a window just above the HUD, horizontally centered on it, so the
// user never has to hunt for where it landed — clamped to the screen's work
// area in case the HUD is dragged near an edge.
function positionAboveHud(hudWindow: BrowserWindow | undefined, width: number, height: number): { x: number; y: number } | undefined {
  if (!hudWindow) return undefined

  const hudBounds = hudWindow.getBounds()
  const workArea = screen.getDisplayMatching(hudBounds).workArea

  const x = Math.min(
    Math.max(hudBounds.x + Math.round((hudBounds.width - width) / 2), workArea.x),
    workArea.x + workArea.width - width
  )
  const y = Math.max(hudBounds.y - height - GAP_ABOVE_HUD, workArea.y)

  return { x, y }
}

function loadRenderer(win: BrowserWindow, name: string, query?: Record<string, string>): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const queryString = query ? `?${new URLSearchParams(query).toString()}` : ''

  if (devServerUrl) {
    void win.loadURL(`${devServerUrl}/${name}/index.html${queryString}`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${name}/index.html`), { query })
  }
}

// The only window visible during normal streaming use: small, frameless,
// draggable, shows a HUD tile per bot. Never minimized/hidden by the user —
// toggling a bot happens right on the bar, no separate window to manage.
export function createHudWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 110,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/hud.js'),
    }
  })
  loadRenderer(win, 'hud')
  return win
}

// Opened rarely, on demand, from the HUD's settings button. Frameless like
// the HUD — the renderer draws its own titlebar with a close button, since
// there's no OS-provided one.
export function createSettingsWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 480
  const height = 560

  const win = new BrowserWindow({
    width,
    height,
    resizable: false,
    frame: false,
    title: 'MultiBot Settings',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/settings.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'settings')
  return win
}

// A library *window* only ever comes in these two flavors — distinct from
// SoundTriggerKind (main/library/types.ts), which also includes 'user-intro'
// for data that lives inside the Command window rather than getting its own.
export type LibraryWindowKind = 'command' | 'emote'

// Opened rarely, on demand, via right-click on the Command/Emote HUD tiles.
// Command and Emote share this one renderer, distinguished by ?kind=.
// Frameless, same as the Settings window.
export function createLibraryWindow(kind: LibraryWindowKind, onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 640
  const height = 560

  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    title: kind === 'command' ? 'MultiBot Command Manager' : 'MultiBot Emote Manager',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/library.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'library', { kind })
  return win
}

// Opened rarely, via right-click on the Text-to-Speech HUD tile. Same
// frameless pattern as the Library windows, just a simpler form (no tabs,
// no file handling).
//
// Resizable, like the AtMe and Media windows and unlike the rest of the
// simple forms: the voice picker is a list, and on Linux it's a list of
// ~15,000 entries, so a fixed height that suits a few dozen macOS voices is
// the wrong shape for the same window elsewhere. The renderer lets the list
// absorb the extra height. It was previously 320px tall and fixed, which
// clipped everything below the voice list outright.
export function createTtsSettingsWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 420
  const height = 560

  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    title: 'MultiBot Text-To-Speech Settings',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/ttsSettings.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'tts-settings')
  return win
}

// Opened rarely, via right-click on the AtMe HUD tile. Unlike the other
// manager windows, this one is resizable — its whole point is a list that
// can grow during a viewer influx, so the streamer needs to be able to make
// it bigger rather than being stuck scrolling a fixed-size panel.
export function createAtMeQueueWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 420
  const height = 480

  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    title: 'MultiBot AtMe Queue',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/atMeQueue.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'atme-queue')
  return win
}

// Opened via right-click on the Media HUD tile. Resizable like the AtMe queue
// — it lists the streamer's whole media library, which can get long.
export function createMediaWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 760
  const height = 560

  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    title: 'MultiBot Media Manager',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/mediaLibrary.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'media')
  return win
}

// Opened via right-click on the Celebration HUD tile. Small fixed form — the
// fireworks themselves render in OBS, not here.
export function createCelebrationWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 560
  const height = 480

  const win = new BrowserWindow({
    width,
    height,
    resizable: false,
    frame: false,
    title: 'MultiBot Celebration',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/celebration.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'celebration')
  return win
}

// Opened via right-click on the Coinks HUD tile. Taller than the Celebration
// window because it also shows the turn queue and the local leaderboard.
export function createCoinksWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 560
  const height = 760

  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    title: 'MultiBot Coinks',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/coinks.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'coinks')
  return win
}

// Opened via right-click on the Hype Train HUD tile. Small fixed form like
// Celebration's — the battle itself renders in OBS, not here. No bits-price
// row: unlike Celebration/Coinks this bot isn't chat/bits-triggered, it's
// driven entirely by Twitch's own Hype Train detection over EventSub.
export function createHypeTrainWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  const width = 540
  const height = 520

  const win = new BrowserWindow({
    width,
    height,
    resizable: false,
    frame: false,
    title: 'MultiBot Hype Train',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/hypeTrain.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'hypetrain')
  return win
}

// Opened via clicking the update badge next to the HUD's settings button.
// Small fixed form like Celebration/Hype Train — release notes can run long,
// so unlike those it scrolls internally (see style.css) rather than growing
// the window to fit.
export function createUpdateDetailsWindow(onClose: () => void, hudWindow?: BrowserWindow): BrowserWindow {
  // Wide enough for the three action buttons (one of which is a full sentence)
  // to sit on one row, and tall enough that release notes get usable space.
  // The renderer keeps the page itself from ever scrolling — only the notes
  // pane does — so this height controls how much of the notes show, not
  // whether the buttons are reachable.
  const width = 520
  const height = 520

  const win = new BrowserWindow({
    width,
    height,
    resizable: false,
    frame: false,
    title: 'MultiBot Update Available',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
      preload: join(__dirname, '../preload/updateDetails.js'),
    }
  })
  win.on('closed', onClose)
  loadRenderer(win, 'update-details')
  return win
}

// Shows Twitch's own login/authorize page for the OAuth implicit-grant flow.
// No preload — the main process intercepts the redirect via webContents
// navigation events, not renderer JS, so there's no need for an API bridge.
export function createAuthWindow(hudWindow?: BrowserWindow): BrowserWindow {
  const width = 500
  const height = 650

  return new BrowserWindow({
    width,
    height,
    title: 'Log in with Twitch',
    icon: appIcon(),
    ...positionAboveHud(hudWindow, width, height),
    webPreferences: {
    }
  })
}

// Never shown. Exists purely to host <audio> and speechSynthesis, which are
// only available in a renderer/DOM context, without putting anything on screen.
export function createPlaybackWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/playback.js'),
      // Chromium deprioritizes timers/resource loading for hidden renderers
      // by default. This window is permanently show:false, so without this
      // it's always "backgrounded" — causing intermittent audio load
      // failures rather than a consistent, easy-to-spot bug.
      backgroundThrottling: false
    }
  })
  loadRenderer(win, 'playback')
  return win
}
