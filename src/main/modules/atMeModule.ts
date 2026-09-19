import { randomUUID } from 'node:crypto'
import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'
import { describeError } from './describeError'

export type AtMeReason = 'mention' | 'highlight'

export interface AtMeQueueItem {
  id: string
  username: string
  text: string
  reasons: AtMeReason[]
  timestamp: number
}

export interface AtMeConfig {
  matchMentions: boolean
  matchHighlights: boolean
}

/**
 * Not a sound trigger like the other bots — builds a live, dismissible queue
 * of chat messages that either @-mention the streamer or use Twitch's
 * "Highlight My Message" redemption, so a streamer handling an influx of
 * viewers doesn't lose track of messages aimed at them specifically. Queue
 * is in-memory only (resets on restart) and pushed to the Queue window via
 * onQueueChanged rather than persisted.
 */
export class AtMeModule implements IBotModule {
  readonly id = 'at-me'
  readonly displayName = 'AtMe'
  readonly description = 'Queues chat messages that mention you or use Highlight My Message.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private _lastError: string | undefined
  private queue: AtMeQueueItem[] = []
  private readonly onMessage = (event: ChatMessageEvent): void => this.handleMessage(event)

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly config: () => AtMeConfig,
    private readonly onQueueChanged: (queue: AtMeQueueItem[]) => void
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

  listQueue(): AtMeQueueItem[] {
    return [...this.queue]
  }

  dismiss(id: string): void {
    this.queue = this.queue.filter((item) => item.id !== id)
    this.onQueueChanged(this.listQueue())
  }

  private handleMessage(event: ChatMessageEvent): void {
    const { matchMentions, matchHighlights } = this.config()
    const reasons: AtMeReason[] = []

    if (matchMentions && event.text.toLowerCase().includes(`@${this.channel().toLowerCase()}`)) {
      reasons.push('mention')
    }
    if (matchHighlights && event.highlighted) {
      reasons.push('highlight')
    }
    if (reasons.length === 0) return

    this.queue.push({
      id: randomUUID(),
      username: event.username,
      text: event.text,
      reasons,
      timestamp: Date.now()
    })
    this.onQueueChanged(this.listQueue())
  }
}
