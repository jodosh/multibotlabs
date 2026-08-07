import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SoundLibrary } from './soundLibrary'
import type { ImportSummary, SoundTriggerKind } from './types'

interface LegacySound {
  FilePath: string
  FileName: string
  Description?: string
  Volume: number
}

interface LegacyTextCommand {
  Command?: string
  Description?: string
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

async function importSounds(
  library: SoundLibrary,
  filePath: string,
  kind: SoundTriggerKind,
  skipped: string[]
): Promise<number> {
  const entries = await readLegacyJson<LegacySound>(filePath)
  let imported = 0

  for (const entry of entries) {
    if (!entry.Description || !entry.FilePath) {
      skipped.push(`${path.basename(filePath)}: entry missing Description/FilePath`)
      continue
    }

    try {
      await fs.access(entry.FilePath)
    } catch {
      skipped.push(`${entry.Description}: source file not found (${entry.FilePath})`)
      continue
    }

    await library.importSound(
      kind,
      entry.Description,
      entry.FilePath,
      entry.FileName ?? path.basename(entry.FilePath),
      entry.Volume ?? 0.5
    )
    imported += 1
  }

  return imported
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
  const skipped: string[] = []

  const importedSounds =
    (await importSounds(library, path.join(legacyRoot, 'commands.json'), 'command', skipped)) +
    (await importSounds(library, path.join(legacyRoot, 'emotes.json'), 'emote', skipped))

  const textCommands = await readLegacyJson<LegacyTextCommand>(path.join(legacyRoot, 'commands_text.json'))
  let importedTextReplies = 0
  for (const entry of textCommands) {
    if (!entry.Command || !entry.Description) {
      skipped.push('commands_text.json: entry missing Command/Description')
      continue
    }
    await library.addTextReply(entry.Command, entry.Description)
    importedTextReplies += 1
  }

  return { importedSounds, importedTextReplies, skipped }
}
