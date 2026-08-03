import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'
import type { SoundLibrary } from '../library/soundLibrary'
import type { PlaybackQueue } from '../library/playbackQueue'
import type { PlayTriggerSoundFn } from '../library/types'

const MAX_CHAT_MESSAGE_LENGTH = 500

function normalizeCommandText(text: string): string {
  return text.startsWith('!') ? text.slice(1) : text
}

/**
 * Ported from Command/CommandBotWindow.xaml.cs: !command -> sound (via the
 * shared SoundLibrary), !command -> text reply, and an optional !commands
 * listing. Matching is case-insensitive here, unlike the old app's
 * exact-string comparison for sound commands — a deliberate small fix, not
 * a behavior we want to carry forward.
 *
 * Also handles the user-locked !intro command: a fixed, universal command
 * word that looks up a sound assigned to the calling viewer's own username
 * (kind: 'user-intro' in the shared SoundLibrary) — replaces the old app's
 * undocumented !intro_<username> convention, which required the streamer to
 * name a command after each viewer and the viewer to type it back exactly.
 */
export class CommandModule implements IBotModule {
  readonly id = 'command'
  readonly displayName = 'Command'
  readonly description = 'Plays a sound or sends a reply when chat uses a matching !command.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private readonly onMessage = (event: ChatMessageEvent): void => {
    void this.handleMessage(event)
  }

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly library: SoundLibrary,
    private readonly playbackQueue: PlaybackQueue,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly allowUserList: () => boolean,
    private readonly userIntrosEnabled: () => boolean,
    private readonly playTriggerSound: PlayTriggerSoundFn
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

  private async handleMessage(event: ChatMessageEvent): Promise<void> {
    if (!event.text.startsWith('!')) return

    const commandText = normalizeCommandText(event.text.trim()).toLowerCase()
    const firstWord = commandText.split(/\s/)[0]

    // The built-in !commands listing takes over the *text reply* slot for
    // "commands" — a text reply there would silently never fire, which is
    // exactly what the Library UI warns about. A *sound* command named
    // "commands" isn't competing with a chat reply, though, so it's allowed
    // to keep firing normally below.
    const commandsListRequested = firstWord === 'commands' && this.allowUserList()
    if (commandsListRequested) {
      await this.sendCommandList(event.channel)
    }

    if (firstWord === 'intro' && this.userIntrosEnabled()) {
      this.tryPlayUserIntro(event.username)
      return
    }

    // A sound command and a text reply are independent — a streamer can use
    // the same !command name for both and expect both to fire, the same way
    // liveStudioAudienceModule.ts matches every keyword rule independently
    // rather than stopping at the first hit.
    if (!commandsListRequested) {
      const textReply = this.library
        .listTextReplies()
        .find((reply) => normalizeCommandText(reply.command).toLowerCase() === firstWord)
      if (textReply) {
        await this.chatClient.say(event.channel, textReply.reply)
      }
    }

    this.tryPlaySound(firstWord)
  }

  private tryPlaySound(commandText: string): void {
    const sound = this.library
      .listSounds('command')
      .find((candidate) => normalizeCommandText(candidate.trigger).toLowerCase() === commandText)
    if (!sound) return
    if (!this.playbackQueue.tryAcquire(sound.id)) return

    this.playTriggerSound(sound.filePath, sound.volume)
  }

  private tryPlayUserIntro(username: string): void {
    const sound = this.library
      .listSounds('user-intro')
      .find((candidate) => candidate.trigger.toLowerCase() === username.toLowerCase())
    if (!sound) return
    if (!this.playbackQueue.tryAcquire(sound.id)) return

    this.playTriggerSound(sound.filePath, sound.volume)
  }

  private async sendCommandList(channel: string): Promise<void> {
    const sections: { label: string; items: string[]; separator: string }[] = [
      { label: 'Sound Commands', items: this.library.listSounds('command').map((sound) => sound.trigger).sort(), separator: ' ' },
      { label: 'Text Commands', items: this.library.listTextReplies().map((reply) => reply.command).sort(), separator: ' ' }
    ]

    // Listing usernames with an intro assigned is pointless if !intro itself
    // is off — the section would just describe a command that can't be used.
    if (this.userIntrosEnabled()) {
      sections.push({
        label: 'Users with Intros',
        items: this.library.listSounds('user-intro').map((sound) => sound.trigger).sort(),
        separator: ', '
      })
    }

    for (const section of sections) {
      if (section.items.length === 0) continue
      await this.sendChunked(channel, `${section.label}: `, section.items, section.separator)
    }
  }

  // Splits a label + list of items across as many chat messages as needed to
  // stay under Twitch's length limit, rather than assuming it always fits in one.
  private async sendChunked(channel: string, prefix: string, items: string[], separator: string): Promise<void> {
    const trimTrailingSeparator = (text: string): string => (text.endsWith(separator) ? text.slice(0, -separator.length) : text)

    let chunk = prefix
    for (const item of items) {
      if (chunk.length + item.length + separator.length > MAX_CHAT_MESSAGE_LENGTH) {
        await this.chatClient.say(channel, trimTrailingSeparator(chunk))
        chunk = ''
      }
      chunk += `${item}${separator}`
    }
    if (chunk.trim().length > 0) {
      await this.chatClient.say(channel, trimTrailingSeparator(chunk))
    }
  }
}
