import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface AppSettings {
  twitch: {
    accessToken: string
    login: string
    userId: string
    expiresAt: number // epoch ms; 0 means logged out
  }
  bots: {
    order: string[] // module ids, HUD display order
    hidden: string[] // module ids hidden from the HUD
  }
  legacyImport: {
    soundsImported: boolean // commands.json/emotes.json/commands_text.json already imported
    mediaImported: boolean // gifMediaCommands.json already imported
  }
  modules: {
    textToSpeech: {
      enabled: boolean
      minimumBits: number
      voiceName: string
    }
    liveStudioAudience: {
      enabled: boolean
    }
    command: {
      enabled: boolean
      allowUserList: boolean
      userIntrosEnabled: boolean
    }
    emote: {
      enabled: boolean
    }
    atMe: {
      enabled: boolean
      matchMentions: boolean
      matchHighlights: boolean
      togglesCollapsed: boolean
    }
    mediaGif: {
      enabled: boolean
      overlayPort: number
    }
    celebration: {
      enabled: boolean
      bitsPrice: number
      commandEnabled: boolean
      shellCount: number
      volume: number
    }
    coinks: {
      enabled: boolean
      bitsPrice: number
      commandEnabled: boolean
      coinsPerGame: number
      volume: number
    }
    hypeTrain: {
      enabled: boolean
      volume: number
    }
  }
}

export const defaultSettings: AppSettings = {
  twitch: {
    accessToken: '',
    login: '',
    userId: '',
    expiresAt: 0
  },
  bots: {
    order: ['live-studio-audience', 'text-to-speech', 'command', 'emote'],
    hidden: []
  },
  legacyImport: {
    soundsImported: false,
    mediaImported: false
  },
  modules: {
    textToSpeech: {
      enabled: false,
      minimumBits: 100,
      voiceName: ''
    },
    liveStudioAudience: {
      enabled: false
    },
    command: {
      enabled: false,
      allowUserList: false,
      userIntrosEnabled: false
    },
    emote: {
      enabled: false
    },
    atMe: {
      enabled: false,
      matchMentions: true,
      matchHighlights: true,
      togglesCollapsed: false
    },
    mediaGif: {
      enabled: false,
      overlayPort: 7474
    },
    celebration: {
      enabled: false,
      bitsPrice: 0,
      commandEnabled: true,
      shellCount: 15,
      volume: 0.6
    },
    coinks: {
      enabled: false,
      bitsPrice: 0,
      commandEnabled: true,
      coinsPerGame: 5,
      volume: 0.6
    },
    hypeTrain: {
      enabled: false,
      volume: 0.6
    }
  }
}

// Lives outside the repo entirely (Electron's per-OS user-data directory),
// so no settings/credentials ever end up in git history.
export class SettingsStore {
  private readonly filePath: string
  private cache: AppSettings | undefined

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'settings.json')
  }

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      this.cache = {
        twitch: { ...defaultSettings.twitch, ...parsed.twitch },
        bots: { ...defaultSettings.bots, ...parsed.bots },
        legacyImport: { ...defaultSettings.legacyImport, ...parsed.legacyImport },
        modules: {
          textToSpeech: { ...defaultSettings.modules.textToSpeech, ...parsed.modules?.textToSpeech },
          liveStudioAudience: { ...defaultSettings.modules.liveStudioAudience, ...parsed.modules?.liveStudioAudience },
          command: { ...defaultSettings.modules.command, ...parsed.modules?.command },
          emote: { ...defaultSettings.modules.emote, ...parsed.modules?.emote },
          atMe: { ...defaultSettings.modules.atMe, ...parsed.modules?.atMe },
          mediaGif: { ...defaultSettings.modules.mediaGif, ...parsed.modules?.mediaGif },
          celebration: { ...defaultSettings.modules.celebration, ...parsed.modules?.celebration },
          coinks: { ...defaultSettings.modules.coinks, ...parsed.modules?.coinks },
          hypeTrain: { ...defaultSettings.modules.hypeTrain, ...parsed.modules?.hypeTrain }
        }
      }
    } catch {
      this.cache = structuredClone(defaultSettings)
      await this.save(this.cache)
    }

    return this.cache
  }

  async save(settings: AppSettings): Promise<void> {
    this.cache = settings
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf-8')
  }
}
