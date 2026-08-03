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

export interface ImportSummary {
  importedSounds: number
  importedTextReplies: number
  skipped: string[]
}

export type PlayTriggerSoundFn = (filePath: string, volume: number) => void
