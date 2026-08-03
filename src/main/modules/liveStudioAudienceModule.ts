import type { IBotModule, BotModuleStatus } from './types'
import type { TwitchChatClient, ChatMessageEvent } from './twitchChatClient'

export type SoundPlayer = (fileName: string) => void

interface KeywordRule {
  words: string[]
  sounds: string[]
}

// Ported from LiveStudioAudienceWindow.xaml.cs. Rules are matched
// independently per message, same as the original — a single message can
// trigger more than one sound if it matches more than one rule.
const KEYWORD_RULES: KeywordRule[] = [
  { words: ['lul', 'lol', 'lmao', 'lool', 'loool'], sounds: ['lol1.wav', 'lol2.wav', 'lol3.wav', 'lol4.wav', 'lol5.wav'] },
  { words: ['boo!', 'booo', 'you suck', 'awful'], sounds: ['boohiss.wav', 'Boo2.wav'] },
  { words: ["i'm here!", 'hi chat!', 'hi!', 'whats up'], sounds: ['cheerclap.wav'] },
  { words: ['gg', 'well done', 'good job', 'nice!'], sounds: ['golfclap.wav'] },
  { words: ['aww', 'love', 'kisses', 'im sorry', "i'm sorry"], sounds: ['aww.wav', 'aww2.wav'] },
  { words: ['omg', 'wtf', 'what???', 'so weird', 'strange'], sounds: ['GASP.wav', 'GASP2.wav'] },
  { words: ['big deal', 'who cares', 'so what'], sounds: ['fakelol.wav'] },
  { words: ['oh!', 'ooh!', 'ooh', 'oooh', 'ooooh'], sounds: ['oh.wav'] },
  { words: ['ah!', 'aah!', 'aaah', 'aaaah', 'aaaaah'], sounds: ['aaaah1.wav'] },
  { words: ['ooh! ah!', 'oooh! aah!', 'oooo aaah', 'oooh aaaah', 'ooh aaaaah'], sounds: ['oohaah.wav'] },
  { words: ['yawn', 'yaawn', 'yaaawn'], sounds: ['yawn.wav'] }
]

// Ported from the OnChatCommandReceived handler (message.Contains(...) on the
// text after "!").
const COMMAND_RULES: Record<string, string> = {
  crowd: 'crowd.wav',
  goodone: 'laughclap.wav',
  drama: 'drama.wav',
  boring: 'criquets.wav',
  fight: 'BRS_Crowd_Teens_Chant_Fight.wav',
  unsure: 'Hesitant.wav',
  impressive: 'oohaah.wav'
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export class LiveStudioAudienceModule implements IBotModule {
  readonly id = 'live-studio-audience'
  readonly displayName = 'Live Studio Audience'
  readonly description = 'Plays a reaction sound when chat uses matching keywords or commands.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private readonly onMessage = (event: ChatMessageEvent): void => this.handleMessage(event)

  constructor(
    private readonly chatClient: TwitchChatClient,
    private readonly channel: () => string,
    private readonly accessToken: () => string,
    private readonly playSound: SoundPlayer
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
    const text = event.text.toLowerCase()

    if (text.startsWith('!')) {
      const command = text.slice(1).split(/\s/)[0]
      for (const [keyword, sound] of Object.entries(COMMAND_RULES)) {
        if (command.includes(keyword)) this.playSound(sound)
      }
    }

    for (const rule of KEYWORD_RULES) {
      if (rule.words.some((word) => text.includes(word))) {
        this.playSound(rule.sounds.length > 1 ? pickRandom(rule.sounds) : rule.sounds[0])
      }
    }
  }
}
