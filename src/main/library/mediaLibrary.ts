import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MediaAnchor, MediaElementKind } from '../overlay/types'
import { legacyDataDir } from './legacyImport'

export interface MediaTrigger {
  id: string
  command: string
  fileName: string
  filePath: string
  element: MediaElementKind
  anchor: MediaAnchor
  durationSeconds: number
  volume: number
}

export interface MediaImportSummary {
  imported: number
  skipped: string[]
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])
export const SUPPORTED_MEDIA_EXTENSIONS = ['gif', 'png', 'apng', 'webp', 'jpg', 'jpeg', 'mp4', 'webm']

const DEFAULT_DURATION_SECONDS = 5

// A browser can't tell us how long an animated GIF runs without decoding it,
// so duration is always explicit rather than inferred. The old app had the
// same field (PlaybackDuration) for the same reason.
//
// There is deliberately no `loop` setting. Animated GIFs already loop on their
// own, so the old app's Loop flag never did anything for them; video is simply
// always looped so it behaves the same way. Duration is the single answer to
// "how long is this on screen", for every media type.
export function elementKindFor(filePath: string): MediaElementKind {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? 'video' : 'image'
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

// Owns the media library for the MediaGif overlay bot: persistence, CRUD, and
// copying picked files into userData/media/. Deliberately a close mirror of
// soundLibrary.ts rather than a shared abstraction — the entries carry
// presentation fields (anchor/duration) that sounds have no analogue for,
// and forcing one schema to cover both would distort both.
export class MediaLibrary {
  private readonly mediaFile: string
  private readonly mediaDir: string
  private media: MediaTrigger[] = []
  private loaded = false

  constructor() {
    const root = app.getPath('userData')
    this.mediaFile = path.join(root, 'media-triggers.json')
    this.mediaDir = path.join(root, 'media')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.media = await readJsonArray<MediaTrigger>(this.mediaFile)
    this.loaded = true
  }

  list(): MediaTrigger[] {
    return [...this.media]
  }

  get(id: string): MediaTrigger | undefined {
    return this.media.find((entry) => entry.id === id)
  }

  async add(command: string, sourceFilePath: string): Promise<MediaTrigger> {
    await fs.mkdir(this.mediaDir, { recursive: true })
    const id = randomUUID()
    const outputPath = path.join(this.mediaDir, `${id}${path.extname(sourceFilePath)}`)
    await fs.copyFile(sourceFilePath, outputPath)

    const entry: MediaTrigger = {
      id,
      command,
      fileName: path.basename(sourceFilePath),
      filePath: outputPath,
      element: elementKindFor(sourceFilePath),
      anchor: 'center',
      durationSeconds: DEFAULT_DURATION_SECONDS,
      volume: 0.5
    }
    this.media.push(entry)
    await this.save()
    return entry
  }

  async update(
    id: string,
    patch: Partial<Pick<MediaTrigger, 'command' | 'anchor' | 'durationSeconds' | 'volume'>>
  ): Promise<void> {
    const entry = this.media.find((candidate) => candidate.id === id)
    if (!entry) return
    Object.assign(entry, patch)
    await this.save()
  }

  async remove(id: string): Promise<void> {
    const entry = this.media.find((candidate) => candidate.id === id)
    if (!entry) return
    this.media = this.media.filter((candidate) => candidate.id !== id)
    await this.save()
    await fs.rm(entry.filePath, { force: true })
  }

  // Import path for the old .NET app's gifMediaCommands.json. Same approach as
  // legacyImport.ts: %APPDATA%\MultiBot on Windows, naturally a no-op elsewhere
  // since the old app never ran on Linux/macOS.
  async importLegacy(): Promise<MediaImportSummary> {
    const entries = await readJsonArray<LegacyGifMedia>(path.join(legacyDataDir(), 'gifMediaCommands.json'))
    const skipped: string[] = []
    let imported = 0

    for (const entry of entries) {
      if (!entry.Command || !entry.FilePath) {
        skipped.push('gifMediaCommands.json: entry missing Command/FilePath')
        continue
      }

      try {
        await fs.access(entry.FilePath)
      } catch {
        skipped.push(`${entry.Command}: source file not found (${entry.FilePath})`)
        continue
      }

      // entry.Loop is intentionally dropped — see the note on DEFAULT_DURATION_SECONDS.
      const added = await this.add(entry.Command, entry.FilePath)
      await this.update(added.id, {
        anchor: legacyAnchor(entry.Location),
        durationSeconds: entry.PlaybackDuration && entry.PlaybackDuration > 0 ? entry.PlaybackDuration : DEFAULT_DURATION_SECONDS
      })
      imported += 1
    }

    return { imported, skipped }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.mediaFile), { recursive: true })
    await fs.writeFile(this.mediaFile, JSON.stringify(this.media, null, 2), 'utf-8')
  }
}

interface LegacyGifMedia {
  Command?: string
  FileName?: string
  FilePath?: string
  PlaybackDuration?: number
  Loop?: boolean
  Location?: string
}

// The old app stored its 9 positions as PascalCase strings ("BottomRight").
function legacyAnchor(location: string | undefined): MediaAnchor {
  switch ((location ?? '').toLowerCase()) {
    case 'topleft':
      return 'top-left'
    case 'topcenter':
      return 'top-center'
    case 'topright':
      return 'top-right'
    case 'centerleft':
      return 'center-left'
    case 'centerright':
      return 'center-right'
    case 'bottomleft':
      return 'bottom-left'
    case 'bottomcenter':
      return 'bottom-center'
    case 'bottomright':
      return 'bottom-right'
    default:
      return 'center'
  }
}
