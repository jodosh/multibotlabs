import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'

export interface CelebrationConfig {
  bitsPrice: number
  commandEnabled: boolean
  shellCount: number
}

/**
 * Ported from Celebration/CelebrationWindow.xaml.cs: a bits cheer (or the
 * !fireworks command) sets off a fireworks show on the stream overlay.
 *
 * Bits matching is an *exact* comparison, deliberately preserving the original
 * behavior — it's what lets Celebration and the (future) coin game hold
 * distinct prices without one large cheer triggering both.
 *
 * Two things the original did that are not reproduced. It only accepted the
 * !fireworks command while the bits price was 0, coupling two settings that
 * have no reason to interact; here they're independent. And it posted the
 * payload, mutated it, then posted again, so an enabled variant sent two
 * "fireworks" messages and Unity fired 30 shells instead of 15.
 */
export class CelebrationModule implements IBotModule {
  readonly id = 'celebration'
  readonly displayName = 'Celebration'
  readonly description = 'Sets off a fireworks show on the overlay when chat cheers bits.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private readonly onMessage = (event: ChatMessageEvent): void => this.handleMessage(event)

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly config: () => CelebrationConfig,
    private readonly startShow: (shells: number) => void
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
    const { bitsPrice, commandEnabled, shellCount } = this.config()

    // Guarding on bitsPrice > 0 matters: without it a price of 0 would match
    // every ordinary chat message, since non-cheer messages carry bits: 0.
    if (bitsPrice > 0 && event.bits === bitsPrice) {
      this.startShow(shellCount)
      return
    }

    if (commandEnabled && event.text.trim().toLowerCase().split(/\s/)[0] === '!fireworks') {
      this.startShow(shellCount)
    }
  }
}
