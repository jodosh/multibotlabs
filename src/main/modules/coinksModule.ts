import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'

export interface CoinksConfig {
  bitsPrice: number
  commandEnabled: boolean
  coinsPerGame: number
}

export interface CoinksState {
  currentPlayer: string | undefined
  queue: string[]
}

/**
 * Ported from CoinGameManager.cs + HeyListen.cs.
 *
 * Owns everything the *game* shouldn't: whose turn it is, who's waiting, and
 * when to start the next one. The simulation itself lives in the overlay page
 * — main never sees a coin. The overlay reports a final score back over
 * POST /coinks/result, which doubles as the signal that a turn has ended.
 *
 * Keeping the queue here rather than in the overlay matters: a browser source
 * can be reloaded or closed mid-stream, and the line of waiting viewers should
 * survive that. It is still in-memory only, so it resets when the app does.
 */
export class CoinksModule implements IBotModule {
  readonly id = 'coinks'
  readonly displayName = 'Coinks'
  readonly description = 'Runs the coin game on the overlay, with a queue of viewers taking turns.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private queue: string[] = []
  private currentPlayer: string | undefined
  private readonly onMessage = (event: ChatMessageEvent): void => this.handleMessage(event)

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly config: () => CoinksConfig,
    private readonly overlayConnected: () => boolean,
    private readonly startGame: (player: string, coins: number) => void,
    private readonly throwCoin: () => void,
    private readonly onStateChanged: (state: CoinksState) => void = () => {}
  ) {}

  get status(): BotModuleStatus {
    return this._status
  }

  state(): CoinksState {
    return { currentPlayer: this.currentPlayer, queue: [...this.queue] }
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
    this.queue = []
    this.currentPlayer = undefined
    this.onStateChanged(this.state())
    this._status = 'stopped'
  }

  /** Called when the overlay reports a finished game. Advances the queue. */
  finishGame(player: string): void {
    // Ignore a result for someone who isn't the active player — a stale
    // overlay reconnecting could otherwise cut the current game short.
    if (this.currentPlayer !== undefined && player !== this.currentPlayer) return
    this.currentPlayer = undefined
    this.onStateChanged(this.state())
    this.startNextIfIdle()
  }

  /** Used by the manager window's Test button. */
  enqueue(player: string): void {
    if (this.currentPlayer === player || this.queue.includes(player)) return
    this.queue.push(player)
    this.onStateChanged(this.state())
    this.startNextIfIdle()
  }

  private startNextIfIdle(): void {
    if (this.currentPlayer !== undefined) return
    const next = this.queue.shift()
    if (next === undefined) return

    this.currentPlayer = next
    this.onStateChanged(this.state())
    this.startGame(next, this.config().coinsPerGame)
  }

  private handleMessage(event: ChatMessageEvent): void {
    const { bitsPrice, commandEnabled } = this.config()
    const firstWord = event.text.trim().toLowerCase().split(/\s/)[0]

    // Only the player whose turn it is can release a coin — the same check
    // HeyListen.cs made before forwarding "releasecoin" to the game.
    if (firstWord === '!coin') {
      if (event.username.toLowerCase() === this.currentPlayer?.toLowerCase()) this.throwCoin()
      return
    }

    const joinedByBits = bitsPrice > 0 && event.bits === bitsPrice
    const joinedByCommand = commandEnabled && firstWord === '!coinks'
    if (!joinedByBits && !joinedByCommand) return

    // Queuing people up when nothing is listening would silently swallow their
    // turn, so say something instead — the old app gave no feedback at all.
    if (!this.overlayConnected()) {
      void this.chatClient.say(event.channel, 'The coin game overlay is not running right now.')
      return
    }

    this.enqueue(event.username)
  }
}
