import type { PlaybackApi } from '../../preload/playback'

declare global {
  interface Window {
    playbackApi: PlaybackApi
  }
}

window.playbackApi.onPlaySound((url, volume) => {
  const audio = new Audio(url)
  audio.volume = volume

  // Whatever happens, tell main we're done — otherwise a failed play()
  // leaves playbackQueue's single-flight lock stuck forever, silently
  // blocking every future Command/Emote sound until the app restarts.
  //
  // Explicitly releasing the element (pause + drop src + load) matters
  // here specifically: this window is long-lived and never navigates away,
  // so nothing else ever reclaims the underlying media/decoder resources an
  // HTMLMediaElement holds. Over a long session with many sounds triggered,
  // leaving that to garbage collection risks exhausting Chromium's media
  // resource pool, at which point *new* loads start failing with a generic
  // "no supported source" error that has nothing to do with the new file
  // itself — indistinguishable from a real codec problem unless you know to
  // look for it.
  const finish = (): void => {
    window.playbackApi.notifyEnded()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }

  audio.addEventListener('ended', finish)
  audio.addEventListener('error', () => {
    window.playbackApi.reportError(`failed to load audio: ${url}`)
    finish()
  })

  audio.play().catch((error: unknown) => {
    window.playbackApi.reportError(`audio.play() rejected: ${error instanceof Error ? error.message : String(error)}`)
    finish()
  })
})

window.playbackApi.onSpeak((text, voiceName) => {
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.name === voiceName)
  if (voice) utterance.voice = voice
  utterance.addEventListener('error', (event) => {
    window.playbackApi.reportError(`speechSynthesis error: ${event.error}`)
  })
  window.speechSynthesis.speak(utterance)
})
