import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'
import type { SoundLibrary } from '../library/soundLibrary'
import type { PlaybackQueue } from '../library/playbackQueue'
import type { PlayTriggerSoundFn } from '../library/types'
import { describeError } from './describeError'

/**
 * Ported from Emote/EmoteBot.xaml.cs: plays a sound when a configured emote
 * name/code appears as a whitespace-separated token in chat. This is a
 * simpler match than the old app's use of Twitch's parsed emote-ID metadata,
 * matching the substring/token approach liveStudioAudienceModule.ts already
 * uses elsewhere in this app.
 */
export class EmoteModule implements IBotModule {
  readonly id = 'emote'
  readonly displayName = 'Emote'
  readonly description = 'Plays a sound when a configured emote appears in chat.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private _lastError: string | undefined
  private readonly onMessage = (event: ChatMessageEvent): void => this.handleMessage(event)

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly library: SoundLibrary,
    private readonly playbackQueue: PlaybackQueue,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly playTriggerSound: PlayTriggerSoundFn
  ) {}

  get status(): BotModuleStatus {
    return this._status
  }

  get lastError(): string | undefined {
    return this._lastError
  }

  async start(): Promise<void> {
    if (this._status === 'running') return
    this._lastError = undefined
    this._status = 'connecting'
    try {
      await this.chatClient.acquire(this.channel(), this.accessToken())
    } catch (error) {
      this._lastError = describeError(error)
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
    this._lastError = undefined
    this._status = 'stopped'
  }

  private handleMessage(event: ChatMessageEvent): void {
    const tokens = new Set(event.text.split(/\s+/))

    for (const emote of this.library.listSounds('emote')) {
      if (!tokens.has(emote.trigger)) continue
      if (!this.playbackQueue.tryAcquire(emote.id)) continue

      this.playTriggerSound(emote.filePath, emote.volume)
      return
    }
  }
}
