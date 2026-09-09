import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeAudio, FfmpegUnavailableError } from './ffmpeg'
import type { AddSoundResult, SoundTrigger, SoundTriggerKind, TextReplyCommand } from './types'

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

// Owns the sound-command/emote library: persistence, CRUD, and turning a
// picked local file into a normalized entry under userData/sounds/. This is
// the main-process surface the library manager window drives over IPC.
export class SoundLibrary {
  private readonly soundsFile: string
  private readonly textRepliesFile: string
  private readonly audioDir: string
  private sounds: SoundTrigger[] = []
  private textReplies: TextReplyCommand[] = []
  private loaded = false

  constructor() {
    const root = app.getPath('userData')
    this.soundsFile = path.join(root, 'sound-triggers.json')
    this.textRepliesFile = path.join(root, 'text-replies.json')
    this.audioDir = path.join(root, 'sounds')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.sounds = await readJsonArray<SoundTrigger>(this.soundsFile)
    this.textReplies = await readJsonArray<TextReplyCommand>(this.textRepliesFile)
    this.loaded = true
  }

  listSounds(kind?: SoundTriggerKind): SoundTrigger[] {
    return kind ? this.sounds.filter((sound) => sound.kind === kind) : [...this.sounds]
  }

  listTextReplies(): TextReplyCommand[] {
    return [...this.textReplies]
  }

  // Used by the "+ Add Sound" UI flow: normalizes the picked file via ffmpeg.
  //
  // If ffmpeg isn't available the sound is still added, just copied verbatim
  // instead of loudness-matched. Refusing outright left streamers unable to add
  // any sound at all when antivirus quarantined the bundled binary, which is a
  // worse outcome than one sound sitting louder or quieter than its neighbours
  // — and that one is fixable from the row's volume slider. `normalized` in the
  // result is what lets the UI say so rather than failing silently.
  async addSound(
    kind: SoundTriggerKind,
    trigger: string,
    sourceFilePath: string,
    volume: number
  ): Promise<AddSoundResult> {
    await fs.mkdir(this.audioDir, { recursive: true })
    const id = randomUUID()

    let filePath = path.join(this.audioDir, `${id}.mp3`)
    let normalized = true

    try {
      await normalizeAudio(sourceFilePath, filePath)
    } catch (error) {
      // Anything else — a corrupt file, an unsupported codec — is a real
      // failure the streamer needs to see, so it still propagates.
      if (!(error instanceof FfmpegUnavailableError)) throw error

      // Keep the source extension: main/index.ts derives the playback MIME
      // type from it, so copying a .wav to a .mp3 name would produce a data:
      // URL the playback window can't decode.
      filePath = path.join(this.audioDir, `${id}${path.extname(sourceFilePath)}`)
      await fs.copyFile(sourceFilePath, filePath)
      normalized = false
    }

    const entry: SoundTrigger = {
      id,
      kind,
      trigger,
      fileName: path.basename(sourceFilePath),
      filePath,
      volume
    }
    this.sounds.push(entry)
    await this.saveSounds()
    return { sound: entry, normalized }
  }

  // Used by legacy import: the old app already normalized these files, so
  // just copy them over rather than re-encoding.
  async importSound(
    kind: SoundTriggerKind,
    trigger: string,
    sourceFilePath: string,
    fileName: string,
    volume: number
  ): Promise<SoundTrigger> {
    await fs.mkdir(this.audioDir, { recursive: true })
    const id = randomUUID()
    const outputPath = path.join(this.audioDir, `${id}${path.extname(sourceFilePath)}`)
    await fs.copyFile(sourceFilePath, outputPath)

    const entry: SoundTrigger = { id, kind, trigger, fileName, filePath: outputPath, volume }
    this.sounds.push(entry)
    await this.saveSounds()
    return entry
  }

  async updateSound(id: string, patch: Partial<Pick<SoundTrigger, 'trigger' | 'volume'>>): Promise<void> {
    const sound = this.sounds.find((candidate) => candidate.id === id)
    if (!sound) return
    Object.assign(sound, patch)
    await this.saveSounds()
  }

  async removeSound(id: string): Promise<void> {
    const sound = this.sounds.find((candidate) => candidate.id === id)
    if (!sound) return
    this.sounds = this.sounds.filter((candidate) => candidate.id !== id)
    await this.saveSounds()
    await fs.rm(sound.filePath, { force: true })
  }

  async addTextReply(command: string, reply: string): Promise<TextReplyCommand> {
    const entry: TextReplyCommand = { id: randomUUID(), command, reply }
    this.textReplies.push(entry)
    await this.saveTextReplies()
    return entry
  }

  async updateTextReply(id: string, patch: Partial<Pick<TextReplyCommand, 'command' | 'reply'>>): Promise<void> {
    const reply = this.textReplies.find((candidate) => candidate.id === id)
    if (!reply) return
    Object.assign(reply, patch)
    await this.saveTextReplies()
  }

  async removeTextReply(id: string): Promise<void> {
    this.textReplies = this.textReplies.filter((candidate) => candidate.id !== id)
    await this.saveTextReplies()
  }

  private async saveSounds(): Promise<void> {
    await fs.mkdir(path.dirname(this.soundsFile), { recursive: true })
    await fs.writeFile(this.soundsFile, JSON.stringify(this.sounds, null, 2), 'utf-8')
  }

  private async saveTextReplies(): Promise<void> {
    await fs.mkdir(path.dirname(this.textRepliesFile), { recursive: true })
    await fs.writeFile(this.textRepliesFile, JSON.stringify(this.textReplies, null, 2), 'utf-8')
  }
}
