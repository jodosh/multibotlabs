import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'
import type { MediaLibrary, MediaTrigger } from '../library/mediaLibrary'

const COOLDOWN_MS = 20_000

function normalizeCommandText(text: string): string {
  return text.startsWith('!') ? text.slice(1) : text
}

/**
 * Ported from MediaGif/MediaBotWindow.xaml.cs: a chat command shows a gif,
 * image, or video on the stream overlay.
 *
 * Two deliberate changes from the original. It keeps its own cooldown map
 * rather than using the shared PlaybackQueue, because that queue is
 * single-flight by design (sounds must not overlap) whereas overlay media at
 * different anchors happily coexists. And the old app's `_isPlaying` global
 * lock is not reproduced — it set and cleared the flag in the same breath, so
 * it never actually prevented anything; the per-item cooldown is the real
 * throttle and always was.
 */
export class MediaGifModule implements IBotModule {
  readonly id = 'media-gif'
  readonly displayName = 'Media'
  readonly description = 'Shows a gif, image, or video on the stream overlay when chat uses a matching !command.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private readonly cooldownUntil = new Map<string, number>()
  private readonly onMessage = (event: ChatMessageEvent): void => this.handleMessage(event)

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly library: MediaLibrary,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly playMedia: (entry: MediaTrigger) => void
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
    if (!event.text.startsWith('!')) return

    const firstWord = normalizeCommandText(event.text.trim()).toLowerCase().split(/\s/)[0]
    const entry = this.library
      .list()
      .find((candidate) => normalizeCommandText(candidate.command).toLowerCase() === firstWord)
    if (!entry) return

    const cooldown = this.cooldownUntil.get(entry.id) ?? 0
    if (Date.now() < cooldown) return
    this.cooldownUntil.set(entry.id, Date.now() + COOLDOWN_MS)

    this.playMedia(entry)
  }
}
