import type { OverlayEvent, MediaPlayEvent } from '../../main/overlay/types'

// Not an Electron renderer: this page is served over HTTP and loaded by OBS
// as a Browser Source, so there's no preload and no window.* bridge. Its only
// input is the SSE stream, and EventSource handles reconnection on its own —
// if the app restarts, the overlay reattaches without the streamer touching it.

const stage = document.getElementById('stage') as HTMLDivElement

function showMedia(event: MediaPlayEvent): void {
  // Video always loops so it matches how an animated GIF already behaves:
  // duration alone decides how long anything stays on screen, and short media
  // repeats to fill it rather than freezing on a last frame.
  const element =
    event.element === 'video'
      ? Object.assign(document.createElement('video'), {
          src: event.url,
          autoplay: true,
          loop: true,
          volume: event.volume,
          muted: event.volume === 0
        })
      : Object.assign(document.createElement('img'), { src: event.url })

  element.className = `media ${event.anchor}`
  stage.appendChild(element)

  // `autoplay` alone is enough in Electron, but a browser source is a plain
  // Chromium with its own autoplay policy. Drive playback explicitly so a
  // refusal is visible rather than silently leaving a frozen first frame, and
  // fall back to muted — which is always permitted — so the media still plays.
  if (element instanceof HTMLVideoElement) {
    element.play().catch(() => {
      element.muted = true
      element.play().catch((error: unknown) => {
        console.error('[overlay] video playback blocked:', error)
      })
    })
  }

  // Duration is always explicit — an <img> gives no signal when an animated
  // GIF finishes a loop, so there is nothing to listen for.
  window.setTimeout(() => element.remove(), event.durationSeconds * 1000)
}

const source = new EventSource('/events?feature=media')

source.addEventListener('message', (message) => {
  let event: OverlayEvent
  try {
    event = JSON.parse(message.data) as OverlayEvent
  } catch {
    return
  }

  if (event.type === 'media:play') showMedia(event)
})
