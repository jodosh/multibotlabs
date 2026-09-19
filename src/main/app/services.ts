import { ModuleManager } from '../modules/moduleManager'
import { TwitchChatClient } from '../modules/twitchChatClient'
import { SoundLibrary } from '../library/soundLibrary'
import { MediaLibrary } from '../library/mediaLibrary'
import { PlaybackQueue } from '../library/playbackQueue'
import { CoinksScores } from '../library/coinksScores'
import { HypeTrainEventSub } from '../twitch/hypeTrainEventSub'

// The process-wide service singletons. These were constructed at index.ts's
// module scope and still are — just somewhere that isn't the entry point, so
// the units that need them can import them directly instead of being handed
// them through a chain of parameters.
//
// Each of these is genuinely one-per-process and always will be: the chat
// client is ref-counted precisely so a single connection can be shared, the
// libraries each own one file in userData, and the playback queue is a global
// single-flight lock. Injecting them would add ceremony without adding a
// second possible instance.
//
// Ordering note, since it is easy to get wrong: SoundLibrary, MediaLibrary and
// CoinksScores all resolve `app.getPath('userData')` in their *constructors*,
// so that now happens at import time — strictly earlier than before, because ES
// imports are hoisted above index.ts's own statements (the Chromium
// commandLine switches among them).
//
// That is safe, but for a specific reason rather than by luck: userData is one
// of the paths Electron derives from the app name and OS conventions, available
// before the 'ready' event — unlike paths that require an initialized app. The
// switches these now precede only affect Chromium's command line and have no
// bearing on path resolution.
//
// What would NOT be safe here is a constructor needing a ready app, or one with
// side effects ordered against those switches. Check before adding to this list.

export const moduleManager = new ModuleManager()
export const chatClient = new TwitchChatClient()
export const soundLibrary = new SoundLibrary()
export const mediaLibrary = new MediaLibrary()
export const playbackQueue = new PlaybackQueue()
export const coinksScores = new CoinksScores()
export const hypeTrainEventSub = new HypeTrainEventSub()
