export type SoundTriggerKind = 'command' | 'emote' | 'user-intro'

export interface SoundTrigger {
  id: string
  kind: SoundTriggerKind
  trigger: string
  fileName: string
  filePath: string
  volume: number
}

export interface TextReplyCommand {
  id: string
  command: string
  reply: string
}

// addSound() can succeed without ffmpeg having run, so it reports whether the
// file was loudness-matched to the rest of the library rather than just
// handing back the entry.
export interface AddSoundResult {
  sound: SoundTrigger
  normalized: boolean
}

export interface ImportSummary {
  importedSounds: number
  importedTextReplies: number
  // Entries whose trigger the library already has. Counted rather than listed:
  // re-running the import is normal now, so on a second run this is usually
  // every entry and would swamp `skipped` with non-problems.
  alreadyPresent: number
  // Legacy emotes with no sound ever assigned. emotes.json holds every channel
  // emote the old app fetched from Twitch, not just the configured ones, so
  // these are the overwhelming majority and are not a failure of any kind.
  withoutSound: number
  // Genuine problems worth showing the user, e.g. a sound file that has moved.
  skipped: string[]
}

export type PlayTriggerSoundFn = (filePath: string, volume: number) => void
