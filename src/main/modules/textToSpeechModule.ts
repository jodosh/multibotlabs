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
    // Both paths drop the first word: the cheer path because the bits token
    // ("Cheer100") leads the message, the command path because "!tts" does.
    const rest = firstSpace < 0 ? '' : trimmed.slice(firstSpace + 1).trim()

    const isTtsCommand = trimmed.startsWith('!') && trimmed.slice(1).split(/\s/)[0].toLowerCase() === TTS_COMMAND

    if (freeCommandEnabled && isTtsCommand) {
      // "!tts" with nothing after it has nothing to say — speaking the bare
      // command back would just read the word "tts" aloud.
      if (rest) this.speak(rest, voiceName)
      return
    }

    if (event.bits < minimumBits) return

    // Preserved from the original port: a message with no space at all is
    // spoken whole rather than reduced to nothing.
    this.speak(firstSpace < 0 ? trimmed : rest, voiceName)
  }
}
