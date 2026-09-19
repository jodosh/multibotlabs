import { LiveStudioAudienceModule } from './liveStudioAudienceModule'
import { TextToSpeechModule } from './textToSpeechModule'
import { CommandModule } from './commandModule'
import { EmoteModule } from './emoteModule'
import { AtMeModule } from './atMeModule'
import { MediaGifModule } from './mediaGifModule'
import { CelebrationModule } from './celebrationModule'
import { CoinksModule } from './coinksModule'
import { HypeTrainModule } from './hypeTrainModule'
import { moduleRefs } from './moduleRefs'
import { getSettings } from '../app/settingsState'
import { chatClient, soundLibrary, mediaLibrary, playbackQueue, hypeTrainEventSub } from '../app/services'
import { playSound, playTriggerSound, speak } from '../audio/playbackBridge'
import {
  overlayServer,
  playMedia,
  startFireworks,
  broadcastCoinksState,
  broadcastHypeTrainBattleEvent
} from '../overlay/overlayService'
import * as windows from '../windows/windowRegistry'
import type { AppSettings } from '../settings/settingsStore'
import type { IBotModule } from './types'
import type { WindowKey } from '../windows/windowRegistry'

export interface BotDescriptor {
  id: string
  // Typed against the settings shape so a kebab-case id paired with the wrong
  // camelCase key is a compile error. That mapping used to be hand-written in
  // two places (startup enable and settings write-back) with nothing linking
  // them.
  settingsKey: keyof AppSettings['modules']
  // The window the HUD opens on right-click, if the bot has one. Replaces an
  // if/else chain that was a sixth hardcoded copy of the bot list.
  managerWindow?: WindowKey
  construct: () => IBotModule
}

// ORDER IS BEHAVIOR. reconcileBotOrder appends any id missing from
// settings.bots.order in ModuleManager's registration order, and ModuleManager
// is backed by an insertion-ordered Map — so this array is the HUD's
// left-to-right tile order on a fresh install.
//
// It reproduces the previous registration order exactly, which was NOT the old
// construction order: coinks was constructed before celebration was registered,
// but registered after it. Reordering these entries silently changes what a new
// user sees. scripts/smoke.mjs asserts this sequence.
export const botDescriptors: BotDescriptor[] = [
  {
    id: 'live-studio-audience',
    settingsKey: 'liveStudioAudience',
    construct: () =>
      new LiveStudioAudienceModule(
        chatClient,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        playSound
      )
  },
  {
    id: 'text-to-speech',
    settingsKey: 'textToSpeech',
    managerWindow: 'tts-settings',
    construct: () =>
      new TextToSpeechModule(
        chatClient,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        () => getSettings().modules.textToSpeech,
        speak
      )
  },
  {
    id: 'command',
    settingsKey: 'command',
    managerWindow: 'library:command',
    construct: () =>
      new CommandModule(
        chatClient,
        soundLibrary,
        playbackQueue,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        () => getSettings().modules.command.allowUserList,
        () => getSettings().modules.command.userIntrosEnabled,
        () => getSettings().modules.textToSpeech.freeCommandEnabled,
        playTriggerSound
      )
  },
  {
    id: 'emote',
    settingsKey: 'emote',
    managerWindow: 'library:emote',
    construct: () =>
      new EmoteModule(
        chatClient,
        soundLibrary,
        playbackQueue,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        playTriggerSound
      )
  },
  {
    id: 'at-me',
    settingsKey: 'atMe',
    managerWindow: 'atme-queue',
    construct: () => {
      const atMe = new AtMeModule(
        chatClient,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        () => getSettings().modules.atMe,
        (queue) => windows.send('atme-queue', 'atme:queue-changed', queue)
      )
      moduleRefs.atMe = atMe
      return atMe
    }
  },
  {
    id: 'media-gif',
    settingsKey: 'mediaGif',
    managerWindow: 'media',
    construct: () =>
      new MediaGifModule(
        chatClient,
        mediaLibrary,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        playMedia
      )
  },
  {
    id: 'celebration',
    settingsKey: 'celebration',
    managerWindow: 'celebration',
    construct: () =>
      new CelebrationModule(
        chatClient,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        () => getSettings().modules.celebration,
        startFireworks
      )
  },
  {
    id: 'coinks',
    settingsKey: 'coinks',
    managerWindow: 'coinks',
    construct: () => {
      const coinks = new CoinksModule(
        chatClient,
        () => getSettings().twitch.login,
        () => getSettings().twitch.accessToken,
        () => getSettings().modules.coinks,
        () => overlayServer.clientCount('coinks') > 0,
        (player, coinCount) =>
          overlayServer.broadcast({
            type: 'coinks:start',
            player,
            coins: coinCount,
            volume: getSettings().modules.coinks.volume
          }),
        () => overlayServer.broadcast({ type: 'coinks:throw' }),
        broadcastCoinksState
      )
      moduleRefs.coinks = coinks
      return coinks
    }
  },
  {
    id: 'hype-train',
    settingsKey: 'hypeTrain',
    managerWindow: 'hype-train',
    construct: () => {
      // The only bot not on the shared chat connection: Hype Train state is
      // EventSub-only, so it takes the WebSocket client and the broadcaster's
      // user id rather than the login name.
      const hypeTrain = new HypeTrainModule(
        hypeTrainEventSub,
        () => getSettings().twitch.userId,
        () => getSettings().twitch.accessToken,
        broadcastHypeTrainBattleEvent
      )
      moduleRefs.hypeTrain = hypeTrain
      return hypeTrain
    }
  }
]
