import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'

export interface TextToSpeechConfig {
  minimumBits: number
  voiceName: string
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
    const { minimumBits, voiceName } = this.config()
    if (event.bits < minimumBits || !event.text) return

    const firstSpace = event.text.indexOf(' ')
    const speechText = firstSpace < 0 ? event.text : event.text.slice(firstSpace + 1)

    this.speak(speechText, voiceName)
  }
}
