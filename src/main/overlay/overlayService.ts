import { OverlayServer } from './overlayServer'
import { getSettings } from '../app/settingsState'
import { mediaLibrary, coinksScores } from '../app/services'
import { moduleRefs } from '../modules/moduleRefs'
import { rendererRoot, gameAssetsRoot, hypeAssetsRoot } from '../app/paths'
import * as windows from '../windows/windowRegistry'
import type { MediaTrigger } from '../library/mediaLibrary'
import type { CoinksState } from '../modules/coinksModule'
import type { HypeTrainBattleEvent } from '../modules/hypeTrainModule'

// The overlay server instance and the helpers that talk to it live in the same
// module on purpose, and should not be separated.
//
// They are mutually dependent: the helpers read overlayServer.status /
// .clientCount() / .broadcast(), while the server's own constructor callbacks
// call the helpers. Splitting them puts an import cycle through whichever file
// constructs the server — and if that file is the entry point, the cycle
// resolves with empty exports and fails at runtime rather than at build time.
// Keeping them together makes the dependency a local detail instead.

export const overlayServer = new OverlayServer(
  rendererRoot,
  (id) => mediaLibrary.get(id),
  () => {
    broadcastOverlayStatus()
    broadcastCelebrationOverlayStatus()
    broadcastCoinksOverlayStatus()
    broadcastHypeTrainOverlayStatus()
  },
  (result) => {
    void coinksScores.record(result.player, result.score)
    moduleRefs.coinks?.finishGame(result.player)
  },
  gameAssetsRoot,
  hypeAssetsRoot
)

export function overlayStatus(): {
  status: string
  url: string
  port: number
  clients: number
  error?: string
} {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl(),
    // `||`, not `??`: port is 0 when the server isn't listening, and 0 must
    // fall through to the configured port rather than be reported as the
    // current one.
    port: overlayServer.port || getSettings().modules.mediaGif.overlayPort,
    clients: overlayServer.clientCount('media'),
    error: overlayServer.lastError
  }
}

export function broadcastOverlayStatus(): void {
  windows.send('media', 'media:overlay-status-changed', overlayStatus())
}

export function celebrationOverlayStatus(): { status: string; url: string; clients: number; error?: string } {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl('overlay-fireworks'),
    clients: overlayServer.clientCount('fireworks'),
    error: overlayServer.lastError
  }
}

export function broadcastCelebrationOverlayStatus(): void {
  windows.send('celebration', 'celebration:overlay-status-changed', celebrationOverlayStatus())
}

export function startFireworks(shells: number): void {
  overlayServer.broadcast({ type: 'celebration:fireworks', shells, volume: getSettings().modules.celebration.volume })
}

export function coinksOverlayStatus(): { status: string; url: string; clients: number; error?: string } {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl('overlay-coinks'),
    clients: overlayServer.clientCount('coinks'),
    error: overlayServer.lastError
  }
}

export function broadcastCoinksOverlayStatus(): void {
  windows.send('coinks', 'coinks:overlay-status-changed', coinksOverlayStatus())
}

export function broadcastCoinksState(state: CoinksState): void {
  windows.send('coinks', 'coinks:state-changed', state)
}

// Translates HypeTrainModule's battle events into overlay broadcasts — kept
// here rather than in the module itself so the module stays settings-agnostic
// (volume only needs adding to the 'begin' event; the overlay remembers it
// for the rest of the battle, same as Celebration/Coinks).
export function broadcastHypeTrainBattleEvent(event: HypeTrainBattleEvent): void {
  if (event.type === 'hypetrain:begin') {
    overlayServer.broadcast({ ...event, volume: getSettings().modules.hypeTrain.volume })
  } else {
    overlayServer.broadcast(event)
  }
  broadcastHypeTrainState()
}

export function hypeTrainOverlayStatus(): { status: string; url: string; clients: number; error?: string } {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl('overlay-hypetrain'),
    clients: overlayServer.clientCount('hype-train'),
    error: overlayServer.lastError
  }
}

export function broadcastHypeTrainOverlayStatus(): void {
  windows.send('hype-train', 'hype-train:overlay-status-changed', hypeTrainOverlayStatus())
}

export function broadcastHypeTrainState(): void {
  windows.send('hype-train', 'hype-train:state-changed', moduleRefs.hypeTrain?.state())
}

// Media is addressed by id over HTTP rather than by file path — the overlay
// page is a browser source on a different origin from the filesystem, so it
// can't read local files directly (the same constraint that made sounds use
// data: URLs, solved here by simply serving them).
export function playMedia(entry: MediaTrigger): void {
  overlayServer.broadcast({
    type: 'media:play',
    id: entry.id,
    url: `/media/${entry.id}`,
    element: entry.element,
    anchor: entry.anchor,
    durationSeconds: entry.durationSeconds,
    volume: entry.volume
  })
}
