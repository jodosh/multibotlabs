import { EventEmitter } from 'node:events'
import { TWITCH_CLIENT_ID } from '../auth/twitchOAuthConfig'

// Overridable for local testing against `twitch event websocket start-server`
// (see docs/HYPE_TRAIN_TESTING.md) — its mock server pushes triggered events
// straight to whatever's connected, with no real Helix subscription behind
// it, so a mock connection also skips createSubscriptions() entirely below.
const EVENTSUB_WS_URL = process.env['HYPE_TRAIN_EVENTSUB_URL'] || 'wss://eventsub.wss.twitch.tv/ws'
const USING_MOCK_EVENTSUB = Boolean(process.env['HYPE_TRAIN_EVENTSUB_URL'])
const HELIX_SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions'
const SUBSCRIPTION_TYPES = ['channel.hype_train.begin', 'channel.hype_train.progress', 'channel.hype_train.end'] as const
// Twitch requires subscriptions to exist before this many seconds pass without
// traffic; padded well past that so our own timer never races the server's.
const KEEPALIVE_MARGIN_MS = 5_000
const RECONNECT_DELAY_MS = 5_000

export interface HypeTrainContribution {
  user_id: string
  user_login: string
  user_name: string
  type: string
  total: number
}

export interface HypeTrainBeginEventPayload {
  id: string
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  level: number
  total: number
  progress: number
  goal: number
  top_contributions: HypeTrainContribution[]
  last_contribution: HypeTrainContribution
  started_at: string
  expires_at: string
}

export type HypeTrainProgressEventPayload = HypeTrainBeginEventPayload

export interface HypeTrainEndEventPayload {
  id: string
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  level: number
  total: number
  top_contributions: HypeTrainContribution[]
  started_at: string
  ended_at: string
  cooldown_ends_at: string
}

export type HypeTrainEventSubStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface EventSubMessage {
  metadata: { message_type: string; subscription_type?: string }
  payload: Record<string, unknown>
}

/**
 * Single shared EventSub WebSocket connection, ref-counted like
 * TwitchChatClient so a future second EventSub-based bot could share it
 * without opening its own socket. Scoped to Hype Train subscriptions only —
 * broadening this to arbitrary subscription types is not needed yet.
 *
 * The WebSocket transport (rather than webhooks) is deliberate: it needs no
 * public server or client secret, matching the implicit-grant-only constraint
 * documented in src/main/auth/twitchAuth.ts.
 */
export class HypeTrainEventSub extends EventEmitter {
  private socket: WebSocket | undefined
  private keepaliveTimer: NodeJS.Timeout | undefined
  private keepaliveTimeoutMs = 15_000
  private reconnectTimer: NodeJS.Timeout | undefined
  private refCount = 0
  private _status: HypeTrainEventSubStatus = 'disconnected'
  private broadcasterUserId = ''
  private accessToken = ''

  get status(): HypeTrainEventSubStatus {
    return this._status
  }

