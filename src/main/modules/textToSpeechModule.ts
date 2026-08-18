import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'

export interface TextToSpeechConfig {
  minimumBits: number
  voiceName: string
  freeCommandEnabled: boolean
}

// The free-speech command, matched case-insensitively as the message's first
// word. commandModule.ts skips this same name while free TTS is on, the way
// it already yields "!intro" to User Intros — so the two bots can't both
// answer one message.
export const TTS_COMMAND = 'tts'

// Twitch puts the cheermote tokens inline in the message text ("Cheer100 hey",
// "hey Cheer100 there", "uni500 uni500 hi") and reports only the total in the
// tags, so they have to be removed before speaking or the bot reads "cheer one
// hundred" aloud. A token is an alphabetic prefix followed by an amount —
// the prefix set is open-ended (Cheer, uni, and per-channel ones), so this
// matches by shape rather than by a fixed list.
const CHEERMOTE_TOKEN = /^[a-zA-Z]+[1-9]\d*$/

function stripCheermotes(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => !CHEERMOTE_TOKEN.test(token))
    .join(' ')
    .trim()
}

export type SpeakFn = (text: string, voiceName: string) => void

/**
 * Ported from TextToSpeech/TextToSpeechWindow.xaml.cs: speak the chat message
 * when its bits cheer meets the configured minimum, stripping the leading
 * word the same way the original did (Substring past the first space, or the
 * whole message unchanged if there's no space at all).
 */
export class TextToSpeechModule implements IBotModule {
  readonly id = 'text-to-speech'
  readonly displayName = 'Text-To-Speech'
  readonly description = 'Speaks chat messages aloud when a viewer cheers enough bits.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private readonly onMessage = (event: ChatMessageEvent): void => this.handleMessage(event)

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly config: () => TextToSpeechConfig,
    private readonly speak: SpeakFn
  ) {}

  get status(): BotModuleStatus {
    return this._status
  }

  async start(): Promise<void> {
    if (this._status === 'running') return
    this._status = 'connecting'
    try {
      await this.chatClient.acquire(this.channel(), this.accessToken())
    } catch {
      this._status = 'error'
      return
    }
    this.chatClient.on('message', this.onMessage)
    this._status = 'running'
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped') return
    this.chatClient.off('message', this.onMessage)
    await this.chatClient.release()
    this._status = 'stopped'
  }

  private handleMessage(event: ChatMessageEvent): void {
    const { minimumBits, voiceName, freeCommandEnabled } = this.config()
    if (!event.text) return

    const trimmed = event.text.trim()
    const firstSpace = trimmed.indexOf(' ')
    const isTtsCommand = trimmed.startsWith('!') && trimmed.slice(1).split(/\s/)[0].toLowerCase() === TTS_COMMAND

    // Only a message that actually carries bits can contain a cheermote. On
    // any other message (minimumBits: 0 makes every message eligible) the
    // text is spoken exactly as typed — the original port dropped the first
    // word unconditionally, which ate a real word out of every non-cheer
    // message. A cheer can also be a !tts command, so both paths strip.
    const spoken = (text: string): string => (event.bits > 0 ? stripCheermotes(text) : text)

    if (freeCommandEnabled && isTtsCommand) {
      // Drop the "!tts" itself. Nothing after it means nothing to say —
      // speaking the bare command back would just read the word "tts" aloud.
      const args = firstSpace < 0 ? '' : spoken(trimmed.slice(firstSpace + 1).trim())
      if (args) this.speak(args, voiceName)
      return
    }

    if (event.bits < minimumBits) return

    // A cheer with no words beyond the cheermote itself has nothing to say.
    const speechText = spoken(trimmed)
    if (speechText) this.speak(speechText, voiceName)
  }
}
