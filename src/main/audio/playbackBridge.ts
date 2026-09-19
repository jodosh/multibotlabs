import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { resourcesRoot } from '../app/paths'
import * as windows from '../windows/windowRegistry'

// Everything that reaches the hidden playback window. That window exists only
// because <audio> and speechSynthesis need a real DOM; the main process has no
// way to make a sound itself.

const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm'
}

// Sent as a data: URL rather than a file:// path — the playback window's
// page is loaded from Vite's dev server (http://localhost) in `npm run dev`
// and from file:// in a built/packaged run. Chromium blocks a file://
// resource load from an http:// page ("Media load rejected by URL safety
// check"), so file:// only ever worked by coincidence when testing the
// built app. A data: URL is just embedded content, not a filesystem
// reference, so it's unaffected by the page's origin either way.
async function sendPlaySound(filePath: string, volume: number): Promise<void> {
  try {
    const buffer = await readFile(filePath)
    const mimeType = AUDIO_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    windows.sendPlayback('playback:play-sound', dataUrl, volume)
  } catch (error) {
    console.error('[playback] failed to read sound file:', filePath, error)
  }
}

// Bundled reaction sounds (Live Studio Audience), addressed by filename
// under resources/sounds/. Distinct from playTriggerSound below.
export function playSound(fileName: string): void {
  const filePath = join(resourcesRoot(), 'sounds', fileName)
  void sendPlaySound(filePath, 1)
}

// User-added library sounds (Command/Emote), addressed by absolute path
// under userData/sounds/.
export function playTriggerSound(filePath: string, volume: number): void {
  void sendPlaySound(filePath, volume)
}

export function speak(text: string, voiceName: string): void {
  windows.sendPlayback('playback:speak', text, voiceName)
}