  async acquire(broadcasterUserId: string, accessToken: string): Promise<void> {
    this.refCount += 1
    if (this.socket) return
    this.broadcasterUserId = broadcasterUserId
    this.accessToken = accessToken
    await this.connectAndSubscribe()
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount === 0) this.teardown()
  }

  private setStatus(status: HypeTrainEventSubStatus): void {
    this._status = status
    this.emit('status', status)
  }

  private async connectAndSubscribe(): Promise<void> {
    this.setStatus('connecting')
    try {
      const socket = await this.openSocket(EVENTSUB_WS_URL)
      const sessionId = await this.waitForWelcome(socket)
      if (!USING_MOCK_EVENTSUB) await this.createSubscriptions(sessionId)
      this.socket = socket
      this.attachOngoingHandlers(socket)
      this.setStatus('connected')
    } catch (error) {
      this.setStatus('error')
      console.error(
        '[hype-train] EventSub connection failed — check the access token has channel:read:hype_train scope:',
        error instanceof Error ? error.message : error
      )
      throw error
    }
  }

  private openSocket(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const onOpen = (): void => {
        socket.removeEventListener('error', onError)
        resolve(socket)
      }
      const onError = (): void => {
        socket.removeEventListener('open', onOpen)
        reject(new Error('EventSub WebSocket failed to open'))
      }
      socket.addEventListener('open', onOpen, { once: true })
      socket.addEventListener('error', onError, { once: true })
    })
  }

  /** Resolves with the session id once `session_welcome` arrives, per Twitch's handshake. */
  private waitForWelcome(socket: WebSocket): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Timed out waiting for session_welcome'))
      }, 10_000)

      const onMessage = (event: MessageEvent): void => {
        const message = this.parseMessage(event.data)
        if (message?.metadata.message_type !== 'session_welcome') return
        cleanup()
        const session = message.payload['session'] as { id: string; keepalive_timeout_seconds: number }
        this.armKeepaliveTimer(session.keepalive_timeout_seconds)
        resolve(session.id)
      }
      const onClose = (): void => {
        cleanup()
        reject(new Error('EventSub WebSocket closed before session_welcome'))
      }
      const cleanup = (): void => {
        clearTimeout(timeout)
        socket.removeEventListener('message', onMessage)
        socket.removeEventListener('close', onClose)
      }

      socket.addEventListener('message', onMessage)
      socket.addEventListener('close', onClose)
    })
  }

  private async createSubscriptions(sessionId: string): Promise<void> {
    for (const type of SUBSCRIPTION_TYPES) {
      const response = await fetch(HELIX_SUBSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          'Client-Id': TWITCH_CLIENT_ID,
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type,
          // v1 of these three types has been retired — Twitch 400s with
          // "invalid subscription type and version" for it. v2 is additive
          // (extra fields like golden-kappa/shared-train flags), so the
          // fields this file reads are unaffected.
          version: '2',
          condition: { broadcaster_user_id: this.broadcasterUserId },
          transport: { method: 'websocket', session_id: sessionId }
        })
      })
      if (!response.ok) {
        throw new Error(`Subscribing to ${type} failed: ${response.status} ${await response.text()}`)
      }
    }
  }

  /** Notification/keepalive/reconnect/revocation handling for the life of an established connection. */
  private attachOngoingHandlers(socket: WebSocket): void {
    socket.addEventListener('message', (event) => {
      const message = this.parseMessage(event.data)
      if (!message) return
      this.armKeepaliveTimer()

      switch (message.metadata.message_type) {
        case 'notification':
          this.handleNotification(message)
          break
        case 'session_reconnect':
          this.handleReconnect(message)
          break
        case 'revocation':
          console.error('[hype-train] EventSub subscription revoked:', message.payload['subscription'])
          this.setStatus('error')
          break
        default:
          break
      }
    })

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return // superseded by a reconnect swap
      this.socket = undefined
      if (this.refCount > 0) this.scheduleReconnect()
      else this.setStatus('disconnected')
    })
  }

  private handleNotification(message: EventSubMessage): void {
    const subscriptionType = message.metadata.subscription_type
    const event = message.payload['event']
    if (subscriptionType === 'channel.hype_train.begin') this.emit('begin', event as HypeTrainBeginEventPayload)
    else if (subscriptionType === 'channel.hype_train.progress') this.emit('progress', event as HypeTrainProgressEventPayload)
    else if (subscriptionType === 'channel.hype_train.end') this.emit('end', event as HypeTrainEndEventPayload)
  }

  // Existing subscriptions carry over to the new session automatically — no
  // need to re-POST them, just swap sockets once the new one is live.
  private handleReconnect(message: EventSubMessage): void {
    const session = message.payload['session'] as { reconnect_url: string }
    const oldSocket = this.socket

    void this.openSocket(session.reconnect_url)
      .then((newSocket) => this.waitForWelcome(newSocket).then(() => newSocket))
      .then((newSocket) => {
        this.socket = newSocket
        this.attachOngoingHandlers(newSocket)
        oldSocket?.close()
      })
      .catch((error: unknown) => {
        console.error('[hype-train] EventSub reconnect failed:', error instanceof Error ? error.message : error)
        if (this.refCount > 0) this.scheduleReconnect()
      })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.setStatus('connecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connectAndSubscribe().catch(() => {
        // connectAndSubscribe already logs and sets status to 'error'; give up
        // rather than retrying forever — the user can re-toggle the bot.
      })
    }, RECONNECT_DELAY_MS)
  }

  private armKeepaliveTimer(keepaliveTimeoutSeconds?: number): void {
    if (keepaliveTimeoutSeconds !== undefined) this.keepaliveTimeoutMs = keepaliveTimeoutSeconds * 1000 + KEEPALIVE_MARGIN_MS
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = setTimeout(() => {
      console.error('[hype-train] EventSub connection went silent — reconnecting')
      this.socket?.close()
    }, this.keepaliveTimeoutMs)
  }

  private parseMessage(data: unknown): EventSubMessage | undefined {
    try {
      return JSON.parse(String(data)) as EventSubMessage
    } catch {
      return undefined
    }
  }

  private teardown(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.keepaliveTimer = undefined
    this.reconnectTimer = undefined
    this.socket?.close()
    this.socket = undefined
    this.setStatus('disconnected')
  }
}
