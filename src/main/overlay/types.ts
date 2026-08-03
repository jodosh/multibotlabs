// Shared by the main process (which broadcasts) and the overlay renderer
// (which consumes), so a contract change is a typecheck failure rather than
// a silent runtime no-op — the failure mode the old WPF/Unity split had,
// where two hand-maintained DTOs could drift apart with no warning.

export type MediaAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export const MEDIA_ANCHORS: MediaAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
]

export type MediaElementKind = 'image' | 'video'

export interface MediaPlayEvent {
  type: 'media:play'
  id: string
  url: string
  element: MediaElementKind
  anchor: MediaAnchor
  durationSeconds: number
  volume: number
}

export interface FireworksShowEvent {
  type: 'celebration:fireworks'
  shells: number
  /** 0-1. Carried on the event so the overlay needs no config endpoint. */
  volume: number
}

export interface CoinksStartEvent {
  type: 'coinks:start'
  player: string
  coins: number
  /** 0-1. Carried on the event so the overlay needs no config endpoint. */
  volume: number
}

export interface CoinksThrowEvent {
  type: 'coinks:throw'
}

/** Sent back over HTTP by the coinks overlay when a game ends. */
export interface CoinksResult {
  player: string
  score: number
}

// Namespaced by feature so each overlay page can filter the shared SSE stream
// down to what it renders, and so future overlays (Coniks) extend this union
// rather than inventing another transport.
export type OverlayEvent = MediaPlayEvent | FireworksShowEvent | CoinksStartEvent | CoinksThrowEvent

// Which overlay page a client is; used to scope SSE client counts so each
// manager window reports only its own source being connected.
export type OverlayFeature = 'media' | 'fireworks' | 'coinks'
