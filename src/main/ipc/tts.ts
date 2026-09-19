import { ipcMain } from 'electron'
import { getSettings, saveSettings } from '../app/settingsState'
import { soundLibrary } from '../app/services'
import { TTS_COMMAND } from '../modules/textToSpeechModule'

export function registerTtsIpc(): void {
  ipcMain.handle('tts-settings:get', () => getSettings().modules.textToSpeech)

  // Reports Command-bot entries the free !tts command would shadow, so the
  // TTS window can warn about them. Checked live on each open rather than
  // cached: the Library window can add a !tts entry at any time.
  ipcMain.handle('tts-settings:command-conflicts', () => {
    const matches = (text: string): boolean =>
      (text.startsWith('!') ? text.slice(1) : text).trim().toLowerCase() === TTS_COMMAND

    return {
      sounds: soundLibrary.listSounds('command').filter((sound) => matches(sound.trigger)).length,
      textReplies: soundLibrary.listTextReplies().filter((reply) => matches(reply.command)).length
    }
  })

  ipcMain.handle(
    'tts-settings:set',
    async (_event, patch: Partial<{ enabled: boolean; minimumBits: number; voiceName: string; freeCommandEnabled: boolean }>) => {
      getSettings().modules.textToSpeech = { ...getSettings().modules.textToSpeech, ...patch }
      await saveSettings()
    }
  )
}
