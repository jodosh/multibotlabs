import { EventEmitter } from 'node:events'
import tmi from 'tmi.js'

export interface ChatMessageEvent {
  channel: string
  text: string
  bits: number
  username: string
  // Twitch's "Highlight My Message" channel-points redemption — the message
  // still arrives as a normal PRIVMSG, just tagged msg-id: 'highlighted-message'.
  highlighted: boolean
}

export type ChatClientStatus = 'disconnected' | 'connecting' | 'connected'

/**
 * Single shared IRC connection for all bot modules, unlike the original app
 * where each bot window opened its own TwitchClient to the same channel.
 * Modules call acquire()/release() instead of connect()/disconnect() directly
 * so the connection stays open as long as at least one module needs it.
 */
export class TwitchChatClient extends EventEmitter {
  private client: tmi.Client | undefined
  private _status: ChatClientStatus = 'disconnected'
  private refCount = 0

  get status(): ChatClientStatus {
    return this._status
  }

  async acquire(channel: string, accessToken: string): Promise<void> {
    // Refuse to connect without a channel, rather than letting tmi.js succeed
    // at connecting to nothing.
    //
    // With no Twitch login the channel name is the empty string, and tmi.js
    // happily opens an anonymous read-only connection and reports success —
    // joined to no channel, so no message ever arrives. Every module's start()
    // then sets status 'running' and the HUD shows the bot as connected and
    // working, which is the single most misleading state this app can be in.
    // Throwing here routes into the catch each module already has around
    // acquire(), so the tile turns red without touching all nine of them.
    //
    // Validated before refCount is incremented: throwing after the increment
    // would leak a reference and keep the connection alive past the last
    // release().
    if (!channel.trim()) {
      throw new Error('No Twitch channel — log in on the Settings window first.')
    }

    this.refCount += 1
    if (this.client) return
    await this.connect(channel, accessToken)
  }

  async release(): Promise<void> {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount === 0) {
      await this.disconnect()
    }
  }

  private async connect(channel: string, accessToken: string): Promise<void> {
    this._status = 'connecting'
    this.emit('status', this._status)

    const password = accessToken
      ? accessToken.startsWith('oauth:')
        ? accessToken
        : `oauth:${accessToken}`
      : undefined

    const client = new tmi.Client({
      channels: [channel],
      identity: password ? { username: channel, password } : undefined
    })

    client.on('message', (channelName, tags, message, self) => {
      if (self) return
      this.emit('message', {
        channel: channelName,
        text: message,
        bits: tags.bits ? Number(tags.bits) : 0,
        username: tags.username ?? '',
        highlighted: tags['msg-id'] === 'highlighted-message'
      } satisfies ChatMessageEvent)
    })

    client.on('connected', () => {
      this._status = 'connected'
      this.emit('status', this._status)
    })

    client.on('disconnected', () => {
      this._status = 'disconnected'
      this.emit('status', this._status)
    })

    this.client = client
    try {
      await client.connect()
    } catch (error) {
      this.client = undefined
      this._status = 'disconnected'
      this.emit('status', this._status)
      console.error(
        '[twitch] connection failed — check the access token is valid/unexpired and has chat:read/chat:edit scope:',
        error instanceof Error ? error.message : error
      )
      throw error
    }
  }

  async say(channel: string, message: string): Promise<void> {
    if (!this.client) return
    await this.client.say(channel, message)
  }

  private async disconnect(): Promise<void> {
    if (!this.client) return
    const client = this.client
    this.client = undefined
    await client.disconnect()
    this._status = 'disconnected'
  }
}
