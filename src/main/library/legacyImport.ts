import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SoundLibrary } from './soundLibrary'
import type { ImportSummary, SoundTriggerKind } from './types'

// commands.json — the old CommandBotWindow.SaveJson() wrote Sound objects
// flat: FilePath/FileName/Description/Volume at the top level.
interface LegacySound {
  FilePath?: string
  FileName?: string
  Description?: string
  Volume?: number
}

// emotes.json — EmoteBot.SaveEmoteJson() wrote a different shape: the emote
// name in Description, with the sound *nested* under a Sound object rather
// than inlined. Reading it with the flat LegacySound shape above finds no
// FilePath on any entry and silently imports nothing, which is exactly what
// this file used to do.
//
// Sound is frequently absent or empty: the old app merged the channel's full
// emote list from Twitch's API into this file, so it holds every emote the
// channel has, not only the ones a sound was ever attached to.
interface LegacyEmote {
  Description?: string
  ImageURL?: string
  Sound?: LegacySound | null
}

interface LegacyTextCommand {
  Command?: string
  Description?: string
}

// Running an import twice is expected — the button stays available so a
// failed or partial run can be retried — and SoundLibrary.importSound() has
// no notion of duplicates, so it would copy the audio file and add a second
// row every time. Matching is case-insensitive to agree with commandModule.ts
// and emoteModule.ts, which look triggers up that way.
// The set is live rather than a snapshot: entries added during this run are
// registered as they go, so a file that lists the same trigger twice doesn't
// produce two library rows.
function existingTriggers(library: SoundLibrary, kind: SoundTriggerKind): Set<string> {
  return new Set(library.listSounds(kind).map((sound) => sound.trigger.trim().toLowerCase()))
}

function triggerKey(trigger: string): string {
  return trigger.trim().toLowerCase()
}

async function readLegacyJson<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

// One entry's worth of work, shared by the command and emote importers now
// that they no longer agree on where the sound fields live.
async function importOne(
  library: SoundLibrary,
  kind: SoundTriggerKind,
  trigger: string | undefined,
  sound: LegacySound | null | undefined,
  seen: Set<string>,
  summary: ImportSummary,
  sourceLabel: string
): Promise<void> {
  if (!trigger) {
    summary.skipped.push(`${sourceLabel}: entry with no name`)
    return
  }

  if (!sound?.FilePath) {
    summary.withoutSound += 1
    return
  }

  if (seen.has(triggerKey(trigger))) {
    summary.alreadyPresent += 1
    return
  }

  try {
    await fs.access(sound.FilePath)
  } catch {
    summary.skipped.push(`${trigger}: sound file not found (${sound.FilePath})`)
    return
  }

  await library.importSound(
    kind,
    trigger,
    sound.FilePath,
    sound.FileName ?? path.basename(sound.FilePath),
    sound.Volume ?? 0.5
  )
  seen.add(triggerKey(trigger))
  summary.importedSounds += 1
}

// Shared by the sound and media importers, and by the Settings window to
// decide whether the "Import from old MultiBot" section is worth showing
// at all — on a machine that never ran the old .NET app, this is always
// false and the section stays hidden rather than offering a button that
// would just report zero imports.
export function legacyDataDir(): string {
  return path.join(app.getPath('appData'), 'MultiBot')
}

export async function legacyDataExists(): Promise<boolean> {
  try {
    const stat = await fs.stat(legacyDataDir())
    return stat.isDirectory()
  } catch {
    return false
  }
}

// Looks for the old .NET app's data directory — %APPDATA%\MultiBot on
// Windows, matching where it actually wrote commands.json/emotes.json. On
// Linux/macOS this naturally finds nothing, since the old app never ran
// there, so no platform branching is needed.
export async function importLegacyData(library: SoundLibrary): Promise<ImportSummary> {
  const legacyRoot = legacyDataDir()
  const summary: ImportSummary = {
    importedSounds: 0,
    importedTextReplies: 0,
    alreadyPresent: 0,
    withoutSound: 0,
    skipped: []
  }

  const commands = await readLegacyJson<LegacySound>(path.join(legacyRoot, 'commands.json'))
  const seenCommands = existingTriggers(library, 'command')
  for (const entry of commands) {
    await importOne(library, 'command', entry.Description, entry, seenCommands, summary, 'commands.json')
  }

  const emotes = await readLegacyJson<LegacyEmote>(path.join(legacyRoot, 'emotes.json'))
  const seenEmotes = existingTriggers(library, 'emote')
  for (const entry of emotes) {
    await importOne(library, 'emote', entry.Description, entry.Sound, seenEmotes, summary, 'emotes.json')
  }

  const textCommands = await readLegacyJson<LegacyTextCommand>(path.join(legacyRoot, 'commands_text.json'))
  const existingReplies = new Set(library.listTextReplies().map((reply) => reply.command.trim().toLowerCase()))
  for (const entry of textCommands) {
    if (!entry.Command || !entry.Description) {
      summary.skipped.push('commands_text.json: entry missing Command/Description')
      continue
    }
    if (existingReplies.has(entry.Command.trim().toLowerCase())) {
      summary.alreadyPresent += 1
      continue
    }
    await library.addTextReply(entry.Command, entry.Description)
    existingReplies.add(entry.Command.trim().toLowerCase())
    summary.importedTextReplies += 1
  }

  return summary
}
